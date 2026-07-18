'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const launch = require('../scripts/claude-process-launch.cjs');

function run(parts, options = {}) {
  // The production resolver validated this executable, and execFileSync keeps argv shell-free.
  // codeql[js/shell-command-injection-from-environment]
  const stdout = execFileSync(parts.command, parts.args, {
    ...options,
    windowsVerbatimArguments: parts.windowsVerbatimArguments,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { status: 0, stdout, stderr: '' };
}

test('JavaScript Claude CLI paths remain shell-free and preserve argument boundaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Claude CLI '));
  const executable = path.join(root, 'fake.cjs');
  fs.writeFileSync(executable, 'process.exit(0);\n');
  const parts = launch.claudeSpawnParts(executable, ['a b', 'x&y']);
  assert.equal(parts.command, process.execPath);
  assert.equal(parts.shell, false);
  assert.deepEqual(parts.args.slice(-2), ['a b', 'x&y']);
});

test('explicit Windows exe path in a directory with spaces executes directly', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Claude CLI exe '));
  const executable = path.join(root, 'node.exe');
  fs.copyFileSync(process.execPath, executable);
  const parts = launch.claudeSpawnParts(executable, ['--version']);
  const result = run(parts);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^v\d+/);
  assert.equal(parts.command, executable);
  assert.equal(parts.shell, false);
});

for (const extension of ['cmd', 'bat']) {
  test(`explicit Windows ${extension} path preserves metacharacter arguments without injection`, { skip: process.platform !== 'win32' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `Claude CLI ${extension} `));
    const capture = path.join(root, 'capture.cjs');
    const output = path.join(root, 'args.json');
    const marker = path.join(root, 'injected.txt');
    const wrapper = path.join(root, `claude.${extension}`);
    fs.writeFileSync(capture, `require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n`);
    fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
    const args = [output, 'space value', 'quote"value', 'amp&ersand', 'pipe|value', '(paren)', '100%literal%', 'caret^value', `blocked&echo injected>"${marker}"`];
    const result = run(launch.claudeSpawnParts(wrapper, args));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), args.slice(1));
    assert.equal(fs.existsSync(marker), false);
  });
}

test('unsafe or ambiguous executable strings are rejected before process creation', () => {
  for (const command of ['', ' claude', 'claude ', 'claude\ncalc', 'claude&calc', '"claude"']) {
    assert.throws(() => launch.claudeSpawnParts(command, []), /empty|ambiguous|unsafe|Bare Claude/i);
  }
});

test('relative path-like Claude commands are rejected on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const relative = platform === 'win32' ? '.\\bin\\claude.cmd' : './bin/claude';
    assert.throws(() => launch.validateExecutable(relative, platform), /must be absolute/i);
  }
});

test('known missing explicit and bare Claude executables fail availability preflight', () => {
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-claude-parent-'));
  fs.rmSync(missing, { recursive: true, force: true });
  for (const extension of ['cjs', 'exe', 'cmd', 'bat']) {
    assert.throws(() => launch.assertExecutableAvailable(`${missing}.${extension}`), /not available/i);
  }
  assert.throws(() => launch.assertExecutableAvailable('missing-claude-command-for-toolkit-test', { env: { PATH: '' } }), /not available/i);
});

function createSymlinkOrSkip(t, target, link, type = 'file') {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('official-style bare Claude symlink uses its stable launcher path and follows safe target changes', { skip: process.platform === 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'official-claude-symlink-'));
  const bin = path.join(root, '.local', 'bin');
  const versions = path.join(root, '.local', 'share', 'claude', 'versions');
  const version = path.join(versions, '2.1.207');
  const nextVersion = path.join(versions, '2.1.208');
  const link = path.join(bin, 'claude');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(versions, { recursive: true });
  fs.writeFileSync(version, '#!/bin/sh\nprintf 2.1.207\n');
  fs.writeFileSync(nextVersion, '#!/bin/sh\nprintf 2.1.208\n');
  fs.chmodSync(version, 0o755);
  fs.chmodSync(nextVersion, 0o755);
  if (!createSymlinkOrSkip(t, version, link)) return;
  const command = launch.assertExecutableAvailable('claude', { env: { PATH: bin } });
  assert.equal(command, link);
  let parts = launch.claudeSpawnParts(command, ['--version']);
  assert.equal(parts.command, link);
  assert.equal(parts.raw_executable, link);
  assert.notEqual(parts.command, version);
  assert.equal(run(parts).stdout, '2.1.207');
  fs.unlinkSync(link);
  fs.symlinkSync(nextVersion, link);
  parts = launch.claudeSpawnParts(command, ['--version']);
  assert.equal(parts.command, link);
  assert.equal(run(parts).stdout, '2.1.208');
});

