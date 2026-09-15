'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-execution-loop.cjs');
const contractPath = path.join(repoRoot, 'repo', 'contracts', 'bounded-local-execution-loop', 'execution-loop-contract.schema.json');
const a1RuntimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs');
const runtime = require(runtimePath);
const a1 = require(a1RuntimePath);
const route = require('../scripts/toolkit-route-resolution.cjs');

const common = {
  task: { id: 'task-1', digest: 'a'.repeat(64) },
  repository_id: 'b'.repeat(64),
  authorized_ref_digest: 'c'.repeat(64),
  current_authority_digest: 'd'.repeat(64),
  consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
};

function exactAuthority(entries = [['worker-a', 'g1'], ['worker-b', 'g2']], capabilityOverrides = {}) {
  const requestedLanes = entries.map(([launchId]) => launchId);
  const scopeDigest = runtime.digestValue({
    repository_id: common.repository_id,
    authorized_ref_digest: common.authorized_ref_digest,
    task_digest: common.task.digest,
    delegated: true,
    requested_lanes: requestedLanes,
  });
  const treeDigest = route.digestValue({ tree: 'execution-loop-test' });
  const parent = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'execution-parent' });
  return {
    delegated: true,
    parent_launch: parent,
    tree_digest: treeDigest,
    scope_digest: scopeDigest,
    launches: entries.map(([launchId, role]) => {
      const launch = route.resolveDepthOneLaunch({ role, host: 'codex', parent, tree_digest: treeDigest, scope_digest: scopeDigest, launch_id: launchId });
      return {
        ...launch,
        capability: {
          available: true,
          trusted: true,
          metadata_verified: true,
          launch_id: launch.launch_id,
          role: launch.role,
          provider: launch.provider,
          model: launch.model,
          reasoning: launch.reasoning,
          service_tier: launch.service_tier,
          speed: launch.speed,
          host: launch.host,
          backend: launch.backend,
          launch_record_digest: launch.route_digest,
          ...(capabilityOverrides[launchId] || {})
        }
      };
    })
  };
}

function batchAcknowledgement(routePlan, launchLeases) {
  return {
    atomic: true,
    acknowledged: true,
    accepted: true,
    route_digest: routePlan.route_digest,
    launch_record_digests: routePlan.exact_launches.map((item) => item.launch_record.route_digest),
    started_lane_ids: launchLeases.map((item) => item.lane_id),
  };
}

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
    authority: exactAuthority([['worker-a', 'g1'], ['worker-b', 'g2']], { 'worker-b': { available: false } }),
    launch(lane) { launches.push(lane); },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason_code, 'HOST_CAPABILITY_UNAVAILABLE');
  assert.deepEqual(launches, []);
});

test('A3 start revalidates affirmative capability status before preparation', () => {
  const admitted = runtime.admitRun({
    ...common,
    run_id: 'run-capability-status',
    authority: exactAuthority([['worker-a', 'g1']]),
  });
  assert.equal(admitted.status, 'admitted');
  for (const [status, code] of [['unsupported', 'HOST_CAPABILITY_UNAVAILABLE'], ['contradictory', 'HOST_CAPABILITY_CONTRADICTION']]) {
    const plan = JSON.parse(JSON.stringify(admitted.route_plan));
    plan.exact_launches[0].capability_proof.status = status;
    let preparations = 0;
    let commits = 0;
    assert.throws(() => runtime.executeAtomicLaunch(plan, {
      prepareLaunch: () => { preparations += 1; },
      commitLaunchBatch: () => { commits += 1; },
    }), (error) => error.code === code);
    assert.equal(preparations, 0);
    assert.equal(commits, 0);
  }
});

function delegatedLaunchOptions(overrides = {}) {
  return {
    ...common,
    run_id: 'run-launch',
    authority: exactAuthority(),
    ...overrides,
  };
}

