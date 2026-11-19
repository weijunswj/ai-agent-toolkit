'use strict';

// The governance question bank's owner check: only the owner's own next message after a bank was
// shown gets a one-use bank ticket, and the tool gate lets through only the exact answer command with
// that session's live ticket.

const { assert, path, test, scripts, gate, governance, scratch, gitRepo, hold, tools } = require('./toolkit-governance-gate-support.cjs');
const bank = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const questionBank = require(path.join(scripts, 'toolkit-question-bank.cjs'));

const REFERENCE = 'ABCD-EFGH-JKMN-PQRS';
// The script the ticket names: the managed checkout's when this computer records one, else this copy's.
const SCRIPT = require(path.join(scripts, 'toolkit-user-state.cjs')).managedScript('toolkit-governance.cjs');

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
  assert.match(reply.context, /first since governance bank ABCD-EFGH-JKMN-PQRS was shown or Toolkit asked them to reply again/);
  // Toolkit checks the reply, so the agent never asks again in its own words or shows the bank again.
  // Only a reply whose rows and choices are plain is put in form: a bare yes is sent as typed, never
  // turned into all recommended.
  assert.match(reply.context, /only where its rows and choices are plain \(all recommended, or changes such as 1\.2=B in any words\) put it in that form\. Send anything else exactly as typed \(a bare yes or ok, an unknown row, two choices for one row, explain 1\.4, anything unclear\)/);
  assert.match(reply.context, /Never show the bank again yourself/);
  assert.doesNotMatch(reply.context, /run `setup` again|show the bank before|ask one short question/);
  assert.ok(reply.context.includes(`node "${SCRIPT}" setup --answers "${REFERENCE}: ANSWER" --ticket `));
  const ticket = ticketIn(reply.context);
  assert.ok(ticket);
  const command = `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended" --ticket ${ticket}`;
  assert.equal(tools(ctx).decide(bash(sessionId, command)), null, 'the exact command with the live ticket passes');
  for (const forged of [
    `${command}; echo done`,
    `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended" --ticket ${'f'.repeat(32)}`,
    `node "${SCRIPT}" setup --answers "$X" --ticket ${ticket}`,
    // PowerShell reads curly quotes as quotes, so this would run calc.exe as its own statement.
    `& node "${SCRIPT}" setup --answers "${REFERENCE}: x\u201d ; calc.exe ; echo \u201dy" --ticket ${ticket}`,
    `& node "${SCRIPT}" setup --answers "${REFERENCE}: x\u2019 all recommended" --ticket ${ticket}`,
    `node "/elsewhere/toolkit-governance.cjs" setup --answers "${REFERENCE}: all recommended" --ticket ${ticket}`,
  ]) assert.ok(tools(ctx).decide(bash(sessionId, forged))?.deny, forged);
  // The refusal says what makes the reply exact, so the agent sends it again rather than telling
  // the user it cannot be sent.
  assert.match(tools(ctx).decide(bash(sessionId, `node "${SCRIPT}" setup --answers "${REFERENCE}: x\u2019 all recommended" --ticket ${ticket}`)).deny,
    /exact command .* no curly quote, .* run the same command again without it/);
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
  // Turn on also covers the settings Toolkit adds on its own after the merge, so the shown bank names
  // them before the owner answers.
  const shown = bank.renderGovernanceBank(undecided);
  assert.ok(shown.includes(`After the merge, Toolkit also turns on, without asking again: ${require('../scripts/toolkit-governance-finish.cjs').WHAT}.`), shown);
  assert.match(shown, /default-branch protection[^|]*ruleset that blocks force pushes[^|]*security settings/);
  // On a disabled repository Keep current is recommended, so the table shows Turn on as a bare label;
  // the bank still names the post-merge settings under it before the answer. Where Turn on is not
  // offered (already on) nothing is added.
  const after = `After the merge, Toolkit also turns on, without asking again: ${require('../scripts/toolkit-governance-finish.cjs').WHAT}.`;
  const disabled = bank.renderGovernanceBank(bank.governanceBankSpecs({ state: { state: 'DISABLED', repository: 'owner/app', root: '/x' } }));
  assert.match(disabled, /\| 1\.1 \| GitHub governance \| Off \| A\. Keep current \| B\. Turn on \|/);
  assert.ok(disabled.includes(`1.1 B. Turn on: Toolkit prepares one pull request that turns governance on. It applies only after you merge it. ${after}`), disabled);
  assert.equal(shown.split(after).length, 2, 'named once where Turn on is recommended');
  assert.ok(!bank.renderGovernanceBank(bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' } })).includes(after));
  // A repository with no required checks yet: the status row says protection waits, and the step.
  const fresh = adoption => bank.renderGovernanceBank(bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' },
    adoption: { repository: 'owner/app', store: { repository: 'owner/TRANSPORT-app', create: true }, found_store: null, store_name: 'TRANSPORT-app', store_choice: false, parent: { issue: null, create: true }, visibility: 'private', unknown: [], ...adoption } }));
  // The migrate step is in the turn-on result (turnOnSummary), not the bank.
  assert.match(fresh({ checks: [] }), /^- Required checks: None yet\. Default-branch protection waits for them\.$/m);
  assert.match(fresh({ checks: ['validate'] }), /^- Required checks: validate\. Taken from what the default branch already enforces\.$/m);
  assert.match(table, /\| 2\.1 \| Toolkit permissions \(Codex\) \| Up to date \| A\. Keep current \| B\. Remove \|/);
  for (const spec of undecided) assert.ok(spec.choices.length <= 3, spec.id);
  const reference = bank.bankReference(undecided);
  assert.match(table, /\| 1\.4 \| Governance App \| Not checked \| B\. Set up: .* \| A\. Keep current \|/);
  assert.doesNotMatch(table, /\| 1\.5 \|/, 'rows that do not apply leave no gap: the App row takes 1.4');
  assert.deepEqual(bank.parseBankAnswer(`${reference}: all recommended`, undecided), { governance: 'on', taskAutoMerge: 'keep', mergeTrain: 'keep', governanceApp: 'setup', permissionBlocks: 'keep', evidenceStore: 'keep' });
  assert.deepEqual(bank.parseBankAnswer(`${reference}: 1.1=A, 1.4=A, 2.1=B`, undecided), { governance: 'keep', taskAutoMerge: 'keep', mergeTrain: 'keep', governanceApp: 'keep', permissionBlocks: 'remove', evidenceStore: 'keep' });
  assert.deepEqual(bank.parseBankAnswer(`${reference}: 1.1=B, 1.2=B`, undecided).taskAutoMerge, 'on', 'on together with turning governance on');
  // A row left out stays as it is, so on its own 1.2=B leaves governance undecided and is refused.
  for (const answer of ['1.2=B', '1.1=A, 1.2=B']) assert.throws(() => bank.parseBankAnswer(`${reference}: ${answer}`, undecided), /only while governance is on/, answer);
  const outdated = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'claude', missing: 2, stale: 4 } });
  assert.match(questionBank.renderCompactQuestionTable(outdated, true).join('\n'), /\| 2\.1 \| Toolkit permissions \(Claude Code\) \| Outdated: 2 missing, 4 old \| B\. Update: .* \| A\. Keep current<br>C\. Remove \|/);
  assert.throws(() => bank.parseBankAnswer('AAAA-AAAA-AAAA-AAAA: all recommended', undecided), /Governance question bank reference is stale/);
  assert.throws(() => bank.parseBankAnswer(`${reference}: 1.9=B`, undecided), /^Error: This bank has no row 1\.9\.$/);
  const enabled = bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, task: 'after-gates', merged: { store: { repository: 'owner/store' }, required_checks: [] }, ciShards: { estimate: '', measured: null } });
  assert.notEqual(bank.bankReference(enabled), reference, 'a different state is a different bank');
  assert.deepEqual(bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B`, enabled), { governance: 'off', taskAutoMerge: 'keep', mergeTrain: 'keep', governanceApp: 'keep', permissionBlocks: 'keep', evidenceStore: 'keep', ciShards: 'not-now' }, 'a governed bank also asks about parallel CI shards; every row left out stays as it is');
  assert.throws(() => bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B, 1.4=B`, enabled), /answered only while governance is on/);
});
