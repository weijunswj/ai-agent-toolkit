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
const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const shards = require('../scripts/ci-test-shards.cjs');

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const identityReader = ({ checkout, toolkitRoot }) => ({ checkout, toolkitRoot });
const testRepository = root => { if (!fs.existsSync(path.join(root, '.git'))) throw new Error('registered root is not a repository checkout'); return true; };
const TOOLKIT_ROOT = 'C:\\Toolkit\\ai-agent-toolkit';
const hostile = require('./support/hostile-inputs.cjs');

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
for (const toolkit of matrixKinds) for (const target of matrixTargets) for (const state of matrixStates) for (const requester of matrixRequesters) {
  test(`closure: ${toolkit} / ${target} / ${state} / ${requester}`, () => {
    const scheduler = fakeScheduler();
    const registry = memoryRegistry();
    const root = 'C:\\Repositories\\widget';
    const wanted = windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: governance({ repository: 'example/widget', folder: 'WIDGET' }) } });
    const owner = () => new windowsTasks.WindowsTaskOwner({ scheduler, registry, home: 'fixture-home', identityReader,
      now: () => new Date('2026-11-05T00:00:00.000Z'), repairOwned: requester === 'owner explicit' });
    if (state !== 'absent') assert.ok(owner().apply(wanted).items.every(item => item.done));
    if (state === 'healthy other repository') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, repository: 'someone-else/widget' })));
    if (state === 'healthy other checkout') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, checkout: 'C:\\Old\\widget' })));
    if (state === 'disabled') scheduler.folders.get('WIDGET')[0].state = 'Disabled';
    if (state === 'edited action') scheduler.folders.get('WIDGET')[0].arguments += ' --owner-edit';
    if (state === 'edited trigger') scheduler.folders.get('WIDGET')[1].triggers = [{ kind: 'MSFT_TaskWeeklyTrigger', start: '2099-01-01T09:15:00', days_of_week: 2 }];
    if (state === 'removed by owner') owner().remove('WIDGET');
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
      const instance = new windowsTasks.WindowsTaskOwner({ scheduler, registry, home: 'fixture-home', identityReader: reader,
        now: () => new Date('2026-11-05T00:00:00.000Z'), repairOwned: requester === 'owner explicit' });
      return requester === 'setup plan' ? instance.plan(wanted) : instance.apply(wanted);
    };
    if (!validLocation || state === 'corrupt registry' && requester !== 'setup plan') assert.throws(invoke);
    else { result = invoke(); assert.equal(result.items.every(item => item.action !== 'refused'), allowed); }
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

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-tasks-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// A checkout folder; `shards` adds the Toolkit shard contract, not a local refresher script.
function checkout(t, { shards = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-checkout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  if (shards) {
    addShards(root);
  }
  return root;
}

function addShards(root) {
  fs.mkdirSync(path.join(root, 'repo', 'contracts', 'ci'), { recursive: true });
  fs.mkdirSync(path.join(root, 'repo', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'repo', 'tests', 'example.test.cjs'), '// fixture\n');
  fs.writeFileSync(path.join(root, ...shards.MANIFEST_REL.split('/')), JSON.stringify({
    schema: shards.MANIFEST_SCHEMA,
    systems: Object.fromEntries(shards.SYSTEMS.map(system => [system, { shards: [{ id: `${system}-1`, rest: true }] }])),
  }));
}

function governance({ state = 'ENABLED', folder = 'TOOLKIT', repository = 'weijunswj/ai-agent-toolkit', binding = true } = {}) {
  return {
    readIdentity: root => ({ valid: true, root, remote: { path: `/${repository}.git` } }),
    governanceState: () => ({ state }),
    mergedBinding: () => (binding && state === 'ENABLED' ? { repository, schedule_folder: folder, store: { repository: 'weijunswj/TRANSPORT-ai-agent-toolkit' } } : null),
  };
}

// An in-memory Task Scheduler with the same methods as powerShellScheduler(). register and
// unregister keep the PowerShell side's own marker check.
function fakeScheduler(initial = {}) {
  const folders = new Map(Object.entries(initial).map(([folder, list]) => [folder, list.map(task => ({ ...task }))]));
  const calls = [];
  const key = folder => folder || '';
  const of = folder => folders.get(key(folder)) || [];
  return {
    calls, folders,
    onStart: null,
    list(folder) { calls.push(['list', folder]); return structuredClone(of(folder)); },
    markedFolders() { return [...folders.entries()].filter(([name, list]) => name && list.some(task => String(task.description).includes('[toolkit-task v1 '))).map(([name]) => name); },
    register(d) {
      calls.push(['register', d.folder, d.name]);
      const list = folders.get(d.folder) || [];
      const existing = list.find(task => task.name === d.name);
      if (existing && !String(existing.description).includes(`[toolkit-task v1 id=${d.id} `)) throw new Error('not Toolkit\'s');
      const task = { name: d.name, description: d.description, state: 'Ready', execute: d.execute, arguments: d.arguments, working_directory: d.working_directory,
        actions: [{ execute: d.execute, arguments: d.arguments, working_directory: d.working_directory }],
        triggers: d.schedule.kind === 'hourly' ? [{ kind: 'MSFT_TaskDailyTrigger', start: `2026-10-29T${d.schedule.at}:00+08:00`, interval: 'PT1H', duration: `PT${d.schedule.hours}H` }]
          : [{ kind: 'MSFT_TaskWeeklyTrigger', start: `2026-10-26T${d.schedule.at}:00+08:00`, days_of_week: 2 }], last_run: null, last_result: 0x41303 };
      folders.set(d.folder, [...list.filter(item => item.name !== d.name), task]);
    },
    unregister(folder, name, id) {
      calls.push(['unregister', folder, name]);
      const task = of(folder).find(item => item.name === name);
      if (task && !String(task.description).includes(`[toolkit-task v1 id=${id} `)) throw new Error('marker');
      folders.set(folder, of(folder).filter(item => item.name !== name));
    },
    removeFolderIfEmpty(folder) {
      calls.push(['remove-folder', folder]);
      if (!folders.has(folder)) return { folder: 'absent' };
      if (of(folder).length) return { folder: 'kept' };
      folders.delete(folder);
      return { folder: 'removed' };
    },
    start(folder, name) { calls.push(['start', folder, name]); if (this.onStart) this.onStart(of(folder).find(item => item.name === name)); },
    info(folder, name) { const task = of(folder).find(item => item.name === name); return { state: task.state, last_run: task.last_run, last_result: task.last_result }; },
  };
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
    [['toolkit-programme-sweep', 'TOOLKIT', 'hourly, 08:00 to 23:59', null, null], ['toolkit-shard-timings', 'TOOLKIT', 'weekly, Monday 09:15', null, null]]);
  const report = windowsTasks.describePlan(result, { applied: true }).join('\n');
  assert.match(report, /TOOLKIT - PROGRAMME SWEEP \(hourly, 08:00 to 23:59\): created\. Brings the programme pages/);
  assert.match(report, /TOOLKIT - SHARD TIMINGS \(weekly, Monday 09:15\): created\./);
  if (process.platform !== 'win32') assert.equal((fs.statSync(tasks.registryPath(home)).mode & 0o777), 0o600);
  const sweep = wanted.wanted[0];
  assert.equal(sweep.execute, 'C:\\Windows\\System32\\conhost.exe');
  assert.equal(sweep.arguments, `--headless "${NODE}" "${TOOLKIT_ROOT}\\repo\\scripts\\toolkit-scheduled-job.cjs" programme-sweep --repo-root "${wanted.root}" --task-id toolkit-programme-sweep`);
  assert.match(sweep.description, /^TOOLKIT: PROGRAMME SWEEP\. .*\[toolkit-task v1 id=toolkit-programme-sweep def=[0-9a-f]{12}\]$/);
});

