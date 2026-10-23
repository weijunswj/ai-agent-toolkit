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
