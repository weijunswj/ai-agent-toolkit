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

function canonicalRepeatPolicy(approval) {
  return approval.one_shot === true
    ? { mode: 'one_shot', max_count: 1 }
    : { mode: 'bounded_repeat', max_count: approval.max_repeat_count };
}

function repeatPolicyDigest(approval) {
  return sha256(canonicalRepeatPolicy(approval));
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
      repeat_policy_digest: repeatPolicyDigest(approval),
    }),
    repeat_policy: canonicalRepeatPolicy(approval),
    repeat_policy_digest: repeatPolicyDigest(approval),
    ...extra,
  };
}

function compareCanonicalTargetSet(expected, actual) {
  return stableStringify(expected) === stableStringify(actual);
}

function replayIdentity(record, approval) {
  const operation = record?.operation || {};
  return sha256({
    contract_version: approval.contract_version,
    host: approval.host,
    source: approval.source,
    trusted_user_channel: approval.trusted_user_channel,
    exact_operation_digest: approval.exact_operation_digest,
    exact_targets_digest: approval.exact_targets_digest,
    canonical_target_set: approval.canonical_target_set,
    session_id: approval.session_id,
    turn_id: approval.turn_id,
    call_id: approval.call_id,
    operation_class: approval.operation_class,
    issued_at: approval.issued_at,
    expires_at: approval.expires_at,
    operation_digest: operation.input_digest,
    target_digest: operation.target_digest,
    scope: record?.operation?.scope || null,
  });
}

function consumeReplayState(state, identity, request) {
  const consume = typeof state === 'function' ? state : state && typeof state.consume === 'function' ? state.consume.bind(state) : null;
  if (!consume) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNAVAILABLE' };
  if (
    !digest(request?.repeat_policy_digest)
    || !['one_shot', 'bounded_repeat'].includes(request?.repeat_mode)
    || !Number.isInteger(request?.max_repeat_count)
    || request.max_repeat_count < 1
    || (request.repeat_mode === 'one_shot' && request.max_repeat_count !== 1)
  ) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  let result;
  try {
    result = consume(Object.freeze({ identity, ...request }));
  } catch (error) {
    return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  }
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.atomic !== true) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.identity !== identity) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_MISMATCH' };
  if (!Object.hasOwn(result, 'repeat_policy_digest') || !digest(result.repeat_policy_digest)) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_STATE_UNCERTAIN' };
  if (result.repeat_policy_digest !== request.repeat_policy_digest) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_MISMATCH' };
  if (Object.hasOwn(result, 'repeat_mode') && result.repeat_mode !== request.repeat_mode) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_MISMATCH' };
  if (Object.hasOwn(result, 'max_repeat_count') && result.max_repeat_count !== request.max_repeat_count) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_MISMATCH' };
  if (Object.hasOwn(result, 'consumed_count') && (!Number.isInteger(result.consumed_count) || result.consumed_count < 0 || result.consumed_count > request.max_repeat_count)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (Object.hasOwn(result, 'remaining_count') && (!Number.isInteger(result.remaining_count) || result.remaining_count < 0 || result.remaining_count > request.max_repeat_count)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (Object.hasOwn(result, 'consumed_count') && Object.hasOwn(result, 'remaining_count') && result.consumed_count + result.remaining_count !== request.max_repeat_count) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.status === 'consumed' && Object.hasOwn(result, 'consumed_count') && result.consumed_count !== request.expected_consumed_count + 1) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.status !== 'consumed') return { ok: false, reason_code: 'APPROVAL_REPLAY' };
  return { ok: true, remaining_count: result.remaining_count };
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
  const replayState = firstDefined(options.replayState, options.replayStore, null);
  const identity = replayIdentity(record, approval);
  if (approval.one_shot === true) {
    if (Object.hasOwn(approval, 'max_repeat_count')) return invalid('APPROVAL_INVALID');
    if (Object.hasOwn(approval, 'consumed_count') && approval.consumed_count !== 0) return invalid('APPROVAL_REPLAY');
    const consumed = consumeReplayState(replayState, identity, {
      operation_digest: operation.input_digest,
      target_digest: operation.target_digest,
      scope: operation.scope || null,
      expires_at: approval.expires_at,
      one_shot: true,
      repeat_mode: 'one_shot',
      expected_consumed_count: 0,
      max_repeat_count: 1,
      repeat_policy_digest: repeatPolicyDigest(approval),
    });
    if (!consumed.ok) return invalid(consumed.reason_code);
    if (consumed.remaining_count !== undefined && consumed.remaining_count !== 0) return invalid('APPROVAL_REPLAY_STATE_UNCERTAIN');
    return valid(approval, { one_shot: true, repeat_count: 1, replay_identity: identity });
  }

  const count = approval.consumed_count;
  const max = approval.max_repeat_count;
  if (!Number.isInteger(count) || !Number.isInteger(max) || count < 0 || max < 1 || count >= max || max > (policy.approval?.max_repeat_count || 8)) return invalid('APPROVAL_INVALID');
  const consumed = consumeReplayState(replayState, identity, {
    operation_digest: operation.input_digest,
    target_digest: operation.target_digest,
    scope: operation.scope || null,
    expires_at: approval.expires_at,
    one_shot: false,
    repeat_mode: 'bounded_repeat',
    expected_consumed_count: count,
    max_repeat_count: max,
    repeat_policy_digest: repeatPolicyDigest(approval),
  });
  if (!consumed.ok) return invalid(consumed.reason_code);
  const expectedRemaining = max - count - 1;
  if (consumed.remaining_count !== expectedRemaining) return invalid('APPROVAL_REPLAY_STATE_UNCERTAIN');
  return valid(approval, { one_shot: false, repeat_count: count + 1, max_repeat_count: max, replay_identity: identity, remaining_count: expectedRemaining });
}

function verifyApprovalEvidence(record, approvalInput, options = {}) {
  return verifyApproval(record, approvalInput, options);
}

module.exports = {
  APPROVAL_VERSION,
  timestamp,
  validateApprovalShape,
  canonicalRepeatPolicy,
  repeatPolicyDigest,
  replayIdentity,
  consumeReplayState,
  verifyApproval,
  verifyApprovalEvidence,
};
