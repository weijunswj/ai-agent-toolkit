const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lifecycle = require('../scripts/toolkit-managed-terminal-lifecycle.cjs');

test('independent agent-control and checker authority is retired', () => {
  const sourceRoot = path.resolve(__dirname, '..', '..');
  assert.equal(fs.existsSync(path.join(sourceRoot, 'repo', 'scripts', 'toolkit-agent-control.cjs')), false);
  assert.deepEqual(lifecycle.STATES, [
    'TERMINAL_DECISION',
    'DURABLE_DISPOSITION_OR_SUCCESSOR_RECEIPT',
    'CLOSE',
    'CLOSURE_READBACK',
    'DELETE_ELIGIBILITY_CHECK',
    'EXPECTED_REF_SHA_RECHECK',
    'SAFE_MANAGED_BRANCH_DELETE',
    'ABSENCE_READBACK',
    'TERMINAL_RECEIPT'
  ]);
});

test('managed terminal lifecycle recovers an interrupted close without repeating completed work', () => {
  const calls = [];
  const state = {
    contract_version: 'toolkit.github-program-reconciler.managed-terminal-lifecycle.v1',
    state: 'CLOSURE_READBACK',
    terminal_decision: true,
    durable_disposition: true,
    closed: true,
    closure_readback: false,
    delete_eligible: false,
    absence_readback: false,
    terminal_receipt: false,
    branch: 'codex/retained-385',
    reason_code: null
  };
  const options = {
    issue_number: 385,
    branch: 'codex/retained-385',
    state,
    managed_branch: true,
    expected_ref_sha_verified: true,
    readClosure: () => { calls.push('closure-readback'); return true; },
    deleteBranch: () => { calls.push('delete'); return true; },
    readAbsence: () => { calls.push('absence-readback'); return true; }
  };
  const recovered = lifecycle.recoverManagedTerminalLifecycle(options);
  assert.equal(recovered.state, 'TERMINAL_RECEIPT');
  assert.equal(recovered.retained, true);
  assert.equal(recovered.delete_eligible, false);
  assert.deepEqual(calls, ['closure-readback', 'absence-readback']);
  const replay = lifecycle.recoverManagedTerminalLifecycle({ ...options, state: recovered });
  assert.equal(replay.terminal_receipt, true);
  assert.deepEqual(calls, ['closure-readback', 'absence-readback']);
});
