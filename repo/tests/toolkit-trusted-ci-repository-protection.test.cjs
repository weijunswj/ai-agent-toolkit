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

function ownershipReceipt({
  repositoryId = REPOSITORY_ID,
  managedKey = runtime.DEFAULT_MANAGED_KEY,
  rulesetId = effectiveFixture.rulesets[0].id,
  appId = publisher.app_id,
  context = runtime.GATE_CONTEXT,
  operation = 'create-managed-ruleset',
  a2ConsentReceiptId,
  prestateRule = effectiveFixture.rulesets[0],
  previousReceiptDigest = null,
  receiptRevision = 1,
} = {}) {
  const rollbackPrestate = prestateRule === null ? null : {
    effective_fingerprint: digest(effective),
    rule: { ...prestateRule },
    rule_digest: digest(prestateRule),
  };
  const receipt = {
    schema: runtime.OWNERSHIP_RECEIPT_SCHEMA,
    repository_id: repositoryId,
    managed_key: managedKey,
    ruleset_id: rulesetId,
    app_id: appId,
    context,
    operation,
    a2_consent_receipt_id: a2ConsentReceiptId || 'a'.repeat(64),
    pre_read_fingerprint: digest(effective),
    post_read_fingerprint: digest(effective),
    post_rule_digest: digest(effectiveFixture.rulesets[0]),
    rollback_prestate: rollbackPrestate,
    rollback_prestate_digest: digest(rollbackPrestate),
    receipt_revision: receiptRevision,
    previous_receipt_digest: previousReceiptDigest,
    recorded_at: '2026-08-24T00:00:00.000Z',
    receipt_digest: '',
  };
  receipt.receipt_digest = digest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receipt_digest')));
  return receipt;
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
  assert.equal(contractSchema.properties.evidence.properties.schema.const, runtime.SERVER_EVIDENCE_SCHEMA);
  assert.equal(policy.contract_version, runtime.CONTRACT_VERSION);
  assert.deepEqual(policy.modes, runtime.MODES);
  assert.deepEqual(policy.diagnostic_workflow, {
    workflow_name: workflow.WORKFLOW_NAME,
    job_id: workflow.DIAGNOSTIC_JOB_ID,
    job_name: workflow.DIAGNOSTIC_JOB_NAME,
    reserved_publisher_context: workflow.RESERVED_PUBLISHER_CONTEXT,
    diagnostic_only: true,
    candidate_code_execution: false,
    candidate_evidence_authority: false,
    required_finality: false,
    check_run_publication: false,
    commit_status_publication: false,
  });
  assert.equal(policy.evidence.schema, runtime.SERVER_EVIDENCE_SCHEMA);
  assert.deepEqual(policy.publisher.permissions, publisher.permissions);
  assert.deepEqual(policy.publisher.operations, publisher.operations);
  assert.equal(publisherProtocol.protocol_version, runtime.PUBLISHER_PROTOCOL_VERSION);
  assert.deepEqual(publisherProtocol.permissions, publisher.permissions);
  assert.deepEqual(publisherProtocol.operations, publisher.operations);
  assert.equal(policy.publisher.identity.field, 'app_id');
  assert.equal(policy.publisher.identity.coercion, false);
  assert.equal(publisherProtocol.app_id, publisher.app_id);
  assert.equal(publisherProtocol.publication.commit_status, false);
  assert.equal(publisherProtocol.publication.status_endpoint, false);
  assert.equal(publisherProtocol.publication.check_run_readback_app_field, 'app.id');
  assert.equal(publisherProtocol.forbidden.includes('commit_status_publication'), true);
  assert.equal(publisherProtocol.forbidden.includes('status_endpoint_publication'), true);
  assert.equal(contractSchema.properties.publisher.properties.permissions.const.statuses, 'write');
  assert.equal(contractSchema.properties.publisher.properties.operations.const.commit_status_publication, false);
  assert.equal(contractSchema.properties.publisher.properties.operations.const.status_endpoint_publication, false);
  assert.deepEqual(contractSchema.properties.protection.properties.identity.const, {
    managed_key: runtime.DEFAULT_MANAGED_KEY,
    provider_ruleset_id: 'positive-safe-integer',
    app_id: 'positive-safe-integer',
    check_run_app_field: 'app.id',
  });
  assert.equal(workflow.validateWorkflowContract(workflowContract).ok, true);
});

