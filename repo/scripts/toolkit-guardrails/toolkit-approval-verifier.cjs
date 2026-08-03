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
const REPLAY_STORE_CONTRACT_VERSION = 'toolkit.guardrail.replay-store.v1';
const REPLAY_SLOT_KEYING = 'stable-replay-identity-only';
const authoritativeReplaySlots = new Map();
const authoritativeReplayQueues = new Map();
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
      issued_at: approval.issued_at,
      expires_at: approval.expires_at,
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
    operation_digest: operation.input_digest,
    target_digest: operation.target_digest,
    scope: record?.operation?.scope || null,
  });
}

function replaySlotKey(record, approval) {
  return replayIdentity(record, approval);
}

function replayRequest(slotKey, request) {
  return Object.freeze({
    contract_version: REPLAY_STORE_CONTRACT_VERSION,
    keying: REPLAY_SLOT_KEYING,
    slot_key: slotKey,
    operation_digest: request.operation_digest,
    target_digest: request.target_digest,
    scope: request.scope,
    issued_at: timestamp(request.issued_at),
    expires_at: timestamp(request.expires_at),
    repeat_mode: request.repeat_mode,
    max_repeat_count: request.max_repeat_count,
    expected_consumed_count: request.expected_consumed_count,
    policy_digest: request.repeat_policy_digest,
  });
}

function validReplayRequest(request) {
  return digest(request?.slot_key)
    && digest(request?.policy_digest)
    && ['one_shot', 'bounded_repeat'].includes(request?.repeat_mode)
    && Number.isInteger(request?.max_repeat_count)
    && request.max_repeat_count >= 1
    && (request.repeat_mode !== 'one_shot' || request.max_repeat_count === 1)
    && Number.isInteger(timestamp(request.issued_at))
    && Number.isInteger(timestamp(request.expires_at))
    && Number.isInteger(request?.expected_consumed_count)
    && request.expected_consumed_count >= 0;
}

function validReplayRecord(record) {
  return isRecord(record)
    && record.contract_version === REPLAY_STORE_CONTRACT_VERSION
    && digest(record.slot_key)
    && digest(record.pinned_policy_digest)
    && ['one_shot', 'bounded_repeat'].includes(record.pinned_repeat_mode)
    && Number.isInteger(record.pinned_max_repeat_count)
    && record.pinned_max_repeat_count >= 1
    && Number.isInteger(record.pinned_issued_at)
    && Number.isInteger(record.pinned_expires_at)
    && Number.isInteger(record.consumed_count)
    && record.consumed_count >= 0
    && record.consumed_count <= record.pinned_max_repeat_count;
}

function replayFailure(reasonCode) {
  return { ok: false, reason_code: reasonCode };
}

function consumeAuthoritativeReplay(slotKey, request) {
  const canonicalRequest = replayRequest(slotKey, request);
  if (!validReplayRequest(canonicalRequest)) return replayFailure('APPROVAL_REPLAY_STATE_UNCERTAIN');

  let record = authoritativeReplaySlots.get(slotKey);
  if (!record) {
    record = {
      contract_version: REPLAY_STORE_CONTRACT_VERSION,
      slot_key: slotKey,
      pinned_policy_digest: canonicalRequest.policy_digest,
      pinned_repeat_mode: canonicalRequest.repeat_mode,
      pinned_max_repeat_count: canonicalRequest.max_repeat_count,
      pinned_issued_at: canonicalRequest.issued_at,
      pinned_expires_at: canonicalRequest.expires_at,
      consumed_count: 0,
    };
    authoritativeReplaySlots.set(slotKey, record);
  }
  if (!validReplayRecord(record)) return replayFailure('APPROVAL_REPLAY_STATE_UNCERTAIN');
  if (record.pinned_policy_digest !== canonicalRequest.policy_digest
    || record.pinned_repeat_mode !== canonicalRequest.repeat_mode
    || record.pinned_max_repeat_count !== canonicalRequest.max_repeat_count) {
    return replayFailure('APPROVAL_REPLAY_POLICY_MISMATCH');
  }
  if (record.pinned_issued_at !== canonicalRequest.issued_at
    || record.pinned_expires_at !== canonicalRequest.expires_at) {
    return replayFailure('APPROVAL_REPLAY_EXPIRY_MISMATCH');
  }
  if (canonicalRequest.expected_consumed_count !== record.consumed_count) {
    return replayFailure(canonicalRequest.expected_consumed_count < record.consumed_count
      ? 'APPROVAL_REPLAY'
      : 'APPROVAL_REPLAY_STATE_UNCERTAIN');
  }
  if (record.consumed_count >= record.pinned_max_repeat_count) return replayFailure('APPROVAL_REPLAY');

  record.consumed_count += 1;
  const remaining = record.pinned_max_repeat_count - record.consumed_count;
  return {
    ok: true,
    consumed_count: record.consumed_count,
    remaining_count: remaining,
    exhausted: remaining === 0,
  };
}

