'use strict';
// Synthetic controls: an in-memory GitHub whose issue edit history follows what the
// real API was observed to do (newest first; one entry per edit, plus an entry for
// the original body on an issue's first edit; entries carry identities, and the
// publisher never reads their content). Contents updates reject a stale blob SHA,
// as the real API does. The real-route qualification runs separately against the
// private store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { GhTransport, CanonicalStateStore, IssueProjectionPublisher, ProgrammeProjectionReconciler, renderObservedPullRequest, sha256 } =
  require('../scripts/toolkit-programme-publication.cjs');

class FakeGitHub {
  constructor() {
    this.files = new Map(); this.issues = new Map(); this.writes = 0; this.failWrite = false; this.recordEdits = true;
    this.hooks = {}; this.reads = 0; this.nextId = 1;
  }
  addIssue(number, body) { this.issues.set(number, { body, edits: [] }); }
  #edit(number, body) {
    const i = this.issues.get(number);
    if (!this.recordEdits) { i.body = body; return null; }
    if (!i.edits.length) i.edits.unshift({ id: `E${this.nextId++}`, original: true });
    const id = `E${this.nextId++}`; i.edits.unshift({ id }); i.body = body; return id;
  }
  foreignEdit(number, body) { return this.#edit(number, body); }
  #fire(point) { const hook = this.hooks[point]; if (hook) { delete this.hooks[point]; hook(); } }
  readContent(_r, path) { const f = this.files.get(path); return f ? { exists: true, sha: f.sha, text: f.text } : { exists: false }; }
  writeContent(_r, path, { text, expected_sha }) {
    const f = this.files.get(path);
    if ((f ? f.sha : null) !== (expected_sha || null)) return { state: 'CONFLICT' };
    const sha = sha256(text).slice(0, 40); this.files.set(path, { sha, text }); return { state: 'APPLIED', sha, commit: 'c'.repeat(40) };
  }
  readIssue(_r, number) {
    this.#fire(`before-read-${++this.reads}`);
    const i = this.issues.get(number);
    return { body: i.body, edits: i.edits.slice(0, GhTransport.HISTORY_WINDOW).map(e => ({ id: e.id, edited_at: null, editor: 'owner' })) };
  }
  writeIssueBody(_r, number, body) {
    this.#fire('before-write');
    if (this.failWrite) return { state: 'UNKNOWN' };
    this.writes++; this.ourEdit = this.#edit(number, body);
    return { state: 'APPLIED' };
  }
}
const repo = 'owner/private-store';
const publishOn = (gh, issue, block, base, extra = {}) =>
  new IssueProjectionPublisher({ transport: gh }).publish({ repository: repo, issue, marker: 'CURRENT', block, base_digest: base, ...extra });

test('canonical state uses a conditional write: a stale revision is rejected without change', () => {
  const gh = new FakeGitHub(), store = new CanonicalStateStore({ transport: gh, repository: repo, path: 'programme/state.json' });
  const created = store.write({ revision_note: 'one' }, null, 'create');
  assert.equal(created.state, 'APPLIED');
  assert.equal(store.write({ revision_note: 'dup' }, null, 'create again').state, 'CONFLICT');
  const next = store.write({ revision_note: 'two' }, created.revision, 'advance');
  assert.equal(next.state, 'APPLIED');
  assert.equal(store.write({ revision_note: 'lost-update' }, created.revision, 'stale').state, 'CONFLICT');
  assert.equal(store.read().state.revision_note, 'two');
});

test('a projection is written only over the base it was rendered against', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'Human intro\n');
  const base = sha256('Human intro\n');
  const applied = publishOn(gh, 7, 'rev-1 state', base);
  assert.equal(applied.state, 'APPLIED');
  assert.equal(applied.edit, gh.ourEdit);
  assert.match(gh.issues.get(7).body, /Human intro/);
  assert.equal(publishOn(gh, 7, 'rev-1 state', base).state, 'NOOP');
  const next = publishOn(gh, 7, 'rev-2 state', sha256(gh.issues.get(7).body));
  assert.equal(next.state, 'APPLIED');
  assert.equal(gh.writes, 2);
});

test('a foreign edit before the write holds the target and writes nothing', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'original\n');
  const base = sha256('original\n');
  gh.foreignEdit(7, 'original\nowner note\n');
  const held = publishOn(gh, 7, 'rev-1', base);
  assert.equal(held.state, 'HOLD'); assert.equal(held.reason, 'FOREIGN_EDIT_BEFORE_WRITE');
  assert.equal(gh.writes, 0); assert.match(gh.issues.get(7).body, /owner note/);
});

test('an edit landing between the check and the write is overwritten and reported as such, never as applied', () => {
  for (const edited of [false, true]) {
    const gh = new FakeGitHub(); gh.addIssue(7, 'original\n');
    if (edited) gh.foreignEdit(7, 'original\nearlier\n');
    const base = sha256(gh.issues.get(7).body);
    let foreign;
    gh.hooks['before-write'] = () => { foreign = gh.foreignEdit(7, `${gh.issues.get(7).body}racing owner note\n`); };
    const held = publishOn(gh, 7, 'rev-1', base);
    assert.equal(held.state, 'HOLD'); assert.equal(held.reason, 'INTERVENING_EDIT_OVERWRITTEN');
    // GitHub's PATCH is unconditional: the racing text is gone from the live body.
    assert.doesNotMatch(gh.issues.get(7).body, /racing owner note/);
    assert.deepEqual(held.overwritten_edits.map(e => e.id), [foreign]);
    assert.equal(held.foreign_text, 'NOT_RETRIEVED');
  }
});

