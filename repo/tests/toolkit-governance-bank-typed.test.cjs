'use strict';

// The governance bank is one typed question bank in every app, Claude Code included, the same way
// as `setup toolkit`: the whole list at once, answered in one line. It names no tap card, and the
// tool gate leaves question cards that carry bank rows alone (they can never answer the bank).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const { BankTickets } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const governanceApp = require(path.join(scripts, 'toolkit-governance-app.cjs'));
const SESSION = 'session-card-1';
const SLUG = 'toolkit-test-fixture/card';

function fixture(t, { quiet = false, taskPrs = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-card-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'card'), 'card', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const text = `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'],
    ...(taskPrs ? { task_prs: taskPrs } : {}),
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text);
  recordMerged(repo, { registryPath, text });
  const registryOptions = { registryPath, testOnly: true };
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repo, registryOptions).repository_id);
  if (!quiet) return { repo, registryOptions };
  // Nothing left for the Toolkit defaults to do: no instruction copies, permissions current, the App set up.
  const copy = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  fs.rmSync(path.join(repo, 'AGENTS.md'));
  return { repo, registryOptions, cli: QUIET, copy };
}
const QUIET = Object.freeze({
  permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }),
  appReader: args => {
    const kind = /\/actions\/(variables|secrets)\?/.exec(args[0])[1];
    return { ok: true, value: { total_count: 1, [kind]: [{ name: kind === 'variables' ? governanceApp.APP.variable : governanceApp.APP.secret }] } };
  },
});

async function run(ctx, argv, { interactive = false, answers = [] } = {}) {
  let out = ''; let err = '';
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions, ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 2, stale: 1, update: 'node fixture-apply.cjs --apply', remove: 'node fixture-apply.cjs --remove' }),
    environment: { TOOLKIT_HOST_SESSION: SESSION }, ...(ctx.cli || {}),
  });
  const code = await cli.main(argv);
  return { code, out, err };
}

// What the agent is told sits in one last line that starts with "Agents", so the guide can tell it to
// keep that line off the owner's screen; nothing for the agent sits elsewhere.
function agentsLast(out) {
  const paragraphs = out.trim().split(/\n\s*\n/);
  const last = paragraphs.at(-1);
  assert.match(last, /^Agents: [^\n]+$/, 'the last paragraph is the one Agents line');
  for (const paragraph of paragraphs.slice(0, -1)) assert.doesNotMatch(paragraph, /\bAgents\b|AskUserQuestion|\{"questions"/, 'no agent instruction outside it');
}

test('the bank is one typed list of its two questions, answered in one line, and names no card', async t => {
  const ctx = fixture(t);
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, 'a shown bank is not a failure');
  assert.doesNotMatch(shown.out, /```|AskUserQuestion|\{"questions"|question card|tap/i);
  assert.match(shown.out, /^# Toolkit governance choices - 2 questions across 1 section$/m);
  assert.match(shown.out, /^\| 1\.1 \| GitHub governance \| On \| A\. Keep current \| B\. Turn off \|$/m);
  assert.match(shown.out, /^\| 1\.2 \| Task auto-merge \| Off \| A\. Keep current \| B\. On \|$/m);
  assert.doesNotMatch(shown.out, /^\| (1\.[3-9]|2\.\d) \|/m, 'no other question');
  assert.match(shown.out, /^Reply all recommended, or only your changes such as 1\.1=B\. Rows you leave out stay as they are; each change is a pull request you merge\. Add shards= only to change that default\. Say "explain 1\.1" for the full text of a row\.$/m);
  assert.match(shown.out, /Agents: this line is for you alone\. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line, then stop\..*never show this bank again after they reply\./);
  agentsLast(shown.out);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const pending = new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch);
  assert.ok(pending, 'the bank waits for the owner\'s typed reply');
  assert.deepEqual(Object.keys(pending).sort(), ['at', 'bank_reference', 'epoch', 'repository_id', 'repository_mark', 'root', 'rows'], 'no card state is kept');
});

test('after the table the bank lists what it does by default, then one reply line and its Agents line', async t => {
  const ctx = fixture(t);
  const { out } = await run(ctx, ['setup']);
  const tail = out.slice(out.lastIndexOf('|') + 1).trim().split(/\n\s*\n/);
  assert.equal(tail.length, 3, 'only the rows with nothing to answer, the reply line and the Agents line follow the table');
  // Merge trains, parallel CI shards, the App, the instruction copies and the permissions are no
  // questions: each line says what the answer does by default, or that it is bound.
  assert.equal(tail[0], [
    'Nothing to answer here:',
    '- Set in .github/toolkit-programme.json: evidence store toolkit-test-fixture/store, parent #1, required check validate, merge trains on. To change them, edit that file in a pull request and merge it.',
    '- Parallel CI shards: Not now (Toolkit default) (CI time unknown). CI is under 10 minutes or its time is unknown, so Toolkit adds no shards and checks again at the next refresh. To add them anyway, add shards=yes to your reply; shards=never stops the check.',
    '- Governance App: Not checked. After your answer, Toolkit gives you one line to paste into PowerShell (it refuses to run under an agent, so the App\'s private key never passes through one): press Enter when it asks, then click Create and Install on GitHub. Governance works without it, but its jobs on GitHub need it to open pull requests.',
    '- Toolkit instruction copies: 1 file left (Toolkit default: clean up). Older setups copied the governed rules, playbooks and shims here; the installed Toolkit now gives sessions these rules. Your answer removes them in the working tree, keeping everything of yours, and sets min_toolkit in the programme file; you commit them and merge the one pull request. An answer that turns governance off keeps them.',
    '- Toolkit permissions (Claude Code): Outdated: 2 missing, 1 old. After your answer, Toolkit gives you one command to run yourself that brings Claude Code\'s Toolkit permission lines up to date; it shows what changes, backs the file up and waits for you to press Enter.',
  ].join('\n'));
  assert.doesNotMatch(out, /More on|Status \(nothing to answer\)|The permissions row covers/);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const reference = /Bank reference: (\S+)/.exec(out)[1];
  const explained = await run(ctx, ['setup', '--answers', `${reference}: explain 1.2`]);
  assert.equal(explained.code, 0);
  assert.match(explained.out, /^### 1\.2 Task auto-merge$/m);
  assert.match(explained.out, /^\*\*What this controls:\*\* Whether finished task pull requests merge once their review, checks and testing pass\. It applies only while governance is on\.$/m);
  assert.doesNotMatch(explained.out, /^\| 1\.1 \|/m, 'explain shows one row, never the bank');
  assert.doesNotMatch(explained.out, /\*\*(Verification|Selected):\*\*/, 'explain leaves out what only a filled-in bank needs');
  agentsLast(explained.out);
  assert.ok(new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch), 'the owner\'s next own message still answers the bank');
});

