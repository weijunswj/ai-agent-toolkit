'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-execution-loop.cjs');

const common = {
  task: { id: 'task-run164-red', digest: 'a'.repeat(64) },
  repository_id: 'b'.repeat(64),
  authorized_ref_digest: 'c'.repeat(64),
  current_authority_digest: 'd'.repeat(64),
  consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
  authority: { delegated: false, lanes: [] },
};
const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function releaseOptions(root, run, lease, overrides = {}) {
  return {
    state_root: root,
    repository_id: run.repository_id,
    authorized_ref_digest: run.authorized_ref_digest,
    run_id: run.run_id,
    lease_id: lease.lease_id,
    terminal_state: run.execution_state,
    workspace_disposition: run.workspace_disposition,
    publication_state: run.publication_state,
    ...overrides,
  };
}

function workspaceAdapter(runId) {
  return {
    prepare: () => ({
      workspace_id: 'workspace-' + runId,
      workspace_handle: 'handle-' + runId,
      commit_sha: live.sha,
      tree_sha: live.tree,
    }),
    verifySnapshot: () => true,
  };
}

function governedFixture(runId, root, publicationPending = false) {
  const admitted = runtime.admitRun({ ...common, run_id: runId });
  const workspace = runtime.admitWorkspace({
    state_root: root,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: workspaceAdapter(runId),
  });
  const running = runtime.transitionRun(workspace.run, 'running', { state_root: root });
  const validating = runtime.transitionRun(running, 'validating', { state_root: root });
  const preterminal = publicationPending
    ? runtime.transitionRun(validating, 'publication-pending', { state_root: root, publication_state: 'none' })
    : validating;
  const terminal_packet = runtime.createTerminalPacket({
    run_id: runId,
    outcome: 'success',
    reason_code: 'RUN164_SAFE',
    evidence_digest: 'e'.repeat(64),
    publication_state: 'none',
    workspace_disposition: 'cleaned',
  });
  const terminal = runtime.completeRun({ state_root: root, run: preterminal, terminal_packet });
  return { admitted, workspace, running, validating, preterminal, terminal_packet, terminal };
}

function standaloneContracts(runId) {
  const admitted = runtime.admitRun({ ...common, run_id: runId });
  const workspace_receipt = runtime.createWorkspaceReceipt({
    run_id: runId,
    repository_id: admitted.run.repository_id,
    authorized_ref_digest: admitted.run.authorized_ref_digest,
    live_ref_digest: runtime.digestValue(live.ref),
    snapshot_commit_digest: runtime.digestValue(live.sha),
    snapshot_tree_digest: runtime.digestValue(live.tree),
    workspace_id: 'workspace-' + runId,
    workspace_handle: 'handle-' + runId,
    setup_digest: runtime.digestValue({ operations: [], commit: live.sha, tree: live.tree }),
    verified: true,
  });
  const workspaceRun = runtime.transitionRun(admitted.run, 'workspace-ready', { workspace_receipt_digest: runtime.digestValue(workspace_receipt) });
  const running = runtime.transitionRun(workspaceRun, 'running');
  const validating = runtime.transitionRun(running, 'validating');
  const terminal_packet = runtime.createTerminalPacket({
    run_id: runId,
    outcome: 'success',
    reason_code: 'RUN164_STANDALONE',
    evidence_digest: 'f'.repeat(64),
    publication_state: 'verified',
    workspace_disposition: 'cleaned',
  });
  return { run: validating, workspace_receipt, terminal_packet };
}

function writeStandaloneArtifact(root, run, artifactType, artifact) {
  fs.mkdirSync(root, { recursive: true });
  const key = runtime.artifactKey(run.repository_id, run.authorized_ref_digest, run.run_id, artifactType);
  fs.writeFileSync(path.join(root, key + '.json'), JSON.stringify(artifact), 'utf8');
}

