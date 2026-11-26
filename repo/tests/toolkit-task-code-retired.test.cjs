'use strict';

// Toolkit's Windows scheduled-task code is deleted. Only the legacy cleaner that `remove toolkit`
// uses stays: it lists and removes old Toolkit-marked tasks after the owner's OK, and never touches
// a task the owner made or adopted. These checks fail if any deleted runner, planner or session line
// comes back, or if a live script still needs a deleted module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const DELETED = ['toolkit-scheduled-job', 'toolkit-task-launcher', 'toolkit-task-health', 'toolkit-update-scheduled-task',
  'toolkit-task-schedule', 'toolkit-task-shape', 'toolkit-task-policy'];

test('the task runner, launcher, health check, updater and planner helpers are gone', () => {
  for (const name of DELETED) assert.equal(fs.existsSync(path.join(ROOT, 'repo', 'scripts', `${name}.cjs`)), false, name);
});

test('no live script, skill, workflow or contract names a deleted task module', () => {
  const listed = spawnSync('git', ['ls-files', '-z', 'repo/scripts', 'repo/contracts', 'skills', '.github', 'hooks'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const pattern = new RegExp(`\\b(?:${DELETED.join('|')})\\.cjs\\b`);
  // One named exception: toolkit permissions lists retired script paths in RETIRED_SCRIPTS only to
  // recognise an old Toolkit permission line that points at one; it never loads them (checked below).
  const LISTER = 'repo/scripts/toolkit-permissions.cjs';
  const textOf = file => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return file === LISTER ? text.split(/\r?\n/).filter(line => !line.startsWith('const RETIRED_SCRIPTS = ')).join('\n') : text;
  };
  const named = listed.stdout.split('\0').filter(Boolean)
    .filter(file => fs.existsSync(path.join(ROOT, file)) && pattern.test(textOf(file)));
  assert.deepEqual(named, []);
  const lister = fs.readFileSync(path.join(ROOT, LISTER), 'utf8');
  assert.match(lister, /^const RETIRED_SCRIPTS = /m, 'the exception still has its one line');
  assert.doesNotMatch(lister, new RegExp(`require\\([^)]*(?:${DELETED.join('|')})`), 'it never loads a deleted module');
});

test('the task registry keeps only what remove toolkit and setup read; no session-start task line is left', () => {
  const tasks = require('../scripts/toolkit-tasks.cjs');
  for (const name of ['sweepLine', 'taskGovernanceLine', 'listTasks', 'formatList', 'recordTask', 'forgetTask', 'readLastRun', 'writeLastRun', 'main'])
    assert.equal(Object.hasOwn(tasks, name), false, name);
  for (const name of ['userStateDir', 'registryPath', 'readRegistry', 'writeRegistry', 'updateRegistry', 'safeText', 'ID'])
    assert.ok(Object.hasOwn(tasks, name), name);
});

test('the Windows task module is only the legacy cleaner: it reads and removes, and cannot create, start or adopt', () => {
  const windows = require('../scripts/toolkit-windows-tasks.cjs');
  for (const name of ['desiredTasks', 'applyTasks', 'planTasks', 'adoptTask', 'startTask', 'firstRun', 'installLauncher', 'WindowsTaskOwner', 'main'])
    assert.equal(Object.hasOwn(windows, name), false, name);
  assert.deepEqual(Object.keys(windows.SCRIPTS).sort(), ['list', 'marked-folders', 'remove-folder', 'unregister']);
  assert.deepEqual(Object.keys(windows.powerShellScheduler({ run: () => ({ status: 0, stdout: '[]' }) })).sort(),
    ['list', 'markedFolders', 'removeFolderIfEmpty', 'unregister', 'unregisterDisabled']);
});

test('setup no longer takes the retired task flags', () => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  assert.throws(() => core.parseArgs(['--execute', '--profile', 'auto-main', '--scheduled-task-update', 'keep']), /Unknown argument: --scheduled-task-update/);
  assert.equal(Object.hasOwn(core, 'SCHEDULED_TASK_FLAG_RETIRED'), false);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'setup-toolkit-core.cjs'), 'utf8'), /--remove-toolkit-tasks|--scheduled-task-update/);
});
