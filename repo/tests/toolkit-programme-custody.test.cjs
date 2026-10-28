'use strict';

// Executor custody: gate assignments, checkpoint journals, returns, the turn-end hook and the host
// contract. One table drives every gate command through every gate state as the controller and as
// every other role, through the command line against the in-memory GitHub; walks follow a gate from
// assignment to acceptance, including the actor that loses authority on the way.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const checkpoint = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
const hook = require('../scripts/toolkit-programme-checkpoint-hook.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TREE = 'e'.repeat(40);
const GIT = 'git-for-tests';
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const GOVERNED = () => ({ state: 'ENABLED', governed_rules_bind: true, programme_records_bind: true });
// The fixture's binding as merged on the default branch: its working-tree file.
const MERGED = root => state.loadBinding(root);
const green = name => ({ kind: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', required: false });
const CATALOGUE = [
  { issue: 423, label: 'C2', class: 'COMMITTED', parent: 421, order: 1 },
  { issue: 467, label: 'Shared H', class: 'COMMITTED', parent: 421, order: 2 },
];
const LANE_PREFIX = 'CDX-TK469-';
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-custody-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// Local git, answered without a process: the checkout is on `feature` at `head`, clean, one ahead.
function fakeGit(fx) {
  return (file, args) => {
    fx.spawns.push([file, ...args]);
    if (file !== GIT) return { error: new Error(`unexpected executable ${file}`) };
    const command = args.slice(2).join(' ');
    const out = {
      'rev-parse --abbrev-ref HEAD': 'feature', 'rev-parse HEAD': fx.head, 'rev-parse HEAD^{tree}': TREE,
      'status --porcelain=v1 --untracked-files=normal': '', 'rev-list --left-right --count @{upstream}...HEAD': '0\t1',
    }[command];
    return out === undefined ? { status: 1, stdout: '', stderr: 'unknown' } : { status: 0, stdout: `${out}\n`, stderr: '' };
  };
}

function fixture({ lane = false } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  const catalogue = CATALOGUE.map(outcome => (lane && outcome.issue === 423 ? { ...outcome, owner_prefix: LANE_PREFIX } : outcome));
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const outcome of catalogue) github.addIssue(outcome.issue, { body: `Body of ${outcome.issue}` });
  github.addPr(540, { head: SHA_A, contexts: [green('validate')], branch: 'feature' });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: catalogue }), controller, {}), { sha: null, previous: null });
  const repoRoot = tmp();
  fs.mkdirSync(path.join(repoRoot, '.github'));
  fs.writeFileSync(path.join(repoRoot, '.github', 'toolkit-programme.json'), JSON.stringify(binding));
  const fx = { github, binding, store, catalogue, repoRoot, sessionsDir: tmp(), spawns: [], head: SHA_A, output: '' };
  fx.parentDoc = () => store.read('parent', 421).doc;
  fx.child = (issue = 423) => store.read('child', issue).doc;
  fx.deps = (extra = {}) => ({
    transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot, toolkitVersion: '3.9.0', sessionsDir: fx.sessionsDir,
    gitPath: GIT, run: fakeGit(fx), now: () => new Date(github.clock).toISOString(), environment: { TOOLKIT_PROGRAMME_SESSION: controller.session }, governanceState: GOVERNED, mergedBinding: MERGED,
    stdout: { write: text => { fx.output += text; } }, ...extra,
  });
  // Runs one command; returns { result, error }. Output is JSON for every command used here.
  fx.run = (argv, extra) => {
    fx.output = '';
    try {
      cli.main([...argv, '--json'], fx.deps(extra));
      return { result: JSON.parse(fx.output), error: null };
    } catch (error) {
      return { result: null, error };
    }
  };
  fx.ctrl = argv => {
    const { result, error } = fx.run([...argv, '--session', controller.session, '--controller']);
    if (error) throw error;
    return result;
  };
  // An executor's turn end, as its host would run the hook.
  fx.turnEnd = (session, message = null, extra = {}) => checkpoint.runHook({ hook_event_name: 'Stop', session_id: session, last_assistant_message: message },
    { transport: github, sessionsDir: fx.sessionsDir, gitPath: GIT, run: fakeGit(fx), now: () => new Date(github.clock).toISOString(), governanceState: GOVERNED, mergedBinding: MERGED, ...extra });
  fx.reconcile = () => {
    const reconciler = new state.Reconciler({
      store, reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
      binding, writer: controller, toolkitVersion: '3.9.0',
    });
    return reconciler.run({ apply: true });
  };
  return fx;
}

const returnBlock = (id, { verdict = 'ACCEPT', head = SHA_A, next = 'Controller: start G2 at this head', blockers = 'none' } = {}) =>
  `Work is done.\n\n\`\`\`toolkit-return\nreturn_id: ${id}\nverdict_requested: ${verdict}\nat_head: ${head}\nnext_action: ${next}\nblockers: ${blockers}\n\`\`\`\n`;

// --- Gate states built directly as the controller, then driven through the command line. ---

const STATES = ['NONE', 'ASSIGNED', 'ACTIVE', 'SUBMITTED', 'WAITING_OWNER', 'INTERRUPTED', 'RETIRED'];

function withGate(fx, gateState) {
  const parentDoc = fx.parentDoc();
  let doc = state.newChild({ repository: 'acme/app', outcome: fx.catalogue[0] });
  doc.candidate.branch = 'feature';
  doc = state.applyPatch('child', doc, { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } }, { writer: controller, parentDoc });
  const consume = (current, verdict) => state.consumeReturn(current, { returnId: 'r1', verdict, writer: controller, parentDoc, liveHead: SHA_A });
  const assigned = current => state.assignGate(current, { assignment: 'g1-a1', role: 'G1' });
  const submitted = current => state.recordReturn(assigned(current), { returnId: 'r1', assignment: 'g1-a1' });
  const build = {
    NONE: current => current,
    ASSIGNED: assigned,
    SUBMITTED: submitted,
    ACTIVE: current => consume(submitted(current), 'REOPEN'),
    WAITING_OWNER: current => consume(submitted(current), 'WAITING_OWNER'),
    INTERRUPTED: current => state.interruptGate(assigned(current), { reason: 'session lost' }),
    RETIRED: current => consume(submitted(current), 'ACCEPT'),
  };
  doc = build[gateState](doc);
  assert.equal(doc.gate.state, gateState === 'NONE' ? null : gateState);
  fx.store.write('child', 423, doc, { sha: null, previous: null });
}

