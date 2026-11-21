#!/usr/bin/env node
'use strict';

// After-tool (PostToolUse) hook: keeps the controller handoff snapshot fresh without a scheduled task.
// It triggers on content, not tool names: after any tool call that is not a known read-only one (a
// host memory tool, a shell edit, a patch, an MCP writer, a tool it has never heard of), at most once
// a minute per session, it compares the snapshot's remembered sources (its manifest) with what this
// session holds, by the same file-by-file rule the refresh writes with (toolkit-handoff.cjs). When that
// refresh would write something, it starts one `toolkit-store.cjs handoff --baseline <session file>`
// run in the background, at most once per 10 minutes (a lock file's time); a change inside that window
// is seen by the next call after it.
// The store and repository come from the last good run's record or, in a session with none (a fresh
// cloud container), from a nearby store checkout's snapshot of the working repository (or, outside a
// repository, the only snapshot matching a nearby checkout's origin). The session file keeps the
// session baseline: the files this session holds and each source's realness, judged once when the
// session starts. Finding a store grants nothing: the run's own pre-flight decides.
// Any error: nothing happens. It never blocks, never prints and always exits 0. No scheduled task runs
// it, but it acts in any session the host runs hooks in, a session a scheduled task starts included.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const STORE = path.join(__dirname, 'toolkit-store.cjs');
const DEBOUNCE_MS = 10 * 60 * 1000;
const CHECK_MS = 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 20;
// Tools that only read. Every other tool, a new or unknown one included, may move a source.
const READ_ONLY_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'ToolSearch', 'TodoWrite', 'TaskGet', 'TaskList', 'TaskOutput']);
const READ_ONLY = new Set(READ_ONLY_TOOLS);
// The host matcher: every tool but the read-only ones.
const MATCHER = `^(?!(?:${READ_ONLY_TOOLS.join('|')})$)`;

function stateDirectory(deps) {
  return deps.stateDirectory || require('./toolkit-user-state.cjs').userStateDirectory();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

// A usable record (the last good run's, or one found nearby), or null.
function usable(record) {
  if (!record || typeof record.repo_root !== 'string' || typeof record.repository !== 'string') return null;
  return typeof record.store === 'string' || typeof record.out === 'string' ? record : null;
}

// The background run's arguments for a record.
function runArgs(record, sessionFile) {
  const target = typeof record.store === 'string' ? ['--store', record.store] : ['--out', record.out];
  return [STORE, 'handoff', ...target, '--repo-root', record.repo_root, '--baseline', sessionFile];
}

// A session with no record: the first snapshot manifest in a nearby store checkout whose owner/repo
// is a nearby checkout's origin. Nearby: the working folder's repository and its sibling folders, or
// the working folder's own child folders when it is not in a repository (as cloud sessions clone them).
function discover(cwd) {
  const state = require('./toolkit-governance-state.cjs');
  const handoff = require('./toolkit-handoff.cjs');
  const start = path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  const own = state.findGitRoot(start);
  const folder = own ? path.dirname(own) : start;
  const checkouts = own ? [own] : [];
  let names = [];
  try { names = fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort(); } catch { names = []; }
  for (const name of names) {
    if (checkouts.length >= SCAN_LIMIT) break;
    const dir = path.join(folder, name);
    if (dir !== own && fs.existsSync(path.join(dir, '.git'))) checkouts.push(dir);
  }
  const origins = new Map();
  for (const dir of checkouts) {
    try {
      const identity = state.readIdentity(dir);
      const slug = identity.valid && identity.root === dir ? state.remoteSlug(identity.remote) : null;
      if (slug && !origins.has(slug.toLowerCase())) origins.set(slug.toLowerCase(), dir);
    } catch { /* not a readable checkout */ }
  }
  const list = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); } catch { return []; } };
  const found = [];
  for (const store of checkouts) {
    const root = path.join(store, ...handoff.ROOT.split('/'));
    for (const owner of list(root)) {
      for (const repo of list(path.join(root, owner))) {
        const repository = `${owner}/${repo}`;
        const repoRoot = origins.get(repository.toLowerCase());
        const snapshot = handoff.snapshotFolder(repository);
        if (repoRoot && repoRoot !== store && snapshot && handoff.readManifest(store, snapshot)) found.push({ store, repo_root: repoRoot, repository });
      }
    }
  }
  // The working repository's own snapshot first; otherwise only an unambiguous one.
  const mine = own ? found.filter(item => item.repo_root === own) : [];
  if (mine.length) return mine.length === 1 ? mine[0] : null;
  return found.length === 1 ? found[0] : null;
}

