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
    for (const name of ['Bash', 'PowerShell', 'Monitor', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'TaskStop', 'EnterWorktree', 'CronCreate', 'CronDelete', 'RemoteTrigger', 'SendMessage', 'Workflow', 'mcp__github__create_pull_request']) {
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

test('card: the first message of a run in Claude Code goes through with the card and the same question in text; unnoted and launched sessions get no card', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  const first = c.send(repo, 'fix the login bug', 's1');
  assert.equal(first.action, 'pass');
  assert.match(first.notice, /Pick an answer on the card, or carry on; nothing waits on it/);
  assert.deepEqual(noticeOf(first.context).split('\n'), gate.QUESTION);
  assert.ok(first.context.includes(JSON.stringify(gate.PICKER_INPUT)), 'the exact card input');
  assert.match(first.context, /2\. Then carry on with the user's message above, whatever they picked\. If the card is refused or not answered, carry on the same way and do not show it again\./);
  assert.match(first.context, /adding no answers field/);
  assert.match(first.context, /For agents: Never act as the user/);
  assert.equal(first.context.includes('fix the login bug'), false, 'the message is not repeated in the instruction');
  assert.equal(fs.existsSync(ctx.heldPath), false, 'and is kept nowhere');
  // The next message is handed to the agent to read as a possible reply, with a ticket and no card.
  const second = c.send(repo, 'and the logout one', 's1');
  assert.match(second.context, /Read what they mean before anything else/);
  assert.equal(second.notice, undefined);
  assert.equal(second.context.includes(JSON.stringify(gate.PICKER_INPUT)), false);
  assert.deepEqual(c.send(repo, 'and the settings page', 's1'), { action: 'pass' }, 'the third message is ordinary work');
  // No session id and a session the hook never noted: let through with the way to decide, and no card.
  for (const sessionId of [undefined, 'unnoted']) {
    const told = c.send(repo, 'go', sessionId);
    assert.equal(told.action, 'pass');
    assert.equal(told.notice, undefined);
    assert.match(told.context, /This session started before Toolkit could note it/);
    assert.equal(told.context.includes(gate.PICKER_QUESTION), false);
  }
  // A launched session is let through with nothing.
  assert.deepEqual(card(ctx, { TOOLKIT_GATE_ROLE: 'G1' }).send(repo, 'go', 's1'), { action: 'pass' });
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  assert.deepEqual(c.send(gitlab, 'go', 's1'), { action: 'pass' });
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: Toolkit\'s question runs only as the exact card, with no answer filled in by the caller; any other question is free', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  c.send(repo, 'go', 's1');
  assert.equal(c.ask(repo, 's1', 'tu-clean'), null, 'the exact card is let through to the user');
  const variants = {
    'answers filled in': { ...clone(gate.PICKER_INPUT), answers: { [gate.PICKER_QUESTION]: 'Yes' } },
    'empty answers': { ...clone(gate.PICKER_INPUT), answers: {} },
    'response filled in': { ...clone(gate.PICKER_INPUT), response: 'Yes' },
    'annotations filled in': { ...clone(gate.PICKER_INPUT), annotations: {} },
    'other header': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].header = 'Setup'; return v; })(),
    'reordered options': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options.reverse(); return v; })(),
    'reworded option': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options[1].description = 'Turns it on.'; return v; })(),
    'option preview': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options[0].preview = 'x'; return v; })(),
    'two options': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options.pop(); return v; })(),
    'multi-select': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].multiSelect = true; return v; })(),
    'second question': (() => { const v = clone(gate.PICKER_INPUT); v.questions.push(clone(v.questions[0])); return v; })(),
    'beside another question': (() => { const v = clone(gate.PICKER_INPUT); v.questions.unshift({ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red' }, { label: 'Blue' }] }); return v; })(),
  };
  for (const [name, input] of Object.entries(variants)) {
    assert.match(c.ask(repo, 's1', `tu-${name}`, input)?.deny || '', /shown only as Toolkit's own card, exactly as given and with no answer filled in[\s\S]*Never act as the user/, name);
    assert.match(c.tap(repo, 's1', `tu-${name}`, 'Yes').context, /no answer was recorded/, `${name}: a refused card is never noted`);
  }
  // A question that is not Toolkit's is the agent's own to ask, and its answer records nothing.
  const own = { 'other question text': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].question = 'Turn it on?'; return v; })(), 'not an object': 'Yes',
    'a different card': { questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red' }, { label: 'Blue' }] }] } };
  for (const [name, input] of Object.entries(own)) assert.equal(c.ask(repo, 's1', `tu-${name}`, input), null, name);
  const picker = new gate.PromptHold({ registryOptions: ctx.options, environment: {}, picker: true });
  assert.equal(picker.picked({ cwd: repo, sessionId: 's1', toolUseId: 'tu-other question text', toolResponse: { questions: own['other question text'].questions, answers: { 'Turn it on?': 'Yes' } } }), null);
  assert.doesNotMatch(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /is pending/);
  // Leaving out multiSelect is the same card.
  const loose = clone(gate.PICKER_INPUT);
  delete loose.questions[0].multiSelect;
  assert.equal(gate.pickerInput(loose), true);
  // A run that cannot answer is refused the card: no session id, an unnoted session, no tool_use_id.
  assert.ok(c.ask(repo, undefined, 'tu-x')?.deny);
  assert.ok(c.ask(repo, 'unnoted', 'tu-y')?.deny);
  assert.ok(c.ask(repo, 's1', undefined)?.deny);
  // An automatically disabled folder leaves the card alone, and a tap there records nothing.
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  c.send(gitlab, 'go', 's1');
  assert.equal(c.ask(gitlab, 's1', 'tu-gitlab'), null);
  assert.match(c.tap(repo, 's1', 'tu-gitlab', 'Yes').context, /no answer was recorded/);
  // Where nothing is open the card is not Toolkit's business, whatever it carries.
  const decided = gitRepo(ctx, 'decided', { remote: 'https://github.com/example-owner/decided.git' });
  require('./support/governance-observations.cjs').seedMerged(decided, 'enable', { registryOptions: ctx.options });
  assert.equal(c.ask(decided, 's1', 'tu-z', variants['answers filled in']), null);
  assert.doesNotMatch(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /is pending/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: Yes and No each record the pending answer, Later records nothing, and work carries on either way', (t) => {
  const ctx = scratch(t);
  for (const [label, pattern, line] of [['Yes', /yes is pending[\s\S]*missing parent/, /yes is pending/], ['No', /no is pending/, /no is pending/], ['Later', /answered "later"/, /not decided yet/]]) {
    const repo = gitRepo(ctx, `tap-${label}`, { remote: `https://github.com/example-owner/tap-${label}.git` });
    const c = card(ctx);
    const session = `tap-${label}`;
    c.start(session);
    c.send(repo, 'first request', session);
    assert.equal(c.ask(repo, session, `tu-${label}`), null);
    assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, session_id: session, tool_input: { command: 'ls' } }), null, 'work runs while the card is up');
    const picked = c.tap(repo, session, `tu-${label}`, label);
    assert.match(picked.context, pattern, label);
    assert.ok(picked.context.endsWith('Then carry on with what the user asked.'), label);
    assert.doesNotMatch(picked.context, /first request/, label);
    assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: session }), line, label);
    assert.equal(stateOf(ctx, repo).state, 'UNDECIDED', label);
    // The tap was the reply: the next message is ordinary work, with no ticket and no second card.
    const next = c.send(repo, 'next', session);
    assert.equal(next.action, 'pass', label);
    assert.equal(ticketOf(next.context), undefined, label);
    assert.equal(next.notice, undefined, label);
    if (label === 'Later') assert.deepEqual(next, { action: 'pass' });
    writesNothingIn(repo);
  }
});

