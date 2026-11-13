'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { closingReferences, IssueClosureGuard } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
const adapter = require('../scripts/toolkit-issue-closure.cjs');
const { GitHubTransport } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
const SHA = 'a'.repeat(40);
const repo = 'example.test/app';

test('attached hidden writes and variable command words refuse before guard calls', () => {
  let calls = 0;
  const guard = {assertClosable(){calls++;return {status:'allowed'};},checkTexts(){calls++;return {status:'allowed'};},checkEdit(){calls++;return {status:'allowed'};}};
  const close = `gh issue close 1 -R ${repo}`;
  for (const command of [`$sb={${close}}`,`?{${close}}`,`Where-Object{${close}}`,`Sort-Object{${close}}`,
    `Select-Object @{n='x';e={${close}}}`,`$h=@{a={${close}}}`,`$x =${close}`,`$x +=${close}`,
    `$r =bash -c '${close}'`,`$r = if ($a) {${close}}`,`foo {${close}}`,`Start-ThreadJob {${close}}`,
    '$sb={gh pr create}',`$sb={gh api -X PATCH repos/${repo}/issues/1 -f state=closed}`]) {
    for (const tool_name of ['PowerShell','Bash','exec_command']) {
      const result = adapter.issueClosureDecision({tool_name,tool_input:{command}},{guard});
      assert.match(result?.deny,/inside an assignment, script block or wrapper Toolkit does not read/,command);
      assert.match(result.deny,/quote it if it is only text/);
      assert.doesNotMatch(result.deny,/retry when GitHub is readable/);
    }
  }
  for (const command of ['gh issue $v 1','gh $n close','gh @a','& gh $a','gh "$@"','gh "${a[@]}"','gh pr $v 7',
    'function g { gh @args }; g issue close 1','g() { gh "$@"; }; g issue close 1','stdbuf -oL gh $n close 1']) {
    for (const tool_name of ['PowerShell','Bash','exec_command']) {
      const result = adapter.issueClosureDecision({tool_name,tool_input:{command}},{guard});
      assert.match(result?.deny,/takes its command words from a variable/ ,command);
      assert.doesNotMatch(result.deny,/retry when GitHub is readable/);
    }
  }
  assert.equal(calls,0);
});

test('stop-parsing and block comments reach closure guards while data and clean PR text pass', () => {
  let calls = 0;
  const guard = {assertClosable(){calls++;return {status:'refused',reason:'open native descendants'};}};
  for (const tool_name of ['PowerShell','Bash','exec_command']) for (const command of [
    `gh --% issue close 1 -R ${repo}`,`gh issue --% close 1 -R ${repo}`,`<# x #> gh issue close 1 -R ${repo}`,
  ]) assert.match(adapter.issueClosureDecision({tool_name,tool_input:{command}},{guard})?.deny,/open native descendants/,command);
  assert.equal(calls,9,'normalised commands reach assertClosable');
  for (const tool_name of ['PowerShell','Bash','exec_command']) for (const command of [
    'Write-Warning gh issue close 1','Write-Error gh issue close 1','Write-Verbose gh issue close 1',
    '<# gh issue close 1 #> gh pr view 7',`gh pr create --% -R ${repo} --title T --body 'Refs #1'`,
    `query='query { a }'; gh api graphql -f query="$query"`,
  ]) assert.equal(adapter.issueClosureDecision({tool_name,tool_input:{command}},{guard}),null,command);
  assert.equal(calls,9);
});

