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
  const run = ({ cloud = true, clock = () => NOW } = {}) => {
    let output = '';
    let error = null;
    let code = null;
    try {
      code = cli.main(['refresh', '--scheduled', '--json'], { transport: github, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
        toolkitVersion: '3.107.0', now: () => new Date(NOW).toISOString(), passClock: () => NOW, orderClock: clock,
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
  assert.deepEqual(result.report.orders, { done: 1, refused: 0, pending: 0, retrying: 0, results: [{ order_id: 'ack-500-1', mode: 'apply', outcome: 'DONE' }] });
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
  assert.equal(first.report.orders.retrying, 1, 'the summary warns while it retries');
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
  assert.deepEqual(result.report.orders, { done: 0, refused: 0, pending: 0, retrying: 0, results: [] });
  assert.equal(f.github.calls.filter(call => call.path.includes('/orders/')).length, 1);
});

test('file names map to an order id and mode', () => {
  assert.deepEqual(queue.parseName('ack-1.json'), { id: 'ack-1', dryRun: false });
  assert.deepEqual(queue.parseName('ack-1.dry-run.json'), { id: 'ack-1', dryRun: true });
  assert.equal(queue.parseName('a.json'), null);
  assert.equal(queue.parseName('notes.txt'), null);
  assert.equal(queue.parseName('../x.json'), null);
});

// G2 L1 and L4: a queue that cannot be listed costs the run its orders, never its refresh.
test('an unreadable queue leaves the orders queued and the refresh still runs', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const request = f.github.request.bind(f.github);
  f.github.request = (method, endpoint, body, options) => (method === 'GET' && /\/orders\/pending\?/.test(endpoint)
    ? { status: 403, json: { message: 'secondary rate limit' } } : request(method, endpoint, body, options));
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.orders.unreadable, 'GH_FAILED');
  assert.ok(result.report.metrics, 'the pass ran');
  assert.ok(f.file('pending/ack-500-1.json'));
});

// A queue on a fake store, for the rows that need a stubbed run-order.
function bareQueue(t, runOrder, count = 1) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const store = new state.StateStore({ transport: github, store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' } });
  for (let i = 0; i < count; i += 1) github.putFile(`${PENDING}order-${String(i).padStart(2, '0')}.json`, { order_id: `order-${String(i).padStart(2, '0')}` });
  const q = new queue.OrderQueue({ store, runOrder, session: 'cloud-sweep-1', runId: '1', now: () => new Date(NOW).toISOString() });
  return { github, q, pending: () => [...github.files.keys()].filter(key => key.startsWith(PENDING)) };
}

test('a lost lease, a spent budget or a code-less error mid-order ends the pass and keeps the order queued', t => {
  for (const error of [new state.ProgrammeError('PASS_LOCK_LOST', 'lost'), new state.ProgrammeError('PASS_STOPPED', 'spent'), new TypeError('a bug')]) {
    const b = bareQueue(t, () => { throw error; });
    assert.throws(() => b.q.run(), thrown => thrown === error);
    assert.equal(b.pending().length, 1);
    assert.equal(b.github.calls.filter(call => call.method !== 'GET' && (call.path.includes('/orders/done/') || call.path.includes('/orders/refused/'))).length, 0, 'nothing is filed');
  }
});

test('a takeover after the fence check refuses that one order, not the pass', t => {
  const b = bareQueue(t, () => { throw new state.ProgrammeError('STALE_WRITER', 'The parent moved.'); });
  const result = b.q.run();
  assert.equal(result.results[0].outcome, 'REFUSED');
  assert.equal(result.results[0].code, 'STALE_WRITER');
  assert.equal(b.pending().length, 0);
});

test('a result shaped like a secret is filed with its codes only', t => {
  const shaped = `gh${'p_'}${'A'.repeat(30)}`;
  const b = bareQueue(t, () => ({ outcome: 'STOPPED', digest: 'd', next_action: 'stopped', results: [{ at: 1, command: 'ack', outcome: 'REFUSED', code: 'ROLE_REFUSED', detail: shaped }] }));
  b.q.run();
  const filed = b.github.readFile('state/orders/refused/order-00.json');
  assert.equal(filed.redacted, true);
  assert.equal(filed.code, 'ROLE_REFUSED');
  assert.equal(filed.order, null);
  assert.ok(!JSON.stringify(filed).includes(shaped));
});

test('a pass runs at most 10 orders, oldest name first; the rest wait for the next run', t => {
  const ran = [];
  const b = bareQueue(t, ({ orderValue }) => { ran.push(orderValue.order_id); return { outcome: 'DONE', digest: 'd', results: [] }; }, 12);
  const result = b.q.run();
  assert.equal(ran.length, queue.MAX_ORDERS_PER_PASS);
  assert.deepEqual(ran, [...ran].sort());
  assert.equal(result.done, 10);
  assert.equal(result.pending, 2);
  assert.equal(result.retrying, 0, 'waiting behind the cap is not a failure');
  assert.deepEqual(b.pending().map(name => name.slice(PENDING.length)), ['order-10.json', 'order-11.json']);
});

// Delta G2 L2: run-order reports a code-less error inside a write as FAIL; the order waits, never refused.
test('a code-less error inside a write keeps the order queued through the real run-order', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const request = f.github.request.bind(f.github);
  let thrown = false;
  f.github.request = (method, endpoint, body, options) => {
    if (!thrown && method === 'PUT' && endpoint.endsWith('/state/issue-500.json')) { thrown = true; throw new TypeError('a bug'); }
    return request(method, endpoint, body, options);
  };
  const first = f.run();
  assert.equal(first.error, null, first.error?.message);
  assert.equal(first.report.orders.results[0].outcome, 'PENDING');
  assert.equal(first.report.orders.results[0].code, 'FAIL');
  assert.equal(first.report.orders.retrying, 1);
  assert.ok(f.file('pending/ack-500-1.json'));
  assert.equal(f.file('refused/ack-500-1.json'), null);
  const second = f.run();
  assert.equal(second.error, null, second.error?.message);
  assert.equal(f.file('done/ack-500-1.json').outcome, 'DONE');
});

