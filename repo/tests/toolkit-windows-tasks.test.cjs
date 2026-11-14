'use strict';
const { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt } = require('./toolkit-windows-tasks-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
for (const scenario of ['expired cache', 'governance just enabled', 'moved store']) test(`fix2 binding: ${scenario} refreshes before reading and locking`, t => {
  const home = tempHome(t), root = checkout(t), binding = fixtureBinding();
  const next = { ...binding, store: { ...binding.store, repository: 'example/new-store' } };
  let refreshed = false, locked = false;
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  const record = job.runJob({ ...options, repoRoot: root }, {
    home, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY,
    run(file, args, opts) { if (args[0] === job.SCRIPT.governance) refreshed = true;
      else if (args[0] === job.SCRIPT.footerSweep || args[0] === job.SCRIPT.programme) assert.ok(locked, 'effects must hold the refreshed store lock');
      return fake.run(file, args, opts); },
    readObservation() { if (refreshed) return { status: 'enabled', fresh: true, binding: next };
      return scenario === 'expired cache' ? { status: 'enabled', fresh: false, binding }
        : scenario === 'governance just enabled' ? { status: 'none', fresh: true } : { status: 'enabled', fresh: true, binding }; },
    takeProgrammeLock(key) { assert.equal(key, next.store.repository); locked = true; return { release() { locked = false; } }; },
  });
  assert.equal(record.status, 'ok');
  assert.ok(fake.log.find(args => args[1] === job.SCRIPT.footerSweep).includes(next.store.repository));
});

test('fix2 owner: a rename retains local ownership; a carried id has visible supported recovery', t => {
  const home = tempHome(t), wanted = desired(t), scheduler = fakeScheduler();
  windowsTasks.applyTasks(wanted, { scheduler, home });
  const owner = tasks.readRegistry(home).tasks[0].job_owner;
  t.mock.method(os, 'hostname', () => 'renamed-computer');
  assert.ok(windowsTasks.planTasks(wanted, { scheduler, home }).items.every(item => item.action === 'current'));
  assert.equal(tasks.readRegistry(home).tasks[0].job_owner, owner);
  const otherHome = tempHome(t);
  // Initialise this computer's identity before carrying another computer's registry.
  windowsTasks.applyTasks(desired(t, { repository: 'example/other' }), { scheduler: fakeScheduler(), home: otherHome });
  tasks.writeRegistry(otherHome, tasks.readRegistry(home).tasks);
  assert.match(tasks.sweepLine(wanted.repository, { home: otherHome }), /owned.*remove.*repair-owned/i);
  const removed = windowsTasks.removeTasks({ scope: wanted, scheduler, home: otherHome });
  assert.ok(removed.items.every(item => item.action !== 'refused' && item.action !== 'failed'));
  const repaired = windowsTasks.applyTasks(wanted, { scheduler, home: otherHome, repairOwned: true });
  assert.ok(repaired.items.every(item => item.done), JSON.stringify(repaired));
});

test('fix2 owner: ordinary apply finishes migration of both hostname enrolments after a rename', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  windowsTasks.applyTasks(wanted, { home, scheduler });
  const id = tasks.computerIdentity(home).id;
  tasks.updateRegistry(home, entries => entries.map(entry => ({ ...entry, job_owner: 'earlier-hostname' })));
  t.mock.method(os, 'hostname', () => 'renamed-computer');
  const result = windowsTasks.applyTasks(wanted, { home, scheduler });
  assert.ok(result.items.every(item => item.done), JSON.stringify(result));
  assert.ok(tasks.readRegistry(home).tasks.every(entry => entry.job_owner === id));
  assert.ok(windowsTasks.planTasks(wanted, { home, scheduler }).items.every(item => item.action === 'current'));
});

test('fix2 owner: foreign shard ownership is visible with a local cleaner or no cleaner', t => {
  for (const shardOnly of [false, true]) {
    const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
    windowsTasks.applyTasks(wanted, { home, scheduler });
    const foreign = `local-${require('node:crypto').randomUUID()}`;
    tasks.updateRegistry(home, entries => entries.filter(entry => !shardOnly || entry.job === 'shard-timings')
      .map(entry => entry.job === 'shard-timings' ? { ...entry, job_owner: foreign, job_owner_label: 'other computer' } : entry));
    assert.match(tasks.sweepLine(wanted.repository, { home }), /owned by other computer.*remove.*repair-owned/);
  }
});

