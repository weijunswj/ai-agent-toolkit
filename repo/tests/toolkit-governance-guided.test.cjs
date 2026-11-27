'use strict';

// The guided governance setup (INT-TK421-1386, with INT-TK421-1389 and 1390): `toolkit governance` in a
// repository that is not governed asks three questions, each explained first, in the global rules'
// question shape, in one message. No card is forced: how they show is the app's choice, and the owner's
// reply, typed or tapped, comes back with a one-use ticket. The answer sets everything up at once, and
// the agent carries the setup pull request through the owner's merge approval to the summary.
// Red on the parent: `setup` printed the old bank table with codes such as 1.1=B, a turn-on wrote
// merge trains off and no min_toolkit, and the undecided question forced Toolkit's own card.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const guided = require(path.join(scripts, 'toolkit-governance-guided.cjs'));
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const { BankTickets } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const { readToolkitVersion } = require(path.join(scripts, 'toolkit-version.cjs'));

const OWNER = 'toolkit-test-fixture';
const SLUG = `${OWNER}/fresh`;
const STORE = `${OWNER}/TRANSPORT-fresh`;
const SESSION = 'session-guided-1';
const UNDECIDED = Object.freeze({ state: 'UNDECIDED', repository: SLUG });
const STORE_INFO = Object.freeze({ repository: STORE, path: `state/${SLUG}/`, exists: false });

