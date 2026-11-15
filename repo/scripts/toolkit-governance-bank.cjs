'use strict';

// The governance question bank: `toolkit governance` (also `setup governance` and `refresh governance`)
// shows the repository's governance choices in the same bank format as `setup toolkit`
// (toolkit-question-bank.cjs), and the owner answers in chat with `all recommended` or only their
// changes, such as `1.2=B`.
//
// Only the owner answers. The bank keeps the governance gate's rule the way the yes/no reply does
// (owner decision of 28 Oct: the agent reads what the user means, Toolkit only checks it is the
// user's own reply):
//   1. Showing the bank notes, in Toolkit's private user state, that this run of this session was
//      shown bank <reference> for this repository (BankTickets.shown).
//   2. The UserPromptSubmit hook gives the owner's next own message in that run a one-use bank ticket
//      bound to the session, the run, the repository and the bank reference (BankTickets.issue). A
//      launched session, a relayed or scheduled prompt, a repeated Projects delivery or a reply after
//      another session started in the repository gets none.
//   3. The agent sends the reply it read with that ticket: `toolkit-governance.cjs setup --answers
//      "<reference>: all recommended" --ticket <ticket>`. The command spends the ticket (BankTickets.take)
//      and writes or prepares nothing without it. The tool gate lets only that exact command through.
//   4. The bank is shown once. A reply that cannot be used (unread, an unknown row, a changed row, or
//      "explain 1.4") gets a short line, and the command notes the same bank again for the run
//      (BankTickets.rearm), so the owner's next own message gets a new one-use ticket the same way.
// A pull request it prepares still decides nothing until the owner merges it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const bank = require('./toolkit-question-bank.cjs');
const { managedScript } = require('./toolkit-user-state.cjs');

const BANK_HOST = 'governance';
// What a yes to Turn on also covers: the settings Toolkit adds on its own after the merge
// (toolkit-governance-finish.cjs), named here so the owner sees them before answering.
const AFTER_MERGE = `After the merge, Toolkit also turns on, without asking again: ${require('./toolkit-governance-finish.cjs').WHAT}.`;
const BANK_TITLE = 'Toolkit governance choices';
const TICKETS_BASENAME = 'governance-bank-tickets.v1.json';
const TICKETS_SCHEMA = 'toolkit.governance-bank-tickets.v1';
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 32;
const TICKET = /^[0-9a-f]{32}$/;
const EPOCH = /^[0-9a-f]{32}$/;
const OWN_SCRIPT = path.join(__dirname, 'toolkit-governance.cjs');
// The script the agent is told to run: the managed checkout's when there is one, else this copy's.
const script = () => managedScript('toolkit-governance.cjs');
// Each row keeps its number from run to run, whichever rows apply (a row that does not apply leaves a
// gap), so an answer such as 1.6=A means the same row after the evidence store becomes a status row.
const FIXED_REFS = Object.freeze({
  governance: '1.1', 'task-auto-merge': '1.2', 'merge-train': '1.3', 'ci-shards': '1.4', 'evidence-store': '1.5', 'setup-pieces': '1.5',
  'governance-app': '1.6', 'parent-issue': '1.7', 'required-checks': '1.8', visibility: '1.9', 'instruction-copies': '1.10',
  'permission-blocks': '2.1',
});
// The line after a reply that could not be used, asking for the reply again.
const REPLY_AGAIN = 'Reply again with all recommended or only your changes, such as 1.2=B.';

// The app each permission row belongs to; every app keeps its own permission lines.
const APP_NAMES = Object.freeze({ claude: 'Claude Code', codex: 'Codex' });

const STATE_LABEL = Object.freeze({ ENABLED: 'On', DISABLED: 'Off', UNDECIDED: 'Not decided' });
// CI this slow on its last green run gets Yes recommended for parallel shards: the first shard list
// names one shard per this many minutes, so below it shards add setup for little time saved.
const SLOW_CI_MINUTES = require('./toolkit-ci-shards-offer.cjs').MINUTES_PER_SHARD;

// ---- the rows -----------------------------------------------------------------------------------

function statusRow({ id, section, title, current, text }) {
  return {
    id, key: id, section, title, whatThisControls: title, report_only: true,
    currentState: { effectiveBehavior: current, verification: 'state-derived' },
    recommendation: null, choices: [], recommended_text: text, afterApplying: '',
    availability: { status: 'available', condition: 'Shown for information.' },
    description: title, current, current_short: current,
    recommended: '', recommended_outcome: text, recommendation_reason: 'Nothing to answer.',
  };
}

