#!/usr/bin/env node
'use strict';

// The job a Toolkit Windows scheduled task runs (toolkit-windows-tasks.cjs registers it):
//   node <Toolkit checkout>/repo/scripts/toolkit-scheduled-job.cjs <job> --repo-root <checkout> --task-id <id>
//
// A fixed list of deterministic commands. It starts only node (Toolkit's own scripts) and gh, never
// a model command line, and a job that needs judgement is never one of these.
//
//   programme-sweep  cleans own origin posts first, then runs programme refresh and attention
//                    only with fresh matching enabled governance. A verified store joins cleaning.
//   footer-sweep     performs the same cleaning without programme work. Uncertain store scope
//                    retains the retry boundary; a complete batch saves scan start. Missing history
//                    starts at 48 hours; damaged/future history reports a bounded fallback.
//   task-health      checks this computer without AI or an authentication prerequisite.
//   shard-timings    preserves the general fixed Toolkit refresher: no shards yet is a quiet local
//                    skip; a valid manifest requires fresh enabled governance before any refresh.
//
// Each run writes ~/.ai-agent-toolkit/user-state/tasks/<id>/last-run.json (mode 600): started,
// finished, exit, status (ok, held, skipped, deferred, failed) and a few summary lines with anything shaped like
// a secret removed; no other command output is kept. A skipped run also keeps its reason and counts
// the skips in a row (skipped_streak, from skipped_since); the first ok or held run after them says
// "Resumed after N skipped runs since <time>" and clears both, and a failed run keeps them. The
// session-start line and `toolkit tasks` read these fields, because Task Scheduler shows every skip
// as success. Held runs are counted the same way (held_streak, held_since): an ok run clears them
// and says "Cleared after N held runs"; TASK HEALTH flags three held runs in a row. A programme
// refresh whose inventory came back incomplete is held, not ok. Exit 0 ok, held, deferred or skipped; 1 failed; 2 bad arguments.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const tasks = require('./toolkit-tasks.cjs');
const shards = require('./ci-test-shards.cjs');

const RECONCILER = path.resolve(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts');
const SCRIPT = Object.freeze({
  governance: path.join(__dirname, 'toolkit-governance.cjs'),
  programme: path.join(RECONCILER, 'programme.cjs'),
  footerSweep: path.join(__dirname, 'toolkit-github-footer-sweep.cjs'),
  shardTimings: path.join(__dirname, 'refresh-shard-timings.cjs'),
});
const JOBS = Object.freeze(['programme-sweep', 'footer-sweep', 'shard-timings', 'task-health']);
const FIRST_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000;
// Footer sweep exits that mean it ended well: nothing found, found and left, cleaned.
const SWEEP_OK = new Set([0, 3, 4]);
const MINUTE = 60 * 1000;
// Each status read allows both 5-second network limits, about 3 seconds of local
// work and 17 seconds of busy-host margin. A waiter covers the holder's two reads
// plus local observation capture. All commands/waits share one task deadline,
// leaving a minute for local bookkeeping and teardown before the native limit.
const STATUS_READ_MS = 30000;
const REFRESH_WAIT_MS = 2 * STATUS_READ_MS + 5000;
const WORK_BUDGET_MS = 55 * MINUTE;
const REFRESH_RETRY = new Set(['fetch-failed', 'cache-unwritable', 'ref-moved']);
const TIMEOUT = Object.freeze({ check: 2 * MINUTE, reach: 15 * 1000, attention: 2 * MINUTE, sweep: 12 * MINUTE, shards: 25 * MINUTE });
// The programme refresh on this computer runs in the scheduled mode with what is left of the task's
// budget once the attention step after it and the kill slack are kept back: never more than the
// scheduled budget, never less than the after-write one. It is killed that slack after its budget.
function computerRefreshBudget(remainingMs) {
  const { scheduled, 'after-write': afterWrite } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs').PASS_BUDGETS;
  const slack = scheduled.killMs - scheduled.budgetMs;
  const budgetMs = Math.max(afterWrite.budgetMs, Math.min(scheduled.budgetMs, remainingMs - TIMEOUT.attention - slack));
  return { budgetMs, killMs: budgetMs + slack };
}
// Exits 0 when a TCP connection to github.com:443 opens within 8 seconds, else 3. Sends nothing.
const REACH_GITHUB = "const s=require('node:net').connect({host:'github.com',port:443,timeout:8000});"
  + "s.on('connect',()=>{s.destroy();process.exit(0)});s.on('timeout',()=>process.exit(3));s.on('error',()=>process.exit(3));";
const USAGE = `Usage: node repo/scripts/toolkit-scheduled-job.cjs <${JOBS.join('|')}> --repo-root <checkout> --task-id <id>`;

function parseArgs(argv) {
  const [job, ...rest] = argv;
  if (!JOBS.includes(job)) throw new Error(`the job must be one of ${JOBS.join(', ')}`);
  const options = { job };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if ((arg === '--repo-root' || arg === '--task-id') && value !== undefined && !value.startsWith('--')) { options[arg === '--repo-root' ? 'repoRoot' : 'taskId'] = value; index += 1; }
    else throw new Error(`unknown or incomplete argument ${JSON.stringify(arg)}`);
  }
  if (!options.repoRoot || !path.isAbsolute(options.repoRoot)) throw new Error('--repo-root needs the checkout\'s absolute path');
  if (!tasks.ID.test(String(options.taskId || ''))) throw new Error('--task-id needs the task id');
  return options;
}

