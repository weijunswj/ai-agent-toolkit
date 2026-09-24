'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const runtime = require('../scripts/toolkit-execution-loop.cjs');
const receiptRuntime = require('../scripts/toolkit-github-program-receipt.cjs');
const support = require('./toolkit-authority-packet-test-support.cjs');

test.afterEach(() => support.cleanup());

function semanticGate(seed = 'boundary') {
  return support.semanticGate(seed);
}

function customizedGate(overrides = {}) {
  const gate = semanticGate();
  if (overrides.trusted_readers) gate.trusted_readers = { ...gate.trusted_readers, ...overrides.trusted_readers };
  if (overrides.consumer_identity) gate.consumer_identity = overrides.consumer_identity;
  return gate;
}

const common = {
  task: { id: 'task-boundary', digest: 'a'.repeat(64) },
  repository_id: 'b'.repeat(64),
  authorized_ref_digest: 'c'.repeat(64),
  current_authority_digest: 'd'.repeat(64),
  consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
};

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function createRun(runId = 'run-boundary') {
  const admitted = runtime.admitRun({ ...common, semantic_gate: semanticGate(runId), run_id: runId, authority: { delegated: false, lanes: [] } });
  return admitted.run;
}

function commitEvidence(runId = 'run-commit', bindings = {}, stateRoot) {
  const semantic_gate = semanticGate(runId);
  const admitted = runtime.admitRun({ ...common, ...bindings, semantic_gate, run_id: runId, authority: { delegated: false, lanes: [] } });
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    state_root: stateRoot,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-' + runId, workspace_handle: 'handle-' + runId, commit_sha: live.sha, tree_sha: live.tree }), verifySnapshot: () => true },
  });
  const running = runtime.transitionRun(workspace.run, 'running', { state_root: stateRoot });
  return { ...common, ...bindings, semantic_gate, run_id: runId, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, current_authority_digest: running.current_authority_digest, route_plan: admitted.route_plan, run: running, workspace_receipt: workspace.workspace_receipt, liveRefProvider: { read: () => live } };
}

function completeSafeEvidence(running, stateRoot) {
  const validating = runtime.transitionRun(running, 'validating', { state_root: stateRoot });
  const terminal_packet = runtime.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
  const terminal = runtime.completeRun({ state_root: stateRoot, run: validating, terminal_packet });
  return { terminal, terminal_packet };
}

function completeSafeRun(running) {
  return completeSafeEvidence(running).terminal;
}

