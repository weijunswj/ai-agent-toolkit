'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
test('hook wiring: both Claude copies hold prompts and tools with onFailure block; Codex shares the helper launcher', () => {
  for (const file of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')).hooks;
    const prompt = hooks.UserPromptSubmit[0].hooks[0];
    assert.equal(prompt.command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-governance-hook.cjs" --event UserPromptSubmit', file);
    assert.equal(prompt.onFailure, 'block');
    const [tool, rest, ...others] = hooks.PreToolUse.filter(entry => entry.hooks[0].command.includes('toolkit-governance-hook.cjs'));
    assert.deepEqual(others, [], file);
    for (const entry of [tool, rest]) assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-governance-hook.cjs" --event PreToolUse', file);
    // Every tool goes to the hook: a held repository runs none but the card, read-only ones included.
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

test('card: a held turn in Claude Code runs only to show the card and the same short text; Codex and unnoted sessions keep the text hold', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const c = card(ctx);
  c.start('s1');
  const first = c.send(repo, 'fix the login bug', 's1');
  assert.equal(first.action, 'pass');
  assert.match(first.notice, /pick an answer to the governance question/);
  assert.deepEqual(noticeOf(first.context).split('\n'), [QUESTION_LINE, 'Reply yes or no (prepare a decision pull request), or later (ask next chat). Held messages follow your answer.', AGENT_LINE]);
  assert.ok(first.context.includes(JSON.stringify(gate.PICKER_INPUT)), 'the exact card input');
  assert.match(first.context, /Do not act on it, answer it or use any other tool/);
  assert.match(first.context, /adding no answers field/);
  assert.match(first.context, /For agents: Never act as the user/);
  assert.equal(first.context.includes('fix the login bug'), false, 'the held message is not repeated in the instruction');
  // The message is still held for the session and counts up as before.
  assert.equal(new gate.HeldPrompts({ registryOptions: ctx.options }).count(stateOf(ctx, repo).repository_id, 's1'), 1);
  // A later message is held too and handed to the agent to read as a possible reply, with a ticket.
  assert.match(c.send(repo, 'and the logout one', 's1').context, /Read what they mean before anything else/);
  assert.equal(new gate.HeldPrompts({ registryOptions: ctx.options }).count(stateOf(ctx, repo).repository_id, 's1'), 2);
  // No session id, a session the hook never noted, a launched session keep the text hold.
  assert.equal(c.send(repo, 'go', undefined).action, 'block');
  assert.equal(c.send(repo, 'go', 'unnoted').action, 'block');
  assert.equal(card(ctx, { TOOLKIT_GATE_ROLE: 'G1' }).send(repo, 'go', 's1').action, 'block');
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  assert.equal(c.send(gitlab, 'go', 's1').action, 'pass');
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: only the exact card, with no answer filled in by the caller, runs in a held repository', (t) => {
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
    'other question text': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].question = 'Turn it on?'; return v; })(),
    'other header': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].header = 'Setup'; return v; })(),
    'reordered options': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options.reverse(); return v; })(),
    'reworded option': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options[1].description = 'Turns it on.'; return v; })(),
    'option preview': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options[0].preview = 'x'; return v; })(),
    'two options': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].options.pop(); return v; })(),
    'multi-select': (() => { const v = clone(gate.PICKER_INPUT); v.questions[0].multiSelect = true; return v; })(),
    'second question': (() => { const v = clone(gate.PICKER_INPUT); v.questions.push(clone(v.questions[0])); return v; })(),
    'not an object': 'Yes',
  };
  for (const [name, input] of Object.entries(variants)) {
    assert.match(c.ask(repo, 's1', `tu-${name}`, input)?.deny || '', /runs only as Toolkit's own card[\s\S]*Never act as the user/, name);
  }
  // Leaving out multiSelect is the same card.
  const loose = clone(gate.PICKER_INPUT);
  delete loose.questions[0].multiSelect;
  assert.equal(gate.pickerInput(loose), true);
  // A run that cannot answer is refused the card: no session id, an unnoted session, no tool_use_id.
  assert.ok(c.ask(repo, undefined, 'tu-x')?.deny);
  assert.ok(c.ask(repo, 'unnoted', 'tu-y')?.deny);
  assert.ok(c.ask(repo, 's1', undefined)?.deny);
  // An automatically disabled folder leaves the card alone; an unreadable GitHub state refuses it.
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  c.send(gitlab, 'go', 's1');
  assert.equal(c.ask(gitlab, 's1', 'tu-gitlab'), null);
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, '{ not json');
  assert.equal(c.ask(repo, 's1', 'tu-unreadable'), null);
  fs.rmSync(ctx.registryPath, { force: true });
  for (const id of ['tu-gitlab']) assert.match(c.tap(repo, 's1', id, 'Yes').context, /no answer was recorded/, id);
  // Outside a held repository the tool is not Toolkit's business.
  const decided = gitRepo(ctx, 'decided', { remote: 'https://github.com/example-owner/decided.git' });
  require('./support/governance-observations.cjs').seedMerged(decided, 'enable', { registryOptions: ctx.options });
  assert.equal(c.ask(decided, 's1', 'tu-z', variants['other question text']), null);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});

