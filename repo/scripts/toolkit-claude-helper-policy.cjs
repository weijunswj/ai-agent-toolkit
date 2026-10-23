'use strict';

// Claude Code named-helper policy for Toolkit-governed work. Only a G0 or G1 lead may
// launch a helper, only the two Toolkit helpers may be launched, and the definition
// Claude Code would load must byte-match the one rendered from the selected stack.
// Everything else is refused with a plain reason. An allowed launch returns no hook
// decision, so Claude Code's own permissions still apply.
//
// Definition lookup follows Claude Code's file precedence for agents it reads from
// disk: the project `.claude/agents` (working directory, then git root) before the
// user agents directory. Session `--agents` definitions are not visible to a hook;
// launchers that pass them use the pinned task-session path instead.

const fs = require('node:fs');
const path = require('node:path');
const { ROLES } = require('./toolkit-claude-helper-spec.cjs');
const { samePath } = require('./toolkit-canonical-path.cjs');

// Loaded only when a helper launch is decided, so other hook decisions stay light.
const helperAgents = () => require('./toolkit-claude-helper-agents.cjs');
const HELPER_ROLES = Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([role, spec]) => [spec.name, role])));
const ROUTE_FIELDS = Object.freeze(['model', 'effort', 'reasoning_effort', 'provider', 'model_provider']);
const TRANSITION_FIELDS = Object.freeze(['resume', 'fork', 'fork_context', 'fork_turns', 'session_id', 'sessionID']);