test('append, export and read cannot reuse a stale literal GraphQL query', () => {
  const mutation = 'mutation { closeIssue(input: {issueId: "x"}) { issue { id } } }';
  for (const middle of [`q+=' ${mutation}'`,`export q='${mutation}'`,'read q']) {
    const command = `q='query { a }'; ${middle}; gh api graphql -f query="$q"`;
    assert.match(adapter.issueClosureDecision(shell(command))?.deny,/GraphQL query variable is unresolved/,command);
  }
});
test('closure transport preserves existing Node options and quoted preload paths with spaces', t => {
  const { spawnSync } = require('node:child_process');
  const { fakeClosureEnvironment } = require('./support/issue-closure-transport.cjs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'closure transport '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const preload = path.join(dir, 'existing preload.cjs');
  fs.writeFileSync(preload, 'global.closurePreloadLoaded = true;');
  const quotedPreload = preload.replace(/[\\"]/g, (char) => `\\${char}`);
  for (const existing of [undefined, '--max-old-space-size=2048', `--require "${quotedPreload}"`]) {
    const environment = { ...process.env, NODE_OPTIONS: existing };
    const env = fakeClosureEnvironment(dir, environment, SHA);
    assert.equal(environment.NODE_OPTIONS, existing, 'the caller environment is unchanged');
    const transport = path.join(dir, 'closure-github', 'transport.cjs').replace(/[\\"]/g, (char) => `\\${char}`);
    assert.equal(env.NODE_OPTIONS, [existing, `--require "${transport}"`].filter(Boolean).join(' '));
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      assert.equal(global.closurePreloadLoaded === true, ${existing?.startsWith('--require') || false});
      const result = require('node:child_process').spawnSync('gh', ['api', '--include', '--method', 'GET', 'repos/example.test/app/pulls/7']);
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes(${JSON.stringify(SHA)}));
    `], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
test('closure adapters keep short hook reads and accept an explicit cold-runner timeout', () => {
  assert.equal(adapter.guardFor(repo, process.cwd(), { ghPath: process.execPath }).transport.timeoutMs, 5000);
  assert.equal(adapter.guardFor(repo, process.cwd(), { ghPath: process.execPath, timeoutMs: 30000 }).transport.timeoutMs, 30000);
});

test('per-request timeouts are bounded integers and never mutate the transport default', () => {
  const seen = [];
  const transport = new GitHubTransport({ ghPath: process.execPath, timeoutMs: 30000, run(file, args, options) { seen.push(options.timeout); return {status:0,stdout:'HTTP/2.0 200\n\n{}'}; } });
  transport.request('GET','repos/example.test/app',undefined,{timeoutMs:125.8});
  transport.request('GET','repos/example.test/app',undefined,{timeoutMs:50000});
  transport.request('GET','repos/example.test/app');
  assert.deepEqual(seen,[125,30000,30000]);
  assert.equal(transport.timeoutMs,30000);
});
test('PR read refusals identify metadata or commits and timeout or HTTP status', () => {
  for (const target of ['metadata', 'commits']) for (const failure of ['timeout', 'http']) {
    const endpoint = `repos/${repo}/pulls/7${target === 'commits' ? '/commits?per_page=100&page=1' : ''}`;
    const transport = new GitHubTransport({ ghPath: process.execPath, timeoutMs: 30000, run(file, args, options) {
      assert.equal(options.timeout, 30000);
      if (args[4] === endpoint) return failure === 'timeout'
        ? { error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
        : { status: 1, stdout: 'HTTP/2.0 403\n\n{}', stderr: '' };
      return { status: 0, stdout: 'HTTP/2.0 200\n\n' + JSON.stringify({ number: 7, title: 'Safe change', body: 'Refs #1', commits: 0, head: { sha: SHA } }) };
    } });
    // A fixed clock keeps each per-read timeout at exactly the 30 s deadline on a slow runner.
    const result = new IssueClosureGuard({ transport, repository: repo, now: () => 0 }).checkPullRequest(7, { head: SHA });
    assert.equal(result.status, 'unknown');
    assert.ok(result.reason.includes(`GET ${endpoint} failed: ${failure === 'timeout' ? 'timeout' : 'HTTP 403'}`), result.reason);
  }
});
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
  const refs = closingReferences('Notes\nCloses #1, other.test/app#9 and #2, #3', repo);
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
    if (endpoint.startsWith(`repos/${repo}/pulls/7/commits?`)) return { status: 200, json: texts.map((message, i) => ({ sha: (i + 1).toString(16).padStart(40, '0'), commit: { message } })) };
    return original(method, endpoint, body);
  };
  return { github, guard, pr, reads: () => reads };
}
test('PR title, body, every commit, overrides, partial edits and metadata drift', () => {
  for (const surface of ['title', 'body', 'commit', 'merge']) {
    const f = prFixture(surface === 'commit' ? ['Refs #1', 'Fixes #1'] : undefined);
    if (['title', 'body'].includes(surface)) f.pr[surface] = 'Closes #1';
    const result = f.guard.checkPullRequest(7, { head: SHA, mergeTexts: surface === 'merge' ? ['Closed #1'] : [] });
    assert.equal(result.status, 'refused', surface);
    const source = surface === 'commit' ? `commit ${'2'.padStart(40, '0')}` : surface === 'merge' ? 'merge override 1' : surface;
    assert.ok(result.reason.includes(`${source}, line 1, closing-keyword, target ${repo}#1`), result.reason);
  }
  const f = prFixture();
  assert.equal(f.guard.checkPullRequest(7, { head: SHA, body: 'Safe partial edit' }).status, 'allowed');
  assert.equal(f.guard.checkPullRequest(7, { head: 'b'.repeat(40) }).status, 'unknown');
  const original = f.github.request;
  f.github.request = (...args) => { if (args[1].endsWith('/pulls/7') && f.reads() > 0) f.pr.body += ' changed'; return original(...args); };
  assert.equal(f.guard.checkPullRequest(7, { head: SHA }).status, 'unknown');
  for (const field of ['head', 'title', 'body', 'commits']) {
    const fresh = prFixture(); const read = fresh.github.request;
    fresh.github.request = (...args) => {
      if (args[1].endsWith('/pulls/7') && fresh.reads() > 0) fresh.pr[field] = field === 'head' ? { sha: 'b'.repeat(40) } : field === 'commits' ? 2 : 'Changed text';
      return read(...args);
    };
    assert.equal(fresh.guard.checkPullRequest(7, { head: SHA }).status, 'unknown', `${field} drift`);
  }
});
const shell = command => ({ cwd: process.cwd(), tool_name: 'Bash', tool_input: { command } });
test('delta closure target and text matrix refuses writes while clean text makes no reads', t => {
  const cwd=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'closure-no-origin-'));
  const inheritedRepo=process.env.GH_REPO; delete process.env.GH_REPO;
  t.after(()=>{fs.rmSync(cwd,{recursive:true,force:true});if(inheritedRepo===undefined)delete process.env.GH_REPO;else process.env.GH_REPO=inheritedRepo;});
  const rows=[...require('./hook-pack/corpus/issue-closure.json').rows,...require('./hook-pack/corpus/closure-matrix.json').rows];
  const ids=['target-placeholder','target-var-repo','target-var-repo-braced','target-var-number','target-loop','target-pull-closing','target-pull-number-closing','target-var-endpoint','wrap-if','wrap-while','wrap-until','wrap-elif','wrap-not','wrap-time','wrap-timeout','wrap-nohup','wrap-sudo','wrap-nice','wrap-env-flags','wrap-xargs','wrap-chain','wrap-cmd','wrap-powershell-command','wrap-powershell-bare','subst-dq','subst-backtick','subst-backtick-dq','subst-nested','ps-percent','ps-foreach-object','ps-invoke-command','ps-elseif','ps-switch','ps-function','ps-start-process','sh-function','repo-before-verb-close','repo-before-verb-edit','heredoc-chain-shell','heredoc-pipe-shell','text-backtick-subst'];
  for(const id of ids) {
    const row=rows.find(row=>row.id==='CLOSURE.'+id); assert.ok(row,id);
    assert.ok(adapter.issueClosureDecision(row.payload,{guard:setup().guard})?.deny,id);
  }
  for(const id of ['text-backtick-body','text-backtick-title','text-dollar-body','literal-dollar-body','text-escaped-dollar','heredoc-body-clean','heredoc-dq-delim','heredoc-plain-clean','heredoc-literal-dollar','heredoc-body-quotes','heredoc-stdin-clean','here-string-body-clean','identity-cd-refs','identity-add-label','identity-title-only','identity-branch','identity-no-origin','identity-var-number','movement-clean']) {
    const row=rows.find(row=>row.id==='CLOSURE.'+id);
    assert.equal(adapter.issueClosureDecision({...row.payload,cwd},{transport:{request(){assert.fail('clean text must not read GitHub');}}}),null,id);
  }
  const {spawnSync}=require('node:child_process');
  assert.equal(spawnSync('git',['init','--quiet',cwd]).status,0);
  assert.equal(spawnSync('git',['-C',cwd,'remote','add','origin','git@forge-alias:example.test/app.git']).status,0);
  assert.equal(adapter.issueClosureDecision({...shell("gh pr edit 7 --body 'Refs #1'"),cwd},{transport:{request(){assert.fail('an SSH alias is irrelevant to clean text');}}}),null);
  assert.match(adapter.issueClosureDecision(shell('gh api -X PATCH repos/$REPO/issues/1 -f state=closed')).deny,/repository or number is not literal/);
  for(const id of ['text-ps-backslash-dollar','text-native-backslash-dollar','text-bash-argv-dollar','text-ps-argv-dollar','text-outer-expansion','text-outer-literal-dollar','text-ps-escaped-dollar','wrap-env-split-expanding','text-ps-unicode-variable','text-ps-rest-expansion']) {
    const row=rows.find(row=>row.id==='CLOSURE.'+id);assert.ok(row,id);
    assert.equal(Boolean(adapter.issueClosureDecision(row.payload,{guard:setup().guard})?.deny),row.expect.decision==='deny',id);
  }
  for(const id of ['heredoc-data-substitution','here-string-data-substitution','heredoc-literal-substitution','here-string-literal-substitution','heredoc-expanding-data','heredoc-quoted-opener','subst-comment-delimiter','redirect-literal-body','ps-bash-backtick','bash-powershell-backtick-data','wrap-env-split','wrap-powershell-text','wrap-cmd-text','ps-start-process-unknown']) {
    const row=rows.find(row=>row.id==='CLOSURE.'+id);assert.ok(row,id);
    assert.equal(Boolean(adapter.issueClosureDecision(row.payload,{guard:setup().guard})?.deny),row.expect.decision==='deny',id);
  }
});

test('create connectors accept absent or null text, retaining strict target identity', () => {
  for(const body of [undefined,null]) assert.equal(adapter.issueClosureDecision({tool_name:'mcp__github__create_pull_request',tool_input:{owner:'example.test',repo:'app',title:'Safe',body}},{guard:setup().guard}),null);
  assert.match(adapter.issueClosureDecision({tool_name:'mcp__github__create_pull_request',tool_input:{title:'Safe'}}).deny,/repository identity/);
});
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
    `gh pr create -R ${repo} --title 'Change' --body "$generated"`,
    `gh pr edit 7 -R ${repo}`,
    `cd another; gh pr edit 7 --body 'Closes #1'`,
    `GH_REPO=other.test/app gh pr edit 7 --body 'Closes #1'`,
  ]) assert.ok(adapter.issueClosureDecision(shell(command), { guard: setup().guard })?.deny, command);
  for (const command of [`gh pr create -R ${repo} --title Change --body '$generated'`, `gh issue view 1 -R ${repo}`, `gh api repos/${repo}/issues/1`, "gh api graphql -f 'query=query($owner: String!) { viewer { login } }'", 'rg "closed" repo/docs', `gh pr create -R ${repo} --title 'Change' --body 'Refs #1'`, `gh -R${repo} pr create --title Change --body 'Refs #1'`]) assert.equal(adapter.issueClosureDecision(shell(command), { guard: setup().guard }), null, command);
  for (const [tool, args] of [['update_pull_request', { pull_number: 7, body: 'Closes #1' }], ['issue_write', { issue_number: 1, state: 'closed' }], ['close_issue', { issue_number: 1 }]]) {
    assert.ok(adapter.issueClosureDecision({ cwd: process.cwd(), tool_name: `mcp__github__${tool}`, tool_input: { owner: 'example.test', repo: 'app', ...args } }, { guard: prFixture().guard })?.deny);
  }
});
test('readable body files are inspected; edits check supplied text and merge checks retain title coverage', t => {
  fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'closure-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'body.txt'); fs.writeFileSync(file, 'Closes #1');
  assert.ok(adapter.issueClosureDecision(shell(`gh pr create -R ${repo} --title Change --body-file "${file}"`), { guard: setup().guard })?.deny);
  fs.writeFileSync(file, 'Refs #1');
  assert.equal(adapter.issueClosureDecision(shell(`gh pr create -R ${repo} --title Change --body-file "${file}"`), { guard: setup().guard }), null);
  fs.writeFileSync(file, JSON.stringify({ body: 'Refs #1' }));
  assert.ok(adapter.issueClosureDecision(shell(`echo regenerate; gh api repos/${repo}/pulls/7 -X PATCH --input "${file}"`), { guard: setup().guard })?.deny);
  const f = prFixture(); f.pr.title = 'Fixes #1';
  assert.equal(adapter.issueClosureDecision(shell(`gh pr edit 7 -R ${repo} --body 'Safe'`), { guard: f.guard }), null);
  assert.equal(f.guard.checkPullRequest(7).status, 'refused');
});
test('hostile bounded readers never turn unreadable state into permission', () => {
  const hostile = require('./support/hostile-inputs.cjs');
  hostile.expectDefaultDeny(assert, text => new IssueClosureGuard({ repository: repo, transport: { request: () => ({ status: 200, json: { number: 1, state: text } }) } }).assertClosable(1).status === 'allowed', hostile.cases(['line-breaks', 'invisible']));
  assert.equal(setup().guard.checkTexts(['x'.repeat(1024 * 1024 + 1)]).status, 'unknown');
  for (const text of [null, {}, [], 1]) assert.equal(setup().guard.checkTexts([text]).status, 'unknown');
});

