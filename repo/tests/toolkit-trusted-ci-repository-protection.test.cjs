'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtime = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection.cjs'));
const capabilityRegistry = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-capability-registry.cjs'));
const workflow = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection-workflow.cjs'));
const publisher = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'fixtures', 'publisher.n6.json'), 'utf8'));
const effectiveFixture = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'fixtures', 'effective-protection.n6.json'), 'utf8'));
const contractSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'trusted-ci-repository-protection-contract.schema.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'trusted-ci-repository-protection-policy.json'), 'utf8'));
const publisherProtocol = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'app-publisher-protocol.json'), 'utf8'));
const workflowContract = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'protected-ci-gate-workflow-contract.json'), 'utf8'));
const workflowTemplatePath = path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'templates', 'protected-ci-gate.workflow.yml');

const SHAS = {
  head: 'a'.repeat(40),
  base: 'b'.repeat(40),
  merge: 'c'.repeat(40),
  workflow: 'd'.repeat(40),
};
const REPOSITORY_ID = 'a'.repeat(64);
const effective = { ...effectiveFixture, repository_id: REPOSITORY_ID };
const CHANGED_PATHS = [
  '_projects/cicd/trusted-ci-repository-protection/_main/trusted-ci-repository-protection-policy.json',
  'repo/scripts/toolkit-trusted-ci-repository-protection.cjs',
  'repo/tests/toolkit-trusted-ci-repository-protection.test.cjs',
];

function digest(value) {
  return crypto.createHash('sha256').update(capabilityRegistry.canonicalSerialize(value), 'utf8').digest('hex');
}

function consent({ repositoryId = REPOSITORY_ID, state = 'enabled', decisionKind = 'enable' } = {}) {
  const scopeDigest = capabilityRegistry.capabilityScopeDigest(repositoryId, 'repository.protection', 'enable', 'capability-route');
  const receipt = {
    receipt_id: '',
    repository_id: repositoryId,
    capability_id: 'repository.protection',
    prior_state: 'unresolved',
    resulting_state: 'enabled',
    decision_kind: 'enable',
    provenance_category: 'explicit-owner',
    provenance_channel: 'capability-route',
    scope_digest: scopeDigest,
    registry_schema: capabilityRegistry.REGISTRY_SCHEMA,
    identity_contract: capabilityRegistry.IDENTITY_CONTRACT,
    capability_contract: capabilityRegistry.CAPABILITY_CONTRACT,
    contract_digest: capabilityRegistry.CONTRACT_DIGEST,
    registry_revision: 1,
    outcome: 'committed',
    decided_at: '2026-08-23T00:00:00.000Z',
  };
  receipt.receipt_id = digest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receipt_id')));
  return {
    capability_id: 'repository.protection',
    state,
    decision_kind: decisionKind,
    provenance: { category: 'explicit-owner', channel: 'capability-route', scope_digest: scopeDigest },
    receipt,
  };
}

function componentResults(manifest, overrides = {}) {
  return manifest.required_components.map((id) => ({
    id,
    status: 'success',
    conclusion: 'success',
    mandatory: true,
    producer: 'protected-ci-gate',
    dependency_setup: true,
    artifact_digest: 'f'.repeat(64),
    ...overrides[id],
  }));
}

function evidenceFor(manifest, overrides = {}) {
  const evidence = {
    schema: runtime.EVIDENCE_SCHEMA,
    repository_id: REPOSITORY_ID,
    pr: 194,
    head_sha: SHAS.head,
    base_sha: SHAS.base,
    merge_sha: SHAS.merge,
    protected_workflow: {
      identity: workflow.WORKFLOW_ID,
      source_sha: SHAS.workflow,
    },
    run: { id: 'run-194', attempt: 1 },
    generation: 1,
    contract_version: runtime.CONTRACT_VERSION,
    contract_digest: '1'.repeat(64),
    component_results: componentResults(manifest).map(({ dependency_setup, ...component }) => ({
      ...component,
      producer: {
        workflow_identity: workflow.WORKFLOW_ID,
        workflow_source_sha: SHAS.workflow,
        run_id: 'run-194',
        attempt: 1,
        generation: 1,
      },
    })),
    conclusion: 'success',
    timestamps: {
      started_at: '2026-08-23T00:00:00.000Z',
      completed_at: '2026-08-23T00:01:00.000Z',
    },
    evidence_digest: '',
    ...overrides,
  };
  evidence.evidence_digest = runtime.evidenceDigest(evidence);
  return evidence;
}