// The bank for one repository. `state` is the governance state, `task` the merged switch ('after-gates',
// 'off' or 'unset'), `merged` the merged binding (or null), `permissions` { missing, checked }, and
// `adoption` what turning governance on would make in a repository that is not prepared yet
// (toolkit-governance-adopt.cjs adoptionPlan; null when it is prepared or already on), `train` the
// merged merge trains switch ('on' or 'off'), `ciShards` the sharded CI offer ({ estimate: the
// minutes line, measured: the estimate or null }) where it is offered, or null, and `app` the governance
// App's variable and secret on GitHub (toolkit-governance-app.cjs presence; null when not read), and
// `copies` the instruction copies the cleanup route would remove ({ files, held? }: `held` is why the
// cleanup cannot run yet; null when not read).
function governanceBankSpecs({ state, task = 'unset', train = 'off', merged = null, permissions = { checked: false, missing: 0 }, adoption = null, ciShards = null, app = null, copies = null }) {
  const section = `Governance for ${state.repository || path.basename(state.root || '') || 'this repository'}`;
  const decided = state.state === 'ENABLED' || state.state === 'DISABLED';
  const specs = [];
  specs.push(bank.resolvedQuestion({
    id: 'governance', key: 'governance', section, title: 'GitHub governance',
    whatThisControls: 'Whether Toolkit runs GitHub governance here: programme issues, decision records and an evidence store.',
    current: STATE_LABEL[state.state],
    currentChoice: state.state === 'ENABLED' ? 'on' : state.state === 'DISABLED' ? 'off' : '',
    recommendation: decided
      ? { value: 'keep', outcome: 'Governance stays as merged.', reason: 'Nothing needs to change.' }
      : { value: 'on', outcome: `Toolkit prepares one pull request that turns governance on. ${AFTER_MERGE}`, reason: 'Governance keeps records and evidence for every task in this repository.' },
    choices: [
      bank.wizardChoice('keep', 'Keep current', decided ? 'Governance stays as merged.' : 'Nothing is decided; it counts as off and Toolkit asks again next session.'),
      bank.wizardChoice('on', 'Turn on', `Toolkit prepares one pull request that turns governance on. It applies only after you merge it. ${AFTER_MERGE}`),
      bank.wizardChoice('off', 'Turn off', 'Toolkit prepares one pull request that turns governance off. It applies only after you merge it.'),
    ],
  }));
  // Every option under governance can be On only while governance is On, or in the same answer that
  // turns it on; otherwise it reads Off (needs governance) and On says what it needs.
  const on = task === 'after-gates';
  const governed = state.state === 'ENABLED';
  specs.push(bank.resolvedQuestion({
    id: 'task-auto-merge', key: 'taskAutoMerge', section, title: 'Task auto-merge',
    whatThisControls: 'Whether finished task pull requests merge once their review, checks and testing pass. It applies only while governance is on.',
    current: governed ? (on ? 'On' : 'Off') : 'Off (needs governance)',
    currentChoice: governed ? (on ? 'on' : 'off') : '',
    recommendation: { value: 'keep', outcome: 'Task auto-merge stays as it is.', reason: 'Nothing needs to change.' },
    choices: governed ? [
      bank.wizardChoice('keep', 'Keep current', 'Task auto-merge stays as it is.'),
      bank.wizardChoice('on', 'On', 'Finished task pull requests merge once their gates pass.'),
      bank.wizardChoice('off', 'Off', 'Every pull request waits for your typed merge.'),
    ] : [
      bank.wizardChoice('keep', 'Keep current', 'Task auto-merge stays off.'),
      bank.wizardChoice('on', 'On (needs governance on)', 'Only together with turning governance on in the same answer; the same pull request sets it.'),
    ],
  }));
  const trainOn = governed && train === 'on';
  specs.push(bank.resolvedQuestion({
    id: 'merge-train', key: 'mergeTrain', section, title: 'Merge trains',
    whatThisControls: 'Whether reviewed pull requests that are ready together land as one merge train with one version bump. It applies only while governance is on.',
    current: governed ? (trainOn ? 'On' : 'Off') : 'Off (needs governance)',
    currentChoice: governed ? (trainOn ? 'on' : 'off') : '',
    recommendation: { value: 'keep', outcome: 'Merge trains stay as they are.', reason: 'Nothing needs to change.' },
    choices: governed ? [
      bank.wizardChoice('keep', 'Keep current', 'Merge trains stay as they are.'),
      bank.wizardChoice('on', 'On', 'Ready pull requests land together as one train with one version bump.'),
      bank.wizardChoice('off', 'Off', 'Each pull request lands on its own.'),
    ] : [
      bank.wizardChoice('keep', 'Keep current', 'Merge trains stay off.'),
      bank.wizardChoice('on', 'On (needs governance on)', 'Only together with turning governance on in the same answer; the same pull request sets it.'),
    ],
  }));
  // The sharded CI offer: asked in a governed repository with no final answer (again at each refresh
  // after not now, never again after never), and in the first bank, where a yes joins the one turn-on
  // pull request (toolkit-ci-shards-offer.cjs). `ciShards` is null where it is not offered.
  const answered = merged?.ci_shards?.answer;
  if (governed && (answered === 'yes' || answered === 'never')) {
    specs.push(statusRow({ id: 'ci-shards', section, title: 'Parallel CI shards', current: answered === 'yes' ? 'Yes' : 'Never ask',
      text: answered === 'yes' ? 'Bound in the merged programme file; the next rules refresh copies the shard workflows while the shard list is usable' : 'Bound in the merged programme file; Toolkit does not ask again' }));
  } else if (ciShards) {
    // Slow CI (SLOW_CI_MINUTES or more on its last green run) is where shards pay off, so Yes is
    // recommended there; fast or unknown CI keeps Not now. The minutes line is display-only and kept
    // out of the hashed question text, so a CI run that finishes between showing the bank and
    // answering it changes the bank reference only when it crosses the threshold.
    const slow = Number.isFinite(ciShards.measured?.minutes) && ciShards.measured.minutes >= SLOW_CI_MINUTES;
    const yesOutcome = governed
      ? 'Toolkit prepares one binding pull request with the answer and a first shard list. It applies only after you merge it.'
      : 'The turn-on pull request also records yes and adds a first shard list and the shard workflows. It applies only after you merge it.';
    specs.push({ ...bank.resolvedQuestion({
      id: 'ci-shards', key: 'ciShards', section, title: 'Parallel CI shards',
      whatThisControls: 'Run tests in parallel CI jobs so they finish faster? It uses about the same CI minutes.',
      current: answered === 'not-now' ? 'Not now' : 'Not asked yet',
      currentChoice: '',
      recommendation: slow
        ? { value: 'yes', outcome: yesOutcome, reason: `The last green CI run took ${SLOW_CI_MINUTES} minutes or more, so parallel shards finish it sooner for about the same minutes.` }
        : { value: 'not-now', outcome: 'Nothing is written; Toolkit asks again at the next refresh.', reason: `CI is under ${SLOW_CI_MINUTES} minutes or its time is unknown, so shards would add setup minutes for little time saved.` },
      choices: [
        bank.wizardChoice('not-now', 'Not now', 'Nothing is written; Toolkit asks again at the next refresh.'),
        bank.wizardChoice('yes', governed ? 'Yes' : 'Yes (needs governance on)', yesOutcome),
        bank.wizardChoice('never', governed ? 'Never ask' : 'Never ask (needs governance on)', governed ? 'Toolkit prepares one binding pull request recording never; it does not ask again.' : 'The turn-on pull request records never; Toolkit does not ask again.'),
      ],
    }), estimateLine: ciShards.estimate || '', estimateShort: estimateShort(ciShards.measured) });
  }
  if (adoption && adoption.blocked) {
    specs.push(statusRow({ id: 'setup-pieces', section, title: 'Store and parent issue', current: 'Could not be checked', text: `GitHub could not be read (${adoption.blocked}), so turning on makes nothing until it can` }));
  } else if (adoption) {
    if (adoption.store_choice) {
      specs.push(bank.resolvedQuestion({
        id: 'evidence-store', key: 'evidenceStore', section, title: 'Evidence store',
        whatThisControls: 'The separate private repository where agents keep plans, reviews and archives for this one.',
        current: adoption.found_store.split('/')[1],
        recommendation: { value: 'keep', outcome: `Governance uses ${adoption.found_store}.`, reason: 'It is private, yours and already laid out as a store.' },
        choices: [
          bank.wizardChoice('keep', 'Keep current', `Governance uses ${adoption.found_store}.`),
          bank.wizardChoice('new', 'Create a new private store', `Toolkit creates a private ${adoption.store_name} when governance turns on.`),
        ],
      }));
    } else {
      specs.push(statusRow({ id: 'evidence-store', section, title: 'Evidence store', current: adoption.found_store ? adoption.found_store.split('/')[1] : 'None yet', text: adoption.found_store ? 'Reused when governance turns on' : `Toolkit creates a private ${adoption.store_name} when governance turns on` }));
    }
    specs.push(statusRow({ id: 'parent-issue', section, title: 'Parent issue', current: adoption.parent.create ? 'None yet' : `#${adoption.parent.issue}`, text: adoption.parent.create ? 'Toolkit opens one when governance turns on' : 'Reused when governance turns on' }));
    // With none yet, the turn-on result says how to add protection later (turnOnSummary).
    specs.push(statusRow({ id: 'required-checks', section, title: 'Required checks', current: adoption.checks.length ? adoption.checks.join(', ') : 'None yet', text: adoption.checks.length ? 'Taken from what the default branch already enforces' : 'Default-branch protection waits for them' }));
    // Said before the answer, so turning on never stops afterwards to ask about it.
    if (adoption.visibility === 'public') specs.push(statusRow({ id: 'visibility', section, title: 'Repository visibility', current: 'Public', text: 'The programme file names your private evidence store (its name only, never its contents) and the parent issue is public. The store stays private' }));
  }
  if (state.state === 'ENABLED' && merged) {
    specs.push(statusRow({ id: 'evidence-store', section, title: 'Evidence store', current: merged.store.repository, text: 'Bound in the merged programme file' }));
    specs.push(statusRow({ id: 'required-checks', section, title: 'Required checks', current: merged.required_checks.length ? merged.required_checks.join(', ') : 'none listed', text: 'Bound in the merged programme file' }));
  }
  // The governance App: Set up is recommended whenever governance is on or being turned on. The owner
  // runs the App setup command; Toolkit never makes the App or saves its key.
  const appSet = app && app.variable === 'found' && app.secret === 'found';
  const appPart = app && !appSet && (app.variable === 'found' || app.secret === 'found');
  if (appSet || appPart) {
    specs.push(statusRow({ id: 'governance-app', section, title: 'Governance App', current: appSet ? 'Set up' : 'Partly set up',
      text: appSet ? 'Its variable and secret are on GitHub' : 'toolkit governance check shows how to finish or replace it' }));
  } else {
    const off = state.state === 'DISABLED';
    specs.push(bank.resolvedQuestion({
      id: 'governance-app', key: 'governanceApp', section, title: 'Governance App',
      whatThisControls: "This repository's own GitHub App, which the governance jobs on GitHub use to open pull requests and keep records. It applies only while governance is on.",
      current: off ? 'Off (needs governance)' : app && app.variable === 'missing' && app.secret === 'missing' ? 'Not set up' : 'Not checked',
      recommendation: off
        ? { value: 'keep', outcome: 'No App is made.', reason: 'Governance is off.' }
        : { value: 'setup', outcome: 'You get one command to run yourself that makes the App and saves its key on this repository.', reason: 'Without it the governance jobs on GitHub cannot open pull requests.' },
      choices: [
        bank.wizardChoice('keep', 'Keep current', 'Not now: no App is made. Governance works without it, and toolkit governance check keeps showing how to add it.'),
        bank.wizardChoice('setup', off ? 'Set up (needs governance on)' : 'Set up', 'You get one command to run yourself in your own PowerShell or terminal: you click Create on GitHub, and it saves the App\'s Client ID and key on this repository and opens its install page.'),
      ],
    }));
  }
  // The cleanup route (toolkit-governance-cleanup.cjs): asked only in a governed repository that still
  // has instruction copies. Removing files is the owner's own choice, so Keep current is recommended
  // and all recommended removes nothing.
  if (governed && copies && copies.files > 0 && copies.held) {
    specs.push(statusRow({ id: 'instruction-copies', section, title: 'Toolkit instruction copies', current: `${copies.files} ${copies.files === 1 ? 'file' : 'files'} left, cleanup held`, text: `Not offered yet: ${copies.held}. Refresh the cloud workflow copies first` }));
  } else if (governed && copies && copies.files > 0) {
    specs.push(bank.resolvedQuestion({
      id: 'instruction-copies', key: 'instructionCopies', section, title: 'Toolkit instruction copies',
      whatThisControls: 'The governed rules block, playbooks and one-line shims older setups copied into this repository. The installed Toolkit now gives sessions these rules, so the copies are leftovers.',
      current: `${copies.files} ${copies.files === 1 ? 'file' : 'files'} to clean up`,
      currentChoice: '',
      recommendation: { value: 'keep', outcome: 'The copies stay; Toolkit asks again at the next refresh.', reason: 'Removing files is your choice, made when you are ready to merge one cleanup pull request.' },
      choices: [
        bank.wizardChoice('keep', 'Keep current', 'The copies stay; Toolkit asks again at the next refresh.'),
        bank.wizardChoice('clean', 'Clean up', 'Toolkit removes them in the working tree, keeping everything of yours, and sets min_toolkit in the programme file. You merge the one pull request yourself.'),
      ],
    }));
  }
  const appName = APP_NAMES[permissions.host] || 'this app';
  const missing = permissions.checked ? permissions.missing : null;
  const stale = permissions.checked ? permissions.stale || 0 : 0;
  const outdated = missing !== null && (missing > 0 || stale > 0);
  specs.push(bank.resolvedQuestion({
    id: 'permission-blocks', key: 'permissionBlocks', section: 'This computer', title: `Toolkit permissions (${appName})`,
    whatThisControls: `The Toolkit permission lines that let ${appName} run Toolkit's own commands without asking each time. Other apps keep their own.`,
    current: missing === null ? 'Not checked' : outdated ? `Outdated: ${[missing ? `${missing} missing` : '', stale ? `${stale} old` : ''].filter(Boolean).join(', ')}` : 'Up to date',
    currentChoice: missing !== null && !outdated ? 'update' : '',
    recommendation: outdated
      ? { value: 'update', outcome: 'You get one command to run in your own PowerShell or terminal that brings them up to date.', reason: 'Without them every Toolkit command asks again.' }
      : { value: 'keep', outcome: 'Nothing changes.', reason: missing === 0 ? 'They are already up to date.' : 'They could not be checked here.' },
    choices: [
      bank.wizardChoice('keep', 'Keep current', 'Nothing changes.'),
      bank.wizardChoice('update', 'Update', 'You get one command to run yourself: it shows what changes, backs the file up and waits for you to press Enter.'),
      bank.wizardChoice('remove', 'Remove', 'You get one command to run yourself that takes every Toolkit permission line out, the same way.'),
    ],
  }));
  return bank.withPresentationMetadata(specs.map(spec => ({ ...spec, fixed_ref: FIXED_REFS[spec.id] })), BANK_HOST);
}

