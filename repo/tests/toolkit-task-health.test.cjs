'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const health = require('../scripts/toolkit-task-health.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const s = require('./support/windows-task-switch-world.cjs');
const { world, memoryStore } = require('./support/task-health-world.cjs');
test('health reports hand-edited drift and updater asks keep or replace per task', t => {
  const w = world(t), live = w.scheduler.folders.get('WIDGET')[0];
  live.actions[0].arguments += ' changed'; live.arguments += ' changed';
  const doc = w.owner.run().document;
  assert.ok(doc.repos[0].flags.includes('footer-sweep: definition drift'));
  update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
  let asks = 0;
  const result = w.updater({ question: question => { asks++; assert.equal(question.kind, 'task-choice'); return { outcome: 'keep', observation: question.observation, answer_ref: `host/keep-${asks}` }; } }).run({ apply: true });
  assert.equal(asks, 1); assert.ok(result.results[0].refused);
  w.updater({ question: question => { asks++; return { outcome: 'keep', observation: question.observation, answer_ref: `host/keep-${asks}` }; } }).run({ apply: true });
  assert.equal(asks, 2, 'hand edits ask per invocation');
});
test('health flags missing, disabled, failed, skipped streak and stale task code; owner stops stay quiet', t => {
  const w = world(t), live = w.scheduler.folders.get('WIDGET')[0];
  tasks.writeLastRun(w.entry.id, { status: 'failed', skipped_streak: 3, started: w.at.toISOString() }, w.home);
  tasks.updateRegistry(w.home, rows => rows.map(row => ({ ...row, toolkit_version: '3.51.0' })));
  live.state = 'Disabled';
  let row = w.owner.collect().repos[0];
  for (const expected of ['disabled task', 'last run failed', 'skipped 3 runs', 'task code older']) assert.ok(row.flags.some(flag => flag.includes(expected)), JSON.stringify(row));
  w.scheduler.folders.set('WIDGET', []);
  assert.ok(w.owner.collect().repos[0].flags.some(flag => flag.includes('missing task')));
  tasks.updateRegistry(w.home, rows => rows.map(row => ({ ...row, stopped_by_owner: true, stopped_at: w.at.toISOString() })));
  row = w.owner.collect().repos[0]; assert.deepEqual(row.flags, []); assert.equal(row.jobs[0].result, 'stopped');
});
test('missed slot is reported; native catch-up starts one run, never duplicates', t => {
  const w = world(t), live = w.scheduler.folders.get('WIDGET')[0];
  const slot = health.latestSlot(w.entry, w.at);
  w.owner.now = () => new Date(slot.getTime() + 31 * 60000);
  tasks.writeLastRun(w.entry.id, { status: 'ok', finished: new Date(slot.getTime() - 60000).toISOString() }, w.home);
  assert.ok(w.owner.collect().repos[0].flags.some(flag => flag.includes('missed scheduled run')));
  // Task Scheduler's StartWhenAvailable + IgnoreNew is the existing catch-up owner.
  // A native start writes running before the next observation.
  w.scheduler.onStart = () => { live.state = 'Running'; tasks.writeLastRun(w.entry.id, { status: 'running', started: w.owner.now().toISOString() }, w.home); };
  w.scheduler.start(w.entry.folder, w.entry.name);
  assert.ok(!w.owner.collect().repos[0].flags.some(flag => flag.includes('missed scheduled run')));
  assert.equal(w.scheduler.calls.filter(call => call[0] === 'start').length, 1);
});
test('path-free health stays local without a verified store and feeds the existing session line', t => {
  const w = world(t), result = w.owner.run(), text = JSON.stringify(result.document);
  assert.equal(result.shared, false); assert.equal(result.note, health.LOCAL_ONLY);
  assert.ok(!text.includes(w.root)); assert.ok(!text.includes(w.home)); assert.ok(!text.includes(s.TOOLKIT_ROOT));
  assert.equal(tasks.looksSecret(text), false);
  assert.match(tasks.sweepLine('example/widget', { home: w.home }), /health file not shared: no verified evidence store/);
  const hostile = structuredClone(result.document); hostile.repos[0].checkout = 'C:\\private';
  assert.throws(() => health.assertHealth(hostile), /Unexpected/);
});
test('fresh verified store only, own file only, secret scan before write and locked readback', t => {
  const w = world(t), store = memoryStore(), binding = s.fixtureBinding('example/widget'); let held = false;
  w.owner.checkout = () => ({ certain: true, governanceState: 'ENABLED', repository: 'example/widget', binding });
  w.owner.storeFactory = () => store;
  w.owner.takeLock = () => { held = true; return { release() { held = false; } }; };
  const put = store.put; store.put = (...args) => { assert.equal(held, true); return put(...args); };
  assert.equal(w.owner.run().shared, true); assert.equal(store.writes.length, 1);
  const otherHome = s.tempHome(t); tasks.computerIdentity(otherHome, { create: true });
  assert.notEqual(health.computerLabel(w.home), health.computerLabel(otherHome));
  assert.equal(store.writes[0], `task-health/${health.computerLabel(w.home)}.json`);
  w.owner.checkout = () => ({ certain: false, governanceState: 'ENABLED', binding });
  assert.equal(w.owner.run().shared, false); assert.equal(store.writes.length, 1);
});
test('duplicate ownership flags once; host asks once; losing computer removes only its copy next update', t => {
  const a = world(t), b = world(t), store = memoryStore();
  const attach = w => { w.owner.checkout = () => ({ certain: true, governanceState: 'ENABLED', repository: 'example/widget', binding: s.fixtureBinding('example/widget') }); w.owner.storeFactory = () => store; update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0'); };
  attach(a); attach(b); a.owner.run(); b.owner.run();
  const flags = a.owner.run().document.repos[0].flags.filter(flag => flag.startsWith('jobs run on ')); assert.equal(flags.length, 1);
  let asks = 0;
  a.updater({ question: question => { asks++; assert.equal(question.kind, 'ownership'); return { computer: health.computerLabel(a.home), observation: question.observation, answer_ref: 'host/computer-choice' }; } }).run({ apply: true });
  assert.equal(asks, 1);
  const result = b.updater({ question: () => { throw new Error('Must not ask again'); } }).run({ apply: true });
  assert.ok(result.results.some(row => row.action === 'remove'));
  assert.equal(b.scheduler.list(b.entry.folder).length, 0);
  assert.ok(a.scheduler.list(a.entry.folder).length > 0);
});
test('first update asks once; later updates do not; new task kinds ask again; cloud tasks never applied', t => {
  const w = world(t); let asks = 0;
  tasks.recordTask({ host: 'claude-cloud', id: 'cloud-daily', name: 'Daily check-in', schedule: 'daily 08:15', purpose: 'Read task health', repository: 'example/widget' }, { home: w.home });
  const updater = w.updater({ question: question => { asks++; assert.equal(question.kind, 'approval'); return { decision: 'standing', answer_ref: 'host/task-approval' }; } });
  const result = updater.run({ apply: true }); assert.equal(asks, 1); assert.equal(result.cloud[0].source, 'from record, not checked live');
  updater.run({ apply: true }); assert.equal(asks, 1);
  const file = path.join(tasks.userStateDir(w.home), 'scheduled-task-approval.json'), saved = JSON.parse(fs.readFileSync(file)); saved.kinds = ['footer-sweep']; fs.writeFileSync(file, JSON.stringify(saved));
  updater.run({ apply: true }); assert.equal(asks, 2);
  assert.ok(!w.scheduler.calls.some(call => call[0] === 'register' && call[2] === 'Daily check-in'), 'cloud trigger is never registered locally');
  assert.equal(tasks.readRegistry(w.home).tasks.filter(row => row.job === 'task-health').length, 1);
  assert.match(tasks.readRegistry(w.home).tasks.find(row => row.job === 'task-health').schedule, /^daily, 07:5[1-9]$/);
});

test('GitHub checkout without a cleaner is flagged; health rejects paths and secret-shaped labels', t => {
  const w = world(t), definition = w.desired.definitions.find(row => row.job === 'shard-timings');
  w.scheduler.folders.set(w.entry.folder, []); w.scheduler.register(definition);
  const live = w.scheduler.list(definition.folder)[0];
  tasks.writeRegistry(w.home, [{ ...w.entry, id: definition.id, name: definition.name, job: definition.job, schedule: definition.schedule_text, enrolled: windows.enrolledDefinition(live) }]);
  const doc = w.owner.collect(); assert.ok(doc.repos[0].flags.includes('GitHub checkout has no FOOTER SWEEP'));
  const secret = structuredClone(doc); secret.repos[0].repository = 'example/' + ['gh', 'p_', 'X'.repeat(36)].join('');
  assert.throws(() => health.assertHealth(secret), /secret scan/);
  for (const localPath of ['C:\\private', '/home/private']) {
    const unsafe = structuredClone(doc); unsafe.repos[0].flags = [localPath];
    assert.throws(() => health.assertHealth(unsafe), /Invalid health repository/);
  }
});
test('health flags three held runs in a row, ages each flag in days and names peers\' flags at session start', t => {
  const a = world(t), b = world(t), store = memoryStore();
  const attach = w => { w.owner.checkout = () => ({ certain: true, governanceState: 'ENABLED', repository: 'example/widget', binding: s.fixtureBinding('example/widget') }); w.owner.storeFactory = () => store; };
  attach(a); attach(b);
  tasks.writeLastRun(a.entry.id, { status: 'held', held_streak: 2, held_since: a.at.toISOString(), started: a.at.toISOString() }, a.home);
  assert.ok(!a.owner.collect().repos[0].flags.some(flag => flag.includes('held')), 'two held runs are not yet a flag');
  tasks.writeLastRun(a.entry.id, { status: 'held', held_streak: 3, held_since: a.at.toISOString(), started: a.at.toISOString() }, a.home);
  const day = 86400000, start = a.owner.now();
  a.owner.run();
  assert.ok(health.assertHealth(a.owner.collect()).repos[0].flags.includes('footer-sweep: held 3 runs in a row'));
  // Two days later the same flag still stands; it keeps its first time and shows its age.
  a.owner.now = () => new Date(start.getTime() + 2 * day + 60000);
  a.owner.run();
  const line = health.sessionHealth('example/widget', a.home);
  assert.match(line, /Task health: footer-sweep: held 3 runs in a row \(2 days\)/);
  // Another computer's flag for the same repository shows on this computer's line.
  tasks.writeLastRun(b.entry.id, { status: 'failed', started: b.at.toISOString() }, b.home);
  b.owner.now = a.owner.now; b.owner.run(); a.owner.run();
  assert.match(health.sessionHealth('example/widget', a.home), new RegExp(`Task health on other computers: ${health.computerLabel(b.home)}: footer-sweep: last run failed`));
  // A cleared flag drops out and starts again from now if it comes back.
  tasks.writeLastRun(a.entry.id, { status: 'ok', finished: a.owner.now().toISOString() }, a.home);
  a.owner.run();
  assert.equal(health.flagSince(a.owner.collect(), JSON.parse(fs.readFileSync(health.localFile(a.home), 'utf8')).flag_since)['example/widget']?.['footer-sweep: held 3 runs in a row'], undefined);
});