test('diagnostic workflow and job names isolate the reserved CI Gate publisher context', () => {
  const source = workflow.buildProtectedWorkflowTemplate();
  assert.equal(workflow.WORKFLOW_NAME, 'N6 CI diagnostics');
  assert.equal(workflow.DIAGNOSTIC_JOB_NAME, 'N6 CI diagnostics');
  assert.equal(workflow.validateWorkflowSource(source).ok, true);
  assert.equal(workflow.validateWorkflowContract(workflowContract).ok, true);
  assert.equal(runtime.GATE_CONTEXT, 'CI Gate');
  assert.equal(publisherProtocol.context, 'CI Gate');
  assert.equal(runtime.validatePublisher(publisher).ok, true);
  assert.equal(workflowContract.publisher.reference_only, true);
  assert.equal(workflowContract.publisher.check_run_publication, false);
  assert.equal(workflowContract.publisher.commit_status_publication, false);
  assert.equal(workflowContract.required_finality, false);
  assert.equal(workflowContract.check_run_publication, false);
  assert.equal(workflowContract.commit_status_publication, false);

  const workflowNameCollision = source.replace('name: N6 CI diagnostics', 'name: CI Gate');
  assert.equal(workflow.validateWorkflowSource(workflowNameCollision).code, 'WORKFLOW_RESERVED_CONTEXT');
  const jobNameCollision = source.replace('    name: N6 CI diagnostics', '    name: CI Gate');
  assert.equal(workflow.validateWorkflowSource(jobNameCollision).code, 'WORKFLOW_RESERVED_CONTEXT');
  assert.equal(workflow.validateWorkflowContract({ ...workflowContract, workflow_name: 'CI Gate' }).ok, false);
  assert.equal(workflow.validateWorkflowContract({ ...workflowContract, job_name: 'CI Gate' }).ok, false);
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
  assert.deepEqual(manifest.required_components, ['project-sync', 'fallback-risk-audit', 'toolkit-validator', 'repository-tests']);
  assert.equal(manifest.components.some((component) => component.applicability === 'required' && component.id === 'git-diff-check'), false);
  assert.equal(runtime.NON_AUTHORITATIVE_COMPONENT_IDS.includes('git-diff-check'), true);
  assert.equal(runtime.compositionManifest(['unknown/path.bin']).code, 'UNKNOWN_RELEVANT_PATH');
  const results = componentResults(manifest, { 'project-sync': { producer: 'candidate' } });
  assert.equal(runtime.validateOwningCICoverage({ changed_paths: CHANGED_PATHS, manifest, component_results: results }).code, 'WORKFLOW_NON_AUTHORITATIVE');
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

test('legacy protected-runner evidence cannot certify server authority', () => {
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  const evidence = evidenceFor(manifest);
  assert.equal(runtime.validateEvidence(evidence).code, 'WORKFLOW_NON_AUTHORITATIVE');
});

test('archive, publisher, and gate identity boundaries fail closed', () => {
  assert.equal(runtime.validateEvidenceArchive([{ path: '../secret.txt', kind: 'file', bytes: 'x' }]).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'a.txt', kind: 'file', bytes: 'x' }, { path: 'a.txt', kind: 'file', bytes: 'y' }]).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'a.txt', kind: 'symlink', bytes: 'x' }]).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
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

