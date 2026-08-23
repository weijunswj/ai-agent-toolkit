'use strict';

const crypto = require('node:crypto');

const capabilityRegistry = require('./toolkit-capability-registry.cjs');

const CONTRACT_VERSION = 'toolkit.n6.trusted-ci-repository-protection.v1';
const EVIDENCE_SCHEMA = 'toolkit.n6.ci-evidence.v1';
const PUBLISHER_PROTOCOL_VERSION = 'toolkit.n6.app-publisher.v1';
const DESIRED_PROTECTION_SCHEMA = 'toolkit.n6.desired-protection.v1';
const EFFECTIVE_PROTECTION_SCHEMA = 'toolkit.n6.effective-protection.v1';
const GATE_CONTEXT = 'CI Gate';
const EXTERNAL_ID_PREFIX = 'n6-ci-gate-v1:';
const DEFAULT_BRANCH = 'main';
const DEFAULT_RULESET_ID = 'n6-ci-gate-v1';

const MODES = Object.freeze(['secure-minimal-app', 'secure-native', 'advisory-only-unsupported']);
const ACTIVE_BASELINE_MODE = 'secure-minimal-app';
const GATE_STATES = Object.freeze([
  'absent',
  'queued',
  'collecting',
  'verifying',
  'publish-pending',
  'in-progress',
  'success',
  'failure',
  'cancelled',
  'timed-out',
  'stale',
  'superseded',
  'ambiguous',
]);

const ERROR_CODES = Object.freeze([
  'identity_mismatch',
  'consent_missing',
  'capability_denied',
  'evidence_incomplete',
  'evidence_stale',
  'head_moved',
  'base_moved',
  'merge_moved',
  'component_missing',
  'component_skipped',
  'component_duplicate',
  'producer_mismatch',
  'superseded',
  'publication_ambiguous',
  'protection_unreadable',
  'ownership_ambiguous',
  'entitlement_unsupported',
  'mode_unsupported',
  'prewrite_movement',
  'readback_mismatch',
  'rollback_unsafe',
  'unknown_relevant_path',
  'dependency_setup_missing',
  'archive_invalid',
  'unknown_field',
  'publisher_forbidden_permission',
  'commit_status_forbidden',
  'live_mutation_forbidden',
  'gate_transition_invalid',
  'evidence_duplicate',
].map((code) => code.toUpperCase()));

const COMPONENT_DEFINITIONS = Object.freeze([
  {
    id: 'repo-doc-contract',
    owned_path_classes: ['repo-docs'],
    applicability: 'changed path matches repo-docs',
    command: 'node repo/scripts/validate-toolkit.cjs --docs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'project-sync',
    owned_path_classes: ['project-source', 'project-manifest', 'source-lock'],
    applicability: 'changed path matches project-source or project-manifest',
    command: 'node repo/scripts/sync-toolkit-projects.cjs --check',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'source-lock-audit',
    owned_path_classes: ['source-lock'],
    applicability: 'changed path matches source-lock',
    command: 'node repo/scripts/audit-project-source-locks.cjs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'published-surface-audit',
    owned_path_classes: ['published-surface'],
    applicability: 'changed path matches published-surface',
    command: 'node repo/scripts/audit-published-surfaces.cjs --check',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'fallback-risk-audit',
    owned_path_classes: ['runtime-source', 'project-source', 'repo-docs'],
    applicability: 'changed path can affect fallback behavior',
    command: 'node repo/scripts/audit-fallback-risk.cjs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'toolkit-validator',
    owned_path_classes: ['runtime-source', 'workflow-contract', 'package-manifest'],
    applicability: 'changed runtime, workflow, or package contract',
    command: 'node repo/scripts/validate-toolkit.cjs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'repository-tests',
    owned_path_classes: ['repository-tests'],
    applicability: 'changed repository test layer',
    command: 'node --test repo/tests/*.test.cjs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-test',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'skill-package-check',
    owned_path_classes: ['published-surface'],
    applicability: 'changed skill surface',
    command: 'node repo/scripts/package-skills.cjs --check',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'skill-portability',
    owned_path_classes: ['published-surface'],
    applicability: 'changed skill surface',
    command: 'node repo/scripts/audit-skill-portability.cjs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'pack-package-check',
    owned_path_classes: ['pack-surface'],
    applicability: 'changed pack surface',
    command: 'node repo/scripts/package-packs.cjs --check',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'design-tests',
    owned_path_classes: ['design-source'],
    applicability: 'changed design source',
    command: 'node repo/scripts/run-design-tests.cjs',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-test',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required-when-applicable',
    not_applicable_predicate: 'protected-base-path-class-evaluation',
  },
  {
    id: 'git-diff-check',
    owned_path_classes: ['all-repository-paths'],
    applicability: 'every protected candidate',
    command: 'git diff --check',
    toolchain: 'git',
    dependency_setup: 'protected-git-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: 'protected-ci-gate',
    mandatory_status: 'required',
    not_applicable_predicate: 'never-for-protected-candidate',
  },
]);

const COMPONENT_IDS = Object.freeze(COMPONENT_DEFINITIONS.map((component) => component.id));
const NON_CI_EVIDENCE = Object.freeze([
  'provider-live-uat',
  'production-deployment',
  'github-app-installation',
  'owner-consent',
  'native-host-uat',
]);
const FORBIDDEN_AUTHORITATIVE_TRIGGERS = Object.freeze([
  'pull_request',
  'feature-branch-push',
  'workflow_dispatch',
  'workflow_run',
  'workflow_call',
  'schedule',
  'issue-comment',
  'repository_dispatch',
  'candidate-owned-workflow',
]);

const PATH_CLASS_RULES = Object.freeze([
  { name: 'repo-docs', match: (path) => path === 'README.md' || path.startsWith('repo/docs/') },
  { name: 'project-manifest', match: (path) => path.startsWith('_projects/') && path.endsWith('/toolkit.project.json') },
  { name: 'project-source', match: (path) => path.startsWith('_projects/') && path.includes('/_main/') },
  { name: 'source-lock', match: (path) => path.startsWith('_projects/') && path.endsWith('/SOURCE-LOCK.json') },
  { name: 'published-surface', match: (path) => path.startsWith('skills/') || path.startsWith('.codex-plugin/') || path.startsWith('.claude-plugin/') },
  { name: 'pack-surface', match: (path) => path.startsWith('skills/') && path.includes('/packs/') },
  { name: 'runtime-source', match: (path) => path.startsWith('repo/scripts/') },
  { name: 'repository-tests', match: (path) => path.startsWith('repo/tests/') },
  { name: 'design-source', match: (path) => path.startsWith('_projects/design/') || path.startsWith('skills/ui-ux-') },
  { name: 'workflow-contract', match: (path) => path.startsWith('.github/') || path.endsWith('.workflow.yml') },
  { name: 'package-manifest', match: (path) => path === 'package.json' || path === 'package-lock.json' },
]);

