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

// Branch protection and rulesets, and the security settings, from the post-merge finish's record
// (toolkit-governance-finish.cjs), else the background check's drift, else not checked.
function finishRows(finish, drift) {
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
  } else protection = rulesDrift.length ? `Drift found (${rulesDrift.length}); say toolkit governance migrate` : 'Not checked here yet';
  if (finish && (securityOn.length || securityHeld.length)) {
    security = [securityOn.length ? `On: ${listed(securityOn)}` : '', securityHeld.length ? `Waiting for you: ${listed(securityHeld)}` : ''].filter(Boolean).join('. ');
  } else security = securityDrift.length ? `Drift found (${securityDrift.length}); the agent runs toolkit governance security` : 'Not checked here yet';
  return { protection, free, security };
}

// The rows and steps for one governed repository. `facts`:
//   repository, defaultBranch, store { repository, state } (state from the store check, or null),
//   parents [issue numbers], task { auto_merge, merge_train }, requiredChecks [names],
//   finish (the finish record's on/unavailable/held, or null), drift (settings drift ids, or null),
//   files (Set of .github paths at the merged commit, or null),
//   permissions ({ checked, app, wanted, missing, stale, other, update }), app ({ variable, secret }
//   presence, or null), appCommand (the App setup line), copies ({ files } or null), stale (why the
//   merged programme file read is not fresh, or null).
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
  if (update?.open) steps.push({ part: 'Programme file', text: `An update waits in ${update.open.url}: merge it, then say toolkit governance.` });
  else if (update?.offer) steps.push({ part: 'Programme file', text: `It is behind this Toolkit: one pull request ${updateWords(update.offer)}.${update.offer.branchUnread ? " The default branch's required checks could not be read, so only Toolkit's own are added." : ''} Answer question 1 below.` });
  const finish = finishRows(facts.finish, facts.drift);
  rows.push(['Branch protection and rulesets', finish.protection, finish.free ? DOES['protection-free'] : DOES.protection]);
  rows.push(['Security settings', finish.security, DOES.security]);
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
  return { rows, steps };
}

// The owner-facing summary. `held` is whether governance actions are held until setup is complete
// (toolkit-governance-ready.cjs: the merged programme file asks for the hold and a part is gone).
function renderSummary(facts, { held = false } = {}) {
  const { rows, steps } = summaryRows(facts);
  const top = steps.length
    ? `**Governance: on, not ready: ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} left.**${held ? ' Programme records, gate records and task auto-merge are held until then.' : ''}`
    : '**Governance: on and ready.**';
  return [
    top,
    '',
    ...steps.flatMap(step => [`**${step.part}:** ${step.text}`, '', ...(step.command ? [...fenced(step.command), ''] : [])]),
    ...(steps.some(step => step.command) ? [`Say done when you have run ${steps.filter(step => step.command).length === 1 ? 'it' : 'them'}.`, ''] : []),
    '| Part | State | What it does |',
    '|---|---|---|',
    ...rows.map(([part, state, does]) => `| ${cell(part)} | ${cell(state)} | ${cell(does)} |`),
    '',
    ...(facts.stale ? [`GitHub could not be read just now (${facts.stale}), so the programme file values are the ones this computer last read.`, ''] : []),
    'To change something later, say: turn off governance, task auto-merge on or off, or change store.',
    ...(facts.update?.offer && !facts.update.open ? [
      '',
      '**1. Question: Bring the programme file up to date?**',
      `   - **A. Yes (my pick):** One pull request ${updateWords(facts.update.offer)}. Nothing else changes, and it applies only after you merge it.`,
      '   - **B. No:** Nothing is written, and Toolkit asks again next time.',
    ] : []),
  ].join('\n');
}

// A change the owner asked for in words after the summary: { governance: 'off' } | { taskAutoMerge }
// | { changeStore: true } | { cleanCopies: true } | { update: 'yes' | 'no' }, or a GuidedAnswerError.
// `copies` and `update` say whether the summary offers the cleanup and the programme file update.
function parseChange(text, { copies = false, update = false } = {}) {
  const { GuidedAnswerError } = require('./toolkit-governance-guided.cjs');
  const lower = String(text || '').trim().replace(/[.!]+$/, '').toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:turn (?:it )?off governance|turn governance off|governance off)$/.test(lower)) return { governance: 'off' };
  const merge = /^(?:turn )?(?:task )?auto[ -]?merge(?: with merge trains?)? ?(?:=|:)? ?(on|off|yes|no)$/.exec(lower) || /^turn (on|off) (?:task )?auto[ -]?merge$/.exec(lower);
  if (merge) return { taskAutoMerge: ['on', 'yes'].includes(merge[1]) ? 'on' : 'off' };
  if (/^change (?:the )?store$/.test(lower)) return { changeStore: true };
  if (copies && /^clean ?up (?:the )?(?:instruction )?copies$/.test(lower)) return { cleanCopies: true };
  if (update && /^(?:(?:1 ?)?a(?:\W+yes)?|yes|(?:update|bring) (?:the )?programme file(?: up to date)?)$/.test(lower)) return { update: 'yes' };
  if (update && /^(?:(?:1 ?)?b(?:\W+no)?|no)$/.test(lower)) return { update: 'no' };
  throw new GuidedAnswerError(`This was not read as a change: "${String(text || '').trim()}". Say turn off governance, task auto-merge on or off, or change store${update ? ', or answer question 1 with A or B' : ''}.`);
}

module.exports = Object.freeze({ DOES, branchRequiredChecks, finishRows, mergedFiles, mergedOwnChecks, parseChange, programmeUpdate, programmeUpdateText, renderSummary, summaryRows, updateWords });
