'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const contractRoot = path.join(repoRoot, 'repo', 'contracts', 'independent-assurance-web-finality');
const runtime = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-assurance-web-finality.cjs'));

const sha = (letter) => letter.repeat(40);

test('A4 contract is direct and has no generated or published surface', () => {
  assert.equal(fs.existsSync(contractRoot), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills', 'independent-assurance-web-finality')), false);
});

test('A4 source contract freezes the accepted Lock and authority boundaries', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(contractRoot, 'assurance-web-finality-contract.schema.json'), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.join(contractRoot, 'assurance-web-finality-policy.json'), 'utf8'));
  assert.equal(schema.$id, runtime.CONTRACT_VERSION);
  assert.equal(policy.design_lock_id, runtime.DESIGN_LOCK_ID);
  assert.equal(policy.schema_version, 2);
  assert.deepEqual(schema.$defs.evidence.required, ['contract_version', 'candidate', 'pr', 'lock', 'scope', 'g4', 'review', 'required_checks']);
  assert.equal(schema.$defs.evidence.additionalProperties, false);
  assert.equal(schema.$defs.report.additionalProperties, false);
  assert.equal(schema.$defs.evidence.properties.findings, undefined);
  assert.equal(schema.$defs.report.properties.unchanged_scope.minItems, 1);
  assert.equal(schema.$defs.report.allOf.length, 2);
  assert.deepEqual(policy.web_finality.acceptance_requires, ['current_required_evidence', 'current_review_inventory', 'actual_required_checks']);
  assert.deepEqual(policy.web_finality.accepted_candidate_tuple, ['pr_number', 'head', 'tree', 'base']);
  assert.equal(policy.authority_boundaries.a1, 'sole mutation and opaque authority-ticket authority');
  assert.equal(policy.authority_boundaries.a2, 'consent and state only');
  assert.equal(policy.authority_boundaries.a3, 'execution, workspace, run, and terminal evidence only');
  assert.equal(policy.authority_boundaries.web, 'sole acceptance and finality authority');
  assert.equal(policy.authority_boundaries.new_authority_token, false);
  assert.equal(policy.authority_boundaries.a3_contract_count_added, 0);
});

test('A4 source shape does not absorb the A3 five-contract set or live execution mechanics', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(contractRoot, 'assurance-web-finality-policy.json'), 'utf8'));
  assert.equal(policy.exclusions.includes('host_adapter_mechanics'), true);
  assert.equal(policy.exclusions.includes('provider_or_live_work'), true);
  assert.equal(policy.exclusions.includes('workflow_edits'), true);
  assert.equal(policy.authority_boundaries.a3_contract_count_added, 0);
  assert.equal(runtime.G4_AUTHORITY, 'read-only-assurance');
  assert.equal(runtime.G4A_MODEL, 'GPT-5.6 Sol Max');
});

test('privacy-safe report contains the required human companion and one action', () => {
  const result = runtime.createReport({
    verdict: 'PASS_AND_STOP',
    material_blocker: false,
    verified_result: 'required-evidence-and-g4-pass',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A1', 'A2', 'A3'],
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
    model_class: 'GPT-5.6 Sol High',
    counts: { findings: 0 },
    relative_scope_ids: ['a4'],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.human.verdict, 'PASS_AND_STOP');
  assert.equal(result.human.mutation_attempted, false);
  assert.equal(result.human.mutation_performed, false);
  assert.deepEqual(result.human.unchanged_scope, ['A1', 'A2', 'A3']);
  assert.equal(result.human.next_action, 'WEB_PROCEED_TO_FINALITY_REVALIDATION');
  assert.equal(result.next_action, 'WEB_PROCEED_TO_FINALITY_REVALIDATION');
});

test('successful finality proof accepts expected squash result without rerunning G4', () => {
  const result = runtime.evaluateFinality({
    accepted_candidate: {
      pr_number: 353,
      head: sha('a'),
      tree: sha('b'),
      base: sha('c'),
    },
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
      intended_pr_number: 353,
      observed_pr_number: 353,
      result: 'merged',
      merge_result_sha: sha('d'),
      mode: 'squash',
      expected_head: sha('a'),
      observed_head: sha('a'),
      expected_base: sha('c'),
      observed_base: sha('c'),
      bound_to_pr: true,
      server_authoritative: true,
      verifiable: true,
    },
    canonical: {
      bound_to_intended_merge: true,
      main_head: sha('d'),
      tree: sha('b'),
      expected_tree: sha('b'),
      sole_parent: sha('c'),
      expected_parent: sha('c'),
      signature: { verified: true, reason: 'valid' },
      pr_merged: true,
      pr_closed: true,
      branch_cleanup_observed: true,
      cleanup_after_verified_merge: true,
      server_authoritative: true,
      verifiable: true,
    },
  });
  assert.equal(result.code, 'FINALITY_VERIFIED');
  assert.equal(result.g4_rerun, false);
  assert.equal(result.branch_cleanup_verified, true);
});

test('missing no-byte review proof fails closed instead of trusting unchanged H', () => {
  const result = runtime.evaluateNoByteReviewDisposition({
    unchanged: { head: true, tree: true, base: true, lock: true, scope: true },
    disposition: 'non-material',
    no_current_violation: true,
    no_candidate_change: true,
    complete_inventory: false,
    all_other_evidence_current: true,
  });
  assert.equal(result.code, 'FAIL_CLOSED_REQUIRED_EVIDENCE');
  assert.equal(result.fresh_g4_required, true);
});

test('unresolved bounded G4A question routes exactly to the controller', () => {
  const result = runtime.evaluateG4A({
    ordinary_complete: true,
    exact_head_g4_passed: true,
    required_evidence_current: true,
    question: 'Which bounded same-Lock route applies?',
    purpose: 'routing',
    deterministic_evidence_settles: false,
    web_recorded_question: true,
    settled: false,
  });
  assert.equal(result.code, 'CONTROLLER_REQUIRED');
  assert.equal(result.next_action, 'CONTROLLER_REQUIRED');
  assert.equal(result.allowed, false);
});