const STATE_TRANSITIONS = Object.freeze({
  absent: Object.freeze({ initial: 'queued' }),
  queued: Object.freeze({ collect: 'collecting', cancel: 'cancelled', timeout: 'timed-out', supersede: 'superseded' }),
  collecting: Object.freeze({ verify: 'verifying', cancel: 'cancelled', timeout: 'timed-out', supersede: 'superseded' }),
  verifying: Object.freeze({ publish: 'publish-pending', fail: 'failure', stale: 'stale', cancel: 'cancelled', supersede: 'superseded', duplicate: 'ambiguous' }),
  'publish-pending': Object.freeze({ publish_start: 'in-progress', published: 'success', publish_failed: 'failure', uncertain: 'ambiguous', stale: 'stale', supersede: 'superseded' }),
  'in-progress': Object.freeze({ published: 'success', publish_failed: 'failure', uncertain: 'ambiguous', cancel: 'cancelled', timeout: 'timed-out', stale: 'stale', supersede: 'superseded' }),
  success: Object.freeze({ retry: 'queued', supersede: 'superseded' }),
  failure: Object.freeze({ retry: 'queued', supersede: 'superseded' }),
  cancelled: Object.freeze({ retry: 'queued', supersede: 'superseded' }),
  'timed-out': Object.freeze({ retry: 'queued', supersede: 'superseded' }),
  stale: Object.freeze({ retry: 'queued', supersede: 'superseded' }),
  superseded: Object.freeze({ retry: 'queued' }),
  ambiguous: Object.freeze({ readback_success: 'success', readback_failure: 'failure', supersede: 'superseded' }),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '0' : String(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalSerialize).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort().map((key) => `${canonicalSerialize(key)}:${canonicalSerialize(value[key])}`).join(',') + '}';
  throw new Error('canonical value invalid');
}

function digestValue(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isSafeText(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function failure(code, details = {}) {
  return { ...details, ok: false, status: 'blocked', code: String(code).toUpperCase() };
}

function success(data = {}) {
  return { ok: true, status: 'valid', ...data };
}

function normalizeRelativePath(value) {
  if (!isSafeText(value, 512)) return null;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..') || normalized.includes('//')) return null;
  return normalized;
}

function stripDigest(value) {
  const copy = clone(value);
  delete copy.evidence_digest;
  return copy;
}

function evidenceDigest(evidence) {
  return digestValue(stripDigest(evidence));
}

function validateTimestamp(value) {
  if (!isSafeText(value, 64)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith('Z');
}

function expectedEvidenceKeys() {
  return [
    'schema',
    'repository_id',
    'pr',
    'head_sha',
    'base_sha',
    'merge_sha',
    'protected_workflow',
    'run',
    'generation',
    'contract_version',
    'contract_digest',
    'component_results',
    'conclusion',
    'timestamps',
    'evidence_digest',
  ];
}

function validateComponentResult(component) {
  const keys = ['id', 'status', 'conclusion', 'mandatory', 'producer', 'artifact_digest'];
  if (!exactKeys(component, keys)) return failure('unknown_field');
  if (!COMPONENT_IDS.includes(component.id)) return failure('component_missing');
  if (!['success', 'failure', 'cancelled', 'skipped', 'timed-out', 'in-progress'].includes(component.status)) return failure('evidence_incomplete');
  if (!['success', 'failure', 'cancelled', 'skipped', 'timed-out', 'in-progress', 'not-applicable'].includes(component.conclusion)) return failure('evidence_incomplete');
  if (typeof component.mandatory !== 'boolean' || !isDigest(component.artifact_digest)) return failure('evidence_incomplete');
  if (!exactKeys(component.producer, ['workflow_identity', 'workflow_source_sha', 'run_id', 'attempt', 'generation'])) return failure('producer_mismatch');
  if (!isSafeText(component.producer.workflow_identity, 256) || !isSha(component.producer.workflow_source_sha)
    || !isSafeText(component.producer.run_id, 128) || !Number.isSafeInteger(component.producer.attempt)
    || component.producer.attempt < 1 || !Number.isSafeInteger(component.producer.generation) || component.producer.generation < 1) {
    return failure('producer_mismatch');
  }
  return success();
}

function evidenceBindingFailure(expected, evidence) {
  if (expected.repository_id && evidence.repository_id !== expected.repository_id) return 'identity_mismatch';
  if (expected.pr !== undefined && evidence.pr !== expected.pr) return 'identity_mismatch';
  if (expected.head_sha && evidence.head_sha !== expected.head_sha) return 'head_moved';
  if (expected.base_sha && evidence.base_sha !== expected.base_sha) return 'base_moved';
  if (expected.merge_sha && evidence.merge_sha !== expected.merge_sha) return 'merge_moved';
  if (expected.protected_workflow_identity && evidence.protected_workflow.identity !== expected.protected_workflow_identity) return 'producer_mismatch';
  if (expected.protected_workflow_source_sha && evidence.protected_workflow.source_sha !== expected.protected_workflow_source_sha) return 'producer_mismatch';
  if (expected.run_id && evidence.run.id !== expected.run_id) return 'evidence_stale';
  if (expected.attempt !== undefined && evidence.run.attempt !== expected.attempt) return 'evidence_stale';
  if (expected.generation !== undefined && evidence.generation !== expected.generation) return evidence.generation < expected.generation ? 'evidence_stale' : 'superseded';
  if (expected.contract_digest && evidence.contract_digest !== expected.contract_digest) return 'identity_mismatch';
  return null;
}

function validateEvidence(evidence, expected = {}) {
  if (!isRecord(evidence) || !exactKeys(evidence, expectedEvidenceKeys())) return failure('unknown_field');
  if (evidence.schema !== EVIDENCE_SCHEMA || !isSafeText(evidence.repository_id, 256) || !Number.isSafeInteger(evidence.pr) || evidence.pr < 1
    || !isSha(evidence.head_sha) || !isSha(evidence.base_sha) || !isSha(evidence.merge_sha)
    || !exactKeys(evidence.protected_workflow, ['identity', 'source_sha'])
    || !isSafeText(evidence.protected_workflow.identity, 256) || !isSha(evidence.protected_workflow.source_sha)
    || !exactKeys(evidence.run, ['id', 'attempt']) || !isSafeText(evidence.run.id, 128)
    || !Number.isSafeInteger(evidence.run.attempt) || evidence.run.attempt < 1
    || !Number.isSafeInteger(evidence.generation) || evidence.generation < 1
    || evidence.contract_version !== CONTRACT_VERSION || !isDigest(evidence.contract_digest)
    || !Array.isArray(evidence.component_results) || evidence.component_results.length > COMPONENT_IDS.length
    || !['success', 'failure', 'cancelled', 'timed-out', 'in-progress', 'not-applicable'].includes(evidence.conclusion)
    || !exactKeys(evidence.timestamps, ['started_at', 'completed_at'])
    || !validateTimestamp(evidence.timestamps.started_at) || !validateTimestamp(evidence.timestamps.completed_at)
    || !isDigest(evidence.evidence_digest)) return failure('evidence_incomplete');

  const seen = new Set();
  for (const component of evidence.component_results) {
    if (seen.has(component?.id)) return failure('component_duplicate');
    seen.add(component?.id);
    const result = validateComponentResult(component);
    if (!result.ok) return result;
  }
  const expectedComponentIds = Array.isArray(expected.component_ids) ? expected.component_ids : COMPONENT_IDS;
  const requiredComponentIds = Array.isArray(expected.required_component_ids) ? expected.required_component_ids : [];
  if (new Set(expectedComponentIds).size !== expectedComponentIds.length
    || requiredComponentIds.some((componentId) => !expectedComponentIds.includes(componentId))) return failure('component_missing');
  for (const componentId of expectedComponentIds) {
    if (!COMPONENT_IDS.includes(componentId) || !seen.has(componentId)) return failure('component_missing');
  }
  for (const component of evidence.component_results) {
    const expectedProducer = expected.producer;
    if (expectedProducer && (component.producer.workflow_identity !== expectedProducer.workflow_identity
      || component.producer.workflow_source_sha !== expectedProducer.workflow_source_sha
      || component.producer.run_id !== expectedProducer.run_id
      || component.producer.attempt !== expectedProducer.attempt
      || component.producer.generation !== expectedProducer.generation)) return failure('producer_mismatch');
    if (requiredComponentIds.includes(component.id) && component.mandatory !== true) return failure('component_skipped');
    if (component.mandatory && ['cancelled', 'skipped', 'in-progress'].includes(component.status)) return failure('component_skipped');
  }
  if (evidence.conclusion === 'success') {
    const successComponentIds = requiredComponentIds.length > 0 ? requiredComponentIds : expectedComponentIds;
    for (const componentId of successComponentIds) {
      const component = evidence.component_results.find((entry) => entry.id === componentId);
      if (!component || component.status !== 'success' || component.conclusion !== 'success') return failure('component_skipped');
    }
  }
  const bindingError = evidenceBindingFailure(expected, evidence);
  if (bindingError) return failure(bindingError);
  if (evidence.evidence_digest !== evidenceDigest(evidence)) return failure('evidence_stale');
  return success({ evidence: clone(evidence), evidence_digest: evidence.evidence_digest });
}

function validateEvidenceArchive(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length > 256) return failure('archive_invalid');
  const seen = new Set();
  const maxBytes = options.maxBytes || 4 * 1024 * 1024;
  let total = 0;
  for (const entry of entries) {
    if (!exactKeys(entry, ['path', 'kind', 'bytes']) || entry.kind !== 'file') return failure('archive_invalid');
    const relative = normalizeRelativePath(entry.path);
    if (!relative || seen.has(relative) || entry.bytes === undefined || entry.bytes === null) return failure('archive_invalid');
    if (!Buffer.isBuffer(entry.bytes) && typeof entry.bytes !== 'string') return failure('archive_invalid');
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes.length : Buffer.byteLength(entry.bytes, 'utf8');
    if (bytes > maxBytes || total + bytes > maxBytes) return failure('archive_invalid');
    seen.add(relative);
    total += bytes;
  }
  if (options.expectedPaths) {
    const expectedPaths = [...new Set(options.expectedPaths)];
    if (expectedPaths.length !== options.expectedPaths.length || expectedPaths.length !== entries.length
      || expectedPaths.some((entryPath) => !seen.has(entryPath))) return failure('archive_invalid');
  }
  return success({ entries: entries.map((entry) => ({ path: entry.path, kind: entry.kind, bytes: Buffer.isBuffer(entry.bytes) ? entry.bytes.length : Buffer.byteLength(String(entry.bytes), 'utf8') })) });
}

function validatePublisher(publisher, expected = {}) {
  const keys = ['kind', 'integration_id', 'installation_id', 'permissions', 'operations', 'source'];
  if (!exactKeys(publisher, keys) || publisher.kind !== 'github-app' || publisher.source !== 'trusted-protected-workflow'
    || !isSafeText(publisher.integration_id, 128) || !isSafeText(publisher.installation_id, 256)
    || ['actions', 'github-actions', 'github-actions-app'].includes(publisher.integration_id.toLowerCase())
    || /github[-_ ]?actions/i.test(publisher.integration_id)
    || (expected.integration_id && publisher.integration_id !== expected.integration_id)) return failure('producer_mismatch');
  const permissionKeys = ['checks', 'statuses', 'metadata', 'contents', 'pull_requests', 'actions', 'administration', 'deployments', 'secrets', 'issues', 'reviews', 'members', 'packages', 'webhooks'];
  if (!exactKeys(publisher.permissions, permissionKeys)) return failure('publisher_forbidden_permission');
  const expectedPermissions = {
    checks: 'write',
    statuses: 'write',
    metadata: 'read',
    contents: 'read',
    pull_requests: 'read',
    actions: 'read',
    administration: 'none',
    deployments: 'none',
    secrets: 'none',
    issues: 'none',
    reviews: 'none',
    members: 'none',
    packages: 'none',
    webhooks: 'none',
  };
  if (!exactKeys(publisher.operations, ['check_run_publication', 'expected_source_enrolment', 'commit_status_publication'])
    || publisher.operations.check_run_publication !== true
    || publisher.operations.expected_source_enrolment !== true) return failure('publisher_forbidden_permission');
  if (publisher.operations.commit_status_publication !== false) return failure('commit_status_forbidden');
  for (const key of permissionKeys) {
    if (!['none', 'read', 'write'].includes(publisher.permissions[key])) return failure('publisher_forbidden_permission');
    if (publisher.permissions[key] !== expectedPermissions[key]) return failure('publisher_forbidden_permission');
    if (['administration', 'deployments', 'secrets', 'issues', 'reviews', 'members', 'packages', 'webhooks'].includes(key) && publisher.permissions[key] !== 'none') return failure('publisher_forbidden_permission');
  }
  return success({ publisher: clone(publisher) });
}

function checkRunIdentity(input) {
  const keys = ['repository_id', 'pr', 'head_sha', 'base_sha', 'merge_sha', 'protected_workflow_identity', 'protected_workflow_source_sha', 'contract_digest', 'attempt', 'generation'];
  if (!exactKeys(input, keys) || !isSafeText(input.repository_id, 256) || !Number.isSafeInteger(input.pr) || input.pr < 1
    || !isSha(input.head_sha) || !isSha(input.base_sha) || !isSha(input.merge_sha)
    || !isSafeText(input.protected_workflow_identity, 256) || !isSha(input.protected_workflow_source_sha)
    || !isDigest(input.contract_digest) || !Number.isSafeInteger(input.attempt) || input.attempt < 1
    || !Number.isSafeInteger(input.generation) || input.generation < 1) return failure('identity_mismatch');
  const identity = clone(input);
  return success({
    context: GATE_CONTEXT,
    identity,
    external_id: EXTERNAL_ID_PREFIX + digestValue(identity),
  });
}

function publicationRequest(input) {
  const keys = ['identity', 'publisher', 'object', 'status', 'conclusion', 'summary', 'details_url'];
  if (isRecord(input) && input.object === 'commit_status') return failure('commit_status_forbidden');
  if (!exactKeys(input, keys) || !isRecord(input.identity) || input.status !== 'completed'
    || input.object !== 'check_run'
    || !['success', 'failure', 'cancelled', 'timed-out', 'neutral'].includes(input.conclusion)
    || !isSafeText(input.summary, 1024) || (input.details_url !== null && !isSafeText(input.details_url, 512))) return failure('evidence_incomplete');
  const identity = checkRunIdentity(input.identity);
  if (!identity.ok) return identity;
  const publisher = validatePublisher(input.publisher);
  if (!publisher.ok) return publisher;
  return success({
    context: GATE_CONTEXT,
    external_id: identity.external_id,
    status: input.status,
    conclusion: input.conclusion,
    summary: input.summary,
    details_url: input.details_url,
    publisher: publisher.publisher,
  });
}

function createFakePublisher(config = {}) {
  const records = new Map();
  const expected = config.expected || {};
  return {
    protocol_version: PUBLISHER_PROTOCOL_VERSION,
    records,
    publish(evidence, request) {
      const evidenceResult = validateEvidence(evidence, config.evidence_expected || {});
      if (!evidenceResult.ok) return evidenceResult;
      const publication = publicationRequest({
        identity: {
          repository_id: evidence.repository_id,
          pr: evidence.pr,
          head_sha: evidence.head_sha,
          base_sha: evidence.base_sha,
          merge_sha: evidence.merge_sha,
          protected_workflow_identity: evidence.protected_workflow.identity,
          protected_workflow_source_sha: evidence.protected_workflow.source_sha,
          contract_digest: evidence.contract_digest,
          attempt: evidence.run.attempt,
          generation: evidence.generation,
        },
        publisher: request?.publisher || expected.publisher,
        object: 'check_run',
        status: 'completed',
        conclusion: request?.conclusion || (evidence.conclusion === 'success' ? 'success' : 'failure'),
        summary: request?.summary || 'Bounded protected CI Gate result.',
        details_url: request?.details_url || null,
      });
      if (!publication.ok) return publication;
      if (expected.integration_id && publication.publisher.integration_id !== expected.integration_id) return failure('producer_mismatch');
      const prior = records.get(publication.external_id);
      const output = {
        context: GATE_CONTEXT,
        external_id: publication.external_id,
        status: publication.status,
        conclusion: publication.conclusion,
        summary: publication.summary,
        details_url: publication.details_url,
      };
      if (prior && canonicalSerialize(prior) !== canonicalSerialize(output)) return failure('publication_ambiguous');
      records.set(publication.external_id, output);
      return success({ publication: output, receipt_digest: digestValue(output) });
    },
    read(externalId) {
      return records.has(externalId) ? clone(records.get(externalId)) : null;
    },
  };
}

function initialGateState(identity) {
  const checked = checkRunIdentity(identity);
  if (!checked.ok) return checked;
  return { ok: true, state: 'queued', previous_state: 'absent', event: 'initial', identity: checked.identity, external_id: checked.external_id };
}

function transitionGateState(current, event, options = {}) {
  const currentState = typeof current === 'string' ? current : current?.state;
  if (!GATE_STATES.includes(currentState) || !isSafeText(event, 64)) return failure('gate_transition_invalid');
  if (event === 'duplicate') return failure('evidence_duplicate');
  const next = STATE_TRANSITIONS[currentState]?.[event];
  if (!next) return failure('gate_transition_invalid');
  if (options.identity) {
    const checked = checkRunIdentity(options.identity);
    if (!checked.ok) return checked;
    const currentIdentity = current?.identity;
    if (currentIdentity && canonicalSerialize(currentIdentity) !== canonicalSerialize(checked.identity)) {
      if (options.movement === 'head') return failure('head_moved');
      if (options.movement === 'base') return failure('base_moved');
      if (options.movement === 'merge') return failure('merge_moved');
      if (event !== 'retry' && event !== 'supersede') return failure('evidence_stale');
    }
  }
  if (event === 'uncertain') return { ok: true, state: 'ambiguous', previous_state: currentState, event, identity: current?.identity || options.identity || null };
  if (event === 'supersede') return { ok: true, state: 'superseded', previous_state: currentState, event, identity: current?.identity || options.identity || null };
  return { ok: true, state: next, previous_state: currentState, event, identity: current?.identity || options.identity || null };
}

function pathClasses(changedPath) {
  const normalized = normalizeRelativePath(changedPath);
  if (!normalized) return null;
  return PATH_CLASS_RULES.filter((rule) => rule.match(normalized)).map((rule) => rule.name);
}

function componentOwnersForPath(changedPath) {
  const classes = pathClasses(changedPath);
  if (!classes) return null;
  const owners = new Set(['git-diff-check']);
  for (const component of COMPONENT_DEFINITIONS) {
    if (component.owned_path_classes.some((pathClass) => classes.includes(pathClass))) owners.add(component.id);
  }
  return { path: normalizeRelativePath(changedPath), classes, owners: [...owners].sort() };
}

function compositionManifest(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return failure('unknown_relevant_path');
  const coverage = [];
  const required = new Set(['git-diff-check']);
  for (const changedPath of changedPaths) {
    const owner = componentOwnersForPath(changedPath);
    if (!owner || owner.owners.length === 1) return failure('unknown_relevant_path', { path: changedPath });
    coverage.push(owner);
    for (const componentId of owner.owners) required.add(componentId);
  }
  const components = COMPONENT_DEFINITIONS.map((component) => ({
    ...clone(component),
    applicability: required.has(component.id) ? 'required' : 'not-applicable',
  }));
  return success({
    schema: 'toolkit.n6.ci-composition.v1',
    components,
    required_components: [...required].sort((left, right) => COMPONENT_IDS.indexOf(left) - COMPONENT_IDS.indexOf(right)),
    path_coverage: coverage,
    non_ci_exclusions: [...NON_CI_EVIDENCE],
    fingerprint: digestValue({ components, required_components: [...required].sort(), path_coverage: coverage }),
  });
}

function validateOwningCICoverage(input = {}) {
  const changedPaths = Array.isArray(input.changed_paths) ? input.changed_paths : [];
  const manifestResult = input.manifest ? success({ manifest: input.manifest }) : compositionManifest(changedPaths);
  if (!manifestResult.ok) return manifestResult;
  const manifest = input.manifest || manifestResult;
  const required = manifest.required_components || [];
  const results = input.component_results || input.results || [];
  if (!Array.isArray(results)) return failure('component_missing');
  const byId = new Map();
  for (const result of results) {
    if (!isRecord(result) || !isSafeText(result.id, 128) || byId.has(result.id)) return failure('component_duplicate');
    byId.set(result.id, result);
  }
  for (const componentId of required) {
    const component = byId.get(componentId);
    if (!component) return failure('component_missing', { component_id: componentId });
    if (component.producer === 'candidate' || component.candidate_declared_not_applicable === true) return failure('producer_mismatch', { component_id: componentId });
    if (component.dependency_setup === false || component.dependency_setup === undefined && input.dependency_setup === false) return failure('dependency_setup_missing', { component_id: componentId });
    if (component.status === 'skipped' || component.status === 'cancelled' || component.conclusion === 'not-applicable') return failure('component_skipped', { component_id: componentId });
  }
  const nonCi = Array.isArray(input.non_ci_evidence) ? input.non_ci_evidence : [];
  if (nonCi.some((item) => !NON_CI_EVIDENCE.includes(item))) return failure('unknown_field');
  for (const item of nonCi) {
    if (byId.has(item)) return failure('producer_mismatch', { component_id: item });
  }
  if (changedPaths.some((path) => normalizeRelativePath(path)?.startsWith('_projects/')) && !required.includes('project-sync')) return failure('component_missing');
  if (changedPaths.some((path) => normalizeRelativePath(path)?.startsWith('.github/')) && (!required.includes('toolkit-validator') || !required.includes('git-diff-check'))) return failure('component_missing');
  return success({ manifest, coverage: manifest.path_coverage || [] });
}

function validateMode(mode, nativeProof = null) {
  if (!MODES.includes(mode)) return failure('mode_unsupported');
  if (mode === 'advisory-only-unsupported') return failure('mode_unsupported');
  if (mode === 'secure-native') {
    const proofKeys = ['complete', 'policy_semantics', 'readback', 'entitlement', 'publisher'];
    if (!isRecord(nativeProof) || !exactKeys(nativeProof, proofKeys) || proofKeys.some((key) => nativeProof[key] !== true)) return failure('mode_unsupported');
  }
  return success({ mode });
}

function activePublisher(publishers, expected = {}) {
  if (!Array.isArray(publishers) || publishers.length !== 1) return failure('publication_ambiguous');
  const publisher = validatePublisher(publishers[0], expected);
  if (!publisher.ok) return publisher;
  return success({ publisher: publisher.publisher });
}

function desiredProtectionProjection(input = {}) {
  if (!isSafeText(input.repository_id, 256) || input.default_branch !== DEFAULT_BRANCH) return failure('identity_mismatch');
  const modeResult = validateMode(input.mode || ACTIVE_BASELINE_MODE, input.native_proof);
  if (!modeResult.ok) return modeResult;
  if (!isSafeText(input.integration_id, 128) || ['actions', 'github-actions', 'github-actions-app'].includes(input.integration_id.toLowerCase())) return failure('producer_mismatch');
  const rulesetId = input.ruleset_id || DEFAULT_RULESET_ID;
  if (!isSafeText(rulesetId, 128)) return failure('identity_mismatch');
  const projection = {
    schema: DESIRED_PROTECTION_SCHEMA,
    repository_id: input.repository_id,
    default_branch: DEFAULT_BRANCH,
    mode: input.mode || ACTIVE_BASELINE_MODE,
    ruleset: {
      id: rulesetId,
      owner: 'N6',
      target: 'branch',
      branch: DEFAULT_BRANCH,
      enforcement: 'active',
      required_contexts: [{ context: GATE_CONTEXT, integration_id: input.integration_id }],
    },
    publisher: { integration_id: input.integration_id },
    n6_ownership: { owner: 'N6', version: 1 },
  };
  return success({ projection: { ...projection, fingerprint: digestValue(projection) }, fingerprint: digestValue(projection) });
}

function validateDesiredProtectionProjection(projection, nativeProof = null) {
  const keys = ['schema', 'repository_id', 'default_branch', 'mode', 'ruleset', 'publisher', 'n6_ownership', 'fingerprint'];
  if (!isRecord(projection) || !exactKeys(projection, keys) || projection.schema !== DESIRED_PROTECTION_SCHEMA
    || !isSafeText(projection.repository_id, 256) || projection.default_branch !== DEFAULT_BRANCH
    || !MODES.includes(projection.mode) || !isDigest(projection.fingerprint)
    || !exactKeys(projection.ruleset, ['id', 'owner', 'target', 'branch', 'enforcement', 'required_contexts'])
    || !isSafeText(projection.ruleset.id, 128) || projection.ruleset.owner !== 'N6'
    || projection.ruleset.target !== 'branch' || projection.ruleset.branch !== DEFAULT_BRANCH
    || projection.ruleset.enforcement !== 'active' || !Array.isArray(projection.ruleset.required_contexts)
    || projection.ruleset.required_contexts.length !== 1
    || !exactKeys(projection.publisher, ['integration_id']) || !isSafeText(projection.publisher.integration_id, 128)
    || !exactKeys(projection.n6_ownership, ['owner', 'version']) || projection.n6_ownership.owner !== 'N6'
    || projection.n6_ownership.version !== 1) return failure('identity_mismatch');
  const modeResult = validateMode(projection.mode, nativeProof);
  if (!modeResult.ok) return modeResult;
  const contexts = normalizeRequiredContexts(projection.ruleset.required_contexts);
  if (!contexts || contexts.length !== 1 || contexts[0].context !== GATE_CONTEXT
    || contexts[0].integration_id !== projection.publisher.integration_id) return failure('identity_mismatch');
  const withoutFingerprint = clone(projection);
  delete withoutFingerprint.fingerprint;
  if (projection.fingerprint !== digestValue(withoutFingerprint)) return failure('identity_mismatch');
  return success({ projection: clone(projection), fingerprint: projection.fingerprint });
}

function normalizeRequiredContexts(value) {
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const item of value) {
    if (!exactKeys(item, ['context', 'integration_id']) || !isSafeText(item.context, 256) || !isSafeText(item.integration_id, 128)) return null;
    result.push({ context: item.context, integration_id: item.integration_id });
  }
  return result.sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)));
}

