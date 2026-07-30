'use strict';

const {
  getPolicy,
  sha256,
  stableStringify,
} = require('./toolkit-guardrail-policy.cjs');
const {
  canonicalTargetSet,
} = require('./toolkit-operation-normalizer.cjs');

const APPROVAL_VERSION = 'toolkit.guardrail.approval.v1';
const APPROVAL_FIELDS = new Set([
  'contract_version',
  'host',
  'source',
  'trusted_user_channel',
  'exact_operation_digest',
  'exact_targets_digest',
  'canonical_target_set',
  'session_id',
  'turn_id',
  'call_id',
  'operation_class',
  'issued_at',
  'expires_at',
  'one_shot',
  'consumed',
  'consumed_count',
  'max_repeat_count',
  'replay_detected',
]);
const TARGET_CLASSES = new Set([
  'canonical-repository',
  'canonical-worktree',
  'approved-additional-root',
  'sibling-repository',
  'parent-workspace',
  'outside-repository',
  'external-system',
  'secret-bearing',
  'protected-target',
  'unresolved-target',
  'mixed-targets',
  'unknown-target',
]);
const LINK_TYPES = new Set(['none', 'symlink', 'junction', 'reparse-point']);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)) {
    return value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function invalid(reasonCode, extra = {}) {
  return {
    valid: false,
    reason_code: reasonCode,
    approval_digest: null,
    ...extra,
  };
}

function valid(approval, extra = {}) {
  return {
    valid: true,
    reason_code: 'APPROVAL_EXACT_MATCH',
    approval_digest: sha256({
      contract_version: approval.contract_version,
      source: approval.source,
      trusted_user_channel: approval.trusted_user_channel,
      exact_operation_digest: approval.exact_operation_digest,
      exact_targets_digest: approval.exact_targets_digest,
      session_id: approval.session_id,
      turn_id: approval.turn_id,
      call_id: approval.call_id,
    }),
    ...extra,
  };
}

function compareCanonicalTargetSet(expected, actual) {
  return stableStringify(expected) === stableStringify(actual);
}

function validateTargetSet(value) {
  if (!Array.isArray(value)) return false;
  return value.every((target) => {
    if (!isRecord(target)) return false;
    const fields = Object.keys(target);
    if (fields.some((field) => !['target_class', 'status', 'link_type', 'path_digest'].includes(field))) return false;
    return TARGET_CLASSES.has(target.target_class)
      && nonEmptyString(target.status)
      && LINK_TYPES.has(target.link_type)
      && digest(target.path_digest);
  });
}

function validateTimestampField(value) {
  return (typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value)))
    && Number.isFinite(timestamp(value));
}

function validateApprovalShape(approval) {
  if (!isRecord(approval)) return 'APPROVAL_INVALID';
  if (approval.malformed === true) return 'APPROVAL_VERSION_INVALID';
  if (Object.keys(approval).some((key) => !APPROVAL_FIELDS.has(key))) return 'APPROVAL_UNDECLARED_FIELD';
  if (approval.contract_version !== APPROVAL_VERSION) return 'APPROVAL_VERSION_INVALID';

  const required = [
    'contract_version',
    'host',
    'source',
    'trusted_user_channel',
    'exact_operation_digest',
    'exact_targets_digest',
    'canonical_target_set',
    'session_id',
    'turn_id',
    'call_id',
    'operation_class',
    'issued_at',
    'expires_at',
    'one_shot',
    'consumed',
  ];
  if (required.some((key) => !Object.hasOwn(approval, key))) return 'APPROVAL_INVALID';
  for (const key of ['host', 'source', 'trusted_user_channel', 'session_id', 'turn_id', 'call_id', 'operation_class']) {
    if (!nonEmptyString(approval[key])) return 'APPROVAL_INVALID';
  }
  if (!digest(approval.exact_operation_digest) || !digest(approval.exact_targets_digest)) return 'APPROVAL_INVALID';
  if (!validateTargetSet(approval.canonical_target_set)) return 'APPROVAL_INVALID';
  if (!validateTimestampField(approval.issued_at) || !validateTimestampField(approval.expires_at)) return 'APPROVAL_INVALID';
  if (typeof approval.one_shot !== 'boolean' || typeof approval.consumed !== 'boolean') return 'APPROVAL_INVALID';
  if (Object.hasOwn(approval, 'consumed_count') && (!Number.isInteger(approval.consumed_count) || approval.consumed_count < 0)) return 'APPROVAL_INVALID';
  if (Object.hasOwn(approval, 'max_repeat_count') && (!Number.isInteger(approval.max_repeat_count) || approval.max_repeat_count < 1)) return 'APPROVAL_INVALID';
  if (Object.hasOwn(approval, 'replay_detected') && typeof approval.replay_detected !== 'boolean') return 'APPROVAL_INVALID';
  return null;
}

