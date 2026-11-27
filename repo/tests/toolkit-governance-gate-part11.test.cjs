'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

const ticketOf = context => (/ ANSWER ([0-9a-f]{32})\n/.exec(context || '') || [])[1];

// Split to keep the per-file time budget.
test('hook wiring: both Claude copies send prompts and tools to the hook, with onFailure block; Codex shares the helper launcher', () => {
  for (const file of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')).hooks;
    const prompt = hooks.UserPromptSubmit[0].hooks[0];
    assert.equal(prompt.command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-governance-hook.cjs" --event UserPromptSubmit', file);
    assert.equal(prompt.onFailure, 'block');
    const [tool, rest, ...others] = hooks.PreToolUse.filter(entry => entry.hooks[0].command.includes('toolkit-governance-hook.cjs'));
    assert.deepEqual(others, [], file);
    for (const entry of [tool, rest]) assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-governance-hook.cjs" --event PreToolUse', file);
    // Every tool goes to the hook, read-only ones included: the card and the scheduling tools are among them.
    // A hook that cannot start holds only the state-changing tools (onFailure block); the rest pass.
    assert.equal(tool.hooks[0].onFailure, 'block');
    assert.equal(rest.hooks[0].onFailure, undefined);
    assert.equal(tool.matcher, `^${claudeHook.STATE_CHANGING_TOOLS.source.slice(1, -1)}$`, file);
    // Claude Code tests a matcher with these characters as an unanchored regex, so each carries its own anchors.
    // Every prompt-delivering tool the merge hold reads is among them, so a hook that cannot start
    // holds a brief or scheduled prompt that could plant a merge approval.
    for (const name of ['Bash', 'PowerShell', 'Monitor', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'TaskStop', 'EnterWorktree', 'CronCreate', 'CronDelete', 'RemoteTrigger', 'ScheduleWakeup', 'SendMessage', 'Workflow', 'mcp__github__create_pull_request', ...require('../scripts/toolkit-merge-hold.cjs').PROMPT_TOOLS]) {
      assert.match(name, new RegExp(tool.matcher), name);
      assert.doesNotMatch(name, new RegExp(rest.matcher), name);
    }
    for (const name of ['Read', 'Grep', 'Glob', 'WebFetch', 'TodoWrite', 'ToolSearch', 'AskUserQuestion', 'BashOutput', 'Skill', 'TaskCreate']) {
      assert.doesNotMatch(name, new RegExp(tool.matcher), name);
      assert.match(name, new RegExp(rest.matcher), name);
    }
    // The answer tapped on the card is read after the tool runs.
    const picked = hooks.PostToolUse.find(entry => entry.hooks[0].command.includes('toolkit-governance-hook.cjs'));
    assert.equal(picked.matcher, '^AskUserQuestion$', file);
    assert.equal(picked.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-governance-hook.cjs" --event PostToolUse', file);
    assert.match('AskUserQuestion', new RegExp(picked.matcher));
    for (const name of ['AskUserQuestionX', 'Bash']) assert.doesNotMatch(name, new RegExp(picked.matcher), name);
    assert.ok(hooks.SessionStart[0].hooks.some(hook => hook.command.endsWith('toolkit-governance-hook.cjs" --event SessionStart')));
    // Both session-start hooks show the same fixed spinner text, so a start that waits on an update says why.
    const starts = hooks.SessionStart[0].hooks;
    for (const script of ['toolkit-local-bridge.cjs', 'toolkit-governance-hook.cjs']) {
      const hook = starts.find(entry => entry.command.includes(script));
      assert.ok(hook, `${file}: ${script}`);
      assert.equal(hook.statusMessage, 'Toolkit: checking for updates', `${file}: ${script}`);
    }
  }
  for (const file of ['.codex-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
    assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].command, hooks.hooks.PreToolUse[0].hooks[0].command, file);
    for (const entry of hooks.hooks.PreToolUse) assert.equal(entry.hooks[0].command, hooks.hooks.UserPromptSubmit[0].hooks[0].command, file);
    const matches = name => hooks.hooks.PreToolUse.some(entry => new RegExp(entry.matcher).test(name));
    for (const name of ['Bash', 'apply_patch', 'Edit', 'Write', 'spawn_agent', 'mcp__github__create_pull_request']) assert.ok(matches(name), name);
    assert.deepEqual(codexSetup.verifySessionStartHook(null, { hooks }), [], file);
    const rendered = codexSetup.renderInstalledWindowsHooks(hooks, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(rendered.hooks.UserPromptSubmit[0].hooks[0].commandWindows, rendered.hooks.PreToolUse[0].hooks[0].commandWindows);
    assert.equal(rendered.hooks.PreToolUse[1].hooks[0].commandWindows, rendered.hooks.PreToolUse[0].hooks[0].commandWindows);
    assert.deepEqual(codexSetup.verifySessionStartHook(null, { hooks: rendered, windows: true, powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }), []);
  }
});

// INT-TK421-1389: how the question shows is the app's choice. Toolkit forces no card, refuses none and
// notes none; the owner's tap on a card the app chose to show reaches the gate through PostToolUse and is
// taken as their reply, with the same one-use ticket a typed reply gets.
test('card: the first message of a run goes through with the question as text on every host; no card is forced', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  const first = c.send(repo, 'fix the login bug', 's1');
  assert.equal(first.action, 'pass');
  assert.equal(first.notice, undefined, 'no card notice');
  assert.deepEqual(noticeOf(first.context).split('\n'), gate.QUESTION.map(line => line.replace('TRANSPORT-<repository name>', 'TRANSPORT-example-repo')));
  assert.doesNotMatch(first.context, /AskUserQuestion|\{"questions"|adding no answers field|on the card/, 'no card steps');
  assert.match(first.context, /1\. Do what the user asked in the message above\./);
  assert.match(first.context, /For agents: Never act as the user/);
  assert.equal(first.context.includes('fix the login bug'), false, 'the message is not repeated in the instruction');
  assert.equal(fs.existsSync(ctx.heldPath), false, 'and is kept nowhere');
  // The next message is handed to the agent to read as a possible reply, with a ticket.
  const second = c.send(repo, 'and the logout one', 's1');
  assert.match(second.context, /Read what they mean before anything else/);
  assert.deepEqual(c.send(repo, 'and the settings page', 's1'), { action: 'pass' }, 'the third message is ordinary work');
  for (const sessionId of [undefined, 'unnoted']) {
    const told = c.send(repo, 'go', sessionId);
    assert.equal(told.action, 'pass');
    assert.match(told.context, /This session started before Toolkit could note it/);
  }
  assert.deepEqual(card(ctx, { TOOLKIT_GATE_ROLE: 'G1' }).send(repo, 'go', 's1'), { action: 'pass' });
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  assert.deepEqual(c.send(gitlab, 'go', 's1'), { action: 'pass' });
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: no question card is refused or noted, whatever it carries, and the governance gate forces none', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  c.send(repo, 'go', 's1');
  const question = { question: gate.QUESTION_TEXT, header: 'Governance', multiSelect: false, options: [{ label: 'A. Yes', description: '' }, { label: 'B. Later', description: '' }, { label: 'C. No', description: '' }] };
  for (const [name, input] of Object.entries({
    'the governance question': { questions: [question] },
    'answers filled in': { questions: [question], answers: { [gate.QUESTION_TEXT]: 'A. Yes' } },
    'another question': { questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red' }, { label: 'Blue' }] }] },
    'not an object': 'Yes',
  })) for (const sessionId of ['s1', undefined, 'unnoted']) assert.equal(tools(ctx).decide({ tool_name: 'AskUserQuestion', cwd: repo, session_id: sessionId, tool_use_id: `tu-${name}`, tool_input: input }), null, `${name} / ${sessionId}`);
  assert.equal(gate.PICKER_INPUT, undefined);
  assert.equal(gate.pickerInput, undefined);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: a tap is the reply: it reaches the agent with the one reply ticket, and the agent records what it means', (t) => {
  const ctx = scratch(t);
  for (const [label, word, pattern, line] of [['A. Yes', 'yes', /answered yes[\s\S]*guided setup[\s\S]*toolkit-governance\.cjs" setup/, /not decided yet/], ['C. No', 'no', /no is pending/, /no is pending/], ['B. Later', 'later', /answered "later"/, /not decided yet/]]) {
    const repo = gitRepo(ctx, `tap-${word}`, { remote: `https://github.com/example-owner/tap-${word}.git` });
    const c = card(ctx);
    const session = `tap-${word}`;
    c.start(session);
    c.send(repo, 'first request', session);
    assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, session_id: session, tool_input: { command: 'ls' } }), null, 'work runs while the question is open');
    const tapped = c.tap(repo, session, label);
    assert.match(tapped.context, new RegExp(`^Toolkit governance: the user answered a question card \\("${gate.QUESTION_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}": ${label}\\); it is the first reply since Toolkit asked them`), label);
    assert.match(tapped.context, /A is yes, B later, C no/);
    assert.doesNotMatch(tapped.context, /first request/, label);
    const ticket = ticketOf(tapped.context);
    assert.ok(ticket, label);
    assert.equal(stateOf(ctx, repo).state, 'UNDECIDED', `${label}: a tap alone records nothing`);
    const recorded = new gate.PromptHold({ registryOptions: ctx.options, environment: {} }).answerTicket(ticket, word);
    assert.match(recorded.text, pattern, label);
    assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: session }), line, label);
    // The tap was the reply: the next message is ordinary work, with no ticket.
    const next = c.send(repo, 'next', session);
    assert.equal(next.action, 'pass', label);
    assert.equal(ticketOf(next.context), undefined, label);
    writesNothingIn(repo);
  }
});

