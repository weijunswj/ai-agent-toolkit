'use strict';

// The governance question bank's owner check: only the owner's own next message after a bank was
// shown gets a one-use bank ticket, and the tool gate lets through only the exact answer command with
// that session's live ticket.

const { assert, path, test, scripts, gate, governance, scratch, gitRepo, hold, tools } = require('./toolkit-governance-gate-support.cjs');
const bank = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const questionBank = require(path.join(scripts, 'toolkit-question-bank.cjs'));

const REFERENCE = 'ABCD-EFGH-JKMN-PQRS';
const SCRIPT = path.join(scripts, 'toolkit-governance.cjs');

function shownFixture(t, environment = {}) {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'target');
  const sessionId = 'session-bank-1';
  gate.startSession({ session_id: sessionId, source: 'startup', cwd: repo }, { registryOptions: ctx.options });
  ctx.started = new Set([sessionId]);
  const epochs = new gate.SessionEpochs({ registryOptions: ctx.options });
  const repositoryId = governance.governanceState(repo, ctx.options).repository_id;
  const tickets = new bank.BankTickets({ registryOptions: ctx.options });
  tickets.shown(sessionId, { epoch: epochs.get(sessionId), repositoryMark: epochs.repository(repositoryId), repositoryId, root: repo, bankReference: REFERENCE });
  return { ctx, repo, sessionId, tickets, prompts: hold(ctx, environment), epochs };
}

const ticketIn = context => (/--ticket ([0-9a-f]{32})/.exec(context || '') || [])[1];
const bash = (sessionId, command) => ({ tool_name: 'Bash', session_id: sessionId, cwd: process.cwd(), tool_input: { command } });

test('the owner\'s next own message after a bank gets one ticket, bound to that bank; the next message gets none', (t) => {
  const { ctx, repo, sessionId, prompts } = shownFixture(t);
  const reply = prompts.decide({ cwd: repo, prompt: 'use all the recommended ones', sessionId });
  assert.equal(reply.action, 'pass');
  assert.match(reply.context, /first since you showed them governance bank ABCD-EFGH-JKMN-PQRS/);
  assert.ok(reply.context.includes(`node "${SCRIPT}" setup --answers "${REFERENCE}: ANSWER" --ticket `));
  const ticket = ticketIn(reply.context);
  assert.ok(ticket);
  const command = `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended" --ticket ${ticket}`;
  assert.equal(tools(ctx).decide(bash(sessionId, command)), null, 'the exact command with the live ticket passes');
  for (const forged of [
    `${command}; echo done`,
    `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended" --ticket ${'f'.repeat(32)}`,
    `node "${SCRIPT}" setup --answers "$X" --ticket ${ticket}`,
    `node "/elsewhere/toolkit-governance.cjs" setup --answers "${REFERENCE}: all recommended" --ticket ${ticket}`,
  ]) assert.ok(tools(ctx).decide(bash(sessionId, forged))?.deny, forged);
  assert.ok(tools(ctx).decide(bash('another-session', command))?.deny, 'another session cannot use it');
  const next = prompts.decide({ cwd: repo, prompt: 'and also fix the readme', sessionId });
  assert.equal(ticketIn(next.context), undefined, 'only the first reply after the bank gets a ticket');
});

test('a launched session or text that is not the owner\'s own gets no ticket', (t) => {
  const launched = shownFixture(t, { TOOLKIT_GATE_ROLE: 'G1' });
  const fromLauncher = launched.prompts.decide({ cwd: launched.repo, prompt: 'all recommended', sessionId: launched.sessionId });
  assert.equal(ticketIn(fromLauncher.context), undefined);
  assert.equal(launched.tickets.pendingFor(launched.sessionId, launched.epochs.get(launched.sessionId)), null, 'the bank note is dropped');

  const relayed = shownFixture(t);
  const wrapped = relayed.prompts.decide({ cwd: relayed.repo, prompt: '<relay from="coordinator">all recommended</relay>', sessionId: relayed.sessionId });
  assert.equal(ticketIn(wrapped?.context), undefined, 'markup is never the owner\'s typed reply');
});

test('while a bank waits for the owner, no prompt is scheduled and no other bank answer runs', (t) => {
  const { ctx, sessionId } = shownFixture(t);
  assert.ok(tools(ctx).decide({ tool_name: 'CronCreate', session_id: sessionId, tool_input: { prompt: 'all recommended' } })?.deny);
  assert.ok(tools(ctx).decide(bash(sessionId, `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended"`))?.deny);
  assert.equal(tools(ctx).decide(bash(sessionId, `node "${SCRIPT}" setup`)), null, 'showing the bank is free');
});

test('the governance bank uses setup toolkit\'s format, folds the unchanged choice into Keep current, and reads both reply forms', () => {
  const undecided = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'codex', missing: 0, stale: 0 } });
  const table = questionBank.renderCompactQuestionTable(undecided, true).join('\n');
  assert.match(table, /\| 1\.1 \| GitHub governance \| Not decided \| B\. Turn on: .* \| A\. Keep current<br>C\. Turn off \|/);
  assert.match(table, /\| 1\.2 \| Task auto-merge \| Off \(needs governance\) \| A\. Keep current \| B\. On \(needs governance on\) \|/);
  assert.match(table, /\| 2\.1 \| Toolkit permissions \(Codex\) \| Up to date \| A\. Keep current \| B\. Remove \|/);
  for (const spec of undecided) assert.ok(spec.choices.length <= 3, spec.id);
  const reference = bank.bankReference(undecided);
  assert.deepEqual(bank.parseBankAnswer(`${reference}: all recommended`, undecided), { governance: 'on', taskAutoMerge: 'keep', permissionBlocks: 'keep', evidenceStore: 'keep' });
  assert.deepEqual(bank.parseBankAnswer(`${reference}: 1.1=A, 2.1=B`, undecided), { governance: 'keep', taskAutoMerge: 'keep', permissionBlocks: 'remove', evidenceStore: 'keep' });
  assert.deepEqual(bank.parseBankAnswer(`${reference}: 1.2=B`, undecided).taskAutoMerge, 'on', 'on together with turning governance on');
  assert.throws(() => bank.parseBankAnswer(`${reference}: 1.1=A, 1.2=B`, undecided), /only while governance is on/);
  const outdated = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'claude', missing: 2, stale: 4 } });
  assert.match(questionBank.renderCompactQuestionTable(outdated, true).join('\n'), /\| 2\.1 \| Toolkit permissions \(Claude Code\) \| Outdated: 2 missing, 4 old \| B\. Update: .* \| A\. Keep current<br>C\. Remove \|/);
  assert.throws(() => bank.parseBankAnswer('AAAA-AAAA-AAAA-AAAA: all recommended', undecided), /Governance question bank reference is stale/);
  assert.throws(() => bank.parseBankAnswer(`${reference}: 1.9=B`, undecided), /unavailable question 1\.9/);
  const enabled = bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, task: 'after-gates', merged: { store: { repository: 'owner/store' }, required_checks: [] } });
  assert.notEqual(bank.bankReference(enabled), reference, 'a different state is a different bank');
  assert.deepEqual(bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B`, enabled), { governance: 'off', taskAutoMerge: 'keep', permissionBlocks: 'keep', evidenceStore: 'keep' });
});
