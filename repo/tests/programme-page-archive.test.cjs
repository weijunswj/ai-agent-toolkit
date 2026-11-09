'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { pageFixture } = require('./support/programme-page-fixture.cjs');

// Wide escaped graph rows leave a whole-row margin for trace and finding growth.
// These recovery tests exercise comment custody, not a prefix boundary changing mid-pass.
function archiveFixture() {
  const f = pageFixture(state, { count: 20, groups: ['RETIRED'], hand: '# Programme\n\n' + 'Notes. '.repeat(4900) });
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => {
    for (const outcome of doc.outcomes) outcome.description = '&'.repeat(200); return doc;
  } });
  return f;
}

test('an explicitly excluded registered part reposts unchanged content and settles within budget', () => {
  const f = archiveFixture();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const entry = f.parent().page_archive[0], id = entry.comment_id;
  const body = f.github.comments.get(id).body, posts = f.posts().length, edits = f.edits().length;
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => {
    doc.page_archive[0].untrusted_ids = [id]; return doc;
  } });
  assert.deepEqual(f.make().run({ apply: true }).holds, [], 'exclusion must not cause EFFECT_UNKNOWN');
  const next = f.parent().page_archive[0];
  assert.notEqual(next.comment_id, id);
  assert.equal(next.state, 'moved');
  assert.equal(f.posts().length, posts + 1);
  assert.ok(f.posts().length - posts <= 5);
  assert.equal(f.edits().length, edits);
  assert.equal(f.github.comments.get(id).body, body);
  assert.ok(next.untrusted_ids.includes(id));
  const writes = f.github.mutations();
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
  assert.equal(f.github.mutations(), writes);
});

test('archive trust guidance covers duplicates and keeps findings open until disposed', () => {
  const text = state.FINDING_CODES.ARCHIVE_COMMENT_UNTRUSTED.next_action;
  assert.doesNotMatch(text, /detached/);
  assert.match(text, /inspect the graph archive comment this finding names/);
  assert.match(text, /finding stays open until disposed/);
});

for (const route of ['apply', 'recovery']) test(`D3: six changing graph parts across alternating accounts retire prior ids quietly, ${route}`, () => {
  const f = archiveFixture();
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.length, 1);
  const issue = Number(/\|#(\d+)\|/.exec(f.github.comments.get(f.parent().page_archive[0].comment_id).body)[1]);
  const replaced = [];
  for (let pass = 0; pass < 6; pass++) {
    f.github.login = pass % 2 ? 'owner' : 'second-login';
    const previous = f.parent().page_archive[0], oldBody = f.github.comments.get(previous.comment_id).body;
    f.store.mutate('parent', 12, { writer: f.writer, change: doc => {
      doc.outcomes.find(outcome => outcome.issue === issue).name = `Revision ${pass}`; return doc;
    } });
    const posts = f.posts().length, edits = f.edits().length;
    if (route === 'recovery') {
      let lost = false;
      f.github.intercept(call => {
        if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
          lost = true; f.github.route(call.method, call.path, call.body);
          throw Object.assign(new Error('Lost replacement reply'), { code: 'PASS_LOCK_LOST' });
        }
      });
      assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
      f.github.hooks = [];
    }
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const current = f.parent().page_archive[0];
    assert.equal(f.posts().length, posts + 1, 'exactly one post per content change');
    assert.equal(f.edits().length, edits, 'the other account is never edited');
    assert.equal(f.github.comments.get(previous.comment_id).body, oldBody);
    assert.equal(current.login, f.github.login);
    assert.notEqual(current.comment_id, previous.comment_id);
    replaced.push(previous.comment_id);
    assert.ok((current.untrusted_ids || []).length <= 32);
    assert.equal(f.parent().page_archive.length, 1);
    assert.equal((f.parent().attention || []).some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'), false);
  }
  assert.ok(replaced.every(id => f.parent().page_archive[0].untrusted_ids.includes(id)));
});

