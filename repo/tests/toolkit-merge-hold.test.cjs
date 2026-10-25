'use strict';

// The merge hold, a tripwire: an agent merges a pull request only after the user typed a line with
// "merge" and its number, and never pushes to the default branch. Every case uses a temporary user-state folder and temporary
// git repositories.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const hold = require('../scripts/toolkit-merge-hold.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const claudeHook = require('../scripts/toolkit-governance-hook.cjs');

const SHA = '62405ebd4c27859d66036e18f13c856c645d366d';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

// A clone-shaped repository: origin on github.com, origin/HEAD naming main, on branch `branch`.
function repository(root, name, { slug = `owner/${name}`, branch = 'main', remoteHead = true } = {}) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', branch]);
  git(repo, ['remote', 'add', 'origin', `https://github.com/${slug}.git`]);
  const remotes = path.join(repo, '.git', 'refs', 'remotes', 'origin');
  fs.mkdirSync(remotes, { recursive: true });
  fs.writeFileSync(path.join(remotes, 'main'), `${SHA}\n`);
  if (remoteHead) fs.writeFileSync(path.join(remotes, 'HEAD'), 'ref: refs/remotes/origin/main\n');
  return repo;
}

function context(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-merge-hold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const options = { registryOptions: { registryPath, testOnly: true } };
  const repo = repository(root, 'a');
  const other = repository(root, 'b');
  return { root, repo, other, options, file: path.join(path.dirname(registryPath), hold.APPROVALS_BASENAME) };
}

const bash = (cwd, command) => ({ cwd, tool_name: 'Bash', tool_input: { command } });
const connector = (tool, args, repo = 'a') => ({ cwd: os.tmpdir(), tool_name: `mcp__github__${tool}`, tool_input: { owner: 'owner', repo, ...args } });
const decide = (ctx, input, environment = {}) => hold.decide(input, { ...ctx.options, environment });

// The user's own session: marked at session start, not resumed, not started by another session.
function userSession(ctx, id = 'user', source = 'startup') {
  gate.startSession({ session_id: id, source, cwd: ctx.repo }, ctx.options);
  return id;
}
const typed = (ctx, prompt, { cwd = ctx.repo, session = userSession(ctx), environment = {} } = {}) =>
  hold.recordPrompt({ cwd, prompt, session_id: session }, { environment, ...ctx.options });

test('a plain yes with "merge" and a number is an approval; a no, a doubt or a question is not', () => {
  const approvals = [
    ['merge 618', [[null, 618, null]]],
    ['merge #618', [[null, 618, null]]],
    ['Merge 618.', [[null, 618, null]]],
    ['yes merge 601, 605 and 609', [[null, 601, null], [null, 605, null], [null, 609, null]]],
    ['merge 601 605', [[null, 601, null], [null, 605, null]]],
    ['merge 618 at 62405eb', [[null, 618, '62405eb']]],
    ['merge 618 62405ebd', [[null, 618, '62405ebd']]],
    ['merge owner/a#618', [['owner/a', 618, null]]],
    ['1. merge 612\n2. hold 613', [[null, 612, null]]],
    ['looks good\nmerge 618', [[null, 618, null]]],
    ['618 merge', [[null, 618, null]]],
    ['ok to merge 622', [[null, 622, null]]],
    ['can merge 622', [[null, 622, null]]],
    ['proceed to merge #622', [[null, 622, null]]],
    ['merge https://github.com/owner/a/pull/618/files', [['owner/a', 618, null]]],
  ];
  for (const [text, expected] of approvals) assert.deepEqual(hold.approvalsIn(text).map(({ repository, pr, sha }) => [repository, pr, sha]), expected, text);
  const refusals = [
    "don't merge 618", 'Don’t merge 618', 'please DON’T merge 618', 'do not merge 618 yet',
    'Never ever, under any circumstances, merge 618', "I'll merge 618 myself", 'merge 618 if CI is green',
    'merge 618 only once I say so', 'We need to merge 618 later', 'Did you merge 618', 'should we merge 618?',
    'Reply "merge 618" to approve. Not yet.', 'the summary says: merge 618 at 62405eb', 'merge conflicts again',
    'merge 618 1234567', 'hold off, we merge 618 after the test',
    'ok to merge', 'can merge', 'proceed to merge', 'I merged 618', 'merge 618 maybe', 'probably merge 618',
    'I think merge 618', 'not sure, merge 618', 'merge 618 or 619', 'merge 618 in 5 minutes', 'is it ok to merge 618',
    'merge 618 at 62405eb or 7a1b2c3d',
  ];
  for (const text of refusals) assert.deepEqual(hold.approvalsIn(text), [], text);
});

