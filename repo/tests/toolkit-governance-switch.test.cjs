'use strict';

// The repository's one task auto-merge switch (`task_prs.auto_merge` in the merged binding), set
// through the governance question bank (`toolkit governance`): a change is one binding pull request,
// prepared only from the owner's own reply (its bank ticket); the old per-app answers are removed only
// once the new switch is merged and read back.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordMerged, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const { GitHubProposalTransport, MARKER, switchNote } = require(path.join(scripts, 'toolkit-governance-proposal.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const { BankTickets } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const SESSION = 'session-owner-1';

const SLUG = 'toolkit-test-fixture/switch';
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'toolkit-local-bridge', 'version.json'), 'utf8')).version;
const VERSION_LINE = `Merge only after every computer and cloud copy working on this repository runs Toolkit ${VERSION} or later; older copies show governance ERROR until they update.`;

function bindingText(extra = {}) {
  return `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'], ...extra,
  }, null, 2)}\n`;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-switch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'switch'), 'switch', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const ctx = { root, home, repo, registryPath, registryOptions: { registryPath, testOnly: true } };
  ctx.merge = (text, ageMs = 0) => {
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text);
    recordMerged(repo, { registryPath, text, now: new Date(Date.now() - ageMs) });
    ctx.mergedText = text;
  };
  ctx.merge(bindingText());
  return ctx;
}

function legacyAnswers(ctx) {
  const folder = path.dirname(ctx.registryPath);
  for (const host of ['codex', 'claude-code']) fs.writeFileSync(path.join(folder, `task-auto-merge.${host}.v1.json`), `${JSON.stringify({ schema: 'toolkit.task-auto-merge-preferences.v1', host, value: 'after-gates' })}\n`);
  return () => governance.LEGACY_TASK_ANSWERS.filter(name => fs.existsSync(path.join(folder, name)));
}

async function run(ctx, argv, { interactive = false, answers = [], switchTransport = null, proposalTransport = null, environment = { TOOLKIT_HOST_SESSION: SESSION }, missing = 0, appReader = null } = {}) {
  let out = ''; let err = '';
  const asked = [];
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions,
    ask: async question => { asked.push(question); return answers.shift() ?? ''; },
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing, stale: 0, update: 'node fixture-apply.cjs --apply', remove: 'node fixture-apply.cjs --remove' }), environment,
    ...(switchTransport ? { switchTransport } : {}),
    ...(appReader ? { appReader } : {}),
    ...(proposalTransport ? { proposalTransport, cloudWorkflows: () => ({ files: {}, warning: null }) } : {}),
  });
  const code = await cli.main(argv);
  return { code, out, err, asked };
}

// The session-start hook's mark for SESSION, so the bank can be noted for its run.
function startOwnerSession(ctx) {
  new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).start(SESSION, 'startup', governance.governanceState(ctx.repo, ctx.registryOptions).repository_id);
}

// Shows the summary or questions, has the owner's next own reply turn it into a ticket (as the prompt
// hook does), then sends the answer with that ticket.
async function answerBank(ctx, answer, options = {}) {
  startOwnerSession(ctx);
  const shown = await run(ctx, ['setup'], options);
  assert.equal(shown.code, 0, shown.err);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const tickets = new BankTickets({ registryOptions: ctx.registryOptions });
  const reference = tickets.pendingFor(SESSION, epoch).bank_reference;
  const ticket = tickets.issue(SESSION, epoch);
  assert.ok(ticket, 'the shown summary gives the next reply a ticket');
  const result = await run(ctx, ['setup', '--answers', `${reference}: ${answer}`, '--ticket', ticket], options);
  return { ...result, shown, reference, ticket };
}
const row = (out, part) => out.split('\n').find(line => line.startsWith(`| ${part} |`));