test('hand-written Archive sections and ambiguous Markdown are inert on full and issue-scoped redraws', () => {
  const hands = ['## Archive\n### Notes\nKeep every byte.  \n\n## Current plan\nKeep this too.\n',
    '- step\n  ```\n  code\nText.\n```\n\n## Archive\n### Hidden\nKeep.\n```\n- x\n  ```\n\nTail paragraph the owner never marked.\n\n## Risks\n<details><!-- folded -->\nKeep this too.\n'];
  for (const hand of hands) for (const only of [false, true]) {
    const f = pageFixture(state, { count: 1, hand: '# Programme\n\n' + hand });
    assert.deepEqual(f.make().run({ apply: true, ...(only ? { issue: 100 } : {}) }).holds, []);
    assert.ok(f.page().includes(hand));
    assert.equal(f.posts().length + f.edits().length, 0);
    assert.equal(f.parent().page_archive, undefined);
    assert.equal((f.parent().attention || []).some(entry => entry.code === 'ARCHIVE_SECTION_UNSAFE'), false);
    assert.ok(state.findStateBlock(f.page()).block);
    assert.doesNotMatch(state.findStateBlock(f.page(), 'CONTEXT').block.body, /Archived notes|## Archive/);
  }
});

test('an interrupted graph body readback keeps verified parts reachable and settles their registry', () => {
  const f = archiveFixture();
  let landed = false, stopped = false;
  f.github.intercept(call => {
    if (call.method === 'PATCH' && /issues\/12$/.test(call.path)) landed = true;
    if (landed && !stopped && call.method === 'GET' && /issues\/12$/.test(call.path)) {
      stopped = true; throw Object.assign(new Error('Interrupted readback'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  const id = f.parent().page_archive[0].comment_id;
  assert.equal(f.parent().page_archive[0].state, 'pending');
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.parent().page_archive[0].state, 'moved');
  assert.ok(f.page().includes(`#issuecomment-${id}`));
});

test('a graph comment changed during body-intent bookkeeping cannot hide its rows', () => {
  const f = archiveFixture(), hand = f.page();
  let changed = false;
  f.github.intercept(call => {
    if (!changed && call.method === 'PUT' && call.body?.content) {
      const doc = JSON.parse(Buffer.from(call.body.content, 'base64').toString());
      if (doc.pending_effects?.some(effect => effect.kind === 'replace_block') && doc.page_archive?.[0]?.comment_id) {
        changed = true; f.github.comments.get(doc.page_archive[0].comment_id).body += 'Concurrent change.';
      }
    }
  });
  const report = f.make().run({ apply: true });
  assert.ok(report.holds.some(entry => entry.code === 'EFFECT_UNKNOWN'));
  assert.equal(f.page(), hand);
  assert.equal(f.parent().page_archive[0].state, 'pending');
  assert.equal(f.github.calls.some(call => call.method === 'PATCH' && /issues\/12$/.test(call.path)), false);
});

test('graph archive parts stay below the hard limit and preserve graph row order', () => {
  const archive = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-page-archive.cjs'));
  const rows = Array.from({ length: 1000 }, (_, i) => ({ group: 'RETIRED', text: `|Task ${i}|${'x'.repeat(140)}|#${1000 + i}|-|-|RETIRED|-|` }));
  const parts = archive.graphComments(rows);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.body.length < 60000));
  assert.deepEqual(parts.flatMap(part => part.body.split('\n').filter(line => /^\|Task /.test(line))), rows.map(row => row.text));
});

test('the shared post budget spends graph archives before trace pages', () => {
  const f = pageFixture(state, { count: 180, hand: '# Programme\n\n' + 'Notes. '.repeat(6600) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 5);
  assert.ok(f.posts().every(post => post.body.body.startsWith('<!-- programme-page-archive key=graph-')));
  const before = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(f.posts().length - before <= 5);
  assert.ok(f.posts().slice(before).some(post => post.body.body.includes('decision-trace-index')));
});

test('a repair notice waits with its intent when archives spend all five comment slots', () => {
  const f = pageFixture(state, { count: 180, hand: '# Programme\n\n' + 'Notes. '.repeat(6600) });
  Object.assign(f.binding, { schema: state.SCHEMA.bindingV2, governance: 'enabled', parent_lifecycle: { reopen_incomplete: true, complete_when_children_closed: false } });
  const parent = f.github.issues.get(12);
  parent.state = 'closed'; parent.closed_at = f.NOW;
  parent.events = [{ id: 9, event: 'closed', actor: { login: 'owner' }, created_at: f.NOW }];
  const first = f.make().run({ apply: true });
  assert.equal(f.posts().length, 5);
  assert.equal(parent.state, 'open');
  assert.ok(first.holds.length);
  assert.ok(f.parent().pending_effects.some(effect => effect.kind === 'post_parent_repair'));
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 7, 'five graph parts, then one trace page and the owed repair notice');
  assert.match(f.posts().at(-1).body.body, /toolkit-parent-repair:12:9/);
  assert.deepEqual(f.parent().pending_effects, []);
});

test('missing graph archives repost only under a new verified id', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const first = f.parent().page_archive[0];
  const previousEdits = f.edits().length;
  f.github.comments.delete(first.comment_id);
  const report = f.make().run({ apply: true });
  assert.deepEqual(report.holds, []);
  const current = f.parent().page_archive.find(entry => entry.key === first.key);
  assert.notEqual(current.comment_id, first.comment_id);
  assert.equal(current.state, 'moved');
  assert.match(f.page(), new RegExp(`#issuecomment-${current.comment_id}`));
  assert.ok(f.edits().slice(previousEdits).every(call => !call.path.endsWith(`/${first.comment_id}`)), 'the missing id is never edited');
});

test('archive registry, effect targets and new diagnostics are closed in runtime and schema', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  const doc = f.parent(), digest = state.contentDigest(doc);
  const without = structuredClone(doc); delete without.page_archive;
  assert.equal(state.contentDigest(without), digest);
  assert.equal(state.sameState(without, doc), false);
  assert.deepEqual(state.publicView('parent', doc).page_archive, doc.page_archive);
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  const target = { issue: 12, key: doc.page_archive[0].key, comment_id: doc.page_archive[0].comment_id, login: 'owner', before: 'a'.repeat(64), digest: 'b'.repeat(64) };
  for (const kind of ['post_archive_comment', 'edit_archive_comment']) {
    const valid = structuredClone(doc);
    valid.pending_effects = [{ intent_id: 'archive-intent', kind, state: 'IN_FLIGHT', target: { ...target, ...(kind === 'post_archive_comment' ? { before: null, comment_id: null } : {}) } }];
    assert.deepEqual(state.validateParent(valid), []); assert.equal(validate(valid), true, JSON.stringify(validate.errors));
    for (const change of [value => { value.pending_effects[0].target.extra = 'text'; }, value => { value.pending_effects[0].target.digest = 'wrong'; }, value => { value.pending_effects[0].target.key = `section-${'a'.repeat(16)}-1`; }]) {
      const bad = structuredClone(valid); change(bad);
      assert.ok(state.validateParent(bad).length); assert.equal(validate(bad), false);
    }
  }
  for (const change of [value => { value.page_archive[0].extra = true; }, value => { value.page_archive[0].digest = 'bad'; }, value => { value.page_archive[0].state = 'done'; }, value => { value.page_archive[0].kind = 'other'; },
    value => { value.page_archive[0].kind = 'section'; value.page_archive[0].key = `section-${'a'.repeat(16)}-1`; value.page_archive[0].group = null; },
    value => { value.page_archive[0].source_digest = null; }, value => { value.page_archive[0].missing = false; },
    value => { value.page_archive[0].group = 'NOW'; }]) {
    const bad = structuredClone(doc); change(bad);
    assert.ok(state.validateParent(bad).length); assert.equal(validate(bad), false);
  }
});

test('B-T12: archive comments remain untagged and every decision stays reachable', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  f.github.addComment(12, { body: 'Delivery\n---\nTEST-1\nA decision.' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.length, 1, 'the graph part is reachable through the trace');
  const audit = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs')).auditDecisionTraces({ body: f.page(), comments: f.github.commentsOf(12), recordPrefix: 'TEST-', repository: f.github.repository, issue: 12 });
  assert.deepEqual(audit.unlinked_decisions, []);
  assert.match(state.findStateBlock(f.page(), 'TRACE').block.body, /Other comments/);
});

test('archived quotations cannot introduce decision records, supersession or trace indexes', () => {
  const auditModule = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs'));
  const quoted = `<!-- programme-page-archive key=graph-retired-1 -->\n# Programme graph: RETIRED\n\nTEST-2\nSUPERSEDES=TEST-1\nSUPERSEDES=TEST-999\n`;
  const direct = auditModule.auditDecisionTraces({ body: '[one](#issuecomment-1) [two](#issuecomment-2)', comments: [
    { id: 1, body: 'Delivery\n---\nTEST-1\nDecision.', user: { login: 'owner' } },
    { id: 2, body: quoted, user: { login: 'owner' } },
  ], recordPrefix: 'TEST-', repository: 'example.test/app', issue: 12 });
  assert.deepEqual(direct.unknown_supersedes, [], 'quoted text must not create a new supersession instruction');
  assert.deepEqual(direct.superseded_unmarked, []);
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  f.github.addComment(12, { body: quoted + '<!-- decision-trace-index -->\n' });
  const original = f.github.addComment(12, { body: 'Delivery\n---\nTEST-1\nA real decision.' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.length, 1);
  const comments = f.github.commentsOf(12);
  const audit = auditModule.auditDecisionTraces({ body: f.page(), comments, recordPrefix: 'TEST-', repository: f.github.repository, issue: 12 });
  assert.deepEqual(audit.unlinked_decisions, []);
  assert.deepEqual(audit.unknown_supersedes, []);
  assert.deepEqual(audit.superseded_unmarked, []);
  assert.doesNotMatch(state.findStateBlock(f.page(), 'TRACE').block.body, /replaced by/);
  const history = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-history.cjs')).entriesFromComments(12, comments, { repo: f.github.repository, prefix: 'TEST-' });
  const moved = history.entries.find(entry => entry.id !== String(original));
  assert.equal(moved.tag, null); assert.equal(moved.record, null); assert.deepEqual(moved.supersedes, []);
  // Plain user comments remain decisions; only the complete generated quote header is exempt.
  const plain = auditModule.auditDecisionTraces({ body: '', comments: [{ id: 1, body: 'TEST-3\nA real unlinked record.', user: { login: 'owner' } }], recordPrefix: 'TEST-', repository: f.github.repository, issue: 12 });
  assert.equal(plain.unlinked_decisions.length, 1);
});

test('B-T4: graph archives re-sort on reopen, empty parts stay registered and are reused', t => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const first = f.parent().page_archive.find(entry => entry.kind === 'graph');
  assert.ok(first);
  const id = first.comment_id;
  const beforePosts = f.posts().length;
  assert.ok(f.page().length < 55000);
  for (const outcome of f.parent().outcomes) {
    const saved = f.store.read('child', outcome.issue).doc;
    const rowCount = [...f.github.comments.values()].filter(comment => comment.issue === 12).reduce((count, comment) => count + Number(new RegExp(`^\\|[^\\n]*\\|#${outcome.issue}\\|`, 'm').test(comment.body)), 0)
      + Number(new RegExp(`^\\|[^\\n]*\\|#${outcome.issue}\\|`, 'm').test(f.page()));
    assert.equal(rowCount, 1, `one location for ${outcome.issue}, ${saved.lifecycle}`);
  }
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
  // Remove the unmarked padding as an owner edit. Every row returns; the empty comment remains.
  f.github.issues.get(12).body = f.page().replace('Notes. '.repeat(5700), 'Short notes.');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive.find(entry => entry.key === first.key).comment_id, id);
  assert.match(f.github.comments.get(id).body, /No rows are archived/);
  assert.doesNotMatch(f.page(), /Archived: \[/);
  f.github.issues.get(12).body = f.page().replace('Short notes.', 'Notes. '.repeat(5700));
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, beforePosts);
  assert.ok(f.github.comments.get(id).body.includes('|#'));
  const archivedIssue = Number(/\|#(\d+)\|/.exec(f.github.comments.get(id).body)[1]);
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.outcomes.find(outcome => outcome.issue === archivedIssue).class = 'COMMITTED'; return doc; } });
  f.store.mutate('child', archivedIssue, { writer: f.writer, parentDoc: f.parent(), change: doc => { doc.lifecycle = 'ACTIVE'; delete doc.completed_at; return doc; } });
  f.github.issues.get(archivedIssue).state = 'open'; f.github.issues.get(archivedIssue).closed_at = null;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.match(f.page(), new RegExp(`^\\|[^\\n]*\\|#${archivedIssue}\\|`, 'm'));
  assert.doesNotMatch(f.github.comments.get(id).body, new RegExp(`\\|#${archivedIssue}\\|`));
  t.diagnostic(JSON.stringify({ fixture: '84 rows applied', body: f.page().length, posts: f.posts().length, edits: f.edits().length }));
});

