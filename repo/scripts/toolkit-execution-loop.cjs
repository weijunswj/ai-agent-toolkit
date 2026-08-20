'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const a1 = require('./toolkit-control-plane/control-plane-kernel.cjs');
const a2 = require('./toolkit-capability-registry.cjs');

const CONTRACTS = Object.freeze([
  'toolkit.execution-loop.request.v1',
  'toolkit.execution-loop.route-plan.v1',
  'toolkit.execution-loop.run-receipt.v1',
  'toolkit.execution-loop.workspace-receipt.v1',
  'toolkit.execution-loop.terminal-packet.v1',
]);
const EXECUTION_STATES = Object.freeze(['planned', 'admitted', 'workspace-ready', 'running', 'validating', 'publication-pending', 'terminal-success', 'terminal-failure', 'terminal-blocked', 'interrupted']);
const WORKSPACE_DISPOSITIONS = Object.freeze(['cleaned', 'preserved', 'quarantined']);
const HOST_CLASSIFICATIONS = Object.freeze(['hard-runtime-enforcement', 'configuration-backstop', 'guidance-only', 'unsupported']);
const LIMITS = Object.freeze({ idLength: 128, laneCount: 16, relativePathLength: 512, commitMessageLength: 512, stateBytes: 1024 * 1024, leaseLifetimeMs: 300000 });
const POLICY = Object.freeze({
  schema_version: 1,
  contract_ids: CONTRACTS,
  default_mode: 'root-only',
  a2_capability: 'execution_loop',
  a2_consent: Object.freeze({ enabled_required: true, revalidate_before_running: true, revalidate_before_atomic_batch: true, blocked_run_state: 'workspace-ready', fail_closed_states: Object.freeze(['disabled', 'unresolved', 'malformed', 'interrupted']) }),
  a1_operation: 'git.commit',
  a1: Object.freeze({ sole_operation_authority: true, public_issuer: false, a3_ticket_format: false, git_stage_operation: false }),
  routing: Object.freeze({ workspace_receipt_required_before_substantive_start: true, substantive_start_state: 'workspace-ready', exact_start_binding: Object.freeze(['run_id', 'repository_id', 'authorized_ref_digest', 'current_authority_digest', 'route_plan', 'workspace_receipt', 'snapshot_commit', 'snapshot_tree']) }),
  live_authority: Object.freeze({ mandatory_provider_for_typed_commit: true, revalidate_before_workspace_start: true, revalidate_before_typed_commit: true, workspace_snapshot_observation_required: true, workspace_snapshot_verification: 'mandatory_synchronous_positive', expected_snapshot_substitution: false }),
  worktree: Object.freeze({ canonical_status_fields: Object.freeze(['staged_paths', 'unstaged_paths', 'untracked_paths']), out_of_scope_changes: 'fail_closed' }),
  launch: Object.freeze({ prepare_inert: true, atomic_batch_commit: true, per_lane_start: false, rollback_is_not_zero_launch: true }),
  mutation_lease: Object.freeze({ required_before_stage: true, revalidate_before_commit: true, exact_owner: true, stale_takeover: false, uncertain_preserves: true, safe_terminal_release: true, durable_evidence_required_for_release: true, terminal_artifacts_required_for_release: true, caller_labels_authoritative: false }),
  durable_artifacts: Object.freeze({ required_for_release: Object.freeze(['workspace-receipt', 'terminal-packet']), key_binding: Object.freeze(['repository_id', 'authorized_ref_digest', 'run_id', 'artifact_type']), atomic_same_directory_write: true, readback_verify: true, exact_cross_artifact_match_before_release: true }),
  durable_state_root: '~/.ai-agent-toolkit/user-state/execution-loop/',
  durable_forbidden: ['raw_remote', 'raw_absolute_path', 'prompt', 'model_output', 'repository_contents', 'credentials', 'secret_values', 'environment_values', 'a1_ticket'],
  publication: Object.freeze({ optional: true, branch_operation: 'git.branch', commit_operation: 'git.commit', push_operation: 'git.push', direct_main_push: false, force: false, merge: false, ready: false, review_mutation: false, web_finality: false }),
});
const TRANSITIONS = Object.freeze({
  planned: ['admitted'],
  admitted: ['workspace-ready'],
  'workspace-ready': ['running'],
  running: ['validating', 'interrupted'],
  validating: ['publication-pending', 'terminal-success', 'terminal-failure', 'terminal-blocked', 'interrupted'],
  'publication-pending': ['terminal-success', 'terminal-failure', 'terminal-blocked', 'interrupted'],
  'terminal-success': [],
  'terminal-failure': [],
  'terminal-blocked': [],
  interrupted: [],
});
const TERMINAL_OUTCOMES = Object.freeze({ success: 'terminal-success', failure: 'terminal-failure', blocked: 'terminal-blocked', interrupted: 'interrupted' });
const SAFE_SETUP_OPERATIONS = Object.freeze(['fetch', 'safe-directory-check', 'checkout-detached', 'verify-snapshot']);
const DURABLE_ARTIFACT_TYPES = Object.freeze(['workspace-receipt', 'terminal-packet']);
const FORBIDDEN_DURABLE_KEYS = /^(raw|absolute|private|secret|credential|password|prompt|model_output|tool_output|repository_contents|environment|env|a1_ticket|ticket|issuer|token|remote_url|remote_userinfo|path)$/i;

class ExecutionLoopError extends Error {
  constructor(code, evidence = {}) {
    super(code);
    this.name = 'ExecutionLoopError';
    this.code = code;
    this.evidence = evidence;
  }
}

function fail(code, evidence = {}) {
  throw new ExecutionLoopError(code, evidence);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('CANONICAL_VALUE_INVALID');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalSerialize).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort().map((key) => canonicalSerialize(key) + ':' + canonicalSerialize(value[key])).join(',') + '}';
  fail('CANONICAL_VALUE_INVALID');
}

function digestValue(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha1(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isSafeId(value, allowSlash = false) {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.idLength) return false;
  if (/[\0\r\n\t]/.test(value) || value.startsWith('-') || value.includes('..')) return false;
  if (!allowSlash && /[\\/]/.test(value)) return false;
  if (allowSlash && (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value))) return false;
  return /^[A-Za-z0-9._:/-]+$/.test(value);
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.relativePathLength) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value) || value.startsWith('-')) return false;
  if (/[\0\r\n\t\\]/.test(value) || value.includes('//')) return false;
  return value.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('-') && part !== '.git');
}

function isSafeRef(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.idLength && value.startsWith('refs/')
    && !/[\0\r\n\t\\\s]/.test(value) && !value.includes('..') && !value.endsWith('/') && !value.includes('//');
}

function isSafeHandle(value) {
  return isSafeId(value, true) && !value.includes('..') && !value.includes('://');
}

function isoNow(now = Date.now()) {
  if (!Number.isFinite(now)) fail('CLOCK_INVALID');
  return new Date(now).toISOString();
}

function contractRecord(contractVersion, fields) {
  return deepFreeze({ contract_version: contractVersion, ...fields });
}

function invokeSync(fn, receiver, argument, code) {
  let result;
  try {
    result = fn.call(receiver, argument);
  } catch (_error) {
    fail(code);
  }
  if (result && typeof result.then === 'function') fail(code);
  return result;
}

function assertPrivacySafe(value, location = 'record', seen = new Set()) {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && (/https?:\/\//i.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/'))) fail('DURABLE_PRIVACY_VIOLATION', { location });
    return true;
  }
  if (seen.has(value)) fail('DURABLE_CYCLE');
  seen.add(value);
  if (Array.isArray(value)) value.forEach((child, index) => assertPrivacySafe(child, location + '[' + index + ']', seen));
  else Object.entries(value).forEach(([key, child]) => {
    if (FORBIDDEN_DURABLE_KEYS.test(key)) fail('DURABLE_PRIVACY_VIOLATION', { location: location + '.' + key });
    if (/^(remote|url|path)$/i.test(key) && typeof child === 'string') fail('DURABLE_PRIVACY_VIOLATION', { location: location + '.' + key });
    assertPrivacySafe(child, location + '.' + key, seen);
  });
  seen.delete(value);
  return true;
}

function laneId(value) {
  if (typeof value === 'string' && isSafeId(value)) return value;
  if (isRecord(value) && isSafeId(value.id)) return value.id;
  fail('LANE_ID_INVALID');
}

function normalizeRequest(options = {}) {
  if (isRecord(options.request) && options.request.contract_version === CONTRACTS[0]) return validateRequest(options.request);
  const task = isRecord(options.task) ? options.task : {};
  const authority = isRecord(options.authority) ? options.authority : {};
  const taskId = task.id || task.task_id;
  const taskDigest = task.digest || task.task_digest;
  const repositoryId = options.repository_id || (isRecord(options.repository) && options.repository.repository_id);
  const refDigest = options.authorized_ref_digest || (isRecord(options.repository) && options.repository.authorized_ref_digest);
  const authorityDigest = options.current_authority_digest || options.authority_digest || authority.authority_digest;
  if (!isSafeId(taskId) || !isDigest(taskDigest)) fail('TASK_BINDING_INVALID');
  if (!isDigest(repositoryId) || !isDigest(refDigest)) fail('REPOSITORY_BINDING_INVALID');
  if (!isDigest(authorityDigest)) fail('RUN_AUTHORITY_REQUIRED');
  const rawLanes = Array.isArray(authority.lanes) ? authority.lanes : [];
  if (rawLanes.length > LIMITS.laneCount) fail('LANE_SET_OVERSIZED');
  const requestedLanes = rawLanes.map(laneId);
  if (new Set(requestedLanes).size !== requestedLanes.length) fail('LANE_SET_DUPLICATE');
  const delegated = authority.delegated === true;
  if (!delegated && requestedLanes.length !== 0) fail('DELEGATION_NOT_AUTHORIZED');
  const requestId = options.request_id || 'request-' + digestValue({ taskId, taskDigest, repositoryId, refDigest, authorityDigest }).slice(0, 24);
  if (!isSafeId(requestId)) fail('REQUEST_ID_INVALID');
  return validateRequest(contractRecord(CONTRACTS[0], {
    request_id: requestId,
    task_id: taskId,
    task_digest: taskDigest,
    repository_id: repositoryId,
    authorized_ref_digest: refDigest,
    current_authority_digest: authorityDigest,
    delegated,
    requested_lanes: requestedLanes,
    scope_digest: digestValue({ repository_id: repositoryId, authorized_ref_digest: refDigest, task_digest: taskDigest, delegated, requested_lanes: requestedLanes }),
  }));
}

