'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { closingReferences, IssueClosureGuard } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
const adapter = require('../scripts/toolkit-issue-closure.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
const SHA = 'a'.repeat(40);
const repo = 'example.test/app';
function setup({ child = 'open', nested = false } = {}) {
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1); github.addIssue(2, { state: child, parent: 1 });
  if (nested) github.addIssue(3, { parent: 2 });
  const guard = new IssueClosureGuard({ transport: github, repository: repo });
  return { github, guard };
}
const keywords = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
const targets = ['#1', `${repo}#1`, `https://github.com/${repo}/issues/1`, `[record](https://github.com/${repo}/issues/1#issuecomment-7)`];
for (const keyword of keywords) for (const target of targets) for (const colon of ['', ':']) for (const upper of [false, true]) {
  const text = `${upper ? keyword.toUpperCase() : keyword}${colon} ${target}`;
  test(`closing grammar ${text}`, () => {
    assert.equal(closingReferences(text, repo)[0]?.number, 1);
    assert.equal(setup().guard.checkTexts([text]).status, 'refused');
  });
}
test('saved incident line and the earlier closed form are both defensive matches', () => {
  const line = '- Delta G2 PASS at `a3c5c0d`, with the Medium resolved (see [record 351](https://github.com/weijunswj/ai-agent-toolkit/issues/421#issuecomment-6654774337)).';
  for (const text of [line, line.replace('resolved', 'closed')]) {
    const references = closingReferences(text, repo);
    assert.equal(references[0].pattern, 'incident-record-link');
    const { github } = setup();
    github.repository = 'weijunswj/ai-agent-toolkit';
    github.issues.clear(); github.addIssue(421); github.addIssue(772, { parent: 421 });
    assert.equal(new IssueClosureGuard({ transport: github, repository: github.repository }).checkTexts([text]).status, 'refused');
  }
});
test('controls, lists, source locations and repository identities', () => {
  for (const text of ['Refs #1', 'Enclosed #1', 'prefixes #1', 'Resolved the discussion. Refs #1', 'Closed before the record #1']) assert.deepEqual(closingReferences(text, repo), [], text);
  const refs = closingReferences('Notes\nCloses #1, other.test/app#9 and #2; #3', repo);
  assert.deepEqual(refs.map(ref => [ref.repository, ref.number, ref.line]), [[repo, 1, 2], ['other.test/app', 9, 2], [repo, 2, 2], [repo, 3, 2]]);
  assert.equal(setup({ child: 'closed' }).guard.checkTexts(['Closes #1']).status, 'allowed');
  assert.equal(setup().guard.assertClosable(2).status, 'allowed');
  assert.equal(setup({ child: 'closed', nested: true }).guard.assertClosable(1).status, 'refused');
});
test('complete pagination includes uncatalogued children and refuses truncated or malformed reads', () => {
  const { github, guard } = setup({ child: 'closed' });
  for (let i = 3; i <= 102; i += 1) github.addIssue(i, { state: i === 102 ? 'open' : 'closed', parent: 1 });
  assert.equal(guard.assertClosable(1).status, 'refused');
  assert.ok(github.calls.some(call => call.path.endsWith('page=2')));
  assert.equal(new IssueClosureGuard({ transport: github, repository: repo, maxPages: 1 }).assertClosable(1).status, 'unknown');
  for (const response of [{ status: 403 }, { status: 200, json: {} }, { status: 200, json: null }]) {
    assert.equal(new IssueClosureGuard({ repository: repo, transport: { request: () => response } }).assertClosable(1).status, 'unknown');
  }
  assert.equal(new IssueClosureGuard({ repository: repo, transport: { request() { throw new Error('timeout'); } } }).assertClosable(1).status, 'unknown');
  assert.equal(new IssueClosureGuard({ repository: repo, transport: github, maxRequests: 1 }).assertClosable(1).status, 'unknown');
});
function prFixture(texts = ['Refs #1']) {
  const { github, guard } = setup();
  const pr = { number: 7, title: 'A change', body: 'Refs #1', head: { sha: SHA }, commits: texts.length, updated_at: 'now' };
  const original = github.request.bind(github);
  let reads = 0;
  github.request = (method, endpoint, body) => {
    if (endpoint === `repos/${repo}/pulls/7`) { reads += 1; return { status: 200, json: { ...pr } }; }
    if (endpoint.startsWith(`repos/${repo}/pulls/7/commits?`)) return { status: 200, json: texts.map(message => ({ commit: { message } })) };
    return original(method, endpoint, body);
  };
  return { github, guard, pr, reads: () => reads };
}
test('PR title, body, every commit, overrides, partial edits and metadata drift', () => {
  for (const surface of ['title', 'body', 'commit', 'merge']) {
    const f = prFixture(surface === 'commit' ? ['Refs #1', 'Fixes #1'] : undefined);
    if (['title', 'body'].includes(surface)) f.pr[surface] = 'Closes #1';
    assert.equal(f.guard.checkPullRequest(7, { head: SHA, mergeTexts: surface === 'merge' ? ['Closed #1'] : [] }).status, 'refused', surface);
  }
  const f = prFixture();
  assert.equal(f.guard.checkPullRequest(7, { head: SHA, body: 'Safe partial edit' }).status, 'allowed');
  assert.equal(f.guard.checkPullRequest(7, { head: 'b'.repeat(40) }).status, 'unknown');
  const original = f.github.request;
  f.github.request = (...args) => { if (args[1].endsWith('/pulls/7') && f.reads() > 0) f.pr.body += ' changed'; return original(...args); };
  assert.equal(f.guard.checkPullRequest(7, { head: SHA }).status, 'unknown');
});
const shell = command => ({ cwd: process.cwd(), tool_name: 'Bash', tool_input: { command } });
test('shell and connector closure matrix with positive read controls', () => {
  for (const command of [
    `gh pr create -R ${repo} --title 'Fixes #1' --body 'Details'`,
    `gh pr create -R ${repo} --title 'Change' --body 'Closes #1'`,
    `gh issue close 1 -R ${repo}`,
    `gh api repos/${repo}/issues/1 -X PATCH -f state=closed`,
    `gh api repos/${repo}/issues/1 -XPATCH -fstate=closed`,
    `gh api repos/${repo}/issues/1 -X PATCH -f 'state=$state'`,
    `gh api graphql -f 'query=mutation { closeIssue(input: {issueId: "opaque"}) { clientMutationId } }'`,
    `gh api repos/${repo}/pulls -X POST -f title=Change -f 'body=Fixes #1'`,
    `gh pr create -R ${repo} --fill`,
    `gh pr create -R ${repo} --title 'Change' --body-file -`,
    `gh pr create -R ${repo} --title 'Change' --body-file absent.txt`,
    `gh pr create -R ${repo} --title 'Change' --body '$generated'`,
    `gh pr edit 7 -R ${repo}`,
    `cd another; gh pr edit 7 --body 'Closes #1'`,
    `GH_REPO=other.test/app gh pr edit 7 --body 'Closes #1'`,
  ]) assert.ok(adapter.issueClosureDecision(shell(command), { guard: setup().guard })?.deny, command);
  for (const command of [`gh issue view 1 -R ${repo}`, `gh api repos/${repo}/issues/1`, "gh api graphql -f 'query=query($owner: String!) { viewer { login } }'", 'rg "closed" repo/docs', `gh pr create -R ${repo} --title 'Change' --body 'Refs #1'`, `gh -R${repo} pr create --title Change --body 'Refs #1'`]) assert.equal(adapter.issueClosureDecision(shell(command), { guard: setup().guard }), null, command);
  for (const [tool, args] of [['update_pull_request', { pull_number: 7, body: 'Closes #1' }], ['issue_write', { issue_number: 1, state: 'closed' }], ['close_issue', { issue_number: 1 }]]) {
    assert.ok(adapter.issueClosureDecision({ cwd: process.cwd(), tool_name: `mcp__github__${tool}`, tool_input: { owner: 'example.test', repo: 'app', ...args } }, { guard: prFixture().guard })?.deny);
  }
});
test('readable body files are inspected and partial edits retain the live title', t => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'closure-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'body.txt'); fs.writeFileSync(file, 'Closes #1');
  assert.ok(adapter.issueClosureDecision(shell(`gh pr create -R ${repo} --title Change --body-file "${file}"`), { guard: setup().guard })?.deny);
  fs.writeFileSync(file, 'Refs #1');
  assert.equal(adapter.issueClosureDecision(shell(`gh pr create -R ${repo} --title Change --body-file "${file}"`), { guard: setup().guard }), null);
  const f = prFixture(); f.pr.title = 'Fixes #1';
  assert.ok(adapter.issueClosureDecision(shell(`gh pr edit 7 -R ${repo} --body 'Safe'`), { guard: f.guard })?.deny);
});
test('hostile bounded readers never turn unreadable state into permission', () => {
  const hostile = require('./support/hostile-inputs.cjs');
  hostile.expectDefaultDeny(assert, text => new IssueClosureGuard({ repository: repo, transport: { request: () => ({ status: 200, json: { number: 1, state: text } }) } }).assertClosable(1).status === 'allowed', hostile.cases(['line-breaks', 'invisible']));
  assert.equal(setup().guard.checkTexts(['x'.repeat(1024 * 1024 + 1)]).status, 'unknown');
  for (const text of [null, {}, [], 1]) assert.equal(setup().guard.checkTexts([text]).status, 'unknown');
});