// The owner's own run, 23 Nov: another session's read of GitHub timed out while this bank was being
// built. That read keeps the cached binding and adds refresh_error (refreshBindingCache), so the merge
// trains read that came later saw a stale binding and the bank printed "Off. Bound in the merged
// programme file" for a binding with no merge_train key (on). Here the stale mark lands between the
// bank's reads, the same way.
test('a read that fails while the bank is built never shows as a bound value', async t => {
  const ctx = fixture(t, { quiet: true, taskPrs: { auto_merge: 'after-gates' } });
  const cache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
  const stateDirectory = path.dirname(ctx.registryOptions.registryPath);
  const identity = governance.readIdentity(ctx.repo);
  ctx.cli = { ...QUIET, permissionsChecker: () => {
    cache.writeCache(stateDirectory, { ...cache.readBindingCache(identity, stateDirectory), refresh_error: 'read-timed-out' });
    return QUIET.permissionsChecker();
  } };
  const { code, out } = await run(ctx, ['setup']);
  assert.equal(code, 0, out);
  assert.match(out, /^\| 1\.2 \| Task auto-merge \| On \| A\. Keep current \| B\. Off \|$/m);
  assert.match(out, /^- Set in \.github\/toolkit-programme\.json: evidence store toolkit-test-fixture\/store, parent #1, required check validate, merge trains on\. To change them, edit that file in a pull request and merge it\.$/m);
  assert.doesNotMatch(out, /Merge trains: Off|merge trains off|Bound in the merged programme file/);
});

// When the one read the bank's rows come from is itself stale, the values it shows are what this
// computer last read, and the line says so and why; with no binding read at all it shows none.
test('a stale read says plainly that GitHub could not be read and why; no read shows no bound values', () => {
  const { governanceBankSpecs, renderGovernanceBank } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const merged = { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', parents: [{ issue: 421 }, { issue: 7 }],
    store: { repository: 'toolkit-test-fixture/store' }, required_checks: ['validate', 'gate'], ci_shards: { answer: 'yes' } };
  const state = { state: 'ENABLED', repository: SLUG, root: '/x' };
  const stale = renderGovernanceBank(governanceBankSpecs({ state, merged, train: 'off', mergedRead: { fresh: false, refresh_error: 'read-timed-out' } }));
  assert.match(stale, /^- Set in \.github\/toolkit-programme\.json: evidence store toolkit-test-fixture\/store, parents #421, #7, required checks validate, gate, merge trains off, parallel CI shards yes \(refreshed once a day: explain 1\.1\)\. GitHub could not be read just now \(read-timed-out\), so these are the values this computer last read\. To change them, edit that file in a pull request and merge it\.$/m);
  const fresh = renderGovernanceBank(governanceBankSpecs({ state, merged: { ...merged, required_checks: [], ci_shards: { answer: 'never' } }, train: 'on', mergedRead: { fresh: true, refresh_error: null } }));
  assert.match(fresh, /^- Set in \.github\/toolkit-programme\.json: evidence store toolkit-test-fixture\/store, parents #421, #7, no required checks, merge trains on, parallel CI shards never \(not asked again\)\. To change them, edit that file in a pull request and merge it\.$/m);
  const unread = renderGovernanceBank(governanceBankSpecs({ state, merged: null, mergedRead: { fresh: false, refresh_error: 'read-timed-out' } }));
  assert.match(unread, /^- Programme file: Could not be read\. This computer could not read the merged \.github\/toolkit-programme\.json just now \(read-timed-out\), so what it sets is not shown\. Type toolkit governance again in a moment\.$/m);
  assert.doesNotMatch(unread, /Set in|Merge trains|merge trains/, 'no value is shown for a binding that was not read');
});

test('with nothing left to do the block is one line for the programme file and one short line per item; explain 1.1 has the App removal', async t => {
  const ctx = fixture(t, { quiet: true });
  const { out } = await run(ctx, ['setup']);
  const tail = out.slice(out.lastIndexOf('|') + 1).trim().split(/\n\s*\n/);
  assert.equal(tail[0], [
    'Nothing to answer here:',
    '- Set in .github/toolkit-programme.json: evidence store toolkit-test-fixture/store, parent #1, required check validate, merge trains on. To change them, edit that file in a pull request and merge it.',
    '- Parallel CI shards: Not now (Toolkit default) (CI time unknown). CI is under 10 minutes or its time is unknown, so Toolkit adds no shards and checks again at the next refresh. To add them anyway, add shards=yes to your reply; shards=never stops the check.',
    '- Governance App: Set up. Say "explain 1.1" for how to stop using it.',
    '- Toolkit permissions (Claude Code): Up to date.',
  ].join('\n'));
  assert.doesNotMatch(out, /TOOLKIT_GOVERNANCE_APP|Secrets and variables/, 'the App removal steps wait for explain');
  const reference = /Bank reference: (\S+)/.exec(out)[1];
  const explained = await run(ctx, ['setup', '--answers', `${reference}: explain 1.1`]);
  assert.equal(explained.code, 0);
  assert.match(explained.out, /^### 1\.1 GitHub governance$/m);
  assert.match(explained.out, new RegExp(`^\\*\\*Governance App:\\*\\* To stop using it, delete the ${governanceApp.APP.variable} variable and the ${governanceApp.APP.secret} secret under Settings, Secrets and variables, Actions on GitHub; governance works without it\\.$`, 'm'));
  agentsLast(explained.out);
});

test('a question card that carries bank rows is not Toolkit\'s: it runs, and its taps record nothing', async t => {
  const ctx = fixture(t);
  await run(ctx, ['setup']);
  const input = { questions: [{ question: '1.1 GitHub governance (now: On)', header: 'Governance', multiSelect: false, options: [{ label: 'A. Keep current', description: '' }, { label: 'B. Turn off', description: '' }] }] };
  assert.equal(new gate.ToolGate({ registryOptions: ctx.registryOptions }).decide({ tool_name: 'AskUserQuestion', session_id: SESSION, cwd: ctx.repo, tool_use_id: 'tool-1', tool_input: input }), null);
  const picked = new gate.PromptHold({ registryOptions: ctx.registryOptions, environment: {} }).picked({ cwd: ctx.repo, sessionId: SESSION, toolUseId: 'tool-1', toolResponse: { questions: input.questions, answers: { [input.questions[0].question]: 'B. Turn off' } } });
  assert.equal(picked, null, 'no ticket and no command come back');
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  assert.ok(new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch), 'the bank still waits for the owner\'s typed reply');
});

test('a public repository shows a visibility line in the bank before the answer; a private one does not', () => {
  const { governanceBankSpecs } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const adoptionFor = visibility => ({ repository: SLUG, store: { repository: 'toolkit-test-fixture/TRANSPORT-card', create: true }, found_store: null, store_name: 'TRANSPORT-card', store_choice: false,
    parent: { issue: null, create: true }, checks: [], visibility, unknown: [] });
  const state = { state: 'UNDECIDED', repository: SLUG, root: '/x' };
  const ids = visibility => governanceBankSpecs({ state, adoption: adoptionFor(visibility) }).map(spec => spec.id);
  const shown = governanceBankSpecs({ state, adoption: adoptionFor('public') }).find(spec => spec.id === 'visibility');
  assert.ok(shown, 'public: the line is shown');
  assert.equal(shown.report_only, true, 'it is information, never a question that stops the flow');
  assert.match(shown.recommended_outcome, /names your private evidence store \(its name only/);
  assert.ok(!ids('private').includes('visibility'));
  assert.ok(!ids('unknown').includes('visibility'));
});

// The bank is shown once. The owner's next own message gets a one-use ticket, as the prompt hook
// gives it; `reply` sends that message with it.
function tickets(ctx) { return new BankTickets({ registryOptions: ctx.registryOptions }); }
function epochOf(ctx) { return new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION); }
async function reply(ctx, reference, answer) {
  const ticket = tickets(ctx).issue(SESSION, epochOf(ctx));
  assert.ok(ticket, 'the owner\'s next own message gets a ticket');
  return run(ctx, ['setup', '--answers', `${reference}: ${answer}`, '--ticket', ticket]);
}
const noBank = out => assert.doesNotMatch(out, /Bank reference|^\| 1\.1 \|/m, 'the bank is not shown again');

// Owner decision INT-TK421-1263 (24 Nov): the App setup stays the owner's, as one line to paste into
// PowerShell with nothing to choose; their other steps are the Enters it asks for and Create and Install.
test('an answer that takes the App default gives exactly one PowerShell line for it, with nothing to choose', async t => {
  const ctx = fixture(t, { quiet: true });
  ctx.cli = { ...QUIET, appReader: args => ({ ok: true, value: { total_count: 0, [/\/actions\/(variables|secrets)\?/.exec(args[0])[1]]: [] } }) };
  const shown = await run(ctx, ['setup']);
  assert.match(shown.out, /^- Governance App: Not set up\. After your answer, Toolkit gives you one line to paste into PowerShell /m);
  const answered = await reply(ctx, /Bank reference: (\S+)/.exec(shown.out)[1], KEEP);
  assert.equal(answered.code, 0, answered.out + answered.err);
  assert.match(answered.out, /^Governance App: paste this one line into PowerShell and press Enter\. It saves the App's Client ID and key on toolkit-test-fixture\/card\. It asks for Enter before it opens GitHub and again before it checks the installation; on GitHub you click Create, then Install\. It runs only outside an agent, so the App's private key never passes through one\.$/m);
  const blocks = [...answered.out.matchAll(/^```\n([\s\S]*?)\n```$/gm)].map(match => match[1]);
  assert.deepEqual(blocks, [`node "${path.join(scripts, 'toolkit-governance-app-setup.cjs')}" --repo toolkit-test-fixture/card --store toolkit-test-fixture/store`]);
  assert.doesNotMatch(answered.out, /with gh signed in|<Client ID>|\.pem/);
});
// Keeps both questions as they are.
const KEEP = '1.1=A, 1.2=A';

test('a reply that cannot be used gets one line, never the bank, and the owner\'s next own message still answers it', async t => {
  const ctx = fixture(t, { quiet: true });
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  for (const [answer, line] of [
    ['yes please', /^Governance question bank answer was not read\. Nothing was written\.$/m],
    ['1.12=A', /^This bank has no row 1\.12\. Nothing was written\.$/m],
    // A governed repository is asked two questions, so section 1 ends at 1.2.
    ['1.3=A', /^This bank has no row 1\.3\. Nothing was written\.$/m],
    ['explain 1.12', /^This bank has no row 1\.12\.$/m],
  ]) {
    const wrong = await reply(ctx, reference, answer);
    assert.equal(wrong.code, 0, `${answer}: waiting for the owner is not a failure`);
    assert.match(wrong.out, line, answer);
    assert.match(wrong.out, /^Reply again with all recommended or only your changes, such as 1\.1=B\.$/m);
    assert.equal(wrong.out.match(/only your changes/g).length, 1, `${answer}: the reply instruction is said once`);
    noBank(wrong.out);
    agentsLast(wrong.out);
    assert.match(wrong.out, /post no card, and never show the bank again unless the owner types toolkit governance/);
  }
  const done = await reply(ctx, reference, KEEP);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m);
  assert.doesNotMatch(done.out, /Parallel CI shards/, 'a default that does nothing says nothing');
  noBank(done.out);
  agentsLast(done.out);
  // A used answer keeps the bank open for the owner's next own message (owner test of 19 Nov), with a
  // new one-use ticket; the spent one stays spent.
  assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx))?.bank_reference, reference, 'a used answer leaves the same bank open for the next own message');
  const forged = await run(ctx, ['setup', '--answers', `${reference}: all recommended`, '--ticket', 'f'.repeat(32)]);
  assert.equal(forged.code, 2);
  assert.match(forged.err, /^No live reply ticket from the owner.*The owner can type toolkit governance to see the bank again\./m);
  assert.doesNotMatch(forged.err, /Show the bank/);
  agentsLast(forged.err);
});