test('only closing targets are read and a root summary never replaces its native child list', () => {
  const { github } = setup();
  const guard = new IssueClosureGuard({ transport: github, repository: repo });
  assert.equal(guard.checkTexts(['Fixes #2']).status, 'allowed');
  assert.equal(github.calls[0].path, `repos/${repo}/issues/2`);
  assert.ok(github.calls.every(call => !call.path.includes('/issues/1')));
  const original = github.request.bind(github);
  github.request = (...args) => {
    const response = original(...args);
    if (args[1] === `repos/${repo}/issues/1`) response.json.sub_issues_summary = { total: 0, completed: 0 };
    return response;
  };
  assert.equal(guard.assertClosable(1).status, 'refused');
  github.request = (...args) => args[1].includes('/issues/1/sub_issues?') ? { status: 403 } : original(...args);
  assert.equal(guard.assertClosable(2).status, 'allowed', 'an inaccessible unrelated parent does not hold a leaf close');
  assert.equal(guard.checkTexts(['Closes #1']).status, 'unknown', 'an inaccessible closing target still holds');
});

test('slow sixty-child trees read only closing targets and skip proven leaves', () => {
  for (const state of ['open', 'closed']) {
    let elapsed = 0;
    const calls = [];
    const children = Array.from({ length: 60 }, (_, i) => ({ number: i + 2, state,
      url: `https://api.github.com/repos/${repo}/issues/${i + 2}`, sub_issues_summary: { total: 0 } }));
    const transport = { request(method, endpoint) {
      calls.push(endpoint); elapsed += 400;
      const row = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(endpoint);
      if (row) return { status: 200, json: { number: Number(row[1]), state: 'open', sub_issues_summary: { total: row[1] === '1' ? 60 : 0 } } };
      if (endpoint.includes('/issues/1/sub_issues?')) return { status: 200, json: children };
      if (endpoint.includes('/sub_issues?')) return { status: 200, json: [] };
      if (endpoint.endsWith('/pulls/7')) return { status: 200, json: { number: 7, title: 'Change', body: 'Refs #2', commits: 0, head: { sha: SHA } } };
      if (endpoint.includes('/pulls/7/commits?')) return { status: 200, json: [] };
      return { status: 404 };
    } };
    const guard = new IssueClosureGuard({ repository: repo, transport, now: () => elapsed });
    assert.equal(guard.checkPullRequest(7, { head: SHA }).status, 'allowed', 'a PR referencing a leaf needs no programme tree');
    assert.ok(calls.every(endpoint => !endpoint.includes('/issues/')));
    calls.length = 0;
    assert.equal(guard.checkTexts(['Closes #1']).status, state === 'open' ? 'refused' : 'allowed');
    assert.equal(calls.length, 2, 'one issue detail and one child page suffice for sixty proven leaves');
  }
});

