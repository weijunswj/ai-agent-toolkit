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
  const run = (body, argv = [], { environment = {}, clock = () => NOW } = {}) => {
    const file = path.join(dir, `order-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
    let output = '';
    let error = null;
    let code = null;
    try {
      code = cli.main(['run-order', '--order', file, '--session', 'records-thread-7', ...argv], { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: '.',
        toolkitVersion: '3.74.0', now: () => new Date(NOW).toISOString(), orderClock: clock, environment, stdout: { write: text => { output += text; } } });
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
    { command: 'update', issue: 423, patch: { candidate: { head: 'not-a-sha' } } },
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
  assert.equal(f.run(f.order({ ops: [{ command: 'ack', finding: ADDED, next: 'x', due: '2026-11-12T18:00:00' }] })).error?.code, 'ORDER_INVALID', 'a due time needs its zone');
  const due = new Date(NOW + 6 * 3600 * 1000).toISOString();
  const result = f.run(f.order({ ops: [{ command: 'ack', finding: ADDED, next: 'Confirm #423 today.', due }] }));
  assert.equal(result.report.outcome, 'DONE');
  assert.equal(finding(f.parentDoc(), ADDED).due, due);
  assert.equal(f.parentDoc().private.attention_notes[ADDED], 'Confirm #423 today.');
});

// An order accepted before its expiry must not keep writing after it: the clock is read again before
// every write, a run that meets the deadline stops there with its receipts, and a retry writes nothing.
// `lateAfter(n)` moves the clock past the expiry once the parent has taken n writes.
function lateAfter(f, parentPuts) {
  const expiry = NOW + 2 * 3600 * 1000;
  let late = false;
  let puts = 0;
  const request = f.github.request.bind(f.github);
  f.github.request = (method, endpoint, body, options) => {
    const response = request(method, endpoint, body, options);
    if (method === 'PUT' && endpoint.includes('parent-421.json') && ++puts >= parentPuts) late = true;
    return response;
  };
  return () => (late ? expiry + 1000 : NOW);
}

test('an order that expires mid-run stops before its next write and keeps its receipts', t => {
  const f = setup(t);
  // Parent writes: 1 the order's log entry, 2 the ack. The deadline passes as the ack lands.
  const clock = lateAfter(f, 2);
  const order = f.order();
  const plan = f.store.read('child', 423).doc.next_action;
  const start = f.github.commits;
  const result = f.run(order, [], { clock });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.outcome, 'STOPPED');
  assert.deepEqual(result.report.results.map(entry => entry.outcome).slice(1), ['EXPIRED']);
  assert.equal(result.report.results[1].code, 'ORDER_EXPIRED');
  assert.equal(result.report.results.length, 2, 'the third write is never tried');
  assert.match(result.report.next_action, /expired/);
  assert.equal(finding(f.parentDoc(), ADDED).state, 'acknowledged', 'the write before the deadline stands');
  assert.equal(finding(f.parentDoc(), NO_TASK).state, 'new', 'no write after the deadline');
  assert.equal(f.store.read('child', 423).doc.next_action, plan, 'no write after the deadline');
  const [entry] = f.parentDoc().private.holder_orders;
  assert.deepEqual(entry.done, [0], 'the receipt for the finished write is kept');
  // Three writes: the log entry, the ack and its receipt. Nothing after the deadline, not even the log.
  assert.equal(f.github.commits - start, 3);
  // A retry of the same order is refused at once and writes nothing, not even the log.
  const before = f.github.commits;
  const retry = f.run(order, [], { clock });
  assert.equal(retry.error?.code, 'ORDER_EXPIRED');
  assert.equal(f.github.commits, before);
});

test('an order that expires after its checks but before its first write writes nothing', t => {
  const f = setup(t);
  const order = f.order();
  let late = false;
  const request = f.github.request.bind(f.github);
  // The deadline passes while the run reads the parent for its fence check.
  f.github.request = (method, endpoint, body, options) => {
    if (method === 'GET' && endpoint.includes('parent-421.json')) late = true;
    return request(method, endpoint, body, options);
  };
  const before = f.github.commits;
  const result = f.run(order, [], { clock: () => (late ? NOW + 3 * 3600 * 1000 : NOW) });
  assert.equal(result.error?.code, 'ORDER_EXPIRED');
  assert.equal(f.github.commits, before, 'nothing written, not even the log entry');
  assert.equal(f.parentDoc().private?.holder_orders, undefined);
});

test('a same-role gate after an accepted one is a reopen under a new assignment, as the gate route says', t => {
  const f = setup(t);
  let n = 0;
  const ops = list => f.run(f.order({ order_id: `gate-${++n}`, ops: list })).report.results.map(entry => `${entry.command}:${entry.outcome}${entry.code ? `:${entry.code}` : ''}`);
  const gate = () => f.store.read('child', 423).doc.gate;
  const end = id => assert.deepEqual(ops([{ command: 'return', issue: 423, record: `${id}.r1`, assignment: id },
    { command: 'return', issue: 423, consume: `${id}.r1`, verdict: 'ACCEPT' }]), ['return:WRITTEN', 'return:WRITTEN']);
  const sameRole = (role, id, label) => {
    assert.equal(gate().state, 'RETIRED', `${label}: the last gate is accepted`);
    assert.equal(gate().role, role);
    assert.deepEqual(ops([{ command: 'assign', issue: 423, role, assignment: id }]), ['assign:REFUSED:GATE_STATE'], `${label}: plain assign`);
    assert.deepEqual(ops([{ command: 'assign', issue: 423, role, assignment: id, supersede: true, reason: `${role} follows ${role}` }]), ['assign:REFUSED:GATE_STATE'], `${label}: assign --supersede`);
    assert.deepEqual(ops([{ command: 'reopen', issue: 423, assignment: id, reason: `${role} follows accepted ${role}` }]), ['reopen:WRITTEN'], `${label}: reopen`);
    assert.equal(gate().state, 'ASSIGNED', `${label}: live again`);
    assert.equal(gate().role, role, `${label}: reopen keeps the role`);
    assert.equal(gate().assignment.id, id, `${label}: under the new assignment`);
    assert.equal(state.completionAccepted(f.store.read('child', 423).doc), false, `${label}: completion waits for the new verdict`);
    end(id);
    assert.equal(gate().state, 'RETIRED', `${label}: its ACCEPT ends it`);
    assert.equal(gate().assignment.id, id);
  };
  assert.deepEqual(ops([{ command: 'assign', issue: 423, role: 'G0', assignment: 'g0' }]), ['assign:WRITTEN']);
  end('g0');
  sameRole('G0', 'g0-second', 'second G0');
  assert.deepEqual(ops([{ command: 'assign', issue: 423, role: 'G1', assignment: 'g1' }]), ['assign:WRITTEN'], 'another role after an accepted gate is a plain assign');
  assert.deepEqual(ops([{ command: 'return', issue: 423, record: 'g1.r1', assignment: 'g1' }]), ['return:WRITTEN']);
  assert.deepEqual(ops([{ command: 'assign', issue: 423, role: 'G2', assignment: 'g2', supersede: true, reason: 'G2 follows G1' }]), ['assign:WRITTEN']);
  // A G2 is accepted only on its trusted PASS verdict on the task PR, at the head its return judged.
  const head = 'c'.repeat(40);
  f.github.addPr(540, { head, branch: 'feature' });
  f.github.addComment(540, { body: `Toolkit-G2: PASS ${head} tier=RISKY\nRoute: host-verified opus-5.5/xhigh pin=owner-claude/REVIEWER` });
  assert.deepEqual(ops([{ command: 'update', issue: 423, patch: { candidate: { branch: 'feature' } } }]), ['update:WRITTEN']);
  end('g2');
  assert.equal(state.completionAccepted(f.store.read('child', 423).doc), true);
  sameRole('G2', 'g2-delta', 'delta G2 after a PASS');
  sameRole('G2', 'g2-recheck', 'G2 recheck with no G1 round between');
  assert.equal(state.completionAccepted(f.store.read('child', 423).doc), true);
  assert.deepEqual(state.validateParent(f.parentDoc()), []);
  // The documented routes name this; if the state machine ever lets `assign` take an accepted gate's own role, change both.
  const root = path.join(__dirname, '..', '..');
  const route = fs.readFileSync(path.join(root, 'repo', 'contracts', 'claude-projects', 'web-controller-projects', 'reference', 'periodic-runs.md'), 'utf8')
    .split('\n').find(line => line.startsWith('- **Gate assignments**'));
  assert.ok(route.includes("When the task's last gate is an accepted one of the same role") && route.includes('both `assign` forms are refused (`GATE_STATE`)')
    && route.includes('queue `reopen --issue <n> --assignment <id> --reason'), 'the Projects gate route names the reopen');
  const skill = fs.readFileSync(path.join(root, 'skills', 'github-program-reconciler', 'SKILL.md'), 'utf8').split('\n').find(line => line.startsWith('**Gates.**'));
  assert.ok(skill.includes("`assign` for an accepted gate's own role is refused with or without `--supersede` (`GATE_STATE`)")
    && skill.includes('is a `reopen` under a new `--assignment`'), 'the reconciler Gates line names the reopen');
});

