#!/usr/bin/env node
'use strict';

// `toolkit tasks`: every scheduled task Toolkit knows about on this computer, in one list. Run as
//   node <Toolkit checkout>/repo/scripts/toolkit-tasks.cjs [--json]
//
// Read-only and no model calls. Rows come from where each host keeps its tasks:
//   Windows       live from Task Scheduler (toolkit-windows-tasks.cjs reads it), for every folder the
//                 registry names and the folder of the repository you are in, plus the n8n backup
//                 tasks in the root folder (listed, never changed);
//   Claude Code   live from the desktop app's local task folders (~/.claude/scheduled-tasks/<name>/SKILL.md),
//                 which hold a name and description only, so the schedule comes from the registry;
//   Codex and Claude cloud tasks   from the registry only, marked "from record, not checked live".
// A registry entry the host no longer has shows "missing"; a task in a Toolkit folder that is neither
// marked nor recorded shows "found, not recorded (not Toolkit's)". A Toolkit task whose runs are being
// skipped shows the reason and how many in a row; sweepLine() gives the session-start line for it.
//
// The registry is ~/.ai-agent-toolkit/user-state/tasks.json (toolkit.tasks.v1). Only
// toolkit-windows-tasks.cjs writes its Windows entries; the only writes this script makes are
//   --record --host <claude-cloud|claude-code|codex> --id <id> --name <name> --schedule <text>
//            --purpose <text> [--model <model> --effort <effort>] [--repository <owner/name>]
//            records a task another host runs (the Projects coordinator records each cloud task it
//            creates); an entry with the same id is replaced
//   --forget <id>   removes such an entry once its task is deleted (Windows enrolments and owner
//            stops remain under toolkit-windows-tasks.cjs ownership)
//
// Exit 0 listed or recorded, 1 the registry could not be written, 2 bad arguments.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SECRET_SHAPES } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');

const SCHEMA = 'toolkit.tasks.v1';
const HOSTS = Object.freeze(['windows', 'claude-cloud', 'claude-code', 'codex']);
const RECORDABLE_HOSTS = Object.freeze(['claude-cloud', 'claude-code', 'codex']);
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const READ_LIMIT = 512 * 1024;
const TEXT_LIMIT = 300;
const USAGE = 'Usage: node repo/scripts/toolkit-tasks.cjs [--json]\n'
  + '       node repo/scripts/toolkit-tasks.cjs --record --host <claude-cloud|claude-code|codex> --id <id> --name <name> --schedule <text> --purpose <text> [--model <model> --effort <effort>] [--repository <owner/name>]\n'
  + '       node repo/scripts/toolkit-tasks.cjs --forget <id>\n';

class TasksError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

// ---- registry ---------------------------------------------------------------------------------

