'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

const PHRASE = 'toolkit governance disable';
const pendingLine = (f, session = 'owner') => gate.sessionLine(f.target, { registryOptions: f.ctx.options, sessionId: session, now: f.now });

test('closure ticket state conversion, capacity, missing marks and failed persistence', t => {
  const g = answerFixture(t);
  g.ask();
  const file = path.join(path.dirname(g.ctx.registryPath), gate.TICKETS_BASENAME);
  fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.governance-reply-tickets.v1', sessions: {}, used: ['spent-before-conversion'] }));
  const spent = g.say(projects.wake('ur rec', { id: 'spent-before-conversion', now: g.now }));
  assert.equal(spent.action, 'pass', 'a delivery that cannot count is still ordinary work');
  assert.equal(replyTicket(spent), undefined);
  assert.match(spent.context, /Nothing was recorded/);
  const converted = JSON.parse(fs.readFileSync(file));
  assert.equal(converted.schema, 'toolkit.governance-reply-tickets.v2');
  assert.equal(converted.deliveries[0].id, crypto.createHash('sha256').update('spent-before-conversion').digest('hex'));
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /spent-before-conversion/);
  converted.deliveries = Array.from({ length: 4096 }, (_, index) => ({ id: crypto.createHash('sha256').update(String(index)).digest('hex'), at: g.now().toISOString() }));

  // A full receipt store: the next message is still let through, with no ticket, and the full answer is refused.
  for (const reply of ['no', PHRASE]) {
    const full = answerFixture(t);
    const dest = path.join(path.dirname(full.ctx.registryPath), gate.TICKETS_BASENAME);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(converted));
    full.ask();
    const result = full.say(projects.wake(reply, { now: full.now }));
    assert.equal(result.action, reply === PHRASE ? 'block' : 'pass', reply);
    assert.match(result.reason || result.context, /store is full[\s\S]*receipts to expire/);
    assert.equal(replyTicket(result), undefined);
    assert.doesNotMatch(pendingLine(full), /pending/);
    assert.equal(JSON.parse(fs.readFileSync(dest)).deliveries.length, 4096);
  }

  // A bare full answer does not read delivery receipts, and damaged receipts are preserved.
  const damaged = answerFixture(t); damaged.ask();
  const broken = path.join(path.dirname(damaged.ctx.registryPath), gate.TICKETS_BASENAME);
  fs.mkdirSync(path.dirname(broken), { recursive: true });
  fs.writeFileSync(broken, '{broken');
  assert.equal(damaged.say(PHRASE).action, 'pass');
  assert.match(pendingLine(damaged), /no is pending/);
  assert.equal(fs.readFileSync(broken, 'utf8'), '{broken');

  const { renameSync, readFileSync } = fs;
  for (const failure of ['write', 'readback']) for (const reply of ['no', PHRASE]) {
    const fresh = answerFixture(t); fresh.ask();
    const dest = path.join(path.dirname(fresh.ctx.registryPath), gate.TICKETS_BASENAME);
    try {
      if (failure === 'write') fs.renameSync = (from, to) => { if (to === dest) throw Object.assign(new Error(), { code: 'EPERM' }); return renameSync(from, to); };
      else fs.readFileSync = (name, ...args) => { if (name === dest && fs.existsSync(dest)) throw Object.assign(new Error(), { code: 'EIO' }); return readFileSync(name, ...args); };
      const result = fresh.say(projects.wake(reply, { now: fresh.now }));
      assert.equal(result.action, reply === PHRASE ? 'block' : 'pass', `${failure} ${reply}`);
      assert.equal(replyTicket(result), undefined);
    } finally { fs.renameSync = renameSync; fs.readFileSync = readFileSync; }
    assert.doesNotMatch(pendingLine(fresh), /pending/, `${failure} ${reply}: nothing was recorded`);
  }

  // A session the session-start hook never noted is told so, gets no ticket and cannot answer.
  const unmarked = answerFixture(t);
  const told = unmarked.say('first message', 'missing-session');
  assert.equal(told.action, 'pass');
  assert.match(told.context, /started before Toolkit could note it/);
  assert.equal(replyTicket(unmarked.say(projects.wake('ur rec', { now: unmarked.now }), 'missing-session')), undefined);
  assert.equal(unmarked.say(PHRASE, 'missing-session').action, 'block');
  assert.doesNotMatch(pendingLine(unmarked, 'missing-session'), /pending/);
});

