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
  assert.match(reply.context, /only where its rows and choices are plain \(all recommended, changes such as 1\.2=B, no store, store=<owner\/name> or shards=<yes\|not-now\|never>, in any words\) put it in that form\. Send anything else exactly as typed \(a bare yes or ok, an unknown row, two choices for one row, explain 1\.4, anything unclear\)/);
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

test('the governance bank uses setup toolkit\'s format, asks only what is left, and reads both reply forms', () => {
  const after = `After the merge, Toolkit also turns on, without asking again: ${require('../scripts/toolkit-governance-finish.cjs').WHAT}.`;
  // Not decided yet: the answer itself turns governance on, so its row is a status line and task
  // auto-merge is the one question.
  const undecided = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'codex', missing: 0, stale: 0 } });
  const table = questionBank.renderCompactQuestionTable(undecided.filter(spec => !spec.report_only), true).join('\n');
  assert.match(table, /^\| 1\.1 \| Task auto-merge \| Off \(needs governance\) \| A\. Keep current \| B\. On \|$/m);
  assert.doesNotMatch(table, /GitHub governance|\| 1\.2 \|/);
  const shown = bank.renderGovernanceBank(undecided);
  assert.match(shown, /^- GitHub governance: Not decided\. Your answer turns it on: Toolkit prepares one pull request, and it applies only after you merge it\. Reply no store to keep it off\.$/m);
  assert.match(shown, /^- Toolkit permissions \(Codex\): Up to date\. Codex's Toolkit permission lines are current\.$/m);
  // The answer also covers the settings Toolkit adds on its own after the merge, so the bank names them before it.
  assert.ok(shown.includes(after), shown);
  assert.equal(shown.split(after).length, 2, 'named once');
  assert.match(shown, /default-branch protection[^|]*ruleset that blocks force pushes[^|]*security settings/);
  assert.match(shown, /^Reply all recommended to turn governance on as shown, or only your changes such as 1\.1=B\. Reply no store to keep governance off\. Say "explain 1\.1" for the full text of a row\.$/m);
  for (const spec of undecided) assert.ok(spec.choices.length <= 3, spec.id);
  const reference = bank.bankReference(undecided);
  assert.deepEqual(bank.parseBankAnswer(`${reference}: all recommended`, undecided), { governance: 'on', taskAutoMerge: 'keep', store: null, governanceApp: 'setup', permissionBlocks: 'keep' });
  assert.deepEqual(bank.parseBankAnswer(`${reference}: 1.1=B`, undecided), { governance: 'on', taskAutoMerge: 'on', store: null, governanceApp: 'setup', permissionBlocks: 'keep' }, 'on together with turning governance on');
  assert.deepEqual(bank.parseBankAnswer(`${reference}: no store`, undecided), { noStore: true });
  assert.throws(() => bank.parseBankAnswer(`${reference}: no store, 1.1=B`, undecided), /No store keeps governance off, so it goes on its own/);
  const outdated = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'claude', missing: 2, stale: 4 } });
  assert.match(bank.renderGovernanceBank(outdated), /^- Toolkit permissions \(Claude Code\): Outdated: 2 missing, 4 old\. After your answer, Toolkit gives you one command to run yourself /m);
  assert.equal(bank.parseBankAnswer(`${bank.bankReference(outdated)}: 1.1=A`, outdated).permissionBlocks, 'update');
  assert.throws(() => bank.parseBankAnswer('AAAA-AAAA-AAAA-AAAA: all recommended', undecided), /Governance question bank reference is stale/);
  assert.throws(() => bank.parseBankAnswer(`${reference}: 1.9=B`, undecided), /^Error: This bank has no row 1\.9\.$/);
  // A repository with no required checks yet: the status row says protection waits.
  const fresh = adoption => bank.renderGovernanceBank(bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' },
    adoption: { repository: 'owner/app', store: { repository: 'owner/TRANSPORT-app', create: true }, found_store: null, store_name: 'TRANSPORT-app', parent: { issue: null, create: true }, visibility: 'private', unknown: [], ...adoption } }));
  // The migrate step is in the turn-on result (turnOnSummary), not the bank.
  assert.match(fresh({ checks: [] }), /^- Required checks: None yet\. Default-branch protection waits for them\.$/m);
  assert.match(fresh({ checks: ['validate'] }), /^- Required checks: validate\. Taken from what the default branch already enforces\.$/m);
  // Off: governance is the question, with Keep current recommended; Turn on names the post-merge
  // settings under the table. Already on: nothing is added.
  const disabled = bank.renderGovernanceBank(bank.governanceBankSpecs({ state: { state: 'DISABLED', repository: 'owner/app', root: '/x' } }));
  assert.match(disabled, /\| 1\.1 \| GitHub governance \| Off \| A\. Keep current \| B\. Turn on \|/);
  assert.match(disabled, /\| 1\.2 \| Task auto-merge \| Off \(needs governance\) \| A\. Keep current \| B\. On \(needs governance on\) \|/);
  assert.ok(disabled.includes(`1.1 B. Turn on: Toolkit prepares one pull request that turns governance on. It applies only after you merge it. ${after}`), disabled);
  const enabled = bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, task: 'after-gates', merged: { store: { repository: 'owner/store' }, required_checks: [] }, ciShards: { measured: null } });
  assert.ok(!bank.renderGovernanceBank(enabled).includes(after));
  assert.notEqual(bank.bankReference(enabled), reference, 'a different state is a different bank');
  assert.deepEqual(bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B`, enabled), { governance: 'off', taskAutoMerge: 'keep', store: null, governanceApp: 'setup', permissionBlocks: 'keep', ciShards: 'not-now' }, 'every row left out stays as it is; turning off writes no shards');
  assert.throws(() => bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B, shards=yes`, enabled), /answered only while governance is on/);
  assert.throws(() => bank.parseBankAnswer(`${bank.bankReference(enabled)}: store=owner/other`, enabled), /store= applies only in an answer that turns governance on here/);
});

