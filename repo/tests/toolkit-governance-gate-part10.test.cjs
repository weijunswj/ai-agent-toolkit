'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

const ticketOf = context => (/ ANSWER ([0-9a-f]{32})\n/.exec(context || '') || [])[1];
const asksIn = result => result.action === 'pass' && String(result.context).includes(QUESTION_LINE);

// Split to keep the per-file time budget.
test('damaged legacy decisions change nothing for a valid merged repository', t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'repo');
  require('./support/governance-observations.cjs').seedMerged(repo, 'enable', { registryOptions: ctx.options });
  fs.writeFileSync(ctx.registryPath, '{damaged');
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go', sessionId: 's1' }).action, 'pass');
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), '{damaged');
});

test('H-12, H-13: a launcher-started session cannot answer', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) {
    const decision = hold(ctx, { [marker]: 'G1' }).decide({ cwd: repo, prompt: 'toolkit governance enable' });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /automated session cannot answer/);
  }
  assert.equal(registryBytes(ctx), null);
});

test('H-09: a damaged legacy file and a leftover in the retired held-messages place never stop work; a broken gate module still holds inside a repository only', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, '{ not json');
  const corrupt = hold(ctx).decide({ cwd: repo, prompt: 'toolkit governance enable' });
  assert.equal(corrupt.action, 'block', 'a session with no id still cannot answer');
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options }), /not decided yet, so this repository counts as off/);
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), '{ not json', 'never rewritten');
  fs.rmSync(ctx.registryPath);
  // Something that cannot be removed where held messages used to be kept is left alone, and nothing reads it.
  fs.mkdirSync(path.join(ctx.heldPath, 'kept'), { recursive: true });
  const fresh = hold(ctx).decide({ cwd: repo, prompt: 'go', sessionId: 's1' });
  assert.ok(asksIn(fresh));
  assert.match(hold(ctx).decide({ cwd: repo, prompt: 'toolkit governance disable', sessionId: 's1' }).context, /no is pending/);
  assert.deepEqual(fs.readdirSync(ctx.heldPath), ['kept']);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  fs.rmSync(ctx.heldPath, { recursive: true });
  // The hook turns any throw into a hold inside a repository, and into no decision outside one.
  const broken = { PromptHold: class { decide() { throw new Error('boom'); } }, ToolGate: class { decide() { throw new Error('boom'); } },
    sessionLine() { throw new Error('boom'); }, insideRepository: gate.insideRepository };
  const environment = {};
  assert.equal(claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go' }, { gate: broken, environment }).decision, 'block');
  assert.equal(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash' }, { gate: broken, environment }).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(claudeHook.respond('SessionStart', { cwd: repo }, { gate: broken, environment }), {});
  const outside = path.join(ctx.root, 'outside');
  fs.mkdirSync(outside);
  assert.deepEqual(claudeHook.respond('UserPromptSubmit', { cwd: outside, prompt: 'go' }, { gate: broken, environment }), {});
});

test('H-15: prompts are never stored or echoed, and what Toolkit keeps never carries the raw remote', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const secretish = 'my private plan for the merger';
  const first = hold(ctx).decide({ cwd: repo, prompt: secretish, sessionId: 's1' });
  const second = hold(ctx).decide({ cwd: repo, prompt: `${secretish}, part two`, sessionId: 's1' });
  const bare = hold(ctx).decide({ cwd: repo, prompt: secretish });
  assert.ok(asksIn(first));
  assert.ok(ticketOf(second.context));
  for (const message of [first.context, second.context, bare.context]) {
    assert.equal(message.includes(secretish), false);
    assert.doesNotMatch(message, /example-owner|github\.com/);
  }
  const folder = path.dirname(ctx.registryPath);
  const files = fs.readdirSync(folder, { recursive: true }).map(name => path.join(folder, String(name))).filter(file => fs.statSync(file).isFile());
  assert.ok(files.some(file => path.basename(file) === gate.NOT_NOW_BASENAME) && files.some(file => path.basename(file) === gate.TICKETS_BASENAME));
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /private plan/, `${path.basename(file)}: no message text`);
    // What the gate itself keeps (asked runs, reply tickets, session marks) is keyed by the digest identity only.
    if (![gate.NOT_NOW_BASENAME, gate.TICKETS_BASENAME].includes(path.basename(file)) && path.basename(path.dirname(file)) !== gate.SESSIONS_FOLDER) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /example-owner|github\.com/, path.basename(file));
    if (process.platform !== 'win32' && path.basename(path.dirname(file)) !== gate.SESSIONS_FOLDER) assert.equal(fs.statSync(file).mode & 0o777, 0o600, path.basename(file));
  }
  assert.equal(fs.existsSync(ctx.heldPath), false);
});

