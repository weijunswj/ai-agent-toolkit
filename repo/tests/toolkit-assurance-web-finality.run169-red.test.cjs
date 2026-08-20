'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const runtime = require('../scripts/toolkit-assurance-web-finality.cjs');

const {
  DESIGN_LOCK_ID,
  CONTRACT_VERSION,
  admitG4,
  evaluateAssurance,
  evaluateInvalidation,
  evaluateNoByteReviewDisposition,
  evaluateG4A,
  evaluateLedgerEvidence,
  evaluateFinality,
  createReport,
} = runtime;

const sha = (letter) => letter.repeat(40);
const digest = (letter) => letter.repeat(64);

const candidate = Object.freeze({
  head: sha('a'),
  tree: sha('b'),
  base: sha('c'),
  current: true,
});

function g4Evidence(overrides = {}) {
  return {
    status: 'PASS',
    provider: 'OpenAI',
    model_class: 'GPT-5.6 Sol High',
    reasoning: 'high',
    mode: 'standard',
    fresh: true,
    isolated: true,
    read_only: true,
    complete_candidate: true,
    candidate_head: candidate.head,
    candidate_tree: candidate.tree,
    candidate_base: candidate.base,
    lock_id: DESIGN_LOCK_ID,
    scope_digest: digest('d'),
    root_only: true,
    mutation_authority: false,
    ready_authority: false,
    merge_authority: false,
    cleanup_authority: false,
    finality_authority: false,
    current: true,
    complete: true,
    server_authoritative: true,
    verifiable: true,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const base = {
    candidate,
    pr: {
      number: 353,
      head: candidate.head,
      tree: candidate.tree,
      base: candidate.base,
      base_ref: 'main',
      open: true,
      server_authoritative: true,
      verifiable: true,
    },
    lock: {
      id: DESIGN_LOCK_ID,
      current: true,
      server_authoritative: true,
      verifiable: true,
    },
    scope: {
      digest: digest('d'),
      current: true,
      authorised: true,
      server_authoritative: true,
      verifiable: true,
    },
    g4: g4Evidence(),
    review: {
      current: true,
      complete: true,
      server_authoritative: true,
      verifiable: true,
      inventory_digest: digest('e'),
      findings: [],
    },
    required_checks: {
      current: true,
      complete: true,
      server_authoritative: true,
      verifiable: true,
      inventory_digest: digest('f'),
      items: [{ id: 'required-ci', required: true, status: 'success', server_authoritative: true, verifiable: true }],
    },
    ledger: {
      current: true,
      complete: true,
      server_authoritative: true,
      verifiable: true,
      duplicate_checked: true,
      state: 'QUEUED',
      intake_count: 1,
      identity: 'run-169',
    },
    findings: [],
  };
  const result = { ...base, ...overrides };
  for (const key of ['candidate', 'pr', 'lock', 'scope', 'g4', 'review', 'required_checks', 'ledger']) {
    if (overrides[key]) result[key] = { ...base[key], ...overrides[key] };
  }
  return result;
}

function expectRequiredEvidenceFailure(input) {
  const result = evaluateAssurance(input);
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
  assert.equal(result.next_actions, undefined);
  return result;
}

function finalityEvidence(overrides = {}) {
  return {
    web_acceptance: {
      status: 'accepted',
      current_required_evidence: true,
      current_review_inventory: true,
      current_required_checks: true,
      current_ledger: true,
      server_authoritative: true,
      verifiable: true,
    },
    ready: {
      set: true,
      after_web_acceptance: true,
      final_merge_state_transition: true,
      same_candidate: true,
      fresh_readback: true,
      review_triggered: false,
    },
    merge: {
      result: 'merged',
      mode: 'squash',
      expected_head: candidate.head,
      observed_head: candidate.head,
      expected_base: candidate.base,
      bound_to_pr: true,
      server_authoritative: true,
      verifiable: true,
    },
    canonical: {
      bound_to_intended_merge: true,
      main_head: sha('g'),
      tree: candidate.tree,
      expected_tree: candidate.tree,
      sole_parent: candidate.base,
      expected_parent: candidate.base,
      signature: { verified: true, reason: 'valid' },
      pr_merged: true,
      pr_closed: true,
      branch_cleanup_observed: true,
      cleanup_after_verified_merge: true,
      server_authoritative: true,
      verifiable: true,
    },
    ...overrides,
  };
}

test('A4 RED-first required-evidence truth table fails closed', () => {
  const cases = [
    ['missing candidate', { candidate: undefined }],
    ['stale lock', { lock: { current: false } }],
    ['incomplete review inventory', { review: { complete: false } }],
    ['conflicting required check', { required_checks: { items: [{ id: 'required-ci', required: true, status: 'success' }, { id: 'required-ci', required: true, status: 'failed' }] } }],
    ['ambiguous Ledger identity', { ledger: { identity: '' } }],
  ];
  for (const [label, override] of cases) {
    assert.equal(expectRequiredEvidenceFailure(evidence(override)).label, label, label);
  }
});

test('all six material-blocker predicates are necessary', () => {
  const names = [
    'applies_to_current_candidate',
    'identifies_accepted_requirement',
    'concrete_current_failure',
    'evidence_reproducible',
    'material_impact',
    'in_scope_current',
  ];
  const finding = Object.fromEntries(names.map((name) => [name, true]));
  for (const missing of names) {
    const result = evaluateAssurance(evidence({ findings: [{ ...finding, [missing]: false }] }));
    assert.notEqual(result.code, 'FAIL_MATERIAL_CURRENT_LOCK_BLOCKER', missing);
  }
});

test('required evidence pass plus no material blocker is PASS AND STOP', () => {
  const result = evaluateAssurance(evidence());
  assert.equal(result.code, 'PASS_AND_STOP');
  assert.equal(result.stop, true);
  assert.equal(result.g4_status, 'PASS');
});

test('G4 admission enforces the exact independent complete-candidate contract', () => {
  const result = admitG4(evidence());
  assert.equal(result.admitted, true);
  assert.equal(result.contract_version, CONTRACT_VERSION);
  assert.equal(result.authority, 'read-only-assurance');
});

test('stale candidate H invalidates G4', () => {
  const result = evaluateInvalidation({
    event: 'CANDIDATE_MOVEMENT',
    previous: { head: candidate.head, tree: candidate.tree, base: candidate.base },
    current: { head: sha('h'), tree: candidate.tree, base: candidate.base },
  });
  assert.equal(result.code, 'G4_INVALIDATED_CANDIDATE_MOVEMENT');
  assert.equal(result.fresh_g4_required, true);
});

test('candidate tree movement invalidates G4', () => {
  const result = evaluateInvalidation({
    event: 'CANDIDATE_MOVEMENT',
    previous: { head: candidate.head, tree: candidate.tree, base: candidate.base },
    current: { head: candidate.head, tree: sha('i'), base: candidate.base },
  });
  assert.equal(result.code, 'G4_INVALIDATED_CANDIDATE_MOVEMENT');
  assert.equal(result.fresh_g4_required, true);
});

test('assessment-neutral base movement preserves G4 eligibility with Web reread', () => {
  const result = evaluateInvalidation({ event: 'BASE_MOVEMENT', impact: 'neutral' });
  assert.equal(result.code, 'BASE_REVALIDATION_NEUTRAL');
  assert.equal(result.g4_invalidated, false);
  assert.equal(result.fresh_web_readback, true);
  assert.equal(result.fresh_g4_required, false);
});

test('material base movement invalidates G4', () => {
  const result = evaluateInvalidation({ event: 'BASE_MOVEMENT', impact: 'material' });
  assert.equal(result.code, 'G4_INVALIDATED_BASE_MOVEMENT');
  assert.equal(result.fresh_g4_required, true);
});

test('unknown base impact fails closed and requires fresh G4', () => {
  const result = evaluateInvalidation({ event: 'BASE_MOVEMENT', impact: 'unknown' });
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
  assert.equal(result.fresh_g4_required, true);
});

test('accepted Lock movement invalidates G4', () => {
  const result = evaluateInvalidation({ event: 'LOCK_MOVEMENT' });
  assert.equal(result.code, 'G4_INVALIDATED_LOCK_MOVEMENT');
  assert.equal(result.fresh_authority_admission_required, true);
});

test('authorised scope movement invalidates G4', () => {
  const result = evaluateInvalidation({ event: 'SCOPE_MOVEMENT' });
  assert.equal(result.code, 'G4_INVALIDATED_SCOPE_MOVEMENT');
  assert.equal(result.fresh_scope_admission_required, true);
});

test('speculative finding cannot block', () => {
  const result = evaluateAssurance(evidence({
    findings: [{ applies_to_current_candidate: true, identifies_accepted_requirement: true, concrete_current_failure: false, evidence_reproducible: false, material_impact: false, in_scope_current: true, speculative: true }],
  }));
  assert.equal(result.code, 'PASS_AND_STOP');
  assert.equal(result.non_blocking_findings, 1);
});

test('optional finding cannot block', () => {
  const result = evaluateAssurance(evidence({
    findings: [{ applies_to_current_candidate: true, identifies_accepted_requirement: true, concrete_current_failure: true, evidence_reproducible: true, material_impact: true, in_scope_current: true, optional: true }],
  }));
  assert.equal(result.code, 'PASS_AND_STOP');
});

test('duplicate-root finding does not create assurance noise', () => {
  const result = evaluateAssurance(evidence({
    findings: [{ applies_to_current_candidate: true, identifies_accepted_requirement: true, concrete_current_failure: true, evidence_reproducible: true, material_impact: true, in_scope_current: true, duplicate_root: true }],
  }));
  assert.equal(result.code, 'PASS_AND_STOP');
  assert.equal(result.non_blocking_findings, 1);
});

test('concrete current material finding blocks with bounded same-Lock repair', () => {
  const result = evaluateAssurance(evidence({
    findings: [{ applies_to_current_candidate: true, identifies_accepted_requirement: true, concrete_current_failure: true, evidence_reproducible: true, material_impact: true, in_scope_current: true }],
  }));
  assert.equal(result.code, 'FAIL_MATERIAL_CURRENT_LOCK_BLOCKER');
  assert.equal(result.next_action, 'WEB_ROUTE_SAME_LOCK_REPAIR');
  assert.equal(result.repair.same_lock, true);
  assert.equal(result.repair.smallest_sufficient, true);
});

test('benign pending to successful required check does not rerun G4', () => {
  const result = evaluateInvalidation({ event: 'REQUIRED_CHECK_COMPLETED_SUCCESS', identity_unchanged: true });
  assert.equal(result.code, 'REQUIRED_CHECK_REFRESH_ONLY');
  assert.equal(result.g4_invalidated, false);
  assert.equal(result.fresh_g4_required, false);
});

test('failed or missing required check blocks finality without manufacturing G4 invalidation', () => {
  const result = evaluateInvalidation({ event: 'REQUIRED_CHECK_FAILURE', status: 'missing' });
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
  assert.equal(result.g4_invalidated, false);
  assert.equal(result.finality_blocked, true);
});

test('benign review metadata movement does not rerun G4', () => {
  const result = evaluateInvalidation({ event: 'BENIGN_REVIEW_METADATA_MOVEMENT' });
  assert.equal(result.code, 'REVIEW_REFRESH_ONLY');
  assert.equal(result.g4_invalidated, false);
  assert.equal(result.fresh_g4_required, false);
});

test('new material review finding stops finality', () => {
  const result = evaluateInvalidation({ event: 'NEW_MATERIAL_REVIEW_FINDING', candidate_repair: false });
  assert.equal(result.code, 'FINALITY_STOP_MATERIAL_REVIEW_FINDING');
  assert.equal(result.finality_blocked, true);
});

test('no-byte review disposition preserves G4 only with every locked proof', () => {
  const result = evaluateNoByteReviewDisposition({
    unchanged: { head: true, tree: true, base: true, lock: true, scope: true },
    disposition: 'non-material',
    no_current_violation: true,
    no_candidate_change: true,
    complete_inventory: true,
    all_other_evidence_current: true,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.g4_invalidated, false);
});

test('successor H invalidates prior H-bound G4', () => {
  const result = evaluateInvalidation({ event: 'SUCCESSOR_CANDIDATE_HEAD' });
  assert.equal(result.code, 'G4_INVALIDATED_CANDIDATE_MOVEMENT');
  assert.equal(result.successor_invalidates_prior_g4, true);
});

test('fresh G4 is required after successor exact-head admission', () => {
  const next = { ...evidence(), candidate: { ...candidate, head: sha('j') } };
  next.g4 = g4Evidence({ candidate_head: sha('j') });
  next.pr = { ...next.pr, head: sha('j') };
  const result = admitG4(next);
  assert.equal(result.admitted, true);
  assert.equal(result.fresh, true);
});

test('G4A is rejected when requested only for confidence', () => {
  const result = evaluateG4A({ ordinary_complete: true, exact_head_g4_passed: true, required_evidence_current: true, question: 'bounded', purpose: 'confidence', web_recorded_question: true });
  assert.equal(result.code, 'G4A_NOT_PERMITTED');
});

test('G4A is rejected for routine second opinion', () => {
  const result = evaluateG4A({ ordinary_complete: true, exact_head_g4_passed: true, required_evidence_current: true, question: 'bounded', purpose: 'second_opinion', web_recorded_question: true });
  assert.equal(result.code, 'G4A_NOT_PERMITTED');
});

test('G4A is rejected when required evidence is missing', () => {
  const result = evaluateG4A({ ordinary_complete: true, exact_head_g4_passed: true, required_evidence_current: false, question: 'bounded', purpose: 'routing', web_recorded_question: true });
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('exact duplicate or QUEUED Ledger #142 evidence is accepted', () => {
  const queued = evaluateLedgerEvidence({
    run_id: 'run-169',
    intake: { version: 'v2', public_safe: true, duplicate_checked: true, state: 'QUEUED', identity: 'run-169' },
  });
  const duplicate = evaluateLedgerEvidence({
    run_id: 'run-169',
    exact_existing_duplicate: { version: 'v2', public_safe: true, duplicate_checked: true, state: 'QUEUED', identity: 'run-169' },
  });
  assert.equal(queued.accepted, true);
  assert.equal(duplicate.accepted, true);
});

test('conflicting Ledger identity fails closed and never polls #143', () => {
  const result = evaluateLedgerEvidence({
    run_id: 'run-169',
    intake: { version: 'v2', public_safe: true, duplicate_checked: true, state: 'QUEUED', identity: 'other-run' },
    polls: ['#143'],
  });
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('Ready cannot precede final Web acceptance', () => {
  const result = evaluateFinality(finalityEvidence({
    web_acceptance: { status: 'pending' },
    ready: { set: true, after_web_acceptance: false },
  }));
  assert.equal(result.code, 'READY_BEFORE_WEB_ACCEPTANCE');
});

test('unexpected merge head is rejected', () => {
  const result = evaluateFinality(finalityEvidence({
    merge: { result: 'rejected', expected_head: candidate.head, observed_head: sha('k') },
  }));
  assert.equal(result.code, 'UNEXPECTED_HEAD_REJECTED');
});

test('uncertain merge result routes to canonical readback and not retry', () => {
  const result = evaluateFinality(finalityEvidence({ merge: { result: 'uncertain' } }));
  assert.equal(result.code, 'CANONICAL_READBACK_REQUIRED');
  assert.equal(result.blind_retry, false);
  assert.equal(result.g4_rerun, false);
});

test('canonical tree mismatch fails finality', () => {
  const result = evaluateFinality(finalityEvidence({ canonical: { tree: sha('l') } }));
  assert.equal(result.code, 'CANONICAL_TREE_MISMATCH');
});

test('sole-parent mismatch fails finality', () => {
  const result = evaluateFinality(finalityEvidence({ canonical: { sole_parent: sha('m') } }));
  assert.equal(result.code, 'CANONICAL_PARENT_MISMATCH');
});

test('invalid or unverified signature fails finality', () => {
  const result = evaluateFinality(finalityEvidence({ canonical: { signature: { verified: false, reason: 'unknown' } } }));
  assert.equal(result.code, 'CANONICAL_SIGNATURE_INVALID');
});

test('branch cleanup before verified merge is rejected', () => {
  const result = evaluateFinality(finalityEvidence({
    merge: { result: 'uncertain' },
    canonical: { branch_cleanup_observed: true, cleanup_after_verified_merge: false },
  }));
  assert.equal(result.code, 'BRANCH_CLEANUP_BEFORE_VERIFIED_MERGE');
});

test('privacy leakage is rejected from the report contract', () => {
  const result = createReport({
    verdict: 'PASS_AND_STOP',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A1', 'A2', 'A3'],
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
    raw_prompt: 'private prompt',
  });
  assert.equal(result.code, 'PRIVACY_LEAK_REJECTED');
});

test('more than one supported next action is rejected', () => {
  const result = createReport({
    verdict: 'PASS_AND_STOP',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A1', 'A2', 'A3'],
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
    next_actions: ['WEB_PROCEED_TO_FINALITY_REVALIDATION', 'CONTROLLER_REQUIRED'],
  });
  assert.equal(result.code, 'MULTIPLE_NEXT_ACTIONS_REJECTED');
});
