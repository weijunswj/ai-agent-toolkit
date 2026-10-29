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
//                    it records "skipped: <reason>" and changes nothing. Then, in order:
//                      1. programme.cjs refresh (the programme pages);
//                      2. programme.cjs attention (its Attention: line is kept);
//                      3. toolkit-github-footer-sweep.cjs --apply over the bound repository and the
//                         binding's evidence store, for posts changed since the last sweep that
//                         ended well (48 hours on the first run). It edits only the signed-in
//                         account's own posts. It runs even when step 1 held: the two are separate.
//   shard-timings    for the Toolkit checkout only (it carries the shard manifest and the refresh
//                    script): refresh-shard-timings.cjs --open-pr, which opens a pull request only
//                    when the measured times drifted.
//
// Each run writes ~/.ai-agent-toolkit/user-state/tasks/<id>/last-run.json (mode 600): started,
// finished, exit, status (ok, held, skipped, failed) and a few summary lines with anything shaped like
// a secret removed; no other command output is kept. Exit 0 ok, held or skipped; 1 failed; 2 bad
// arguments.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tasks = require('./toolkit-tasks.cjs');

const RECONCILER = path.resolve(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts');
const SCRIPT = Object.freeze({
  governance: path.join(__dirname, 'toolkit-governance.cjs'),
  programme: path.join(RECONCILER, 'programme.cjs'),
  footerSweep: path.join(__dirname, 'toolkit-github-footer-sweep.cjs'),
});
const JOBS = Object.freeze(['programme-sweep', 'shard-timings']);
const FIRST_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000;
// Footer sweep exits that mean it ended well: nothing found, found and left, cleaned.
const SWEEP_OK = new Set([0, 3, 4]);
const MINUTE = 60 * 1000;
const TIMEOUT = Object.freeze({ check: 2 * MINUTE, refresh: 12 * MINUTE, attention: 2 * MINUTE, sweep: 12 * MINUTE, shards: 25 * MINUTE });
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

// The last JSON object in a command's output, or null.
function lastJson(text) {
  const parts = String(text || '').split(/\n(?=\{)/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(parts[index]); } catch { /* try the one before */ }
  }
  return null;
}

class Job {
  #options; #run; #node; #gh; #binding; #now; #summary = [];

  constructor(options, deps = {}) {
    this.#options = options;
    this.#run = deps.run || defaultRun;
    this.#node = deps.nodePath || process.execPath;
    this.#gh = deps.ghPath === undefined ? null : deps.ghPath;
    this.#binding = deps.mergedBinding || (root => require('./toolkit-governance-state.cjs').mergedBinding(root));
    this.#now = deps.now || (() => new Date());
  }

  get options() { return this.#options; }
  note(line) { this.#summary.push(tasks.safeText(line)); }
  get summary() { return [...this.#summary]; }

  #exec(file, args, timeout) { return this.#run(file, args, { cwd: this.#options.repoRoot, timeout }); }
  node(script, args, timeout) { return this.#exec(this.#node, [script, ...args], timeout); }

  // gh resolved to a full path from PATH, never from the checkout folder.
  ghPath() {
    if (this.#gh) return this.#gh;
    const { resolveExecutable } = require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs');
    this.#gh = resolveExecutable('gh', { cwd: this.#options.repoRoot });
    return this.#gh;
  }

  // null when gh is signed in, else the reason.
  ghSignedOut() {
    let gh;
    try { gh = this.ghPath(); } catch { return 'gh is not installed'; }
    return this.#exec(gh, ['auth', 'status'], TIMEOUT.check).status === 0 ? null : 'gh not signed in';
  }

  // null when governance is ENABLED from a fresh merged-binding read, else the reason.
  notGoverned() {
    const run = this.node(SCRIPT.governance, ['status', '--json'], TIMEOUT.check);
    let state;
    try { state = JSON.parse(run.stdout); } catch { return 'governance status could not be read'; }
    if (!state || state.state !== 'ENABLED') return `governance is ${state && state.state ? String(state.state) : 'unknown'}`;
    if (!state.merged || state.merged.fresh !== true) return 'binding not read in 24 h';
    return null;
  }

  binding() { try { return this.#binding(this.#options.repoRoot); } catch { return null; } }
  now() { return this.#now(); }
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

// Step 3: { status, since } where since is the new watermark when it ended well.
function sweepStep(job, binding, since) {
  const repos = [binding.repository];
  if (binding.store && binding.store.repository && binding.store.repository.toLowerCase() !== binding.repository.toLowerCase()) repos.push(binding.store.repository);
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

function programmeSweep(job, previous) {
  const signedOut = job.ghSignedOut();
  if (signedOut) return { status: 'skipped', reason: signedOut };
  const notGoverned = job.notGoverned();
  if (notGoverned) return { status: 'skipped', reason: notGoverned };
  const binding = job.binding();
  if (!binding || !binding.repository) return { status: 'skipped', reason: 'binding not read in 24 h' };
  const refresh = refreshStep(job);
  const attention = attentionStep(job);
  const watermark = previous && typeof previous.footer_sweep_since === 'string' && !Number.isNaN(Date.parse(previous.footer_sweep_since))
    ? previous.footer_sweep_since : new Date(job.now().getTime() - FIRST_SWEEP_WINDOW_MS).toISOString();
  const sweep = sweepStep(job, binding, watermark);
  const status = refresh === 'failed' || sweep.status === 'failed' ? 'failed' : refresh === 'held' || attention === 'held' ? 'held' : 'ok';
  return { status, footer_sweep_since: sweep.since || watermark };
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

function runJob(options, deps = {}) {
  const home = deps.home || os.homedir();
  const job = new Job(options, deps);
  const previous = tasks.readLastRun(options.taskId, home);
  const started = job.now().toISOString();
  const carried = previous && previous.footer_sweep_since ? { footer_sweep_since: previous.footer_sweep_since } : {};
  const base = { schema: 'toolkit.task-last-run.v1', id: options.taskId, job: options.job, started };
  tasks.writeLastRun(options.taskId, { ...base, finished: null, exit: null, status: 'running', summary: [], ...carried }, home);
  let outcome;
  try { outcome = options.job === 'programme-sweep' ? programmeSweep(job, previous) : shardTimings(job); }
  catch (error) { job.note(`The job stopped: ${error.message}`); outcome = { status: 'failed' }; }
  if (outcome.reason) job.note(`skipped: ${outcome.reason}`);
  const exit = outcome.status === 'failed' ? 1 : 0;
  const record = { ...base, finished: job.now().toISOString(), exit, status: outcome.status, summary: job.summary, ...carried,
    ...(outcome.footer_sweep_since ? { footer_sweep_since: outcome.footer_sweep_since } : {}) };
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
