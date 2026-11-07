'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
require('node:test')('cloud connector merge overrides refuse closing text and advise unknowns without a doubled prefix',()=>{
  const assert=require('node:assert/strict');
  const hook=require('../scripts/toolkit-governance-hook.cjs');
  const {IssueClosureGuard}=require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  const guard=new IssueClosureGuard({repository:'example.test/app',transport:{request(method,endpoint){
    if(endpoint.endsWith('/pulls/7')) return {status:200,json:{number:7,title:'Safe',body:'Refs #1',head:{sha:'a'.repeat(40)},commits:0}};
    return endpoint.includes('sub_issues')?{status:200,json:[{number:2,state:'open',url:'https://api.github.com/repos/example.test/app/issues/2',sub_issues_summary:{total:0}}]}:{status:200,json:{number:1,state:'open',sub_issues_summary:{total:1,completed:0}}};
  }}});
  for(const key of ['commit_title','commit_message','commitTitle','commitMessage']) {
    const input={tool_name:'mcp__github__merge_pull_request',tool_input:{owner:'example.test',repo:'app',pull_number:7,[key]:'Closes #1'}};
    const result=hook.respond('PreToolUse',input,{environment:{CLAUDE_CODE_REMOTE:'true'},guard});
    assert.equal(result.hookSpecificOutput.permissionDecision,'deny',key);
    input.tool_input[key]={};
    const unknown=hook.respond('PreToolUse',input,{environment:{CLAUDE_CODE_REMOTE:'true'},guard});
    assert.match(unknown.systemMessage,/Toolkit advisory:/);assert.doesNotMatch(unknown.systemMessage,/advisory: Toolkit:/);
    input.tool_input[key]='Refs #1';
    assert.deepEqual(hook.respond('PreToolUse',input,{environment:{CLAUDE_CODE_REMOTE:'true'},guard}),{});
  }
  const both={tool_name:'mcp__github__merge_pull_request',tool_input:{owner:'example.test',repo:'app',pull_number:7,commit_message:'Safe',commitMessage:'Closes #1'}};
  assert.equal(hook.respond('PreToolUse',both,{environment:{CLAUDE_CODE_REMOTE:'true'},guard}).hookSpecificOutput.permissionDecision,'deny','a clean alias cannot mask closing text in another supplied alias');
});