function validateRequest(record) {
  const keys = ['contract_version', 'request_id', 'task_id', 'task_digest', 'repository_id', 'authorized_ref_digest', 'current_authority_digest', 'delegated', 'requested_lanes', 'scope_digest'];
  if (!exactKeys(record, keys) || record.contract_version !== CONTRACTS[0] || !isSafeId(record.request_id) || !isSafeId(record.task_id)
    || !isDigest(record.task_digest) || !isDigest(record.repository_id) || !isDigest(record.authorized_ref_digest)
    || !isDigest(record.current_authority_digest) || !isDigest(record.scope_digest) || typeof record.delegated !== 'boolean'
    || !Array.isArray(record.requested_lanes) || record.requested_lanes.length > LIMITS.laneCount
    || record.requested_lanes.some((id) => !isSafeId(id)) || new Set(record.requested_lanes).size !== record.requested_lanes.length) fail('REQUEST_CONTRACT_INVALID');
  if (!record.delegated && record.requested_lanes.length !== 0) fail('DELEGATION_NOT_AUTHORIZED');
  return deepFreeze(clone(record));
}

function readExecutionLoopConsent(options = {}) {
  if (hasOwn(options, 'executionLoopState')) return { enabled: false, state: 'unresolved', status_digest: null };
  let status;
  try {
    if (options.consentProvider) {
      status = typeof options.consentProvider === 'function'
        ? options.consentProvider({ capability: 'execution_loop' })
        : typeof options.consentProvider.getStatus === 'function'
          ? options.consentProvider.getStatus({ capability: 'execution_loop' })
          : null;
    } else {
      status = a2.getRepositoryStatus({ cwd: options.cwd || process.cwd() });
    }
  } catch (_error) {
    return { enabled: false, state: 'unresolved', status_digest: null };
  }
  if (!isRecord(status)) return { enabled: false, state: 'unresolved', status_digest: null };
  if (status.interrupted === true) return { enabled: false, state: 'interrupted', status_digest: null };
  if (hasOwn(status, 'schema_version') && status.schema_version !== 1) return { enabled: false, state: 'malformed', status_digest: null };
  const capability = isRecord(status.capabilities) ? status.capabilities.execution_loop : status;
  if (hasOwn(status, 'status') && !['healthy', 'unresolved', 'actionable', 'disabled'].includes(status.status)) return { enabled: false, state: 'malformed', status_digest: null };
  if (!isRecord(capability) || !['enabled', 'disabled', 'unresolved'].includes(capability.state)) return { enabled: false, state: 'malformed', status_digest: null };
  return {
    enabled: capability.state === 'enabled',
    state: capability.state,
    status_digest: digestValue({
      state: capability.state,
      status: typeof status.status === 'string' ? status.status : null,
      registry_revision: Number.isSafeInteger(status.registry_revision) ? status.registry_revision : null,
      snapshot_hash: isDigest(status.snapshot_hash) ? status.snapshot_hash : null,
    }),
  };
}

function consentBlock(consent) {
  const reason = consent.state === 'disabled' ? 'CONSENT_DISABLED'
    : consent.state === 'interrupted' ? 'CONSENT_INTERRUPTED'
      : consent.state === 'malformed' ? 'CONSENT_MALFORMED' : 'CONSENT_UNRESOLVED';
  return { status: 'blocked', reason_code: reason, launches: [] };
}

function getAdapter(adapters, id) {
  if (adapters instanceof Map) return adapters.get(id);
  return isRecord(adapters) ? adapters[id] : undefined;
}

function requestedLaneSpec(lane) {
  if (typeof lane === 'string') return { id: lane };
  if (!isRecord(lane)) fail('LANE_ROUTE_INVALID');
  const result = { id: laneId(lane) };
  for (const field of ['provider', 'model', 'reasoning', 'role', 'host_classification']) {
    if (hasOwn(lane, field)) {
      if (typeof lane[field] !== 'string' || lane[field].length === 0 || lane[field].length > 512) fail('LANE_ROUTE_INVALID');
      result[field] = lane[field];
    }
  }
  return result;
}

function adapterEvidence(adapter, spec) {
  if (!adapter) return { available: false };
  let evidence = adapter;
  if (typeof adapter.probe === 'function') evidence = invokeSync(adapter.probe, adapter, { lane_id: spec.id }, 'ADAPTER_PROBE_FAILED');
  if (!isRecord(evidence)) return { available: false };
  const result = {
    available: evidence.available === true,
    provider: evidence.provider,
    model: evidence.model,
    reasoning: evidence.reasoning,
    role: evidence.role,
    host_classification: evidence.host_classification,
    trusted: evidence.trusted !== false && evidence.metadata_verified !== false,
    adapter_handle: evidence.adapter_handle || evidence.handle,
  };
  if (result.host_classification !== undefined && !HOST_CLASSIFICATIONS.includes(result.host_classification)) result.host_classification = 'unsupported';
  return result;
}

function routeBlock(reasonCode) {
  return { status: 'blocked', reason_code: reasonCode, launches: [] };
}

function createRoutePlan(request, laneRecords) {
  const rootOnly = laneRecords.length === 0;
  const base = {
    contract_version: CONTRACTS[1],
    route_id: 'route-' + digestValue({ request_id: request.request_id, lanes: laneRecords }).slice(0, 24),
    request_id: request.request_id,
    task_digest: request.task_digest,
    repository_id: request.repository_id,
    authorized_ref_digest: request.authorized_ref_digest,
    delegated: !rootOnly,
    root_only: rootOnly,
    lanes: laneRecords,
  };
  return deepFreeze({ ...base, route_digest: digestValue(base) });
}

function validateRoutePlan(record) {
  const keys = ['contract_version', 'route_id', 'request_id', 'task_digest', 'repository_id', 'authorized_ref_digest', 'delegated', 'root_only', 'lanes', 'route_digest'];
  if (!exactKeys(record, keys) || record.contract_version !== CONTRACTS[1] || !isSafeId(record.route_id) || !isSafeId(record.request_id)
    || !isDigest(record.task_digest) || !isDigest(record.repository_id) || !isDigest(record.authorized_ref_digest)
    || typeof record.delegated !== 'boolean' || typeof record.root_only !== 'boolean' || !Array.isArray(record.lanes)
    || record.lanes.length > LIMITS.laneCount || !isDigest(record.route_digest)) fail('ROUTE_PLAN_INVALID');
  const seen = new Set();
  for (const lane of record.lanes) {
    if (!exactKeys(lane, ['lane_id', 'provider', 'model', 'reasoning', 'role', 'host_classification', 'adapter_handle', 'capability_digest'])
      || !isSafeId(lane.lane_id) || seen.has(lane.lane_id) || typeof lane.provider !== 'string' || typeof lane.model !== 'string'
      || typeof lane.reasoning !== 'string' || typeof lane.role !== 'string' || !HOST_CLASSIFICATIONS.includes(lane.host_classification)
      || !isSafeHandle(lane.adapter_handle) || !isDigest(lane.capability_digest)) fail('ROUTE_PLAN_INVALID');
    seen.add(lane.lane_id);
  }
  if (record.root_only !== (record.lanes.length === 0) || record.delegated === record.root_only) fail('ROUTE_PLAN_INVALID');
  const base = clone(record);
  delete base.route_digest;
  if (digestValue(base) !== record.route_digest) fail('ROUTE_PLAN_INVALID');
  return deepFreeze(clone(record));
}