test('cloud governance remains advisory and writes nothing; the session line explains closure enforcement', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const environment = { CLAUDE_CODE_REMOTE: 'true' };
  assert.deepEqual(claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go' }, { environment, registryOptions: ctx.options }), {});
  assert.deepEqual(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, { environment, registryOptions: ctx.options }), {});
  assert.equal(claudeHook.respond('SessionStart', { cwd: repo }, { environment }).hookSpecificOutput.additionalContext, claudeHook.CLOUD_LINE);
  assert.deepEqual(claudeHook.respond('SessionStart', { cwd: ctx.root }, { environment }), {});
  writesNothingIn(repo);
  assert.equal(fs.existsSync(ctx.heldPath), false);
});

test('cloud closure unknowns advise, proven open descendants refuse, and local unknowns name gh', () => {
  const input = { tool_name: 'mcp__github__close_issue', tool_input: { owner: 'example.test', repo: 'app', issue_number: 1 } };
  for (const status of ['unknown','refused']) {
    const options = { environment: {CLAUDE_CODE_REMOTE:'true'}, guard: { assertClosable: () => ({status,reason:'gh is not signed in; run gh auth login'}) } };
    const result = claudeHook.respond('PreToolUse', input, options);
    if (status === 'unknown') { assert.equal(result.hookSpecificOutput, undefined); assert.match(result.systemMessage, /advisory.*gh.*Required CI/); }
    else assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  }
});

test('hosts: the Claude hook script asks once and records the answer end to end with the real user-state location', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const home = path.join(ctx.root, 'home');
  const run = (event, input) => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CODE_REMOTE;
    for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
    const out = childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', event], { input: JSON.stringify(input), env, encoding: 'utf8' });
    return JSON.parse(out);
  };
  assert.match(run('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' }).hookSpecificOutput.additionalContext, /not decided yet, so this repository counts as off/);
  // Tools run before, during and after the question.
  const tool = () => run('PreToolUse', { cwd: repo, session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual(tool(), {});
  // The session is noted, so Claude Code shows the card: the message goes through with it.
  const card = run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's1' });
  assert.equal(card.decision, undefined);
  assert.match(card.systemMessage, /Pick an answer on the card, or carry on; nothing waits on it/);
  assert.equal(noticeOf(card.hookSpecificOutput.additionalContext), gate.QUESTION.join('\n'));
  assert.ok(card.hookSpecificOutput.additionalContext.includes(JSON.stringify(gate.PICKER_INPUT)));
  for (let call = 0; call < 3; call += 1) assert.deepEqual(tool(), {}, `tool call ${call + 1} of the asked run`);
  // The second and third messages of the run carry no question.
  for (const prompt of ['and then this', 'and this']) {
    const next = run('UserPromptSubmit', { cwd: repo, prompt, session_id: 's1' });
    assert.equal(next.decision, undefined);
    assert.equal(next.systemMessage, undefined);
    assert.doesNotMatch(JSON.stringify(next), /Turn on GitHub governance/);
  }
  // A session the hook never noted is let through with the way to decide.
  const unnoted = run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 'unnoted' });
  assert.equal(unnoted.decision, undefined);
  assert.match(unnoted.hookSpecificOutput.additionalContext, /This session started before Toolkit could note it/);
  assert.deepEqual(run('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }), {});
  // A second session before any decision is asked once itself.
  run('SessionStart', { cwd: repo, session_id: 's2', source: 'startup' });
  assert.match(run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's2' }).systemMessage, /Pick an answer on the card/);
  assert.equal(run('UserPromptSubmit', { cwd: repo, prompt: 'more', session_id: 's2' }).systemMessage, undefined);
  // `decline` is the older word for `disable` and still answers.
  const answered = run('UserPromptSubmit', { cwd: repo, prompt: 'toolkit governance decline', session_id: 's1' });
  assert.match(answered.hookSpecificOutput.additionalContext, /no is pending/);
  assert.doesNotMatch(answered.hookSpecificOutput.additionalContext, /1\. go/);
  assert.match(run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's1' }).hookSpecificOutput.additionalContext, /no is pending/);
  assert.match(run('SessionStart', { cwd: repo }).hookSpecificOutput.additionalContext, /not decided yet, so this repository counts as off/);
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json')), false);
  // An unknown event name is a broken install and holds.
  const broken = childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', 'Nope'],
    { input: JSON.stringify({ cwd: repo }), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.equal(JSON.parse(broken).decision, 'block');
});

