'use strict';

// Write-triggered programme refresh. The plugins' after-tool (`PostToolUse`) hook marks a session that
// made a GitHub write; its turn-end (`Stop`) hook then starts `programme.cjs refresh` in the background
// for a governed checkout and clears the mark. No token is involved: the pass runs as the computer's
// own `gh` sign-in. Where `gh` is not signed in (cloud containers), the pass fails, the failure is kept
// in the checkout's last-run file, and the hourly sweep brings the pages up to date instead.
//
// Marking reads only the hook input and writes one small local file: no git, gh or network call. Both
// paths never throw, never print and never block a turn.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const checkpoint = require('./programme-checkpoint.cjs');

const BINDING_FILE = path.join('.github', 'toolkit-programme.json');
const PROGRAMME = path.join(__dirname, 'programme.cjs');
const MARK_SCHEMA = 'toolkit.programme-refresh-mark.v1';

// GitHub connector tools that change an issue, comment, sub-issue link, pull request, review or the
// files on a branch (which moves a pull request head). Matched on the tool part of
// `mcp__<server>__<tool>` for a server whose name contains "github".
const WRITE_TOOLS = new Set([
  'issue_write', 'add_issue_comment', 'update_issue_comment', 'sub_issue_write',
  'create_pull_request', 'update_pull_request', 'merge_pull_request', 'update_pull_request_branch',
  'pull_request_review_write', 'add_comment_to_pending_review', 'add_reply_to_pull_request_comment',
  'push_files', 'create_or_update_file', 'delete_file',
  // Older names for the same writes.
  'create_issue', 'update_issue', 'add_sub_issue', 'remove_sub_issue', 'reprioritize_sub_issue',
  'create_pending_pull_request_review', 'create_and_submit_pull_request_review', 'submit_pending_pull_request_review',
]);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'local_shell', 'exec_command']);
const GH_WRITE = /\bgh(?:\.exe)?\s+(?:issue|pr)\s+(?:create|edit|comment|close|reopen|merge|ready|review|delete|lock|unlock|transfer|pin|unpin|update-branch)\b/i;
// git push, with any global options before it (-C <dir>, -c <name=value>, --no-pager and the like).
const GIT_PUSH = /\bgit(?:\.exe)?(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-\w))*\s+push\b/i;
const GH_API = /\bgh(?:\.exe)?\s+api\b[^\r\n]*/gi;

// A `gh api` call writes when it names a write method, or sends fields without naming GET; a GraphQL
// call writes only when it is a mutation.
function ghApiWrites(command) {
  for (const [call] of command.matchAll(GH_API)) {
    if (/\bapi\s+graphql\b/i.test(call)) {
      if (/\bmutation\b/i.test(call)) return true;
      continue;
    }
    const method = /(?:-X|--method)[\s=]*['"]?([A-Z]+)/i.exec(call)?.[1]?.toUpperCase();
    if (method) {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return true;
      continue;
    }
    if (/\s(?:-f|-F|--field|--raw-field|--input)\b/.test(call)) return true;
  }
  return false;
}

function refreshDir(deps = {}) {
  return deps.refreshDir || path.join(deps.home || os.homedir(), '.ai-agent-toolkit', 'user-state', 'programme-refresh');
}
const markFile = (hash, deps) => path.join(refreshDir(deps), `${hash}.mark.json`);
// One log per governed checkout, appended to and started afresh once it passes LOG_LIMIT bytes.
const LOG_LIMIT = 256 * 1024;
const MARK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const lastRunFile = (deps, root = '') => path.join(refreshDir(deps), root ? `last-run-${crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 12)}.log` : 'last-run.log');

// Marks left by a session that never reached its turn end (a crash, or a host that runs the after-tool
// hook but not the turn-end one) are removed after a day; the hourly sweep covers their writes.
function pruneMarks(deps, nowMs = Date.now()) {
  const dir = refreshDir(deps);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.endsWith('.mark.json')) continue;
    const file = path.join(dir, name);
    try { if (nowMs - fs.statSync(file).mtimeMs > MARK_MAX_AGE_MS) fs.unlinkSync(file); } catch { /* gone */ }
  }
}

function shellCommand(input) {
  const command = input?.tool_input?.command ?? input?.tool_input?.cmd;
  if (Array.isArray(command)) return command.join(' ');
  return typeof command === 'string' ? command : '';
}

