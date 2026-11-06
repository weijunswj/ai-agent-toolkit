'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const s = require('./support/windows-task-switch-world.cjs');
const enabled = { state: 'ENABLED', merged: { status: 'enabled', fresh: true } };
// Closure matrix for store-release starts: every candidate reuses the native-start
// guards, and must independently prove its current origin and fresh store identity.
for (const guard of ['control', 'owner stop', 'foreign owner', 'adopted', 'disabled', 'running', 'missing', 'marker', 'definition',
  'baseline', 'wrong origin', 'wrong store', 'receipt store', 'stale', 'governance off', 'signed out', 'bad checkout',
  'stop during refresh', 'edit during refresh', 'cleared during refresh']) {
  test(`store catch-up guard: ${guard}`, t => {
    const home = s.tempHome(t), scheduler = s.fakeScheduler(), roots = [s.checkout(t), s.checkout(t)];
    const repositories = ['example/alpha', 'example/beta'];
    const identity = root => ({ valid: true, root, remote: { host: 'github.com', path: `/${repositories[roots.indexOf(root)]}.git` } });
    const binding = root => s.fixtureBinding(repositories[roots.indexOf(root)], `REPO${roots.indexOf(root)}`);
    for (const root of roots) {
      const desired = windows.desiredTasks({ checkout: root, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE,
        deps: { identityReader: s.identityReader, governance: { readIdentity: identity, governanceState: () => enabled,
          readObservation: () => ({ status: 'enabled', fresh: true, binding: binding(root) }) } } });
      const applied = windows.applyTasks(desired, { home, scheduler }); assert.ok(!applied.refused);
    }
    const rows = tasks.readRegistry(home).tasks, a = rows.find(row => row.repository === repositories[0] && row.job === 'programme-sweep');
    const b = rows.find(row => row.repository === repositories[1] && row.job === 'programme-sweep');
    const key = binding(roots[0]).store.repository;
    tasks.writeLastRun(b.id, { status: 'deferred', deferred_lock_key: guard === 'receipt store' ? 'example/elsewhere' : key }, home);
    tasks.updateRegistry(home, entries => entries.map(row => row.id !== b.id ? row : { ...row,
      ...(guard === 'owner stop' ? { stopped_by_owner: true, stopped_at: new Date().toISOString() } : {}),
      ...(guard === 'foreign owner' ? { job_owner: 'local-00000000-0000-0000-0000-000000000001' } : {}),
      ...(guard === 'adopted' ? { adopted: true } : {}), ...(guard === 'baseline' ? { enrolled: undefined } : {}) }));
    const live = scheduler.folders.get(b.folder).find(row => row.name === b.name);
    if (guard === 'disabled') live.state = 'Disabled';
    if (guard === 'running') live.state = 'Running';
    if (guard === 'marker') live.description = 'foreign task';
    if (guard === 'definition') live.arguments += ' --edited';
    if (guard === 'missing') scheduler.folders.set(b.folder, []);
    const fake = s.fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify(enabled) }, 'programme attention': s.ATTENTION });
    const started = [];
    scheduler.onStart = () => {
      const lock = new (require('../scripts/toolkit-programme-lock.cjs').ProgrammeJobLock)({ home, key, waitMs: 0 }).take();
      assert.ok(lock, 'writer lock released before native start'); lock.release(); started.push(b.id);
    };
    job.runJob({ job: a.job, taskId: a.id, repoRoot: roots[0] }, { home, scheduler, ghPath: s.GH, run(file, args, opts) {
      if (opts.cwd === roots[1] && args[0] === job.SCRIPT.governance) {
        if (guard === 'stop during refresh') tasks.updateRegistry(home, rows => rows.map(row => row.id === b.id ? { ...row, stopped_by_owner: true, stopped_at: new Date().toISOString() } : row));
        if (guard === 'edit during refresh') live.arguments += ' --owner-edit';
        if (guard === 'cleared during refresh') tasks.writeLastRun(b.id, { status: 'ok' }, home);
      }
      if (opts.cwd === roots[1] && guard === 'signed out' && file === s.GH) return { status: 1 };
      if (opts.cwd === roots[1] && guard === 'governance off' && args[0] === job.SCRIPT.governance) return { status: 0, stdout: '{"state":"DISABLED","merged":{"status":"disabled","fresh":true}}' };
      return fake.run(file, args);
    }, repositoryReader: root => guard === 'bad checkout' && root === roots[1] ? false : s.testRepository(root),
    readIdentity: root => root === roots[1] && guard === 'wrong origin' ? { valid: false } : identity(root),
    readObservation: id => ({ status: 'enabled', fresh: !(id.root === roots[1] && guard === 'stale'),
      binding: id.root === roots[1] && guard === 'wrong store' ? { ...binding(id.root), store: { ...binding(id.root).store, repository: 'example/elsewhere' } } : binding(id.root) }) });
    assert.deepEqual(started, guard === 'control' ? [b.id] : []);
    assert.equal(tasks.readLastRun(b.id, home).status, guard === 'cleared during refresh' ? 'ok' : 'deferred');
  });
}