function validGateInput(overrides = {}) {
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  assert.equal(manifest.ok, true);
  const evidence = evidenceFor(manifest);
  return {
    workflow: {
      source: workflow.buildProtectedWorkflowTemplate(),
      source_sha: SHAS.workflow,
      base_ref: workflow.BASE_REF,
      candidate_owned: false,
      workflow_identity: workflow.WORKFLOW_ID,
    },
    repository_id: REPOSITORY_ID,
    pr: 194,
    head_sha: SHAS.head,
    base_sha: SHAS.base,
    merge_sha: SHAS.merge,
    changed_paths: CHANGED_PATHS,
    component_results: componentResults(manifest),
    evidence,
    evidence_archive: [{ path: 'ci/evidence.json', kind: 'file', bytes: '{}' }],
    non_ci_evidence: [],
    ...overrides,
  };
}

test('N6 source contracts remain aligned with the dependency-free runtimes', () => {
  assert.equal(contractSchema.$id, runtime.CONTRACT_VERSION);
  assert.equal(contractSchema.properties.evidence.properties.schema.const, runtime.EVIDENCE_SCHEMA);
  assert.equal(policy.contract_version, runtime.CONTRACT_VERSION);
  assert.deepEqual(policy.modes, runtime.MODES);
  assert.deepEqual(policy.publisher.permissions, publisher.permissions);
  assert.equal(publisherProtocol.protocol_version, runtime.PUBLISHER_PROTOCOL_VERSION);
  assert.equal(workflow.validateWorkflowContract(workflowContract).ok, true);
});