test('a reply after the state changed names only the changed rows, and the owner\'s next own message answers the new state', async t => {
  const ctx = fixture(t, { quiet: true });
  const binding = path.join(ctx.repo, '.github', 'toolkit-programme.json');
  const merge = text => { fs.writeFileSync(binding, text); recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath, text }); };
  // Task auto-merge turning on moves no number, so the reply names that row alone.
  let reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  merge(fs.readFileSync(binding, 'utf8').replace(/\n\}\n$/, ',\n  "task_prs": { "auto_merge": "after-gates" }\n}\n'));
  const changed = await reply(ctx, reference, KEEP);
  assert.equal(changed.code, 0, changed.err);
  assert.match(changed.out, /^The governance state changed since that bank was shown, so the answer was not used and nothing was written\.$/m);
  assert.deepEqual(changed.out.match(/^.* changed: now .*$/gm), ['1.2 Task auto-merge changed: now On, recommended A. Keep current.']);
  noBank(changed.out);
  agentsLast(changed.out);
  const current = JSON.parse((await run(ctx, ['setup', '--json'])).out).bank_reference;
  const done = await reply(ctx, current, KEEP);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m, 'the next own message answers the bank as it is now');
  // A default the answer applies is part of what was shown: a status row that changed stops the answer too.
  reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  merge(fs.readFileSync(binding, 'utf8').replace(/\n\}\n$/, ',\n  "ci_shards": { "answer": "never" }\n}\n'));
  const status = await reply(ctx, reference, KEEP);
  assert.equal(status.code, 0, status.err);
  assert.deepEqual(status.out.match(/^.* changed: now .*$/gm), ['Parallel CI shards changed: now Never ask, with nothing to answer.']);
  noBank(status.out);
  // A row that appears since (instruction copies left again) means only a new bank can be answered.
  reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  fs.writeFileSync(path.join(ctx.repo, 'AGENTS.md'), ctx.copy);
  const moved = await reply(ctx, reference, KEEP);
  assert.equal(moved.code, 0, moved.err);
  assert.match(moved.out, /^The governance bank changed since it was shown \(rows were added, taken away or numbered differently\), so the answer was not used and nothing was written\. Type toolkit governance to see the new bank\.$/m);
  assert.doesNotMatch(moved.out, / changed: now /);
  assert.ok(fs.existsSync(path.join(ctx.repo, 'AGENTS.md')), 'nothing was cleaned up');
  noBank(moved.out);
});