test('canonical Claude command precedence includes every supported override', () => {
  const env = {
    AI_AGENT_TOOLKIT_CLAUDE_CLI: 'ai-env',
    CLAUDE_TOOLKIT_CLAUDE_CLI: 'toolkit-env',
    CLAUDE_CLI_PATH: 'legacy-env',
  };
  assert.deepEqual(launch.claudeCommandCandidates({ explicit: 'explicit', persisted: 'persisted', env }), [
    'explicit', 'ai-env', 'toolkit-env', 'legacy-env', 'persisted', 'claude',
  ]);
  assert.equal(launch.resolveClaudeCommandInput({ explicit: 'explicit', persisted: 'persisted', env }), 'explicit');
  assert.equal(launch.resolveClaudeCommandInput({ persisted: 'persisted', env }), 'ai-env');
  delete env.AI_AGENT_TOOLKIT_CLAUDE_CLI;
  assert.equal(launch.resolveClaudeCommandInput({ persisted: 'persisted', env }), 'toolkit-env');
  delete env.CLAUDE_TOOLKIT_CLAUDE_CLI;
  assert.equal(launch.resolveClaudeCommandInput({ persisted: 'persisted', env }), 'legacy-env');
  delete env.CLAUDE_CLI_PATH;
  assert.equal(launch.resolveClaudeCommandInput({ persisted: 'persisted', env }), 'persisted');
  assert.equal(launch.resolveClaudeCommandInput({ env: {} }), 'claude');
});

for (const pathPrefix of ['', '.', 'relative-bin']) {
  test(`POSIX bare Claude ignores ${pathPrefix || 'an empty'} PATH component and executes the verified absolute candidate`, { skip: process.platform === 'win32' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-posix-shadow-'));
    const trusted = path.join(root, 'trusted');
    const cwd = path.join(root, 'project');
    const relative = path.join(cwd, 'relative-bin');
    fs.mkdirSync(trusted);
    fs.mkdirSync(cwd);
    fs.mkdirSync(relative);
    const output = path.join(root, 'winner.txt');
    const capture = path.join(root, 'capture.cjs');
    fs.writeFileSync(capture, `require('node:fs').writeFileSync(process.argv[2], 'trusted');\n`);
    fs.copyFileSync(process.execPath, path.join(trusted, 'claude'));
    fs.chmodSync(path.join(trusted, 'claude'), 0o755);
    const shadow = pathPrefix === 'relative-bin' ? path.join(relative, 'claude') : path.join(cwd, 'claude');
    fs.writeFileSync(shadow, `#!/bin/sh\nprintf shadow > ${JSON.stringify(path.join(root, 'shadow-ran.txt'))}\n`);
    fs.chmodSync(shadow, 0o755);
    const env = { ...process.env, PATH: `${pathPrefix}:${trusted}` };
    const resolved = launch.assertExecutableAvailable('claude', { env, cwd });
    assert.equal(resolved, path.join(trusted, 'claude'));
    const parts = launch.claudeSpawnParts('claude', [capture, output], { env, cwd });
    assert.equal(parts.command, resolved);
    run(parts, { cwd, env });
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted');
    assert.equal(fs.existsSync(path.join(root, 'shadow-ran.txt')), false);
  });
}

test('a verified launcher candidate fails closed if it disappears or becomes non-executable', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-replaced-candidate-'));
  const candidate = path.join(root, 'claude');
  fs.copyFileSync(process.execPath, candidate);
  fs.chmodSync(candidate, 0o755);
  assert.equal(launch.assertExecutableAvailable('claude', { env: { PATH: root } }), candidate);
  fs.unlinkSync(candidate);
  assert.throws(() => launch.claudeSpawnParts(candidate, []), /not available/i);
  fs.writeFileSync(candidate, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(candidate, 0o644);
  assert.throws(() => launch.claudeSpawnParts(candidate, []), /not available/i);
});

