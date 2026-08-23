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
const serverEvidenceFixtureFile = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'fixtures', 'server-evidence.n6.json'), 'utf8'));
const REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';
const effective = { ...effectiveFixture, repository_id: capabilityRegistry.repositoryIdForCanonicalRemote(REMOTE) };

function git(repo, args) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function registryOptions(t, operation = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n6-protection-boundary-'));
  const repo = path.join(root, 'repo');
  const registryPath = path.join(root, 'state', 'repository-governance.v1.json');
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--quiet', repo]);
  git(repo, ['remote', 'add', 'origin', REMOTE]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { cwd: repo, registryPath, testOnly: true };
  if (operation) {
    const current = capabilityRegistry.getRepositoryStatus(options);
    capabilityRegistry.writeCapabilityDecision({
      ...options,
      capabilityId: 'repository.protection',
      operation,
      ownerAction: {
        confirmed: true,
        category: 'explicit-owner',
        channel: 'capability-route',
        operation,
        choice_semantic_id: capabilityRegistry.capabilityDecisionSemanticId('repository.protection', operation),
        contract_digest: capabilityRegistry.CONTRACT_DIGEST,
        scope_digest: capabilityRegistry.capabilityScopeDigest(effective.repository_id, 'repository.protection', operation, 'capability-route'),
      },
      expectedRevision: current.registry_revision,
      expectedHash: current.snapshot_hash,
    });
  }
  return options;
}

function protectionConsent() {
  const scopeDigest = capabilityRegistry.capabilityScopeDigest(effective.repository_id, 'repository.protection', 'enable', 'capability-route');
  const receipt = {
    receipt_id: '',
    repository_id: effective.repository_id,
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
  receipt.receipt_id = crypto.createHash('sha256').update(capabilityRegistry.canonicalSerialize(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receipt_id'))), 'utf8').digest('hex');
  return {
    capability_id: 'repository.protection',
    state: 'enabled',
    decision_kind: 'enable',
    provenance: { category: 'explicit-owner', channel: 'capability-route', scope_digest: scopeDigest },
    receipt,
  };
}

test('closed evidence and publisher shapes reject extra fields and counterfeit permissions', () => {
  assert.equal(runtime.validateEvidence({ schema: runtime.EVIDENCE_SCHEMA, extra: true }).code, 'WORKFLOW_NON_AUTHORITATIVE');
  assert.equal(runtime.validatePublisher({ ...publisher, extra: true }).code, 'PRODUCER_MISMATCH');
  assert.equal(runtime.validatePublisher({ ...publisher, permissions: { ...publisher.permissions, administration: 'read' } }).code, 'PUBLISHER_FORBIDDEN_PERMISSION');
});

test('archive boundaries reject absolute, duplicate, oversized, and non-file entries', () => {
  assert.equal(runtime.validateEvidenceArchive([{ path: 'C:/outside.txt', kind: 'file', bytes: 'x' }]).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'evidence.txt', kind: 'file', bytes: 'x' }], { expectedPaths: ['other.txt'] }).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'evidence.txt', kind: 'file', bytes: 'x'.repeat(8) }], { maxBytes: 4 }).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'evidence.txt', kind: 'directory', bytes: '' }]).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');
});

test('workflow boundary rejects third-party actions and write-capable shell mutations', () => {
  const source = workflow.buildProtectedWorkflowTemplate();
  assert.equal(workflow.validateWorkflowSource(source.replace('actions/checkout@v4', 'third-party/unsafe@v1')).code, 'WORKFLOW_ACTION_FORBIDDEN');
  assert.equal(workflow.validateWorkflowSource(source.replace('git diff --check', 'git push origin main')).code, 'WORKFLOW_CANDIDATE_CODE');
});

test('diagnostic workflow cannot claim the reserved CI Gate name or finality surface', () => {
  const source = workflow.buildProtectedWorkflowTemplate();
  assert.equal(workflow.validateWorkflowSource(source).ok, true);
  assert.equal(workflow.validateWorkflowSource(source.replace('name: N6 CI diagnostics', 'name: CI Gate')).code, 'WORKFLOW_RESERVED_CONTEXT');
  assert.equal(workflow.validateWorkflowSource(source.replace('    name: N6 CI diagnostics', '    name: CI Gate')).code, 'WORKFLOW_RESERVED_CONTEXT');
  assert.equal(workflow.validateGateInvocation({}).code, 'WORKFLOW_NON_AUTHORITATIVE');
  assert.equal(workflow.validateWorkflowContract({
    ...JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'protected-ci-gate-workflow-contract.json'), 'utf8')),
    check_run_publication: true,
  }).ok, false);
});

