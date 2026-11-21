'use strict';

// Agent UAT starts as each PR lands, in parallel with the gate lane. A landed task whose owed agent
// UAT has not started is flagged (AGENT_UAT_UNSTARTED, work queue) and a new G0 or G1 assignment is
// refused until its start (STARTED) is recorded or the finding is disposed with a reason. A started
// UAT, however long, never blocks, and G2 never waits. Rows follow the G0 plan's closure matrix.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const HEAD = 'c'.repeat(40);
const OLDER = 'd'.repeat(40);
const LANDED = 423;
const TASK = 424;
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uat-lane-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const record = (agentState, head = HEAD) => ({ state: agentState, at_head: head, evidence: 'evidence/uat-423-agent/REPORT.md' });

// Task #423 landed (PR #22 merged at HEAD, a UAT owed there); task #424 waits for its next gate.
function fixture({ agent = null, uat = { state: 'PENDING', at_head: HEAD } } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const catalogue = [LANDED, TASK].map((issue, i) => ({ issue, class: 'COMMITTED', parent: 421, order: i + 1 }));
  const binding = state.validateBinding({
    schema: state.SCHEMA.bindingV2, repository, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'INT-TK421-' }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  });
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const outcome of catalogue) github.addIssue(outcome.issue, { parent: 421 });
  github.addPr(22, { head: HEAD, merged: true, state: 'MERGED', body: `Refs #${LANDED}` });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: catalogue }), controller, {}), { sha: null, previous: null });
  const landed = state.newChild({ repository, outcome: catalogue[0] });
  Object.assign(landed, { lifecycle: 'ACTIVE', pr: { ...landed.pr, number: 22 }, uat, private: { ...landed.private, ...(agent ? { agent_uat: agent } : {}) } });
  store.write('child', LANDED, landed, { sha: null, previous: null });
  store.write('child', TASK, state.newChild({ repository, outcome: catalogue[1] }), { sha: null, previous: null });
  const fx = { github, store, output: '' };
  fx.parent = () => store.read('parent', 421).doc;
  fx.child = n => store.read('child', n).doc;
  fx.run = argv => {
    fx.output = '';
    const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0', lockFile: path.join(tmp(), 'pass.lock'),
      attentionDir: tmp(), environment: {}, now: () => new Date(github.clock).toISOString(), stdout: { write: text => { fx.output += text; } }, stderr: { write: () => {} } };
    try {
      cli.main([...argv, '--session', controller.session, '--controller', '--json'], deps);
      return { result: JSON.parse(fx.output.split(/\n(?=\{)/).at(-1)), error: null };
    } catch (error) { return { result: null, error }; }
  };
  fx.sweep = () => { const run = fx.run(['reconcile', '--apply']); assert.equal(run.error, null, run.error?.message); return run.result; };
  fx.finding = () => fx.parent().attention.find(entry => entry.code === 'AGENT_UAT_UNSTARTED' && entry.issue === LANDED) || null;
  fx.open = () => { const entry = fx.finding(); return Boolean(entry && ['new', 'acknowledged'].includes(entry.state)); };
  fx.patch = value => { const file = path.join(tmp(), 'patch.json'); fs.writeFileSync(file, JSON.stringify(value)); return file; };
  fx.recordAgent = agentState => {
    const run = fx.run(['update', '--issue', String(LANDED), '--patch', fx.patch({ private: { agent_uat: record(agentState) } })]);
    assert.equal(run.error, null, run.error?.message);
  };
  fx.assign = (role, id, issue = TASK) => fx.run(['assign', '--issue', String(issue), '--role', role, '--assignment', id]);
  return fx;
}

