'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// Agents launch setup through whatever shell the host picks: Codex on Windows usually runs
// PowerShell but can fall back to cmd.exe. The agent route therefore sets the working folder to
// the managed checkout and runs a command with no quotes and no environment variables, which
// starts the same way in both shells. The old PowerShell-only line fails through cmd.exe.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const AGENT_COMMAND = 'node repo/scripts/setup-toolkit.cjs --execute --profile auto-main';
const OLD_POWERSHELL_LINE = 'node "$env:USERPROFILE\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\setup-toolkit.cjs" --execute --profile auto-main';
const windowsOnly = { skip: process.platform !== 'win32' && 'cmd.exe and Windows PowerShell exist only on Windows' };

// Launches a command line the way a host's shell tool does.
function viaCmd(line, options) {
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 60000 });
}
function viaPowerShell(line, options) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], { ...options, encoding: 'utf8', windowsHide: true, timeout: 60000 });
}

// A home folder whose managed checkout holds a stand-in setup script that prints its arguments.
function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-launch-'));
  const checkout = path.join(home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  fs.mkdirSync(path.join(checkout, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'repo', 'scripts', 'setup-toolkit.cjs'), "console.log('STAND-IN SETUP ' + process.argv.slice(2).join(' '));\n", 'utf8');
  return { home, checkout, env: { ...process.env, USERPROFILE: home } };
}

test('the agent setup command starts the real setup script from the checkout folder through cmd.exe and PowerShell', windowsOnly, () => {
  const line = 'node repo/scripts/setup-toolkit.cjs --help';
  for (const [shell, result] of [['cmd.exe', viaCmd(line, { cwd: repoRoot })], ['PowerShell', viaPowerShell(line, { cwd: repoRoot })]]) {
    assert.equal(result.error, undefined, `${shell}: ${result.error && result.error.message}`);
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
    assert.match(result.stdout, /AI Agent Toolkit setup orchestrator/, shell);
  }
});

test('the exact agent setup command reaches the managed checkout script through cmd.exe and PowerShell', windowsOnly, () => {
  const { home, checkout, env } = fakeHome();
  try {
    for (const [shell, result] of [['cmd.exe', viaCmd(AGENT_COMMAND, { cwd: checkout, env })], ['PowerShell', viaPowerShell(AGENT_COMMAND, { cwd: checkout, env })]]) {
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.equal(result.stdout.trim(), 'STAND-IN SETUP --execute --profile auto-main', shell);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the old PowerShell-only setup line works in PowerShell but fails through cmd.exe', windowsOnly, () => {
  const { home, env } = fakeHome();
  try {
    const powerShell = viaPowerShell(OLD_POWERSHELL_LINE, { cwd: home, env });
    assert.equal(powerShell.status, 0, powerShell.stderr);
    assert.equal(powerShell.stdout.trim(), 'STAND-IN SETUP --execute --profile auto-main');

    const cmd = viaCmd(OLD_POWERSHELL_LINE, { cwd: home, env });
    assert.notEqual(cmd.status, 0);
    assert.doesNotMatch(cmd.stdout, /STAND-IN SETUP/);
    assert.match(cmd.stderr, /Cannot find module/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Every place that tells an agent how to launch setup or toolkit env uses the working-folder form.
const AGENT_ROUTES = [
  'skills/toolkit-setup/SKILL.md',
  'skills/toolkit-setup/README.md',
  'repo/docs/FOR_AI_AGENTS.md',
  'repo/docs/HOW-TO-USE.md',
  'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
  'repo/scripts/setup-toolkit-core.cjs'
];

test('agent setup routes use the working-folder command and no shell variables in it', () => {
  for (const relPath of AGENT_ROUTES) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.ok(text.includes(AGENT_COMMAND), `${relPath} gives the working-folder setup command`);
    assert.match(text, /working folder/i, relPath);
  }
  const help = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit.cjs'), '--help'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /\$env:|%USERPROFILE%/);

  // The agent-facing lines never put $env: or %USERPROFILE% into a node command the agent runs.
  for (const relPath of ['skills/toolkit-setup/SKILL.md', 'skills/toolkit-setup/README.md', 'repo/docs/FOR_AI_AGENTS.md', 'skills/toolkit-env/SKILL.md']) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.doesNotMatch(text, /node\s+"?(?:\$env:|%USERPROFILE%)/i, relPath);
    assert.doesNotMatch(text, /--codex-cli\s+"?(?:\$env:|%USERPROFILE%)/i, relPath);
  }
  const howToUseStep = fs.readFileSync(path.join(repoRoot, 'repo/docs/HOW-TO-USE.md'), 'utf8').split(/\r?\n/).find((line) => line.includes('say `setup toolkit`'));
  assert.ok(howToUseStep);
  assert.doesNotMatch(howToUseStep, /\$env:|%USERPROFILE%/);
});

test('toolkit env tells agents to run from the checkout folder with no shell variables', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'skills/toolkit-env/SKILL.md'), 'utf8');
  assert.match(text, /working folder to `<home folder>\/\.ai-agent-toolkit\/source\/ai-agent-toolkit`/);
  assert.match(text, /run `node repo\/scripts\/toolkit-env\.cjs <command>`/);
});

test('PowerShell blocks people type themselves stay and are labelled', () => {
  const bridge = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(bridge, /Enable or refresh the managed-main setup yourself in PowerShell with:\r?\n\r?\n```powershell\r?\nnode "\$env:USERPROFILE/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-ENV.md'), 'utf8'), /To run one yourself in PowerShell:\r?\n\r?\n```powershell\r?\nnode "\$env:USERPROFILE/);
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(readme, /\*\*Global rules\*\* \(PowerShell\): `node "\$env:USERPROFILE/);
  assert.match(readme, /\*\*Automatic updates\*\* \(PowerShell\): `node "\$env:USERPROFILE/);
});
