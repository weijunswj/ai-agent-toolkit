'use strict';

// Two required parts of a governed repository that Toolkit checks itself (INT-TK421-1360): the
// governance GitHub App and the evidence store. A governed session start names a missing one in one
// line for the agent to pass on, so the owner hears about it without asking.
//
// - Governance App: missing (GitHub lists neither its variable nor its secret) or partly set up. A
//   missing App holds no governance action: programme records, gates, merges, the bank and this
//   computer's own refresh use the owner's own GitHub sign-in. Only the governance jobs on GitHub need
//   it (the cloud Programme Sweep and the Shard Timings pull request), and they do nothing without it.
// - Evidence store: the store the merged programme file names cannot be found, is not private, or
//   cannot be written with this computer's GitHub sign-in. Programme state lives there, so every
//   programme write refuses until it is usable; the line says so.
//
// GitHub is read at most once a day per repository (once an hour while anything was unreadable), in
// a background process this file starts, so a session start never waits on the network; the line
// reads the last result. GitHub that could not be read is unknown and says nothing, never missing.
// The governance bank's own reads update the same result (record). The file holds repository ids,
// names, states and times only. Offline and test runs start nothing unless deps.startCheck is given;
// any failure drops the lines.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { userStateDirectory } = require('./toolkit-user-state.cjs');

const SCHEMA = 'toolkit.governance-parts.v1';
const BASENAME = 'governance-parts.v1.json';
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 32;
const STORE_STATES = Object.freeze(['usable', 'missing', 'not-private', 'read-only', 'unverified']);
const APP_STATES = Object.freeze(['found', 'missing', 'unverified']);
// What is wrong with a store that cannot be used, as the session line and the bank's store row say it.
const STORE_WHY = Object.freeze({ missing: 'cannot be found with this computer\'s GitHub sign-in', 'not-private': 'is not private', 'read-only': 'cannot be written with this computer\'s GitHub sign-in' });

function fileOf(registryOptions = {}) { return path.join(userStateDirectory(registryOptions), BASENAME); }

function read(registryOptions) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileOf(registryOptions), 'utf8'));
    if (parsed && parsed.schema === SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories)) return parsed;
  } catch { /* none yet, or unreadable: start empty */ }
  return { schema: SCHEMA, repositories: {} };
}