test('row 1: an unstarted agent UAT refuses a new G0 or G1 assignment and writes nothing', () => {
  const fx = fixture();
  fx.sweep();
  assert.equal(fx.open(), true, 'the sweep flags the landed task');
  assert.equal(fx.finding().head, HEAD, 'bound to the owed UAT\'s head');
  const before = JSON.stringify(fx.child(TASK));
  for (const [role, id] of [['G0', 'g0-a1'], ['G1', 'g1-a1']]) {
    const { error } = fx.assign(role, id);
    assert.equal(error?.code, 'AGENT_UAT_UNSTARTED', role);
    assert.match(error.message, new RegExp(`#${LANDED} at ${HEAD.slice(0, 7)} has not started`));
    assert.match(error.message, /record its start .*STARTED.*dispose --finding [0-9a-f]{12}/);
    assert.equal(JSON.stringify(fx.child(TASK)), before, `${role}: nothing written`);
  }
  // Reopening an accepted G1 opens a new G1 assignment: refused too.
  fx.store.mutate('child', TASK, { writer: controller, parentDoc: fx.parent(), change: doc => ({ ...doc, lifecycle: 'ACTIVE', gate: { ...doc.gate, role: 'G1', state: 'RETIRED', assignment: { id: 'g1-old', role: 'G1' } } }) });
  const accepted = JSON.stringify(fx.child(TASK));
  const reopened = fx.run(['reopen', '--issue', String(TASK), '--reason', 'correction', '--assignment', 'g1-fix']);
  assert.equal(reopened.error?.code, 'AGENT_UAT_UNSTARTED');
  assert.equal(JSON.stringify(fx.child(TASK)), accepted, 'reopen: nothing written');
});

test('row 2: recording the start lets the assignment through at once, before the next sweep', () => {
  const fx = fixture();
  fx.sweep();
  fx.recordAgent('STARTED');
  assert.equal(fx.open(), true, 'the stored finding is stale until the next pass');
  const { error } = fx.assign('G1', 'g1-a1');
  assert.equal(error, null, error?.message);
  assert.equal(fx.child(TASK).gate.state, 'ASSIGNED');
  fx.sweep();
  assert.equal(fx.finding().state, 'resolved', 'the next pass clears it');
});

test('row 3: a started agent UAT that never finishes never blocks and is never flagged', () => {
  const fx = fixture({ agent: record('STARTED') });
  fx.sweep();
  assert.equal(fx.finding(), null);
  for (const [role, id] of [['G0', 'g0-a1']]) assert.equal(fx.assign(role, id).error, null, role);
  fx.run(['interrupt', '--issue', String(TASK), '--reason', 'next gate']);
  assert.equal(fx.assign('G1', 'g1-a1').error, null, 'G1');
});

test('row 4: G2 is never held by an unstarted agent UAT', () => {
  const fx = fixture();
  fx.sweep();
  assert.equal(fx.open(), true);
  const { error } = fx.assign('G2', 'g2-a1');
  assert.equal(error, null, error?.message);
});

test('row 5: a finding disposed with a reason no longer blocks, and attention keeps the reason', () => {
  const fx = fixture();
  fx.sweep();
  const { id } = fx.finding();
  const reason = 'Owner: hold this UAT until the laptop is back';
  assert.equal(fx.run(['dispose', '--finding', id, '--reason', reason]).error, null);
  const { error } = fx.assign('G0', 'g0-a1');
  assert.equal(error, null, error?.message);
  assert.equal(fx.parent().private.attention_notes[id], reason);
  fx.sweep();
  assert.equal(fx.finding().state, 'disposed', 'stays disposed while the condition holds');
});

test('a repeated assign of an assignment already issued is not a new gate start', () => {
  const fx = fixture({ agent: record('STARTED') });
  assert.equal(fx.assign('G1', 'g1-a1').error, null);
  fx.store.mutate('child', LANDED, { writer: controller, parentDoc: fx.parent(), change: doc => ({ ...doc, private: { ...doc.private, agent_uat: undefined } }) });
  fx.sweep();
  assert.equal(fx.open(), true);
  assert.equal(fx.assign('G1', 'g1-a1').error, null, 'the same order again changes nothing and is not refused');
  assert.equal(fx.assign('G1', 'g1-a2', LANDED).error?.code, 'AGENT_UAT_UNSTARTED', 'a new one on another task is');
});

