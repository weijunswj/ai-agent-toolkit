'use strict';

// Stored holder orders (#886 slice A2): the cloud sweep runs the holder orders a controller queued in
// the evidence store, inside its lease, with run-order's own rules, then files each result.
// Rows: order state (valid, dry run, expired, wrong holder, malformed, misnamed, a write refused,
// a passing GitHub failure, partly done) x sweep state (lease free, lease held by another sweep,
// computer refresh).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const orders = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-holder-order.cjs'));
const queue = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-order-queue.cjs'));
const { SweepLease } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep-lease.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const HOLDER = 'toolkit-421-projects-controller';
const controller = { session: HOLDER, prefix: 'TEST-' };
const CLOUD = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', SWEEP_LOGIN: 'example-bot', GITHUB_RUN_ID: '4242' };
const PENDING = 'state/orders/pending/';
const ADDED = state.findingId('reconcile', 'CHILD_ADDED', 500);

function fixture(t) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n' });
  const outcomes = [500, 501].map((issue, i) => ({ issue, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(NOW).toISOString() });
  const parent = state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 421, outcomes }), controller);
  parent.attention = [{ id: ADDED, source: 'reconcile', code: 'CHILD_ADDED', issue: 500, head: null, state: 'new', first_seen: '2026-11-14T10:00:00.000Z', changed_at: '2026-11-14T10:00:00.000Z' }];
  store.write('parent', 421, parent, { sha: null, previous: null });
  store.write('child', 500, state.newChild({ repository: github.repository, outcome: outcomes[0] }), { sha: null, previous: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentDoc = () => store.read('parent', 421).doc;
  const order = (extra = {}) => ({ schema: orders.SCHEMA, order_id: 'ack-500-1', parent_issue: 421, holder_session: HOLDER, epoch: parentDoc().fence.epoch,
    expires_at: new Date(NOW + 2 * 3600 * 1000).toISOString(), record: 'TEST-910', ops: [
      { command: 'ack', finding: ADDED, next: 'Confirm #500 in the catalogue today.' },
      { command: 'update', issue: 500, patch: { next_action: 'Controller: owner test after merge' } },
    ], ...extra });
  const enqueue = (name, body) => github.putFile(`${PENDING}${name}`, body);
  const enqueueText = (name, text) => {
    github.files.set(`${PENDING}${name}`, { text, sha: require('node:crypto').createHash('sha1').update(text).digest('hex') });
    github.commit();
  };
  const run = ({ cloud = true } = {}) => {
    let output = '';
    let error = null;
    let code = null;
    try {
      code = cli.main(['refresh', '--scheduled', '--json'], { transport: github, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
        toolkitVersion: '3.107.0', now: () => new Date(NOW).toISOString(), passClock: () => NOW, orderClock: () => NOW,
        lockFile: cloud ? null : path.join(dir, 'pass.lock'), environment: cloud ? CLOUD : {}, stdout: { write: text => { output += text; } } });
    } catch (thrown) { error = thrown; }
    let report = null;
    try { report = output ? JSON.parse(output.trim().split(/\n(?=\{)/).at(-1)) : null; } catch { report = null; }
    return { code, error, report };
  };
  const file = name => github.readFile(`state/orders/${name}`);
  const finding = () => parentDoc().attention?.find(entry => entry.id === ADDED);
  return { github, store, binding, parentDoc, order, enqueue, enqueueText, run, file, finding };
}

test('a queued order runs inside the cloud pass, as the holder, and is filed under done', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  assert.deepEqual(result.report.orders, { done: 1, refused: 0, pending: 0, results: [{ order_id: 'ack-500-1', mode: 'apply', outcome: 'DONE' }] });
  // Acknowledged by the order; the same pass then resolves it, since #500 is in the catalogue.
  assert.notEqual(f.finding().state, 'new');
  assert.deepEqual(f.file('done/ack-500-1.json').results.map(entry => entry.outcome), ['WRITTEN', 'WRITTEN']);
  assert.equal(f.store.read('child', 500).doc.next_action, 'Controller: owner test after merge');
  assert.equal(f.file('pending/ack-500-1.json'), null, 'the pending file is removed');
  const done = f.file('done/ack-500-1.json');
  assert.equal(done.schema, queue.RESULT_SCHEMA);
  assert.equal(done.outcome, 'DONE');
  assert.equal(done.run, '4242');
  assert.equal(done.order.order_id, 'ack-500-1');
  const log = f.parentDoc().private.holder_orders;
  assert.equal(log.length, 1);
  assert.equal(log[0].digest, done.digest);
  assert.ok(log[0].finished_at);
  assert.equal(f.parentDoc().fence.holder_session, HOLDER, 'the holder is unchanged');
});

test('a dry-run file rehearses the order and writes nothing to the programme', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.dry-run.json', f.order());
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.orders.results[0].mode, 'dry-run');
  assert.equal(result.report.orders.results[0].outcome, 'READY');
  assert.equal(f.finding().state, 'new');
  assert.equal(f.parentDoc().private.holder_orders, undefined);
  assert.equal(f.file('done/ack-500-1.dry-run.json').outcome, 'READY');
});

