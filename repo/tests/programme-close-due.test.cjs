'use strict';

// Close due for finished gate sessions: `assign` and `reopen` open a gate session entry, the
// controller records the launch and the close with `gate-session`, and the sweep raises CLOSE_DUE
// (one per assignment, kind = its assignment ID) once an assignment is finished with nothing owed,
// until its close is recorded. Rows follow the #1225 G0 plan's close-due matrices (D rows for the
// sweep, G rows for the command).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const holderOrder = require('../../skills/github-program-reconciler/scripts/programme-holder-order.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const HOUR = 3600 * 1000;
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const sha = n => String(n).repeat(40).slice(0, 40);
const localId = n => `local_${String(n).repeat(8).slice(0, 8)}-aaaa-4bbb-8ccc-${String(n).repeat(12).slice(0, 12)}`;
const CHECKS = { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null };
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-due-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

const NOW = '2026-11-23T10:00:00.000Z';
// Pure document steps, as the commands run them.
const assign = (doc, assignment, role, supersede = false) => state.assignGate(doc, { assignment, role, supersede, reason: supersede ? 'next gate' : null, now: NOW });
const launch = (doc, assignment, host = 'claude-code', session = host === 'claude-code' ? localId(assignment.length) : null) => state.recordGateSession(doc, { assignment, host, session, now: NOW });
const withReturn = (doc, returnId, atHead) => { doc.gate.returns.push({ return_id: returnId, verdict: null, consumed: false, epoch: doc.fence.epoch, assignment: doc.gate.assignment.id, at_head: atHead }); return doc; };
const setGate = (doc, gateState) => { doc.gate.state = gateState; return doc; };

// A programme under #421 whose tasks each get a state document from `build(newChild)`, and the PRs
// given ({ number, head, state, issue }), so a full refresh pass reads the same facts.
function fixture(tasks, prs = []) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const catalogue = tasks.map((task, i) => ({ issue: task.issue, class: 'COMMITTED', parent: 421, order: i + 1 }));
  const binding = state.validateBinding({
    schema: state.SCHEMA.bindingV2, repository, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'INT-TK421-' }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  });
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const task of tasks) github.addIssue(task.issue, { parent: 421, body: 'Nearest child: none, a new area\n', state: task.state || 'open' });
  for (const pr of prs) github.addPr(pr.number, { head: pr.head, state: pr.state, merged: pr.state === 'MERGED', body: `Refs #${pr.issue}` });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: catalogue }), controller, {}), { sha: null, previous: null });
  tasks.forEach((task, i) => {
    const doc = state.newChild({ repository, outcome: catalogue[i] });
    store.write('child', task.issue, task.build ? task.build(doc) : doc, { sha: null, previous: null });
  });
  const fx = { github, store, binding };
  fx.parent = () => store.read('parent', 421).doc;
  fx.child = issue => store.read('child', issue).doc;
  fx.deps = () => ({ transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0', lockFile: path.join(tmp(), 'pass.lock'),
    attentionDir: tmp(), environment: {}, now: () => new Date(github.clock).toISOString(), stdout: { write: text => { fx.output += text; } }, stderr: { write: () => {} } });
  fx.run = (argv, { json = true, writer = true, session = controller.session, environment = null } = {}) => {
    fx.output = '';
    const deps = fx.deps();
    if (environment) deps.environment = environment;
    try {
      cli.main([...argv, ...(writer ? ['--session', session, '--controller'] : []), ...(json ? ['--json'] : [])], deps);
      return { result: json ? JSON.parse(fx.output.split(/\n(?=\{)/).at(-1)) : fx.output, error: null };
    } catch (error) { return { result: null, error }; }
  };
  fx.reconciler = () => new state.Reconciler({ store, reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    binding, writer: state.refreshWriter(fx.parent()), toolkitVersion: '3.9.0', refreshFacts: true, now: () => new Date(github.clock).toISOString() });
  fx.pass = () => fx.reconciler().run({ apply: true });
  fx.due = () => (fx.parent().attention || []).filter(entry => entry.code === 'CLOSE_DUE' && ['new', 'acknowledged'].includes(entry.state)).map(entry => `#${entry.issue} ${entry.kind}`).sort();
  return fx;
}

