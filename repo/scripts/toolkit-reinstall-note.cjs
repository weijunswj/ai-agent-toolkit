'use strict';

// The reinstall note `remove toolkit` leaves in ~/.ai-agent-toolkit/backups (a folder the removal
// keeps), so a later `setup toolkit` can put back what the owner had chosen:
//   helpers  the helper stack each app's Toolkit helper files named (the stack is recorded only in
//            those files, which the removal deletes)
//   tasks    each repository checkout and Task Scheduler folder whose Toolkit tasks were removed
// Setup reinstalls a noted helper stack only where no helper file is installed, and only offers the
// tasks (the exact apply line), because creating scheduled tasks stays the owner's call. Each entry
// is dropped once it is restored; the note goes when it is empty. It holds no keys or secrets.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEMA = 'toolkit.reinstall-note.v1';
const HOSTS = Object.freeze(['claude-code', 'codex']);
const STACK = /^[A-Za-z0-9._-]{1,64}$/;
const FOLDER = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

function notePath(home = os.homedir()) { return path.join(home, '.ai-agent-toolkit', 'backups', 'remove-toolkit', 'reinstall.json'); }

// Keeps only well-formed entries, so a hand-edited or damaged note can never name a strange stack or path.
function clean(value) {
  const helpers = {};
  for (const host of HOSTS) if (typeof value?.helpers?.[host] === 'string' && STACK.test(value.helpers[host])) helpers[host] = value.helpers[host];
  const seen = new Set();
  const tasks = (Array.isArray(value?.tasks) ? value.tasks : [])
    .filter(task => typeof task?.checkout === 'string' && (path.isAbsolute(task.checkout) || path.win32.isAbsolute(task.checkout)))
    .filter(task => typeof task.folder === 'string' && FOLDER.test(task.folder))
    .map(task => ({ checkout: task.checkout, folder: task.folder, ...(typeof task.repository === 'string' && task.repository ? { repository: task.repository } : {}) }))
    .filter(task => { const key = `${task.checkout.toLowerCase()}\u0000${task.folder}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => a.checkout.localeCompare(b.checkout) || a.folder.localeCompare(b.folder));
  return { helpers, tasks };
}

const empty = note => !Object.keys(note.helpers).length && !note.tasks.length;

// The note, or null when there is none or it cannot be read.
function readNote(home = os.homedir()) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(notePath(home), 'utf8')); } catch { return null; }
  if (parsed?.schema !== SCHEMA) return null;
  const note = clean(parsed);
  return empty(note) ? null : { ...note, saved_at: typeof parsed.saved_at === 'string' ? parsed.saved_at : null };
}

function writeNote(home, note, now) {
  const file = notePath(home);
  if (empty(note)) { fs.rmSync(file, { force: true }); return null; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ schema: SCHEMA, saved_at: now, ...note }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

// Adds to any note an earlier removal left: a newer stack for a host replaces the older one.
function saveNote(home, { helpers = {}, tasks = [] } = {}, now = new Date()) {
  const earlier = readNote(home) || { helpers: {}, tasks: [] };
  return writeNote(home, clean({ helpers: { ...earlier.helpers, ...helpers }, tasks: [...tasks, ...earlier.tasks] }), now.toISOString());
}

// Drops restored entries: a host whose helpers are back, and task checkouts that are back on record.
function dropFromNote(home, { helper = null, checkouts = [] } = {}) {
  const note = readNote(home);
  if (!note) return null;
  const gone = new Set(checkouts.map(item => String(item).toLowerCase()));
  const helpers = { ...note.helpers };
  if (helper) delete helpers[helper];
  return writeNote(home, { helpers, tasks: note.tasks.filter(task => !gone.has(task.checkout.toLowerCase())) }, note.saved_at || new Date().toISOString());
}

// Setup, per app: when the note names a helper stack for this app and no Toolkit helper file is
// installed, install that stack. `definitions` is the app's ClaudeHelperDefinitions or
// CodexHelperDefinitions. Returns null when the note has nothing for this app.
function restoreHelpers(host, definitions, { home = os.homedir() } = {}) {
  const stack = readNote(home)?.helpers?.[host];
  if (!stack) return null;
  const status = definitions.check().status;
  if (status !== 'not-installed') {
    // Helpers are there again (the owner or a refresh put them back), so the note has done its job.
    if (status === 'current' || status === 'stale') dropFromNote(home, { helper: host });
    return { status: 'already-installed', stack };
  }
  const result = typeof definitions.install === 'function' ? definitions.install({ stack }) : definitions.refresh({ stack });
  if (result.status === 'installed') dropFromNote(home, { helper: host });
  return { ...result, stack };
}

// Setup on Windows: the noted task checkouts that have no Toolkit task on record, each with the exact
// line that puts its tasks back. Nothing is created here. Checkouts that are back on record, or no
// longer exist, are dropped from the note.
function taskOffers({ home = os.homedir(), toolkitRoot = path.resolve(__dirname, '..', '..'), registry = require('./toolkit-tasks.cjs'), exists = fs.existsSync } = {}) {
  const note = readNote(home);
  if (!note?.tasks.length) return [];
  const read = registry.readRegistry(home);
  const recorded = read.status === 'ok' ? read.tasks.filter(entry => entry.host === 'windows' && !entry.adopted && typeof entry.checkout === 'string') : [];
  const back = note.tasks.filter(task => recorded.some(entry => entry.checkout.toLowerCase() === task.checkout.toLowerCase()) || !exists(task.checkout));
  if (back.length) dropFromNote(home, { checkouts: back.map(task => task.checkout) });
  const script = path.join(toolkitRoot, 'repo', 'scripts', 'toolkit-windows-tasks.cjs').replace(/\\/g, '/');
  return note.tasks.filter(task => !back.includes(task)).map(task => ({ ...task,
    plan: `node "${script}" plan --repo-root "${task.checkout.replace(/\\/g, '/')}"`,
    apply: `node "${script}" apply --repo-root "${task.checkout.replace(/\\/g, '/')}"` }));
}

// Setup's line for one app's helper restore; null when the note had nothing for that app. A restore
// that throws is reported, never fatal: the helpers can still be installed with their generator.
function restoreHelpersLine(host, definitions, options = {}) {
  const app = host === 'codex' ? 'Codex' : 'Claude Code';
  let result;
  try { result = restoreHelpers(host, definitions, options); }
  catch (error) { return `${app} helpers from the reinstall note: not restored (${String(error.code || error.message).slice(0, 200)}); setup toolkit tries again next time.`; }
  if (!result || result.status === 'already-installed') return null;
  if (result.status === 'installed') return `${app} helpers: put back for stack ${result.stack}, the stack they had before remove toolkit.`;
  return `${app} helpers from the reinstall note (stack ${result.stack}): not restored, ${result.detail || result.status}.`;
}

// The setup lines for the task offers.
function describeTaskOffers(offers) {
  if (!offers.length) return [];
  return ['Scheduled tasks removed by `remove toolkit` are not back yet. Setup does not create them; ask the owner, then run the apply line (the plan line only shows them):',
    ...offers.flatMap(task => [`- ${task.repository || task.checkout} (Task Scheduler folder \\${task.folder}\\):`, `  plan:  ${task.plan}`, `  apply: ${task.apply}`])];
}

module.exports = { SCHEMA, HOSTS, notePath, readNote, saveNote, dropFromNote, restoreHelpers, restoreHelpersLine, taskOffers, describeTaskOffers };
