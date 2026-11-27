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

const { spawnSync } = require('node:child_process');

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
  shards: 'Split long test runs across runners',
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
function mergedFiles(root, commit) {
  if (typeof root !== 'string' || !/^[0-9a-f]{40}$/i.test(String(commit || ''))) return null;
  try {
    const result = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', commit, '--', '.github'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false });
    if (result.error || result.status !== 0) return null;
    return new Set(String(result.stdout).split(/\r?\n/).filter(Boolean));
  } catch { return null; }
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
//   files (Set of .github paths at the merged commit, or null), shards (the shards row text, or null),
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
  const finish = finishRows(facts.finish, facts.drift);
  rows.push(['Branch protection and rulesets', finish.protection, finish.free ? DOES['protection-free'] : DOES.protection]);
  rows.push(['Security settings', finish.security, DOES.security]);
  const workflows = presenceRow(WORKFLOW_FILES, facts.files, { defaultBranch: facts.defaultBranch });
  rows.push(['Cloud workflows', workflows.state || 'None', DOES.workflows]);
  const guards = presenceRow(GUARD_FILES, facts.files);
  rows.push(['Guards', guards.state || 'None', DOES.guards]);
  if (facts.shards) rows.push(['Parallel CI shards', facts.shards, DOES.shards]);
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
    ...(steps.some(step => step.command) ? ['Say done when you have run them.', ''] : []),
    '| Part | State | What it does |',
    '|---|---|---|',
    ...rows.map(([part, state, does]) => `| ${cell(part)} | ${cell(state)} | ${cell(does)} |`),
    '',
    ...(facts.stale ? [`GitHub could not be read just now (${facts.stale}), so the programme file values are the ones this computer last read.`, ''] : []),
    'To change something later, say: turn off governance, task auto-merge on or off, or change store.',
  ].join('\n');
}

// A change the owner asked for in words after the summary: { governance: 'off' } | { taskAutoMerge }
// | { changeStore: true } | { cleanCopies: true } | { shards }, or a GuidedAnswerError. `copies` and
// `shards` say whether the summary offers those changes.
function parseChange(text, { copies = false, shards = false } = {}) {
  const { GuidedAnswerError } = require('./toolkit-governance-guided.cjs');
  const lower = String(text || '').trim().replace(/[.!]+$/, '').toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:turn (?:it )?off governance|turn governance off|governance off)$/.test(lower)) return { governance: 'off' };
  const merge = /^(?:turn )?(?:task )?auto[ -]?merge(?: with merge trains?)? ?(?:=|:)? ?(on|off|yes|no)$/.exec(lower) || /^turn (on|off) (?:task )?auto[ -]?merge$/.exec(lower);
  if (merge) return { taskAutoMerge: ['on', 'yes'].includes(merge[1]) ? 'on' : 'off' };
  if (/^change (?:the )?store$/.test(lower)) return { changeStore: true };
  if (copies && /^clean ?up (?:the )?(?:instruction )?copies$/.test(lower)) return { cleanCopies: true };
  const split = /^shards ?= ?(yes|not-now|never)$/.exec(lower);
  if (shards && split) return { shards: split[1] };
  throw new GuidedAnswerError(`This was not read as a change: "${String(text || '').trim()}". Say turn off governance, task auto-merge on or off, or change store.`);
}

module.exports = Object.freeze({ DOES, finishRows, mergedFiles, parseChange, renderSummary, summaryRows });