test('toolkit governance shows the summary where governance is on, and keeps the old per-app answers while no switch is set', async t => {
  const ctx = fixture(t);
  const present = legacyAnswers(ctx);
  startOwnerSession(ctx);
  const before = fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8');
  for (const command of ['setup', 'refresh']) {
    const result = await run(ctx, [command], { missing: 6 });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /^\*\*Governance: on, not ready: 1 step left\.\*\*$/m);
    assert.match(result.out, /^\| Part \| State \| What it does \|$/m);
    assert.equal(row(result.out, 'GitHub governance'), '| GitHub governance | On | Records, decisions and evidence for this repository, the same on every computer |');
    assert.match(row(result.out, 'Task auto-merge with merge train'), /^\| Task auto-merge with merge train \| Off \|/);
    assert.match(row(result.out, 'Toolkit permissions (Claude Code, this computer)'), /\| Waiting: 6 to add \|/);
    assert.match(row(result.out, 'Toolkit instruction copies'), /\| 1 file left; say clean up copies \|/);
    assert.ok(result.out.includes('\n```powershell\nnode fixture-apply.cjs --apply\n```\n'), 'the owner\'s permissions command, in a PowerShell block');
    assert.doesNotMatch(result.out, /Bank reference|1\.1=|could not note this/);
  }
  assert.equal(present().length, 2, 'no switch read back yet, so the old answers stay');
  assert.equal(fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8'), before, 'showing the summary never writes the binding');
  const json = JSON.parse((await run(ctx, ['setup', '--json'])).out);
  assert.match(json.bank_reference, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  const unmarked = await run(ctx, ['setup'], { environment: {} });
  assert.match(unmarked.out, /could not note this for this session/, 'a session without a mark is told a chat reply cannot count');
});

test('once the merged switch is read back, refresh and status remove the old per-app answers, never before', async t => {
  const ctx = fixture(t);
  let present = legacyAnswers(ctx);
  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates' } }), 25 * 60 * 60 * 1000);
  const stale = await run(ctx, ['refresh']);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /^Toolkit governance could not be shown because GitHub could not be read just now.*Type toolkit governance again in a moment\.$/m);
  assert.equal(present().length, 2, 'a stale read is not a read-back');
  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates' } }));
  const result = await run(ctx, ['refresh']);
  assert.equal(result.code, 0, result.err);
  assert.match(row(result.out, 'Task auto-merge with merge train'), /^\| Task auto-merge with merge train \| On \|/);
  assert.equal(present().length, 0, 'the summary read the merged switch back, so the old answers went');
  present = legacyAnswers(ctx);
  ctx.merge(bindingText({ task_prs: { auto_merge: 'off' } }));
  const status = await run(ctx, ['status']);
  assert.match(status.out, /Task auto-merge: off \(every pull request waits for a typed merge\)\./);
  assert.match(status.out, /Removed the old per-app task auto-merge answers/);
  assert.equal(present().length, 0, 'status is a governance read too');
});

