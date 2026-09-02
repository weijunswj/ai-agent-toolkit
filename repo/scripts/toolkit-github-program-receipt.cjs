#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalSerialize, digestValue } = require('./toolkit-execution-loop.cjs');

const SCHEMA_ID = 'toolkit.github-program.run-receipt.v1';
const MIN_NODE_VERSION = '22.13.0';
const APPLICATION_ID = 1196446257;
const USER_VERSION = 2;
const V3_USER_VERSION = 3;
const HOLDER_ATTESTATION_SCHEMA_ID = 'toolkit.github-program.holder-attestation.v1';
const PRE_RECOVERY_EVIDENCE_SCHEMA_ID = 'toolkit.github-program.pre-recovery-evidence.v1';
const RECOVERY_RECORD_SCHEMA_ID = 'toolkit.github-program.recovery-record.v1';
const V3_MIGRATION_PLAN_SCHEMA_ID = 'toolkit.github-program.v2-to-v3-migration-plan.v1';
const HOLDER_ATTESTATION_ALGORITHM = 'HMAC-SHA-256';
const BROKER_RECOVERY_CLASSIFICATION = 'ORPHAN_NONADOPTABLE';
const BROKER_RECOVERY_REASON = 'BROKER_PROTECTED_RECOVERY';
const BUSY_TIMEOUT_MS = 5000;
const VERIFIER_TIMEOUT_MS = 30000;
const VERIFIER_STREAM_BYTES = 16 * 1024;
const RECEIPT_TYPES = Object.freeze([
  'RUN_STARTED',
  'TRANSITION_PREVIEW',
  'EXECUTOR_TERMINAL',
  'G4_TERMINAL',
  'RUN_INTERRUPTED'
]);
const TERMINAL_TYPES = Object.freeze(['EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED']);
const LIMITS = Object.freeze({
  receiptBytes: 16 * 1024,
  payloadBytes: 8 * 1024,
  receiptsPerRun: 128,
  allocationsPerNamespace: 10000,
  databaseBytes: 64 * 1024 * 1024,
  leaseMinMs: 1000,
  leaseMaxMs: 24 * 60 * 60 * 1000,
  operationsPerNamespace: 10000,
  operationEventsPerNamespace: 50000,
  targetIdentityBytes: 2048,
  outcomeEvidenceBytes: 4096
});
const OPERATION_KINDS = Object.freeze([
  'GIT_REF_UPDATE',
  'CONDITIONAL_PROVIDER_UPDATE',
  'IDEMPOTENT_SET',
  'APPEND_CREATE'
]);
const SAFETY_CLASSES = Object.freeze(['CAS', 'IDEMPOTENT', 'APPEND_IDEMPOTENT']);
const OPERATION_STATES = Object.freeze(['PREPARED', 'IN_FLIGHT', 'APPLIED', 'NOT_APPLIED', 'UNKNOWN']);
const OPERATION_DESCRIPTOR_KEYS = Object.freeze([
  'operation_kind', 'safety_class', 'target_identity', 'target_digest',
  'expected_source_digest', 'cas_digest', 'expected_post_state_digest',
  'adapter_identity_digest', 'retry_of_operation_id'
]);
const TARGET_IDENTITY_KEYS = Object.freeze(['resource_type', 'resource_id']);
const OUTCOME_EVIDENCE_KEYS = Object.freeze([
  'operation_id', 'logical_operation_digest', 'adapter_identity_digest',
  'target_identity', 'target_digest', 'provider_operation_key', 'cas_digest',
  'classification', 'observed_post_state_digest', 'rejection_digest',
  'delayed_completion_excluded', 'evidence_at', 'evidence_digest'
]);
const VERIFICATION_PACKET_KEYS = Object.freeze([
  'schema', 'run_id', 'allocation_id', 'receipt_id', 'receipt_sequence',
  'namespace_digest', 'authority_digest', 'start_digest', 'lease_id',
  'fence_id', 'fence_sequence', 'chain_digest', 'store_state_digest',
  'store_identity_digest', 'node_executable_realpath_digest',
  'runtime_identity_digest', 'node_version', 'packet_digest'
]);
const RECEIPT_KEYS = Object.freeze([
  'schema', 'receipt_type', 'receipt_id', 'sequence', 'prior_receipt_id',
  'run_id', 'allocation_id', 'repository', 'parent_issue', 'child_issue',
  'lock', 'authority', 'start', 'candidate', 'lease', 'payload', 'created_at'
]);
const AUTHORITY_KEYS = Object.freeze([
  'child_comment_id', 'parent_comment_id', 'node_id', 'author_login',
  'author_association', 'body_digest', 'updated_at', 'update_identity_digest',
  'scope_digest'
]);
const START_KEYS = Object.freeze([
  'base_sha', 'head_sha', 'tree_sha', 'status_digest', 'clean_worktree', 'ref'
]);
const CANDIDATE_KEYS = Object.freeze([
  'pr_number', 'branch', 'base_ref', 'base_sha', 'head_sha', 'tree_sha'
]);
const LEASE_KEYS = Object.freeze([
  'lease_id', 'fence_id', 'fence_sequence', 'issued_at', 'expires_at'
]);
const HOLDER_ATTESTATION_KEYS = Object.freeze([
  'schema', 'attestation_id', 'algorithm', 'key_id', 'platform', 'repository',
  'parent_issue', 'child_issue', 'lock', 'allocation_id', 'allocation_digest',
  'run_id', 'run_digest', 'lease_id', 'fence_id', 'fence_sequence',
  'authority_digest', 'start_digest', 'broker_identity_digest', 'process_id_digest',
  'process_start_digest', 'boot_id_digest',
  'pid_namespace_digest', 'process_incarnation_digest', 'lease_issued_at',
  'lease_expires_at', 'attestation_digest', 'attestation_tag'
]);
const PRE_RECOVERY_EVIDENCE_KEYS = Object.freeze([
  'schema', 'request_id', 'repository', 'parent_issue', 'child_issue', 'lock',
  'namespace_digest', 'old_allocation_id', 'old_run_id', 'old_allocation_digest',
  'old_run_digest', 'old_lease_id', 'old_fence_id', 'old_fence_sequence',
  'old_lease_issued_at', 'old_lease_expires_at', 'old_lease_tip_event_id',
  'old_lease_tip_event_digest', 'old_receipt_tip_id', 'old_receipt_tip_sequence',
  'old_receipt_tip_digest', 'old_receipt_chain_digest', 'zero_operation_count',
  'zero_operation_event_count', 'zero_operation_inventory_digest', 'authority_digest',
  'source_digest', 'start_digest', 'old_holder_classification',
  'old_holder_identity_digest', 'old_holder_attestation_digest', 'recovery_peer_platform',
  'recovery_peer_identity_digest', 'recovery_peer_process_incarnation_digest',
  'broker_identity_digest', 'broker_key_id', 'observed_at', 'authority_observed_at',
  'source_observed_at', 'start_observed_at', 'store_observed_at', 'holder_observed_at'
]);
const RECOVERY_RECORD_KEYS = Object.freeze([
  'schema', 'recovery_record_id', 'request_id', 'namespace_digest',
  'old_allocation_id', 'old_run_id', 'old_lease_id', 'old_fence_id',
  'old_fence_sequence', 'pre_recovery_evidence', 'pre_recovery_evidence_digest',
  'terminal_receipt_id', 'terminal_receipt_digest', 'release_event_id',
  'release_event_digest', 'replacement_allocation_id', 'replacement_allocation_digest',
  'replacement_run_id', 'replacement_run_digest', 'replacement_lease_id',
  'replacement_fence_id', 'replacement_fence_sequence',
  'replacement_holder_attestation_id', 'replacement_holder_attestation_digest',
  'new_high_water', 'authority_digest', 'source_digest', 'start_digest',
  'committed_at', 'recovery_record_digest'
]);
const RESERVED_ORPHAN_PAYLOAD_KEYS = Object.freeze([
  'classification', 'reason_code', 'evidence_digest'
]);
const ZERO_OPERATION_INVENTORY = Object.freeze({
  mutation_operation_ids: Object.freeze([]),
  mutation_operation_event_ids: Object.freeze([]),
  unresolved_operation_ids: Object.freeze([])
});
const ZERO_OPERATION_INVENTORY_DIGEST = digestValue(ZERO_OPERATION_INVENTORY);
const MIGRATION_OBSERVATION_KEYS = Object.freeze([
  'application_id', 'user_version', 'schema_fingerprint', 'namespace_verified',
  'integrity_verified', 'foreign_keys_verified', 'historical_digests_verified',
  'chain_verified', 'high_water_verified', 'unresolved_operation_count',
  'unexpired_unreleased_allocation_count', 'observed_at'
]);
const PAYLOAD_KEYS = Object.freeze([
  'classification', 'reason_code', 'outcome_digest', 'evidence_digest',
  'operation_digest', 'detail_digest', 'mutation_outcome', 'evidence_refs'
]);
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|private[_-]?key|secret|token|prompt|upload|model[_-]?output|raw[_-]?body)/i;
const SENSITIVE_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]+=*|github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const SESSION_OWNERS = new WeakMap();
const ADMISSION_OWNERS = new WeakMap();

class GprError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'GprError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new GprError(code, details);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isSafeId(value, max = 160) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9._:/-]+$/.test(value)
    && !value.startsWith('-')
    && !value.includes('..');
}

function isSafeContractId(value, max = 160) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isSafeGitRef(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.startsWith('-')
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.endsWith('.')
    && !value.includes('..')
    && !value.includes('@{')
    && value !== '@'
    && !/[\u0000-\u0020\u007f~^:?*\\[]/.test(value)
    && value.split('/').every((component) => component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock'));
}

function isTimestamp(value) {
  if (typeof value !== 'string' || value.length > 32) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isoAt(value = Date.now()) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) fail('GPR_TIMESTAMP_INVALID');
  return new Date(time).toISOString();
}

function assertPrivacySafe(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) fail('GPR_SENSITIVE_VALUE');
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) fail('GPR_VALUE_INVALID');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertPrivacySafe(item, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) fail('GPR_SENSITIVE_FIELD', { field: key });
      assertPrivacySafe(item, seen);
    }
  }
  seen.delete(value);
}

function byteLength(value) {
  return Buffer.byteLength(canonicalSerialize(value), 'utf8');
}

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (!Number.isInteger(a[index]) || a[index] < 0) return -1;
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function assertRuntimeSupport(options = {}) {
  const nodeVersion = options.nodeVersion || process.versions.node;
  if (compareVersions(nodeVersion, MIN_NODE_VERSION) < 0) {
    fail('GPR_UNSUPPORTED_RUNTIME', { required: MIN_NODE_VERSION, observed: nodeVersion });
  }
  let sqlite = options.sqlite;
  if (!sqlite) {
    try {
      sqlite = require('node:sqlite');
    } catch (error) {
      fail('GPR_SQLITE_UNAVAILABLE', { cause: error && error.code ? error.code : 'load-failed' });
    }
  }
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') fail('GPR_SQLITE_UNAVAILABLE');
  return sqlite;
}

function validateRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) {
    fail('GPR_REPOSITORY_INVALID');
  }
  return value.toLowerCase();
}

function isCanonicalRepository(value) {
  return typeof value === 'string'
    && /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(value);
}

function validateIssue(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail('GPR_NAMESPACE_INVALID', { field: name });
  return value;
}

function validateAuthority(value) {
  if (!exactKeys(value, AUTHORITY_KEYS)) fail('GPR_AUTHORITY_INVALID');
  validateIssue(value.child_comment_id, 'child_comment_id');
  validateIssue(value.parent_comment_id, 'parent_comment_id');
  if (!isSafeId(value.node_id) || !/^[A-Za-z0-9-]{1,39}$/.test(value.author_login || '')) fail('GPR_AUTHORITY_INVALID');
  if (value.author_association !== 'OWNER' || !isTimestamp(value.updated_at)) fail('GPR_AUTHORITY_INVALID');
  for (const key of ['body_digest', 'update_identity_digest', 'scope_digest']) {
    if (!isDigest(value[key])) fail('GPR_AUTHORITY_INVALID', { field: key });
  }
  assertPrivacySafe(value);
  return clone(value);
}

function validateStart(value) {
  if (!exactKeys(value, START_KEYS)) fail('GPR_START_INVALID');
  for (const key of ['base_sha', 'head_sha', 'tree_sha']) if (!isSha(value[key])) fail('GPR_START_INVALID', { field: key });
  if (!isDigest(value.status_digest) || value.clean_worktree !== true) fail('GPR_START_INVALID');
  if (!exactKeys(value.ref, ['detached', 'name']) || typeof value.ref.detached !== 'boolean') fail('GPR_START_INVALID');
  if (value.ref.detached) {
    if (value.ref.name !== null) fail('GPR_START_INVALID');
  } else if (!isSafeGitRef(value.ref.name)) {
    fail('GPR_START_INVALID');
  }
  assertPrivacySafe(value);
  return clone(value);
}

function validateCandidate(value) {
  if (!exactKeys(value, CANDIDATE_KEYS)) fail('GPR_CANDIDATE_INVALID');
  validateIssue(value.pr_number, 'pr_number');
  if (!isSafeGitRef(value.branch) || !isSafeGitRef(value.base_ref)) fail('GPR_CANDIDATE_INVALID');
  for (const key of ['base_sha', 'head_sha', 'tree_sha']) if (!isSha(value[key])) fail('GPR_CANDIDATE_INVALID', { field: key });
  assertPrivacySafe(value);
  return clone(value);
}

function validateTargetIdentity(value) {
  if (!exactKeys(value, TARGET_IDENTITY_KEYS)
    || !isSafeId(value.resource_type, 80)
    || !isSafeId(value.resource_id, 512)) fail('GPR_OPERATION_DESCRIPTOR_INVALID');
  assertPrivacySafe(value);
  if (byteLength(value) > LIMITS.targetIdentityBytes) fail('GPR_OPERATION_DESCRIPTOR_INVALID');
  return clone(value);
}

function validateOperationDescriptor(value) {
  if (!exactKeys(value, OPERATION_DESCRIPTOR_KEYS)) fail('GPR_OPERATION_DESCRIPTOR_INVALID');
  for (const item of Object.values(value)) if (typeof item === 'function') fail('GPR_OPERATION_DESCRIPTOR_INVALID');
  if (!OPERATION_KINDS.includes(value.operation_kind) || !SAFETY_CLASSES.includes(value.safety_class)) {
    fail('GPR_OPERATION_CLASS_FORBIDDEN');
  }
  const targetIdentity = validateTargetIdentity(value.target_identity);
  for (const key of ['target_digest', 'expected_source_digest', 'cas_digest', 'adapter_identity_digest']) {
    if (!isDigest(value[key])) fail('GPR_OPERATION_DESCRIPTOR_INVALID', { field: key });
  }
  if (value.target_digest !== digestValue(targetIdentity)
    || value.expected_post_state_digest !== null && !isDigest(value.expected_post_state_digest)
    || value.retry_of_operation_id !== null && !isSafeId(value.retry_of_operation_id)) {
    fail('GPR_OPERATION_DESCRIPTOR_INVALID');
  }
  const expectedClass = value.operation_kind === 'IDEMPOTENT_SET'
    ? 'IDEMPOTENT'
    : value.operation_kind === 'APPEND_CREATE' ? 'APPEND_IDEMPOTENT' : 'CAS';
  if (value.safety_class !== expectedClass) fail('GPR_OPERATION_CLASS_FORBIDDEN');
  const expectedResourceType = value.operation_kind === 'GIT_REF_UPDATE'
    ? 'git_ref' : value.operation_kind === 'APPEND_CREATE' ? 'provider_collection' : 'provider_resource';
  if (targetIdentity.resource_type !== expectedResourceType || /[,\s]/.test(targetIdentity.resource_id)) {
    fail('GPR_OPERATION_CLASS_FORBIDDEN');
  }
  if (value.operation_kind !== 'APPEND_CREATE' && value.expected_post_state_digest === null) {
    fail('GPR_OPERATION_DESCRIPTOR_INVALID');
  }
  assertPrivacySafe(value);
  return deepFreeze({ ...clone(value), target_identity: targetIdentity });
}

function outcomeEvidencePayload(value) {
  const payload = clone(value);
  delete payload.evidence_digest;
  return payload;
}

function validateOutcomeEvidence(value, operation) {
  if (!exactKeys(value, OUTCOME_EVIDENCE_KEYS) || !OPERATION_STATES.slice(2).includes(value.classification)) {
    fail('GPR_OUTCOME_EVIDENCE_INVALID');
  }
  const targetIdentity = validateTargetIdentity(value.target_identity);
  if (value.operation_id !== operation.operation_id
    || value.logical_operation_digest !== operation.logical_operation_digest
    || value.adapter_identity_digest !== operation.adapter_identity_digest
    || canonicalSerialize(targetIdentity) !== operation.target_identity_json
    || value.target_digest !== operation.target_digest
    || value.provider_operation_key !== operation.provider_operation_key
    || value.cas_digest !== operation.cas_digest
    || !isTimestamp(value.evidence_at)
    || Date.parse(value.evidence_at) < Date.parse(operation.created_at)
    || !isDigest(value.evidence_digest)
    || value.evidence_digest !== digestValue(outcomeEvidencePayload(value))) {
    fail('GPR_OUTCOME_EVIDENCE_INVALID');
  }
  for (const key of ['observed_post_state_digest', 'rejection_digest']) {
    if (value[key] !== null && !isDigest(value[key])) fail('GPR_OUTCOME_EVIDENCE_INVALID');
  }
  if (typeof value.delayed_completion_excluded !== 'boolean') fail('GPR_OUTCOME_EVIDENCE_INVALID');
  if (value.classification === 'APPLIED') {
    if (value.observed_post_state_digest === null || value.rejection_digest !== null
      || operation.expected_post_state_digest !== null
        && value.observed_post_state_digest !== operation.expected_post_state_digest) {
      fail('GPR_OUTCOME_EVIDENCE_INVALID');
    }
  } else if (value.classification === 'NOT_APPLIED') {
    if (value.observed_post_state_digest !== null || !isDigest(value.rejection_digest)
      || value.delayed_completion_excluded !== true) fail('GPR_OUTCOME_EVIDENCE_INVALID');
  }
  assertPrivacySafe(value);
  if (byteLength(value) > LIMITS.outcomeEvidenceBytes) fail('GPR_OUTCOME_EVIDENCE_INVALID');
  return deepFreeze({ ...clone(value), target_identity: targetIdentity });
}

function validatePayload(value) {
  if (!isRecord(value)) fail('GPR_PAYLOAD_INVALID');
  assertPrivacySafe(value);
  if (!Object.keys(value).every((key) => PAYLOAD_KEYS.includes(key))
    || !isSafeId(value.classification)) fail('GPR_PAYLOAD_INVALID');
  if (value.reason_code !== undefined && !isSafeId(value.reason_code)) fail('GPR_PAYLOAD_INVALID');
  for (const key of ['outcome_digest', 'evidence_digest', 'operation_digest', 'detail_digest']) {
    if (value[key] !== undefined && !isDigest(value[key])) fail('GPR_PAYLOAD_INVALID', { field: key });
  }
  if (value.mutation_outcome !== undefined && !['KNOWN', 'UNKNOWN'].includes(value.mutation_outcome)) fail('GPR_PAYLOAD_INVALID');
  if (value.evidence_refs !== undefined) {
    if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length > 50) fail('GPR_PAYLOAD_INVALID');
    for (const item of value.evidence_refs) {
      if (!exactKeys(item, ['id', 'digest']) || !isSafeId(item.id) || !isDigest(item.digest)) fail('GPR_PAYLOAD_INVALID');
    }
  }
  if (byteLength(value) > LIMITS.payloadBytes) fail('GPR_RECEIPT_TOO_LARGE');
  return clone(value);
}

