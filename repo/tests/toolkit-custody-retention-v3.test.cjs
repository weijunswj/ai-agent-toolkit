'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const retention = require('../scripts/toolkit-custody-retention-v3.cjs');

const { canonicalSerialize, digestValue } = receipt;
const NOW = '2026-11-04T00:00:00.000Z';
const OLD = '2026-10-01T00:00:00.000Z';
const CONTENT = 'a'.repeat(64);

function target(resourceId = 'worktree-1', path = '/task', mountMembers = []) {
  return { backend_id: 'local-backend', resource_id: resourceId, path, mount_members: mountMembers };
}

function backendFact(backendId = 'local-backend', observedAt = OLD) {
  const core = { backend_id: backendId, path_case: 'SENSITIVE', observed_at: observedAt };
  return { ...core, evidence_digest: digestValue(core) };
}

function readback(consumerId = 'uat-consumer', evidenceId = 'evidence-1', custodyId = 'custody-1', contentDigest = CONTENT, retrievedAt = OLD) {
  const core = { consumer_id: consumerId, evidence_id: evidenceId, custody_id: custodyId,
    content_digest: contentDigest, retrieved_at: retrievedAt };
  return { ...core, readback_digest: digestValue(core) };
}

function releasedConsumer(consumerId, releasedAt) {
  const core = { consumer_id: consumerId, state: 'RELEASED', released_at: releasedAt };
  return { ...core, release_evidence_digest: digestValue(core) };
}

function transferredConsumer(consumerId, successorId, transferredAt, successorReadbackDigest, evidenceId = 'evidence-1', custodyId = 'custody-1', contentDigest = CONTENT) {
  const core = { consumer_id: consumerId, state: 'TRANSFERRED', transferred_at: transferredAt,
    successor_id: successorId, successor_readback_digest: successorReadbackDigest,
    evidence_id: evidenceId, custody_id: custodyId, content_digest: contentDigest };
  return { ...core, transfer_evidence_digest: digestValue(core) };
}

function ownership(artifactId, identity, ownerId = 'toolkit-run-1', observedAt = OLD) {
  const core = { artifact_id: artifactId, owner_id: ownerId,
    target_digest: retention.targetDigest(identity), observed_at: observedAt };
  return { owner_id: ownerId, observed_at: observedAt, evidence_digest: digestValue(core) };
}

function targetObservation(observedIdentity, observedAt = OLD) {
  const core = { backend_id: observedIdentity.backend_id, observed_at: observedAt,
    identity_digest: retention.targetDigest(observedIdentity) };
  return { ...core, evidence_digest: digestValue(core) };
}

function custodyFields(artifactId, identity, options = {}) {
  const evidenceId = options.evidenceId || `evidence-${artifactId}`;
  const custodyId = options.custodyId || `custody-${artifactId}`;
  const contentDigest = options.contentDigest || CONTENT;
  const readbackConsumerId = options.readbackConsumerId || 'uat-consumer';
  const verifiedAt = options.verifiedAt || OLD;
  const consumerReadback = readback(readbackConsumerId, evidenceId, custodyId, contentDigest, options.retrievedAt || OLD);
  return {
    evidence_reference: { evidence_id: evidenceId, content_digest: contentDigest },
    custody_reference: {
      evidence_id: evidenceId,
      custody_id: custodyId,
      retention_status: 'HELD',
      custody_digest: digestValue({ evidence_id: evidenceId, custody_id: custodyId, retention_status: 'HELD' })
    },
    custody_verified_at: verifiedAt,
    consumer_readback: consumerReadback
  };
}

function artifact(artifactId = 'local-copy', options = {}) {
  const expected = options.expected || target(options.resourceId || `resource-${artifactId}`, options.path || '/task', options.mountMembers || []);
  const observed = options.observed || expected;
  const custody = custodyFields(artifactId, expected, options);
  const consumers = options.requiredConsumers || [releasedConsumer('builder', options.consumerReleasedAt || OLD)];
  return {
    artifact_id: artifactId,
    retention_class: options.retentionClass || 'LOCAL_TEMP',
    expected_target_identity: expected,
    observed_target_identity: observed,
    target_observation: targetObservation(observed, options.observedAt || OLD),
    ownership: ownership(artifactId, expected),
    ...custody,
    required_consumers: consumers,
    dependencies: options.dependencies || [],
    pins: options.pins || [],
    ...(options.aliasResolution ? { alias_resolution: options.aliasResolution } : {}),
    ...(options.targetAliasResolution ? { target_alias_resolution: options.targetAliasResolution } : {}),
    ...(options.observerDescriptors ? { observer_descriptors: options.observerDescriptors } : {})
  };
}

function manifest(artifacts, backendFacts = [backendFact()]) {
  return { schema: retention.LEGACY_RETENTION_VIEW_SCHEMA, backend_facts: backendFacts, artifacts };
}

function v2TransferAnchor(item, transferAt = '2026-10-01T00:00:00.000Z') {
  const inventory = [{ relative_path: 'payload.bin', type: 'FILE', bytes: 1, sha256: 'd'.repeat(64) }];
  const storage = item.retention_class === 'REMOTE_TEMP_BULK'
    ? item.expected_target_identity : target('retained-store', '/retained/bundle');
  const core = { transfer_id: `transfer-${item.artifact_id}`, producer_id: 'producer-1', owner_id: item.ownership.owner_id,
    source_target_digest: retention.targetDigest(item.expected_target_identity), storage_target_identity: storage,
    payload_digest: digestValue(inventory), inventory_digest: digestValue(inventory),
    storage_entries: [{ relative_path: 'bundle.bin', git_blob_or_revision: 'bundle-revision-1', bytes: 1, sha256: 'e'.repeat(64) }],
    verified_transfer_at_utc: transferAt,
    expiry_at_utc: new Date(Date.parse(transferAt) + retention.TRANSFER_RETENTION_MS).toISOString(),
    transfer_evidence_reference_digest: 'b'.repeat(64), independent_restore_reference_digest: 'c'.repeat(64) };
  return { ...core, anchor_digest: digestValue(core) };
}
function v2Artifact(id, options = {}) {
  const value = artifact(id, options);
  return { ...value, transfer_anchor: v2TransferAnchor(value, options.transferAt) };
}
function v2Manifest(artifacts) {
  return { schema: retention.RETENTION_VIEW_SCHEMA, backend_facts: [backendFact()], artifacts };
}

function decisionFor(plan, artifactId) {
  return plan.decisions.find((item) => item.artifact_id === artifactId);
}

function aliasResolution(baseIdentity, candidates, observedAt = NOW, equivalencePairs = undefined) {
  const normalized = candidates.map(retention.normalizeTargetIdentity)
    .sort((left, right) => canonicalSerialize(left) < canonicalSerialize(right) ? -1 : canonicalSerialize(left) > canonicalSerialize(right) ? 1 : 0);
  const core = {
    state: 'FINITE',
    candidates: normalized,
    observed_at: observedAt
  };
  if (equivalencePairs !== undefined) core.equivalence_pairs = [...equivalencePairs]
    .sort((left, right) => canonicalSerialize(left) < canonicalSerialize(right) ? -1 : canonicalSerialize(left) > canonicalSerialize(right) ? 1 : 0);
  const payload = { identity_digest: retention.targetDigest(baseIdentity), candidates: normalized, observed_at: observedAt };
  if (equivalencePairs !== undefined) payload.equivalence_pairs = core.equivalence_pairs;
  return { ...core, evidence_digest: digestValue(payload) };
}

function aliasEquivalencePair(left, right) {
  const leftDigest = retention.targetDigest(left);
  const rightDigest = retention.targetDigest(right);
  return leftDigest < rightDigest
    ? { left_target_digest: leftDigest, right_target_digest: rightDigest }
    : { left_target_digest: rightDigest, right_target_digest: leftDigest };
}

function observerDescriptor(observerId, identity) {
  const core = { observer_id: observerId, observed_at: NOW, target_identity_digest: retention.targetDigest(identity) };
  return { ...core, evidence_digest: digestValue(core) };
}

function cleanupReceipt(expected, overrides = {}) {
  const targetIdentity = retention.normalizeTargetIdentity(expected.target_identity);
  const targetDigest = retention.targetDigest(targetIdentity);
  const operationCore = {
    operation_id: 'cleanup-op-1',
    operation_kind: 'DISPOSAL_DELETE',
    target_identity: targetIdentity,
    target_digest: targetDigest,
    scope_target_digests: [targetDigest],
    source_digest: expected.content_digest,
    safety_class: expected.safety_class,
    classification: 'APPLIED',
    attempt_number: 1,
    retry_of_operation_id: null,
    native_approval_evidence_digest: 'b'.repeat(64),
    outcome_evidence_digest: 'c'.repeat(64),
    no_effect_observation_digest: null,
    executor_id: 'cleanup-writer'
  };
  Object.assign(operationCore, overrides.operation || {});
  const operation = { ...operationCore, receipt_digest: digestValue(operationCore) };
  const readbackCore = {
    readback_id: 'cleanup-readback-1',
    reader_id: 'independent-reader',
    target_identity: targetIdentity,
    target_digest: targetDigest,
    state: 'ABSENT',
    observed_at: NOW,
    operation_receipt_digest: operation.receipt_digest
  };
  Object.assign(readbackCore, overrides.readback || {});
  const absenceReadback = { ...readbackCore, evidence_digest: digestValue(readbackCore) };
  return {
    schema: retention.DISPOSAL_RECEIPT_SCHEMA,
    artifact_id: expected.artifact_id,
    operation_receipt: operation,
    absence_readback: absenceReadback
  };
}