test('a specific open-child refusal wins over another target with incomplete state', () => {
  const { guard } = setup();
  assert.equal(guard.checkTexts(['Closes #999, #1']).status, 'refused');
});

test('leaf optimisation preserves identity and cycle checks and adapters expose read bounds', () => {
  for (const url of [`https://api.github.com/repos/${repo}/issues/1`, 'https://api.github.com/repos/bad owner/app/issues/2']) {
    const transport = { request(method, endpoint) {
      return { status: 200, json: endpoint.includes('/sub_issues?')
        ? [{ number: url.endsWith('/1') ? 1 : 2, state: 'closed', url, sub_issues_summary: { total: 0 } }]
        : { number: 1, state: 'open' } };
    } };
    assert.equal(new IssueClosureGuard({ repository: repo, transport }).assertClosable(1).status, 'unknown');
    const guard = adapter.guardFor(repo, process.cwd(), { transport, deadlineMs: 120000, maxRequests: 9 });
    assert.equal(guard.deadlineMs, 120000);
    assert.equal(guard.maxRequests, 9);
  }
});

test('aggregate text, target and request bounds return unknown', () => {
  assert.equal(setup().guard.checkTexts(['Closes #1 '.repeat(1001)]).status, 'unknown');
  assert.equal(setup().guard.checkTexts(['x'.repeat(600000), 'x'.repeat(600000)]).status, 'unknown');
  const f = prFixture();
  const guard = new IssueClosureGuard({ transport: f.github, repository: repo, maxRequests: 2 });
  assert.equal(guard.checkPullRequest(7, { head: SHA }).status, 'unknown');
});

test('command data stays inert, flags keep arity, and unrelated API writes pass', () => {
  assert.ok(adapter.issueClosureDecision({ tool_name: 'PowerShell', tool_input: { command: `gh pr create -R ${repo} --title T --body { Closes #1 }` } }, { guard: setup().guard })?.deny, 'a script-block body is unreadable, not clean replacement text');
  for (const command of ['grep -rn "gh pr create" docs', 'git log --grep="gh issue close"', 'echo "gh pr edit later"', '# gh issue close 1', 'cat <<\'EOF\'\ngh issue close later\nEOF', 'for x in a b; do echo "gh pr edit $x"; done', "Write-Output @'\ngh pr edit later\n'@", `gh pr create -R ${repo} --draft --title T --body B`, `gh pr create -R ${repo} --label a --label b --reviewer a --reviewer b --title T --body B`, 'gh api -X POST repos/$REPO/issues/1/comments -f body="$(cat note.md)"', 'gh api graphql -f \'query=mutation { resolveReviewThread(input: {threadId: "closeIssue"}) { clientMutationId } }\'']) {
    assert.equal(adapter.issueClosureDecision(shell(command), { guard: setup().guard }), null, command);
  }
  for (const flag of ['--silent', '-i', '--include', '--verbose']) for (const before of [true, false]) {
    const command = `gh api ${before ? flag : ''} -X PATCH repos/${repo}/issues/1 ${before ? '' : flag} -f state=closed`;
    assert.ok(adapter.issueClosureDecision(shell(command), { guard: setup().guard })?.deny, command);
  }
  for (const command of [`gh pr edit 7 -R ${repo} --remove-milestone --body 'Closes #1'`, `bash -c "gh issue close 1 -R ${repo}"`, `for x in a; do gh issue close 1 -R ${repo}; done`, `& { gh issue close 1 -R ${repo} }`, `bash <<'EOF'\ngh issue close 1 -R ${repo}\nEOF`]) assert.ok(adapter.issueClosureDecision(shell(command), { guard: setup().guard })?.deny, command);
});

test('same-line boundaries terminate semicolons while comma and and remain lists', () => {
  for (const text of ['Fixes #12abc', 'Fixes\n#1', 'Closes #1; #2 stays open']) assert.deepEqual(closingReferences(text, repo).map(r => r.number), text.startsWith('Closes') ? [1] : [], text);
  assert.equal(closingReferences('fixed #333333 border', repo)[0].number, 333333);
  assert.deepEqual(closingReferences('Closes #1, #2 and #3', repo).map(r => r.number), [1,2,3]);
  assert.deepEqual(closingReferences('Fixes ' + ' '.repeat(500000) + 'prose', repo), []);
  const timed = require('./support/hostile-inputs.cjs').timing(text => closingReferences(text, repo), size => 'Fixes ' + ' '.repeat(size) + 'prose', { startSize: 4096, maxSize: 262144, minMs: 5 });
  assert.ok(timed.ok, timed.message);
});