test('a change in words with the owner\'s ticket prepares one binding pull request that changes only the switch', async t => {
  const ctx = fixture(t);
  const calls = [];
  const switchTransport = { publishSwitch: (...args) => { calls.push(args); return { number: 12, url: `https://github.com/${SLUG}/pull/12`, head: 'a'.repeat(40) }; } };
  const result = await answerBank(ctx, 'task auto-merge on', { switchTransport });
  assert.equal(result.code, 0, result.err);
  assert.equal(calls.length, 1);
  const [repository, mergedText, text, value] = calls[0];
  assert.equal(repository, SLUG);
  assert.equal(mergedText, ctx.mergedText);
  assert.deepEqual(value, { auto_merge: 'after-gates', merge_train: 'on' }, 'task auto-merge with merge train');
  const proposal = JSON.parse(text);
  assert.deepEqual(proposal.task_prs, { auto_merge: 'after-gates', merge_train: 'on' });
  delete proposal.task_prs;
  assert.deepEqual(proposal, JSON.parse(ctx.mergedText), 'nothing else changes, and no reader-only field leaks in');
  assert.ok(result.out.includes(VERSION_LINE), 'the older-copies warning is shown with this release');
  assert.match(result.out, /Prepared https:\/\/github\.com\/toolkit-test-fixture\/switch\/pull\/12: it sets task auto-merge on with merge trains and changes nothing else\. It applies only after you merge it/);
  assert.equal(governance.taskAutoMerge(ctx.repo, ctx.registryOptions).auto_merge, 'off', 'preparing grants nothing');

  const spent = await run(ctx, ['setup', '--answers', `${result.reference}: task auto-merge on`, '--ticket', result.ticket], { switchTransport });
  assert.equal(spent.code, 2, 'a ticket works once');
  assert.match(spent.err, /No live reply ticket from the owner.*nothing was written/);
  const forged = await run(ctx, ['setup', '--answers', `${result.reference}: task auto-merge on`, '--ticket', 'f'.repeat(32)], { switchTransport });
  assert.equal(forged.code, 2, 'an agent cannot make up a ticket');
  assert.equal(calls.length, 1);

  const offline = await answerBank(ctx, 'task auto-merge on');
  assert.equal(offline.code, 2);
  assert.match(offline.err, /no pull request was prepared\. Nothing was written\./);
  const moved = await answerBank(ctx, 'task auto-merge on', { switchTransport: { publishSwitch: () => { throw Object.assign(new Error('x'), { code: 'SWITCH_BASE_CHANGED' }); } } });
  assert.equal(moved.code, 2);
  assert.match(moved.err, /changed since this computer read it/);
  const unread = await answerBank(ctx, 'maybe', { switchTransport });
  assert.equal(unread.code, 0, 'an answer that cannot be read is not a failure');
  assert.match(unread.out, /This was not read as a change: "maybe"\..* Nothing was written\.\nTo change something, say turn off governance, task auto-merge on, task auto-merge off or change store\./);
  assert.doesNotMatch(unread.out, /^\| /m, 'the summary is not shown again');
  for (const bad of [['refresh', '--set', 'on'], ['setup', '--answers', 'x'], ['setup', '--answers', 'explain 1.1'], ['setup', '--answers', 'x', '--ticket', 'nothex'], ['status', '--answers', 'x', '--ticket', 'f'.repeat(32)]]) assert.equal((await run(ctx, bad)).code, 2, bad.join(' '));
});

test('a ticket answers only what it was given for: a changed state shows the summary as it stands and writes nothing', async t => {
  const ctx = fixture(t);
  const calls = [];
  const switchTransport = { publishSwitch: (...args) => { calls.push(args); return { number: 12, url: `https://github.com/${SLUG}/pull/12`, head: 'a'.repeat(40) }; } };
  startOwnerSession(ctx);
  await run(ctx, ['setup']);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const tickets = new BankTickets({ registryOptions: ctx.registryOptions });
  const reference = tickets.pendingFor(SESSION, epoch).bank_reference;
  const ticket = tickets.issue(SESSION, epoch);
  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates' } }));
  const result = await run(ctx, ['setup', '--answers', `${reference}: task auto-merge off`, '--ticket', ticket], { switchTransport });
  assert.equal(result.code, 0);
  assert.match(result.out, /^What Toolkit showed has changed since, so the answer was not used and nothing was written\./m);
  assert.match(row(result.out, 'Task auto-merge with merge train'), /\| On \|/);
  assert.equal(calls.length, 0);
  const other = await run(ctx, ['setup', '--answers', `${reference}: task auto-merge off`, '--ticket', ticket], { switchTransport, environment: { TOOLKIT_HOST_SESSION: 'another-session' } });
  assert.equal(other.code, 2, 'another session cannot spend it either');
});

