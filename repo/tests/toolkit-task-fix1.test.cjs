'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const health = require('../scripts/toolkit-task-health.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const launcher = require('../scripts/toolkit-task-launcher.cjs');
const schedule = require('../scripts/toolkit-task-schedule.cjs');
const { world, memoryStore } = require('./support/task-health-world.cjs');
const s = require('./support/windows-task-switch-world.cjs');
const approve = w => update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
test('H1: health has no repository minute, migrates poisoned records and cannot poison assignment', t => {
  const w = world(t); approve(w); w.updater().run({ apply: true });
  let row = tasks.readRegistry(w.home).tasks.find(e => e.job === 'task-health');
  const computerSchedule = row.schedule;
  assert.match(computerSchedule, /^daily, 07:5[1-9]$/);
  assert.equal(row.repository, null); assert.equal(row.repo_minute, undefined);
  tasks.updateRegistry(w.home, rows => rows.map(e => e.id === row.id ? { ...e, repository: 'example/widget', repo_minute: 9 } : e));
  assert.equal(schedule.assignment(tasks.readRegistry(w.home).tasks, 'example/widget', w.entry.job_owner).conflict, undefined);
  w.updater().run({ apply: true });
  row = tasks.readRegistry(w.home).tasks.find(e => e.id === row.id);
  assert.equal(row.repository, null); assert.equal(row.repo_minute, undefined);
  assert.equal(row.schedule, computerSchedule, 'repository minutes cannot move the computer slot');
});
test('H2: baseline-less edited task asks even with repairOwned, and keep preserves it', t => {
  const w = world(t); approve(w);
  tasks.updateRegistry(w.home, rows => rows.map(({ enrolled, ...e }) => e));
  const live = w.scheduler.folders.get(w.entry.folder)[0]; live.arguments += ' hand-edit'; live.actions[0].arguments += ' hand-edit';
  const direct = new windows.WindowsTaskOwner({ home: w.home, scheduler: w.scheduler, repairOwned: true }).plan(w.desired);
  assert.equal(direct.items[0].action, 'owner-choice-required', 'repairOwned alone never supplies a hand-edit answer');
  let asked = 0;
  const result = w.updater({ question: q => { asked++; return { outcome: 'keep', observation: q.observation, answer_ref: 'host/keep-legacy' }; } }).run({ apply: true });
  assert.equal(asked, 1); assert.ok(result.results.some(r => r.refused)); assert.match(live.arguments, /hand-edit/);
});
test('M1: scoped remove excludes even a poisoned computer health record', t => {
  const w = world(t); approve(w); w.updater().run({ apply: true });
  tasks.updateRegistry(w.home, rows => rows.map(e => e.job === 'task-health' ? { ...e, repository: 'example/widget', repo_minute: 1 } : e));
  const result = new windows.WindowsTaskOwner({ home: w.home, scheduler: w.scheduler }).remove(null, w.desired);
  assert.ok(result.items.every(e => e.job !== 'task-health'));
  assert.equal(w.scheduler.list('TOOLKIT-HEALTH').length, 1);
  assert.ok(!tasks.readRegistry(w.home).tasks.find(e => e.job === 'task-health').stopped_by_owner);
});
test('M2: a held repository and a pending question do not stop the next repository or health', t => {
  const w = world(t); approve(w);
  const betaRoot = s.checkout(t);
  const governance = { readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: root === betaRoot ? '/example/beta.git' : '/example/widget.git' } }), governanceState: () => ({ state: 'DISABLED', merged: { fresh: true, status: 'disabled' } }), readObservation: () => ({ status: 'disabled', fresh: true, binding: s.fixtureBinding('example/beta', 'BETA', false) }) };
  const beta = windows.desiredTasks({ checkout: betaRoot, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE, home: w.home, deps: { identityReader: s.identityReader, governance } });
  w.scheduler.folders.get(w.entry.folder)[0].arguments += ' edited';
  const updater = w.updater({ discover: () => [beta.root], desired: ({ checkout }) => checkout === beta.root ? beta : w.desired });
  // Use the same real identity guard, with an independently named fake second repo.
  beta.identityReader = s.identityReader;
  const result = updater.run({ apply: true });
  assert.ok(result.questions?.length); assert.ok(result.results.some(r => r.repository === 'example/beta' && !r.refused), JSON.stringify(result.results));
  assert.equal(w.scheduler.list('TOOLKIT-HEALTH').length, 1);
});
test('M5: missing runner receipt preserves cursor, skip and deferral history', t => {
  const w = world(t), history = { footer_sweep_since: '2026-01-01T00:00:00.000Z', skipped_streak: 4, skipped_since: '2026-01-02T00:00:00.000Z', deferred_since: '2026-01-03T00:00:00.000Z', deferred_count: 3, deferred_lock_key: 'example/evidence' };
  tasks.writeLastRun(w.entry.id, history, w.home);
  launcher.launch([path.join(w.home, 'missing'), 'footer-sweep', '--task-id', w.entry.id], { home: w.home, stderr() {} });
  const after = tasks.readLastRun(w.entry.id, w.home);
  for (const [key, value] of Object.entries(history)) assert.equal(after[key], value, key);
});
test('M6 and Low 6: current task update records code version and restores a deleted launcher', t => {
  const w = world(t); approve(w);
  w.owner.version = require('../contracts/toolkit-local-bridge/version.json').version;
  tasks.updateRegistry(w.home, rows => rows.map(e => ({ ...e, toolkit_version: '3.1.0' })));
  fs.unlinkSync(windows.launcherPath(w.home));
  w.updater().run({ apply: true });
  assert.equal(fs.existsSync(windows.launcherPath(w.home)), true);
  assert.ok(!w.owner.collect().repos[0].flags.some(f => f.includes('task code older')));
});
test('M7 and Low 9: store failure retains a fresh local health file and a useful receipt', t => {
  const w = world(t), store = memoryStore(); approve(w); w.updater().run({ apply: true });
  w.owner.checkout = () => ({ certain: true, governanceState: 'ENABLED', repository: 'example/widget', binding: s.fixtureBinding('example/widget') }); w.owner.storeFactory = () => store;
  store.put = () => { throw new Error('Health store readback failed'); };
  const entry = tasks.readRegistry(w.home).tasks.find(e => e.job === 'task-health');
  const record = health.runHealthJob({ ...w.owner, taskId: entry.id });
  assert.equal(record.status, 'failed'); assert.match(record.summary.join(' '), /store readback failed/);
  const saved = JSON.parse(fs.readFileSync(health.localFile(w.home), 'utf8')); assert.equal(saved.shared, false); assert.equal(saved.document.time, w.at.toISOString());
});
test('M8: read-only plan lists stored losing-owner removals without writing', t => {
  const w = world(t), store = memoryStore(); approve(w);
  const other = 'computer-0123456789ab';
  store.put('task-health/owners.json', { schema: 'toolkit.task-owners.v1', repos: { 'example/widget': { computer: other, answer_ref: 'host/choice' } } }, null);
  w.owner.store = () => ({ store, key: 'example/evidence' });
  const before = store.writes.length, result = w.updater().run();
  assert.ok(result.changes.some(r => r.repository === 'example/widget' && r.action === 'remove'));
  assert.equal(store.writes.length, before);
});
test('Low 1: expected no-shards skip is quiet, unexpected skips still alert', t => {
  const w = world(t); w.owner.version = require('../contracts/toolkit-local-bridge/version.json').version;
  tasks.writeLastRun(w.entry.id, { status: 'skipped', reason: 'no shards yet', finished: w.at.toISOString(), skipped_streak: 5 }, w.home);
  assert.deepEqual(w.owner.collect().repos[0].flags, []);
  tasks.writeLastRun(w.entry.id, { status: 'skipped', reason: 'offline', finished: w.at.toISOString(), skipped_streak: 5 }, w.home);
  assert.ok(w.owner.collect().repos[0].flags.some(f => f.includes('offline')));
});
test('Low 2: stopped health suppresses sharing and age nags', t => {
  const w = world(t); approve(w); w.updater().run({ apply: true });
  w.owner.now = () => new Date(Date.now() - 48 * 3600000); w.owner.run();
  tasks.updateRegistry(w.home, rows => rows.map(e => e.job === 'task-health' ? { ...e, stopped_by_owner: true, stopped_at: w.at.toISOString() } : e));
  assert.equal(health.sessionHealth('example/widget', w.home), null);
});
test('Low 5: newer peer job kinds are accepted, local schema remains closed', t => {
  const w = world(t), doc = w.owner.collect(); doc.repos[0].jobs.push({ job: 'health-pass', result: 'ok', streak: 0 });
  const transport = { request: (method, endpoint) => endpoint.includes('computer-') ? { status: 200, json: { encoding: 'base64', content: Buffer.from(JSON.stringify(doc)).toString('base64') } } : { status: 200, json: [{ type: 'file', name: doc.computer + '.json' }] } };
  const store = new health.HealthStore({ transport, store: { repository: 'example/evidence', branch: 'main' } });
  assert.equal(store.list().length, 1); assert.throws(() => health.assertHealth(doc), /Invalid health repository/);
});
test('M3: setup completes both independent Codex maintenance steps before reporting a task hold', () => {
  const text = fs.readFileSync(require.resolve('../scripts/setup-toolkit-core.cjs'), 'utf8');
  const section = text.slice(text.indexOf('const scheduledTaskUpdate = applyScheduledTasks(args);'), text.indexOf('async function execute(args)'));
  assert.ok(section.indexOf('runCodexGlobalRules(args)') < section.indexOf('return '));
  assert.ok(section.indexOf('runCodexHelperAgents(args)') < section.indexOf('return '));
  assert.match(section, /return scheduledTaskUpdate\?\.held/);
});
test('M4: concurrent third misses persist both independent disabled snapshots', async t => {
  const w = world(t), managed = path.join(w.home, 'missing');
  const entries = [w.entry, { ...w.entry, id: 'beta-footer-sweep', name: 'BETA - FOOTER SWEEP', folder: 'BETA', repository: 'example/beta' }].map(e => ({ ...e, toolkit_root: managed }));
  tasks.writeRegistry(w.home, entries);
  for (const entry of entries) { const file = path.join(tasks.userStateDir(w.home), 'tasks', entry.id, 'missing.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ misses: 2 })); }
  const script = `const launcher=require(process.argv[1]); const [home,root,id]=process.argv.slice(2); try { const code=launcher.launch([root,'footer-sweep','--task-id',id],{home,stderr(){},disable(){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,700);return '<disabled '+id+'/>';}}); process.exitCode=code===78?0:1; } catch(e){console.error(e.message);process.exitCode=1;}`;
  const runs = entries.map(entry => new Promise(resolve => {
    const child = require('node:child_process').spawn(process.execPath, ['-e', script, require.resolve('../scripts/toolkit-task-launcher.cjs'), w.home, managed, entry.id], { windowsHide: true });
    let error = ''; child.stderr.on('data', data => { error += data; }); child.on('close', code => resolve({ code, error }));
  }));
  const results = await Promise.all(runs); assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  assert.ok(tasks.readRegistry(w.home).tasks.every(e => e.toolkit_missing && e.enrolled.definition_xml === '<disabled ' + e.id + '/>'));
});
test('M7: health waits within its deadline for the store and serialises status under the refresh lock', t => {
  const w = world(t), store = memoryStore(); let held = false, called = false;
  w.owner.store = () => ({ store, key: 'example/evidence' });
  w.owner.takeLock = (key, options) => { assert.equal(key, 'example/evidence'); assert.ok(options.waitMs > 1000 && options.waitMs <= 29 * 60000); return { release() {} }; };
  assert.equal(w.owner.run().shared, true);
  assert.equal(typeof health.freshCheckout, 'function');
  health.freshCheckout(w.root, w.home, 1234, { lockFactory: options => { assert.equal(options.key, 'checkout-refresh:' + path.resolve(w.root)); held = true; return { release() { held = false; } }; }, run: () => { called = true; assert.equal(held, true); return { status: 1 }; } });
  assert.equal(called, true); assert.equal(held, false);
});
test('Low 3: self-disable PowerShell explicitly emits UTF-8 XML', () => {
  const text = fs.readFileSync(require.resolve('../scripts/toolkit-task-launcher.cjs'), 'utf8');
  assert.match(text, /\[Console\]::OutputEncoding=\[System.Text.UTF8Encoding\]::new\(\$false\)/);
});
test('Low 14: unreadable discovery folder is reported without hiding readable neighbours', t => {
  const w = world(t), folder = path.join(w.home, 'GitHub'), blocked = path.join(folder, 'blocked'), good = path.join(folder, 'good');
  fs.mkdirSync(blocked, { recursive: true }); fs.mkdirSync(path.join(good, '.git'), { recursive: true });
  const found = update.discoverCheckouts(folder, { readDir: dir => { if (dir === blocked) throw new Error('access denied'); return fs.readdirSync(dir, { withFileTypes: true }); } });
  assert.ok(found.includes(good)); assert.ok(found.some(row => row.root === blocked && row.held && /access/.test(row.reason)));
});
test('M2: a losing computer asks before repairing an edited transfer, then removes only that repository', t => {
  const w = world(t), store = memoryStore(); approve(w);
  store.put('task-health/owners.json', { schema: 'toolkit.task-owners.v1', repos: { 'example/widget': { computer: 'computer-0123456789ab', answer_ref: 'host/other-computer' } } }, null);
  w.owner.store = () => ({ store, key: 'example/evidence' });
  const live = w.scheduler.folders.get(w.entry.folder)[0]; live.arguments += ' hand-edit'; live.actions[0].arguments += ' hand-edit';
  let asked = 0;
  const result = w.updater({ question: q => { asked++; assert.equal(q.kind, 'task-choice'); return { outcome: 'replace', observation: q.observation, answer_ref: 'host/replace-transfer' }; } }).run({ apply: true });
  assert.equal(asked, 1); assert.ok(result.results.some(row => row.action === 'remove'));
  assert.equal(w.scheduler.list(w.entry.folder).length, 0); assert.equal(w.scheduler.list('TOOLKIT-HEALTH').length, 1);
});
test('H1: poisoned health stop and foreign owner never hold repository plans or minute assignment', t => {
  const w = world(t); approve(w); w.updater().run({ apply: true });
  tasks.updateRegistry(w.home, rows => rows.map(e => e.job === 'task-health' ? { ...e, repository: 'example/widget', repo_minute: 9, stopped_by_owner: true, stopped_at: w.at.toISOString(), job_owner: 'local-00000000-0000-0000-0000-000000000000' } : e));
  const assignment = schedule.assignment(tasks.readRegistry(w.home).tasks, 'example/widget', w.entry.job_owner);
  assert.equal(assignment.conflict, undefined); assert.equal(assignment.minute, w.entry.repo_minute);
  const row = w.updater().plan().plans.find(row => row.desired);
  assert.equal(row.plan.stopped, undefined); assert.ok(row.plan.items.every(item => item.action === 'current'));
});
test('Low 6: a second all-current update restores a deleted content-addressed launcher', t => {
  const w = world(t); approve(w); w.updater().run({ apply: true });
  const file = windows.launcherPath(w.home); fs.unlinkSync(file);
  const before = w.scheduler.calls.length;
  w.updater().run({ apply: true });
  assert.equal(fs.existsSync(file), true);
  assert.ok(w.scheduler.calls.slice(before).every(call => call[0] !== 'register'), 'restoring the launcher alone needs no native rewrite');
});
test('H1: an already-written borrowed row is normalised while its native task remains current', t => {
  const w = world(t); approve(w); w.updater().run({ apply: true });
  tasks.updateRegistry(w.home, rows => rows.map(e => e.job === 'task-health' ? { ...e, repository: 'example/widget', repo_minute: w.entry.repo_minute } : e));
  const before = w.scheduler.calls.length;
  w.updater().run({ apply: true });
  const entry = tasks.readRegistry(w.home).tasks.find(e => e.job === 'task-health');
  assert.equal(entry.repository, null); assert.equal(entry.repo_minute, undefined);
  assert.ok(w.scheduler.calls.slice(before).every(call => call[0] !== 'register'), 'the migration changes only the proven local record');
});
test('H2: updater never uses a semantic shape match as a missing hand-edit baseline', t => {
  const w = world(t); approve(w);
  tasks.updateRegistry(w.home, rows => rows.map(({ enrolled, ...e }) => e));
  const live = w.scheduler.folders.get(w.entry.folder)[0];
  live.triggers[0].start = live.triggers[0].start.replace(/^\d{4}/, '2099');
  assert.equal(windows.verifiedDefinition(live, w.desired.wanted[0]), true, 'time-of-day equivalence is not a hand-edit baseline');
  let asked = 0;
  w.updater({ question: q => { asked++; return { outcome: 'keep', observation: q.observation, answer_ref: 'host/keep-calendar' }; } }).run({ apply: true });
  assert.equal(asked, 1); assert.match(w.scheduler.list(w.entry.folder)[0].triggers[0].start, /^2099/);
});
