'use strict';

// The governance summary (INT-TK421-1386): what `toolkit governance` shows in a governed repository,
// the guided setup's last step included. One top line (on and ready, or how many steps are left and
// what is held), the owner's steps left with their commands in PowerShell blocks (Toolkit permissions
// first, then the Governance App), and one table of every part: Part | State | What it does. Changes
// after setup are said in words: turn off governance, task auto-merge on or off, change store.
//
// The failure this prevents: the old bank showed a governed repository as a table of codes to answer
// (1.2=B), listed the owner's own permission lines as raw commands, and never said in one place what
// was set up and what was still missing.

const fenced = command => ['```powershell', command, '```'];
const cell = text => String(text || '').replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const listed = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || '');

// What each part does, the same in every repository.
const DOES = Object.freeze({
  governance: 'Records, decisions and evidence for this repository, the same on every computer',
  store: 'Keeps programme records, plans and reviews apart from the code',
  parent: 'Tracks every task as a sub-issue',
  'task-auto-merge': 'Reviewed, green task pull requests land on their own, in merge trains',
  checks: 'Every pull request passes these before it lands',
  protection: 'Pull requests only, required checks and no force pushes on the default branch',
  'protection-free': "Toolkit's guards on each computer stand in",
  security: 'Flags and updates vulnerable dependencies',
  workflows: 'Keep records in step from GitHub, with no computer on',
  guards: 'Check every pull request and push',
  permissions: "Agents run Toolkit's own commands without asking each time",
  app: 'Lets the cloud workflows act on GitHub',
  copies: 'Old Toolkit instruction copies an earlier setup left',
  'done-when': "Checkbox rows under each open task's DONE WHEN, so the programme graph shows its Progress count",
});

// The cloud workflows and guards a governed repository carries, by the file that shows each one.
const WORKFLOW_FILES = Object.freeze([
  { name: 'programme sweep', file: '.github/workflows/toolkit-programme-sweep.yml', main: true },
  { name: 'sweep gate', file: '.github/workflows/toolkit-programme-sweep-gate.yml', main: true },
  { name: 'personal data sweep', file: () => require('./toolkit-cloud-workflows-copied.cjs').SWEEP_WORKFLOW },
  { name: 'dependency auto-merge', file: () => require('./toolkit-governance-security.cjs').WORKFLOW_REL },
]);
const GUARD_FILES = Object.freeze([
  { name: 'plain-text check', file: '.github/workflows/plain-text.yml' },
  { name: 'personal data guard', file: () => require('./toolkit-cloud-workflows-copied.cjs').COPIED_FILES['personal-data-guard'][0] },
]);
const fileOf = entry => (typeof entry.file === 'function' ? entry.file() : entry.file);

// The files under .github at the merged commit the binding was read from, or null when they cannot be
// read. The refresh fetched that commit into the default branch's tracking ref, so this is local only.
// git runs as the binding reader runs it: from its PATH location, never a git.exe in the repository.
function mergedFiles(root, commit, { runGit = require('./toolkit-governance-binding.cjs').defaultRunGit } = {}) {
  if (typeof root !== 'string' || !/^[0-9a-f]{40}$/i.test(String(commit || ''))) return null;
  try {
    const result = runGit(['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', commit, '--', '.github'], { cwd: root, timeout: 10000 });
    if (result.status !== 0) return null;
    return new Set(String(result.stdout).split(/\r?\n/).filter(Boolean));
  } catch { return null; }
}

// ---- the programme file update ------------------------------------------------------------------
// An older governed programme file can sit behind what this Toolkit needs: a min_toolkit below the
// setup hold (toolkit-governance-ready.cjs HOLD_FROM), so a missing part never holds there, or
// required_checks without the checks the default branch already requires or Toolkit's own checks.
// The failure this prevents: the owner was told to edit required_checks by hand, and min_toolkit was
// only ever written by the instruction-copies cleanup, at a version below the hold.

// The checks GitHub requires on the default branch, from a protection read
// (toolkit-governance-protection.cjs ghProtectionReader): its rulesets and classic protection. A plan
// without branch protection requires none; any other read that failed is null (not known).
function branchRequiredChecks(read) {
  if (!read || typeof read !== 'object') return null;
  if (read.ok !== true) return read.reason === 'plan-has-no-protection' ? [] : null;
  const found = new Set();
  for (const rule of Array.isArray(read.rules) ? read.rules : []) {
    if (rule && rule.type === 'required_status_checks' && Array.isArray(rule.parameters?.required_status_checks)) {
      for (const check of rule.parameters.required_status_checks) if (check && typeof check.context === 'string' && check.context) found.add(check.context);
    }
  }
  for (const check of Array.isArray(read.classic?.checks) ? read.classic.checks : []) if (check && typeof check.context === 'string' && check.context) found.add(check.context);
  return [...found].sort();
}

