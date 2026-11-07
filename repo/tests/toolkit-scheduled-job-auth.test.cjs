'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { ProgrammeJobLock } = require('../scripts/toolkit-programme-lock.cjs');
const s = require('./support/windows-task-switch-world.cjs');
function world(t, auth) {
  const home = s.tempHome(t), root = s.checkout(t), binding = s.fixtureBinding('example/widget', 'WIDGET');
  const fake = s.fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true } }) } });
  const options = { job: 'shard-timings', taskId: 'widget-shard-timings', repoRoot: root };
  const deps = { home, ghPath: s.GH, repositoryReader: s.testRepository,
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: '/example/widget.git' } }),
    readObservation: () => ({ status: 'enabled', fresh: true, binding }),
    run: (file, args, opts) => file === s.GH && args[0] === 'auth' ? auth : fake.run(file, args, opts) };
  return { home, root, deps, options };
}
for (const [name, auth, status] of [
  ['failed', { status: 1, stderr: 'failed to read authentication' }, 'deferred'],
  ['stalled', { status: null, error: 'ETIMEDOUT' }, 'deferred'],
  ['confirmed signed out', { status: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' }, 'skipped'],
]) test(`weekly auth ${name}: ${status} and visible`, t => {
  const w = world(t, auth), result = job.runJob(w.options, w.deps);
  assert.equal(result.status, status);
  const line = tasks.sweepLine('example/widget', { home: w.home, registry: { status: 'ok', tasks: [{ host: 'windows', job: 'shard-timings', id: w.options.taskId, repository: 'example/widget' }] } });
  if (status === 'deferred') assert.match(line, /authentication status could not be read/);
});
test('refresh takeover logs one plain line', t => {
  const w = world(t, { status: 0 });
  const lock = new ProgrammeJobLock({ home: w.home, key: `checkout-refresh:${path.resolve(w.root)}` });
  fs.mkdirSync(path.dirname(lock.file), { recursive: true }); fs.writeFileSync(lock.file, '{}');
  const result = job.runJob(w.options, w.deps);
  assert.equal(result.summary.filter(line => /took over a stale job lock/.test(line)).length, 1);
});
test('retry note survives exhausted task budget', t => {
  const w = world(t, { status: 0 }); let elapsed = 0, reads = 0;
  w.deps.monotonicNow = () => elapsed;
  const run = w.deps.run;
  w.deps.run = (file, args, opts) => {
    if (args[0] === job.SCRIPT.governance) {
      if (++reads === 1) return { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true }, refresh: { refreshed: false, reason: 'fetch-failed' } }) };
      elapsed = 29 * 60000; return { status: null, error: 'ETIMEDOUT' };
    }
    return run(file, args, opts);
  };
  const result = job.runJob(w.options, w.deps);
  assert.equal(result.status, 'deferred');
  assert.match(result.summary.join(' '), /retry could not be read/);
});

test('footer fetch failure remains a structured reason after origin cleaning', t => {
  const w = world(t, { status: 0 }); let cleaned = false;
  const run = w.deps.run;
  w.deps.run = (file, args, opts) => {
    if (args[0] === job.SCRIPT.footerSweep) cleaned = true;
    if (args[0] === job.SCRIPT.governance) return { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true }, refresh: { refreshed: false, reason: 'fetch-failed' } }) };
    return run(file, args, opts);
  };
  const result = job.runJob({ ...w.options, job: 'footer-sweep' }, w.deps);
  assert.equal(cleaned, true); assert.equal(result.status, 'held');
  assert.equal(result.reason, 'binding refresh failed: default branch fetch failed');
});
