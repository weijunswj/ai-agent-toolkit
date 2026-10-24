'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ClaudeMatrixContext, runHookCase, HOOK_CASES, OTHER_ROWS, LIVE_TOO, ROW_IDS } = require('./support/claude-helper-matrix.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

test('every launch-matrix row has exactly one kind of proof, and every row is accounted for', () => {
  const hookRows = new Set(HOOK_CASES.map(([row]) => row));
  for (const row of hookRows) assert.equal(Object.hasOwn(OTHER_ROWS, row), false, `${row} is both a hook row and another kind`);
  assert.deepEqual([...new Set([...hookRows, ...Object.keys(OTHER_ROWS)])].sort(), [...ROW_IDS].sort());
  for (const row of LIVE_TOO) assert.ok(hookRows.has(row), `${row} needs a hook case before its live proof`);
  for (const [row, entry] of Object.entries(OTHER_ROWS)) {
    assert.ok(['config', 'live', 'waits', 'other-host', 'other-test'].includes(entry.proof), row);
    if (entry.proof === 'waits') assert.ok(entry.on, `${row} names what it waits on`);
    if (entry.proof === 'other-test') assert.ok(fs.existsSync(path.join(ROOT, entry.file)), `${row}: ${entry.file}`);
  }
});

test('each hook row gives the expected decision through the real hook process', t => {
  const context = new ClaudeMatrixContext();
  t.after(() => context.remove());
  for (const entry of HOOK_CASES) {
    const verdict = runHookCase(context, entry);
    if (verdict.skipped) { t.diagnostic(`${verdict.row} ${verdict.case}: skipped, ${verdict.skipped}`); continue; }
    assert.ok(verdict.pass, `${verdict.row} ${verdict.case}: ${JSON.stringify(verdict.observed)}`);
  }
});

test('the matrix context leaves the process home alone, so the live runner keeps the user\'s login', () => {
  const home = path.join(ROOT, 'never-written-home');
  const probe = `const os = require('node:os');
    const { ClaudeMatrixContext } = require(${JSON.stringify(path.join(__dirname, 'support', 'claude-helper-matrix.cjs'))});
    const context = new ClaudeMatrixContext();
    const seen = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, homedir: os.homedir(), context: context.environment.HOME === context.home };
    context.remove();
    process.stdout.write(JSON.stringify(seen));`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', probe],
    { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { HOME: home, USERPROFILE: home, homedir: home, context: true });
});

test('A9: the agent hook blocks the launch when it fails or times out', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const agent = hooks.hooks.PreToolUse.find(group => group.matcher === 'Agent|Task');
  assert.equal(agent.hooks.length, 1);
  assert.equal(agent.hooks[0].onFailure, 'block');
  assert.match(agent.hooks[0].command, /toolkit-claude-agent-hook\.cjs/);
});

test('the live runner gives a session every tool its helpers list, so no helper starts with zero tools', () => {
  const { sessionTools } = require('./qualification/claude-helper-matrix.live.cjs');
  const tools = sessionTools({
    g0: { text: '---\nname: toolkit-g0-helper\ntools: Read, Glob, Grep\ndisallowedTools: Agent, Task\n---\n' },
    g1: { text: '---\nname: toolkit-g1-helper\ntools: Read, Glob, Grep, Bash, Edit, Write\n---\n' }
  }).split(',');
  assert.deepEqual(tools, ['Agent', 'Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write']);
});

test('installed mode picks the local Toolkit install over a claude.ai account copy', () => {
  const { pickInstalledPlugin } = require('./qualification/claude-helper-matrix.live.cjs');
  const local = { id: 'ai-agent-toolkit@ai-agent-toolkit-local', scope: 'user', enabled: true, version: '1.0.0', installPath: '/cache/tk', readFromFolder: '/src/tk' };
  const synced = { id: 'ai-agent-toolkit@synced', scope: 'synced', enabled: true, version: '0.9.0', installPath: '/synced/tk' };
  assert.equal(pickInstalledPlugin([synced, local]).root, path.resolve('/src/tk'));
  assert.equal(pickInstalledPlugin([synced]).root, path.resolve('/synced/tk'));
  assert.equal(pickInstalledPlugin([{ ...synced, installPath: '' }, local]).root, path.resolve('/src/tk'));
  assert.throws(() => pickInstalledPlugin([{ ...synced, installPath: '' }]), /ai-agent-toolkit@synced \(synced, no folder\)/);
  assert.throws(() => pickInstalledPlugin([{ ...local, enabled: false }]), /found: none/);
  assert.throws(() => pickInstalledPlugin([local, { ...local, id: 'ai-agent-toolkit@other', scope: 'project' }]), /ai-agent-toolkit@other \(project\)/);
});