// The sweep matrix: each task one row; the expected list names the rows that raise CLOSE_DUE.
function matrix() {
  const H = { d6: sha(6), d7: sha(7), d8: sha(8), d9a: sha('9a'), d9b: sha('9b'), d10: sha('a1') };
  const tasks = [
    { issue: 101, build: doc => launch(assign(doc, 'd1', 'G1'), 'd1') },                                            // D1 live
    { issue: 102, build: doc => setGate(launch(assign(doc, 'd2', 'G0'), 'd2'), 'RETIRED') },                         // D2 accepted
    { issue: 103, build: doc => setGate(launch(assign(doc, 'd3', 'G0'), 'd3'), 'WAITING_OWNER') },                   // D3 still live
    { issue: 104, build: doc => assign(launch(assign(doc, 'd4a', 'G0'), 'd4a'), 'd4b', 'G1', true) },                // D4 superseded
    { issue: 105, build: doc => assign(setGate(launch(assign(doc, 'd5', 'G2'), 'd5'), 'RETIRED'), 'd5b', 'G1') },     // D5 slot moved on
    // D6: a G1 superseded by its G2 while its PR is open.
    { issue: 106, build: doc => assign(withReturn(launch(assign(Object.assign(doc, { pr: { number: 61, state: 'OPEN', head: H.d6, checks: CHECKS } }), 'd6', 'G1'), 'd6'), 'd6.r1', H.d6), 'd6g2', 'G2', true) },
    // D7: its PR merged, UAT owed there, the agent's UAT not handed on.
    { issue: 107, build: doc => assign(withReturn(launch(assign(Object.assign(doc, { pr: { number: 71, state: 'MERGED', head: H.d7, checks: CHECKS }, uat: { state: 'PENDING', at_head: H.d7 } }), 'd7', 'G1'), 'd7'), 'd7.r1', H.d7), 'd7g2', 'G2', true) },
    // D8: as D7 with the agent's UAT PASSED there.
    { issue: 108, build: doc => assign(withReturn(launch(assign(Object.assign(doc, { pr: { number: 81, state: 'MERGED', head: H.d8, checks: CHECKS }, uat: { state: 'PENDING', at_head: H.d8 },
      private: { ...doc.private, agent_uat: { state: 'PASSED', at_head: H.d8, evidence: 'evidence/uat/REPORT.md' } } }), 'd8', 'G1'), 'd8'), 'd8.r1', H.d8), 'd8g2', 'G2', true) },
    // D9: one PR closed unmerged, the other merged.
    { issue: 109, build: doc => assign(withReturn(withReturn(launch(assign(Object.assign(doc, { pr: { number: 92, state: 'MERGED', head: H.d9b, checks: CHECKS },
      prs: [{ number: 91, state: 'CLOSED', merge_sha: null }], private: { ...doc.private, pr_heads: [{ pr: 91, head: H.d9a }, { pr: 92, head: H.d9b }] } }), 'd9', 'G1'), 'd9'), 'd9.r1', H.d9a), 'd9.r2', H.d9b), 'd9g2', 'G2', true) },
    // D10: its PR still open, a later G1 on the task took over.
    { issue: 110, build: doc => launch(assign(withReturn(launch(assign(Object.assign(doc, { pr: { number: 111, state: 'OPEN', head: H.d10, checks: CHECKS } }), 'd10a', 'G1'), 'd10a'), 'd10a.r1', H.d10), 'd10b', 'G1', true), 'd10b') },
    { issue: 111, build: doc => state.interruptGate(launch(assign(doc, 'd11', 'G1'), 'd11'), { reason: 'session lost' }) },   // D11
    { issue: 113, build: doc => Object.assign(doc, { gate: { ...doc.gate, role: 'G0', state: 'RETIRED', assignment: { id: 'd13', role: 'G0' } } }) }, // D13 before C1
    { issue: 114, build: doc => setGate(assign(doc, 'd14', 'G0'), 'RETIRED') },                                      // D14 not recorded
    { issue: 115, build: doc => setGate(launch(assign(doc, 'd15', 'G0'), 'd15', 'codex-exec', 'run-0123456789'), 'RETIRED') }, // D15
  ];
  const prs = [
    { number: 61, head: H.d6, state: 'OPEN', issue: 106 }, { number: 71, head: H.d7, state: 'MERGED', issue: 107 }, { number: 81, head: H.d8, state: 'MERGED', issue: 108 },
    { number: 91, head: H.d9a, state: 'CLOSED', issue: 109 }, { number: 92, head: H.d9b, state: 'MERGED', issue: 109 }, { number: 111, head: H.d10, state: 'OPEN', issue: 110 },
  ];
  return { tasks, prs, expected: ['#102 d2', '#104 d4a', '#105 d5', '#108 d8', '#109 d9', '#110 d10a', '#111 d11', '#114 d14'].sort() };
}