for (const mode of ['Monday same-minute shard', 'apply first sweep']) test(`fix2 lock: ${mode} records production-default deferral and hourly catch-up`, t => {
  const { ProgrammeJobLock } = require('../scripts/toolkit-programme-lock.cjs');
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t), root = checkout(t);
  addShards(root);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  const entries = tasks.readRegistry(home).tasks;
  const shard = entries.find(row => row.job === 'shard-timings'), sweep = entries.find(row => row.job === 'programme-sweep');
  assert.equal(shard.schedule.slice(-5), sweep.schedule.match(/00:(\d\d)/)[1] ? `08:${sweep.repo_minute.toString().padStart(2, '0')}` : 'missing');
  const held = new ProgrammeJobLock({ home, key: fixtureBinding().store.repository }).take();
  // A real, live lock aged three minutes, as in the production Monday collision.
  const lockFile = new ProgrammeJobLock({ home, key: fixtureBinding().store.repository }).file;
  const old = new Date(Date.now() - 180000); fs.utimesSync(lockFile, old, old);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  const selected = mode.startsWith('Monday') ? shard : sweep;
  const deps = { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY, readObservation: OBSERVATION, scheduler };
  try {
    const record = job.runJob({ job: selected.job, taskId: selected.id, repoRoot: wanted.root }, deps);
    assert.equal(record.status, 'deferred');
    assert.deepEqual(tasks.readLastRun(selected.id, home), record);
    assert.match(tasks.sweepLine(wanted.repository, { home }), /deferred.*retr/i);
    if (selected === sweep) {
      scheduler.onStart = live => { live.last_run = record.started; live.last_result = 0; };
      const first = windowsTasks.firstRun(wanted.wanted[0], { scheduler, home, now: () => new Date(record.started), wait: () => {}, waitMs: 0, pollMs: 1 });
      assert.equal(first.status, 'deferred');
      assert.doesNotMatch(first.detail, /wrote no result/);
    }
  } finally { held.release(); }
  if (selected === shard) {
    scheduler.onStart = live => {
      const free = new ProgrammeJobLock({ home, key: fixtureBinding().store.repository, waitMs: 0 }).take();
      assert.ok(free, 'catch-up must start after the sweep releases the store lock'); free.release();
      const outcome = job.runJob({ job: shard.job, taskId: shard.id, repoRoot: root }, deps);
      assert.equal(outcome.status, 'ok');
    };
    const caught = job.runJob({ job: sweep.job, taskId: sweep.id, repoRoot: wanted.root }, deps);
    assert.equal(caught.status, 'ok');
    assert.equal(tasks.readLastRun(shard.id, home).status, 'ok');
    assert.equal(scheduler.calls.filter(call => call[0] === 'start' && call[2] === shard.name).length, 1);
  }
});

test('fix2 lock: filesystem failure persists a failed last-run record', t => {
  const home = tempHome(t);
  const record = job.runJob({ ...options, repoRoot: checkout(t) }, { home, readIdentity: READ_IDENTITY, readObservation: OBSERVATION,
    run: fakeRun({ 'toolkit-governance.cjs': GOVERNED }).run, ghPath: GH, nodePath: NODE, repositoryReader: testRepository,
    takeProgrammeLock() { throw new Error('EACCES'); } });
  assert.equal(record.status, 'failed'); assert.equal(record.exit, 1);
  assert.deepEqual(tasks.readLastRun(options.taskId, home), record);
});

test('fix2 lock: apply reports a recorded deferral when its first run meets an active sweep', t => {
  const { ProgrammeJobLock } = require('../scripts/toolkit-programme-lock.cjs');
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  const owner = new ProgrammeJobLock({ home, key: fixtureBinding().store.repository }), held = owner.take();
  // File times keep the system clock while the preload moves Date. Align the
  // live fixture's heartbeat with the clock its contender observes.
  const heartbeat = new Date(); fs.utimesSync(owner.file, heartbeat, heartbeat);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  scheduler.onStart = live => {
    const record = job.runJob({ ...options, taskId: wanted.wanted[0].id, repoRoot: wanted.root }, { home, run: fake.run,
      repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY, readObservation: OBSERVATION });
    Object.assign(live, { last_run: record.started, last_result: 0 });
  };
  try {
    const applied = windowsTasks.applyTasks(wanted, { home, scheduler, firstRunOptions: { wait() {}, pollMs: 1, waitMs: 1 } });
    assert.ok(applied.items.every(item => item.done));
    assert.equal(applied.items[0].first_run.status, 'deferred');
    assert.equal(tasks.readLastRun(wanted.wanted[0].id, home).status, 'deferred');
    assert.match(windowsTasks.describePlan(applied, { applied: true }).join('\n'), /First run: deferred.*retr/);
  } finally { held.release(); }
});