test('RUN164 GREEN: exactly five contracts remain and no sixth durable structure exists', () => {
  assert.deepEqual(runtime.CONTRACTS, [
    'toolkit.execution-loop.request.v1',
    'toolkit.execution-loop.route-plan.v1',
    'toolkit.execution-loop.run-receipt.v1',
    'toolkit.execution-loop.workspace-receipt.v1',
    'toolkit.execution-loop.terminal-packet.v1',
  ]);
  for (const name of ['writeDurableRun', 'writeDurableWorkspaceReceipt', 'writeDurableTerminalPacket', 'readDurableLifecycleProvenance']) {
    assert.equal(Object.prototype.hasOwnProperty.call(runtime, name), false);
  }
  const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'toolkit-execution-loop.cjs'), 'utf8');
  const policySource = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'bounded-local-execution-loop', 'execution-loop-policy.json'), 'utf8');
  for (const source of [runtimeSource, policySource]) {
    assert.doesNotMatch(source, /execution-loop-lifecycle-provenance\.v1|\.lifecycle\.json|lifecycle_provenance|validateDurableLifecycleProvenance|readDurableLifecycleProvenance|writeDurableLifecycleProvenance/);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-green-five-contracts-'));
  const admitted = runtime.admitRun({ ...common, run_id: 'run164-five-contracts' });
  const workspace = runtime.admitWorkspace({
    state_root: root,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: workspaceAdapter(admitted.run.run_id),
  });
  const names = fs.readdirSync(root);
  assert.equal(names.some((name) => name.endsWith('.lifecycle.json')), false);
  assert.equal(names.filter((name) => name.endsWith('.json')).length, 2);
  assert.equal(runtime.readDurableRun({ state_root: root, repository_id: admitted.run.repository_id, authorized_ref_digest: admitted.run.authorized_ref_digest, run_id: admitted.run.run_id }).execution_state, 'workspace-ready');
  assert.equal(runtime.readDurableWorkspaceReceipt({ state_root: root, repository_id: admitted.run.repository_id, authorized_ref_digest: admitted.run.authorized_ref_digest, run_id: admitted.run.run_id }).verified, true);
  assert.equal(workspace.run.workspace_receipt_digest !== null, true);
});

test('RUN164 RED: standalone existing-contract artifacts cannot create release authority', () => {
  const fixture = standaloneContracts('run164-standalone-contracts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-standalone-'));
  writeStandaloneArtifact(root, fixture.run, 'workspace-receipt', fixture.workspace_receipt);
  writeStandaloneArtifact(root, fixture.run, 'terminal-packet', fixture.terminal_packet);
  const lease = runtime.acquireMutationLease({
    state_root: root,
    repository_id: fixture.run.repository_id,
    authorized_ref_digest: fixture.run.authorized_ref_digest,
    run_id: fixture.run.run_id,
  });
  expectCode(() => runtime.releaseMutationLease(releaseOptions(root, fixture.run, lease, { terminal_state: 'terminal-success', publication_state: 'verified' })), 'LEASE_RELEASE_UNSAFE');
});

test('RUN164 GREEN: governed five-contract progression persists exact predecessors and releases safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-green-governed-'));
  const fixture = governedFixture('run164-governed-release', root, true);
  const runOptions = { state_root: root, repository_id: fixture.terminal.repository_id, authorized_ref_digest: fixture.terminal.authorized_ref_digest, run_id: fixture.terminal.run_id };
  assert.equal(runtime.readDurableRun(runOptions).execution_state, 'terminal-success');
  assert.equal(runtime.readDurableRun(runOptions).workspace_receipt_digest, runtime.digestValue(runtime.readDurableWorkspaceReceipt(runOptions)));
  assert.equal(runtime.readDurableRun(runOptions).terminal_packet_digest, runtime.digestValue(runtime.readDurableTerminalPacket(runOptions)));
  assert.equal(fs.readdirSync(root).some((name) => name.endsWith('.lifecycle.json')), false);

  const lease = runtime.acquireMutationLease(runOptions);
  expectCode(() => runtime.acquireMutationLease({ ...runOptions, run_id: 'run164-competing-before-release' }), 'CONFLICTING_RUN');
  assert.deepEqual(runtime.releaseMutationLease(releaseOptions(root, fixture.terminal, lease)), { released: true });
  const later = runtime.acquireMutationLease({ ...runOptions, run_id: 'run164-fresh-after-release' });
  assert.equal(later.run_id, 'run164-fresh-after-release');
});

test('RUN164 RED: missing terminal evidence, wrong owner, and nonterminal state cannot release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-nonterminal-'));
  const admitted = runtime.admitRun({ ...common, run_id: 'run164-nonterminal' });
  const workspace = runtime.admitWorkspace({
    state_root: root,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: workspaceAdapter(admitted.run.run_id),
  });
  const running = runtime.transitionRun(workspace.run, 'running', { state_root: root });
  const lease = runtime.acquireMutationLease({
    state_root: root,
    repository_id: running.repository_id,
    authorized_ref_digest: running.authorized_ref_digest,
    run_id: running.run_id,
  });
  expectCode(() => runtime.releaseMutationLease({ ...releaseOptions(root, running, lease), lease_id: 'wrong-lease' }), 'LEASE_TOKEN_MISMATCH');
  expectCode(() => runtime.releaseMutationLease(releaseOptions(root, running, lease)), 'LEASE_RELEASE_UNSAFE');
  assert.equal(fs.existsSync(path.join(root, running.repository_id + '.' + running.authorized_ref_digest + '.lease.json')), true);
});
