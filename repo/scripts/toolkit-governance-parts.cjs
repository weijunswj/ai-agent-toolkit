'use strict';

// Two required parts of a governed repository that Toolkit checks itself (INT-TK421-1360): the
// governance GitHub App and the evidence store. A governed session start names a missing one in one
// line for the agent to pass on, so the owner hears about it without asking.
//
// - Governance App: missing (GitHub lists neither its variable nor its secret) or partly set up. The
//   governance jobs on GitHub (such as the cloud Programme Sweep) do nothing without it.
// - Evidence store: the store the merged programme file names cannot be found, is not private, or
//   cannot be written with this computer's GitHub sign-in. Programme state lives there, so every
//   programme write refuses until it is usable; the line says so.
// Where the readiness hold applies (toolkit-governance-ready.cjs reads these saved results), either one
// missing holds programme records, gate records and task auto-merge, and the session start names it
// in its held block instead of these lines (deps.partsInBlock); elsewhere the lines stay warnings.
// - Repository settings (INT-TK421-1378): the settings governance needs, read as the governance check
//   reads them (toolkit-governance-conformance.cjs settingsReads): the no-force-push ruleset, the
//   default branch's required checks, merge methods and up-to-date rule, and the dependency and
//   security settings. Drift gets one line naming what drifted and the exact step, which the owner
//   says yes to once; agents never change them unasked. A setting that could not be read says nothing.
//
// GitHub is read at most once a day per repository, in a background process this file starts, so a
// session start never waits on the network; the line reads the last result. While a part was missing,
// unusable or unreadable it is read again after an hour, so a fix made on GitHub ends its line within
// the hour, and the governance bank saves its own reads (recordRead), so a fix the owner then sees in
// the bank ends it at once. GitHub that could not be read is unknown and says nothing, never missing.
// The file holds repository ids, names, states and times only. Offline and test runs start nothing
// unless deps.startCheck is given; any failure drops the lines.

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
// Its one fix, the same in the session line and the bank's store row.
const ANOTHER = 'or say change store and the controller sets up another with you';
const STORE_STEP = Object.freeze({ missing: `sign in to GitHub on this computer with an account that can see it, ${ANOTHER}`,
  'not-private': `make it private again on GitHub, ${ANOTHER}`, 'read-only': `give this computer's GitHub account write access to it, ${ANOTHER}` });
// The settings drift the line names, by the governance check's finding id: what drifted, and which
// step fixes it. Only these ids are saved.
const SETTINGS = Object.freeze({
  RULESET_NO_FORCE_PUSH_MISSING: ['no ruleset blocks force pushes', 'migrate'],
  PROTECTION_CHECKS_MISMATCH: ['the required checks differ from the programme file', 'migrate'],
  PROTECTION_CHECK_UNPINNED: ['a required check is not pinned to an app', 'migrate'],
  PROTECTION_MERGE_METHODS: ['merge methods other than merge commits are allowed', 'migrate'],
  PROTECTION_UP_TO_DATE: ['branches need not be up to date before merging', 'migrate'],
  SECURITY_DEPENDABOT_ALERTS: ['Dependabot alerts are off', 'security'],
  SECURITY_DEPENDABOT_UPDATES: ['Dependabot security updates are off', 'security'],
  SECURITY_VERSION_UPDATES: ['Dependabot version updates miss a package ecosystem', 'security'],
  SECURITY_SECRET_SCANNING: ['secret scanning or push protection is off', 'security'],
  SECURITY_CODE_SCANNING: ['CodeQL code scanning is not set up', 'security'],
  SECURITY_PRIVATE_REPORTING: ['private vulnerability reporting is off', 'security'],
  SECURITY_AUTO_MERGE: ['Dependabot auto-merge is not fully set up', 'security'],
});
const SETTINGS_STEP = Object.freeze({
  migrate: 'refresh governance shows the drift and asks one question, and the owner\'s yes there fixes it (the agent runs it, and the owner runs no command)',
  security: 'the agent runs `toolkit governance security` (it names anything it cannot change itself, such as a missing Dependabot entry for a pull request)',
});

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