const S = gateState => ({ state: gateState });
const E = code => ({ error: code });
const NOOP = { noop: true };
const LIVE = E('ASSIGNMENT_LIVE');
const GS = E('GATE_STATE');
const SA = E('STALE_ASSIGNMENT');
const RU = E('RETURN_UNKNOWN');
const RC = E('RETURN_CONFLICT');
// Expected result per command, in STATES order.
const TABLE = [
  ['assign --issue 423 --role G1 --assignment g1-new', [S('ASSIGNED'), LIVE, LIVE, LIVE, LIVE, S('ASSIGNED'), GS]],
  ['assign --issue 423 --role G2 --assignment g2-a1', [S('ASSIGNED'), LIVE, LIVE, LIVE, LIVE, S('ASSIGNED'), S('ASSIGNED')]],
  ['assign --issue 423 --role G1 --assignment g1-a1', [S('ASSIGNED'), NOOP, E('USAGE'), E('USAGE'), E('USAGE'), E('USAGE'), E('USAGE')]],
  ['assign --issue 423 --role G1 --assignment g1-new --supersede --reason session-lost', [GS, S('ASSIGNED'), S('ASSIGNED'), S('ASSIGNED'), S('ASSIGNED'), GS, GS]],
  ['reopen --issue 423 --reason correction', [GS, GS, GS, S('ACTIVE'), S('ACTIVE'), GS, E('USAGE')]],
  ['reopen --issue 423 --reason correction --assignment g1-fix', [GS, GS, GS, GS, GS, GS, S('ASSIGNED')]],
  ['interrupt --issue 423 --reason session-lost', [GS, S('INTERRUPTED'), S('INTERRUPTED'), S('INTERRUPTED'), S('INTERRUPTED'), GS, GS]],
  ['return --issue 423 --record r2 --assignment g1-a1', [SA, S('SUBMITTED'), S('SUBMITTED'), GS, GS, SA, SA]],
  ['return --issue 423 --record r1 --assignment g1-a1', [SA, S('SUBMITTED'), RC, NOOP, RC, SA, SA]],
  ['return --issue 423 --record r2 --assignment g1-old', [SA, SA, SA, SA, SA, SA, SA]],
  ['return --issue 423 --consume r1 --verdict ACCEPT', [RU, RU, RC, S('RETIRED'), RC, RU, NOOP]],
  ['return --issue 423 --consume r1 --verdict REOPEN', [RU, RU, NOOP, S('ACTIVE'), RC, RU, RC]],
  ['return --issue 423 --consume r1 --verdict WAITING_OWNER', [RU, RU, RC, S('WAITING_OWNER'), NOOP, RU, RC]],
];

// The other roles and the refusal each gets for every gate command in every state.
const ROLES = [
  { name: 'EXEC', args: ['--session', 'exec-a', '--controller'], code: 'STALE_WRITER' },
  { name: 'CTRL_STOPPED', args: ['--session', controller.session, '--controller'], code: 'STALE_WRITER', stopped: true },
  { name: 'LANE (not delegated)', args: ['--session', 'lane-1', '--prefix', LANE_PREFIX, '--controller'], code: 'ROLE_REFUSED' },
  { name: 'ANY (no session)', args: ['--controller'], code: 'WRITER_UNKNOWN' },
  { name: 'ANY (no controller flag)', args: ['--session', 'exec-a'], code: 'USAGE', noCalls: true },
];

test('every gate command in every gate state: the controller gets the table result, every other role a refusal with no write', () => {
  let cases = 0;
  for (const [command, results] of TABLE) {
    STATES.forEach((gateState, index) => {
      for (const role of [null, ...ROLES]) {
        const fx = fixture();
        withGate(fx, gateState);
        if (role?.stopped) {
          fx.store.mutate('parent', 421, { writer: { session: 'controller-2', prefix: 'INT-TK421-' }, authorise: false,
            change: doc => state.claimDocument(doc, { session: 'controller-2', prefix: 'INT-TK421-' }, { takeover: true }) });
        }
        const before = fx.child();
        const commits = fx.github.commits;
        const mutations = fx.github.mutations();
        const calls = fx.github.calls.length;
        const label = `${role?.name || 'CTRL'} / ${gateState} / ${command}`;
        const { error } = fx.run([...command.split(' '), ...(role ? role.args : ['--session', controller.session, '--controller'])]);
        cases += 1;
        const expected = role ? E(role.code) : results[index];
        if (expected.error) {
          assert.equal(error?.code, expected.error, `${label}: ${error?.message}`);
          if (role?.noCalls) assert.equal(fx.github.calls.length, calls, `${label}: refused before any GitHub call`);
          assert.equal(fx.github.commits, commits, `${label}: a refusal writes no state`);
          assert.equal(fx.github.mutations(), mutations, `${label}: a refusal changes nothing on GitHub`);
          assert.deepEqual(fx.child(), before, `${label}: the child is unchanged`);
          if (role?.stopped) assert.match(error.message, /A controller stopped by a takeover stops and reports to the owner\./, label);
          if (role) assert.doesNotMatch(error.message, /--takeover/, `${label}: never invites a takeover`);
          continue;
        }
        assert.equal(error, null, `${label}: ${error?.code} ${error?.message}`);
        if (expected.noop) {
          assert.equal(fx.github.commits, commits, `${label}: a repeat writes nothing`);
          assert.deepEqual(fx.child(), before, label);
        } else {
          assert.equal(fx.github.commits, commits + 1, `${label}: one state write`);
          assert.equal(fx.child().gate.state, expected.state, label);
        }
        assert.equal(fx.github.mutations(), mutations, `${label}: gate commands never change GitHub issues`);
      }
    });
  }
  assert.equal(cases, TABLE.length * STATES.length * (ROLES.length + 1));
});

test('a G1 acceptance needs a G2 review passed at the live PR head', () => {
  const fx = fixture();
  withGate(fx, 'SUBMITTED');
  fx.github.prs.get(540).head = SHA_B;
  const { error } = fx.run(['return', '--issue', '423', '--consume', 'r1', '--verdict', 'ACCEPT', '--session', controller.session, '--controller']);
  assert.equal(error?.code, 'EVIDENCE_STALE');
  assert.match(error.message, /bbbbbbb/);
  assert.equal(fx.child().gate.state, 'SUBMITTED');
});

// --- Walks ---

test('W1 G0 to G1 handover: a late turn from the old assignment is reported stale once and changes nothing', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G0', '--assignment', 'g0-a1']);
  const bound = fx.run(['bind', '--issue', '423', '--assignment', 'g0-a1', '--session', 'exec-a', '--model', 'opus', '--effort', 'high', '--route-read-back']);
  assert.equal(bound.error, null, bound.error?.message);
  assert.deepEqual(bound.result.acting, { session_hash: checkpoint.sessionHash('exec-a'), issue: 423, assignment: 'g0-a1' });
  assert.equal(fx.reconcile().findings.some(entry => entry.code === 'GATE_ACTIVE'), true);
  assert.equal(fx.child().gate.state, 'ACTIVE');
  const turn = fx.turnEnd('exec-a', returnBlock('g0-r1', { next: 'Controller: admit G1' }));
  assert.ok(!['FAILED', 'UNBOUND', 'NOOP'].includes(turn.outcome), JSON.stringify(turn));
  const captured = fx.reconcile();
  assert.ok(captured.findings.some(entry => entry.code === 'RETURN_CAPTURED'));
  assert.equal(fx.child().gate.state, 'SUBMITTED');
  assert.equal(fx.child().gate.returns.at(-1).mode, 'native');
  fx.ctrl(['return', '--issue', '423', '--consume', 'g0-r1', '--verdict', 'ACCEPT']);
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  assert.equal(fx.reconcile().findings.filter(entry => entry.code === 'STALE_ASSIGNMENT').length, 0, 'journals seen before the handover are not reported');
  fx.head = SHA_B;
  assert.notEqual(fx.turnEnd('exec-a').outcome, 'FAILED', 'the old session can still journal');
  const stale = fx.reconcile();
  assert.deepEqual(stale.findings.filter(entry => entry.code === 'STALE_ASSIGNMENT').map(entry => entry.issue), [423]);
  assert.equal(fx.reconcile().findings.filter(entry => entry.code === 'STALE_ASSIGNMENT').length, 0, 'reported once');
  assert.deepEqual([fx.child().gate.role, fx.child().gate.state], ['G1', 'ASSIGNED']);
  assert.equal(fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-b']).error, null);
  fx.reconcile();
  assert.equal(fx.child().gate.state, 'ACTIVE');
});