test('the three questions come in one message, each part explained first, then the questions last in the global question shape', () => {
  const questions = guided.guidedQuestions({ state: UNDECIDED, store: STORE_INFO });
  const text = guided.renderGuided(questions, { state: UNDECIDED });
  const lines = text.split('\n');
  assert.equal(lines[0], `**Toolkit governance for ${SLUG}**`);
  // The three explanations, as labelled bullets, before any question.
  const explained = lines.filter(line => line.startsWith('- **'));
  assert.deepEqual(explained.map(line => /^- \*\*([^:]+):\*\*/.exec(line)[1]), ['GitHub governance', 'Evidence store', 'Task auto-merge with merge train']);
  assert.match(explained[1], new RegExp(`Suggested: ${STORE}, path \`state/${SLUG}/\`\\. Toolkit creates it if it does not exist yet\\.`));
  const firstQuestion = lines.findIndex(line => /^\*\*1\. Question: /.test(line));
  assert.ok(firstQuestion > lines.indexOf(explained.at(-1)), 'the questions come after every explanation');
  // Questions last: numbered and bold, choices lettered and nested under each, the recommended one marked.
  assert.deepEqual(lines.slice(firstQuestion, lines.length - 1).filter(Boolean), [
    `**1. Question: Turn on GitHub governance for ${SLUG}?**`,
    '   - **A. Yes (my pick):** Toolkit sets up the store, parent issue and checks after your other answers.',
    '   - **B. Later:** Nothing changes; Toolkit asks again next session.',
    '   - **C. No:** Toolkit prepares a pull request that records governance off.',
    `**2. Question: Keep records in ${STORE}?**`,
    '   - **A. Use it (my pick):** Private repository; Toolkit creates it.',
    '   - **B. Another repository:** Name a private repository you own as owner/name.',
    '   - **C. No store:** Governance stays off.',
    '**3. Question: Turn on task auto-merge with merge train?**',
    '   - **A. Yes (my pick):** Reviewed, green task pull requests land on their own.',
    '   - **B. No:** Every task pull request waits for your merge approval.',
  ]);
  assert.equal(lines.at(-1), 'Answer in your own words, or with the letters, such as 1A 2A 3A.');
  assert.doesNotMatch(text, /AskUserQuestion|question card|background wait|1\.1=|Bank reference|```/i, 'no card, no wait step and no bank codes');
});

test('after the owner\'s yes to the session-start question, governance is left out; where governance is off, it asks to turn it back on', () => {
  const agreed = guided.guidedQuestions({ state: UNDECIDED, store: STORE_INFO, agreed: true });
  assert.deepEqual(agreed.map(question => [question.number, question.key]), [[1, 'store'], [2, 'auto-merge']]);
  const text = guided.renderGuided(agreed, { state: UNDECIDED, agreed: true });
  assert.match(text, /^You said yes to GitHub governance\. Two more answers, then Toolkit sets everything up\.$/m);
  assert.match(text, /^Answer in your own words, or with the letters, such as 1A 2A\.$/m);
  const disabled = guided.guidedQuestions({ state: { state: 'DISABLED', repository: SLUG } });
  assert.deepEqual(disabled.map(question => [question.key, question.choices.map(choice => choice.label)]), [
    ['governance', ['Keep it off', 'Turn it back on']], ['auto-merge', ['Yes', 'No']],
  ], 'no store question: the store is the one the programme file names');
  assert.match(guided.guidedQuestions({ state: UNDECIDED, store: STORE_INFO, publicRepo: true })[1].explain, /This repository is public: its programme file names the store \(the name only, never its contents\)/);
});

test('the reply is read from the owner\'s words or letters; one question answered two ways, or anything unclear, is refused', () => {
  const all = guided.guidedQuestions({ state: UNDECIDED, store: STORE_INFO });
  const read = (text, questions = all, state = UNDECIDED) => guided.parseGuidedAnswer(text, questions, { state });
  const on = (taskAutoMerge, store = null) => ({ governance: 'on', taskAutoMerge, store });
  for (const [answer, expected] of [
    ['1A 2A 3A', on('on')], ['all recommended', on('on')], ['yes', on('on')], ['Yes.', on('on')],
    ['1=A, 2=A, 3=B', on('off')], ['1A 2B you-me/records 3A', on('on', 'you-me/records')],
    ['yes, use the store, auto-merge no', on('off')], ['yes, store=you-me/records', on('on', 'you-me/records')],
    ['3B', on('off')], ['auto-merge yes', on('on')],
    ['later', { later: true, noStore: true }], ['1B', { later: true, noStore: true }],
    ['no', { governance: 'off', taskAutoMerge: 'off', store: null }], ['1C', { governance: 'off', taskAutoMerge: 'off', store: null }],
    ['no store', { noStore: true }], ['2C', { noStore: true }],
  ]) assert.deepEqual(read(answer), expected, answer);
  for (const [answer, why] of [
    ['maybe', /This part of the answer was not read: "maybe"/], ['ok', /not read: "ok"/], ['', /empty/],
    ['1A 1C', /two answers to "Turn on GitHub governance/], ['2B', /"Another repository" needs its name/],
    ['1B 3A', /"Later" keeps governance off, so answer it on its own/], ['1C, 2A', /"No" keeps governance off/],
    ['1A 2C', /No store keeps governance off, so answer it on its own/], ['4A', /There is no question 4 here/],
    ['1D', /not read: "1D"/], ['2A you-me/records', /goes only with "Another repository"/],
    ['store=not a name', /not read/], ['x'.repeat(401), /too long/],
  ]) assert.throws(() => read(answer), error => error instanceof guided.GuidedAnswerError && why.test(error.message), answer);
  // Where the owner already said yes, a plain yes takes the rest as recommended and there is no question to say no to.
  const agreed = guided.guidedQuestions({ state: UNDECIDED, store: STORE_INFO, agreed: true });
  assert.deepEqual(read('yes', agreed), on('on'));
  assert.deepEqual(read('1A 2B', agreed), on('off'));
  assert.throws(() => read('no', agreed), /answers a question that is not asked here/);
  // Where governance is off, only a clear turn back on changes anything.
  const offState = { state: 'DISABLED', repository: SLUG };
  const off = guided.guidedQuestions({ state: offState });
  assert.deepEqual(read('1B', off, offState), { governance: 'on', taskAutoMerge: 'on', store: null });
  assert.deepEqual(read('1B 2B', off, offState), { governance: 'on', taskAutoMerge: 'off', store: null });
  assert.deepEqual(read('all recommended', off, offState), { governance: 'keep', taskAutoMerge: 'off', store: null });
  assert.deepEqual(read('no', off, offState), { governance: 'keep', taskAutoMerge: 'off', store: null });
  assert.throws(() => read('2A', off, offState), /Governance stays off unless the answer turns it back on/);
});

test('hostile text never turns governance on, and a long answer is refused in linear time', () => {
  const all = guided.guidedQuestions({ state: UNDECIDED, store: STORE_INFO });
  const turnsOn = text => { try { return guided.parseGuidedAnswer(text, all, { state: UNDECIDED }).governance === 'on'; } catch { return false; } };
  hostile.expectDefaultDeny(assert, turnsOn, hostile.cases(hostile.FAMILIES, ['text']));
  // Look-alike and invisible characters inside a yes are not a yes.
  for (const text of [`y${String.fromCodePoint(0x200b)}es`, `y${String.fromCodePoint(0x0435)}s`, `${String.fromCodePoint(0xff11)}A`, '1A; rm -rf', 'yes please']) assert.equal(turnsOn(text), false, JSON.stringify(text));
  const timed = hostile.timing(text => turnsOn(text), size => `1 ${' '.repeat(size)}x`);
  assert.ok(timed.ok, timed.message);
});

// ---- the CLI: shown, answered with the owner's ticket, set up ------------------------------------

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-guided-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'fresh'), 'fresh', { home });
  fs.rmSync(path.join(repo, 'AGENTS.md'));
  fs.rmSync(path.join(repo, '.github', 'toolkit-programme.json'));
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  recordAbsent(repo, { registryPath });
  const registryOptions = { registryPath, testOnly: true };
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repo, registryOptions).repository_id);
  return { repo, registryOptions };
}

// GitHub as discovery reads it and the adoption writer changes it: no store or parent issue yet.
function fakeGitHub() {
  const calls = [];
  const world = { repos: {}, issues: [], nextIssue: 7 };
  const get = endpoint => {
    const url = endpoint.split('?')[0];
    if (url === `repos/${SLUG}/issues`) return { ok: true, value: world.issues };
    if (url === 'user/repos') return { ok: true, value: Object.keys(world.repos).map(full => ({ name: full.split('/')[1], owner: { login: OWNER } })) };
    if (url === `repos/${SLUG}`) return { ok: true, value: { default_branch: 'main', private: true, visibility: 'private' } };
    if (url === `repos/${SLUG}/rules/branches/main` || url === `repos/${SLUG}/rulesets`) return { ok: true, value: [] };
    const store = /^repos\/([^/]+\/[^/]+?)(\/contents\/.*)?$/.exec(url);
    if (store && world.repos[store[1]]) {
      if (!store[2]) return { ok: true, value: { private: true, owner: { login: OWNER } } };
      return store[2] === '/contents/' ? { ok: true, value: world.repos[store[1]].dirs.map(name => ({ type: 'dir', name })) } : { ok: false, reason: 'not-found' };
    }
    return { ok: false, reason: 'not-found' };
  };
  const writer = {
    get,
    createPrivateRepository(owner, name) { calls.push(['create', `${owner}/${name}`]); world.repos[`${owner}/${name}`] = { private: true, dirs: [] }; return { ok: true, value: {} }; },
    putFile(repository, file) { calls.push(['put', repository, file]); world.repos[repository].dirs.push(file.split('/')[0]); return { ok: true, value: {} }; },
    createIssue(repository, title) { calls.push(['issue', repository, title]); const number = world.nextIssue++; world.issues.push({ number, title, state: 'open', labels: [] }); return { ok: true, value: { number } }; },
  };
  return { calls, discoveryGh: args => get(args[0]), writer };
}

const PROPOSAL = { repository: SLUG, number: 4, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/4`, state: 'open', answer: 'yes' };

async function run(ctx, argv, github) {
  let out = ''; let err = '';
  const published = [];
  let open = [];
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive: false, registryOptions: ctx.registryOptions, ask: async () => '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }), environment: { TOOLKIT_HOST_SESSION: SESSION },
    discoveryGh: github.discoveryGh, adoptionWriter: github.writer,
    plainTextInstaller: (root, into) => {
      for (const name of ['.github/plain-text.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml']) {
        fs.mkdirSync(path.dirname(path.join(into, name)), { recursive: true });
        fs.writeFileSync(path.join(into, name), `${name}\n`);
      }
    },
    proposalTransport: { list: () => open, publish: (repository, binding, files) => { published.push({ binding, files }); open = [PROPOSAL]; return PROPOSAL; }, read: () => open[0] || PROPOSAL },
    cloudWorkflows: () => ({ files: {}, warning: null }),
  });
  const code = await cli.main(argv);
  return { code, out, err, published };
}

