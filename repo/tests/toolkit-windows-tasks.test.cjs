'use strict';

// Windows scheduled tasks under \<schedule_folder>\, the no-AI job runner and `toolkit tasks`.
// Everything runs against a fake Task Scheduler; the one real-registration test runs only when the
// owner explicitly authorises the scratch-folder test and sets TOOLKIT_REAL_TASK_SCHEDULER_TEST=1.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const { tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION } = require('./support/windows-task-switch-world.cjs');
const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const shards = require('../scripts/ci-test-shards.cjs');

const MEMORY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-memory-'));
test.after(() => fs.rmSync(MEMORY_HOME, { recursive: true, force: true }));

const hostile = require('./support/hostile-inputs.cjs');

test('fix2 hold: real planner apply and remove output passes the independent reader', t => {
  const home = tempHome(t), managed = path.join(home, 'managed'), root = path.join(home, 'checkout');
  fs.mkdirSync(path.join(managed, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(managed, 'repo', 'scripts', 'toolkit-windows-tasks.cjs'), '');
  const state = path.join(home, '.ai-agent-toolkit', 'current', 'state.json');
  fs.mkdirSync(path.dirname(state), { recursive: true }); fs.writeFileSync(state, JSON.stringify({ repo_path: managed }));
  const policy = require('../scripts/toolkit-task-policy.cjs');
  const command = windowsTasks.applyCommand({ root }, { toolkitRoot: managed, home });
  for (const line of [command, command.replace(' apply ', ' remove ')]) {
    assert.equal(policy.independentTaskCommand(line, { home, cwd: root, certainIndependent: target => path.normalize(target) === path.normalize(root) }), true, line);
  }
});

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
    'programme attention': ATTENTION, ...(guard === 'signed out' ? { 'gh auth': { status: 1 } } : {}) });
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
    d.schedule_text = windowsTasks.describeSchedule(d.schedule);
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

function memoryRegistry(initial = []) {
  let entries = structuredClone(initial);
  const calls = [];
  return {
    calls, corrupt: false,
    readRegistry() { return this.corrupt ? { status: 'unreadable', reason: 'bad fixture' } : { status: 'ok', tasks: structuredClone(entries) }; },
    updateRegistry(home, change) {
      const next = change(structuredClone(entries));
      for (const entry of next) assert.equal(tasks.entryProblem(entry), null);
      calls.push('write'); entries = structuredClone(next); return next;
    },
    writeTaskBackup() { calls.push('backup'); return 'fixture-backup'; },
  };
}

const matrixKinds = ['managed checkout', 'plugin copy', 'linked worktree', 'other copy'];
const matrixTargets = ['main checkout', 'linked worktree', 'missing/not a repo'];
const matrixStates = ['absent', 'healthy same repository', 'healthy other repository', 'healthy other checkout', 'disabled', 'edited action', 'edited trigger', 'removed by owner', 'adopted/unowned', 'corrupt registry'];
const matrixRequesters = ['agent standing', 'owner explicit', 'setup plan'];
for (const shape of ['programme', 'footer']) for (const toolkit of matrixKinds) for (const target of matrixTargets) for (const state of matrixStates) for (const requester of matrixRequesters) {
  test(`closure: ${shape} / ${toolkit} / ${target} / ${state} / ${requester}`, () => {
    const scheduler = fakeScheduler();
    const registry = memoryRegistry();
    const root = 'C:\\Repositories\\widget';
    const wanted = windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: governance({ repository: 'example/widget', folder: 'WIDGET', state: shape === 'footer' ? 'UNDECIDED' : 'ENABLED' }) } });
    const owner = () => new windowsTasks.WindowsTaskOwner({ scheduler, registry, home: MEMORY_HOME, identityReader,
      now: () => new Date('2026-11-05T00:00:00.000Z'), repairOwned: requester === 'owner explicit' });
    if (state !== 'absent') assert.ok(owner().apply(wanted).items.every(item => item.done));
    if (state === 'healthy other repository') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, repository: 'someone-else/widget' })));
    if (state === 'healthy other checkout') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, checkout: 'C:\\Old\\widget' })));
    if (state === 'disabled') scheduler.folders.get('WIDGET')[0].state = 'Disabled';
    if (state === 'edited action') scheduler.folders.get('WIDGET')[0].arguments += ' --owner-edit';
    if (state === 'edited trigger') scheduler.folders.get('WIDGET')[shape === 'footer' ? 0 : 1].triggers = [{ kind: 'MSFT_TaskWeeklyTrigger', start: '2099-01-01T09:15:00', days_of_week: 2 }];
    if (state === 'removed by owner') owner().remove('WIDGET', wanted);
    if (state === 'adopted/unowned') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, adopted: true })));
    if (state === 'corrupt registry') registry.corrupt = true;
    scheduler.calls.length = 0; registry.calls.length = 0;
    const beforeRegistry = registry.readRegistry();
    const beforeTasks = structuredClone([...scheduler.folders]);
    const validLocation = toolkit === 'managed checkout' && target === 'main checkout';
    const repairable = ['healthy other checkout', 'disabled', 'edited action', 'edited trigger', 'removed by owner'].includes(state);
    const allowed = validLocation && (['absent', 'healthy same repository'].includes(state) || requester === 'owner explicit' && repairable);
    const reader = request => { if (!validLocation) throw new Error('unsupported invocation location'); return identityReader(request); };
    let result;
    const invoke = () => {
      const instance = new windowsTasks.WindowsTaskOwner({ scheduler, registry, home: MEMORY_HOME, identityReader: reader,
        now: () => new Date('2026-11-05T00:00:00.000Z'), repairOwned: requester === 'owner explicit' });
      return requester === 'setup plan' ? instance.plan(wanted) : instance.apply(wanted);
    };
    if (!validLocation || state === 'corrupt registry' && requester !== 'setup plan') assert.throws(invoke);
    else { result = invoke(); assert.equal(result.items.every(item => !['refused', 'owner-choice-required'].includes(item.action)), allowed); }
    if (!allowed || requester === 'setup plan') {
      assert.deepEqual(registry.readRegistry(), beforeRegistry, 'registry unchanged');
      assert.deepEqual([...scheduler.folders], beforeTasks, 'scheduler unchanged');
      assert.deepEqual(registry.calls, [], 'no registry mutation or backup');
      assert.ok(scheduler.calls.every(call => call[0] === 'list'), 'no registration, removal, start or wait');
    } else {
      assert.ok(result.items.every(item => item.done));
      assert.ok(registry.readRegistry().tasks.every(entry => !entry.stopped_by_owner));
    }
  });
}

function governance({ state = 'ENABLED', folder = 'TOOLKIT', repository = 'weijunswj/ai-agent-toolkit', binding = true } = {}) {
  const status = state === 'ENABLED' ? binding ? 'enabled' : 'unknown' : state === 'DISABLED' ? binding ? 'disabled' : 'none' : state === 'UNDECIDED' ? 'none' : 'unknown';
  const source = binding && ['enabled', 'disabled'].includes(status) ? fixtureBinding(repository, folder, status === 'enabled') : null;
  return {
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/${repository}.git` } }),
    governanceState: () => ({ state, merged: { status, fresh: status !== 'unknown' } }),
    mergedBinding: () => source,
    readObservation: () => ({ status, fresh: status !== 'unknown', binding: source }),
  };
}

// Restart snapshots represent the same computer, including its persisted local identity.
function copyComputerIdentity(home, replayHome) {
  fs.mkdirSync(tasks.userStateDir(replayHome), { recursive: true });
  fs.copyFileSync(path.join(tasks.userStateDir(home), 'task-computer.json'), path.join(tasks.userStateDir(replayHome), 'task-computer.json'));
}

function desired(t, options = {}) {
  return windowsTasks.desiredTasks({ checkout: options.root || checkout(t, options), toolkitRoot: TOOLKIT_ROOT, nodePath: options.nodePath || NODE, systemRoot: 'C:\\Windows',
    folder: options.folder || null, deps: { identityReader, governance: governance(options) } });
}

const unmarked = (name, extra = {}) => ({ name, description: 'My own task', state: 'Ready', execute: 'C:\\x.exe', arguments: '', working_directory: '', triggers: [], last_run: null, last_result: 0, ...extra });

// ---- G. install, reinstall and remove --------------------------------------------------------

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
  assert.equal(sweep.arguments, `--headless "${NODE}" "${TOOLKIT_ROOT}\\repo\\scripts\\toolkit-scheduled-job.cjs" programme-sweep --repo-root "${wanted.root}" --task-id toolkit-programme-sweep`);
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

test('G: a native denial is reported without a second route or task effect', (t) => {
  let attempts = 0;
  assert.throws(() => windowsTasks.runPowerShell('list', { folder: 'TOOLKIT' }, { run: () => {
    attempts += 1;
    return { status: 1, stderr: 'Access is denied' };
  } }), /Access is denied/);
  assert.equal(attempts, 1);
  const scheduler = fakeScheduler();
  scheduler.list = () => { attempts += 1; throw new Error('Access is denied'); };
  const errors = [];
  assert.equal(windowsTasks.main(['apply', '--repo-root', checkout(t)], { platform: 'win32', scheduler, home: tempHome(t), checkoutDeps: { identityReader, governance: governance() }, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, stderr: text => errors.push(text), stdout: () => {} }), 1);
  assert.equal(attempts, 2);
  assert.match(errors.join(''), /Access is denied/);
  assert.deepEqual(scheduler.calls, []);
});

test('G: --remove-toolkit-tasks removes only marked and recorded tasks; the folder only when empty', (t) => {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const wanted = desired(t);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  scheduler.folders.get('TOOLKIT').push(unmarked('Session Digest'));
  windowsTasks.adoptTask({ folder: 'TOOLKIT', task: 'Session Digest', id: 'session-digest', purpose: 'Daily redacted session digest. No AI.' }, { scheduler, home });
  const kept = windowsTasks.removeTasks({ scope: wanted, scheduler, home });
  assert.deepEqual(kept.items.map(item => item.action), ['removed', 'removed']);
  assert.deepEqual(kept.folders, [{ folder: 'TOOLKIT', result: 'kept' }]);
  assert.deepEqual(scheduler.folders.get('TOOLKIT').map(task => task.name), ['Session Digest']);
  assert.deepEqual(tasks.readRegistry(home).tasks.filter(entry => !entry.stopped_by_owner).map(entry => entry.id), ['session-digest'], 'adopted task untouched; owned stops retained');
  // With nothing else in it, the folder goes too.
  const home2 = tempHome(t);
  const empty = fakeScheduler();
  const wanted2 = desired(t);
  windowsTasks.applyTasks(wanted2, { scheduler: empty, home: home2 });
  assert.deepEqual(windowsTasks.removeTasks({ scope: wanted2, scheduler: empty, home: home2 }).folders, [{ folder: 'TOOLKIT', result: 'removed' }]);
  assert.equal(empty.folders.has('TOOLKIT'), false);
  assert.ok(tasks.readRegistry(home2).tasks.every(entry => entry.stopped_by_owner));
  // A recorded task whose marker was edited away is left alone.
  const home3 = tempHome(t);
  const edited = fakeScheduler();
  const wanted3 = desired(t, { shards: false });
  windowsTasks.applyTasks(wanted3, { scheduler: edited, home: home3 });
  edited.folders.get('TOOLKIT')[0].description = 'changed by hand';
  assert.equal(windowsTasks.removeTasks({ scope: wanted3, scheduler: edited, home: home3 }).items[0].action, 'refused');
  assert.deepEqual(edited.folders.get('TOOLKIT').map(item => item.name), ['TOOLKIT - PROGRAMME SWEEP']);
});

test('G: a name with a colon, a reserved character or a stray space is refused before any PowerShell call', () => {
  for (const name of ['TOOLKIT: SWEEP', 'TOOLKIT - SWEEP ', ' TOOLKIT', 'A/B', 'A\\B', 'A*B', 'A?B', 'A"B', 'A<B', 'A>B', 'A|B', '.', '..']) {
    assert.ok(windowsTasks.nameProblem(name), name);
    let spawned = false;
    assert.throws(() => windowsTasks.runPowerShell('start', { folder: 'TOOLKIT', name }, { run: () => { spawned = true; return { status: 0, stdout: '' }; } }), /task name/);
    assert.equal(spawned, false, name);
  }
  assert.equal(windowsTasks.nameProblem('TOOLKIT - PROGRAMME SWEEP'), null);
  for (const folder of ['toolkit', '-X', 'A B', 'A'.repeat(33), '..']) assert.throws(() => windowsTasks.runPowerShell('list', { folder }, { run: () => assert.fail('spawned') }), /folder/);
  assert.equal(windowsTasks.defaultFolder('acme/my.app_v2'), 'MY-APP-V2');
});

test('G: on any computer but Windows every command reports not-windows and changes nothing', (t) => {
  const scheduler = fakeScheduler();
  for (const argv of [['plan'], ['apply'], ['remove'], ['adopt', '--folder', 'TOOLKIT', '--task', 'X', '--id', 'x', '--purpose', 'y']]) {
    const out = [];
    assert.equal(windowsTasks.main(argv, { platform: 'linux', scheduler, home: tempHome(t), stdout: text => out.push(text) }), 0);
    assert.match(out.join(''), /^not-windows/);
  }
  assert.deepEqual(scheduler.calls, []);
});

test('G: plan prints the exact apply command and approval guidance, with literal managed and repository paths', (t) => {
  const home = 'C:\\Users\\someone';
  const wanted = desired(t, { root: 'C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit' });
  const command = windowsTasks.applyCommand(wanted, { toolkitRoot: 'C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit', home });
  assert.equal(command, 'node "C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\toolkit-windows-tasks.cjs" apply --repo-root "C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit"');
  const text = windowsTasks.describePlan(windowsTasks.planTasks(wanted, { scheduler: fakeScheduler(), home: tempHome(t) }), { command }).join('\n');
  assert.match(text, /An eligible local agent can register these fixed jobs/);
  assert.doesNotMatch(text, /paste.*yourself|agents do not create scheduled tasks/i);
});

test('G: the registered task runs headless as the logged-on user, ignores a second start and stops at 30 minutes', () => {
  const script = windowsTasks.SCRIPTS.register;
  assert.match(script, /-LogonType Interactive -RunLevel Limited/);
  assert.match(script, /-StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit \(New-TimeSpan -Minutes 30\) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries/);
  assert.match(script, /IndexOf\(\$p\.marker_prefix\) -lt 0\) \{ throw/);
  assert.doesNotMatch(script, /-Password|-User\s/);
  assert.match(windowsTasks.SCRIPTS.unregister, /IndexOf\(\$p\.marker\) -lt 0\) \{ throw/);
  assert.match(windowsTasks.SCRIPTS['remove-folder'], /GetTasks\(1\)\.Count -eq 0 -and \$f\.GetFolders\(0\)\.Count -eq 0/);
});

test('G: a first run stopped by a console close is started once more, and healthy only when its record says ok', (t) => {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  let starts = 0;
  let clock = Date.parse('2026-10-29T08:00:00Z');
  const now = () => new Date(clock);
  scheduler.onStart = (task) => {
    starts += 1;
    clock += 1000;
    task.last_run = new Date(clock).toISOString();
    task.state = 'Ready';
    if (starts === 1) { task.last_result = windowsTasks.STATUS_CONTROL_C_EXIT; return; }
    task.last_result = 0;
    tasks.writeLastRun('toolkit-programme-sweep', { started: new Date(clock).toISOString(), exit: 0, status: 'ok', summary: ['Programme refresh: done.'] }, home);
  };
  const result = windowsTasks.applyTasks(desired(t, { shards: false }), { scheduler, home, now, firstRunOptions: { wait: () => {}, waitMs: 10, pollMs: 5 } });
  assert.equal(starts, 2);
  assert.equal(result.items[0].first_run.status, 'ok');
  assert.equal(result.items[0].first_run.restarted, true);
  // A run that wrote no record is not healthy.
  const home2 = tempHome(t);
  const silent = fakeScheduler();
  silent.onStart = (task) => { clock += 1000; task.last_run = new Date(clock).toISOString(); task.last_result = 0; };
  const failed = windowsTasks.applyTasks(desired(t, { shards: false }), { scheduler: silent, home: home2, now, firstRunOptions: { wait: () => {}, waitMs: 10, pollMs: 5 } });
  assert.equal(failed.items[0].first_run.status, 'failed');
  assert.match(failed.items[0].first_run.detail, /wrote no result/);
  // A run whose record says it failed is not healthy, even though Windows reports 0x0.
  const home3 = tempHome(t);
  const failing = fakeScheduler();
  failing.onStart = (task) => {
    clock += 1000;
    Object.assign(task, { last_run: new Date(clock).toISOString(), last_result: 0, state: 'Ready' });
    tasks.writeLastRun('toolkit-programme-sweep', { started: new Date(clock).toISOString(), exit: 1, status: 'failed', summary: ['Footer sweep failed (exit 1): 1 MISMATCH.'] }, home3);
  };
  const unhealthy = windowsTasks.applyTasks(desired(t, { shards: false }), { scheduler: failing, home: home3, now, firstRunOptions: { wait: () => {}, waitMs: 10, pollMs: 5 } });
  assert.equal(unhealthy.items[0].first_run.status, 'failed');
  assert.match(unhealthy.items[0].first_run.detail, /^failed: Footer sweep failed/);
});

test('G: a change to the schedule alone is updated in place, through the definition digest', (t) => {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const root = checkout(t);
  windowsTasks.applyTasks(desired(t, { root }), { scheduler, home });
  const changed = desired(t, { root });
  const sweep = changed.wanted[0];
  const before = sweep.def;
  sweep.schedule = { kind: 'hourly', at: '09:00', hours: 15 };
  sweep.def = windowsTasks.definitionDigest(sweep);
  sweep.description = sweep.description.replace(`def=${before}]`, `def=${sweep.def}]`);
  assert.notEqual(sweep.def, before);
  const plan = windowsTasks.planTasks(changed, { scheduler, home });
  assert.deepEqual(plan.items.map(item => item.action), ['update', 'current'], 'the action, its arguments and folder are unchanged; only the digest tells');
});

test('identity: canonical main locations and exact Toolkit origin, with no network reads', () => {
  const calls = [];
  const primary = root => { calls.push(['primary', root]); return root.toLowerCase(); };
  const deps = { readFile: () => JSON.stringify({ repo_path: TOOLKIT_ROOT }), realpath: value => value.toLowerCase(), mainCheckout: primary,
    run: (file, args) => { calls.push([file, ...args]); return { status: 0, stdout: 'https://github.com/weijunswj/ai-agent-toolkit.git\n' }; } };
  const request = { toolkitRoot: TOOLKIT_ROOT, checkout: 'C:\\Repos\\widget', home: 'fixture' };
  assert.deepEqual(windowsTasks.readLocations(request, deps), { toolkitRoot: TOOLKIT_ROOT.toLowerCase(), checkout: 'c:\\repos\\widget' });
  assert.ok(calls.filter(call => call[0] === 'git').every(call => call.includes('config') && !call.includes('fetch')));
  for (const copy of [`${TOOLKIT_ROOT}-prefix`, 'C:\\Plugins\\toolkit', 'C:\\Other\\toolkit']) assert.throws(() => windowsTasks.readLocations({ ...request, toolkitRoot: copy }, deps), /recorded managed/);
  assert.throws(() => windowsTasks.readLocations(request, { ...deps, readFile: () => '{bad' }), /could not be read/);
  assert.throws(() => windowsTasks.readLocations(request, { ...deps, run: () => ({ status: 0, stdout: 'https://github.com/another/ai-agent-toolkit.git' }) }), /expected Toolkit/);
  const git = (root, common, first) => (file, args) => ({ status: 0, stdout: args.includes('--show-toplevel') ? root : args.includes('--git-common-dir') || args.includes('--absolute-git-dir') ? common : `worktree ${first}\0HEAD fake\0\0` });
  const main = 'C:\\Repos\\widget';
  assert.equal(windowsTasks.mainCheckout(main, { realpath: x => x, run: git(main, `${main}\\.git`, main) }), main);
  assert.equal(windowsTasks.mainCheckout(main, { realpath: x => x, run: git(main, 'C:\\GitData\\widget', main) }), main, 'a primary checkout can have a separate Git directory');
  const alias = 'C:\\Alias\\Toolkit';
  assert.equal(windowsTasks.readLocations({ ...request, toolkitRoot: alias }, { ...deps,
    mainCheckout: value => value === alias ? TOOLKIT_ROOT.toLowerCase() : primary(value),
    realpath: value => value === alias ? TOOLKIT_ROOT.toLowerCase() : value.toLowerCase(),
  }).toolkitRoot, TOOLKIT_ROOT.toLowerCase(), 'canonical aliases remain the same managed copy');
  assert.throws(() => windowsTasks.mainCheckout('C:\\Lanes\\widget', { realpath: x => x, run: git('C:\\Lanes\\widget', `${main}\\.git`, main) }), /main checkout/);
  assert.throws(() => windowsTasks.mainCheckout(main, { realpath: () => { throw new Error('missing'); } }), /missing/);
});

test('identity: origin and merged binding must agree before any scheduler reads', t => {
  const reader = governance({ repository: 'example/widget' });
  reader.readObservation = () => ({ status: 'enabled', fresh: true, binding: fixtureBinding('other/widget') });
  assert.throws(() => windowsTasks.desiredTasks({ checkout: checkout(t), toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: reader } }), /origin identity and merged binding/);
});

test('ownership: Windows name collisions and folder changes cannot bypass enrolment or owner stops', t => {
  const home = tempHome(t), wanted = desired(t), scheduler = fakeScheduler({ TOOLKIT: [unmarked('toolkit - programme sweep')] });
  const before = structuredClone([...scheduler.folders]);
  assert.ok(windowsTasks.applyTasks(wanted, { scheduler, home }).items.every(row => row.action === 'refused'));
  assert.deepEqual([...scheduler.folders], before);
  assert.ok(scheduler.calls.every(call => call[0] === 'list'));
  const owned = fakeScheduler();
  windowsTasks.applyTasks(wanted, { scheduler: owned, home });
  windowsTasks.removeTasks({ scope: wanted, scheduler: owned, home });
  const moved = desired(t, { root: wanted.root, folder: 'NEW' });
  const stop = fs.readFileSync(tasks.registryPath(home)); owned.calls.length = 0;
  for (const repairOwned of [false, true]) assert.ok(windowsTasks.applyTasks(moved, { scheduler: owned, home, repairOwned }).items.every(row => row.action === 'refused'));
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), stop);
  assert.ok(owned.calls.every(call => call[0] === 'list'));
});

test('readers: hostile inputs cannot become paths, arguments or stop metadata', t => {
  const wanted = desired(t);
  const entry = { id: 'x', name: 'X', host: 'windows', folder: 'TOOLKIT', schedule: 'daily', model: null, effort: null, purpose: 'test', repository: 'example/widget', created: '2026-11-05', created_by: 'test' };
  const inputs = hostile.cases(['line-breaks', 'continued-lines', 'invisible', 'indents', 'quoting']);
  hostile.expectDefaultDeny(assert, text => {
    try { windowsTasks.desiredTasks({ checkout: wanted.root, toolkitRoot: TOOLKIT_ROOT, nodePath: text, deps: { identityReader, governance: governance() } }); return true; } catch { return false; }
  }, inputs);
  hostile.expectDefaultDeny(assert, text => tasks.entryProblem({ ...entry, stopped_by_owner: true, stopped_at: text }) === null, inputs);
  hostile.expectDefaultDeny(assert, text => tasks.entryProblem({ ...entry, checkout: text }) === null, inputs);
  for (const bad of [{ stopped_by_owner: false }, { stopped_by_owner: 'true' }, { stopped_by_owner: true }, { stopped_at: '2026-11-05T00:00:00.000Z' }, { stopped_by_owner: true, stopped_at: 'never' }]) assert.notEqual(tasks.entryProblem({ ...entry, ...bad }), null);
  const quoted = windowsTasks.powerShellPath('C:\\Repos\\$(throw 1)`x', 'C:\\Other');
  assert.equal(quoted, '"C:\\Repos\\`$(throw 1)``x"', 'printed PowerShell paths cannot evaluate expressions');
  assert.equal(windowsTasks.powerShellPath('C:\\Users\\someone\\$value', 'C:\\Users\\someone'), '"C:\\Users\\someone\\`$value"');
});

