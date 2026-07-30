'use strict';

const {
  clone,
  sha256,
  stableStringify,
} = require('./toolkit-guardrail-policy.cjs');
const {
  resolveRepositoryContext,
  resolveTargets,
} = require('./toolkit-active-repository.cjs');

const CONTRACT_VERSION = 'toolkit.guardrail.operation.v1';

const NULL_SESSION = Object.freeze({
  host: null,
  host_version: null,
  session_id: null,
  turn_id: null,
  call_id: null,
  lifecycle_event: null,
});

const NULL_NATIVE_STATE = Object.freeze({
  permission_mode: null,
  auto_or_bypass: null,
  native_permission_route: null,
  hook_order_evidence: null,
  capability_evidence: null,
});

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

function normalizeSession(input = {}) {
  const session = input.session && typeof input.session === 'object' ? input.session : input;
  return {
    host: valueOrNull(firstDefined(session.host, session.provider_host)),
    host_version: valueOrNull(firstDefined(session.host_version, session.version)),
    session_id: valueOrNull(firstDefined(session.session_id, session.id)),
    turn_id: valueOrNull(firstDefined(session.turn_id, session.turn)),
    call_id: valueOrNull(firstDefined(session.call_id, session.call)),
    lifecycle_event: valueOrNull(firstDefined(session.lifecycle_event, session.event)),
  };
}

function normalizeNativeState(input = {}) {
  const state = input.native_state && typeof input.native_state === 'object' ? input.native_state : {};
  const capability = firstDefined(state.capability_evidence, input.capability_evidence, input.capability, null);
  return {
    permission_mode: valueOrNull(firstDefined(state.permission_mode, input.permission_mode)),
    auto_or_bypass: valueOrNull(firstDefined(state.auto_or_bypass, input.auto_or_bypass)),
    native_permission_route: valueOrNull(firstDefined(state.native_permission_route, input.native_permission_route)),
    hook_order_evidence: valueOrNull(firstDefined(state.hook_order_evidence, input.hook_order_evidence, null)),
    capability_evidence: valueOrNull(capability),
  };
}

function normalizeAuthority(input = {}) {
  const authority = input.authority && typeof input.authority === 'object' ? input.authority : {};
  const prompt = authority.prompt && typeof authority.prompt === 'object' ? authority.prompt : {};
  const role = authority.role && typeof authority.role === 'object' ? authority.role : {};
  const branch = authority.branch && typeof authority.branch === 'object' ? authority.branch : {};
  const lock = authority.design_lock && typeof authority.design_lock === 'object' ? authority.design_lock : {};
  const promptActive = firstDefined(
    authority.prompt_active,
    authority.prompt_authorized,
    typeof authority.prompt === 'boolean' ? authority.prompt : undefined,
    prompt.active,
    prompt.status === 'active' ? true : undefined,
    null,
  );
  const roleName = firstDefined(authority.role_name, typeof authority.role === 'string' ? authority.role : undefined, role.name, null);
  const branchName = firstDefined(authority.branch_name, typeof authority.branch === 'string' ? authority.branch : undefined, branch.current, branch.name, null);
  const authorizedBranch = firstDefined(
    authority.authorized_branch,
    branch.authorized_branch,
    typeof branch.authorized === 'string' ? branch.authorized : undefined,
    typeof branch.allowed === 'string' ? branch.allowed : undefined,
    null,
  );
  const lockId = firstDefined(authority.design_lock_id, typeof authority.design_lock === 'string' ? authority.design_lock : undefined, lock.id, null);
  const lockStatus = firstDefined(authority.design_lock_status, lock.status, lockId ? 'active' : null);
  return {
    prompt_active: promptActive === null ? null : Boolean(promptActive),
    role_name: valueOrNull(roleName),
    role_allowed: valueOrNull(firstDefined(authority.role_allowed, role.allowed, null)),
    branch_name: valueOrNull(branchName),
    authorized_branch: valueOrNull(authorizedBranch),
    branch_protected: valueOrNull(firstDefined(authority.branch_protected, branch.protected, false)),
    push_authorized: valueOrNull(firstDefined(authority.push_authorized, authority.allow_push, prompt.allow_push, false)),
    design_lock_id: valueOrNull(lockId),
    design_lock_status: valueOrNull(lockStatus),
    allowed_operation_classes: Array.isArray(firstDefined(authority.allowed_operation_classes, prompt.allowed_operation_classes, null))
      ? [...firstDefined(authority.allowed_operation_classes, prompt.allowed_operation_classes)]
      : [],
    allowed_scopes: Array.isArray(firstDefined(authority.allowed_scopes, lock.allowed_scopes, null))
      ? [...firstDefined(authority.allowed_scopes, lock.allowed_scopes)]
      : [],
    controller_hold: Boolean(firstDefined(authority.controller_hold, authority.hold, false)),
    role: valueOrNull(roleName),
  };
}