test('a cloud session shows the summary but says a chat answer cannot be recorded there, and refuses an answer', async t => {
  const ctx = fixture(t);
  startOwnerSession(ctx);
  const cloud = { TOOLKIT_HOST_SESSION: SESSION, CLAUDE_CODE_REMOTE: 'true' };
  const shown = await run(ctx, ['setup'], { environment: cloud });
  assert.equal(shown.code, 0, shown.err);
  assert.ok(row(shown.out, 'Task auto-merge with merge train'));
  assert.match(shown.out, /This is a cloud session, .* an answer in this chat cannot be recorded\. Answer from a Remote Control session on your computer, or run .* in your own terminal\./);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  assert.equal(new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch), null, 'nothing is noted for a reply');
  const answered = await run(ctx, ['setup', '--answers', 'ABCD-EFGH-JKMN-PQRS: task auto-merge on', '--ticket', 'a'.repeat(32)], { environment: cloud });
  assert.notEqual(answered.code, 0);
  assert.match(answered.err, /This is a cloud session.*Nothing was written\./);
});

test('the permissions step gives the owner one command to run themselves when lines are outdated, never the blocks', async t => {
  const ctx = fixture(t);
  startOwnerSession(ctx);
  const update = await run(ctx, ['setup'], { missing: 3 });
  assert.equal(update.code, 0, update.err);
  assert.match(update.out, /^\*\*Toolkit permissions \(Claude Code, this computer\):\*\* Lets agents run Toolkit's own commands without asking each time\. Adds 3 Toolkit lines\. Run it in PowerShell; it shows the changes and waits for Enter\.$/m);
  assert.ok(update.out.includes('\n```powershell\nnode fixture-apply.cjs --apply\n```\n'), 'the command sits in Toolkit\'s own PowerShell block, so the app keeps its quotes straight and gives it a Run button');
  assert.match(update.out, /Never run a command above yourself\./);
  assert.equal(update.out.match(/^Agents: /gm).length, 1, 'one Agents line, the last');
  const none = await run(ctx, ['setup'], { missing: 0 });
  assert.doesNotMatch(none.out, /fixture-apply/);
});

test('where governance is off, task auto-merge is asked only with turning it back on', async t => {
  const ctx = fixture(t);
  recordMerged(ctx.repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' }) });
  startOwnerSession(ctx);
  const shown = await run(ctx, ['setup']);
  assert.match(shown.out, /^\*\*1\. Question: Turn GitHub governance back on for toolkit-test-fixture\/switch\?\*\*$/m);
  assert.match(shown.out, /^\*\*2\. Question: Turn on task auto-merge with merge train\?\*\*$/m);
  const alone = await answerBank(ctx, '2A');
  assert.match(alone.out, /Governance stays off unless the answer turns it back on.*Nothing was written/);
});

test('merge trains come with task auto-merge on; turning it off keeps the stored train value', async t => {
  const ctx = fixture(t);
  const calls = [];
  const switchTransport = { publishSwitch: (...args) => { calls.push(args); return { number: 13, url: `https://github.com/${SLUG}/pull/13`, head: 'a'.repeat(40) }; } };
  startOwnerSession(ctx);
  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates', merge_train: 'off' } }));
  startOwnerSession(ctx);
  assert.match(row((await run(ctx, ['setup'])).out, 'Task auto-merge with merge train'), /\| On, merge trains off \|/);
  const answered = await answerBank(ctx, 'task auto-merge off', { switchTransport });
  assert.equal(answered.code, 0, answered.err);
  assert.deepEqual(calls.at(-1)[3], { auto_merge: 'off' }, 'only task auto-merge changes');
  assert.deepEqual(JSON.parse(calls.at(-1)[2]).task_prs, { auto_merge: 'off', merge_train: 'off' }, 'the stored merge-train value stays');
});

test('the switch pull request keeps the merged formatting: a compact binding gains one member, a set value is replaced in place', async t => {
  const ctx = fixture(t);
  const texts = [];
  const switchTransport = { publishSwitch: (repository, mergedText, text) => { texts.push(text); return { number: 3, url: `https://github.com/${SLUG}/pull/3`, head: 'a'.repeat(40) }; } };
  const compact = JSON.stringify(JSON.parse(bindingText()));
  ctx.merge(compact);
  assert.equal((await answerBank(ctx, 'task auto-merge on', { switchTransport })).code, 0);
  assert.equal(texts.at(-1), `${compact.slice(0, -1)},"task_prs":{"auto_merge":"after-gates","merge_train":"on"}}`);
  const set = bindingText({ task_prs: { auto_merge: 'after-gates' } });
  ctx.merge(set);
  assert.equal((await answerBank(ctx, 'task auto-merge off', { switchTransport })).code, 0);
  assert.equal(texts.at(-1), set.replace('"auto_merge": "after-gates"', '"auto_merge": "off"'));
  const crlf = bindingText().replace(/\n/g, '\r\n');
  ctx.merge(crlf);
  assert.equal((await answerBank(ctx, 'task auto-merge on', { switchTransport })).code, 0);
  assert.equal(texts.at(-1), crlf.replace(/\r\n\}\r\n$/, ',\r\n  "task_prs": { "auto_merge": "after-gates", "merge_train": "on" }\r\n}\r\n'));
  // A switch task_prs does not hold yet joins it in place, in its layout.
  const inline = bindingText({ task_prs: { merge_train: 'on' } }).replace(/"task_prs": \{[^}]*\}/, '"task_prs": { "merge_train": "on" }');
  ctx.merge(inline);
  assert.equal((await answerBank(ctx, 'task auto-merge on', { switchTransport })).code, 0);
  assert.equal(texts.at(-1), inline.replace('"merge_train": "on" }', '"merge_train": "on", "auto_merge": "after-gates" }'));
});

