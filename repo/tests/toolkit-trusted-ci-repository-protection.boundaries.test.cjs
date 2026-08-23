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
  assert.equal(runtime.validateEvidence({ schema: runtime.EVIDENCE_SCHEMA, extra: true }).code, 'UNKNOWN_FIELD');
  assert.equal(runtime.validatePublisher({ ...publisher, extra: true }).code, 'PRODUCER_MISMATCH');
  assert.equal(runtime.validatePublisher({ ...publisher, permissions: { ...publisher.permissions, administration: 'read' } }).code, 'PUBLISHER_FORBIDDEN_PERMISSION');
});

test('archive boundaries reject absolute, duplicate, oversized, and non-file entries', () => {
  assert.equal(runtime.validateEvidenceArchive([{ path: 'C:/outside.txt', kind: 'file', bytes: 'x' }]).code, 'ARCHIVE_INVALID');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'evidence.txt', kind: 'file', bytes: 'x' }], { expectedPaths: ['other.txt'] }).code, 'ARCHIVE_INVALID');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'evidence.txt', kind: 'file', bytes: 'x'.repeat(8) }], { maxBytes: 4 }).code, 'ARCHIVE_INVALID');
  assert.equal(runtime.validateEvidenceArchive([{ path: 'evidence.txt', kind: 'directory', bytes: '' }]).code, 'ARCHIVE_INVALID');
});

test('workflow boundary rejects third-party actions and write-capable shell mutations', () => {
  const source = workflow.buildProtectedWorkflowTemplate();
  assert.equal(workflow.validateWorkflowSource(source.replace('actions/checkout@v4', 'third-party/unsafe@v1')).code, 'WORKFLOW_ACTION_FORBIDDEN');
  assert.equal(workflow.validateWorkflowSource(source.replace('git diff --check', 'git push origin main')).code, 'WORKFLOW_CANDIDATE_CODE');
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
