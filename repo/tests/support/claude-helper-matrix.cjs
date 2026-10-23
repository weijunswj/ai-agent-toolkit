'use strict';

// The Claude Code launch matrix (rows A1-A26): one table for the in-process test
// (repo/tests/toolkit-claude-helper-matrix.test.cjs) and the native qualification run
// (repo/tests/qualification/claude-helper-matrix.live.cjs). Row IDs are stable so a review can
// tick them. Each row says how it is proved:
//   hook          the real hook command, run as a process with recorded stdin, in a scratch context
//   config        the shipped plugin hook registration
//   other-test    proved by the named test file
//   live          only a real Claude Code run can prove it (served model and effort from run records)
//   waits         depends on work that has not merged yet; `on` names it
//   other-host    a Codex row; the Codex lane owns it
// A hook row's expected result is `deny` (a deny decision) or `pass` (no decision, so Claude Code's own
// permissions apply, which is how an allowed Toolkit helper launch looks).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'repo', 'scripts');
const AGENT_HOOK = path.join(SCRIPTS, 'toolkit-claude-agent-hook.cjs');
const GOVERNANCE_HOOK = path.join(SCRIPTS, 'toolkit-governance-hook.cjs');
const MODULE_BLOCKER = path.join(__dirname, '..', 'toolkit-test-module-blocker-preload.cjs');
const { makeGoverned } = require('../toolkit-governed-fixture-support.cjs');
// Variables that change a helper's route or mark a launcher session; a scratch context starts without them.
const CLEARED = Object.freeze(['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE', 'CLAUDE_CODE_EFFORT_LEVEL',
  'TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_NATIVE_HELPER_BINDING_SHA256', 'TOOLKIT_NATIVE_HELPER_IDENTITY',
  'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', 'TOOLKIT_HOOK_DECISION_LOG', 'AI_AGENT_TOOLKIT_CONTROL_ROOT', 'CLAUDE_CONFIG_DIR']);

// A scratch governed repository (ENABLED by its governance state), an ungoverned folder, a declined
// and an undecided repository, a Claude config folder holding the helpers rendered from the selected
// stack, a private user home for governance decisions and an empty Toolkit control root. Nothing
// outside `base`.
class ClaudeMatrixContext {
  constructor({ stack = 'owner-claude', baseDir = os.tmpdir(), environment = process.env } = {}) {
    const { ClaudeHelperAgentRenderer } = require(path.join(SCRIPTS, 'toolkit-claude-helper-agents.cjs'));
    this.base = fs.realpathSync.native(fs.mkdtempSync(path.join(baseDir, 'toolkit-claude-matrix-')));
    this.repo = path.join(this.base, 'governed');
    this.plain = path.join(this.base, 'plain');
    this.configDir = path.join(this.base, 'claude-config');
    this.controlRoot = path.join(this.base, 'control');
    this.declined = path.join(this.base, 'declined');
    this.undecided = path.join(this.base, 'undecided');
    this.home = path.join(this.base, 'home');
    for (const dir of [this.repo, this.plain]) fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    makeGoverned(this.repo, 'matrix');
    makeGoverned(this.declined, 'matrix-declined');
    makeGoverned(this.undecided, 'matrix-undecided');
    fs.rmSync(path.join(this.undecided, '.github'), { recursive: true });
    fs.writeFileSync(path.join(this.plain, 'AGENTS.md'), '# Project rules\n');
    this.#decline(this.declined);
    fs.mkdirSync(this.controlRoot);
    this.agentsDir = path.join(this.configDir, 'agents');
    fs.mkdirSync(this.agentsDir, { recursive: true });
    const renderer = ClaudeHelperAgentRenderer.fromRepository(stack, ROOT);
    this.definitions = Object.fromEntries(['G0', 'G1'].map(role => [role, renderer.render(role)]));
    this.environment = { ...environment };
    for (const name of CLEARED) delete this.environment[name];
    Object.assign(this.environment, { CLAUDE_CONFIG_DIR: this.configDir, AI_AGENT_TOOLKIT_CONTROL_ROOT: this.controlRoot, HOME: this.home, USERPROFILE: this.home });
    delete this.environment.CLAUDE_CODE_REMOTE;
    this.reset();
  }

