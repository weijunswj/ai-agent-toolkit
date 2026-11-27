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
//   4. The bank is shown once. A reply that cannot be used (unread, an unknown row or a changed row)
//      gets a short line, and an answer that was used gets what it did; either way the command notes
//      the same bank again for the run (BankTickets.rearm), so the owner's next own message gets a new
//      one-use ticket the same way.
//   5. "explain 1.4" is read-only: it needs no ticket, spends none and writes nothing, before or after
//      an answer (`setup --answers "<reference>: explain 1.4"`, bankExplainCommand). The hook leaves
//      the shown bank open for the owner's next own message.
// A pull request it prepares still decides nothing until the owner merges it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const bank = require('./toolkit-question-bank.cjs');
const { managedScript } = require('./toolkit-user-state.cjs');

const BANK_HOST = 'governance';
// What a yes to Turn on also covers: the settings Toolkit adds on its own after the merge
// (toolkit-governance-finish.cjs), and what the personal data check its pull request adds lets through,
// named here so the owner sees them before answering.
const AFTER_MERGE = `After the merge, Toolkit also turns on, without asking again: ${require('./toolkit-governance-finish.cjs').WHAT}. Where the pull request adds the personal data check, that check lets images and fonts through without reading them and names each one; any other file it cannot read fails until its path is listed.`;
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
// Questions are numbered in the order they are built, without gaps; the table numbers the parts Toolkit
// keeps itself after them (tableRows), and those take no answer. A number can move between runs, so a
// reply to an older bank where any number moved is never applied: the row digests are keyed by number
// too (rowDigests), and the owner gets the new bank instead.
// The rows left out of the table that the merged programme file binds (`bound`, the few words each adds)
// are shown as one line under it, in this order, with how to change them said once.
const BOUND = 'Bound in the merged programme file';
const BOUND_ORDER = Object.freeze(['parent-issue', 'required-checks']);
// What a table row the programme file sets says in its Recommended column.
const SET_IN = 'Set in the programme file';
const BOUND_CHANGE = 'To change them, edit that file in a pull request and merge it.';
// The evidence store's other choice: the controller sets up a new store with the owner. No command moves
// a store yet, so nothing is promised to move, and this bank's answer moves nothing.
const STORE_MOVE = 'Change location: say change store, and the controller sets up the new store with you; nothing moves on this answer';
// The one table's rows, in order; every other row is a line under it.
const TABLE_ORDER = Object.freeze(['governance', 'task-auto-merge', 'permission-blocks', 'governance-app', 'evidence-store']);
// Where governance is decided the bank has one section and builds the GitHub governance question
// first, so it is always row 1.1 (a test pins it).
const GOVERNANCE_REF = '1.1';
const APP_NAMES_ON_GITHUB = (({ variable, secret }) => `the ${variable} variable and the ${secret} secret`)(require('./toolkit-governance-app.cjs').APP);
// The line after a reply that could not be used, asking for the reply again.
const REPLY_AGAIN = 'Reply again with all recommended or only your changes, such as 1.1=B.';
// After an answer the bank already used, a reply it cannot read (a bare ok or thanks) loses nothing: it
// says so, and how to change one more row.
const ANSWER_USED = 'Your earlier answer to this bank was already used, and this reply changes nothing. Nothing more was written.';
const CHANGE_ANOTHER = 'To change a row, reply with only that change, such as 1.1=B.';

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