// Explain is read-only: the owner's "explain 1.4" spends no ticket and keeps the bank open, and the
// tool gate lets through exactly the ticketless explain command; any other reply without the live
// ticket is still refused.
test('an explain message gets the ticketless explain command, keeps the bank open, and only that command passes without a ticket', (t) => {
  const { ctx, repo, sessionId, tickets, prompts, epochs } = shownFixture(t);
  const explain = prompts.decide({ cwd: repo, prompt: 'explain 1.4', sessionId });
  assert.equal(explain.action, 'pass');
  const command = `node "${SCRIPT}" setup --answers "${REFERENCE}: explain 1.4"`;
  assert.ok(explain.context.includes(command), explain.context);
  assert.equal(ticketIn(explain.context), undefined, 'an explain gets no ticket');
  assert.ok(tickets.pendingFor(sessionId, epochs.get(sessionId)), 'the bank still waits for the owner\'s answer');
  assert.equal(tools(ctx).decide(bash(sessionId, command)), null, 'the ticketless explain command passes');
  assert.equal(tools(ctx).decide(bash('another-session', `node "${SCRIPT}" setup --answers "explain 2.1"`)), null, 'an explain writes nothing, in any session');
  for (const refused of [
    `${command}; echo done`,
    `node "${SCRIPT}" setup --answers "${REFERENCE}: 1.4=A"`,
    `node "${SCRIPT}" setup --answers "${REFERENCE}: explain 1.4, 1.4=A"`,
    `node "${SCRIPT}" setup --answers "$X explain 1.4"`,
    `node "/elsewhere/toolkit-governance.cjs" setup --answers "${REFERENCE}: explain 1.4"`,
  ]) assert.ok(tools(ctx).decide(bash(sessionId, refused))?.deny, refused);
  const answer = prompts.decide({ cwd: repo, prompt: 'all recommended', sessionId });
  assert.ok(ticketIn(answer.context), 'the next own message still answers the bank with a ticket');
});