// The minutes in a few words for the shards row's Current cell; the full line is in explain.
function estimateShort(measured) {
  return Number.isFinite(measured?.minutes) ? `CI about ${Math.max(1, Math.round(measured.minutes))} min` : 'CI time unknown';
}

// The shard question's longer text, shown only on "explain 1.4": what Yes makes, when it is
// recommended, and the display-only minutes line.
const SHARDS_MORE = `Yes adds a first shard list (Node tests) and the shard workflows, which check every test file ran once: in the turn-on pull request when governance turns on in the same answer, otherwise in its own pull request, with the workflows at the next rules refresh. Yes is recommended when the last green CI run took ${SLOW_CI_MINUTES} minutes or more.`;
function shardMoreText(spec) { return [SHARDS_MORE, spec.estimateLine].filter(Boolean).join(' '); }

function bankReference(specs) { return specs[0]?.presentation.bank_reference || ''; }

// What the agent is told after every output that follows an answer: the owner sees Toolkit's own lines
// as printed and nothing else, so the bank is never shown again in reply to an answer.
// A command above is the owner's to run (permissions, the governance App), so it is shown, never run.
const AGENTS_AFTER_ANSWER = 'Agents: this line is for you alone. Show the owner the lines above exactly as printed, as plain text, leaving out this line, then stop. Add nothing, ask nothing, post no card, and never show the bank again unless the owner types toolkit governance. Never put a command above in a code block of your own making, and never run it yourself. If their next own message comes back with a Toolkit ticket, send it as that ticket says.';