function delegatedReady(options) {
  const admitted = runtime.admitRun(options);
  const live = { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const workspace = runtime.admitWorkspace({
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-' + options.run_id, workspace_handle: 'handle-' + options.run_id, commit_sha: live.sha, tree_sha: live.tree }), verifySnapshot: () => true },
  });
  return { admitted, live, workspace };
}

function startDelegated(options) {
  const ready = delegatedReady(options);
  const started = runtime.startDelegatedRun({
    ...options,
    run_id: ready.workspace.run.run_id,
    repository_id: ready.workspace.run.repository_id,
    authorized_ref_digest: ready.workspace.run.authorized_ref_digest,
    current_authority_digest: ready.workspace.run.current_authority_digest,
    route_plan: ready.admitted.route_plan,
    run: ready.workspace.run,
    workspace_receipt: ready.workspace.workspace_receipt,
    liveRefProvider: { read: () => ready.live },
  });
  return { ...ready, started };
}

test('A3 launch preparation failure creates no substantive starts', () => {
  const prepared = [];
  let substantiveStarts = 0;
  const result = startDelegated(delegatedLaunchOptions({
    prepareLaunch(input) {
      const lane = input.lane || input.launch_record;
      prepared.push(lane.lane_id);
      if (lane.lane_id === 'worker-b') throw new Error('lane refused preparation');
      return { lane_id: lane.lane_id, launch_lease: 'lease-' + lane.lane_id, inert: true };
    },
    commitLaunchBatch() {
      substantiveStarts += 1;
      return { atomic: true, started_lane_ids: ['worker-a', 'worker-b'] };
    },
  }));
  assert.equal(result.admitted.status, 'admitted');
  assert.equal(result.workspace.run.execution_state, 'workspace-ready');
  assert.equal(result.started.status, 'blocked');
  assert.equal(result.started.reason_code, 'LAUNCH_PREPARATION_FAILED');
  assert.deepEqual(prepared, ['worker-a', 'worker-b']);
  assert.equal(substantiveStarts, 0);
  assert.deepEqual(result.started.launches, []);
});

test('A3 atomic batch refusal after later-lane validation creates no substantive starts', () => {
  const result = startDelegated(delegatedLaunchOptions({
    prepareLaunch(input) {
      const lane = input.lane || input.launch_record;
      return { lane_id: lane.launch_id || lane.lane_id, launch_lease: 'lease-' + (lane.launch_id || lane.lane_id), inert: true };
    },
    commitLaunchBatch({ launch_leases }) {
      assert.deepEqual(launch_leases.map((item) => item.lane_id), ['worker-a', 'worker-b']);
      throw new Error('worker-b refused at atomic start boundary');
    },
  }));
  assert.equal(result.started.status, 'blocked');
  assert.equal(result.started.reason_code, 'LAUNCH_BATCH_FAILED');
  assert.deepEqual(result.started.launches, []);
});

test('A3 unsupported async launch shape creates no substantive starts', () => {
  const result = startDelegated(delegatedLaunchOptions({
    prepareLaunch(input) {
      const lane = input.lane || input.launch_record;
      return { lane_id: lane.launch_id || lane.lane_id, launch_lease: 'lease-' + (lane.launch_id || lane.lane_id), inert: true };
    },
    commitLaunchBatch() {
      return Promise.resolve({ atomic: true, started_lane_ids: ['worker-a', 'worker-b'] });
    },
  }));
  assert.equal(result.started.status, 'blocked');
  assert.equal(result.started.reason_code, 'ASYNC_LAUNCH_UNSUPPORTED');
  assert.deepEqual(result.started.launches, []);
});

test('A3 complete atomic launch starts exactly the admitted lane set', () => {
  const batches = [];
  const result = startDelegated(delegatedLaunchOptions({
    prepareLaunch(input) {
      const lane = input.lane || input.launch_record;
      return { lane_id: lane.launch_id || lane.lane_id, launch_lease: 'lease-' + (lane.launch_id || lane.lane_id), inert: true };
    },
    commitLaunchBatch({ route_plan, launch_leases }) {
      batches.push({ route_digest: route_plan.route_digest, lanes: launch_leases.map((item) => item.lane_id) });
      return batchAcknowledgement(route_plan, launch_leases);
    },
  }));
  assert.equal(result.admitted.status, 'admitted');
  assert.equal(result.workspace.run.execution_state, 'workspace-ready');
  assert.equal(result.started.status, 'running');
  assert.equal(result.started.run.execution_state, 'running');
  assert.deepEqual(result.started.launches, ['worker-a', 'worker-b']);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].lanes, ['worker-a', 'worker-b']);
  assert.equal(Object.isFrozen(result.started.route_plan), true);
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
  const request = runtime.normalizeRequest({ ...common, authority: exactAuthority([['worker-a', 'g1']]) });
  const widened = runtime.admitRoute({
    ...common,
    request,
    authority: exactAuthority(),
  });
  assert.equal(widened.reason_code, 'TASK_WIDENING_REJECTED');
});

