'use strict';

// On Windows, Node looks in the current folder before PATH for a bare program name, so a git.exe
// planted in the working folder would run. Toolkit resolves git and codex from PATH instead.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { resolvePathExecutable } = require('../scripts/claude-process-launch.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const launchModule = path.join(repoRoot, 'repo', 'scripts', 'claude-process-launch.cjs');

test('a git.exe planted in the working folder does not run; the PATH copy does', { skip: process.platform !== 'win32' }, (t) => {
  const plant = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-planted-git-'));
  t.after(() => fs.rmSync(plant, { recursive: true, force: true }));
  // The planted git.exe is a copy of node.exe, so running it prints a Node version, not "git version".
  try { fs.linkSync(process.execPath, path.join(plant, 'git.exe')); } catch { fs.copyFileSync(process.execPath, path.join(plant, 'git.exe')); }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[key];
  const probe = `const { spawnSync } = require('node:child_process');
const launch = require(${JSON.stringify(launchModule)});
const run = (command) => String(spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout || '').trim();
console.log(JSON.stringify({ bare: run('git'), resolved: run(launch.resolvePathExecutable('git')) }));`;
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: plant, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.match(seen.bare, /^v\d+\./, 'control: a bare name does reach the planted copy');
  assert.match(seen.resolved, /^git version /);
});

test('the local clone step runs git from PATH, not from the folder setup was started in', { skip: process.platform !== 'win32' }, (t) => {
  const plant = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-planted-clone-git-'));
  t.after(() => fs.rmSync(plant, { recursive: true, force: true }));
  try { fs.linkSync(process.execPath, path.join(plant, 'git.exe')); } catch { fs.copyFileSync(process.execPath, path.join(plant, 'git.exe')); }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath' || key === 'AI_AGENT_TOOLKIT_SETUP_START_FOLDER') delete env[key];
  const probe = `const childProcess = require('node:child_process');
const seen = [];
const real = childProcess.spawnSync;
childProcess.spawnSync = (command, ...rest) => { seen.push(String(command)); return real(command, ...rest); };
const core = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit-core.cjs'))});
core.fastForwardLocalClone({ repoRoot: 'C:\\\\nowhere', repoRemote: 'https://example.invalid/x.git', repoBranch: 'main' });
console.log(JSON.stringify(seen));`;
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: plant, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.ok(seen.length > 0);
  for (const command of seen) assert.match(command, /^[A-Za-z]:\\.*\\git\.exe$/i, command);
  assert.ok(seen.every((command) => !command.toLowerCase().startsWith(plant.toLowerCase())));
});

test('PATH resolution skips relative PATH entries and returns the .exe', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-path-exe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'tool.exe'), '');
  fs.writeFileSync(path.join(bin, 'tool.cmd'), '');
  assert.equal(resolvePathExecutable('tool', { env: { PATH: `.;bin;${bin}` } }), path.join(bin, 'tool.exe'));
  assert.equal(resolvePathExecutable('tool', { env: { PATH: `"${bin}"` } }), path.join(bin, 'tool.exe'), 'a quoted PATH entry counts');
  assert.throws(() => resolvePathExecutable('tool', { env: { PATH: '.;bin' } }), /not available/);
  assert.equal(resolvePathExecutable('tool', { platform: 'linux' }), 'tool');
});

test('the fixed sites no longer start git or codex by a bare name', () => {
  for (const file of ['setup-claude-toolkit-plugin.cjs', 'repo-ignore-hygiene.cjs', 'toolkit-capability-registry.cjs', 'toolkit-local-bridge.cjs']) {
    const text = fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', file), 'utf8');
    assert.doesNotMatch(text, /spawnSync\('git'/, file);
    assert.match(text, /resolvePathExecutable\('git'\)/, file);
    assert.doesNotMatch(text, /runCommand\('git'/, file);
  }
  const core = fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit-core.cjs'), 'utf8');
  assert.match(core, /spawnSync\(command === 'git' \? processLaunch\.resolvePathExecutable\('git'\) : command,/);
  const codex = fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), 'utf8');
  assert.doesNotMatch(codex, /candidates\.push\('codex'\)/);
  assert.match(codex, /resolvePathExecutable\('codex'/);
});