// Returns { repository } (owner/name, or null when only the working folder says which repository) for
// a GitHub write, else null.
function githubWrite(input) {
  const name = typeof input?.tool_name === 'string' ? input.tool_name : '';
  const mcp = /^mcp__(.+)__([^_].*)$/.exec(name);
  if (mcp) {
    if (!/github/i.test(mcp[1]) || !WRITE_TOOLS.has(mcp[2])) return null;
    const { owner, repo } = input.tool_input || {};
    return { repository: typeof owner === 'string' && typeof repo === 'string' && owner && repo ? `${owner}/${repo}` : null };
  }
  if (!SHELL_TOOLS.has(name)) return null;
  const command = shellCommand(input);
  return GH_WRITE.test(command) || GIT_PUSH.test(command) || ghApiWrites(command) ? { repository: null } : null;
}

function sessionHashOf(input) {
  const id = typeof input?.session_id === 'string' ? input.session_id : '';
  if (!id.trim()) return null;
  try { return checkpoint.sessionHash(id); } catch { return null; }
}

function readMark(file) {
  try {
    const mark = JSON.parse(fs.readFileSync(file, 'utf8'));
    return mark && mark.schema === MARK_SCHEMA && Array.isArray(mark.writes) ? mark : null;
  } catch { return null; }
}

// After-tool hook: remember that this session wrote to GitHub, and where it was working.
function markWrite(input, deps = {}) {
  try {
    const write = githubWrite(input);
    if (!write) return { outcome: 'IGNORED' };
    const hash = sessionHashOf(input);
    if (!hash) return { outcome: 'IGNORED' };
    const file = markFile(hash, deps);
    const mark = readMark(file) || { schema: MARK_SCHEMA, writes: [] };
    const entry = { repository: write.repository, cwd: typeof input.cwd === 'string' ? input.cwd : null };
    if (!mark.writes.some(item => item.repository === entry.repository && item.cwd === entry.cwd)) mark.writes.push(entry);
    mark.writes = mark.writes.slice(-20);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(mark)}\n`, { mode: 0o600 });
    return { outcome: 'MARKED' };
  } catch { return { outcome: 'FAILED' }; }
}

// The checkout root at or above a folder, when it carries the programme binding.
function governedRoot(folder) {
  if (typeof folder !== 'string' || !folder) return null;
  let current = path.resolve(folder);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git')) && fs.existsSync(path.join(current, BINDING_FILE))) return current;
    const up = path.dirname(current);
    if (up === current) return null;
    current = up;
  }
}

function boundRepository(root) {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, BINDING_FILE), 'utf8').replace(/^﻿/, '')).repository || ''); }
  catch { return ''; }
}

// Turn-end hook: for a marked session, start one refresh per governed checkout it wrote for, in the
// background, then clear the mark. A write to a repository with no local governed checkout here is left
// to the hourly sweep.
function onStop(input, deps = {}) {
  try {
    const hash = sessionHashOf(input);
    if (!hash) return { outcome: 'UNMARKED' };
    const file = markFile(hash, deps);
    const mark = readMark(file);
    if (!mark) return { outcome: 'UNMARKED' };
    try { fs.unlinkSync(file); } catch { /* cleared by another turn end */ }
    pruneMarks(deps);
    // One refresh per repository: two checkouts of the same repository share one pass.
    const roots = new Map();
    for (const entry of mark.writes) {
      const root = governedRoot(entry.cwd) || governedRoot(input.cwd);
      if (!root) continue;
      const repository = boundRepository(root).toLowerCase();
      if (!repository || (entry.repository && entry.repository.toLowerCase() !== repository)) continue;
      if (roots.has(repository) || !checkpoint.githubGovernanceOn(root, deps)) continue;
      roots.set(repository, root);
    }
    if (!roots.size) return { outcome: 'NOT_GOVERNED' };
    const start = deps.start || startRefresh;
    for (const root of roots.values()) start(root, deps);
    return { outcome: 'STARTED', roots: [...roots.values()] };
  } catch { return { outcome: 'FAILED' }; }
}

// Starts `programme.cjs refresh` detached, with its output in the checkout's last-run file, so the turn
// ends at once. A spawn that fails later (missing node, no permission) is ignored here: the hourly
// sweep covers it.
function startRefresh(root, deps = {}) {
  const log = lastRunFile(deps, root);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  try { if (fs.statSync(log).size > LOG_LIMIT) fs.unlinkSync(log); } catch { /* no log yet */ }
  const fd = fs.openSync(log, 'a', 0o600);
  try {
    fs.writeSync(fd, `${new Date().toISOString()} refresh ${root}\n`);
    const child = spawn(process.execPath, [PROGRAMME, 'refresh', '--repo-root', root], {
      cwd: root, detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = Object.freeze({ WRITE_TOOLS, githubWrite, markWrite, onStop, startRefresh, governedRoot, refreshDir, markFile, lastRunFile, pruneMarks, MARK_MAX_AGE_MS });