for (const edit of ['execute', 'arguments', 'directory', 'extra action', 'marker', 'principal', 'settings', 'trigger count', 'trigger disabled', 'future start', 'end', 'repetition', 'weekday', 'weekly interval']) {
  test(`definition baseline: requires an owner choice for ${edit} on either job before any mutation`, t => {
    const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
    windowsTasks.applyTasks(wanted, { scheduler, home });
    const live = scheduler.folders.get('TOOLKIT')[1];
    if (edit === 'execute') live.execute = 'C:\\owner.exe';
    if (edit === 'arguments') live.arguments += ' --changed';
    if (edit === 'directory') live.working_directory = 'C:\\Elsewhere';
    if (edit === 'extra action') live.actions = [ { execute: live.execute, arguments: live.arguments, working_directory: live.working_directory }, { execute: 'C:\\extra.exe' } ];
    if (edit === 'marker') live.description += ' edited';
    if (edit === 'principal') live.principal = { user_id: 'owner', run_level: 'Highest' };
    if (edit === 'settings') live.settings = { enabled: false };
    if (edit === 'trigger count') live.triggers.push({ ...live.triggers[0] });
    if (edit === 'trigger disabled') live.triggers[0].enabled = false;
    if (edit === 'future start') live.triggers[0].start = '2099-01-01T09:15:00';
    if (edit === 'end') live.triggers[0].end = '2026-11-06T00:00:00';
    if (edit === 'repetition') live.triggers[0].interval = 'PT5H';
    if (edit === 'weekday') live.triggers[0].days_of_week = 4;
    if (edit === 'weekly interval') live.triggers[0].weeks_interval = 2;
    const before = fs.readFileSync(tasks.registryPath(home));
    const snapshot = structuredClone([...scheduler.folders]); scheduler.calls.length = 0;
    assert.ok(windowsTasks.applyTasks(wanted, { scheduler, home }).items.every(row => ['refused', 'owner-choice-required'].includes(row.action)));
    assert.deepEqual([...scheduler.folders], snapshot);
    assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
    assert.ok(scheduler.calls.every(call => call[0] === 'list'));
  });
}

test('stop: remove, restart CLI, refuse, repeat remove and approved repair retain the right state', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t), wanted = desired(t, { root });
  windowsTasks.applyTasks(wanted, { scheduler, home });
  windowsTasks.removeTasks({ scope: wanted, scheduler, home });
  const stop = fs.readFileSync(tasks.registryPath(home));
  scheduler.calls.length = 0;
  const output = [];
  // Each main call creates a fresh owner and re-reads the durable registry, just as a restart does.
  const deps = { platform: 'win32', home, scheduler, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE,
    checkoutDeps: { identityReader, governance: governance() }, stdout: text => output.push(text), stderr: text => output.push(text) };
  assert.equal(windowsTasks.main(['plan', '--repo-root', root], deps), 1);
  assert.equal(windowsTasks.main(['apply', '--repo-root', root, '--no-first-run'], deps), 1);
  assert.match(output.join(''), /stopped by owner/);
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), stop);
  assert.ok(scheduler.calls.every(call => call[0] === 'list'));
  assert.ok(tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT' }).rows.every(row => row.state === 'stopped by owner'));
  windowsTasks.removeTasks({ scope: wanted, scheduler, home });
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), stop, 'repeated remove preserves time and baseline');
  assert.equal(windowsTasks.main(['apply', '--repo-root', root, '--repair-owned', '--no-first-run'], deps), 0);
  assert.ok(tasks.readRegistry(home).tasks.every(row => !row.stopped_by_owner && row.enrolled));
  assert.throws(() => windowsTasks.parseArgs(['plan', '--repair-owned']), /unknown/);
});

test('stop: a fresh Node process reads the retained stop and performs no scheduler mutation', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t), wanted = desired(t, { root });
  windowsTasks.applyTasks(wanted, { scheduler, home }); windowsTasks.removeTasks({ scope: wanted, scheduler, home });
  const before = fs.readFileSync(tasks.registryPath(home));
  const script = `const w=require(process.argv[1]);
    const identityReader=({checkout,toolkitRoot})=>({checkout,toolkitRoot});
    const binding=${JSON.stringify(fixtureBinding())};
    const governance={readIdentity:root=>({valid:true,root,remote:{host:'github.com',path:'/weijunswj/ai-agent-toolkit.git'}}),governanceState:()=>({state:'ENABLED',merged:{status:'enabled',fresh:true}}),readObservation:()=>({status:'enabled',fresh:true,binding})};
    const scheduler={list:()=>[],markedFolders:()=>[],register:()=>{throw new Error('unexpected mutation')},start:()=>{throw new Error('unexpected start')}};
    process.exitCode=w.main(['apply','--repo-root',process.argv[3],'--no-first-run'],{platform:'win32',home:process.argv[2],scheduler,toolkitRoot:process.argv[4],nodePath:process.argv[5],checkoutDeps:{identityReader,governance}});`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', script, path.join(ROOT, 'repo/scripts/toolkit-windows-tasks.cjs'), home, root, TOOLKIT_ROOT, NODE], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /stopped by owner/);
  assert.doesNotMatch(result.stderr, /unexpected/);
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
});

test('stop: write failure prevents unregister; unregister failure preserves a durable stop', t => {
  for (const failure of ['write', 'readback', 'unregister']) {
    const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
    windowsTasks.applyTasks(wanted, { scheduler, home });
    scheduler.calls.length = 0;
    const registry = { ...tasks };
    if (failure === 'write') registry.updateRegistry = () => { throw new Error('disk denied'); };
    if (failure === 'readback') { let reads = 0; registry.readRegistry = value => ++reads === 1 ? tasks.readRegistry(value) : { status: 'unreadable' }; }
    if (failure === 'unregister') scheduler.unregister = () => { throw new Error('native denial'); };
    const result = windowsTasks.removeTasks({ scope: wanted, scheduler, home, registry });
    assert.ok(result.items.every(row => row.action === 'failed'));
    if (failure !== 'unregister') assert.equal(scheduler.calls.some(call => call[0] === 'unregister'), false);
    assert.equal(scheduler.folders.get('TOOLKIT').length, 2);
    if (failure !== 'write') assert.ok(tasks.readRegistry(home).tasks.every(row => row.stopped_by_owner));
  }
});

test('preflight: missing enrolment baseline or runner move needs explicit same-repository repair', t => {
  for (const field of ['enrolled', 'checkout', 'toolkit_root', 'runner moved', 'task removed']) {
    const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
    windowsTasks.applyTasks(wanted, { scheduler, home });
    if (field === 'task removed') scheduler.folders.set('TOOLKIT', []);
    else tasks.updateRegistry(home, rows => rows.map(row => { const next = { ...row }; if (field === 'runner moved') next.toolkit_root = 'C:\\Old\\toolkit'; else delete next[field]; return next; }));
    const before = fs.readFileSync(tasks.registryPath(home)); scheduler.calls.length = 0;
    assert.ok(windowsTasks.applyTasks(wanted, { scheduler, home }).items.every(row => row.action === 'refused'));
    assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
    assert.ok(scheduler.calls.every(call => call[0] === 'list'));
    assert.ok(windowsTasks.applyTasks(wanted, { scheduler, home, repairOwned: true }).items.every(row => row.done));
  }
});

test('ordering: register/read back both jobs before starting the first sweep; no false completed run', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  scheduler.onStart = task => { assert.equal(tasks.readRegistry(home).tasks.length, 2); task.state = 'Running'; };
  const result = windowsTasks.applyTasks(wanted, { scheduler, home, firstRunOptions: { wait: () => {}, waitMs: 0, pollMs: 1 } });
  const events = scheduler.calls.map(call => call[0]);
  assert.ok(events.lastIndexOf('register') < events.indexOf('start'));
  assert.equal(result.items[0].first_run.status, 'still running');
  assert.match(windowsTasks.describePlan(windowsTasks.planTasks(desired(t), { scheduler: fakeScheduler(), home: tempHome(t) }), { command: 'test' }).join('\n'), /ten minutes[\s\S]*Registration alone does not prove a completed first run/);
});

test('effects: registration failure holds the other job and never starts; bad readback never clears stop', t => {
  for (const failure of ['register', 'readback']) {
    const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
    windowsTasks.applyTasks(wanted, { scheduler, home }); windowsTasks.removeTasks({ scope: wanted, scheduler, home });
    const before = fs.readFileSync(tasks.registryPath(home)); scheduler.calls.length = 0;
    const register = scheduler.register;
    scheduler.register = (d, old) => { if (failure === 'register') throw new Error('native denied'); register(d, old); scheduler.folders.get(d.folder)[0].arguments += ' unexpected'; };
    const result = windowsTasks.applyTasks(wanted, { scheduler, home, repairOwned: true, firstRunOptions: {} });
    assert.ok(result.items.every(row => row.done === false));
    assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
    assert.equal(scheduler.calls.some(call => call[0] === 'start'), false);
  }
});

test('effects: failed registry writes restore only our unchanged replacement and verify restoration', t => {
  for (const concurrent of [false, true]) {
    const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t), wanted = desired(t, { root });
    windowsTasks.applyTasks(wanted, { scheduler, home });
    const old = structuredClone([...scheduler.folders]);
    const before = fs.readFileSync(tasks.registryPath(home));
    scheduler.restore = (d, previous) => { scheduler.calls.push(['restore', d.folder, d.name]); scheduler.folders.set(d.folder, scheduler.folders.get(d.folder).map(row => row.name === d.name ? previous : row)); };
    const registry = { ...tasks, updateRegistry() { if (concurrent) scheduler.folders.get('TOOLKIT').find(row => row.name === wanted.wanted[0].name).arguments += ' owner edit'; throw new Error('registry write denied'); } };
    scheduler.calls.length = 0;
    const result = windowsTasks.applyTasks(desired(t, { root, nodePath: 'C:\\New\\node.exe' }), { scheduler, home, registry, firstRunOptions: {} });
    assert.ok(result.items.every(row => row.done === false));
    assert.ok(result.items[0].backup);
    assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
    assert.equal(scheduler.calls.some(call => call[0] === 'start'), false);
    if (concurrent) { assert.match(result.items[0].restoration, /concurrent task edit; left alone/); assert.match(scheduler.folders.get('TOOLKIT').find(row => row.name === wanted.wanted[0].name).arguments, /owner edit$/); }
    else { assert.match(result.items[0].restoration, /restored and read back/); assert.deepEqual([...scheduler.folders].map(([folder, rows]) => [folder, [...rows].sort((a,b) => a.name.localeCompare(b.name))]), old.map(([folder, rows]) => [folder, [...rows].sort((a,b) => a.name.localeCompare(b.name))])); }
  }
});

test('effects: a concurrent owner stop is retained and a failed new enrolment removes only our task', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  const registry = { ...tasks, updateRegistry() { throw new Error('registry denied'); } };
  const failed = windowsTasks.applyTasks(wanted, { scheduler, home, registry });
  assert.match(failed.items[0].restoration, /new registration removed and read back/);
  assert.equal(scheduler.folders.get('TOOLKIT').length, 0);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  const changed = { ...wanted, wanted: wanted.wanted.map(d => ({ ...d, def: '123456789abc', description: d.description.replace(/def=[0-9a-f]{12}/, 'def=123456789abc') })) };
  const update = tasks.updateRegistry;
  const concurrentRegistry = { ...tasks, updateRegistry(value, callback) {
    update(value, rows => rows.map(row => ({ ...row, stopped_by_owner: true, stopped_at: '2026-11-05T00:00:00.000Z' })));
    return update(value, callback);
  } };
  const result = windowsTasks.applyTasks(changed, { scheduler, home, registry: concurrentRegistry });
  assert.equal(result.items[0].done, false);
  assert.match(result.items[0].error, /registry changed after preflight/);
  assert.ok(tasks.readRegistry(home).tasks.every(row => row.stopped_by_owner));
});

test('effects: first-run interruption is visible after both verified registrations; skipped is not success', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), wanted = desired(t);
  const result = windowsTasks.applyTasks(wanted, { scheduler, home, firstRunOptions: { wait: () => { throw new Error('interrupted'); } } });
  assert.ok(result.items.every(row => row.done));
  assert.equal(result.items[0].first_run.status, 'failed');
  assert.match(result.items[0].first_run.detail, /wait interrupted/);
  scheduler.onStart = live => {
    live.last_run = '2026-11-05T00:00:00.000Z';
    tasks.writeLastRun(wanted.wanted[0].id, { started: live.last_run, exit: 0, status: 'skipped', summary: ['offline'] }, home);
  };
  const first = windowsTasks.firstRun(wanted.wanted[0], { scheduler, home, now: () => new Date('2026-11-05T00:00:00.000Z'), wait: () => {}, waitMs: 0, pollMs: 1 });
  assert.equal(first.status, 'failed');
  assert.match(first.detail, /^skipped:/);
});

test('native adapter: all actions, anchored triggers, principal/settings and compare-before-write guards are retained', () => {
  assert.match(windowsTasks.SCRIPTS.list, /\$actions = @\(\$t.Actions/);
  for (const field of ['EndBoundary', 'WeeksInterval', 'DaysInterval', 'StopAtDurationEnd', 'Export-ScheduledTask', 'RunLevel', 'ExecutionTimeLimit']) assert.ok(windowsTasks.SCRIPTS.list.includes(field));
  assert.match(windowsTasks.SCRIPTS.register, /expected_xml[\s\S]*Task changed after preflight/);
  assert.match(windowsTasks.SCRIPTS.unregister, /expected_xml[\s\S]*Task changed before removal/);
  assert.match(windowsTasks.SCRIPTS.restore, /expected_xml[\s\S]*Task changed before restoration[\s\S]*-Xml \$p.previous_xml/);
});

test('ordering: a stop arriving after registration prevents the first start, including approved repair mode', () => {
  const registry = memoryRegistry(), scheduler = fakeScheduler();
  const wanted = windowsTasks.desiredTasks({ checkout: 'C:\\Repos\\widget', toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: governance() } });
  const update = registry.updateRegistry.bind(registry);
  registry.updateRegistry = (home, change) => {
    const next = update(home, change);
    if (next.length === 2) update(home, rows => rows.map(row => row.job === 'programme-sweep' ? { ...row, stopped_by_owner: true, stopped_at: '2026-11-05T00:00:00.000Z' } : row));
    return next;
  };
  const result = windowsTasks.applyTasks(wanted, { scheduler, registry, home: MEMORY_HOME, repairOwned: true, firstRunOptions: { wait: () => {} } });
  assert.equal(result.items[0].first_run.status, 'failed');
  assert.match(result.items[0].first_run.detail, /no first start/);
  assert.equal(scheduler.calls.some(call => call[0] === 'start'), false);
  assert.ok(registry.readRegistry().tasks.find(row => row.job === 'programme-sweep').stopped_by_owner);
});

test('G: setup only plans and reports the tasks, and --remove-toolkit-tasks removes only Toolkit\'s own', async (t) => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const home = tempHome(t);
  const root = checkout(t);
  const scheduler = fakeScheduler();
  const lines = [];
  const plan = core.printWindowsTasks({ repoRoot: root }, { platform: 'win32', scheduler, checkoutDeps: { identityReader, reportCheckout: root => root, governance: governance() }, workingFolder: root, home, log: line => lines.push(line) });
  assert.deepEqual(plan[0].items.map(item => item.action), ['create', 'create']);
  const text = lines.join('\n');
  assert.match(text, /## Windows scheduled tasks\nWindows scheduled tasks for weijunswj\/ai-agent-toolkit in \\TOOLKIT\\:/);
  assert.match(text, /Approval: standing approval with verified ownership/);
  assert.equal(text.includes(root), false, 'setup never prints checkout paths');
  assert.deepEqual(scheduler.calls.map(call => call[0]), ['list'], 'setup never registers, starts or removes a task');
  assert.deepEqual(tasks.readRegistry(home).tasks, [], 'setup records nothing');
  assert.equal(core.printWindowsTasks({ repoRoot: root }, { platform: 'linux', scheduler, log: line => lines.push(line) }), null);
  // The remove flag runs on its own and goes to remove, never apply.
  windowsTasks.applyTasks(desired(t, { root }), { scheduler, home });
  scheduler.folders.get('TOOLKIT').push(unmarked('Mine'));
  scheduler.calls.length = 0;
  const out = [];
  const code = await core.main(['--remove-toolkit-tasks'], { platform: 'win32', windowsTasksDeps: { platform: 'win32', scheduler, home, cwd: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, checkoutDeps: { identityReader, governance: governance() }, stdout: text => out.push(text) } });
  assert.equal(code, 0);
  assert.deepEqual(scheduler.folders.get('TOOLKIT').map(task => task.name), ['Mine']);
  assert.equal(scheduler.calls.some(call => call[0] === 'register' || call[0] === 'start'), false);
  assert.match(out.join(''), /TOOLKIT - PROGRAMME SWEEP in \\TOOLKIT\\: removed/);
  await assert.rejects(core.main(['--remove-toolkit-tasks', '--execute'], { platform: 'win32', windowsTasksDeps: { platform: 'win32', scheduler, home } }), /runs on its own/);
});

test('G: adopt records a task the owner made and refuses one carrying Toolkit\'s marker', (t) => {
  const home = tempHome(t);
  const digest = unmarked('Session Digest', { triggers: [{ kind: 'MSFT_TaskDailyTrigger', start: '2026-10-29T08:00:00+08:00', interval: '', duration: '' }] });
  const scheduler = fakeScheduler({ TOOLKIT: [digest] });
  const entry = windowsTasks.adoptTask({ folder: 'TOOLKIT', task: 'Session Digest', id: 'session-digest', purpose: 'Daily redacted session digest. No AI.' }, { scheduler, home });
  assert.equal(entry.schedule, 'daily at 08:00');
  assert.equal(entry.adopted, true);
  assert.deepEqual(scheduler.folders.get('TOOLKIT'), [digest], 'adopting never changes the task');
  assert.throws(() => windowsTasks.adoptTask({ folder: 'TOOLKIT', task: 'Missing', id: 'missing', purpose: 'x' }, { scheduler, home }), /no task "Missing"/);
  const marked = fakeScheduler({ TOOLKIT: [{ ...digest, description: 'x [toolkit-task v1 id=toolkit-programme-sweep def=0123456789ab]' }] });
  assert.throws(() => windowsTasks.adoptTask({ folder: 'TOOLKIT', task: 'Session Digest', id: 'session-digest', purpose: 'x' }, { scheduler: marked, home }), /Toolkit's own/);
});

// ---- J. job runs ------------------------------------------------------------------------------

const REPO_ROOT = path.join(os.tmpdir(), 'tk-job-checkout');

const GOVERNED = { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true } }) };
const BINDING = () => fixtureBinding();
const READ_IDENTITY = root => ({ valid: true, root, remote: { host: 'github.com', path: '/weijunswj/ai-agent-toolkit.git' } });
const OBSERVATION = () => ({ status: 'enabled', fresh: true, binding: BINDING() });

const options = { job: 'programme-sweep', repoRoot: REPO_ROOT, taskId: 'toolkit-programme-sweep' };

function runSweep(t, answers, home = tempHome(t), clock = '2026-10-29T09:00:00.000Z') {
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob({ ...options, repoRoot: checkout(t) }, { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY, readObservation: OBSERVATION, now: () => new Date(clock) });
  return { record, log: fake.log, home };
}

test('A1a: first sweep without parent state skips with setup guidance and still cleans footers', t => {
  const result = runSweep(t, { 'programme refresh': { status: 2, stderr: 'PARENT_STATE_MISSING: No parent state document yet.' } });
  assert.equal(result.record.status, 'skipped');
  assert.match(result.record.reason, /controller.*initialise.*parent state.*private evidence store/);
  assert.doesNotMatch(result.record.summary.join(' '), /PARENT_STATE_MISSING/);
  const scheduler = fakeScheduler(), wanted = desired(t);
  windowsTasks.applyTasks(wanted, { scheduler, home: result.home });
  assert.ok(tasks.sweepLine(wanted.repository, { home: result.home }).includes(result.record.reason));
  const printed = tasks.formatList(tasks.listTasks({ home: result.home, platform: 'win32', scheduler, folderFor: () => wanted.folder }));
  assert.equal(printed.split(result.record.reason).length - 1, 1, 'setup reason appears once in toolkit tasks');
  assert.ok(result.log.some(args => path.basename(args[1] || '') === 'toolkit-github-footer-sweep.cjs'));
  assert.equal(result.log.some(args => args[2] === 'attention'), false);
  assert.equal(runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify({ holds: [{ code: 'PARENT_STATE_MISSING' }] }) } }).record.status, 'skipped');
  const mixed = runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify({ holds: [{ code: 'PARENT_STATE_MISSING' }, { code: 'STORE_UNREACHABLE' }] }) } });
  assert.equal(mixed.record.status, 'held', 'unrelated holds remain visible');
});

test('A1a: programme job lock serialises processes and logs stale takeover after the task limit', async t => {
  const { ProgrammeJobLock, STALE_MS } = require('../scripts/toolkit-programme-lock.cjs');
  const { takeLock } = require('../../skills/github-program-reconciler/scripts/programme-lock.cjs');
  const home = tempHome(t), events = path.join(home, 'events');
  // File mtimes keep the real clock in clock-ahead runs. Use that same clock for every
  // acquisition and the stale fixture, including acquisitions in the child processes.
  const nowMs = Math.round(performance.timeOrigin + performance.now());
  const acquire = (file, deps) => takeLock(file, { ...deps, nowMs });
  assert.ok(STALE_MS >= 30 * 60 * 1000);
  const script = `const fs=require('node:fs'); const {ProgrammeJobLock}=require(${JSON.stringify(require.resolve('../scripts/toolkit-programme-lock.cjs'))});
    const {takeLock}=require(${JSON.stringify(require.resolve('../../skills/github-program-reconciler/scripts/programme-lock.cjs'))});
    const acquire=(file,deps)=>takeLock(file,{...deps,nowMs:Number(process.argv[4])});
    const lock=new ProgrammeJobLock({home:process.argv[1],key:'example/store',acquire}).take();
    if(!lock) process.exit(2); fs.appendFileSync(process.argv[2],process.argv[3]+' start\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
    fs.appendFileSync(process.argv[2],process.argv[3]+' end\\n');lock.release();`;
  const { spawn } = require('node:child_process');
  const launch = id => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, home, events, id, String(nowMs)], { windowsHide: true, stdio: 'pipe', timeout: 15000 });
    child.stdout.resume(); child.stderr.resume();
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`lock child exit ${code}`)));
  });
  await Promise.all([launch('one'), launch('two')]);
  const lines = fs.readFileSync(events, 'utf8').trim().split('\n');
  assert.ok(lines.join(',') === 'one start,one end,two start,two end' || lines.join(',') === 'two start,two end,one start,one end');
  const log = [], owner = new ProgrammeJobLock({ home, key: 'example/store', acquire, log: line => log.push(line) });
  fs.writeFileSync(owner.file, JSON.stringify({ schema: 'toolkit.programme-pass-lock.v1', token: 'old-owner', host: 'other-computer', pid: 1, at: new Date(nowMs - STALE_MS - 1000).toISOString() }));
  const old = new Date(nowMs - STALE_MS - 1000); fs.utimesSync(owner.file, old, old);
  const held = owner.take(); assert.ok(held); assert.match(log.join(' '), /took over a stale job lock/); held.release();
  const live = owner.take(); assert.ok(live);
  const contender = new ProgrammeJobLock({ home, key: 'example/store', waitMs: 0, acquire });
  assert.equal(contender.take(), null); live.release();
});

test('J: ENABLED, gh signed in, a clean refresh and two footers: all three steps, footers cleaned, last-run ok', (t) => {
  const sweep = { status: 4, stdout: JSON.stringify({ apply: true, results: [{ status: 'CLEANED' }, { status: 'CLEANED' }] }) };
  const { record, log, home } = runSweep(t, { 'programme refresh': { status: 0, stdout: '{"outcome":"DONE","holds":[]}' }, 'toolkit-github-footer-sweep.cjs': sweep });
  assert.equal(record.status, 'ok');
  assert.equal(record.exit, 0);
  assert.deepEqual(record.summary, ['Footer sweep since 2026-10-27 09:00: 2 CLEANED.', 'Programme refresh: done.', 'Attention: clear (stored on #421, written 3 min ago)']);
  assert.equal(record.footer_sweep_since, '2026-10-29T09:00:00.000Z');
  const sweepArgs = log.find(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs');
  assert.deepEqual(sweepArgs.slice(2), ['--repo', 'weijunswj/ai-agent-toolkit', '--repo', 'weijunswj/TRANSPORT-ai-agent-toolkit', '--since', '2026-10-27T09:00:00.000Z', '--apply', '--json']);
  assert.equal(sweepArgs.includes('--any-author'), false);
  const saved = tasks.readLastRun('toolkit-programme-sweep', home);
  assert.deepEqual({ ...saved }, { ...record });
  if (process.platform !== 'win32') assert.equal(fs.statSync(tasks.lastRunPath('toolkit-programme-sweep', home)).mode & 0o777, 0o600);
});

test('J: a refresh that holds is recorded and the footer sweep still runs', (t) => {
  const { record, log } = runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify({ holds: [{ code: 'STORE_UNREACHABLE', target: 'store', detail: 'x' }] }) } });
  assert.equal(record.status, 'held');
  assert.match(record.summary[1], /Programme refresh held: STORE_UNREACHABLE store/);
  assert.ok(log.some(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs'));
});

