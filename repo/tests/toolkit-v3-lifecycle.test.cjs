'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const lifecycle = require('../scripts/toolkit-v3-lifecycle.cjs');
const finality = require('../scripts/toolkit-assurance-web-finality.cjs');
const oldCandidate = { head_sha: 'a'.repeat(40), tree_sha: 'b'.repeat(40) };
const candidate = { head_sha: 'c'.repeat(40), tree_sha: 'd'.repeat(40) };
const impact = () => ({ accepted_candidate: oldCandidate, candidate, changed_dimensions: [], affected_criteria: [],
  targeted_verification_evidence_ids: ['targeted-check'], earlier_evidence_invalid: false,
  cross_cutting: false, investigation_complete: true });
const renewal = () => ({ event: 'SEGMENT_COMPLETE', checkpoint_verified: true, consumer_recovery_verified: true,
  writer_state: 'STOPPED', conflicting_writer: false, pending_effects: [] });
const reviewer = () => ({ context_available: true, independence_compromised: false, implemented_candidate: false,
  consumed_unreturned_peer_verdict: false, route_changed: false, context_lost: false, candidate_changed: true,
  affected_criteria: ['recovery'] });

test('renewal follows planned boundaries while ordinary commits/tests/status retain the same assignment', () => {
  for (const event of ['G0_TO_G1', 'SEGMENT_COMPLETE', 'INITIAL_G2', 'MODEL_EFFORT_HARNESS_CHANGED',
    'ENVIRONMENT_REPLACED', 'INSTRUCTIONS_ACTIVATED', 'CONTEXT_LOST', 'EXECUTOR_REPLACED']) {
    assert.equal(lifecycle.planRenewal({ ...renewal(), event }).ready, true);
  }
  for (const event of ['COMMIT', 'TEST', 'HELPER_RETURN', 'STATUS', 'REMOTE_CONNECTION', 'INCOMPLETE_SEGMENT_CHECKPOINT']) {
    assert.equal(lifecycle.planRenewal({ ...renewal(), event }).required, false);
  }
});
test('renewal holds competing writers or missing custody and preserves exact pending-effect replay holds', () => {
  assert.equal(lifecycle.planRenewal({ ...renewal(), conflicting_writer: true }).ready, false);
  assert.equal(lifecycle.planRenewal({ ...renewal(), writer_state: 'UNKNOWN' }).ready, false);
  assert.equal(lifecycle.planRenewal({ ...renewal(), consumer_recovery_verified: false }).ready, false);
  const result = lifecycle.planRenewal({ ...renewal(), pending_effects: [
    { effect_id: 'known-success', effect_digest: 'a'.repeat(64), state: 'APPLIED' },
    { effect_id: 'uncertain', effect_digest: 'b'.repeat(64), state: 'UNKNOWN' },
    { effect_id: 'native-denial', effect_digest: 'c'.repeat(64), state: 'DENIED' }
  ] });
  assert.equal(result.ready, true); // independent recovery can continue; these effects cannot replay.
  assert.deepEqual(result.replay_holds, ['uncertain', 'native-denial']);
  assert.equal(result.reset_consumption, false);
});
test('checkpoint-only saves continue with the current writer and failed saves never launch a successor', () => {
  const saved = lifecycle.planRenewal({ ...renewal(), event: 'CHECKPOINT_SAVED', writer_state: 'ACTIVE' });
  assert.equal(saved.required, false); assert.equal(saved.ready, false);
  assert.equal(saved.next_action, 'CONTINUE_SAME_ASSIGNMENT');
  const failed = lifecycle.planRenewal({ ...renewal(), event: 'CHECKPOINT_FAILED', checkpoint_verified: false });
  assert.equal(failed.required, false); assert.equal(failed.ready, false);
  assert.equal(failed.next_action, 'CHECKPOINT_RECOVERY_REQUIRED');
  assert.equal(failed.reset_consumption, false);
});
test('UAT impact follows demonstrated behaviour rather than SHA or file type', () => {
  assert.equal(lifecycle.classifyUatImpact(impact()), 'UAT_RETAINED');
  assert.equal(lifecycle.classifyUatImpact({ ...impact(), targeted_verification_evidence_ids: [] }), 'UAT_IMPACT_UNRESOLVED');
  for (const dimension of ['steps', 'outputs', 'permissions', 'isolation', 'destinations', 'effects',
    'persistence', 'migration', 'deletion', 'recovery', 'modes', 'environment', 'scope', 'criteria']) {
    assert.equal(lifecycle.classifyUatImpact({ ...impact(), changed_dimensions: [dimension], affected_criteria: ['recovery'] }), 'UAT_PARTIAL_REQUIRED');
  }
  assert.equal(lifecycle.classifyUatImpact({ ...impact(), cross_cutting: true }), 'UAT_FULL_REQUIRED');
  assert.equal(lifecycle.classifyUatImpact({ ...impact(), earlier_evidence_invalid: true }), 'UAT_FULL_REQUIRED');
  assert.equal(lifecycle.classifyUatImpact({ ...impact(), investigation_complete: false }), 'UAT_IMPACT_UNRESOLVED');
});
test('correction review uses a fresh context for the same member and never carries PASS automatically to another candidate', () => {
  const result = lifecycle.reviewerContinuation(reviewer());
  assert.equal(result.action, 'FRESH_CONTEXT_SAME_MEMBER');
  assert.equal(result.reuse_retired_session, false);
  assert.equal(result.correction_review_required, true);
  assert.equal(result.previous_pass_applies_automatically, false);
  for (const name of ['independence_compromised', 'implemented_candidate', 'consumed_unreturned_peer_verdict', 'route_changed']) {
    assert.equal(lifecycle.reviewerContinuation({ ...reviewer(), [name]: true }).action, 'REPLACE_AFFECTED_REVIEWER');
  }
  // Lost context no longer forces member replacement: the recheck is fresh regardless.
  assert.equal(lifecycle.reviewerContinuation({ ...reviewer(), context_lost: true }).action, 'FRESH_CONTEXT_SAME_MEMBER');
  assert.equal(lifecycle.reviewerContinuation({ ...reviewer(), context_available: false }).action, 'FRESH_CONTEXT_SAME_MEMBER');
});
test('finality rejects caller-created store/admission objects without reading their claims', () => {
  let calls = 0;
  const result = finality.evaluateV3Finality({ readV3Lifecycle() { calls++; return { core: 'CORE_RELEASE_DONE' }; } }, {});
  assert.equal(result.core, 'INCOMPLETE'); assert.equal(result.accepted, false);
  assert.equal(calls, 0); assert.equal(result.mutation_authority, false);
});
