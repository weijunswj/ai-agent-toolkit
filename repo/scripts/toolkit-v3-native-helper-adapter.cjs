'use strict';

// Native adapters translate host events; authority and resolved host state come
// only from the launcher-captured observer. A hook ALLOW is not qualification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { types } = require('node:util');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const { HOST_ENTRIES, createHelperRouteGuard } = require('./toolkit-v3-helper-guard.cjs');

const { CapturedStackBinding } = require('./toolkit-stack-selection.cjs');
const CLAUDE_NATIVE_MODELS = Object.freeze({ 'haiku-5.5': 'claude-haiku-5-5', 'opus-5.5': 'claude-opus-5-5' });

// Rendering is separate from admission, native acknowledgement and launch. The
// same current registry supplies explicit definitions and the enforcing guard.
function renderNativeHelperDefinition(host, callerRole, captured) {
  if (!['G0','G1'].includes(callerRole) || !['codex','claude-code','opencode'].includes(host)) fail('NATIVE_HELPER_DEFINITION_SELECTION_INVALID');
  const binding = new CapturedStackBinding(captured), selection=binding.selection, profile=selection.profile_id;
  const helperRole = callerRole === 'G0' ? 'DISCOVERY_HELPER' : 'BUILDER_HELPER';
  const route = binding.role(helperRole).route;
  if (host === 'codex' && route.provider !== 'openai'
    || host === 'claude-code' && (route.provider !== 'anthropic' || !CLAUDE_NATIVE_MODELS[route.model])) fail('NATIVE_HELPER_ROUTE_UNSUPPORTED');
  const name = 'toolkit-' + callerRole.toLowerCase() + '-helper';
  const prompt = 'Complete only the lead-assigned bounded leaf task. Do not spawn or delegate to another agent. Do not approve scope, publish, activate or declare programme completion. Return exact changed files, checks and blockers to the lead.';
  let native;
  if (host === 'opencode') native = {agent:{[name]:{mode:'subagent',model:route.provider+'/'+route.model,
    variant:route.reasoning,options:{reasoningEffort:route.reasoning},permission:{task:'deny'},prompt}}};
  if (host === 'codex') native = {agent_type:name,agent_config:{model:route.model,
    model_provider:route.provider,model_reasoning_effort:route.reasoning,developer_instructions:prompt}};
  if (host === 'claude-code') native = {name:callerRole.toLowerCase()+'-helper',model:CLAUDE_NATIVE_MODELS[route.model],
    effort:route.reasoning,disallowedTools:['Agent','Task'],description:'Bounded leaf work explicitly assigned by the Toolkit '+callerRole+' lead.',prompt};
  return compiler.trustedJsonCopy({host,caller_role:callerRole,helper_role:helperRole,selected_profile_id:profile,
    registry_revision:binding.sourceDigest,registry_reference:selection.registry_reference,route,
    helper_identity:host==='claude-code'?'ai-agent-toolkit:'+native.name:name,native_configuration:native,
    qualification:'CONFIGURATION_GENERATED_ONLY'});
}

