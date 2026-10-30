'use strict';

// A Codex chat keeps the hook commands it loaded at start. These tests replace the version folder those
// commands name, the way a plugin update does, and check what the open chat's hooks then do: refuse
// guarded calls with "open a new chat", and let reads and prompts through.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const setup = require('../scripts/setup-codex-toolkit-plugin.cjs');
const standIn = require('../scripts/toolkit-codex-stand-in.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const NEW_CHAT = /Open a new chat/;

function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-stand-in-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A Codex home with real-looking version folders under this plugin's cache.
function codexCache(t, versions) {
  const base = path.join(tmpRoot(t), '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit');
  for (const version of versions) {
    fs.mkdirSync(path.join(base, version, '.codex-plugin'), { recursive: true });
    fs.writeFileSync(path.join(base, version, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version }));
  }
  return base;
}

// What a plugin update does to the cache: the new version in, every older version folder out.
function replaceVersions(base, toVersion) {
  for (const name of fs.readdirSync(base)) fs.rmSync(path.join(base, name), { recursive: true, force: true });
  fs.mkdirSync(path.join(base, toVersion, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(base, toVersion, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version: toVersion }));
}

const shell = (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: ROOT, tool_input: { command } });
const GUARDED = ['git push origin HEAD', 'git commit -m x', 'gh pr create --fill', 'gh pr merge 5', 'gh api -X PUT repos/o/r/pulls/5/merge', 'GIT PUSH origin main', 'codex exec hi'];
const ORDINARY = ['git status', 'git log --oneline -3', 'ls', 'npm test', 'gh pr view 5'];