test('W2 correction loop: REOPEN keeps the session, the close list counts completion only after G1 is accepted at the live head', () => {
  const fx = fixture();
  const dir = tmp();
  const patch = (name, value) => { const file = path.join(dir, `${name}.json`); fs.writeFileSync(file, JSON.stringify(value)); return file; };
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.ctrl(['update', '--issue', '423', '--patch', patch('branch', { candidate: { branch: 'feature' } })]);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  fx.turnEnd('exec-a', returnBlock('g1-r1'));
  fx.reconcile();
  assert.equal(fx.child().gate.state, 'SUBMITTED');
  fx.ctrl(['update', '--issue', '423', '--patch', patch('fail', { review: { state: 'NOT_PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'NOT_PASSED' }] } })]);
  assert.equal(fx.run(['return', '--issue', '423', '--consume', 'g1-r1', '--verdict', 'ACCEPT', '--session', controller.session, '--controller']).error?.code, 'EVIDENCE_STALE');
  fx.ctrl(['return', '--issue', '423', '--consume', 'g1-r1', '--verdict', 'REOPEN']);
  assert.equal(fx.child().gate.state, 'ACTIVE');
  Object.assign(fx.github.prs.get(540), { head: SHA_B, rollupOid: SHA_B });
  fx.head = SHA_B;
  fx.turnEnd('exec-a', returnBlock('g1-r2', { head: SHA_B }));
  fx.reconcile();
  assert.equal(fx.child().gate.state, 'SUBMITTED');
  assert.deepEqual(fx.child().gate.returns.map(entry => [entry.return_id, entry.verdict]), [['g1-r1', 'REOPEN'], ['g1-r2', null]]);
  fx.github.prs.get(540).merged = true;
  const before = fx.reconcile();
  assert.equal(before.close_list[0].accepted, false);
  assert.ok(before.findings.some(entry => entry.code === 'CHILD_STATE_CONFLICT'));
  fx.ctrl(['update', '--issue', '423', '--patch', patch('pass', { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_B, verdict: 'PASSED' }] } })]);
  fx.ctrl(['return', '--issue', '423', '--consume', 'g1-r2', '--verdict', 'ACCEPT']);
  const after = fx.reconcile();
  assert.equal(after.close_list[0].accepted, true);
  assert.equal(after.findings.some(entry => entry.code === 'CHILD_STATE_CONFLICT'), false);
});

test('W3 an accepted gate reopened for a correction loses its acceptance and the same builder binds the new assignment', () => {
  const fx = fixture();
  withGate(fx, 'RETIRED');
  assert.equal(state.completionAccepted(fx.child()), true);
  fx.ctrl(['reopen', '--issue', '423', '--reason', 'G2 failed after acceptance', '--assignment', 'g1-fix']);
  assert.deepEqual([fx.child().gate.state, state.completionAccepted(fx.child())], ['ASSIGNED', false]);
  assert.equal(fx.run(['bind', '--issue', '423', '--assignment', 'g1-fix', '--session', 'exec-a']).error, null);
  assert.equal(fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']).error?.code, 'STALE_ASSIGNMENT');
});

test('W4 and W5 a parent takeover needs a read-back record; the replaced controller is refused afterwards', () => {
  const successor = ['--session', 'controller-2', '--controller'];
  const takeover = (fx, record) => fx.run(['claim', '--parent', '--takeover', ...(record ? ['--takeover-record', String(record)] : []), ...successor]);
  const cases = [
    ['no record', () => null],
    ['another issue', fx => fx.github.addComment(423, { body: 'INT-TK421-090 takeover from epoch 1' })],
    ['another account', fx => fx.github.addComment(421, { body: 'INT-TK421-090 takeover from epoch 1', login: 'someone-else' })],
    ['no decision ID', fx => fx.github.addComment(421, { body: 'Takeover from epoch 1' })],
    ['wrong prefix', fx => fx.github.addComment(421, { body: 'CDX-TK469-090 takeover from epoch 1' })],
    ['wrong epoch', fx => fx.github.addComment(421, { body: 'INT-TK421-090 takeover from epoch 7' })],
    ['older than the last write', fx => fx.github.addComment(421, { body: 'INT-TK421-090 takeover from epoch 1', createdAt: '2026-01-01T00:00:00Z' })],
  ];
  for (const [name, make] of cases) {
    const fx = fixture();
    const commits = fx.github.commits;
    const { error } = takeover(fx, make(fx));
    assert.equal(error?.code, 'TAKEOVER_UNVERIFIED', `${name}: ${error?.message}`);
    assert.equal(fx.github.commits, commits, `${name}: no write`);
    assert.equal(fx.parentDoc().fence.epoch, 1, name);
  }
  const fx = fixture();
  const record = fx.github.addComment(421, { body: 'INT-TK421-090 takeover from epoch 1; previous session archived' });
  const taken = takeover(fx, record);
  assert.equal(taken.error, null, taken.error?.message);
  assert.equal(fx.parentDoc().fence.epoch, 2);
  const stopped = fx.run(['update-parent', '--patch', __filename, '--session', controller.session, '--controller']);
  assert.equal(stopped.error?.code, 'STALE_WRITER');
  const again = fx.run(['claim', '--parent', '--takeover', '--takeover-record', String(fx.github.addComment(421, { body: 'INT-TK421-091 takeover from epoch 2' })), '--session', controller.session, '--controller']);
  assert.equal(again.error?.code, 'STALE_WRITER', 'the replaced controller never takes the parent back');
  assert.match(again.error.message, /stops and reports to the owner/);
  assert.equal(fx.parentDoc().fence.holder_session, 'controller-2');
});

test('W6 session lost: the interrupted session\'s late turn is stale and the successor proceeds without a duplicate hold', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  fx.reconcile();
  fx.ctrl(['interrupt', '--issue', '423', '--reason', 'session lost']);
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2']);
  assert.equal(fx.run(['bind', '--issue', '423', '--assignment', 'g1-a2', '--session', 'exec-b']).error, null);
  fx.head = SHA_B;
  fx.turnEnd('exec-a', returnBlock('late-r1'));
  const report = fx.reconcile();
  assert.deepEqual(report.findings.filter(entry => entry.code === 'STALE_ASSIGNMENT').map(entry => entry.issue), [423]);
  assert.deepEqual(report.holds, []);
  assert.deepEqual([fx.child().gate.assignment.id, fx.child().gate.state, fx.child().gate.returns.length], ['g1-a2', 'ACTIVE', 0]);
});

test('W7 duplicate launch: a live assignment refuses another, and two sessions on one assignment hold the child', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  fx.reconcile();
  assert.equal(fx.run(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2', '--session', controller.session, '--controller']).error?.code, 'ASSIGNMENT_LIVE');
  assert.equal(fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-b']).error?.code, 'DUPLICATE_SESSION');
  // A second journal that reached the store anyway holds the child.
  const first = fx.store.listJournals(423)[0];
  const twin = { ...fx.store.readJournal(423, first.name).doc, session_hash: checkpoint.sessionHash('exec-b') };
  fx.github.putFile(`state/acme/app/journal/issue-423/g1-a1--${twin.session_hash}.json`, twin);
  const report = fx.reconcile();
  assert.deepEqual(report.holds.map(hold => hold.code), ['DUPLICATE_SESSION']);
});

test('W8 a cloud executor\'s return is recorded by the controller as toolkit assisted', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.ctrl(['return', '--issue', '423', '--record', 'g1-r1', '--assignment', 'g1-a1', '--at-head', SHA_A]);
  const { gate } = fx.child();
  assert.equal(gate.state, 'SUBMITTED');
  assert.deepEqual(gate.returns.map(entry => [entry.return_id, entry.mode, entry.at_head]), [['g1-r1', 'toolkit_assisted', SHA_A]]);
});

test('W9 the turn-end hook does nothing for unbound sessions, unbound repositories and other events', () => {
  const fx = fixture();
  let transportCalls = 0;
  const counting = { request: () => { transportCalls += 1; return { status: 500, json: null }; }, graphql: () => { transportCalls += 1; } };
  const deps = { transport: counting, sessionsDir: fx.sessionsDir, gitPath: GIT, run: fakeGit(fx) };
  for (const input of [{ hook_event_name: 'Stop', session_id: 'nobody' }, { hook_event_name: 'Stop' }, { hook_event_name: 'Stop', session_id: '   ' },
    { hook_event_name: 'PreToolUse', session_id: 'nobody' }, null, 'not json']) {
    const stdin = typeof input === 'string' ? input : JSON.stringify(input);
    assert.equal(hook.main({ ...deps, stdin }), 0);
  }
  // A bound session whose repository lost its binding file.
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  fs.rmSync(path.join(fx.repoRoot, '.github', 'toolkit-programme.json'));
  fx.spawns.length = 0;
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 'exec-a' }) }), 0);
  assert.equal(checkpoint.runHook({ session_id: 'exec-a' }, deps).outcome, 'UNBOUND');
  assert.deepEqual([fx.spawns.length, transportCalls], [0, 0], 'no git, gh or network call');
  assert.deepEqual(fs.readdirSync(fx.sessionsDir).filter(name => name.endsWith('.errors.json')), [], 'nothing recorded');
  // The real script, as a host runs it: exit 0 and no stdout, in a home without bindings.
  const home = tmp();
  const result = spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-programme-checkpoint-hook.cjs')], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'nobody', last_assistant_message: returnBlock('x1') }),
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 30000,
  });
  assert.deepEqual([result.status, result.stdout], [0, '']);
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit')), false);
});

