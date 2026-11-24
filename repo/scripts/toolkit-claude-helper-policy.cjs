'use strict';

// Claude Code helper policy for Toolkit gate runs. Only the main session (the G0 or G1 lead) may
// launch a helper, and every helper runs on a helper route of the selected stack: a Toolkit
// helper (toolkit-g0-helper, toolkit-g1-helper) whose definition byte-matches the one rendered
// from the stack, or any other agent whose call or definition sets that route's model and effort
// (owner decision on #1466; the stack is the one the session's brief names).
// Everything else is refused with a plain reason. An allowed launch returns no hook
// decision, so Claude Code's own permissions still apply.
//
// Definition lookup follows Claude Code's file precedence for agents it reads from
// disk: the managed settings directory's `.claude/agents`, then every project
// `.claude/agents` from the working directory up to the git root (closest first), then
// the user agents directory. Session `--agents` definitions and `--add-dir` folders are
// not visible to a hook; launchers that pass them use the pinned task-session path
// instead, and the native qualification run proves the served route from run records.

const fs = require('node:fs');
const path = require('node:path');
const { ROLES } = require('./toolkit-claude-helper-spec.cjs');
const { samePath } = require('./toolkit-canonical-path.cjs');

// Loaded only when a helper launch is decided, so other hook decisions stay light.
const helperAgents = () => require('./toolkit-claude-helper-agents.cjs');
const agentRoute = () => require('./toolkit-claude-agent-route.cjs');
const gateRoute = () => require('./toolkit-gate-route.cjs');
const HELPER_ROUTES = Object.freeze(['DISCOVERY_HELPER', 'BUILDER_HELPER']);
const HELPER_ROLES = Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([role, spec]) => [spec.name, role])));
const ROUTE_FIELDS = Object.freeze(['model', 'effort', 'reasoning_effort', 'provider', 'model_provider']);
const TRANSITION_FIELDS = Object.freeze(['resume', 'fork', 'fork_context', 'fork_turns', 'session_id', 'sessionID']);