test('J: the existing sweep reports parent lifecycle results without a second repair owner', t => {
  const report = { results: [{ kind: 'set_parent_state', target: { issue: 421, state: 'open' }, outcome: 'DONE' }, { kind: 'post_parent_repair', target: { issue: 421 }, outcome: 'UNKNOWN' }], holds: [{ code: 'EFFECT_UNKNOWN', target: '#421' }] };
  const { record, log } = runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify(report) } });
  assert.ok(record.summary.includes('Parent lifecycle: reopen DONE.'));
  assert.ok(record.summary.includes('Parent lifecycle: repair notice UNKNOWN.'));
  assert.equal(record.status, 'held');
  assert.equal(log.filter(args => args.some(arg => arg === 'refresh')).length, 1);
});

test('J: sign-out skips all edits; a stale binding permits origin cleaning only', (t) => {
  const out = runSweep(t, { 'gh auth': { status: 1 } });
  assert.equal(out.record.status, 'skipped');
  assert.deepEqual(out.record.summary, ['skipped: gh not signed in']);
  assert.deepEqual(out.log.map(entry => entry.slice(0, 2)), [[GH, 'auth'], [NODE, '-e']], 'gh auth status, then only the github.com connection check');
  const stale = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: false } }) } });
  assert.equal(stale.record.programme_reason, 'binding observation expired');
  assert.equal(stale.record.footer_status, 'held');
  assert.ok(stale.log.some(entry => entry[1] === job.SCRIPT.footerSweep));
  assert.equal(stale.log.some(entry => entry[1] === job.SCRIPT.programme), false);

});

test('J: offline is told apart from signed out, skips count up in a row, and the next good run notes the resume', (t) => {
  const home = tempHome(t);
  const OFFLINE = { 'gh auth': { status: 1 }, 'reach github': { status: 3 } };
  const first = runSweep(t, OFFLINE, home, '2026-11-01T04:00:05.000Z');
  assert.deepEqual([first.record.status, first.record.exit, first.record.reason, first.record.skipped_streak, first.record.skipped_since], ['skipped', 0, 'offline', 1, '2026-11-01T04:00:05.000Z']);
  assert.deepEqual(first.record.summary, ['skipped: offline']);
  const probe = first.log.find(entry => entry[1] === '-e');
  assert.match(probe[2], /connect\(\{host:'github\.com',port:443,timeout:8000\}\)/, 'one connection to github.com, nothing sent');
  const second = runSweep(t, OFFLINE, home, '2026-11-01T05:00:05.000Z');
  assert.deepEqual([second.record.skipped_streak, second.record.skipped_since], [2, '2026-11-01T04:00:05.000Z']);
  const signedOut = runSweep(t, { 'gh auth': { status: 1 } }, home, '2026-11-01T06:00:05.000Z');
  assert.deepEqual([signedOut.record.reason, signedOut.record.skipped_streak, signedOut.record.summary], ['gh not signed in', 3, ['skipped: gh not signed in']]);
  // A failed run is no resume: the count stays for the next good run to report.
  const failed = runSweep(t, { 'programme refresh': { status: 2, stderr: 'boom' } }, home, '2026-11-01T07:00:05.000Z');
  assert.deepEqual([failed.record.status, failed.record.skipped_streak, failed.record.skipped_since], ['failed', 3, '2026-11-01T04:00:05.000Z']);
  assert.equal(failed.record.summary.some(line => /Resumed/.test(line)), false);
  const good = runSweep(t, {}, home, '2026-11-01T08:00:05.000Z');
  assert.equal(good.record.status, 'ok');
  assert.equal(good.record.summary.at(-1), 'Resumed after 3 skipped runs since 2026-11-01 04:00 UTC.');
  assert.equal('skipped_streak' in good.record || 'skipped_since' in good.record || 'reason' in good.record, false, 'cleared');
  const next = runSweep(t, {}, home, '2026-11-01T09:00:05.000Z');
  assert.equal(next.record.summary.some(line => /Resumed/.test(line)), false, 'said once');
  // A held run also ends the streak; one skip reads in the singular.
  runSweep(t, OFFLINE, home, '2026-11-01T10:00:05.000Z');
  const held = runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify({ holds: [{ code: 'STORE_UNREACHABLE', target: 'store' }] }) } }, home, '2026-11-01T11:00:05.000Z');
  assert.deepEqual([held.record.status, held.record.summary.at(-1), held.record.skipped_streak], ['held', 'Resumed after 1 skipped run since 2026-11-01 10:00 UTC.', undefined]);
});

test('J: a run stopped mid-way keeps the streak in its start record', (t) => {
  const home = tempHome(t);
  runSweep(t, { 'gh auth': { status: 1 }, 'reach github': { status: 3 } }, home, '2026-11-01T04:00:05.000Z');
  const seen = [];
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'toolkit-github-footer-sweep.cjs': () => { seen.push(tasks.readLastRun('toolkit-programme-sweep', home)); return { status: 0, stdout: '{"results":[]}' }; }, 'programme attention': ATTENTION });
  job.runJob({ ...options, repoRoot: checkout(t) }, { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY, readObservation: OBSERVATION, now: () => new Date('2026-11-01T05:00:05.000Z') });
  assert.deepEqual([seen[0].status, seen[0].skipped_streak, seen[0].skipped_since], ['running', 1, '2026-11-01T04:00:05.000Z']);
});

test('J: a footer sweep MISMATCH fails the run with its code, and the next run retries from the same time', (t) => {
  const home = tempHome(t);
  const first = runSweep(t, { 'toolkit-github-footer-sweep.cjs': { status: 1, stdout: JSON.stringify({ results: [{ status: 'MISMATCH' }] }) } }, home, '2026-10-29T09:00:00.000Z');
  assert.equal(first.record.status, 'failed');
  assert.equal(first.record.exit, 1);
  assert.match(first.record.summary[0], /Footer sweep failed \(exit 1\): 1 MISMATCH; the next run tries again from the same time/);
  assert.equal(first.record.footer_sweep_since, '2026-10-27T09:00:00.000Z');
  const second = runSweep(t, {}, home, '2026-10-29T10:00:00.000Z');
  const sweepArgs = second.log.find(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs');
  assert.equal(sweepArgs[sweepArgs.indexOf('--since') + 1], '2026-10-27T09:00:00.000Z');
  assert.equal(second.record.footer_sweep_since, '2026-10-29T10:00:00.000Z');
});

test('J: Toolkit shard timing still uses its fixed refresher with --open-pr and fresh governance', (t) => {
  const root = checkout(t);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'refresh-shard-timings.cjs': { status: 0, stdout: 'No refresh trigger crossed; nothing opened.\n' } });
  const record = job.runJob({ job: 'shard-timings', repoRoot: root, taskId: 'toolkit-shard-timings' }, { home: tempHome(t), run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, now: () => new Date('2026-10-26T01:15:00Z') });
  assert.equal(record.status, 'ok');
  assert.equal(job.SCRIPT.shardTimings, path.join(ROOT, 'repo', 'scripts', 'refresh-shard-timings.cjs'));
  assert.deepEqual(fake.log, [[NODE, job.SCRIPT.governance, 'status', '--json'], [GH, 'auth', 'status'], [NODE, job.SCRIPT.shardTimings, '--repo-root', root, '--open-pr']]);
});

function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), fs.readFileSync(file).toString('base64')];
    }));
}

test('J: a governed repository registers without shards, no-ops, then times newly added shards', (t) => {
  const root = checkout(t, { shards: false });
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  fs.writeFileSync(path.join(root, 'README.md'), 'A repository without shards.\n');
  const registered = windowsTasks.applyTasks(desired(t, { root, repository: 'example/widget', folder: 'WIDGET' }), { scheduler, home });
  assert.deepEqual(registered.items.map(item => [item.definition.job, item.done]), [['programme-sweep', true], ['shard-timings', true]]);
  const before = snapshot(root);
  const beforeHome = snapshot(home);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED });
  const args = { job: 'shard-timings', repoRoot: root, taskId: 'widget-shard-timings' };
  const deps = { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, now: () => new Date('2026-10-26T01:15:00Z') };
  const bare = job.runJob(args, deps);
  assert.deepEqual([bare.status, bare.exit, bare.summary], ['skipped', 0, ['skipped: no shards yet']]);
  assert.deepEqual(fake.log, [], 'no GitHub calls, refresher starts or repository effects without shards; local identity reader only');
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(tasks.readLastRun(args.taskId, home), bare);
  assert.deepEqual(Object.keys(snapshot(home)).filter(file => !(file in beforeHome)), [path.relative(home, tasks.lastRunPath(args.taskId, home))]);
  for (const [file, bytes] of Object.entries(beforeHome)) assert.equal(snapshot(home)[file], bytes);

  addShards(root);
  const withShards = snapshot(root);
  assert.equal(fs.existsSync(path.join(root, 'repo', 'scripts', 'refresh-shard-timings.cjs')), false);
  const next = job.runJob(args, { ...deps, now: () => new Date('2026-11-02T01:15:00Z') });
  assert.equal(next.status, 'ok');
  assert.deepEqual(fake.log, [[NODE, job.SCRIPT.governance, 'status', '--json'], [GH, 'auth', 'status'], [NODE, job.SCRIPT.shardTimings, '--repo-root', root, '--open-pr']]);
  assert.deepEqual(snapshot(root), withShards, 'fake child does not modify the target');
  assert.equal(bare.skipped_streak, undefined);
  assert.doesNotMatch(next.summary.join('\n'), /Resumed after/);
});

test('L1: only existing repository roots may quietly skip, with local Git reads and no GitHub/refresher calls', t => {
  for (const kind of ['valid', 'missing', 'ordinary folder']) {
    const root = checkout(t, { shards: false });
    const home = tempHome(t);
    const args = { job: 'shard-timings', repoRoot: kind === 'missing' ? path.join(root, 'gone') : root, taskId: 'fixture-shards' };
    const before = snapshot(root);
    const gitCalls = [];
    const fake = fakeRun();
    const record = job.runJob(args, { home, run: fake.run, repositoryReader: value => job.localRepository(value, {
      run: (file, argv) => { gitCalls.push([file, ...argv]); return { status: kind === 'valid' ? 0 : 128, stdout: root }; },
    }) });
    assert.equal(record.status, kind === 'valid' ? 'skipped' : 'failed');
    if (kind === 'valid') assert.equal(record.reason, 'no shards yet');
    else assert.doesNotMatch(record.summary.join('\n'), /no shards yet/);
    assert.deepEqual(gitCalls, kind === 'missing' ? [] : [['git', '-C', root, 'rev-parse', '--show-toplevel']]);
    assert.deepEqual(fake.log, [], 'no GitHub calls or refresher starts');
    assert.deepEqual(snapshot(root), before, 'no repository writes');
  }
});

test('J: invalid or unreadable shard configuration fails visibly before any process', (t) => {
  for (const contents of ['{broken', '{}', 'directory', 'EACCES']) {
    const root = checkout(t, { shards: contents !== 'directory' });
    const manifest = path.join(root, ...shards.MANIFEST_REL.split('/'));
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    if (contents === 'directory') fs.mkdirSync(manifest);
    else if (contents !== 'EACCES') fs.writeFileSync(manifest, contents);
    const read = fs.readFileSync;
    const mock = contents === 'EACCES' ? t.mock.method(fs, 'readFileSync', (file, ...args) => {
      if (file === manifest) throw Object.assign(new Error('Access is denied'), { code: 'EACCES' });
      return read(file, ...args);
    }) : null;
    const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED });
    const record = job.runJob({ job: 'shard-timings', repoRoot: root, taskId: 'x-shard-timings' }, { home: tempHome(t), run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE });
    if (mock) mock.mock.restore();
    assert.deepEqual([record.status, record.exit], ['failed', 1], contents);
    assert.match(record.summary.join('\n'), /The job stopped:/);
    assert.doesNotMatch(record.summary.join('\n'), /no shards yet/);
    assert.deepEqual(fake.log, []);
  }
});

test('J: shards still require fresh enabled governance and sign-in; child failure is visible', (t) => {
  const rows = [
    ...['DISABLED', 'UNDECIDED', 'ERROR'].map(state => ({ answers: { 'toolkit-governance.cjs': { status: state === 'ERROR' ? 2 : 0, stdout: JSON.stringify({ state, ...(state === 'ERROR' ? { rule: 'M0' } : {}), merged: { status: state === 'ERROR' ? 'invalid' : state === 'DISABLED' ? 'disabled' : 'none', fresh: true } }) } }, reason: state === 'ERROR' ? 'binding is invalid' : state === 'UNDECIDED' ? 'binding is missing' : `governance is ${state}` })),
    { answers: { 'toolkit-governance.cjs': { status: 0, stdout: '{broken' } }, reason: 'governance status could not be read' },
    { answers: { 'toolkit-governance.cjs': { status: 0, stdout: '{"state":"ENABLED","merged":{"status":"enabled","fresh":false}}' } }, reason: 'binding observation expired' },
    { answers: { 'gh auth': { status: 1 } }, reason: 'gh not signed in' },
    { answers: { 'gh auth': { status: 1 }, 'reach github': { status: 3 } }, reason: 'offline' },
    { answers: { 'refresh-shard-timings.cjs': { status: 2, stderr: 'invalid manifest' } }, failed: true },
  ];
  for (const row of rows) {
    const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, ...row.answers });
    const record = job.runJob({ job: 'shard-timings', repoRoot: checkout(t), taskId: 'x-shard-timings' }, { home: tempHome(t), run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE });
    assert.equal(record.status, row.failed ? 'failed' : 'skipped');
    assert.equal(record.exit, row.failed ? 1 : 0);
    if (row.reason) assert.deepEqual(record.summary, [`skipped: ${row.reason}`]);
    else assert.match(record.summary.join('\n'), /invalid manifest/);
    assert.equal(fake.log.some(entry => entry[1] === job.SCRIPT.shardTimings), !!row.failed);
  }
});

test('J: every job starts only node and gh, and the runner names no model command line', (t) => {
  const { log } = runSweep(t, {});
  assert.ok(log.length >= 5);
  for (const entry of log) assert.ok(entry[0] === NODE || entry[0] === GH, entry[0]);
  const scripts = log.filter(entry => entry[0] === NODE).map(entry => entry[1]);
  assert.deepEqual([...new Set(scripts)].sort(), [job.SCRIPT.programme, job.SCRIPT.governance, job.SCRIPT.footerSweep].sort());
  const source = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-scheduled-job.cjs'), 'utf8');
  for (const word of ['cla' + 'ude', 'cod' + 'ex', 'anthr' + 'opic', 'open' + 'ai', 'gem' + 'ini', 'oll' + 'ama']) assert.doesNotMatch(source, new RegExp(word, 'i'), word);
  for (const call of ['shell: true', 'execSync', 'execFile']) assert.equal(source.includes(call), false, call);
});

test('J: summaries never keep anything shaped like a secret', (t) => {
  const token = `ghp_${'a'.repeat(36)}`;
  const { record } = runSweep(t, { 'programme refresh': { status: 2, stderr: `boom ${token}` } });
  assert.equal(JSON.stringify(record).includes(token), false);
  assert.match(record.summary[1], /removed: looked like a secret/);
});

test('J: the runner takes only a known job, an absolute checkout and a task id', () => {
  for (const argv of [[], ['other'], ['programme-sweep'], ['programme-sweep', '--repo-root', 'relative', '--task-id', 'x'], ['programme-sweep', '--repo-root', REPO_ROOT, '--task-id', 'Bad Id']]) {
    assert.equal(job.main(argv, { stderr: () => {}, stdout: () => {} }), 2, JSON.stringify(argv));
  }
});

// ---- L. listing -------------------------------------------------------------------------------

function listedHome(t) {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const wanted = desired(t);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  return { home, scheduler };
}

test('L: a live Toolkit task shows its live schedule, last run and result', (t) => {
  const { home, scheduler } = listedHome(t);
  const live = scheduler.folders.get('TOOLKIT').find(task => task.name === 'TOOLKIT - PROGRAMME SWEEP');
  Object.assign(live, { last_run: '2026-10-29T01:00:05.000Z', last_result: 0 });
  tasks.writeLastRun('toolkit-programme-sweep', { started: '2026-10-29T01:00:05.000Z', finished: '2026-10-29T01:03:00.000Z', exit: 0, status: 'ok', summary: ['Programme refresh: done.', 'Attention: clear'] }, home);
  const result = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null });
  const row = result.rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP');
  assert.deepEqual([row.state, row.source, row.schedule, row.ai, row.result, row.last_result, row.last_run], ['Toolkit', tasks.LIVE, 'hourly, 00:01 to 00:00', 'no AI', 'ok', 'ok', '2026-10-29T01:03:00.000Z']);
  assert.match(tasks.formatList(result), /TOOLKIT - PROGRAMME SWEEP: Toolkit\. Windows Task Scheduler \\TOOLKIT\\; hourly, 00:01 to 00:00; no AI; last run 2026-10-29 01:03 ok/);
});

test('L: a run that stopped before writing its record is not shown as the previous good run', (t) => {
  const { home, scheduler } = listedHome(t);
  const live = scheduler.folders.get('TOOLKIT').find(task => task.name === 'TOOLKIT - PROGRAMME SWEEP');
  tasks.writeLastRun('toolkit-programme-sweep', { started: '2026-10-29T01:00:05.000Z', finished: '2026-10-29T01:03:00.000Z', exit: 0, status: 'ok', summary: ['Programme refresh: done.'] }, home);
  Object.assign(live, { last_run: '2026-10-29T02:00:04.000Z', last_result: 0 });
  const row = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null }).rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP');
  assert.deepEqual([row.last_run, row.result, row.summary], ['2026-10-29T02:00:04.000Z', 'no result recorded (the run stopped before writing one)', undefined]);
  // Within 2 seconds of the Windows start time, the record is that run's.
  Object.assign(live, { last_run: '2026-10-29T01:00:06.500Z' });
  const same = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null }).rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP');
  assert.equal(same.result, 'ok');
  // Seen on WJ_Lappy: a run started at 11:58 was still going when the 12:00 trigger fired. IgnoreNew
  // dropped that start but Windows still showed 12:00 as the last run; the record that ended at 12:07
  // is that run's.
  tasks.writeLastRun('toolkit-programme-sweep', { started: '2026-10-29T03:58:10.000Z', finished: '2026-10-29T04:07:30.000Z', exit: 0, status: 'ok', summary: ['Programme refresh: done.'] }, home);
  Object.assign(live, { last_run: '2026-10-29T04:00:00.000Z' });
  const overlapped = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null }).rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP');
  assert.deepEqual([overlapped.result, overlapped.last_run], ['ok', '2026-10-29T04:07:30.000Z']);
  // A run that died after writing its start record shows that it is unfinished, not the older result.
  tasks.writeLastRun('toolkit-programme-sweep', { started: '2026-10-29T05:00:01.000Z', finished: null, exit: null, status: 'running', summary: [] }, home);
  Object.assign(live, { last_run: '2026-10-29T05:00:00.000Z' });
  assert.equal(tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null }).rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP').result, 'running');
});

test('L: skipped runs show their reason and count in toolkit tasks', (t) => {
  const { home, scheduler } = listedHome(t);
  const live = scheduler.folders.get('TOOLKIT').find(task => task.name === 'TOOLKIT - PROGRAMME SWEEP');
  Object.assign(live, { last_run: '2026-11-01T06:00:04.000Z', last_result: 0 });
  tasks.writeLastRun('toolkit-programme-sweep', { started: '2026-11-01T06:00:05.000Z', finished: '2026-11-01T06:00:20.000Z', exit: 0, status: 'skipped', reason: 'offline',
    skipped_streak: 3, skipped_since: '2026-11-01T04:00:05.000Z', summary: ['skipped: offline'] }, home);
  const result = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null });
  const row = result.rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP');
  assert.deepEqual([row.result, row.skipped_streak, row.skipped_since], ['skipped (offline), 3 runs in a row since 2026-11-01 04:00Z', 3, '2026-11-01T04:00:05.000Z']);
  assert.match(tasks.formatList(result), /last run 2026-11-01 06:00 skipped \(offline\), 3 runs in a row since 2026-11-01 04:00Z\./);
});

test('L: no-shards skips are quiet and historical unknown reasons use generic display', (t) => {
  const { home, scheduler } = listedHome(t);
  for (const reason of ['no shards yet', 'this checkout has no CI shards to time']) {
    tasks.writeLastRun('toolkit-shard-timings', { started: '2026-11-01T06:00:05.000Z', finished: '2026-11-01T06:00:20.000Z', exit: 0, status: 'skipped', reason,
      skipped_streak: 1, skipped_since: '2026-11-01T06:00:05.000Z', summary: [`skipped: ${reason}`] }, home);
    const row = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null }).rows.find(item => item.name === 'TOOLKIT - SHARD TIMINGS');
    assert.equal(row.result, reason === 'no shards yet' ? 'skipped (no shards yet)' : 'skipped, 1 run in a row since 2026-11-01 06:00Z');
    if (reason === 'no shards yet') assert.equal(row.skipped_streak, undefined);
  }
});

test('L: the session sweep line names a skip, a failure or a gap of over 2 hours, in fixed words only', (t) => {
  const { home } = listedHome(t);
  const repository = 'weijunswj/ai-agent-toolkit';
  const noon = new Date(2026, 10, 1, 12, 0, 0); // local time, inside the 08:00 to 23:59 hours
  const ago = minutes => new Date(noon.getTime() - minutes * 60000).toISOString();
  const hhmm = iso => `${iso.slice(11, 16)}Z`;
  const write = record => tasks.writeLastRun('toolkit-programme-sweep', { exit: 0, summary: [], ...record }, home);
  const line = (now = noon) => tasks.sweepLine(repository, { home, now });
  write({ started: ago(5), finished: ago(4), status: 'ok' });
  assert.equal(line(), null, 'a good recent run says nothing');
  write({ started: ago(60), finished: ago(59), status: 'skipped', reason: 'offline', skipped_streak: 3, skipped_since: ago(180) });
  const skipped = line();
  assert.ok(skipped === `Programme sweep: skipped (offline), 3 runs in a row since ${hhmm(ago(180))}; see toolkit tasks.`
    || skipped === `Programme sweep: skipped (offline), 3 runs in a row since ${ago(180).slice(0, 10)} ${hhmm(ago(180))}; see toolkit tasks.`, skipped);
  assert.equal(tasks.sweepLine('WEIJUNSWJ/AI-AGENT-TOOLKIT', { home, now: noon }), skipped, 'the repository matches without case');
  assert.equal(tasks.sweepLine('someone/else', { home, now: noon }), null);
  write({ started: ago(60), finished: ago(59), status: 'skipped', reason: 'gh auth status said ghp_x at C:\\Users', skipped_streak: 1, skipped_since: ago(60) });
  assert.match(line(), /^Programme sweep: skipped, 1 run in a row since /, 'a reason the job never writes is not shown');
  write({ started: ago(30), finished: ago(29), status: 'failed' });
  assert.match(line(), /^Programme sweep: last run failed at \d\d:\d\dZ; see toolkit tasks\.$/);
  write({ started: ago(200), finished: ago(199), status: 'skipped', reason: 'offline', skipped_streak: 2, skipped_since: ago(260) });
  assert.match(line(), /^Programme sweep: no run since (\d{4}-\d\d-\d\d )?\d\d:\d\dZ \(over 2 hours\); the last one skipped \(offline\), 2 runs in a row since .*; see toolkit tasks\.$/);
  write({ started: ago(200), finished: ago(199), status: 'ok' });
  assert.match(line(), /^Programme sweep: no run since .* \(over 2 hours\); see toolkit tasks\.$/);
  // Outside its hours, or in its first 2 hours, a gap is expected.
  assert.equal(line(new Date(2026, 10, 1, 3, 0, 0)), null);
  assert.equal(line(new Date(2026, 10, 1, 9, 30, 0)), null);
  // No task recorded for the repository on this computer: no line.
  assert.equal(tasks.sweepLine(repository, { home: tempHome(t), now: noon }), null);
});

