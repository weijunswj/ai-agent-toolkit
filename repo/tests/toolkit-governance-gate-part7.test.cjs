'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Split to keep the per-file time budget.
test('repository mark failure cannot delete a newly revoked session mark', t => {
  const ctx = scratch(t);
  const options = { registryOptions: ctx.options, environment: {}, host: 'claude-code' };
  const epochs = new gate.SessionEpochs(options);
  epochs.start('user', 'startup', 'repository');
  const file = path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `r-${crypto.createHash('sha256').update('repository').digest('hex').slice(0, 32)}.json`);
  const { renameSync, rmSync } = fs;
  let fault = true;
  const busy = () => Object.assign(new Error('fixture repository mark failure'), { code: 'EBUSY' });
  t.mock.method(fs, 'renameSync', (from, to) => { if (fault && to === file) throw busy(); return renameSync(from, to); });
  t.mock.method(fs, 'rmSync', (target, options) => { if (fault && target === file) throw busy(); return rmSync(target, options); });
  const resumed = new gate.SessionEpochs({ ...options, environment: { TOOLKIT_HOST_SESSION: 'user' } });
  assert.match(resumed.start('user', 'resume', 'repository'), /^[a-f0-9]{32}$/);
  assert.equal(epochs.resumedFromSessionShell('user'), true, 'repository cleanup preserves the newly written revocation');
  fault = false;
  epochs.start('user', 'startup', 'repository');
  assert.equal(epochs.resumedFromSessionShell('user'), true);
  assert.equal(epochs.origin('user'), 'automation');
});

const ticketOf = context => (/ ANSWER ([0-9a-f]{32})\n/.exec(context || '') || [])[1];
const asksIn = result => result.action === 'pass' && String(result.context).includes(QUESTION_LINE);

test('a mark that can be neither replaced nor removed fails safe: an asked run forgets its marks, so no earlier question is answered', (t) => {
  const ctx = scratch(t);
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const start = (sessionId, source, cwd) => gate.startSession({ session_id: sessionId, source, ...(cwd ? { cwd } : {}) }, { registryOptions: ctx.options });
  const pending = (repo, sessionId) => gate.sessionLine(repo, { registryOptions: ctx.options, sessionId });
  const markFile = (kind, key) => path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `${kind}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  // A locked mark (another process holds it open without delete sharing, or its folder is read-only):
  // it cannot be renamed over or removed, though it can still be read.
  const locked = new Set();
  const busy = file => { const error = new Error(`EBUSY: resource busy or locked, ${file}`); error.code = 'EBUSY'; return error; };
  const { renameSync, rmSync } = fs;
  t.mock.method(fs, 'renameSync', (from, to) => { if (locked.has(path.resolve(to))) throw busy(to); return renameSync(from, to); });
  t.mock.method(fs, 'rmSync', (target, options) => { if (locked.has(path.resolve(target))) throw busy(target); return rmSync(target, options); });
  // A resumed run whose session mark is locked and whose start names no repository: the earlier run's
  // question no longer carries a mark the resumed run can match, so its reply is no answer.
  const resumed = gitRepo(ctx, 'resumed');
  start('A', 'startup', resumed);
  assert.ok(asksIn(raw().decide({ cwd: resumed, prompt: 'hello', sessionId: 'A' })));
  locked.add(markFile('s', 'A'));
  assert.equal(start('A', 'resume'), null);
  assert.ok(fs.existsSync(markFile('s', 'A')), 'the locked mark is still there');
  for (const reply of ['yes', 'toolkit governance enable']) {
    const again = raw().decide({ cwd: resumed, prompt: reply, sessionId: 'A' });
    assert.ok(asksIn(again), `${reply}: asked again, not answered`);
    assert.equal(ticketOf(again.context), undefined, reply);
    assert.doesNotMatch(pending(resumed, 'A'), /is pending/, reply);
    // The same resume started in the repository: the earlier question is forgotten again.
    assert.equal(start('A', 'resume', resumed), null);
  }
  assert.equal(stateOf(ctx, resumed).state, 'UNDECIDED');
  locked.delete(markFile('s', 'A'));
  // A continued run reporting a new id while the repository mark is locked but readable: the mark
  // is unchanged, so the user's reply in B's run still counts.
  for (const [index, reply] of ['yes', 'toolkit governance enable'].entries()) {
    const continued = gitRepo(ctx, `continued-${index}`, { remote: `https://github.com/example-owner/continued-${index}.git` });
    start(`B${index}`, 'startup', continued);
    assert.ok(asksIn(raw().decide({ cwd: continued, prompt: 'hello', sessionId: `B${index}` })));
    locked.add(markFile('r', stateOf(ctx, continued).repository_id));
    assert.match(start(`new-id-${index}`, 'resume', continued), /^[a-f0-9]{32}$/);
    const next = raw().decide({ cwd: continued, prompt: reply, sessionId: `B${index}` });
    assert.equal(asksIn(next), false, reply);
    if (index === 0) assert.equal(raw().answerTicket(ticketOf(next.context), 'yes').ok, true);
    assert.match(pending(continued, `B${index}`), /yes is pending/, reply);
    assert.equal(stateOf(ctx, continued).state, 'UNDECIDED');
  }
  // After the reply window, the same start leaves the full answer counting too.
  const later = gitRepo(ctx, 'later', { remote: 'https://github.com/example-owner/later.git' });
  start('L', 'startup', later);
  raw().decide({ cwd: later, prompt: 'hello', sessionId: 'L' });
  assert.ok(ticketOf(raw().decide({ cwd: later, prompt: 'later', sessionId: 'L' }).context));
  locked.add(markFile('r', stateOf(ctx, later).repository_id));
  start('agent-run', 'startup', later);
  assert.match(raw().decide({ cwd: later, prompt: 'toolkit governance enable', sessionId: 'L' }).context, /yes is pending/);
  assert.equal(stateOf(ctx, later).state, 'UNDECIDED');
});

