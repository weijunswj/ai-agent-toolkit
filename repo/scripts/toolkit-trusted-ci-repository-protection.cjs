'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const capabilityRegistry = require('./toolkit-capability-registry.cjs');

const CONTRACT_VERSION = 'toolkit.n6.trusted-ci-repository-protection.v1';
const EVIDENCE_SCHEMA = 'toolkit.n6.ci-evidence.v1';
const SERVER_EVIDENCE_SCHEMA = 'toolkit.n6.ci-server-evidence.v1';
const EVIDENCE_CONTRACT_DIGEST = crypto.createHash('sha256')
  .update(JSON.stringify({ contract_version: CONTRACT_VERSION, schema: EVIDENCE_SCHEMA }), 'utf8')
  .digest('hex');
const PUBLISHER_PROTOCOL_VERSION = 'toolkit.n6.app-publisher.v1';
const DESIRED_PROTECTION_SCHEMA = 'toolkit.n6.desired-protection.v1';
const EFFECTIVE_PROTECTION_SCHEMA = 'toolkit.n6.effective-protection.v1';
const GATE_CONTEXT = 'CI Gate';
const EXTERNAL_ID_PREFIX = 'n6-ci-gate-v1:';
const DEFAULT_BRANCH = 'main';
const DEFAULT_MANAGED_KEY = 'n6-ci-gate-v1';
const DEFAULT_RULESET_NAME = 'N6 CI Gate';
const OWNERSHIP_RECEIPT_SCHEMA = 'toolkit.n6.protection-ownership-receipt.v1';
const OWNERSHIP_MANAGED_DIRECTORY = path.join('.ai-agent-toolkit');
const OWNERSHIP_STATE_DIRECTORY = path.join('.ai-agent-toolkit', 'user-state', 'repository-protection');
const OWNERSHIP_RECEIPT_BASENAME = 'ownership.v1.json';
const MAX_OWNERSHIP_RECEIPT_BYTES = 64 * 1024;
const OWNERSHIP_RECEIPT_OPERATIONS = Object.freeze(['create-managed-ruleset', 'update-managed-ruleset']);
const PRODUCER_MAP_PATH = path.resolve(__dirname, '..', '..', '_projects', 'cicd', 'trusted-ci-repository-protection', '_main', 'candidate-producer-map.n6.json');
const SERVER_COMPONENT_PRODUCER = 'github-actions-server';
const LOCAL_HYGIENE_COMPONENT_PRODUCER = 'local-executor-only';
const MAX_CHANGED_FILES = 3000;
const MAX_CHANGED_PATH_PAGES = 30;
const MAX_CHANGED_PATH_PAGE_SIZE = 100;
const MAX_CHANGED_PATH_RESPONSE_BYTES = 32 * 1024 * 1024;
const CHANGED_PATH_SOURCE = 'github-pull-request-files';
const SERVER_COMPONENT_PROOF = 'server-workflow-step';
const WORKFLOW_RUN_PULL_REQUEST_KEYS = Object.freeze([
  'number',
  'repository_id',
  'head_repository_id',
  'base_repository_id',
  'head_sha',
  'base_sha',
  'base_ref',
]);

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
  'component_failed',
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
  'workflow_non_authoritative',
  'workflow_not_found',
  'workflow_path_mismatch',
  'workflow_source_mismatch',
  'ci_policy_change_required',
  'run_not_found',
  'run_not_completed',
  'run_conclusion_not_success',
  'run_attempt_stale',
  'run_duplicate',
  'run_ambiguous',
  'job_not_found',
  'job_not_completed',
  'job_conclusion_not_success',
  'job_duplicate',
  'step_not_found',
  'step_not_completed',
  'step_conclusion_not_success',
  'step_duplicate',
  'required_command_not_proven',
  'candidate_artifact_forbidden',
  'local_synthetic_evidence_forbidden',
  'evidence_schema_invalid',
  'evidence_identity_mismatch',
  'evidence_digest_mismatch',
  'merge_group_unsupported',
  'changed_paths_ambiguous',
  'changed_files_count_mismatch',
  'pagination_limit_exceeded',
  'path_invalid',
  'path_duplicate',
  'read_race',
  'ownership_receipt_invalid',
  'ownership_store_invalid',
].map((code) => code.toUpperCase()));

const COMPONENT_DEFINITIONS = Object.freeze([
  {
    id: 'repo-doc-contract',
    owned_path_classes: ['repo-docs'],
    applicability: 'changed path matches repo-docs',
    command: 'node repo/scripts/sync-repo-doc-contract.cjs --check',
    toolchain: 'node',
    dependency_setup: 'repository-node-toolchain',
    result_type: 'deterministic-check',
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: SERVER_COMPONENT_PRODUCER,
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
    artifact_producer: LOCAL_HYGIENE_COMPONENT_PRODUCER,
    mandatory_status: 'required',
    not_applicable_predicate: 'never-for-protected-candidate',
  },
]);

const COMPONENT_IDS = Object.freeze(COMPONENT_DEFINITIONS.map((component) => component.id));
const PRODUCER_MAP = loadProducerMap();
const PRODUCER_MAP_DIGEST = digestValue(PRODUCER_MAP);
const SERVER_COMPONENT_IDS = Object.freeze([...PRODUCER_MAP.server_authoritative_components]);
const NON_AUTHORITATIVE_COMPONENT_IDS = Object.freeze([...PRODUCER_MAP.non_authoritative_components]);
const SERVER_EVIDENCE_CONTRACT_DIGEST = crypto.createHash('sha256')
  .update(JSON.stringify({ contract_version: CONTRACT_VERSION, schema: SERVER_EVIDENCE_SCHEMA, producer_map_digest: PRODUCER_MAP_DIGEST }), 'utf8')
  .digest('hex');
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
  { name: 'project-manifest', match: (path) => /^_projects\/[^/]+\/[^/]+\/(?:toolkit\.project\.json|README\.md|SOURCE-MANIFEST\.md)$/.test(path) },
  { name: 'project-source', match: (path) => /^_projects\/[^/]+\/[^/]+\/.+/.test(path) },
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

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function loadProducerMap() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(PRODUCER_MAP_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`N6 producer map unavailable: ${error.message}`);
  }
  const result = validateProducerMap(parsed);
  if (!result.ok) throw new Error(`N6 producer map invalid: ${result.code}`);
  return deepFreeze(clone(parsed));
}

function validateProducerMap(map) {
  const keys = ['schema', 'version', 'workflow', 'limits', 'commands', 'server_authoritative_components', 'non_authoritative_components'];
  const workflowKeys = ['id', 'path', 'event', 'approved_ref', 'approved_source_blob_sha', 'job', 'aggregate_step', 'source_revisions'];
  const limitKeys = ['files_per_page', 'max_files', 'max_pages', 'max_response_bytes'];
  const commandKeys = ['id', 'command', 'path_classes'];
  if (!exactKeys(map, keys) || map.schema !== 'toolkit.n6.candidate-producer-map.v1' || map.version !== 1
    || !exactKeys(map.workflow, workflowKeys) || !exactKeys(map.workflow.job, ['name'])
    || !exactKeys(map.workflow.aggregate_step, ['number', 'name', 'fail_fast'])
    || !exactKeys(map.limits, limitKeys) || !Array.isArray(map.commands)
    || !Array.isArray(map.server_authoritative_components) || !Array.isArray(map.non_authoritative_components)) {
    return failure('evidence_schema_invalid');
  }
  if (!Number.isSafeInteger(map.workflow.id) || map.workflow.id < 1
    || !isSafeText(map.workflow.path, 512) || map.workflow.event !== 'pull_request'
    || map.workflow.approved_ref !== 'refs/heads/main' || !isSha(map.workflow.approved_source_blob_sha)
    || map.workflow.job.name !== 'validate' || map.workflow.aggregate_step.number !== 5
    || map.workflow.aggregate_step.name !== 'Run validation'
    || map.workflow.aggregate_step.fail_fast !== 'github-actions-default-bash'
    || canonicalSerialize(map.workflow.source_revisions) !== canonicalSerialize(['base', 'head', 'merge'])) {
    return failure('producer_mismatch');
  }
  if (map.limits.files_per_page !== MAX_CHANGED_PATH_PAGE_SIZE || map.limits.max_files !== MAX_CHANGED_FILES
    || map.limits.max_pages !== MAX_CHANGED_PATH_PAGES || map.limits.max_response_bytes !== MAX_CHANGED_PATH_RESPONSE_BYTES) {
    return failure('pagination_limit_exceeded');
  }
  const commandIds = new Set();
  for (const command of map.commands) {
    if (!exactKeys(command, commandKeys) || !isSafeText(command.id, 128) || commandIds.has(command.id)
      || !isSafeText(command.command, 512) || !Array.isArray(command.path_classes) || command.path_classes.length === 0
      || command.path_classes.some((pathClass) => !isSafeText(pathClass, 128))) return failure('producer_mismatch');
    const definition = COMPONENT_DEFINITIONS.find((component) => component.id === command.id);
    if (!definition || definition.command !== command.command
      || canonicalSerialize(command.path_classes) !== canonicalSerialize(definition.owned_path_classes)) return failure('producer_mismatch', { component_id: command.id });
    commandIds.add(command.id);
  }
  const authoritative = map.server_authoritative_components;
  const nonAuthoritative = map.non_authoritative_components;
  if (new Set(authoritative).size !== authoritative.length || new Set(nonAuthoritative).size !== nonAuthoritative.length
    || authoritative.some((id) => !commandIds.has(id)) || [...commandIds].some((id) => !authoritative.includes(id))
    || nonAuthoritative.some((id) => !COMPONENT_IDS.includes(id)) || authoritative.some((id) => nonAuthoritative.includes(id))
    || canonicalSerialize(nonAuthoritative) !== canonicalSerialize(['git-diff-check'])) return failure('producer_mismatch');
  return success({ producer_map: clone(map), digest: digestValue(map) });
}

function normalizeRelativePath(value) {
  if (!isSafeText(value, 512) || value.includes('\\')) return null;
  const normalized = value;
  const segments = normalized.split('/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || segments.some((segment) => segment === '' || segment === '.' || segment === '..') || normalized.includes('//')) return null;
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

function serverEvidenceDigest(evidence) {
  return digestValue(stripDigest(evidence));
}

function providerId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return String(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value) && value.length <= 32) return value.replace(/^0+(?=\d)/, '');
  return null;
}

function providerAppId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function validateProducerMapForUse(map = PRODUCER_MAP) {
  return validateProducerMap(map);
}

