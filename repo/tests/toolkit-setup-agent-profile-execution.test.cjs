'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');
const route = require('../scripts/toolkit-route-resolution.cjs');
const adapters = require('../scripts/toolkit-host-route-adapters.cjs');

function current({ supported = true, topology = 'exact-launch-record' } = {}) {
  return {
    agentProfile: { topology, supported, capacity_mode: 'not-managed', manual_maximum: 0 },
    agentCapability: { supported, launch_supported: supported },
    nativePlugin: { status: 'fresh' },
    delegation: { status: 'unsupported' },
  };
}

test('setup resolves direct and host-native choices to the route contract without capacity policy', async () => {
  const directArgs = core.parseArgs([
    '--plan', '--host', 'claude-code', '--claude-topology', 'toolkit-direct',
    '--claude-agent-capacity', 'manual', '--claude-agent-maximum', '2'
  ]);
  const direct = core.resolveClaudeTopologyCapacity(directArgs, current());
  assert.equal(direct.topology, 'exact-launch-record');
  assert.equal(direct.capacity_mode, 'not-managed');
  assert.equal(direct.manual_maximum, 0);
  assert.equal(direct.route_contract, route.CONTRACT_VERSION);
  const applied = await core.applyHostDelegationControl(directArgs, current(), { status: 'fresh' });
  assert.equal(applied.status, 'route-registry-active');
  assert.equal(applied.scheduler_policy, false);
  assert.equal(applied.resource_admission, false);
  assert.equal(applied.reservation_queue_policy, false);
  assert.equal(applied.mandatory_pre_pr_checker, false);

  const nativeArgs = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'broader-native']);
  assert.equal(core.resolveClaudeTopologyCapacity(nativeArgs, current()).topology, 'host-native');
});

test('missing Claude capability fails closed to root-only without a worker or checker route', async () => {
  const args = core.parseArgs(['--execute', '--host', 'claude-code', '--claude-topology', 'toolkit-direct']);
  const result = await core.applyHostDelegationControl(args, current({ supported: false }), { status: 'unverified' });
  assert.equal(result.status, 'capability-lost-root-only');
  assert.equal(result.fallback, 'root-only');
  assert.equal(result.resource_admission, false);
  assert.equal(result.reservation_queue_policy, false);
  assert.equal(result.mandatory_pre_pr_checker, false);
});

test('pre-approval Claude inspection is observational and defers exact launch proof', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-claude-profile-'));
  const sentinel = path.join(root, 'session-started');
  const cli = path.join(root, 'claude.cjs');
  fs.writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'started');\n`, 'utf8');
  try {
    const capability = core.inspectClaudeAgentCapability({ claudeCli: cli });
    assert.equal(capability.executable_available, true);
    assert.equal(capability.launch_supported, false);
    assert.equal(capability.launch_probe_status, 'deferred');
    assert.equal(capability.capability_proof, false);
    assert.equal(fs.existsSync(sentinel), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('active setup source no longer imports the retired agent-control authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-toolkit-core.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\/toolkit-agent-control\.cjs['"]\)/);
  assert.match(source, /toolkit-route-resolution\.cjs/);
  assert.match(source, /capability-only/);
});

test('depth-one launch resolution keeps omitted child speed Standard under a Priority root', () => {
  const root = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'profile-root' });
  const child = route.resolveDepthOneLaunch({ role: 'loop-manager', host: 'codex', parent: root, launch_id: 'profile-child' });
  assert.equal(root.speed, 'priority');
  assert.equal(child.speed, 'standard');
  assert.equal(child.speed_source, 'child-default');
  assert.equal(child.parent_speed, 'priority');
  assert.equal(child.child_priority_authorized, false);
  assert.throws(
    () => route.resolveDepthOneLaunch({ role: 'loop-manager', host: 'codex', parent: root, speed: 'priority' }),
    (error) => error.code === 'PRIORITY_CHILD_AUTHORITY_REQUIRED'
  );
});

test('host adapter execution consumes only an exact resolved record and capability proof', () => {
  const launch = route.resolveRoleRoute({ role: 'g1', host: 'claude-code', launch_id: 'profile-g1' });
  const capability = adapters.proveHostCapability({
    launch_record: launch,
    capability: { available: true, trusted: true, metadata_verified: true }
  });
  const receipt = adapters.executeExactLaunch({
    launch_record: launch,
    capability_proof: capability.proof,
    executor: ({ launch_record, capability_proof }) => ({
      accepted: launch_record.route_digest === capability_proof.launch_record_digest,
      completed: true,
    })
  });
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.started, true);
  assert.equal(receipt.completed, true);
});
