'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-execution-loop.cjs');

const common = {
  task: { id: 'task-run162-red', digest: 'a'.repeat(64) },
  repository_id: 'b'.repeat(64),
  authorized_ref_digest: 'c'.repeat(64),
  current_authority_digest: 'd'.repeat(64),
};
const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };

function enabledConsent() {
  return { status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function workspacePrepared(runId, overrides = {}) {
  return {
    workspace_id: 'workspace-' + runId,
    workspace_handle: 'handle-' + runId,
    commit_sha: live.sha,
    tree_sha: live.tree,
    ...overrides,
  };
}

function workspaceAttempt(runId, prepared, verifier = () => true, overrides = {}) {
  const admitted = runtime.admitRun({
    ...common,
    run_id: runId,
    consentProvider: enabledConsent,
    authority: { delegated: false, lanes: [] },
  });
  const workspaceAdapter = { prepare: () => prepared };
  if (verifier !== undefined) workspaceAdapter.verifySnapshot = verifier;
  return runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter,
    ...overrides,
  });
}

test('RUN162 RED: workspace admission requires explicit observed commit and tree', () => {
  const bothMissing = workspacePrepared('run-red-workspace-both-missing');
  delete bothMissing.commit_sha;
  delete bothMissing.tree_sha;
  expectCode(() => workspaceAttempt('run-red-workspace-both-missing', bothMissing), 'WORKSPACE_SNAPSHOT_OBSERVATION_REQUIRED');
  const treeMissing = workspacePrepared('run-red-workspace-tree-missing');
  delete treeMissing.tree_sha;
  expectCode(() => workspaceAttempt('run-red-workspace-tree-missing', treeMissing), 'WORKSPACE_SNAPSHOT_OBSERVATION_REQUIRED');
  const commitMissing = workspacePrepared('run-red-workspace-commit-missing');
  delete commitMissing.commit_sha;
  expectCode(() => workspaceAttempt('run-red-workspace-commit-missing', commitMissing), 'WORKSPACE_SNAPSHOT_OBSERVATION_REQUIRED');
});

test('RUN162 RED: workspace admission requires synchronous positive snapshot verification', () => {
  const runId = 'run-red-workspace-verifier-missing';
  expectCode(() => workspaceAttempt(runId, workspacePrepared(runId), null), 'WORKSPACE_SNAPSHOT_VERIFICATION_REQUIRED');
  for (const [label, verifier] of [
    ['false', () => false],
    ['invalid', () => ({ verified: 'yes' })],
    ['unsupported', () => ({ verified: true, unsupported: true })],
    ['async', () => Promise.resolve(true)],
  ]) {
    const caseRunId = 'run-red-workspace-verifier-' + label;
    expectCode(() => workspaceAttempt(caseRunId, workspacePrepared(caseRunId), verifier), 'WORKSPACE_SNAPSHOT_MISMATCH');
  }
});

test('RUN162 RED: workspace admission rejects observed snapshot mismatches and preserves the receipt contract', () => {
  const commitMismatch = 'f'.repeat(40);
  const treeMismatch = 'e'.repeat(40);
  expectCode(() => workspaceAttempt('run-red-workspace-commit-mismatch', workspacePrepared('run-red-workspace-commit-mismatch', { commit_sha: commitMismatch })), 'WORKSPACE_SNAPSHOT_MISMATCH');
  expectCode(() => workspaceAttempt('run-red-workspace-tree-mismatch', workspacePrepared('run-red-workspace-tree-mismatch', { tree_sha: treeMismatch })), 'WORKSPACE_SNAPSHOT_MISMATCH');

  const result = workspaceAttempt('run-red-workspace-exact', workspacePrepared('run-red-workspace-exact'));
  assert.equal(result.status, 'workspace-ready');
  assert.deepEqual(Object.keys(result.workspace_receipt).sort(), [
    'authorized_ref_digest',
    'contract_version',
    'live_ref_digest',
    'repository_id',
    'run_id',
    'setup_digest',
    'snapshot_commit_digest',
    'snapshot_tree_digest',
    'verified',
    'workspace_handle',
    'workspace_id',
  ].sort());
  assert.equal(result.workspace_receipt.contract_version, 'toolkit.execution-loop.workspace-receipt.v1');
  assert.equal(result.workspace_receipt.snapshot_commit_digest, runtime.digestValue(live.sha));
  assert.equal(result.workspace_receipt.snapshot_tree_digest, runtime.digestValue(live.tree));
  assert.equal(result.workspace_receipt.verified, true);
});