test('L: held sweep records are visible in fixed words, including overdue and malformed controls', t => {
  const { home } = listedHome(t);
  const now = new Date(2026, 10, 1, 12);
  const at = minutes => new Date(now.getTime() - minutes * 60000).toISOString();
  const line = () => tasks.sweepLine('weijunswj/ai-agent-toolkit', { home, now });
  for (const [status, minutes, pattern] of [
    ['held', 5, /^Programme sweep: held at \d\d:\d\dZ; see toolkit tasks\.$/],
    ['held', 200, /^Programme sweep: no run since .*\(over 2 hours\); the last one held at \d\d:\d\dZ; see toolkit tasks\.$/],
    ['failed', 5, /^Programme sweep: last run failed at /],
    ['skipped', 5, /^Programme sweep: skipped/],
    ['ok', 5, null],
  ]) {
    tasks.writeLastRun('toolkit-programme-sweep', { started: at(minutes + 1), finished: at(minutes), status, summary: ['Private output must not reach the line'], reason: 'Private reason' }, home);
    if (pattern) assert.match(line(), pattern, status); else assert.equal(line(), null);
    assert.doesNotMatch(line() || '', /Private/);
  }
  for (const text of ['{broken', 'null', '{}', '{"status":"held","finished":"bad"}']) {
    fs.writeFileSync(tasks.lastRunPath('toolkit-programme-sweep', home), text);
    assert.match(line(), /^Programme sweep: no run recorded \(over 2 hours\); see toolkit tasks\.$/);
  }
  fs.unlinkSync(tasks.lastRunPath('toolkit-programme-sweep', home));
  assert.match(line(), /^Programme sweep: no run recorded \(over 2 hours\); see toolkit tasks\.$/);
});

test('L: a recorded task deleted by hand shows missing; an unmarked task in the folder shows found, not recorded', (t) => {
  const { home, scheduler } = listedHome(t);
  scheduler.folders.set('TOOLKIT', scheduler.folders.get('TOOLKIT').filter(task => task.name !== 'TOOLKIT - SHARD TIMINGS'));
  scheduler.folders.get('TOOLKIT').push(unmarked('Something else'));
  const rows = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null }).rows;
  const missing = rows.find(item => item.name === 'TOOLKIT - SHARD TIMINGS');
  assert.deepEqual([missing.state, missing.source], ['missing', tasks.RECORD]);
  assert.equal(rows.find(item => item.name === 'Something else').state, "found, not recorded (not Toolkit's)");
});

test('L: cloud, Codex and Claude Code tasks are shown honestly by where they were read', (t) => {
  const home = tempHome(t);
  assert.equal(tasks.main(['--record', '--host', 'claude-cloud', '--id', 'toolkit-daily-check-in', '--name', 'TOOLKIT: Daily check-in', '--schedule', 'daily 08:10', '--purpose', 'Morning check-in.', '--model', 'mid', '--effort', 'medium', '--repository', 'weijunswj/ai-agent-toolkit'], { home, stdout: () => {} }), 0);
  assert.equal(tasks.main(['--record', '--host', 'codex', '--id', 'codex-sweep', '--name', 'Codex sweep', '--schedule', 'daily', '--purpose', 'x'], { home, stdout: () => {} }), 0);
  const local = path.join(home, '.claude', 'scheduled-tasks', 'toolkit-session-digest');
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, 'SKILL.md'), '---\nname: toolkit-session-digest\ndescription: Daily digest upload.\n---\n\nRun it.\n');
  const rows = tasks.listTasks({ home, platform: 'win32', scheduler: fakeScheduler(), folderFor: () => null }).rows;
  const cloud = rows.find(item => item.id === 'toolkit-daily-check-in');
  assert.deepEqual([cloud.source, cloud.ai, cloud.state], [tasks.RECORD, 'mid at medium effort', 'recorded']);
  assert.equal(rows.find(item => item.id === 'codex-sweep').source, tasks.RECORD);
  const desktop = rows.find(item => item.name === 'toolkit-session-digest');
  assert.deepEqual([desktop.host, desktop.source, desktop.purpose, desktop.schedule], ['claude-code', tasks.PRESENCE, 'Daily digest upload.', 'schedule not readable here']);
  assert.equal(rows.some(item => item.source === tasks.LIVE && item.host !== 'windows'), false, 'only Task Scheduler rows say checked live');
  // --record refuses Windows entries and secret-shaped values; --forget leaves Windows entries alone.
  const err = [];
  assert.equal(tasks.main(['--record', '--host', 'windows', '--id', 'x', '--name', 'x', '--schedule', 'x', '--purpose', 'x'], { home, stderr: text => err.push(text) }), 2);
  assert.equal(tasks.main(['--record', '--host', 'codex', '--id', 'y', '--name', 'y', '--schedule', 'x', '--purpose', `ghp_${'b'.repeat(36)}`], { home, stderr: text => err.push(text) }), 2);
  assert.equal(tasks.main(['--forget', 'codex-sweep'], { home, stdout: () => {} }), 0);
  assert.equal(tasks.readRegistry(home).tasks.some(entry => entry.id === 'codex-sweep'), false);
});

test('L: listing writes nothing, calls no model and exits 0, even with a damaged registry', (t) => {
  const { home, scheduler } = listedHome(t);
  const snapshot = () => fs.readdirSync(home, { recursive: true }).sort().map(file => { const full = path.join(home, file); const stat = fs.statSync(full); return `${file}:${stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : 'dir'}`; });
  const before = snapshot();
  scheduler.calls.length = 0;
  const out = [];
  assert.equal(tasks.main([], { home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT', stdout: text => out.push(text) }), 0);
  assert.equal(tasks.main(['--json'], { home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT', stdout: text => out.push(text) }), 0);
  assert.deepEqual(snapshot(), before);
  assert.equal(scheduler.calls.some(call => call[0] !== 'list'), false);
  fs.writeFileSync(tasks.registryPath(home), 'not json');
  const damaged = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT' });
  assert.equal(damaged.registry, 'unreadable');
  assert.match(damaged.notes[0], /could not be read \(not valid JSON\)/);
  assert.ok(damaged.rows.some(row => row.state === "found, not recorded (not Toolkit's)"), 'a lost registry hides nothing that is live');
  assert.throws(() => tasks.updateRegistry(home, list => list), /could not be read/);
  assert.equal(fs.readFileSync(tasks.registryPath(home), 'utf8'), 'not json', 'a damaged registry is never overwritten');
});

test('L: the Windows triggers read back as the plain schedules setup reports', () => {
  assert.equal(windowsTasks.describeTriggers([{ kind: 'MSFT_TaskDailyTrigger', start: '2026-10-29T08:00:00+08:00', interval: 'PT1H', duration: 'PT16H' }]), 'hourly, 08:00 to 23:59');
  assert.equal(windowsTasks.describeTriggers([{ kind: 'MSFT_TaskWeeklyTrigger', start: '2026-10-26T09:15:00+08:00', days_of_week: 2 }]), 'weekly, Monday 09:15');
  assert.equal(windowsTasks.describeTriggers([{ kind: 'MSFT_TaskTimeTrigger', start: '2026-10-26T21:42:08+08:00', interval: 'PT1H' }]), 'every 1 hour from 2026-10-26 21:42');
  assert.equal(windowsTasks.describeResult(0xC000013A), 'stopped when its console closed (0xC000013A)');
  assert.equal(windowsTasks.describeResult(0x41303), 'not run yet');
});

// ---- the binding field -------------------------------------------------------------------------

test('the binding takes an optional schedule_folder of capitals, digits and hyphens', () => {
  const binding = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'toolkit-programme.json'), 'utf8'));
  assert.equal(binding.schedule_folder, 'TOOLKIT');
  assert.equal(programmeState.validateBinding(binding).schedule_folder, 'TOOLKIT');
  const { schedule_folder: _drop, ...without } = binding;
  assert.equal(programmeState.validateBinding(without).schedule_folder, undefined);
  for (const bad of ['toolkit', 'TOOL KIT', '-TOOLKIT', 'A'.repeat(33), 7]) {
    assert.throws(() => programmeState.validateBinding({ ...binding, schedule_folder: bad }), /schedule_folder/, String(bad));
  }
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'programme-state', 'binding-v2.schema.json'), 'utf8'));
  assert.equal(schema.properties.schedule_folder.pattern, windowsTasks.FOLDER.source);
});

// Real base code creates historical receipts. Fake processes and the clock are the only effects.
let baseRunner;
function baseRun(t, home, clock = '2026-10-01T09:00:00Z') {
  if (!baseRunner) {
    const Module = require('node:module');
    const load = name => {
      const file = path.join(ROOT, 'repo/scripts', name);
      const bytes = require('node:child_process').execFileSync('git', ['show', `7affa3000:repo/scripts/${name}`], { cwd: ROOT, timeout: 10000 });
      const mod = new Module(file);
      const original = Module.createRequire(file);
      mod.require = id => id === './toolkit-tasks.cjs' ? baseTasks : original(id);
      mod._compile(bytes.toString(), file);
      return mod.exports;
    };
    const baseTasks = load('toolkit-tasks.cjs');
    baseRunner = load('toolkit-scheduled-job.cjs');
  }
  let tick = Date.parse(clock);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  const receipt = baseRunner.runJob(options, { home, ghPath: GH, nodePath: NODE, mergedBinding: BINDING,
    now: () => new Date(tick += 1000), run: (...args) => { tick += 10000; return fake.run(...args); } });
  assert.equal(receipt.status, 'ok');
  assert.ok(Date.parse(receipt.started) < Date.parse(receipt.footer_sweep_since));
  assert.ok(Date.parse(receipt.footer_sweep_since) < Date.parse(receipt.finished));
  assert.equal(receipt.repository, undefined);
  return receipt;
}
function movingRun(t, { home = tempHome(t), mode = 'programme-sweep', clock = '2026-10-29T09:00:00Z', answers = {}, deps = {} } = {}) {
  let tick = Date.parse(clock);
  const ticks = [];
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob({ ...options, job: mode, taskId: mode === 'programme-sweep' ? options.taskId : 'toolkit-footer-sweep', repoRoot: checkout(t) }, {
    home, ghPath: GH, nodePath: NODE, repositoryReader: testRepository, readIdentity: READ_IDENTITY, readObservation: OBSERVATION,
    now: () => { ticks.push(tick += 1000); return new Date(tick); },
    run: (...args) => { tick += 10000; return fake.run(...args); }, ...deps,
  });
  return { record, log: fake.log, ticks, home };
}
const sweepCall = result => result.log.find(row => row[1] === job.SCRIPT.footerSweep);
const sinceOf = result => { const call = sweepCall(result); return call && call[call.indexOf('--since') + 1]; };
const stateAnswer = (status, fresh = true) => ({ status: status === 'invalid' ? 2 : 0, stdout: JSON.stringify({ state: status === 'enabled' ? 'ENABLED' : status === 'disabled' ? 'DISABLED' : status === 'none' ? 'UNDECIDED' : status === 'invalid' ? 'ERROR' : 'UNAVAILABLE', ...(status === 'invalid' ? { rule: 'M0' } : {}), merged: { status, fresh } }) });
const stateObservation = (status, fresh = true) => () => ({ status, fresh, ...(['enabled','disabled'].includes(status) ? { binding: fixtureBinding(undefined, undefined, status === 'enabled') } : {}) });

test('H1 M1: actual main receipt cleans twice without apply on an advancing clock', t => {
  const home = tempHome(t), old = baseRun(t, home);
  let cursor = old.footer_sweep_since;
  for (const clock of ['2026-10-29T09:00:00Z', '2026-11-03T09:00:00Z']) {
    const result = movingRun(t, { home, clock });
    assert.equal(sinceOf(result), cursor);
    assert.equal(result.record.status, 'ok');
    assert.ok(Date.parse(result.record.started) < Date.parse(result.record.footer_sweep_since));
    assert.ok(Date.parse(result.record.footer_sweep_since) < Date.parse(result.record.finished));
    assert.ok(result.ticks.every((v, i) => !i || v > result.ticks[i - 1]));
    assert.equal(result.log.filter(row => row[1] === job.SCRIPT.governance).length, 1);
    assert.equal(result.log.filter(row => row[0] === GH).length, 1);
    assert.ok(result.log.indexOf(sweepCall(result)) < result.log.findIndex(row => row[2] === 'refresh'));
    cursor = result.record.footer_sweep_since;
  }
});

const RUNTIME_MATRIX = [
  ['enabled', true, true, 2], ['disabled', true, false, 1], ['none', true, false, 1],
  ['enabled', false, false, 1], ['unknown', false, false, 1], ['invalid', true, false, 1], ['foreign', true, false, 1],
];
for (const mode of ['programme-sweep', 'footer-sweep']) for (const [state, fresh, programme, targets] of RUNTIME_MATRIX) {
  test(`closure runtime: ${mode} / ${state} / fresh=${fresh}, repeated beyond 48 hours`, t => {
    const home = tempHome(t);
    let cursor = mode === 'programme-sweep' ? baseRun(t, home).footer_sweep_since : movingRun(t, { home, mode, clock: '2026-10-01T09:00:00Z' }).record.footer_sweep_since;
    for (const clock of ['2026-10-29T09:00:00Z', '2026-11-03T09:00:00Z']) {
      const result = movingRun(t, { home, mode, clock, answers: { 'toolkit-governance.cjs': stateAnswer(state, fresh) }, deps: { readObservation: stateObservation(state, fresh) } });
      assert.equal(sinceOf(result), cursor);
      assert.equal(sweepCall(result).filter(arg => arg === '--repo').length, targets);
      assert.equal(result.log.some(row => row[2] === 'refresh'), mode === 'programme-sweep' && programme);
      assert.equal(result.record.exit, 0);
      const complete = fresh && ['enabled', 'disabled', 'none'].includes(state);
      if (complete) assert.ok(Date.parse(result.record.footer_sweep_since) > Date.parse(result.record.started));
      else { assert.equal(result.record.footer_sweep_since, cursor); assert.match(result.record.summary.join(' '), /Evidence store cleaning withheld/); }
      cursor = result.record.footer_sweep_since;
    }
  });
}

test('M6 M7 L12: damaged, future and mismatched history uses a visible bounded fallback then recovers', t => {
  for (const variant of ['json', 'date', 'impossible', 'future', 'null-identity', 'foreign', 'id', 'job', 'schema']) {
    const home = tempHome(t), old = baseRun(t, home), record = { ...old };
    if (variant === 'date') record.footer_sweep_since = 'bad';
    if (variant === 'impossible') record.footer_sweep_since = '2026-02-30T00:00:00.000Z';
    if (variant === 'future') record.footer_sweep_since = '2099-01-01T00:00:00.000Z';
    if (variant === 'null-identity') record.repository = null;
    if (variant === 'foreign') record.repository = 'other/repo';
    if (variant === 'id') record.id = 'another';
    if (variant === 'job') record.job = 'footer-sweep';
    if (variant === 'schema') record.schema = 'invalid';
    tasks.writeLastRun(options.taskId, record, home);
    if (variant === 'json') fs.writeFileSync(tasks.lastRunPath(options.taskId, home), '{broken');
    const first = movingRun(t, { home });
    assert.equal(first.record.status, 'ok', variant);
    assert.ok(Date.parse(sinceOf(first)) >= Date.parse(first.record.started) - 48 * 3600000);
    assert.match(first.record.summary.join(' '), variant === 'future' ? /clock anomaly/ : /Footer history could not be read/);
    const next = movingRun(t, { home, clock: '2026-11-03T09:00:00Z' });
    assert.equal(sinceOf(next), first.record.footer_sweep_since);
    assert.equal(next.record.status, 'ok');
    assert.doesNotMatch(next.record.summary.join(' '), /history could not|clock anomaly/);
  }
});

test('L7 L9: footer failure wins every programme result; lock errors never prevent eligible programme work', t => {
  for (const programme of ['ok', 'held', 'skipped', 'failed']) for (const failure of ['footer', 'acquire', 'release']) {
    const home = tempHome(t), old = baseRun(t, home);
    const result = movingRun(t, { home, answers: { 'programme refresh': { status: programme === 'failed' ? 2 : programme === 'held' ? 1 : 0 },
      ...(programme === 'skipped' ? { 'toolkit-governance.cjs': stateAnswer('unknown', false) } : {}),
      'toolkit-github-footer-sweep.cjs': { status: failure === 'footer' ? 1 : 0, stdout: '{"results":[{"status":"MISMATCH"}]}' } },
      deps: failure === 'acquire' ? { takeLock: () => { throw new Error('lock unavailable'); } } : failure === 'release' ? { takeLock: () => ({ release() { throw new Error('release failed'); } }) } : {} });
    assert.equal(result.record.exit, 1, `${programme}/${failure}`);
    assert.equal(result.record.status, 'failed');
    assert.equal(result.log.some(row => row[2] === 'refresh'), programme !== 'skipped');
    assert.equal(result.record.footer_sweep_since, old.footer_sweep_since);
  }
});

test('L9: lock contention leaves active writer receipt intact and still attempts programme work', t => {
  const home = tempHome(t); baseRun(t, home); const before = fs.readFileSync(tasks.lastRunPath(options.taskId, home));
  const result = movingRun(t, { home, deps: { takeLock: () => null } });
  assert.equal(result.record.footer_status, 'held');
  assert.ok(result.log.some(row => row[2] === 'refresh'));
  assert.deepEqual(fs.readFileSync(tasks.lastRunPath(options.taskId, home)), before);
});

test('L11: deleted registered root fails before auth and cannot be reported offline', t => {
  for (const mode of ['programme-sweep', 'footer-sweep']) {
    const result = movingRun(t, { mode, deps: { repositoryReader: () => { throw new Error('registered root is not a repository checkout'); } } });
    assert.equal(result.record.status, 'failed'); assert.deepEqual(result.log, []);
    assert.match(result.record.summary.join(' '), /registered root is not a repository checkout/);
    assert.doesNotMatch(result.record.summary.join(' '), /offline/);
  }
});

test('M2: GitHub aliases share strict origin targeting; foreign hosts and metadata remain refused', t => {
  const identity = require('../scripts/toolkit-repository-identity.cjs');
  for (const [url, allowed] of [['https://github.com/acme/app.git', true], ['git@github-work:acme/app.git', true], ['ssh://git@ssh.github.com:443/acme/app.git', true], ['https://github.com.evil.test/acme/app.git', false], ['https://other.test/acme/app.git', false], ['https://github.com/acme/app/extra.git', false]]) {
    const remote = identity.validateRemoteIdentity(url), readIdentity = root => ({ valid: remote.valid, root, remote });
    assert.equal(windowsTasks.repositoryOf(readIdentity('fixture')), allowed ? 'acme/app' : null, url);
    const result = movingRun(t, { mode: 'footer-sweep', deps: { readIdentity } });
    assert.equal(Boolean(sweepCall(result)), allowed, url);
    if (allowed) assert.deepEqual(sweepCall(result).slice(2, 4), ['--repo', 'acme/app']);
    else assert.deepEqual(result.log, []);
  }
});

test('store scope: stale, foreign, null, throwing and working-tree-only observations grant no store or programme effects', t => {
  for (const observe of [() => null, () => { throw new Error('unreadable'); }, () => ({ ...OBSERVATION(), fresh: false }),
    () => ({ ...OBSERVATION(), binding: fixtureBinding('other/repo') }), () => ({ status: 'unknown', fresh: false }),
    () => ({ ...OBSERVATION(), binding: { repository: 'weijunswj/ai-agent-toolkit' } })]) {
    const home = tempHome(t), old = baseRun(t, home);
    const result = movingRun(t, { home, deps: { readObservation: observe } });
    assert.equal(sweepCall(result).filter(arg => arg === '--repo').length, 1);
    assert.equal(result.record.footer_sweep_since, old.footer_sweep_since);
    assert.equal(result.log.some(row => row[2] === 'refresh'), false);
  }
  for (const mode of ['programme-sweep', 'footer-sweep']) for (const problem of ['offline', 'signed-out', 'identity']) {
    const home = tempHome(t);
    const old = mode === 'programme-sweep' ? baseRun(t, home) : movingRun(t, { home, mode, clock: '2026-10-01T09:00:00Z' }).record;
    const result = movingRun(t, { home, mode, answers: problem === 'identity' ? {} : { 'gh auth': { status: 1 }, 'reach github': { status: problem === 'offline' ? 3 : 0 } }, deps: problem === 'identity' ? { readIdentity: () => null } : {} });
    assert.equal(sweepCall(result), undefined); assert.equal(result.record.footer_sweep_since, old.footer_sweep_since);
    const next = movingRun(t, { home, mode, clock: '2026-11-03T09:00:00Z' });
    assert.equal(sinceOf(next), old.footer_sweep_since); assert.equal(next.record.status, 'ok');
  }
});

test('M3: exact real offline status JSON including ERROR exit 2 flows unchanged into runner diagnostics', async t => {
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  for (const invalid of [false, true]) {
    const root = checkout(t, { shards: false }), home = tempHome(t);
    fs.writeFileSync(path.join(root, '.git/config'), '[remote "origin"]\nurl = https://github.com/weijunswj/ai-agent-toolkit.git\n');
    const registryPath = path.join(home, 'registry.json');
    const support = require('./toolkit-governed-fixture-support.cjs');
    if (invalid) support.recordMerged(root, { text: '{"schema":"invalid"}', registryPath });
    else support.recordAbsent(root, { registryPath });
    let stdout = '';
    const cli = new ToolkitGovernanceCli({ cwd: root, registryOptions: { registryPath, testOnly: true, home }, discoveryGh: () => ({ ok: false, reason: 'offline' }), refresh: () => ({ refreshed: false, error: 'offline' }), queueReader: () => ({ pending: 0 }), hookReader: () => null, stdout: { write: text => { stdout += text; } }, stderr: { write() {} } });
    const code = await cli.main(['status', '--json']);
    assert.equal(code, invalid ? 2 : 0);
    const result = movingRun(t, { answers: { 'toolkit-governance.cjs': { status: code, stdout } } });
    assert.equal(result.record.programme_reason, invalid ? 'binding is invalid' : 'binding refresh failed: governance reads offline');
    assert.equal(sweepCall(result).filter(arg => arg === '--repo').length, 1);
  }
  for (const answer of [{ status: 1, stdout: GOVERNED.stdout }, { status: 2, stdout: GOVERNED.stdout }, { status: 0, stdout: '{broken' },
    ...hostile.cases(['line-breaks', 'continued-lines', 'quoting', 'invisible', 'free-text']).map(row => ({ status: 0, stdout: row.text }))]) {
    const result = movingRun(t, { answers: { 'toolkit-governance.cjs': answer } });
    assert.equal(result.record.programme_reason, 'governance status could not be read');
    assert.equal(sweepCall(result).filter(arg => arg === '--repo').length, 1);
  }
});

for (const shape of ['programme-sweep', 'footer-sweep']) test(`closure registration: ${shape} switches only with fresh matching governance, retaining folder and stops`, t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler();
  const initial = desired(t, { root, state: shape === 'footer-sweep' ? 'UNDECIDED' : 'ENABLED', repository: 'example/widget', folder: 'WIDGET' });
  assert.ok(windowsTasks.applyTasks(initial, { home, scheduler }).items.every(row => row.done));
  for (const state of ['ENABLED', 'DISABLED', null, 'ENABLED']) {
    const offer = desired(t, { root, state, repository: 'example/widget', folder: 'WIDGET' });
    const before = structuredClone([...scheduler.folders]); scheduler.calls.length = 0;
    const result = windowsTasks.applyTasks(offer, { home, scheduler });
    assert.equal(result.folder, 'WIDGET');
    if (!state) {
      assert.ok(result.items.every(row => row.action === 'refused')); assert.deepEqual([...scheduler.folders], before);
      assert.ok(scheduler.calls.every(row => row[0] === 'list'));
    } else {
      assert.ok(result.items.every(row => row.done), JSON.stringify(result));
      assert.deepEqual(scheduler.list('WIDGET').map(r => r.name).sort(), state === 'ENABLED' ? ['WIDGET - PROGRAMME SWEEP','WIDGET - SHARD TIMINGS'] : ['WIDGET - FOOTER SWEEP']);
      assert.ok(tasks.readRegistry(home).tasks.every(e => !e.stopped_by_owner));
    }
  }
  windowsTasks.removeTasks({ scope: initial, home, scheduler });
  const stopped = fs.readFileSync(tasks.registryPath(home));
  for (const state of ['ENABLED','UNDECIDED']) {
    const result = windowsTasks.applyTasks(desired(t, { root, state, repository: 'example/widget', folder: 'WIDGET' }), { home, scheduler });
    assert.ok(result.items.every(row => row.action === 'refused'));
    assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), stopped);
  }
});