// The bank for one repository. `state` is the governance state, `task` the merged switch ('after-gates',
// 'off' or 'unset'), `merged` the merged binding (or null), `permissions` { missing, checked }, and
// `adoption` what turning governance on would make in a repository that is not prepared yet
// (toolkit-governance-adopt.cjs adoptionPlan; null when it is prepared or already on), `train` the
// merged merge trains switch ('on' or 'off'), `mergedRead` the one read `merged` and `train` come
// from (toolkit-governance-state.cjs mergedBindingRead: { fresh, refresh_error }, or null; a stale
// one is said on the bound line), and `app` the governance App's variable and secret on GitHub
// (toolkit-governance-app.cjs presence; null when not read), and `copies` the instruction copies the
// cleanup route would remove ({ files, held?, step?, refused? }: `held` is why the pinned sweep copies
// hold the cleanup and `step` what clears it, `refused` why the programme file stops it; null when not
// read).
//
// The bank asks at most two questions: whether governance stays on or off where it is decided (in a
// repository not decided yet the turn-on card already asked, so an answer turns it on), and task
// auto-merge. Everything else is a status row: what is set, or the Toolkit default the answer applies
// (the evidence store, the App and permission commands, the copies cleanup). Merge trains keep their stored value and are not asked.
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
    // With none yet, the turn-on result says how to add protection later (turnOnSummary).
    specs.push(statusRow({ id: 'required-checks', section, title: 'Required checks', current: adoption.checks.length ? adoption.checks.join(', ') : 'None yet', text: adoption.checks.length ? 'Taken from what the default branch already enforces' : 'Default-branch protection waits for them' }));
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
// as printed and nothing else, so the bank is never shown again in reply to an answer.
// A command above is the owner's to run (permissions, the governance App), in Toolkit's own code block
// so the app shows it as typed; it is shown, never run.
const agentsAfterAnswer = () => `Agents: this line is for you alone. Show the owner the lines above exactly as printed, code blocks from Toolkit included, leaving out this line, then stop. Add nothing, ask nothing, post no card, and never show the bank again unless the owner types toolkit governance. Add no code block of your own, and never run a command above yourself. If their next own message comes back with a Toolkit ticket, send it as that ticket says. If they only ask to explain a row, such as explain 1.1, run node "${script()}" setup --answers "explain 1.1" with that row: it needs no ticket and writes nothing.`;

// The one reply line under the bank, with an example taken from its first question with a choice to
// change.
function replyLine(specs) {
  const first = specs.find(spec => !spec.report_only && spec.choices.length > 1) || specs.find(spec => !spec.report_only);
  const example = first ? `${first.presentation.question_ref}=${first.choices[1]?.presentation_ref || 'A'}` : '1.1=B';
  const explain = first ? first.presentation.question_ref : '1.1';
  const extra = specs.some(spec => spec.id === 'evidence-store' && !spec.bound) ? ' Add store= only to change that default.' : '';
  if (specs.some(spec => spec.turns_on)) return `Reply all recommended to turn governance on as shown, or only your changes such as ${example}.${extra} To keep governance off instead, reply no store: Toolkit then makes nothing and asks again next session. A plain yes, no or later works too: yes is all recommended, later keeps governance off the same way, and no prepares one pull request that turns governance off. Say "explain ${explain}" for the full text of a row.`;
  return `Reply all recommended, or only your changes such as ${example}. Rows you leave out stay as they are; each change is a pull request you merge.${extra} Say "explain ${explain}" for the full text of a row.`;
}

// The table's rows with the number each shows: a question keeps its own number (the one an answer
// names), and the rows Toolkit keeps itself are numbered after the questions, in TABLE_ORDER. Where the
// answer itself turns governance on, its row has no number: there is nothing to choose there.
function tableRows(specs) {
  const rows = TABLE_ORDER.map(id => specs.find(spec => spec.id === id)).filter(Boolean);
  const section = specs[0]?.presentation.section_index || 1;
  let next = Math.max(0, ...rows.filter(spec => !spec.report_only).map(spec => spec.presentation.question_index));
  return rows.map(spec => ({ spec, ref: !spec.report_only ? spec.presentation.question_ref : spec.turns_on ? '-' : `${section}.${next += 1}` }));
}

// Whether governance is on here (its row reads On), so the required parts carry their marks.
const isOn = specs => specs.some(spec => spec.id === 'governance' && spec.current === 'On');

// The bank's top line: OFF, not decided, or ON with whether every required part is ready; a part that
// could not be read is unknown, never counted as a step left.
function topLine(specs) {
  const governanceRow = specs.find(spec => spec.id === 'governance');
  if (!governanceRow || governanceRow.turns_on) return 'not decided: your answer turns it on';
  if (!isOn(specs)) return 'OFF';
  const parts = specs.filter(spec => spec.required);
  const steps = parts.filter(spec => spec.required.ready === false).length;
  const unknown = parts.filter(spec => spec.required.ready === null).length;
  const left = steps ? `ON, not ready, ${steps} step${steps === 1 ? '' : 's'} left` : 'ON, ready';
  return unknown ? `${left}; ${unknown} part${unknown === 1 ? '' : 's'} could not be checked` : left;
}

const cell = text => String(text || '').replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const currentText = spec => spec.current_short || spec.current;
const MARKS = Object.freeze({ true: 'Ready', false: 'Not ready', null: 'Unknown' });