function write(registryOptions, value) {
  const file = fileOf(registryOptions);
  const at = entry => String(entry.checked_at || entry.started_at || '');
  const entries = Object.entries(value.repositories).sort((a, b) => at(b[1]).localeCompare(at(a[1]))).slice(0, MAX_ENTRIES);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, `${JSON.stringify({ schema: SCHEMA, repositories: Object.fromEntries(entries) }, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}

function update(registryOptions, repositoryId, change) {
  const value = read(registryOptions);
  const next = change(value.repositories[repositoryId] || null);
  if (next) value.repositories[repositoryId] = next; else delete value.repositories[repositoryId];
  write(registryOptions, value);
  return next;
}

// What GitHub says about the store: { state } of STORE_STATES, with the reason when unverified. A 404
// is "missing": the store does not exist, or this computer's sign-in cannot see it; either way it
// cannot be used from here.
function storeState(store, { reader = require('./toolkit-governance-app.cjs').ghReader } = {}) {
  if (typeof store !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(store)) return { state: 'unverified', reason: 'no store named' };
  let got;
  try { got = reader([`repos/${store}`]); } catch { got = { ok: false, reason: 'reader-failed' }; }
  if (!got || got.ok !== true) return got && got.reason === 'repository-not-visible' ? { state: 'missing' } : { state: 'unverified', reason: (got && got.reason) || 'no answer' };
  const repo = got.value || {};
  if (repo.private !== true) return repo.private === false ? { state: 'not-private' } : { state: 'unverified', reason: 'no visibility in the answer' };
  if (!repo.permissions || typeof repo.permissions.push !== 'boolean') return { state: 'unverified', reason: 'no permissions in the answer' };
  return repo.permissions.push ? { state: 'usable' } : { state: 'read-only' };
}

// Keeps only the known shape, so nothing else read from GitHub is ever saved.
function cleanApp(app) {
  if (!app || !APP_STATES.includes(app.variable) || !APP_STATES.includes(app.secret)) return null;
  return { variable: app.variable, secret: app.secret, ...(app.reason ? { reason: String(app.reason).slice(0, 60) } : {}) };
}
function cleanStore(repository, store) {
  if (!store || !STORE_STATES.includes(store.state) || typeof repository !== 'string') return null;
  return { repository, state: store.state, ...(store.reason ? { reason: String(store.reason).slice(0, 60) } : {}) };
}

// Saves a result: from the background check, or from the governance bank's own reads.
function record(registryOptions, repositoryId, { app = null, store = null, storeRepository = null } = {}, { now = new Date() } = {}) {
  if (typeof repositoryId !== 'string' || !repositoryId) return null;
  const saved = { app: cleanApp(app), store: cleanStore(storeRepository, store) };
  if (!saved.app && !saved.store) return null;
  return update(registryOptions, repositoryId, entry => ({ ...(entry || {}), ...Object.fromEntries(Object.entries(saved).filter(([, value]) => value)), checked_at: now.toISOString() }));
}

// The background check: reads both parts for the repository checked out at `root` and saves them.
function check(root, { registryOptions = {}, reader, now = new Date() } = {}) {
  const governance = require('./toolkit-governance-state.cjs');
  const state = governance.governanceState(root, registryOptions);
  if (state.state !== 'ENABLED' || !state.repository_id || !state.repository) return null;
  const storeRepository = governance.bindingStoreRepository(state.root, registryOptions);
  const app = require('./toolkit-governance-app.cjs').presence(state.repository, reader ? { reader } : {});
  const store = storeRepository ? storeState(storeRepository, reader ? { reader } : {}) : null;
  return record(registryOptions, state.repository_id, { app, store, storeRepository }, { now });
}

function startCheck(root) {
  const child = spawn(process.execPath, [__filename, 'check'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

const unknown = app => app.variable === 'unverified' || app.secret === 'unverified';

// The last saved state of `store` for the governance bank's store row: { state, checked_at }, or null
// when none is saved for that store. Local read only.
function savedStore(registryOptions, repositoryId, store) {
  try {
    const entry = read(registryOptions).repositories[repositoryId];
    const kept = entry && cleanStore(entry.store?.repository, entry.store);
    return kept && kept.repository === store ? { state: kept.state, checked_at: entry.checked_at || null } : null;
  } catch { return null; }
}

// The session-start lines for an ENABLED repository: the last result, then a background check when it
// is due. `store` is the store the merged programme file names now; a result for another store is
// not shown and is checked again.
function sessionLines(state, registryOptions = {}, deps = {}) {
  try {
    if (state?.state !== 'ENABLED' || state.programme_records_bind !== true || !state.repository_id || !state.root) return [];
    const now = deps.now ? new Date(deps.now()) : new Date();
    const store = deps.store !== undefined ? deps.store : require('./toolkit-governance-state.cjs').bindingStoreRepository(state.root, registryOptions);
    const entry = read(registryOptions).repositories[state.repository_id] || null;
    const lines = [];
    const app = entry && cleanApp(entry.app);
    const slug = state.repository || 'this repository';
    if (app && !unknown(app) && app.variable === 'missing' && app.secret === 'missing') {
      lines.push(`Toolkit governance: the Governance App is not set up on ${slug} (GitHub lists neither its variable nor its secret), so the governance jobs on GitHub (the cloud sweep and the shard refresh) do nothing; everything else, this computer's own refresh included, still works. In your first reply, tell the user once, in one line, that saying \`refresh governance\` gives the one line that sets it up; nothing waits on it.`);
    } else if (app && !unknown(app) && (app.variable === 'missing' || app.secret === 'missing')) {
      lines.push(`Toolkit governance: the Governance App is only partly set up on ${slug} (variable ${app.variable}, secret ${app.secret}), so the governance jobs on GitHub (the cloud sweep and the shard refresh) do nothing. In your first reply, tell the user once, in one line, that saying \`refresh governance\` shows how to finish it; nothing waits on it.`);
    }
    const kept = entry && entry.store && entry.store.repository === store ? entry.store : null;
    const why = STORE_WHY[kept?.state];
    if (why) {
      lines.push(`Toolkit governance: the evidence store ${store} named in the programme file ${why}, so programme records and evidence cannot be saved and every governance step that writes them stops until it is fixed. In your first reply, tell the user once, in one line, what is wrong and that saying \`change store\` sets up a store with the controller.`);
    }
    const checkedAt = Date.parse(entry?.checked_at || '');
    const unread = !app || unknown(app) || (store && (!kept || kept.state === 'unverified'));
    // A result for a store the programme file no longer names is checked again at once.
    const moved = Boolean(store && entry?.store && entry.store.repository !== store);
    const due = moved || !Number.isFinite(checkedAt) || now.getTime() - checkedAt >= (unread ? RETRY_MS : FRESH_MS);
    const offline = (deps.environment || process.env).TOOLKIT_GOVERNANCE_OFFLINE === '1' || registryOptions.testOnly === true;
    if (due && (deps.startCheck || !offline)) {
      // Claimed here, so sessions starting together start one check.
      let claimed = false;
      update(registryOptions, state.repository_id, current => {
        const started = Date.parse(current?.started_at || '');
        if (Number.isFinite(started) && now.getTime() - started < RETRY_MS) return current;
        claimed = true;
        return { ...(current || {}), started_at: now.toISOString() };
      });
      if (claimed) (deps.startCheck || startCheck)(state.root);
    }
    return lines;
  } catch { return []; }
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] !== 'check' || argv.length !== 1) return 2;
  try { check(process.cwd()); } catch { /* the next due session start tries again */ }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ SCHEMA, BASENAME, FRESH_MS, RETRY_MS, STORE_WHY, check, record, savedStore, sessionLines, startCheck, storeState });