const tickets = ctx => new BankTickets({ registryOptions: ctx.registryOptions });
const epochOf = ctx => new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
// The owner's next own reply gets a ticket, as the prompt hook gives it; the agent sends it with the reference.
async function reply(ctx, github, answer) {
  const shown = tickets(ctx).pendingFor(SESSION, epochOf(ctx));
  assert.ok(shown, 'the questions wait for the owner\'s reply');
  const ticket = tickets(ctx).issue(SESSION, epochOf(ctx));
  return run(ctx, ['setup', '--answers', `${shown.bank_reference}: ${answer}`, '--ticket', ticket], github);
}

test('toolkit governance shows the three questions and notes them for the owner\'s reply; showing makes nothing', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const shown = await run(ctx, ['setup'], github);
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /^\*\*1\. Question: Turn on GitHub governance for toolkit-test-fixture\/fresh\?\*\*$/m);
  assert.match(shown.out, /^\*\*2\. Question: Keep records in toolkit-test-fixture\/TRANSPORT-fresh\?\*\*$/m);
  assert.match(shown.out, /^\*\*3\. Question: Turn on task auto-merge with merge train\?\*\*$/m);
  const paragraphs = shown.out.trim().split(/\n\s*\n/);
  assert.match(paragraphs.at(-1), /^Agents: this line is for you alone\. Put the text above in your closing message as printed, leaving out this line, and end your turn; how the questions show \(text, a card or the end-of-turn box\) is the app's choice\./);
  assert.doesNotMatch(paragraphs.slice(0, -1).join('\n'), /Agents|AskUserQuestion|\{"questions"/);
  assert.doesNotMatch(shown.out, /background wait|on the automatic turn|next turn/i, 'no wait step');
  assert.equal(github.calls.length, 0, 'showing the questions makes nothing');
  assert.ok(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), 'the owner\'s next reply can answer them');
});

