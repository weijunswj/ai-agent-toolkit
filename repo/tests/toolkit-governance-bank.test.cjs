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
  // Not decided yet: the answer itself turns governance on, so its row has no number and task
  // auto-merge with merge train is the one question; the parts Toolkit keeps itself are numbered after it.
  const undecided = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'codex', missing: 0, stale: 0 } });
  const shown = bank.renderGovernanceBank(undecided);
  assert.match(shown, /^# Toolkit governance choices - not decided: your answer turns it on$/m);
  assert.match(shown, /^\| 1\.1 \| Task auto-merge with merge train \| Off \(needs governance\) \| A\. Keep current \| B\. On \|$/m);
  assert.match(shown, /^\| - \| GitHub governance \| Not decided \| Your answer turns it on: Toolkit prepares one pull request, and it applies only after you merge it \| - \|$/m);
  assert.equal(shown.split('\n').filter(line => /^\| (?:\d|-)/.test(line)).length, 4, 'one table: governance, task auto-merge, permissions and the App');
  // How to keep governance off is said once, in the reply line.
  assert.equal(shown.split('no store').length, 2, shown);
  // The App command is the owner's because its setup refuses to run under an agent; the bank says why.
  assert.match(shown, /^\| 1\.3 \| Governance App \| Not checked \| After your answer, Toolkit gives you one line to paste into PowerShell \(it refuses to run under an agent, so the App's private key never passes through one\): press Enter when it asks, then click Create and Install on GitHub\. Governance works without it, but its jobs on GitHub need it to open pull requests \| - \|$/m);
  assert.doesNotMatch(shown, /undefined/);
  assert.match(shown, /^\| 1\.2 \| Toolkit permissions \(Codex\) \| Up to date \| Keep \| - \|$/m);
  // The answer also covers the settings Toolkit adds on its own after the merge, so the bank names them before it.
  assert.ok(shown.includes(after), shown);
  assert.equal(shown.split(after).length, 2, 'named once');
  assert.match(shown, /default-branch protection[^|]*ruleset that blocks force pushes[^|]*security settings/);
  assert.match(shown, /^Reply all recommended to turn governance on as shown, or only your changes such as 1\.1=B\. To keep governance off instead, reply no store: Toolkit then makes nothing and asks again next session\. A plain yes, no or later works too: yes is all recommended, later keeps governance off the same way, and no prepares one pull request that turns governance off\. Say "explain 1\.1" for the full text of a row\.$/m);
  // A failed GitHub read of the store and parent issue is one plain line, with no internal note.
  const blocked = bank.renderGovernanceBank(bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, adoption: { blocked: "couldn't check governance; ordinary work continues" } }));
  assert.match(blocked, /^- Store and parent issue: Not checked yet\. GitHub could not be read just now, so Toolkit asks about them once it can, and an answer now makes nothing\. Type toolkit governance again in a moment\.$/m);
  assert.doesNotMatch(blocked, /ordinary work continues/);
  // A state the bank has no words for is never shown (it once printed "GitHub governance: undefined").
  for (const unknown of ['UNAVAILABLE', 'ERROR', undefined]) {
    assert.throws(() => bank.governanceBankSpecs({ state: { state: unknown, repository: 'owner/app', root: '/x' } }), /governance bank cannot show the state/, String(unknown));
  }
  for (const spec of undecided) assert.ok(spec.choices.length <= 3, spec.id);
  const reference = bank.bankReference(undecided);
  assert.deepEqual(bank.parseBankAnswer(`${reference}: all recommended`, undecided), { governance: 'on', taskAutoMerge: 'keep', store: null, governanceApp: 'setup', permissionBlocks: 'keep' });
  assert.deepEqual(bank.parseBankAnswer(`${reference}: 1.1=B`, undecided), { governance: 'on', taskAutoMerge: 'on', store: null, governanceApp: 'setup', permissionBlocks: 'keep' }, 'on together with turning governance on');
  assert.deepEqual(bank.parseBankAnswer(`${reference}: no store`, undecided), { noStore: true });
  assert.throws(() => bank.parseBankAnswer(`${reference}: no store, 1.1=B`, undecided), /No store keeps governance off, so it goes on its own/);
  const outdated = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions: { checked: true, host: 'claude', missing: 2, stale: 4 } });
  assert.match(bank.renderGovernanceBank(outdated), /^\| 1\.2 \| Toolkit permissions \(Claude Code\) \| Outdated: 2 missing, 4 old \| After your answer, Toolkit gives you one command to run yourself [^|]* \| Leave: do not run the command \|$/m);
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
  assert.match(disabled, /\| 1\.2 \| Task auto-merge with merge train \| Off \(needs governance\) \| A\. Keep current \| B\. On \(needs governance on\) \|/);
  assert.ok(disabled.includes(`1.1 B. Turn on: Toolkit prepares one pull request that turns governance on. It applies only after you merge it. ${after}`), disabled);
  const enabled = bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, task: 'after-gates', merged: { store: { repository: 'owner/store' }, required_checks: [] }, ciShards: { measured: null } });
  assert.ok(!bank.renderGovernanceBank(enabled).includes(after));
  assert.notEqual(bank.bankReference(enabled), reference, 'a different state is a different bank');
  assert.deepEqual(bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B`, enabled), { governance: 'off', taskAutoMerge: 'keep', store: null, governanceApp: 'keep', permissionBlocks: 'keep', ciShards: 'not-now' }, 'every row left out stays as it is; turning off writes no shards; an App never read is unknown, so no setup line');
  assert.throws(() => bank.parseBankAnswer(`${bank.bankReference(enabled)}: 1.1=B, shards=yes`, enabled), /answered only while governance is on/);
  assert.throws(() => bank.parseBankAnswer(`${bank.bankReference(enabled)}: store=owner/other`, enabled), /store= applies only in an answer that turns governance on here/);
});

// The shards row's status line and explain text say how a shard split stays current; with no shards it says nothing.
test('the shards row says the split is refreshed once a day through one pull request, only where shards are on', () => {
  const specs = extra => bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, merged: { store: { repository: 'owner/store' }, required_checks: [], ...(extra.ci_shards ? { ci_shards: extra.ci_shards } : {}) },
    ...(extra.minutes === undefined ? {} : { ciShards: { measured: { minutes: extra.minutes } } }) });
  const daily = /once a day Shard Timings measures the tests and, when the shards have drifted, opens one pull request with the new split \(this needs the governance App\)\. Nothing changes until it is merged, and the programme flags it after 24 hours with no owner\./;
  // The shards row takes no answer, so row 1.1's explain text carries it, as it does the App's removal steps.
  const explained = list => bank.explainText(list, '1.1');
  const bound = specs({ ci_shards: { answer: 'yes' } });
  assert.match(bank.renderGovernanceBank(bound), /^\| 1\.3 \| Parallel CI shards \| Ready: Yes \| [^|]*refreshed once a day \(explain 1\.1\) \| - \|$/m);
  assert.match(explained(bound), daily);
  const byDefault = specs({ minutes: 25 });
  assert.match(bank.renderGovernanceBank(byDefault), /^\| 1\.3 \| Parallel CI shards \| Not ready: Yes \(Toolkit default\) \(CI about 25 min\) \| Next step: your answer prepares the shard pull request; merge it \| shards=not-now or shards=never in your reply \|$/m);
  assert.match(bank.explainText(byDefault, '1.3'), /; the split is then refreshed once a day\./);
  assert.match(explained(byDefault), daily);
  for (const none of [specs({ ci_shards: { answer: 'never' } }), specs({ minutes: 3 })]) {
    assert.doesNotMatch(bank.renderGovernanceBank(none), /once a day/);
    assert.doesNotMatch(explained(none), /once a day|Shard Timings/);
  }
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

// One table (INT-TK421-1359 and 1360): the two choices, then the parts Toolkit keeps itself, each with
// its mark and one next step while governance is on, under a top line that says what is left. A part
// GitHub could not be read for is unknown, never missing, and an answer sets up nothing for it.
test('the governed bank is one table whose top line counts the steps left, and an unread part is unknown, never missing', () => {
  const merged = { store: { repository: 'owner/TRANSPORT-app' }, parents: [{ issue: 7 }], required_checks: ['validate'] };
  const specs = extra => bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, task: 'off', train: 'on', merged,
    permissions: { checked: true, host: 'claude', missing: 0, stale: 0 }, app: { variable: 'found', secret: 'found' }, ciShards: { measured: { minutes: 4 }, open: [], existing: null, usable: { ok: true } }, ...extra });
  const rows = shown => shown.split('\n').filter(line => /^\| \d/.test(line)).map(line => line.split(' | ').slice(0, 2).join(' | '));
  const ready = bank.renderGovernanceBank(specs({}));
  assert.match(ready, /^# Toolkit governance choices - ON, ready$/m);
  assert.deepEqual(rows(ready), ['| 1.1 | GitHub governance', '| 1.2 | Task auto-merge with merge train', '| 1.3 | Parallel CI shards', '| 1.4 | Toolkit permissions (Claude Code)', '| 1.5 | Governance App', '| 1.6 | Evidence store']);
  assert.match(ready, /^\| 1\.3 \| Parallel CI shards \| Ready: Not needed \(Toolkit default\) \(CI about 4 min\) \| /m);
  assert.doesNotMatch(ready, /Merge trains|Parent issue:|Required checks:/, 'trains, parent and checks are left out of the table');
  const notReady = specs({ permissions: { checked: true, host: 'claude', missing: 3, stale: 0 }, app: { variable: 'missing', secret: 'missing' }, ciShards: { measured: { minutes: 12 }, open: [], existing: null, usable: { ok: true } } });
  assert.match(bank.renderGovernanceBank(notReady), /^# Toolkit governance choices - ON, not ready, 3 steps left$/m);
  assert.match(bank.renderGovernanceBank(notReady), /^\| 1\.5 \| Governance App \| Not ready: Not set up \| Next step: paste the one line Toolkit gives after your answer \| - \|$/m);
  // GitHub could not be read: unknown, not a step left, and no App setup line comes with the answer.
  const unread = specs({ app: { variable: 'unverified', secret: 'unverified', reason: 'gh-unavailable' } });
  assert.match(bank.renderGovernanceBank(unread), /^# Toolkit governance choices - ON, ready; 1 part could not be checked$/m);
  assert.match(bank.renderGovernanceBank(unread), /^\| 1\.5 \| Governance App \| Unknown: GitHub could not be read \(gh-unavailable\) \| /m);
  assert.equal(bank.parseBankAnswer('all recommended', unread, { requireBankReference: false }).governanceApp, 'keep');
  // A part Toolkit keeps itself takes no answer, and says how it changes instead.
  assert.throws(() => bank.parseBankAnswer('1.6=B', unread, { requireBankReference: false }), /^Error: Row 1\.6 Evidence store takes no answer: Change location: not by this answer; the controller's state move shows its plan first and asks its own confirmation\.$/);
  assert.match(bank.explainText(unread, '1.5'), /^1\.5 Governance App\nCurrent: GitHub could not be read \(gh-unavailable\)\./);
});

// No reply applies a part its row does not show: with no test list Toolkit can split (a Python suite,
// say), shards are not applicable, with why, and no answer turns them on.
test('shards with no usable test list are not applicable, with the reason, and no answer turns them on', () => {
  const specs = bank.governanceBankSpecs({ state: { state: 'ENABLED', repository: 'owner/app', root: '/x' }, task: 'off', merged: { store: { repository: 'owner/s' }, required_checks: [] },
    permissions: { checked: true, host: 'claude', missing: 0, stale: 0 }, app: { variable: 'found', secret: 'found' },
    ciShards: { measured: { minutes: 30 }, open: [], existing: null, usable: { ok: false, reason: 'no Node test files were found (such as *.test.js using node:test)' } } });
  const shown = bank.renderGovernanceBank(specs);
  assert.match(shown, /^\| 1\.3 \| Parallel CI shards \| Ready: Not applicable \| Toolkit can split only Node tests, and no Node test files were found \(such as \*\.test\.js using node:test\)\. It looks again at the next refresh \| - \|$/m);
  assert.doesNotMatch(shown, /shards=/);
  assert.equal(bank.parseBankAnswer('all recommended', specs, { requireBankReference: false }).ciShards, undefined, 'slow CI alone turns nothing on');
  assert.throws(() => bank.parseBankAnswer('all recommended, shards=yes', specs, { requireBankReference: false }), /shards= does not apply/);
});
