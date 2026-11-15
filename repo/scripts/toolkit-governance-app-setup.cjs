#!/usr/bin/env node
'use strict';

// The governance GitHub App setup: the owner's own one command that makes this repository's App
// and saves its Client ID and private key on the repository.
//
//   node repo/scripts/toolkit-governance-app-setup.cjs --repo <owner/name> [--store <owner/name>]
//
// The owner types this in their own PowerShell or terminal, with gh signed in. It uses GitHub's App
// manifest flow: it serves a one-page form on this computer's loopback address, the browser posts it
// to GitHub's "Create GitHub App" page with the permissions filled in, the owner clicks Create, and
// GitHub sends the browser back here with a one-hour code. The script trades the code for the App's
// Client ID and private key, saves the Client ID as the repository variable and pipes the key
// straight into the repository secret, then opens the App's install page and checks the
// installation with the key. The key lives only in this process's memory: it is never printed,
// written to disk or shown to an agent. Agents never run it:
//   - it refuses in a shell a coding agent started (the markers `toolkit permissions --apply` uses);
//   - it needs a terminal on stdin and stdout and the typed word; a pipe or file never answers.
// It stops, changing nothing, when the repository already holds the App's variable or secret:
// `toolkit governance check` shows how to finish or replace an existing App.
//
// Exit codes: 0 set up and installed, 1 stopped or not yet installed, 2 usage.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const readline = require('node:readline');
const app = require('./toolkit-governance-app.cjs');
const { AGENT_HOST_MARKER_NAMES } = require('./agent-host-markers.cjs');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const AGENT_MARKERS = Object.freeze([...AGENT_HOST_MARKER_NAMES, 'AI_AGENT']);
const CONFIRM = 'create';
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const CODE = /^[A-Za-z0-9_-]{1,200}$/;
// GitHub's code lasts one hour; the owner gets most of it to click Create.
const WAIT_MS = 45 * 60 * 1000;
const USAGE = 'Usage: node toolkit-governance-app-setup.cjs --repo <owner/name> [--store <owner/name>]';

class SetupStop extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); this.exitCode = exitCode; }
}