test('card: a tap counts only as the first reply in the run that was asked', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  assert.equal(c.tap(repo, 's1', 'A. Yes'), null, 'a tap before the question answers nothing');
  c.send(repo, 'go', 's1');
  assert.equal(c.tap(repo, 's1', undefined), null, 'a dismissed card answers nothing');
  assert.equal(c.tap(repo, 's2', 'A. Yes'), null, 'another session was never asked');
  assert.equal(card(ctx, { [gate.HOST_SESSION_VARIABLE]: 'parent' }).tap(repo, 's1', 'A. Yes'), null, 'a launched session never answers');
  assert.ok(ticketOf(c.tap(repo, 's1', 'A. Yes').context), 'the first tap gets the ticket');
  assert.equal(c.tap(repo, 's1', 'C. No'), null, 'one reply per question');
  c.start('s1', 'resume', repo);
  assert.equal(c.tap(repo, 's1', 'C. No'), null, 'a resumed run was not asked');
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // The resumed run is asked again, and its typed answer then counts.
  assert.ok(c.send(repo, 'again', 's1').context.includes(QUESTION_LINE));
  assert.equal(c.typed(repo, 'toolkit governance disable', 's1').action, 'pass');
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /no is pending/);
});

test('card: a typed answer still works, and the Claude hook gives a tap its reply ticket end to end', (t) => {
  const ctx = scratch(t);
  const typedRepo = gitRepo(ctx, 'typed');
  const c = card(ctx);
  c.start('s1');
  c.send(typedRepo, 'go', 's1');
  const typed = c.send(typedRepo, 'toolkit governance enable', 's1');
  assert.equal(typed.action, 'pass');
  assert.match(typed.context, /answered yes[\s\S]*guided setup/);
  assert.doesNotMatch(typed.context, /1\. go/);
  const repo = gitRepo(ctx, 'hook', { remote: 'https://github.com/example-owner/hook.git' });
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_REMOTE;
  delete env.CLAUDE_ENV_FILE;
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
  const run = (event, input) => JSON.parse(childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', event], { input: JSON.stringify(input), env, encoding: 'utf8' }));
  run('SessionStart', { cwd: repo, session_id: 'h1', source: 'startup' });
  const asked = run('UserPromptSubmit', { cwd: repo, prompt: 'fix it', session_id: 'h1' });
  assert.equal(asked.systemMessage, undefined);
  assert.ok(asked.hookSpecificOutput.additionalContext.includes(QUESTION_LINE));
  const question = { question: gate.QUESTION_TEXT, header: 'Governance', multiSelect: false, options: [{ label: 'A. Yes', description: '' }, { label: 'C. No', description: '' }] };
  assert.deepEqual(run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', tool_input: { questions: [question] } }), {}, 'no decision: the app shows its card');
  const tapped = run('PostToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', tool_input: { questions: [question] },
    tool_response: { questions: [question], answers: { [gate.QUESTION_TEXT]: 'C. No' } } });
  assert.match(tapped.hookSpecificOutput.additionalContext, /^Toolkit governance: the user answered a question card \(.*: C\. No\); it is the first reply/);
  assert.ok(ticketOf(tapped.hookSpecificOutput.additionalContext));
  assert.doesNotMatch(tapped.hookSpecificOutput.additionalContext, /fix it/);
  assert.equal(governance.governanceState(repo, { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true }).state, 'UNDECIDED');
  assert.deepEqual(run('PostToolUse', { cwd: repo, session_id: 'h1', tool_name: 'Bash', tool_response: {} }), {});
});

test('a hook that fails holds only state-changing tools inside a repository; read-only tools and question cards pass everywhere', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const outside = path.join(ctx.root, 'outside');
  fs.mkdirSync(outside);
  const environment = {};
  const thrower = class { constructor() { throw new Error('broken'); } };
  for (const gateModule of [
    { PromptHold: thrower, ToolGate: thrower, sessionLine() { throw new Error('broken'); }, insideRepository: gate.insideRepository },
    { PromptHold: thrower, ToolGate: thrower, insideRepository() { throw new Error('broken'); } },
  ]) {
    const respond = (cwd, tool_name) => claudeHook.respond('PreToolUse', { cwd, tool_name, tool_input: {} }, { gate: gateModule, environment });
    for (const tool_name of ['Bash', 'Edit', 'Agent', 'TaskStop', 'EnterWorktree', 'CronCreate', 'CronDelete', 'RemoteTrigger', 'SendMessage', 'Workflow', 'mcp__github__create_pull_request']) {
      assert.equal(respond(repo, tool_name).hookSpecificOutput.permissionDecision, 'deny', tool_name);
    }
    for (const tool_name of ['Read', 'Grep', 'Glob', 'WebFetch', 'AskUserQuestion', 'ToolSearch']) {
      assert.deepEqual(respond(repo, tool_name), {}, tool_name);
      assert.deepEqual(respond(outside, tool_name), {}, `${tool_name} outside`);
    }
    // A failed check never answers: a tap gets no ticket.
    assert.deepEqual(claudeHook.respond('PostToolUse', { cwd: repo, tool_name: 'AskUserQuestion', tool_response: { answers: { [gate.QUESTION_TEXT]: 'A. Yes' } } }, { gate: gateModule, environment }), {});
  }
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  assert.ok(claudeHook.STATE_CHANGING_TOOLS.test('Bash') && !claudeHook.STATE_CHANGING_TOOLS.test('Read'));
});