// Toolkit's own checks (plain-text, personal-data) whose workflow the merged commit defines, read
// through the binding reader's git runner, as mergedFiles is. Unreadable files add none.
function mergedOwnChecks(root, commit, { runGit = require('./toolkit-governance-binding.cjs').defaultRunGit } = {}) {
  if (typeof root !== 'string' || !/^[0-9a-f]{40}$/i.test(String(commit || ''))) return [];
  const { OWN_CHECKS, withOwnChecks } = require('./toolkit-governance-proposal.cjs');
  const files = {};
  for (const entry of OWN_CHECKS) {
    try {
      const shown = runGit(['show', `${commit}:${entry.file}`], { cwd: root, timeout: 10000 });
      if (shown.status === 0) files[entry.file] = String(shown.stdout);
    } catch { /* not read: that check is not added */ }
  }
  return withOwnChecks([], files);
}

// What one programme file pull request would change, or null when it is in step: { min_toolkit:
// { from, to } | null, required_checks (the whole new list), added, branchUnread }. min_toolkit moves
// to the running release only where it is below `holdFrom`; the repository's own checks all stay, in
// their order, and the missing ones follow sorted. `branchChecks` null means the default branch's
// protection could not be read, so only Toolkit's own checks can be added. `keyReadable` is false where
// the file has no min_toolkit and the repository's pinned sweep copies might not know the key
// (toolkit-governance-cleanup.cjs): adding it there would stop the programme board, so it waits.
function programmeUpdate({ binding, running, holdFrom, branchChecks = null, ownChecks = [], keyReadable = true }) {
  if (!binding || binding.governance !== 'enabled') return null;
  const { compareVersions } = require('./toolkit-version.cjs');
  const at = value => /^\d+\.\d+\.\d+$/.test(String(value || ''));
  const current = at(binding.min_toolkit) ? binding.min_toolkit : null;
  let minToolkit = null;
  try {
    if (at(running) && at(holdFrom) && (current || keyReadable) && (!current || compareVersions(current, holdFrom) < 0) && compareVersions(running, holdFrom) >= 0) minToolkit = { from: current, to: running };
  } catch { minToolkit = null; }
  const kept = Array.isArray(binding.required_checks) ? binding.required_checks : [];
  const added = [...new Set([...(branchChecks || []), ...(ownChecks || [])])].filter(check => typeof check === 'string' && check && !kept.includes(check)).sort();
  if (!minToolkit && !added.length) return null;
  return { min_toolkit: minToolkit, required_checks: [...kept, ...added], added, branchUnread: branchChecks === null };
}

// What the update changes, in words: the pull request's own wording (the proposal module, which the
// hooks load, so it never loads this one).
const updateWords = update => require('./toolkit-governance-proposal.cjs').updateWords(update);

// The programme file with the update applied, in its own layout (indent, line endings, byte order
// mark), so the pull request shows only the changed lines; a layout it cannot follow is written out
// whole. A retired key (programme-state.cjs) goes in the same change, as switches do.
function programmeUpdateText(mergedText, binding, update) {
  const util = require('node:util');
  const programme = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const text = programme.withoutRetiredKeysText(String(mergedText));
  const expected = { ...programme.withoutRetiredKeys(binding), required_checks: update.required_checks, ...(update.min_toolkit ? { min_toolkit: update.min_toolkit.to } : {}) };
  const bom = text.startsWith('﻿') ? '﻿' : '';
  let edited = text.slice(bom.length);
  const checks = /("required_checks"\s*:\s*)\[[^[\]]*\]/g;
  if ((edited.match(checks) || []).length === 1) edited = edited.replace(checks, `$1[${update.required_checks.map(check => JSON.stringify(check)).join(', ')}]`);
  else edited = null;
  if (edited !== null && update.min_toolkit) {
    if (Object.hasOwn(binding, 'min_toolkit')) edited = edited.replace(/("min_toolkit"\s*:\s*)"[^"]*"/, `$1"${update.min_toolkit.to}"`);
    else {
      const close = edited.lastIndexOf('}');
      const head = edited.slice(0, close).replace(/\s+$/, '');
      const newline = edited.includes('\r\n') ? '\r\n' : '\n';
      const indent = /\n([ \t]+)"/.exec(head)?.[1];
      edited = indent === undefined ? `${head}, "min_toolkit": "${update.min_toolkit.to}"${edited.slice(head.length)}` : `${head},${newline}${indent}"min_toolkit": "${update.min_toolkit.to}"${edited.slice(head.length)}`;
    }
  }
  let same = false;
  try { same = edited !== null && util.isDeepStrictEqual(JSON.parse(edited), expected); } catch { same = false; }
  return same ? `${bom}${edited}` : `${JSON.stringify(expected, null, 2)}\n`;
}

function presenceRow(entries, files, { defaultBranch = null } = {}) {
  if (!files) return { state: 'Not read', missing: [] };
  const wanted = entries.filter(entry => !entry.main || defaultBranch === 'main');
  const on = wanted.filter(entry => files.has(fileOf(entry))).map(entry => entry.name);
  const missing = wanted.filter(entry => !files.has(fileOf(entry))).map(entry => entry.name);
  return { state: [on.length ? `On: ${listed(on)}` : '', missing.length ? `Missing: ${listed(missing)}` : ''].filter(Boolean).join('. '), missing };
}