function admitRoute(options = {}) {
  let request;
  try {
    request = normalizeRequest(options);
  } catch (error) {
    if (error instanceof ExecutionLoopError) return routeBlock(error.code);
    throw error;
  }
  const consent = readExecutionLoopConsent(options);
  if (!consent.enabled) return { ...consentBlock(consent), request };
  if (!request.delegated) {
    return { status: 'admitted', request, route_plan: createRoutePlan(request, []), launches: [], consent };
  }
  if (request.requested_lanes.length === 0) return { ...routeBlock('WORKER_ROUTE_UNAVAILABLE'), request };
  const authorityLanes = Array.isArray(options.authority && options.authority.lanes) ? options.authority.lanes : request.requested_lanes;
  if (authorityLanes.length !== request.requested_lanes.length) return { ...routeBlock('TASK_WIDENING_REJECTED'), request };
  const records = [];
  for (let index = 0; index < request.requested_lanes.length; index += 1) {
    let spec;
    try { spec = requestedLaneSpec(authorityLanes[index]); } catch (error) {
      if (error instanceof ExecutionLoopError) return { ...routeBlock(error.code), request };
      throw error;
    }
    if (spec.id !== request.requested_lanes[index]) return { ...routeBlock('TASK_WIDENING_REJECTED'), request };
    let evidence;
    try { evidence = adapterEvidence(getAdapter(options.adapters, spec.id), spec); } catch (error) {
      if (error instanceof ExecutionLoopError) return { ...routeBlock(error.code), request };
      throw error;
    }
    if (!evidence.available) return { ...routeBlock('WORKER_ROUTE_UNAVAILABLE'), request };
    if (evidence.host_classification === 'unsupported') return { ...routeBlock('WORKER_ROUTE_UNAVAILABLE'), request };
    if (!evidence.trusted || !evidence.provider || !evidence.model || !evidence.reasoning || !evidence.role || !evidence.host_classification) return { ...routeBlock('MODEL_METADATA_UNVERIFIED'), request };
    for (const field of ['provider', 'model', 'reasoning', 'role', 'host_classification']) {
      if (hasOwn(spec, field) && spec[field] !== evidence[field]) return { ...routeBlock('WORKER_MODEL_MISMATCH'), request };
    }
    if (evidence.adapter_handle !== undefined && !isSafeHandle(evidence.adapter_handle)) return { ...routeBlock('MODEL_METADATA_UNVERIFIED'), request };
    records.push({
      lane_id: spec.id,
      provider: evidence.provider,
      model: evidence.model,
      reasoning: evidence.reasoning,
      role: evidence.role,
      host_classification: evidence.host_classification,
      adapter_handle: evidence.adapter_handle || 'adapter-' + digestValue({ lane: spec.id, provider: evidence.provider, model: evidence.model }).slice(0, 20),
      capability_digest: digestValue({ lane_id: spec.id, provider: evidence.provider, model: evidence.model, reasoning: evidence.reasoning, role: evidence.role, host_classification: evidence.host_classification }),
    });
  }
  const routePlan = createRoutePlan(request, records);
  return { status: 'admitted', request, route_plan: routePlan, launches: [], consent };
}

function invokeAtomicLaunch(fn, receiver, argument, failureCode) {
  let result;
  try {
    result = fn.call(receiver, argument);
  } catch (_error) {
    fail(failureCode);
  }
  if (result && typeof result.then === 'function') fail('ASYNC_LAUNCH_UNSUPPORTED');
  return result;
}

function exactIdSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((item) => isSafeId(item))
    && new Set(actual).size === actual.length
    && [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

function executeAtomicLaunch(routePlan, options) {
  if (typeof options.prepareLaunch !== 'function' || typeof options.commitLaunchBatch !== 'function') fail('LAUNCH_ATOMICITY_UNAVAILABLE');
  const reservations = [];
  for (const lane of routePlan.lanes) {
    const reservation = invokeAtomicLaunch(options.prepareLaunch, options, lane, 'LAUNCH_PREPARATION_FAILED');
    if (!isRecord(reservation) || !exactKeys(reservation, ['lane_id', 'reservation_handle', 'inert'])
      || reservation.lane_id !== lane.lane_id || !isSafeHandle(reservation.reservation_handle) || reservation.inert !== true) {
      fail('LAUNCH_RESERVATION_INVALID');
    }
    reservations.push(deepFreeze({ lane_id: reservation.lane_id, reservation_handle: reservation.reservation_handle, inert: true }));
  }
  if (typeof options.beforeCommitLaunchBatch === 'function') {
    let result;
    try {
      result = options.beforeCommitLaunchBatch({ route_plan: routePlan, reservations: deepFreeze(reservations.slice()), run: options.run, workspace_receipt: options.workspace_receipt });
    } catch (error) {
      if (error instanceof ExecutionLoopError) throw error;
      fail('LAUNCH_BATCH_FAILED');
    }
    if (result && typeof result.then === 'function') fail('ASYNC_LAUNCH_UNSUPPORTED');
  }
  const committed = invokeAtomicLaunch(options.commitLaunchBatch, options, {
    route_plan: routePlan,
    reservations: deepFreeze(reservations.slice()),
    run_id: options.run && options.run.run_id,
    repository_id: options.run && options.run.repository_id,
    authorized_ref_digest: options.run && options.run.authorized_ref_digest,
    current_authority_digest: options.run && options.run.current_authority_digest,
    workspace_receipt: options.workspace_receipt,
  }, 'LAUNCH_BATCH_FAILED');
  const expected = routePlan.lanes.map((lane) => lane.lane_id);
  if (!isRecord(committed) || committed.atomic !== true || !exactIdSet(committed.started_lane_ids, expected)) fail('LAUNCH_BATCH_INVALID');
  return { launches: expected };
}

function createRunReceipt(options = {}) {
  const request = options.request && options.request.contract_version === CONTRACTS[0] ? validateRequest(options.request) : normalizeRequest(options);
  const routePlan = options.route_plan || options.routePlan;
  if (!isRecord(routePlan) || routePlan.contract_version !== CONTRACTS[1]) fail('ROUTE_PLAN_REQUIRED');
  validateRoutePlan(routePlan);
  const runId = options.run_id || 'run-' + digestValue({ request_id: request.request_id, route_digest: routePlan.route_digest, authority: request.current_authority_digest }).slice(0, 24);
  if (!isSafeId(runId)) fail('RUN_ID_INVALID');
  const now = isoNow(options.now);
  return validateRunReceipt(contractRecord(CONTRACTS[2], {
    run_id: runId,
    request_digest: digestValue(request),
    repository_id: request.repository_id,
    authorized_ref_digest: request.authorized_ref_digest,
    route_digest: routePlan.route_digest,
    authority_binding_digest: digestValue({ run_id: runId, request_id: request.request_id, current_authority_digest: request.current_authority_digest, repository_id: request.repository_id, authorized_ref_digest: request.authorized_ref_digest, route_digest: routePlan.route_digest }),
    current_authority_digest: request.current_authority_digest,
    execution_state: 'planned',
    current_lanes: routePlan.lanes.map((lane) => ({ lane_id: lane.lane_id, state: 'planned' })),
    workspace_receipt_digest: null,
    terminal_packet_digest: null,
    publication_state: 'none',
    workspace_disposition: null,
    created_at: now,
    updated_at: now,
  }));
}

function validateRunReceipt(record) {
  const keys = ['contract_version', 'run_id', 'request_digest', 'repository_id', 'authorized_ref_digest', 'route_digest', 'authority_binding_digest', 'current_authority_digest', 'execution_state', 'current_lanes', 'workspace_receipt_digest', 'terminal_packet_digest', 'publication_state', 'workspace_disposition', 'created_at', 'updated_at'];
  if (!exactKeys(record, keys) || record.contract_version !== CONTRACTS[2] || !isSafeId(record.run_id)
    || !isDigest(record.request_digest) || !isDigest(record.repository_id) || !isDigest(record.authorized_ref_digest)
    || !isDigest(record.route_digest) || !isDigest(record.authority_binding_digest) || !isDigest(record.current_authority_digest) || !EXECUTION_STATES.includes(record.execution_state)
    || !Array.isArray(record.current_lanes) || record.current_lanes.length > LIMITS.laneCount
    || !(record.workspace_receipt_digest === null || isDigest(record.workspace_receipt_digest))
    || !(record.terminal_packet_digest === null || isDigest(record.terminal_packet_digest))
    || !['none', 'verified', 'uncertain'].includes(record.publication_state)
    || !(record.workspace_disposition === null || WORKSPACE_DISPOSITIONS.includes(record.workspace_disposition))
    || typeof record.created_at !== 'string' || typeof record.updated_at !== 'string') fail('RUN_RECEIPT_INVALID');
  const seen = new Set();
  for (const lane of record.current_lanes) {
    if (!exactKeys(lane, ['lane_id', 'state']) || !isSafeId(lane.lane_id) || seen.has(lane.lane_id)
      || !['planned', 'admitted', 'running', 'validating', 'terminal'].includes(lane.state)) fail('RUN_RECEIPT_INVALID');
    seen.add(lane.lane_id);
  }
  return deepFreeze(clone(record));
}

function transitionRun(run, nextState, options = {}) {
  const current = validateRunReceipt(run);
  if (!EXECUTION_STATES.includes(nextState) || !TRANSITIONS[current.execution_state].includes(nextState)) fail('INVALID_STATE_TRANSITION', { from: current.execution_state, to: nextState });
  const next = clone(current);
  next.execution_state = nextState;
  next.updated_at = isoNow(options.now);
  if (hasOwn(options, 'publication_state')) {
    if (!['none', 'verified', 'uncertain'].includes(options.publication_state)) fail('PUBLICATION_STATE_INVALID');
    next.publication_state = options.publication_state;
  }
  if (hasOwn(options, 'workspace_receipt_digest')) {
    if (!isDigest(options.workspace_receipt_digest)) fail('WORKSPACE_RECEIPT_INVALID');
    next.workspace_receipt_digest = options.workspace_receipt_digest;
  }
  if (hasOwn(options, 'terminal_packet_digest')) {
    if (!isDigest(options.terminal_packet_digest)) fail('TERMINAL_PACKET_INVALID');
    next.terminal_packet_digest = options.terminal_packet_digest;
  }
  if (hasOwn(options, 'workspace_disposition')) {
    if (!WORKSPACE_DISPOSITIONS.includes(options.workspace_disposition)) fail('WORKSPACE_DISPOSITION_INVALID');
    next.workspace_disposition = options.workspace_disposition;
  }
  if (Array.isArray(options.lanes)) {
    const map = new Map(next.current_lanes.map((lane) => [lane.lane_id, lane]));
    for (const lane of options.lanes) {
      if (!isRecord(lane) || !map.has(lane.lane_id) || !['planned', 'admitted', 'running', 'validating', 'terminal'].includes(lane.state)) fail('RUN_LANE_STATE_INVALID');
      map.get(lane.lane_id).state = lane.state;
    }
    next.current_lanes = [...map.values()];
  }
  if (nextState === 'terminal-success' && next.publication_state === 'uncertain') fail('PUBLICATION_UNCERTAIN');
  if (nextState === 'interrupted' && (next.publication_state !== 'uncertain' || !['preserved', 'quarantined'].includes(next.workspace_disposition))) fail('INTERRUPTION_EVIDENCE_REQUIRED');
  return validateRunReceipt(next);
}

function normalizeLiveRef(value) {
  if (!isRecord(value)) fail('LIVE_REF_UNAVAILABLE');
  const ref = value.ref || value.server_ref;
  const sha = value.sha || value.commit || value.server_sha;
  const tree = value.tree || value.tree_sha || value.server_tree;
  if (!isSafeRef(ref) || !isSha1(sha) || !isSha1(tree)) fail('LIVE_REF_UNAVAILABLE');
  return { ref, sha, tree };
}

function createWorkspaceReceipt(options = {}) {
  return validateWorkspaceReceipt(contractRecord(CONTRACTS[3], {
    run_id: options.run_id,
    repository_id: options.repository_id,
    authorized_ref_digest: options.authorized_ref_digest,
    live_ref_digest: options.live_ref_digest,
    snapshot_commit_digest: options.snapshot_commit_digest,
    snapshot_tree_digest: options.snapshot_tree_digest,
    workspace_id: options.workspace_id,
    workspace_handle: options.workspace_handle,
    setup_digest: options.setup_digest,
    verified: options.verified === true,
  }));
}

function validateWorkspaceReceipt(record) {
  const keys = ['contract_version', 'run_id', 'repository_id', 'authorized_ref_digest', 'live_ref_digest', 'snapshot_commit_digest', 'snapshot_tree_digest', 'workspace_id', 'workspace_handle', 'setup_digest', 'verified'];
  if (!exactKeys(record, keys) || record.contract_version !== CONTRACTS[3] || !isSafeId(record.run_id)
    || !isDigest(record.repository_id) || !isDigest(record.authorized_ref_digest) || !isDigest(record.live_ref_digest)
    || !isDigest(record.snapshot_commit_digest) || !isDigest(record.snapshot_tree_digest)
    || !isSafeHandle(record.workspace_id) || record.workspace_id.includes('/')
    || !isSafeHandle(record.workspace_handle) || !isDigest(record.setup_digest) || record.verified !== true) fail('WORKSPACE_RECEIPT_INVALID');
  return deepFreeze(clone(record));
}

function validateRunEvidence(options = {}, expectedState, prefix) {
  if (!isRecord(options.run) || !isRecord(options.route_plan) || !isRecord(options.workspace_receipt)) fail(prefix + '_RUN_EVIDENCE_REQUIRED');
  const run = validateRunReceipt(options.run);
  if (run.execution_state !== expectedState) fail(prefix + '_LIFECYCLE_INVALID');
  if (!isSafeId(options.run_id) || !isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest) || !isDigest(options.current_authority_digest)) fail(prefix + '_BINDING_INVALID');
  if (options.run_id !== run.run_id || options.repository_id !== run.repository_id || options.authorized_ref_digest !== run.authorized_ref_digest || options.current_authority_digest !== run.current_authority_digest) fail(prefix + '_RUN_BINDING_MISMATCH');
  const routePlan = validateRoutePlan(options.route_plan);
  if (routePlan.route_digest !== run.route_digest || routePlan.repository_id !== run.repository_id || routePlan.authorized_ref_digest !== run.authorized_ref_digest) fail(prefix + '_ROUTE_BINDING_MISMATCH');
  const expectedAuthorityBinding = digestValue({ run_id: run.run_id, request_id: routePlan.request_id, current_authority_digest: run.current_authority_digest, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, route_digest: run.route_digest });
  if (run.authority_binding_digest !== expectedAuthorityBinding) fail(prefix + '_RUN_BINDING_MISMATCH');
  const workspaceReceipt = validateWorkspaceReceipt(options.workspace_receipt);
  if (workspaceReceipt.run_id !== run.run_id || workspaceReceipt.repository_id !== run.repository_id || workspaceReceipt.authorized_ref_digest !== run.authorized_ref_digest || run.workspace_receipt_digest !== digestValue(workspaceReceipt)) fail(prefix + '_WORKSPACE_BINDING_MISMATCH');
  return { run, routePlan, workspaceReceipt };
}
function verifyLiveWorkspaceReceipt(provider, workspaceReceipt) {
  const live = readLiveRef(provider);
  if (digestValue(live.ref) !== workspaceReceipt.live_ref_digest || digestValue(live.sha) !== workspaceReceipt.snapshot_commit_digest || digestValue(live.tree) !== workspaceReceipt.snapshot_tree_digest) fail('LIVE_REF_MOVED', { observed_ref_digest: digestValue(live.ref), observed_commit_digest: digestValue(live.sha), observed_tree_digest: digestValue(live.tree) });
  return live;
}
function readLiveRef(provider) {
  if (!provider || typeof provider.read !== 'function') fail('LIVE_REF_UNAVAILABLE');
  return normalizeLiveRef(invokeSync(provider.read, provider, {}, 'LIVE_REF_UNAVAILABLE'));
}

