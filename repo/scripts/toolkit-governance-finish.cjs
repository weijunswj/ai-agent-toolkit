'use strict';

// The post-merge finish of a governance turn-on. Some settings can only follow the merge: the
// default-branch protection ruleset (its required checks come from the merged binding), the
// no-force-push ruleset and the free dependency and security settings. When the governance bank
// publishes a turn-on pull request it notes the repository here as finish pending. Once that binding
// is merged and read back, the session-start line starts the finish once in the background
// (`toolkit-governance.cjs finish`, which asks nothing: the owner's yes in the bank covers these
// settings and the bank listed them) and a later session shows its result in one line. Each setting
// ends as on (read back), not enforceable here (GitHub Free private repositories), held for an owner
// step Toolkit cannot take itself, or retry. Only retry keeps the finish pending, tried again at most
// once per FINISH_GAP_MS; the others are final and the result names each one.
//
// The file holds only repository ids, proposal numbers, times and result lines, never a token.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { userStateDirectory } = require('./toolkit-user-state.cjs');

const SCHEMA = 'toolkit.governance-finish.v1';
const BASENAME = 'governance-finish.v1.json';
const FINISH_GAP_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 32;
const SCRIPT = path.join(__dirname, 'toolkit-governance.cjs');
// What the finish turns on, as the bank's end lines and the session line say it.
const WHAT = 'default-branch protection (pull requests only, the required checks, merge commits only, nobody can bypass it), a ruleset that blocks force pushes, a ruleset that keeps the programme state branch where programme state lives there, and the free dependency and security settings';

function fileOf(registryOptions = {}) { return path.join(userStateDirectory(registryOptions), BASENAME); }

function read(registryOptions) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileOf(registryOptions), 'utf8'));
    if (parsed && parsed.schema === SCHEMA && parsed.repositories && typeof parsed.repositories === 'object') return parsed;
  } catch { /* none yet, or unreadable: start empty */ }
  return { schema: SCHEMA, repositories: {} };
}