function tableLine({ spec, ref }, on) {
  if (!spec.report_only) {
    const label = bank.choiceLabel(spec, spec.recommended);
    const effect = spec.recommended === 'keep' || spec.recommended_outcome === label ? '' : `: ${spec.recommended_outcome}`;
    const others = spec.choices.filter(choice => choice.value !== spec.recommended).map(choice => cell(`${choice.presentation_ref}. ${choice.label}`)).join('<br>') || '-';
    return `| ${ref} | ${cell(spec.title)} | ${cell(currentText(spec))} | ${cell(`${spec.presentation.recommended_choice_ref}. ${label}${effect}`)} | ${others} |`;
  }
  const mark = on && spec.required ? `${MARKS[spec.required.ready]}: ` : '';
  const recommended = on && spec.required?.ready === false ? `Next step: ${spec.required.step}` : spec.recommended_text || 'Keep';
  return `| ${ref} | ${cell(spec.title)} | ${cell(`${mark}${currentText(spec)}`)} | ${cell(recommended)} | ${cell(spec.other || '-')} |`;
}

// The bank as the owner reads it: the top line, one table with the two choices and the parts Toolkit
// keeps itself (each with its mark and one next step while governance is on), the other rows as short
// lines under it, and the one reply line. The longer texts are in explain (explainText).
function renderGovernanceBank(specs) {
  const reference = bankReference(specs);
  const rows = tableRows(specs);
  const inTable = new Set(rows.map(row => row.spec.id));
  const rest = specs.filter(spec => spec.report_only && !inTable.has(spec.id));
  const bound = rest.filter(spec => spec.bound).sort((a, b) => BOUND_ORDER.indexOf(a.id) - BOUND_ORDER.indexOf(b.id));
  const stale = specs.find(spec => spec.stale)?.stale;
  const on = isOn(specs);
  return [
    `# ${BANK_TITLE} - ${topLine(specs)}`,
    '',
    `Bank reference: ${reference}`,
    '',
    '| # | Setting | Current | Recommended | Other choices |',
    '|---|---|---|---|---|',
    ...rows.map(row => tableLine(row, on)),
    ...(rest.length || stale ? ['', 'Also:',
      ...(bound.length ? [`- Set in ${governance.BINDING_FILE}: ${bound.map(spec => spec.bound).join(', ')}. ${BOUND_CHANGE}`] : []),
      ...(stale ? [`- GitHub could not be read just now (${stale}), so the values set in ${governance.BINDING_FILE} are the ones this computer last read.`] : []),
      ...rest.filter(spec => !spec.bound).map(spec => `- ${spec.title}: ${currentText(spec)}.${spec.recommended_text ? ` ${spec.recommended_text}.` : ''}`)] : []),
    // An answer that turns governance on covers the post-merge settings too, so they are named before it.
    ...(specs.some(spec => spec.turns_on) ? ['', AFTER_MERGE] : []),
    ...specs.filter(spec => spec.id === 'governance' && !spec.report_only).flatMap(spec => spec.choices.filter(choice => choice.value === 'on' && choice.presentation_ref !== spec.presentation.recommended_choice_ref)
      .map(choice => `${spec.presentation.question_ref} ${choice.presentation_ref}. ${choice.label}: ${choice.consequence}`)).flatMap(line => ['', line]),
    '',
    replyLine(specs),
    '',
    `Agents: this line is for you alone. Show the owner the bank above exactly, as plain text and never in a code block, leaving out this line, then stop. Their next own message comes back with a one-use ticket; send it with their answer as ${reference}: <their answer>. Never answer for them, and never show this bank again after they reply.`,
  ].join('\n');
}

// The full text of one row, for "explain 1.1", or null when the bank has no such row. A row Toolkit
// keeps itself is explained by its table number too.
function explainText(specs, ref) {
  const spec = specs.find(entry => entry.presentation.question_ref === ref);
  if (spec) return [bank.renderQuestionRows(specs, ref, { brief: true }).replace(/\n+---$/, ''), ...(spec.explain_more || [])].join('\n\n');
  const row = tableRows(specs).find(entry => entry.ref === ref && entry.spec.report_only);
  if (!row) return null;
  const kept = row.spec;
  return [`${ref} ${kept.title}`, `Current: ${currentText(kept)}.`, ...(kept.recommended_text ? [`${kept.recommended_text}.`] : []),
    ...(kept.required?.ready === false ? [`Next step: ${kept.required.step}.`] : []), ...(kept.other ? [`Other choice: ${kept.other}.`] : []),
    'Toolkit keeps this part itself: no answer changes it.'].join('\n');
}