test('W10 hook failures exit 0, stay local, reach the journal on the next run and never retry blindly', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  // Store unreachable: the turn is kept in the offline queue, not lost.
  const down = { request: () => ({ status: 503, json: { message: 'unavailable' } }), graphql: () => null };
  assert.equal(fx.turnEnd('exec-a', returnBlock('q1'), { transport: down }).outcome, 'QUEUED');
  assert.equal(checkpoint.readQueue(hash, { sessionsDir: fx.sessionsDir }).length, 1);
  // A refusal (not an unreachable GitHub) is a failure, recorded locally.
  const refused = { request: () => ({ status: 403, json: { message: 'forbidden' } }), graphql: () => null };
  const failed = fx.turnEnd('exec-a', null, { transport: refused });
  assert.equal(failed.outcome, 'FAILED');
  assert.equal(checkpoint.readErrors(hash, { sessionsDir: fx.sessionsDir }).pending.code, failed.code);
  const shown = fx.run(['show', '--session', 'exec-a']).result;
  assert.equal(shown.binding.repo_root, '(redacted)');
  assert.equal(shown.errors.recent.at(-1).code, failed.code);
  // Deadline passed: gh is never started; each call is capped at 8 seconds.
  const ghCalls = [];
  const run = (file, args, options) => {
    if (file === 'gh-for-tests') { ghCalls.push(options.timeout); return { status: 0, stdout: 'HTTP/2.0 500 Internal\n\n{}', stderr: '' }; }
    return fakeGit(fx)(file, args, options);
  };
  assert.equal(checkpoint.runHook({ session_id: 'exec-a' }, { sessionsDir: fx.sessionsDir, gitPath: GIT, ghPath: 'gh-for-tests', run, deadline: Date.now() - 1, governanceState: GOVERNED, mergedBinding: MERGED }).outcome, 'QUEUED', 'gh never started: queued');
  assert.deepEqual(ghCalls, []);
  checkpoint.runHook({ session_id: 'exec-a' }, { sessionsDir: fx.sessionsDir, gitPath: GIT, ghPath: 'gh-for-tests', run, deadline: Date.now() + 20000, governanceState: GOVERNED, mergedBinding: MERGED });
  assert.ok(ghCalls.length > 0 && ghCalls.every(timeout => timeout <= 8000), `per-call timeouts ${ghCalls}`);
  // A malformed block is not recorded as a return; the facts and the error code still reach the journal.
  const seqBefore = fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.seq;
  const next = fx.turnEnd('exec-a', 'Done.\n```toolkit-return\nreturn_id: r1\nverdict: ACCEPT\n```\n');
  assert.equal(next.error, 'RETURN_BLOCK_INVALID');
  assert.ok(next.replayed >= 1, 'the queued turns are replayed first');
  const journal = fx.store.readJournal(423, `g1-a1--${hash}.json`).doc;
  assert.equal(journal.seq, seqBefore + 1, 'queued turns and this one in one write');
  assert.deepEqual(journal.returns.map(entry => entry.return_id), ['q1'], 'the queued return reached the journal; the malformed one did not');
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, { sessionsDir: fx.sessionsDir })), false, 'the queue is deleted once written');
  assert.ok(journal.last_error);
  assert.equal(checkpoint.readErrors(hash, { sessionsDir: fx.sessionsDir }).pending, null, 'cleared once written');
  // An identical turn writes nothing.
  const commits = fx.github.commits;
  assert.equal(fx.turnEnd('exec-a').outcome, 'NOOP');
  assert.equal(fx.github.commits, commits);
  // The same block in a later turn writes nothing; a reused return ID with other content keeps the first.
  fx.turnEnd('exec-a', returnBlock('g1-r1'));
  const once = fx.github.commits;
  assert.deepEqual([fx.turnEnd('exec-a', returnBlock('g1-r1')).outcome, fx.github.commits], ['NOOP', once]);
  assert.equal(fx.turnEnd('exec-a', returnBlock('g1-r1', { verdict: 'WAITING_OWNER' })).error, 'RETURN_ID_REUSED');
  assert.deepEqual(fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.returns.filter(entry => entry.return_id === 'g1-r1').map(entry => entry.verdict_requested), ['ACCEPT']);
});

test('W11 bind takes the session only from --session, never from an inherited environment', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  for (const argv of [['bind', '--issue', '423', '--assignment', 'g1-a1'], ['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', '  '],
    ['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a', '--controller'], ['checkpoint']]) {
    assert.equal(fx.run(argv).error?.code, 'USAGE', argv.join(' '));
  }
  assert.equal(fx.run(['checkpoint', '--session', 'exec-a']).error?.code, 'NOT_BOUND');
  assert.equal(fx.store.listJournals(423).length, 0);
});

