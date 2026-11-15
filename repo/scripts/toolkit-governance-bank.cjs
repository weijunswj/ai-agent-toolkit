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
// A pull request it prepares still decides nothing until the owner merges it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const bank = require('./toolkit-question-bank.cjs');

const BANK_HOST = 'governance';
const BANK_TITLE = 'Toolkit governance choices';
const TICKETS_BASENAME = 'governance-bank-tickets.v1.json';
const TICKETS_SCHEMA = 'toolkit.governance-bank-tickets.v1';
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 32;
const TICKET = /^[0-9a-f]{32}$/;
const EPOCH = /^[0-9a-f]{32}$/;
const SCRIPT = path.join(__dirname, 'toolkit-governance.cjs');

// The app each permission row belongs to; every app keeps its own permission lines.
const APP_NAMES = Object.freeze({ claude: 'Claude Code', codex: 'Codex' });

const STATE_LABEL = Object.freeze({ ENABLED: 'On', DISABLED: 'Off', UNDECIDED: 'Not decided' });

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
// minutes line }) for a repository whose merged binding turns governance on, and `app` the governance
// App's variable and secret on GitHub (toolkit-governance-app.cjs presence; null when not read).
function governanceBankSpecs({ state, task = 'unset', train = 'off', merged = null, permissions = { checked: false, missing: 0 }, adoption = null, ciShards = null, app = null }) {
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
      : { value: 'on', outcome: 'Toolkit prepares one pull request that turns governance on.', reason: 'Governance keeps records and evidence for every task in this repository.' },
    choices: [
      bank.wizardChoice('keep', 'Keep current', decided ? 'Governance stays as merged.' : 'Nothing is decided; it counts as off and Toolkit asks again next session.'),
      bank.wizardChoice('on', 'Turn on', 'Toolkit prepares one pull request that turns governance on. It applies only after you merge it.'),
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
  // The sharded CI offer: asked only in a governed repository, again at each refresh after not now,
  // never again after never (toolkit-ci-shards-offer.cjs).
  if (state.state === 'ENABLED' && merged) {
    const answered = merged.ci_shards?.answer;
    if (answered === 'yes' || answered === 'never') {
      specs.push(statusRow({ id: 'ci-shards', section, title: 'Parallel CI shards', current: answered === 'yes' ? 'Yes' : 'Never ask',
        text: answered === 'yes' ? 'Bound in the merged programme file; the next rules refresh copies the shard workflows while the shard list is usable' : 'Bound in the merged programme file; Toolkit does not ask again' }));
    } else {
      // The minutes line is display-only and kept out of the hashed question text: a CI run that
      // finishes between showing the bank and answering it must not change the bank reference.
      specs.push({ ...bank.resolvedQuestion({
        id: 'ci-shards', key: 'ciShards', section, title: 'Parallel CI shards',
        whatThisControls: "Split this repository's tests into parallel CI shards? Yes writes a first shard list (Node tests run with node --test) in the same pull request as the answer; the next rules refresh copies the Toolkit test shards workflow, whose gate checks every test file ran once, and Shard Timings.",
        current: answered === 'not-now' ? 'Not now' : 'Not asked yet',
        currentChoice: '',
        recommendation: { value: 'not-now', outcome: 'Nothing is written; Toolkit asks again at the next refresh.', reason: 'Splitting adds CI jobs and minutes, so it is your call.' },
        choices: [
          bank.wizardChoice('not-now', 'Not now', 'Nothing is written; Toolkit asks again at the next refresh.'),
          bank.wizardChoice('yes', 'Yes', 'Toolkit prepares one binding pull request with the answer and a first shard list. It applies only after you merge it.'),
          bank.wizardChoice('never', 'Never ask', 'Toolkit prepares one binding pull request recording never; it does not ask again.'),
        ],
      }), estimateLine: ciShards?.estimate || '' });
    }
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
    specs.push(statusRow({ id: 'required-checks', section, title: 'Required checks', current: adoption.checks.length ? adoption.checks.join(', ') : 'none yet', text: 'Taken from what the default branch already enforces' }));
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
      bank.wizardChoice('update', 'Update', 'You get one command to run yourself: it shows what changes, backs the file up and waits for you to type apply.'),
      bank.wizardChoice('remove', 'Remove', 'You get one command to run yourself that takes every Toolkit permission line out, the same way.'),
    ],
  }));
  return bank.withPresentationMetadata(specs, BANK_HOST);
}

