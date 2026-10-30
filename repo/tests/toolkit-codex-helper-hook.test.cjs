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
// The launcher markers and the host session id, which a test run from a Claude Code shell inherits.
const MARKERS = ['TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_NATIVE_HELPER_BINDING_SHA256', 'TOOLKIT_NATIVE_HELPER_IDENTITY', 'TOOLKIT_GATE_ROLE', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256',
  require('../scripts/toolkit-governance-gate.cjs').HOST_SESSION_VARIABLE];
// The Toolkit checkout is governed here by the user's recorded yes, in a scratch home this test
// process and its hooks use (the governed block and binding alone are not an answer).
require('./toolkit-governed-fixture-support.cjs').recordEnabled(ROOT);
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
  assert.deepEqual(run({ tool_name: 'view_image', cwd: ROOT }).output, {}, 'other tools are untouched');
  assert.deepEqual(run({ tool_name: 'shell', cwd: ROOT }).output, {}, 'a shell call with no command has nothing to refuse');
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
  // Both registrations carry the one helper-hook matcher: every spawn name the recogniser holds, plus
  // every shell tool name Codex may report.
  for (const hooks of [plugin, contract]) assert.equal(hooks.hooks.PreToolUse[0].matcher, CODEX_HELPER_HOOK_MATCHER);
  for (const name of ['spawn_agent', 'Agent', 'collaborationspawn_agent', 'multi-agentspawn_agent', 'Bash', 'exec_command', 'shell', 'local_shell', 'PowerShell']) assert.equal(new CodexHookMatcher(CODEX_HELPER_HOOK_MATCHER).matches(name), true, name);
  assert.equal(new CodexHookMatcher(CODEX_HELPER_HOOK_MATCHER).matches('write_stdin'), false, 'write_stdin does not run PreToolUse again');
});

test('a push the check cannot check is refused in Codex, under every Codex shell tool name; other commands still run', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-git-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const notAProgram = path.join(scratch, 'not-git.txt');
  fs.writeFileSync(notAProgram, 'not a program\n');
  // Codex's shell and exec tools, each with the folder in workdir: every one reaches the push check.
  // Codex shows no hook systemMessage, so an unchecked push is refused rather than sent with a note.
  for (const tool of ['Bash', 'exec_command', 'shell', 'local_shell']) {
    const r = run({ tool_name: tool, hook_event_name: 'PreToolUse', cwd: os.tmpdir(), tool_input: { cmd: 'git push origin HEAD:refs/heads/toolkit-test-unused', workdir: ROOT } }, { TOOLKIT_GIT_PATH: notAProgram });
    assert.equal(r.status, 2, `${tool}: ${r.stderr}`);
    const reason = r.output.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^Toolkit could not check this push for credentials and plain-text findings: git could not run \(\w+\)\.\nCodex does not show Toolkit's warnings, so this push or pull request is refused instead of going out unchecked\.\nFix what the note above names, then retry: /, tool);
    // Each cause that repeats on every retry has its own way through.
    for (const way of [/push fewer new commits at a time/, /run `git fetch origin` or name `--base`/, /fix the file it names/, /git was not found or could not run, run `setup toolkit`/]) assert.match(reason, way, tool);
    assert.doesNotMatch(reason, /let through/, tool);
    assert.equal(r.output.systemMessage, undefined, tool);
  }
  const status = run({ tool_name: 'Bash', hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { command: 'git status' } }, { TOOLKIT_GIT_PATH: notAProgram });
  assert.deepEqual([status.status, status.output], [0, {}], 'a command that sends nothing runs');
});

