'use strict';

// The post-merge finish of a governance turn-on. Some settings can only follow the merge: the
// default-branch protection ruleset (its required checks come from the merged binding), the
// no-force-push ruleset, the free dependency and security settings and, where the turn-on added the
// personal data guard, one report-only sweep of what was already there (toolkit-governance-first-sweep.cjs). When the governance bank
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
const SWEEP_SCRIPT = path.join(__dirname, 'toolkit-governance-first-sweep.cjs');
const SWEEP_OWED_MS = 3 * 24 * 60 * 60 * 1000;
const SWEEP_LAPSED = 'First personal data sweep: its result could not be read here within three days; on GitHub, open Actions and choose Personal data sweep to see its list.';
// What the finish turns on, as the bank's end lines and the session line say it.
const WHAT = 'default-branch protection (pull requests only, the required checks, merge commits only, nobody can bypass it), a ruleset that blocks force pushes, a ruleset that keeps the programme state branch where programme state lives there, the free dependency and security settings, and, where it adds the personal data guard, one report-only sweep of what is already there (files, commit messages, pull request text and comments), which changes and posts nothing (on a public repository anyone can read its list)';

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

// Noted when the bank publishes a turn-on pull request. `firstSweep` is whether that pull request adds
// the personal data guard; null (the publish did not say) keeps what an earlier note says.
function markPending(registryOptions, repositoryId, { proposal = null, firstSweep = null, now = new Date() } = {}) {
  if (typeof repositoryId !== 'string' || !repositoryId) return null;
  return update(registryOptions, repositoryId, entry => ({ status: 'pending', proposal, first_sweep: firstSweep === null ? entry?.first_sweep === true : firstSweep === true, at: now.toISOString(), started_at: null, line: null }));
}

function entryFor(registryOptions, repositoryId) { return read(registryOptions).repositories[repositoryId] || null; }

function listed(items) { return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || ''; }

// The finish result, built from what actually happened (GovernanceMaintenance.finish):
// { result: 'done' | 'failed', reason, on, unavailable, held: [{ name, step }], reports, files }.
// 'done' is final and shown once by the next session, then dropped; 'failed' (something to retry)
// stays pending. `files` are security files the finish wrote into this working tree, which still
// need a pull request.
// What the owner reads about one weakness filed as the controller's task
// (toolkit-governance-weakness.cjs): filed, already open, filed but not linked, or not filed and why.
function filedWords(task) {
  if (!task) return '';
  if (task.state === 'filed') return ` Filed as #${task.number} under #${task.parent}.`;
  if (task.state === 'open') return ` Already filed as #${task.number}, still open.`;
  if (task.state === 'unlinked') return ` Filed as #${task.number}, but it could not be linked under #${task.parent} (${task.why}); your controller links it.`;
  return ` Not filed as a task (${task.why}); your controller files it.`;
}

// A change to the repository's own workflow files, handed to its controller as one line: a detail
// line, or { note, task } after a settings fix or this finish. Kept here, where the session-start
// hooks already load it, so the summary and this result say it the same way without the hooks
// loading the summary.
function controllerLine(item) {
  const note = typeof item === 'string' ? item : item.note;
  return `Your controller fixes this in a pull request: ${String(note).replace(/\.$/, '')}.${typeof item === 'string' ? '' : filedWords(item.task)}`;
}

// `controller` ([{ note, task }]) are problems in the repository's own workflow files, for its
// controller to fix in a pull request and filed as its task, never a by-hand step for the owner.
function resultLine(outcome) {
  const on = outcome.on || [], unavailable = outcome.unavailable || [], held = outcome.held || [], files = outcome.files || [];
  const controller = outcome.controller || [];
  const parts = [outcome.result === 'done'
    ? `Toolkit: governance setup finished here${held.length || controller.length || files.length ? ', apart from what is left below' : ''}.`
    : `Toolkit: governance setup could not finish here yet (${outcome.reason || 'GitHub could not be written'}); it is tried again in a later session.`];
  if (on.length) parts.push(`On and read back: ${listed(on)}.`);
  if (unavailable.length) parts.push(`Not set: GitHub cannot enforce ${listed(unavailable)} on a private repository on GitHub Free, so nothing was written for ${unavailable.length > 1 ? 'them' : 'it'}; the local guards stay the fallback.`);
  parts.push(...controller.map(controllerLine));
  if (files.length) parts.push(`Your controller commits ${files.join(', ')} through a pull request: Toolkit wrote ${files.length > 1 ? 'them' : 'it'} in this working tree.`);
  for (const entry of held) parts.push(`Waiting for you, ${entry.name}: ${entry.step}`);
  return parts.join(' ');
}

