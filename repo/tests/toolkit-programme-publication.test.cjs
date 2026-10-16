'use strict';
// Synthetic controls: an in-memory GitHub that keeps issue edit history newest-first
// and rejects stale contents updates, as the real API does. The real-route
// qualification of the same classes runs separately against the private store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CanonicalStateStore, IssueProjectionPublisher, ProgrammeProjectionReconciler, renderObservedPullRequest, sha256 } =
  require('../scripts/toolkit-programme-publication.cjs');

class FakeGitHub {
  constructor() { this.files = new Map(); this.issues = new Map(); this.writes = 0; this.beforeWrite = null; this.failWrite = false; }
  addIssue(number, body) { this.issues.set(number, { body, edits: [] }); }
  foreignEdit(number, body) { const i = this.issues.get(number); i.edits.unshift({ body: i.body, edited_at: 'prior' }); i.body = body; }
  readContent(_r, path) { const f = this.files.get(path); return f ? { exists: true, sha: f.sha, text: f.text } : { exists: false }; }
  writeContent(_r, path, { text, expected_sha }) {
    const f = this.files.get(path);
    if ((f ? f.sha : null) !== (expected_sha || null)) return { state: 'CONFLICT' };
    const sha = sha256(text).slice(0, 40); this.files.set(path, { sha, text }); return { state: 'APPLIED', sha, commit: 'c'.repeat(40) };
  }
  readIssue(_r, number) { const i = this.issues.get(number); return { body: i.body, edits: i.edits.slice(0, 2) }; }
  writeIssueBody(_r, number, body) {
    if (this.beforeWrite) { const hook = this.beforeWrite; this.beforeWrite = null; hook(); }
    if (this.failWrite) return { state: 'UNKNOWN' };
    const i = this.issues.get(number); this.writes++;
    // GitHub's history records the body being replaced, then the new edit on top.
    i.edits.unshift({ body: i.body, edited_at: 'before' }); i.body = body; i.edits.unshift({ body, edited_at: 'now' });
    return { state: 'APPLIED' };
  }
}
const repo = 'owner/private-store';

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
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const base = publisher.bodyDigest(repo, 7);
  const applied = publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'rev-1 state', base_digest: base });
  assert.equal(applied.state, 'APPLIED');
  assert.match(gh.issues.get(7).body, /Human intro/);
  assert.equal(publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'rev-1 state', base_digest: base }).state, 'NOOP');
  assert.equal(gh.writes, 1);
});

test('a foreign edit after rendering holds the target and is never overwritten', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'original\n');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const base = publisher.bodyDigest(repo, 7);
  gh.foreignEdit(7, 'original\nowner note\n');
  const held = publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'rev-1', base_digest: base });
  assert.equal(held.state, 'HOLD'); assert.equal(held.reason, 'FOREIGN_EDIT_BEFORE_WRITE');
  assert.equal(gh.writes, 0); assert.match(gh.issues.get(7).body, /owner note/);
});

test('an edit landing between the check and the write is detected and remains recoverable', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'original\n');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const base = publisher.bodyDigest(repo, 7);
  gh.beforeWrite = () => gh.foreignEdit(7, 'original\nracing owner note\n');
  const held = publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'rev-1', base_digest: base });
  assert.equal(held.state, 'HOLD'); assert.equal(held.reason, 'INTERVENING_EDIT_PRESERVED_IN_HISTORY');
  assert.equal(held.intervening_digest, sha256('original\nracing owner note\n'));
  assert.ok(gh.issues.get(7).edits.some(e => e.body === 'original\nracing owner note\n'), 'foreign edit retained in history');
});

test('an unknown write outcome is not reported as published', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, 'original\n'); gh.failWrite = true;
  const publisher = new IssueProjectionPublisher({ transport: gh });
  assert.equal(publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'rev-1', base_digest: sha256('original\n') }).state, 'UNKNOWN');
});

test('parent and child render from one revision; a partial publication resumes as NOOP for applied targets', () => {
  const gh = new FakeGitHub(); gh.addIssue(1, 'parent\n'); gh.addIssue(2, 'child\n');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  const render = (state, target) => `${target.role} ${state.summary} @ ${state.revision}`;
  const reconciler = new ProgrammeProjectionReconciler({ publisher, render });
  const canonical = { revision: 'rev-abc', state: { summary: 'Core in G1', revision: 'rev-abc' } };
  const targets = [{ issue: 1, role: 'PARENT', marker: 'CURRENT' }, { issue: 2, role: 'CHILD', marker: 'CURRENT' }];
  const childBase = sha256('child\n');
  gh.foreignEdit(2, 'child\nlocal note\n');
  const first = reconciler.reconcile({ repository: repo, canonical, targets, bases: { 2: childBase } });
  assert.equal(first.state, 'PARTIAL_PENDING');
  assert.deepEqual(first.results.map(r => r.state), ['APPLIED', 'HOLD']);
  // After reconciling the child's note, the retry publishes only what is outstanding.
  const retry = reconciler.reconcile({ repository: repo, canonical, targets });
  assert.deepEqual(retry.results.map(r => r.state), ['NOOP', 'APPLIED']);
  assert.equal(retry.state, 'CURRENT');
  assert.match(gh.issues.get(2).body, /local note/);
  assert.throws(() => new ProgrammeProjectionReconciler({ publisher, render: () => 'unbound' })
    .reconcile({ repository: repo, canonical, targets }), e => e.code === 'PUBLICATION_RENDER_UNBOUND');
});

test('a corrupted managed block is refused rather than guessed', () => {
  const gh = new FakeGitHub(); gh.addIssue(7, '<!-- TOOLKIT-PROJECTION:CURRENT:BEGIN -->\nno end\n');
  const publisher = new IssueProjectionPublisher({ transport: gh });
  assert.throws(() => publisher.publish({ repository: repo, issue: 7, marker: 'CURRENT', block: 'x', base_digest: publisher.bodyDigest(repo, 7) }),
    e => e.code === 'PUBLICATION_MARKER_CORRUPT');
});

test('observed PR status renders as an observation, not acceptance', () => {
  const line = renderObservedPullRequest({ number: 9, head: 'a'.repeat(40), checks: 'passing' });
  assert.match(line, /observation, not product acceptance/);
  assert.doesNotMatch(line, /\bPASS\b|accepted/i);
});