// A change that returns the entry it was given writes nothing, so a session start that claims no check
// never overwrites a result saved meanwhile.
function update(registryOptions, repositoryId, change) {
  const value = read(registryOptions);
  const current = value.repositories[repositoryId] || null;
  const next = change(current);
  if (next === current) return current;
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

const unknown = app => app.variable === 'unverified' || app.secret === 'unverified';

// Keeps only the known shape, so nothing else read from GitHub is ever saved.
function cleanApp(app) {
  if (!app || !APP_STATES.includes(app.variable) || !APP_STATES.includes(app.secret)) return null;
  return { variable: app.variable, secret: app.secret, ...(app.reason ? { reason: String(app.reason).slice(0, 60) } : {}) };
}
function cleanStore(repository, store) {
  if (!store || !STORE_STATES.includes(store.state) || typeof repository !== 'string') return null;
  return { repository, state: store.state, ...(store.reason ? { reason: String(store.reason).slice(0, 60) } : {}) };
}
// { drift: [known ids], unread } from the settings findings (or a saved entry); null when there are none.
function cleanSettings(settings) {
  if (!settings) return null;
  const findings = Array.isArray(settings) ? settings : null;
  const drift = findings ? findings.filter(item => item && item.severity === 'drift' && SETTINGS[item.id]).map(item => item.id)
    : Array.isArray(settings.drift) ? settings.drift.filter(id => typeof id === 'string' && SETTINGS[id]) : null;
  if (!drift) return null;
  return { drift: [...new Set(drift)], unread: findings ? findings.some(item => item && item.severity === 'unverified') : settings.unread === true };
}

// Saves a result of the background check, unread parts included (they are read again after an hour).
// `settings` is the governance check's settings findings.
function record(registryOptions, repositoryId, { app = null, store = null, storeRepository = null, settings = null } = {}, { now = new Date() } = {}) {
  if (typeof repositoryId !== 'string' || !repositoryId) return null;
  const saved = { app: cleanApp(app), store: cleanStore(storeRepository, store), settings: cleanSettings(settings) };
  if (!saved.app && !saved.store && !saved.settings) return null;
  return update(registryOptions, repositoryId, entry => ({ ...(entry || {}), ...Object.fromEntries(Object.entries(saved).filter(([, value]) => value)), checked_at: now.toISOString() }));
}

// The background check: reads the parts and the settings for the repository checked out at `root` and
// saves them. `settings(state)` gives the settings findings (by default read from GitHub as the
// governance check reads them).
function check(root, { registryOptions = {}, reader, now = new Date(), settings = state => require('./toolkit-governance-conformance.cjs').settingsReads(state, registryOptions).findings } = {}) {
  const governance = require('./toolkit-governance-state.cjs');
  const state = governance.governanceState(root, registryOptions);
  if (state.state !== 'ENABLED' || !state.repository_id || !state.repository) return null;
  const storeRepository = governance.bindingStoreRepository(state.root, registryOptions);
  const app = require('./toolkit-governance-app.cjs').presence(state.repository, reader ? { reader } : {});
  const store = storeRepository ? storeState(storeRepository, reader ? { reader } : {}) : null;
  let found = null;
  try { found = settings(state); } catch { found = null; }
  return record(registryOptions, state.repository_id, { app, store, storeRepository, settings: found }, { now });
}

// Saves the governance bank's own reads: only the parts GitHub answered, so a bank read that could not
// reach GitHub never clears a saved missing or unusable part.
function recordRead(registryOptions, repositoryId, { app = null, store = null, storeRepository = null } = {}, options = {}) {
  return record(registryOptions, repositoryId, { app: app && !unknown(app) ? app : null, store: store && store.state !== 'unverified' ? store : null, storeRepository }, options);
}

function startCheck(root) {
  const child = spawn(process.execPath, [__filename, 'check'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// The last saved state of `store` for the governance bank's store row: { state, checked_at }, or null
// when none is saved for that store. Local read only.
function savedStore(registryOptions, repositoryId, store) {
  try {
    const entry = read(registryOptions).repositories[repositoryId];
    const kept = entry && cleanStore(entry.store?.repository, entry.store);
    return kept && kept.repository === store ? { state: kept.state, checked_at: entry.checked_at || null } : null;
  } catch { return null; }
}

// The last saved App, store and settings results for the readiness check (toolkit-governance-ready.cjs)
// and the governance summary, each kept only in its known shape: { app, store, settings, checked_at },
// or null when none is saved. Local read only.
function saved(registryOptions, repositoryId) {
  try {
    if (typeof repositoryId !== 'string' || !repositoryId) return null;
    const repositories = read(registryOptions).repositories;
    const entry = Object.hasOwn(repositories, repositoryId) ? repositories[repositoryId] : null;
    if (!entry || typeof entry !== 'object') return null;
    return { app: cleanApp(entry.app), store: cleanStore(entry.store?.repository, entry.store), settings: cleanSettings(entry.settings), checked_at: typeof entry.checked_at === 'string' ? entry.checked_at : null };
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
    // While governance is held (toolkit-governance-ready.cjs), the App and store lines are in the held
    // block the session start leads with, so they are counted here but not given twice.
    let inBlock = 0;
    const partLine = line => { if (deps.partsInBlock === true) inBlock += 1; else lines.push(line); };
    const app = entry && cleanApp(entry.app);
    const slug = state.repository || 'this repository';
    if (app && !unknown(app) && app.variable === 'missing' && app.secret === 'missing') {
      partLine(`Toolkit governance: the Governance App is not set up on ${slug} (GitHub lists neither its variable nor its secret), so the governance jobs on GitHub (such as the cloud sweep) do nothing; everything else, this computer's own refresh included, still works. In your first reply, tell the user once, in one line, that saying \`refresh governance\` gives the one line that sets it up; nothing waits on it.`);
    } else if (app && !unknown(app) && (app.variable === 'missing' || app.secret === 'missing')) {
      partLine(`Toolkit governance: the Governance App is only partly set up on ${slug} (variable ${app.variable}, secret ${app.secret}), so the governance jobs on GitHub (such as the cloud sweep) do nothing. In your first reply, tell the user once, in one line, that saying \`refresh governance\` shows how to finish it; nothing waits on it.`);
    }
    const kept = entry && entry.store && entry.store.repository === store ? entry.store : null;
    const why = STORE_WHY[kept?.state];
    if (why) {
      partLine(`Toolkit governance: the evidence store ${store} named in the programme file ${why}, so programme records and evidence cannot be saved and every governance step that writes them stops until it is fixed. In your first reply, tell the user once, in one line, what is wrong and the fix: ${STORE_STEP[kept.state]}.`);
    }
    const settings = entry && cleanSettings(entry.settings);
    if (settings && settings.drift.length) {
      const steps = [...new Set(settings.drift.map(id => SETTINGS[id][1]))].map(step => SETTINGS_STEP[step]);
      lines.push(`Toolkit governance: ${slug}'s settings have drifted from what governance needs: ${settings.drift.map(id => SETTINGS[id][0]).join('; ')}. In your first reply, tell the user once, in one line, what drifted and that one yes from them fixes it: ${steps.join('; and ')}. Never change these settings without that yes; nothing waits on it.`);
    }
    const checkedAt = Date.parse(entry?.checked_at || '');
    const unread = !app || unknown(app) || (store && (!kept || kept.state === 'unverified'));
    // A missing or unusable part (it has a line) is read again after an hour too: the owner may be fixing it.
    const notReady = lines.length + inBlock > 0;
    // A result for a store the programme file no longer names is checked again at once.
    const moved = Boolean(store && entry?.store && entry.store.repository !== store);
    const due = moved || !Number.isFinite(checkedAt) || now.getTime() - checkedAt >= (unread || notReady ? RETRY_MS : FRESH_MS);
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

// Exports first: the readiness module and this file require each other through the state module.
module.exports = Object.freeze({ SCHEMA, BASENAME, STORE_STEP, STORE_WHY, check, record, recordRead, saved, savedStore, sessionLines, startCheck, storeState });

if (require.main === module) process.exitCode = main();
