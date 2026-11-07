'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const launcher = require('../scripts/toolkit-task-launcher.cjs');
const s = require('./support/windows-task-switch-world.cjs');
test('missing-checkout runner lives outside the checkout and has a surviving working directory', t => {
  const home = s.tempHome(t), root = s.checkout(t);
  const desired = windows.desiredTasks({ checkout: root, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE, home,
    deps: { identityReader: s.identityReader, governance: { readIdentity: () => ({ valid: true, root, remote: { host: 'github.com', path: '/example/widget.git' } }), governanceState: () => ({ state: 'DISABLED', merged: { status: 'none', fresh: true } }), readObservation: () => ({ status: 'none', fresh: true }) } } });
  const definition = desired.wanted[0];
  assert.ok(definition.arguments.includes(windows.launcherPath(home)));
  assert.equal(definition.working_directory, path.dirname(windows.launcherPath(home)));
  const installed = windows.installLauncher(home);
  assert.equal(fs.readFileSync(installed, 'utf8'), fs.readFileSync(require.resolve('../scripts/toolkit-task-launcher.cjs'), 'utf8'));
});
test('three missing runs fail, write exactly one line each, disable without delete; restored setup re-enables', t => {
  const home = s.tempHome(t), scheduler = s.fakeScheduler(), root = s.checkout(t), managed = path.join(home, 'managed');
  const governance = { readIdentity: () => ({ valid: true, root, remote: { host: 'github.com', path: '/example/widget.git' } }), governanceState: () => ({ state: 'DISABLED', merged: { status: 'none', fresh: true } }), readObservation: () => ({ status: 'none', fresh: true }) };
  const desired = windows.desiredTasks({ checkout: root, toolkitRoot: managed, nodePath: s.NODE, home, deps: { identityReader: s.identityReader, governance } });
  const installed = windows.applyTasks(desired, { home, scheduler }); assert.ok(!installed.refused);
  const entry = tasks.readRegistry(home).tasks[0], live = scheduler.folders.get(entry.folder)[0];
  let disabled = 0, output = '';
  const args = [managed, entry.job, '--repo-root', root, '--task-id', entry.id];
  const deps = { home, stderr: text => { output += text; }, disable: row => {
    disabled++; assert.equal(row.id, entry.id); live.state = 'Disabled'; live.description = launcher.DISABLED_DESCRIPTION; live.definition_xml = '<disabled-fixture/>'; return live.definition_xml;
  } };
  for (let miss = 1; miss <= 3; miss++) assert.equal(launcher.launch(args, deps), launcher.MISSING_EXIT);
  assert.equal(output, (launcher.MISSING_LINE + '\n').repeat(3)); assert.equal(disabled, 1);
  assert.equal(scheduler.list(entry.folder).length, 1); assert.equal(live.description, launcher.DISABLED_DESCRIPTION);
  assert.equal(tasks.readRegistry(home).tasks[0].toolkit_missing, true);
  const list = tasks.formatList(tasks.listTasks({ home, scheduler, platform: 'win32', folderFor: () => null }));
  assert.match(list, /Toolkit missing; disabled automatically/);
  assert.match(list, /failed/);
  assert.ok(!scheduler.calls.some(call => call[0] === 'unregister'));
  fs.mkdirSync(path.join(managed, 'repo/scripts'), { recursive: true }); fs.writeFileSync(path.join(managed, 'repo/scripts/toolkit-scheduled-job.cjs'), 'process.exitCode=0;\n');
  const repaired = windows.applyTasks(desired, { home, scheduler, repairOwned: true });
  assert.ok(!repaired.refused && repaired.items.every(item => item.done !== false), JSON.stringify(repaired));
  assert.equal(scheduler.list(entry.folder)[0].state, 'Ready'); assert.equal(tasks.readRegistry(home).tasks[0].toolkit_missing, undefined);
  assert.equal(launcher.launch(args, { home, run: () => ({ status: 0 }) }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tasks.userStateDir(home), 'tasks', entry.id, 'missing.json'))), { misses: 0 });
});
test('missing launcher cannot disable a task changed since enrolment', t => {
  const home = s.tempHome(t), id = 'widget-footer-sweep', managed = path.join(home, 'missing');
  const entry = { id, host: 'windows', folder: 'WIDGET', name: 'WIDGET - FOOTER SWEEP', repository: 'example/widget', schedule: 'hourly', purpose: 'Fixture', created: new Date().toISOString(), created_by: 'fixture', model: null, effort: null, toolkit_root: managed, enrolled: { description: 'fixture', enabled: true, actions: [{ execute: 'node', arguments: '', working_directory: managed }], triggers: [] } };
  tasks.writeRegistry(home, [entry]); let calls = 0;
  const deps = { home, stderr: () => {}, disable: () => { calls++; throw new Error('Task changed; left alone'); } }, args = [managed, 'footer-sweep', '--task-id', id];
  launcher.launch(args, deps); launcher.launch(args, deps); assert.throws(() => launcher.launch(args, deps), /Task changed/);
  assert.equal(calls, 1); assert.equal(tasks.readRegistry(home).tasks[0].toolkit_missing, undefined);
});
test('installed missing runner returns its own non-zero code as a real Node process', t => {
  const home = s.tempHome(t), file = windows.installLauncher(home);
  const result = spawnSync(process.execPath, [file, path.join(home, 'missing'), 'footer-sweep', '--task-id', 'widget-footer-sweep'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(result.status, launcher.MISSING_EXIT); assert.equal(result.stderr, launcher.MISSING_LINE + '\n');
});

test('a refresh during apply cannot change the planned bootstrap payload', t => {
  const home = s.tempHome(t), expected = windows.launcherPath(home), sourceFile = require.resolve('../scripts/toolkit-task-launcher.cjs');
  const source = fs.readFileSync(sourceFile, 'utf8'), read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => String(file) === sourceFile ? source + '// concurrent refresh' : read(file, ...args));
  assert.equal(windows.launcherPath(home), expected);
  assert.equal(windows.installLauncher(home), expected);
  assert.equal(read(expected, 'utf8'), source);
});
