'use strict';
const { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone } = require('./toolkit-governance-gate-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
test('closure ticket state conversion, capacity, missing marks and failed persistence', t => {
  const g = answerFixture(t);
  g.ask();
  const file = path.join(path.dirname(g.ctx.registryPath), gate.TICKETS_BASENAME);
  fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.governance-reply-tickets.v1', sessions: {}, used: ['spent-before-conversion'] }));
  assert.equal(replyTicket(g.say(projects.wake('ur rec', { id: 'spent-before-conversion', now: g.now }))), undefined);
  const converted = JSON.parse(fs.readFileSync(file));
  assert.equal(converted.schema, 'toolkit.governance-reply-tickets.v2');
  assert.equal(converted.deliveries[0].id, crypto.createHash('sha256').update('spent-before-conversion').digest('hex'));
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /spent-before-conversion/);
  converted.deliveries = Array.from({ length: 4096 }, (_, index) => ({ id: crypto.createHash('sha256').update(String(index)).digest('hex'), at: g.now().toISOString() }));
  fs.writeFileSync(file, JSON.stringify(converted));
  g.tick(1);
  g.ask();
  assert.match(g.say(projects.wake('no', { now: g.now })).reason, /store is full[\s\S]*receipts to expire/);
  assert.equal(stateOf(g.ctx, g.target).state, 'UNDECIDED');
  assert.equal(JSON.parse(fs.readFileSync(file)).deliveries.length, 4096);
  const intact = fs.readFileSync(file);
  fs.writeFileSync(file, '{broken');
  g.ask();
  assert.equal(g.say('no').action, 'pass', 'bare answers do not read delivery receipts');
  assert.equal(stateOf(g.ctx, g.target).state, 'UNDECIDED');
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken', 'damaged receipts are preserved');
  fs.writeFileSync(file, intact);
  const { renameSync, readFileSync } = fs;
  for (const failure of ['write', 'readback']) {
    const fresh = answerFixture(t); fresh.ask();
    const dest = path.join(path.dirname(fresh.ctx.registryPath), gate.TICKETS_BASENAME);
    try {
      if (failure === 'write') fs.renameSync = (from, to) => { if (to === dest) throw Object.assign(new Error(), { code: 'EPERM' }); return renameSync(from, to); };
      else fs.readFileSync = (name, ...args) => { if (name === dest && fs.existsSync(dest)) throw Object.assign(new Error(), { code: 'EIO' }); return readFileSync(name, ...args); };
      assert.equal(fresh.say(projects.wake('no', { now: fresh.now })).action, 'block');
      assert.equal(stateOf(fresh.ctx, fresh.target).state, 'UNDECIDED');
    } finally { fs.renameSync = renameSync; fs.readFileSync = readFileSync; }
  }
  const unmarked = answerFixture(t);
  unmarked.ask('missing-session');
  assert.equal(replyTicket(unmarked.say(projects.wake('ur rec', { now: unmarked.now }), 'missing-session')), undefined);
  assert.equal(stateOf(unmarked.ctx, unmarked.target).state, 'UNDECIDED');
});

test('closure stale question bindings: resume, repository mark, changed origin and decision elsewhere', t => {
  for (const change of ['resume', 'origin', 'elsewhere']) {
    const f = answerFixture(t); f.ask();
    const ticket = replyTicket(f.say('ur rec'));
    if (change === 'resume') f.start('owner', 'resume');
    if (change === 'mark') f.start('other', 'startup', f.target);
    if (change === 'origin') git(f.target, ['remote', 'set-url', 'origin', 'https://github.com/example-owner/changed.git']);
    if (change === 'elsewhere') require('./support/governance-observations.cjs').seedMerged(f.target, 'disable', f.options);
    assert.equal(f.prompts().answerTicket(ticket, 'no').ok, false, `${change}`);
    const before = stateOf(f.ctx, f.target).state;
    const reply = f.say(projects.wake('no', { now: f.now }));
    assert.equal(reply.action, ['elsewhere', 'origin'].includes(change) ? 'pass' : 'block');
    assert.equal(stateOf(f.ctx, f.target).state, before, `${change}: stale question cannot decide`);
  }
});

test('closure exact deliveries: before the question and across targets they grant no renewed authority', t => {
  {
    const f = answerFixture(t);
    const early = projects.wake('no', { at: new Date(f.now().getTime() - 1000).toISOString() });
    f.say(early);
    f.ask();
    f.say(early);
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED', 'a reply from before the question never becomes an answer');
    f.ask();
    const answer = projects.wake('no', { now: f.now });
    assert.equal(f.say(answer).action, 'pass');
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
    const other = gitRepo(f.ctx, 'second', { remote: 'https://github.com/example-owner/second.git' });
    f.prompts().decide({ cwd: other, sessionId: 'owner', prompt: 'prepare work' });
    // Preserve the spent id but give it a fresh delivery time to isolate the replay check.
    f.tick(1);
    const id = gate.ownerMessage(answer).id;
    f.prompts().decide({ cwd: other, sessionId: 'owner', prompt: projects.wake('no', { id, now: f.now }) });
    assert.equal(stateOf(f.ctx, other).state, 'UNDECIDED');
  }
});