// `outcome.sweep_owed` ({ run }: the first sweep was still going when the finish ended) keeps the
// sweep's result owed to a later session (sessionLines, recordSweep).
function record(registryOptions, repositoryId, outcome, { now = new Date() } = {}) {
  const owed = outcome.result === 'done' && outcome.sweep_owed ? { run: Number.isSafeInteger(outcome.sweep_owed.run) ? outcome.sweep_owed.run : null } : null;
  // The part names alone (no steps or reasons), for the governance summary's rows (toolkit-governance-summary.cjs).
  const names = list => (Array.isArray(list) ? list : []).map(item => (typeof item === 'string' ? item : item && item.name)).filter(name => typeof name === 'string' && name).map(name => name.slice(0, 120));
  return update(registryOptions, repositoryId, entry => entry && ({
    ...entry, status: outcome.result === 'done' ? 'done' : 'pending', finished_at: now.toISOString(), line: resultLine(outcome),
    parts: { on: names(outcome.on), unavailable: names(outcome.unavailable), held: names(outcome.held) },
    notes: (outcome.reports || []).filter(note => typeof note === 'string' && note).map(note => note.slice(0, 600)), sweep_owed: owed, sweep_line: null,
  }));
}

// The owed first sweep's result line, read by a background run (toolkit-governance-first-sweep.cjs
// owed); the next session start shows it once.
function recordSweep(registryOptions, repositoryId, line) {
  if (typeof line !== 'string' || !line) return null;
  return update(registryOptions, repositoryId, entry => (entry && entry.sweep_owed ? { ...entry, sweep_line: line.slice(0, 600) } : entry));
}

function startSweepRead(root) {
  const child = spawn(process.execPath, [SWEEP_SCRIPT, 'owed'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
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
    // A test clock may give a Date or its ISO text.
    const now = deps.now ? new Date(deps.now()) : new Date();
    const offline = (deps.environment || process.env).TOOLKIT_GOVERNANCE_OFFLINE === '1' || registryOptions.testOnly === true;
    // The first sweep was still going when the finish ended: its result, once read in the background,
    // is shown once; until then a read starts at most once per FINISH_GAP_MS.
    if (entry.status === 'sweep-owed') {
      if (typeof entry.sweep_line === 'string' && entry.sweep_line) { update(registryOptions, state.repository_id, () => null); return [entry.sweep_line]; }
      // A result still unread after SWEEP_OWED_MS is said once and dropped, never owed for ever.
      if (now.getTime() - Date.parse(entry.at || '') > SWEEP_OWED_MS) { update(registryOptions, state.repository_id, () => null); return [SWEEP_LAPSED]; }
      const last = Date.parse(entry.started_at || '');
      if ((deps.startSweepRead || !offline) && !(Number.isFinite(last) && now.getTime() - last < FINISH_GAP_MS)) {
        update(registryOptions, state.repository_id, current => (current ? { ...current, started_at: new Date(now).toISOString() } : current));
        (deps.startSweepRead || startSweepRead)(state.root);
      }
      return [];
    }
    const lines = [];
    if (entry.line) lines.push(entry.line);
    // The first sweep's report, its own line (the held block lists it apart).
    if (Array.isArray(entry.notes)) lines.push(...entry.notes.filter(note => typeof note === 'string' && note));
    if (entry.status === 'done') {
      update(registryOptions, state.repository_id, () => (entry.sweep_owed ? { ...entry, status: 'sweep-owed', line: null, notes: null, started_at: null, at: new Date(now).toISOString() } : null));
      return lines;
    }
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

module.exports = Object.freeze({ BASENAME, FINISH_GAP_MS, SCHEMA, WHAT, claim, controllerLine, filedWords, clear, entryFor, markPending, record, recordSweep, sessionLines, startFinish, touch });
