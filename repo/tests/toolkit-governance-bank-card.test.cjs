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

// What the agent is told sits in one last paragraph that starts with "Agents", so the guide can tell it
// to keep that paragraph, card input included, off the owner's screen; nothing for the agent sits elsewhere.
function agentsLast(out) {
  const paragraphs = out.trim().split(/\n\s*\n/);
  const last = paragraphs.at(-1);
  assert.match(last, /^Agents\b/, 'the last paragraph is the Agents paragraph');
  for (const paragraph of paragraphs.slice(0, -1)) assert.doesNotMatch(paragraph, /\bAgents\b|AskUserQuestion|\{"questions"/, 'no agent instruction outside it');
  if (out.includes('{"questions"')) assert.ok(last.includes('{"questions"'), 'the card input is inside it');
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
  assert.match(shown.out, /Agents \(Claude Code\): this paragraph is for you alone; never show the owner any of it or the card input\. Do not show the table above.*call AskUserQuestion once with exactly this input/);
  agentsLast(shown.out);
  const card = shownCard(shown.out);
  const questions = card.questions.map(question => question.question);
  assert.deepEqual(questions.slice(0, 3), ['1.1 GitHub governance (now: On)', '1.2 Task auto-merge (now: Off)', '1.3 Merge trains (now: On)']);
  // A governed repository is also asked the parallel CI shards question, with its minutes line; six
  // rows split over two cards, so the App and permissions rows are on the second.
  assert.match(questions[3], /^1\.4 Parallel CI shards \(now: Not asked yet\): Split this repository's tests into parallel CI shards\? .*Minutes: unknown/);
  assert.deepEqual(card.questions[3].options.map(option => option.label), ['A. Not now (Recommended)', 'B. Yes', 'C. Never ask']);
  assert.match(shown.out, /This is card 1 of 2\./);
  assert.ok(card.questions.every(question => question.header.length <= 12));

  const changed = structuredClone(card);
  changed.questions[0].options.reverse();
  assert.match(pre(ctx, changed, 'tool-x').deny, /only exactly as Toolkit printed it/);
  assert.match(pre(ctx, { ...card, answers: {} }, 'tool-y').deny, /only exactly as Toolkit printed it/);
  assert.equal(pre(ctx, card), null, 'the exact card runs');

  const answers = { [card.questions[0].question]: 'A. Keep current (Recommended)', [card.questions[1].question]: 'B. On', [card.questions[2].question]: 'A. Keep current (Recommended)', [card.questions[3].question]: 'A. Not now (Recommended)' };
  const next = post(ctx, card.questions, answers);
  assert.match(next.context, /tapped card 1 of 2 of governance bank \S+\. Nothing is sent yet\./);
  const second = JSON.parse(next.context.split('\n').find(entry => entry.startsWith('{"questions"')));
  assert.deepEqual(second.questions.map(question => question.question), ['1.5 Governance App (now: Not checked)', '2.1 Toolkit permissions (Claude Code) (now: Outdated: 2 missing, 1 old)']);
  assert.deepEqual(second.questions[0].options.map(option => option.label), ['A. Keep current', 'B. Set up (Recommended)']);
  assert.deepEqual(second.questions[1].options.map(option => option.label), ['A. Keep current', 'B. Update (Recommended)', 'C. Remove']);
  assert.equal(pre(ctx, second, 'tool-2'), null, 'the next exact card runs');
  const lastAnswers = { [second.questions[0].question]: 'A. Keep current', [second.questions[1].question]: 'C. Remove' };
  const picked = post(ctx, second.questions, lastAnswers, 'tool-2');
  assert.match(picked.context, /^node "[^"]+" setup --answers "\S+: 1\.1=A, 1\.2=B, 1\.3=A, 1\.4=A, 1\.5=A, 2\.1=C" --ticket [0-9a-f]{32}$/m);
  assert.equal(post(ctx, second.questions, lastAnswers, 'tool-2'), null, 'the taps count once: the bank is no longer waiting');
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
  assert.match(shown.out, /Agents: this line is for you alone\. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line/);
  agentsLast(shown.out);
});