for (const guard of ['owner stop', 'disabled', 'edited', 'running', 'foreign owner', 'moved checkout', 'governance off', 'signed out', 'start failure']) test(`fix2 catch-up: retains deferral with ${guard}`, t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  windowsTasks.applyTasks(wanted, { home, scheduler });
  const shard = tasks.readRegistry(home).tasks.find(entry => entry.job === 'shard-timings');
  tasks.writeLastRun(shard.id, { status: 'deferred' }, home);
  const live = scheduler.folders.get(shard.folder).find(task => task.name === shard.name);
  if (guard === 'disabled') live.state = 'Disabled';
  if (guard === 'running') live.state = 'Running';
  if (guard === 'edited') live.description += ' edited';
  if (['owner stop', 'foreign owner', 'moved checkout'].includes(guard)) tasks.updateRegistry(home, entries => entries.map(entry => entry.id !== shard.id ? entry : { ...entry,
    ...(guard === 'owner stop' ? { stopped_by_owner: true, stopped_at: new Date().toISOString() } : guard === 'foreign owner' ? { job_owner: `local-${require('node:crypto').randomUUID()}` } : { checkout: 'C:\\Other\\checkout' }) }));
  const fake = fakeRun({ 'toolkit-governance.cjs': guard === 'governance off' ? { status: 0, stdout: '{"state":"DISABLED","merged":{"status":"disabled","fresh":true}}' } : GOVERNED,
    'programme attention': ATTENTION, ...(guard === 'signed out' ? { 'gh auth': { status: 1, stderr: 'You are not logged into any GitHub hosts.' } } : {}) });
  if (guard === 'start failure') scheduler.start = () => { throw new Error('native start denied'); };
  job.runJob({ ...options, taskId: wanted.wanted[0].id, repoRoot: wanted.root }, { home, scheduler, run: fake.run,
    repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY, readObservation: OBSERVATION });
  assert.equal(scheduler.calls.some(call => call[0] === 'start'), false);
  assert.equal(tasks.readLastRun(shard.id, home).status, 'deferred');
});

test('A1a: nine stable minutes, collision warning, and Monday morning shards', t => {
  const home = tempHome(t), scheduler = fakeScheduler();
  const minutes = [];
  const repositories = new Map();
  for (let index = 0; index < 10; index++) {
    const wanted = desired(t, { repository: `example/repo-${index}`, folder: `REPO-${index}` });
    repositories.set(wanted.root, `example/repo-${index}`);
    wanted.checkoutDeps.governance.readIdentity = root => ({ valid: true, root, remote: { host: 'github.com', path: `/${repositories.get(root)}.git` } });
    const result = windowsTasks.applyTasks(wanted, { scheduler, home });
    assert.ok(result.items.every(item => item.done), JSON.stringify(result));
    const minute = result.items[0].definition.schedule.at.slice(-2);
    assert.match(minute, /^0[1-9]$/);
    minutes.push(minute);
    assert.equal(result.items[1].definition.schedule.at, `08:${minute}`);
    const again = windowsTasks.planTasks(wanted, { scheduler, home });
    assert.equal(again.items[0].definition.schedule.at.slice(-2), minute);
    if (index === 9) assert.match(windowsTasks.describePlan(again).join('\n'), /minute.*shared/i);
  }
  assert.equal(new Set(minutes.slice(0, 9)).size, 9);
  assert.equal(new Set(minutes).size, 9);
});

