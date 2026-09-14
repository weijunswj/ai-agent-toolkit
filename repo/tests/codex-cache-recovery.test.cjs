'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../scripts/setup-codex-toolkit-plugin.cjs');

const proofs = () => ({
  source_proof: { trusted: true },
  configuration_proof: { trusted: true },
  installed_state_proof: { trusted: true }
});

test('current cache recovery is a quiet no-op', () => {
  const result = cache.recoverCodexCache({
    ...proofs(),
    cache: { present: true, version: '2.11.1', bytes_verified: true, trusted: true }
  });
  assert.equal(result.state, 'NOOP');
  assert.equal(result.healthy, true);
  assert.equal(result.manual_action, false);
});

test('stale executing cache is not healthy', () => {
  const result = cache.recoverCodexCache({
    ...proofs(),
    cache: { present: true, version: '2.11.1', bytes_verified: true, trusted: true, executing: true }
  });
  assert.equal(result.state, 'TERMINAL');
  assert.equal(result.healthy, false);
  assert.equal(result.manual_action, false);
});

test('manual setup is surfaced only for a supported terminal reason', () => {
  const result = cache.recoverCodexCache({ ...proofs(), refresh_required: true });
  assert.equal(result.reason_code, 'UNSUPPORTED_TOOL');
  assert.equal(result.manual_action, true);
});

test('legacy source_verified alone cannot establish a healthy cache', () => {
  const result = cache.recoverCodexCache({
    source_verified: true,
    cache: { present: true, version: '2.11.1', bytes_verified: true, trusted: true }
  });
  assert.equal(result.reason_code, 'TRUST_FAILURE');
  assert.equal(result.healthy, false);
});

test('refresh health is bound to a freshly rediscovered cache and fingerprint', () => {
  let rediscoveries = 0;
  const fresh = {
    present: true,
    version: '2.11.1',
    bytes_verified: true,
    trusted: true,
    fingerprint: 'a'.repeat(64),
    installed_state_proof: { trusted: true, active: true, fingerprint: 'a'.repeat(64) }
  };
  const result = cache.recoverCodexCache({
    ...proofs(),
    refresh_required: true,
    refreshSupported: () => true,
    rediscover: () => { rediscoveries += 1; return fresh; }
  });
  assert.equal(result.healthy, true);
  assert.equal(result.reason_code, 'CACHE_REFRESHED');
  assert.equal(rediscoveries, 1);
  assert.equal(result.cache_fingerprint, 'a'.repeat(64));
});

test('newer installed cache is protected from downgrade or generic reset', () => {
  const result = cache.recoverCodexCache({
    ...proofs(),
    cache: { present: true, version: '2.12.0', bytes_verified: false, trusted: true },
    repairSupported: () => { throw new Error('must not repair'); }
  });
  assert.equal(result.reason_code, 'DOWNGRADE_PROTECTION');
  assert.equal(result.manual_action, true);
});
