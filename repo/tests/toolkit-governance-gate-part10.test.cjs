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
  // Session start cannot block, so inside a repository it says the check failed and names the rules file.
  const started = claudeHook.respond('SessionStart', { cwd: repo }, { gate: broken, environment }).hookSpecificOutput.additionalContext;
  assert.match(started, /^Toolkit couldn't load the governance check at this session start \(\w+\)\./);
  assert.match(started, /toolkit-governed-rules\.md/);
  assert.doesNotMatch(started, /boom/);
  const outside = path.join(ctx.root, 'outside');
  fs.mkdirSync(outside);
  assert.deepEqual(claudeHook.respond('UserPromptSubmit', { cwd: outside, prompt: 'go' }, { gate: broken, environment }), {});
  assert.deepEqual(claudeHook.respond('SessionStart', { cwd: outside }, { gate: broken, environment }), {});
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

test('cloud sessions are not asked about an undecided repository and write no governance state; the session line says why', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const environment = { CLAUDE_CODE_REMOTE: 'true' };
  const options = { registryOptions: ctx.options };
  // On a computer the same prompt passes with the governance note, and nothing is held.
  const computerPrompt = claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 'unnoted' }, { ...options, environment: {} });
  assert.equal(computerPrompt.decision, undefined);
  assert.match(computerPrompt.hookSpecificOutput.additionalContext, /no governance decision yet, so it counts as off/);
  assert.equal(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, { ...options, environment: {} }).hookSpecificOutput?.permissionDecision, undefined);
  const cloudPrompt = claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 'cloud' }, { ...options, environment });
  assert.equal(cloudPrompt.decision, undefined);
  assert.doesNotMatch(JSON.stringify(cloudPrompt), /no governance decision yet/);
  assert.deepEqual(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, { ...options, environment }), {});
  const started = claudeHook.respond('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' }, { ...options, environment, refreshBinding: () => {} }).hookSpecificOutput.additionalContext;
  assert.ok(started.startsWith(`${claudeHook.CLOUD_LINE}\n\n`));
  assert.match(started, /example-owner\/example-repo: Toolkit governance: not decided yet[^\n]*not asked the governance question/);
  assert.doesNotMatch(started, /# Toolkit-Governed Repository Rules/);
  writesNothingIn(repo);
});

