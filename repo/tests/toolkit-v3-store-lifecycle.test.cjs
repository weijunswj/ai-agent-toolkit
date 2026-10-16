'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const finality = require('../scripts/toolkit-assurance-web-finality.cjs');
const support = require('./toolkit-v3-store-test-support.cjs');
const retention = require('../scripts/toolkit-custody-retention-v3.cjs');
let fixture;
test.before(() => { fixture = support.createV3StoreFixture(); });

const RETENTION_AS_OF = '2026-10-12T13:00:00.000Z';
function retentionManifest() {
  const artifactId = 'synthetic-local-copy';
  const observedAt = '2026-10-12T12:00:00.000Z';
  const identity = { backend_id: 'fixture-backend', resource_id: 'fixture-worktree', path: '/task/source', mount_members: [] };
  const targetDigest = retention.targetDigest(identity);
  const evidence = { evidence_id: 'synthetic-retained-evidence', content_digest: 'a'.repeat(64) };
  const custody = { evidence_id: evidence.evidence_id, custody_id: 'synthetic-custody', retention_status: 'HELD' };
  const readback = { consumer_id: 'synthetic-builder', evidence_id: evidence.evidence_id, custody_id: custody.custody_id,
    content_digest: evidence.content_digest, retrieved_at: observedAt };
  const ownershipCore = { artifact_id: artifactId, owner_id: 'synthetic-run', target_digest: targetDigest, observed_at: observedAt };
  const ownership = { owner_id: ownershipCore.owner_id, observed_at: observedAt,
    evidence_digest: receipt.digestValue(ownershipCore) };
  const targetObservation = { backend_id: identity.backend_id, observed_at: observedAt, identity_digest: targetDigest };
  const backend = { backend_id: identity.backend_id, path_case: 'SENSITIVE', observed_at: observedAt };
  const released = { consumer_id: 'synthetic-builder', state: 'RELEASED', released_at: observedAt };
  return {
    schema: retention.LEGACY_RETENTION_VIEW_SCHEMA,
    backend_facts: [{ ...backend, evidence_digest: receipt.digestValue(backend) }],
    artifacts: [{
      artifact_id: artifactId, retention_class: 'LOCAL_TEMP', expected_target_identity: identity,
      observed_target_identity: structuredClone(identity),
      target_observation: { ...targetObservation, evidence_digest: receipt.digestValue(targetObservation) },
      ownership, evidence_reference: evidence,
      custody_reference: { ...custody, custody_digest: receipt.digestValue(custody) }, custody_verified_at: observedAt,
      consumer_readback: { ...readback, readback_digest: receipt.digestValue(readback) },
      required_consumers: [{ ...released, release_evidence_digest: receipt.digestValue(released) }], dependencies: [], pins: []
    }]
  };
}

test('synthetic source recovery consumes an authentic store admission and independently compiled current decision', () => {
  const recovery = receipt.readCurrentRecoveryCheckpoint(fixture.store, fixture.admission);
  const decision = fixture.store.readControllerDecision(fixture.admission);
  assert.equal(recovery.checkpoint.owner_acceptance.disposition, 'PENDING');
  assert.equal(recovery.decision_digest, decision.decision_digest);
  assert.equal(recovery.packet_id, fixture.packet_id);
  assert.equal(decision.selection.routes.BUILDER.model, 'gpt-6.1-sol');
  assert.equal(decision.selection.routes.BUILDER.reasoning, 'high');
});
test('synthetic store lifecycle readback preserves pending UAT/review/publication and incomplete Core/parent states', () => {
  fixture.store.readV3Lifecycle(fixture.admission);
  const state = finality.evaluateV3Finality(fixture.store, fixture.admission);
  assert.equal(state.code, undefined);
  assert.equal(state.builder, 'INCOMPLETE');
  assert.equal(state.uat, 'PENDING'); assert.equal(state.g2, 'PENDING');
  assert.equal(state.publication, 'PENDING'); assert.equal(state.core, 'INCOMPLETE');
  assert.equal(state.parent, 'INCOMPLETE'); assert.equal(state.mutation_authority, false);
});
test('source recovery and finality reject copied admissions without calling production readers', () => {
  assert.throws(() => receipt.readCurrentRecoveryCheckpoint(fixture.store, { ...fixture.admission }),
    error => error.code === 'GPR_PACKET_ADMISSION_REQUIRED');
  assert.equal(finality.evaluateV3Finality(fixture.store, { ...fixture.admission }).core, 'INCOMPLETE');
});
test('a candidate drift invalidates the current consumer without resetting or replaying the retained packet', () => {
  const candidate = { ...fixture.consumerIntent.candidate, head_sha: '9'.repeat(40) };
  fixture.setObservedCandidate(candidate);
  try {
    assert.throws(() => receipt.readCurrentRecoveryCheckpoint(fixture.store, fixture.admission));
    assert.equal(finality.evaluateV3Finality(fixture.store, fixture.admission).core, 'INCOMPLETE');
  } finally { fixture.setObservedCandidate(fixture.consumerIntent.candidate); }
  assert.equal(receipt.readCurrentRecoveryCheckpoint(fixture.store, fixture.admission).packet_id, fixture.packet_id);
});
test('CURRENT projection drift is rejected and restoring the exact retained projection resumes at that gap', () => {
  const prior = fixture.currentProjection;
  fixture.setCurrentObservation({ ...prior, consumer: { ...prior.consumer, decision_digest: 'f'.repeat(64) } });
  try { assert.throws(() => fixture.store.readControllerDecision(fixture.admission)); }
  finally { fixture.setCurrentObservation(prior); }
  assert.equal(fixture.store.readControllerDecision(fixture.admission).decision_digest, fixture.compiled.decision_digest);
});
test('V3 current controller consumers bind existing Web/finality roles to the same compiled decision', () => {
  assert.equal(receipt.RECOVERY_CONTROLLER_CONSUMER_SCHEMA_ID, 'toolkit.github-program.current-controller.v3');
  // This constant is not an admission or new gate; a forged controller consumer still cannot enter.
  assert.equal(finality.evaluateV3Finality(fixture.store, { schema: receipt.RECOVERY_CONTROLLER_CONSUMER_SCHEMA_ID }).core, 'INCOMPLETE');
});