// The shard question as shown: the hashed text plus the display-only minutes line.
function shardQuestionText(spec) { return [spec.whatThisControls, spec.estimateLine].filter(Boolean).join(' '); }

function bankReference(specs) { return specs[0]?.presentation.bank_reference || ''; }

// The bank as the owner reads it, with the one reply line.
// `card`: the host shows the bank as Claude Code's question card (cardInstruction) instead of a typed reply.
function renderGovernanceBank(specs, { card = false } = {}) {
  const reference = bankReference(specs);
  const governed = specs.find(entry => entry.id === 'governance')?.folded_value === 'on';
  const example = bank.changedOnlyExample(specs, governed ? ['governance', 'task-auto-merge'] : ['governance']);
  return [
    ...bank.renderQuestionBankHeader(specs, true, false, BANK_TITLE),
    ...bank.renderCompactQuestionTable(specs, true),
    ...specs.filter(spec => spec.id === 'ci-shards' && !spec.report_only).map(spec => `\n${spec.presentation.question_ref} asks: ${shardQuestionText(spec)}`),
    '',
    'For the full text of a question, say "explain 1.2".',
    '',
    'Reply with either:',
    '',
    '- `all recommended`',
    `- only your changes, for example: \`${example}\``,
    '',
    'Anything you do not list takes its recommendation. Every change to governance, task auto-merge or parallel CI shards is a pull request that applies only after you merge it.',
    'The permissions row covers only this app. Any other app you use needs toolkit governance run there too.',
    '',
    card ? cardInstruction(specs)
      : `Agents: this line is for you alone. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line, then stop. Their next own message comes back with a one-use ticket; send it with their answer as ${reference}: <their answer>. Never answer for them.`,
  ].join('\n');
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
  return { governance: value('governance'), taskAutoMerge: value('task-auto-merge'), mergeTrain: value('merge-train'), governanceApp: value('governance-app'), permissionBlocks: value('permission-blocks'), evidenceStore: value('evidence-store'), ...(asked ? { ciShards: value('ci-shards') } : {}) };
}

function parseBankAnswer(text, specs, { requireBankReference = true } = {}) {
  const parsed = bank.parseConciseQuestionBankAnswer(text, specs, { requireBankReference, label: 'Governance' });
  if (!parsed) throw new Error('Governance question bank answer was not read: reply with all recommended or only your changes, such as 1.2=B.');
  bank.assertQuestionBankAnswerBinding(parsed, specs, 'Governance');
  const chosen = selectionsOf(parsed, specs);
  const governed = specs.find(entry => entry.id === 'governance')?.folded_value === 'on';
  // Every option under governance is On only while governance is on, or in the answer that turns it on.
  for (const [name, label] of [['taskAutoMerge', 'Task auto-merge'], ['mergeTrain', 'Merge trains']]) {
    if (chosen[name] === 'on' && (chosen.governance === 'off' || (!governed && chosen.governance !== 'on'))) {
      throw new Error(`${label} can be on only while governance is on: turn governance on in the same answer, or leave ${label.toLowerCase()} as it is.`);
    }
  }
  if (['yes', 'never'].includes(chosen.ciShards) && chosen.governance === 'off') {
    throw new Error('Parallel CI shards are offered only while governance is on: leave them as not now when turning governance off.');
  }
  return chosen;
}

// ---- the card (Claude Code) ----------------------------------------------------------------------

// In Claude Code the owner answers on the app's own question cards (AskUserQuestion) instead of typing.
// The cards carry every answerable row in bank order, its options lettered as in the bank, at most four
// rows a card; the tool gate lets only the next exact card through for the bank shown last, and once
// every card is tapped the taps come back as one bank answer with a one-use ticket
// (toolkit-governance-gate.cjs PromptHold.bankPicked).
const CARD_HEADERS = Object.freeze({ governance: 'Governance', 'task-auto-merge': 'Auto-merge', 'merge-train': 'Trains', 'ci-shards': 'CI shards', 'evidence-store': 'Store', 'governance-app': 'App', 'permission-blocks': 'Permissions' });
// The app's card holds at most four questions; a bank with more is split over several cards.
const CARD_MAX = 4;
const CARD_KEYS = Object.freeze(['questions', 'metadata']);
const CARD_QUESTION = /^(\d+\.\d+) /;
const CARD_OPTION = /^([A-D])\. /;

