'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const lifecycle = require('../scripts/toolkit-managed-terminal-lifecycle.cjs');

const lifecycleSchema = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'contracts',
  'github-program-reconciler',
  'managed-terminal-lifecycle-v1.schema.json'
), 'utf8'));
const validateLifecycleState = new Ajv2020({ allErrors: true, strict: false }).compile(lifecycleSchema);

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

test('interrupted managed delete intent rechecks ref state and proves absence without repeating deletion', () => {
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
  const resumed = lifecycle.recoverManagedTerminalLifecycle({
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
      deletion_intent_persisted: true,
      deletion_observed_absent: false,
      branch: 'codex/terminal-502',
      deletion_eligibility_evidence: eligibility,
      deletion_acknowledgement: null,
      absence_readback: false,
      terminal_receipt: false
    },
    recheckExpectedRefSha: () => ({ trusted: true, present: false, ...eligibility }),
    deleteBranch: () => { deletions += 1; return { acknowledged: true, ...eligibility }; },
    persistState: () => true,
    readAbsence: () => ({ trusted: true, present: false, ...eligibility })
  });
  assert.equal(resumed.terminal_receipt, true);
  assert.equal(resumed.deletion_intent_persisted, true);
  assert.equal(resumed.deletion_observed_absent, true);
  assert.equal(resumed.absence_readback, true);
  assert.equal(validateLifecycleState(resumed), true, JSON.stringify(validateLifecycleState.errors));
  assert.equal(deletions, 0);
});

test('managed terminal schema rejects unsafe or incomplete observed-absence evidence', () => {
  const sha = '9'.repeat(40);
  const eligibility = {
    trusted: true, repository: 'weijunswj/ai-agent-toolkit', ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-unsafe', sha, terminal_state: 'terminal-blocked',
    retained: false, unpublished_loss: false, default_branch: false, protected: false, checked_out: false
  };
  const incomplete = {
    contract_version: 'toolkit.github-program-reconciler.managed-terminal-lifecycle.v1',
    state: 'TERMINAL_RECEIPT', terminal_decision: true, durable_disposition: true,
    closed: true, closure_readback: true, delete_eligible: true,
    deletion_intent_persisted: true, deletion_observed_absent: true,
    deletion_acknowledgement: null, absence_readback: false, terminal_receipt: true,
    branch: 'codex/terminal-unsafe', reason_code: null,
    deletion_eligibility_evidence: eligibility,
    absence_readback_evidence: { ...eligibility, trusted: true, present: false }
  };
  assert.equal(validateLifecycleState(incomplete), false);
  assert.ok(validateLifecycleState.errors.some((error) => error.instancePath === '/absence_readback'));
});

test('fresh pre-delete evidence revalidates every safety flag', () => {
  const eligibility = {
    trusted: true, repository: 'weijunswj/ai-agent-toolkit', ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-503', sha: 'd'.repeat(40), terminal_state: 'terminal-success',
    retained: false, unpublished_loss: false, default_branch: false, protected: false, checked_out: false
  };
  let deletions = 0;
  assert.throws(() => lifecycle.runManagedTerminalLifecycle({
    issue_number: 503, branch: 'codex/terminal-503', terminal_decision: true, durable_disposition: true,
    closed: true, closure_readback: true, managed_branch: true, eligibility_evidence: eligibility,
    recheckExpectedRefSha: () => ({ ...eligibility, protected: true }),
    deleteBranch: () => { deletions += 1; }, persistState: () => true
  }), (error) => error.code === 'DELETE_ELIGIBILITY_UNVERIFIED');
  assert.equal(deletions, 0);
});

test('durable checkpoint capability is proven before irreversible deletion', () => {
  const eligibility = {
    trusted: true, repository: 'weijunswj/ai-agent-toolkit', ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-504', sha: 'e'.repeat(40), terminal_state: 'terminal-success',
    retained: false, unpublished_loss: false, default_branch: false, protected: false, checked_out: false
  };
  let deletions = 0;
  assert.throws(() => lifecycle.runManagedTerminalLifecycle({
    issue_number: 504, branch: 'codex/terminal-504', terminal_decision: true, durable_disposition: true,
    closed: true, closure_readback: true, managed_branch: true, eligibility_evidence: eligibility,
    recheckExpectedRefSha: () => ({ ...eligibility }), deleteBranch: () => { deletions += 1; }
  }), (error) => error.code === 'DURABLE_CHECKPOINT_REQUIRED');
  assert.equal(deletions, 0);
});

test('already-absent managed branch persists eligibility before receipt and replays without delete', () => {
  const eligibility = {
    trusted: true, repository: 'weijunswj/ai-agent-toolkit', ownership: 'toolkit-managed',
    ref: 'refs/heads/codex/terminal-505', sha: 'f'.repeat(40), terminal_state: 'terminal-success',
    retained: false, unpublished_loss: false, default_branch: false, protected: false, checked_out: false
  };
  let deletions = 0;
  const checkpoints = [];
  const options = {
    issue_number: 505, branch: 'codex/terminal-505', terminal_decision: true, durable_disposition: true,
    closed: true, closure_readback: true, managed_branch: true, eligibility_evidence: eligibility,
    recheckExpectedRefSha: () => ({ ...eligibility, present: false }),
    deleteBranch: () => { deletions += 1; return null; },
    readAbsence: () => ({ ...eligibility, trusted: true, present: false }),
    persistState: (state) => { checkpoints.push(state); return true; }
  };
  const first = lifecycle.runManagedTerminalLifecycle(options);
  assert.deepEqual(first.deletion_eligibility_evidence, { ...eligibility, present: false });
  assert.equal(first.deletion_observed_absent, true);
  assert.equal(first.deletion_intent_persisted, false);
  assert.equal(validateLifecycleState(first), true, JSON.stringify(validateLifecycleState.errors));
  assert.equal(deletions, 0);
  assert.ok(checkpoints.some((state) => state.deletion_eligibility_evidence && state.deletion_observed_absent === false));
  const replay = lifecycle.recoverManagedTerminalLifecycle({ ...options, state: first });
  assert.deepEqual(replay, first);
  assert.equal(deletions, 0);
});
