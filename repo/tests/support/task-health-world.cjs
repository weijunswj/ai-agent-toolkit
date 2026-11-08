'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const tasks = require('../../scripts/toolkit-tasks.cjs');
const windows = require('../../scripts/toolkit-windows-tasks.cjs');
const health = require('../../scripts/toolkit-task-health.cjs');
const update = require('../../scripts/toolkit-update-scheduled-task.cjs');
const s = require('./windows-task-switch-world.cjs');
function world(t) {
  const home = s.tempHome(t), scheduler = s.fakeScheduler(), root = s.checkout(t);
  const read = { root, repository: 'example/widget', enabled: false, certain: true, governanceState: 'DISABLED' };
  const governance = { readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: '/example/widget.git' } }), governanceState: () => ({ state: 'DISABLED', merged: { fresh: true, status: 'disabled' } }), readObservation: () => ({ status: 'disabled', fresh: true, binding: s.fixtureBinding('example/widget', 'WIDGET', false) }) };
  const desired = windows.desiredTasks({ checkout: root, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE, home, deps: { identityReader: s.identityReader, governance } });
  const apply = windows.applyTasks(desired, { home, scheduler }); assert.ok(!apply.refused, JSON.stringify(apply));
  const at = new Date();
  const owner = new health.TaskHealth({ home, scheduler, platform: 'win32', now: () => at, version: '3.52.0', checkout: () => null });
  const updater = options => new update.TaskUpdater({ home, scheduler, toolkitRoot: s.TOOLKIT_ROOT, version: '3.52.0', discover: () => [], desired: () => desired, healthOwner: owner, ...options });
  return { home, scheduler, root, desired, owner, updater, at, entry: tasks.readRegistry(home).tasks[0] };
}
function memoryStore() {
  const files = new Map(), writes = [];
  return { files, writes, verify: () => true, list: () => [...files].filter(([key]) => /^task-health\/computer-[a-f0-9]{12}\.json$/.test(key)).map(([, value]) => value.doc), read: file => files.get(file) || { doc: null, sha: null }, put(file, doc, sha) { assert.equal(sha, files.get(file)?.sha || null); files.set(file, { doc: structuredClone(doc), sha: String(writes.length + 1) }); writes.push(file); } };
}
module.exports = { world, memoryStore };
