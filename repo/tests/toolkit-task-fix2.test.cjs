'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const launcher = require('../scripts/toolkit-task-launcher.cjs');
const { world } = require('./support/task-health-world.cjs');
const s = require('./support/windows-task-switch-world.cjs');
const approve = w => update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');

// Two new repositories next to the already-enrolled one, each with its own fake origin.
function withNewRepositories(t, w, names) {
  const roots = names.map(() => s.checkout(t));
  const nameOf = r => names[roots.indexOf(r)] || 'widget';
  const desiredFor = new Map(roots.map((root, index) => {
    const name = names[index];
    const governance = { readIdentity: r => ({ valid: true, root: r, remote: { host: 'github.com', path: `/example/${nameOf(r)}.git` } }), governanceState: () => ({ state: 'DISABLED', merged: { fresh: true, status: 'disabled' } }), readObservation: () => ({ status: 'disabled', fresh: true, binding: s.fixtureBinding(`example/${name}`, name.toUpperCase(), false) }) };
    return [root, windows.desiredTasks({ checkout: root, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE, home: w.home, deps: { identityReader: s.identityReader, governance } })];
  }));
  return { roots, desired: ({ checkout }) => desiredFor.get(checkout) || w.desired };
}

test('N2: a denied registration stops later repositories and TASK HEALTH, and the report still prints', t => {
  const w = world(t); approve(w);
  const extra = withNewRepositories(t, w, ['beta', 'gamma']);
  const register = w.scheduler.register;
  w.scheduler.register = () => { w.scheduler.calls.push(['register-denied']); throw new Error('Access is denied'); };
  const before = w.scheduler.calls.length;
  let printed = '';
  const code = update.main(['--apply', '--json'], { platform: 'win32', home: w.home, scheduler: w.scheduler, toolkitRoot: s.TOOLKIT_ROOT, version: '3.52.0', discover: () => extra.roots, desired: extra.desired, healthOwner: w.owner, stdout: text => { printed += text; }, stderr: text => assert.fail(`no report: ${text}`) });
  assert.equal(code, 1);
  assert.equal(w.scheduler.calls.slice(before).filter(call => call[0] === 'register-denied').length, 1, 'exactly one native write attempt');
  const result = JSON.parse(printed);
  assert.ok(result.results.some(row => row.items?.some(item => item.done === false && /denied/i.test(item.error))), printed);
  assert.ok(result.results.some(row => row.refused && /earlier native task write failed/.test(row.reason)), printed);
  assert.ok(result.results.some(row => row.task === 'task-health' && row.refused && /failed in this run/.test(row.reason)), printed);
  assert.equal(w.scheduler.list('TOOLKIT-HEALTH').length, 0);
  w.scheduler.register = register;
});

test('N2: a TASK HEALTH error is reported beside the repository results instead of replacing them', t => {
  const w = world(t); approve(w);
  const extra = withNewRepositories(t, w, ['beta']);
  const updater = w.updater({ discover: () => extra.roots, desired: extra.desired });
  updater.installHealth = () => { throw new Error('Health task enrolment belongs to another computer; owner inspection required'); };
  const result = updater.run({ apply: true });
  assert.ok(result.results.some(row => row.repository === 'example/beta' && !row.refused && row.items?.every(item => item.done)), JSON.stringify(result.results));
  assert.ok(result.results.some(row => row.task === 'task-health' && row.refused && /another computer/.test(row.reason)), JSON.stringify(result.results));
});

test('G2 recheck Low 2: damaged miss count or receipt history never stops the safety net', t => {
  const w = world(t), state = tasks.userStateDir(w.home), dir = path.join(state, 'tasks', w.entry.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'last-run.json'), '{');
  fs.writeFileSync(path.join(dir, 'missing.json'), '{');
  let disabled = 0;
  const deps = { home: w.home, stderr() {}, disable: () => { disabled++; return '<disabled-fixture/>'; } };
  const missing = path.join(w.home, 'missing'); // The recorded Toolkit checkout is gone.
  tasks.updateRegistry(w.home, rows => rows.map(row => row.id === w.entry.id ? { ...row, toolkit_root: missing } : row));
  const args = [missing, w.entry.job, '--task-id', w.entry.id];
  for (let miss = 1; miss <= 3; miss++) assert.equal(launcher.launch(args, deps), launcher.MISSING_EXIT);
  assert.equal(disabled, 1);
  assert.equal(tasks.readLastRun(w.entry.id, w.home).exit, launcher.MISSING_EXIT);
});
