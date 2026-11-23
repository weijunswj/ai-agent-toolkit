'use strict';

// This computer's copy of a repository's open net findings, so the Claude Code turn-end owed check
// (repo/scripts/toolkit-owed-check-hook.cjs) can list the findings due without any git, gh or network
// call. `programme.cjs refresh` and `programme.cjs attention` write it after reading the parent
// document. It lives in Toolkit's own user-state, never the repository, and holds no free text: each
// open net finding's ID, code, task, kind, state and times.

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

module.exports = Object.freeze({ CACHE_SCHEMA, NET_LIMIT, STALE_MS, START_GAP_MS, netOf, cacheDir, cacheFile, readCache, writeCache, claimBackgroundStart, ageText });
