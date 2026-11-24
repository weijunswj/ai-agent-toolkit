#!/usr/bin/env node
'use strict';

// The governance GitHub App setup: the owner's own one command that makes this repository's App
// and saves its Client ID and private key on the repository.
//
//   node repo/scripts/toolkit-governance-app-setup.cjs --repo <owner/name> [--store <owner/name>]
//   node repo/scripts/toolkit-governance-app-setup.cjs --repo <owner/name> --save both|variable|secret
//        [--client-id <Client ID>] [--key-file <key file>.pem] [--replace]
//
// The owner types this in their own PowerShell or terminal, with gh signed in. It uses GitHub's App
// manifest flow: it serves a one-page form on this computer's loopback address, the browser posts it
// to GitHub's "Create GitHub App" page with the permissions filled in, the owner clicks Create, and
// GitHub sends the browser back here with a one-hour code. The script trades the code for the App's
// Client ID and private key, saves the Client ID as the repository variable and pipes the key
// straight into the repository secret, then opens the App's install page and checks the
// installation with the key. The key lives only in this process's memory: it is never printed,
// written to disk or shown to an agent. Agents never run it:
//   - it refuses in a shell a coding agent started (owner-terminal.cjs AGENT_MARKERS);
//   - it needs a terminal on stdin and stdout and a fresh Enter; a pipe, a file or a pasted blank
//     line never answers.
// It stops, changing nothing, when the repository already holds the App's variable or secret:
// The governance check (toolkit-governance.cjs check) shows how to finish or replace an existing App.
//
// --save is the by-hand App's save step: it saves the Client ID and the key file's whole key on the
// repository, the key piped into the secret on stdin, and reads both names back. It overwrites a
// name already there only with --replace, which the governance check prints only on its
// replace route, after the agent has shown the owner what would be replaced.
//
// Exit codes: 0 set up and installed, 1 stopped or not yet installed, 2 usage.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const app = require('./toolkit-governance-app.cjs');
const ownerTerminal = require('./owner-terminal.cjs');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const { AGENT_MARKERS } = ownerTerminal;
const CLIENT_ID = /^[A-Za-z0-9._-]{1,100}$/;
const SAVES = Object.freeze(['both', 'variable', 'secret']);
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const CODE = /^[A-Za-z0-9_-]{1,200}$/;
// GitHub's code lasts one hour; the owner gets most of it to click Create.
const WAIT_MS = 45 * 60 * 1000;
const USAGE = 'Usage: node toolkit-governance-app-setup.cjs --repo <owner/name> [--store <owner/name>], or --repo <owner/name> --save both|variable|secret [--client-id <Client ID>] [--key-file <key file>.pem] [--replace]';

class SetupStop extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); Object.assign(this, { stopped, next, exitCode }); }
}

const FLAGS = Object.freeze({
  '--repo': ['repo', value => SLUG.test(value)],
  '--store': ['store', value => SLUG.test(value)],
  '--save': ['save', value => SAVES.includes(value)],
  '--client-id': ['clientId', value => CLIENT_ID.test(value)],
  '--key-file': ['keyFile', value => value.length > 0 && !value.startsWith('--')],
});

function parseArgs(argv) {
  const options = { repo: null, store: null, save: null, clientId: null, keyFile: null, replace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--replace' && !options.replace) { options.replace = true; continue; }
    const [key, valid] = FLAGS[flag] || [];
    if (!key) throw new SetupStop(`${JSON.stringify(flag)} is not one of the flags below.`, USAGE, 2);
    if (options[key] !== null) throw new SetupStop(`${flag} is given twice.`, USAGE, 2);
    if (typeof value !== 'string' || !valid(value)) throw new SetupStop(`${flag} ${value === undefined ? 'has no value' : `has a value that does not fit: ${JSON.stringify(value)}`}.`, USAGE, 2);
    options[key] = value;
    index += 1;
  }
  if (!options.repo) throw new SetupStop('--repo is missing.', USAGE, 2);
  const wants = { clientId: ['both', 'variable'].includes(options.save), keyFile: ['both', 'secret'].includes(options.save) };
  const extra = !options.save ? (options.clientId || options.keyFile || options.replace) : (options.store || Boolean(options.clientId) !== wants.clientId || Boolean(options.keyFile) !== wants.keyFile);
  if (extra) throw new SetupStop('--save takes --client-id for the variable and --key-file for the secret, and no --store; --client-id, --key-file and --replace go only with --save.', USAGE, 2);
  return options;
}