// The Claude desktop app shows only a turn's closing message in full: on 25 November 2026 the owner saw
// two question cards whose context, written in the same turn, was cut to one line.
test('the desktop app\'s session start says how to ask the owner, governance on, off, undecided or no repository, on every source', (t) => {
  const ctx = scratch(t);
  const seed = require('./support/governance-observations.cjs').seedMerged;
  const repo = (name, answer) => { const made = gitRepo(ctx, name, { remote: `https://github.com/example-owner/${name}.git` }); if (answer) seed(made, answer, { registryOptions: ctx.options }); return made; };
  const folders = { on: repo('on', 'enable'), off: repo('off', 'disable'), undecided: repo('undecided') };
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  const start = (cwd, environment, source = 'startup', options = {}) => claudeHook.respond('SessionStart', { cwd, session_id: 's1', source }, { registryOptions: ctx.options, refreshBinding: () => {}, environment, ...options }).hookSpecificOutput?.additionalContext || '';
  const desktop = { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' };
  const words = [
    'Asking the owner (the Claude desktop app; this stands over your own notes and memories):',
    '1. Put the full context, options and your pick in your closing message and end the turn.',
    '2. Leave how the question shows (a card, the end-of-turn box or plain text) to the app.',
    'Toolkit\'s exact merge card keeps its own text.',
  ].join(' ');
  for (const [name, cwd] of Object.entries({ ...folders, plain })) {
    const text = start(cwd, desktop);
    assert.equal(text.split(words).length, 2, `${name}: the line, once`);
    assert.equal(text, `${start(cwd, {})}\n\n${words}`, `${name}: nothing else changes`);
  }
  // Every source and entry point, with the governance text itself left out.
  const quiet = { gate: { SESSION_TEXT_LIMIT: gate.SESSION_TEXT_LIMIT, startSession() {}, sessionIdOf: gate.sessionIdOf, sessionLine: () => '' }, repoCatchUp: { catchUp: () => null } };
  for (const source of ['startup', 'resume', 'clear', 'compact']) assert.equal(start(plain, desktop, source, quiet), words, source);
  assert.equal(start(plain, { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p' }, 'startup', quiet), words);
  // Only the desktop app: the terminal, the IDE extensions, headless runs, and a cloud session (a
  // Projects thread included) never get it.
  for (const environment of [{}, ...['cli', 'claude-vscode', 'sdk-cli', 'sdk-ts', 'remote', 'remote_desktop', 'ssh-remote', 'not-claude-desktop', 'claude-desktopx', ''].map(CLAUDE_CODE_ENTRYPOINT => ({ CLAUDE_CODE_ENTRYPOINT }))]) {
    assert.equal(start(plain, environment, 'startup', quiet), '', JSON.stringify(environment));
  }
  assert.doesNotMatch(start(plain, { ...desktop, CLAUDE_CODE_REMOTE: 'true' }), /Asking the owner/);
  // It survives a failed governance check, and it refuses no card.
  const broken = { sessionLine() { throw new Error('boom'); }, startSession() {}, insideRepository: gate.insideRepository };
  assert.match(start(folders.on, desktop, 'startup', { gate: broken }), /\n\nAsking the owner/);
  assert.equal(start(plain, desktop, 'startup', { gate: broken }), words);
  const card = { tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', cwd: folders.on, session_id: 's1', tool_input: { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'a' }, { label: 'Blue', description: 'b' }] }] } };
  assert.deepEqual(claudeHook.respond('PreToolUse', card, { registryOptions: ctx.options, environment: desktop }), {});
  for (const event of ['UserPromptSubmit', 'PostToolUse']) {
    assert.doesNotMatch(JSON.stringify(claudeHook.respond(event, { ...card, prompt: 'go' }, { registryOptions: ctx.options, environment: desktop })), /Asking the owner/, event);
  }
});

test('the line never pushes a session start past the host limit: the governance text makes room, and the rules come first', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const desktop = { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' };
  let limit = null, copy = null;
  // The catch-up line goes to the governance text, which places it (first, or in its held block) within
  // the limit it is given.
  const start = length => claudeHook.respond('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' }, { environment: desktop, repoCatchUp: { catchUp: () => 'Caught up.' },
    gate: { SESSION_TEXT_LIMIT: gate.SESSION_TEXT_LIMIT, startSession() {}, sessionIdOf: gate.sessionIdOf, sessionLine(_cwd, given) { limit = given.limit; copy = given.localCopy; return 'x'.repeat(Math.min(length, 20000)); } } }).hookSpecificOutput.additionalContext;
  const fits = start(100);
  const line = fits.split('\n\n').at(-1);
  assert.match(line, /^Asking the owner/);
  assert.equal(copy, 'Caught up.');
  assert.equal(limit, gate.SESSION_TEXT_LIMIT - Buffer.byteLength(`\n\n${line}`), 'the governance text is told what is left');
  assert.ok(Buffer.byteLength(start(limit)) <= gate.SESSION_TEXT_LIMIT);
  assert.equal(start(limit).endsWith(line), true, 'a governance text of exactly that size still has the line');
  assert.equal(start(limit + 1).includes('Asking the owner'), false, 'one that does not fit keeps the governance text whole instead');
});

// A Claude Projects thread starts in /home/user, outside any repository, with each repository cloned
// directly under it; without this scan it gets no governed rules once AGENTS.md carries none.
test('a cloud session started above its repositories gets the governed rules once, for the enabled ones only', (t) => {
  const ctx = scratch(t);
  const options = { registryOptions: ctx.options };
  const environment = { CLAUDE_CODE_REMOTE: 'true' };
  const governed = gitRepo(ctx, 'governed', { remote: 'https://github.com/example-owner/governed.git' });
  const store = gitRepo(ctx, 'store', { remote: 'https://github.com/example-owner/evidence-store.git' });
  const plain = gitRepo(ctx, 'plain', { remote: 'https://github.com/example-owner/plain.git' });
  const off = gitRepo(ctx, 'off', { remote: 'https://github.com/example-owner/off.git' });
  const seed = require('./support/governance-observations.cjs').seedMerged;
  seed(governed, 'enable', { registryOptions: ctx.options });
  seed(off, 'disable', { registryOptions: ctx.options });
  fs.mkdirSync(path.join(ctx.root, 'notes'));
  const refreshed = [];
  const start = cwd => claudeHook.respond('SessionStart', { cwd, session_id: 's1', source: 'startup' }, { ...options, environment, refreshBinding: folder => refreshed.push(folder) }).hookSpecificOutput?.additionalContext;
  const rules = fs.readFileSync(path.join(repoRoot, 'repo', 'contracts', 'agent-rules', 'toolkit-governed-rules.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  const above = start(ctx.root);
  assert.ok(above.startsWith(claudeHook.CLOUD_LINE));
  assert.equal(above.split(rules).length, 2, 'the governed rules, once');
  assert.match(above, /bind only example-owner\/governed\./);
  assert.match(above, /example-owner\/governed: Toolkit governance: ENABLED/);
  assert.match(above, /example-owner\/evidence-store: Toolkit governance: DISABLED here: this repository is an evidence store/);
  assert.match(above, /example-owner\/off: Toolkit governance: DISABLED for this repository/);
  assert.match(above, /example-owner\/plain: Toolkit governance: not decided yet/);
  assert.deepEqual(refreshed.filter(folder => folder !== ctx.root).sort(), [governed, off, plain, store].sort(), 'each child repository is read again first');
  for (const folder of [store, plain, off]) assert.doesNotMatch(start(folder), /# Toolkit-Governed Repository Rules/);
  assert.equal(start(governed).split(rules).length, 2);
  for (const folder of [governed, store, plain, off]) writesNothingIn(folder);
});

// Claude Code keeps a session-start text only up to 10,000 characters; over that it shows a
// 2,000-character preview and the governed rules would be lost. At the scan limit of 16 ENABLED
// repositories with long names the full lines do not fit, so the last ones shrink.
test('a cloud session at the scan limit stays within the host limit and keeps the whole governed rules and every bound repository', (t) => {
  const ctx = scratch(t);
  const environment = { CLAUDE_CODE_REMOTE: 'true' };
  const seed = require('./support/governance-observations.cjs').seedMerged;
  const rules = fs.readFileSync(path.join(repoRoot, 'repo', 'contracts', 'agent-rules', 'toolkit-governed-rules.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  const start = () => claudeHook.respond('SessionStart', { cwd: ctx.root, session_id: 's1', source: 'startup' }, { registryOptions: ctx.options, environment, refreshBinding: () => {} }).hookSpecificOutput.additionalContext;
  const names = [];
  for (let index = 1; index <= 16; index += 1) {
    const name = `example-owner/${'long-service-name-'.repeat(5)}${String(index).padStart(2, '0')}`;
    names.push(name);
    seed(gitRepo(ctx, `repo-${String(index).padStart(2, '0')}`, { remote: `https://github.com/${name}.git` }), index === 16 ? 'disable' : 'enable', { registryOptions: ctx.options });
    if (index === 2) {
      const few = start();
      assert.doesNotMatch(few, /Shortened/, 'a few repositories keep their full lines');
      assert.match(few, /-01: Toolkit governance: ENABLED for this repository\./);
    }
  }
  const text = start();
  assert.ok(Buffer.byteLength(text, 'utf8') <= gate.SESSION_TEXT_LIMIT, `${Buffer.byteLength(text, 'utf8')} bytes`);
  assert.ok(text.startsWith(claudeHook.CLOUD_LINE));
  assert.equal(text.split(rules).length, 2, 'the whole governed rules text, once');
  assert.ok(text.includes(`bind only ${names.slice(0, 15).join(', ')}.`), 'every ENABLED repository is named');
  assert.match(text, /-01: Toolkit governance: ENABLED for this repository\./, 'the first repositories keep their full lines');
  assert.match(text, /-15: ENABLED\n/, 'the last ones shrink to their state');
  assert.match(text, /-16: DISABLED\n\(Shortened to keep this text within the host's session-start limit\. Run toolkit-governance\.cjs status/);
  for (const name of names) assert.ok(text.includes(`- ${name}: `), `${name} still has a state line`);
});

// Session start shows the governance status only, in a cloud session and on a computer: no attention
// line, no stale-check line and no background job, whatever this computer's files from an earlier
// Toolkit hold. Due findings reach the controller at turn end.
function cloudProgrammeWorld(t) {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'governed', { remote: 'https://github.com/example-owner/governed.git' });
  require('./support/governance-observations.cjs').seedMerged(repo, 'enable', { registryOptions: ctx.options });
  const home = path.join(ctx.root, 'programme-home');
  fs.mkdirSync(home, { recursive: true });
  const started = { refresh: [], stale: [] };
  const programmeDeps = { home, attentionDir: path.join(home, 'attention'), sessionsDir: path.join(home, 'sessions'),
    startRefresh: folder => started.refresh.push(folder), startStaleSweep: folder => started.stale.push(folder), now: () => '2026-11-22T10:00:00.000Z' };
  const start = (cwd, environment = { CLAUDE_CODE_REMOTE: 'true' }) => claudeHook.respond('SessionStart', { cwd, session_id: 'cloud-stale', source: 'startup' }, { registryOptions: ctx.options, environment, refreshBinding: () => {}, programmeDeps }).hookSpecificOutput?.additionalContext || '';
  return { ctx, repo, programmeDeps, started, start };
}

test('red: a session start inside an ENABLED repository shows no attention or stale-check line, reads no programme file and starts nothing', t => {
  const world = cloudProgrammeWorld(t);
  assert.equal(governance.governanceState(world.repo, world.ctx.options).programme_records_bind, true, 'fixture binds programme records');
  // An attention cache and a stale-check stamp as an earlier Toolkit wrote them.
  fs.mkdirSync(world.programmeDeps.attentionDir, { recursive: true });
  fs.writeFileSync(path.join(world.programmeDeps.attentionDir, 'example-owner--governed.json'), JSON.stringify({ schema: 'toolkit.programme-attention-cache.v1', repository: 'example-owner/governed',
    as_of: '2026-11-22T09:00:00.000Z', complete: true, counts: { new: 1, acknowledged: 0 }, line: 'Attention: 1 new, 0 acknowledged', digest: 'd1' }));
  const stamp = path.join(world.programmeDeps.home, '.ai-agent-toolkit', 'user-state', 'stale-check', 'example-owner--governed.json');
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, JSON.stringify({ date: '2026-11-22', at: '2026-11-22T09:00:00.000Z', rows: ['FOLD? #20 new under #1 with no Nearest child: line'] }));
  for (const environment of [{ CLAUDE_CODE_REMOTE: 'true' }, {}]) {
    const text = world.start(world.repo, environment);
    assert.match(text, /Toolkit governance: ENABLED/, JSON.stringify(environment));
    assert.doesNotMatch(text, /Attention|Stale check|stale check|toolkit-controller-check|could not run|add_repo|Choose a private repository/, JSON.stringify(environment));
  }
  assert.ok(world.start(world.repo).startsWith(`${claudeHook.CLOUD_LINE}\n\n`));
  assert.deepEqual(world.started, { refresh: [], stale: [] }, 'no background job from session start');
});

test('a cloud session with no repository at or under its start folder gets no governance text', (t) => {
  const ctx = scratch(t);
  fs.mkdirSync(path.join(ctx.root, 'empty'));
  assert.deepEqual(claudeHook.respond('SessionStart', { cwd: path.join(ctx.root, 'empty'), session_id: 's1', source: 'startup' }, { registryOptions: ctx.options, environment: { CLAUDE_CODE_REMOTE: 'true' }, refreshBinding: () => {} }), {});
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
  assert.equal(noticeOf(card.hookSpecificOutput.additionalContext), gate.QUESTION.join('\n').replace('TRANSPORT-<repository name>', 'TRANSPORT-example-repo'));
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
  assert.equal(noticeOf(contextOf(first)), gate.QUESTION.join('\n').replace('TRANSPORT-<repository name>', 'TRANSPORT-example-repo'));
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
  assert.equal(noticeOf(contextOf(resumed)), gate.QUESTION.join('\n').replace('TRANSPORT-<repository name>', 'TRANSPORT-example-repo'));
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
  // A yes opens the governance bank; it records nothing for an agent to publish by hand.
  assert.match(recorded.stdout, /question bank/);
  const after = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, session_id: 'codex-session', prompt: 'go' });
  assert.equal(after.status, 0);
  assert.doesNotMatch(contextOf(after) || '', /is pending|ANSWER/);
  assert.equal(governance.governanceState(repo, homeRegistry).state, 'UNDECIDED');
});