test('hosts: the Codex helper hook lets prompts and tools through in an undecided repository, asks once in text and records the answer', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_REMOTE;
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
  const run = input => childProcess.spawnSync(process.execPath, [path.join(scripts, 'toolkit-codex-helper-hook.cjs')], { input: JSON.stringify(input), env, encoding: 'utf8' });
  const contextOf = result => (result.stdout ? JSON.parse(result.stdout).hookSpecificOutput?.additionalContext : undefined);
  assert.equal(codexHook.promptEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'x' }), true);
  assert.equal(codexHook.promptEvent({ prompt: 'x' }), true);
  assert.equal(codexHook.promptEvent({ tool_name: 'Bash', tool_input: {} }), false);
  // Codex's real session-start script (its bridge maintenance stubbed) records the run's marks, as Claude Code's does.
  const codexSessionStart = input => {
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PLUGIN_ROOT: process.env.PLUGIN_ROOT };
    const log = console.log;
    Object.assign(process.env, { HOME: home, USERPROFILE: home });
    console.log = () => {};
    try { codexSessionStartScript.main(codexSessionStartScript.HOOK_ARGS, { bridge: { run: () => ({ status: 0 }) }, input }); } finally {
      console.log = log;
      for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  };
  codexSessionStart({ hook_event_name: 'SessionStart', session_id: 'codex-session', source: 'startup', cwd: repo });
  const first = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'go' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(contextOf(first), /1\. Do what the user asked in the message above\.\n2\. End your reply with this question, word for word, and ask nothing else in that reply:/);
  assert.equal(noticeOf(contextOf(first)), gate.QUESTION.join('\n'));
  for (let call = 0; call < 3; call += 1) {
    const tool = run({ hook_event_name: 'PreToolUse', cwd: repo, session_id: 'codex-session', tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** End Patch' } });
    assert.equal(tool.status, 0, `tool call ${call + 1}: ${tool.stdout}`);
    assert.doesNotMatch(tool.stdout, /deny/);
  }
  // `codex exec resume codex-session yes`: the session start gives the run new marks, so its "yes"
  // is no reply: it goes through with the question, asked again for the new run.
  codexSessionStart({ hook_event_name: 'SessionStart', session_id: 'codex-session', source: 'resume', cwd: repo });
  const resumed = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'yes' });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(noticeOf(contextOf(resumed)), gate.QUESTION.join('\n'));
  assert.equal(ticketOf(contextOf(resumed)), undefined);
  const homeRegistry = { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  assert.doesNotMatch(gate.sessionLine(repo, { registryOptions: homeRegistry, sessionId: 'codex-session' }), /is pending/);
  assert.equal(governance.governanceState(repo, homeRegistry).state, 'UNDECIDED');
  // The user's short reply to the question comes to the agent with a ticket, and the ticket records it.
  const reply = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'yes' });
  assert.equal(reply.status, 0, reply.stderr);
  const ticket = ticketOf(contextOf(reply));
  assert.ok(ticket);
  const answerCommand = `node "${gate.ANSWER_SCRIPT}" yes ${ticket}`;
  const allowed = run({ hook_event_name: 'PreToolUse', cwd: repo, session_id: 'codex-session', tool_name: 'exec_command', tool_input: { cmd: answerCommand } });
  assert.equal(allowed.status, 0, allowed.stdout);
  const recorded = childProcess.spawnSync(process.execPath, [gate.ANSWER_SCRIPT, 'yes', ticket], { env, encoding: 'utf8' });
  assert.equal(recorded.status, 0, recorded.stdout);
  const after = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'go' });
  assert.equal(after.status, 0);
  assert.match(contextOf(after), /yes is pending/);
});
