'use strict';

// Native adapters translate host events; authority and resolved host state come
// only from the launcher-captured observer. A hook ALLOW is not qualification.
//
// Responsibilities are split into cohesive objects:
//   HostDialect          - per-host vocabulary: entry ids, native override fields,
//                          helper-definition shape and effective-state resolution.
//   PinnedNativeBinding  - the launcher-selected binding file, verified by digest
//                          on every read.
//   NativeHelperAdapter  - translates one native pre-dispatch event into a guarded
//                          invocation of the shared HelperRouteGuard.
//   NativeHookDecision   - composes the above for a host hook command and renders
//                          the native allow/deny output.
// Host lanes live in their own files and extend HostDialect through a factory, so they
// never require this core back:
//   toolkit-v3-native-helper-adapter-codex.cjs  - Codex dialect, hook matcher, registration check.
//   toolkit-v3-native-helper-adapter-claude.cjs - Claude dialect, exact model maps, Task alias.
// The exported functions keep the existing public contract as thin facades.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { types } = require('node:util');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const { HOST_ENTRIES, createHelperRouteGuard } = require('./toolkit-v3-helper-guard.cjs');
const { CapturedStackBinding } = require('./toolkit-stack-selection.cjs');
const { CODEX_SPAWN_MATCHER, CODEX_HELPER_HOOK_MATCHER, CodexHookMatcher, defineCodexDialect,
  verifyCodexHelperRegistration } = require('./toolkit-v3-native-helper-adapter-codex.cjs');
const { defineClaudeDialect } = require('./toolkit-v3-native-helper-adapter-claude.cjs');

function fail(code) { throw Object.assign(new Error(code), { code }); }
const HELPER_PROMPT = 'Complete only the lead-assigned bounded leaf task. Do not spawn or delegate to another agent. Do not approve scope, publish, activate or declare programme completion. Return exact changed files, checks and blockers to the lead.';