// Branch protection and rulesets, and the security settings, where GitHub was not read for this
// summary (an offline run, or a merged programme file read that is not fresh): from the post-merge
// finish's record (toolkit-governance-finish.cjs), else the background check's drift, else not
// checked, saying why (`unread`).
function finishRows(finish, drift, unread = 'GitHub was not read') {
  const on = finish?.on || [], unavailable = finish?.unavailable || [], held = finish?.held || [];
  const isRule = name => /protection|ruleset/.test(name);
  const isSecurity = name => /security/.test(name);
  const rulesOn = on.filter(isRule), rulesOff = unavailable.filter(isRule), rulesHeld = held.filter(isRule);
  const securityOn = on.filter(isSecurity), securityHeld = held.filter(isSecurity);
  const rulesDrift = (drift || []).filter(id => /^(?:RULESET|PROTECTION)_/.test(id));
  const securityDrift = (drift || []).filter(id => /^SECURITY_/.test(id));
  let protection, security, free = false;
  if (finish && (rulesOn.length || rulesOff.length || rulesHeld.length)) {
    free = rulesOff.length > 0 && !rulesOn.length && !rulesHeld.length;
    protection = free ? 'Not available on GitHub Free (private)'
      : [rulesOn.length ? `On: ${listed(rulesOn)}` : '', rulesOff.length ? `Not available on GitHub Free: ${listed(rulesOff)}` : '', rulesHeld.length ? `Waiting for you: ${listed(rulesHeld)}` : ''].filter(Boolean).join('. ');
  } else protection = rulesDrift.length ? `Drift found (${rulesDrift.length}); refresh governance offers the fix once it can read GitHub` : `Not checked here yet: ${unread}`;
  if (finish && (securityOn.length || securityHeld.length)) {
    security = [securityOn.length ? `On: ${listed(securityOn)}` : '', securityHeld.length ? `Waiting for you: ${listed(securityHeld)}` : ''].filter(Boolean).join('. ');
  } else security = securityDrift.length ? `Drift found (${securityDrift.length}); the agent runs toolkit governance security` : `Not checked here yet: ${unread}`;
  return { protection, free, security, fix: null };
}

// ---- the GitHub settings, read for the summary ------------------------------------------------
// The failure this prevents: in a repository governed before this Toolkit, the protection and security
// rows came only from a turn-on's finish record, so they said "Not checked here yet" for ever and
// refresh governance never offered to fix drift on GitHub (squash and rebase merges allowed beside an
// active ruleset).

// Why GitHub could not be read, in plain words, by the readers' reason codes.
const UNREAD_WHY = Object.freeze({
  'gh-unavailable': 'the GitHub CLI could not run',
  forbidden: 'GitHub refused this computer\'s sign-in, which needs admin rights there',
  'not-visible': 'GitHub does not show it to this computer\'s sign-in',
  'repository-not-visible': 'GitHub does not show it to this computer\'s sign-in',
  'classic-protection-not-visible': 'classic branch protection is shown to repository admins only',
  'gh-request-failed': 'the GitHub request failed',
  'gh-output-invalid': 'GitHub gave an answer Toolkit could not read',
  'reader-failed': 'the read failed',
  'identity-unreadable': 'this repository\'s identity could not be read',
  'visibility-unreadable': 'GitHub did not say whether the repository is public',
});
const unreadWhy = reason => UNREAD_WHY[reason] || String(reason || 'no answer');

// Where on GitHub the owner changes what only they can change: plain settings steps, never a command.
// The failure this prevents: the result told the owner to run Toolkit's migrate command in their own
// terminal (SQAG, 28 November 2026).
const WHERE = Object.freeze({
  protection: 'Where on GitHub: the repository\'s Settings, then Rules, then Rulesets, for required checks, merge methods and up-to-date branches; Settings, then General, under Pull Requests, for the merge buttons',
  security: 'Where on GitHub: the repository\'s Settings, then the security settings in its sidebar (Advanced Security, or Code security on some accounts), for scanning and Dependabot; Settings, then General, under Pull Requests, for auto-merge',
});