function disposalExpected(options = {}) {
  return {
    artifact_id: 'local-copy',
    target_identity: target('cleanup-target', '/task'),
    content_digest: CONTENT,
    safety_class: options.safetyClass || 'TEMP_CUSTODY_DISPOSAL'
  };
}

function nativeAcceptance(expected, evidenceDigest = 'b'.repeat(64), overrides = {}) {
  return {
    evidence_digest: evidenceDigest,
    operation_kind: 'DISPOSAL_DELETE',
    target_digest: retention.targetDigest(expected.target_identity),
    scope_target_digests: [retention.targetDigest(expected.target_identity)],
    source_digest: expected.content_digest,
    safety_class: expected.safety_class,
    ...overrides
  };
}

function priorDeniedOperation(expected, overrides = {}) {
  const targetIdentity = retention.normalizeTargetIdentity(expected.target_identity);
  const targetDigest = retention.targetDigest(targetIdentity);
  const core = {
    operation_id: 'cleanup-op-1',
    operation_kind: 'DISPOSAL_DELETE',
    target_identity: targetIdentity,
    target_digest: targetDigest,
    scope_target_digests: [targetDigest],
    source_digest: expected.content_digest,
    safety_class: expected.safety_class,
    classification: 'DENIED_NOT_APPLIED',
    attempt_number: 1,
    retry_of_operation_id: null,
    native_approval_evidence_digest: null,
    outcome_evidence_digest: 'd'.repeat(64),
    no_effect_observation_digest: 'e'.repeat(64),
    executor_id: 'cleanup-writer'
  };
  Object.assign(core, overrides);
  return { ...core, receipt_digest: digestValue(core) };
}

function trustedPriorNonapplication(prior, overrides = {}) {
  const core = {
    operation_id: prior.operation_id,
    operation_kind: prior.operation_kind,
    target_digest: prior.target_digest,
    scope_target_digests: prior.scope_target_digests,
    source_digest: prior.source_digest,
    safety_class: prior.safety_class,
    outcome_evidence_digest: prior.outcome_evidence_digest,
    no_effect_observation_digest: prior.no_effect_observation_digest
  };
  return { ...core, ...overrides };
}

function trustedDisposalBindings(expected, options = {}) {
  return {
    current_native_acceptance: options.currentNativeAcceptance || nativeAcceptance(expected),
    prior_nonapplication: options.priorNonapplication === undefined ? null : options.priorNonapplication
  };
}

function fixtureTarget(artifactId = 'fixture-copy', backendId = 'task-fixture-backend', resourceId = `fixture-${artifactId}`, pathValue = `/task59-fixture/${artifactId}`) {
  return { backend_id: backendId, resource_id: resourceId, path: pathValue, mount_members: [] };
}

function fixtureDisposalExpected(artifactId = 'fixture-copy') {
  return {
    artifact_id: artifactId,
    target_identity: fixtureTarget(artifactId),
    content_digest: CONTENT,
    safety_class: 'TEMP_CUSTODY_DISPOSAL'
  };
}

function fixtureTargetAuthorization(sourceManifest, expected, now = NOW) {
  const plan = retention.planRetention(sourceManifest, { now, fixture_clock: true });
  const sourceArtifact = sourceManifest.artifacts.find((item) => item.artifact_id === expected.artifact_id);
  const targetIdentity = retention.normalizeTargetIdentity(expected.target_identity);
  const targetDigest = retention.targetDigest(targetIdentity);
  const core = {
    artifact_id: expected.artifact_id,
    target_identity: targetIdentity,
    target_digest: targetDigest,
    scope_target_digests: [targetDigest],
    source_digest: expected.content_digest,
    safety_class: expected.safety_class,
    owner_id: sourceArtifact.ownership.owner_id,
    retained_reference_digest: digestValue({ evidence_reference: sourceArtifact.evidence_reference,
      custody_reference: sourceArtifact.custody_reference, content_digest: expected.content_digest }),
    retention_state_digest: digestValue({ artifact: sourceArtifact, backend_facts: sourceManifest.backend_facts || [] }),
    eligibility_plan_digest: plan.plan_digest
  };
  return { ...core, evidence_digest: digestValue(core) };
}

// Cleanup operates only on current (v2) records; legacy v1 views are read-only.
function fixtureCleanupSource(expected, options = {}) {
  const fixture = v2Artifact(expected.artifact_id, {
    transferAt: new Date(Date.parse(NOW) - 2 * retention.TRANSFER_RETENTION_MS).toISOString(),
    expected: expected.target_identity,
    observed: options.observed || expected.target_identity,
    ...(options.targetAliasResolution ? { targetAliasResolution: options.targetAliasResolution } : {}),
    ...(options.observerDescriptors ? { observerDescriptors: options.observerDescriptors } : {}),
    ...(options.requiredConsumers ? { requiredConsumers: options.requiredConsumers } : {})
  });
  const facts = [backendFact(expected.target_identity.backend_id)];
  for (const identity of [options.observed, ...(options.targetAliasResolution?.candidates || [])]) {
    if (identity && !facts.some((fact) => fact.backend_id === identity.backend_id)) facts.push(backendFact(identity.backend_id));
  }
  return { schema: retention.RETENTION_VIEW_SCHEMA, backend_facts: facts, artifacts: [fixture] };
}

function fixtureCleanupHarness(options = {}) {
  const expected = fixtureDisposalExpected(options.artifactId || 'fixture-copy');
  const source = fixtureCleanupSource(expected, options);
  const sourceBefore = structuredClone(source);
  const { backend, controls } = retention.createTaskOwnedFixtureCleanupBackend({
    manifest: source,
    artifact_id: expected.artifact_id
  });
  return { expected, source, sourceBefore, backend, controls };
}

function fixtureExecutionRequest(harness, options = {}) {
  const backend = options.backend || harness.backend;
  const now = options.now || NOW;
  const boundary = backend.readBoundary(harness.expected);
  return {
    backend,
    expected: harness.expected,
    now,
    target_authorization: options.targetAuthorization || fixtureTargetAuthorization(boundary.manifest, harness.expected, now),
    trusted_bindings: trustedDisposalBindings(harness.expected, {
      currentNativeAcceptance: nativeAcceptance(harness.expected, options.acceptanceDigest || 'f'.repeat(64)),
      priorNonapplication: options.priorNonapplication === undefined ? null : options.priorNonapplication
    }),
    operation_id: options.operationId || 'fixture-operation-1',
    executor_id: options.executorId || 'task-fixture-executor'
  };
}

const PRODUCER_CRASH_SCRIPT = String.raw`
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
try {
  const [statePath, encodedState, evidenceDirectory] = process.argv.slice(1);
  const resolvedDirectory = path.resolve(evidenceDirectory);
  const resolvedStatePath = path.resolve(statePath);
  if (path.dirname(resolvedStatePath) !== resolvedDirectory) process.exit(70);
  const expectedBytes = Buffer.from(encodedState, 'base64');
  const state = JSON.parse(expectedBytes.toString('utf8'));
  if (!state || typeof state !== 'object' || !state.manifest || typeof state.target_present !== 'boolean') process.exit(71);
  fs.writeFileSync(resolvedStatePath, expectedBytes);
  const persistedBytes = fs.readFileSync(resolvedStatePath);
  if (!persistedBytes.equals(expectedBytes)) process.exit(72);
  const report = {
    pid: process.pid,
    persisted_bytes: persistedBytes.length,
    persisted_sha256: crypto.createHash('sha256').update(persistedBytes).digest('hex'),
    target_present: state.target_present,
    operation_count: (state.manifest.artifacts[0].disposal_observations || []).filter((event) => event.kind === 'OPERATION').length
  };
  process.stdout.write(JSON.stringify(report), () => process.exit(73));
} catch (error) {
  process.stderr.write(String(error && error.message || error));
  process.exit(74);
}
`;

