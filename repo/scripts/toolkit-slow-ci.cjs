#!/usr/bin/env node
'use strict';

// The daily slow-CI line: tells the owner once when a repository's CI would gain from shards, or its
// shards are lopsided, wherever they are first after a new result (owner decision INT-TK421-1393).
//
// - A record per repository on this computer (user state, slow-ci.v1.json) keeps when CI was last
//   checked, the last result, which result was last shown and, after a failed check, why it failed.
//   It holds repository ids and names, workflow paths, finding codes, job names, times and counts only.
// - A session start or a turn end only reads that record (local files, no git, gh or network): it
//   gives the line when the last result has a finding and differs from the one last shown, and it
//   saves the result as shown before it returns the line, so a line is never given twice; a record
//   that cannot be saved gives no line. A result is its findings' codes and job names (or leg pairs),
//   so new times or a shard count that moves are the same result. A result with no finding is saved
//   as shown with no line, so the same finding coming back later is new again.
// - When the last successful check is a day old it starts the check in a background process and never
//   waits for it. The start takes an exclusive lock file first, so chats starting together start one.
//   A failed check keeps the last result and its reason, and the next start waits 1, 2, 4 ... hours,
//   at most a day. Offline and test runs (TOOLKIT_GOVERNANCE_OFFLINE=1) start no check unless one is
//   given.
// - The check runs the CI check-up (skills/secure-ci-cd/scripts/ci-checkup.cjs) as its own process and
//   keeps its speed.shards and speed.shards-lopsided findings; a workflow whose runs it could not list
//   keeps its earlier findings. Each run adds one line to slow-ci.log in user state (time, repository,
//   outcome or the reason it failed; never report contents), keeping the last LOG_LINES.
// The calling hook decides where the line goes and in which sessions it runs; this file holds no host
// detail. Only repositories with a github.com origin are checked. Any failure gives no line.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { userStateDirectory } = require('./toolkit-user-state.cjs');

