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
  const sha = 'a'.repeat(40);
  const eligibility = {
    trusted: true,
    repository: 'weijunswj/ai-agent-toolkit',
    ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-500',
    sha,
    terminal_state: 'terminal-success',
    retained: false,
    unpublished_loss: false,
    default_branch: false,
    protected: false,
    checked_out: false
  };
  const options = {
    issue_number: 500,
    branch: 'codex/terminal-500',
    terminal_decision: true,
    durable_disposition: true,
    closed: true,
    closure_readback: true,
    managed_branch: true,
    eligibility_evidence: eligibility,
    recheckExpectedRefSha: (request) => ({ ...request.eligibility_evidence }),
    deleteBranch: () => { deletions += 1; return { acknowledged: true, ...eligibility }; },
    readAbsence: () => ({ trusted: true, present: false, ...eligibility }),
    persistState: () => true
  };
  const first = lifecycle.runManagedTerminalLifecycle(options);
  const second = lifecycle.recoverManagedTerminalLifecycle({ ...options, state: first });
  assert.equal(first.delete_eligible, true);
  assert.equal(second.terminal_receipt, true);
  assert.equal(deletions, 1);
});

test('managed deletion resumes from the persisted acknowledgement and performs only absence readback', () => {
  const sha = 'b'.repeat(40);
  const eligibility = {
    trusted: true,
    repository: 'weijunswj/ai-agent-toolkit',
    ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-501',
    sha,
    terminal_state: 'terminal-failure',
    retained: false,
    unpublished_loss: false,
    default_branch: false,
    protected: false,
    checked_out: false
  };
  let checkpoint;
  let deletions = 0;
  assert.throws(() => lifecycle.runManagedTerminalLifecycle({
    issue_number: 501,
    branch: 'codex/terminal-501',
    terminal_decision: true,
    durable_disposition: true,
    closed: true,
    closure_readback: true,
    managed_branch: true,
    eligibility_evidence: eligibility,
    recheckExpectedRefSha: (request) => ({ ...request.eligibility_evidence }),
    deleteBranch: () => { deletions += 1; return { acknowledged: true, ...eligibility }; },
    persistState: (state) => { checkpoint = state; return true; },
    readAbsence: () => { throw new Error('interrupted after deletion'); }
  }), (error) => error.code === 'READABSENCE_FAILED');
  assert.ok(checkpoint);
  assert.equal(checkpoint.deletion_acknowledgement.acknowledged, true);
  let rechecks = 0;
  const resumed = lifecycle.recoverManagedTerminalLifecycle({
    issue_number: 501,
    branch: 'codex/terminal-501',
    state: checkpoint,
    managed_branch: true,
    recheckExpectedRefSha: () => { rechecks += 1; return null; },
    deleteBranch: () => { deletions += 1; return { acknowledged: true, ...eligibility }; },
    persistState: () => true,
    readAbsence: () => ({ trusted: true, present: false, ...eligibility })
  });
  assert.equal(resumed.terminal_receipt, true);
  assert.equal(rechecks, 0);
  assert.equal(deletions, 1);
});

test('terminal receipt cannot bypass missing managed deletion evidence', () => {
  assert.throws(() => lifecycle.recoverManagedTerminalLifecycle({
    issue_number: 500,
    managed_branch: true,
    state: {
      contract_version: 'toolkit.github-program-reconciler.managed-terminal-lifecycle.v1',
      state: 'TERMINAL_RECEIPT',
      terminal_receipt: true,
      delete_eligible: true,
      branch: 'codex/terminal-500'
    }
  }), (error) => error.code === 'DELETE_ELIGIBILITY_UNVERIFIED');
});

test('interrupted managed delete state without acknowledgement cannot repeat deletion', () => {
  let deletions = 0;
  const sha = 'c'.repeat(40);
  const eligibility = {
    trusted: true,
    repository: 'weijunswj/ai-agent-toolkit',
    ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-502',
    sha,
    terminal_state: 'terminal-blocked',
    retained: false,
    unpublished_loss: false,
    default_branch: false,
    protected: false,
    checked_out: false
  };
  assert.throws(() => lifecycle.recoverManagedTerminalLifecycle({
    issue_number: 502,
    branch: 'codex/terminal-502',
    managed_branch: true,
    state: {
      contract_version: 'toolkit.github-program-reconciler.managed-terminal-lifecycle.v1',
      state: 'SAFE_MANAGED_BRANCH_DELETE',
      terminal_decision: true,
      durable_disposition: true,
      closed: true,
      closure_readback: true,
      delete_eligible: true,
      branch: 'codex/terminal-502',
      deletion_eligibility_evidence: eligibility,
      deletion_acknowledgement: null,
      absence_readback: false,
      terminal_receipt: false
    },
    recheckExpectedRefSha: () => { throw new Error('must not recheck'); },
    deleteBranch: () => { deletions += 1; return { acknowledged: true, ...eligibility }; },
    persistState: () => true,
    readAbsence: () => ({ trusted: true, present: false, ...eligibility })
  }), (error) => error.code === 'DELETION_ACKNOWLEDGEMENT_REQUIRED');
  assert.equal(deletions, 0);
});
