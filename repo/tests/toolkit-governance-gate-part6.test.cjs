'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Split to keep the per-file time budget.
test('session authority closure: repeated starts never raise origin or clear negative marks', t => {
  const ctx = scratch(t);
  // Matrix: native host x initial origin/source x later event. Payload host claims grant nothing.
  for (const host of ['claude-code', 'claude', 'codex', 'unknown', null]) {
    for (const source of ['startup', 'resume', 'fork', 'other']) {
      for (const environment of [{}, { TOOLKIT_GATE_ROLE: 'G1' }, { TOOLKIT_HOST_SESSION: 'parent' }]) {
        const id = `${host}-${source}-${Object.keys(environment)[0] || 'user'}`;
        const options = { registryOptions: ctx.options, host, environment: {} };
        const epochs = new gate.SessionEpochs(options);
        gate.startSession({ session_id: id, source, host: 'claude-code' }, { ...options, environment });
        const origin = epochs.origin(id);
        const resumed = epochs.resumed(id);
        const forked = epochs.forked(id);
        const restricted = epochs.resumeNeedsTypedMerge(id);
        for (const next of ['startup', 'startup', 'clear', 'compact', 'resume', 'startup']) {
          gate.startSession({ session_id: id, source: next, host: 'claude-code' }, options);
          assert.equal(epochs.origin(id), origin, `${id}: ${next}`);
          if (resumed || next === 'resume') assert.equal(epochs.resumed(id), true, id);
          assert.equal(epochs.forked(id), forked, id);
          if (restricted || (next === 'resume' && !['claude', 'claude-code'].includes(host))) assert.equal(epochs.resumeNeedsTypedMerge(id), true, id);
        }
      }
    }
  }
  const options = { registryOptions: ctx.options, host: 'claude-code', environment: {} };
  const epochs = new gate.SessionEpochs(options);
  for (const value of [undefined, 'unrecognised', true, 'corrupt']) {
    const id = `legacy-startup-${value}`;
    epochs.start(id, 'startup');
    const file = path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `s-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)}.json`);
    const mark = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete mark.origin;
    if (value !== undefined) mark.origin = value;
    fs.writeFileSync(file, value === 'corrupt' ? '{' : JSON.stringify(mark));
    epochs.start(id, 'startup');
    assert.equal(epochs.origin(id), 'unknown', id);
  }
});

test('session origin closure: only a qualifying startup survives same-id resume, never a fork or unknown origin', t => {
  const ctx = scratch(t);
  const rows = [
    { name: 'user', source: 'startup', origin: 'user-started', environment: {} },
    { name: 'matching-host', source: 'startup', origin: 'user-started', environment: { TOOLKIT_HOST_SESSION: 'matching-host' } },
    { name: 'other-host', source: 'startup', origin: 'automation', environment: { TOOLKIT_HOST_SESSION: 'parent' } },
    ...gate.LAUNCHER_MARKERS.map(name => ({ name, source: 'startup', origin: 'automation', environment: { [name]: 'launcher' } })),
    ...['resume', 'fork', 'clear', 'compact', 'other', null].map(source => ({ name: `unknown-${source}`, source, origin: 'unknown', environment: {} })),
  ];
  for (const row of rows) {
    const options = { host: 'claude-code', registryOptions: ctx.options, environment: row.environment };
    const epochs = new gate.SessionEpochs(options);
    const first = gate.startSession({ session_id: row.name, source: row.source }, options);
    assert.ok(first, row.name);
    assert.equal(epochs.origin(row.name), row.origin, row.name);
    assert.equal(epochs.resumed(row.name), ['resume', 'fork'].includes(row.source), row.name);
    for (const source of ['clear', 'compact']) assert.equal(epochs.start(row.name, source), first, row.name);
    const next = gate.startSession({ session_id: row.name, source: 'resume', prompt: 'user started this session' }, { ...options, environment: {} });
    assert.notEqual(next, first, row.name);
    assert.equal(epochs.resumed(row.name), true, row.name);
    assert.equal(epochs.origin(row.name), row.origin, row.name);
    assert.equal(epochs.forked(row.name), row.source === 'fork', row.name);
    assert.notEqual(epochs.start(row.name, 'resume'), next, 'every resume still rotates its epoch');
  }
  const epochs = new gate.SessionEpochs({ host: 'claude-code', registryOptions: ctx.options, environment: {} });
  epochs.start('user', 'fork');
  assert.equal(epochs.origin('user'), 'unknown', 'even a fork reporting the same id drops origin');
  epochs.start('user', 'resume');
  assert.equal(epochs.forked('user'), true, 'a fork cannot gain origin by resuming');
  for (const value of [undefined, 'unrecognised', true]) {
    const id = `legacy-${value}`;
    epochs.start(id, 'startup');
    const file = path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `s-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)}.json`);
    const mark = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete mark.origin;
    if (value !== undefined) mark.origin = value;
    fs.writeFileSync(file, JSON.stringify(mark));
    epochs.start(id, 'resume');
    assert.equal(epochs.origin(id), 'unknown', 'legacy and unknown fields never become user origin');
  }
  epochs.start('another-id', 'resume');
  assert.equal(epochs.origin('another-id'), 'unknown', 'origin belongs to one native session id only');
});