function durableFixture(runId = 'run-red-durable') {
  const admitted = runtime.admitRun({
    ...common,
    run_id: runId,
    consentProvider: enabledConsent,
    authority: { delegated: false, lanes: [] },
  });
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => workspacePrepared(runId),
      verifySnapshot: () => true,
    },
  });
  const running = runtime.transitionRun(workspace.run, 'running');
  const validating = runtime.transitionRun(running, 'validating');
  const terminal_packet = runtime.createTerminalPacket({
    run_id: runId,
    outcome: 'success',
    reason_code: 'RUN162_SAFE',
    evidence_digest: 'e'.repeat(64),
    publication_state: 'verified',
    workspace_disposition: 'cleaned',
  });
  const terminal = runtime.completeRun({ run: validating, terminal_packet });
  return { admitted, workspace, running, validating, terminal_packet, terminal };
}

function artifactPath(stateRoot, repositoryId, authorizedRefDigest, runId, artifactType) {
  return path.join(stateRoot, runtime.artifactKey(repositoryId, authorizedRefDigest, runId, artifactType) + '.json');
}

function persistRunOnly(stateRoot, fixture, run = fixture.terminal) {
  runtime.writeDurableRun({ state_root: stateRoot, run });
}

function persistWorkspace(stateRoot, fixture, receipt = fixture.workspace.workspace_receipt) {
  runtime.writeDurableWorkspaceReceipt({ state_root: stateRoot, workspace_receipt: receipt });
}

function persistTerminal(stateRoot, fixture, packet = fixture.terminal_packet) {
  runtime.writeDurableTerminalPacket({
    state_root: stateRoot,
    repository_id: fixture.terminal.repository_id,
    authorized_ref_digest: fixture.terminal.authorized_ref_digest,
    run_id: fixture.terminal.run_id,
    terminal_packet: packet,
  });
}

function releaseOptions(stateRoot, fixture, lease, overrides = {}) {
  return {
    state_root: stateRoot,
    repository_id: fixture.terminal.repository_id,
    authorized_ref_digest: fixture.terminal.authorized_ref_digest,
    run_id: fixture.terminal.run_id,
    lease_id: lease.lease_id,
    terminal_state: 'terminal-success',
    workspace_disposition: 'cleaned',
    publication_state: 'verified',
    ...overrides,
  };
}

function assertReleaseBlocked(stateRoot, fixture, setup) {
  const lease = runtime.acquireMutationLease({
    state_root: stateRoot,
    repository_id: fixture.terminal.repository_id,
    authorized_ref_digest: fixture.terminal.authorized_ref_digest,
    run_id: fixture.terminal.run_id,
  });
  setup();
  expectCode(() => runtime.releaseMutationLease(releaseOptions(stateRoot, fixture, lease)), 'LEASE_RELEASE_UNSAFE');
  assert.equal(fs.existsSync(path.join(stateRoot, fixture.terminal.repository_id + '.' + fixture.terminal.authorized_ref_digest + '.lease.json')), true);
}

test('RUN162 RED: durable release requires both exact persisted artifacts and cross-artifact bindings', () => {
  {
    const fixture = durableFixture('run-red-durable-fake-digests');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-fake-digests-'));
    assertReleaseBlocked(root, fixture, () => persistRunOnly(root, fixture, {
      ...fixture.terminal,
      workspace_receipt_digest: 'a'.repeat(64),
      terminal_packet_digest: 'b'.repeat(64),
    }));
  }
  for (const [label, persist] of [
    ['workspace-only', (root, fixture) => { persistRunOnly(root, fixture); persistWorkspace(root, fixture); }],
    ['terminal-only', (root, fixture) => { persistRunOnly(root, fixture); persistTerminal(root, fixture); }],
  ]) {
    const fixture = durableFixture('run-red-durable-' + label);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-' + label + '-'));
    assertReleaseBlocked(root, fixture, () => persist(root, fixture));
  }
});

