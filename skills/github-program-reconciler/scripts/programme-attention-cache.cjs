'use strict';

// This computer's copy of a repository's attention line, so session start can show it without any
// git, gh or network call. `programme.cjs refresh` and `programme.cjs attention` write it after
// reading the parent document; the session-start line reads it and records which set it last
// showed. It lives in Toolkit's own user-state, never the repository, and holds no free text: the
// line, the counts, a digest of the open findings and the longest-stalled work-queue task (its
// number, code, when it was flagged and the Toolkit's fixed next step for that code).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CACHE_SCHEMA = 'toolkit.programme-attention-cache.v1';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// A cache older than this is shown with its age, and session start starts a background refresh.
const STALE_MS = 60 * 60 * 1000;

function cacheDir(deps = {}) {
  return deps.attentionDir || path.join(deps.home || os.homedir(), '.ai-agent-toolkit', 'user-state', 'programme-attention');
}

function cacheFile(repository, deps = {}) {
  if (!REPO.test(String(repository || ''))) return null;
  const [owner, name] = String(repository).toLowerCase().split('/');
  return path.join(cacheDir(deps), `${owner}--${name}.json`);
}

function readCache(repository, deps = {}) {
  const file = cacheFile(repository, deps);
  if (!file) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || value.schema !== CACHE_SCHEMA || String(value.repository).toLowerCase() !== String(repository).toLowerCase()) return null;
    if (typeof value.line !== 'string' || !/^Attention: /.test(value.line) || Number.isNaN(Date.parse(value.as_of))) return null;
    return value;
  } catch { return null; }
}

function writeAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Records what a run on this computer read: { line, counts, digest, complete, queue }. Keeps the digest
// last shown at session start. Never throws: a cache that cannot be written only means session start
// says it has not checked yet.
function writeCache(repository, { line, counts, digest, complete, queue = null }, deps = {}) {
  const file = cacheFile(repository, deps);
  if (!file) return false;
  const previous = readCache(repository, deps);
  try {
    writeAtomically(file, {
      schema: CACHE_SCHEMA, repository: String(repository).toLowerCase(),
      as_of: (deps.now || (() => new Date().toISOString()))(), complete: complete !== false, counts, line, digest, queue: queueOf(queue),
      shown_digest: previous ? previous.shown_digest || null : null,
    });
    return true;
  } catch { return false; }
}

// The cached work-queue summary when it is well formed, else null (an older cache has none).
function queueOf(value) {
  const oldest = value?.oldest;
  if (!Number.isInteger(value?.count) || value.count < 1 || !Number.isInteger(oldest?.issue) || oldest.issue < 1) return null;
  if (!/^[A-Z][A-Z_]{0,39}$/.test(String(oldest.code)) || Number.isNaN(Date.parse(oldest.since))) return null;
  if (typeof oldest.next !== 'string' || !oldest.next || oldest.next.length > 300 || /[\r\n]/.test(oldest.next)) return null;
  return { count: value.count, oldest: { issue: oldest.issue, code: oldest.code, since: oldest.since, next: oldest.next } };
}

// `Longest stalled on the work queue: #<n> (<code> since <time>Z); next step: <step>`, or null.
function queueText(value) {
  const queue = queueOf(value);
  if (!queue) return null;
  const { issue, code, since, next } = queue.oldest;
  const at = new Date(Date.parse(since)).toISOString().slice(0, 16).replace('T', ' ');
  const of = queue.count > 1 ? ` of ${queue.count}` : '';
  return `Longest stalled on the work queue${of}: #${issue} (${code} since ${at}Z); next step: ${next.replace(/^Controller:\s*/, '')}`;
}

function markShown(repository, digest, deps = {}) {
  const cache = readCache(repository, deps);
  if (!cache) return;
  try { writeAtomically(cacheFile(repository, deps), { ...cache, shown_digest: digest }); } catch { /* shown again next time */ }
}

function ageText(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

// The session-start line for a repository, or null when there is nothing to say, and whether a
// background refresh is due: { line, refresh, age }. `age` is set when the cache is over an hour old.
// While a finding is new or acknowledged the line shows at every start; "clear" shows once after each
// change (every line shown records its set); with no cache it never says clear. The caller says
// whether a refresh started.
function sessionAttention(repository, deps = {}) {
  const cache = readCache(repository, deps);
  if (!cache) return { line: 'Attention: not checked on this computer yet', refresh: true, age: null };
  const nowMs = Date.parse((deps.now || (() => new Date().toISOString()))());
  const age = nowMs - Date.parse(cache.as_of);
  const stale = age > STALE_MS;
  const open = (cache.counts?.new || 0) + (cache.counts?.acknowledged || 0);
  const result = line => ({ line, refresh: stale, age: stale ? ageText(age) : null });
  if (open === 0 && cache.shown_digest === cache.digest) return result(null);
  if (cache.shown_digest !== cache.digest) markShown(repository, cache.digest, deps);
  const queue = open > 0 ? queueText(cache.queue) : null;
  return result(open > 0 ? `${cache.line}${stale ? ` (as of ${ageText(age)} ago)` : ''}.${queue ? ` ${queue}.` : ''} Run programme.cjs attention for the list` : `${cache.line}${stale ? ` (as of ${ageText(age)} ago)` : ''}`);
}

// Background refreshes from session start are at most one per START_GAP_MS per repository on this
// computer, so a refresh that keeps failing (no holder, gh signed out) is not started at every start.
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

module.exports = Object.freeze({ CACHE_SCHEMA, STALE_MS, START_GAP_MS, cacheDir, cacheFile, readCache, writeCache, markShown, sessionAttention, claimBackgroundStart, ageText, queueText });