test('the owner\'s answer sets everything up at once: store, parent issue, one setup pull request with both switches and this Toolkit\'s version, then the merge steps', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  await run(ctx, ['setup'], github);
  const done = await reply(ctx, github, '1A 2A 3A');
  assert.equal(done.code, 0, done.err + done.out);
  assert.deepEqual(github.calls, [['create', STORE], ['put', STORE, 'archives/README.md'], ['issue', SLUG, 'Programme: fresh']]);
  assert.equal(done.published.length, 1, 'one setup pull request');
  const { binding } = done.published[0];
  assert.deepEqual(binding.task_prs, { auto_merge: 'after-gates', merge_train: 'on' }, 'task auto-merge with merge train, as answered');
  assert.equal(binding.min_toolkit, readToolkitVersion(), 'the guided setup writes its own version, which turns on the setup hold');
  assert.match(done.out, /^Next: once its checks pass, approve merging https:\/\/github\.com\/toolkit-test-fixture\/fresh\/pull\/4 when Toolkit asks\. Toolkit then finishes the setup and gives you two commands to run\.$/m);
  // The owner's commands come after the merge, in the summary, never here.
  assert.doesNotMatch(done.out, /```powershell|toolkit-governance-app-setup|toolkit-permissions/);
  const agents = done.out.trim().split(/\n\s*\n/).at(-1);
  assert.match(agents, /^Agents: this line is for you alone\. .*wait for the checks of pull request #4 \(gh pr checks 4 --watch --interval 30\)\. When they pass, merge it with gh pr merge 4 --merge and do what Toolkit's merge hold says: the owner approves the merge there, never you\. After it has merged, run node "[^"]+toolkit-governance\.cjs" finish, then node "[^"]+toolkit-governance\.cjs" setup/);
  // Task auto-merge off: both switches off.
  const other = fixture(t);
  const second = fakeGitHub();
  await run(other, ['setup'], second);
  const off = await reply(other, second, 'yes, use the store, auto-merge no');
  assert.equal(off.code, 0, off.err + off.out);
  assert.deepEqual(off.published[0].binding.task_prs, { auto_merge: 'off', merge_train: 'off' });
});

test('later, no store and an unread reply make nothing; a reply that cannot be used asks again without the questions', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  await run(ctx, ['setup'], github);
  const unclear = await reply(ctx, github, 'maybe');
  assert.equal(unclear.code, 0, unclear.err);
  assert.match(unclear.out, /^This part of the answer was not read: "maybe"\. Nothing was written\.$/m);
  assert.match(unclear.out, /^Reply again in your own words, or with the letters, such as 1A 2A 3A\.$/m);
  assert.doesNotMatch(unclear.out, /Question: /, 'the questions are not shown again');
  const later = await reply(ctx, github, 'later');
  assert.match(later.out, /^Later: nothing was written, and governance stays off\. Toolkit asks again next session\.$/m);
  const none = await reply(ctx, github, 'no store');
  assert.match(none.out, /^Governance needs a store, so it stays off\. Nothing was written/m);
  assert.equal(github.calls.length, 0);
  // Without the owner's live ticket nothing is written.
  const reference = tickets(ctx).pendingFor(SESSION, epochOf(ctx)).bank_reference;
  const forged = await run(ctx, ['setup', '--answers', `${reference}: 1A 2A 3A`, '--ticket', 'f'.repeat(32)], github);
  assert.equal(forged.code, 2);
  assert.match(forged.err, /^No live reply ticket from the owner for this session and repository, so nothing was written\. The owner can type toolkit governance to see the questions again\./m);
  assert.equal(github.calls.length, 0);
});

test('the owner\'s yes to the session-start question is noted for the run, so the setup asks only the store and auto-merge', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const epochs = new gate.SessionEpochs({ registryOptions: ctx.registryOptions });
  const id = governance.governanceState(ctx.repo, ctx.registryOptions).repository_id;
  assert.ok(tickets(ctx).agree(SESSION, { epoch: epochOf(ctx), repositoryMark: epochs.repository(id), repositoryId: id }));
  const shown = await run(ctx, ['setup'], github);
  assert.match(shown.out, /^You said yes to GitHub governance\./m);
  assert.doesNotMatch(shown.out, /Question: Turn on GitHub governance/);
  assert.match(shown.out, /^\*\*1\. Question: Keep records in toolkit-test-fixture\/TRANSPORT-fresh\?\*\*$/m);
  const done = await reply(ctx, github, 'yes');
  assert.equal(done.code, 0, done.err + done.out);
  assert.equal(done.published.length, 1);
  // A new run of the session (its mark changes): the yes no longer counts, and all three are asked.
  const fresh = fixture(t);
  const freshId = governance.governanceState(fresh.repo, fresh.registryOptions).repository_id;
  const freshEpochs = new gate.SessionEpochs({ registryOptions: fresh.registryOptions });
  tickets(fresh).agree(SESSION, { epoch: epochOf(fresh), repositoryMark: freshEpochs.repository(freshId), repositoryId: freshId });
  freshEpochs.start(SESSION, 'resume', freshId);
  assert.match((await run(fresh, ['setup'], fakeGitHub())).out, /Question: Turn on GitHub governance/);
});