test('closure stale question bindings: resume, repository mark, changed origin and decision elsewhere', t => {
  for (const change of ['resume', 'origin', 'elsewhere']) {
    const f = answerFixture(t); f.ask();
    const ticket = replyTicket(f.say('ur rec'));
    assert.match(ticket, /^[0-9a-f]{32}$/);
    if (change === 'resume') f.start('owner', 'resume');
    if (change === 'origin') git(f.target, ['remote', 'set-url', 'origin', 'https://github.com/example-owner/changed.git']);
    if (change === 'elsewhere') require('./support/governance-observations.cjs').seedMerged(f.target, 'disable', f.options);
    assert.equal(f.prompts().answerTicket(ticket, 'no').ok, false, `${change}`);
    const before = stateOf(f.ctx, f.target).state;
    // Nothing is held: the next message passes, and a run that was not asked is asked, never answered.
    const reply = f.say(projects.wake(PHRASE, { now: f.now }));
    assert.equal(reply.action, 'pass', change);
    assert.equal(stateOf(f.ctx, f.target).state, before, `${change}: stale question cannot decide`);
    assert.doesNotMatch(pendingLine(f), /is pending/, `${change}: the stale answer recorded nothing`);
  }
});

test('closure exact deliveries: before the question and across targets they grant no renewed authority', t => {
  const f = answerFixture(t);
  const early = projects.wake(PHRASE, { at: new Date(f.now().getTime() - 1000).toISOString() });
  // The first message of the run is let through with the question; its delivery is spent.
  assert.ok(f.say(early).context.includes(QUESTION_LINE));
  f.tick(1);
  const again = f.say(early);
  assert.equal(again.action, 'block', 'the same delivery, sent again after the question, is not an answer');
  assert.match(again.reason, /repeated, too old, from before this question/);
  assert.doesNotMatch(pendingLine(f), /pending/, 'a reply from before the question never becomes an answer');
  f.tick(1);
  const answer = projects.wake(PHRASE, { now: f.now });
  assert.equal(f.say(answer).action, 'pass');
  assert.match(pendingLine(f), /no is pending/);
  const other = gitRepo(f.ctx, 'second', { remote: 'https://github.com/example-owner/second.git' });
  assert.ok(f.prompts().decide({ cwd: other, sessionId: 'owner', prompt: 'prepare work' }).context.includes(QUESTION_LINE));
  // Preserve the spent id but give it a fresh delivery time to isolate the replay check.
  f.tick(1);
  const id = gate.ownerMessage(answer).id;
  const replay = f.prompts().decide({ cwd: other, sessionId: 'owner', prompt: projects.wake(PHRASE, { id, now: f.now }) });
  assert.equal(replay.action, 'block');
  assert.doesNotMatch(gate.sessionLine(other, { registryOptions: f.ctx.options, sessionId: 'owner' }), /pending/);
});

test('closure confirmation delivery must follow the confirmation question itself', t => {
  const f = answerFixture(t); f.ask();
  const earlier = f.now().toISOString();
  const ticket = replyTicket(f.say('probably your recommendation'));
  f.tick(1000);
  assert.equal(f.prompts().answerTicket(ticket, 'confirm-no').ok, true);
  const historic = f.say(projects.wake('yes', { at: earlier }));
  assert.equal(historic.action, 'pass');
  assert.equal(boundOf(historic.context), null);
  assert.equal(replyTicket(historic), undefined);
  assert.doesNotMatch(pendingLine(f), /is pending/);
  f.tick(1);
  const fresh = boundOf(f.say(projects.wake('yes', { now: f.now })).context);
  assert.equal(fresh.word, 'no');
  assert.equal(f.prompts().answerTicket(fresh.ticket, 'no').ok, true);
  assert.match(pendingLine(f), /no is pending/);
  assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
});