function validateLease(value) {
  if (!exactKeys(value, LEASE_KEYS)) fail('GPR_LEASE_INVALID');
  if (!isSafeId(value.lease_id) || !isSafeId(value.fence_id)) fail('GPR_LEASE_INVALID');
  if (!Number.isSafeInteger(value.fence_sequence) || value.fence_sequence < 1) fail('GPR_LEASE_INVALID');
  if (!isTimestamp(value.issued_at) || !isTimestamp(value.expires_at) || Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail('GPR_LEASE_INVALID');
  }
  return clone(value);
}

function digestWithout(value, key) {
  const payload = clone(value);
  delete payload[key];
  return digestValue(payload);
}

function digestWithoutKeys(value, keys) {
  const payload = clone(value);
  for (const key of keys) delete payload[key];
  return digestValue(payload);
}

function validateHolderAttestation(value) {
  if (!exactKeys(value, HOLDER_ATTESTATION_KEYS)
    || value.schema !== HOLDER_ATTESTATION_SCHEMA_ID
    || value.algorithm !== HOLDER_ATTESTATION_ALGORITHM
    || !['windows', 'linux'].includes(value.platform)
    || !isCanonicalRepository(value.repository)
    || !isSafeContractId(value.attestation_id, 160)
    || !isSafeContractId(value.key_id, 80)
    || !isSafeContractId(value.lock)
    || !isSafeContractId(value.allocation_id)
    || !isSafeContractId(value.run_id)
    || !isSafeContractId(value.lease_id)
    || !isSafeContractId(value.fence_id)
    || !Number.isSafeInteger(value.fence_sequence) || value.fence_sequence < 1) {
    fail('GPR_HOLDER_ATTESTATION_INVALID');
  }
  validateIssue(value.parent_issue, 'parent_issue');
  validateIssue(value.child_issue, 'child_issue');
  for (const key of [
    'allocation_digest', 'run_digest', 'authority_digest', 'start_digest',
    'broker_identity_digest', 'process_id_digest', 'process_start_digest', 'boot_id_digest',
    'pid_namespace_digest', 'process_incarnation_digest', 'attestation_tag'
  ]) {
    if (!isDigest(value[key])) fail('GPR_HOLDER_ATTESTATION_INVALID', { field: key });
  }
  if (!isTimestamp(value.lease_issued_at) || !isTimestamp(value.lease_expires_at)
    || Date.parse(value.lease_expires_at) <= Date.parse(value.lease_issued_at)
    || !isDigest(value.attestation_digest)
    || value.attestation_digest !== digestWithout(value, 'attestation_digest')) {
    fail('GPR_HOLDER_ATTESTATION_INVALID');
  }
  assertPrivacySafe(value);
  return deepFreeze(clone(value));
}

function validatePreRecoveryEvidence(value) {
  if (!exactKeys(value, PRE_RECOVERY_EVIDENCE_KEYS)
    || value.schema !== PRE_RECOVERY_EVIDENCE_SCHEMA_ID
    || !isCanonicalRepository(value.repository)
    || !isSafeContractId(value.request_id)
    || !isSafeContractId(value.lock)
    || !isSafeContractId(value.old_allocation_id)
    || !isSafeContractId(value.old_run_id)
    || !isSafeContractId(value.old_lease_id)
    || !isSafeContractId(value.old_fence_id)
    || !Number.isSafeInteger(value.old_fence_sequence) || value.old_fence_sequence < 1
    || !isSafeContractId(value.old_lease_tip_event_id)
    || !isDigest(value.old_lease_tip_event_digest)
    || !isDigest(value.old_receipt_tip_id)
    || !Number.isSafeInteger(value.old_receipt_tip_sequence) || value.old_receipt_tip_sequence < 1
    || value.old_holder_classification !== BROKER_RECOVERY_CLASSIFICATION
    || !['windows', 'linux'].includes(value.recovery_peer_platform)
    || !isSafeContractId(value.broker_key_id, 80)
    || value.zero_operation_count !== 0
    || value.zero_operation_event_count !== 0) {
    fail('GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  }
  validateIssue(value.parent_issue, 'parent_issue');
  validateIssue(value.child_issue, 'child_issue');
  for (const key of [
    'namespace_digest', 'old_allocation_digest', 'old_run_digest',
    'old_receipt_tip_digest', 'old_receipt_chain_digest',
    'zero_operation_inventory_digest', 'authority_digest', 'source_digest', 'start_digest',
    'old_holder_identity_digest', 'old_holder_attestation_digest',
    'recovery_peer_identity_digest', 'recovery_peer_process_incarnation_digest',
    'broker_identity_digest'
  ]) {
    if (!isDigest(value[key])) fail('GPR_PRE_RECOVERY_EVIDENCE_INVALID', { field: key });
  }
  if (value.zero_operation_inventory_digest !== ZERO_OPERATION_INVENTORY_DIGEST) {
    fail('GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  }
  if (!isTimestamp(value.old_lease_issued_at) || !isTimestamp(value.old_lease_expires_at)
    || Date.parse(value.old_lease_expires_at) <= Date.parse(value.old_lease_issued_at)) {
    fail('GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  }
  const observations = [
    'observed_at', 'authority_observed_at', 'source_observed_at', 'start_observed_at',
    'store_observed_at', 'holder_observed_at'
  ];
  if (observations.some((key) => !isTimestamp(value[key]))) fail('GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  const observedAt = Date.parse(value.observed_at);
  if (observations.some((key) => Date.parse(value[key]) > observedAt)) fail('GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  assertPrivacySafe(value);
  return deepFreeze(clone(value));
}

function preRecoveryEvidenceDigest(value) {
  return digestValue(validatePreRecoveryEvidence(value));
}

function validateRecoveryRecord(value) {
  if (!exactKeys(value, RECOVERY_RECORD_KEYS)
    || value.schema !== RECOVERY_RECORD_SCHEMA_ID
    || !isSafeContractId(value.recovery_record_id)
    || !isSafeContractId(value.request_id)
    || !isSafeContractId(value.old_allocation_id)
    || !isSafeContractId(value.old_run_id)
    || !isSafeContractId(value.old_lease_id)
    || !isSafeContractId(value.old_fence_id)
    || !isSafeContractId(value.release_event_id)
    || !isSafeContractId(value.replacement_allocation_id)
    || !isSafeContractId(value.replacement_run_id)
    || !isSafeContractId(value.replacement_lease_id)
    || !isSafeContractId(value.replacement_fence_id)
    || !isSafeContractId(value.replacement_holder_attestation_id)
    || !Number.isSafeInteger(value.old_fence_sequence) || value.old_fence_sequence < 1
    || !Number.isSafeInteger(value.replacement_fence_sequence)
    || value.replacement_fence_sequence !== value.old_fence_sequence + 1
    || !Number.isSafeInteger(value.new_high_water)
    || value.new_high_water !== value.replacement_fence_sequence
    || !isTimestamp(value.committed_at)
    || !isDigest(value.recovery_record_digest)) {
    fail('GPR_RECOVERY_RECORD_INVALID');
  }
  const evidence = validatePreRecoveryEvidence(value.pre_recovery_evidence);
  if (preRecoveryEvidenceDigest(evidence) !== value.pre_recovery_evidence_digest
    || evidence.request_id !== value.request_id
    || evidence.namespace_digest !== value.namespace_digest
    || evidence.old_allocation_id !== value.old_allocation_id
    || evidence.old_run_id !== value.old_run_id
    || evidence.old_lease_id !== value.old_lease_id
    || evidence.old_fence_id !== value.old_fence_id
    || evidence.old_fence_sequence !== value.old_fence_sequence
    || evidence.authority_digest !== value.authority_digest
    || evidence.source_digest !== value.source_digest
    || evidence.start_digest !== value.start_digest) {
    fail('GPR_RECOVERY_RECORD_INVALID');
  }
  for (const key of [
    'namespace_digest', 'pre_recovery_evidence_digest', 'terminal_receipt_id',
    'terminal_receipt_digest', 'release_event_digest', 'replacement_allocation_digest',
    'replacement_run_digest', 'replacement_holder_attestation_digest', 'authority_digest',
    'source_digest', 'start_digest'
  ]) {
    if (!isDigest(value[key])) fail('GPR_RECOVERY_RECORD_INVALID', { field: key });
  }
  if (value.terminal_receipt_id !== value.terminal_receipt_digest) {
    fail('GPR_RECOVERY_RECORD_INVALID');
  }
  if (value.recovery_record_digest !== digestWithout(value, 'recovery_record_digest')) {
    fail('GPR_RECOVERY_RECORD_INVALID');
  }
  assertPrivacySafe(value);
  return deepFreeze(clone(value));
}

function validateReservedOrphanPayload(value) {
  if (!exactKeys(value, RESERVED_ORPHAN_PAYLOAD_KEYS)
    || value.classification !== BROKER_RECOVERY_CLASSIFICATION
    || value.reason_code !== BROKER_RECOVERY_REASON
    || !isDigest(value.evidence_digest)) {
    fail('GPR_RESERVED_ORPHAN_PAYLOAD_INVALID');
  }
  assertPrivacySafe(value);
  return deepFreeze(clone(value));
}

function receiptPayload(receipt) {
  const payload = clone(receipt);
  delete payload.receipt_id;
  return payload;
}

function validateReceiptObject(value) {
  if (!exactKeys(value, RECEIPT_KEYS)) fail('GPR_RECEIPT_INVALID');
  if (value.schema !== SCHEMA_ID || !RECEIPT_TYPES.includes(value.receipt_type)) fail('GPR_RECEIPT_INVALID');
  if (!isDigest(value.receipt_id) || value.receipt_id !== digestValue(receiptPayload(value))) fail('GPR_RECEIPT_TAMPERED');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > LIMITS.receiptsPerRun) fail('GPR_SEQUENCE_INVALID');
  if (value.prior_receipt_id !== null && !isDigest(value.prior_receipt_id)) fail('GPR_CHAIN_BROKEN');
  if (!isSafeId(value.run_id) || !isSafeId(value.allocation_id) || !isSafeId(value.lock)) fail('GPR_RECEIPT_INVALID');
  if (validateRepository(value.repository) !== value.repository) fail('GPR_REPOSITORY_INVALID');
  validateIssue(value.parent_issue, 'parent_issue');
  validateIssue(value.child_issue, 'child_issue');
  validateAuthority(value.authority);
  validateStart(value.start);
  if (value.candidate !== null) validateCandidate(value.candidate);
  validateLease(value.lease);
  validatePayload(value.payload);
  if (byteLength(value) > LIMITS.receiptBytes) fail('GPR_RECEIPT_TOO_LARGE');
  if (!isTimestamp(value.created_at) || Date.parse(value.created_at) < Date.parse(value.lease.issued_at)) fail('GPR_RECEIPT_INVALID');
  if (value.sequence === 1) {
    if (value.receipt_type !== 'RUN_STARTED' || value.prior_receipt_id !== null || value.candidate !== null) fail('GPR_RUN_STARTED_INVALID');
  } else if (value.receipt_type === 'RUN_STARTED' || value.prior_receipt_id === null) {
    fail('GPR_CHAIN_BROKEN');
  }
  return deepFreeze(clone(value));
}

function sameBinding(left, right) {
  return left.repository === right.repository
    && left.parent_issue === right.parent_issue
    && left.child_issue === right.child_issue
    && left.lock === right.lock
    && left.run_id === right.run_id
    && left.allocation_id === right.allocation_id
    && canonicalSerialize(left.authority) === canonicalSerialize(right.authority)
    && canonicalSerialize(left.start) === canonicalSerialize(right.start)
    && canonicalSerialize(left.lease) === canonicalSerialize(right.lease);
}

function validateReceiptChain(receipts) {
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > LIMITS.receiptsPerRun) fail('GPR_CHAIN_INVALID');
  const validated = receipts.map(validateReceiptObject);
  const ids = new Set();
  let candidate = null;
  let terminal = false;
  for (let index = 0; index < validated.length; index += 1) {
    const receipt = validated[index];
    if (ids.has(receipt.receipt_id)) fail('GPR_RECEIPT_DUPLICATE');
    ids.add(receipt.receipt_id);
    if (receipt.sequence !== index + 1) fail('GPR_SEQUENCE_REGRESSION');
    if (index > 0) {
      const prior = validated[index - 1];
      if (receipt.prior_receipt_id !== prior.receipt_id || !sameBinding(receipt, prior)) fail('GPR_CHAIN_BROKEN');
      if (Date.parse(receipt.created_at) < Date.parse(prior.created_at)) fail('GPR_RECEIPT_CHRONOLOGY_INVALID');
      if (terminal) fail('GPR_RUN_TERMINAL');
      if (candidate === null && receipt.candidate !== null) {
        if (receipt.receipt_type !== 'TRANSITION_PREVIEW') fail('GPR_CANDIDATE_INTRODUCTION_INVALID');
        candidate = receipt.candidate;
      } else if (candidate !== null && canonicalSerialize(receipt.candidate) !== canonicalSerialize(candidate)) {
        fail('GPR_CANDIDATE_CHANGED');
      } else if (candidate === null && receipt.candidate !== null) {
        candidate = receipt.candidate;
      }
    }
    if (TERMINAL_TYPES.includes(receipt.receipt_type)) terminal = true;
  }
  return deepFreeze(validated.map(clone));
}

function namespaceValue(options) {
  return Object.freeze({
    repository: validateRepository(options.repository),
    parent_issue: validateIssue(options.parent_issue, 'parent_issue'),
    child_issue: validateIssue(options.child_issue, 'child_issue')
  });
}

function namespaceDigest(namespace) {
  return digestValue({ schema: SCHEMA_ID, ...namespace });
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertNoSymlinkComponents(inputPath) {
  let current = path.resolve(inputPath);
  while (true) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'symlink-or-reparse' });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function hasGitWorktreeAncestor(inputPath) {
  let current = path.resolve(inputPath);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function stateAnchor() {
  return path.resolve(os.homedir(), '.ai-agent-toolkit', 'user-state', 'github-program-receipt');
}

function validateWindowsStorageProof(acl) {
  if (!acl || typeof acl.current !== 'string' || acl.owner !== acl.current
    || acl.drive_type !== 3 || !Array.isArray(acl.rules)) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-owner-or-drive' });
  }
  const trusted = new Set([acl.current, 'S-1-5-18', 'S-1-5-32-544']);
  if (acl.rules.some((rule) => !isRecord(rule) || rule.type === 'Allow' && !trusted.has(rule.sid))) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-untrusted-access' });
  }
  return true;
}

function verifyWindowsPrivateAcl(stateRoot) {
  const systemRoot = process.env.SystemRoot;
  const powershell = systemRoot && path.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!powershell || !path.isAbsolute(powershell) || !fs.existsSync(powershell)
    || !fs.lstatSync(powershell).isFile() || fs.lstatSync(powershell).isSymbolicLink()) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-tool-unproven' });
  }
  const script = [
    '$ErrorActionPreference="Stop"',
    '$acl=Get-Acl -LiteralPath $env:GPR_ACL_PATH',
    '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$owner=(New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value',
    '$rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{ sid=$_.IdentityReference.Value; type=[string]$_.AccessControlType; rights=[string]$_.FileSystemRights } })',
    '$root=[System.IO.Path]::GetPathRoot($env:GPR_ACL_PATH)',
    'if ($root -notmatch "^[A-Za-z]:\\\\$") { throw "non-local-root" }',
    '$device=$root.Substring(0,2)',
    '$disk=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID=\'"+$device+"\'")',
    'if ($null -eq $disk) { throw "drive-unproven" }',
    '[pscustomobject]@{ current=$current; owner=$owner; drive_type=[int]$disk.DriveType; rules=$rules } | ConvertTo-Json -Compress -Depth 4'
  ].join(';');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, GPR_ACL_PATH: stateRoot }
  });
  if (result.status !== 0 || !result.stdout) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-unproven' });
  let acl;
  try { acl = JSON.parse(result.stdout); } catch (_) { fail('GPR_UNSAFE_STATE_ROOT', { reason: 'acl-unproven' }); }
  validateWindowsStorageProof(acl);
}

function assertSafeStateRoot(options) {
  if (typeof options.stateRoot !== 'string' || !path.isAbsolute(options.stateRoot)) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'absolute-required' });
  if (typeof options.repositoryRoot !== 'string' || !path.isAbsolute(options.repositoryRoot)) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'repository-root-required' });
  const stateRoot = path.resolve(options.stateRoot);
  const repositoryRoot = path.resolve(options.repositoryRoot);
  for (const target of [stateRoot, repositoryRoot]) {
    if (!fs.existsSync(target) || !fs.lstatSync(target).isDirectory()) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'existing-directory-required' });
    assertNoSymlinkComponents(target);
    if (fs.realpathSync.native(target) !== target) fail('GPR_UNSAFE_STATE_ROOT', { reason: 'unproven-realpath' });
  }
  const tempRoot = fs.realpathSync.native(path.resolve(os.tmpdir()));
  const anchor = stateAnchor();
  if ((process.platform === 'win32' && (stateRoot.startsWith('\\\\') || anchor.startsWith('\\\\')))
    || !isWithin(stateRoot, anchor)
    || isWithin(stateRoot, repositoryRoot)
    || isWithin(stateRoot, tempRoot)
    || hasGitWorktreeAncestor(stateRoot)) {
    fail('GPR_UNSAFE_STATE_ROOT', { reason: 'forbidden-location' });
  }
  if (process.platform === 'win32') verifyWindowsPrivateAcl(stateRoot);
  else {
    const stat = fs.statSync(stateRoot);
    if (typeof process.getuid !== 'function' || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
      fail('GPR_UNSAFE_STATE_ROOT', { reason: 'private-permissions-required' });
    }
  }
  return stateRoot;
}

function resolveDatabasePath(options) {
  const namespace = namespaceValue(options);
  const stateRoot = assertSafeStateRoot(options);
  return path.join(stateRoot, `github-program-receipt-${namespaceDigest(namespace)}.sqlite`);
}

