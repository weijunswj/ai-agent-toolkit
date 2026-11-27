#!/usr/bin/env node
'use strict';

// The daily slow-CI line: tells the owner once when a repository's CI would gain from shards, or its
// shards are lopsided, wherever they are first after a new result (owner decision INT-TK421-1393).
//
// - A record per repository on this computer (user state, slow-ci.v1.json) keeps when CI was last
//   checked, the last result and which result was last shown. It holds repository ids and names, the
//   finding codes, job names, times and counts only.
// - A session start or a turn end only reads that record (local files, no git, gh or network): it
//   gives the line when the last result has a finding and differs from the one last shown, and it
//   saves the result as shown before it returns the line, so a line is never given twice; a record
//   that cannot be saved gives no line. A result with no finding is saved as shown with no line, so
//   the same finding coming back later is new again.
// - When the last successful check is a day old it starts the check in a background process and never
//   waits for it; the start is claimed in the record first, so chats starting together start one.
//   A check that could not read GitHub keeps the last result and is tried again an hour after it began.
//   Offline and test runs (TOOLKIT_GOVERNANCE_OFFLINE=1) start no check unless one is given.
// - The check runs the CI check-up (skills/secure-ci-cd/scripts/ci-checkup.cjs) as its own process and
//   keeps its speed.shards and speed.shards-lopsided findings.
// The calling hook decides where the line goes and in which sessions it runs; this file holds no host
// detail. Only repositories with a github.com origin are checked. Any failure gives no line.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { userStateDirectory } = require('./toolkit-user-state.cjs');

const SCHEMA = 'toolkit.slow-ci.v1';
const BASENAME = 'slow-ci.v1.json';
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 32;
const MAX_SHOWN = 3;
const CHECKUP = path.join(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'ci-checkup.cjs');
// The check-up reads each workflow's newest runs through gh; a large repository takes minutes.
const CHECKUP_TIMEOUT_MS = 15 * 60 * 1000;
const PLAYBOOK = 'fast-tests-and-sharding playbook, section Arrange Shards In This Repository\'s CI';
const NOT_CHECKED = /job times not checked/;

const minutes = seconds => (seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`);
const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const count = value => (Number.isInteger(value) && value >= 0 ? value : null);

// Keeps only the known shape of a finding, so nothing else a report holds is ever saved.
function cleanFinding(finding) {
  if (!finding || typeof finding !== 'object') return null;
  const facts = finding.facts || finding;
  if (finding.code === 'speed.shards' || finding.check === 'speed.shards') {
    const job = text(facts.job);
    if (!job || !count(facts.seconds) || !count(facts.shards)) return null;
    return { code: 'speed.shards', job, seconds: facts.seconds, shards: facts.shards, tests: count(facts.tests) };
  }
  if (finding.code === 'speed.shards-lopsided' || finding.check === 'speed.shards-lopsided') {
    const slow = text(facts.slow), fast = text(facts.fast);
    if (!slow || !fast || !count(facts.slow_seconds) || !count(facts.fast_seconds)) return null;
    return { code: 'speed.shards-lopsided', slow, slow_seconds: facts.slow_seconds, fast, fast_seconds: facts.fast_seconds };
  }
  return null;
}

// What a result says, without its times (they move a little every day): the same digest means the
// same result, so it is not shown again.
function digestOf(findings) {
  const keys = findings.map(f => (f.code === 'speed.shards' ? `${f.code}|${f.job}|${f.shards}` : `${f.code}|${f.slow}|${f.fast}`)).sort();
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

function defaultRunCheckup(root) {
  const result = spawnSync(process.execPath, [CHECKUP, '--repo', root, '--json'], { cwd: path.dirname(root), encoding: 'utf8', timeout: CHECKUP_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
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

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && parsed.schema === SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories)) return parsed;
    } catch { /* none yet, or unreadable: start empty */ }
    return { schema: SCHEMA, repositories: {} };
  }

  #write(value) {
    const file = this.file;
    const at = entry => String(entry.checked_at || entry.started_at || '');
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

  #startIfDue(repository) {
    if (!this.#startCheck) return;
    const now = this.#now().getTime();
    let claimed = false;
    this.#update(repository.id, current => {
      const checked = Date.parse(current?.checked_at || '');
      const started = Date.parse(current?.started_at || '');
      if (Number.isFinite(checked) && now - checked < FRESH_MS) return current;
      if (Number.isFinite(started) && now - started < RETRY_MS) return current;
      claimed = true;
      return { ...(current || {}), name: repository.name, started_at: new Date(now).toISOString() };
    });
    if (claimed) this.#startCheck(repository.root);
  }

  // Saves a check-up report for the repository at `root`. A report that could not read job times
  // keeps the last result. Returns the saved entry, or null when nothing was saved.
  record(root, report) {
    const repository = this.repositoryAt(root);
    if (!repository || !report || !Array.isArray(report.items)) return null;
    if (report.items.some(item => item && item.check === 'speed.jobs' && NOT_CHECKED.test(String(item.message || '')))) return null;
    const findings = report.items.filter(item => item && item.level === 'GAP').map(cleanFinding).filter(Boolean);
    return this.#update(repository.id, current => ({ ...(current || {}), name: repository.name, checked_at: this.#now().toISOString(), findings, result: digestOf(findings) }));
  }

  // The background check: runs the check-up on the checkout at `root` and saves its result.
  check(root) {
    const report = this.#runCheckup(root);
    return report ? this.record(root, report) : null;
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
  } catch { /* the next due session start or turn end tries again */ }
  return 0;
}

module.exports = Object.freeze({ SCHEMA, BASENAME, FRESH_MS, RETRY_MS, SlowCiRecord, sessionStartLine, turnEndLine });

if (require.main === module) process.exitCode = main();
