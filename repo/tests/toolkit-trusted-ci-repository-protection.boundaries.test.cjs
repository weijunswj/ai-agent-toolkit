'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtime = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection.cjs'));
const workflow = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection-workflow.cjs'));
const publisher = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'fixtures', 'publisher.n6.json'), 'utf8'));
const effective = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'fixtures', 'effective-protection.n6.json'), 'utf8'));

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

test('protection boundary requires explicit consent and blocks unreadable entitlement', () => {
  const publisherResult = runtime.reconcileProtection({ repository_id: effective.repository_id, publisher, effective });
  assert.equal(publisherResult.code, 'CONSENT_MISSING');
  assert.equal(runtime.reconcileProtection({
    repository_id: effective.repository_id,
    consent: { capability_id: 'repository.protection', state: 'enabled' },
    publisher,
    effective: { ...effective, entitlement: { status: 'unreadable' } },
  }).code, 'PROTECTION_UNREADABLE');
});

test('unsupported modes cannot become authoritative gate or protection plans', () => {
  assert.equal(runtime.validateMode('advisory-only-unsupported').code, 'MODE_UNSUPPORTED');
  assert.equal(runtime.validateMode('secure-native', { complete: true, policy_semantics: true, readback: true, entitlement: true, publisher: true, extra: true }).code, 'MODE_UNSUPPORTED');
  assert.equal(runtime.validateMode('secure-native', { complete: true, policy_semantics: true, readback: true, entitlement: true, publisher: true }).ok, true);
});
