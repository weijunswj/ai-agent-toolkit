'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const s = require('./support/windows-task-switch-world.cjs');
function definition(t) {
  const root = s.checkout(t), home = s.tempHome(t);
  return windows.desiredTasks({ checkout: root, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE, home, deps: { identityReader: s.identityReader,
    governance: { readIdentity: () => ({ valid: true, root, remote: { host: 'github.com', path: '/example/widget.git' } }), governanceState: () => ({ state: 'DISABLED', merged: { status: 'none', fresh: true } }), readObservation: () => ({ status: 'none', fresh: true }) } } }).wanted[0];
}
test('missing-checkout bug: the registered executable payload survives removal of the managed checkout', t => {
  const task = definition(t), quotes = [...task.arguments.matchAll(/"([^"]+)"/g)].map(match => match[1]), payload = quotes[1];
  // A relative path that climbs out, or an absolute one (another drive or root), is outside the checkout.
  const relative = path.win32.relative(s.TOOLKIT_ROOT, payload);
  assert.ok(relative.startsWith('..') || path.win32.isAbsolute(relative), 'the bootstrap payload must live outside the removable Toolkit checkout');
});
test('missing-checkout bug: Task Scheduler working directory survives removal of the managed checkout', t => {
  const task = definition(t);
  assert.notEqual(task.working_directory, s.TOOLKIT_ROOT, 'Task Scheduler must be able to start the surviving bootstrap');
});
