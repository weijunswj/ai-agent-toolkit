#!/usr/bin/env node
'use strict';

// The job a Toolkit Windows scheduled task runs (toolkit-windows-tasks.cjs registers it):
//   node <Toolkit checkout>/repo/scripts/toolkit-scheduled-job.cjs <job> --repo-root <checkout> --task-id <id>
//
// A fixed list of deterministic commands. It starts only node (Toolkit's own scripts) and gh, never
// a model command line, and a job that needs judgement is never one of these.
//
//   programme-sweep  runs only when gh is signed in and `toolkit governance status` reads the
//                    repository as ENABLED from a merged-binding read under 24 hours old; otherwise
//                    it records "skipped: <reason>" for programme work. Until its independent
//                    footer task is verified, it cleans first under a shared repository lock,
//                    irrespective of programme governance. A failed `gh auth status`
//                    is told apart by one short connection to github.com:443 (a node child, no
//                    data sent): "skipped: offline" when it cannot connect, else "skipped: gh not
//                    signed in". Then, in order:
//                      1. programme.cjs refresh (the programme pages);
//                      2. programme.cjs attention (its Attention: line is kept);
//   footer-sweep     cleans the validated github.com origin independently of governance. A fresh,
//                    enabled, matching binding adds its evidence store. Unverified store scope is
//                    withheld and keeps the retry window. A complete successful batch advances the
//                    watermark to scan start (48 hours on the first run). Only own posts are edited.
//   shard-timings    for the Toolkit checkout only (it carries the shard manifest and the refresh
//                    script): refresh-shard-timings.cjs --open-pr, which opens a pull request only
//                    when the measured times drifted.
//
// Each run writes ~/.ai-agent-toolkit/user-state/tasks/<id>/last-run.json (mode 600): started,
// finished, exit, status (ok, held, skipped, failed) and a few summary lines with anything shaped like
// a secret removed; no other command output is kept. A skipped run also keeps its reason and counts
// the skips in a row (skipped_streak, from skipped_since); the first ok or held run after them says
// "Resumed after N skipped runs since <time>" and clears both, and a failed run keeps them. The
// session-start line and `toolkit tasks` read these fields, because Task Scheduler shows every skip
// as success. Exit 0 ok, held or skipped; 1 failed; 2 bad arguments.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const tasks = require('./toolkit-tasks.cjs');

