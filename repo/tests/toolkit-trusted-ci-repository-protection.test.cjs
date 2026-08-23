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
const compositionFixture = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'fixtures', 'composition-paths.n6.json'), 'utf8'));
const PROTECTED_WORKFLOW_SOURCE_SHA = workflow.workflowIdentity(workflow.buildProtectedWorkflowTemplate()).source_sha;

const SHAS = {
  head: 'a'.repeat(40),
  base: git(repoRoot, ['rev-parse', 'HEAD']),
  merge: 'c'.repeat(40),
  workflow: PROTECTED_WORKFLOW_SOURCE_SHA,
};
const REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';
const REPOSITORY_ID = capabilityRegistry.repositoryIdForCanonicalRemote(REMOTE);
const effective = { ...effectiveFixture, repository_id: REPOSITORY_ID };
const CHANGED_PATHS = [
  '_projects/cicd/trusted-ci-repository-protection/_main/trusted-ci-repository-protection-policy.json',
  'repo/scripts/toolkit-trusted-ci-repository-protection.cjs',
  'repo/tests/toolkit-trusted-ci-repository-protection.test.cjs',
];

function trustedEvent(overrides = {}) {
  return {
    repository: { full_name: 'weijunswj/ai-agent-toolkit' },
    pull_request: {
      number: 194,
      head: { sha: SHAS.head },
      base: { sha: SHAS.base },
      merge_commit_sha: SHAS.merge,
      updated_at: '2026-08-23T00:00:00.000Z',
    },
    n6_changed_paths: [...CHANGED_PATHS],
    ...overrides,
  };
}

function writeTrustedEvent(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n6-event-'));
  const eventPath = path.join(root, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(trustedEvent(overrides)), 'utf8');
  return { root, eventPath };
}

function trustedContext(t, overrides = {}) {
  const event = writeTrustedEvent(overrides);
  const keys = ['GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GITHUB_EVENT_PATH: event.eventPath,
    GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_REPOSITORY: 'weijunswj/ai-agent-toolkit',
    GITHUB_SHA: SHAS.merge,
    GITHUB_RUN_ID: 'run-194',
    GITHUB_RUN_ATTEMPT: '1',
  });
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(event.root, { recursive: true, force: true });
  });
  const result = workflow.readProtectedEventContext();
  assert.equal(result.ok, true, result.code);
  const withPaths = workflow.contextWithChangedPaths(result.trusted_context, repoRoot);
  assert.equal(withPaths.ok, true, withPaths.code);
  return withPaths.trusted_context;
}

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