// The invariant: APPLIED is returned only when no foreign text was lost. A foreign
// edit is placed at every point of the publisher's read-write-read sequence, inside
// and outside the managed block, on issues with and without edit history.
test('no interleaving of one foreign edit yields APPLIED while that edit is missing from the live body', () => {
  const expected = { 'before-read-1': 'FOREIGN_EDIT_BEFORE_WRITE', 'before-write': 'INTERVENING_EDIT_OVERWRITTEN',
    'before-read-2': 'POST_WRITE_BODY_DIVERGED', after: 'APPLIED' };
  const BEGIN = '<!-- TOOLKIT-PROJECTION:CURRENT:BEGIN -->\n';
  let cases = 0;
  for (const history of ['fresh', 'published']) {
    for (const where of history === 'fresh' ? ['outside'] : ['outside', 'inside']) {
      for (const point of Object.keys(expected)) {
        const gh = new FakeGitHub(); gh.addIssue(5, 'Intro\n');
        if (history === 'published') publishOn(gh, 5, 'rev-0', sha256('Intro\n'));
        const base = sha256(gh.issues.get(5).body);
        const token = `FOREIGN-${history}-${where}-${point}`;
        let foreign = null;
        const edit = () => {
          const body = gh.issues.get(5).body;
          foreign = gh.foreignEdit(5, where === 'inside' ? body.replace(BEGIN, `${BEGIN}${token}\n`) : `${body}${token}\n`);
        };
        if (point === 'before-read-1') edit(); else if (point !== 'after') gh.hooks[point] = edit;
        gh.reads = 0;
        const result = publishOn(gh, 5, 'rev-1', base);
        if (point === 'after') edit();
        const live = gh.issues.get(5).body.includes(token);
        assert.equal(result.reason || result.state, expected[point], `${history}/${where}/${point}`);
        if (result.state === 'APPLIED') assert.ok(live, `${history}/${where}/${point}: applied while the foreign edit is lost`);
        if (!live) assert.ok(result.overwritten_edits.some(e => e.id === foreign), `${history}/${where}/${point}: loss not identified`);
        cases++;
      }
    }
  }
  assert.equal(cases, 12);
});

test('a write whose history cannot be verified is held, not applied', () => {
  const unrecorded = new FakeGitHub(); unrecorded.addIssue(7, 'original\n'); unrecorded.foreignEdit(7, 'original\nv2\n');
  unrecorded.recordEdits = false;
  assert.equal(publishOn(unrecorded, 7, 'rev-1', sha256('original\nv2\n')).reason, 'HISTORY_UNVERIFIABLE');
  const flooded = new FakeGitHub(); flooded.addIssue(7, 'original\n'); flooded.foreignEdit(7, 'original\nv2\n');
  flooded.hooks['before-write'] = () => { for (let n = 0; n < GhTransport.HISTORY_WINDOW; n++) flooded.foreignEdit(7, `original\nflood ${n}\n`); };
  assert.equal(publishOn(flooded, 7, 'rev-1', sha256('original\nv2\n')).reason, 'HISTORY_UNVERIFIABLE');
});

test('an unknown write outcome is not reported as published', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'original\n'); gh.failWrite = true;
  assert.equal(publishOn(gh, 7, 'rev-1', sha256('original\n')).state, 'UNKNOWN');
});

test('a publication without the base its block was rendered against is refused before any read or write', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'original\n');
  for (const base of [undefined, '', 'abc']) assert.throws(() => publishOn(gh, 7, 'rev-1', base), e => e.code === 'PUBLICATION_BASE_REQUIRED');
  const reconciler = new ProgrammeProjectionReconciler({ publisher: new IssueProjectionPublisher({ transport: gh }), render: () => 'rev-x' });
  assert.throws(() => reconciler.reconcile({ repository: repo, canonical: { revision: 'rev-x', state: {} }, targets: [{ issue: 7, role: 'CHILD', marker: 'CURRENT' }] }),
    e => e.code === 'PUBLICATION_BASE_REQUIRED');
  assert.equal(gh.reads, 0); assert.equal(gh.writes, 0);
});