// Row 6: the sweep raises the finding only while the landed task owes an unstarted agent UAT.
for (const [name, options, raised] of [
  ['N: no UAT owed', { uat: { state: 'NOT_REQUIRED', at_head: null } }, false],
  ['U: owed, nothing recorded', {}, true],
  ['U: a record at an older head only', { agent: record('PASSED', OLDER) }, true],
  ['S: STARTED at the head', { agent: record('STARTED') }, false],
  ['F: FAILED at the head', { agent: record('FAILED') }, false],
  ['P: PASSED at the head', { agent: record('PASSED') }, false],
  ['P: OWNER_ONLY at the head', { agent: record('OWNER_ONLY') }, false],
]) test(`row 6 sweep, ${name}: ${raised ? 'raised' : 'none'}`, () => {
  const fx = fixture(options);
  const report = fx.sweep();
  assert.equal(fx.open(), raised);
  if (raised) {
    const entry = report.findings.find(finding => finding.code === 'AGENT_UAT_UNSTARTED');
    assert.match(entry.detail, /agent UAT on PR #22 has not started/);
    assert.equal(state.workQueue(fx.parent().attention).some(item => item.code === 'AGENT_UAT_UNSTARTED'), true, 'it is on the work queue');
  }
});

test('row 6: a raised finding clears on STARTED, FAILED or PASSED, and a new owed head is a new finding', () => {
  for (const agentState of ['STARTED', 'FAILED', 'PASSED']) {
    const fx = fixture();
    fx.sweep();
    fx.recordAgent(agentState);
    fx.sweep();
    assert.equal(fx.finding().state, 'resolved', agentState);
  }
  const fx = fixture({ agent: record('STARTED') });
  fx.store.mutate('child', LANDED, { writer: controller, parentDoc: fx.parent(), change: doc => ({ ...doc, uat: { state: 'PENDING', at_head: OLDER } }) });
  fx.github.prs.get(22).head = OLDER;
  fx.sweep();
  assert.equal(fx.finding().head, OLDER, 'owed again at a new head: flagged for that head');
});

test('row 7: STARTED is a valid agent record that only the controller writes', () => {
  const fx = fixture();
  const doc = fx.child(LANDED);
  const next = state.applyPatch('child', doc, { private: { agent_uat: record('STARTED') } }, { writer: controller, parentDoc: fx.parent() });
  assert.deepEqual(state.validateChild(next), []);
  assert.equal(state.uatOwer(next), 'agent', 'a started UAT is still the agent\'s');
  const executor = { session: 'executor', prefix: 'BUILD-' };
  assert.throws(() => state.applyPatch('child', doc, { private: { agent_uat: record('STARTED') } }, { writer: executor, parentDoc: fx.parent() }), { code: 'ROLE_REFUSED' });
  // The owner's PASS still needs the agent's PASS or OWNER_ONLY: STARTED is not enough.
  assert.throws(() => state.applyPatch('child', next, { uat: { state: 'PASSED', at_head: HEAD } }, { writer: controller, parentDoc: fx.parent() }), { code: 'UAT_AGENT_FIRST' });
});

test('row 8: the board and the task page tell a started agent UAT from one not started', () => {
  const cells = fx => {
    const row = fx.github.issues.get(421).body.split('\n').find(line => line.startsWith('|') && line.includes(`|#${LANDED}|`)).slice(1, -1).split('|');
    const prRow = fx.github.issues.get(LANDED).body.split('\n').find(line => /^\|[^|]*\|#22\|/.test(line)).split('|')[3];
    return [row[2], row[3], prRow];
  };
  const fresh = fixture();
  fresh.sweep();
  assert.deepEqual(cells(fresh), ['NOW · AGENT UAT', 'Agent: UAT on PR #22, not started', 'MERGED · Agent UAT owed, not started']);
  fresh.recordAgent('STARTED');
  fresh.sweep();
  assert.deepEqual(cells(fresh), ['NOW · AGENT UAT', 'Agent: UAT on PR #22, started', 'MERGED · Agent UAT owed, started']);
  fresh.recordAgent('FAILED');
  fresh.sweep();
  assert.deepEqual(cells(fresh), ['NOW · AGENT UAT', 'Agent: UAT failed on PR #22', 'MERGED · Agent UAT owed']);
});