test('large overflow respects graph group order, five posts and reaches a stable redraw', t => {
  const f = pageFixture(state, { count: 180, width: 100, hand: '# Programme\n\n' + 'Notes. '.repeat(6600) });
  const start = f.github.calls.length;
  const r = f.make(), plan = r.plan();
  const planning = f.github.calls.length - start, applyAt = f.github.calls.length;
  const report = r.apply(plan);
  const applyRequests = f.github.calls.length - applyAt;
  assert.deepEqual(report.holds, []);
  assert.ok(f.page().length < 55000);
  assert.ok(f.posts().length <= 5);
  const archive = f.parent().page_archive;
  const moved = archive.map(entry => [entry.group, (f.github.comments.get(entry.comment_id).body.match(/^\|[^\n]*\|#\d+\|/gm) || []).length]);
  assert.deepEqual(moved.map(([group]) => group), ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'].slice(0, moved.length));
  assert.equal(moved.reduce((sum, [, count]) => sum + count, 0) + (f.page().match(/^\|[^\n]*\|#\d+\|/gm) || []).length, 180);
  for (const entry of archive) {
    const ids = (f.github.comments.get(entry.comment_id).body.match(/\|#\d+\|/g) || []).map(cell => Number(cell.slice(2, -1)));
    const eligible = f.parent().outcomes.filter(outcome => ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'][(outcome.issue - 100) % 5] === entry.group).map(outcome => outcome.issue).sort((a, b) => a - b);
    assert.deepEqual([...ids].sort((a, b) => a - b), eligible.slice(0, ids.length), `${entry.group}: oldest eligible rows move first`);
    const graphOrder = state.renderParentBlockBody(f.parent(), f.children, f.issues).split('\n').filter(line => /^\|[^\n]*\|#\d+\|/.test(line)).map(line => Number(line.split('|')[3].slice(1)));
    assert.deepEqual(ids, graphOrder.filter(id => ids.includes(id)), `${entry.group}: archive keeps graph sort`);
  }
  t.diagnostic(JSON.stringify({ fixture: 'large overflow', moved, posts: f.posts().length, body: f.page().length, planning_requests: planning, apply_requests: applyRequests }));
  // The first pass used all five posts on graph groups. The next pass can page their new trace
  // links, returning the now-unnecessary row prefix to the body; then it must settle completely.
  const posts = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(f.posts().length - posts <= 5);
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
});

test('archive post recovery finds a lost successful response without a second post', () => {
  const f = archiveFixture();
  let lost = false;
  f.github.intercept(call => {
    if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
      lost = true; f.github.route(call.method, call.path, call.body);
      throw Object.assign(new Error('Lost response'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  assert.equal(f.parent().pending_effects[0].kind, 'post_archive_comment');
  assert.equal(state.findStateBlock(f.page()).block, null);
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 1);
  assert.equal(f.parent().page_archive[0].state, 'moved');
  assert.deepEqual(f.parent().pending_effects, []);
});

test('archive edit recovery distinguishes exact DONE, NOT_DONE and detached owner edits', () => {
  for (const outcome of ['DONE', 'NOT_DONE', 'UNKNOWN']) {
    const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
    f.github.intercept(call => call.method === 'PATCH' && /issues\/12$/.test(call.path) ? { status: 409, json: {} } : undefined);
    assert.ok(f.make().run({ apply: true }).holds.length);
    assert.equal(f.parent().page_archive[0].state, 'pending');
    f.github.hooks = [];
    f.github.issues.get(12).body = f.page().replace('Notes. '.repeat(5700), 'Short notes.');
    let stopped = false;
    f.github.intercept(call => {
      if (!stopped && call.method === 'PATCH' && /issues\/comments\//.test(call.path)) {
        stopped = true;
        if (outcome === 'DONE') f.github.route(call.method, call.path, call.body);
        if (outcome === 'UNKNOWN') f.github.comments.get(f.parent().page_archive[0].comment_id).body += 'Unexpected edit.';
        throw Object.assign(new Error('Interrupted edit'), { code: 'PASS_LOCK_LOST' });
      }
    });
    assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
    f.github.hooks = [];
    const plan = f.make().plan();
    assert.equal(plan.resolutions.find(entry => entry.archive || entry.untrusted || entry.outcome === outcome)?.outcome, outcome === 'UNKNOWN' ? 'NOT_DONE' : outcome);
    if (outcome === 'UNKNOWN') {
      assert.deepEqual(f.make().apply(plan).holds, []);
      assert.equal(f.posts().length, 2, 'unlinked pending source gets a fresh verified comment');
      assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'));
      assert.ok(state.findStateBlock(f.page()).block);
    } else {
      assert.deepEqual(f.make().apply(plan).holds, []);
      assert.equal(f.posts().length, 1);
    }
  }
});

test('single-issue passes never post or edit archive comments and keep hand-written text', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true, issue: 100 }).holds, []);
  assert.equal(f.posts().length + f.edits().length, 0);
  assert.ok(f.page().includes('Notes. '.repeat(5700)));
  assert.equal(state.findStateBlock(f.page(), 'CONTEXT').block.body.includes('Archived notes:'), false);
});

for (const mode of ['checkbox', 'typo', 'edit', 'missing', 'viewer', 'foreign']) {
  test(`H2: ${mode} graph comment detaches and redraws with a fresh verified part`, () => {
    const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const first = f.parent().page_archive.find(entry => entry.kind === 'graph'), id = first.comment_id;
    if (mode === 'missing') f.github.comments.delete(id);
    else if (mode === 'viewer') f.github.login = 'another-user';
    else if (mode === 'foreign') f.github.comments.get(id).login = 'another-user';
    else f.github.comments.get(id).body += mode === 'checkbox' ? '\n- [x] Checked by owner.' : mode === 'typo' ? '\nTypo fixed.' : '\nOwner comment edit.';
    const old = f.github.comments.get(id)?.body, before = f.posts().length, edits = f.edits().length;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const next = f.parent().page_archive.find(entry => entry.key === first.key);
    if (mode === 'viewer') {
      assert.equal(next.comment_id, id);
      assert.equal(f.posts().length, before);
      assert.equal(f.edits().length, edits);
      assert.equal(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'), false);
      assert.equal(f.make().run({ apply: true }).summary, 'No changes');
      return;
    }
    assert.notEqual(next.comment_id, id);
    assert.ok(next.untrusted_ids?.includes(id));
    assert.ok(f.posts().length > before && f.posts().length - before <= 5);
    assert.ok(f.edits().slice(edits).every(call => !call.path.endsWith(`/${id}`)));
    assert.equal(f.github.comments.get(id)?.body, old);
    assert.ok(f.page().includes(`#issuecomment-${next.comment_id}`));
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED' && entry.state === 'new'));
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED' && entry.state === 'new'));
  });
}

test('H2/L10: lost-reply duplicate markers select the lowest exact verified id', () => {
  const f = archiveFixture();
  let lost = false;
  f.github.intercept(call => {
    if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
      lost = true; f.github.route(call.method, call.path, call.body);
      f.github.addComment(12, { body: call.body.body });
      f.github.addComment(12, { body: call.body.body + 'Different content.' });
      throw Object.assign(new Error('Lost reply, duplicate already visible'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive[0].comment_id, Math.min(...f.github.comments.keys()));
  assert.equal(f.posts().length, 1);
  assert.equal(f.edits().length, 0);
  assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'));
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
});

test('H2: detached registry and attention diagnostics fail closed in runtime and schema', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const id = f.parent().page_archive[0].comment_id;
  f.github.comments.delete(id);
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const doc = f.parent();
  assert.notEqual(doc.page_archive[0].comment_id, id);
  assert.ok(doc.page_archive[0].untrusted_ids.includes(id));
  const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
  const formatted = cli.formatReport({ store: f.binding.store, repository: f.binding.repository, parent_issue: 12, mode: 'preview', summary: 'Archive recovery', effects: [], recovered: [], holds: [], close_list: [], findings: [{ code: 'ARCHIVE_COMMENT_UNTRUSTED', issue: 12, detail: 'Inspect the missing comment', diagnostics: { reason: 'missing' } }] });
  assert.match(formatted, /Archive comment: missing/);
  assert.doesNotMatch(formatted, /Archive markup: missing/);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  assert.deepEqual(state.validateParent(doc), []);
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  for (const change of [value => { value.page_archive[0].untrusted_ids = [null]; }, value => { value.page_archive[0].untrusted_ids = [id, id]; }, value => { value.page_archive[0].missing = 'yes'; },
    value => { value.attention.find(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED').diagnostics.reason = 'owner text'; },
    value => { value.attention.find(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED').diagnostics.extra = 'text'; }]) {
    const bad = structuredClone(doc); change(bad);
    assert.ok(state.validateParent(bad).length);
    assert.equal(validate(bad), false);
  }
});

test('H2: lost-reply comments edited or transferred before registration cannot hold the page', () => {
  for (const mode of ['changed', 'foreign']) {
    const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
    let lost = false;
    f.github.intercept(call => {
      if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
        lost = true; f.github.route(call.method, call.path, call.body);
        throw Object.assign(new Error('Lost reply'), { code: 'PASS_LOCK_LOST' });
      }
    });
    assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
    f.github.hooks = [];
    const id = [...f.github.comments.keys()][0];
    if (mode === 'changed') f.github.comments.get(id).body += 'Owner edit.';
    else f.github.comments.get(id).login = 'another-user';
    const retained = f.github.comments.get(id).body;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.edits().length, 0);
    assert.equal(f.posts().length, 2);
    assert.equal(f.github.comments.get(id).body, retained);
    assert.ok(f.parent().page_archive[0].untrusted_ids?.includes(id));
    assert.notEqual(f.parent().page_archive[0].comment_id, id);
    assert.ok(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'));
  }
});

test('H2: graph replacements share five posts with the owed repair notice', () => {
  const f = pageFixture(state, { count: 180, hand: '# Programme\n\n' + 'Notes. '.repeat(6600) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, 5);
  for (const entry of f.parent().page_archive) f.github.comments.get(entry.comment_id).body += '\nOwner edit.';
  Object.assign(f.binding, { schema: state.SCHEMA.bindingV2, governance: 'enabled', parent_lifecycle: { reopen_incomplete: true, complete_when_children_closed: false } });
  const issue = f.github.issues.get(12);
  issue.state = 'closed'; issue.closed_at = f.NOW;
  issue.events = [{ id: 9, event: 'closed', actor: { login: 'owner' }, created_at: f.NOW }];
  const before = f.posts().length;
  f.make().run({ apply: true });
  assert.equal(f.posts().length - before, 5);
  assert.ok(f.parent().pending_effects.some(effect => effect.kind === 'post_parent_repair'));
  assert.ok(state.findStateBlock(f.page()).block);
  const second = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(f.posts().length - second <= 5);
  assert.ok(f.posts().some(call => call.body.body.includes('toolkit-parent-repair:12:9')));
});


for (const several of [false, true]) test(`N1: six alternating logins retain verified read-only parts, several=${several}`, () => {
  const padding = 'Notes. '.repeat(several ? 6100 : 5700);
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + padding });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const initial = f.parent().page_archive;
  assert.equal(initial.filter(entry => entry.kind === 'graph').length, several ? 2 : 1);
  assert.ok(f.posts().length <= 5);
  const count = f.github.comments.size, posts = f.posts().length, edits = f.edits().length;
  for (let pass = 0; pass < 6; pass++) {
    f.github.login = pass % 2 ? 'owner' : 'second-login';
    const start = f.github.calls.length;
    const plan = f.make().run();
    assert.equal(plan.effects.some(effect => effect.kind === 'replace_block' && effect.target.issue === 12), false);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(f.github.comments.size, count);
    assert.equal(f.posts().length, posts);
    assert.equal(f.edits().length, edits);
    assert.deepEqual(f.parent().page_archive, initial);
    assert.ok(initial.every(entry => f.page().includes(`#issuecomment-${entry.comment_id}`)));
    assert.equal(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'), false);
    assert.ok(f.parent().page_archive.every(entry => (entry.untrusted_ids || []).length <= 32));
    assert.equal(f.github.calls.slice(start).filter(call => call.method === 'POST' && /issues\/12\/comments$/.test(call.path)).length, 0);
  }
  // A genuine graph change under the other login posts fresh content without editing
  // any recorded owner's comment. Every pass stays <=5.
  f.github.login = 'second-login';
  f.github.issues.get(12).body = f.page().replace(padding, 'Short notes.');
  const before = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(f.posts().length > before && f.posts().length - before <= 5);
  assert.equal(f.edits().length, edits);
  assert.equal(f.parent().attention.some(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED'), false, 'a legitimate content change is not a trust failure');
  for (const entry of initial) assert.equal(f.github.comments.get(entry.comment_id).login, 'owner');
});


function lostGraph() {
  const f = archiveFixture();
  let lost = false;
  f.github.intercept(call => {
    if (!lost && call.method === 'POST' && /issues\/12\/comments$/.test(call.path)) {
      lost = true; f.github.route(call.method, call.path, call.body);
      throw Object.assign(new Error('Lost successful reply'), { code: 'PASS_LOCK_LOST' });
    }
  });
  assert.throws(() => f.make().run({ apply: true }), { code: 'PASS_LOCK_LOST' });
  f.github.hooks = [];
  return f;
}

for (const route of ['apply', 'recovery']) test(`L3: ${route} never adopts an exact but previously rejected id`, () => {
  const f = lostGraph(), id = [...f.github.comments.keys()][0];
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => {
    doc.page_archive[0].untrusted_ids = [id];
    if (route === 'apply') doc.pending_effects = [];
    return doc;
  } });
  const r = f.make(), plan = r.plan();
  if (route === 'recovery') {
    const resolution = plan.resolutions.find(entry => entry.intent_id === f.parent().pending_effects[0].intent_id);
    assert.equal(resolution.outcome, 'NOT_DONE');
    assert.equal(resolution.archive, undefined);
  }
  assert.deepEqual(r.apply(plan).holds, []);
  assert.notEqual(f.parent().page_archive[0].comment_id, id);
  assert.equal(f.posts().length, 2);
  assert.equal(f.edits().length, 0);
});

test('L3: apply adoption picks the lowest exact duplicate without pending-intent recovery', () => {
  const f = lostGraph(), id = [...f.github.comments.keys()][0];
  const higher = f.github.addComment(12, { body: f.github.comments.get(id).body, type: 'Bot' });
  assert.ok(higher > id);
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.pending_effects = []; return doc; } });
  const r = f.make(), plan = r.plan();
  assert.deepEqual(plan.resolutions, []);
  assert.deepEqual(r.apply(plan).holds, []);
  assert.equal(f.parent().page_archive[0].comment_id, id);
  assert.ok(f.parent().page_archive[0].untrusted_ids.includes(higher));
  assert.equal(f.posts().length, 1);
  assert.equal(f.edits().length, 0);
});

test('L3: trust cannot edit a rejected id even after its exact bytes are restored', () => {
  const padding = 'Notes. '.repeat(5700);
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + padding });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const graph = f.parent().page_archive.find(entry => entry.kind === 'graph'), id = graph.comment_id;
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.page_archive.find(entry => entry.key === graph.key).untrusted_ids = [id]; return doc; } });
  const retained = f.github.comments.get(id).body, before = f.posts().length, edits = f.edits().length;
  f.github.issues.get(12).body = f.page().replace(padding, 'Short notes.');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.notEqual(f.parent().page_archive.find(entry => entry.key === graph.key).comment_id, id);
  assert.equal(f.posts().length, before + 1);
  assert.equal(f.edits().length, edits);
  assert.equal(f.github.comments.get(id).body, retained);
});

test('N1: rejection compaction bounds ids and permanently excludes dropped restored candidates', () => {
  const f = archiveFixture();
  const text = f.project().archive[0].body;
  const ids = Array.from({ length: 40 }, () => f.github.addComment(12, { body: text + 'Untrusted change.', type: 'Bot' }));
  f.github.intercept(call => call.method === 'PATCH' && /issues\/12$/.test(call.path) ? { status: 409, json: {} } : undefined);
  assert.ok(f.make().run({ apply: true }).holds.length);
  const entry = f.parent().page_archive[0], id = entry.comment_id;
  assert.equal(entry.untrusted_ids.length, 32);
  assert.equal(entry.untrusted_before, ids[7]);
  assert.equal(entry.untrusted_ids.includes(ids[0]), false);
  f.github.comments.get(ids[0]).body = text;
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.page_archive[0].comment_id = null; doc.page_archive[0].login = null; return doc; } });
  f.github.hooks = [];
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive[0].comment_id, id, 'a dropped id is still forbidden after exact bytes return');
  assert.equal(f.posts().length, 1);
  assert.equal(f.edits().length, 0);
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'))));
  for (const floor of [0, -1, 1.5, '1', null]) {
    const bad = f.parent(); bad.page_archive[0].untrusted_before = floor;
    assert.ok(state.validateParent(bad).length);
    assert.equal(validate(bad), false);
  }
  assert.deepEqual(state.validateParent(f.parent()), []);
  assert.equal(validate(f.parent()), true);
});


test('N1: compaction preserves an exact registered duplicate below the floor and pins it on rejection', () => {
  const f = lostGraph(), id = [...f.github.comments.keys()][0], body = f.github.comments.get(id).body;
  for (let i = 0; i < 40; i++) f.github.addComment(12, { body, type: 'Bot' });
  f.store.mutate('parent', 12, { writer: f.writer, change: doc => { doc.pending_effects = []; return doc; } });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  let entry = f.parent().page_archive[0];
  assert.equal(entry.comment_id, id);
  assert.ok(entry.untrusted_before > id);
  assert.equal(entry.untrusted_ids.length, 32);
  assert.equal(entry.untrusted_ids.includes(id), false);
  assert.equal(f.posts().length, 1);
  f.github.login = 'second-login';
  const before = f.posts().length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.posts().length, before);
  assert.equal(f.parent().page_archive[0].comment_id, id);
  f.github.comments.get(id).body += 'Owner edit.';
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  entry = f.parent().page_archive[0];
  assert.equal(entry.untrusted_ids.length, 32);
  assert.ok(entry.untrusted_ids.includes(id), 'a rejected registered id cannot use the verified-id exception');
  assert.equal(f.posts().length, before + 1);
  assert.equal(f.edits().length, 0);
});
