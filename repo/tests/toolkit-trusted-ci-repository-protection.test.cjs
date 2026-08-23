'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
const REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';
const REPOSITORY_ID = capabilityRegistry.repositoryIdForCanonicalRemote(REMOTE);
const effective = { ...effectiveFixture, repository_id: REPOSITORY_ID };
const CHANGED_PATHS = [
  '_projects/cicd/trusted-ci-repository-protection/_main/trusted-ci-repository-protection-policy.json',
  'repo/scripts/toolkit-trusted-ci-repository-protection.cjs',
  'repo/tests/toolkit-trusted-ci-repository-protection.test.cjs',
];

function digest(value) {
  return crypto.createHash('sha256').update(capabilityRegistry.canonicalSerialize(value), 'utf8').digest('hex');
}

function git(repo, args) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function protectionRegistry(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n6-protection-'));
  const repo = path.join(root, 'repo');
  const registryPath = path.join(root, 'state', 'repository-governance.v1.json');
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--quiet', repo]);
  git(repo, ['remote', 'add', 'origin', REMOTE]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { cwd: repo, registryPath, testOnly: true };
  const current = capabilityRegistry.getRepositoryStatus(options);
  capabilityRegistry.writeCapabilityDecision({
    ...options,
    capabilityId: 'repository.protection',
    operation: 'enable',
    ownerAction: {
      confirmed: true,
      category: 'explicit-owner',
      channel: 'capability-route',
      operation: 'enable',
      choice_semantic_id: capabilityRegistry.capabilityDecisionSemanticId('repository.protection', 'enable'),
      contract_digest: capabilityRegistry.CONTRACT_DIGEST,
      scope_digest: capabilityRegistry.capabilityScopeDigest(REPOSITORY_ID, 'repository.protection', 'enable', 'capability-route'),
    },
    expectedRevision: current.registry_revision,
    expectedHash: current.snapshot_hash,
  });
  return options;
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
    evidence_archive: [{ path: 'ci/evidence.json', kind: 'file', bytes: JSON.stringify(evidence) }],
    non_ci_evidence: [],
    ...overrides,
  };
}

function validCliInput(overrides = {}) {
  const gate = validGateInput();
  const protectedSourceSha = workflow.workflowIdentity(workflow.buildProtectedWorkflowTemplate()).source_sha;
  gate.evidence.protected_workflow.source_sha = protectedSourceSha;
  gate.evidence.component_results = gate.evidence.component_results.map((component) => ({
    ...component,
    producer: { ...component.producer, workflow_source_sha: protectedSourceSha },
  }));
  gate.evidence.evidence_digest = runtime.evidenceDigest(gate.evidence);
  return {
    repository_id: gate.repository_id,
    pr: gate.pr,
    head_sha: gate.head_sha,
    base_sha: gate.base_sha,
    merge_sha: gate.merge_sha,
    changed_paths: gate.changed_paths,
    component_results: gate.component_results,
    evidence: gate.evidence,
    evidence_archive: [{ path: 'ci/evidence.json', kind: 'file', bytes: JSON.stringify(gate.evidence) }],
    non_ci_evidence: gate.non_ci_evidence,
    ...overrides,
  };
}

function runWorkflowCli(argument, input) {
  return childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection-workflow.cjs'), argument], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    windowsHide: true,
  });
}