const SUCCESSOR_RECOVERY_SCRIPT = String.raw`
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
try {
  const [statePath, resultPath, evidenceDirectory, retentionPath, receiptPath, scenario] = process.argv.slice(1);
  const resolvedDirectory = path.resolve(evidenceDirectory);
  const resolvedStatePath = path.resolve(statePath);
  const resolvedResultPath = path.resolve(resultPath);
  if (path.dirname(resolvedStatePath) !== resolvedDirectory || path.dirname(resolvedResultPath) !== resolvedDirectory) process.exit(80);
  const sourceBytes = fs.readFileSync(resolvedStatePath);
  const state = JSON.parse(sourceBytes.toString('utf8'));
  const retention = require(retentionPath);
  const { digestValue } = require(receiptPath);
  const expected = state.expected;
  const now = state.now;
  const artifact = state.manifest.artifacts.find((item) => item.artifact_id === expected.artifact_id);
  if (!artifact) process.exit(81);
  const targetIdentity = retention.normalizeTargetIdentity(expected.target_identity);
  const targetHash = retention.targetDigest(targetIdentity);
  const plan = retention.planRetention(state.manifest, { now, fixture_clock: true });
  const authorizationCore = {
    artifact_id: expected.artifact_id,
    target_identity: targetIdentity,
    target_digest: targetHash,
    scope_target_digests: [targetHash],
    source_digest: expected.content_digest,
    safety_class: expected.safety_class,
    owner_id: artifact.ownership.owner_id,
    retained_reference_digest: digestValue({ evidence_reference: artifact.evidence_reference,
      custody_reference: artifact.custody_reference, content_digest: expected.content_digest }),
    retention_state_digest: digestValue({ artifact, backend_facts: state.manifest.backend_facts || [] }),
    eligibility_plan_digest: plan.plan_digest
  };
  const freshAuthorization = { ...authorizationCore, evidence_digest: digestValue(authorizationCore) };
  const { backend, controls } = retention.createTaskOwnedFixtureCleanupBackend({ manifest: state.manifest,
    artifact_id: expected.artifact_id, target_present: state.target_present });
  if (scenario === 'restored-unknown') controls.setReaderOverride('UNKNOWN');
  const events = artifact.disposal_observations || [];
  const operations = events.filter((event) => event.kind === 'OPERATION').map((event) => event.operation_receipt);
  const previous = operations.at(-1);
  const priorNonapplication = previous && previous.classification === 'DENIED_NOT_APPLIED' ? {
    operation_id: previous.operation_id,
    operation_kind: previous.operation_kind,
    target_digest: previous.target_digest,
    scope_target_digests: previous.scope_target_digests,
    source_digest: previous.source_digest,
    safety_class: previous.safety_class,
    outcome_evidence_digest: previous.outcome_evidence_digest,
    no_effect_observation_digest: previous.no_effect_observation_digest
  } : null;
  const currentNativeAcceptance = {
    evidence_digest: 'f'.repeat(64),
    operation_kind: 'DISPOSAL_DELETE',
    target_digest: targetHash,
    scope_target_digests: [targetHash],
    source_digest: expected.content_digest,
    safety_class: expected.safety_class
  };
  const staleStateScenario = ['restored-active-consumer', 'restored-stale-reference', 'restored-stale-owner'].includes(scenario);
  const targetAuthorization = staleStateScenario ? state.producer_authorization : freshAuthorization;
  let outcome;
  try {
    const result = retention.executeFixtureDisposal({
      backend, expected, now,
      target_authorization: targetAuthorization,
      trusted_bindings: { current_native_acceptance: currentNativeAcceptance, prior_nonapplication: priorNonapplication },
      operation_id: 'successor-' + scenario,
      executor_id: 'separate-successor-process'
    });
    outcome = { status: result.status, reason_codes: result.reason_codes || [], operation_attempted: result.operation_attempted,
      operation_id: result.operation_id || null, operation_classification: result.operation_classification || null,
      observed_target_state: result.observed_target_state || null };
  } catch (error) {
    outcome = { status: 'HOLD', reason_codes: [error.code || 'RETENTION_FIXTURE_RECOVERY_FAILED'],
      error_code: error.code || 'RETENTION_FIXTURE_RECOVERY_FAILED', operation_attempted: false };
  }
  const postState = controls.snapshot();
  const finalEvents = postState.manifest.artifacts.find((item) => item.artifact_id === expected.artifact_id).disposal_observations || [];
  const resultEnvelope = {
    schema: 'task59.cleanup.separate-process-recovery-result.v1',
    scenario,
    consumer_pid: process.pid,
    input_bytes: sourceBytes.length,
    input_sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
    original_manifest_digest: digestValue(state.manifest),
    producer_authorization_matches_current: digestValue(freshAuthorization) === digestValue(state.producer_authorization),
    outcome,
    final_state: postState,
    operation_count: finalEvents.filter((event) => event.kind === 'OPERATION').length,
    readback_count: finalEvents.filter((event) => event.kind === 'READBACK').length,
    attempt_numbers: finalEvents.filter((event) => event.kind === 'OPERATION').map((event) => event.operation_receipt.attempt_number),
    operation_classifications: finalEvents.filter((event) => event.kind === 'OPERATION').map((event) => event.operation_receipt.classification)
  };
  const resultBytes = Buffer.from(JSON.stringify(resultEnvelope));
  fs.writeFileSync(resolvedResultPath, resultBytes);
  const persistedResult = fs.readFileSync(resolvedResultPath);
  const rereadSource = fs.readFileSync(resolvedStatePath);
  if (!persistedResult.equals(resultBytes) || !rereadSource.equals(sourceBytes)) process.exit(82);
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    result_readback_exact: true,
    source_readback_exact: true,
    result_sha256: crypto.createHash('sha256').update(persistedResult).digest('hex'),
    outcome_status: outcome.status,
    target_present: postState.target_present,
    operation_count: resultEnvelope.operation_count,
    readback_count: resultEnvelope.readback_count,
    attempt_numbers: resultEnvelope.attempt_numbers,
    operation_classifications: resultEnvelope.operation_classifications
  }));
} catch (error) {
  process.stderr.write(String(error && error.message || error));
  process.exit(83);
}
`;

test('v2 remote retention uses the immutable verified-transfer expiry and never restarts on late consumer release', () => {
  const releasedBeforeExpiry = v2Artifact('v2-remote-early', { retentionClass: 'REMOTE_TEMP_BULK',
    requiredConsumers: [releasedConsumer('builder', '2026-10-20T00:00:00.000Z')] });
  const view = v2Manifest([releasedBeforeExpiry]);
  const before = retention.planRetention(view, { now: '2026-10-21T23:59:59.999Z', fixture_clock: true });
  assert.equal(decisionFor(before, releasedBeforeExpiry.artifact_id).disposition, 'WAIT_UNTIL');
  assert.equal(decisionFor(before, releasedBeforeExpiry.artifact_id).eligible_at, '2026-10-22T00:00:00.000Z');
  const due = retention.planRetention(view, { now: '2026-10-22T00:00:00.000Z', fixture_clock: true });
  assert.equal(decisionFor(due, releasedBeforeExpiry.artifact_id).disposition, 'ELIGIBLE_NOW');
  const late = v2Artifact('v2-remote-late', { retentionClass: 'REMOTE_TEMP_BULK',
    requiredConsumers: [releasedConsumer('builder', '2026-10-23T00:00:00.000Z')] });
  const held = retention.planRetention(v2Manifest([late]), { now: '2026-10-22T00:00:00.000Z', fixture_clock: true });
  assert.notEqual(decisionFor(held, late.artifact_id).disposition, 'ELIGIBLE_NOW');
  const released = retention.planRetention(v2Manifest([late]), { now: '2026-10-23T00:00:00.000Z', fixture_clock: true });
  assert.equal(decisionFor(released, late.artifact_id).disposition, 'ELIGIBLE_NOW');
  assert.equal(decisionFor(released, late.artifact_id).immutable_expiry_at_utc, '2026-10-22T00:00:00.000Z');
});

test('v2 local retention has no 21-day minimum and malformed or changed transfer anchors hold', () => {
  const local = v2Artifact('v2-local', { retentionClass: 'LOCAL_TEMP' });
  const plan = retention.planRetention(v2Manifest([local]), { now: '2026-10-02T00:00:00.000Z', fixture_clock: true });
  assert.equal(decisionFor(plan, local.artifact_id).disposition, 'ELIGIBLE_NOW');
  const changed = structuredClone(local);
  changed.transfer_anchor.expiry_at_utc = '2026-10-23T00:00:00.000Z';
  const unsignedAnchor = { ...changed.transfer_anchor }; delete unsignedAnchor.anchor_digest;
  changed.transfer_anchor.anchor_digest = digestValue(unsignedAnchor);
  const held = retention.planRetention(v2Manifest([changed]), { now: '2026-10-02T00:00:00.000Z', fixture_clock: true });
  assert.equal(decisionFor(held, local.artifact_id).disposition, 'HOLD');
  assert.ok(decisionFor(held, local.artifact_id).reason_codes.includes(retention.HOLD.TRANSFER_ANCHOR_UNKNOWN));
});


test('local temporary copies become eligible immediately after custody, consumer readback, ownership, and dependency checks', () => {
  const source = manifest([artifact()]);
  const before = structuredClone(source);
  const plan = retention.planRetention(source, { now: NOW });
  assert.deepEqual(decisionFor(plan, 'local-copy'), {
    artifact_id: 'local-copy',
    disposition: 'ELIGIBLE_NOW',
    eligible_at: NOW,
    reason_codes: [],
    target_digest: retention.targetDigest(source.artifacts[0].expected_target_identity)
  });
  assert.deepEqual(source, before, 'planning is read-only and does not reset or rewrite retained evidence');
});