test('protection boundary requires canonical A2 consent and blocks unreadable entitlement', (t) => {
  const unresolved = registryOptions(t);
  const enabled = registryOptions(t, 'enable');
  const disabled = registryOptions(t, 'decline');
  const publisherResult = runtime.reconcileProtectionForTest({ repository_id: effective.repository_id, publisher, effective }, unresolved);
  assert.equal(publisherResult.code, 'CONSENT_MISSING');
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: effective.repository_id, publisher, effective }, disabled).code, 'CAPABILITY_DENIED');
  assert.equal(runtime.reconcileProtectionForTest({ repository_id: effective.repository_id, consent: protectionConsent(), publisher, effective }, enabled).code, 'CONSENT_MISSING');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: effective.repository_id,
    publisher,
    effective: { ...effective, entitlement: { status: 'unreadable' } },
  }, enabled).code, 'PROTECTION_UNREADABLE');
});

test('production N6 rejects caller-selected test registry authority', (t) => {
  const selected = registryOptions(t, 'enable');
  const result = runtime.reconcileProtection({
    repository_id: effective.repository_id,
    capability_registry_options: selected,
    publisher,
    effective,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONSENT_MISSING');
});

test('malformed canonical A2 protection receipts and provenance fail closed in N6', (t) => {
  const receiptMismatch = registryOptions(t, 'enable');
  const receiptRegistry = JSON.parse(fs.readFileSync(receiptMismatch.registryPath, 'utf8'));
  const receiptCapability = receiptRegistry.repositories[0].capabilities.find((entry) => entry.capability_id === 'repository.protection');
  receiptCapability.receipt.receipt_id = '0'.repeat(64);
  fs.writeFileSync(receiptMismatch.registryPath, JSON.stringify(receiptRegistry), 'utf8');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: effective.repository_id,
    publisher,
    effective,
  }, receiptMismatch).code, 'CONSENT_MISSING');

  const provenanceMismatch = registryOptions(t, 'enable');
  const provenanceRegistry = JSON.parse(fs.readFileSync(provenanceMismatch.registryPath, 'utf8'));
  const provenanceCapability = provenanceRegistry.repositories[0].capabilities.find((entry) => entry.capability_id === 'repository.protection');
  provenanceCapability.provenance.scope_digest = '0'.repeat(64);
  fs.writeFileSync(provenanceMismatch.registryPath, JSON.stringify(provenanceRegistry), 'utf8');
  assert.equal(runtime.reconcileProtectionForTest({
    repository_id: effective.repository_id,
    publisher,
    effective,
  }, provenanceMismatch).code, 'CONSENT_MISSING');
});

test('unsupported modes cannot become authoritative gate or protection plans', () => {
  assert.equal(runtime.validateMode('advisory-only-unsupported').code, 'MODE_UNSUPPORTED');
  assert.equal(runtime.validateMode('secure-native', { complete: true, policy_semantics: true, readback: true, entitlement: true, publisher: true, extra: true }).code, 'MODE_UNSUPPORTED');
  assert.equal(runtime.validateMode('secure-native', { complete: true, policy_semantics: true, readback: true, entitlement: true, publisher: true }).ok, true);
});

const SERVER_PR = {
  repository_id: '1228006168',
  repository_full_name: 'weijunswj/ai-agent-toolkit',
  number: 357,
  head_repository_id: '1228006168',
  base_repository_id: '1228006168',
  head_sha: '0389ddc83535769a7907f360390b7077599b90ec',
  base_sha: '659722a48fc110ce531da7161a480e15fe2a6bf1',
  base_ref: 'main',
  merge_sha: 'f9cd4df07b4e714aaf9c95622b813350eaa67b33',
  changed_files: 4,
};

function serverPathPages() {
  return [{
    items: [
      { filename: '_projects/cicd/trusted-ci-repository-protection/SOURCE-LOCK.json', status: 'added', previous_filename: null },
      { filename: '_projects/cicd/trusted-ci-repository-protection/_main/trusted-ci-repository-protection-policy.json', status: 'added', previous_filename: null },
      { filename: 'repo/scripts/toolkit-trusted-ci-repository-protection.cjs', status: 'added', previous_filename: null },
      { filename: 'repo/tests/toolkit-trusted-ci-repository-protection.test.cjs', status: 'added', previous_filename: null },
    ],
    has_next: false,
  }];
}