test('N6 source contracts remain aligned with the dependency-free runtimes', () => {
  assert.equal(contractSchema.$id, runtime.CONTRACT_VERSION);
  assert.equal(contractSchema.properties.evidence.properties.schema.const, runtime.EVIDENCE_SCHEMA);
  assert.equal(policy.contract_version, runtime.CONTRACT_VERSION);
  assert.deepEqual(policy.modes, runtime.MODES);
  assert.deepEqual(policy.publisher.permissions, publisher.permissions);
  assert.deepEqual(policy.publisher.operations, publisher.operations);
  assert.equal(publisherProtocol.protocol_version, runtime.PUBLISHER_PROTOCOL_VERSION);
  assert.deepEqual(publisherProtocol.permissions, publisher.permissions);
  assert.deepEqual(publisherProtocol.operations, publisher.operations);
  assert.equal(publisherProtocol.publication.commit_status, false);
  assert.equal(publisherProtocol.forbidden.includes('commit_status_publication'), true);
  assert.equal(contractSchema.properties.publisher.properties.permissions.const.statuses, 'write');
  assert.equal(contractSchema.properties.publisher.properties.operations.const.commit_status_publication, false);
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
  assert.equal(runtime.validatePublisher({ ...publisher, permissions: { ...publisher.permissions, statuses: 'none' } }).code, 'PUBLISHER_FORBIDDEN_PERMISSION');
  assert.equal(runtime.validatePublisher({ ...publisher, operations: { ...publisher.operations, commit_status_publication: true } }).code, 'COMMIT_STATUS_FORBIDDEN');
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
  assert.equal(runtime.publicationRequest({
    identity: identity.identity,
    publisher,
    object: 'commit_status',
    status: 'completed',
    conclusion: 'success',
    summary: 'forbidden',
    details_url: null,
  }).code, 'COMMIT_STATUS_FORBIDDEN');
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

test('protection consent, ownership, projections, and preview-only plans remain bounded', (t) => {
  const capabilityRegistryOptions = protectionRegistry(t);
  const publisherResult = runtime.validatePublisher(publisher);
  assert.equal(publisherResult.ok, true);
  const desired = runtime.desiredProtectionProjection({ repository_id: REPOSITORY_ID, default_branch: 'main', integration_id: publisher.integration_id });
  assert.equal(desired.ok, true);
  assert.equal(runtime.validateDesiredProtectionProjection(desired.projection).ok, true);
  assert.equal(runtime.validateDesiredProtectionProjection({ ...desired.projection, fingerprint: '0'.repeat(64) }).code, 'IDENTITY_MISMATCH');
  assert.equal(runtime.validateProtectionConsent({ capability_id: 'repository.protection', state: 'unresolved' }, REPOSITORY_ID).code, 'CONSENT_MISSING');
  assert.equal(runtime.validateProtectionConsent(consent({ repositoryId: 'b'.repeat(64) }), REPOSITORY_ID).code, 'IDENTITY_MISMATCH');
  assert.equal(runtime.readProtectionConsent(capabilityRegistryOptions, REPOSITORY_ID).ok, true);
  assert.equal(runtime.readProtectionConsent(capabilityRegistryOptions, 'b'.repeat(64)).code, 'IDENTITY_MISMATCH');
  const tamperedConsent = consent();
  tamperedConsent.receipt.receipt_id = '0'.repeat(64);
  assert.equal(runtime.validateProtectionConsent(tamperedConsent, REPOSITORY_ID).code, 'CONSENT_MISSING');

  const noop = runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    default_branch: 'main',
    capability_registry_options: capabilityRegistryOptions,
    publisher,
    effective,
  });
  assert.equal(noop.ok, true);
  assert.equal(noop.code, 'NOOP');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    capability_registry_options: capabilityRegistryOptions,
    consent: consent(),
    publisher,
    effective,
  }).code, 'CONSENT_MISSING');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    capability_registry_options: capabilityRegistryOptions,
    capability_status: { capabilities: { 'repository.protection': consent() } },
    publisher,
    effective,
  }).code, 'CONSENT_MISSING');
  const absent = runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    capability_registry_options: capabilityRegistryOptions,
    publisher,
    effective: { ...effective, rulesets: [] },
  });
  assert.equal(absent.status, 'PLAN');
  assert.equal(absent.action, 'create-ruleset');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    capability_registry_options: capabilityRegistryOptions,
    publisher,
    effective: { ...effective, rulesets: [] },
    phase: 'apply-plan',
  }).code, 'LIVE_MUTATION_FORBIDDEN');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    capability_registry_options: capabilityRegistryOptions,
    publisher,
    effective: {
      ...effective,
      rulesets: [{ ...effective.rulesets[0], id: 'owner-rule', name: 'Owner Rule', owner_class: 'unknown', required_contexts: [] }],
    },
  }).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.reconcileProtection({
    repository_id: REPOSITORY_ID,
    capability_registry_options: capabilityRegistryOptions,
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
  for (const ownerClass of ['N6-owned', 'organisation-managed', 'owner-managed', 'foreign-managed', 'unknown', 'overlapping-compatible']) {
    assert.equal(runtime.classifyProtectionOwnership({
      rulesets: [],
      organisation_rulesets: [{ ...effective.rulesets[0], owner_class: ownerClass }],
    }, desired.projection).code, 'OWNERSHIP_AMBIGUOUS');
  }
  assert.equal(runtime.classifyProtectionOwnership({
    rulesets: [effective.rulesets[0]],
    organisation_rulesets: [{ ...effective.rulesets[0], owner_class: 'organisation-managed' }],
  }, desired.projection).code, 'OWNERSHIP_AMBIGUOUS');
  const unrelatedOrganisation = { ...effective.rulesets[0], id: 'organisation-baseline', name: 'Organisation Baseline', owner_class: 'organisation-managed', required_contexts: [] };
  assert.equal(runtime.classifyProtectionOwnership({
    rulesets: [effective.rulesets[0]],
    organisation_rulesets: [unrelatedOrganisation],
  }, desired.projection).ok, true);
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
  const staleArchive = validGateInput();
  staleArchive.evidence_archive[0].bytes = JSON.stringify({ ...staleArchive.evidence, head_sha: '9'.repeat(40) });
  assert.equal(workflow.validateGateInvocation(staleArchive).code, 'WORKFLOW_EVIDENCE_INVALID');
});