function normalizeEffectiveRule(rule) {
  if (!isRecord(rule)) return null;
  const keys = ['id', 'name', 'owner_class', 'target', 'branch', 'enforcement', 'required_contexts', 'bypass_actors'];
  if (!exactKeys(rule, keys) || !isSafeText(rule.id, 128) || !isSafeText(rule.name, 256) || !isSafeText(rule.owner_class, 64)
    || !isSafeText(rule.target, 64) || !isSafeText(rule.branch, 256) || !isSafeText(rule.enforcement, 64)
    || !normalizeRequiredContexts(rule.required_contexts) || !Array.isArray(rule.bypass_actors)) return null;
  if (rule.bypass_actors.some((actor) => !isSafeText(actor, 128))) return null;
  return { ...rule, required_contexts: normalizeRequiredContexts(rule.required_contexts), bypass_actors: [...rule.bypass_actors].sort() };
}

function canonicalizeEffectiveProtection(effective) {
  const keys = ['schema', 'repository_id', 'default_branch', 'rulesets', 'organisation_rulesets', 'classic_branch_protection', 'actions_settings', 'workflows', 'app', 'entitlement'];
  if (!isRecord(effective) || !exactKeys(effective, keys) || effective.schema !== EFFECTIVE_PROTECTION_SCHEMA
    || !isSafeText(effective.repository_id, 256) || effective.default_branch !== DEFAULT_BRANCH
    || !Array.isArray(effective.rulesets) || !Array.isArray(effective.organisation_rulesets)
    || effective.rulesets.length > 128 || effective.organisation_rulesets.length > 128) return failure('protection_unreadable');
  const rulesets = effective.rulesets.map(normalizeEffectiveRule);
  const organisationRulesets = effective.organisation_rulesets.map(normalizeEffectiveRule);
  if (rulesets.some((rule) => !rule) || organisationRulesets.some((rule) => !rule)) return failure('protection_unreadable');
  if (effective.classic_branch_protection !== null && !isRecord(effective.classic_branch_protection)) return failure('protection_unreadable');
  if (!isRecord(effective.actions_settings) || !isRecord(effective.app) || !isRecord(effective.entitlement) || !Array.isArray(effective.workflows)
    || !['supported', 'unsupported', 'unreadable'].includes(effective.entitlement.status)) return failure('protection_unreadable');
  const normalized = {
    schema: EFFECTIVE_PROTECTION_SCHEMA,
    repository_id: effective.repository_id,
    default_branch: DEFAULT_BRANCH,
    rulesets: rulesets.sort((left, right) => left.id.localeCompare(right.id)),
    organisation_rulesets: organisationRulesets.sort((left, right) => left.id.localeCompare(right.id)),
    classic_branch_protection: clone(effective.classic_branch_protection),
    actions_settings: clone(effective.actions_settings),
    workflows: clone(effective.workflows).sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right))),
    app: clone(effective.app),
    entitlement: clone(effective.entitlement),
  };
  return success({ effective: normalized, fingerprint: digestValue(normalized) });
}