test('re-arming keeps the run, the repository mark and the repository of the bank the owner was shown', async t => {
  const ctx = fixture(t);
  await run(ctx, ['setup']);
  const shown = tickets(ctx).pendingFor(SESSION, epochOf(ctx));
  const ticket = tickets(ctx).issue(SESSION, epochOf(ctx));
  const entry = tickets(ctx).take(ticket, SESSION, epochOf(ctx));
  assert.equal(entry.repository_mark, shown.repository_mark, 'the ticket carries the mark the bank was shown under');
  assert.ok(tickets(ctx).rearm(SESSION, entry, { bankReference: entry.bank_reference, rows: entry.rows }));
  const again = tickets(ctx).pendingFor(SESSION, epochOf(ctx));
  for (const key of ['epoch', 'repository_mark', 'repository_id', 'root', 'bank_reference', 'rows']) assert.deepEqual(again[key], shown[key], key);
  assert.equal(tickets(ctx).rearm(SESSION, null, { bankReference: 'x', rows: {} }), false, 'nothing is noted without a spent ticket entry');
});

test('questions are numbered without gaps, status rows have none, and an answer applies the Toolkit defaults it showed', () => {
  const { governanceBankSpecs, renderGovernanceBank, parseBankAnswer, rowDigests, changedRows } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const state = { state: 'UNDECIDED', repository: SLUG, root: '/x' };
  const adoption = { repository: SLUG, store: { repository: 'toolkit-test-fixture/TRANSPORT-card', create: true }, found_store: null,
    store_name: 'TRANSPORT-card', parent: { issue: null, create: true }, checks: [], visibility: 'private', unknown: [] };
  const refs = specs => Object.fromEntries(specs.map(spec => [spec.id, spec.presentation.question_ref]));
  // Not decided yet: the answer itself turns governance on, so task auto-merge is the one question.
  const undecided = governanceBankSpecs({ state, adoption });
  assert.deepEqual(Object.entries(refs(undecided)).filter(([, ref]) => ref), [['task-auto-merge', '1.1']]);
  for (const id of ['governance', 'evidence-store', 'parent-issue', 'required-checks', 'governance-app', 'permission-blocks']) assert.equal(refs(undecided)[id], '', `${id} is a status row`);
  const shown = renderGovernanceBank(undecided);
  assert.match(shown, /^# Toolkit governance choices - 1 question across 1 section$/m);
  assert.match(shown, /^- Evidence store: TRANSPORT-card\. None yet: Toolkit creates the private GitHub repository toolkit-test-fixture\/TRANSPORT-card when governance turns on, for programme records and evidence\. To use another private repository of yours, add store=<owner\/name> to your reply\.$/m);
  assert.doesNotMatch(shown, /Status \(nothing to answer\)|Already set|\| 1\.2 \|/);
  assert.equal(parseBankAnswer('all recommended', undecided, { requireBankReference: false }).governance, 'on');
  assert.equal(parseBankAnswer('1.1=A', undecided, { requireBankReference: false }).governance, 'on', 'any answer to this bank turns governance on');
  assert.deepEqual(parseBankAnswer('no store', undecided, { requireBankReference: false }), { noStore: true });
  // Governed: governance and task auto-merge are the two questions; the copies are a status row.
  const governed = { state: 'ENABLED', repository: SLUG, root: '/x' };
  const withCopies = governanceBankSpecs({ state: governed, copies: { files: 2 } });
  assert.deepEqual(withCopies.filter(spec => !spec.report_only).map(spec => `${spec.presentation.question_ref} ${spec.id}`), ['1.1 governance', '1.2 task-auto-merge']);
  assert.equal(refs(withCopies)['instruction-copies'], '');
  // Rows left out stay as they are; the defaults the bank showed (clean up the copies, give the App
  // and permissions commands) come with any answer that keeps governance on.
  assert.deepEqual(parseBankAnswer('1.2=B', withCopies, { requireBankReference: false }),
    { governance: 'keep', taskAutoMerge: 'on', store: null, governanceApp: 'setup', permissionBlocks: 'keep', instructionCopies: 'clean' });
  assert.equal(parseBankAnswer('1.1=B', withCopies, { requireBankReference: false }).instructionCopies, 'keep', 'turning off keeps the copies');
  assert.equal(parseBankAnswer('1.1=A', governanceBankSpecs({ state: governed, copies: { files: 2, held: 'a cloud workflow copy is older', step: 'Refresh it first.' } }), { requireBankReference: false }).instructionCopies, undefined, 'held: nothing is cleaned');
  // A reply to a bank whose numbers moved is never applied as it was.
  const before = rowDigests(withCopies);
  assert.equal(changedRows(before, governanceBankSpecs({ state: governed, copies: { files: 2 } })).length, 0, 'the same bank changed nothing');
  assert.equal(changedRows(rowDigests(undecided), withCopies), null);
});

test('in the owner\'s own terminal a reply that cannot be used gets one line and the question again, without the bank', async t => {
  const ctx = fixture(t, { quiet: true });
  const result = await run(ctx, ['setup'], { interactive: true, answers: ['1.3=A', 'explain 1.2', KEEP] });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out.split('Bank reference:').length, 2, 'the bank is printed once');
  assert.match(result.out, /^This bank has no row 1\.3\. Nothing was written\. Reply again with all recommended or only your changes, such as 1\.1=B\.$/m);
  assert.match(result.out, /^### 1\.2 Task auto-merge$/m);
  assert.match(result.out, /^Nothing changed: every answer keeps things as they are\.$/m);
  const gaveUp = await run(ctx, ['setup'], { interactive: true, answers: Array(10).fill('maybe') });
  assert.equal(gaveUp.code, 1, 'it stops after a few unusable replies, with nothing written');
});

test('commands name the managed Toolkit checkout when this computer records one, and the gate accepts exactly that path too', t => {
  const { managedScript } = require(path.join(scripts, 'toolkit-user-state.cjs'));
  const { bankTicketCommand } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const commands = require(path.join(scripts, 'toolkit-commands.cjs'));
  // The long path: a Windows runner's temp folder can be an 8.3 short name, whose ~ no command line carries.
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-managed-home-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const own = path.join(scripts, 'toolkit-governance.cjs');
  assert.equal(managedScript('toolkit-governance.cjs', { userHome: home }), own, 'no recorded checkout: this copy');
  const checkout = path.join(home, 'GitHub', 'ai-agent-toolkit');
  const state = path.join(home, '.ai-agent-toolkit', 'current', 'state.json');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, JSON.stringify({ repo_path: checkout }));
  assert.equal(managedScript('toolkit-governance.cjs', { userHome: home }), own, 'a recorded folder without the script: this copy');
  fs.mkdirSync(path.join(checkout, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'repo', 'scripts', 'toolkit-governance.cjs'), '');
  // Byte for byte the path toolkit permissions pins its lines to: forward slashes on every system.
  const { safePath } = require(path.join(scripts, 'toolkit-permissions.cjs'));
  const managed = `${safePath(checkout, process.platform)}/repo/scripts/toolkit-governance.cjs`;
  assert.doesNotMatch(managed, /\\/);
  assert.equal(managedScript('toolkit-governance.cjs', { userHome: home }), managed);
  fs.writeFileSync(state, JSON.stringify({ repo_path: path.join(home, '$x') }));
  assert.equal(managedScript('toolkit-governance.cjs', { userHome: home }), own, 'a path a shell could expand is never named');
  fs.writeFileSync(state, JSON.stringify({ repo_path: checkout }));
  // governanceCommand, the bank guide and the ticket command read this computer's home.
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  assert.equal(governance.governanceCommand('migrate'), `node "${managed}" migrate`);
  assert.ok(commands.bankGuide().includes(`node "${managed}" setup`));
  assert.match(commands.bankGuide(), /The bank is shown once: after their reply, show only what Toolkit prints, and never show the bank again unless they type toolkit governance\./);
  const live = { peek: () => ({}) };
  const command = scriptPath => `node "${scriptPath}" setup --answers "ABCD-EFGH-JKMN-PQRS: all recommended" --ticket ${'a'.repeat(32)}`;
  for (const scriptPath of [own, managed]) assert.equal(bankTicketCommand(command(scriptPath), SESSION, live), true, scriptPath);
  assert.equal(bankTicketCommand(command(path.join(home, 'elsewhere', 'toolkit-governance.cjs')), SESSION, live), false, 'any other copy is refused');
});