// The row number a reply asks to explain ("explain 1.4", with or without the bank reference), or null.
const EXPLAIN = /^\s*(?:([0-9A-Za-z-]{16,19})\s*:\s*)?explain\s+(\d+\.\d+)\s*\.?\s*$/i;
function explainRequest(text) {
  const match = EXPLAIN.exec(String(text || ''));
  return match ? match[2] : null;
}

// The same, with the bank reference it names (normalised, or as typed when malformed, so it matches
// no bank), or null: { reference, row }.
function explainParts(text) {
  const match = EXPLAIN.exec(String(text || ''));
  if (!match) return null;
  return { reference: match[1] ? (bank.normalizeBankReference(match[1]) || match[1]) : null, row: match[2] };
}

// A short digest of each row as shown, keyed by its id and number (id@1.4, or id@ for a status row),
// so a reply to a bank that changed since can name only the rows that changed (changedRows).
const rowKey = spec => `${spec.id}@${spec.presentation.question_ref}`;
function rowDigests(specs) {
  const payload = bank.questionBankApprovalPayload(specs);
  const digest = new Map(payload.questions.map(question => [question.id, crypto.createHash('sha256').update(JSON.stringify(question)).digest('hex').slice(0, 16)]));
  return Object.fromEntries(specs.map(spec => [rowKey(spec), digest.get(spec.id)]));
}

// The lines that name what changed between the bank the owner was shown (its row digests) and this
// one, or null when rows were added or taken away or any number moved (then only a new bank can be
// answered, since a reply such as 1.4=A could mean another row now).
function changedRows(before, specs) {
  const now = rowDigests(specs);
  const keys = Object.keys(now);
  if (!before || typeof before !== 'object' || Object.keys(before).length !== keys.length || keys.some(key => !Object.hasOwn(before, key))) return null;
  return specs.filter(spec => before[rowKey(spec)] !== now[rowKey(spec)]).map(spec => (spec.report_only
    ? `${spec.title} changed: now ${spec.current_short || spec.current}, with nothing to answer.`
    : `${spec.presentation.question_ref} ${spec.title} changed: now ${spec.current_short || spec.current}, recommended ${spec.presentation.recommended_choice_ref}. ${bank.choiceLabel(spec, spec.recommended)}.`));
}

// The key override and the no-store reply, read before the bank's own grammar: `store=<owner/name>`
// and `no store`. Returns the reference prefix, the rest of the answer and what the override says; a
// malformed or repeated one is refused. A `shards=` answer from an older bank is refused with one line:
// Toolkit no longer sets up CI shards (SHARDS_RETIRED).
const STORE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const SHARDS_RETIRED = 'Toolkit no longer sets up CI shards; the CI check-up flags when they would pay. Leave shards= out of your reply.';
function bankExtras(text) {
  const [, prefix, payload] = /^(\s*(?:[0-9A-Za-z-]{16,19}\s*:\s*)?)([\s\S]*)$/.exec(String(text || ''));
  const extras = { store: null, noStore: false };
  const once = (name, value, said) => {
    if (extras[name]) throw new Error(`The answer says ${said} twice.`);
    extras[name] = value;
    return ',';
  };
  const clean = value => value.replace(/\.$/, '');
  let rest = payload.replace(/(^|[\s,;])no[\s_-]+store(?=$|[\s,;.])/gi, (_, lead) => lead + once('noStore', true, 'no store'));
  rest = rest.replace(/(^|[\s,;])store\s*=\s*([^\s,;]*)/gi, (_, lead, value) => {
    if (!STORE_NAME.test(clean(value))) throw new Error('store= needs a repository as owner/name, such as store=you/TRANSPORT-project.');
    return lead + once('store', clean(value), 'store=');
  });
  if (/(^|[\s,;])shards\s*=/i.test(rest)) throw new Error(SHARDS_RETIRED);
  return { prefix, rest: rest.split(/[,;]/).map(part => part.trim()).filter(Boolean).join(', '), ...extras };
}