test('H4 the turn-end hook writes nothing to the store once GitHub governance is off or incomplete', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const journal = () => JSON.stringify(fx.store.readJournal(423, `g1-a1--${hash}.json`).doc);
  const before = journal();
  for (const [label, governanceState, outcome = 'GOVERNANCE_OFF'] of [
    ['disabled after bind', () => ({ state: 'DISABLED', governed_rules_bind: false })],
    ['enabled, setup not finished', () => ({ state: 'ENABLED', governed_rules_bind: false })],
    ['undecided', () => ({ state: 'UNDECIDED', governed_rules_bind: false })],
    // On with the governed rules, but not freshly read: the turn goes to the offline queue, not the store.
    ['merged binding read over 24 hours ago', () => ({ state: 'ENABLED', governed_rules_bind: true, programme_records_bind: false }), 'QUEUED'],
    ['merged binding unusable', () => ({ state: 'ERROR', governed_rules_bind: false, programme_records_bind: false })],
    ['state unreadable', () => { throw new Error('boom'); }],
  ]) {
    let calls = 0;
    const counting = { request: (...args) => { calls += 1; return fx.github.request(...args); }, graphql: (...args) => { calls += 1; return fx.github.graphql(...args); } };
    const result = fx.turnEnd('exec-a', returnBlock('h4'), { governanceState, transport: counting });
    assert.equal(result.outcome, outcome, label);
    assert.equal(calls, 0, `${label}: no store call`);
    assert.equal(journal(), before, label);
  }
  // Governance confirmed off deletes the queue: nothing queued is ever written.
  const sessions = { sessionsDir: fx.sessionsDir };
  assert.equal(checkpoint.readQueue(hash, sessions).length, 1);
  assert.deepEqual(fx.turnEnd('exec-a', null, { governanceState: () => ({ state: 'DISABLED', governed_rules_bind: false }) }), { outcome: 'GOVERNANCE_OFF', discarded: true });
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false);
  assert.equal(journal(), before);
  // Nothing merged on this computer's read (or the read is unusable): the working tree's copy never names the store.
  let mergedCalls = 0;
  const noMerged = { request: (...args) => { mergedCalls += 1; return fx.github.request(...args); }, graphql: (...args) => { mergedCalls += 1; return fx.github.graphql(...args); } };
  assert.equal(fx.turnEnd('exec-a', returnBlock('h4'), { mergedBinding: () => null, transport: noMerged }).outcome, 'GOVERNANCE_OFF', 'no merged binding');
  assert.equal(mergedCalls, 0);
  assert.equal(journal(), before);
  assert.notEqual(fx.turnEnd('exec-a', returnBlock('h4')).outcome, 'GOVERNANCE_OFF', 'ENABLED with the governed rules: the journal is written');
});

test('H5 a session a Toolkit launcher started never writes programme state, even with --controller', () => {
  const fx = fixture();
  const writes = [
    ['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1'],
    ['reconcile', '--apply'],
    ['update-parent'],
    ['return', '--issue', '423', '--consume', 'r1', '--verdict', 'ACCEPT'],
  ];
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING']) {
    const environment = { TOOLKIT_PROGRAMME_SESSION: controller.session, [marker]: 'G1' };
    for (const argv of writes) {
      const { error } = fx.run([...argv, '--session', controller.session, '--controller'], { environment });
      assert.equal(error?.code, 'USAGE', `${marker} ${argv[0]}`);
      assert.match(error.message, /started by a Toolkit launcher .* never writes programme state/, `${marker} ${argv[0]}`);
    }
    // Reading still works: the dry run and show.
    assert.equal(fx.run(['reconcile'], { environment }).error, null, marker);
  }
  assert.equal(fx.store.listJournals(423).length, 0);
  // Without a marker the controller writes as before.
  assert.equal(fx.run([...writes[0], '--session', controller.session, '--controller']).error, null);
});

test('W12 a lane controller assigns and interrupts only its delegated child', () => {
  const fx = fixture({ lane: true });
  const lane = ['--session', 'lane-1', '--prefix', LANE_PREFIX, '--controller'];
  const asLane = argv => fx.run([...argv, ...lane]);
  assert.equal(asLane(['claim', '--issue', '467', '--lane']).error?.code, 'NOT_DELEGATED');
  assert.equal(asLane(['claim', '--issue', '423', '--lane']).error, null);
  assert.equal(asLane(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']).error, null);
  assert.equal(asLane(['interrupt', '--issue', '423', '--reason', 'session lost']).error, null);
  assert.equal(fx.child().gate.state, 'INTERRUPTED');
  const dir = tmp();
  const patch = path.join(dir, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify({ next_action: 'Lane note' }));
  for (const argv of [['reopen', '--issue', '423', '--reason', 'x'], ['return', '--issue', '423', '--record', 'r1', '--assignment', 'g1-a1'],
    ['update', '--issue', '423', '--patch', patch], ['update-parent', '--patch', patch], ['assign', '--issue', '467', '--role', 'G1', '--assignment', 'g1-b1'],
    ['claim', '--parent']]) {
    const commits = fx.github.commits;
    assert.equal(asLane(argv).error?.code, 'ROLE_REFUSED', argv.join(' '));
    assert.equal(fx.github.commits, commits, argv.join(' '));
  }
});

// --- Contracts ---

test('the host contract matches the shipped hooks and the checkpoint limits', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/host-contract-v1.json'), 'utf8'));
  const hookSpec = contract.turn_end_hook;
  assert.equal(hookSpec.internal_deadline_seconds * 1000, checkpoint.HOOK_DEADLINE_MS);
  assert.ok(hookSpec.internal_deadline_seconds < hookSpec.timeout_seconds);
  assert.ok(fs.existsSync(path.join(ROOT, hookSpec.script)));
  for (const [host, spec] of Object.entries(contract.hosts)) {
    for (const file of [spec.hooks_file, `repo/contracts/toolkit-local-bridge/${host === 'codex' ? 'codex' : 'claude'}-plugin/hooks/hooks.json`]) {
      const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks;
      assert.deepEqual(hooks[hookSpec.event], [{ hooks: [{ type: 'command', command: `node "\${${spec.plugin_root_variable}}/${hookSpec.script}"`, timeout: hookSpec.timeout_seconds }] }], file);
    }
    assert.ok(['native', 'toolkit_assisted', 'unsupported'].includes(spec.completion_mode.local), host);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'repo/scripts/toolkit-programme-checkpoint-hook.ps1')));
  const script = fs.readFileSync(path.join(ROOT, hookSpec.script), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(script, /stdout|console\.|"decision"|'block'|return [^0]/, 'the hook never prints or blocks');
  assert.match(script, /process\.exitCode = main\(\)/);
  const launcher = fs.readFileSync(path.join(ROOT, 'repo/scripts/toolkit-programme-checkpoint-hook.ps1'), 'utf8');
  assert.deepEqual([...launcher.matchAll(/\bexit\s+(\S+)/g)].map(match => match[1]).filter(code => code !== '0'), [], 'the launcher always exits 0');
  const doc = fs.readFileSync(path.join(ROOT, 'repo/docs/HOST-CONTRACT.md'), 'utf8');
  assert.match(doc, new RegExp(`${hookSpec.timeout_seconds} seconds`));
  assert.match(doc, new RegExp(`at ${hookSpec.internal_deadline_seconds} seconds and each GitHub call at ${hookSpec.per_call_timeout_seconds}\\b`));
});

