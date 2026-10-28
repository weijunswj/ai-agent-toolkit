'use strict';

// Shared fixture for the toolkit-governance-continuation-*.test.cjs files: synthetic caller, target
// and held folders with a native Claude transcript, shell inputs, byte snapshots, the private
// evidence projection and a runner that starts the source hooks a few at a time.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

// Selector receipts, inspected against the PATH host versions frozen by discovery:
// Claude 2.1.310: https://code.claude.com/docs/en/sessions (exact transcript path; internal JSONL).
// Codex 0.164.0: https://github.com/openai/codex/tree/rust-v0.164.0/codex-rs
// exec/src/lib.rs resolve_resume_thread_id compares latest_thread_cwd to config.cwd.
// tui/src/resume_picker.rs repository_cwd_filter expands interactive --last to worktrees.
// Consequently only exec/e resume --last is directory-proven here. UUIDs need authoritative
// native selection including state-db/revert/compression; no filename or session_index shortcut.
const ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const root = path.resolve(__dirname, '../../..');

function fixture(t) {
  // Windows app temp redirection may alias a newly created child even when the
  // temp parent itself resolves unchanged. Fixtures use native identity; the
  // separate junction/alias cases still prove that production refuses aliases.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ctx = { dir, caller: path.join(dir, 'caller'), target: path.join(dir, 'target'), other: path.join(dir, 'other'), home: path.join(dir, 'home') };
  ctx.projects = path.join(ctx.home, '.claude', 'projects');
  ctx.file = path.join(ctx.projects, 'fixture project', `${ID}.jsonl`);
  for (const folder of [ctx.caller, ctx.target, ctx.other, path.join(ctx.target, 'sub'), path.dirname(ctx.file)]) fs.mkdirSync(folder, { recursive: true });
  ctx.options = { registryPath: path.join(ctx.home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  ctx.environment = { USERPROFILE: ctx.home, HOME: ctx.home, CLAUDE_CONFIG_DIR: path.join(ctx.home, '.claude'), CODEX_HOME: path.join(ctx.home, '.codex') };
  return ctx;
}
function message(cwd, extra = {}) {
  return { type: 'user', sessionId: ID, cwd, uuid: MESSAGE_ID, timestamp: '2026-10-01T00:00:00.000Z', message: { role: 'user', content: 'synthetic fixture' }, ...extra };
}
function transcript(ctx, rows = [message(ctx.target)]) { fs.writeFileSync(ctx.file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }
function shell(ctx, command, extra = {}) { return { tool_name: 'Bash', cwd: ctx.caller, session_id: 'fixture-run', tool_input: { command }, ...extra }; }
function snapshot(dir) {
  const result = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), name = path.relative(dir, file);
      if (entry.isSymbolicLink()) result[name] = `link:${fs.readlinkSync(file)}`;
      else if (entry.isDirectory()) { result[name] = 'directory'; walk(file); }
      else result[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  walk(dir); return result;
}

// Exercise the private pure projection without adding a product export or entrypoint.
function evidenceProjection(transform = source => source) {
  const Module = require('node:module');
  const filename = path.join(root, 'repo/scripts/toolkit-governance-continuation.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  let source = transform(fs.readFileSync(filename, 'utf8'));
  source = source.replace('for (const step of pattern.steps) {', 'for (const step of pattern.steps) { evidenceOperations += 1;');
  const start = source.indexOf('function roleWords('), end = source.indexOf('\nfunction literalWord(', start);
  const lexer = source.slice(start, end).replace('for (let i = 0; i < text.length;) {', 'for (let i = 0; i < text.length;) { roleVisits += 1;')
    .replace('value += text[i++];', 'roleVisits += 1; value += text[i++];')
    .replace('while (i < text.length && text[i] !== quote) i += 1;', 'while (i < text.length && text[i] !== quote) { roleVisits += 1; i += 1; }');
  source = source.slice(0, start) + lexer + source.slice(end);
  loaded._compile(source + '\nlet evidenceOperations = 0, roleVisits = 0; module.exports = { CANDIDATE_MACHINES, atomPattern, advancePrefixes, quoteAtoms, orderedEvidence, commandRoles, roleWords, pythonBindingBarriers, constructionFragments, parse, roleVisits: () => roleVisits, operations: () => evidenceOperations };', filename);
  return loaded.exports;
}

function sentinelText(template, word, control) {
  const values = { word, head: word.slice(0, 2), tail: word.slice(2), nul: control };
  return template.replace(/\{(word|head|tail|nul)\}/g, (_, key) => values[key]);
}

// The two source hook entrypoints the hook tests start, one process per case.
const HOOKS = Object.freeze([
  Object.freeze({ name: 'claude', file: 'toolkit-governance-hook.cjs', args: Object.freeze(['--event', 'PreToolUse']), deniedExit: 0 }),
  Object.freeze({ name: 'codex', file: 'toolkit-codex-helper-hook.cjs', args: Object.freeze([]), deniedExit: 2 }),
]);
const HOOK_CONCURRENCY = Math.max(1, Math.min(4, os.availableParallelism()));

// Starts each call as its own node process with its own stdin, a few at a time, and returns
// { status, stdout, stderr } per call in call order. Like spawnSync, a call over its timeout or
// output limit is stopped and gets status null.
function runNodeProcesses(calls, { concurrency = HOOK_CONCURRENCY, timeout = 10000, maxBuffer = 256 * 1024 } = {}) {
  const results = new Array(calls.length);
  let next = 0;
  function start(index) {
    return new Promise((resolve) => {
      const call = calls[index];
      const child = spawn(process.execPath, call.args, { env: call.env, cwd: call.cwd, windowsHide: true });
      let stdout = '', stderr = '', stopped = false;
      const stop = () => { stopped = true; child.kill(); };
      const timer = setTimeout(stop, timeout);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > maxBuffer) stop(); });
      child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > maxBuffer) stop(); });
      child.on('error', error => { stderr += String(error && error.message); });
      child.on('close', code => {
        clearTimeout(timer);
        results[index] = { status: stopped ? null : code, stdout, stderr };
        resolve();
      });
      child.stdin.on('error', () => {});
      child.stdin.end(call.input);
    });
  }
  async function worker() { while (next < calls.length) await start(next++); }
  return Promise.all(Array.from({ length: Math.min(concurrency, calls.length) }, worker)).then(() => results);
}

module.exports = Object.freeze({
  HOOKS, HOOK_CONCURRENCY, ID, MESSAGE_ID, OTHER_ID, root,
  evidenceProjection, fixture, message, runNodeProcesses, sentinelText, shell, snapshot, transcript,
});