test('H-16: decided and no-repository folders add only local reads', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  require('./support/governance-observations.cjs').seedMerged(repo, 'disable', { registryOptions: ctx.options });
  const spawnNames = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];
  const saved = Object.fromEntries(spawnNames.map(name => [name, childProcess[name]]));
  let spawned = 0;
  for (const name of spawnNames) childProcess[name] = (...args) => { spawned += 1; return saved[name](...args); };
  try {
    const started = process.hrtime.bigint();
    for (let index = 0; index < 20; index += 1) {
      assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: 'go' }), { action: 'pass' });
      assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
    }
    const perCall = Number(process.hrtime.bigint() - started) / 40 / 1e6;
    assert.ok(perCall < 200, `${perCall.toFixed(1)} ms per call`);
  } finally {
    for (const name of spawnNames) childProcess[name] = saved[name];
  }
  assert.equal(spawned, 0, 'no subprocess on the decided path');
});

// The whole table: every repository state and session kind against every event. Each cell is one of
// pass, ask, ticket, recorded, refused or allow; no cell holds a message and no cell refuses a tool
// because of the question.
test('state matrix: every state and event gives its one result, with no message held and no tool refused for the question', (t) => {
  const cache = require('../scripts/toolkit-governance-binding.cjs');
  const AUTO = { [gate.HOST_SESSION_VARIABLE]: 'parent-session' };
  let count = 0;
  // One fresh repository in the named state, with the session ready to send the event.
  const build = (state) => {
    const ctx = scratch(t);
    const environment = state === 'auto' ? AUTO : {};
    const prompts = new gate.PromptHold({ registryOptions: ctx.options, environment });
    const toolGate = new gate.ToolGate({ registryOptions: ctx.options, environment });
    const repo = gitRepo(ctx, `matrix-${count++}`, state === 'N' ? { remote: null } : {});
    const say = prompt => prompts.decide({ cwd: repo, prompt, sessionId: 's' });
    if (state === 'D') recordMerged(repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'disabled' }) });
    if (state === 'U?') {
      const dir = path.dirname(ctx.registryPath);
      cache.writeCache(dir, { ...cache.readBindingCache(governance.readIdentity(repo), dir), refresh_error: 'remote-unreachable' });
    }
    if (state !== 'bare') gate.startSession({ session_id: 's', source: 'startup', cwd: repo }, { registryOptions: ctx.options, environment });
    if (state === 'P') { say('set up the site'); assert.match(say('toolkit governance disable').context, /proposal is pending/); }
    if (state === 'U1' || state === 'U2') assert.ok(String(say('set up the site').context).includes(QUESTION_LINE), state);
    if (state === 'U2') assert.match(say('and the tests').context, / ANSWER [0-9a-f]{32}\n/);
    const tool = (tool_name, tool_input) => toolGate.decide({ tool_name, cwd: repo, session_id: 's', tool_input });
    return { ctx, repo, say, tool };
  };
  const kind = (result) => {
    if (result.action === 'block') return 'refused';
    const context = String(result.context || '');
    if (context.includes(QUESTION_LINE)) return 'ask';
    if (/ ANSWER [0-9a-f]{32}\n/.test(context)) return 'ticket';
    if (/proposal is pending/.test(context) && /the user answered/.test(context)) return 'recorded';
    if (/couldn't check governance/.test(context)) return 'pass+unchecked';
    if (/is pending/.test(context)) return 'pass+pending';
    if (/started before Toolkit could note it/.test(context)) return 'pass+terminal';
    return context ? `pass+${context.slice(0, 40)}` : 'pass';
  };
  const STATES = ['N', 'D', 'U?', 'P', 'U0', 'U1', 'U2', 'auto', 'bare'];
  const row = (...cells) => Object.fromEntries(STATES.map((state, index) => [state, cells[index]]));
  // The full phrase counts only in a run that was asked, so as a run's first message it is asked about,
  // not recorded: a session started just to send it cannot answer.
  const PROMPTS = {
    'Fix the failing test.':     row('pass', 'pass', 'pass+unchecked', 'pass+pending', 'ask', 'ticket', 'pass', 'pass', 'pass+terminal'),
    'toolkit governance disable': row('pass', 'pass', 'pass+unchecked', 'pass+pending', 'ask', 'recorded', 'recorded', 'refused', 'refused'),
    yes:                         row('pass', 'pass', 'pass+unchecked', 'pass+pending', 'ask', 'ticket', 'pass', 'pass', 'pass+terminal'),
  };
  const stateFile = ctx => path.join(path.dirname(ctx.registryPath), 'repository-governance.v1.json');
  const TOOLS = {
    'any shell command':              [f => f.tool('Bash', { command: 'npm test' }), row('allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow')],
    'a file write':                   [f => f.tool('Write', { file_path: path.join(f.repo, 'notes.md'), content: 'notes\n' }), row('allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow')],
    'a question that is not Toolkit\'s': [f => f.tool('AskUserQuestion', { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'r' }, { label: 'Blue', description: 'b' }] }] }), row('allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow')],
    'the governance CLI with a decision': [f => f.tool('Bash', { command: `node "${path.join(scripts, 'toolkit-governance.cjs')}" enable` }), row('refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused')],
    'an edit to Toolkit\'s user state': [f => f.tool('Write', { file_path: stateFile(f.ctx), content: '{}' }), row('refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused')],
    // INT-TK421-1389: a question card is the app's own, in every state, whatever it carries.
    'a governance question card with an answer filled in': [f => f.tool('AskUserQuestion', { questions: [{ question: gate.QUESTION_TEXT, header: 'Governance', options: [{ label: 'A. Yes' }, { label: 'C. No' }] }], answers: { [gate.QUESTION_TEXT]: 'A. Yes' } }), row('allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow')],
    // Refused only while a reply is awaited: the open reply window (U1) or the live reply ticket (U2 here).
    'a scheduled prompt for itself':  [f => f.tool('CronCreate', { prompt: 'yes', cron: '* * * * *' }), row('allow', 'allow', 'allow', 'allow', 'allow', 'refused', 'refused', 'allow', 'allow')],
  };
  for (const state of STATES) {
    for (const [prompt, expected] of Object.entries(PROMPTS)) assert.equal(kind(build(state).say(prompt)), expected[state], `${state}: "${prompt}"`);
    const fixture = build(state);
    for (const [name, [call, expected]] of Object.entries(TOOLS)) assert.equal(call(fixture)?.deny ? 'refused' : 'allow', expected[state], `${state}: ${name}`);
  }
});