test('turning governance on carries the switch in the same enable proposal, for a version 1 or 2 working binding', async t => {
  for (const version of [1, 2]) {
    const ctx = fixture(t);
    const binding = JSON.parse(bindingText());
    const working = version === 2 ? binding : { schema: 'toolkit.programme-binding.v1', repository: SLUG, parent_issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX', store: binding.store, required_checks: binding.required_checks };
    fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), `${JSON.stringify(working, null, 2)}\n`);
    recordAbsent(ctx.repo, { registryPath: ctx.registryPath });
    const published = [];
    let open = [];
    const proposal = { repository: SLUG, number: 4, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/4`, state: 'open', answer: 'yes' };
    const proposalTransport = { list: () => open, publish: (repository, prepared, files) => { published.push({ prepared, files }); open = [proposal]; return proposal; }, read: () => proposal };
    const result = await run(ctx, ['setup'], { interactive: true, answers: ['all recommended'], proposalTransport });
    assert.equal(result.code, 0, result.out + result.err);
    assert.equal(result.asked.length, 1, 'the owner\'s own terminal reads one reply');
    assert.doesNotMatch(result.out, /Question: Keep records/, 'the prepared programme file names the store, so it is not asked');
    assert.equal(published.length, 1, `version ${version}`);
    const text = published[0].files['.github/toolkit-programme.json'];
    assert.deepEqual(JSON.parse(text).task_prs, { auto_merge: 'after-gates', merge_train: 'on' }, `version ${version}`);
    assert.equal(JSON.parse(text).schema, 'toolkit.programme-binding.v2');
    assert.ok(result.out.includes(VERSION_LINE), 'the older-copies warning is shown with the proposal');
    assert.equal(governance.taskAutoMerge(ctx.repo, ctx.registryOptions).answered, false, 'a pending proposal grants nothing');
  }
  assert.equal(switchNote({ governance: 'enabled' }), '', 'an enable proposal without the switch says nothing about it');
  const note = switchNote({ governance: 'enabled', task_prs: { auto_merge: 'after-gates' } });
  assert.match(note, /sets this repository's switches: `task_prs\.auto_merge` to `after-gates`/);
  assert.ok(note.includes(VERSION_LINE), 'the enable pull request warns about older copies');
});

test('the summary turns governance off without the terminal, and a chat answer needs the owner\'s ticket', async t => {
  const ctx = fixture(t);
  const published = [];
  let open = [];
  const proposal = { repository: SLUG, number: 5, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/5`, state: 'open', answer: 'no' };
  const proposalTransport = { list: () => open, publish: (repository, prepared, files) => { published.push({ prepared, files }); open = [proposal]; return proposal; }, read: () => proposal };
  const noTicket = await run(ctx, ['setup', '--answers', 'AAAA-AAAA-AAAA-AAAA: turn off governance', '--ticket', 'a'.repeat(32)], { proposalTransport });
  assert.equal(noTicket.code, 2);
  assert.equal(published.length, 0, 'nothing is prepared without the owner\'s ticket');
  const off = await answerBank(ctx, 'turn off governance', { proposalTransport });
  assert.equal(off.code, 0, off.err);
  assert.equal(published.length, 1);
  assert.equal(JSON.parse(published[0].files['.github/toolkit-programme.json']).governance, 'disabled');

  recordMerged(ctx.repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' }) });
  startOwnerSession(ctx);
  const disabled = await run(ctx, ['setup']);
  assert.equal(disabled.code, 0);
  assert.match(disabled.out, /^   - \*\*A\. Keep it off \(my pick\):\*\* Nothing changes\.$/m);
  const unanswered = await run(ctx, ['setup'], { interactive: true, answers: ['maybe'] });
  assert.equal(unanswered.code, 1);
  assert.match(unanswered.out, /This part of the answer was not read: "maybe"\. Nothing was written\./);
});

// 1460 G2 L2: turning governance back on from off gave no App line at all, while a first turn-on does.
// Every turn-on now gives the owner's two commands in the summary after the merge.
test('turning governance back on from off says the two commands come after the merge, and staying off changes nothing', async t => {
  const ctx = fixture(t);
  fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), bindingText());
  recordMerged(ctx.repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' }) });
  const proposal = { repository: SLUG, number: 6, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/6`, state: 'open', answer: 'yes' };
  let open = [];
  const proposalTransport = { list: () => open, publish: () => { open = [proposal]; return proposal; }, read: () => proposal };
  const kept = await run(ctx, ['setup'], { interactive: true, answers: ['1A'], proposalTransport });
  assert.equal(kept.code, 0, kept.err);
  assert.match(kept.out, /^Nothing changed: governance stays off\.$/m);
  const on = await run(ctx, ['setup'], { interactive: true, answers: ['1B'], proposalTransport });
  assert.equal(on.code, 0, on.err + on.out);
  assert.match(on.out, /^Next: once its checks pass, approve merging https:\/\/github\.com\/toolkit-test-fixture\/switch\/pull\/6 when Toolkit asks\. Toolkit then finishes the setup and gives you two commands to run\.$/m);
});

// A gh stand-in for the transport: answers each `gh api` call from `routes` and records writes.
function fakeGh(routes) {
  const calls = [];
  const runner = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'auth') return '';
    const endpoint = args[1];
    const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : (input === undefined ? 'GET' : 'POST');
    for (const [pattern, reply] of routes) if (pattern.test(`${method} ${endpoint}`)) return JSON.stringify(typeof reply === 'function' ? reply(input) : reply);
    throw Object.assign(new Error('PROPOSAL_NOT_FOUND'), { code: 'PROPOSAL_NOT_FOUND' });
  };
  return { calls, runner };
}

test('the switch transport refuses a moved default branch and opens a pull request that is not a governance proposal', () => {
  const merged = bindingText();
  const proposal = bindingText({ task_prs: { auto_merge: 'after-gates' } });
  const base = 'b'.repeat(40);
  const routes = (current) => [
    [/^GET user$/, { login: 'owner' }],
    [/^GET repos\/toolkit-test-fixture\/switch$/, { default_branch: 'main' }],
    [/^GET repos\/toolkit-test-fixture\/switch\/git\/ref\/heads\/main$/, { object: { sha: base } }],
    [/^GET repos\/toolkit-test-fixture\/switch\/contents\/\.github\/toolkit-programme\.json\?ref=/, { type: 'file', encoding: 'base64', content: Buffer.from(current).toString('base64'), sha: 'c'.repeat(40) }],
    [/^GET repos\/toolkit-test-fixture\/switch\/pulls\?state=open&head=/, []],
    [/^POST repos\/toolkit-test-fixture\/switch\/git\/refs$/, { ref: 'x' }],
    [/^PUT repos\/toolkit-test-fixture\/switch\/contents\/\.github\/toolkit-programme\.json$/, { commit: { sha: 'd'.repeat(40) } }],
    [/^POST repos\/toolkit-test-fixture\/switch\/pulls$/, input => ({ number: 7, html_url: `https://github.com/${SLUG}/pull/7`, body: input.body })],
  ];
  const moved = fakeGh(routes(bindingText({ required_checks: ['validate', 'other'] })));
  assert.throws(() => new GitHubProposalTransport({ run: moved.runner }).publishSwitch(SLUG, merged, proposal, { auto_merge: 'after-gates' }), { code: 'SWITCH_BASE_CHANGED' });
  assert.ok(!moved.calls.some(call => /git\/refs$|pulls$/.test(call.args[1] || '') && call.input !== undefined), 'nothing written');

  const gh = fakeGh(routes(merged));
  const result = new GitHubProposalTransport({ run: gh.runner }).publishSwitch(SLUG, merged, proposal, { auto_merge: 'after-gates' });
  assert.equal(result.number, 7);
  const put = gh.calls.find(call => call.args.includes('PUT'));
  assert.equal(Buffer.from(put.input.content, 'base64').toString('utf8'), proposal);
  assert.match(put.input.branch, /^toolkit\/switches-task-auto-merge-on-[0-9a-f]{32}$/);
  const pr = gh.calls.find(call => /pulls$/.test(call.args[1]) && call.input);
  assert.equal(pr.input.base, 'main');
  assert.ok(!pr.input.body.includes(MARKER), 'never read as a governance decision');
  assert.match(pr.input.body, /changes only `task_prs\.auto_merge`.*It applies only after the owner merges it/s);
  assert.ok(pr.input.body.includes(VERSION_LINE), 'the switch pull request warns about older copies');
});

