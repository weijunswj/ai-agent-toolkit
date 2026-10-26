'use strict';

// The merge hold, a tripwire: it holds an agent's merge until the user typed a line with "merge" and
// the pull request number, and refuses a push to the default branch written directly. Every case uses
// a temporary user-state folder and temporary git repositories.

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
    ['merge github.com/other/repo/pull/622', [['other/repo', 622, null]]],
    ['merge https://www.github.com/other/repo/issues/622', [['other/repo', 622, null]]],
    ['merge 622 (3 commits)', [[null, 622, null]]],
    ['merge 622, 3 files', [[null, 622, null]]],
    ["fine, merge 622's branch now", [[null, 622, null]]],
    ['merge weijunswj/ai-agent-toolkit#622', [['weijunswj/ai-agent-toolkit', 622, null]]],
    ['merge https://github.com/weijunswj/ai-agent-toolkit/pull/622', [['weijunswj/ai-agent-toolkit', 622, null]]],
    ['merge PR #622 at ee067e1', [[null, 622, 'ee067e1']]],
    ['merge 622 & 623', [[null, 622, null], [null, 623, null]]],
  ];
  // Natural wordings that must count.
  for (const text of ["merge the PR at https://github.com/o/r/pull/622", "merge https://github.com/o/r/pull/622/files at ee067e1", "a)618 merge", "merge 622 since CI is green", "merge 622, all green", "a.merge 622", "a) merge 622", "- - - - - merge 622", "- [ ] merge 622", "(1) merge 622", "- 1. merge 622", "1234. merge 622", "CI green, merge 622", "could you merge 622", "would you merge 622", "1.merge 612", "1. merge 612", "can you merge 622","CI is green, merge 622","merge https://github.com/o/r/pull/622/files","merge 622","yes, merge 622","merge #622","Merge #622.","merge 622!","merge PR 622","merge PR #622","merge pull request 622","merge 622 at ee067e1","merge 622 (head ee067e1)","merge #622 at ee067e1","OK to merge 622 at ee067e1","merge https://github.com/weijunswj/ai-agent-toolkit/pull/622","merge weijunswj/ai-agent-toolkit#622","ok merge 622 now","go ahead and merge 622","LGTM, merge 622","please merge 622","squash and merge 622","it's fine, merge 622","- merge 622","merge 622 and 623","merge 622 & 623"]) assert.notDeepEqual(hold.approvalsIn(text), [], text);
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
    // quotes
    '> merge 618', "'merge 618'", '‘merge 618’', '"merge 618"', '`merge 618`',
    // unclear: two SHAs, an over-long line
    'merge 618 62405eb 7a1b2c3', `merge 618 ${'x'.repeat(200)}`,
    // another kind of merge
    'merge main into 622', 'merge origin/main into #622', 'resolve the merge conflicts in 622', '622 has merge conflicts',
    "fix 622's merge conflicts", 'the merge of 622 broke main',
    // refusal verbs
    'revert merge 622', 'reject merge 622', 'refuse to merge 622', 'block merge 622', 'skip merge 622',
    'abort the merge of 622', 'merge 622 is denied',
    // delays and conditions
    'merge 622 in a bit', 'merge 622 soon', 'merge 622 next week', 'merge 622 on Monday', 'merge 622 tmrw',
    'merge 622 by Friday', 'merge 622 EOD', 'merge 622 provided CI passes', 'merge 622 as long as CI is green',
    'merge 622 pending review', 'merge 622 assuming checks pass', 'dunno, merge 622', 'merge 622 on 27 Oct',
    // reports
    'Claude wants to merge 622', 'PR 622 is ready to merge', 'Next step: merge 622', 'merge 622, then close 619',
    // a time at the start, decimals before merge, bare angle brackets, at green, mid-line shall, nested markers
    '17:00 merge 622', '10:30 merge 622', '1.5 merge 622 now', '27.10 merge 622 now', '<merge 622', 'merge 622 >', 'merge 622 at CI green',
    'ok shall we merge 622', '- 1. > merge 622', '(1) > merge 622', '[x] > merge 622', '1234. > merge 622', 'a) did you merge 622',
    '- a) did you merge 622', '- 1. why merge 622', '[x] did you merge 622', '(1) why merge 622',
    // a link before green, letter markers with no space, too many nested markers, comma-joined digits, untested guards
    'merge https://github.com/o/r/pull/622 green', 'merge github.com/o/r/pull/622 green', 'merge https://github.com/o/r/pull/622 now green',
    'merge 622 CI green', 'merge 622 now green', 'merge 622 all green',
    'a)did you merge 622', 'b.did you merge 622', '- - - - - - did you merge 622', '- - - - - - merge 622', '1,5 merge 622', 'merge 622,623',
    '‹merge 622', '›merge 622', '1234.did you merge 622', '- - - why merge 622', '17：00 merge 622', '1.23456 merge',
    // green after a link path, a digit after a letter marker, untested guards, more clock forms
    'merge https://github.com/o/r/pull/622/files green', 'merge https://github.com/o/r/pull/622#top green', 'merge https://github.com/o/r/pull/622/files now green',
    'a.618 merge', 'item:5 merge', 'ok to merge 622?', '\u2022 did you merge 622', 'looks good, #622', 'merge 622 green.',
    'merge 622 until CI passes', 'the agent can merge 622', 'merged 621, merge 622', '17h00 merge 622', 'merge 622 at 17h00', 'T17:00 merge 622', '9 a.m. merge 622',
    // numbered markers with no space, more branch names and quote forms, untested guards, green and clock forms
    '1.> merge 622', '1.did you merge 622', '12.is it ok to merge 622', 'merge development to #622', 'merge production to #622',
    'merge stable to #622', 'merge feature/x into #622', '‹merge 622›', '＂merge 622＂', 'merge 622 in 3 months', 'merge 622 at midnight',
    'merge 622 (fixes #10)', 'merge 622, resolves #10', 'merge 622, could we also tidy the branch', '『merge 622』', 'merge 622 this weekend',
    'merge 622 on CI green', 'merge 622 on green CI', 'merge 622 upon CI green today', 'merge 622 upon green', 'merge 622 at green', 'merge 622 green', 'merge 622 at 1700',
    // a hold word glued to a link, more branch names, delays, a closing reference, a question mid-line, more quote forms
    'merge https://github.com/o/r/pull/622,later', 'merge https://github.com/o/r/pull/622—not yet', 'merge 622 in 2 weeks', 'merge 622 at noon',
    'merge 622 undone', 'merge 622, closes #10', 'ok can we merge 622', '<merge 622>', '+ > merge 622', 'a. > merge 622', '…merge 622', 'merge 622...',
    '「merge 622」', 'merge dev to #622', 'merge staging to #622', 'merge release to #622', 'merge prod to #622', 'merge mainline to #622',
    // merging a branch into the pull request, counts, other forms of the listed words, quotes after a list marker
    ...["please merge main → #622","merge main -> #622","merge main to #622","merge main to PR #622","merge main in #622","merge main onto #622","merge main with #622","merge main for #622","merge main on #622","merge main on top of #622","merge main, #622","merge main w/ #622","merge main back to #622","merge-main #622","merge main@#622","merge latest main to #622","merge upstream main in #622","merge from main in #622","merge in main for #622","git merge main on #622","622 merge main","#622 merge main","#622: merge main","PR 622 merge main","PR #622: merge main","for #622, merge main","update #622: merge main","bring #622 up to date: merge main","merge master to #622","merge develop to #622","merge the default branch to #622","merge main to weijunswj/ai-agent-toolkit#622","merge main to https://github.com/weijunswj/ai-agent-toolkit/pull/622","fix 3 merge issues in 622","there are 2 merge commits in 622","merge 2 branches","merge 2 PRs: 622 and 623","5 merge commits","merge 622 cancelled","merge 622 is canceled","holding merge 622","merge 622, still waiting on CI","pause merge 622","postpone merge 622","delay merge 622","defer merge 622","halt merge 622","veto merge 622","undo merge 622","nobody merge 622","neither merge 622 nor 623","merge 622 in 2 days","merge 622 at 5pm","merge 622 at 17:00","merge 622 by end of day","merge 622 by COB","merge 622 this afternoon","eventually merge 622","sometime merge 622","merge 622 given CI passes","merge 622 providing CI passes","merge 622 presuming CI passes","merge 622 should CI pass","merge 622 on green","merge 622 subject to review","merge 622 contingent on review","merge 622 iff green","merge 622 barring failures","can we merge 622","may we merge 622","the agent will merge 622","Plan: merge 622","TODO: merge 622","Option A: merge 622","- > merge 622","1. > merge 622","«merge 622»","＞ merge 622"],
  ];
  for (const text of refusals) assert.deepEqual(hold.approvalsIn(text), [], text);
  assert.deepEqual(hold.approvalsIn('1700 merge https://github.com/o/r/pull/622'), [{ repository: 'o/r', pr: 622, sha: null }]);
  // A SHA is kept only when the line names one pull request.
  assert.deepEqual(hold.approvalsIn('merge 601 and 605 at 62405eb').map(item => item.sha), [null, null]);
  // A digit after a list marker or a colon is not a pull request number.
  for (const text of ['1:5 merge 622', 'item:5 merge 622', '1.23456 merge 622', '+1 merge 622', '1 merge 622', '1700 merge 622', '1 merge #622', '1700 merge #622']) assert.deepEqual(hold.approvalsIn(text), [{ repository: null, pr: 622, sha: null }], text);
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

