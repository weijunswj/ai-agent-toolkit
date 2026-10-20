'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs');
const { CodexHookMatcher } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');
const MARKERS = ['TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_NATIVE_HELPER_BINDING_SHA256', 'TOOLKIT_NATIVE_HELPER_IDENTITY', 'TOOLKIT_GATE_ROLE', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256'];
function run(input, env = {}) {
  const clean = { ...process.env, ...env };
  for (const key of MARKERS) if (!(key in env)) delete clean[key];
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: clean, encoding: 'utf8', timeout: 20000 });
  return { status: r.status, output: JSON.parse(r.stdout.trim() || '{}'), stderr: r.stderr };
}

test('the Codex plugin registers the blocking PreToolUse helper hook for spawn_agent, its Agent alias and namespaced MultiAgentV2 spawns', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const entry = hooks.hooks.PreToolUse.find(item => /toolkit-codex-helper-hook\.cjs/.test(item.hooks[0].command));
  assert.ok(entry, 'PreToolUse registration');
  // Evaluated with Codex's matcher semantics: the observed native positive was dispatched as
  // collaborationspawn_agent, which the former exact `spawn_agent|Agent` list never matched.
  const matcher = new CodexHookMatcher(entry.matcher);
  for (const name of ['spawn_agent', 'Agent', 'collaborationspawn_agent']) assert.ok(matcher.matches(name), name);
  assert.equal(new CodexHookMatcher('spawn_agent|Agent').matches('collaborationspawn_agent'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'toolkit-local-bridge', 'codex-plugin', 'hooks', 'hooks.json'), 'utf8')), hooks);
});

test('outside a V3-governed checkout and without a binding the hook makes no decision', () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-'));
  try {
    const r = run({ tool_name: 'spawn_agent', cwd: elsewhere, tool_input: { agent_type: 'any' } });
    assert.equal(r.status, 0); assert.deepEqual(r.output, {});
  } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
});

test('inside the V3-governed Toolkit checkout an unbound helper request is blocked before dispatch', () => {
  for (const tool of ['spawn_agent', 'Agent', 'collaborationspawn_agent']) {
    const r = run({ tool_name: tool, hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { agent_type: 'toolkit-g1-helper', fork_turns: 'none' } });
    assert.equal(r.status, 2, tool);
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.stderr, /Toolkit helper held: NATIVE_BINDING_REQUIRED/);
  }
  assert.deepEqual(run({ tool_name: 'shell', cwd: ROOT }).output, {}, 'other tools are untouched');
});

// F1: Codex validates features.multi_agent_v2.tool_namespace as [A-Za-z0-9_-]+ and names the
// V2 spawn hook `<namespace>spawn_agent`. A hyphenated namespace must reach the hook through
// both registered matchers and be held unless bound, never admitted as an unrecognised name.
test('F1: an unbound spawn under any host-valid Codex namespace, hyphenated ones included, reaches the hook and is held', () => {
  const { CODEX_SPAWN_MATCHER } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'toolkit-local-bridge', 'codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  for (const tool of ['multi-agentspawn_agent', 'collab-v2spawn_agent', 'Team_Alpha-2spawn_agent', '-spawn_agent']) {
    for (const hooks of [plugin, contract]) assert.ok(new CodexHookMatcher(hooks.hooks.PreToolUse[0].matcher).matches(tool), `registered matcher reaches ${tool}`);
    const r = run({ tool_name: tool, hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { task_name: 'leaf', message: 'x', fork_turns: 'none' } });
    assert.equal(r.status, 2, tool);
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'deny', tool);
    assert.match(r.stderr, /Toolkit helper held: NATIVE_BINDING_REQUIRED/, tool);
  }
  // Both registrations carry the single matcher the recogniser is built from.
  for (const hooks of [plugin, contract]) assert.equal(hooks.hooks.PreToolUse[0].matcher, CODEX_SPAWN_MATCHER);
});