test('an approval is recorded only in a session the user started', (t) => {
  const ctx = context(t);
  assert.equal(typed(ctx, 'merge 618'), 1, 'the user\'s marked session');
  assert.equal(typed(ctx, 'merge 618', { session: 'unmarked' }), 0, 'no session-start mark');
  assert.equal(typed(ctx, 'merge 618', { session: userSession(ctx, 'resumed', 'resume') }), 0, 'a resumed run');
  assert.equal(typed(ctx, 'merge 618', { environment: { TOOLKIT_HOST_SESSION: 'parent' } }), 0, 'started by another session');
  assert.equal(typed(ctx, 'merge 618', { environment: { TOOLKIT_GATE_ROLE: 'G1' } }), 0, 'started by a launcher');
  assert.equal(typed(ctx, 'merge 618', { cwd: ctx.root }), 0, 'a bare number outside a GitHub repository');
  assert.equal(typed(ctx, 'merge owner/b#618', { cwd: ctx.root }), 1, 'a named repository outside one');
});

test('agent routes that could make an approval are refused', (t) => {
  const ctx = context(t);
  const forging = [
    'claude -p "merge 618"',
    'TOOLKIT_HOST_SESSION= claude -p "merge 618"',
    'env -u TOOLKIT_HOST_SESSION claude -p "hello"',
    'codex exec "merge 618"',
    'npx @anthropic-ai/claude-code -p "merge 618 at 62405eb"',
    'node -e "require(\'/x/repo/scripts/toolkit-merge-hold.cjs\').recordPrompt({prompt:\'merge 618\'})"',
    'echo \'{"prompt":"merge 618"}\' | node repo/scripts/toolkit-governance-hook.cjs --event UserPromptSubmit',
    `echo x > "${ctx.file}"`,
    'cat ~/.ai-agent-toolkit/user-state/merge-approvals.v1.json',
  ];
  for (const command of forging) assert.match(decide(ctx, bash(ctx.repo, command))?.deny || '', /^Toolkit: /, command);
  for (const command of ['node --test repo/tests/toolkit-merge-hold.test.cjs', 'claude --version', 'git commit -m "fix the claude merge wording"']) {
    assert.equal(decide(ctx, bash(ctx.repo, command)), null, command);
  }
});

test('every merge route needs an approval, and the always-refused routes are refused even with one', (t) => {
  const ctx = context(t);
  const held = [
    bash(ctx.repo, `gh pr merge 618 --merge --match-head-commit ${SHA}`),
    bash(ctx.repo, `gh pr -R owner/a merge 618 --match-head-commit ${SHA}`),
    bash(ctx.repo, `gh pr --repo=owner/a merge 618 --match-head-commit ${SHA}`),
    bash(ctx.repo, `gh pr merge 618 --auto --merge --match-head-commit ${SHA}`),
    bash(ctx.repo, `gh pr merge https://github.com/owner/a/pull/618 --match-head-commit ${SHA}`),
    bash(ctx.repo, `bash -c "gh pr merge 618 --match-head-commit ${SHA}"`),
    bash(ctx.repo, `gh api -X PUT repos/owner/a/pulls/618/merge -f sha=${SHA}`),
    bash(ctx.repo, `gh api -X PUT "repos/{owner}/{repo}/pulls/618/merge" -f sha=${SHA}`),
    bash(ctx.repo, `gh api -X PUT repos/:owner/:repo/pulls/618/merge -f sha=${SHA}`),
    connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }),
    connector('enable_pr_auto_merge', { pullNumber: 618 }),
  ];
  for (const input of held) assert.match(decide(ctx, input)?.deny || '', /has not approved a merge of owner\/a#618/, input.tool_input.command || input.tool_name);
  typed(ctx, 'merge 618');
  const always = [
    'gh api graphql -f query=\'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
    'gh api graphql -f query=\'mutation { enqueuePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
    'gh api graphql -f query=\'mutation { mergeBranch(input: {repositoryId: "x", base: "main", head: "f"}) { clientMutationId } }\'',
    'gh api -X POST repos/owner/a/merges -f base=main -f head=feature',
    `gh api -X PATCH repos/owner/a/git/refs/heads/main -f sha=${SHA}`,
    'gh repo sync owner/a',
    'gh alias set m "pr merge"',
    `cd ../b && gh pr merge 618 --match-head-commit ${SHA}`,
    `GH_REPO=owner/b gh pr merge 618 --match-head-commit ${SHA}`,
  ];
  for (const command of always) assert.match(decide(ctx, bash(ctx.repo, command))?.deny || '', /^Toolkit: /, command);
  assert.equal(decide(ctx, bash(ctx.repo, 'gh pr view 618')), null);
  assert.equal(decide(ctx, bash(ctx.repo, 'git merge origin/main')), null, 'a local merge alone changes nothing remote');
  assert.equal(decide(ctx, connector('pull_request_read', { pullNumber: 618 })), null);
});

