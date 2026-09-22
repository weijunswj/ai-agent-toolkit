#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { types: utilTypes } = require('node:util');
const { spawnSync } = require('node:child_process');
const { canonicalSerialize, digestValue } = require('./toolkit-execution-loop.cjs');

const SCHEMA_ID = 'toolkit.github-program.run-receipt.v1';
const MIN_NODE_VERSION = '22.13.0';
const APPLICATION_ID = 1196446257;
const USER_VERSION = 2;
const V3_USER_VERSION = 3;
const AUTHORITY_PACKET_USER_VERSION = 4;
const AUTHORITY_PACKET_SCHEMA_ID = 'toolkit.github-program.authority-packet.v1';
const AUTHORITY_PACKET_DELIVERY_SCHEMA_ID = 'toolkit.github-program.authority-packet-delivery.v1';
const AUTHORITY_PACKET_EVENT_SCHEMA_ID = 'toolkit.github-program.authority-packet-event.v1';
const SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID = 'toolkit.github-program.semantic-gate-admission-event.v1';
const AUTHORITY_PACKET_ACCEPTANCE_SCHEMA_ID = 'toolkit.github-program.authority-packet-acceptance.v1';
const AUTHORITY_PACKET_CURRENT_SCHEMA_ID = 'toolkit.github-program.authority-packet-current.v1';
const SEMANTIC_GATE_ADMISSION_SCHEMA_ID = 'toolkit.github-program.semantic-gate-admission.v1';
const PACKET_TERMINAL_FAILURE_CODE = 'TERMINAL_PACKET_DURABILITY_UNVERIFIED';
const AUTHORITY_PACKET_STAGES = Object.freeze([
  'G0-A', 'G0-B', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'RECONVERGENCE', 'FINAL_AUDIT', 'BROWSER'
]);
const AUTHORITY_PACKET_CONSUMER_CLASSES = Object.freeze([...AUTHORITY_PACKET_STAGES, 'WEB', 'FINALITY']);
const AUTHORITY_PACKET_VERDICTS = Object.freeze(['PASS', 'HOLD', 'AMEND', 'REENTRY_REQUIRED', 'COMPLETE']);
const AUTHORITY_PACKET_FINDING_DISPOSITIONS = Object.freeze(['BLOCKING', 'NON_BLOCKING', 'RESOLVED']);
const AUTHORITY_PACKET_ID_PATTERN = /^ap1-[a-f0-9]{64}$/;
const AUTHORITY_PACKET_REASON_CODES = Object.freeze([
  'GPR_PACKET_VALUE_INVALID',
  'GPR_PACKET_SCHEMA_UNSUPPORTED',
  'GPR_PACKET_PRIVACY_REJECTED',
  'GPR_PACKET_LIMIT',
  'GPR_PACKET_STORE_UNAVAILABLE',
  'GPR_PACKET_STORE_IDENTITY_MISMATCH',
  'GPR_PACKET_SCHEMA_UNAVAILABLE',
  'GPR_PACKET_MIGRATION_SOURCE_INVALID',
  'GPR_PACKET_MIGRATION_NOT_QUIESCENT',
  'GPR_PACKET_WRITE_FAILED',
  'GPR_PACKET_NOT_FOUND',
  'GPR_PACKET_CONTENT_MISMATCH',
  'GPR_PACKET_IDENTITY_MISMATCH',
  'GPR_PACKET_BINDING_MISMATCH',
  'GPR_PACKET_CONFLICT',
  'GPR_PACKET_READBACK_FAILED',
  'GPR_PACKET_AUTHORITY_UNVERIFIED',
  'GPR_PACKET_ACCEPTANCE_UNVERIFIED',
  'GPR_PACKET_CURRENT_UNVERIFIED',
  'GPR_PACKET_CONSUMER_NOT_PERMITTED',
  'GPR_PACKET_ADMISSION_REQUIRED',
  'GPR_PACKET_STALE_REPLAY',
  'GPR_PACKET_DISPATCH_UNRESOLVED',
  'GPR_PACKET_LEGACY_BACKFILL_UNVERIFIED',
  'GPR_PACKET_LEGACY_RERUN_REQUIRED',
  'GPR_PACKET_RETENTION_REQUIRED'
]);
const AUTHORITY_PACKET_LIMITS = Object.freeze({
  artifactBytes: 1024 * 1024,
  nestingDepth: 32,
  valueNodes: 65536,
  proseBytes: 262144,
  findings: 256,
  evidenceRefs: 64,
  requiredConsumers: 16,
  currentPredecessors: 16,
  currentProjectionBytes: 65536,
  // The delivery contains the envelope, canonical bytes, and decoded packet.
  deliveryBytes: 3 * 1024 * 1024 + 880
});
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
  outcomeEvidenceBytes: 4096,
  authorityPacketBytes: AUTHORITY_PACKET_LIMITS.artifactBytes,
  authorityPacketNestingDepth: AUTHORITY_PACKET_LIMITS.nestingDepth,
  authorityPacketValueNodes: AUTHORITY_PACKET_LIMITS.valueNodes,
  authorityPacketProseBytes: AUTHORITY_PACKET_LIMITS.proseBytes,
  authorityPacketFindings: AUTHORITY_PACKET_LIMITS.findings,
  authorityPacketEvidenceRefs: AUTHORITY_PACKET_LIMITS.evidenceRefs,
  authorityPacketConsumers: AUTHORITY_PACKET_LIMITS.requiredConsumers,
  authorityPacketCurrentPredecessors: AUTHORITY_PACKET_LIMITS.currentPredecessors,
  authorityPacketCurrentProjectionBytes: AUTHORITY_PACKET_LIMITS.currentProjectionBytes,
  authorityPacketDeliveryBytes: AUTHORITY_PACKET_LIMITS.deliveryBytes
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
const AUTHORITY_PACKET_KEYS = Object.freeze(['schema', 'bindings', 'body']);
const AUTHORITY_PACKET_BINDING_KEYS = Object.freeze([
  'repository', 'parent_issue', 'child_issue', 'lane_id', 'human_owner', 'producer',
  'authority', 'governance', 'candidate', 'applicability'
]);
const AUTHORITY_PACKET_PRODUCER_KEYS = Object.freeze(['run', 'lock', 'stage', 'role']);
const AUTHORITY_PACKET_AUTHORITY_KEYS = Object.freeze([
  'repository', 'issue_number', 'comment_id', 'node_id', 'author_login', 'updated_at', 'body_digest'
]);
const AUTHORITY_PACKET_GOVERNANCE_KEYS = Object.freeze([
  'repository', 'main_commit', 'controller_blob', 'stack_registry_blob'
]);
const AUTHORITY_PACKET_APPLICABILITY_KEYS = Object.freeze([
  'scope_digest', 'required_consumers', 'retain_through_child_finality', 'retain_through_candidate_finality'
]);
const AUTHORITY_PACKET_CONSUMER_KEYS = Object.freeze(['class', 'dependency_id', 'scope_digest']);
const AUTHORITY_PACKET_BODY_KEYS = Object.freeze([
  'verdict', 'decision', 'findings', 'qualifications', 'next_state', 'sections', 'evidence_refs', 'gate_contract_ir'
]);
const AUTHORITY_PACKET_FINDING_KEYS = Object.freeze([
  'id', 'requirement', 'observed', 'required', 'consequence', 'disposition', 'evidence_ids'
]);
const AUTHORITY_PACKET_SECTION_KEYS = Object.freeze(['name', 'text']);
const AUTHORITY_PACKET_SOURCE_KEYS = Object.freeze([
  'repository', 'issue_number', 'comment_id', 'node_id', 'author_login', 'updated_at', 'body_digest'
]);
const AUTHORITY_PACKET_EVIDENCE_KEYS = Object.freeze(['id', 'kind']);
const AUTHORITY_PACKET_EVENT_TYPES = Object.freeze([
  'READBACK_VERIFIED', 'WEB_ACCEPTANCE_BOUND', 'CURRENT_READBACK',
  'CONSUMER_COMPLETED', 'FINALITY_OBSERVED', 'BACKFILL_AUTHORISED'
]);
const SEMANTIC_GATE_ADMISSION_EVENT_TYPES = Object.freeze([
  'DISPATCH_INTENT', 'DISPATCH_CONFIRMED', 'DISPATCH_NOT_STARTED', 'CONSUMER_COMPLETED'
]);
const PAYLOAD_KEYS = Object.freeze([
  'classification', 'reason_code', 'outcome_digest', 'evidence_digest',
  'operation_digest', 'detail_digest', 'mutation_outcome', 'evidence_refs'
]);
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|private[_-]?key|secret|token|prompt|upload|model[_-]?output|raw[_-]?body)/i;
const SENSITIVE_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]+=*|github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const SESSION_OWNERS = new WeakMap();
const ADMISSION_OWNERS = new WeakMap();
const SEMANTIC_GATE_OWNERS = new WeakMap();
const AUTHORITY_PACKET_STORE_OWNERS = new WeakMap();
const PROGRAMME_RECEIPT_STORE_OWNERS = new WeakMap();
const AUTHORITY_PACKET_READER_OWNERS = new WeakMap();
const AUTHORITY_PACKET_READER_KEYS = Object.freeze([
  'readAuthority', 'readStart', 'screenPacket', 'readBackfillSource',
  'readCandidate', 'readCurrent', 'readWebDecision', 'readDispatchOutcome'
]);

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

function packetFail(reasonCode) {
  if (!AUTHORITY_PACKET_REASON_CODES.includes(reasonCode)) reasonCode = 'GPR_PACKET_VALUE_INVALID';
  const error = new GprError(reasonCode);
  error.packetBoundary = true;
  error.reason_code = reasonCode;
  throw error;
}

function packetFailureEnvelope(error) {
  const reasonCode = error && AUTHORITY_PACKET_REASON_CODES.includes(error.reason_code || error.code)
    ? error.reason_code || error.code
    : 'GPR_PACKET_VALUE_INVALID';
  return deepFreeze({
    ok: false,
    code: PACKET_TERMINAL_FAILURE_CODE,
    reason_code: reasonCode,
    accepted: false,
    consumable: false,
    next_gate_admitted: false
  });
}

function packetStringIsUnicodeScalar(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function packetClosedClone(value, state = { seen: new Set(), nodes: 0 }, location = 'value', depth = 0) {
  state.nodes += 1;
  if (state.nodes > AUTHORITY_PACKET_LIMITS.valueNodes || depth > AUTHORITY_PACKET_LIMITS.nestingDepth) {
    packetFail('GPR_PACKET_LIMIT');
  }
  if (value === null) return null;
  if (typeof value === 'string') {
    if (!packetStringIsUnicodeScalar(value)) packetFail('GPR_PACKET_VALUE_INVALID');
    if (Buffer.byteLength(value, 'utf8') > AUTHORITY_PACKET_LIMITS.proseBytes) packetFail('GPR_PACKET_LIMIT');
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || !Number.isFinite(value) || Object.is(value, -0)) {
      packetFail('GPR_PACKET_VALUE_INVALID');
    }
    return value;
  }
  if (typeof value !== 'object' || state.seen.has(value)) packetFail('GPR_PACKET_VALUE_INVALID');
  state.seen.add(value);
  try {
    let prototype;
    let names;
    let symbols;
    try {
      if (utilTypes.isProxy(value)) packetFail('GPR_PACKET_VALUE_INVALID');
    } catch (_) {
      packetFail('GPR_PACKET_VALUE_INVALID');
    }
    try {
      prototype = Object.getPrototypeOf(value);
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_) {
      packetFail('GPR_PACKET_VALUE_INVALID');
    }
    if (symbols.length > 0) packetFail('GPR_PACKET_VALUE_INVALID');
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype && prototype !== null) packetFail('GPR_PACKET_VALUE_INVALID');
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        packetFail('GPR_PACKET_VALUE_INVALID');
      }
      const result = [];
      result.length = lengthDescriptor.value;
      for (const name of names) {
        if (name === 'length') continue;
        if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= lengthDescriptor.value) {
          packetFail('GPR_PACKET_VALUE_INVALID');
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
          packetFail('GPR_PACKET_VALUE_INVALID');
        }
      }
      for (let index = 0; index < result.length; index += 1) {
        const name = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
          packetFail('GPR_PACKET_VALUE_INVALID');
        }
        result[index] = packetClosedClone(descriptor.value, state, `${location}[${index}]`, depth + 1);
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) packetFail('GPR_PACKET_VALUE_INVALID');
    const result = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
        packetFail('GPR_PACKET_VALUE_INVALID');
      }
      result[name] = packetClosedClone(descriptor.value, state, `${location}.${name}`, depth + 1);
    }
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function packetParseInput(value) {
  if (typeof value === 'string') return { value, serialized: true };
  if (Buffer.isBuffer(value)) {
    if (value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf) {
      packetFail('GPR_PACKET_VALUE_INVALID');
    }
    let decoded;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch (_) {
      packetFail('GPR_PACKET_VALUE_INVALID');
    }
    return { value: decoded, serialized: true };
  }
  return { value, serialized: false };
}

function packetCanonicalInput(value) {
  const input = packetParseInput(value);
  if (!input.serialized) return packetClosedClone(input.value);
  if (input.value.charCodeAt(0) === 0xfeff) packetFail('GPR_PACKET_VALUE_INVALID');
  let parsed;
  try { parsed = JSON.parse(input.value); } catch (_) { packetFail('GPR_PACKET_VALUE_INVALID'); }
  const normalized = packetClosedClone(parsed);
  let canonical;
  try { canonical = canonicalSerialize(normalized); } catch (_) { packetFail('GPR_PACKET_VALUE_INVALID'); }
  if (canonical !== input.value) packetFail('GPR_PACKET_VALUE_INVALID');
  return normalized;
}

function packetProse(value, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)
    || Buffer.byteLength(value, 'utf8') > AUTHORITY_PACKET_LIMITS.proseBytes) {
    packetFail(value && typeof value === 'string' && Buffer.byteLength(value, 'utf8') > AUTHORITY_PACKET_LIMITS.proseBytes
      ? 'GPR_PACKET_LIMIT' : 'GPR_PACKET_VALUE_INVALID');
  }
  return value;
}

