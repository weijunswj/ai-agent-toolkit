'use strict';

// Holder orders: a controller with no shell hands a session its exact writes, and that session runs
// only those, as the holder, with a trail in the parent's private part.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const orders = require('../../skills/github-program-reconciler/scripts/programme-holder-order.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const ADDED = state.findingId('reconcile', 'CHILD_ADDED', 423);
const NO_TASK = state.findingId('reconcile', 'PR_WITHOUT_TASK', 851);
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const HOLDER = 'toolkit-421-projects-controller';
const controller = { session: HOLDER, prefix: 'INT-TK421-' };
const CATALOGUE = [
  { issue: 423, label: 'C2', class: 'COMMITTED', parent: 421, order: 1 },
  { issue: 424, label: 'C3', class: 'COMMITTED', parent: 421, order: 2 },
];

function setup(t) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'] };
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const outcome of CATALOGUE) github.addIssue(outcome.issue, { body: `Body of ${outcome.issue}`, parent: 421 });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(NOW).toISOString(), toolkitVersion: '3.74.0' });
  const parent = state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: CATALOGUE }), controller, {});
  parent.attention = [
    { id: ADDED, source: 'reconcile', code: 'CHILD_ADDED', issue: 423, head: null, state: 'new', first_seen: '2026-11-12T10:00:00.000Z', changed_at: '2026-11-12T10:00:00.000Z' },
    { id: NO_TASK, source: 'reconcile', code: 'PR_WITHOUT_TASK', issue: 851, head: null, state: 'new', first_seen: '2026-11-12T10:00:00.000Z', changed_at: '2026-11-12T10:00:00.000Z' },
  ];
  store.write('parent', 421, parent, { sha: null, previous: null });
  store.write('child', 423, state.newChild({ repository, outcome: CATALOGUE[0] }), { sha: null, previous: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holder-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentDoc = () => store.read('parent', 421).doc;
  const order = (extra = {}) => ({ schema: orders.SCHEMA, order_id: 'clear-backlog-1', parent_issue: 421, holder_session: HOLDER, epoch: parentDoc().fence.epoch,
    expires_at: new Date(NOW + 2 * 3600 * 1000).toISOString(), record: 'INT-TK421-900', ops: [
      { command: 'ack', finding: ADDED, next: 'Confirm #423 in the catalogue today.' },
      { command: 'dispose', finding: NO_TASK, reason: 'A docs-only PR with no task.' },
      { command: 'update', issue: 423, patch: { next_action: 'Controller: owner test after merge' } },
    ], ...extra });
  const run = (body, argv = [], { environment = {} } = {}) => {
    const file = path.join(dir, `order-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
    let output = '';
    let error = null;
    let code = null;
    try {
      code = cli.main(['run-order', '--order', file, '--session', 'records-thread-7', ...argv], { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: '.',
        toolkitVersion: '3.74.0', now: () => new Date(NOW).toISOString(), orderClock: () => NOW, environment, stdout: { write: text => { output += text; } } });
    } catch (thrown) { error = thrown; }
    return { code, error, report: output ? JSON.parse(output) : null };
  };
  return { github, store, parentDoc, order, run };
}

const finding = (doc, id) => doc.attention.find(entry => entry.id === id);

test('an order runs exactly its writes as the holder and logs each one', t => {
  const f = setup(t);
  const result = f.run(f.order());
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.outcome, 'DONE');
  assert.deepEqual(result.report.results.map(entry => entry.command), ['ack', 'dispose', 'update']);
  assert.equal(finding(f.parentDoc(), ADDED).state, 'acknowledged');
  assert.equal(finding(f.parentDoc(), NO_TASK).state, 'disposed');
  assert.equal(f.store.read('child', 423).doc.next_action, 'Controller: owner test after merge');
  const log = f.parentDoc().private.holder_orders;
  assert.equal(log.length, 1);
  assert.equal(log[0].order_id, 'clear-backlog-1');
  assert.equal(log[0].digest, result.report.digest);
  assert.match(log[0].by, /^[0-9a-f]+$/, 'the running session is logged by hash');
  assert.notEqual(log[0].by, 'records-thread-7');
  assert.deepEqual(log[0].done, [0, 1, 2]);
  assert.ok(log[0].finished_at);
  // The holder is unchanged: the order wrote as it, never took it over.
  assert.equal(f.parentDoc().fence.holder_session, HOLDER);
  assert.deepEqual(state.validateParent(f.parentDoc()), []);
});

test('a dry run checks the order against the parent and writes nothing', t => {
  const f = setup(t);
  const before = f.github.commits;
  const result = f.run(f.order(), ['--dry-run']);
  assert.equal(result.report.mode, 'dry-run');
  assert.equal(result.report.ops.length, 3);
  assert.equal(f.github.commits, before);
  assert.equal(finding(f.parentDoc(), ADDED).state, 'new');
});

test('a re-run skips finished writes; a changed order under the same id is refused', t => {
  const f = setup(t);
  const order = f.order();
  f.run(order);
  const again = f.run(order);
  assert.equal(again.report.outcome, 'DONE');
  assert.deepEqual(again.report.results.map(entry => entry.outcome), ['DONE_EARLIER', 'DONE_EARLIER', 'DONE_EARLIER']);
  const changed = f.run({ ...order, ops: [{ command: 'ack', finding: NO_TASK, next: 'Link PR 851 to a task.' }] });
  assert.equal(changed.error?.code, 'ORDER_CHANGED');
});

test('a refused write stops the order there, and a later run continues from it', t => {
  const f = setup(t);
  const order = f.order({ ops: [
    { command: 'ack', finding: ADDED, next: 'Confirm #423 in the catalogue today.' },
    { command: 'update', issue: 423, patch: { gate: { state: 'ACCEPTED' } } },
    { command: 'dispose', finding: NO_TASK, reason: 'Never reached.' },
  ] });
  const first = f.run(order);
  assert.equal(first.report.outcome, 'STOPPED');
  assert.equal(first.report.results.length, 2, 'the third write never ran');
  assert.equal(first.report.results[1].outcome, 'REFUSED');
  assert.equal(first.report.results[1].code, 'PATCH_REFUSED');
  assert.equal(finding(f.parentDoc(), NO_TASK).state, 'new', 'nothing after the refused write ran');
  assert.deepEqual(f.parentDoc().private.holder_orders[0].done, [0]);
  // A rerun of the same order starts again at the refused write, not the finished one.
  const rerun = f.run(order);
  assert.deepEqual(rerun.report.results.map(entry => entry.outcome), ['DONE_EARLIER', 'REFUSED']);
});

for (const [label, change, code] of [
  ['an expired order', { expires_at: new Date(NOW - 1000).toISOString() }, 'ORDER_EXPIRED'],
  ['an order valid for more than a day', { expires_at: new Date(NOW + 25 * 3600 * 1000).toISOString() }, 'ORDER_INVALID'],
  ['an order from before a takeover', { epoch: 99 }, 'ORDER_STALE'],
  ['an order for another holder', { holder_session: 'someone-else' }, 'ORDER_STALE'],
  ['an order for another parent', { parent_issue: 422 }, 'ORDER_INVALID'],
  ['a claim', { ops: [{ command: 'claim', parent: true }] }, 'ORDER_INVALID'],
  ['a takeover by migrate-state', { ops: [{ command: 'migrate-state' }] }, 'ORDER_INVALID'],
  ['a write with an unknown field', { ops: [{ command: 'ack', finding: ADDED, next: 'x', takeover: true }] }, 'ORDER_INVALID'],
  ['an order without its record', { record: '' }, 'ORDER_INVALID'],
  ['an unknown top-level field', { controller: true }, 'ORDER_INVALID'],
]) test(`${label} is refused and writes nothing`, t => {
  const f = setup(t);
  const before = f.github.commits;
  const result = f.run(f.order(change));
  assert.equal(result.error?.code, code, result.error?.message);
  assert.equal(f.github.commits, before, 'nothing written');
});

test('the command line takes only its own options; a launcher-started gate never runs an order', t => {
  const f = setup(t);
  assert.throws(() => cli.parseArgs(['run-order', '--order', 'x.json']), /needs --order <file> and --session/);
  assert.throws(() => cli.parseArgs(['run-order', '--order', 'x.json', '--session', 's', '--controller']), /run-order takes only/);
  assert.throws(() => cli.parseArgs(['ack', '--finding', ADDED, '--controller', '--session', 's', '--order', 'x.json']), /--order goes with run-order/);
  const gate = f.run(f.order(), [], { environment: { TOOLKIT_GATE_ROLE: 'G2' } });
  assert.match(gate.error?.message || '', /executor/);
  const dry = f.run(f.order(), ['--dry-run'], { environment: { TOOLKIT_GATE_ROLE: 'G2' } });
  assert.equal(dry.report.mode, 'dry-run', 'a gate may still check an order');
});

test('the order digest ignores key order', () => {
  assert.equal(orders.orderDigest({ a: 1, b: { c: 2, d: 3 } }), orders.orderDigest({ b: { d: 3, c: 2 }, a: 1 }));
});

// The dry run must refuse what the apply refuses. On 13 Nov three writes passed a dry run and were
// refused by the real run: a dispose reason over the limit, a candidate patch with no head, tree or
// base, and an answer to a finding that was no longer new.
test('a dry run reports each write the apply would refuse, with its code, and writes nothing', t => {
  const f = setup(t);
  const long = f.run(f.order({ ops: [{ command: 'dispose', finding: NO_TASK, reason: 'x'.repeat(201) }] }), ['--dry-run']);
  assert.equal(long.error?.code, 'ORDER_INVALID', 'an over-long reason is refused before any write');
  assert.match(long.error.message, /at most 200 characters/);
  f.store.mutate('parent', 421, { writer: controller, change: doc => state.answerFinding(doc, { id: NO_TASK, state: 'disposed', reason: 'Docs-only PR.', now: new Date(NOW).toISOString() }) });
  const before = f.github.commits;
  const result = f.run(f.order({ ops: [
    { command: 'ack', finding: ADDED, next: 'Confirm #423 in the catalogue today.' },
    { command: 'update', issue: 423, patch: { candidate: { head: null, tree: null, base: null } } },
    { command: 'ack', finding: NO_TASK, next: 'Link PR 851 to a task.' },
  ] }), ['--dry-run']);
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.outcome, 'WOULD_STOP');
  assert.deepEqual(result.report.ops.map(op => op.status), ['WOULD_RUN', 'REFUSED', 'REFUSED']);
  assert.ok(['STATE_INVALID', 'PATCH_REFUSED'].includes(result.report.ops[1].code), result.report.ops[1].code);
  assert.equal(result.report.ops[2].code, 'FINDING_STATE');
  assert.match(result.report.next_action, /would stop at write 2/);
  assert.equal(f.github.commits, before, 'nothing written');
  assert.equal(finding(f.parentDoc(), ADDED).state, 'new');
  const clean = f.run(f.order({ order_id: 'clean-1' }), ['--dry-run']);
  assert.equal(clean.report.outcome, 'READY');
});

test('an ack in an order carries its next step, and a due time it gives must be a date', t => {
  const f = setup(t);
  assert.equal(f.run(f.order({ ops: [{ command: 'ack', finding: ADDED }] })).error?.code, 'ORDER_INVALID');
  assert.equal(f.run(f.order({ ops: [{ command: 'ack', finding: ADDED, next: 'x', due: 'soon' }] })).error?.code, 'ORDER_INVALID');
  const due = new Date(NOW + 6 * 3600 * 1000).toISOString();
  const result = f.run(f.order({ ops: [{ command: 'ack', finding: ADDED, next: 'Confirm #423 today.', due }] }));
  assert.equal(result.report.outcome, 'DONE');
  assert.equal(finding(f.parentDoc(), ADDED).due, due);
  assert.equal(f.parentDoc().private.attention_notes[ADDED], 'Confirm #423 today.');
});