function serverRemovedPathPages() {
  return [{
    items: [
      { filename: '_projects/cicd/trusted-ci-repository-protection/SOURCE-LOCK.json', status: 'removed', previous_filename: null },
      { filename: '_projects/cicd/trusted-ci-repository-protection/_main/trusted-ci-repository-protection-policy.json', status: 'added', previous_filename: null },
      { filename: 'repo/scripts/toolkit-trusted-ci-repository-protection.cjs', status: 'added', previous_filename: null },
      { filename: 'repo/tests/toolkit-trusted-ci-repository-protection.test.cjs', status: 'added', previous_filename: null },
    ],
    has_next: false,
  }];
}

function serverSourceBinding(overrides = {}) {
  const blob = '68af6b048e5d660002987d0bdbd7b04b72b7b522';
  return {
    repository_id: SERVER_PR.repository_id,
    pr: SERVER_PR.number,
    head_sha: SERVER_PR.head_sha,
    base_sha: SERVER_PR.base_sha,
    base_ref: SERVER_PR.base_ref,
    merge_sha: SERVER_PR.merge_sha,
    workflow_id: runtime.PRODUCER_MAP.workflow.id,
    workflow_path: runtime.PRODUCER_MAP.workflow.path,
    event: 'pull_request',
    source: {
      approved: { ref: 'refs/heads/main', path: runtime.PRODUCER_MAP.workflow.path, blob_sha: blob },
      base: { revision_sha: SERVER_PR.base_sha, path: runtime.PRODUCER_MAP.workflow.path, blob_sha: blob },
      head: { revision_sha: SERVER_PR.head_sha, path: runtime.PRODUCER_MAP.workflow.path, blob_sha: blob },
      merge: { revision_sha: SERVER_PR.merge_sha, path: runtime.PRODUCER_MAP.workflow.path, blob_sha: blob },
    },
    ...overrides,
  };
}

function serverRunEvidence(overrides = {}) {
  return {
    id: '32634652935',
    workflow_id: runtime.PRODUCER_MAP.workflow.id,
    path: runtime.PRODUCER_MAP.workflow.path,
    event: 'pull_request',
    repository_id: SERVER_PR.repository_id,
    head_sha: SERVER_PR.head_sha,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{
      number: SERVER_PR.number,
      repository_id: SERVER_PR.repository_id,
      head_repository_id: SERVER_PR.head_repository_id,
      base_repository_id: SERVER_PR.base_repository_id,
      head_sha: SERVER_PR.head_sha,
      base_sha: SERVER_PR.base_sha,
      base_ref: SERVER_PR.base_ref,
    }],
    ...overrides,
  };
}

function serverJobEvidence(overrides = {}) {
  return {
    id: '97182471868',
    name: 'validate',
    run_id: '32634652935',
    run_attempt: 1,
    head_sha: SERVER_PR.head_sha,
    status: 'completed',
    conclusion: 'success',
    steps: [{ number: 5, name: 'Run validation', status: 'completed', conclusion: 'success' }],
    ...overrides,
  };
}

function serverEvidenceFixture(overrides = {}, pages = serverPathPages()) {
  const paths = runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages });
  assert.equal(paths.ok, true, paths.code);
  const admission = runtime.validateWorkflowRunAdmission({
    pull_request: SERVER_PR,
    run: serverRunEvidence(),
    jobs: [serverJobEvidence()],
  });
  assert.equal(admission.ok, true, admission.code);
  const built = runtime.buildServerEvidence({
    pull_request: SERVER_PR,
    changed_paths: paths.changed_paths,
    source_binding: serverSourceBinding(),
    admission,
    generation: 1,
    ...overrides,
  });
  assert.equal(built.ok, true, built.code);
  return built.evidence;
}

