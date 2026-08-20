'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-execution-loop.cjs');

const common = {
  task: { id: 'task-run163-red', digest: 'a'.repeat(64) },
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

function releaseOptions(stateRoot, run, lease, overrides = {}) {
  return {
    state_root: stateRoot,
    repository_id: run.repository_id,
    authorized_ref_digest: run.authorized_ref_digest,
    run_id: run.run_id,
    lease_id: lease.lease_id,
    terminal_state: 'terminal-success',
    workspace_disposition: 'cleaned',
    publication_state: 'none',
    ...overrides,
  };
}

function governedFixture(runId, stateRoot, publicationState = 'none') {
  const admitted = runtime.admitRun({ ...common, run_id: runId });
  const workspace = runtime.admitWorkspace({
    state_root: stateRoot,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => ({ workspace_id: 'workspace-' + runId, workspace_handle: 'handle-' + runId, commit_sha: live.sha, tree_sha: live.tree }),
      verifySnapshot: () => true,
    },
  });
  const running = runtime.transitionRun(workspace.run, 'running', { state_root: stateRoot });
  const validating = runtime.transitionRun(running, 'validating', { state_root: stateRoot });
  const terminal_packet = runtime.createTerminalPacket({
    run_id: runId,
    outcome: 'success',
    reason_code: 'RUN163_SAFE',
    evidence_digest: 'e'.repeat(64),
    publication_state: publicationState,
    workspace_disposition: 'cleaned',
  });
  const terminal = runtime.completeRun({ state_root: stateRoot, run: validating, terminal_packet });
  return { admitted, workspace, running, validating, terminal_packet, terminal };
}

function callerAuthoredFixture(runId) {
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
    reason_code: 'RUN163_FORGED',
    evidence_digest: 'f'.repeat(64),
    publication_state: 'verified',
    workspace_disposition: 'cleaned',
  });
  const terminal = runtime.completeRun({ run: validating, terminal_packet });
  return { admitted, workspaceRun, running, validating, workspace_receipt, terminal_packet, terminal };
}

function persistStandaloneArtifacts(root, fixture) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, runtime.artifactKey(fixture.terminal.repository_id, fixture.terminal.authorized_ref_digest, fixture.terminal.run_id, 'workspace-receipt') + '.json'), JSON.stringify(fixture.workspace.workspace_receipt), 'utf8');
  fs.writeFileSync(path.join(root, runtime.artifactKey(fixture.terminal.repository_id, fixture.terminal.authorized_ref_digest, fixture.terminal.run_id, 'terminal-packet') + '.json'), JSON.stringify(fixture.terminal_packet), 'utf8');
}

function acquire(root, run) {
  return runtime.acquireMutationLease({
    state_root: root,
    repository_id: run.repository_id,
    authorized_ref_digest: run.authorized_ref_digest,
    run_id: run.run_id,
  });
}

test('RUN164 RED: removed public durable writers cannot create release authority', () => {
  assert.equal(runtime.CONTRACTS.length, 5);
  for (const name of ['writeDurableRun', 'writeDurableWorkspaceReceipt', 'writeDurableTerminalPacket']) {
    assert.equal(Object.prototype.hasOwnProperty.call(runtime, name), false);
  }
  const fixture = callerAuthoredFixture('run-red-public-triplet');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-public-triplet-'));
  const lease = acquire(root, fixture.terminal);
  expectCode(() => runtime.releaseMutationLease(releaseOptions(root, fixture.terminal, lease, { publication_state: 'verified' })), 'LEASE_RELEASE_UNSAFE');
});

test('RUN164 RED: admitted-to-terminal leap cannot create release authority', () => {
  const fixture = governedFixture('run-red-terminal-leap', undefined, 'verified');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-terminal-leap-'));
  const lease = acquire(root, fixture.terminal);
  expectCode(() => runtime.completeRun({
    state_root: root,
    run: fixture.admitted.run,
    terminal_packet: fixture.terminal_packet,
  }), 'INVALID_STATE_TRANSITION');
  expectCode(() => runtime.releaseMutationLease(releaseOptions(root, fixture.terminal, lease, { publication_state: 'verified' })), 'LEASE_RELEASE_UNSAFE');
});

test('RUN164 RED: standalone workspace and terminal contracts cannot create release authority', () => {
  const fixture = governedFixture('run-red-standalone-artifacts', undefined, 'verified');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-standalone-artifacts-'));
  persistStandaloneArtifacts(root, fixture);
  const lease = acquire(root, fixture.terminal);
  expectCode(() => runtime.releaseMutationLease(releaseOptions(root, fixture.terminal, lease, { publication_state: 'verified' })), 'LEASE_RELEASE_UNSAFE');
});

test('RUN164 RED: missing and out-of-order durable predecessors fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-predecessor-'));
  const admitted = runtime.admitRun({ ...common, run_id: 'run-red-predecessor' });
  const workspace = runtime.admitWorkspace({
    state_root: root,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => ({ workspace_id: 'workspace-run-red-predecessor', workspace_handle: 'handle-run-red-predecessor', commit_sha: live.sha, tree_sha: live.tree }),
      verifySnapshot: () => true,
    },
  });
  const running = runtime.transitionRun(workspace.run, 'running', { state_root: root });
  expectCode(() => runtime.transitionRun(workspace.run, 'validating', { state_root: root }), 'INVALID_STATE_TRANSITION');
  const validating = runtime.transitionRun(running, 'validating');
  const packet = runtime.createTerminalPacket({
    run_id: validating.run_id,
    outcome: 'success',
    reason_code: 'RUN164_MISSING_PREDECESSOR',
    evidence_digest: 'a'.repeat(64),
    publication_state: 'verified',
    workspace_disposition: 'cleaned',
  });
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run164-red-missing-'));
  expectCode(() => runtime.completeRun({ state_root: missingRoot, run: validating, terminal_packet: packet }), 'DURABLE_PREDECESSOR_MISMATCH');
});

test('RUN163 GREEN: genuine verified workspace lifecycle and governed completion release safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run163-green-release-'));
  const fixture = governedFixture('run-green-governed-release', root, 'none');
  const lease = acquire(root, fixture.terminal);
  expectCode(() => runtime.acquireMutationLease({
    state_root: root,
    repository_id: fixture.terminal.repository_id,
    authorized_ref_digest: fixture.terminal.authorized_ref_digest,
    run_id: 'run-green-later-before-release',
  }), 'CONFLICTING_RUN');
  assert.deepEqual(runtime.releaseMutationLease(releaseOptions(root, fixture.terminal, lease)), { released: true });
  const later = acquire(root, { ...fixture.terminal, run_id: 'run-green-later-after-release' });
  assert.equal(later.run_id, 'run-green-later-after-release');
});