function validatePullRequestIdentity(pullRequest, expected = {}) {
  const keys = ['repository_id', 'repository_full_name', 'number', 'head_repository_id', 'base_repository_id', 'head_sha', 'base_sha', 'base_ref', 'merge_sha', 'changed_files'];
  const repositoryId = providerId(pullRequest?.repository_id);
  const headRepositoryId = providerId(pullRequest?.head_repository_id);
  const baseRepositoryId = providerId(pullRequest?.base_repository_id);
  if (!exactKeys(pullRequest, keys)
    || !repositoryId
    || !isSafeText(pullRequest.repository_full_name, 256)
    || !Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1
    || !headRepositoryId
    || !baseRepositoryId
    || repositoryId !== baseRepositoryId
    || !isSha(pullRequest.head_sha) || !isSha(pullRequest.base_sha)
    || pullRequest.base_ref !== DEFAULT_BRANCH || !isSha(pullRequest.merge_sha)
    || !Number.isSafeInteger(pullRequest.changed_files) || pullRequest.changed_files < 0) return failure('PR_IDENTITY_MISMATCH');
  const normalized = {
    ...clone(pullRequest),
    repository_id: repositoryId,
    head_repository_id: headRepositoryId,
    base_repository_id: baseRepositoryId,
  };
  if (expected.repository_id !== undefined && repositoryId !== providerId(expected.repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.repository_full_name !== undefined && pullRequest.repository_full_name !== expected.repository_full_name) return failure('PR_IDENTITY_MISMATCH');
  if (expected.pr !== undefined && pullRequest.number !== expected.pr) return failure('PR_IDENTITY_MISMATCH');
  if (expected.number !== undefined && pullRequest.number !== expected.number) return failure('PR_IDENTITY_MISMATCH');
  if (expected.head_repository_id !== undefined && headRepositoryId !== providerId(expected.head_repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.base_repository_id !== undefined && baseRepositoryId !== providerId(expected.base_repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.head_sha !== undefined && pullRequest.head_sha !== expected.head_sha) return failure('HEAD_MOVED');
  if (expected.base_sha !== undefined && pullRequest.base_sha !== expected.base_sha) return failure('BASE_MOVED');
  if (expected.base_ref !== undefined && pullRequest.base_ref !== expected.base_ref) return failure('BASE_MOVED');
  if (expected.merge_sha !== undefined && pullRequest.merge_sha !== expected.merge_sha) return failure('MERGE_MOVED');
  return success({ pull_request: normalized });
}

function comparePullRequestIdentity(before, after) {
  const first = validatePullRequestIdentity(before);
  const second = validatePullRequestIdentity(after);
  if (!first.ok) return first;
  if (!second.ok) return second;
  const left = first.pull_request;
  const right = second.pull_request;
  if (left.repository_id !== right.repository_id || left.repository_full_name !== right.repository_full_name
    || left.number !== right.number || left.head_repository_id !== right.head_repository_id
    || left.base_repository_id !== right.base_repository_id || left.base_ref !== right.base_ref) return failure('PR_IDENTITY_MISMATCH');
  if (left.head_sha !== right.head_sha) return failure('HEAD_MOVED');
  if (left.base_sha !== right.base_sha) return failure('BASE_MOVED');
  if (left.merge_sha !== right.merge_sha) return failure('MERGE_MOVED');
  if (left.changed_files !== right.changed_files) return failure('CHANGED_FILES_COUNT_MISMATCH');
  return success({ pull_request: right });
}

const CHANGED_FILE_STATUSES = Object.freeze(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']);

function validateChangedFileRecord(record) {
  if (!exactKeys(record, ['filename', 'status', 'previous_filename']) || !CHANGED_FILE_STATUSES.includes(record.status)) return failure('PATH_INVALID');
  const filename = normalizeRelativePath(record.filename);
  const previousFilename = record.previous_filename === null ? null : normalizeRelativePath(record.previous_filename);
  if (!filename || (record.previous_filename !== null && !previousFilename)) return failure('PATH_INVALID');
  if (record.status === 'renamed' && !previousFilename) return failure('CHANGED_PATHS_AMBIGUOUS');
  if (record.status !== 'renamed' && record.previous_filename !== null) return failure('CHANGED_PATHS_AMBIGUOUS');
  return success({ record: { path: filename, status: record.status, previous_path: previousFilename } });
}

function validateCanonicalChangedPathRecords(records, expectedCount = null) {
  if (!Array.isArray(records) || records.length > MAX_CHANGED_FILES) return failure('CHANGED_PATHS_INCOMPLETE');
  const seenPaths = new Set();
  const seenRenames = new Set();
  const normalized = [];
  for (const record of records) {
    if (!exactKeys(record, ['path', 'status', 'previous_path']) || !CHANGED_FILE_STATUSES.includes(record.status)) return failure('PATH_INVALID');
    const pathValue = normalizeRelativePath(record.path);
    const previousPath = record.previous_path === null ? null : normalizeRelativePath(record.previous_path);
    if (!pathValue || (record.previous_path !== null && !previousPath)) return failure('PATH_INVALID');
    if (record.status === 'renamed' && !previousPath) return failure('CHANGED_PATHS_AMBIGUOUS');
    if (record.status !== 'renamed' && record.previous_path !== null) return failure('CHANGED_PATHS_AMBIGUOUS');
    if (seenPaths.has(pathValue)) return failure('PATH_DUPLICATE', { path: pathValue });
    seenPaths.add(pathValue);
    if (previousPath) {
      const rename = `${previousPath}\u0000${pathValue}`;
      if (seenRenames.has(rename)) return failure('PATH_DUPLICATE', { path: previousPath });
      seenRenames.add(rename);
    }
    normalized.push({ path: pathValue, status: record.status, previous_path: previousPath });
  }
  if (expectedCount !== null && records.length !== expectedCount) return failure('CHANGED_FILES_COUNT_MISMATCH');
  normalized.sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)));
  return success({ records: normalized, digest: digestValue(normalized) });
}

function validateChangedPathCollection(input, options = {}) {
  const limits = {
    files_per_page: Math.min(options.files_per_page || MAX_CHANGED_PATH_PAGE_SIZE, MAX_CHANGED_PATH_PAGE_SIZE),
    max_files: Math.min(options.max_files || MAX_CHANGED_FILES, MAX_CHANGED_FILES),
    max_pages: Math.min(options.max_pages || MAX_CHANGED_PATH_PAGES, MAX_CHANGED_PATH_PAGES),
    max_response_bytes: Math.min(options.max_response_bytes || MAX_CHANGED_PATH_RESPONSE_BYTES, MAX_CHANGED_PATH_RESPONSE_BYTES),
  };
  if (!isRecord(input) || !exactKeys(input, ['pull_request', 'pages']) || !Array.isArray(input.pages)) return failure('CHANGED_PATHS_INCOMPLETE');
  const pullRequest = validatePullRequestIdentity(input.pull_request);
  if (!pullRequest.ok) return pullRequest;
  if (input.pages.length === 0 || input.pages.length > limits.max_pages) return failure('PAGINATION_LIMIT_EXCEEDED');
  const responseBytes = Buffer.byteLength(canonicalSerialize(input.pages), 'utf8');
  if (responseBytes > limits.max_response_bytes) return failure('PAGINATION_LIMIT_EXCEEDED');
  const records = [];
  for (let index = 0; index < input.pages.length; index += 1) {
    const page = input.pages[index];
    if (!exactKeys(page, ['items', 'has_next']) || !Array.isArray(page.items) || typeof page.has_next !== 'boolean'
      || page.items.length > limits.files_per_page || (index < input.pages.length - 1 && page.has_next !== true)
      || (index === input.pages.length - 1 && page.has_next !== false)) return failure('CHANGED_PATHS_INCOMPLETE');
    if (page.has_next && page.items.length === 0) return failure('CHANGED_PATHS_INCOMPLETE');
    for (const rawRecord of page.items) {
      const result = validateChangedFileRecord(rawRecord);
      if (!result.ok) return result;
      records.push(result.record);
      if (records.length > limits.max_files) return failure('PAGINATION_LIMIT_EXCEEDED');
    }
  }
  const canonical = validateCanonicalChangedPathRecords(records, pullRequest.pull_request.changed_files);
  if (!canonical.ok) return canonical;
  return success({
    source: CHANGED_PATH_SOURCE,
    pages: input.pages.length,
    response_bytes: responseBytes,
    changed_paths: {
      source: CHANGED_PATH_SOURCE,
      count: canonical.records.length,
      digest: canonical.digest,
      records: canonical.records,
    },
  });
}

function validateWorkflowSourceBinding(input, expected = PRODUCER_MAP.workflow) {
  if (input?.event === 'merge_group') return failure('MERGE_GROUP_UNSUPPORTED');
  const keys = ['repository_id', 'pr', 'head_sha', 'base_sha', 'base_ref', 'merge_sha', 'workflow_id', 'workflow_path', 'event', 'source'];
  const repositoryId = providerId(input?.repository_id);
  const sourceKeys = ['approved', 'base', 'head', 'merge'];
  const revisionKeys = ['revision_sha', 'path', 'blob_sha'];
  if (!isRecord(input) || !exactKeys(input, keys) || !providerId(input.repository_id)
    || !repositoryId
    || !Number.isSafeInteger(input.pr) || input.pr < 1 || !isSha(input.head_sha) || !isSha(input.base_sha)
    || input.base_ref !== DEFAULT_BRANCH
    || !isSha(input.merge_sha) || input.workflow_id !== expected.id || input.workflow_path !== expected.path
    || input.event !== expected.event || !isRecord(input.source) || !exactKeys(input.source, sourceKeys)
    || !exactKeys(input.source.approved, ['ref', 'path', 'blob_sha'])
    || input.source.approved.ref !== expected.approved_ref || input.source.approved.path !== expected.path
    || input.source.approved.blob_sha !== expected.approved_source_blob_sha) return failure('WORKFLOW_SOURCE_MISMATCH');
  for (const revision of ['base', 'head', 'merge']) {
    const value = input.source[revision];
    if (!exactKeys(value, revisionKeys) || !isSha(value.revision_sha) || !isSafeText(value.path, 512) || !isSha(value.blob_sha)
      || value.path !== expected.path || value.revision_sha !== input[`${revision}_sha`]) return failure('WORKFLOW_SOURCE_MISMATCH');
    if (value.blob_sha !== expected.approved_source_blob_sha) {
      return revision === 'head' ? failure('CI_POLICY_CHANGE_REQUIRED', { revision }) : failure('WORKFLOW_SOURCE_MISMATCH', { revision });
    }
  }
  return success({ source_binding: { ...clone(input), repository_id: repositoryId }, producer_map_digest: PRODUCER_MAP_DIGEST });
}

function validateWorkflowRunPullRequestAssociation(entry, expected = {}) {
  const repositoryId = providerId(entry?.repository_id);
  const headRepositoryId = providerId(entry?.head_repository_id);
  const baseRepositoryId = providerId(entry?.base_repository_id);
  if (!exactKeys(entry, WORKFLOW_RUN_PULL_REQUEST_KEYS)
    || !Number.isSafeInteger(entry.number) || entry.number < 1
    || !repositoryId || !headRepositoryId || !baseRepositoryId || repositoryId !== baseRepositoryId
    || !isSha(entry.head_sha) || !isSha(entry.base_sha) || entry.base_ref !== DEFAULT_BRANCH) return failure('RUN_NOT_FOUND');
  const normalized = {
    ...clone(entry),
    repository_id: repositoryId,
    head_repository_id: headRepositoryId,
    base_repository_id: baseRepositoryId,
  };
  if (expected.repository_id !== undefined && repositoryId !== providerId(expected.repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.pr !== undefined && entry.number !== expected.pr) return failure('PR_IDENTITY_MISMATCH');
  if (expected.head_repository_id !== undefined && headRepositoryId !== providerId(expected.head_repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.base_repository_id !== undefined && baseRepositoryId !== providerId(expected.base_repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.head_sha !== undefined && entry.head_sha !== expected.head_sha) return failure('HEAD_MOVED');
  if (expected.base_sha !== undefined && entry.base_sha !== expected.base_sha) return failure('BASE_MOVED');
  if (expected.base_ref !== undefined && entry.base_ref !== expected.base_ref) return failure('BASE_MOVED');
  return success({ pull_request: normalized });
}

function runHasExpectedPullRequest(run, expected = {}) {
  return Array.isArray(run?.pull_requests)
    && run.pull_requests.some((entry) => validateWorkflowRunPullRequestAssociation(entry, expected).ok);
}

function validateWorkflowRunRecord(run, expected = {}) {
  if (run?.event === 'merge_group') return failure('MERGE_GROUP_UNSUPPORTED');
  const keys = ['id', 'workflow_id', 'path', 'event', 'repository_id', 'head_sha', 'run_attempt', 'status', 'conclusion', 'pull_requests'];
  if (!isRecord(run) || !exactKeys(run, keys) || !providerId(run.id) || run.workflow_id !== PRODUCER_MAP.workflow.id
    || run.path !== PRODUCER_MAP.workflow.path || run.event !== 'pull_request' || !providerId(run.repository_id)
    || !isSha(run.head_sha) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
    || !isSafeText(run.status, 64) || !isSafeText(run.conclusion, 64) || !Array.isArray(run.pull_requests) || run.pull_requests.length === 0) return failure('RUN_NOT_FOUND');
  const associations = run.pull_requests.map((entry) => validateWorkflowRunPullRequestAssociation(entry));
  if (associations.some((result) => !result.ok)) return failure('RUN_NOT_FOUND');
  const normalizedRepositoryId = providerId(run.repository_id);
  const normalizedAssociations = associations.map((result) => result.pull_request);
  if (expected.repository_id !== undefined && normalizedRepositoryId !== providerId(expected.repository_id)) return failure('PR_IDENTITY_MISMATCH');
  if (expected.head_sha !== undefined && run.head_sha !== expected.head_sha) return failure('HEAD_MOVED');
  if (!runHasExpectedPullRequest({ pull_requests: normalizedAssociations }, expected)) return failure('PR_IDENTITY_MISMATCH');
  if (run.status !== 'completed') return failure('RUN_NOT_COMPLETED');
  if (run.conclusion !== 'success') return failure('RUN_CONCLUSION_NOT_SUCCESS');
  return success({ run: { ...clone(run), id: providerId(run.id), repository_id: normalizedRepositoryId, pull_requests: normalizedAssociations } });
}

function selectAdmissibleWorkflowRun(runs, expected = {}) {
  if (!Array.isArray(runs) || runs.length === 0) return failure('RUN_NOT_FOUND');
  const matching = runs.filter((run) => run?.workflow_id === PRODUCER_MAP.workflow.id
    && run?.path === PRODUCER_MAP.workflow.path && run?.event === 'pull_request'
    && run?.head_sha === expected.head_sha
    && runHasExpectedPullRequest(run, expected));
  if (matching.length === 0) {
    if (runs.some((run) => run?.event === 'merge_group')) return failure('MERGE_GROUP_UNSUPPORTED');
    return failure('PRODUCER_MISMATCH');
  }
  const runIds = new Set(matching.map((run) => providerId(run.id)));
  if (runIds.size !== 1) return failure('RUN_AMBIGUOUS');
  const selected = [...matching].sort((left, right) => right.run_attempt - left.run_attempt)[0];
  const highestAttempt = Math.max(...matching.map((run) => run.run_attempt));
  if (selected.run_attempt !== highestAttempt) return failure('RUN_ATTEMPT_STALE');
  return validateWorkflowRunRecord(selected, expected);
}

function validateWorkflowJobEvidence(job, expected = {}) {
  const keys = ['id', 'name', 'run_id', 'run_attempt', 'head_sha', 'status', 'conclusion', 'steps'];
  if (!isRecord(job) || !exactKeys(job, keys) || !providerId(job.id) || !providerId(job.run_id)
    || !Number.isSafeInteger(job.run_attempt) || job.run_attempt < 1 || !isSha(job.head_sha)
    || !isSafeText(job.name, 256) || !isSafeText(job.status, 64) || !isSafeText(job.conclusion, 64) || !Array.isArray(job.steps)) return failure('JOB_NOT_FOUND');
  if (job.name !== PRODUCER_MAP.workflow.job.name) return failure('JOB_NOT_FOUND');
  if (expected.run_id !== undefined && providerId(job.run_id) !== providerId(expected.run_id)) return failure('PRODUCER_MISMATCH');
  if (expected.run_attempt !== undefined && job.run_attempt !== expected.run_attempt) return failure('RUN_ATTEMPT_STALE');
  if (expected.head_sha !== undefined && job.head_sha !== expected.head_sha) return failure('HEAD_MOVED');
  if (job.status !== 'completed') return failure('JOB_NOT_COMPLETED');
  if (job.conclusion !== 'success') return failure('JOB_CONCLUSION_NOT_SUCCESS');
  return success({ job: { ...clone(job), id: providerId(job.id), run_id: providerId(job.run_id) } });
}

function validateWorkflowStepEvidence(job, expected = {}) {
  const matching = job.steps.filter((step) => isRecord(step) && step.name === PRODUCER_MAP.workflow.aggregate_step.name);
  if (matching.length === 0) return failure('STEP_NOT_FOUND');
  if (matching.length !== 1) return failure('STEP_DUPLICATE');
  const step = matching[0];
  const keys = ['number', 'name', 'status', 'conclusion'];
  if (!exactKeys(step, keys) || step.number !== PRODUCER_MAP.workflow.aggregate_step.number) return failure('STEP_NOT_FOUND');
  if (step.status !== 'completed') return failure('STEP_NOT_COMPLETED');
  if (step.conclusion !== 'success') return failure('STEP_CONCLUSION_NOT_SUCCESS');
  return success({ step: clone(step) });
}

function validateWorkflowRunAdmission(input = {}) {
  if (!isRecord(input) || !isRecord(input.pull_request) || !Array.isArray(input.jobs)) return failure('RUN_NOT_FOUND');
  const pullRequest = validatePullRequestIdentity(input.pull_request);
  if (!pullRequest.ok) return pullRequest;
  const expected = {
    repository_id: pullRequest.pull_request.repository_id,
    pr: pullRequest.pull_request.number,
    head_repository_id: pullRequest.pull_request.head_repository_id,
    base_repository_id: pullRequest.pull_request.base_repository_id,
    head_sha: pullRequest.pull_request.head_sha,
    base_sha: pullRequest.pull_request.base_sha,
    base_ref: pullRequest.pull_request.base_ref,
  };
  const runResult = input.runs ? selectAdmissibleWorkflowRun(input.runs, expected) : validateWorkflowRunRecord(input.run, expected);
  if (!runResult.ok) return runResult;
  const run = runResult.run;
  const jobs = input.jobs.filter((job) => job?.run_id !== undefined && providerId(job.run_id) === providerId(run.id));
  const expectedJobs = jobs.filter((job) => job?.name === PRODUCER_MAP.workflow.job.name);
  if (expectedJobs.length === 0) return failure('JOB_NOT_FOUND');
  if (expectedJobs.length !== 1) return failure('JOB_DUPLICATE');
  const jobResult = validateWorkflowJobEvidence(expectedJobs[0], { run_id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha });
  if (!jobResult.ok) return jobResult;
  const stepResult = validateWorkflowStepEvidence(jobResult.job);
  if (!stepResult.ok) return stepResult;
  return success({ run, job: jobResult.job, step: stepResult.step, pull_request: pullRequest.pull_request });
}

function serverEvidenceIdentityFields(evidence) {
  return {
    repository_id: evidence.repository.id,
    pr: evidence.pr.number,
    head_sha: evidence.pr.head_sha,
    base_sha: evidence.pr.base_sha,
    merge_sha: evidence.pr.merge_sha,
    workflow_id: evidence.producer.workflow_id,
    workflow_path: evidence.producer.workflow_path,
    approved_source_blob_sha: evidence.producer.approved_source_blob_sha,
    run_id: evidence.producer.run_id,
    run_attempt: evidence.producer.run_attempt,
    job_id: evidence.producer.job_id,
    job_name: evidence.producer.job_name,
    step_number: evidence.producer.step_number,
    step_name: evidence.producer.step_name,
    producer_map_digest: evidence.producer.producer_map_digest,
    changed_paths_digest: evidence.changed_paths.digest,
    contract_digest: evidence.contract_digest,
    generation: evidence.generation,
  };
}

function serverCheckRunIdentity(evidence) {
  const result = validateServerEvidence(evidence);
  if (!result.ok) return result;
  const identity = serverEvidenceIdentityFields(result.evidence);
  return success({ context: GATE_CONTEXT, identity, external_id: EXTERNAL_ID_PREFIX + digestValue(identity) });
}

function buildServerEvidence(input = {}) {
  const keys = ['pull_request', 'changed_paths', 'source_binding', 'admission', 'generation'];
  if (!isRecord(input) || Object.keys(input).some((key) => !keys.includes(key)) || Array.isArray(input.changed_paths)
    || Object.prototype.hasOwnProperty.call(input, 'component_results') || Object.prototype.hasOwnProperty.call(input, 'evidence_archive')) {
    return failure('CANDIDATE_ARTIFACT_FORBIDDEN');
  }
  const pullRequestResult = validatePullRequestIdentity(input.pull_request);
  if (!pullRequestResult.ok) return pullRequestResult;
  const pullRequest = pullRequestResult.pull_request;
  const pathRecords = input.changed_paths;
  if (!isRecord(pathRecords) || !exactKeys(pathRecords, ['source', 'count', 'digest', 'records']) || pathRecords.source !== CHANGED_PATH_SOURCE) return failure('CHANGED_PATHS_INCOMPLETE');
  const canonicalPaths = validateCanonicalChangedPathRecords(pathRecords.records, pullRequest.changed_files);
  if (!canonicalPaths.ok || pathRecords.count !== canonicalPaths.records.length || pathRecords.digest !== canonicalPaths.digest) return failure(canonicalPaths.ok ? 'CHANGED_PATHS_INCOMPLETE' : canonicalPaths.code);
  const composition = compositionManifest(canonicalPaths.records);
  if (!composition.ok) return failure(composition.code, { path: composition.path });
  const sourceResult = validateWorkflowSourceBinding(input.source_binding, PRODUCER_MAP.workflow);
  if (!sourceResult.ok) return sourceResult;
  if (providerId(input.source_binding.repository_id) !== providerId(pullRequest.repository_id) || input.source_binding.pr !== pullRequest.number
    || input.source_binding.base_ref !== pullRequest.base_ref
    || input.source_binding.head_sha !== pullRequest.head_sha || input.source_binding.base_sha !== pullRequest.base_sha
    || input.source_binding.merge_sha !== pullRequest.merge_sha) return failure('EVIDENCE_IDENTITY_MISMATCH');
  if (!isRecord(input.admission) || input.admission.ok !== true || !isRecord(input.admission.run)
    || !isRecord(input.admission.job) || !isRecord(input.admission.step)) return failure('RUN_NOT_FOUND');
  const admission = input.admission;
  if (admission.run.head_sha !== pullRequest.head_sha || admission.run.workflow_id !== PRODUCER_MAP.workflow.id
    || admission.run.path !== PRODUCER_MAP.workflow.path || admission.run.event !== PRODUCER_MAP.workflow.event
    || admission.job.head_sha !== pullRequest.head_sha || admission.step.name !== PRODUCER_MAP.workflow.aggregate_step.name) return failure('PRODUCER_MISMATCH');
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) return failure('EVIDENCE_SCHEMA_INVALID');
  const commands = new Map(PRODUCER_MAP.commands.map((command) => [command.id, command]));
  const components = composition.required_components.map((id) => {
    const command = commands.get(id);
    return {
      id,
      command: command.command,
      workflow_id: PRODUCER_MAP.workflow.id,
      workflow_path: PRODUCER_MAP.workflow.path,
      run_id: providerId(admission.run.id),
      run_attempt: admission.run.run_attempt,
      job_id: providerId(admission.job.id),
      job_name: admission.job.name,
      step_number: admission.step.number,
      step_name: admission.step.name,
      status: 'success',
      conclusion: 'success',
      proof: SERVER_COMPONENT_PROOF,
    };
  });
  const evidence = {
    schema: SERVER_EVIDENCE_SCHEMA,
    contract_version: CONTRACT_VERSION,
    repository: {
      id: pullRequest.repository_id,
      full_name: pullRequest.repository_full_name,
    },
    pr: {
      number: pullRequest.number,
      head_repository_id: pullRequest.head_repository_id,
      base_repository_id: pullRequest.base_repository_id,
      head_sha: pullRequest.head_sha,
      base_sha: pullRequest.base_sha,
      base_ref: pullRequest.base_ref,
      merge_sha: pullRequest.merge_sha,
    },
    changed_paths: {
      source: CHANGED_PATH_SOURCE,
      count: canonicalPaths.records.length,
      digest: canonicalPaths.digest,
      records: canonicalPaths.records,
    },
    producer: {
      producer_map_version: PRODUCER_MAP.version,
      producer_map_digest: PRODUCER_MAP_DIGEST,
      workflow_id: PRODUCER_MAP.workflow.id,
      workflow_path: PRODUCER_MAP.workflow.path,
      event: PRODUCER_MAP.workflow.event,
      approved_ref: PRODUCER_MAP.workflow.approved_ref,
      approved_source_blob_sha: PRODUCER_MAP.workflow.approved_source_blob_sha,
      base_source_blob_sha: input.source_binding.source.base.blob_sha,
      head_source_blob_sha: input.source_binding.source.head.blob_sha,
      merge_source_blob_sha: input.source_binding.source.merge.blob_sha,
      run_id: providerId(admission.run.id),
      run_attempt: admission.run.run_attempt,
      run_status: admission.run.status,
      run_conclusion: admission.run.conclusion,
      job_id: providerId(admission.job.id),
      job_name: admission.job.name,
      job_status: admission.job.status,
      job_conclusion: admission.job.conclusion,
      step_number: admission.step.number,
      step_name: admission.step.name,
      step_status: admission.step.status,
      step_conclusion: admission.step.conclusion,
    },
    components,
    generation: input.generation,
    conclusion: 'success',
    contract_digest: SERVER_EVIDENCE_CONTRACT_DIGEST,
    evidence_digest: '',
  };
  evidence.evidence_digest = serverEvidenceDigest(evidence);
  return success({ evidence, required_component_ids: composition.required_components });
}

function validateServerEvidence(evidence, expected = {}) {
  const keys = ['schema', 'contract_version', 'repository', 'pr', 'changed_paths', 'producer', 'components', 'generation', 'conclusion', 'contract_digest', 'evidence_digest'];
  const repositoryKeys = ['id', 'full_name'];
  const prKeys = ['number', 'head_repository_id', 'base_repository_id', 'head_sha', 'base_sha', 'base_ref', 'merge_sha'];
  const pathKeys = ['source', 'count', 'digest', 'records'];
  const producerKeys = ['producer_map_version', 'producer_map_digest', 'workflow_id', 'workflow_path', 'event', 'approved_ref', 'approved_source_blob_sha', 'base_source_blob_sha', 'head_source_blob_sha', 'merge_source_blob_sha', 'run_id', 'run_attempt', 'run_status', 'run_conclusion', 'job_id', 'job_name', 'job_status', 'job_conclusion', 'step_number', 'step_name', 'step_status', 'step_conclusion'];
  const componentKeys = ['id', 'command', 'workflow_id', 'workflow_path', 'run_id', 'run_attempt', 'job_id', 'job_name', 'step_number', 'step_name', 'status', 'conclusion', 'proof'];
  if (!isRecord(evidence) || !exactKeys(evidence, keys) || evidence.schema !== SERVER_EVIDENCE_SCHEMA
    || evidence.contract_version !== CONTRACT_VERSION || !exactKeys(evidence.repository, repositoryKeys)
    || !providerId(evidence.repository.id) || !isSafeText(evidence.repository.full_name, 256)
    || !exactKeys(evidence.pr, prKeys) || !Number.isSafeInteger(evidence.pr.number) || evidence.pr.number < 1
    || !providerId(evidence.pr.head_repository_id) || !providerId(evidence.pr.base_repository_id)
    || providerId(evidence.pr.base_repository_id) !== providerId(evidence.repository.id) || evidence.pr.base_ref !== DEFAULT_BRANCH
    || !isSha(evidence.pr.head_sha) || !isSha(evidence.pr.base_sha) || !isSha(evidence.pr.merge_sha)
    || !exactKeys(evidence.changed_paths, pathKeys) || evidence.changed_paths.source !== CHANGED_PATH_SOURCE
    || !Number.isSafeInteger(evidence.changed_paths.count) || evidence.changed_paths.count < 0
    || !isDigest(evidence.changed_paths.digest) || !Array.isArray(evidence.changed_paths.records)
    || !exactKeys(evidence.producer, producerKeys) || !Number.isSafeInteger(evidence.producer.workflow_id)
    || !isSafeText(evidence.producer.workflow_path, 512) || evidence.producer.event !== 'pull_request'
    || !isDigest(evidence.producer.producer_map_digest) || evidence.producer.producer_map_version !== PRODUCER_MAP.version
    || !isSha(evidence.producer.approved_source_blob_sha) || !isSha(evidence.producer.base_source_blob_sha)
    || !isSha(evidence.producer.head_source_blob_sha) || !isSha(evidence.producer.merge_source_blob_sha)
    || !providerId(evidence.producer.run_id) || !Number.isSafeInteger(evidence.producer.run_attempt) || evidence.producer.run_attempt < 1
    || !isSafeText(evidence.producer.run_status, 64) || !isSafeText(evidence.producer.run_conclusion, 64)
    || !providerId(evidence.producer.job_id) || !isSafeText(evidence.producer.job_name, 256)
    || !isSafeText(evidence.producer.job_status, 64) || !isSafeText(evidence.producer.job_conclusion, 64)
    || !Number.isSafeInteger(evidence.producer.step_number) || evidence.producer.step_number < 1
    || !isSafeText(evidence.producer.step_name, 256) || !isSafeText(evidence.producer.step_status, 64)
    || !isSafeText(evidence.producer.step_conclusion, 64) || !Array.isArray(evidence.components)
    || !Number.isSafeInteger(evidence.generation) || evidence.generation < 1
    || evidence.conclusion !== 'success' || evidence.contract_digest !== SERVER_EVIDENCE_CONTRACT_DIGEST
    || !isDigest(evidence.evidence_digest)) return failure('EVIDENCE_SCHEMA_INVALID');
  if (evidence.producer.workflow_id !== PRODUCER_MAP.workflow.id || evidence.producer.workflow_path !== PRODUCER_MAP.workflow.path
    || evidence.producer.event !== PRODUCER_MAP.workflow.event || evidence.producer.approved_ref !== PRODUCER_MAP.workflow.approved_ref
    || evidence.producer.approved_source_blob_sha !== PRODUCER_MAP.workflow.approved_source_blob_sha
    || evidence.producer.base_source_blob_sha !== PRODUCER_MAP.workflow.approved_source_blob_sha
    || evidence.producer.head_source_blob_sha !== PRODUCER_MAP.workflow.approved_source_blob_sha
    || evidence.producer.merge_source_blob_sha !== PRODUCER_MAP.workflow.approved_source_blob_sha
    || evidence.producer.run_status !== 'completed' || evidence.producer.run_conclusion !== 'success'
    || evidence.producer.job_name !== PRODUCER_MAP.workflow.job.name || evidence.producer.job_status !== 'completed'
    || evidence.producer.job_conclusion !== 'success' || evidence.producer.step_number !== PRODUCER_MAP.workflow.aggregate_step.number
    || evidence.producer.step_name !== PRODUCER_MAP.workflow.aggregate_step.name || evidence.producer.step_status !== 'completed'
    || evidence.producer.step_conclusion !== 'success' || evidence.producer.producer_map_digest !== PRODUCER_MAP_DIGEST) return failure('PRODUCER_MISMATCH');
  const canonicalPaths = validateCanonicalChangedPathRecords(evidence.changed_paths.records, evidence.changed_paths.count);
  if (!canonicalPaths.ok) return canonicalPaths;
  if (canonicalPaths.digest !== evidence.changed_paths.digest) return failure('EVIDENCE_DIGEST_MISMATCH');
  const composition = compositionManifest(canonicalPaths.records);
  if (!composition.ok) return failure(composition.code);
  if (evidence.components.length !== composition.required_components.length) return failure('COMPONENT_MISSING');
  const expectedIds = composition.required_components;
  const commandMap = new Map(PRODUCER_MAP.commands.map((command) => [command.id, command]));
  const seen = new Set();
  for (const component of evidence.components) {
    if (!exactKeys(component, componentKeys) || seen.has(component.id) || !SERVER_COMPONENT_IDS.includes(component.id)) return failure(seen.has(component.id) ? 'COMPONENT_DUPLICATE' : 'COMPONENT_MISSING');
    seen.add(component.id);
    const command = commandMap.get(component.id);
    if (!command || component.command !== command.command || component.workflow_id !== PRODUCER_MAP.workflow.id
      || component.workflow_path !== PRODUCER_MAP.workflow.path || providerId(component.run_id) !== providerId(evidence.producer.run_id)
      || component.run_attempt !== evidence.producer.run_attempt || providerId(component.job_id) !== providerId(evidence.producer.job_id)
      || component.job_name !== evidence.producer.job_name || component.step_number !== evidence.producer.step_number
      || component.step_name !== evidence.producer.step_name || component.status !== 'success'
      || component.conclusion !== 'success' || component.proof !== SERVER_COMPONENT_PROOF) return failure('PRODUCER_MISMATCH', { component_id: component.id });
  }
  if (expectedIds.some((id) => !seen.has(id)) || seen.size !== expectedIds.length) return failure('COMPONENT_MISSING');
  if (expected.repository_id !== undefined && providerId(evidence.repository.id) !== providerId(expected.repository_id)) return failure('EVIDENCE_IDENTITY_MISMATCH');
  if (expected.pr !== undefined && evidence.pr.number !== expected.pr) return failure('EVIDENCE_IDENTITY_MISMATCH');
  if (expected.head_sha !== undefined && evidence.pr.head_sha !== expected.head_sha) return failure('HEAD_MOVED');
  if (expected.base_sha !== undefined && evidence.pr.base_sha !== expected.base_sha) return failure('BASE_MOVED');
  if (expected.merge_sha !== undefined && evidence.pr.merge_sha !== expected.merge_sha) return failure('MERGE_MOVED');
  if (Array.isArray(expected.required_component_ids)
    && canonicalSerialize(expected.required_component_ids) !== canonicalSerialize(expectedIds)) return failure('COMPONENT_MISSING');
  if (evidence.evidence_digest !== serverEvidenceDigest(evidence)) return failure('EVIDENCE_DIGEST_MISMATCH');
  return success({ evidence: clone(evidence), required_component_ids: expectedIds, evidence_digest: evidence.evidence_digest });
}

function serverPublicationRequest(input = {}) {
  const keys = ['evidence', 'publisher', 'conclusion', 'summary', 'details_url'];
  if (!isRecord(input) || !exactKeys(input, keys) || !['success', 'failure', 'cancelled', 'timed-out', 'neutral'].includes(input.conclusion)
    || !isSafeText(input.summary, 1024) || (input.details_url !== null && !isSafeText(input.details_url, 512))) return failure('EVIDENCE_SCHEMA_INVALID');
  const evidence = validateServerEvidence(input.evidence);
  if (!evidence.ok) return evidence;
  const identity = serverCheckRunIdentity(evidence.evidence);
  if (!identity.ok) return identity;
  const publisher = validatePublisher(input.publisher);
  if (!publisher.ok) return publisher;
  return success({
    context: GATE_CONTEXT,
    external_id: identity.external_id,
    object: 'check_run',
    status: 'completed',
    conclusion: input.conclusion,
    summary: input.summary,
    details_url: input.details_url,
    publisher: publisher.publisher,
  });
}

function validateLocalDiffHygiene(input) {
  if (!isRecord(input) || !exactKeys(input, ['command', 'status', 'conclusion', 'producer'])
    || input.command !== 'git diff --check' || input.producer !== LOCAL_HYGIENE_COMPONENT_PRODUCER) return failure('PRODUCER_MISMATCH');
  if (input.status !== 'success' || input.conclusion !== 'success') return failure('COMPONENT_CONCLUSION_NOT_SUCCESS');
  return success({ local_hygiene: true, authoritative_for_server_components: false });
}

function validateTimestamp(value) {
  if (!isSafeText(value, 64)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith('Z');
}

function timestampValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  return failure('WORKFLOW_NON_AUTHORITATIVE', { reason: 'legacy protected-runner evidence is not server authority' });
  /* c8 ignore start - legacy evidence shape retained only as inert historical code. */
  if (!isRecord(evidence) || !exactKeys(evidence, expectedEvidenceKeys())) return failure('unknown_field');
  if (evidence.schema !== EVIDENCE_SCHEMA || !isSafeText(evidence.repository_id, 256) || !Number.isSafeInteger(evidence.pr) || evidence.pr < 1
    || !isSha(evidence.head_sha) || !isSha(evidence.base_sha) || !isSha(evidence.merge_sha)
    || !exactKeys(evidence.protected_workflow, ['identity', 'source_sha'])
    || !isSafeText(evidence.protected_workflow.identity, 256) || !isSha(evidence.protected_workflow.source_sha)
    || !exactKeys(evidence.run, ['id', 'attempt']) || !isSafeText(evidence.run.id, 128)
    || !Number.isSafeInteger(evidence.run.attempt) || evidence.run.attempt < 1
    || !Number.isSafeInteger(evidence.generation) || evidence.generation < 1
    || evidence.contract_version !== CONTRACT_VERSION || evidence.contract_digest !== EVIDENCE_CONTRACT_DIGEST
    || !Array.isArray(evidence.component_results) || evidence.component_results.length > COMPONENT_IDS.length
    || !['success', 'failure', 'cancelled', 'timed-out', 'in-progress', 'not-applicable'].includes(evidence.conclusion)
    || !exactKeys(evidence.timestamps, ['started_at', 'completed_at'])
    || !validateTimestamp(evidence.timestamps.started_at) || !validateTimestamp(evidence.timestamps.completed_at)
    || !isDigest(evidence.evidence_digest)) return failure('evidence_incomplete');

  const startedAt = timestampValue(evidence.timestamps.started_at);
  const completedAt = timestampValue(evidence.timestamps.completed_at);
  if (completedAt < startedAt || (expected.minimum_timestamp !== undefined
    && (!Number.isFinite(expected.minimum_timestamp) || startedAt < expected.minimum_timestamp))) return failure('evidence_stale');

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
    if (component.mandatory && (component.status !== 'success' || component.conclusion !== 'success')) return failure('component_failed');
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
  /* c8 ignore stop */
}

function validateEvidenceArchive(entries, options = {}) {
  return failure('CANDIDATE_ARTIFACT_FORBIDDEN');
  /* c8 ignore next - legacy archive validation is intentionally unreachable for G2-R2 authority. */
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
  const keys = ['kind', 'app_id', 'permissions', 'operations', 'source'];
  if (!exactKeys(publisher, keys) || publisher.kind !== 'github-app' || publisher.source !== 'trusted-protected-workflow'
    || providerAppId(publisher.app_id) === null
    || (expected.app_id !== undefined && publisher.app_id !== expected.app_id)) return failure('producer_mismatch');
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
  if (!exactKeys(publisher.operations, ['check_run_publication', 'expected_source_enrolment', 'commit_status_publication', 'status_endpoint_publication'])
    || publisher.operations.check_run_publication !== true
    || publisher.operations.expected_source_enrolment !== true) return failure('publisher_forbidden_permission');
  if (publisher.operations.commit_status_publication !== false || publisher.operations.status_endpoint_publication !== false) return failure('commit_status_forbidden');
  for (const key of permissionKeys) {
    if (!['none', 'read', 'write'].includes(publisher.permissions[key])) return failure('publisher_forbidden_permission');
    if (publisher.permissions[key] !== expectedPermissions[key]) return failure('publisher_forbidden_permission');
    if (['administration', 'deployments', 'secrets', 'issues', 'reviews', 'members', 'packages', 'webhooks'].includes(key) && publisher.permissions[key] !== 'none') return failure('publisher_forbidden_permission');
  }
  return success({ publisher: clone(publisher), app_id: publisher.app_id });
}

function validateBranchProtectionRequiredCheck(input, expected = {}) {
  if (!exactKeys(input, ['context', 'app_id']) || input.context !== GATE_CONTEXT
    || providerAppId(input.app_id) === null
    || (expected.app_id !== undefined && input.app_id !== expected.app_id)) return failure('producer_mismatch');
  return success({ branch_protection: clone(input), app_id: input.app_id });
}

function validateRulesetRequiredCheck(input, expected = {}) {
  if (!exactKeys(input, ['context', 'integration_id']) || input.context !== GATE_CONTEXT
    || providerAppId(input.integration_id) === null
    || (expected.app_id !== undefined && input.integration_id !== expected.app_id)) return failure('producer_mismatch');
  return success({ ruleset: clone(input), app_id: input.integration_id });
}

function validateCheckRunReadback(checkRun, expected = {}) {
  const expectedKeys = ['app_id', 'head_sha', 'identity', 'external_id'];
  if (!isRecord(checkRun) || !isRecord(expected) || Object.keys(expected).some((key) => !expectedKeys.includes(key))
    || !isRecord(checkRun.app) || providerAppId(checkRun.app.id) === null || providerAppId(expected.app_id) === null
    || checkRun.app.id !== expected.app_id || checkRun.name !== GATE_CONTEXT
    || (checkRun.context !== undefined && checkRun.context !== GATE_CONTEXT)
    || !isSha(checkRun.head_sha) || !isSha(expected.head_sha) || checkRun.head_sha !== expected.head_sha) {
    return failure('producer_mismatch');
  }
  const identity = checkRunIdentity(expected.identity);
  if (!identity.ok || identity.identity.head_sha !== expected.head_sha
    || (expected.external_id !== undefined && expected.external_id !== identity.external_id)
    || checkRun.external_id !== identity.external_id) return failure('identity_mismatch');
  return success({
    check_run: clone(checkRun),
    app_id: checkRun.app.id,
    head_sha: checkRun.head_sha,
    external_id: identity.external_id,
    identity: identity.identity,
  });
}

function checkRunIdentity(input) {
  const keys = ['repository_id', 'pr', 'head_sha', 'base_sha', 'merge_sha', 'protected_workflow_identity', 'protected_workflow_source_sha', 'contract_digest', 'attempt', 'generation'];
  if (!exactKeys(input, keys) || !isSafeText(input.repository_id, 256) || !Number.isSafeInteger(input.pr) || input.pr < 1
    || !isSha(input.head_sha) || !isSha(input.base_sha) || !isSha(input.merge_sha)
    || !isSafeText(input.protected_workflow_identity, 256) || !isSha(input.protected_workflow_source_sha)
    || input.contract_digest !== EVIDENCE_CONTRACT_DIGEST || !Number.isSafeInteger(input.attempt) || input.attempt < 1
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
  return failure('WORKFLOW_NON_AUTHORITATIVE', { reason: 'legacy protected-runner publication request is not server authority' });
  /* c8 ignore start - legacy publication shape retained only as inert historical code. */
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
  /* c8 ignore stop */
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
       if (expected.app_id !== undefined && publication.publisher.app_id !== expected.app_id) return failure('producer_mismatch');
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
  const owners = new Set();
  for (const component of COMPONENT_DEFINITIONS) {
    if (SERVER_COMPONENT_IDS.includes(component.id) && component.owned_path_classes.some((pathClass) => classes.includes(pathClass))) owners.add(component.id);
  }
  return { path: normalizeRelativePath(changedPath), classes, owners: [...owners].sort() };
}

function compositionManifest(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return failure('unknown_relevant_path');
  const coverage = [];
  const required = new Set();
  for (const changedPath of changedPaths) {
    const record = typeof changedPath === 'string'
      ? { path: changedPath, status: null, previous_path: null }
      : changedPath;
    if (!isRecord(record) || !CHANGED_FILE_STATUSES.includes(record.status) && record.status !== null) return failure('path_invalid');
    const paths = [record.path];
    if (record.status === 'renamed') paths.push(record.previous_path);
    const owners = new Set();
    const classes = new Set();
    const evaluated = [];
    for (const changedPathValue of paths) {
      const owner = componentOwnersForPath(changedPathValue);
      if (!owner || owner.owners.length === 0) return failure('unknown_relevant_path', { path: changedPathValue });
      evaluated.push(owner);
      owner.classes.forEach((pathClass) => classes.add(pathClass));
      owner.owners.forEach((componentId) => owners.add(componentId));
      owner.owners.forEach((componentId) => required.add(componentId));
    }
    coverage.push({
      path: evaluated[0].path,
      status: record.status,
      previous_path: record.status === 'renamed' ? evaluated[1].path : null,
      classes: [...classes].sort(),
      owners: [...owners].sort(),
    });
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
  return failure('WORKFLOW_NON_AUTHORITATIVE', { reason: 'caller component results are not server authority' });
  /* c8 ignore start - legacy caller-result coverage retained only as inert historical code. */
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
    if (input.trusted_component_producer !== undefined && component.producer !== input.trusted_component_producer) return failure('producer_mismatch', { component_id: componentId });
    if (component.dependency_setup === false || component.dependency_setup === undefined && input.dependency_setup === false) return failure('dependency_setup_missing', { component_id: componentId });
    if (component.status === 'skipped' || component.status === 'cancelled' || component.conclusion === 'not-applicable') return failure('component_skipped', { component_id: componentId });
    if (component.status !== 'success' || component.conclusion !== 'success') return failure('component_failed', { component_id: componentId });
  }
  const nonCi = Array.isArray(input.non_ci_evidence) ? input.non_ci_evidence : [];
  if (nonCi.some((item) => !NON_CI_EVIDENCE.includes(item))) return failure('unknown_field');
  for (const item of nonCi) {
    if (byId.has(item)) return failure('producer_mismatch', { component_id: item });
  }
  if (changedPaths.some((path) => normalizeRelativePath(path)?.startsWith('_projects/')) && !required.includes('project-sync')) return failure('component_missing');
  if (changedPaths.some((path) => normalizeRelativePath(path)?.startsWith('.github/')) && !required.includes('toolkit-validator')) return failure('component_missing');
  return success({ manifest, coverage: manifest.path_coverage || [] });
  /* c8 ignore stop */
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
  if (Object.prototype.hasOwnProperty.call(input, 'integration_id')
    || Object.prototype.hasOwnProperty.call(input, 'installation_id')
    || Object.prototype.hasOwnProperty.call(input, 'ruleset_id')) return failure('identity_mismatch');
  const appId = providerAppId(input.app_id);
  if (appId === null) return failure('producer_mismatch');
  const managedKey = input.managed_key || DEFAULT_MANAGED_KEY;
  if (managedKey !== DEFAULT_MANAGED_KEY) return failure('identity_mismatch');
  const projection = {
    schema: DESIRED_PROTECTION_SCHEMA,
    repository_id: input.repository_id,
    default_branch: DEFAULT_BRANCH,
    mode: input.mode || ACTIVE_BASELINE_MODE,
    managed_key: managedKey,
    ruleset: {
      name: DEFAULT_RULESET_NAME,
      target: 'branch',
      branch: DEFAULT_BRANCH,
      enforcement: 'active',
      required_contexts: [{ context: GATE_CONTEXT, app_id: appId }],
    },
    publisher: { app_id: appId },
    n6_ownership: { managed_key: managedKey, owner: 'N6', version: 1 },
  };
  return success({ projection: { ...projection, fingerprint: digestValue(projection) }, fingerprint: digestValue(projection) });
}

function validateDesiredProtectionProjection(projection, nativeProof = null) {
  const keys = ['schema', 'repository_id', 'default_branch', 'mode', 'managed_key', 'ruleset', 'publisher', 'n6_ownership', 'fingerprint'];
  if (!isRecord(projection) || !exactKeys(projection, keys) || projection.schema !== DESIRED_PROTECTION_SCHEMA
    || !isSafeText(projection.repository_id, 256) || projection.default_branch !== DEFAULT_BRANCH
    || !MODES.includes(projection.mode) || projection.managed_key !== DEFAULT_MANAGED_KEY || !isDigest(projection.fingerprint)
    || !exactKeys(projection.ruleset, ['name', 'target', 'branch', 'enforcement', 'required_contexts'])
    || projection.ruleset.name !== DEFAULT_RULESET_NAME
    || projection.ruleset.target !== 'branch' || projection.ruleset.branch !== DEFAULT_BRANCH
    || projection.ruleset.enforcement !== 'active' || !Array.isArray(projection.ruleset.required_contexts)
    || projection.ruleset.required_contexts.length !== 1
    || !exactKeys(projection.publisher, ['app_id']) || providerAppId(projection.publisher.app_id) === null
    || !exactKeys(projection.n6_ownership, ['managed_key', 'owner', 'version']) || projection.n6_ownership.managed_key !== DEFAULT_MANAGED_KEY || projection.n6_ownership.owner !== 'N6'
    || projection.n6_ownership.version !== 1) return failure('identity_mismatch');
  const modeResult = validateMode(projection.mode, nativeProof);
  if (!modeResult.ok) return modeResult;
  const contexts = normalizeDesiredRequiredContexts(projection.ruleset.required_contexts);
  if (!contexts || contexts.length !== 1 || contexts[0].context !== GATE_CONTEXT
    || contexts[0].app_id !== projection.publisher.app_id) return failure('identity_mismatch');
  const withoutFingerprint = clone(projection);
  delete withoutFingerprint.fingerprint;
  if (projection.fingerprint !== digestValue(withoutFingerprint)) return failure('identity_mismatch');
  return success({ projection: clone(projection), fingerprint: projection.fingerprint });
}

function normalizeDesiredRequiredContexts(value) {
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const item of value) {
    if (!exactKeys(item, ['context', 'app_id']) || !isSafeText(item.context, 256) || providerAppId(item.app_id) === null) return null;
    result.push({ context: item.context, app_id: item.app_id });
  }
  return result.sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)));
}

