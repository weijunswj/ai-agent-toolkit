'use strict';

// The governance bank as Claude Code's question card: the bank names the exact card, the tool gate
// lets only that card through for the bank shown last, and the owner's taps come back as one bank
// answer with a one-use ticket. Codex keeps the typed reply.

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

async function run(ctx, argv, agentHost = () => 'claude') {
  let out = '';
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: () => true },
    cwd: ctx.repo, interactive: false, registryOptions: ctx.registryOptions,
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 2, stale: 1, update: 'node fixture-apply.cjs --apply', remove: 'node fixture-apply.cjs --remove' }),
    environment: { TOOLKIT_HOST_SESSION: SESSION }, agentHost,
  });
  const code = await cli.main(argv);
  return { code, out };
}

function shownCard(out) {
  const line = out.split('\n').find(entry => entry.startsWith('{"questions"'));
  assert.ok(line, 'the bank names the exact card');
  return JSON.parse(line);
}

const pre = (ctx, toolInput, id = 'tool-1') => new gate.ToolGate({ registryOptions: ctx.registryOptions }).decide({ tool_name: 'AskUserQuestion', session_id: SESSION, cwd: ctx.repo, tool_use_id: id, tool_input: toolInput });
const post = (ctx, questions, answers, id = 'tool-1') => new gate.PromptHold({ registryOptions: ctx.registryOptions, environment: {} }).picked({ cwd: ctx.repo, sessionId: SESSION, toolUseId: id, toolResponse: { questions, answers } });

test('in Claude Code the bank names one card; the owner\'s taps come back as the exact ticketed command', async t => {
  const ctx = fixture(t);
  const shown = await run(ctx, ['setup']);
  assert.equal(shown.code, 0, 'a shown bank is not a failure');
  assert.doesNotMatch(shown.out, /```/);
  assert.match(shown.out, /Agents \(Claude Code\): do not repeat this table.*call AskUserQuestion once with exactly this input/);
  const card = shownCard(shown.out);
  assert.deepEqual(card.questions.map(question => question.question), ['1.1 GitHub governance (now: On)', '1.2 Task auto-merge (now: Off)', '2.1 Toolkit permissions (Claude Code) (now: Outdated: 2 missing, 1 old)']);
  assert.deepEqual(card.questions[2].options.map(option => option.label), ['A. Keep current', 'B. Update (Recommended)', 'C. Remove']);
  assert.ok(card.questions.every(question => question.header.length <= 12));

  const changed = structuredClone(card);
  changed.questions[0].options.reverse();
  assert.match(pre(ctx, changed, 'tool-x').deny, /only exactly as Toolkit printed it/);
  assert.match(pre(ctx, { ...card, answers: {} }, 'tool-y').deny, /only exactly as Toolkit printed it/);
  assert.equal(pre(ctx, card), null, 'the exact card runs');

  const answers = { [card.questions[0].question]: 'A. Keep current (Recommended)', [card.questions[1].question]: 'B. On', [card.questions[2].question]: 'C. Remove' };
  const picked = post(ctx, card.questions, answers);
  assert.match(picked.context, /^node "[^"]+" setup --answers "\S+: 1\.1=A, 1\.2=B, 2\.1=C" --ticket [0-9a-f]{32}$/m);
  assert.equal(post(ctx, card.questions, answers), null, 'the taps count once: the bank is no longer waiting');
});

test('a card not let through, or a typed Other answer, records nothing and leaves the typed reply open', async t => {
  const ctx = fixture(t);
  const card = shownCard((await run(ctx, ['setup'])).out);
  const answers = Object.fromEntries(card.questions.map(question => [question.question, question.options[0].label]));
  assert.match(post(ctx, card.questions, answers, 'never-noted').context, /could not be recorded.*nothing was sent/);
  assert.equal(pre(ctx, card, 'tool-2'), null);
  assert.match(post(ctx, card.questions, { ...answers, [card.questions[1].question]: 'something typed' }, 'tool-2').context, /could not be recorded/);
  const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
  assert.ok(new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch), 'the bank still waits for a typed reply');
});

test('Codex keeps the typed bank and names no card', async t => {
  const ctx = fixture(t);
  const shown = await run(ctx, ['setup'], () => 'codex');
  assert.doesNotMatch(shown.out, /AskUserQuestion/);
  assert.match(shown.out, /show this bank to the owner exactly, as plain text and never in a code block/);
});