// The rows from the live reads (`reads`: conformance.settingsReads's rulesetResult, protectionResult
// and securityResult, and keepState, the programme state ruleset's verdict where the merged programme
// file keeps state, else null; branchRead, the default branch's protection read, where the programme
// file lists no required checks, else null): each part On, drifted (what differs), Not available on GitHub Free,
// Waiting for you (a change only the owner can make) or Not checked here yet (GitHub could not be read,
// with why). `fix` lists what one yes changes, the same writes a turn-on's post-merge finish makes
// (toolkit-governance-migration.cjs finish), or is null when nothing drifted that Toolkit fixes.
function settingsRows(reads) {
  const { protectionOffer, workflowNotes: workflowsOf } = require('./toolkit-governance-migration.cjs');
  const rulesets = require('./toolkit-governance-ruleset.cjs');
  const protection = require('./toolkit-governance-protection.cjs');
  const security = require('./toolkit-governance-security.cjs');
  const changes = [];
  const ownRulesets = [];
  const rules = { on: [], drift: [], free: [], waiting: [], controller: [], unread: [] };
  const rulesetPart = (result, { on, missing, change }) => {
    if (!result || result.status === 'not-applicable') return;
    if (result.status === 'present') rules.on.push(on);
    else if (result.status === 'not-enforceable') rules.free.push(on);
    else if (result.status === 'missing') { rules.drift.push(missing); changes.push(change); }
    else rules.unread.push({ name: on, why: unreadWhy(result.reason) });
  };
  rulesetPart(reads.rulesetResult, { on: 'the no-force-push ruleset', missing: 'no ruleset blocks force pushes', change: `adds the "${rulesets.RULESET_NAME}" ruleset (every branch, no bypass)` });
  rulesetPart(reads.keepState, { on: 'the ruleset that keeps the programme state branch', missing: 'no ruleset keeps the programme state branch', change: `adds the "${rulesets.KEEP_STATE_RULESET_NAME}" ruleset (that branch only, no deletion, no bypass)` });
  const branch = reads.protectionResult;
  const name = 'default-branch protection';
  if (!branch) rules.unread.push({ name, why: 'the programme file\'s required checks could not be read' });
  else if (branch.status === 'not-applicable') { /* not a github.com repository: nothing to show */ }
  else if (branch.status === 'not-enforceable') rules.free.push(name);
  else if (branch.reason === 'binding-has-no-required-checks') {
    // As the finish says it: where GitHub cannot enforce rulesets at all, it is named with them.
    if (rules.free.length && !rules.on.length) rules.free.push(name);
    else {
      // The merge settings are still read (`branchRead`, the default branch's protection read), so
      // squash or rebase merges show here before Toolkit's ruleset can be offered.
      const merge = reads.branchRead?.ok === true ? Object.entries(protection.settingsVerdict([], reads.branchRead))
        .filter(([id, check]) => ['P5', 'P6'].includes(id) && check.status === 'drift').flatMap(([, check]) => check.details) : [];
      rules.waiting.push(merge.length
        ? `${name}: ${merge.join('; ')}. Toolkit's ruleset fixes this once the programme file lists required checks (the programme file update adds them); then refresh governance offers it`
        : `${name}: the programme file lists no required checks yet, so there is nothing for it to require`);
    }
  } else if (branch.reason === 'identity-unreadable') rules.unread.push({ name, why: unreadWhy(branch.reason) });
  else if (branch.status === 'conformant') rules.on.push(name);
  else {
    const unreadCheck = protection.SETTINGS_CHECKS.map(id => branch.checks[id]).find(check => check && check.status === 'unverified');
    const offer = protectionOffer(branch);
    const settingsDrift = protection.SETTINGS_CHECKS.flatMap(id => (branch.checks[id]?.status === 'drift' ? branch.checks[id].details : []));
    // A problem in the repository's own workflow files is the controller's, in a pull request.
    const workflowNotes = workflowsOf(branch);
    // The repository's own ruleset changes governance needs (owner decision INT-TK421-1398): in the
    // same one yes, each with its before and after.
    const own = !unreadCheck && Array.isArray(branch.own_rulesets) ? branch.own_rulesets : [];
    for (const entry of own) { changes.push(protection.ownRulesetWords(entry)); ownRulesets.push(entry); }
    if (unreadCheck) rules.unread.push({ name, why: unreadWhy(unreadCheck.details[0]) });
    else if (offer.offered) {
      rules.drift.push(...settingsDrift);
      changes.push(`${branch.toolkit_ruleset ? 'updates' : 'adds'} the "${protection.RULESET_NAME}" ruleset on the default branch (pull requests only, the programme file's required checks pinned to GitHub Actions, branches up to date before merging, merge commits only, nobody can bypass it)`);
      rules.controller.push(...workflowNotes);
    } else {
      // What the own ruleset changes fix is drift the yes fixes; the rest stays the owner's.
      const after = own.length && branch.own_after ? { ...branch.checks, ...branch.own_after } : branch.checks;
      const left = protection.SETTINGS_CHECKS.flatMap(id => (after[id]?.status === 'drift' ? after[id].details : []));
      rules.drift.push(...settingsDrift.filter(detail => !left.includes(detail)));
      // Each line says one thing: a setting to change by hand, a workflow for the controller, or why
      // Toolkit's ruleset is not offered.
      rules.waiting.push(...left.map(detail => `${name}, change by hand: ${detail}`));
      rules.controller.push(...workflowNotes);
      if (offer.fixes && offer.unproduced.length) rules.waiting.push(`${name}: Toolkit's ruleset is not offered while no workflow job produces ${offer.unproduced.map(check => `"${check}"`).join(', ')}`);
      if (offer.fixes && offer.silent.length) rules.waiting.push(`${name}: Toolkit's ruleset is not offered while ${offer.silent.map(check => `"${check}"`).join(', ')} does not report on every pull request`);
      if (!left.length && !workflowNotes.length && !own.length && !(offer.fixes && (offer.unproduced.length || offer.silent.length))) rules.waiting.push(`${name}, check by hand: it is not confirmed`);
      if (left.length) rules.where = WHERE.protection;
    }
  }
  const secure = { on: [], drift: [], free: [], waiting: [], unread: [] };
  const result = reads.securityResult;
  const settingsName = 'the dependency and security settings';
  if (!result) secure.unread.push({ name: settingsName, why: 'the programme file is not in this working tree' });
  else if (result.status === 'not-applicable') { /* not a github.com repository */ }
  else if (!result.fixes) secure.unread.push({ name: settingsName, why: unreadWhy(result.unread || result.reason) });
  else if (result.status === 'conformant') secure.on.push('the free dependency and security settings');
  else {
    const byHand = security.byHandNotes(result);
    for (const check of Object.values(result.checks || {})) {
      if (check.status === 'drift') secure.drift.push(...check.details.filter(detail => !byHand.includes(detail)));
      else if (check.status === 'not-on-plan') secure.free.push(...check.details);
      else if (check.status === 'unverified' && check.by_hand === true) byHand.push(...check.details);
      else if (check.status === 'unverified') secure.unread.push({ name: check.details.join('; '), why: null });
    }
    secure.waiting.push(...byHand.map(note => `change by hand: ${note}`));
    if (byHand.length) secure.where = WHERE.security;
    const turnOn = Object.entries(result.fixes).filter(([, wanted]) => wanted).map(([setting]) => security.SETTING_LABELS[setting] || setting);
    if (turnOn.length) changes.push(`turns on ${listed(turnOn)}`);
    const files = [result.files?.dependabot ? security.DEPENDABOT_REL : null, result.files?.workflow ? security.WORKFLOW_REL : null].filter(Boolean);
    if (files.length) changes.push(`writes ${listed(files)} into this working tree, for you to commit through a pull request`);
    if (!secure.drift.length && !secure.waiting.length && !secure.unread.length) secure.on.push('the free dependency and security settings');
  }
  const free = rules.free.length > 0 && !rules.on.length && !rules.drift.length && !rules.waiting.length && !rules.controller.length && !rules.unread.length;
  const protectionPart = free ? { state: 'Not available on GitHub Free (private)', items: [] } : partState(rules);
  const securityPart = partState(secure);
  return {
    protection: protectionPart.state,
    free,
    security: securityPart.state,
    details: { protection: protectionPart.items, security: securityPart.items },
    fix: changes.length ? { changes, ...(ownRulesets.length ? { own_rulesets: ownRulesets } : {}) } : null,
  };
}