// schedule_folder is retired: the reader still accepts it, but a switch pull request drops it.
const RETIRED = '  "schedule_folder": "TOOLKIT",\n';
const withRetired = text => text.replace('  "required_checks"', `${RETIRED}  "required_checks"`);

test('a switch pull request drops the retired schedule_folder line in the same diff and changes nothing else', async t => {
  const ctx = fixture(t);
  const calls = [];
  const switchTransport = { publishSwitch: (...args) => { calls.push(args); return { number: 4, url: `https://github.com/${SLUG}/pull/4`, head: 'a'.repeat(40) }; } };
  for (const [layout, extra, change] of [['pretty, switch added', {}, 'task auto-merge on'], ['pretty, switch set in place', { task_prs: { auto_merge: 'after-gates' } }, 'task auto-merge off']]) {
    const plain = bindingText(extra);
    ctx.merge(plain);
    assert.equal((await answerBank(ctx, change, { switchTransport })).code, 0, layout);
    const before = calls.at(-1)[2];
    const carried = withRetired(plain);
    assert.notEqual(carried, plain, 'the fixture carries the key');
    ctx.merge(carried);
    assert.equal((await answerBank(ctx, change, { switchTransport })).code, 0, layout);
    const [, mergedText, text] = calls.at(-1);
    assert.equal(mergedText, carried, `${layout}: the pull request starts from the exact merged text`);
    assert.equal(text, before, `${layout}: the only other change is the removed schedule_folder line`);
  }
  // A compact or CRLF binding keeps its layout too, and a key at the end takes the comma before it.
  const compact = JSON.stringify({ ...JSON.parse(bindingText()), schedule_folder: 'TOOLKIT' });
  ctx.merge(compact);
  assert.equal((await answerBank(ctx, 'task auto-merge on', { switchTransport })).code, 0);
  assert.equal(calls.at(-1)[2], `${JSON.stringify(JSON.parse(bindingText())).slice(0, -1)},"task_prs":{"auto_merge":"after-gates","merge_train":"on"}}`);
  const crlf = withRetired(bindingText()).replace(/\n/g, '\r\n');
  ctx.merge(crlf);
  assert.equal((await answerBank(ctx, 'task auto-merge on', { switchTransport })).code, 0);
  assert.equal(calls.at(-1)[2], bindingText().replace(/\n/g, '\r\n').replace(/\r\n\}\r\n$/, ',\r\n  "task_prs": { "auto_merge": "after-gates", "merge_train": "on" }\r\n}\r\n'));
});