test('remote bulk waits 30 days from the latest release or verified successor transfer', () => {
  const readbackFact = readback('successor-builder', 'evidence-remote-copy', 'custody-remote-copy', CONTENT, '2026-10-02T00:00:00.000Z');
  const item = artifact('remote-copy', {
    retentionClass: 'REMOTE_TEMP_BULK',
    readbackConsumerId: 'successor-builder',
    evidenceId: 'evidence-remote-copy',
    custodyId: 'custody-remote-copy',
    retrievedAt: readbackFact.retrieved_at,
    consumerReleasedAt: '2026-10-03T00:00:00.000Z',
    requiredConsumers: [
      releasedConsumer('g2-review', '2026-10-05T00:00:00.000Z'),
      transferredConsumer('active-builder', 'successor-builder', '2026-10-04T00:00:00.000Z', readbackFact.readback_digest,
        'evidence-remote-copy', 'custody-remote-copy')
    ]
  });
  const facts = manifest([item]);
  const beforeDue = retention.planRetention(facts, { now: '2026-11-03T23:59:59.999Z' });
  assert.equal(decisionFor(beforeDue, 'remote-copy').disposition, 'WAIT_UNTIL');
  assert.equal(decisionFor(beforeDue, 'remote-copy').eligible_at, '2026-11-04T00:00:00.000Z');
  const atDue = retention.planRetention(facts, { now: NOW });
  assert.equal(decisionFor(atDue, 'remote-copy').disposition, 'ELIGIBLE_NOW');
  assert.equal(decisionFor(atDue, 'remote-copy').latest_required_consumer_release_at, '2026-10-05T00:00:00.000Z');
});

test('an explicit active pin blocks only its artifact and a valid release clears it', () => {
  const pinned = artifact('pinned-copy', { pins: [{ pin_id: 'rollback-pin', reason: 'ROLLBACK', owner_id: 'release-owner', release_condition: 'ROLLBACK_WINDOW_CLOSED' }] });
  const unrelated = artifact('eligible-copy');
  const initial = retention.planRetention(manifest([pinned, unrelated]), { now: NOW });
  assert.equal(decisionFor(initial, 'pinned-copy').disposition, 'HOLD');
  assert.ok(decisionFor(initial, 'pinned-copy').reason_codes.includes(retention.HOLD.RETENTION_PIN_ACTIVE));
  assert.equal(decisionFor(initial, 'eligible-copy').disposition, 'ELIGIBLE_NOW');
  const pin = pinned.pins[0];
  const releaseCore = { pin_id: pin.pin_id, reason: pin.reason, owner_id: pin.owner_id,
    release_condition: pin.release_condition, released_at: '2026-11-03T00:00:00.000Z' };
  pinned.pins = [{ ...pin, release: { released_at: releaseCore.released_at, evidence_digest: digestValue(releaseCore) } }];
  assert.equal(decisionFor(retention.planRetention(manifest([pinned]), { now: NOW }), 'pinned-copy').disposition, 'ELIGIBLE_NOW');
});

test('missing backend facts are unknown and hold only the affected artifact', () => {
  const missingBackend = { backend_id: 'missing-backend', resource_id: 'unknown-resource', path: '/task', mount_members: [] };
  const unknown = artifact('unknown-backend', { expected: missingBackend, observed: missingBackend });
  const unknownMount = target('mounted-resource', '/task', [
    { backend_id: 'missing-mount-backend', resource_id: 'mounted-volume', path: '/payload' }
  ]);
  const unknownMountArtifact = artifact('unknown-mount-backend', { expected: unknownMount, observed: unknownMount });
  const known = artifact('known-backend');
  const plan = retention.planRetention(manifest([unknown, unknownMountArtifact, known], [backendFact()]), { now: NOW });
  assert.equal(decisionFor(plan, 'unknown-backend').disposition, 'HOLD');
  assert.ok(decisionFor(plan, 'unknown-backend').reason_codes.includes(retention.HOLD.BACKEND_FACTS_UNKNOWN));
  assert.ok(decisionFor(plan, 'unknown-mount-backend').reason_codes.includes(retention.HOLD.BACKEND_FACTS_UNKNOWN));
  assert.equal(decisionFor(plan, 'known-backend').disposition, 'ELIGIBLE_NOW');
});

test('valid retained evidence survives an unresolved dependency while another artifact resumes at its gap', () => {
  const held = artifact('held-at-gap', { dependencies: [{ dependency_id: 'runtime-lease', state: 'UNKNOWN' }] });
  const eligible = artifact('independent-copy');
  const source = manifest([held, eligible]);
  const evidenceBefore = structuredClone(held.custody_reference);
  const first = retention.planRetention(source, { now: NOW });
  assert.equal(decisionFor(first, 'held-at-gap').disposition, 'HOLD');
  assert.ok(decisionFor(first, 'held-at-gap').reason_codes.includes(retention.HOLD.DEPENDENCY_UNKNOWN));
  assert.equal(decisionFor(first, 'independent-copy').disposition, 'ELIGIBLE_NOW');
  assert.deepEqual(held.custody_reference, evidenceBefore);
  assert.deepEqual(decisionFor(retention.planRetention(source, { now: NOW }), 'held-at-gap'), decisionFor(first, 'held-at-gap'));
});

test('mount-member and observer descriptor ordering is semantic and creates no dependency', () => {
  const membersA = [
    { backend_id: 'local-backend', resource_id: 'mount-b', path: '/b' },
    { backend_id: 'local-backend', resource_id: 'mount-a', path: '/a' }
  ];
  const membersB = [...membersA].reverse();
  const identityA = target('composite', '/task', membersA);
  const identityB = target('composite', '/task', membersB);
  const observersA = [observerDescriptor('observer-a', identityA), observerDescriptor('observer-b', identityA)];
  const observersB = [...observersA].reverse();
  const first = artifact('composite-copy', { expected: identityA, observed: identityA, mountMembers: membersA, observerDescriptors: observersA });
  const second = artifact('composite-copy', { expected: identityB, observed: identityB, mountMembers: membersB, observerDescriptors: observersB });
  assert.equal(retention.targetDigest(identityA), retention.targetDigest(identityB));
  const firstDecision = decisionFor(retention.planRetention(manifest([first]), { now: NOW }), 'composite-copy');
  const secondDecision = decisionFor(retention.planRetention(manifest([second]), { now: NOW }), 'composite-copy');
  assert.deepEqual(firstDecision, secondDecision);
  assert.equal(firstDecision.disposition, 'ELIGIBLE_NOW');
});

test('exact observer and backend alias equivalence binds both full target identities', () => {
  const expected = target('canonical-resource', '/canonical');
  const observed = { backend_id: 'alias-backend', resource_id: 'mounted-resource', path: '/mounted/canonical', mount_members: [] };
  const resolution = aliasResolution(observed, [observed, expected], NOW, [aliasEquivalencePair(expected, observed)]);
  const descriptors = [observerDescriptor('canonical-reader', expected), observerDescriptor('alias-reader', observed)];
  const equivalent = artifact('equivalent-alias-copy', {
    expected, observed, targetAliasResolution: resolution, observerDescriptors: descriptors
  });
  const accepted = retention.planRetention(manifest([equivalent], [backendFact(), backendFact('alias-backend')]), { now: NOW });
  assert.equal(decisionFor(accepted, 'equivalent-alias-copy').disposition, 'ELIGIBLE_NOW');

  const wrongPair = aliasResolution(observed, [observed, expected], NOW, [aliasEquivalencePair(observed, target('other-resource', '/other'))]);
  const unsupported = artifact('unsupported-alias-copy', {
    expected, observed, targetAliasResolution: wrongPair, observerDescriptors: descriptors
  });
  const held = decisionFor(retention.planRetention(manifest([unsupported], [backendFact(), backendFact('alias-backend')]), { now: NOW }), 'unsupported-alias-copy');
  assert.equal(held.disposition, 'HOLD');
  assert.ok(held.reason_codes.includes(retention.HOLD.TARGET_DRIFT));
});

test('finite alias uncertainty holds on possible overlap and verified disjointness resolves it', () => {
  const item = artifact('alias-target');
  const overlappingBase = target('alias-resource', '/unknown');
  const overlapDependency = {
    dependency_id: 'alias-user',
    state: 'ACTIVE',
    target_identity: overlappingBase,
    alias_resolution: aliasResolution(overlappingBase, [overlappingBase, item.expected_target_identity])
  };
  const overlapPlan = retention.planRetention(manifest([artifact('alias-target', { dependencies: [overlapDependency] })]), { now: NOW });
  assert.equal(decisionFor(overlapPlan, 'alias-target').disposition, 'HOLD');
  assert.ok(decisionFor(overlapPlan, 'alias-target').reason_codes.includes(retention.HOLD.DEPENDENCY_OVERLAP));

  const disjointBase = target('alias-resource', '/unknown');
  const disjointDependency = {
    dependency_id: 'disjoint-alias-user',
    state: 'ACTIVE',
    target_identity: disjointBase,
    alias_resolution: aliasResolution(disjointBase, [disjointBase, target('local-backend-resource', '/elsewhere')])
  };
  const disjointFacts = [backendFact('local-backend'), backendFact('alias-resource'), backendFact('local-backend-resource')];
  const disjointPlan = retention.planRetention(manifest([artifact('alias-target', { dependencies: [disjointDependency] })], disjointFacts), { now: NOW });
  assert.equal(decisionFor(disjointPlan, 'alias-target').disposition, 'ELIGIBLE_NOW');
});