// SQAG on 3.119.1: a cloud sweep took an order before its expiry, then made a later programme write
// after it. The queued run must stop at the deadline, file what it wrote, and never run the order again.
test('a queued order that expires mid-run stops at the deadline, files its receipts and is not retried', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  const request = f.github.request.bind(f.github);
  let parentPuts = 0;
  let late = false;
  // Parent writes: 1 the order's log entry, 2 the ack. The deadline passes as the ack lands.
  f.github.request = (method, endpoint, body, options) => {
    const response = request(method, endpoint, body, options);
    if (method === 'PUT' && endpoint.endsWith('/state/parent-421.json') && ++parentPuts === 2) late = true;
    return response;
  };
  const clock = () => (late ? NOW + 3 * 3600 * 1000 : NOW);
  const plan = f.store.read('child', 500).doc.next_action;
  const result = f.run({ clock });
  assert.equal(result.error, null, result.error?.message);
  const [row] = result.report.orders.results;
  assert.equal(row.outcome, 'STOPPED');
  assert.equal(row.code, 'ORDER_EXPIRED');
  assert.equal(f.store.read('child', 500).doc.next_action, plan, 'the write after the deadline never ran');
  const filed = f.file('refused/ack-500-1.json');
  assert.equal(filed.code, 'ORDER_EXPIRED');
  assert.deepEqual(filed.results.map(entry => entry.outcome), ['WRITTEN', 'EXPIRED'], 'the receipt for the finished write is filed');
  assert.deepEqual(f.parentDoc().private.holder_orders[0].done, [0]);
  assert.equal(f.file('pending/ack-500-1.json'), null, 'the order leaves the queue');
  // A later run finds nothing to retry: the order never runs again.
  const childWrites = () => f.github.calls.filter(call => call.method === 'PUT' && call.path.endsWith('/state/issue-500.json')).length;
  const before = childWrites();
  const again = f.run({ clock });
  assert.equal(again.error, null, again.error?.message);
  assert.deepEqual(again.report.orders.results, []);
  assert.equal(childWrites(), before);
  assert.equal(f.store.read('child', 500).doc.next_action, plan);
});