test('C-1: assign and reopen each open one gate session entry with its time; older children load unchanged', () => {
  const doc = state.newChild({ repository: 'acme/app', outcome: { issue: 30, class: 'COMMITTED', parent: 421, order: 1 } });
  assert.deepEqual(state.validateChild(doc), [], 'a child with no gate_sessions loads');
  const one = assign(doc, 'a1', 'G0');
  assert.deepEqual(one.private.gate_sessions, [{ assignment: 'a1', role: 'G0', at: NOW, host: null, session: null, closed_at: null }]);
  assert.equal(assign(one, 'a1', 'G0'), null, 'a repeated assign is a no-op and adds no entry');
  const reopened = state.reopenGate(setGate(one, 'RETIRED'), { reason: 'correction', assignment: 'a2', now: NOW });
  assert.deepEqual(reopened.private.gate_sessions.map(entry => [entry.assignment, entry.role]), [['a1', 'G0'], ['a2', 'G0']]);
  assert.deepEqual(state.validateChild(reopened), []);
  // D18: past the limit the oldest closed entry goes first, then the oldest open one.
  let many = assign(doc, 'b0', 'G0');
  many = state.recordGateSession(many, { assignment: 'b0', closed: true, now: NOW });
  for (let n = 1; n < state.GATE_SESSIONS_LIMIT; n += 1) many = assign(setGate(many, 'INTERRUPTED'), `b${n}`, 'G0');
  const full = assign(setGate(many, 'INTERRUPTED'), 'b20', 'G0');
  assert.equal(full.private.gate_sessions.length, state.GATE_SESSIONS_LIMIT);
  assert.equal(full.private.gate_sessions.some(entry => entry.assignment === 'b0'), false, 'the closed entry left first');
  const past = assign(setGate(full, 'INTERRUPTED'), 'b21', 'G0');
  assert.equal(past.private.gate_sessions[0].assignment, 'b2', 'then the oldest open one');
});

test('C-1 D18: assign reports the gate session entries it pushed out, and their findings resolve', () => {
  const fx = fixture([{ issue: 30, build: doc => {
    let next = doc;
    for (let n = 0; n < state.GATE_SESSIONS_LIMIT; n += 1) next = assign(setGate(next, n ? 'INTERRUPTED' : next.gate.state), `e${n}`, 'G0');
    return setGate(next, 'INTERRUPTED');
  } }]);
  fx.pass();
  assert.equal(fx.due().length, state.GATE_SESSIONS_LIMIT);
  const out = fx.run(['assign', '--issue', '30', '--role', 'G0', '--assignment', 'e20']);
  assert.equal(out.error, null, out.error?.message);
  assert.deepEqual(out.result.dropped_gate_sessions, ['e0']);
  assert.match(out.result.gate_sessions_note, /e0 left it/);
  fx.pass();
  assert.equal(fx.due().includes('#30 e0'), false, 'the dropped entry\'s finding resolved');
});