const SCHEMA_SQL = `
CREATE TABLE metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_id TEXT NOT NULL,
  namespace_digest TEXT NOT NULL,
  repository TEXT NOT NULL,
  parent_issue INTEGER NOT NULL,
  child_issue INTEGER NOT NULL,
  schema_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE coordination_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  high_water INTEGER NOT NULL CHECK (high_water >= 0)
) STRICT;
CREATE TABLE allocations (
  allocation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  lock_id TEXT NOT NULL,
  lease_id TEXT NOT NULL UNIQUE,
  fence_id TEXT NOT NULL UNIQUE,
  fence_sequence INTEGER NOT NULL UNIQUE,
  owner_instance_id TEXT NOT NULL,
  process_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  authority_json TEXT NOT NULL,
  start_json TEXT NOT NULL,
  allocation_digest TEXT NOT NULL
) STRICT;
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL UNIQUE REFERENCES allocations(allocation_id),
  lock_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  start_digest TEXT NOT NULL,
  run_digest TEXT NOT NULL
) STRICT;
CREATE TABLE receipts (
  receipt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  sequence INTEGER NOT NULL,
  receipt_type TEXT NOT NULL,
  prior_receipt_id TEXT REFERENCES receipts(receipt_id),
  canonical_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  UNIQUE (run_id, sequence)
) STRICT;
CREATE TABLE lease_events (
  event_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES allocations(allocation_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ALLOCATED', 'EXPIRED_TAKEOVER', 'RELEASED')),
  fence_sequence INTEGER NOT NULL,
  event_at TEXT NOT NULL,
  detail_digest TEXT NOT NULL,
  event_digest TEXT NOT NULL
) STRICT;
CREATE TABLE mutation_operations (
  operation_id TEXT PRIMARY KEY,
  logical_operation_digest TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  allocation_id TEXT NOT NULL REFERENCES allocations(allocation_id),
  lock_id TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  fence_id TEXT NOT NULL,
  fence_sequence INTEGER NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('GIT_REF_UPDATE', 'CONDITIONAL_PROVIDER_UPDATE', 'IDEMPOTENT_SET', 'APPEND_CREATE')),
  safety_class TEXT NOT NULL CHECK (safety_class IN ('CAS', 'IDEMPOTENT', 'APPEND_IDEMPOTENT')),
  target_identity_json TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  cas_digest TEXT NOT NULL,
  expected_post_state_digest TEXT,
  provider_operation_key TEXT NOT NULL UNIQUE,
  adapter_identity_digest TEXT NOT NULL,
  retry_of_operation_id TEXT UNIQUE REFERENCES mutation_operations(operation_id),
  created_at TEXT NOT NULL,
  operation_digest TEXT NOT NULL
) STRICT;
CREATE TABLE mutation_operation_events (
  event_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES mutation_operations(operation_id),
  sequence INTEGER NOT NULL,
  prior_event_id TEXT REFERENCES mutation_operation_events(event_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('PREPARED', 'IN_FLIGHT', 'OUTCOME_RECORDED', 'RECONCILED')),
  state TEXT NOT NULL CHECK (state IN ('PREPARED', 'IN_FLIGHT', 'APPLIED', 'NOT_APPLIED', 'UNKNOWN')),
  event_at TEXT NOT NULL,
  authority_digest TEXT NOT NULL,
  provider_evidence_digest TEXT NOT NULL,
  readback_digest TEXT,
  detail_digest TEXT NOT NULL,
  event_digest TEXT NOT NULL,
  UNIQUE (operation_id, sequence),
  UNIQUE (prior_event_id)
) STRICT;
CREATE INDEX receipts_run_sequence ON receipts(run_id, sequence);
CREATE INDEX lease_events_allocation ON lease_events(allocation_id, fence_sequence);
CREATE INDEX mutation_operations_run ON mutation_operations(run_id, fence_sequence);
CREATE INDEX mutation_operations_logical ON mutation_operations(logical_operation_digest, created_at);
CREATE INDEX mutation_operation_events_operation ON mutation_operation_events(operation_id, sequence);
CREATE TRIGGER metadata_no_update BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER metadata_no_delete BEFORE DELETE ON metadata BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER coordination_high_water_cas BEFORE UPDATE ON coordination_state
  WHEN NEW.singleton != OLD.singleton OR NEW.high_water != OLD.high_water + 1
  BEGIN SELECT RAISE(ABORT, 'GPR_HIGH_WATER_CAS'); END;
CREATE TRIGGER coordination_no_delete BEFORE DELETE ON coordination_state BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER allocations_no_update BEFORE UPDATE ON allocations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER allocations_no_delete BEFORE DELETE ON allocations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER runs_no_update BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER runs_no_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER lease_events_no_update BEFORE UPDATE ON lease_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER lease_events_no_delete BEFORE DELETE ON lease_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER mutation_operations_no_update BEFORE UPDATE ON mutation_operations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER mutation_operations_no_delete BEFORE DELETE ON mutation_operations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER mutation_operation_events_no_update BEFORE UPDATE ON mutation_operation_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER mutation_operation_events_no_delete BEFORE DELETE ON mutation_operation_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
`;

const V3_SCHEMA_SQL = `
CREATE TABLE holder_attestations (
  attestation_id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  parent_issue INTEGER NOT NULL,
  child_issue INTEGER NOT NULL,
  lock_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL UNIQUE REFERENCES allocations(allocation_id),
  allocation_digest TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
  run_digest TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  fence_id TEXT NOT NULL,
  fence_sequence INTEGER NOT NULL CHECK (fence_sequence >= 1),
  algorithm TEXT NOT NULL CHECK (algorithm = 'HMAC-SHA-256'),
  key_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('windows', 'linux')),
  authority_digest TEXT NOT NULL,
  start_digest TEXT NOT NULL,
  broker_identity_digest TEXT NOT NULL,
  process_id_digest TEXT NOT NULL,
  process_start_digest TEXT NOT NULL,
  boot_id_digest TEXT NOT NULL,
  pid_namespace_digest TEXT NOT NULL,
  process_incarnation_digest TEXT NOT NULL,
  lease_issued_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  attestation_digest TEXT NOT NULL UNIQUE,
  attestation_tag TEXT NOT NULL
) STRICT;
CREATE TABLE recovery_records (
  recovery_record_id TEXT PRIMARY KEY,
  recovery_record_digest TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  namespace_digest TEXT NOT NULL,
  old_allocation_id TEXT NOT NULL REFERENCES allocations(allocation_id),
  old_run_id TEXT NOT NULL REFERENCES runs(run_id),
  old_lease_id TEXT NOT NULL,
  old_fence_id TEXT NOT NULL,
  old_fence_sequence INTEGER NOT NULL CHECK (old_fence_sequence >= 1),
  pre_recovery_evidence_json TEXT NOT NULL,
  pre_recovery_evidence_digest TEXT NOT NULL,
  terminal_receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id),
  terminal_receipt_digest TEXT NOT NULL,
  release_event_id TEXT NOT NULL REFERENCES lease_events(event_id),
  release_event_digest TEXT NOT NULL,
  replacement_allocation_id TEXT NOT NULL REFERENCES allocations(allocation_id),
  replacement_allocation_digest TEXT NOT NULL,
  replacement_run_id TEXT NOT NULL REFERENCES runs(run_id),
  replacement_run_digest TEXT NOT NULL,
  replacement_lease_id TEXT NOT NULL,
  replacement_fence_id TEXT NOT NULL,
  replacement_fence_sequence INTEGER NOT NULL CHECK (replacement_fence_sequence >= 2),
  replacement_holder_attestation_id TEXT NOT NULL REFERENCES holder_attestations(attestation_id),
  replacement_holder_attestation_digest TEXT NOT NULL,
  new_high_water INTEGER NOT NULL CHECK (new_high_water >= 2),
  authority_digest TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  start_digest TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  CHECK (terminal_receipt_id = terminal_receipt_digest),
  CHECK (replacement_fence_sequence = old_fence_sequence + 1),
  CHECK (new_high_water = replacement_fence_sequence)
) STRICT;
CREATE TABLE receipt_chain_digests (
  receipt_id TEXT PRIMARY KEY CHECK (
    length(receipt_id) = 64
    AND receipt_id NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  sequence INTEGER NOT NULL CHECK (
    sequence >= 1
    AND sequence <= 128
  ),
  chain_digest TEXT NOT NULL CHECK (
    length(chain_digest) = 64
    AND chain_digest NOT GLOB '*[^0-9a-f]*'
  ),
  UNIQUE (run_id, sequence),
  FOREIGN KEY (receipt_id)
  REFERENCES receipts(receipt_id)
  DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (run_id, sequence)
  REFERENCES receipts(run_id, sequence)
  DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX holder_attestations_allocation ON holder_attestations(allocation_id, fence_sequence);
CREATE INDEX recovery_records_old_run ON recovery_records(old_run_id, old_fence_sequence);
CREATE INDEX recovery_records_replacement ON recovery_records(replacement_run_id, replacement_fence_sequence);
CREATE INDEX receipt_chain_digests_run_sequence ON receipt_chain_digests(run_id, sequence);
CREATE TRIGGER v3_metadata_no_replace BEFORE INSERT ON metadata
WHEN EXISTS (SELECT 1 FROM metadata WHERE singleton = NEW.singleton)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_coordination_no_replace BEFORE INSERT ON coordination_state
WHEN EXISTS (SELECT 1 FROM coordination_state WHERE singleton = NEW.singleton)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_allocations_no_replace BEFORE INSERT ON allocations
WHEN EXISTS (
  SELECT 1 FROM allocations
  WHERE allocation_id = NEW.allocation_id
     OR run_id = NEW.run_id
     OR lease_id = NEW.lease_id
     OR fence_id = NEW.fence_id
     OR fence_sequence = NEW.fence_sequence
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_runs_no_replace BEFORE INSERT ON runs
WHEN EXISTS (
  SELECT 1 FROM runs
  WHERE run_id = NEW.run_id OR allocation_id = NEW.allocation_id
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_receipts_no_replace BEFORE INSERT ON receipts
WHEN EXISTS (
  SELECT 1 FROM receipts
  WHERE receipt_id = NEW.receipt_id
     OR (run_id = NEW.run_id AND sequence = NEW.sequence)
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_lease_events_no_replace BEFORE INSERT ON lease_events
WHEN EXISTS (SELECT 1 FROM lease_events WHERE event_id = NEW.event_id)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_mutation_operations_no_replace BEFORE INSERT ON mutation_operations
WHEN EXISTS (
  SELECT 1 FROM mutation_operations
  WHERE operation_id = NEW.operation_id
     OR provider_operation_key = NEW.provider_operation_key
     OR retry_of_operation_id = NEW.retry_of_operation_id
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER v3_mutation_operation_events_no_replace BEFORE INSERT ON mutation_operation_events
WHEN EXISTS (
  SELECT 1 FROM mutation_operation_events
  WHERE event_id = NEW.event_id
     OR (operation_id = NEW.operation_id AND sequence = NEW.sequence)
     OR prior_event_id = NEW.prior_event_id
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER holder_attestations_coherence BEFORE INSERT ON holder_attestations
WHEN NOT EXISTS (
  SELECT 1
  FROM metadata m
  JOIN allocations a ON a.allocation_id = NEW.allocation_id
  JOIN runs r ON r.run_id = NEW.run_id
  WHERE m.singleton = 1
    AND NEW.repository = m.repository
    AND NEW.parent_issue = m.parent_issue
    AND NEW.child_issue = m.child_issue
    AND r.allocation_id = a.allocation_id
    AND r.run_id = a.run_id
    AND r.lock_id = a.lock_id
    AND NEW.allocation_digest = a.allocation_digest
    AND NEW.run_id = a.run_id
    AND NEW.run_digest = r.run_digest
    AND NEW.lock_id = a.lock_id
    AND NEW.lease_id = a.lease_id
    AND NEW.fence_id = a.fence_id
    AND NEW.fence_sequence = a.fence_sequence
    AND NEW.authority_digest = r.authority_digest
    AND NEW.start_digest = r.start_digest
    AND NEW.lease_issued_at = a.issued_at
    AND NEW.lease_expires_at = a.expires_at
)
BEGIN SELECT RAISE(ABORT, 'GPR_V3_HOLDER_COHERENCE'); END;
CREATE TRIGGER holder_attestations_no_replace BEFORE INSERT ON holder_attestations
WHEN EXISTS (
  SELECT 1 FROM holder_attestations
  WHERE attestation_id = NEW.attestation_id
     OR allocation_id = NEW.allocation_id
     OR run_id = NEW.run_id
     OR attestation_digest = NEW.attestation_digest
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER recovery_records_coherence BEFORE INSERT ON recovery_records
WHEN NOT EXISTS (
  SELECT 1
  FROM metadata m
  JOIN coordination_state c ON c.singleton = 1
  JOIN allocations old_allocation ON old_allocation.allocation_id = NEW.old_allocation_id
  JOIN runs old_run ON old_run.run_id = NEW.old_run_id
  JOIN lease_events old_lease_tip
    ON old_lease_tip.event_id = json_extract(NEW.pre_recovery_evidence_json, '$.old_lease_tip_event_id')
  JOIN receipts old_receipt_tip
    ON old_receipt_tip.receipt_id = json_extract(NEW.pre_recovery_evidence_json, '$.old_receipt_tip_id')
  JOIN holder_attestations old_holder
    ON old_holder.attestation_digest = json_extract(NEW.pre_recovery_evidence_json, '$.old_holder_attestation_digest')
  JOIN receipts terminal_receipt ON terminal_receipt.receipt_id = NEW.terminal_receipt_id
  JOIN lease_events release_event ON release_event.event_id = NEW.release_event_id
  JOIN allocations replacement_allocation ON replacement_allocation.allocation_id = NEW.replacement_allocation_id
  JOIN runs replacement_run ON replacement_run.run_id = NEW.replacement_run_id
  JOIN holder_attestations replacement_holder
    ON replacement_holder.attestation_id = NEW.replacement_holder_attestation_id
  WHERE json_valid(NEW.pre_recovery_evidence_json)
    AND m.singleton = 1
    AND m.namespace_digest = NEW.namespace_digest
    AND c.high_water = NEW.new_high_water
    AND json_extract(NEW.pre_recovery_evidence_json, '$.schema') = 'toolkit.github-program.pre-recovery-evidence.v1'
    AND json_extract(NEW.pre_recovery_evidence_json, '$.request_id') = NEW.request_id
    AND json_extract(NEW.pre_recovery_evidence_json, '$.namespace_digest') = NEW.namespace_digest
    AND json_extract(NEW.pre_recovery_evidence_json, '$.repository') = m.repository
    AND json_extract(NEW.pre_recovery_evidence_json, '$.parent_issue') = m.parent_issue
    AND json_extract(NEW.pre_recovery_evidence_json, '$.child_issue') = m.child_issue
    AND json_extract(NEW.pre_recovery_evidence_json, '$.lock') = old_allocation.lock_id
    AND old_run.allocation_id = old_allocation.allocation_id
    AND old_run.run_id = old_allocation.run_id
    AND old_run.lock_id = old_allocation.lock_id
    AND NEW.old_run_id = old_allocation.run_id
    AND NEW.old_lease_id = old_allocation.lease_id
    AND NEW.old_fence_id = old_allocation.fence_id
    AND NEW.old_fence_sequence = old_allocation.fence_sequence
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_allocation_id') = old_allocation.allocation_id
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_allocation_digest') = old_allocation.allocation_digest
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_run_id') = old_run.run_id
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_run_digest') = old_run.run_digest
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_lease_id') = old_allocation.lease_id
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_fence_id') = old_allocation.fence_id
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_fence_sequence') = old_allocation.fence_sequence
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_lease_issued_at') = old_allocation.issued_at
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_lease_expires_at') = old_allocation.expires_at
    AND json_extract(NEW.pre_recovery_evidence_json, '$.observed_at') >= old_allocation.expires_at
    AND NEW.authority_digest = json_extract(NEW.pre_recovery_evidence_json, '$.authority_digest')
    AND NEW.source_digest = json_extract(NEW.pre_recovery_evidence_json, '$.source_digest')
    AND NEW.start_digest = json_extract(NEW.pre_recovery_evidence_json, '$.start_digest')
    AND old_run.authority_digest = json_extract(NEW.pre_recovery_evidence_json, '$.authority_digest')
    AND old_run.start_digest = json_extract(NEW.pre_recovery_evidence_json, '$.start_digest')
    AND NEW.authority_digest = old_run.authority_digest
    AND NEW.start_digest = old_run.start_digest
    AND json_extract(NEW.pre_recovery_evidence_json, '$.zero_operation_count') = (
      SELECT COUNT(*) FROM mutation_operations WHERE run_id = old_run.run_id
    )
    AND json_extract(NEW.pre_recovery_evidence_json, '$.zero_operation_event_count') = (
      SELECT COUNT(*)
      FROM mutation_operation_events e
      JOIN mutation_operations o ON o.operation_id = e.operation_id
      WHERE o.run_id = old_run.run_id
    )
    AND json_extract(NEW.pre_recovery_evidence_json, '$.zero_operation_count') = 0
    AND json_extract(NEW.pre_recovery_evidence_json, '$.zero_operation_event_count') = 0
    AND json_extract(NEW.pre_recovery_evidence_json, '$.zero_operation_inventory_digest') = '${ZERO_OPERATION_INVENTORY_DIGEST}'
    AND old_lease_tip.allocation_id = old_allocation.allocation_id
    AND old_lease_tip.fence_sequence = old_allocation.fence_sequence
    AND old_lease_tip.event_digest = json_extract(NEW.pre_recovery_evidence_json, '$.old_lease_tip_event_digest')
    AND old_lease_tip.event_at <= json_extract(NEW.pre_recovery_evidence_json, '$.observed_at')
    AND NOT EXISTS (
      SELECT 1 FROM lease_events later
      WHERE later.allocation_id = old_allocation.allocation_id
        AND (later.event_at > old_lease_tip.event_at
          OR later.event_at = old_lease_tip.event_at AND later.event_id > old_lease_tip.event_id)
        AND later.event_at <= json_extract(NEW.pre_recovery_evidence_json, '$.observed_at')
    )
    AND json_extract(NEW.pre_recovery_evidence_json, '$.old_receipt_tip_sequence') = old_receipt_tip.sequence
    AND old_receipt_tip.run_id = old_run.run_id
    AND old_receipt_tip.receipt_digest = json_extract(NEW.pre_recovery_evidence_json, '$.old_receipt_tip_digest')
    AND old_receipt_tip.receipt_id = old_receipt_tip.receipt_digest
    AND json_valid(old_receipt_tip.canonical_json)
    AND json_extract(old_receipt_tip.canonical_json, '$.schema') = 'toolkit.github-program.run-receipt.v1'
    AND json_extract(old_receipt_tip.canonical_json, '$.receipt_id') = old_receipt_tip.receipt_id
    AND json_extract(old_receipt_tip.canonical_json, '$.sequence') = old_receipt_tip.sequence
    AND json_extract(old_receipt_tip.canonical_json, '$.run_id') = old_run.run_id
    AND json_extract(old_receipt_tip.canonical_json, '$.allocation_id') = old_allocation.allocation_id
    AND json_extract(old_receipt_tip.canonical_json, '$.lock') = old_allocation.lock_id
    AND json_extract(old_receipt_tip.canonical_json, '$.authority') = json(old_allocation.authority_json)
    AND json_extract(old_receipt_tip.canonical_json, '$.start') = json(old_allocation.start_json)
    AND json_extract(old_receipt_tip.canonical_json, '$.lease.lease_id') = old_allocation.lease_id
    AND json_extract(old_receipt_tip.canonical_json, '$.lease.fence_id') = old_allocation.fence_id
    AND json_extract(old_receipt_tip.canonical_json, '$.lease.fence_sequence') = old_allocation.fence_sequence
    AND json_extract(old_receipt_tip.canonical_json, '$.lease.issued_at') = old_allocation.issued_at
    AND json_extract(old_receipt_tip.canonical_json, '$.lease.expires_at') = old_allocation.expires_at
    AND json_extract(old_receipt_tip.canonical_json, '$.created_at') <= json_extract(NEW.pre_recovery_evidence_json, '$.observed_at')
    AND json_extract(old_receipt_tip.canonical_json, '$.repository') = m.repository
    AND json_extract(old_receipt_tip.canonical_json, '$.parent_issue') = m.parent_issue
    AND json_extract(old_receipt_tip.canonical_json, '$.child_issue') = m.child_issue
    AND old_holder.allocation_id = old_allocation.allocation_id
    AND old_holder.run_id = old_run.run_id
    AND old_holder.lease_id = old_allocation.lease_id
    AND old_holder.fence_id = old_allocation.fence_id
    AND old_holder.fence_sequence = old_allocation.fence_sequence
    AND old_holder.repository = m.repository
    AND old_holder.parent_issue = m.parent_issue
    AND old_holder.child_issue = m.child_issue
    AND old_holder.lock_id = old_allocation.lock_id
    AND old_holder.authority_digest = old_run.authority_digest
    AND old_holder.start_digest = old_run.start_digest
    AND old_holder.lease_issued_at = old_allocation.issued_at
    AND old_holder.lease_expires_at = old_allocation.expires_at
    AND old_holder.process_incarnation_digest = json_extract(NEW.pre_recovery_evidence_json, '$.old_holder_identity_digest')
    AND old_holder.broker_identity_digest = json_extract(NEW.pre_recovery_evidence_json, '$.broker_identity_digest')
    AND old_holder.key_id = json_extract(NEW.pre_recovery_evidence_json, '$.broker_key_id')
    AND terminal_receipt.run_id = old_run.run_id
    AND terminal_receipt.receipt_type = 'RUN_INTERRUPTED'
    AND terminal_receipt.prior_receipt_id = old_receipt_tip.receipt_id
    AND terminal_receipt.sequence = old_receipt_tip.sequence + 1
    AND terminal_receipt.receipt_id = terminal_receipt.receipt_digest
    AND terminal_receipt.receipt_digest = NEW.terminal_receipt_digest
    AND json_valid(terminal_receipt.canonical_json)
    AND json_extract(terminal_receipt.canonical_json, '$.schema') = 'toolkit.github-program.run-receipt.v1'
    AND json_extract(terminal_receipt.canonical_json, '$.receipt_id') = terminal_receipt.receipt_id
    AND json_extract(terminal_receipt.canonical_json, '$.sequence') = terminal_receipt.sequence
    AND json_extract(terminal_receipt.canonical_json, '$.run_id') = old_run.run_id
    AND json_extract(terminal_receipt.canonical_json, '$.allocation_id') = old_allocation.allocation_id
    AND json_extract(terminal_receipt.canonical_json, '$.lock') = old_allocation.lock_id
    AND json_extract(terminal_receipt.canonical_json, '$.authority') = json(old_allocation.authority_json)
    AND json_extract(terminal_receipt.canonical_json, '$.start') = json(old_allocation.start_json)
    AND json_extract(terminal_receipt.canonical_json, '$.lease.lease_id') = old_allocation.lease_id
    AND json_extract(terminal_receipt.canonical_json, '$.lease.fence_id') = old_allocation.fence_id
    AND json_extract(terminal_receipt.canonical_json, '$.lease.fence_sequence') = old_allocation.fence_sequence
    AND json_extract(terminal_receipt.canonical_json, '$.lease.issued_at') = old_allocation.issued_at
    AND json_extract(terminal_receipt.canonical_json, '$.lease.expires_at') = old_allocation.expires_at
    AND json_extract(terminal_receipt.canonical_json, '$.created_at') >= json_extract(NEW.pre_recovery_evidence_json, '$.observed_at')
    AND json_extract(terminal_receipt.canonical_json, '$.repository') = m.repository
    AND json_extract(terminal_receipt.canonical_json, '$.parent_issue') = m.parent_issue
    AND json_extract(terminal_receipt.canonical_json, '$.child_issue') = m.child_issue
    AND json_extract(terminal_receipt.canonical_json, '$.payload.classification') = 'ORPHAN_NONADOPTABLE'
    AND json_extract(terminal_receipt.canonical_json, '$.payload.reason_code') = 'BROKER_PROTECTED_RECOVERY'
    AND json_extract(terminal_receipt.canonical_json, '$.payload.evidence_digest') = NEW.pre_recovery_evidence_digest
    AND release_event.allocation_id = old_allocation.allocation_id
    AND release_event.event_type = 'RELEASED'
    AND release_event.fence_sequence = old_allocation.fence_sequence
    AND release_event.event_digest = NEW.release_event_digest
    AND release_event.event_at >= json_extract(terminal_receipt.canonical_json, '$.created_at')
    AND NEW.committed_at >= release_event.event_at
    AND replacement_run.allocation_id = replacement_allocation.allocation_id
    AND replacement_run.run_id = replacement_allocation.run_id
    AND replacement_run.lock_id = replacement_allocation.lock_id
    AND replacement_allocation.lock_id = old_allocation.lock_id
    AND NEW.replacement_allocation_digest = replacement_allocation.allocation_digest
    AND NEW.replacement_run_id = replacement_allocation.run_id
    AND NEW.replacement_run_digest = replacement_run.run_digest
    AND NEW.replacement_lease_id = replacement_allocation.lease_id
    AND NEW.replacement_fence_id = replacement_allocation.fence_id
    AND NEW.replacement_fence_sequence = replacement_allocation.fence_sequence
    AND replacement_allocation.fence_sequence = old_allocation.fence_sequence + 1
    AND NEW.replacement_holder_attestation_digest = replacement_holder.attestation_digest
    AND EXISTS (
      SELECT 1 FROM lease_events replacement_takeover
      WHERE replacement_takeover.allocation_id = replacement_allocation.allocation_id
        AND replacement_takeover.event_type = 'EXPIRED_TAKEOVER'
        AND replacement_takeover.fence_sequence = replacement_allocation.fence_sequence
    )
    AND replacement_holder.allocation_id = replacement_allocation.allocation_id
    AND replacement_holder.run_id = replacement_run.run_id
    AND replacement_holder.repository = m.repository
    AND replacement_holder.parent_issue = m.parent_issue
    AND replacement_holder.child_issue = m.child_issue
    AND replacement_holder.lock_id = replacement_allocation.lock_id
    AND replacement_holder.allocation_digest = replacement_allocation.allocation_digest
    AND replacement_holder.run_digest = replacement_run.run_digest
    AND replacement_holder.lease_id = replacement_allocation.lease_id
    AND replacement_holder.fence_id = replacement_allocation.fence_id
    AND replacement_holder.fence_sequence = replacement_allocation.fence_sequence
    AND replacement_holder.authority_digest = replacement_run.authority_digest
    AND replacement_holder.start_digest = replacement_run.start_digest
    AND replacement_holder.lease_issued_at = replacement_allocation.issued_at
    AND replacement_holder.lease_expires_at = replacement_allocation.expires_at
)
BEGIN SELECT RAISE(ABORT, 'GPR_V3_RECOVERY_COHERENCE'); END;
CREATE TRIGGER recovery_records_no_replace BEFORE INSERT ON recovery_records
WHEN EXISTS (
  SELECT 1 FROM recovery_records
  WHERE recovery_record_id = NEW.recovery_record_id
     OR recovery_record_digest = NEW.recovery_record_digest
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipt_chain_digests_no_replace BEFORE INSERT ON receipt_chain_digests
WHEN EXISTS (
  SELECT 1 FROM receipt_chain_digests
  WHERE receipt_id = NEW.receipt_id
     OR (run_id = NEW.run_id AND sequence = NEW.sequence)
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER holder_attestations_no_update BEFORE UPDATE ON holder_attestations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER holder_attestations_no_delete BEFORE DELETE ON holder_attestations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER recovery_records_no_update BEFORE UPDATE ON recovery_records BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER recovery_records_no_delete BEFORE DELETE ON recovery_records BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipt_chain_digests_no_update BEFORE UPDATE ON receipt_chain_digests BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER receipt_chain_digests_no_delete BEFORE DELETE ON receipt_chain_digests BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
`;