test('server evidence binds base, head, merge source blobs and excludes local diff hygiene', () => {
  const paths = runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages: serverPathPages() });
  assert.equal(paths.ok, true, paths.code);
  const manifest = runtime.compositionManifest(paths.changed_paths.records.map((entry) => entry.path));
  assert.equal(manifest.ok, true, manifest.code);
  assert.deepEqual(manifest.required_components, ['project-sync', 'source-lock-audit', 'fallback-risk-audit', 'toolkit-validator', 'repository-tests']);
  assert.equal(manifest.required_components.includes('git-diff-check'), false);

  const evidence = serverEvidenceFixture();
  assert.equal(runtime.validateServerEvidence(evidence).ok, true);
  assert.equal(runtime.serverCheckRunIdentity(evidence).ok, true);
  assert.deepEqual(Object.keys(runtime.serverCheckRunIdentity(evidence).identity), [
    'repository_id', 'pr', 'head_sha', 'base_sha', 'merge_sha', 'workflow_id', 'workflow_path',
    'approved_source_blob_sha', 'run_id', 'run_attempt', 'job_id', 'job_name', 'step_number',
    'step_name', 'producer_map_digest', 'changed_paths_digest', 'contract_digest', 'generation',
  ]);
  assert.equal(runtime.serverPublicationRequest({
    evidence,
    publisher,
    conclusion: 'success',
    summary: 'Server-certified CI Gate.',
    details_url: null,
  }).ok, true);
});

test('GitHub removed status flows from changed-path collection into canonical server evidence', () => {
  const pages = serverRemovedPathPages();
  const paths = runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages });
  assert.equal(paths.ok, true, paths.code);
  assert.deepEqual(paths.changed_paths.records.find((record) => record.path.endsWith('/SOURCE-LOCK.json')), {
    path: '_projects/cicd/trusted-ci-repository-protection/SOURCE-LOCK.json',
    status: 'removed',
    previous_path: null,
  });
  assert.equal(paths.changed_paths.count, SERVER_PR.changed_files);
  assert.match(paths.changed_paths.digest, /^[a-f0-9]{64}$/);

  const evidence = serverEvidenceFixture({}, pages);
  const validated = runtime.validateServerEvidence(evidence, {
    repository_id: SERVER_PR.repository_id,
    pr: SERVER_PR.number,
    head_sha: SERVER_PR.head_sha,
    base_sha: SERVER_PR.base_sha,
    merge_sha: SERVER_PR.merge_sha,
  });
  assert.equal(validated.ok, true, validated.code);
  assert.equal(validated.evidence.changed_paths.count, SERVER_PR.changed_files);
  assert.equal(validated.evidence.changed_paths.digest, paths.changed_paths.digest);
  assert.equal(validated.evidence.changed_paths.records.find((record) => record.status === 'removed').previous_path, null);
});

test('unsupported deleted provider status fails closed as PATH_INVALID', () => {
  const pages = serverRemovedPathPages();
  pages[0].items[0] = { ...pages[0].items[0], status: 'deleted' };
  assert.equal(runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages }).code, 'PATH_INVALID');
});

test('checked-in server evidence fixture is closed, current, and digest-valid', () => {
  const result = runtime.validateServerEvidence(serverEvidenceFixtureFile, {
    repository_id: SERVER_PR.repository_id,
    pr: SERVER_PR.number,
    head_sha: SERVER_PR.head_sha,
    base_sha: SERVER_PR.base_sha,
    merge_sha: SERVER_PR.merge_sha,
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(result.required_component_ids.includes('git-diff-check'), false);
});

test('server source binding fails candidate policy changes and merge-source drift', () => {
  const candidateChanged = serverSourceBinding();
  candidateChanged.source.head.blob_sha = 'a'.repeat(40);
  assert.equal(runtime.validateWorkflowSourceBinding(candidateChanged).code, 'CI_POLICY_CHANGE_REQUIRED');

  const mergeChanged = serverSourceBinding();
  mergeChanged.source.merge.blob_sha = 'b'.repeat(40);
  assert.equal(runtime.validateWorkflowSourceBinding(mergeChanged).code, 'WORKFLOW_SOURCE_MISMATCH');
});

test('server changed-path collection fails truncation, count drift, duplicates, and malformed paths', () => {
  const incomplete = serverPathPages();
  incomplete[0].has_next = true;
  assert.equal(runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages: incomplete }).code, 'CHANGED_PATHS_INCOMPLETE');

  const countDrift = { ...SERVER_PR, changed_files: SERVER_PR.changed_files + 1 };
  assert.equal(runtime.validateChangedPathCollection({ pull_request: countDrift, pages: serverPathPages() }).code, 'CHANGED_FILES_COUNT_MISMATCH');

  const duplicate = serverPathPages();
  duplicate[0].items[1] = { ...duplicate[0].items[0] };
  assert.equal(runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages: duplicate }).code, 'PATH_DUPLICATE');

  const malformed = serverPathPages();
  malformed[0].items[0].filename = '../outside';
  assert.equal(runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages: malformed }).code, 'PATH_INVALID');

  const backslash = serverPathPages();
  backslash[0].items[0].filename = 'repo\\scripts\\runtime.cjs';
  assert.equal(runtime.validateChangedPathCollection({ pull_request: SERVER_PR, pages: backslash }).code, 'PATH_INVALID');
});