// What the owner's answer applies: { governance, taskAutoMerge, governanceApp,
// permissionBlocks, instructionCopies?, store }, or { noStore: true }. Questions left out
// stay as they are; each status row's Toolkit default applies unless an override changes it. With
// `plainWords` false (a bank an answer was already used for) a bare yes, no or later is not read.
function parseBankAnswer(text, specs, { requireBankReference = true, plainWords = true } = {}) {
  const turnsOn = specs.some(spec => spec.id === 'governance' && spec.turns_on);
  // Where the bank is the turn-on question itself (no card came first), it takes the card's plain
  // answers too: yes is all recommended, later is no store, and no is the owner's off decision.
  const plain = turnsOn && plainWords ? plainAnswer(text, specs, requireBankReference) : null;
  if (plain === 'later') return { noStore: true, later: true };
  if (plain === 'no') return { governance: 'off', taskAutoMerge: 'keep', store: null, governanceApp: 'keep', permissionBlocks: 'keep' };
  const extras = bankExtras(plain === 'yes' ? text.replace(/(yes)\s*\.?\s*$/i, 'all recommended') : text);
  const questions = specs.filter(spec => !spec.report_only);
  // Overrides alone change no question: every question keeps its current value, which is also what
  // the bank recommends for each of them.
  if (!extras.rest && (extras.noStore || extras.store) && !questions.every(spec => spec.recommended === 'keep')) {
    throw new Error('Name the rows to change as well, such as 1.1=A.');
  }
  let parsed;
  try {
    parsed = bank.parseConciseQuestionBankAnswer(`${extras.prefix}${extras.rest || (extras.noStore || extras.store ? 'all recommended' : '')}`, specs, { requireBankReference, label: 'Governance', leftOut: spec => spec.choices.find(choice => choice.value === 'keep')?.value });
  } catch (error) {
    if (error.code === 'QUESTION_BANK_UNKNOWN_ROW') {
      const row = tableRows(specs).find(entry => entry.ref === error.question_ref && entry.spec.report_only);
      throw new Error(row ? `Row ${row.ref} ${row.spec.title} takes no answer: ${row.spec.other ? `${row.spec.other}.` : 'Toolkit keeps it itself.'}` : `This bank has no row ${error.question_ref}.`);
    }
    throw error;
  }
  if (!parsed) throw Object.assign(new Error(`Governance question bank answer was not read.${turnsOn ? ' Reply no store to keep governance off.' : ''}`), { code: 'BANK_ANSWER_UNREAD' });
  bank.assertQuestionBankAnswerBinding(parsed, specs, 'Governance');
  if (extras.noStore) {
    if (!turnsOn) throw new Error('No store applies only where your answer would turn governance on.');
    if (extras.rest || extras.store) throw new Error('No store keeps governance off, so it goes on its own: reply no store, or leave it out.');
    return { noStore: true };
  }
  const byId = new Map(parsed.selections.map(entry => [entry.question_id, entry.canonical_value]));
  const value = id => {
    const spec = specs.find(entry => entry.id === id);
    const chosen = byId.get(id) || 'keep';
    // A hidden twin (the choice that changes nothing) applies as Keep current.
    return spec && spec.folded_value === chosen ? spec.folded_into : chosen;
  };
  const governed = specs.find(entry => entry.id === 'governance')?.folded_value === 'on';
  const governance = turnsOn ? 'on' : value('governance');
  const onAfter = governance === 'on' || (governed && governance !== 'off');
  // Task auto-merge is On only while governance is on, or in the answer that turns it on.
  const taskAutoMerge = value('task-auto-merge');
  if (taskAutoMerge === 'on' && !onAfter) throw new Error('Task auto-merge can be on only while governance is on: turn governance on in the same answer, or leave task auto-merge as it is.');
  if (extras.store && !(governance === 'on' && !governed && specs.some(spec => spec.id === 'evidence-store' && !spec.bound))) {
    throw new Error('store= applies only in an answer that turns governance on here; the store of a governed repository is bound in its programme file.');
  }
  const copies = specs.find(spec => spec.id === 'instruction-copies' && spec.copies_clean);
  return {
    governance, taskAutoMerge, store: extras.store,
    governanceApp: specs.some(spec => spec.app_setup) ? 'setup' : 'keep',
    permissionBlocks: specs.some(spec => spec.permissions_update) ? 'update' : 'keep',
    ...(copies ? { instructionCopies: onAfter && governed ? 'clean' : 'keep' } : {}),
  };
}