const RECONCILER = path.resolve(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts');
const SCRIPT = Object.freeze({
  governance: path.join(__dirname, 'toolkit-governance.cjs'),
  programme: path.join(RECONCILER, 'programme.cjs'),
  footerSweep: path.join(__dirname, 'toolkit-github-footer-sweep.cjs'),
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
  if (state.refresh?.refreshed === false) return Object.hasOwn(REFRESH_REASONS, state.refresh.reason) ? REFRESH_REASONS[state.refresh.reason] : 'binding refresh failed';
  if (!state.merged || ['unknown', 'none'].includes(state.merged.status)) return 'binding is missing';
  if (state.merged.status === 'invalid') return 'binding is invalid';
  if (state.merged.status === 'foreign') return 'binding does not match origin';
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
    return state;
  } catch { return null; }
}

const validTime = (value, now) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime()
  && new Date(value).toISOString() === (value.includes('.') ? value : value.replace(/Z$/, '.000Z'));

class Job {
  #options; #run; #node; #gh; #resolveGh; #identity; #observation; #home; #now; #summary = [];
  #scheduler; #registry; #record; #lock;

  constructor(options, deps = {}) {
    this.#options = options;
    this.#run = deps.run || defaultRun;
    this.#node = deps.nodePath || process.execPath;
    this.#gh = deps.ghPath === undefined ? null : deps.ghPath;
    this.#resolveGh = deps.resolveGh || (() => require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs').resolveExecutable('gh', { cwd: this.#options.repoRoot }));
    this.#identity = deps.readIdentity || (root => require('./toolkit-governance-state.cjs').readIdentity(root));
    this.#observation = deps.readObservation || readObservation;
    this.#home = deps.home || os.homedir();
    this.#now = deps.now || (() => new Date());
    this.#scheduler = deps.scheduler || null;
    this.#registry = deps.readRegistry || (() => tasks.readRegistry(this.#home));
    this.#record = deps.readRecord || (id => tasks.readLastRun(id, this.#home));
    this.#lock = deps.takeLock || require('../../skills/github-program-reconciler/scripts/programme.cjs').takeLock;
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
    let gh;
    try { gh = this.ghPath(); } catch { return 'gh is not installed'; }
    if (this.#exec(gh, ['auth', 'status'], TIMEOUT.check).status === 0) return null;
    return this.node('-e', [REACH_GITHUB], TIMEOUT.reach).status === 0 ? 'gh not signed in' : 'offline';
  }

  governanceStatus() {
    try {
      return statusResult(this.node(SCRIPT.governance, ['status', '--json'], TIMEOUT.check));
    } catch { return null; }
  }

  identity() { try { return this.#identity(this.#options.repoRoot); } catch { return null; } }

  // Validate the same cached observation that supplies the store, independently of the status
  // command. mergedBinding() alone can return stale data and cannot grant store effects.
  observation(identity) {
    try {
      const observed = this.#observation(identity, this.#home, this.now());
      if (observed?.status === 'enabled') {
        // judgeMerged returns validateBinding's normalized v2 view, which adds three derived
        // v1 fields. Validate its source shape; those derived fields never grant target scope.
        let binding = observed.binding;
        if (binding?.schema === 'toolkit.programme-binding.v2') {
          const { parent_issue, record_prefix, writer_prefix, ...source } = binding;
          binding = source;
        }
        if (require('./toolkit-governance-state.cjs').bindingProblems(binding, identity).length) return { status: 'invalid', fresh: false };
      }
      return observed;
    } catch { return null; }
  }
  now() { return this.#now(); }

  // Narrow companion readback: the registry, marker and complete action must all agree.
  companion(repository) {
    const registry = this.#registry();
    if (registry.status !== 'ok') return 'unreadable';
    const candidates = registry.tasks.filter(row => row.host === 'windows' && row.job === 'footer-sweep' && !row.adopted
      && typeof row.repository === 'string' && row.repository.toLowerCase() === repository.toLowerCase());
    if (!candidates.length) return 'missing';
    const windows = require('./toolkit-windows-tasks.cjs');
    try {
      const scheduler = this.#scheduler || windows.powerShellScheduler();
      for (const row of candidates) {
        const live = scheduler.list(row.folder).find(item => item.name === row.name);
        const marker = live && windows.parseMarker(live.description);
        const hours = tasks.installedHours(row.schedule);
        const schedule = hours && { kind: 'hourly', at: `${String(hours.hour).padStart(2, '0')}:00`, hours: hours.hours };
        // The stored digest already binds the complete action and schedule, including records
        // written before handover support. Recompute it from live data rather than trusting a row.
        if (!marker || marker.id !== row.id || marker.def !== row.definition || !schedule
          || windows.describeTriggers(live.triggers) !== row.schedule
          || windows.definitionDigest({ ...live, schedule }) !== row.definition) continue;
        const args = /(?:^| )footer-sweep --repo-root "([^"]+)" --task-id ([a-z0-9-]+)$/.exec(live.arguments);
        if (!args || args[2] !== row.id || windows.repositoryOf(this.#identity(args[1]))?.toLowerCase() !== repository.toLowerCase()) continue;
        return live.state === 'Disabled' ? 'disabled' : ['Ready', 'Running', 'Queued'].includes(live.state) ? 'ready' : 'unreadable';
      }
      return 'changed';
    } catch { return 'unreadable'; }
  }

  clean(previous, base, interim = false) {
    const repository = require('./toolkit-windows-tasks.cjs').repositoryOf(this.identity());
    if (!repository) return { status: 'skipped', reason: 'no usable github.com origin repository' };
    const companion = interim ? this.companion(repository) : null;
    const setup = interim && !['ready', 'disabled'].includes(companion);
    const condition = setup ? { footer_setup: 'needed' } : {};
    if (interim && ['ready', 'disabled'].includes(companion)) return { status: 'ok', footer_status: companion };
    const file = path.join(tasks.userStateDir(this.#home), 'tasks', `footer-${crypto.createHash('sha256').update(repository.toLowerCase()).digest('hex').slice(0, 20)}.lock`);
    const lock = this.#lock(file);
    if (!lock) {
      if (setup) this.note(tasks.FOOTER_SETUP_NOTE);
      this.note('Footer cleaning held: another footer pass is running.');
      return { status: 'held', footer_status: 'locked', ...condition };
    }
    try {
      if (interim) {
        const checked = this.companion(repository);
        if (['ready', 'disabled'].includes(checked)) return { status: 'ok', footer_status: checked };
        this.note(tasks.FOOTER_SETUP_NOTE);
        if (checked === 'unreadable') this.note('Footer companion could not be verified; interim cleaning continues.');
      }
      const now = this.now();
      const registry = this.#registry();
      const cursors = [];
      const handed = previous?.footer_handover === repository.toLowerCase();
      // Interim cleaning already owns its cursor. Only first import needs the registry to find
      // all historical records; an unreadable registry must not stop a valid interim window.
      let damaged = previous?.footer_status === 'recovery' || (!interim && !handed && registry.status !== 'ok');
      const inspect = (record, id, expectedJob, known = false) => {
        if (!record) { if (known && fs.existsSync(tasks.lastRunPath(id, this.#home))) damaged = true; return; }
        if (record.id !== id || record.job !== expectedJob || record.schema !== 'toolkit.task-last-run.v1'
          || (record.footer_handover && record.footer_handover !== repository.toLowerCase())
          || (record.repository !== undefined && (typeof record.repository !== 'string' || record.repository.toLowerCase() !== repository.toLowerCase()))
          || !validTime(record.started, now) || (record.finished !== null && !validTime(record.finished, now))
          || (record.footer_sweep_since !== undefined && (!validTime(record.footer_sweep_since, now)
            || Date.parse(record.footer_sweep_since) > Date.parse(record.started)))) { damaged = true; return; }
        cursors.push(record.footer_sweep_since || new Date(Date.parse(record.started) - FIRST_SWEEP_WINDOW_MS).toISOString());
      };
      if (previous) inspect(previous, base.id, base.job);
      // Import once. Historical records are eligible only through a matching, non-adopted row.
      if (!interim && !handed && registry.status === 'ok') {
        for (const row of registry.tasks.filter(row => row.host === 'windows' && row.job === 'programme-sweep' && !row.adopted
          && typeof row.repository === 'string' && row.repository.toLowerCase() === repository.toLowerCase())) inspect(this.#record(row.id), row.id, row.job, true);
      }
      if (damaged) { this.note('Footer cleaning held: migration history needs recovery; retry window was not reset.'); return { status: 'held', footer_status: 'recovery', ...condition }; }
      const since = cursors.sort((a, b) => Date.parse(a) - Date.parse(b))[0] || new Date(now.getTime() - FIRST_SWEEP_WINDOW_MS).toISOString();
      const carried = { footer_sweep_since: since, ...(!interim ? { footer_handover: repository.toLowerCase() } : {}), ...condition };
      // Persist the imported window and repository binding before any interruptible process.
      tasks.writeLastRun(base.id, { ...base, repository, status: 'running', finished: null, exit: null, summary: [], ...carried, ...skipStreak(previous) }, this.#home);
      let outcome;
      try { outcome = footerSweep(this, since); }
      catch { this.note('Footer sweep stopped; the next run retains the retry window.'); outcome = { status: 'failed' }; }
      return { ...carried, ...outcome, footer_status: outcome.status };
    } finally { lock.release(); }
  }
}

// Step 1 and 2: { status: ok|held|failed }.
function refreshStep(job) {
  const run = job.node(SCRIPT.programme, ['refresh', '--repo-root', job.options.repoRoot, '--json'], TIMEOUT.refresh);
  const report = lastJson(run.stdout);
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
  const text = Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(', ') || 'no posts with the footer';
  if (SWEEP_OK.has(run.status)) {
    job.note(`Footer sweep since ${since.slice(0, 16).replace('T', ' ')}: ${text}.`);
    return { status: 'ok', since: started };
  }
  job.note(`Footer sweep failed (exit ${run.status === null ? `none, ${run.error || 'stopped'}` : run.status}): ${run.status === 1 ? text : firstLine(run.stderr) || 'no output'}; the next run tries again from the same time.`);
  return { status: 'failed', since: null };
}

function programmeSweep(job) {
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: 'skipped', reason: signedOut };
  const notGoverned = governanceReason(job.governanceStatus());
  if (notGoverned) return { status: 'skipped', reason: notGoverned };
  const identity = job.identity();
  if (!require('./toolkit-windows-tasks.cjs').repositoryOf(identity)) return { status: 'skipped', reason: 'no usable github.com origin repository' };
  const observed = job.observation(identity);
  if (!observed) return { status: 'skipped', reason: 'binding is missing' };
  if (observed.status !== 'enabled') return { status: 'skipped', reason: 'binding is invalid' };
  if (observed.fresh !== true) return { status: 'skipped', reason: 'binding observation expired' };
  const refresh = refreshStep(job);
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
  const noStore = state?.merged?.fresh === true && state.refresh?.refreshed !== false
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
  const manifest = path.join(job.options.repoRoot, 'repo', 'contracts', 'ci', 'test-shards.json');
  const script = path.join(job.options.repoRoot, 'repo', 'scripts', 'refresh-shard-timings.cjs');
  if (!fs.existsSync(manifest) || !fs.existsSync(script)) return { status: 'skipped', reason: 'this checkout has no CI shards to time' };
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: 'skipped', reason: signedOut };
  const run = job.node(script, ['--open-pr'], TIMEOUT.shards);
  const lines = String(run.stdout || '').split(/\r?\n/).filter(Boolean).slice(-3);
  for (const line of lines) job.note(line);
  if (run.status === 0) return { status: 'ok' };
  job.note(`Shard timings failed (exit ${run.status === null ? `none, ${run.error || 'stopped'}` : run.status}): ${firstLine(run.stderr) || 'no output'}.`);
  return { status: 'failed' };
}

// The skips in a row so far, from the previous record: { skipped_streak, skipped_since } or {}.
function skipStreak(previous) {
  const count = previous && Number.isInteger(previous.skipped_streak) && previous.skipped_streak > 0 ? previous.skipped_streak : 0;
  const since = previous && typeof previous.skipped_since === 'string' && !Number.isNaN(Date.parse(previous.skipped_since)) ? previous.skipped_since : null;
  return count && since ? { skipped_streak: count, skipped_since: since } : {};
}

function runJob(options, deps = {}) {
  const home = deps.home || os.homedir();
  const job = new Job(options, deps);
  const previous = tasks.readLastRun(options.taskId, home) || (fs.existsSync(tasks.lastRunPath(options.taskId, home)) ? {} : null);
  const started = job.now().toISOString();
  // Keep each task's cursor in its own record. Handover and scanning run under the footer lock.
  const carried = previous && typeof previous.footer_sweep_since === 'string' && !Number.isNaN(Date.parse(previous.footer_sweep_since))
    ? { footer_sweep_since: previous.footer_sweep_since }
    : {};
  if (previous?.footer_handover) carried.footer_handover = previous.footer_handover;
  const streak = skipStreak(previous);
  const base = { schema: 'toolkit.task-last-run.v1', id: options.taskId, job: options.job, started,
    repository: require('./toolkit-windows-tasks.cjs').repositoryOf(job.identity()) };
  tasks.writeLastRun(options.taskId, { ...base, finished: null, exit: null, status: 'running', summary: [], ...carried, ...streak }, home);
  let outcome;
  try {
    if (options.job === 'programme-sweep') {
      const footer = job.clean(previous, base, true);
      const programme = programmeSweep(job);
      outcome = { ...footer, ...programme, programme_status: programme.status };
      if (programme.status === 'ok' && footer.status !== 'ok') outcome.status = footer.status === 'failed' ? 'failed' : 'held';
    } else outcome = options.job === 'footer-sweep' ? job.clean(previous, base) : shardTimings(job);
  }
  catch (error) { job.note(`The job stopped: ${error.message}`); outcome = { status: 'failed' }; }
  if (outcome.reason) job.note(`skipped: ${outcome.reason}`);
  let skips = {};
  if (outcome.status === 'skipped') {
    skips = { reason: outcome.reason, skipped_streak: (streak.skipped_streak || 0) + 1, skipped_since: streak.skipped_since || started };
  } else if (outcome.status === 'failed') skips = streak;
  else if (streak.skipped_streak) {
    job.note(`Resumed after ${streak.skipped_streak} skipped run${streak.skipped_streak === 1 ? '' : 's'} since ${streak.skipped_since.slice(0, 16).replace('T', ' ')} UTC.`);
  }
  const exit = outcome.status === 'failed' ? 1 : 0;
  const record = { ...base, finished: job.now().toISOString(), exit, status: outcome.status, summary: job.summary, ...carried,
    ...Object.fromEntries(['footer_setup', 'footer_status', 'programme_status', 'footer_handover'].filter(key => outcome[key] !== undefined).map(key => [key, outcome[key]])),
    ...(outcome.footer_sweep_since ? { footer_sweep_since: outcome.footer_sweep_since } : {}), ...skips };
  tasks.writeLastRun(options.taskId, record, home);
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

if (require.main === module) process.exitCode = main();

module.exports = { JOBS, SCRIPT, SWEEP_OK, parseArgs, runJob, main, lastJson };