function parseArgs(argv) {
  const options = { repo: null, store: null };
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    const key = flag === '--repo' ? 'repo' : flag === '--store' ? 'store' : null;
    if (!key || options[key] !== null || typeof value !== 'string' || !SLUG.test(value)) {
      throw new SetupStop(`${JSON.stringify(flag)} is not --repo or --store with an owner/name.`, USAGE, 2);
    }
    options[key] = value;
  }
  if (!options.repo) throw new SetupStop('--repo is missing.', USAGE, 2);
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
// sends back with the right state; anything else gets a 404.
function serveLoopback({ page, state }) {
  let deliver;
  const code = new Promise(resolve => { deliver = resolve; });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(page());
      return;
    }
    const value = url.searchParams.get('code');
    if (request.method === 'GET' && url.pathname === '/callback' && url.searchParams.get('state') === state && CODE.test(String(value))) {
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

// One question on the owner's terminal.
function terminalAsk(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;
    rl.question(question, (answer) => { answered = true; resolve(answer); rl.close(); });
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}

async function setup(argv, deps = {}) {
  const {
    environment = process.env, tty = () => ({ stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) }),
    ask = terminalAsk, say = line => process.stdout.write(`${line}\n`), spawn = childProcess.spawnSync,
    serve = serveLoopback, open = openInBrowser, fetcher = globalThis.fetch, wait = WAIT_MS, now = Date.now,
  } = deps;
  const { repo, store } = parseArgs(argv);
  const marker = AGENT_MARKERS.find(name => Boolean(environment[name]));
  if (marker) throw new SetupStop(`this shell was started by a coding agent (${marker}). Agents never set up the governance App.`, 'the owner runs this in their own PowerShell or terminal, outside any agent. Nothing changed.');
  const terminal = tty();
  if (!terminal.stdin || !terminal.stdout) throw new SetupStop('this needs your own terminal (no pipe or file).', 'run it in your own PowerShell or terminal. Nothing changed.');
  const read = { reader: args => app.ghReader(args, { spawn }) };
  const owner = app.ownerType(repo, read);
  if (!owner) throw new SetupStop(`gh could not read ${repo}.`, 'sign gh in (gh auth login) as an account that administers it, then run this again. Nothing changed.');
  const before = app.presence(repo, read);
  if (before.variable !== 'missing' || before.secret !== 'missing') {
    throw new SetupStop(`${repo} already holds part of an App setup, or its names could not be read (variable ${before.variable}, secret ${before.secret}).`, `run toolkit governance check in ${repo}: it shows how to finish or replace that App. Nothing changed.`);
  }
  const repositories = store ? `${repo} and ${store}` : repo;
  say(`This makes ${repo}'s own governance GitHub App, ${app.appName(repo)}, with ${app.permissionText()} (webhook off, installable only on this account), saves its Client ID as ${app.APP.variable} and its private key as ${app.APP.secret} on ${repo}, then opens its install page for ${repositories}.`);
  say('Your browser opens GitHub\'s Create GitHub App page with all of this filled in; you only click Create. The key goes straight from GitHub to the repository secret: it is never shown or saved on this computer.');
  if (String(await ask(`Type ${CONFIRM} to go on: `)).trim() !== CONFIRM) throw new SetupStop(`you did not type ${CONFIRM}.`, 'run it again when you are ready. Nothing changed.');

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
  const appPage = made.html_url;
  const settings = `https://github.com/${owner === 'Organization' ? `organizations/${repo.split('/')[0]}/` : ''}settings/apps/${made.slug}`;
  const again = app.presence(repo, read);
  if (again.variable !== 'missing' || again.secret !== 'missing') {
    throw new SetupStop(`someone set up an App on ${repo} meanwhile (variable ${again.variable}, secret ${again.secret}), so nothing was saved.`, `delete the App just made (${settings}, Advanced) and run toolkit governance check in ${repo}.`);
  }
  const variable = ghRun(['variable', 'set', app.APP.variable, '--repo', repo, '--body', made.client_id], { spawn });
  const secret = variable.ok ? ghRun(['secret', 'set', app.APP.secret, '--repo', repo], { spawn, input: pem }) : { ok: false };
  const after = app.presence(repo, read);
  if (!variable.ok || !secret.ok || after.variable !== 'found' || after.secret !== 'found') {
    throw new SetupStop(`the App's values did not read back on ${repo} (variable ${after.variable}, secret ${after.secret}).`, `delete the App (${settings}, Advanced) and anything saved on ${repo}, then run this again.`);
  }
  say(`Saved on ${repo}: ${app.APP.variable} and ${app.APP.secret}, read back.`);

  const install = `${appPage}/installations/new`;
  open(install);
  say(`Install the App: on ${install} choose Only select repositories, pick ${repositories}, then Install.`);
  await ask('Press Enter once it is installed: ');
  const token = appToken(made.id, pem, now());
  const lines = [];
  let missing = false;
  for (const slug of store ? [repo, store] : [repo]) {
    const result = await installed(slug, token, fetcher);
    if (result !== true) missing = missing || slug === repo || result === false;
    lines.push(`${slug}: ${result === true ? 'installed' : result === false ? `not installed yet; add it on ${install}` : 'could not be checked'}.`);
  }
  lines.forEach(line => say(line));
  say(missing ? `Not finished: add the missing repository on ${install}, then run toolkit governance check in ${repo}.` : `Done. Run toolkit governance check in ${repo} to see the App reported as set.`);
  return missing ? 1 : 0;
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const say = deps.say || (line => process.stdout.write(`${line}\n`));
  try { return await setup(argv, { ...deps, say }); } catch (error) {
    if (!(error instanceof SetupStop)) throw error;
    say(error.message);
    return error.exitCode;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = Object.freeze({ CONFIRM, SetupStop, parseArgs, manifest, formPage, serveLoopback, openInBrowser, appToken, installed, setup, main });
