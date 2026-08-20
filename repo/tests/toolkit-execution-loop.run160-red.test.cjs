'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-execution-loop.cjs');

const common = {
  task: { id: 'task-run160-red', digest: 'a'.repeat(64) },
  repository_id: 'b'.repeat(64),
  authorized_ref_digest: 'c'.repeat(64),
  current_authority_digest: 'd'.repeat(64),
  consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
};

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function commitOptions(overrides = {}) {
  return {
    ...common,
    run_id: 'run-commit',
    authorized_paths: ['src/file.txt'],
    expected_head: 'a'.repeat(40),
    expected_tree: 'b'.repeat(40),
    expected_index_digest: 'c'.repeat(64),
    commit_message: 'bounded commit',
    intended_tree: 'd'.repeat(40),
    intended_change_digest: 'e'.repeat(64),
    ...overrides,
  };
}

function gitFixture(overrides = {}) {
  let staged = [];
  let committed = false;
  const status = () => ({
    repository_id: common.repository_id,
    head: 'a'.repeat(40),
    tree: committed ? 'd'.repeat(40) : 'b'.repeat(40),
    index_digest: committed ? 'f'.repeat(64) : 'c'.repeat(64),
    staged_paths: staged,
    worktree_paths: { staged_paths: staged, unstaged_paths: [], untracked_paths: [] },
    change_digest: 'e'.repeat(64),
  });
  const git = {
    status,
    stageExact({ paths }) {
      staged = [...paths];
      return status();
    },
    commit({ message, amend, allow_empty, options, paths }) {
      assert.equal(message, 'bounded commit');
      assert.equal(amend, false);
      assert.equal(allow_empty, false);
      assert.deepEqual(options, []);
      assert.deepEqual(paths, ['src/file.txt']);
      committed = true;
      staged = [];
      return { status: { ...status(), head: 'f'.repeat(40), staged_paths: [], worktree_paths: { staged_paths: [], unstaged_paths: [], untracked_paths: [] } }, tree: 'd'.repeat(40), change_digest: 'e'.repeat(64) };
    },
  };
  return { ...git, ...overrides };
}

function delegatedAdmission(runId) {
  return runtime.admitRun({
    ...common,
    run_id: runId,
    authority: { delegated: true, lanes: ['worker-a', 'worker-b'] },
    adapters: {
      'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
      'worker-b': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
    },
  });
}

function runningEvidence(runId = 'run-commit', liveOverride = {}) {
  const admitted = runtime.admitRun({ ...common, run_id: runId, authority: { delegated: false, lanes: [] } });
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40), ...liveOverride };
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-' + runId, workspace_handle: 'handle-' + runId, commit_sha: live.sha, tree_sha: live.tree }) },
  });
  return { run_id: runId, repository_id: admitted.run.repository_id, authorized_ref_digest: admitted.run.authorized_ref_digest, current_authority_digest: admitted.run.current_authority_digest, route_plan: admitted.route_plan, run: runtime.transitionRun(workspace.run, 'running'), workspace_receipt: workspace.workspace_receipt, live, liveRefProvider: { read: () => live } };
}

function typedCommitOptions(evidence, overrides = {}) {
  return {
    ...common,
    ...evidence,
    authorized_paths: ['src/file.txt'],
    expected_head: 'a'.repeat(40),
    expected_tree: 'b'.repeat(40),
    expected_index_digest: 'c'.repeat(64),
    commit_message: 'bounded commit',
    intended_tree: 'd'.repeat(40),
    intended_change_digest: 'e'.repeat(64),
    ...overrides,
  };
}

function terminalFromRunning(running, { outcome = 'success', publication_state = 'verified', workspace_disposition = 'cleaned' } = {}) {
  const validating = runtime.transitionRun(running, 'validating');
  const packet = runtime.createTerminalPacket({ run_id: validating.run_id, outcome, reason_code: 'RUN160_EVIDENCE', evidence_digest: 'e'.repeat(64), publication_state, workspace_disposition });
  return runtime.completeRun({ run: validating, terminal_packet: packet });
}