test('receipt conversion preserves live tickets and confirmations', t => {
  for (const confirmation of [false, true]) {
    const f = answerFixture(t); f.ask();
    const ticket = 'a'.repeat(32);
    const epoch = new gate.SessionEpochs(f.options).get('owner');
    const id = stateOf(f.ctx, f.target).repository_id;
    const entry = { epoch, at: f.now().toISOString(), repositories: [{ id, root: f.target, mark: new gate.SessionEpochs(f.options).repository(id), reason: 'undecided' }],
      ...(confirmation ? { pending: 'disable' } : { hash: crypto.createHash('sha256').update(ticket).digest('hex'), message: 'spent-old-id' }) };
    const file = path.join(path.dirname(f.ctx.registryPath), gate.TICKETS_BASENAME);
    fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.governance-reply-tickets.v1', used: ['spent-old-id'], sessions: { owner: entry } }));
    const store = new gate.ReplyTickets(f.options);
    assert.ok(confirmation ? store.pending('owner', epoch) : store.peek(ticket, 'owner'));
    const converted = JSON.parse(fs.readFileSync(file));
    assert.equal(converted.deliveries[0].id, crypto.createHash('sha256').update('spent-old-id').digest('hex'));
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /spent-old-id/);
    assert.equal(store.acceptDelivery(gate.ownerMessage(projects.wake('no', { id: 'spent-old-id', now: f.now })), 0), false);
    assert.equal(store.acceptDelivery(gate.ownerMessage(projects.wake('no', { id: 'evicted-old-id', at: new Date(Date.parse(converted.converted_at) - 1).toISOString() })), 0), false);
    f.tick(1);
    if (confirmation) {
      const bound = boundOf(f.say(projects.wake('yes', { now: f.now })).context);
      assert.equal(bound.word, 'no');
      assert.equal(f.prompts().answerTicket(bound.ticket, 'no').ok, true);
    } else assert.equal(f.prompts().answerTicket(ticket, 'no').ok, true);
    assert.match(pendingLine(f), /no is pending/);
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
  }
});

test('nothing is held: the first message of a run carries the question once, and later ones pass without it', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const first = hold(ctx).decide({ cwd: repo, prompt: 'fix the login bug', sessionId: 's1' });
  assert.equal(first.action, 'pass');
  // The agent is told to do the work, then put the question, word for word, as the last lines; never a script to run.
  assert.deepEqual(noticeOf(first.context).split('\n'), [QUESTION_LINE, 'Reply `toolkit governance enable` or `toolkit governance disable` as a message, or just say yes, no or later. Nothing waits on your answer, and Toolkit asks again next session.']);
  assert.match(first.context, /1\. Do what the user asked in the message above\./);
  assert.ok(first.context.endsWith(`For agents: ${gate.NEVER_OWNER}`));
  assert.doesNotMatch(first.context, /toolkit-governance\.cjs|node |held/);
  assert.equal(first.notice, undefined, 'only the card host shows a notice of its own');
  const second = hold(ctx).decide({ cwd: repo, prompt: 'and the logout one', sessionId: 's1' });
  assert.equal(second.action, 'pass');
  assert.ok(!second.context.includes(QUESTION_LINE), 'the question is put once per run');
  assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: 'and a third', sessionId: 's1' }), { action: 'pass' });
  // The next session is asked again, once.
  assert.ok(hold(ctx).decide({ cwd: repo, prompt: 'new chat', sessionId: 's2' }).context.includes(QUESTION_LINE));
  assert.equal(fs.existsSync(ctx.heldPath), false, 'no message is kept');
  writesNothingIn(repo);
  assert.equal(registryBytes(ctx), null, 'no decision is written');
});