function completionEvidence(runId, outgoingRequired, classificationAvailable = true) {
  const stateRoot = support.stateRoot(`run072-loop-completion-${runId}-`);
  const scopeDigest = runtime.digestValue({ runId, scope: 'g4-output' });
  const applicability = {
    schema: 'toolkit.github-program.semantic-completion-applicability.v1',
    scope_digest: scopeDigest,
    candidate: null,
    required_consumers: outgoingRequired
      ? [{ class: 'G4', dependency_id: `g4-${runId}`, scope_digest: scopeDigest }]
      : [],
    retain_through_child_finality: false,
    retain_through_candidate_finality: false,
  };
  const gate = support.semanticGate(runId, {
    completion_applicability: classificationAvailable ? applicability : false,
  });
  const commonRun = {
    task: { id: `task-${runId}`, digest: 'a'.repeat(64) },
    repository_id: 'b'.repeat(64),
    authorized_ref_digest: 'c'.repeat(64),
    current_authority_digest: 'd'.repeat(64),
    authority: { delegated: false, lanes: [] },
    consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
    semantic_gate: gate,
    run_id: runId,
  };
  const admitted = runtime.admitRun(commonRun);
  const live = { ref: 'refs/heads/main', sha: '1'.repeat(40), tree: '2'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    state_root: stateRoot,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => ({ workspace_id: `workspace-${runId}`, workspace_handle: `handle-${runId}`, commit_sha: live.sha, tree_sha: live.tree }),
      verifySnapshot: () => true,
    },
  });
  const running = runtime.transitionRun(workspace.run, 'running', { state_root: stateRoot });
  const validating = runtime.transitionRun(running, 'validating', { state_root: stateRoot });
  const lease = runtime.acquireMutationLease({
    state_root: stateRoot, repository_id: running.repository_id,
    authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id,
  });
  let substantiveResult = null;
  let terminalPacket;
  if (outgoingRequired) {
    const bindings = support.bindings(`outgoing-${runId}`);
    bindings.authority = support.sourceReference(`loop-${runId}`);
    bindings.lane_id = gate.consumer_intent.lane_id;
    bindings.human_owner = gate.consumer_intent.human_owner;
    bindings.producer = {
      run: running.run_id,
      lock: gate.consumer_intent.consumer.lock,
      stage: 'G3',
      role: 'G3',
    };
    bindings.applicability = {
      scope_digest: scopeDigest,
      required_consumers: structuredClone(applicability.required_consumers),
      retain_through_child_finality: applicability.retain_through_child_finality,
      retain_through_candidate_finality: applicability.retain_through_candidate_finality,
    };
    bindings.candidate = applicability.candidate;
    const packetValue = support.packet({ bindings });
    packetValue.body.sections = ['implementation', 'candidate_identity', 'validation_results', 'remaining_obligations']
      .map((name) => ({ name, text: `Observed ${name.replace(/_/g, ' ')} for ${runId}.` }));
    const outputStore = receiptRuntime.initialiseAuthorityPacketStore(
      support.options(support.stateRoot(`run072-outgoing-${runId}-`)),
      support.readers(packetValue)
    );
    substantiveResult = { store: outputStore, packet: packetValue, producer_admission: support.producerAdmission(packetValue) };
    const packetDigest = receiptRuntime.authorityPacketIdentities(packetValue).packet_digest;
    terminalPacket = runtime.createTerminalPacket({
      run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED',
      evidence_digest: packetDigest, publication_state: 'verified', workspace_disposition: 'cleaned',
    });
  } else {
    terminalPacket = runtime.createTerminalPacket({
      run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED',
      evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned',
    });
  }
  return { stateRoot, gate, running, validating, lease, terminalPacket, substantiveResult };
}

function commitOptions(overrides = {}) {
  const { evidence, ...rest } = overrides;
  return {
    ...common,
    ...(evidence || commitEvidence()),
    run_id: 'run-commit',
    authorized_paths: ['src/file.txt'],
    expected_head: 'a'.repeat(40),
    expected_tree: 'b'.repeat(40),
    expected_index_digest: 'c'.repeat(64),
    commit_message: 'bounded commit',
    intended_tree: 'd'.repeat(40),
    intended_change_digest: 'e'.repeat(64),
    ...rest,
  };
}

function gitFixture(overrides = {}) {
  let staged = [];
  let committed = false;
  const repositoryId = common.repository_id;
  const status = () => ({
    repository_id: repositoryId,
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

test('A3 exposes exactly five contract identities and no second authority surface', () => {
  assert.equal(runtime.CONTRACTS.length, 5);
  assert.equal(new Set(runtime.CONTRACTS).size, 5);
  assert.equal(Object.keys(runtime).includes('createTrustedAuthorityContext'), false);
  assert.equal(Object.keys(runtime).includes('createTicketStore'), false);
  assert.equal(runtime.POLICY.a1.public_issuer, false);
  assert.equal(runtime.POLICY.a1.a3_ticket_format, false);
  assert.equal(runtime.POLICY.a1.git_stage_operation, false);
  assert.equal(runtime.POLICY.launch.atomic_batch_commit, true);
  assert.equal(runtime.POLICY.mutation_lease.required_before_stage, true);
});

test('semantic admission is receipt-owned, opaque, and required at direct consequential boundaries', () => {
  const blocked = runtime.admitRun({
    ...common,
    semantic_gate: undefined,
    verified: true,
    legacy_ok: true,
    environment: { execution_loop: 'enabled' },
    authority: { delegated: false, lanes: [] },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason_code, 'GPR_PACKET_ADMISSION_REQUIRED');

  const route = runtime.admitRoute({ ...common, authority: { delegated: false, lanes: [] } });
  const planned = runtime.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: 'run-direct-admission' });
  expectCode(() => runtime.transitionRun(planned, 'admitted'), 'GPR_PACKET_ADMISSION_REQUIRED');
  const directGate = customizedGate();
  const directAdmitted = runtime.transitionRun(
    runtime.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: 'run-direct-admission-success' }),
    'admitted',
    { semantic_gate: directGate },
  );
  assert.equal(directAdmitted.execution_state, 'admitted');
  const directDb = new DatabaseSync(directGate.store.databasePath, { readOnly: true });
  try { assert.equal(directDb.prepare('SELECT COUNT(*) AS count FROM semantic_gate_admissions').get().count, 1); } finally { directDb.close(); }

  const admitted = runtime.admitRun({ ...common, semantic_gate: semanticGate('run-serialized-admission'), run_id: 'run-serialized-admission', authority: { delegated: false, lanes: [] } });
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-serialized', workspace_handle: 'handle-serialized', commit_sha: live.sha, tree_sha: live.tree }), verifySnapshot: () => true },
  });
  const serialized = JSON.parse(JSON.stringify(workspace.run));
  expectCode(() => runtime.transitionRun(serialized, 'running'), 'GPR_PACKET_ADMISSION_REQUIRED');
  assert.equal(Object.prototype.hasOwnProperty.call(admitted.run, 'semantic_admission'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admitted.run, 'verified'), false);
});