test('A1a: shard timings use Monday morning local time and require governance', t => {
  for (const state of ['ENABLED', 'UNDECIDED']) {
    const wanted = desired(t, { state });
    const result = windowsTasks.planTasks(wanted, { scheduler: fakeScheduler(), home: tempHome(t) });
    const shard = result.items.find(item => item.definition.job === 'shard-timings');
    if (state === 'ENABLED') assert.deepEqual(shard.definition.schedule, { kind: 'weekly', day: 'Monday', at: '08:01' });
    else assert.equal(shard, undefined);
  }
});

test('A1a: known job owner on another computer is listed and never registered', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  const computerOne = tasks.computerIdentity(home).id;
  const other = fakeScheduler(), otherHome = tempHome(t);
  tasks.writeRegistry(otherHome, tasks.readRegistry(home).tasks);
  const computerTwo = tasks.computerIdentity(otherHome, { create: true }).id;
  const result = windowsTasks.applyTasks(wanted, { scheduler: other, home: otherHome });
  assert.equal(result.refused, true);
  assert.match(windowsTasks.describePlan(result).join('\n'), new RegExp(`owned.*${computerOne}`, 'i'));
  assert.equal(other.calls.filter(call => call[0] === 'register').length, 0);
  const outcome = job.runJob({ job: 'programme-sweep', repoRoot: wanted.root, taskId: wanted.wanted[0].id }, {
    home: otherHome, computerId: computerTwo, readIdentity: () => assert.fail('non-owner must not start job work'),
  });
  assert.equal(outcome.status, 'skipped');
  assert.match(outcome.reason, /owned by another computer/);
  assert.deepEqual(tasks.readLastRun(wanted.wanted[0].id, otherHome), outcome);
  assert.match(tasks.formatList(tasks.listTasks({ home: otherHome, platform: 'win32', scheduler: other, folderFor: () => wanted.folder })), new RegExp(`owned by ${require('node:os').hostname()}`));
});

test('A1a: recognised earlier Toolkit definition updates without accepting hand edits', t => {
  for (const generation of ['daytime', 'full-day']) {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  const old = { ...wanted, wanted: wanted.wanted.map(d => ({ ...d })) };
  for (const d of old.wanted) {
    d.schedule = d.job === 'shard-timings' ? { kind: 'weekly', day: 'Monday', at: '09:15' } : { kind: 'hourly', at: '00:00', hours: 24 };
    if (generation === 'daytime') {
      d.schedule = d.job === 'shard-timings' ? d.schedule : { kind: 'hourly', at: '08:00', hours: 16 };
      d.purpose = d.job === 'shard-timings' ? 'Refreshes the measured test times and opens a pull request when the CI shards drift. No AI.'
        : 'Brings the programme pages up to date, keeps the attention line and removes the cloud route footer from your own GitHub posts. No AI.';
    }
    d.arguments = d.arguments.replace(`"${d.launcher}" "${d.toolkit_root}"`, `"${d.toolkit_root}\\repo\\scripts\\toolkit-scheduled-job.cjs"`);
    d.working_directory = d.toolkit_root;
    d.schedule_text = windowsTasks.describeSchedule(d.schedule);
    d.time_limit_minutes = 30;
    d.def = windowsTasks.definitionDigest(d);
    if (generation === 'daytime') d.def = require('node:crypto').createHash('sha256').update(JSON.stringify({ execute: d.execute, args: d.arguments, workingDirectory: d.working_directory, schedule: d.schedule, settings: 'v1 interactive start-when-available ignore-new 30m battery' })).digest('hex').slice(0, 12);
    d.description = `${d.folder}: ${windowsTasks.JOBS[d.job].task}. ${d.purpose} [toolkit-task v1 id=${d.id} def=${d.def}]`;
    scheduler.register(d);
    const live = scheduler.list(d.folder).find(row => row.name === d.name);
    tasks.updateRegistry(home, rows => [...rows, { id: d.id, host: 'windows', folder: d.folder, name: d.name, schedule: d.schedule_text, purpose: d.purpose,
      repository: d.repository, job: d.job, definition: d.def, created: new Date().toISOString(), created_by: 'toolkit-windows-tasks apply', model: null, effort: null }]);
    assert.ok(live);
  }
  const result = windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.deepEqual(result.items.map(item => item.action), ['update', 'update']);
  assert.ok(result.items.every(item => item.done));
  scheduler.folders.get(wanted.folder)[0].arguments += ' --owner-edit';
  assert.ok(windowsTasks.planTasks(wanted, { scheduler, home }).items.some(item => ['refused', 'owner-choice-required'].includes(item.action)));
  }
});