// SQAG: a result was filed and read back, but taking the order off the queue failed. A later run
// finishes that removal from the filed result; it never runs the order again or files a second result.
function failFirstRemoval(f) {
  const request = f.github.request.bind(f.github);
  let failed = false;
  f.github.request = (method, endpoint, body, options) => {
    if (!failed && method === 'DELETE' && endpoint.includes('/orders/pending/')) { failed = true; return { status: 502, json: { message: 'Bad gateway' } }; }
    return request(method, endpoint, body, options);
  };
}
const EXPIRED = () => NOW + 3 * 3600 * 1000;
for (const [label, clock] of [['after the order expires', EXPIRED], ['before the order expires', () => NOW]]) {
  test(`a done order whose removal failed is taken off the queue ${label}, keeping its one result`, t => {
    const f = fixture(t);
    f.enqueue('ack-500-1.json', f.order());
    failFirstRemoval(f);
    const first = f.run();
    assert.equal(first.error, null, first.error?.message);
    assert.equal(first.report.orders.results[0].outcome, 'PENDING');
    assert.ok(f.file('pending/ack-500-1.json'), 'the removal failed, so the order is still queued');
    const filed = f.file('done/ack-500-1.json');
    const second = f.run({ clock });
    assert.equal(second.error, null, second.error?.message);
    assert.deepEqual(second.report.orders.results, [{ order_id: 'ack-500-1', mode: 'apply', outcome: 'DONE' }]);
    assert.equal(f.file('pending/ack-500-1.json'), null);
    assert.equal(f.file('refused/ack-500-1.json'), null, 'a done order is never also filed as refused');
    assert.deepEqual(f.file('done/ack-500-1.json'), filed, 'the filed result and its receipts are kept');
    assert.equal(f.parentDoc().private.holder_orders.length, 1);
  });
}

test('a stopped order whose removal failed keeps its receipts when a later run finds it expired', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order({ ops: [
    { command: 'update', issue: 500, patch: { next_action: 'First write' } },
    { command: 'dispose', finding: 'abcdefabcdef', reason: 'No such finding.' },
  ] }));
  failFirstRemoval(f);
  const first = f.run();
  assert.equal(first.error, null, first.error?.message);
  assert.ok(f.file('pending/ack-500-1.json'));
  const filed = f.file('refused/ack-500-1.json');
  assert.equal(filed.outcome, 'STOPPED');
  const second = f.run({ clock: EXPIRED });
  assert.equal(second.error, null, second.error?.message);
  assert.equal(second.report.orders.results[0].outcome, 'STOPPED');
  assert.equal(f.file('pending/ack-500-1.json'), null);
  assert.deepEqual(f.file('refused/ack-500-1.json'), filed, 'the stopped result keeps its operation receipts');
  assert.deepEqual(f.file('refused/ack-500-1.json').results.map(entry => entry.outcome), ['WRITTEN', 'REFUSED']);
  assert.equal(f.file('done/ack-500-1.json'), null);
});

test('a new order that reuses a filed order id still runs', t => {
  const f = fixture(t);
  f.enqueue('ack-500-1.json', f.order());
  f.run();
  assert.equal(f.file('done/ack-500-1.json').outcome, 'DONE');
  f.enqueue('ack-500-1.json', f.order({ expires_at: new Date(NOW - 1000).toISOString() }));
  const again = f.run();
  assert.equal(again.report.orders.results[0].code, 'ORDER_EXPIRED', 'a different order under the same name is judged on its own');
  assert.equal(f.file('pending/ack-500-1.json'), null);
});

// G2 M1: a filed result names the commit that queued its pending file, so the same bytes queued
// again (a new commit) run again, as a stopped result's own advice says, while a pending file the
// run could not remove (the same commit) is only taken off the queue.
const ADDED_501 = state.findingId('reconcile', 'CHILD_ADDED', 501);
function addFinding(f, id, issue) {
  const current = f.store.read('parent', 421);
  const next = JSON.parse(JSON.stringify(current.doc));
  next.attention = [...(next.attention || []), { id, source: 'reconcile', code: 'CHILD_ADDED', issue, head: null, state: 'new', first_seen: '2026-11-14T10:00:00.000Z', changed_at: '2026-11-14T10:00:00.000Z' }];
  f.store.write('parent', 421, next, { sha: current.sha, previous: current.doc });
}

