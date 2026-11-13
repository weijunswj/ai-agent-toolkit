'use strict';

// The state phase's one commit (closure rows R1 to R6 and R9): staged documents publish in one
// non-forced ref update from the snapshot head, a lost reply is settled by the branch head, a ref
// race re-runs the staged changes once, and a refused GraphQL falls back to REST reads.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = '2026-11-12T01:00:00.000Z';
const controller = { session: 'fixture-controller', prefix: 'TEST-' };
const isRef = call => call.method === 'PATCH' && call.path.includes('/git/refs/heads/');

function fixture() {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { repository: github.repository, store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' } };
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => NOW });
  const outcomes = [{ issue: 500, class: 'COMMITTED', parent: 421, order: 1 }, { issue: 501, class: 'COMMITTED', parent: 421, order: 2 }];
  store.write('parent', 421, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 421, outcomes }), controller), { sha: null, previous: null });
  for (const outcome of outcomes) store.write('child', outcome.issue, state.newChild({ repository: github.repository, outcome }), { sha: null, previous: null });
  const writer = state.refreshWriter(store.read('parent', 421).doc);
  // Stage one change on each child and the parent's queue, as a pass's state phase does.
  const stage = (s = store) => {
    const batch = new state.StateBatch(s, s.readSnapshot(), 421);
    for (const issue of [500, 501]) batch.mutate('child', issue, { writer, change: doc => { doc.next_action = `Checked ${issue}`; return doc; } });
    batch.mutate('parent', 421, { writer, change: doc => { doc.sweep = { queue: [501], failures: {} }; return doc; } });
    return batch;
  };
  const snapshotOf = () => ({ parent: store.read('parent', 421).doc, children: [500, 501].map(issue => store.read('child', issue).doc) });
  return { github, store, writer, stage, snapshotOf };
}

test('batch: one non-forced commit on the snapshot head publishes every staged document', () => {
  const f = fixture();
  const commits = f.github.commits;
  const batch = f.stage();
  const head = batch.snapshot.head;
  const result = f.store.commitBatch(batch);
  assert.equal(result.written.length, 3);
  assert.equal(f.github.commits, commits + 1, 'one commit for the whole state phase');
  const commit = f.github.calls.find(call => call.method === 'POST' && call.path.endsWith('/git/commits'));
  assert.deepEqual(commit.body.parents, [head]);
  assert.match(commit.body.message, /issue-500 r2.*issue-501 r2.*parent-421 r1|parent-421 r1.*issue-500 r2/);
  assert.ok(f.github.calls.filter(isRef).every(call => call.body.force === false));
  const after = f.snapshotOf();
  assert.deepEqual(after.children.map(doc => doc.next_action), ['Checked 500', 'Checked 501']);
  assert.deepEqual(after.parent.sweep, { queue: [501], failures: {} });
});

test('batch: crash before ref keeps the saved queue', () => {
  const f = fixture();
  const before = f.snapshotOf();
  f.github.intercept(call => { if (isRef(call)) throw Object.assign(new Error('fixture crash before the ref moved'), { code: 'PASS_LOCK_LOST' }); });
  assert.throws(() => f.store.commitBatch(f.stage()), { code: 'PASS_LOCK_LOST' });
  f.github.hooks = [];
  assert.deepEqual(f.snapshotOf(), before, 'nothing written: the tree and commit are dangling and harmless');
});

test('batch: accepted without reply continues once', () => {
  const f = fixture();
  let patches = 0;
  f.github.intercept(call => {
    if (!isRef(call)) return undefined;
    patches += 1;
    assert.equal(f.github.route(call.method, call.path, call.body).status, 200);
    return { status: 502, json: {} };
  });
  const result = f.store.commitBatch(f.stage());
  f.github.hooks = [];
  assert.equal(patches, 1, 'the branch head shows the commit landed, so it is not sent again');
  assert.equal(result.written.length, 3);
  assert.equal(f.snapshotOf().children[0].next_action, 'Checked 500');
});

test('batch: unknown ref outcome runs no effect', () => {
  const f = fixture();
  let landed = false;
  f.github.intercept(call => {
    if (isRef(call) && !landed) { landed = true; f.github.route(call.method, call.path, call.body); return { status: 502, json: {} }; }
    if (landed && call.method === 'GET' && call.path.includes('/branches/')) return { status: 502, json: {} };
    return undefined;
  });
  assert.throws(() => f.store.commitBatch(f.stage()), { code: 'GH_FAILED' });
});

test('batch: a lost reply with the old head still there is retried once, as its one retry', () => {
  const f = fixture();
  let patches = 0;
  f.github.intercept(call => { if (isRef(call) && ++patches === 1) return { status: 502, json: {} }; });
  assert.equal(f.store.commitBatch(f.stage()).written.length, 3);
  assert.equal(patches, 2);
});

test('batch: stale writer writes nothing', () => {
  const f = fixture();
  const batch = f.stage();
  // A takeover lands after the snapshot: the ref races, the re-run reads the new fence and refuses.
  const parent = f.store.read('parent', 421);
  f.store.write('parent', 421, state.claimDocument(parent.doc, { session: 'successor', prefix: 'TEST-' }, { takeover: true }), parent);
  const children = [500, 501].map(issue => f.store.read('child', issue).doc.next_action);
  assert.throws(() => f.store.commitBatch(batch), { code: 'STALE_WRITER' });
  assert.deepEqual([500, 501].map(issue => f.store.read('child', issue).doc.next_action), children);
});

