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
const SESSION = 'session-card-1';
const SLUG = 'toolkit-test-fixture/card';

function fixture(t) {
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
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text);
  recordMerged(repo, { registryPath, text });
  const registryOptions = { registryPath, testOnly: true };
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repo, registryOptions).repository_id);
  return { repo, registryOptions };
}

async function run(ctx, argv, { interactive = false, answers = [] } = {}) {
  let out = ''; let err = '';
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions, ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 2, stale: 1, update: 'node fixture-apply.cjs --apply', remove: 'node fixture-apply.cjs --remove' }),
    environment: { TOOLKIT_HOST_SESSION: SESSION },
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

test('the bank is one typed list with every row, answered in one line, and names no card', async t => {
  const ctx = fixture(t);
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, 'a shown bank is not a failure');
  assert.doesNotMatch(shown.out, /```|AskUserQuestion|\{"questions"|question card|tap/i);
  for (const row of ['1.1', '1.2', '1.3', '1.4', '2.1']) assert.match(shown.out, new RegExp(`^\\| ${row.replace('.', '\\.')} \\|`, 'm'), `row ${row} is in the one list`);
  assert.match(shown.out, /^Reply all recommended, or only your changes such as 1\.2=B\. Rows you leave out stay as they are; each change is a pull request you merge\. Say "explain 1\.4" for the full text of a row\.$/m);
  assert.match(shown.out, /Agents: this line is for you alone\. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line, then stop\..*never show this bank again after they reply\./);
  agentsLast(shown.out);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const pending = new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch);
  assert.ok(pending, 'the bank waits for the owner\'s typed reply');
  assert.deepEqual(Object.keys(pending).sort(), ['at', 'bank_reference', 'epoch', 'repository_id', 'repository_mark', 'root', 'rows'], 'no card state is kept');
});

test('after the table the bank has one reply line and its Agents line; the shards details are in explain 1.4', async t => {
  const ctx = fixture(t);
  const { out } = await run(ctx, ['setup']);
  const tail = out.slice(out.lastIndexOf('|') + 1).trim().split(/\n\s*\n/);
  assert.equal(tail.length, 3, 'only the rows with nothing to answer, the reply line and the Agents line follow the table');
  // Rows with nothing to answer are not in the table: they are listed as already set, with how to change each.
  assert.equal(tail[0], [
    'Already set, nothing to answer here:',
    '- Evidence store: toolkit-test-fixture/store. Bound in the merged programme file.',
    '- Parent issue: #1. Bound in the merged programme file.',
    '- Required checks: validate. Bound in the merged programme file.',
    'To change anything bound in the merged programme file, edit .github/toolkit-programme.json in a pull request and merge it.',
  ].join('\n'));
  assert.doesNotMatch(out, /^\| \d\.\d+ \| (Evidence store|Parent issue|Required checks) \|/m);
  assert.match(out, /\| 1\.4 \| Parallel CI shards \| Not asked yet \(CI time unknown\) \|/);
  assert.doesNotMatch(out, /1\.4 asks|More on 1\.4|Status \(nothing to answer\)|The permissions row covers/);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const reference = /Bank reference: (\S+)/.exec(out)[1];
  const ticket = new BankTickets({ registryOptions: ctx.registryOptions }).issue(SESSION, epoch);
  const explained = await run(ctx, ['setup', '--answers', `${reference}: explain 1.4`, '--ticket', ticket]);
  assert.equal(explained.code, 0);
  assert.match(explained.out, /^### 1\.4 Parallel CI shards$/m);
  assert.match(explained.out, /^\*\*What this controls:\*\* Run tests in parallel CI jobs so they finish faster\? It uses about the same CI minutes\.$/m);
  assert.match(explained.out, /^\*\*More:\*\* Yes adds a first shard list .*Yes is recommended when the last green CI run took 10 minutes or more\. Minutes: unknown, because no green CI run could be read\. Each shard adds a minute or two of setup, which a private repository pays for\.$/m);
  assert.doesNotMatch(explained.out, /^\| 1\.1 \|/m, 'explain shows one row, never the bank');
  assert.doesNotMatch(explained.out, /\*\*(Verification|Selected):\*\*/, 'explain leaves out what only a filled-in bank needs');
  agentsLast(explained.out);
  assert.ok(new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch), 'the owner\'s next own message still answers the bank');
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
// Leaves the permissions row (recommended Update in this fixture) as it is.
const KEEP = '1.6=A, 2.1=A';

test('a reply that cannot be used gets one line, never the bank, and the owner\'s next own message still answers it', async t => {
  const ctx = fixture(t);
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  for (const [answer, line] of [
    ['yes please', /^Governance question bank answer was not read\. Nothing was written\.$/m],
    ['1.12=A', /^This bank has no row 1\.12\. Nothing was written\.$/m],
    // The evidence store is already set here, so it is no question and has no number.
    ['1.5=A', /^This bank has no row 1\.5\. Nothing was written\.$/m],
    ['explain 1.12', /^This bank has no row 1\.12\.$/m],
  ]) {
    const wrong = await reply(ctx, reference, answer);
    assert.equal(wrong.code, 0, `${answer}: waiting for the owner is not a failure`);
    assert.match(wrong.out, line, answer);
    assert.match(wrong.out, /^Reply again with all recommended or only your changes, such as 1\.2=B\.$/m);
    assert.equal(wrong.out.match(/only your changes/g).length, 1, `${answer}: the reply instruction is said once`);
    noBank(wrong.out);
    agentsLast(wrong.out);
    assert.match(wrong.out, /post no card, and never show the bank again unless the owner types toolkit governance/);
  }
  const done = await reply(ctx, reference, KEEP);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m);
  assert.doesNotMatch(done.out, /Parallel CI shards/, 'a row left out says nothing');
  noBank(done.out);
  agentsLast(done.out);
  assert.equal(tickets(ctx).issue(SESSION, epochOf(ctx)), null, 'a used answer leaves nothing open');
  const forged = await run(ctx, ['setup', '--answers', `${reference}: all recommended`, '--ticket', 'f'.repeat(32)]);
  assert.equal(forged.code, 2);
  assert.match(forged.err, /^No live reply ticket from the owner.*The owner can type toolkit governance to see the bank again\./m);
  assert.doesNotMatch(forged.err, /Show the bank/);
  agentsLast(forged.err);
});

test('a reply after the state changed names only the changed rows, and the owner\'s next own message answers the new state', async t => {
  const ctx = fixture(t);
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  const binding = path.join(ctx.repo, '.github', 'toolkit-programme.json');
  const text = fs.readFileSync(binding, 'utf8').replace(/\n\}\n$/, ',\n  "ci_shards": { "answer": "never" }\n}\n');
  fs.writeFileSync(binding, text);
  recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath, text });
  const changed = await reply(ctx, reference, KEEP);
  assert.equal(changed.code, 0, changed.err);
  assert.match(changed.out, /^The governance state changed since that bank was shown, so the answer was not used and nothing was written\.$/m);
  assert.deepEqual(changed.out.match(/^.* changed: now .*$/gm), ['Parallel CI shards changed: now Never ask, with nothing to answer.']);
  noBank(changed.out);
  agentsLast(changed.out);
  const current = JSON.parse((await run(ctx, ['setup', '--json'])).out).bank_reference;
  const done = await reply(ctx, current, KEEP);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m, 'the next own message answers the bank as it is now');
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

test('questions keep their numbers whichever questions are asked, status rows have none, and rows left out stay as they are', () => {
  const { governanceBankSpecs, renderGovernanceBank, parseBankAnswer } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const state = { state: 'UNDECIDED', repository: SLUG, root: '/x' };
  const adoption = storeChoice => ({ repository: SLUG, store: { repository: 'toolkit-test-fixture/TRANSPORT-card', create: !storeChoice }, found_store: storeChoice ? 'toolkit-test-fixture/evidence' : null,
    store_name: 'TRANSPORT-card', store_choice: storeChoice, parent: { issue: null, create: true }, checks: [], visibility: 'private', unknown: [] });
  const refs = specs => Object.fromEntries(specs.map(spec => [spec.id, spec.presentation.question_ref]));
  const asQuestion = refs(governanceBankSpecs({ state, adoption: adoption(true) }));
  const asStatus = refs(governanceBankSpecs({ state, adoption: adoption(false) }));
  assert.equal(asQuestion['evidence-store'], '1.5');
  assert.equal(asStatus['evidence-store'], '', 'a status row has no number');
  assert.equal(asQuestion['governance-app'], '1.6');
  assert.equal(asStatus['governance-app'], '1.6', 'the evidence store turning into a status row moves no number');
  // A store found for a new repository is reused by default: Keep current is recommended, and a new
  // store is only the other choice.
  const store = governanceBankSpecs({ state, adoption: adoption(true) }).find(spec => spec.id === 'evidence-store');
  assert.equal(store.recommended, 'keep');
  assert.equal(store.presentation.recommended_choice_ref, 'A');
  assert.deepEqual(store.choices.map(choice => `${choice.presentation_ref}. ${choice.label}`), ['A. Keep current', 'B. Create a new private store']);
  const shown = renderGovernanceBank(governanceBankSpecs({ state, adoption: adoption(false) }));
  assert.match(shown, /^# Toolkit governance choices - 5 questions across 2 sections$/m);
  assert.match(shown, /^Nothing to answer here:\n- Evidence store: None yet\. Toolkit creates a private TRANSPORT-card when governance turns on\.$/m);
  assert.doesNotMatch(shown, /Status \(nothing to answer\)|Already set|\| 1\.5 \|/);
  // The instruction copies question is 1.7 in a governed repository; held, it is a status row.
  const governed = { state: 'ENABLED', repository: SLUG, root: '/x' };
  assert.deepEqual(Object.values(refs(governanceBankSpecs({ state: governed, copies: { files: 2 } }))), ['1.1', '1.2', '1.3', '1.6', '1.7', '2.1']);
  assert.deepEqual(Object.values(refs(governanceBankSpecs({ state: governed, copies: { files: 2, held: 'a cloud workflow copy is older' } }))), ['1.1', '1.2', '1.3', '1.6', '', '2.1']);
  const chosen = parseBankAnswer('1.7=B', governanceBankSpecs({ state: governed, copies: { files: 2 } }), { requireBankReference: false });
  assert.equal(chosen.instructionCopies, 'clean');
  assert.equal(chosen.governance, 'keep');
  // A reply naming some rows changes only those: here turning on is recommended, yet 1.6=A leaves
  // governance as it is. Only all recommended takes every recommendation.
  const undecided = governanceBankSpecs({ state, adoption: adoption(true) });
  assert.equal(undecided.find(spec => spec.id === 'governance').recommended, 'on');
  assert.deepEqual(parseBankAnswer('1.6=A', undecided, { requireBankReference: false }), { governance: 'keep', taskAutoMerge: 'keep', mergeTrain: 'keep', governanceApp: 'keep', permissionBlocks: 'keep', evidenceStore: 'keep' });
  assert.equal(parseBankAnswer('all recommended', undecided, { requireBankReference: false }).governance, 'on');
});

test('in the owner\'s own terminal a reply that cannot be used gets one line and the question again, without the bank', async t => {
  const ctx = fixture(t);
  const result = await run(ctx, ['setup'], { interactive: true, answers: ['1.5=A', 'explain 1.2', KEEP] });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out.split('Bank reference:').length, 2, 'the bank is printed once');
  assert.match(result.out, /^This bank has no row 1\.5\. Nothing was written\. Reply again with all recommended or only your changes, such as 1\.2=B\.$/m);
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