test('delegated route requires exact trusted metadata and complete adapter capability', () => {
  const missing = runtime.admitRoute({ ...common, authority: exactAuthority([['worker-a', 'g1']], { 'worker-a': { available: false } }) });
  assert.equal(missing.reason_code, 'HOST_CAPABILITY_UNAVAILABLE');
  const mismatch = runtime.admitRoute({ ...common, authority: exactAuthority([['worker-a', 'g1']], { 'worker-a': { model: 'gpt-5.6-sol' } }) });
  assert.equal(mismatch.reason_code, 'HOST_CAPABILITY_CONTRADICTION');
  const admitted = runtime.admitRoute({ ...common, authority: exactAuthority([['worker-a', 'g1']]) });
  assert.equal(admitted.status, 'admitted');
  assert.equal(admitted.route_plan.lanes[0].host_classification, 'hard-runtime-enforcement');
  const unsupported = runtime.admitRoute({ ...common, authority: exactAuthority([['worker-a', 'g1']], { 'worker-a': { available: false } }) });
  assert.equal(unsupported.reason_code, 'HOST_CAPABILITY_UNAVAILABLE');
});

test('integrated delegated admission binds an explicitly accepted Priority child authority', () => {
  const treeDigest = route.digestValue({ tree: 'priority-integrated' });
  const scopeDigest = runtime.digestValue({
    repository_id: common.repository_id,
    authorized_ref_digest: common.authorized_ref_digest,
    task_digest: common.task.digest,
    delegated: true,
    requested_lanes: ['priority-child'],
  });
  const parent = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'priority-parent' });
  const priorityAuthority = route.createPriorityChildAuthority({
    authority_digest: common.current_authority_digest,
    child_launch_id: 'priority-child',
    parent,
    tree_digest: treeDigest,
    scope_digest: scopeDigest,
    role: 'loop-manager',
    host: 'codex'
  });
  const child = route.resolveDepthOneLaunch({
    role: 'loop-manager',
    host: 'codex',
    parent,
    launch_id: 'priority-child',
    speed: 'priority',
    tree_digest: treeDigest,
    scope_digest: scopeDigest,
    priority_child_authority: priorityAuthority,
  });
  const capability = {
    available: true,
    trusted: true,
    metadata_verified: true,
    launch_id: child.launch_id,
    role: child.role,
    provider: child.provider,
    model: child.model,
    reasoning: child.reasoning,
    service_tier: child.service_tier,
    speed: child.speed,
    host: child.host,
    backend: child.backend,
    launch_record_digest: child.route_digest,
  };
  const authority = {
    delegated: true,
    parent_launch: parent,
    tree_digest: treeDigest,
    scope_digest: scopeDigest,
    launches: [{ ...child, priority_child_authority: priorityAuthority, capability }],
  };
  const admitted = runtime.admitRoute({ ...common, authority });
  assert.equal(admitted.status, 'admitted');
  assert.equal(admitted.route_plan.exact_launches[0].launch_record.route_digest, child.route_digest);

  const withoutAcceptedAuthority = {
    ...authority,
    launches: [{ ...authority.launches[0], priority_child_authority: { ...priorityAuthority, accepted: false } }],
  };
  const rejected = runtime.admitRoute({ ...common, authority: withoutAcceptedAuthority });
  assert.equal(rejected.reason_code, 'PRIORITY_CHILD_AUTHORITY_REQUIRED');
  const reusedForOtherChild = {
    ...authority,
    launches: [{
      ...authority.launches[0],
      priority_child_authority: { ...priorityAuthority, child_launch_id: 'priority-child-b' }
    }]
  };
  assert.equal(runtime.admitRoute({ ...common, authority: reusedForOtherChild }).reason_code, 'PRIORITY_CHILD_AUTHORITY_REQUIRED');
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
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-2', workspace_handle: 'handle-2' }), verifySnapshot: () => true },
  }), 'LIVE_REF_MOVED');
  expectCode(() => runtime.admitWorkspace({
    run,
    expected_live: { ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) },
    liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40) }) },
    workspaceAdapter: { prepare: () => ({ workspace_id: 'workspace-3', workspace_handle: 'handle-3', commit_sha: 'a'.repeat(40), tree_sha: 'c'.repeat(40) }), verifySnapshot: () => true },
  }), 'WORKSPACE_SNAPSHOT_MISMATCH');
});
