'use strict';

// Claude Code lane of the native helper adapter: the exact model maps, the Claude dialect and
// the Task alias check. The shared core (toolkit-v3-native-helper-adapter.cjs) composes it and
// keeps the public exports.
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const helperSpec = require('./toolkit-claude-helper-spec.cjs');

function fail(code) { throw Object.assign(new Error(code), { code }); }

// Exact native IDs only. Family aliases can resolve differently with environment,
// allowlist, parent family and mods; the observer must resolve those first.
const CLAUDE_NATIVE_MODELS = Object.freeze({ 'haiku-5.5': 'claude-haiku-5-5', 'opus-5.5': 'claude-opus-5-5' });
const CLAUDE_LOGICAL_MODELS = Object.freeze(Object.fromEntries(Object.entries(CLAUDE_NATIVE_MODELS).map(([k, v]) => [v, k])));

// The dialect extends the core's HostDialect, which the core passes in, so this file never
// requires the core back.
function defineClaudeDialect({ HostDialect }) {
  return class ClaudeDialect extends HostDialect {
    constructor() {
      super({ host: 'claude-code', provider: 'anthropic',
        overrideFields: [['provider', 'provider'], ['model_provider', 'provider'], ['model', 'model'], ['reasoning_effort', 'reasoning'], ['effort', 'reasoning']] });
    }
    supports(route) { return super.supports(route) && Boolean(CLAUDE_NATIVE_MODELS[route.model]); }
    logicalModel(value) { return CLAUDE_LOGICAL_MODELS[value] || value; }
    static nativeModel(route) {
      if (!route || route.provider !== 'anthropic' || !CLAUDE_NATIVE_MODELS[route.model]) fail('CLAUDE_NATIVE_ROUTE_UNSUPPORTED');
      return CLAUDE_NATIVE_MODELS[route.model];
    }
    // One helper name per role on every Claude definition source: the saved user agent
    // (toolkit-claude-helper-agents.cjs) and a launcher's session --agents definition both
    // load as `toolkit-<role>-helper`. Toolkit ships no plugin agent, so no plugin-scoped
    // identity exists. Which source was loaded is a launcher observation, not this name.
    // Tools, limits, description and instructions come from the same helper spec as the
    // saved user agent, so a session definition never inherits the parent's tools.
    nativeDefinition(name, route, callerRole) {
      const spec = helperSpec.roleSpec(callerRole);
      if (spec.name !== name) fail('NATIVE_HELPER_DEFINITION_SELECTION_INVALID');
      return { name, model: CLAUDE_NATIVE_MODELS[route.model], effort: route.reasoning,
        tools: [...spec.tools], disallowedTools: [...spec.disallowed], maxTurns: spec.maxTurns,
        description: spec.description, prompt: helperSpec.roleInstructions(spec) };
    }
    helperIdentity(_name, native) { return native.name; }
    handles(toolName) { return ['Agent', 'Task'].includes(toolName); }
    entryFor() { return 'claude_parent_agent'; }
    // The guard sees the supported Agent entry for both Agent and the bound Task alias.
    canonicalName() { return 'Agent'; }
    // Task is only admitted when separately bound as the supported Agent alias.
    checkAlias(toolName, options) {
      if (toolName === 'Task' && options.task_alias_qualified !== true) fail('NATIVE_ALIAS_UNQUALIFIED');
    }

    // Resolves the concrete model and effort Claude Code will actually use, following
    // its precedence. Aliases, provider remaps and substitution must be observed natively;
    // they cannot manufacture an exact approved route here.
    resolveObservedState(binding, invocation, environment) {
      const config = binding.native_config;
      if (!config || config.loaded_agent !== binding.helper_identity || config.mods_present !== false
        || config.provider !== 'anthropic' || !Array.isArray(config.available_models)) fail('CLAUDE_EFFECTIVE_CONFIG_UNVERIFIED');
      const forced = environment.CLAUDE_CODE_SUBAGENT_MODEL_FORCE === '1';
      let model = forced ? environment.CLAUDE_CODE_SUBAGENT_MODEL || config.parent_model
        : invocation.model || config.agent_model || environment.CLAUDE_CODE_SUBAGENT_MODEL || config.parent_model;
      if (model === 'inherit') model = config.parent_model;
      if (!config.available_models.includes(model)) fail('CLAUDE_MODEL_SUBSTITUTION_UNQUALIFIED');
      const logical = CLAUDE_LOGICAL_MODELS[model];
      if (!logical) fail('CLAUDE_MODEL_ALIAS_UNQUALIFIED');
      const effort = environment.CLAUDE_CODE_EFFORT_LEVEL || invocation.effort || config.agent_effort || config.session_effort;
      if (!effort) fail('CLAUDE_EFFECTIVE_EFFORT_UNVERIFIED');
      const state = compiler.trustedJsonCopy(binding.host_state);
      state.routing.effective_route = { provider: config.provider, model: logical, reasoning: effort };
      return state;
    }
  };
}

module.exports = Object.freeze({ defineClaudeDialect });