test('task command exception is a literal managed command with independent scope', t => {
  const policy = require('../scripts/toolkit-task-policy.cjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-policy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const managed = path.join(home, 'managed');
  const current = path.join(home, '.ai-agent-toolkit', 'current');
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(path.join(managed, 'repo', 'scripts'), { recursive: true });
  for (const name of ['toolkit-windows-tasks.cjs', 'toolkit-tasks.cjs']) fs.writeFileSync(path.join(managed, 'repo', 'scripts', name), '// fixture');
  fs.writeFileSync(path.join(current, 'state.json'), JSON.stringify({ repo_path: managed }));
  const script = path.join(managed, 'repo', 'scripts', 'toolkit-windows-tasks.cjs');
  const base = `node "${script}" apply --repo-root "${managed}"`;
  const read = text => policy.independentTaskCommand(text, { home, certainIndependent: () => true });
  const listScript = path.join(managed, 'repo', 'scripts', 'toolkit-tasks.cjs');
  for (const args of ['', ' --json', ' list', ' list --json']) assert.equal(read(`node "${listScript}"${args}`), true);
  for (const command of policy.COMMANDS) assert.equal(read(base.replace(' apply ', ` ${command} `)), true, command);
  assert.equal(policy.independentTaskCommand(base, { home, certainIndependent: () => false }), false);
  for (const text of [base + ' --task programme-sweep', base + ' --folder CUSTOM', base + ' --repair-owned', base + ' --no-first-run', base + '; echo extra', base + ' && echo extra', base + ' > output', `echo ${base}`, base.replace('node ', 'node --eval '), base.replace(script, path.join(home, 'other', 'toolkit-windows-tasks.cjs')), base.replace('apply', 'adopt')]) assert.equal(read(text), false, text);
  for (const row of require('./support/hostile-inputs.cjs').shapes.filter(row => row.syntax === 'shell')) assert.equal(read(row.text), false, row.id);
});

test('task advisory preserves every verdictLine branch, evaluates once and shares one registry read', t => {
  const ctx = scratch(t);
  const tasks = require('../scripts/toolkit-tasks.cjs');
  const Module = require('node:module');
  const originalEvaluate = gate.GovernanceGate.prototype.evaluate;
  const originalRead = tasks.readRegistry, originalAdvisory = tasks.taskGovernanceLine, load = Module._load;
  const registry = { status: 'ok', tasks: [{ id: 'fixture-p', job: 'programme-sweep', repository: 'example/widget', host: 'windows' }] };
  const state = { state: 'UNDECIDED', repository: 'example/widget', repository_id: 'fixture', merged: { fresh: true, status: 'none' }, root: ctx.root };
  const options = { registryOptions: ctx.options, programmeDeps: { home: ctx.options.home, environment: {}, platform: 'win32' } };
  try {
    for (const branch of ['pending','unavailable','not-now','hold','disabled','enabled','error','stale','refresh-failed']) {
      let count = 0, reads = 0;
      const s = { ...state, ...(branch === 'disabled' ? { state: 'DISABLED', merged: { fresh: true, status: 'disabled' } } : {}),
        ...(branch === 'enabled' ? { state: 'ENABLED', programme_records_bind: true, merged: { fresh: true, status: 'enabled' } } : {}),
        ...(branch === 'error' ? { state: 'ERROR', merged: { fresh: true, status: 'invalid' } } : {}),
        ...(branch === 'stale' ? { state: 'DISABLED', rule: 'M2', notes: ['merged-binding-stale'], merged: { fresh: false, status: 'disabled' } } : {}),
        ...(branch === 'refresh-failed' ? { state: 'DISABLED', notes: ['could-not-check-governance'], merged: { fresh: true, status: 'disabled' } } : {}) };
      const verdict = { state: s, reason: branch, hold: branch === 'hold', ...(branch === 'pending' ? { pending: { text: 'Original pending line.' } } : {}) };
      gate.GovernanceGate.prototype.evaluate = () => { count++; return verdict; };
      tasks.readRegistry = () => { reads++; return registry; };
      tasks.taskGovernanceLine = () => null;
      const programmeDeps = { ...options.programmeDeps, mergedBinding: () => ({ repository: state.repository }), now: () => new Date() };
      const call = () => gate.sessionLine(ctx.root, { ...options, programmeDeps });
      const before = call();
      tasks.taskGovernanceLine = originalAdvisory;
      count = reads = 0;
      const after = call();
      const line = originalAdvisory(s, { ...programmeDeps, registry });
      assert.equal(after, line ? `${before} ${line}` : before, branch);
      assert.equal(count, 1, branch);
      assert.equal(reads, 1, branch);
      assert.deepEqual(verdict.state, s, 'no decision changes');
      tasks.taskGovernanceLine = () => { throw new Error('format/read denied'); };
      assert.equal(call(), before, branch);
      tasks.taskGovernanceLine = originalAdvisory;
      tasks.readRegistry = () => ({ status: 'unreadable' });
      // The baseline health context may differ only if its own registry read changes.
      tasks.taskGovernanceLine = () => null;
      const unreadableBefore = call();
      tasks.taskGovernanceLine = originalAdvisory;
      assert.equal(call(), unreadableBefore, branch);
      tasks.readRegistry = () => { throw new Error('registry read denied'); };
      assert.equal(call(), unreadableBefore, branch);
      Module._load = function(request, ...args) {
        if (request === './toolkit-tasks.cjs') throw new Error('advisory load denied');
        return load.call(this, request, ...args);
      };
      assert.equal(call(), unreadableBefore, branch);
      Module._load = load;
    }
  } finally {
    gate.GovernanceGate.prototype.evaluate = originalEvaluate;
    tasks.readRegistry = originalRead; tasks.taskGovernanceLine = originalAdvisory; Module._load = load;
  }
});

test('task advisory uses this start observation: refresh success, failure, stale and clear/compact', t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'advisory-refresh');
  const tasks = require('../scripts/toolkit-tasks.cjs');
  const cache = require('../scripts/toolkit-governance-binding.cjs');
  tasks.writeRegistry(ctx.options.home, [{ id: 'fixture-p', host: 'windows', job: 'programme-sweep', folder: 'FIXTURE',
    repository: 'example-owner/example-repo', name: 'PROGRAMME SWEEP', schedule: 'hourly', purpose: 'fixture', created: new Date().toISOString(), created_by: 'fixture', model: null, effort: null }]);
  const text = JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'disabled' });
  const seed = now => recordMerged(repo, { registryPath: ctx.registryPath, text, now });
  const options = { registryOptions: ctx.options, programmeDeps: { home: ctx.options.home, environment: {}, platform: 'win32' } };
  const line = () => gate.sessionLine(repo, options);
  for (const source of ['startup','resume','clear','compact']) {
    seed(new Date(Date.now() - 26 * 3600000));
    assert.doesNotMatch(line(), /Toolkit tasks:/);
    let refreshed = 0;
    gate.startSession({ cwd: repo, session_id: source, source }, { ...options, refreshBinding() { refreshed++; seed(new Date()); return { refreshed: true }; } });
    assert.equal(refreshed, ['startup','resume'].includes(source) ? 1 : 0);
    assert.equal(line().includes('Toolkit tasks:'), refreshed === 1);
  }
  seed(new Date());
  const identity = governance.readIdentity(repo), dir = path.dirname(ctx.registryPath);
  const entry = cache.readBindingCache(identity, dir);
  cache.writeCache(dir, { ...entry, refresh_error: 'remote-unreachable' });
  assert.doesNotMatch(line(), /Toolkit tasks:/);
  assert.match(line(), /couldn't check governance/);
  seed(new Date());
  assert.doesNotMatch(gate.sessionLine(repo, { ...options, programmeDeps: { ...options.programmeDeps, environment: { TOOLKIT_GOVERNANCE_OFFLINE: '1' } } }), /Toolkit tasks:/);
});