function evidenceFor(manifest, overrides = {}, context = null) {
  const trusted = context || {
    repository_id: REPOSITORY_ID,
    pr: 194,
    head_sha: SHAS.head,
    base_sha: SHAS.base,
    merge_sha: SHAS.merge,
    workflow_source_sha: PROTECTED_WORKFLOW_SOURCE_SHA,
    run_id: 'run-194',
    attempt: 1,
    generation: 1,
  };
  const evidence = {
    schema: runtime.EVIDENCE_SCHEMA,
    repository_id: trusted.repository_id,
    pr: trusted.pr,
    head_sha: trusted.head_sha,
    base_sha: trusted.base_sha,
    merge_sha: trusted.merge_sha,
    protected_workflow: {
      identity: workflow.WORKFLOW_ID,
      source_sha: trusted.workflow_source_sha,
    },
    run: { id: trusted.run_id, attempt: trusted.attempt },
    generation: trusted.generation,
    contract_version: runtime.CONTRACT_VERSION,
    contract_digest: runtime.EVIDENCE_CONTRACT_DIGEST,
    component_results: componentResults(manifest).map(({ dependency_setup, ...component }) => ({
      ...component,
      producer: {
        workflow_identity: workflow.WORKFLOW_ID,
        workflow_source_sha: trusted.workflow_source_sha,
        run_id: trusted.run_id,
        attempt: trusted.attempt,
        generation: trusted.generation,
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

function validGateInput(t, overrides = {}) {
  const trusted = trustedContext(t);
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  assert.equal(manifest.ok, true);
  const evidence = evidenceFor(manifest, {}, trusted);
  return {
    workflow: {
      source: workflow.buildProtectedWorkflowTemplate(),
      source_sha: trusted.workflow_source_sha,
      base_ref: workflow.BASE_REF,
      candidate_owned: false,
      workflow_identity: workflow.WORKFLOW_ID,
    },
    repository_id: trusted.repository_id,
    pr: trusted.pr,
    head_sha: trusted.head_sha,
    base_sha: trusted.base_sha,
    merge_sha: trusted.merge_sha,
    changed_paths: CHANGED_PATHS,
    component_results: componentResults(manifest),
    evidence,
    evidence_archive: [{ path: 'ci/evidence.json', kind: 'file', bytes: JSON.stringify(evidence) }],
    non_ci_evidence: [],
    trusted_context: trusted,
    ...overrides,
  };
}

function runWorkflowCli(argument, input) {
  const event = writeTrustedEvent();
  try {
    return childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection-workflow.cjs'), argument], {
      cwd: repoRoot,
      encoding: 'utf8',
      input,
      windowsHide: true,
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: event.eventPath,
        GITHUB_EVENT_NAME: 'pull_request_target',
        GITHUB_REPOSITORY: 'weijunswj/ai-agent-toolkit',
        GITHUB_SHA: SHAS.merge,
        GITHUB_RUN_ID: 'run-194',
        GITHUB_RUN_ATTEMPT: '1',
      },
    });
  } finally {
    fs.rmSync(event.root, { recursive: true, force: true });
  }
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

test('complete N6 project metadata and future project files are representable while out-of-contract paths fail closed', () => {
  const complete = runtime.compositionManifest(compositionFixture.changed_paths);
  assert.equal(complete.ok, true);
  assert.deepEqual(complete.required_components, compositionFixture.required_components);
  for (const pathValue of [
    '_projects/cicd/trusted-ci-repository-protection/README.md',
    '_projects/cicd/trusted-ci-repository-protection/SOURCE-MANIFEST.md',
    '_projects/cicd/trusted-ci-repository-protection/_main/future-contract.json',
  ]) assert.equal(runtime.compositionManifest([pathValue]).ok, true, pathValue);
  assert.equal(runtime.compositionManifest(['repo/future-relevant-but-unknown.bin']).code, 'UNKNOWN_RELEVANT_PATH');
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
    protected_workflow_source_sha: PROTECTED_WORKFLOW_SOURCE_SHA,
    component_ids: manifest.required_components,
    required_component_ids: manifest.required_components,
    producer: {
      workflow_identity: workflow.WORKFLOW_ID,
      workflow_source_sha: PROTECTED_WORKFLOW_SOURCE_SHA,
      run_id: 'run-194',
      attempt: 1,
      generation: 1,
    },
  };
  assert.equal(runtime.validateEvidence(evidence, expected).ok, true);
  assert.equal(runtime.validateEvidence({ ...evidence, head_sha: '9'.repeat(40) }, expected).code, 'HEAD_MOVED');
  const incomplete = { ...evidence, component_results: evidence.component_results.map((item, index) => index === 0 ? { ...item, status: 'skipped', conclusion: 'not-applicable' } : item) };
  incomplete.evidence_digest = runtime.evidenceDigest(incomplete);
  assert.equal(runtime.validateEvidence(incomplete, expected).code, 'COMPONENT_FAILED');
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
    protected_workflow_source_sha: PROTECTED_WORKFLOW_SOURCE_SHA,
    contract_digest: runtime.EVIDENCE_CONTRACT_DIGEST,
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
    protected_workflow_source_sha: PROTECTED_WORKFLOW_SOURCE_SHA,
    contract_digest: runtime.EVIDENCE_CONTRACT_DIGEST,
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
  const canonicalConsent = runtime.readProtectionConsent(capabilityRegistryOptions, REPOSITORY_ID).consent;
  assert.equal(runtime.buildOwnershipProof(effective, desired.projection, canonicalConsent.capability).code, 'OWNERSHIP_AMBIGUOUS');
  const ownershipProof = runtime.buildOwnershipProof(effective, desired.projection, canonicalConsent).ownership_proof;
  assert.equal(runtime.classifyProtectionOwnership(effective, desired.projection).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.classifyProtectionOwnership(effective, desired.projection, { ...ownershipProof, authority: 'caller' }, canonicalConsent).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.classifyProtectionOwnership(effective, desired.projection, { ...ownershipProof, rule_digest: '0'.repeat(64) }, canonicalConsent).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    publisher,
    effective,
    phase: 'rollback-plan',
    rollback_delta: { enforcement: 'caller-controlled' },
  }, capabilityRegistryOptions).ok, false);
  const tamperedConsent = consent();
  tamperedConsent.receipt.receipt_id = '0'.repeat(64);
  assert.equal(runtime.validateProtectionConsent(tamperedConsent, REPOSITORY_ID).code, 'CONSENT_MISSING');

  const noop = runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    default_branch: 'main',
    publisher,
    effective,
    ownership_proof: ownershipProof,
  }, capabilityRegistryOptions);
  assert.equal(noop.ok, true);
  assert.equal(noop.code, 'NOOP');
  const preMutation = {
    ...effective,
    rulesets: [{ ...effective.rulesets[0], enforcement: 'inactive' }],
  };
  const rollbackProof = runtime.buildOwnershipProof(effective, desired.projection, canonicalConsent, preMutation).ownership_proof;
  const rollback = runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    publisher,
    effective,
    phase: 'rollback-plan',
    ownership_proof: rollbackProof,
    rollback_delta: { enforcement: 'caller-controlled' },
  }, capabilityRegistryOptions);
  assert.equal(rollback.ok, true);
  assert.deepEqual(rollback.delta, { enforcement: 'inactive' });
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    consent: consent(),
    publisher,
    effective,
  }, capabilityRegistryOptions).code, 'CONSENT_MISSING');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    capability_status: { capabilities: { 'repository.protection': consent() } },
    publisher,
    effective,
  }, capabilityRegistryOptions).code, 'CONSENT_MISSING');
  const absent = runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    publisher,
    effective: { ...effective, rulesets: [] },
  }, capabilityRegistryOptions);
  assert.equal(absent.status, 'PLAN');
  assert.equal(absent.action, 'create-ruleset');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    publisher,
    effective: { ...effective, rulesets: [] },
    phase: 'apply-plan',
  }, capabilityRegistryOptions).code, 'LIVE_MUTATION_FORBIDDEN');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    publisher,
    effective: {
      ...effective,
      rulesets: [{ ...effective.rulesets[0], id: 'owner-rule', name: 'Owner Rule', owner_class: 'unknown', required_contexts: [] }],
    },
  }, capabilityRegistryOptions).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: REPOSITORY_ID,
    publisher,
    effective: {
      ...effective,
      rulesets: [{ ...effective.rulesets[0], owner_class: 'owner-managed' }],
    },
  }, capabilityRegistryOptions).code, 'OWNERSHIP_AMBIGUOUS');
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
  const effectiveWithOrganisation = { ...effective, organisation_rulesets: [unrelatedOrganisation] };
  const organisationProof = runtime.buildOwnershipProof(effectiveWithOrganisation, desired.projection, canonicalConsent).ownership_proof;
  assert.equal(runtime.classifyProtectionOwnership({
    ...effectiveWithOrganisation,
  }, desired.projection, organisationProof, canonicalConsent).ok, true);
  assert.equal(runtime.validateProtectionConsent({ capability_id: 'repository.protection', state: 'enabled' }, REPOSITORY_ID).code, 'CONSENT_MISSING');
  assert.equal(runtime.classifyProtectionOwnership({ rulesets: [{ name: 'protect-main', source: 'unknown' }] }).code, 'OWNERSHIP_AMBIGUOUS');
});