function admitWorkspace(options = {}) {
  const run = validateRunReceipt(options.run);
  if (run.execution_state !== 'admitted') fail('WORKSPACE_ADMISSION_STATE_INVALID');
  const expected = normalizeLiveRef(options.expected_live || options.live || {});
  const current = readLiveRef(options.liveRefProvider);
  if (current.ref !== expected.ref || current.sha !== expected.sha || current.tree !== expected.tree) {
    fail('LIVE_REF_MOVED', { expected_ref_digest: digestValue(expected.ref), observed_ref_digest: digestValue(current.ref), expected_commit_digest: digestValue(expected.sha), observed_commit_digest: digestValue(current.sha) });
  }
  const adapter = options.workspaceAdapter;
  if (!adapter || typeof adapter.prepare !== 'function') fail('WORKSPACE_ADAPTER_UNAVAILABLE');
  const prepared = invokeSync(adapter.prepare, adapter, { commit_sha: expected.sha, tree_sha: expected.tree, ref: expected.ref }, 'WORKSPACE_SETUP_FAILED');
  if (!isRecord(prepared) || !isSafeHandle(prepared.workspace_id) || prepared.workspace_id.includes('/') || !isSafeHandle(prepared.workspace_handle)) fail('WORKSPACE_SETUP_FAILED');
  const setupOperations = Array.isArray(prepared.setup_operations) ? prepared.setup_operations : [];
  if (setupOperations.length > 8 || setupOperations.some((item) => !SAFE_SETUP_OPERATIONS.includes(item))) fail('WORKSPACE_SETUP_OPERATION_UNSUPPORTED');
  const observedCommit = hasOwn(prepared, 'commit_sha') ? prepared.commit_sha : hasOwn(prepared, 'commit') ? prepared.commit : undefined;
  const observedTree = hasOwn(prepared, 'tree_sha') ? prepared.tree_sha : hasOwn(prepared, 'tree') ? prepared.tree : undefined;
  if (!isSha1(observedCommit) || !isSha1(observedTree)) fail('WORKSPACE_SNAPSHOT_OBSERVATION_REQUIRED');
  if (observedCommit !== expected.sha || observedTree !== expected.tree) fail('WORKSPACE_SNAPSHOT_MISMATCH');
  if (typeof adapter.verifySnapshot !== 'function') fail('WORKSPACE_SNAPSHOT_VERIFICATION_REQUIRED');
  const verified = invokeSync(adapter.verifySnapshot, adapter, { workspace_handle: prepared.workspace_handle, commit_sha: expected.sha, tree_sha: expected.tree }, 'WORKSPACE_SNAPSHOT_MISMATCH');
  if (verified !== true && !(isRecord(verified) && exactKeys(verified, ['verified']) && verified.verified === true)) fail('WORKSPACE_SNAPSHOT_MISMATCH');
  const receipt = createWorkspaceReceipt({
    run_id: run.run_id,
    repository_id: run.repository_id,
    authorized_ref_digest: run.authorized_ref_digest,
    live_ref_digest: digestValue(expected.ref),
    snapshot_commit_digest: digestValue(expected.sha),
    snapshot_tree_digest: digestValue(expected.tree),
    workspace_id: prepared.workspace_id,
    workspace_handle: prepared.workspace_handle,
    setup_digest: digestValue({ operations: setupOperations, commit: expected.sha, tree: expected.tree }),
    verified: true,
  });
  return { status: 'workspace-ready', run: transitionRun(run, 'workspace-ready', { workspace_receipt_digest: digestValue(receipt) }), workspace_receipt: receipt };
}

function authorizeA1Operation(options = {}) {
  if (!isRecord(options.operation) || options.operation.type === 'git.stage') fail('A3_OPERATION_UNSUPPORTED');
  if (!isSafeId(options.run_id) || !isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest) || !isDigest(options.current_authority_digest)) fail('A1_BINDING_INVALID');
  const operationDigest = a1.operationDigest(options.operation);
  const targetDigest = a1.targetDigest(options.operation);
  if (!isDigest(operationDigest) || !isDigest(targetDigest)) fail('A1_OPERATION_INVALID');
  const broker = options.broker;
  if (!broker || (typeof broker.authorize !== 'function' && typeof broker.evaluate !== 'function')) fail('A1_BROKER_REQUIRED');
  const method = typeof broker.authorize === 'function' ? broker.authorize : broker.evaluate;
  const decision = invokeSync(method, broker, {
    run_id: options.run_id,
    repository_id: options.repository_id,
    authorized_ref_digest: options.authorized_ref_digest,
    current_authority_digest: options.current_authority_digest,
    operation_type: options.operation.type,
    operation_digest: operationDigest,
    target_digest: targetDigest,
    scope_digest: options.scope_digest || digestValue({ repository_id: options.repository_id, authorized_ref_digest: options.authorized_ref_digest }),
    session_id: options.session_id || null,
    turn_id: options.turn_id || null,
    call_id: options.call_id || null,
    operation: options.operation,
  }, 'A1_BROKER_FAILED');
  if (!isRecord(decision) || !['allow', 'ask', 'deny', 'unsupported'].includes(decision.decision)) fail('A1_BROKER_RESPONSE_INVALID');
  if (decision.decision !== 'allow') fail(decision.decision === 'ask' ? 'A1_AUTHORITY_UNRESOLVED' : 'A1_AUTHORITY_DENIED');
  if (hasOwn(decision, 'issuer') || hasOwn(decision, 'self_mint') || hasOwn(decision, 'createIssuer')) fail('A1_BROKER_BOUNDARY_VIOLATION');
  return {
    operation_digest: operationDigest,
    target_digest: targetDigest,
    authority_binding_digest: digestValue({ run_id: options.run_id, repository_id: options.repository_id, authorized_ref_digest: options.authorized_ref_digest, current_authority_digest: options.current_authority_digest, operation_digest: operationDigest, target_digest: targetDigest }),
  };
}