function normalizeProviderRequiredContexts(value) {
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const item of value) {
    if (!exactKeys(item, ['context', 'integration_id']) || !isSafeText(item.context, 256) || providerAppId(item.integration_id) === null) return null;
    result.push({ context: item.context, integration_id: item.integration_id });
  }
  return result.sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)));
}

function desiredProviderRule(projection) {
  return {
    name: projection.ruleset.name,
    target: projection.ruleset.target,
    branch: projection.ruleset.branch,
    enforcement: projection.ruleset.enforcement,
    required_contexts: projection.ruleset.required_contexts.map((item) => ({
      context: item.context,
      integration_id: item.app_id,
    })),
  };
}

function normalizeEffectiveRule(rule) {
  if (!isRecord(rule)) return null;
  const keys = ['id', 'name', 'target', 'branch', 'enforcement', 'required_contexts', 'bypass_actors'];
  if (!exactKeys(rule, keys) || providerAppId(rule.id) === null || !isSafeText(rule.name, 256)
    || !isSafeText(rule.target, 64) || !isSafeText(rule.branch, 256) || !isSafeText(rule.enforcement, 64)
    || !normalizeProviderRequiredContexts(rule.required_contexts) || !Array.isArray(rule.bypass_actors)) return null;
  if (rule.bypass_actors.some((actor) => !isSafeText(actor, 128))) return null;
  return { ...rule, required_contexts: normalizeProviderRequiredContexts(rule.required_contexts), bypass_actors: [...rule.bypass_actors].sort() };
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
  if (!isRecord(effective.actions_settings) || !isRecord(effective.app) || !exactKeys(effective.app, ['app_id', 'status'])
    || providerAppId(effective.app.app_id) === null || !isSafeText(effective.app.status, 64)
    || !isRecord(effective.entitlement) || !Array.isArray(effective.workflows)
    || !['supported', 'unsupported', 'unreadable'].includes(effective.entitlement.status)) return failure('protection_unreadable');
  const normalized = {
    schema: EFFECTIVE_PROTECTION_SCHEMA,
    repository_id: effective.repository_id,
    default_branch: DEFAULT_BRANCH,
    organisation_rulesets: organisationRulesets.sort((left, right) => left.id - right.id),
    rulesets: rulesets.sort((left, right) => left.id - right.id),
    classic_branch_protection: clone(effective.classic_branch_protection),
    actions_settings: clone(effective.actions_settings),
    workflows: clone(effective.workflows).sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right))),
    app: clone(effective.app),
    entitlement: clone(effective.entitlement),
  };
  return success({ effective: normalized, fingerprint: digestValue(normalized) });
}

