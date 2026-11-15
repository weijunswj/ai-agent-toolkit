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

async function run(ctx, argv) {
  let out = '';
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: () => true },
    cwd: ctx.repo, interactive: false, registryOptions: ctx.registryOptions,
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 2, stale: 1, update: 'node fixture-apply.cjs --apply', remove: 'node fixture-apply.cjs --remove' }),
    environment: { TOOLKIT_HOST_SESSION: SESSION },
  });
  const code = await cli.main(argv);
  return { code, out };
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
  assert.match(shown.out, /^- `all recommended`$/m);
  assert.match(shown.out, /Agents: this line is for you alone\. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line, then stop\./);
  agentsLast(shown.out);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  const pending = new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch);
  assert.ok(pending, 'the bank waits for the owner\'s typed reply');
  assert.deepEqual(Object.keys(pending).sort(), ['at', 'bank_reference', 'epoch', 'repository_id', 'repository_mark', 'root'], 'no card state is kept');
});

test('the shards row asks in one short line, with the details on one "More" line', async t => {
  const ctx = fixture(t);
  const { out } = await run(ctx, ['setup']);
  assert.match(out, /^1\.4 asks: Run tests in parallel CI jobs so they finish faster\? It uses about the same CI minutes\.$/m);
  assert.match(out, /^More on 1\.4: Yes adds a first shard list .*Yes is recommended when the last green CI run took 10 minutes or more\. Minutes: unknown, because no green CI run could be read\. Each shard adds a minute or two of setup, which a private repository pays for\.$/m);
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