const FINAL_V3_SCHEMA_SQL = `${SCHEMA_SQL}\n${V3_SCHEMA_SQL}`;
const METADATA_NO_UPDATE_TRIGGER_SQL = "CREATE TRIGGER metadata_no_update BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;";
const MIGRATION_STEPS = Object.freeze([
  Object.freeze({ step: 1, action: 'RECOGNIZE_EXACT_CANONICAL_V2' }),
  Object.freeze({ step: 2, action: 'VERIFY_NAMESPACE_INTEGRITY_FK_HISTORICAL_DIGESTS_AND_CHAIN' }),
  Object.freeze({ step: 3, action: 'CHECK_MIGRATION_QUIESCENCE' }),
  Object.freeze({ step: 4, action: 'BEGIN_IMMEDIATE' }),
  Object.freeze({ step: 5, action: 'REVERIFY_V2_SOURCE_INSIDE_TRANSACTION' }),
  Object.freeze({ step: 6, action: 'REMOVE_METADATA_NO_UPDATE' }),
  Object.freeze({ step: 7, action: 'ADD_FINAL_V3_TABLES_INDEXES_AND_TRIGGERS' }),
  Object.freeze({ step: 8, action: 'WRITE_EXPECTED_FINAL_V3_FINGERPRINT' }),
  Object.freeze({ step: 9, action: 'RESTORE_METADATA_NO_UPDATE' }),
  Object.freeze({ step: 10, action: 'SET_USER_VERSION_3' }),
  Object.freeze({ step: 11, action: 'VERIFY_FINAL_V3_SCHEMA_FINGERPRINT' }),
  Object.freeze({ step: 12, action: 'REVERIFY_INTEGRITY_FK_HISTORICAL_DIGESTS_AND_HIGH_WATER' }),
  Object.freeze({ step: 13, action: 'COMMIT' }),
  Object.freeze({ step: 14, action: 'INDEPENDENT_REOPEN_AND_READBACK' })
]);

function oneValue(db, pragma, field) {
  const row = db.prepare(pragma).get();
  return row && row[field];
}

function configureDatabase(db, readOnly = false) {
  db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA trusted_schema=OFF');
  db.exec('PRAGMA recursive_triggers=ON');
  const journal = String(oneValue(db, readOnly ? 'PRAGMA journal_mode' : 'PRAGMA journal_mode=DELETE', 'journal_mode') || '').toLowerCase();
  if (!readOnly) db.exec('PRAGMA synchronous=FULL');
  else db.exec('PRAGMA query_only=ON');
  const pageSize = Number(oneValue(db, 'PRAGMA page_size', 'page_size'));
  const maxPages = Math.floor(LIMITS.databaseBytes / pageSize);
  db.exec(`PRAGMA max_page_count=${maxPages}`);
  if (journal !== 'delete'
    || Number(oneValue(db, 'PRAGMA synchronous', 'synchronous')) !== 2
    || Number(oneValue(db, 'PRAGMA foreign_keys', 'foreign_keys')) !== 1
    || Number(oneValue(db, 'PRAGMA trusted_schema', 'trusted_schema')) !== 0
    || Number(oneValue(db, 'PRAGMA recursive_triggers', 'recursive_triggers')) !== 1
    || Number(oneValue(db, 'PRAGMA busy_timeout', 'timeout')) !== BUSY_TIMEOUT_MS
    || !Number.isSafeInteger(pageSize) || pageSize < 512
    || Number(oneValue(db, 'PRAGMA max_page_count', 'max_page_count')) !== maxPages) {
    fail('GPR_SQLITE_POLICY_UNAVAILABLE');
  }
}

function schemaFingerprint(db) {
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  return digestValue(rows);
}

let expectedSchemaFingerprintCache = null;

function expectedSchemaFingerprint(DatabaseSync) {
  if (expectedSchemaFingerprintCache) return expectedSchemaFingerprintCache;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    db.exec(SCHEMA_SQL);
    expectedSchemaFingerprintCache = schemaFingerprint(db);
    return expectedSchemaFingerprintCache;
  } finally {
    db.close();
  }
}

let expectedFinalV3SchemaFingerprintCache = null;

function sqliteDatabaseConstructor(DatabaseSync) {
  if (typeof DatabaseSync === 'function') return DatabaseSync;
  const sqlite = assertRuntimeSupport();
  return sqlite.DatabaseSync;
}

function expectedV2SchemaFingerprint(DatabaseSync) {
  return expectedSchemaFingerprint(sqliteDatabaseConstructor(DatabaseSync));
}

function expectedFinalV3SchemaFingerprint(DatabaseSync) {
  if (expectedFinalV3SchemaFingerprintCache) return expectedFinalV3SchemaFingerprintCache;
  const Constructor = sqliteDatabaseConstructor(DatabaseSync);
  const db = new Constructor(':memory:');
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    db.exec(FINAL_V3_SCHEMA_SQL);
    expectedFinalV3SchemaFingerprintCache = schemaFingerprint(db);
    return expectedFinalV3SchemaFingerprintCache;
  } finally {
    db.close();
  }
}

function buildFinalV3SchemaSql() {
  return FINAL_V3_SCHEMA_SQL;
}

function validateV2MigrationObservation(value) {
  if (!exactKeys(value, MIGRATION_OBSERVATION_KEYS)
    || value.application_id !== APPLICATION_ID
    || value.user_version !== USER_VERSION
    || value.schema_fingerprint !== expectedV2SchemaFingerprint()
    || value.namespace_verified !== true
    || value.integrity_verified !== true
    || value.foreign_keys_verified !== true
    || value.historical_digests_verified !== true
    || value.chain_verified !== true
    || value.high_water_verified !== true
    || value.unresolved_operation_count !== 0
    || value.unexpired_unreleased_allocation_count !== 0
    || !isTimestamp(value.observed_at)) {
    if (isRecord(value)
      && (value.unresolved_operation_count !== 0
        || value.unexpired_unreleased_allocation_count !== 0)) {
      fail('GPR_MIGRATION_NOT_QUIESCENT');
    }
    fail('GPR_V2_MIGRATION_SOURCE_INVALID');
  }
  assertPrivacySafe(value);
  return deepFreeze(clone(value));
}

function buildV2ToV3MigrationPlan(observation) {
  const source = validateV2MigrationObservation(observation);
  const targetFingerprint = expectedFinalV3SchemaFingerprint();
  return deepFreeze({
    schema: V3_MIGRATION_PLAN_SCHEMA_ID,
    source_application_id: APPLICATION_ID,
    source_user_version: USER_VERSION,
    source_schema_fingerprint: source.schema_fingerprint,
    target_application_id: APPLICATION_ID,
    target_user_version: V3_USER_VERSION,
    target_schema_fingerprint: targetFingerprint,
    source_observation_digest: digestValue(source),
    quiescence: {
      unresolved_operation_count: source.unresolved_operation_count,
      unexpired_unreleased_allocation_count: source.unexpired_unreleased_allocation_count,
      observed_at: source.observed_at
    },
    schema_sql: V3_SCHEMA_SQL,
    metadata_no_update_trigger_sql: METADATA_NO_UPDATE_TRIGGER_SQL,
    steps: MIGRATION_STEPS
  });
}

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* Preserve the original failure. */ }
    throw error;
  }
}

function createDatabase(db, namespace, digest, now, expectedFingerprint) {
  transaction(db, () => {
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    db.exec(`PRAGMA user_version=${USER_VERSION}`);
    const fingerprint = schemaFingerprint(db);
    if (fingerprint !== expectedFingerprint) fail('GPR_SCHEMA_MISMATCH');
    db.prepare('INSERT INTO metadata VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(
      SCHEMA_ID, digest, namespace.repository, namespace.parent_issue, namespace.child_issue, fingerprint, now
    );
    db.prepare('INSERT INTO coordination_state VALUES (1, 0)').run();
  });
}

function verifyRowDigests(db) {
  for (const row of db.prepare('SELECT * FROM allocations ORDER BY fence_sequence').all()) {
    let authority;
    let start;
    try {
      authority = JSON.parse(row.authority_json);
      start = JSON.parse(row.start_json);
    } catch (_) {
      fail('GPR_LEDGER_TAMPERED');
    }
    validateAuthority(authority);
    validateStart(start);
    const digest = digestValue({
      allocation_id: row.allocation_id,
      run_id: row.run_id,
      lock: row.lock_id,
      lease_id: row.lease_id,
      fence_id: row.fence_id,
      fence_sequence: row.fence_sequence,
      owner_instance_id: row.owner_instance_id,
      process_id: row.process_id,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      authority,
      start
    });
    if (digest !== row.allocation_digest) fail('GPR_ALLOCATOR_TAMPERED');
  }
  for (const row of db.prepare('SELECT * FROM runs ORDER BY run_id').all()) {
    if (row.run_digest !== digestValue({
      run_id: row.run_id,
      allocation_id: row.allocation_id,
      lock: row.lock_id,
      authority_digest: row.authority_digest,
      start_digest: row.start_digest
    })) fail('GPR_LEDGER_TAMPERED');
  }
  for (const row of db.prepare('SELECT * FROM lease_events ORDER BY fence_sequence, event_at, event_id').all()) {
    if (row.event_digest !== digestValue({
      event_id: row.event_id,
      allocation_id: row.allocation_id,
      event_type: row.event_type,
      fence_sequence: row.fence_sequence,
      event_at: row.event_at,
      detail_digest: row.detail_digest
    })) fail('GPR_LEDGER_TAMPERED');
  }
  const operations = db.prepare('SELECT * FROM mutation_operations ORDER BY created_at, operation_id').all();
  const events = db.prepare('SELECT * FROM mutation_operation_events ORDER BY operation_id, sequence').all();
  if (operations.length > LIMITS.operationsPerNamespace || events.length > LIMITS.operationEventsPerNamespace) {
    fail('GPR_OPERATION_LIMIT');
  }
  const operationIds = new Set();
  const operationRowsById = new Map();
  for (const row of operations) {
    operationIds.add(row.operation_id);
    operationRowsById.set(row.operation_id, row);
    let targetIdentity;
    try { targetIdentity = JSON.parse(row.target_identity_json); } catch (_) { fail('GPR_OPERATION_TAMPERED'); }
    validateTargetIdentity(targetIdentity);
    const allocation = db.prepare('SELECT * FROM allocations WHERE allocation_id = ?').get(row.allocation_id);
    if (!allocation || allocation.run_id !== row.run_id || allocation.lock_id !== row.lock_id
      || allocation.lease_id !== row.lease_id || allocation.fence_id !== row.fence_id
      || allocation.fence_sequence !== row.fence_sequence
      || digestValue(JSON.parse(allocation.authority_json)) !== row.authority_digest
      || !OPERATION_KINDS.includes(row.operation_kind) || !SAFETY_CLASSES.includes(row.safety_class)
      || !isSafeId(row.operation_id) || !isDigest(row.logical_operation_digest)
      || !isDigest(row.authority_digest) || !isDigest(row.source_digest) || !isDigest(row.cas_digest)
      || !isDigest(row.adapter_identity_digest) || !isTimestamp(row.created_at)
      || row.expected_post_state_digest !== null && !isDigest(row.expected_post_state_digest)
      || row.retry_of_operation_id !== null && !isSafeId(row.retry_of_operation_id)
      || row.provider_operation_key !== `gpr:${row.operation_id}`
      || row.logical_operation_digest !== digestValue({
        operation_kind: row.operation_kind,
        safety_class: row.safety_class,
        target_identity: targetIdentity,
        target_digest: row.target_digest,
        expected_post_state_digest: row.expected_post_state_digest,
        adapter_identity_digest: row.adapter_identity_digest
      })
      || canonicalSerialize(targetIdentity) !== row.target_identity_json
      || digestValue(targetIdentity) !== row.target_digest
      || row.operation_digest !== digestValue(operationRowPayload(row))) fail('GPR_OPERATION_TAMPERED');
  }
  const eventsByOperation = new Map();
  for (const row of events) {
    const operation = operationRowsById.get(row.operation_id);
    if (!operationIds.has(row.operation_id) || !isSafeId(row.event_id)
      || !isTimestamp(row.event_at) || !isDigest(row.authority_digest)
      || !isDigest(row.provider_evidence_digest) || !isDigest(row.detail_digest)
      || row.readback_digest !== null && !isDigest(row.readback_digest)
      || row.event_digest !== digestValue(operationEventPayload(row))) {
      fail('GPR_OPERATION_EVENT_TAMPERED');
    }
    const prior = eventsByOperation.get(row.operation_id) || [];
    const expectedSequence = prior.length + 1;
    const expectedPrior = prior.length ? prior[prior.length - 1].event_id : null;
    if (row.sequence !== expectedSequence || row.prior_event_id !== expectedPrior
      || Date.parse(row.event_at) < Date.parse(prior.length ? prior[prior.length - 1].event_at : operation.created_at)) {
      fail('GPR_OPERATION_EVENT_TAMPERED');
    }
    if (expectedSequence === 1 && (row.event_type !== 'PREPARED' || row.state !== 'PREPARED')
      || expectedSequence === 2 && (row.event_type !== 'IN_FLIGHT' || row.state !== 'IN_FLIGHT')
      || expectedSequence > 2 && !validOperationTransition(prior[prior.length - 1].state, row.state)) {
      fail('GPR_OPERATION_EVENT_TAMPERED');
    }
    prior.push(row);
    eventsByOperation.set(row.operation_id, prior);
  }
  for (const operation of operations) {
    const operationEvents = eventsByOperation.get(operation.operation_id) || [];
    if (operationEvents.length < 2) fail('GPR_OPERATION_EVENT_TAMPERED');
  }
}

