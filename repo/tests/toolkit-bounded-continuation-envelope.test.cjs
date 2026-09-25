'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');

test('bounded continuation accepts mechanics and returns authority violations to Web', () => {
  const envelope = receipt.createBoundedContinuationEnvelope({
    root: 'S2-PRE-E4-STALE-AUTHORITY-ORCHESTRATION-RESIDUE-001',
    lock: 'DL-S2-PRE-E4-STALE-AUTHORITY-ORCHESTRATION-RESIDUE-001',
    gate: 'G3',
    authority_digest: receipt.digestValue({ authority: 'frozen-g2' }),
    scope_digest: receipt.digestValue({ scope: 'exact-allowlist' })
  });
  assert.equal(receipt.evaluateBoundedContinuation({ envelope, event: { kind: 'validation' } }).allowed, true);
  const returned = receipt.evaluateBoundedContinuation({ envelope, event: { kind: 'new-authority', return_code: 'GATE_REENTRY_REQUIRED' } });
  assert.equal(returned.allowed, false);
  assert.equal(returned.return_to_web, 'GATE_REENTRY_REQUIRED');
});

test('bounded continuation rejects malformed envelopes', () => {
  assert.throws(() => receipt.validateBoundedContinuationEnvelope({}), (error) => error.code === 'GPR_CONTINUATION_ENVELOPE_INVALID');
});