function ownershipStorePath(repositoryId) {
  if (!isSafeText(repositoryId, 256)) return null;
  const managedRoot = path.resolve(os.homedir(), OWNERSHIP_MANAGED_DIRECTORY);
  const userState = path.join(managedRoot, 'user-state');
  const root = path.join(userState, 'repository-protection');
  const repositoryDigest = crypto.createHash('sha256').update(repositoryId, 'utf8').digest('hex');
  const repositoryDirectory = path.join(root, repositoryDigest);
  const receiptPath = path.join(repositoryDirectory, OWNERSHIP_RECEIPT_BASENAME);
  const relative = path.relative(root, receiptPath);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
    || path.basename(receiptPath) !== OWNERSHIP_RECEIPT_BASENAME) return null;
  return {
    managed_root: managedRoot,
    user_state: userState,
    root,
    repository_directory: repositoryDirectory,
    receipt_path: receiptPath,
    repository_digest: repositoryDigest,
  };
}

function storagePathKey(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function inspectOwnershipStorageNode(candidate, expectedType) {
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, exists: false };
    return failure('ownership_store_invalid');
  }
  if (stat.isSymbolicLink() || (expectedType === 'directory' && !stat.isDirectory()) || (expectedType === 'file' && !stat.isFile())) {
    return failure('ownership_store_invalid');
  }
  try {
    if (storagePathKey(fs.realpathSync.native(candidate)) !== storagePathKey(candidate)) return failure('ownership_store_invalid');
  } catch (_error) {
    return failure('ownership_store_invalid');
  }
  return { ok: true, exists: true };
}