function normalizeGitStatus(status, repositoryId) {
  if (!isRecord(status) || !isDigest(status.repository_id) || status.repository_id !== repositoryId
    || !isSha1(status.head) || !isSha1(status.tree) || !isDigest(status.index_digest)) fail('GIT_STATUS_INVALID');
  const raw = isRecord(status.worktree_paths) ? status.worktree_paths : { staged_paths: status.staged_paths, unstaged_paths: hasOwn(status, 'unstaged_paths') ? status.unstaged_paths : status.dirty_paths, untracked_paths: status.untracked_paths };
  if (!isRecord(raw) || !exactKeys(raw, ['staged_paths', 'unstaged_paths', 'untracked_paths'])) fail('GIT_STATUS_INVALID');
  const normalizePaths = (value) => {
    if (!Array.isArray(value) || value.length > 64 || value.some((item) => !isSafeRelativePath(item))) fail('GIT_STATUS_INVALID');
    const paths = [...value].sort();
    if (new Set(paths).size !== paths.length) fail('GIT_STATUS_INVALID');
    return paths;
  };
  const worktreePaths = { staged_paths: normalizePaths(raw.staged_paths), unstaged_paths: normalizePaths(raw.unstaged_paths), untracked_paths: normalizePaths(raw.untracked_paths) };
  return { ...status, worktree_paths: worktreePaths, staged_paths: worktreePaths.staged_paths };
}

function buildGitCommitOperation(options, status) {
  const paths = Array.isArray(options.authorized_paths) ? [...options.authorized_paths].sort() : [];
  if (paths.length === 0 || paths.length > 64 || paths.some((item) => !isSafeRelativePath(item)) || new Set(paths).size !== paths.length) fail('GIT_COMMIT_PATH_INVALID');
  const message = options.commit_message;
  if (typeof message !== 'string' || message.length === 0 || message.length > LIMITS.commitMessageLength || /[\0\r\n]/.test(message)) fail('GIT_COMMIT_MESSAGE_INVALID');
  const expectedHead = options.expected_head;
  const expectedTree = options.expected_tree;
  const expectedIndexDigest = options.expected_index_digest;
  if (!isSha1(expectedHead) || !isSha1(expectedTree) || !isDigest(expectedIndexDigest) || !isSha1(options.intended_tree) || !isDigest(options.intended_change_digest)) fail('GIT_COMMIT_BINDING_INVALID');
  const operation = {
    type: 'git.commit',
    expected_head: expectedHead,
    expected_tree: expectedTree,
    authorized_paths: paths,
    authorized_paths_digest: digestValue(paths),
    expected_index_digest: expectedIndexDigest,
    intended_tree: options.intended_tree,
    intended_change_digest: options.intended_change_digest,
    commit_message: message,
    commit_message_digest: digestValue(message),
    amend: false,
    allow_empty: false,
    author_mutation: false,
    committer_mutation: false,
    config_mutation: false,
    options: [],
  };
  if (!isDigest(a1.operationDigest(operation))) fail('A1_OPERATION_INVALID');
  return operation;
}

function exactPathSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && [...actual].sort().every((item, index) => item === expected[index]);
}

function assertWorktreeScope(status, authorizedPaths, failureCode = 'GIT_COMMIT_WORKTREE_BROADENED') {
  const allowed = new Set(authorizedPaths);
  for (const field of ['unstaged_paths', 'untracked_paths']) {
    if (status.worktree_paths[field].some((item) => !allowed.has(item))) fail(failureCode);
  }
}
function executeTypedGitCommit(options = {}) {
  const consent = readExecutionLoopConsent(options);
  if (!consent.enabled) fail(consent.state === 'disabled' ? 'CONSENT_DISABLED' : consent.state === 'interrupted' ? 'CONSENT_INTERRUPTED' : 'CONSENT_UNRESOLVED');
  if (!isSafeId(options.run_id) || !isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest) || !isDigest(options.current_authority_digest)) fail('GIT_COMMIT_BINDING_INVALID');
  const evidence = validateRunEvidence(options, 'running', 'GIT_COMMIT');
  if (!options.liveRefProvider) fail('LIVE_REF_REQUIRED');
  verifyOwnedMutationLease(options);
  const git = options.git;
  if (!git || typeof git.status !== 'function' || typeof git.stageExact !== 'function' || typeof git.commit !== 'function') fail('GIT_ADAPTER_UNAVAILABLE');
  const operation = buildGitCommitOperation(options, null);
  if (digestValue(operation.expected_head) !== evidence.workspaceReceipt.snapshot_commit_digest || digestValue(operation.expected_tree) !== evidence.workspaceReceipt.snapshot_tree_digest) fail('GIT_COMMIT_WORKSPACE_SNAPSHOT_MISMATCH');
  const initial = normalizeGitStatus(invokeSync(git.status, git, {}, 'GIT_STATUS_UNAVAILABLE'), options.repository_id);
  if (initial.head !== operation.expected_head) fail('GIT_COMMIT_HEAD_MISMATCH');
  if (initial.tree !== operation.expected_tree) fail('GIT_COMMIT_TREE_MISMATCH');
  if (initial.index_digest !== operation.expected_index_digest) fail('GIT_COMMIT_INDEX_BASELINE_MISMATCH');
  if (initial.staged_paths.length !== 0) fail('GIT_COMMIT_PREEXISTING_STAGE');
  assertWorktreeScope(initial, operation.authorized_paths);
  verifyLiveWorkspaceReceipt(options.liveRefProvider, evidence.workspaceReceipt);
  const authority = authorizeA1Operation({ ...options, operation });
  verifyOwnedMutationLease(options);
  const staged = invokeSync(git.stageExact, git, { paths: operation.authorized_paths }, 'GIT_STAGE_FAILED');
  const afterStage = normalizeGitStatus(isRecord(staged) ? staged : invokeSync(git.status, git, {}, 'GIT_STATUS_UNAVAILABLE'), options.repository_id);
  if (!exactPathSet(afterStage.staged_paths, operation.authorized_paths)) fail('GIT_COMMIT_STAGED_SET_MISMATCH');
  assertWorktreeScope(afterStage, operation.authorized_paths);
  verifyLiveWorkspaceReceipt(options.liveRefProvider, evidence.workspaceReceipt);
  verifyOwnedMutationLease(options);
  const committed = invokeSync(git.commit, git, { message: operation.commit_message, amend: false, allow_empty: false, options: [], paths: operation.authorized_paths }, 'GIT_COMMIT_EXECUTION_FAILED');
  const finalStatus = normalizeGitStatus(committed && isRecord(committed.status) ? committed.status : invokeSync(git.status, git, {}, 'GIT_STATUS_UNAVAILABLE'), options.repository_id);
  const resultingTree = committed && committed.tree ? committed.tree : finalStatus.tree;
  const resultingChangeDigest = committed && committed.change_digest ? committed.change_digest : finalStatus.change_digest;
  if (finalStatus.staged_paths.length !== 0) fail('GIT_COMMIT_HOOK_BROADENED');
  assertWorktreeScope(finalStatus, operation.authorized_paths, 'GIT_COMMIT_HOOK_BROADENED');
  if (resultingTree !== operation.intended_tree) fail('GIT_COMMIT_RESULT_TREE_MISMATCH');
  if (!isDigest(resultingChangeDigest) || resultingChangeDigest !== operation.intended_change_digest) fail('GIT_COMMIT_RESULT_CHANGE_MISMATCH');
  if (committed && (committed.amend === true || committed.allow_empty === true || committed.author_mutation === true || committed.committer_mutation === true || committed.config_mutation === true)) fail('GIT_COMMIT_MUTATION_FLAG_UNSUPPORTED');
  return { status: 'committed', operation_digest: authority.operation_digest, target_digest: authority.target_digest, authority_binding_digest: authority.authority_binding_digest, consent_status_digest: consent.status_digest, result_tree_digest: digestValue(resultingTree), result_change_digest: resultingChangeDigest };
}