test('the programme parent is read first and misleading child summaries never hide native children', () => {
  const { github } = setup();
  const guard = new IssueClosureGuard({ transport: github, repository: repo, parentIssue: 1 });
  assert.equal(guard.checkTexts(['Fixes #2']).status, 'allowed');
  assert.equal(github.calls[0].path, `repos/${repo}/issues/1`);
  const original = github.request.bind(github);
  github.request = (...args) => {
    const response = original(...args);
    if (args[1] === `repos/${repo}/issues/1`) response.json.sub_issues_summary = { total: 0, completed: 0 };
    return response;
  };
  assert.equal(guard.assertClosable(1).status, 'refused');
  github.request = (...args) => args[1].includes('/issues/1/sub_issues?') ? { status: 403 } : original(...args);
  assert.equal(guard.assertClosable(2).status, 'unknown', 'an inaccessible bound parent holds even a leaf close');
});

test('aggregate text, target and request bounds return unknown', () => {
  assert.equal(setup().guard.checkTexts(['Closes #1 '.repeat(1001)]).status, 'unknown');
  assert.equal(setup().guard.checkTexts(['x'.repeat(600000), 'x'.repeat(600000)]).status, 'unknown');
  const f = prFixture();
  const guard = new IssueClosureGuard({ transport: f.github, repository: repo, maxRequests: 2 });
  assert.equal(guard.checkPullRequest(7, { head: SHA }).status, 'unknown');
});