test('provider identity, ownership receipts, and preview-only protection plans remain bounded', (t) => {
  const capabilityRegistryOptions = protectionRegistry(t);
  const publisherResult = runtime.validatePublisher(publisher);
  assert.equal(publisherResult.ok, true);
  for (const appId of ['123456', 'trusted-ci-app', 0, -1, null, undefined]) {
    const candidate = { ...publisher, app_id: appId };
    if (appId === undefined) delete candidate.app_id;
    assert.equal(runtime.validatePublisher(candidate).ok, false, String(appId));
  }
  assert.equal(runtime.validatePublisher({ ...publisher, integration_id: publisher.app_id }).ok, false);
  assert.equal(runtime.validatePublisher({ ...publisher, app_id: publisher.app_id + 1 }).ok, true);
  assert.equal(runtime.validateBranchProtectionRequiredCheck({ context: 'CI Gate', app_id: publisher.app_id }, { app_id: publisher.app_id }).ok, true);
  assert.equal(runtime.validateBranchProtectionRequiredCheck({ context: 'CI Gate', app_id: String(publisher.app_id) }).ok, false);
  assert.equal(runtime.validateRulesetRequiredCheck({ context: 'CI Gate', integration_id: publisher.app_id }, { app_id: publisher.app_id }).ok, true);
  assert.equal(runtime.validateRulesetRequiredCheck({ context: 'CI Gate', integration_id: publisher.app_id + 1 }, { app_id: publisher.app_id }).ok, false);
  assert.equal(runtime.validateCheckRunReadback({ name: 'CI Gate', app: { id: publisher.app_id } }, { app_id: publisher.app_id }).ok, true);
  assert.equal(runtime.validateCheckRunReadback({ name: 'CI Gate', app: { id: String(publisher.app_id) } }, { app_id: publisher.app_id }).ok, false);

  const desired = runtime.desiredProtectionProjection({ repository_id: REPOSITORY_ID, default_branch: 'main', app_id: publisher.app_id });
  assert.equal(desired.ok, true);
  assert.equal(runtime.validateDesiredProtectionProjection(desired.projection).ok, true);
  assert.equal(desired.projection.managed_key, runtime.DEFAULT_MANAGED_KEY);
  assert.equal(desired.projection.ruleset.name, 'N6 CI Gate');
  assert.deepEqual(desired.projection.ruleset.required_contexts, [{ context: 'CI Gate', app_id: publisher.app_id }]);
  assert.equal(runtime.desiredProtectionProjection({ repository_id: REPOSITORY_ID, default_branch: 'main', app_id: publisher.app_id, ruleset_id: 'n6-ci-gate-v1' }).ok, false);
  assert.equal(runtime.validateDesiredProtectionProjection({ ...desired.projection, fingerprint: '0'.repeat(64) }).code, 'IDENTITY_MISMATCH');
  assert.equal(runtime.canonicalizeEffectiveProtection({ ...effective, rulesets: [{ ...effective.rulesets[0], id: '654321' }] }).code, 'PROTECTION_UNREADABLE');

  assert.equal(runtime.validateProtectionConsent({ capability_id: 'repository.protection', state: 'unresolved' }, REPOSITORY_ID).code, 'CONSENT_MISSING');
  assert.equal(runtime.validateProtectionConsent(consent({ repositoryId: 'b'.repeat(64) }), REPOSITORY_ID).code, 'IDENTITY_MISMATCH');
  assert.equal(runtime.readProtectionConsent(capabilityRegistryOptions, REPOSITORY_ID).ok, true);
  assert.equal(runtime.readProtectionConsent(capabilityRegistryOptions, 'b'.repeat(64)).code, 'IDENTITY_MISMATCH');
  const canonicalConsent = runtime.readProtectionConsent(capabilityRegistryOptions, REPOSITORY_ID).consent;
  const receipt = ownershipReceipt({ a2ConsentReceiptId: canonicalConsent.capability.receipt.receipt_id });
  assert.equal(runtime.validateOwnershipReceipt(receipt, { repository_id: REPOSITORY_ID, app_id: publisher.app_id, ruleset_id: effective.rulesets[0].id }).ok, true);
  assert.equal(runtime.classifyProtectionOwnership(effective, desired.projection).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.classifyProtectionOwnership(effective, desired.projection, receipt, { consent: canonicalConsent }).ownership_class, 'N6-owned');
  assert.equal(runtime.validateOwnershipReceipt({ ...receipt, repository_id: 'b'.repeat(64) }).code, 'OWNERSHIP_RECEIPT_INVALID');
  assert.equal(runtime.validateOwnershipReceipt({ ...receipt, managed_key: 'other-key' }).code, 'OWNERSHIP_RECEIPT_INVALID');
  assert.equal(runtime.validateOwnershipReceipt({ ...receipt, ruleset_id: receipt.ruleset_id + 1 }).code, 'OWNERSHIP_RECEIPT_INVALID');
  assert.equal(runtime.validateOwnershipReceipt({ ...receipt, app_id: receipt.app_id + 1 }).code, 'OWNERSHIP_RECEIPT_INVALID');
  assert.equal(runtime.validateOwnershipReceipt({ ...receipt, context: 'Other Gate' }).code, 'OWNERSHIP_RECEIPT_INVALID');
  assert.equal(runtime.validateOwnershipReceipt({ ...receipt, receipt_digest: '0'.repeat(64) }).code, 'OWNERSHIP_RECEIPT_INVALID');

  const withReceipt = { ...capabilityRegistryOptions, ownership_state: { receipt } };
  const noop = runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, default_branch: 'main', publisher, effective }, withReceipt);
  assert.equal(noop.ok, true);
  assert.equal(noop.code, 'NOOP');
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective, ownership_proof: receipt }, withReceipt).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective, ownership_receipt: receipt }, withReceipt).code, 'OWNERSHIP_AMBIGUOUS');

  const preMutationRule = { ...effective.rulesets[0], enforcement: 'inactive' };
  const rollbackReceipt = ownershipReceipt({
    a2ConsentReceiptId: canonicalConsent.capability.receipt.receipt_id,
    operation: 'update-managed-ruleset',
    previousReceiptDigest: receipt.receipt_digest,
    receiptRevision: 2,
    prestateRule: preMutationRule,
  });
  const rollback = runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective, phase: 'rollback-plan', rollback_delta: { enforcement: 'caller-controlled' } }, { ...capabilityRegistryOptions, ownership_state: { receipt: rollbackReceipt } });
  assert.equal(rollback.ok, true);
  assert.deepEqual(rollback.delta, { enforcement: 'inactive' });
  const drift = runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective: { ...effective, rulesets: [{ ...effective.rulesets[0], enforcement: 'inactive' }] } }, withReceipt);
  assert.equal(drift.status, 'PLAN');
  assert.equal(drift.action, 'update-ruleset');
  assert.equal(drift.binding.target_digest, runtime.digestValue({ ruleset_id: effective.rulesets[0].id }));

  const absent = runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective: { ...effective, rulesets: [] } }, { ...capabilityRegistryOptions, ownership_state: { receipt: null } });
  assert.equal(absent.status, 'PLAN');
  assert.equal(absent.action, 'create-ruleset');
  assert.equal(Object.prototype.hasOwnProperty.call(absent.binding, 'ruleset_id'), false);
  assert.equal(absent.binding.target_digest, runtime.digestValue({ managed_key: runtime.DEFAULT_MANAGED_KEY, name: 'N6 CI Gate' }));
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective: { ...effective, rulesets: [] }, phase: 'apply-plan' }, { ...capabilityRegistryOptions, ownership_state: { receipt: null } }).code, 'LIVE_MUTATION_FORBIDDEN');
  const replacement = { ...effective, rulesets: [{ ...effective.rulesets[0], id: effective.rulesets[0].id + 1 }] };
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective: replacement }, withReceipt).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: REPOSITORY_ID, publisher, effective }, { ...capabilityRegistryOptions, ownership_state: { receipt: null } }).code, 'OWNERSHIP_AMBIGUOUS');
  assert.equal(runtime.validateProtectionConsent({ capability_id: 'repository.protection', state: 'enabled' }, REPOSITORY_ID).code, 'CONSENT_MISSING');
});