test('card: an answer counts only from the card the gate noted, once, in the run that was asked', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  c.send(repo, 'go', 's1');
  // A tool_use_id the gate never let through (an answer filled in some other way) records nothing.
  assert.match(c.tap(repo, 's1', 'tu-never', 'Yes').context, /no answer was recorded/);
  // A refused card is never noted.
  assert.ok(c.ask(repo, 's1', 'tu-filled', { ...clone(gate.PICKER_INPUT), answers: { [gate.PICKER_QUESTION]: 'Yes' } }).deny);
  assert.match(c.tap(repo, 's1', 'tu-filled', 'Yes').context, /no answer was recorded/);
  // Dismissed, or a typed "Other" answer: nothing recorded, and the note is used up.
  assert.equal(c.ask(repo, 's1', 'tu-dismissed'), null);
  assert.match(c.tap(repo, 's1', 'tu-dismissed', undefined).context, /no answer was recorded/);
  assert.equal(c.ask(repo, 's1', 'tu-other'), null);
  assert.match(c.tap(repo, 's1', 'tu-other', 'sure, turn it on').context, /no answer was recorded/);
  assert.match(c.tap(repo, 's1', 'tu-other', 'Yes').context, /no answer was recorded/, 'a note counts once');
  // Another session, a launched session, or the same session after a resume: nothing recorded.
  assert.equal(c.ask(repo, 's1', 'tu-other-session'), null);
  assert.match(c.tap(repo, 's2', 'tu-other-session', 'Yes').context, /no answer was recorded/);
  assert.equal(c.ask(repo, 's1', 'tu-launched'), null);
  assert.match(card(ctx, { [gate.HOST_SESSION_VARIABLE]: 'parent' }).tap(repo, 's1', 'tu-launched', 'Yes').context, /no answer was recorded/);
  assert.equal(c.ask(repo, 's1', 'tu-resumed'), null);
  c.start('s1', 'resume', repo);
  assert.match(c.tap(repo, 's1', 'tu-resumed', 'Yes').context, /no answer was recorded/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // Options changed after the tool gate's check (relabelled or reordered) count for nothing.
  const changed = new gate.PromptHold({ registryOptions: ctx.options, environment: {}, picker: true });
  for (const [id, edit] of [['tu-relabelled', q => { q.options[1].label = 'Yes'; q.options[0].label = 'No'; }], ['tu-reordered', q => q.options.reverse()], ['tu-extra', q => { q.options[0].preview = 'x'; }]]) {
    assert.equal(c.ask(repo, 's1', id), null);
    const questions = clone(gate.PICKER_INPUT.questions);
    edit(questions[0]);
    assert.match(changed.picked({ cwd: repo, sessionId: 's1', toolUseId: id, toolResponse: { questions, answers: { [gate.PICKER_QUESTION]: 'Yes' } } }).context, /no answer was recorded/, id);
  }
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // A card that is not Toolkit's is left alone.
  assert.equal(new gate.PromptHold({ registryOptions: ctx.options, environment: {}, picker: true }).picked({ cwd: repo, sessionId: 's1', toolUseId: 'tu-q', toolResponse: { questions: [{ question: 'Pick a colour?' }], answers: { 'Pick a colour?': 'Red' } } }), null);
  // The resumed run is asked again, and its typed answer (or its own card) then counts.
  assert.match(c.send(repo, 'again', 's1').notice, /Pick an answer on the card/);
  assert.equal(c.typed(repo, 'toolkit governance disable', 's1').action, 'pass');
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /no is pending/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: a typed answer still works after the card was shown, and the Claude hook records a tap end to end', (t) => {
  const ctx = scratch(t);
  const typedRepo = gitRepo(ctx, 'typed');
  const c = card(ctx);
  c.start('s1');
  c.send(typedRepo, 'go', 's1');
  const typed = c.send(typedRepo, 'toolkit governance enable', 's1');
  assert.equal(typed.action, 'pass');
  assert.match(typed.context, /yes is pending/);
  assert.doesNotMatch(typed.context, /1\. go/);
  const repo = gitRepo(ctx, 'hook', { remote: 'https://github.com/example-owner/hook.git' });
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_REMOTE;
  delete env.CLAUDE_ENV_FILE;
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
  const run = (event, input) => JSON.parse(childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', event], { input: JSON.stringify(input), env, encoding: 'utf8' }));
  run('SessionStart', { cwd: repo, session_id: 'h1', source: 'startup' });
  assert.match(run('UserPromptSubmit', { cwd: repo, prompt: 'fix it', session_id: 'h1' }).systemMessage, /Pick an answer on the card/);
  for (const tool_name of ['Read', 'Bash']) assert.deepEqual(run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name, tool_input: {} }), {}, tool_name);
  const filled = run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1', tool_input: { ...gate.PICKER_INPUT, answers: { [gate.PICKER_QUESTION]: 'Yes' } } });
  assert.equal(filled.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', tool_input: gate.PICKER_INPUT }), {}, 'no decision: Claude Code shows the card to the user');
  const tapped = run('PostToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', tool_input: { ...gate.PICKER_INPUT, answers: { [gate.PICKER_QUESTION]: 'No' } },
    tool_response: { questions: gate.PICKER_INPUT.questions, answers: { [gate.PICKER_QUESTION]: 'No' } } });
  assert.match(tapped.hookSpecificOutput.additionalContext, /no is pending[\s\S]*Then carry on with what the user asked\.$/);
  assert.doesNotMatch(tapped.hookSpecificOutput.additionalContext, /fix it/);
  assert.equal(governance.governanceState(repo, { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true }).state, 'UNDECIDED');
  assert.deepEqual(run('PostToolUse', { cwd: repo, session_id: 'h1', tool_name: 'Bash', tool_response: {} }), {});
});