function bankCards(specs) {
  const questions = specs.filter(spec => !spec.report_only).map(spec => ({
    // The sharded CI offer carries its question and minutes line on the card too.
    question: `${spec.presentation.question_ref} ${spec.title} (now: ${spec.current})${spec.id === 'ci-shards' ? `: ${shardQuestionText(spec)}` : ''}`,
    header: CARD_HEADERS[spec.id] || 'Governance',
    multiSelect: false,
    options: spec.choices.map(choice => ({
      label: `${choice.presentation_ref}. ${choice.label}${choice.value === spec.recommended ? ' (Recommended)' : ''}`,
      description: choice.consequence,
    })),
  }));
  const cards = [];
  for (let at = 0; at < questions.length; at += CARD_MAX) cards.push({ questions: questions.slice(at, at + CARD_MAX) });
  return cards;
}

// The card's questions in one fixed form, or null when the input carries anything else (an answer
// filled in by the caller, a multi-select, an extra field).
function cardShape(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !CARD_KEYS.includes(key))) return null;
  const { questions } = input;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const shaped = [];
  for (const question of questions) {
    if (!question || typeof question !== 'object' || Object.keys(question).some(key => !['question', 'header', 'multiSelect', 'options'].includes(key))) return null;
    if (question.multiSelect !== undefined && question.multiSelect !== false) return null;
    if (!Array.isArray(question.options) || question.options.some(option => !option || typeof option !== 'object' || Object.keys(option).some(key => !['label', 'description'].includes(key)))) return null;
    shaped.push({ question: question.question, header: question.header, options: question.options.map(option => ({ label: option.label, description: option.description })) });
  }
  return shaped;
}

function cardHash(input) {
  const shaped = cardShape(input);
  return shaped ? crypto.createHash('sha256').update(JSON.stringify(shaped)).digest('hex') : null;
}

// The owner's taps as a bank answer ("1.1=A, 1.2=A, 2.1=B"), or null unless every question was
// answered with one of its own options (a typed "Other" answer is not a tap).
function cardAnswer(questions, answers) {
  if (!Array.isArray(questions) || !answers || typeof answers !== 'object') return null;
  const parts = [];
  for (const question of questions) {
    const ref = CARD_QUESTION.exec(String(question && question.question || ''));
    const label = Object.hasOwn(answers, question.question) ? answers[question.question] : null;
    const option = ref && typeof label === 'string' && Array.isArray(question.options) ? question.options.find(entry => entry && entry.label === label) : null;
    const letter = option ? CARD_OPTION.exec(option.label) : null;
    if (!letter) return null;
    parts.push(`${ref[1]}=${letter[1]}`);
  }
  return parts.join(', ');
}

// What the agent is told after the bank in Claude Code: the first card; the next one comes with the
// owner's taps (cardNextContext).
function cardInstruction(specs) {
  const status = specs.some(spec => spec.report_only);
  const cards = bankCards(specs);
  return [
    `Agents (Claude Code): this paragraph is for you alone; never show the owner any of it or the card input. Do not show the table above${status ? '; tell the owner the Status lines above in one plain sentence each' : ''}, then call AskUserQuestion once with exactly this input, adding no answers field, and stop:`,
    JSON.stringify(cards[0]),
    cards.length > 1 ? `This is card 1 of ${cards.length}. Their taps come back to you with the next card, and after the last card with the exact command to send.` : 'Their taps come back to you with the exact command to send.',
    'If the card cannot be shown, show the table above instead, as plain text and never in a code block.',
  ].join('\n');
}

