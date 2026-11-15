'use strict';

// A computer that still has old Toolkit Windows tasks, the way an earlier release's task apply left
// them: a marked task in Task Scheduler (a fake here) and its record with the exact definition read
// back. Toolkit no longer creates these; the fixture lets remove toolkit's legacy cleaner be tested.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const windows = require('../../scripts/toolkit-windows-tasks.cjs');
const tasks = require('../../scripts/toolkit-tasks.cjs');

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-tasks-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-checkout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

function sameDefinition(a, b) {
  return JSON.stringify(windows.enrolledDefinition(a)) === JSON.stringify(windows.enrolledDefinition(b));
}

// The fake keeps the checks the PowerShell side makes: the marker (or the old launcher's disabled
// description) and the exact definition read before removal.
function fakeScheduler(initial = {}) {
  const folders = new Map(Object.entries(initial).map(([folder, list]) => [folder, list.map(task => ({ ...task }))]));
  const calls = [];
  const of = folder => folders.get(folder || '') || [];
  const remove = (folder, name, previous, owned) => {
    const task = of(folder).find(item => item.name === name);
    if (task && !owned(task)) throw new Error('marker');
    if (task && (!previous || !sameDefinition(task, previous))) throw new Error('changed before removal');
    folders.set(folder, of(folder).filter(item => item.name !== name));
    return { removed: Boolean(task) };
  };
  return {
    calls, folders,
    list(folder) { calls.push(['list', folder]); return structuredClone(of(folder)); },
    markedFolders() { return [...folders.entries()].filter(([name, list]) => name && list.some(task => String(task.description).includes('[toolkit-task v1 '))).map(([name]) => name); },
    unregister(folder, name, id, previous) {
      calls.push(['unregister', folder, name]);
      return remove(folder, name, previous, task => String(task.description).includes(`[toolkit-task v1 id=${id} `));
    },
    unregisterDisabled(folder, name, previous) {
      calls.push(['unregister-disabled', folder, name]);
      return remove(folder, name, previous, task => task.description === windows.DISABLED_DESCRIPTION);
    },
    removeFolderIfEmpty(folder) {
      calls.push(['remove-folder', folder]);
      if (!folders.has(folder)) return { folder: 'absent' };
      if (of(folder).length) return { folder: 'kept' };
      folders.delete(folder);
      return { folder: 'removed' };
    },
  };
}

// One old footer cleaner for `example/<name>`, in folder <NAME>, with its record and runner copy.
function enrolLegacy({ home, scheduler, root, name }) {
  const folder = name.toUpperCase(), id = `${name}-footer-sweep`, runner = path.join(windows.runnersDir(home), 'runner-0123456789abcdef.cjs');
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(runner, '// old launcher copy\n');
  const args = `--headless "C:\\Program Files\\nodejs\\node.exe" "${runner}" "C:\\Toolkit" footer-sweep --repo-root "${root}" --task-id ${id}`;
  const live = { name: `${folder} - FOOTER SWEEP`, description: `${folder}: FOOTER SWEEP. Removes the footer. No AI. [toolkit-task v1 id=${id} def=0123456789ab]`, state: 'Ready',
    execute: 'C:\\Windows\\System32\\conhost.exe', arguments: args, working_directory: path.dirname(runner),
    actions: [{ execute: 'C:\\Windows\\System32\\conhost.exe', arguments: args, working_directory: path.dirname(runner) }],
    triggers: [{ kind: 'MSFT_TaskDailyTrigger', start: '2026-10-29T00:01:00+08:00', interval: 'PT1H', duration: 'PT24H' }], last_run: null, last_result: 0x41303 };
  scheduler.folders.set(folder, [...(scheduler.folders.get(folder) || []), live]);
  const entry = { id, name: live.name, host: 'windows', folder, schedule: 'hourly', model: null, effort: null, purpose: 'Removes the footer. No AI.',
    repository: `example/${name}`, created: '2026-10-29T00:00:00.000Z', created_by: 'toolkit-windows-tasks apply', job: 'footer-sweep', definition: '0123456789ab',
    checkout: 'C:\\GitHub\\' + name, toolkit_root: 'C:\\Toolkit', enrolled: windows.enrolledDefinition(live) };
  tasks.updateRegistry(home, list => [...list, entry]);
  return entry;
}

// A task the owner made and Toolkit only recorded as theirs (an earlier release's `adopt`).
function adoptLegacy({ home, scheduler, folder, name, id }) {
  const live = { name, description: 'My own backup job', state: 'Ready', execute: 'C:\\backup.exe', arguments: '', working_directory: '', actions: [{ execute: 'C:\\backup.exe', arguments: '', working_directory: '' }], triggers: [] };
  scheduler.folders.set(folder, [...(scheduler.folders.get(folder) || []), live]);
  const entry = { id, name, host: 'windows', folder, schedule: 'daily', model: null, effort: null, purpose: 'nightly backup', repository: null,
    created: '2026-10-29T00:00:00.000Z', created_by: 'toolkit-windows-tasks adopt', adopted: true };
  tasks.updateRegistry(home, list => [...list, entry]);
  return entry;
}

module.exports = { tempHome, checkout, fakeScheduler, sameDefinition, enrolLegacy, adoptLegacy };
