'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../scripts/toolkit-route-resolution.cjs');
const adapters = require('../scripts/toolkit-host-route-adapters.cjs');

function record() { return route.resolveRoleRoute({ role: 'g1', host: 'claude-code', launch_id: 'g1-claude' }); }

function capabilityFor(launch, overrides = {}) {
  return {
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
    ...overrides,
  };
}

test('host adapter proves capability for an already resolved record and returns exact receipt', () => {
  const launch = record();
  const capability = capabilityFor(launch);
  const proven = adapters.proveHostCapability({ launch_record: launch, capability });
  assert.equal(proven.host, 'claude-code');
  const receipt = adapters.executeExactLaunch({
    launch_record: launch,
    capability_proof: proven.proof,
    executor: ({ launch_record, capability_proof }) => ({
      accepted: true,
      acknowledged: true,
      launch_id: launch_record.launch_id,
      role: launch_record.role,
      provider: launch_record.provider,
      model: launch_record.model,
      reasoning: launch_record.reasoning,
      service_tier: launch_record.service_tier,
      speed: launch_record.speed,
      host: launch_record.host,
      backend: launch_record.backend,
      launch_record_digest: launch_record.route_digest,
      capability_proof_digest: route.digestValue(capability_proof),
      completed: true,
    })
  });
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.started, true);
  assert.equal(receipt.completed, true);
});

test('host capability mismatch and absent executor fail closed', () => {
  const launch = record();
  assert.throws(() => adapters.proveHostCapability({
    launch_record: launch,
    capability: capabilityFor(launch, { model: 'gpt-5.6-sol' })
  }), (error) => error.code === 'HOST_CAPABILITY_CONTRADICTION');
  const capability = capabilityFor(launch);
  const proven = adapters.proveHostCapability({ launch_record: launch, capability });
  assert.throws(() => adapters.executeExactLaunch({ launch_record: launch, capability_proof: proven.proof }), (error) => error.code === 'HOST_CAPABILITY_UNAVAILABLE');
});

test('executor acceptance requires a complete acknowledgement bound to the exact route', () => {
  const launch = record();
  const proven = adapters.proveHostCapability({ launch_record: launch, capability: capabilityFor(launch) });
  const ambiguous = adapters.executeExactLaunch({
    launch_record: launch,
    capability_proof: proven.proof,
    executor: () => ({ accepted: true }),
  });
  assert.equal(ambiguous.status, 'rejected');
  assert.equal(ambiguous.started, false);
  const mismatched = adapters.executeExactLaunch({
    launch_record: launch,
    capability_proof: proven.proof,
    executor: () => ({
      accepted: true,
      acknowledged: true,
      launch_id: 'different-launch',
      role: launch.role,
      provider: launch.provider,
      model: launch.model,
      reasoning: launch.reasoning,
      service_tier: launch.service_tier,
      speed: launch.speed,
      host: launch.host,
      backend: launch.backend,
      launch_record_digest: launch.route_digest,
      capability_proof_digest: route.digestValue(proven.proof),
      completed: true,
    }),
  });
  assert.equal(mismatched.status, 'rejected');
  assert.equal(mismatched.started, false);
});