function userStateDir(home = os.homedir()) { return path.join(home, '.ai-agent-toolkit', 'user-state'); }
function registryPath(home) { return path.join(userStateDir(home), 'tasks.json'); }
// Local identity survives a hostname change. Readers never create state; approved
// task apply initialises it once while holding the registry lock.
function computerIdentity(home, { create = false } = {}) {
  const file = path.join(userStateDir(home), 'task-computer.json');
  const read = () => {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!/^local-[a-f0-9-]{36}$/.test(value.id)) throw new TasksError('task computer identity is invalid; restore its saved local copy', 1);
    return value;
  };
  try { return read(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!create) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, JSON.stringify({ id: `local-${crypto.randomUUID()}`, label: os.hostname() }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return read();
}
function localTaskOwner(owner, id) {
  // Pre-identity hostname records are local records, not proof of remote ownership.
  return !owner || owner === id || (!id || /^local-[a-f0-9-]{36}$/.test(id)) && !/^local-[a-f0-9-]{36}$/.test(owner);
}
const OWNER_RECOVERY = 'obtain approval for scoped remove --repo-root <repo>, then apply --repo-root <repo> --repair-owned, including reactivation of stops';
function lastRunPath(id, home) {
  if (!ID.test(String(id))) throw new TasksError(`task id ${JSON.stringify(id)} is not valid`);
  return path.join(userStateDir(home), 'tasks', id, 'last-run.json');
}

// Whether a text holds something shaped like a secret (the reconciler's own screen).
function looksSecret(value) {
  return typeof value === 'string' && SECRET_SHAPES.some(([, pattern]) => pattern.test(value));
}

// One plain line, cut to the limit, with anything secret-shaped replaced.
function safeText(value, limit = TEXT_LIMIT) {
  const line = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
  return looksSecret(line) ? '[removed: looked like a secret]' : line;
}

const isText = (value, limit = TEXT_LIMIT) => typeof value === 'string' && value.trim() !== '' && value.length <= limit && !/[\r\n]/.test(value);

function entryProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'not an object';
  if (!ID.test(String(entry.id))) return 'id';
  if (!HOSTS.includes(entry.host)) return 'host';
  for (const key of ['name', 'schedule', 'purpose', 'created', 'created_by']) if (!isText(entry[key])) return key;
  if (entry.host === 'windows' && !/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(String(entry.folder))) return 'folder';
  if (entry.host !== 'windows' && entry.folder !== null) return 'folder';
  if (entry.repository !== null && !REPOSITORY.test(String(entry.repository))) return 'repository';
  if (entry.repo_minute !== undefined && (!Number.isInteger(entry.repo_minute) || entry.repo_minute < 1 || entry.repo_minute > 9)) return 'repo_minute';
  if (entry.job_owner !== undefined && (!isText(entry.job_owner, 80) || /[\x00-\x1f\x7f]/.test(entry.job_owner))) return 'job_owner';
  for (const key of ['model', 'effort']) if (entry[key] !== null && !isText(entry[key], 80)) return key;
  if (entry.toolkit_missing !== undefined && entry.toolkit_missing !== true) return 'toolkit_missing';
  if (entry.ownership_transferred !== undefined && entry.ownership_transferred !== true) return 'ownership_transferred';
  if (entry.toolkit_version !== undefined && !/^\d+\.\d+\.\d+$/.test(String(entry.toolkit_version))) return 'toolkit_version';
  if (entry.stopped_by_owner !== undefined && entry.stopped_by_owner !== true) return 'stopped_by_owner';
  if ((entry.stopped_by_owner === true) !== (entry.stopped_at !== undefined)) return 'stopped_at';
  if (entry.stopped_at !== undefined && (typeof entry.stopped_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.stopped_at) || !Number.isFinite(Date.parse(entry.stopped_at)))) return 'stopped_at';
  for (const key of ['checkout', 'toolkit_root']) if (entry[key] !== undefined && (typeof entry[key] !== 'string' || !path.win32.isAbsolute(entry[key]) || /[\x00-\x1f\x7f"\u0085\u2028\u2029\ufeff]/.test(entry[key]))) return key;
  if (entry.enrolled !== undefined && (!entry.enrolled || typeof entry.enrolled !== 'object' || Array.isArray(entry.enrolled)
    || !Array.isArray(entry.enrolled.actions) || !entry.enrolled.actions.length || !Array.isArray(entry.enrolled.triggers)
    || typeof entry.enrolled.description !== 'string' || typeof entry.enrolled.enabled !== 'boolean')) return 'enrolled definition';
  if (entry.enrolled && (entry.enrolled.actions.some(action => !action || typeof action !== 'object'
    || ['execute', 'arguments', 'working_directory'].some(key => typeof action[key] !== 'string'))
    || entry.enrolled.triggers.some(trigger => !trigger || typeof trigger !== 'object' || typeof trigger.kind !== 'string' || typeof trigger.start !== 'string'))) return 'enrolled definition';
  if (Object.values(entry).some(value => looksSecret(typeof value === 'string' ? value : JSON.stringify(value)))) return 'secret-shaped value';
  return null;
}

// { status: 'ok', tasks } (none yet is ok with no tasks) or { status: 'unreadable', reason }.
function readRegistry(home) {
  const file = registryPath(home);
  let text;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > READ_LIMIT) return { status: 'unreadable', reason: 'not a small regular file' };
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' ? { status: 'ok', tasks: [] } : { status: 'unreadable', reason: error.code || 'read failed' };
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { status: 'unreadable', reason: 'not valid JSON' }; }
  if (!parsed || parsed.schema !== SCHEMA || !Array.isArray(parsed.tasks)) return { status: 'unreadable', reason: `not a ${SCHEMA} file` };
  const bad = parsed.tasks.map(entryProblem).find(Boolean);
  if (bad) return { status: 'unreadable', reason: `an entry has a bad ${bad}` };
  if (new Set(parsed.tasks.map(entry => entry.id)).size !== parsed.tasks.length) return { status: 'unreadable', reason: 'an id repeats' };
  return { status: 'ok', tasks: parsed.tasks };
}