// Owner test of 19 Nov: after 1.4=A, "explain 1.4" was refused for want of a ticket, and 1.9=A
// named a spent ticket next to the missing row. Explain is read-only and needs no ticket, before or
// after an answer; the bank stays open for the owner's next own message after an answer, so an
// unknown row then gets only its own line; an answer still needs the one-use ticket.
test('explain needs no ticket before or after an answer, and an unknown row after an answer says only that', async t => {
  const ctx = fixture(t, { quiet: true });
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  const shown = tickets(ctx).pendingFor(SESSION, epochOf(ctx));
  const owed = out => out.trim().split(/\n\s*\n/).slice(0, -1).join('\n\n');
  const explain = async (answer, line) => {
    const result = await run(ctx, ['setup', '--answers', answer]);
    assert.equal(result.code, 0, `${answer}: ${result.err}`);
    assert.match(result.out, line, answer);
    assert.doesNotMatch(owed(result.out), /ticket|used|spent|Reply again/i, `${answer}: no ticket line`);
    noBank(result.out);
    agentsLast(result.out);
  };
  await explain(`${reference}: explain 1.2`, /^### 1\.2 Task auto-merge$/m);
  assert.deepEqual(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), shown, 'an explain leaves the shown bank as it was');
  const done = await reply(ctx, reference, KEEP);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m);
  await explain(`${reference}: explain 1.2`, /^### 1\.2 Task auto-merge$/m);
  await explain('explain 1.1', /^### 1\.1 /m);
  await explain(`${reference}: explain 1.9`, /^This bank has no row 1\.9\.$/m);
  const unknown = await reply(ctx, reference, '1.9=A');
  assert.equal(unknown.code, 0, unknown.err);
  assert.match(unknown.out, /^This bank has no row 1\.9\. Nothing was written\.$/m);
  assert.doesNotMatch(owed(unknown.out), /ticket|used|spent/i, 'an unknown row names no ticket');
  noBank(unknown.out);
  // Anything but an explain still needs the owner's live ticket, and writes nothing without it.
  const bare = await run(ctx, ['setup', '--answers', `${reference}: 1.2=A`]);
  assert.equal(bare.code, 2);
  assert.doesNotMatch(bare.out, /Nothing changed|### /);
});

// #1363 F1-L2 and UAT-L5: after an answer the bank used, a bare "ok" read as a lost answer ("was not
// read ... Reply again"), and the next reply was framed as answering a bank still open.
test('after a used answer, a bare ok is told the answer was used, and the next reply is not framed as still open', async t => {
  const ctx = fixture(t, { quiet: true });
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  const before = await reply(ctx, reference, 'ok');
  assert.match(before.out, /^Governance question bank answer was not read\. Nothing was written\.$/m, 'before any answer, an unread reply still says so');
  const done = await reply(ctx, reference, KEEP);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m);
  const noted = tickets(ctx).pendingFor(SESSION, epochOf(ctx));
  assert.equal(noted.used, true, 'the used answer is noted with the open bank');
  const context = require(path.join(scripts, "toolkit-governance-bank.cjs")).bankTicketContext(noted, "a".repeat(32));
  assert.match(context, /since their answer to governance bank \S+ was used; that answer is done, not open\./);
  assert.doesNotMatch(context, /was shown or Toolkit asked them to reply again/);
  for (const ack of ['ok', 'thanks']) {
    const after = await reply(ctx, reference, ack);
    assert.equal(after.code, 0, after.err);
    assert.match(after.out, /^Your earlier answer to this bank was already used, and this reply changes nothing\. Nothing more was written\.$/m, ack);
    assert.match(after.out, /^To change a row, reply with only that change, such as 1\.1=B\.$/m);
    assert.doesNotMatch(after.out, /was not read|Reply again/, ack);
    noBank(after.out);
    agentsLast(after.out);
    assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx)).used, true, `${ack}: still noted as used`);
  }
  // A real error after a used answer is still named.
  const unknown = await reply(ctx, reference, '1.9=A');
  assert.match(unknown.out, /^This bank has no row 1\.9\. Nothing was written\.$/m);
});