test('PR target and same-repository missing references require the narrow resolution path', () => {
  for (const status of [404, 410, 200]) {
    const f = prFixture(['Fixes #9']); const original = f.github.request;
    f.github.request = (method, endpoint, ...rest) => endpoint === `repos/${repo}/issues/9` ? { status, json: { number: 9, state: 'open', pull_request: {} } } : original(method, endpoint, ...rest);
    assert.equal(f.guard.checkPullRequest(7).status, 'allowed');
    assert.ok(!f.github.calls.some(c => c.path.includes('/issues/9/sub_issues')));
    if (status !== 200) assert.equal(f.guard.checkTexts(['Fixes #9']).status, 'unknown');
    assert.equal(f.guard.checkTexts(['Fixes other.test/app#9']).status, 'unknown');
  }
});

test('pin prefixes, source diagnostics and harmless timestamp activity', () => {
  const f = prFixture();
  for (const head of [SHA.slice(0,7), SHA.toUpperCase()]) assert.equal(f.guard.checkPullRequest(7, { head }).status, 'allowed');
  const original = f.github.request;
  f.github.request = (...args) => { f.pr.updated_at += 'x'; return original(...args); };
  assert.equal(f.guard.checkPullRequest(7).status, 'allowed');
  for (const [source, apply] of [['title', () => { f.pr.title = 'Closes #1'; }], ['body', () => { f.pr.title = 'Safe'; f.pr.body = 'Closes #1'; }]]) {
    apply(); const result = f.guard.checkPullRequest(7);
    assert.match(result.reason, new RegExp(source + '.*line 1.*closing-keyword.*' + repo.replace('.', '\\.') + '#1'));
  }
});

test('large PRs stay unknown rather than silently truncating their commit list', () => {
  const f=prFixture(); f.pr.commits=251;
  assert.match(f.guard.checkPullRequest(7).reason,/250-commit/);
});

test('invalid connector fields and missing PR numbers never read transport', () => {
  const guard = { checkEdit() { assert.fail('must validate before reading'); } };
  for (const args of [{ owner: 'example.test', repo: 'app', body: 'Safe' }, { repository_full_name: repo, owner: 'other', repo: 'app', pr_number: 7 }, { repository_full_name: repo, pr_number: 7, pull_number: 8 }]) assert.ok(adapter.issueClosureDecision({ tool_name: 'mcp__github__update_pull_request', tool_input: args }, { guard })?.deny);
  for (const field of ['pr_number', 'pull_request_number']) assert.equal(adapter.issueClosureDecision({ tool_name: 'mcp__github__update_pull_request', tool_input: { repository_full_name: repo, [field]: 7, body: 'Refs #1' } }, { guard: prFixture().guard }), null);
});

test('GraphQL mutation fields ignore comments, aliases and string prose but preserve guarded state', () => {
  const read = {tool_name:'mcp__github__search_graphql_documents',tool_input:{query:'mutation closeIssue'}};
  assert.equal(adapter.issueClosureDecision(read), null);
  assert.equal(require('../scripts/toolkit-shell-call.cjs').closureWriteCandidate(read), false);
  for (const query of ['mutation { alias: resolveReviewThread(input: {threadId:"closeIssue"}) { id } }', 'mutation { updateIssue(input:{id:"opaque", title:"Closes #1"}) { id } }', 'mutation { updateIssue(input:{id:"opaque", state:OPEN}) { id } }', 'mutation { # closeIssue(input: {})\n resolveReviewThread(input:{threadId:"opaque"}) { id } }']) assert.equal(adapter.graphqlRelevant(query), false, query);
  for (const query of ['mutation { alias: closeIssue(input:{issueId:"opaque"}) { id } }', 'mutation { updateIssue(input:$input) { id } }', 'mutation { a: updateIssue(input:{id:"one",state:OPEN}) { id } b: updateIssue(input:{id:"two",state:CLOSED}) { id } }']) assert.equal(adapter.graphqlRelevant(query), true, query);
});

test('full walks distrust a zero descendant summary and share a remaining-time request cap', () => {
  const { github } = setup({ child: 'closed', nested: true }); const original = github.request.bind(github);
  let time = 0;
  github.request = (method, endpoint, body, options) => {
    assert.ok(options.timeoutMs <= 1000 - time); time += 10;
    const response = original(method, endpoint, body);
    if (endpoint.includes('/issues/1/sub_issues')) response.json[0].sub_issues_summary = { total: 0 };
    return response;
  };
  const guard = new IssueClosureGuard({ repository: repo, transport: github, now: () => time, deadlineMs: 1000 });
  assert.equal(guard.tree(repo, 1, guard.budget(), new Set(), { full: true }).descendants.some(c => c.number === 3 && c.state === 'open'), true);
});

test('hidden writes refuse by name before any transport read and hidden API reads stay data',()=>{
  let calls=0;const guard={assertClosable(){calls++;return {status:'allowed'};},checkTexts(){calls++;return {status:'allowed'};},checkEdit(){calls++;return {status:'allowed'};}};
  for(const command of [`$x = gh issue close 1 -R ${repo}`,`$x=gh issue close 1 -R ${repo}`,`[string]$x += gh issue close 1 -R ${repo}`,`$pr = gh pr create -R ${repo} --title T --body 'Refs #1'`,`stdbuf gh pr edit 7 -R ${repo} --body 'Closes #1'`,`$r = gh api -X PATCH repos/${repo}/issues/1 -f state=closed`,`1 | Where-Object { gh issue close 1 -R ${repo} }`])for(const tool_name of ['Bash','PowerShell','exec_command']){
    const result=adapter.issueClosureDecision({tool_name,tool_input:{command}},{guard});
    assert.match(result?.deny,/inside an assignment, script block or wrapper Toolkit does not read/ ,command);
    assert.doesNotMatch(result.deny,/retry when GitHub is readable/);
  }
  for(const command of ['$x = gh pr view 7','$x = gh pr create --help','$x = gh issue close 1 --help',`$x = gh api repos/${repo}/issues/1`,`$x = gh api -X POST repos/${repo}/issues/1/comments -f body=Refs`])assert.equal(adapter.issueClosureDecision({tool_name:'PowerShell',tool_input:{command}},{guard}),null,command);
  assert.equal(calls,0);
});