test('a hook that fails holds only state-changing tools inside a repository; read-only tools and the card pass everywhere', (t) => {
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
    assert.deepEqual(claudeHook.respond('PostToolUse', { cwd: repo, tool_name: 'AskUserQuestion' }, { gate: gateModule, environment }), {});
  }
  // A failed check never answers: a card let through without the tool gate's note records nothing.
  const c = card(ctx);
  c.start('s1');
  c.send(repo, 'go', 's1');
  assert.match(c.tap(repo, 's1', 'tu-unchecked', 'Yes').context, /no answer was recorded/);
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
    'Toolkit\'s card with an answer filled in': [f => f.tool('AskUserQuestion', { ...gate.PICKER_INPUT, answers: { [gate.PICKER_QUESTION]: 'Yes' } }), row('allow', 'allow', 'allow', 'allow', 'refused', 'refused', 'refused', 'refused', 'refused')],
    // Refused only while a reply is awaited: the open reply window (U1) or the live reply ticket (U2 here).
    'a scheduled prompt for itself':  [f => f.tool('CronCreate', { prompt: 'yes', cron: '* * * * *' }), row('allow', 'allow', 'allow', 'allow', 'allow', 'refused', 'refused', 'allow', 'allow')],
  };
  for (const state of STATES) {
    for (const [prompt, expected] of Object.entries(PROMPTS)) assert.equal(kind(build(state).say(prompt)), expected[state], `${state}: "${prompt}"`);
    const fixture = build(state);
    for (const [name, [call, expected]] of Object.entries(TOOLS)) assert.equal(call(fixture)?.deny ? 'refused' : 'allow', expected[state], `${state}: ${name}`);
  }
});