test('the switch pull request text names the retired line it deletes, and only when it deletes one', () => {
  const routes = current => [
    [/^GET user$/, { login: 'owner' }],
    [/^GET repos\/toolkit-test-fixture\/switch$/, { default_branch: 'main' }],
    [/^GET repos\/toolkit-test-fixture\/switch\/git\/ref\/heads\/main$/, { object: { sha: 'b'.repeat(40) } }],
    [/^GET repos\/toolkit-test-fixture\/switch\/contents\/\.github\/toolkit-programme\.json\?ref=/, { type: 'file', encoding: 'base64', content: Buffer.from(current).toString('base64'), sha: 'c'.repeat(40) }],
    [/^GET repos\/toolkit-test-fixture\/switch\/pulls\?state=open&head=/, []],
    [/^POST repos\/toolkit-test-fixture\/switch\/git\/refs$/, { ref: 'x' }],
    [/^PUT repos\/toolkit-test-fixture\/switch\/contents\/\.github\/toolkit-programme\.json$/, { commit: { sha: 'd'.repeat(40) } }],
    [/^POST repos\/toolkit-test-fixture\/switch\/pulls$/, input => ({ number: 8, html_url: `https://github.com/${SLUG}/pull/8`, body: input.body })],
  ];
  const proposal = bindingText({ task_prs: { auto_merge: 'after-gates' } });
  const body = merged => {
    const gh = fakeGh(routes(merged));
    new GitHubProposalTransport({ run: gh.runner }).publishSwitch(SLUG, merged, proposal, { auto_merge: 'after-gates' });
    return gh.calls.find(call => /pulls$/.test(call.args[1]) && call.input).input.body;
  };
  assert.match(body(withRetired(bindingText())), /^This changes only `task_prs\.auto_merge` in `\.github\/toolkit-programme\.json`, and deletes the retired `schedule_folder`, which nothing reads any more\. These are/);
  assert.match(body(bindingText()), /^This changes only `task_prs\.auto_merge` in `\.github\/toolkit-programme\.json`\. These are/);
});

