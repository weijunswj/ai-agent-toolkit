'use strict';
// Setup and refresh speed: linked worktrees are not discovered, setup skips an unchanged scheduled-task
// update, held rows are named in setup's own output, and a fresh cached governance read needs no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('../scripts/toolkit-tasks.cjs');
const health = require('../scripts/toolkit-task-health.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const { applyScheduledTasks } = require('../scripts/setup-toolkit-core.cjs');
const { world } = require('./support/task-health-world.cjs');
const s = require('./support/windows-task-switch-world.cjs');
const approve = w => update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
const HOUR = 60 * 60 * 1000;

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

function clocked(w, start) {
  let now = start;
  const updater = options => w.updater({ now: () => new Date(now), ...options });
  return { updater, advance: ms => { now += ms; } };
}

// Each row: what changes after a clean update, and whether setup may still skip it.
const CASES = [
  { name: 'nothing changed, under 24 hours', change: () => {}, skip: true },
  { name: 'stamp older than 24 hours', change: (w, c) => c.advance(update.CHECK_MAX_AGE_MS + 1), skip: false },
  { name: 'Toolkit version changed', change: () => {}, options: { version: '3.53.0' }, skip: false },
  { name: 'task registry changed', change: w => tasks.updateRegistry(w.home, rows => rows.map(row => row.job === 'task-health' ? row : ({ ...row, stopped_by_owner: true, stopped_at: '2026-11-12T10:30:00.000Z' }))), skip: false },
  { name: 'a checkout appeared', change: () => {}, options: { discover: () => ['C:\\Users\\x\\GitHub\\new-repo'] }, skip: false },
  { name: 'approval changed', change: w => update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing-again' }, '3.52.0', new Date(0)), skip: false },
  { name: 'stamp unreadable', change: w => fs.writeFileSync(path.join(tasks.userStateDir(w.home), 'scheduled-task-check.json'), '{'), skip: false },
];
for (const row of CASES) {
  test(`setup skip matrix: ${row.name}`, t => {
    const w = world(t); approve(w);
    const c = clocked(w, Date.parse('2026-11-12T10:00:00Z'));
    const lines = [];
    const first = applyScheduledTasks({}, { home: w.home, platform: 'win32', updater: c.updater(), log: line => lines.push(line) });
    assert.equal(first.held, false, lines.join('\n'));
    assert.ok(lines.includes('Scheduled tasks updated and read back.'));
    assert.ok(lines.some(line => /^Scheduled tasks checked in \d+ s\.$/.test(line)));
    row.change(w, c); c.advance(HOUR);
    let ran = false;
    const second = c.updater(row.options || {});
    const run = second.run.bind(second); second.run = options => { ran = true; return run(options); };
    lines.length = 0;
    const result = applyScheduledTasks({}, { home: w.home, platform: 'win32', updater: second, log: line => lines.push(line) });
    assert.equal(result.held, false, lines.join('\n'));
    assert.equal(ran, !row.skip);
    assert.equal(lines.some(line => /^Scheduled tasks: unchanged since 2026-11-12T10:00:00\.000Z; not rechecked\.$/.test(line)), row.skip, lines.join('\n'));
  });
}

test('a held update names each held row in setup output and saves no stamp, so the next setup checks again', t => {
  const w = world(t); approve(w);
  const held = { root: 'C:\\Users\\x\\GitHub\\locked', held: true, reason: 'Checkout folder could not be read; check local folder access, then retry.' };
  const updater = () => w.updater({ discover: () => [held] });
  const lines = [];
  const result = applyScheduledTasks({}, { home: w.home, platform: 'win32', updater: updater(), log: line => lines.push(line) });
  assert.equal(result.held, true);
  assert.ok(lines.includes('Scheduled task update needs an owner answer or a local repair:'));
  assert.ok(lines.includes(`- ${held.root}: ${held.reason}`), lines.join('\n'));
  assert.equal(lines.some(line => /inspect the direct update plan/.test(line)), false);
  assert.equal(fs.existsSync(path.join(tasks.userStateDir(w.home), 'scheduled-task-check.json')), false);
  assert.equal(updater().recentCheck(), null);
});

test('the direct command never skips: run() checks in full even with a fresh stamp', t => {
  const w = world(t); approve(w);
  applyScheduledTasks({}, { home: w.home, platform: 'win32', updater: w.updater(), log: () => {} });
  assert.ok(w.updater().recentCheck(), 'stamp saved after a clean update');
  const result = w.updater().run({ apply: true });
  assert.ok(Array.isArray(result.results) && result.results.length > 0);
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