test('session-shell resume closure: presence revokes origin for the id across every later start', t => {
  const ctx = scratch(t);
  const rows = [
    { id: 'private-absent', environment: {}, revoked: false },
    { id: 'private-matching', environment: { [gate.HOST_SESSION_VARIABLE]: 'private-matching' }, revoked: true },
    { id: 'private-mismatching', environment: { [gate.HOST_SESSION_VARIABLE]: 'private-parent' }, revoked: true },
    { id: 'private-empty', environment: { [gate.HOST_SESSION_VARIABLE]: '' }, revoked: true },
  ];
  for (const row of rows) {
    const options = { host: 'claude-code', registryOptions: ctx.options, environment: {} };
    const epochs = new gate.SessionEpochs(options);
    const first = epochs.start(row.id, 'startup');
    const resumed = gate.startSession({ session_id: row.id, source: 'resume' }, { ...options, environment: row.environment });
    assert.notEqual(resumed, first, row.id);
    assert.equal(epochs.origin(row.id), row.revoked ? 'automation' : 'user-started', row.id);
    assert.equal(epochs.resumeHostSessionPresent(row.id), row.revoked, row.id);
    assert.equal(epochs.resumedFromSessionShell(row.id), row.revoked, row.id);
    const file = path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `s-${crypto.createHash('sha256').update(row.id).digest('hex').slice(0, 32)}.json`);
    const mark = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(mark.resumeHostSessionPresent, row.revoked);
    assert.equal(mark.resumedFromSessionShell, row.revoked);
    assert.doesNotMatch(JSON.stringify(mark), /private-|TOOLKIT_HOST_SESSION/, 'only boolean presence is persisted');
    for (const source of row.revoked ? ['resume', 'clear', 'compact', 'other', 'fork', 'startup', 'resume'] : ['resume', 'clear', 'compact', 'startup', 'resume']) {
      epochs.start(row.id, source);
      assert.equal(epochs.resumedFromSessionShell(row.id), row.revoked, `${row.id}: ${source}`);
      assert.equal(epochs.resumeHostSessionPresent(row.id), false, `${row.id}: ${source}`);
      assert.equal(epochs.origin(row.id), row.revoked ? 'automation' : 'user-started', `${row.id}: ${source}`);
    }
  }
});

const ticketOf = context => (/ ANSWER ([0-9a-f]{32})\n/.exec(context || '') || [])[1];
const asksIn = result => result.action === 'pass' && String(result.context).includes(QUESTION_LINE);

