'use strict';

// Codex named-helper policy for Toolkit-governed work. Only the two Toolkit helpers may be
// launched, with no call-time route or fork fields, and every copy of the helper's custom
// agent file Codex could load must byte-match the one rendered from the selected stack.
// Everything else is refused with a plain reason. An allowed launch returns no hook
// decision, so Codex's own permissions still apply.
//
// Sources (searched, then read 2026-10-23):
// - Codex subagents page (https://learn.chatgpt.com/docs/agent-configuration/subagents.md):
//   personal agents live in ~/.codex/agents/ and project agents in .codex/agents/; "If a custom
//   agent file sets model or model_reasoning_effort, the value in the file takes precedence";
//   explicit spawn values override the [agents] defaults. The page does not say which of a
//   personal and a same-name project agent wins, so every copy present must match.
// - Codex hooks page (https://learn.chatgpt.com/docs/hooks.md): PreToolUse input has no
//   caller-agent field and "Subagent hooks use the parent session id", so a helper launching a
//   helper cannot be told apart from the lead here. Leaf depth on Codex stays instruction-level.
// The spawn field that names the custom agent (`agent_type`, in V1 `multi_agent` and V2
// `multi_agent_v2`) is not on either official page; a request without it is refused, so an
// unexpected field name fails closed. The native capture run on the owner's Codex confirms it.
// The [agents] default model and effort are not checked: the helper file sets both, and the file
// value takes precedence. The native route run checks that the child gets the pinned route.

const fs = require('node:fs');
const path = require('node:path');
const { ROLES } = require('./toolkit-claude-helper-spec.cjs');
const { samePath } = require('./toolkit-canonical-path.cjs');

// Loaded only when a helper launch is decided, so shell decisions stay light.
const helperAgents = () => require('./toolkit-codex-helper-agents.cjs');
const codexDialect = () => require('./toolkit-v3-native-helper-adapter.cjs').HostDialect.for('codex');
const HELPER_ROLES = Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([role, spec]) => [spec.name, role])));
const ROUTE_FIELDS = Object.freeze(['model', 'reasoning_effort', 'effort', 'provider', 'model_provider']);
const TRANSITION_FIELDS = Object.freeze(['resume', 'fork', 'session_id', 'sessionID']);

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Toolkit: ${reason}` } };
}

class CodexNamedHelperPolicy {
  #environment; #toolkitRoot; #matches;
  constructor({ environment = process.env, toolkitRoot = path.resolve(__dirname, '..', '..'), matchesRenderedDefinition } = {}) {
    this.#environment = environment || {};
    this.#toolkitRoot = toolkitRoot;
    this.#matches = matchesRenderedDefinition || ((...args) => helperAgents().matchesRenderedDefinition(...args));
  }

  // Project agent directories from the working directory up to the git root, closest first; a
  // working directory outside that root contributes only itself.
  #projectDirectories(input, governance) {
    const dirs = [];
    let current = typeof input.cwd === 'string' && input.cwd ? path.resolve(input.cwd) : null;
    const root = governance.root ? path.resolve(governance.root) : null;
    const inside = current && root && (current === root || current.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
    while (current) {
      dirs.push(path.join(current, '.codex', 'agents'));
      if (!inside || current === root) break;
      current = path.dirname(current);
    }
    if (root) dirs.push(path.join(root, '.codex', 'agents'));
    return [...new Set(dirs)];
  }

  // Every file Codex could load for this helper name: project copies, then the personal one.
  #definitions(name, input, governance) {
    const found = [];
    for (const dir of [...this.#projectDirectories(input, governance), helperAgents().codexUserAgentsDirectory(this.#environment)]) {
      const file = path.join(dir, `${name}.toml`);
      try { if (fs.statSync(file).isFile()) found.push({ file, text: fs.readFileSync(file, 'utf8') }); }
      catch { /* not present in this directory */ }
    }
    return found;
  }

  #generatorCommand() {
    return `node "${path.resolve(this.#toolkitRoot).replace(/\\/g, '/')}/repo/scripts/toolkit-codex-helper-agents.cjs" --stack <stack> --write`;
  }

  decide(input, governance) {
    // Codex sends no caller-agent identity today; if a future version does, a helper is refused.
    if (input.agent_id) return deny('a helper cannot launch another agent. Only the G0 or G1 lead launches helpers.');
    if (governance.gate_role === 'G2') return deny('G2 review sessions launch no helpers; do the review in this session.');
    const args = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input) ? input.tool_input : {};
    if (args.subagent_type !== undefined && args.agent_type !== undefined && args.subagent_type !== args.agent_type) {
      return deny('this helper launch names two different agents; name one Toolkit helper.');
    }
    const requested = args.agent_type ?? args.subagent_type;
    // Own keys only: inherited names such as `constructor` or `__proto__` are not helpers.
    const role = typeof requested === 'string' && Object.hasOwn(HELPER_ROLES, requested) ? HELPER_ROLES[requested] : undefined;
    if (!role) {
      const named = typeof requested === 'string' && requested ? requested : 'the default agent';
      return deny(`this Toolkit-governed repository allows only the toolkit-g0-helper and toolkit-g1-helper agents (requested: ${named}). Do the work in this session, or use one of those helpers.`);
    }
    const route = ROUTE_FIELDS.filter(field => Object.hasOwn(args, field));
    if (route.length) return deny(`helper launches cannot override ${route.join(', ')}; the helper file sets the model and effort.`);
    const transition = TRANSITION_FIELDS.filter(field => Object.hasOwn(args, field));
    // V1 forks with fork_context true; V2 forks the parent's history unless fork_turns is "none".
    if (transition.length || codexDialect().forksSession(String(input.tool_name || ''), args)) {
      return deny('helper launches cannot resume or fork a session; launch a fresh helper (in V2, set fork_turns to "none").');
    }
    const definitions = this.#definitions(requested, input, governance);
    if (!definitions.length) return deny(`no ${requested} agent file is installed. Install the Toolkit helpers with ${this.#generatorCommand()}.`);
    const stale = definitions.find(({ text }) => !this.#matches(role, text, this.#toolkitRoot).matches);
    if (!stale) return {};
    if (samePath(path.dirname(stale.file), helperAgents().codexUserAgentsDirectory(this.#environment))) {
      return deny(`the installed ${requested} agent file (${stale.file}) does not match the one rendered from the selected stack. Run \`setup toolkit\` to refresh it.`);
    }
    return deny(`the project copy ${stale.file} does not match the one rendered from the selected stack. Toolkit does not change project files; update or remove it.`);
  }
}

module.exports = Object.freeze({ CodexNamedHelperPolicy, HELPER_ROLES });
