'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
test('damaged legacy decisions cannot hold a valid merged repository', t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'repo');
  require('./support/governance-observations.cjs').seedMerged(repo, 'enable', { registryOptions: ctx.options });
  fs.writeFileSync(ctx.registryPath, '{damaged');
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go', sessionId: 's1' }).action, 'pass');
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), '{damaged');
});

test('H-12, H-13: a launcher-started session cannot answer, and stays held', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) {
    const decision = hold(ctx, { [marker]: 'G1' }).decide({ cwd: repo, prompt: 'toolkit governance enable' });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /automated session cannot answer/);
  }
  assert.equal(registryBytes(ctx), null);
});

test('H-09: unreadable state, an unreadable held-prompt store and a broken gate module all hold inside a repository only', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, '{ not json');
  const corrupt = hold(ctx).decide({ cwd: repo, prompt: 'toolkit governance enable' });
  assert.equal(corrupt.action, 'block');
  assert.match(corrupt.reason, /Turn on GitHub governance/);
  assert.match(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }).deny, /no governance decision yet/);
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options }), /no GitHub governance decision yet/);
  fs.rmSync(ctx.registryPath);
  // A damaged held-prompt store is moved aside (kept on this computer) and the question still works.
  fs.writeFileSync(ctx.heldPath, 'garbage');
  const fresh = hold(ctx).decide({ cwd: repo, prompt: 'go', sessionId: 's1' });
  assert.equal(fresh.action, 'block');
  assert.ok(fresh.reason.startsWith(QUESTION_LINE));
  const aside = fs.readdirSync(path.dirname(ctx.heldPath)).filter(name => name.startsWith(`${gate.HELD_BASENAME}.damaged-`));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(ctx.heldPath), aside[0]), 'utf8'), 'garbage');
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'no', sessionId: 's1' }).action, 'pass');
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // A store that cannot be read at all still holds (fail closed).
  const unreadableRepo = gitRepo(ctx, 'unreadable', { remote: 'https://github.com/example-owner/unreadable.git' });
  fs.rmSync(ctx.heldPath, { force: true });
  fs.mkdirSync(ctx.heldPath);
  assert.throws(() => hold(ctx).decide({ cwd: unreadableRepo, prompt: 'go' }), { code: 'HELD_PROMPTS_UNREADABLE' });
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

test('H-15: held prompts stay private, are never echoed in the hold message, and never carry the raw remote', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const secretish = 'my private plan for the merger';
  const first = hold(ctx).decide({ cwd: repo, prompt: secretish });
  const second = hold(ctx).decide({ cwd: repo, prompt: 'x'.repeat(gate.MAX_HELD_CHARS + 50) });
  for (const message of [first.reason, second.reason]) {
    assert.equal(message.includes(secretish), false);
    assert.doesNotMatch(message, /example-owner|github\.com/);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(ctx.heldPath).mode & 0o777, 0o600);
  const stored = JSON.parse(fs.readFileSync(ctx.heldPath, 'utf8'));
  const list = Object.values(stored.repositories)[0];
  assert.equal(list[1].text.length, gate.MAX_HELD_CHARS);
  assert.doesNotMatch(JSON.stringify(stored), /example-owner|github\.com/, 'keyed by the digest identity only');
  for (let index = 0; index < gate.MAX_HELD + 5; index += 1) hold(ctx).decide({ cwd: repo, prompt: `p${index}` });
  assert.equal(Object.values(JSON.parse(fs.readFileSync(ctx.heldPath, 'utf8')).repositories)[0].length, gate.MAX_HELD);
});

test('cloud sessions hold an undecided repository as a computer does; the session line says the holds run', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const environment = { CLAUDE_CODE_REMOTE: 'true' };
  const local = {};
  const options = { registryOptions: ctx.options };
  for (const env of [environment, local]) {
    assert.equal(claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 'unnoted' }, { ...options, environment: env }).decision, 'block');
    assert.equal(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, { ...options, environment: env }).hookSpecificOutput.permissionDecision, 'deny');
  }
  const start = claudeHook.respond('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' }, { ...options, environment, refreshBinding: () => {} }).hookSpecificOutput.additionalContext;
  assert.ok(start.endsWith(claudeHook.CLOUD_LINE));
  assert.match(start, /no GitHub governance decision yet/);
  const outside = claudeHook.respond('SessionStart', { cwd: ctx.root, session_id: 's2', source: 'startup' }, { ...options, environment, refreshBinding: () => {} }).hookSpecificOutput.additionalContext;
  assert.equal(outside, claudeHook.respond('SessionStart', { cwd: ctx.root, session_id: 's3', source: 'startup' }, { ...options, environment: local, refreshBinding: () => {} }).hookSpecificOutput.additionalContext, 'outside a repository the cloud line is the local one');
});

