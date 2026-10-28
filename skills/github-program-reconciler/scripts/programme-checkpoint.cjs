'use strict';

// Executor checkpoint journals. An executor session the controller assigned to a gate binds once
// (`programme.cjs bind`), then writes only its own journal: on `bind`, on `programme.cjs checkpoint`,
// and from the host's turn-end (`Stop`) hook. The journal is evidence, not state: only the
// controller's reconcile reads it into the child document.
//
// The hook path never blocks a turn and never prints to stdout. A session without a local binding, or
// a repository without `.github/toolkit-programme.json`, returns before any git, gh or network call.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ProgrammeError, resolveExecutable } = require('./resolve-executable.cjs');

const BINDING_SCHEMA = 'toolkit.programme-session-binding.v1';
const ERRORS_LIMIT = 20;
const HOOK_DEADLINE_MS = 20000;
const CALL_TIMEOUT_MS = 8000;
const SHA40 = /^[0-9a-f]{40}$/;
const RETURN_KEYS = ['return_id', 'verdict_requested', 'at_head', 'next_action', 'blockers'];
const RETURN_BLOCK = /```toolkit-return[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

// Only a hash of the host session ID is stored or used in a file name.
function sessionHash(sessionId) {
  const value = String(sessionId ?? '').trim();
  if (!value) throw new ProgrammeError('USAGE', 'A session ID is needed (--session <this session\'s own id>).');
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sessionsDir(deps = {}) {
  return deps.sessionsDir || path.join(deps.home || os.homedir(), '.ai-agent-toolkit', 'user-state', 'programme-sessions');
}

function bindingFile(hash, deps) { return path.join(sessionsDir(deps), `${hash}.json`); }
function errorsFile(hash, deps) { return path.join(sessionsDir(deps), `${hash}.errors.json`); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch { return null; }
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readLocalBinding(hash, deps = {}) {
  const binding = readJson(bindingFile(hash, deps));
  if (!binding || binding.schema !== BINDING_SCHEMA || binding.session_hash !== hash) return null;
  return binding;
}

function writeLocalBinding(binding, deps = {}) {
  writeJsonAtomically(bindingFile(binding.session_hash, deps), { schema: BINDING_SCHEMA, ...binding });
}

function readErrors(hash, deps = {}) {
  const value = readJson(errorsFile(hash, deps));
  return { pending: value?.pending || null, recent: Array.isArray(value?.recent) ? value.recent : [] };
}

// A failure is kept locally; the next journal write carries its code so the controller sees it, and
// `show --session` lists the recent ones. The message never holds a secret: it is the error code's text.
function recordError(hash, code, message, deps = {}) {
  try {
    const errors = readErrors(hash, deps);
    const entry = { code: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(code)) ? code : 'CHECKPOINT_FAILED', at: now(deps), message: String(message || '').slice(0, 300) };
    writeJsonAtomically(errorsFile(hash, deps), { pending: { code: entry.code, at: entry.at }, recent: [...errors.recent, entry].slice(-ERRORS_LIMIT) });
  } catch { /* the hook never fails because its error log could not be written */ }
}

function clearPending(hash, deps = {}) {
  const errors = readErrors(hash, deps);
  if (!errors.pending) return;
  try { writeJsonAtomically(errorsFile(hash, deps), { pending: null, recent: errors.recent }); } catch { /* reported again next time */ }
}

function now(deps) { return (deps.now || (() => new Date().toISOString()))(); }

// Local git facts for the bound checkout; never a network call.
function collectFacts(repoRoot, deps = {}) {
  const run = deps.run || spawnSync;
  const gitPath = deps.gitPath || resolveExecutable('git');
  const git = args => {
    const result = run(gitPath, ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return result && !result.error && result.status === 0 ? String(result.stdout || '').trim() : null;
  };
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
  const counts = git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  const [behind, ahead] = counts && /^\d+\s+\d+$/.test(counts) ? counts.split(/\s+/).map(Number) : [null, null];
  return {
    branch: branch && branch !== 'HEAD' ? branch : null,
    head: SHA40.test(head || '') ? head : null,
    tree: SHA40.test(tree || '') ? tree : null,
    dirty: status === null ? null : status.length > 0,
    ahead, behind,
  };
}

// The executor's typed return, from the last ```toolkit-return block in its final message:
//   return_id: g1-r2
//   verdict_requested: ACCEPT        (or WAITING_OWNER, or none)
//   at_head: <full 40-character SHA>
//   next_action: one line
//   blockers: first; second
function parseReturnBlock(message) {
  if (typeof message !== 'string' || !message.includes('```toolkit-return')) return { entry: null, error: null };
  const blocks = [...message.matchAll(RETURN_BLOCK)];
  if (!blocks.length) return { entry: null, error: 'RETURN_BLOCK_INVALID' };
  const fields = {};
  for (const line of blocks.at(-1)[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match || !RETURN_KEYS.includes(match[1]) || Object.hasOwn(fields, match[1])) return { entry: null, error: 'RETURN_BLOCK_INVALID' };
    fields[match[1]] = match[2];
  }
  const verdict = !fields.verdict_requested || /^none$/i.test(fields.verdict_requested) ? null : fields.verdict_requested.toUpperCase();
  const entry = {
    return_id: fields.return_id || '',
    verdict_requested: verdict,
    at_head: fields.at_head ? fields.at_head.toLowerCase() : null,
    next_action: fields.next_action || null,
    blockers: (fields.blockers || '').split(';').map(item => item.trim()).filter(item => item && !/^none$/i.test(item)),
  };
  const state = require('./programme-state.cjs');
  const probe = { schema: state.SCHEMA.journal, repository: 'probe/probe', issue: 1, assignment: 'probe', session_hash: '0'.repeat(16),
    completion_mode: 'native', route: null, seq: 1, checkpoint: null, returns: [entry], last_error: null };
  return state.validateJournal(probe).length ? { entry: null, error: 'RETURN_BLOCK_INVALID' } : { entry, error: null };
}

