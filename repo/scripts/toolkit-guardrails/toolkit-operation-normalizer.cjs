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

function strictBoolean(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : value;
}

function failClosedBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : value;
}

function strictString(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' ? value : value;
}

function strictArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? [...value] : value;
}

function normalizeSession(input = {}) {
  const session = input.session && typeof input.session === 'object' ? input.session : input;
  return {
    host: strictString(firstDefined(session.host, session.provider_host)),
    host_version: strictString(firstDefined(session.host_version, session.version)),
    session_id: strictString(firstDefined(session.session_id, session.id)),
    turn_id: strictString(firstDefined(session.turn_id, session.turn)),
    call_id: strictString(firstDefined(session.call_id, session.call)),
    lifecycle_event: strictString(firstDefined(session.lifecycle_event, session.event)),
  };
}

function normalizeNativeState(input = {}) {
  const state = input.native_state === undefined || input.native_state === null
    ? {}
    : input.native_state;
  const capability = firstDefined(state.capability_evidence, input.capability_evidence, input.capability, null);
  return {
    permission_mode: strictString(firstDefined(state.permission_mode, input.permission_mode)),
    auto_or_bypass: strictBoolean(firstDefined(state.auto_or_bypass, input.auto_or_bypass)),
    native_permission_route: strictString(firstDefined(state.native_permission_route, input.native_permission_route)),
    hook_order_evidence: normalizeHookEvidence(firstDefined(state.hook_order_evidence, input.hook_order_evidence, null)),
    capability_evidence: normalizeCapabilityEvidence(capability),
  };
}

function normalizeHookEvidence(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return {
    status: strictString(value.status),
    source: strictString(value.source || value.provenance),
    pre_execution: strictBoolean(value.pre_execution),
    position: strictString(value.position),
    version: strictString(value.version),
  };
}

function normalizeCapabilityEvidence(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return {
    status: strictString(firstDefined(value.status, value.evidence_status, null)),
    host: strictString(value.host),
    host_version: strictString(value.host_version),
    route_identity: strictString(firstDefined(value.route_identity, value.route, null)),
    route_supported: strictBoolean(value.route_supported),
    enforcement_level: strictString(value.enforcement_level),
    adapter_state: strictString(value.adapter_state),
    hook_order_evidence: normalizeHookEvidence(value.hook_order_evidence),
    evidence_freshness: strictString(firstDefined(value.evidence_freshness, value.freshness, null)),
    trusted_ask: strictBoolean(value.trusted_ask),
    adapter_required: strictBoolean(value.adapter_required),
    operation_preflight: strictString(value.operation_preflight),
    version_status: strictString(value.version_status),
    expected_host_version: strictString(value.expected_host_version),
    fresh: strictBoolean(value.fresh),
    auto_mode_safe: strictBoolean(value.auto_mode_safe),
  };
}