test('the stand-in decision refuses guarded calls and lets reads and prompts through', () => {
  const reason = standIn.supersededReason({ from_version: '3.19.18', to_version: '3.19.19' });
  assert.match(reason, /updated from 3\.19\.18 to 3\.19\.19 after this chat started/);
  for (const command of GUARDED) {
    const result = standIn.helperDecision(shell(command), reason);
    assert.equal(result.exit, 2, command);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny', command);
    assert.match(result.stderr, NEW_CHAT, command);
  }
  for (const command of ORDINARY) {
    const result = standIn.helperDecision(shell(command), reason);
    assert.equal(result.exit, 1, `${command} runs with a notice`);
    assert.equal(result.stdout, '', command);
  }
  for (const input of [
    { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch' } },
    { hook_event_name: 'PreToolUse', tool_name: 'mcp__github__merge_pull_request', tool_input: {} },
    { hook_event_name: 'PreToolUse', tool_name: 'collaborationspawn_agent', tool_input: { task_name: 'x' } },
    {},
  ]) assert.equal(standIn.helperDecision(input, reason).exit, 2, JSON.stringify(input));
  const prompt = standIn.helperDecision({ hook_event_name: 'UserPromptSubmit', prompt: 'what changed?' }, reason);
  assert.equal(prompt.exit, 0);
  assert.match(prompt.stdout, NEW_CHAT);
  // The array form of a shell command is read too.
  assert.equal(standIn.helperDecision({ tool_name: 'shell', tool_input: { command: ['git', 'push'] } }, reason).exit, 2);
});

test('setup writes a stand-in only for replaced older versions inside the plugin cache', (t) => {
  const base = codexCache(t, ['3.19.17', '3.19.18']);
  const before = standIn.installedVersionFolders(base);
  assert.deepEqual(before.sort(), ['3.19.17', '3.19.18']);
  replaceVersions(base, '3.19.19');
  const now = new Date('2026-10-30T15:00:00Z');
  const result = standIn.writeStandIns({ base, before: [...before, '3.20.0'], toVersion: '3.19.19', sourceRoot: ROOT, now });
  assert.deepEqual(result.written.sort(), ['3.19.17', '3.19.18']);
  assert.deepEqual(result.skipped, [{ version: '3.20.0', reason: 'not older than the installed version' }]);
  for (const version of result.written) {
    const folder = path.join(base, version);
    assert.equal(standIn.isStandInFolder(folder), true, version);
    // No manifest: Codex never loads a stand-in as a plugin, and it is never the highest real version.
    assert.equal(fs.existsSync(path.join(folder, '.codex-plugin')), false);
    const marker = JSON.parse(fs.readFileSync(path.join(folder, standIn.MARKER_NAME), 'utf8'));
    assert.deepEqual(marker, { schema: 1, from_version: version, to_version: '3.19.19', written_at: now.toISOString() });
    for (const name of ['toolkit-codex-helper-hook.ps1', 'toolkit-codex-session-start.ps1', 'toolkit-programme-checkpoint-hook.ps1']) {
      assert.deepEqual(fs.readFileSync(path.join(folder, 'repo', 'scripts', name)), fs.readFileSync(path.join(ROOT, 'repo', 'scripts', name)), name);
    }
  }
  assert.deepEqual(standIn.installedVersionFolders(base), ['3.19.19'], 'stand-ins are not installed versions');
  assert.deepEqual(fs.readdirSync(base).filter((name) => name.startsWith('.')), [], 'no temporary folder is left');
});

test('a stand-in never replaces a folder that exists and never lands outside the plugin cache', (t) => {
  const base = codexCache(t, ['3.19.18']);
  // The old folder is still there (Codex kept it): nothing is written over it.
  let result = standIn.writeStandIns({ base, before: ['3.19.18'], toVersion: '3.19.19', sourceRoot: ROOT });
  assert.deepEqual(result, { written: [], skipped: [{ version: '3.19.18', reason: 'folder still present' }] });
  assert.equal(fs.existsSync(path.join(base, '3.19.18', '.codex-plugin', 'plugin.json')), true);
  // A folder elsewhere is refused even when it looks like a version.
  const elsewhere = path.join(tmpRoot(t), 'plugins', 'cache', 'other-marketplace', 'ai-agent-toolkit');
  result = standIn.writeStandIns({ base: elsewhere, before: ['3.19.18'], toVersion: '3.19.19', sourceRoot: ROOT });
  assert.deepEqual(result.written, []);
  assert.equal(fs.existsSync(elsewhere), false);
  assert.throws(() => standIn.writeStandIn({ target: path.join(elsewhere, '3.19.18'), fromVersion: '3.19.18', toVersion: '3.19.19', sourceRoot: ROOT }), /not a Toolkit plugin cache version folder/);
  // A folder that appears while the stand-in is built makes the final rename fail; its contents stay.
  const target = path.join(base, '3.19.17');
  const original = fs.renameSync;
  t.after(() => { fs.renameSync = original; });
  fs.renameSync = (from, to) => {
    fs.mkdirSync(path.join(to, '.codex-plugin'), { recursive: true });
    fs.writeFileSync(path.join(to, '.codex-plugin', 'plugin.json'), '{}');
    return original(from, to);
  };
  assert.throws(() => standIn.writeStandIn({ target, fromVersion: '3.19.17', toVersion: '3.19.19', sourceRoot: ROOT }));
  fs.renameSync = original;
  assert.equal(fs.readFileSync(path.join(target, '.codex-plugin', 'plugin.json'), 'utf8'), '{}');
  assert.deepEqual(fs.readdirSync(base).filter((name) => name.startsWith('.')), []);
});

test('stand-ins go after seven days, and anything that is not exactly a stand-in stays', (t) => {
  const base = codexCache(t, ['3.19.15']);
  replaceVersions(base, '3.19.19');
  const written = new Date('2026-10-01T00:00:00Z');
  for (const version of ['3.19.16', '3.19.17', '3.19.18']) {
    standIn.writeStandIn({ target: path.join(base, version), fromVersion: version, toVersion: '3.19.19', sourceRoot: ROOT, now: written });
  }
  fs.writeFileSync(path.join(base, '3.19.17', 'repo', 'scripts', 'extra.txt'), 'not ours');
  assert.deepEqual(standIn.removeExpiredStandIns({ base, now: new Date('2026-10-07T23:00:00Z') }), [], 'younger than seven days');
  assert.deepEqual(standIn.removeExpiredStandIns({ base, now: new Date('2026-10-08T00:00:01Z') }).sort(), ['3.19.16', '3.19.18']);
  assert.deepEqual(fs.readdirSync(base).sort(), ['3.19.17', '3.19.19']);
});

test('a stand-in is not leftover state that blocks a fresh install', (t) => {
  const base = codexCache(t, ['3.19.18']);
  const codexHome = path.resolve(base, '..', '..', '..', '..');
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '');
  fs.rmSync(path.join(base, '3.19.18'), { recursive: true, force: true });
  standIn.writeStandIn({ target: path.join(base, '3.19.18'), fromVersion: '3.19.18', toVersion: '3.19.19', sourceRoot: ROOT });
  assert.deepEqual(setup.inspectResidualToolkitState(codexHome).evidence, []);
  fs.mkdirSync(path.join(base, '3.19.10', '.codex-plugin'), { recursive: true });
  assert.match(setup.inspectResidualToolkitState(codexHome).evidence.join('\n'), /still holds ai-agent-toolkit\/3\.19\.10/);
});

