'use strict';

// The task record Toolkit kept for its old scheduled tasks (tasks.json in Toolkit's user-state
// folder, schema toolkit.tasks.v1). Toolkit no longer creates tasks on a computer, so nothing adds to
// it: setup reads it to name old Toolkit tasks still recorded here, and `remove toolkit`
// (toolkit-remove.cjs) reads it and clears the entries of the tasks it removes. A task the owner
// adopted stays the owner's. userStateDir() is also the folder other Toolkit scripts share.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SECRET_SHAPES } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');

const SCHEMA = 'toolkit.tasks.v1';
const HOSTS = Object.freeze(['windows', 'claude-cloud', 'claude-code', 'codex']);
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const READ_LIMIT = 512 * 1024;
const TEXT_LIMIT = 300;

class TasksError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

function userStateDir(home = os.homedir()) { return path.join(home, '.ai-agent-toolkit', 'user-state'); }
function registryPath(home) { return path.join(userStateDir(home), 'tasks.json'); }

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

// An entry an earlier release wrote, checked so a damaged or tampered record plans nothing.
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

module.exports = { SCHEMA, HOSTS, ID, TasksError, userStateDir, registryPath, readRegistry, writeRegistry, updateRegistry, looksSecret, safeText };