test('a holder order that starts a gate drops the task\'s lane wait in that one write and keeps every other blocker', t => {
  const f = setup(t);
  const wait = 'Queued in NOW: one child at a time; starts when the gate lane frees (INT-TK421-1069)';
  let n = 0;
  const ops = list => f.run(f.order({ order_id: `wait-${++n}`, ops: list })).report.results.map(entry => `${entry.command}:${entry.outcome}`);
  assert.deepEqual(ops([{ command: 'update', issue: 423, patch: { lifecycle: 'ACTIVE', blockers: [wait, 'waits for PR 1098'] } }]), ['update:WRITTEN']);
  const started = f.run(f.order({ order_id: `wait-${++n}`, ops: [{ command: 'assign', issue: 423, role: 'G1', assignment: 'g1-wait' }] })).report.results;
  assert.deepEqual(started, [{ at: 1, command: 'assign', outcome: 'WRITTEN', dropped_lane_waits: [wait] }], 'the result names each lane wait it dropped, so a wrong drop shows the same turn');
  const child = f.store.read('child', 423).doc;
  assert.deepEqual(child.blockers, ['waits for PR 1098'], 'no separate blocker write is needed');
  assert.equal(child.gate.state, 'ASSIGNED');
  assert.equal(child.private.lane_wait, undefined, 'the stamp goes with the last lane wait');
  assert.deepEqual(f.parentDoc().private.holder_orders.find(entry => entry.order_id === `wait-${n}`).results.at(-1).dropped_lane_waits, [wait], 'and so does the order log');
  const restarted = f.run(f.order({ order_id: `wait-${++n}`, ops: [{ command: 'interrupt', issue: 423, reason: 'the thread stopped' },
    { command: 'assign', issue: 423, role: 'G1', assignment: 'g1-wait2' }] })).report.results;
  assert.deepEqual(restarted.map(entry => Object.keys(entry).join()), ['at,command,outcome', 'at,command,outcome'], 'nothing dropped, nothing listed');
  const sentBack = f.run(f.order({ order_id: `wait-${++n}`, ops: [{ command: 'return', issue: 423, record: 'g1-wait2.r1', assignment: 'g1-wait2' },
    { command: 'update', issue: 423, patch: { blockers: [wait, 'waits for PR 1098'] } }, { command: 'return', issue: 423, consume: 'g1-wait2.r1', verdict: 'REOPEN' },
    { command: 'return', issue: 423, record: 'g1-wait2.r2', assignment: 'g1-wait2' }, { command: 'update', issue: 423, patch: { blockers: [wait] } },
    { command: 'reopen', issue: 423, reason: 'the owner asked for one more fix' }] })).report.results;
  assert.deepEqual(sentBack.map(entry => entry.outcome), Array(6).fill('WRITTEN'));
  assert.deepEqual(sentBack.map(entry => entry.dropped_lane_waits || null), [null, null, [wait], null, null, [wait]], 'consume REOPEN and reopen name their drops too');
  assert.deepEqual(f.store.read('child', 423).doc.blockers, [], 'fixture: the last reopen dropped the wait');
  // The documented routes name the lane wait and its drop; change them with the state machine.
  const root = path.join(__dirname, '..', '..');
  const route = fs.readFileSync(path.join(root, 'repo', 'contracts', 'claude-projects', 'web-controller-projects', 'reference', 'periodic-runs.md'), 'utf8')
    .split('\n').find(line => line.startsWith('- **Gate assignments**'));
  for (const phrase of ['one blocker starting `Queued in NOW:`', '`assign` and `reopen` drop it and keep every other blocker', 'Answer `QUEUED_BUT_MOVING`', 'a commit after the wait and outside every recorded gate', 'with the missed `assign`', "check each result's `dropped_lane_waits`"]) assert.ok(route.includes(phrase), phrase);
  const skill = fs.readFileSync(path.join(root, 'skills', 'github-program-reconciler', 'SKILL.md'), 'utf8');
  assert.match(skill, /^  - Status is worked out: [^\n]*one blocker starting `Queued in NOW:` [^\n]*`assign` and `reopen` \(and a consume `REOPEN`\) drop lane waits in the same write and keep every other blocker/m);
  assert.match(skill, /^  - Status is worked out: [^\n]*a lane controller's `assign` on its own child drops them too/m);
  assert.match(skill, /^- `QUEUED_BUT_MOVING`: [^\n]*committed after the wait was written and after its last recorded gate ended/m);
  assert.match(skill, /`assign`, `reopen` and a consume `REOPEN` list each one they dropped \(`dropped_lane_waits`/);
  assert.match(skill, /^- `QUEUED_BUT_MOVING`: A task shown `NOW · QUEUED` by lane waits alone/m);
  assert.match(skill, /`TASK_IDLE`, `TASK_MERGED_OPEN`, `QUEUED_BUT_MOVING`, `BATCH_NEXT` and `AGENT_UAT_UNSTARTED` are its alarms/);
});

test('a holder order records the owner\'s answer to a G0 question on the same return, with its reason, through the one return path', t => {
  const f = setup(t);
  let n = 0;
  const run = list => f.run(f.order({ order_id: `answer-${++n}`, ops: list })).report.results.map(entry => `${entry.command}:${entry.outcome}`);
  assert.deepEqual(run([{ command: 'assign', issue: 423, role: 'G0', assignment: 'g0-q' }, { command: 'return', issue: 423, record: 'g0-q.r1', assignment: 'g0-q' },
    { command: 'return', issue: 423, consume: 'g0-q.r1', verdict: 'WAITING_OWNER' }]), ['assign:WRITTEN', 'return:WRITTEN', 'return:WRITTEN']);
  assert.equal(f.store.read('child', 423).doc.gate.state, 'WAITING_OWNER');
  assert.deepEqual(run([{ command: 'return', issue: 423, consume: 'g0-q.r1', verdict: 'ACCEPT', reason: 'the owner answered: option a' }]), ['return:WRITTEN']);
  const doc = f.store.read('child', 423).doc;
  assert.deepEqual([doc.gate.state, doc.gate.returns.map(entry => entry.verdict)], ['RETIRED', ['ACCEPT']]);
  assert.deepEqual(doc.private.gate_history.at(-1), { assignment: 'g0-q', role: 'G0', ended: 'OWNER_ANSWERED', return_id: 'g0-q.r1', verdict: 'ACCEPT', reason: 'the owner answered: option a', at: new Date(NOW).toISOString() });
  assert.throws(() => orders.validateOrder(f.order({ ops: [{ command: 'return', issue: 423, consume: 'g0-q.r1', verdict: 'ACCEPT', reason: '' }] }), { nowMs: () => NOW }), { code: 'ORDER_INVALID' }, 'a blank reason is refused whole');
});

// One-task parent patches: `outcome` sets fields on one catalogued task and `move` slots one task right
// after another in the hand order, so an order's size no longer grows with the catalogue.
const catalogue = count => Array.from({ length: count }, (_, i) => ({ issue: 1000 + i, label: `T${i}`, class: 'COMMITTED', parent: 421, order: i + 1 }));
const parentWith = outcomes => state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes });
const byIssue = doc => new Map(doc.outcomes.map(outcome => [outcome.issue, outcome]));

