'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs');
const { mayCarryAttribution, CHECK_FAILED_REASON } = require('../scripts/toolkit-claude-attribution-hook.cjs');

// A copy of the hook beside a guard module that is missing or throws, run as Claude Code runs it.
function brokenHook(t, guardSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-attribution-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(HOOK, path.join(dir, 'toolkit-claude-attribution-hook.cjs'));
  if (guardSource !== null) fs.writeFileSync(path.join(dir, 'toolkit-attribution-guard.cjs'), guardSource);
  return command => spawnSync(process.execPath, [path.join(dir, 'toolkit-claude-attribution-hook.cjs')],
    { input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }), encoding: 'utf8' });
}

const GUARDED = ['git commit -m "Fix"', 'git -C sub commit -F msg.txt', 'gh pr create --title x --body y', 'gh pr edit 5 --body y', 'gh pr merge 5'];
const OTHER = ['git status', 'npm test', 'gh pr view 5', 'git log --oneline', 'echo commit'];

test('A23: when the attribution check cannot run, only commit and pull request commands are refused, with a plain reason', t => {
  for (const [label, source] of [['missing guard', null], ['guard throws on load', 'throw new Error("broken");\n'],
    ['guard throws on call', 'module.exports = { attributionDecision() { throw new Error("broken"); } };\n']]) {
    const run = brokenHook(t, source);
    for (const command of GUARDED) {
      const result = run(command);
      assert.equal(result.status, 2, `${label}: ${command}`);
      const decision = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(decision.permissionDecision, 'deny');
      assert.equal(decision.permissionDecisionReason, CHECK_FAILED_REASON);
      assert.equal(result.stderr.trim(), CHECK_FAILED_REASON);
    }
    for (const command of OTHER) {
      const result = run(command);
      assert.equal(result.status, 0, `${label}: ${command}`);
      assert.equal(result.stdout, '', `${label}: ${command}`);
    }
  }
});

test('A23: the fallback screen is broader than the guard, never narrower', () => {
  for (const command of [...GUARDED, 'git commit', 'git -c x=y commit --amend', 'gh  pr  create']) assert.ok(mayCarryAttribution(command), command);
  for (const command of OTHER) assert.equal(mayCarryAttribution(command), false, command);
});

test('A23: the hook stays registered without onFailure block, so a hook that cannot start never stops other shell commands', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const shell = claude.hooks.PreToolUse.find(group => group.matcher === 'Bash|PowerShell');
  assert.equal(shell.hooks.length, 1);
  assert.equal(Object.hasOwn(shell.hooks[0], 'onFailure') ? shell.hooks[0].onFailure : 'continue', 'continue');
});