test('session marks: a later process that resumes the session is asked again and cannot answer, on both hosts, however it was started', (t) => {
  const ctx = scratch(t);
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_REMOTE;
  delete env.CLAUDE_ENV_FILE;
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256', gate.HOST_SESSION_VARIABLE]) delete env[marker];
  const homeRegistry = { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  const claude = (event, input) => JSON.parse(childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', event], { input: JSON.stringify(input), env, encoding: 'utf8' }));
  // Each run is its own process: the session-start hook first, then the one prompt (`claude -p` or
  // `codex exec`). With no source, the prompt is a further message in the same run.
  const hosts = {
    claude: (input, source) => {
      if (source) claude('SessionStart', { cwd: input.cwd, session_id: input.session_id, source });
      const out = claude('UserPromptSubmit', input);
      return out.decision === 'block' ? { held: true, reason: out.reason } : { held: false, context: out.hookSpecificOutput?.additionalContext };
    },
    codex: (input, source) => {
      if (source) gate.startSession({ session_id: input.session_id, source }, { registryOptions: homeRegistry });
      const run = childProcess.spawnSync(process.execPath, [path.join(scripts, 'toolkit-codex-helper-hook.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', ...input }), env, encoding: 'utf8' });
      return run.status === 2 ? { held: true, reason: run.stderr } : { held: false, context: run.stdout ? JSON.parse(run.stdout).hookSpecificOutput?.additionalContext : undefined };
    },
  };
  const stateAt = repo => governance.governanceState(repo, homeRegistry).state;
  const pending = (repo, sessionId) => gate.sessionLine(repo, { registryOptions: homeRegistry, sessionId });
  const asks = result => result.held === false && String(result.context).includes(QUESTION_LINE);
  for (const [host, send] of Object.entries(hosts)) {
    for (const [index, reply] of ['yes', 'no', 'later', 'toolkit governance enable', 'toolkit governance disable'].entries()) {
      const slug = `resumed-${host}-${index}`;
      const repo = gitRepo(ctx, slug, { remote: `https://github.com/example-owner/${slug}.git` });
      // `claude -p hello`, then `claude -p yes --resume <id>` (or `codex exec`, then `codex exec resume <id> yes`).
      assert.ok(asks(send({ cwd: repo, session_id: slug, prompt: 'hello' }, 'startup')), host);
      // Every resume is a new run, so a reply never meets a question from its own run: it is let
      // through with the question, with no ticket, and the full answer is not recorded.
      for (const round of ['first', 'second']) {
        const resumed = send({ cwd: repo, session_id: slug, prompt: reply }, 'resume');
        assert.ok(asks(resumed), `${host} ${reply} ${round}`);
        assert.equal(ticketOf(resumed.context), undefined, `${host} ${reply} ${round}`);
        assert.doesNotMatch(pending(repo, slug), /is pending/, `${host} ${reply} ${round}`);
      }
      assert.equal(stateAt(repo), 'UNDECIDED', `${host} ${reply}`);
    }
    // After the reply window, a resumed run is asked again, and the full answer from it does not count.
    const later = gitRepo(ctx, `later-${host}`, { remote: `https://github.com/example-owner/later-${host}.git` });
    assert.ok(asks(send({ cwd: later, session_id: `later-${host}`, prompt: 'hello' }, 'startup')));
    assert.ok(ticketOf(send({ cwd: later, session_id: `later-${host}`, prompt: 'later' }).context), host);
    assert.ok(asks(send({ cwd: later, session_id: `later-${host}`, prompt: 'toolkit governance enable' }, 'resume')), host);
    assert.doesNotMatch(pending(later, `later-${host}`), /is pending/, host);
    assert.equal(stateAt(later), 'UNDECIDED', host);
    // The user's own run still answers once it was shown the question.
    const own = gitRepo(ctx, `own-${host}`, { remote: `https://github.com/example-owner/own-${host}.git` });
    assert.ok(asks(send({ cwd: own, session_id: `own-${host}`, prompt: 'fix the bug' }, 'startup')));
    assert.match(send({ cwd: own, session_id: `own-${host}`, prompt: 'toolkit governance enable' }).context, /yes is pending/, host);
  }
});

test('session marks: no mark means no answer in chat; /clear and compaction keep the mark; the user\'s resumed session answers once asked again', (t) => {
  const ctx = scratch(t);
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const start = (sessionId, source) => gate.startSession({ session_id: sessionId, source }, { registryOptions: ctx.options });
  const pending = (repo, sessionId) => gate.sessionLine(repo, { registryOptions: ctx.options, sessionId });
  // A session the session-start hook never marked (it started before the update, or the hook did not
  // run), and a host that sends no session id: work passes with the way to decide, and no reply is read.
  const repo = gitRepo(ctx, 'unmarked');
  for (const sessionId of ['u1', undefined]) {
    for (const prompt of ['hello', 'yes', 'no', 'later']) {
      const told = raw().decide({ cwd: repo, prompt, sessionId });
      assert.equal(told.action, 'pass', prompt);
      assert.match(told.context, /This session started before Toolkit could note it, so the user decides in a new session or by running .*toolkit-governance\.cjs" enable or .*toolkit-governance\.cjs" disable in their own terminal/, prompt);
      assert.equal(ticketOf(told.context), undefined, prompt);
    }
    const refused = raw().decide({ cwd: repo, prompt: 'toolkit governance enable', sessionId });
    assert.equal(refused.action, 'block');
    assert.match(refused.reason, /started before Toolkit could note it[\s\S]*Start a new session and answer there \(in Codex, trust Toolkit's SessionStart hook in \/hooks first, or no session can be noted\), or run .*toolkit-governance\.cjs" enable or .*toolkit-governance\.cjs" disable in your own terminal/);
  }
  assert.equal(fs.existsSync(ctx.heldPath), false, 'no message is kept anywhere');
  assert.doesNotMatch(pending(repo, 'u1'), /is pending/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // /clear and compaction keep the run's mark, so the reply is still read and the answer still counts.
  for (const source of ['clear', 'compact']) {
    const kept = gitRepo(ctx, `kept-${source}`, { remote: `https://github.com/example-owner/kept-${source}.git` });
    start(`k-${source}`, 'startup');
    assert.ok(asksIn(raw().decide({ cwd: kept, prompt: 'hello', sessionId: `k-${source}` })));
    start(`k-${source}`, source);
    const reply = raw().decide({ cwd: kept, prompt: 'yes', sessionId: `k-${source}` });
    assert.ok(ticketOf(reply.context), `${source}: not asked again, and the reply comes with its ticket`);
    assert.equal(asksIn(reply), false, source);
    const answered = raw().decide({ cwd: kept, prompt: 'toolkit governance enable', sessionId: `k-${source}` });
    assert.equal(answered.action, 'pass', source);
    assert.match(answered.context, /yes is pending/, source);
  }
  // A /clear that comes with no mark yet starts one.
  const cleared = gitRepo(ctx, 'cleared', { remote: 'https://github.com/example-owner/cleared.git' });
  start('c1', 'clear');
  assert.ok(asksIn(raw().decide({ cwd: cleared, prompt: 'hello', sessionId: 'c1' })));
  assert.match(raw().decide({ cwd: cleared, prompt: 'toolkit governance disable', sessionId: 'c1' }).context, /no is pending/);
  // The user resumes their own session: asked again, and the next reply is read.
  const own = gitRepo(ctx, 'own', { remote: 'https://github.com/example-owner/own.git' });
  start('o1', 'startup');
  raw().decide({ cwd: own, prompt: 'fix the bug', sessionId: 'o1' });
  start('o1', 'resume');
  const again = raw().decide({ cwd: own, prompt: 'yes', sessionId: 'o1' });
  assert.ok(asksIn(again), 'the whole question is shown again');
  assert.equal(ticketOf(again.context), undefined, 'a yes from before this run\'s question is no reply');
  const reply = raw().decide({ cwd: own, prompt: 'yes', sessionId: 'o1' });
  assert.equal(raw().answerTicket(ticketOf(reply.context), 'yes').ok, true);
  assert.match(pending(own, 'o1'), /yes is pending/);
  // After the reply, the same run carries on; a resumed run is asked again and its full answer does not count.
  const later = gitRepo(ctx, 'later', { remote: 'https://github.com/example-owner/later.git' });
  start('l1', 'startup');
  raw().decide({ cwd: later, prompt: 'hello', sessionId: 'l1' });
  assert.equal(raw().answerTicket(ticketOf(raw().decide({ cwd: later, prompt: 'later', sessionId: 'l1' }).context), 'later').ok, true);
  assert.deepEqual(raw().decide({ cwd: later, prompt: 'carry on', sessionId: 'l1' }), { action: 'pass' });
  start('l1', 'resume');
  assert.match(pending(later, 'l1'), /not decided yet, so this repository counts as off/);
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: later, session_id: 'l1', tool_input: { command: 'ls' } }), null);
  assert.ok(asksIn(raw().decide({ cwd: later, prompt: 'toolkit governance enable', sessionId: 'l1' })));
  assert.doesNotMatch(pending(later, 'l1'), /is pending/);
  assert.equal(stateOf(ctx, later).state, 'UNDECIDED');
  // Only the newest few hundred session marks are kept.
  const folder = path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER);
  for (let index = 0; index < 260; index += 1) start(`many-${index}`, 'startup');
  assert.ok(fs.readdirSync(folder).length <= 256);
});