// Values that leave a Claude Code on/off variable off.
const OFF_VALUES = new Set(['0', 'false', 'no', 'off']);

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Toolkit: ${reason}` } };
}

// The managed settings directory per platform (Claude Code managed settings docs).
function managedSettingsDirectory(platform = process.platform) {
  return platform === 'win32' ? 'C:\\Program Files\\ClaudeCode'
    : platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';
}

// Managed agents live in the managed directory's `.claude/agents` and outrank every other file location.
function managedAgentsDirectory(platform = process.platform) {
  return (platform === 'win32' ? path.win32 : path.posix).join(managedSettingsDirectory(platform), '.claude', 'agents');
}

class ClaudeNamedHelperPolicy {
  #environment; #toolkitRoot; #matches; #managedDirectory;
  constructor({ environment = process.env, toolkitRoot = path.resolve(__dirname, '..', '..'), matchesRenderedDefinition,
    managedAgentsDirectory: managed = managedAgentsDirectory() } = {}) {
    this.#environment = environment || {};
    this.#toolkitRoot = toolkitRoot;
    this.#matches = matchesRenderedDefinition || ((...args) => helperAgents().matchesRenderedDefinition(...args));
    this.#managedDirectory = managed;
  }

  // Project directories run from the working directory up to the git root; a working directory
  // outside that root contributes only itself.
  #projectDirectories(input, governance) {
    const dirs = [];
    let current = typeof input.cwd === 'string' && input.cwd ? path.resolve(input.cwd) : null;
    const root = governance.root ? path.resolve(governance.root) : null;
    const inside = current && root && (current === root || current.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
    while (current) {
      dirs.push(path.join(current, '.claude', 'agents'));
      if (!inside || current === root) break;
      current = path.dirname(current);
    }
    if (root) dirs.push(path.join(root, '.claude', 'agents'));
    return dirs;
  }

  #agentDirectories(input, governance) {
    const dirs = [];
    if (this.#managedDirectory) dirs.push(this.#managedDirectory);
    dirs.push(...this.#projectDirectories(input, governance));
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

  // A gate lead may start any agent for separable work, but only on one of the selected stack's
  // helper routes (DISCOVERY_HELPER or BUILDER_HELPER), with the route set on the call or pinned in
  // the agent's file. The stack is the one the session's brief names; without one only the Toolkit
  // helpers, whose files name their stack, can be checked.
  #stackRouteDecision(args, input) {
    const requested = typeof args.subagent_type === 'string' && args.subagent_type ? args.subagent_type : null;
    const route = agentRoute();
    const shown = requested === null ? 'default agent' : route.shownType(requested);
    if (requested === 'fork') return deny('a fork runs on this session\'s own route, not a helper route. Start a fresh agent on a helper route instead.');
    const transition = TRANSITION_FIELDS.filter(field => Object.hasOwn(args, field));
    if (transition.length) return deny(`helper launches cannot resume or fork a session (${transition.join(', ')}); launch a fresh helper.`);
    const modelOverride = this.#modelOverride();
    if (modelOverride) return deny(modelOverride);
    const gate = gateRoute().evaluate({ input, environment: this.#environment });
    const stack = gate.pin && gate.pin.profile;
    const registry = stack ? gateRoute().loadRegistry() : null;
    const routes = stack ? HELPER_ROUTES.map(member => registry.profiles[stack]?.routes?.[member]).filter(Boolean) : [];
    if (!routes.length) return deny(`this gate run's stack is not known (its brief has no readable Route line), so the ${shown} launch cannot be checked against a helper route. Use toolkit-g0-helper or toolkit-g1-helper.`);
    const target = route.targetRoute(input, { environment: this.#environment, managedAgentsDirectory: this.#managedDirectory });
    // CLAUDE_CODE_EFFORT_LEVEL may outrank the call's effort (the docs do not say), so it must be
    // unset or equal to the route's effort, as for the Toolkit helpers.
    const level = String(this.#environment.CLAUDE_CODE_EFFORT_LEVEL ?? '').trim();
    if (routes.some(pin => target.model === gateRoute().registryModel(pin.model) && target.effort === pin.reasoning && (!level || level === pin.reasoning))) return {};
    const listed = [...new Set(routes.map(pin => `${pin.model}/${pin.reasoning}`))].join(' or ');
    const would = target.model ? route.routeText(target) : target.source === 'inherits' ? 'this session\'s own route, since it sets no model' : 'a route this hook cannot tell';
    return deny(`in a Toolkit gate run every helper runs on a helper route of the ${stack} stack (${listed}); this ${shown} would run on ${would}. Set model and effort on the call to that route, or use toolkit-g0-helper or toolkit-g1-helper.`);
  }

  decide(input, governance) {
    // `agent_id` marks a subagent or teammate caller. `agent_type` alone also comes from a
    // main session started with --agent, which is the lead, not a helper.
    if (input.agent_id) return deny('a helper cannot launch another agent. Only the main session launches helpers.');
    if (governance.gate_role === 'G2') return deny('G2 review sessions launch no helpers; do the review in this session.');
    const args = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input) ? input.tool_input : {};
    const requested = args.subagent_type;
    // Own keys only: inherited names such as `constructor` or `__proto__` are not helpers.
    const role = typeof requested === 'string' && Object.hasOwn(HELPER_ROLES, requested) ? HELPER_ROLES[requested] : undefined;
    if (!role) return this.#stackRouteDecision(args, input);
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
    if (this.#managedDirectory && samePath(path.dirname(loaded.file), this.#managedDirectory)) {
      return deny(`the managed copy ${loaded.file} does not match the one rendered from the selected stack. Toolkit does not change managed files; ask whoever manages this computer's Claude Code settings to update or remove it.`);
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

module.exports = Object.freeze({ ClaudeNamedHelperPolicy, HELPER_ROLES, OFF_VALUES, changedSinceSessionStart, managedAgentsDirectory, managedSettingsDirectory });
