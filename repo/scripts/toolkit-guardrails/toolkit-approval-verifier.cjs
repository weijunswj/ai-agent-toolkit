'use strict';

const {
  getPolicy,
  sha256,
  stableStringify,
} = require('./toolkit-guardrail-policy.cjs');
const {
  canonicalTargetSet,
} = require('./toolkit-operation-normalizer.cjs');

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 100000000000 ? value * 1000 : value;
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

function verifyApproval(record, approvalInput, options = {}) {
  const policy = options.policy || getPolicy();
  const approval = approvalInput || record?.approval;
  if (!approval || typeof approval !== 'object') return invalid('APPROVAL_MISSING');
  if (options.deny === true || options.operation_decision === 'deny' || ['secret-exfiltration', 'guardrail-bypass', 'protected-target', 'role-boundary-violation'].includes(record?.operation?.mutation_class)) {
    return invalid('DENY_NOT_OVERRIDEABLE');
  }
  const required = [
    'source',
    'trusted_user_channel',
    'host',
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
  if (required.some((key) => approval[key] === null || approval[key] === undefined || approval[key] === '')) return invalid('APPROVAL_INVALID');
  if (approval.contract_version && approval.contract_version !== 'toolkit.guardrail.approval.v1') return invalid('APPROVAL_INVALID');

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
  if (approval.one_shot !== true) {
    const count = approval.consumed_count;
    const max = approval.max_repeat_count;
    if (!Number.isInteger(count) || !Number.isInteger(max) || count < 0 || max < 1 || count >= max || max > (policy.approval?.max_repeat_count || 8)) return invalid('APPROVAL_INVALID');
  } else if (approval.consumed_count !== undefined && approval.consumed_count !== null && approval.consumed_count !== 0) {
    return invalid('APPROVAL_REPLAY');
  }

  return valid(approval, {
    one_shot: approval.one_shot === true,
    repeat_count: approval.one_shot === true ? 1 : approval.consumed_count + 1,
  });
}

function verifyApprovalEvidence(record, approvalInput, options = {}) {
  return verifyApproval(record, approvalInput, options);
}

module.exports = {
  timestamp,
  verifyApproval,
  verifyApprovalEvidence,
};