function write(registryOptions, value) {
  const file = fileOf(registryOptions);
  const entries = Object.entries(value.repositories).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_ENTRIES);
  const text = `${JSON.stringify({ schema: SCHEMA, repositories: Object.fromEntries(entries) }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, text, { mode: 0o600 }); fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
}

function update(registryOptions, repositoryId, change) {
  const value = read(registryOptions);
  const next = change(value.repositories[repositoryId] || null);
  if (next) value.repositories[repositoryId] = next; else delete value.repositories[repositoryId];
  write(registryOptions, value);
  return next;
}

// Noted when the bank publishes a turn-on pull request.
function markPending(registryOptions, repositoryId, { proposal = null, now = new Date() } = {}) {
  if (typeof repositoryId !== 'string' || !repositoryId) return null;
  return update(registryOptions, repositoryId, () => ({ status: 'pending', proposal, at: now.toISOString(), started_at: null, line: null }));
}

function entryFor(registryOptions, repositoryId) { return read(registryOptions).repositories[repositoryId] || null; }

function listed(items) { return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || ''; }

// The finish result, built from what actually happened (GovernanceMaintenance.finish):
// { result: 'done' | 'failed', reason, on, unavailable, held: [{ name, step }], files }.
// 'done' is final and shown once by the next session, then dropped; 'failed' (something to retry)
// stays pending. `files` are security files the finish wrote into this working tree, which still
// need a pull request.
function resultLine(outcome) {
  const on = outcome.on || [], unavailable = outcome.unavailable || [], held = outcome.held || [], files = outcome.files || [];
  const parts = [outcome.result === 'done'
    ? `Toolkit: governance setup finished here${held.length ? ', apart from what waits for you below' : ''}.`
    : `Toolkit: governance setup could not finish here yet (${outcome.reason || 'GitHub could not be written'}); it is tried again in a later session.`];
  if (on.length) parts.push(`On and read back: ${listed(on)}.`);
  if (unavailable.length) parts.push(`Not set: GitHub cannot enforce ${listed(unavailable)} on a private repository on GitHub Free, so nothing was written for ${unavailable.length > 1 ? 'them' : 'it'}; the local guards stay the fallback.`);
  for (const entry of held) parts.push(`Waiting for you, ${entry.name}: ${entry.step}`);
  if (files.length) parts.push(`It also wrote ${files.join(', ')} in this working tree; commit ${files.length > 1 ? 'them' : 'it'} through a pull request.`);
  return parts.join(' ');
}

function record(registryOptions, repositoryId, outcome, { now = new Date() } = {}) {
  return update(registryOptions, repositoryId, entry => entry && ({
    ...entry, status: outcome.result === 'done' ? 'done' : 'pending', finished_at: now.toISOString(), line: resultLine(outcome),
  }));
}

// A run that ended without a result to record (not merged yet, or another run held the lock) still
// notes when it ended, so the next session does not report it as a run that died.
function touch(registryOptions, repositoryId, { now = new Date() } = {}) {
  return update(registryOptions, repositoryId, entry => entry && ({ ...entry, finished_at: now.toISOString() }));
}

// Drops the finish mark without a result: its turn-on pull request closed without merging.
function clear(registryOptions, repositoryId) {
  return update(registryOptions, repositoryId, () => null);
}

// One finish at a time per repository on this computer: two sessions starting together start it
// once. A lock older than FINISH_GAP_MS is from a finish that died and is taken over.
function claim(registryOptions, repositoryId, { now = new Date() } = {}) {
  const file = path.join(userStateDirectory(registryOptions), `governance-finish.${crypto.createHash('sha256').update(String(repositoryId)).digest('hex').slice(0, 16)}.lock`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const age = now.getTime() - fs.statSync(file).mtimeMs;
    if (age < FINISH_GAP_MS) return null;
    fs.rmSync(file, { force: true });
  } catch { /* no lock yet */ }
  try { fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); } catch { return null; }
  return { release: () => fs.rmSync(file, { force: true }) };
}

function startFinish(root) {
  const child = spawn(process.execPath, [SCRIPT, 'finish'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// The session-start lines for an ENABLED repository whose binding is freshly read: the last result
// once, then a background start while the finish is pending (at most once per FINISH_GAP_MS).
// Offline and test runs start nothing unless deps.startFinish is given. Any failure drops the lines.
function sessionLines(state, registryOptions = {}, deps = {}) {
  try {
    if (state?.state !== 'ENABLED' || state.programme_records_bind !== true || !state.repository_id) return [];
    const entry = entryFor(registryOptions, state.repository_id);
    if (!entry) return [];
    const now = deps.now ? deps.now() : new Date();
    const lines = [];
    if (entry.line) lines.push(entry.line);
    if (entry.status === 'done') { update(registryOptions, state.repository_id, () => null); return lines; }
    const offline = (deps.environment || process.env).TOOLKIT_GOVERNANCE_OFFLINE === '1' || registryOptions.testOnly === true;
    const last = Date.parse(entry.started_at || '');
    if ((deps.startFinish || !offline) && !(Number.isFinite(last) && now.getTime() - last < FINISH_GAP_MS)) {
      // A start with no result since then died before it could record one.
      const silent = Number.isFinite(last) && !(Date.parse(entry.finished_at || '') >= last);
      // Claimed here, so a second session starting at the same moment does not start it again.
      let claimed = null;
      update(registryOptions, state.repository_id, current => {
        if (!current) return current;
        const seen = Date.parse(current.started_at || '');
        if (Number.isFinite(seen) && now.getTime() - seen < FINISH_GAP_MS) return current;
        claimed = now.toISOString();
        return { ...current, started_at: claimed };
      });
      if (!claimed) return lines;
      (deps.startFinish || startFinish)(state.root);
      if (silent) lines.push('Toolkit: the last governance setup run here stopped without a result, so it was started again.');
      lines.push(`Toolkit: the governance turn-on is merged, so Toolkit is finishing its setup in the background: ${WHAT}. A later session here shows the result.`);
    }
    return lines;
  } catch { return []; }
}

module.exports = Object.freeze({ BASENAME, FINISH_GAP_MS, SCHEMA, WHAT, claim, clear, entryFor, markPending, record, sessionLines, startFinish, touch });