// A chat the session-start hook did not reach (hooks off or untrusted, a helper, a host without
// hooks) finds the governed rules only through status, so status names the file in a governed
// repository, and only there.
test('status names the governed rules file in a governed repository, and not once governance is off', async t => {
  const ctx = fixture(t);
  const enabled = await run(ctx, ['status']);
  assert.equal(enabled.code, 0, enabled.err);
  const line = enabled.out.split('\n').find(text => text.startsWith('Governed rules: '));
  assert.ok(line, enabled.out);
  assert.match(line, /^Governed rules: .+[\\/]repo[\\/]contracts[\\/]agent-rules[\\/]toolkit-governed-rules\.md\. Each new chat gets them from the session-start hook; where no hook ran, read this file\.$/);
  const file = line.slice('Governed rules: '.length, line.indexOf('.md. ') + 3);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Toolkit-Governed Repository Rules/, 'the named file is the governed rules');
  const json = JSON.parse((await run(ctx, ['status', '--json'])).out);
  assert.equal(json.governed_rules, file);
  ctx.merge(bindingText({ governance: 'disabled' }));
  const disabled = await run(ctx, ['status']);
  assert.match(disabled.out, /^State: DISABLED/m);
  assert.doesNotMatch(disabled.out, /Governed rules:/);
  assert.equal(JSON.parse((await run(ctx, ['status', '--json'])).out).governed_rules, undefined);
});