  // Records the user's decline in this context's private registry, as the governance gate would.
  #decline(repo) {
    const registry = require(path.join(SCRIPTS, 'toolkit-capability-registry.cjs'));
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['-C', repo, 'init', '--quiet'], { stdio: 'ignore' });
    const options = { registryPath: path.join(this.home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
    const status = registry.getRepositoryStatus({ cwd: repo, ...options });
    const capability = 'repository.governance';
    registry.writeCapabilityDecision({ cwd: repo, ...options, capabilityId: capability, operation: 'decline',
      ownerAction: { confirmed: true, category: 'explicit-owner', channel: 'capability-route', operation: 'decline',
        choice_semantic_id: registry.capabilityDecisionSemanticId(capability, 'decline'), contract_digest: registry.CONTRACT_DIGEST,
        scope_digest: registry.capabilityScopeDigest(status.repository_id, capability, 'decline', 'capability-route') },
      expectedRevision: status.registry_revision, expectedHash: status.snapshot_hash });
  }

  // Puts the rendered helpers back and removes anything a row added.
  reset() {
    for (const { file, text } of Object.values(this.definitions)) fs.writeFileSync(path.join(this.agentsDir, file), text);
    fs.rmSync(path.join(this.repo, '.claude'), { recursive: true, force: true });
    fs.rmSync(path.join(this.repo, 'packages'), { recursive: true, force: true });
    fs.rmSync(path.join(this.controlRoot, 'profiles'), { recursive: true, force: true });
  }

  definitionFile(name) { return path.join(this.agentsDir, `${name}.md`); }

  remove() { fs.rmSync(this.base, { recursive: true, force: true }); }
}

// Runs the hook command as Claude Code does: a fresh process, the event JSON on stdin.
// `blocked` names decision modules the test preload makes unloadable; `args` follow the hook file.
function runHook(context, event, { environment = {}, hook = AGENT_HOOK, args = [], blocked = null } = {}) {
  const input = { hook_event_name: 'PreToolUse', session_id: 'matrix-session', tool_name: 'Agent', cwd: context.repo, ...event };
  const started = process.hrtime.bigint();
  const argv = blocked ? ['--require', MODULE_BLOCKER, hook, ...args] : [hook, ...args];
  const env = { ...context.environment, ...environment, ...(blocked ? { TOOLKIT_TEST_BLOCKED_MODULES: blocked } : {}) };
  const result = spawnSync(process.execPath, argv, { input: JSON.stringify(input), env, encoding: 'utf8', timeout: 20000 });
  const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
  let output = null;
  try { output = JSON.parse((result.stdout || '').trim() || '{}'); } catch { /* recorded as unreadable below */ }
  const decision = output?.hookSpecificOutput?.permissionDecision;
  return { exit: result.status, elapsed_ms, result: output === null ? 'unreadable' : decision === 'deny' ? 'deny' : decision ? decision : 'pass',
    reason: output?.hookSpecificOutput?.permissionDecisionReason || null, stderr: (result.stderr || '').slice(-400) };
}

const launch = (name, extra = {}) => ({ tool_input: { subagent_type: name, description: 'matrix', prompt: 'Reply OK', ...extra } });
const G0 = 'toolkit-g0-helper', G1 = 'toolkit-g1-helper';
const NOT_ALLOWED = /allows only the toolkit-g0-helper and toolkit-g1-helper agents/;
const MISMATCH = /does not match the one rendered from the selected stack/;
const editDefinition = (name, from, to) => c => { const file = c.definitionFile(name); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to)); };
const projectCopy = (folder, name, change) => c => {
  const dir = path.join(c.repo, ...folder, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), change(fs.readFileSync(c.definitionFile(name), 'utf8')));
};
const configureTopology = topology => c => require(path.join(SCRIPTS, 'toolkit-agent-control.cjs'))
  .configureProfile('claude-code', { topology, capacity_mode: 'root-only' }, { root: c.controlRoot });