// The App's manifest: the same name, page and permissions as the pre-filled link, with the webhook
// off, installable only on this account and no events.
function manifest(slug, redirect) {
  const url = `https://github.com/${slug}`;
  return { name: app.appName(slug), url, hook_attributes: { url, active: false }, redirect_url: redirect, public: false, default_permissions: { ...app.APP.permissions }, default_events: [] };
}

const escapeHtml = text => String(text).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

// The loopback page: a form that posts the manifest to GitHub's create page as soon as it loads.
function formPage(action, body) {
  return [
    '<!doctype html><meta charset="utf-8"><title>Create the governance App</title>',
    `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(body))}">`,
    '<p>Opening GitHub\'s Create GitHub App page. If nothing happens, <button type="submit">continue to GitHub</button>.</p></form>',
    '<script>document.forms[0].submit()</script>',
  ].join('\n');
}

// A loopback server for the form (`page()`) and GitHub's return. Resolves `code` with the code GitHub
// sends back with the right state; anything else gets a 404. Only requests addressed to its own
// 127.0.0.1 address count, so a web page that rebinds its own name to this computer cannot read the
// state or hand in a code.
function serveLoopback({ page, state }) {
  let deliver;
  const code = new Promise(resolve => { deliver = resolve; });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const own = request.headers.host === `127.0.0.1:${server.address().port}`;
    if (own && request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(page());
      return;
    }
    const value = url.searchParams.get('code');
    if (own && request.method === 'GET' && url.pathname === '/callback' && url.searchParams.get('state') === state && CODE.test(String(value))) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('GitHub made the App. Go back to your terminal to finish.');
      deliver(value);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found.');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, code, close: () => server.close() }));
  });
}

// Opens a web address in the owner's browser; the address is printed too, in case it does not.
function openInBrowser(url, { platform = process.platform, spawn = childProcess.spawn } = {}) {
  const [command, args] = platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false }).on('error', () => {}).unref(); } catch { /* the printed address still works */ }
}

// One gh call; `input` goes to its stdin and never onto the command line.
function ghRun(args, { input = undefined, spawn = childProcess.spawnSync } = {}) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), args, { input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false });
  } catch { return { ok: false, stdout: '' }; }
  return { ok: Boolean(result) && !result.error && result.status === 0, stdout: result && typeof result.stdout === 'string' ? result.stdout : '' };
}

// A ten-minute App token (RS256), signed with the new key, for the installation check only.
function appToken(appId, pem, now = Date.now()) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(now / 1000);
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: seconds - 60, exp: seconds + 540, iss: String(appId) })}`;
  return `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), pem).toString('base64url')}`;
}

// Whether the App is installed on `slug`: true, false, or null when GitHub could not be asked.
async function installed(slug, token, fetcher) {
  try {
    const response = await fetcher(`https://api.github.com/repos/${slug}/installation`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    return response.status === 200 ? true : response.status === 404 ? false : null;
  } catch { return null; }
}

