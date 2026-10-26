'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// Agents launch setup through whatever shell the host picks: Codex on Windows usually runs
// PowerShell but can fall back to cmd.exe. The agent route therefore runs the managed script by its
// resolved full path, in forward slashes inside double quotes, with no environment variables, from
// the chat's own folder (setup uses that folder to find the user's own Toolkit clone). That line
// starts the same way in both shells. The old PowerShell-only line fails through cmd.exe.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const AGENT_COMMAND = 'node "<home folder>/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main';
const OLD_POWERSHELL_LINE = 'node "$env:USERPROFILE\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\setup-toolkit.cjs" --execute --profile auto-main';
const windowsOnly = { skip: process.platform !== 'win32' && 'cmd.exe and Windows PowerShell exist only on Windows' };

// Launches a command line the way a host's shell tool does.
function viaCmd(line, options) {
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 60000 });
}
function viaPowerShell(line, options) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], { ...options, encoding: 'utf8', windowsHide: true, timeout: 60000 });
}
function bothShells(line, options) {
  return [['cmd.exe', viaCmd(line, options)], ['PowerShell', viaPowerShell(line, options)]];
}
const forwardSlashes = (value) => value.split(path.sep).join('/');

// A home folder with a space whose managed checkout holds a stand-in setup script that prints its
// arguments and the folder it was started in, plus a separate chat folder that also has a space.
function fakeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-launch-'));
  const home = path.join(root, 'home folder');
  const chat = path.join(root, 'chat folder');
  const script = path.join(home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'setup-toolkit.cjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.mkdirSync(chat);
  fs.writeFileSync(script, "console.log('STAND-IN SETUP ' + process.argv.slice(2).join(' ') + ' FROM ' + require('path').basename(process.cwd()));\n", 'utf8');
  return { root, home, chat, env: { ...process.env, USERPROFILE: home } };
}

test('the agent setup line starts the real setup script by full path from another folder through cmd.exe and PowerShell', windowsOnly, () => {
  const { root, chat } = fakeHome();
  try {
    const line = `node "${forwardSlashes(repoRoot)}/repo/scripts/setup-toolkit.cjs" --help`;
    for (const [shell, result] of bothShells(line, { cwd: chat })) {
      assert.equal(result.error, undefined, `${shell}: ${result.error && result.error.message}`);
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.match(result.stdout, /AI Agent Toolkit setup orchestrator/, shell);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the exact agent setup line reaches the managed script under a home folder with a space and keeps the chat folder', windowsOnly, () => {
  const { root, home, chat, env } = fakeHome();
  try {
    const line = AGENT_COMMAND.replace('<home folder>', forwardSlashes(home));
    assert.match(line, /home folder\/\.ai-agent-toolkit/);
    for (const [shell, result] of bothShells(line, { cwd: chat, env })) {
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.equal(result.stdout.trim(), 'STAND-IN SETUP --execute --profile auto-main FROM chat folder', shell);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the old PowerShell-only setup line works in PowerShell but fails through cmd.exe', windowsOnly, () => {
  const { root, chat, env } = fakeHome();
  try {
    const powerShell = viaPowerShell(OLD_POWERSHELL_LINE, { cwd: chat, env });
    assert.equal(powerShell.status, 0, powerShell.stderr);
    assert.equal(powerShell.stdout.trim(), 'STAND-IN SETUP --execute --profile auto-main FROM chat folder');

    const cmd = viaCmd(OLD_POWERSHELL_LINE, { cwd: chat, env });
    assert.notEqual(cmd.status, 0);
    assert.doesNotMatch(cmd.stdout, /STAND-IN SETUP/);
    assert.match(cmd.stderr, /Cannot find module/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Every place that tells an agent how to launch setup gives the quoted full-path line.
const AGENT_ROUTES = [
  'skills/toolkit-setup/SKILL.md',
  'skills/toolkit-setup/README.md',
  'repo/docs/FOR_AI_AGENTS.md',
  'repo/docs/HOW-TO-USE.md',
  'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
  'repo/scripts/setup-toolkit-core.cjs'
];
const SHELL_VARIABLE_COMMAND = /(?:node|--codex-cli)\s+"?(?:\$env:|%USERPROFILE%)/i;

test('agent setup routes use the quoted full-path line, keep the chat folder and put no shell variables in it', () => {
  for (const relPath of AGENT_ROUTES) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.ok(text.includes(AGENT_COMMAND), `${relPath} gives the quoted full-path setup line`);
    assert.doesNotMatch(text, /working folder\)? to the managed checkout|`workdir` or `cwd`/i, `${relPath} must not move the working folder to the managed checkout`);
  }
  const help = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit.cjs'), '--help'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /\$env:|%USERPROFILE%/);

  for (const relPath of ['skills/toolkit-setup/SKILL.md', 'skills/toolkit-setup/README.md', 'repo/docs/FOR_AI_AGENTS.md', 'skills/toolkit-env/SKILL.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'), SHELL_VARIABLE_COMMAND, relPath);
  }
  // Setup reads the user's own clone and project instructions from the folder it starts in.
  for (const relPath of ['skills/toolkit-setup/SKILL.md', 'skills/toolkit-setup/README.md', 'repo/docs/FOR_AI_AGENTS.md']) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /never `cd` first/, relPath);
    assert.match(text, /the chat's own folder/, relPath);
  }
  const howToUseStep = fs.readFileSync(path.join(repoRoot, 'repo/docs/HOW-TO-USE.md'), 'utf8').split(/\r?\n/).find((line) => line.includes('say `setup toolkit`'));
  assert.ok(howToUseStep);
  assert.doesNotMatch(howToUseStep, /\$env:|%USERPROFILE%/);

  const bridge = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  const agentParagraph = bridge.match(/agents must run the full script-backed journey[\s\S]*?The orchestrator discovers/);
  assert.ok(agentParagraph, 'the bridge guide keeps its agent setup paragraph');
  assert.doesNotMatch(agentParagraph[0], SHELL_VARIABLE_COMMAND);
  assert.match(agentParagraph[0], /never `cd` first/);
});

test('toolkit env tells agents to run its script by quoted full path with no shell variables', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'skills/toolkit-env/SKILL.md'), 'utf8');
  assert.ok(text.includes('`node "<home folder>/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs" <command>`'));
  assert.match(text, /never `cd` first/);
});

test('PowerShell blocks people type themselves stay and are labelled', () => {
  const bridge = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(bridge, /Enable or refresh the managed-main setup yourself, typing it in PowerShell:\r?\n\r?\n```powershell\r?\nnode "\$env:USERPROFILE/);
  assert.match(bridge, /explicit trusted checkout \(PowerShell, for a person to type\):\r?\n\r?\n```powershell\r?\n/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'repo/docs/HOW-TO-USE.md'), 'utf8'), /managed clean Toolkit checkout \(PowerShell, for a person to type\):\r?\n\r?\n```powershell\r?\n/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-ENV.md'), 'utf8'), /To run one yourself in PowerShell:\r?\n\r?\n```powershell\r?\nnode "\$env:USERPROFILE/);
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(readme, /\*\*Global rules\*\* \(PowerShell\): `node "\$env:USERPROFILE/);
  assert.match(readme, /\*\*Automatic updates\*\* \(PowerShell\): `node "\$env:USERPROFILE/);
});