test('semantic gate admission and readers reject promises in synchronous Loop guards', () => {
  const asyncAdmission = { ...semanticGate('async-admission'), store: { admitSemanticGate: () => Promise.resolve({}) } };
  const blocked = runtime.admitRun({ ...common, semantic_gate: asyncAdmission, authority: { delegated: false, lanes: [] } });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason_code, 'GPR_PACKET_ADMISSION_REQUIRED');

  const asyncRevalidation = { ...semanticGate('async-revalidation'), store: { revalidateSemanticGate: () => Promise.resolve(true) } };
  const admitted = runtime.admitRun({ ...common, semantic_gate: asyncRevalidation, run_id: 'run-async-revalidation', authority: { delegated: false, lanes: [] } });
  assert.equal(admitted.status, 'blocked');

  const voidRevalidation = { ...semanticGate('void-revalidation'), store: { revalidateSemanticGate() {} } };
  const voidResult = runtime.admitRun({ ...common, semantic_gate: voidRevalidation, run_id: 'run-void-revalidation', authority: { delegated: false, lanes: [] } });
  assert.equal(voidResult.status, 'blocked');
});

test('restart release can recover only through the receipt-owned semantic admission API', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-loop-recovery-'));
  const evidence = commitEvidence('run-loop-recovery', {}, stateRoot);
  const terminalEvidence = completeSafeEvidence(evidence.run, stateRoot);
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: evidence.repository_id, authorized_ref_digest: evidence.authorized_ref_digest, run_id: evidence.run_id });
  const gate = semanticGate('restart');
  gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const restartDb = new DatabaseSync(gate.store.databasePath, { readOnly: true });
  let consumerKey;
  try { consumerKey = restartDb.prepare('SELECT consumer_key FROM semantic_gate_admissions').get().consumer_key; } finally { restartDb.close(); }
  gate.consumer_identity = { consumer_key: consumerKey };
  assert.deepEqual(runtime.releaseMutationLease({
    state_root: stateRoot,
    repository_id: evidence.repository_id,
    authorized_ref_digest: evidence.authorized_ref_digest,
    run_id: evidence.run_id,
    lease_id: lease.lease_id,
    terminal_state: terminalEvidence.terminal.execution_state,
    workspace_disposition: terminalEvidence.terminal.workspace_disposition,
    publication_state: terminalEvidence.terminal.publication_state,
    semantic_gate: gate,
  }), { released: true });
});

test('typed A1 commit seam stages exactly the authorized paths and verifies the result', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-success-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const evidence = commitEvidence('run-commit', {}, stateRoot);
  const calls = [];
  const result = runtime.executeTypedGitCommit({
    ...commitOptions({ state_root: stateRoot, mutation_lease: lease, evidence }),
    git: gitFixture(),
    broker: { authorize(input) { calls.push(input); return { decision: 'allow' }; } },
  });
  assert.equal(result.status, 'committed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation_type, 'git.commit');
  assert.match(calls[0].operation_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls[0].operation.authorized_paths, ['src/file.txt']);
  const terminalEvidence = completeSafeEvidence(evidence.run, stateRoot);
  assert.deepEqual(runtime.releaseMutationLease({
    state_root: stateRoot,
    repository_id: common.repository_id,
    authorized_ref_digest: common.authorized_ref_digest,
    run_id: 'run-commit',
    lease_id: lease.lease_id,
    terminal_state: 'terminal-success',
    workspace_disposition: 'cleaned',
    publication_state: 'verified',
    run: terminalEvidence.terminal,
  }), { released: true });
});