test('protected workflow source is exact, base-owned, and source-only', () => {
  const source = fs.readFileSync(workflowTemplatePath, 'utf8');
  assert.equal(source, workflow.buildProtectedWorkflowTemplate());
  const result = workflow.validateProtectedWorkflow({
    source,
    source_sha: SHAS.workflow,
    base_ref: workflow.BASE_REF,
    candidate_owned: false,
    workflow_identity: workflow.WORKFLOW_ID,
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate_owned, false);
  assert.deepEqual(result.triggers, ['pull_request_target', 'merge_group']);
});

test('protected workflow rejects candidate checkout, forbidden triggers, and write permissions', () => {
  const source = workflow.buildProtectedWorkflowTemplate();
  assert.equal(workflow.validateWorkflowSource(source.replace('pull_request_target:', 'pull_request:')).code, 'WORKFLOW_TRIGGER_FORBIDDEN');
  assert.equal(workflow.validateWorkflowSource(source.replace('github.event.repository.default_branch', 'github.event.pull_request.head.sha')).code, 'WORKFLOW_CANDIDATE_CODE');
  assert.equal(workflow.validateWorkflowSource(source.replace('checks: read', 'checks: write')).code, 'WORKFLOW_PERMISSION_FORBIDDEN');
  assert.equal(workflow.validateProtectedWorkflow({ source, candidate_owned: true }).code, 'WORKFLOW_SOURCE_UNTRUSTED');
});

test('composition is derived from protected path classes and rejects candidate coverage claims', () => {
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  assert.equal(manifest.ok, true);
  assert.deepEqual(manifest.required_components, ['project-sync', 'fallback-risk-audit', 'toolkit-validator', 'repository-tests', 'git-diff-check']);
  assert.equal(manifest.components.some((component) => component.applicability === 'required' && component.id === 'git-diff-check'), true);
  assert.equal(runtime.compositionManifest(['unknown/path.bin']).code, 'UNKNOWN_RELEVANT_PATH');
  const results = componentResults(manifest, { 'project-sync': { producer: 'candidate' } });
  assert.equal(runtime.validateOwningCICoverage({ changed_paths: CHANGED_PATHS, manifest, component_results: results }).code, 'PRODUCER_MISMATCH');
});

test('evidence binds every identity dimension and requires protected component success', () => {
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  const evidence = evidenceFor(manifest);
  const expected = {
    repository_id: REPOSITORY_ID,
    pr: 194,
    head_sha: SHAS.head,
    base_sha: SHAS.base,
    merge_sha: SHAS.merge,
    protected_workflow_identity: workflow.WORKFLOW_ID,
    protected_workflow_source_sha: SHAS.workflow,
    component_ids: manifest.required_components,
    required_component_ids: manifest.required_components,
    producer: {
      workflow_identity: workflow.WORKFLOW_ID,
      workflow_source_sha: SHAS.workflow,
      run_id: 'run-194',
      attempt: 1,
      generation: 1,
    },
  };
  assert.equal(runtime.validateEvidence(evidence, expected).ok, true);
  assert.equal(runtime.validateEvidence({ ...evidence, head_sha: '9'.repeat(40) }, expected).code, 'HEAD_MOVED');
  const incomplete = { ...evidence, component_results: evidence.component_results.map((item, index) => index === 0 ? { ...item, status: 'skipped', conclusion: 'not-applicable' } : item) };
  incomplete.evidence_digest = runtime.evidenceDigest(incomplete);
  assert.equal(runtime.validateEvidence(incomplete, expected).code, 'COMPONENT_SKIPPED');
});

test('archive, publisher, and gate identity boundaries fail closed', () => {
  assert.equal(runtime.validateEvidenceArchive([{ path: '../secret.txt', kind: 'file', bytes: 'x' }]).code, 'ARCHIVE_INVALID');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'a.txt', kind: 'file', bytes: 'x' }, { path: 'a.txt', kind: 'file', bytes: 'y' }]).code, 'ARCHIVE_INVALID');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'a.txt', kind: 'symlink', bytes: 'x' }]).code, 'ARCHIVE_INVALID');
  assert.equal(runtime.validatePublisher(publisher).ok, true);
  assert.equal(runtime.validatePublisher({ ...publisher, permissions: { ...publisher.permissions, statuses: 'write' } }).code, 'COMMIT_STATUS_FORBIDDEN');
  assert.equal(runtime.validatePublisher({ ...publisher, integration_id: 'github-actions' }).code, 'PRODUCER_MISMATCH');
  const identity = runtime.checkRunIdentity({
    repository_id: REPOSITORY_ID,
    pr: 194,
    head_sha: SHAS.head,
    base_sha: SHAS.base,
    merge_sha: SHAS.merge,
    protected_workflow_identity: workflow.WORKFLOW_ID,
    protected_workflow_source_sha: SHAS.workflow,
    contract_digest: '1'.repeat(64),
    attempt: 1,
    generation: 1,
  });
  assert.equal(identity.context, 'CI Gate');
  assert.match(identity.external_id, /^n6-ci-gate-v1:[a-f0-9]{64}$/);
});

test('gate state transitions distinguish duplicate, stale, superseded, and uncertain publication', () => {
  const identity = {
    repository_id: REPOSITORY_ID,
    pr: 194,
    head_sha: SHAS.head,
    base_sha: SHAS.base,
    merge_sha: SHAS.merge,
    protected_workflow_identity: workflow.WORKFLOW_ID,
    protected_workflow_source_sha: SHAS.workflow,
    contract_digest: '1'.repeat(64),
    attempt: 1,
    generation: 1,
  };
  const initial = runtime.initialGateState(identity);
  assert.equal(initial.state, 'queued');
  const collecting = runtime.transitionGateState(initial, 'collect');
  const verifying = runtime.transitionGateState(collecting, 'verify');
  assert.equal(runtime.transitionGateState(verifying, 'duplicate').code, 'EVIDENCE_DUPLICATE');
  assert.equal(runtime.transitionGateState(verifying, 'stale').state, 'stale');
  const pending = runtime.transitionGateState(verifying, 'publish');
  assert.equal(pending.state, 'publish-pending');
  assert.equal(runtime.transitionGateState(pending, 'uncertain').state, 'ambiguous');
  assert.equal(runtime.transitionGateState(verifying, 'publish', { identity: { ...identity, head_sha: '9'.repeat(40) }, movement: 'head' }).code, 'HEAD_MOVED');
});

