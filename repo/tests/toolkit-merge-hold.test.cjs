'use strict';

// The merge hold: an agent merges a pull request only after the user typed "merge N" for it.
// Every case uses a temporary user-state folder and a temporary git repository.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const hold = require('../scripts/toolkit-merge-hold.cjs');
const claudeHook = require('../scripts/toolkit-governance-hook.cjs');

function context(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-merge-hold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/owner/project.git']);
  return { root, repo, options: { registryOptions: { registryPath, testOnly: true } }, file: path.join(path.dirname(registryPath), hold.APPROVALS_BASENAME) };
}

const SHA = '62405ebd4c27859d66036e18f13c856c645d366d';
const bash = (cwd, command) => ({ cwd, tool_name: 'Bash', tool_input: { command } });
const connector = (tool, args) => ({ cwd: os.tmpdir(), tool_name: `mcp__github__${tool}`, tool_input: { owner: 'owner', repo: 'project', ...args } });
const typed = (ctx, prompt, extra = {}) => hold.recordPrompt({ cwd: ctx.repo, prompt, session_id: 'user', ...extra }, { environment: {}, ...ctx.options });

test('the approvals in a typed message: numbers, lists and an optional SHA; questions and refusals are not approvals', () => {
  const cases = [
    ['merge 618', [[618, null]]],
    ['merge #618', [[618, null]]],
    ['yes merge 601, 605 and 609', [[601, null], [605, null], [609, null]]],
    ['merge 618 at 62405eb', [[618, '62405eb']]],
    ['1. merge 612\n2. hold 613', [[612, null]]],
    ["don't merge 618", []],
    ['do not merge 618 yet', []],
    ['should we merge 618?', []],
    ['hold off, we merge 618 after the test', []],
    ['merge conflicts again', []],
  ];
  for (const [text, expected] of cases) assert.deepEqual(hold.approvalsIn(text).map(({ pr, sha }) => [pr, sha]), expected, text);
});

test('every merge route is refused without the user typing "merge N"', (t) => {
  const ctx = context(t);
  const routes = [
    bash(ctx.repo, `gh pr merge 618 --merge --match-head-commit ${SHA}`),
    bash(ctx.repo, 'gh pr merge 618 --auto --merge'),
    bash(ctx.repo, 'gh pr merge https://github.com/owner/project/pull/618 --merge'),
    bash(ctx.repo, 'bash -c "gh pr merge 618 --merge"'),
    bash(ctx.repo, `gh api -X PUT repos/owner/project/pulls/618/merge -f sha=${SHA}`),
    bash(ctx.repo, 'gh api graphql -f query=\'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\''),
    connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }),
    connector('enable_pr_auto_merge', { pullNumber: 618 }),
  ];
  for (const input of routes) assert.match(hold.decide(input, ctx.options)?.deny || '', /^Toolkit: /, input.tool_input.command || input.tool_name);
  assert.equal(hold.decide(bash(ctx.repo, 'gh pr view 618'), ctx.options), null);
  assert.equal(hold.decide(bash(ctx.repo, 'git merge origin/main'), ctx.options), null, 'a local git merge is not a pull request merge');
  assert.equal(hold.decide(connector('pull_request_read', { pullNumber: 618 }), ctx.options), null);
});

test('a typed "merge N" allows one merge of that pull request, in that repository, naming its head commit', (t) => {
  const ctx = context(t);
  assert.equal(typed(ctx, 'merge 618'), 1);
  assert.match(hold.decide(connector('merge_pull_request', { pullNumber: 619, expectedHeadSha: SHA }), ctx.options).deny, /"merge 619"/, 'another number');
  assert.match(hold.decide({ ...connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), tool_input: { owner: 'other', repo: 'project', pullNumber: 618, expectedHeadSha: SHA } }, ctx.options).deny, /"merge 618"/, 'another repository');
  assert.match(hold.decide(connector('merge_pull_request', { pullNumber: 618 }), ctx.options).deny, /expectedHeadSha/, 'no head commit named');
  assert.equal(hold.decide(connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), ctx.options), null);
  assert.match(hold.decide(connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), ctx.options).deny, /"merge 618"/, 'the approval is used up');
  typed(ctx, 'merge 618');
  assert.equal(hold.decide(bash(ctx.repo, `gh pr merge 618 --merge --match-head-commit ${SHA}`), ctx.options), null, 'gh in the repository folder');
});

