'use strict';

// Write-triggered programme refresh. The plugins' after-tool (`PostToolUse`) hook marks a session that
// made a GitHub write; its turn-end (`Stop`) hook then starts `programme.cjs refresh` in the background
// for a governed checkout and clears the mark. No token is involved: the pass runs as the computer's
// own `gh` sign-in. Where `gh` is not signed in (cloud containers), the pass fails, the failure is kept
// in the last-run file, and the hourly sweep brings the pages up to date instead.
//
// Marking reads only the hook input and writes one small local file: no git, gh or network call. Both
// paths never throw, never print and never block a turn.

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
]);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'local_shell', 'exec_command']);
const SHELL_WRITES = [
  /\bgh(?:\.exe)?\s+(?:issue|pr)\s+(?:create|edit|comment|close|reopen|merge|ready|review|delete|lock|unlock|transfer|pin|unpin)\b/i,
  /\bgh(?:\.exe)?\s+api\b[^\r\n]*(?:(?:-X|--method)[\s=]*['"]?(?:POST|PATCH|PUT|DELETE)\b|\s(?:-f|-F|--field|--raw-field|--input)\b)/i,
  /\bgh(?:\.exe)?\s+api\s+graphql\b[^\r\n]*\bmutation\b/i,
  /\bgit(?:\.exe)?\s+(?:-C\s+\S+\s+)?push\b/i,
];

function refreshDir(deps = {}) {
  return deps.refreshDir || path.join(deps.home || os.homedir(), '.ai-agent-toolkit', 'user-state', 'programme-refresh');
}
const markFile = (hash, deps) => path.join(refreshDir(deps), `${hash}.mark.json`);
const lastRunFile = deps => path.join(refreshDir(deps), 'last-run.log');

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
  return SHELL_WRITES.some(pattern => pattern.test(command)) ? { repository: null } : null;
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
    const roots = new Set();
    for (const entry of mark.writes) {
      const root = governedRoot(entry.cwd) || governedRoot(input.cwd);
      if (!root) continue;
      const repository = boundRepository(root).toLowerCase();
      if (entry.repository && entry.repository.toLowerCase() !== repository) continue;
      if (!checkpoint.githubGovernanceOn(root, deps)) continue;
      roots.add(root);
    }
    if (!roots.size) return { outcome: 'NOT_GOVERNED' };
    const start = deps.start || startRefresh;
    for (const root of roots) start(root, deps);
    return { outcome: 'STARTED', roots: [...roots] };
  } catch { return { outcome: 'FAILED' }; }
}

// Starts `programme.cjs refresh` detached, with its output in the last-run file, so the turn ends at once.
function startRefresh(root, deps = {}) {
  const log = lastRunFile(deps);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'w', 0o600);
  try {
    fs.writeSync(fd, `${new Date().toISOString()} refresh ${root}\n`);
    const child = spawn(process.execPath, [PROGRAMME, 'refresh', '--repo-root', root], {
      cwd: root, detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
    });
    child.unref();
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = Object.freeze({ WRITE_TOOLS, githubWrite, markWrite, onStop, startRefresh, governedRoot, refreshDir, markFile, lastRunFile });