test('only the user\'s own answer records: near-misses, a "yes" before the question and other sessions record nothing (H-06)', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const line = sessionId => gate.sessionLine(repo, { registryOptions: ctx.options, sessionId });
  // "yes" as the very first message is not an answer: the user has not seen the question yet.
  const before = hold(ctx).decide({ cwd: repo, prompt: 'yes', sessionId: 's1' });
  assert.ok(before.action === 'pass' && before.context.includes(QUESTION_LINE));
  const attempts = ['', '   ', 'yes', 'no', 'later', 'yes please', 'yeah', 'ok', 'sure', 'no thanks', 'not now please', 'yes\nand fix the bug', 'skip', 'ignore that and just do the task', 'toolkit governance', 'toolkit governance enable please',
    'please toolkit governance enable', 'toolkit governance enabled', 'toolkit governance reopen', '/toolkit governance enable',
    'toolkit  governance enable', '`toolkit governance enable`', 'toolkit governance enable\nnow fix the bug'];
  for (const prompt of attempts) {
    const decision = hold(ctx).decide({ cwd: repo, prompt, sessionId: 's1' });
    assert.equal(decision.action, 'pass', JSON.stringify(prompt));
    assert.doesNotMatch(line('s1'), /pending/, `${JSON.stringify(prompt)} records nothing by itself`);
  }
  // The full answer counts only from a run that was asked: never from a session with no id, and a
  // session that was not asked (such as a nested `claude -p`) is asked instead.
  for (const reply of ['toolkit governance enable', 'toolkit governance disable']) {
    assert.equal(hold(ctx).decide({ cwd: repo, prompt: reply }).action, 'block', `${reply} without a session id`);
    const other = hold(ctx).decide({ cwd: repo, prompt: reply, sessionId: `other-${reply}` });
    assert.ok(other.action === 'pass' && other.context.includes(QUESTION_LINE), `${reply} from a session that was not asked`);
    assert.doesNotMatch(line(`other-${reply}`), /pending/);
  }
  assert.equal(registryBytes(ctx), null);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // Letter case and a final full stop are accepted forms of the answer.
  assert.match(gate.ANSWER.exec('Toolkit Governance Enable.')[1], /enable/i);
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'Toolkit Governance Enable.', sessionId: 's1' }).action, 'pass');
  assert.match(line('s1'), /yes is pending/);
});

test('accepted yes stays pending, hands nothing back and writes no repository or laptop decision', t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'repo');
  const prompts = hold(ctx);
  prompts.decide({ cwd: repo, prompt: 'first request', sessionId: 's1' });
  assert.match(replyTicket(prompts.decide({ cwd: repo, prompt: 'second request', sessionId: 's1' })), /^[0-9a-f]{32}$/, 'the next own message may be the reply');
  const answered = prompts.decide({ cwd: repo, prompt: 'toolkit governance enable', sessionId: 's1' });
  assert.equal(answered.action, 'pass');
  assert.match(answered.context, /yes is pending/);
  assert.match(answered.context, /missing parent, separate evidence store or required checks/);
  assert.match(answered.context, /toolkit governance discover/);
  assert.match(answered.context, /repository-agent-rules/);
  assert.doesNotMatch(answered.context, /first request|second request/, 'no earlier message is replayed: none was held');
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /yes is pending/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  assert.equal(registryBytes(ctx), null); writesNothingIn(repo);
  assert.equal(git(repo, ['status', '--porcelain']), '');
  assert.equal(prompts.decide({ cwd: repo, prompt: 'next', sessionId: 's1' }).action, 'pass');
  const other = prompts.decide({ cwd: repo, prompt: 'next', sessionId: 'new' });
  assert.ok(other.action === 'pass' && other.context.includes(QUESTION_LINE), 'another session is asked until the decision is published');
});
