'use strict';

// The governance GitHub App: the one App every Toolkit governance workflow mints its short-lived
// tokens from. Turning governance on shows the owner how to set it up, turning it off suggests and
// guides its removal, and `toolkit governance check` keeps reporting either. Toolkit only prints the
// owner's steps and reads whether the repository's variable and secret exist (names only); it never
// creates, installs or deletes an App, key, variable or secret.
const childProcess = require('node:child_process');
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

// GitHub's pre-filled "New GitHub App" page for a personal account.
function creationLink(slug) {
  const owner = slug.split('/')[0];
  const params = new URLSearchParams({ name: `${owner}-toolkit-governance`, url: `https://github.com/${slug}`, public: 'false', webhook_active: 'false', ...APP.permissions });
  return `https://github.com/settings/apps/new?${params}`;
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

// The owner's save commands for `which` ('both', 'variable' or 'secret'). Each first lists the
// repository's variable and secret names and stops, changing nothing, when either list cannot be read.
// When a name it would write is already there, it asks for a typed "replace" before overwriting; any
// other answer, or none, keeps the existing App. The names never change, so every repository is found
// and cleaned the same way. The macOS or Linux line uses only POSIX shell (no read -p), so it runs in
// bash, zsh and dash alike.
function saveCommands(slug, which = 'both') {
  const writes = which === 'both' ? [APP.variable, APP.secret] : [APP[which]];
  const ask = `${slug} already has a governance App set up. Type replace to overwrite it`;
  const kept = 'Kept the existing App. Nothing changed.';
  const unread = 'Could not read the names. Nothing changed.';
  const list = kind => `gh ${kind} list --repo ${slug} --json name --jq '.[].name'`;
  const ps = {
    variable: `gh variable set ${APP.variable} --repo ${slug} --body "<Client ID>"`,
    secret: `Get-Content -Raw "<key file>.pem" | gh secret set ${APP.secret} --repo ${slug}`,
  };
  const sh = {
    variable: `gh variable set ${APP.variable} --repo ${slug} --body "<Client ID>"`,
    secret: `gh secret set ${APP.secret} --repo ${slug} < "<key file>.pem"`,
  };
  const keys = which === 'both' ? ['variable', 'secret'] : [which];
  const psFound = writes.map(name => `$names -contains '${name}'`).join(' -or ');
  return [
    `   PowerShell: $v = ${list('variable')}; $ok = $LASTEXITCODE -eq 0; $s = ${list('secret')}; $names = @($v) + @($s); if (-not $ok -or $LASTEXITCODE -ne 0) { '${unread}' } elseif ((${psFound}) -and (Read-Host '${ask}') -ne 'replace') { '${kept}' } else { ${keys.map(key => ps[key]).join('; ')} }`,
    `   macOS or Linux: if ! v=$(${list('variable')}) || ! s=$(${list('secret')}); then echo '${unread}'; elif printf '%s\\n%s\\n' "$v" "$s" | grep -qxE '${writes.join('|')}' && { printf '%s: ' '${ask}'; read -r answer; [ "$answer" != replace ]; }; then echo '${kept}'; else ${keys.map(key => sh[key]).join(' && ')}; fi`,
  ];
}

const found = state => state.variable === 'found' || state.secret === 'found';

function setupLines(slug, store, state) {
  if (set(state)) return [`Governance GitHub App: the variable and the secret are set on ${slug}. Reuse that App: do not set it up again. The first governance job run proves the App is installed.`];
  if (found(state)) return [
    `Governance GitHub App: ${slug} already has part of an App setup (variable ${state.variable}, secret ${state.secret}). Reuse that App: set only what is missing, from the same App (the same Client ID and a private key generated for it). Toolkit never overwrites it for you.`,
    ...(state.variable === 'found' && state.secret === 'found' ? [] : state.variable === 'found'
      ? [`To set only the missing secret, from the App whose Client ID is already saved here:`, ...saveCommands(slug, 'secret')]
      : state.secret === 'found'
        ? [`To set only the missing variable, the Client ID of the App whose key is already saved here:`, ...saveCommands(slug, 'variable')]
        : []),
    `To replace it with a different App instead, save the new Client ID and key with these commands; they ask you to type replace first:`,
    ...saveCommands(slug),
    'Then remove this repository from the old App\'s installation (Installed GitHub Apps, Configure, Repository access).',
  ];
  const repositories = store ? `${slug} and ${store}` : slug;
  return [
    `Governance GitHub App: the governance jobs on GitHub do nothing until the App is set up (${unknown(state) ? `could not be checked (${state.reason})` : `variable ${state.variable}, secret ${state.secret}`}). Toolkit never creates it for you. After you merge the governance pull request:`,
    `1. Create the App once for your account from this pre-filled page: ${creationLink(slug)}`,
    `   Check the page: webhook "Active" unticked, installable only on this account, repository permissions ${permissionText()}, and everything else, Workflows included, no access.`,
    '2. On the App\'s page, copy the Client ID and generate a private key (a .pem file downloads).',
    `3. Install App, Only select repositories: ${repositories}.`,
    `4. Save both on ${slug}, then delete the .pem file. If someone else has set up an App here meanwhile, these ask you to type replace before overwriting it:`,
    ...saveCommands(slug),
    'Already set the App up for another repository? Skip steps 1 and 2: add this repository to its installation and set the variable and the secret here, generating a new private key if you no longer hold one.',
  ];
}

function removalLines(slug, state, others) {
  const installation = 'Installed GitHub Apps, Configure, Repository access';
  if (none(state)) return [`Governance GitHub App: no App variable or secret is left on ${slug}. If the App's installation still lists ${slug}, remove it there (${installation}).`];
  return [
    `Governance GitHub App: after you merge the pull request that turns governance off, remove what ${slug} no longer needs. Toolkit never deletes it for you:`,
    `1. gh variable delete ${APP.variable} --repo ${slug}`,
    `   gh secret delete ${APP.secret} --repo ${slug}`,
    `2. Remove ${slug} from the App's installation: GitHub Settings, Applications, ${installation}.`,
    '3. If no other repository uses the App, also remove the evidence store from the installation, uninstall the App and delete it (the App\'s settings, Advanced, Delete GitHub App); its private keys stop working.',
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

module.exports = Object.freeze({ APP, permissionLabel, creationLink, saveCommands, ghReader, presence, setupLines, removalLines, appFinding });