test('an unrelated chat cannot invalidate this run\'s accepted answer', t => {
  for (const route of ['phrase', 'ticket']) {
    const f = answerFixture(t); f.ask();
    f.start('other');
    const reply = f.say(route === 'phrase' ? 'toolkit governance disable' : 'no');
    assert.equal(reply.action, 'pass');
    if (route === 'ticket') assert.equal(f.prompts().answerTicket(ticketOf(reply.context), 'no').ok, true);
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
    assert.match(gate.sessionLine(f.cwd, { ...f.options, sessionId: 'owner' }), /no is pending/, route);
  }
});

test('a mark that cannot be replaced fails safe: the resumed or continued run cannot answer for the user', (t) => {
  const ctx = scratch(t);
  const raw = () => new gate.PromptHold({ registryOptions: ctx.options, environment: {} });
  const start = (sessionId, source, cwd) => gate.startSession({ session_id: sessionId, source, cwd }, { registryOptions: ctx.options });
  const pending = (repo, sessionId) => gate.sessionLine(repo, { registryOptions: ctx.options, sessionId });
  const markFile = (kind, key) => path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `${kind}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  // A folder in the mark's place cannot be renamed over, as a locked or read-only file on Windows cannot.
  const block = file => { fs.rmSync(file, { force: true }); fs.mkdirSync(path.join(file, 'locked'), { recursive: true }); };
  // The session's own mark: the resumed run is left with none, so no reply of its is read and its
  // full answer is refused.
  const resumed = gitRepo(ctx, 'resumed');
  start('user', 'startup', resumed);
  assert.ok(asksIn(raw().decide({ cwd: resumed, prompt: 'hello', sessionId: 'user' })));
  block(markFile('s', 'user'));
  assert.equal(start('user', 'resume', resumed), null);
  assert.equal(fs.existsSync(markFile('s', 'user')), false, 'the old session mark is gone');
  const unmarked = raw().decide({ cwd: resumed, prompt: 'yes', sessionId: 'user' });
  assert.match(unmarked.context, /This session started before Toolkit could note it/);
  assert.equal(ticketOf(unmarked.context), undefined);
  assert.equal(raw().decide({ cwd: resumed, prompt: 'toolkit governance enable', sessionId: 'user' }).action, 'block');
  assert.doesNotMatch(pending(resumed, 'user'), /is pending/);
  // The repository's mark, with a continued run reporting a new id: the mark is removed, so the old
  // session's reply, short or full, is not read and the question goes out again.
  for (const [index, reply] of ['yes', 'toolkit governance enable'].entries()) {
    const continued = gitRepo(ctx, `continued-${index}`, { remote: `https://github.com/example-owner/continued-${index}.git` });
    start(`first-${index}`, 'startup', continued);
    assert.ok(asksIn(raw().decide({ cwd: continued, prompt: 'hello', sessionId: `first-${index}` })));
    block(markFile('r', stateOf(ctx, continued).repository_id));
    assert.match(String(start(`new-id-${index}`, 'resume', continued)), /^[0-9a-f]{32}$/);
    const moved = raw().decide({ cwd: continued, prompt: reply, sessionId: `first-${index}` });
    assert.ok(asksIn(moved), reply);
    assert.match(moved.context, /another session started in this repository since Toolkit asked, so nothing was recorded and Toolkit asks again/, reply);
    assert.equal(ticketOf(moved.context), undefined, reply);
    assert.doesNotMatch(pending(continued, `first-${index}`), /is pending/, reply);
    // The user's next reply counts.
    const next = raw().decide({ cwd: continued, prompt: reply, sessionId: `first-${index}` });
    assert.equal(next.action, 'pass');
    if (index === 0) assert.equal(raw().answerTicket(ticketOf(next.context), 'yes').ok, true);
    assert.match(pending(continued, `first-${index}`), /yes is pending/, reply);
    assert.equal(stateOf(ctx, continued).state, 'UNDECIDED');
  }
});