class HostDialect {
  #host; #provider; #overrideFields;
  constructor({ host, provider, overrideFields }) {
    this.#host = host; this.#provider = provider; this.#overrideFields = Object.freeze(overrideFields);
    Object.freeze(this);
  }
  get host() { return this.#host; }

  static for(host) {
    const dialect = DIALECTS[host];
    if (!dialect) fail('NATIVE_HELPER_DEFINITION_SELECTION_INVALID');
    return dialect;
  }

  // The provider this host can route a helper to; other routes are unsupported here.
  supports(route) { return route.provider === this.#provider; }

  // Native fields a tool call may use to request a route, mapped to the logical route.
  overrides(args) {
    const result = {};
    for (const [native, logical] of this.#overrideFields) {
      if (!Object.hasOwn(args, native)) continue;
      let value = args[native];
      if (typeof value !== 'string' || !value || value !== value.trim()) fail('NATIVE_OVERRIDE_INVALID');
      if (logical === 'model') value = this.logicalModel(value);
      if (Object.hasOwn(result, logical) && result[logical] !== value) fail('NATIVE_OVERRIDE_CONFLICT');
      result[logical] = value;
    }
    return result;
  }

  logicalModel(value) { return value; }
  nativeDefinition() { fail('NATIVE_HELPER_DEFINITION_SELECTION_INVALID'); }
  helperIdentity(name) { return name; }
  entryFor(toolName) { return toolName; }
  resolveObservedState(binding) { return binding.host_state; }
  // Hook-command vocabulary: which native tool names this host's hook decides, whether a
  // request forks the session, the guard entry name, extra pinned caller fields, alias checks.
  handles() { return false; }
  forksSession() { return false; }
  canonicalName(toolName) { return toolName; }
  callerBinding() { return {}; }
  checkAlias() {}
}

const CodexDialect = defineCodexDialect({ HostDialect, HELPER_PROMPT });
const ClaudeDialect = defineClaudeDialect({ HostDialect });
const DIALECTS = Object.freeze({ codex: new CodexDialect(), 'claude-code': new ClaudeDialect() });


// Rendering is separate from admission, native acknowledgement and launch. The
// same current registry supplies explicit definitions and the enforcing guard.
function renderNativeHelperDefinition(host, callerRole, captured) {
  if (!['G0', 'G1'].includes(callerRole) || !DIALECTS[host]) fail('NATIVE_HELPER_DEFINITION_SELECTION_INVALID');
  const dialect = HostDialect.for(host);
  const binding = new CapturedStackBinding(captured), selection = binding.selection;
  const helperRole = callerRole === 'G0' ? 'DISCOVERY_HELPER' : 'BUILDER_HELPER';
  const route = binding.role(helperRole).route;
  if (!dialect.supports(route)) fail('NATIVE_HELPER_ROUTE_UNSUPPORTED');
  const name = 'toolkit-' + callerRole.toLowerCase() + '-helper';
  const native = dialect.nativeDefinition(name, route, callerRole);
  return compiler.trustedJsonCopy({ host, caller_role: callerRole, helper_role: helperRole, selected_profile_id: selection.profile_id,
    registry_revision: binding.sourceDigest, registry_reference: selection.registry_reference, route,
    helper_identity: dialect.helperIdentity(name, native), native_configuration: native,
    qualification: 'CONFIGURATION_GENERATED_ONLY' });
}

// A binding is selected by an approved launcher, with the digest in its native
// command/config. Hook input cannot choose a binding or self-certify registration.
class PinnedNativeBinding {
  #path; #digest;
  constructor(filename, digest) {
    if (!path.isAbsolute(filename || '') || !/^[a-f0-9]{64}$/.test(digest || '')) fail('NATIVE_BINDING_REQUIRED');
    this.#path = path.resolve(filename); this.#digest = digest;
    Object.freeze(this);
  }
  read() {
    let current = path.parse(this.#path).root;
    for (const part of this.#path.slice(current.length).split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) fail('NATIVE_BINDING_ALIAS');
    }
    const stat = fs.lstatSync(this.#path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) fail('NATIVE_BINDING_INVALID');
    const bytes = fs.readFileSync(this.#path);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== this.#digest) fail('NATIVE_BINDING_DRIFT');
    return compiler.trustedJsonCopy(JSON.parse(bytes));
  }
  // The binding envelope a hook may act on: it must name its exact parent session.
  envelope() {
    const value = this.read();
    if (value.schema !== 'toolkit.v3.native-helper-binding.v1' || !value.session_id || !value.cwd
      || !value.helper_identity || !value.caller_model) fail('NATIVE_BINDING_INVALID');
    return value;
  }
}

function captureOptions(input) {
  if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) fail('NATIVE_ADAPTER_OPTIONS_INVALID');
  const output = Object.create(null);
  for (const name of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('NATIVE_ADAPTER_OPTIONS_INVALID');
    output[name] = descriptor.value;
  }
  if (Object.getOwnPropertySymbols(input).length) fail('NATIVE_ADAPTER_OPTIONS_INVALID');
  return Object.freeze(output);
}

const ADAPTER_OPTIONS = Object.freeze(['entry_id', 'observe_host_state', 'dispatch_native', 'helper_identity', 'selected_profile_id',
  'timeout_ms', 'session_id', 'cwd', 'caller_model', 'source_capture', 'selection']);

class NativeHelperAdapter {
  #options; #entry; #dialect; #guard;
  constructor(input) {
    const options = captureOptions(input), entry = HOST_ENTRIES[options.entry_id];
    if (Object.keys(options).some(key => !ADAPTER_OPTIONS.includes(key))) fail('NATIVE_ADAPTER_OPTIONS_INVALID');
    if (!entry || typeof options.observe_host_state !== 'function') fail('NATIVE_ADAPTER_BINDING_REQUIRED');
    if (typeof options.dispatch_native !== 'function') fail('NATIVE_DISPATCH_REQUIRED');
    if (typeof options.helper_identity !== 'string' || !options.helper_identity) fail('NATIVE_HELPER_IDENTITY_REQUIRED');
    this.#options = options; this.#entry = entry; this.#dialect = HostDialect.for(entry.host);
    this.#guard = createHelperRouteGuard({ entry_id: options.entry_id,
      source_capture: options.source_capture, selection: options.selection,
      ...(options.selected_profile_id === undefined ? {} : { selected_profile_id: options.selected_profile_id }),
      observe_host_state: options.observe_host_state, controlled_dispatch: options.dispatch_native,
      ...(options.timeout_ms === undefined ? {} : { timeout_ms: options.timeout_ms }) });
    Object.defineProperty(this, 'invoke', { value: raw => this.#invoke(raw), enumerable: true });
    Object.freeze(this);
  }
  get entry_id() { return this.#options.entry_id; }
  get registry_revision() { return this.#guard.registry_revision; }

  // Binds the event to the launcher's exact session, workspace and caller.
  #checkEvent(event) {
    const options = this.#options;
    if (!event || event.hook_event_name !== 'PreToolUse' || event.tool_name !== this.#entry.entry) fail('NATIVE_ENTRY_MISMATCH');
    if (options.session_id !== undefined && event.session_id !== options.session_id) fail('NATIVE_CALLER_SESSION_MISMATCH');
    if (options.cwd !== undefined && event.cwd !== options.cwd) fail('NATIVE_WORKSPACE_MISMATCH');
    if (options.caller_model !== undefined && event.model !== options.caller_model) fail('NATIVE_CALLER_MODEL_MISMATCH');
    if (event.agent_id || event.agent_type) fail('NATIVE_LEAF_CANNOT_DELEGATE');
    const args = event.tool_input;
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('NATIVE_INPUT_INVALID');
    return args;
  }

  async #observe() {
    let timer;
    const observation = Promise.resolve().then(() => this.#options.observe_host_state(Object.freeze({ entry_id: this.#options.entry_id, ...this.#entry })));
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('NATIVE_OBSERVATION_TIMEOUT'), { code: 'NATIVE_OBSERVATION_TIMEOUT' })), this.#options.timeout_ms || 150); });
    return Promise.race([observation, deadline]).finally(() => clearTimeout(timer));
  }

  async #invoke(raw) {
    try {
      const args = this.#checkEvent(compiler.trustedJsonCopy(raw));
      const state = await this.#observe();
      // Match the loaded fully-qualified definition, never a name supplied by
      // the model as evidence of which profile was actually loaded.
      const selected = args.subagent_type ?? args.agent_type;
      if (args.subagent_type !== undefined && args.agent_type !== undefined && args.subagent_type !== args.agent_type) fail('NATIVE_HELPER_IDENTITY_CONFLICT');
      if (selected !== this.#options.helper_identity) fail('NATIVE_HELPER_IDENTITY_MISMATCH');
      if (args.resume || args.fork || args.fork_context === true || args.session_id || args.sessionID
        || (args.fork_turns !== undefined && String(args.fork_turns).trim().toLowerCase() !== 'none')) fail('NATIVE_SESSION_TRANSITION_UNQUALIFIED');
      return await this.#guard.invoke({ caller_role: state.session.caller_role,
        profile_id: state.session.profile_id, registry_revision: state.session.registry_revision,
        helper_role: state.routing.helper_role, helper_requested: true,
        route_overrides: this.#dialect.overrides(args), session_transition: 'fresh' });
    } catch (error) {
      return Object.freeze({ decision: 'DENY', code: error.code || 'NATIVE_ADAPTER_ERROR',
        dispatch: 'NOT_CALLED', host_qualification: 'UNQUALIFIED' });
    }
  }
}

function hookOutput(result) {
  if (result.decision !== 'ALLOW') return { hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: 'Toolkit helper held: ' + result.code } };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
}

// Composes the host dialect, pinned binding and adapter for one hook command.
class NativeHookDecision {
  #dialect; #options;
  constructor(host, options = {}) { this.#dialect = HostDialect.for(host); this.#options = options; }

  async decide(input) {
    const name = input.tool_name, options = this.#options;
    if (!this.#dialect.handles(name)) return {};
    try {
      if (this.#dialect.forksSession(name, input.tool_input || {})) fail('NATIVE_SESSION_TRANSITION_UNQUALIFIED');
      const entryId = this.#dialect.entryFor(name);
      const binding = options.observe_host_state ? null : new PinnedNativeBinding(options.binding_path, options.binding_sha256);
      const envelope = binding ? binding.envelope() : null;
      const observer = options.observe_host_state || (() => this.#dialect.resolveObservedState(binding.read(), input.tool_input || {}, process.env));
      const selected = envelope || options;
      const adapter = new NativeHelperAdapter({ entry_id: entryId, observe_host_state: observer,
        source_capture: selected.source_capture, selection: selected.selection,
        helper_identity: envelope ? envelope.helper_identity : options.helper_identity,
        ...(envelope ? { session_id: envelope.session_id, cwd: envelope.cwd, ...this.#dialect.callerBinding(envelope) } : {}),
        dispatch_native: () => ({ permission_check: 'VERIFIED', inference_dispatched: false }) });
      this.#dialect.checkAlias(name, options);
      return hookOutput(await adapter.invoke({ ...input, tool_name: this.#dialect.canonicalName(name) }));
    } catch (error) { return hookOutput({ decision: 'DENY', code: error.code || 'NATIVE_BINDING_INVALID' }); }
  }
}

// Public facades preserving the existing module contract.
const claudeNativeModel = route => ClaudeDialect.nativeModel(route);
const overrides = (args, host) => HostDialect.for(host).overrides(args);
const resolveClaudeNativeState = (binding, invocation, environment) => DIALECTS['claude-code'].resolveObservedState(binding, invocation, environment);
const pinnedBindingObserver = (filename, digest) => { const binding = new PinnedNativeBinding(filename, digest); return () => binding.read(); };
const createNativeHelperAdapter = input => new NativeHelperAdapter(input);
const commandDecision = (input, host, options = {}) => new NativeHookDecision(host, options).decide(input);
function readNativeSelectionFromEnvironment(environment = process.env) {
  const envelope = new PinnedNativeBinding(environment.TOOLKIT_NATIVE_HELPER_BINDING, environment.TOOLKIT_NATIVE_HELPER_BINDING_SHA256).read();
  const captured = { source_capture: envelope.source_capture, selection: envelope.selection };
  new CapturedStackBinding(captured);
  return captured;
}

module.exports = Object.freeze({ CODEX_SPAWN_MATCHER, CODEX_HELPER_HOOK_MATCHER, HostDialect, CodexDialect, CodexHookMatcher, PinnedNativeBinding, NativeHelperAdapter, NativeHookDecision,
  renderNativeHelperDefinition, claudeNativeModel, readNativeSelectionFromEnvironment, createNativeHelperAdapter,
  pinnedBindingObserver, commandDecision, hookOutput, overrides, resolveClaudeNativeState, verifyCodexHelperRegistration });