function packetPrivacyString(value) {
  if (SENSITIVE_VALUE.test(value)
    || /(?:^|[\s"'`(])(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|root|private|tmp|var\/folders)(?:[\\/]|$))/i.test(value)
    || /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:]+:[^\s/@]+@/i.test(value)
    || /\b(?:password|passphrase|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret)\b\s*[:=]\s*(?!<redacted>|\[redacted\]|redacted\b|none\b|absent\b|not[ -]?stored\b)\S+/i.test(value)
    || /\b[A-Z][A-Z0-9_]{2,}\s*=\s*(?!<redacted>|\[redacted\]|redacted\b|none\b|absent\b|not[ -]?stored\b)\S+/u.test(value)) {
    packetFail('GPR_PACKET_PRIVACY_REJECTED');
  }
}

function assertAuthorityPacketPrivacy(value) {
  const visit = (current) => {
    if (typeof current === 'string') {
      packetPrivacyString(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (isRecord(current)) {
      for (const [key, item] of Object.entries(current)) {
        if (SENSITIVE_KEY.test(key)) packetFail('GPR_PACKET_PRIVACY_REJECTED');
        visit(item);
      }
    }
  };
  visit(value);
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

function packetSafeContractId(value) {
  return isSafeContractId(value, 160);
}

function packetSortedUnique(values) {
  if (!Array.isArray(values)) return false;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] >= values[index]) return false;
  }
  return true;
}

function packetValidateSourceReference(value, code = 'GPR_PACKET_VALUE_INVALID') {
  if (!exactKeys(value, AUTHORITY_PACKET_SOURCE_KEYS)
    || !isCanonicalRepository(value.repository)
    || !Number.isSafeInteger(value.issue_number) || value.issue_number < 1
    || !Number.isSafeInteger(value.comment_id) || value.comment_id < 1
    || !isSafeId(value.node_id, 160)
    || typeof value.author_login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(value.author_login)
    || !isTimestamp(value.updated_at) || !isDigest(value.body_digest)) {
    if (AUTHORITY_PACKET_REASON_CODES.includes(code)) packetFail(code);
    fail(code);
  }
  return value;
}

function packetValidateProducer(value) {
  if (!exactKeys(value, AUTHORITY_PACKET_PRODUCER_KEYS)
    || !packetSafeContractId(value.run)
    || !packetSafeContractId(value.lock)
    || !AUTHORITY_PACKET_STAGES.includes(value.stage)
    || value.role !== value.stage) packetFail('GPR_PACKET_VALUE_INVALID');
  return value;
}

function packetValidateGovernance(value, repository) {
  if (!exactKeys(value, AUTHORITY_PACKET_GOVERNANCE_KEYS)
    || value.repository !== repository
    || !isSha(value.main_commit) || !isSha(value.controller_blob) || !isSha(value.stack_registry_blob)) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  return value;
}

function packetValidateApplicability(value, producerStage) {
  if (!exactKeys(value, AUTHORITY_PACKET_APPLICABILITY_KEYS)
    || !isDigest(value.scope_digest)
    || !Array.isArray(value.required_consumers)
    || value.required_consumers.length > AUTHORITY_PACKET_LIMITS.requiredConsumers
    || typeof value.retain_through_child_finality !== 'boolean'
    || typeof value.retain_through_candidate_finality !== 'boolean') packetFail('GPR_PACKET_VALUE_INVALID');
  const seen = new Set();
  const producerIndex = AUTHORITY_PACKET_STAGES.indexOf(producerStage);
  for (const consumer of value.required_consumers) {
    if (!exactKeys(consumer, AUTHORITY_PACKET_CONSUMER_KEYS)
      || !AUTHORITY_PACKET_CONSUMER_CLASSES.includes(consumer.class)
      || !packetSafeContractId(consumer.dependency_id)
      || !isDigest(consumer.scope_digest)) packetFail('GPR_PACKET_VALUE_INVALID');
    const identity = `${consumer.class}\u0000${consumer.dependency_id}`;
    if (seen.has(identity)) packetFail('GPR_PACKET_VALUE_INVALID');
    seen.add(identity);
  }
  if (!packetSortedUnique(value.required_consumers.map((item) => `${item.class}\u0000${item.dependency_id}`))) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  const hasLaterConsumer = value.required_consumers.some((consumer) => {
    if (consumer.class === 'WEB' || consumer.class === 'FINALITY') return true;
    return AUTHORITY_PACKET_STAGES.indexOf(consumer.class) > producerIndex;
  });
  if (!hasLaterConsumer && !value.retain_through_child_finality && !value.retain_through_candidate_finality) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  return value;
}

function packetValidateBindings(value) {
  if (!exactKeys(value, AUTHORITY_PACKET_BINDING_KEYS)
    || !isCanonicalRepository(value.repository)
    || !Number.isSafeInteger(value.parent_issue) || value.parent_issue < 1
    || !Number.isSafeInteger(value.child_issue) || value.child_issue < 1
    || !packetSafeContractId(value.lane_id)
    || typeof value.human_owner !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(value.human_owner)) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  packetValidateSourceReference(value.authority);
  packetValidateProducer(value.producer);
  packetValidateGovernance(value.governance, value.repository);
  if (value.candidate !== null) {
    try { validateCandidate(value.candidate); } catch (_) { packetFail('GPR_PACKET_VALUE_INVALID'); }
  }
  packetValidateApplicability(value.applicability, value.producer.stage);
  if (value.authority.repository !== value.repository || value.authority.issue_number !== value.child_issue) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  if (value.authority.author_login !== value.human_owner) packetFail('GPR_PACKET_VALUE_INVALID');
  return value;
}

function packetExpectedSectionNames(stage) {
  const names = {
    'G0-A': ['framing', 'unknowns', 'evidence_questions', 'stop_condition'],
    'G0-B': ['questions', 'observations', 'provenance', 'coverage'],
    G1: ['causal_model', 'alternatives', 'invariants', 'architecture', 'assumptions'],
    G2: ['implementation_contract', 'mutation_boundary', 'oracle_matrix', 'validation', 'publication_boundary'],
    G3: ['implementation', 'candidate_identity', 'validation_results', 'remaining_obligations'],
    G4: ['candidate_identity', 'coverage', 'findings_and_reproducers', 'validation_results', 'disposition'],
    RECONVERGENCE: ['root_synthesis', 'prior_failures', 'retained_decisions', 'reentry_boundary'],
    FINAL_AUDIT: ['programme_coverage', 'remaining_obligations', 'validation_results', 'disposition'],
    LOOP: ['reconciliation', 'observations', 'handoff'],
    BROWSER: ['scope', 'observations', 'validation_results', 'disposition']
  };
  return names[stage];
}

function packetValidateEvidenceReference(value) {
  if (!isRecord(value) || !Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'kind')
    || !packetSafeContractId(value.id)
    || !['GIT_BLOB', 'GITHUB_COMMENT', 'AUTHORITY_PACKET'].includes(value.kind)) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  if (value.kind === 'GIT_BLOB') {
    if (!exactKeys(value, ['id', 'kind', 'repository', 'commit', 'path', 'blob', 'content_digest'])
      || !isCanonicalRepository(value.repository) || !isSha(value.commit) || !isSha(value.blob)
      || !isDigest(value.content_digest) || typeof value.path !== 'string'
      || value.path.length === 0 || value.path.length > 512 || value.path.startsWith('/')
      || value.path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value.path)
      || value.path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('-'))
      || value.path.includes('\\') || value.path.includes('://')) packetFail('GPR_PACKET_VALUE_INVALID');
  } else if (value.kind === 'GITHUB_COMMENT') {
    if (!exactKeys(value, ['id', 'kind', 'source'])) packetFail('GPR_PACKET_VALUE_INVALID');
    packetValidateSourceReference(value.source);
  } else if (!exactKeys(value, ['id', 'kind', 'packet_id', 'packet_digest', 'binding_digest'])
    || !AUTHORITY_PACKET_ID_PATTERN.test(value.packet_id)
    || !isDigest(value.packet_digest) || !isDigest(value.binding_digest)) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  return value;
}

function packetValidateBody(value, stage) {
  if (!exactKeys(value, AUTHORITY_PACKET_BODY_KEYS)
    || !AUTHORITY_PACKET_VERDICTS.includes(value.verdict)) packetFail('GPR_PACKET_VALUE_INVALID');
  packetProse(value.decision);
  packetProse(value.next_state);
  if (!Array.isArray(value.qualifications)) packetFail('GPR_PACKET_VALUE_INVALID');
  for (const qualification of value.qualifications) packetProse(qualification);
  if (!Array.isArray(value.findings) || value.findings.length > AUTHORITY_PACKET_LIMITS.findings) {
    packetFail('GPR_PACKET_LIMIT');
  }
  for (const finding of value.findings) {
    if (!exactKeys(finding, AUTHORITY_PACKET_FINDING_KEYS)
      || !packetSafeContractId(finding.id)
      || !AUTHORITY_PACKET_FINDING_DISPOSITIONS.includes(finding.disposition)
      || !Array.isArray(finding.evidence_ids) || finding.evidence_ids.length > AUTHORITY_PACKET_LIMITS.evidenceRefs
      || !packetSortedUnique(finding.evidence_ids)) packetFail('GPR_PACKET_VALUE_INVALID');
    packetProse(finding.requirement);
    packetProse(finding.observed);
    packetProse(finding.required);
    packetProse(finding.consequence);
    for (const evidenceId of finding.evidence_ids) if (!packetSafeContractId(evidenceId)) packetFail('GPR_PACKET_VALUE_INVALID');
  }
  const expectedSections = packetExpectedSectionNames(stage);
  if (!expectedSections || !Array.isArray(value.sections) || value.sections.length !== expectedSections.length) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  for (let index = 0; index < expectedSections.length; index += 1) {
    const section = value.sections[index];
    if (!exactKeys(section, AUTHORITY_PACKET_SECTION_KEYS) || section.name !== expectedSections[index]) {
      packetFail('GPR_PACKET_VALUE_INVALID');
    }
    packetProse(section.text);
  }
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length > AUTHORITY_PACKET_LIMITS.evidenceRefs) {
    packetFail('GPR_PACKET_LIMIT');
  }
  const evidenceIds = new Set();
  for (const evidence of value.evidence_refs) {
    packetValidateEvidenceReference(evidence);
    if (evidenceIds.has(evidence.id)) packetFail('GPR_PACKET_VALUE_INVALID');
    evidenceIds.add(evidence.id);
  }
  for (const finding of value.findings) {
    for (const evidenceId of finding.evidence_ids) if (!evidenceIds.has(evidenceId)) packetFail('GPR_PACKET_VALUE_INVALID');
  }
  if (value.gate_contract_ir !== null) {
    if (stage !== 'G2' || value.verdict !== 'PASS') packetFail('GPR_PACKET_VALUE_INVALID');
    try {
      const compiler = require('./toolkit-gate-contract-compiler.cjs');
      compiler.compileGateContract(value.gate_contract_ir);
    } catch (_) {
      packetFail('GPR_PACKET_SCHEMA_UNSUPPORTED');
    }
  } else if (stage === 'G2' && value.verdict === 'PASS') {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  return value;
}

function validateAuthorityPacket(value) {
  const normalized = packetCanonicalInput(value);
  if (!isRecord(normalized) || !exactKeys(normalized, AUTHORITY_PACKET_KEYS)) packetFail('GPR_PACKET_VALUE_INVALID');
  if (normalized.schema !== AUTHORITY_PACKET_SCHEMA_ID) packetFail('GPR_PACKET_SCHEMA_UNSUPPORTED');
  packetValidateBindings(normalized.bindings);
  packetValidateBody(normalized.body, normalized.bindings.producer.stage);
  assertAuthorityPacketPrivacy(normalized);
  let canonical;
  try { canonical = canonicalSerialize(normalized); } catch (_) { packetFail('GPR_PACKET_VALUE_INVALID'); }
  if (Buffer.byteLength(canonical, 'utf8') > AUTHORITY_PACKET_LIMITS.artifactBytes) packetFail('GPR_PACKET_LIMIT');
  return deepFreeze(normalized);
}