function createTerminalPacket(options = {}) {
  if (Object.keys(options).some((key) => !['run_id', 'outcome', 'reason_code', 'evidence_digest', 'workspace_disposition', 'publication_state'].includes(key))) fail('TERMINAL_PACKET_INVALID');
  const outcome = options.outcome;
  if (!Object.prototype.hasOwnProperty.call(TERMINAL_OUTCOMES, outcome)) fail('TERMINAL_OUTCOME_INVALID');
  if (!isSafeId(options.run_id) || !isSafeId(options.reason_code) || !isDigest(options.evidence_digest)) fail('TERMINAL_PACKET_INVALID');
  const workspaceDisposition = options.workspace_disposition || 'preserved';
  const publicationState = options.publication_state || 'none';
  if (!WORKSPACE_DISPOSITIONS.includes(workspaceDisposition)) fail('WORKSPACE_DISPOSITION_INVALID');
  if (!['none', 'verified', 'uncertain'].includes(publicationState)) fail('PUBLICATION_STATE_INVALID');
  if (outcome === 'success' && publicationState === 'uncertain') fail('PUBLICATION_UNCERTAIN');
  if (outcome === 'interrupted' && (publicationState !== 'uncertain' || !['preserved', 'quarantined'].includes(workspaceDisposition))) fail('INTERRUPTION_EVIDENCE_REQUIRED');
  return validateTerminalPacket(contractRecord(CONTRACTS[4], {
    run_id: options.run_id,
    outcome,
    reason_code: options.reason_code,
    evidence_digest: options.evidence_digest,
    workspace_disposition: workspaceDisposition,
    publication_state: publicationState,
    web_handoff: { kind: 'bounded-web-handoff', finality: 'unresolved', next_action: 'web-exact-head-revalidation', evidence_digest: options.evidence_digest },
  }));
}

function validateTerminalPacket(packet) {
  const keys = ['contract_version', 'run_id', 'outcome', 'reason_code', 'evidence_digest', 'workspace_disposition', 'publication_state', 'web_handoff'];
  if (!exactKeys(packet, keys) || packet.contract_version !== CONTRACTS[4] || !isSafeId(packet.run_id)
    || !Object.prototype.hasOwnProperty.call(TERMINAL_OUTCOMES, packet.outcome) || !isSafeId(packet.reason_code)
    || !isDigest(packet.evidence_digest) || !WORKSPACE_DISPOSITIONS.includes(packet.workspace_disposition)
    || !['none', 'verified', 'uncertain'].includes(packet.publication_state) || !isRecord(packet.web_handoff)
    || !exactKeys(packet.web_handoff, ['kind', 'finality', 'next_action', 'evidence_digest'])
    || packet.web_handoff.kind !== 'bounded-web-handoff' || packet.web_handoff.finality !== 'unresolved'
    || packet.web_handoff.next_action !== 'web-exact-head-revalidation' || packet.web_handoff.evidence_digest !== packet.evidence_digest) fail('TERMINAL_PACKET_INVALID');
  if (packet.outcome === 'success' && packet.publication_state === 'uncertain') fail('PUBLICATION_UNCERTAIN');
  if (JSON.stringify(packet).toLowerCase().includes('"accepted"') || JSON.stringify(packet).toLowerCase().includes('"ready"') || JSON.stringify(packet).toLowerCase().includes('"merged"') || JSON.stringify(packet).toLowerCase().includes('"canonical"') || JSON.stringify(packet).toLowerCase().includes('"review"')) fail('TERMINAL_FINALITY_FORBIDDEN');
  return deepFreeze(clone(packet));
}

function completeRun(options = {}) {
  const run = validateRunReceipt(options.run);
  if (!options.terminal_packet) fail('TERMINAL_PACKET_REQUIRED');
  const packet = validateTerminalPacket(options.terminal_packet);
  if (packet.run_id !== run.run_id) fail('TERMINAL_RUN_MISMATCH');
  const state = TERMINAL_OUTCOMES[packet.outcome];
  if (state === 'interrupted') {
    if (!['running', 'validating', 'publication-pending'].includes(run.execution_state)) fail('INVALID_STATE_TRANSITION');
  } else if (run.execution_state === 'publication-pending' && (run.publication_state === 'uncertain' || packet.publication_state === 'uncertain')) {
    fail('PUBLICATION_INTERRUPTION_REQUIRED');
  } else if (!['validating', 'publication-pending'].includes(run.execution_state)) {
    fail('INVALID_STATE_TRANSITION');
  }
  return transitionRun(run, state, { now: options.now, terminal_packet_digest: digestValue(packet), publication_state: packet.publication_state, workspace_disposition: packet.workspace_disposition });
}

function finalizeWorkspace(options = {}) {
  const facts = options.facts || {};
  if (!isRecord(facts)) fail('WORKSPACE_FACTS_INVALID');
  const disposition = facts.uncertain === true || facts.interrupted === true || facts.terminal_evidence_durable !== true
    ? 'quarantined'
    : facts.dirty === true || facts.unpushed_commit === true || facts.publication_verified !== true || facts.active_mutation_ownership === true || facts.proven_disposable !== true
      ? 'preserved' : 'cleaned';
  return { disposition, removable: disposition === 'cleaned', reason_code: disposition === 'cleaned' ? 'WORKSPACE_DISPOSABLE' : disposition === 'quarantined' ? 'WORKSPACE_UNCERTAIN' : 'WORKSPACE_PRESERVED' };
}

function cleanupWorkspace(options = {}) {
  const decision = finalizeWorkspace(options);
  if (!decision.removable) return decision;
  if (options.force === true || !isSafeHandle(options.workspace_handle)) fail('WORKSPACE_CLEANUP_UNAVAILABLE');
  if (!options.workspaceAdapter || typeof options.workspaceAdapter.remove !== 'function') fail('WORKSPACE_CLEANUP_UNAVAILABLE');
  const removed = invokeSync(options.workspaceAdapter.remove, options.workspaceAdapter, { workspace_handle: options.workspace_handle }, 'WORKSPACE_CLEANUP_FAILED');
  if (removed !== true && !(isRecord(removed) && removed.removed === true)) fail('WORKSPACE_CLEANUP_FAILED');
  return { ...decision, removed: true };
}

function durableStateRoot(customRoot) {
  if (customRoot === undefined) return path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'execution-loop');
  if (typeof customRoot !== 'string' || customRoot.length === 0 || customRoot.length > 512) fail('STATE_ROOT_INVALID');
  return path.resolve(customRoot);
}

function stateKey(repositoryId, authorizedRefDigest, runId) {
  if (!isDigest(repositoryId) || !isDigest(authorizedRefDigest) || !isSafeId(runId)) fail('STATE_KEY_INVALID');
  return digestValue({ repository_id: repositoryId, authorized_ref_digest: authorizedRefDigest, run_id: runId });
}

function artifactKey(repositoryId, authorizedRefDigest, runId, artifactType) {
  if (!isDigest(repositoryId) || !isDigest(authorizedRefDigest) || !isSafeId(runId) || !DURABLE_ARTIFACT_TYPES.includes(artifactType)) fail('STATE_KEY_INVALID');
  return digestValue({ repository_id: repositoryId, authorized_ref_digest: authorizedRefDigest, run_id: runId, artifact_type: artifactType });
}
function stateLocations(options) {
  const root = durableStateRoot(options.state_root);
  const key = stateKey(options.repository_id, options.authorized_ref_digest, options.run_id);
  const workspaceKey = artifactKey(options.repository_id, options.authorized_ref_digest, options.run_id, 'workspace-receipt');
  const terminalKey = artifactKey(options.repository_id, options.authorized_ref_digest, options.run_id, 'terminal-packet');
  return {
    root,
    key,
    state: path.join(root, key + '.json'),
    workspace_artifact: path.join(root, workspaceKey + '.json'),
    terminal_artifact: path.join(root, terminalKey + '.json'),
    tempPrefixes: [key + '.', workspaceKey + '.', terminalKey + '.'],
    lease: path.join(root, options.repository_id + '.' + options.authorized_ref_digest + '.lease.json'),
  };
}

function ensureStateRoot(root) {
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('STATE_ROOT_INVALID');
  } catch (error) {
    if (error instanceof ExecutionLoopError) throw error;
    fail('STATE_STORAGE_UNAVAILABLE');
  }
}

function assertNoInterruptedState(root, tempPrefixes) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch (_error) {
    fail('STATE_STORAGE_UNAVAILABLE');
  }
  if (names.some((name) => tempPrefixes.some((prefix) => name.startsWith(prefix) && name.endsWith('.tmp')))) fail('INTERRUPTED_STATE');
}
function validateDurableRun(record) {
  const run = validateRunReceipt(record);
  assertPrivacySafe(run);
  const terminalStates = ['terminal-success', 'terminal-failure', 'terminal-blocked'];
  const workspaceStates = ['workspace-ready', 'running', 'validating', 'publication-pending'];
  const hasWorkspaceEvidence = isDigest(run.workspace_receipt_digest);
  const hasTerminalEvidence = isDigest(run.terminal_packet_digest);
  if (['planned', 'admitted'].includes(run.execution_state) && (hasWorkspaceEvidence || hasTerminalEvidence || run.workspace_disposition !== null || run.publication_state !== 'none')) fail('DURABLE_STATE_CONTRADICTORY');
  if (workspaceStates.includes(run.execution_state) && (!hasWorkspaceEvidence || hasTerminalEvidence || run.workspace_disposition !== null)) fail('DURABLE_STATE_CONTRADICTORY');
  if (terminalStates.includes(run.execution_state) && (!hasWorkspaceEvidence || !hasTerminalEvidence || run.workspace_disposition === null || run.publication_state === 'uncertain')) fail('DURABLE_TERMINAL_EVIDENCE_REQUIRED');
  if (run.execution_state === 'interrupted' && (!hasWorkspaceEvidence || !hasTerminalEvidence || !['preserved', 'quarantined'].includes(run.workspace_disposition) || run.publication_state !== 'uncertain')) fail('DURABLE_INTERRUPTION_EVIDENCE_REQUIRED');
  return run;
}

