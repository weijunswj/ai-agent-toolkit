'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../scripts/toolkit-route-resolution.cjs');
const adapters = require('../scripts/toolkit-host-route-adapters.cjs');

function record() { return route.resolveRoleRoute({ role: 'g1', host: 'claude-code', launch_id: 'g1-claude' }); }

test('host adapter proves capability for an already resolved record and returns exact receipt', () => {
  const launch = record();
  const capability = {
    available: true,
    trusted: true,
    metadata_verified: true,
    provider: launch.provider,
    model: launch.model,
    reasoning: launch.reasoning,
    service_tier: launch.service_tier,
    speed: launch.speed
  };
  const proven = adapters.proveHostCapability({ launch_record: launch, capability });
  assert.equal(proven.host, 'claude-code');
  const receipt = adapters.executeExactLaunch({
    launch_record: launch,
    capability_proof: proven.proof,
    executor: () => ({ accepted: true, completed: true })
  });
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.started, true);
  assert.equal(receipt.completed, true);
});

test('host capability mismatch and absent executor fail closed', () => {
  const launch = record();
  assert.throws(() => adapters.proveHostCapability({
    launch_record: launch,
    capability: { available: true, trusted: true, metadata_verified: true, model: 'gpt-5.6-sol' }
  }), (error) => error.code === 'HOST_CAPABILITY_CONTRADICTION');
  const capability = { available: true, trusted: true, metadata_verified: true };
  const proven = adapters.proveHostCapability({ launch_record: launch, capability });
  assert.throws(() => adapters.executeExactLaunch({ launch_record: launch, capability_proof: proven.proof }), (error) => error.code === 'HOST_CAPABILITY_UNAVAILABLE');
});
