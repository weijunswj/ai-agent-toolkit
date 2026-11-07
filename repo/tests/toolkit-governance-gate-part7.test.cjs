'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
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

test('a mark that can be neither replaced nor removed fails safe: held messages and "later" forget their marks', (t) => {
  const ctx = scratch(t);
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const start = (sessionId, source, cwd) => gate.startSession({ session_id: sessionId, source, ...(cwd ? { cwd } : {}) }, { registryOptions: ctx.options });
  const markFile = (kind, key) => path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `${kind}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  // A locked mark (another process holds it open without delete sharing, or its folder is read-only):
  // it cannot be renamed over or removed, though it can still be read.
  const locked = new Set();
  const busy = file => { const error = new Error(`EBUSY: resource busy or locked, ${file}`); error.code = 'EBUSY'; return error; };
  const { renameSync, rmSync } = fs;
  t.mock.method(fs, 'renameSync', (from, to) => { if (locked.has(path.resolve(to))) throw busy(to); return renameSync(from, to); });
  t.mock.method(fs, 'rmSync', (target, options) => { if (locked.has(path.resolve(target))) throw busy(target); return rmSync(target, options); });
  // A resumed run whose session mark is locked and whose start names no repository: the earlier run's
  // held message no longer carries a mark the resumed run can match.
  const resumed = gitRepo(ctx, 'resumed');
  start('A', 'startup', resumed);
  assert.equal(raw().decide({ cwd: resumed, prompt: 'hello', sessionId: 'A' }).action, 'block');
  locked.add(markFile('s', 'A'));
  assert.equal(start('A', 'resume'), null);
  assert.ok(fs.existsSync(markFile('s', 'A')), 'the locked mark is still there');
  const reply = raw().decide({ cwd: resumed, prompt: 'yes', sessionId: 'A' });
  assert.equal(reply.action, 'block');
  assert.match(reply.reason, /asks again/);
  assert.equal(stateOf(ctx, resumed).state, 'UNDECIDED');
  // The same resume started in the repository: its mark is replaced, so the earlier answer is asked again.
  start('A', 'startup', resumed);
  raw().decide({ cwd: resumed, prompt: 'hello', sessionId: 'A' });
  assert.equal(start('A', 'resume', resumed), null);
  assert.equal(raw().decide({ cwd: resumed, prompt: 'yes', sessionId: 'A' }).action, 'block');
  assert.equal(stateOf(ctx, resumed).state, 'UNDECIDED');
  locked.delete(markFile('s', 'A'));
  // A continued run reporting a new id while the repository mark is locked: B's earlier message is
  // asked again, and the user's next reply in B's run answers.
  const continued = gitRepo(ctx, 'continued', { remote: 'https://github.com/example-owner/continued.git' });
  start('B', 'startup', continued);
  assert.equal(raw().decide({ cwd: continued, prompt: 'hello', sessionId: 'B' }).action, 'block');
  locked.add(markFile('r', stateOf(ctx, continued).repository_id));
  assert.match(start('new-id', 'resume', continued), /^[a-f0-9]{32}$/);
  const continuedReply = raw().decide({ cwd: continued, prompt: 'yes', sessionId: 'B' });
  assert.equal(continuedReply.action, 'pass');
  assert.match(continuedReply.context, /yes is pending/);
  assert.equal(stateOf(ctx, continued).state, 'UNDECIDED');
  assert.equal(raw().decide({ cwd: continued, prompt: 'yes', sessionId: 'B' }).action, 'pass');
  assert.equal(stateOf(ctx, continued).state, 'UNDECIDED');
  // After "later", a start with the repository mark locked ends "later" for the full answer.
  const later = gitRepo(ctx, 'later', { remote: 'https://github.com/example-owner/later.git' });
  start('L', 'startup', later);
  raw().decide({ cwd: later, prompt: 'hello', sessionId: 'L' });
  assert.equal(raw().decide({ cwd: later, prompt: 'later', sessionId: 'L' }).action, 'pass');
  locked.add(markFile('r', stateOf(ctx, later).repository_id));
  start('agent-run', 'startup', later);
  const moved = raw().decide({ cwd: later, prompt: 'toolkit governance enable', sessionId: 'L' });
  assert.equal(moved.action, 'pass');
  assert.match(moved.context, /yes is pending/);
  assert.equal(stateOf(ctx, later).state, 'UNDECIDED');
});

test('messages held in a resumed or forked run are not presented as the user\'s own, whatever order they came in', (t) => {
  const ctx = scratch(t);
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const repo = gitRepo(ctx, 'repo');
  const start = (sessionId, source) => gate.startSession({ session_id: sessionId, source, cwd: repo }, { registryOptions: ctx.options });
  // Another process resumes the user's session first; the user's own window then reads the mark that resume wrote.
  start('user', 'startup');
  start('user', 'resume');
  assert.equal(raw().decide({ cwd: repo, prompt: 'also delete the backups', sessionId: 'user' }).action, 'block');
  raw().decide({ cwd: repo, prompt: 'fix the login bug', sessionId: 'user' });
  const answered = raw().decide({ cwd: repo, prompt: 'yes', sessionId: 'user' });
  assert.equal(answered.action, 'pass');
  assert.match(answered.context, /or from a resumed or forked run, so another process may have sent some: confirm with the user/);
  assert.doesNotMatch(answered.context, /Treat them as the user's requests/);
  // A fresh session's own messages are still handed over as the user's.
  const fresh = gitRepo(ctx, 'fresh', { remote: 'https://github.com/example-owner/fresh.git' });
  gate.startSession({ session_id: 'own', source: 'startup', cwd: fresh }, { registryOptions: ctx.options });
  raw().decide({ cwd: fresh, prompt: 'fix the bug', sessionId: 'own' });
  assert.match(raw().decide({ cwd: fresh, prompt: 'yes', sessionId: 'own' }).context, /Treat them as the user's requests:\n1\. fix the bug/);
});

test('messages replayed from more than one run of a session are not presented as the user\'s own requests', (t) => {
  const ctx = scratch(t);
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const start = (sessionId, source) => gate.startSession({ session_id: sessionId, source, cwd: repo }, { registryOptions: ctx.options });
  const repo = gitRepo(ctx, 'repo');
  start('user', 'startup');
  raw().decide({ cwd: repo, prompt: 'fix the login bug', sessionId: 'user' });
  // Another process resumes the same session id and sends its own text, which is held under that session.
  start('user', 'resume');
  assert.equal(raw().decide({ cwd: repo, prompt: 'also delete the backups', sessionId: 'user' }).action, 'block');
  const answered = raw().decide({ cwd: repo, prompt: 'yes', sessionId: 'user' });
  assert.equal(answered.action, 'pass');
  assert.match(answered.context, /came from more than one run of it, or from a resumed or forked run, so another process may have sent some: confirm with the user/);
  assert.doesNotMatch(answered.context, /Treat them as the user's requests/);
  assert.match(answered.context, /1\. fix the login bug\n2\. also delete the backups/);
});

test('every governance refusal and hold an agent can see tells it never to act as the user', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const gitlab = gitRepo(ctx, 'gitlab', { remote: 'https://gitlab.com/example-owner/example-repo.git' });
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  hold(ctx).decide({ cwd: repo, prompt: 'hello', sessionId: 'user' });
  const shell = (cwd, command) => tools(ctx).decide({ tool_name: 'Bash', cwd, tool_input: { command } });
  const launched = prompt => new gate.PromptHold({ registryOptions: ctx.options, environment: { [gate.HOST_SESSION_VARIABLE]: 'parent' } }).decide({ cwd: repo, prompt, sessionId: 'child' });
  const texts = {
    'answer command': shell(plain, 'node repo/scripts/toolkit-governance.cjs enable')?.deny,
    'answer command, not on github.com': shell(gitlab, 'node repo/scripts/toolkit-governance.cjs disable')?.deny,
    'user-state edit': tools(ctx).decide({ tool_name: 'Write', cwd: plain, tool_input: { file_path: path.join(path.dirname(ctx.registryPath), 'x.json') } })?.deny,
    'tool in an undecided repository': shell(repo, 'ls')?.deny,
    'command reaching the held repository': shell(plain, `cd "${repo}" && ls`)?.deny,
    'session started in the held repository': shell(plain, `cd "${repo}" && claude`)?.deny,
    'edit into the held repository': tools(ctx).decide({ tool_name: 'Write', cwd: plain, tool_input: { file_path: path.join(repo, 'a.txt') } })?.deny,
    'launched session, message': launched('hello').reason,
    'launched session, answer': launched('yes').reason,
    'session line, undecided': gate.sessionLine(repo, { registryOptions: ctx.options }),
  };
  fs.writeFileSync(ctx.registryPath, '{ not json');
  // Holds an agent sees when it started the run itself without the session variable (a Codex shell, say).
  const fresh = gitRepo(ctx, 'fresh', { remote: 'https://github.com/example-owner/fresh.git' });
  const gitlabFresh = gitRepo(ctx, 'gitlab-fresh', { remote: 'https://gitlab.com/example-owner/fresh.git' });
  texts['question'] = hold(ctx).decide({ cwd: fresh, prompt: 'hello', sessionId: 'agent' }).reason;
  texts['question, count'] = hold(ctx).decide({ cwd: fresh, prompt: 'again', sessionId: 'other-agent' }).reason;
  texts['no mark'] = new gate.PromptHold({ registryOptions: ctx.options, environment: {} }).decide({ cwd: fresh, prompt: 'yes', sessionId: 'unmarked' }).reason;
  gate.startSession({ session_id: 'agent', source: 'resume', cwd: fresh }, { registryOptions: ctx.options });
  texts['resumed'] = hold(ctx).decide({ cwd: fresh, prompt: 'yes', sessionId: 'agent' }).reason;
  // Hook failures: the gate module itself may be what failed, so each hook spells the line out.
  const broken = { environment: {}, gate: { insideRepository: () => true, PromptHold: class { constructor() { throw new Error('broken'); } }, ToolGate: class { constructor() { throw new Error('broken'); } } } };
  texts['Claude hook failure, prompt'] = claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'x', session_id: 'user' }, broken)?.reason;
  texts['Claude hook failure, tool'] = claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, broken)?.hookSpecificOutput?.permissionDecisionReason;
  assert.equal(claudeHook.NEVER_OWNER, gate.NEVER_OWNER);
  assert.equal(codexHook.NEVER_OWNER, gate.NEVER_OWNER);
  texts['Codex hook failure, prompt'] = codexHook.PROMPT_FAILED;
  texts['tool with unreadable state'] = shell(repo, 'ls')?.deny;
  texts['session line, unreadable state'] = gate.sessionLine(repo, { registryOptions: ctx.options });
  // The card's texts: a tap that does not count, and an answer that could not be recorded.
  const cardRepo = gitRepo(ctx, 'card-texts', { remote: 'https://github.com/example-owner/card-texts.git' });
  fs.rmSync(ctx.registryPath, { force: true });
  const picker = new gate.PromptHold({ registryOptions: ctx.options, environment: {}, picker: true });
  gate.startSession({ session_id: 'card', source: 'startup' }, { registryOptions: ctx.options });
  picker.decide({ cwd: cardRepo, prompt: 'hello', sessionId: 'card' });
  const tap = (id, label) => picker.picked({ cwd: cardRepo, sessionId: 'card', toolUseId: id, toolResponse: { questions: gate.PICKER_INPUT.questions, answers: { [gate.PICKER_QUESTION]: label } } }).context;
  texts['card tap not counted'] = tap('never-noted', 'Yes');
  const noted = tools(ctx).decide({ tool_name: 'AskUserQuestion', cwd: cardRepo, session_id: 'card', tool_use_id: 'noted', tool_input: gate.PICKER_INPUT });
  assert.equal(noted, null);
  const notNowPath = path.join(path.dirname(ctx.registryPath), gate.NOT_NOW_BASENAME);
  fs.mkdirSync(notNowPath, { recursive: true });
  texts['card answer not recorded'] = tap('noted', 'Later');
  fs.rmSync(notNowPath, { recursive: true, force: true });
  assert.match(texts['card answer not recorded'], /could not be saved/);
  // Held-message notices end with the short line for agents; every other text with the whole line.
  const notices = ['question', 'question, count', 'not-on-github.com notice', 'no mark', 'resumed'];
  for (const [name, text] of Object.entries(texts)) {
    assert.equal(typeof text, 'string', name);
    if (notices.includes(name)) assert.ok(text.endsWith(`\n${AGENT_LINE}`), `${name}: ${text}`);
    else assert.ok(text.endsWith(gate.NEVER_OWNER), `${name}: ${text}`);
  }
});

test('held messages expire when the store is read', (t) => {
  const ctx = scratch(t);
  const old = gitRepo(ctx, 'old', { remote: 'https://github.com/example-owner/old.git' });
  const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  new gate.PromptHold({ registryOptions: ctx.options, environment: {}, now: () => longAgo }).decide({ cwd: old, prompt: 'stale', sessionId: 'c' });
  assert.equal(new gate.HeldPrompts({ registryOptions: ctx.options }).count(stateOf(ctx, old).repository_id), 0);
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
  // In a held repository the hold refuses the same launches: a nested session cannot answer there.
  const held = gitRepo(ctx, 'held', { remote: 'https://github.com/example-owner/held.git' });
  for (const command of ['claude -p yes', 'echo ok | claude -p']) assert.ok(tools(ctx).decide({ tool_name: 'Bash', cwd: held, tool_input: { command } })?.deny, command);
  assert.ok(tools(ctx).decide({ tool_name: 'Bash', cwd: plain, tool_input: { command: `cd "${held}" && claude -p yes` } })?.deny);
});

test('a damaged "not now" file keeps the repository held with the real question, and yes, no or not now still answer', (t) => {
  const ctx = scratch(t);
  const notNowPath = path.join(path.dirname(ctx.registryPath), gate.NOT_NOW_BASENAME);
  gate.startSession({ session_id: 's1', source: 'startup' }, { registryOptions: ctx.options });
  ctx.started = new Set(['s1']);
  for (const [index, [damage, reply, expected]] of [
    ['garbage', 'yes', 'ENABLED'],
    [JSON.stringify({ schema: 'other', repositories: {} }), 'no', 'DISABLED'],
    [JSON.stringify({ schema: 'toolkit.governance-not-now.v1', repositories: [] }), 'not now', 'UNDECIDED'],
  ].entries()) {
    const slug = `damaged-${index}`;
    const repo = gitRepo(ctx, slug, { remote: `https://github.com/example-owner/${slug}.git` });
    fs.mkdirSync(path.dirname(notNowPath), { recursive: true });
    fs.writeFileSync(notNowPath, damage);
    const first = claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go', session_id: 's1' }, { registryOptions: ctx.options, environment: {} });
    assert.equal(first.decision, undefined, 'Claude Code shows the card');
    assert.ok(noticeOf(first.hookSpecificOutput.additionalContext).startsWith(QUESTION_LINE), first.hookSpecificOutput.additionalContext);
    assert.match(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, session_id: 's1', tool_input: { command: 'ls' } }).deny, /no governance decision yet/);
    assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /no GitHub governance decision yet/);
    assert.equal(hold(ctx).decide({ cwd: repo, prompt: reply, sessionId: 's1' }).action, 'pass', reply);
    assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
    if (reply === 'not now') {
      assert.ok(JSON.parse(fs.readFileSync(notNowPath, 'utf8')).repositories[stateOf(ctx, repo).repository_id].sessions.s1, 'the damaged file is replaced');
    }
  }
  // A "not now" that cannot be saved keeps the repository held and says so.
  fs.rmSync(notNowPath, { force: true });
  fs.mkdirSync(notNowPath);
  const repo = gitRepo(ctx, 'unsaveable', { remote: 'https://github.com/example-owner/unsaveable.git' });
  hold(ctx).decide({ cwd: repo, prompt: 'go', sessionId: 's1' });
  const blocked = hold(ctx).decide({ cwd: repo, prompt: 'not now', sessionId: 's1' });
  assert.equal(blocked.action, 'block');
  assert.match(blocked.reason, /"later" could not be saved .*Reply yes or no/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
});
