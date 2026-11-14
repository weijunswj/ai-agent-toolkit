'use strict';
// Task updater speed: linked worktrees are not discovered, the plan reports its timings, and a fresh
// cached governance read needs no network. Setup no longer runs the updater at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const health = require('../scripts/toolkit-task-health.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const { world } = require('./support/task-health-world.cjs');
const s = require('./support/windows-task-switch-world.cjs');
function githubFolder(t) {
  const folder = path.join(s.tempHome(t), 'GitHub');
  const main = path.join(folder, 'main-repo'), linked = path.join(folder, 'tkb1'), group = path.join(folder, 'group');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(linked, { recursive: true }); fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../main-repo/.git/worktrees/tkb1\n');
  fs.mkdirSync(path.join(linked, 'inner', '.git'), { recursive: true });
  fs.mkdirSync(path.join(group, 'nested', '.git'), { recursive: true });
  fs.mkdirSync(path.join(group, 'nested-linked'), { recursive: true }); fs.writeFileSync(path.join(group, 'nested-linked', '.git'), 'gitdir: x\n');
  return { folder, main, linked, nested: path.join(group, 'nested') };
}

test('discovery takes main checkouts only: linked worktrees are neither planned nor held', t => {
  const g = githubFolder(t);
  const found = update.discoverCheckouts(g.folder);
  assert.deepEqual(found.map(row => typeof row === 'string' ? row : row.root).sort(), [g.main, g.nested].sort());
  assert.ok(found.every(row => typeof row === 'string'), 'nothing is held');
});

test('the plan reports where its time went', t => {
  const w = world(t);
  const plan = w.updater({ discover: () => [w.root] }).plan();
  for (const key of ['discovery', 'stores', 'ownership', 'total']) assert.ok(Number.isInteger(plan.timings_ms[key]) && plan.timings_ms[key] >= 0, key);
  assert.deepEqual(plan.timings_ms.checkouts.map(row => row.root), [w.root]);
});

test('a fresh certain ENABLED cached read needs no refresh lock and no governance child process', () => {
  const cached = { root: 'C:\\repo', repository: 'example/widget', certain: true, enabled: true, governanceState: 'ENABLED', binding: {} };
  const read = health.freshCheckout('C:\\repo', 'C:\\home', 1000, { readCached: () => cached, lockFactory: () => assert.fail('no lock'), run: () => assert.fail('no child process') });
  assert.equal(read, cached);
});

for (const [name, cached] of [
  ['stale or uncertain', { certain: false, enabled: true, governanceState: 'ENABLED' }],
  ['not enabled', { certain: true, enabled: false, governanceState: 'DISABLED' }],
  ['unreadable', null],
]) {
  test(`a cached read that is ${name} falls back to the refresh under the lock`, () => {
    let locked = false, ran = false;
    const result = health.freshCheckout('C:\\repo', 'C:\\home', 1000, {
      readCached: () => { if (!cached) throw new Error('unreadable'); return cached; },
      lockFactory: () => { locked = true; return { release() {} }; },
      run: () => { ran = true; return { status: 1 }; },
    });
    assert.equal(result, null); assert.equal(locked, true); assert.equal(ran, true);
  });
}