test('G: an ENABLED Toolkit checkout gets both tasks in \\TOOLKIT\\, recorded in the registry', (t) => {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const wanted = desired(t);
  assert.deepEqual(wanted.wanted.map(d => d.name), ['TOOLKIT - PROGRAMME SWEEP', 'TOOLKIT - SHARD TIMINGS']);
  const result = windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.deepEqual(result.items.map(item => [item.action, item.done]), [['create', true], ['create', true]]);
  assert.deepEqual([...scheduler.folders.get('TOOLKIT')].map(task => task.name).sort(), ['TOOLKIT - PROGRAMME SWEEP', 'TOOLKIT - SHARD TIMINGS']);
  const registry = tasks.readRegistry(home);
  assert.equal(registry.status, 'ok');
  assert.deepEqual(registry.tasks.map(entry => [entry.id, entry.folder, entry.schedule, entry.model, entry.effort]),
    [['toolkit-programme-sweep', 'TOOLKIT', 'hourly, 00:01 to 00:00', null, null], ['toolkit-shard-timings', 'TOOLKIT', 'weekly, Monday 08:01', null, null]]);
  const report = windowsTasks.describePlan(result, { applied: true }).join('\n');
  assert.match(report, /TOOLKIT - PROGRAMME SWEEP \(hourly, 00:01 to 00:00\): created\. Cleans your own GitHub posts/);
  assert.match(report, /TOOLKIT - SHARD TIMINGS \(weekly, Monday 08:01\): created\./);
  if (process.platform !== 'win32') assert.equal((fs.statSync(tasks.registryPath(home)).mode & 0o777), 0o600);
  const sweep = wanted.wanted[0];
  assert.equal(sweep.execute, 'C:\\Windows\\System32\\conhost.exe');
  assert.equal(sweep.arguments, `--headless "${NODE}" "${sweep.launcher}" "${TOOLKIT_ROOT}" programme-sweep --repo-root "${wanted.root}" --task-id toolkit-programme-sweep`);
  assert.match(sweep.description, /^TOOLKIT: PROGRAMME SWEEP\. .*\[toolkit-task v1 id=toolkit-programme-sweep def=[0-9a-f]{12}\]$/);
});

test('G: fresh enabled governance selects programme and shards; fresh off or absent selects footer; uncertainty refuses', (t) => {
  const cases = [
    { state: 'ENABLED', binding: true, allowed: true },
    ...['DISABLED', 'UNDECIDED', 'ERROR', null].flatMap(state => [true, false].map(binding => ({ state, binding, allowed: state === 'DISABLED' || state === 'UNDECIDED', footer: state === 'DISABLED' || state === 'UNDECIDED' }))),
    { state: 'ENABLED', binding: false, allowed: false },
  ];
  for (const row of cases) for (const hasShards of [false, true]) {
    const scheduler = fakeScheduler();
    const wanted = desired(t, { ...row, shards: hasShards, repository: 'example/widget', folder: 'WIDGET' });
    const result = windowsTasks.applyTasks(wanted, { scheduler, home: tempHome(t) });
    assert.deepEqual(result.items.map(item => item.definition.job), row.footer ? ['footer-sweep'] : row.allowed ? ['programme-sweep', 'shard-timings'] : [], JSON.stringify({ ...row, hasShards }));
    assert.equal(scheduler.calls.filter(call => call[0] === 'register').length, row.footer ? 1 : row.allowed ? 2 : 0);
    if (!row.allowed) {
      assert.equal(result.refused, true, 'unavailable governance is an apply refusal, never a success');
      assert.equal(result.skipped.length, 3);
      for (const item of result.skipped) assert.match(item.reason, /fresh matching merged governance could not be verified/);
      assert.doesNotMatch(windowsTasks.describePlan(result, { command: 'node x apply' }).join('\n'), /Run this command/);
      assert.equal(windowsTasks.main(['apply', '--no-first-run', '--repo-root', wanted.root], {
        platform: 'win32', home: tempHome(t), scheduler, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE,
        checkoutDeps: { identityReader, governance: governance(row) }, stdout: () => {}, stderr: () => {},
      }), 1);
      assert.ok(scheduler.calls.every(call => call[0] === 'list'));
    }
  }
});