function operationRowPayload(row) {
  return {
    operation_id: row.operation_id,
    logical_operation_digest: row.logical_operation_digest,
    run_id: row.run_id,
    allocation_id: row.allocation_id,
    lock_id: row.lock_id,
    authority_digest: row.authority_digest,
    lease_id: row.lease_id,
    fence_id: row.fence_id,
    fence_sequence: row.fence_sequence,
    operation_kind: row.operation_kind,
    safety_class: row.safety_class,
    target_identity_json: row.target_identity_json,
    target_digest: row.target_digest,
    source_digest: row.source_digest,
    cas_digest: row.cas_digest,
    expected_post_state_digest: row.expected_post_state_digest,
    provider_operation_key: row.provider_operation_key,
    adapter_identity_digest: row.adapter_identity_digest,
    retry_of_operation_id: row.retry_of_operation_id,
    created_at: row.created_at
  };
}

function operationEventPayload(row) {
  return {
    event_id: row.event_id,
    operation_id: row.operation_id,
    sequence: row.sequence,
    prior_event_id: row.prior_event_id,
    event_type: row.event_type,
    state: row.state,
    event_at: row.event_at,
    authority_digest: row.authority_digest,
    provider_evidence_digest: row.provider_evidence_digest,
    readback_digest: row.readback_digest,
    detail_digest: row.detail_digest
  };
}

function validOperationTransition(prior, next) {
  if (prior === 'PREPARED') return next === 'IN_FLIGHT';
  if (prior === 'IN_FLIGHT') return ['APPLIED', 'NOT_APPLIED', 'UNKNOWN'].includes(next);
  if (prior === 'UNKNOWN') return ['APPLIED', 'NOT_APPLIED', 'UNKNOWN'].includes(next);
  return false;
}

function readChainDb(db, runId, allowEmpty = false) {
  const rows = db.prepare('SELECT * FROM receipts WHERE run_id = ? ORDER BY sequence').all(runId);
  if (rows.length === 0) {
    if (allowEmpty) return [];
    fail('GPR_RUN_NOT_STARTED');
  }
  const receipts = rows.map((row) => {
    let receipt;
    try { receipt = JSON.parse(row.canonical_json); } catch (_) { fail('GPR_RECEIPT_TAMPERED'); }
    if (row.canonical_json !== canonicalSerialize(receipt)
      || row.receipt_id !== receipt.receipt_id
      || row.receipt_digest !== digestValue(receiptPayload(receipt))
      || row.receipt_digest !== receipt.receipt_id
      || row.sequence !== receipt.sequence
      || row.receipt_type !== receipt.receipt_type
      || row.prior_receipt_id !== receipt.prior_receipt_id) fail('GPR_RECEIPT_TAMPERED');
    return receipt;
  });
  return validateReceiptChain(receipts);
}

function appendV3ReceiptWithChainDigest(db, value) {
  return transaction(db, () => {
    if (Number(oneValue(db, 'PRAGMA user_version', 'user_version')) !== V3_USER_VERSION) {
      fail('GPR_SCHEMA_MISMATCH');
    }
    const receipt = validateReceiptObject(value);
    const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
    const allocation = db.prepare('SELECT * FROM allocations WHERE allocation_id = ?').get(receipt.allocation_id);
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(receipt.run_id);
    if (!metadata || !allocation || !run
      || metadata.schema_id !== SCHEMA_ID
      || metadata.repository !== receipt.repository
      || metadata.parent_issue !== receipt.parent_issue
      || metadata.child_issue !== receipt.child_issue) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
    const namespace = namespaceValue(metadata);
    if (metadata.namespace_digest !== namespaceDigest(namespace)
      || metadata.schema_fingerprint !== expectedFinalV3SchemaFingerprint()) {
      fail('GPR_SCHEMA_MISMATCH');
    }
    const bindings = canonicalAllocationBindings(allocation, 'GPR_V3_RECOVERY_COHERENCE');
    verifyReceiptCanonicalBinding(receipt, allocation, run, namespace, bindings, 'GPR_V3_RECOVERY_COHERENCE');
    const chain = readChainDb(db, receipt.run_id, true);
    const prior = chain[chain.length - 1] || null;
    if (receipt.sequence !== chain.length + 1
      || receipt.prior_receipt_id !== (prior ? prior.receipt_id : null)) {
      fail('GPR_CHAIN_CONFLICT');
    }
    const nextChain = validateReceiptChain([...chain, receipt]);
    const chainDigest = digestValue(nextChain);
    db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      receipt.receipt_id, receipt.run_id, receipt.sequence, receipt.receipt_type,
      receipt.prior_receipt_id, canonicalSerialize(receipt), receipt.receipt_id
    );
    db.prepare(`INSERT INTO receipt_chain_digests
      (receipt_id, run_id, sequence, chain_digest) VALUES (?, ?, ?, ?)`).run(
      receipt.receipt_id, receipt.run_id, receipt.sequence, chainDigest
    );
    return deepFreeze({ receipt, chain_digest: chainDigest });
  });
}

function verifyReceiptChainDigests(db, receiptsByRun, allowLegacyMissing = false) {
  const rows = db.prepare(`SELECT receipt_id, run_id, sequence, chain_digest
    FROM receipt_chain_digests ORDER BY run_id, sequence`).all();
  const keys = new Set();
  const expected = new Set();
  if (!allowLegacyMissing) {
    for (const [runId, chain] of receiptsByRun) {
      for (const receipt of chain) expected.add(`${runId}:${receipt.sequence}`);
    }
    if (rows.length !== expected.size) fail('GPR_V3_RECOVERY_COHERENCE');
  }
  for (const row of rows) {
    const chain = receiptsByRun.get(row.run_id);
    const receipt = chain && chain[row.sequence - 1];
    const key = `${row.run_id}:${row.sequence}`;
    if (keys.has(key)
      || !chain
      || !Number.isSafeInteger(row.sequence)
      || row.sequence < 1
      || row.sequence > LIMITS.receiptsPerRun
      || !isDigest(row.receipt_id)
      || !isDigest(row.chain_digest)
      || !receipt
      || row.receipt_id !== receipt.receipt_id
      || row.chain_digest !== digestValue(chain.slice(0, row.sequence))) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
    keys.add(key);
  }
  if (!allowLegacyMissing && keys.size !== expected.size) fail('GPR_V3_RECOVERY_COHERENCE');
  return true;
}

function storedHolder(row) {
  return {
    schema: HOLDER_ATTESTATION_SCHEMA_ID,
    attestation_id: row.attestation_id,
    algorithm: row.algorithm,
    key_id: row.key_id,
    platform: row.platform,
    repository: row.repository,
    parent_issue: row.parent_issue,
    child_issue: row.child_issue,
    lock: row.lock_id,
    allocation_id: row.allocation_id,
    allocation_digest: row.allocation_digest,
    run_id: row.run_id,
    run_digest: row.run_digest,
    lease_id: row.lease_id,
    fence_id: row.fence_id,
    fence_sequence: row.fence_sequence,
    authority_digest: row.authority_digest,
    start_digest: row.start_digest,
    broker_identity_digest: row.broker_identity_digest,
    process_id_digest: row.process_id_digest,
    process_start_digest: row.process_start_digest,
    boot_id_digest: row.boot_id_digest,
    pid_namespace_digest: row.pid_namespace_digest,
    process_incarnation_digest: row.process_incarnation_digest,
    lease_issued_at: row.lease_issued_at,
    lease_expires_at: row.lease_expires_at,
    attestation_digest: row.attestation_digest,
    attestation_tag: row.attestation_tag
  };
}

function storedRecoveryRecord(row, evidence) {
  return {
    schema: RECOVERY_RECORD_SCHEMA_ID,
    recovery_record_id: row.recovery_record_id,
    request_id: row.request_id,
    namespace_digest: row.namespace_digest,
    old_allocation_id: row.old_allocation_id,
    old_run_id: row.old_run_id,
    old_lease_id: row.old_lease_id,
    old_fence_id: row.old_fence_id,
    old_fence_sequence: row.old_fence_sequence,
    pre_recovery_evidence: evidence,
    pre_recovery_evidence_digest: row.pre_recovery_evidence_digest,
    terminal_receipt_id: row.terminal_receipt_id,
    terminal_receipt_digest: row.terminal_receipt_digest,
    release_event_id: row.release_event_id,
    release_event_digest: row.release_event_digest,
    replacement_allocation_id: row.replacement_allocation_id,
    replacement_allocation_digest: row.replacement_allocation_digest,
    replacement_run_id: row.replacement_run_id,
    replacement_run_digest: row.replacement_run_digest,
    replacement_lease_id: row.replacement_lease_id,
    replacement_fence_id: row.replacement_fence_id,
    replacement_fence_sequence: row.replacement_fence_sequence,
    replacement_holder_attestation_id: row.replacement_holder_attestation_id,
    replacement_holder_attestation_digest: row.replacement_holder_attestation_digest,
    new_high_water: row.new_high_water,
    authority_digest: row.authority_digest,
    source_digest: row.source_digest,
    start_digest: row.start_digest,
    committed_at: row.committed_at,
    recovery_record_digest: row.recovery_record_digest
  };
}

function parseStoredJson(value, code) {
  try { return JSON.parse(value); } catch (_) { fail(code); }
}

function canonicalAllocationBindings(allocation, code) {
  const authority = parseStoredJson(allocation.authority_json, code);
  const start = parseStoredJson(allocation.start_json, code);
  try {
    validateAuthority(authority);
    validateStart(start);
  } catch (_) {
    fail(code);
  }
  return {
    authority,
    start,
    authority_digest: digestValue(authority),
    start_digest: digestValue(start)
  };
}

function verifyReceiptCanonicalBinding(receipt, allocation, run, namespace, bindings, code) {
  if (!allocation || !run
    || run.allocation_id !== allocation.allocation_id
    || run.lock_id !== allocation.lock_id) fail(code);
  const lease = {
    lease_id: allocation.lease_id,
    fence_id: allocation.fence_id,
    fence_sequence: allocation.fence_sequence,
    issued_at: allocation.issued_at,
    expires_at: allocation.expires_at
  };
  if (receipt.run_id !== run.run_id
    || receipt.allocation_id !== allocation.allocation_id
    || receipt.repository !== namespace.repository
    || receipt.parent_issue !== namespace.parent_issue
    || receipt.child_issue !== namespace.child_issue
    || receipt.lock !== allocation.lock_id
    || canonicalSerialize(receipt.authority) !== canonicalSerialize(bindings.authority)
    || canonicalSerialize(receipt.start) !== canonicalSerialize(bindings.start)
    || canonicalSerialize(receipt.lease) !== canonicalSerialize(lease)) {
    fail(code);
  }
}

function verifyV3DurableEvidence(db, namespace, expectedNamespaceDigest, options = {}) {
  const canonicalNamespace = namespaceValue(namespace);
  const canonicalNamespaceDigest = expectedNamespaceDigest || namespaceDigest(canonicalNamespace);
  if (canonicalNamespaceDigest !== namespaceDigest(canonicalNamespace)) {
    fail('GPR_V3_RECOVERY_COHERENCE');
  }
  verifyRowDigests(db);
  const allocations = new Map(db.prepare('SELECT * FROM allocations').all().map((row) => [row.allocation_id, row]));
  const runs = new Map(db.prepare('SELECT * FROM runs').all().map((row) => [row.run_id, row]));
  const leaseEvents = new Map(db.prepare('SELECT * FROM lease_events').all().map((row) => [row.event_id, row]));
  const holders = new Map(db.prepare('SELECT * FROM holder_attestations').all().map((row) => [row.attestation_id, row]));
  const holdersByDigest = new Map(db.prepare('SELECT * FROM holder_attestations').all().map((row) => [row.attestation_digest, row]));
  const recoveryRows = db.prepare('SELECT * FROM recovery_records ORDER BY recovery_record_id').all();
  const coordination = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get();
  if (!coordination) fail('GPR_V3_RECOVERY_COHERENCE');

  for (const event of leaseEvents.values()) {
    const allocation = allocations.get(event.allocation_id);
    if (!allocation
      || !isSafeId(event.event_id)
      || !['ALLOCATED', 'EXPIRED_TAKEOVER', 'RELEASED'].includes(event.event_type)
      || event.fence_sequence !== allocation.fence_sequence
      || !isTimestamp(event.event_at)
      || Date.parse(event.event_at) < Date.parse(allocation.issued_at)
      || !isDigest(event.detail_digest)) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
  }

  for (const run of runs.values()) {
    const allocation = allocations.get(run.allocation_id);
    if (!allocation
      || run.run_id !== allocation.run_id
      || run.lock_id !== allocation.lock_id) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
    const bindings = canonicalAllocationBindings(allocation, 'GPR_V3_RECOVERY_COHERENCE');
    if (run.authority_digest !== bindings.authority_digest || run.start_digest !== bindings.start_digest) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
  }

  for (const row of holders.values()) {
    const allocation = allocations.get(row.allocation_id);
    const run = runs.get(row.run_id);
    if (!allocation || !run
      || row.repository !== canonicalNamespace.repository
      || row.parent_issue !== canonicalNamespace.parent_issue
      || row.child_issue !== canonicalNamespace.child_issue
      || run.allocation_id !== allocation.allocation_id
      || run.run_id !== allocation.run_id
      || run.lock_id !== allocation.lock_id
      || row.allocation_digest !== allocation.allocation_digest
      || row.run_id !== allocation.run_id
      || row.run_digest !== run.run_digest
      || row.lock_id !== allocation.lock_id
      || row.lease_id !== allocation.lease_id
      || row.fence_id !== allocation.fence_id
      || row.fence_sequence !== allocation.fence_sequence
      || row.authority_digest !== run.authority_digest
      || row.start_digest !== run.start_digest
      || row.lease_issued_at !== allocation.issued_at
      || row.lease_expires_at !== allocation.expires_at) {
      fail('GPR_V3_HOLDER_COHERENCE');
    }
    const bindings = canonicalAllocationBindings(allocation, 'GPR_V3_HOLDER_COHERENCE');
    if (bindings.authority_digest !== run.authority_digest || bindings.start_digest !== run.start_digest) {
      fail('GPR_V3_HOLDER_COHERENCE');
    }
    try { validateHolderAttestation(storedHolder(row)); } catch (_) { fail('GPR_V3_HOLDER_COHERENCE'); }
  }

  const receiptsByRun = new Map();
  for (const run of runs.values()) {
    const allocation = allocations.get(run.allocation_id);
    try {
      const bindings = allocation && canonicalAllocationBindings(allocation, 'GPR_V3_RECOVERY_COHERENCE');
      const chain = readChainDb(db, run.run_id, true);
      for (const receipt of chain) {
        verifyReceiptCanonicalBinding(receipt, allocation, run, canonicalNamespace, bindings, 'GPR_V3_RECOVERY_COHERENCE');
      }
      receiptsByRun.set(run.run_id, chain);
    }
    catch (_) { fail('GPR_V3_RECOVERY_COHERENCE'); }
  }
  const receipts = new Map();
  for (const chain of receiptsByRun.values()) for (const receipt of chain) receipts.set(receipt.receipt_id, receipt);
  verifyReceiptChainDigests(db, receiptsByRun, options.allowLegacyMissingReceiptChainDigests === true);
  const receiptRowsById = new Map(db.prepare('SELECT receipt_id, receipt_digest FROM receipts').all()
    .map((row) => [row.receipt_id, row]));

  for (const row of recoveryRows) {
    const evidence = parseStoredJson(row.pre_recovery_evidence_json, 'GPR_V3_RECOVERY_COHERENCE');
    let record;
    try {
      record = storedRecoveryRecord(row, evidence);
      validateRecoveryRecord(record);
    } catch (_) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
    if (canonicalSerialize(evidence) !== row.pre_recovery_evidence_json
      || row.namespace_digest !== canonicalNamespaceDigest
      || row.request_id !== evidence.request_id
      || row.authority_digest !== evidence.authority_digest
      || row.source_digest !== evidence.source_digest
      || row.start_digest !== evidence.start_digest) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }

    const oldAllocation = allocations.get(row.old_allocation_id);
    const oldRun = runs.get(row.old_run_id);
    const replacementAllocation = allocations.get(row.replacement_allocation_id);
    const replacementRun = runs.get(row.replacement_run_id);
    if (!oldAllocation || !oldRun || !replacementAllocation || !replacementRun
      || oldRun.allocation_id !== oldAllocation.allocation_id
      || oldRun.run_id !== oldAllocation.run_id
      || oldRun.lock_id !== oldAllocation.lock_id
      || row.old_run_id !== oldAllocation.run_id
      || row.old_lease_id !== oldAllocation.lease_id
      || row.old_fence_id !== oldAllocation.fence_id
      || row.old_fence_sequence !== oldAllocation.fence_sequence
      || replacementRun.allocation_id !== replacementAllocation.allocation_id
      || replacementRun.run_id !== replacementAllocation.run_id
      || replacementRun.lock_id !== replacementAllocation.lock_id
      || replacementAllocation.lock_id !== oldAllocation.lock_id
      || row.replacement_run_id !== replacementAllocation.run_id
      || row.replacement_allocation_digest !== replacementAllocation.allocation_digest
      || row.replacement_run_digest !== replacementRun.run_digest
      || row.replacement_lease_id !== replacementAllocation.lease_id
      || row.replacement_fence_id !== replacementAllocation.fence_id
      || row.replacement_fence_sequence !== replacementAllocation.fence_sequence
      || replacementAllocation.fence_sequence !== oldAllocation.fence_sequence + 1
      || row.new_high_water !== row.replacement_fence_sequence
      || row.new_high_water > coordination.high_water) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }

    const oldBindings = canonicalAllocationBindings(oldAllocation, 'GPR_V3_RECOVERY_COHERENCE');
    const replacementBindings = canonicalAllocationBindings(replacementAllocation, 'GPR_V3_RECOVERY_COHERENCE');
    if (oldRun.authority_digest !== oldBindings.authority_digest
      || oldRun.start_digest !== oldBindings.start_digest
      || replacementRun.authority_digest !== replacementBindings.authority_digest
      || replacementRun.start_digest !== replacementBindings.start_digest
      || evidence.repository !== canonicalNamespace.repository
      || evidence.parent_issue !== canonicalNamespace.parent_issue
      || evidence.child_issue !== canonicalNamespace.child_issue
      || evidence.namespace_digest !== canonicalNamespaceDigest
      || evidence.lock !== oldAllocation.lock_id
      || evidence.old_allocation_id !== oldAllocation.allocation_id
      || evidence.old_allocation_digest !== oldAllocation.allocation_digest
      || evidence.old_run_id !== oldRun.run_id
      || evidence.old_run_digest !== oldRun.run_digest
      || evidence.old_lease_id !== oldAllocation.lease_id
      || evidence.old_fence_id !== oldAllocation.fence_id
      || evidence.old_fence_sequence !== oldAllocation.fence_sequence
      || evidence.old_lease_issued_at !== oldAllocation.issued_at
      || evidence.old_lease_expires_at !== oldAllocation.expires_at
      || Date.parse(evidence.observed_at) < Date.parse(oldAllocation.expires_at)
      || evidence.authority_digest !== oldRun.authority_digest
      || evidence.start_digest !== oldRun.start_digest) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }

    const zeroOperationCount = db.prepare(
      'SELECT COUNT(*) AS value FROM mutation_operations WHERE run_id = ?'
    ).get(oldRun.run_id).value;
    const zeroOperationEventCount = db.prepare(`
      SELECT COUNT(*) AS value
      FROM mutation_operation_events e
      JOIN mutation_operations o ON o.operation_id = e.operation_id
      WHERE o.run_id = ?
    `).get(oldRun.run_id).value;
    if (evidence.zero_operation_count !== zeroOperationCount
      || evidence.zero_operation_event_count !== zeroOperationEventCount
      || zeroOperationCount !== 0
      || zeroOperationEventCount !== 0
      || evidence.zero_operation_inventory_digest !== ZERO_OPERATION_INVENTORY_DIGEST) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }

    const oldLeaseTip = leaseEvents.get(evidence.old_lease_tip_event_id);
    const releaseEvent = leaseEvents.get(row.release_event_id);
    const replacementTakeover = [...leaseEvents.values()].some((event) =>
      event.allocation_id === replacementAllocation.allocation_id
      && event.event_type === 'EXPIRED_TAKEOVER'
      && event.fence_sequence === replacementAllocation.fence_sequence);
    const oldHolder = holdersByDigest.get(evidence.old_holder_attestation_digest);
    const replacementHolder = holders.get(row.replacement_holder_attestation_id);
    const oldChain = receiptsByRun.get(oldRun.run_id) || [];
    const oldReceiptTip = oldChain[evidence.old_receipt_tip_sequence - 1];
    const terminalReceipt = receipts.get(row.terminal_receipt_id);
    const oldReceiptTipRow = receiptRowsById.get(oldReceiptTip && oldReceiptTip.receipt_id);
    const terminalReceiptRow = receiptRowsById.get(terminalReceipt && terminalReceipt.receipt_id);
    if (!oldLeaseTip || !releaseEvent || !oldHolder || !replacementHolder || !oldReceiptTip
      || !terminalReceipt || !oldReceiptTipRow || !terminalReceiptRow
      || oldLeaseTip.allocation_id !== oldAllocation.allocation_id
      || oldLeaseTip.fence_sequence !== oldAllocation.fence_sequence
      || oldLeaseTip.event_digest !== evidence.old_lease_tip_event_digest
      || !isTimestamp(oldLeaseTip.event_at)
      || Date.parse(oldLeaseTip.event_at) < Date.parse(oldAllocation.issued_at)
      || Date.parse(oldLeaseTip.event_at) > Date.parse(evidence.observed_at)
      || [...leaseEvents.values()].some((later) => later.allocation_id === oldAllocation.allocation_id
        && (later.event_at > oldLeaseTip.event_at
          || later.event_at === oldLeaseTip.event_at && later.event_id > oldLeaseTip.event_id)
        && Date.parse(later.event_at) <= Date.parse(evidence.observed_at))
      || evidence.old_receipt_tip_id !== oldReceiptTip.receipt_id
      || evidence.old_receipt_tip_digest !== oldReceiptTipRow.receipt_digest
      || evidence.old_receipt_chain_digest !== digestValue(oldChain.slice(0, evidence.old_receipt_tip_sequence))
      || Date.parse(oldReceiptTip.created_at) > Date.parse(evidence.observed_at)
      || oldChain.some((receipt) => receipt.sequence > oldReceiptTip.sequence
        && Date.parse(receipt.created_at) <= Date.parse(evidence.observed_at))
      || oldHolder.allocation_id !== oldAllocation.allocation_id
      || oldHolder.run_id !== oldRun.run_id
      || oldHolder.lease_id !== oldAllocation.lease_id
      || oldHolder.fence_id !== oldAllocation.fence_id
      || oldHolder.fence_sequence !== oldAllocation.fence_sequence
      || oldHolder.repository !== canonicalNamespace.repository
      || oldHolder.parent_issue !== canonicalNamespace.parent_issue
      || oldHolder.child_issue !== canonicalNamespace.child_issue
      || oldHolder.lock_id !== oldAllocation.lock_id
      || oldHolder.authority_digest !== oldRun.authority_digest
      || oldHolder.start_digest !== oldRun.start_digest
      || oldHolder.lease_issued_at !== oldAllocation.issued_at
      || oldHolder.lease_expires_at !== oldAllocation.expires_at
      || oldHolder.process_incarnation_digest !== evidence.old_holder_identity_digest
      || oldHolder.broker_identity_digest !== evidence.broker_identity_digest
      || oldHolder.key_id !== evidence.broker_key_id
      || terminalReceipt.run_id !== oldRun.run_id
      || terminalReceipt.allocation_id !== oldAllocation.allocation_id
      || terminalReceipt.receipt_type !== 'RUN_INTERRUPTED'
      || terminalReceipt.prior_receipt_id !== oldReceiptTip.receipt_id
      || terminalReceipt.sequence !== oldReceiptTip.sequence + 1
      || terminalReceiptRow.receipt_digest !== row.terminal_receipt_digest
      || Date.parse(terminalReceipt.created_at) < Date.parse(evidence.observed_at)
      || !isTimestamp(releaseEvent && releaseEvent.event_at)
      || releaseEvent.allocation_id !== oldAllocation.allocation_id
      || releaseEvent.event_type !== 'RELEASED'
      || releaseEvent.fence_sequence !== oldAllocation.fence_sequence
      || releaseEvent.event_digest !== row.release_event_digest
      || !isTimestamp(releaseEvent.event_at)
      || Date.parse(releaseEvent.event_at) < Date.parse(terminalReceipt.created_at)
      || !replacementTakeover
      || replacementHolder.allocation_id !== replacementAllocation.allocation_id
      || replacementHolder.run_id !== replacementRun.run_id
      || replacementHolder.repository !== canonicalNamespace.repository
      || replacementHolder.parent_issue !== canonicalNamespace.parent_issue
      || replacementHolder.child_issue !== canonicalNamespace.child_issue
      || replacementHolder.lock_id !== replacementAllocation.lock_id
      || replacementHolder.allocation_digest !== replacementAllocation.allocation_digest
      || replacementHolder.run_digest !== replacementRun.run_digest
      || replacementHolder.lease_id !== replacementAllocation.lease_id
      || replacementHolder.fence_id !== replacementAllocation.fence_id
      || replacementHolder.fence_sequence !== replacementAllocation.fence_sequence
      || replacementHolder.authority_digest !== replacementRun.authority_digest
      || replacementHolder.start_digest !== replacementRun.start_digest
      || replacementHolder.lease_issued_at !== replacementAllocation.issued_at
      || replacementHolder.lease_expires_at !== replacementAllocation.expires_at
      || replacementHolder.attestation_digest !== row.replacement_holder_attestation_digest) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
    try { validateReservedOrphanPayload(terminalReceipt.payload); } catch (_) { fail('GPR_V3_RECOVERY_COHERENCE'); }
    if (terminalReceipt.payload.evidence_digest !== row.pre_recovery_evidence_digest
      || Date.parse(row.committed_at) < Date.parse(releaseEvent.event_at)) {
      fail('GPR_V3_RECOVERY_COHERENCE');
    }
  }
  return true;
}