test('every governance refusal and question an agent can see tells it never to act as the user', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  const first = hold(ctx).decide({ cwd: repo, prompt: 'hello', sessionId: 'user' });
  const shell = (cwd, command, session_id) => tools(ctx).decide({ tool_name: 'Bash', cwd, session_id, tool_input: { command } });
  const launched = prompt => new gate.PromptHold({ registryOptions: ctx.options, environment: { [gate.HOST_SESSION_VARIABLE]: 'parent' } }).decide({ cwd: repo, prompt, sessionId: 'child' });
  const texts = {
    'answer command': shell(plain, 'node repo/scripts/toolkit-governance.cjs enable')?.deny,
    'answer command, not on github.com': shell(gitlab, 'node repo/scripts/toolkit-governance.cjs disable')?.deny,
    'user-state edit': tools(ctx).decide({ tool_name: 'Write', cwd: plain, tool_input: { file_path: path.join(path.dirname(ctx.registryPath), 'x.json') } })?.deny,
    'answer script outside its exact command': shell(plain, `node "${gate.ANSWER_SCRIPT}" yes ${'0'.repeat(32)}`, 'user')?.deny,
    'question, text': first.context,
    'scheduled prompt while the reply is awaited': tools(ctx).decide({ tool_name: 'CronCreate', cwd: plain, session_id: 'user', tool_input: { prompt: 'yes' } })?.deny,
    'card changed': tools(ctx).decide({ tool_name: 'AskUserQuestion', cwd: repo, session_id: 'user', tool_use_id: 'x', tool_input: { ...gate.PICKER_INPUT, answers: { [gate.PICKER_QUESTION]: 'Yes' } } })?.deny,
    'launched session, answer': launched('toolkit governance enable').reason,
    'session line, undecided': gate.sessionLine(repo, { registryOptions: ctx.options }),
  };
  assert.deepEqual(launched('hello'), { action: 'pass' }, 'automation is let through with nothing to act on');
  for (const tool of [() => shell(repo, 'ls', 'user'), () => shell(plain, `cd "${repo}" && ls`), () => tools(ctx).decide({ tool_name: 'Write', cwd: plain, tool_input: { file_path: path.join(repo, 'a.txt') } })]) assert.equal(tool(), null, 'no tool is refused for the question');
  const reply = hold(ctx).decide({ cwd: repo, prompt: 'hmm', sessionId: 'user' });
  texts['reply ticket'] = reply.context;
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const ticket = ticketOf(reply.context);
  texts['scheduled prompt while a ticket is live'] = tools(ctx).decide({ tool_name: 'ScheduleWakeup', cwd: plain, session_id: 'user', tool_input: { prompt: 'x' } })?.deny;
  assert.equal(raw().answerTicket(ticket, 'confirm-no').ok, true);
  texts['confirmation reply'] = hold(ctx).decide({ cwd: repo, prompt: 'yes', sessionId: 'user' }).context;
  texts['spent ticket'] = raw().answerTicket(ticket, 'no').text;
  assert.equal(raw().answerTicket(boundOf(texts['confirmation reply']).ticket, 'later').ok, false);
  // A run that was asked and whose reply is over: only a scheduled prompt carrying the full answer is refused.
  const askedOnly = gitRepo(ctx, 'asked-only', { remote: 'https://github.com/example-owner/asked-only.git' });
  hold(ctx).decide({ cwd: askedOnly, prompt: 'hello', sessionId: 'asked-only' });
  hold(ctx).decide({ cwd: askedOnly, prompt: 'carry on', sessionId: 'asked-only' });
  texts['scheduled answer'] = tools(ctx).decide({ tool_name: 'RemoteTrigger', cwd: plain, session_id: 'asked-only', tool_input: { prompt: 'toolkit governance enable' } })?.deny;
  const fresh = gitRepo(ctx, 'fresh', { remote: 'https://github.com/example-owner/fresh.git' });
  texts['question, card'] = new gate.PromptHold({ registryOptions: ctx.options, environment: {}, picker: true }).decide({ cwd: fresh, prompt: 'hello', sessionId: 'user' }).context;
  texts['no mark, work'] = raw().decide({ cwd: fresh, prompt: 'yes', sessionId: 'unmarked' }).context;
  texts['no mark, answer'] = raw().decide({ cwd: fresh, prompt: 'toolkit governance enable', sessionId: 'unmarked' }).reason;
  gate.startSession({ session_id: 'user', source: 'resume', cwd: fresh }, { registryOptions: ctx.options });
  texts['resumed'] = hold(ctx).decide({ cwd: fresh, prompt: 'yes', sessionId: 'user' }).context;
  // Hook failures: the gate module itself may be what failed, so each hook spells the line out.
  const broken = { environment: {}, gate: { insideRepository: () => true, PromptHold: class { constructor() { throw new Error('broken'); } }, ToolGate: class { constructor() { throw new Error('broken'); } } } };
  texts['Claude hook failure, prompt'] = claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'x', session_id: 'user' }, broken)?.reason;
  texts['Claude hook failure, tool'] = claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, broken)?.hookSpecificOutput?.permissionDecisionReason;
  assert.equal(claudeHook.NEVER_OWNER, gate.NEVER_OWNER);
  assert.equal(codexHook.NEVER_OWNER, gate.NEVER_OWNER);
  texts['Codex hook failure, prompt'] = codexHook.PROMPT_FAILED;
  // The card's texts: a tap that does not count.
  const cardRepo = gitRepo(ctx, 'card-texts', { remote: 'https://github.com/example-owner/card-texts.git' });
  const picker = new gate.PromptHold({ registryOptions: ctx.options, environment: {}, picker: true });
  gate.startSession({ session_id: 'card', source: 'startup' }, { registryOptions: ctx.options });
  picker.decide({ cwd: cardRepo, prompt: 'hello', sessionId: 'card' });
  texts['card tap not counted'] = picker.picked({ cwd: cardRepo, sessionId: 'card', toolUseId: 'never-noted', toolResponse: { questions: gate.PICKER_INPUT.questions, answers: { [gate.PICKER_QUESTION]: 'Yes' } } }).context;
  // A refusal shown to the user ends with the short line for agents; every other text with the whole line.
  const notices = ['no mark, answer'];
  for (const [name, text] of Object.entries(texts)) {
    assert.equal(typeof text, 'string', name);
    if (notices.includes(name)) assert.ok(text.endsWith(`\n${AGENT_LINE}`), `${name}: ${text}`);
    else assert.ok(text.endsWith(gate.NEVER_OWNER), `${name}: ${text}`);
  }
});