function validateOwnershipStoragePath(storage) {
  for (const directory of [storage.managed_root, storage.user_state]) {
    const result = inspectOwnershipStorageNode(directory, 'directory');
    if (!result.ok && result.exists !== false) return result;
    if (result.exists === false) return success({ present: false });
  }
  const rootResult = inspectOwnershipStorageNode(storage.root, 'directory');
  if (!rootResult.ok && rootResult.exists !== false) return rootResult;
  if (rootResult.exists === false) return success({ present: false });
  const directoryResult = inspectOwnershipStorageNode(storage.repository_directory, 'directory');
  if (!directoryResult.ok && directoryResult.exists !== false) return directoryResult;
  if (directoryResult.exists === false) return success({ present: false });
  const receiptResult = inspectOwnershipStorageNode(storage.receipt_path, 'file');
  if (!receiptResult.ok && receiptResult.exists !== false) return receiptResult;
  return success({ present: receiptResult.exists === true });
}

function validateOwnershipRollbackPrestate(prestate) {
  if (prestate === null) return success({ prestate: null, digest: digestValue(null) });
  const keys = ['effective_fingerprint', 'rule', 'rule_digest'];
  if (!exactKeys(prestate, keys) || !isDigest(prestate.effective_fingerprint) || !isDigest(prestate.rule_digest)) return failure('ownership_receipt_invalid');
  if (prestate.rule === null) {
    if (prestate.rule_digest !== digestValue(null)) return failure('ownership_receipt_invalid');
  } else {
    const rule = normalizeEffectiveRule(prestate.rule);
    if (!rule || digestValue(rule) !== prestate.rule_digest) return failure('ownership_receipt_invalid');
  }
  return success({ prestate: clone(prestate), digest: digestValue(prestate) });
}