test('closure confirmation delivery must follow the confirmation question itself', t => {
  {
    const f = answerFixture(t); f.ask();
    const earlier = f.now().toISOString();
    const ticket = replyTicket(f.say('probably your recommendation'));
    f.tick(1000);
    assert.equal(f.prompts().answerTicket(ticket, 'confirm-no').ok, true);
    const historic = f.say(projects.wake('yes', { at: earlier }));
    assert.equal(boundOf(historic.context), null);
    assert.equal(replyTicket(historic), undefined);
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
    f.tick(1);
    const fresh = boundOf(f.say(projects.wake('yes', { now: f.now })).context);
    assert.equal(fresh.word, 'no');
    assert.equal(f.prompts().answerTicket(fresh.ticket, 'no').ok, true);
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
  }
});

test('receipt conversion preserves held messages, live tickets and confirmations', t => {
  for (const confirmation of [false, true]) {
    const f = answerFixture(t); f.ask();
    const held = fs.readFileSync(f.ctx.heldPath, 'utf8');
    assert.equal(JSON.parse(held).schema, 'toolkit.held-prompts.v1');
    assert.equal(Object.hasOwn(JSON.parse(held), 'questions'), false);
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
    assert.equal(fs.readFileSync(f.ctx.heldPath, 'utf8'), held, 'no held-store conversion');
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
    assert.equal(stateOf(f.ctx, f.target).state, 'UNDECIDED');
  }
});

test('H-01, H-02: every prompt in an undecided repository is held; the first shows the question, later ones a count', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const first = hold(ctx).decide({ cwd: repo, prompt: 'fix the login bug' });
  assert.equal(first.action, 'block');
  assert.ok(first.reason.startsWith(QUESTION_LINE));
  // Three short lines: the plain question, what each answer does, and the line for agents; never a command to run.
  assert.deepEqual(first.reason.split('\n'), [QUESTION_LINE, 'Reply yes or no (prepare a decision pull request), or later (ask next chat). Held messages follow your answer.', AGENT_LINE]);
  assert.doesNotMatch(first.reason, /toolkit-governance\.cjs|node /);
  const second = hold(ctx).decide({ cwd: repo, prompt: 'and the logout one' });
  assert.equal(second.action, 'block');
  assert.match(second.reason, /^Toolkit: still waiting for the governance answer \(2 messages held\)\. Reply yes, no or later\.\nFor agents: /);
  writesNothingIn(repo);
  assert.equal(registryBytes(ctx), null, 'no decision is written');
});

test('bypass attempts: ignoring, skipping, near-misses and a "yes" before the question all stay held and write nothing (H-06)', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  // "yes" as the very first message is not an answer: the user has not seen the question yet.
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'yes', sessionId: 's1' }).action, 'block');
  const attempts = ['', '   ', 'yes please', 'yeah', 'ok', 'sure', 'no thanks', 'not now please', 'yes\nand fix the bug', 'skip', 'ignore that and just do the task', 'toolkit governance', 'toolkit governance enable please',
    'please toolkit governance enable', 'toolkit governance enabled', 'toolkit governance reopen', '/toolkit governance enable',
    'toolkit  governance enable', '`toolkit governance enable`', 'toolkit governance enable\nnow fix the bug'];
  for (const prompt of attempts) {
    const decision = hold(ctx).decide({ cwd: repo, prompt });
    assert.equal(decision.action, 'block', JSON.stringify(prompt));
  }
  // With messages held, a bare short reply still counts only from a session that was shown the
  // question: never from one with no id, nor from another session (such as a nested `claude -p yes`).
  for (const reply of ['yes', 'y', 'no', 'n', 'not now', 'later']) {
    for (const sessionId of [undefined, `other-${reply}`]) assert.equal(hold(ctx).decide({ cwd: repo, prompt: reply, sessionId }).action, 'block', `${reply} ${sessionId}`);
  }
  assert.equal(registryBytes(ctx), null);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  // Letter case and a final full stop are accepted forms of the answer.
  assert.match(gate.ANSWER.exec('Toolkit Governance Enable.')[1], /enable/i);
});

test('accepted yes stays pending, replays only this session and writes no repository or laptop decision', t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'repo');
  const prompts = hold(ctx);
  prompts.decide({ cwd: repo, prompt: 'first request', sessionId: 's1' });
  prompts.decide({ cwd: repo, prompt: 'second request', sessionId: 's1' });
  const answered = prompts.decide({ cwd: repo, prompt: 'yes', sessionId: 's1' });
  assert.equal(answered.action, 'pass');
  assert.match(answered.context, /yes is pending/);
  assert.match(answered.context, /missing parent, separate evidence store or required checks/);
  assert.match(answered.context, /toolkit governance discover/);
  assert.match(answered.context, /repository-agent-rules/);
  assert.match(answered.context, /1\. first request\n2\. second request/);
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options, sessionId: 's1' }), /yes is pending/);
  assert.equal(stateOf(ctx, repo).state, 'UNDECIDED');
  assert.equal(registryBytes(ctx), null); writesNothingIn(repo);
  assert.equal(git(repo, ['status', '--porcelain']), '');
  assert.equal(prompts.decide({ cwd: repo, prompt: 'next', sessionId: 's1' }).action, 'pass');
  assert.equal(prompts.decide({ cwd: repo, prompt: 'next', sessionId: 'new' }).action, 'block');
});