function authorityPacketIdentities(value) {
  const packet = validateAuthorityPacket(value);
  const contentDigest = digestValue(packet.body);
  const bindingDigest = digestValue(packet.bindings);
  const packetDigest = digestValue({ schema: packet.schema, bindings: packet.bindings, body: packet.body });
  const producerKey = digestValue({
    repository: packet.bindings.repository,
    parent_issue: packet.bindings.parent_issue,
    child_issue: packet.bindings.child_issue,
    lane_id: packet.bindings.lane_id,
    producer_run: packet.bindings.producer.run
  });
  return deepFreeze({
    packet,
    packet_id: `ap1-${packetDigest}`,
    packet_digest: packetDigest,
    content_digest: contentDigest,
    binding_digest: bindingDigest,
    producer_key: producerKey,
    canonical_packet_bytes: canonicalSerialize(packet)
  });
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
CREATE TRIGGER v3_receipts_require_chain_digest BEFORE INSERT ON receipts
WHEN NOT EXISTS (
  SELECT 1 FROM receipt_chain_digests
  WHERE receipt_id = NEW.receipt_id
    AND run_id = NEW.run_id
    AND sequence = NEW.sequence
)
BEGIN SELECT RAISE(ABORT, 'GPR_V3_RECEIPT_SIDECAR_REQUIRED'); END;
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
  JOIN receipt_chain_digests old_receipt_chain
    ON old_receipt_chain.receipt_id = old_receipt_tip.receipt_id
   AND old_receipt_chain.run_id = old_receipt_tip.run_id
   AND old_receipt_chain.sequence = old_receipt_tip.sequence
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
    AND old_receipt_chain.receipt_id = json_extract(NEW.pre_recovery_evidence_json, '$.old_receipt_tip_id')
    AND old_receipt_chain.run_id = json_extract(NEW.pre_recovery_evidence_json, '$.old_run_id')
    AND old_receipt_chain.sequence = json_extract(NEW.pre_recovery_evidence_json, '$.old_receipt_tip_sequence')
    AND old_receipt_chain.chain_digest = json_extract(NEW.pre_recovery_evidence_json, '$.old_receipt_chain_digest')
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
const AUTHORITY_PACKET_SCHEMA_SQL = `
CREATE TABLE authority_packets (
  packet_id TEXT PRIMARY KEY CHECK (
    length(packet_id) = 68
    AND substr(packet_id, 1, 4) = 'ap1-'
    AND substr(packet_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  producer_key TEXT UNIQUE NOT NULL CHECK (
    length(producer_key) = 64
    AND producer_key NOT GLOB '*[^0-9a-f]*'
  ),
  packet_digest TEXT NOT NULL CHECK (
    length(packet_digest) = 64
    AND packet_digest NOT GLOB '*[^0-9a-f]*'
  ),
  content_digest TEXT NOT NULL CHECK (
    length(content_digest) = 64
    AND content_digest NOT GLOB '*[^0-9a-f]*'
  ),
  binding_digest TEXT NOT NULL CHECK (
    length(binding_digest) = 64
    AND binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  canonical_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE authority_packet_events (
  event_id TEXT PRIMARY KEY CHECK (
    length(event_id) = 64
    AND event_id NOT GLOB '*[^0-9a-f]*'
  ),
  packet_id TEXT NOT NULL REFERENCES authority_packets(packet_id),
  event_key TEXT UNIQUE NOT NULL CHECK (
    length(event_key) = 64
    AND event_key NOT GLOB '*[^0-9a-f]*'
  ),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  prior_event_id TEXT REFERENCES authority_packet_events(event_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'READBACK_VERIFIED', 'WEB_ACCEPTANCE_BOUND', 'CURRENT_READBACK',
    'CONSUMER_COMPLETED', 'FINALITY_OBSERVED', 'BACKFILL_AUTHORISED'
  )),
  canonical_json TEXT NOT NULL,
  UNIQUE(packet_id, sequence)
) STRICT;
CREATE TABLE semantic_gate_admissions (
  admission_id TEXT PRIMARY KEY,
  consumer_key TEXT UNIQUE NOT NULL,
  canonical_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE semantic_gate_admission_events (
  event_id TEXT PRIMARY KEY CHECK (
    length(event_id) = 64
    AND event_id NOT GLOB '*[^0-9a-f]*'
  ),
  admission_id TEXT NOT NULL REFERENCES semantic_gate_admissions(admission_id),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  prior_event_id TEXT REFERENCES semantic_gate_admission_events(event_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'DISPATCH_INTENT', 'DISPATCH_CONFIRMED', 'DISPATCH_NOT_STARTED', 'CONSUMER_COMPLETED'
  )),
  canonical_json TEXT NOT NULL,
  UNIQUE(admission_id, sequence)
) STRICT;
CREATE INDEX authority_packet_events_packet_sequence ON authority_packet_events(packet_id, sequence);
CREATE INDEX semantic_gate_admission_events_admission_sequence ON semantic_gate_admission_events(admission_id, sequence);
CREATE TRIGGER authority_packets_no_update BEFORE UPDATE ON authority_packets BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER authority_packets_no_delete BEFORE DELETE ON authority_packets BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER authority_packets_no_replace BEFORE INSERT ON authority_packets
WHEN EXISTS (
  SELECT 1 FROM authority_packets
  WHERE packet_id = NEW.packet_id OR producer_key = NEW.producer_key OR packet_digest = NEW.packet_digest
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER authority_packet_events_no_update BEFORE UPDATE ON authority_packet_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER authority_packet_events_no_delete BEFORE DELETE ON authority_packet_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER authority_packet_events_no_replace BEFORE INSERT ON authority_packet_events
WHEN EXISTS (
  SELECT 1 FROM authority_packet_events
  WHERE event_id = NEW.event_id OR event_key = NEW.event_key
     OR (packet_id = NEW.packet_id AND sequence = NEW.sequence)
     OR (NEW.prior_event_id IS NOT NULL AND prior_event_id = NEW.prior_event_id)
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER authority_packet_events_chain_guard BEFORE INSERT ON authority_packet_events
WHEN NEW.sequence != 1 AND (
  NEW.prior_event_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM authority_packet_events prior
    WHERE prior.event_id = NEW.prior_event_id
      AND prior.packet_id = NEW.packet_id
      AND prior.sequence = NEW.sequence - 1
  )
)
OR NEW.sequence = 1 AND NEW.prior_event_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'GPR_PACKET_EVENT_CHAIN'); END;
CREATE TRIGGER semantic_gate_admissions_no_update BEFORE UPDATE ON semantic_gate_admissions BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER semantic_gate_admissions_no_delete BEFORE DELETE ON semantic_gate_admissions BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER semantic_gate_admissions_no_replace BEFORE INSERT ON semantic_gate_admissions
WHEN EXISTS (
  SELECT 1 FROM semantic_gate_admissions
  WHERE admission_id = NEW.admission_id OR consumer_key = NEW.consumer_key
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER semantic_gate_admission_events_no_update BEFORE UPDATE ON semantic_gate_admission_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER semantic_gate_admission_events_no_delete BEFORE DELETE ON semantic_gate_admission_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER semantic_gate_admission_events_no_replace BEFORE INSERT ON semantic_gate_admission_events
WHEN EXISTS (
  SELECT 1 FROM semantic_gate_admission_events
  WHERE event_id = NEW.event_id
     OR (admission_id = NEW.admission_id AND sequence = NEW.sequence)
     OR (NEW.prior_event_id IS NOT NULL AND prior_event_id = NEW.prior_event_id)
)
BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;
CREATE TRIGGER semantic_gate_admission_events_chain_guard BEFORE INSERT ON semantic_gate_admission_events
WHEN NEW.sequence != 1 AND (
  NEW.prior_event_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM semantic_gate_admission_events prior
    WHERE prior.event_id = NEW.prior_event_id
      AND prior.admission_id = NEW.admission_id
      AND prior.sequence = NEW.sequence - 1
  )
)
OR NEW.sequence = 1 AND NEW.prior_event_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'GPR_PACKET_EVENT_CHAIN'); END;
`;
const FINAL_AUTHORITY_PACKET_SCHEMA_SQL = `${SCHEMA_SQL}\n${AUTHORITY_PACKET_SCHEMA_SQL}`;
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
const AUTHORITY_PACKET_MIGRATION_STEPS = Object.freeze([
  Object.freeze({ step: 1, action: 'RECOGNIZE_EXACT_CANONICAL_V2' }),
  Object.freeze({ step: 2, action: 'VERIFY_NAMESPACE_INTEGRITY_FK_HISTORICAL_DIGESTS_AND_CHAIN' }),
  Object.freeze({ step: 3, action: 'CHECK_MIGRATION_QUIESCENCE' }),
  Object.freeze({ step: 4, action: 'BEGIN_IMMEDIATE' }),
  Object.freeze({ step: 5, action: 'REVERIFY_V2_SOURCE_INSIDE_TRANSACTION' }),
  Object.freeze({ step: 6, action: 'REMOVE_METADATA_NO_UPDATE' }),
  Object.freeze({ step: 7, action: 'ADD_AUTHORITY_PACKET_TABLES_INDEXES_AND_GUARDS' }),
  Object.freeze({ step: 8, action: 'WRITE_EXPECTED_AUTHORITY_PACKET_FINGERPRINT' }),
  Object.freeze({ step: 9, action: 'RESTORE_METADATA_NO_UPDATE' }),
  Object.freeze({ step: 10, action: 'SET_USER_VERSION_4' }),
  Object.freeze({ step: 11, action: 'VERIFY_EXACT_AUTHORITY_PACKET_SCHEMA_FINGERPRINT' }),
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
let expectedAuthorityPacketSchemaFingerprintCache = null;

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

function expectedAuthorityPacketSchemaFingerprint(DatabaseSync) {
  if (expectedAuthorityPacketSchemaFingerprintCache) return expectedAuthorityPacketSchemaFingerprintCache;
  const Constructor = sqliteDatabaseConstructor(DatabaseSync);
  const db = new Constructor(':memory:');
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    db.exec(FINAL_AUTHORITY_PACKET_SCHEMA_SQL);
    expectedAuthorityPacketSchemaFingerprintCache = schemaFingerprint(db);
    return expectedAuthorityPacketSchemaFingerprintCache;
  } finally {
    db.close();
  }
}

function buildFinalV3SchemaSql() {
  return FINAL_V3_SCHEMA_SQL;
}

function buildAuthorityPacketSchemaSql() {
  return AUTHORITY_PACKET_SCHEMA_SQL;
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

function createAuthorityPacketDatabase(db, namespace, digest, now, expectedFingerprint) {
  transaction(db, () => {
    db.exec(FINAL_AUTHORITY_PACKET_SCHEMA_SQL);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    db.exec(`PRAGMA user_version=${AUTHORITY_PACKET_USER_VERSION}`);
    const fingerprint = schemaFingerprint(db);
    if (fingerprint !== expectedFingerprint) packetFail('GPR_PACKET_SCHEMA_UNAVAILABLE');
    db.prepare('INSERT INTO metadata VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(
      SCHEMA_ID, digest, namespace.repository, namespace.parent_issue, namespace.child_issue, fingerprint, now
    );
    db.prepare('INSERT INTO coordination_state VALUES (1, 0)').run();
  });
}

function parseAuthorityPacketJson(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch (_) { packetFail('GPR_PACKET_CONTENT_MISMATCH'); }
  let normalized;
  try { normalized = packetClosedClone(parsed); } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  try {
    if (canonicalSerialize(normalized) !== value) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  } catch (_) { packetFail('GPR_PACKET_CONTENT_MISMATCH'); }
  return normalized;
}

function packetValidateEventPayload(eventType, payload) {
  let normalized;
  try { normalized = packetClosedClone(payload); } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  if (!isRecord(normalized)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  if (eventType === 'READBACK_VERIFIED') {
    if (!exactKeys(normalized, ['namespace_digest', 'store_identity_digest', 'runtime_identity_digest', 'challenge'])
      || !isDigest(normalized.namespace_digest) || !isDigest(normalized.store_identity_digest)
      || !isDigest(normalized.runtime_identity_digest) || !/^[a-f0-9]{64}$/.test(normalized.challenge)) {
      packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
  } else if (eventType === 'CURRENT_READBACK') {
    if (!exactKeys(normalized, ['projection_digest', 'body_digest', 'revision', 'acceptance_event_ids'])
      || !isDigest(normalized.projection_digest) || !isDigest(normalized.body_digest)
      || !Number.isSafeInteger(normalized.revision) || normalized.revision < 1
      || !Array.isArray(normalized.acceptance_event_ids)
      || normalized.acceptance_event_ids.length > AUTHORITY_PACKET_LIMITS.currentPredecessors
      || !packetSortedUnique(normalized.acceptance_event_ids)
      || normalized.acceptance_event_ids.some((value) => !isDigest(value))) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  } else if (eventType === 'FINALITY_OBSERVED') {
    if (!exactKeys(normalized, ['boundary', 'authority_ref', 'dependent_consumers_complete'])
      || !['CHILD', 'CANDIDATE'].includes(normalized.boundary)
      || typeof normalized.dependent_consumers_complete !== 'boolean') packetFail('GPR_PACKET_CONTENT_MISMATCH');
    packetValidateSourceReference(normalized.authority_ref, 'GPR_PACKET_CONTENT_MISMATCH');
  } else if (eventType === 'BACKFILL_AUTHORISED') {
    if (!exactKeys(normalized, ['authority_ref', 'source_ref', 'source_packet_digest', 'source_binding_digest'])
      || !isDigest(normalized.source_packet_digest)
      || !isDigest(normalized.source_binding_digest)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    packetValidateSourceReference(normalized.authority_ref, 'GPR_PACKET_CONTENT_MISMATCH');
    packetValidateSourceReference(normalized.source_ref, 'GPR_PACKET_CONTENT_MISMATCH');
  } else if (eventType === 'WEB_ACCEPTANCE_BOUND') {
    if (!exactKeys(normalized, [
      'schema', 'packet_id', 'packet_digest', 'binding_digest', 'web_source',
      'disposition', 'permitted_consumers', 'applicability', 'readback_event_id'
    ]) || normalized.schema !== 'toolkit.github-program.authority-packet-acceptance.v1'
      || !AUTHORITY_PACKET_ID_PATTERN.test(normalized.packet_id)
      || !isDigest(normalized.packet_digest) || !isDigest(normalized.binding_digest)
      || normalized.disposition !== 'ACCEPTED_FOR_CONSUMPTION'
      || !Array.isArray(normalized.permitted_consumers)
      || normalized.permitted_consumers.length > AUTHORITY_PACKET_LIMITS.requiredConsumers
      || !isDigest(normalized.readback_event_id)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    packetValidateSourceReference(normalized.web_source, 'GPR_PACKET_CONTENT_MISMATCH');
    packetValidateApplicability(normalized.applicability, 'G2');
    for (const consumer of normalized.permitted_consumers) {
      if (!exactKeys(consumer, AUTHORITY_PACKET_CONSUMER_KEYS)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
  } else if (eventType === 'CONSUMER_COMPLETED') {
    if (!exactKeys(normalized, ['admission_id', 'consumer', 'outcome_ref'])
      || !packetSafeContractId(normalized.admission_id) || !isDigest(normalized.outcome_ref)
      || !isRecord(normalized.consumer)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  } else {
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  assertAuthorityPacketPrivacy(normalized);
  return normalized;
}

function packetValidateEventBinding(db, packetId, eventType, payload) {
  const row = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
  if (!row) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  let identities;
  try { identities = authorityPacketIdentities(parseAuthorityPacketJson(row.canonical_json)); } catch (_) {
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  if (eventType === 'WEB_ACCEPTANCE_BOUND') {
    if (payload.packet_id !== identities.packet_id || payload.packet_digest !== identities.packet_digest
      || payload.binding_digest !== identities.binding_digest) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    const declared = new Set(identities.packet.bindings.applicability.required_consumers.map((item) =>
      `${item.class}\u0000${item.dependency_id}\u0000${item.scope_digest}`));
    for (const consumer of payload.permitted_consumers) {
      if (!declared.has(`${consumer.class}\u0000${consumer.dependency_id}\u0000${consumer.scope_digest}`)) {
        packetFail('GPR_PACKET_CONTENT_MISMATCH');
      }
    }
    const readback = db.prepare(
      'SELECT event_id FROM authority_packet_events WHERE packet_id = ? AND event_id = ? AND event_type = ?'
    ).get(packetId, payload.readback_event_id, 'READBACK_VERIFIED');
    if (!readback) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  } else if (eventType === 'CURRENT_READBACK') {
    for (const eventId of payload.acceptance_event_ids) {
      const acceptance = db.prepare(
        'SELECT event_id FROM authority_packet_events WHERE packet_id = ? AND event_id = ? AND event_type = ?'
      ).get(packetId, eventId, 'WEB_ACCEPTANCE_BOUND');
      if (!acceptance) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
  } else if (eventType === 'BACKFILL_AUTHORISED') {
    if (payload.source_packet_digest !== identities.packet_digest
      || payload.source_binding_digest !== identities.binding_digest
      || canonicalSerialize(payload.authority_ref) !== canonicalSerialize(identities.packet.bindings.authority)) {
      packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
  } else if (eventType === 'FINALITY_OBSERVED'
    && canonicalSerialize(payload.authority_ref) !== canonicalSerialize(identities.packet.bindings.authority)) {
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  return true;
}

function packetEventObject(packetId, sequence, priorEventId, eventType, payload, createdAt) {
  const event = {
    schema: AUTHORITY_PACKET_EVENT_SCHEMA_ID,
    packet_id: packetId,
    sequence,
    prior_event_id: priorEventId,
    event_type: eventType,
    payload,
    created_at: createdAt
  };
  return deepFreeze(event);
}

function packetEventKey(packetId, eventType, payload) {
  return digestValue({ schema: AUTHORITY_PACKET_EVENT_SCHEMA_ID, packet_id: packetId, event_type: eventType, payload });
}

function verifyAuthorityPacketEventRows(db) {
  const rows = db.prepare('SELECT * FROM authority_packet_events ORDER BY packet_id, sequence').all();
  const byPacket = new Map();
  const eventKeys = new Set();
  for (const row of rows) {
    if (!AUTHORITY_PACKET_ID_PATTERN.test(row.packet_id) || !isDigest(row.event_id) || !isDigest(row.event_key)
      || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || !AUTHORITY_PACKET_EVENT_TYPES.includes(row.event_type)) {
      packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
    const event = parseAuthorityPacketJson(row.canonical_json);
    if (!exactKeys(event, ['schema', 'packet_id', 'sequence', 'prior_event_id', 'event_type', 'payload', 'created_at'])
      || event.schema !== AUTHORITY_PACKET_EVENT_SCHEMA_ID || event.packet_id !== row.packet_id
      || event.sequence !== row.sequence || event.prior_event_id !== row.prior_event_id
      || event.event_type !== row.event_type || !isTimestamp(event.created_at)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    if (event.prior_event_id !== null && !isDigest(event.prior_event_id)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    packetValidateEventPayload(event.event_type, event.payload);
    packetValidateEventBinding(db, row.packet_id, event.event_type, event.payload);
    if (row.event_id !== digestValue(event)
      || row.event_key !== packetEventKey(row.packet_id, row.event_type, event.payload)
      || eventKeys.has(row.event_key)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    eventKeys.add(row.event_key);
    const prior = byPacket.get(row.packet_id) || [];
    const expectedSequence = prior.length + 1;
    const expectedPrior = prior.length ? prior[prior.length - 1].event_id : null;
    if (row.sequence !== expectedSequence || row.prior_event_id !== expectedPrior
      || Date.parse(event.created_at) < Date.parse(prior.length ? prior[prior.length - 1].created_at : event.created_at)) {
      packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
    prior.push({ ...row, ...event });
    byPacket.set(row.packet_id, prior);
  }
  return rows.length;
}

function verifySemanticGateAdmissionRows(db) {
  const admissions = db.prepare('SELECT * FROM semantic_gate_admissions ORDER BY admission_id').all();
  const admissionIds = new Set();
  for (const row of admissions) {
    if (!row.admission_id || typeof row.admission_id !== 'string' || !row.consumer_key
      || typeof row.consumer_key !== 'string' || admissionIds.has(row.admission_id)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    const value = validateSemanticGateAdmission(parseAuthorityPacketJson(row.canonical_json));
    if (!isRecord(value) || value.admission_id !== row.admission_id || value.consumer_key !== row.consumer_key
      || row.canonical_json !== canonicalSerialize(value)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    if (isTimestamp(row.created_at) === false) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    admissionIds.add(row.admission_id);
  }
  const events = db.prepare('SELECT * FROM semantic_gate_admission_events ORDER BY admission_id, sequence').all();
  const byAdmission = new Map();
  for (const row of events) {
    if (!admissionIds.has(row.admission_id) || !isDigest(row.event_id)
      || !Number.isSafeInteger(row.sequence) || row.sequence < 1
      || !SEMANTIC_GATE_ADMISSION_EVENT_TYPES.includes(row.event_type)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    const event = parseAuthorityPacketJson(row.canonical_json);
    if (!exactKeys(event, [
      'schema', 'admission_id', 'sequence', 'prior_event_id', 'event_type',
      'created_at', 'transport_evidence_digest'
    ]) || event.schema !== SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID
      || event.admission_id !== row.admission_id || event.sequence !== row.sequence
      || event.prior_event_id !== row.prior_event_id || event.event_type !== row.event_type
      || !isTimestamp(event.created_at) || !isDigest(event.transport_evidence_digest)
      || row.event_id !== digestValue(event)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    const prior = byAdmission.get(row.admission_id) || [];
    if (row.sequence !== prior.length + 1 || row.prior_event_id !== (prior.length ? prior[prior.length - 1].event_id : null)) {
      packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
    prior.push({ ...row, ...event });
    byAdmission.set(row.admission_id, prior);
  }
  return { admissions: admissions.length, events: events.length };
}

function verifyAuthorityPacketDurableEvidence(db, namespace, expectedNamespaceDigest, databasePath) {
  const canonicalNamespace = namespaceValue(namespace);
  if (namespaceDigest(canonicalNamespace) !== expectedNamespaceDigest) packetFail('GPR_PACKET_STORE_IDENTITY_MISMATCH');
  try {
    verifyRowDigests(db);
    const runIds = db.prepare('SELECT run_id FROM runs ORDER BY run_id').all();
    for (const row of runIds) readChainDb(db, row.run_id, true);
  } catch (error) {
    if (error instanceof GprError) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  const packetRows = db.prepare('SELECT * FROM authority_packets ORDER BY packet_id').all();
  const producerKeys = new Set();
  for (const row of packetRows) {
    if (!AUTHORITY_PACKET_ID_PATTERN.test(row.packet_id) || !isDigest(row.producer_key)
      || !isDigest(row.packet_digest) || !isDigest(row.content_digest) || !isDigest(row.binding_digest)
      || !isTimestamp(row.created_at)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    let identities;
    try { identities = authorityPacketIdentities(parseAuthorityPacketJson(row.canonical_json)); } catch (error) {
      if (error instanceof GprError) packetFail('GPR_PACKET_CONTENT_MISMATCH');
      packetFail('GPR_PACKET_CONTENT_MISMATCH');
    }
    if (row.packet_id !== identities.packet_id || row.producer_key !== identities.producer_key
      || row.packet_digest !== identities.packet_digest || row.content_digest !== identities.content_digest
      || row.binding_digest !== identities.binding_digest || row.canonical_json !== identities.canonical_packet_bytes
      || identities.packet.bindings.repository !== canonicalNamespace.repository
      || identities.packet.bindings.parent_issue !== canonicalNamespace.parent_issue
      || identities.packet.bindings.child_issue !== canonicalNamespace.child_issue
      || producerKeys.has(row.producer_key)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    producerKeys.add(row.producer_key);
  }
  verifyAuthorityPacketEventRows(db);
  verifySemanticGateAdmissionRows(db);
  if (databasePath && fs.statSync(databasePath).size > LIMITS.databaseBytes) packetFail('GPR_PACKET_LIMIT');
  return true;
}

function packetValidateCurrentConsumer(value, code = 'GPR_PACKET_CURRENT_UNVERIFIED') {
  if (!isRecord(value) || !exactKeys(value, ['run', 'lock', 'stage', 'role', 'scope_digest'])
    || !packetSafeContractId(value.run) || !packetSafeContractId(value.lock)
    || !AUTHORITY_PACKET_CONSUMER_CLASSES.includes(value.stage) || value.role !== value.stage
    || !isDigest(value.scope_digest)) packetFail(code);
  return value;
}

function packetValidateCurrentPredecessor(value, code = 'GPR_PACKET_CURRENT_UNVERIFIED') {
  if (!isRecord(value) || !exactKeys(value, [
    'packet_id', 'packet_digest', 'content_digest', 'binding_digest', 'producer', 'candidate',
    'dependency_id', 'acceptance_event_id', 'web_source', 'readback_event_id', 'store_identity_digest'
  ]) || !AUTHORITY_PACKET_ID_PATTERN.test(value.packet_id)
    || value.packet_id !== `ap1-${value.packet_digest}` || !isDigest(value.packet_digest)
    || !isDigest(value.content_digest) || !isDigest(value.binding_digest)
    || !isRecord(value.producer) || !isSafeId(value.dependency_id)
    || !isDigest(value.acceptance_event_id) || !isDigest(value.readback_event_id)
    || !isDigest(value.store_identity_digest)) packetFail(code);
  packetValidateProducer(value.producer);
  if (value.candidate !== null) {
    try { validateCandidate(value.candidate); } catch (_) { packetFail(code); }
  }
  packetValidateSourceReference(value.web_source, code);
  return value;
}

function validateAuthorityPacketCurrent(value) {
  let normalized;
  try { normalized = packetClosedClone(value); } catch (_) { packetFail('GPR_PACKET_CURRENT_UNVERIFIED'); }
  if (!isRecord(normalized) || !exactKeys(normalized, [
    'schema', 'repository', 'parent_issue', 'child_issue', 'lane_id', 'human_owner',
    'consumer', 'authority', 'candidate', 'predecessors'
  ]) || normalized.schema !== AUTHORITY_PACKET_CURRENT_SCHEMA_ID
    || !isCanonicalRepository(normalized.repository)
    || !Number.isSafeInteger(normalized.parent_issue) || normalized.parent_issue < 1
    || !Number.isSafeInteger(normalized.child_issue) || normalized.child_issue < 1
    || !packetSafeContractId(normalized.lane_id)
    || typeof normalized.human_owner !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(normalized.human_owner)
    || !Array.isArray(normalized.predecessors)
    || normalized.predecessors.length > AUTHORITY_PACKET_LIMITS.currentPredecessors
    || Buffer.byteLength(canonicalSerialize(normalized), 'utf8') > AUTHORITY_PACKET_LIMITS.currentProjectionBytes) {
    packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  }
  packetValidateCurrentConsumer(normalized.consumer);
  packetValidateSourceReference(normalized.authority, 'GPR_PACKET_CURRENT_UNVERIFIED');
  if (normalized.authority.repository !== normalized.repository
    || normalized.authority.issue_number !== normalized.child_issue
    || normalized.authority.author_login !== normalized.human_owner) {
    packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  }
  if (normalized.candidate !== null) {
    try { validateCandidate(normalized.candidate); } catch (_) { packetFail('GPR_PACKET_CURRENT_UNVERIFIED'); }
  }
  let previous;
  const dependencies = new Set();
  for (const predecessor of normalized.predecessors) {
    packetValidateCurrentPredecessor(predecessor);
    if (dependencies.has(predecessor.dependency_id)
      || previous !== undefined && predecessor.dependency_id <= previous) {
      packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
    }
    dependencies.add(predecessor.dependency_id);
    previous = predecessor.dependency_id;
  }
  return deepFreeze(normalized);
}

function validateAuthorityPacketAcceptance(value) {
  let normalized;
  try { normalized = packetClosedClone(value); } catch (_) { packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED'); }
  if (!isRecord(normalized) || !exactKeys(normalized, [
    'schema', 'packet_id', 'packet_digest', 'binding_digest', 'web_source', 'disposition',
    'permitted_consumers', 'applicability', 'readback_event_id'
  ]) || normalized.schema !== AUTHORITY_PACKET_ACCEPTANCE_SCHEMA_ID
    || !AUTHORITY_PACKET_ID_PATTERN.test(normalized.packet_id)
    || normalized.packet_id !== `ap1-${normalized.packet_digest}`
    || !isDigest(normalized.packet_digest) || !isDigest(normalized.binding_digest)
    || normalized.disposition !== 'ACCEPTED_FOR_CONSUMPTION'
    || !Array.isArray(normalized.permitted_consumers)
    || normalized.permitted_consumers.length > AUTHORITY_PACKET_LIMITS.requiredConsumers
    || !isDigest(normalized.readback_event_id)) packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  packetValidateSourceReference(normalized.web_source, 'GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  try { packetValidateApplicability(normalized.applicability, 'GPR_PACKET_ACCEPTANCE_UNVERIFIED'); } catch (_) {
    packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  }
  let previous;
  const seen = new Set();
  for (const consumer of normalized.permitted_consumers) {
    if (!isRecord(consumer) || !exactKeys(consumer, AUTHORITY_PACKET_CONSUMER_KEYS)
      || !AUTHORITY_PACKET_CONSUMER_CLASSES.includes(consumer.class)
      || !packetSafeContractId(consumer.dependency_id) || !isDigest(consumer.scope_digest)) {
      packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
    }
    const identity = `${consumer.class}\u0000${consumer.dependency_id}\u0000${consumer.scope_digest}`;
    if (seen.has(identity) || previous !== undefined && identity <= previous) packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
    seen.add(identity);
    previous = identity;
  }
  return deepFreeze(normalized);
}

function packetRequireReaderSet(boundReaders, suppliedReaders, required = []) {
  if (!boundReaders) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  if (suppliedReaders !== boundReaders) {
    const owner = suppliedReaders && AUTHORITY_PACKET_READER_OWNERS.get(suppliedReaders);
    if (!owner || owner.bound !== boundReaders || !authorityPacketReadersUnchanged(suppliedReaders, owner)) {
      packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    }
  }
  validateAuthorityPacketReaders(boundReaders, required.includes('screenPacket'));
  for (const key of required) if (typeof boundReaders[key] !== 'function') packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  return boundReaders;
}

function packetReadAuthorityObservation(readers, argument) {
  const raw = callTrustedReaderSync(readers.readAuthority, argument, 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  if (!isRecord(raw)) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  const source = raw.authority || raw.source || raw;
  try { packetValidateSourceReference(packetClosedClone(source), 'GPR_PACKET_AUTHORITY_UNVERIFIED'); } catch (_) {
    packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  if (Array.isArray(raw.later_controlling_comments) && raw.later_controlling_comments.length > 0) {
    packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  const declared = raw.required_consumers || raw.consumer_dependencies
    || raw.applicability && raw.applicability.required_consumers;
  if (declared !== undefined && !Array.isArray(declared)) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  return {
    raw,
    source: packetClosedClone(source),
    required_consumers: declared ? packetClosedClone(declared) : null,
    no_predecessor: raw.no_predecessor_classification === true
      || raw.no_predecessor === true || raw.dependency_state === 'NO_PREDECESSOR'
  };
}

function packetReadCandidateObservation(readers, argument, fallback) {
  if (typeof readers.readCandidate !== 'function') {
    return { candidate: fallback === undefined ? null : fallback, candidate_reuse: false };
  }
  const raw = callTrustedReaderSync(readers.readCandidate, argument, 'GPR_PACKET_BINDING_MISMATCH');
  const candidate = isRecord(raw) && Object.hasOwn(raw, 'candidate') ? raw.candidate : raw;
  if (candidate !== null) {
    try { validateCandidate(candidate); } catch (_) { packetFail('GPR_PACKET_BINDING_MISMATCH'); }
  }
  return {
    candidate,
    candidate_reuse: isRecord(raw) && raw.candidate_reuse === true
  };
}

function packetCandidateReusePermitted(candidateObservation, previousCandidates, candidate) {
  for (const previous of previousCandidates) {
    if (canonicalSerialize(previous) === canonicalSerialize(candidate)) continue;
    if (!candidateObservation || candidateObservation.candidate_reuse !== true) {
      packetFail('GPR_PACKET_BINDING_MISMATCH');
    }
  }
}

function packetReadCurrentObservation(readers, argument) {
  const raw = callTrustedReaderSync(readers.readCurrent, argument, 'GPR_PACKET_CURRENT_UNVERIFIED');
  if (!isRecord(raw)) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  const projection = raw.current || raw.projection || raw;
  let current;
  try { current = validateAuthorityPacketCurrent(projection); } catch (_) {
    packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  }
  const revision = raw.revision !== undefined ? raw.revision : raw.current_revision;
  const bodyDigest = raw.body_digest;
  const projectionDigest = raw.projection_digest || digestValue(current);
  if (!isDigest(bodyDigest) || !isDigest(projectionDigest) || projectionDigest !== digestValue(current)
    || !(Number.isSafeInteger(revision) && revision >= 1 || typeof revision === 'string' && revision.length > 0)) {
    packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  }
  return deepFreeze({ current, projection_digest: projectionDigest, body_digest: bodyDigest, revision });
}

function packetConsumerIntent(value, authority, candidate) {
  if (!isRecord(value)) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  const consumer = value.consumer || {
    run: value.run,
    lock: value.lock,
    stage: value.stage,
    role: value.role,
    scope_digest: value.scope_digest
  };
  try { packetValidateCurrentConsumer(consumer, 'GPR_PACKET_ADMISSION_REQUIRED'); } catch (_) {
    packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  }
  const result = {
    repository: value.repository,
    parent_issue: value.parent_issue,
    child_issue: value.child_issue,
    lane_id: value.lane_id,
    human_owner: value.human_owner,
    consumer: packetClosedClone(consumer),
    authority: packetClosedClone(authority),
    candidate: candidate === undefined ? null : candidate,
    execution_binding: value.execution_binding
  };
  if (!isCanonicalRepository(result.repository)
    || !Number.isSafeInteger(result.parent_issue) || result.parent_issue < 1
    || !Number.isSafeInteger(result.child_issue) || result.child_issue < 1
    || !packetSafeContractId(result.lane_id)
    || typeof result.human_owner !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(result.human_owner)
    || result.authority.repository !== result.repository
    || result.authority.issue_number !== result.child_issue
    || result.authority.author_login !== result.human_owner) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  if (result.candidate !== null) {
    try { validateCandidate(result.candidate); } catch (_) { packetFail('GPR_PACKET_ADMISSION_REQUIRED'); }
  }
  if (!isRecord(result.execution_binding) || !exactKeys(result.execution_binding, [
    'semantic_run', 'receipt_run_id', 'loop_run_id', 'repository_id', 'authorized_ref_digest', 'current_authority_digest'
  ]) || ![null, undefined].includes(result.execution_binding.semantic_run)
    && !packetSafeContractId(result.execution_binding.semantic_run)
    || ![null, undefined].includes(result.execution_binding.receipt_run_id)
    && !packetSafeContractId(result.execution_binding.receipt_run_id)
    || ![null, undefined].includes(result.execution_binding.loop_run_id)
    && !packetSafeContractId(result.execution_binding.loop_run_id)
    || !isDigest(result.execution_binding.repository_id)
    || !isDigest(result.execution_binding.authorized_ref_digest)
    || !isDigest(result.execution_binding.current_authority_digest)) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  return deepFreeze(result);
}

function packetReadEventsDb(db, packetId) {
  return db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence').all(packetId).map((row) => {
    const event = parseAuthorityPacketJson(row.canonical_json);
    if (!exactKeys(event, ['schema', 'packet_id', 'sequence', 'prior_event_id', 'event_type', 'payload', 'created_at'])
      || row.event_id !== digestValue(event) || event.packet_id !== packetId) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    return { ...row, ...event };
  });
}

function packetReadIdentityDb(db, packetId) {
  const row = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
  if (!row) packetFail('GPR_PACKET_NOT_FOUND');
  let identities;
  try {
    identities = readAuthorityPacketRow(db, packetId, authorityPacketIdentities(parseAuthorityPacketJson(row.canonical_json)).packet.bindings);
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  return identities;
}

function packetFindEvent(events, eventId, eventType) {
  const event = events.find((item) => item.event_id === eventId && (!eventType || item.event_type === eventType));
  if (!event) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  return event;
}

function packetReadbackPayload(delivery) {
  return {
    namespace_digest: delivery.envelope.namespace_digest,
    store_identity_digest: delivery.envelope.store_identity_digest,
    runtime_identity_digest: delivery.envelope.runtime_identity_digest,
    challenge: delivery.envelope.challenge
  };
}

function packetAppendReadbackEvent(config, packetId, delivery) {
  const db = openAuthorityPacketVerified(config, false, false);
  try {
    return transaction(db, () => appendAuthorityPacketEventDb(
      db, packetId, 'READBACK_VERIFIED', packetReadbackPayload(delivery), isoAt()
    ));
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_WRITE_FAILED');
  } finally { db.close(); }
}

function packetAcceptanceFromDecision(packet, decision, readbackEventId) {
  if (!isRecord(decision)) packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  const identity = isRecord(decision.packet_identity) ? decision.packet_identity : decision;
  if (identity.packet_id !== packet.packet_id
    || identity.packet_digest !== packet.packet_digest
    || identity.binding_digest !== packet.binding_digest) {
    packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  }
  const source = decision.web_source || decision.source;
  const acceptance = {
    schema: AUTHORITY_PACKET_ACCEPTANCE_SCHEMA_ID,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    binding_digest: packet.binding_digest,
    web_source: source,
    disposition: decision.disposition,
    permitted_consumers: decision.permitted_consumers,
    applicability: decision.applicability,
    readback_event_id: readbackEventId
  };
  try { return validateAuthorityPacketAcceptance(acceptance); } catch (_) {
    packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  }
}

function packetBuildPredecessorDb(db, packetSpec, current, storeIdentity) {
  if (!isRecord(packetSpec) || !isSafeId(packetSpec.dependency_id)) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  const identities = packetReadIdentityDb(db, packetSpec.packet_id);
  const events = packetReadEventsDb(db, identities.packet_id);
  const acceptanceEvent = packetSpec.acceptance_event_id
    ? packetFindEvent(events, packetSpec.acceptance_event_id, 'WEB_ACCEPTANCE_BOUND')
    : events.find((item) => item.event_type === 'WEB_ACCEPTANCE_BOUND');
  if (!acceptanceEvent) packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  const acceptance = validateAuthorityPacketAcceptance(acceptanceEvent.payload);
  if (acceptance.packet_id !== identities.packet_id
    || acceptance.packet_digest !== identities.packet_digest
    || acceptance.binding_digest !== identities.binding_digest) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  const readback = packetFindEvent(events, acceptance.readback_event_id, 'READBACK_VERIFIED');
  const predecessor = {
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    content_digest: identities.content_digest,
    binding_digest: identities.binding_digest,
    producer: identities.packet.bindings.producer,
    candidate: identities.packet.bindings.candidate,
    dependency_id: packetSpec.dependency_id,
    acceptance_event_id: acceptanceEvent.event_id,
    web_source: acceptance.web_source,
    readback_event_id: readback.event_id,
    store_identity_digest: storeIdentity
  };
  packetValidateCurrentPredecessor(predecessor);
  return deepFreeze(predecessor);
}

function packetDeclaredConsumerIds(authorityObservation, current) {
  const declared = authorityObservation.required_consumers;
  if (!Array.isArray(declared)) {
    if (current.predecessors.length === 0 && authorityObservation.no_predecessor) return [];
    packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  }
  const values = declared.map((item) => {
    if (!isRecord(item) || !packetSafeContractId(item.dependency_id) || !AUTHORITY_PACKET_CONSUMER_CLASSES.includes(item.class)
      || !isDigest(item.scope_digest)) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
    return `${item.class}\u0000${item.dependency_id}\u0000${item.scope_digest}`;
  }).sort();
  return values;
}

function packetCurrentConsumerIds(current) {
  return current.predecessors.map((item) => `${current.consumer.stage}\u0000${item.dependency_id}\u0000${current.consumer.scope_digest}`).sort();
}

function packetVerifyCurrentReadbackDb(db, currentObservation, current) {
  if (current.predecessors.length === 0) return true;
  for (const predecessor of current.predecessors) {
    const events = packetReadEventsDb(db, predecessor.packet_id);
    const match = events.find((event) => event.event_type === 'CURRENT_READBACK'
        && event.payload.projection_digest === currentObservation.projection_digest
        && event.payload.body_digest === currentObservation.body_digest
        && event.payload.revision === currentObservation.revision
        && JSON.stringify(event.payload.acceptance_event_ids) === JSON.stringify([predecessor.acceptance_event_id]));
    if (!match) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  }
  return true;
}

function packetVerifySemanticDependencies(config, readers, consumerIntent, expected = {}) {
  const authorityObservation = packetReadAuthorityObservation(readers, consumerIntent);
  const currentObservation = packetReadCurrentObservation(readers, consumerIntent);
  const current = currentObservation.current;
  if (current.repository !== consumerIntent.repository || current.parent_issue !== consumerIntent.parent_issue
    || current.child_issue !== consumerIntent.child_issue || current.lane_id !== consumerIntent.lane_id
    || current.human_owner !== consumerIntent.human_owner
    || canonicalSerialize(current.authority) !== canonicalSerialize(authorityObservation.source)) {
    packetFail('GPR_PACKET_BINDING_MISMATCH');
  }
  const candidateObservation = packetReadCandidateObservation(readers, consumerIntent, current.candidate);
  const candidate = candidateObservation.candidate;
  packetCandidateReusePermitted(candidateObservation, current.predecessors.map((item) => item.candidate), candidate);
  if (canonicalSerialize(candidate) !== canonicalSerialize(current.candidate)) packetFail('GPR_PACKET_BINDING_MISMATCH');
  const consumer = packetConsumerIntent({ ...consumerIntent, candidate }, authorityObservation.source, candidate);
  if (canonicalSerialize(consumer.consumer) !== canonicalSerialize(current.consumer)) packetFail('GPR_PACKET_BINDING_MISMATCH');
  const declaredIds = packetDeclaredConsumerIds(authorityObservation, current);
  const currentIds = packetCurrentConsumerIds(current);
  if (JSON.stringify(declaredIds) !== JSON.stringify(currentIds)) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');

  const db = openAuthorityPacketVerified(config, false, true);
  try {
    const storeIdentity = authorityPacketStoreIdentityDb(db, config);
    packetVerifyCurrentReadbackDb(db, currentObservation, current);
    const predecessors = [];
    for (const predecessor of current.predecessors) {
      const identities = packetReadIdentityDb(db, predecessor.packet_id);
      if (identities.packet_id !== predecessor.packet_id || identities.packet_digest !== predecessor.packet_digest
        || identities.content_digest !== predecessor.content_digest || identities.binding_digest !== predecessor.binding_digest
        || identities.packet.bindings.repository !== current.repository
        || identities.packet.bindings.parent_issue !== current.parent_issue
        || identities.packet.bindings.child_issue !== current.child_issue
        || identities.packet.bindings.lane_id !== current.lane_id
        || identities.packet.bindings.human_owner !== current.human_owner
        || canonicalSerialize(identities.packet.bindings.producer) !== canonicalSerialize(predecessor.producer)
        || canonicalSerialize(identities.packet.bindings.candidate) !== canonicalSerialize(predecessor.candidate)
        || predecessor.store_identity_digest !== storeIdentity) packetFail('GPR_PACKET_BINDING_MISMATCH');
      const delivery = verifyAuthorityPacketFreshProcess(config, predecessor.packet_id, identities.packet.bindings);
      if (delivery.envelope.packet_digest !== identities.packet_digest
        || delivery.envelope.content_digest !== identities.content_digest
        || delivery.envelope.binding_digest !== identities.binding_digest
        || canonicalSerialize(delivery.packet) !== identities.canonical_packet_bytes) {
        packetFail('GPR_PACKET_READBACK_FAILED');
      }
      packetScreenPersistedPacket(readers, delivery.packet, identities.packet_digest);
      const events = packetReadEventsDb(db, predecessor.packet_id);
      const acceptanceEvent = packetFindEvent(events, predecessor.acceptance_event_id, 'WEB_ACCEPTANCE_BOUND');
      const acceptance = validateAuthorityPacketAcceptance(acceptanceEvent.payload);
      const readback = packetFindEvent(events, predecessor.readback_event_id, 'READBACK_VERIFIED');
      if (acceptance.readback_event_id !== readback.event_id) packetFail('GPR_PACKET_READBACK_FAILED');
      const decision = callTrustedReaderSync(readers.readWebDecision, predecessor, 'GPR_PACKET_ACCEPTANCE_UNVERIFIED');
      const observedAcceptance = packetAcceptanceFromDecision(identities, decision, readback.event_id);
      if (canonicalSerialize(observedAcceptance) !== canonicalSerialize(acceptance)) packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
      predecessors.push(predecessor);
    }
    const operation = expected.operation || consumerIntent.operation || current.consumer.stage;
    if (!packetSafeContractId(operation)) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
    const proof = {
      schema: 'toolkit.assurance-web-finality.receipt-dependency.v1',
      fresh: true,
      operation,
      consumer: { candidate, scope_digest: current.consumer.scope_digest },
      dependency_state: predecessors.length ? 'PREDECESSORS_VERIFIED' : 'NO_PREDECESSOR',
      checks: predecessors.length
        ? { packet: 'verified', acceptance: 'verified', current: 'verified' }
        : { packet: 'not_applicable', acceptance: 'not_applicable', current: 'verified' },
      current: {
        projection_digest: currentObservation.projection_digest,
        body_digest: currentObservation.body_digest,
        revision: currentObservation.revision
      },
      predecessors
    };
    return { consumer, currentObservation, proof, storeIdentity };
  } finally { db.close(); }
}

function authorityPacketStoreState(store) {
  const state = store && AUTHORITY_PACKET_STORE_OWNERS.get(store);
  if (!state || state.processId !== process.pid) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  return state;
}

function programmeReceiptStoreState(store) {
  const state = store && PROGRAMME_RECEIPT_STORE_OWNERS.get(store);
  if (!state || state.processId !== process.pid) fail('GPR_OWNERSHIP_LOST');
  return state;
}

function assertAuthenticAuthorityPacketStore(store) {
  return authorityPacketStoreState(store);
}

function semanticGateAdmissionState(store, admission) {
  const storeState = authorityPacketStoreState(store);
  const state = admission && SEMANTIC_GATE_OWNERS.get(admission);
  if (!state || state.storeInstanceId !== storeState.instanceId || state.processId !== process.pid) {
    packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  }
  return state;
}

function assertAuthenticSemanticGateAdmission(store, admission) {
  return semanticGateAdmissionState(store, admission);
}

function semanticGateEventObject(admissionId, sequence, priorEventId, eventType, transportEvidenceDigest, createdAt) {
  return deepFreeze({
    schema: SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID,
    admission_id: admissionId,
    sequence,
    prior_event_id: priorEventId,
    event_type: eventType,
    created_at: createdAt,
    transport_evidence_digest: transportEvidenceDigest
  });
}

function appendSemanticGateEventDb(db, admissionId, eventType, evidence) {
  if (!packetSafeContractId(admissionId) || !SEMANTIC_GATE_ADMISSION_EVENT_TYPES.includes(eventType)) {
    packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  }
  const row = db.prepare('SELECT * FROM semantic_gate_admissions WHERE admission_id = ?').get(admissionId);
  if (!row) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  const previous = db.prepare('SELECT * FROM semantic_gate_admission_events WHERE admission_id = ? ORDER BY sequence DESC LIMIT 1').get(admissionId);
  if (eventType === 'DISPATCH_INTENT') {
    if (previous && previous.event_type !== 'DISPATCH_NOT_STARTED') packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  } else if (eventType === 'DISPATCH_CONFIRMED' || eventType === 'DISPATCH_NOT_STARTED') {
    if (!previous || previous.event_type !== 'DISPATCH_INTENT') packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  } else if (eventType === 'CONSUMER_COMPLETED') {
    if (!previous || previous.event_type !== 'DISPATCH_CONFIRMED') packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  }
  const normalizedEvidence = packetClosedClone(evidence);
  assertAuthorityPacketPrivacy(normalizedEvidence);
  const transportEvidenceDigest = digestValue(normalizedEvidence);
  const sequence = previous ? previous.sequence + 1 : 1;
  const event = semanticGateEventObject(admissionId, sequence, previous ? previous.event_id : null, eventType, transportEvidenceDigest, isoAt());
  db.prepare('INSERT INTO semantic_gate_admission_events VALUES (?, ?, ?, ?, ?, ?)').run(
    digestValue(event), admissionId, sequence, event.prior_event_id, event.event_type, canonicalSerialize(event)
  );
  return deepFreeze({ event_id: digestValue(event), event_type: eventType, sequence, transport_evidence_digest: transportEvidenceDigest });
}

function packetScreenPersistedPacket(readers, packet, expectedDigest) {
  const screening = callTrustedReaderSync(readers.screenPacket, {
    packet,
    packet_digest: expectedDigest
  }, 'GPR_PACKET_PRIVACY_REJECTED');
  if (!isRecord(screening) || screening.packet_digest !== expectedDigest) packetFail('GPR_PACKET_PRIVACY_REJECTED');
  const allowed = screening.allowed === true || screening.decision === 'ALLOW' || screening.decision === 'ACCEPTED';
  if (!allowed) packetFail('GPR_PACKET_PRIVACY_REJECTED');
  for (const key of ['policy_digest', 'disclosure_policy_digest', 'retention_policy_digest']) {
    if (screening[key] !== undefined && !isDigest(screening[key])) packetFail('GPR_PACKET_PRIVACY_REJECTED');
  }
  try { assertAuthorityPacketPrivacy(screening); } catch (_) { packetFail('GPR_PACKET_PRIVACY_REJECTED'); }
  return screening;
}

function validateSemanticGateAdmission(value) {
  let normalized;
  try { normalized = packetClosedClone(value); } catch (_) { packetFail('GPR_PACKET_CONTENT_MISMATCH'); }
  if (!isRecord(normalized) || !exactKeys(normalized, [
    'schema', 'admission_id', 'consumer_key', 'consumer', 'repository', 'parent_issue', 'child_issue',
    'lane_id', 'human_owner', 'authority', 'candidate', 'scope_digest', 'current_projection_digest',
    'current_body_digest', 'current_revision', 'predecessors', 'execution_binding'
  ]) || normalized.schema !== SEMANTIC_GATE_ADMISSION_SCHEMA_ID
    || !packetSafeContractId(normalized.admission_id) || !isDigest(normalized.consumer_key)
    || !isCanonicalRepository(normalized.repository)
    || !Number.isSafeInteger(normalized.parent_issue) || normalized.parent_issue < 1
    || !Number.isSafeInteger(normalized.child_issue) || normalized.child_issue < 1
    || !packetSafeContractId(normalized.lane_id)
    || typeof normalized.human_owner !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(normalized.human_owner)
    || !isDigest(normalized.scope_digest) || !isDigest(normalized.current_projection_digest)
    || !isDigest(normalized.current_body_digest)
    || !(Number.isSafeInteger(normalized.current_revision) && normalized.current_revision >= 1
      || typeof normalized.current_revision === 'string' && normalized.current_revision.length > 0)
    || !Array.isArray(normalized.predecessors)
    || normalized.predecessors.length > AUTHORITY_PACKET_LIMITS.currentPredecessors) {
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  packetValidateCurrentConsumer(normalized.consumer, 'GPR_PACKET_CONTENT_MISMATCH');
  packetValidateSourceReference(normalized.authority, 'GPR_PACKET_CONTENT_MISMATCH');
  if (normalized.authority.repository !== normalized.repository
    || normalized.authority.issue_number !== normalized.child_issue
    || normalized.authority.author_login !== normalized.human_owner
    || normalized.scope_digest !== normalized.consumer.scope_digest) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  if (normalized.candidate !== null) {
    try { validateCandidate(normalized.candidate); } catch (_) { packetFail('GPR_PACKET_CONTENT_MISMATCH'); }
  }
  let previous;
  for (const predecessor of normalized.predecessors) {
    packetValidateCurrentPredecessor(predecessor, 'GPR_PACKET_CONTENT_MISMATCH');
    if (previous !== undefined && predecessor.dependency_id <= previous) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    previous = predecessor.dependency_id;
  }
  if (!isRecord(normalized.execution_binding) || !exactKeys(normalized.execution_binding, [
    'semantic_run', 'receipt_run_id', 'loop_run_id', 'repository_id', 'authorized_ref_digest', 'current_authority_digest'
  ]) || ![null, undefined].includes(normalized.execution_binding.semantic_run)
    && !packetSafeContractId(normalized.execution_binding.semantic_run)
    || ![null, undefined].includes(normalized.execution_binding.receipt_run_id)
    && !packetSafeContractId(normalized.execution_binding.receipt_run_id)
    || ![null, undefined].includes(normalized.execution_binding.loop_run_id)
    && !packetSafeContractId(normalized.execution_binding.loop_run_id)
    || !isDigest(normalized.execution_binding.repository_id)
    || !isDigest(normalized.execution_binding.authorized_ref_digest)
    || !isDigest(normalized.execution_binding.current_authority_digest)) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  const expectedConsumerKey = digestValue({
    repository: normalized.repository,
    parent_issue: normalized.parent_issue,
    child_issue: normalized.child_issue,
    lane_id: normalized.lane_id,
    consumer: normalized.consumer,
    candidate: normalized.candidate,
    scope_digest: normalized.consumer.scope_digest,
    execution_binding: normalized.execution_binding
  });
  if (normalized.consumer_key !== expectedConsumerKey) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  assertAuthorityPacketPrivacy(normalized);
  return deepFreeze(normalized);
}

function packetBuildAcceptance(config, boundReaders, packetId) {
  const db = openAuthorityPacketVerified(config, false, true);
  let identities;
  let events;
  let existing;
  try {
    identities = packetReadIdentityDb(db, packetId);
    events = packetReadEventsDb(db, packetId);
    existing = events.find((event) => event.event_type === 'WEB_ACCEPTANCE_BOUND');
  } finally { db.close(); }
  if (existing) {
    packetFindEvent(events, existing.payload.readback_event_id, 'READBACK_VERIFIED');
    packetScreenPersistedPacket(boundReaders, identities.packet, identities.packet_digest);
    const decision = callTrustedReaderSync(boundReaders.readWebDecision, {
      packet: identities.packet,
      packet_id: identities.packet_id,
      packet_digest: identities.packet_digest,
      binding_digest: identities.binding_digest
    }, 'GPR_PACKET_ACCEPTANCE_UNVERIFIED');
    const observed = packetAcceptanceFromDecision(identities, decision, existing.payload.readback_event_id);
    if (canonicalSerialize(observed) !== canonicalSerialize(existing.payload)) packetFail('GPR_PACKET_ACCEPTANCE_UNVERIFIED');
    return deepFreeze({ acceptance: existing.payload, acceptance_event_id: existing.event_id, duplicate: true });
  }
  const delivery = verifyAuthorityPacketFreshProcess(config, packetId, identities.packet.bindings);
  packetScreenPersistedPacket(boundReaders, delivery.packet, identities.packet_digest);
  const readback = packetAppendReadbackEvent(config, packetId, delivery);
  const decision = callTrustedReaderSync(boundReaders.readWebDecision, {
    packet: identities.packet,
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    binding_digest: identities.binding_digest,
    readback_event_id: readback.event_id
  }, 'GPR_PACKET_ACCEPTANCE_UNVERIFIED');
  const acceptance = packetAcceptanceFromDecision(identities, decision, readback.event_id);
  const dbWrite = openAuthorityPacketVerified(config, false, false);
  let event;
  try {
    event = transaction(dbWrite, () => appendAuthorityPacketEventDb(
      dbWrite, packetId, 'WEB_ACCEPTANCE_BOUND', acceptance, isoAt()
    ));
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_WRITE_FAILED');
  } finally { dbWrite.close(); }
  return deepFreeze({ acceptance, acceptance_event_id: event.event_id, duplicate: event.duplicate });
}

function packetBuildCurrentProjection(config, boundReaders, consumerIntent) {
  const authorityObservation = packetReadAuthorityObservation(boundReaders, consumerIntent);
  const candidateObservation = packetReadCandidateObservation(boundReaders, consumerIntent, consumerIntent.candidate === undefined ? null : consumerIntent.candidate);
  const candidate = candidateObservation.candidate;
  const intent = packetConsumerIntent({ ...consumerIntent, candidate }, authorityObservation.source, candidate);
  const specs = consumerIntent.predecessors || consumerIntent.required_predecessors;
  if (!Array.isArray(specs)) {
    if (!authorityObservation.no_predecessor) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  }
  const db = openAuthorityPacketVerified(config, false, true);
  try {
    const storeIdentity = authorityPacketStoreIdentityDb(db, config);
    const predecessors = [];
    for (const spec of specs || []) predecessors.push(packetBuildPredecessorDb(db, spec, null, storeIdentity));
    packetCandidateReusePermitted(candidateObservation, predecessors.map((item) => item.candidate), candidate);
    const projection = {
      schema: AUTHORITY_PACKET_CURRENT_SCHEMA_ID,
      repository: intent.repository,
      parent_issue: intent.parent_issue,
      child_issue: intent.child_issue,
      lane_id: intent.lane_id,
      human_owner: intent.human_owner,
      consumer: intent.consumer,
      authority: intent.authority,
      candidate: intent.candidate,
      predecessors: predecessors.sort((left, right) => left.dependency_id < right.dependency_id ? -1 : 1)
    };
    const current = validateAuthorityPacketCurrent(projection);
    const declaredIds = packetDeclaredConsumerIds(authorityObservation, current);
    if (JSON.stringify(declaredIds) !== JSON.stringify(packetCurrentConsumerIds(current))) {
      packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
    }
    return current;
  } finally { db.close(); }
}

function packetConfirmCurrentProjection(config, boundReaders, expectedProjection) {
  const projection = validateAuthorityPacketCurrent(expectedProjection);
  const observed = packetReadCurrentObservation(boundReaders, projection);
  if (canonicalSerialize(observed.current) !== canonicalSerialize(projection)) packetFail('GPR_PACKET_CURRENT_UNVERIFIED');
  const events = [];
  if (projection.predecessors.length > 0) {
    const db = openAuthorityPacketVerified(config, false, false);
    try {
      for (const predecessor of projection.predecessors) {
        events.push(transaction(db, () => appendAuthorityPacketEventDb(
          db,
          predecessor.packet_id,
          'CURRENT_READBACK',
          {
            projection_digest: observed.projection_digest,
            body_digest: observed.body_digest,
            revision: observed.revision,
            acceptance_event_ids: [predecessor.acceptance_event_id]
          },
          isoAt()
        )));
      }
    } catch (error) {
      if (error instanceof GprError) throw error;
      packetFail('GPR_PACKET_WRITE_FAILED');
    } finally { db.close(); }
  }
  return deepFreeze({
    schema: AUTHORITY_PACKET_CURRENT_SCHEMA_ID,
    projection,
    projection_digest: observed.projection_digest,
    body_digest: observed.body_digest,
    revision: observed.revision,
    readback_event_ids: events.map((event) => event.event_id)
  });
}

function semanticGateRecordDb(db, admissionId) {
  const row = db.prepare('SELECT * FROM semantic_gate_admissions WHERE admission_id = ?').get(admissionId);
  if (!row) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  let record;
  try { record = packetClosedClone(JSON.parse(row.canonical_json)); } catch (_) { packetFail('GPR_PACKET_CONTENT_MISMATCH'); }
  if (!isRecord(record) || record.admission_id !== row.admission_id || record.consumer_key !== row.consumer_key
    || record.schema !== SEMANTIC_GATE_ADMISSION_SCHEMA_ID) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  return validateSemanticGateAdmission(record);
}

function semanticGateAdmissionRecord(config, store, boundReaders, consumerIntent) {
  if (!isRecord(consumerIntent)) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  const verification = packetVerifySemanticDependencies(config, boundReaders, consumerIntent, {
    operation: consumerIntent.operation || consumerIntent.stage || consumerIntent.consumer && consumerIntent.consumer.stage
  });
  const proof = verification.proof;
  const consumer = verification.consumer;
  const packetDb = openAuthorityPacketVerified(config, false, true);
  try {
    for (const predecessor of proof.predecessors) {
      const identities = packetReadIdentityDb(packetDb, predecessor.packet_id);
      packetScreenPersistedPacket(boundReaders, identities.packet, predecessor.packet_digest);
    }
  } finally { packetDb.close(); }
  const consumerKey = digestValue({
    repository: consumer.repository,
    parent_issue: consumer.parent_issue,
    child_issue: consumer.child_issue,
    lane_id: consumer.lane_id,
    consumer: consumer.consumer,
    candidate: consumer.candidate,
    scope_digest: consumer.consumer.scope_digest,
    execution_binding: consumer.execution_binding
  });
  const record = {
    schema: SEMANTIC_GATE_ADMISSION_SCHEMA_ID,
    admission_id: randomId('semantic-admission'),
    consumer_key: consumerKey,
    consumer: consumer.consumer,
    repository: consumer.repository,
    parent_issue: consumer.parent_issue,
    child_issue: consumer.child_issue,
    lane_id: consumer.lane_id,
    human_owner: consumer.human_owner,
    authority: consumer.authority,
    candidate: consumer.candidate,
    scope_digest: consumer.consumer.scope_digest,
    current_projection_digest: proof.current.projection_digest,
    current_body_digest: proof.current.body_digest,
    current_revision: proof.current.revision,
    predecessors: proof.predecessors,
    execution_binding: consumer.execution_binding
  };
  validateSemanticGateAdmission(record);
  assertAuthorityPacketPrivacy(record);
  const db = openAuthorityPacketVerified(config, false, false);
  let inserted = false;
  try {
    transaction(db, () => {
      const existing = db.prepare('SELECT * FROM semantic_gate_admissions WHERE consumer_key = ?').get(consumerKey);
      if (existing) {
        const prior = semanticGateRecordDb(db, existing.admission_id);
        if (canonicalSerialize(prior) !== canonicalSerialize(record)) packetFail('GPR_PACKET_STALE_REPLAY');
        record.admission_id = prior.admission_id;
        return;
      }
      db.prepare('INSERT INTO semantic_gate_admissions VALUES (?, ?, ?, ?)').run(
        record.admission_id, record.consumer_key, canonicalSerialize(record), isoAt()
      );
      inserted = true;
    });
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_WRITE_FAILED');
  } finally { db.close(); }
  const tokenState = {
    storeInstanceId: store.instanceId,
    processId: process.pid,
    admissionId: record.admission_id,
    consumerKey,
    consumerIntent: { ...consumerIntent, ...consumer },
    readers: boundReaders,
    config
  };
  const token = Object.freeze({
    toJSON() { packetFail('GPR_PACKET_ADMISSION_REQUIRED'); }
  });
  SEMANTIC_GATE_OWNERS.set(token, tokenState);
  return deepFreeze({ admission: token, proof, admission_id: record.admission_id, duplicate: !inserted });
}

function semanticGateRevalidate(config, store, boundReaders, token, expected = {}) {
  const state = semanticGateAdmissionState(store, token);
  const db = openAuthorityPacketVerified(config, false, true);
  let record;
  try { record = semanticGateRecordDb(db, state.admissionId); } finally { db.close(); }
  const verification = packetVerifySemanticDependencies(config, boundReaders, state.consumerIntent, expected);
  const proof = verification.proof;
  if (proof.current.projection_digest !== record.current_projection_digest
    || proof.current.body_digest !== record.current_body_digest
    || `${proof.current.revision}` !== `${record.current_revision}`
    || canonicalSerialize(proof.predecessors) !== canonicalSerialize(record.predecessors)) {
    packetFail('GPR_PACKET_STALE_REPLAY');
  }
  return proof;
}

function semanticGateDispatchState(config, admissionId) {
  const db = openAuthorityPacketVerified(config, false, true);
  try {
    semanticGateRecordDb(db, admissionId);
    return db.prepare('SELECT * FROM semantic_gate_admission_events WHERE admission_id = ? ORDER BY sequence').all(admissionId);
  } finally { db.close(); }
}

function semanticGateBeginDispatch(config, store, token) {
  const state = semanticGateAdmissionState(store, token);
  semanticGateRevalidate(config, store, state.readers, token, {});
  const db = openAuthorityPacketVerified(config, false, false);
  try {
    return transaction(db, () => appendSemanticGateEventDb(db, state.admissionId, 'DISPATCH_INTENT', {
      admission_id: state.admissionId,
      consumer_key: state.consumerKey,
      action: 'DISPATCH_INTENT'
    }));
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  } finally { db.close(); }
}

function semanticGateRecordDispatch(config, store, token, evidence) {
  const state = semanticGateAdmissionState(store, token);
  semanticGateRevalidate(config, store, state.readers, token, {});
  let transport;
  try { transport = packetClosedClone(evidence); } catch (_) { packetFail('GPR_PACKET_DISPATCH_UNRESOLVED'); }
  if (!isRecord(transport)) packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  const observed = callTrustedReaderSync(state.readers.readDispatchOutcome, {
    admission_id: state.admissionId,
    consumer_key: state.consumerKey,
    status: transport.status,
    outcome: transport.outcome,
    classification: transport.classification,
    transport_result: transport.transport_result,
    transport_error: transport.transport_error || null,
    evidence: transport
  }, 'GPR_PACKET_DISPATCH_UNRESOLVED');
  if (!isRecord(observed)) packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  if (observed.admission_id !== undefined && observed.admission_id !== state.admissionId
    || observed.consumer_key !== undefined && observed.consumer_key !== state.consumerKey) {
    packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  }
  const outcome = observed.outcome || observed.classification || observed.state || observed.status;
  const eventType = ['DISPATCH_CONFIRMED', 'CONFIRMED', 'STARTED', 'confirmed'].includes(outcome)
    ? 'DISPATCH_CONFIRMED'
    : ['DISPATCH_NOT_STARTED', 'NOT_STARTED', 'not-started', 'not_started'].includes(outcome) ? 'DISPATCH_NOT_STARTED' : null;
  if (!eventType) packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  if (eventType === 'DISPATCH_NOT_STARTED' && observed.delayed_completion_excluded !== true) {
    packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  }
  const db = openAuthorityPacketVerified(config, false, false);
  try {
    return transaction(db, () => appendSemanticGateEventDb(db, state.admissionId, eventType, transport));
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  } finally { db.close(); }
}

function semanticGateRecover(config, store, boundReaders, consumerIdentity) {
  let consumerKey;
  if (typeof consumerIdentity === 'string') consumerKey = consumerIdentity;
  else if (isRecord(consumerIdentity) && typeof consumerIdentity.consumer_key === 'string') consumerKey = consumerIdentity.consumer_key;
  else if (isRecord(consumerIdentity) && isRecord(consumerIdentity.record)) consumerKey = consumerIdentity.record.consumer_key;
  if (!isDigest(consumerKey)) packetFail('GPR_PACKET_ADMISSION_REQUIRED');
  const db = openAuthorityPacketVerified(config, false, true);
  let record;
  let events;
  try {
    record = semanticGateRecordDb(db, db.prepare('SELECT admission_id FROM semantic_gate_admissions WHERE consumer_key = ?').get(consumerKey)?.admission_id);
    events = db.prepare('SELECT * FROM semantic_gate_admission_events WHERE admission_id = ? ORDER BY sequence').all(record.admission_id);
  } finally { db.close(); }
  const last = events.at(-1);
  if (last && last.event_type === 'DISPATCH_INTENT') packetFail('GPR_PACKET_DISPATCH_UNRESOLVED');
  const intent = {
    repository: record.repository,
    parent_issue: record.parent_issue,
    child_issue: record.child_issue,
    lane_id: record.lane_id,
    human_owner: record.human_owner,
    consumer: record.consumer,
    authority: record.authority,
    candidate: record.candidate,
    execution_binding: record.execution_binding,
    operation: record.consumer.stage
  };
  const tokenState = {
    storeInstanceId: store.instanceId,
    processId: process.pid,
    admissionId: record.admission_id,
    consumerKey,
    consumerIntent: intent,
    readers: boundReaders,
    config
  };
  const token = Object.freeze({ toJSON() { packetFail('GPR_PACKET_ADMISSION_REQUIRED'); } });
  SEMANTIC_GATE_OWNERS.set(token, tokenState);
  const proof = semanticGateRevalidate(config, store, boundReaders, token, {});
  return deepFreeze({ admission: token, proof, admission_id: record.admission_id, recovered: true });
}

function verifyAuthorityPacketDatabase(db, namespace, digest, databasePath, expectedFingerprint) {
  if (fs.statSync(databasePath).size > LIMITS.databaseBytes) packetFail('GPR_PACKET_LIMIT');
  if (Number(oneValue(db, 'PRAGMA application_id', 'application_id')) !== APPLICATION_ID
    || Number(oneValue(db, 'PRAGMA user_version', 'user_version')) !== AUTHORITY_PACKET_USER_VERSION) {
    packetFail('GPR_PACKET_SCHEMA_UNAVAILABLE');
  }
  const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
  if (!metadata || metadata.schema_id !== SCHEMA_ID || metadata.namespace_digest !== digest
    || metadata.repository !== namespace.repository || metadata.parent_issue !== namespace.parent_issue
    || metadata.child_issue !== namespace.child_issue || metadata.schema_fingerprint !== expectedFingerprint
    || schemaFingerprint(db) !== expectedFingerprint) packetFail('GPR_PACKET_SCHEMA_UNAVAILABLE');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') packetFail('GPR_PACKET_STORE_UNAVAILABLE');
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) packetFail('GPR_PACKET_STORE_UNAVAILABLE');
  const state = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get();
  const max = db.prepare('SELECT COALESCE(MAX(fence_sequence), 0) AS value FROM allocations').get().value;
  if (!state || state.high_water !== max) packetFail('GPR_PACKET_CONTENT_MISMATCH');
  verifyAuthorityPacketDurableEvidence(db, namespace, digest, databasePath);
  return true;
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
    db.prepare(`INSERT INTO receipt_chain_digests
      (receipt_id, run_id, sequence, chain_digest) VALUES (?, ?, ?, ?)`).run(
      receipt.receipt_id, receipt.run_id, receipt.sequence, chainDigest
    );
    db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      receipt.receipt_id, receipt.run_id, receipt.sequence, receipt.receipt_type,
      receipt.prior_receipt_id, canonicalSerialize(receipt), receipt.receipt_id
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
    if (Number(oneValue(db, 'PRAGMA user_version', 'user_version')) === AUTHORITY_PACKET_USER_VERSION) {
      verifyAuthorityPacketDatabase(db, config.namespace, config.namespaceDigest, databasePath);
      return db;
    }
    verifyDatabase(db, config.namespace, config.namespaceDigest, databasePath, expectedFingerprint);
    return db;
  } catch (error) {
    try { db.close(); } catch (_) { /* Preserve the original failure. */ }
    if (error instanceof GprError) throw error;
    fail('GPR_STORE_INVALID', { cause: error && error.code ? error.code : 'sqlite-error' });
  }
}

function openAuthorityPacketVerified(config, create = false, readOnly = false) {
  assertRuntimeSupport();
  const databasePath = config.databasePath;
  const existed = fs.existsSync(databasePath);
  if (existed) {
    const stat = fs.lstatSync(databasePath);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(databasePath) !== databasePath) {
      packetFail('GPR_PACKET_STORE_UNAVAILABLE');
    }
    if (stat.size > LIMITS.databaseBytes) packetFail('GPR_PACKET_LIMIT');
  } else if (!create) {
    packetFail('GPR_PACKET_STORE_UNAVAILABLE');
  }
  const { DatabaseSync } = assertRuntimeSupport();
  let db;
  try {
    db = readOnly ? new DatabaseSync(databasePath, { readOnly: true }) : new DatabaseSync(databasePath);
    configureDatabase(db, readOnly);
    if (!existed) {
      if (!create || readOnly) packetFail('GPR_PACKET_STORE_UNAVAILABLE');
      createAuthorityPacketDatabase(
        db,
        config.namespace,
        config.namespaceDigest,
        isoAt(),
        expectedAuthorityPacketSchemaFingerprint(DatabaseSync)
      );
      if (process.platform !== 'win32') fs.chmodSync(databasePath, 0o600);
    }
    verifyAuthorityPacketDatabase(
      db,
      config.namespace,
      config.namespaceDigest,
      databasePath,
      expectedAuthorityPacketSchemaFingerprint(DatabaseSync)
    );
    return db;
  } catch (error) {
    if (db) {
      try { db.close(); } catch (_) { /* Preserve the original failure. */ }
    }
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_STORE_UNAVAILABLE');
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

function authorityPacketStoreIdentityDb(db, config) {
  const metadata = db.prepare(
    'SELECT schema_id, namespace_digest, repository, parent_issue, child_issue, schema_fingerprint, created_at FROM metadata WHERE singleton = 1'
  ).get();
  if (!metadata || metadata.schema_fingerprint !== expectedAuthorityPacketSchemaFingerprint()) {
    packetFail('GPR_PACKET_STORE_IDENTITY_MISMATCH');
  }
  return digestValue({
    database_realpath_digest: digestValue(fs.realpathSync.native(config.databasePath)),
    namespace: config.namespace,
    application_id: Number(oneValue(db, 'PRAGMA application_id', 'application_id')),
    metadata_creation_identity: metadata,
    schema_fingerprint: metadata.schema_fingerprint
  });
}

function authorityPacketStoreIdentity(options) {
  const config = createStoreConfig(options);
  const db = openAuthorityPacketVerified(config, false, true);
  try { return authorityPacketStoreIdentityDb(db, config); } finally { db.close(); }
}

function migrationQuiescence(db, observedAt) {
  const unresolved = db.prepare(`
    SELECT COUNT(*) AS value
    FROM mutation_operations o
    JOIN mutation_operation_events e ON e.operation_id = o.operation_id
    WHERE e.sequence = (
      SELECT MAX(inner_event.sequence)
      FROM mutation_operation_events inner_event
      WHERE inner_event.operation_id = o.operation_id
    ) AND e.state IN ('IN_FLIGHT', 'UNKNOWN')
  `).get().value;
  const unreleased = db.prepare(`
    SELECT COUNT(*) AS value
    FROM allocations a
    WHERE a.expires_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM lease_events e
        WHERE e.allocation_id = a.allocation_id AND e.event_type = 'RELEASED'
      )
  `).get(observedAt).value;
  return { unresolved_operation_count: Number(unresolved), unexpired_unreleased_allocation_count: Number(unreleased) };
}

function readAuthorityPacketMigrationSource(config) {
  if (!fs.existsSync(config.databasePath)) packetFail('GPR_PACKET_STORE_UNAVAILABLE');
  const { DatabaseSync } = assertRuntimeSupport();
  let db;
  try {
    db = new DatabaseSync(config.databasePath, { readOnly: true });
    configureDatabase(db, true);
    const observedAt = isoAt();
    try {
      verifyDatabase(db, config.namespace, config.namespaceDigest, config.databasePath, expectedV2SchemaFingerprint());
    } catch (_) {
      packetFail('GPR_PACKET_MIGRATION_SOURCE_INVALID');
    }
    const quiescence = migrationQuiescence(db, observedAt);
    if (quiescence.unresolved_operation_count !== 0 || quiescence.unexpired_unreleased_allocation_count !== 0) {
      packetFail('GPR_PACKET_MIGRATION_NOT_QUIESCENT');
    }
    return {
      application_id: APPLICATION_ID,
      user_version: USER_VERSION,
      schema_fingerprint: expectedV2SchemaFingerprint(),
      namespace_verified: true,
      integrity_verified: true,
      foreign_keys_verified: true,
      historical_digests_verified: true,
      chain_verified: true,
      high_water_verified: true,
      unresolved_operation_count: quiescence.unresolved_operation_count,
      unexpired_unreleased_allocation_count: quiescence.unexpired_unreleased_allocation_count,
      observed_at: observedAt
    };
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_MIGRATION_SOURCE_INVALID');
  } finally {
    if (db) db.close();
  }
}

function buildAuthorityPacketMigrationPlan(observation) {
  if (!isRecord(observation)
    || observation.application_id !== APPLICATION_ID
    || observation.user_version !== USER_VERSION
    || observation.schema_fingerprint !== expectedV2SchemaFingerprint()
    || observation.namespace_verified !== true
    || observation.integrity_verified !== true
    || observation.foreign_keys_verified !== true
    || observation.historical_digests_verified !== true
    || observation.chain_verified !== true
    || observation.high_water_verified !== true
    || observation.unresolved_operation_count !== 0
    || observation.unexpired_unreleased_allocation_count !== 0
    || !isTimestamp(observation.observed_at)) {
    if (isRecord(observation)
      && (observation.unresolved_operation_count !== 0 || observation.unexpired_unreleased_allocation_count !== 0)) {
      packetFail('GPR_PACKET_MIGRATION_NOT_QUIESCENT');
    }
    packetFail('GPR_PACKET_MIGRATION_SOURCE_INVALID');
  }
  const source = deepFreeze(clone(observation));
  return deepFreeze({
    schema: 'toolkit.github-program.v2-to-v4-authority-packet-migration-plan.v1',
    source_application_id: APPLICATION_ID,
    source_user_version: USER_VERSION,
    source_schema_fingerprint: source.schema_fingerprint,
    target_application_id: APPLICATION_ID,
    target_user_version: AUTHORITY_PACKET_USER_VERSION,
    target_schema_fingerprint: expectedAuthorityPacketSchemaFingerprint(),
    source_observation_digest: digestValue(source),
    quiescence: {
      unresolved_operation_count: source.unresolved_operation_count,
      unexpired_unreleased_allocation_count: source.unexpired_unreleased_allocation_count,
      observed_at: source.observed_at
    },
    schema_sql: AUTHORITY_PACKET_SCHEMA_SQL,
    metadata_no_update_trigger_sql: METADATA_NO_UPDATE_TRIGGER_SQL,
    steps: AUTHORITY_PACKET_MIGRATION_STEPS
  });
}

function planAuthorityPacketMigration(options) {
  const config = createStoreConfig(options || {});
  return buildAuthorityPacketMigrationPlan(readAuthorityPacketMigrationSource(config));
}

function migrateAuthorityPacketStore(options, trustedAuthorityReaders) {
  const config = createStoreConfig(options || {});
  const plan = planAuthorityPacketMigration(options);
  const { DatabaseSync } = assertRuntimeSupport();
  let db;
  try {
    db = new DatabaseSync(config.databasePath);
    configureDatabase(db, false);
    transaction(db, () => {
      try {
        verifyDatabase(db, config.namespace, config.namespaceDigest, config.databasePath, expectedV2SchemaFingerprint());
      } catch (_) {
        packetFail('GPR_PACKET_MIGRATION_SOURCE_INVALID');
      }
      const quiescence = migrationQuiescence(db, isoAt());
      if (quiescence.unresolved_operation_count !== 0 || quiescence.unexpired_unreleased_allocation_count !== 0) {
        packetFail('GPR_PACKET_MIGRATION_NOT_QUIESCENT');
      }
      db.exec('DROP TRIGGER metadata_no_update');
      db.exec(plan.schema_sql);
      db.prepare('UPDATE metadata SET schema_fingerprint = ? WHERE singleton = 1').run(plan.target_schema_fingerprint);
      db.exec(plan.metadata_no_update_trigger_sql);
      db.exec(`PRAGMA user_version=${AUTHORITY_PACKET_USER_VERSION}`);
      if (schemaFingerprint(db) !== plan.target_schema_fingerprint) packetFail('GPR_PACKET_SCHEMA_UNAVAILABLE');
      const integrity = db.prepare('PRAGMA integrity_check').all();
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok'
        || db.prepare('PRAGMA foreign_key_check').all().length !== 0) packetFail('GPR_PACKET_STORE_UNAVAILABLE');
      verifyAuthorityPacketDurableEvidence(db, config.namespace, config.namespaceDigest, config.databasePath);
    });
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_WRITE_FAILED');
  } finally {
    if (db) db.close();
  }
  const reopened = openAuthorityPacketVerified(config, false, true);
  reopened.close();
  verifyAuthorityPacketStoreFreshProcess(config);
  return createAuthorityPacketStore(options, trustedAuthorityReaders);
}

function initialiseAuthorityPacketStore(options, trustedAuthorityReaders) {
  const config = createStoreConfig(options || {});
  if (fs.existsSync(config.databasePath)) {
    const { DatabaseSync } = assertRuntimeSupport();
    let db;
    try {
      db = new DatabaseSync(config.databasePath, { readOnly: true });
      configureDatabase(db, true);
      const version = Number(oneValue(db, 'PRAGMA user_version', 'user_version'));
      if (version !== AUTHORITY_PACKET_USER_VERSION) packetFail('GPR_PACKET_SCHEMA_UNAVAILABLE');
    } catch (error) {
      if (error instanceof GprError) throw error;
      packetFail('GPR_PACKET_SCHEMA_UNAVAILABLE');
    } finally {
      if (db) db.close();
    }
  } else {
    const db = openAuthorityPacketVerified(config, true, false);
    db.close();
  }
  return createAuthorityPacketStore(options, trustedAuthorityReaders);
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

function authorityPacketRuntimeIdentity(nodeExecutable = process.execPath, runtimePath = __filename) {
  const base = runtimeIdentity(nodeExecutable, runtimePath);
  const compilerRealpath = canonicalRegularFile(path.resolve(__dirname, 'toolkit-gate-contract-compiler.cjs'));
  const { nodeRealpath, runtimeRealpath, runtime_identity_digest: _legacyDigest, ...baseIdentity } = base;
  const identity = {
    ...baseIdentity,
    gate_contract_compiler_realpath_digest: digestValue(compilerRealpath),
    gate_contract_compiler_digest: sha256File(compilerRealpath)
  };
  return deepFreeze({
    ...identity,
    runtime_identity_digest: digestValue(identity),
    nodeRealpath,
    runtimeRealpath
  });
}

function verifyAuthorityPacketStoreFreshProcess(config) {
  const identity = authorityPacketRuntimeIdentity();
  const env = { ...process.env };
  const nodeInjectionKeys = new Set([
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE',
    'NODE_REPL_EXTERNAL_MODULE', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE'
  ]);
  for (const key of Object.keys(env)) if (nodeInjectionKeys.has(key.toUpperCase())) delete env[key];
  let result;
  try {
    result = spawnSync(identity.nodeRealpath, [
      '--no-warnings', identity.runtimeRealpath, 'verify-authority-packet-store',
      '--repository', config.namespace.repository,
      '--parent-issue', String(config.namespace.parent_issue),
      '--child-issue', String(config.namespace.child_issue),
      '--state-root', config.stateRoot,
      '--repository-root', config.repositoryRoot
    ], {
      cwd: config.repositoryRoot,
      encoding: 'utf8',
      env,
      shell: false,
      windowsHide: true,
      timeout: VERIFIER_TIMEOUT_MS,
      maxBuffer: VERIFIER_STREAM_BYTES
    });
  } catch (_) {
    packetFail('GPR_PACKET_READBACK_FAILED');
  }
  if (!result || result.error || result.signal || result.status !== 0
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || result.stderr !== '' || !result.stdout.endsWith('\n')
    || result.stdout.slice(0, -1).includes('\n')) packetFail('GPR_PACKET_READBACK_FAILED');
  let observed;
  try { observed = JSON.parse(result.stdout.slice(0, -1)); } catch (_) { packetFail('GPR_PACKET_READBACK_FAILED'); }
  const expected = {
    ok: true,
    schema: AUTHORITY_PACKET_SCHEMA_ID,
    namespace_digest: config.namespaceDigest
  };
  if (canonicalSerialize(observed) !== canonicalSerialize({
    ...expected,
    store_identity_digest: observed.store_identity_digest
  }) || !isDigest(observed.store_identity_digest)) packetFail('GPR_PACKET_READBACK_FAILED');
  return deepFreeze(observed);
}

function validateAuthorityPacketReaders(value, requireScreen = false) {
  if (value === undefined || value === null) {
    if (requireScreen) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    return null;
  }
  if (!isRecord(value)) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  try {
    if (utilTypes.isProxy(value) || Object.getOwnPropertySymbols(value).length > 0) {
      packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    }
  } catch (_) {
    packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  for (const key of ['readAuthority', 'readStart', 'screenPacket', 'readBackfillSource']) {
    if (Object.hasOwn(value, key) && typeof value[key] !== 'function') packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  if (requireScreen && typeof value.screenPacket !== 'function') packetFail('GPR_PACKET_PRIVACY_REJECTED');
  return value;
}

function captureAuthorityPacketReaders(value) {
  if (value === undefined || value === null) return null;
  validateAuthorityPacketReaders(value, false);
  if (Object.getOwnPropertySymbols(value).length > 0) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  const keys = Object.keys(value).sort();
  const values = new Map();
  const bound = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    values.set(key, descriptor.value);
    bound[key] = descriptor.value;
  }
  const snapshot = { bound: Object.freeze(bound), keys: Object.freeze(keys), values };
  AUTHORITY_PACKET_READER_OWNERS.set(value, snapshot);
  return snapshot.bound;
}

function authorityPacketReadersUnchanged(value, snapshot) {
  if (!isRecord(value) || Object.keys(value).sort().join('\u0000') !== snapshot.keys.join('\u0000')
    || Object.getOwnPropertySymbols(value).length > 0) return false;
  for (const key of snapshot.keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== snapshot.values.get(key)) return false;
  }
  return true;
}

function callTrustedReaderSync(reader, argument, code) {
  if (typeof reader !== 'function') packetFail(code);
  let result;
  try { result = reader(argument); } catch (error) {
    if (error instanceof GprError && error.packetBoundary) throw error;
    packetFail(code);
  }
  if (result && typeof result.then === 'function') packetFail(code);
  return result;
}

function packetBindingsFromAdmission(admission) {
  if (!isRecord(admission)) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  const candidate = admission.bindings || admission.expected_bindings;
  if (!candidate) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  let bindings;
  try { bindings = packetClosedClone(candidate); } catch (error) {
    if (error instanceof GprError) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  packetValidateBindings(bindings);
  return bindings;
}

function verifyPacketProducerAdmission(packet, admission, readers) {
  if (!readers || typeof readers.readAuthority !== 'function') packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  const bindings = packetBindingsFromAdmission(admission);
  if (canonicalSerialize(bindings) !== canonicalSerialize(packet.bindings)) packetFail('GPR_PACKET_BINDING_MISMATCH');
  let observedAuthority;
  {
    const observed = callTrustedReaderSync(readers.readAuthority, { packet_id: `ap1-${digestValue(packet)}` }, 'GPR_PACKET_AUTHORITY_UNVERIFIED');
    observedAuthority = observed && isRecord(observed) && Object.hasOwn(observed, 'authority') ? observed.authority : observed;
    if (observed && Array.isArray(observed.later_controlling_comments) && observed.later_controlling_comments.length > 0) {
      packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    }
  }
  if (observedAuthority === undefined) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  try { packetValidateSourceReference(packetClosedClone(observedAuthority)); } catch (error) {
    if (error instanceof GprError) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  if (canonicalSerialize(observedAuthority) !== canonicalSerialize(packet.bindings.authority)) {
    packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
  }
  if (Object.hasOwn(admission, 'producer')) {
    try {
      packetValidateProducer(packetClosedClone(admission.producer));
    } catch (error) {
      if (error instanceof GprError) packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
      packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    }
    if (canonicalSerialize(admission.producer) !== canonicalSerialize(packet.bindings.producer)) {
      packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    }
  }
  if (Object.hasOwn(admission, 'candidate')) {
    const candidate = admission.candidate;
    if (candidate !== null && candidate !== undefined) {
      try { validateCandidate(candidate); } catch (_) { packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED'); }
    }
    if (canonicalSerialize(candidate === undefined ? null : candidate) !== canonicalSerialize(packet.bindings.candidate)) {
      packetFail('GPR_PACKET_AUTHORITY_UNVERIFIED');
    }
  }
  return true;
}

function verifyPacketScreening(packetIdentities, admission, readers) {
  if (!readers || typeof readers.screenPacket !== 'function') packetFail('GPR_PACKET_PRIVACY_REJECTED');
  const screening = callTrustedReaderSync(readers.screenPacket, {
    packet: packetIdentities.packet,
    packet_digest: packetIdentities.packet_digest
  }, 'GPR_PACKET_PRIVACY_REJECTED');
  if (!isRecord(screening)) packetFail('GPR_PACKET_PRIVACY_REJECTED');
  let normalized;
  try { normalized = packetClosedClone(screening); } catch (error) {
    if (error instanceof GprError) packetFail('GPR_PACKET_PRIVACY_REJECTED');
    packetFail('GPR_PACKET_PRIVACY_REJECTED');
  }
  const allowed = normalized.allowed === true || normalized.decision === 'ALLOW' || normalized.decision === 'ACCEPTED';
  if (normalized.packet_digest !== packetIdentities.packet_digest || !allowed) packetFail('GPR_PACKET_PRIVACY_REJECTED');
  for (const key of ['policy_digest', 'disclosure_policy_digest', 'retention_policy_digest']) {
    if (normalized[key] !== undefined && !isDigest(normalized[key])) packetFail('GPR_PACKET_PRIVACY_REJECTED');
  }
  return normalized;
}

function readAuthorityPacketRow(db, packetId, expectedBindings) {
  if (typeof packetId !== 'string' || !AUTHORITY_PACKET_ID_PATTERN.test(packetId)) packetFail('GPR_PACKET_IDENTITY_MISMATCH');
  let expected;
  try { expected = packetClosedClone(expectedBindings); } catch (error) {
    if (error instanceof GprError) packetFail('GPR_PACKET_BINDING_MISMATCH');
    packetFail('GPR_PACKET_BINDING_MISMATCH');
  }
  packetValidateBindings(expected);
  const row = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
  if (!row) packetFail('GPR_PACKET_NOT_FOUND');
  let identities;
  try {
    identities = authorityPacketIdentities(parseAuthorityPacketJson(row.canonical_json));
  } catch (error) {
    if (error instanceof GprError) packetFail('GPR_PACKET_CONTENT_MISMATCH');
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  if (row.packet_id !== identities.packet_id || row.producer_key !== identities.producer_key
    || row.packet_digest !== identities.packet_digest || row.content_digest !== identities.content_digest
    || row.binding_digest !== identities.binding_digest || row.canonical_json !== identities.canonical_packet_bytes) {
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  if (canonicalSerialize(identities.packet.bindings) !== canonicalSerialize(expected)) packetFail('GPR_PACKET_BINDING_MISMATCH');
  return identities;
}

function packetDeliveryEnvelope(identities, config, storeIdentityDigest, runtimeIdentityDigest, challenge) {
  return {
    schema: AUTHORITY_PACKET_DELIVERY_SCHEMA_ID,
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    content_digest: identities.content_digest,
    binding_digest: identities.binding_digest,
    producer_key: identities.producer_key,
    namespace_digest: config.namespaceDigest,
    store_identity_digest: storeIdentityDigest,
    runtime_identity_digest: runtimeIdentityDigest,
    challenge,
    canonical_packet_bytes: identities.canonical_packet_bytes
  };
}

function validateAuthorityPacketDelivery(delivery, expected = {}) {
  if (!isRecord(delivery) || !exactKeys(delivery, ['envelope', 'packet']) || !isRecord(delivery.envelope)) {
    packetFail('GPR_PACKET_READBACK_FAILED');
  }
  const envelopeKeys = [
    'schema', 'packet_id', 'packet_digest', 'content_digest', 'binding_digest', 'producer_key',
    'namespace_digest', 'store_identity_digest', 'runtime_identity_digest', 'challenge', 'canonical_packet_bytes'
  ];
  if (!exactKeys(delivery.envelope, envelopeKeys)
    || delivery.envelope.schema !== AUTHORITY_PACKET_DELIVERY_SCHEMA_ID
    || !AUTHORITY_PACKET_ID_PATTERN.test(delivery.envelope.packet_id)
    || !isDigest(delivery.envelope.packet_digest) || !isDigest(delivery.envelope.content_digest)
    || !isDigest(delivery.envelope.binding_digest) || !isDigest(delivery.envelope.producer_key)
    || !isDigest(delivery.envelope.namespace_digest) || !isDigest(delivery.envelope.store_identity_digest)
    || !isDigest(delivery.envelope.runtime_identity_digest) || !/^[a-f0-9]{64}$/.test(delivery.envelope.challenge)
    || typeof delivery.envelope.canonical_packet_bytes !== 'string'
    || !packetStringIsUnicodeScalar(delivery.envelope.canonical_packet_bytes)
    || Buffer.byteLength(delivery.envelope.canonical_packet_bytes, 'utf8') > AUTHORITY_PACKET_LIMITS.artifactBytes) {
    packetFail('GPR_PACKET_READBACK_FAILED');
  }
  let identities;
  try { identities = authorityPacketIdentities(delivery.packet); } catch (_) { packetFail('GPR_PACKET_READBACK_FAILED'); }
  if (delivery.envelope.packet_id !== identities.packet_id
    || delivery.envelope.packet_digest !== identities.packet_digest
    || delivery.envelope.content_digest !== identities.content_digest
    || delivery.envelope.binding_digest !== identities.binding_digest
    || delivery.envelope.producer_key !== identities.producer_key
    || delivery.envelope.canonical_packet_bytes !== identities.canonical_packet_bytes) {
    packetFail('GPR_PACKET_IDENTITY_MISMATCH');
  }
  const expectedBindings = expected.expectedBindings || expected.bindings;
  if (expectedBindings !== undefined) {
    try {
      const normalized = packetClosedClone(expectedBindings);
      packetValidateBindings(normalized);
      if (canonicalSerialize(normalized) !== canonicalSerialize(identities.packet.bindings)) packetFail('GPR_PACKET_BINDING_MISMATCH');
    } catch (error) {
      if (error instanceof GprError) throw error;
      packetFail('GPR_PACKET_BINDING_MISMATCH');
    }
  }
  for (const [key, expectedKey] of [
    ['packet_id', 'packet_id'], ['store_identity_digest', 'store_identity_digest'],
    ['runtime_identity_digest', 'runtime_identity_digest'], ['namespace_digest', 'namespace_digest'], ['challenge', 'challenge']
  ]) {
    if (expected[expectedKey] !== undefined && delivery.envelope[key] !== expected[expectedKey]) packetFail('GPR_PACKET_READBACK_FAILED');
  }
  if (expected.packet !== undefined && canonicalSerialize(expected.packet) !== identities.canonical_packet_bytes) {
    packetFail('GPR_PACKET_CONTENT_MISMATCH');
  }
  if (Buffer.byteLength(canonicalSerialize(delivery), 'utf8') > AUTHORITY_PACKET_LIMITS.deliveryBytes) {
    packetFail('GPR_PACKET_LIMIT');
  }
  return deepFreeze(delivery);
}

function validateAuthorityPacketDeliveryProcessResult(result, expected) {
  if (!result || result.error || result.signal || result.status !== 0
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || Buffer.byteLength(result.stdout, 'utf8') > AUTHORITY_PACKET_LIMITS.deliveryBytes + 1
    || Buffer.byteLength(result.stderr, 'utf8') > 16 * 1024 || result.stderr !== ''
    || !result.stdout.endsWith('\n') || result.stdout.slice(0, -1).includes('\n')) packetFail('GPR_PACKET_READBACK_FAILED');
  let parsed;
  try { parsed = JSON.parse(result.stdout.slice(0, -1)); } catch (_) { packetFail('GPR_PACKET_READBACK_FAILED'); }
  validateAuthorityPacketDelivery(parsed, expected);
  if (`${canonicalSerialize(parsed)}\n` !== result.stdout) packetFail('GPR_PACKET_READBACK_FAILED');
  return parsed;
}

function appendAuthorityPacketEventDb(db, packetId, eventType, payload, createdAt) {
  if (!AUTHORITY_PACKET_ID_PATTERN.test(packetId) || !AUTHORITY_PACKET_EVENT_TYPES.includes(eventType)) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  const normalizedPayload = packetValidateEventPayload(eventType, payload);
  const existingKey = packetEventKey(packetId, eventType, normalizedPayload);
  const existing = db.prepare('SELECT * FROM authority_packet_events WHERE event_key = ?').get(existingKey);
  if (existing) {
    if (existing.packet_id !== packetId || existing.event_type !== eventType) packetFail('GPR_PACKET_CONFLICT');
    return { event_id: existing.event_id, event_key: existing.event_key, sequence: existing.sequence, duplicate: true };
  }
  packetValidateEventBinding(db, packetId, eventType, normalizedPayload);
  const prior = db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence DESC LIMIT 1').get(packetId);
  const sequence = prior ? prior.sequence + 1 : 1;
  const event = packetEventObject(packetId, sequence, prior ? prior.event_id : null, eventType, normalizedPayload, isoAt(createdAt));
  const eventId = digestValue(event);
  db.prepare('INSERT INTO authority_packet_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    eventId, packetId, existingKey, sequence, event.prior_event_id, event.event_type, canonicalSerialize(event)
  );
  return { event_id: eventId, event_key: existingKey, sequence, duplicate: false };
}

function persistAuthorityPacketWithReaders(config, readers, artifactInput, producerAdmission) {
  let identities;
  try { identities = authorityPacketIdentities(artifactInput); } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  if (identities.packet.bindings.repository !== config.namespace.repository
    || identities.packet.bindings.parent_issue !== config.namespace.parent_issue
    || identities.packet.bindings.child_issue !== config.namespace.child_issue) {
    packetFail('GPR_PACKET_BINDING_MISMATCH');
  }
  verifyPacketProducerAdmission(identities.packet, producerAdmission, readers);
  verifyPacketScreening(identities, producerAdmission, readers);
  const db = openAuthorityPacketVerified(config, false, false);
  let duplicate = false;
  try {
    transaction(db, () => {
      if (identities.packet.bindings.repository !== config.namespace.repository
        || identities.packet.bindings.parent_issue !== config.namespace.parent_issue
        || identities.packet.bindings.child_issue !== config.namespace.child_issue) {
        packetFail('GPR_PACKET_BINDING_MISMATCH');
      }
      const existing = db.prepare(
        'SELECT * FROM authority_packets WHERE producer_key = ? OR packet_id = ? ORDER BY packet_id LIMIT 1'
      ).get(identities.producer_key, identities.packet_id);
      if (existing) {
        if (existing.producer_key !== identities.producer_key || existing.packet_id !== identities.packet_id
          || existing.packet_digest !== identities.packet_digest || existing.content_digest !== identities.content_digest
          || existing.binding_digest !== identities.binding_digest || existing.canonical_json !== identities.canonical_packet_bytes) {
          packetFail('GPR_PACKET_CONFLICT');
        }
        duplicate = true;
        return;
      }
      if (Buffer.byteLength(identities.canonical_packet_bytes, 'utf8') > AUTHORITY_PACKET_LIMITS.artifactBytes) {
        packetFail('GPR_PACKET_LIMIT');
      }
      const createdAt = isoAt();
      db.prepare('INSERT INTO authority_packets VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        identities.packet_id, identities.producer_key, identities.packet_digest, identities.content_digest,
        identities.binding_digest, identities.canonical_packet_bytes, createdAt
      );
    });
  } catch (error) {
    if (error instanceof GprError) throw error;
    if (error && (error.code === 'SQLITE_FULL' || error.code === 'SQLITE_BUSY')) packetFail('GPR_PACKET_LIMIT');
    packetFail('GPR_PACKET_WRITE_FAILED');
  } finally {
    db.close();
  }
  const readback = openAuthorityPacketVerified(config, false, true);
  let readIdentities;
  try { readIdentities = readAuthorityPacketRow(readback, identities.packet_id, identities.packet.bindings); }
  finally { readback.close(); }
  if (readIdentities.canonical_packet_bytes !== identities.canonical_packet_bytes
    || readIdentities.packet_id !== identities.packet_id) packetFail('GPR_PACKET_READBACK_FAILED');
  return deepFreeze({
    packet: readIdentities.packet,
    packet_id: readIdentities.packet_id,
    packet_digest: readIdentities.packet_digest,
    content_digest: readIdentities.content_digest,
    binding_digest: readIdentities.binding_digest,
    producer_key: readIdentities.producer_key,
    duplicate
  });
}

function backfillAuthorityPacketWithReaders(config, readers, artifactInput) {
  const packetIdentities = authorityPacketIdentities(artifactInput);
  if (!readers || typeof readers.readBackfillSource !== 'function') packetFail('GPR_PACKET_LEGACY_RERUN_REQUIRED');
  const source = callTrustedReaderSync(readers.readBackfillSource, {
    packet_id: packetIdentities.packet_id,
    packet_digest: packetIdentities.packet_digest,
    binding_digest: packetIdentities.binding_digest
  }, 'GPR_PACKET_LEGACY_BACKFILL_UNVERIFIED');
  if (!isRecord(source)) packetFail('GPR_PACKET_LEGACY_RERUN_REQUIRED');
  let sourceRef;
  try { sourceRef = packetClosedClone(source.source_ref); } catch (_) { packetFail('GPR_PACKET_LEGACY_BACKFILL_UNVERIFIED'); }
  packetValidateSourceReference(sourceRef, 'GPR_PACKET_LEGACY_BACKFILL_UNVERIFIED');
  if (source.source_packet_digest !== packetIdentities.packet_digest
    || source.source_binding_digest !== packetIdentities.binding_digest
    || source.producer_key !== packetIdentities.producer_key
    || source.source_packet === undefined && source.source_artifact === undefined) {
    packetFail('GPR_PACKET_LEGACY_RERUN_REQUIRED');
  }
  const sourceArtifact = source.source_packet || source.source_artifact;
  let sourceIdentities;
  try { sourceIdentities = authorityPacketIdentities(sourceArtifact); } catch (_) { packetFail('GPR_PACKET_LEGACY_RERUN_REQUIRED'); }
  if (sourceIdentities.canonical_packet_bytes !== packetIdentities.canonical_packet_bytes
    || sourceIdentities.packet_digest !== packetIdentities.packet_digest
    || sourceIdentities.binding_digest !== packetIdentities.binding_digest) packetFail('GPR_PACKET_LEGACY_RERUN_REQUIRED');
  const admission = {
    bindings: packetIdentities.packet.bindings,
    authority: packetIdentities.packet.bindings.authority,
    producer: packetIdentities.packet.bindings.producer,
    candidate: packetIdentities.packet.bindings.candidate,
    screening: source.screening
  };
  const persisted = persistAuthorityPacketWithReaders(config, readers, packetIdentities.packet, admission);
  const db = openAuthorityPacketVerified(config, false, false);
  let event;
  try {
    event = transaction(db, () => appendAuthorityPacketEventDb(db, packetIdentities.packet_id, 'BACKFILL_AUTHORISED', {
      authority_ref: packetIdentities.packet.bindings.authority,
      source_ref: sourceRef,
      source_packet_digest: packetIdentities.packet_digest,
      source_binding_digest: packetIdentities.binding_digest
    }, isoAt()));
  } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_WRITE_FAILED');
  } finally { db.close(); }
  return deepFreeze({ ...persisted, backfill_event_id: event.event_id, backfill_duplicate: event.duplicate });
}

function verifyAuthorityPacketFreshProcess(config, packetId, expectedBindings) {
  const expectedDb = openAuthorityPacketVerified(config, false, true);
  let identities;
  let storeIdentity;
  try {
    identities = readAuthorityPacketRow(expectedDb, packetId, expectedBindings);
    storeIdentity = authorityPacketStoreIdentityDb(expectedDb, config);
  } finally { expectedDb.close(); }
  const identity = authorityPacketRuntimeIdentity();
  const challenge = crypto.randomBytes(32).toString('hex');
  const expectedDelivery = {
    envelope: packetDeliveryEnvelope(identities, config, storeIdentity, identity.runtime_identity_digest, challenge),
    packet: identities.packet
  };
  const env = { ...process.env };
  const nodeInjectionKeys = new Set([
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_REPL_EXTERNAL_MODULE',
    'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE'
  ]);
  for (const key of Object.keys(env)) if (nodeInjectionKeys.has(key.toUpperCase())) delete env[key];
  let result;
  try {
    result = spawnSync(identity.nodeRealpath, [
      '--no-warnings', identity.runtimeRealpath, 'read-authority-packet',
      '--repository', config.namespace.repository,
      '--parent-issue', String(config.namespace.parent_issue),
      '--child-issue', String(config.namespace.child_issue),
      '--state-root', config.stateRoot,
      '--repository-root', config.repositoryRoot,
      '--packet-id', packetId,
      '--expected-bindings', canonicalSerialize(expectedBindings),
      '--challenge', challenge
    ], {
      cwd: config.repositoryRoot,
      encoding: 'utf8',
      env,
      shell: false,
      windowsHide: true,
      timeout: VERIFIER_TIMEOUT_MS,
      maxBuffer: AUTHORITY_PACKET_LIMITS.deliveryBytes + 1
    });
  } catch (_) {
    packetFail('GPR_PACKET_READBACK_FAILED');
  }
  return validateAuthorityPacketDeliveryProcessResult(result, {
    expectedBindings,
    packet_id: packetId,
    store_identity_digest: storeIdentity,
    runtime_identity_digest: identity.runtime_identity_digest,
    namespace_digest: config.namespaceDigest,
    challenge,
    packet: identities.packet
  });
}

function createAuthorityPacketStore(options, trustedAuthorityReaders) {
  const config = createStoreConfig(options || {});
  const readers = captureAuthorityPacketReaders(trustedAuthorityReaders);
  const check = openAuthorityPacketVerified(config, false, true);
  check.close();
  const instanceId = randomId('authority-store');
  const store = {
    instanceId,
    databasePath: config.databasePath,
    namespace: config.namespace,
    storeIdentityDigest() {
      const owner = authorityPacketStoreState(this);
      const db = openAuthorityPacketVerified(owner.config, false, true);
      try { return authorityPacketStoreIdentityDb(db, owner.config); } finally { db.close(); }
    },
    persistAuthorityPacket(artifact, producerAdmission) {
      const owner = authorityPacketStoreState(this);
      return persistAuthorityPacketWithReaders(owner.config, owner.readers, artifact, producerAdmission);
    },
    readAuthorityPacket(packetId, expectedBindings) {
      const owner = authorityPacketStoreState(this);
      const db = openAuthorityPacketVerified(owner.config, false, true);
      try { return readAuthorityPacketRow(db, packetId, expectedBindings).packet; } finally { db.close(); }
    },
    verifyAuthorityPacketFresh(packetId, expectedBindings) {
      const owner = authorityPacketStoreState(this);
      return verifyAuthorityPacketFreshProcess(owner.config, packetId, expectedBindings);
    },
    backfillAuthorityPacket(artifact, backfillReaders = readers) {
      const owner = authorityPacketStoreState(this);
      if (!owner.readers || typeof owner.readers.readBackfillSource !== 'function') {
        packetFail('GPR_PACKET_LEGACY_RERUN_REQUIRED');
      }
      const boundReaders = packetRequireReaderSet(owner.readers, backfillReaders, ['readBackfillSource']);
      return backfillAuthorityPacketWithReaders(owner.config, boundReaders, artifact);
    },
    bindWebPacketAcceptance(packetId, suppliedReaders = readers) {
      const owner = authorityPacketStoreState(this);
      const boundReaders = packetRequireReaderSet(owner.readers, suppliedReaders, ['readWebDecision', 'screenPacket']);
      return packetBuildAcceptance(owner.config, boundReaders, packetId);
    },
    buildCurrentPacketProjection(consumerIntent, suppliedReaders = readers) {
      const owner = authorityPacketStoreState(this);
      const boundReaders = packetRequireReaderSet(owner.readers, suppliedReaders, ['readAuthority', 'readCandidate']);
      return packetBuildCurrentProjection(owner.config, boundReaders, consumerIntent);
    },
    confirmCurrentPacketProjection(expectedProjection, suppliedReaders = readers) {
      const owner = authorityPacketStoreState(this);
      const boundReaders = packetRequireReaderSet(owner.readers, suppliedReaders, ['readCurrent']);
      return packetConfirmCurrentProjection(owner.config, boundReaders, expectedProjection);
    },
    admitSemanticGate(consumerIntent, suppliedReaders) {
      const owner = authorityPacketStoreState(this);
      const boundReaders = packetRequireReaderSet(owner.readers, suppliedReaders, [
        'readAuthority', 'readCurrent', 'readWebDecision', 'readCandidate', 'readDispatchOutcome', 'screenPacket'
      ]);
      return semanticGateAdmissionRecord(owner.config, this, boundReaders, consumerIntent);
    },
    revalidateSemanticGate(admission, expected = {}) {
      const owner = authorityPacketStoreState(this);
      const state = semanticGateAdmissionState(this, admission);
      return semanticGateRevalidate(owner.config, this, state.readers, admission, expected);
    },
    beginSemanticGateDispatch(admission) {
      const owner = authorityPacketStoreState(this);
      return semanticGateBeginDispatch(owner.config, this, admission);
    },
    recordSemanticGateDispatch(admission, evidence) {
      const owner = authorityPacketStoreState(this);
      return semanticGateRecordDispatch(owner.config, this, admission, evidence);
    },
    recoverSemanticGateAdmission(consumerIdentity, suppliedReaders) {
      const owner = authorityPacketStoreState(this);
      const boundReaders = packetRequireReaderSet(owner.readers, suppliedReaders, [
        'readAuthority', 'readCurrent', 'readWebDecision', 'readCandidate', 'readDispatchOutcome', 'screenPacket'
      ]);
      return semanticGateRecover(owner.config, this, boundReaders, consumerIdentity);
    }
  };
  Object.freeze(store);
  AUTHORITY_PACKET_STORE_OWNERS.set(store, { config, readers, instanceId, processId: process.pid });
  return store;
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
      programmeReceiptStoreState(this);
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
      programmeReceiptStoreState(this);
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
      programmeReceiptStoreState(this);
      const allocated = store.allocateRun(input);
      return store.startAllocatedRun(allocated, readers);
    },
    appendReceipt(session, input) {
      programmeReceiptStoreState(this);
      return appendReceiptInternal(store, session, input);
    },
    interruptRun(session, input = {}) {
      programmeReceiptStoreState(this);
      return appendReceiptInternal(store, session, {
        receipt_type: 'RUN_INTERRUPTED',
        candidate: input.candidate,
        payload: input.payload || { classification: 'RUN_INTERRUPTED' },
        created_at: input.created_at
      });
    },
    readReceiptChain(runId) {
      programmeReceiptStoreState(this);
      if (!isSafeId(runId)) fail('GPR_RUN_ID_INVALID');
      const db = openVerified(config, false);
      try { return readChainDb(db, runId); } finally { db.close(); }
    },
    classifyRecovery(runId, now = Date.now()) {
      programmeReceiptStoreState(this);
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
      programmeReceiptStoreState(this);
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
      programmeReceiptStoreState(this);
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
      programmeReceiptStoreState(this);
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
      programmeReceiptStoreState(this);
      if (!isSafeId(operationId)) fail('GPR_OPERATION_NOT_FOUND');
      const db = openVerified(config, false);
      try {
        const current = operationWithStateDb(db, operationId);
        return deepFreeze({ operation: operationPublic(current.operation), state: current.event.state, events: operationEventsPublic(db, operationId) });
      } finally { db.close(); }
    },
    async reconcileMutationOperation(operationId, authorityReader, providerReader) {
      programmeReceiptStoreState(this);
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
  Object.freeze(store);
  PROGRAMME_RECEIPT_STORE_OWNERS.set(store, { config, instanceId: store.instanceId, processId: process.pid });
  return store;
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

function readAuthorityPacketCli(args) {
  const config = createStoreConfig({
    repository: args.repository,
    parent_issue: Number(args.parent_issue),
    child_issue: Number(args.child_issue),
    stateRoot: args.state_root,
    repositoryRoot: args.repository_root
  });
  if (typeof args.packet_id !== 'string' || typeof args.expected_bindings !== 'string'
    || typeof args.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(args.challenge)) {
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  let expectedBindings;
  try { expectedBindings = packetCanonicalInput(args.expected_bindings); } catch (error) {
    if (error instanceof GprError) throw error;
    packetFail('GPR_PACKET_VALUE_INVALID');
  }
  packetValidateBindings(expectedBindings);
  if (canonicalSerialize(expectedBindings) !== args.expected_bindings) packetFail('GPR_PACKET_VALUE_INVALID');
  const db = openAuthorityPacketVerified(config, false, true);
  let delivery;
  try {
    const identities = readAuthorityPacketRow(db, args.packet_id, expectedBindings);
    const storeIdentity = authorityPacketStoreIdentityDb(db, config);
    const identity = authorityPacketRuntimeIdentity();
    delivery = {
      envelope: packetDeliveryEnvelope(identities, config, storeIdentity, identity.runtime_identity_digest, args.challenge),
      packet: identities.packet
    };
    validateAuthorityPacketDelivery(delivery, {
      expectedBindings,
      packet_id: args.packet_id,
      store_identity_digest: storeIdentity,
      runtime_identity_digest: identity.runtime_identity_digest,
      namespace_digest: config.namespaceDigest,
      challenge: args.challenge
    });
  } finally { db.close(); }
  process.stdout.write(`${canonicalSerialize(delivery)}\n`);
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
  if (args._[0] === 'read-authority-packet') {
    readAuthorityPacketCli(args);
    return;
  }
  if (args._[0] === 'verify-authority-packet-store') {
    const config = createStoreConfig({
      repository: args.repository,
      parent_issue: Number(args.parent_issue),
      child_issue: Number(args.child_issue),
      stateRoot: args.state_root,
      repositoryRoot: args.repository_root
    });
    const db = openAuthorityPacketVerified(config, false, true);
    let storeIdentity;
    try { storeIdentity = authorityPacketStoreIdentityDb(db, config); } finally { db.close(); }
    process.stdout.write(`${canonicalSerialize({
      ok: true,
      schema: AUTHORITY_PACKET_SCHEMA_ID,
      namespace_digest: config.namespaceDigest,
      store_identity_digest: storeIdentity
    })}\n`);
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
    if (error && error.packetBoundary) process.stderr.write(`${canonicalSerialize(packetFailureEnvelope(error))}\n`);
    else {
      const code = error instanceof GprError ? error.code : 'GPR_INTERNAL_ERROR';
      process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    }
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  APPLICATION_ID,
  AUTHORITY_PACKET_CONSUMER_CLASSES,
  AUTHORITY_PACKET_ACCEPTANCE_SCHEMA_ID,
  AUTHORITY_PACKET_CURRENT_SCHEMA_ID,
  AUTHORITY_PACKET_DELIVERY_SCHEMA_ID,
  AUTHORITY_PACKET_EVENT_SCHEMA_ID,
  AUTHORITY_PACKET_LIMITS,
  AUTHORITY_PACKET_REASON_CODES,
  AUTHORITY_PACKET_SCHEMA_ID,
  AUTHORITY_PACKET_STAGES,
  AUTHORITY_PACKET_USER_VERSION,
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
  SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID,
  SEMANTIC_GATE_ADMISSION_SCHEMA_ID,
  TERMINAL_TYPES,
  USER_VERSION,
  ZERO_OPERATION_INVENTORY_DIGEST,
  V3_MIGRATION_PLAN_SCHEMA_ID,
  V3_USER_VERSION,
  GprError,
  assertAuthenticAuthorityPacketStore,
  assertAuthenticSemanticGateAdmission,
  assertRuntimeSupport,
  appendV3ReceiptWithChainDigest,
  authorityPacketIdentities,
  authorityPacketRuntimeIdentity,
  authorityPacketStoreIdentity,
  buildAuthorityPacketMigrationPlan,
  buildAuthorityPacketSchemaSql,
  buildFinalV3SchemaSql,
  buildV2ToV3MigrationPlan,
  createAuthorityPacketStore,
  createProgrammeReceiptStore,
  digestValue,
  canonicalSerialize,
  expectedFinalV3SchemaFingerprint,
  expectedAuthorityPacketSchemaFingerprint,
  expectedV2SchemaFingerprint,
  initialiseAuthorityPacketStore,
  migrateAuthorityPacketStore,
  namespaceDigest,
  packetFailureEnvelope,
  planAuthorityPacketMigration,
  preRecoveryEvidenceDigest,
  validateAuthorityPacket,
  validateAuthorityPacketAcceptance,
  validateAuthorityPacketCurrent,
  validateAuthorityPacketDelivery,
  validateAuthorityPacketDeliveryProcessResult,
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
  validateSemanticGateAdmission,
  validateStart,
  validateVerificationPacket,
  validateVerifierProcessResult,
  validateWindowsStorageProof
});