// R11: the payload Codex Desktop sent on 29 October 2026 for a code-mode call (key names and types
// from the capture, fake values). The code-mode program itself (`exec`) reaches no hook; each shell
// call it makes arrives as Bash with a string command, no workdir, and the session folder as cwd.
test('R11: the captured Codex payload shape is refused for a force push and a pushed credential', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-r11-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = require('./toolkit-governed-fixture-support.cjs').makeGoverned(path.join(dir, 'governed'), 'codex-r11');
  const hooks = path.join(dir, 'no-hooks'); fs.mkdirSync(hooks);
  const git = (...args) => spawnSync('git', ['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(repo, 'uat-config.txt'), `token = "${['gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0'].join('')}"\n`);
  assert.equal(git('checkout', '--quiet', '-b', 'feature').status, 0);
  assert.equal(git('add', '-A').status, 0);
  assert.equal(git('commit', '--quiet', '-m', 'fixture').status, 0);
  const captured = command => ({
    cwd: repo, hook_event_name: 'PreToolUse', model: 'fixture-model', permission_mode: 'default', session_id: 'fixture-session',
    tool_input: { command }, tool_name: 'Bash', tool_use_id: 'fixture-call', transcript_path: path.join(dir, 'transcript.jsonl'), turn_id: 'fixture-turn',
  });
  const env = { ...process.env }; delete env.TOOLKIT_GIT_PATH;
  const force = run(captured('git push --force origin feature'), env);
  assert.equal(force.status, 2, force.stderr);
  assert.match(force.output.hookSpecificOutput.permissionDecisionReason, /This command force-pushes/);
  const secret = run(captured('git push origin feature'), env);
  assert.equal(secret.status, 2, secret.stderr);
  assert.match(secret.output.hookSpecificOutput.permissionDecisionReason, /uat-config\.txt:1 \(commit [0-9a-f]{7}\)/);
  assert.deepEqual(run(captured('git --version'), env).output, {}, 'an ordinary call runs');
});

// R12: the same code-mode shape when the command runs in a linked worktree under the chat folder's
// ignored .tmp/. The payload names only the chat folder (the main checkout), so the push check must
// find the worktree that has the pushed branch checked out to see what the commit could add.
test('R12: a one-command add, commit and push from a lane worktree is checked in that worktree', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-r12-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = require('./toolkit-governed-fixture-support.cjs').makeGoverned(path.join(dir, 'governed'), 'codex-r12');
  const hooks = path.join(dir, 'no-hooks'); fs.mkdirSync(hooks);
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(repo, '.gitignore'), '.tmp/\n');
  assert.equal(git(repo, 'add', '-A').status, 0);
  assert.equal(git(repo, 'commit', '--quiet', '-m', 'base').status, 0);
  assert.equal(git(repo, 'branch', 'lane/one').status, 0);
  const lane = path.join(repo, '.tmp', 'worktrees', 'lane-one');
  assert.equal(git(repo, 'worktree', 'add', '--quiet', lane, 'lane/one').status, 0);
  const remote = path.join(dir, 'uat.git');
  assert.equal(git(dir, 'clone', '--quiet', '--bare', repo, remote).status, 0);
  assert.equal(git(repo, 'remote', 'add', 'uat', remote).status, 0);
  assert.equal(git(repo, 'fetch', '--quiet', 'uat').status, 0);
  // The main checkout moves off the remote's default branch, so the merge hold's rule stays out.
  assert.equal(git(repo, 'checkout', '--quiet', '-b', 'feature').status, 0);
  fs.writeFileSync(path.join(lane, 'uat-new.txt'), `token = "${['gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0'].join('')}"\n`);
  const captured = (cwd, command) => ({
    cwd, hook_event_name: 'PreToolUse', model: 'fixture-model', permission_mode: 'default', session_id: 'fixture-session',
    tool_input: { command }, tool_name: 'Bash', tool_use_id: 'fixture-call', transcript_path: path.join(dir, 'transcript.jsonl'), turn_id: 'fixture-turn',
  });
  const env = { ...process.env }; delete env.TOOLKIT_GIT_PATH;
  for (const cwd of [repo, repo.split(path.sep).join('/')]) {
    const sent = run(captured(cwd, 'git add -A; git commit -m t2; git push uat lane/one'), env);
    assert.equal(sent.status, 2, `${cwd}: ${sent.stderr}`);
    assert.match(sent.output.hookSpecificOutput.permissionDecisionReason, /uat-new\.txt:1 \(not committed yet\)/, cwd);
    // A push of HEAD cannot tell which working tree's HEAD it sends.
    const bare = run(captured(cwd, 'git push uat'), env);
    assert.equal(bare.status, 2, `${cwd}: ${bare.stderr}`);
    assert.match(bare.output.hookSpecificOutput.permissionDecisionReason, /Codex did not say which folder this command runs in/, cwd);
  }
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
    assert.equal(broken.status, 2); assert.match(broken.stderr, /Toolkit helper guard failed\. Never act as the user/);
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

test('A19: a repository with the Toolkit-governed rules block is governed on Codex too; a plain folder is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-scope-'));
  try {
    const plain = path.join(dir, 'plain'), managed = path.join(dir, 'managed'), noOrigin = path.join(dir, 'no-origin');
    fs.mkdirSync(plain, { recursive: true });
    for (const repo of [managed, noOrigin]) fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(plain, 'AGENTS.md'), '# Rules\n');
    // A governed repository by its governance state: the managed block plus a valid binding (#542).
    require('./toolkit-governed-fixture-support.cjs').makeGoverned(managed, 'codex-scope');
    const nested = path.join(managed, 'src'); fs.mkdirSync(nested);
    const spawn = cwd => ({ tool_name: 'collaborationspawn_agent', hook_event_name: 'PreToolUse', cwd, tool_input: { fork_turns: 'none' } });
    const r = run(spawn(plain));
    assert.equal(r.status, 0); assert.deepEqual(r.output, {}, 'plain folder: no decision');
    // A git repository that is not on github.com waits for the user's ok before anything runs.
    const waiting = run(spawn(noOrigin));
    assert.equal(waiting.status, 2); assert.match(waiting.stderr, /nothing runs until the user says ok/);
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