test('typed commit and commitExact reject serialized admission context before staging', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-loop-opaque-commit-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-opaque-commit' });
  const evidence = commitEvidence('run-opaque-commit', {}, stateRoot);
  const fixture = gitFixture();
  let stageCalls = 0;
  const originalStage = fixture.stageExact;
  fixture.stageExact = (input) => { stageCalls += 1; return originalStage.call(fixture, input); };
  const serializedEvidence = { ...evidence, run: JSON.parse(JSON.stringify(evidence.run)) };
  const options = {
    ...commitOptions({ run_id: 'run-opaque-commit', state_root: stateRoot, mutation_lease: lease, evidence: serializedEvidence }),
    git: fixture,
    broker: { authorize: () => ({ decision: 'allow' }) },
  };
  expectCode(() => runtime.executeTypedGitCommit(options), 'GPR_PACKET_ADMISSION_REQUIRED');
  expectCode(() => runtime.commitExact(options), 'GPR_PACKET_ADMISSION_REQUIRED');
  assert.equal(stageCalls, 0);
});

test('typed A1 commit without an owned lease performs zero stage or commit mutation', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-required-'));
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
  expectCode(() => runtime.executeTypedGitCommit({
    ...commitOptions({ state_root: stateRoot }),
    git: fixture,
    broker: { authorize: () => ({ decision: 'allow' }) },
  }), 'LEASE_REQUIRED');
  assert.equal(stageCalls, 0);
  assert.equal(commitCalls, 0);
});

test('typed A1 commit requires an exact current lease owner before mutation', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-binding-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const cases = [
    ['forged token', 'run-commit', {}, { mutation_lease: { ...lease, lease_id: 'lease-forged' } }, 'LEASE_TOKEN_MISMATCH'],
    ['wrong run', 'run-other', {}, { run_id: 'run-other', mutation_lease: lease }, 'LEASE_BINDING_MISMATCH'],
    ['wrong repository', 'run-commit', { repository_id: 'f'.repeat(64) }, { repository_id: 'f'.repeat(64), mutation_lease: lease }, 'LEASE_BINDING_MISMATCH'],
    ['wrong ref', 'run-commit', { authorized_ref_digest: 'e'.repeat(64) }, { authorized_ref_digest: 'e'.repeat(64), mutation_lease: lease }, 'LEASE_BINDING_MISMATCH'],
  ];
  for (const [label, evidenceRunId, evidenceBindings, overrides, reasonCode] of cases) {
    const evidence = commitEvidence(evidenceRunId, evidenceBindings);
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
    expectCode(() => runtime.executeTypedGitCommit({
      ...commitOptions({ state_root: stateRoot, evidence, ...overrides }),
      git: fixture,
      broker: { authorize: () => ({ decision: 'allow' }) },
    }), reasonCode);
    assert.equal(stageCalls, 0, label);
    assert.equal(commitCalls, 0, label);
  }
});

test('expired leases cannot mutate or be silently taken over', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-expired-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit', now: 1000 });
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
  expectCode(() => runtime.executeTypedGitCommit({
    ...commitOptions({ state_root: stateRoot, mutation_lease: lease, now: Date.parse(lease.expires_at) + 1 }),
    git: fixture,
    broker: { authorize: () => ({ decision: 'allow' }) },
  }), 'LEASE_EXPIRED');
  assert.equal(stageCalls, 0);
  assert.equal(commitCalls, 0);
  expectCode(() => runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-other', now: Date.parse(lease.expires_at) + 1 }), 'CONFLICTING_RUN');
});

