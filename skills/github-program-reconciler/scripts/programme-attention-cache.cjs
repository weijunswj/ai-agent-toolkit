'use strict';

// This computer's copy of what the Claude Code turn-end owed check (repo/scripts/toolkit-owed-check-hook.cjs)
// lists, so it needs no git, gh or network call. It lives in Toolkit's own user-state, never the
// repository, and holds no free text:
// - a repository's open net findings: each one's ID, code, task, kind, state and times. `programme.cjs
//   refresh` and `programme.cjs attention` write it after reading the parent document.
// - the gate sessions `programme.cjs gate-session` recorded from this computer, one file per
//   assignment: the host sessions by hash and whether the close is recorded. Only an accepted result
//   is written, so a refused command leaves nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CACHE_SCHEMA = 'toolkit.programme-attention-cache.v2';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// A cache older than this is refreshed in the background by the turn-end check.
const STALE_MS = 60 * 60 * 1000;
// At most this many open net findings are kept.
const NET_LIMIT = 200;

function cacheDir(deps = {}) {
  return deps.attentionDir || path.join(deps.home || os.homedir(), '.ai-agent-toolkit', 'user-state', 'programme-attention');
}

function cacheFile(repository, deps = {}) {
  if (!REPO.test(String(repository || ''))) return null;
  const [owner, name] = String(repository).toLowerCase().split('/');
  return path.join(cacheDir(deps), `${owner}--${name}.json`);
}

// The open net findings, when every entry is well formed, else null.
const ISO = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
function netOf(value) {
  if (!Array.isArray(value) || value.length > NET_LIMIT) return null;
  const out = [];
  for (const entry of value) {
    if (!entry || !/^[0-9a-f]{12}$/.test(String(entry.id)) || !/^[A-Z][A-Z_]{0,39}$/.test(String(entry.code))) return null;
    if (!(entry.issue === null || (Number.isInteger(entry.issue) && entry.issue > 0))) return null;
    if (!(entry.kind === null || /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(String(entry.kind)))) return null;
    if (!['new', 'acknowledged'].includes(entry.state) || !ISO(entry.changed_at) || !(entry.due === null || ISO(entry.due))) return null;
    out.push({ id: entry.id, code: entry.code, issue: entry.issue, kind: entry.kind, state: entry.state, changed_at: entry.changed_at, due: entry.due });
  }
  return out;
}

// The cache, or null when there is none, it cannot be read or an earlier Toolkit wrote it.
function readCache(repository, deps = {}) {
  const file = cacheFile(repository, deps);
  if (!file) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || value.schema !== CACHE_SCHEMA || String(value.repository).toLowerCase() !== String(repository).toLowerCase() || !ISO(value.as_of)) return null;
    const net = netOf(value.net);
    return net ? { ...value, net } : null;
  } catch { return null; }
}

function writeAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Records what a run on this computer read: { complete, net }. Never throws: a cache that cannot be
// written (or a malformed list) only means the turn-end check says it could not check the findings.
function writeCache(repository, { complete, net }, deps = {}) {
  const file = cacheFile(repository, deps);
  const kept = netOf(net);
  if (!file || !kept) return false;
  try {
    writeAtomically(file, { schema: CACHE_SCHEMA, repository: String(repository).toLowerCase(), as_of: (deps.now || (() => new Date().toISOString()))(), complete: complete !== false, net: kept });
    return true;
  } catch { return false; }
}

function ageText(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

// Background refreshes are at most one per START_GAP_MS per repository on this computer, so a refresh
// that keeps failing (no holder, gh signed out) is not started at every turn end.
const START_GAP_MS = 15 * 60 * 1000;
const startFile = (repository, deps) => { const file = cacheFile(repository, deps); return file ? `${file}.started` : null; };

// Records a start and returns true when the last one is older than START_GAP_MS (or there is none).
function claimBackgroundStart(repository, deps = {}) {
  const file = startFile(repository, deps);
  if (!file) return false;
  const nowMs = Date.parse((deps.now || (() => new Date().toISOString()))());
  try {
    const last = Date.parse(fs.readFileSync(file, 'utf8').trim());
    if (Number.isFinite(last) && nowMs - last >= 0 && nowMs - last < START_GAP_MS) return false;
  } catch { /* no start yet */ }
  // A start that cannot be recorded (a folder or a locked file at that path) is still allowed: only the
  // throttle is lost, never the refresh.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${new Date(nowMs).toISOString()}\n`, { mode: 0o600 });
  } catch { /* unthrottled */ }
  return true;
}