test('journals match their schema at runtime and in the JSON schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/journal-v1.schema.json'), 'utf8')));
  const facts = { branch: 'feature', head: SHA_A, tree: TREE, dirty: false, ahead: 1, behind: 0 };
  const first = checkpoint.newJournal({ repository: 'acme/app', issue: 423, assignment: 'g1-a1', hash: checkpoint.sessionHash('exec-a'), route: { model: 'opus', effort: 'high', read_back: true }, facts });
  const { entry } = checkpoint.parseReturnBlock(returnBlock('g1-r1', { blockers: 'owner UAT pending; docs' }));
  const second = checkpoint.nextJournal(first, { facts: { ...facts, dirty: true }, entry }).doc;
  assert.deepEqual(entry.blockers, ['owner UAT pending', 'docs']);
  for (const doc of [first, second, { ...second, volatile: { written_at: 'now' } }]) {
    assert.equal(validate(doc), true, JSON.stringify(validate.errors));
    assert.deepEqual(state.validateJournal(doc), []);
  }
  for (const bad of [{ ...first, extra: 1 }, { ...first, session_hash: 'XYZ' }, { ...first, completion_mode: 'toolkit_assisted' },
    { ...first, returns: [{ ...entry, verdict_requested: 'REOPEN' }] }, { ...first, seq: 0 }]) {
    assert.equal(validate(bad), false);
    assert.notDeepEqual(state.validateJournal(bad), []);
  }
});

test('Q1-Q4 the offline queue is bounded, kept in user-state, and replays a return only once', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const stale = () => ({ state: 'ENABLED', governed_rules_bind: true, programme_records_bind: false });
  const file = checkpoint.queueFile(hash, sessions);
  assert.equal(path.dirname(file), fx.sessionsDir, 'next to the session binding, never in the repository');
  // Older than seven days is dropped; the newest 200 are kept, and the drop is noted.
  const old = new Date(Date.now() - checkpoint.QUEUE_MAX_AGE_MS - 60000).toISOString();
  const recent = new Date().toISOString();
  // Entries as the queue writes them: time, repository, issue and assignment with the turn.
  const turn = at => ({ at, repository: 'acme/app', issue: 423, assignment: 'g1-a1', facts: null, entry: null });
  const entries = [turn(old), ...Array.from({ length: checkpoint.QUEUE_LIMIT }, () => turn(recent))];
  fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.programme-checkpoint-queue.v1', entries }));
  assert.equal(checkpoint.readQueue(hash, sessions).length, checkpoint.QUEUE_LIMIT, 'the old entry is past its seven days');
  assert.equal(fx.turnEnd('exec-a', returnBlock('q-new'), { governanceState: stale }).queued, checkpoint.QUEUE_LIMIT);
  assert.equal(checkpoint.readErrors(hash, sessions).recent.at(-1).code, 'QUEUE_FULL');
  // A return already in the journal, queued again, is not added twice.
  fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.programme-checkpoint-queue.v1', entries: [] }));
  fx.turnEnd('exec-a', returnBlock('q-once'));
  assert.equal(fx.turnEnd('exec-a', returnBlock('q-once'), { governanceState: stale }).outcome, 'QUEUED');
  fx.turnEnd('exec-a');
  const returns = fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.returns.map(entry => entry.return_id);
  assert.deepEqual(returns.filter(id => id === 'q-once'), ['q-once']);
  assert.equal(fs.existsSync(file), false);
});

test('Q5 queued turns replay in order, the queue goes only after a confirmed write, and a rebind never inherits it', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const stale = () => ({ state: 'ENABLED', governed_rules_bind: true, programme_records_bind: false });
  const returns = () => fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.returns.map(entry => entry.return_id);
  assert.equal(fx.turnEnd('exec-a', returnBlock('r1'), { governanceState: stale }).outcome, 'QUEUED');
  assert.equal(fx.turnEnd('exec-a', returnBlock('r2'), { governanceState: stale }).outcome, 'QUEUED');
  // The write fails during the replay: everything stays queued, now with this turn too.
  const writesDown = { request: (method, ...rest) => (method === 'GET' ? fx.github.request(method, ...rest) : { status: 503, json: { message: 'unavailable' } }), graphql: (...args) => fx.github.graphql(...args) };
  assert.equal(fx.turnEnd('exec-a', returnBlock('r3'), { transport: writesDown }).outcome, 'QUEUED');
  assert.deepEqual(checkpoint.readQueue(hash, sessions).map(item => item.entry && item.entry.return_id), ['r1', 'r2', 'r3']);
  assert.deepEqual(returns(), [], 'nothing reached the journal');
  // The next writable turn writes them in order, then its own, and only then deletes the queue.
  const written = fx.turnEnd('exec-a', returnBlock('r4'));
  assert.equal(written.replayed, 3);
  assert.deepEqual(returns(), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false);
  // A turn queued under one assignment is never written into the next one's journal.
  assert.equal(fx.turnEnd('exec-a', returnBlock('a1-final'), { governanceState: stale }).outcome, 'QUEUED');
  const binding = JSON.parse(fs.readFileSync(checkpoint.bindingFile(hash, sessions), 'utf8'));
  fs.writeFileSync(checkpoint.bindingFile(hash, sessions), JSON.stringify({ ...binding, assignment: 'g1-a2' }));
  fx.store.writeJournal(423, `g1-a2--${hash}.json`, checkpoint.newJournal({ ...binding, assignment: 'g1-a2', hash }), {});
  fx.turnEnd('exec-a', returnBlock('a2-first'));
  const a2 = fx.store.readJournal(423, `g1-a2--${hash}.json`).doc.returns.map(entry => entry.return_id);
  assert.deepEqual(a2, ['a2-first'], 'the other assignment\'s queued turn was skipped');
  assert.equal(checkpoint.readErrors(hash, sessions).recent.some(entry => entry.code === 'QUEUE_SKIPPED'), true);
  // Turns older than seven days are noted when dropped.
  const old = new Date(new Date(fx.github.clock).getTime() - checkpoint.QUEUE_MAX_AGE_MS - 60000).toISOString();
  fs.writeFileSync(checkpoint.queueFile(hash, sessions), JSON.stringify({ schema: 'toolkit.programme-checkpoint-queue.v1', entries: [{ at: old, repository: 'acme/app', issue: 423, assignment: 'g1-a2', facts: null, entry: null }] }));
  fx.turnEnd('exec-a', returnBlock('a2-second'), { governanceState: stale });
  assert.equal(checkpoint.readErrors(hash, sessions).recent.some(entry => entry.code === 'QUEUE_EXPIRED'), true);
});

// ---- Offline-queue follow-ups -------------------------------------------------------------------

const QUEUE_SCHEMA_V1 = 'toolkit.programme-checkpoint-queue.v1';
const queued = (at, assignment = 'g1-a1', extra = {}) => ({ at, repository: 'acme/app', issue: 423, assignment, facts: null, entry: null, ...extra });
const codesOf = (hash, sessions) => checkpoint.readErrors(hash, sessions).recent.map(entry => entry.code);

test('S6: a dropped or skipped turn is noted once, however often the write keeps failing', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const old = new Date(new Date(fx.github.clock).getTime() - checkpoint.QUEUE_MAX_AGE_MS - 60000).toISOString();
  const recent = new Date(fx.github.clock).toISOString();
  fs.writeFileSync(checkpoint.queueFile(hash, sessions), JSON.stringify({ schema: QUEUE_SCHEMA_V1, entries: [queued(old), queued(recent, 'g1-other')] }));
  const writesDown = { request: (method, ...rest) => (method === 'GET' ? fx.github.request(method, ...rest) : { status: 503, json: { message: 'unavailable' } }), graphql: (...args) => fx.github.graphql(...args) };
  for (let turn = 0; turn < 3; turn += 1) assert.equal(fx.turnEnd('exec-a', returnBlock(`x${turn}`), { transport: writesDown }).outcome, 'QUEUED');
  assert.equal(fx.turnEnd('exec-a', returnBlock('x3')).outcome, 'WRITTEN');
  const codes = codesOf(hash, sessions);
  assert.equal(codes.filter(code => code === 'QUEUE_EXPIRED').length, 1, 'the expired turn is noted once');
  assert.equal(codes.filter(code => code === 'QUEUE_SKIPPED').length, 1, 'the other assignment\'s turn is noted once');
  assert.deepEqual(fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.returns.map(entry => entry.return_id), ['x0', 'x1', 'x2', 'x3']);
});