function validateOwnershipReceipt(receipt, expected = {}) {
  const keys = [
    'schema',
    'repository_id',
    'managed_key',
    'ruleset_id',
    'app_id',
    'context',
    'operation',
    'a2_consent_receipt_id',
    'pre_read_fingerprint',
    'post_read_fingerprint',
    'post_rule_digest',
    'rollback_prestate',
    'rollback_prestate_digest',
    'receipt_revision',
    'previous_receipt_digest',
    'recorded_at',
    'receipt_digest',
  ];
  if (!exactKeys(receipt, keys) || receipt.schema !== OWNERSHIP_RECEIPT_SCHEMA
    || !isSafeText(receipt.repository_id, 256) || receipt.managed_key !== DEFAULT_MANAGED_KEY
    || providerAppId(receipt.ruleset_id) === null || providerAppId(receipt.app_id) === null
    || receipt.context !== GATE_CONTEXT || !OWNERSHIP_RECEIPT_OPERATIONS.includes(receipt.operation)
    || !isDigest(receipt.a2_consent_receipt_id) || !isDigest(receipt.pre_read_fingerprint)
    || !isDigest(receipt.post_read_fingerprint) || !isDigest(receipt.post_rule_digest)
    || !isDigest(receipt.rollback_prestate_digest) || !Number.isSafeInteger(receipt.receipt_revision)
    || receipt.receipt_revision < 1 || (receipt.previous_receipt_digest !== null && !isDigest(receipt.previous_receipt_digest))
    || !validateTimestamp(receipt.recorded_at) || !isDigest(receipt.receipt_digest)) return failure('ownership_receipt_invalid');
  if (receipt.operation === 'create-managed-ruleset'
    && (receipt.receipt_revision !== 1 || receipt.previous_receipt_digest !== null)) return failure('ownership_receipt_invalid');
  if (receipt.operation === 'update-managed-ruleset'
    && (receipt.receipt_revision < 2 || receipt.previous_receipt_digest === null)) return failure('ownership_receipt_invalid');
  const rollback = validateOwnershipRollbackPrestate(receipt.rollback_prestate);
  if (!rollback.ok || rollback.digest !== receipt.rollback_prestate_digest) return failure('ownership_receipt_invalid');
  const withoutDigest = clone(receipt);
  delete withoutDigest.receipt_digest;
  if (receipt.receipt_digest !== digestValue(withoutDigest)) return failure('ownership_receipt_invalid');
  if (expected.repository_id !== undefined && receipt.repository_id !== expected.repository_id) return failure('ownership_receipt_invalid');
  if (expected.managed_key !== undefined && receipt.managed_key !== expected.managed_key) return failure('ownership_receipt_invalid');
  if (expected.ruleset_id !== undefined && receipt.ruleset_id !== expected.ruleset_id) return failure('ownership_receipt_invalid');
  if (expected.app_id !== undefined && receipt.app_id !== expected.app_id) return failure('ownership_receipt_invalid');
  if (expected.context !== undefined && receipt.context !== expected.context) return failure('ownership_receipt_invalid');
  if (expected.a2_consent_receipt_id !== undefined && receipt.a2_consent_receipt_id !== expected.a2_consent_receipt_id) return failure('ownership_receipt_invalid');
  if (receipt.rollback_prestate?.rule && receipt.rollback_prestate.rule.id !== receipt.ruleset_id) return failure('ownership_receipt_invalid');
  return success({ receipt: clone(receipt) });
}