test('server run admission selects the current attempt and rejects duplicate or non-success evidence', () => {
  const failedLatest = runtime.selectAdmissibleWorkflowRun([
    serverRunEvidence(),
    serverRunEvidence({ run_attempt: 2, conclusion: 'failure' }),
  ], {
    repository_id: SERVER_PR.repository_id,
    pr: SERVER_PR.number,
    head_repository_id: SERVER_PR.head_repository_id,
    base_repository_id: SERVER_PR.base_repository_id,
    head_sha: SERVER_PR.head_sha,
    base_sha: SERVER_PR.base_sha,
    base_ref: SERVER_PR.base_ref,
  });
  assert.equal(failedLatest.code, 'RUN_CONCLUSION_NOT_SUCCESS');

  const duplicate = runtime.selectAdmissibleWorkflowRun([
    serverRunEvidence(),
    serverRunEvidence({ id: '32634652936' }),
  ], {
    repository_id: SERVER_PR.repository_id,
    pr: SERVER_PR.number,
    head_repository_id: SERVER_PR.head_repository_id,
    base_repository_id: SERVER_PR.base_repository_id,
    head_sha: SERVER_PR.head_sha,
    base_sha: SERVER_PR.base_sha,
    base_ref: SERVER_PR.base_ref,
  });
  assert.equal(duplicate.code, 'RUN_AMBIGUOUS');

  const skippedJob = runtime.validateWorkflowRunAdmission({
    pull_request: SERVER_PR,
    run: serverRunEvidence(),
    jobs: [serverJobEvidence({ conclusion: 'cancelled' })],
  });
  assert.equal(skippedJob.code, 'JOB_CONCLUSION_NOT_SUCCESS');

  const missingStep = runtime.validateWorkflowRunAdmission({
    pull_request: SERVER_PR,
    run: serverRunEvidence(),
    jobs: [serverJobEvidence({ steps: [] })],
  });
  assert.equal(missingStep.code, 'STEP_NOT_FOUND');

  const mergeGroup = runtime.selectAdmissibleWorkflowRun([
    serverRunEvidence({ event: 'merge_group' }),
  ], {
    repository_id: SERVER_PR.repository_id,
    pr: SERVER_PR.number,
    head_repository_id: SERVER_PR.head_repository_id,
    base_repository_id: SERVER_PR.base_repository_id,
    head_sha: SERVER_PR.head_sha,
    base_sha: SERVER_PR.base_sha,
    base_ref: SERVER_PR.base_ref,
  });
  assert.equal(mergeGroup.code, 'MERGE_GROUP_UNSUPPORTED');
  assert.equal(runtime.validateWorkflowSourceBinding({ ...serverSourceBinding(), event: 'merge_group' }).code, 'MERGE_GROUP_UNSUPPORTED');
});

test('server evidence rejects candidate-shaped inputs, digest drift, and wrong identity', () => {
  const evidence = serverEvidenceFixture();
  assert.equal(runtime.buildServerEvidence({
    pull_request: SERVER_PR,
    changed_paths: evidence.changed_paths,
    source_binding: serverSourceBinding(),
    admission: { ok: true, run: {}, job: {}, step: {} },
    generation: 1,
    component_results: [],
  }).code, 'CANDIDATE_ARTIFACT_FORBIDDEN');

  const digestDrift = { ...evidence, evidence_digest: '0'.repeat(64) };
  assert.equal(runtime.validateServerEvidence(digestDrift).code, 'EVIDENCE_DIGEST_MISMATCH');
  assert.equal(runtime.validateServerEvidence(evidence, { head_sha: 'a'.repeat(40) }).code, 'HEAD_MOVED');
});

test('local diff hygiene remains mandatory but is never server component authority', () => {
  assert.equal(runtime.validateLocalDiffHygiene({
    command: 'git diff --check',
    status: 'success',
    conclusion: 'success',
    producer: runtime.LOCAL_HYGIENE_COMPONENT_PRODUCER,
  }).authoritative_for_server_components, false);
  assert.equal(runtime.validateLocalDiffHygiene({
    command: 'git diff --check',
    status: 'success',
    conclusion: 'success',
    producer: runtime.SERVER_COMPONENT_PRODUCER,
  }).code, 'PRODUCER_MISMATCH');
});