test('RUN160 RED: delegated substantive start cannot occur from admitted without workspace evidence', () => {
  let substantiveStarts = 0;
  const result = runtime.admitRun({
    ...common,
    run_id: 'run-red-admitted',
    authority: { delegated: true, lanes: ['worker-a', 'worker-b'] },
    adapters: {
      'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
      'worker-b': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
    },
    prepareLaunch: (lane) => ({ lane_id: lane.lane_id, reservation_handle: 'reservation-' + lane.lane_id, inert: true }),
    commitLaunchBatch: () => {
      substantiveStarts += 1;
      return { atomic: true, started_lane_ids: ['worker-a', 'worker-b'] };
    },
  });
  assert.equal(result.status, 'admitted');
  assert.equal(substantiveStarts, 0);
});

test('RUN160 RED: exact verified workspace evidence permits a complete delegated start only after workspace-ready', () => {
  const admitted = delegatedAdmission('run-red-workspace');
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => ({ workspace_id: 'workspace-red', workspace_handle: 'handle-red', commit_sha: live.sha, tree_sha: live.tree }),
      verifySnapshot: () => true,
    },
  });
  assert.equal(workspace.run.execution_state, 'workspace-ready');
  assert.equal(typeof runtime.startDelegatedRun, 'function');
  const started = runtime.startDelegatedRun({
    ...common,
    run_id: admitted.run.run_id,
    repository_id: admitted.run.repository_id,
    authorized_ref_digest: admitted.run.authorized_ref_digest,
    current_authority_digest: admitted.run.current_authority_digest,
    route_plan: admitted.route_plan,
    run: workspace.run,
    workspace_receipt: workspace.workspace_receipt,
    liveRefProvider: { read: () => live },
    prepareLaunch: (lane) => ({ lane_id: lane.lane_id, reservation_handle: 'reservation-' + lane.lane_id, inert: true }),
    commitLaunchBatch: ({ reservations }) => ({ atomic: true, started_lane_ids: reservations.map((item) => item.lane_id) }),
  });
  assert.equal(started.run.execution_state, 'running');
  assert.deepEqual(started.launches, ['worker-a', 'worker-b']);
});

test('RUN160 RED: typed commit requires exact run/workspace evidence and a mandatory live-ref provider before stage', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-commit-evidence-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const fixture = gitFixture();
  let stageCalls = 0;
  const originalStage = fixture.stageExact;
  fixture.stageExact = (input) => {
    stageCalls += 1;
    return originalStage.call(fixture, input);
  };
  expectCode(() => runtime.executeTypedGitCommit({
    ...commitOptions({ state_root: stateRoot, mutation_lease: lease }),
    git: fixture,
    broker: { authorize: () => ({ decision: 'allow' }) },
  }), 'GIT_COMMIT_RUN_EVIDENCE_REQUIRED');
  assert.equal(stageCalls, 0);
});

test('RUN160 RED: publication-pending interruption preserves uncertain publication and workspace evidence', () => {
  const rootOnly = runtime.admitRun({ ...common, run_id: 'run-red-publication', authority: { delegated: false, lanes: [] } });
  let run = rootOnly.run;
  run = runtime.transitionRun(run, 'workspace-ready', { workspace_receipt_digest: 'f'.repeat(64) });
  run = runtime.transitionRun(run, 'running');
  run = runtime.transitionRun(run, 'validating');
  run = runtime.transitionRun(run, 'publication-pending', { publication_state: 'none' });
  const packet = runtime.createTerminalPacket({
    run_id: run.run_id,
    outcome: 'interrupted',
    reason_code: 'PUBLICATION_INTERRUPTED',
    evidence_digest: 'e'.repeat(64),
    publication_state: 'uncertain',
    workspace_disposition: 'preserved',
  });
  const terminal = runtime.completeRun({ run, terminal_packet: packet });
  assert.equal(terminal.execution_state, 'interrupted');
  assert.equal(terminal.publication_state, 'uncertain');
  assert.equal(terminal.workspace_disposition, 'preserved');
});