test('batch: a document another writer changed is held alone; the rest commit', () => {
  const f = fixture();
  const batch = f.stage();
  const child = f.store.read('child', 500);
  f.store.write('child', 500, { ...child.doc, next_action: 'Controller note' }, child);
  f.store.commitBatch(batch);
  assert.equal(batch.dropped.get('child:500').code, 'STATE_CONFLICT');
  assert.equal(f.store.read('child', 500).doc.next_action, 'Controller note', 'the controller change is kept');
  assert.equal(f.store.read('child', 501).doc.next_action, 'Checked 501');
});

test('batch: two races keep the queue and the stop fact', () => {
  const f = fixture();
  const before = f.snapshotOf();
  f.github.intercept(call => (isRef(call) ? { status: 422, json: { message: 'Reference moved' } } : undefined));
  assert.throws(() => f.store.commitBatch(f.stage()), error => error.code === 'STATE_BRANCH_BUSY' && error.reason === 'state branch busy');
  f.github.hooks = [];
  assert.equal(f.github.calls.filter(isRef).length, 2, 'retried once on a fresh snapshot');
  assert.deepEqual(f.snapshotOf(), before, 'nothing written; the saved queue is unchanged');
});

test('batch: a snapshot entry without its version id is never staged', () => {
  const f = fixture();
  f.github.intercept(call => {
    if (call.path !== 'graphql' || !call.body.query.includes('stateSnapshot')) return undefined;
    const answer = f.github.route(call.method, call.path, call.body);
    delete answer.json.data.repository.snapshot.entries.find(entry => entry.name === 'issue-500.json').oid;
    return answer;
  });
  const batch = new state.StateBatch(f.store, f.store.readSnapshot(), 421);
  assert.throws(() => batch.mutate('child', 500, { writer: f.writer, change: doc => doc }), { code: 'STATE_TOKEN_MISSING' });
});

test('snapshot: REST fallback reads the same documents', () => {
  const f = fixture();
  const graph = f.store.readSnapshot();
  const calls = f.github.calls.length;
  f.github.intercept(call => (call.path === 'graphql' ? { status: 403, json: { message: 'refused' } } : undefined));
  const rest = f.store.readSnapshot();
  assert.equal(f.store.graphqlRefused, true);
  assert.equal(rest.mode, 'rest');
  const view = snapshot => [...snapshot.documents].map(([key, entry]) => [key, entry.sha, state.canonicalText(entry.doc)]).sort();
  assert.deepEqual(view(rest), view(graph));
  assert.ok(f.github.calls.slice(calls).some(call => /\/git\/blobs\//.test(call.path)), 'each document read as a blob');
  // The batch reads back by the ids GitHub returned for the created tree.
  const result = f.store.commitBatch(f.stage());
  assert.equal(result.written.length, 3);
  f.github.hooks = [];
  assert.equal(f.store.read('child', 500).doc.next_action, 'Checked 500');
});

test('snapshot: fallback over budget stops before writes', () => {
  const f = fixture();
  const transport = Object.assign(Object.create(f.github), { left: () => 3, reserve: 2 });
  transport.request = (...args) => (args[1] === 'graphql' ? { status: 502, json: {} } : f.github.request(...args));
  const store = new state.StateStore({ transport, store: f.store.store, now: () => NOW });
  assert.throws(() => store.readSnapshot(), error => error.code === 'PASS_STOPPED' && error.reason === 'GitHub GraphQL unavailable' && error.noWrite === true);
});

// The Contents API leaves out the text of a file over 1 MB (encoding "none", empty content).
function contentsWithoutText(f, file) {
  f.github.intercept(call => {
    if (call.method !== 'GET' || !call.path.includes(`/contents/${file}`)) return undefined;
    const answer = f.github.route(call.method, call.path, call.body);
    if (answer.status === 200) answer.json = { ...answer.json, encoding: 'none', content: '' };
    return answer;
  });
}

test('read: a document too large for the Contents API is read whole by its blob id', () => {
  const f = fixture();
  const small = f.store.read('child', 500);
  contentsWithoutText(f, 'state/issue-500.json');
  const calls = f.github.calls.length;
  const large = f.store.read('child', 500);
  assert.equal(large.sha, small.sha);
  assert.equal(state.canonicalText(large.doc), state.canonicalText(small.doc));
  assert.equal(f.github.calls.slice(calls).filter(call => /\/git\/blobs\//.test(call.path)).length, 1, 'one blob read');
});

test('read: a large document whose blob cannot be read stops with the failed read', () => {
  const f = fixture();
  contentsWithoutText(f, 'state/issue-500.json');
  f.github.intercept(call => (/\/git\/blobs\//.test(call.path) ? { status: 404, json: { message: 'Not Found' } } : undefined));
  assert.throws(() => f.store.read('child', 500), error => Boolean(error.code) && error.code !== 'STATE_INVALID');
});