test('Windows launcher without Node blocks commit, pull request, merge, push and host-launch shell commands; other shell commands run', { skip: process.platform !== 'win32' }, t => {
  for (const command of ['git commit -m "x"', 'git -C repo commit --amend', 'echo a && git commit -F msg.txt', 'gh pr create --body-file b.md', 'gh pr edit 5 --body x', 'GH PR MERGE 5', 'git push origin main', 'gh api -X PUT repos/o/r/pulls/5/merge', 'gh repo sync o/r', 'claude -p hi', 'cat merge-approvals.v1.json']) {
    const r = runBrokenWindowsLauncher(t, { tool_name: 'Bash', cwd: ROOT, tool_input: { command } });
    assert.equal(r.status, 2, command);
    assert.equal(runBrokenWindowsLauncher(t, { tool_name: 'Bash', cwd: ROOT, tool_input: { cmd: command } }).status, 2, `cmd: ${command}`);
    assert.equal(JSON.parse(r.stdout.trim()).hookSpecificOutput.permissionDecision, 'deny', command);
  }
  for (const command of ['git status', 'npm test', 'gh pr view 5', 'ls']) {
    const r = runBrokenWindowsLauncher(t, { tool_name: 'Bash', cwd: ROOT, tool_input: { command } });
    assert.equal(r.status, 1, command);
    assert.equal(r.stdout, '', command);
    assert.match(r.stderr, /setup toolkit/, command);
  }
  // Every shell tool name Codex may report is a shell call here too.
  for (const tool of ['exec_command', 'shell', 'local_shell', 'PowerShell']) {
    assert.equal(runBrokenWindowsLauncher(t, { tool_name: tool, cwd: ROOT, tool_input: { cmd: 'git status' } }).status, 1, `${tool}: an ordinary command runs`);
    assert.equal(runBrokenWindowsLauncher(t, { tool_name: tool, cwd: ROOT, tool_input: { cmd: 'git push --force origin main' } }).status, 2, `${tool}: a push is refused`);
  }
});

test('Windows launcher treats unreadable, unsupported or relative runtime metadata as a broken install', { skip: process.platform !== 'win32' }, t => {
  for (const [runtime, reason] of [['{', 'runtime metadata unreadable'], ['{"schema":2,"node_path":"C:\\\\node.exe"}', 'runtime metadata schema is unsupported'], ['{"schema":1,"node_path":"node.exe"}', 'Node path is not absolute']]) {
    const r = runBrokenWindowsLauncher(t, { tool_name: 'spawn_agent', cwd: ROOT, tool_input: {} }, { runtime });
    assert.equal(r.status, 2, reason);
    assert.match(r.stderr, new RegExp(reason), reason);
  }
});

// Codex runs a hook's Windows command in the session shell, usually `<PowerShell> -Command "<command>"`
// and otherwise `cmd.exe /C`. Codex blocks a prompt or a tool call only on exit 2 with the reason on
// stderr; exit 1 is a hook failure and the prompt or call goes ahead.
function codexWindowsShells() {
  const shells = [
    ['cmd.exe /C', process.env.ComSpec, command => ['/d', '/s', '/c', `"${command}"`], true],
    ['Windows PowerShell -Command', path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), command => ['-NoProfile', '-Command', command], false],
  ];
  const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  if (fs.existsSync(pwsh)) shells.push(['PowerShell 7 -Command', pwsh, command => ['-NoProfile', '-Command', command], false]);
  return { shells, missing: fs.existsSync(pwsh) ? null : pwsh };
}