function consumeAuthoritativeReplayAsync(slotKey, request) {
  const previous = authoritativeReplayQueues.get(slotKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  authoritativeReplayQueues.set(slotKey, current);
  return previous.then(() => consumeAuthoritativeReplay(slotKey, request)).catch(() => replayFailure('APPROVAL_REPLAY_STATE_UNCERTAIN')).finally(() => {
    release();
    if (authoritativeReplayQueues.get(slotKey) === current) authoritativeReplayQueues.delete(slotKey);
  });
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

function hasInjectedReplayAuthority(options) {
  if (!isRecord(options)) return false;
  return Object.keys(options).some((key) => {
    const normalized = key.toLowerCase().replace(/[-_]/g, '');
    const suspicious = normalized.includes('replay')
      || normalized === 'approvalverifier'
      || normalized === 'verifier'
      || normalized === 'verify'
      || normalized.includes('approval')
      || /(?:callback|consumer|consume|state|store|proof|slot|factory|register)/i.test(key);
    if (!suspicious) return false;
    if (normalized.includes('replay') || normalized.includes('approval') || normalized === 'verifier' || normalized === 'verify') return true;
    if (options[key] === null || options[key] === undefined) return true;
    if (typeof options[key] === 'function') return true;
    return isRecord(options[key]) || options[key] instanceof Promise;
  });
}

function prepareApprovalVerification(record, approvalInput, options = {}) {
  if (hasInjectedReplayAuthority(options)) return invalid('APPROVAL_REPLAY_STORE_UNTRUSTED');
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
  const identity = replaySlotKey(record, approval);
  if (approval.one_shot === true) {
    if (Object.hasOwn(approval, 'max_repeat_count')) return invalid('APPROVAL_INVALID');
    if (Object.hasOwn(approval, 'consumed_count') && approval.consumed_count !== 0) return invalid('APPROVAL_REPLAY');
    return {
      approval,
      identity,
      one_shot: true,
      expected_remaining: 0,
      request: {
        operation_digest: operation.input_digest,
        target_digest: operation.target_digest,
        scope: operation.scope || null,
        issued_at: approval.issued_at,
        expires_at: approval.expires_at,
        repeat_mode: 'one_shot',
        expected_consumed_count: 0,
        max_repeat_count: 1,
        repeat_policy_digest: repeatPolicyDigest(approval),
      },
    };
  }

  const count = approval.consumed_count;
  const max = approval.max_repeat_count;
  if (!Number.isInteger(count) || !Number.isInteger(max) || count < 0 || max < 1 || count >= max || max > (policy.approval?.max_repeat_count || 8)) return invalid('APPROVAL_INVALID');
  return {
    approval,
    identity,
    one_shot: false,
    expected_remaining: max - count - 1,
    request: {
      operation_digest: operation.input_digest,
      target_digest: operation.target_digest,
      scope: operation.scope || null,
      issued_at: approval.issued_at,
      expires_at: approval.expires_at,
      repeat_mode: 'bounded_repeat',
      expected_consumed_count: count,
      max_repeat_count: max,
      repeat_policy_digest: repeatPolicyDigest(approval),
    },
  };
}

function finishApprovalVerification(prepared, consumed) {
  if (!consumed.ok) return invalid(consumed.reason_code);
  if (consumed.remaining_count !== prepared.expected_remaining) return invalid('APPROVAL_REPLAY_STATE_UNCERTAIN');
  if (prepared.one_shot) {
    if (consumed.remaining_count !== 0) return invalid('APPROVAL_REPLAY_STATE_UNCERTAIN');
    return valid(prepared.approval, { one_shot: true, repeat_count: 1, replay_identity: prepared.identity });
  }
  return valid(prepared.approval, {
    one_shot: false,
    repeat_count: prepared.request.expected_consumed_count + 1,
    max_repeat_count: prepared.request.max_repeat_count,
    replay_identity: prepared.identity,
    remaining_count: prepared.expected_remaining,
  });
}

function verifyApproval(record, approvalInput, options = {}) {
  const prepared = prepareApprovalVerification(record, approvalInput, options);
  if (!prepared || prepared.valid === false) return prepared;
  const consumed = consumeAuthoritativeReplay(prepared.identity, prepared.request);
  return finishApprovalVerification(prepared, consumed);
}

async function verifyApprovalAsync(record, approvalInput, options = {}) {
  const prepared = prepareApprovalVerification(record, approvalInput, options);
  if (!prepared || prepared.valid === false) return prepared;
  const consumed = await consumeAuthoritativeReplayAsync(prepared.identity, prepared.request);
  return finishApprovalVerification(prepared, consumed);
}

function verifyApprovalEvidence(record, approvalInput, options = {}) {
  return verifyApproval(record, approvalInput, options);
}

async function verifyApprovalEvidenceAsync(record, approvalInput, options = {}) {
  return verifyApprovalAsync(record, approvalInput, options);
}

module.exports = {
  APPROVAL_VERSION,
  REPLAY_STORE_CONTRACT_VERSION,
  REPLAY_SLOT_KEYING,
  timestamp,
  validateApprovalShape,
  canonicalRepeatPolicy,
  repeatPolicyDigest,
  replayIdentity,
  replaySlotKey,
  verifyApproval,
  verifyApprovalAsync,
  verifyApprovalEvidence,
  verifyApprovalEvidenceAsync,
};
