'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lifecycle = require('../scripts/toolkit-managed-terminal-lifecycle.cjs');

test('retained terminal branch completes without deletion', () => {
  const calls = [];
  const result = lifecycle.runManagedTerminalLifecycle({
    issue_number: 385,
    branch: 'codex/retained-385',
    terminal_decision: true,
    durable_disposition: true,
    closed: true,
    closure_readback: true,
    managed_branch: true,
    expected_ref_sha_verified: true,
    recordDurableDisposition: () => calls.push('disposition'),
    close: () => calls.push('close'),
    deleteBranch: () => calls.push('delete'),
    readAbsence: () => { calls.push('absence'); return true; }
  });
  assert.equal(result.retained, true);
  assert.equal(result.delete_eligible, false);
  assert.equal(result.reason_code, 'RETAINED_BRANCH');
  assert.deepEqual(calls, ['absence']);
});

test('managed terminal lifecycle deletes only after exact eligibility and is idempotent', () => {
  let deletions = 0;
  const options = {
    issue_number: 500,
    branch: 'codex/terminal-500',
    terminal_decision: true,
    durable_disposition: true,
    closed: true,
    closure_readback: true,
    managed_branch: true,
    expected_ref_sha_verified: true,
    deleteBranch: () => { deletions += 1; return true; },
    readAbsence: () => true
  };
  const first = lifecycle.runManagedTerminalLifecycle(options);
  const second = lifecycle.recoverManagedTerminalLifecycle({ ...options, state: first });
  assert.equal(first.delete_eligible, true);
  assert.equal(second.terminal_receipt, true);
  assert.equal(deletions, 1);
});