test('C-3, C-5, C-6, C-7, C-9: a full pass raises CLOSE_DUE exactly where the sweep matrix says, one per assignment', () => {
  const { tasks, prs, expected } = matrix();
  tasks.push({ issue: 117, state: 'closed', build: doc => setGate(launch(assign(doc, 'd17', 'G0'), 'd17'), 'RETIRED') }); // D17
  const fx = fixture(tasks, prs);
  fx.pass();
  assert.deepEqual(fx.due(), [...expected, '#117 d17'].sort());
  const ids = new Set((fx.parent().attention || []).filter(entry => entry.code === 'CLOSE_DUE').map(entry => entry.id));
  assert.equal(ids.size, expected.length + 1, 'one finding ID per assignment');
  const d2 = fx.parent().attention.find(entry => entry.kind === 'd2');
  assert.equal(d2.id, state.findingId('reconcile', 'CLOSE_DUE', 102, null, 'd2'));
  assert.deepEqual(fx.parent().private.close_due[d2.id], { host: 'claude-code', session: localId(2) }, 'the parent private part names the session');
  const d14 = fx.parent().attention.find(entry => entry.kind === 'd14');
  assert.deepEqual(fx.parent().private.close_due[d14.id], { host: null, session: null });
  assert.equal(JSON.stringify(fx.parent().attention).includes('local_'), false, 'no session in the findings');
  // A second pass changes nothing.
  const before = JSON.stringify(fx.parent().attention);
  fx.pass();
  assert.equal(JSON.stringify(fx.parent().attention), before);
});

test('C-3 detail: a recorded session names its host; an unrecorded one says to find it by the assignment ID', () => {
  const fx = fixture([
    { issue: 102, build: doc => setGate(launch(assign(doc, 'd2', 'G0'), 'd2'), 'RETIRED') },
    { issue: 114, build: doc => setGate(assign(doc, 'd14', 'G0'), 'RETIRED') },
  ]);
  const report = fx.pass();
  const details = report.findings.filter(finding => finding.code === 'CLOSE_DUE').map(finding => finding.detail).sort();
  assert.deepEqual(details, [
    'G0 assignment d14 on #114 is finished (accepted); its session was not recorded: find it by the assignment ID or title',
    'G0 assignment d2 on #102 is finished (accepted); close its claude-code session',
  ]);
  assert.equal(JSON.stringify(report).includes('local_'), false, 'the pass report carries no session ID');
});

test('C-4: --closed resolves the finding on the next pass and prunes the parent\'s session copy (D12)', () => {
  const fx = fixture([{ issue: 102, build: doc => setGate(launch(assign(doc, 'd2', 'G0'), 'd2'), 'RETIRED') }]);
  fx.pass();
  assert.deepEqual(fx.due(), ['#102 d2']);
  const closed = fx.run(['gate-session', '--issue', '102', '--assignment', 'd2', '--closed']);
  assert.equal(closed.error, null, closed.error?.message);
  assert.match(fx.child(102).private.gate_sessions[0].closed_at, /^\d{4}-/);
  fx.pass();
  assert.deepEqual(fx.due(), []);
  assert.deepEqual(fx.parent().private.close_due, {}, 'pruned with the finding');
});

test('C-8: a task whose document the pass cannot read keeps its CLOSE_DUE as it stands (D16)', () => {
  const fx = fixture([{ issue: 102, build: doc => setGate(launch(assign(doc, 'd2', 'G0'), 'd2'), 'RETIRED') }]);
  fx.pass();
  const id = fx.parent().attention.find(entry => entry.code === 'CLOSE_DUE').id;
  const reconciler = fx.reconciler();
  const findings = [];
  reconciler.diffCloseDue(fx.parent(), new Map(), { issues: new Map() }, null, findings);
  assert.deepEqual(findings, [], 'nothing raised for an unread task');
  assert.deepEqual(reconciler.closeDueHolds, [id], 'its finding is held');
});

