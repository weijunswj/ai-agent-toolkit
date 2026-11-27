'use strict';

// What `toolkit governance` (also `setup governance` and `refresh governance`) reads about one
// repository, and how the owner's reply to it is taken. The guided questions
// (toolkit-governance-guided.cjs) and the governance summary (toolkit-governance-summary.cjs) show it;
// this module keeps the parts both reuse: the rows Toolkit reads (governanceBankSpecs, whose reference
// binds a reply to what was shown) and the one-use reply tickets.
//
// Only the owner answers (owner decision of 28 Oct: the agent reads what the user means, Toolkit only
// checks it is the user's own reply):
//   1. Showing the questions or the summary notes, in Toolkit's private user state, that this run of
//      this session was shown <reference> for this repository (BankTickets.shown).
//   2. The UserPromptSubmit hook gives the owner's next own message in that run a one-use ticket bound
//      to the session, the run, the repository and the reference (BankTickets.issue); the PostToolUse
//      hook does the same for their tap on a question card the app chose to show. A launched session,
//      a relayed or scheduled prompt, a repeated Projects delivery or a reply after another session
//      started in the repository gets none.
//   3. The agent sends the reply it read with that ticket: `toolkit-governance.cjs setup --answers
//      "<reference>: 1A 2A 3A" --ticket <ticket>`. The command spends the ticket (BankTickets.take)
//      and writes or prepares nothing without it. The tool gate lets only that exact command through.
//   4. The questions are shown once. A reply that cannot be used gets a short line, and an answer that
//      was used gets what it did; either way the command notes the same questions again for the run
//      (BankTickets.rearm), so the owner's next own reply gets a new one-use ticket the same way.
// A pull request it prepares still decides nothing until the owner merges it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const bank = require('./toolkit-question-bank.cjs');
const { managedScript } = require('./toolkit-user-state.cjs');

const BANK_HOST = 'governance';
// What a yes to Turn on also covers: the settings Toolkit adds on its own after the merge
// (toolkit-governance-finish.cjs), and what the personal data check its pull request adds lets through.
const AFTER_MERGE = `After the merge, Toolkit also turns on, without asking again: ${require('./toolkit-governance-finish.cjs').WHAT}. Where the pull request adds the personal data check, that check lets images and fonts through without reading them and names each one; any other file it cannot read fails until its path is listed.`;
const TICKETS_BASENAME = 'governance-bank-tickets.v1.json';
const TICKETS_SCHEMA = 'toolkit.governance-bank-tickets.v1';
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 32;
const TICKET = /^[0-9a-f]{32}$/;
const EPOCH = /^[0-9a-f]{32}$/;
const OWN_SCRIPT = path.join(__dirname, 'toolkit-governance.cjs');
// The script the agent is told to run: the managed checkout's when there is one, else this copy's.
const script = () => managedScript('toolkit-governance.cjs');
const BOUND = 'Bound in the merged programme file';
const SET_IN = 'Set in the programme file';
// The evidence store's other choice: the controller sets up a new store with the owner. No command moves
// a store yet, so nothing is promised to move, and no answer moves anything.
const STORE_MOVE = 'Change location: say change store, and the controller sets up the new store with you; nothing moves on this answer';
const GOVERNANCE_REF = '1.1';
const APP_NAMES_ON_GITHUB = (({ variable, secret }) => `the ${variable} variable and the ${secret} secret`)(require('./toolkit-governance-app.cjs').APP);

// The app each permission row belongs to; every app keeps its own permission lines.
const APP_NAMES = Object.freeze({ claude: 'Claude Code', codex: 'Codex' });

const STATE_LABEL = Object.freeze({ ENABLED: 'On', DISABLED: 'Off', UNDECIDED: 'Not decided' });

// ---- the rows -----------------------------------------------------------------------------------

// `change` says how the owner changes or stops something already set; it follows the text. A status
// row says what the answer does by default, so its words are bound (`bound_text`): an answer to a bank
// whose status rows changed since it was shown is refused, never applied to defaults the owner did not see.
// A row with no text says only its current value. `bound` marks a row the merged programme file binds.
function statusRow({ id, section, title, current, text = '', change = '', bound = '' }) {
  if (change) text = `${text}. ${change}`;
  return {
    ...(bound ? { bound } : {}),
    id, key: id, section, title, whatThisControls: title, report_only: true, bound_text: text ? `${current}. ${text}` : current,
    currentState: { effectiveBehavior: current, verification: 'state-derived' },
    recommendation: null, choices: [], recommended_text: text, afterApplying: '',
    availability: { status: 'available', condition: 'Shown for information.' },
    description: title, current, current_short: current,
    recommended: '', recommended_outcome: text, recommendation_reason: 'Nothing to answer.',
  };
}