function newJournal({ repository, issue, assignment, hash, route, facts = null }) {
  const state = require('./programme-state.cjs');
  return { schema: state.SCHEMA.journal, repository, issue, assignment, session_hash: hash, completion_mode: 'native', route: route || null,
    seq: 1, checkpoint: facts, returns: [], last_error: null };
}

// The next journal, or null when nothing but time would change. A return ID is kept once; the same
// ID with different content is refused (RETURN_ID_REUSED) and the earlier one stays.
function nextJournal(previous, { facts, entry = null, lastError = null, route = undefined }) {
  // Stored journals have sorted keys; compare canonical text so key order never counts as a change.
  const { canonical } = require('./programme-state.cjs');
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const next = JSON.parse(JSON.stringify(previous));
  delete next.volatile;
  let error = null;
  if (facts) next.checkpoint = facts;
  if (route !== undefined && route !== null) next.route = route;
  if (entry) {
    const existing = next.returns.find(item => item.return_id === entry.return_id);
    if (!existing) next.returns = [...next.returns, entry].slice(-20);
    else if (!same(existing, entry)) error = 'RETURN_ID_REUSED';
  }
  if (lastError) next.last_error = lastError;
  const strip = doc => { const copy = { ...doc }; delete copy.volatile; delete copy.seq; return copy; };
  if (same(strip(next), strip(previous))) return { doc: null, error };
  next.seq = previous.seq + 1;
  return { doc: next, error };
}

// A transport whose calls stop at the hook's deadline, each with a short timeout.
function deadlineTransport(deps) {
  if (deps.transport) return deps.transport;
  const state = require('./programme-state.cjs');
  const deadline = deps.deadline || (Date.now() + HOOK_DEADLINE_MS);
  const run = deps.run || spawnSync;
  const transport = new state.GitHubTransport({ ghPath: deps.ghPath || resolveExecutable('gh'), run: (file, args, options) => {
    const remaining = deadline - Date.now();
    if (remaining < 1000) return { error: new Error('the checkpoint deadline passed') };
    return run(file, args, { ...options, timeout: Math.min(CALL_TIMEOUT_MS, remaining) });
  } });
  return transport;
}

// Whether the repository's GitHub governance is ENABLED with programme records in force (a fresh read of
// the binding merged on the default branch). A state that
// cannot be read, or a copy without the state module, counts as off. `deps.governanceState` is for tests.
function githubGovernanceOn(repoRoot, deps = {}) {
  const current = governanceStateOf(repoRoot, deps);
  return Boolean(current) && current.state === 'ENABLED' && current.programme_records_bind === true;
}

