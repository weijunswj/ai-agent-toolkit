'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { SweepGitHub } = require('./support/programme-sweep-github.cjs');
const writer = { session: 'fixture-controller', prefix: 'TEST-' };
function fixture() {
  const github = new SweepGitHub();
  const store = new state.StateStore({ transport: github, store: { repository: github.storeRepository, branch: 'main', path: 'state/' }, now: () => new Date(github.clock).toISOString() });
  const outcomes = [12, 13].map((issue, i) => ({ issue, parent: 7, order: i + 1, class: 'COMMITTED' }));
  store.write('parent', 7, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 7, outcomes }), writer), { sha: null, previous: null });
  for (const outcome of outcomes) store.write('child', outcome.issue, state.newChild({ repository: github.repository, outcome }), { sha: null, previous: null });
  const changes = outcomes.map(outcome => { const before = store.read('child', outcome.issue); return { kind: 'child', number: outcome.issue, previous: before.doc, sha: before.sha, next: { ...before.doc, next_action: 'Check the saved result' } }; });
  return { github, store, changes };
}
for (const mode of ['ordinary', 'one ref race', 'two ref races', 'document race']) test(`batch CAS: ${mode} / I3`, () => {
  const f = fixture(); assert.equal(typeof f.store.writeBatch, 'function');
  f.github.writeRaw(f.github.storeRepository, 'main', 'unrelated.txt', 'keep me');
  let moves = 0;
  f.github.intercept(call => {
    if (call.method === 'PATCH' && call.path.includes('/git/refs/') && moves < (mode === 'two ref races' ? 2 : mode === 'one ref race' ? 1 : 0)) {
      f.github.writeRaw(f.github.storeRepository, 'main', 'other.txt', String(++moves));
    }
  });
  if (mode === 'document race') {
    const doc = f.store.read('child', 12).doc; doc.revision++; doc.next_action = 'Keep the controller change';
    f.github.writeRaw(f.github.storeRepository, 'main', 'state/issue-12.json', state.canonicalText(doc));
  }
  const before = f.github.head(f.github.storeRepository, 'main');
  if (mode === 'two ref races') { assert.throws(() => f.store.writeBatch(f.changes, { writer, parentNumber: 7 }), { code: 'STATE_CONFLICT' }); return; }
  const result = f.store.writeBatch(f.changes, { writer, parentNumber: 7 });
  assert.notEqual(result.head, before);
  assert.equal(f.github.textAt(f.github.storeRepository, 'main', 'unrelated.txt'), 'keep me');
  assert.deepEqual(result.conflicts, mode === 'document race' ? [12] : []);
  assert.equal(f.store.read('child', 13).doc.next_action, 'Check the saved result');
  if (mode === 'document race') assert.equal(f.store.read('child', 12).doc.next_action, 'Keep the controller change');
  const commits = f.github.calls.filter(call => call.method === 'POST' && call.path.endsWith('/git/commits'));
  assert.equal(commits.length, mode === 'one ref race' ? 2 : 1);
  for (const call of f.github.calls.filter(call => call.method === 'PATCH' && call.path.includes('/git/refs/'))) assert.equal(call.body.force, false);
});

test('batch CAS checks the live parent fence before any tree write', () => {
  const f = fixture(); assert.equal(typeof f.store.writeBatch, 'function');
  const doc = f.store.read('parent', 7).doc; doc.fence.holder_session = 'new-controller'; doc.fence.epoch++;
  f.github.writeRaw(f.github.storeRepository, 'main', 'state/parent-7.json', state.canonicalText(doc));
  const start = f.github.calls.length;
  assert.throws(() => f.store.writeBatch(f.changes, { writer, parentNumber: 7 }), { code: 'STALE_WRITER' });
  assert.equal(f.github.calls.slice(start).some(call => call.method !== 'GET' && call.path !== 'graphql'), false);
});

test('batch CAS refuses a snapshot document without its version token before writing', () => {
  const f = fixture();
  f.github.intercept(call => {
    if (call.path !== 'graphql' || !call.body.query.includes('sweepStateSnapshot')) return;
    const response = f.github.route(call.method, call.path, call.body);
    delete response.json.data.repository.snapshot.entries.find(entry => entry.name === 'issue-12.json').oid;
    return response;
  });
  const before = f.github.calls.length;
  assert.throws(() => f.store.writeBatch(f.changes, { writer, parentNumber: 7 }), { code: 'STATE_TOKEN_MISSING' });
  assert.equal(f.github.calls.slice(before).some(call => call.method === 'POST' && call.path.endsWith('/git/trees')), false);
});

test('an accepted ref update without a reply is read back without replaying the state commit', () => {
  const f = fixture();
  let once = false;
  f.github.intercept(call => {
    if (!once && call.method === 'PATCH' && call.path.includes('/git/refs/')) {
      once = true;
      f.github.route(call.method, call.path, call.body);
      return { status: 500, json: { message: 'connection reset' } };
    }
  });
  assert.throws(() => f.store.writeBatch(f.changes, { writer, parentNumber: 7 }), { code: 'GH_FAILED' });
  for (const number of [12, 13]) assert.equal(f.store.read('child', number).doc.next_action, 'Check the saved result');
  const commits = () => f.github.calls.filter(call => call.method === 'POST' && call.path.endsWith('/git/commits')).length;
  assert.equal(commits(), 1);
  assert.deepEqual(f.store.writeBatch(f.changes, { writer, parentNumber: 7 }).conflicts, [12, 13]);
  assert.equal(commits(), 1, 'independent revision checks prevent a duplicate state commit');
});