function verifyApproval(record, approvalInput, options = {}) {
  const policy = options.policy || getPolicy();
  const approval = approvalInput === undefined ? record?.approval : approvalInput;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) return invalid('APPROVAL_MISSING');
  if (
    options.deny === true
    || options.operation_decision === 'deny'
    || [
      'secret-exfiltration',
      'secret-dump',
      'guardrail-bypass',
      'protected-target',
      'role-boundary-violation',
      'catastrophic-target',
    ].includes(record?.operation?.mutation_class)
  ) return invalid('DENY_NOT_OVERRIDEABLE');

  const shapeError = validateApprovalShape(approval);
  if (shapeError) return invalid(shapeError);

  const trustedChannels = policy.approval?.trusted_channels || [];
  if (!trustedChannels.includes(approval.trusted_user_channel) || !trustedChannels.includes(approval.source)) return invalid('APPROVAL_INVALID');
  if (policy.approval?.native_state_non_equivalents?.includes(approval.source) || policy.approval?.native_state_non_equivalents?.includes(approval.trusted_user_channel)) return invalid('APPROVAL_NATIVE_STATE_NOT_EQUIVALENT');

  const session = record?.session || {};
  if (approval.host !== session.host) return invalid('APPROVAL_HOST_MISMATCH');
  if (approval.session_id !== session.session_id) return invalid('APPROVAL_SESSION_MISMATCH');
  if (approval.turn_id !== session.turn_id) return invalid('APPROVAL_TURN_MISMATCH');
  if (approval.call_id !== session.call_id) return invalid('APPROVAL_CALL_MISMATCH');

  const operation = record?.operation || {};
  if (approval.exact_operation_digest !== operation.input_digest) return invalid('APPROVAL_OPERATION_MISMATCH');
  if (approval.exact_targets_digest !== operation.target_digest) return invalid('APPROVAL_TARGET_EXPANSION');
  const expectedTargets = canonicalTargetSet(operation.targets || []);
  if (!compareCanonicalTargetSet(expectedTargets, approval.canonical_target_set)) return invalid('APPROVAL_TARGET_EXPANSION');
  if (approval.operation_class !== operation.mutation_class) return invalid('APPROVAL_OPERATION_MISMATCH');

  const now = timestamp(firstDefined(options.now, Date.now()));
  const issued = timestamp(approval.issued_at);
  const expires = timestamp(approval.expires_at);
  if (![now, issued, expires].every(Number.isFinite) || issued > now || expires <= now || expires <= issued) return invalid('APPROVAL_EXPIRED');

  if (approval.replay_detected === true || approval.consumed === true) return invalid('APPROVAL_REPLAY');
  if (approval.one_shot === true) {
    if (Object.hasOwn(approval, 'max_repeat_count')) return invalid('APPROVAL_INVALID');
    if (Object.hasOwn(approval, 'consumed_count') && approval.consumed_count !== 0) return invalid('APPROVAL_REPLAY');
    return valid(approval, { one_shot: true, repeat_count: 1 });
  }

  const count = approval.consumed_count;
  const max = approval.max_repeat_count;
  if (!Number.isInteger(count) || !Number.isInteger(max) || count < 0 || max < 1 || count >= max || max > (policy.approval?.max_repeat_count || 8)) return invalid('APPROVAL_INVALID');
  return valid(approval, { one_shot: false, repeat_count: count + 1, max_repeat_count: max });
}

function verifyApprovalEvidence(record, approvalInput, options = {}) {
  return verifyApproval(record, approvalInput, options);
}

module.exports = {
  APPROVAL_VERSION,
  timestamp,
  validateApprovalShape,
  verifyApproval,
  verifyApprovalEvidence,
};