// One row's state from its parts: { state, items }. The table cell stays short, each state with its
// count in a fixed order; the items are the short list shown under the table, one line each, ending
// with where on GitHub to change what only the owner can (`where`). All on is just On, and every
// part unread for the same one reason is said once, in the cell.
// The failure this prevents: SQAG's protection cell held about 12 clauses (owner UAT, 28 November 2026).
// A change to the repository's own workflow files, handed to its controller as one line.
const controllerLine = note => `Your controller fixes this in a pull request: ${String(note).replace(/\.$/, '')}.`;
// The cell's pointer to the items under the table; the short table after a yes has none.
const LISTED_BELOW = ', listed below';

function partState({ on, drift, free, waiting, controller = [], unread, where = null }) {
  const whys = [...new Set(unread.map(item => item.why))];
  if (on.length && !drift.length && !free.length && !waiting.length && !controller.length && !unread.length) return { state: 'On', items: [] };
  if (unread.length && whys.length === 1 && whys[0] && !on.length && !drift.length && !free.length && !waiting.length && !controller.length) return { state: `Not checked here yet: GitHub could not be read (${whys[0]})`, items: [] };
  const groups = [
    ['On', on.length, on.length ? [`On: ${listed(on)}`] : []],
    ['Drift', drift.length, drift.map(item => `Drift: ${item}`)],
    ['Not available on GitHub Free', free.length, free.map(item => `Not available on GitHub Free: ${item}`)],
    ['Waiting for you', waiting.length, waiting.map(item => `Waiting for you: ${item}`)],
    ['For your controller', controller.length, controller.map(controllerLine)],
    ['Not checked here yet', unread.length, unread.map(item => `Not checked here yet: ${item.why ? `${item.name} (${item.why})` : item.name}`)],
  ].filter(([, count]) => count > 0);
  if (!groups.length) return { state: 'Nothing to check', items: [] };
  const items = [...groups.flatMap(([, , lines]) => lines), ...(where ? [where] : [])];
  return { state: `${groups.map(([label, count]) => `${label}: ${count} ${count === 1 ? 'item' : 'items'}`).join('; ')}${LISTED_BELOW}`, items };
}

// What the owner's yes did (GovernanceMaintenance.finish's outcome), short: what changed, each once
// and read back; then what is left, each with who acts (the repository's controller for its own code
// or CI, in a pull request; the owner only for GitHub settings only they can change; Toolkit for a
// retry). The step log stays in the run's private record, never here.
// The failure this prevents: after the owner's yes in SQAG (28 November 2026) the result was about 20
// raw lines, with one CI line three times under "change by hand" and "Waiting for you".
function fixResultLines(outcome) {
  if (!outcome || outcome.result === 'not-ready') return ['GitHub settings: not changed, because the programme file is not merged and read back here. Nothing was written.'];
  const changed = [...new Set(outcome.changed || [])];
  const left = [...new Set([
    ...(outcome.controller || []).map(controllerLine),
    ...(outcome.files?.length ? [`Your controller commits ${listed(outcome.files)} through a pull request: Toolkit wrote ${outcome.files.length > 1 ? 'them' : 'it'} in this working tree.`] : []),
    ...(outcome.held || []).map(entry => `Waiting for you, ${entry.name}: ${entry.step}`),
    ...(outcome.result !== 'done' ? [`Toolkit tries again: ${outcome.reason || 'GitHub could not be written'}. Say refresh governance.`] : []),
  ])];
  const lines = changed.length ? ['**Changed and read back:**', ...changed.map(item => `- ${item.charAt(0).toUpperCase()}${item.slice(1)}`)] : ['**Nothing was changed on GitHub.**'];
  if (outcome.unavailable?.length) lines.push('', `Not available on GitHub Free, so nothing was written for ${outcome.unavailable.length > 1 ? 'them' : 'it'}: ${listed(outcome.unavailable)}.`);
  if (left.length) lines.push('', '**Left to do:**', ...left.map(item => `- ${item}`));
  return lines;
}