// The governance state for the repository, or null when it cannot be read (counts as off).
function governanceStateOf(repoRoot, deps = {}) {
  try {
    const read = deps.governanceState || require('../../../repo/scripts/toolkit-governance-state.cjs').governanceState;
    return read(repoRoot);
  } catch { return null; }
}

// ---- offline queue ----------------------------------------------------------------------------------
//
// When governance is on but records cannot be written yet (the merged binding was last read over 24
// hours ago or not at all, or GitHub cannot be reached), the turn's facts and return block are kept in
// a queue next to the session binding, in Toolkit's own user-state, never the repository. The next
// turn end where records bind and the store answers applies them in order before its own (the
// journal's return IDs make a replay idempotent) and deletes the queue. Governance confirmed off
// (DISABLED, by the merged binding or the user's answer) deletes the queue without replaying it.

const QUEUE_SCHEMA = 'toolkit.programme-checkpoint-queue.v1';
const QUEUE_LIMIT = 200;
const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function queueFile(hash, deps) { return path.join(sessionsDir(deps), `${hash}.queued.json`); }

// The queued entries still inside the bounds, oldest first; dropped ones are noted once.
function readQueue(hash, deps = {}) {
  const doc = readJson(queueFile(hash, deps));
  if (!doc || doc.schema !== QUEUE_SCHEMA || !Array.isArray(doc.entries)) return [];
  const now = deps.now ? Date.parse(deps.now()) : Date.now();
  return doc.entries.filter(item => item && typeof item.at === 'string' && now - Date.parse(item.at) <= QUEUE_MAX_AGE_MS);
}

function queueEntry(hash, item, deps = {}) {
  const entries = [...readQueue(hash, deps), item];
  const kept = entries.slice(-QUEUE_LIMIT);
  if (kept.length < entries.length) recordError(hash, 'QUEUE_FULL', `The offline queue keeps the newest ${QUEUE_LIMIT} turns; ${entries.length - kept.length} older one was dropped.`, deps);
  writeJsonAtomically(queueFile(hash, deps), { schema: QUEUE_SCHEMA, entries: kept });
  return kept.length;
}

function discardQueue(hash, deps = {}) {
  const had = fs.existsSync(queueFile(hash, deps));
  fs.rmSync(queueFile(hash, deps), { force: true });
  return had;
}

// A store call that failed because GitHub could not be reached (no HTTP status, gh could not run, or
// a server error), as opposed to a refusal the queue must not paper over.
function unreachable(error) {
  if (!error || error.code !== 'GH_FAILED') return false;
  const status = error.details && typeof error.details.status === 'number' ? error.details.status : null;
  return status === null || status >= 500;
}

// The binding merged on the default branch, from this computer's cache, or null. `deps.mergedBinding`
// is for tests.
function mergedBindingOf(repoRoot, deps = {}) {
  try {
    const read = deps.mergedBinding || require('../../../repo/scripts/toolkit-governance-state.cjs').mergedBinding;
    return read(repoRoot) || null;
  } catch { return null; }
}