// ---- gate sessions ----

const GATE_SCHEMA = 'toolkit.programme-gate-session.v1';
const ASSIGNMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
// The check looks back a day for launches and a week for closes; older records go with the next write.
const GATE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
// Earlier sessions of one assignment (a replaced one) kept beside the current one.
const GATE_SESSIONS_KEPT = 10;

const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
const gateSessionHash = session => sha(String(session));
const gateFiles = folder => fs.readdirSync(folder).filter(name => /^[0-9a-f]{32}\.json$/.test(name));
const gateFolder = (repository, deps) => { const file = cacheFile(repository, deps); return file ? file.replace(/\.json$/, '.gates') : null; };

// A whole, well-formed record, or null.
function gateRecordOf(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || value.schema !== GATE_SCHEMA || !Number.isInteger(value.issue) || value.issue < 1 || !ASSIGNMENT.test(String(value.assignment)) || typeof value.closed !== 'boolean' || !ISO(value.at)
    || !Array.isArray(value.sessions) || value.sessions.length > GATE_SESSIONS_KEPT || value.sessions.some(hash => !/^[0-9a-f]{32}$/.test(String(hash)))) return null;
  return { issue: value.issue, assignment: value.assignment, sessions: value.sessions, closed: value.closed, at: value.at };
}

// Keeps one accepted gate-session result: the assignment's host session (null when the host gave none)
// and whether its close is recorded. Two commands at once write different files unless they name one
// assignment. Never throws: a record that cannot be kept only means the check may list it.
function writeGateSession(repository, { issue, assignment, session = null, closed = false }, deps = {}) {
  const folder = gateFolder(repository, deps);
  if (!folder || !Number.isInteger(issue) || issue < 1 || !ASSIGNMENT.test(String(assignment))) return false;
  const file = path.join(folder, `${sha(`${issue}:${assignment}`)}.json`);
  const at = (deps.now || (() => new Date().toISOString()))();
  try {
    let before = null;
    try { before = gateRecordOf(fs.readFileSync(file, 'utf8')); } catch { /* the first record */ }
    const own = session ? gateSessionHash(session) : null;
    const sessions = [...(before ? before.sessions : []).filter(hash => hash !== own), ...(own ? [own] : [])].slice(-GATE_SESSIONS_KEPT);
    writeAtomically(file, { schema: GATE_SCHEMA, issue, assignment, sessions, closed: closed === true, at });
    for (const name of gateFiles(folder)) {
      const other = path.join(folder, name);
      try { if (Date.parse(gateRecordOf(fs.readFileSync(other, 'utf8')).at) < Date.parse(at) - GATE_KEEP_MS) fs.rmSync(other); } catch { /* not a whole record, or the next write tries again */ }
    }
    return true;
  } catch { return false; }
}

// The gate sessions recorded from this computer ({ issue, assignment, sessions, closed, at }; the last hash
// in `sessions` is the current session), [] when none was, or null when the folder cannot be read. A
// file that is not a whole record is left out.
function readGateSessions(repository, deps = {}) {
  const folder = gateFolder(repository, deps);
  if (!folder) return null;
  let names;
  try { names = gateFiles(folder); } catch (error) { return error.code === 'ENOENT' ? [] : null; }
  const records = [];
  for (const name of names) {
    try { const record = gateRecordOf(fs.readFileSync(path.join(folder, name), 'utf8')); if (record) records.push(record); } catch { /* left out */ }
  }
  return records;
}

module.exports = Object.freeze({ CACHE_SCHEMA, NET_LIMIT, STALE_MS, START_GAP_MS, GATE_KEEP_MS, netOf, cacheDir, cacheFile, readCache, writeCache, claimBackgroundStart, ageText, gateSessionHash, readGateSessions, writeGateSession });