// The summary's table alone (Part | State | What it does), as it stands: shown after the result of a
// yes, with no steps, questions or items under it.
function renderTable(facts) {
  const { rows } = summaryRows(facts);
  return tableLines(rows.map(([part, state, does]) => [part, String(state).endsWith(LISTED_BELOW) ? String(state).slice(0, -LISTED_BELOW.length) : state, does]));
}

const tableLines = rows => ['| Part | State | What it does |', '|---|---|---|', ...rows.map(([part, state, does]) => `| ${cell(part)} | ${cell(state)} | ${cell(does)} |`)];

// The rows and steps for one governed repository. `facts`:
//   repository, defaultBranch, store { repository, state } (state from the store check, or null),
//   parents [issue numbers], task { auto_merge, merge_train }, requiredChecks [names],
//   settings (settingsRows from this summary's live GitHub reads, or null where GitHub was not read),
//   unread (why GitHub was not read then), finish (the finish record's on/unavailable/held, or null),
//   drift (settings drift ids, or null),
//   files (Set of .github paths at the merged commit, or null),
//   permissions ({ checked, app, wanted, missing, stale, other, update }), app ({ variable, secret }
//   presence, or null), appCommand (the App setup line), copies ({ files } or null), stale (why the
//   merged programme file read is not fresh, or null), doneWhen (the DONE WHEN backfill's dry run:
//   { pages, missing } issue numbers, { unread: true }, or null for no row).
function summaryRows(facts) {
  const rows = [];
  const steps = [];
  rows.push(['GitHub governance', 'On', DOES.governance]);
  const store = facts.store || {};
  const storeWhy = require('./toolkit-governance-parts.cjs').STORE_WHY[store.state];
  if (storeWhy) steps.push({ part: 'Evidence store', text: `${store.repository} ${storeWhy}: ${require('./toolkit-governance-parts.cjs').STORE_STEP[store.state]}.` });
  rows.push(['Evidence store', store.repository ? (store.state === 'usable' ? `Ready: ${store.repository} (private)` : storeWhy ? `Not ready: ${store.repository} ${storeWhy}` : `${store.repository} (not checked)`) : 'Not read', DOES.store]);
  rows.push(['Parent issue', facts.parents?.length ? `Ready: ${facts.parents.map(issue => `#${issue}`).join(', ')}` : 'None', DOES.parent]);
  const task = facts.task || {};
  const auto = task.auto_merge === 'after-gates';
  rows.push(['Task auto-merge with merge train', auto ? (task.merge_train === 'on' ? 'On' : 'On, merge trains off') : 'Off', DOES['task-auto-merge']]);
  rows.push(['Required checks', facts.requiredChecks?.length ? `Set: ${facts.requiredChecks.join(', ')}` : 'None listed', DOES.checks]);
  // The programme file update: a pull request already waiting is the step; else the question below.
  const update = facts.update;
  if (update?.open && update.refresh) {
    const checks = update.refresh.checks;
    steps.push({ part: 'Programme file', text: `An update waits in ${update.open.url}, but Toolkit's refresh pull request ${update.refresh.url} adds the ${listed(checks)} ${checks.length === 1 ? 'check' : 'checks'}, which that update does not list. Merge the refresh pull request first, then close the update on GitHub and say toolkit governance: one update then covers ${checks.length === 1 ? 'it' : 'them'} too. Merging the update now means a second one afterwards.` });
  } else if (update?.open) steps.push({ part: 'Programme file', text: `An update waits in ${update.open.url}: merge it, then say toolkit governance.` });
  else if (update?.refresh) {
    const checks = update.refresh.checks;
    steps.push({ part: 'Programme file', text: `It is behind this Toolkit, and Toolkit's refresh pull request ${update.refresh.url} adds the ${listed(checks)} ${checks.length === 1 ? 'check' : 'checks'}. Once it has merged, say toolkit governance: one pull request then brings the programme file up to date, with ${checks.length === 1 ? 'that check' : 'those checks'} included.` });
  }
  else if (update?.offer) steps.push({ part: 'Programme file', text: `It is behind this Toolkit: one pull request ${updateWords(update.offer)}.${update.offer.branchUnread ? " The default branch's required checks could not be read, so only Toolkit's own are added." : ''} Answer question 1 below.` });
  const finish = facts.settings || finishRows(facts.finish, facts.drift, facts.unread || undefined);
  rows.push(['Branch protection and rulesets', finish.protection, finish.free ? DOES['protection-free'] : DOES.protection]);
  rows.push(['Security settings', finish.security, DOES.security]);
  // What the short cells count, listed under the table.
  const details = [['Branch protection and rulesets', finish.details?.protection || []], ['Security settings', finish.details?.security || []]].filter(([, items]) => items.length);
  // Settings drift Toolkit fixes: asked after the programme file update, when that is asked too.
  if (finish.fix) steps.push({ part: 'GitHub settings', text: `They have drifted from what governance needs, as the table shows. One yes fixes them the way a turn-on sets them up. Answer question ${questionNumbers(facts).fix} below.` });
  const workflows = presenceRow(WORKFLOW_FILES, facts.files, { defaultBranch: facts.defaultBranch });
  rows.push(['Cloud workflows', workflows.state || 'None', DOES.workflows]);
  const guards = presenceRow(GUARD_FILES, facts.files);
  rows.push(['Guards', guards.state || 'None', DOES.guards]);
  const permissions = facts.permissions || {};
  const appName = permissions.app || 'this app';
  if (permissions.checked) {
    const missing = permissions.missing || 0, stale = permissions.stale || 0;
    const outdated = missing > 0 || stale > 0;
    rows.push([`Toolkit permissions (${appName}, this computer)`, outdated ? `Waiting: ${[missing ? `${missing} to add` : '', stale ? `${stale} old to update` : ''].filter(Boolean).join(', ')}` : 'Up to date', DOES.permissions]);
    if (outdated && permissions.update) {
      const own = Number.isInteger(permissions.other) && permissions.other > 0 ? ` Your ${permissions.other} own ${permissions.other === 1 ? 'line stays' : 'lines stay'} as ${permissions.other === 1 ? 'it is' : 'they are'}.` : '';
      steps.push({ part: `Toolkit permissions (${appName}, this computer)`, text: `Lets agents run Toolkit's own commands without asking each time. Adds ${missing} Toolkit ${missing === 1 ? 'line' : 'lines'}${stale ? ` and updates ${stale} old ${stale === 1 ? 'one' : 'ones'}` : ''}.${own} Run it in PowerShell; it shows the changes and waits for Enter.`, command: permissions.update });
    }
  } else rows.push([`Toolkit permissions (${appName}, this computer)`, 'Not checked here', DOES.permissions]);
  const app = facts.app;
  const appSet = app && app.variable === 'found' && app.secret === 'found';
  const appUnread = !app || app.variable === 'unverified' || app.secret === 'unverified';
  rows.push(['Governance App', appSet ? 'Set up' : appUnread ? 'Not read' : app.variable === 'missing' && app.secret === 'missing' ? 'Waiting: not set up' : 'Waiting: partly set up', DOES.app]);
  if (!appSet && !appUnread && facts.appCommand) {
    steps.push({ part: 'Governance App', text: `Lets the cloud workflows act on GitHub. Run it in PowerShell, press Enter when it asks, then click Create and Install on GitHub.`, command: facts.appCommand });
  }
  // The copies older setups left: cleaned on the owner's word, or held or stopped with the reason.
  const copies = facts.copies;
  if (copies && copies.files > 0) {
    const left = `${copies.files} ${copies.files === 1 ? 'file' : 'files'} left`;
    rows.push(['Toolkit instruction copies', copies.held ? `${left}, cleanup held. Not removed yet: ${copies.held}. ${copies.step}`
      : copies.refused ? `${left}, cleanup cannot run. Not removed yet: ${copies.refused}` : `${left}; say clean up copies`, DOES.copies]);
  }
  // The DONE WHEN backfill's dry run (toolkit-governance-done-when.cjs): converted on the owner's word.
  const doneWhen = facts.doneWhen;
  if (doneWhen) {
    const issues = numbers => numbers.map(number => `#${number}`).join(', ');
    const pages = doneWhen.pages || [], missing = doneWhen.missing || [];
    rows.push(['Task DONE WHEN rows', doneWhen.unread ? 'Not read: the task pages could not be read just now'
      : [pages.length ? `${pages.length} ${pages.length === 1 ? 'page has' : 'pages have'} plain rows (${issues(pages)}); say convert done-when rows` : 'No plain rows to convert',
        ...(missing.length ? [`${missing.length} without rows for the controller to write (${issues(missing)})`] : [])].join('; '), DOES['done-when']]);
  }
  return { rows, steps, details };
}

// What the summary shows, part by part, for naming what changed when a reply comes after it did
// (toolkit-governance-bank.cjs shownParts): [[part name, what it showed]], each table row with its
// listed details and its step, then the programme file and GitHub settings with their step and question.
function summaryParts(facts) {
  const { rows, steps, details } = summaryRows(facts);
  const parts = new Map(rows.map(([part, state]) => [part, { state, listed: (details.find(([name]) => name === part) || [null, []])[1] }]));
  const add = (part, key, value) => parts.set(part, { ...(parts.get(part) || {}), [key]: value });
  for (const step of steps) add(step.part, 'step', step.text);
  add('Programme file', 'question', facts.update?.offer && !facts.update.open ? facts.update.offer : null);
  add('GitHub settings', 'question', facts.settings?.fix || null);
  return [...parts];
}

// The questions the summary asks, numbered in order: the programme file update, then the settings fix.
function questionNumbers(facts) {
  const update = Boolean(facts.update?.offer && !facts.update.open);
  const fix = Boolean(facts.settings?.fix);
  return { update: update ? 1 : null, fix: fix ? (update ? 2 : 1) : null };
}

// The owner-facing summary. `held` is whether governance actions are held until setup is complete
// (toolkit-governance-ready.cjs: the merged programme file asks for the hold and a part is gone).
function renderSummary(facts, { held = false } = {}) {
  const { rows, steps, details } = summaryRows(facts);
  const top = steps.length
    ? `**Governance: on, not ready: ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} left.**${held ? ' Programme records, gate records and task auto-merge are held until then.' : ''}`
    : '**Governance: on and ready.**';
  return [
    top,
    '',
    ...steps.flatMap(step => [`**${step.part}:** ${step.text}`, '', ...(step.command ? [...fenced(step.command), ''] : [])]),
    ...(steps.some(step => step.command) ? [`Say done when you have run ${steps.filter(step => step.command).length === 1 ? 'it' : 'them'}.`, ''] : []),
    ...tableLines(rows),
    '',
    ...details.flatMap(([part, items]) => [`**${part}:**`, ...items.map(item => `- ${item}`), '']),
    ...(facts.stale ? [`GitHub could not be read just now (${facts.stale}), so the programme file values are the ones this computer last read.`, ''] : []),
    'To change something later, say: turn off governance, task auto-merge on or off, or change store.',
    ...(questionNumbers(facts).update ? [
      '',
      `**${questionNumbers(facts).update}. Question: Bring the programme file up to date?**`,
      `   - **A. Yes (my pick):** One pull request ${updateWords(facts.update.offer)}. Nothing else changes, and it applies only after you merge it.`,
      '   - **B. No:** Nothing is written, and Toolkit asks again next time.',
    ] : []),
    ...(questionNumbers(facts).fix ? [
      '',
      `**${questionNumbers(facts).fix}. Question: Fix the drifted GitHub settings?**`,
      `   - **A. Yes (my pick):** Toolkit ${listed(facts.settings.fix.changes)}, then reads each one back. Nothing else changes.`,
      '   - **B. No:** Nothing is written, and Toolkit asks again next time.',
    ] : []),
  ].join('\n');
}

// A change the owner asked for in words after the summary: { governance: 'off' } | { taskAutoMerge }
// | { changeStore: true } | { cleanCopies: true } | { convertRows: true } | { update: 'yes' | 'no' }
// | { fix: 'yes' | 'no' }, or a GuidedAnswerError. `copies`, `rows`, `update` and `fix` say whether the
// summary offers the cleanup, the DONE WHEN backfill, the programme file update and the settings fix.
// Their questions are numbered as questionNumbers numbers them; with two open, an answer names its
// number, one at a time.
function parseChange(text, { copies = false, rows = false, update = false, fix = false } = {}) {
  const { GuidedAnswerError } = require('./toolkit-governance-guided.cjs');
  const lower = String(text || '').trim().replace(/[.!]+$/, '').toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:turn (?:it )?off governance|turn governance off|governance off)$/.test(lower)) return { governance: 'off' };
  const merge = /^(?:turn )?(?:task )?auto[ -]?merge(?: with merge trains?)? ?(?:=|:)? ?(on|off|yes|no)$/.exec(lower) || /^turn (on|off) (?:task )?auto[ -]?merge$/.exec(lower);
  if (merge) return { taskAutoMerge: ['on', 'yes'].includes(merge[1]) ? 'on' : 'off' };
  if (/^change (?:the )?store$/.test(lower)) return { changeStore: true };
  if (copies && /^clean ?up (?:the )?(?:instruction )?copies$/.test(lower)) return { cleanCopies: true };
  if (rows && /^convert (?:the )?done[ -]?when rows$/.test(lower)) return { convertRows: true };
  const questions = [update ? 'update' : null, fix ? 'fix' : null].filter(Boolean);
  const numbered = /^(\d) ?(?:(a)(?:\W+yes)?|b(?:\W+no)?)$/.exec(lower);
  if (numbered && questions[Number(numbered[1]) - 1]) return { [questions[Number(numbered[1]) - 1]]: numbered[2] ? 'yes' : 'no' };
  const bare = /^(?:(a)(?:\W+yes)?|(yes)|b(?:\W+no)?|no)$/.exec(lower);
  if (bare && questions.length === 1) return { [questions[0]]: bare[1] || bare[2] ? 'yes' : 'no' };
  if (update && /^(?:update|bring) (?:the )?programme file(?: up to date)?$/.test(lower)) return { update: 'yes' };
  if (fix && /^fix (?:the )?(?:drifted )?(?:github )?settings$/.test(lower)) return { fix: 'yes' };
  const asked = questions.length === 2 ? ', or answer question 1 or 2 with A or B, one at a time (for example 2A)' : questions.length ? ', or answer question 1 with A or B' : '';
  throw new GuidedAnswerError(`This was not read as a change: "${String(text || '').trim()}". Say turn off governance, task auto-merge on or off, or change store${asked}.`);
}

module.exports = Object.freeze({ DOES, WHERE, controllerLine, branchRequiredChecks, summaryParts, finishRows, fixResultLines, mergedFiles, mergedOwnChecks, parseChange, programmeUpdate, programmeUpdateText, questionNumbers, renderSummary, renderTable, settingsRows, summaryRows, updateWords });
