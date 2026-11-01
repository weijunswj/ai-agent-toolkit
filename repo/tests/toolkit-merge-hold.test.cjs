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
const hostile = require('./support/hostile-inputs.cjs');

const SHA = '62405ebd4c27859d66036e18f13c856c645d366d';
// The Codex GitHub app's merge call that the hold could not read (repository, number and head SHA
// in their own field names), copied from the saved diagnostic.
const DIAGNOSTIC_SHA = '7384901397e63407783c60f6656499db9edf6b12';
const DIAGNOSTIC_REPO = 'Swooshz-com/swooshz-quote-auto-generator';
const CODEX_MERGE = 'mcp__codex_apps__github__merge_pull_request';

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
    // (a line that is only a code span, such as `merge 618`, is read without its backticks: see the code span test)
    '> merge 618', "'merge 618'", '‘merge 618’', '"merge 618"', 'run `merge 618`',
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
    'a.1. did you merge 622', 'ok.17:00 merge 622', 'merge 622 until CI passes', 'the agent can merge 622', 'merged 621, merge 622', '17h00 merge 622', 'merge 622 at 17h00', 'T17:00 merge 622', '9 a.m. merge 622',
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
  // A question or quote after any kind of line break is still read as a line of its own.
  for (const brk of ['\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\u0085', '\u2028', '\u2029']) for (const text of ['Did you merge 618', '- 1. why merge 622', '[x] did you merge 622', '> merge 622']) assert.deepEqual(hold.approvalsIn(`looks good${brk}${text}`), [], JSON.stringify(brk + text));
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