test('a drifted pinned binding is blocked wherever it is supplied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-'));
  try {
    const binding = path.join(dir, 'binding.json'); fs.writeFileSync(binding, '{}');
    const r = run({ tool_name: 'spawn_agent', cwd: dir, tool_input: {} }, { TOOLKIT_NATIVE_HELPER_BINDING: binding, TOOLKIT_NATIVE_HELPER_BINDING_SHA256: '0'.repeat(64) });
    assert.equal(r.status, 2); assert.match(r.stderr, /NATIVE_BINDING_DRIFT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a hook whose decision modules cannot load blocks a governed spawn with exit 2 instead of failing open', () => {
  // A non-zero exit other than 2, or a crash, is a non-blocking hook failure on Codex.
  // Run the real hook file with the shared predicate but without the decision modules, in the governed checkout.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-broken-'));
  try {
    const copy = path.join(dir, 'toolkit-codex-helper-hook.cjs'); fs.copyFileSync(HOOK, copy);
    fs.copyFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-governed-repo.cjs'), path.join(dir, 'toolkit-governed-repo.cjs'));
    const event = { tool_name: 'collaborationspawn_agent', hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { fork_turns: 'none' } };
    const clean = { ...process.env }; for (const key of MARKERS) delete clean[key];
    const broken = spawnSync(process.execPath, [copy], { input: JSON.stringify(event), env: clean, encoding: 'utf8', timeout: 20000 });
    assert.equal(broken.status, 2); assert.match(broken.stderr, /Toolkit helper guard failed/);
    assert.equal(JSON.parse(broken.stdout).hookSpecificOutput.permissionDecision, 'deny');
    // Same boundary, intact modules: the guard itself decides.
    const intact = run(event);
    assert.equal(intact.status, 2); assert.match(intact.stderr, /NATIVE_BINDING_REQUIRED/);
    // Outside a governed checkout the broken copy still makes no decision for other repositories.
    const elsewhere = spawnSync(process.execPath, [copy], { input: JSON.stringify({ ...event, cwd: dir }), env: clean, encoding: 'utf8', timeout: 20000 });
    assert.equal(elsewhere.status, 0); assert.equal(elsewhere.stdout, '');
    // Without the predicate itself, only a launcher marker gates.
    fs.rmSync(path.join(dir, 'toolkit-governed-repo.cjs'));
    const unknown = spawnSync(process.execPath, [copy], { input: JSON.stringify(event), env: clean, encoding: 'utf8', timeout: 20000 });
    assert.equal(unknown.status, 0); assert.equal(unknown.stdout, '');
    const marked = spawnSync(process.execPath, [copy], { input: JSON.stringify(event), env: { ...clean, TOOLKIT_GATE_ROLE: 'G1' }, encoding: 'utf8', timeout: 20000 });
    assert.equal(marked.status, 2); assert.match(marked.stderr, /Toolkit helper guard failed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Codex hook stays inside Toolkit: a managed-block-only repository keeps native helpers, the checkout and a launcher marker gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-scope-'));
  try {
    const plain = path.join(dir, 'plain'), managed = path.join(dir, 'managed');
    for (const repo of [plain, managed]) fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(plain, 'AGENTS.md'), '# Rules\n');
    fs.copyFileSync(path.join(ROOT, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'), path.join(managed, 'AGENTS.md'));
    const nested = path.join(managed, 'src'); fs.mkdirSync(nested);
    const spawn = cwd => ({ tool_name: 'collaborationspawn_agent', hook_event_name: 'PreToolUse', cwd, tool_input: { fork_turns: 'none' } });
    for (const cwd of [plain, managed, nested]) {
      const r = run(spawn(cwd));
      assert.equal(r.status, 0, cwd); assert.deepEqual(r.output, {}, cwd);
    }
    // The Claude hook still treats the same managed-block-only repository as governed.
    assert.equal(require('../scripts/toolkit-governed-repo.cjs').governedRepo(nested, {}).governed, true);
    const checkout = run(spawn(ROOT));
    assert.equal(checkout.status, 2); assert.match(checkout.stderr, /NATIVE_BINDING_REQUIRED/);
    const marked = run(spawn(managed), { TOOLKIT_GATE_ROLE: 'G1' });
    assert.equal(marked.status, 2); assert.match(marked.stderr, /NATIVE_BINDING_REQUIRED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