// G2 of 19 Nov: an answer that opens the shards pull request turns that row into a status row, so
// every later question moves up one number. The ticketless explain then printed another row under
// the number the owner saw (explain 1.4 gave the next row, and a row still on screen did not exist).
// It reads the bank the owner was shown: a bank numbered differently is named as changed, never
// explained by its new numbers; the ticket path refuses the next answer the same way.
test('explain after an answer that changes the bank\'s rows names the change, never another row', async t => {
  // The default answer cleans up the instruction copies, so their status row goes: the bank the owner
  // was shown no longer exists, and explain names that, never a row by the new bank.
  const ctx = fixture(t);
  const shown = await run(ctx, ['setup']);
  const reference = /Bank reference: (\S+)/.exec(shown.out)[1];
  assert.match(shown.out, /^- Toolkit instruction copies: 1 file left/m);
  const answered = await reply(ctx, reference, KEEP);
  assert.equal(answered.code, 0, answered.err);
  assert.ok(!fs.existsSync(path.join(ctx.repo, 'AGENTS.md')), 'the answer cleaned up the copy');
  const moved = JSON.parse((await run(ctx, ['setup', '--json'])).out);
  assert.notEqual(moved.bank_reference, reference, 'the bank has other rows now');
  for (const row of ['1.1', '1.2']) {
    const result = await run(ctx, ['setup', '--answers', `${reference}: explain ${row}`]);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /^The governance bank changed since it was shown \(rows were added, taken away or numbered differently\), so row \d\.\d as shown is not explained here and nothing was written\. Type toolkit governance to see the new bank\.$/m, `explain ${row}`);
    assert.doesNotMatch(result.out, /^### |This bank has no row/m, `explain ${row} prints no row by the new bank`);
    agentsLast(result.out);
    // Without the reference in the command, the session's noted bank is the one the owner saw.
    const bare = await run(ctx, ['setup', '--answers', `explain ${row}`]);
    assert.doesNotMatch(bare.out, /^### |This bank has no row/m, `bare explain ${row}`);
    assert.match(bare.out, /^The governance bank changed since it was shown/m);
  }
  assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx))?.bank_reference, reference, 'explain spends nothing: the shown bank stays noted');
});