// A plain yes, no or later on its own (after the bank reference where one is required), or null.
const PLAIN = /^\s*(?:([0-9A-Za-z-]{16,19})\s*:\s*)?(yes|no|later)\s*\.?\s*$/i;
function plainAnswer(text, specs, requireBankReference) {
  const match = PLAIN.exec(String(text || ''));
  if (!match) return null;
  if (requireBankReference && !match[1]) return null;
  if (match[1] && bank.normalizeBankReference(match[1]) !== specs[0]?.presentation.bank_reference) return null;
  return match[2].toLowerCase();
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
  // `rows` are the shown rows' digests (rowDigests); `used` notes that an answer to it was already used.
  shown(sessionId, { epoch, repositoryMark = null, repositoryId, root, bankReference: reference, rows = {}, used = false }) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const data = this.#read();
    data.shown[sessionId] = {
      epoch, repository_mark: repositoryMark, repository_id: repositoryId, root, bank_reference: reference, rows, ...(used ? { used: true } : {}), at: this.#now().toISOString(),
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
    data.tickets[sessionId] = { hash: hash(ticket), epoch, repository_mark: entry.repository_mark ?? null, repository_id: entry.repository_id, root: entry.root, bank_reference: entry.bank_reference, rows: entry.rows || {}, ...(entry.used === true ? { used: true } : {}), at: this.#now().toISOString() };
    this.#save(data);
    return ticket;
  }

  // After the owner's reply was sent with its ticket (`entry`, from take) and could not be used, notes
  // the bank again for the same run, repository mark and repository, so the owner's next own message
  // answers it the same way, with a new one-use ticket, and the bank is not shown again. `bankReference`
  // and `rows` name the bank that reply now answers (a changed bank's, once its changed rows were named).
  // `used` is true once an answer to it was used, and stays true for the replies after it.
  rearm(sessionId, entry, { bankReference: reference, rows, used = false }) {
    if (!entry || typeof entry !== 'object') return false;
    return this.shown(sessionId, { epoch: entry.epoch, repositoryMark: entry.repository_mark ?? null, repositoryId: entry.repository_id, root: entry.root, bankReference: reference, rows, used: used || entry.used === true });
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
    entry.used === true
      ? `Toolkit governance: the user's message above is their first since their answer to governance bank ${entry.bank_reference} was used; that answer is done, not open. This message may change another row, or be ordinary work. Read what they mean first.`
      : `Toolkit governance: the user's message above is their first since governance bank ${entry.bank_reference} was shown or Toolkit asked them to reply again. It may answer it, or be ordinary work. Read what they mean first.`,
    `- If it may answer the bank in any way: only where its rows and choices are plain (all recommended, changes such as 1.2=B, no store or store=<owner/name>, in any words) put it in that form. Send anything else exactly as typed (a bare yes or ok, an unknown row, two choices for one row, explain 1.4, anything unclear), leaving out only quotes, $, % and backticks. Tell them "Sending: <answer> (bank ${entry.bank_reference})" and run exactly this once, with it in place of ANSWER:`,
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

// What the agent is told when the owner's own message after a bank only asks to explain a row: the
// read-only explain command, which spends no ticket, so the bank stays open for their answer.
function bankExplainContext(entry, row) {
  return [
    `Toolkit governance: the user's message above asks for the full text of row ${row} of governance bank ${entry.bank_reference}. Run exactly this once; it needs no ticket and writes nothing:`,
    `  node "${script()}" setup --answers "${entry.bank_reference}: explain ${row}"`,
    'Then do what its Agents line says. The bank stays open: their next own message comes back with a one-use ticket for their answer. Never show the bank again yourself, and never answer it for them.',
  ].join('\n');
}

// Whether a shell command is exactly the read-only explain command: Toolkit's own script, `setup
// --answers` with only "explain <row>" (the bank reference optional) and no ticket. It writes nothing,
// so it needs no session or ticket; anything else after `--answers` still needs the live ticket.
const EXPLAIN_COMMAND = /^[ \t]*(?:&[ \t]*)?node(?:\.exe)?[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[ \t]+setup[ \t]+--answers[ \t]+"([^"\r\n]{1,60})"[ \t]*$/;
function bankExplainCommand(text) {
  const command = String(text || '');
  if (/[$`%\u2018-\u201f]/.test(command)) return false;
  const match = EXPLAIN_COMMAND.exec(command);
  return Boolean(match) && sameScript(match[1] ?? match[2] ?? match[3]) && explainRequest(match[4]) !== null;
}

module.exports = Object.freeze({
  APP_NAMES, BANK_HOST, TICKETS_BASENAME, REPLY_AGAIN, ANSWER_USED, CHANGE_ANOTHER, BankTickets, governanceBankSpecs, renderGovernanceBank, parseBankAnswer, bankReference,
  agentsAfterAnswer, explainText, explainRequest, explainParts, rowDigests, changedRows, bankTicketContext, bankTicketCommand, bankExplainContext, bankExplainCommand,
});
