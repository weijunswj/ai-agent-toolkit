'use strict';

// Preparation-only policy core. Native host integrations must supply trusted,
// constructor-captured observations and a controlled downstream dispatcher.
// This module does not install hooks, launch helpers, or prove host interception.

const compiler = require('./toolkit-gate-contract-compiler.cjs');
const { types: utilTypes } = require('node:util');
const { CapturedStackBinding } = require('./toolkit-stack-selection.cjs');

const ROUTE_FIELDS = Object.freeze(['provider', 'model', 'reasoning']);
const CALLER_ROUTES = Object.freeze({ G0: 'DISCOVERY', G1: 'BUILDER' });
const HOST_ENTRIES = Object.freeze({
  codex_spawn_agent: Object.freeze({ host: 'codex', api_generation: 'PreToolUse', entry: 'spawn_agent' }),
  codex_agent_alias: Object.freeze({ host: 'codex', api_generation: 'PreToolUse', entry: 'Agent' }),
  claude_parent_agent: Object.freeze({ host: 'claude-code', api_generation: 'PreToolUse', entry: 'Agent' }),
  opencode_v1_task: Object.freeze({ host: 'opencode', api_generation: 'V1', entry: 'tool.execute.before/task' }),
  opencode_v2_subagent: Object.freeze({ host: 'opencode', api_generation: 'V2', entry: 'ctx.tool.hook(execute.before)/subagent' }),
});

class GuardError extends Error {
  constructor(code, mismatch = null) {
    super(code);
    this.name = 'GuardError';
    this.code = code;
    this.mismatch = mismatch;
  }
}

function deny(code, mismatch = null) {
  throw new GuardError(code, mismatch);
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function captureOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || utilTypes.isProxy(options)) {
    throw new TypeError('guard options must be a non-Proxy object');
  }
  let prototype;
  let names;
  let symbols;
  try {
    prototype = Object.getPrototypeOf(options);
    names = Object.getOwnPropertyNames(options);
    symbols = Object.getOwnPropertySymbols(options);
  } catch (_) {
    throw new TypeError('guard options cannot be inspected safely');
  }
  if ((prototype !== Object.prototype && prototype !== null) || symbols.length) {
    throw new TypeError('guard options must be a plain data object');
  }
  const allowed = new Set(['entry_id', 'selected_profile_id', 'observe_host_state', 'controlled_dispatch', 'source_capture', 'selection', 'timeout_ms']);
  const snapshot = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (!allowed.has(name)) throw new TypeError('unknown guard option');
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new TypeError('guard options must use enumerable data properties');
    }
    Object.defineProperty(snapshot, name, { value: descriptor.value, enumerable: true });
  }
  return Object.freeze(snapshot);
}

function closed(value, keys, location, malformedCode = 'MALFORMED_INPUT') {
  let copy;
  try {
    copy = compiler.trustedJsonCopy(value);
  } catch (_) {
    deny(malformedCode, { location });
  }
  if (!isRecord(copy) || Object.keys(copy).sort().join('|') !== [...keys].sort().join('|')) {
    deny(malformedCode, { location, expected_keys: [...keys].sort() });
  }
  return copy;
}

function route(value, location) {
  const result = closed(value, ROUTE_FIELDS, location, 'MALFORMED_HOST_STATE');
  for (const field of ROUTE_FIELDS) {
    if (typeof result[field] !== 'string' || result[field].trim() !== result[field] || !result[field]) {
      deny('MALFORMED_HOST_STATE', { location, field });
    }
  }
  return result;
}