// The bank as the owner reads it, with the one reply line. Every app takes a typed reply, the same way
// as `setup toolkit`: the whole list at once, answered in one line. Status rows sit in the table under
// their fixed numbers; the longer texts are in explain (explainText).
function renderGovernanceBank(specs) {
  const reference = bankReference(specs);
  // The shards row's Current cell carries the minutes in short; display only, so it is not in the
  // bank reference (a CI run that finishes before the answer changes nothing).
  const shown = specs.map(spec => (spec.id === 'ci-shards' && spec.estimateShort ? { ...spec, current_short: `${spec.current_short || spec.current} (${spec.estimateShort})` } : spec));
  return [
    ...bank.renderQuestionBankHeader(specs, true, false, BANK_TITLE),
    ...bank.renderCompactQuestionTable(shown, true),
    // Turn on covers the post-merge settings too, so they are named whenever it is offered, not
    // only when it is the recommendation (the table shows choice text only for that one).
    ...specs.filter(spec => spec.id === 'governance').flatMap(spec => spec.choices.filter(choice => choice.value === 'on' && choice.presentation_ref !== spec.presentation.recommended_choice_ref)
      .map(choice => `${spec.presentation.question_ref} ${choice.presentation_ref}. ${choice.label}: ${choice.consequence}`)).flatMap(line => ['', line]),
    '',
    'Reply all recommended, or only your changes such as 1.2=B. Rows you leave out take their recommendation; each change is a pull request you merge. Say "explain 1.4" for the full text of a row.',
    '',
    `Agents: this line is for you alone. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line, then stop. Their next own message comes back with a one-use ticket; send it with their answer as ${reference}: <their answer>. Never answer for them, and never show this bank again after they reply.`,
  ].join('\n');
}