test('overlap, target drift, active consumers, and unknown alias state all block local disposal', () => {
  const base = target('worktree-overlap', '/task');
  const overlap = artifact('overlap-copy', { expected: base, observed: base, dependencies: [
    { dependency_id: 'nested-reader', state: 'ACTIVE', target_identity: target('worktree-overlap', '/task/nested') }
  ] });
  const drifted = artifact('drifted-copy', { expected: target('worktree-drift', '/expected'), observed: target('worktree-drift', '/actual') });
  const active = artifact('active-consumer-copy', { requiredConsumers: [{ consumer_id: 'installer', state: 'ACTIVE' }] });
  const aliasUnknown = artifact('unknown-alias-copy', { aliasResolution: { state: 'UNKNOWN' } });
  const plan = retention.planRetention(manifest([overlap, drifted, active, aliasUnknown]), { now: NOW });
  assert.ok(decisionFor(plan, 'overlap-copy').reason_codes.includes(retention.HOLD.DEPENDENCY_OVERLAP));
  assert.ok(decisionFor(plan, 'drifted-copy').reason_codes.includes(retention.HOLD.TARGET_DRIFT));
  assert.ok(decisionFor(plan, 'active-consumer-copy').reason_codes.includes(retention.HOLD.CONSUMER_ACTIVE));
  assert.ok(decisionFor(plan, 'unknown-alias-copy').reason_codes.includes(retention.HOLD.ALIAS_RESOLUTION_UNKNOWN));
});

test('cleanup receipt requires exact target, one-target scope, current native binding, and independent absence readback', () => {
  const expected = disposalExpected();
  const receiptValue = cleanupReceipt(expected);
  const bindings = trustedDisposalBindings(expected);
  const validated = retention.validateDisposalReceipt(receiptValue, expected, [], bindings);
  assert.equal(validated.ok, true);
  assert.equal(validated.target_digest, retention.targetDigest(expected.target_identity));
  assert.equal(validated.absence_observed_at, NOW);
  assert.equal(Object.hasOwn(validated, 'disposed_at'), false, 'absence observation time does not assert deletion time');
  assert.throws(() => retention.validateDisposalReceipt(cleanupReceipt(expected, {
    operation: { scope_target_digests: [retention.targetDigest(expected.target_identity), 'b'.repeat(64)] }
  }), expected, [], bindings), { code: 'RETENTION_DISPOSAL_RECEIPT_INVALID' });
  assert.throws(() => retention.validateDisposalReceipt(cleanupReceipt(expected, {
    operation: { classification: 'NOT_APPLIED' }
  }), expected, [], bindings), { code: 'RETENTION_DISPOSAL_NOT_APPLIED' });
  assert.throws(() => retention.validateDisposalReceipt(cleanupReceipt(expected, {
    operation: { attempt_number: 2, retry_of_operation_id: 'cleanup-op-0' }
  }), expected, [], bindings), { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });
  assert.throws(() => retention.validateDisposalReceipt(receiptValue, expected, [], {
    ...bindings,
    current_native_acceptance: null
  }), { code: 'RETENTION_NATIVE_APPROVAL_BINDING_INVALID' });
  assert.throws(() => retention.validateDisposalReceipt(receiptValue, expected, [], {
    ...bindings,
    current_native_acceptance: nativeAcceptance(expected, 'b'.repeat(64), { source_digest: 'f'.repeat(64) })
  }), { code: 'RETENTION_NATIVE_APPROVAL_BINDING_INVALID' });
  assert.throws(() => retention.validateDisposalReceipt(cleanupReceipt(expected, {
    readback: { reader_id: 'cleanup-writer' }
  }), expected, [], bindings), { code: 'RETENTION_ABSENCE_READBACK_INVALID' });
  assert.throws(() => retention.validateDisposalReceipt(cleanupReceipt(expected), expected,
    [priorDeniedOperation(expected)], bindings), { code: 'RETENTION_DISPOSAL_DUPLICATE' });
});

test('one retry requires same-action denied nonapplication, independent no-effect observation, and current exact-scope acceptance', () => {
  const expected = disposalExpected();
  const prior = priorDeniedOperation(expected);
  const acceptance = nativeAcceptance(expected, 'f'.repeat(64));
  const retry = cleanupReceipt(expected, {
    operation: {
      operation_id: 'cleanup-op-2',
      attempt_number: 2,
      retry_of_operation_id: prior.operation_id,
      native_approval_evidence_digest: acceptance.evidence_digest
    }
  });
  const trusted = trustedDisposalBindings(expected, {
    currentNativeAcceptance: acceptance,
    priorNonapplication: trustedPriorNonapplication(prior)
  });
  const validated = retention.validateDisposalReceipt(retry, expected, [prior], trusted);
  assert.equal(validated.ok, true);
  assert.equal(validated.absence_observed_at, NOW);

  assert.throws(() => retention.validateDisposalReceipt(retry, expected, [prior], {
    ...trusted,
    current_native_acceptance: nativeAcceptance(expected, acceptance.evidence_digest, {
      scope_target_digests: [retention.targetDigest(expected.target_identity), 'a'.repeat(64)]
    })
  }), { code: 'RETENTION_NATIVE_APPROVAL_BINDING_INVALID' });
  assert.throws(() => retention.validateDisposalReceipt(retry, expected, [prior], {
    ...trusted,
    prior_nonapplication: trustedPriorNonapplication(prior, { no_effect_observation_digest: 'a'.repeat(64) })
  }), { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });

  for (const classification of ['UNKNOWN', 'APPLIED']) {
    const uncertainOrApplied = priorDeniedOperation(expected, {
      classification,
      no_effect_observation_digest: classification === 'UNKNOWN' ? null : 'e'.repeat(64)
    });
    const blocked = cleanupReceipt(expected, {
      operation: {
        operation_id: 'cleanup-op-2', attempt_number: 2,
        retry_of_operation_id: uncertainOrApplied.operation_id,
        native_approval_evidence_digest: acceptance.evidence_digest
      }
    });
    assert.throws(() => retention.validateDisposalReceipt(blocked, expected, [uncertainOrApplied], {
      ...trusted,
      prior_nonapplication: trustedPriorNonapplication(uncertainOrApplied)
    }), { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });
  }

  const changedSource = priorDeniedOperation(expected, { source_digest: '9'.repeat(64) });
  assert.throws(() => retention.validateDisposalReceipt(retry, expected, [changedSource], {
    ...trusted,
    prior_nonapplication: trustedPriorNonapplication(changedSource)
  }), { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });
  const changedClass = priorDeniedOperation(expected, { safety_class: 'OTHER_CLASS' });
  assert.throws(() => retention.validateDisposalReceipt(retry, expected, [changedClass], {
    ...trusted,
    prior_nonapplication: trustedPriorNonapplication(changedClass)
  }), { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });

  const otherTarget = target('different-cleanup-target', '/task');
  const changedTarget = priorDeniedOperation(expected, {
    target_identity: otherTarget,
    target_digest: retention.targetDigest(otherTarget),
    scope_target_digests: [retention.targetDigest(otherTarget)]
  });
  assert.throws(() => retention.validateDisposalReceipt(retry, expected, [changedTarget], {
    ...trusted,
    prior_nonapplication: trustedPriorNonapplication(changedTarget)
  }), { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });

  const duplicatePrior = priorDeniedOperation(expected, { operation_id: 'cleanup-op-0' });
  assert.throws(() => retention.validateDisposalReceipt(retry, expected, [prior, duplicatePrior], trusted),
    { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });
  const thirdAttempt = cleanupReceipt(expected, {
    operation: {
      operation_id: 'cleanup-op-3', attempt_number: 3,
      retry_of_operation_id: prior.operation_id,
      native_approval_evidence_digest: acceptance.evidence_digest
    }
  });
  assert.throws(() => retention.validateDisposalReceipt(thirdAttempt, expected, [prior], trusted),
    { code: 'RETENTION_DISPOSAL_RETRY_NOT_PERMITTED' });
});

test('retention helper plans and validates receipts but exposes no deletion or approval bypass', () => {
  assert.equal(Object.hasOwn(retention, 'executeDisposal'), false);
  assert.equal(Object.hasOwn(retention, 'approveDisposal'), false);
  assert.equal(decisionFor(retention.planRetention(manifest([artifact()]), { now: NOW }), 'local-copy').disposition, 'ELIGIBLE_NOW');
  assert.throws(() => retention.executeFixtureDisposal({
    backend: { readBoundary() { throw new Error('untrusted backend must not be called'); } },
    expected: fixtureDisposalExpected(), now: NOW
  }), { code: 'RETENTION_FIXTURE_BACKEND_UNSUPPORTED' });
});

