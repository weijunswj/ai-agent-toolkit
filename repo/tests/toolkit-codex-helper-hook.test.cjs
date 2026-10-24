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
// An empty Codex home, so the real ~/.codex/agents never decides a test.
const EMPTY_CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-home-'));
process.on('exit', () => fs.rmSync(EMPTY_CODEX_HOME, { recursive: true, force: true }));
function run(input, env = {}) {
  const clean = { ...process.env, CODEX_HOME: EMPTY_CODEX_HOME, ...env };
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

test('inside the V3-governed Toolkit checkout a helper request without installed agent files is blocked before dispatch', () => {
  for (const tool of ['spawn_agent', 'Agent', 'collaborationspawn_agent']) {
    const r = run({ tool_name: tool, hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { agent_type: 'toolkit-g1-helper', fork_turns: 'none' } });
    assert.equal(r.status, 2, tool);
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.stderr, /no toolkit-g1-helper agent file is installed/);
  }
  assert.deepEqual(run({ tool_name: 'shell', cwd: ROOT }).output, {}, 'other tools are untouched');
});

// F1: Codex validates features.multi_agent_v2.tool_namespace as [A-Za-z0-9_-]+ and names the
// V2 spawn hook `<namespace>spawn_agent`. A hyphenated namespace must reach the hook through
// both registered matchers and be held unless bound, never admitted as an unrecognised name.
test('F1: an unbound spawn under any host-valid Codex namespace, hyphenated ones included, reaches the hook and is held', () => {
  const { CODEX_HELPER_HOOK_MATCHER, CodexHookMatcher } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'toolkit-local-bridge', 'codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  for (const tool of ['multi-agentspawn_agent', 'collab-v2spawn_agent', 'Team_Alpha-2spawn_agent', '-spawn_agent']) {
    for (const hooks of [plugin, contract]) assert.ok(new CodexHookMatcher(hooks.hooks.PreToolUse[0].matcher).matches(tool), `registered matcher reaches ${tool}`);
    const r = run({ tool_name: tool, hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { task_name: 'leaf', message: 'x', fork_turns: 'none' } });
    assert.equal(r.status, 2, tool);
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'deny', tool);
    assert.match(r.stderr, /allows only the toolkit-g0-helper and toolkit-g1-helper agents/, tool);
  }
  // Both registrations carry the one helper-hook matcher: every spawn name the recogniser holds, plus Bash.
  for (const hooks of [plugin, contract]) assert.equal(hooks.hooks.PreToolUse[0].matcher, CODEX_HELPER_HOOK_MATCHER);
  for (const name of ['spawn_agent', 'Agent', 'collaborationspawn_agent', 'multi-agentspawn_agent', 'Bash']) assert.equal(new CodexHookMatcher(CODEX_HELPER_HOOK_MATCHER).matches(name), true, name);
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
  // Run the real hook file with named modules made unloadable by the test preload, in the governed checkout.
  const PRELOAD = path.join(__dirname, 'toolkit-test-module-blocker-preload.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-broken-'));
  try {
    const event = { tool_name: 'collaborationspawn_agent', hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { fork_turns: 'none' } };
    const clean = { ...process.env }; for (const key of MARKERS) delete clean[key];
    const blocked = (modules, input = event, env = clean) => spawnSync(process.execPath, ['--require', PRELOAD, HOOK],
      { input: JSON.stringify(input), env: { ...env, TOOLKIT_TEST_BLOCKED_MODULES: modules }, encoding: 'utf8', timeout: 20000 });
    const ADAPTER = 'toolkit-v3-native-helper-adapter.cjs';
    const broken = blocked(ADAPTER);
    assert.equal(broken.status, 2); assert.match(broken.stderr, /Toolkit helper guard failed/);
    assert.equal(JSON.parse(broken.stdout).hookSpecificOutput.permissionDecision, 'deny');
    // Same boundary, intact modules: the guard itself decides.
    const intact = run(event);
    assert.equal(intact.status, 2); assert.match(intact.stderr, /allows only the toolkit-g0-helper and toolkit-g1-helper agents/);
    // Outside a governed checkout the broken copy still makes no decision for other repositories.
    const elsewhere = blocked(ADAPTER, { ...event, cwd: dir });
    assert.equal(elsewhere.status, 0); assert.equal(elsewhere.stdout, '');
    // Without the governance gate, a repository holds (fail closed, #542) and a plain folder does not.
    const noGate = blocked(`${ADAPTER},toolkit-governance-gate.cjs`);
    assert.equal(noGate.status, 2); assert.match(noGate.stderr, /governance check failed/);
    assert.equal(blocked(`${ADAPTER},toolkit-governance-gate.cjs`, { ...event, cwd: dir }).status, 0);
    // Without the predicate itself, only a launcher marker gates.
    const unknown = blocked(`${ADAPTER},toolkit-governed-repo.cjs`);
    assert.equal(unknown.status, 0); assert.equal(unknown.stdout, '');
    const marked = blocked(`${ADAPTER},toolkit-governed-repo.cjs`, event, { ...clean, TOOLKIT_GATE_ROLE: 'G1' });
    assert.equal(marked.status, 2); assert.match(marked.stderr, /Toolkit helper guard failed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A19: a repository with the Toolkit-governed rules block is governed on Codex too; a plain repository is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-scope-'));
  try {
    const plain = path.join(dir, 'plain'), managed = path.join(dir, 'managed');
    for (const repo of [plain, managed]) fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(plain, 'AGENTS.md'), '# Rules\n');
    // A governed repository by its governance state: the managed block plus a valid binding (#542).
    require('./toolkit-governed-fixture-support.cjs').makeGoverned(managed, 'codex-scope');
    const nested = path.join(managed, 'src'); fs.mkdirSync(nested);
    const spawn = cwd => ({ tool_name: 'collaborationspawn_agent', hook_event_name: 'PreToolUse', cwd, tool_input: { fork_turns: 'none' } });
    const r = run(spawn(plain));
    assert.equal(r.status, 0); assert.deepEqual(r.output, {}, 'plain repository: no decision');
    // Same predicate as the Claude hook: the managed block makes the repository governed.
    assert.equal(require('../scripts/toolkit-governed-repo.cjs').governedRepo(nested, {}).governed, true);
    for (const cwd of [managed, nested, ROOT]) {
      const held = run(spawn(cwd));
      assert.equal(held.status, 2, cwd); assert.match(held.stderr, /allows only the toolkit-g0-helper and toolkit-g1-helper agents/, cwd);
    }
    const marked = run(spawn(plain), { TOOLKIT_GATE_ROLE: 'G1' });
    assert.equal(marked.status, 2); assert.match(marked.stderr, /allows only the toolkit-g0-helper/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The Windows launcher decides alone when Node cannot start: exit 2 with a deny blocks the call on Codex,
// any other exit lets it run. Runs the real launcher from a plugin-shaped folder without runtime metadata.
function runBrokenWindowsLauncher(t, input, { runtime } = {}) {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-launcher-'));
  t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }));
  const scripts = path.join(pluginRoot, 'repo', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-hook.ps1'), path.join(scripts, 'toolkit-codex-helper-hook.ps1'));
  fs.copyFileSync(HOOK, path.join(scripts, 'toolkit-codex-helper-hook.cjs'));
  if (runtime !== undefined) {
    fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'session-start-runtime.json'), runtime);
  }
  const powershell = path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'toolkit-codex-helper-hook.ps1')],
    { input: typeof input === 'string' ? input : JSON.stringify(input), env: { ...process.env, PATH: '' }, encoding: 'utf8', timeout: 30000, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, pluginRoot };
}

