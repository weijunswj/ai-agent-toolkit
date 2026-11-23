'use strict';

// The governance GitHub App: each governed repository has its own App, which every Toolkit governance
// workflow of that repository mints its short-lived tokens from. GitHub counts its hourly allowance
// per App installation, so one App per repository gives each repository its own allowance and a busy
// repository never slows another. Turning governance on shows the owner how to set it up, turning it
// off suggests and guides its removal, and `toolkit governance check` keeps reporting either. The
// check reads only the names of the variable and the secret, so it cannot tell whether two
// repositories share one App. Toolkit only prints the
// owner's steps and reads whether the repository's variable and secret exist (names only); it never
// creates, installs or deletes an App, key, variable or secret.
const childProcess = require('node:child_process');
const path = require('node:path');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

// The App's one permission list, with its display names and levels. Every workflow narrows its own
// token to a part of it (a test holds the workflows to it), and the cloud jobs contract names only
// which of these each token takes.
const APP = Object.freeze({
  variable: 'TOOLKIT_GOVERNANCE_APP_CLIENT_ID',
  secret: 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY',
  permissions: Object.freeze({ contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' }),
});
const LABELS = Object.freeze({ contents: 'Contents', issues: 'Issues', pull_requests: 'Pull requests', checks: 'Checks', statuses: 'Commit statuses' });
const LEVELS = Object.freeze({ read: 'read-only', write: 'read and write' });
const PAGE = 100;
// The owner's setup and save command (it refuses under an agent).
const SETUP_SCRIPT = path.join(__dirname, 'toolkit-governance-app-setup.cjs');

// GitHub App names are unique across GitHub and at most 34 characters long.
const NAME_LIMIT = 34;
// The repository's own App name: owner, repository and "governance" when that fits, else the
// repository name alone, cut to fit. The owner can change it on GitHub's page if it is taken.
function appName(slug) {
  const [owner, repo] = slug.split('/');
  const suffix = '-governance';
  for (const name of [`${owner}-${repo}${suffix}`, `${repo}${suffix}`]) if (name.length <= NAME_LIMIT) return name;
  return `${repo.slice(0, NAME_LIMIT - suffix.length).replace(/[-_.]+$/, '')}${suffix}`;
}

// Who owns the repository: 'Organization', 'User', or null when it cannot be read. One read-only
// `repos/<slug>` call, which works wherever the repository's variables can be listed.
function ownerType(slug, { reader = ghReader, offline = false } = {}) {
  if (offline) return null;
  let read;
  try { read = reader([`repos/${slug}`]); } catch { return null; }
  const type = read && read.ok === true ? read.value?.owner?.type : null;
  return type === 'Organization' || type === 'User' ? type : null;
}

// How a permission reads in GitHub's App settings: "Issues read and write".
const permissionLabel = (name, level) => `${LABELS[name]} ${LEVELS[level]}`;

function permissionText() {
  return Object.entries(APP.permissions).map(([name, level]) => permissionLabel(name, level)).join(', ');
}

// One read-only `gh api` call; `spawn` is for tests.
function ghReader(args, { spawn = childProcess.spawnSync } = {}) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false });
  } catch { return { ok: false, reason: 'gh-unavailable' }; }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) return { ok: false, reason: /HTTP 404/.test(String(result.stderr || '')) ? 'repository-not-visible' : 'gh-request-failed' };
  try { return { ok: true, value: JSON.parse(result.stdout) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

// { variable, secret }: found | missing | unverified, plus the reason when any is unverified. Lists
// names on one page; anything unreadable or longer than a page is unverified, never missing.
function presence(slug, { reader = ghReader, offline = false } = {}) {
  if (offline) return { variable: 'unverified', secret: 'unverified', reason: 'offline' };
  const result = {};
  let reason = null;
  for (const [key, kind, name] of [['variable', 'variables', APP.variable], ['secret', 'secrets', APP.secret]]) {
    let read;
    try { read = reader([`repos/${slug}/actions/${kind}?per_page=${PAGE}`]); } catch { read = { ok: false, reason: 'reader-failed' }; }
    const list = read && read.ok === true && read.value && Array.isArray(read.value[kind]) ? read.value[kind] : null;
    if (!list || read.value.total_count > list.length) {
      result[key] = 'unverified';
      reason = reason || (read && read.ok === false && read.reason) || 'too-many-or-unreadable';
      continue;
    }
    result[key] = list.some(item => item && item.name === name) ? 'found' : 'missing';
  }
  return reason ? { ...result, reason } : result;
}

const set = state => state.variable === 'found' && state.secret === 'found';
const none = state => state.variable === 'missing' && state.secret === 'missing';
const unknown = state => state.variable === 'unverified' || state.secret === 'unverified';

// The owner's save command for `which` ('both', 'variable' or 'secret'): the setup script's --save
// step, run in the owner's own terminal. It reads the repository's variable and secret names first,
// stops when it cannot, and keeps an App already there unless the command carries --replace, which
// only the replace route prints. It then asks for a fresh Enter, pipes the key into the secret on
// stdin and reads both names back. The names never change, so every repository is found and cleaned
// the same way.
function saveCommands(slug, which = 'both', { replace = false } = {}) {
  const parts = [`node "${SETUP_SCRIPT}" --repo ${slug} --save ${which}`];
  if (which !== 'secret') parts.push('--client-id "<Client ID>"');
  if (which !== 'variable') parts.push('--key-file "<key file>.pem"');
  if (replace) parts.push('--replace');
  return [`   ${parts.join(' ')}`];
}

const found = state => state.variable === 'found' || state.secret === 'found';

// The repository's Actions settings page for variables or secrets (Settings, Secrets and variables,
// Actions). Repository level for personal and organisation repositories alike.
const settingsPage = (slug, kind) => `https://github.com/${slug}/settings/${kind}/actions`;

// The owner's by-hand steps on GitHub's website for `which` ('both', 'variable' or 'secret'): the
// lead way to save the App's values. Each step first has the owner look for the name and stop when
// it is already listed, so a by-hand save never overwrites another App either.
function manualSteps(slug, which = 'both') {
  const steps = {
    variable: `Variables tab (${settingsPage(slug, 'variables')}): if ${APP.variable} is already listed, stop and reuse that App. Otherwise select New repository variable, Name ${APP.variable}, Value the Client ID, then Add variable.`,
    secret: `Secrets tab (${settingsPage(slug, 'secrets')}): if ${APP.secret} is already listed, stop and reuse that App. Otherwise select New repository secret, Name ${APP.secret}. For Secret, open the .pem file in a text editor (Notepad works) and paste all of it, the BEGIN and END lines included, then Add secret.`,
  };
  const keys = which === 'both' ? ['variable', 'secret'] : [which];
  return [
    `   By hand on GitHub: open ${slug}, Settings, Secrets and variables, Actions.`,
    ...keys.map((key, index) => `   ${String.fromCharCode(97 + index)}. ${steps[key]}`),
  ];
}

// The owner's one setup line (owner decision of 24 Nov: one line to paste into PowerShell, nothing to
// choose): the setup script with this repository and its evidence store filled in. It runs only in
// the owner's own terminal, so the App's private key never passes through an agent.
function setupCommand(slug, store = null) {
  return `node "${SETUP_SCRIPT}" --repo ${slug}${store ? ` --store ${store}` : ''}`;
}
// What the owner does after pasting it, as the setup script asks for it.
const SETUP_STEPS = 'It asks for Enter before it opens GitHub and again before it checks the installation; on GitHub you click Create, then Install. It runs only outside an agent, so the App\'s private key never passes through one.';

function setupLines(slug, store, state) {
  if (set(state)) return [`Governance GitHub App: the variable and the secret are set on ${slug}. Reuse that App: do not set it up again. The first governance job run proves the App is installed.`];
  if (found(state)) return [
    `Governance GitHub App: ${slug} already has part of an App setup (variable ${state.variable}, secret ${state.secret}). Reuse that App: set only what is missing, from the same App (the same Client ID and a private key generated for it). Toolkit never overwrites it for you.`,
    ...(state.variable === 'found' && state.secret === 'found' ? [] : state.variable === 'found'
      ? [`To set only the missing secret, from the App whose Client ID is already saved here:`, ...manualSteps(slug, 'secret'), '   Or in your own terminal, with gh signed in:', ...saveCommands(slug, 'secret'), '   Then delete the .pem file.']
      : state.secret === 'found'
        ? [`To set only the missing variable, the Client ID of the App whose key is already saved here:`, ...manualSteps(slug, 'variable'), '   Or in your own terminal, with gh signed in:', ...saveCommands(slug, 'variable')]
        : []),
    `To replace it with a different App instead, on the same Variables and Secrets tabs edit each saved value to the new App's Client ID and whole key. Or, once you have seen in chat what would be replaced, run this in your own terminal with gh signed in; it asks for Enter before it overwrites anything:`,
    ...saveCommands(slug, 'both', { replace: true }),
    'Then remove this repository from the old App\'s installation (Installed GitHub Apps, Configure, Repository access).',
  ];
  return [
    `Governance GitHub App: the governance jobs on GitHub do nothing until the App is set up (${unknown(state) ? `could not be checked (${state.reason})` : `variable ${state.variable}, secret ${state.secret}`}). Toolkit never creates it for you. After you merge the governance pull request, paste this one line into PowerShell and press Enter:`,
    `   ${setupCommand(slug, store)}`,
    SETUP_STEPS,
  ];
}

function removalLines(slug, state, others) {
  const installation = 'Installed GitHub Apps, Configure, Repository access';
  if (none(state)) return [`Governance GitHub App: no App variable or secret is left on ${slug}. If the App's installation still lists ${slug}, remove it there (${installation}).`];
  return [
    `Governance GitHub App: the pull request that turns governance off also removes the cloud sweep copies (.github/workflows/toolkit-programme-sweep.yml and its gate). After you merge it, remove the App's variable and secret from ${slug} yourself. Toolkit never deletes them for you:`,
    `1. By hand on GitHub: open ${slug}, Settings, Secrets and variables, Actions. Delete ${APP.variable} on the Variables tab (${settingsPage(slug, 'variables')}) and ${APP.secret} on the Secrets tab (${settingsPage(slug, 'secrets')}).`,
    '   Or from the command line, with gh signed in:',
    `   gh variable delete ${APP.variable} --repo ${slug}`,
    `   gh secret delete ${APP.secret} --repo ${slug}`,
    `2. Remove ${slug} from the App's installation: GitHub Settings, Applications, ${installation}.`,
    '3. If no other repository uses the App (with one App per repository, none does), also remove the evidence store from the installation, uninstall the App and delete it (the App\'s settings, Advanced, Delete GitHub App); its private keys stop working.',
    `4. Check both halves are gone: run toolkit governance check in ${slug}. It should report no App variable or secret left over and no cloud sweep copies.`,
    others.length
      ? `This computer knows these repositories still use governance: ${others.join(', ')}. Other computers may know more.`
      : 'This computer knows no other repository that still uses governance. Other computers may know more, so check before deleting the App.',
  ];
}

// The `toolkit governance check` finding, or null when there is nothing to say.
function appFinding(stateName, slug, store, state, others) {
  const finding = (id, severity, lines) => Object.freeze({ id, severity, message: lines.join('\n  ') });
  if (stateName === 'ENABLED') {
    if (set(state)) return finding('GOVERNANCE_APP_SET', 'info', setupLines(slug, store, state));
    return finding(unknown(state) ? 'GOVERNANCE_APP_UNVERIFIED' : 'GOVERNANCE_APP_NOT_SET_UP', unknown(state) ? 'unverified' : 'info', setupLines(slug, store, state));
  }
  if (state.variable === 'found' || state.secret === 'found') return finding('GOVERNANCE_APP_LEFT_OVER', 'info', removalLines(slug, state, others));
  return null;
}

module.exports = Object.freeze({ APP, NAME_LIMIT, appName, permissionLabel, permissionText, ownerType, manualSteps, saveCommands, setupCommand, SETUP_STEPS, ghReader, presence, setupLines, removalLines, appFinding });