test('fixture execution binds exact alias equivalence and appends operation/readback to the retained artifact', () => {
  const artifactId = 'fixture-alias-copy';
  const expected = fixtureDisposalExpected(artifactId);
  const observed = {
    backend_id: 'fixture-alias-backend', resource_id: 'alias-volume',
    path: `/task59-alias/${artifactId}`, mount_members: []
  };
  const resolution = aliasResolution(observed, [observed, expected.target_identity], NOW,
    [aliasEquivalencePair(expected.target_identity, observed)]);
  const harness = fixtureCleanupHarness({ artifactId, observed, targetAliasResolution: resolution,
    observerDescriptors: [observerDescriptor('canonical-observer', expected.target_identity),
      observerDescriptor('alias-observer', observed)] });
  assert.equal(decisionFor(retention.planRetention(harness.source, { now: NOW, fixture_clock: true }), artifactId).disposition, 'ELIGIBLE_NOW');
  const wrongAcceptance = fixtureExecutionRequest(harness);
  wrongAcceptance.trusted_bindings.current_native_acceptance = nativeAcceptance(expected, 'f'.repeat(64), {
    scope_target_digests: [retention.targetDigest(expected.target_identity), 'a'.repeat(64)]
  });
  assert.throws(() => retention.executeFixtureDisposal(wrongAcceptance),
    { code: 'RETENTION_NATIVE_APPROVAL_BINDING_INVALID' });
  const wrongAuthorization = fixtureExecutionRequest(harness);
  wrongAuthorization.target_authorization.evidence_digest = '0'.repeat(64);
  assert.throws(() => retention.executeFixtureDisposal(wrongAuthorization),
    { code: 'RETENTION_TARGET_AUTHORIZATION_BINDING_INVALID' });
  assert.equal(harness.controls.snapshot().target_present, true);
  assert.equal(harness.controls.snapshot().manifest.artifacts[0].disposal_observations, undefined,
    'eligibility alone, stale target authorization, and wrong native acceptance produce no effect history');
  const result = retention.executeFixtureDisposal(fixtureExecutionRequest(harness));

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.fixture_only, true);
  assert.equal(result.mutation_authority, false);
  assert.equal(result.receipt.ok, true);
  assert.deepEqual(harness.source, harness.sourceBefore, 'fixture effects do not rewrite the caller-owned manifest');
  const retainedArtifact = result.retained_manifest.artifacts[0];
  assert.deepEqual(retainedArtifact.evidence_reference, harness.source.artifacts[0].evidence_reference);
  assert.deepEqual(retainedArtifact.custody_reference, harness.source.artifacts[0].custody_reference);
  assert.deepEqual(retainedArtifact.consumer_readback, harness.source.artifacts[0].consumer_readback);
  assert.deepEqual(retainedArtifact.required_consumers, harness.source.artifacts[0].required_consumers);
  assert.deepEqual(retainedArtifact.disposal_observations.map((event) => event.kind), ['OPERATION', 'READBACK']);
  assert.equal(retainedArtifact.disposal_observations[0].operation_receipt.classification, 'APPLIED');
  assert.equal(retainedArtifact.disposal_observations[0].operation_receipt.target_digest,
    retention.targetDigest(expected.target_identity));
  assert.equal(retainedArtifact.disposal_observations[1].readback.state, 'ABSENT');
  const persisted = harness.controls.snapshot();
  assert.equal(persisted.target_present, false);
  assert.deepEqual(persisted.manifest.artifacts[0].disposal_observations, retainedArtifact.disposal_observations);
  assert.equal(persisted.effect_trace.filter((item) => item.kind === 'FIXTURE_TARGET_REMOVED').length, 1);
});

test('fixture TOCTOU changes after eligibility hold at the effect boundary with no target removal', () => {
  const taskRoot = path.resolve(__dirname, '../../../../');
  const evidenceDirectory = path.resolve(taskRoot, 'task59-cleanup-evidence');
  assert.equal(path.dirname(evidenceDirectory), taskRoot, 'sentinel remains directly under the task-owned evidence root');
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const retainedBytes = Buffer.from('task-owned independent retained-reference sentinel\n');
  const sentinel = path.join(evidenceDirectory, 'retention-boundary-sentinel.bin');
  if (!fs.existsSync(sentinel)) fs.writeFileSync(sentinel, retainedBytes, { flag: 'wx' });
  assert.deepEqual(fs.readFileSync(sentinel), retainedBytes, 'the preserved task-owned sentinel has its expected initial bytes');
  const sentinelDigest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const beforeBytes = fs.readFileSync(sentinel);
  const beforeDigest = sentinelDigest(beforeBytes);

  const cases = [
    {
      label: 'active consumer',
      change: (harness) => ({ kind: 'ACTIVATE_CONSUMER', consumer_id: 'late-reader' })
    },
    {
      label: 'observed identity',
      change: (harness) => ({ kind: 'CHANGE_OBSERVED_IDENTITY',
        identity: fixtureTarget(harness.expected.artifact_id, 'task-fixture-backend',
          `changed-${harness.expected.artifact_id}`, '/task59-fixture/changed') })
    },
    {
      label: 'exact expected target identity',
      change: (harness) => ({ kind: 'CHANGE_EXPECTED_TARGET_IDENTITY',
        identity: fixtureTarget(harness.expected.artifact_id, 'task-fixture-backend',
          `retargeted-${harness.expected.artifact_id}`, '/task59-fixture/retargeted') })
    }
  ];

  for (const [index, item] of cases.entries()) {
    const harness = fixtureCleanupHarness({ artifactId: `boundary-${index}` });
    harness.controls.scheduleBoundaryChange(item.change(harness));
    const result = retention.executeFixtureDisposal(fixtureExecutionRequest(harness));
    const state = harness.controls.snapshot();
    assert.equal(result.status, 'HOLD', item.label);
    assert.equal(result.operation_attempted, true, item.label);
    assert.equal(result.effect_applied, false, item.label);
    assert.ok(result.reason_codes.includes('DISPOSAL_BOUNDARY_CHANGED'), item.label);
    assert.equal(state.target_present, true, item.label);
    assert.equal(state.effect_trace.filter((entry) => entry.kind === 'FIXTURE_TARGET_REMOVED').length, 0, item.label);
    assert.equal(state.effect_trace.filter((entry) => entry.kind === 'ATTEMPT_DENIED').length, 1, item.label);
    const events = state.manifest.artifacts[0].disposal_observations;
    assert.deepEqual(events.map((event) => event.kind), ['OPERATION', 'READBACK'], item.label);
    assert.equal(events[0].operation_receipt.classification, 'DENIED_NOT_APPLIED', item.label);
    assert.equal(events[1].readback.state, 'PRESENT', item.label);
  }

  const artifactId = 'boundary-alias';
  const expected = fixtureDisposalExpected(artifactId);
  const observed = { backend_id: 'fixture-alias-backend', resource_id: 'alias-volume',
    path: `/task59-alias/${artifactId}`, mount_members: [] };
  const validResolution = aliasResolution(observed, [observed, expected.target_identity], NOW,
    [aliasEquivalencePair(expected.target_identity, observed)]);
  const harness = fixtureCleanupHarness({ artifactId, observed, targetAliasResolution: validResolution,
    observerDescriptors: [observerDescriptor('canonical-observer', expected.target_identity),
      observerDescriptor('alias-observer', observed)] });
  const changedResolution = aliasResolution(observed, [observed, expected.target_identity], NOW);
  harness.controls.scheduleBoundaryChange({ kind: 'CHANGE_TARGET_ALIAS_RESOLUTION',
    resolution: changedResolution,
    observer_descriptors: [observerDescriptor('canonical-observer', expected.target_identity),
      observerDescriptor('alias-observer', observed)] });
  const aliasResult = retention.executeFixtureDisposal(fixtureExecutionRequest(harness));
  const aliasState = harness.controls.snapshot();
  assert.equal(aliasResult.status, 'HOLD');
  assert.equal(aliasResult.effect_applied, false);
  assert.equal(aliasState.target_present, true);
  assert.equal(aliasState.effect_trace.filter((entry) => entry.kind === 'FIXTURE_TARGET_REMOVED').length, 0);
  assert.equal(aliasState.manifest.artifacts[0].disposal_observations[0].operation_receipt.classification,
    'DENIED_NOT_APPLIED');

  const afterBytes = fs.readFileSync(sentinel);
  assert.deepEqual(afterBytes, beforeBytes, 'the independent on-disk sentinel bytes remain unchanged');
  assert.equal(sentinelDigest(afterBytes), beforeDigest, 'the independent on-disk sentinel hash remains unchanged');
});

test('ambiguous fixture outcome reconciles on a successor session without replay and preserves unknown state', () => {
  const harness = fixtureCleanupHarness();
  harness.controls.scheduleAmbiguousOutcome();
  const first = retention.executeFixtureDisposal(fixtureExecutionRequest(harness));
  assert.equal(first.status, 'UNKNOWN_ABSENCE_OBSERVED');
  assert.equal(first.operation_classification, 'UNKNOWN');
  assert.equal(first.operation_attempted, true);
  const afterFirst = harness.controls.snapshot();
  assert.equal(afterFirst.target_present, false);
  assert.equal(afterFirst.effect_trace.filter((entry) => entry.kind === 'FIXTURE_TARGET_REMOVED').length, 1);

  harness.controls.setReaderOverride('UNKNOWN');
  const successor = harness.controls.newSession().backend;
  const reconciled = retention.executeFixtureDisposal(fixtureExecutionRequest(harness, {
    backend: successor,
    now: '2026-11-04T00:00:01.000Z',
    operationId: 'must-not-be-replayed'
  }));
  assert.equal(reconciled.status, 'HOLD');
  assert.equal(reconciled.operation_attempted, false);
  assert.equal(reconciled.operation_id, first.operation_id);
  assert.equal(reconciled.operation_classification, 'UNKNOWN');
  assert.equal(reconciled.observed_target_state, 'UNKNOWN');
  const final = harness.controls.snapshot();
  assert.equal(final.effect_trace.filter((entry) => entry.kind === 'FIXTURE_TARGET_REMOVED').length, 1);
  const events = final.manifest.artifacts[0].disposal_observations;
  assert.equal(events.filter((event) => event.kind === 'OPERATION').length, 1);
  assert.equal(events.filter((event) => event.kind === 'READBACK').length, 2);
  assert.equal(events.filter((event) => event.kind === 'OPERATION')[0].operation_receipt.operation_id,
    first.operation_id);
});