function readDurableRun(options = {}) {
  const locations = stateLocations(options);
  ensureStateRoot(locations.root);
  assertNoInterruptedState(locations.root, locations.tempPrefixes);
  if (!fs.existsSync(locations.state)) return null;
  let record;
  try {
    const bytes = fs.readFileSync(locations.state);
    if (bytes.length > LIMITS.stateBytes) fail('STATE_OVERSIZED');
    record = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof ExecutionLoopError) throw error;
    fail('STATE_MALFORMED');
  }
  const run = validateDurableRun(record);
  if (run.run_id !== options.run_id || run.repository_id !== options.repository_id || run.authorized_ref_digest !== options.authorized_ref_digest) fail('STATE_KEY_MISMATCH');
  return run;
}

function readDurableJsonArtifact(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail('STATE_STORAGE_UNAVAILABLE');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('STATE_MALFORMED');
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (_error) {
    fail('STATE_MALFORMED');
  }
  if (bytes.length > LIMITS.stateBytes) fail('STATE_OVERSIZED');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    fail('STATE_MALFORMED');
  }
}

function validateDurableWorkspaceReceipt(record, options) {
  const receipt = validateWorkspaceReceipt(record);
  assertPrivacySafe(receipt);
  if (receipt.run_id !== options.run_id || receipt.repository_id !== options.repository_id || receipt.authorized_ref_digest !== options.authorized_ref_digest) fail('DURABLE_ARTIFACT_BINDING_MISMATCH');
  return receipt;
}

function validateDurableTerminalPacket(record, options) {
  const packet = validateTerminalPacket(record);
  assertPrivacySafe(packet);
  if (packet.run_id !== options.run_id) fail('DURABLE_ARTIFACT_BINDING_MISMATCH');
  return packet;
}

function readDurableWorkspaceReceipt(options = {}) {
  const locations = stateLocations(options);
  ensureStateRoot(locations.root);
  assertNoInterruptedState(locations.root, locations.tempPrefixes);
  const record = readDurableJsonArtifact(locations.workspace_artifact);
  return record === null ? null : validateDurableWorkspaceReceipt(record, options);
}

function readDurableTerminalPacket(options = {}) {
  const locations = stateLocations(options);
  ensureStateRoot(locations.root);
  assertNoInterruptedState(locations.root, locations.tempPrefixes);
  const record = readDurableJsonArtifact(locations.terminal_artifact);
  return record === null ? null : validateDurableTerminalPacket(record, options);
}

function assertArtifactBinding(options, artifact) {
  if (hasOwn(options, 'repository_id') && options.repository_id !== artifact.repository_id) fail('DURABLE_ARTIFACT_BINDING_MISMATCH');
  if (hasOwn(options, 'authorized_ref_digest') && options.authorized_ref_digest !== artifact.authorized_ref_digest) fail('DURABLE_ARTIFACT_BINDING_MISMATCH');
  if (hasOwn(options, 'run_id') && options.run_id !== artifact.run_id) fail('DURABLE_ARTIFACT_BINDING_MISMATCH');
}

function writeDurableArtifact(options, artifactType, artifact) {
  const locations = stateLocations(options);
  ensureStateRoot(locations.root);
  assertNoInterruptedState(locations.root, locations.tempPrefixes);
  const target = artifactType === 'workspace-receipt' ? locations.workspace_artifact : locations.terminal_artifact;
  const existing = artifactType === 'workspace-receipt'
    ? readDurableWorkspaceReceipt(options)
    : readDurableTerminalPacket(options);
  if (existing && (!isDigest(options.expected_digest) || digestValue(existing) !== options.expected_digest)) fail('STATE_CONFLICT');
  const bytes = Buffer.from(JSON.stringify(artifact), 'utf8');
  if (bytes.length > LIMITS.stateBytes) fail('STATE_OVERSIZED');
  const artifactBase = path.basename(target, '.json');
  const temp = path.join(locations.root, artifactBase + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
    const readback = artifactType === 'workspace-receipt'
      ? readDurableWorkspaceReceipt(options)
      : readDurableTerminalPacket(options);
    if (!readback || digestValue(readback) !== digestValue(artifact)) fail('STATE_READBACK_MISMATCH');
    return readback;
  } catch (error) {
    if (error instanceof ExecutionLoopError) throw error;
    fail('STATE_WRITE_INTERRUPTED');
  }
}

function writeDurableWorkspaceReceipt(options = {}) {
  const receipt = validateWorkspaceReceipt(options.workspace_receipt);
  assertPrivacySafe(receipt);
  assertArtifactBinding(options, receipt);
  return writeDurableArtifact({
    ...options,
    repository_id: receipt.repository_id,
    authorized_ref_digest: receipt.authorized_ref_digest,
    run_id: receipt.run_id,
  }, 'workspace-receipt', receipt);
}

function writeDurableTerminalPacket(options = {}) {
  const packet = validateTerminalPacket(options.terminal_packet);
  assertPrivacySafe(packet);
  if (!isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest)) fail('DURABLE_ARTIFACT_BINDING_INVALID');
  if (hasOwn(options, 'run_id') && options.run_id !== packet.run_id) fail('DURABLE_ARTIFACT_BINDING_MISMATCH');
  return writeDurableArtifact({
    ...options,
    run_id: packet.run_id,
  }, 'terminal-packet', packet);
}
function writeDurableRun(options = {}) {
  const run = validateDurableRun(options.run);
  let workspaceReceipt;
  let terminalPacket;
  if (hasOwn(options, 'workspace_receipt')) {
    workspaceReceipt = validateWorkspaceReceipt(options.workspace_receipt);
    assertPrivacySafe(workspaceReceipt);
    assertArtifactBinding({ repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id }, workspaceReceipt);
    if (run.workspace_receipt_digest !== digestValue(workspaceReceipt)) fail('WORKSPACE_RECEIPT_DIGEST_MISMATCH');
  }
  if (hasOwn(options, 'terminal_packet')) {
    terminalPacket = validateTerminalPacket(options.terminal_packet);
    assertPrivacySafe(terminalPacket);
    if (terminalPacket.run_id !== run.run_id || run.terminal_packet_digest !== digestValue(terminalPacket)) fail('TERMINAL_PACKET_DIGEST_MISMATCH');
  }
  const locations = stateLocations({ state_root: options.state_root, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id });
  ensureStateRoot(locations.root);
  const existing = readDurableRun({ state_root: options.state_root, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id });
  if (existing && (!isDigest(options.expected_digest) || digestValue(existing) !== options.expected_digest)) fail('STATE_CONFLICT');
  const bytes = Buffer.from(JSON.stringify(run), 'utf8');
  if (bytes.length > LIMITS.stateBytes) fail('STATE_OVERSIZED');
  const temp = path.join(locations.root, locations.key + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, locations.state);
    const readback = readDurableRun({ state_root: options.state_root, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id });
    if (digestValue(readback) !== digestValue(run)) fail('STATE_READBACK_MISMATCH');
    if (workspaceReceipt) writeDurableWorkspaceReceipt({ state_root: options.state_root, workspace_receipt: workspaceReceipt, expected_digest: options.expected_workspace_receipt_digest });
    if (terminalPacket) writeDurableTerminalPacket({ state_root: options.state_root, repository_id: run.repository_id, authorized_ref_digest: run.authorized_ref_digest, run_id: run.run_id, terminal_packet: terminalPacket, expected_digest: options.expected_terminal_packet_digest });
    return readback;
  } catch (error) {
    if (error instanceof ExecutionLoopError) throw error;
    fail('STATE_WRITE_INTERRUPTED');
  }
}

function mutationLeasePath(stateRoot, repositoryId, authorizedRefDigest) {
  return path.join(durableStateRoot(stateRoot), repositoryId + '.' + authorizedRefDigest + '.lease.json');
}

function validateMutationLeaseRecord(record) {
  if (!isRecord(record) || !exactKeys(record, ['kind', 'lease_id', 'repository_id', 'authorized_ref_digest', 'run_id', 'acquired_at', 'expires_at'])
    || record.kind !== 'mutation-lease' || !isSafeId(record.lease_id) || !isDigest(record.repository_id)
    || !isDigest(record.authorized_ref_digest) || !isSafeId(record.run_id)
    || typeof record.acquired_at !== 'string' || typeof record.expires_at !== 'string') fail('LEASE_RECORD_INVALID');
  const acquiredAt = Date.parse(record.acquired_at);
  const expiresAt = Date.parse(record.expires_at);
  if (!Number.isFinite(acquiredAt) || !Number.isFinite(expiresAt) || expiresAt <= acquiredAt) fail('LEASE_RECORD_INVALID');
  assertPrivacySafe(record);
  return deepFreeze(clone(record));
}

function readMutationLease(options = {}) {
  if (!isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest)) fail('LEASE_BINDING_INVALID');
  const root = durableStateRoot(options.state_root);
  ensureStateRoot(root);
  let record;
  try {
    record = JSON.parse(fs.readFileSync(mutationLeasePath(root, options.repository_id, options.authorized_ref_digest), 'utf8'));
  } catch (_error) {
    fail('LEASE_REQUIRED');
  }
  return validateMutationLeaseRecord(record);
}

function verifyOwnedMutationLease(options = {}) {
  if (!isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest) || !isSafeId(options.run_id)) fail('LEASE_BINDING_INVALID');
  const supplied = options.mutation_lease;
  if (!isRecord(supplied)) fail('LEASE_REQUIRED');
  if (!exactKeys(supplied, ['kind', 'lease_id', 'repository_id', 'authorized_ref_digest', 'run_id', 'acquired_at', 'expires_at'])
    || supplied.kind !== 'mutation-lease' || !isSafeId(supplied.lease_id) || !isDigest(supplied.repository_id)
    || !isDigest(supplied.authorized_ref_digest) || !isSafeId(supplied.run_id)) fail('LEASE_TOKEN_INVALID');
  if (supplied.repository_id !== options.repository_id || supplied.authorized_ref_digest !== options.authorized_ref_digest || supplied.run_id !== options.run_id) fail('LEASE_BINDING_MISMATCH');
  const current = readMutationLease(options);
  if (digestValue(current) !== digestValue(supplied)) fail('LEASE_TOKEN_MISMATCH');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (now >= Date.parse(current.expires_at)) fail('LEASE_EXPIRED');
  return current;
}