test('a failed mark write retains restrictions through later startup replay', t => {
  const ctx = scratch(t);
  const options = { registryOptions: ctx.options, environment: {}, host: 'claude-code' };
  const epochs = new gate.SessionEpochs(options);
  const { renameSync } = fs;
  let blocked = null;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === blocked) throw Object.assign(new Error('fixture write failure'), { code: 'EPERM' });
    return renameSync(from, to);
  });
  for (const restriction of ['session-shell', 'codex', 'fork', 'unknown', 'automation']) {
    epochs.start(restriction, 'startup');
    if (restriction === 'session-shell') new gate.SessionEpochs({ ...options, environment: { TOOLKIT_HOST_SESSION: restriction } }).start(restriction, 'resume');
    if (restriction === 'codex') new gate.SessionEpochs({ ...options, host: 'codex' }).start(restriction, 'resume');
    if (restriction === 'fork') epochs.start(restriction, 'fork');
    if (restriction === 'unknown') epochs.start(restriction, 'other');
    if (restriction === 'automation') new gate.SessionEpochs({ ...options, environment: { TOOLKIT_GATE_ROLE: 'G1' } }).start(restriction, 'startup');
    const file = path.join(path.dirname(ctx.registryPath), gate.SESSIONS_FOLDER, `s-${crypto.createHash('sha256').update(restriction).digest('hex').slice(0, 32)}.json`);
    const before = fs.readFileSync(file, 'utf8');
    blocked = file;
    assert.equal(epochs.start(restriction, 'startup'), null, restriction);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'failed replacement must not delete the restricted mark');
    blocked = null;
    epochs.start(restriction, 'startup');
    if (restriction === 'session-shell') assert.equal(epochs.resumedFromSessionShell(restriction), true);
    if (restriction === 'codex') assert.equal(epochs.resumeNeedsTypedMerge(restriction), true);
    if (restriction === 'fork') assert.equal(epochs.forked(restriction), true);
    if (restriction === 'unknown') assert.equal(epochs.origin(restriction), 'unknown');
    if (restriction === 'automation') assert.equal(epochs.origin(restriction), 'automation');
  }
});