// One checkpoint for a bound session. Returns { outcome, ... } and throws only for a programme error
// the caller records. `UNBOUND` means no binding for this session or repository: nothing else ran.
// `QUEUED` means the turn was kept in the offline queue (see above).
function runCheckpoint({ sessionId, message = null }, deps = {}) {
  const hash = sessionHash(sessionId);
  const local = readLocalBinding(hash, deps);
  if (!local) return { outcome: 'UNBOUND' };
  const state = require('./programme-state.cjs');
  if (!local.repo_root || !fs.existsSync(path.join(local.repo_root, state.BINDING_FILE))) return { outcome: 'UNBOUND' };
  const current = governanceStateOf(local.repo_root, deps);
  const parsed = parseReturnBlock(message);
  const queueTurn = () => {
    if (parsed.error) recordError(hash, parsed.error, 'The toolkit-return block could not be read; it was not recorded.', deps);
    const facts = collectFacts(local.repo_root, deps);
    const queued = queueEntry(hash, { at: deps.now ? deps.now() : new Date().toISOString(), facts, entry: parsed.entry }, deps);
    return { outcome: 'QUEUED', queued, error: parsed.error };
  };
  if (!current || current.state !== 'ENABLED' || current.programme_records_bind !== true) {
    // Confirmed off: what was queued is never written.
    if (current && current.state === 'DISABLED') return { outcome: 'GOVERNANCE_OFF', discarded: discardQueue(hash, deps) };
    // On, with the governed rules in force, but the merged binding is not freshly read: keep the turn.
    if (current && current.state === 'ENABLED' && current.governed_rules_bind === true) return queueTurn();
    return { outcome: 'GOVERNANCE_OFF' };
  }
  // Only the binding merged on the default branch names the store; a working-tree copy never does.
  const binding = mergedBindingOf(local.repo_root, deps);
  if (!binding) return { outcome: 'GOVERNANCE_OFF' };
  if (binding.repository.toLowerCase() !== String(local.repository).toLowerCase()) {
    throw new ProgrammeError('BINDING_MOVED', 'The repository binding no longer names the repository this session was bound in; bind again.');
  }
  const store = new state.STORE_BACKENDS[binding.store.kind]({ transport: deadlineTransport(deps), store: binding.store, now: deps.now });
  const name = `${local.assignment}--${hash}.json`;
  let read;
  try { read = store.readJournal(local.issue, name); } catch (error) {
    if (unreachable(error)) return queueTurn();
    throw error;
  }
  const { doc: previous, sha } = read;
  if (!previous) throw new ProgrammeError('JOURNAL_MISSING', `The journal for assignment ${local.assignment} is missing from the store; bind again.`);
  if (parsed.error) recordError(hash, parsed.error, 'The toolkit-return block could not be read; it was not recorded.', deps);
  const facts = collectFacts(local.repo_root, deps);
  // Queued turns first, in order, then this one, folded into one journal write.
  const queued = readQueue(hash, deps);
  const pending = readErrors(hash, deps).pending;
  let next = previous;
  let changed = false;
  let lastIdError = null;
  for (const item of [...queued, { facts, entry: parsed.entry, lastError: pending }]) {
    const step = nextJournal(next, { facts: item.facts, entry: item.entry || null, lastError: item.lastError || null });
    if (step.error) lastIdError = step.error;
    if (step.doc) { next = step.doc; changed = true; }
  }
  if (changed) next = { ...next, seq: previous.seq + 1 };
  if (lastIdError) recordError(hash, lastIdError, 'A return ID was reused with different content; the first one stays.', deps);
  if (!changed) {
    if (queued.length) discardQueue(hash, deps);
    return { outcome: 'NOOP', journal: name, error: parsed.error || lastIdError };
  }
  let result;
  try { result = store.writeJournal(local.issue, name, next, { sha, previous }); } catch (error) {
    if (unreachable(error)) return queueTurn();
    throw error;
  }
  if (pending) clearPending(hash, deps);
  if (queued.length) discardQueue(hash, deps);
  return { outcome: result.outcome, journal: name, seq: result.doc.seq, replayed: queued.length, error: parsed.error || lastIdError };
}

// The Stop hook entry: never throws, never prints, records any failure locally.
function runHook(input, deps = {}) {
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : '';
  if (!sessionId.trim()) return { outcome: 'UNBOUND' };
  let hash;
  try { hash = sessionHash(sessionId); } catch { return { outcome: 'UNBOUND' }; }
  if (!fs.existsSync(bindingFile(hash, deps))) return { outcome: 'UNBOUND' };
  try {
    const message = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : null;
    return runCheckpoint({ sessionId, message }, { deadline: Date.now() + HOOK_DEADLINE_MS, ...deps });
  } catch (error) {
    recordError(hash, error.code || 'CHECKPOINT_FAILED', error.message, deps);
    return { outcome: 'FAILED', code: error.code || 'CHECKPOINT_FAILED' };
  }
}

module.exports = Object.freeze({
  BINDING_SCHEMA, HOOK_DEADLINE_MS, sessionHash, sessionsDir, bindingFile, errorsFile, readLocalBinding, writeLocalBinding,
  readErrors, recordError, collectFacts, parseReturnBlock, newJournal, nextJournal, runCheckpoint, runHook, githubGovernanceOn,
  queueFile, readQueue, QUEUE_LIMIT, QUEUE_MAX_AGE_MS,
});