test('Windows launcher without Node blocks helper launches and unreadable input with exit 2 and a deny', { skip: process.platform !== 'win32' }, t => {
  const cases = [
    { tool_name: 'spawn_agent', cwd: ROOT, tool_input: { agent_type: 'toolkit-g1-helper' } },
    { tool_name: 'collaborationspawn_agent', cwd: ROOT, tool_input: { task_name: 'leaf', fork_turns: 'none' } },
    { tool_name: 'Agent', cwd: ROOT, tool_input: {} },
    'not json',
  ];
  for (const input of cases) {
    const r = runBrokenWindowsLauncher(t, input);
    assert.equal(r.status, 2, `${JSON.stringify(input)}: ${r.stderr}`);
    const output = JSON.parse(r.stdout.trim());
    assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /runtime metadata unavailable.*setup toolkit/);
    assert.match(r.stderr, /Toolkit helper hook could not start \(runtime metadata unavailable\)/);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(r.pluginRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'no private path');
  }
});

test('Windows launcher without Node blocks only commit and pull request shell commands; other shell commands run', { skip: process.platform !== 'win32' }, t => {
  for (const command of ['git commit -m "x"', 'git -C repo commit --amend', 'echo a && git commit -F msg.txt', 'gh pr create --body-file b.md', 'gh pr edit 5 --body x', 'GH PR MERGE 5']) {
    const r = runBrokenWindowsLauncher(t, { tool_name: 'Bash', cwd: ROOT, tool_input: { command } });
    assert.equal(r.status, 2, command);
    assert.equal(JSON.parse(r.stdout.trim()).hookSpecificOutput.permissionDecision, 'deny', command);
  }
  for (const command of ['git status', 'npm test', 'gh pr view 5', 'ls']) {
    const r = runBrokenWindowsLauncher(t, { tool_name: 'Bash', cwd: ROOT, tool_input: { command } });
    assert.equal(r.status, 1, command);
    assert.equal(r.stdout, '', command);
    assert.match(r.stderr, /setup toolkit/, command);
  }
});