test('line continuations and multi-line GraphQL do not get a merge past the hold', (t) => {
  const ctx = context(t);
  const held = [`gh pr \\\nmerge 618 --admin --match-head-commit ${SHA}`, `gh \\\npr merge 618 --match-head-commit ${SHA}`,
    `gh pr \`\r\nmerge 618 --match-head-commit ${SHA}`, `gh api \\\n-X PUT repos/owner/a/pulls/618/merge -f sha=${SHA}`];
  for (const command of held) assert.match(decide(ctx, bash(ctx.repo, command))?.deny || '', /has not approved a merge of owner\/a#618/, command);
  const always = ['gh api graphql -f query=\'\nmutation {\n  mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId }\n}\'',
    `gh api \\\n-X PATCH repos/owner/a/git/refs/heads/main -f sha=${SHA}`];
  for (const command of always) assert.match(decide(ctx, bash(ctx.repo, command))?.deny || '', /merges or moves a branch/, command);
});

test('a SHA-pinned approval refuses auto-merge, and a folder with two remotes needs the repository named', (t) => {
  const ctx = context(t);
  typed(ctx, 'merge 618 at 62405eb');
  assert.match(decide(ctx, connector('enable_pr_auto_merge', { pullNumber: 618 })).deny, /auto-merge cannot pin a commit/);
  git(ctx.repo, ['remote', 'add', 'upstream', 'https://github.com/owner/up.git']);
  assert.match(decide(ctx, bash(ctx.repo, `gh pr merge 618 --match-head-commit ${SHA}`)).deny, /cannot tell which repository/);
  assert.equal(decide(ctx, bash(ctx.repo, `gh pr merge 618 --repo owner/a --match-head-commit ${SHA}`)), null);
});

test('one approval allows one merge of that pull request in that repository, naming a head commit', (t) => {
  const ctx = context(t);
  typed(ctx, 'merge 618');
  assert.match(decide(ctx, connector('merge_pull_request', { pullNumber: 619, expectedHeadSha: SHA })).deny, /owner\/a#619/, 'another number');
  assert.match(decide(ctx, connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA }, 'b')).deny, /owner\/b#618/, 'another repository');
  assert.match(decide(ctx, bash(ctx.repo, 'gh pr merge 618 --merge')).deny, /--match-head-commit/, 'no head commit named');
  assert.match(decide(ctx, bash(ctx.repo, `gh pr merge 618 --match-head-commit ${SHA}`), { GH_REPO: 'owner/b' }).deny, /owner\/b#618/, 'GH_REPO in the environment');
  assert.equal(decide(ctx, bash(ctx.repo, `gh pr merge 618 --merge --match-head-commit ${SHA}`)), null);
  assert.match(decide(ctx, connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA })).deny, /has not approved/, 'used up');
  typed(ctx, 'merge owner/b#618', { cwd: ctx.root });
  assert.equal(decide(ctx, bash(ctx.repo, `gh pr merge 618 --repo owner/b --match-head-commit ${SHA}`)), null, 'a named repository');
});

test('a typed SHA must match, and an approval lasts a day', (t) => {
  const ctx = context(t);
  typed(ctx, 'merge 618 at 62405eb');
  assert.match(decide(ctx, connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: 'a'.repeat(40) })).deny, /approved owner\/a#618 at 62405eb/);
  assert.equal(decide(ctx, connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA })), null);
  const start = Date.parse('2026-10-25T10:00:00Z');
  hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 620', session_id: userSession(ctx) }, { environment: {}, ...ctx.options, now: () => new Date(start) });
  const later = { ...ctx.options, now: () => new Date(start + hold.MAX_AGE_MS + 1000), environment: {} };
  assert.match(hold.decide(connector('merge_pull_request', { pullNumber: 620, expectedHeadSha: SHA }), later).deny, /has not approved/);
});