test('lease loss after staging blocks commit and preserves the staged evidence boundary', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-revalidate-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const fixture = gitFixture();
  let stageCalls = 0;
  let commitCalls = 0;
  const originalStage = fixture.stageExact;
  const originalCommit = fixture.commit;
  fixture.stageExact = (input) => {
    stageCalls += 1;
    const result = originalStage.call(fixture, input);
    fs.unlinkSync(path.join(stateRoot, common.repository_id + '.' + common.authorized_ref_digest + '.lease.json'));
    return result;
  };
  fixture.commit = (input) => {
    commitCalls += 1;
    return originalCommit.call(fixture, input);
  };
  expectCode(() => runtime.executeTypedGitCommit({
    ...commitOptions({ state_root: stateRoot, mutation_lease: lease }),
    git: fixture,
    broker: { authorize: () => ({ decision: 'allow' }) },
  }), 'LEASE_REQUIRED');
  assert.equal(stageCalls, 1);
  assert.equal(commitCalls, 0);
});

test('uncertain or interrupted publication preserves lease evidence until safe terminal release', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-release-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const evidence = commitEvidence('run-commit', {}, stateRoot);
  expectCode(() => runtime.releaseMutationLease({
    state_root: stateRoot,
    repository_id: common.repository_id,
    authorized_ref_digest: common.authorized_ref_digest,
    run_id: 'run-commit',
    lease_id: lease.lease_id,
    terminal_state: 'interrupted',
    workspace_disposition: 'quarantined',
    publication_state: 'uncertain',
  }), 'LEASE_RELEASE_UNSAFE');
  assert.equal(fs.existsSync(path.join(stateRoot, common.repository_id + '.' + common.authorized_ref_digest + '.lease.json')), true);
  const terminalEvidence = completeSafeEvidence(evidence.run, stateRoot);
  assert.deepEqual(runtime.releaseMutationLease({
    state_root: stateRoot,
    repository_id: common.repository_id,
    authorized_ref_digest: common.authorized_ref_digest,
    run_id: 'run-commit',
    lease_id: lease.lease_id,
    terminal_state: 'terminal-success',
    workspace_disposition: 'cleaned',
    publication_state: 'verified',
    run: terminalEvidence.terminal,
  }), { released: true });
  const later = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-later' });
  assert.equal(later.run_id, 'run-later');
});