test('Start-Process reads one literal argument string with known options and refuses other gh forms',()=>{
  let calls=0;const guard={assertClosable(){calls++;return {status:'refused',reason:'open native descendants'};}};
  for(const command of [`Start-Process gh -ArgumentList 'issue close 1 -R ${repo}' -Wait -NoNewWindow`,`saps -FilePath gh.exe -PassThru -ArgumentList 'issue close 1 -R ${repo}'`,`start gh -ArgumentList 'issue close 1 -R ${repo}'`]){
    assert.match(adapter.issueClosureDecision({tool_name:'PowerShell',tool_input:{command}},{guard})?.deny,/open native descendants/,command);
  }
  assert.equal(calls,3,'literal closes reach assertClosable');
  for(const command of ["Start-Process gh -ArgumentList 'issue','close','1'","Start-Process gh -ArgumentList @('issue','close','1')","Start-Process gh -ArgumentList 'issue close 1' -Bogus","Start-Process -FilePath:gh -ArgumentList 'issue close 1'",`Start-Process bash -ArgumentList '-c','gh issue close 1 -R ${repo}'`])assert.match(adapter.issueClosureDecision({tool_name:'PowerShell',tool_input:{command}},{guard})?.deny,/Start-Process.*one literal argument string/,command);
  for(const command of ["Start-Process gh -ArgumentList 'pr view 7' -Wait","Start-Process notepad -ArgumentList 'notes.txt'","Start-Process pwsh -ArgumentList '-File','x.ps1'"])assert.equal(adapter.issueClosureDecision({tool_name:'PowerShell',tool_input:{command}},{guard}),null,command);
  assert.equal(calls,3);
});

test('read-only API text, literal dash values and document markers keep their controls',()=>{
  const allow=[`gh api graphql -f query="query { repository(owner: '$O') { id } }"`,`Q='query { viewer { login } }'; gh api graphql -f query="$Q"`,`$Q = 'query { viewer { login } }'; gh api graphql -f query="$Q"`,`gh api repos/${repo}/issues/5 -X GET --brand-new`,`gh api repos/${repo}/issues/5 --method=HEAD --brand-new`,`gh pr create -R ${repo} --title T --body '-x starts with dash'`,`gh pr create -R ${repo} --title T --body-file - <<'PR-BODY'\nRefs #1\nPR-BODY`,`cat <<\\EOF\ngh issue close 1\nEOF`];
  for(const command of allow)assert.equal(adapter.issueClosureDecision(shell(command),{guard:setup().guard}),null,command);
  for(const command of ['gh api graphql -f query="$Q"',`Q='mutation { closeIssue(input: {issueId: "x"}) { issue { id } } }'; gh api graphql -f query="$Q"`,'gh api graphql -f query="query { a } $M"','gh api graphql -f query="query A { a } $M { b }"',`Q='query { a }'; Q='query { b }'; gh api graphql -f query="$Q"`,`gh pr create -R ${repo} --title T --body --title`])assert.ok(adapter.issueClosureDecision(shell(command),{guard:setup().guard})?.deny,command);
  assert.match(adapter.issueClosureDecision({tool_name:'PowerShell',tool_input:{command:`$env:GH_REPO = 'x'; gh pr edit 7 --body 'Closes #1'`}},{guard:setup().guard})?.deny,/changes folder or GH_REPO/);
});

test('proven refusals omit unreadable-state recovery and moved body files name the actual recovery',()=>{
  const refused=adapter.issueClosureDecision(shell(`gh issue close 1 -R ${repo}`),{guard:setup().guard});
  assert.match(refused.deny,/open native descendants/);assert.doesNotMatch(refused.deny,/retry when GitHub is readable/);
  const moved=adapter.issueClosureDecision(shell(`cd sub && gh pr create -R ${repo} --title T --body-file f.md`),{guard:setup().guard});
  assert.match(moved.deny,/changes folder first.*absolute path/);assert.doesNotMatch(moved.deny,/may be generated/);
  const unknown=adapter.issueClosureDecision(shell(`gh issue close 1 -R ${repo}`),{guard:{assertClosable(){return {status:'unknown',reason:'unavailable'};}}});assert.match(unknown.deny,/retry when GitHub is readable/);
});

test('query variables require an executable literal assignment before the API call',()=>{
  assert.equal(adapter.issueClosureDecision({tool_name:'PowerShell',tool_input:{command:"$q = 'query { viewer { login } }'; gh api graphql -f query=\"$Q\""}},{guard:setup().guard}),null,'PowerShell variable names ignore case');
  assert.match(adapter.issueClosureDecision(shell("q='query { viewer { login } }'; gh api graphql -f query=\"$Q\""),{guard:setup().guard})?.deny,/query variable is unresolved/,'POSIX variables keep their case');
  for(const command of ["cat <<'EOF'\nQ='query { viewer { login } }'\nEOF\ngh api graphql -f query=\"$Q\"", "gh api graphql -f query=\"$Q\"; Q='query { viewer { login } }'", "if false; then Q='query { viewer { login } }'; fi; gh api graphql -f query=\"$Q\"", "function f {\nQ='query { viewer { login } }'\n}; gh api graphql -f query=\"$Q\"", "echo ready; Q='query { viewer { login } }'; gh api graphql -f query=\"$Q\""]) assert.match(adapter.issueClosureDecision(shell(command),{guard:setup().guard})?.deny,/query variable is unresolved/,command);
});