test('C-2: the gate-session command rows G1 to G9 through programme.cjs', () => {
  const fx = fixture([{ issue: 30 }]);
  assert.equal(fx.run(['assign', '--issue', '30', '--role', 'G1', '--assignment', 'g1']).error, null);
  const record = (...extra) => fx.run(['gate-session', '--issue', '30', '--assignment', 'g1', ...extra]);
  // G1 recorded, G2 the same again is a no-op.
  assert.equal(record('--host', 'claude-code', '--host-session', localId(1)).error, null);
  assert.deepEqual(fx.child(30).private.gate_sessions[0], { assignment: 'g1', role: 'G1', at: fx.child(30).private.gate_sessions[0].at, host: 'claude-code', session: localId(1), closed_at: null });
  const again = record('--host', 'claude-code', '--host-session', localId(1));
  assert.equal(again.error, null);
  assert.equal(again.result.outcome, 'NOOP');
  // G3 other values refused, naming the host and never the ID; G4 with --replace --reason.
  const other = record('--host', 'claude-code', '--host-session', localId(2));
  assert.equal(other.error?.code, 'GATE_SESSION_RECORDED');
  assert.match(other.error.message, /already has its claude-code session recorded/);
  assert.equal(other.error.message.includes(localId(1)), false);
  assert.equal(record('--host', 'claude-code', '--host-session', localId(2), '--replace', '--reason', 'relaunched').error, null);
  assert.equal(fx.child(30).private.gate_sessions[0].session, localId(2));
  assert.equal(fx.child(30).private.gate_sessions[0].reason, 'relaunched');
  // G5 closed, G6 closed again is a no-op.
  assert.equal(record('--closed').error, null);
  assert.equal(record('--closed').result.outcome, 'NOOP');
  // G7 an assignment with no entry.
  assert.equal(fx.run(['gate-session', '--issue', '30', '--assignment', 'nope', '--closed']).error?.code, 'STALE_ASSIGNMENT');
  // G9 another session, and a launcher-started executor.
  assert.equal(fx.run(['gate-session', '--issue', '30', '--assignment', 'g1', '--closed'], { session: 'someone-else' }).error?.code, 'STALE_WRITER');
  const executor = fx.run(['gate-session', '--issue', '30', '--assignment', 'g1', '--closed'], { environment: { TOOLKIT_GATE_ROLE: 'G1' } });
  assert.equal(executor.error?.code, 'USAGE');
  assert.match(executor.error.message, /executor/);
  // Usage: exactly one of --host or --closed.
  assert.equal(fx.run(['gate-session', '--issue', '30', '--assignment', 'g1']).error?.code, 'USAGE');
  assert.equal(fx.run(['gate-session', '--issue', '30', '--assignment', 'g1', '--closed', '--host', 'claude-code']).error?.code, 'USAGE');
  assert.equal(fx.run(['assign', '--issue', '30', '--role', 'G2', '--assignment', 'g2', '--closed']).error?.code, 'USAGE', '--closed goes with gate-session only');
});

test('C-2: the controller\'s own session is never recorded as a gate session', () => {
  const fx = fixture([{ issue: 30 }]);
  fx.run(['assign', '--issue', '30', '--role', 'G1', '--assignment', 'g1']);
  const own = fx.run(['gate-session', '--issue', '30', '--assignment', 'g1', '--host', 'codex-app', '--host-session', controller.session]);
  assert.equal(own.error?.code, 'ROLE_REFUSED');
  assert.match(own.error.message, /controller session/);
});