test('red-first: a move-only order slots one task right after another and renumbers; every other task stays byte-identical', t => {
  const f = setup(t);
  const result = f.run(f.order({ order_id: 'move-1', ops: [{ command: 'update-parent', patch: { move: { issue: 423, after: 424 } } }] }));
  assert.equal(result.error, null, result.error?.message);
  assert.deepEqual(f.parentDoc().outcomes.map(outcome => [outcome.issue, outcome.order]), [[423, 3], [424, 2]], 'catalogue entries keep their place in the list');
  assert.deepEqual(state.validateParent(f.parentDoc()), []);
  const doc = parentWith(catalogue(300));
  const patch = { move: { issue: 1004, after: 1250 } };
  assert.ok(JSON.stringify(patch).length < 1024, 'the order line stays small however long the catalogue is');
  const next = state.applyPatch('parent', doc, patch);
  const before = byIssue(doc), after = byIssue(next);
  assert.equal(after.get(1004).order, before.get(1250).order + 1);
  const changed = next.outcomes.filter(outcome => JSON.stringify(outcome) !== JSON.stringify(before.get(outcome.issue)));
  assert.deepEqual(changed.map(outcome => outcome.issue), [1004, ...Array.from({ length: 49 }, (_, i) => 1251 + i)], 'only the moved task and the tasks after its slot are renumbered');
  for (const outcome of changed) assert.deepEqual({ ...outcome, order: null }, { ...before.get(outcome.issue), order: null }, `#${outcome.issue}: only its order changes`);
  const gap = parentWith(catalogue(5).map(outcome => ({ ...outcome, order: outcome.order * 10 })));
  const slotted = state.applyPatch('parent', gap, { move: { issue: 1000, after: 1002 } });
  assert.deepEqual(slotted.outcomes.map(outcome => outcome.order), [31, 20, 30, 40, 50], 'a gap after the slot takes the task, so nothing else is renumbered');
  const hand = list => [...list].sort((a, b) => a.order - b.order || a.issue - b.issue).map(outcome => outcome.issue);
  const expected = hand(doc.outcomes).filter(issue => issue !== 1004);
  expected.splice(expected.indexOf(1250) + 1, 0, 1004);
  assert.deepEqual(hand(next.outcomes), expected);
});