// The rows for one repository. `state` is the governance state, `task` the merged switch ('after-gates',
// 'off' or 'unset'), `merged` the merged binding (or null), `permissions` { missing, checked }, and
// `adoption` what turning governance on would make in a repository that is not prepared yet
// (toolkit-governance-adopt.cjs adoptionPlan; null when it is prepared or already on), `train` the
// merged merge trains switch ('on' or 'off'), `mergedRead` the one read `merged` and `train` come
// from (toolkit-governance-state.cjs mergedBindingRead: { fresh, refresh_error }, or null; a stale
// one is said on the bound line), `app` the governance App's variable and secret on GitHub
// (toolkit-governance-app.cjs presence; null when not read), and `copies` the instruction copies the
// cleanup route would remove ({ files, held?, step?, refused? }: `held` is why the pinned sweep copies
// hold the cleanup and `step` what clears it, `refused` why the programme file stops it; null when not
// read).
//
// These rows are what Toolkit read, as data: the reference that binds a reply to what was shown is
// built from them. Neither shows them as a table.
function governanceBankSpecs({ state, task = 'unset', train = 'off', merged = null, mergedRead = null, permissions = { checked: false, missing: 0 }, adoption = null, app = null, copies = null, storeCheck = null }) {
  // Only a state read from the merged binding has words here; any other (GitHub could not be read)
  // gets the CLI's line to type it again, never a bank.
  if (!Object.hasOwn(STATE_LABEL, String(state.state))) throw new Error(`The governance bank cannot show the state ${state.state}.`);
  const section = `Governance for ${state.repository || path.basename(state.root || '') || 'this repository'}`;
  const decided = state.state === 'ENABLED' || state.state === 'DISABLED';
  const governed = state.state === 'ENABLED';
  const appSet = app && app.variable === 'found' && app.secret === 'found';
  const appStop = `To stop using it, delete ${APP_NAMES_ON_GITHUB} under Settings, Secrets and variables, Actions on GitHub; governance works without it`;
  const specs = [];
  if (decided) {
    // The App's removal steps wait in this row's explain text, so its status line stays short.
    specs.push({ ...(appSet ? { explain_more: [`**Governance App:** ${appStop}.`] } : {}), ...bank.resolvedQuestion({
      id: 'governance', key: 'governance', section, title: 'GitHub governance',
      whatThisControls: 'Whether Toolkit runs GitHub governance here: programme issues, decision records and an evidence store.',
      current: STATE_LABEL[state.state],
      currentChoice: governed ? 'on' : 'off',
      recommendation: { value: 'keep', outcome: 'Governance stays as merged.', reason: 'Nothing needs to change.' },
      choices: [
        bank.wizardChoice('keep', 'Keep current', 'Governance stays as merged.'),
        bank.wizardChoice('on', 'Turn on', `Toolkit prepares one pull request that turns governance on. It applies only after you merge it. ${AFTER_MERGE}`),
        bank.wizardChoice('off', 'Turn off', 'Toolkit prepares one pull request that turns governance off. It applies only after you merge it. The evidence store, parent issue and required checks stay as they are, but governance stops using them.'),
      ],
    }) });
  } else {
    // Not decided yet: the turn-on card asked, so any answer here turns governance on; the reply line
    // says once how to keep it off (no store).
    specs.push({ ...statusRow({ id: 'governance', section, title: 'GitHub governance', current: STATE_LABEL[state.state],
      text: 'Your answer turns it on: Toolkit prepares one pull request, and it applies only after you merge it' }), turns_on: true });
  }
  // Task auto-merge is On only while governance is On, or in the same answer that turns it on.
  const on = task === 'after-gates';
  const turnsOn = !decided;
  specs.push(bank.resolvedQuestion({
    id: 'task-auto-merge', key: 'taskAutoMerge', section, title: 'Task auto-merge with merge train',
    whatThisControls: 'Whether finished task pull requests merge once their review, checks and testing pass, several at a time in one merge train. It applies only while governance is on.',
    current: governed ? `${on ? 'On' : 'Off'}${merged && train !== 'on' ? ', merge trains off' : ''}` : 'Off (needs governance)',
    currentChoice: governed ? (on ? 'on' : 'off') : '',
    recommendation: { value: 'keep', outcome: 'Task auto-merge stays as it is.', reason: 'Nothing needs to change.' },
    choices: governed ? [
      bank.wizardChoice('keep', 'Keep current', 'Task auto-merge stays as it is.'),
      bank.wizardChoice('on', 'On', 'Finished task pull requests merge once their gates pass.'),
      bank.wizardChoice('off', 'Off', 'Every pull request waits for your typed merge.'),
    ] : [
      bank.wizardChoice('keep', 'Keep current', turnsOn ? 'Task auto-merge starts off: every pull request waits for your typed merge.' : 'Task auto-merge stays off.'),
      bank.wizardChoice('on', turnsOn ? 'On' : 'On (needs governance on)', turnsOn ? 'The turn-on pull request sets it on: finished task pull requests merge once their gates pass.' : 'Only together with turning governance on in the same answer; the same pull request sets it.'),
    ],
  }));
  if (adoption && adoption.blocked) {
    // The search's own reason is for the logs, not the owner: an answer makes nothing until it works.
    specs.push(statusRow({ id: 'setup-pieces', section, title: 'Store and parent issue', current: 'Not checked yet', text: 'GitHub could not be read just now, so Toolkit asks about them once it can, and an answer now makes nothing. Type toolkit governance again in a moment' }));
  } else if (adoption) {
    // The store is this repository's own private TRANSPORT-<name>, found or created; another one only
    // when the owner names it, and no store keeps governance off.
    specs.push(statusRow({ id: 'evidence-store', section, title: 'Evidence store', current: adoption.store_name,
      text: adoption.found_store ? `Found: your private GitHub repository ${adoption.found_store}, used for programme records and evidence` : `None yet: Toolkit creates the private GitHub repository ${adoption.store.repository} when governance turns on, for programme records and evidence`,
      change: 'To use another private repository of yours, add store=<owner/name> to your reply' }));
    specs.push(statusRow({ id: 'parent-issue', section, title: 'Parent issue', current: adoption.parent.create ? 'None yet' : `#${adoption.parent.issue}`, text: adoption.parent.create ? 'Toolkit opens one when governance turns on' : 'Reused when governance turns on' }));
    // The turn-on adds Toolkit's own checks (plain-text, personal-data) to these itself (withOwnChecks).
    specs.push(statusRow({ id: 'required-checks', section, title: 'Required checks', current: adoption.checks.length ? adoption.checks.join(', ') : 'None yet', text: adoption.checks.length ? 'Taken from what the default branch already enforces; the turn-on adds Toolkit\'s own checks' : 'The turn-on requires Toolkit\'s own checks' }));
    // Said before the answer, so turning on never stops afterwards to ask about it.
    if (adoption.visibility === 'public') specs.push(statusRow({ id: 'visibility', section, title: 'Repository visibility', current: 'Public', text: 'The programme file names your private evidence store (its name only, never its contents) and the parent issue is public. The store stays private' }));
  }
  if (governed && merged) {
    const parents = merged.parents || [];
    const checks = merged.required_checks;
    // The bank's own read of the store, else its last background check (toolkit-governance-parts.cjs):
    // one that cannot be used is not ready; none, or one GitHub could not read, keeps the row as the
    // programme file sets it.
    const parts = require('./toolkit-governance-parts.cjs');
    const broken = parts.STORE_WHY[storeCheck?.state];
    specs.push({ ...statusRow({ id: 'evidence-store', section, title: 'Evidence store', current: merged.store.repository,
      text: broken ? `${SET_IN}, but at the last check it ${broken}, so programme records and evidence cannot be saved` : SET_IN, bound: `evidence store ${merged.store.repository}` }),
    required: broken ? { ready: false, step: parts.STORE_STEP[storeCheck.state] } : { ready: true }, other: STORE_MOVE });
    if (parents.length) specs.push(statusRow({ id: 'parent-issue', section, title: 'Parent issue', current: parents.map(parent => `#${parent.issue}`).join(', '), text: BOUND,
      bound: `${parents.length === 1 ? 'parent' : 'parents'} ${parents.map(parent => `#${parent.issue}`).join(', ')}` }));
    specs.push(statusRow({ id: 'required-checks', section, title: 'Required checks', current: checks.length ? checks.join(', ') : 'none listed', text: BOUND,
      bound: checks.length ? `${checks.length === 1 ? 'required check' : 'required checks'} ${checks.join(', ')}` : 'no required checks' }));
  } else if (governed) {
    // The store row stays in the table, unknown, so the top line counts it.
    specs.push({ ...statusRow({ id: 'evidence-store', section, title: 'Evidence store', current: 'Not read', text: 'The programme file that holds it could not be read just now' }), required: { ready: null } });
    specs.push(statusRow({ id: 'programme-file', section, title: 'Programme file', current: 'Could not be read',
      text: `This computer could not read the merged .github/toolkit-programme.json just now${mergedRead?.refresh_error ? ` (${mergedRead.refresh_error})` : ''}, so what it sets is not shown. Type toolkit governance again in a moment` }));
  }
  // A failed read of GitHub keeps the merged values and marks them stale; the bound line says so.
  if (mergedRead && !mergedRead.fresh) for (const spec of specs) if (spec.bound) spec.stale = mergedRead.refresh_error || 'no fresh read';
  // The governance App: the owner runs its setup command; Toolkit never makes the App or saves its key.
  // While governance is on, or turns on with this answer, the result gives that command by default.
  // Its removal steps are in the governance row's explain text where there is one.
  // GitHub that could not be read leaves the App unknown, never missing (presence says unverified).
  const appUnknown = app && !appSet && (app.variable === 'unverified' || app.secret === 'unverified');
  const appPart = app && !appSet && !appUnknown && (app.variable === 'found' || app.secret === 'found');
  const appNone = app && app.variable === 'missing' && app.secret === 'missing';
  if (appSet || appPart) {
    specs.push({ ...statusRow({ id: 'governance-app', section, title: 'Governance App', current: appSet ? 'Set up' : 'Partly set up',
      text: !appSet ? 'the governance check shows how to finish or replace it' : decided ? `Say "explain ${GOVERNANCE_REF}" for how to stop using it` : appStop }),
    required: appSet ? { ready: true } : { ready: false, step: 'finish it as the governance check shows' } });
  } else if (governed && (appUnknown || !app)) {
    specs.push({ ...statusRow({ id: 'governance-app', section, title: 'Governance App', current: app ? `GitHub could not be read (${app.reason || 'no answer'})` : 'Not checked',
      text: 'Toolkit checks it again next time; nothing is set up from this answer' }), required: { ready: null } });
  } else if (state.state === 'DISABLED') {
    // Turning governance back on gives the same one line as a first turn-on; staying off gives none.
    specs.push({ ...statusRow({ id: 'governance-app', section, title: 'Governance App', current: app && app.variable === 'missing' && app.secret === 'missing' ? 'Not set up' : 'Not checked',
      text: 'Nothing is made while governance is off. If your answer turns it back on, Toolkit then gives you one line to paste into PowerShell (it refuses to run under an agent, so the App\'s private key never passes through one): press Enter when it asks, then click Create and Install on GitHub' }), app_setup: true });
  } else {
    specs.push({ ...statusRow({ id: 'governance-app', section, title: 'Governance App', current: app && app.variable === 'missing' && app.secret === 'missing' ? 'Not set up' : 'Not checked',
      text: 'After your answer, Toolkit gives you one line to paste into PowerShell (it refuses to run under an agent, so the App\'s private key never passes through one): press Enter when it asks, then click Create and Install on GitHub. Governance works without it, but its jobs on GitHub need it to open pull requests' }), app_setup: true,
    required: appNone ? { ready: false, step: 'paste the one line Toolkit gives after your answer' } : { ready: null } });
  }
  // The instruction copies older setups left: removed by default with any answer that keeps governance
  // on (toolkit-governance-cleanup.cjs), in the working tree; the owner commits them and merges one PR.
  const left = copies ? `${copies.files} ${copies.files === 1 ? 'file' : 'files'} left` : '';
  if (governed && copies && copies.files > 0 && copies.held) {
    specs.push(statusRow({ id: 'instruction-copies', section, title: 'Toolkit instruction copies', current: `${left}, cleanup held`, text: `Not removed yet: ${copies.held}. ${copies.step}` }));
  } else if (governed && copies && copies.files > 0 && copies.refused) {
    specs.push(statusRow({ id: 'instruction-copies', section, title: 'Toolkit instruction copies', current: `${left}, cleanup cannot run`, text: `Not removed yet: ${copies.refused}` }));
  } else if (governed && copies && copies.files > 0) {
    specs.push({ ...statusRow({ id: 'instruction-copies', section, title: 'Toolkit instruction copies', current: `${left} (Toolkit default: clean up)`,
      text: 'Older setups copied the governed rules, playbooks and shims here; the installed Toolkit now gives sessions these rules. Your answer removes them in the working tree, keeping everything of yours, and sets min_toolkit in the programme file; you commit them and merge the one pull request. An answer that turns governance off keeps them' }), copies_clean: true });
  }
  const appName = APP_NAMES[permissions.host] || 'this app';
  const missing = permissions.checked ? permissions.missing : null;
  const stale = permissions.checked ? permissions.stale || 0 : 0;
  const outdated = missing !== null && (missing > 0 || stale > 0);
  // Other lines (not Toolkit's) are counted and reviewed here but never block ready: each stays unless
  // the owner names it in the review.
  const other = permissions.checked && Number.isInteger(permissions.other) && permissions.other > 0 ? permissions.other : 0;
  const otherText = other ? `. Other lines: ${other} to review` : '';
  specs.push({ ...statusRow({ id: 'permission-blocks', section, title: `Toolkit permissions (${appName})`,
    current: missing === null ? 'Not checked' : `Toolkit lines: ${outdated ? [missing ? `${missing} missing` : '', stale ? `${stale} old` : ''].filter(Boolean).join(', ') : 'up to date'}${otherText}`,
    text: outdated ? `After your answer, Toolkit lists every permission line and gives you one command to run yourself that brings ${appName}'s Toolkit permission lines up to date; it shows what changes, backs the files up and waits for you to press Enter${other ? '. Other lines stay unless you pick them from the list' : ''}`
      : missing === null ? 'They could not be checked here; setup toolkit checks them'
        : other ? 'Say review permissions to see them; nothing changes unless you pick lines' : '' }), permissions_update: outdated,
    other: outdated ? 'Leave: do not run the command' : '', required: missing === null ? { ready: null } : outdated ? { ready: false, step: 'run the one command Toolkit gives after your answer' } : { ready: true } });
  return bank.withPresentationMetadata(specs, BANK_HOST);
}

function bankReference(specs) { return specs[0]?.presentation.bank_reference || ''; }

// What the agent is told after every output that follows an answer: the owner sees Toolkit's own lines
// as printed and nothing else, so the questions are never shown again in reply to an answer.
// A command above is the owner's to run (permissions, the governance App), in Toolkit's own code block
// so the app shows it as typed; it is shown, never run.
const agentsAfterAnswer = () => 'Agents: this line is for you alone. Show the owner the lines above exactly as printed, code blocks from Toolkit included, leaving out this line, then stop. Add nothing, add no code block of your own, and never run a command above yourself. If their next own message comes back with a Toolkit ticket, send it as that ticket says.';

// After the answer that prepared the setup pull request: the agent carries the setup through in the
// same turn. The merge goes through Toolkit's merge hold, so the owner's own approval (its merge card,
// or their typed merge line) is what lands it; the finish then sets up what needs the merged files, and
// the summary gives the owner's two commands and the table.
const agentsAfterTurnOn = number => `Agents: this line is for you alone. Show the owner the lines above exactly as printed, leaving out this line. Then, in this same turn: wait for the checks of pull request #${number} (gh pr checks ${number} --watch --interval 30). When they pass, merge it with gh pr merge ${number} --merge and do what Toolkit's merge hold says: the owner approves the merge there, never you. After it has merged, run node "${script()}" finish, then node "${script()}" setup, and show each output as printed. If a check fails or the owner does not approve, tell them in one line and stop. Never merge any other way, and never run a command shown to the owner.`;

// Under the guided questions (toolkit-governance-guided.cjs).
const agentsGuided = () => 'Agents: this line is for you alone. Put the text above in your closing message as printed, leaving out this line, and end your turn; how the questions show (text, a card or the end-of-turn box) is the app\'s choice. The owner\'s reply, typed or tapped, comes back to you with a one-use ticket: send it as that ticket says. Never answer for them, and never show these questions again after they reply.';

// Under the governance summary (toolkit-governance-summary.cjs).
const agentsSummary = () => `Agents: this line is for you alone. Show the owner the lines above exactly as printed, code blocks from Toolkit included, leaving out this line, then stop. Never run a command above yourself. When the owner says they have run them, run node "${script()}" setup again and show its output. A change they ask for in words comes back with a one-use ticket: send it as that ticket says.`;

// ---- reply tickets ------------------------------------------------------------------------------

function hash(ticket) { return crypto.createHash('sha256').update(String(ticket)).digest('hex'); }

class BankTickets {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(governance.userStateDirectory(registryOptions), TICKETS_BASENAME);
    this.#now = now;
  }

  // Unreadable or damaged state holds: nothing is shown as answerable and no ticket is given. A file
  // an older Toolkit wrote has no `agreed` record; it reads as none.
  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { schema: TICKETS_SCHEMA, shown: {}, tickets: {}, agreed: {} };
      throw Object.assign(new Error('BANK_TICKETS_UNREADABLE'), { code: 'BANK_TICKETS_UNREADABLE' });
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const map = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!parsed || parsed.schema !== TICKETS_SCHEMA || !map(parsed.shown) || !map(parsed.tickets) || (parsed.agreed !== undefined && !map(parsed.agreed))) {
      throw Object.assign(new Error('BANK_TICKETS_MALFORMED'), { code: 'BANK_TICKETS_MALFORMED' });
    }
    return { ...parsed, agreed: parsed.agreed || {} };
  }

  #fresh(entry) {
    return Boolean(entry) && typeof entry === 'object' && Date.parse(entry.at) >= this.#now().getTime() - MAX_AGE_MS && EPOCH.test(String(entry.epoch));
  }

  #save(data) {
    const keep = record => Object.fromEntries(Object.entries(record).filter(([, entry]) => this.#fresh(entry))
      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_SESSIONS));
    const text = `${JSON.stringify({ schema: TICKETS_SCHEMA, shown: keep(data.shown), tickets: keep(data.tickets), agreed: keep(data.agreed || {}) })}\n`;
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

  // Notes that this run of the session was shown these questions (or the summary). A newer note
  // replaces an older one and drops any live ticket of the session, so a ticket always answers what
  // was shown last. `used` notes that an answer to it was already used.
  shown(sessionId, { epoch, repositoryMark = null, repositoryId, root, bankReference: reference, used = false }) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const data = this.#read();
    data.shown[sessionId] = {
      epoch, repository_mark: repositoryMark, repository_id: repositoryId, root, bank_reference: reference, ...(used ? { used: true } : {}), at: this.#now().toISOString(),
    };
    delete data.tickets[sessionId];
    this.#save(data);
    return true;
  }

  // Notes the owner's own yes to the session-start governance question (PromptHold, from their reply
  // with its ticket), so the guided setup that follows in this run leaves that question out. It
  // answers nothing itself: the owner's reply to the remaining questions still comes with a ticket.
  agree(sessionId, { epoch, repositoryMark = null, repositoryId }) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch)) || typeof repositoryId !== 'string' || !repositoryId) return false;
    const data = this.#read();
    data.agreed[sessionId] = { epoch, repository_mark: repositoryMark, repository_id: repositoryId, at: this.#now().toISOString() };
    this.#save(data);
    return true;
  }

  // Whether the owner said yes in this run, for this repository, with no other session started in it since.
  agreedFor(sessionId, { epoch, repositoryMark = null, repositoryId }) {
    const data = this.#read();
    const entry = typeof sessionId === 'string' && Object.hasOwn(data.agreed, sessionId) ? data.agreed[sessionId] : null;
    return this.#fresh(entry) && entry.epoch === epoch && entry.repository_id === repositoryId && (entry.repository_mark ?? null) === (repositoryMark ?? null);
  }

  // What this run was shown and not yet replied to, or null. Read only.
  pendingFor(sessionId, epoch) {
    const data = this.#read();
    const entry = typeof sessionId === 'string' && Object.hasOwn(data.shown, sessionId) ? data.shown[sessionId] : null;
    return this.#fresh(entry) && entry.epoch === epoch ? entry : null;
  }

  // Whether this run has questions waiting for the owner's reply or a live ticket.
  live(sessionId, epoch) {
    const data = this.#read();
    const ticket = typeof sessionId === 'string' && Object.hasOwn(data.tickets, sessionId) ? data.tickets[sessionId] : null;
    return this.pendingFor(sessionId, epoch) !== null || (this.#fresh(ticket) && ticket.epoch === epoch);
  }

  // Turns the shown note into a ticket for the reply that just arrived: the note is spent, so only
  // the first own reply after it gets one. Returns the ticket, or null.
  issue(sessionId, epoch) {
    const data = this.#read();
    const entry = Object.hasOwn(data.shown, sessionId) ? data.shown[sessionId] : null;
    if (!this.#fresh(entry) || entry.epoch !== epoch) return null;
    const ticket = crypto.randomBytes(16).toString('hex');
    delete data.shown[sessionId];
    data.tickets[sessionId] = { hash: hash(ticket), epoch, repository_mark: entry.repository_mark ?? null, repository_id: entry.repository_id, root: entry.root, bank_reference: entry.bank_reference, ...(entry.used === true ? { used: true } : {}), at: this.#now().toISOString() };
    this.#save(data);
    return ticket;
  }

  // After the owner's reply was sent with its ticket (`entry`, from take), notes the same questions
  // again for the same run, repository mark and repository, so the owner's next own reply answers them
  // the same way, with a new one-use ticket, and they are not shown again. `bankReference` names what
  // that reply now answers. `used` is true once an answer was used, and stays true for the replies after it.
  rearm(sessionId, entry, { bankReference: reference, used = false }) {
    if (!entry || typeof entry !== 'object') return false;
    return this.shown(sessionId, { epoch: entry.epoch, repositoryMark: entry.repository_mark ?? null, repositoryId: entry.repository_id, root: entry.root, bankReference: reference, used: used || entry.used === true });
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

// What the agent is told with the owner's reply to the governance questions or summary. Toolkit, not
// the agent, checks the reply: anything that may answer is sent as it is, and the command prints what
// was wrong. `card` is the owner's tap on a question card the app chose to show (question and the
// labels they picked), or null for their typed message above.
function bankTicketContext(entry, ticket, card = null) {
  const what = card ? `the user answered a question card: ${card}.` : 'the user\'s message above is their own reply.';
  return [
    entry.used === true
      ? `Toolkit governance: ${what} It is their first since their earlier governance answer was used; that answer is done, not open. It may ask for a change, or be ordinary work. Read what they mean first.`
      : `Toolkit governance: ${what} It is their first since Toolkit's governance questions were shown or Toolkit asked them to reply again. It may answer them, or be ordinary work. Read what they mean first.`,
    '- If it may answer them in any way: where their meaning is plain, put it in the letter form, such as 1A 2A 3B (with the store as owner/name after 2B, such as 2B you/TRANSPORT-project), or, after setup, as turn off governance, task auto-merge on, task auto-merge off or change store. Send anything else exactly as given, leaving out only quotes, $, % and backticks. Tell them "Sending: <answer>" and run exactly this once, with it in place of ANSWER:',
    `  node "${script()}" setup --answers "${entry.bank_reference}: ANSWER" --ticket ${ticket}`,
    '- Toolkit checks it and prints what was wrong or what it did; do what its Agents line says. Never show the questions again yourself and never ask them to reply in another form.',
    `- If they say they have run the commands (done), record nothing: run node "${script()}" setup and show its output. If it is clearly about something else, record nothing and carry on.`,
    'The ticket works once, only in this session, and only for these questions. Never act as the user: never answer for them or change their answer.',
  ].join('\n');
}

// Whether a shell command is exactly the answer command with a live ticket of this session.
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
  if (/[$`%‘-‟]/.test(command)) return false;
  const match = BANK_COMMAND.exec(command);
  if (!match || typeof sessionId !== 'string' || sessionId === '') return false;
  if (!sameScript(match[1] ?? match[2] ?? match[3])) return false;
  try { return tickets.peek(match[5], sessionId) !== null; } catch { return false; }
}

module.exports = Object.freeze({
  APP_NAMES, BANK_HOST, TICKETS_BASENAME, BankTickets, governanceBankSpecs, bankReference,
  agentsAfterAnswer, agentsAfterTurnOn, agentsGuided, agentsSummary, bankTicketContext, bankTicketCommand,
});