test('messages an earlier version held are removed at session start, and nothing else in user-state changes', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const folder = path.dirname(ctx.registryPath);
  gate.startSession({ session_id: 'before', source: 'startup', cwd: repo }, { registryOptions: ctx.options });
  hold(ctx).decide({ cwd: repo, prompt: 'hello', sessionId: 'before' });
  hold(ctx).decide({ cwd: repo, prompt: 'hmm', sessionId: 'before' });
  fs.writeFileSync(ctx.heldPath, JSON.stringify({ schema: 'toolkit.governance-held-prompts.v1', repositories: { x: [{ prompt: 'a private message', session_id: 'old', at: '2026-10-24T08:00:00.000Z' }] } }));
  fs.writeFileSync(path.join(folder, 'unrelated.json'), '{"kept":true}');
  const others = () => Object.fromEntries(fs.readdirSync(folder, { recursive: true }).map(String).sort()
    .filter(name => name !== gate.RETIRED_HELD_BASENAME && !name.startsWith(gate.SESSIONS_FOLDER) && fs.statSync(path.join(folder, name)).isFile())
    .map(name => [name, fs.readFileSync(path.join(folder, name), 'utf8')]));
  const before = others();
  assert.ok(Object.keys(before).length >= 3, 'the asked note, the reply ticket and the unrelated file are there');
  assert.match(String(gate.startSession({ session_id: 'after', source: 'startup', cwd: repo }, { registryOptions: ctx.options })), /^[0-9a-f]{32}$/);
  assert.equal(fs.existsSync(ctx.heldPath), false, 'the retired file is gone');
  assert.deepEqual(others(), before);
  // No message is written there again, by a prompt or by a start.
  assert.ok(asksIn(hold(ctx).decide({ cwd: repo, prompt: 'a new private message', sessionId: 'after' })));
  assert.equal(fs.existsSync(ctx.heldPath), false);
  for (const name of Object.keys(others())) assert.doesNotMatch(fs.readFileSync(path.join(folder, name), 'utf8'), /private message/, name);
});