// Atomic write, mode 600. Refuses to replace a registry it could not read, so nothing recorded is lost.
function writeRegistry(home, tasks) {
  const bad = tasks.map(entryProblem).find(Boolean);
  if (bad) throw new TasksError(`refused to record a task with a bad ${bad}`, 1);
  const file = registryPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ schema: SCHEMA, tasks: [...tasks].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Applies change(tasks) -> tasks to the registry and writes it.
function updateRegistry(home, change) {
  const current = readRegistry(home);
  if (current.status !== 'ok') throw new TasksError(`the task registry ${registryPath(home)} could not be read (${current.reason}), so nothing was recorded. Move it aside and run again.`, 1);
  const next = change(current.tasks.map(entry => ({ ...entry })));
  // Refuse a concurrent owner edit rather than replace a registry read earlier.
  if (JSON.stringify(readRegistry(home)) !== JSON.stringify(current)) throw new TasksError('task registry changed before write', 1);
  writeRegistry(home, next);
  const saved = readRegistry(home);
  if (saved.status !== 'ok' || JSON.stringify([...saved.tasks].sort((a,b) => a.id.localeCompare(b.id))) !== JSON.stringify([...next].sort((a,b) => a.id.localeCompare(b.id)))) throw new TasksError('task registry readback failed', 1);
  return next;
}

function writeTaskBackup(home, id, snapshot) {
  if (!ID.test(String(id))) throw new TasksError('invalid backup task id', 1);
  const file = path.join(userStateDir(home), 'tasks', id, `definition-${crypto.randomBytes(8).toString('hex')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  if (JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) !== JSON.stringify(snapshot)) throw new TasksError('task backup readback failed', 1);
  return file;
}

// The job runner's last-run record, or null.
function readLastRun(id, home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lastRunPath(id, home), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeLastRun(id, record, home) {
  const file = lastRunPath(id, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// ---- skipped runs ------------------------------------------------------------------------------

// The skip reasons the job runner writes. Anything else is shown as a bare "skipped", so no command
// output reaches a session line.
const SKIP_REASON = /^(offline|GitHub authentication status could not be read|gh not signed in|gh is not installed|binding not read in 24 h|binding is missing|binding is invalid|binding does not match origin|binding observation expired|binding refresh failed(?:: (?:default branch fetch failed|GitHub unreachable|origin transport refused|default branch unknown|default branch moved|fetch guards unavailable|commit unreadable|binding unreadable|cache unwritable|governance reads offline|another checkout refresh is running))?|no usable github\.com origin repository|governance status could not be read|governance is (?:ENABLED|DISABLED|UNDECIDED|UNAVAILABLE|ERROR)|no shards yet)$/;
const STALE_MS = 2 * 60 * 60 * 1000;

// HH:MMZ on now's UTC date, else with the date (always with it when now is null).
function shortTime(iso, now) {
  const text = new Date(iso).toISOString();
  return now && text.slice(0, 10) === now.toISOString().slice(0, 10) ? `${text.slice(11, 16)}Z` : `${text.slice(0, 10)} ${text.slice(11, 16)}Z`;
}

// "skipped (offline), 3 runs in a row since 04:00Z" for a skipped record, else null.
function skipText(last, now = null) {
  if (!last || last.status !== 'skipped') return null;
  if (last.reason === 'no shards yet') return 'skipped (no shards yet)';
  const reason = SKIP_REASON.test(String(last.reason || '')) || last.reason === 'ask the appointed controller to initialise the parent state in the private evidence store' ? ` (${last.reason})` : '';
  const count = Number.isInteger(last.skipped_streak) && last.skipped_streak > 0 ? last.skipped_streak : 1;
  const since = typeof last.skipped_since === 'string' && !Number.isNaN(Date.parse(last.skipped_since)) ? last.skipped_since : last.started;
  const when = typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? ` since ${shortTime(since, now)}` : '';
  return `skipped${reason}, ${count} run${count === 1 ? '' : 's'} in a row${when}`;
}

function installedHours(text) {
  const match = /^hourly, ([01]\d|2[0-3]):([0-5]\d) to ([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text));
  if (!match) return null;
  const duration = ((Number(match[3]) * 60 + Number(match[4]) - Number(match[1]) * 60 - Number(match[2]) + 1440) % 1440 + 1) / 60;
  return Number.isInteger(duration) ? { hour: Number(match[1]), minute: Number(match[2]), hours: duration } : null;
}

function deferredText(last, now) {
  const since = [last.deferred_since, last.started].find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime());
  const minutes = since ? Math.floor((now.getTime() - Date.parse(since)) / 60000) : null;
  const count = Number.isSafeInteger(last.deferred_count) && last.deferred_count > 0 ? last.deferred_count : 1;
  const reason = last.reason === 'task time budget exhausted' || SKIP_REASON.test(String(last.reason || '')) ? ` (${last.reason})` : '';
  return `deferred${minutes === null ? '' : ` for ${minutes} minute${minutes === 1 ? '' : 's'}`}, ${count} deferral${count === 1 ? '' : 's'}${reason}; awaiting an eligible task retry`;
}

// The session-start line for this computer's programme sweep of a repository, or null when it is
// fine or there is none: its last run held, skipped or failed, or there has been no run for over 2 hours
// inside its hours. Fixed wording only.
function legacySweepLine(repository, { home = os.homedir(), now = new Date(), registry = readRegistry(home) } = {}) {
  if (registry.status !== 'ok' || typeof repository !== 'string') return null;
  const rows = registry.tasks.filter(item => item.host === 'windows' && ['programme-sweep', 'footer-sweep', 'shard-timings'].includes(item.job) && !item.adopted
    && String(item.repository || '').toLowerCase() === repository.toLowerCase());
  if (!rows.length) return null;
  const computerId = computerIdentity(home)?.id;
  const foreign = rows.find(item => !localTaskOwner(item.job_owner, computerId));
  if (foreign) return `Scheduled jobs: owned by ${safeText(foreign.job_owner_label || foreign.job_owner)}; ${OWNER_RECOVERY}.`;
  const entry = rows.find(item => ['programme-sweep', 'footer-sweep'].includes(item.job));
  if (!entry) {
    const shard = rows.find(row => row.job === 'shard-timings' && !row.stopped_by_owner && readLastRun(row.id, home)?.status === 'deferred');
    return shard ? `Shard timings: ${deferredText(readLastRun(shard.id, home), now)}; see toolkit tasks.` : null;
  }
  const label = entry.job === 'footer-sweep' ? 'Footer sweep' : 'Programme sweep';
  if (entry.stopped_by_owner) return `${label}: stopped by owner; see toolkit tasks.`;
  const last = readLastRun(entry.id, home);
  const deferredShard = registry.tasks.find(item => item.host === 'windows' && item.job === 'shard-timings' && !item.adopted && !item.stopped_by_owner
    && String(item.repository || '').toLowerCase() === repository.toLowerCase() && readLastRun(item.id, home)?.status === 'deferred');
  const withShard = line => [line, deferredShard ? `Shard timings: ${deferredText(readLastRun(deferredShard.id, home), now)}` : null].filter(Boolean).join('; ');
  // Repeated deferrals do not count as completed work or reset the two-hour alarm.
  const at = last && [last.status === 'deferred' ? last.deferred_since : null, last.finished, last.started].find(value => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
  const schedule = installedHours(entry.schedule);
  const intoWindow = schedule ? ((now.getHours() * 60 + now.getMinutes()) - schedule.hour * 60 - schedule.minute + 1440) % 1440 : null;
  const stale = schedule && (schedule.hours === 24 || intoWindow >= STALE_MS / 60000 && intoWindow < schedule.hours * 60) && (!at || now.getTime() - Date.parse(at) > STALE_MS);
  const heldRuns = last?.status === 'held' && Number.isInteger(last.held_streak) && last.held_streak > 1 && typeof last.held_since === 'string' && !Number.isNaN(Date.parse(last.held_since))
    ? `, ${last.held_streak} runs in a row since ${shortTime(last.held_since, now)}` : '';
  const status = skipText(last, now) || (last?.status === 'deferred' ? deferredText(last, now)
    : last && ['failed', 'held'].includes(last.status) && at ? `${last.status} at ${shortTime(at, now)}${heldRuns}` : null);
  if (stale) return `${withShard(`${label}: no run ${at ? `since ${shortTime(at, now)} ` : 'recorded '}(over 2 hours)${status ? `; the last one ${status}` : ''}`)}; see toolkit tasks.`;
  if (status) return `${withShard(`${label}: ${status.startsWith('failed') ? 'last run ' : ''}${status}`)}; see toolkit tasks.`;
  if (deferredShard) return `${withShard(null)}; see toolkit tasks.`;
  return null;
}

// One task line, extended by the cached health result without live hook reads.
function sweepLine(repository, options = {}) {
  options = { ...options, registry: options.registry || readRegistry(options.home || os.homedir()) };
  const sweep = legacySweepLine(repository, options);
  let health = null;
  try { health = require('./toolkit-task-health.cjs').sessionHealth(repository, options.home || os.homedir(), options.registry); } catch { /* Advisory enrichment cannot erase the existing task line. */ }
  return [sweep, health].filter(Boolean).join('; ') || null;
}

// Prevent obsolete recorded task shapes going unnoticed after a governance change. Advisory only:
// uncertain reads fail quiet; no history, directory enumeration, scheduler, process or network work.
function legacyTaskGovernanceLine(state, { home = os.homedir(), platform = process.platform, environment = process.env, registry } = {}) {
  if (platform !== 'win32' || environment.TOOLKIT_GOVERNANCE_OFFLINE === '1') return null;
  const merged = state?.merged;
  const certain = merged?.fresh === true && !merged.unavailable && !state.notes?.includes('could-not-check-governance')
    && (state.state === 'ENABLED' && merged.status === 'enabled'
      || state.state === 'DISABLED' && ['disabled', 'none'].includes(merged.status)
      || state.state === 'UNDECIDED' && merged.status === 'none');
  const wanted = require('./toolkit-task-shape.cjs').confirmedTaskShape({ certain, governanceState: state?.state });
  if (!wanted || typeof state.repository !== 'string' || !REPOSITORY.test(state.repository)) return null;
  registry ??= readRegistry(home);
  if (registry.status !== 'ok' || !Array.isArray(registry.tasks)) return null;
  const jobs = ['programme-sweep', 'shard-timings', 'footer-sweep'];
  const rows = registry.tasks.filter(row => row.host === 'windows' && !row.adopted && row.job !== 'task-health'
    && String(row.repository || '').toLowerCase() === state.repository.toLowerCase());
  if (!rows.length || rows.some(row => !jobs.includes(row.job) || row.stopped_by_owner)) return null;
  // Choices can travel with a surviving row after retirement. Use the latest answer per task,
  // rather than an earlier keep which a later replace has superseded.
  const latest = new Map();
  for (const row of rows) {
    if (row.task_choices !== undefined && !Array.isArray(row.task_choices)) return null;
    const rowChoices = new Map();
    for (const choice of row.task_choices || []) {
      if (!choice || !ID.test(choice.task || '') || !['keep', 'replace'].includes(choice.outcome) || !Number.isFinite(Date.parse(choice.at))) return null;
      rowChoices.set(choice.task, choice);
    }
    for (const choice of rowChoices.values()) {
      const previous = latest.get(choice.task);
      if (previous && Date.parse(previous.at) === Date.parse(choice.at) && previous.outcome !== choice.outcome) return null;
      if (!previous || Date.parse(choice.at) >= Date.parse(previous.at)) latest.set(choice.task, choice);
    }
    // A relationship is proof about a recorded cleaner, never another enrolment.
    if (row.replaces !== undefined && (!row.replaces || Object.keys(row.replaces).join() !== 'cleaner'
      || !['programme-sweep', 'footer-sweep'].includes(row.job)
      || !['programme-sweep', 'footer-sweep'].includes(row.replaces.cleaner?.job)
      || row.replaces.cleaner.job === row.job)) return null;
  }
  if ([...latest.values()].some(choice => choice.outcome === 'keep')) return null;
  if (rows.length === wanted.length && wanted.every(job => rows.filter(row => row.job === job).length === 1)) return null;
  return 'Toolkit tasks: recorded Windows tasks do not match confirmed governance. Read fresh governance status, then run toolkit-windows-tasks.cjs plan --repo-root <repo> from the managed Toolkit checkout. Apply only when existing approval covers that plan; otherwise ask the owner. Preserve owner stops and held keep answers.';
}

function taskGovernanceLine(state, options = {}) {
  const advisory = legacyTaskGovernanceLine(state, options);
  // ENABLED sessions already call sweepLine; the other modes use this same task
  // advisory slot. Never perform scheduler, process or network reads in a hook.
  let health = null;
  try {
    if ((options.platform || process.platform) === 'win32' && state?.repository && state.state !== 'ENABLED') health = require('./toolkit-task-health.cjs').sessionHealth(state.repository, options.home || os.homedir(), options.registry);
  } catch { /* Keep the original task advisory when optional cached health is unreadable. */ }
  return [advisory, health].filter(Boolean).join('; ') || null;
}

// ---- record and forget -----------------------------------------------------------------------

function recordTask(options, { home, now = () => new Date() } = {}) {
  if (!RECORDABLE_HOSTS.includes(options.host)) throw new TasksError(`--record takes --host ${RECORDABLE_HOSTS.join(', ')}; Windows tasks are recorded by toolkit-windows-tasks.cjs`);
  for (const key of ['id', 'name', 'schedule', 'purpose']) if (!options[key]) throw new TasksError(`--record needs --${key}`);
  if ((options.model === undefined) !== (options.effort === undefined)) throw new TasksError('--model and --effort go together');
  const entry = {
    id: options.id, name: options.name, host: options.host, folder: null, schedule: options.schedule,
    model: options.model ?? null, effort: options.effort ?? null, purpose: options.purpose,
    repository: options.repository ?? null, created: now().toISOString(), created_by: 'toolkit-tasks --record',
  };
  const problem = entryProblem(entry);
  if (problem) throw new TasksError(`--record refused: bad ${problem}`);
  updateRegistry(home, tasks => {
    const existing = tasks.find(task => task.id === entry.id);
    if (existing && existing.host === 'windows') throw new TasksError(`${entry.id} is a Windows task; toolkit-windows-tasks.cjs owns it`);
    return [...tasks.filter(task => task.id !== entry.id), existing ? { ...entry, created: existing.created } : entry];
  });
  return entry;
}

function forgetTask(id, { home } = {}) {
  let removed = false;
  updateRegistry(home, tasks => {
    const existing = tasks.find(task => task.id === id);
    if (existing && existing.host === 'windows') throw new TasksError(`${id} is a Windows task; remove it with toolkit-windows-tasks.cjs remove`);
    removed = Boolean(existing);
    return tasks.filter(task => task.id !== id);
  });
  return removed;
}

// ---- listing -----------------------------------------------------------------------------------

const LIVE = 'checked live';
const PRESENCE = 'checked live (name and description only)';
const RECORD = 'from record, not checked live';

function aiText(entry) {
  if (!entry || (entry.model === null && entry.effort === null)) return entry && entry.host === 'windows' ? 'no AI' : 'model not recorded';
  return `${entry.model} at ${entry.effort} effort`;
}

// Windows rows: Toolkit's own, adopted, missing and found-but-not-recorded tasks in each folder,
// and the root-folder n8n backups.
function windowsRows(registry, folders, scheduler, home) {
  const rows = [];
  const entries = registry.filter(entry => entry.host === 'windows');
  const windowsTasks = require('./toolkit-windows-tasks.cjs');
  for (const folder of folders) {
    let live;
    try { live = scheduler.list(folder); }
    catch (error) { rows.push({ host: 'windows', folder, name: `\\${folder}\\`, state: 'could not be read', source: LIVE, detail: safeText(error.message) }); continue; }
    for (const task of live) {
      const marker = windowsTasks.parseMarker(task.description);
      const recorded = entries.find(entry => entry.folder === folder && entry.name === task.name);
      const missingDisabled = recorded?.toolkit_missing === true && task.state === 'Disabled'
        && task.description === require('./toolkit-task-launcher.cjs').DISABLED_DESCRIPTION
        && recorded.enrolled && JSON.stringify(windowsTasks.enrolledDefinition(task)) === JSON.stringify(recorded.enrolled);
      const owned = recorded && !recorded.adopted && (marker && marker.id === recorded.id || missingDisabled);
      const adopted = recorded && recorded.adopted;
      const row = {
        host: 'windows', folder, name: task.name, id: recorded ? recorded.id : null,
        schedule: windowsTasks.describeTriggers(task.triggers) || (recorded ? recorded.schedule : 'no trigger'),
        ai: recorded ? aiText(recorded) : 'not known', purpose: recorded ? recorded.purpose : safeText(task.description),
        source: LIVE, windows_state: task.state, definition_drift: Boolean(recorded?.enrolled && JSON.stringify(windowsTasks.enrolledDefinition(task)) !== JSON.stringify(recorded.enrolled)), native_failed: Number.isInteger(task.last_result) && ![0, 0x41301, 0x41303].includes(task.last_result), last_run: task.last_run, next_run: task.next_run,
        last_result: windowsTasks.describeResult(task.last_result),
      };
      if (owned) {
        const last = readLastRun(recorded.id, home);
        const edited = recorded.enrolled && JSON.stringify(windowsTasks.enrolledDefinition(task)) !== JSON.stringify(recorded.enrolled);
        row.state = !localTaskOwner(recorded.job_owner, computerIdentity(home)?.id) ? `owned by ${recorded.job_owner_label || recorded.job_owner}; ${OWNER_RECOVERY}` : missingDisabled ? 'Toolkit missing; disabled automatically' : recorded.stopped_by_owner || task.state === 'Disabled' ? 'stopped by owner'
          : edited ? ['programme-sweep', 'shard-timings'].includes(recorded.job) ? 'modified; owner choice required' : 'stopped by owner' : 'Toolkit';
        // The job writes its record as it starts and again as it ends, so a record that ended (or,
        // still running, started) before Task Scheduler's last run time, less 2 seconds, belongs to
        // an older run: the newer one stopped before writing anything, and is not shown as the
        // previous good run. A start that IgnoreNew dropped while a run was still going moves the
        // Windows time too; that run's record ends after it and still counts.
        const windowsTime = task.last_run ? Date.parse(task.last_run) : NaN;
        const fresh = last && (!Number.isFinite(windowsTime) || Date.parse(last.finished || last.started) >= windowsTime - 2000);
        if (fresh) {
          Object.assign(row, { last_run: last.finished || last.started || row.last_run, result: safeText(skipText(last) || last.status), summary: (Array.isArray(last.summary) ? last.summary : []).filter(line => !last.reason || !String(line).includes(last.reason)).slice(0, 4).map(line => safeText(line)) });
          if (last.reason !== 'no shards yet' && Number.isInteger(last.skipped_streak) && last.skipped_streak > 0) Object.assign(row, { skipped_streak: last.skipped_streak, skipped_since: safeText(last.skipped_since) });
        }
        else if (Number.isFinite(windowsTime)) row.result = 'no result recorded (the run stopped before writing one)';
      } else if (adopted) row.state = 'adopted (recorded, never changed by Toolkit)';
      else row.state = "found, not recorded (not Toolkit's)";
      rows.push(row);
    }
    for (const entry of entries.filter(item => item.folder === folder && !live.some(task => task.name === item.name))) {
      rows.push({ host: 'windows', folder, name: entry.name, id: entry.id, schedule: entry.schedule, ai: aiText(entry), purpose: entry.purpose, source: RECORD,
        state: !localTaskOwner(entry.job_owner, computerIdentity(home)?.id) ? `owned by ${entry.job_owner_label || entry.job_owner}; ${OWNER_RECOVERY}` : entry.stopped_by_owner ? 'stopped by owner' : 'missing' });
    }
  }
  try {
    for (const task of scheduler.list(null).filter(item => /^n8n-.*backup/i.test(item.name))) {
      rows.push({ host: 'windows', folder: null, name: task.name, schedule: windowsTasks.describeTriggers(task.triggers) || 'no trigger', ai: 'no AI', purpose: safeText(task.description),
        source: LIVE, state: 'outside the folder (not changed)', windows_state: task.state, last_run: task.last_run, last_result: windowsTasks.describeResult(task.last_result) });
    }
  } catch { /* the root folder could not be read; the folder rows stand */ }
  return rows;
}

// Claude Code desktop tasks: one folder per task, with SKILL.md front matter (name, description).
function claudeCodeRows(registry, home) {
  const rows = [];
  const dir = path.join(home, '.claude', 'scheduled-tasks');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name); } catch { names = []; }
  const entries = registry.filter(entry => entry.host === 'claude-code');
  for (const name of names.sort()) {
    let description = '';
    try {
      const text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8').slice(0, 8192);
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const line = front ? /^description:\s*(.+)$/m.exec(front[1]) : null;
      description = line ? line[1].replace(/^["']|["']$/g, '') : '';
    } catch { continue; }
    const recorded = entries.find(entry => entry.id === name || entry.name === name);
    rows.push({ host: 'claude-code', folder: null, name, id: recorded ? recorded.id : null, schedule: recorded ? recorded.schedule : 'schedule not readable here',
      ai: recorded ? aiText(recorded) : 'model not readable here', purpose: recorded ? recorded.purpose : safeText(description),
      source: PRESENCE, state: recorded ? 'recorded' : 'found, not recorded' });
  }
  for (const entry of entries.filter(item => !names.includes(item.id) && !names.includes(item.name))) {
    rows.push({ host: 'claude-code', folder: null, name: entry.name, id: entry.id, schedule: entry.schedule, ai: aiText(entry), purpose: entry.purpose, source: RECORD, state: 'missing' });
  }
  return rows;
}

function recordRows(registry, host) {
  return registry.filter(entry => entry.host === host).map(entry => ({ host, folder: null, name: entry.name, id: entry.id, schedule: entry.schedule, ai: aiText(entry), purpose: entry.purpose,
    source: RECORD, state: 'recorded' }));
}

// The schedule folder of the repository at cwd, or null (not a repository, or no origin).
function currentFolder(cwd, deps) {
  try {
    const windowsTasks = require('./toolkit-windows-tasks.cjs');
    return windowsTasks.folderForCheckout(cwd, deps);
  } catch { return null; }
}

function listTasks({ cwd = process.cwd(), home = os.homedir(), platform = process.platform, scheduler = null, folderFor = currentFolder } = {}) {
  const registry = readRegistry(home);
  const tasks = registry.status === 'ok' ? registry.tasks : [];
  const rows = [];
  const notes = [];
  if (registry.status !== 'ok') notes.push(`The task registry ${registryPath(home)} could not be read (${registry.reason}); recorded tasks are not shown.`);
  if (platform === 'win32') {
    const folders = new Set(tasks.filter(entry => entry.host === 'windows').map(entry => entry.folder));
    const here = folderFor(cwd);
    if (here) folders.add(here);
    const live = scheduler || require('./toolkit-windows-tasks.cjs').powerShellScheduler();
    // Any folder holding a task with Toolkit's marker, so a task whose record was lost still shows.
    try { for (const folder of live.markedFolders()) folders.add(folder); } catch { notes.push('Task Scheduler could not be searched for other Toolkit folders; only recorded folders are shown.'); }
    rows.push(...windowsRows(tasks, [...folders].sort(), live, home));
  } else {
    rows.push(...tasks.filter(entry => entry.host === 'windows').map(entry => ({ host: 'windows', folder: entry.folder, name: entry.name, id: entry.id, schedule: entry.schedule, ai: aiText(entry),
      purpose: entry.purpose, source: RECORD, state: 'recorded (this computer is not Windows)' })));
  }
  rows.push(...claudeCodeRows(tasks, home), ...recordRows(tasks, 'codex'), ...recordRows(tasks, 'claude-cloud'));
  return { schema: 'toolkit.tasks-list.v1', registry: registry.status, rows, notes };
}

const HOST_TEXT = Object.freeze({ windows: 'Windows Task Scheduler', 'claude-cloud': 'Claude cloud', 'claude-code': 'Claude Code on this computer', codex: 'Codex' });

function formatList(result) {
  const lines = [`Scheduled tasks (${result.rows.length}):`];
  for (const row of result.rows) {
    const where = row.host === 'windows' ? `${HOST_TEXT.windows} ${row.folder ? `\\${row.folder}\\` : '(root folder)'}` : HOST_TEXT[row.host];
    const last = row.last_run ? `; last run ${String(row.last_run).slice(0, 16).replace('T', ' ')}${row.result ? ` ${row.result}` : ''}${row.last_result && row.last_result !== 'ok' ? ` (Windows: ${row.last_result})` : ''}` : '';
    const disabled = row.windows_state === 'Disabled' ? '; Disabled (will not run)' : '';
    lines.push(`- ${row.name}: ${row.state}${disabled}. ${where}; ${row.schedule}; ${row.ai}${last}. ${row.purpose ? `${row.purpose} ` : ''}(${row.source})`);
    for (const line of row.summary || []) lines.push(`    ${line}`);
  }
  if (!result.rows.length) lines.push('- none found');
  lines.push(...result.notes);
  return `${lines.join('\n')}\n`;
}

// ---- command line ------------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['--host', '--id', '--name', '--schedule', '--purpose', '--model', '--effort', '--repository', '--forget']);

function parseArgs(argv) {
  if (argv[0] === 'list') argv = argv.slice(1);
  const options = { json: false, record: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--record') options.record = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('--')) throw new TasksError(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else throw new TasksError(`unknown argument ${JSON.stringify(arg)}`);
  }
  const recordOnly = ['host', 'id', 'name', 'schedule', 'purpose', 'model', 'effort', 'repository'].filter(key => options[key] !== undefined);
  if (!options.record && recordOnly.length) throw new TasksError(`--${recordOnly[0]} goes with --record`);
  if (options.record && options.forget !== undefined) throw new TasksError('--record and --forget cannot be used together');
  return options;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  const home = deps.home || os.homedir();
  try {
    const options = parseArgs(argv);
    if (options.record) {
      const entry = recordTask(options, { home, now: deps.now });
      out(options.json ? `${JSON.stringify({ recorded: entry })}\n` : `Recorded ${entry.name} (${HOST_TEXT[entry.host]}).\n`);
      return 0;
    }
    if (options.forget !== undefined) {
      const removed = forgetTask(options.forget, { home });
      out(options.json ? `${JSON.stringify({ forgotten: removed })}\n` : `${removed ? 'Removed' : 'No'} recorded task ${options.forget}${removed ? '' : ' to remove'}.\n`);
      return 0;
    }
    const result = listTasks({ cwd: deps.cwd, home, platform: deps.platform, scheduler: deps.scheduler, folderFor: deps.folderFor });
    out(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatList(result));
    return 0;
  } catch (error) {
    if (error instanceof TasksError) { err(`${error.message}\n${error.exitCode === 2 ? USAGE : ''}`); return error.exitCode; }
    err(`toolkit tasks failed: ${safeText(error.message)}\n`);
    return 1;
  }
}

module.exports = {
  SCHEMA, HOSTS, ID, TasksError, userStateDir, registryPath, lastRunPath, readRegistry, writeRegistry, updateRegistry, writeTaskBackup, readLastRun, writeLastRun,
  computerIdentity, localTaskOwner, OWNER_RECOVERY,
  SKIP_REASON, REPOSITORY, entryProblem, looksSecret, safeText, skipText, sweepLine, taskGovernanceLine, installedHours, recordTask, forgetTask, listTasks, formatList, parseArgs, main, LIVE, PRESENCE, RECORD,
};

if (require.main === module) process.exitCode = main();
