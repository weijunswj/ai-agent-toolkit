#!/usr/bin/env node
'use strict';

// After-tool (PostToolUse) hook: keeps the controller handoff snapshot fresh without a scheduled task.
// After a successful `toolkit-store.cjs save` (the gate-end evidence archive), or a write tool that
// changed a file the last handoff run copied (its memory folder, instructions or a named working
// file), it starts one `toolkit-store.cjs handoff` run in the background with the store and repository
// that run recorded. At most one start per 10 minutes (a lock file's time); the session-start stale
// check (`toolkit-controller-check.cjs`, check `handoff`) catches anything that falls between.
// No recorded run, or any error: nothing happens. It never blocks, never prints and always exits 0.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const STORE = path.join(__dirname, 'toolkit-store.cjs');
const DEBOUNCE_MS = 10 * 60 * 1000;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'local_shell', 'exec_command']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
// A store save as its own command: the script name, then `save` as the next word.
const STORE_SAVE = /toolkit-store\.cjs["']?\s+save(?:\s|$)/;

function stateDirectory(deps) {
  return deps.stateDirectory || require('./toolkit-user-state.cjs').userStateDirectory();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function shellCommand(input) {
  const command = input?.tool_input?.command ?? input?.tool_input?.cmd;
  return Array.isArray(command) ? command.join(' ') : (typeof command === 'string' ? command : '');
}

// Whether the tool's own answer says the save finished: the plain `Done: save` line or the JSON form.
function saveSucceeded(response) {
  const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
  return /Done: save\b/.test(text) || /\\?"command\\?"\s*:\s*\\?"save\\?"\s*,\s*(?:\\n)?\s*\\?"ok\\?"\s*:\s*true/.test(text);
}

// The files a write tool changed.
function writtenFiles(input) {
  const toolInput = input?.tool_input || {};
  const named = [toolInput.file_path, toolInput.notebook_path, toolInput.path].filter(value => typeof value === 'string' && value);
  const patch = typeof toolInput.input === 'string' ? toolInput.input : typeof toolInput.patch === 'string' ? toolInput.patch : '';
  const patched = [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map(match => match[1].trim());
  const base = typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  return [...named, ...patched].map(file => path.resolve(base, file));
}

function inside(file, folder, platform) {
  const fold = value => (platform === 'win32' ? value.toLowerCase() : value);
  const relative = path.relative(fold(folder), fold(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// 'store-save', 'source-write' or null for one after-tool call.
function triggerOf(input, sources, platform = process.platform) {
  const name = typeof input?.tool_name === 'string' ? input.tool_name : '';
  if (SHELL_TOOLS.has(name)) return STORE_SAVE.test(shellCommand(input)) && saveSucceeded(input.tool_response) ? 'store-save' : null;
  if (!WRITE_TOOLS.has(name) || !sources) return null;
  const roots = [sources.memory, sources.instructions, ...(Array.isArray(sources.files) ? sources.files : [])].filter(value => typeof value === 'string' && value);
  return writtenFiles(input).some(file => roots.some(root => inside(file, root, platform))) ? 'source-write' : null;
}

// The background run's arguments from the last good run's record, or null when there is none.
function runArgs(record) {
  if (!record || typeof record.repo_root !== 'string') return null;
  const target = typeof record.store === 'string' ? ['--store', record.store] : typeof record.out === 'string' ? ['--out', record.out] : null;
  return target ? [STORE, 'handoff', ...target, '--repo-root', record.repo_root] : null;
}

function main(deps = {}) {
  try {
    const raw = deps.stdin !== undefined ? deps.stdin : fs.readFileSync(0, 'utf8');
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object' || (input.hook_event_name !== undefined && input.hook_event_name !== 'PostToolUse')) return 0;
    const dir = stateDirectory(deps);
    const record = readJson(path.join(dir, 'handoff-refresh.json'));
    const args = runArgs(record);
    if (!args) return 0;
    const manifest = readJson(path.join(record.store || record.out, 'evidence', 'handoff', ...String(record.repository || '').split('/'), 'manifest.json'));
    if (!triggerOf(input, manifest?.sources || record.sources, deps.platform)) return 0;
    const lock = path.join(dir, 'handoff-refresh.lock');
    const now = deps.now ? deps.now() : Date.now();
    try { if (now - fs.statSync(lock).mtimeMs < DEBOUNCE_MS) return 0; } catch { /* no lock yet */ }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lock, `${new Date(now).toISOString()}\n`);
    fs.utimesSync(lock, new Date(now), new Date(now));
    const child = (deps.spawn || spawn)(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: record.repo_root });
    if (child && typeof child.unref === 'function') child.unref();
  } catch {
    // A refresh is never worth blocking or failing a tool call.
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, triggerOf, runArgs, saveSucceeded, DEBOUNCE_MS };