function defaultRun(file, args, { cwd, timeout }) {
  const run = spawnSync(file, args, { cwd, timeout, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: run.error ? null : run.status, stdout: run.stdout || '', stderr: run.stderr || '', error: run.error ? (run.error.code || run.error.message) : null };
}

const firstLine = (text) => String(text || '').trim().split(/\r?\n/).find(Boolean) || '';

// Fixed reasons only: neither command output nor an arbitrary refresh code becomes a skip reason.
const REFRESH_REASONS = Object.freeze({
  'fetch-failed': 'binding refresh failed: default branch fetch failed',
  'remote-unreachable': 'binding refresh failed: GitHub unreachable',
  'remote-redirected': 'binding refresh failed: origin transport refused',
  'default-branch-unknown': 'binding refresh failed: default branch unknown',
  'ref-moved': 'binding refresh failed: default branch moved',
  'hooks-unguarded': 'binding refresh failed: fetch guards unavailable',
  'commit-unreadable': 'binding refresh failed: commit unreadable',
  'tree-unreadable': 'binding refresh failed: commit unreadable',
  'blob-unreadable': 'binding refresh failed: binding unreadable',
  'cache-unwritable': 'binding refresh failed: cache unwritable',
  offline: 'binding refresh failed: governance reads offline',
  'refresh-busy': 'binding refresh failed: another checkout refresh is running',
});

function governanceReason(state) {
  if (!state || typeof state !== 'object') return 'governance status could not be read';
  if (state.merged?.status === 'invalid') return 'binding is invalid';
  if (state.merged?.status === 'foreign') return 'binding does not match origin';
  if (state.refresh?.refreshed === false) return Object.hasOwn(REFRESH_REASONS, state.refresh.reason) ? REFRESH_REASONS[state.refresh.reason] : 'binding refresh failed';
  if (!state.merged || ['unknown', 'none'].includes(state.merged.status)) return 'binding is missing';
  if (state.merged.fresh !== true) return 'binding observation expired';
  return ['ENABLED', 'DISABLED', 'UNDECIDED', 'UNAVAILABLE', 'ERROR'].includes(state.state)
    ? state.state === 'ENABLED' ? null : `governance is ${state.state}` : 'governance status could not be read';
}

function shardGovernanceOutcome(state) {
  const reason = governanceReason(state);
  if (!reason) return null;
  // A failed read never confirms an off/invalid/foreign answer, even if an older
  // cache still contains one. Unknown and expired observations remain retryable.
  const confirmed = state && state.refresh?.refreshed !== false && (['invalid', 'foreign'].includes(state.merged?.status)
    || state.merged?.fresh === true && ['DISABLED', 'UNDECIDED'].includes(state.state) && ['disabled', 'none'].includes(state.merged.status));
  return { status: confirmed ? 'skipped' : 'deferred', reason };
}

function readObservation(identity, home, now) {
  const governance = require('./toolkit-governance-state.cjs');
  const cache = require('./toolkit-governance-binding.cjs');
  return governance.judgeMerged(cache.readBindingCache(identity, path.join(home, '.ai-agent-toolkit', 'user-state')), identity, now);
}

// The last JSON object in a command's output, or null.
function lastJson(text) {
  const parts = String(text || '').split(/\n(?=\{)/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(parts[index]); } catch { /* try the one before */ }
  }
  return null;
}

// Status exits 2 only for a recognised ERROR. Diagnostic data on that route grants no effects.
function statusResult(run) {
  if (!run || run.error || ![0, 2].includes(run.status)) return null;
  try {
    const state = JSON.parse(run.stdout);
    if (!state || !['ENABLED', 'DISABLED', 'UNDECIDED', 'UNAVAILABLE', 'ERROR'].includes(state.state)
      || !state.merged || !['enabled', 'disabled', 'none', 'unknown', 'invalid', 'foreign'].includes(state.merged.status)
      || typeof state.merged.fresh !== 'boolean' || (run.status === 2) !== (state.state === 'ERROR')) return null;
    if (state.state === 'ERROR' && (state.rule !== 'M0' || state.merged.status !== 'invalid')) return null;
    if (state.state === 'ENABLED' && state.merged.status !== 'enabled') return null;
    if (state.state === 'DISABLED' && !['disabled', 'none', 'unknown', 'foreign'].includes(state.merged.status)) return null;
    if (state.state === 'UNDECIDED' && state.merged.status !== 'none') return null;
    if (state.state === 'UNAVAILABLE' && !['unknown', 'none', 'foreign'].includes(state.merged.status)) return null;
    return state;
  } catch { return null; }
}

const validTime = (value, now) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime()
  && new Date(value).toISOString() === (value.includes('.') ? value : value.replace(/Z$/, '.000Z'));

const HISTORY_NOTE = 'Footer history could not be read; scanning the last 48 hours. Older posts may need a separately authorised full-history cleanup.';
function footerLockPath(repository, home) {
  return path.join(tasks.userStateDir(home), 'tasks', `footer-${crypto.createHash('sha256').update(repository.toLowerCase()).digest('hex').slice(0, 20)}.lock`);
}

function footerCursor(record, expected, repository, now) {
  const fallback = new Date(now.getTime() - FIRST_SWEEP_WINDOW_MS).toISOString();
  if (!record) return { since: fallback };
  const identityMismatch = record.schema !== 'toolkit.task-last-run.v1' || record.id !== expected.id || record.job !== expected.job
    || (Object.hasOwn(record, 'repository') && (typeof record.repository !== 'string' || record.repository.toLowerCase() !== repository.toLowerCase()));
  // Main's valid receipts predate the cursor. Missing history is not damaged history.
  if (!identityMismatch && !Object.hasOwn(record, 'footer_sweep_since')) return { since: fallback };
  if (identityMismatch || !validTime(record.footer_sweep_since, now)) {
    const future = !identityMismatch && Number.isFinite(Date.parse(record.footer_sweep_since)) && Date.parse(record.footer_sweep_since) > now.getTime();
    return { since: fallback, note: future ? `Footer clock anomaly; scanning the last 48 hours. Older posts may need a separately authorised full-history cleanup.` : HISTORY_NOTE };
  }
  return { since: record.footer_sweep_since };
}

function localRepository(root, { run = spawnSync, stat = fs.statSync } = {}) {
  if (!stat(root).isDirectory()) throw new Error('registered root is not a repository directory');
  const result = run('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.error || result.status !== 0 || path.resolve(String(result.stdout).trim()).toLowerCase() !== path.resolve(root).toLowerCase()) throw new Error('registered root is not a repository checkout');
  return true;
}

class Job {
  #options; #run; #node; #gh; #resolveGh; #identity; #observation; #home; #now; #summary = [];
  #record; #write; #lock; #retryBoundary; #heldLock = null; #writable = true;
  #auth; #state; #observed; #readIdentity; #repository; #rootChecked = false;
  #clock; #deadline;

  constructor(options, deps = {}) {
    this.#options = options;
    this.#clock = deps.monotonicNow || (() => performance.now());
    this.#deadline = deps.deadline ?? this.#clock() + WORK_BUDGET_MS;
    this.#repository = deps.repositoryReader || localRepository;
    this.#run = deps.run || defaultRun;
    this.#node = deps.nodePath || process.execPath;
    this.#gh = deps.ghPath === undefined ? null : deps.ghPath;
    this.#resolveGh = deps.resolveGh || (() => require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs').resolveExecutable('gh', { cwd: this.#options.repoRoot }));
    this.#identity = deps.readIdentity || (root => require('./toolkit-governance-state.cjs').readIdentity(root));
    this.#observation = deps.readObservation || readObservation;
    this.#home = deps.home || os.homedir();
    this.#now = deps.now || (() => new Date());
    this.#record = deps.readRecord || (id => tasks.readLastRun(id, this.#home) || (fs.existsSync(tasks.lastRunPath(id, this.#home)) ? {} : null));
    this.#write = deps.writeRecord || ((id, record) => tasks.writeLastRun(id, record, this.#home));
    this.#lock = deps.takeLock || require('../../skills/github-program-reconciler/scripts/programme-lock.cjs').takeLock;
  }

  get options() { return this.#options; }
  note(line) { this.#summary.push(tasks.safeText(line)); }
  get summary() { return [...this.#summary]; }

  get deadline() { return this.#deadline; }
  remainingMs() { return Math.max(0, Math.floor(this.#deadline - this.#clock())); }
  budget(timeout) {
    const remaining = this.remainingMs();
    if (remaining <= 0) throw new Error('Task time budget exhausted; retry at the next eligible task slot.');
    return Math.min(timeout, remaining);
  }
  #exec(file, args, timeout) { return this.#run(file, args, { cwd: this.#options.repoRoot, timeout: this.budget(timeout) }); }
  node(script, args, timeout) { return this.#exec(this.#node, [script, ...args], timeout); }

  // gh resolved to a full path from PATH, never from the checkout folder.
  ghPath() {
    if (this.#gh) return this.#gh;
    this.#gh = this.#resolveGh();
    return this.#gh;
  }

  // null when gh is signed in, else the reason. `gh auth status` checks the token online, so a
  // failure is "offline" when github.com cannot be reached at all.
  ghSignedOut() {
    if (this.#auth !== undefined) return this.#auth;
    return (this.#auth = this.checkAuth());
  }

  checkAuth() {
    let gh;
    try { gh = this.ghPath(); } catch { return 'gh is not installed'; }
    const result = this.#exec(gh, ['auth', 'status'], TIMEOUT.check);
    if (!result.error && result.status === 0) return null;
    // Only gh's explicit no-host answer proves sign-out. A bad token, timeout or
    // uncertain read must remain retryable; reachability cannot prove authentication.
    if (!result.error && result.status === 1 && /^You are not logged into any GitHub hosts\./m.test(result.stderr || '')) return 'gh not signed in';
    if (!result.error && result.status !== null && this.node('-e', [REACH_GITHUB], TIMEOUT.reach).status === 3) return 'offline';
    return 'GitHub authentication status could not be read';
  }

  repository() {
    if (!this.#rootChecked) {
      if (this.#repository(this.#options.repoRoot) !== true) throw new Error('registered root is not a repository checkout');
      this.#rootChecked = true;
    }
    return true;
  }

  notGoverned() { return governanceReason(this.governanceStatus()); }

  governanceStatus() {
    if (this.#state === undefined) {
      let lock;
      try {
        lock = new (require('./toolkit-programme-lock.cjs').ProgrammeJobLock)({ home: this.#home,
          key: `checkout-refresh:${path.resolve(this.#options.repoRoot)}`, waitMs: this.budget(REFRESH_WAIT_MS), log: line => this.note(line) }).take();
        if (!lock) this.#state = { state: 'UNAVAILABLE', merged: { status: 'unknown', fresh: false }, refresh: { refreshed: false, reason: 'refresh-busy' } };
        else {
          const read = () => {
            try { return statusResult(this.node(SCRIPT.governance, ['status', '--json'], STATUS_READ_MS)); }
            catch { return null; }
          };
          this.#state = read();
          // One retry handles a competing non-task reader or a transient fetch/cache
          // failure. Each attempt gets its own complete read budget, within the
          // task deadline. An unreadable retry cannot erase the first failure.
          if (REFRESH_RETRY.has(this.#state?.refresh?.reason)) {
            const retry = read();
            if (retry) this.#state = retry;
            else this.note('Governance status retry could not be read; keeping the first refresh failure for an eligible retry.');
          }
          // Freeze the observation under the refresh lock. Both the writer key and
          // every effect use this exact refreshed view, even if a later reader moves it.
          this.#observed = this.observe(this.identity());
        }
      }
      catch { this.#state = null; }
      finally { if (lock) lock.release(); }
    }
    return this.#state;
  }

  identity() {
    if (this.#readIdentity === undefined) {
      try { this.#readIdentity = this.#identity(this.#options.repoRoot) || null; } catch { this.#readIdentity = null; }
    }
    return this.#readIdentity;
  }

  // Validate the same cached observation that supplies the store, independently of the status
  // command. mergedBinding() alone can return stale data and cannot grant store effects.
  observation(identity) {
    if (this.#observed === undefined) this.#observed = this.observe(identity);
    return this.#observed;
  }

  observe(identity) {
    try {
      const observed = this.#observation(identity, this.#home, this.now());
      if (['enabled', 'disabled'].includes(observed?.status)) {
        // judgeMerged returns validateBinding's normalized v2 view, which adds three derived
        // v1 fields. Validate its source shape; those derived fields never grant target scope.
        let binding = observed.binding;
        if (binding?.schema === 'toolkit.programme-binding.v2') {
          const { parent_issue, record_prefix, writer_prefix, ...source } = binding;
          binding = source;
        }
        if (require('./toolkit-governance-state.cjs').bindingProblems(binding, identity).length) return { status: 'invalid', fresh: false };
      }
      return observed || null;
    } catch { return null; }
  }
  now() { return this.#now(); }

  get retryBoundary() { return this.#retryBoundary; }
  readRecord() { return this.#record(this.#options.taskId); }
  writeRecord(record) { if (this.#writable) this.#write(this.#options.taskId, record); }
  release() {
    if (!this.#heldLock) return true;
    try { this.#heldLock.release(); return true; }
    catch { this.note('Footer lock release failed; inspect the local lock before retrying.'); return false; }
  }

  clean(base) {
    this.repository();
    const repository = require('./toolkit-windows-tasks.cjs').repositoryOf(this.identity());
    if (!repository) return { status: 'skipped', reason: 'no usable github.com origin repository' };
    const file = footerLockPath(repository, this.#home);
    let since;
    try {
      this.#heldLock = this.#lock(file);
      if (!this.#heldLock) {
        this.#writable = false; // Do not overwrite the active cleaner's record.
        this.note('Footer cleaning held: another footer pass is running.');
        return { status: 'held', footer_status: 'locked' };
      }
      // Read inside the lock, before the start record overwrites the last retry boundary.
      const previous = this.readRecord();
      const selected = footerCursor(previous, base, repository, this.now());
      since = selected.since;
      this.#retryBoundary = since;
      if (selected.note) this.note(selected.note);
      const carried = { footer_sweep_since: selected.since };
      this.writeRecord({ ...base, status: 'running', finished: null, exit: null, summary: [], ...carried, ...skipStreak(previous) });
      return { ...carried, ...footerSweep(this, selected.since) };
    } catch {
      this.note('Footer sweep stopped; the next run retains the retry window.');
      return { status: 'failed', ...(since ? { footer_sweep_since: since } : {}) };
    }
  }

}

// Refresh status: ok|held|skipped|failed.
function refreshStep(job) {
  const { budgetMs, killMs } = computerRefreshBudget(job.remainingMs());
  const run = job.node(SCRIPT.programme, ['refresh', '--repo-root', job.options.repoRoot, '--scheduled', '--budget-ms', String(budgetMs), '--json'], killMs);
  const report = lastJson(run.stdout);
  if (run.status === 2 && /^PARENT_STATE_MISSING: /.test(String(run.stderr || ''))
    || run.status === 1 && report?.holds?.length && report.holds.every(hold => hold.code === 'PARENT_STATE_MISSING')) {
    return 'skipped';
  }
  const lifecycle = report?.results?.filter(entry => ['set_parent_state', 'post_parent_repair'].includes(entry.kind)) || [];
  for (const entry of lifecycle) job.note(`Parent lifecycle: ${entry.kind === 'set_parent_state' ? entry.target.state === 'open' ? 'reopen' : 'complete' : 'repair notice'} ${entry.outcome}.`);
  if (run.status === 0) {
    if (report?.outcome === 'QUEUED') {
      job.note('Programme refresh queued: another pass is already running.');
      return 'held';
    }
    // An incomplete inventory is not a finished pass: it holds, so held runs in a row are counted.
    if (report && report.inventory && report.inventory.complete === false) {
      job.note('Programme refresh held: the inventory is incomplete; the next run reads it again.');
      return 'held';
    }
    job.note('Programme refresh: done.');
    return 'ok';
  }
  if (run.status === 1) {
    const holds = report && Array.isArray(report.holds) ? report.holds.map(hold => `${hold.code} ${hold.target || ''}`.trim()) : [];
    job.note(`Programme refresh held: ${holds.join(', ') || firstLine(run.stderr) || 'see the next run'}.`);
    return 'held';
  }
  job.note(`Programme refresh failed (exit ${run.status === null ? `none, ${run.error || 'stopped'}` : run.status}): ${firstLine(run.stderr) || firstLine(run.stdout) || 'no output'}.`);
  return 'failed';
}

function attentionStep(job) {
  const run = job.node(SCRIPT.programme, ['attention', '--repo-root', job.options.repoRoot, '--json'], TIMEOUT.attention);
  const result = lastJson(run.stdout);
  const line = result && (result.text || result.line);
  job.note(line ? String(line) : `Attention: unknown (${firstLine(run.stderr) || 'no output'})`);
  return run.status === 0 ? 'ok' : 'held';
}

// { status, since } where since is the new watermark when the complete batch ended well.
function sweepStep(job, repos, since) {
  const started = job.now().toISOString();
  const run = job.node(SCRIPT.footerSweep, [...repos.flatMap(repo => ['--repo', repo]), '--since', since, '--apply', '--json'], TIMEOUT.sweep);
  const report = lastJson(run.stdout);
  const counts = {};
  for (const row of (report && Array.isArray(report.results) ? report.results : [])) counts[row.status] = (counts[row.status] || 0) + 1;
  if (report?.results?.some(row => row.reason === 'repository-identity-mismatch')) job.note('Footer repository identity did not match origin; check for a renamed repository or stale origin.');
  const text = Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(', ') || 'no posts with the footer';
  if (SWEEP_OK.has(run.status)) {
    job.note(`Footer sweep since ${since.slice(0, 16).replace('T', ' ')}: ${text}.`);
    return { status: 'ok', since: started };
  }
  job.note(`Footer sweep failed (exit ${run.status === null ? `none, ${run.error || 'stopped'}` : run.status}): ${run.status === 1 ? text : firstLine(run.stderr) || 'no output'}; the next run tries again from the same time.`);
  return { status: 'failed', since: null };
}

function programmeSweep(job) {
  job.repository();
  const identity = job.identity();
  if (!require('./toolkit-windows-tasks.cjs').repositoryOf(identity)) return { status: 'skipped', reason: 'no usable github.com origin repository' };
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: signedOut === 'GitHub authentication status could not be read' ? 'deferred' : 'skipped', reason: signedOut };
  const notGoverned = governanceReason(job.governanceStatus());
  if (notGoverned) return { status: 'skipped', reason: notGoverned };
  const observed = job.observation(identity);
  if (!observed) return { status: 'skipped', reason: 'binding is missing' };
  if (observed.status !== 'enabled') return { status: 'skipped', reason: 'binding is invalid' };
  if (observed.fresh !== true) return { status: 'skipped', reason: 'binding observation expired' };
  const refresh = refreshStep(job);
  if (refresh === 'skipped') return { status: 'skipped', reason: 'ask the appointed controller to initialise the parent state in the private evidence store' };
  const attention = attentionStep(job);
  return { status: refresh === 'failed' ? 'failed' : refresh === 'held' || attention === 'held' ? 'held' : 'ok' };
}

function footerSweep(job, watermark) {
  const identity = job.identity();
  const repository = require('./toolkit-windows-tasks.cjs').repositoryOf(identity);
  if (!repository) return { status: 'skipped', reason: 'no usable github.com origin repository' };
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: signedOut === 'GitHub authentication status could not be read' ? 'deferred' : 'skipped', reason: signedOut };
  const state = job.governanceStatus();
  const observation = job.observation(identity);
  const reason = governanceReason(state);
  const verified = !reason && state.merged.status === 'enabled' && observation?.status === 'enabled' && observation.fresh === true;
  // A fresh off/absent decision proves there is no eligible store. All uncertain relationships
  // keep the shared window, including an unreadable status with no usable cached observation.
  const noStore = ['DISABLED', 'UNDECIDED'].includes(state?.state) && state?.merged?.fresh === true && state.refresh?.refreshed !== false
    && observation?.fresh === true && state.merged.status === observation.status && ['disabled', 'none'].includes(observation.status);
  const repos = [repository];
  if (verified) {
    const store = observation.binding.store.repository;
    if (store.toLowerCase() !== repository.toLowerCase()) repos.push(store);
  } else if (!noStore) job.note(`Evidence store cleaning withheld: ${reason || 'binding could not be verified'}; the retry window is retained.`);
  const sweep = sweepStep(job, repos, watermark);
  return { ...(reason && !noStore ? { reason } : {}), status: sweep.status === 'failed' ? 'failed' : verified || noStore ? 'ok' : 'held',
    footer_sweep_since: (verified || noStore) && sweep.since || watermark };
}

function shardTimings(job) {
  if (job.repository() !== true) throw new Error('registered root is not a repository checkout');
  let manifest;
  try { manifest = shards.loadManifest(job.options.repoRoot); }
  catch (error) {
    if (error.code === 'ENOENT') return { status: 'skipped', reason: 'no shards yet' };
    throw error;
  }
  shards.assertManifest(manifest, shards.discoverTestFiles(job.options.repoRoot));
  const notGoverned = shardGovernanceOutcome(job.governanceStatus());
  if (notGoverned) return notGoverned;
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: signedOut === 'gh not signed in' ? 'skipped' : 'deferred', reason: signedOut };
  const run = job.node(SCRIPT.shardTimings, ['--repo-root', job.options.repoRoot, '--open-pr'], TIMEOUT.shards);
  const lines = String(run.stdout || '').split(/\r?\n/).filter(Boolean).slice(-3);
  for (const line of lines) job.note(line);
  if (run.status === 0) return { status: 'ok' };
  job.note(`Shard timings failed (exit ${run.status === null ? `none, ${run.error || 'stopped'}` : run.status}): ${firstLine(run.stderr) || 'no output'}.`);
  return { status: 'failed' };
}

// The skips in a row so far, from the previous record: { skipped_streak, skipped_since } or {}.
function skipStreak(previous) {
  if (previous?.reason === 'no shards yet') return {};
  const count = previous && Number.isInteger(previous.skipped_streak) && previous.skipped_streak > 0 ? previous.skipped_streak : 0;
  const since = previous && typeof previous.skipped_since === 'string' && !Number.isNaN(Date.parse(previous.skipped_since)) ? previous.skipped_since : null;
  return count && since ? { skipped_streak: count, skipped_since: since } : {};
}

// The held runs in a row so far, from the previous record: { held_streak, held_since } or {}.
function heldStreak(previous) {
  const count = previous && Number.isInteger(previous.held_streak) && previous.held_streak > 0 ? previous.held_streak : 0;
  const since = previous && typeof previous.held_since === 'string' && !Number.isNaN(Date.parse(previous.held_since)) ? previous.held_since : null;
  return count && since ? { held_streak: count, held_since: since } : {};
}

function deferral(previous, at, key) {
  const since = validTime(previous?.deferred_since, new Date(at)) ? previous.deferred_since : at;
  const count = Number.isSafeInteger(previous?.deferred_count) && previous.deferred_count > 0 ? previous.deferred_count : 0;
  return { deferred_since: since, deferred_count: count + 1, ...(key ? { deferred_lock_key: key } : {}) };
}

function runJob(options, deps = {}) {
  if (options.job === 'task-health') return require('./toolkit-task-health.cjs').runHealthJob({ ...deps, taskId: options.taskId });
  const job = new Job(options, deps);
  const registry = (deps.registry || tasks).readRegistry(deps.home || os.homedir());
  const enrolled = registry.status === 'ok' && registry.tasks.find(entry => entry.id === options.taskId && entry.host === 'windows');
  let lock, record, key, canRetry = true;
  const home = deps.home || os.homedir();
  const finishWithoutWork = (status, reason) => {
    const at = job.now().toISOString(), previous = job.readRecord();
    const history = previous?.schema === 'toolkit.task-last-run.v1' && previous.id === options.taskId && previous.job === options.job ? previous : null;
    const result = { ...skipStreak(history),
      ...(typeof history?.footer_sweep_since === 'string' && Number.isFinite(Date.parse(history.footer_sweep_since)) ? { footer_sweep_since: history.footer_sweep_since } : {}),
      schema: 'toolkit.task-last-run.v1', id: options.taskId, job: options.job,
      ...(enrolled?.repository ? { repository: enrolled.repository } : {}), started: at, finished: at,
      status, exit: status === 'failed' ? 1 : 0, reason, summary: [...job.summary, reason] };
    if (status === 'deferred') Object.assign(result, deferral(history, at, key));
    job.writeRecord(result);
    return result;
  };
  try {
    if (!tasks.localTaskOwner(enrolled?.job_owner, deps.computerId || tasks.computerIdentity(home)?.id)) {
      return finishWithoutWork('skipped', `scheduled jobs are owned by another computer; ${tasks.OWNER_RECOVERY}`);
    }
    try { job.repository(); }
    catch { return finishWithoutWork('failed', 'registered root is not a repository checkout'); }
    const identity = job.identity();
    const repository = require('./toolkit-windows-tasks.cjs').repositoryOf(identity);
    // status refreshes the cached binding. Never memoize an observation (or choose
    // its store lock) until that refresh has completed. Sign-out still does no reads.
    if (repository && !job.ghSignedOut()) job.governanceStatus();
    const observed = repository && !job.ghSignedOut() ? job.observation(identity) : null;
    key = observed?.fresh === true && observed?.status === 'enabled' && observed?.binding?.store?.repository || repository || options.repoRoot;
    if (job.remainingMs() <= 0) return finishWithoutWork('deferred', repository && !job.ghSignedOut() && job.notGoverned() || 'task time budget exhausted');
    lock = deps.takeProgrammeLock ? deps.takeProgrammeLock(key) : new (require('./toolkit-programme-lock.cjs').ProgrammeJobLock)({ home, key, log: line => job.note(line), waitMs: job.budget(1000) }).take();
    if (!lock) return finishWithoutWork('deferred', `Programme work deferred: another job owns the lock; retries at the next hourly ${options.job === 'shard-timings' ? 'programme sweep before the next weekly slot' : 'task slot'}.`);
    record = runJobLocked(job, options, deps, key);
  } catch {
    canRetry = false;
    const reason = 'Programme job or lock failed; inspect local task state and retry the task.';
    job.note(reason);
    record = finishWithoutWork('failed', reason);
  } finally {
    if (lock) {
      try { lock.release(); }
      catch {
        const reason = 'Programme lock release failed; inspect the local lock before retrying.';
        job.note(reason);
        record = finishWithoutWork('failed', reason);
      }
    }
  }
  // Native starts happen only after all writer locks are released. Each task then
  // gets its own time budget; no work or retry loop runs inside the releasing job.
  if (canRetry && record?.status !== 'deferred') retryDeferredJobs(job, options, deps, key);
  if (record && JSON.stringify(record.summary) !== JSON.stringify(job.summary)) {
    record.summary = job.summary;
    job.writeRecord(record);
  }
  return record;
}

function retryDeferredJobs(job, options, deps, key) {
  const home = deps.home || os.homedir(), windows = require('./toolkit-windows-tasks.cjs');
  try {
    const repository = windows.repositoryOf(job.identity());
    if (!repository) return;
    const registry = (deps.registry || tasks).readRegistry(home);
    if (registry.status !== 'ok') return;
    const deferred = registry.tasks.filter(entry => entry.id !== options.taskId && entry.host === 'windows' && JOBS.includes(entry.job)
      && !entry.adopted && !entry.stopped_by_owner && tasks.readLastRun(entry.id, home)?.status === 'deferred');
    if (!deferred.length) return;
    if (job.ghSignedOut()) return;
    const state = job.governanceStatus();
    const observed = job.observation(job.identity());
    if (governanceReason(state) || observed?.fresh !== true || observed.status !== 'enabled'
      || observed.binding.store.repository.toLowerCase() !== key.toLowerCase()) return;
    for (const entry of deferred) {
      if (job.remainingMs() <= 0) break;
      if (entry.id === options.taskId || entry.host !== 'windows' || !JOBS.includes(entry.job) || entry.adopted || entry.stopped_by_owner
        || !tasks.localTaskOwner(entry.job_owner, deps.computerId || tasks.computerIdentity(home)?.id)) continue;
      const previous = tasks.readLastRun(entry.id, home);
      if (previous?.status !== 'deferred') continue;
      const sameRepository = String(entry.repository).toLowerCase() === repository.toLowerCase();
      if (sameRepository && !windows.samePath(entry.checkout, options.repoRoot)) continue;
      // Legacy shard deferrals have no stored key. They may retry only from their
      // own verified repository/checkout; other repositories must name this store.
      if (previous.deferred_lock_key ? !sameRepository && String(previous.deferred_lock_key).toLowerCase() !== key.toLowerCase()
        : !sameRepository || entry.job !== 'shard-timings') continue;
      try {
        const scheduler = deps.scheduler || windows.powerShellScheduler({ run: (file, args, opts) =>
          spawnSync(file, args, { ...opts, timeout: job.budget(opts.timeout) }) });
        const eligible = () => {
          const current = (deps.registry || tasks).readRegistry(home);
          if (current.status !== 'ok' || JSON.stringify(current.tasks.find(row => row.id === entry.id)) !== JSON.stringify(entry)) return false;
          const live = scheduler.list(entry.folder).find(task => task.name === entry.name);
          return live && !['Disabled', 'Running'].includes(live.state) && windows.parseMarker(live.description)?.id === entry.id
            && entry.enrolled && JSON.stringify(windows.enrolledDefinition(live)) === JSON.stringify(entry.enrolled);
        };
        if (!eligible()) continue;
        if (!sameRepository) {
          const candidate = new Job({ job: entry.job, taskId: entry.id, repoRoot: entry.checkout }, { ...deps, deadline: job.deadline });
          candidate.repository();
          if (windows.repositoryOf(candidate.identity())?.toLowerCase() !== String(entry.repository).toLowerCase()
            || candidate.ghSignedOut() || candidate.notGoverned()) continue;
          const refreshed = candidate.observation(candidate.identity());
          if (refreshed?.fresh !== true || refreshed.status !== 'enabled' || refreshed.binding.store.repository.toLowerCase() !== key.toLowerCase()) continue;
        }
        // Status may take seconds. Owner stops or native edits during that read win.
        if (!eligible() || tasks.readLastRun(entry.id, home)?.status !== 'deferred') continue;
        scheduler.start(entry.folder, entry.name);
      } catch { job.note(`Deferred job retry could not start for ${entry.repository} (${entry.name}); inspect toolkit tasks. Eligible tasks can retry after a store release or at their next task slot.`); }
    }
  } catch { job.note('Deferred job retry could not start; inspect toolkit tasks.'); }
}

function runJobLocked(job, options, deps, key) {
  const previous = job.readRecord();
  const started = job.now().toISOString();
  // The retry boundary is persisted before processes start, under the footer lock.
  const carried = previous?.schema === 'toolkit.task-last-run.v1' && previous.id === options.taskId && previous.job === options.job
    && typeof previous.footer_sweep_since === 'string' && !Number.isNaN(Date.parse(previous.footer_sweep_since))
    ? { footer_sweep_since: previous.footer_sweep_since }
    : {};
  const streak = skipStreak(previous);
  const held = heldStreak(previous);
  const repository = require('./toolkit-windows-tasks.cjs').repositoryOf(job.identity());
  const base = { schema: 'toolkit.task-last-run.v1', id: options.taskId, job: options.job, started,
    ...(repository ? { repository } : previous && Object.hasOwn(previous, 'repository') ? { repository: previous.repository } : {}) };
  if (options.job === 'shard-timings') job.writeRecord({ ...base, finished: null, exit: null, status: 'running', summary: [], ...streak });
  let outcome;
  try {
    if (options.job === 'programme-sweep') {
      const footer = job.clean(base);
      let programme;
      try { programme = programmeSweep(job); }
      catch { job.note('Programme work stopped; see the next run.'); programme = { status: 'failed' }; }
      const status = [footer.status, programme.status].includes('failed') ? 'failed'
        : [footer.status, programme.status].includes('deferred') ? 'deferred' : programme.status === 'ok' ? footer.status === 'ok' ? 'ok' : 'held' : programme.status;
      outcome = { ...footer, status, footer_status: footer.status, programme_status: programme.status,
        ...(footer.reason ? { footer_reason: footer.reason } : {}),
        ...(programme.reason ? { programme_reason: programme.reason } : {}),
        ...(['skipped', 'deferred'].includes(status) ? { reason: footer.reason || programme.reason } : {}) };
      if (programme.reason && programme.reason !== footer.reason && programme.reason !== outcome.reason) job.note(`Programme work skipped: ${programme.reason}.`);
    } else outcome = options.job === 'footer-sweep' ? job.clean(base) : shardTimings(job);
  }
  catch (error) { job.note(`The job stopped: ${error.message}`); outcome = { status: 'failed' }; }
  if (outcome.reason) job.note(`${outcome.status}: ${outcome.reason}`);
  let skips = {};
  if (outcome.status === 'skipped' && outcome.reason !== 'no shards yet') {
    skips = { reason: outcome.reason, skipped_streak: (streak.skipped_streak || 0) + 1, skipped_since: streak.skipped_since || started };
  } else if (['failed', 'deferred'].includes(outcome.status)) skips = streak;
  else if (['ok', 'held'].includes(outcome.status) && streak.skipped_streak) {
    job.note(`Resumed after ${streak.skipped_streak} skipped run${streak.skipped_streak === 1 ? '' : 's'} since ${streak.skipped_since.slice(0, 16).replace('T', ' ')} UTC.`);
  }
  // Held runs are counted like skips: an ok run clears the count; any other result keeps it.
  let holds = {};
  if (outcome.status === 'held') holds = { held_streak: (held.held_streak || 0) + 1, held_since: held.held_since || started };
  else if (outcome.status === 'ok' && held.held_streak) job.note(`Cleared after ${held.held_streak} held run${held.held_streak === 1 ? '' : 's'} since ${held.held_since.slice(0, 16).replace('T', ' ')} UTC.`);
  else if (outcome.status !== 'ok') holds = held;
  const exit = outcome.status === 'failed' ? 1 : 0;
  const record = { ...base, finished: job.now().toISOString(), exit, status: outcome.status, summary: job.summary, ...carried, ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...Object.fromEntries(['footer_status', 'programme_status', 'footer_reason', 'programme_reason'].filter(key => outcome[key] !== undefined).map(key => [key, outcome[key]])),
    ...(outcome.footer_sweep_since ? { footer_sweep_since: outcome.footer_sweep_since } : {}),
    ...(outcome.status === 'deferred' ? deferral(previous, started, key) : {}), ...skips, ...holds };
  try { job.writeRecord(record); }
  finally {
    if (!job.release()) {
      record.status = 'failed'; record.exit = 1; record.summary = job.summary;
      if (job.retryBoundary) record.footer_sweep_since = job.retryBoundary;
      job.writeRecord(record);
    }
  }
  return record;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const err = deps.stderr || (text => process.stderr.write(text));
  const out = deps.stdout || (text => process.stdout.write(text));
  let options;
  try { options = parseArgs(argv); }
  catch (error) { err(`${error.message}\n${USAGE}\n`); return 2; }
  const record = runJob(options, deps);
  out(`${record.status}: ${record.summary.join(' | ')}\n`);
  return record.exit;
}

module.exports = { JOBS, SCRIPT, SWEEP_OK, WORK_BUDGET_MS, computerRefreshBudget, parseArgs, runJob, main, lastJson, localRepository, footerCursor, footerLockPath, HISTORY_NOTE };

// Retired: Toolkit no longer runs scheduled tasks on a computer (the cloud runs these jobs). A
// task an older setup registered still starts this file; it prints one line and exits 0, with no
// writes, no GitHub request and no window. `remove toolkit` lists and removes such tasks.
const RETIRED_LINE = 'This Toolkit scheduled task is retired: the cloud runs this job now. Say "remove toolkit" to list and remove old Toolkit tasks on this computer.';
if (require.main === module) { process.stdout.write(`${RETIRED_LINE}\n`); process.exitCode = 0; }