test('G: both fixed jobs require ENABLED governance and a merged binding, with or without shards', (t) => {
  const cases = [
    { state: 'ENABLED', binding: true, allowed: true },
    ...['DISABLED', 'UNDECIDED', 'ERROR', null].flatMap(state => [true, false].map(binding => ({ state, binding, allowed: false }))),
    { state: 'ENABLED', binding: false, allowed: false },
  ];
  for (const row of cases) for (const hasShards of [false, true]) {
    const scheduler = fakeScheduler();
    const wanted = desired(t, { ...row, shards: hasShards, repository: 'example/widget', folder: 'WIDGET' });
    const result = windowsTasks.applyTasks(wanted, { scheduler, home: tempHome(t) });
    assert.deepEqual(result.items.map(item => item.definition.job), row.allowed ? ['programme-sweep', 'shard-timings'] : [], JSON.stringify({ ...row, hasShards }));
    assert.equal(scheduler.calls.filter(call => call[0] === 'register').length, row.allowed ? 2 : 0);
    if (!row.allowed) {
      assert.equal(result.refused, true, 'unavailable governance is an apply refusal, never a success');
      assert.equal(result.skipped.length, 2);
      for (const item of result.skipped) assert.match(item.reason, row.state === 'ENABLED' ? /binding merged on the default branch could not be read/ : /GitHub governance is .* so Toolkit tasks are not registered/);
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
  for (const failing of ['mergedBinding', 'governanceState']) {
    const reader = governance();
    reader[failing] = () => { throw new Error('unreadable'); };
    const wanted = windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: reader } });
    assert.deepEqual(wanted.wanted, [], failing);
    assert.equal(wanted.skipped.length, 2);
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
  assert.match(lines.join(''), /PROGRAMME SWEEP \(hourly, 08:00 to 23:59\): refused/);
});