test('C-2: G8, a lane that does not hold the child is refused; G11 a holder order runs gate-session', () => {
  assert.deepEqual(holderOrder.OPS['gate-session'], { required: ['issue', 'assignment'], optional: ['host', 'host-session', 'closed', 'replace', 'reason'] });
  const order = ops => ({ schema: holderOrder.SCHEMA, order_id: 'order-1', parent_issue: 421, holder_session: controller.session, epoch: 1, expires_at: new Date(Date.now() + HOUR).toISOString(), record: 'INT-TK421-1', ops });
  assert.doesNotThrow(() => holderOrder.validateOrder(order([{ command: 'gate-session', issue: 30, assignment: 'g1', host: 'claude-code', 'host-session': localId(1) }])));
  assert.doesNotThrow(() => holderOrder.validateOrder(order([{ command: 'gate-session', issue: 30, assignment: 'g1', closed: true }])));
  assert.throws(() => holderOrder.validateOrder(order([{ command: 'gate-session', issue: 30, assignment: 'g1' }])), /exactly one of host or closed/);
  assert.throws(() => holderOrder.validateOrder(order([{ command: 'gate-session', issue: 30, assignment: 'g1', closed: 'yes' }])), /closed as true or false/);
  // The run: a holder order's write goes through the same command.
  const fx = fixture([{ issue: 30 }]);
  fx.run(['assign', '--issue', '30', '--role', 'G1', '--assignment', 'g1']);
  const file = path.join(tmp(), 'order.json');
  const parent = fx.parent();
  fs.writeFileSync(file, JSON.stringify({ ...order([{ command: 'gate-session', issue: 30, assignment: 'g1', host: 'claude-code', 'host-session': localId(1) }]),
    epoch: parent.fence.epoch, expires_at: new Date(fx.github.clock + HOUR).toISOString() }));
  fx.output = '';
  cli.main(['run-order', '--order', file, '--session', controller.session, '--json'], { ...fx.deps(), orderClock: () => fx.github.clock });
  assert.equal(fx.child(30).private.gate_sessions[0].session, localId(1), fx.output);
  // G8: the same writer check as assign (requireGateWriter): a lane that does not hold the child is refused.
  const lane = fx.run(['gate-session', '--issue', '30', '--assignment', 'g1', '--closed', '--prefix', 'INT-TK999-'], { session: 'lane-1' });
  assert.ok(lane.error, 'a lane that does not hold the child is refused');
});

test('C-10: CLOSE_DUE acks up to 72 h, falls due again after, and is never disposed', () => {
  const fx = fixture([{ issue: 102, build: doc => setGate(launch(assign(doc, 'd2', 'G0'), 'd2'), 'RETIRED') }]);
  fx.pass();
  const id = fx.parent().attention.find(entry => entry.code === 'CLOSE_DUE').id;
  const now = new Date(fx.github.clock).toISOString();
  const doc = fx.parent();
  const over = new Date(fx.github.clock + 73 * HOUR).toISOString();
  assert.throws(() => state.answerFinding(doc, { id, state: 'acknowledged', next: 'the owner reads it first', due: over, now }), /at most 72 hours ahead for CLOSE_DUE/);
  assert.throws(() => state.answerFinding(doc, { id, state: 'disposed', reason: 'keep it', now }), error => error.code === 'FINDING_NO_DISPOSE' && /gate-session/.test(error.message));
  const acked = state.answerFinding(doc, { id, state: 'acknowledged', next: 'the owner reads it first', due: new Date(fx.github.clock + 72 * HOUR).toISOString(), now });
  assert.equal(acked.attention.find(item => item.id === id).state, 'acknowledged');
  const later = new Date(fx.github.clock + 73 * HOUR).toISOString();
  const callout = state.netCallout(acked.attention, later);
  assert.deepEqual(callout.entries.map(item => [item.code, item.state]), [['CLOSE_DUE', 'overdue']], 'past due it is in the callout');
});