function classifyProtectionOwnership(effective, desired = null) {
  if (!isRecord(effective)) return failure('ownership_ambiguous');
  const rulesets = Array.isArray(effective.rulesets) ? effective.rulesets : [];
  const organisationRulesets = Array.isArray(effective.organisation_rulesets) ? effective.organisation_rulesets : [];
  const desiredId = desired?.ruleset?.id || DEFAULT_RULESET_ID;
  const desiredIntegration = desired?.ruleset?.required_contexts?.[0]?.integration_id;
  const classes = [];
  let n6 = null;
  let conflict = false;
  const seenRuleIds = new Set();
  const scopedRules = [
    ...rulesets.map((rule) => ({ rule, scope: 'repository' })),
    ...organisationRulesets.map((rule) => ({ rule, scope: 'organisation' })),
  ];
  for (const { rule, scope } of scopedRules) {
    const owner = String(rule.owner_class || rule.owner || rule.source || '').toLowerCase();
    if (seenRuleIds.has(rule.id)) conflict = true;
    seenRuleIds.add(rule.id);
    if (rule.id === desiredId && (scope !== 'repository' || rule.owner_class !== 'N6-owned')) conflict = true;
    const isN6 = scope === 'repository' && rule.owner_class === 'N6-owned' && rule.id === desiredId;
    if (isN6) {
      if (n6) conflict = true;
      n6 = rule;
      classes.push('N6-owned');
      const context = (rule.required_contexts || []).find((item) => item.context === GATE_CONTEXT);
      if (context && desiredIntegration && context.integration_id !== desiredIntegration) conflict = true;
    } else if (rule.owner_class === 'N6-owned') {
      conflict = true;
      classes.push('N6-owned');
    } else if (scope === 'organisation' || owner === 'organisation-managed' || owner === 'organization-managed') {
      classes.push('organisation-managed');
    } else if (owner === 'unknown' || owner === '') {
      classes.push('unknown');
      if (rule.name === 'protect-main' || (rule.required_contexts || []).some((item) => item.context === GATE_CONTEXT)) conflict = true;
    } else if (owner === 'owner-managed') {
      classes.push('owner-managed');
      if (rule.id === desiredId) conflict = true;
    } else if (['foreign', 'foreign-managed', 'external', 'external-managed', 'third-party', 'third-party-managed'].includes(owner)) {
      return failure('ownership_ambiguous', { ownership_class: 'overlapping-conflicting' });
    } else {
      classes.push('overlapping-compatible');
    }
  }
  if (conflict) return failure('ownership_ambiguous', { ownership_class: 'overlapping-conflicting', n6_rule: n6 });
  const ownershipClass = n6 ? 'N6-owned' : classes.includes('organisation-managed') ? 'organisation-managed' : classes.includes('owner-managed') ? 'owner-managed' : classes.includes('unknown') ? 'unknown' : classes.includes('overlapping-compatible') ? 'overlapping-compatible' : 'none';
  return success({ ownership_class: ownershipClass, ownership_classes: [...new Set(classes)], n6_rule: n6 });
}