test('Windows launcher treats unreadable, unsupported or relative runtime metadata as a broken install', { skip: process.platform !== 'win32' }, t => {
  for (const [runtime, reason] of [['{', 'runtime metadata unreadable'], ['{"schema":2,"node_path":"C:\\\\node.exe"}', 'runtime metadata schema is unsupported'], ['{"schema":1,"node_path":"node.exe"}', 'Node path is not absolute']]) {
    const r = runBrokenWindowsLauncher(t, { tool_name: 'spawn_agent', cwd: ROOT, tool_input: {} }, { runtime });
    assert.equal(r.status, 2, reason);
    assert.match(r.stderr, new RegExp(reason), reason);
  }
});

// The shells Codex can run a Windows hook command through: Windows PowerShell 5.1, which setup
// writes, and PowerShell 7 when it is installed.
function windowsShells() {
  const shells = [['Windows PowerShell', path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]];
  const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  if (fs.existsSync(pwsh)) shells.push(['PowerShell 7', pwsh]);
  return shells;
}

// A plugin-shaped folder whose launcher starts the real Node with a script that loads the real
// hook from this checkout, so every decision comes from the shipped code.
function workingWindowsPlugin(t, launcher, script) {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-launcher-'));
  t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }));
  const scripts = path.join(pluginRoot, 'repo', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'session-start-runtime.json'), JSON.stringify({ schema: 1, node_path: process.execPath }));
  fs.copyFileSync(path.join(ROOT, 'repo', 'scripts', launcher), path.join(scripts, launcher));
  fs.writeFileSync(path.join(scripts, launcher.replace(/\.ps1$/, '.cjs')), script);
  return path.join(scripts, launcher);
}