test('closure conflicts: ordinary apply holds both cleaners, unrecorded tasks and cross-folder stops', t => {
  for (const mode of ['both', 'unrecorded', 'cross-folder-stop']) {
    const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), offer = desired(t, { root });
    windowsTasks.applyTasks(offer, { home, scheduler });
    const other = offer.definitions.find(row => row.job === 'footer-sweep');
    if (mode === 'cross-folder-stop') {
      windowsTasks.removeTasks({ scope: offer, home, scheduler });
      const changed = desired(t, { root, state: 'UNDECIDED', folder: 'OTHER' });
      const result = windowsTasks.applyTasks(changed, { home, scheduler });
      assert.ok(result.items.every(row => row.action === 'refused')); continue;
    }
    scheduler.register(other);
    if (mode === 'both') tasks.updateRegistry(home, rows => [...rows, { ...rows[0], id: other.id, name: other.name, job: other.job, definition: other.def, enrolled: windowsTasks.enrolledDefinition(scheduler.folders.get('TOOLKIT').at(-1)) }]);
    const before = structuredClone([...scheduler.folders]);
    const result = windowsTasks.applyTasks(offer, { home, scheduler });
    assert.ok(result.items.every(row => row.action === 'refused'));
    assert.deepEqual([...scheduler.folders], before);
  }
});

test('schedules: P1D and PT24H are equivalent, updates settle, and warnings use installed hours', t => {
  assert.equal(windowsTasks.describeTriggers([{ kind: 'MSFT_TaskDailyTrigger', start: '2026-10-29T00:00:00', interval: 'PT1H', duration: 'P1D' }]), 'hourly, 00:00 to 23:59');
  const home = tempHome(t), scheduler = fakeScheduler(), offer = desired(t);
  windowsTasks.applyTasks(offer, { home, scheduler });
  const live = scheduler.folders.get('TOOLKIT')[0]; live.triggers[0].duration = 'P1D';
  tasks.updateRegistry(home, rows => rows.map(row => row.job === 'programme-sweep' ? { ...row, enrolled: windowsTasks.enrolledDefinition(live) } : row));
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler }).items[0].action, 'current');
  for (const [schedule, at, expected] of [['hourly, 08:00 to 23:59', 7, false], ['hourly, 08:00 to 23:59', 9, false], ['hourly, 08:00 to 23:59', 10, true], ['hourly, 00:00 to 23:59', 1, true], ['broken', 12, false]]) {
    tasks.updateRegistry(home, rows => rows.map(row => row.job === 'programme-sweep' ? { ...row, schedule } : row));
    assert.equal(Boolean(tasks.sweepLine(offer.repository, { home, now: new Date(2026, 9, 29, at) })), expected, schedule + at);
  }
});

test('setup: both projects share report reads, deduplicate and print no paths; apply always reads afresh', t => {
  const core = require('../scripts/setup-toolkit-core.cjs'), home = tempHome(t), managed = checkout(t), project = checkout(t), scheduler = fakeScheduler();
  for (let i = 0; i < 30; i++) scheduler.folders.set('UNRELATED-' + i, [unmarked('Other', { description: `[toolkit-task v1 id=unrelated-${i} def=0123456789ab]` })]);
  const counts = new Map();
  const count = key => counts.set(key, (counts.get(key) || 0) + 1);
  let origin = 'example/widget';
  const gov = root => governance({ repository: root === managed ? 'weijunswj/ai-agent-toolkit' : origin, folder: root === managed ? 'TOOLKIT' : 'WIDGET' });
  const deps = { identityReader: request => { count('location:' + request.checkout); return request; }, reportCheckout: root => root,
    governance: { readIdentity(root) { count('identity:' + root); return gov(root).readIdentity(root); },
      governanceState(root) { count('status:' + root); return gov(root).governanceState(root); } },
    readObservation(identity) { count('observation:' + identity.root); return gov(identity.root).readObservation(); } };
  const lines = [];
  const plans = core.printWindowsTasks({ repoRoot: managed }, { platform: 'win32', scheduler, home, workingFolder: project, checkoutDeps: deps, log: line => lines.push(line) });
  assert.equal(plans.length, 2);
  assert.ok([...counts.values()].every(value => value === 1), JSON.stringify([...counts]));
  assert.equal(scheduler.calls.filter(row => row[0] === 'list').length, 32);
  for (let i = 0; i < 30; i++) assert.equal(scheduler.calls.filter(row => row[0] === 'list' && row[1] === 'UNRELATED-' + i).length, 1);
  assert.equal(lines.join(' ').includes(managed) || lines.join(' ').includes(project), false);
  assert.ok(scheduler.calls.every(row => row[0] === 'list'));
  const offer = windowsTasks.desiredTasks({ checkout: project, toolkitRoot: managed, nodePath: NODE, home, deps });
  origin = 'other/widget';
  const applied = windowsTasks.applyTasks(offer, { home, scheduler });
  assert.ok(applied.items.every(row => row.action === 'refused'));
  assert.ok([...counts.values()].some(value => value > 1));
  assert.ok(scheduler.calls.every(row => row[0] === 'list'));
});

for (const mode of ['programme-sweep','footer-sweep']) test(`L5: ${mode} registration and repeated first runs use real job records`, t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler();
  const offer = desired(t, { root, state: mode === 'programme-sweep' ? 'ENABLED' : 'UNDECIDED' });
  let tick = Date.parse('2026-10-29T09:00:00Z'), failed = false;
  const now = () => new Date(tick += 1000);
  scheduler.onStart = task => {
    const definition = offer.definitions.find(d => d.name === task.name);
    const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, 'toolkit-github-footer-sweep.cjs': { status: failed ? 1 : 0 } });
    const record = job.runJob({ job: definition.job, repoRoot: root, taskId: definition.id }, { home, now, ghPath: GH, nodePath: NODE, repositoryReader: testRepository, readIdentity: READ_IDENTITY, readObservation: OBSERVATION,
      run: (...args) => { tick += 10000; return fake.run(...args); } });
    Object.assign(task, { state: 'Ready', last_run: record.started, last_result: 0 });
  };
  const applied = windowsTasks.applyTasks(offer, { home, scheduler, now, firstRunOptions: { wait() {} } });
  assert.equal(applied.items[0].first_run.status, 'ok');
  const d = applied.items[0].definition, first = tasks.readLastRun(d.id, home);
  assert.ok(Date.parse(first.footer_sweep_since) > Date.parse(first.started));
  assert.equal(windowsTasks.firstRun(d, { home, scheduler, now, wait() {} }).status, 'ok');
  const second = tasks.readLastRun(d.id, home);
  assert.ok(Date.parse(second.footer_sweep_since) > Date.parse(first.footer_sweep_since));
  failed = true;
  assert.equal(windowsTasks.firstRun(d, { home, scheduler, now, wait() {} }).status, 'failed');
  assert.equal(tasks.readLastRun(d.id, home).footer_sweep_since, second.footer_sweep_since);
});

test('M9: snapshots at each in-place boundary never silently disable or claim an unfinished registration succeeded', t => {
  for (const mode of ['programme-sweep','footer-sweep']) for (const boundary of ['register', 'readback', 'registry']) {
    const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler();
    const offer = desired(t, { root, state: mode === 'programme-sweep' ? 'ENABLED' : 'UNDECIDED' });
    const legacy = { ...offer, wanted: offer.wanted.map(d => d.job === 'shard-timings' ? d : ({ ...d, schedule: { kind: 'hourly', at: '08:00', hours: 16 }, schedule_text: 'hourly, 08:00 to 23:59' })) };
    for (const d of legacy.wanted) { const old = d.def; d.def = windowsTasks.definitionDigest(d); d.description = d.description.replace(old, d.def); }
    windowsTasks.applyTasks(legacy, { home, scheduler });
    let snapshot = null;
    const capture = () => { if (!snapshot) snapshot = { live: Object.fromEntries(structuredClone([...scheduler.folders])), registry: tasks.readRegistry(home).tasks }; };
    const register = scheduler.register, list = scheduler.list;
    let written = false;
    scheduler.register = (...args) => { register(...args); written = true; if (boundary === 'register') capture(); };
    scheduler.list = (...args) => { const result = list(...args); if (written && boundary === 'readback') capture(); return result; };
    const registry = { ...tasks, updateRegistry(...args) { const result = tasks.updateRegistry(...args); if (written && boundary === 'registry') capture(); return result; } };
    windowsTasks.applyTasks(offer, { home, scheduler, registry });
    assert.ok(snapshot, boundary);
    const replayHome = tempHome(t), replay = fakeScheduler(snapshot.live);
    copyComputerIdentity(home, replayHome);
    tasks.writeRegistry(replayHome, snapshot.registry);
    const repeated = windowsTasks.applyTasks(offer, { home: replayHome, scheduler: replay });
    assert.ok(repeated.items.every(row => ['refused', 'owner-choice-required'].includes(row.action) || row.action === 'current' && row.done));
    assert.ok([...replay.folders.values()].flat().every(task => task.state !== 'Disabled'));
    assert.equal(replay.calls.some(row => row[0] === 'start'), false);
  }
});

test('apply lock: both shapes share one repository lock, with identity refusals before the lock write', t => {
  const home = tempHome(t), root = checkout(t), files = [];
  for (const state of ['ENABLED','UNDECIDED']) {
    const offer = desired(t, { root, state });
    const scheduler = fakeScheduler();
    assert.throws(() => windowsTasks.applyTasks(offer, { home, scheduler, takeLock: file => { files.push(file); return null; } }), /another task apply is running/);
    assert.ok(scheduler.calls.every(row => row[0] === 'list'));
    assert.throws(() => windowsTasks.applyTasks(offer, { home, scheduler, identityReader: () => { throw new Error('wrong location'); }, takeLock: () => assert.fail('identity must precede lock') }), /wrong location/);
  }
  assert.equal(files[0], files[1]);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('status contradictions never authorise store scope, programme work or cursor advancement', t => {
  for (const [state, status] of [['ENABLED','disabled'], ['UNDECIDED','disabled'], ['DISABLED','enabled'], ['UNAVAILABLE','disabled']]) {
    const home = tempHome(t), old = baseRun(t, home);
    const result = movingRun(t, { home, answers: { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state, merged: { status, fresh: true } }) } }, deps: { readObservation: stateObservation(status) } });
    assert.equal(sweepCall(result).filter(arg => arg === '--repo').length, 1);
    assert.equal(result.record.footer_sweep_since, old.footer_sweep_since);
    assert.equal(result.log.some(row => row[2] === 'refresh'), false);
    assert.equal(result.record.programme_reason, 'governance status could not be read');
  }
});

test('L8: metadata mismatch names the identity failure, retains history and recovers on the next run', t => {
  const home = tempHome(t), old = baseRun(t, home);
  const result = movingRun(t, { home, answers: { 'toolkit-github-footer-sweep.cjs': { status: 1, stdout: JSON.stringify({ results: [{ status: 'FAILED', reason: 'repository-identity-mismatch' }] }) } } });
  assert.equal(result.record.exit, 1);
  assert.match(result.record.summary.join(' '), /Footer repository identity did not match origin/);
  assert.equal(result.record.footer_sweep_since, old.footer_sweep_since);
  const next = movingRun(t, { home, clock: '2026-11-03T09:00:00Z' });
  assert.equal(sinceOf(next), old.footer_sweep_since);
  assert.equal(next.record.status, 'ok');
});

test('approval metadata: --no-first-run is outside the exact standing command', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler();
  let output = '';
  assert.equal(windowsTasks.main(['apply','--repo-root',root,'--no-first-run','--json'], { platform: 'win32', home, scheduler, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE,
    checkoutDeps: { identityReader, governance: governance() }, stdout: text => { output += text; }, stderr: text => assert.fail(text) }), 0);
  assert.equal(JSON.parse(output).approval, 'explicit approval required; first-result verification was skipped');
  assert.equal(scheduler.calls.some(row => row[0] === 'start'), false);
});

function switchOffer(t, shape, root) { return desired(t, { root, state: shape === 'programme-sweep' ? 'ENABLED' : 'DISABLED' }); }

let currentMainRunner;
function currentMainReceipt(home, root, clock, taskId = 'toolkit-programme-sweep') {
  if (!currentMainRunner) {
    const Module = require('node:module'), file = path.join(ROOT, 'repo/scripts/toolkit-scheduled-job.cjs');
    const bytes = require('node:child_process').execFileSync('git', ['show', 'cbd3d6078:repo/scripts/toolkit-scheduled-job.cjs'], { cwd: ROOT, timeout: 10000 });
    const loaded = new Module(file); loaded.require = Module.createRequire(file); loaded._compile(bytes.toString(), file); currentMainRunner = loaded.exports;
  }
  let tick = Date.parse(clock);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  const receipt = currentMainRunner.runJob({ job: 'programme-sweep', taskId, repoRoot: root }, { home, ghPath: GH, nodePath: NODE,
    repositoryReader: testRepository, mergedBinding: BINDING, now: () => new Date(tick += 1000), run: (...args) => { tick += 10000; return fake.run(...args); } });
  assert.equal(receipt.status, 'ok'); assert.ok(receipt.footer_sweep_since); return receipt;
}

test('task advisory clears immediately after real owner ON/OFF/absent switches and removal with leftover records', async t => {
  const w = switchWorld(t);
  const gate = require('../scripts/toolkit-governance-gate.cjs');
  const registryOptions = { registryPath: path.join(tasks.userStateDir(w.home), 'repository-governance.v1.json'), testOnly: true };
  const start = source => {
    const input = { session_id: `advisory-${source}`, source, cwd: w.root };
    gate.startSession(input, { registryOptions, environment: { TOOLKIT_GOVERNANCE_OFFLINE: '1' } });
    return gate.sessionLine(w.root, { registryOptions, programmeDeps: { home: w.home, environment: {}, platform: 'win32', mergedBinding: () => null } });
  };
  await w.gov('on');
  assert.equal(w.cli('apply').code, 0);
  for (const state of ['off','on','absent','on']) {
    await w.gov(state);
    for (const source of ['startup','resume','clear','compact']) assert.match(start(source), /Toolkit tasks: recorded Windows tasks/);
    const wanted = require('../scripts/toolkit-task-shape.cjs').confirmedTaskShape({ certain: true, governanceState: state === 'on' ? 'ENABLED' : state === 'off' ? 'DISABLED' : 'UNDECIDED' });
    assert.deepEqual(w.offer().wanted.map(d => d.job).sort(), [...wanted].sort());
    assert.deepEqual(w.cli('plan').json.items.filter(item => !item.retiring).filter(item => ['create','current','update'].includes(item.action)).map(item => item.definition.job).sort(), [...wanted].sort());
    assert.equal(w.cli('apply').code, 0);
    assertShape(w, state);
    for (const source of ['startup','resume','clear','compact']) assert.doesNotMatch(start(source), /Toolkit tasks:/);
  }
  const before = tasks.readRegistry(w.home).tasks;
  assert.ok(before.some(row => tasks.readLastRun(row.id, w.home)), 'real first-run receipts exist');
  assert.equal(w.cli('remove').code, 0);
  assert.ok(before.some(row => tasks.readLastRun(row.id, w.home)), 'removal leaves run records');
  await w.gov('off');
  for (let repeat = 0; repeat < 2; repeat++) for (const source of ['startup','resume','clear','compact']) assert.doesNotMatch(start(source), /Toolkit tasks:/);
});

for (const days of [0,1,3]) for (const sequence of [['off','on','off','on'], ['absent','on','absent','on'], ['on','off','on','off']])
test(`switch sequence: real status/apply ${sequence.join('/')} advancing ${days} days`, async t => {
  const w = switchWorld(t);
  for (const [index, state] of sequence.entries()) {
    w.advance(days); await w.gov(state);
    assert.equal(w.cli('plan').code, 0);
    const result = w.cli('apply'); assert.equal(result.code, 0, result.err + JSON.stringify(result.json));
    assert.equal(result.json.items.find(i => i.first_run)?.first_run.status, 'ok'); assertShape(w, state);
    if (index === 1) {
      const receipt = currentMainReceipt(w.home, w.root, w.now().toISOString(), 'ai-agent-toolkit-programme-sweep'); w.advance(4);
      const prior = state === 'on' && receipt.footer_sweep_since;
      if (prior) assert.equal(tasks.readLastRun(receipt.id, w.home).footer_sweep_since, prior);
    }
  }
});

const switchFaultPoints = ['history', 'history-read', 'register', 'destination-readback', 'enrolment', 'unregister', 'source-readback', 'cleanup', 'shards', 'start', 'result-readback', 'final-readback', 'registry-read', 'registry-write', 'rename', 'persisted-readback'];
// Reuses probe-stuck, probe-stuck2 and probe-qual-loop's continuous registry/history sequence.
// Every row must reach its fault, then prove either convergence or the printed approved recovery.
test('switch fault loop: continuous real status/apply, same-day and cross-day failures', async t => {
  const w = switchWorld(t);
  for (const state of ['off','on','off','on']) { await w.gov(state); assert.equal(w.cli('apply').code, 0); assertShape(w, state); }
  let rows = 0;
  for (const target of ['off','on']) for (const point of switchFaultPoints) for (const side of ['before','after']) {
    const source = target === 'on' ? 'off' : 'on';
    w.advance(side === 'after' ? 3 : 0); await w.gov(source); assert.equal(w.cli('apply').code, 0); assertShape(w, source);
    await w.gov(target);
    let fired = false, registered = false, removed = false, resultRead = false, persisted = false;
    const at = (label, when) => { if (!fired && point === label && side === when) { fired = true; throw new Error(`injected ${label} ${when}`); } };
    const around = (label, effect) => { at(label, 'before'); const out = effect(); at(label, 'after'); return out; };
    const native = w.scheduler;
    const adapter = { ...native,
      list: f => around(resultRead ? 'final-readback' : removed ? 'source-readback' : registered ? 'destination-readback' : 'list', () => native.list(f)),
      register: (d, old) => around(d.job === 'shard-timings' ? 'shards' : 'register', () => { const out = native.register(d, old); if (d.job !== 'shard-timings') registered = true; return out; }),
      unregister: (f, name, id, old) => around(id.endsWith('shard-timings') ? 'shards' : 'unregister', () => { const out = native.unregister(f, name, id, old); if (!id.endsWith('shard-timings')) removed = true; return out; }),
      start: (f, name) => around('start', () => native.start(f, name)),
      info: (f, name) => around('result-readback', () => { const out = native.info(f, name); resultRead = true; return out; }),
    };
    const registry = { ...tasks,
      readRegistry: (...args) => around('registry-read', () => tasks.readRegistry(...args)),
      updateRegistry: (...args) => around(removed ? 'cleanup' : 'enrolment', () => tasks.updateRegistry(...args)),
    };
    const rename = fs.renameSync, readFile = fs.readFileSync, writeFile = fs.writeFileSync;
    const watched = file => String(file).includes(tasks.userStateDir(w.home)) && /(?:tasks\.json|last-run\.json)/.test(String(file));
    const mocks = [
      t.mock.method(fs, 'renameSync', (...args) => watched(args[1]) ? around('rename', () => { const out = rename(...args); persisted = true; return out; }) : rename(...args)),
      t.mock.method(fs, 'readFileSync', (...args) => persisted && watched(args[0]) ? around('persisted-readback', () => readFile(...args)) : readFile(...args)),
      t.mock.method(fs, 'writeFileSync', (...args) => watched(args[0]) ? around('registry-write', () => writeFile(...args)) : writeFile(...args)),
    ];
    try { windowsTasks.applyTasks(w.offer(), { scheduler: adapter, registry, home: w.home, now: w.now,
      readRecord: id => around('history-read', () => tasks.readLastRun(id, w.home)),
      writeRecord: (id, rec) => around('history', () => tasks.writeLastRun(id, rec, w.home)), firstRunOptions: { wait() {}, pollMs: 1, waitMs: 2 } }); }
    catch (error) { assert.match(error.message, /injected|history readback failed/); }
    finally { for (const mock of mocks) mock.mock.restore(); }
    assert.equal(fired, true, `${target} ${point} ${side} fired`); rows++;
    const snapshot = { live: structuredClone([...native.folders]), entries: (w.registry || tasks).readRegistry(w.home).tasks };
    assert.ok(snapshot.entries.every(e => !e.stopped_by_owner));
    const records = Object.fromEntries(w.offer().definitions.map(d => [d.id, tasks.readLastRun(d.id, w.home)]));
    // Probe-switch's retain/reverse/uncertain replays use the same interrupted native and registry state.
    const onStart = native.onStart;
    native.onStart = live => { tasks.writeRegistry(w.home, w.registry.readRegistry(w.home).tasks); onStart(live); };
    for (const decision of [target, source, 'uncertain']) for (const reset of [false,true]) {
      native.folders.clear(); for (const [f, rows] of structuredClone(snapshot.live)) native.folders.set(f, rows);
      w.registry = memoryRegistry(snapshot.entries);
      for (const [id, record] of Object.entries(records)) {
        if (record) tasks.writeLastRun(id, record, w.home);
        else if (fs.existsSync(tasks.lastRunPath(id, w.home))) fs.unlinkSync(tasks.lastRunPath(id, w.home));
      }
      await w.gov(decision);
      const before = JSON.stringify([...native.folders]), prior = JSON.stringify(w.registry.readRegistry(w.home));
      const retry = w.cli('apply');
      if (decision === 'uncertain') {
        assert.equal(retry.code, 1); assert.equal(JSON.stringify([...native.folders]), before);
        assert.equal(JSON.stringify(w.registry.readRegistry(w.home)), prior);
        break;
      }
      if (retry.code !== 0) {
        assert.ok((w.registry || tasks).readRegistry(w.home).tasks.every(e => !e.stopped_by_owner));
        printedRecovery(w, reset);
      }
      assertShape(w, decision);
      if (retry.code === 0) break; // No hold exists from which a reset needs proving.
    }
    native.onStart = onStart;
    tasks.writeRegistry(w.home, w.registry.readRegistry(w.home).tasks); w.registry = null;
    await w.gov(target);
    const current = w.cli('apply'); if (current.code !== 0) printedRecovery(w);
    assertShape(w, target);
  }
  assert.equal(rows, switchFaultPoints.length * 4);
});