function secretLikeKey(key) {
  return /pass(word)?|secret|token|api[-_]?key|private[-_]?key|credential|auth|cookie|prompt|transcript|environment|env/i.test(String(key));
}

function digestOnly(value) {
  return { present: true, digest: sha256(value) };
}

function sanitizeStructured(value, key = '') {
  if (value === null || value === undefined) return value === undefined ? null : null;
  if (secretLikeKey(key)) return digestOnly(value);
  if (typeof value === 'string') return value.length > 2048 ? digestOnly(value) : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeStructured(item, key));
  return Object.keys(value).sort().reduce((result, childKey) => {
    result[childKey] = sanitizeStructured(value[childKey], childKey);
    return result;
  }, {});
}

function extractTargets(operation, structured) {
  const candidates = [];
  const add = (value, kind = 'target') => {
    if (Array.isArray(value)) {
      for (const item of value) add(item, kind);
      return;
    }
    if (typeof value === 'string') {
      candidates.push({ path: value, kind });
      return;
    }
    if (value && typeof value === 'object') {
      const targetPath = firstDefined(value.path, value.target, value.file, value.destination, value.source, null);
      if (targetPath) candidates.push({ ...value, path: targetPath, kind: value.kind || kind });
    }
  };
  add(operation.targets, 'target');
  add(operation.target, 'target');
  add(operation.path, 'target');
  add(operation.paths, 'target');
  if (structured && typeof structured === 'object') {
    add(structured.target, 'structured-target');
    add(structured.targets, 'structured-target');
    add(structured.path, 'structured-target');
    add(structured.paths, 'structured-target');
    if (operation.source) add(operation.source, 'source');
    if (operation.destination) add(operation.destination, 'destination');
    add(structured.source, 'source');
    add(structured.destination, 'destination');
  }
  const seen = new Set();
  return candidates.filter((entry) => {
    const key = `${entry.path}\u0000${entry.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeExternalTargets(value) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return values.map((entry) => {
    if (typeof entry === 'string') return { class: entry, digest: sha256(entry) };
    if (!entry || typeof entry !== 'object') return { class: 'unknown-external-target', digest: sha256(String(entry)) };
    const className = firstDefined(entry.class, entry.kind, entry.type, 'unknown-external-target');
    return { class: String(className), digest: sha256(entry) };
  });
}

function normalizeApproval(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') return { malformed: true, digest: sha256(value) };
  const result = { ...clone(value) };
  for (const key of ['source', 'trusted_user_channel', 'host', 'exact_operation_digest', 'exact_targets_digest', 'session_id', 'turn_id', 'call_id', 'operation_class', 'issued_at', 'expires_at', 'one_shot', 'consumed', 'consumed_count', 'max_repeat_count', 'replay_detected', 'contract_version']) {
    if (!(key in result)) result[key] = null;
  }
  if (Array.isArray(result.canonical_target_set)) {
    result.canonical_target_set = result.canonical_target_set.map((entry) => ({
      target_class: entry?.target_class || null,
      status: entry?.status || null,
      link_type: entry?.link_type || 'none',
      path_digest: entry?.path_digest || null,
    }));
  } else {
    result.canonical_target_set = null;
  }
  delete result.command;
  delete result.prompt;
  return result;
}

function canonicalTargetSet(targets) {
  return (Array.isArray(targets) ? targets : []).map((target) => ({
    target_class: target.target_class || 'unknown-target',
    status: target.status || 'unresolved',
    link_type: target.link_type || 'none',
    path_digest: sha256(target.canonical_path || target.raw_path || ''),
  }));
}

function computeTargetDigest(targets) {
  return sha256(canonicalTargetSet(targets));
}

function computeOperationDigest(record, classification = null) {
  const operation = record?.operation || record || {};
  return sha256({
    host_tool: operation.host_tool || null,
    canonical_route: operation.canonical_route || null,
    structured_input: operation.structured_input || null,
    opaque_input: operation.opaque_input || null,
    command: operation.command || null,
    shell: operation.shell || null,
    operation_cwd: operation.operation_cwd || null,
    targets: (operation.targets || []).map((target) => ({
      path_digest: sha256(target.canonical_path || target.raw_path || target.path || ''),
      kind: target.kind || null,
    })),
    external_targets: operation.external_targets || [],
    mutation_class: classification?.operation_class || operation.mutation_class || null,
    mcp_server: operation.mcp_server || null,
    mcp_tool: operation.mcp_tool || null,
    scope: operation.scope || null,
    transaction_evidence: operation.transaction_evidence || null,
  });
}

function repositoryFromInput(input, options) {
  const supplied = firstDefined(input.repository_context, input.repository, null);
  if (supplied && supplied.context_version === 'toolkit.guardrail.repository-context.v1') return supplied;
  const source = supplied && typeof supplied === 'object' ? supplied : input;
  if (typeof options.resolveRepositoryContext === 'function') return options.resolveRepositoryContext(source, options);
  return resolveRepositoryContext(source, options);
}

function normalizeOperation(input, options = {}) {
  if (!input || typeof input !== 'object') throw new Error('OPERATION_INPUT_REQUIRED');
  const operation = input.operation && typeof input.operation === 'object' ? input.operation : input;
  const structuredInput = firstDefined(operation.structured_input, operation.structuredInput, null);
  const structured = structuredInput && typeof structuredInput === 'object' ? structuredInput : null;
  const repository = repositoryFromInput(input, options);
  const rawTargets = extractTargets(operation, structured);
  const operationCwd = firstDefined(operation.operation_cwd, operation.cwd, repository.cwd, null);
  const resolvedTargets = resolveTargets(rawTargets.map((target) => ({ ...target, operation_cwd: operationCwd })), repository, {
    ...options,
    operation_cwd: operationCwd,
  });
  const session = normalizeSession(input.session || input);
  const nativeState = normalizeNativeState(input);
  const externalTargets = normalizeExternalTargets(firstDefined(operation.external_targets, operation.externalTargets, null));
  const command = valueOrNull(firstDefined(operation.command, operation.opaque_command, null));
  const opaque = firstDefined(operation.opaque_input, operation.opaqueInput, null);
  const record = {
    contract_version: CONTRACT_VERSION,
    session,
    repository,
    operation: {
      host_tool: valueOrNull(firstDefined(operation.host_tool, operation.hostTool, input.host_tool, null)),
      canonical_route: valueOrNull(firstDefined(operation.canonical_route, operation.canonicalRoute, operation.route, null)),
      structured_input: structured ? sanitizeStructured(structured) : null,
      opaque_input: opaque === null || opaque === undefined ? null : digestOnly(opaque),
      command: command === null ? null : String(command),
      shell: valueOrNull(firstDefined(operation.shell, input.shell, null)),
      operation_cwd: valueOrNull(operationCwd),
      targets: resolvedTargets,
      external_targets: externalTargets,
      mutation_class: String(firstDefined(operation.mutation_class, operation.mutationClass, operation.action, structured?.mutation_class, structured?.action, 'unknown')),
      mcp_server: valueOrNull(firstDefined(operation.mcp_server, operation.mcpServer, null)),
      mcp_tool: valueOrNull(firstDefined(operation.mcp_tool, operation.mcpTool, null)),
      input_digest: null,
      target_digest: computeTargetDigest(resolvedTargets),
      scope: valueOrNull(firstDefined(operation.scope, input.scope, null)),
      transaction_evidence: valueOrNull(firstDefined(operation.transaction_evidence, operation.transaction, input.transaction_evidence, null)),
    },
    native_state: nativeState,
    approval: normalizeApproval(firstDefined(input.approval, operation.approval, null)),
    authority: normalizeAuthority(input),
  };
  record.operation.input_digest = computeOperationDigest(record);
  return record;
}

function refreshOperationDigests(record, classification) {
  if (!record || !record.operation) throw new Error('NORMALIZED_OPERATION_REQUIRED');
  record.operation.mutation_class = classification?.operation_class || record.operation.mutation_class;
  record.operation.target_digest = computeTargetDigest(record.operation.targets);
  record.operation.input_digest = computeOperationDigest(record, classification);
  return record;
}

module.exports = {
  CONTRACT_VERSION,
  NULL_SESSION,
  NULL_NATIVE_STATE,
  normalizeSession,
  normalizeNativeState,
  normalizeAuthority,
  sanitizeStructured,
  extractTargets,
  normalizeApproval,
  canonicalTargetSet,
  computeTargetDigest,
  computeOperationDigest,
  normalizeOperation,
  refreshOperationDigests,
};