// Runs a hook command the way Codex does on macOS and Linux, with ${PLUGIN_ROOT} already replaced.
function runPortable(command, pluginRoot, input) {
  const text = command.split('${PLUGIN_ROOT}').join(pluginRoot.split(path.sep).join('/'));
  return spawnSync('sh', ['-c', text], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, windowsHide: true });
}

const hasSh = spawnSync('sh', ['-c', 'exit 0'], { windowsHide: true }).status === 0;

test('portable helper command: a missing script refuses with exit 2, a stand-in decides per call', { skip: !hasSh && 'sh is not available' }, (t) => {
  const base = codexCache(t, ['3.19.18']);
  const oldRoot = path.join(base, '3.19.18');
  replaceVersions(base, '3.19.19');
  const command = setup.sourceHelperHookCommand();
  let result = runPortable(command, oldRoot, shell('git push origin HEAD'));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /updated or removed while this chat was open.*Open a new chat/);
  result = runPortable(command, oldRoot, shell('git status'));
  assert.equal(result.status, 2, 'with no script there is no way to tell a read from a push');

  standIn.writeStandIn({ target: oldRoot, fromVersion: '3.19.18', toVersion: '3.19.19', sourceRoot: ROOT });
  result = runPortable(command, oldRoot, shell('git push origin HEAD'));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /updated from 3\.19\.18 to 3\.19\.19.*Open a new chat/);
  result = runPortable(command, oldRoot, shell('git status'));
  assert.equal(result.status, 1, result.stderr);
  result = runPortable(command, oldRoot, { hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, NEW_CHAT);
  // The node stand-ins for the other hooks: session start tells the chat, the checkpoint stays silent.
  const node = (name) => spawnSync(process.execPath, [path.join(oldRoot, 'repo', 'scripts', name)], { input: '{}', encoding: 'utf8', windowsHide: true });
  const session = node('toolkit-codex-session-start.cjs');
  assert.equal(session.status, 0);
  assert.match(session.stdout, NEW_CHAT);
  const checkpoint = node('toolkit-programme-checkpoint-hook.cjs');
  assert.deepEqual([checkpoint.status, checkpoint.stdout], [0, '']);
});

// Codex runs a hook's Windows command in the session shell, usually `<PowerShell> -Command "<command>"`
// and otherwise `cmd.exe /C`.
function windowsShells() {
  const powershell = setup.defaultWindowsPowerShellPath();
  const shells = [
    ['Windows PowerShell -Command', powershell, (command) => ['-NoProfile', '-Command', command], false],
    ['cmd.exe /C', process.env.ComSpec, (command) => ['/d', '/s', '/c', `"${command}"`], true],
  ];
  const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  if (fs.existsSync(pwsh)) shells.push(['PowerShell 7 -Command', pwsh, (command) => ['-NoProfile', '-Command', command], false]);
  return shells;
}

function runWindows([, exe, args, verbatim], command, pluginRoot, input) {
  const text = command.split('${PLUGIN_ROOT}').join(pluginRoot.split(path.sep).join('/'));
  return spawnSync(exe, args(text), { input: JSON.stringify(input), encoding: 'utf8', timeout: 60000, windowsHide: true, windowsVerbatimArguments: verbatim });
}