function protectionDelta(desired, current) {
  const delta = {};
  for (const key of ['target', 'branch', 'enforcement', 'required_contexts']) {
    if (canonicalSerialize(desired.ruleset[key]) !== canonicalSerialize(current[key])) delta[key] = clone(desired.ruleset[key]);
  }
  return delta;
}

function buildMutationBinding(input) {
  const keys = ['repository_id', 'operation', 'target', 'desired_projection', 'consent', 'mode', 'publisher_integration_id', 'mutation_class', 'pre_read_fingerprint', 'expected_owned_delta'];
  if (!exactKeys(input, keys) || !isSafeText(input.repository_id, 256) || !isSafeText(input.operation, 128)
    || !isRecord(input.target) || !isRecord(input.desired_projection) || !isRecord(input.consent)
    || input.consent.status !== 'enabled' || input.consent.authority !== capabilityRegistry.PROTECTION_CONSENT_AUTHORITY
    || !isSafeText(input.mode, 128) || !isSafeText(input.publisher_integration_id, 128)
    || !isSafeText(input.mutation_class, 128) || !isDigest(input.pre_read_fingerprint) || !isRecord(input.expected_owned_delta)) return failure('identity_mismatch');
  const binding = {
    repository_id: input.repository_id,
    operation: input.operation,
    target_digest: digestValue(input.target),
    desired_projection_digest: input.desired_projection.fingerprint || digestValue(input.desired_projection),
    consent_digest: digestValue(input.consent),
    mode: input.mode,
    publisher_integration_id: input.publisher_integration_id,
    mutation_class: input.mutation_class,
    pre_read_fingerprint: input.pre_read_fingerprint,
    expected_owned_delta: clone(input.expected_owned_delta),
  };
  return success({ binding: { ...binding, operation_digest: digestValue(binding) } });
}