test('RUN162 RED: durable release rejects wrong bindings, repository/ref mismatches, and digest mismatches', () => {
  const cases = [
    ['workspace-wrong-run', (root, fixture) => {
      persistRunOnly(root, fixture);
      persistTerminal(root, fixture);
      const receipt = { ...fixture.workspace.workspace_receipt, run_id: 'run-wrong-workspace' };
      fs.writeFileSync(artifactPath(root, fixture.terminal.repository_id, fixture.terminal.authorized_ref_digest, fixture.terminal.run_id, 'workspace-receipt'), JSON.stringify(receipt), 'utf8');
    }],
    ['terminal-wrong-run', (root, fixture) => {
      persistRunOnly(root, fixture);
      persistWorkspace(root, fixture);
      const packet = { ...fixture.terminal_packet, run_id: 'run-wrong-terminal' };
      fs.writeFileSync(artifactPath(root, fixture.terminal.repository_id, fixture.terminal.authorized_ref_digest, fixture.terminal.run_id, 'terminal-packet'), JSON.stringify(packet), 'utf8');
    }],
    ['repository-ref-mismatch', (root, fixture) => {
      const mismatched = { ...fixture.terminal, repository_id: 'f'.repeat(64) };
      fs.writeFileSync(path.join(root, runtime.stateKey(fixture.terminal.repository_id, fixture.terminal.authorized_ref_digest, fixture.terminal.run_id) + '.json'), JSON.stringify(mismatched), 'utf8');
      persistWorkspace(root, fixture);
      persistTerminal(root, fixture);
    }],
    ['workspace-digest-mismatch', (root, fixture) => {
      persistRunOnly(root, fixture, { ...fixture.terminal, workspace_receipt_digest: 'a'.repeat(64) });
      persistWorkspace(root, fixture);
      persistTerminal(root, fixture);
    }],
    ['terminal-digest-mismatch', (root, fixture) => {
      persistRunOnly(root, fixture, { ...fixture.terminal, terminal_packet_digest: 'a'.repeat(64) });
      persistWorkspace(root, fixture);
      persistTerminal(root, fixture);
    }],
  ];
  for (const [label, setup] of cases) {
    const fixture = durableFixture('run-red-binding-' + label);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-binding-' + label + '-'));
    assertReleaseBlocked(root, fixture, () => setup(root, fixture));
  }
});

test('RUN162 RED: durable release rejects terminal outcome, workspace disposition, publication, malformed, and interrupted contradictions', () => {
  function makePacket(fixture, overrides = {}) {
    return runtime.createTerminalPacket({
      run_id: fixture.terminal_packet.run_id,
      outcome: fixture.terminal_packet.outcome,
      reason_code: fixture.terminal_packet.reason_code,
      evidence_digest: fixture.terminal_packet.evidence_digest,
      workspace_disposition: fixture.terminal_packet.workspace_disposition,
      publication_state: fixture.terminal_packet.publication_state,
      ...overrides,
    });
  }
  const mismatches = [
    ['outcome', (fixture) => {
      const packet = makePacket(fixture, { outcome: 'failure' });
      return { run: { ...fixture.terminal, terminal_packet_digest: runtime.digestValue(packet) }, packet };
    }],
    ['workspace-disposition', (fixture) => {
      const packet = makePacket(fixture, { workspace_disposition: 'preserved' });
      return { run: { ...fixture.terminal, terminal_packet_digest: runtime.digestValue(packet) }, packet };
    }],
    ['publication-state', (fixture) => {
      const packet = makePacket(fixture, { publication_state: 'none' });
      return { run: { ...fixture.terminal, terminal_packet_digest: runtime.digestValue(packet) }, packet };
    }],
  ];
  for (const [label, make] of mismatches) {
    const fixture = durableFixture('run-red-contradiction-' + label);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-contradiction-' + label + '-'));
    const changed = make(fixture);
    assertReleaseBlocked(root, fixture, () => {
      persistRunOnly(root, fixture, changed.run);
      persistWorkspace(root, fixture);
      persistTerminal(root, fixture, changed.packet);
    });
  }

  const malformedFixture = durableFixture('run-red-malformed-artifact');
  const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-malformed-'));
  expectCode(() => runtime.writeDurableWorkspaceReceipt({ state_root: malformedRoot, workspace_receipt: { ...malformedFixture.workspace.workspace_receipt, verified: false } }), 'WORKSPACE_RECEIPT_INVALID');

  const interruptedFixture = durableFixture('run-red-interrupted-artifact');
  const interruptedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-interrupted-'));
  const interruptedKey = runtime.artifactKey(interruptedFixture.terminal.repository_id, interruptedFixture.terminal.authorized_ref_digest, interruptedFixture.terminal.run_id, 'workspace-receipt');
  fs.writeFileSync(path.join(interruptedRoot, interruptedKey + '.interrupted.tmp'), 'partial', 'utf8');
  expectCode(() => persistWorkspace(interruptedRoot, interruptedFixture), 'INTERRUPTED_STATE');
});