test('explicit valid executable symlink passes while preserving its original path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explicit-claude-symlink-'));
  const target = path.join(root, process.platform === 'win32' ? 'claude-target.exe' : 'claude-target');
  const link = path.join(root, process.platform === 'win32' ? 'claude.exe' : 'claude');
  fs.copyFileSync(process.execPath, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  if (!createSymlinkOrSkip(t, target, link)) return;
  assert.equal(launch.assertExecutableAvailable(link), link);
  assert.equal(launch.claudeSpawnParts(link, ['--version']).raw_executable, link);
});

test('broken, cyclic, directory and non-executable symlink targets refuse availability', { skip: process.platform === 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-claude-symlink-'));
  const broken = path.join(root, 'broken');
  if (!createSymlinkOrSkip(t, path.join(root, 'missing'), broken)) return;
  assert.throws(() => launch.assertExecutableAvailable(broken), /not available/i);

  const cycleA = path.join(root, 'cycle-a');
  const cycleB = path.join(root, 'cycle-b');
  fs.symlinkSync(cycleB, cycleA);
  fs.symlinkSync(cycleA, cycleB);
  assert.throws(() => launch.assertExecutableAvailable(cycleA), /not available/i);

  const directory = path.join(root, 'directory');
  const directoryLink = path.join(root, 'directory-link');
  fs.mkdirSync(directory);
  fs.symlinkSync(directory, directoryLink, 'dir');
  assert.throws(() => launch.assertExecutableAvailable(directoryLink), /not available/i);

  const nonExecutable = path.join(root, 'non-executable');
  const nonExecutableLink = path.join(root, 'non-executable-link');
  fs.writeFileSync(nonExecutable, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(nonExecutable, 0o644);
  fs.symlinkSync(nonExecutable, nonExecutableLink);
  assert.throws(() => launch.assertExecutableAvailable(nonExecutableLink), /not available/i);
});

test('valid JavaScript executable paths remain available through the Node launcher', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-js-launchers-'));
  for (const extension of ['js', 'cjs', 'mjs']) {
    const executable = path.join(root, `claude.${extension}`);
    fs.writeFileSync(executable, 'process.exit(0);\n');
    assert.equal(launch.assertExecutableAvailable(executable), executable);
    assert.equal(launch.claudeSpawnParts(executable, []).command, process.execPath);
  }
});

test('Windows bare Claude resolves only from PATH and cannot be shadowed by cwd', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-path-shadow-'));
  const trusted = path.join(root, 'trusted');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(trusted);
  fs.mkdirSync(cwd);
  const capture = path.join(root, 'capture.cjs');
  const output = path.join(root, 'winner.txt');
  const shadowMarker = path.join(root, 'shadow-ran.txt');
  fs.writeFileSync(capture, `require('node:fs').writeFileSync(process.argv[2], 'trusted');\n`);
  fs.writeFileSync(path.join(trusted, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
  fs.writeFileSync(path.join(cwd, 'claude.cmd'), `@echo off\r\necho shadow>"${shadowMarker}"\r\n`);
  const env = { ...process.env, PATH: trusted, Path: trusted, PATHEXT: '.CMD' };
  const resolved = launch.assertExecutableAvailable('claude', { env, cwd });
  assert.equal(resolved, path.join(trusted, 'claude.CMD'));
  run(launch.claudeSpawnParts('claude', [output], { env, cwd }), { cwd, env });
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted');
  assert.equal(fs.existsSync(shadowMarker), false);
});

test('Windows cwd shadow cannot satisfy an empty PATH', { skip: process.platform !== 'win32' }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-empty-path-shadow-'));
  fs.writeFileSync(path.join(cwd, 'claude.cmd'), '@echo off\r\nexit /b 0\r\n');
  assert.throws(() => launch.assertExecutableAvailable('claude', { env: { PATH: '', Path: '', PATHEXT: '.CMD' }, cwd }), /not available/i);
});