function validateProtectionConsent(consent, repositoryId, registryRevision = null) {
  if (!isRecord(consent) || consent.capability_id !== 'repository.protection') return failure('consent_missing');
  if (consent.state !== 'enabled' || consent.decision_kind !== 'enable') {
    return consent.state === 'disabled' ? failure('capability_denied') : failure('consent_missing');
  }
  if (!isRecord(consent.receipt) || consent.receipt.repository_id !== repositoryId) return failure('identity_mismatch');
  const currentRevision = registryRevision === null ? consent.receipt.registry_revision : registryRevision;
  const result = capabilityRegistry.validateProtectionCapability(consent, repositoryId, currentRevision);
  if (!result.ok) return failure('consent_missing');
  return success({ consent: clone(consent), registry_revision: result.registry_revision });
}

function readProtectionConsent(registryOptions, repositoryId) {
  if (!isSafeText(repositoryId, 256)) return failure('identity_mismatch');
  const options = isRecord(registryOptions) ? registryOptions : { cwd: process.cwd() };
  let authority;
  try {
    authority = capabilityRegistry.getRepositoryProtectionConsent(options);
  } catch (_error) {
    return failure('consent_missing');
  }
  const authorityKeys = ['authority', 'status', 'repository_id', 'canonical_remote', 'registry_revision', 'snapshot_hash', 'capability', 'reason_code'];
  if (!exactKeys(authority, authorityKeys)
    || authority.authority !== capabilityRegistry.PROTECTION_CONSENT_AUTHORITY) return failure('consent_missing');
  if (authority.status === 'actionable') return failure('consent_missing');
  if (authority.repository_id !== repositoryId) return failure('identity_mismatch');
  if (authority.status === 'disabled') return failure('capability_denied');
  if (authority.status !== 'enabled' || !isDigest(authority.snapshot_hash)
    || !Number.isSafeInteger(authority.registry_revision) || authority.registry_revision < 1
    || !isRecord(authority.capability)) return failure('consent_missing');
  const validated = validateProtectionConsent(authority.capability, repositoryId, authority.registry_revision);
  if (!validated.ok) return validated;
  return success({ consent: clone(authority), registry_revision: authority.registry_revision });
}