test('protection consent, ownership, projections, and preview-only plans remain bounded', () => {
  const publisherResult = runtime.validatePublisher(publisher);
  assert.equal(publisherResult.ok, true);
  const desired = runtime.desiredProtectionProjection({ repository_id: REPOSITORY_ID, default_branch: 'main', integration_id: publisher.integration_id });
  assert.equal(desired.ok, true);
  assert.equal(runtime.validateDesiredProtectionProjection(desired.projection).ok, true);
  assert.equal(runtime.validateDesiredProtectionProjection({ ...desired.projection, fingerprint: '0'.repeat(64) }).code, 'IDENTITY_MISMATCH');
  assert.equal(runtime.validateProtectionConsent({ capability_id: 'repository.protection', state: 'unresolved' }, REPOSITORY_ID).code, 'CONSENT_MISSING');
  assert.equal(runtime.validateProtectionConsent(consent({ repositoryId: 'b'.repeat(64) }), REPOSITORY_ID).code, 'IDENTITY_MISMATCH');
  assert.equal(runtime.readProtectionConsent({ repository_id: REPOSITORY_ID, registry_revision: 1, capabilities: { 'repository.protection': consent() } }, REPOSITORY_ID).ok, true);
  const tamperedConsent = consent();
  tamperedConsent.receipt.receipt_id = '0'.repeat(64);
  assert.equal(runtime.validateProtectionConsent(tamperedConsent, REPOSITORY_ID).code, 'CONSENT_MISSING');

  const noop = runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    default_branch: 'main',
    consent: consent(),
    publisher,
    effective,
  });
  assert.equal(noop.ok, true);
  assert.equal(noop.code, 'NOOP');
  const absent = runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    consent: consent(),
    publisher,
    effective: { ...effective, rulesets: [] },
  });
  assert.equal(absent.status, 'PLAN');
  assert.equal(absent.action, 'create-ruleset');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    consent: consent(),
    publisher,
    effective: { ...effective, rulesets: [] },
    phase: 'apply-plan',
  }).code, 'LIVE_MUTATION_FORBIDDEN');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    consent: consent(),
    publisher,
    effective: {
      ...effective,
      rulesets: [{ ...effective.rulesets[0], id: 'owner-rule', name: 'Owner Rule', owner_class: 'unknown', required_contexts: [] }],
    },
  }).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    consent: consent(),
    publisher,
    effective: {
      ...effective,
      rulesets: [{ ...effective.rulesets[0], owner_class: 'owner-managed' }],
    },
  }).code, 'OWNERSHIP_AMBIGUOUS');
  const ownerManaged = runtime.classifyProtectionOwnership({ rulesets: [{ ...effective.rulesets[0], owner_class: 'owner-managed' }] }, desired.projection);
  assert.equal(ownerManaged.code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.classifyProtectionOwnership({ rulesets: [{ ...effective.rulesets[0], owner_class: 'foreign-managed' }] }, desired.projection).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.classifyProtectionOwnership({ rulesets: [effective.rulesets[0], { ...effective.rulesets[0], name: 'duplicate' }] }, desired.projection).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.validateProtectionConsent({ capability_id: 'repository.protection', state: 'enabled' }, REPOSITORY_ID).code, 'CONSENT_MISSING');
  assert.equal(runtime.classifyProtectionOwnership({ rulesets: [{ name: 'protect-main', source: 'unknown' }] }).code, 'OWNERSHIP_AMBIGUOUS');
});

test('workflow gate validation composes protected workflow, coverage, and evidence without execution', () => {
  const result = workflow.validateGateInvocation(validGateInput());
  assert.equal(result.ok, true);
  assert.equal(result.workflow.identity, workflow.WORKFLOW_ID);
  assert.equal(result.composition.schema, 'toolkit.n6.ci-composition.v1');
  assert.equal(result.evidence.run.id, 'run-194');
  const blocked = workflow.validateGateInvocation(validGateInput({ non_ci_evidence: ['unlisted-provider-uat'] }));
  assert.equal(blocked.code, 'WORKFLOW_COVERAGE_INVALID');
});

test('fake publisher is deterministic and idempotent for one Check Run external id', () => {
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  const evidence = evidenceFor(manifest);
  const fake = runtime.createFakePublisher({ expected: { publisher }, evidence_expected: { component_ids: manifest.required_components, required_component_ids: manifest.required_components } });
  const first = fake.publish(evidence, { publisher });
  assert.equal(first.ok, true);
  const second = fake.publish(evidence, { publisher });
  assert.equal(second.ok, true);
  assert.deepEqual(fake.read(first.publication.external_id), first.publication);
});