// The by-hand App's save step: the Client ID and the key file's key on the repository, read back.
async function saveValues(options, { read, spawn, say, confirm, look }) {
  const { repo, save, clientId, keyFile, replace } = options;
  const writes = save === 'both' ? ['variable', 'secret'] : [save];
  const before = app.presence(repo, read);
  if (before.variable === 'unverified' || before.secret === 'unverified') throw new SetupStop(`the variable and secret names on ${repo} could not be read.`, 'check gh is signed in as an account that administers it, then run this again. Nothing changed.');
  const taken = writes.filter(key => before[key] === 'found');
  if (taken.length && !replace) {
    throw new SetupStop(`${repo} already has ${taken.map(key => app.APP[key]).join(' and ')}, so its App was kept.`, `ask your agent to check governance in ${repo} and show you what would be replaced; only then run this again with --replace. Nothing changed.`);
  }
  let pem = null;
  if (keyFile) {
    try { pem = fs.readFileSync(keyFile, 'utf8'); } catch { pem = null; }
    if (!pem || !pem.includes('PRIVATE KEY')) throw new SetupStop(`${keyFile} is not a readable private key file.`, 'give the .pem file the App\'s page downloaded. Nothing changed.');
  }
  say(ownerTerminal.title(`Save the governance App on ${repo}`, look));
  say(ownerTerminal.facts(writes.map(key => [key === 'variable' ? 'Client ID' : 'Private key', `${app.APP[key]}${before[key] === 'found' ? ' (replaces the saved one)' : ''}${key === 'secret' ? `, from ${keyFile}` : ''}`]), look));
  const verb = taken.length ? 'replace' : 'save';
  if (await confirm(`${verb} ${writes.length === 2 ? 'both' : 'it'} on ${repo}`) !== true) throw new SetupStop('Enter was not pressed.', 'run it again when you are ready. Nothing changed.');
  // The names above were read before the prompt. A name that was set or removed while the prompt was open
  // is not the one the owner was shown, so nothing is written; --replace covers only the names shown.
  // A name that cannot be read back is not known to be unchanged, so that stops with its own reason.
  const current = app.presence(repo, read);
  if (current.variable === 'unverified' || current.secret === 'unverified') {
    throw new SetupStop(`the variable and secret names on ${repo} could not be read back after Enter, so nothing was saved.`, 'check gh is signed in as an account that administers it, then run this again. Nothing changed.');
  }
  if (writes.some(key => current[key] !== before[key])) {
    throw new SetupStop(`${repo} changed while the prompt was open (variable ${current.variable}, secret ${current.secret}), so nothing was saved.`, 'run this again to see what is there now. Nothing changed.');
  }
  const variable = writes.includes('variable') ? ghRun(['variable', 'set', app.APP.variable, '--repo', repo, '--body', clientId], { spawn }) : { ok: true };
  const secret = variable.ok && writes.includes('secret') ? ghRun(['secret', 'set', app.APP.secret, '--repo', repo], { spawn, input: pem }) : { ok: variable.ok };
  const after = app.presence(repo, read);
  if (!variable.ok || !secret.ok || writes.some(key => after[key] !== 'found')) {
    throw new SetupStop(`the App's values did not read back on ${repo} (variable ${after.variable}, secret ${after.secret}).`, `ask your agent to check governance in ${repo}, then run this again.`);
  }
  say(ownerTerminal.ok(`Saved on ${repo}: ${writes.map(key => app.APP[key]).join(' and ')}, read back.`, look));
  if (keyFile) say(ownerTerminal.say(`Delete ${keyFile} now: it is the App's password and never expires.`, look));
  if (taken.length) say(ownerTerminal.say('Then remove this repository from the old App\'s installation (Installed GitHub Apps, Configure, Repository access).', look));
  return 0;
}