function verifyFinalV3Database(db, namespace, databasePath = null, options = {}) {
  const expectedNamespace = namespaceValue(namespace);
  const expectedNamespaceDigest = namespaceDigest(expectedNamespace);
  if (databasePath && fs.statSync(databasePath).size > LIMITS.databaseBytes) fail('GPR_DATABASE_LIMIT');
  if (Number(oneValue(db, 'PRAGMA application_id', 'application_id')) !== APPLICATION_ID
    || Number(oneValue(db, 'PRAGMA user_version', 'user_version')) !== V3_USER_VERSION) fail('GPR_SCHEMA_MISMATCH');
  const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
  const expectedFingerprint = expectedFinalV3SchemaFingerprint();
  if (!metadata
    || metadata.schema_id !== SCHEMA_ID
    || metadata.namespace_digest !== expectedNamespaceDigest
    || metadata.repository !== expectedNamespace.repository
    || metadata.parent_issue !== expectedNamespace.parent_issue
    || metadata.child_issue !== expectedNamespace.child_issue
    || metadata.schema_fingerprint !== expectedFingerprint
    || schemaFingerprint(db) !== expectedFingerprint) fail('GPR_SCHEMA_MISMATCH');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') fail('GPR_INTEGRITY_CHECK_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) fail('GPR_FOREIGN_KEY_CHECK_FAILED');
  const state = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get();
  const max = db.prepare('SELECT COALESCE(MAX(fence_sequence), 0) AS value FROM allocations').get().value;
  if (!state || state.high_water !== max) fail('GPR_ALLOCATOR_TAMPERED');
  verifyV3DurableEvidence(db, expectedNamespace, expectedNamespaceDigest, options);
  return true;
}

function verifyDatabase(db, namespace, digest, databasePath, expectedFingerprint) {
  if (fs.statSync(databasePath).size > LIMITS.databaseBytes) fail('GPR_DATABASE_LIMIT');
  if (Number(oneValue(db, 'PRAGMA application_id', 'application_id')) !== APPLICATION_ID
    || Number(oneValue(db, 'PRAGMA user_version', 'user_version')) !== USER_VERSION) fail('GPR_SCHEMA_MISMATCH');
  const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
  if (!metadata
    || metadata.schema_id !== SCHEMA_ID
    || metadata.namespace_digest !== digest
    || metadata.repository !== namespace.repository
    || metadata.parent_issue !== namespace.parent_issue
    || metadata.child_issue !== namespace.child_issue
    || metadata.schema_fingerprint !== expectedFingerprint
    || schemaFingerprint(db) !== expectedFingerprint) fail('GPR_SCHEMA_MISMATCH');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') fail('GPR_INTEGRITY_CHECK_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) fail('GPR_FOREIGN_KEY_CHECK_FAILED');
  const state = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get();
  const max = db.prepare('SELECT COALESCE(MAX(fence_sequence), 0) AS value FROM allocations').get().value;
  if (!state || state.high_water !== max) fail('GPR_ALLOCATOR_TAMPERED');
  verifyRowDigests(db);
  const runIds = db.prepare('SELECT run_id FROM runs ORDER BY run_id').all();
  for (const row of runIds) readChainDb(db, row.run_id, true);
}

function openVerified(config, create = true, readOnly = false) {
  assertRuntimeSupport();
  const databasePath = config.databasePath;
  const existed = fs.existsSync(databasePath);
  if (existed) {
    const stat = fs.lstatSync(databasePath);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(databasePath) !== databasePath) fail('GPR_UNSAFE_STATE_FILE');
    if (stat.size > LIMITS.databaseBytes) fail('GPR_DATABASE_LIMIT');
  } else if (!create) {
    fail('GPR_STORE_NOT_FOUND');
  }
  const { DatabaseSync } = assertRuntimeSupport();
  const expectedFingerprint = expectedSchemaFingerprint(DatabaseSync);
  const db = readOnly ? new DatabaseSync(databasePath, { readOnly: true }) : new DatabaseSync(databasePath);
  try {
    configureDatabase(db, readOnly);
    if (!existed) {
      createDatabase(db, config.namespace, config.namespaceDigest, isoAt(), expectedFingerprint);
      if (process.platform !== 'win32') fs.chmodSync(databasePath, 0o600);
    }
    verifyDatabase(db, config.namespace, config.namespaceDigest, databasePath, expectedFingerprint);
    return db;
  } catch (error) {
    try { db.close(); } catch (_) { /* Preserve the original failure. */ }
    if (error instanceof GprError) throw error;
    fail('GPR_STORE_INVALID', { cause: error && error.code ? error.code : 'sqlite-error' });
  }
}

function createStoreConfig(options) {
  const namespace = namespaceValue(options || {});
  const stateRoot = assertSafeStateRoot(options || {});
  return Object.freeze({
    namespace,
    namespaceDigest: namespaceDigest(namespace),
    stateRoot,
    repositoryRoot: path.resolve(options.repositoryRoot),
    databasePath: path.join(stateRoot, `github-program-receipt-${namespaceDigest(namespace)}.sqlite`)
  });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function canonicalRegularFile(inputPath, executable = false) {
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath)) fail('GPR_VERIFIER_IDENTITY_INVALID');
  const realpath = fs.realpathSync.native(inputPath);
  const stat = fs.statSync(realpath);
  if (!stat.isFile() || executable && process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
    fail('GPR_VERIFIER_IDENTITY_INVALID');
  }
  return realpath;
}

function runtimeIdentity(nodeExecutable = process.execPath, runtimePath = __filename) {
  const nodeRealpath = canonicalRegularFile(nodeExecutable, true);
  const runtimeRealpath = canonicalRegularFile(runtimePath);
  const serializationRealpath = canonicalRegularFile(path.resolve(__dirname, 'toolkit-execution-loop.cjs'));
  const identity = {
    node_executable_realpath_digest: digestValue(nodeRealpath),
    node_executable_digest: sha256File(nodeRealpath),
    runtime_realpath_digest: digestValue(runtimeRealpath),
    runtime_digest: sha256File(runtimeRealpath),
    serialization_realpath_digest: digestValue(serializationRealpath),
    serialization_digest: sha256File(serializationRealpath),
    node_version: process.versions.node
  };
  return deepFreeze({
    ...identity,
    runtime_identity_digest: digestValue(identity),
    nodeRealpath,
    runtimeRealpath
  });
}

function storeStateFactsDb(db) {
  const counts = {};
  for (const table of ['allocations', 'runs', 'receipts', 'lease_events', 'mutation_operations', 'mutation_operation_events']) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value;
  }
  const latestAllocation = db.prepare('SELECT allocation_id, run_id, fence_sequence, allocation_digest FROM allocations ORDER BY fence_sequence DESC LIMIT 1').get() || null;
  const receiptHeads = db.prepare(`
    SELECT r.run_id, r.receipt_id, r.sequence, r.receipt_digest
    FROM receipts r
    WHERE r.sequence = (SELECT MAX(inner_receipt.sequence) FROM receipts inner_receipt WHERE inner_receipt.run_id = r.run_id)
    ORDER BY r.run_id
  `).all();
  const operationHeads = db.prepare(`
    SELECT o.operation_id, o.operation_digest, e.state, e.event_digest, e.sequence
    FROM mutation_operations o
    JOIN mutation_operation_events e ON e.operation_id = o.operation_id
    WHERE e.sequence = (SELECT MAX(inner_event.sequence) FROM mutation_operation_events inner_event WHERE inner_event.operation_id = o.operation_id)
    ORDER BY o.operation_id
  `).all();
  const leaseHead = db.prepare('SELECT event_id, event_digest, fence_sequence FROM lease_events ORDER BY fence_sequence DESC, event_at DESC, event_id DESC LIMIT 1').get() || null;
  return {
    high_water: db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water,
    counts,
    latest_allocation: latestAllocation,
    receipt_heads: receiptHeads,
    lease_head: leaseHead,
    operation_heads: operationHeads
  };
}

function verificationPacketDb(db, config, allocation, receipt) {
  const chain = readChainDb(db, allocation.run_id);
  const identity = runtimeIdentity();
  const metadata = db.prepare('SELECT schema_id, namespace_digest, repository, parent_issue, child_issue, schema_fingerprint, created_at FROM metadata WHERE singleton = 1').get();
  const packet = {
    schema: 'toolkit.github-program.run-started-verification.v1',
    run_id: allocation.run_id,
    allocation_id: allocation.allocation_id,
    receipt_id: receipt.receipt_id,
    receipt_sequence: receipt.sequence,
    namespace_digest: config.namespaceDigest,
    authority_digest: digestValue(JSON.parse(allocation.authority_json)),
    start_digest: digestValue(JSON.parse(allocation.start_json)),
    lease_id: allocation.lease_id,
    fence_id: allocation.fence_id,
    fence_sequence: allocation.fence_sequence,
    chain_digest: digestValue(chain),
    store_state_digest: digestValue(storeStateFactsDb(db)),
    store_identity_digest: digestValue({
      database_realpath_digest: digestValue(fs.realpathSync.native(config.databasePath)),
      metadata
    }),
    node_executable_realpath_digest: identity.node_executable_realpath_digest,
    runtime_identity_digest: identity.runtime_identity_digest,
    node_version: identity.node_version,
    packet_digest: ''
  };
  const digestInput = clone(packet);
  delete digestInput.packet_digest;
  packet.packet_digest = digestValue(digestInput);
  return deepFreeze(packet);
}

function validateVerificationPacket(value) {
  if (!exactKeys(value, VERIFICATION_PACKET_KEYS)
    || value.schema !== 'toolkit.github-program.run-started-verification.v1'
    || !isSafeId(value.run_id) || !isSafeId(value.allocation_id)
    || !Number.isSafeInteger(value.receipt_sequence) || value.receipt_sequence !== 1
    || !isSafeId(value.lease_id) || !isSafeId(value.fence_id)
    || !Number.isSafeInteger(value.fence_sequence) || value.fence_sequence < 1
    || typeof value.node_version !== 'string') fail('GPR_VERIFICATION_PACKET_INVALID');
  for (const key of ['receipt_id', 'namespace_digest', 'authority_digest', 'start_digest', 'chain_digest',
    'store_state_digest', 'store_identity_digest', 'node_executable_realpath_digest',
    'runtime_identity_digest', 'packet_digest']) if (!isDigest(value[key])) fail('GPR_VERIFICATION_PACKET_INVALID');
  const digestInput = clone(value);
  delete digestInput.packet_digest;
  if (value.packet_digest !== digestValue(digestInput)) fail('GPR_VERIFICATION_PACKET_INVALID');
  return deepFreeze(clone(value));
}

function readVerificationPacket(config, expected) {
  const db = openVerified(config, false, true);
  try {
    const allocation = db.prepare('SELECT * FROM allocations WHERE allocation_id = ? AND run_id = ?').get(expected.allocation_id, expected.run_id);
    if (!allocation) fail('GPR_VERIFICATION_PACKET_INVALID');
    const chain = readChainDb(db, allocation.run_id);
    if (chain.length !== 1 || chain[0].receipt_id !== expected.receipt_id) fail('GPR_VERIFICATION_PACKET_INVALID');
    return verificationPacketDb(db, config, allocation, chain[0]);
  } finally {
    db.close();
  }
}

function validateVerifierProcessResult(result, expected) {
  if (!result || result.error || result.signal || result.status !== 0
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || Buffer.byteLength(result.stdout, 'utf8') > VERIFIER_STREAM_BYTES
    || Buffer.byteLength(result.stderr, 'utf8') > VERIFIER_STREAM_BYTES
    || result.stderr !== '' || !result.stdout.endsWith('\n')
    || result.stdout.slice(0, -1).includes('\n')) fail('GPR_FRESH_PROCESS_VERIFICATION_FAILED');
  let parsed;
  try { parsed = JSON.parse(result.stdout.slice(0, -1)); } catch (_) { fail('GPR_FRESH_PROCESS_VERIFICATION_FAILED'); }
  let packet;
  try { packet = validateVerificationPacket(parsed); } catch (_) { fail('GPR_FRESH_PROCESS_VERIFICATION_FAILED'); }
  if (`${canonicalSerialize(packet)}\n` !== result.stdout
    || canonicalSerialize(packet) !== canonicalSerialize(expected)) fail('GPR_FRESH_PROCESS_VERIFICATION_FAILED');
  return packet;
}

