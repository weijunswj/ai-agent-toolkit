'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const s = require('./support/windows-task-switch-world.cjs');
const enabled = { state: 'ENABLED', merged: { status: 'enabled', fresh: true } };
function fixture(t, answer = { status: 0, stdout: JSON.stringify(enabled) }) {
  const home = s.tempHome(t), root = s.checkout(t), binding = s.fixtureBinding();
  const options = { job: 'shard-timings', taskId: 'status-shard-timings', repoRoot: root };
  const deps = { home, ghPath: s.GH, repositoryReader: s.testRepository,
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/${binding.repository}.git` } }),
    readObservation: () => ({ status: 'enabled', fresh: true, binding }),
    run: s.fakeRun({ 'toolkit-governance.cjs': answer, 'programme attention': s.ATTENTION }).run };
  return { home, root, binding, options, deps };
}
for (const [name, answer] of [
  ['killed', { status: null, error: 'ETIMEDOUT' }], ['bad exit', { status: 1, stdout: JSON.stringify(enabled) }],
  ['unparseable', { status: 0, stdout: '{' }], ['unrecognised shape', { status: 0, stdout: '{}' }],
  ['stale', { status: 0, stdout: JSON.stringify({ ...enabled, merged: { status: 'enabled', fresh: false } }) }],
  ['unknown', { status: 0, stdout: '{"state":"UNAVAILABLE","merged":{"status":"unknown","fresh":false}}' }],
]) test(`uncertain status ${name} defers without effects`, t => {
  const w = fixture(t, answer), calls = [];
  const run = w.deps.run;
  w.deps.run = (file, args, opts) => { calls.push(args[0]); return run(file, args, opts); };
  const record = job.runJob(w.options, w.deps);
  assert.equal(record.status, 'deferred', JSON.stringify(record));
  assert.ok(record.reason); assert.equal(record.deferred_count, 1);
  assert.ok(!calls.includes(job.SCRIPT.shardTimings));
});
for (const [name, state] of [
  ['off', { state: 'DISABLED', merged: { status: 'disabled', fresh: true } }],
  ['absent', { state: 'UNDECIDED', merged: { status: 'none', fresh: true } }],
  ['invalid', { state: 'ERROR', rule: 'M0', merged: { status: 'invalid', fresh: false } }],
  ['foreign', { state: 'DISABLED', merged: { status: 'foreign', fresh: true } }],
]) test(`confirmed ${name} status may skip`, t => {
  const w = fixture(t, { status: state.state === 'ERROR' ? 2 : 0, stdout: JSON.stringify(state) });
  assert.equal(job.runJob(w.options, w.deps).status, 'skipped');
});
test('refresh-busy reason is visible on the session line', t => {
  const w = fixture(t), at = new Date().toISOString();
  tasks.writeLastRun(w.options.taskId, { status: 'skipped', reason: 'binding refresh failed: another checkout refresh is running', started: at }, w.home);
  assert.match(tasks.sweepLine(w.binding.repository, { home: w.home, registry: { status: 'ok', tasks: [{ id: w.options.taskId,
    host: 'windows', job: 'programme-sweep', repository: w.binding.repository }] } }), /another checkout refresh is running/);
});
test('programme lock release failure keeps its summary line and reason', t => {
  for (const brokenStart of [false, true]) {
    const w = fixture(t);
    let locked = false;
    w.deps.takeProgrammeLock = () => { locked = true; return { release() { throw new Error('fixture release failed'); } }; };
    if (brokenStart) {
      let called = false;
      w.deps.now = () => { if (locked && !called) { called = true; throw new Error('fixture start failed'); } return new Date(); };
    }
    const record = job.runJob(w.options, w.deps);
    assert.equal(record.status, 'failed');
    assert.match(record.summary.join(' '), /Programme lock release failed/);
    if (brokenStart) assert.match(record.summary.join(' '), /Programme job or lock failed/);
    assert.deepEqual(tasks.readLastRun(w.options.taskId, w.home), record);
  }
});
test('a deferred shard keeps the skip streak until work really resumes', t => {
  const w = fixture(t, { status: 0, stdout: JSON.stringify({ ...enabled, refresh: { refreshed: false, reason: 'fetch-failed' } }) });
  const at = new Date(Date.now() - 3600000).toISOString();
  tasks.writeLastRun(w.options.taskId, { schema: 'toolkit.task-last-run.v1', id: w.options.taskId, job: w.options.job,
    status: 'skipped', skipped_streak: 3, skipped_since: at }, w.home);
  const record = job.runJob(w.options, w.deps);
  assert.equal(record.status, 'deferred');
  assert.equal(record.skipped_streak, 3); assert.equal(record.skipped_since, at);
  assert.doesNotMatch(record.summary.join(' '), /Resumed/);
  const recovered = job.runJob(w.options, { ...w.deps, run: s.fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify(enabled) } }).run });
  assert.equal(recovered.status, 'ok'); assert.equal(recovered.skipped_streak, undefined);
  assert.match(recovered.summary.join(' '), /Resumed after 3 skipped runs/);
});
test('all status attempts and effects share the task time limit', t => {
  const w = fixture(t), calls = [];
  let elapsed = 0;
  const run = w.deps.run;
  w.deps.monotonicNow = () => elapsed;
  w.deps.run = (file, args, opts) => {
    calls.push(args[0]);
    if (file === s.GH) elapsed = 29 * 60000 - 2000;
    if (args[0] === job.SCRIPT.governance) {
      assert.ok(opts.timeout <= 2000, 'status fits the remaining overall task budget');
      elapsed += 2000;
    }
    return run(file, args, opts);
  };
  const result = job.runJob(w.options, w.deps);
  assert.equal(result.status, 'deferred');
  assert.equal(result.reason, 'task time budget exhausted');
  assert.ok(!calls.includes(job.SCRIPT.shardTimings), 'no effect starts after the task budget');
});
test('dead home argument and profile substitutions are gone from planner consumers', () => {
  const pack = fs.readFileSync(require.resolve('../scripts/toolkit-hook-pack.cjs'), 'utf8');
  const world = fs.readFileSync(require.resolve('./support/windows-task-switch-world.cjs'), 'utf8');
  assert.ok(!/applyCommand\([^\n]+home: this\.home/.test(pack), 'pack no longer passes dead home');
  assert.ok(!/\.replace\('\$env:USERPROFILE'/.test(world), 'printed recovery no longer expands a dead profile token');
});