const SCHEMA = 'toolkit.slow-ci.v1';
const BASENAME = 'slow-ci.v1.json';
const LOG = 'slow-ci.log';
const LOG_LINES = 100;
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 32;
const MAX_SHOWN = 3;
const CHECKUP = path.join(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'ci-checkup.cjs');
// The check-up reads each workflow's newest runs through gh; a large repository takes minutes.
const CHECKUP_TIMEOUT_MS = 15 * 60 * 1000;
// A lock older than this belongs to a check that ended without removing it, and is taken over.
const LOCK_STALE_MS = CHECKUP_TIMEOUT_MS + 15 * 60 * 1000;
const PLAYBOOK = 'fast-tests-and-sharding playbook, section Arrange Shards In This Repository\'s CI';
const NOT_CHECKED = /job times not checked/;
const UNREAD = /^job times not read for (.+?) \(gh could not list their runs/;

const minutes = seconds => (seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`);
const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const count = value => (Number.isInteger(value) && value >= 0 ? value : null);

// Keeps only the known shape of a finding, so nothing else a report holds is ever saved.
function cleanFinding(finding) {
  if (!finding || typeof finding !== 'object') return null;
  const facts = finding.facts || finding;
  const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(String(finding.path || finding.workflow || '')) ? String(finding.path || finding.workflow) : null;
  if (finding.code === 'speed.shards' || finding.check === 'speed.shards') {
    const job = text(facts.job);
    if (!job || !count(facts.seconds) || !count(facts.shards)) return null;
    return { code: 'speed.shards', workflow, job, seconds: facts.seconds, shards: facts.shards, tests: count(facts.tests) };
  }
  if (finding.code === 'speed.shards-lopsided' || finding.check === 'speed.shards-lopsided') {
    const slow = text(facts.slow), fast = text(facts.fast);
    if (!slow || !fast || !count(facts.slow_seconds) || !count(facts.fast_seconds)) return null;
    return { code: 'speed.shards-lopsided', workflow, slow, slow_seconds: facts.slow_seconds, fast, fast_seconds: facts.fast_seconds };
  }
  return null;
}

// What a result says, without its times or shard counts (they move a little every day): the same
// digest means the same result, so it is not shown again.
function digestOf(findings) {
  const keys = findings.map(f => (f.code === 'speed.shards' ? `${f.code}|${f.job}` : `${f.code}|${f.slow}|${f.fast}`)).sort();
  return crypto.createHash('sha256').update(JSON.stringify(keys)).digest('hex').slice(0, 16);
}

function findingText(f) {
  if (f.code === 'speed.shards') return `${f.job} took up to ${minutes(f.seconds)} with no sharding; about ${f.shards} shards would bring it near ${minutes(f.seconds / f.shards)}${f.tests !== null ? ` (${f.tests} tracked test files)` : ''}`;
  return `${f.slow} took ${minutes(f.slow_seconds)} and ${f.fast} ${minutes(f.fast_seconds)}, so its shards are lopsided`;
}

function defaultStartCheck(root) {
  const child = spawn(process.execPath, [__filename, 'check'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// { report } from the check-up, or { error } with a short reason that holds no path or output.
function defaultRunCheckup(root) {
  const result = spawnSync(process.execPath, [CHECKUP, '--repo', root, '--json'], { cwd: path.dirname(root), encoding: 'utf8', timeout: CHECKUP_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) return { error: result.error.code === 'ETIMEDOUT' ? `the check-up took over ${CHECKUP_TIMEOUT_MS / 60000} minutes` : `the check-up could not start (${String(result.error.code || 'unknown error').slice(0, 20)})` };
  if (result.status !== 0) return { error: `the check-up exited with code ${result.status === null ? `none (${result.signal || 'signal'})` : result.status}` };
  try { return { report: JSON.parse(result.stdout) }; } catch { return { error: 'the check-up printed no report' }; }
}

// The record of every repository's last check on this computer, and the decisions made from it.
class SlowCiRecord {
  #registryOptions;
  #now;
  #startCheck;
  #runCheckup;
  #identity;

  constructor({ registryOptions = {}, now = () => new Date(), environment = process.env, startCheck = null, runCheckup = defaultRunCheckup, identity = cwd => require('./toolkit-governance-state.cjs').readIdentity(cwd) } = {}) {
    this.#registryOptions = registryOptions;
    this.#now = now;
    // Offline when the given environment or this process says so, so a test that passes its own
    // environment object still starts no real check.
    const offline = [environment || {}, process.env].some(env => env.TOOLKIT_GOVERNANCE_OFFLINE === '1') || registryOptions.testOnly === true;
    this.#startCheck = startCheck || (offline ? null : defaultStartCheck);
    this.#runCheckup = runCheckup;
    this.#identity = identity;
  }

  get file() { return path.join(userStateDirectory(this.#registryOptions), BASENAME); }
  get log() { return path.join(userStateDirectory(this.#registryOptions), LOG); }
  #lock(id) { return path.join(userStateDirectory(this.#registryOptions), `slow-ci-${String(id).slice(0, 16)}.lock`); }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && parsed.schema === SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories)) return parsed;
    } catch { /* none yet, or unreadable: start empty */ }
    return { schema: SCHEMA, repositories: {} };
  }

  #write(value) {
    const file = this.file;
    const at = entry => String(entry.checked_at || entry.failed_at || '');
    const entries = Object.entries(value.repositories).sort((a, b) => at(b[1]).localeCompare(at(a[1]))).slice(0, MAX_ENTRIES);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp, `${JSON.stringify({ schema: SCHEMA, repositories: Object.fromEntries(entries) }, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { fs.rmSync(temp, { force: true }); }
  }

  // Applies `change` to one repository's entry. A change that returns the entry it was given writes
  // nothing. Throws when the record cannot be saved.
  #update(id, change) {
    const value = this.read();
    const current = Object.hasOwn(value.repositories, id) ? value.repositories[id] : null;
    const next = change(current);
    if (next === current) return current;
    if (next) value.repositories[id] = next; else delete value.repositories[id];
    this.#write(value);
    return next;
  }

  // One line per background run, the last LOG_LINES kept. A log that cannot be written is skipped.
  #logLine(name, outcome) {
    try {
      let lines = [];
      try { lines = fs.readFileSync(this.log, 'utf8').split('\n').filter(Boolean); } catch { /* a new log */ }
      lines.push(`${this.#now().toISOString()} ${name} ${text(outcome, 160)}`);
      fs.mkdirSync(path.dirname(this.log), { recursive: true });
      fs.writeFileSync(this.log, `${lines.slice(-LOG_LINES).join('\n')}\n`, { mode: 0o600 });
    } catch { /* the record still holds the reason */ }
  }

  // { root, id, name } for a checkout whose origin is on github.com, else null. Local files only.
  repositoryAt(cwd) {
    try {
      const identity = this.#identity(cwd);
      if (!identity || !identity.valid || !identity.remote || String(identity.remote.host || '').toLowerCase() !== 'github.com') return null;
      const parts = String(identity.remote.path || '').replace(/^\/+/, '').replace(/\.git$/i, '').split('/');
      if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part))) return null;
      return { root: identity.root, id: identity.repository_id, name: parts.join('/') };
    } catch { return null; }
  }

  // The line for the repository at `cwd`, given once per new result, or null; starts the daily check
  // when it is due. Returns { name, findings } where findings is the list the line names. Never throws.
  note(cwd) {
    const pending = this.peek(cwd);
    return pending && pending.markShown() ? pending.note : null;
  }

  // The same in two steps, for a caller that builds other text first: { note, markShown } when a
  // result was not shown yet (note is null for a result with no finding), else null. markShown()
  // saves it as shown and says whether this caller may give the line: false when it could not be
  // saved or another chat showed it meanwhile. Starts the daily check when it is due. Never throws.
  peek(cwd) {
    try {
      const repository = this.repositoryAt(cwd);
      if (!repository || typeof repository.id !== 'string' || !repository.id) return null;
      this.#startIfDue(repository);
      const current = this.read().repositories[repository.id] || null;
      if (!current || !Array.isArray(current.findings) || typeof current.result !== 'string' || current.result === current.shown) return null;
      const result = current.result;
      const findings = current.findings.map(cleanFinding).filter(Boolean);
      const markShown = () => {
        try {
          let marked = false;
          this.#update(repository.id, entry => {
            if (!entry || entry.result !== result || entry.shown === result) return entry;
            marked = true;
            return { ...entry, shown: result, shown_at: this.#now().toISOString() };
          });
          return marked;
        } catch { return false; }
      };
      return { note: findings.length ? { name: repository.name, findings } : null, markShown };
    } catch { return null; }
  }

  // Due a day after the last successful check; after a failed one, 1, 2, 4 ... hours after it, at
  // most a day. Started only by the chat that takes the lock.
  #startIfDue(repository) {
    if (!this.#startCheck) return;
    const now = this.#now().getTime();
    const current = this.read().repositories[repository.id] || null;
    const checked = Date.parse(current?.checked_at || '');
    if (Number.isFinite(checked) && now - checked < FRESH_MS) return;
    const failed = Date.parse(current?.failed_at || '');
    const failures = Number.isInteger(current?.failures) && current.failures > 0 ? current.failures : 0;
    if (failures && Number.isFinite(failed) && now - failed < Math.min(FRESH_MS, RETRY_MS * 2 ** (failures - 1))) return;
    if (this.#takeLock(repository.id, now)) this.#startCheck(repository.root);
  }

  // An exclusive lock file per repository, holding the time it was taken: only one chat creates it.
  #takeLock(id, now) {
    const lock = this.#lock(id);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fs.writeFileSync(lock, `${new Date(now).toISOString()}\n`, { flag: 'wx', mode: 0o600 }); return true; } catch (error) { if (error.code !== 'EEXIST') return false; }
      let taken = NaN;
      try { taken = Date.parse(fs.readFileSync(lock, 'utf8').trim()); } catch { /* removed meanwhile: try again */ }
      if (Number.isFinite(taken) && now - taken < LOCK_STALE_MS) return false;
      fs.rmSync(lock, { force: true });
    }
    return false;
  }

  // Saves a check-up report for the repository at `root`. A report that could not read job times
  // keeps the last result (a failure, with its reason); a workflow whose runs could not be listed
  // keeps its earlier findings. Returns the saved entry, or null when no result was saved.
  record(root, report) {
    const repository = this.repositoryAt(root);
    if (!repository) return null;
    if (!report || !Array.isArray(report.items)) return this.#failed(repository, 'the check-up report had no items');
    if (report.items.some(item => item && item.check === 'speed.jobs' && NOT_CHECKED.test(String(item.message || '')))) return this.#failed(repository, 'not checked: no GitHub access');
    const unread = new Set(report.items.flatMap(item => (item && item.check === 'speed.jobs' && UNREAD.test(String(item.message || '')) ? String(item.message).match(UNREAD)[1].split(', ') : [])));
    const found = report.items.filter(item => item && item.level === 'GAP').map(cleanFinding).filter(Boolean);
    const saved = this.#update(repository.id, current => {
      const kept = (Array.isArray(current?.findings) ? current.findings : []).map(cleanFinding).filter(f => f && f.workflow && unread.has(f.workflow));
      const findings = [...found, ...kept];
      const { failures, failed_at, last_error, ...rest } = current || {};
      return { ...rest, name: repository.name, checked_at: this.#now().toISOString(), findings, result: digestOf(findings) };
    });
    this.#logLine(repository.name, `ok: ${saved.findings.length} finding${saved.findings.length === 1 ? '' : 's'}${unread.size ? `, ${unread.size} workflow${unread.size === 1 ? '' : 's'} not read` : ''}`);
    return saved;
  }

  #failed(repository, reason) {
    this.#update(repository.id, current => ({ ...(current || {}), name: repository.name, failed_at: this.#now().toISOString(), failures: (Number.isInteger(current?.failures) ? current.failures : 0) + 1, last_error: text(reason, 120) }));
    this.#logLine(repository.name, `failed: ${reason}`);
    return null;
  }

  // The background check: runs the check-up on the checkout at `root`, saves its result or the reason
  // it failed, and removes the start lock.
  check(root) {
    const repository = this.repositoryAt(root);
    if (!repository) return null;
    try {
      let run;
      try { run = this.#runCheckup(root) || { error: 'the check-up gave nothing' }; } catch (error) { run = { error: `unexpected error (${String(error && error.code || 'no code').slice(0, 20)})` }; }
      return run.error ? this.#failed(repository, run.error) : this.record(root, run.report);
    } finally { fs.rmSync(this.#lock(repository.id), { force: true }); }
  }
}

// The line a session start gives the agent, which passes it on in its first reply.
function sessionStartLine(note) {
  if (!note) return null;
  return `Toolkit CI check: ${note.name}'s CI would gain from shards: ${note.findings.slice(0, MAX_SHOWN).map(findingText).join('; ')}. In your first reply, tell the user once, in one line; this repository's controller arranges or rebalances shards in its own CI (${PLAYBOOK}), or records why not with a reason in .github/ci-checkup.json. Nothing waits on it.`;
}

// The line a turn end shows the owner directly.
function turnEndLine(note) {
  if (!note) return null;
  return `Toolkit CI check: ${note.name}'s CI would gain from shards: ${note.findings.slice(0, MAX_SHOWN).map(findingText).join('; ')}. Its controller can arrange or rebalance them (${PLAYBOOK}); nothing waits on it.`;
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] !== 'check' || argv.length !== 1) return 2;
  try {
    new SlowCiRecord().check(process.cwd());
  } catch { /* the record or its folder could not be read or written: the next due start tries again */ }
  return 0;
}

module.exports = Object.freeze({ SlowCiRecord, sessionStartLine, turnEndLine });

if (require.main === module) process.exitCode = main();