// Session files older than a week are removed when a new session starts.
function prune(folder, keep, now) {
  let names = [];
  try { names = fs.readdirSync(folder); } catch { return; }
  for (const name of names) {
    const file = path.join(folder, name);
    if (file === keep || !name.endsWith('.json')) continue;
    try { if (now - fs.statSync(file).mtimeMs > SESSION_MAX_AGE_MS) fs.rmSync(file, { force: true }); } catch { /* best effort */ }
  }
}

function main(deps = {}) {
  try {
    const raw = deps.stdin !== undefined ? deps.stdin : fs.readFileSync(0, 'utf8');
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object' || (input.hook_event_name !== undefined && input.hook_event_name !== 'PostToolUse')) return 0;
    if (READ_ONLY.has(input.tool_name)) return 0;
    const now = deps.now ? deps.now() : Date.now();
    const dir = stateDirectory(deps);
    const key = typeof input.session_id === 'string' && input.session_id ? input.session_id : 'default';
    const sessions = path.join(dir, 'handoff-sessions');
    const sessionFile = path.join(sessions, `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}.json`);
    const session = readJson(sessionFile) || {};
    if (Number.isFinite(session.checked_at) && now >= session.checked_at && now - session.checked_at < CHECK_MS) return 0;
    if (!Number.isFinite(session.started_at)) { session.started_at = now; prune(sessions, sessionFile, now); }
    session.checked_at = now;
    let record = usable(readJson(deps.handoffRecord || path.join(dir, 'handoff-refresh.json')));
    if (!record) {
      if (session.found === undefined) session.found = discover(input.cwd) || false;
      record = usable(session.found);
    }
    // Recorded before any read, so a source that cannot be read still waits a minute.
    writeJson(sessionFile, session);
    const handoff = record ? require('./toolkit-handoff.cjs') : null;
    const base = record ? record.store || record.out : null;
    const manifest = record ? handoff.readManifest(base, handoff.snapshotFolder(record.repository) || '') : null;
    if (!manifest) return 0;
    const platform = deps.platform || process.platform;
    if (!Array.isArray(session.rows)) {
      const saved = manifest.sources || {};
      session.rows = handoff.sessionRows({ memory: saved.memory || null, instructions: saved.instructions || null, files: Array.isArray(saved.files) ? saved.files : [] }, { platform });
      session.real = handoff.realBySource(session.rows);
      writeJson(sessionFile, session);
    }
    const planned = handoff.plan({ base, repository: record.repository, sources: null, stamp: null, platform, session: { rows: session.rows, real: session.real || null }, scan: false });
    if (planned.unchanged) return 0;
    const lock = path.join(dir, 'handoff-refresh.lock');
    try { if (now - fs.statSync(lock).mtimeMs < DEBOUNCE_MS) return 0; } catch { /* no lock yet */ }
    fs.writeFileSync(lock, `${new Date(now).toISOString()}\n`);
    fs.utimesSync(lock, new Date(now), new Date(now));
    const child = (deps.spawn || spawn)(process.execPath, runArgs(record, sessionFile), { detached: true, stdio: 'ignore', windowsHide: true, cwd: record.repo_root });
    // A start that fails later (the recorded folder is gone) must not crash the hook or print.
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
  } catch {
    // A refresh is never worth blocking or failing a tool call.
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, discover, runArgs, READ_ONLY_TOOLS, MATCHER, DEBOUNCE_MS, CHECK_MS };