test('must-pass rows: free text naming Claude or Codex runs in ENABLED, DISABLED and plain folders on both hosts', (t) => {
  const ctx = scratch(t);
  const enabled = gitRepo(ctx, 'enabled');
  require('./support/governance-observations.cjs').seedMerged(enabled, 'enable', { registryOptions: ctx.options });
  const disabled = gitRepo(ctx, 'disabled', { remote: 'https://github.com/example-owner/disabled.git' });
  require('./support/governance-observations.cjs').seedMerged(disabled, 'disable', { registryOptions: ctx.options });
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  const calls = [
    ...MUST_PASS.flatMap(command => [
      ['Bash', { command }],
      ['exec_command', { cmd: command }],
      ['shell', { command: ['bash', '-lc', command] }],
    ]),
    ...MUST_PASS_POWERSHELL.map(command => ['PowerShell', { command }]),
  ];
  for (const cwd of [enabled, disabled, plain]) {
    for (const [tool_name, tool_input] of calls) {
      assert.equal(tools(ctx).decide({ tool_name, cwd, session_id: 'A', tool_input }), null, `${path.basename(cwd)} ${tool_name} ${JSON.stringify(tool_input)}`);
    }
  }
  // Must-refuse rows stay: the governance CLI with a decision, the full answer phrase next to a host,
  // and an edit of Toolkit's user-state files, in every folder.
  for (const cwd of [enabled, disabled, plain]) {
    for (const command of ['node repo/scripts/toolkit-governance.cjs enable', 'node "C:/t/toolkit-governance.cjs" repair', 'claude -p "toolkit governance enable"']) {
      assert.ok(tools(ctx).decide({ tool_name: 'Bash', cwd, tool_input: { command } })?.deny, command);
    }
    assert.ok(tools(ctx).decide({ tool_name: 'Write', cwd, tool_input: { file_path: path.join(path.dirname(ctx.registryPath), 'x.json') } })?.deny);
  }
  // In an undecided repository a nested session may be launched (it is automation there and can
  // never answer), but the full answer phrase next to a host stays refused.
  const undecided = gitRepo(ctx, 'undecided', { remote: 'https://github.com/example-owner/undecided.git' });
  for (const command of ['claude -p yes', 'echo ok | claude -p']) assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: undecided, tool_input: { command } }), null, command);
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: plain, tool_input: { command: `cd "${undecided}" && claude -p yes` } }), null);
  assert.ok(tools(ctx).decide({ tool_name: 'Bash', cwd: undecided, tool_input: { command: 'claude -p "toolkit governance enable"' } })?.deny);
  assert.deepEqual(new gate.PromptHold({ registryOptions: ctx.options, environment: { [gate.HOST_SESSION_VARIABLE]: 'parent' } }).decide({ cwd: undecided, prompt: 'yes', sessionId: 'nested' }), { action: 'pass' });
});