test('a sweep retries a transient status refresh once within the original read budget', t => {
  const home = s.tempHome(t), root = s.checkout(t), binding = s.fixtureBinding();
  const timeouts = [];
  const fake = s.fakeRun({ 'toolkit-governance.cjs': () => ({ status: 0, stdout: JSON.stringify(timeouts.length === 1
    ? { ...enabled, refresh: { refreshed: false, reason: 'fetch-failed' } } : enabled) }), 'programme attention': s.ATTENTION });
  const result = job.runJob({ job: 'programme-sweep', taskId: 'retry-programme-sweep', repoRoot: root }, { home, ghPath: s.GH,
    repositoryReader: s.testRepository, readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/${binding.repository}.git` } }),
    readObservation: () => ({ status: 'enabled', fresh: true, binding }), run(file, args, opts) {
      if (args[0] === job.SCRIPT.governance) timeouts.push(opts.timeout);
      return fake.run(file, args);
    } });
  assert.equal(result.status, 'ok'); assert.equal(timeouts.length, 2);
  assert.ok(timeouts.every(timeout => timeout > 0 && timeout <= 10000));
  assert.ok(timeouts[1] <= timeouts[0]);
});

test('deferral age and count survive repeated busy locks and clear after work', t => {
  const home = s.tempHome(t), root = s.checkout(t), binding = s.fixtureBinding();
  const deps = { home, ghPath: s.GH, repositoryReader: s.testRepository,
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/${binding.repository}.git` } }),
    readObservation: () => ({ status: 'enabled', fresh: true, binding }),
    run: s.fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify(enabled) }, 'programme attention': s.ATTENTION }).run };
  const options = { job: 'programme-sweep', taskId: 'retry-programme-sweep', repoRoot: root };
  const at = Date.now() - 3 * 3600000;
  const first = job.runJob(options, { ...deps, now: () => new Date(at), takeProgrammeLock: () => null });
  const second = job.runJob(options, { ...deps, takeProgrammeLock: () => null });
  assert.equal(second.deferred_count, 2); assert.equal(second.deferred_since, first.started);
  assert.match(tasks.sweepLine(binding.repository, { home, registry: { status: 'ok', tasks: [{ id: options.taskId, host: 'windows', repository: binding.repository,
    job: options.job, schedule: 'hourly, 00:01 to 00:00' }] } }), /over 2 hours.*deferred|deferred.*over 2 hours/);
  const ok = job.runJob(options, deps); assert.equal(ok.status, 'ok');
  assert.equal(ok.deferred_count, undefined); assert.equal(ok.deferred_since, undefined);
});

test('new retry files are discovered once by both CI rest shards', () => {
  const shards = require('../scripts/ci-test-shards.cjs'), root = path.resolve(__dirname, '../..');
  const discovered = shards.discoverTestFiles(root), manifest = shards.loadManifest(root);
  for (const file of ['toolkit-scheduled-job-retry.test.cjs', 'toolkit-scheduled-job-retry-guards.test.cjs', 'toolkit-windows-task-layouts.test.cjs']) {
    const rel = `repo/tests/${file}`; assert.equal(discovered.filter(item => item === rel).length, 1);
    for (const system of shards.SYSTEMS) {
      const owners = shards.systemShards(manifest, system, discovered);
      assert.equal(owners.filter(shard => shard.files.includes(rel)).length, 1);
    }
  }
});