test('workflow gate validation composes protected workflow, coverage, and evidence without execution', (t) => {
  const result = workflow.validateGateInvocation(validGateInput(t));
  assert.equal(result.ok, true);
  assert.equal(result.workflow.identity, workflow.WORKFLOW_ID);
  assert.equal(result.composition.schema, 'toolkit.n6.ci-composition.v1');
  assert.equal(result.evidence.run.id, 'run-194');
  const blocked = workflow.validateGateInvocation(validGateInput(t, { non_ci_evidence: ['unlisted-provider-uat'] }));
  assert.equal(blocked.code, 'WORKFLOW_COVERAGE_INVALID');
  const staleArchive = validGateInput(t);
  staleArchive.evidence_archive[0].bytes = JSON.stringify({ ...staleArchive.evidence, head_sha: '9'.repeat(40) });
  assert.equal(workflow.validateGateInvocation(staleArchive).code, 'WORKFLOW_EVIDENCE_INVALID');
});

test('trusted composition rejects arbitrary identity even when caller evidence is self-consistent', (t) => {
  const input = validGateInput(t);
  input.repository_id = 'e'.repeat(64);
  input.pr = 999;
  input.head_sha = '9'.repeat(40);
  input.base_sha = '8'.repeat(40);
  input.merge_sha = '7'.repeat(40);
  input.evidence = {
    ...input.evidence,
    repository_id: input.repository_id,
    pr: input.pr,
    head_sha: input.head_sha,
    base_sha: input.base_sha,
    merge_sha: input.merge_sha,
  };
  input.evidence.evidence_digest = runtime.evidenceDigest(input.evidence);
  input.evidence_archive[0].bytes = JSON.stringify(input.evidence);
  const result = workflow.validateGateInvocation(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKFLOW_IDENTITY_MISMATCH');
});

test('composition input without protected event authority cannot certify itself', (t) => {
  const input = validGateInput(t);
  delete input.trusted_context;
  const result = workflow.validateGateInvocation(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKFLOW_TRUSTED_CONTEXT_MISSING');
});

test('generic caller-supplied changed paths are not trusted event authority', () => {
  const event = writeTrustedEvent({ changed_paths: [...CHANGED_PATHS] });
  try {
    const result = workflow.readProtectedEventContext({
      GITHUB_EVENT_PATH: event.eventPath,
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_REPOSITORY: 'weijunswj/ai-agent-toolkit',
      GITHUB_SHA: SHAS.merge,
      GITHUB_RUN_ID: 'run-194',
      GITHUB_RUN_ATTEMPT: '1',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'WORKFLOW_TRUSTED_CONTEXT_MISSING');
  } finally {
    fs.rmSync(event.root, { recursive: true, force: true });
  }
});

test('trusted composition rejects failed mandatory components', (t) => {
  const input = validGateInput(t);
  input.component_results[0] = { ...input.component_results[0], status: 'failure', conclusion: 'failure' };
  input.evidence.component_results[0] = { ...input.evidence.component_results[0], status: 'failure', conclusion: 'failure' };
  input.evidence.conclusion = 'failure';
  input.evidence.evidence_digest = runtime.evidenceDigest(input.evidence);
  input.evidence_archive[0].bytes = JSON.stringify(input.evidence);
  const result = workflow.validateGateInvocation(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKFLOW_COVERAGE_INVALID');
  assert.equal(result.cause, 'COMPONENT_FAILED');
});

test('trusted composition rejects reversed, stale, and self-declared producer evidence', (t) => {
  const reversed = validGateInput(t);
  reversed.evidence.timestamps = {
    started_at: '2026-08-23T00:02:00.000Z',
    completed_at: '2026-08-23T00:01:00.000Z',
  };
  reversed.evidence.evidence_digest = runtime.evidenceDigest(reversed.evidence);
  reversed.evidence_archive[0].bytes = JSON.stringify(reversed.evidence);
  assert.equal(workflow.validateGateInvocation(reversed).code, 'WORKFLOW_EVIDENCE_INVALID');

  const stale = validGateInput(t);
  stale.evidence.timestamps = {
    started_at: '2020-01-01T00:00:00.000Z',
    completed_at: '2020-01-01T00:01:00.000Z',
  };
  stale.evidence.evidence_digest = runtime.evidenceDigest(stale.evidence);
  stale.evidence_archive[0].bytes = JSON.stringify(stale.evidence);
  assert.equal(workflow.validateGateInvocation(stale).code, 'WORKFLOW_EVIDENCE_INVALID');

  const producer = validGateInput(t);
  producer.evidence.component_results[0].producer.workflow_identity = 'caller-declared-producer';
  producer.evidence.evidence_digest = runtime.evidenceDigest(producer.evidence);
  producer.evidence_archive[0].bytes = JSON.stringify(producer.evidence);
  assert.equal(workflow.validateGateInvocation(producer).code, 'WORKFLOW_EVIDENCE_INVALID');
});

test('protected producer builds the exact composition input from event-bound protected context', () => {
  const event = writeTrustedEvent();
  try {
    const produced = workflow.produceCompositionForCli({
      GITHUB_EVENT_PATH: event.eventPath,
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_REPOSITORY: 'weijunswj/ai-agent-toolkit',
      GITHUB_SHA: SHAS.merge,
      GITHUB_RUN_ID: 'run-194',
      GITHUB_RUN_ATTEMPT: '1',
    }, repoRoot);
    assert.equal(produced.ok, true, produced.code);
    assert.deepEqual(Object.keys(produced.input).sort(), [...workflow.COMPOSITION_INPUT_KEYS].sort());
    assert.equal(produced.producer_ok, true);
    assert.equal(produced.input.evidence.protected_workflow.identity, workflow.WORKFLOW_ID);
    assert.equal(produced.input.evidence.component_results.every((component) => component.producer.workflow_identity === workflow.WORKFLOW_ID), true);
    assert.equal(produced.input.component_results.every((component) => component.artifact_digest !== 'f'.repeat(64)), true);
  } finally {
    fs.rmSync(event.root, { recursive: true, force: true });
  }
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

  const produced = runWorkflowCli('--produce-composition');
  assert.equal(produced.status, 0, produced.stderr || produced.stdout);
  const producedInput = JSON.parse(produced.stdout);
  const copy = () => JSON.parse(JSON.stringify(producedInput));
  const valid = copy();
  const accepted = runWorkflowCli('--validate-composition', JSON.stringify(valid));
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(JSON.parse(accepted.stdout).ok, true);

  const stale = copy();
  stale.head_sha = '9'.repeat(40);
  const staleResult = runWorkflowCli('--validate-composition', JSON.stringify(stale));
  assert.notEqual(staleResult.status, 0);
  assert.equal(JSON.parse(staleResult.stdout).code, 'WORKFLOW_IDENTITY_MISMATCH');

  const mismatched = copy();
  mismatched.evidence.repository_id = 'b'.repeat(64);
  mismatched.evidence.evidence_digest = runtime.evidenceDigest(mismatched.evidence);
  mismatched.evidence_archive[0].bytes = JSON.stringify(mismatched.evidence);
  const mismatchResult = runWorkflowCli('--validate-composition', JSON.stringify(mismatched));
  assert.notEqual(mismatchResult.status, 0);
  assert.equal(JSON.parse(mismatchResult.stdout).code, 'WORKFLOW_EVIDENCE_INVALID');

  const evidenceMissing = copy();
  evidenceMissing.evidence = null;
  evidenceMissing.evidence_archive = [];
  const evidenceMissingResult = runWorkflowCli('--validate-composition', JSON.stringify(evidenceMissing));
  assert.notEqual(evidenceMissingResult.status, 0);
  assert.equal(JSON.parse(evidenceMissingResult.stdout).code, 'WORKFLOW_EVIDENCE_INVALID');

  const incomplete = copy();
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
