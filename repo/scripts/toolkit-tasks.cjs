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
// marked nor recorded shows "found, not recorded (not Toolkit's)".
//
// The registry is ~/.ai-agent-toolkit/user-state/tasks.json (toolkit.tasks.v1). Only
// toolkit-windows-tasks.cjs writes its Windows entries; the only writes this script makes are
//   --record --host <claude-cloud|claude-code|codex> --id <id> --name <name> --schedule <text>
//            --purpose <text> [--model <model> --effort <effort>] [--repository <owner/name>]
//            records a task another host runs (the Projects coordinator records each cloud task it
//            creates); an entry with the same id is replaced
//   --forget <id>   removes such an entry once its task is deleted (Windows entries are removed by
//            toolkit-windows-tasks.cjs remove)
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
  for (const key of ['model', 'effort']) if (entry[key] !== null && !isText(entry[key], 80)) return key;
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
  writeRegistry(home, next);
  return next;
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
      const owned = recorded && !recorded.adopted && marker && marker.id === recorded.id;
      const adopted = recorded && recorded.adopted;
      const row = {
        host: 'windows', folder, name: task.name, id: recorded ? recorded.id : null,
        schedule: windowsTasks.describeTriggers(task.triggers) || (recorded ? recorded.schedule : 'no trigger'),
        ai: recorded ? aiText(recorded) : 'not known', purpose: recorded ? recorded.purpose : safeText(task.description),
        source: LIVE, windows_state: task.state, last_run: task.last_run, next_run: task.next_run,
        last_result: windowsTasks.describeResult(task.last_result),
      };
      if (owned) {
        const last = readLastRun(recorded.id, home);
        row.state = 'Toolkit';
        // The job writes its record as it starts and again as it ends, so a record that ended (or,
        // still running, started) before Task Scheduler's last run time, less 2 seconds, belongs to
        // an older run: the newer one stopped before writing anything, and is not shown as the
        // previous good run. A start that IgnoreNew dropped while a run was still going moves the
        // Windows time too; that run's record ends after it and still counts.
        const windowsTime = task.last_run ? Date.parse(task.last_run) : NaN;
        const fresh = last && (!Number.isFinite(windowsTime) || Date.parse(last.finished || last.started) >= windowsTime - 2000);
        if (fresh) Object.assign(row, { last_run: last.finished || last.started || row.last_run, result: safeText(last.status), summary: (Array.isArray(last.summary) ? last.summary : []).slice(0, 4).map(line => safeText(line)) });
        else if (Number.isFinite(windowsTime)) row.result = 'no result recorded (the run stopped before writing one)';
      } else if (adopted) row.state = 'adopted (recorded, never changed by Toolkit)';
      else row.state = "found, not recorded (not Toolkit's)";
      rows.push(row);
    }
    for (const entry of entries.filter(item => item.folder === folder && !live.some(task => task.name === item.name))) {
      rows.push({ host: 'windows', folder, name: entry.name, id: entry.id, schedule: entry.schedule, ai: aiText(entry), purpose: entry.purpose, source: RECORD, state: 'missing' });
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
    lines.push(`- ${row.name}: ${row.state}. ${where}; ${row.schedule}; ${row.ai}${last}. ${row.purpose ? `${row.purpose} ` : ''}(${row.source})`);
    for (const line of row.summary || []) lines.push(`    ${line}`);
  }
  if (!result.rows.length) lines.push('- none found');
  lines.push(...result.notes);
  return `${lines.join('\n')}\n`;
}

// ---- command line ------------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['--host', '--id', '--name', '--schedule', '--purpose', '--model', '--effort', '--repository', '--forget']);

function parseArgs(argv) {
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

if (require.main === module) process.exitCode = main();

module.exports = {
  SCHEMA, HOSTS, ID, TasksError, userStateDir, registryPath, lastRunPath, readRegistry, writeRegistry, updateRegistry, readLastRun, writeLastRun,
  entryProblem, looksSecret, safeText, recordTask, forgetTask, listTasks, formatList, parseArgs, main, LIVE, PRESENCE, RECORD,
};
