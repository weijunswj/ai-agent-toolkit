'use strict';

// Codex lane of the native helper adapter: hook-name vocabulary, the Codex hook matcher,
// the Codex dialect and the `hooks/list` registration check. The shared core
// (toolkit-v3-native-helper-adapter.cjs) composes it and keeps the public exports.
const compiler = require('./toolkit-gate-contract-compiler.cjs');

function fail(code) { throw Object.assign(new Error(code), { code }); }

// Codex serialises a hook tool name as `spawn_agent` only for the default and
// `multi_agent_v1` namespaces. A namespaced V2 (`multi_agent_v2`) spawn (default namespace
// `collaboration`, configurable) reaches hooks under its flattened name, the
// namespace concatenated with `spawn_agent` (`collaborationspawn_agent`), with no
// `Agent` matcher alias. Codex accepts `features.multi_agent_v2.tool_namespace` only
// as [A-Za-z0-9_-]+, so the registered matcher and this recogniser share that one
// alphabet, hyphen included. Both hooks.json copies carry CODEX_HELPER_HOOK_MATCHER: the spawn
// names plus Bash, which the same hook checks for AI attribution lines.
const CODEX_TOOL_NAMESPACE = /^[A-Za-z0-9_-]+$/;
const CODEX_SPAWN_MATCHER = '^(?:Agent|[A-Za-z0-9_-]*spawn_agent)$';
const CODEX_HELPER_HOOK_MATCHER = '^(?:Agent|[A-Za-z0-9_-]*spawn_agent|Bash)$';
const CODEX_SPAWN_TOOL = new RegExp(CODEX_SPAWN_MATCHER);
// Registration probes: default/V1 name, its alias, the default V2 namespace and a hyphenated one.
const CODEX_REGISTRATION_PROBES = Object.freeze(['spawn_agent', 'Agent', 'collaborationspawn_agent', 'multi-agentspawn_agent']);

// Codex hook matcher semantics (codex-rs hooks/src/engine/matcher.rs): empty or `*`
// matches everything; a pattern of only [A-Za-z0-9_|] is an exact pipe list; any
// other pattern is an unanchored regex search.
class CodexHookMatcher {
  #kind; #pattern; #regex;
  constructor(pattern) {
    this.#pattern = typeof pattern === 'string' ? pattern : '';
    if (!this.#pattern || this.#pattern === '*') this.#kind = 'ALL';
    else if (/^[A-Za-z0-9_|]+$/.test(this.#pattern)) this.#kind = 'EXACT';
    else { this.#kind = 'REGEX'; this.#regex = new RegExp(this.#pattern, 'u'); }
    Object.freeze(this);
  }
  matches(input) {
    if (this.#kind === 'ALL') return true;
    if (typeof input !== 'string') return false;
    return this.#kind === 'EXACT' ? this.#pattern.split('|').includes(input) : this.#regex.test(input);
  }
}

// The dialect extends the core's HostDialect, which the core passes in, so this file never
// requires the core back.
function defineCodexDialect({ HostDialect, HELPER_PROMPT }) {
  return class CodexDialect extends HostDialect {
    constructor() {
      super({ host: 'codex', provider: 'openai',
        overrideFields: [['provider', 'provider'], ['model_provider', 'provider'], ['model', 'model'], ['reasoning_effort', 'reasoning'], ['effort', 'reasoning']] });
    }
    nativeDefinition(name, route) {
      return { agent_type: name, agent_config: { model: route.model, model_provider: route.provider,
        model_reasoning_effort: route.reasoning, developer_instructions: HELPER_PROMPT } };
    }
    static isSpawnRequest(toolName) { return typeof toolName === 'string' && CODEX_SPAWN_TOOL.test(toolName); }
    handles(toolName) { return CodexDialect.isSpawnRequest(toolName); }
    entryFor(toolName) { return toolName === 'Agent' ? 'codex_agent_alias' : 'codex_spawn_agent'; }
    // The guard entry name for a native hook name: namespaced spawns map to spawn_agent.
    canonicalName(toolName) { return toolName === 'Agent' ? 'Agent' : 'spawn_agent'; }
    // A fresh child only. V1 (`multi_agent`) forks with fork_context:true; V2 (`multi_agent_v2`) forks the
    // full history unless fork_turns is exactly "none" (omitted, "all" or a count fork).
    forksSession(toolName, args) {
      if (args.fork_context === true) return true;
      const v2 = (toolName !== 'spawn_agent' && toolName !== 'Agent') || Object.hasOwn(args, 'task_name') || Object.hasOwn(args, 'fork_turns');
      return v2 && (typeof args.fork_turns !== 'string' || args.fork_turns.trim().toLowerCase() !== 'none');
    }
    // Codex hook input names the caller model, so the pinned binding also fixes it.
    callerBinding(envelope) { return { caller_model: envelope.caller_model }; }
  };
}

// Checks a Codex `hooks/list` response. This is an acceptance check run on that output (manually or by a
// qualification harness); no production launcher calls it. `tool_namespace` is the configured
// features.multi_agent_v2.tool_namespace, when one is set.
function verifyCodexHelperRegistration(response, { cwd, command, tool_namespace }) {
  if (tool_namespace !== undefined && (typeof tool_namespace !== 'string' || !CODEX_TOOL_NAMESPACE.test(tool_namespace))) fail('CODEX_TOOL_NAMESPACE_INVALID');
  const data = compiler.trustedJsonCopy(response);
  const entry = data?.data?.find(item => item.cwd === cwd);
  if (!entry || entry.errors?.length || entry.warnings?.length) fail('CODEX_HOOK_REGISTRATION_UNVERIFIED');
  const hooks = entry.hooks.filter(hook => hook.eventName === 'preToolUse' && hook.command === command);
  // Evaluate the registered matcher the way Codex does, for the V1 name, its alias, the default and a
  // hyphenated V2 (`multi_agent_v2`) name, and the configured namespace; an exact `spawn_agent|Agent` list misses V2.
  const probes = tool_namespace === undefined ? CODEX_REGISTRATION_PROBES : [...CODEX_REGISTRATION_PROBES, `${tool_namespace}spawn_agent`];
  for (const name of probes) {
    const matching = hooks.find(hook => {
      try { return new CodexHookMatcher(hook.matcher).matches(name); } catch { return false; }
    });
    if (!matching || matching.enabled !== true || !['trusted', 'managed'].includes(matching.trustStatus)) fail('CODEX_REQUIRED_HOOK_NOT_TRUSTED');
  }
  return Object.freeze({ state: 'REGISTRATION_VERIFIED', qualification: 'UNQUALIFIED_UNTIL_NATIVE_MATRIX', cwd });
}

module.exports = Object.freeze({ CODEX_SPAWN_MATCHER, CODEX_HELPER_HOOK_MATCHER, CodexHookMatcher, defineCodexDialect, verifyCodexHelperRegistration });
