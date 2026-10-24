'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CodexHelperAgentRenderer } = require('../scripts/toolkit-codex-helper-agents.cjs');
const { CodexNamedHelperPolicy } = require('../scripts/toolkit-codex-helper-policy.cjs');
const { makeGoverned } = require('./toolkit-governed-fixture-support.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs');
const MARKERS = ['TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_NATIVE_HELPER_BINDING_SHA256', 'TOOLKIT_NATIVE_HELPER_IDENTITY', 'TOOLKIT_GATE_ROLE', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256'];
const renderer = CodexHelperAgentRenderer.fromRepository('owner-gpt');

// A governed repository (ENABLED by repository opt-in: the governed rules block and a programme
// binding) and an isolated Codex home with the
// current helper agent files. Nothing here reads the real ~/.codex.
function fixture(t, { install = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-policy-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo'), home = path.join(base, 'codex'), agents = path.join(home, 'agents');
  makeGoverned(repo, 'codex-helper-policy');
  if (install) {
    fs.mkdirSync(agents, { recursive: true });
    for (const role of ['G0', 'G1']) { const { file, text } = renderer.render(role); fs.writeFileSync(path.join(agents, file), text); }
  }
  const plain = path.join(base, 'plain');
  // A plain folder (no git): GitHub governance is DISABLED there automatically and nothing is held.
  fs.mkdirSync(plain, { recursive: true });
  return { base, repo, home, agents, plain };
}

function hook(input, env) {
  const clean = { ...process.env, ...env };
  for (const key of MARKERS) if (!(key in env)) delete clean[key];
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', ...input }), env: clean, encoding: 'utf8', timeout: 20000 });
  return { status: r.status, output: JSON.parse(r.stdout.trim() || '{}'), stderr: r.stderr };
}
const v1 = (cwd, args) => ({ tool_name: 'spawn_agent', cwd, tool_input: { message: 'x', ...args } });
const v2 = (cwd, args) => ({ tool_name: 'collaborationspawn_agent', cwd, tool_input: { task_name: 'leaf', message: 'x', fork_turns: 'none', ...args } });

test('a lead in a governed repository may launch a Toolkit helper whose agent file matches the selected stack, in V1 and V2', t => {
  const f = fixture(t);
  for (const input of [v1(f.repo, { agent_type: 'toolkit-g0-helper' }), v1(f.repo, { agent_type: 'toolkit-g1-helper' }),
    { ...v1(f.repo, { agent_type: 'toolkit-g1-helper' }), tool_name: 'Agent' }, v2(f.repo, { agent_type: 'toolkit-g1-helper' }),
    v2(path.join(f.repo), { agent_type: 'toolkit-g0-helper', fork_turns: ' None ' })]) {
    const r = hook(input, { CODEX_HOME: f.home });
    assert.equal(r.status, 0, `${input.tool_name}: ${r.stderr}`);
    assert.deepEqual(r.output, {}, 'an allowed launch makes no decision, so Codex permissions still apply');
  }
});

test('built-in, unnamed and unknown agents are refused in governed work', t => {
  const f = fixture(t);
  for (const agent of [undefined, 'default', 'worker', 'explorer', 'toolkit-g2-helper', 'constructor', '__proto__', '']) {
    const r = hook(v2(f.repo, agent === undefined ? {} : { agent_type: agent }), { CODEX_HOME: f.home });
    assert.equal(r.status, 2, String(agent));
    assert.match(r.stderr, /allows only the toolkit-g0-helper and toolkit-g1-helper agents/, String(agent));
  }
  const conflict = hook(v1(f.repo, { agent_type: 'toolkit-g1-helper', subagent_type: 'worker' }), { CODEX_HOME: f.home });
  assert.equal(conflict.status, 2); assert.match(conflict.stderr, /names two different agents/);
});

test('call-time model, effort or provider fields are refused', t => {
  const f = fixture(t);
  for (const field of ['model', 'reasoning_effort', 'effort', 'provider', 'model_provider']) {
    const r = hook(v2(f.repo, { agent_type: 'toolkit-g1-helper', [field]: 'gpt-6-luna' }), { CODEX_HOME: f.home });
    assert.equal(r.status, 2, field);
    assert.match(r.stderr, new RegExp(`cannot override ${field}`), field);
  }
});

test('forks and resumes are refused: V1 fork_context, V2 without fork_turns "none", resume fields', t => {
  const f = fixture(t);
  const cases = [v1(f.repo, { agent_type: 'toolkit-g1-helper', fork_context: true }),
    { ...v2(f.repo, { agent_type: 'toolkit-g1-helper' }), tool_input: { task_name: 'leaf', message: 'x', agent_type: 'toolkit-g1-helper' } },
    v2(f.repo, { agent_type: 'toolkit-g1-helper', fork_turns: 'all' }), v2(f.repo, { agent_type: 'toolkit-g1-helper', fork_turns: '3' }),
    v1(f.repo, { agent_type: 'toolkit-g1-helper', fork_turns: 'all' }), v1(f.repo, { agent_type: 'toolkit-g1-helper', resume: 'id' })];
  for (const input of cases) {
    const r = hook(input, { CODEX_HOME: f.home });
    assert.equal(r.status, 2, JSON.stringify(input.tool_input));
    assert.match(r.stderr, /cannot resume or fork a session/);
  }
});

test('a missing or edited personal agent file is refused with the repair step', t => {
  const f = fixture(t, { install: false });
  const missing = hook(v1(f.repo, { agent_type: 'toolkit-g1-helper' }), { CODEX_HOME: f.home });
  assert.equal(missing.status, 2); assert.match(missing.stderr, /no toolkit-g1-helper agent file is installed.*toolkit-codex-helper-agents\.cjs" --stack <stack> --write/);
  const g = fixture(t);
  const file = path.join(g.agents, 'toolkit-g1-helper.toml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('model_reasoning_effort = "max"', 'model_reasoning_effort = "low"'));
  const edited = hook(v1(g.repo, { agent_type: 'toolkit-g1-helper' }), { CODEX_HOME: g.home });
  assert.equal(edited.status, 2); assert.match(edited.stderr, /installed toolkit-g1-helper agent file .* does not match .* Run `setup toolkit`/);
  // The other helper is still current and still allowed.
  assert.equal(hook(v1(g.repo, { agent_type: 'toolkit-g0-helper' }), { CODEX_HOME: g.home }).status, 0);
});

test('every project copy Codex could load must match too, from the working folder up to the repository root', t => {
  const f = fixture(t);
  const nested = path.join(f.repo, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  const project = path.join(f.repo, 'src', '.codex', 'agents');
  fs.mkdirSync(project, { recursive: true });
  fs.copyFileSync(path.join(f.agents, 'toolkit-g1-helper.toml'), path.join(project, 'toolkit-g1-helper.toml'));
  assert.equal(hook(v1(nested, { agent_type: 'toolkit-g1-helper' }), { CODEX_HOME: f.home }).status, 0, 'identical project copy');
  fs.appendFileSync(path.join(project, 'toolkit-g1-helper.toml'), '# local note\n');
  const r = hook(v1(nested, { agent_type: 'toolkit-g1-helper' }), { CODEX_HOME: f.home });
  assert.equal(r.status, 2); assert.match(r.stderr, /project copy .* does not match .* Toolkit does not change project files/);
  // A project copy alone, with no personal file, is checked the same way.
  fs.rmSync(f.agents, { recursive: true, force: true });
  fs.writeFileSync(path.join(project, 'toolkit-g1-helper.toml'), renderer.render('G1').text);
  assert.equal(hook(v1(nested, { agent_type: 'toolkit-g1-helper' }), { CODEX_HOME: f.home }).status, 0);
});

test('a G2 session launches no helpers, and a caller agent id is refused', t => {
  const f = fixture(t);
  const g2 = hook(v1(f.repo, { agent_type: 'toolkit-g1-helper' }), { CODEX_HOME: f.home, TOOLKIT_GATE_ROLE: 'G2' });
  assert.equal(g2.status, 2); assert.match(g2.stderr, /G2 review sessions launch no helpers/);
  const leaf = hook({ ...v1(f.repo, { agent_type: 'toolkit-g1-helper' }), agent_id: 'child-1' }, { CODEX_HOME: f.home });
  assert.equal(leaf.status, 2); assert.match(leaf.stderr, /a helper cannot launch another agent/);
});

test('outside governed work the policy is not consulted: any agent launches with no decision', t => {
  const f = fixture(t, { install: false });
  for (const input of [v1(f.plain, { agent_type: 'worker', model: 'x' }), v2(f.plain, {}), { tool_name: 'spawn_agent', cwd: f.base, tool_input: {} }]) {
    const r = hook(input, { CODEX_HOME: f.home });
    assert.equal(r.status, 0); assert.deepEqual(r.output, {});
  }
});

test('the policy object compares with the injected matcher and never writes', () => {
  const seen = [];
  const policy = new CodexNamedHelperPolicy({ environment: { CODEX_HOME: path.join(os.tmpdir(), 'no-such-codex-home') },
    matchesRenderedDefinition: (role, text) => { seen.push(role); return { matches: true, stack: 'owner-gpt' }; } });
  const decision = policy.decide({ tool_name: 'spawn_agent', cwd: ROOT, tool_input: { agent_type: 'toolkit-g0-helper' } }, { governed: true, root: ROOT, gate_role: null });
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /no toolkit-g0-helper agent file is installed/);
  assert.deepEqual(seen, [], 'nothing to compare without a file');
});