test('synthetic retention view is admitted, re-read from SQLite, independently matched, and planned without mutation authority', () => {
  const manifest = retentionManifest();
  const manifestBytes = Buffer.from(receipt.canonicalSerialize(manifest), 'utf8');
  const view = { reference: support.evidenceReference('synthetic-v3-retention-view', manifestBytes), bytes: manifestBytes };
  const independentManifest = structuredClone(manifest);
  const stored = support.createV3StoreFixture({ controllerConsumer: true, extraEvidence: [view],
    retention_view_evidence_id: view.reference.id,
    additionalTrustedReaders: { readV3RetentionObservation({ reference_digest }) {
      return { reference_digest, as_of: RETENTION_AS_OF, manifest: structuredClone(independentManifest) };
    } }
  });
  const persisted = stored.store.readAuthorityPacket(stored.packet_id, stored.persisted.packet.bindings);
  const row = persisted.body.recovery_checkpoint_v3.results.find(item => item.result_id === 'v3-retention-view');
  assert.deepEqual(row.evidence_ids, [view.reference.id]);
  const plan = stored.store.readV3RetentionPlan(stored.admission);
  assert.equal(plan.admission_id, stored.admissionResult.admission_id);
  assert.equal(plan.retained_reference_digest, receipt.digestValue(view.reference));
  assert.equal(plan.mutation_authority, false);
  assert.equal(plan.policy, 'LEGACY_V1_30_DAY_READ_ONLY');
  assert.throws(() => stored.store.createV3CleanupExecutionContext(stored.admission),
    error => error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  assert.equal(plan.decisions[0].artifact_id, 'synthetic-local-copy');
  assert.equal(plan.decisions[0].disposition, 'ELIGIBLE_NOW');
  assert.throws(() => stored.store.readV3RetentionPlan({ ...stored.admission }),
    error => error.code === 'GPR_PACKET_ADMISSION_REQUIRED');
});

test('synthetic retention view rejects an independent manifest whose retained reference differs from admitted evidence', () => {
  const manifest = retentionManifest();
  const manifestBytes = Buffer.from(receipt.canonicalSerialize(manifest), 'utf8');
  const view = { reference: support.evidenceReference('synthetic-v3-retention-view-drift', manifestBytes), bytes: manifestBytes };
  const independentManifest = structuredClone(manifest);
  independentManifest.artifacts[0].evidence_reference.content_digest = 'f'.repeat(64);
  const stored = support.createV3StoreFixture({ controllerConsumer: true, extraEvidence: [view],
    retention_view_evidence_id: view.reference.id,
    additionalTrustedReaders: { readV3RetentionObservation({ reference_digest }) {
      return { reference_digest, as_of: RETENTION_AS_OF, manifest: structuredClone(independentManifest) };
    } }
  });
  assert.throws(() => stored.store.readV3RetentionPlan(stored.admission),
    error => error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
});