// The full text of one row, for "explain 1.4", or null when the bank has no such row.
function explainText(specs, ref) {
  const spec = specs.find(entry => entry.presentation.question_ref === ref);
  if (!spec) return null;
  return [bank.renderQuestionRows(specs, ref).replace(/\n+---$/, ''),
    ...(spec.id === 'ci-shards' && !spec.report_only ? ['', `**More:** ${shardMoreText(spec)}`] : [])].join('\n');
}

// The row number a reply asks to explain ("explain 1.4", with or without the bank reference), or null.
function explainRequest(text) {
  const match = /^\s*(?:[0-9A-Za-z-]{16,19}\s*:\s*)?explain\s+(\d+\.\d+)\s*\.?\s*$/i.exec(String(text || ''));
  return match ? match[1] : null;
}

// A short digest of each row as shown, keyed by its number, so a reply to a bank that changed since
// can name only the rows that changed (changedRows).
function rowDigests(specs) {
  const payload = bank.questionBankApprovalPayload(specs);
  return Object.fromEntries(payload.questions.map(question => [question.question_ref, crypto.createHash('sha256').update(JSON.stringify(question)).digest('hex').slice(0, 16)]));
}

// The lines that name what changed between the bank the owner was shown (its row digests) and this
// one, or null when rows were added or taken away (then only a new bank can be answered).
function changedRows(before, specs) {
  const now = rowDigests(specs);
  const refs = Object.keys(now);
  if (!before || typeof before !== 'object' || Object.keys(before).length !== refs.length || refs.some(ref => !Object.hasOwn(before, ref))) return null;
  return specs.filter(spec => before[spec.presentation.question_ref] !== now[spec.presentation.question_ref]).map(spec => (spec.report_only
    ? `${spec.presentation.question_ref} ${spec.title} changed: now ${spec.current_short || spec.current}, with nothing to answer.`
    : `${spec.presentation.question_ref} ${spec.title} changed: now ${spec.current_short || spec.current}, recommended ${spec.presentation.recommended_choice_ref}. ${bank.choiceLabel(spec, spec.recommended)}.`));
}

