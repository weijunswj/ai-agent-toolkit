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
const admittedReplayStores = new WeakSet();
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

function replaySlotProof(slotKey) {
  return sha256({
    contract_version: REPLAY_STORE_CONTRACT_VERSION,
    keying: REPLAY_SLOT_KEYING,
    slot_key: slotKey,
  });
}

function createTrustedReplayStore(consume, provenance = {}) {
  if (typeof consume !== 'function') return null;
  const state = Object.freeze({
    contract_version: REPLAY_STORE_CONTRACT_VERSION,
    provenance: Object.freeze({ ...provenance }),
    consume,
  });
  if (!trustedReplayStoreShape(state)) return null;
  admittedReplayStores.add(state);
  return state;
}

function trustedReplayStoreShape(state) {
  if (!isRecord(state) || typeof state.consume !== 'function') return false;
  if (state.contract_version !== REPLAY_STORE_CONTRACT_VERSION) return false;
  const provenance = state.provenance;
  return isRecord(provenance)
    && provenance.status === 'verified'
    && provenance.trusted === true
    && nonEmptyString(provenance.source)
    && provenance.capability === 'authoritative-replay-slot'
    && provenance.keying === REPLAY_SLOT_KEYING;
}

function trustedReplayStore(state) {
  return admittedReplayStores.has(state) && trustedReplayStoreShape(state);
}

function replayRequest(slotKey, request) {
  return Object.freeze({
    contract_version: REPLAY_STORE_CONTRACT_VERSION,
    keying: REPLAY_SLOT_KEYING,
    slot_key: slotKey,
    slot_proof: replaySlotProof(slotKey),
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

function validateReplayResponse(result, request) {
  if (!isRecord(result)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.contract_version !== REPLAY_STORE_CONTRACT_VERSION) return { ok: false, reason_code: 'APPROVAL_REPLAY_STORE_CONTRACT_INVALID' };
  if (result.atomic !== true) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.slot_key !== request.slot_key) return { ok: false, reason_code: 'APPROVAL_REPLAY_SLOT_MISMATCH' };
  if (!digest(result.slot_proof)) return { ok: false, reason_code: 'APPROVAL_REPLAY_SLOT_PROOF_UNCERTAIN' };
  if (result.slot_proof !== replaySlotProof(request.slot_key)) return { ok: false, reason_code: 'APPROVAL_REPLAY_SLOT_PROOF_MISMATCH' };
  if (!['consumed', 'already-consumed', 'exhausted', 'policy-mismatch', 'expiry-mismatch', 'state-mismatch'].includes(result.status)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (!digest(result.pinned_policy_digest)) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_STATE_UNCERTAIN' };
  if (!['one_shot', 'bounded_repeat'].includes(result.pinned_repeat_mode)) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_STATE_UNCERTAIN' };
  if (!Number.isInteger(result.pinned_max_repeat_count) || result.pinned_max_repeat_count < 1) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_STATE_UNCERTAIN' };
  if (!Number.isInteger(result.consumed_count) || result.consumed_count < 0 || result.consumed_count > result.pinned_max_repeat_count) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (!Number.isInteger(result.remaining_count) || result.remaining_count < 0 || result.remaining_count > result.pinned_max_repeat_count) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.consumed_count + result.remaining_count !== result.pinned_max_repeat_count) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (typeof result.exhausted !== 'boolean' || result.exhausted !== (result.remaining_count === 0)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (!Number.isInteger(result.pinned_issued_at) || !Number.isInteger(result.pinned_expires_at)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  if (result.pinned_issued_at !== request.issued_at || result.pinned_expires_at !== request.expires_at) return { ok: false, reason_code: 'APPROVAL_REPLAY_EXPIRY_MISMATCH' };
  if (result.pinned_policy_digest !== request.policy_digest
    || result.pinned_repeat_mode !== request.repeat_mode
    || result.pinned_max_repeat_count !== request.max_repeat_count) return { ok: false, reason_code: 'APPROVAL_REPLAY_POLICY_MISMATCH' };
  if (result.status === 'consumed') {
    if (result.consumed_count !== request.expected_consumed_count + 1) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
    return { ok: true, remaining_count: result.remaining_count, consumed_count: result.consumed_count, exhausted: result.exhausted };
  }
  return { ok: false, reason_code: result.status === 'expiry-mismatch' ? 'APPROVAL_REPLAY_EXPIRY_MISMATCH' : result.status === 'policy-mismatch' ? 'APPROVAL_REPLAY_POLICY_MISMATCH' : 'APPROVAL_REPLAY' };
}

function consumeReplayState(state, slotKey, request) {
  if (state === null || state === undefined) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNAVAILABLE' };
  if (!trustedReplayStore(state)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STORE_UNTRUSTED' };
  if (!digest(request?.repeat_policy_digest)
    || !['one_shot', 'bounded_repeat'].includes(request?.repeat_mode)
    || !Number.isInteger(request?.max_repeat_count)
    || request.max_repeat_count < 1
    || (request.repeat_mode === 'one_shot' && request.max_repeat_count !== 1)
    || !Number.isInteger(timestamp(request.issued_at))
    || !Number.isInteger(timestamp(request.expires_at))) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  let result;
  try {
    result = state.consume(replayRequest(slotKey, request));
  } catch (error) {
    return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  }
  if (result && typeof result.then === 'function') return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  return validateReplayResponse(result, replayRequest(slotKey, request));
}

async function consumeReplayStateAsync(state, slotKey, request) {
  if (state === null || state === undefined) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNAVAILABLE' };
  if (!trustedReplayStore(state)) return { ok: false, reason_code: 'APPROVAL_REPLAY_STORE_UNTRUSTED' };
  if (!digest(request?.repeat_policy_digest)
    || !['one_shot', 'bounded_repeat'].includes(request?.repeat_mode)
    || !Number.isInteger(request?.max_repeat_count)
    || request.max_repeat_count < 1
    || (request.repeat_mode === 'one_shot' && request.max_repeat_count !== 1)
    || !Number.isInteger(timestamp(request.issued_at))
    || !Number.isInteger(timestamp(request.expires_at))) return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  const canonicalRequest = replayRequest(slotKey, request);
  let result;
  try {
    result = await state.consume(canonicalRequest);
  } catch (error) {
    return { ok: false, reason_code: 'APPROVAL_REPLAY_STATE_UNCERTAIN' };
  }
  return validateReplayResponse(result, canonicalRequest);
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

function prepareApprovalVerification(record, approvalInput, options = {}) {
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
  const identity = replaySlotKey(record, approval);
  if (approval.one_shot === true) {
    if (Object.hasOwn(approval, 'max_repeat_count')) return invalid('APPROVAL_INVALID');
    if (Object.hasOwn(approval, 'consumed_count') && approval.consumed_count !== 0) return invalid('APPROVAL_REPLAY');
    return {
      approval,
      replayState,
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
    replayState,
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
  const consumed = consumeReplayState(prepared.replayState, prepared.identity, prepared.request);
  return finishApprovalVerification(prepared, consumed);
}

async function verifyApprovalAsync(record, approvalInput, options = {}) {
  const prepared = prepareApprovalVerification(record, approvalInput, options);
  if (!prepared || prepared.valid === false) return prepared;
  const consumed = await consumeReplayStateAsync(prepared.replayState, prepared.identity, prepared.request);
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
  replaySlotProof,
  createTrustedReplayStore,
  trustedReplayStore,
  consumeReplayState,
  consumeReplayStateAsync,
  verifyApproval,
  verifyApprovalAsync,
  verifyApprovalEvidence,
  verifyApprovalEvidenceAsync,
};
