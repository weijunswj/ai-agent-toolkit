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
// (toolkit-governance-adopt.cjs adoptionPlan; null when it is prepared or already on).
function governanceBankSpecs({ state, task = 'unset', merged = null, permissions = { checked: false, missing: 0 }, adoption = null }) {
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
  const on = task === 'after-gates';
  specs.push(bank.resolvedQuestion({
    id: 'task-auto-merge', key: 'taskAutoMerge', section, title: 'Task auto-merge',
    whatThisControls: 'Whether finished task pull requests merge once their review, checks and testing pass. It applies only while governance is on.',
    current: on ? 'On' : 'Off',
    currentChoice: on ? 'on' : 'off',
    recommendation: { value: 'keep', outcome: 'Task auto-merge stays as it is.', reason: 'Nothing needs to change.' },
    choices: [
      bank.wizardChoice('keep', 'Keep current', 'Task auto-merge stays as it is.'),
      bank.wizardChoice('on', 'On', 'Finished task pull requests merge once their gates pass.'),
      bank.wizardChoice('off', 'Off', 'Every pull request waits for your typed merge.'),
    ],
  }));
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
  const missing = permissions.checked ? permissions.missing : null;
  specs.push(bank.resolvedQuestion({
    id: 'permission-blocks', key: 'permissionBlocks', section: 'This computer', title: 'Toolkit permission blocks',
    whatThisControls: "The paste-once permission lines that let an agent run Toolkit's own commands without asking each time.",
    current: missing === null ? 'Not checked' : missing === 0 ? 'In place' : `${missing} line${missing === 1 ? '' : 's'} missing`,
    recommendation: missing > 0
      ? { value: 'add', outcome: 'The agent adds the missing lines for you, backs the file up first and reads it back.', reason: 'Without them every Toolkit command asks again.' }
      : { value: 'keep', outcome: 'Nothing changes.', reason: missing === 0 ? 'Every line is already in place.' : 'The lines could not be checked here.' },
    choices: [
      bank.wizardChoice('keep', 'Keep current', 'Nothing changes.'),
      bank.wizardChoice('add', 'Add them for me', 'The agent adds exactly the printed lines, backs the file up first and reads it back.'),
      bank.wizardChoice('show', 'Show me the command', 'Toolkit prints the blocks and one command you paste into your own terminal.'),
    ],
  }));
  return bank.withPresentationMetadata(specs, BANK_HOST);
}

function bankReference(specs) { return specs[0]?.presentation.bank_reference || ''; }

// The bank as the owner reads it, with the one reply line.
function renderGovernanceBank(specs) {
  const reference = bankReference(specs);
  const example = bank.changedOnlyExample(specs, ['governance', 'task-auto-merge']);
  return [
    ...bank.renderQuestionBankHeader(specs, true, false, BANK_TITLE),
    ...bank.renderCompactQuestionTable(specs, true),
    '',
    'For the full text of a question, say "explain 1.2".',
    '',
    'Reply with either:',
    '',
    '- `all recommended`',
    `- only your changes, for example: \`${example}\``,
    '',
    'Anything you do not list takes its recommendation. Every change to governance or task auto-merge is one pull request that applies only after you merge it.',
    '',
    `Agents: show this bank to the owner exactly, then stop. Their next own message comes back with a one-use ticket; send it with their answer as ${reference}: <their answer>. Never answer for them.`,
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
  return { governance: value('governance'), taskAutoMerge: value('task-auto-merge'), permissionBlocks: value('permission-blocks'), evidenceStore: value('evidence-store') };
}

function parseBankAnswer(text, specs, { requireBankReference = true } = {}) {
  const parsed = bank.parseConciseQuestionBankAnswer(text, specs, { requireBankReference, label: 'Governance' });
  if (!parsed) throw new Error('Governance question bank answer was not read: reply with all recommended or only your changes, such as 1.2=B.');
  bank.assertQuestionBankAnswerBinding(parsed, specs, 'Governance');
  return selectionsOf(parsed, specs);
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
  shown(sessionId, { epoch, repositoryMark = null, repositoryId, root, bankReference: reference }) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const data = this.#read();
    data.shown[sessionId] = { epoch, repository_mark: repositoryMark, repository_id: repositoryId, root, bank_reference: reference, at: this.#now().toISOString() };
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
  BANK_HOST, TICKETS_BASENAME, BankTickets, governanceBankSpecs, renderGovernanceBank, parseBankAnswer, bankReference,
  bankTicketContext, bankTicketCommand,
});