test('S6: a signed-out gh is recorded as an error, never queued', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const signedOut = new state.GitHubTransport({ ghPath: 'gh-for-tests', run: () => ({ status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }) });
  assert.throws(() => signedOut.request('GET', 'user'), { code: 'GH_AUTH' });
  // gh with no HTTP status for another reason (a network failure) is still unreachable.
  const offline = new state.GitHubTransport({ ghPath: 'gh-for-tests', run: () => ({ status: 1, stdout: '', stderr: 'error connecting to api.github.com' }) });
  assert.throws(() => offline.request('GET', 'user'), { code: 'GH_FAILED' });
  const result = fx.turnEnd('exec-a', returnBlock('auth-1'), { transport: signedOut });
  assert.deepEqual(result, { outcome: 'FAILED', code: 'GH_AUTH' });
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false, 'nothing queued');
  assert.equal(checkpoint.readErrors(hash, sessions).pending.code, 'GH_AUTH');
});

test('S6: a replay that ends where it started bumps no seq and writes nothing', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const name = `g1-a1--${hash}.json`;
  const before = fx.store.readJournal(423, name).doc;
  const commits = fx.github.commits;
  // A queued turn from a crash, with other facts, then this turn back on the journal's own facts.
  const other = { ...before.checkpoint, head: SHA_B };
  fs.writeFileSync(checkpoint.queueFile(hash, sessions), JSON.stringify({ schema: QUEUE_SCHEMA_V1, entries: [queued(new Date(fx.github.clock).toISOString(), 'g1-a1', { facts: other })] }));
  const result = fx.turnEnd('exec-a');
  assert.equal(result.outcome, 'NOOP');
  assert.equal(fx.store.readJournal(423, name).doc.seq, before.seq);
  assert.equal(fx.github.commits, commits, 'no commit');
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false, 'the replayed queue is gone');
});

test('S6: an unusable queued entry is skipped with one note, and the turn is still written', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const at = new Date(fx.github.clock).toISOString();
  const bad = queued(at, 'g1-a1', { facts: { branch: 'x', head: 'not-a-sha' } });
  const good = queued(at, 'g1-a1', { entry: { return_id: 'q-good', verdict_requested: null, at_head: null, next_action: null, blockers: [] } });
  fs.writeFileSync(checkpoint.queueFile(hash, sessions), JSON.stringify({ schema: QUEUE_SCHEMA_V1, entries: [bad, good] }));
  const result = fx.turnEnd('exec-a', returnBlock('now-1'));
  assert.equal(result.outcome, 'WRITTEN');
  assert.deepEqual(fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.returns.map(entry => entry.return_id), ['q-good', 'now-1']);
  const notes = checkpoint.readErrors(hash, sessions).recent.filter(entry => entry.code === 'QUEUE_ENTRY_INVALID');
  assert.equal(notes.length, 1);
  assert.ok(notes[0].message.includes(`queued at ${at}`), notes[0].message);
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false, 'no leftover file is kept');
  assert.equal(fs.readdirSync(fx.sessionsDir).some(file => file.includes('invalid')), false);
});

test('S6: the queue count for status, and the discard when governance is confirmed off', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  assert.deepEqual(checkpoint.queueSummary(fx.repoRoot, sessions), { count: 0, oldest: null });
  fs.writeFileSync(checkpoint.queueFile(hash, sessions), JSON.stringify({ schema: QUEUE_SCHEMA_V1, entries: [queued('2026-10-22T09:00:00.000Z'), queued('2026-10-23T09:00:00.000Z')] }));
  const now = { now: () => '2026-10-23T12:00:00.000Z', ...sessions };
  assert.deepEqual(checkpoint.queueSummary(fx.repoRoot, now), { count: 2, oldest: '2026-10-22T09:00:00.000Z' });
  assert.deepEqual(checkpoint.queueSummary(tmp(), now), { count: 0, oldest: null }, 'another checkout counts nothing');
  assert.equal(checkpoint.discardQueuesFor(fx.repoRoot, now), 1);
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false);
});

// ---- One-time findings (review M1) --------------------------------------------------------------

test('M1: one-time findings stay open across passes until answered or their condition is gone', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  // The reviewer's repro: a checkpoint error, a turn end with a return, then two passes.
  checkpoint.recordError(hash, 'GH_FAILED', 'GitHub could not be reached', sessions);
  assert.equal(fx.turnEnd('exec-a', returnBlock('r-1')).outcome, 'WRITTEN');
  const open = () => fx.parentDoc().attention.filter(entry => entry.issue === 423 && ['RETURN_CAPTURED', 'JOURNAL_ERROR'].includes(entry.code)).map(entry => `${entry.code} ${entry.state}`).sort();
  fx.reconcile();
  assert.deepEqual(open(), ['JOURNAL_ERROR new', 'RETURN_CAPTURED new'], 'pass 1');
  fx.reconcile();
  assert.deepEqual(open(), ['JOURNAL_ERROR new', 'RETURN_CAPTURED new'], 'pass 2: still open, the gate still waits');
  assert.equal(fx.child().gate.state, 'SUBMITTED');
  // An acknowledged one-time finding resolves on the next complete pass; nobody needs to see it again.
  const journalError = fx.parentDoc().attention.find(entry => entry.code === 'JOURNAL_ERROR');
  fx.ctrl(['ack', '--finding', journalError.id]);
  fx.reconcile();
  assert.deepEqual(open(), ['JOURNAL_ERROR resolved', 'RETURN_CAPTURED new']);
  // Acknowledging the waiting return does not close it while the return is unconsumed.
  const captured = fx.parentDoc().attention.find(entry => entry.code === 'RETURN_CAPTURED');
  fx.ctrl(['ack', '--finding', captured.id]);
  fx.reconcile();
  assert.deepEqual(open(), ['JOURNAL_ERROR resolved', 'RETURN_CAPTURED acknowledged']);
  // The verdict consumes the return: the condition is gone.
  fx.ctrl(['return', '--issue', '423', '--consume', 'r-1', '--verdict', 'REOPEN']);
  fx.reconcile();
  assert.deepEqual(open(), ['JOURNAL_ERROR resolved', 'RETURN_CAPTURED resolved']);
});

test('M1: a late checkpoint from an ended assignment stays new until the controller answers it', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  fx.reconcile();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2', '--supersede', '--reason', 'restart']);
  // The old session ends a turn after its assignment stopped being live.
  fx.turnEnd('exec-a', returnBlock('late-1'));
  const stale = () => fx.parentDoc().attention.filter(entry => entry.code === 'STALE_ASSIGNMENT').map(entry => entry.state);
  fx.reconcile();
  fx.reconcile();
  assert.deepEqual(stale(), ['new']);
  fx.ctrl(['dispose', '--finding', fx.parentDoc().attention.find(entry => entry.code === 'STALE_ASSIGNMENT').id, '--reason', 'the restart superseded it']);
  fx.reconcile();
  assert.deepEqual(stale(), ['disposed']);
});