// Codex names the folder a command runs in as workdir; the session folder (cwd) can be elsewhere.
test('matrix: Codex shell shapes are judged in the folder the command runs in, for merges and default-branch pushes', (t) => {
  const ctx = context(t);
  const rows = [
    ['R4 Bash cmd and workdir', (command, workdir) => ({ cwd: ctx.root, tool_name: 'Bash', tool_input: { cmd: command, workdir } })],
    ['R5 exec_command', (command, workdir) => ({ cwd: ctx.root, tool_name: 'exec_command', tool_input: { cmd: command, workdir } })],
    ['R6 shell, bash -lc', (command, workdir) => ({ cwd: ctx.root, tool_name: 'shell', tool_input: { command: ['bash', '-lc', command], workdir } })],
    ['R8 relative workdir', (command, workdir) => ({ cwd: ctx.root, tool_name: 'local_shell', tool_input: { cmd: command, workdir: path.relative(ctx.root, workdir) } })],
    ['R8 session folder in another repository', (command, workdir) => ({ cwd: ctx.other, tool_name: 'exec_command', tool_input: { cmd: command, workdir } })],
    ['R9 command and cmd both given', (command, workdir) => ({ cwd: ctx.root, tool_name: 'Bash', tool_input: { command: 'git status', cmd: command, workdir } })],
  ];
  for (const [row, shape] of rows) {
    assert.match(decide(ctx, shape(`gh pr merge 618 --match-head-commit ${SHA}`, ctx.repo))?.deny || '', /has not approved a merge of owner\/a#618/, `${row}: C6`);
    assert.match(decide(ctx, shape('git push origin main', ctx.repo))?.deny || '', /default branch `main`/, `${row}: C8`);
    assert.equal(decide(ctx, shape('git status', ctx.repo)), null, `${row}: allowed control`);
  }
  if (process.platform === 'win32') {
    // Git Bash drive paths in git -C and cd name the same repository.
    const drive = `/${ctx.repo[0].toLowerCase()}${ctx.repo.slice(2).replace(/\\/g, '/')}`;
    for (const command of [`git -C ${drive} push origin main`, `cd ${drive} && git push origin main`, `cd /cygdrive${drive} && git push origin main`]) {
      assert.match(decide(ctx, bash(ctx.root, command))?.deny || '', /default branch `main`/, command);
    }
  }
  // An argument list without a shell.
  assert.match(decide(ctx, { cwd: ctx.root, tool_name: 'shell', tool_input: { command: ['git', 'push', 'origin', 'main'], workdir: ctx.repo } })?.deny || '', /default branch `main`/, 'R7');
  // A program path with spaces is quoted in the shared reading; the unquoted reading still finds the merge.
  const gh = 'C:\\Program Files\\GitHub CLI\\gh.exe';
  assert.match(decide(ctx, { cwd: ctx.root, tool_name: 'shell', tool_input: { command: [gh, 'pr', 'merge', '618', '--repo', 'owner/a', '--match-head-commit', SHA] } })?.deny || '', /has not approved a merge of owner\/a#618/, 'quoted gh path');
  assert.match(decide(ctx, { cwd: ctx.root, tool_name: 'shell', tool_input: { command: [gh, 'api', '-X', 'PUT', 'repos/owner/a/pulls/618/merge', '-f', `sha=${SHA}`] } })?.deny || '', /has not approved a merge of owner\/a#618/, 'quoted gh path, REST merge');
  // Found by both readings, a merge still uses one approval.
  typed(ctx, 'merge 618');
  assert.equal(decide(ctx, { cwd: ctx.root, tool_name: 'shell', tool_input: { command: ['gh', 'pr', 'merge', '618', '--repo', 'owner/a', '--match-head-commit', SHA, '--subject', 'two words'] } }), null, 'one approval, one merge');
  assert.match(decide(ctx, { cwd: ctx.root, tool_name: 'shell', tool_input: { command: ['gh', 'pr', 'merge', '618', '--repo', 'owner/a', '--match-head-commit', SHA] } })?.deny || '', /has not approved/, 'used up');
  // The broken-module screen reads the whole raw input, whatever field the command is in.
  assert.equal(hold.mayMerge({ tool_name: 'exec_command', tool_input: { script: 'git push origin main' } }), true);
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

test('shell argument lists allow plain feature pushes but refuse a shell nested in the script', (t) => {
  const ctx = context(t);
  const feature = repository(ctx.root, 'feature', { branch: 'work' });
  const rows = [
    [['bash', '-lc', 'git push origin work'], null],
    [['bash', '-c', '-e', 'git push origin work'], null],
    [['bash', '-lc', '--', 'git push origin work'], null],
    [['pwsh', '-NoProfile', '-Command', 'git push origin work'], null],
    [['bash', '-lc', 'bash -c "git push origin work"'], 'Toolkit: this command runs a git push through another shell (bash -c, pwsh -Command, cmd /c or eval), so Toolkit cannot read where it pushes and refused it. Run the push as its own git command.'],
  ];
  for (const [command, expected] of rows) {
    const result = decide(ctx, { cwd: feature, tool_name: 'shell', tool_input: { command } });
    assert.equal(result?.deny || null, expected, JSON.stringify(command));
  }
  // The unwrapped script still gets the default-branch check.
  for (const command of [['bash', '-lc', 'git push origin HEAD:main'],
    ['bash', '-c', '-e', 'git push origin HEAD:main'], ['bash', '-lc', '--', 'git push origin HEAD:main'],
    ['pwsh', '-NoProfile', '-Command', 'git fetch; git push origin work:main']]) {
    assert.match(decide(ctx, { cwd: feature, tool_name: 'shell', tool_input: { command } })?.deny || '', /default branch `main`/, JSON.stringify(command));
  }
  const uncertain = ['bash', '-c', '-o', 'pipefail', 'git push origin work'];
  assert.match(decide(ctx, { cwd: feature, tool_name: 'shell', tool_input: { command: uncertain } })?.deny || '', /through another shell/);
});

test('pushes through another shell or expression runner are refused outright', (t) => {
  const ctx = context(t);
  const feature = repository(ctx.root, 'feature', { branch: 'work' });
  const message = 'Toolkit: this command runs a git push through another shell (bash -c, pwsh -Command, cmd /c or eval), so Toolkit cannot read where it pushes and refused it. Run the push as its own git command.';
  const blocked = [
    'bash -c "git push origin feature"', 'bash -ce "git push origin HEAD:main"', 'bash -c -e "git push"',
    "sh -lc 'git push'", 'zsh -c "if true; then git push origin HEAD:main; fi"',
    'pwsh -Command "git push origin HEAD:main"', 'pwsh -Comm "git push"',
    'powershell -ExecutionPolicy Bypass -Command git push origin HEAD:main',
    'powershell -NoProfile -Command { git push origin HEAD:main }', 'powershell "git push origin HEAD:main"',
    'pwsh -EncodedCommand ZwBpAHQA', '& pwsh -c "git push"',
    'cmd /c git push origin HEAD:main', 'cmd /cgit push origin HEAD:main', 'cmd /c"git push origin HEAD:main"',
    'cmd /c "echo ready & cmd /c git push"', 'eval git push origin HEAD:main', 'eval "git push"',
    "iex ('git push origin HEAD:main')", 'Invoke-Expression "git push"', 'env -i bash -c "git push"',
    '. powershell -c "git push"', 'exec command nohup builtin bash -ec "git push"', 'W=value bash -c "git push"',
    '{bash -c "git push"}', '(bash -c "git push")', '&bash -c "git push"',
    'dash -c "git push"', 'ksh -c "git push"', 'cmd /kgit push',
    'pwsh -e ZwBpAHQA', 'pwsh -enc ZwBpAHQA', 'pwsh -ec ZwBpAHQA',
    'pwsh -Command "Set-Location -LiteralPath somewhere; git push"', 'bash -c "bash -c git push"',
    'pwsh -Command "Write-Output ready;" "git push origin HEAD:main"',
    'powershell -ExecutionPolicy Bypass "git push origin HEAD:main"',
    'bash -c "npm test" && bash -c "git push origin feature"',
    `rg -F 'bash -c "git push"' .; {bash -c "git push origin feature"}`,
    String.raw`bash -c 'printf "%s\n" "$1"' -- 'git push origin HEAD:main'`,
    `s='git push origin HEAD:main'; bash -c "$s"`,
    "$s = 'git push origin HEAD:main'; pwsh -Command $s",
    'bash -c "$(cat push.sh)"; echo git push',
    'cmd /c %CMD% & echo git push', 'eval "$PUSH" # git push',
    'sh -lc "${PUSH}"; echo git push', 'zsh -c "$(cat push.sh)"; echo git push',
    'dash -c "`cat push.sh`"; echo git push', 'ksh -c "$PUSH"; echo git push',
    'powershell -Command $env:CMD; echo git push', 'cmd /k %CMD% & echo git push',
    'iex $s; echo git push', 'Invoke-Expression ${CMD}; echo git push',
    "Write-Output 'git push origin HEAD:feature' | Invoke-Expression",
    "Write-Output 'git push origin HEAD:feature' | iex",
  ];
  for (const command of blocked) assert.equal(decide(ctx, bash(feature, command))?.deny, message, command);
  const allowed = ['git push origin work', 'bash -c "git status"', 'pwsh -Command "Write-Output ready"',
    'git commit -m "Refuse bash -c git push wrappers"', `rg -F 'bash -c "git push"' repo`,
    'gh pr create --title "Block bash -c git push"',
    'git commit --allow-empty -m "bash" -m "Document -c git push handling"',
    "Write-Output 'hello' | Invoke-Expression", "Write-Output 'hello' | iex",
    "Write-Output 'git push origin HEAD:feature | Invoke-Expression'",
    String.raw`git commit -m "Refuse \"bash -c git push\" wrappers"`,
    'cmd /c echo push', 'eval echo git', 'bash script.sh',
    'bash -c "npm test" && git push origin feature', 'bash -lc "make"; git push origin feature',
    'pwsh -Command "Write-Output ok" | Out-Null; git push origin feature',
    'eval "$(ssh-agent -s)"', 'bash -c "cd $HOME && npm test"',
    'pwsh -Command "Write-Output $env:USERNAME"',
    'eval "$(echo true)"', 'bash "$SCRIPT"; echo git push',
    'cmd /d %CMD% & echo git push', 'bash -c "npm test"; echo $PUSH git push',
    `rg -F 'eval "$PUSH" # git push' repo`,
    'bash -c "$CMD"; echo git pushy', 'eval "$CMD"; echo digit push'];
  for (const command of allowed) assert.equal(decide(ctx, bash(feature, command)), null, command);
});

test('a push names its folder through a variable the same command assigned, and an evidence store a binding names is not refused', (t) => {
  const ctx = context(t);
  const store = repository(ctx.root, 'store', { slug: 'owner/TRANSPORT-a' });
  const feature = repository(ctx.root, 'feature', { branch: 'work' });
  const ps = (cwd, command) => ({ cwd, tool_name: 'PowerShell', tool_input: { command } });
  // The real refused call: PowerShell, a variable holding the store's literal path, from another
  // repository. Claude Code names its shell, so the variable is read as that shell reads it.
  const claude = (input) => hold.decide(input, { ...ctx.options, environment: {}, host: 'claude' });
  for (const command of [`$d = '${store}'; git -C $d push origin HEAD:main 2>&1 | Select -Last 1`, `$D = "${store}"; Set-Location $d; git push origin main`, `git -C ${store} push origin HEAD:main`]) {
    assert.equal(claude(ps(ctx.repo, command)), null, command);
  }
  assert.equal(claude(bash(ctx.repo, `d='${store.replace(/\\/g, '/')}' ; git -C "$d" push origin HEAD:main`)), null, 'POSIX assignment');
  // With no shell named (Codex), the push is also judged as if the assignment did not run, which leaves
  // the session's own repository pushing to main: refused. A literal store path needs no variable.
  assert.match(decide(ctx, ps(ctx.repo, `$d = '${store}'; git -C $d push origin HEAD:main`))?.deny || '', /default branch `main`/, 'unknown shell');
  assert.equal(decide(ctx, ps(ctx.repo, `git -C ${store} push origin HEAD:main`)), null, 'literal store path, unknown shell');
  // The variable still points the check at the right repository when that one is not a store.
  assert.match(claude(ps(ctx.repo, `$d = '${feature}'; git -C $d push origin work:main`))?.deny || '', /default branch `main`/);
  // A store named by a cached programme binding, whatever its name, is an evidence store (rule S1).
  const governed = repository(ctx.root, 'governed', { slug: 'owner/governed' });
  const named = repository(ctx.root, 'evidence', { slug: 'owner/evidence' });
  assert.match(decide(ctx, bash(named, 'git push origin main'))?.deny || '', /default branch `main`/, 'not a store before the binding is cached');
  const binding = JSON.stringify({ schema: 'toolkit.programme-binding.v1', repository: 'owner/governed', parent_issue: 1, record_prefix: 'INT-G', writer_prefix: 'G', store: { kind: 'github', repository: 'owner/evidence', branch: 'main', path: 'state/' }, required_checks: ['validate'] });
  require('./toolkit-governed-fixture-support.cjs').recordMerged(governed, { registryPath: ctx.options.registryOptions.registryPath, text: binding });
  assert.equal(decide(ctx, bash(named, 'git push origin main')), null, 'a store the binding names');
  assert.match(decide(ctx, bash(governed, 'git push origin main'))?.deny || '', /default branch `main`/, 'the governed repository itself');
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

test('a broken merge hold refuses state-changing tools that mention merge or push, never read-only ones', (t) => {
  const ctx = context(t);
  const broken = { environment: {}, ...ctx.options, mergeHold: { decide() { throw new Error('boom'); }, mayMerge() { throw new Error('boom'); } } };
  for (const input of [{ cwd: ctx.root, tool_name: 'Read', tool_input: { file_path: path.join(ctx.root, 'merge-notes.md') } }, { cwd: ctx.root, tool_name: 'Grep', tool_input: { pattern: 'push' } }]) {
    assert.notEqual(claudeHook.respond('PreToolUse', input, broken).hookSpecificOutput?.permissionDecision, 'deny', input.tool_name);
  }
  for (const input of [bash(ctx.root, 'git push origin main'), connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA })]) {
    assert.match(claudeHook.respond('PreToolUse', input, broken).hookSpecificOutput.permissionDecisionReason, /merge check failed/, input.tool_name);
  }
});

test('the Claude Code hook records the typed approval and enforces it; cloud sessions are not covered', (t) => {
  const ctx = context(t);
  const merge = connector('merge_pull_request', { pullNumber: 618, expectedHeadSha: SHA });
  assert.equal(claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options }).hookSpecificOutput.permissionDecision, 'deny');
  // While the governance question holds the message, a typed approval is not kept.
  const held = claudeHook.respond('UserPromptSubmit', { cwd: ctx.repo, prompt: 'merge 618', session_id: userSession(ctx) }, { environment: {}, ...ctx.options });
  assert.ok(held.systemMessage || held.decision === 'block', JSON.stringify(held));
  assert.equal(fs.existsSync(ctx.file), false);
  assert.equal(claudeHook.respond('PreToolUse', merge, { environment: {}, ...ctx.options }).hookSpecificOutput.permissionDecision, 'deny');
  // Once the repository is decided, the user types it again and it is kept.
  gate.writeGovernanceDecision(ctx.repo, 'disable', ctx.options);
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
  // Typed in a repository whose governance question is still open, the message is held and nothing is kept.
  run({ hook_event_name: 'UserPromptSubmit', cwd: ctx.repo, session_id: 'codex-user', prompt: 'merge owner/a#618' });
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit', 'user-state', hold.APPROVALS_BASENAME)), false);
  assert.equal(run(merge).status, 2, 'held prompt kept nothing');
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

// ---- Connector merges in every GitHub shape (the merge-connector invariant table, rows 1 to 21) ----

// The diagnostic call: Codex's GitHub app, repository_full_name, pr_number and expected_head_sha.
const codexCall = (args = {}, tool = CODEX_MERGE) => ({
  cwd: os.tmpdir(), tool_name: tool,
  tool_input: { repository_full_name: DIAGNOSTIC_REPO, pr_number: 292, expected_head_sha: DIAGNOSTIC_SHA, merge_method: 'merge', commit_title: 'Merge pull request 292', commit_message: 'Quote fixes', ...args },
});
const codexCallFor = (repository, pr, args = {}) => codexCall({ repository_full_name: repository, pr_number: pr, expected_head_sha: SHA, ...args });
const shaped = (tool, args) => ({ cwd: os.tmpdir(), tool_name: tool, tool_input: args });
const MERGE_NAMES = ['mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__merge_pull_request', 'mcp__x__merge-pull-request', 'mcp__x__mergePullRequest', 'mcp__plugin_engineering_github__merge_pull_request', 'mcp__codex_apps__github_merge_pull_request'];
const AUTO_NAMES = ['mcp__github__enable_pr_auto_merge', 'mcp__codex_apps__github__enable_pr_auto_merge', 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__enable_pr_auto_merge', 'mcp__x__enable_auto_merge', 'mcp__x__enable_pull_request_auto_merge', 'mcp__x__enable-pr-auto-merge', 'mcp__x__enablePullRequestAutoMerge'];

function swooshzContext(t) {
  const ctx = context(t);
  ctx.swooshz = repository(ctx.root, 'swooshz', { slug: DIAGNOSTIC_REPO });
  return ctx;
}

test('rows 1-4: the diagnostic Codex merge is identified, held for the user, pinned by a typed SHA and needs its SHA field', (t) => {
  const ctx = swooshzContext(t);
  // Row 1: identified, not "cannot identify".
  const first = decide(ctx, codexCall()).deny;
  assert.match(first, new RegExp(`has not approved a merge of ${DIAGNOSTIC_REPO}#292`));
  assert.doesNotMatch(first, /cannot identify/);
  // Row 2: allowed once after the user's own line in that repository, then refused again.
  assert.equal(typed(ctx, 'merge 292', { cwd: ctx.swooshz }), 1);
  assert.equal(decide(ctx, codexCall()), null);
  assert.match(decide(ctx, codexCall()).deny, /has not approved/, 'used up');
  // Row 3: a typed SHA (all digits here, as this head's short SHA is) pins the head.
  assert.deepEqual(hold.approvalsIn('merge 292 at 7384901'), [{ repository: null, pr: 292, sha: '7384901' }]);
  typed(ctx, 'merge 292 at 7384901', { cwd: ctx.swooshz });
  assert.match(decide(ctx, codexCall({ expected_head_sha: SHA })).deny, new RegExp(`approved ${DIAGNOSTIC_REPO}#292 at 7384901`));
  assert.equal(decide(ctx, codexCall()), null);
  // Row 4: no head SHA field is refused, and the refusal names this shape's field, not a value.
  typed(ctx, 'merge 292', { cwd: ctx.swooshz });
  const noSha = decide(ctx, codexCall({ expected_head_sha: undefined })).deny;
  assert.match(noSha, /has repository_full_name and pr_number but no head SHA field\. Add expected_head_sha and retry/);
  assert.doesNotMatch(noSha, /Swooshz|292/);
  assert.equal(decide(ctx, codexCall()), null, 'the refused call did not use the approval');
});

test('row 5: the official server (pullNumber, expectedHeadSha) keeps today\'s outcomes', (t) => {
  const ctx = context(t);
  const call = (args = {}) => shaped('mcp__github__merge_pull_request', { owner: 'owner', repo: 'a', pullNumber: 618, expectedHeadSha: SHA, ...args });
  assert.match(decide(ctx, call()).deny, /has not approved a merge of owner\/a#618/);
  typed(ctx, 'merge 618');
  assert.match(decide(ctx, call({ expectedHeadSha: undefined })).deny, /but no head SHA field\. Add expectedHeadSha and retry/);
  assert.equal(decide(ctx, call()), null);
  assert.match(decide(ctx, call()).deny, /has not approved/, 'used up');
  // A digit-only string is a number too.
  typed(ctx, 'merge 618');
  assert.equal(decide(ctx, call({ pullNumber: '618' })), null);
});

// No server is known to pass a `sha` field on to GitHub, and one that drops it would merge whatever
// head is there, so `sha` is never the pin: the older shape (pull_number, sha) is refused even with
// an approval, as before, and pointed at gh, and a `sha` beside a real head field must not disagree.
test('row 5b: a sha field is never read as the head commit', (t) => {
  const ctx = context(t);
  const older = (args = {}) => shaped('mcp__github__merge_pull_request', { owner: 'owner', repo: 'a', pull_number: 618, sha: SHA, ...args });
  assert.match(decide(ctx, older()).deny, /has not approved a merge of owner\/a#618/);
  typed(ctx, 'merge 618');
  for (const call of [older(), older({ sha: undefined }), older({ pull_number: '618' })]) {
    const deny = decide(ctx, call).deny;
    assert.match(deny, /no head SHA field.*This tool has no head SHA field Toolkit reads, so use `gh pr merge 618 --match-head-commit <sha>` instead/, JSON.stringify(call.tool_input));
    assert.doesNotMatch(deny, /Add sha/);
  }
  assert.match(decide(ctx, older()).deny, /\(its sha field is not read, since not every server passes it to GitHub\)/);
  // With the official field names, sha alone is not enough either.
  assert.match(decide(ctx, shaped('mcp__github__merge_pull_request', { owner: 'owner', repo: 'a', pullNumber: 618, sha: SHA })).deny, /its sha field is not read.*Add expectedHeadSha and retry/);
  // A sha beside a real head field: the same commit is fine, another one is unclear.
  assert.match(decide(ctx, codexCallFor('owner/a', 618, { sha: DIAGNOSTIC_SHA })).deny, /names more than one head commit/);
  assert.equal(decide(ctx, codexCallFor('owner/a', 618, { sha: SHA })), null, 'the approval was still unused');
  assert.equal(hold.connectorMergeArgs(CODEX_MERGE, { repository_full_name: 'owner/a', pr_number: 618, sha: SHA }).sha, null);
});

test('rows 6-10: fields that disagree or cannot be read are refused, even with an approval', (t) => {
  const ctx = swooshzContext(t);
  typed(ctx, 'merge 292', { cwd: ctx.swooshz });
  typed(ctx, 'merge owner/a#292', { cwd: ctx.root });
  // Row 6: two numbers.
  assert.match(decide(ctx, codexCall({ pullNumber: 293 })).deny, /names more than one pull request \(found repository_full_name, pr_number, pullNumber and expected_head_sha, and they disagree\), so it is unclear and refused/);
  // Row 7: two repositories.
  assert.match(decide(ctx, codexCall({ repository_full_name: 'o/a', owner: 'o', repo: 'b' })).deny, /names more than one repository/);
  // Row 8: a number Toolkit cannot read, in connector wording, with no value echoed.
  for (const value of ['292abc', -1, 0, 1.5, '', null, '#292', [292], { n: 292 }, true, ' 292', '292 ', '\uff12\uff19\uff12', '0x124', '1e3', 2 ** 53, Number.NaN, Infinity, '292\n']) {
    const deny = decide(ctx, codexCall({ pr_number: value })).deny;
    assert.match(deny, /this merge tool call names a pull request Toolkit cannot identify \(found repository_full_name, pr_number and expected_head_sha; pr_number is not a positive whole number\)/, JSON.stringify(value));
  }
  assert.match(decide(ctx, codexCall({ pr_number: undefined })).deny, /cannot identify \(found repository_full_name and expected_head_sha; no pull request number field\)/);
  assert.match(decide(ctx, codexCall({ pull_number: 'x' })).deny, /pr_number and pull_number must each be a positive whole number/);
  // Row 9: a repository Toolkit cannot read.
  const repositories = ['o', 'o/a/b', 'o/a?x', '', 'o/a ', ' o/a', 'o/\u0430', 'o//a', 42, null, ...Object.values(hostile.BREAKS).map(end => `owner/a${end}`)];
  for (const value of repositories) assert.match(decide(ctx, codexCall({ repository_full_name: value })).deny, /Toolkit cannot tell which repository this merge tool call for pull request #292 is in/, JSON.stringify(value));
  for (const args of [{ owner: 'owner' }, { repo: 'a' }, { owner: 'owner', repo: 'a/b' }, { owner: 'owner', repo: ['a'] }]) {
    assert.match(decide(ctx, shaped('mcp__github__merge_pull_request', { pullNumber: 292, expectedHeadSha: SHA, ...args })).deny, /cannot tell which repository/, JSON.stringify(args));
  }
  // A readable repository_full_name does not cover for an unreadable owner and repo.
  assert.match(decide(ctx, codexCall({ owner: 'Swooshz-com' })).deny, /cannot tell which repository/);
  // Row 10: two head commits that disagree, and one that cannot be read.
  assert.match(decide(ctx, codexCall({ sha: SHA })).deny, /names more than one head commit/);
  assert.match(decide(ctx, codexCall({ expected_head_sha: 'not-a-sha' })).deny, /names a head commit Toolkit cannot read/);
  assert.match(decide(ctx, codexCall({ expected_head_sha: SHA.slice(0, 6) })).deny, /names a head commit Toolkit cannot read/);
  // Fields that agree are fine, in any letter case.
  assert.equal(decide(ctx, codexCall({ owner: 'swooshz-com', repo: 'Swooshz-Quote-Auto-Generator', pullNumber: '292', expectedHeadSha: DIAGNOSTIC_SHA.toUpperCase() })), null);
  // None of these refusals used the approval for owner/a#292.
  assert.equal(decide(ctx, shaped('mcp__x__merge_pull_request', { owner: 'owner', repo: 'a', pr_number: 292, expected_head_sha: SHA })), null);
});

test('rows 11-13 and 21: any merge tool name is held, auto-merge is always refused, and read tools pass', (t) => {
  const ctx = context(t);
  const args = { repository_full_name: 'owner/a', pr_number: 618, expected_head_sha: SHA };
  // Row 11: held exactly like the GitHub-named tool.
  for (const tool of MERGE_NAMES) {
    assert.match(decide(ctx, shaped(tool, args)).deny, /has not approved a merge of owner\/a#618/, tool);
    typed(ctx, 'merge 618');
    assert.equal(decide(ctx, shaped(tool, args)), null, tool);
    assert.match(decide(ctx, shaped(tool, args)).deny, /has not approved/, `${tool}: used up`);
  }
  // Row 12: auto-merge under any server name, with or without an approval or a SHA.
  for (const tool of AUTO_NAMES) {
    for (const call of [args, { ...args, expected_head_sha: undefined }]) {
      assert.match(decide(ctx, shaped(tool, call))?.deny || '', /^Toolkit: /, tool);
      typed(ctx, 'merge 618');
      assert.match(decide(ctx, shaped(tool, call))?.deny || '', /auto-merge cannot name the head commit/, `${tool} with an approval`);
    }
  }
  // Row 13: read tools are not merges.
  for (const tool of ['mcp__codex_apps__github__get_pull_request', 'mcp__github__pull_request_read', 'mcp__x__list_merge_requests', 'mcp__x__get_merge_status', 'mcp__x__unmerge_pull_request']) {
    assert.equal(decide(ctx, shaped(tool, args)), null, tool);
    assert.equal(hold.mayMerge(shaped(tool, args)), false, tool);
  }
  // Row 21: the failure path treats every merge and auto-merge name as a merge, so a crash fails closed.
  for (const tool of [CODEX_MERGE, ...MERGE_NAMES, ...AUTO_NAMES]) assert.equal(hold.mayMerge(shaped(tool, {})), true, tool);
  const broken = { environment: {}, ...ctx.options, mergeHold: { decide() { throw new Error('boom'); }, mayMerge: hold.mayMerge } };
  for (const tool of [CODEX_MERGE, ...MERGE_NAMES, ...AUTO_NAMES]) assert.match(claudeHook.respond('PreToolUse', shaped(tool, args), broken).hookSpecificOutput.permissionDecisionReason, /merge check failed/, tool);
});

test('row 14: both hook files send every merge tool name to the merge hold', () => {
  const root = path.resolve(__dirname, '..', '..');
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const governanceEntry = claude.find(entry => entry.hooks.some(hook => hook.command.includes('toolkit-governance-hook.cjs')));
  const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  for (const tool of [CODEX_MERGE, 'mcp__x__merge_pull_request', ...MERGE_NAMES, ...AUTO_NAMES]) {
    assert.match(tool, new RegExp(governanceEntry.matcher), `Claude: ${tool}`);
    assert.ok(codex.some(entry => new RegExp(entry.matcher).test(tool) && entry.hooks.some(hook => hook.command.includes('toolkit-codex-helper-hook.cjs'))), `Codex: ${tool}`);
  }
  // The packaged copies match the contract sources (compared as JSON, since a checkout may change line endings).
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const host of ['claude', 'codex']) {
    assert.deepEqual(read(path.join(root, `.${host}-plugin`, 'hooks', 'hooks.json')), read(path.join(root, 'repo', 'contracts', 'toolkit-local-bridge', `${host}-plugin`, 'hooks', 'hooks.json')), host);
  }
});

test('row 15: the Codex hook refuses the Codex-shaped merge, records a code-span approval, allows one merge and refuses again', (t) => {
  const ctx = context(t);
  const home = path.join(ctx.root, 'home');
  const script = path.resolve(__dirname, '..', 'scripts', 'toolkit-codex-helper-hook.cjs');
  const env = { ...process.env, HOME: home, USERPROFILE: home, TOOLKIT_HOST_SESSION: '', TOOLKIT_GATE_ROLE: '', TOOLKIT_NATIVE_HELPER_BINDING: '', TOOLKIT_CLAUDE_TASK_PROFILE_SHA256: '', CLAUDE_CODE_REMOTE: '' };
  const run = (input) => spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env, cwd: ctx.root });
  const merge = { cwd: ctx.root, tool_name: CODEX_MERGE, tool_input: { repository_full_name: 'owner/a', pr_number: 618, expected_head_sha: SHA, merge_method: 'merge' } };
  const refused = run(merge);
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stdout + refused.stderr, /has not approved a merge of owner\/a#618/);
  gate.startSession({ session_id: 'codex-user', source: 'startup', cwd: ctx.root }, { registryOptions: { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true } });
  const prompt = run({ hook_event_name: 'UserPromptSubmit', cwd: ctx.root, session_id: 'codex-user', prompt: 'Read the summary.\n`merge owner/a#618`' });
  assert.equal(prompt.status, 0, prompt.stdout + prompt.stderr);
  const allowed = run(merge);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.equal(run(merge).status, 2, 'used up');
});

test('rows 16-19: a line that is only a code span counts; other backticks, quotes and fenced lines do not', (t) => {
  // Row 16.
  for (const text of ['`merge 292`', '``merge 292``', '```merge 292```', '- `merge 292`', '1. `merge 292`', '` merge 292 `', '`merge owner/name#292`', '`merge 292 at 7384901`']) {
    assert.deepEqual(hold.approvalsIn(text).map(item => item.pr), [292], text);
  }
  // Row 17: everything else with a backtick or a quote, and every existing rule inside a span.
  for (const text of ['run `merge 292`', '`merge 292` later', '`merge 292', 'merge 292`', '`merge` 292', '``merge 292`', '````merge 292````', '`merge 292``', '"merge 292"', '> merge 292',
    '`> merge 292`', '`"merge 292"`', '`merge 292?`', '`don\'t merge 292`', '`merge 292 later`', '`merge main into 292`', '`merge 292` `merge 293`', '\u200b`merge 292`']) {
    assert.deepEqual(hold.approvalsIn(text), [], text);
  }
  // The quote and refusal shapes in the shared hostile set stay refused inside a code span.
  const quotes = hostile.cases(['free-text']).filter(shape => /quote|refusal|condition/.test(shape.id));
  hostile.expectDefaultDeny(assert, text => hold.approvalsIn(`\`${text}\``).length > 0, quotes);
  // Row 18: a fenced line never counts; the same line after the fence closes does.
  for (const [text, expected] of [
    ['```\nmerge 292\n```', []], ['~~~\nmerge 292\n~~~', []], ['```text\nmerge 292\n```\nmerge 293', [293]], ['~~~~\nmerge 292\n~~~\nmerge 293', []],
    ['````\n```\nmerge 292\n````\nmerge 293', [293]], ['```\nmerge 292\n```~\nmerge 293\n```\nmerge 294', [294]], ['- ```\n  merge 292\n  ```\nmerge 293', [293]],
    ['- - - - - - ```\nmerge 292', []], ['```\nmerge 292', []], ['\u200b```\nmerge 292\n```', []], ['```\n```\nmerge 293', [293]],
  ]) assert.deepEqual(hold.approvalsIn(text).map(item => item.pr), expected, JSON.stringify(text));
  for (const { id, text } of hostile.variants('looks good\n```\nmerge 292\n```')) assert.deepEqual(hold.approvalsIn(text), [], id);
  for (const { id, text } of hostile.variants('```\nmerge 292\n```\nmerge 293')) assert.deepEqual(hold.approvalsIn(text).map(item => item.pr), [293], id);
  // Row 19: the session guard is unchanged.
  const ctx = context(t);
  assert.equal(typed(ctx, '`merge 292`'), 1, 'the user\'s own session');
  assert.equal(typed(ctx, '`merge 292`', { session: userSession(ctx, 'resumed', 'resume') }), 0, 'a resumed run');
  assert.equal(typed(ctx, '`merge 292`', { environment: { TOOLKIT_HOST_SESSION: 'another' } }), 0, 'started by another session');
  assert.equal(typed(ctx, '`merge 292`', { session: 'unmarked' }), 0, 'no session-start mark');
});

test('the ask text shows the approval line as plain text', (t) => {
  const ctx = context(t);
  const deny = decide(ctx, codexCall()).deny;
  assert.match(deny, /as plain text and not in quotes, a line with the word merge and the pull request number, such as merge N or merge owner\/name#N/);
  assert.doesNotMatch(deny, /"merge N"/);
});