// When rows changed but every number still means the same row, explain names the changed rows first,
// as the ticket path does, then the row.
test('explain after a row changed in place names the change, then the row', async t => {
  const ctx = fixture(t);
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  ctx.cli = { permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }) };
  const result = await run(ctx, ['setup', '--answers', `${reference}: explain 1.2`]);
  assert.equal(result.code, 0, result.err);
  const [first, changed] = result.out.trim().split('\n');
  assert.equal(first, 'The governance state changed since that bank was shown; the numbers still mean the same rows.');
  assert.equal(changed, 'Toolkit permissions (Claude Code) changed: now Up to date, with nothing to answer.');
  assert.match(result.out, /^### 1\.2 Task auto-merge$/m);
  agentsLast(result.out);
});

// #1373: the owner typed `toolkit governance` while a bank was open in the session (shown, or kept
// open after an answer) and got a status summary instead of the bank. The prompt hook read the
// phrase as a possible bank reply: the agent got a one-use ticket, was told to send anything unclear
// as typed and never to show the bank again. Typing the phrase asks for the bank afresh: the hook adds
// nothing (the toolkit-setup skill shows the bank) and the old bank closes.
test('typing toolkit governance while a bank is open asks for the bank afresh, never a reply ticket', async t => {
  const hook = require(path.join(scripts, 'toolkit-governance-hook.cjs'));
  const ctx = fixture(t, { quiet: true });
  const prompt = text => hook.respond('UserPromptSubmit', { cwd: ctx.repo, prompt: text, session_id: SESSION }, {
    registryOptions: ctx.registryOptions, environment: { [gate.HOST_SESSION_VARIABLE]: SESSION }, mergeHold: { recordPromptNote: () => ({ count: 0, note: '' }) },
  }).hookSpecificOutput?.additionalContext || '';
  for (const phrase of ['toolkit governance', 'Governance setup.', 'refresh governance']) {
    const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
    assert.ok(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), 'the bank is open');
    const context = prompt(phrase);
    assert.equal(context, '', `${phrase}: no ticket and no line`);
    assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), null, `${phrase}: bank ${reference} no longer waits for a reply`);
  }
  // After an answer the bank stays open for the next own message; the phrase still asks afresh.
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  assert.match((await reply(ctx, reference, KEEP)).out, /^Nothing changed/m);
  assert.equal(prompt('toolkit governance'), '');
  // Any other own message after a bank still gets its ticket.
  await run(ctx, ['setup']);
  assert.match(prompt('1.2=A'), /--ticket [0-9a-f]{32}/);
});