test('connector auto-merge is refused even with an approval; gh auto-merge with a head commit is not', (t) => {
  const ctx = context(t);
  typed(ctx, 'merge 618');
  assert.match(decide(ctx, connector('enable_pr_auto_merge', { pullNumber: 618 })).deny, /auto-merge cannot name the head commit.*gh pr merge 618 --auto --match-head-commit/);
  assert.match(decide(ctx, connector('enable_pr_auto_merge', { pullNumber: 618, expectedHeadSha: 'a'.repeat(40) })).deny, /auto-merge cannot name/);
  assert.equal(decide(ctx, bash(ctx.repo, `gh pr merge 618 --auto --merge --match-head-commit ${SHA}`)), null);
});

test('two remotes or a gh default repository other than its own need the repository named', (t) => {
  const ctx = context(t);
  typed(ctx, 'merge 618');
  typed(ctx, 'merge 618', { cwd: ctx.other });
  git(ctx.repo, ['remote', 'add', 'upstream', 'https://github.com/owner/up.git']);
  assert.match(decide(ctx, bash(ctx.repo, `gh pr merge 618 --match-head-commit ${SHA}`)).deny, /cannot tell which repository/);
  assert.equal(decide(ctx, bash(ctx.repo, `gh pr merge 618 --repo owner/a --match-head-commit ${SHA}`)), null);
  git(ctx.other, ['config', 'remote.origin.gh-resolved', 'owner/up']);
  assert.match(decide(ctx, bash(ctx.other, `gh pr merge 618 --match-head-commit ${SHA}`)).deny, /cannot tell which repository/);
  git(ctx.other, ['config', 'remote.origin.gh-resolved', 'base']);
  assert.equal(decide(ctx, bash(ctx.other, `gh pr merge 618 --match-head-commit ${SHA}`)), null);
});