test('cloud closure unknowns advise, proven open descendants refuse, and local unknowns name gh', () => {
  const input = { tool_name: 'mcp__github__close_issue', tool_input: { owner: 'example.test', repo: 'app', issue_number: 1 } };
  for (const status of ['unknown','refused']) {
    const options = { environment: {CLAUDE_CODE_REMOTE:'true'}, guard: { assertClosable: () => ({status,reason:'gh is not signed in; run gh auth login'}) } };
    const result = claudeHook.respond('PreToolUse', input, options);
    if (status === 'unknown') { assert.equal(result.hookSpecificOutput, undefined); assert.match(result.systemMessage, /advisory.*gh.*Required CI/); assert.doesNotMatch(result.systemMessage, /advisory: Toolkit:/); }
    else assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  }
});

test('hosts: the Claude hook script holds and answers end to end with the real user-state location', (t) => {
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
  assert.match(run('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' }).hookSpecificOutput.additionalContext, /no GitHub governance decision yet/);
  // The session is noted, so Claude Code shows the card: the turn runs with the notice and nothing else.
  const card = run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's1' });
  assert.equal(card.decision, undefined);
  assert.match(card.systemMessage, /pick an answer to the governance question/);
  assert.ok(noticeOf(card.hookSpecificOutput.additionalContext).startsWith(QUESTION_LINE));
  // A session the hook never noted gets the text hold.
  assert.equal(run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 'unnoted' }).decision, 'block');
  assert.equal(run('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }).hookSpecificOutput.permissionDecision, 'deny');
  // `decline` is the older word for `disable` and still answers.
  const answered = run('UserPromptSubmit', { cwd: repo, prompt: 'toolkit governance decline', session_id: 's1' });
  assert.match(answered.hookSpecificOutput.additionalContext, /1\. go/);
  assert.match(run('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's1' }).hookSpecificOutput.additionalContext, /no is pending/);
  assert.match(run('SessionStart', { cwd: repo }).hookSpecificOutput.additionalContext, /no GitHub governance decision yet/);
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json')), false);
  // An unknown event name is a broken install and holds.
  const broken = childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', 'Nope'],
    { input: JSON.stringify({ cwd: repo }), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.equal(JSON.parse(broken).decision, 'block');
});

test('hosts: the Codex helper hook holds prompts with exit 2 and refuses tools in an undecided repository', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
  const run = input => childProcess.spawnSync(process.execPath, [path.join(scripts, 'toolkit-codex-helper-hook.cjs')], { input: JSON.stringify(input), env, encoding: 'utf8' });
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
  const held = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'go' });
  assert.equal(held.status, 2);
  assert.equal(JSON.parse(held.stdout).decision, 'block');
  assert.ok(held.stderr.startsWith(QUESTION_LINE));
  const tool = run({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** End Patch' } });
  assert.equal(tool.status, 2);
  assert.match(JSON.parse(tool.stdout).hookSpecificOutput.permissionDecisionReason, /no governance decision yet/);
  // `codex exec resume codex-session yes`: the session start gives the run new marks, so its reply is held.
  codexSessionStart({ hook_event_name: 'SessionStart', session_id: 'codex-session', source: 'resume', cwd: repo });
  const resumed = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'yes' });
  assert.equal(resumed.status, 2);
  assert.ok(resumed.stderr.includes('this session was resumed'), resumed.stderr);
  assert.equal(governance.governanceState(repo, { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true }).state, 'UNDECIDED');
  // The user's short reply to the question, asked again, is the answer on Codex too.
  const answered = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'yes' });
  assert.equal(answered.status, 0, answered.stderr);
  assert.match(JSON.parse(answered.stdout).hookSpecificOutput.additionalContext, /yes is pending/);
  const after = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'go' });
  assert.equal(after.status, 0);
  assert.match(JSON.parse(after.stdout).hookSpecificOutput.additionalContext, /yes is pending/);
});