for (const mutation of ['receipt recorded', 'ticket spent']) {
  test(`reply lookups preserve a ${mutation} during target evaluation`, t => {
    for (const lookup of ['peek', 'pending', 'live-ticket', 'live-pending']) {
      const ctx = scratch(t);
      const options = { registryOptions: ctx.options };
      gate.startSession({ session_id: 'owner', source: 'startup' }, options);
      const epoch = new gate.SessionEpochs(options).get('owner');
      const file = path.join(path.dirname(ctx.registryPath), gate.TICKETS_BASENAME);
      const repositories = ['held', 'off'].map(name => ({ root: path.join(ctx.root, name), id: `local:${name}`, mark: null }));
      const data = structuredClone(baseReplyStore.store);
      data.sessions = Object.fromEntries([['owner', 'ticket'], ['waiting', 'pending']].map(([session, kind]) =>
        [session, { ...data.sessions[kind], epoch, at: new Date().toISOString(), repositories }]));
      data.deliveries.forEach(receipt => { receipt.at = new Date().toISOString(); });
      fs.writeFileSync(file, JSON.stringify(data));
      const writer = new gate.ReplyTickets(options);
      const delivery = gate.ownerMessage(projects.wake('no', { id: 'concurrent-receipt' }));
      let written = null;
      const reader = new gate.ReplyTickets({ ...options, gate: { evaluate(root) {
        if (written === null) {
          if (mutation === 'receipt recorded') assert.equal(writer.acceptDelivery(delivery, null), true);
          else assert.ok(writer.take(baseReplyStore.ticket));
          written = fs.readFileSync(file, 'utf8');
        }
        return { hold: root === repositories[0].root };
      } } });
      if (lookup === 'peek' || lookup === 'pending') {
        const entry = lookup === 'peek' ? reader.peek(baseReplyStore.ticket, 'owner') : reader.pending('waiting', epoch);
        assert.deepEqual(entry.repositories, [repositories[0]], lookup);
      } else assert.equal(reader.live(lookup === 'live-ticket' ? 'owner' : 'waiting', epoch), true, lookup);
      assert.notEqual(written, null, 'the concurrent mutation ran during target evaluation');
      if (mutation === 'receipt recorded') assert.equal(writer.acceptDelivery(delivery, null), false, 'spent delivery stays spent');
      else assert.equal(writer.peek(baseReplyStore.ticket, 'owner'), null, 'spent ticket stays absent');
      assert.equal(fs.readFileSync(file, 'utf8'), written, `${lookup} leaves the concurrent writer's store unchanged`);
    }
  });
}

