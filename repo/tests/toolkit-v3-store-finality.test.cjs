'use strict';
// Synthetic owner/reviewer/effect records exercise production custody and finality.
// They never represent owner UAT, real native review, installation or release.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const finality = require('../scripts/toolkit-assurance-web-finality.cjs');
const support = require('./toolkit-v3-store-test-support.cjs');
const lifecycle = require('../scripts/toolkit-v3-lifecycle.cjs');
const candidate = support.CANDIDATE, environment = receipt.digestValue('synthetic isolated environment');
const additionalVerificationRequirements = ['synthetic-owner-visible-outputs'];
const compiled = support.buildSyntheticV3DecisionFixture(undefined, { additionalVerificationRequirements }).compiled;
const criteria = [...compiled.decision.verification.requirements];
function blob(id, value) { const bytes = Buffer.from(JSON.stringify(value)); return { reference: support.evidenceReference(id, bytes), bytes }; }
function resultsFor(candidateValue) {
  return Object.fromEntries(['builder', 'custody', 'publication', 'integration', 'installation', 'programme'].map(kind => [kind, {
    schema: 'toolkit.v3.result.v1', kind, decision_digest: compiled.decision_digest,
    candidate: structuredClone(candidateValue), environment_digest: environment, state: 'PASS'
  }]));
}
function ownerEvidence(id, candidateValue, coverage, commentId) {
  const bytes = Buffer.from(JSON.stringify({ schema: 'toolkit.v3.owner-uat.v1', disposition: 'ACCEPTED',
    candidate: structuredClone(candidateValue), environment_digest: environment, criteria: [...coverage] }));
  return { reference: { id, kind: 'OWNER_UAT', source: {
    repository: 'example/toolkit', issue_number: 421, comment_id: commentId, node_id: `IC_synthetic_${id}`,
    author_login: 'owner-example', updated_at: '2026-10-12T12:00:00.000Z',
    body_digest: crypto.createHash('sha256').update(bytes).digest('hex') } }, bytes };
}
function changedCandidate() { return { ...candidate, head_sha: '9'.repeat(40), tree_sha: '8'.repeat(40) }; }
function changedUatEvidence(candidateValue, options = {}) {
  const mode = options.mode;
  if (!['retained', 'partial', 'full'].includes(mode)) throw new Error('synthetic UAT scenario mode is required');
  const prior = ownerEvidence('synthetic-owner-uat', options.priorCandidate || candidate,
    options.priorCriteria || criteria, 99123);
  const changedDimensions = mode === 'retained' ? [] : mode === 'partial' ? ['recovery'] : ['outputs', 'recovery'];
  const affectedCriteria = mode === 'partial' ? [criteria[0]] : [];
  const impactValue = {
    accepted_candidate: structuredClone(options.priorCandidate || candidate),
    candidate: structuredClone(options.impactCandidate || candidateValue),
    changed_dimensions: changedDimensions, affected_criteria: affectedCriteria,
    targeted_verification_evidence_ids: options.targetedEvidenceIds || ['synthetic-builder'],
    earlier_evidence_invalid: false, cross_cutting: mode === 'full', investigation_complete: true
  };
  const impact = blob(`synthetic-uat-impact-${mode}`, impactValue);
  const status = lifecycle.classifyUatImpact(impactValue);
  const controller = blob(`synthetic-uat-controller-${mode}`, {
    schema: 'toolkit.v3.uat-applicability.v1', decision_digest: compiled.decision_digest,
    impact_evidence_id: impact.reference.id, status: options.controllerStatus || status,
    candidate: structuredClone(candidateValue)
  });
  const currentOwner = mode === 'partial' && options.includeCurrentOwner !== false
    ? ownerEvidence('synthetic-owner-uat-partial', candidateValue, [criteria[0]], 99124)
    : mode === 'full' && options.includeCurrentOwner === true
      ? ownerEvidence('synthetic-owner-uat-full', candidateValue, criteria, 99125) : null;
  const evidence = [prior, ...(currentOwner ? [currentOwner] : []), impact, controller];
  return {
    evidence, ownerEvidenceIds: evidence.filter(item => item.reference.kind === 'OWNER_UAT').map(item => item.reference.id),
    impactEvidenceId: impact.reference.id, controllerEvidenceId: controller.reference.id,
    controllerEvidenceIds: options.controllerEvidenceVisible === false ? [] : [controller.reference.id]
  };
}
function fixture(options = {}) {
  let peers = [], admittedPeerIds = [], observations;
  const candidateValue = options.candidate || candidate;
  const results = resultsFor(candidateValue);
  const uat = options.uat ? changedUatEvidence(candidateValue, options.uat) : null;
  const originalOwner = ownerEvidence('synthetic-owner-uat', candidate, criteria, 99123);
  const extra = [...Object.entries(results).map(([kind, value]) => blob('synthetic-'+kind, value)),
    ...(uat ? uat.evidence : [originalOwner])];
  const stateFactory = ctx => { admittedPeerIds = ctx.extraPacketIds || []; return ({ schema: 'toolkit.v3.lifecycle.v1', decision_digest: ctx.compiled.decision_digest,
    scope_digest: ctx.scopeDigest, candidate: ctx.candidate, environment_digest: environment,
    builder_session_id: 'synthetic-builder-session', criteria, builder_evidence_ids: ['synthetic-builder'],
    owner_evidence_ids: uat ? uat.ownerEvidenceIds : ['synthetic-owner-uat'],
    impact_evidence_id: uat?.impactEvidenceId || null, controller_uat_evidence_id: uat?.controllerEvidenceId || null,
    review_packet_ids: ctx.extraPacketIds || [],
    custody_evidence_id: 'synthetic-custody', publication: { state: options.publication || 'CURRENT',
      pending_effects: options.publication ? [{ effect_id: 'synthetic-pending-write', effect_digest: 'f'.repeat(64), state: 'UNKNOWN' }] : [],
      evidence_id: options.publication ? null : 'synthetic-publication' },
    integration_evidence_id: options.integration === false ? null : 'synthetic-integration',
    installation_evidence_id: 'synthetic-installation', programme_outcomes: [{ id: 'synthetic-core-outcome', state: 'COMPLETE', evidence_id: 'synthetic-programme' }] }); };
  const current = support.createV3StoreFixture({ controllerConsumer: true, candidate: candidateValue,
    additionalVerificationRequirements, extraEvidence: extra, lifecycleState: stateFactory,
    extraPackets(primary, ctx) {
      peers = ['REVIEW_SCOPE', 'REVIEW_EXECUTION'].map((role, index) => {
        const packet = structuredClone(primary), checkpoint = packet.body.recovery_checkpoint_v3;
        packet.bindings.producer = { run: 'synthetic-review-'+index, lock: 'synthetic-review-lock-'+index, stage: 'G2', role };
        const review = { schema: 'toolkit.v3.review.v1', decision_digest: ctx.compiled.decision_digest, candidate: ctx.candidate,
          environment_digest: environment, role, route: ctx.compiled.selection.routes[role], session_id: 'synthetic-review-session-'+index,
          builder_session_id: 'synthetic-builder-session', origin: options.correction ? 'CORRECTION' : 'FRESH',
          previous_review_digest: options.correction ? receipt.digestValue('synthetic-previous-review-'+index) : null,
          coverage: criteria, findings: [], validation_evidence_ids: ['synthetic-builder'] };
        packet.body.verdict = 'PASS';
        packet.body.sections = ['candidate_identity', 'coverage', 'findings_and_reproducers', 'validation_results', 'disposition']
          .map(name => ({ name, text: name === 'disposition' ? receipt.canonicalSerialize(review) : 'Synthetic '+name }));
        const unsigned = Object.fromEntries(Object.entries(checkpoint).filter(([name]) => !['checkpoint_id', 'checkpoint_digest'].includes(name)));
        // Peer IDs do not recursively contain the lifecycle record that references them.
        const lifecycleId = checkpoint.results.find(row => row.result_id === 'v3-lifecycle-state').evidence_ids[0];
        packet.body.evidence_refs = packet.body.evidence_refs.filter(ref => ref.id !== lifecycleId);
        unsigned.evidence_ids = unsigned.evidence_ids.filter(id => id !== lifecycleId);
        unsigned.custody_refs = unsigned.custody_refs.filter(ref => ref.evidence_id !== lifecycleId);
        unsigned.results = unsigned.results.filter(row => row.result_id !== 'v3-lifecycle-state');
        unsigned.route = { profile_id: ctx.compiled.selection.profile_id, requested_profile_id: ctx.compiled.selection.requested_profile_id,
          stage: 'G2', role, ...ctx.compiled.selection.routes[role] };
        packet.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
        return packet;
      });
      return peers;
    }, readerOverrides: { readV3LifecycleObservation(request, base) {
      const resultObservations = Object.fromEntries(Object.entries(results).map(([kind, value]) => ['synthetic-'+kind, value]));
      const evidenceDigests = Object.fromEntries(extra.map(item => [item.reference.id, receipt.digestValue(item.reference)]));
      const sessions = peers.map((packet, index) => {
        const review = JSON.parse(packet.body.sections.at(-1).text);
        return { packet_id: admittedPeerIds[index], review_digest: lifecycle.digest(review),
          session_id: review.session_id, builder_session_id: review.builder_session_id, route: review.route,
          previous_review_digest: review.previous_review_digest, independent_from_builder: true,
          peer_verdict_consumed: false, implemented_candidate: false, context_available: true };
      });
      observations = { ...base, evidence_digests: { ...base.evidence_digests, ...evidenceDigests },
        result_observations: resultObservations, required_outcome_ids: ['synthetic-core-outcome'],
        controller_evidence_ids: uat?.controllerEvidenceIds || [], review_sessions: sessions };
      return options.observe ? options.observe(structuredClone(observations)) : observations;
    } } });
  return current;
}
test('synthetic paired G2/owner UAT finality consumes real persisted packets and independent captured observations', () => {
  const f = fixture(), state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.g2, 'PAIRED_REVIEW_ACCEPTED');
  assert.equal(state.uat, 'ACCEPTED'); assert.equal(state.core, 'CORE_RELEASE_DONE');
  assert.equal(state.parent, 'PARENT_DONE'); assert.equal(state.mutation_authority, false);
});
test('publication outage preserves synthetic UAT and G2 while release and parent remain incomplete', () => {
  const f = fixture({ publication: 'PENDING' }), state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.uat, 'UAT_ACCEPTED_PUBLICATION_PENDING');
  assert.equal(state.g2, 'PAIRED_REVIEW_ACCEPTED'); assert.equal(state.core, 'INCOMPLETE');
  assert.equal(state.parent, 'INCOMPLETE'); assert.equal(state.pending_updates[0].state, 'UNKNOWN');
});
test('publication alone cannot complete synthetic Core before integration readback', () => {
  const f = fixture({ integration: false }), state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.publication, 'CURRENT'); assert.equal(state.core, 'INCOMPLETE');
});
test('synthetic correction reviewers retain sessions but require a newly bound current-cycle result', () => {
  const f = fixture({ correction: true }), state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.g2, 'PAIRED_REVIEW_ACCEPTED');
});
test('unreturned peer verdict consumption rejects synthetic paired-review finality', () => {
  const f = fixture({ observe(value) { value.review_sessions[0].peer_verdict_consumed = true; return value; } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, 'V3_REVIEW_UNVERIFIED'); assert.equal(state.core, 'INCOMPLETE');
});

test('changed candidate retains prior synthetic owner UAT when admitted impact and targeted proof show no behavior change', () => {
  const next = changedCandidate();
  const f = fixture({ candidate: next, uat: { mode: 'retained' } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.uat_applicability, 'UAT_RETAINED');
  assert.equal(state.uat, 'ACCEPTED'); assert.equal(state.core, 'CORE_RELEASE_DONE');
  assert.deepEqual(JSON.parse(f.evidence.get('synthetic-owner-uat').bytes.toString('utf8')).candidate, candidate,
    'the original owner acceptance remains bound to its demonstrated candidate');
});

test('changed candidate partial UAT preserves prior acceptance and accepts independently evidenced affected-criterion coverage', () => {
  const next = changedCandidate();
  const f = fixture({ candidate: next, uat: { mode: 'partial' } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.uat_applicability, 'UAT_PARTIAL_REQUIRED');
  assert.equal(state.uat, 'ACCEPTED'); assert.equal(state.core, 'CORE_RELEASE_DONE');
  assert.deepEqual(JSON.parse(f.evidence.get('synthetic-owner-uat').bytes.toString('utf8')).candidate, candidate);
  assert.deepEqual(JSON.parse(f.evidence.get('synthetic-owner-uat-partial').bytes.toString('utf8')).criteria, [criteria[0]]);
});

test('changed candidate full UAT remains pending until fresh full candidate coverage is admitted', () => {
  const f = fixture({ candidate: changedCandidate(), uat: { mode: 'full' } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.uat_applicability, 'UAT_FULL_REQUIRED');
  assert.equal(state.uat, 'PENDING'); assert.equal(state.core, 'INCOMPLETE');
});

test('changed candidate full UAT accepts fresh owner evidence covering every lifecycle criterion', () => {
  const next = changedCandidate();
  const f = fixture({ candidate: next, uat: { mode: 'full', includeCurrentOwner: true } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.uat, 'ACCEPTED');
  assert.equal(state.core, 'CORE_RELEASE_DONE');
  assert.deepEqual(JSON.parse(f.evidence.get('synthetic-owner-uat-full').bytes.toString('utf8')).candidate, next);
  assert.deepEqual(JSON.parse(f.evidence.get('synthetic-owner-uat-full').bytes.toString('utf8')).criteria, criteria);
  assert.deepEqual(JSON.parse(f.evidence.get('synthetic-owner-uat').bytes.toString('utf8')).candidate, candidate,
    'full current-candidate proof supplements the prior approval without rewriting it');
});

test('partial UAT stays pending when the prior candidate approval is the only owner evidence', () => {
  const f = fixture({ candidate: changedCandidate(), uat: { mode: 'partial', includeCurrentOwner: false } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, undefined); assert.equal(state.uat_applicability, 'UAT_PARTIAL_REQUIRED');
  assert.equal(state.uat, 'PENDING'); assert.equal(state.core, 'INCOMPLETE');
});

test('changed-candidate UAT rejects a controller status that differs from the admitted impact', () => {
  const f = fixture({ candidate: changedCandidate(), uat: { mode: 'partial', controllerStatus: 'UAT_RETAINED' } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, 'V3_CONTROLLER_UAT_UNVERIFIED'); assert.equal(state.core, 'INCOMPLETE');
});

test('changed-candidate UAT rejects missing independent controller readback and mistyped targeted proof', () => {
  const missing = fixture({ candidate: changedCandidate(), uat: { mode: 'retained', controllerEvidenceVisible: false } });
  const missingState = finality.evaluateV3Finality(missing.store, missing.admission);
  assert.equal(missingState.code, 'V3_CONTROLLER_UAT_UNVERIFIED');

  const wrongProof = fixture({ candidate: changedCandidate(), uat: { mode: 'partial', targetedEvidenceIds: ['synthetic-publication'] } });
  const proofState = finality.evaluateV3Finality(wrongProof.store, wrongProof.admission);
  assert.equal(proofState.code, 'V3_RESULT_BINDING_MISMATCH'); assert.equal(proofState.core, 'INCOMPLETE');
});

test('changed-candidate UAT rejects impact evidence that names another candidate', () => {
  const f = fixture({ candidate: changedCandidate(), uat: { mode: 'retained', impactCandidate: candidate } });
  const state = finality.evaluateV3Finality(f.store, f.admission);
  assert.equal(state.code, 'V3_CONTROLLER_UAT_UNVERIFIED'); assert.equal(state.core, 'INCOMPLETE');
});