// { governance, taskAutoMerge, permissionBlocks } from a parsed reply.
function selectionsOf(parsed, specs) {
  const byId = new Map(parsed.selections.map(entry => [entry.question_id, entry.canonical_value]));
  const value = id => {
    const spec = specs.find(entry => entry.id === id);
    const chosen = byId.get(id) || 'keep';
    // A hidden twin (the choice that changes nothing) applies as Keep current.
    return spec && spec.folded_value === chosen ? spec.folded_into : chosen;
  };
  const asked = specs.some(spec => spec.id === 'ci-shards' && !spec.report_only);
  return { governance: value('governance'), taskAutoMerge: value('task-auto-merge'), mergeTrain: value('merge-train'), governanceApp: value('governance-app'), permissionBlocks: value('permission-blocks'), evidenceStore: value('evidence-store'), ...(asked ? { ciShards: value('ci-shards') } : {}), ...(specs.some(spec => spec.id === 'instruction-copies' && !spec.report_only) ? { instructionCopies: value('instruction-copies') } : {}) };
}

function parseBankAnswer(text, specs, { requireBankReference = true } = {}) {
  const parsed = bank.parseConciseQuestionBankAnswer(text, specs, { requireBankReference, label: 'Governance' });
  if (!parsed) throw new Error('Governance question bank answer was not read.');
  bank.assertQuestionBankAnswerBinding(parsed, specs, 'Governance');
  const chosen = selectionsOf(parsed, specs);
  const governed = specs.find(entry => entry.id === 'governance')?.folded_value === 'on';
  // Every option under governance is On only while governance is on, or in the answer that turns it on.
  for (const [name, label] of [['taskAutoMerge', 'Task auto-merge'], ['mergeTrain', 'Merge trains']]) {
    if (chosen[name] === 'on' && (chosen.governance === 'off' || (!governed && chosen.governance !== 'on'))) {
      throw new Error(`${label} can be on only while governance is on: turn governance on in the same answer, or leave ${label.toLowerCase()} as it is.`);
    }
  }
  if (chosen.instructionCopies === 'clean' && chosen.governance === 'off') {
    throw new Error('The instruction copies can be cleaned up only while governance stays on: leave governance as it is, or leave the copies as they are.');
  }
  if (['yes', 'never'].includes(chosen.ciShards) && (chosen.governance === 'off' || (!governed && chosen.governance !== 'on'))) {
    throw new Error('Parallel CI shards can be answered only while governance is on: turn governance on in the same answer, or leave them as not now.');
  }
  return chosen;
}

