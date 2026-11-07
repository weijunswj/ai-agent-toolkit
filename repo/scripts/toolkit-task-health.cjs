#!/usr/bin/env node
'use strict';
// Deterministic computer-wide health. Native observations come only from toolkit
// tasks. Sharing uses a fresh ENABLED binding and the existing private-store check.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const tasks = require('./toolkit-tasks.cjs');
// Cached session reads never load the scheduler module.
const windowsTasks = () => require('./toolkit-windows-tasks.cjs');
const { ProgrammeJobLock } = require('./toolkit-programme-lock.cjs');
const { StateStore, GitHubTransport } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const SCHEMA = 'toolkit.task-health.v1';
const LABEL = /^computer-[a-f0-9]{12}$/;
const LOCAL_ONLY = 'health file not shared: no verified evidence store';
const VERSION = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const localFile = home => path.join(tasks.userStateDir(home), 'task-health.json');
function writeLocal(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + '\n', temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, bytes, { mode: 0o600 }); fs.renameSync(temp, file);
  if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('Health state readback failed');
}
function computerLabel(home) {
  const identity = tasks.computerIdentity(home);
  if (!identity) throw new Error('Run the approved task update to initialise this computer');
  // A stable neutral label, never the login name, hostname or a local path.
  return `computer-${hash(identity.id).slice(0, 12)}`;
}
function safeFlag(flag) {
  if (typeof flag !== 'string') return false;
  if (flag === 'GitHub checkout has no FOOTER SWEEP' || /^jobs run on computer-[a-f0-9]{12}(?: and computer-[a-f0-9]{12})+$/.test(flag)) return true;
  const match = /^(programme-sweep|footer-sweep|shard-timings|task-health): (.+)$/.exec(flag);
  return Boolean(match && (/^(missing task|disabled task|definition drift|task could not be read|skipped [1-9][0-9]* runs in a row|last run failed|task code older than managed checkout|missed scheduled run)$/.test(match[2]) || tasks.SKIP_REASON.test(match[2])));
}
function assertHealth(doc, { peer = false } = {}) {
  if (!doc || doc.schema !== SCHEMA || !LABEL.test(doc.computer || '') || !Number.isFinite(Date.parse(doc.time)) || !/^\d+\.\d+\.\d+$/.test(doc.toolkit_version || '') || !Array.isArray(doc.repos)) throw new Error('Invalid health file');
  const keys = (object, allowed) => { if (Object.keys(object).some(key => !allowed.includes(key))) throw new Error('Unexpected health data'); };
  keys(doc, ['schema', 'computer', 'time', 'toolkit_version', 'repos']);
  for (const row of doc.repos) {
    keys(row, ['repository', 'jobs', 'last_result', 'streak', 'flags']);
    if ((!tasks.REPOSITORY.test(row.repository || '') || row.repository.split('/').some(part => ['.', '..'].includes(part))) || !Array.isArray(row.jobs) || row.jobs.some(job => !(peer ? /^[a-z][a-z0-9-]{0,79}$/.test(job.job) : [...require('./toolkit-task-policy.cjs').INDEPENDENT_JOBS, ...require('./toolkit-task-policy.cjs').GOVERNED_JOBS].includes(job.job)) || !['ok', 'failed', 'held', 'skipped', 'deferred', 'running', 'unknown', 'stopped'].includes(job.result) || !Number.isSafeInteger(job.streak) || job.streak < 0) || !Array.isArray(row.flags) || row.flags.some(flag => !safeFlag(flag) && !(peer && typeof flag === 'string' && /^[a-z][a-z0-9-]{0,79}: [A-Za-z0-9 ,;().-]{1,200}$/.test(flag))) || !Number.isSafeInteger(row.streak) || row.streak < 0) throw new Error('Invalid health repository');
    for (const job of row.jobs) keys(job, ['job', 'result', 'streak']);
    if (!['ok', 'failed', 'held', 'skipped', 'deferred', 'running', 'unknown', 'stopped'].includes(row.last_result)) throw new Error('Invalid health result');
  }
  // The same secret shapes used by the task registry and programme store.
  if (tasks.looksSecret(JSON.stringify(doc))) throw new Error('Health file secret scan failed');
  return doc;
}
function latestSlot(entry, now) {
  const date = new Date(now), match = /(\d\d):(\d\d)/.exec(entry.schedule || '');
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (/^hourly/.test(entry.schedule)) { date.setMinutes(minute, 0, 0); if (date > now) date.setHours(date.getHours() - 1); }
  else if (/^daily/.test(entry.schedule)) { date.setHours(hour, minute, 0, 0); if (date > now) date.setDate(date.getDate() - 1); }
  else if (/^weekly, Monday/.test(entry.schedule)) { date.setDate(date.getDate() - (date.getDay() + 6) % 7); date.setHours(hour, minute, 0, 0); if (date > now) date.setDate(date.getDate() - 7); }
  else return null;
  return date;
}
function duplicateFlags(doc, others) {
  for (const repo of doc.repos) {
    const labels = [...new Set([doc.computer, ...others.filter(other => other.computer !== doc.computer && other.repos.some(row => row.repository.toLowerCase() === repo.repository.toLowerCase() && row.jobs.some(job => job.result !== 'stopped'))).map(other => other.computer)])].sort();
    repo.flags = repo.flags.filter(flag => !flag.startsWith('jobs run on '));
    if (repo.jobs.some(job => job.result !== 'stopped') && labels.length > 1) repo.flags.push(`jobs run on ${labels.join(' and ')}`);
  }
  return doc;
}
class HealthStore {
  constructor({ transport, store }) { this.transport = transport; this.store = store; this.verifier = new StateStore({ transport, store }); }
  verify() { return this.verifier.verify(); }
  endpoint(file, ref = this.store.branch) { return `repos/${this.store.repository}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`; }
  read(file, ref) {
    const response = this.transport.request('GET', this.endpoint(file, ref));
    if (response.status === 404) return { doc: null, sha: null };
    if (response.status !== 200 || response.json?.encoding !== 'base64' || typeof response.json.content !== 'string' || response.json.content.length > 1024 * 1024) throw new Error('Health store read failed');
    return { doc: JSON.parse(Buffer.from(response.json.content, 'base64').toString('utf8')), sha: response.json.sha };
  }
  list() {
    const response = this.transport.request('GET', this.endpoint('task-health'));
    if (response.status === 404) return [];
    if (response.status !== 200 || !Array.isArray(response.json) || response.json.length > 200) throw new Error('Health store listing failed');
    return response.json.filter(row => row.type === 'file' && /^computer-[a-f0-9]{12}\.json$/.test(row.name)).map(row => {
      const doc = assertHealth(this.read(`task-health/${row.name}`).doc, { peer: true });
      if (row.name !== `${doc.computer}.json`) throw new Error('Health file computer label mismatch');
      return doc;
    });
  }
  put(file, doc, sha) {
    this.verify();
    if (tasks.looksSecret(JSON.stringify(doc))) throw new Error('Health secret scan failed');
    const response = this.transport.request('PUT', this.endpoint(file).split('?')[0], { branch: this.store.branch, message: 'Update scheduled task health', content: Buffer.from(JSON.stringify(doc, null, 2) + '\n').toString('base64'), ...(sha ? { sha } : {}) });
    if (![200, 201].includes(response.status) || !response.json?.commit?.sha) throw new Error('Health store changed or write failed; retry after inspection');
    const readback = this.read(file, response.json.commit.sha);
    if (JSON.stringify(readback.doc) !== JSON.stringify(doc)) throw new Error('Health store readback failed');
  }
}
function freshCheckout(root, home, timeout = 95000, { lockFactory = options => new ProgrammeJobLock(options).take(), run = spawnSync } = {}) {
  const until = performance.now() + timeout;
  const lock = lockFactory({ home, key: `checkout-refresh:${path.resolve(root)}`, waitMs: Math.min(65000, timeout) });
  if (!lock) throw new Error('Another checkout refresh is running');
  try {
    const remaining = Math.floor(until - performance.now());
    if (remaining <= 0) throw new Error('Task health time budget exhausted');
    const result = run(process.execPath, [path.join(__dirname, 'toolkit-governance.cjs'), 'status', '--json'], { cwd: root, encoding: 'utf8', timeout: Math.min(30000, remaining), windowsHide: true });
    if (result.error || result.status !== 0) return null;
    const state = JSON.parse(result.stdout);
    if (state.state !== 'ENABLED' || state.merged?.status !== 'enabled' || state.merged.fresh !== true || state.refresh?.refreshed === false) return null;
    const identity = require('./toolkit-governance-state.cjs').readIdentity(root), observed = windowsTasks().readTaskObservation(identity, home);
    if (observed.status !== 'enabled' || observed.fresh !== true) return null;
    return windowsTasks().readCheckout(root, { home });
  } finally { lock.release(); }
}
class TaskHealth {
  constructor({ home = os.homedir(), scheduler, platform = process.platform, now = () => new Date(), version = VERSION(), list = tasks.listTasks, checkout = freshCheckout, storeFactory, takeLock } = {}) {
    Object.assign(this, { home, scheduler, platform, now, version, list, checkout, storeFactory, takeLock });
    this.deadline = performance.now() + 29 * 60000;
    this.scheduler ||= windowsTasks().powerShellScheduler({ run: (file, args, opts) => spawnSync(file, args, { ...opts, timeout: this.budget(opts.timeout) }) });
  }
  budget(ms) { const remaining = Math.floor(this.deadline - performance.now()); if (remaining <= 0) throw new Error('Task health time budget exhausted'); return Math.min(ms, remaining); }
  registry() { const registry = tasks.readRegistry(this.home); if (registry.status !== 'ok') throw new Error('Task registry unreadable; health held'); return registry.tasks; }
  entries() { return this.registry().filter(entry => entry.host === 'windows' && !entry.adopted && entry.job !== 'task-health'); }
  store() {
    for (const entry of this.entries()) {
      if (!entry.checkout || entry.stopped_by_owner) continue;
      try {
        const read = this.checkout(entry.checkout, this.home, this.budget(95000));
        if (!read?.certain || read.governanceState !== 'ENABLED' || !read.binding?.store || read.repository?.toLowerCase() !== entry.repository?.toLowerCase()) continue;
        const store = this.storeFactory ? this.storeFactory(read.binding.store) : new HealthStore({ store: read.binding.store, transport: new GitHubTransport({ ghPath: require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs').resolveExecutable('gh'), timeoutMs: 15000, run: (file, args, opts) => spawnSync(file, args, { ...opts, timeout: this.budget(opts.timeout) }) }) });
        store.verify(); return { store, key: read.binding.store.repository };
      } catch { /* Try the next freshly verified enrolled binding. No unverified writes. */ }
    }
    return null;
  }
  collect() {
    const registry = this.entries(), result = this.list({ home: this.home, scheduler: this.scheduler, platform: this.platform, folderFor: () => null });
    if (result.registry !== 'ok' || result.notes.length || result.rows.some(row => row.state === 'could not be read')) throw new Error('Task observations incomplete; health held');
    const grouped = new Map(), now = this.now();
    for (const entry of registry) {
      if (!tasks.REPOSITORY.test(entry.repository || '')) continue;
      const key = entry.repository.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, { repository: entry.repository, jobs: [], last_result: 'unknown', streak: 0, flags: [] });
      const repo = grouped.get(key), row = result.rows.find(row => row.id === entry.id);
      const last = tasks.readLastRun(entry.id, this.home), stopped = entry.stopped_by_owner;
      const status = stopped ? 'stopped' : ['ok', 'failed', 'held', 'skipped', 'deferred', 'running'].includes(last?.status) ? last.status : 'unknown';
      const streak = stopped ? 0 : Number.isSafeInteger(last?.skipped_streak) && last.skipped_streak > 0 ? last.skipped_streak : 0;
      repo.jobs.push({ job: entry.job, result: status, streak }); repo.streak = Math.max(repo.streak, streak);
      const priority = ['stopped', 'ok', 'unknown', 'running', 'skipped', 'held', 'deferred', 'failed'];
      if (repo.jobs.length === 1 || priority.indexOf(status) > priority.indexOf(repo.last_result)) repo.last_result = status;
      if (stopped) continue;
      const flag = text => repo.flags.push(`${entry.job}: ${text}`);
      if (!row || row.state === 'missing') flag('missing task');
      if (row?.windows_state === 'Disabled') flag('disabled task');
      if (row?.definition_drift) flag('definition drift');
      if (row?.state === 'could not be read') flag('task could not be read');
      const quietSkip = status === 'skipped' && last?.reason === 'no shards yet';
      if (streak >= 3 && !quietSkip) flag(`skipped ${streak} runs in a row`);
      if (status === 'failed' || row?.native_failed) flag('last run failed');
      if (last?.reason && !quietSkip && tasks.SKIP_REASON.test(last.reason)) flag(last.reason);
      if (entry.toolkit_version !== this.version) flag('task code older than managed checkout');
      const slot = latestSlot(entry, now), at = Date.parse(last?.finished || last?.started || entry.created);
      if (slot && now - slot > 30 * 60000 && (!Number.isFinite(at) || at < slot.getTime()) && row?.windows_state !== 'Running' && row?.windows_state !== 'Disabled') flag('missed scheduled run');
    }
    for (const repo of grouped.values()) {
      if (!repo.jobs.some(row => ['footer-sweep', 'programme-sweep'].includes(row.job))) repo.flags.push('GitHub checkout has no FOOTER SWEEP');
      repo.flags = [...new Set(repo.flags)];
    }
    return assertHealth({ schema: SCHEMA, computer: computerLabel(this.home), time: now.toISOString(), toolkit_version: this.version, repos: [...grouped.values()].sort((a, b) => a.repository.localeCompare(b.repository)) });
  }
  run() {
    const localLock = new ProgrammeJobLock({ home: this.home, key: 'task-health-local', waitMs: 0 }).take();
    if (!localLock) throw new Error('Task health already running');
    try {
      let doc = this.collect(), shared = false, note = LOCAL_ONLY, others = [];
      // Local evidence survives store contention, failed writes and readback failures.
      writeLocal(localFile(this.home), { document: doc, shared, note });
      const target = this.store();
      if (target) {
        try {
          const lockOptions = { home: this.home, key: target.key, waitMs: this.budget(29 * 60000) };
          const lock = this.takeLock ? this.takeLock(target.key, lockOptions) : new ProgrammeJobLock(lockOptions).take();
          if (!lock) throw new Error('Task health store busy; retry next run');
          try {
            others = target.store.list(); doc = duplicateFlags(doc, others);
            writeLocal(localFile(this.home), { document: doc, shared, note });
            const file = `task-health/${doc.computer}.json`, previous = target.store.read(file);
            target.store.put(file, assertHealth(doc), previous.sha); shared = true; note = 'health file shared';
          } finally { lock.release(); }
        } catch (error) {
          writeLocal(localFile(this.home), { document: doc, shared: false, note: 'health file not shared: store update failed' });
          throw error;
        }
      }
      writeLocal(localFile(this.home), { document: doc, shared, note });
      return { document: doc, shared, note, others };
    } finally { localLock.release(); }
  }
}
function sessionHealth(repository, home, registry) {
  const parts = [];
  try {
    registry ||= tasks.readRegistry(home);
    const enrolled = registry.status === 'ok' && registry.tasks.find(row => row.host === 'windows' && row.job === 'task-health' && !row.adopted);
    if (enrolled?.stopped_by_owner) return null;
    const entry = registry.status === 'ok' && registry.tasks.find(row => row.host === 'windows' && row.job === 'task-health' && !row.stopped_by_owner && !row.adopted);
    if (entry && tasks.readLastRun(entry.id, home)?.status === 'failed') parts.push('Task health: last run failed; see toolkit tasks.');
    const saved = JSON.parse(fs.readFileSync(localFile(home), 'utf8')), doc = assertHealth(saved.document);
    const repo = doc.repos.find(row => row.repository.toLowerCase() === repository.toLowerCase());
    const flags = (repo?.flags || []).join('; ');
    if (flags) parts.push(`Task health: ${flags}`);
    if (saved.shared !== true) parts.push(saved.note === 'health file not shared: store update failed' ? saved.note : LOCAL_ONLY);
    if (Date.now() - Date.parse(doc.time) > 26 * 3600000) parts.push('Task health file is over 26 hours old');
  } catch { /* A failed health job still has its own recorded failure above. */ }
  return parts.join('; ') || null;
}
function runHealthJob(deps = {}) {
  const home = deps.home || os.homedir(), at = new Date().toISOString();
  const finish = (status, summary) => {
    const record = { schema: 'toolkit.task-last-run.v1', id: deps.taskId, job: 'task-health', started: at, finished: new Date().toISOString(), status, exit: status === 'failed' ? 1 : 0, summary };
    if (deps.taskId) tasks.writeLastRun(deps.taskId, record, home);
    return record;
  };
  try {
    if (deps.taskId) {
      const registry = tasks.readRegistry(home);
      if (registry.status !== 'ok') throw new Error('Task registry unreadable');
      const entry = registry.tasks.find(row => row.id === deps.taskId && row.host === 'windows' && row.job === 'task-health');
      if (!entry || entry.adopted) throw new Error('Task health enrolment missing');
      if (entry.stopped_by_owner || !tasks.localTaskOwner(entry.job_owner, tasks.computerIdentity(home)?.id)) return finish('skipped', ['Task health is stopped or owned by another computer; inspect toolkit tasks.']);
    }
    const result = new TaskHealth(deps).run();
    return finish('ok', [`${result.note}; ${result.document.repos.reduce((n, row) => n + row.flags.length, 0)} flags`]);
  } catch (error) {
    // Keep only known operational categories in public receipts, never raw paths,
    // native output, transport payloads or arbitrary exception text.
    const message = String(error.message || '');
    const reason = /store readback failed/i.test(message) ? 'Health store readback failed'
      : /store.*(?:write|changed)/i.test(message) ? 'Health store changed or write failed'
      : /store busy/i.test(message) ? 'Health store busy'
      : /time budget/i.test(message) ? 'Task health time budget exhausted'
      : /observations incomplete/i.test(message) ? 'Task observations incomplete'
      : /registry unreadable/i.test(message) ? 'Task registry unreadable'
      : /health.*(?:file|repository|data|label)/i.test(message) ? 'Health file validation failed'
      : 'Task health observation or local state write failed';
    return finish('failed', [`${reason}; inspect toolkit tasks.`]);
  }
}
function main(argv = process.argv.slice(2), deps = {}) {
  if (argv.length) return 2;
  const record = runHealthJob(deps);
  (record.exit ? deps.stderr || console.error : deps.stdout || console.log)(record.summary.join('; '));
  return record.exit;
}
module.exports = { TaskHealth, HealthStore, SCHEMA, LOCAL_ONLY, assertHealth, duplicateFlags, latestSlot, computerLabel, localFile, writeLocal, sessionHealth, runHealthJob, freshCheckout, main };
if (require.main === module) process.exitCode = main();