test('a typed SHA must match the merged head commit', (t) => {
  const ctx = context(t);
  typed(ctx, 'merge 618 at 62405eb');
  assert.match(hold.decide(connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: 'a'.repeat(40) }), ctx.options).deny, /approved .* at 62405eb/);
  assert.equal(hold.decide(connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), ctx.options), null);
});

test('an approval lasts a day', (t) => {
  const ctx = context(t);
  const start = Date.parse('2026-10-25T10:00:00Z');
  hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 618', session_id: 'user' }, { environment: {}, ...ctx.options, now: () => new Date(start) });
  const later = { ...ctx.options, now: () => new Date(start + hold.MAX_AGE_MS + 1000) };
  assert.match(hold.decide(connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), later).deny, /"merge 618"/);
});

test('a session another session or a launcher started records no approval', (t) => {
  const ctx = context(t);
  const launchedBy = [{ TOOLKIT_HOST_SESSION: 'parent' }, { TOOLKIT_GATE_ROLE: 'G1' }];
  for (const environment of launchedBy) {
    assert.equal(hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 618', session_id: 'child' }, { environment, ...ctx.options }), 0);
  }
  assert.equal(fs.existsSync(ctx.file), false);
});

test('an agent cannot write an approval for itself through the shell', (t) => {
  const ctx = context(t);
  for (const command of [`echo x > "${ctx.file}"`, 'cat ~/.ai-agent-toolkit/user-state/merge-approvals.v1.json']) {
    assert.match(hold.decide(bash(ctx.repo, command), ctx.options).deny, /user-state files/, command);
  }
});

test('an unreadable approvals store refuses the merge', (t) => {
  const ctx = context(t);
  fs.mkdirSync(ctx.file, { recursive: true });
  assert.throws(() => hold.decide(connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), ctx.options), /MERGE_APPROVALS_UNREADABLE/);
  const output = claudeHook.respond('PreToolUse', connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }), { environment: {}, ...ctx.options });
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /merge check failed/);
});

test('the Claude Code hook records the typed approval and enforces it; cloud sessions are not covered', (t) => {
  const ctx = context(t);
  const merge = connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA });
  const refused = claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options });
  assert.equal(refused.hookSpecificOutput.permissionDecision, 'deny');
  claudeHook.respond('UserPromptSubmit', { cwd: ctx.root, prompt: 'merge 618', session_id: 'user' }, { environment: {}, ...ctx.options });
  assert.deepEqual(claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options }), {});
  assert.deepEqual(claudeHook.respond('PreToolUse', merge, { environment: { CLAUDE_CODE_REMOTE: 'true' }, ...ctx.options }), {});
});

test('both hook files send merge tools and shell commands to the merge hold', () => {
  const root = path.resolve(__dirname, '..', '..');
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const governanceEntry = claude.find(entry => entry.hooks.some(hook => hook.command.includes('toolkit-governance-hook.cjs')));
  for (const tool of ['Bash', 'PowerShell', 'mcp__github__merge_pull_request', 'mcp__github__enable_pr_auto_merge']) assert.match(tool, new RegExp(governanceEntry.matcher), tool);
  const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  for (const tool of ['Bash', 'mcp__github__merge_pull_request']) assert.ok(codex.some(entry => new RegExp(entry.matcher).test(tool) && entry.hooks.some(hook => hook.command.includes('toolkit-codex-helper-hook.cjs'))), tool);
});