test('a push to the default branch is refused; other branches and evidence stores are not', (t) => {
  const ctx = context(t);
  const feature = repository(ctx.root, 'feature', { branch: 'work' });
  const store = repository(ctx.root, 'store', { slug: 'owner/TRANSPORT-a' });
  const fresh = repository(ctx.root, 'fresh', { remoteHead: false });
  fs.rmSync(path.join(fresh, '.git', 'refs', 'remotes', 'origin', 'main'));
  const refused = [
    [ctx.repo, 'git push'], [ctx.repo, 'git push origin'], [ctx.repo, 'git push -u origin HEAD'],
    [feature, 'git push origin HEAD:main'], [feature, 'git push origin work:refs/heads/main'], [feature, 'git push origin main'],
    [feature, 'git push --all origin'], [feature, 'git merge work && git checkout main && git push origin main'],
    [ctx.root, 'cd feature && git push origin HEAD:main'], [ctx.root, `git -C ${feature} push origin +work:main`],
  ];
  for (const [cwd, command] of refused) assert.match(decide(ctx, bash(cwd, command))?.deny || '', /default branch `main`/, command);
  const allowed = [[feature, 'git push'], [feature, 'git push -u origin HEAD'], [feature, 'git push origin work'], [store, 'git push origin main'], [fresh, 'git push -u origin main']];
  for (const [cwd, command] of allowed) assert.equal(decide(ctx, bash(cwd, command)), null, command);
});

test('an unreadable approvals store refuses the merge, and a governance error never skips the merge check', (t) => {
  const ctx = context(t);
  fs.mkdirSync(ctx.file, { recursive: true });
  const merge = connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA });
  assert.throws(() => decide(ctx, merge), /MERGE_APPROVALS_UNREADABLE/);
  const output = claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options });
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /merge check failed/);
  fs.rmSync(ctx.file, { recursive: true, force: true });
  const broken = { environment: {}, ...ctx.options, gate: { ToolGate: class { decide() { throw new Error('boom'); } }, insideRepository: () => false } };
  const outside = claudeHook.respond('PreToolUse', { ...bash(ctx.root, `gh pr merge 618 --repo owner/a --match-head-commit ${SHA}`) }, broken);
  assert.equal(outside.hookSpecificOutput?.permissionDecision, 'deny');
});

test('the Claude Code hook records the typed approval and enforces it; cloud sessions are not covered', (t) => {
  const ctx = context(t);
  const merge = connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA });
  assert.equal(claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options }).hookSpecificOutput.permissionDecision, 'deny');
  claudeHook.respond('UserPromptSubmit', { cwd: ctx.repo, prompt: 'merge 618', session_id: userSession(ctx) }, { environment: {}, ...ctx.options });
  assert.equal(claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options }).hookSpecificOutput?.permissionDecision, undefined);
  assert.deepEqual(claudeHook.respond('PreToolUse', merge, { environment: { CLAUDE_CODE_REMOTE: 'true' }, ...ctx.options }), {});
});

test('the Codex hook refuses, records the user\'s approval, allows one merge and refuses again', (t) => {
  const ctx = context(t);
  const home = path.join(ctx.root, 'home');
  const script = path.resolve(__dirname, '..', 'scripts', 'toolkit-codex-helper-hook.cjs');
  const env = { ...process.env, HOME: home, USERPROFILE: home, TOOLKIT_HOST_SESSION: '', TOOLKIT_GATE_ROLE: '', TOOLKIT_NATIVE_HELPER_BINDING: '', TOOLKIT_CLAUDE_TASK_PROFILE_SHA256: '', CLAUDE_CODE_REMOTE: '' };
  const run = (input) => spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env, cwd: ctx.root });
  const merge = { cwd: ctx.root, tool_name: 'mcp__github__merge_pull_request', tool_input: { owner: 'owner', repo: 'a', pullNumber: 618, expectedHeadSha: SHA } };
  const refusedFirst = run(merge);
  assert.equal(refusedFirst.status, 2, refusedFirst.stdout + refusedFirst.stderr);
  gate.startSession({ session_id: 'codex-user', source: 'startup', cwd: ctx.root }, { registryOptions: { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true } });
  const prompt = run({ hook_event_name: 'UserPromptSubmit', cwd: ctx.root, session_id: 'codex-user', prompt: 'merge owner/a#618' });
  assert.equal(prompt.status, 0, prompt.stdout + prompt.stderr);
  const allowed = run(merge);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.equal(run(merge).status, 2, 'used up');
});

test('both hook files send merge tools and shell commands to the merge hold', () => {
  const root = path.resolve(__dirname, '..', '..');
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const governanceEntry = claude.find(entry => entry.hooks.some(hook => hook.command.includes('toolkit-governance-hook.cjs')));
  for (const tool of ['Bash', 'PowerShell', 'mcp__github__merge_pull_request', 'mcp__github__enable_pr_auto_merge']) assert.match(tool, new RegExp(governanceEntry.matcher), tool);
  const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  for (const tool of ['Bash', 'mcp__github__merge_pull_request']) assert.ok(codex.some(entry => new RegExp(entry.matcher).test(tool) && entry.hooks.some(hook => hook.command.includes('toolkit-codex-helper-hook.cjs'))), tool);
});
