'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { attributionRefusal, attributionDecision, MESSAGE } = require('../scripts/toolkit-attribution-guard.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const trailer = 'Co-Authored-By: Claude <noreply@anthropic.com>';

test('every attribution form in git commit and gh pr create/edit is refused', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-attribution-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'msg.txt'), `Fix the thing\n\n${trailer}\n`);
  fs.writeFileSync(path.join(dir, 'body.md'), 'Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'msg.txt'), `Fix\n\n${trailer}\n`);
  fs.writeFileSync(path.join(dir, 'msg.txt'), `Fix the thing\n\n${trailer}\n`);
  for (const command of [
    `git commit -m "Fix the thing" -m "${trailer}"`,
    `git commit --amend -m "Fix\n\nClaude-Session: https://claude.ai/code/session_01ABC"`,
    'git commit -F msg.txt',
    'git commit --file=msg.txt',
    `git commit -F - <<'EOF'\nFix the thing\n\n${trailer}\nEOF`,
    'gh pr create --title "x" --body "See https://claude.ai/code/session_01XYZ for the run"',
    'gh pr edit 12 --body-file body.md',
    'gh pr create --title x --body-file=body.md',
    'cd repo && git -c core.editor=true commit -m "x\n\nGenerated with Claude Code"',
    'git commit -Fmsg.txt',
    `gh pr merge 12 --squash --body "${trailer}"`,
    'gh pr merge 12 --body-file body.md',
    `git -C sub commit -F msg.txt`
  ]) {
    assert.equal(attributionRefusal(command, dir), MESSAGE, command);
  }
});

test('ordinary commits, PRs and other commands pass, even when they mention Claude', () => {
  for (const command of [
    'git commit -m "Document how Claude Code reads AGENTS.md"',
    'gh pr create --title "Claude Code settings" --body "Adds the Claude Code settings question"',
    `echo "${trailer}"`,
    'git log --grep "Co-Authored-By: Claude"',
    'git commit -F missing-file.txt'
  ]) {
    assert.equal(attributionRefusal(command, os.tmpdir()), '', command);
  }
  assert.deepEqual(attributionDecision({ tool_input: {} }), {});
});

test('the Claude Code hook refuses with exit 2 and a deny decision, and passes everything else', () => {
  const hook = path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs');
  const refused = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: `git commit -m "x" -m "${trailer}"` } }), encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.equal(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const allowed = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } }), encoding: 'utf8' });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
  const powershell = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'PowerShell', cwd: os.tmpdir(), tool_input: { command: `git commit -m "x" -m "${trailer}"` } }), encoding: 'utf8' });
  assert.equal(powershell.status, 2);
  const unreadable = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(unreadable.status, 0);
});

test('both plugins route shell commands to the attribution check', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const bash = claude.hooks.PreToolUse.find((group) => group.matcher === 'Bash|PowerShell');
  assert.equal(bash.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-attribution-hook.cjs"');
  const codex = JSON.parse(fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(new RegExp(codex.hooks.PreToolUse[0].matcher).test('Bash'));
  const helper = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs')], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: 'gh pr create --body "Generated with Claude Code"' } }), encoding: 'utf8'
  });
  assert.equal(JSON.parse(helper.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecision, 'deny');
});