function verifyStartedRunFreshProcess(config, expected) {
  const identity = runtimeIdentity();
  if (identity.nodeRealpath !== fs.realpathSync.native(process.execPath)
    || identity.runtimeRealpath !== fs.realpathSync.native(__filename)) fail('GPR_VERIFIER_IDENTITY_INVALID');
  const env = { ...process.env };
  const nodeInjectionKeys = new Set(['NODE_OPTIONS', 'NODE_PATH', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_REPL_EXTERNAL_MODULE', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE']);
  for (const key of Object.keys(env)) if (nodeInjectionKeys.has(key.toUpperCase())) delete env[key];
  const result = spawnSync(identity.nodeRealpath, [
    '--no-warnings', identity.runtimeRealpath, 'verify-run-started',
    '--repository', config.namespace.repository,
    '--parent-issue', String(config.namespace.parent_issue),
    '--child-issue', String(config.namespace.child_issue),
    '--state-root', config.stateRoot,
    '--repository-root', config.repositoryRoot,
    '--run-id', expected.run_id,
    '--allocation-id', expected.allocation_id,
    '--receipt-id', expected.receipt_id
  ], {
    cwd: config.repositoryRoot,
    encoding: 'utf8',
    env,
    shell: false,
    windowsHide: true,
    timeout: VERIFIER_TIMEOUT_MS,
    maxBuffer: VERIFIER_STREAM_BYTES
  });
  return validateVerifierProcessResult(result, expected);
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

function activeAllocationDb(db, now) {
  return db.prepare(`
    SELECT a.* FROM allocations a
    WHERE a.expires_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM lease_events e
        WHERE e.allocation_id = a.allocation_id AND e.event_type = 'RELEASED'
      )
    ORDER BY a.fence_sequence DESC LIMIT 1
  `).get(now);
}

function latestAllocationDb(db) {
  return db.prepare('SELECT * FROM allocations ORDER BY fence_sequence DESC LIMIT 1').get();
}

function insertLeaseEvent(db, allocation, eventType, eventAt, detail) {
  const event = {
    event_id: randomId('event'),
    allocation_id: allocation.allocation_id,
    event_type: eventType,
    fence_sequence: allocation.fence_sequence,
    event_at: eventAt,
    detail_digest: digestValue(detail)
  };
  event.event_digest = digestValue(event);
  db.prepare('INSERT INTO lease_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    event.event_id, event.allocation_id, event.event_type, event.fence_sequence,
    event.event_at, event.detail_digest, event.event_digest
  );
  return event;
}

function latestOperationEventDb(db, operationId) {
  return db.prepare('SELECT * FROM mutation_operation_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1').get(operationId);
}

function unresolvedOperationDb(db) {
  return db.prepare(`
    SELECT o.*, e.state, e.event_id AS latest_event_id, e.event_digest AS latest_event_digest
    FROM mutation_operations o
    JOIN mutation_operation_events e ON e.operation_id = o.operation_id
    WHERE e.sequence = (
      SELECT MAX(inner_event.sequence) FROM mutation_operation_events inner_event
      WHERE inner_event.operation_id = o.operation_id
    ) AND e.state IN ('IN_FLIGHT', 'UNKNOWN')
    ORDER BY o.created_at, o.operation_id LIMIT 1
  `).get();
}

function assertNoUnresolvedOperationDb(db) {
  const unresolved = unresolvedOperationDb(db);
  if (unresolved) fail('GPR_UNRESOLVED_OPERATION', { operation_id: unresolved.operation_id, state: unresolved.state });
}

function insertOperationEvent(db, operation, eventType, state, eventAt, authorityDigest, evidence = {}) {
  const prior = latestOperationEventDb(db, operation.operation_id);
  const sequence = prior ? prior.sequence + 1 : 1;
  if (sequence === 1 && (eventType !== 'PREPARED' || state !== 'PREPARED')
    || sequence === 2 && (eventType !== 'IN_FLIGHT' || state !== 'IN_FLIGHT')
    || sequence > 2 && !validOperationTransition(prior.state, state)) fail('GPR_OPERATION_TRANSITION_INVALID');
  const event = {
    event_id: randomId('operation-event'),
    operation_id: operation.operation_id,
    sequence,
    prior_event_id: prior ? prior.event_id : null,
    event_type: eventType,
    state,
    event_at: eventAt,
    authority_digest: authorityDigest,
    provider_evidence_digest: evidence.provider_evidence_digest || digestValue({ event_type: eventType, state }),
    readback_digest: evidence.readback_digest || null,
    detail_digest: evidence.detail_digest || digestValue({ event_type: eventType, state })
  };
  event.event_digest = digestValue(operationEventPayload(event));
  db.prepare('INSERT INTO mutation_operation_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    event.event_id, event.operation_id, event.sequence, event.prior_event_id,
    event.event_type, event.state, event.event_at, event.authority_digest,
    event.provider_evidence_digest, event.readback_digest, event.detail_digest, event.event_digest
  );
  return event;
}

function operationPublic(row) {
  return deepFreeze({
    operation_id: row.operation_id,
    logical_operation_digest: row.logical_operation_digest,
    run_id: row.run_id,
    allocation_id: row.allocation_id,
    lock: row.lock_id,
    authority_digest: row.authority_digest,
    lease_id: row.lease_id,
    fence_id: row.fence_id,
    fence_sequence: row.fence_sequence,
    operation_kind: row.operation_kind,
    safety_class: row.safety_class,
    target_identity: JSON.parse(row.target_identity_json),
    target_digest: row.target_digest,
    expected_source_digest: row.source_digest,
    cas_digest: row.cas_digest,
    expected_post_state_digest: row.expected_post_state_digest,
    provider_operation_key: row.provider_operation_key,
    adapter_identity_digest: row.adapter_identity_digest,
    retry_of_operation_id: row.retry_of_operation_id,
    created_at: row.created_at,
    operation_digest: row.operation_digest
  });
}

function allocationPublic(row) {
  return deepFreeze({
    allocation_id: row.allocation_id,
    run_id: row.run_id,
    lock: row.lock_id,
    lease: {
      lease_id: row.lease_id,
      fence_id: row.fence_id,
      fence_sequence: row.fence_sequence,
      issued_at: row.issued_at,
      expires_at: row.expires_at
    }
  });
}

function sessionState(store, session) {
  const state = session && SESSION_OWNERS.get(session);
  if (!state || state.storeInstanceId !== store.instanceId || state.processId !== process.pid) fail('GPR_OWNERSHIP_LOST');
  return state;
}

function allocationFromStateDb(db, state) {
  const row = db.prepare('SELECT * FROM allocations WHERE allocation_id = ?').get(state.allocationId);
  if (!row || row.run_id !== state.runId || row.owner_instance_id !== state.ownerInstanceId || row.process_id !== process.pid) fail('GPR_OWNERSHIP_LOST');
  return row;
}

function verifyFenceDb(db, state, now, options = {}) {
  const allocation = allocationFromStateDb(db, state);
  const highWater = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water;
  if (highWater > allocation.fence_sequence) fail('GPR_NEWER_FENCE_EXISTS');
  if (highWater !== allocation.fence_sequence) fail('GPR_STALE_FENCE');
  const released = db.prepare("SELECT 1 AS value FROM lease_events WHERE allocation_id = ? AND event_type = 'RELEASED' LIMIT 1").get(allocation.allocation_id);
  if (released && !options.allowReleased) fail('GPR_STALE_FENCE');
  if (Date.parse(allocation.expires_at) <= Date.parse(now)) fail('GPR_EXPIRED_FENCE');
  return allocation;
}

function createReceipt(allocation, config, input) {
  const receipt = {
    schema: SCHEMA_ID,
    receipt_type: input.receipt_type,
    receipt_id: '',
    sequence: input.sequence,
    prior_receipt_id: input.prior_receipt_id,
    run_id: allocation.run_id,
    allocation_id: allocation.allocation_id,
    repository: config.namespace.repository,
    parent_issue: config.namespace.parent_issue,
    child_issue: config.namespace.child_issue,
    lock: allocation.lock_id,
    authority: JSON.parse(allocation.authority_json),
    start: JSON.parse(allocation.start_json),
    candidate: input.candidate,
    lease: {
      lease_id: allocation.lease_id,
      fence_id: allocation.fence_id,
      fence_sequence: allocation.fence_sequence,
      issued_at: allocation.issued_at,
      expires_at: allocation.expires_at
    },
    payload: clone(input.payload),
    created_at: input.created_at
  };
  receipt.receipt_id = digestValue(receiptPayload(receipt));
  return validateReceiptObject(receipt);
}

function appendReceiptInternal(store, session, input) {
  const state = sessionState(store, session);
  if (!isRecord(input) || !RECEIPT_TYPES.includes(input.receipt_type) || input.receipt_type === 'RUN_STARTED') fail('GPR_RECEIPT_INPUT_INVALID');
  if ('lease' in input || 'fence_id' in input || 'fence_sequence' in input || 'lease_id' in input) fail('GPR_CALLER_FENCE_FORBIDDEN');
  const createdAt = isoAt(input.created_at);
  const payload = validatePayload(input.payload);
  if (input.receipt_type === 'RUN_INTERRUPTED'
    && payload.classification === BROKER_RECOVERY_CLASSIFICATION) {
    fail('GPR_RESERVED_ORPHAN_PAYLOAD_FORBIDDEN');
  }
  const observedAt = isoAt();
  if (Date.parse(createdAt) > Date.parse(observedAt)) fail('GPR_RECEIPT_CHRONOLOGY_INVALID');
  const db = openVerified(store.config);
  try {
    const allocation = allocationFromStateDb(db, state);
    const chain = readChainDb(db, state.runId);
    const prior = chain[chain.length - 1];
    if (Date.parse(createdAt) < Date.parse(allocation.issued_at)
      || Date.parse(createdAt) < Date.parse(prior.created_at)) fail('GPR_RECEIPT_CHRONOLOGY_INVALID');
    const repeatedCandidate = input.candidate === undefined ? prior.candidate : input.candidate;
    if (prior.receipt_type === input.receipt_type
      && prior.created_at === createdAt
      && canonicalSerialize(prior.payload) === canonicalSerialize(payload)
      && canonicalSerialize(prior.candidate) === canonicalSerialize(repeatedCandidate)) {
      return deepFreeze({ receipt: prior, duplicate: true });
    }
    if (TERMINAL_TYPES.includes(prior.receipt_type)) fail('GPR_RUN_TERMINAL');
    const sequence = prior.sequence + 1;
    if (input.sequence !== undefined && input.sequence !== sequence) fail('GPR_SEQUENCE_CONFLICT');
    if (input.prior_receipt_id !== undefined && input.prior_receipt_id !== prior.receipt_id) fail('GPR_CHAIN_CONFLICT');
    let candidate = prior.candidate;
    if (input.candidate !== undefined) {
      if (input.candidate === null) candidate = null;
      else candidate = validateCandidate(input.candidate);
    }
    const receipt = createReceipt(allocation, store.config, {
      receipt_type: input.receipt_type,
      sequence,
      prior_receipt_id: prior.receipt_id,
      candidate,
      payload,
      created_at: createdAt
    });
    validateReceiptChain([...chain, receipt]);
    const existing = db.prepare('SELECT canonical_json FROM receipts WHERE run_id = ? AND sequence = ?').get(state.runId, sequence);
    if (existing) {
      if (existing.canonical_json === canonicalSerialize(receipt)) return deepFreeze({ receipt, duplicate: true });
      fail('GPR_SEQUENCE_CONFLICT');
    }
    transaction(db, () => {
      verifyFenceDb(db, state, isoAt());
      const liveChain = readChainDb(db, state.runId);
      if (liveChain.length !== chain.length || liveChain[liveChain.length - 1].receipt_id !== prior.receipt_id) fail('GPR_CHAIN_CONFLICT');
      if (['EXECUTOR_TERMINAL', 'G4_TERMINAL'].includes(receipt.receipt_type)) assertNoUnresolvedOperationDb(db);
      db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        receipt.receipt_id, receipt.run_id, receipt.sequence, receipt.receipt_type,
        receipt.prior_receipt_id, canonicalSerialize(receipt), receipt.receipt_id
      );
      if (TERMINAL_TYPES.includes(receipt.receipt_type)) {
        insertLeaseEvent(db, allocation, 'RELEASED', createdAt, { receipt_id: receipt.receipt_id, receipt_type: receipt.receipt_type });
      }
    });
  } finally {
    db.close();
  }
  const readback = store.readReceiptChain(state.runId);
  const receipt = readback[readback.length - 1];
  if (receipt.sequence < 2 || receipt.created_at !== createdAt || receipt.receipt_type !== input.receipt_type) fail('GPR_READBACK_MISMATCH');
  return deepFreeze({ receipt, duplicate: false });
}

function verifyAuthoritySnapshot(expected, snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.authority) || !Array.isArray(snapshot.later_controlling_comments)) fail('GPR_AUTHORITY_UNVERIFIED');
  const observed = validateAuthority(snapshot.authority);
  if (canonicalSerialize(observed) !== canonicalSerialize(expected) || snapshot.later_controlling_comments.length > 0) fail('GPR_AUTHORITY_CHANGED');
  return observed;
}

async function callReader(reader, errorCode) {
  if (typeof reader !== 'function') fail(errorCode);
  try {
    return await reader();
  } catch (error) {
    if (error instanceof GprError) throw error;
    fail(errorCode, { cause: error && error.code ? error.code : 'reader-failed' });
  }
}

function validateSourceSnapshot(value) {
  if (!exactKeys(value, ['source_digest', 'cas_digest'])
    || !isDigest(value.source_digest) || !isDigest(value.cas_digest)) fail('GPR_SOURCE_UNVERIFIED');
  return deepFreeze(clone(value));
}

function operationWithStateDb(db, operationId) {
  const operation = db.prepare('SELECT * FROM mutation_operations WHERE operation_id = ?').get(operationId);
  if (!operation) fail('GPR_OPERATION_NOT_FOUND');
  const event = latestOperationEventDb(db, operationId);
  if (!event) fail('GPR_OPERATION_EVENT_TAMPERED');
  return { operation, event };
}

function operationEventsPublic(db, operationId) {
  return db.prepare('SELECT * FROM mutation_operation_events WHERE operation_id = ? ORDER BY sequence').all(operationId).map((event) => deepFreeze({
    event_id: event.event_id,
    operation_id: event.operation_id,
    sequence: event.sequence,
    prior_event_id: event.prior_event_id,
    event_type: event.event_type,
    state: event.state,
    event_at: event.event_at,
    authority_digest: event.authority_digest,
    provider_evidence_digest: event.provider_evidence_digest,
    readback_digest: event.readback_digest,
    detail_digest: event.detail_digest,
    event_digest: event.event_digest
  }));
}

function admissionState(store, session, admission) {
  const sessionOwner = sessionState(store, session);
  const state = admission && ADMISSION_OWNERS.get(admission);
  if (!state || state.storeInstanceId !== store.instanceId || state.processId !== process.pid
    || state.session !== session || state.runId !== sessionOwner.runId) fail('GPR_ADMISSION_INVALID');
  return { sessionOwner, state };
}

function createAdmissionToken(state) {
  const admission = {};
  Object.defineProperties(admission, {
    operation_id: { enumerable: true, get: () => state.operationId },
    logical_operation_digest: { enumerable: true, get: () => state.logicalOperationDigest },
    provider_operation_key: { enumerable: true, get: () => state.providerOperationKey },
    toJSON: { value: () => fail('GPR_ADMISSION_NONSERIALIZABLE') }
  });
  return Object.freeze(admission);
}

function validateTrustedReaders(value) {
  if (!exactKeys(value, ['readAuthority', 'readSource', 'verifyOutcomeEvidence'])
    || typeof value.readAuthority !== 'function'
    || typeof value.readSource !== 'function'
    || typeof value.verifyOutcomeEvidence !== 'function') fail('GPR_TRUSTED_READERS_INVALID');
  return value;
}

function reconciliationAuthority(snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.authority) || !Array.isArray(snapshot.later_controlling_comments)) {
    fail('GPR_AUTHORITY_UNVERIFIED');
  }
  const authority = validateAuthority(snapshot.authority);
  if (snapshot.later_controlling_comments.length) fail('GPR_AUTHORITY_CHANGED');
  return authority;
}