function readOwnershipReceipt(repositoryId, testState = null) {
  if (!isSafeText(repositoryId, 256)) return failure('identity_mismatch');
  if (testState !== null) {
    if (!isRecord(testState) || testState.testOnly !== true || !exactKeys(testState, ['testOnly', 'receipt'])) return failure('ownership_store_invalid');
    if (testState.receipt === null) return success({ receipt: null, ownership_status: 'missing', ownership_path: null });
    const validated = validateOwnershipReceipt(testState.receipt, { repository_id: repositoryId });
    if (!validated.ok) return validated;
    return success({ receipt: validated.receipt, ownership_status: 'present', ownership_path: null });
  }
  const storage = ownershipStorePath(repositoryId);
  if (!storage) return failure('ownership_store_invalid');
  const storageResult = validateOwnershipStoragePath(storage);
  if (!storageResult.ok) return storageResult;
  if (storageResult.present !== true) return success({ receipt: null, ownership_status: 'missing', ownership_path: storage.receipt_path });
  let bytes;
  try {
    bytes = fs.readFileSync(storage.receipt_path);
  } catch (_error) {
    return failure('ownership_store_invalid');
  }
  if (bytes.length > MAX_OWNERSHIP_RECEIPT_BYTES) return failure('ownership_receipt_invalid');
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    return failure('ownership_receipt_invalid');
  }
  const validated = validateOwnershipReceipt(parsed, { repository_id: repositoryId });
  if (!validated.ok) return validated;
  return success({ receipt: validated.receipt, ownership_status: 'present', ownership_path: storage.receipt_path });
}

function readCanonicalOwnershipReceipt(repositoryId) {
  return readOwnershipReceipt(repositoryId);
}

function ruleHasGateContext(rule) {
  return Array.isArray(rule?.required_contexts) && rule.required_contexts.some((item) => item.context === GATE_CONTEXT);
}

function ruleMatchesManagedIdentity(rule, desired) {
  return rule.name === desired.ruleset.name || ruleHasGateContext(rule);
}

function classifyProtectionOwnership(effective, desired = null, ownershipReceipt = null, options = {}) {
  if (!isRecord(effective) || !isRecord(desired)) return failure('ownership_ambiguous');
  const effectiveResult = canonicalizeEffectiveProtection(effective);
  const desiredResult = validateDesiredProtectionProjection(desired);
  if (!effectiveResult.ok || !desiredResult.ok || effectiveResult.effective.repository_id !== desired.repository_id) return failure('ownership_ambiguous');
  const canonicalEffective = effectiveResult.effective;
  const canonicalDesired = desiredResult.projection;
  if (canonicalEffective.app.app_id !== canonicalDesired.publisher.app_id) return failure('ownership_ambiguous');
  const consent = options.consent || null;
  const consentReceiptId = consent?.capability?.receipt?.receipt_id;
  let receipt = null;
  if (ownershipReceipt !== null) {
    const receiptResult = validateOwnershipReceipt(ownershipReceipt, {
      repository_id: canonicalDesired.repository_id,
      managed_key: canonicalDesired.managed_key,
      app_id: canonicalDesired.publisher.app_id,
      context: GATE_CONTEXT,
      a2_consent_receipt_id: consentReceiptId,
    });
    if (!receiptResult.ok) return receiptResult;
    receipt = receiptResult.receipt;
    if (options.requirePrestate === true && (!receipt.rollback_prestate || !receipt.rollback_prestate.rule)) return failure('rollback_unsafe');
  }
  const scopedRules = [
    ...canonicalEffective.rulesets.map((rule) => ({ rule, scope: 'repository' })),
    ...canonicalEffective.organisation_rulesets.map((rule) => ({ rule, scope: 'organisation' })),
  ];
  const seenRuleIds = new Set();
  let n6Rule = null;
  let conflict = false;
  for (const { rule, scope } of scopedRules) {
    if (seenRuleIds.has(rule.id)) conflict = true;
    seenRuleIds.add(rule.id);
    const isReceiptTarget = receipt !== null && rule.id === receipt.ruleset_id;
    if (isReceiptTarget) {
      if (scope !== 'repository' || n6Rule) conflict = true;
      else n6Rule = rule;
      continue;
    }
    if (ruleMatchesManagedIdentity(rule, canonicalDesired)) conflict = true;
  }
  if (receipt !== null && !n6Rule) conflict = true;
  if (conflict) return failure('ownership_ambiguous', { ownership_class: 'overlapping-conflicting', n6_rule: n6Rule });
  if (n6Rule) return success({ ownership_class: 'N6-owned', ownership_classes: ['N6-owned'], n6_rule: n6Rule, ownership_receipt: receipt });
  return success({ ownership_class: 'none', ownership_classes: [], n6_rule: null, ownership_receipt: null });
}

function protectionDelta(desired, current) {
  const delta = {};
  for (const key of ['target', 'branch', 'enforcement', 'required_contexts']) {
    if (canonicalSerialize(desired[key]) !== canonicalSerialize(current[key])) delta[key] = clone(desired[key]);
  }
  return delta;
}

function rollbackDelta(current, preMutation) {
  const delta = {};
  for (const key of ['target', 'branch', 'enforcement', 'required_contexts']) {
    if (canonicalSerialize(current[key]) !== canonicalSerialize(preMutation[key])) delta[key] = clone(preMutation[key]);
  }
  return delta;
}