const refusals = [
  ['expired', f => f.enqueue('ack-500-1.json', f.order({ expires_at: new Date(NOW - 1000).toISOString() })), 'ORDER_EXPIRED'],
  ['for another holder', f => f.enqueue('ack-500-1.json', f.order({ holder_session: 'someone-else' })), 'ORDER_STALE'],
  ['for another epoch', f => f.enqueue('ack-500-1.json', f.order({ epoch: 99 })), 'ORDER_STALE'],
  ['for another parent', f => f.enqueue('ack-500-1.json', f.order({ parent_issue: 9 })), 'ORDER_INVALID'],
  ['with a forbidden write', f => f.enqueue('ack-500-1.json', f.order({ ops: [{ command: 'claim', issue: 500 }] })), 'ORDER_INVALID'],
  ['not JSON', f => f.enqueueText('ack-500-1.json', '{ nope'), 'ORDER_INVALID'],
  ['named after another id', f => f.enqueue('other-id.json', f.order()), 'ORDER_INVALID'],
];
for (const [name, put, code] of refusals) {
  test(`an order ${name} is refused, filed with its code and writes nothing`, t => {
    const f = fixture(t);
    put(f);
    const result = f.run();
    assert.equal(result.error, null, result.error?.message);
    const [row] = result.report.orders.results;
    assert.equal(row.outcome, 'REFUSED');
    assert.equal(row.code, code);
    assert.equal(result.report.orders.refused, 1);
    assert.equal(f.finding().state, 'new');
    assert.equal(f.parentDoc().private.holder_orders, undefined);
    const filed = f.github.calls.filter(call => call.method === 'PUT' && call.path.includes('/orders/refused/'));
    assert.equal(filed.length, 1);
    assert.equal([...f.github.files.keys()].filter(key => key.startsWith(PENDING)).length, 0);
  });
}

test('an order whose write is refused stops there, keeps the finished writes and is filed as stopped', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order({ ops: [
    { command: 'update', issue: 500, patch: { next_action: 'First write' } },
    { command: 'dispose', finding: 'abcdefabcdef', reason: 'No such finding.' },
  ] }));
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  const [row] = result.report.orders.results;
  assert.equal(row.outcome, 'STOPPED');
  assert.equal(f.store.read('child', 500).doc.next_action, 'First write');
  const filed = f.file('refused/ack-500-1.json');
  assert.equal(filed.outcome, 'STOPPED');
  assert.deepEqual(filed.results.map(entry => entry.outcome), ['WRITTEN', 'REFUSED']);
});

test('a passing GitHub failure leaves the order pending for the next run, which finishes it once', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const request = f.github.request.bind(f.github);
  // The order's first write (its ack, after the log entry) meets a 502 once.
  let parentPuts = 0;
  f.github.request = (method, endpoint, body, options) => {
    if (method === 'PUT' && endpoint.endsWith('/state/parent-421.json') && ++parentPuts === 2) return { status: 502, json: { message: 'Bad gateway' } };
    return request(method, endpoint, body, options);
  };
  const first = f.run();
  assert.equal(first.error, null, first.error?.message);
  assert.equal(first.report.orders.pending, 1);
  assert.match(first.report.orders.results[0].code, /^GH_/);
  assert.ok(f.file('pending/ack-500-1.json'), 'the order stays queued');
  assert.equal(f.file('done/ack-500-1.json'), null);
  const second = f.run();
  assert.equal(second.error, null, second.error?.message);
  assert.equal(f.file('pending/ack-500-1.json'), null);
  assert.equal(f.file('done/ack-500-1.json').outcome, 'DONE');
  assert.notEqual(f.finding().state, 'new');
  assert.equal(f.parentDoc().private.holder_orders.length, 1, 'one log entry: no write ran twice');
});

test('a partly done order queued again continues from its next write', t => {
  const f = fixture(t);
  const order = f.order();
  const partial = f.parentDoc();
  partial.private = { ...partial.private, holder_orders: [{ order_id: order.order_id, digest: orders.orderDigest(order), record: order.record, by: 'a'.repeat(16), started_at: new Date(NOW).toISOString(), done: [0], results: [] }] };
  f.store.write('parent', 421, partial, { sha: f.store.read('parent', 421).sha, previous: f.store.read('parent', 421).doc });
  f.enqueue('ack-500-1.json', order);
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  const done = f.file('done/ack-500-1.json');
  assert.deepEqual(done.results.map(entry => entry.outcome), ['DONE_EARLIER', 'WRITTEN']);
  assert.equal(f.finding().state, 'new', 'the write logged as done earlier is not run again');
});

test('while another sweep holds the lease, the order stays pending and nothing runs', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const other = new SweepLease({ store: f.store, repository: f.github.repository, host: 'computer', nowMs: () => NOW, endsBy: NOW + 50 * 60 * 1000 });
  assert.equal(other.acquire(new Date(NOW).toISOString()), true);
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.outcome, 'QUEUED');
  assert.ok(f.file('pending/ack-500-1.json'));
  assert.equal(f.finding().state, 'new');
});

test('a computer refresh never runs the queue', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const result = f.run({ cloud: false });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.orders, undefined);
  assert.ok(f.file('pending/ack-500-1.json'));
  assert.equal(f.finding().state, 'new');
});

test('an empty queue costs one listing and adds nothing to the report counts', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  assert.deepEqual(result.report.orders, { done: 0, refused: 0, pending: 0, results: [] });
  assert.equal(f.github.calls.filter(call => call.path.includes('/orders/')).length, 1);
});

test('file names map to an order id and mode', () => {
  assert.deepEqual(queue.parseName('ack-1.json'), { id: 'ack-1', dryRun: false });
  assert.deepEqual(queue.parseName('ack-1.dry-run.json'), { id: 'ack-1', dryRun: true });
  assert.equal(queue.parseName('a.json'), null);
  assert.equal(queue.parseName('notes.txt'), null);
  assert.equal(queue.parseName('../x.json'), null);
});