for (const mutation of ['receipt recorded', 'ticket spent']) {
  test(`reply take preserves a ${mutation} during target evaluation`, t => {
    const ctx = scratch(t);
    const options = { registryOptions: ctx.options };
    gate.startSession({ session_id: 'owner', source: 'startup' }, options);
    const epoch = new gate.SessionEpochs(options).get('owner');
    const repositories = [gitRepo(ctx, 'held'), gitRepo(ctx, 'off', { remote: null })]
      .map(root => ({ root, id: stateOf(ctx, root).repository_id, mark: null }));
    const file = path.join(path.dirname(ctx.registryPath), gate.TICKETS_BASENAME);
    const data = structuredClone(baseReplyStore.store);
    data.sessions = Object.fromEntries([['owner', 'ticket'], ['other', 'bound'], ['waiting', 'pending']].map(([session, kind]) =>
      [session, { ...data.sessions[kind], epoch, at: new Date().toISOString(), repositories }]));
    data.deliveries.forEach(receipt => { receipt.at = new Date().toISOString(); });
    fs.writeFileSync(file, JSON.stringify(data));
    const writer = new gate.ReplyTickets(options);
    const delivery = gate.ownerMessage(projects.wake('no', { id: 'concurrent-take-receipt' }));
    const targets = new gate.GovernanceGate(options);
    let written = null;
    const tickets = new gate.ReplyTickets({ ...options, gate: { evaluate(root, context) {
      if (written === null) {
        if (mutation === 'receipt recorded') assert.equal(writer.acceptDelivery(delivery, null), true);
        else assert.ok(writer.take(baseReplyStore.bound_ticket));
        written = fs.readFileSync(file, 'utf8');
      }
      return targets.evaluate(root, context);
    } } });
    const entry = tickets.take(baseReplyStore.ticket);
    assert.deepEqual(entry.repositories, [repositories[0]], 'taking returns only held targets');
    assert.notEqual(written, null, 'the concurrent mutation ran during target evaluation');
    assert.equal(writer.peek(baseReplyStore.ticket, 'owner'), null, 'the taken ticket stays spent');
    if (mutation === 'receipt recorded') assert.equal(writer.acceptDelivery(delivery, null), false, 'spent delivery stays spent');
    else assert.equal(writer.peek(baseReplyStore.bound_ticket, 'other'), null, 'the other spent ticket stays absent');
    const expected = JSON.parse(written);
    delete expected.sessions.owner;
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), expected, 'only the taken ticket is removed from the fresh store');
  });
}

for (const kind of ['ticket', 'pending', 'bound']) {
  test(`upgrade reply state: ${kind} stops holding decided targets and cannot ask another confirmation`, t => {
    for (const identity of ['missing', 'several', 'other', 'enabled', 'disabled']) {
      const ctx = scratch(t);
      const target = gitRepo(ctx, 'target', { remote: identity === 'other' ? 'https://gitlab.com/example-owner/repo.git' : ['enabled', 'disabled'].includes(identity) ? REMOTE : null });
      if (identity === 'several') for (const url of [REMOTE, 'https://github.com/example-owner/second.git']) git(target, ['config', '--add', 'remote.origin.url', url]);
      if (['enabled', 'disabled'].includes(identity)) require('./support/governance-observations.cjs').seedMerged(target, identity === 'enabled' ? 'enable' : 'disable', { registryOptions: ctx.options });
      const now = () => new Date();
      const options = { registryOptions: ctx.options, environment: {}, now };
      gate.startSession({ session_id: 'owner', source: 'startup' }, options);
      const epoch = new gate.SessionEpochs(options).get('owner');
      const file = path.join(path.dirname(ctx.registryPath), gate.TICKETS_BASENAME);
      const data = structuredClone(baseReplyStore.store);
      data.sessions = { owner: { ...data.sessions[kind], epoch, at: now().toISOString(), repositories: [{ root: target, id: stateOf(ctx, target).repository_id, mark: null }] } };
      data.deliveries.forEach(receipt => { receipt.at = now().toISOString(); });
      const seed = () => fs.writeFileSync(file, JSON.stringify(data));
      const receipts = () => assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deliveries, data.deliveries, 'spent delivery receipts stay intact');
      const tools = new gate.ToolGate(options);
      const prompts = new gate.PromptHold(options);
      for (const tool_name of ['CronCreate', 'ScheduleWakeup', 'RemoteTrigger']) {
        seed();
        assert.equal(tools.decide({ tool_name, cwd: ctx.root, session_id: 'owner', tool_input: { prompt: 'Check later.' } }), null, `${identity}/${tool_name}`);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).sessions, data.sessions, 'ignored entries stay on disk');
        receipts();
      }
      seed();
      if (kind !== 'pending') {
        const ticket = kind === 'bound' ? baseReplyStore.bound_ticket : baseReplyStore.ticket;
        for (const word of ['confirm-no', 'no']) {
          seed();
          const result = prompts.answerTicket(ticket, word);
          assert.equal(result.ok, false, `${identity}/${word}`);
          assert.match(result.text, /Nothing was recorded/);
          assert.doesNotMatch(result.text, /Ask the user|Is that right/);
          assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).sessions, data.sessions, 'an ignored ticket cannot be spent or confirmed');
          receipts();
        }
      }
      // A pending old confirmation must not hijack a reply to a different GitHub question either.
      seed();
      const held = gitRepo(ctx, 'held', { remote: 'https://github.com/example-owner/held.git' });
      assert.equal(prompts.decide({ cwd: held, prompt: 'Start here.', sessionId: 'owner' }).action, 'block');
      const reply = prompts.decide({ cwd: held, prompt: 'Probably your recommendation.', sessionId: 'owner' });
      const ticket = replyTicket(reply);
      assert.ok(ticket);
      assert.doesNotMatch(reply.context, /Is that right/);
      assert.deepEqual(new gate.ReplyTickets(options).peek(ticket, 'owner').repositories.map(item => item.root), [held]);
      receipts();
      writesNothingIn(target);
    }
  });
}