function buildMutationBinding(input) {
  const keys = ['repository_id', 'operation', 'target', 'desired_projection', 'consent', 'mode', 'publisher_app_id', 'mutation_class', 'pre_read_fingerprint', 'expected_owned_delta'];
  if (!exactKeys(input, keys) || !isSafeText(input.repository_id, 256) || !isSafeText(input.operation, 128)
    || !isRecord(input.target) || !isRecord(input.desired_projection) || !isRecord(input.consent)
    || input.consent.status !== 'enabled' || input.consent.authority !== capabilityRegistry.PROTECTION_CONSENT_AUTHORITY
    || !isSafeText(input.mode, 128) || providerAppId(input.publisher_app_id) === null
    || !isSafeText(input.mutation_class, 128) || !isDigest(input.pre_read_fingerprint) || !isRecord(input.expected_owned_delta)) return failure('identity_mismatch');
  const binding = {
    repository_id: input.repository_id,
    operation: input.operation,
    target_digest: digestValue(input.target),
    desired_projection_digest: input.desired_projection.fingerprint || digestValue(input.desired_projection),
    consent_digest: digestValue(input.consent),
    mode: input.mode,
    publisher_app_id: input.publisher_app_id,
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

function validateProtectionConsentAuthority(authority, repositoryId) {
  const keys = ['authority', 'status', 'repository_id', 'canonical_remote', 'registry_revision', 'snapshot_hash', 'capability', 'reason_code'];
  if (!exactKeys(authority, keys) || authority.authority !== capabilityRegistry.PROTECTION_CONSENT_AUTHORITY
    || authority.status !== 'enabled' || authority.repository_id !== repositoryId
    || !isSafeText(authority.canonical_remote, 512) || !Number.isSafeInteger(authority.registry_revision)
    || authority.registry_revision < 1 || !isDigest(authority.snapshot_hash) || authority.reason_code !== null
    || !isRecord(authority.capability)) return failure('consent_missing');
  const validated = validateProtectionConsent(authority.capability, repositoryId, authority.registry_revision);
  if (!validated.ok) return validated;
  return success({ consent: clone(authority), registry_revision: authority.registry_revision });
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
  return validateProtectionConsentAuthority(authority, repositoryId);
}

function readCanonicalProtectionConsent(repositoryId) {
  return readProtectionConsent({ cwd: process.cwd() }, repositoryId);
}

function reconcileProtectionInternal(input = {}, registryOptions = null, ownershipState = null) {
  const phase = input.phase || 'preview';
  if (!['inspect', 'canonicalize', 'fingerprint', 'compare', 'classify', 'preview', 'apply-plan', 'readback-verify', 'rollback-preview', 'rollback-plan'].includes(phase)) return failure('identity_mismatch');
  if (Object.prototype.hasOwnProperty.call(input, 'consent')
    || Object.prototype.hasOwnProperty.call(input, 'capability_status')) return failure('consent_missing');
  const callerOwnershipKeys = ['ownership_proof', 'ownership_receipt', 'ownership_path', 'ownership_state', 'state_root', 'receipt_provider', 'provider'];
  if (callerOwnershipKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) return failure('ownership_ambiguous');
  const consentResult = registryOptions === null
    ? readCanonicalProtectionConsent(input.repository_id)
    : readProtectionConsent(registryOptions, input.repository_id);
  if (!consentResult.ok) return consentResult;
  const consent = consentResult.consent;
  const publisherResult = activePublisher(input.publishers || (input.publisher ? [input.publisher] : []), { app_id: input.expected_app_id });
  if (!publisherResult.ok) return publisherResult;
  const desiredResult = input.desired?.projection ? validateDesiredProtectionProjection(input.desired.projection, input.native_proof) : desiredProtectionProjection({
    repository_id: input.repository_id,
    default_branch: input.default_branch || DEFAULT_BRANCH,
    mode: input.mode || ACTIVE_BASELINE_MODE,
    app_id: publisherResult.publisher.app_id,
    native_proof: input.native_proof,
  });
  if (!desiredResult.ok) return desiredResult;
  if (desiredResult.projection.publisher.app_id !== publisherResult.publisher.app_id) return failure('producer_mismatch');
  const effectiveResult = canonicalizeEffectiveProtection(input.effective);
  if (!effectiveResult.ok) return effectiveResult;
  if (effectiveResult.effective.repository_id !== desiredResult.projection.repository_id) return failure('identity_mismatch');
  if (effectiveResult.effective.entitlement.status === 'unsupported') return failure('entitlement_unsupported');
  if (effectiveResult.effective.entitlement.status === 'unreadable') return failure('protection_unreadable');
  const ownershipReceiptResult = readOwnershipReceipt(desiredResult.projection.repository_id, ownershipState);
  if (!ownershipReceiptResult.ok) return ownershipReceiptResult;
  const ownership = classifyProtectionOwnership(
    effectiveResult.effective,
    desiredResult.projection,
    ownershipReceiptResult.receipt,
    {
      consent,
      requirePrestate: phase === 'rollback-preview' || phase === 'rollback-plan',
    },
  );
  if (!ownership.ok) return ownership;
  if (phase === 'inspect' || phase === 'canonicalize' || phase === 'fingerprint' || phase === 'classify') return success({ phase, desired: desiredResult.projection, effective: effectiveResult.effective, ownership: ownership.ownership_class, ownership_status: ownershipReceiptResult.ownership_status, ownership_path: ownershipReceiptResult.ownership_path, fingerprint: effectiveResult.fingerprint });
  if (phase === 'rollback-preview' || phase === 'rollback-plan') {
    if (!ownership.n6_rule || ownership.ownership_class !== 'N6-owned' || input.owner_changed === true || input.organisation_changed === true) return failure('rollback_unsafe');
    const preMutation = ownership.ownership_receipt?.rollback_prestate;
    if (!preMutation || !preMutation.rule) return failure('rollback_unsafe');
    return success({
      phase,
      action: 'rollback-n6-owned-delta-only',
      status: 'PLAN',
      delta: rollbackDelta(ownership.n6_rule, preMutation.rule),
      prestate_fingerprint: preMutation.effective_fingerprint,
    });
  }
  const n6Rule = ownership.n6_rule;
  if (n6Rule && ownership.ownership_class === 'N6-owned') {
    const delta = protectionDelta(desiredProviderRule(desiredResult.projection), n6Rule);
    if (Object.keys(delta).length === 0) return success({ phase, status: 'NOOP', code: 'NOOP', desired: desiredResult.projection, effective: effectiveResult.effective, ownership: ownership.ownership_class, fingerprint: effectiveResult.fingerprint });
    const binding = buildMutationBinding({
      repository_id: desiredResult.projection.repository_id,
      operation: 'n6.update-managed-ruleset',
      target: { ruleset_id: n6Rule.id },
      desired_projection: desiredResult.projection,
      consent,
      mode: desiredResult.projection.mode,
      publisher_app_id: publisherResult.publisher.app_id,
      mutation_class: 'n6-owned-delta-only',
      pre_read_fingerprint: effectiveResult.fingerprint,
      expected_owned_delta: delta,
    });
    if (!binding.ok) return binding;
    return phase === 'apply-plan' ? failure('live_mutation_forbidden') : success({ phase, status: 'PLAN', action: 'update-ruleset', delta, binding: binding.binding, ownership: ownership.ownership_class });
  }
  const desiredProvider = desiredProviderRule(desiredResult.projection);
  const binding = buildMutationBinding({
    repository_id: desiredResult.projection.repository_id,
    operation: 'n6.create-managed-ruleset',
    target: { managed_key: desiredResult.projection.managed_key, name: desiredResult.projection.ruleset.name },
    desired_projection: desiredResult.projection,
    consent,
    mode: desiredResult.projection.mode,
    publisher_app_id: publisherResult.publisher.app_id,
    mutation_class: 'n6-owned-dedicated-ruleset',
    pre_read_fingerprint: effectiveResult.fingerprint,
    expected_owned_delta: desiredProvider,
  });
  if (!binding.ok) return binding;
  return phase === 'apply-plan' ? failure('live_mutation_forbidden') : success({ phase, status: 'PLAN', action: 'create-ruleset', delta: desiredProvider, binding: binding.binding, ownership: ownership.ownership_class });
}

function reconcileProtection(input = {}) {
  if (Object.prototype.hasOwnProperty.call(input, 'capability_registry_options')
    || Object.prototype.hasOwnProperty.call(input, 'ownership_state')
    || Object.prototype.hasOwnProperty.call(input, 'ownership_path')
    || Object.prototype.hasOwnProperty.call(input, 'state_root')
    || Object.prototype.hasOwnProperty.call(input, 'receipt_provider')) return failure('consent_missing');
  return reconcileProtectionInternal(input, null, null);
}

function reconcileProtectionForTest(input = {}, registryOptions = null) {
  if (!isRecord(registryOptions) || registryOptions.testOnly !== true) return failure('consent_missing');
  const testInput = { ...input };
  delete testInput.capability_registry_options;
  const testRegistryOptions = { ...registryOptions };
  const ownershipState = testRegistryOptions.ownership_state === undefined
    ? null
    : { testOnly: true, ...testRegistryOptions.ownership_state };
  delete testRegistryOptions.ownership_state;
  return reconcileProtectionInternal(testInput, testRegistryOptions, ownershipState);
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
  DEFAULT_MANAGED_KEY,
  DEFAULT_RULESET_NAME,
  OWNERSHIP_RECEIPT_SCHEMA,
  OWNERSHIP_STATE_DIRECTORY,
  OWNERSHIP_RECEIPT_BASENAME,
  MAX_OWNERSHIP_RECEIPT_BYTES,
  EVIDENCE_CONTRACT_DIGEST,
  SERVER_EVIDENCE_SCHEMA,
  SERVER_EVIDENCE_CONTRACT_DIGEST,
  PRODUCER_MAP_PATH,
  PRODUCER_MAP,
  PRODUCER_MAP_DIGEST,
  SERVER_COMPONENT_PRODUCER,
  LOCAL_HYGIENE_COMPONENT_PRODUCER,
  SERVER_COMPONENT_IDS,
  NON_AUTHORITATIVE_COMPONENT_IDS,
  MAX_CHANGED_FILES,
  MAX_CHANGED_PATH_PAGES,
  MAX_CHANGED_PATH_PAGE_SIZE,
  MAX_CHANGED_PATH_RESPONSE_BYTES,
  CHANGED_PATH_SOURCE,
  CHANGED_FILE_STATUSES,
  SERVER_COMPONENT_PROOF,
  WORKFLOW_RUN_PULL_REQUEST_KEYS,
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
  serverEvidenceDigest,
  validateProducerMap,
  validateProducerMapForUse,
  validatePullRequestIdentity,
  comparePullRequestIdentity,
  validateChangedFileRecord,
  validateCanonicalChangedPathRecords,
  validateChangedPathCollection,
  validateWorkflowSourceBinding,
  validateWorkflowRunPullRequestAssociation,
  validateWorkflowRunRecord,
  selectAdmissibleWorkflowRun,
  validateWorkflowJobEvidence,
  validateWorkflowStepEvidence,
  validateWorkflowRunAdmission,
  buildServerEvidence,
  validateServerEvidence,
  serverEvidenceIdentityFields,
  serverCheckRunIdentity,
  serverPublicationRequest,
  validateLocalDiffHygiene,
  validateEvidence,
  validateEvidenceArchive,
  validatePublisher,
  validateBranchProtectionRequiredCheck,
  validateRulesetRequiredCheck,
  validateCheckRunReadback,
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
  validateProtectionConsentAuthority,
  readProtectionConsent,
  readCanonicalProtectionConsent,
  canonicalizeEffectiveProtection,
  classifyProtectionOwnership,
  ownershipStorePath,
  validateOwnershipReceipt,
  readOwnershipReceipt,
  readCanonicalOwnershipReceipt,
  buildMutationBinding,
  reconcileProtection,
  reconcileProtectionForTest,
};
