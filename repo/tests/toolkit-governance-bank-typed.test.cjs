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
const KEEP = '1.5=A, 2.1=A';

test('a reply that cannot be used gets one line, never the bank, and the owner\'s next own message still answers it', async t => {
  const ctx = fixture(t);
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  for (const [answer, line] of [
    ['yes please', /^Governance question bank answer was not read\. Nothing was written\.$/m],
    ['1.12=A', /^This bank has no row 1\.12\. Nothing was written\.$/m],
    // The evidence store is already set here, so it is no question and has no number: the six
    // questions of section 1 end at 1.6.
    ['1.7=A', /^This bank has no row 1\.7\. Nothing was written\.$/m],
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
  const ctx = fixture(t);
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
  // The shards question turning into a status row moves the App row from 1.5 to 1.4, so a reply to
  // the bank shown before is never read against the new numbers.
  reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  merge(fs.readFileSync(binding, 'utf8').replace(/\n\}\n$/, ',\n  "ci_shards": { "answer": "never" }\n}\n'));
  const moved = await reply(ctx, reference, KEEP);
  assert.equal(moved.code, 0, moved.err);
  assert.match(moved.out, /^The governance bank changed since it was shown \(rows were added, taken away or numbered differently\), so the answer was not used and nothing was written\. Type toolkit governance to see the new bank\.$/m);
  assert.doesNotMatch(moved.out, / changed: now /);
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

test('questions are numbered without gaps whichever questions are asked, status rows have none, and rows left out stay as they are', () => {
  const { governanceBankSpecs, renderGovernanceBank, parseBankAnswer, rowDigests, changedRows } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
  const state = { state: 'UNDECIDED', repository: SLUG, root: '/x' };
  const adoption = storeChoice => ({ repository: SLUG, store: { repository: 'toolkit-test-fixture/TRANSPORT-card', create: !storeChoice }, found_store: storeChoice ? 'toolkit-test-fixture/evidence' : null,
    store_name: 'TRANSPORT-card', store_choice: storeChoice, parent: { issue: null, create: true }, checks: [], visibility: 'private', unknown: [] });
  const refs = specs => Object.fromEntries(specs.map(spec => [spec.id, spec.presentation.question_ref]));
  const asQuestion = refs(governanceBankSpecs({ state, adoption: adoption(true) }));
  const asStatus = refs(governanceBankSpecs({ state, adoption: adoption(false) }));
  assert.equal(asQuestion['evidence-store'], '1.4');
  assert.equal(asQuestion['governance-app'], '1.5');
  assert.equal(asStatus['evidence-store'], '', 'a status row has no number');
  assert.equal(asStatus['governance-app'], '1.4', 'the next question takes the number the store left free');
  // A reply to the bank shown before a number moved is never applied as it was: 1.5=A meant the App
  // row there, and the store, which was 1.4, is now a status row.
  const before = rowDigests(governanceBankSpecs({ state, adoption: adoption(true) }));
  assert.equal(changedRows(before, governanceBankSpecs({ state, adoption: adoption(true) })).length, 0, 'the same bank changed nothing');
  assert.equal(changedRows(before, governanceBankSpecs({ state, adoption: adoption(false) })), null);
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
  // Governed: the instruction copies question follows the App question (1.4), and held it is a status
  // row with no number.
  const governed = { state: 'ENABLED', repository: SLUG, root: '/x' };
  const withCopies = governanceBankSpecs({ state: governed, copies: { files: 2 } });
  assert.deepEqual(withCopies.filter(spec => !spec.report_only).map(spec => spec.presentation.question_ref), ['1.1', '1.2', '1.3', '1.4', '1.5', '2.1']);
  assert.equal(refs(withCopies)['instruction-copies'], '1.5');
  assert.deepEqual(Object.values(refs(governanceBankSpecs({ state: governed, copies: { files: 2, held: 'a cloud workflow copy is older' } }))).filter(Boolean), ['1.1', '1.2', '1.3', '1.4', '2.1']);
  const chosen = parseBankAnswer('1.5=B', withCopies, { requireBankReference: false });
  assert.equal(chosen.instructionCopies, 'clean');
  assert.equal(chosen.governance, 'keep');
  // A reply naming some rows changes only those: here turning on is recommended, yet 1.5=A leaves
  // governance as it is. Only all recommended takes every recommendation.
  const undecided = governanceBankSpecs({ state, adoption: adoption(true) });
  assert.equal(undecided.find(spec => spec.id === 'governance').recommended, 'on');
  assert.deepEqual(parseBankAnswer('1.5=A', undecided, { requireBankReference: false }), { governance: 'keep', taskAutoMerge: 'keep', mergeTrain: 'keep', governanceApp: 'keep', permissionBlocks: 'keep', evidenceStore: 'keep' });
  assert.equal(parseBankAnswer('all recommended', undecided, { requireBankReference: false }).governance, 'on');
});

test('in the owner\'s own terminal a reply that cannot be used gets one line and the question again, without the bank', async t => {
  const ctx = fixture(t);
  const result = await run(ctx, ['setup'], { interactive: true, answers: ['1.7=A', 'explain 1.2', KEEP] });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out.split('Bank reference:').length, 2, 'the bank is printed once');
  assert.match(result.out, /^This bank has no row 1\.7\. Nothing was written\. Reply again with all recommended or only your changes, such as 1\.2=B\.$/m);
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
  const ctx = fixture(t);
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
  await explain(`${reference}: explain 1.4`, /^### 1\.4 Parallel CI shards$/m);
  assert.deepEqual(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), shown, 'an explain leaves the shown bank as it was');
  const done = await reply(ctx, reference, KEEP);
  assert.match(done.out, /^Nothing changed: every answer keeps things as they are\.$/m);
  await explain(`${reference}: explain 1.4`, /^### 1\.4 Parallel CI shards$/m);
  await explain('explain 1.2', /^### 1\.2 /m);
  await explain(`${reference}: explain 1.9`, /^This bank has no row 1\.9\.$/m);
  const unknown = await reply(ctx, reference, '1.9=A');
  assert.equal(unknown.code, 0, unknown.err);
  assert.match(unknown.out, /^This bank has no row 1\.9\. Nothing was written\.$/m);
  assert.doesNotMatch(owed(unknown.out), /ticket|used|spent/i, 'an unknown row names no ticket');
  noBank(unknown.out);
  // Anything but an explain still needs the owner's live ticket, and writes nothing without it.
  const bare = await run(ctx, ['setup', '--answers', `${reference}: 1.4=A`]);
  assert.equal(bare.code, 2);
  assert.doesNotMatch(bare.out, /Nothing changed|### /);
});

// G2 of 19 Nov: an answer that opens the shards pull request turns that row into a status row, so
// every later question moves up one number. The ticketless explain then printed another row under
// the number the owner saw (explain 1.4 gave the next row, and a row still on screen did not exist).
// It reads the bank the owner was shown: a bank numbered differently is named as changed, never
// explained by its new numbers; the ticket path refuses the next answer the same way.
test('explain after an answer that renumbers the bank names the change, never another row', async t => {
  const ctx = fixture(t);
  const open = [];
  ctx.cli = {
    ciEstimator: () => ({ minutes: 25, workflow: 'CI' }), ciReaders: () => ({ ok: true }),
    switchTransport: {
      openCiShards: () => open,
      publishCiShards() { const pr = { number: 5, url: `https://github.com/${SLUG}/pull/5`, head: 'a'.repeat(40) }; open.push(pr); return pr; },
      publishSwitch: () => ({ number: 6, url: `https://github.com/${SLUG}/pull/6`, head: 'b'.repeat(40) }),
    },
  };
  const shown = await run(ctx, ['setup']);
  const reference = /Bank reference: (\S+)/.exec(shown.out)[1];
  const seen = row => (new RegExp(`^\\| ${row.replace('.', '\\.')} \\| ([^|]+?) \\|`, 'm').exec(shown.out) || [])[1];
  assert.equal(seen('1.4'), 'Parallel CI shards');
  const later = ['1.5', '1.6'].filter(seen);
  assert.ok(later.length, 'a row follows the shards row');
  const answered = await reply(ctx, reference, '1.4=B');
  assert.equal(answered.code, 0, answered.err);
  assert.equal(open.length, 1, 'the answer opened the shards pull request');
  const moved = JSON.parse((await run(ctx, ['setup', '--json'])).out);
  assert.notEqual(moved.bank_reference, reference, 'the bank is numbered differently now');
  for (const row of ['1.4', ...later]) {
    const result = await run(ctx, ['setup', '--answers', `${reference}: explain ${row}`]);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /^The governance bank changed since it was shown \(rows were added, taken away or numbered differently\), so row \d\.\d as shown is not explained here and nothing was written\. Type toolkit governance to see the new bank\.$/m, `explain ${row}`);
    assert.doesNotMatch(result.out, /^### |This bank has no row/m, `explain ${row} prints no row by the new numbers`);
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
  const result = await run(ctx, ['setup', '--answers', `${reference}: explain 1.4`]);
  assert.equal(result.code, 0, result.err);
  const [first, changed] = result.out.trim().split('\n');
  assert.equal(first, 'The governance state changed since that bank was shown; the numbers still mean the same rows.');
  assert.match(changed, /^2\.1 Toolkit permissions \(Claude Code\) changed: now Up to date, recommended A\. Keep current\.$/);
  assert.match(result.out, /^### 1\.4 Parallel CI shards$/m);
  agentsLast(result.out);
});

// #1373: the owner typed `toolkit governance` while a bank was open in the session (shown, or kept
// open after an answer) and got a status summary instead of the bank. The prompt hook read the
// phrase as a possible bank reply: the agent got a one-use ticket, was told to send anything unclear
// as typed and never to show the bank again, and beside that the typed command's line to show it.
// Typing the phrase asks for the bank afresh: only the command line comes, and the old bank closes.
test('typing toolkit governance while a bank is open asks for the bank afresh, never a reply ticket', async t => {
  const hook = require(path.join(scripts, 'toolkit-governance-hook.cjs'));
  const commands = require(path.join(scripts, 'toolkit-commands.cjs'));
  const ctx = fixture(t);
  const prompt = text => hook.respond('UserPromptSubmit', { cwd: ctx.repo, prompt: text, session_id: SESSION }, {
    registryOptions: ctx.registryOptions, environment: { [gate.HOST_SESSION_VARIABLE]: SESSION }, mergeHold: { recordPromptNote: () => ({ count: 0, note: '' }) },
  }).hookSpecificOutput?.additionalContext || '';
  for (const phrase of ['toolkit governance', 'Governance setup.', 'refresh governance']) {
    const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
    assert.ok(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), 'the bank is open');
    const context = prompt(phrase);
    assert.equal(context, commands.phraseContext(phrase), `${phrase}: only the command line, which runs setup`);
    assert.doesNotMatch(context, /--ticket|may answer it|Never show the bank again yourself/, phrase);
    assert.equal(tickets(ctx).pendingFor(SESSION, epochOf(ctx)), null, `${phrase}: bank ${reference} no longer waits for a reply`);
  }
  // After an answer the bank stays open for the next own message; the phrase still asks afresh.
  const reference = /Bank reference: (\S+)/.exec((await run(ctx, ['setup'])).out)[1];
  assert.match((await reply(ctx, reference, KEEP)).out, /^Nothing changed/m);
  assert.equal(prompt('toolkit governance'), commands.phraseContext('toolkit governance'));
  // Any other own message after a bank still gets its ticket.
  await run(ctx, ['setup']);
  assert.match(prompt('1.4=A'), /--ticket [0-9a-f]{32}/);
});

// #1373: a fresh session, no bank open yet. `setup` first reads the merged binding again; one failed
// read marked it unread, and setup printed no bank but a pointer to `status`, so the owner got a status
// summary. Now setup reads once more with a longer limit and shows the bank when that read works; when
// it fails too, the owner gets one line to type the command again and the agent is told to show no
// status. An answer still writes nothing on an unread binding.
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