test('upgrade reply state: undecided and unreadable targets keep scheduling held, including mixed targets', t => {
  const ctx = scratch(t);
  const held = gitRepo(ctx, 'held');
  const off = gitRepo(ctx, 'off', { remote: null });
  const options = { registryOptions: ctx.options };
  gate.startSession({ session_id: 'owner', source: 'startup' }, options);
  const epoch = new gate.SessionEpochs(options).get('owner');
  const file = path.join(path.dirname(ctx.registryPath), gate.TICKETS_BASENAME);
  for (const kind of ['ticket', 'pending', 'bound']) for (const unreadable of [false, true]) {
    const data = structuredClone(baseReplyStore.store);
    data.sessions = { owner: { ...data.sessions[kind], epoch, at: new Date().toISOString(), repositories: [held, off].map(root => ({ root, id: stateOf(ctx, root).repository_id, mark: null })) } };
    data.deliveries.forEach(receipt => { receipt.at = new Date().toISOString(); });
    fs.writeFileSync(file, JSON.stringify(data));
    const stateReader = cwd => cwd === held && unreadable ? { state: 'UNDECIDED', rule: 'ERROR', error_code: 'STATE_UNREADABLE', root: held } : stateOf(ctx, cwd);
    const tools = new gate.ToolGate({ ...options, stateReader });
    assert.match(tools.decide({ tool_name: 'CronCreate', cwd: ctx.root, session_id: 'owner', tool_input: { prompt: 'yes' } })?.deny || '', /no prompt is scheduled/);
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(kept.sessions, data.sessions, 'lookups keep the original stored targets');
    assert.deepEqual(kept.deliveries, data.deliveries);
    const tickets = new gate.ReplyTickets({ ...options, gate: new gate.GovernanceGate({ ...options, stateReader }) });
    assert.equal(tickets.live('owner', epoch), true);
    let ticket = kind === 'bound' ? baseReplyStore.bound_ticket : baseReplyStore.ticket;
    if (kind === 'pending') {
      const pending = tickets.pending('owner', epoch);
      assert.deepEqual(pending.repositories.map(item => item.root), [held]);
      ticket = tickets.issue('owner', epoch, pending.repositories, pending.command);
    }
    assert.deepEqual(tickets.peek(ticket, 'owner').repositories.map(item => item.root), [held]);
    const taken = tickets.take(ticket);
    assert.deepEqual(taken.repositories.map(item => item.root), [held], 'spending returns only held targets');
    assert.equal(tickets.peek(ticket, 'owner'), null);
    tickets.confirm('owner', epoch, 'disable', taken.repositories);
    assert.deepEqual(tickets.pending('owner', epoch).repositories.map(item => item.root), [held]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.owner.repositories, taken.repositories);
    tickets.drop('owner');
    assert.equal(tickets.live('owner', epoch), false);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')).sessions, 'owner'), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deliveries, data.deliveries);
  }
});