// #1373: a fresh session, no bank open yet. `setup` first reads the merged binding again; one failed
// read marked it unread, and setup printed no bank but a pointer to `status`, so the owner got a status
// summary. Now setup reads once more with a longer limit and shows the bank when that read works; when
// it fails too, the owner gets one line to type the command again and the agent is told to show no
// status. An answer still writes nothing on an unread binding.
// Owner test 2, 23 Nov: GitHub could not be read in a repository with no decision yet, so the state
// was UNAVAILABLE, and the bank printed "GitHub governance: undefined" with a turn-on row for a state
// it could not know. It reads once more, then gives the same line to type it again as an unread binding.
test('a repository whose governance cannot be read gets one more read, then the line to type it again, never a bank', async t => {
  const cache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
  const ctx = fixture(t);
  const stateDir = path.dirname(ctx.registryOptions.registryPath);
  const identity = governance.readIdentity(ctx.repo);
  const unread = { ...cache.readBindingCache(identity, stateDir), status: 'absent', text: null, bytes_sha256: null, refresh_error: 'read-timed-out' };
  let reads = 0;
  ctx.cli = { refresh: () => { reads += 1; cache.writeCache(stateDir, unread); return { refreshed: false, error: 'read-timed-out' }; } };
  ctx.cli.refresh();
  reads = 0;
  assert.equal(governance.governanceState(ctx.repo, ctx.registryOptions).state, 'UNAVAILABLE');
  const shown = await run(ctx, ['setup']);
  assert.equal(reads, 2, 'one more read after the failed one');
  assert.equal(shown.code, 1);
  assert.doesNotMatch(shown.out, /undefined|Bank reference|Your answer turns it on/);
  assert.match(shown.out, /^The governance question bank could not be shown because GitHub could not be read just now.*Type toolkit governance again in a moment\.$/m);
  agentsLast(shown.out);
});

test('a fresh session whose binding read fails just now gets the bank or a line to type it again, never a status', async t => {
  const cache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
  for (const recovers of [true, false]) {
    const ctx = fixture(t);
    const stateDir = path.dirname(ctx.registryOptions.registryPath);
    const identity = governance.readIdentity(ctx.repo);
    const good = cache.readBindingCache(identity, stateDir);
    const budgets = [];
    ctx.cli = {
      refresh: (cwd, budget) => {
        budgets.push(budget);
        cache.writeCache(stateDir, budgets.length > 1 && recovers ? { ...good, fetched_at: new Date().toISOString() } : { ...good, refresh_error: 'timeout' });
        return budgets.length > 1 && recovers ? { refreshed: true } : { refreshed: false, error: 'timeout' };
      },
    };
    assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), null, 'no bank is open yet');
    const shown = await run(ctx, ['setup']);
    assert.equal(budgets.length, 2, 'one more read after the failed one');
    assert.ok(budgets[1]?.timeout > cache.GIT_TIMEOUT_MS, 'the second read has a longer limit');
    assert.doesNotMatch(shown.out + shown.err, /toolkit-governance\.cjs"? (?:status|check)|online first/, 'no status route');
    if (recovers) {
      assert.equal(shown.code, 0);
      assert.match(shown.out, /Bank reference: \S+/, 'the bank once the read works');
      agentsLast(shown.out);
      continue;
    }
    assert.equal(shown.code, 1);
    assert.doesNotMatch(shown.out, /Bank reference|^\| 1\.1 \|/m, 'no bank from an unread binding');
    assert.match(shown.out, /^The governance question bank could not be shown because GitHub could not be read just now.*Type toolkit governance again in a moment\.$/m);
    assert.match(shown.out, /Run no other governance command, and never show a status, check or summary in place of the bank\./);
    agentsLast(shown.out);
    assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), null, 'nothing waits for a reply');
    // The answer step keeps its refusal, before any ticket is taken: nothing is written from an unread binding.
    const answered = await run(ctx, ['setup', '--answers', 'ABCD-EFGH-JKMN-PQRS: 1.4=A', '--ticket', 'a'.repeat(32)]);
    assert.equal(answered.code, 1);
    assert.match(answered.out, /^Nothing changed, and this answer was not used: GitHub could not be read just now/m);
    assert.doesNotMatch(answered.out, /toolkit-governance\.cjs"? status/);
  }
});

// #1381 L3 and L4: the unread line always said "just now ... in a moment", even for a cause a retry
// cannot fix, and a read-only explain was told its "answer was not used".
test('an unread bank names a lasting cause, and a read-only explain is not told an answer was unused', async t => {
  const cache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
  for (const [error, lasting] of [['remote-redirected', true], ['hooks-unguarded', true], ['cache-unwritable', true], ['read-timed-out', false]]) {
    const ctx = fixture(t);
    const stateDir = path.dirname(ctx.registryOptions.registryPath);
    const good = cache.readBindingCache(governance.readIdentity(ctx.repo), stateDir);
    ctx.cli = { refresh: () => { cache.writeCache(stateDir, { ...good, refresh_error: error }); return { refreshed: false, error }; } };
    const shown = await run(ctx, ['setup']);
    assert.equal(shown.code, 1, error);
    if (lasting) {
      assert.match(shown.out, new RegExp(`^The governance question bank could not be shown because the settings merged for this repository could not be read: ${cache.refreshReason(error).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Nothing changed\\. This does not clear on its own: fix that, then type toolkit governance again\\.$`, 'm'), error);
      assert.doesNotMatch(shown.out, /in a moment/, error);
    } else assert.match(shown.out, /^The governance question bank could not be shown because GitHub could not be read just now.*in a moment\.$/m, error);
    agentsLast(shown.out);
    for (const explain of ['explain 1.1', 'ABCD-EFGH-JKMN-PQRS: explain 1.2']) {
      const read = await run(ctx, ['setup', '--answers', explain]);
      assert.equal(read.code, 1, `${error} ${explain}`);
      assert.match(read.out, /^This row cannot be explained yet: GitHub could not be read just now/m, explain);
      assert.doesNotMatch(read.out, /answer was not used/, explain);
    }
  }
});