function normalizeAuthority(input = {}) {
  const authority = input.authority && typeof input.authority === 'object' ? input.authority : {};
  const prompt = authority.prompt && typeof authority.prompt === 'object' ? authority.prompt : {};
  const role = authority.role && typeof authority.role === 'object' ? authority.role : {};
  const branch = authority.branch && typeof authority.branch === 'object' ? authority.branch : {};
  const lock = authority.design_lock && typeof authority.design_lock === 'object' ? authority.design_lock : {};
  const controller = authority.controller && typeof authority.controller === 'object' ? authority.controller : {};
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
  const controllerOperationClasses = firstDefined(
    authority.controller_operation_classes,
    authority.github_authorized_operations,
    controller.operation_classes,
    null,
  );
  const controllerAuthorized = firstDefined(authority.controller_authorized, controller.authorized, null);
  const controllerHold = firstDefined(authority.controller_hold, authority.hold, false);
  const controllerAuthorization = firstDefined(authority.controller_authorization, controller.authorization, null);
  const normalizedControllerAuthorization = controllerAuthorization === null || controllerAuthorization === undefined
    ? null
    : (!controllerAuthorization || typeof controllerAuthorization !== 'object' || Array.isArray(controllerAuthorization)
      ? controllerAuthorization
      : {
        status: strictString(controllerAuthorization.status),
        trusted: strictBoolean(controllerAuthorization.trusted),
        operation_digest: strictString(controllerAuthorization.operation_digest),
        target_digest: strictString(controllerAuthorization.target_digest),
        request_digest: strictString(controllerAuthorization.request_digest),
        external_target_digest: strictString(controllerAuthorization.external_target_digest),
        operation_class: strictString(controllerAuthorization.operation_class),
        component_digest: strictString(controllerAuthorization.component_digest),
        scope: strictString(controllerAuthorization.scope),
        expires_at: controllerAuthorization.expires_at === undefined || controllerAuthorization.expires_at === null
          ? null
          : controllerAuthorization.expires_at,
      });
  const allowedOperationClasses = firstDefined(authority.allowed_operation_classes, prompt.allowed_operation_classes, null);
  const allowedScopes = firstDefined(authority.allowed_scopes, lock.allowed_scopes, null);
  return {
    prompt_active: strictBoolean(promptActive),
    role_name: valueOrNull(roleName),
    role_allowed: strictBoolean(firstDefined(authority.role_allowed, role.allowed, null)),
    branch_name: valueOrNull(branchName),
    authorized_branch: valueOrNull(authorizedBranch),
    branch_protected: strictBoolean(firstDefined(authority.branch_protected, branch.protected, null)),
    push_authorized: strictBoolean(firstDefined(authority.push_authorized, authority.allow_push, prompt.allow_push, null)),
    design_lock_id: valueOrNull(lockId),
    design_lock_status: valueOrNull(lockStatus),
    allowed_operation_classes: strictArray(allowedOperationClasses),
    allowed_scopes: strictArray(allowedScopes),
    controller_hold: failClosedBoolean(controllerHold),
    controller_authorized: strictBoolean(controllerAuthorized),
    controller_operation_classes: strictArray(controllerOperationClasses),
    controller_authorization: normalizedControllerAuthorization,
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
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return value;
  const values = value;
  return values.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const className = firstDefined(entry.class, entry.kind, entry.type, 'unknown-external-target');
    if (typeof className !== 'string') return entry;
    return { class: className, digest: sha256(entry) };
  });
}

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
const APPROVAL_TARGET_CLASSES = new Set([
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
const APPROVAL_LINK_TYPES = new Set(['none', 'symlink', 'junction', 'reparse-point']);

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isApprovalTimestamp(value) {
  if (typeof value === 'number') return Number.isInteger(value) && Number.isFinite(value);
  return typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

function isSchemaValidApproval(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some((key) => !APPROVAL_FIELDS.has(key))) return false;
  if (value.contract_version !== APPROVAL_VERSION) return false;
  for (const key of [
    'host',
    'source',
    'trusted_user_channel',
    'session_id',
    'turn_id',
    'call_id',
    'operation_class',
  ]) {
    if (typeof value[key] !== 'string' || !value[key].trim()) return false;
  }
  if (!isDigest(value.exact_operation_digest) || !isDigest(value.exact_targets_digest)) return false;
  if (!Array.isArray(value.canonical_target_set)) return false;
  if (!value.canonical_target_set.every((target) => (
    target
    && typeof target === 'object'
    && !Array.isArray(target)
    && Object.keys(target).every((key) => ['target_class', 'status', 'link_type', 'path_digest'].includes(key))
    && APPROVAL_TARGET_CLASSES.has(target.target_class)
    && typeof target.status === 'string'
    && target.status.length > 0
    && APPROVAL_LINK_TYPES.has(target.link_type)
    && isDigest(target.path_digest)
  ))) return false;
  if (!isApprovalTimestamp(value.issued_at) || !isApprovalTimestamp(value.expires_at)) return false;
  if (typeof value.one_shot !== 'boolean' || typeof value.consumed !== 'boolean') return false;
  if (Object.hasOwn(value, 'replay_detected') && value.replay_detected !== false) return false;
  if (Object.hasOwn(value, 'consumed_count') && (!Number.isInteger(value.consumed_count) || value.consumed_count < 0)) return false;
  if (Object.hasOwn(value, 'max_repeat_count') && (!Number.isInteger(value.max_repeat_count) || value.max_repeat_count < 1)) return false;
  if (value.one_shot === true) {
    if (value.consumed !== false || Object.hasOwn(value, 'max_repeat_count')) return false;
    if (Object.hasOwn(value, 'consumed_count') && value.consumed_count !== 0) return false;
  } else if (
    value.consumed !== false
    || !Object.hasOwn(value, 'consumed_count')
    || !Object.hasOwn(value, 'max_repeat_count')
    || value.max_repeat_count > 8
  ) return false;
  return true;
}

function normalizeApproval(value) {
  if (value === null || value === undefined) return null;
  const malformed = (reason) => ({ malformed: true, digest: sha256({ reason, keys: value && typeof value === 'object' ? Object.keys(value).sort() : [] }) });
  if (!isSchemaValidApproval(value)) return malformed('approval-schema');
  const result = { ...clone(value) };
  result.canonical_target_set = value.canonical_target_set.map((entry) => ({
    target_class: entry?.target_class || null,
    status: entry?.status || null,
    link_type: entry?.link_type || 'none',
    path_digest: entry?.path_digest || null,
  }));
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

function canonicalComponents(classification) {
  const components = Array.isArray(classification?.components) && classification.components.length
    ? classification.components
    : (classification?.operation_class ? [{
      operation_class: classification.operation_class,
      decision_hint: classification.decision_hint || null,
      reason_code: classification.reason_codes?.[0] || null,
    }] : []);
  return components.map((component) => ({
    operation_class: typeof component?.operation_class === 'string' ? component.operation_class : null,
    decision_hint: typeof component?.decision_hint === 'string' ? component.decision_hint : null,
    reason_code: typeof component?.reason_code === 'string' ? component.reason_code : null,
    target_digest: typeof component?.target_digest === 'string' ? component.target_digest : sha256(component?.target_inputs || []),
    external_target_digest: typeof component?.external_target_digest === 'string' ? component.external_target_digest : sha256(component?.external_targets || []),
  }));
}

function computeComponentDigest(classification) {
  return sha256(canonicalComponents(classification));
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
    components: canonicalComponents(classification),
    component_digest: classification ? computeComponentDigest(classification) : null,
    mcp_server: operation.mcp_server || null,
    mcp_tool: operation.mcp_tool || null,
    scope: operation.scope || null,
    transaction_evidence: operation.transaction_evidence || null,
  });
}

function repositoryFromInput(input, options) {
  const supplied = firstDefined(input.repository_context, input.repository, null);
  const source = supplied && typeof supplied === 'object' ? supplied : input;
  if (typeof options.resolveRepositoryContext === 'function') return options.resolveRepositoryContext(source, options);
  return resolveRepositoryContext(source, options);
}

function normalizeOperation(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('OPERATION_INPUT_REQUIRED');
  if (Object.hasOwn(input, 'session') && (input.session === null || input.session === undefined || typeof input.session !== 'object' || Array.isArray(input.session))) throw new Error('SESSION_TYPE_INVALID');
  if (Object.hasOwn(input, 'native_state') && (input.native_state === null || input.native_state === undefined || typeof input.native_state !== 'object' || Array.isArray(input.native_state))) throw new Error('NATIVE_STATE_TYPE_INVALID');
  if (Object.hasOwn(input, 'repository') && (input.repository === null || typeof input.repository !== 'object' || Array.isArray(input.repository))) throw new Error('REPOSITORY_TYPE_INVALID');
  if (Object.hasOwn(input, 'repository_context') && (input.repository_context === null || typeof input.repository_context !== 'object' || Array.isArray(input.repository_context))) throw new Error('REPOSITORY_CONTEXT_TYPE_INVALID');
  if (Object.hasOwn(input, 'authority') && input.authority !== null && input.authority !== undefined && (typeof input.authority !== 'object' || Array.isArray(input.authority))) throw new Error('AUTHORITY_TYPE_INVALID');
  const operation = input.operation && typeof input.operation === 'object' ? input.operation : input;
  if (Object.hasOwn(input, 'operation') && (input.operation === null || input.operation === undefined || typeof input.operation !== 'object' || Array.isArray(input.operation))) throw new Error('OPERATION_TYPE_INVALID');
  const structuredInput = firstDefined(operation.structured_input, operation.structuredInput, null);
  const structured = structuredInput === undefined || structuredInput === null ? null : structuredInput;
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
    contract_version: input.contract_version === undefined ? CONTRACT_VERSION : input.contract_version,
    session,
    repository,
    operation: {
      host_tool: valueOrNull(firstDefined(operation.host_tool, operation.hostTool, input.host_tool, null)),
      canonical_route: valueOrNull(firstDefined(operation.canonical_route, operation.canonicalRoute, operation.route, null)),
      structured_input: structured === null ? null : sanitizeStructured(structured),
      opaque_input: opaque === null || opaque === undefined ? null : digestOnly(opaque),
      command: command === null ? null : strictString(command),
      shell: strictString(firstDefined(operation.shell, input.shell, null)),
      operation_cwd: strictString(operationCwd),
      targets: resolvedTargets,
      external_targets: externalTargets,
      mutation_class: strictString(firstDefined(operation.mutation_class, operation.mutationClass, operation.action, structured?.mutation_class, structured?.action, 'unknown'), 'unknown'),
      mcp_server: strictString(firstDefined(operation.mcp_server, operation.mcpServer, null)),
      mcp_tool: strictString(firstDefined(operation.mcp_tool, operation.mcpTool, null)),
      input_digest: null,
      target_digest: computeTargetDigest(resolvedTargets),
      scope: strictString(firstDefined(operation.scope, input.scope, null)),
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
  if (Array.isArray(classification?.external_targets) && classification.external_targets.length) {
    const mergedExternal = [...(Array.isArray(record.operation.external_targets) ? record.operation.external_targets : []), ...classification.external_targets];
    const seen = new Set();
    record.operation.external_targets = mergedExternal.filter((entry) => {
      const key = stableStringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
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
  normalizeHookEvidence,
  normalizeCapabilityEvidence,
  normalizeAuthority,
  sanitizeStructured,
  extractTargets,
  normalizeApproval,
  canonicalTargetSet,
  computeTargetDigest,
  canonicalComponents,
  computeComponentDigest,
  computeOperationDigest,
  normalizeOperation,
  refreshOperationDigests,
};