// Values that leave a Claude Code on/off variable off.
const OFF_VALUES = new Set(['0', 'false', 'no', 'off']);

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Toolkit: ${reason}` } };
}

class ClaudeNamedHelperPolicy {
  #environment; #toolkitRoot; #matches;
  constructor({ environment = process.env, toolkitRoot = path.resolve(__dirname, '..', '..'), matchesRenderedDefinition } = {}) {
    this.#environment = environment || {};
    this.#toolkitRoot = toolkitRoot;
    this.#matches = matchesRenderedDefinition || ((...args) => helperAgents().matchesRenderedDefinition(...args));
  }

  #agentDirectories(input, governance) {
    const dirs = [];
    if (typeof input.cwd === 'string' && input.cwd) dirs.push(path.join(path.resolve(input.cwd), '.claude', 'agents'));
    if (governance.root) dirs.push(path.join(governance.root, '.claude', 'agents'));
    dirs.push(helperAgents().claudeUserAgentsDirectory(this.#environment));
    return [...new Set(dirs)];
  }

  // The command a person runs to install the helpers, with this checkout's absolute root.
  #generatorCommand() {
    return `node "${path.resolve(this.#toolkitRoot).replace(/\\/g, '/')}/repo/scripts/toolkit-claude-helper-agents.cjs" --stack <stack> --write`;
  }

  // Claude Code reads these variables from its own environment, which the hook inherits. The
  // forcing switch makes Claude Code ignore the definition's model; the model variable alone is
  // only a default since Claude Code 2.1.251, but older versions let it override the definition,
  // and the hook cannot see the version. Returns the refusal reason, or ''.
  #modelOverride() {
    const force = String(this.#environment.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? '').trim();
    if (force && !OFF_VALUES.has(force.toLowerCase())) {
      return 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set, so Claude Code ignores the helper model; unset it to use Toolkit helpers.';
    }
    if (this.#environment.CLAUDE_CODE_SUBAGENT_MODEL) {
      return 'CLAUDE_CODE_SUBAGENT_MODEL is set, and some Claude Code versions let it replace the helper model; unset it to use Toolkit helpers.';
    }
    return '';
  }

  // CLAUDE_CODE_EFFORT_LEVEL outranks a definition's `effort`, so any other value would run the
  // helper at the wrong effort. The same value as the definition changes nothing and is allowed.
  #effortOverride(definitionText) {
    const level = String(this.#environment.CLAUDE_CODE_EFFORT_LEVEL ?? '').trim();
    if (!level) return '';
    const pinned = definitionEffort(definitionText);
    if (pinned && level === pinned) return '';
    return `CLAUDE_CODE_EFFORT_LEVEL is set to ${level}, which replaces the helper's ${pinned || 'pinned'} effort; unset it to use Toolkit helpers.`;
  }

  // The definition file Claude Code would load for this helper name, or null.
  #loadedDefinition(name, input, governance) {
    for (const dir of this.#agentDirectories(input, governance)) {
      const file = path.join(dir, `${name}.md`);
      try { if (fs.statSync(file).isFile()) return { file, text: fs.readFileSync(file, 'utf8') }; }
      catch { /* not present in this directory */ }
    }
    return null;
  }

  decide(input, governance) {
    // `agent_id` marks a subagent or teammate caller. `agent_type` alone also comes from a
    // main session started with --agent, which is the lead, not a helper.
    if (input.agent_id) return deny('a helper cannot launch another agent. Only the G0 or G1 lead launches helpers.');
    if (governance.gate_role === 'G2') return deny('G2 review sessions launch no helpers; do the review in this session.');
    const args = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input) ? input.tool_input : {};
    const requested = args.subagent_type;
    // Own keys only: inherited names such as `constructor` or `__proto__` are not helpers.
    const role = typeof requested === 'string' && Object.hasOwn(HELPER_ROLES, requested) ? HELPER_ROLES[requested] : undefined;
    if (!role) {
      const named = typeof requested === 'string' && requested ? requested : 'the default agent';
      return deny(`this Toolkit-governed repository allows only the toolkit-g0-helper and toolkit-g1-helper agents (requested: ${named}). Do the work in this session, or use one of those helpers.`);
    }
    const route = ROUTE_FIELDS.filter(field => Object.hasOwn(args, field));
    if (route.length) return deny(`helper launches cannot override ${route.join(', ')}; the helper definition sets the model and effort.`);
    const transition = TRANSITION_FIELDS.filter(field => Object.hasOwn(args, field));
    if (transition.length) return deny(`helper launches cannot resume or fork a session (${transition.join(', ')}); launch a fresh helper.`);
    const modelOverride = this.#modelOverride();
    if (modelOverride) return deny(modelOverride);
    const loaded = this.#loadedDefinition(requested, input, governance);
    if (!loaded) return deny(`no ${requested} definition is installed. Install the Toolkit helpers with ${this.#generatorCommand()}.`);
    if (this.#matches(role, loaded.text, this.#toolkitRoot).matches) {
      const effortOverride = this.#effortOverride(loaded.text);
      if (effortOverride) return deny(effortOverride);
      // Claude Code reads agent files when a session starts, so a file rewritten since then runs
      // with the settings this session loaded, not the ones on disk.
      if (changedSinceSessionStart(loaded.file, input)) return deny('Helper settings changed after this session started. Start a new session to use them.');
      return {};
    }
    if (samePath(path.dirname(loaded.file), helperAgents().claudeUserAgentsDirectory(this.#environment))) {
      return deny(`the installed ${requested} definition (${loaded.file}) does not match the one rendered from the selected stack. Run \`setup toolkit\` to refresh it.`);
    }
    return deny(`the project copy ${loaded.file} does not match the one rendered from the selected stack. Toolkit does not change project files; update or remove it.`);
  }
}

// The `effort` line of a definition's front matter, or null.
function definitionEffort(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  return front ? /^effort:[ \t]*(\S+)[ \t]*$/m.exec(front[1])?.[1] || null : null;
}

// The session started when its transcript file was created; without a readable creation time
// (some file systems report none) the check makes no claim.
function changedSinceSessionStart(file, input) {
  const transcript = typeof input?.transcript_path === 'string' ? input.transcript_path : '';
  if (!transcript) return false;
  try {
    const started = fs.statSync(transcript).birthtimeMs;
    if (!started) return false;
    return fs.statSync(file).mtimeMs > started;
  } catch { return false; }
}

module.exports = Object.freeze({ ClaudeNamedHelperPolicy, HELPER_ROLES, changedSinceSessionStart });
