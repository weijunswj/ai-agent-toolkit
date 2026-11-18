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

// A task page as the reconciler draws it today: its STATE block from the real renderer, with the
// UAT in the hidden task status line (`<!-- Task status: <status> · UAT: <state> -->`).
function renderedTaskPage(uat, { head = SHA, gate = { role: 'G2', state: 'ACTIVE' } } = {}) {
  const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const child = { ...state.newChild({ repository: repo, outcome: { issue: 2, class: 'COMMITTED' } }), revision: 4, lifecycle: 'ACTIVE', gate: { ...state.newChild({ repository: repo, outcome: { issue: 2, class: 'COMMITTED' } }).gate, ...gate },
    pr: { number: 12, state: 'OPEN', head, checks: { state: 'SUCCESS', required_total: 1, required_passed: 1, at_head: head } },
    uat: { state: uat, at_head: uat === '-' ? null : SHA }, review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head, verdict: 'PASSED' }] } };
  if (uat === '-') child.uat.state = null;
  return `${state.renderBlock(state.renderChildBlockBody(child, { issue: 2, class: 'COMMITTED', order: 1 }), '3.126.0')}\n\nTask text.`;
}
test('closing words wait while the rendered task page records an owed UAT', () => {
  const { owedUat } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  const pending = renderedTaskPage('PENDING');
  assert.match(pending, /^<!-- Task status: IN PROGRESS · UAT: PENDING -->$/m, 'the renderer\'s own task status line');
  assert.match(pending, /^\|-\|#12\|OPEN · G2 ACTIVE · UAT owed\|-\|$/m, 'the PR GRAPH shows the owed UAT in the tracked PR\'s Status cell');
  assert.equal(owedUat(pending), 'PENDING');
  assert.equal(owedUat(renderedTaskPage('UAT_FULL_REQUIRED')), 'UAT_FULL_REQUIRED');
  const stale = renderedTaskPage('UAT_PARTIAL_REQUIRED', { head: 'b'.repeat(40) });
  assert.match(stale, / · UAT: UAT_PARTIAL_REQUIRED \(STALE_HEAD, was aaaaaaa\) -->/);
  assert.equal(owedUat(stale), 'UAT_PARTIAL_REQUIRED');
  for (const uat of ['PASSED', 'NOT_REQUIRED', 'UAT_RETAINED', '-']) assert.equal(owedUat(renderedTaskPage(uat)), null, uat);
  // Only the generated block counts: the same status line as plain text does not.
  assert.equal(owedUat(pending.replace(/<!-- AI-AGENT-TOOLKIT:[^\n]*\n/g, '')), null);
  // A gate text that spoofs a passed UAT ahead of the real one never removes the refusal.
  assert.equal(owedUat(renderedTaskPage('PENDING', { gate: { role: 'G2', state: 'ACTIVE · UAT: PASSED' } })), 'PENDING');
  const refused = new IssueClosureGuard({ repository: repo, transport: { request(method, apiPath) {
    const rows = { [`repos/${repo}/issues/2`]: { number: 2, state: 'open', body: pending, sub_issues_summary: { total: 0 } }, [`repos/${repo}/issues/2/sub_issues?per_page=100&page=1`]: [] };
    if (!(apiPath in rows)) assert.fail(apiPath);
    return { status: 200, json: rows[apiPath] };
  } } }).checkTexts(['UAT: NOT_REQUIRED (docs)\n\nCloses #2'], undefined, { sources: ['body'] });
  assert.equal(refused.status, 'refused');
  assert.match(refused.reason, /body, line 3.*records UAT PENDING.*use Refs/);
});

// A STATUS line an older Toolkit drew, before the PR GRAPH took the owed UAT, keeps counting.
test('closing words wait while a task page drawn by an older Toolkit records an owed UAT in its STATUS line', () => {
  const { owedUat } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  const block = line => `<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.128.0 sha256=0123456789ab -->\n<!-- programme-state child=2@4 -->\n# PR GRAPH\n\nNone yet.\n\n# STATUS\n\n${line}\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n\nTask text.`;
  assert.equal(owedUat(block('IN PROGRESS · Gate: G2 ACTIVE · Waiting on you: your UAT on PR #12 · UAT: PENDING · Review: PASSED')), 'PENDING');
  assert.equal(owedUat(block('IN PROGRESS · UAT: PASSED · Review: PASSED')), null);
});

// Older task pages may still carry the legacy `- UAT: <state>; review:` line; it keeps counting.
test('closing words wait while the target issue records an owed UAT (legacy STATE line)', () => {
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
// A merged train as GitHub shows it: its pull request, the merge commit that landed it on main, its
// commits (first parents from its head back to main, plus one branch commit under each boarding) and
// each commit's files. `chain` lists its first-parent commits oldest first:
//   ['board', head]            a merge whose second parent is `head` (a member's or an ejected head)
//   ['catchup']                a merge of a later main commit (main holds it)
//   ['sibling']                a merge of a branch main does not hold
//   ['octopus']                a merge of three commits
//   ['code', file]             a plain commit that changes a code file
//   ['bump'] / ['bumpRevert']  bump-version.cjs's bump, and eject's revert of it
//   ['bumpWithCode']           a bump that also changes a code line
//   ['eject', head, inexact]   eject's revert of the boarding of `head` (inexact: not its exact undo)
// Options: `start` (the commit the chain grows from; default main itself; main also holds EARLIER_TRAIN), `squash` (landed without a
// merge commit), `commits` (the commit count GitHub reports), `fail` (a path that answers HTTP 500).
const hex = label => require('node:crypto').createHash('sha1').update(String(label)).digest('hex');
const MAIN = hex('main');
const MAIN_LATER = hex('main-later');
const EARLIER_TRAIN = hex('earlier-train-head'); // a train that landed on main before this one
const memberFile = head => ({ filename: `src/member-${head.slice(0, 6)}.js`, status: 'added', patch: `@@ -0,0 +1,2 @@\n+// ${head.slice(0, 6)}\n+module.exports = 1;` });
const VERSION_PATCH = (from, to) => `@@ -1,4 +1,4 @@\n {\n   "name": "ai-agent-toolkit",\n-  "version": "${from}",\n+  "version": "${to}",\n   "description": "x"`;
const BUMP_FILES = [
  { filename: 'repo/contracts/toolkit-local-bridge/version.json', status: 'modified', patch: VERSION_PATCH('3.1.0', '3.2.0') },
  { filename: 'AGENTS.md', status: 'modified', patch: '@@ -10,3 +10,3 @@\n x\n-<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.1.0 sha256=0123456789ab -->\n+<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.2.0 sha256=0123456789ab -->\n y' },
  { filename: 'repo/docs/CHANGELOG.md', status: 'modified', patch: '@@ -1,2 +1,6 @@\n # Toolkit Changelog\n \n+## 3.2.0\n+\n+- **A note.**\n+' },
  { filename: 'repo/docs/changelog.d/claude-project-thread-a.md', status: 'removed', patch: '@@ -1 +0,0 @@\n-- **A note.**' },
];
const BUMP_REVERT_FILES = [
  { ...BUMP_FILES[0], patch: VERSION_PATCH('3.2.0', '3.1.0') },
  { ...BUMP_FILES[1], patch: BUMP_FILES[1].patch.replace('-<!--', '=<!--').replace('+<!--', '-<!--').replace('=<!--', '+<!--') },
  { ...BUMP_FILES[2], patch: '@@ -1,6 +1,2 @@\n # Toolkit Changelog\n \n-## 3.2.0\n-\n-- **A note.**\n-' },
  { ...BUMP_FILES[3], status: 'added', patch: '@@ -0,0 +1 @@\n+- **A note.**' },
];
function mergedTrain(github, number, { chain, start = MAIN, squash = false, commits, fail }) {
  const list = []; const files = new Map(); let parent = start;
  const plain = (sha, changed, message = 'Merge train: commit') => { list.push({ sha, parents: [{ sha: parent }], commit: { message } }); files.set(sha, changed); parent = sha; };
  const merge = (sha, others, changed) => { list.push({ sha, parents: [parent, ...others].map(p => ({ sha: p })), commit: { message: 'Merge train: board' } }); files.set(sha, changed); parent = sha; };
  chain.forEach(([kind, value, inexact], index) => {
    const sha = hex(`${number}-${index}-${kind}`);
    if (kind === 'board') {
      const branch = hex(`branch-${value}`);
      list.push({ sha: value, parents: [{ sha: branch }], commit: { message: 'member work' } }, { sha: branch, parents: [{ sha: MAIN }], commit: { message: 'member work' } });
      merge(sha, [value], [memberFile(value)]);
    } else if (kind === 'catchup') merge(sha, [MAIN_LATER], [{ filename: 'src/main-later.js', status: 'added', patch: '@@ -0,0 +1 @@\n+later' }]);
    else if (kind === 'sibling') {
      list.push({ sha: hex('sibling-branch'), parents: [{ sha: MAIN }], commit: { message: 'sibling work' } });
      merge(sha, [hex('sibling-branch')], [{ filename: 'src/sibling.js', status: 'added', patch: '@@ -0,0 +1 @@\n+sibling' }]);
    } else if (kind === 'octopus') merge(sha, [MAIN_LATER, hex('third')], []);
    else if (kind === 'code') plain(sha, [{ filename: value || 'src/extra.js', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }]);
    else if (kind === 'bump') plain(sha, BUMP_FILES, 'Merge train: bump minor for #947, #948');
    else if (kind === 'bumpRevert') plain(sha, BUMP_REVERT_FILES, 'Merge train: eject #949, revert the bump to re-bump without it');
    else if (kind === 'bumpWithCode') plain(sha, [...BUMP_FILES, { filename: 'repo/scripts/x.cjs', status: 'modified', patch: '@@ -1 +1 @@\n-const version = "3.1.0";\n+const version = "3.2.0"; run()' }]);
    else if (kind === 'eject') {
      const undo = memberFile(value);
      plain(sha, [{ ...undo, status: 'removed', patch: inexact ? '@@ -1,2 +0,0 @@\n-// other\n-module.exports = 2;' : undo.patch.replace('@@ -0,0 +1,2 @@', '@@ -1,2 +0,0 @@').replace(/^\+/gm, '-') }],
        `Merge train: eject #949 (failed CI)\n\nTrain-Eject-Head: ${value}\nTrain-Eject-PR: #949`);
    } else throw new Error(`unknown chain entry ${kind}`);
  });
  const head = parent; const landed = hex(`landed-${number}`);
  const answers = new Map([
    [`repos/${repo}/pulls/${number}`, { number, merged: true, head: { sha: head }, merge_commit_sha: landed, commits: commits ?? list.length }],
    [`repos/${repo}/commits/${landed}`, { sha: landed, parents: (squash ? [MAIN] : [MAIN, head]).map(sha => ({ sha })) }],
    [`repos/${repo}/pulls/${number}/commits?per_page=100&page=1`, list],
    ...[...files].map(([sha, changed]) => [`repos/${repo}/commits/${sha}`, { sha, files: changed }]),
  ]);
  const mainHolds = new Set([MAIN, MAIN_LATER, EARLIER_TRAIN]);
  github.intercept(call => {
    if (call.method !== 'GET') return undefined;
    if (fail && call.path === fail) return { status: 500, json: {} };
    if (answers.has(call.path)) return { status: 200, json: answers.get(call.path) };
    const compare = /^repos\/[^/]+\/[^/]+\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})\?per_page=1$/.exec(call.path);
    if (compare && compare[2] === MAIN) return { status: 200, json: { status: compare[1] === MAIN ? 'identical' : mainHolds.has(compare[1]) ? 'ahead' : 'diverged' } };
    // As GitHub answers it, the train's head holds every commit of its branch.
    if (compare && compare[2] === head) return { status: 200, json: { status: compare[1] === head ? 'identical' : list.some(entry => entry.sha === compare[1]) ? 'ahead' : 'diverged' } };
    return undefined;
  });
  return head;
}
// Each source may set `head` (its real head; a member defaults to the head its train row names); a
// train may set `chain` and the other mergedTrain options (default: every row boarded, then a bump),
// and `pulls` ({ <number>: { merged, head: { sha } } | null }) overrides how GitHub answers a row's
// pull request (null: not found). A row that is no source otherwise reads as merged at its row head.
function timelineGuard(sources, { trainBump = adapter.trainBumpFiles } = {}) {
  const pulls = Object.assign({}, ...sources.map(source => source.pulls || {}));
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1);
  const events = sources.map(({ number, body, merged = true, at = '2026-11-12T10:00:00Z' }) => ({ event: 'cross-referenced', source: { issue: { number, body,
    repository_url: `https://api.github.com/repos/${repo}`, pull_request: { merged_at: merged ? at : null } } } }));
  const { mergeTrainRows } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  const rowHead = new Map();
  for (const source of sources) for (const row of mergeTrainRows(source.body) || []) if (!rowHead.has(row.pr)) rowHead.set(row.pr, row.head);
  const heads = new Map(sources.map(source => [source.number, source.head || rowHead.get(source.number) || 'e'.repeat(40)]));
  github.intercept(call => {
    if (call.method !== 'GET') return undefined;
    if (/\/issues\/1\/timeline\?/.test(call.path)) return { status: 200, json: events };
    const pull = /\/pulls\/(\d+)$/.exec(call.path);
    const number = pull && Number(pull[1]);
    if (pull && Object.hasOwn(pulls, number)) return pulls[number] ? { status: 200, json: { number, ...pulls[number] } } : { status: 404, json: {} };
    if (pull && heads.has(number) && !mergeTrainRows(sources.find(source => source.number === number).body)) return { status: 200, json: { number, merged: true, head: { sha: heads.get(number) } } };
    if (pull && !heads.has(number) && rowHead.has(number)) return { status: 200, json: { number, merged: true, head: { sha: rowHead.get(number) } } };
    return undefined;
  });
  for (const source of sources) {
    const rows = mergeTrainRows(source.body);
    if (rows) mergedTrain(github, source.number, { chain: source.chain || [...rows.map(row => ['board', row.head]), ['bump']], ...source });
  }
  const { uatVerdict } = require('../scripts/toolkit-auto-merge-eligible.cjs');
  return Object.assign(new IssueClosureGuard({ transport: github, repository: repo, uatState: body => uatVerdict(body).state, trainBump }), { github });
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
for (const [label, sources] of [
  ['the member merged at a head other than the one its row names', [{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: MEMBER_LATER, head: 'd'.repeat(40) }]],
  ['the train does not board the member head (a pasted table naming a sibling)', [{ number: 970, body: TRAIN_BODY([948, 947]), chain: [['board', '8'.repeat(40)], ['board', hex('sibling')], ['bump']] }, { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: MEMBER_LATER }]],
]) test(`a merged train keeps its hold when ${label}`, () => {
  const result = timelineGuard(sources).checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused');
  assert.match(result.reason, /merged PR #970,/);
});
test('a merged train releases its hold through a carried member whose UAT is PASSED', () => {
  const guard = timelineGuard([{ number: 970, body: TRAIN_BODY([948, 947]) }, { number: 947, body: 'Refs #1\n\nUAT: PASSED (owner OK)', at: MEMBER_LATER }]);
  assert.equal(guard.checkTexts(['Closes #1']).status, 'allowed');
});
// Closure matrix B: a merged train releases a task only when its own commits prove it is a train.
// The task is referenced by train #970 (OWNER_TEST_NEEDED for #948) and its member #947, which owes
// nothing, so the train's hold is the only thing between `Closes #1` and the close.
const H948 = '8'.repeat(40); const H947 = '7'.repeat(40); const EJECTED = hex('ejected-949');
const MEMBER_947 = { number: 947, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: MEMBER_LATER };
const TRAIN_970 = { number: 970, body: TRAIN_BODY([948, 947]) };
// A pasted table can also list a sibling branch's head as a row of its own.
const SIBLING = hex('sibling-branch');
const SIBLING_ROW = pr => TRAIN_970.body.replace(/^(\| #947 .*)$/m, `$1\n| ${pr} | \`${SIBLING}\` | NORMAL | patch | PASS |`);
for (const [label, train, expected, reason] of [
  ['member merges only, last commit a version-only bump', { chain: [['board', H948], ['board', H947], ['bump']] }, 'allowed'],
  ['plus a main catch-up merge', { chain: [['board', H948], ['catchup'], ['board', H947], ['bump']] }, 'allowed'],
  ['plus a recorded eject revert (bump, bump revert, eject revert, fresh bump)', { chain: [['board', H948], ['board', EJECTED], ['board', H947], ['bump'], ['bumpRevert'], ['eject', EJECTED], ['bump']] }, 'allowed'],
  ['a stacked train, grown from an earlier train main now holds, then caught up', { start: EARLIER_TRAIN, chain: [['board', H948], ['board', H947], ['catchup'], ['bump']] }, 'allowed'],
  ['members only and no bump (a train at level none)', { chain: [['board', H948], ['board', H947]] }, 'allowed'],
  ['a merge of a sibling branch that is neither a row head nor in main', { chain: [['board', H948], ['sibling'], ['board', H947], ['bump']] }, 'refused'],
  ['a plain commit that changes a code file', { chain: [['board', H948], ['board', H947], ['code'], ['bump']] }, 'refused'],
  ['a last commit that changes a code file instead of a bump', { chain: [['board', H948], ['board', H947], ['code']] }, 'refused'],
  ['a last commit that changes a changelog fragment folder README', { chain: [['board', H948], ['board', H947], ['code', 'repo/docs/changelog.d/README.md']] }, 'refused'],
  ['a bump that also changes a code line', { chain: [['board', H948], ['board', H947], ['bumpWithCode']] }, 'refused'],
  ['a bump before a member merge', { chain: [['board', H948], ['bump'], ['board', H947]] }, 'refused'],
  ['a sibling merge whose head the table adds under a pull request that does not exist', { body: SIBLING_ROW('#9999'), pulls: { 9999: null }, chain: [['board', H948], ['sibling'], ['board', H947], ['bump']] }, 'refused'],
  ['a sibling merge whose head the table adds under an open pull request', { body: SIBLING_ROW('#9998'), pulls: { 9998: { merged: false, head: { sha: SIBLING } } }, chain: [['board', H948], ['sibling'], ['board', H947], ['bump']] }, 'refused'],
  ['a sibling merge whose head the table adds under a pull request merged at another head', { body: SIBLING_ROW('#9997'), pulls: { 9997: { merged: true, head: { sha: 'd'.repeat(40) } } }, chain: [['board', H948], ['sibling'], ['board', H947], ['bump']] }, 'refused'],
  ['a sibling merge whose head the table names as the train itself', { body: SIBLING_ROW('#970'), chain: [['board', H948], ['sibling'], ['board', H947], ['bump']] }, 'refused'],
  ['a sibling merge whose head is listed only in the Ejected table', { body: `${TRAIN_970.body}\n\n### Ejected\n\n| Pull request | Head | Reason | Next step |\n|---|---|---|---|\n| #949 | \`${SIBLING}\` | failed CI | rejoin later |`, pulls: { 949: { merged: false, head: { sha: SIBLING } } }, chain: [['board', H948], ['sibling'], ['board', H947], ['bump']] }, 'refused'],
  ['a merged head the table does not list and nothing reverts', { chain: [['board', H948], ['board', EJECTED], ['board', H947], ['bump']] }, 'refused'],
  ['an eject revert that is not the exact undo of its boarding', { chain: [['board', H948], ['board', EJECTED], ['board', H947], ['eject', EJECTED, true], ['bump']] }, 'refused'],
  ['an eject revert of a head the train never merged', { chain: [['board', H948], ['board', H947], ['eject', EJECTED], ['bump']] }, 'refused'],
  ['a row boarded twice', { chain: [['board', H948], ['board', H947], ['board', H947], ['bump']] }, 'refused'],
  ['the member the release relies on is not boarded', { chain: [['board', H948], ['bump']] }, 'refused'],
  ['a merge of three commits', { chain: [['board', H948], ['board', H947], ['octopus'], ['bump']] }, 'refused'],
  ['a member table but no merges (not a train)', { chain: [['bump']] }, 'refused'],
  ['a train landed without a merge commit', { squash: true, chain: [['board', H948], ['board', H947], ['bump']] }, 'refused'],
  ['a chain that starts from a commit main does not hold', { start: hex('elsewhere'), chain: [['board', H948], ['board', H947], ['bump']] }, 'refused'],
  ['more commits than GitHub lists for a pull request', { commits: 251, chain: [['board', H948], ['board', H947], ['bump']] }, 'unknown', /more than 250 commits/],
  ['a commit list shorter than the commit count', { commits: 9, chain: [['board', H948], ['board', H947], ['bump']] }, 'unknown', /commits incomplete/],
  ['a failed read of the train commits', { fail: `repos/${repo}/pulls/970/commits?per_page=100&page=1`, chain: [['board', H948], ['board', H947], ['bump']] }, 'unknown', /HTTP 500/],
]) test(`closure matrix B: a merged train with ${label}: ${expected}`, () => {
  const result = timelineGuard([{ ...TRAIN_970, ...train }, MEMBER_947]).checkTexts(['Closes #1']);
  assert.equal(result.status, expected, result.reason);
  if (expected === 'refused') assert.match(result.reason, /merged PR #970,/);
  if (reason) assert.match(result.reason, reason);
});
test('closure matrix B: a train read past the request budget is an unknown', () => {
  const guard = timelineGuard([{ ...TRAIN_970, chain: [['board', H948], ['board', H947], ['bump']] }, MEMBER_947]);
  guard.maxRequests = 6;
  const result = guard.checkTexts(['Closes #1']);
  assert.equal(result.status, 'unknown');
  assert.match(result.reason, /exceeded their bound/);
});
test('closure matrix B: without a bump reader no train with a bump releases', () => {
  const result = timelineGuard([{ ...TRAIN_970, chain: [['board', H948], ['board', H947], ['bump']] }, MEMBER_947], { trainBump: null }).checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused');
});
test('closure matrix B: a six-member train is proven in eleven reads beyond the task itself', () => {
  const prs = [941, 942, 943, 944, 945, 946];
  const body = TRAIN_BODY(prs).replace(/^UAT: .*$/m, 'UAT: OWNER_TEST_NEEDED (each member\'s own test after the merge: #946)');
  const members = prs.slice(0, 5).map(number => ({ number, body: 'Refs #1\n\nUAT: NOT_REQUIRED (x)', at: MEMBER_LATER }));
  const guard = timelineGuard([{ number: 970, body }, ...members]);
  const before = guard.github.calls.length;
  assert.deepEqual(guard.ownerTestPrs(repo, 1, guard.budget()), [], 'the train releases the task');
  const reads = guard.github.calls.slice(before).map(call => call.path);
  // One timeline page, five member PRs, then the train: its PR, merge commit, commit page, the PR of
  // the member that does not back the task (#946) and the bump.
  assert.equal(reads.length, 11, reads.join('\n'));
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
  const guard = adapter.guardFor(repo, process.cwd(), { ghPath: process.execPath });
  assert.equal(typeof guard.uatState, 'function');
  assert.equal(guard.trainBump, adapter.trainBumpFiles);
});
test('an open native child is still a proven refusal when the timeline cannot be read', () => {
  const github = new FakeGitHub({ repository: repo });
  github.addIssue(1); github.addIssue(2, { parent: 1 });
  github.intercept(call => (/\/timeline/.test(call.path) ? { status: 404, json: {} } : undefined));
  const { uatVerdict } = require('../scripts/toolkit-auto-merge-eligible.cjs');
  const result = new IssueClosureGuard({ transport: github, repository: repo, uatState: body => uatVerdict(body).state }).checkTexts(['Closes #1']);
  assert.equal(result.status, 'refused', 'a cloud hook allows unknown, so a later failed read must not hide the open child');
});

// Shapes that hid a guarded gh write from the reader: each must refuse by name or reach the guard,
// which refuses the close; the controls keep their earlier decision.
test('hash values, data-owner groups, cmd scripts, runners and argument forms cannot hide a guarded write', () => {
  const guard = { assertClosable() { return { status: 'refused', reason: 'open native descendants' }; }, checkTexts() { return { status: 'allowed' }; }, checkEdit() { return { status: 'allowed' }; } };
  const close = `gh issue close 1 -R ${repo}`;
  const all = ['PowerShell', 'Bash', 'exec_command'];
  const powershell = ['PowerShell', 'exec_command'];
  const hostile = [
    [`$h=@{a=${close}}`, powershell], [`@{a=${close}}`, powershell], [`[pscustomobject]@{a=${close}}`, powershell],
    [`$h=@{\n a=1\n b=${close}\n}`, powershell], [`Select-Object @{n='x';e=${close}}`, powershell],
    [`Write-Host (Invoke-Command {${close}})`, all], [`cat (Invoke-Command {${close}})`, all],
    [`Write-Output @{a=$(${close})}`, all], [`echo @{a=$(${close})}`, all],
    [`cmd /c "type <# & ${close} & rem #>"`, all], [`cmd /c "type x & # & ${close}"`, all],
    [`cmd /c "echo 'x & ${close} & rem '"`, all], [`cmd /c '"a\\" & ${close} & rem "'`, all], [`cmd /c "echo {x & ${close} & rem }"`, all],
    [`iex @'\n${close}\n'@`, powershell], [`iex @"\n${close}\n"@`, powershell], [`pwsh -Command @'\n${close}\n'@`, powershell],
    [`iex('${close}')`, powershell], [`Invoke-Expression ('${close}')`, powershell],
    [`sh -c '"$0" "$@"' ${close}`, all], [`bash -c '"$@"' x ${close}`, all],
    [`gh ('issue','close','1')`, powershell], [`gh issue ('close') 1 -R ${repo}`, powershell],
    [`gh api ('repos/${repo}/issues/1') -X PATCH -f state=closed`, powershell],
    ['gh api @params', powershell], ['gh api $e -X PATCH @f', powershell], ['gh pr edit 7 --add-label x @rest', powershell],
    [`@{a=iex '${close}'}`, powershell], [`@{a=Invoke-Expression '${close}'}`, powershell], [`@{a=pwsh -c '${close}'}`, powershell],
    [`@{a=bash -c '${close}'}`, powershell], [`@{a=cmd /c "${close}"}`, powershell],
    [`@{a=Start-Process gh -ArgumentList 'issue close 1 -R ${repo}'}`, powershell],
    [`sh -c '$1' x '${close}'`, all], [`sh -c "$1" x '${close}'`, ['PowerShell']], [`sh -c 'eval "$1"' x '${close}'`, all],
    [`Write-Host {${close}}.Invoke()`, powershell], [`cat {${close}}.Invoke()`, powershell],
    ['cmd /c "echo `" & ' + close + ' & rem `""', ['PowerShell']],
    [`iex ('gh issue' + ' close 1 -R ${repo}')`, powershell], [`iex ('gh {0} close 1 -R ${repo}' -f 'issue')`, powershell],
    [`bash -c '$@' x gh 'issue close 1 -R ${repo}'`, all], [`sh -c '$1 $2' x gh 'issue close 1 -R ${repo}'`, all],
    [`sh -c '"$1" $2' x gh 'issue close 1 -R ${repo}'`, all],
    [`Write-Output {${close}} | % Invoke`, powershell], [`echo {${close}} | ForEach-Object { & $_ }`, powershell],
    [`iex ([string]::Concat('gh issue',' close 1 -R ${repo}'))`, powershell], [`iex ('gh issue','close 1 -R ${repo}' -join ' ')`, powershell],
    [`Write-Host {${close}}?.Invoke()`, powershell],
  ];
  for (const [command, tools] of hostile) for (const tool_name of tools) {
    const result = adapter.issueClosureDecision({ tool_name, tool_input: { command } }, { guard });
    assert.ok(result?.deny, `${tool_name}: ${command}`);
    assert.doesNotMatch(result.deny, /retry when GitHub is readable/, `${tool_name}: ${command}`);
  }
  const controls = [
    [`Write-Host 'gh issue close 1'`, all], [`Write-Output @{a='gh issue close 1'}`, all], ['gh api $url', all],
    [`gh pr create -R ${repo} --title T --body 'Refs #1' --assignee @me`, all], [`gh pr edit 7 -R ${repo} --add-reviewer @me`, all],
    ['a=gh issue close 1', ['Bash']], ['@{a=Write-Host x}', powershell], ['$h=@{a=1}', powershell], [`sh -c 'echo "$1"' x 'gh pr view 7'`, all],
    [`$p=@{a=1}; Invoke-RestMethod @p`, powershell], ['GH_REPO=o/r gh pr view 7', all], ['echo {gh issue close 1}.txt', ['Bash']], ['Write-Host {gh issue close 1} | Out-Null', powershell],
    [`bash -c '$@' x gh 'pr view 7'`, all], [`iex "Write-Host ('a' + 'b')"`, powershell], [`<# gh issue close 1 #> gh pr view 7`, powershell], ['cmd /c "echo gh issue close 1"', all],
    [`query='query { a }'; gh api graphql -f query="$query"; gh api graphql -f query="$query"`, all],
    [`query='query { a }'; gh api graphql -F query="$query"; gh api graphql --raw-field query="$query"`, all],
  ];
  for (const [command, tools] of controls) for (const tool_name of tools)
    assert.equal(adapter.issueClosureDecision({ tool_name, tool_input: { command } }, { guard }), null, `${tool_name}: ${command}`);
});