test('closing words wait for the owner while the PR UAT line is pending or invalid', () => {
  const pending = 'UAT: OWNER_TEST_NEEDED (open the page and check it)';
  const ref = (number, source = 'body') => [{ number, line: 3, source }];
  assert.match(adapter.uatClosingDecision(`Change\n\n${pending}\n\nCloses #756.`, ref(756)), /body, line 3 closes #756, but this PR's UAT line is OWNER_TEST_NEEDED.*Use Refs #756/);
  assert.match(adapter.uatClosingDecision('UAT: SKIP (x)\n\nFixes #9', ref(9)), /UAT line is invalid/);
  for (const body of ['UAT: PASSED (owner OK 12 Nov)\n\nCloses #1', 'UAT: NOT_REQUIRED (docs only)\n\nCloses #1', 'Closes #1'])
    assert.equal(adapter.uatClosingDecision(body, ref(1)), null, body);
  assert.equal(adapter.uatClosingDecision(`${pending}\n\nRefs #1`, []), null);
  const fail = { request() { assert.fail('the UAT check must not read GitHub'); } };
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'uat-closing-'));
  const file = path.join(dir, 'body.md');
  fs.writeFileSync(file, `${pending}\n\nresolves #5\n`);
  for (const command of [
    `gh pr create -R ${repo} --title Change --body-file "${file}"`,
    `gh pr edit 7 -R ${repo} --body-file "${file}"`,
  ]) assert.match(adapter.issueClosureDecision({ cwd: process.cwd(), tool_name: 'Bash', tool_input: { command } }, { transport: fail })?.deny ?? '', /Use Refs #5/, command);
  const connector = (body, title = 'Change') => adapter.issueClosureDecision({ cwd: process.cwd(), tool_name: 'mcp__github__create_pull_request', tool_input: { owner: 'example.test', repo: 'app', title, body } }, { transport: fail });
  assert.equal(connector(`${pending}\n\nCloses #5`).status, 'refused');
  assert.match(connector(pending, 'Fix #5 now').deny, /title, line 1 closes #5/);
  assert.equal(connector(`${pending}\n\nRefs #5`), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the CI check reads the live PR body and every closing reference', () => {
  const pr = { number: 7, title: 'Change', body: 'UAT: OWNER_TEST_NEEDED (try it)\n\nRefs #2', head: { sha: SHA }, commits: 1 };
  const responses = {
    [`repos/${repo}/pulls/7`]: pr,
    [`repos/${repo}/pulls/7/commits?per_page=100&page=1`]: [{ sha: SHA, commit: { message: 'Build it\n\nCloses #2' } }],
    [`repos/${repo}/issues/2`]: { number: 2, state: 'open', sub_issues_summary: { total: 0 } },
    [`repos/${repo}/issues/2/sub_issues?per_page=100&page=1`]: [],
  };
  const guard = new IssueClosureGuard({ repository: repo, transport: { request(method, apiPath) { if (!(apiPath in responses)) assert.fail(apiPath); return { status: 200, json: responses[apiPath] }; } } });
  const result = guard.checkPullRequest(7, { head: SHA });
  assert.equal(result.status, 'allowed');
  assert.equal(result.pr.body, pr.body);
  assert.match(adapter.uatClosingDecision(result.pr.body, result.references), /commit a{40}, line 3 closes #2/);
});

test('closing words wait while the target issue records an owed UAT', () => {
  const { owedUat } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  const block = state => `<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.70.1 sha256=0123456789ab -->\n<!-- programme-state child=2@4 -->\n- Status: ACTIVE\n- UAT: ${state}; review: PASSED\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n\nTask text.`;
  assert.equal(owedUat(block('PENDING')), 'PENDING');
  assert.equal(owedUat(block('UAT_FULL_REQUIRED')), 'UAT_FULL_REQUIRED');
  assert.equal(owedUat(block('UAT_PARTIAL_REQUIRED (STALE_HEAD, was abc1234)')), 'UAT_PARTIAL_REQUIRED');
  for (const state of ['PASSED', 'NOT_REQUIRED', 'UAT_RETAINED', '-']) assert.equal(owedUat(block(state)), null, state);
  assert.equal(owedUat('- UAT: PENDING; review: -\n'), null, 'only a generated STATE block counts');
  assert.equal(owedUat(null), null);
  const issue = (state, body) => ({ number: 2, state, body, sub_issues_summary: { total: 0 } });
  const guardWith = target => new IssueClosureGuard({ repository: repo, transport: { request(method, apiPath) {
    const rows = { [`repos/${repo}/issues/2`]: target, [`repos/${repo}/issues/2/sub_issues?per_page=100&page=1`]: [] };
    if (!(apiPath in rows)) assert.fail(apiPath);
    return { status: 200, json: rows[apiPath] };
  } } });
  const refused = guardWith(issue('open', block('PENDING'))).checkTexts(['UAT: NOT_REQUIRED (docs)\n\nCloses #2'], undefined, { sources: ['body'] });
  assert.equal(refused.status, 'refused');
  assert.match(refused.reason, /body, line 3.*records UAT PENDING.*use Refs/);
  assert.equal(guardWith(issue('open', block('PASSED'))).checkTexts(['Closes #2']).status, 'allowed');
  assert.equal(guardWith(issue('closed', block('PENDING'))).checkTexts(['Closes #2']).status, 'allowed');
  assert.equal(guardWith(issue('open', block('PENDING'))).checkTexts(['Refs #2']).status, 'allowed');
});

// A merged PR that references a task and still waits on the owner's test keeps the task open: a
// later PR's closing words are refused even when the task's own page has not recorded the owed test.
function ownerTestSetup(prBody, { merged = true, otherRepo = false } = {}) {
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1);
  const source = { number: 77, body: prBody, repository_url: `https://api.github.com/repos/${otherRepo ? 'someone/else' : repo}`,
    pull_request: { merged_at: merged ? '2026-11-12T10:00:00Z' : null } };
  github.intercept(call => (call.method === 'GET' && /\/issues\/1\/timeline\?/.test(call.path)
    ? { status: 200, json: [{ event: 'cross-referenced', source: { issue: source } }, { event: 'labeled' }] } : undefined));
  const { uatVerdict } = require('../scripts/toolkit-auto-merge-eligible.cjs');
  return new IssueClosureGuard({ transport: github, repository: repo, uatState: body => uatVerdict(body).state });
}
test('closing words are refused for a task a merged OWNER_TEST_NEEDED PR references', () => {
  const guard = ownerTestSetup('Refs #1\n\nUAT: OWNER_TEST_NEEDED (open the board and check the new line)');
  const result = guard.checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused');
  assert.match(result.reason, /merged PR #77, whose UAT line is still OWNER_TEST_NEEDED/);
});
for (const [label, body, options] of [
  ['the owner passed it', 'Refs #1\n\nUAT: PASSED (owner OK 12 Nov)', {}],
  ['no owner test was needed', 'Refs #1\n\nUAT: NOT_REQUIRED (docs only)', {}],
  ['the PR is not merged', 'Refs #1\n\nUAT: OWNER_TEST_NEEDED (try it)', { merged: false }],
  ['the PR is in another repository', 'Refs #1\n\nUAT: OWNER_TEST_NEEDED (try it)', { otherRepo: true }],
]) test(`closing words stay allowed when ${label}`, () => {
  assert.equal(ownerTestSetup(body, options).checkTexts(['Closes #1']).status, 'allowed');
});
// A merge train carries its members: its one UAT line is the strictest member's, so it must not
// hold an issue that one of its merged members references and answers for with its own UAT line.
const TRAIN_BODY = members => ['## Merge train', '', '| Member | Reviewed head | Tier | Bump | Review |', '|---|---|---|---|---|',
  ...members.map(pr => `| #${pr} | \`${String(pr % 10).repeat(40)}\` | NORMAL | patch | PASS |`), '',
  `UAT: OWNER_TEST_NEEDED (each member's own test after the merge: #${members[0]})`, '', 'Refs #1'].join('\n');
function timelineGuard(sources) {
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1);
  const events = sources.map(({ number, body, merged = true, at = '2026-11-12T10:00:00Z' }) => ({ event: 'cross-referenced', source: { issue: { number, body,
    repository_url: `https://api.github.com/repos/${repo}`, pull_request: { merged_at: merged ? at : null } } } }));
  github.intercept(call => (call.method === 'GET' && /\/issues\/1\/timeline\?/.test(call.path) ? { status: 200, json: events } : undefined));
  const { uatVerdict } = require('../scripts/toolkit-auto-merge-eligible.cjs');
  return new IssueClosureGuard({ transport: github, repository: repo, uatState: body => uatVerdict(body).state });
}
test('a merged train does not hold an issue its merged member answers for with UAT: NOT_REQUIRED', () => {
  const guard = timelineGuard([{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 947, body: 'Closes #1\n\nUAT: NOT_REQUIRED (internal)' }]);
  assert.equal(guard.checkTexts(['Closes #1']).status, 'allowed');
});
test('a merged train still holds when its referencing member itself waits on the owner', () => {
  const guard = timelineGuard([{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 948, body: 'Refs #1\n\nUAT: OWNER_TEST_NEEDED (try it)' }]);
  const result = guard.checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused');
  assert.match(result.reason, /merged PR #948,/);
});
for (const [label, sources] of [
  ['no member references the issue', [{ number: 970, body: TRAIN_BODY([948, 947]) }]],
  ['the referencing PR is not one of its members', [{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 950, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)' }]],
  ['the referencing member is not merged', [{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', merged: false }]],
  ['the body lacks the member table', [{ number: 970, body: TRAIN_BODY([947]).replace(/^\| Member .*$/m, '') }, { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)' }]],
]) test(`a merged train keeps its own hold when ${label}`, () => {
  const result = timelineGuard(sources).checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused');
  assert.match(result.reason, /merged PR #970,/);
});
// The train releases its hold only through a member it really carried (merged by it, at or just
// after the train) whose own strict UAT line owes nothing and that the train does not name as owing.
const MEMBER_LATER = '2026-11-12T10:00:02Z';
for (const [label, sources] of [
  ['the member has no strict UAT line (train 919, member #918)', [{ number: 919, body: TRAIN_BODY([918, 917]) }, { number: 917, body: 'Closes #1\n\nOwner UAT still owed after merge: reinstall', at: MEMBER_LATER }]],
  ['the member UAT line is invalid', [{ number: 970, body: TRAIN_BODY([948, 954]) }, { number: 954, body: 'Refs #1\n\nUAT: none needed', at: MEMBER_LATER }]],
  ['the train names that member as owing the test', [{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 948, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: MEMBER_LATER }]],
  ['the member merged before the train (a pasted table)', [{ number: 60, body: TRAIN_BODY([70, 50]) }, { number: 50, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: '2026-10-12T10:00:00Z' }]],
  ['the member merged long after the train', [{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: '2026-11-12T11:00:00Z' }]],
  ['another referencing member has no strict line', [{ number: 970, body: TRAIN_BODY([948, 947, 953]) }, { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: MEMBER_LATER }, { number: 953, body: 'Refs #1', at: MEMBER_LATER }]],
]) test(`a merged train keeps its hold when ${label}`, () => {
  const result = timelineGuard(sources).checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused');
  assert.match(result.reason, new RegExp(`merged PR #${sources[0].number},`));
});
test('a merged train releases its hold through a carried member whose UAT is PASSED', () => {
  const guard = timelineGuard([{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 947, body: 'Refs #1\n\nUAT: PASSED (owner OK)', at: MEMBER_LATER }]);
  assert.equal(guard.checkTexts(['Closes #1']).status, 'allowed');
});
test('mergeTrainMembers reads only a train body', () => {
  const { mergeTrainMembers } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  assert.deepEqual(mergeTrainMembers(TRAIN_BODY([948, 947])), [947, 948]);
  for (const body of ['Refs #1', TRAIN_BODY([947]).replace('## Merge train', '## Notes'), TRAIN_BODY([947]).replace(/^\| #947 .*$/m, ''), null]) assert.equal(mergeTrainMembers(body), null);
});
test('without a UAT reader (the skill copied alone) the merged-PR check is skipped', () => {
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1);
  let timeline = 0;
  github.intercept(call => { if (/\/timeline/.test(call.path)) timeline += 1; return undefined; });
  assert.equal(new IssueClosureGuard({ transport: github, repository: repo }).checkTexts(['Closes #1']).status, 'allowed');
  assert.equal(timeline, 0);
});
test('the hook guard passes the UAT reader', () => {
  const adapter = require('../scripts/toolkit-issue-closure.cjs');
  assert.equal(typeof adapter.guardFor(repo, process.cwd(), { ghPath: process.execPath }).uatState, 'function');
});
test('an open native child is still a proven refusal when the timeline cannot be read', () => {
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1); github.addIssue(2, { parent: 1 });
  github.intercept(call => (/\/timeline/.test(call.path) ? { status: 404, json: {} } : undefined));
  const { uatVerdict } = require('../scripts/toolkit-auto-merge-eligible.cjs');
  const result = new IssueClosureGuard({ transport: github, repository: repo, uatState: body => uatVerdict(body).state }).checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused', 'a cloud hook allows unknown, so a later failed read must not hide the open child');
});