test('G: binding folder or repository default selects both jobs; unreadable evidence grants nothing', (t) => {
  const root = checkout(t, { shards: false });
  for (const [folder, expected] of [['BOUND', 'BOUND'], [null, 'WIDGET']]) {
    const wanted = desired(t, { root, repository: 'example/widget', folder });
    assert.equal(wanted.folder, expected);
    assert.ok(wanted.wanted.every(item => item.folder === expected));
    const command = windowsTasks.applyCommand(wanted, { toolkitRoot: TOOLKIT_ROOT, home: tempHome(t) });
    assert.equal(command, `node "${TOOLKIT_ROOT}\\repo\\scripts\\toolkit-windows-tasks.cjs" apply --repo-root "${root}"`);
    assert.doesNotMatch(command, /--folder|--no-first-run/);
  }
  for (const failing of ['readObservation', 'governanceState']) {
    const reader = governance();
    reader[failing] = () => { throw new Error('unreadable'); };
    const wanted = windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: reader } });
    assert.deepEqual(wanted.wanted, [], failing);
    assert.equal(wanted.skipped.length, 3);
  }
});

test('G: setup run again unchanged changes nothing; a changed definition is updated in place', (t) => {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const root = checkout(t);
  windowsTasks.applyTasks(desired(t, { root }), { scheduler, home });
  const before = fs.readFileSync(tasks.registryPath(home), 'utf8');
  scheduler.calls.length = 0;
  const again = windowsTasks.applyTasks(desired(t, { root }), { scheduler, home });
  assert.deepEqual(again.items.map(item => item.action), ['current', 'current']);
  assert.equal(scheduler.calls.filter(call => call[0] === 'register').length, 0);
  assert.equal(fs.readFileSync(tasks.registryPath(home), 'utf8'), before);
  const changed = desired(t, { root, nodePath: 'D:\\node\\node.exe' });
  const plan = windowsTasks.planTasks(changed, { scheduler, home });
  assert.deepEqual(plan.items.map(item => item.action), ['update', 'update']);
  const updated = windowsTasks.applyTasks(changed, { scheduler, home });
  assert.deepEqual(updated.items.map(item => item.done), [true, true]);
  assert.match(scheduler.folders.get('TOOLKIT')[0].arguments, /D:\\node\\node\.exe/);
  assert.deepEqual(tasks.readRegistry(home).tasks.map(entry => entry.definition), changed.wanted.map(d => d.def));
  assert.equal(scheduler.folders.get('TOOLKIT').length, 2, 'updated in place, not added');
});