function routeMismatch(actual, expected, location) {
  for (const field of ROUTE_FIELDS) {
    if (actual[field] !== expected[field]) {
      deny('ROUTE_MISMATCH', { location, field, expected: expected[field], actual: actual[field] });
    }
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new GuardError('HOST_OBSERVATION_TIMEOUT')), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function normalizeHostState(raw) {
  let state;
  try {
    state = compiler.trustedJsonCopy(raw);
  } catch (_) {
    deny('MALFORMED_HOST_STATE');
  }
  if (!isRecord(state)) deny('MALFORMED_HOST_STATE');
  if (state.state === 'error') deny('HOST_OBSERVATION_ERROR');
  if (state.state === 'timeout') deny('HOST_OBSERVATION_TIMEOUT');
  const top = closed(state, ['state', 'host_version', 'registration', 'session', 'routing'], 'host_state', 'MALFORMED_HOST_STATE');
  if (top.state !== 'ready' || typeof top.host_version !== 'string' || !top.host_version.trim()) {
    deny('MALFORMED_HOST_STATE', { field: 'state_or_host_version' });
  }
  const registration = closed(top.registration,
    ['host', 'api_generation', 'entry', 'registered', 'loaded', 'enabled'], 'registration', 'MALFORMED_HOST_STATE');
  const session = closed(top.session,
    ['caller_role', 'profile_id', 'registry_revision', 'lifecycle'], 'session', 'MALFORMED_HOST_STATE');
  const routing = closed(top.routing,
    ['profile_id', 'registry_revision', 'helper_role', 'effective_route', 'native_defaults', 'pinned_defaults', 'inherited_route'],
    'routing', 'MALFORMED_HOST_STATE');
  for (const key of ['registered', 'loaded', 'enabled']) {
    if (typeof registration[key] !== 'boolean') deny('MALFORMED_HOST_STATE', { location: 'registration', field: key });
  }
  if (typeof session.caller_role !== 'string' || typeof session.profile_id !== 'string'
    || typeof session.registry_revision !== 'string' || typeof session.lifecycle !== 'string') {
    deny('MALFORMED_HOST_STATE', { location: 'session' });
  }
  if (typeof routing.profile_id !== 'string' || typeof routing.registry_revision !== 'string'
    || typeof routing.helper_role !== 'string') {
    deny('MALFORMED_HOST_STATE', { location: 'routing' });
  }
  routing.effective_route = route(routing.effective_route, 'routing.effective_route');
  routing.native_defaults = route(routing.native_defaults, 'routing.native_defaults');
  routing.pinned_defaults = closed(routing.pinned_defaults, ROUTE_FIELDS, 'routing.pinned_defaults', 'MALFORMED_HOST_STATE');
  for (const field of ROUTE_FIELDS) {
    if (routing.pinned_defaults[field] !== true) {
      deny('DEFAULT_NOT_PINNED', { field, actual: routing.pinned_defaults[field] });
    }
  }
  if (routing.inherited_route !== null) routing.inherited_route = route(routing.inherited_route, 'routing.inherited_route');
  return { ...top, registration, session, routing };
}

function validateInvocation(input) {
  const invocation = closed(input,
    ['caller_role', 'profile_id', 'registry_revision', 'helper_role', 'helper_requested', 'route_overrides', 'session_transition'],
    'invocation');
  if (typeof invocation.caller_role !== 'string' || typeof invocation.profile_id !== 'string'
    || typeof invocation.registry_revision !== 'string' || typeof invocation.helper_role !== 'string'
    || typeof invocation.helper_requested !== 'boolean' || typeof invocation.session_transition !== 'string') {
    deny('MALFORMED_INPUT', { location: 'invocation' });
  }
  const overrides = compiler.trustedJsonCopy(invocation.route_overrides);
  if (!isRecord(overrides) || Object.keys(overrides).some((key) => !ROUTE_FIELDS.includes(key))) {
    deny('MALFORMED_INPUT', { location: 'route_overrides' });
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value) {
      deny('MALFORMED_INPUT', { location: 'route_overrides', field: key });
    }
  }
  return { ...invocation, route_overrides: overrides };
}

class HelperRouteGuard {
  #entryId; #entry; #observeHostState; #controlledDispatch; #binding; #timeoutMs;
  constructor(options) {
  const captured = captureOptions(options);
  const entryId = captured.entry_id;
  const observeHostState = captured.observe_host_state;
  const controlledDispatch = captured.controlled_dispatch;
  const entry = HOST_ENTRIES[entryId];
  if (!entry) throw new TypeError('an explicit supported host entry is required');
  if (typeof observeHostState !== 'function' || typeof controlledDispatch !== 'function') {
    throw new TypeError('constructor-captured observation and controlled dispatch callbacks are required');
  }
  const binding = new CapturedStackBinding({ source_capture: captured.source_capture, selection: captured.selection });
  if (captured.selected_profile_id !== undefined && captured.selected_profile_id !== binding.selection.profile_id) {
    throw new TypeError('selected_profile_id conflicts with the captured selection');
  }
  const timeoutMs = captured.timeout_ms === undefined ? 150 : captured.timeout_ms;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new TypeError('timeout_ms must be an integer from 1 to 10000');
  }