// A plugin-shaped folder with the real launcher, runtime metadata naming this Node, and a hook script
// that loads the real hook from this checkout, run through the command setup installs.
function installedWindowsHelperHook(t) {
  const setup = require('../scripts/setup-codex-toolkit-plugin.cjs');
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-launcher-'));
  t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }));
  const scripts = path.join(pluginRoot, 'repo', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'session-start-runtime.json'), JSON.stringify({ schema: 1, node_path: process.execPath }));
  fs.copyFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-hook.ps1'), path.join(scripts, 'toolkit-codex-helper-hook.ps1'));
  fs.writeFileSync(path.join(scripts, 'toolkit-codex-helper-hook.cjs'),
    `'use strict';\nrequire(${JSON.stringify(HOOK)}).main().catch(() => { process.stderr.write('hook failed\\n'); process.exitCode = 1; });\n`);
  return setup.windowsHelperHookCommand(setup.defaultWindowsPowerShellPath()).split('${PLUGIN_ROOT}').join(pluginRoot.split(path.sep).join('/'));
}

test('Windows: a held prompt and a refused tool call reach Codex as exit 2 under cmd.exe, Windows PowerShell and PowerShell 7', { skip: process.platform !== 'win32' }, t => {
  const command = installedWindowsHelperHook(t);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-launcher-repos-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain, { recursive: true });
  const { shells, missing } = codexWindowsShells();
  // A missing PowerShell 7 is reported, never dropped quietly; the GitHub Windows runner has it.
  if (missing) {
    assert.notEqual(process.env.GITHUB_ACTIONS, 'true', `PowerShell 7 is expected on the Windows runner at ${missing}`);
    t.test('PowerShell 7 -Command', { skip: `PowerShell 7 is not installed at ${missing}` }, () => {});
  }
  for (const [name, shell, args, verbatim] of shells) {
    // A fresh undecided repository and home per shell, so each run sees the first question.
    const slug = name.replace(/\W+/g, '-'), repo = path.join(base, `undecided-${slug}`), home = path.join(base, `home-${slug}`);
    fs.mkdirSync(home, { recursive: true });
    spawnSync('git', ['init', '--quiet', repo], { windowsHide: true });
    spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'], { windowsHide: true });
    const env = { ...process.env, PATH: '', HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') };
    for (const key of MARKERS) delete env[key];
    const hook = input => {
      const r = spawnSync(shell, args(command), { input: JSON.stringify(input), env, cwd: plain, encoding: 'utf8', timeout: 60000, windowsHide: true, windowsVerbatimArguments: verbatim });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };

    const held = hook({ hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: 'list the files here' });
    assert.equal(held.status, 2, `${name} prompt hold: ${held.stderr}`);
    assert.equal(JSON.parse(held.stdout.trim()).decision, 'block', name);
    // Codex has no card, so the hold is the three short lines.
    assert.match(held.stderr, /^Toolkit: message held\. Turn on GitHub governance \(issues, records, evidence store\) for this repository\?\r?\nReply yes, no \(never ask again\) or later \(ask next session\)\. Held messages follow your answer\.\r?\nFor agents: only the user answers; never answer, script or click it for them\.\r?\n?$/, name);

    const denied = hook({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** End Patch' } });
    assert.equal(denied.status, 2, `${name} tool deny: ${denied.stderr}`);
    const deny = JSON.parse(denied.stdout.trim()).hookSpecificOutput;
    assert.equal(deny.permissionDecision, 'deny', name);
    assert.ok(denied.stderr.includes(deny.permissionDecisionReason), `${name}: stderr carries the deny reason`);

    const allowed = hook({ hook_event_name: 'PreToolUse', cwd: plain, tool_name: 'Bash', tool_input: { command: 'dir' } });
    assert.deepEqual([allowed.status, allowed.stdout], [0, ''], `${name}: an allowed call is exit 0 with no output: ${allowed.stderr}`);
    const passed = hook({ hook_event_name: 'UserPromptSubmit', cwd: plain, prompt: 'hello' });
    assert.deepEqual([passed.status, passed.stdout], [0, ''], `${name}: a prompt outside any repository passes`);
  }
});