async function setup(argv, deps = {}) {
  const {
    environment = process.env, tty = () => ({ stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) }),
    say = line => process.stdout.write(`${line}\n`), spawn = childProcess.spawnSync,
    serve = serveLoopback, open = openInBrowser, fetcher = globalThis.fetch, wait = WAIT_MS, now = Date.now,
  } = deps;
  const confirm = deps.confirm || (effect => ownerTerminal.pressEnter(effect, { output: process.stdout, environment }));
  const look = { stream: deps.say ? null : process.stdout, environment };
  const options = parseArgs(argv);
  const { repo, store } = options;
  const refused = ownerTerminal.refusal({ environment, tty: tty() });
  if (refused) throw new SetupStop(refused.stopped, refused.next);
  const read = { reader: args => app.ghReader(args, { spawn }) };
  const owner = app.ownerType(repo, read);
  if (!owner) throw new SetupStop(`gh could not read ${repo}.`, 'sign gh in (gh auth login) as an account that administers it, then run this again. Nothing changed.');
  if (options.save) return saveValues(options, { read, spawn, say, confirm, look });
  const before = app.presence(repo, read);
  if (before.variable !== 'missing' || before.secret !== 'missing') {
    throw new SetupStop(`${repo} already holds part of an App setup, or its names could not be read (variable ${before.variable}, secret ${before.secret}).`, `ask your agent to check governance in ${repo}: it shows how to finish or replace that App. Nothing changed.`);
  }
  const repositories = store ? `${repo} and ${store}` : repo;
  say(ownerTerminal.title(`Set up ${repo}'s governance GitHub App`, look));
  say(ownerTerminal.facts([
    ['App', app.appName(repo)],
    ['Permissions', `${app.permissionText()}; webhook off; this account only`],
    ['Saves on repo', `${app.APP.variable} and ${app.APP.secret}`],
    ['Installs on', repositories],
  ], look));
  say(ownerTerminal.say('Your browser opens GitHub with all of this filled in: you only click Create. The key goes straight to the repository secret and is never shown or saved here.', look));
  if (await confirm('open GitHub and create the App') !== true) throw new SetupStop('Enter was not pressed.', 'run it again when you are ready. Nothing changed.');

  const state = crypto.randomBytes(16).toString('hex');
  const create = owner === 'Organization' ? `https://github.com/organizations/${repo.split('/')[0]}/settings/apps/new` : 'https://github.com/settings/apps/new';
  // The page names the server's own return address, so the server starts first and serves it once built.
  let page = '';
  const local = await serve({ page: () => page, state });
  page = formPage(`${create}?state=${state}`, manifest(repo, `${local.url}/callback`));
  let code;
  try {
    open(local.url);
    say(`If your browser did not open, open ${local.url}`);
    say(`Waiting for GitHub (up to ${Math.round(wait / 60000)} minutes)...`);
    let timer;
    code = await Promise.race([local.code, new Promise(resolve => { timer = setTimeout(() => resolve(null), wait); })]);
    clearTimeout(timer);
  } finally { local.close(); }
  if (!code) throw new SetupStop('GitHub did not send the App back in time.', 'if you clicked Create, delete that App (Settings, Developer settings, GitHub Apps, the App, Advanced) and run this again. Nothing was saved on the repository.');

  const converted = ghRun(['api', '-X', 'POST', `app-manifests/${code}/conversions`], { spawn });
  let made = null;
  try { made = converted.ok ? JSON.parse(converted.stdout) : null; } catch { made = null; }
  const pem = made && typeof made.pem === 'string' && made.pem.includes('PRIVATE KEY') ? made.pem : null;
  if (!made || !pem || typeof made.client_id !== 'string' || !made.id || typeof made.html_url !== 'string') {
    throw new SetupStop('GitHub did not hand over the new App\'s Client ID and key.', 'if GitHub made the App, delete it (Settings, Developer settings, GitHub Apps) and run this again. Nothing was saved on the repository.');
  }
  // The App must belong to the repository's owner, the account whose create page the form posted to.
  const madeBy = typeof made.owner?.login === 'string' ? made.owner.login : '';
  if (madeBy.toLowerCase() !== repo.split('/')[0].toLowerCase()) {
    throw new SetupStop(`the new App belongs to ${madeBy || 'an unknown account'}, not ${repo.split('/')[0]}, so nothing was saved.`, `delete that App (${made.html_url}, its settings, Advanced) and run this again signed in to GitHub as ${repo.split('/')[0]} or one of its owners.`);
  }
  const appPage = made.html_url;
  const settings = `https://github.com/${owner === 'Organization' ? `organizations/${repo.split('/')[0]}/` : ''}settings/apps/${made.slug}`;
  const again = app.presence(repo, read);
  if (again.variable !== 'missing' || again.secret !== 'missing') {
    throw new SetupStop(`someone set up an App on ${repo} meanwhile (variable ${again.variable}, secret ${again.secret}), so nothing was saved.`, `delete the App just made (${settings}, Advanced) and ask your agent to check governance in ${repo}.`);
  }
  const variable = ghRun(['variable', 'set', app.APP.variable, '--repo', repo, '--body', made.client_id], { spawn });
  const secret = variable.ok ? ghRun(['secret', 'set', app.APP.secret, '--repo', repo], { spawn, input: pem }) : { ok: false };
  const after = app.presence(repo, read);
  if (!variable.ok || !secret.ok || after.variable !== 'found' || after.secret !== 'found') {
    throw new SetupStop(`the App's values did not read back on ${repo} (variable ${after.variable}, secret ${after.secret}).`, `delete the App (${settings}, Advanced) and anything saved on ${repo}, then run this again.`);
  }
  say(ownerTerminal.ok(`Saved on ${repo}: ${app.APP.variable} and ${app.APP.secret}, read back.`, look));

  const install = `${appPage}/installations/new`;
  open(install);
  say(ownerTerminal.say(`Install the App: on ${install} choose Only select repositories, pick ${repositories}, then Install.`, look));
  if (await confirm('check the installation') !== true) throw new SetupStop('the installation was not checked.', `ask your agent to check governance in ${repo} once the App is installed.`);
  const token = appToken(made.id, pem, now());
  const lines = [];
  let missing = false;
  for (const slug of store ? [repo, store] : [repo]) {
    const result = await installed(slug, token, fetcher);
    if (result !== true) missing = missing || slug === repo || result === false;
    lines.push(`${slug}: ${result === true ? 'installed' : result === false ? `not installed yet; add it on ${install}` : 'could not be checked'}.`);
  }
  lines.forEach(line => say(line));
  say(missing ? `Not finished: add the missing repository on ${install}, then ask your agent to check governance in ${repo}.` : ownerTerminal.ok(`Done. Ask your agent to check governance in ${repo} to see the App reported as set.`, look));
  return missing ? 1 : 0;
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const say = deps.say || (line => process.stdout.write(`${line}\n`));
  try { return await setup(argv, { ...deps, say }); } catch (error) {
    if (!(error instanceof SetupStop)) throw error;
    say(ownerTerminal.stop(error.stopped, error.next, { stream: deps.say ? null : process.stdout, environment: deps.environment || process.env }));
    return error.exitCode;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = Object.freeze({ SetupStop, parseArgs, manifest, formPage, serveLoopback, openInBrowser, appToken, installed, setup, main });