test('parent and child render from one revision; a partial publication resumes as NOOP for applied targets', () => {
  const gh = new FakeGitHub(); gh.addIssue(1, 'parent\n'); gh.addIssue(2, 'child\n');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const render = (state, target) => `${target.role} ${state.summary} @ ${state.revision}`;
  const reconciler = new ProgrammeProjectionReconciler({ publisher, render });
  const canonical = { revision: 'rev-abc', state: { summary: 'Core in G1', revision: 'rev-abc' } };
  const targets = [{ issue: 1, role: 'PARENT', marker: 'CURRENT' }, { issue: 2, role: 'CHILD', marker: 'CURRENT' }];
  const bases = { 1: sha256('parent\n'), 2: sha256('child\n') };
  gh.foreignEdit(2, 'child\nlocal note\n');
  const first = reconciler.reconcile({ repository: repo, canonical, targets, bases });
  assert.equal(first.state, 'PARTIAL_PENDING');
  assert.deepEqual(first.results.map(r => r.state), ['APPLIED', 'HOLD']);
  // After the child's note is reconciled, the retry is rendered against the bodies now live.
  const retry = reconciler.reconcile({ repository: repo, canonical, targets,
    bases: { 1: sha256(gh.issues.get(1).body), 2: sha256(gh.issues.get(2).body) } });
  assert.deepEqual(retry.results.map(r => r.state), ['NOOP', 'APPLIED']);
  assert.equal(retry.state, 'CURRENT');
  assert.match(gh.issues.get(2).body, /local note/);
  assert.throws(() => new ProgrammeProjectionReconciler({ publisher, render: () => 'unbound' })
    .reconcile({ repository: repo, canonical, targets, bases }), e => e.code === 'PUBLICATION_RENDER_UNBOUND');
});

test('the transport reads edit entries as identities and never requests their diff', () => {
  const calls = [];
  const transport = new GhTransport({ run: args => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify({ data: { repository: { issue: { body: 'B', userContentEdits: { nodes: [
      { id: 'UCE_2', editedAt: '2026-10-17T00:00:02Z', editor: { login: 'owner' } }, { id: 'UCE_1', editedAt: '2026-10-17T00:00:01Z', editor: null }] } } } } }) };
  } });
  const read = transport.readIssue('owner/repo', 3);
  assert.deepEqual(read, { body: 'B', edits: [{ id: 'UCE_2', edited_at: '2026-10-17T00:00:02Z', editor: 'owner' }, { id: 'UCE_1', edited_at: '2026-10-17T00:00:01Z', editor: null }] });
  const query = calls[0].find(a => a.startsWith('query='));
  assert.doesNotMatch(query, /\bdiff\b/);
  assert.ok(calls[0].includes(`h=${GhTransport.HISTORY_WINDOW}`));
});

test('a corrupted managed block is refused rather than guessed', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, '<!-- TOOLKIT-PROJECTION:CURRENT:BEGIN -->\nno end\n');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  assert.throws(() => publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'x', base_digest: publisher.bodyDigest(repo, 7) }),
    e => e.code === 'PUBLICATION_MARKER_CORRUPT');
});

test('first placement replaces exactly one stale span; later publications replace only the marked block', () => {
  const stale = '**STALE CURRENT** paragraph.';
  const gh = new FakeGitHub(); gh.addIssue(9, `# Title\n\n## CURRENT\n\n${stale}\n\nKept text.\n`);
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const first = publisher.publish({ repository: repo, issue: 9, marker: 'CURRENT', block: 'rev-1 now\n\nHistory: ' + stale,
    base_digest: publisher.bodyDigest(repo, 9), replace_once: stale });
  assert.equal(first.state, 'APPLIED');
  const body = gh.issues.get(9).body;
  assert.ok(body.startsWith('# Title\n\n## CURRENT\n\n<!-- TOOLKIT-PROJECTION:CURRENT:BEGIN -->\nrev-1 now'));
  assert.ok(body.endsWith('<!-- TOOLKIT-PROJECTION:CURRENT:END -->\n\nKept text.\n'));
  assert.equal(body.split(stale).length, 2, 'the stale text survives once, inside the managed block');
  const second = publisher.publish({ repository: repo, issue: 9, marker: 'CURRENT', block: 'rev-2 now',
    base_digest: publisher.bodyDigest(repo, 9), replace_once: 'ignored once markers exist' });
  assert.equal(second.state, 'APPLIED');
  assert.ok(gh.issues.get(9).body.includes('BEGIN -->\nrev-2 now\n<!--') && gh.issues.get(9).body.endsWith('\n\nKept text.\n'));
});

test('first placement refuses a missing or repeated span before any write', () => {
  const gh = new FakeGitHub(); gh.addIssue(10, 'a SAME b SAME c');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const base = publisher.bodyDigest(repo, 10);
  for (const [span, code] of [['SAME', 'PUBLICATION_PLACEMENT_NOT_UNIQUE'], ['absent', 'PUBLICATION_PLACEMENT_NOT_UNIQUE'], ['  ', 'PUBLICATION_PLACEMENT_INVALID']]) {
    assert.throws(() => publisher.publish({ repository: repo, issue: 10, marker: 'CURRENT', block: 'x', base_digest: base, replace_once: span }),
      e => e.code === code);
  }
  assert.equal(gh.writes, 0);
});

test('observed PR status renders as an observation, not acceptance', () => {
  const line = renderObservedPullRequest({ number: 9, head: 'a'.repeat(40), checks: 'passing' });
  assert.match(line, /observation, not product acceptance/);
  assert.doesNotMatch(line, /\bPASS\b|accepted/i);
});