function reconcileProtection(input = {}) {
  const phase = input.phase || 'preview';
  if (!['inspect', 'canonicalize', 'fingerprint', 'compare', 'classify', 'preview', 'apply-plan', 'readback-verify', 'rollback-preview', 'rollback-plan'].includes(phase)) return failure('identity_mismatch');
  if (Object.prototype.hasOwnProperty.call(input, 'consent')
    || Object.prototype.hasOwnProperty.call(input, 'capability_status')) return failure('consent_missing');
  const consentResult = readProtectionConsent(input.capability_registry_options, input.repository_id);
  if (!consentResult.ok) return consentResult;
  const consent = consentResult.consent;
  const publisherResult = activePublisher(input.publishers || (input.publisher ? [input.publisher] : []), { integration_id: input.expected_integration_id });
  if (!publisherResult.ok) return publisherResult;
  const desiredResult = input.desired?.projection ? validateDesiredProtectionProjection(input.desired.projection, input.native_proof) : desiredProtectionProjection({
    repository_id: input.repository_id,
    default_branch: input.default_branch || DEFAULT_BRANCH,
    mode: input.mode || ACTIVE_BASELINE_MODE,
    integration_id: publisherResult.publisher.integration_id,
    ruleset_id: input.ruleset_id,
    native_proof: input.native_proof,
  });
  if (!desiredResult.ok) return desiredResult;
  const effectiveResult = canonicalizeEffectiveProtection(input.effective);
  if (!effectiveResult.ok) return effectiveResult;
  if (effectiveResult.effective.repository_id !== desiredResult.projection.repository_id) return failure('identity_mismatch');
  if (effectiveResult.effective.entitlement.status === 'unsupported') return failure('entitlement_unsupported');
  if (effectiveResult.effective.entitlement.status === 'unreadable') return failure('protection_unreadable');
  const ownership = classifyProtectionOwnership(effectiveResult.effective, desiredResult.projection);
  if (!ownership.ok) return ownership;
  if (ownership.ownership_class === 'unknown' || ownership.ownership_class === 'owner-managed' || ownership.ownership_class === 'overlapping-conflicting'
    || ownership.ownership_classes?.includes('owner-managed')) return failure('ownership_ambiguous');
  if (phase === 'inspect' || phase === 'canonicalize' || phase === 'fingerprint' || phase === 'classify') return success({ phase, desired: desiredResult.projection, effective: effectiveResult.effective, ownership: ownership.ownership_class, fingerprint: effectiveResult.fingerprint });
  if (phase === 'rollback-preview' || phase === 'rollback-plan') {
    if (!ownership.n6_rule || ownership.ownership_class !== 'N6-owned' || input.owner_changed === true || input.organisation_changed === true) return failure('rollback_unsafe');
    return success({ phase, action: 'rollback-n6-owned-delta-only', status: 'PLAN', delta: clone(input.rollback_delta || {}) });
  }
  const n6Rule = ownership.n6_rule;
  if (n6Rule && ownership.ownership_class === 'N6-owned') {
    const delta = protectionDelta(desiredResult.projection, n6Rule);
    if (Object.keys(delta).length === 0) return success({ phase, status: 'NOOP', code: 'NOOP', desired: desiredResult.projection, effective: effectiveResult.effective, ownership: ownership.ownership_class, fingerprint: effectiveResult.fingerprint });
    const binding = buildMutationBinding({
      repository_id: desiredResult.projection.repository_id,
      operation: 'n6.update-ruleset',
      target: { ruleset_id: n6Rule.id },
      desired_projection: desiredResult.projection,
      consent,
      mode: desiredResult.projection.mode,
      publisher_integration_id: publisherResult.publisher.integration_id,
      mutation_class: 'n6-owned-delta-only',
      pre_read_fingerprint: effectiveResult.fingerprint,
      expected_owned_delta: delta,
    });
    if (!binding.ok) return binding;
    return phase === 'apply-plan' ? failure('live_mutation_forbidden') : success({ phase, status: 'PLAN', action: 'update-ruleset', delta, binding: binding.binding, ownership: ownership.ownership_class });
  }
  const binding = buildMutationBinding({
    repository_id: desiredResult.projection.repository_id,
    operation: 'n6.create-ruleset',
    target: { ruleset_id: desiredResult.projection.ruleset.id },
    desired_projection: desiredResult.projection,
    consent,
    mode: desiredResult.projection.mode,
    publisher_integration_id: publisherResult.publisher.integration_id,
    mutation_class: 'n6-owned-dedicated-ruleset',
    pre_read_fingerprint: effectiveResult.fingerprint,
    expected_owned_delta: desiredResult.projection.ruleset,
  });
  if (!binding.ok) return binding;
  return phase === 'apply-plan' ? failure('live_mutation_forbidden') : success({ phase, status: 'PLAN', action: 'create-ruleset', delta: desiredResult.projection.ruleset, binding: binding.binding, ownership: ownership.ownership_class });
}