test('a REST merge path after a quoted value with a newline, ; & or | is still held, and Codex cmd forms are read', (t) => {
  const ctx = context(t);
  const held = [
    `gh api -X PUT -f "commit_title=Fix A & B" repos/owner/a/pulls/618/merge -f sha=${SHA}`,
    `gh api -X PUT -f "commit_title=a;b" repos/owner/a/pulls/618/merge -f sha=${SHA}`,
    `gh api -X PUT -f "commit_title=a|b" repos/owner/a/pulls/618/merge -f sha=${SHA}`,
    `gh api -X PUT -f "commit_title=a\nb" repos/owner/a/pulls/618/merge -f sha=${SHA}`,
    `gh pr ^\r\nmerge 618 --match-head-commit ${SHA}`,
  ];
  for (const command of held) assert.match(decide(ctx, bash(ctx.repo, command))?.deny || '', /has not approved a merge of owner\/a#618/, command);
  const cmd = { cwd: ctx.repo, tool_name: 'exec_command', tool_input: { cmd: `gh pr merge 618 --match-head-commit ${SHA}` } };
  assert.match(decide(ctx, cmd).deny, /has not approved/);
  const list = { cwd: ctx.repo, tool_name: 'shell', tool_input: { command: ['bash', '-lc', `gh pr merge 618 --match-head-commit ${SHA}`] } };
  assert.match(decide(ctx, list).deny, /has not approved/);
  assert.equal(hold.mayMerge(cmd), true);
  const words = { cwd: ctx.repo, tool_name: 'shell', tool_input: { command: ['gh', 'pr', 'merge', '618', '--match-head-commit', SHA] } };
  assert.match(decide(ctx, words).deny, /has not approved/, 'a Codex word list is joined');
  const long = bash(ctx.repo, `echo ${'x'.repeat(hold.MAX_COMMAND_CHARS)} && gh pr merge 618`);
  assert.match(decide(ctx, long).deny, /too long to check/, 'merge after the first megabyte');
  assert.equal(decide(ctx, bash(ctx.repo, `echo ${'x'.repeat(1024 * 1024)}`)), null, 'a long command with no merge or push');
  typed(ctx, 'merge 618');
  assert.equal(decide(ctx, bash(ctx.repo, held[0])), null, 'with an approval, the sha= field is read across the command');
  for (const command of [`gh api -X PUT repos/owner/a/pulls/618/merge -f merge_method=squash # sha=${SHA}`, `gh api -X PUT repos/owner/a/pulls/618/merge && echo sha=${SHA}`]) {
    typed(ctx, 'merge 618');
    assert.match(decide(ctx, bash(ctx.repo, command)).deny, /name the head commit/, `only a field value counts as sha=: ${command}`);
  }
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