function acquireMutationLease(options = {}) {
  if (!isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest) || !isSafeId(options.run_id)) fail('LEASE_BINDING_INVALID');
  const root = durableStateRoot(options.state_root);
  ensureStateRoot(root);
  const leasePath = mutationLeasePath(root, options.repository_id, options.authorized_ref_digest);
  const lease = {
    kind: 'mutation-lease',
    lease_id: 'lease-' + crypto.randomBytes(16).toString('hex'),
    repository_id: options.repository_id,
    authorized_ref_digest: options.authorized_ref_digest,
    run_id: options.run_id,
    acquired_at: isoNow(Number.isFinite(options.now) ? options.now : Date.now()),
    expires_at: isoNow((Number.isFinite(options.now) ? options.now : Date.now()) + LIMITS.leaseLifetimeMs),
  };
  assertPrivacySafe(lease);
  try {
    fs.writeFileSync(leasePath, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
  } catch (_error) {
    fail('CONFLICTING_RUN');
  }
  let readback;
  try {
    readback = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
  } catch (_error) {
    fail('LEASE_READBACK_FAILED');
  }
  if (digestValue(readback) !== digestValue(lease)) fail('LEASE_READBACK_FAILED');
  return deepFreeze(lease);
}

function releaseMutationLease(options = {}) {
  if (!isDigest(options.repository_id) || !isDigest(options.authorized_ref_digest) || !isSafeId(options.run_id) || !isSafeId(options.lease_id)) fail('LEASE_BINDING_INVALID');
  const leasePath = mutationLeasePath(options.state_root, options.repository_id, options.authorized_ref_digest);
  const lease = readMutationLease(options);
  if (lease.lease_id !== options.lease_id || lease.run_id !== options.run_id) fail('LEASE_TOKEN_MISMATCH');
  let durableRun;
  let workspaceReceipt;
  let terminalPacket;
  try {
    durableRun = readDurableRun({ state_root: options.state_root, repository_id: options.repository_id, authorized_ref_digest: options.authorized_ref_digest, run_id: options.run_id });
    workspaceReceipt = readDurableWorkspaceReceipt({ state_root: options.state_root, repository_id: options.repository_id, authorized_ref_digest: options.authorized_ref_digest, run_id: options.run_id });
    terminalPacket = readDurableTerminalPacket({ state_root: options.state_root, repository_id: options.repository_id, authorized_ref_digest: options.authorized_ref_digest, run_id: options.run_id });
  } catch (_error) {
    fail('LEASE_RELEASE_UNSAFE');
  }
  if (!durableRun || !['terminal-success', 'terminal-failure', 'terminal-blocked'].includes(durableRun.execution_state) || !isDigest(durableRun.workspace_receipt_digest) || !isDigest(durableRun.terminal_packet_digest) || durableRun.workspace_disposition !== 'cleaned' || !['none', 'verified'].includes(durableRun.publication_state)) fail('LEASE_RELEASE_UNSAFE');
  if (!workspaceReceipt || !terminalPacket) fail('LEASE_RELEASE_UNSAFE');
  if (workspaceReceipt.run_id !== durableRun.run_id || workspaceReceipt.repository_id !== durableRun.repository_id || workspaceReceipt.authorized_ref_digest !== durableRun.authorized_ref_digest || terminalPacket.run_id !== durableRun.run_id) fail('LEASE_RELEASE_UNSAFE');
  if (digestValue(workspaceReceipt) !== durableRun.workspace_receipt_digest || digestValue(terminalPacket) !== durableRun.terminal_packet_digest) fail('LEASE_RELEASE_UNSAFE');
  const expectedOutcome = { 'terminal-success': 'success', 'terminal-failure': 'failure', 'terminal-blocked': 'blocked' }[durableRun.execution_state];
  if (terminalPacket.outcome !== expectedOutcome || terminalPacket.publication_state !== durableRun.publication_state || terminalPacket.workspace_disposition !== durableRun.workspace_disposition) fail('LEASE_RELEASE_UNSAFE');
  if ((hasOwn(options, 'terminal_state') && options.terminal_state !== durableRun.execution_state) || (hasOwn(options, 'workspace_disposition') && options.workspace_disposition !== durableRun.workspace_disposition) || (hasOwn(options, 'publication_state') && options.publication_state !== durableRun.publication_state)) fail('LEASE_RELEASE_UNSAFE');
  try {
    fs.unlinkSync(leasePath);
  } catch (_error) {
    fail('LEASE_RELEASE_FAILED');
  }
  return { released: true };
}

function prepareRetry(options = {}) {
  const previous = validateRunReceipt(options.previous_run);
  if (previous.publication_state === 'uncertain') return { status: 'blocked', reason_code: 'PUBLICATION_UNCERTAIN', launches: [] };
  if (!isSafeId(options.run_id) || options.run_id === previous.run_id) return { status: 'blocked', reason_code: 'FRESH_RUN_REQUIRED', launches: [] };
  if (!isDigest(options.current_authority_digest) || options.current_authority_digest === previous.current_authority_digest) return { status: 'blocked', reason_code: 'FRESH_AUTHORITY_REQUIRED', launches: [] };
  const route = admitRoute(options);
  if (route.status !== 'admitted') return route;
  if (!options.expected_live || !options.liveRefProvider || !options.workspaceAdapter) return { status: 'blocked', reason_code: 'FRESH_LIVE_ADMISSION_REQUIRED', launches: [] };
  let workspace;
  try {
    const planned = createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: options.run_id, now: options.now });
    const admitted = transitionRun(planned, 'admitted', { now: options.now });
    workspace = admitWorkspace({ ...options, run: admitted });
  } catch (error) {
    if (error instanceof ExecutionLoopError) return { status: 'blocked', reason_code: error.code, launches: [] };
    throw error;
  }
  return { status: 'ready', route_plan: route.route_plan, run: workspace.run, workspace_receipt: workspace.workspace_receipt, launches: [] };
}

function admitRun(options = {}) {
  const route = admitRoute(options);
  if (route.status !== 'admitted') return { ...route, launches: [] };
  const planned = createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: options.run_id, now: options.now });
  const run = transitionRun(planned, 'admitted', { now: options.now });
  return { status: 'admitted', request: route.request, route_plan: route.route_plan, run, launches: [], consent: route.consent };
}

function startDelegatedRun(options = {}) {
  const evidence = validateRunEvidence(options, 'workspace-ready', 'START');
  if (!evidence.routePlan.delegated) fail('DELEGATED_ROUTE_REQUIRED');
  verifyLiveWorkspaceReceipt(options.liveRefProvider, evidence.workspaceReceipt);
  const consentBeforeRunning = readExecutionLoopConsent(options);
  if (!consentBeforeRunning.enabled) return { ...consentBlock(consentBeforeRunning), route_plan: evidence.routePlan, run: evidence.run, workspace_receipt: evidence.workspaceReceipt, consent: consentBeforeRunning };
  const running = transitionRun(evidence.run, 'running', { now: options.now });
  let launchConsent = consentBeforeRunning;
  try {
    const launch = executeAtomicLaunch(evidence.routePlan, {
      ...options,
      run: running,
      workspace_receipt: evidence.workspaceReceipt,
      beforeCommitLaunchBatch: () => {
        launchConsent = readExecutionLoopConsent(options);
        if (!launchConsent.enabled) fail(consentBlock(launchConsent).reason_code);
        return launchConsent;
      },
    });
    return { status: 'running', route_plan: evidence.routePlan, run: running, workspace_receipt: evidence.workspaceReceipt, launches: launch.launches, consent: launchConsent };
  } catch (error) {
    if (error instanceof ExecutionLoopError) {
      const consentFailure = ['CONSENT_DISABLED', 'CONSENT_UNRESOLVED', 'CONSENT_MALFORMED', 'CONSENT_INTERRUPTED'].includes(error.code);
      return { status: 'blocked', reason_code: error.code, route_plan: evidence.routePlan, run: consentFailure ? evidence.run : running, workspace_receipt: evidence.workspaceReceipt, launches: [], consent: launchConsent };
    }
    throw error;
  }
}
module.exports = {
  CONTRACTS,
  EXECUTION_STATES,
  WORKSPACE_DISPOSITIONS,
  HOST_CLASSIFICATIONS,
  LIMITS,
  POLICY,
  ExecutionLoopError,
  canonicalSerialize,
  digestValue,
  readExecutionLoopConsent,
  normalizeRequest,
  validateRequest,
  admitRoute,
  admitRun,
  createRoutePlan,
  validateRoutePlan,
  createRunReceipt,
  validateRunReceipt,
  transitionRun,
  normalizeLiveRef,
  startDelegatedRun,
  admitWorkspace,
  createWorkspaceReceipt,
  validateWorkspaceReceipt,
  authorizeA1Operation,
  buildGitCommitOperation,
  executeTypedGitCommit,
  commitExact: executeTypedGitCommit,
  createTerminalPacket,
  validateTerminalPacket,
  completeRun,
  finalizeWorkspace,
  cleanupWorkspace,
  durableStateRoot,
  stateKey,
  artifactKey,
  readDurableRun,
  readDurableWorkspaceReceipt,
  readDurableTerminalPacket,
  writeDurableRun,
  writeDurableWorkspaceReceipt,
  writeDurableTerminalPacket,
  acquireMutationLease,
  verifyOwnedMutationLease,
  releaseMutationLease,
  prepareRetry,
};