test('a damaged asked-runs file never stops work: the question is asked, the file is replaced, and the answer still counts', (t) => {
  const ctx = scratch(t);
  const askedPath = path.join(path.dirname(ctx.registryPath), gate.NOT_NOW_BASENAME);
  gate.startSession({ session_id: 's1', source: 'startup' }, { registryOptions: ctx.options });
  ctx.started = new Set(['s1']);
  const pending = repo => gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' });
  for (const [index, [damage, reply, word]] of [
    ['garbage', 'toolkit governance enable', 'yes'],
    [JSON.stringify({ schema: 'other', repositories: {} }), 'toolkit governance disable', 'no'],
    [JSON.stringify({ schema: 'toolkit.governance-not-now.v1', repositories: [] }), 'not now', null],
  ].entries()) {
    const slug = `damaged-${index}`;
    const repo = gitRepo(ctx, slug, { remote: `https://github.com/example-owner/${slug}.git` });
    fs.mkdirSync(path.dirname(askedPath), { recursive: true });
    fs.writeFileSync(askedPath, damage);
    assert.match(pending(repo), /not decided yet, so this repository counts as off/);
    assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, session_id: 's1', tool_input: { command: 'ls' } }), null);
    const first = claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's1' }, { registryOptions: ctx.options, environment: {} });
    assert.equal(first.decision, undefined, 'the message goes through, and Claude Code shows the card');
    assert.equal(noticeOf(first.hookSpecificOutput.additionalContext), gate.QUESTION.join('\n'));
    assert.ok(JSON.parse(fs.readFileSync(askedPath, 'utf8')).repositories[stateOf(ctx, repo).repository_id].sessions.s1, 'the damaged file is replaced');
    const answered = hold(ctx).decide({ cwd: repo, prompt: reply, sessionId: 's1' });
    assert.equal(answered.action, 'pass', reply);
    if (word) assert.match(pending(repo), new RegExp(`${word} is pending`));
    else assert.ok(ticketOf(answered.context));
    assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  }
  // A note that cannot be saved: every message still goes through, with the question and the way
  // to decide outside chat, and nothing is recorded from chat.
  fs.rmSync(askedPath, { force: true });
  fs.mkdirSync(askedPath);
  const repo = gitRepo(ctx, 'unsaveable', { remote: 'https://github.com/example-owner/unsaveable.git' });
  for (const prompt of ['go', 'not now', 'toolkit governance enable']) {
    const result = hold(ctx).decide({ cwd: repo, prompt, sessionId: 's1' });
    assert.ok(asksIn(result), prompt);
    assert.match(result.context, /could not note that it asked[^\n]*run node "[^"]+toolkit-governance\.cjs" enable or node "[^"]+toolkit-governance\.cjs" disable in your own terminal/, prompt);
    assert.equal(ticketOf(result.context), undefined, prompt);
  }
  assert.doesNotMatch(pending(repo), /is pending/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});