test('a same-target retry preserves the denied operation and appends attempt two without resetting history', () => {
  const harness = fixtureCleanupHarness({ artifactId: 'fixture-retry-copy' });
  harness.controls.scheduleBoundaryChange({ kind: 'ACTIVATE_CONSUMER', consumer_id: 'late-reader' });
  const firstResult = retention.executeFixtureDisposal(fixtureExecutionRequest(harness, {
    operationId: 'fixture-retry-1'
  }));
  assert.equal(firstResult.status, 'HOLD');
  const prior = harness.controls.snapshot().manifest.artifacts[0].disposal_observations[0].operation_receipt;
  assert.equal(prior.classification, 'DENIED_NOT_APPLIED');
  assert.equal(prior.attempt_number, 1);
  assert.equal(harness.controls.snapshot().target_present, true);

  harness.controls.applyChange({ kind: 'SET_REQUIRED_CONSUMERS', required_consumers: [
    releasedConsumer('builder', OLD), releasedConsumer('late-reader', OLD)
  ] }, NOW);
  const secondResult = retention.executeFixtureDisposal(fixtureExecutionRequest(harness, {
    operationId: 'fixture-retry-2',
    priorNonapplication: trustedPriorNonapplication(prior)
  }));
  assert.equal(secondResult.status, 'COMPLETED');
  assert.equal(secondResult.receipt.ok, true);
  const events = secondResult.retained_manifest.artifacts[0].disposal_observations;
  const operations = events.filter((event) => event.kind === 'OPERATION').map((event) => event.operation_receipt);
  assert.deepEqual(operations.map((operation) => [operation.operation_id, operation.attempt_number,
    operation.classification, operation.retry_of_operation_id]), [
    ['fixture-retry-1', 1, 'DENIED_NOT_APPLIED', null],
    ['fixture-retry-2', 2, 'APPLIED', 'fixture-retry-1']
  ]);
  assert.equal(events.filter((event) => event.kind === 'READBACK').length, 2);
  assert.equal(harness.source.artifacts[0].disposal_observations, undefined,
    'the caller-owned input history remains unchanged');
  const state = harness.controls.snapshot();
  assert.equal(state.target_present, false);
  assert.equal(state.effect_trace.filter((entry) => entry.kind === 'ATTEMPT_DENIED').length, 1);
  assert.equal(state.effect_trace.filter((entry) => entry.kind === 'FIXTURE_TARGET_REMOVED').length, 1);
});

test('in-memory successor rechecks consumers, owner, and retained references before resuming', () => {
  const consumerHarness = fixtureCleanupHarness({ artifactId: 'crash-active-consumer' });
  const beforeCrash = consumerHarness.controls.snapshot();
  assert.equal(decisionFor(retention.planRetention(beforeCrash.manifest, { now: NOW, fixture_clock: true }), 'crash-active-consumer').disposition,
    'ELIGIBLE_NOW', 'private custody and consumer readback are already retained before the producer crash');
  consumerHarness.controls.applyChange({ kind: 'ACTIVATE_CONSUMER', consumer_id: 'restarted-consumer' }, NOW);
  const consumerSuccessor = consumerHarness.controls.newSession().backend;
  const consumerResult = retention.executeFixtureDisposal(fixtureExecutionRequest(consumerHarness, {
    backend: consumerSuccessor
  }));
  assert.equal(consumerResult.status, 'HOLD');
  assert.ok(consumerResult.reason_codes.includes(retention.HOLD.CONSUMER_ACTIVE));
  assert.equal(consumerResult.operation_attempted, false);
  assert.equal(consumerHarness.controls.snapshot().target_present, true);
  assert.equal(consumerHarness.controls.snapshot().effect_trace.filter((item) => item.kind === 'FIXTURE_TARGET_REMOVED').length, 0);

  const referenceHarness = fixtureCleanupHarness({ artifactId: 'crash-reference-recheck' });
  const expected = referenceHarness.expected;
  const originalBoundary = referenceHarness.backend.readBoundary(expected);
  const staleAuthorization = fixtureTargetAuthorization(originalBoundary.manifest, expected, NOW);
  const evidenceId = 'successor-verified-evidence';
  const custodyId = 'successor-verified-custody';
  const custodyCore = { evidence_id: evidenceId, custody_id: custodyId, retention_status: 'HELD' };
  const successorReadback = readback('successor-reader', evidenceId, custodyId, CONTENT, OLD);
  referenceHarness.controls.applyChange({
    kind: 'CHANGE_RETAINED_REFERENCES',
    evidence_reference: { evidence_id: evidenceId, content_digest: CONTENT },
    custody_reference: { ...custodyCore, custody_digest: digestValue(custodyCore) },
    consumer_readback: successorReadback
  }, NOW);
  referenceHarness.controls.applyChange({ kind: 'CHANGE_OWNER', owner_id: 'successor-run' }, NOW);

  const successor = referenceHarness.controls.newSession().backend;
  assert.throws(() => retention.executeFixtureDisposal(fixtureExecutionRequest(referenceHarness, {
    backend: successor,
    targetAuthorization: staleAuthorization,
    operationId: 'stale-producer-authorization'
  })), { code: 'RETENTION_TARGET_AUTHORIZATION_BINDING_INVALID' });
  assert.equal(referenceHarness.controls.snapshot().target_present, true);
  assert.equal(referenceHarness.controls.snapshot().effect_trace.filter((item) => item.kind === 'FIXTURE_TARGET_REMOVED').length, 0);
  assert.equal(referenceHarness.controls.snapshot().manifest.artifacts[0].disposal_observations, undefined,
    'a stale producer authorization adds no operation history');

  const resumed = retention.executeFixtureDisposal(fixtureExecutionRequest(referenceHarness, {
    backend: successor,
    operationId: 'successor-revalidated-operation'
  }));
  assert.equal(resumed.status, 'COMPLETED');
  assert.equal(resumed.operation_attempted, true);
  assert.equal(resumed.retained_manifest.artifacts[0].evidence_reference.evidence_id, evidenceId);
  assert.equal(resumed.retained_manifest.artifacts[0].custody_reference.custody_id, custodyId);
  assert.equal(resumed.retained_manifest.artifacts[0].ownership.owner_id, 'successor-run');
  assert.equal(resumed.retained_manifest.artifacts[0].disposal_observations[0].operation_receipt.operation_id,
    'successor-revalidated-operation');
});