test('Windows helper command: a deleted version folder refuses under PowerShell; the stand-in refuses under every shell', { skip: process.platform !== 'win32' }, (t) => {
  const powershell = setup.defaultWindowsPowerShellPath();
  const helper = setup.windowsHelperHookCommand(powershell);
  const session = setup.windowsSessionStartCommand(powershell);
  const checkpoint = setup.windowsCheckpointHookCommand(powershell);
  for (const entry of windowsShells()) {
    const [name] = entry;
    const base = codexCache(t, ['3.19.18']);
    const oldRoot = path.join(base, '3.19.18');
    replaceVersions(base, '3.19.19');
    if (name !== 'cmd.exe /C') {
      // No stand-in: the command itself refuses. Under cmd.exe the words after -File are launcher
      // arguments, so a missing launcher still fails open there; the stand-in covers that shell.
      for (const command of ['git push origin HEAD', 'git status']) {
        const result = runWindows(entry, helper, oldRoot, shell(command));
        assert.equal(result.status, 2, `${name} ${command}: ${result.stderr}`);
        assert.match(result.stderr, /updated or removed while this chat was open/, name);
      }
      let result = runWindows(entry, session, oldRoot, {});
      assert.equal(result.status, 0, name);
      assert.match(result.stdout, NEW_CHAT, name);
      result = runWindows(entry, checkpoint, oldRoot, {});
      assert.equal(result.status, 0, name);
    }
    standIn.writeStandIn({ target: oldRoot, fromVersion: '3.19.18', toVersion: '3.19.19', sourceRoot: ROOT });
    for (const command of GUARDED) {
      const result = runWindows(entry, helper, oldRoot, shell(command));
      assert.equal(result.status, 2, `${name} ${command}: ${result.stderr}`);
      assert.match(result.stderr, /updated from 3\.19\.18 to 3\.19\.19.*Open a new chat/, `${name} ${command}`);
      // The same decision as the portable stand-in.
      assert.equal(standIn.helperDecision(shell(command), '').exit, 2, command);
    }
    for (const command of ORDINARY) {
      assert.equal(runWindows(entry, helper, oldRoot, shell(command)).status, 1, `${name} ${command}`);
      assert.equal(standIn.helperDecision(shell(command), '').exit, 1, command);
    }
    assert.equal(runWindows(entry, helper, oldRoot, { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: {} }).status, 2, name);
    const prompt = runWindows(entry, helper, oldRoot, { hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
    assert.equal(prompt.status, 0, `${name}: ${prompt.stderr}`);
    assert.match(prompt.stdout, NEW_CHAT, name);
    const start = runWindows(entry, session, oldRoot, {});
    assert.equal(start.status, 0, name);
    assert.match(start.stdout, NEW_CHAT, name);
    assert.equal(runWindows(entry, checkpoint, oldRoot, {}).status, 0, name);
  }
});

test('the command a chat on an older version loaded is refused once its folder holds a stand-in', { skip: process.platform !== 'win32' }, (t) => {
  // Chats opened before this release run the earlier command shape; the stand-in is their only cover.
  const earlier = `${setup.defaultWindowsPowerShellPath()} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\${PLUGIN_ROOT}/repo/scripts/toolkit-codex-helper-hook.ps1" ; exit $LASTEXITCODE`;
  const base = codexCache(t, ['3.19.18']);
  const oldRoot = path.join(base, '3.19.18');
  replaceVersions(base, '3.19.19');
  const entry = windowsShells()[0];
  assert.notEqual(runWindows(entry, earlier, oldRoot, shell('git push origin HEAD')).status, 2, 'without a stand-in the earlier command fails open');
  standIn.writeStandIn({ target: oldRoot, fromVersion: '3.19.18', toVersion: '3.19.19', sourceRoot: ROOT });
  assert.equal(runWindows(entry, earlier, oldRoot, shell('git push origin HEAD')).status, 2);
  assert.equal(runWindows(entry, earlier, oldRoot, shell('git status')).status, 1);
});

// The update rows of the hook test pack, run the way Codex starts the installed hook in each shell the row names.
const PACK_ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, 'hook-pack', 'corpus', 'update.json'), 'utf8')).rows;

test('hook pack update rows: each passing Codex row gives its expected exit in every shell it names', (t) => {
  const rows = PACK_ROWS.filter((row) => row.status === 'pass' && row.hosts.includes('codex'));
  assert.ok(rows.length >= 9);
  const powershell = setup.defaultWindowsPowerShellPath();
  const runners = {
    sh: hasSh ? (root, input) => runPortable(setup.sourceHelperHookCommand(), root, input) : null,
    powershell: process.platform === 'win32' ? (root, input) => runWindows(windowsShells()[0], setup.windowsHelperHookCommand(powershell), root, input) : null,
    cmd: process.platform === 'win32' ? (root, input) => runWindows(windowsShells()[1], setup.windowsHelperHookCommand(powershell), root, input) : null,
  };
  for (const row of rows) {
    const base = codexCache(t, ['3.19.18']);
    const oldRoot = path.join(base, '3.19.18');
    replaceVersions(base, '3.19.19');
    if (row.fixture.version_folder === 'stand-in') standIn.writeStandIn({ target: oldRoot, fromVersion: '3.19.18', toVersion: '3.19.19', sourceRoot: ROOT });
    for (const name of row.shells) {
      if (!runners[name]) continue;
      const result = runners[name](oldRoot, { cwd: ROOT, ...row.payload });
      assert.equal(result.status, row.expect.exit, `${row.id} ${name}: ${result.stderr}`);
      if (row.expect.exit === 2) assert.match(result.stderr, NEW_CHAT, `${row.id} ${name}`);
    }
  }
});