test('composition CLI consumes complete bounded input and fails closed on absent or stale evidence', () => {
  const source = runWorkflowCli('--validate-source');
  assert.equal(source.status, 0, source.stderr || source.stdout);
  const absent = runWorkflowCli('--validate-composition');
  assert.notEqual(absent.status, 0);
  assert.equal(JSON.parse(absent.stdout).code, 'WORKFLOW_INVALID');
  const malformed = runWorkflowCli('--validate-composition', '{');
  assert.notEqual(malformed.status, 0);
  assert.equal(JSON.parse(malformed.stdout).code, 'WORKFLOW_INVALID');
  const oversized = runWorkflowCli('--validate-composition', ' '.repeat(workflow.MAX_COMPOSITION_INPUT_BYTES + 1));
  assert.notEqual(oversized.status, 0);
  assert.equal(JSON.parse(oversized.stdout).code, 'WORKFLOW_INVALID');

  const valid = validCliInput();
  const accepted = runWorkflowCli('--validate-composition', JSON.stringify(valid));
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(JSON.parse(accepted.stdout).ok, true);

  const stale = validCliInput();
  stale.head_sha = '9'.repeat(40);
  const staleResult = runWorkflowCli('--validate-composition', JSON.stringify(stale));
  assert.notEqual(staleResult.status, 0);
  assert.equal(JSON.parse(staleResult.stdout).code, 'WORKFLOW_EVIDENCE_INVALID');

  const mismatched = validCliInput();
  mismatched.evidence.repository_id = 'b'.repeat(64);
  mismatched.evidence.evidence_digest = runtime.evidenceDigest(mismatched.evidence);
  mismatched.evidence_archive[0].bytes = JSON.stringify(mismatched.evidence);
  const mismatchResult = runWorkflowCli('--validate-composition', JSON.stringify(mismatched));
  assert.notEqual(mismatchResult.status, 0);
  assert.equal(JSON.parse(mismatchResult.stdout).code, 'WORKFLOW_EVIDENCE_INVALID');

  const evidenceMissing = validCliInput({ evidence: null, evidence_archive: [] });
  const evidenceMissingResult = runWorkflowCli('--validate-composition', JSON.stringify(evidenceMissing));
  assert.notEqual(evidenceMissingResult.status, 0);
  assert.equal(JSON.parse(evidenceMissingResult.stdout).code, 'WORKFLOW_EVIDENCE_INVALID');

  const incomplete = validCliInput();
  incomplete.component_results = incomplete.component_results.slice(1);
  const incompleteResult = runWorkflowCli('--validate-composition', JSON.stringify(incomplete));
  assert.notEqual(incompleteResult.status, 0);
  assert.equal(JSON.parse(incompleteResult.stdout).code, 'WORKFLOW_COVERAGE_INVALID');
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