test('RUN160 RED: fabricated safe release labels cannot release a durable admitted run', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-release-'));
  const rootOnly = runtime.admitRun({ ...common, run_id: 'run-red-release', authority: { delegated: false, lanes: [] } });
  const run = rootOnly.run;
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id });
  runtime.writeDurableRun({ state_root: stateRoot, run });
  expectCode(() => runtime.releaseMutationLease({
    state_root: stateRoot,
    repository_id: run.repository_id,
    authorized_ref_digest: run.authorized_ref_digest,
    run_id: run.run_id,
    lease_id: lease.lease_id,
    terminal_state: 'terminal-success',
    workspace_disposition: 'cleaned',
    publication_state: 'verified',
  }), 'LEASE_RELEASE_UNSAFE');
  assert.equal(fs.existsSync(path.join(stateRoot, run.repository_id + '.' + run.authorized_ref_digest + '.lease.json')), true);
});

test('RUN160 RED: hook-created out-of-scope worktree evidence cannot escape typed commit validation', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-hook-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const fixture = gitFixture();
  const admitted = runtime.admitRun({ ...common, run_id: 'run-commit', authority: { delegated: false, lanes: [] } });
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-hook', workspace_handle: 'handle-hook', commit_sha: live.sha, tree_sha: live.tree }) },
  });
  const running = runtime.transitionRun(workspace.run, 'running');
  const originalCommit = fixture.commit;
  fixture.commit = (input) => {
    const result = originalCommit.call(fixture, input);
    return { ...result, status: { ...result.status, worktree_paths: { staged_paths: [], unstaged_paths: [], untracked_paths: ['hook-created.txt'] } } };
  };
  expectCode(() => runtime.executeTypedGitCommit({
    ...commitOptions({ state_root: stateRoot, mutation_lease: lease }),
    run: running,
    route_plan: admitted.route_plan,
    workspace_receipt: workspace.workspace_receipt,
    liveRefProvider: { read: () => live },
    git: fixture,
    broker: { authorize: () => ({ decision: 'allow' }) },
  }), 'GIT_COMMIT_HOOK_BROADENED');
});

test('RUN160 RED: delegated start rejects wrong or missing run, route, repository, ref, workspace, snapshot, and live bindings', () => {
  const admitted = delegatedAdmission('run-red-start-bindings');
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-bindings', workspace_handle: 'handle-bindings', commit_sha: live.sha, tree_sha: live.tree }) },
  });
  const base = {
    ...common,
    run_id: admitted.run.run_id,
    repository_id: admitted.run.repository_id,
    authorized_ref_digest: admitted.run.authorized_ref_digest,
    current_authority_digest: admitted.run.current_authority_digest,
    route_plan: admitted.route_plan,
    run: workspace.run,
    workspace_receipt: workspace.workspace_receipt,
    liveRefProvider: { read: () => live },
    prepareLaunch: (lane) => ({ lane_id: lane.lane_id, reservation_handle: 'reservation-' + lane.lane_id, inert: true }),
    commitLaunchBatch: ({ reservations }) => ({ atomic: true, started_lane_ids: reservations.map((item) => item.lane_id) }),
  };
  const otherRoute = runtime.admitRun({ ...common, run_id: 'run-red-other-route', authority: { delegated: true, lanes: ['worker-a'] }, adapters: { 'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' } } }).route_plan;
  const wrongSnapshotReceipt = { ...workspace.workspace_receipt, snapshot_commit_digest: 'f'.repeat(64) };
  const wrongSnapshotRun = { ...workspace.run, workspace_receipt_digest: runtime.digestValue(wrongSnapshotReceipt) };
  const cases = [
    ['missing run', { run: undefined }, 'START_RUN_EVIDENCE_REQUIRED'],
    ['missing workspace', { workspace_receipt: undefined }, 'START_RUN_EVIDENCE_REQUIRED'],
    ['wrong run', { run: { ...workspace.run, run_id: 'run-other' } }, 'START_RUN_BINDING_MISMATCH'],
    ['wrong route', { route_plan: otherRoute }, 'START_ROUTE_BINDING_MISMATCH'],
    ['wrong repository', { repository_id: 'f'.repeat(64) }, 'START_RUN_BINDING_MISMATCH'],
    ['wrong ref', { authorized_ref_digest: 'e'.repeat(64) }, 'START_RUN_BINDING_MISMATCH'],
    ['wrong workspace', { workspace_receipt: { ...workspace.workspace_receipt, workspace_id: 'workspace-other' } }, 'START_WORKSPACE_BINDING_MISMATCH'],
    ['wrong snapshot', { run: wrongSnapshotRun, workspace_receipt: wrongSnapshotReceipt }, 'LIVE_REF_MOVED'],
    ['missing live provider', { liveRefProvider: undefined }, 'LIVE_REF_UNAVAILABLE'],
  ];
  for (const [label, overrides, code] of cases) {
    expectCode(() => runtime.startDelegatedRun({ ...base, ...overrides }), code);
  }
});