test('a stopped order queued again with the same bytes continues from its refused write', t => {
  const f = fixture(t);
  const order = f.order({ ops: [
    { command: 'update', issue: 500, patch: { next_action: 'First write' } },
    { command: 'ack', finding: ADDED_501, next: 'Confirm #501 in the catalogue today.' },
  ] });
  f.enqueue('ack-500-1.json', order);
  const first = f.run();
  assert.equal(first.error, null, first.error?.message);
  const stopped = f.file('refused/ack-500-1.json');
  assert.equal(stopped.outcome, 'STOPPED');
  assert.match(stopped.detail, /a run of the same order continues from this write/);
  assert.equal(f.file('pending/ack-500-1.json'), null);
  addFinding(f, ADDED_501, 501);
  f.enqueue('ack-500-1.json', order);
  const second = f.run();
  assert.equal(second.error, null, second.error?.message);
  assert.deepEqual(second.report.orders.results, [{ order_id: 'ack-500-1', mode: 'apply', outcome: 'DONE' }]);
  assert.deepEqual(f.parentDoc().private.holder_orders.find(entry => entry.order_id === 'ack-500-1').done, [0, 1]);
  assert.deepEqual(f.file('done/ack-500-1.json').results.map(entry => entry.outcome), ['DONE_EARLIER', 'WRITTEN']);
  assert.equal(f.file('pending/ack-500-1.json'), null);
});

test('a rehearsal queued again with the same bytes after the parent changed rehearses again', t => {
  const f = fixture(t);
  const order = f.order({ ops: [{ command: 'ack', finding: ADDED_501, next: 'Confirm #501 in the catalogue today.' }] });
  f.enqueue('ack-500-1.dry-run.json', order);
  assert.equal(f.run().report.orders.results[0].outcome, 'WOULD_STOP');
  addFinding(f, ADDED_501, 501);
  f.enqueue('ack-500-1.dry-run.json', order);
  const second = f.run();
  assert.equal(second.report.orders.results[0].outcome, 'READY');
  assert.equal(f.file('done/ack-500-1.dry-run.json').outcome, 'READY');
});

// G2 L1: the order that runs is the pending file as listed, read at the commit that queued it, so a
// result never names a commit whose order did not run, and a replacement is never taken for a leftover.
const HISTORY = /\/commits\?path=state%2Forders%2Fpending%2Fack-500-1\.json&/;
const READ = /\/orders\/pending\/ack-500-1\.json\?/;
for (const [label, when] of [['before its history is read', HISTORY], ['after it was read', READ]]) {
  test(`a pending file replaced ${label} never hides the replacement, which is judged next`, t => {
    const f = fixture(t);
    f.enqueue('ack-500-1.json', f.order());
    const replaced = f.order({ ops: [{ command: 'update', issue: 500, patch: { next_action: 'Replaced order' } }] });
    const request = f.github.request.bind(f.github);
    let swapped = false;
    f.github.request = (method, endpoint, body, options) => {
      if (!swapped && method === 'GET' && when.test(endpoint)) { swapped = true; f.github.putFile(`${PENDING}ack-500-1.json`, replaced); }
      return request(method, endpoint, body, options);
    };
    const first = f.run();
    assert.equal(first.error, null, first.error?.message);
    assert.equal(swapped, true);
    assert.equal(first.report.orders.results[0].outcome, 'PENDING');
    const second = f.run();
    assert.equal(second.error, null, second.error?.message);
    assert.equal(f.file('pending/ack-500-1.json'), null);
    if (when === HISTORY) {
      // Changed before it was read: nothing ran, and the next run runs the replacement.
      assert.deepEqual(second.report.orders.results, [{ order_id: 'ack-500-1', mode: 'apply', outcome: 'DONE' }]);
      assert.deepEqual(f.file('done/ack-500-1.json').order, replaced);
      assert.equal(f.store.read('child', 500).doc.next_action, 'Replaced order');
    } else {
      // Changed after it was read: the listed order ran and its result names it; the replacement is
      // not taken for a leftover but judged on its own, and a changed order under a used id is refused.
      assert.deepEqual(f.file('done/ack-500-1.json').order, f.order());
      assert.deepEqual(second.report.orders.results, [{ order_id: 'ack-500-1', mode: 'apply', outcome: 'REFUSED', code: 'ORDER_CHANGED' }]);
      assert.deepEqual(f.file('refused/ack-500-1.json').order, replaced);
    }
  });
}
