'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../scripts/setup-codex-toolkit-plugin.cjs');

test('current cache recovery is a quiet no-op', () => {
  const result = cache.recoverCodexCache({
    source_verified: true,
    cache: { present: true, version: '2.11.0', bytes_verified: true, trusted: true }
  });
  assert.equal(result.state, 'NOOP');
  assert.equal(result.healthy, true);
  assert.equal(result.manual_action, false);
});

test('stale executing cache is not healthy', () => {
  const result = cache.recoverCodexCache({
    source_verified: true,
    cache: { present: true, version: '2.11.0', bytes_verified: true, trusted: true, executing: true }
  });
  assert.equal(result.state, 'TERMINAL');
  assert.equal(result.healthy, false);
  assert.equal(result.manual_action, false);
});

test('manual setup is surfaced only for a supported terminal reason', () => {
  const result = cache.recoverCodexCache({ source_verified: true, refresh_required: true });
  assert.equal(result.reason_code, 'UNSUPPORTED_TOOL');
  assert.equal(result.manual_action, true);
});