function createProgrammeReceiptStore(options) {
  const config = createStoreConfig(options);
  const store = {
    instanceId: randomId('store'),
    config,
    get databasePath() { return config.databasePath; },
    allocateRun(input) {
      if (isRecord(input) && ('lease' in input || 'fence_id' in input || 'fence_sequence' in input || 'lease_id' in input)) fail('GPR_CALLER_FENCE_FORBIDDEN');
      if (!exactKeys(input, ['lock', 'authority', 'start', 'candidate', 'lease_ms'])
        || !isSafeId(input.lock) || !Number.isSafeInteger(input.lease_ms)
        || input.lease_ms < LIMITS.leaseMinMs || input.lease_ms > LIMITS.leaseMaxMs) fail('GPR_ALLOCATION_INVALID');
      const authority = validateAuthority(input.authority);
      const start = validateStart(input.start);
      if (input.candidate !== undefined && input.candidate !== null) fail('GPR_FAKE_START_CANDIDATE');
      const ownerInstanceId = randomId('owner');
      const db = openVerified(config);
      let allocation;
      try {
        allocation = transaction(db, () => {
          const issuedAt = isoAt();
          const expiresAt = isoAt(Date.parse(issuedAt) + input.lease_ms);
          assertNoUnresolvedOperationDb(db);
          if (db.prepare('SELECT COUNT(*) AS value FROM allocations').get().value >= LIMITS.allocationsPerNamespace) fail('GPR_ALLOCATION_LIMIT');
          const active = activeAllocationDb(db, issuedAt);
          if (active) fail('GPR_ACTIVE_LEASE', { run_id: active.run_id, lock: active.lock_id, expires_at: active.expires_at });
          const previous = latestAllocationDb(db);
          const highWater = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water;
          const fenceSequence = highWater + 1;
          const row = {
            allocation_id: randomId('allocation'),
            run_id: randomId('run'),
            lock_id: input.lock,
            lease_id: randomId('lease'),
            fence_id: randomId('fence'),
            fence_sequence: fenceSequence,
            owner_instance_id: ownerInstanceId,
            process_id: process.pid,
            issued_at: issuedAt,
            expires_at: expiresAt,
            authority_json: canonicalSerialize(authority),
            start_json: canonicalSerialize(start)
          };
          row.allocation_digest = digestValue({
            allocation_id: row.allocation_id,
            run_id: row.run_id,
            lock: row.lock_id,
            lease_id: row.lease_id,
            fence_id: row.fence_id,
            fence_sequence: row.fence_sequence,
            owner_instance_id: row.owner_instance_id,
            process_id: row.process_id,
            issued_at: row.issued_at,
            expires_at: row.expires_at,
            authority,
            start
          });
          db.prepare('UPDATE coordination_state SET high_water = ? WHERE singleton = 1 AND high_water = ?').run(fenceSequence, highWater);
          db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            row.allocation_id, row.run_id, row.lock_id, row.lease_id, row.fence_id,
            row.fence_sequence, row.owner_instance_id, row.process_id, row.issued_at,
            row.expires_at, row.authority_json, row.start_json, row.allocation_digest
          );
          const run = {
            run_id: row.run_id,
            allocation_id: row.allocation_id,
            lock: row.lock_id,
            authority_digest: digestValue(authority),
            start_digest: digestValue(start)
          };
          run.run_digest = digestValue(run);
          db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run(
            run.run_id, run.allocation_id, run.lock, run.authority_digest, run.start_digest, run.run_digest
          );
          insertLeaseEvent(db, row, previous ? 'EXPIRED_TAKEOVER' : 'ALLOCATED', issuedAt, {
            prior_allocation_id: previous ? previous.allocation_id : null,
            prior_fence_sequence: previous ? previous.fence_sequence : null
          });
          return row;
        });
      } finally {
        db.close();
      }
      const session = deepFreeze({ ...allocationPublic(allocation), started: false });
      SESSION_OWNERS.set(session, {
        storeInstanceId: store.instanceId,
        ownerInstanceId,
        processId: process.pid,
        allocationId: allocation.allocation_id,
        runId: allocation.run_id
      });
      return session;
    },
    async startAllocatedRun(session, readers) {
      const state = sessionState(store, session);
      const db = openVerified(config);
      let allocation;
      try {
        allocation = verifyFenceDb(db, state, isoAt());
        if (readChainDb(db, state.runId, true).length > 0) fail('GPR_RUN_ALREADY_STARTED');
      } finally {
        db.close();
      }
      const authority = JSON.parse(allocation.authority_json);
      const start = JSON.parse(allocation.start_json);
      verifyAuthoritySnapshot(authority, await callReader(readers && readers.readAuthority, 'GPR_AUTHORITY_UNVERIFIED'));
      const observedStart = validateStart(await callReader(readers && readers.readStart, 'GPR_START_UNVERIFIED'));
      if (canonicalSerialize(observedStart) !== canonicalSerialize(start)) fail('GPR_START_CHANGED');
      let receipt;
      let expectedVerification;
      const writeDb = openVerified(config);
      try {
        transaction(writeDb, () => {
          const transactionNow = isoAt();
          allocation = verifyFenceDb(writeDb, state, transactionNow);
          if (readChainDb(writeDb, state.runId, true).length > 0) fail('GPR_RUN_ALREADY_STARTED');
          receipt = createReceipt(allocation, config, {
            receipt_type: 'RUN_STARTED',
            sequence: 1,
            prior_receipt_id: null,
            candidate: null,
            payload: { classification: 'RUN_STARTED_VERIFIED' },
            created_at: transactionNow
          });
          writeDb.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            receipt.receipt_id, receipt.run_id, receipt.sequence, receipt.receipt_type,
            receipt.prior_receipt_id, canonicalSerialize(receipt), receipt.receipt_id
          );
          expectedVerification = verificationPacketDb(writeDb, config, allocation, receipt);
        });
      } finally {
        writeDb.close();
      }
      const verifiedPacket = verifyStartedRunFreshProcess(config, expectedVerification);
      const started = deepFreeze({ ...allocationPublic(allocation), started: true, run_started_receipt_id: receipt.receipt_id });
      SESSION_OWNERS.set(started, { ...state, startVerificationDigest: verifiedPacket.packet_digest });
      return started;
    },
    async startRun(input, readers) {
      const allocated = store.allocateRun(input);
      return store.startAllocatedRun(allocated, readers);
    },
    appendReceipt(session, input) {
      return appendReceiptInternal(store, session, input);
    },
    interruptRun(session, input = {}) {
      return appendReceiptInternal(store, session, {
        receipt_type: 'RUN_INTERRUPTED',
        candidate: input.candidate,
        payload: input.payload || { classification: 'RUN_INTERRUPTED' },
        created_at: input.created_at
      });
    },
    readReceiptChain(runId) {
      if (!isSafeId(runId)) fail('GPR_RUN_ID_INVALID');
      const db = openVerified(config, false);
      try { return readChainDb(db, runId); } finally { db.close(); }
    },
    classifyRecovery(runId, now = Date.now()) {
      if (!isSafeId(runId)) fail('GPR_RUN_ID_INVALID');
      const observedAt = isoAt(now);
      const db = openVerified(config, false);
      try {
        const allocation = db.prepare('SELECT * FROM allocations WHERE run_id = ?').get(runId);
        if (!allocation) return deepFreeze({ status: 'RUN_NOT_FOUND', run_id: runId });
        const chain = readChainDb(db, runId, true);
        if (chain.length && TERMINAL_TYPES.includes(chain[chain.length - 1].receipt_type)) return deepFreeze({ status: 'TERMINAL', run_id: runId, receipt_id: chain[chain.length - 1].receipt_id });
        const expired = Date.parse(allocation.expires_at) <= Date.parse(observedAt);
        if (!chain.length) return deepFreeze({ status: expired ? 'UNSTARTED_ALLOCATION_EXPIRED' : 'UNSTARTED_ALLOCATION_ACTIVE', run_id: runId });
        return deepFreeze({ status: expired ? 'STARTED_LEASE_EXPIRED' : 'LIVE_RUN_NOT_ADOPTABLE', run_id: runId });
      } finally {
        db.close();
      }
    },
    async admitMutationOperation(session, descriptorInput, trustedReadersInput) {
      const state = sessionState(store, session);
      if (!state.startVerificationDigest) fail('GPR_RUN_NOT_FRESHLY_VERIFIED');
      const descriptor = validateOperationDescriptor(descriptorInput);
      const trustedReaders = validateTrustedReaders(trustedReadersInput);
      let allocation;
      const initialDb = openVerified(config, false);
      try { allocation = allocationFromStateDb(initialDb, state); } finally { initialDb.close(); }
      verifyAuthoritySnapshot(JSON.parse(allocation.authority_json), await callReader(trustedReaders.readAuthority, 'GPR_AUTHORITY_UNVERIFIED'));
      const source = validateSourceSnapshot(await callReader(trustedReaders.readSource, 'GPR_SOURCE_UNVERIFIED'));
      if (source.source_digest !== descriptor.expected_source_digest || source.cas_digest !== descriptor.cas_digest) fail('GPR_SOURCE_CHANGED');
      const operationId = randomId('operation');
      const providerOperationKey = `gpr:${operationId}`;
      const logicalOperationDigest = digestValue({
        operation_kind: descriptor.operation_kind,
        safety_class: descriptor.safety_class,
        target_identity: descriptor.target_identity,
        target_digest: descriptor.target_digest,
        expected_post_state_digest: descriptor.expected_post_state_digest,
        adapter_identity_digest: descriptor.adapter_identity_digest
      });
      let operation;
      const db = openVerified(config, false);
      try {
        operation = transaction(db, () => {
          const createdAt = isoAt();
          allocation = verifyFenceDb(db, state, createdAt);
          const chain = readChainDb(db, state.runId);
          if (chain[0].receipt_type !== 'RUN_STARTED' || chain[0].sequence !== 1) fail('GPR_RUN_NOT_STARTED');
          if (TERMINAL_TYPES.includes(chain[chain.length - 1].receipt_type)) fail('GPR_RUN_TERMINAL');
          assertNoUnresolvedOperationDb(db);
          if (db.prepare('SELECT COUNT(*) AS value FROM mutation_operations').get().value >= LIMITS.operationsPerNamespace
            || db.prepare('SELECT COUNT(*) AS value FROM mutation_operation_events').get().value + 2 > LIMITS.operationEventsPerNamespace) {
            fail('GPR_OPERATION_LIMIT');
          }
          const priorLogical = db.prepare(`
            SELECT o.*, e.state FROM mutation_operations o
            JOIN mutation_operation_events e ON e.operation_id = o.operation_id
            WHERE o.logical_operation_digest = ?
              AND e.sequence = (SELECT MAX(inner_event.sequence) FROM mutation_operation_events inner_event WHERE inner_event.operation_id = o.operation_id)
            ORDER BY o.created_at DESC, o.operation_id DESC LIMIT 1
          `).get(logicalOperationDigest);
          if (priorLogical && priorLogical.state === 'APPLIED') fail('GPR_OPERATION_ALREADY_APPLIED');
          if (descriptor.retry_of_operation_id === null && priorLogical && priorLogical.state === 'NOT_APPLIED') {
            fail('GPR_RETRY_REQUIRES_REFERENCE');
          }
          if (descriptor.retry_of_operation_id !== null) {
            const retry = operationWithStateDb(db, descriptor.retry_of_operation_id);
            if (retry.event.state !== 'NOT_APPLIED'
              || retry.operation.logical_operation_digest !== logicalOperationDigest
              || retry.operation.run_id === allocation.run_id
              || retry.operation.fence_sequence >= allocation.fence_sequence) fail('GPR_RETRY_FORBIDDEN');
          }
          const row = {
            operation_id: operationId,
            logical_operation_digest: logicalOperationDigest,
            run_id: allocation.run_id,
            allocation_id: allocation.allocation_id,
            lock_id: allocation.lock_id,
            authority_digest: digestValue(JSON.parse(allocation.authority_json)),
            lease_id: allocation.lease_id,
            fence_id: allocation.fence_id,
            fence_sequence: allocation.fence_sequence,
            operation_kind: descriptor.operation_kind,
            safety_class: descriptor.safety_class,
            target_identity_json: canonicalSerialize(descriptor.target_identity),
            target_digest: descriptor.target_digest,
            source_digest: descriptor.expected_source_digest,
            cas_digest: descriptor.cas_digest,
            expected_post_state_digest: descriptor.expected_post_state_digest,
            provider_operation_key: providerOperationKey,
            adapter_identity_digest: descriptor.adapter_identity_digest,
            retry_of_operation_id: descriptor.retry_of_operation_id,
            created_at: createdAt
          };
          row.operation_digest = digestValue(operationRowPayload(row));
          db.prepare('INSERT INTO mutation_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            row.operation_id, row.logical_operation_digest, row.run_id, row.allocation_id,
            row.lock_id, row.authority_digest, row.lease_id, row.fence_id,
            row.fence_sequence, row.operation_kind, row.safety_class, row.target_identity_json,
            row.target_digest, row.source_digest, row.cas_digest, row.expected_post_state_digest,
            row.provider_operation_key, row.adapter_identity_digest, row.retry_of_operation_id,
            row.created_at, row.operation_digest
          );
          insertOperationEvent(db, row, 'PREPARED', 'PREPARED', createdAt, row.authority_digest);
          insertOperationEvent(db, row, 'IN_FLIGHT', 'IN_FLIGHT', createdAt, row.authority_digest);
          return row;
        });
      } finally {
        db.close();
      }
      const admissionOwner = {
        storeInstanceId: store.instanceId,
        processId: process.pid,
        session,
        runId: state.runId,
        operationId,
        logicalOperationDigest,
        providerOperationKey,
        trustedReaders,
        dispatched: false,
        outcomeRecorded: false
      };
      const admission = createAdmissionToken(admissionOwner);
      ADMISSION_OWNERS.set(admission, admissionOwner);
      return admission;
    },
    async authorizeMutationDispatch(session, admission) {
      const { sessionOwner, state } = admissionState(store, session, admission);
      if (state.dispatched || state.outcomeRecorded) fail('GPR_ADMISSION_CONSUMED');
      const dbBefore = openVerified(config, false);
      let allocation;
      try { allocation = allocationFromStateDb(dbBefore, sessionOwner); } finally { dbBefore.close(); }
      verifyAuthoritySnapshot(JSON.parse(allocation.authority_json), await callReader(state.trustedReaders.readAuthority, 'GPR_AUTHORITY_UNVERIFIED'));
      const source = validateSourceSnapshot(await callReader(state.trustedReaders.readSource, 'GPR_SOURCE_UNVERIFIED'));
      const db = openVerified(config, false);
      try {
        allocation = verifyFenceDb(db, sessionOwner, isoAt());
        const current = operationWithStateDb(db, state.operationId);
        if (current.event.state !== 'IN_FLIGHT'
          || current.operation.run_id !== allocation.run_id
          || source.source_digest !== current.operation.source_digest
          || source.cas_digest !== current.operation.cas_digest) fail('GPR_SOURCE_CHANGED');
        const unresolved = unresolvedOperationDb(db);
        if (!unresolved || unresolved.operation_id !== state.operationId) fail('GPR_ADMISSION_INVALID');
        state.dispatched = true;
        return operationPublic(current.operation);
      } finally {
        db.close();
      }
    },
    async recordMutationOutcome(session, admission, evidenceInput) {
      const { state } = admissionState(store, session, admission);
      if (!state.dispatched || state.outcomeRecorded) fail('GPR_ADMISSION_CONSUMED');
      let operation;
      const readDb = openVerified(config, false);
      try { operation = operationWithStateDb(readDb, state.operationId).operation; } finally { readDb.close(); }
      let evidence;
      try {
        const verified = await state.trustedReaders.verifyOutcomeEvidence(clone(evidenceInput), operationPublic(operation));
        if (canonicalSerialize(verified) !== canonicalSerialize(evidenceInput)) fail('GPR_OUTCOME_EVIDENCE_INVALID');
        evidence = validateOutcomeEvidence(verified, operation);
      } catch (error) {
        const db = openVerified(config, false);
        try {
          transaction(db, () => {
            const current = operationWithStateDb(db, state.operationId);
            if (['IN_FLIGHT', 'UNKNOWN'].includes(current.event.state)) {
              insertOperationEvent(db, current.operation, 'OUTCOME_RECORDED', 'UNKNOWN', isoAt(), current.operation.authority_digest, {
                detail_digest: digestValue({ reason: 'OUTCOME_EVIDENCE_INVALID' })
              });
            }
          });
        } finally { db.close(); }
        state.outcomeRecorded = true;
        fail('GPR_OUTCOME_EVIDENCE_INVALID', { cause: error && error.code ? error.code : 'adapter-evidence-invalid' });
      }
      const db = openVerified(config, false);
      try {
        transaction(db, () => {
          const current = operationWithStateDb(db, state.operationId);
          const highWater = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water;
          const unresolved = unresolvedOperationDb(db);
          if (highWater !== current.operation.fence_sequence
            || !unresolved || unresolved.operation_id !== current.operation.operation_id
            || !['IN_FLIGHT', 'UNKNOWN'].includes(current.event.state)) fail('GPR_ADMISSION_INVALID');
          return insertOperationEvent(db, current.operation, 'OUTCOME_RECORDED', evidence.classification,
            evidence.evidence_at, current.operation.authority_digest, {
              provider_evidence_digest: evidence.evidence_digest,
              readback_digest: evidence.observed_post_state_digest,
              detail_digest: digestValue({ classification: evidence.classification, rejection_digest: evidence.rejection_digest })
            });
        });
      } finally { db.close(); }
      state.outcomeRecorded = true;
      return store.readMutationOperation(state.operationId);
    },
    readMutationOperation(operationId) {
      if (!isSafeId(operationId)) fail('GPR_OPERATION_NOT_FOUND');
      const db = openVerified(config, false);
      try {
        const current = operationWithStateDb(db, operationId);
        return deepFreeze({ operation: operationPublic(current.operation), state: current.event.state, events: operationEventsPublic(db, operationId) });
      } finally { db.close(); }
    },
    async reconcileMutationOperation(operationId, authorityReader, providerReader) {
      if (!isSafeId(operationId) || typeof authorityReader !== 'function' || typeof providerReader !== 'function') fail('GPR_RECONCILIATION_INVALID');
      let operation;
      let currentState;
      const readDb = openVerified(config, false);
      try {
        const current = operationWithStateDb(readDb, operationId);
        operation = current.operation;
        currentState = current.event.state;
      } finally { readDb.close(); }
      if (['APPLIED', 'NOT_APPLIED'].includes(currentState)) return store.readMutationOperation(operationId);
      const authority = reconciliationAuthority(await callReader(authorityReader, 'GPR_AUTHORITY_UNVERIFIED'));
      const evidence = validateOutcomeEvidence(await callReader(() => providerReader(operationPublic(operation)), 'GPR_RECONCILIATION_UNVERIFIED'), operation);
      const db = openVerified(config, false);
      try {
        transaction(db, () => {
          const current = operationWithStateDb(db, operationId);
          if (!['IN_FLIGHT', 'UNKNOWN'].includes(current.event.state)) fail('GPR_RECONCILIATION_INVALID');
          insertOperationEvent(db, current.operation, 'RECONCILED', evidence.classification,
            evidence.evidence_at, digestValue(authority), {
              provider_evidence_digest: evidence.evidence_digest,
              readback_digest: evidence.observed_post_state_digest,
              detail_digest: digestValue({ classification: evidence.classification, rejection_digest: evidence.rejection_digest })
            });
        });
      } finally { db.close(); }
      return store.readMutationOperation(operationId);
    }
  };
  openVerified(config).close();
  return Object.freeze(store);
}

function parseArgs(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) result._.push(value);
    else {
      const key = value.slice(2).replace(/-/g, '_');
      result[key] = args[index + 1];
      index += 1;
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] === 'runtime-check') {
    assertRuntimeSupport();
    process.stdout.write(`${JSON.stringify({ ok: true, schema: SCHEMA_ID, node: process.versions.node })}\n`);
    return;
  }
  if (args._[0] === 'verify-run-started') {
    const config = createStoreConfig({
      repository: args.repository,
      parent_issue: Number(args.parent_issue),
      child_issue: Number(args.child_issue),
      stateRoot: args.state_root,
      repositoryRoot: args.repository_root
    });
    const packet = readVerificationPacket(config, {
      run_id: args.run_id,
      allocation_id: args.allocation_id,
      receipt_id: args.receipt_id
    });
    process.stdout.write(`${canonicalSerialize(packet)}\n`);
    return;
  }
  if (args._[0] === 'inspect') {
    const config = createStoreConfig({
      repository: args.repository,
      parent_issue: Number(args.parent_issue),
      child_issue: Number(args.child_issue),
      stateRoot: args.state_root,
      repositoryRoot: args.repository_root
    });
    const db = openVerified(config, false);
    let chain;
    try { chain = readChainDb(db, args.run_id); } finally { db.close(); }
    process.stdout.write(`${JSON.stringify({ ok: true, chain })}\n`);
    return;
  }
  fail('GPR_COMMAND_INVALID');
}

if (require.main === module) {
  try { main(); } catch (error) {
    const code = error instanceof GprError ? error.code : 'GPR_INTERNAL_ERROR';
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  APPLICATION_ID,
  BUSY_TIMEOUT_MS,
  BROKER_RECOVERY_CLASSIFICATION,
  BROKER_RECOVERY_REASON,
  HOLDER_ATTESTATION_ALGORITHM,
  HOLDER_ATTESTATION_KEYS,
  HOLDER_ATTESTATION_SCHEMA_ID,
  LIMITS,
  MIN_NODE_VERSION,
  OPERATION_KINDS,
  OPERATION_STATES,
  PRE_RECOVERY_EVIDENCE_KEYS,
  PRE_RECOVERY_EVIDENCE_SCHEMA_ID,
  RECEIPT_TYPES,
  RECOVERY_RECORD_KEYS,
  RECOVERY_RECORD_SCHEMA_ID,
  SAFETY_CLASSES,
  SCHEMA_ID,
  TERMINAL_TYPES,
  USER_VERSION,
  ZERO_OPERATION_INVENTORY_DIGEST,
  V3_MIGRATION_PLAN_SCHEMA_ID,
  V3_USER_VERSION,
  GprError,
  assertRuntimeSupport,
  appendV3ReceiptWithChainDigest,
  buildFinalV3SchemaSql,
  buildV2ToV3MigrationPlan,
  createProgrammeReceiptStore,
  digestValue,
  canonicalSerialize,
  expectedFinalV3SchemaFingerprint,
  expectedV2SchemaFingerprint,
  namespaceDigest,
  preRecoveryEvidenceDigest,
  verifyFinalV3Database,
  verifyV3DurableEvidence,
  resolveDatabasePath,
  validateAuthority,
  validateCandidate,
  validateHolderAttestation,
  validateOperationDescriptor,
  validateOutcomeEvidence,
  validatePreRecoveryEvidence,
  validateReceiptChain,
  validateReceiptObject,
  validateRecoveryRecord,
  validateReservedOrphanPayload,
  validateStart,
  validateVerificationPacket,
  validateVerifierProcessResult,
  validateWindowsStorageProof
});