test('a move into tied or tight orders renumbers only the tasks after the slot, keeping their sequence', () => {
  const doc = parentWith([2, 3, 4, 5, 6].map(issue => ({ issue, class: 'COMMITTED', parent: 421, order: issue === 2 ? 0 : 1 })));
  const next = state.applyPatch('parent', doc, { move: { issue: 6, after: 3 } });
  assert.deepEqual(next.outcomes.map(outcome => [outcome.issue, outcome.order]), [[2, 0], [3, 1], [4, 3], [5, 4], [6, 2]]);
  const front = state.applyPatch('parent', doc, { move: { issue: 2, after: 6 } });
  assert.deepEqual([...front.outcomes].sort((a, b) => a.order - b.order || a.issue - b.issue).map(outcome => outcome.issue), [3, 4, 5, 6, 2]);
  assert.deepEqual(state.applyPatch('parent', doc, { move: { issue: 4, after: 3 } }).outcomes, doc.outcomes, 'a task already in place keeps every order');
});

test('a one-task patch sets, replaces or removes fields on that task only', () => {
  const doc = parentWith(catalogue(300));
  const patch = { outcome: { issue: 1007, name: 'Shared host contract', last: true, order: 40 } };
  assert.ok(JSON.stringify(patch).length < 1024);
  const next = state.applyPatch('parent', doc, patch);
  const before = byIssue(doc);
  assert.deepEqual(next.outcomes.filter(outcome => JSON.stringify(outcome) !== JSON.stringify(before.get(outcome.issue))).map(outcome => outcome.issue), [1007]);
  assert.deepEqual(byIssue(next).get(1007), { ...before.get(1007), name: 'Shared host contract', last: true, order: 40 });
  const cleared = state.applyPatch('parent', next, { outcome: { issue: 1007, last: null, name: null } });
  assert.deepEqual(byIssue(cleared).get(1007), { ...before.get(1007), order: 40 }, 'null removes an optional field');
  assert.deepEqual(state.validateParent(cleared), []);
});