test('protected workflow is diagnostic-only and cannot certify composition', () => {
  assert.equal(workflow.validateGateInvocation({}).code, 'WORKFLOW_NON_AUTHORITATIVE');
  assert.equal(workflow.produceCompositionForCli().code, 'WORKFLOW_NON_AUTHORITATIVE');
  assert.equal(workflow.validateCompositionForCli().code, 'WORKFLOW_NON_AUTHORITATIVE');
  assert.equal(workflow.readProtectedEventContext().code, 'WORKFLOW_NON_AUTHORITATIVE');
});

test('diagnostic workflow CLI validates source but never consumes composition input', () => {
  const source = runWorkflowCli('--validate-source');
  assert.equal(source.status, 0, source.stderr || source.stdout);
  const composition = runWorkflowCli('--validate-composition', JSON.stringify({ changed_paths: ['candidate'] }));
  assert.notEqual(composition.status, 0);
  assert.equal(JSON.parse(composition.stdout).code, 'WORKFLOW_NON_AUTHORITATIVE');
  const produced = runWorkflowCli('--produce-composition');
  assert.notEqual(produced.status, 0);
  assert.equal(JSON.parse(produced.stdout).code, 'WORKFLOW_NON_AUTHORITATIVE');
});

test('fake publisher is deterministic and idempotent for one Check Run external id', () => {
  const manifest = runtime.compositionManifest(CHANGED_PATHS);
  const evidence = evidenceFor(manifest);
  const fake = runtime.createFakePublisher({ expected: { publisher }, evidence_expected: { component_ids: manifest.required_components, required_component_ids: manifest.required_components } });
  const first = fake.publish(evidence, { publisher });
  assert.equal(first.code, 'WORKFLOW_NON_AUTHORITATIVE');
});