// What the agent is told after the owner tapped a card that is not the bank's last.
function cardNextContext(entry, index) {
  return [
    `Toolkit governance: the owner tapped card ${index + 1} of ${entry.cards.length} of governance bank ${entry.bank_reference}. Nothing is sent yet.`,
    'Call AskUserQuestion once with exactly this input, adding no answers field, and stop:',
    JSON.stringify(entry.card_inputs[index + 1]),
    'Never act as the user: never answer the card yourself.',
  ].join('\n');
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
  // `cards` are the bank's card inputs where the host shows them (bankCards).
  shown(sessionId, { epoch, repositoryMark = null, repositoryId, root, bankReference: reference, cards = null }) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const data = this.#read();
    data.shown[sessionId] = {
      epoch, repository_mark: repositoryMark, repository_id: repositoryId, root, bank_reference: reference, at: this.#now().toISOString(),
      ...(cards && cards.length ? {
        cards: cards.map(cardHash), card_inputs: cards, card_taps: [],
        card_questions: cards.flatMap(card => card.questions.map(question => question.question)),
      } : {}),
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
    data.tickets[sessionId] = { hash: hash(ticket), epoch, repository_id: entry.repository_id, root: entry.root, bank_reference: entry.bank_reference, at: this.#now().toISOString() };
    this.#save(data);
    return ticket;
  }

  // Notes the owner's taps on one card of the shown bank, which must be the next card. Returns the
  // updated entry, or null.
  tap(sessionId, epoch, index, answer) {
    const data = this.#read();
    const entry = Object.hasOwn(data.shown, sessionId) ? data.shown[sessionId] : null;
    if (!this.#fresh(entry) || entry.epoch !== epoch || !Array.isArray(entry.card_taps) || entry.card_taps.length !== index) return null;
    entry.card_taps = [...entry.card_taps, answer];
    this.#save(data);
    return entry;
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

// What the agent is told with the owner's reply to a bank.
function bankTicketContext(entry, ticket) {
  return [
    `Toolkit governance: the user's message above is the first since you showed them governance bank ${entry.bank_reference}. It may be their answer to it, or ordinary work. Read what they mean first.`,
    `- If it answers the bank (all recommended, or changes such as 1.2=B, in any words), turn it into that form, tell them "Sending: <answer> (bank ${entry.bank_reference})", and run exactly this once, with their answer in place of ANSWER:`,
    `  node "${SCRIPT}" setup --answers "${entry.bank_reference}: ANSWER" --ticket ${ticket}`,
    '- If it is unclear (a bare yes or ok, an unknown row, two choices for one row), ask one short question naming the two reply forms, then run `setup` again to show the bank before they answer.',
    '- If it is about something else, record nothing and carry on.',
    'The ticket works once, only in this session, and only for this bank. Never act as the user: never answer the bank yourself or change their answer.',
  ].join('\n');
}

// What the agent is told after the owner tapped every row on the bank's card.
function bankCardContext(entry, ticket, answer) {
  return [
    `Toolkit governance: the owner answered governance bank ${entry.bank_reference} on the card: ${answer}.`,
    'Run exactly this once, on its own, then tell the owner in plain words what it prepared:',
    `node "${SCRIPT}" setup --answers "${entry.bank_reference}: ${answer}" --ticket ${ticket}`,
    'The ticket works once, only in this session, and only for this bank. Never act as the user: never change their answer.',
  ].join('\n');
}

// Whether a shell command is exactly the bank answer command with a live ticket of this session.
// The script must be Toolkit's own path as written, and the line holds nothing a shell expands.
const BANK_COMMAND = /^[ \t]*(?:&[ \t]*)?node(?:\.exe)?[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[ \t]+setup[ \t]+--answers[ \t]+"([^"\r\n]{1,400})"[ \t]+--ticket[ \t]+([0-9a-f]{32})[ \t]*$/;
function sameScript(script) {
  return process.platform === 'win32'
    ? script.replace(/\//g, '\\').toLowerCase() === SCRIPT.replace(/\//g, '\\').toLowerCase()
    : script === SCRIPT;
}
function bankTicketCommand(text, sessionId, tickets) {
  const command = String(text || '');
  if (/[$`%]/.test(command)) return false;
  const match = BANK_COMMAND.exec(command);
  if (!match || typeof sessionId !== 'string' || sessionId === '') return false;
  if (!sameScript(match[1] ?? match[2] ?? match[3])) return false;
  try { return tickets.peek(match[5], sessionId) !== null; } catch { return false; }
}

module.exports = Object.freeze({
  APP_NAMES, BANK_HOST, TICKETS_BASENAME, BankTickets, governanceBankSpecs, renderGovernanceBank, parseBankAnswer, bankReference,
  bankTicketContext, bankTicketCommand, bankCards, bankCardContext, cardAnswer, cardHash, cardInstruction, cardNextContext,
});