test('G: the owner\'s own same-named task without the marker is untouched and Toolkit refuses', (t) => {
  const home = tempHome(t);
  const own = unmarked('TOOLKIT - PROGRAMME SWEEP');
  const ownShards = unmarked('TOOLKIT - SHARD TIMINGS');
  const scheduler = fakeScheduler({ TOOLKIT: [own, ownShards] });
  const wanted = desired(t, { shards: false });
  const result = windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.equal(result.items[0].action, 'refused');
  assert.match(result.items[0].reason, /is already in \\TOOLKIT\\ and is not Toolkit's .* leaves it alone/);
  assert.deepEqual(result.items.map(item => item.action), ['refused', 'refused']);
  assert.deepEqual(scheduler.folders.get('TOOLKIT'), [own, ownShards]);
  assert.deepEqual(tasks.readRegistry(home).tasks, []);
  assert.equal(scheduler.calls.some(call => call[0] === 'register'), false);
  // A marked task this computer did not record is not Toolkit's either.
  const marked = { ...own, description: `${wanted.wanted[0].description}` };
  const second = windowsTasks.planTasks(wanted, { scheduler: fakeScheduler({ TOOLKIT: [marked] }), home });
  assert.equal(second.items[0].action, 'refused');
  assert.match(second.items[0].reason, /carries Toolkit's marker but this computer's task registry does not list it/);
  const lines = [];
  const code = windowsTasks.main(['apply', '--no-first-run'], { platform: 'win32', home, scheduler, cwd: checkout(t, { shards: false }), checkoutDeps: { identityReader, governance: governance() }, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, stdout: text => lines.push(text), stderr: () => {} });
  assert.equal(code, 1);
  assert.match(lines.join(''), /PROGRAMME SWEEP \(hourly, 00:01 to 00:00\): refused/);
});

test('G: root-folder n8n backups and other repositories\' folders are never changed', (t) => {
  const home = tempHome(t);
  const n8n = unmarked('n8n-local-cli-backup-0123456789ab', { description: 'n8n backup' });
  const other = { ...unmarked('SAQG - PROGRAMME SWEEP'), description: 'SAQG: PROGRAMME SWEEP. x [toolkit-task v1 id=saqg-programme-sweep def=0123456789ab]' };
  const scheduler = fakeScheduler({ '': [n8n], SAQG: [other] });
  const wanted = desired(t);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  windowsTasks.removeTasks({ scope: wanted, scheduler, home });
  assert.deepEqual(scheduler.folders.get(''), [n8n]);
  assert.deepEqual(scheduler.folders.get('SAQG'), [other]);
  assert.equal(scheduler.calls.some(call => call[0] !== 'list' && (call[1] === 'SAQG' || call[1] === '' || call[1] === null)), false);
  const listed = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT' });
  const row = listed.rows.find(item => item.name === n8n.name);
  assert.equal(row.state, 'outside the folder (not changed)');
});

test('G: adopted fixed-job conflicts and a corrupt registry keep their refusals', (t) => {
  const home = tempHome(t);
  const wanted = desired(t, { shards: false });
  const scheduler = fakeScheduler({ TOOLKIT: wanted.wanted.map(item => unmarked(item.name)) });
  for (const item of wanted.wanted) windowsTasks.adoptTask({ folder: item.folder, task: item.name, id: item.id, purpose: item.purpose }, { scheduler, home });
  // Even adding a marker cannot turn an adopted record into Toolkit ownership.
  scheduler.folders.get('TOOLKIT').forEach((item, index) => { item.description = wanted.wanted[index].description; });
  const before = fs.readFileSync(tasks.registryPath(home));
  scheduler.calls.length = 0;
  assert.deepEqual(windowsTasks.applyTasks(wanted, { scheduler, home }).items.map(item => item.action), ['refused', 'refused']);
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
  assert.deepEqual(scheduler.calls.map(call => call[0]), ['list']);

  fs.writeFileSync(tasks.registryPath(home), '{broken');
  scheduler.calls.length = 0;
  assert.throws(() => windowsTasks.applyTasks(wanted, { scheduler, home }), /registry .* could not be read, so no task was changed/);
  assert.equal(fs.readFileSync(tasks.registryPath(home), 'utf8'), '{broken');
  assert.deepEqual(scheduler.calls.map(call => call[0]), ['list']);
});

test('A1b: a task registered with the earlier 30-minute limit updates in place to the new limit', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  for (const current of wanted.wanted) {
    const d = { ...current, time_limit_minutes: 30 };
    d.def = windowsTasks.definitionDigest(d);
    assert.notEqual(d.def, current.def, 'the limit is part of the definition');
    d.description = current.description.replace(`def=${current.def}]`, `def=${d.def}]`);
    scheduler.register(d);
    // Enrolled as apply records it: checkout, runner location and the exact live baseline.
    const live = scheduler.list(d.folder).find(row => row.name === d.name);
    tasks.updateRegistry(home, rows => [...rows, { id: d.id, host: 'windows', folder: d.folder, name: d.name, schedule: d.schedule_text, purpose: d.purpose,
      repository: d.repository, job: d.job, definition: d.def, checkout: d.checkout, toolkit_root: d.toolkit_root, enrolled: windowsTasks.enrolledDefinition(live),
      created: new Date().toISOString(), created_by: 'toolkit-windows-tasks apply', model: null, effort: null }]);
  }
  const result = windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.deepEqual(result.items.map(item => item.action), wanted.wanted.map(() => 'update'), JSON.stringify(result.items.map(item => item.reason)));
  assert.ok(result.items.every(item => item.done));
  for (const current of wanted.wanted) assert.ok(scheduler.list(current.folder).some(row => row.description === current.description), 'registered with the new definition');
  scheduler.folders.get(wanted.folder)[0].arguments += ' --owner-edit';
  assert.ok(windowsTasks.planTasks(wanted, { scheduler, home }).items.some(item => ['refused', 'owner-choice-required'].includes(item.action)), 'a hand edit is still not accepted');
});