  this.#entryId=entryId; this.#entry=entry; this.#observeHostState=observeHostState;
  this.#controlledDispatch=controlledDispatch; this.#binding=binding; this.#timeoutMs=timeoutMs;
  Object.freeze(this);
  }
  get entry_id() { return this.#entryId; }
  get selected_profile_id() { return this.#binding.selection.profile_id; }
  get resolved_profile_id() { return this.#binding.selection.profile_id; }
  get registry_revision() { return this.#binding.sourceDigest; }
  async #observe() {
    const entryId=this.#entryId, entry=this.#entry, observeHostState=this.#observeHostState, timeoutMs=this.#timeoutMs;
    let pending;
    try {
      pending = observeHostState(Object.freeze({ entry_id: entryId, ...entry }));
    } catch (_) {
      deny('HOST_OBSERVATION_ERROR');
    }
    let raw;
    try {
      raw = await withTimeout(pending, timeoutMs);
    } catch (error) {
      if (error instanceof GuardError) throw error;
      deny('HOST_OBSERVATION_ERROR');
    }
    return normalizeHostState(raw);
  }

  async invoke(rawInvocation) {
    const entryId=this.#entryId, entry=this.#entry, controlledDispatch=this.#controlledDispatch;
    const selectedProfile=this.#binding.selection, selectedProfileId=selectedProfile.profile_id, registryRevision=this.#binding.sourceDigest;
    let invocation;
    let dispatchCalled = false;
    try {
      invocation = validateInvocation(rawInvocation);
      if (!invocation.helper_requested) {
        return Object.freeze({
          decision: 'NOOP_NO_HELPER_REQUEST', code: 'NO_HELPER_REQUEST', entry_id: entryId,
          dispatch: 'NOT_CALLED', host_qualification: 'PREPARATION_ONLY',
        });
      }
      if (!['G0', 'G1'].includes(invocation.caller_role)) {
        deny('CALLER_CANNOT_DELEGATE', { caller_role: invocation.caller_role });
      }
      if (invocation.session_transition !== 'fresh') {
        deny('RESTORE_OR_ALTERNATE_SESSION', { session_transition: invocation.session_transition });
      }
      if (invocation.profile_id !== selectedProfileId) {
        deny('PROFILE_NOT_SELECTED', { selected: selectedProfileId, requested: invocation.profile_id });
      }

      const before = await this.#observe();
      const expectedRegistration = { ...entry };
      for (const key of ['host', 'api_generation', 'entry']) {
        if (before.registration[key] !== expectedRegistration[key]) {
          deny('HOST_ENTRY_MISMATCH', { field: key, expected: expectedRegistration[key], actual: before.registration[key] });
        }
      }
      if (!before.registration.registered || !before.registration.loaded || !before.registration.enabled) {
        deny('HOOK_UNAVAILABLE', {
          registered: before.registration.registered,
          loaded: before.registration.loaded,
          enabled: before.registration.enabled,
        });
      }
      if (before.session.lifecycle !== 'fresh') {
        deny('RESTORE_OR_ALTERNATE_SESSION', { lifecycle: before.session.lifecycle });
      }
      if (before.session.caller_role !== invocation.caller_role) {
        deny('CALLER_BINDING_MISMATCH', { expected: before.session.caller_role, actual: invocation.caller_role });
      }
      if (before.session.profile_id !== selectedProfileId
        || before.routing.profile_id !== selectedProfileId) {
        deny('PROFILE_BINDING_MISMATCH', {
          selected: selectedProfileId,
          session: before.session.profile_id,
          routing: before.routing.profile_id,
        });
      }
      if (registryRevision !== invocation.registry_revision
        || before.session.registry_revision !== invocation.registry_revision
        || before.routing.registry_revision !== invocation.registry_revision) {
        deny('REGISTRY_REVISION_MISMATCH', { expected: registryRevision, requested: invocation.registry_revision });
      }

      const callerRoute = CALLER_ROUTES[invocation.caller_role];
      const helperRole = `${callerRoute}_HELPER`;
      if (invocation.helper_role !== helperRole || before.routing.helper_role !== helperRole) {
        deny('HELPER_ROLE_MISMATCH', { expected: helperRole, requested: invocation.helper_role, observed: before.routing.helper_role });
      }
      const resolved = selectedProfile;
      const expectedRoute = resolved.routes[helperRole];
      if (!expectedRoute) deny('HELPER_ROUTE_UNAVAILABLE', { profile_id: resolved.profile_id, helper_role: helperRole });

      routeMismatch(before.routing.effective_route, expectedRoute, 'effective_route');
      routeMismatch(before.routing.native_defaults, expectedRoute, 'native_defaults');
      if (before.routing.inherited_route !== null) routeMismatch(before.routing.inherited_route, expectedRoute, 'inherited_route');
      for (const [field, value] of Object.entries(invocation.route_overrides)) {
        if (value !== expectedRoute[field]) {
          deny('ROUTE_OVERRIDE_CONFLICT', { field, expected: expectedRoute[field], actual: value });
        }
      }

      const after = await this.#observe();
      if (compiler.hashCanonical(before) !== compiler.hashCanonical(after)) {
        deny('POSTCHECK_CONFIGURATION_DRIFT', { entry_id: entryId });
      }

      const dispatchRequest = compiler.canonicalize({
        schema: 'toolkit.v3.helper-dispatch-preparation.v1',
        entry_id: entryId,
        host_entry: entry,
        host_version: before.host_version,
        caller_role: invocation.caller_role,
        profile_id: resolved.profile_id,
        requested_profile_id: selectedProfileId,
        selected_profile_id: selectedProfileId,
        registry_revision: registryRevision,
        registry_reference: selectedProfile.registry_reference,
        helper_role: helperRole,
        route: expectedRoute,
        route_overrides: invocation.route_overrides,
      });
      let downstreamResult;
      try {
        dispatchCalled = true;
        downstreamResult = compiler.trustedJsonCopy(await controlledDispatch(dispatchRequest));
      } catch (_) {
        return Object.freeze({
          decision: 'DISPATCH_FAILED', code: 'DOWNSTREAM_OUTCOME_UNKNOWN',
          mismatch: { entry_id: entryId, stage: 'controlled_dispatch' },
          entry_id: entryId, dispatch: 'CALLED', downstream_result: 'UNKNOWN',
          host_qualification: 'PREPARATION_ONLY',
        });
      }
      return Object.freeze({
        decision: 'ALLOW', code: 'ROUTE_VERIFIED', entry_id: entryId,
        host_version: before.host_version, host_entry: entry,
        caller_role: invocation.caller_role, profile_id: resolved.profile_id,
        registry_revision: registryRevision, helper_role: helperRole,
        effective_route: expectedRoute, dispatch: 'CALLED', downstream_result: downstreamResult,
        host_qualification: 'PREPARATION_ONLY',
      });
    } catch (error) {
      const code = error instanceof GuardError ? error.code : 'GUARD_INTERNAL_ERROR';
      const mismatch = error instanceof GuardError ? error.mismatch : null;
      if (dispatchCalled) {
        return Object.freeze({
          decision: 'DISPATCH_FAILED', code: 'DOWNSTREAM_OUTCOME_UNKNOWN',
          mismatch: mismatch || { stage: 'post_dispatch' }, entry_id: entryId,
          dispatch: 'CALLED', downstream_result: 'UNKNOWN', host_qualification: 'PREPARATION_ONLY',
        });
      }
      return Object.freeze({
        decision: 'DENY', code, mismatch, entry_id: entryId,
        dispatch: 'NOT_CALLED', host_qualification: 'PREPARATION_ONLY',
      });
    }
  }

}

function createHelperRouteGuard(options) { return new HelperRouteGuard(options); }

module.exports = Object.freeze({
  HOST_ENTRIES,
  HelperRouteGuard,
  createHelperRouteGuard,
});