test('C-11: attention shows the host and session beside each CLOSE_DUE; the session-start cache holds no session', () => {
  const fx = fixture([
    { issue: 102, build: doc => setGate(launch(assign(doc, 'd2', 'G0'), 'd2'), 'RETIRED') },
    { issue: 114, build: doc => setGate(launch(assign(doc, 'd14', 'G0'), 'd14', 'codex-app', null), 'RETIRED') },
  ]);
  fx.pass();
  const deps = fx.deps();
  fx.output = '';
  cli.main(['attention', '--json'], deps);
  const json = JSON.parse(fx.output);
  const due = json.findings.filter(entry => entry.code === 'CLOSE_DUE').map(entry => [entry.issue, entry.kind, entry.host, entry.session]).sort();
  assert.deepEqual(due, [[102, 'd2', 'claude-code', localId(2)], [114, 'd14', 'codex-app', null]]);
  fx.output = '';
  cli.main(['attention'], deps);
  assert.match(fx.output, new RegExp(`CLOSE_DUE d2 #102: Controller: .*\\n  Session: claude-code ${localId(2)}`));
  assert.match(fx.output, /CLOSE_DUE d14 #114: .*\n {2}Session: codex-app, no session ID recorded: find it by the assignment ID or title/);
  const cache = fs.readdirSync(deps.attentionDir).map(name => fs.readFileSync(path.join(deps.attentionDir, name), 'utf8')).join('\n');
  assert.ok(cache.length > 0, 'the cache was written');
  assert.equal(cache.includes('local_'), false, 'no session in the cache');
});

test('C-12: a recorded host session copied into a public field is refused, on the child and on the parent', () => {
  const child = launch(assign(state.newChild({ repository: 'acme/app', outcome: { issue: 30, class: 'COMMITTED', parent: 421, order: 1 } }), 'g1', 'G1'), 'g1', 'claude-code', localId(1));
  assert.doesNotThrow(() => state.publicView('child', child));
  assert.throws(() => state.publicView('child', { ...child, next_action: `Controller: archive ${localId(1)}` }), /raw session ID is in the public part/);
  const parent = state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 30, class: 'COMMITTED', parent: 421, order: 1 }] }), controller, {});
  const id = state.findingId('reconcile', 'CLOSE_DUE', 30, null, 'g1');
  const withDue = { ...parent, private: { ...parent.private, close_due: { [id]: { host: 'claude-code', session: localId(1) } } } };
  assert.deepEqual(state.validateParent(withDue), []);
  assert.doesNotThrow(() => state.publicView('parent', withDue));
  assert.throws(() => state.publicView('parent', { ...withDue, outcomes: [{ ...withDue.outcomes[0], description: `archive ${localId(1)}` }] }), /raw session ID/);
  assert.notDeepEqual(state.validateParent({ ...withDue, private: { close_due: { [id]: { host: 'claude-code', session: 'not-a-local-id' } } } }), [], 'the parent reader checks the copy too');
});

test('C-13: validateAttention takes kind on CLOSE_DUE as an assignment ID and still refuses kind on other codes', () => {
  const at = '2026-11-23T10:00:00.000Z';
  const entry = (code, kind) => ({ id: state.findingId('reconcile', code, 30, null, kind), source: 'reconcile', code, issue: 30, head: null, state: 'new', first_seen: at, changed_at: at, ...(kind ? { kind } : {}) });
  const parent = state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 30, class: 'COMMITTED', parent: 421, order: 1 }] }), controller, {});
  const errors = list => state.validateParent({ ...parent, attention: list });
  assert.deepEqual(errors([entry('CLOSE_DUE', 'G1.r2_x-1')]), []);
  assert.notDeepEqual(errors([entry('CLOSE_DUE', null)]), [], 'a close-due finding needs its assignment');
  assert.notDeepEqual(errors([entry('CLOSE_DUE', 'has space')]), []);
  assert.notDeepEqual(errors([entry('TASK_IDLE', 'g1')]), [], 'kind on another code is still refused');
  assert.deepEqual(errors([entry('CLOSING_COMMENT_MISSING', 'pr')]), []);
});

test('C-15: default-deny readers for --host and --host-session refuse every hostile input', () => {
  const doc = assign(state.newChild({ repository: 'acme/app', outcome: { issue: 30, class: 'COMMITTED', parent: 421, order: 1 } }), 'g1', 'G1');
  const takes = (host, session) => { try { state.recordGateSession(doc, { assignment: 'g1', host, session, now: NOW }); return true; } catch { return false; } };
  hostile.expectDefaultDeny(assert, text => takes(text, null), hostile.shapes);
  hostile.expectDefaultDeny(assert, text => takes('codex-app', text), hostile.shapes);
  hostile.expectDefaultDeny(assert, text => takes('claude-code', text), hostile.shapes);
  // G10 shapes the plan names.
  for (const bad of ['local_abc def', 'local_../x', 'a@b.example.com', 'https://x.test/y', `local_${'A'.repeat(8)}-aaaa-4bbb-8ccc-${'b'.repeat(12)}`, 'short']) {
    assert.equal(takes('claude-code', bad), false, bad);
  }
  assert.equal(takes('claude-code', localId(3)), true);
  assert.equal(takes('codex-app', 'thread_0123456789'), true);
  assert.equal(takes('codex-app', 'thread/0123456789'), false);
});