test('RUN162 RED: exact durable evidence releases the lease and permits only a later run to acquire it', () => {
  const fixture = durableFixture('run-red-durable-exact');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run162-red-exact-'));
  const lease = runtime.acquireMutationLease({ state_root: root, repository_id: fixture.terminal.repository_id, authorized_ref_digest: fixture.terminal.authorized_ref_digest, run_id: fixture.terminal.run_id });
  persistRunOnly(root, fixture);
  persistWorkspace(root, fixture);
  persistTerminal(root, fixture);
  assert.deepEqual(runtime.releaseMutationLease(releaseOptions(root, fixture, lease)), { released: true });
  const later = runtime.acquireMutationLease({ state_root: root, repository_id: fixture.terminal.repository_id, authorized_ref_digest: fixture.terminal.authorized_ref_digest, run_id: 'run-red-later' });
  assert.equal(later.run_id, 'run-red-later');
});

function delegatedAdmissionWithConsent(runId, consentProvider) {
  const admitted = runtime.admitRun({
    ...common,
    run_id: runId,
    consentProvider,
    authority: { delegated: true, lanes: ['worker-a', 'worker-b'] },
    adapters: {
      'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
      'worker-b': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
    },
  });
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => workspacePrepared(runId),
      verifySnapshot: () => true,
    },
  });
  return { admitted, workspace };
}

function sequenceConsent(sequence) {
  let index = 0;
  return () => {
    const state = sequence[Math.min(index++, sequence.length - 1)];
    if (state === 'interrupted') return { interrupted: true };
    if (state === 'malformed') return { schema_version: 99, capabilities: { execution_loop: { state: 'enabled' } } };
    return { status: 'healthy', capabilities: { execution_loop: { state } } };
  };
}

function startOptions(admission, consentProvider, counters) {
  return {
    ...common,
    consentProvider,
    run_id: admission.admitted.run.run_id,
    repository_id: admission.admitted.run.repository_id,
    authorized_ref_digest: admission.admitted.run.authorized_ref_digest,
    current_authority_digest: admission.admitted.run.current_authority_digest,
    route_plan: admission.admitted.route_plan,
    run: admission.workspace.run,
    workspace_receipt: admission.workspace.workspace_receipt,
    liveRefProvider: { read: () => live },
    prepareLaunch(lane) {
      counters.prepared += 1;
      return { lane_id: lane.lane_id, reservation_handle: 'reservation-' + lane.lane_id, inert: true };
    },
    commitLaunchBatch({ reservations }) {
      counters.committed += 1;
      return { atomic: true, started_lane_ids: reservations.map((item) => item.lane_id) };
    },
  };
}

test('RUN162 RED: start-time disabled consent blocks before the atomic substantive batch and remains workspace-ready', () => {
  for (const [label, sequence, expectedPrepared] of [
    ['before-running', ['enabled', 'disabled'], 0],
    ['before-batch', ['enabled', 'enabled', 'disabled'], 2],
  ]) {
    const consentProvider = sequenceConsent(sequence);
    const admission = delegatedAdmissionWithConsent('run-red-start-disabled-' + label, consentProvider);
    const counters = { prepared: 0, committed: 0 };
    const result = runtime.startDelegatedRun(startOptions(admission, consentProvider, counters));
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason_code, 'CONSENT_DISABLED');
    assert.equal(result.run.execution_state, 'workspace-ready');
    assert.equal(counters.prepared, expectedPrepared);
    assert.equal(counters.committed, 0);
  }
});

test('RUN162 RED: unresolved, malformed, and interrupted start-time consent produce zero substantive launches', () => {
  for (const state of ['unresolved', 'malformed', 'interrupted']) {
    const consentProvider = sequenceConsent(['enabled', state]);
    const admission = delegatedAdmissionWithConsent('run-red-start-' + state, consentProvider);
    const counters = { prepared: 0, committed: 0 };
    const result = runtime.startDelegatedRun(startOptions(admission, consentProvider, counters));
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason_code, state === 'unresolved' ? 'CONSENT_UNRESOLVED' : state === 'malformed' ? 'CONSENT_MALFORMED' : 'CONSENT_INTERRUPTED');
    assert.equal(result.run.execution_state, 'workspace-ready');
    assert.equal(counters.committed, 0);
  }
});

test('RUN162 RED: enabled start-time consent preserves workspace-ready to running and one atomic batch', () => {
  const consentProvider = sequenceConsent(['enabled', 'enabled', 'enabled']);
  const admission = delegatedAdmissionWithConsent('run-red-start-enabled', consentProvider);
  const counters = { prepared: 0, committed: 0 };
  const result = runtime.startDelegatedRun(startOptions(admission, consentProvider, counters));
  assert.equal(result.status, 'running');
  assert.equal(result.run.execution_state, 'running');
  assert.equal(counters.prepared, 2);
  assert.equal(counters.committed, 1);
  assert.deepEqual(result.launches, ['worker-a', 'worker-b']);
});