test('RUN160 RED: typed commit rejects missing live provider, stale workspace snapshot, and wrong lifecycle before stage', () => {
  const evidence = runningEvidence('run-red-typed-binding');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-typed-binding-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: evidence.repository_id, authorized_ref_digest: evidence.authorized_ref_digest, run_id: evidence.run_id });
  let stageCalls = 0;
  const fixture = gitFixture();
  const originalStage = fixture.stageExact;
  fixture.stageExact = (input) => {
    stageCalls += 1;
    return originalStage.call(fixture, input);
  };
  expectCode(() => runtime.executeTypedGitCommit({ ...typedCommitOptions(evidence, { state_root: stateRoot, mutation_lease: lease, liveRefProvider: undefined }), git: fixture, broker: { authorize: () => ({ decision: 'allow' }) } }), 'LIVE_REF_REQUIRED');
  assert.equal(stageCalls, 0);
  const staleReceipt = { ...evidence.workspace_receipt, snapshot_tree_digest: 'f'.repeat(64) };
  const staleRun = { ...evidence.run, workspace_receipt_digest: runtime.digestValue(staleReceipt) };
  expectCode(() => runtime.executeTypedGitCommit({ ...typedCommitOptions({ ...evidence, run: staleRun, workspace_receipt: staleReceipt }, { state_root: stateRoot, mutation_lease: lease }), git: gitFixture(), broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_WORKSPACE_SNAPSHOT_MISMATCH');
  const validating = runtime.transitionRun(evidence.run, 'validating');
  expectCode(() => runtime.executeTypedGitCommit({ ...typedCommitOptions({ ...evidence, run: validating }, { state_root: stateRoot, mutation_lease: lease }), git: gitFixture(), broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_LIFECYCLE_INVALID');
});

test('RUN160 RED: live-ref movement at the pre-commit checkpoint blocks typed mutation after staging but before commit', () => {
  const evidence = runningEvidence('run-red-live-movement');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-live-movement-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: evidence.repository_id, authorized_ref_digest: evidence.authorized_ref_digest, run_id: evidence.run_id });
  const fixture = gitFixture();
  let stageCalls = 0;
  let commitCalls = 0;
  const originalStage = fixture.stageExact;
  const originalCommit = fixture.commit;
  fixture.stageExact = (input) => {
    stageCalls += 1;
    return originalStage.call(fixture, input);
  };
  fixture.commit = (input) => {
    commitCalls += 1;
    return originalCommit.call(fixture, input);
  };
  let reads = 0;
  const liveRefProvider = { read: () => { reads += 1; return reads === 1 ? evidence.live : { ...evidence.live, sha: 'f'.repeat(40) }; } };
  expectCode(() => runtime.executeTypedGitCommit({ ...typedCommitOptions(evidence, { state_root: stateRoot, mutation_lease: lease, liveRefProvider }), git: fixture, broker: { authorize: () => ({ decision: 'allow' }) } }), 'LIVE_REF_MOVED');
  assert.equal(stageCalls, 1);
  assert.equal(commitCalls, 0);
});

test('RUN160 RED: publication-pending uncertainty cannot be converted into ordinary success, failure, or cleanup', () => {
  const admitted = runtime.admitRun({ ...common, run_id: 'run-red-publication-ordinary', authority: { delegated: false, lanes: [] } });
  let run = runtime.transitionRun(admitted.run, 'workspace-ready', { workspace_receipt_digest: 'f'.repeat(64) });
  run = runtime.transitionRun(run, 'running');
  run = runtime.transitionRun(run, 'validating');
  run = runtime.transitionRun(run, 'publication-pending', { publication_state: 'uncertain' });
  const packet = runtime.createTerminalPacket({ run_id: run.run_id, outcome: 'blocked', reason_code: 'PUBLICATION_BLOCKED', evidence_digest: 'e'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
  expectCode(() => runtime.completeRun({ run, terminal_packet: packet }), 'PUBLICATION_INTERRUPTION_REQUIRED');
  expectCode(() => runtime.createTerminalPacket({ run_id: run.run_id, outcome: 'success', reason_code: 'PUBLICATION_SUCCESS', evidence_digest: 'e'.repeat(64), publication_state: 'uncertain', workspace_disposition: 'cleaned' }), 'PUBLICATION_UNCERTAIN');
  assert.equal(runtime.cleanupWorkspace({ facts: { uncertain: true, terminal_evidence_durable: true, publication_verified: false, proven_disposable: true } }).removable, false);
});

test('RUN160 RED: durable release rejects every non-safe state and missing or contradictory evidence', () => {
  function admittedRun(runId) {
    return runtime.admitRun({ ...common, run_id: runId, authority: { delegated: false, lanes: [] } }).run;
  }
  function readyRun(runId) {
    return runtime.transitionRun(admittedRun(runId), 'workspace-ready', { workspace_receipt_digest: 'f'.repeat(64) });
  }
  function interruptedRun(runId) {
    let run = runtime.transitionRun(readyRun(runId), 'running');
    run = runtime.transitionRun(run, 'validating');
    run = runtime.transitionRun(run, 'publication-pending', { publication_state: 'none' });
    return runtime.completeRun({ run, terminal_packet: runtime.createTerminalPacket({ run_id: run.run_id, outcome: 'interrupted', reason_code: 'INTERRUPTED', evidence_digest: 'e'.repeat(64), publication_state: 'uncertain', workspace_disposition: 'preserved' }) });
  }
  function assertUnsafe(label, run, rawOverride) {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-release-' + label + '-'));
    const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id });
    if (rawOverride) {
      const key = runtime.stateKey(run.repository_id, run.authorized_ref_digest, run.run_id);
      fs.writeFileSync(path.join(stateRoot, key + '.json'), JSON.stringify(rawOverride), 'utf8');
    } else {
      runtime.writeDurableRun({ state_root: stateRoot, run });
    }
    expectCode(() => runtime.releaseMutationLease({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id, lease_id: lease.lease_id, terminal_state: 'terminal-success', workspace_disposition: 'cleaned', publication_state: 'verified' }), 'LEASE_RELEASE_UNSAFE');
    assert.equal(fs.existsSync(path.join(stateRoot, run.repository_id + '.' + run.authorized_ref_digest + '.lease.json')), true);
  }
  const admitted = admittedRun('run-red-release-admitted');
  const ready = readyRun('run-red-release-ready');
  const running = runtime.transitionRun(readyRun('run-red-release-running'), 'running');
  const validating = runtime.transitionRun(runtime.transitionRun(readyRun('run-red-release-validating'), 'running'), 'validating');
  const publicationPending = runtime.transitionRun(validating, 'publication-pending', { publication_state: 'none' });
  const interrupted = interruptedRun('run-red-release-interrupted');
  const preserved = terminalFromRunning(running, { outcome: 'blocked', publication_state: 'verified', workspace_disposition: 'preserved' });
  const quarantined = terminalFromRunning(runtime.transitionRun(readyRun('run-red-release-quarantined'), 'running'), { outcome: 'failure', publication_state: 'verified', workspace_disposition: 'quarantined' });
  for (const [label, run] of [['admitted', admitted], ['workspace-ready', ready], ['running', running], ['validating', validating], ['publication-pending', publicationPending], ['interrupted', interrupted], ['preserved', preserved], ['quarantined', quarantined]]) assertUnsafe(label, run);
  const safe = terminalFromRunning(runtime.transitionRun(readyRun('run-red-release-missing'), 'running'));
  assertUnsafe('missing-terminal', safe, { ...safe, terminal_packet_digest: null });
  assertUnsafe('missing-workspace', safe, { ...safe, workspace_receipt_digest: null });
  assertUnsafe('contradictory', safe, { ...safe, execution_state: 'running', workspace_disposition: 'cleaned' });
});

test('RUN160 RED: pre-existing out-of-scope dirty, unstaged, and untracked paths block typed commit before stage', () => {
  for (const field of ['unstaged_paths', 'untracked_paths']) {
    const evidence = runningEvidence('run-red-dirty-' + field);
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-dirty-' + field + '-'));
    const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: evidence.repository_id, authorized_ref_digest: evidence.authorized_ref_digest, run_id: evidence.run_id });
    const fixture = gitFixture({ status: () => ({ repository_id: evidence.repository_id, head: 'a'.repeat(40), tree: 'b'.repeat(40), index_digest: 'c'.repeat(64), staged_paths: [], worktree_paths: { staged_paths: [], unstaged_paths: field === 'unstaged_paths' ? ['outside.txt'] : [], untracked_paths: field === 'untracked_paths' ? ['outside.txt'] : [] }, change_digest: 'e'.repeat(64) }) });
    let stageCalls = 0;
    const originalStage = fixture.stageExact;
    fixture.stageExact = (input) => { stageCalls += 1; return originalStage.call(fixture, input); };
    expectCode(() => runtime.executeTypedGitCommit({ ...typedCommitOptions(evidence, { state_root: stateRoot, mutation_lease: lease }), git: fixture, broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_WORKTREE_BROADENED');
    assert.equal(stageCalls, 0, field);
  }
});

test('RUN160 RED: exact authorized-path worktree changes remain permitted by the typed operation', () => {
  const evidence = runningEvidence('run-red-authorized-worktree');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run160-red-authorized-worktree-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: evidence.repository_id, authorized_ref_digest: evidence.authorized_ref_digest, run_id: evidence.run_id });
  let staged = [];
  let committed = false;
  const status = () => ({ repository_id: evidence.repository_id, head: 'a'.repeat(40), tree: committed ? 'd'.repeat(40) : 'b'.repeat(40), index_digest: committed ? 'f'.repeat(64) : 'c'.repeat(64), staged_paths: staged, worktree_paths: { staged_paths: staged, unstaged_paths: ['src/file.txt'], untracked_paths: [] }, change_digest: 'e'.repeat(64) });
  const git = {
    status,
    stageExact({ paths }) { staged = [...paths]; return status(); },
    commit() { committed = true; staged = []; return { status: { ...status(), head: 'f'.repeat(40), staged_paths: [], worktree_paths: { staged_paths: [], unstaged_paths: ['src/file.txt'], untracked_paths: [] } }, tree: 'd'.repeat(40), change_digest: 'e'.repeat(64) }; },
  };
  const result = runtime.executeTypedGitCommit({ ...typedCommitOptions(evidence, { state_root: stateRoot, mutation_lease: lease }), git, broker: { authorize: () => ({ decision: 'allow' }) } });
  assert.equal(result.status, 'committed');
  assert.equal(committed, true);
});