test('G: root-folder n8n backups and other repositories\' folders are never changed', (t) => {
  const home = tempHome(t);
  const n8n = unmarked('n8n-local-cli-backup-0123456789ab', { description: 'n8n backup' });
  const other = { ...unmarked('SAQG - PROGRAMME SWEEP'), description: 'SAQG: PROGRAMME SWEEP. x [toolkit-task v1 id=saqg-programme-sweep def=0123456789ab]' };
  const scheduler = fakeScheduler({ '': [n8n], SAQG: [other] });
  windowsTasks.applyTasks(desired(t), { scheduler, home });
  windowsTasks.removeTasks({ scheduler, home });
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
  windowsTasks.applyTasks(desired(t), { scheduler, home });
  scheduler.folders.get('TOOLKIT').push(unmarked('Session Digest'));
  windowsTasks.adoptTask({ folder: 'TOOLKIT', task: 'Session Digest', id: 'session-digest', purpose: 'Daily redacted session digest. No AI.' }, { scheduler, home });
  const kept = windowsTasks.removeTasks({ scheduler, home });
  assert.deepEqual(kept.items.map(item => item.action), ['removed', 'removed']);
  assert.deepEqual(kept.folders, [{ folder: 'TOOLKIT', result: 'kept' }]);
  assert.deepEqual(scheduler.folders.get('TOOLKIT').map(task => task.name), ['Session Digest']);
  assert.deepEqual(tasks.readRegistry(home).tasks.filter(entry => !entry.stopped_by_owner).map(entry => entry.id), ['session-digest'], 'adopted task untouched; owned stops retained');
  // With nothing else in it, the folder goes too.
  const home2 = tempHome(t);
  const empty = fakeScheduler();
  windowsTasks.applyTasks(desired(t), { scheduler: empty, home: home2 });
  assert.deepEqual(windowsTasks.removeTasks({ scheduler: empty, home: home2 }).folders, [{ folder: 'TOOLKIT', result: 'removed' }]);
  assert.equal(empty.folders.has('TOOLKIT'), false);
  assert.ok(tasks.readRegistry(home2).tasks.every(entry => entry.stopped_by_owner));
  // A recorded task whose marker was edited away is left alone.
  const home3 = tempHome(t);
  const edited = fakeScheduler();
  windowsTasks.applyTasks(desired(t, { shards: false }), { scheduler: edited, home: home3 });
  edited.folders.get('TOOLKIT')[0].description = 'changed by hand';
  assert.equal(windowsTasks.removeTasks({ scheduler: edited, home: home3 }).items[0].action, 'refused');
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

test('G: plan prints the exact apply command and approval guidance, with the profile folder as $env:USERPROFILE', (t) => {
  const home = 'C:\\Users\\someone';
  const wanted = desired(t, { root: 'C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit' });
  const command = windowsTasks.applyCommand(wanted, { toolkitRoot: 'C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit', home });
  assert.equal(command, 'node "$env:USERPROFILE\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\toolkit-windows-tasks.cjs" apply --repo-root "$env:USERPROFILE\\.ai-agent-toolkit\\source\\ai-agent-toolkit"');
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
  reader.mergedBinding = () => ({ repository: 'other/widget', schedule_folder: 'WIDGET' });
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
  windowsTasks.removeTasks({ scheduler: owned, home });
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
  assert.equal(windowsTasks.powerShellPath('C:\\Users\\someone\\$value', 'C:\\Users\\someone'), '"$env:USERPROFILE\\`$value"');
});

for (const edit of ['execute', 'arguments', 'directory', 'extra action', 'marker', 'principal', 'settings', 'trigger count', 'trigger disabled', 'future start', 'end', 'repetition', 'weekday', 'weekly interval']) {
  test(`definition baseline: refuses ${edit} on either job before any mutation`, t => {
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
    assert.ok(windowsTasks.applyTasks(wanted, { scheduler, home }).items.every(row => row.action === 'refused'));
    assert.deepEqual([...scheduler.folders], snapshot);
    assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), before);
    assert.ok(scheduler.calls.every(call => call[0] === 'list'));
  });
}