module.exports = {
  CONTRACT_VERSION,
  EVIDENCE_SCHEMA,
  PUBLISHER_PROTOCOL_VERSION,
  DESIRED_PROTECTION_SCHEMA,
  EFFECTIVE_PROTECTION_SCHEMA,
  GATE_CONTEXT,
  EXTERNAL_ID_PREFIX,
  MODES,
  ACTIVE_BASELINE_MODE,
  GATE_STATES,
  ERROR_CODES,
  COMPONENT_DEFINITIONS,
  COMPONENT_IDS,
  NON_CI_EVIDENCE,
  FORBIDDEN_AUTHORITATIVE_TRIGGERS,
  STATE_TRANSITIONS,
  canonicalSerialize,
  digestValue,
  evidenceDigest,
  validateEvidence,
  validateEvidenceArchive,
  validatePublisher,
  checkRunIdentity,
  publicationRequest,
  createFakePublisher,
  initialGateState,
  transitionGateState,
  validateGateTransition: transitionGateState,
  pathClasses,
  componentOwnersForPath,
  compositionManifest,
  buildCompositionManifest: compositionManifest,
  validateOwningCICoverage,
  validateMode,
  desiredProtectionProjection,
  validateDesiredProtectionProjection,
  validateProtectionConsent,
  readProtectionConsent,
  canonicalizeEffectiveProtection,
  classifyProtectionOwnership,
  buildMutationBinding,
  reconcileProtection,
};