function runWindowsLauncher(shell, launcherPath, input, env = {}) {
  const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherPath],
    { input, env: { ...process.env, PATH: '', ...env }, encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Codex blocks a prompt or a tool call only on exit 2 with the reason on stderr; exit 1 is a hook
// failure and the prompt or call goes ahead. Windows PowerShell 5.1 can turn a native command's
// stderr into an error, so the launcher must pass Node's exit code and streams through unchanged.
test('Windows launcher passes Node holds and denies through with exit 2, unchanged stderr and the JSON decision', { skip: process.platform !== 'win32' }, t => {
  const real = JSON.stringify(HOOK);
  const launcher = workingWindowsPlugin(t, 'toolkit-codex-helper-hook.ps1',
    `'use strict';\nrequire(${real}).main().catch(() => { process.stderr.write('hook failed\\n'); process.exitCode = 1; });\n`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-launcher-repos-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'undecided'), plain = path.join(base, 'plain'), home = path.join(base, 'home');
  for (const dir of [plain, home]) fs.mkdirSync(dir, { recursive: true });
  spawnSync('git', ['init', '--quiet', repo], { windowsHide: true });
  spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'], { windowsHide: true });
  const env = { HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') };
  const clean = { ...env };
  for (const key of MARKERS) clean[key] = '';
  for (const [name, shell] of windowsShells()) {
    const held = runWindowsLauncher(shell, launcher, JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: 'list the files here' }), clean);
    assert.equal(held.status, 2, `${name} prompt hold: ${held.stderr}`);
    assert.equal(JSON.parse(held.stdout.trim()).decision, 'block', name);
    assert.match(held.stderr, /^Toolkit: this repository has no governance decision yet, so your message was held and not sent\.\r?\nReply with exactly one of these/, name);
    assert.doesNotMatch(held.stderr, /NativeCommandError|CategoryInfo|At line/, `${name}: the reason reaches Codex as Node wrote it`);

    const denied = runWindowsLauncher(shell, launcher, JSON.stringify({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** End Patch' } }), clean);
    assert.equal(denied.status, 2, `${name} tool deny: ${denied.stderr}`);
    const deny = JSON.parse(denied.stdout.trim()).hookSpecificOutput;
    assert.equal(deny.permissionDecision, 'deny', name);
    assert.equal(denied.stderr.trim(), deny.permissionDecisionReason, `${name}: stderr carries exactly the deny reason`);

    const allowed = runWindowsLauncher(shell, launcher, JSON.stringify({ hook_event_name: 'PreToolUse', cwd: plain, tool_name: 'Bash', tool_input: { command: 'dir' } }), clean);
    assert.deepEqual([allowed.status, allowed.stdout, allowed.stderr], [0, '', ''], `${name}: an allowed call is exit 0 with no output`);
    const passed = runWindowsLauncher(shell, launcher, JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: plain, prompt: 'hello' }), clean);
    assert.deepEqual([passed.status, passed.stdout], [0, ''], `${name}: a prompt outside any repository passes`);
  }
});

test('Windows turn-end and session-start launchers keep Node stderr from failing the hook', { skip: process.platform !== 'win32' }, t => {
  const noisy = "'use strict';\nprocess.stdin.resume(); process.stdin.on('end', () => {});\nprocess.stderr.write('a warning on stderr\\n');\nprocess.stdout.write(process.env.TOOLKIT_TEST_STDOUT || '');\n";
  const checkpoint = workingWindowsPlugin(t, 'toolkit-programme-checkpoint-hook.ps1', noisy);
  const session = workingWindowsPlugin(t, 'toolkit-codex-session-start.ps1', noisy);
  for (const [name, shell] of windowsShells()) {
    const turnEnd = runWindowsLauncher(shell, checkpoint, '{"hook_event_name":"Stop"}', { TOOLKIT_TEST_STDOUT: 'ignored' });
    assert.deepEqual([turnEnd.status, turnEnd.stdout], [0, ''], `${name} turn end: ${turnEnd.stderr}`);
    const start = runWindowsLauncher(shell, session, '{"hook_event_name":"SessionStart"}', { TOOLKIT_TEST_STDOUT: 'Toolkit context line' });
    assert.equal(start.status, 0, `${name} session start: ${start.stderr}`);
    assert.equal(start.stdout.trim(), 'Toolkit context line', `${name}: Node's own output, not the repair warning`);
  }
});