test('a one-task patch or move naming an unknown task, an unknown field or the task itself is refused and writes nothing', t => {
  const doc = parentWith(catalogue(3));
  for (const [patch, code, pattern] of [
    [{ outcome: { issue: 9 } }, 'OUTCOME_UNKNOWN', /#9 is not in the outcome catalogue/],
    [{ outcome: { issue: 1000, colour: 'red' } }, 'PATCH_REFUSED', /outcome patch cannot set colour/],
    [{ outcome: { issue: 1000, class: 'RETIRED' } }, 'PATCH_REFUSED', /outcome patch cannot set class/],
    [{ outcome: { issue: 1000, order: null } }, 'PATCH_REFUSED', /order cannot be removed/],
    [{ outcome: { name: 'x' } }, 'USAGE', /outcome patch needs the task's issue number/],
    [{ move: { issue: 1000, after: 9 } }, 'OUTCOME_UNKNOWN', /#9 is not in the outcome catalogue/],
    [{ move: { issue: 9, after: 1000 } }, 'OUTCOME_UNKNOWN', /#9 is not in the outcome catalogue/],
    [{ move: { issue: 1000, after: 1000 } }, 'USAGE', /cannot move a task after itself/],
    [{ move: { issue: 1000, after: 1001, before: 1002 } }, 'USAGE', /move takes only issue and after/],
    [{ move: { issue: 1000, after: 1001 }, outcomes: doc.outcomes }, 'PATCH_REFUSED', /one of outcomes, outcome or move/],
    [{ outcome: { issue: 1000, name: 'x' }, move: { issue: 1000, after: 1001 } }, 'PATCH_REFUSED', /one of outcomes, outcome or move/],
  ]) assert.throws(() => state.applyPatch('parent', doc, patch), error => error.code === code && pattern.test(error.message), JSON.stringify(patch));
  const f = setup(t);
  const catalogueBefore = JSON.stringify(f.parentDoc().outcomes);
  const result = f.run(f.order({ order_id: 'move-bad', ops: [{ command: 'update-parent', patch: { move: { issue: 423, after: 423 } } }] }));
  assert.match(JSON.stringify(result.report || { error: result.error?.message }), /cannot move a task after itself/);
  assert.equal(JSON.stringify(f.parentDoc().outcomes), catalogueBefore, 'the catalogue is not written');
});