test('separate producer and successor processes recover only from exact persisted retained state', () => {
  const taskRoot = path.resolve(__dirname, '../../../../');
  const evidenceRoot = path.resolve(taskRoot, 'task59-cleanup-evidence');
  const processEvidence = path.resolve(evidenceRoot, 'producer-crash-recovery');
  assert.equal(path.dirname(processEvidence), evidenceRoot);
  fs.mkdirSync(processEvidence, { recursive: true });
  const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const writeState = (fileName, state) => {
    const filePath = path.join(processEvidence, fileName);
    const bytes = Buffer.from(JSON.stringify(state));
    fs.writeFileSync(filePath, bytes);
    assert.deepEqual(fs.readFileSync(filePath), bytes, 'parent verifies fixture-state writeback');
    return { filePath, bytes };
  };
  const persistProducerCrash = (stateFileName, stateBytes) => {
    const statePath = path.join(processEvidence, stateFileName);
    const child = spawnSync(process.execPath, ['-e', PRODUCER_CRASH_SCRIPT, statePath,
      stateBytes.toString('base64'), processEvidence], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 73, 'producer exits with the deliberate pre-disposal crash status');
    const report = JSON.parse(child.stdout);
    assert.notEqual(report.pid, process.pid, 'producer PID belongs to an actual child process');
    assert.equal(report.persisted_bytes, stateBytes.length);
    assert.equal(report.persisted_sha256, sha256(stateBytes));
    assert.deepEqual(fs.readFileSync(statePath), stateBytes, 'parent independently reads exact producer bytes');
    const exitEvidence = { schema: 'task59.cleanup.producer-exit-evidence.v1', pid: report.pid,
      exit_status: child.status, signal: child.signal, state_sha256: report.persisted_sha256 };
    const exitEvidencePath = `${statePath}.exit-evidence.json`;
    const exitEvidenceBytes = Buffer.from(JSON.stringify(exitEvidence));
    fs.writeFileSync(exitEvidencePath, exitEvidenceBytes);
    assert.deepEqual(fs.readFileSync(exitEvidencePath), exitEvidenceBytes, 'parent persists and verifies observed producer PID/status');
    return { child, report, statePath, exitEvidencePath, exitEvidence };
  };
  const runSuccessor = (statePath, resultFileName, scenario, expectedStateBytes) => {
    const resultPath = path.join(processEvidence, resultFileName);
    const child = spawnSync(process.execPath, ['-e', SUCCESSOR_RECOVERY_SCRIPT, statePath, resultPath,
      processEvidence, path.resolve(__dirname, '../scripts/toolkit-custody-retention-v3.cjs'),
      path.resolve(__dirname, '../scripts/toolkit-github-program-receipt.cjs'), scenario],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
    const processReport = JSON.parse(child.stdout);
    assert.notEqual(processReport.pid, process.pid, 'successor PID belongs to a new child process');
    assert.equal(processReport.result_readback_exact, true);
    assert.equal(processReport.source_readback_exact, true);
    const stateBytesAfter = fs.readFileSync(statePath);
    assert.deepEqual(stateBytesAfter, expectedStateBytes, 'successor does not rewrite its producer state');
    const resultBytes = fs.readFileSync(resultPath);
    assert.equal(sha256(resultBytes), processReport.result_sha256);
    const result = JSON.parse(resultBytes.toString('utf8'));
    assert.equal(result.consumer_pid, processReport.pid);
    assert.equal(result.input_sha256, sha256(expectedStateBytes));
    assert.equal(result.input_bytes, expectedStateBytes.length);
    const exitEvidence = { schema: 'task59.cleanup.successor-exit-evidence.v1', scenario,
      pid: processReport.pid, exit_status: child.status, signal: child.signal,
      result_sha256: processReport.result_sha256 };
    const exitEvidencePath = `${resultPath}.process-status.json`;
    const exitEvidenceBytes = Buffer.from(JSON.stringify(exitEvidence));
    fs.writeFileSync(exitEvidencePath, exitEvidenceBytes);
    assert.deepEqual(fs.readFileSync(exitEvidencePath), exitEvidenceBytes, 'parent persists and verifies successor PID/status');
    return { child, processReport, resultPath, result, exitEvidencePath, exitEvidence };
  };
  const makeState = (expected, retainedManifest, targetPresent) => ({
    schema: 'task59.cleanup.producer-crash-state.v1',
    now: NOW,
    expected,
    manifest: structuredClone(retainedManifest),
    target_present: targetPresent,
    producer_authorization: fixtureTargetAuthorization(retainedManifest, expected, NOW)
  });

  const initialExpected = fixtureDisposalExpected('separate-process-copy');
  const initialManifest = fixtureCleanupSource(initialExpected);
  const initialState = makeState(initialExpected, initialManifest, true);
  assert.equal(decisionFor(retention.planRetention(initialManifest, { now: NOW, fixture_clock: true }), initialExpected.artifact_id).disposition,
    'ELIGIBLE_NOW', 'private custody and consumer readback were retained before producer exit');
  const initialJson = Buffer.from(JSON.stringify(initialState));
  const producer = persistProducerCrash('producer-state.json', initialJson);
  assert.equal(producer.report.target_present, true);
  assert.equal(producer.report.operation_count, 0, 'producer exits before fixture disposal');
  const success = runSuccessor(producer.statePath, 'successor-result.json', 'process-success', initialJson);
  assert.equal(success.processReport.outcome_status, 'COMPLETED');
  assert.equal(success.processReport.target_present, false);
  assert.equal(success.processReport.operation_count, 1);
  assert.equal(success.processReport.readback_count, 1);
  assert.equal(success.result.producer_authorization_matches_current, true);
  assert.equal(success.result.final_state.manifest.artifacts[0].disposal_observations[0].operation_receipt.executor_id,
    'separate-successor-process');
  assert.equal(success.result.final_state.manifest.artifacts[0].evidence_reference.evidence_id,
    initialManifest.artifacts[0].evidence_reference.evidence_id);
  assert.equal(success.result.final_state.manifest.artifacts[0].custody_reference.custody_id,
    initialManifest.artifacts[0].custody_reference.custody_id);

  const activeState = structuredClone(initialState);
  activeState.manifest.artifacts[0].required_consumers.push({ consumer_id: 'restored-active-consumer', state: 'ACTIVE' });
  const activeInput = writeState('restored-active-consumer-state.json', activeState);
  const active = runSuccessor(activeInput.filePath, 'restored-active-consumer-result.json',
    'restored-active-consumer', activeInput.bytes);
  assert.equal(active.result.outcome.status, 'HOLD');
  assert.ok(active.result.outcome.reason_codes.includes(retention.HOLD.CONSUMER_ACTIVE));
  assert.equal(active.result.outcome.operation_attempted, false);
  assert.equal(active.result.final_state.target_present, true);
  assert.equal(active.result.operation_count, 0);

  const staleReferenceState = structuredClone(initialState);
  const staleReferenceArtifact = staleReferenceState.manifest.artifacts[0];
  const newEvidenceId = 'process-successor-evidence';
  const newCustodyId = 'process-successor-custody';
  const newCustodyCore = { evidence_id: newEvidenceId, custody_id: newCustodyId, retention_status: 'HELD' };
  staleReferenceArtifact.evidence_reference = { evidence_id: newEvidenceId, content_digest: CONTENT };
  staleReferenceArtifact.custody_reference = { ...newCustodyCore, custody_digest: digestValue(newCustodyCore) };
  staleReferenceArtifact.consumer_readback = readback('process-successor-reader', newEvidenceId, newCustodyId, CONTENT, OLD);
  const staleReferenceInput = writeState('restored-stale-reference-state.json', staleReferenceState);
  const staleReference = runSuccessor(staleReferenceInput.filePath, 'restored-stale-reference-result.json',
    'restored-stale-reference', staleReferenceInput.bytes);
  assert.equal(staleReference.result.producer_authorization_matches_current, false);
  assert.equal(staleReference.result.outcome.status, 'HOLD');
  assert.ok(staleReference.result.outcome.reason_codes.includes('RETENTION_TARGET_AUTHORIZATION_BINDING_INVALID'));
  assert.equal(staleReference.result.final_state.target_present, true);
  assert.equal(staleReference.result.operation_count, 0);

  const staleOwnerState = structuredClone(initialState);
  staleOwnerState.manifest.artifacts[0].ownership = ownership(initialExpected.artifact_id,
    initialExpected.target_identity, 'process-successor-owner', NOW);
  const staleOwnerInput = writeState('restored-stale-owner-state.json', staleOwnerState);
  const staleOwner = runSuccessor(staleOwnerInput.filePath, 'restored-stale-owner-result.json',
    'restored-stale-owner', staleOwnerInput.bytes);
  assert.equal(staleOwner.result.producer_authorization_matches_current, false);
  assert.equal(staleOwner.result.outcome.status, 'HOLD');
  assert.ok(staleOwner.result.outcome.reason_codes.includes('RETENTION_TARGET_AUTHORIZATION_BINDING_INVALID'));
  assert.equal(staleOwner.result.final_state.target_present, true);
  assert.equal(staleOwner.result.operation_count, 0);

  const retryHarness = fixtureCleanupHarness({ artifactId: 'separate-process-retry' });
  retryHarness.controls.scheduleBoundaryChange({ kind: 'ACTIVATE_CONSUMER', consumer_id: 'crash-retry-consumer' });
  const initialDenial = retention.executeFixtureDisposal(fixtureExecutionRequest(retryHarness, {
    operationId: 'process-denied-attempt-one'
  }));
  assert.equal(initialDenial.status, 'HOLD');
  retryHarness.controls.applyChange({ kind: 'SET_REQUIRED_CONSUMERS', required_consumers: [
    releasedConsumer('builder', OLD), releasedConsumer('crash-retry-consumer', OLD)
  ] }, NOW);
  const retryState = makeState(retryHarness.expected, retryHarness.controls.snapshot().manifest, true);
  const retryJson = Buffer.from(JSON.stringify(retryState));
  const retryProducer = persistProducerCrash('producer-denied-history-state.json', retryJson);
  assert.equal(retryProducer.report.operation_count, 1);
  const restoredRetry = runSuccessor(retryProducer.statePath, 'successor-retry-result.json', 'restored-retry', retryJson);
  assert.equal(restoredRetry.processReport.outcome_status, 'COMPLETED');
  assert.deepEqual(restoredRetry.processReport.attempt_numbers, [1, 2]);
  assert.deepEqual(restoredRetry.processReport.operation_classifications, ['DENIED_NOT_APPLIED', 'APPLIED']);
  assert.equal(restoredRetry.processReport.operation_count, 2);
  assert.equal(restoredRetry.processReport.readback_count, 2);

  const unknownHarness = fixtureCleanupHarness({ artifactId: 'separate-process-unknown' });
  unknownHarness.controls.scheduleAmbiguousOutcome();
  const unknownInitial = retention.executeFixtureDisposal(fixtureExecutionRequest(unknownHarness, {
    operationId: 'process-unknown-outcome'
  }));
  assert.equal(unknownInitial.operation_classification, 'UNKNOWN');
  const unknownState = makeState(unknownHarness.expected, unknownHarness.controls.snapshot().manifest, false);
  const unknownJson = Buffer.from(JSON.stringify(unknownState));
  const unknownProducer = persistProducerCrash('producer-unknown-history-state.json', unknownJson);
  assert.equal(unknownProducer.report.operation_count, 1);
  const restoredUnknown = runSuccessor(unknownProducer.statePath, 'successor-unknown-result.json',
    'restored-unknown', unknownJson);
  assert.equal(restoredUnknown.processReport.outcome_status, 'HOLD');
  assert.equal(restoredUnknown.processReport.operation_count, 1, 'unknown operation is reconciled without replay');
  assert.equal(restoredUnknown.processReport.readback_count, 2);
  assert.deepEqual(restoredUnknown.processReport.operation_classifications, ['UNKNOWN']);
  assert.equal(restoredUnknown.result.outcome.operation_attempted, false);
  assert.equal(restoredUnknown.result.outcome.operation_classification, 'UNKNOWN');
  assert.equal(restoredUnknown.result.outcome.observed_target_state, 'UNKNOWN');
  assert.equal(restoredUnknown.result.final_state.target_present, false);
});
