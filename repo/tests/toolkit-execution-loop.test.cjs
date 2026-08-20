'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-execution-loop.cjs');
const contractPath = path.join(repoRoot, '_projects', 'development', 'bounded-local-execution-loop', '_main', 'execution-loop-contract.schema.json');
const a1RuntimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs');
const runtime = require(runtimePath);
const a1 = require(a1RuntimePath);

const common = {
  task: { id: 'task-1', digest: 'a'.repeat(64) },
  repository_id: 'b'.repeat(64),
  authorized_ref_digest: 'c'.repeat(64),
  current_authority_digest: 'd'.repeat(64),
  consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
};

function commitOperation(overrides = {}) {
  const paths = overrides.authorized_paths || ['src/file.txt'];
  const message = overrides.commit_message || 'bounded commit';
  return {
    type: 'git.commit',
    expected_head: 'a'.repeat(40),
    expected_tree: 'b'.repeat(40),
    authorized_paths: paths,
    authorized_paths_digest: overrides.authorized_paths_digest || runtime.digestValue([...paths].sort()),
    expected_index_digest: 'c'.repeat(64),
    intended_tree: 'd'.repeat(40),
    intended_change_digest: 'e'.repeat(64),
    commit_message: message,
    commit_message_digest: overrides.commit_message_digest || runtime.digestValue(message),
    amend: false,
    allow_empty: false,
    author_mutation: false,
    committer_mutation: false,
    config_mutation: false,
    options: [],
    ...overrides,
  };
}

test('A3 bounded-loop runtime and closed contract set are present', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'A3 runtime is missing');
  assert.equal(fs.existsSync(contractPath), true, 'A3 contract source is missing');
  const runtime = require(runtimePath);
  assert.deepEqual(runtime.CONTRACTS, [
    'toolkit.execution-loop.request.v1',
    'toolkit.execution-loop.route-plan.v1',
    'toolkit.execution-loop.run-receipt.v1',
    'toolkit.execution-loop.workspace-receipt.v1',
    'toolkit.execution-loop.terminal-packet.v1',
  ]);
});

test('A1 exposes typed git.commit as the bounded stage-and-commit operation', () => {
  assert.equal(typeof a1.operationDigest, 'function');
  assert.match(a1.operationDigest(commitOperation()), /^[a-f0-9]{64}$/);
});

test('A3 route admission is all-or-none before any lane launch', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'A3 runtime is missing');
  const launches = [];
  const result = runtime.admitRun({
    ...common,
    authority: { delegated: true, lanes: ['worker-a', 'worker-b'] },
    adapters: {
      'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
      'worker-b': { available: false, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
    },
    launch(lane) { launches.push(lane); },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason_code, 'WORKER_ROUTE_UNAVAILABLE');
  assert.deepEqual(launches, []);
});

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test('A2 consent is fail-closed and cannot launch a root or worker run', () => {
  for (const [state, reason] of [['disabled', 'CONSENT_DISABLED'], ['unresolved', 'CONSENT_UNRESOLVED']]) {
    const launches = [];
    const result = runtime.admitRun({ ...common, authority: { delegated: false, lanes: [] }, consentProvider: () => ({ status: state, capabilities: { execution_loop: { state } } }), launch: () => launches.push(true) });
    assert.equal(result.reason_code, reason);
    assert.deepEqual(launches, []);
  }
  const malformed = runtime.admitRun({ ...common, authority: { delegated: false, lanes: [] }, consentProvider: () => ({ schema_version: 99, capabilities: { execution_loop: { state: 'enabled' } } }) });
  assert.equal(malformed.reason_code, 'CONSENT_MALFORMED');
  const interrupted = runtime.admitRun({ ...common, authority: { delegated: false, lanes: [] }, consentProvider: () => ({ interrupted: true }) });
  assert.equal(interrupted.reason_code, 'CONSENT_INTERRUPTED');
  const untrusted = runtime.admitRun({ ...common, executionLoopState: 'enabled', authority: { delegated: false, lanes: [] } });
  assert.equal(untrusted.reason_code, 'CONSENT_UNRESOLVED');
});

