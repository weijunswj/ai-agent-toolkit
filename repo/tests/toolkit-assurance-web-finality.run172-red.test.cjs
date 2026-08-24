'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const runtime = require('../scripts/toolkit-assurance-web-finality.cjs');

const {
  CONTRACT_VERSION,
  DESIGN_LOCK_ID,
  evaluateAssurance,
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

const materialFinding = Object.freeze({
  applies_to_current_candidate: true,
  identifies_accepted_requirement: true,
  concrete_current_failure: true,
  evidence_reproducible: true,
  material_impact: true,
  in_scope_current: true,
});

function evidence(overrides = {}) {
  const base = {
    contract_version: CONTRACT_VERSION,
    candidate,
    pr: {
      number: 354,
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
    g4: {
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
    },
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
  };
  const result = { ...base, ...overrides };
  for (const key of ['candidate', 'pr', 'lock', 'scope', 'g4', 'review', 'required_checks']) {
    if (overrides[key]) result[key] = { ...base[key], ...overrides[key] };
  }
  return result;
}

const acceptedCandidate = Object.freeze({
  pr_number: 354,
  head: candidate.head,
  tree: candidate.tree,
  base: candidate.base,
});

function finalityEvidence(overrides = {}) {
  const base = {
    accepted_candidate: acceptedCandidate,
    web_acceptance: {
      status: 'accepted',
      current_required_evidence: true,
      current_review_inventory: true,
      current_required_checks: true,
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
      intended_pr_number: acceptedCandidate.pr_number,
      observed_pr_number: acceptedCandidate.pr_number,
      expected_head: acceptedCandidate.head,
      observed_head: acceptedCandidate.head,
      expected_base: acceptedCandidate.base,
      observed_base: acceptedCandidate.base,
      mode: 'squash',
      result: 'merged',
      merge_result_sha: sha('d'),
      bound_to_pr: true,
      server_authoritative: true,
      verifiable: true,
    },
    canonical: {
      bound_to_intended_merge: true,
      main_head: sha('d'),
      tree: acceptedCandidate.tree,
      expected_tree: acceptedCandidate.tree,
      sole_parent: acceptedCandidate.base,
      expected_parent: acceptedCandidate.base,
      signature: { verified: true, reason: 'valid' },
      pr_merged: true,
      pr_closed: true,
      branch_cleanup_observed: true,
      cleanup_after_verified_merge: true,
      server_authoritative: true,
      verifiable: true,
    },
  };
  const result = { ...base, ...overrides };
  for (const key of ['accepted_candidate', 'web_acceptance', 'ready', 'merge', 'canonical']) {
    if (overrides[key]) result[key] = { ...base[key], ...overrides[key] };
  }
  return result;
}

test('Run-172 RED A: wrong or missing evidence contract version fails closed', () => {
  for (const version of ['toolkit.assurance-web-finality.evidence.v1', undefined]) {
    const input = evidence();
    if (version === undefined) delete input.contract_version;
    else input.contract_version = version;
    const result = evaluateAssurance(input);
    assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE', version || 'missing contract version');
  }
});

test('Run-172 RED A: a shadow top-level finding source cannot hide a canonical blocker', () => {
  const result = evaluateAssurance(evidence({
    review: { findings: [materialFinding] },
    findings: [],
  }));
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('Run-172 RED A: canonical review findings still drive the material blocker decision', () => {
  const result = evaluateAssurance(evidence({ review: { findings: [materialFinding] } }));
  assert.equal(result.code, 'FAIL_MATERIAL_CURRENT_LOCK_BLOCKER');
});

test('missing or conflicting candidate identity fails closed', () => {
  const missing = evidence({ candidate: undefined });
  assert.equal(evaluateAssurance(missing).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');

  const conflicting = evidence({ candidate: { head: sha('z') } });
  assert.equal(evaluateAssurance(conflicting).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('missing or conflicting Lock evidence fails closed', () => {
  const missing = evidence({ lock: undefined });
  assert.equal(evaluateAssurance(missing).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');

  const conflicting = evidence({ lock: { id: 'wrong-lock' } });
  assert.equal(evaluateAssurance(conflicting).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('missing, invalid, or unauthorised scope fails closed', () => {
  const cases = [
    { scope: undefined },
    { scope: { digest: 'invalid' } },
    { scope: { authorised: false } },
  ];
  for (const override of cases) {
    assert.equal(evaluateAssurance(evidence(override)).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
  }
});

test('missing or invalid G4 evidence fails closed', () => {
  const missing = evidence({ g4: undefined });
  assert.equal(evaluateAssurance(missing).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');

  const conflicting = evidence({ g4: { candidate_head: sha('z') } });
  assert.equal(evaluateAssurance(conflicting).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');

  const stale = evidence({ g4: { fresh: false } });
  assert.equal(evaluateAssurance(stale).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('missing or unsuccessful required checks fail closed', () => {
  const missing = evidence({ required_checks: undefined });
  assert.equal(evaluateAssurance(missing).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');

  const unsuccessful = evidence({ required_checks: { items: [{ id: 'required-ci', required: true, status: 'failed', server_authoritative: true, verifiable: true }] } });
  assert.equal(evaluateAssurance(unsuccessful).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('missing or incomplete review inventory fails closed', () => {
  const missing = evidence({ review: undefined });
  assert.equal(evaluateAssurance(missing).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');

  const incomplete = evidence({ review: { complete: false } });
  assert.equal(evaluateAssurance(incomplete).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('an unknown extra property cannot replace missing required evidence', () => {
  const input = evidence({ candidate: undefined, extra_evidence: { head: candidate.head, tree: candidate.tree, base: candidate.base } });
  assert.equal(evaluateAssurance(input).code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
});

test('Run-172 RED C: valid exact accepted candidate tuple remains verifiable', () => {
  const result = evaluateFinality(finalityEvidence());
  assert.equal(result.code, 'FINALITY_VERIFIED');
});

test('Run-172 RED C: unexpected PR binding is rejected', () => {
  const result = evaluateFinality(finalityEvidence({
    merge: { intended_pr_number: 355, observed_pr_number: 355 },
  }));
  assert.equal(result.code, 'UNEXPECTED_PR_REJECTED');
});

test('Run-172 RED C: missing expected or observed head fails closed', () => {
  const input = finalityEvidence();
  delete input.merge.expected_head;
  delete input.merge.observed_head;
  const result = evaluateFinality(input);
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: missing expected or observed base fails closed', () => {
  const input = finalityEvidence();
  delete input.merge.expected_base;
  delete input.merge.observed_base;
  const result = evaluateFinality(input);
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: missing intended or observed PR number fails closed', () => {
  const input = finalityEvidence();
  delete input.merge.intended_pr_number;
  delete input.merge.observed_pr_number;
  const result = evaluateFinality(input);
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: arbitrary self-equal tree and parent values are not accepted', () => {
  const result = evaluateFinality(finalityEvidence({
    canonical: {
      tree: 'not-a-sha',
      expected_tree: 'not-a-sha',
      sole_parent: 'not-a-parent-sha',
      expected_parent: 'not-a-parent-sha',
    },
  }));
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: canonical tree must bind to the accepted candidate tree', () => {
  const result = evaluateFinality(finalityEvidence({
    canonical: { tree: sha('d'), expected_tree: sha('d') },
  }));
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: canonical parent must bind to the accepted base', () => {
  const result = evaluateFinality(finalityEvidence({
    canonical: { sole_parent: sha('d'), expected_parent: sha('d') },
  }));
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: canonical main must bind to the merge-result SHA', () => {
  const result = evaluateFinality(finalityEvidence({ canonical: { main_head: sha('h') } }));
  assert.equal(result.finality_blocked, true);
});

test('Run-172 RED C: unbound canonical result fails closed without rerunning G4', () => {
  const result = evaluateFinality(finalityEvidence({ canonical: { bound_to_intended_merge: false } }));
  assert.equal(result.code, 'FAIL_CLOSED_CANONICAL_BINDING');
  assert.equal(result.g4_rerun, false);
});

test('Run-172 RED D: a PASS handoff cannot infer no blocker from missing truth', () => {
  const result = createReport({
    verdict: 'PASS_AND_STOP',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: [],
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
  });
  assert.equal(result.code, 'REPORT_CONTRACT_INVALID');
});

test('Run-172 RED D: explicit blocker and explicit verified no-blocker reports remain representable', () => {
  const blocker = createReport({
    verdict: 'FAIL_MATERIAL_CURRENT_LOCK_BLOCKER',
    material_blocker: true,
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A4'],
    next_action: 'WEB_ROUTE_SAME_LOCK_REPAIR',
  });
  assert.equal(blocker.accepted, true);

  const clear = createReport({
    verdict: 'PASS_AND_STOP',
    material_blocker: false,
    verified_result: 'required-evidence-and-g4-pass',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A4'],
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
  });
  assert.equal(clear.accepted, true);
});

test('Run-172 RED D: contradictory blocker and verified-result truth is rejected', () => {
  const result = createReport({
    verdict: 'FAIL_MATERIAL_CURRENT_LOCK_BLOCKER',
    material_blocker: true,
    verified_result: 'verified-no-blocker',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A4'],
    next_action: 'WEB_ROUTE_SAME_LOCK_REPAIR',
  });
  assert.equal(result.code, 'REPORT_CONTRACT_INVALID');
});