// ---- bank tickets -------------------------------------------------------------------------------

function hash(ticket) { return crypto.createHash('sha256').update(String(ticket)).digest('hex'); }

class BankTickets {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(governance.userStateDirectory(registryOptions), TICKETS_BASENAME);
    this.#now = now;
  }

  // Unreadable or damaged state holds: nothing is shown as answerable and no ticket is given.
  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { schema: TICKETS_SCHEMA, shown: {}, tickets: {} };
      throw Object.assign(new Error('BANK_TICKETS_UNREADABLE'), { code: 'BANK_TICKETS_UNREADABLE' });
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const map = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!parsed || parsed.schema !== TICKETS_SCHEMA || !map(parsed.shown) || !map(parsed.tickets)) {
      throw Object.assign(new Error('BANK_TICKETS_MALFORMED'), { code: 'BANK_TICKETS_MALFORMED' });
    }
    return parsed;
  }

  #fresh(entry) {
    return Boolean(entry) && typeof entry === 'object' && Date.parse(entry.at) >= this.#now().getTime() - MAX_AGE_MS && EPOCH.test(String(entry.epoch));
  }

  #save(data) {
    const keep = record => Object.fromEntries(Object.entries(record).filter(([, entry]) => this.#fresh(entry))
      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_SESSIONS));
    const text = `${JSON.stringify({ schema: TICKETS_SCHEMA, shown: keep(data.shown), tickets: keep(data.tickets) })}\n`;
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, text, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
      if (fs.readFileSync(this.#file, 'utf8') !== text) throw Object.assign(new Error('BANK_TICKETS_READBACK'), { code: 'BANK_TICKETS_READBACK' });
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  // Notes that this run of the session was shown this bank. A newer bank replaces an older one and
  // drops any live ticket of the session, so a ticket always answers the bank shown last.
  // `rows` are the shown rows' digests (rowDigests).
  shown(sessionId, { epoch, repositoryMark = null, repositoryId, root, bankReference: reference, rows = {} }) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const data = this.#read();
    data.shown[sessionId] = {
      epoch, repository_mark: repositoryMark, repository_id: repositoryId, root, bank_reference: reference, rows, at: this.#now().toISOString(),
    };
    delete data.tickets[sessionId];
    this.#save(data);
    return true;
  }

  // The bank this run was shown and not yet replied to, or null. Read only.
  pendingFor(sessionId, epoch) {
    const data = this.#read();
    const entry = typeof sessionId === 'string' && Object.hasOwn(data.shown, sessionId) ? data.shown[sessionId] : null;
    return this.#fresh(entry) && entry.epoch === epoch ? entry : null;
  }

  // Whether this run has a bank waiting for the owner's reply or a live bank ticket.
  live(sessionId, epoch) {
    const data = this.#read();
    const ticket = typeof sessionId === 'string' && Object.hasOwn(data.tickets, sessionId) ? data.tickets[sessionId] : null;
    return this.pendingFor(sessionId, epoch) !== null || (this.#fresh(ticket) && ticket.epoch === epoch);
  }

  // Turns the shown bank into a ticket for the reply that just arrived: the note is spent, so only
  // the first own message after the bank gets one. Returns the ticket, or null.
  issue(sessionId, epoch) {
    const data = this.#read();
    const entry = Object.hasOwn(data.shown, sessionId) ? data.shown[sessionId] : null;
    if (!this.#fresh(entry) || entry.epoch !== epoch) return null;
    const ticket = crypto.randomBytes(16).toString('hex');
    delete data.shown[sessionId];
    data.tickets[sessionId] = { hash: hash(ticket), epoch, repository_mark: entry.repository_mark ?? null, repository_id: entry.repository_id, root: entry.root, bank_reference: entry.bank_reference, rows: entry.rows || {}, at: this.#now().toISOString() };
    this.#save(data);
    return ticket;
  }

  // After the owner's reply was sent with its ticket (`entry`, from take) and could not be used, notes
  // the bank again for the same run, repository mark and repository, so the owner's next own message
  // answers it the same way, with a new one-use ticket, and the bank is not shown again. `bankReference`
  // and `rows` name the bank that reply now answers (a changed bank's, once its changed rows were named).
  rearm(sessionId, entry, { bankReference: reference, rows }) {
    if (!entry || typeof entry !== 'object') return false;
    return this.shown(sessionId, { epoch: entry.epoch, repositoryMark: entry.repository_mark ?? null, repositoryId: entry.repository_id, root: entry.root, bankReference: reference, rows });
  }

  // Ends the shown note without a ticket (the reply could not count).
  drop(sessionId) {
    const data = this.#read();
    if (!Object.hasOwn(data.shown, sessionId) && !Object.hasOwn(data.tickets, sessionId)) return;
    delete data.shown[sessionId];
    delete data.tickets[sessionId];
    this.#save(data);
  }

  // The live ticket entry of this session, without spending it, or null.
  peek(ticket, sessionId) {
    if (!TICKET.test(String(ticket)) || typeof sessionId !== 'string' || sessionId === '') return null;
    const data = this.#read();
    const entry = Object.hasOwn(data.tickets, sessionId) ? data.tickets[sessionId] : null;
    return this.#fresh(entry) && entry.hash === hash(ticket) ? entry : null;
  }

  // Spends the ticket of this session and run; returns its entry, or null. A ticket that cannot be
  // removed is not used.
  take(ticket, sessionId, epoch) {
    const entry = this.peek(ticket, sessionId);
    if (!entry || entry.epoch !== epoch) return null;
    const data = this.#read();
    delete data.tickets[sessionId];
    this.#save(data);
    return this.peek(ticket, sessionId) === null ? entry : null;
  }
}

// What the agent is told with the owner's reply to a bank. Toolkit, not the agent, checks the reply:
// anything that may answer the bank is sent as it is, and the command prints what was wrong.
function bankTicketContext(entry, ticket) {
  return [
    `Toolkit governance: the user's message above is their first since governance bank ${entry.bank_reference} was shown or Toolkit asked them to reply again. It may answer it, or be ordinary work. Read what they mean first.`,
    `- If it may answer the bank in any way: only where its rows and choices are plain (all recommended, or changes such as 1.2=B in any words) put it in that form. Send anything else exactly as typed (a bare yes or ok, an unknown row, two choices for one row, explain 1.4, anything unclear), leaving out only quotes, $, % and backticks. Tell them "Sending: <answer> (bank ${entry.bank_reference})" and run exactly this once, with it in place of ANSWER:`,
    `  node "${script()}" setup --answers "${entry.bank_reference}: ANSWER" --ticket ${ticket}`,
    '- Toolkit checks it and prints what was wrong or what it did; do what its Agents line says. Never show the bank again yourself and never ask them to reply in another form.',
    '- If it is clearly about something else, record nothing and carry on.',
    'The ticket works once, only in this session, and only for this bank. Never act as the user: never answer the bank yourself or change their answer.',
  ].join('\n');
}

// Whether a shell command is exactly the bank answer command with a live ticket of this session.
// The script must be Toolkit's own path as written, and the line holds nothing a shell expands and
// no curly quote, which PowerShell reads as a quote and so could end the answer early.
const BANK_COMMAND = /^[ \t]*(?:&[ \t]*)?node(?:\.exe)?[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[ \t]+setup[ \t]+--answers[ \t]+"([^"\r\n]{1,400})"[ \t]+--ticket[ \t]+([0-9a-f]{32})[ \t]*$/;
// The script is this copy's or the managed checkout's (the one bankTicketContext names), exactly.
function sameScript(written) {
  const same = known => (process.platform === 'win32'
    ? written.replace(/\//g, '\\').toLowerCase() === known.replace(/\//g, '\\').toLowerCase()
    : written === known);
  return same(OWN_SCRIPT) || same(script());
}
function bankTicketCommand(text, sessionId, tickets) {
  const command = String(text || '');
  if (/[$`%\u2018-\u201f]/.test(command)) return false;
  const match = BANK_COMMAND.exec(command);
  if (!match || typeof sessionId !== 'string' || sessionId === '') return false;
  if (!sameScript(match[1] ?? match[2] ?? match[3])) return false;
  try { return tickets.peek(match[5], sessionId) !== null; } catch { return false; }
}

module.exports = Object.freeze({
  APP_NAMES, BANK_HOST, TICKETS_BASENAME, AGENTS_AFTER_ANSWER, REPLY_AGAIN, BankTickets, governanceBankSpecs, renderGovernanceBank, parseBankAnswer, bankReference,
  explainText, explainRequest, rowDigests, changedRows, bankTicketContext, bankTicketCommand,
});