test('card: Yes, No and Later each record the right state and hand back the held messages in order', (t) => {
  const ctx = scratch(t);
  for (const [label, state, pattern] of [['Yes', 'UNDECIDED', /yes is pending[\s\S]*missing parent/], ['No', 'UNDECIDED', /no is pending/], ['Later', 'UNDECIDED', /answered "later"/]]) {
    const repo = gitRepo(ctx, `tap-${label}`, { remote: `https://github.com/example-owner/tap-${label}.git` });
    const c = card(ctx);
    const session = `tap-${label}`;
    c.start(session);
    c.send(repo, 'first request', session);
    c.send(repo, 'second request', session);
    assert.equal(c.ask(repo, session, `tu-${label}`), null);
    const picked = c.tap(repo, session, `tu-${label}`, label);
    assert.match(picked.context, pattern, label);
    assert.match(picked.context, /1\. first request\n2\. second request/, label);
    assert.equal(stateOf(ctx, repo).state, 'UNDECIDED', label);
    if (label === 'Later') assert.equal(c.send(repo, 'next', session).action, 'pass', 'later lasts for the run');
    else assert.equal(c.send(repo, 'next', session).action, 'pass');
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
  c.send(repo, 'again', 's1');
  assert.equal(c.typed(repo, 'no', 's1').action, 'pass');
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
  assert.match(typed.context, /yes is pending[\s\S]*1\. go/);
  const repo = gitRepo(ctx, 'hook', { remote: 'https://github.com/example-owner/hook.git' });
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_REMOTE;
  delete env.CLAUDE_ENV_FILE;
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
  const run = (event, input) => JSON.parse(childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', event], { input: JSON.stringify(input), env, encoding: 'utf8' }));
  run('SessionStart', { cwd: repo, session_id: 'h1', source: 'startup' });
  assert.match(run('UserPromptSubmit', { cwd: repo, prompt: 'fix it', session_id: 'h1' }).systemMessage, /pick an answer/);
  for (const tool_name of ['Read', 'Bash']) assert.equal(run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name, tool_input: {} }).hookSpecificOutput.permissionDecision, 'deny', tool_name);
  const filled = run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1', tool_input: { ...gate.PICKER_INPUT, answers: { [gate.PICKER_QUESTION]: 'Yes' } } });
  assert.equal(filled.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(run('PreToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', tool_input: gate.PICKER_INPUT }), {}, 'no decision: Claude Code shows the card to the user');
  const tapped = run('PostToolUse', { cwd: repo, session_id: 'h1', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', tool_input: { ...gate.PICKER_INPUT, answers: { [gate.PICKER_QUESTION]: 'No' } },
    tool_response: { questions: gate.PICKER_INPUT.questions, answers: { [gate.PICKER_QUESTION]: 'No' } } });
  assert.match(tapped.hookSpecificOutput.additionalContext, /no is pending[\s\S]*1\. fix it/);
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