test('root-only admission uses zero worker launches and does not widen the task', () => {
  const launches = [];
  const result = runtime.admitRun({ ...common, authority: { delegated: false, lanes: [] }, launch: (lane) => launches.push(lane) });
  assert.equal(result.status, 'admitted');
  assert.equal(result.route_plan.root_only, true);
  assert.deepEqual(result.route_plan.lanes, []);
  assert.deepEqual(launches, []);
  assert.equal(Object.isFrozen(result.route_plan), true);
  const request = runtime.normalizeRequest({ ...common, authority: { delegated: true, lanes: ['worker-a'] } });
  const widened = runtime.admitRoute({
    ...common,
    request,
    authority: { delegated: true, lanes: ['worker-a', 'worker-b'] },
    adapters: {
      'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
      'worker-b': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
    },
  });
  assert.equal(widened.reason_code, 'TASK_WIDENING_REJECTED');
});

test('delegated route requires exact trusted metadata and complete adapter capability', () => {
  const baseAuthority = { delegated: true, lanes: [{ id: 'worker-a', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' }] };
  const missing = runtime.admitRoute({ ...common, authority: baseAuthority, adapters: { 'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high' } } });
  assert.equal(missing.reason_code, 'MODEL_METADATA_UNVERIFIED');
  const mismatch = runtime.admitRoute({ ...common, authority: baseAuthority, adapters: { 'worker-a': { available: true, provider: 'OpenAI', model: 'other-model', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' } } });
  assert.equal(mismatch.reason_code, 'WORKER_MODEL_MISMATCH');
  const guidance = runtime.admitRoute({ ...common, authority: baseAuthority, adapters: { 'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only', adapter_handle: 'handle-a' } } });
  assert.equal(guidance.status, 'admitted');
  assert.equal(guidance.route_plan.lanes[0].host_classification, 'guidance-only');
  const unsupported = runtime.admitRoute({ ...common, authority: baseAuthority, adapters: { 'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'unsupported' } } });
  assert.equal(unsupported.reason_code, 'WORKER_ROUTE_UNAVAILABLE');
});

test('lifecycle admits exact live snapshot and rejects missing terminal evidence', () => {
  const admitted = runtime.admitRun({ ...common, run_id: 'run-lifecycle', authority: { delegated: false, lanes: [] } });
  const admittedRun = admitted.run;
  const sha = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const workspace = runtime.admitWorkspace({
    run: admittedRun,
    expected_live: { ref: 'refs/heads/main', sha, tree },
    liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha, tree }) },
    workspaceAdapter: {
      prepare: () => ({ workspace_id: 'workspace-1', workspace_handle: 'handle-1', commit_sha: sha, tree_sha: tree, setup_operations: ['fetch', 'checkout-detached', 'verify-snapshot'] }),
      verifySnapshot: () => true,
    },
  });
  assert.equal(workspace.status, 'workspace-ready');
  const running = runtime.transitionRun(workspace.run, 'running');
  const validating = runtime.transitionRun(running, 'validating');
  expectCode(() => runtime.completeRun({ run: validating }), 'TERMINAL_PACKET_REQUIRED');
  const packet = runtime.createTerminalPacket({ run_id: validating.run_id, outcome: 'blocked', reason_code: 'PUBLICATION_UNCERTAIN', evidence_digest: 'e'.repeat(64), publication_state: 'uncertain', workspace_disposition: 'preserved' });
  const terminal = runtime.completeRun({ run: validating, terminal_packet: packet });
  assert.equal(terminal.execution_state, 'terminal-blocked');
  expectCode(() => runtime.transitionRun(terminal, 'running'), 'INVALID_STATE_TRANSITION');
});

test('live ref movement and wrong workspace snapshot fail closed', () => {
  const admitted = runtime.admitRun({ ...common, run_id: 'run-live', authority: { delegated: false, lanes: [] } });
  const run = admitted.run;
  expectCode(() => runtime.admitWorkspace({
    run,
    expected_live: { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) },
    liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha: 'c'.repeat(40), tree: 'b'.repeat(40) }) },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-2', workspace_handle: 'handle-2' }) },
  }), 'LIVE_REF_MOVED');
  expectCode(() => runtime.admitWorkspace({
    run,
    expected_live: { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) },
    liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) }) },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-3', workspace_handle: 'handle-3', commit_sha: 'a'.repeat(40), tree_sha: 'c'.repeat(40) }) },
  }), 'WORKSPACE_SNAPSHOT_MISMATCH');
});
