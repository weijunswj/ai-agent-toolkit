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
//   shard-timings    preserves the general fixed Toolkit refresher: no shards yet is a quiet local
//                    skip; a valid manifest requires fresh enabled governance before any refresh.
//
// Each run writes ~/.ai-agent-toolkit/user-state/tasks/<id>/last-run.json (mode 600): started,
// finished, exit, status (ok, held, skipped, deferred, failed) and a few summary lines with anything shaped like
// a secret removed; no other command output is kept. A skipped run also keeps its reason and counts
// the skips in a row (skipped_streak, from skipped_since); the first ok or held run after them says
// "Resumed after N skipped runs since <time>" and clears both, and a failed run keeps them. The
// session-start line and `toolkit tasks` read these fields, because Task Scheduler shows every skip
// as success. Exit 0 ok, held, deferred or skipped; 1 failed; 2 bad arguments.

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
const JOBS = Object.freeze(['programme-sweep', 'footer-sweep', 'shard-timings']);
const FIRST_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000;
// Footer sweep exits that mean it ended well: nothing found, found and left, cleaned.
const SWEEP_OK = new Set([0, 3, 4]);
const MINUTE = 60 * 1000;
const TIMEOUT = Object.freeze({ check: 2 * MINUTE, reach: 15 * 1000, refresh: 12 * MINUTE, attention: 2 * MINUTE, sweep: 12 * MINUTE, shards: 25 * MINUTE });
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

  constructor(options, deps = {}) {
    this.#options = options;
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

  #exec(file, args, timeout) { return this.#run(file, args, { cwd: this.#options.repoRoot, timeout }); }
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
    if (this.#exec(gh, ['auth', 'status'], TIMEOUT.check).status === 0) return null;
    return this.node('-e', [REACH_GITHUB], TIMEOUT.reach).status === 0 ? 'gh not signed in' : 'offline';
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
      try { this.#state = statusResult(this.node(SCRIPT.governance, ['status', '--json'], TIMEOUT.check)); }
      catch { this.#state = null; }
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

// Step 1 and 2: { status: ok|held|failed }.
function refreshStep(job) {
  const run = job.node(SCRIPT.programme, ['refresh', '--repo-root', job.options.repoRoot, '--json'], TIMEOUT.refresh);
  const report = lastJson(run.stdout);
  if (run.status === 2 && /^PARENT_STATE_MISSING: /.test(String(run.stderr || ''))
    || run.status === 1 && report?.holds?.length && report.holds.every(hold => hold.code === 'PARENT_STATE_MISSING')) {
    return 'skipped';
  }
  const lifecycle = report?.results?.filter(entry => ['set_parent_state', 'post_parent_repair'].includes(entry.kind)) || [];
  for (const entry of lifecycle) job.note(`Parent lifecycle: ${entry.kind === 'set_parent_state' ? entry.target.state === 'open' ? 'reopen' : 'complete' : 'repair notice'} ${entry.outcome}.`);
  if (run.status === 0) {
    job.note(`Programme refresh: done${report && report.inventory && report.inventory.complete === false ? ' (inventory incomplete)' : ''}.`);
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
  if (signedOut) return { status: 'skipped', reason: signedOut };
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
  if (signedOut) return { status: 'skipped', reason: signedOut };
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
  return { status: sweep.status === 'failed' ? 'failed' : verified || noStore ? 'ok' : 'held',
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
  const notGoverned = job.notGoverned();
  if (notGoverned) return { status: 'skipped', reason: notGoverned };
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: 'skipped', reason: signedOut };
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

function runJob(options, deps = {}) {
  const job = new Job(options, deps);
  const registry = (deps.registry || tasks).readRegistry(deps.home || os.homedir());
  const enrolled = registry.status === 'ok' && registry.tasks.find(entry => entry.id === options.taskId && entry.host === 'windows');
  let lock, record;
  const home = deps.home || os.homedir();
  const finishWithoutWork = (status, reason) => {
    const at = job.now().toISOString(), previous = job.readRecord();
    const history = previous?.schema === 'toolkit.task-last-run.v1' && previous.id === options.taskId && previous.job === options.job ? previous : null;
    const result = { ...skipStreak(history),
      ...(typeof history?.footer_sweep_since === 'string' && Number.isFinite(Date.parse(history.footer_sweep_since)) ? { footer_sweep_since: history.footer_sweep_since } : {}),
      schema: 'toolkit.task-last-run.v1', id: options.taskId, job: options.job,
      ...(enrolled?.repository ? { repository: enrolled.repository } : {}), started: at, finished: at,
      status, exit: status === 'failed' ? 1 : 0, reason, summary: [reason] };
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
    const key = observed?.fresh === true && observed?.status === 'enabled' && observed?.binding?.store?.repository || repository || options.repoRoot;
    lock = deps.takeProgrammeLock ? deps.takeProgrammeLock(key) : new (require('./toolkit-programme-lock.cjs').ProgrammeJobLock)({ home, key, log: line => job.note(line) }).take();
    if (!lock) return finishWithoutWork('deferred', `Programme work deferred: another job owns the lock; retries at the next hourly ${options.job === 'shard-timings' ? 'programme sweep before the next weekly slot' : 'task slot'}.`);
    record = runJobLocked(job, options, deps);
  } catch {
    return finishWithoutWork('failed', 'Programme job or lock failed; inspect local task state and retry the task.');
  } finally {
    if (lock) {
      try { lock.release(); }
      catch { record = finishWithoutWork('failed', 'Programme lock release failed; inspect the local lock before retrying.'); }
    }
  }
  // Start catch-up as a separate scheduled task, after releasing all writer locks.
  // Adding a 25-minute shard step to a sweep would exceed its 30-minute limit.
  if (options.job === 'programme-sweep') retryDeferredShards(job, options, deps);
  return record;
}

function retryDeferredShards(job, options, deps) {
  const home = deps.home || os.homedir(), windows = require('./toolkit-windows-tasks.cjs');
  try {
    if (job.ghSignedOut()) return;
    const state = job.governanceStatus();
    if (governanceReason(state) || job.observation(job.identity())?.fresh !== true) return;
    const registry = (deps.registry || tasks).readRegistry(home);
    if (registry.status !== 'ok') return;
    for (const entry of registry.tasks) {
      if (entry.host !== 'windows' || entry.job !== 'shard-timings' || entry.adopted || entry.stopped_by_owner
        || entry.repository !== windows.repositoryOf(job.identity()) || !windows.samePath(entry.checkout, options.repoRoot)
        || !tasks.localTaskOwner(entry.job_owner, deps.computerId || tasks.computerIdentity(home)?.id)
        || tasks.readLastRun(entry.id, home)?.status !== 'deferred') continue;
      const scheduler = deps.scheduler || windows.powerShellScheduler();
      const live = scheduler.list(entry.folder).find(task => task.name === entry.name);
      if (!live || ['Disabled', 'Running'].includes(live.state) || windows.parseMarker(live.description)?.id !== entry.id
        || !entry.enrolled || JSON.stringify(windows.enrolledDefinition(live)) !== JSON.stringify(entry.enrolled)) continue;
      scheduler.start(entry.folder, entry.name);
    }
  } catch { job.note('Deferred shard retry could not start; the next hourly programme sweep retries, or inspect toolkit tasks.'); }
}

function runJobLocked(job, options, deps) {
  const previous = job.readRecord();
  const started = job.now().toISOString();
  // The retry boundary is persisted before processes start, under the footer lock.
  const carried = previous?.schema === 'toolkit.task-last-run.v1' && previous.id === options.taskId && previous.job === options.job
    && typeof previous.footer_sweep_since === 'string' && !Number.isNaN(Date.parse(previous.footer_sweep_since))
    ? { footer_sweep_since: previous.footer_sweep_since }
    : {};
  const streak = skipStreak(previous);
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
        : programme.status === 'ok' ? footer.status === 'ok' ? 'ok' : 'held' : programme.status;
      outcome = { ...footer, status, footer_status: footer.status, programme_status: programme.status,
        ...(footer.reason ? { footer_reason: footer.reason } : {}),
        ...(programme.reason ? { programme_reason: programme.reason } : {}),
        ...(status === 'skipped' ? { reason: footer.reason || programme.reason } : {}) };
      if (programme.reason && programme.reason !== footer.reason && programme.reason !== outcome.reason) job.note(`Programme work skipped: ${programme.reason}.`);
    } else outcome = options.job === 'footer-sweep' ? job.clean(base) : shardTimings(job);
  }
  catch (error) { job.note(`The job stopped: ${error.message}`); outcome = { status: 'failed' }; }
  if (outcome.reason) job.note(`skipped: ${outcome.reason}`);
  let skips = {};
  if (outcome.status === 'skipped' && outcome.reason !== 'no shards yet') {
    skips = { reason: outcome.reason, skipped_streak: (streak.skipped_streak || 0) + 1, skipped_since: streak.skipped_since || started };
  } else if (outcome.status === 'failed') skips = streak;
  else if (streak.skipped_streak) {
    job.note(`Resumed after ${streak.skipped_streak} skipped run${streak.skipped_streak === 1 ? '' : 's'} since ${streak.skipped_since.slice(0, 16).replace('T', ' ')} UTC.`);
  }
  const exit = outcome.status === 'failed' ? 1 : 0;
  const record = { ...base, finished: job.now().toISOString(), exit, status: outcome.status, summary: job.summary, ...carried, ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...Object.fromEntries(['footer_status', 'programme_status', 'footer_reason', 'programme_reason'].filter(key => outcome[key] !== undefined).map(key => [key, outcome[key]])),
    ...(outcome.footer_sweep_since ? { footer_sweep_since: outcome.footer_sweep_since } : {}), ...skips };
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

module.exports = { JOBS, SCRIPT, SWEEP_OK, parseArgs, runJob, main, lastJson, localRepository, footerCursor, footerLockPath, HISTORY_NOTE };

if (require.main === module) process.exitCode = main();