for (const switchNumber of [1,2,3]) for (const from of ['programme-sweep','footer-sweep']) test(`interruption table: switch ${switchNumber}, restart before/after every effect and read-back from ${from}`, async t => {
  const w = switchWorld(t), { home, root, scheduler } = w;
  const to = from === 'programme-sweep' ? 'footer-sweep' : 'programme-sweep';
  for (let index = 0; index < switchNumber; index++) {
    const mode = (switchNumber - 1 - index) % 2 === 0 ? from : to;
    w.advance(switchNumber === 2 ? 1 : 0); await w.gov(mode === 'programme-sweep' ? 'on' : 'off');
    assert.equal(w.cli('apply').code, 0); assertShape(w, mode === 'programme-sweep' ? 'on' : 'off');
  }
  currentMainReceipt(home, root, w.now().toISOString(), 'ai-agent-toolkit-programme-sweep');
  await w.gov(to === 'programme-sweep' ? 'on' : 'off'); const offer = w.offer();
  const snapshots = []; let capturing = false;
  const capture = boundary => {
    if (capturing) return;
    capturing = true;
    try { snapshots.push({ boundary, live: Object.fromEntries(structuredClone([...scheduler.folders])), entries: tasks.readRegistry(home).tasks,
      records: Object.fromEntries(offer.definitions.map(d => [d.id, tasks.readLastRun(d.id, home)])) }); }
    finally { capturing = false; }
  };
  // Observe the real atomic rename and its independent read-back inside updateRegistry,
  // including the otherwise hidden write/read window. Snapshots never count their own reads.
  const observedFiles = new Set([tasks.registryPath(home), ...offer.definitions.map(d => tasks.lastRunPath(d.id, home))]);
  const pendingReadback = new Set(), rename = fs.renameSync, readFile = fs.readFileSync;
  t.mock.method(fs, 'renameSync', function(from, to, ...args) {
    const observed = observedFiles.has(to);
    if (observed) capture('before atomic rename');
    const result = rename.call(this, from, to, ...args);
    if (observed) { capture('after atomic rename'); pendingReadback.add(to); }
    return result;
  });
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    if (capturing || !pendingReadback.delete(file)) return readFile.call(this, file, ...args);
    capture('before persisted readback');
    try { return readFile.call(this, file, ...args); } finally { capture('after persisted readback'); }
  });
  const wrap = (object, key) => { const original = object[key]; object[key] = (...args) => { capture('before ' + key); const result = original.apply(object, args); capture('after ' + key); return result; }; };
  const registry = { ...tasks };
  const now = w.now;
  scheduler.onStart = live => {
    const definition = offer.definitions.find(d => d.name === live.name);
    const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
    const record = job.runJob({ job: definition.job, taskId: definition.id, repoRoot: root }, { home, now, ghPath: GH, nodePath: NODE,
      repositoryReader: testRepository, readIdentity: READ_IDENTITY, readObservation: OBSERVATION, run: (...args) => { w.advance(10 / 86400); return fake.run(...args); } });
    Object.assign(live, { state: 'Ready', last_run: record.started, last_result: 0 });
  };
  for (const name of ['list','register','unregister','start','info']) wrap(scheduler, name);
  for (const name of ['readRegistry','updateRegistry']) wrap(registry, name);
  const owner = new windowsTasks.WindowsTaskOwner({ scheduler, registry, home, now, firstRunOptions: { wait() {} },
    readRecord: id => { capture('before history read'); const result = tasks.readLastRun(id, home); capture('after history read'); return result; },
    writeRecord: (id, record) => { capture('before atomic history write'); tasks.writeLastRun(id, record, home); capture('after atomic history write'); } });
  const applied = owner.apply(offer); assert.ok(applied.items.every(i => i.done), JSON.stringify(applied));
  assert.ok(snapshots.some(s => s.boundary === 'before atomic history write')); assert.ok(snapshots.some(s => s.boundary === 'after unregister'));
  assert.ok(snapshots.some(s => s.boundary === 'before start')); assert.ok(snapshots.some(s => s.boundary === 'after info'));
  assert.ok(snapshots.some(s => s.boundary === 'after atomic rename')); assert.ok(snapshots.some(s => s.boundary === 'before persisted readback'));
  const replayHome = tempHome(t), provenStates = new Set(), replayAt = w.now();
    copyComputerIdentity(home, replayHome);
  for (const snap of snapshots) {
    // Identical native, registry and history inputs share one restart proof. All effect and
    // read-back boundaries are still captured; a repeated label never creates another state.
    const stateKey = JSON.stringify([snap.live, snap.entries, snap.records]);
    if (provenStates.has(stateKey)) continue;
    provenStates.add(stateKey);
    const replay = fakeScheduler(snap.live), replayRegistry = memoryRegistry(snap.entries);
    for (const d of offer.definitions) if (fs.existsSync(tasks.lastRunPath(d.id, replayHome))) fs.unlinkSync(tasks.lastRunPath(d.id, replayHome));
    for (const [id, record] of Object.entries(snap.records)) if (record) tasks.writeLastRun(id, record, replayHome);
    const unrecorded = Object.values(snap.live).flat().some(l => !snap.entries.some(e => e.name === l.name));
    const result = windowsTasks.applyTasks(offer, { home: replayHome, scheduler: replay, registry: replayRegistry, takeLock: () => ({ release() {} }), now: () => replayAt });
    if (unrecorded) {
      assert.ok(result.items.every(i => i.action === 'refused'), snap.boundary); assert.ok(replay.calls.every(c => c[0] === 'list'));
      assert.deepEqual([...replay.folders], Object.entries(snap.live)); assert.match(result.next_step, /inspection\/removal/);
    } else if (snap.entries.some(e => !(snap.live[e.folder] || []).some(l => l.name === e.name))) {
      assert.equal(result.refused, true, snap.boundary);
      assert.match(result.next_step, /unproven absence/);
      assert.deepEqual([...replay.folders], Object.entries(snap.live));
      const recovered = windowsTasks.applyTasks(offer, { home: replayHome, scheduler: replay, registry: replayRegistry, takeLock: () => ({ release() {} }), repairOwned: true });
      assert.ok(recovered.items.every(i => i.done), JSON.stringify(recovered)); assertLiveRegistry(replayHome, replay, replayRegistry);
    } else {
      assert.ok(result.items.every(i => i.done), snap.boundary + JSON.stringify(result));
      assert.deepEqual(replay.list('AI-AGENT-TOOLKIT').map(t => t.name).sort(), to === 'programme-sweep' ? ['AI-AGENT-TOOLKIT - PROGRAMME SWEEP','AI-AGENT-TOOLKIT - SHARD TIMINGS'] : ['AI-AGENT-TOOLKIT - FOOTER SWEEP']);
      assertLiveRegistry(replayHome, replay, replayRegistry);
    }
    assert.equal(result.items.some(i => i.first_run?.status === 'ok'), false, 'interruption cannot invent a completed first run');
    assert.ok(replayRegistry.readRegistry(replayHome).tasks.every(e => !e.stopped_by_owner));
  }
});

for (const task of ['programme-sweep','shard-timings']) for (const edit of ['action','trigger','settings']) test(`modified-task choice: ${task} ${edit} needs a scoped one-use answer`, t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), offer = switchOffer(t, 'programme-sweep', root);
  windowsTasks.applyTasks(offer, { home, scheduler });
  const live = scheduler.folders.get('TOOLKIT').find(l => l.name === windowsTasks.taskName('TOOLKIT', task));
  if (edit === 'action') live.arguments += ' --owner-edit';
  if (edit === 'trigger') live.triggers[0].start = '2026-11-05T10:30:00';
  if (edit === 'settings') live.settings = { start_when_available: false };
  const before = structuredClone([...scheduler.folders]);
  const plan = windowsTasks.planTasks(offer, { home, scheduler }), item = plan.items.find(i => i.action === 'owner-choice-required');
  assert.equal(item.choice.task, windowsTasks.taskId('TOOLKIT', task)); assert.ok(item.choice.changed.length); assert.ok(plan.next_step.includes('Keep your changes'));
  const answer = { task: item.choice.task, observed: item.choice.fingerprint, answer_ref: 'owner-message:keep-1', outcome: 'keep' };
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: answer }).refused, true); assert.deepEqual([...scheduler.folders], before);
  const recorded = tasks.readRegistry(home).tasks.find(e => e.id === answer.task);
  // The fingerprint already binds the exact observation. Repeating XML in every answer
  // grows the bounded registry without adding replay or ownership protection.
  assert.equal(recorded.task_choices[0].outcome, 'keep'); assert.equal(recorded.task_choices[0].observed, item.choice.fingerprint);
  assert.equal(Object.hasOwn(recorded.task_choices[0], 'definition'), false);
  assert.equal(recorded.task_choices[0].answer_ref, answer.answer_ref);
  assert.ok(Number.isFinite(Date.parse(recorded.task_choices[0].at)));
  assert.notDeepEqual(recorded.enrolled, windowsTasks.enrolledDefinition(live), 'keep never adopts edits');
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: { ...answer, outcome: 'replace' } }).refused, true);
  const replaced = windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: { ...answer, answer_ref: 'owner-message:replace-2', outcome: 'replace' } });
  assert.ok(replaced.items.every(i => i.done), JSON.stringify(replaced)); assertLiveRegistry(home, scheduler);
  scheduler.folders.get('TOOLKIT').find(l => l.name === live.name).arguments += ' --later-edit';
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: { ...answer, answer_ref: 'owner-message:replace-2', outcome: 'replace' } }).refused, true);
  assert.equal(windowsTasks.applyTasks(switchOffer(t, 'footer-sweep', root), { home, scheduler, taskChoice: { ...answer, answer_ref: 'owner-message:new', outcome: 'replace' } }).refused, true);
});

test('choice flags cannot supply a missing exact observation or actual answer reference; hostile and corrupt metadata refuse', t => {
  for (const args of [['--task-choice','replace'], ['--task-choice','keep','--task','toolkit-programme-sweep'], ['--observed','a'.repeat(64)], ['--task-choice','replace','--task','toolkit-programme-sweep','--observed','a'.repeat(64)]]) assert.throws(() => windowsTasks.parseArgs(['apply', ...args]), /choice needs/);
  for (const row of hostile.cases(['line-breaks','continued-lines','invisible','quoting','free-text'])) assert.throws(() => windowsTasks.parseArgs(['apply','--task-choice','replace','--task',row.text,'--observed','a'.repeat(64),'--answer-ref','owner-message:1']));
  const home = tempHome(t), scheduler = fakeScheduler(), offer = desired(t); windowsTasks.applyTasks(offer, { home, scheduler });
  tasks.updateRegistry(home, rows => rows.map(e => ({ ...e, replaces: { cleaner: { id: 'other', job: 'footer-sweep', identity: 'a'.repeat(64) } } })));
  const before = structuredClone([...scheduler.folders]);
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: { outcome: 'replace', task: 'toolkit-programme-sweep', observed: 'a'.repeat(64), answer_ref: 'agent:unsupported-claim' } }).refused, true);
  assert.deepEqual([...scheduler.folders], before);
});

for (const from of ['programme-sweep','footer-sweep']) for (const state of ['removed','disabled','stopped','running']) test(`whole switch: ${from} ${state} participant holds every effect`, t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), source = switchOffer(t, from, root); windowsTasks.applyTasks(source, { home, scheduler });
  for (const participant of tasks.readRegistry(home).tasks) {
    const saved = structuredClone([...scheduler.folders]), entries = tasks.readRegistry(home).tasks;
    if (state === 'removed') scheduler.folders.set('TOOLKIT', scheduler.folders.get('TOOLKIT').filter(l => l.name !== participant.name));
    if (state === 'disabled' || state === 'running') scheduler.folders.get('TOOLKIT').find(l => l.name === participant.name).state = state === 'disabled' ? 'Disabled' : 'Running';
    if (state === 'stopped') tasks.updateRegistry(home, rows => rows.map(e => e.id === participant.id ? { ...e, stopped_by_owner: true, stopped_at: '2026-11-05T00:00:00.000Z' } : e));
    const before = structuredClone([...scheduler.folders]); scheduler.calls.length = 0;
    const result = windowsTasks.applyTasks(switchOffer(t, from === 'programme-sweep' ? 'footer-sweep' : 'programme-sweep', root), { home, scheduler });
    assert.equal(result.refused, true, JSON.stringify(result)); assert.deepEqual([...scheduler.folders], before); assert.ok(scheduler.calls.every(c => c[0] === 'list'));
    scheduler.folders.clear(); for (const [f, rows] of saved) scheduler.folders.set(f, rows); tasks.writeRegistry(home, entries);
  }
});

test('Low 3/4: strict managed origin, changed-folder recovery and uncertain-plan next step', t => {
  const request = { checkout: 'C:\\Repositories\\widget', toolkitRoot: TOOLKIT_ROOT, home: MEMORY_HOME };
  const deps = { readFile: () => JSON.stringify({ repo_path: TOOLKIT_ROOT }), realpath: value => value, mainCheckout: value => value };
  for (const remote of ['git@my-github-mirror:weijunswj/ai-agent-toolkit.git','ssh://git@github.com/weijunswj/ai-agent-toolkit.git','https://github.com.evil.test/weijunswj/ai-agent-toolkit']) assert.throws(() => windowsTasks.readLocations(request, { ...deps, run: () => ({ status: 0, stdout: remote }) }), /expected Toolkit/);
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), initial = desired(t, { root }); windowsTasks.applyTasks(initial, { home, scheduler });
  const changed = desired(t, { root, folder: 'NEW' }); changed.folderOverride = null;
  const result = windowsTasks.applyTasks(changed, { home, scheduler }); assert.equal(result.refused, true); assert.match(result.next_step, /folder changed from TOOLKIT to NEW/);
  assert.match(windowsTasks.planTasks(desired(t, { root, state: 'ERROR' }), { home, scheduler }).next_step, /refresh governance status/i);
});

test('history: cursor-free main receipt is silent; an unenrolled old destination cannot widen the source window', t => {
  const home = tempHome(t), main = baseRun(t, home), at = new Date('2026-11-05T00:00:00Z'), expected = { id: main.id, job: main.job };
  const cursorFree = { ...main }; delete cursorFree.footer_sweep_since;
  assert.deepEqual(job.footerCursor(cursorFree, expected, 'weijunswj/ai-agent-toolkit', at), { since: '2026-11-03T00:00:00.000Z' });
  for (const record of [{}, { ...main, footer_sweep_since: 'bad' }, { ...main, footer_sweep_since: '2099-01-01T00:00:00.000Z' }, { ...main, repository: 'other/repository' }]) assert.ok(job.footerCursor(record, expected, 'weijunswj/ai-agent-toolkit', at).note);
  const root = checkout(t), scheduler = fakeScheduler(); windowsTasks.applyTasks(switchOffer(t, 'programme-sweep', root), { home, scheduler });
  tasks.writeLastRun('toolkit-footer-sweep', { ...main, id: 'toolkit-footer-sweep', job: 'footer-sweep', footer_sweep_since: '2026-09-01T00:00:00.000Z' }, home);
  const result = windowsTasks.applyTasks(switchOffer(t, 'footer-sweep', root), { home, scheduler, now: () => at }); assert.ok(result.items.every(i => i.done));
  assert.equal(tasks.readLastRun('toolkit-footer-sweep', home).footer_sweep_since, main.footer_sweep_since);
  assert.equal(tasks.readLastRun('toolkit-footer-sweep', home).status, undefined); assert.deepEqual(tasks.readLastRun('toolkit-programme-sweep', home), main);
});

test('Low 6: unrelated folders list once per invocation, affected mutation guards remain fresh', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler();
  for (let i = 0; i < 30; i++) scheduler.folders.set('OTHER-' + i, [unmarked('Other', { description: '[toolkit-task v1 id=other-' + i + ' def=0123456789ab]' })]);
  const offer = desired(t, { root }), started = performance.now();
  for (let repeat = 0; repeat < 2; repeat++) {
    scheduler.calls.length = 0; assert.ok(windowsTasks.applyTasks(offer, { home, scheduler }).items.every(i => i.done));
    for (let i = 0; i < 30; i++) assert.equal(scheduler.calls.filter(c => c[0] === 'list' && c[1] === 'OTHER-' + i).length, 1);
    assert.ok(scheduler.calls.filter(c => c[0] === 'list' && c[1] === 'TOOLKIT').length > 2);
  }
  const core = require('../scripts/setup-toolkit-core.cjs'); scheduler.calls.length = 0;
  core.printWindowsTasks({ repoRoot: TOOLKIT_ROOT }, { platform: 'win32', scheduler, home, workingFolder: root,
    checkoutDeps: { identityReader, reportCheckout: r => r, governance: governance() }, log() {} });
  for (let i = 0; i < 30; i++) assert.equal(scheduler.calls.filter(c => c[0] === 'list' && c[1] === 'OTHER-' + i).length, 1, 'setup shares unrelated discovery across reports');
  t.diagnostic('fake scheduler two-apply time: ' + (performance.now() - started).toFixed(1) + ' ms; real PowerShell timing is unverified');
});

test('closure stale enabled preserves main registration eligibility, but never authorises a shape switch', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler();
  const gov = governance(), old = gov.governanceState, observe = gov.readObservation;
  gov.governanceState = () => ({ ...old(), merged: { status: 'enabled', fresh: false } });
  gov.readObservation = () => ({ ...observe(), fresh: false });
  const offer = windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, home, deps: { identityReader, governance: gov } });
  assert.ok(windowsTasks.applyTasks(offer, { home, scheduler }).items.every(i => i.done)); assertLiveRegistry(home, scheduler);
  const other = tempHome(t), source = fakeScheduler(); windowsTasks.applyTasks(switchOffer(t, 'footer-sweep', root), { home: other, scheduler: source });
  const before = structuredClone([...source.folders]);
  assert.equal(windowsTasks.applyTasks(offer, { home: other, scheduler: source }).refused, true); assert.deepEqual([...source.folders], before);
});

test('closure matrix: intact P with never-enrolled S creates S or switches OFF without inventing a stop', t => {
  for (const next of ['programme-sweep','footer-sweep']) {
    const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), on = switchOffer(t, 'programme-sweep', root);
    windowsTasks.applyTasks(on, { home, scheduler }); baseRun(t, home);
    // A historical P-only enrolment has no missing S enrolment, so it is not an owner stop.
    scheduler.folders.set('TOOLKIT', scheduler.folders.get('TOOLKIT').filter(l => !l.name.endsWith('SHARD TIMINGS')));
    tasks.updateRegistry(home, rows => rows.filter(e => e.job !== 'shard-timings'));
    const result = windowsTasks.applyTasks(switchOffer(t, next, root), { home, scheduler });
    assert.ok(result.items.every(i => i.done), JSON.stringify(result)); assertLiveRegistry(home, scheduler);
    assert.deepEqual(tasks.readRegistry(home).tasks.map(e => e.job).sort(), next === 'programme-sweep' ? ['programme-sweep','shard-timings'] : ['footer-sweep']);
    if (next === 'programme-sweep') assert.equal(result.items.find(i => i.definition.job === 'shard-timings').action, 'create');
  }
});

test('modified-task answer is bound to governance revision even when binding and native definition are identical', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), gov = governance(); let revision = 'a'.repeat(40);
  const status = gov.governanceState, observation = gov.readObservation;
  gov.governanceState = () => { const s = status(); return { ...s, merged: { ...s.merged, commit: revision } }; };
  gov.readObservation = () => ({ ...observation(), commit: revision });
  const offer = () => windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, home, deps: { identityReader, governance: gov } });
  windowsTasks.applyTasks(offer(), { home, scheduler }); scheduler.folders.get('TOOLKIT')[0].arguments += ' --owner-edit';
  const choice = windowsTasks.planTasks(offer(), { home, scheduler }).items.find(i => i.choice).choice;
  const before = structuredClone([...scheduler.folders]); revision = 'b'.repeat(40);
  assert.equal(windowsTasks.applyTasks(offer(), { home, scheduler, taskChoice: { outcome: 'replace', task: choice.task, observed: choice.fingerprint, answer_ref: 'owner-message:previous-revision' } }).refused, true);
  assert.deepEqual([...scheduler.folders], before);
});

test('interrupted proven pair follows a new governance decision and preserves newly observed owner edits/stops', t => {
  for (const from of ['programme-sweep','footer-sweep']) {
    const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), first = switchOffer(t, from, root);
    windowsTasks.applyTasks(first, { home, scheduler });
    let snap;
    const registry = { ...tasks, updateRegistry(...args) {
      const result = tasks.updateRegistry(...args), entries = tasks.readRegistry(home).tasks;
      if (!snap && entries.filter(e => ['programme-sweep','footer-sweep'].includes(e.job)).length === 2) snap = { entries, live: Object.fromEntries(structuredClone([...scheduler.folders])) };
      return result;
    } };
    windowsTasks.applyTasks(switchOffer(t, from === 'programme-sweep' ? 'footer-sweep' : 'programme-sweep', root), { home, scheduler, registry });
    assert.ok(snap);
    for (const stop of [false, true]) {
      const replayHome = tempHome(t), replay = fakeScheduler(snap.live); tasks.writeRegistry(replayHome, snap.entries);
    copyComputerIdentity(home, replayHome);
      if (stop) replay.folders.get('TOOLKIT')[0].state = 'Disabled';
      const before = structuredClone([...replay.folders]);
      const result = windowsTasks.applyTasks(first, { home: replayHome, scheduler: replay });
      if (stop) { assert.equal(result.refused, true); assert.deepEqual([...replay.folders], before); }
      else { assert.ok(result.items.every(i => i.done), JSON.stringify(result)); assertLiveRegistry(replayHome, replay); assert.deepEqual(tasks.readRegistry(replayHome).tasks.map(e => e.job).sort(), from === 'programme-sweep' ? ['programme-sweep','shard-timings'] : ['footer-sweep']); }
    }
  }
});

test('retirement-only restart never starts the retired source or invents destination first-run verification', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), source = switchOffer(t, 'programme-sweep', root);
  windowsTasks.applyTasks(source, { home, scheduler }); let pair;
  const registry = { ...tasks, updateRegistry(...args) {
    const result = tasks.updateRegistry(...args), entries = tasks.readRegistry(home).tasks;
    if (!pair && entries.some(e => e.job === 'footer-sweep')) pair = { entries, live: Object.fromEntries(structuredClone([...scheduler.folders])) };
    return result;
  } };
  const off = switchOffer(t, 'footer-sweep', root); windowsTasks.applyTasks(off, { home, scheduler, registry }); assert.ok(pair);
  const replayHome = tempHome(t), replay = fakeScheduler(pair.live); tasks.writeRegistry(replayHome, pair.entries);
    copyComputerIdentity(home, replayHome);
  const result = windowsTasks.applyTasks(off, { home: replayHome, scheduler: replay, firstRunOptions: { wait() {}, waitMs: 0, pollMs: 1 } });
  assert.ok(result.items.every(i => i.done)); assertLiveRegistry(replayHome, replay);
  assert.equal(replay.calls.some(c => c[0] === 'start'), false);
  assert.equal(result.items.some(i => i.first_run), false);
});

test('footer lock defers with no effects and is released before a racing destination first run', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(); windowsTasks.applyTasks(switchOffer(t, 'footer-sweep', root), { home, scheduler });
  const offer = switchOffer(t, 'programme-sweep', root), before = structuredClone([...scheduler.folders]); let count = 0;
  const held = windowsTasks.applyTasks(offer, { home, scheduler, takeLock: () => ++count === 1 ? { release() {} } : null });
  assert.equal(held.refused, true); assert.match(held.next_step, /retry apply/); assert.deepEqual([...scheduler.folders], before);
  let footerHeld = false;
  scheduler.onStart = task => { assert.equal(footerHeld, false); task.last_run = new Date().toISOString(); task.state = 'Running'; };
  const result = windowsTasks.applyTasks(offer, { home, scheduler, takeLock: file => { if (file.includes('footer-')) footerHeld = true; return { release() { if (file.includes('footer-')) footerHeld = false; } }; }, firstRunOptions: { wait() {}, waitMs: 0, pollMs: 1 } });
  assert.equal(result.items.find(i => i.first_run).first_run.status, 'still running'); assertLiveRegistry(home, scheduler);
});

test('multiple modified governance tasks require distinct answers for each exact task', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), offer = desired(t); windowsTasks.applyTasks(offer, { home, scheduler });
  scheduler.folders.get('TOOLKIT').forEach(l => { l.arguments += ' --owner-edit'; });
  const plan = windowsTasks.planTasks(offer, { home, scheduler });
  const answers = plan.items.map((i, index) => ({ task: i.definition.id, observed: i.choice.fingerprint, outcome: 'replace', answer_ref: `owner-message:${index}` }));
  const before = structuredClone([...scheduler.folders]);
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: answers[0] }).refused, true); assert.deepEqual([...scheduler.folders], before);
  const args = ['apply', ...answers.flatMap(a => ['--task-choice',a.outcome,'--task',a.task,'--observed',a.observed,'--answer-ref',a.answer_ref])];
  assert.deepEqual(windowsTasks.parseArgs(args).taskChoices, answers);
  assert.ok(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: answers }).items.every(i => i.done)); assertLiveRegistry(home, scheduler);
  assert.equal(windowsTasks.applyTasks(offer, { home, scheduler, taskChoice: answers }).refused, true, 'unused/reused answers refuse even when definitions are current');
});

test('answered modified P/S switch retires both without owner stops and retains the consumed answer references', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(); windowsTasks.applyTasks(switchOffer(t, 'programme-sweep', root), { home, scheduler });
  scheduler.folders.get('TOOLKIT').forEach(l => { l.arguments += ' --owner-edit'; });
  const off = switchOffer(t, 'footer-sweep', root), plan = windowsTasks.planTasks(off, { home, scheduler });
  const answers = plan.items.filter(i => i.choice).map((i, index) => ({ task: i.definition.id, observed: i.choice.fingerprint, outcome: 'replace', answer_ref: `owner-message:switch-${index}` }));
  assert.equal(answers.length, 2);
  const result = windowsTasks.applyTasks(off, { home, scheduler, taskChoice: answers });
  assert.ok(result.items.every(i => i.done), JSON.stringify(result)); assertLiveRegistry(home, scheduler);
  const entries = tasks.readRegistry(home).tasks; assert.equal(entries.length, 1); assert.equal(entries[0].job, 'footer-sweep');
  assert.deepEqual(entries[0].task_choices.map(c => c.answer_ref).sort(), answers.map(a => a.answer_ref).sort());
  assert.equal(windowsTasks.applyTasks(off, { home, scheduler, taskChoice: answers }).refused, true);
});

test('history interruption keeps the real source receipt and replaces an unenrolled damaged destination', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), source = switchOffer(t, 'programme-sweep', root);
  windowsTasks.applyTasks(source, { home, scheduler }); const receipt = baseRun(t, home);
  const offer = switchOffer(t, 'footer-sweep', root);
  assert.throws(() => windowsTasks.applyTasks(offer, { home, scheduler, writeRecord(id) { tasks.writeLastRun(id, {}, home); throw new Error('interrupted history write'); } }), /interrupted history/);
  assert.deepEqual(tasks.readLastRun(receipt.id, home), receipt); assert.equal(scheduler.list('TOOLKIT').length, 2);
  const result = windowsTasks.applyTasks(offer, { home, scheduler, now: () => new Date('2026-11-05T00:00:00Z') });
  assert.ok(result.items.every(i => i.done)); assert.deepEqual(result.history_notes, []);
  assert.equal(tasks.readLastRun('toolkit-footer-sweep', home).footer_sweep_since, receipt.footer_sweep_since);
});

