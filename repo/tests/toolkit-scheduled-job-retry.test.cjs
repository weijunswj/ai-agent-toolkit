'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const tasks = require('../scripts/toolkit-tasks.cjs');
const support = require('./support/windows-task-switch-world.cjs');
const { world, events, until } = require('./support/scheduled-job-world.cjs');

test('fix3 A: production planner uses native POSIX joining in a real Node process', () => {
  const script = path.resolve(__dirname, '../scripts/toolkit-windows-tasks.cjs');
  const code = `const fs=require('node:fs'),Module=require('node:module'),p=require('node:path');
    const m=new Module(${JSON.stringify(script)});m.filename=${JSON.stringify(script)};m.paths=Module._nodeModulePaths(p.dirname(m.filename));
    const normal=m.require.bind(m);m.require=id=>id==='node:path'?{...p.posix,win32:p.win32,posix:p.posix}:normal(id);
    m._compile(fs.readFileSync(m.filename,'utf8'),m.filename);
    process.stdout.write(m.exports.applyCommand({root:'/home/fixture/project'},{toolkitRoot:'/home/fixture/toolkit'}));`;
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'node "/home/fixture/toolkit/repo/scripts/toolkit-windows-tasks.cjs" apply --repo-root "/home/fixture/project"');
});

test('fix3 B: simultaneous real moved-origin refreshes serialize and retain the weekly run', async t => {
  const w = world(t), sweep = w.rows.find(row => row.job === 'programme-sweep'), shard = w.rows.find(row => row.job === 'shard-timings');
  fs.appendFileSync(w.bindingFile, '\n'); w.git(w.writer, 'commit', '-am', 'move origin'); w.git(w.writer, 'push', 'origin', 'main');
  w.save({ race: true, startGate: path.join(w.base, 'go') });
  const a = w.start(sweep), b = w.start(shard);
  await until(() => fs.existsSync(path.join(w.base, `ready-${sweep.id}`)) && fs.existsSync(path.join(w.base, `ready-${shard.id}`)));
  fs.writeFileSync(w.config.startGate, 'go');
  const results = await Promise.all([a.done, b.done]);
  const refresh = events(w).filter(event => event.kind.startsWith('status-'));
  let active = 0;
  for (const event of refresh) { active += event.kind === 'status-enter' ? 1 : -1; assert.ok(active <= 1, 'refreshes must not overlap'); }
  assert.ok(results.every(record => ['ok', 'deferred'].includes(record.status)), JSON.stringify(results));
  await w.start(sweep, 'retry').done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok', 'weekly job completed, including native catch-up');
  assert.ok(events(w).some(event => event.kind === 'footer' && event.repos.includes(support.fixtureBinding().store.repository)));
  assert.ok(events(w).filter(event => event.kind === 'footer').every(event => event.writerLocked));
});

test('fix3 B: refresh failures defer the shard and a later sweep starts it', async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  w.save({ refreshFailure: 'fetch-failed' });
  assert.equal((await w.start(shard).done).status, 'deferred');
  w.save({ refreshFailure: null }); await w.start(sweep).done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
  // No usable cached store: a real failed Git read must still keep a retry, whose
  // later refreshed store can differ from the repository fallback lock key.
  w.git(shard.checkout, 'remote', 'set-url', 'origin', path.join(w.base, 'missing-origin.git'));
  const unavailable = await w.start(shard).done;
  assert.equal(unavailable.status, 'deferred');
  w.git(shard.checkout, 'remote', 'set-url', 'origin', w.origin);
  await w.start(sweep).done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
});

for (const status of ['failed', 'signed out', 'deferred']) test(`fix3 D: shard deferral preserves sweep ${status} and does not promise disabled retries`, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  const old = new Date(Date.now() - 3 * 3600000).toISOString();
  const live = JSON.parse(fs.readFileSync(w.live, 'utf8'));
  live[shard.folder].find(row => row.name === shard.name).state = 'Disabled';
  fs.writeFileSync(w.live, JSON.stringify(live));
  tasks.writeLastRun(shard.id, { status: 'deferred', started: old, finished: old, deferred_since: old, deferred_count: 4 }, w.home);
  w.save({ signedOut: status === 'signed out', failProgramme: status === 'failed' });
  await w.start(sweep).done;
  if (status === 'deferred') tasks.writeLastRun(sweep.id, { status: 'deferred', started: new Date().toISOString(), finished: new Date().toISOString(), deferred_since: old, deferred_count: 4 }, w.home);
  const line = tasks.sweepLine(sweep.repository, { home: w.home });
  assert.match(line, status === 'failed' ? /last run failed/ : status === 'signed out' ? /gh not signed in/ : /over 2 hours/);
  assert.doesNotMatch(line, /retries at the next hourly programme sweep/);
});

for (const recased of [true, false]) test(`fix3 D: ${recased ? 're-cased repository catches up' : 'native-start failure note is saved'}`, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  tasks.writeLastRun(shard.id, { status: 'deferred', started: new Date().toISOString() }, w.home);
  if (recased) tasks.updateRegistry(w.home, rows => rows.map(row => row.id === shard.id ? { ...row, repository: row.repository.toUpperCase() } : row));
  w.save({ startFails: true }); const record = await w.start(sweep).done;
  assert.equal(record.status, 'ok', JSON.stringify(record));
  assert.equal(events(w).filter(event => event.kind === 'start').length, 1);
  assert.match(tasks.readLastRun(sweep.id, w.home).summary.join(' '), /retry could not start/);
  assert.deepEqual(tasks.readLastRun(sweep.id, w.home), record);
});