// One entry per hook case: [row, case, event, expected, reason pattern, options]. Options: `environment`,
// `setup(context)`, `cwd(context)`, `brokenHook` (the decision module fails to load), `gate` (the
// governance hook's PreToolUse event runs instead of the agent hook), `needsBirthtime`.
const HOOK_CASES = [
  ['A1', 'G0 lead launches toolkit-g0-helper, definition current', launch(G0), 'pass'],
  ['A2', 'G1 lead launches toolkit-g1-helper, definition current', launch(G1), 'pass'],
  ['A2', 'broader-native profile without a launcher binding: the Toolkit helper is allowed', launch(G1), 'pass', null, { setup: configureTopology('broader-native') }],
  ['A3', 'definition edited to another model', launch(G1), 'deny', MISMATCH, { setup: editDefinition(G1, /^model: .*$/m, 'model: claude-opus-5-5') }],
  ['A4', 'definition edited to another effort', launch(G0), 'deny', MISMATCH, { setup: editDefinition(G0, /^effort: .*$/m, 'effort: low') }],
  ['A5', 'CLAUDE_CODE_SUBAGENT_MODEL set', launch(G0), 'deny', /CLAUDE_CODE_SUBAGENT_MODEL is set/, { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-5-5' } }],
  ['A5', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1', launch(G0), 'deny', /CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set/, { environment: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } }],
  ['A5', 'CLAUDE_CODE_EFFORT_LEVEL differs from the helper effort', launch(G0), 'deny', /CLAUDE_CODE_EFFORT_LEVEL is set to low/, { environment: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } }],
  ['A5', 'CLAUDE_CODE_EFFORT_LEVEL equals the helper effort', launch(G0), 'pass', null, { environment: { CLAUDE_CODE_EFFORT_LEVEL: 'xhigh' } }],
  ['A6', 'call omits model and effort; the definition supplies them', launch(G1), 'pass'],
  ['A7', 'call carries a model', launch(G1, { model: 'opus' }), 'deny', /cannot override model/],
  ['A7', 'call carries an effort', launch(G1, { effort: 'low' }), 'deny', /cannot override effort/],
  ['A7', 'call carries a provider', launch(G1, { provider: 'bedrock' }), 'deny', /cannot override provider/],
  ['A8', 'decision module throws in governed work', launch(G1), 'deny', /could not check this helper launch safely/, { brokenHook: true }],
  ['A11', 'helper definition is not a valid agent file', launch(G0), 'deny', MISMATCH, { setup: c => fs.writeFileSync(c.definitionFile(G0), 'not front matter\n') }],
  ['A12', 'definition rewritten after the session started', launch(G0), 'deny', /changed after this session started/, { needsBirthtime: true }],
  ['A13', 'resume an earlier helper', launch(G1, { resume: 'agent-1' }), 'deny', /cannot resume or fork/],
  ['A13', 'fork the conversation', launch(G1, { fork_context: true }), 'deny', /cannot resume or fork/],
  ['A14', 'Task alias with a current definition', { tool_name: 'Task', ...launch(G1) }, 'pass'],
  ['A14', 'project copy at the repository root differs', launch(G0), 'deny', /the project copy .* does not match/, { setup: projectCopy([], G0, t => t.replace('maxTurns: 50', 'maxTurns: 99')) }],
  ['A14', 'project copy between the working directory and the root differs', launch(G1), 'deny', /the project copy .*packages.* does not match/,
    { setup: c => { projectCopy(['packages'], G1, t => t.replace('maxTurns: 60', 'maxTurns: 99'))(c); fs.mkdirSync(path.join(c.repo, 'packages', 'app'), { recursive: true }); },
      cwd: c => path.join(c.repo, 'packages', 'app') }],
  ['A14', 'plugin-scoped agent with a Toolkit name', launch(`some-plugin:${G0}`), 'deny', NOT_ALLOWED],
  ['A15', 'a helper launches another agent', { agent_id: 'helper-1', agent_type: G1, ...launch(G0) }, 'deny', /a helper cannot launch another agent/],
  ['A15', 'a G2 session launches a helper', launch(G0), 'deny', /G2 review sessions launch no helpers/, { environment: { TOOLKIT_GATE_ROLE: 'G2' } }],
  ['A17', 'built-in Explore agent', launch('Explore'), 'deny', NOT_ALLOWED],
  ['A17', 'built-in general-purpose agent', launch('general-purpose'), 'deny', NOT_ALLOWED],
  ['A17', 'default agent (no subagent_type)', { tool_input: { prompt: 'Reply OK' } }, 'deny', /requested: the default agent/],
  ['A17', 'broader-native profile without a launcher binding: a built-in agent is refused', launch('general-purpose'), 'deny', NOT_ALLOWED,
    { setup: configureTopology('broader-native') }],
  ['A18', 'ungoverned folder, lead launches any agent', launch('general-purpose'), 'pass', null, { cwd: c => c.plain }],
  ['A18', 'ungoverned folder, a subagent launches another agent', { agent_id: 'sub-1', ...launch('general-purpose') }, 'deny', /one layer only/, { cwd: c => c.plain }],
  ['A18', 'ungoverned folder, broader native behaviour chosen', { agent_id: 'sub-1', ...launch('general-purpose') }, 'pass', null,
    { cwd: c => c.plain, setup: configureTopology('broader-native') }],
  ['A21', 'installed definition rendered from another registry revision', launch(G1), 'deny', MISMATCH,
    { setup: editDefinition(G1, /\(SHA-256 `[0-9a-f]{64}`\)/, `(SHA-256 \`${'0'.repeat(64)}\`)`) }],
  ['A22', 'ENABLED repository is governed: a built-in agent is refused', launch('general-purpose'), 'deny', NOT_ALLOWED],
  ['A22', 'DECLINED repository is ungoverned: the lead launches any agent', launch('general-purpose'), 'pass', null, { cwd: c => c.declined }],
  ['A22', 'UNKNOWN repository is the hard block: the governance gate refuses the launch', launch(G0), 'deny', /no governance decision yet/,
    { cwd: c => c.undecided, gate: true }],
  ['A22', 'ENABLED repository passes the governance gate', launch(G0), 'pass', null, { gate: true }],
];

// How every other row is proved. Hook rows above are listed by the test, not here.
const OTHER_ROWS = Object.freeze({
  A9: { proof: 'config', note: 'The Agent|Task hook is registered with onFailure "block", so Claude Code blocks the launch when the hook times out or fails (hooks docs).' },
  A10: { proof: 'waits', on: 'install check status work after the lane split', note: 'Install check and SessionStart say "not enforced" when the plugin is disabled or uninstalled.' },
  A16: { proof: 'live', note: 'No helper requested: no Agent call and no hook decision in the run record.' },
  A19: { proof: 'other-host', note: 'Codex managed-block repositories.' },
  A20: { proof: 'other-host', note: 'Codex Windows launcher exit codes.' },
  A23: { proof: 'other-test', file: 'repo/tests/toolkit-claude-attribution-hook.test.cjs', note: 'Attribution hook failure refuses only commit and PR commands.' },
  A24: { proof: 'live', note: 'Launch latency measured before and after; the hook rows also record per-process time.' },
  A25: { proof: 'waits', on: 'checkpoint writer (custody release)', note: 'Stop hook in a bound and an unbound session.' },
  A26: { proof: 'live', note: 'Headless claude -p in a governed repository launches one Toolkit helper; lead and helper served model and effort match the pin from run records.' },
});
// Rows whose hook case exists but whose full proof also needs a live run.
const LIVE_TOO = Object.freeze(['A1', 'A2', 'A6', 'A7', 'A14']);
const ROW_IDS = Object.freeze(Array.from({ length: 26 }, (_, i) => `A${i + 1}`));

// Runs one hook case in `context` and returns its verdict; the context is reset afterwards. `hook`
// is the hook command file to run, such as the copy an installed plugin uses.
function runHookCase(context, [row, name, event, expected, pattern, options = {}], { hook = AGENT_HOOK } = {}) {
  try {
    options.setup?.(context);
    const cwd = options.cwd ? options.cwd(context) : context.repo;
    let input = { ...event, cwd };
    if (options.needsBirthtime) {
      const transcript = path.join(context.base, 'session.jsonl');
      fs.writeFileSync(transcript, '{}\n');
      const started = fs.statSync(transcript).birthtimeMs;
      if (!started) return { row, case: name, expected, skipped: 'this file system reports no creation time', pass: null };
      const later = new Date(started + 60000);
      for (const { file } of Object.values(context.definitions)) fs.utimesSync(path.join(context.agentsDir, file), later, later);
      input = { ...input, transcript_path: transcript };
    }
    const observed = runHook(context, input, { environment: options.environment,
      hook: options.gate ? path.join(path.dirname(hook), path.basename(GOVERNANCE_HOOK)) : hook, args: options.gate ? ['--event', 'PreToolUse'] : [],
      blocked: options.brokenHook ? 'toolkit-agent-control.cjs' : null });
    const pass = observed.exit === 0 && observed.result === expected && (!pattern || pattern.test(observed.reason || ''));
    return { row, case: name, expected, observed, pass };
  } finally { context.reset(); }
}

module.exports = Object.freeze({ ClaudeMatrixContext, runHook, runHookCase, HOOK_CASES, OTHER_ROWS, LIVE_TOO, ROW_IDS, AGENT_HOOK, CLEARED });
