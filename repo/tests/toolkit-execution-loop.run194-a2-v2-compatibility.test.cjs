'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const a2 = require('../scripts/toolkit-capability-registry.cjs');
const a3 = require('../scripts/toolkit-execution-loop.cjs');

test('A3 consumes the A2 v2 status projection without treating protection as execution consent', () => {
  assert.equal(a2.CAPABILITY_CONTRACT, 'toolkit.repository-capability.v2');
  assert.deepEqual(a2.CAPABILITIES, ['repository.governance', 'execution_loop', 'repository.protection']);
  assert.equal(a3.POLICY.a2_capability, 'execution_loop');
  const status = {
    schema: a2.REGISTRY_SCHEMA,
    status: 'healthy',
    registry_revision: 4,
    snapshot_hash: 'a'.repeat(64),
    capabilities: {
      'repository.governance': { state: 'enabled', receipt_id: 'b'.repeat(64) },
      execution_loop: { state: 'disabled', receipt_id: 'c'.repeat(64) },
      'repository.protection': { state: 'enabled', receipt_id: 'd'.repeat(64) },
    },
  };
  const consent = a3.readExecutionLoopConsent({ consentProvider: () => status });
  assert.equal(consent.state, 'disabled');
  assert.equal(consent.enabled, false);
  assert.match(consent.status_digest, /^[a-f0-9]{64}$/);
});

test('A3 still accepts only the named execution_loop capability when protection is unresolved', () => {
  const consent = a3.readExecutionLoopConsent({ consentProvider: () => ({
    schema: a2.REGISTRY_SCHEMA,
    status: 'healthy',
    registry_revision: 5,
    snapshot_hash: 'e'.repeat(64),
    capabilities: {
      'repository.governance': { state: 'enabled' },
      execution_loop: { state: 'enabled' },
      'repository.protection': { state: 'unresolved' },
    },
  }) });
  assert.equal(consent.state, 'enabled');
  assert.equal(consent.enabled, true);
});