test('typed commit rejects pre-staged, baseline, path, options, and broker boundary violations', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run158-lease-retained-'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: common.repository_id, authorized_ref_digest: common.authorized_ref_digest, run_id: 'run-commit' });
  const withLease = (overrides = {}) => commitOptions({ state_root: stateRoot, mutation_lease: lease, ...overrides });
  const preStaged = gitFixture({ status: () => ({ repository_id: common.repository_id, head: 'a'.repeat(40), tree: 'b'.repeat(40), index_digest: 'c'.repeat(64), staged_paths: ['other.txt'], worktree_paths: { staged_paths: ['other.txt'], unstaged_paths: [], untracked_paths: [] } }) });
  expectCode(() => runtime.executeTypedGitCommit({ ...withLease(), git: preStaged, broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_PREEXISTING_STAGE');
  expectCode(() => runtime.executeTypedGitCommit({ ...withLease({ expected_index_digest: 'f'.repeat(64) }), git: gitFixture(), broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_INDEX_BASELINE_MISMATCH');
  expectCode(() => runtime.executeTypedGitCommit({ ...withLease({ authorized_paths: ['--bad'] }), git: gitFixture(), broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_PATH_INVALID');
  expectCode(() => runtime.executeTypedGitCommit({ ...withLease({ commit_message: 'bad\nmessage' }), git: gitFixture(), broker: { authorize: () => ({ decision: 'allow' }) } }), 'GIT_COMMIT_MESSAGE_INVALID');
  expectCode(() => runtime.authorizeA1Operation({ ...common, run_id: 'run-stage', operation: { type: 'git.stage' }, broker: { authorize: () => ({ decision: 'allow' }) } }), 'A3_OPERATION_UNSUPPORTED');
  expectCode(() => runtime.executeTypedGitCommit({ ...withLease(), git: gitFixture(), broker: { authorize: () => ({ decision: 'deny' }) } }), 'A1_AUTHORITY_DENIED');
  expectCode(() => runtime.executeTypedGitCommit({ ...withLease(), git: gitFixture(), broker: { authorize: () => ({ decision: 'allow', issuer: 'forbidden' }) } }), 'A1_BROKER_BOUNDARY_VIOLATION');
});

test('durable state is bounded, atomic, privacy-safe, and lease-conflicted', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run157-state-'));
  const run = createRun('run-state');
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const firstWorkspace = runtime.admitWorkspace({
    state_root: stateRoot,
    run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-state', workspace_handle: 'handle-state', commit_sha: live.sha, tree_sha: live.tree }), verifySnapshot: () => true },
  });
  const first = firstWorkspace.run;
  assert.equal(first.run_id, run.run_id);
  assert.deepEqual(runtime.readDurableRun({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id }), first);
  const key = runtime.stateKey(run.repository_id, run.authorized_ref_digest, run.run_id);
  fs.writeFileSync(path.join(stateRoot, key + '.interrupted.tmp'), 'partial', 'utf8');
  expectCode(() => runtime.readDurableRun({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id }), 'INTERRUPTED_STATE');
  fs.unlinkSync(path.join(stateRoot, key + '.interrupted.tmp'));
  const lease = runtime.acquireMutationLease({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id });
  expectCode(() => runtime.acquireMutationLease({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: 'run-other', now: Date.now() + 900000 }), 'CONFLICTING_RUN');
  expectCode(() => runtime.releaseMutationLease({ state_root: stateRoot, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id, lease_id: 'lease-forged', terminal_state: 'terminal-success', workspace_disposition: 'cleaned', publication_state: 'verified' }), 'LEASE_TOKEN_MISMATCH');
  const running = runtime.transitionRun(firstWorkspace.run, 'running', { state_root: stateRoot });
  const terminalEvidence = completeSafeEvidence(running, stateRoot);
  assert.deepEqual(runtime.releaseMutationLease({
    state_root: stateRoot,
    repository_id: run.repository_id,
    authorized_ref_digest: run.authorized_ref_digest,
    run_id: run.run_id,
    lease_id: lease.lease_id,
    terminal_state: 'terminal-success',
    workspace_disposition: 'cleaned',
    publication_state: 'verified',
    run: terminalEvidence.terminal,
  }), { released: true });
});

test('uncertain and dirty workspace evidence is preserved or quarantined and cannot be cleaned', () => {
  assert.equal(runtime.finalizeWorkspace({ facts: { terminal_evidence_durable: true, publication_verified: true, proven_disposable: true } }).disposition, 'cleaned');
  assert.equal(runtime.finalizeWorkspace({ facts: { terminal_evidence_durable: true, publication_verified: true, proven_disposable: true, dirty: true } }).disposition, 'preserved');
  assert.equal(runtime.finalizeWorkspace({ facts: { terminal_evidence_durable: true, publication_verified: true, proven_disposable: true, uncertain: true } }).disposition, 'quarantined');
  assert.equal(runtime.cleanupWorkspace({ facts: { terminal_evidence_durable: true, publication_verified: false, proven_disposable: true } }).removable, false);
  expectCode(() => runtime.createTerminalPacket({ run_id: 'run-finality', outcome: 'success', reason_code: 'accepted', evidence_digest: 'a'.repeat(64) }), 'TERMINAL_FINALITY_FORBIDDEN');
});

test('applicable Loop completion and release require durable fresh-read substantive output custody', () => {
  const unclassified = completionEvidence('run072-outgoing-unclassified', true, false);
  expectCode(() => runtime.completeRun({
    state_root: unclassified.stateRoot,
    run: unclassified.validating,
    terminal_packet: unclassified.terminalPacket,
  }), 'GPR_PACKET_AUTHORITY_UNVERIFIED');

  const missing = completionEvidence('run072-outgoing-missing', true);
  expectCode(() => runtime.completeRun({
    state_root: missing.stateRoot,
    run: missing.validating,
    terminal_packet: missing.terminalPacket,
  }), 'GPR_PACKET_OUTGOING_CUSTODY_REQUIRED');
  const missingRun = runtime.readDurableRun({
    state_root: missing.stateRoot,
    repository_id: missing.running.repository_id,
    authorized_ref_digest: missing.running.authorized_ref_digest,
    run_id: missing.running.run_id,
  });
  assert.equal(missingRun.execution_state, 'validating');
  const missingDb = new DatabaseSync(missing.substantiveResult.store.databasePath, { readOnly: true });
  try {
    assert.equal(missingDb.prepare('SELECT COUNT(*) AS n FROM authority_packets').get().n, 0);
    assert.equal(missingDb.prepare("SELECT COUNT(*) AS n FROM authority_packet_events WHERE event_type='CONSUMER_COMPLETED'").get().n, 0);
  } finally { missingDb.close(); }

  const complete = completionEvidence('run072-outgoing-positive', true);
  const terminal = runtime.completeRun({
    state_root: complete.stateRoot,
    run: complete.validating,
    terminal_packet: complete.terminalPacket,
    substantive_result: complete.substantiveResult,
  });
  assert.equal(terminal.execution_state, 'terminal-success');
  assert.equal(terminal.terminal_packet_digest, runtime.digestValue(complete.terminalPacket));
  const outputDb = new DatabaseSync(complete.substantiveResult.store.databasePath, { readOnly: true });
  try {
    assert.equal(outputDb.prepare('SELECT COUNT(*) AS n FROM authority_packets').get().n, 1);
    assert.equal(outputDb.prepare("SELECT COUNT(*) AS n FROM authority_packet_events WHERE event_type='CONSUMER_COMPLETED'").get().n, 1);
  } finally { outputDb.close(); }
  assert.deepEqual(runtime.releaseMutationLease({
    state_root: complete.stateRoot,
    repository_id: complete.running.repository_id,
    authorized_ref_digest: complete.running.authorized_ref_digest,
    run_id: complete.running.run_id,
    lease_id: complete.lease.lease_id,
    terminal_state: terminal.execution_state,
    workspace_disposition: terminal.workspace_disposition,
    publication_state: terminal.publication_state,
    run: terminal,
    substantive_result: { store: complete.substantiveResult.store },
  }), { released: true });

  const noLaterConsumer = completionEvidence('run072-no-later-consumer', false);
  const noLaterTerminal = runtime.completeRun({
    state_root: noLaterConsumer.stateRoot,
    run: noLaterConsumer.validating,
    terminal_packet: noLaterConsumer.terminalPacket,
  });
  assert.equal(noLaterTerminal.execution_state, 'terminal-success');
  assert.deepEqual(runtime.releaseMutationLease({
    state_root: noLaterConsumer.stateRoot,
    repository_id: noLaterConsumer.running.repository_id,
    authorized_ref_digest: noLaterConsumer.running.authorized_ref_digest,
    run_id: noLaterConsumer.running.run_id,
    lease_id: noLaterConsumer.lease.lease_id,
    terminal_state: noLaterTerminal.execution_state,
    workspace_disposition: noLaterTerminal.workspace_disposition,
    publication_state: noLaterTerminal.publication_state,
    run: noLaterTerminal,
  }), { released: true });
});

test('retry requires fresh authority and live workspace admission', () => {
  const previous = createRun('run-previous');
  const uncertain = runtime.transitionRun(previous, 'workspace-ready', { publication_state: 'uncertain' });
  assert.equal(runtime.prepareRetry({ ...common, previous_run: uncertain, run_id: 'run-new', current_authority_digest: 'e'.repeat(64), authority: { delegated: false, lanes: [] } }).reason_code, 'PUBLICATION_UNCERTAIN');
  assert.equal(runtime.prepareRetry({ ...common, previous_run: previous, run_id: 'run-new', current_authority_digest: 'd'.repeat(64), authority: { delegated: false, lanes: [] } }).reason_code, 'FRESH_AUTHORITY_REQUIRED');
  assert.equal(runtime.prepareRetry({ ...common, previous_run: previous, run_id: 'run-new', current_authority_digest: 'e'.repeat(64), authority: { delegated: false, lanes: [] } }).reason_code, 'FRESH_LIVE_ADMISSION_REQUIRED');
  const sha = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const ready = runtime.prepareRetry({
    ...common,
    previous_run: previous,
    run_id: 'run-new',
    current_authority_digest: 'e'.repeat(64),
    authority: { delegated: false, lanes: [] },
    semantic_gate: semanticGate('retry-ready'),
    expected_live: { ref: 'refs/heads/main', sha, tree },
    liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha, tree }) },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-retry', workspace_handle: 'handle-retry', commit_sha: sha, tree_sha: tree }), verifySnapshot: () => true },
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.run.execution_state, 'workspace-ready');
});