for (const change of ['origin','binding folder','checkout','Toolkit location','native definition']) test(`switch guard rechecks ${change} between preview and locked effect`, t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), source = switchOffer(t, 'programme-sweep', root);
  windowsTasks.applyTasks(source, { home, scheduler });
  const offer = switchOffer(t, 'footer-sweep', root), before = structuredClone([...scheduler.folders]);
  const gov = offer.checkoutDeps.governance, originalObservation = gov.readObservation;
  let locks = 0, result, failure; scheduler.calls.length = 0;
  try { result = windowsTasks.applyTasks(offer, { home, scheduler, takeLock() {
    if (++locks === 1) {
      if (change === 'origin') gov.readIdentity = root => ({ valid: true, root, remote: { host: 'github.com', path: '/other/repository.git' } });
      if (change === 'binding folder') gov.readObservation = () => ({ ...originalObservation(), binding: fixtureBinding(undefined, 'OTHER', false) });
      if (change === 'checkout' || change === 'Toolkit location') tasks.updateRegistry(home, rows => rows.map(e => ({ ...e, [change === 'checkout' ? 'checkout' : 'toolkit_root']: 'C:\\Moved\\checkout' })));
      if (change === 'native definition') scheduler.folders.get('TOOLKIT')[0].arguments += ' --concurrent-owner-edit';
    }
    return { release() {} };
  } }); } catch (error) { failure = error; }
  if (failure) { assert.equal(change, 'origin'); assert.match(failure.message, /origin identity and merged binding/); }
  else assert.equal(result.refused, true);
  assert.ok(scheduler.calls.every(c => c[0] === 'list'));
  if (change !== 'native definition') assert.deepEqual([...scheduler.folders], before);
  else assert.equal(scheduler.list('TOOLKIT').filter(l => /FOOTER/.test(l.name)).length, 0);
});

test('repository removal: shared folder preserves repository B definitions and registry entries byte for byte', t => {
  const home = tempHome(t), a = checkout(t), b = checkout(t), scheduler = fakeScheduler(), scope = desired(t, { root: a }); windowsTasks.applyTasks(scope, { home, scheduler });
  const foreign = tasks.readRegistry(home).tasks.map((e, index) => ({ ...e, id: e.id.replace('toolkit-', 'other-'), name: e.name.replace('TOOLKIT -', 'OTHER -'), repository: 'example/other', checkout: b }));
  tasks.writeRegistry(home, [...tasks.readRegistry(home).tasks, ...foreign]); for (const e of foreign) scheduler.folders.get('TOOLKIT').push(unmarked(e.name));
  const before = structuredClone(scheduler.folders.get('TOOLKIT').filter(l => l.name.startsWith('OTHER')));
  assert.equal(windowsTasks.removeTasks({ scope, home, scheduler }).items.length, 2);
  assert.deepEqual(tasks.readRegistry(home).tasks.filter(e => e.id.startsWith('other-')), foreign);
  assert.deepEqual(scheduler.folders.get('TOOLKIT').filter(l => l.name.startsWith('OTHER')), before);
  assert.throws(() => windowsTasks.removeTasks({ home, scheduler }), /verified repository main checkout/);
});

for (const kind of ['no checkout', 'legacy', 'moved checkout']) for (const caller of ['remove','setup'])
test(`repository removal: ${kind} through ${caller}, off-governance reset and foreign bytes`, async t => {
  const w = switchWorld(t); await w.gov('on'); assert.equal(w.cli('apply').code, 0);
  const foreign = { ...tasks.readRegistry(w.home).tasks[0], id: 'other-programme-sweep', name: 'OTHER - PROGRAMME SWEEP', repository: 'example/other' };
  const foreignLive = { ...w.scheduler.list('AI-AGENT-TOOLKIT')[0], name: foreign.name, description: '[toolkit-task v1 id=other-programme-sweep def=0123456789ab]' };
  w.scheduler.folders.get(foreign.folder).push(foreignLive);
  tasks.updateRegistry(w.home, list => [...list.map(entry => {
    if (kind === 'moved checkout') return { ...entry, checkout: 'C:\\Old\\widget' };
    const next = { ...entry }; delete next.checkout;
    if (kind === 'legacy') { delete next.enrolled; delete next.toolkit_root; }
    return next;
  }), foreign]);
  const bytes = JSON.stringify(foreign), liveBytes = JSON.stringify(foreignLive);
  let code;
  if (caller === 'remove') code = w.cli('remove').code;
  else {
    const core = require('../scripts/setup-toolkit-core.cjs'), offer = w.offer();
    code = await core.main(['--remove-toolkit-tasks'], { platform: 'win32', windowsTasksDeps: { platform: 'win32', scheduler: w.scheduler, home: w.home,
      cwd: w.root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, checkoutDeps: offer.checkoutDeps, stdout() {}, stderr() {} } });
  }
  assert.equal(code, 0);
  assert.equal(JSON.stringify(tasks.readRegistry(w.home).tasks.find(e => e.id === foreign.id)), bytes);
  assert.equal(JSON.stringify(w.scheduler.list(foreign.folder).find(l => l.name === foreign.name)), liveBytes);
  assert.ok(tasks.readRegistry(w.home).tasks.filter(e => e.id !== foreign.id).every(e => e.stopped_by_owner));
  assert.deepEqual(w.scheduler.list(foreign.folder).map(l => l.name), [foreign.name]);
  // Isolate the recovery proof after establishing the foreign bytes are untouched by removal.
  tasks.updateRegistry(w.home, list => list.filter(e => e.id !== foreign.id));
  w.scheduler.folders.get(foreign.folder).splice(0, 1);
  await w.gov('off'); assert.equal(w.cli('apply').code, 1);
  // Approved removal proved absence; explicit repair can now reconcile old paths.
  // Ordinary apply above still holds, including the moved-checkout case.
  printedRecovery(w); assertShape(w, 'off');
});

test('removal: empty repository scope says nothing about other repositories; managed-copy hint executes', t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), offer = desired(t, { root });
  windowsTasks.applyTasks(offer, { home, scheduler });
  let out = '';
  const deps = { platform: 'win32', scheduler, home, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE,
    checkoutDeps: { identityReader, governance: governance({ repository: 'example/empty' }) }, stdout: text => { out += text; }, stderr: text => { out += text; } };
  assert.equal(windowsTasks.main(['remove','--repo-root',root], deps), 0);
  assert.match(out, /No Toolkit tasks match this repository; other repositories are unchanged/);
  assert.doesNotMatch(out, /No Toolkit tasks are recorded on this computer/);
  assert.equal(scheduler.list('TOOLKIT').length, 2);
  const request = { checkout: root, toolkitRoot: 'C:\\Copy\\toolkit', home };
  let error;
  try { windowsTasks.readLocations(request, { readFile: () => JSON.stringify({ repo_path: TOOLKIT_ROOT }), mainCheckout: x => x, realpath: x => x }); }
  catch (caught) { error = caught; }
  assert.equal(error.managedCheckout, TOOLKIT_ROOT); assert.equal(error.primaryCheckout, root);
  out = '';
  assert.equal(windowsTasks.main(['remove','--repo-root',root], { ...deps, toolkitRoot: request.toolkitRoot,
    checkoutDeps: { identityReader: () => { throw error; } } }), 1);
  const match = /Use node "([^"\n]+)" remove --repo-root "([^"\n]+)"/.exec(out); assert.ok(match, out);
  assert.equal(match[1], TOOLKIT_ROOT + '\\repo\\scripts\\toolkit-windows-tasks.cjs'); assert.equal(match[2], root);
  assert.equal(windowsTasks.main(['remove','--repo-root',match[2]], { ...deps, checkoutDeps: offer.checkoutDeps }), 0);
  assert.equal(scheduler.list('TOOLKIT').length, 0);
});

test('switch metadata: one relationship, reordered and conflicting records, metadata-only reversal, then printed recovery', async t => {
  const w = switchWorld(t); await w.gov('off'); assert.equal(w.cli('apply').code, 0); await w.gov('on');
  const register = w.scheduler.unregister; let fired = false;
  w.scheduler.unregister = () => { fired = true; throw new Error('retain intact pair'); };
  assert.equal(w.cli('apply').code, 1); w.scheduler.unregister = register; assert.equal(fired, true);
  const pair = tasks.readRegistry(w.home).tasks, live = structuredClone([...w.scheduler.folders]);
  assert.equal(pair.filter(e => e.replaces).length, 1);
  for (const kind of ['reverse','reordered','duplicate','exhausted','shard proof']) {
    w.scheduler.folders.clear(); for (const [f, rows] of structuredClone(live)) w.scheduler.folders.set(f, rows);
    tasks.writeRegistry(w.home, pair);
    if (kind === 'reordered') tasks.updateRegistry(w.home, list => list.reverse());
    if (kind === 'duplicate') tasks.updateRegistry(w.home, list => list.map(e => ({ ...e, replaces: { cleaner: new windowsTasks.WindowsTaskOwner({}).proof(list.find(p => p.id !== e.id)) } })));
    if (kind === 'exhausted') tasks.updateRegistry(w.home, list => list.map(e => e.replaces ? { ...e, replaces: { cleaner: { ...e.replaces.cleaner, identity: 'a'.repeat(64) } } } : e));
    if (kind === 'shard proof') tasks.updateRegistry(w.home, list => list.map(e => e.replaces ? { ...e, replaces: { ...e.replaces, shard: { id: 'ai-agent-toolkit-shard-timings', job: 'shard-timings', identity: 'b'.repeat(64) } } } : e));
    await w.gov(kind === 'reverse' ? 'off' : 'on');
    w.scheduler.calls.length = 0;
    const result = w.cli('apply');
    if (['duplicate','exhausted','shard proof'].includes(kind)) {
      assert.equal(result.code, 1); assert.ok(w.scheduler.calls.every(c => c[0] === 'list'));
      printedRecovery(w); assertShape(w, 'on');
    } else {
      assert.equal(result.code, 0); assertShape(w, kind === 'reverse' ? 'off' : 'on');
      assert.ok(!w.scheduler.calls.some(c => c[0] === 'register' && /SWEEP$/.test(c[2])), 'relationship movement never re-registers an unchanged cleaner');
    }
  }
});

for (const participant of ['programme-sweep','footer-sweep','shard-timings']) test(`unproven deletion: ${participant} never implies retirement; repair and reset are printed routes`, async t => {
  const w = switchWorld(t); await w.gov(participant === 'footer-sweep' ? 'off' : 'on'); assert.equal(w.cli('apply').code, 0);
  const entries = tasks.readRegistry(w.home).tasks, live = structuredClone([...w.scheduler.folders]);
  for (const reset of [false,true]) {
    tasks.writeRegistry(w.home, entries); w.scheduler.folders.clear(); for (const [f, rows] of structuredClone(live)) w.scheduler.folders.set(f, rows);
    const entry = entries.find(e => e.job === participant);
    w.scheduler.folders.set(entry.folder, w.scheduler.folders.get(entry.folder).filter(l => l.name !== entry.name));
    await w.gov(participant === 'footer-sweep' ? 'on' : 'off');
    const before = fs.readFileSync(tasks.registryPath(w.home)); const result = w.cli('apply');
    assert.equal(result.code, 1); assert.match(result.json.next_step, /unproven absence/);
    assert.doesNotMatch(result.json.next_step, /stopped by owner/); assert.deepEqual(fs.readFileSync(tasks.registryPath(w.home)), before);
    printedRecovery(w, reset); assertShape(w, participant === 'footer-sweep' ? 'on' : 'off');
  }
});

test('history carry-over: old inactive 720-hour records and absent destinations do not widen a one-hour main receipt; active retries keep the earlier window', async t => {
  const w = switchWorld(t); await w.gov('on'); assert.equal(w.cli('apply').code, 0);
  const receipt = currentMainReceipt(w.home, w.root, w.now().toISOString(), 'ai-agent-toolkit-programme-sweep');
  w.advance(1/24);
  const off = () => w.offer().definitions.find(d => d.job === 'footer-sweep');
  const stale = new Date(w.now().getTime() - 720 * 3600000).toISOString();
  tasks.writeLastRun(off().id, { ...receipt, id: off().id, job: 'footer-sweep', footer_sweep_since: stale }, w.home);
  await w.gov('off'); assert.equal(w.cli('apply','--no-first-run').code, 0);
  assert.equal(tasks.readLastRun(off().id, w.home).footer_sweep_since, receipt.footer_sweep_since);
  assert.deepEqual(tasks.readLastRun(receipt.id, w.home), receipt, 'source history retained');
  await w.gov('on'); assert.equal(w.cli('apply','--no-first-run').code, 0);
  const missing = tasks.lastRunPath(off().id, w.home); fs.unlinkSync(missing);
  await w.gov('off'); assert.equal(w.cli('apply','--no-first-run').code, 0);
  assert.equal(tasks.readLastRun(off().id, w.home).footer_sweep_since, receipt.footer_sweep_since, 'no destination does not add a 48-hour fallback');
  await w.gov('on'); assert.equal(w.cli('apply','--no-first-run').code, 0);
  await w.gov('off'); const unregister = w.scheduler.unregister; let fired = false;
  w.scheduler.unregister = () => { fired = true; throw new Error('retain active destination retry'); };
  assert.equal(w.cli('apply').code, 1); w.scheduler.unregister = unregister; assert.equal(fired, true);
  tasks.writeLastRun(off().id, { ...receipt, id: off().id, job: 'footer-sweep', footer_sweep_since: stale }, w.home);
  assert.equal(w.cli('apply','--no-first-run').code, 0);
  assert.equal(tasks.readLastRun(off().id, w.home).footer_sweep_since, stale, 'an enrolled destination still has a pending retry window');
  assertShape(w, 'off');
});

test('native acknowledgement: already absent between guard and unregister cannot establish retirement', async t => {
  const w = switchWorld(t); await w.gov('off'); assert.equal(w.cli('apply').code, 0); await w.gov('on');
  const unregister = w.scheduler.unregister; let fired = false;
  w.scheduler.unregister = (folder, name, id, previous) => {
    fired = true; w.scheduler.folders.set(folder, w.scheduler.folders.get(folder).filter(l => l.name !== name));
    return unregister(folder, name, id, previous);
  };
  const result = w.cli('apply'); w.scheduler.unregister = unregister;
  assert.equal(fired, true); assert.equal(result.code, 1); assert.match(result.json.items.find(i => !i.done).error, /not acknowledged/);
  assert.ok(tasks.readRegistry(w.home).tasks.some(e => e.job === 'footer-sweep'));
  assert.ok(tasks.readRegistry(w.home).tasks.every(e => !e.stopped_by_owner));
  const held = w.cli('apply'); assert.equal(held.code, 1); assert.match(held.json.next_step, /unproven absence/);
  printedRecovery(w); assertShape(w, 'on');
});

test('completion: a newly appearing unrecorded SHARD TIMINGS prevents off success and prints exact native recovery', async t => {
  const w = switchWorld(t); await w.gov('on'); assert.equal(w.cli('apply').code, 0);
  const orphan = w.scheduler.list('AI-AGENT-TOOLKIT').find(l => /SHARD TIMINGS$/.test(l.name));
  await w.gov('off'); const info = w.scheduler.info; let fired = false;
  w.scheduler.info = (...args) => { const out = info(...args); if (!fired) { fired = true; w.scheduler.folders.get('AI-AGENT-TOOLKIT').push(orphan); } return out; };
  const result = w.cli('apply'); w.scheduler.info = info;
  assert.equal(fired, true); assert.equal(result.code, 1); assert.match(result.json.next_step, /Final shape verification held/);
  printedRecovery(w); assertShape(w, 'off');
});

test('plan text: earlier Keep, named answer flags, honest off/absent coverage and exact approved folder recovery', async t => {
  const w = switchWorld(t); await w.gov('on'); assert.equal(w.cli('apply').code, 0);
  w.scheduler.folders.get('AI-AGENT-TOOLKIT')[0].triggers[0].start = '2026-11-05T10:30:00';
  const item = w.cli('plan').json.items.find(i => i.choice);
  assert.equal(w.cli('apply','--task-choice','keep','--task',item.choice.task,'--observed',item.choice.fingerprint,'--answer-ref','owner:keep').code, 1);
  const plan = w.cli('plan').json, text = windowsTasks.describePlan(plan).join(' ');
  assert.match(text, /Earlier owner answer: keep; reference: owner:keep/);
  assert.match(text, /--task-choice keep\|replace --task .* --observed .* --answer-ref/);
  const replace = plan.items.find(i => i.choice);
  assert.equal(w.cli('apply','--task-choice','replace','--task',replace.choice.task,'--observed',replace.choice.fingerprint,'--answer-ref','owner:replace').code, 0);
  for (const state of ['off','absent']) {
    await w.gov(state); assert.equal(w.cli('apply').code, 0);
    assert.doesNotMatch(windowsTasks.describePlan(w.cli('plan').json).join(' '), /Programme refresh coverage is missing/);
  }
  await w.gov('on', { folder: 'NEW' });
  const held = w.cli('plan').json;
  assert.match(held.next_step, /with explicit approval to keep the recorded folder, run node .* --folder AI-AGENT-TOOLKIT/);
  const match = /apply --repo-root "([^"\n]+)" --folder ([A-Z0-9-]+)/.exec(held.next_step); assert.ok(match);
  assert.equal(match[1], w.root);
  const recovered = w.cli('apply','--folder',match[2]);
  assert.equal(recovered.code, 0, JSON.stringify(recovered)); assertShape(w, 'on');
  assert.equal(recovered.json.approval, 'explicit approval required');

});

for (const participant of ['programme-sweep','footer-sweep','shard-timings']) test(`edited recovery: ${participant} cannot use repair to answer a choice; printed reset works`, async t => {
  const w = switchWorld(t); await w.gov(participant === 'footer-sweep' ? 'off' : 'on'); assert.equal(w.cli('apply').code, 0);
  const live = w.scheduler.folders.get('AI-AGENT-TOOLKIT').find(l => l.name === windowsTasks.taskName('AI-AGENT-TOOLKIT', participant));
  live.arguments += ' --owner-edit';
  if (participant !== 'footer-sweep') live.state = 'Disabled';
  await w.gov(participant === 'footer-sweep' ? 'on' : 'off');
  const before = JSON.stringify([...w.scheduler.folders]), entries = fs.readFileSync(tasks.registryPath(w.home));
  assert.equal(w.cli('apply','--repair-owned').code, 1);
  assert.equal(JSON.stringify([...w.scheduler.folders]), before); assert.deepEqual(fs.readFileSync(tasks.registryPath(w.home)), entries);
  printedRecovery(w, true); assertShape(w, participant === 'footer-sweep' ? 'on' : 'off');
});

test('metadata recovery: unsupported relationship on retained S clears before creating a missing cleaner', async t => {
  const w = switchWorld(t); await w.gov('on'); assert.equal(w.cli('apply').code, 0);
  const entries = tasks.readRegistry(w.home).tasks, cleaner = entries.find(e => e.job === 'programme-sweep'), shard = entries.find(e => e.job === 'shard-timings');
  // A retained candidate-only unsupported row is never silently accepted by ordinary apply.
  tasks.writeRegistry(w.home, [{ ...shard, replaces: { cleaner: new windowsTasks.WindowsTaskOwner({}).proof(cleaner) } }]);
  w.scheduler.folders.set(shard.folder, w.scheduler.folders.get(shard.folder).filter(l => l.name === shard.name));
  assert.equal(w.cli('apply').code, 1);
  printedRecovery(w); assertShape(w, 'on');
});

test('identity collision control: native XML varies within one day without leaving stale relationships', async t => {
  const w = switchWorld(t), register = w.scheduler.register; let writes = 0;
  w.scheduler.register = (d, previous) => {
    const result = register(d, previous);
    w.scheduler.folders.get(d.folder).find(l => l.name === d.name).definition_xml = `<Task fixture="${++writes}"/>`;
    return result;
  };
  const day = w.now().toISOString().slice(0,10);
  for (const state of ['off','on','off','on']) {
    await w.gov(state); assert.equal(w.cli('apply').code, 0); assertShape(w, state);
  }
  assert.ok(writes >= 6); assert.equal(w.now().toISOString().slice(0,10), day);
});

for (const point of ['write','readback']) for (const side of ['before','after']) test(`backup interruption: ${point} ${side} retains native definitions and retries`, t => {
  const home = tempHome(t), root = checkout(t), scheduler = fakeScheduler(), initial = desired(t, { root });
  windowsTasks.applyTasks(initial, { home, scheduler });
  const offer = desired(t, { root, nodePath: 'C:\\New\\node.exe' }), live = structuredClone([...scheduler.folders]), entries = tasks.readRegistry(home).tasks;
  let fired = false;
  const key = point === 'write' ? 'writeFileSync' : 'readFileSync', original = fs[key];
  const mock = t.mock.method(fs, key, (...args) => {
    const matches = /definition-[0-9a-f]+\.json$/.test(String(args[0]));
    if (matches && !fired && side === 'before') { fired = true; throw new Error('injected backup interruption'); }
    const result = original(...args);
    if (matches && !fired && side === 'after') { fired = true; throw new Error('injected backup interruption'); }
    return result;
  });
  const result = windowsTasks.applyTasks(offer, { home, scheduler }); mock.mock.restore();
  assert.equal(fired, true); assert.ok(result.items.every(i => !i.done));
  assert.deepEqual([...scheduler.folders], live); assert.deepEqual(tasks.readRegistry(home).tasks, entries);
  assert.ok(windowsTasks.applyTasks(offer, { home, scheduler }).items.every(i => i.done)); assertLiveRegistry(home, scheduler);
});