test('stop: remove, restart CLI, refuse, repeat remove and approved repair retain the right state', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t), wanted = desired(t, { root });
  windowsTasks.applyTasks(wanted, { scheduler, home });
  windowsTasks.removeTasks({ scheduler, home });
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
  windowsTasks.removeTasks({ scheduler, home });
  assert.deepEqual(fs.readFileSync(tasks.registryPath(home)), stop, 'repeated remove preserves time and baseline');
  assert.equal(windowsTasks.main(['apply', '--repo-root', root, '--repair-owned', '--no-first-run'], deps), 0);
  assert.ok(tasks.readRegistry(home).tasks.every(row => !row.stopped_by_owner && row.enrolled));
  assert.throws(() => windowsTasks.parseArgs(['plan', '--repair-owned']), /unknown/);
});

test('stop: a fresh Node process reads the retained stop and performs no scheduler mutation', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t), wanted = desired(t, { root });
  windowsTasks.applyTasks(wanted, { scheduler, home }); windowsTasks.removeTasks({ scheduler, home });
  const before = fs.readFileSync(tasks.registryPath(home));
  const script = `const w=require(process.argv[1]);
    const identityReader=({checkout,toolkitRoot})=>({checkout,toolkitRoot});
    const governance={readIdentity:root=>({valid:true,root,remote:{path:'/weijunswj/ai-agent-toolkit.git'}}),governanceState:()=>({state:'ENABLED'}),mergedBinding:()=>({repository:'weijunswj/ai-agent-toolkit',schedule_folder:'TOOLKIT'})};
    const scheduler={list:()=>[],register:()=>{throw new Error('unexpected mutation')},start:()=>{throw new Error('unexpected start')}};
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
    const result = windowsTasks.removeTasks({ scheduler, home, registry });
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
    windowsTasks.applyTasks(wanted, { scheduler, home }); windowsTasks.removeTasks({ scheduler, home });
    const before = fs.readFileSync(tasks.registryPath(home)); scheduler.calls.length = 0;
    const register = scheduler.register;
    scheduler.register = d => { if (failure === 'register') throw new Error('native denied'); register(d); scheduler.folders.get(d.folder)[0].arguments += ' unexpected'; };
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
  const result = windowsTasks.applyTasks(wanted, { scheduler, registry, home: 'fixture-home', repairOwned: true, firstRunOptions: { wait: () => {} } });
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
  const plan = core.printWindowsTasks({ repoRoot: root }, { platform: 'win32', scheduler, checkoutDeps: { identityReader, governance: governance() }, home, log: line => lines.push(line) });
  assert.deepEqual(plan.items.map(item => item.action), ['create', 'create']);
  const text = lines.join('\n');
  assert.match(text, /## Windows scheduled tasks\nWindows scheduled tasks for weijunswj\/ai-agent-toolkit in \\TOOLKIT\\:/);
  assert.match(text, /An eligible local agent can register these fixed jobs[\s\S]*toolkit-windows-tasks\.cjs" apply --repo-root /);
  assert.deepEqual(scheduler.calls.map(call => call[0]), ['list'], 'setup never registers, starts or removes a task');
  assert.deepEqual(tasks.readRegistry(home).tasks, [], 'setup records nothing');
  assert.equal(core.printWindowsTasks({ repoRoot: root }, { platform: 'linux', scheduler, log: line => lines.push(line) }), null);
  // The remove flag runs on its own and goes to remove, never apply.
  windowsTasks.applyTasks(desired(t, { root }), { scheduler, home });
  scheduler.folders.get('TOOLKIT').push(unmarked('Mine'));
  scheduler.calls.length = 0;
  const out = [];
  const code = await core.main(['--remove-toolkit-tasks'], { platform: 'win32', windowsTasksDeps: { platform: 'win32', scheduler, home, stdout: text => out.push(text) } });
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

const GH = 'C:\\gh\\gh.exe';
const REPO_ROOT = path.join(os.tmpdir(), 'tk-job-checkout');

// A fake process runner: answers by script and records every start.
function fakeRun(answers = {}) {
  const log = [];
  const run = (file, args) => {
    log.push([file, ...args]);
    const name = file === GH ? `gh ${args[0]}` : args[0] === '-e' ? 'reach github' : path.basename(args[0]) === 'programme.cjs' ? `programme ${args[1]}` : path.basename(args[0]);
    const answer = answers[name] || { status: 0, stdout: '' };
    return { stdout: '', stderr: '', ...(typeof answer === 'function' ? answer(args) : answer) };
  };
  return { run, log };
}

const GOVERNED = { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { fresh: true } }) };
const BINDING = () => ({ repository: 'weijunswj/ai-agent-toolkit', store: { repository: 'weijunswj/TRANSPORT-ai-agent-toolkit' } });
const ATTENTION = { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', text: 'Attention: clear (stored on #421, written 3 min ago)' }) };
const options = { job: 'programme-sweep', repoRoot: REPO_ROOT, taskId: 'toolkit-programme-sweep' };

function runSweep(t, answers, home = tempHome(t), clock = '2026-10-29T09:00:00.000Z') {
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob(options, { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, mergedBinding: BINDING, now: () => new Date(clock) });
  return { record, log: fake.log, home };
}

test('J: ENABLED, gh signed in, a clean refresh and two footers: all three steps, footers cleaned, last-run ok', (t) => {
  const sweep = { status: 4, stdout: JSON.stringify({ apply: true, results: [{ status: 'CLEANED' }, { status: 'CLEANED' }] }) };
  const { record, log, home } = runSweep(t, { 'programme refresh': { status: 0, stdout: '{"outcome":"DONE","holds":[]}' }, 'toolkit-github-footer-sweep.cjs': sweep });
  assert.equal(record.status, 'ok');
  assert.equal(record.exit, 0);
  assert.deepEqual(record.summary, ['Programme refresh: done.', 'Attention: clear (stored on #421, written 3 min ago)', 'Footer sweep since 2026-10-27 09:00: 2 CLEANED.']);
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
  assert.match(record.summary[0], /Programme refresh held: STORE_UNREACHABLE store/);
  assert.ok(log.some(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs'));
});

test('J: gh signed out skips with no GitHub call; a stale binding skips before any write', (t) => {
  const out = runSweep(t, { 'gh auth': { status: 1 } });
  assert.equal(out.record.status, 'skipped');
  assert.deepEqual(out.record.summary, ['skipped: gh not signed in']);
  assert.deepEqual(out.log.map(entry => entry.slice(0, 2)), [[GH, 'auth'], [NODE, '-e']], 'gh auth status, then only the github.com connection check');
  const stale = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { fresh: false } }) } });
  assert.deepEqual(stale.record.summary, ['skipped: binding not read in 24 h']);
  assert.equal(stale.log.some(entry => /programme\.cjs|footer-sweep/.test(entry[1] || '')), false);
  for (const state of ['DISABLED', 'ERROR', 'UNDECIDED']) {
    const off = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state, merged: { fresh: true } }) } });
    assert.deepEqual(off.record.summary, [`skipped: governance is ${state}`]);
    assert.equal(off.record.exit, 0);
  }
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
  const fake = fakeRun({ 'toolkit-governance.cjs': () => { seen.push(tasks.readLastRun('toolkit-programme-sweep', home)); return GOVERNED; }, 'programme attention': ATTENTION });
  job.runJob(options, { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, mergedBinding: BINDING, now: () => new Date('2026-11-01T05:00:05.000Z') });
  assert.deepEqual([seen[0].status, seen[0].skipped_streak, seen[0].skipped_since], ['running', 1, '2026-11-01T04:00:05.000Z']);
});

test('J: a footer sweep MISMATCH fails the run with its code, and the next run retries from the same time', (t) => {
  const home = tempHome(t);
  const first = runSweep(t, { 'toolkit-github-footer-sweep.cjs': { status: 1, stdout: JSON.stringify({ results: [{ status: 'MISMATCH' }] }) } }, home, '2026-10-29T09:00:00.000Z');
  assert.equal(first.record.status, 'failed');
  assert.equal(first.record.exit, 1);
  assert.match(first.record.summary.at(-1), /Footer sweep failed \(exit 1\): 1 MISMATCH; the next run tries again from the same time/);
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
    ...['DISABLED', 'UNDECIDED', 'ERROR'].map(state => ({ answers: { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state }) } }, reason: `governance is ${state}` })),
    { answers: { 'toolkit-governance.cjs': { status: 0, stdout: '{broken' } }, reason: 'governance status could not be read' },
    { answers: { 'toolkit-governance.cjs': { status: 0, stdout: '{"state":"ENABLED","merged":{"fresh":false}}' } }, reason: 'binding not read in 24 h' },
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
  assert.match(record.summary[0], /removed: looked like a secret/);
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
  windowsTasks.applyTasks(desired(t), { scheduler, home });
  return { home, scheduler };
}

test('L: a live Toolkit task shows its live schedule, last run and result', (t) => {
  const { home, scheduler } = listedHome(t);
  const live = scheduler.folders.get('TOOLKIT').find(task => task.name === 'TOOLKIT - PROGRAMME SWEEP');
  Object.assign(live, { last_run: '2026-10-29T01:00:05.000Z', last_result: 0 });
  tasks.writeLastRun('toolkit-programme-sweep', { started: '2026-10-29T01:00:05.000Z', finished: '2026-10-29T01:03:00.000Z', exit: 0, status: 'ok', summary: ['Programme refresh: done.', 'Attention: clear'] }, home);
  const result = tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => null });
  const row = result.rows.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP');
  assert.deepEqual([row.state, row.source, row.schedule, row.ai, row.result, row.last_result, row.last_run], ['Toolkit', tasks.LIVE, 'hourly, 08:00 to 23:59', 'no AI', 'ok', 'ok', '2026-10-29T01:03:00.000Z']);
  assert.match(tasks.formatList(result), /TOOLKIT - PROGRAMME SWEEP: Toolkit\. Windows Task Scheduler \\TOOLKIT\\; hourly, 08:00 to 23:59; no AI; last run 2026-10-29 01:03 ok/);
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

// ---- the one real registration (owner-run only) ------------------------------------------------

test('real Task Scheduler: register, list and remove under a scratch folder', { skip: process.platform !== 'win32' || process.env.TOOLKIT_REAL_TASK_SCHEDULER_TEST !== '1' ? 'owner-run only: set TOOLKIT_REAL_TASK_SCHEDULER_TEST=1 on Windows' : false }, (t) => {
  const home = tempHome(t);
  const scheduler = windowsTasks.powerShellScheduler();
  const folder = 'TOOLKIT-TEST-SCRATCH';
  const wanted = windowsTasks.desiredTasks({ checkout: ROOT, folder, deps: {} });
  t.after(() => { try { windowsTasks.removeTasks({ folder, scheduler, home }); } catch { /* reported by the assertions */ } });
  const before = scheduler.list(null).map(task => task.name).sort();
  windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.deepEqual(scheduler.list(folder).map(task => task.name).sort(), wanted.wanted.map(d => d.name).sort());
  assert.ok(scheduler.list(folder).every(task => windowsTasks.parseMarker(task.description)));
  const removed = windowsTasks.removeTasks({ folder, scheduler, home });
  assert.deepEqual(removed.folders, [{ folder, result: 'removed' }]);
  assert.deepEqual(scheduler.list(null).map(task => task.name).sort(), before, 'root-folder tasks unchanged');
});