function claudeNativeModel(route) {
  if (!route || route.provider !== 'anthropic' || !CLAUDE_NATIVE_MODELS[route.model]) fail('CLAUDE_NATIVE_ROUTE_UNSUPPORTED');
  return CLAUDE_NATIVE_MODELS[route.model];
}
function fail(code) { throw Object.assign(new Error(code), { code }); }
function capture(input) {
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
function overrides(args, host) {
  const result = {};
  for (const [native, logical] of [['provider','provider'],['model_provider','provider'],['model','model'],['reasoning_effort','reasoning'],['effort','reasoning'], ...(host === 'opencode' ? [['variant','reasoning']] : [])]) {
    if (!Object.hasOwn(args, native)) continue;
    let value = args[native];
    if (typeof value !== 'string' || !value || value !== value.trim()) fail('NATIVE_OVERRIDE_INVALID');
    if (logical === 'model' && host === 'claude-code') {
      // Exact IDs only. Family aliases can resolve differently with environment,
      // allowlist, parent family and mods; the observer must resolve those first.
      const ids = { 'claude-haiku-5-5': 'haiku-5.5', 'claude-opus-5-5': 'opus-5.5' };
      value = ids[value] || value;
    }
    if (Object.hasOwn(result, logical) && result[logical] !== value) fail('NATIVE_OVERRIDE_CONFLICT');
    result[logical] = value;
  }
  return result;
}
function createNativeHelperAdapter(input) {
  const options = capture(input), entry = HOST_ENTRIES[options.entry_id];
  const allowed = ['entry_id','observe_host_state','dispatch_native','helper_identity','selected_profile_id','timeout_ms','session_id','cwd','caller_model','source_capture','selection'];
  if (Object.keys(options).some(key => !allowed.includes(key))) fail('NATIVE_ADAPTER_OPTIONS_INVALID');
  if (!entry || typeof options.observe_host_state !== 'function') fail('NATIVE_ADAPTER_BINDING_REQUIRED');
  const observe = options.observe_host_state;
  const downstream = options.dispatch_native;
  if (typeof downstream !== 'function') fail('NATIVE_DISPATCH_REQUIRED');
  const helperIdentity = options.helper_identity;
  if (typeof helperIdentity !== 'string' || !helperIdentity) fail('NATIVE_HELPER_IDENTITY_REQUIRED');
  const guard = createHelperRouteGuard({ entry_id: options.entry_id,
    source_capture: options.source_capture, selection: options.selection,
    ...(options.selected_profile_id === undefined ? {} : { selected_profile_id: options.selected_profile_id }),
    observe_host_state: observe, controlled_dispatch: downstream,
    ...(options.timeout_ms === undefined ? {} : { timeout_ms: options.timeout_ms }) });
  async function invoke(raw) {
    try {
      const event = compiler.trustedJsonCopy(raw);
      if (!event || event.hook_event_name !== 'PreToolUse' || event.tool_name !== entry.entry) fail('NATIVE_ENTRY_MISMATCH');
      if (options.session_id !== undefined && event.session_id !== options.session_id) fail('NATIVE_CALLER_SESSION_MISMATCH');
      if (options.cwd !== undefined && event.cwd !== options.cwd) fail('NATIVE_WORKSPACE_MISMATCH');
      if (options.caller_model !== undefined && event.model !== options.caller_model) fail('NATIVE_CALLER_MODEL_MISMATCH');
      if (event.agent_id || event.agent_type) fail('NATIVE_LEAF_CANNOT_DELEGATE');
      const args = event.tool_input;
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('NATIVE_INPUT_INVALID');
      let timer;
      const observation = Promise.resolve().then(() => observe(Object.freeze({ entry_id: options.entry_id, ...entry })));
      const deadline = new Promise((_,reject) => { timer = setTimeout(() => reject(Object.assign(new Error('NATIVE_OBSERVATION_TIMEOUT'),{code:'NATIVE_OBSERVATION_TIMEOUT'})),options.timeout_ms || 150); });
      const state = await Promise.race([observation,deadline]).finally(() => clearTimeout(timer));
      // Match the loaded fully-qualified definition, never a name supplied by
      // the model as evidence of which profile was actually loaded.
      const selected = args.subagent_type ?? args.agent_type;
      if (args.subagent_type !== undefined && args.agent_type !== undefined && args.subagent_type !== args.agent_type) fail('NATIVE_HELPER_IDENTITY_CONFLICT');
      if (selected !== helperIdentity) fail('NATIVE_HELPER_IDENTITY_MISMATCH');
      if (args.resume || args.fork || args.fork_context === true || args.session_id || args.sessionID || args.fork_turns === 'all') fail('NATIVE_SESSION_TRANSITION_UNQUALIFIED');
      return await guard.invoke({ caller_role: state.session.caller_role,
        profile_id: state.session.profile_id, registry_revision: state.session.registry_revision,
        helper_role: state.routing.helper_role, helper_requested: true,
        route_overrides: overrides(args, entry.host), session_transition: 'fresh' });
    } catch (error) {
      return Object.freeze({ decision: 'DENY', code: error.code || 'NATIVE_ADAPTER_ERROR',
        dispatch: 'NOT_CALLED', host_qualification: 'UNQUALIFIED' });
    }
  }
  return Object.freeze({ entry_id: options.entry_id, registry_revision: guard.registry_revision, invoke });
}
function hookOutput(result) {
  if (result.decision !== 'ALLOW') return { hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: 'Toolkit helper held: ' + result.code } };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
}
function verifyCodexHelperRegistration(response, { cwd, command }) {
  const data = compiler.trustedJsonCopy(response);
  const entry = data?.data?.find(item => item.cwd === cwd);
  if (!entry || entry.errors?.length || entry.warnings?.length) fail('CODEX_HOOK_REGISTRATION_UNVERIFIED');
  const hooks = entry.hooks.filter(hook => hook.eventName === 'preToolUse' && hook.command === command);
  for (const name of ['spawn_agent','Agent']) {
    const matching = hooks.find(hook => {
      try { return new RegExp(hook.matcher || '.*').test(name); } catch { return false; }
    });
    if (!matching || matching.enabled !== true || !['trusted','managed'].includes(matching.trustStatus)) fail('CODEX_REQUIRED_HOOK_NOT_TRUSTED');
  }
  return Object.freeze({ state:'REGISTRATION_VERIFIED', qualification:'UNQUALIFIED_UNTIL_NATIVE_MATRIX', cwd });
}
function resolveClaudeNativeState(binding, invocation, environment) {
  const config = binding.native_config;
  if (!config || config.loaded_agent !== binding.helper_identity || config.mods_present !== false
    || config.provider !== 'anthropic' || !Array.isArray(config.available_models)) fail('CLAUDE_EFFECTIVE_CONFIG_UNVERIFIED');
  const forced = environment.CLAUDE_CODE_SUBAGENT_MODEL_FORCE === '1';
  let model = forced ? environment.CLAUDE_CODE_SUBAGENT_MODEL || config.parent_model
    : invocation.model || config.agent_model || environment.CLAUDE_CODE_SUBAGENT_MODEL || config.parent_model;
  if (model === 'inherit') model = config.parent_model;
  // Family aliases, provider remaps and unavailable-model substitution must be
  // observed natively. They cannot manufacture an exact approved route here.
  if (!config.available_models.includes(model)) fail('CLAUDE_MODEL_SUBSTITUTION_UNQUALIFIED');
  const logical = { 'claude-haiku-5-5':'haiku-5.5', 'claude-opus-5-5':'opus-5.5' }[model];
  if (!logical) fail('CLAUDE_MODEL_ALIAS_UNQUALIFIED');
  const effort = environment.CLAUDE_CODE_EFFORT_LEVEL || invocation.effort || config.agent_effort || config.session_effort;
  if (!effort) fail('CLAUDE_EFFECTIVE_EFFORT_UNVERIFIED');
  const state = compiler.trustedJsonCopy(binding.host_state);
  state.routing.effective_route = {provider:config.provider,model:logical,reasoning:effort};
  return state;
}
// A binding is selected by an approved launcher, with the digest in its native
// command/config. Hook input cannot choose a binding or self-certify registration.
function pinnedBindingObserver(filename, digest) {
  if (!path.isAbsolute(filename || '') || !/^[a-f0-9]{64}$/.test(digest || '')) fail('NATIVE_BINDING_REQUIRED');
  const expectedPath = path.resolve(filename);
  return () => {
    let current = path.parse(expectedPath).root;
    for (const part of expectedPath.slice(current.length).split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) fail('NATIVE_BINDING_ALIAS');
    }
    const stat = fs.lstatSync(expectedPath);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) fail('NATIVE_BINDING_INVALID');
    const bytes = fs.readFileSync(expectedPath);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest) fail('NATIVE_BINDING_DRIFT');
    return compiler.trustedJsonCopy(JSON.parse(bytes));
  };
}
function readNativeSelectionFromEnvironment(environment = process.env) {
  const envelope = pinnedBindingObserver(environment.TOOLKIT_NATIVE_HELPER_BINDING, environment.TOOLKIT_NATIVE_HELPER_BINDING_SHA256)();
  const captured = { source_capture: envelope.source_capture, selection: envelope.selection };
  new CapturedStackBinding(captured);
  return captured;
}
async function commandDecision(input, host, options = {}) {
  const name = input.tool_name;
  if (host === 'codex' && !['spawn_agent','Agent'].includes(name) || host === 'claude-code' && !['Agent','Task'].includes(name)) return {};
  try {
    // Task is only admitted when separately bound as the supported Agent alias.
    const entryId = host === 'codex' ? name === 'Agent' ? 'codex_agent_alias' : 'codex_spawn_agent' : 'claude_parent_agent';
    const binding = options.observe_host_state ? null : pinnedBindingObserver(options.binding_path, options.binding_sha256);
    const envelope = binding ? binding() : null;
    if (envelope && (envelope.schema !== 'toolkit.v3.native-helper-binding.v1' || !envelope.session_id || !envelope.cwd
      || !envelope.helper_identity || !envelope.caller_model)) fail('NATIVE_BINDING_INVALID');
    const observer = options.observe_host_state || (() => {
      const current = binding();
      return host === 'claude-code' ? resolveClaudeNativeState(current, input.tool_input || {}, process.env) : current.host_state;
    });
    const selected = envelope || options;
    const adapter = createNativeHelperAdapter({ entry_id: entryId, observe_host_state: observer,
      source_capture: selected.source_capture, selection: selected.selection,
      helper_identity: envelope ? envelope.helper_identity : options.helper_identity,
      ...(envelope ? { session_id: envelope.session_id, cwd: envelope.cwd,
        ...(host === 'codex' ? { caller_model: envelope.caller_model } : {}) } : {}),
      dispatch_native: () => ({ permission_check: 'VERIFIED', inference_dispatched: false }) });
    if (name === 'Task' && options.task_alias_qualified !== true) fail('NATIVE_ALIAS_UNQUALIFIED');
    return hookOutput(await adapter.invoke({ ...input, tool_name: host === 'claude-code' ? 'Agent' : name }));
  } catch (error) { return hookOutput({ decision: 'DENY', code: error.code || 'NATIVE_BINDING_INVALID' }); }
}
module.exports = Object.freeze({ renderNativeHelperDefinition, claudeNativeModel, readNativeSelectionFromEnvironment, createNativeHelperAdapter, pinnedBindingObserver, commandDecision, hookOutput, overrides, resolveClaudeNativeState, verifyCodexHelperRegistration });