test('L2: a queued turn with an unreadable return entry is skipped, and the turns around it are written', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  const at = new Date(fx.github.clock).toISOString();
  const entry = id => ({ return_id: id, verdict_requested: null, at_head: null, next_action: null, blockers: [] });
  // A return entry no journal accepts: an unknown field and an at_head that is not a SHA.
  const bad = queued(at, 'g1-a1', { entry: { ...entry('q-bad'), at_head: 'not-a-sha', extra: true } });
  fs.writeFileSync(checkpoint.queueFile(hash, sessions), JSON.stringify({ schema: QUEUE_SCHEMA_V1, entries: [queued(at, 'g1-a1', { entry: entry('q-1') }), bad, queued(at, 'g1-a1', { entry: entry('q-2') })] }));
  assert.equal(fx.turnEnd('exec-a', returnBlock('now-1')).outcome, 'WRITTEN');
  assert.deepEqual(fx.store.readJournal(423, `g1-a1--${hash}.json`).doc.returns.map(item => item.return_id), ['q-1', 'q-2', 'now-1']);
  assert.equal(checkpoint.readErrors(hash, sessions).recent.filter(item => item.code === 'QUEUE_ENTRY_INVALID').length, 1);
  assert.equal(fs.existsSync(checkpoint.queueFile(hash, sessions)), false);
});

// ---- One-time findings, delta review (N1 to N3) ------------------------------------------------

// Assign g1-a1, bind exec-a, record a turn with a return, reconcile: RETURN_CAPTURED new, gate SUBMITTED.
function submitted(fx, returnId = 'r-1', assignment = 'g1-a1', session = 'exec-a', extra = []) {
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', assignment, ...extra]);
  fx.run(['bind', '--issue', '423', '--assignment', assignment, '--session', session]);
  assert.equal(fx.turnEnd(session, returnBlock(returnId)).outcome, 'WRITTEN');
  fx.reconcile();
}
const oneTime = (fx, code) => fx.parentDoc().attention.filter(entry => entry.code === code && entry.issue === 423).map(entry => entry.state);

test('N1: a captured return left by an interrupted or superseded assignment no longer holds its finding open', () => {
  for (const ending of ['interrupt', 'supersede']) {
    const fx = fixture();
    submitted(fx);
    assert.equal(fx.child().gate.state, 'SUBMITTED');
    assert.deepEqual(oneTime(fx, 'RETURN_CAPTURED'), ['new']);
    if (ending === 'interrupt') fx.ctrl(['interrupt', '--issue', '423', '--reason', 'stop for now']);
    else fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2', '--supersede', '--reason', 'restart']);
    fx.reconcile();
    fx.reconcile();
    assert.deepEqual(oneTime(fx, 'RETURN_CAPTURED'), ['resolved'], `${ending}: r-1 can no longer be consumed, so it does not hold`);
    // A later return on the issue shows as new again.
    if (ending === 'interrupt') fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2']);
    fx.run(['bind', '--issue', '423', '--assignment', 'g1-a2', '--session', 'exec-b']);
    assert.equal(fx.turnEnd('exec-b', returnBlock('r-2')).outcome, 'WRITTEN');
    fx.reconcile();
    assert.deepEqual(oneTime(fx, 'RETURN_CAPTURED'), ['new'], `${ending}: r-2 is new`);
    fx.reconcile();
    assert.deepEqual(oneTime(fx, 'RETURN_CAPTURED'), ['new'], `${ending}: and stays open while r-2 waits`);
  }
});

test('N2: a fresh report of a one-time code reopens an acknowledged or disposed entry', () => {
  for (const answer of ['ack', 'dispose']) {
    const fx = fixture();
    submitted(fx);
    const id = fx.parentDoc().attention.find(entry => entry.code === 'RETURN_CAPTURED').id;
    fx.ctrl(answer === 'ack' ? ['ack', '--finding', id] : ['dispose', '--finding', id, '--reason', 'handled in chat']);
    assert.deepEqual(oneTime(fx, 'RETURN_CAPTURED'), [answer === 'ack' ? 'acknowledged' : 'disposed']);
    // A new assignment's return arrives before the next pass: a fresh report of the same code.
    fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2', '--supersede', '--reason', 'restart']);
    fx.run(['bind', '--issue', '423', '--assignment', 'g1-a2', '--session', 'exec-c']);
    assert.equal(fx.turnEnd('exec-c', returnBlock('r-3')).outcome, 'WRITTEN');
    fx.reconcile();
    assert.deepEqual(oneTime(fx, 'RETURN_CAPTURED'), ['new'], `${answer}: reopened by the fresh report`);
  }
  // A journal that still carries the same old error does not reopen its acknowledged entry; a new error does.
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  const hash = checkpoint.sessionHash('exec-a');
  const sessions = { sessionsDir: fx.sessionsDir };
  // Every clock here is the fake GitHub's, as in production every clock is the computer's.
  const clock = { ...sessions, now: () => new Date(fx.github.clock).toISOString() };
  checkpoint.recordError(hash, 'GH_FAILED', 'GitHub could not be reached', clock);
  fx.turnEnd('exec-a');
  fx.reconcile();
  assert.deepEqual(oneTime(fx, 'JOURNAL_ERROR'), ['new']);
  fx.github.tick();
  fx.ctrl(['ack', '--finding', fx.parentDoc().attention.find(entry => entry.code === 'JOURNAL_ERROR').id]);
  // Another turn rewrites the journal with the old error still on it.
  fx.head = SHA_B;
  fx.turnEnd('exec-a');
  fx.reconcile();
  assert.deepEqual(oneTime(fx, 'JOURNAL_ERROR'), ['acknowledged'], 'the old error, already acknowledged: not reopened');
  fx.reconcile();
  assert.deepEqual(oneTime(fx, 'JOURNAL_ERROR'), ['resolved'], 'then resolved on the next complete pass');
  for (let n = 0; n < 5; n += 1) fx.github.tick();
  checkpoint.recordError(hash, 'GH_FAILED', 'GitHub could not be reached again', clock);
  fx.turnEnd('exec-a');
  fx.reconcile();
  assert.deepEqual(oneTime(fx, 'JOURNAL_ERROR'), ['new'], 'a new error reopens it');
});

test('N3: a JOURNAL_ERROR stays new while the task has a live gate, and resolves once it has none', () => {
  const fx = fixture();
  fx.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  fx.run(['bind', '--issue', '423', '--assignment', 'g1-a1', '--session', 'exec-a']);
  checkpoint.recordError(checkpoint.sessionHash('exec-a'), 'GH_FAILED', 'GitHub could not be reached', { sessionsDir: fx.sessionsDir });
  fx.turnEnd('exec-a');
  fx.reconcile();
  fx.reconcile();
  assert.deepEqual(oneTime(fx, 'JOURNAL_ERROR'), ['new'], 'held while the gate is live');
  fx.ctrl(['interrupt', '--issue', '423', '--reason', 'stop for now']);
  assert.equal(fx.child().gate.state, 'INTERRUPTED');
  fx.reconcile();
  assert.deepEqual(oneTime(fx, 'JOURNAL_ERROR'), ['resolved'], 'no live gate: resolved');
});