// Disposable-folder qualification, gated by separate owner permission. The installed candidate
// runner executes repeatedly with fake processes and an isolated home; no real GitHub route exists.
test('real Task Scheduler: disposable repeated cleaner qualification', { skip: process.platform !== 'win32' || process.env.TOOLKIT_REAL_TASK_SCHEDULER_TEST !== '1' ? 'requires owner approval for disposable scheduler mutations' : false }, t => {
  const scheduler = windowsTasks.powerShellScheduler();
  const folder = `TOOLKIT-TEST-${process.pid}`;
  assert.deepEqual(scheduler.list(folder), [], 'never enter an occupied qualification folder');
  const snapshot = name => scheduler.list(name).map(row => ({ name: row.name, definition: windowsTasks.enrolledDefinition(row) }));
  const before = new Map([null, ...scheduler.markedFolders()].map(name => [name, snapshot(name)]));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-qualification-home-')), root = checkout(t, { shards: false });
  const runner = path.join(root, 'qualified-job.cjs');
  const repository = `qualification/cleaner-${process.pid}`;
  const knownDefinitions = new Map();
  let qualificationComplete = false;
  const binding = fixtureBinding(repository, folder);
  const events = path.join(home, 'events.jsonl');
  const failureFile = path.join(home, 'fail-footer');
  const pauseFile = path.join(home, 'pause-runner');
  const clockFile = path.join(home, 'clock'); fs.writeFileSync(clockFile, String(Date.now()));
  fs.writeFileSync(runner, `const fs=require('node:fs');const j=require(${JSON.stringify(path.join(ROOT, 'repo/scripts/toolkit-scheduled-job.cjs'))});
const options=j.parseArgs(process.argv.slice(2));
while(fs.existsSync(${JSON.stringify(pauseFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
const now=()=>{const value=Math.max(Date.now(),Number(fs.readFileSync(${JSON.stringify(clockFile)},'utf8'))+1);fs.writeFileSync(${JSON.stringify(clockFile)},String(value));return new Date(value);};
const record=j.runJob(options,{home:${JSON.stringify(home)},ghPath:'fake-gh',nodePath:process.execPath,
repositoryReader:root=>root===${JSON.stringify(root)} && fs.existsSync(root),
readIdentity:root=>root===${JSON.stringify(root)}?({valid:true,root,remote:{host:'github.com',path:${JSON.stringify('/' + repository + '.git')}}}):null,
readObservation:()=>({status:'enabled',fresh:true,binding:${JSON.stringify(binding)}}),now,
run:(file,args)=>{now();fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({id:options.taskId,args})+'\\n');
if(args[0]===j.SCRIPT.footerSweep && fs.existsSync(${JSON.stringify(failureFile)}))return {status:1,stdout:'{"results":[{"status":"MISMATCH"}]}'};
if(args[0]===j.SCRIPT.governance)return ${JSON.stringify(GOVERNED)};if(args[1]==='attention')return ${JSON.stringify(ATTENTION)};return {status:0,stdout:'',stderr:''};}});process.exitCode=record.exit;`);
  const realGovernance = require('../scripts/toolkit-governance-state.cjs');
  const location = request => { assert.equal(request.checkout, root); assert.equal(request.toolkitRoot, ROOT); return request; };
  const desiredFor = mode => {
    const gov = governance({ state: mode === 'programme-sweep' ? 'ENABLED' : 'UNDECIDED', repository, folder });
    const read = gov.readIdentity;
    gov.readIdentity = target => target === root ? read(target) : realGovernance.readIdentity(target);
    const desired = windowsTasks.desiredTasks({ checkout: root, folder, toolkitRoot: ROOT, nodePath: process.execPath, home,
      deps: { identityReader: location, governance: gov } });
    for (const d of desired.definitions) {
      const digest = d.def;
      d.arguments = `--headless "${process.execPath}" "${runner}" ${d.job} --repo-root "${root}" --task-id ${d.id}`;
      d.def = windowsTasks.definitionDigest(d); d.description = d.description.replace(digest, d.def);
      knownDefinitions.set(d.id, d);
    }
    return desired;
  };
  const native = (verb, name) => {
    assert.ok(['Disable-ScheduledTask', 'Stop-ScheduledTask', 'Unregister-ScheduledTask'].includes(verb));
    assert.ok(name.startsWith(`${folder} - `));
    const script = `$p=$env:TOOLKIT_QUALIFY_TASK | ConvertFrom-Json; ${verb} -TaskPath ('\\'+$p.folder+'\\') -TaskName $p.name ${verb === 'Unregister-ScheduledTask' ? '-Confirm:$false ' : ''}-ErrorAction Stop | Out-Null`;
    const result = require('node:child_process').spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], { timeout: 30000, windowsHide: true, encoding: 'utf8', env: { ...process.env, TOOLKIT_QUALIFY_TASK: JSON.stringify({ folder, name }) } });
    assert.equal(result.status, 0, result.stderr);
  };
  t.after(() => {
    for (const mode of ['programme-sweep', 'footer-sweep', null]) {
      const modeHome = mode ? path.join(home, mode) : home;
      for (const row of tasks.readRegistry(modeHome).tasks || []) {
        const live = scheduler.list(folder).find(task => task.name === row.name);
        if (live?.state === 'Running' && windowsTasks.parseMarker(live.description)?.id === row.id) native('Stop-ScheduledTask', row.name);
      }
      const result = windowsTasks.removeTasks({ scope: desiredFor('programme-sweep'), folder, scheduler, home: modeHome });
      assert.ok(result.items.every(row => row.action === 'removed' || row.action.startsWith('stopped by owner')));
    }
    // A denied/killed registration may be unrecorded. Only this occupied-folder-checked test's
    // exact known definitions are eligible for separately authorised disposable cleanup.
    for (const live of scheduler.list(folder)) {
      const marker = windowsTasks.parseMarker(live.description);
      assert.ok(marker && knownDefinitions.get(marker.id)?.name === live.name);
      if (live.state === 'Running') native('Stop-ScheduledTask', live.name);
      scheduler.unregister(folder, live.name, marker.id, scheduler.list(folder).find(l => l.name === live.name));
    }
    assert.deepEqual(scheduler.list(folder), []);
    for (const [name, rows] of before) assert.deepEqual(snapshot(name), rows, 'unrelated installed definitions unchanged');
    if (qualificationComplete) fs.rmSync(home, { recursive: true, force: true });
    else t.diagnostic(`Qualification failed; evidence retained at ${home}. Disposable task cleanup was verified.`);
  });
  // Separate registries exercise lasting owner stops and same-job repair before the switch sequence.
  for (const mode of ['programme-sweep', 'footer-sweep']) {
    const modeHome = path.join(home, mode); fs.mkdirSync(modeHome);
    const desired = desiredFor(mode);
    const deps = { scheduler, home: modeHome, identityReader: location, firstRunOptions: { home } };
    const legacy = { ...desired, wanted: desired.wanted.map(d => d.job === 'shard-timings' ? d : ({ ...d, schedule: { kind: 'hourly', at: '08:00', hours: 16 }, schedule_text: 'hourly, 08:00 to 23:59' })) };
    for (const d of legacy.wanted) { const digest = d.def; d.def = windowsTasks.definitionDigest(d); d.description = d.description.replace(digest, d.def); }
    assert.equal(windowsTasks.applyTasks(legacy, { ...deps, firstRunOptions: null }).items[0].done, true);
    const applied = windowsTasks.applyTasks(desired, deps);
    assert.equal(applied.items[0].first_run.status, 'ok', JSON.stringify(applied));
    const d = applied.items[0].definition;
    // The subprocess writes to `home`; supply that reader to strict first-run checks below.
    const live = scheduler.list(folder).find(row => row.name === d.name);
    assert.ok(['P1D', 'PT24H'].includes(live.triggers[0].duration));
    const first = tasks.readLastRun(d.id, home);
    fs.writeFileSync(failureFile, 'fail');
    assert.equal(windowsTasks.firstRun(d, { scheduler, home }).status, 'failed', 'a failed real job is never healthy registration');
    assert.equal(tasks.readLastRun(d.id, home).footer_sweep_since, first.footer_sweep_since);
    fs.unlinkSync(failureFile);
    const second = windowsTasks.firstRun(d, { scheduler, home });
    assert.equal(second.status, 'ok');
    const record = tasks.readLastRun(d.id, home);
    assert.ok(Date.parse(record.footer_sweep_since) > Date.parse(first.footer_sweep_since));
    const calls = fs.readFileSync(events, 'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(row => row.id === d.id);
    assert.ok(calls.filter(row => row.args[0] === job.SCRIPT.footerSweep).length >= 2);
    assert.equal(windowsTasks.applyTasks(desired, { ...deps, firstRunOptions: null }).items[0].action, 'current');
    const removed = windowsTasks.removeTasks({ scope: desired, folder, scheduler, home: modeHome });
    assert.equal(removed.items[0].action, 'removed');
    assert.equal(windowsTasks.applyTasks(desired, deps).items[0].action, 'refused');
    const repaired = windowsTasks.applyTasks(desired, { ...deps, repairOwned: true, firstRunOptions: null });
    assert.equal(repaired.items[0].done, true);
    // Copy the real native disabled state only through the scheduler's own command.
    native('Disable-ScheduledTask', d.name);
    assert.equal(windowsTasks.applyTasks(desired, deps).items[0].action, 'refused');
    assert.match(tasks.formatList(tasks.listTasks({ home: modeHome, scheduler, platform: 'win32', folderFor: () => folder })), /Disabled/);
    windowsTasks.removeTasks({ scope: desired, folder, scheduler, home: modeHome });
  }
  // The same real native folder and registry change shape OFF/ON/OFF/ON. The managed runner
  // writes each real result; fake GitHub processes stay inside the generated qualification runner.
  for (const mode of ['footer-sweep','programme-sweep','footer-sweep','programme-sweep']) {
    const offer = desiredFor(mode), old = tasks.readRegistry(home).tasks.find(e => e.job !== mode && ['programme-sweep','footer-sweep'].includes(e.job));
    const boundary = old && tasks.readLastRun(old.id, home)?.footer_sweep_since;
    const adapter = { ...scheduler, start(f, name) {
      if (boundary) assert.ok(Date.parse(tasks.readLastRun(windowsTasks.taskId(folder, mode), home).footer_sweep_since) <= Date.parse(boundary));
      scheduler.start(f, name);
    } };
    const applied = windowsTasks.applyTasks(offer, { scheduler: adapter, home, identityReader: location, firstRunOptions: { home } });
    assert.ok(applied.items.every(i => i.done), JSON.stringify(applied));
    assert.equal(applied.items.find(i => i.first_run)?.first_run.status, 'ok'); assertLiveRegistry(home, scheduler);
    assert.deepEqual(tasks.readRegistry(home).tasks.map(e => e.job).sort(), mode === 'programme-sweep' ? ['programme-sweep','shard-timings'] : ['footer-sweep']);
  }
  // Real native definition changes use the same enrolled baseline and one-use answer path.
  const on = desiredFor('programme-sweep'), d = on.definitions.find(d => d.job === 'programme-sweep');
  for (const changed of on.definitions.filter(d => d.job !== 'footer-sweep')) {
    scheduler.register({ ...changed, schedule: { ...changed.schedule, at: '01:00' } }, scheduler.list(folder).find(l => l.name === changed.name));
    const choice = windowsTasks.planTasks(on, { scheduler, home, identityReader: location }).items.find(i => i.action === 'owner-choice-required'); assert.ok(choice);
    const answer = { task: changed.id, observed: choice.choice.fingerprint, outcome: 'keep', answer_ref: `qualification:${changed.job}:simulated-owner-keep` };
    assert.equal(windowsTasks.applyTasks(on, { scheduler, home, identityReader: location, taskChoice: answer }).refused, true);
    const replaced = windowsTasks.applyTasks(on, { scheduler, home, identityReader: location, taskChoice: { ...answer, outcome: 'replace', answer_ref: `qualification:${changed.job}:simulated-owner-replace` }, firstRunOptions: { home } });
    assert.ok(replaced.items.every(i => i.done)); assertLiveRegistry(home, scheduler);
    assert.equal(windowsTasks.applyTasks(on, { scheduler, home, identityReader: location, taskChoice: answer }).refused, true);
  }
  fs.writeFileSync(pauseFile, 'qualification latch'); scheduler.start(folder, d.name);
  const waitReady = name => {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (scheduler.info(folder, name)?.state !== 'Running') return;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    assert.fail('disposable task is still running; preserve evidence and clean up its exact folder');
  };
  try {
    let running = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (scheduler.info(folder, d.name)?.state === 'Running') { running = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    assert.equal(running, true);
    const beforeSwitch = snapshot(folder);
    assert.equal(windowsTasks.applyTasks(desiredFor('footer-sweep'), { scheduler, home, identityReader: location }).refused, true);
    assert.deepEqual(snapshot(folder), beforeSwitch);
  } finally { fs.unlinkSync(pauseFile); }
  waitReady(d.name);
  // Faults leave the native result in place, exactly as a stopped process would. There is no
  // cross-shape rollback. A native/registry gap needs the test's separately authorised exact cleanup.
  for (const target of ['footer-sweep','programme-sweep']) for (const point of ['history','register','destination-readback','enrolment','unregister','cleanup','shards','start','result-readback']) for (const side of ['before','after']) {
    const sourceMode = target === 'footer-sweep' ? 'programme-sweep' : 'footer-sweep';
    const sourceOffer = desiredFor(sourceMode);
    assert.ok(windowsTasks.applyTasks(sourceOffer, { scheduler, home, identityReader: location }).items.every(i => i.done));
    for (const row of scheduler.list(folder)) if (row.state === 'Running') waitReady(row.name);
    const retainedChoices = tasks.readRegistry(home).tasks.flatMap(e => (e.task_choices || []).map(c => c.answer_ref));
    const sourceEntry = tasks.readRegistry(home).tasks.find(e => e.job === sourceMode);
    const pendingBoundary = tasks.readLastRun(sourceEntry.id, home)?.footer_sweep_since;
    const offer = desiredFor(target); let fired = false, registered = false, removed = false;
    const at = (label, when) => { if (!fired && point === label && side === when) { fired = true; throw new Error(`qualification interruption ${label} ${when}`); } };
    const around = (label, effect) => { at(label, 'before'); const result = effect(); at(label, 'after'); return result; };
    const adapter = { ...scheduler,
      register(def, old) { return around(def.job === 'shard-timings' ? 'shards' : 'register', () => { const result = scheduler.register(def, old); if (def.job === target) registered = true; return result; }); },
      list(f) { return registered ? around('destination-readback', () => scheduler.list(f)) : scheduler.list(f); },
      unregister(f, name, id, old) { return around(id.endsWith('shard-timings') ? 'shards' : 'unregister', () => { const result = scheduler.unregister(f, name, id, old); if (!id.endsWith('shard-timings')) removed = true; return result; }); },
      start: (f, name) => around('start', () => scheduler.start(f, name)),
      info: (f, name) => around('result-readback', () => scheduler.info(f, name)),
    };
    const registry = { ...tasks, updateRegistry: (...args) => around(removed ? 'cleanup' : 'enrolment', () => tasks.updateRegistry(...args)) };
    let result;
    try { result = windowsTasks.applyTasks(offer, { scheduler: adapter, registry, home, identityReader: location,
      writeRecord: (id, record) => around('history', () => tasks.writeLastRun(id, record, home)), firstRunOptions: { home } }); }
    catch (error) { assert.match(error.message, /qualification interruption/); }
    assert.equal(fired, true, `${target} ${point} ${side} was exercised`);
    assert.ok(!result || result.refused || result.items.some(i => i.done === false || i.first_run?.status === 'failed'));
    const saved = tasks.readRegistry(home);
    for (const live of scheduler.list(folder)) {
      if (live.state === 'Running') waitReady(live.name);
      if (saved.tasks.some(e => e.name === live.name)) continue;
      const marker = windowsTasks.parseMarker(live.description);
      assert.ok(marker && offer.definitions.some(def => def.id === marker.id && def.name === live.name));
      assert.equal(windowsTasks.applyTasks(offer, { scheduler, home, identityReader: location }).refused, true, 'never take over an unrecorded native write');
      const held = windowsTasks.planTasks(offer, { scheduler, home, identityReader: location });
      const nativeCommand = `Unregister-ScheduledTask -TaskPath '\\${folder}\\' -TaskName '${live.name}' -Confirm:$false`;
      assert.ok(held.next_step.includes(nativeCommand), held.next_step);
      native('Unregister-ScheduledTask', live.name);
      assert.ok(!scheduler.list(folder).some(l => l.name === live.name));
    }
    let resumed = windowsTasks.applyTasks(offer, { scheduler, home, identityReader: location });
    if (resumed.refused) {
      const held = windowsTasks.planTasks(offer, { scheduler, home, identityReader: location });
      assert.match(held.next_step, /Owner-authorised recovery:.* --repair-owned/);
      resumed = windowsTasks.applyTasks(offer, { scheduler, home, identityReader: location, repairOwned: true });
    }
    assert.ok(resumed.items.every(i => i.done), JSON.stringify(resumed)); assertLiveRegistry(home, scheduler);
    assert.deepEqual(tasks.readRegistry(home).tasks.map(e => e.job).sort(), target === 'programme-sweep' ? ['programme-sweep','shard-timings'] : ['footer-sweep']);
    assert.ok(tasks.readRegistry(home).tasks.every(e => !e.replaces));
    const choices = tasks.readRegistry(home).tasks.flatMap(e => (e.task_choices || []).map(c => c.answer_ref));
    for (const ref of retainedChoices) assert.ok(choices.includes(ref), 'spent owner answer survives interruption and recovery');
    const resultRecord = tasks.readLastRun(windowsTasks.taskId(folder, target), home);
    if (pendingBoundary && resultRecord?.status !== 'ok') assert.ok(Date.parse(resultRecord.footer_sweep_since) <= Date.parse(pendingBoundary), 'an incomplete run never loses the retry window');
  }
  // A second repository in the same disposable folder must survive A's removal unchanged.
  const otherRoot = checkout(t, { shards: false }), otherRepo = 'qualification/other';
  const other = { ...desiredFor('programme-sweep').definitions.find(d => d.job === 'programme-sweep'),
    id: 'qualification-other-programme-sweep', name: `${folder} - OTHER PROGRAMME SWEEP`, repository: otherRepo, checkout: otherRoot };
  other.arguments = other.arguments.replace(root, otherRoot).replace(/--task-id [a-z0-9-]+$/, '--task-id ' + other.id);
  other.def = windowsTasks.definitionDigest(other); other.description = `Qualification other [toolkit-task v1 id=${other.id} def=${other.def}]`;
  knownDefinitions.set(other.id, other); scheduler.register(other);
  const otherLive = scheduler.list(folder).find(l => l.name === other.name), template = tasks.readRegistry(home).tasks.find(e => e.job === 'programme-sweep');
  const otherEntry = { ...template, id: other.id, name: other.name, repository: otherRepo, checkout: otherRoot, definition: other.def, enrolled: windowsTasks.enrolledDefinition(otherLive) };
  delete otherEntry.replaces; delete otherEntry.task_choices;
  tasks.updateRegistry(home, rows => [...rows, otherEntry]);
  assert.ok(windowsTasks.removeTasks({ scope: desiredFor('programme-sweep'), folder, scheduler, home }).items.every(i => i.action === 'removed'));
  assert.deepEqual(scheduler.list(folder).find(l => l.name === other.name), otherLive);
  assert.deepEqual(tasks.readRegistry(home).tasks.find(e => e.id === other.id), otherEntry);
  const otherScope = windowsTasks.desiredTasks({ checkout: otherRoot, folder, toolkitRoot: ROOT, nodePath: process.execPath, home, deps: { identityReader: request => request, governance: governance({ repository: otherRepo, folder }) } });
  assert.equal(windowsTasks.removeTasks({ scope: otherScope, folder, scheduler, home }).items[0].action, 'removed');
  qualificationComplete = true;
});

test('setup held plans omit recovery paths and commands, while direct plan retains them', async t => {
  const w = switchWorld(t); await w.gov('on'); assert.equal(w.cli('apply').code, 0);
  await w.gov('off');
  tasks.updateRegistry(w.home, rows => rows.map(e => ({ ...e, stopped_by_owner: true, stopped_at: w.now().toISOString() })));
  const lines = [], core = require('../scripts/setup-toolkit-core.cjs');
  core.printWindowsTasks({ repoRoot: w.root }, { platform: 'win32', scheduler: w.scheduler, home: w.home, workingFolder: w.root,
    checkoutDeps: { ...w.offer().checkoutDeps, reportCheckout: root => root }, log: line => lines.push(line) });
  const text = lines.join('\n');
  for (const location of [w.root, w.toolkitRoot, w.home]) assert.equal(text.includes(location), false);
  assert.doesNotMatch(text, /--repo-root|--repair-owned|node |USERPROFILE/);
  assert.match(text, /direct task plan/);
  assert.match(windowsTasks.describePlan(w.cli('plan').json).join('\n'), /node .* --repair-owned/);
});

for (const mode of ['success','register failure','first-run failure']) test(`apply next step describes ${mode} without asking to run apply`, t => {
  const home = tempHome(t), scheduler = fakeScheduler(), offer = desired(t);
  if (mode === 'register failure') scheduler.register = () => { throw new Error('fixture denied'); };
  const result = windowsTasks.applyTasks(offer, { home, scheduler, firstRunOptions: mode === 'first-run failure' ? { wait() {}, waitMs: 1, pollMs: 1 } : null });
  assert.doesNotMatch(result.next_step, /^Run apply/);
  if (mode === 'register failure') assert.ok(result.items.some(i => i.done === false));
  if (mode === 'first-run failure') assert.equal(result.items[0].first_run.status, 'failed');
});

for (const jobName of ['programme-sweep','shard-timings']) test(`task list: edited ${jobName} needs a choice, with no owner stop`, t => {
  const home = tempHome(t), scheduler = fakeScheduler(), offer = desired(t);
  windowsTasks.applyTasks(offer, { home, scheduler });
  const live = scheduler.folders.get('TOOLKIT').find(l => l.name === windowsTasks.taskName('TOOLKIT',jobName));
  live.arguments += ' --owner-edit';
  const before = fs.readFileSync(tasks.registryPath(home));
  const listed = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT' });
  assert.equal(listed.rows.find(r => r.name === live.name).state, 'modified; owner choice required');
  assert.equal(windowsTasks.planTasks(offer, { home, scheduler }).items.find(i => i.definition.job === jobName).action, 'owner-choice-required');
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
  assert.ok(tasks.readRegistry(home).tasks.every(e => !e.stopped_by_owner));
});

test('removal hints: plugin and linked Toolkit copies name the managed runner and target primary, then execute', t => {
  const base = tempHome(t), home = path.join(base,'home'), managed = path.join(base,'managed'), project = path.join(base,'project');
  const git = (root,...args) => require('node:child_process').execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:10000});
  for (const [root,origin] of [[managed,'https://github.com/weijunswj/ai-agent-toolkit.git'],[project,'https://github.com/example/widget.git']]) {
    fs.mkdirSync(root); git(root,'init','--quiet'); git(root,'remote','add','origin',origin);
    git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--quiet','--allow-empty','-m','fixture');
  }
  const plugin = path.join(base,'plugin'), linked = path.join(base,'linked'); fs.mkdirSync(plugin);
  git(managed,'worktree','add','--quiet','-b','fixture',linked);
  const state = path.join(home,'.ai-agent-toolkit','current','state.json');
  fs.mkdirSync(path.dirname(state),{recursive:true}); fs.writeFileSync(state,JSON.stringify({repo_path:managed}));
  const real = require('../scripts/toolkit-governance-state.cjs'), scheduler = fakeScheduler();
  const deps = { platform:'win32',home,scheduler,nodePath:NODE,
    checkoutDeps:{governance:{...governance({repository:'example/widget'}),readIdentity:real.readIdentity}} };
  for (const copy of [plugin,linked]) {
    let text='';
    assert.equal(windowsTasks.main(['remove','--repo-root',project],{...deps,toolkitRoot:copy,stdout:v=>{text+=v;},stderr:v=>{text+=v;}}),1);
    const command = /Use node "([^"\n]+)" remove --repo-root "([^"\n]+)"/.exec(text); assert.ok(command,text);
    const script=command[1].replace('$env:USERPROFILE',home), target=command[2].replace('$env:USERPROFILE',home);
    assert.equal(script,path.win32.join(managed,'repo','scripts','toolkit-windows-tasks.cjs')); assert.equal(target,project);
    assert.equal(windowsTasks.main(['remove','--repo-root',target],{...deps,toolkitRoot:managed,stdout(){},stderr(){}}),0);
  }
});

test('choice history: repeated real large edits store fingerprints and retain bounded-reader recovery', t => {
  const home=tempHome(t),scheduler=fakeScheduler(),offer=desired(t);
  windowsTasks.applyTasks(offer,{home,scheduler});
  const live=scheduler.folders.get('TOOLKIT')[0];
  for (let index=0;index<90;index++) {
    live.definition_xml='<Task>'+String(index)+'x'.repeat(4096)+'</Task>';
    const item=windowsTasks.planTasks(offer,{home,scheduler}).items.find(i=>i.choice);
    assert.ok(item);
    const answer={task:item.choice.task,observed:item.choice.fingerprint,outcome:'keep',answer_ref:`owner-message:large-${index}`};
    assert.equal(windowsTasks.applyTasks(offer,{home,scheduler,taskChoice:answer}).refused,true);
  }
  const read=tasks.readRegistry(home); assert.equal(read.status,'ok');
  const history=read.tasks[0].task_choices; assert.equal(history.length,90);
  assert.ok(history.every(c=>!Object.hasOwn(c,'definition')&&/^[a-f0-9]{64}$/.test(c.observed)&&c.answer_ref&&c.outcome==='keep'&&c.at));
  assert.ok(fs.statSync(tasks.registryPath(home)).size<512*1024);
  assert.equal(windowsTasks.removeTasks({scope:offer,home,scheduler}).items.every(i=>i.action==='removed'),true);
});

for (const target of ['on','off']) for (const failure of ['native denial','XML race','recreated source'])
test(`moved recovery interruption: ${target} / ${failure}`, async t => {
  const w=switchWorld(t); await w.gov(target==='on'?'off':'on'); assert.equal(w.cli('apply').code,0);
  const folder='AI-AGENT-TOOLKIT', original=structuredClone(w.scheduler.folders.get(folder)[0]);
  w.move('checkout'); await w.gov(target);
  if (failure!=='recreated source') {
    const unregister=w.scheduler.unregister; let fired=false;
    w.scheduler.unregister=(...args)=>{
      if (!fired) {
        fired=true;
        if (failure==='native denial') throw new Error('fixture native denial');
        w.scheduler.folders.get(folder).find(l=>l.name===args[1]).definition_xml='<concurrent-owner-edit/>';
      }
      return unregister(...args);
    };
    assert.equal(w.cli('remove').code,1); assert.equal(fired,true);
    const entries=tasks.readRegistry(w.home).tasks;
    assert.ok(entries.some(e=>e.stopped_by_owner));
    assert.ok(w.scheduler.list(folder).some(l=>l.name===original.name));
    const before={live:JSON.stringify([...w.scheduler.folders]),registry:fs.readFileSync(tasks.registryPath(w.home))};
    assert.equal(w.cli('apply','--repair-owned').code,1);
    assert.equal(JSON.stringify([...w.scheduler.folders]),before.live); assert.deepEqual(fs.readFileSync(tasks.registryPath(w.home)),before.registry);
    w.scheduler.unregister=unregister;
  } else {
    assert.equal(w.cli('remove').code,0);
    const register=w.scheduler.register; let fired=false;
    w.scheduler.register=(...args)=>{if(!fired){fired=true;w.scheduler.folders.set(folder,[original]);}return register(...args);};
    assert.equal(w.cli('apply','--repair-owned').code,1); assert.equal(fired,true);
    assert.ok(w.scheduler.list(folder).some(l=>l.name===original.name));
    w.scheduler.register=register;
  }
  printedRecovery(w,true); assertShape(w,target);
});
