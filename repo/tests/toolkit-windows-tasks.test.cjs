'use strict';

// Windows scheduled tasks under \<schedule_folder>\, the no-AI job runner and `toolkit tasks`.
// Everything runs against a fake Task Scheduler; the one real-registration test runs only when the
// owner sets TOOLKIT_REAL_TASK_SCHEDULER_TEST=1 on Windows, because agents do not create tasks.

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

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const TOOLKIT_ROOT = 'C:\\Toolkit\\ai-agent-toolkit';

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-tasks-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// A checkout folder; `shards` adds the two files only the Toolkit repository has.
function checkout(t, { shards = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-checkout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (shards) {
    fs.mkdirSync(path.join(root, 'repo', 'contracts', 'ci'), { recursive: true });
    fs.mkdirSync(path.join(root, 'repo', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'repo', 'contracts', 'ci', 'test-shards.json'), '{}');
    fs.writeFileSync(path.join(root, 'repo', 'scripts', 'refresh-shard-timings.cjs'), '');
  }
  return root;
}

function governance({ state = 'ENABLED', folder = 'TOOLKIT', repository = 'weijunswj/ai-agent-toolkit', binding = true } = {}) {
  return {
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/${repository}.git` } }),
    governanceState: () => ({ state, merged: { status: state === 'ENABLED' ? 'enabled' : state === 'DISABLED' ? 'disabled' : state === 'UNDECIDED' ? 'none' : 'unknown', fresh: !['UNAVAILABLE', 'ERROR'].includes(state) } }),
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
    list(folder) { calls.push(['list', folder]); return of(folder).map(task => ({ ...task })); },
    markedFolders() { return [...folders.entries()].filter(([name, list]) => name && list.some(task => String(task.description).includes('[toolkit-task v1 '))).map(([name]) => name); },
    register(d) {
      calls.push(['register', d.folder, d.name]);
      const list = folders.get(d.folder) || [];
      const existing = list.find(task => task.name === d.name);
      if (existing && !String(existing.description).includes(`[toolkit-task v1 id=${d.id} `)) throw new Error('not Toolkit\'s');
      const task = { name: d.name, description: d.description, state: d.enabled === false ? 'Disabled' : 'Ready', execute: d.execute, arguments: d.arguments, working_directory: d.working_directory,
        triggers: d.schedule.kind === 'hourly' ? [{ kind: 'MSFT_TaskDailyTrigger', start: `2026-10-29T${d.schedule.at}:00+08:00`, interval: 'PT1H', duration: d.schedule.hours === 24 ? 'P1D' : `PT${d.schedule.hours}H` }]
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
    setEnabled(folder, name, enabled) { calls.push(['enabled', folder, name, enabled]); const task = of(folder).find(row => row.name === name); if (!task) throw new Error('missing task'); if (task.state !== 'Running' && task.state !== 'Queued') task.state = enabled ? 'Ready' : 'Disabled'; task.enabled = enabled; },
    stop(folder, name) { calls.push(['stop', folder, name]); const task = of(folder).find(row => row.name === name); task.state = task.enabled === false ? 'Disabled' : 'Ready'; },
    start(folder, name) { calls.push(['start', folder, name]); if (this.onStart) this.onStart(of(folder).find(item => item.name === name)); },
    info(folder, name) { const task = of(folder).find(item => item.name === name); return { state: task.state, last_run: task.last_run, last_result: task.last_result }; },
  };
}

function desired(t, options = {}) {
  return windowsTasks.desiredTasks({ checkout: options.root || checkout(t, options), toolkitRoot: TOOLKIT_ROOT, nodePath: options.nodePath || NODE, systemRoot: 'C:\\Windows',
    folder: options.folder || 'TOOLKIT', deps: { governance: governance(options) } });
}

const unmarked = (name, extra = {}) => ({ name, description: 'My own task', state: 'Ready', execute: 'C:\\x.exe', arguments: '', working_directory: '', triggers: [], last_run: null, last_result: 0, ...extra });

// ---- G. install, reinstall and remove --------------------------------------------------------

test('G: an ENABLED Toolkit checkout gets two tasks in \\TOOLKIT\\, recorded in the registry', (t) => {
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
    [['toolkit-programme-sweep', 'TOOLKIT', 'hourly, 00:00 to 23:59', null, null], ['toolkit-shard-timings', 'TOOLKIT', 'weekly, Monday 09:15', null, null]]);
  const report = windowsTasks.describePlan(result, { applied: true }).join('\n');
  assert.match(report, /TOOLKIT - PROGRAMME SWEEP \(hourly, 00:00 to 23:59\): created\. Cleans your own GitHub posts first/);
  assert.match(report, /TOOLKIT - SHARD TIMINGS \(weekly, Monday 09:15\): created\./);
  if (process.platform !== 'win32') assert.equal((fs.statSync(tasks.registryPath(home)).mode & 0o777), 0o600);
  const sweep = wanted.wanted[0];
  assert.equal(sweep.execute, 'C:\\Windows\\System32\\conhost.exe');
  assert.equal(sweep.arguments, `--headless "${NODE}" "${TOOLKIT_ROOT}\\repo\\scripts\\toolkit-scheduled-job.cjs" programme-sweep --repo-root "${wanted.root}" --task-id toolkit-programme-sweep`);
  assert.match(sweep.description, /^TOOLKIT: PROGRAMME SWEEP\. .*\[toolkit-task v1 id=toolkit-programme-sweep def=[0-9a-f]{12}\]$/);
});

test('G: a repository that is not ENABLED gets no programme sweep, and the report says why', (t) => {
  for (const state of ['DISABLED', 'UNDECIDED', 'UNAVAILABLE', 'ERROR']) {
    const plan = windowsTasks.planTasks(desired(t, { state, shards: false }), { scheduler: fakeScheduler(), home: tempHome(t) });
    assert.deepEqual(plan.items.map(item => item.definition.job), ['footer-sweep']);
    const text = windowsTasks.describePlan(plan, { command: 'node x apply' }).join('\n');
    assert.match(text, new RegExp(`PROGRAMME SWEEP: not registered, because GitHub governance is ${state} here`));
    assert.match(text, /SHARD TIMINGS: not registered, because only the Toolkit repository has CI shards to time/);
    assert.match(text, /paste this line/);
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
  assert.deepEqual(tasks.readRegistry(home).tasks.map(entry => entry.definition), [...changed.wanted].sort((a, b) => a.id.localeCompare(b.id)).map(d => d.def));
  assert.equal(scheduler.folders.get('TOOLKIT').length, 2, 'updated in place, not added');
});

test('G: the owner\'s own same-named task without the marker is untouched and Toolkit refuses', (t) => {
  const home = tempHome(t);
  const own = unmarked('TOOLKIT - PROGRAMME SWEEP');
  const scheduler = fakeScheduler({ TOOLKIT: [own] });
  const wanted = desired(t, { shards: false });
  wanted.wanted = wanted.wanted.filter(d => d.job === 'programme-sweep');
  const result = windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.equal(result.items[0].action, 'refused');
  assert.match(result.items[0].reason, /is already in \\TOOLKIT\\ and is not Toolkit's .* leaves it alone/);
  assert.deepEqual(scheduler.folders.get('TOOLKIT'), [own]);
  assert.deepEqual(tasks.readRegistry(home).tasks, []);
  assert.equal(scheduler.calls.some(call => call[0] === 'register'), false);
  // A marked task this computer did not record is not Toolkit's either.
  const marked = { ...own, description: `${wanted.wanted[0].description}` };
  const second = windowsTasks.planTasks(wanted, { scheduler: fakeScheduler({ TOOLKIT: [marked] }), home });
  assert.equal(second.items[0].action, 'refused');
  assert.match(second.items[0].reason, /carries Toolkit's marker but this computer's task registry does not list it/);
  const lines = [];
  const code = windowsTasks.main(['apply', '--no-first-run'], { platform: 'win32', home, scheduler, cwd: checkout(t, { shards: false }), checkoutDeps: { governance: governance() }, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, stdout: text => lines.push(text), stderr: () => {} });
  assert.equal(code, 1);
  assert.match(lines.join(''), /PROGRAMME SWEEP \(hourly, 00:00 to 23:59\): refused/);
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
  assert.deepEqual(tasks.readRegistry(home).tasks.map(entry => entry.id), ['session-digest'], 'an adopted task stays recorded and untouched');
  // With nothing else in it, the folder goes too.
  const home2 = tempHome(t);
  const empty = fakeScheduler();
  windowsTasks.applyTasks(desired(t), { scheduler: empty, home: home2 });
  assert.deepEqual(windowsTasks.removeTasks({ scheduler: empty, home: home2 }).folders, [{ folder: 'TOOLKIT', result: 'removed' }]);
  assert.equal(empty.folders.has('TOOLKIT'), false);
  assert.deepEqual(tasks.readRegistry(home2).tasks, []);
  // A recorded task whose marker was edited away is left alone.
  const home3 = tempHome(t);
  const edited = fakeScheduler();
  windowsTasks.applyTasks(desired(t, { shards: false }), { scheduler: edited, home: home3 });
  edited.folders.get('TOOLKIT')[0].description = 'changed by hand';
  assert.equal(windowsTasks.removeTasks({ scheduler: edited, home: home3 }).items.find(item => item.name === 'TOOLKIT - PROGRAMME SWEEP').action, 'refused');
  assert.equal(edited.folders.get('TOOLKIT').length, 1);
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

test('G: plan prints the PowerShell line to paste, with the profile folder as $env:USERPROFILE', (t) => {
  const home = 'C:\\Users\\someone';
  const wanted = desired(t, { root: 'C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit' });
  const command = windowsTasks.applyCommand(wanted, { toolkitRoot: 'C:\\Users\\someone\\.ai-agent-toolkit\\source\\ai-agent-toolkit', home });
  assert.equal(command, 'node "$env:USERPROFILE\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\toolkit-windows-tasks.cjs" apply --repo-root "$env:USERPROFILE\\.ai-agent-toolkit\\source\\ai-agent-toolkit"');
  const text = windowsTasks.describePlan(windowsTasks.planTasks(wanted, { scheduler: fakeScheduler(), home: tempHome(t) }), { command }).join('\n');
  assert.match(text, /Agents do not create scheduled tasks, so paste this line into PowerShell yourself/);
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
  const onlyProgramme = desired(t, { shards: false });
  onlyProgramme.wanted = onlyProgramme.wanted.filter(d => d.job === 'programme-sweep');
  const result = windowsTasks.applyTasks(onlyProgramme, { scheduler, home, now, firstRunOptions: { wait: () => {}, waitMs: 10, pollMs: 5 } });
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
    tasks.writeLastRun('toolkit-programme-sweep', { started: new Date(clock).toISOString(), exit: 1, status: 'failed', summary: ['Programme refresh failed (exit 2): stopped.'] }, home3);
  };
  const unhealthy = windowsTasks.applyTasks(desired(t, { shards: false }), { scheduler: failing, home: home3, now, firstRunOptions: { wait: () => {}, waitMs: 10, pollMs: 5 } });
  assert.equal(unhealthy.items[0].first_run.status, 'failed');
  assert.match(unhealthy.items[0].first_run.detail, /^failed: Programme refresh failed/);
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

test('G: setup only plans and reports the tasks, and --remove-toolkit-tasks removes only Toolkit\'s own', async (t) => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const home = tempHome(t);
  const root = checkout(t);
  const scheduler = fakeScheduler();
  const lines = [];
  const plan = core.printWindowsTasks({ repoRoot: root }, { platform: 'win32', scheduler, workingFolder: root, checkoutDeps: { governance: governance() }, home, log: line => lines.push(line) });
  assert.deepEqual(plan[0].items.map(item => item.action), ['create', 'create']);
  const text = lines.join('\n');
  assert.match(text, /## Windows scheduled tasks\nWindows scheduled tasks for weijunswj\/ai-agent-toolkit in \\TOOLKIT\\:/);
  assert.match(text, /paste this line into PowerShell yourself[\s\S]*toolkit-windows-tasks\.cjs" apply --repo-root /);
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

const GOVERNED = { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true } }) };
const BINDING = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'toolkit-programme.json'), 'utf8'));
const IDENTITY = root => ({ valid: true, root, remote: { host: 'github.com', path: '/weijunswj/ai-agent-toolkit.git' } });
const OBSERVATION = () => ({ status: 'enabled', fresh: true, binding: BINDING() });
const JOB_DEPS = { readIdentity: IDENTITY, readObservation: OBSERVATION };
const ATTENTION = { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', text: 'Attention: clear (stored on #421, written 3 min ago)' }) };
const options = { job: 'programme-sweep', repoRoot: REPO_ROOT, taskId: 'toolkit-programme-sweep' };

function runSweep(t, answers, home = tempHome(t), clock = '2026-10-29T09:00:00.000Z') {
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob(options, { home, run: fake.run, ghPath: GH, nodePath: NODE, ...JOB_DEPS, now: () => new Date(clock) });
  return { record, log: fake.log, home };
}

const footerOptions = { ...options, job: 'footer-sweep', taskId: 'toolkit-footer-sweep' };

function migrationRun(t, { home = tempHome(t), scheduler = fakeScheduler(), answers = {}, deps = {}, clock = '2026-10-29T09:00:00.000Z', mode = 'programme-sweep' } = {}) {
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob(mode === 'programme-sweep' ? options : footerOptions,
    { home, scheduler, run: fake.run, ghPath: GH, nodePath: NODE, ...JOB_DEPS, now: () => new Date(clock),
      // File mtimes keep real time in clock-ahead tests; use that clock for the real lock too.
      takeLock: file => require('../../skills/github-program-reconciler/scripts/programme.cjs').takeLock(file, { nowMs: Math.round(performance.timeOrigin + performance.now()) }), ...deps });
  return { home, scheduler, record, log: fake.log };
}
// Actual base runner and tasks, extracted unchanged. Only process, binding and clock effects
// are injected. Its returned receipt is the legacy fixture, never a hand-written imitation.
function baseRun(t, home, clock = '2026-10-01T09:00:00Z', answers = {}, taskOptions = options) {
  const { execFileSync } = require('node:child_process');
  const Module = require('node:module');
  const scratch = checkout(t, { shards: false });
  const source = name => {
    const bytes = execFileSync('git', ['show', `b242752b9f011db82d1961aebe69005bf1b78dd6:repo/scripts/${name}`], { cwd: ROOT, timeout: 10000 });
    const file = path.join(scratch, name); fs.writeFileSync(file, bytes);
    const mod = new Module(file);
    const originalRequire = Module.createRequire(path.join(ROOT, 'repo/scripts', name));
    mod.require = id => id === './toolkit-tasks.cjs' ? baseTasks : originalRequire(id);
    mod._compile(bytes.toString(), file);
    return mod.exports;
  };
  const baseTasks = source('toolkit-tasks.cjs');
  const base = source('toolkit-scheduled-job.cjs');
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  let milliseconds = Date.parse(clock);
  const now = () => new Date(milliseconds += 1000);
  const record = base.runJob(taskOptions, { home, ghPath: GH, nodePath: NODE, mergedBinding: BINDING, now,
    run: (...args) => { milliseconds += 10000; return fake.run(...args); } });
  assert.ok(Date.parse(record.started) < Date.parse(record.footer_sweep_since));
  assert.ok(Date.parse(record.footer_sweep_since) < Date.parse(record.finished));
  assert.equal(record.repository, undefined, 'base receipts have no repository field');
  return record;
}

function movingRun(t, { home = tempHome(t), mode = 'programme-sweep', clock = '2026-10-29T09:00:00Z', answers = {}, deps = {} } = {}) {
  let milliseconds = Date.parse(clock);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const ticks = [];
  const record = job.runJob(mode === 'programme-sweep' ? options : footerOptions, {
    home, ...JOB_DEPS, ghPath: GH, nodePath: NODE,
    takeLock: file => require('../../skills/github-program-reconciler/scripts/programme.cjs').takeLock(file, { nowMs: Math.round(performance.timeOrigin + performance.now()) }),
    now: () => { ticks.push(milliseconds += 1000); return new Date(milliseconds); },
    run: (...args) => { milliseconds += 10000; return fake.run(...args); }, ...deps,
  });
  return { record, log: fake.log, ticks, home };
}
const sweepCall = result => result.log.find(row => path.basename(row[1] || '') === 'toolkit-github-footer-sweep.cjs');
const sinceOf = result => { const call = sweepCall(result); return call && call[call.indexOf('--since') + 1]; };

test('Reassessment H1 and M1: actual base P receipt survives two moving-clock updates without apply', t => {
  const home = tempHome(t);
  const base = baseRun(t, home);
  let cursor = base.footer_sweep_since;
  for (const clock of ['2026-10-29T09:00:00Z', '2026-10-29T10:00:00Z']) {
    const result = movingRun(t, { home, clock, deps: {
      scheduler: new Proxy({}, { get: () => assert.fail('runtime must never read the scheduler') }),
      readRegistry: () => assert.fail('runtime must never import registry history'),
    } });
    assert.equal(sinceOf(result), cursor);
    assert.equal(result.record.status, 'ok');
    assert.ok(Date.parse(result.record.started) < Date.parse(result.record.footer_sweep_since));
    assert.ok(Date.parse(result.record.footer_sweep_since) < Date.parse(result.record.finished));
    assert.ok(result.ticks.every((tick, i) => !i || tick > result.ticks[i - 1]));
    assert.equal(result.log.filter(row => path.basename(row[1] || '') === 'toolkit-governance.cjs').length, 1);
    assert.equal(result.log.filter(row => row[0] === GH).length, 1);
    assert.ok(result.log.indexOf(sweepCall(result)) < result.log.findIndex(row => row[2] === 'refresh'));
    assert.equal('footer_handover' in result.record || 'footer_setup' in result.record, false);
    cursor = result.record.footer_sweep_since;
  }
});

const RUNTIME_MATRIX = [
  ['enabled', GOVERNED, OBSERVATION, 2, true, true],
  ...['disabled', 'none'].map(status => [status, { status: 0, stdout: JSON.stringify({ state: status === 'none' ? 'UNDECIDED' : 'DISABLED', merged: { status, fresh: true } }) }, () => ({ status, fresh: true }), 1, false, true]),
  ['uncertain', { status: 1 }, OBSERVATION, 1, false, false],
];
for (const mode of ['programme-sweep', 'footer-sweep']) for (const [state, answer, observation, targets, programme, advances] of RUNTIME_MATRIX) {
  test(`Runtime matrix: ${mode}, ${state}, repeated after 48 hours`, t => {
    const home = tempHome(t);
    const legacy = baseRun(t, home);
    if (mode === 'footer-sweep') tasks.writeLastRun(footerOptions.taskId, { ...legacy, id: footerOptions.taskId, job: mode }, home);
    let cursor = legacy.footer_sweep_since;
    for (const clock of ['2026-10-29T09:00:00Z', '2026-11-03T09:00:00Z']) {
      const result = movingRun(t, { home, mode, clock, answers: { 'toolkit-governance.cjs': answer }, deps: { readObservation: observation } });
      assert.equal(sinceOf(result), cursor);
      assert.equal(sweepCall(result).filter(arg => arg === '--repo').length, targets);
      assert.equal(result.log.some(row => row[2] === 'refresh'), mode === 'programme-sweep' && programme);
      assert.equal(result.record.exit, 0);
      assert.equal(result.record.status, mode === 'programme-sweep' && !programme ? 'skipped' : advances ? 'ok' : 'held');
      if (advances) assert.ok(Date.parse(result.record.footer_sweep_since) > Date.parse(result.record.started));
      else { assert.equal(result.record.footer_sweep_since, cursor); assert.match(result.record.summary.join(' '), /Evidence store cleaning withheld/); }
      cursor = result.record.footer_sweep_since;
    }
  });
}

test('Watermarks: malformed, null identity, rename and future history recover without a permanent hold', t => {
  for (const variant of ['broken-json', 'bad-time', 'impossible-date', 'future', 'foreign', 'wrong-id', 'wrong-job', 'wrong-schema', 'null-identity']) {
    const home = tempHome(t);
    const legacy = baseRun(t, home);
    const changed = { ...legacy };
    if (variant === 'bad-time') changed.footer_sweep_since = 'bad';
    if (variant === 'impossible-date') changed.footer_sweep_since = '2026-02-30T00:00:00.000Z';
    if (variant === 'future') changed.footer_sweep_since = '2099-01-01T00:00:00.000Z';
    if (variant === 'foreign') changed.repository = 'renamed/repo';
    if (variant === 'null-identity') changed.repository = null;
    if (variant === 'wrong-id') changed.id = 'other-id';
    if (variant === 'wrong-job') changed.job = 'shard-timings';
    if (variant === 'wrong-schema') changed.schema = 'other';
    tasks.writeLastRun(options.taskId, changed, home);
    if (variant === 'broken-json') fs.writeFileSync(tasks.lastRunPath(options.taskId, home), '{broken');
    const first = movingRun(t, { home });
    assert.equal(first.record.status, 'ok', variant);
    if (variant === 'null-identity') assert.equal(sinceOf(first), legacy.footer_sweep_since);
    else {
      assert.ok(Date.parse(sinceOf(first)) >= Date.parse(first.record.started) - 48 * 3600000);
      assert.match(first.record.summary.join(' '), /Older posts may need a separately authorised full-history cleanup/);
      assert.match(first.record.summary.join(' '), variant === 'future' ? /clock anomaly/ : /Footer history could not be read/);
    }
    const second = movingRun(t, { home, clock: '2026-11-03T09:00:00Z' });
    assert.equal(second.record.status, 'ok');
    assert.equal(sinceOf(second), first.record.footer_sweep_since);
    assert.doesNotMatch(second.record.summary.join(' '), /history could not be read|clock anomaly/);
  }
});

test('Watermarks: failure, process interruption and withheld stores retain base history beyond 48 hours', t => {
  for (const variant of ['failed', 'interrupted', 'store-held']) {
    const home = tempHome(t), legacy = baseRun(t, home);
    const answers = variant === 'store-held' ? { 'toolkit-governance.cjs': { status: 1 } }
      : { 'toolkit-github-footer-sweep.cjs': () => {
        assert.equal(tasks.readLastRun(options.taskId, home).footer_sweep_since, legacy.footer_sweep_since);
        if (variant === 'interrupted') throw new Error('interrupt');
        return { status: 1 };
      } };
    const first = movingRun(t, { home, answers });
    assert.equal(first.record.footer_sweep_since, legacy.footer_sweep_since);
    const next = movingRun(t, { home, clock: '2026-11-03T09:00:00Z' });
    assert.equal(sinceOf(next), legacy.footer_sweep_since);
    assert.equal(next.record.status, 'ok');
  }
});

test('L7: footer failure wins over ok, held, skipped and failed programme results', t => {
  for (const state of ['ok', 'held', 'skipped', 'failed']) {
    const answers = { 'toolkit-github-footer-sweep.cjs': { status: 1 },
      ...(state === 'skipped' ? { 'toolkit-governance.cjs': { status: 1 } } : {}),
      'programme refresh': { status: state === 'held' ? 1 : state === 'failed' ? 2 : 0 } };
    const result = movingRun(t, { answers });
    assert.deepEqual([result.record.status, result.record.exit, result.record.footer_status, result.record.programme_status], ['failed', 1, 'failed', state]);
  }
});

test('L9 and locking: throwing lock, concurrent starts and apply contention isolate footer effects', t => {
  const thrown = movingRun(t, { deps: { takeLock: () => { throw new Error('private failure'); } } });
  assert.equal(thrown.record.status, 'failed'); assert.equal(thrown.record.exit, 1);
  assert.ok(thrown.log.some(row => row[2] === 'refresh')); assert.equal(sweepCall(thrown), undefined);
  assert.doesNotMatch(thrown.record.summary.join(' '), /private failure/);
  const home = tempHome(t), scheduler = fakeScheduler();
  const legacy = baseRun(t, home);
  let competing;
  const first = movingRun(t, { home, answers: { 'toolkit-github-footer-sweep.cjs': () => {
    competing = movingRun(t, { home });
    assert.equal(sweepCall(competing), undefined);
    assert.equal(tasks.readLastRun(options.taskId, home).footer_sweep_since, legacy.footer_sweep_since);
    assert.throws(() => windowsTasks.applyTasks(desired(t, { shards: false }), { home, scheduler, takeLock: file => require('../../skills/github-program-reconciler/scripts/programme.cjs').takeLock(file, { nowMs: Math.round(performance.timeOrigin + performance.now()) }) }), /another footer pass or apply/);
    assert.equal(scheduler.calls.length, 0);
    return { status: 1 };
  } } });
  assert.equal(competing.record.footer_status, 'held');
  assert.equal(first.record.footer_sweep_since, legacy.footer_sweep_since);
});

test('L8: fixed metadata mismatch diagnostic retains cursor, corrected origin succeeds', t => {
  const home = tempHome(t), legacy = baseRun(t, home);
  const first = movingRun(t, { home, answers: { 'toolkit-github-footer-sweep.cjs': { status: 1, stdout: JSON.stringify({ results: [{ status: 'FAILED', reason: 'repository-identity-mismatch', detail: 'private API text' }] }) } } });
  assert.match(first.record.summary.join(' '), /renamed repository or stale origin/);
  assert.doesNotMatch(first.record.summary.join(' '), /private API text/);
  assert.equal(first.record.footer_sweep_since, legacy.footer_sweep_since);
  const next = movingRun(t, { home, clock: '2026-11-03T09:00:00Z' });
  assert.equal(next.record.status, 'ok'); assert.equal(sinceOf(next), legacy.footer_sweep_since);
});

const TRANSITIONS = [
  ['ENABLED', 'DISABLED', 'footer-sweep', 'replace'],
  ['DISABLED', 'ENABLED', 'programme-sweep', 'replace'],
  ['ENABLED', 'UNAVAILABLE', 'programme-sweep', 'current'],
  ['DISABLED', 'UNAVAILABLE', 'footer-sweep', 'current'],
  [null, 'ENABLED', 'programme-sweep', 'create'],
  [null, 'UNAVAILABLE', 'footer-sweep', 'create'],
];
for (const [installed, state, expected, action] of TRANSITIONS) test(`Transition: ${installed || 'absent'} to ${state}`, t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
  if (installed) windowsTasks.applyTasks(desired(t, { root, state: installed, shards: false }), { home, scheduler });
  const wanted = desired(t, { root, state, shards: false });
  const plan = windowsTasks.planTasks(wanted, { home, scheduler });
  assert.equal(plan.items[0].definition.job, expected); assert.equal(plan.items[0].action, action);
  if (state === 'UNAVAILABLE') assert.match(plan.note, /preserving/);
  const result = windowsTasks.applyTasks(wanted, { home, scheduler });
  assert.equal(result.items[0].done, true);
  assert.equal(tasks.readRegistry(home).tasks.filter(row => ['programme-sweep', 'footer-sweep'].includes(row.job)).length, 1);
  assert.equal([...scheduler.folders.values()].flat().length, 1);
  assert.equal(windowsTasks.applyTasks(wanted, { home, scheduler }).items[0].action, 'current');
});

test('Transitions: on/off/on apply preserves earliest source/destination cursor, folder and owner stop', t => {
  for (const stopped of [false, true]) {
    const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
    windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
    const legacy = baseRun(t, home);
    tasks.writeLastRun(footerOptions.taskId, { ...legacy, id: footerOptions.taskId, job: 'footer-sweep', footer_sweep_since: '2026-09-01T00:00:00.000Z' }, home);
    if (stopped) scheduler.setEnabled('TOOLKIT', 'TOOLKIT - PROGRAMME SWEEP', false);
    for (const state of ['DISABLED', 'ENABLED']) {
      const wanted = desired(t, { root, state, shards: false });
      const result = windowsTasks.applyTasks(wanted, { home, scheduler, firstRunOptions: stopped ? { wait: () => assert.fail('disabled task must not start') } : null });
      // Enabled first-run behaviour is separately covered; use no-first-run for this cursor proof.
      if (!stopped) assert.equal(result.items[0].done, true);
      const live = [...scheduler.folders.values()].flat();
      assert.equal(live.length, 1); assert.equal(live[0].state, stopped ? 'Disabled' : 'Ready');
      assert.equal(tasks.readLastRun(result.items[0].definition.id, home).footer_sweep_since, '2026-09-01T00:00:00.000Z');
    }
  }
});

test('Transitions: a missing destination copies a recent valid source cursor exactly', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
  windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
  const legacy = baseRun(t, home, '2026-10-29T09:00:00Z');
  const result = windowsTasks.applyTasks(desired(t, { root, state: 'DISABLED', shards: false }), { home, scheduler, now: () => new Date('2026-10-29T10:00:00Z') });
  assert.equal(result.items[0].done, true);
  assert.equal(tasks.readLastRun(footerOptions.taskId, home).footer_sweep_since, legacy.footer_sweep_since);
});

test('Transitions: unreadable replacement history prints the bounded fallback before a first run', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
  windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
  baseRun(t, home);
  fs.writeFileSync(tasks.lastRunPath(options.taskId, home), '{broken');
  const result = windowsTasks.applyTasks(desired(t, { root, state: 'DISABLED', shards: false }), { home, scheduler });
  assert.equal(result.items[0].done, true);
  assert.match(windowsTasks.describePlan(result, { applied: true }).join('\n'), /Footer history could not be read; scanning the last 48 hours. Older posts may need a separately authorised full-history cleanup/);
});

test('Transitions: cross-folder reconciliation, foreign collision, changed, adopted and unknown source refusal', t => {
  for (const variant of ['owned', 'foreign', 'changed', 'adopted', 'unrecorded', 'running', 'disabled', 'removed']) {
    const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
    const old = desired(t, { root, folder: 'OLD', repository: 'alice/app', shards: false });
    windowsTasks.applyTasks(old, { home, scheduler });
    const live = scheduler.folders.get('OLD')[0];
    if (variant === 'changed') live.arguments += ' --changed';
    if (variant === 'adopted') tasks.updateRegistry(home, rows => rows.map(row => ({ ...row, adopted: true })));
    if (variant === 'unrecorded') tasks.writeRegistry(home, []);
    if (variant === 'running') live.state = 'Running';
    if (variant === 'disabled') live.state = 'Disabled';
    if (variant === 'removed') scheduler.folders.set('OLD', []);
    const wanted = desired(t, { root, folder: variant === 'foreign' ? 'OLD' : 'NEW', repository: variant === 'foreign' ? 'bob/app' : 'alice/app', shards: false });
    const result = windowsTasks.applyTasks(wanted, { home, scheduler });
    const refused = ['foreign', 'changed', 'adopted', 'unrecorded'].includes(variant);
    assert.equal(result.items[0].action === 'refused', refused, variant);
    if (refused) assert.equal(scheduler.calls.filter(row => row[0] === 'register').length, 1);
    else {
      assert.equal(result.items[0].done, true, JSON.stringify(result.items[0]));
      assert.equal([...scheduler.folders.values()].flat().length, 1);
      if (variant === 'disabled') assert.equal(scheduler.folders.get('NEW')[0].state, 'Disabled');
    }
  }
});

test('Transitions: unrelated adopted tasks in the same folder keep their configuration', t => {
  for (const repository of [null, 'weijunswj/ai-agent-toolkit']) {
    const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
    windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
    const owner = unmarked('Session Digest'); scheduler.folders.get('TOOLKIT').push(owner);
    windowsTasks.adoptTask({ folder: 'TOOLKIT', task: owner.name, id: 'digest', purpose: 'Owner task.', repository }, { home, scheduler });
    const result = windowsTasks.applyTasks(desired(t, { root, state: 'DISABLED', shards: false }), { home, scheduler });
    assert.equal(result.items[0].done, true);
    assert.deepEqual(scheduler.folders.get('TOOLKIT').find(row => row.name === owner.name), owner);
    assert.equal(tasks.readRegistry(home).tasks.find(row => row.id === 'digest').adopted, true);
  }
});


test('Transitions: each replacement mutation failure restores, each interruption snapshot is repeatable', t => {
  const mutationSteps = ['prepare-registry', 'prepare-destination', 'disable-source', 'copy-cursor', 'retire-source', 'commit-registry', 'enable-destination'];
  for (const failedStep of mutationSteps) {
    const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
    windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
    const originalRegistry = tasks.readRegistry(home).tasks;
    const legacy = baseRun(t, home);
    const wanted = desired(t, { root, state: 'DISABLED', shards: false });
    const snapshots = [];
    let fired = false, registryWrites = 0;
    const capture = step => {
      if (fired) return; // Only replacement boundaries, not a second interruption during rollback.
      const rows = tasks.readRegistry(home).tasks;
      const definitions = Object.fromEntries([...scheduler.folders].map(([folder, live]) => [folder, structuredClone(live)]));
      const records = Object.fromEntries([options.taskId, footerOptions.taskId].map(id => [id, tasks.readLastRun(id, home)]));
      snapshots.push({ step, rows, definitions, records });
      assert.ok(Object.values(definitions).flat().filter(row => row.state !== 'Disabled').length <= 1, step);
      if (step === failedStep && !fired) { fired = true; throw new Error(`injected ${step}`); }
    };
    const wrap = (method, stepOf) => {
      const original = scheduler[method];
      scheduler[method] = (...args) => { const result = original(...args); capture(stepOf(...args)); return result; };
    };
    wrap('register', () => 'prepare-destination');
    wrap('setEnabled', (folder, name, enabled) => enabled ? 'enable-destination' : 'disable-source');
    wrap('unregister', () => 'retire-source');
    const result = windowsTasks.applyTasks(wanted, { home, scheduler,
      writeRegistry: rows => { tasks.writeRegistry(home, rows); capture(++registryWrites === 1 ? 'prepare-registry' : 'commit-registry'); },
      writeRecord: (id, record) => { tasks.writeLastRun(id, record, home); capture('copy-cursor'); },
    });
    assert.ok(fired, failedStep);
    assert.equal(result.items[0].done, false, failedStep);
    assert.match(result.items[0].error, /previous configuration restored and verified/, failedStep);
    assert.deepEqual(tasks.readRegistry(home).tasks, originalRegistry);
    assert.equal(scheduler.folders.get('TOOLKIT').length, 1);
    assert.equal(scheduler.folders.get('TOOLKIT')[0].state, 'Ready');
    assert.equal(tasks.readLastRun(options.taskId, home).footer_sweep_since, legacy.footer_sweep_since);
    // A process kill cannot execute catch/rollback. Replay every observed mutation boundary
    // with precisely its live definitions, registry and records, then repeat owner-run apply.
    for (const snapshot of snapshots.filter(row => mutationSteps.includes(row.step))) {
      const replayHome = tempHome(t), replay = fakeScheduler(snapshot.definitions);
      tasks.writeRegistry(replayHome, snapshot.rows);
      for (const [id, record] of Object.entries(snapshot.records)) if (record) tasks.writeLastRun(id, record, replayHome);
      const repaired = windowsTasks.applyTasks(wanted, { home: replayHome, scheduler: replay });
      assert.ok(repaired.items.every(row => row.done), `${failedStep}/${snapshot.step}: ${JSON.stringify(repaired.items)}`);
      assert.equal([...replay.folders.values()].flat().length, 1);
      assert.equal(tasks.readRegistry(replayHome).tasks.filter(row => ['programme-sweep', 'footer-sweep'].includes(row.job)).length, 1);
      assert.equal(windowsTasks.applyTasks(wanted, { home: replayHome, scheduler: replay }).items[0].action, 'current');
    }
  }
});

test('Transitions: rollback failure is visible, read-back mismatch refuses success and no first run escapes', t => {
  for (const variant of ['readback', 'restore-fails']) {
    const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
    windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
    const register = scheduler.register;
    scheduler.register = d => {
      if (variant === 'restore-fails') throw new Error('register failed');
      register(d);
      if (d.job === 'footer-sweep') scheduler.folders.get(d.folder).find(row => row.name === d.name).arguments += ' changed';
    };
    const result = windowsTasks.applyTasks(desired(t, { root, state: 'DISABLED', shards: false }), { home, scheduler, firstRunOptions: {} });
    assert.equal(result.items[0].done, false);
    assert.match(result.items[0].error, variant === 'readback' ? /read-back failed; previous configuration restored and verified/ : /restoration incomplete; inspect the source and destination tasks and rerun apply/);
    assert.equal(scheduler.calls.some(row => row[0] === 'start'), false);
  }
});

test('Transitions: interrupted in-place schedule updates recognise only the two reviewed definitions', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
  const wanted = desired(t, { root, shards: false });
  windowsTasks.applyTasks(wanted, { home, scheduler });
  const changed = desired(t, { root, shards: false, nodePath: 'D:\\node\\node.exe' });
  const snapshots = [];
  const capture = () => snapshots.push({ rows: tasks.readRegistry(home).tasks, live: structuredClone(scheduler.folders.get('TOOLKIT')) });
  const register = scheduler.register;
  scheduler.register = d => { register(d); capture(); };
  const result = windowsTasks.applyTasks(changed, { home, scheduler, writeRegistry: rows => { tasks.writeRegistry(home, rows); capture(); } });
  assert.equal(result.items[0].done, true);
  for (const snapshot of snapshots) {
    const replayHome = tempHome(t), replay = fakeScheduler({ TOOLKIT: snapshot.live }); tasks.writeRegistry(replayHome, snapshot.rows);
    const applied = windowsTasks.applyTasks(changed, { home: replayHome, scheduler: replay });
    assert.equal(applied.items[0].done, true, JSON.stringify(applied.items));
    assert.equal(tasks.readRegistry(replayHome).tasks[0].pending_definition, undefined);
    assert.equal(replay.folders.get('TOOLKIT').length, 1);
  }
  const pending = snapshots.find(row => row.rows[0].pending_definition);
  const refusedHome = tempHome(t), refused = fakeScheduler({ TOOLKIT: pending.live }); tasks.writeRegistry(refusedHome, pending.rows);
  refused.folders.get('TOOLKIT')[0].arguments += ' --unreviewed';
  assert.equal(windowsTasks.applyTasks(changed, { home: refusedHome, scheduler: refused }).items[0].action, 'refused');
});

test('Transitions: duplicate known cleaners reconcile, disabled or absent tasks never trigger substitutes', t => {
  const home = tempHome(t), scheduler = fakeScheduler(), root = checkout(t, { shards: false });
  const both = desired(t, { root, shards: false }); both.wanted = both.cleaners;
  // Seed an invalid two-cleaner installation through the same registered definitions/registry.
  for (const d of both.cleaners) { scheduler.register(d); tasks.updateRegistry(home, rows => [...rows, { id: d.id, name: d.name, host: 'windows', folder: d.folder, schedule: d.schedule_text, model: null, effort: null, purpose: d.purpose, repository: d.repository, created: new Date().toISOString(), created_by: 'toolkit-windows-tasks apply', job: d.job, definition: d.def }]); }
  const result = windowsTasks.applyTasks(desired(t, { root, shards: false }), { home, scheduler });
  assert.equal(result.items[0].action, 'replace'); assert.equal(result.items[0].done, true);
  assert.equal([...scheduler.folders.values()].flat().length, 1);
  scheduler.setEnabled('TOOLKIT', 'TOOLKIT - PROGRAMME SWEEP', false);
  const before = scheduler.calls.length;
  assert.equal(windowsTasks.planTasks(desired(t, { root, shards: false }), { home, scheduler }).items[0].action, 'current');
  assert.ok(scheduler.calls.slice(before).every(row => row[0] === 'list'));
  scheduler.folders.set('TOOLKIT', []);
  const empty = scheduler.calls.length;
  const plan = windowsTasks.planTasks(desired(t, { root, shards: false }), { home, scheduler });
  assert.equal(plan.items[0].action, 'create');
  assert.ok(scheduler.calls.slice(empty).every(row => row[0] === 'list'));
  assert.equal([...scheduler.folders.values()].flat().length, 0, 'planning never resurrects an owner-removed task');
});

test('Runtime planning changes never switch an installed cleaner; governance on/off/on stays guarded', t => {
  for (const mode of ['programme-sweep', 'footer-sweep']) {
    const home = tempHome(t);
    for (const state of ['UNAVAILABLE', 'ENABLED', 'DISABLED', 'ENABLED']) {
      const wanted = desired(t, { state, shards: false });
      // Plans are offers only. A later run may see a wholly different observation.
      assert.equal(fs.existsSync(tasks.registryPath(home)), false);
      const enabled = state === 'ENABLED';
      const answer = enabled ? GOVERNED : { status: 0, stdout: JSON.stringify({ state, merged: { status: state === 'DISABLED' ? 'disabled' : 'unknown', fresh: state === 'DISABLED' } }) };
      const observation = enabled ? OBSERVATION : () => ({ status: state === 'DISABLED' ? 'disabled' : 'unknown', fresh: state === 'DISABLED' });
      const result = movingRun(t, { home, mode, answers: { 'toolkit-governance.cjs': answer }, deps: { readObservation: observation } });
      assert.ok(sweepCall(result));
      assert.equal(result.record.job, mode);
      assert.equal(result.log.some(row => row[2] === 'refresh'), mode === 'programme-sweep' && enabled);
      assert.equal(wanted.wanted.filter(row => ['programme-sweep', 'footer-sweep'].includes(row.job)).length, 1);
    }
  }
});

test('Watermarks: a failed identity read retains history and later healthy runs clean twice', t => {
  const home = tempHome(t), legacy = baseRun(t, home);
  const missing = movingRun(t, { home, deps: { readIdentity: () => null } });
  assert.equal(sweepCall(missing), undefined); assert.equal(missing.record.footer_sweep_since, legacy.footer_sweep_since);
  for (const clock of ['2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z']) {
    const healthy = movingRun(t, { home, clock });
    assert.equal(healthy.record.status, 'ok'); assert.ok(sweepCall(healthy));
  }
});

test('Runtime matrix: both shapes preserve cursors through authentication and unusable origins', t => {
  for (const mode of ['programme-sweep', 'footer-sweep']) for (const variant of ['offline', 'signed-out', 'no-origin']) {
    const home = tempHome(t), legacy = baseRun(t, home);
    const taskOptions = mode === 'programme-sweep' ? options : footerOptions;
    if (mode === 'footer-sweep') tasks.writeLastRun(taskOptions.taskId, { ...legacy, id: taskOptions.taskId, job: mode }, home);
    const result = movingRun(t, { home, mode, answers: variant === 'no-origin' ? {} : { 'gh auth': { status: 1 }, 'reach github': { status: variant === 'offline' ? 3 : 0 } },
      deps: variant === 'no-origin' ? { readIdentity: () => null } : {} });
    assert.equal(sweepCall(result), undefined); assert.equal(result.log.some(row => row[2] === 'refresh'), false);
    assert.equal(result.record.status, 'skipped'); assert.equal(result.record.footer_sweep_since, legacy.footer_sweep_since);
    const healthy = movingRun(t, { home, mode, clock: '2026-11-03T09:00:00Z' });
    assert.equal(sinceOf(healthy), legacy.footer_sweep_since); assert.equal(healthy.record.status, 'ok');
  }
});

// The reassessed matrix replaces the unshipped runtime handover and recovery assertions.
const DELTA_CLOSURE = [
  ['GitHub transport aliases, strict slugs and foreign binding controls', t => {
    const real = require('../scripts/toolkit-governance-state.cjs');
    for (const [origin, accepted] of [['https://github.com/acme/app.git', true], ['git@github.com:acme/app.git', true], ['git@github-work:acme/app.git', true], ['ssh://git@ssh.github.com:443/acme/app.git', true], ['https://github.com.evil.test/acme/app.git', false], ['https://other.test/acme/app.git', false], ['https://github.com/acme/app/extra.git', false]]) {
      const root = checkout(t, { shards: false });
      fs.mkdirSync(path.join(root, '.git')); fs.writeFileSync(path.join(root, '.git/config'), `[remote "origin"]\nurl = ${origin}\n`);
      const identity = real.readIdentity(root);
      assert.equal(windowsTasks.repositoryOf(identity), accepted ? 'acme/app' : null, origin);
      const deps = { governance: { ...real, governanceState: () => ({ state: 'ENABLED' }), mergedBinding: () => ({ repository: 'foreign/repo', schedule_folder: 'FOREIGN' }) } };
      const read = windowsTasks.readCheckout(root, deps);
      if (accepted) { assert.equal(read.root, root); assert.equal(read.binding, null); assert.equal(windowsTasks.folderForCheckout(root, deps), 'APP'); }
      else assert.equal(read.root, null);
      const result = migrationRun(t, { mode: 'footer-sweep', deps: { readIdentity: () => identity, readObservation: OBSERVATION } });
      const call = result.log.find(row => row[1] === job.SCRIPT.footerSweep);
      assert.equal(Boolean(call), accepted);
      if (call) { assert.deepEqual(call.slice(2, 4), ['--repo', 'acme/app']); assert.equal(call.filter(x => x === '--repo').length, 1); }
      if (accepted) {
        const binding = { ...BINDING(), repository: 'acme/app' };
        const programme = migrationRun(t, { deps: { readIdentity: () => identity, readObservation: () => ({ status: 'enabled', fresh: true, binding }) } });
        assert.equal(programme.record.programme_status, 'ok', origin);
        assert.ok(programme.log.some(row => row[1] === job.SCRIPT.programme), origin);
      }
    }
  }],
  ['Status exit and JSON shape diagnostic controls', t => {
    const error = { state: 'ERROR', rule: 'M0', merged: { status: 'invalid', fresh: true } };
    for (const [answer, reason] of [[GOVERNED, null], [{ status: 2, stdout: JSON.stringify(error) }, 'binding is invalid'], ...[
      { status: 1, stdout: GOVERNED.stdout }, { status: 3, stdout: GOVERNED.stdout }, { status: null, stdout: GOVERNED.stdout },
      { status: 0, error: 'EIO', stdout: GOVERNED.stdout }, { status: 0, stdout: '' }, { status: 0, stdout: '{broken' },
      { status: 0, stdout: '{"other":true}' }, { status: 0, stdout: JSON.stringify(error) }, { status: 2, stdout: GOVERNED.stdout },
      { status: 2, stdout: JSON.stringify({ ...error, merged: { status: 'enabled', fresh: true } }) },
      { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'disabled', fresh: true } }) },
    ].map(answer => [answer, 'governance status could not be read'])]) {
      const { record, log } = runSweep(t, { 'toolkit-governance.cjs': answer });
      assert.equal(record.reason || null, reason);
      assert.equal(log.some(row => row[1] === job.SCRIPT.programme), reason === null);
      const footer = runFooter(t, { 'toolkit-governance.cjs': answer });
      assert.equal(footer.log.find(row => row[1] === job.SCRIPT.footerSweep).filter(x => x === '--repo').length, reason === null ? 2 : 1);
      if (reason) assert.match(footer.record.summary[0], new RegExp(reason));
    }
  }],
  ['Consent reflects actionable footer, programme, shard and mixed plans', t => {
    const all = desired(t); all.wanted = [...all.cleaners, ...all.wanted.filter(row => row.job === 'shard-timings')];
    for (const [jobs, actions, expected] of [
      [['footer-sweep'], ['create'], ['footer']], [['programme-sweep', 'footer-sweep'], ['update', 'create'], ['programme', 'footer']],
      [['shard-timings'], ['create'], ['shard']], [['programme-sweep', 'footer-sweep', 'shard-timings'], ['current', 'refused', 'update'], ['shard']],
      [['programme-sweep', 'footer-sweep'], ['create', 'refused'], ['programme']],
      [['programme-sweep', 'footer-sweep'], ['current', 'refused'], []],
    ]) {
      const plan = { ...all, items: jobs.map((id, i) => ({ definition: all.wanted.find(d => d.job === id), action: actions[i] })) };
      const text = windowsTasks.describePlan(plan, { command: 'node apply' }).join('\n');
      const consent = text.split('paste this line')[1] || '';
      assert.equal(consent.includes('starts the footer sweep immediately'), expected.includes('footer'));
      assert.equal(consent.includes('starts the programme sweep immediately'), expected.includes('programme'));
      assert.equal(consent.includes('without starting it immediately'), expected.includes('shard'));
      if (expected.includes('footer')) assert.match(consent, /editing the signed-in account's own GitHub posts.*only when verified/);
      if (expected.includes('programme') && !expected.includes('footer')) assert.match(consent, /cleans the signed-in account's own GitHub posts first/);
      assert.equal(consent.length > 0, expected.length > 0);
    }
  }],
  ['Both hourly first runs, retry, missing and failed result, timeout and no starts', t => {
    for (const mode of ['programme-sweep', 'footer-sweep']) for (const variant of ['healthy', 'retry', 'missing', 'failed', 'timeout', 'current', 'refused', 'no-first-run']) {
      const home = tempHome(t), scheduler = fakeScheduler();
      const wanted = desired(t, { state: mode === 'footer-sweep' ? 'DISABLED' : 'ENABLED' }); wanted.wanted = wanted.wanted.filter(row => row.job === mode);
      let count = 0, clock = Date.parse('2026-10-29T09:00:00Z');
      if (variant === 'current') windowsTasks.applyTasks(wanted, { home, scheduler });
      if (variant === 'refused') scheduler.folders.set('TOOLKIT', [unmarked(wanted.wanted[0].name)]);
      scheduler.onStart = live => {
        count += 1; live.state = variant === 'timeout' ? 'Running' : 'Ready'; live.last_run = new Date(clock).toISOString();
        live.last_result = variant === 'retry' && count === 1 ? windowsTasks.STATUS_CONTROL_C_EXIT : 0;
        if (variant !== 'missing') tasks.writeLastRun(wanted.wanted[0].id, { started: new Date(clock).toISOString(), exit: variant === 'failed' ? 1 : 0, status: variant === 'failed' ? 'failed' : 'ok', summary: [] }, home);
      };
      const result = windowsTasks.applyTasks(wanted, { home, scheduler, now: () => new Date(clock), firstRunOptions: variant === 'no-first-run' ? null : { wait: ms => { clock += ms; }, waitMs: 10, pollMs: 5 } });
      assert.equal(count, ['current', 'refused', 'no-first-run'].includes(variant) ? 0 : variant === 'retry' ? 2 : 1, `${mode} ${variant}`);
      if (count) assert.equal(result.items[0].first_run.status, variant === 'timeout' ? 'still running' : ['missing', 'failed'].includes(variant) ? 'failed' : 'ok');
      // Exercise the actual command's switch too.
      if (variant === 'no-first-run') {
        const noStarts = fakeScheduler();
        assert.equal(windowsTasks.main(['apply', '--no-first-run'], { platform: 'win32', home: tempHome(t), scheduler: noStarts, cwd: wanted.root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, checkoutDeps: { governance: governance() }, stdout: () => {}, stderr: () => {} }), 0);
        assert.ok(!noStarts.calls.some(row => row[0] === 'start'));
      }
    }
  }],
  ['Installed legacy versus full-day overdue boundaries and malformed text', t => {
    for (const schedule of ['hourly, 08:00 to 23:59', 'hourly, 00:00 to 23:59', 'not a schedule']) for (const [hour, minute] of [[3, 0], [7, 59], [8, 0], [10, 0]]) {
      const { home } = listedHome(t);
      tasks.updateRegistry(home, rows => rows.map(row => row.job === 'programme-sweep' ? { ...row, schedule } : row));
      const line = tasks.sweepLine(BINDING().repository, { home, now: new Date(2026, 9, 29, hour, minute) });
      if (schedule === 'not a schedule') assert.match(line, /installed schedule unknown/);
      else assert.equal(Boolean(line?.includes('over 2 hours')), schedule.includes('00:00') || hour >= 10, `${schedule} ${hour}:${minute}`);
    }
    const hostile = require('./support/hostile-inputs.cjs');
    hostile.expectDefaultDeny(assert, text => tasks.installedHours(text) !== null, hostile.cases(['free-text', 'invisible', 'line-breaks']));
  }],
];
// Real .git layouts, with only status/binding injected to keep all homes and reads local.
function layout(t, variant = 'linked') {
  const root = checkout(t, { shards: false });
  const primary = path.join(root, 'primary'), linked = path.join(root, 'linked');
  fs.mkdirSync(path.join(primary, '.git/worktrees/linked'), { recursive: true });
  fs.mkdirSync(path.join(primary, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(linked, 'sub'), { recursive: true });
  const gitdir = path.join(primary, '.git/worktrees/linked');
  fs.writeFileSync(path.join(primary, '.git/config'), '[remote "origin"]\nurl = git@github-work:acme/app.git\n');
  fs.writeFileSync(path.join(linked, '.git'), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  if (variant === 'broken') fs.writeFileSync(path.join(gitdir, 'commondir'), 'missing\n');
  if (variant === 'bare') {
    fs.writeFileSync(path.join(root, 'config'), '[remote "origin"]\nurl = https://github.com/acme/app.git\n');
    fs.writeFileSync(path.join(gitdir, 'commondir'), `${root}\n`);
  }
  if (variant === 'foreign') {
    fs.mkdirSync(path.join(root, 'foreign-common'));
    fs.writeFileSync(path.join(root, 'foreign-common/config'), '[remote "origin"]\nurl = https://github.com/other/repo.git\n');
    fs.writeFileSync(path.join(gitdir, 'commondir'), `${path.join(root, 'foreign-common')}\n`);
  }
  if (variant === 'unusable') fs.writeFileSync(path.join(primary, '.git/config'), '[remote "origin"]\nurl = https://other.test/acme/app.git\n');
  if (variant === 'submodule') fs.unlinkSync(path.join(gitdir, 'commondir'));
  const real = require('../scripts/toolkit-governance-state.cjs');
  const checkoutDeps = { governance: { ...real, governanceState: () => ({ state: 'DISABLED', merged: { status: 'disabled', fresh: true } }), mergedBinding: () => null } };
  return { primary, linked, checkoutDeps };
}
DELTA_CLOSURE.push(
  ['Setup, plan and apply use the verified primary checkout', t => {
    const { primary, linked, checkoutDeps } = layout(t);
    const core = require('../scripts/setup-toolkit-core.cjs');
    const results = [];
    for (const from of [primary, path.join(primary, 'sub'), linked, path.join(linked, 'sub')]) {
      const home = tempHome(t), scheduler = fakeScheduler(), output = [];
      const deps = { home, scheduler, platform: 'win32', checkoutDeps, cwd: from, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, stdout: text => output.push(text), stderr: text => assert.fail(text) };
      assert.equal(windowsTasks.main(['plan', '--json'], deps), 0);
      assert.ok(scheduler.calls.every(row => row[0] === 'list'));
      assert.equal(fs.existsSync(tasks.registryPath(home)), false);
      const plan = JSON.parse(output.pop());
      assert.ok(plan.command.includes(primary)); assert.ok(!plan.command.includes(linked));
      results.push(plan.items.map(row => row.definition));
      assert.equal(windowsTasks.main(['apply', '--no-first-run'], deps), 0);
      const read = scheduler.list('APP')[0]; assert.ok(read.arguments.includes(primary)); assert.ok(!read.arguments.includes(linked));
      const setupHome = tempHome(t), setupScheduler = fakeScheduler(), lines = [];
      const plans = core.printWindowsTasks({ repoRoot: primary }, { platform: 'win32', home: setupHome, scheduler: setupScheduler, checkoutDeps, workingFolder: from, log: text => lines.push(text) });
      assert.equal(plans.length, 1); assert.ok(lines.some(text => text.includes(primary)));
      assert.ok(setupScheduler.calls.every(row => row[0] === 'list')); assert.equal(fs.existsSync(tasks.registryPath(setupHome)), false);
    }
    for (const definitions of results) assert.deepEqual(definitions, results[0]);
    const submodule = layout(t, 'submodule');
    // Without a commondir this is a submodule's gitdir, not a linked worktree.
    fs.writeFileSync(path.join(submodule.primary, '.git/worktrees/linked/config'), '[remote "origin"]\nurl = https://github.com/acme/submodule.git\n');
    assert.equal(windowsTasks.readCheckout(submodule.linked, submodule.checkoutDeps).root, submodule.linked);
  }],
  ['Unresolved, foreign, bare and unusable layouts refuse without hiding other plans', t => {
    const core = require('../scripts/setup-toolkit-core.cjs');
    for (const variant of ['broken', 'foreign', 'bare', 'unusable']) {
      const { primary, linked, checkoutDeps } = layout(t, variant);
      for (const command of ['plan', 'apply']) {
        const scheduler = fakeScheduler(), home = tempHome(t), errors = [];
        assert.equal(windowsTasks.main([command, '--repo-root', linked], { platform: 'win32', home, scheduler, checkoutDeps, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, stderr: text => errors.push(text), stdout: () => {} }), 2, variant);
        assert.ok(errors.join('').includes('refused')); assert.deepEqual(scheduler.calls, []); assert.equal(fs.existsSync(tasks.registryPath(home)), false);
      }
      // A refused managed checkout must not discard the usable original project plan.
      const good = layout(t), lines = [], home = tempHome(t), scheduler = fakeScheduler();
      const plans = core.printWindowsTasks({ repoRoot: linked }, { platform: 'win32', home, scheduler, checkoutDeps, workingFolder: good.primary, log: text => lines.push(text) });
      assert.equal(plans.length, 1);
      if (variant === 'unusable') assert.doesNotMatch(lines.join('\n'), /refused/);
      else assert.match(lines.join('\n'), /refused for the managed Toolkit checkout: .*refused/);
      const refusals = lines.filter(line => line.includes('Windows scheduled tasks refused'));
      assert.ok(refusals.every(line => !line.includes(linked) && !line.includes(primary)));
      // The same layout remains an explicit project refusal, including a non-GitHub origin.
      const projectLines = [];
      core.printWindowsTasks({ repoRoot: good.primary }, { platform: 'win32', home, scheduler, checkoutDeps, workingFolder: linked, log: text => projectLines.push(text) });
      assert.match(projectLines.join('\n'), /refused for this project:/);
      assert.ok(projectLines.filter(line => line.includes('Windows scheduled tasks refused')).every(line => !line.includes(linked) && !line.includes(primary)));
      assert.ok(scheduler.calls.every(row => row[0] === 'list')); assert.equal(fs.existsSync(tasks.registryPath(home)), false);
    }
  }],
);
for (const [row, prove] of DELTA_CLOSURE) test(`Delta closure: ${row}`, prove);

function runFooter(t, answers = {}, home = tempHome(t), clock = '2026-10-29T09:00:00.000Z', deps = {}) {
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, ...answers });
  const record = job.runJob(footerOptions, { home, run: fake.run, ghPath: GH, nodePath: NODE, ...JOB_DEPS, now: () => new Date(clock), ...deps });
  return { record, log: fake.log, home };
}

test('J: independent footer job cleans the complete origin/store batch with own-author safeguards', t => {
  const sweep = { status: 4, stdout: JSON.stringify({ results: [{ status: 'CLEANED' }, { status: 'CLEANED' }] }) };
  const { record, log, home } = runFooter(t, { 'toolkit-github-footer-sweep.cjs': sweep });
  assert.equal(record.status, 'ok');
  assert.equal(record.exit, 0);
  assert.deepEqual(record.summary, ['Footer sweep since 2026-10-27 09:00: 2 CLEANED.']);
  assert.equal(record.footer_sweep_since, '2026-10-29T09:00:00.000Z');
  const sweepArgs = log.find(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs');
  assert.deepEqual(sweepArgs.slice(2), ['--repo', BINDING().repository, '--repo', BINDING().store.repository, '--since', '2026-10-27T09:00:00.000Z', '--apply', '--json']);
  assert.equal(sweepArgs.includes('--any-author'), false);
  assert.equal(log.some(entry => path.basename(entry[1] || '') === 'programme.cjs'), false);
  assert.deepEqual(tasks.readLastRun('toolkit-footer-sweep', home), record);
  if (process.platform !== 'win32') assert.equal(fs.statSync(tasks.lastRunPath('toolkit-footer-sweep', home)).mode & 0o777, 0o600);
});

test('J: programme refresh holds are recorded after footer cleaning', (t) => {
  const { record, log } = runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify({ holds: [{ code: 'STORE_UNREACHABLE', target: 'store', detail: 'x' }] }) } });
  assert.equal(record.status, 'held');
  assert.match(record.summary[1], /Programme refresh held: STORE_UNREACHABLE store/);
  assert.equal(log.some(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs'), true);
});

test('J: gh signed out skips with no GitHub call; a stale binding skips before any write', (t) => {
  const out = runSweep(t, { 'gh auth': { status: 1 } });
  assert.equal(out.record.status, 'skipped');
  assert.deepEqual(out.record.summary, ['skipped: gh not signed in']);
  assert.deepEqual(out.log.map(entry => entry.slice(0, 2)), [[GH, 'auth'], [NODE, '-e']], 'gh auth status, then only the github.com connection check');
  const stale = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: false } }) } });
  assert.equal(stale.record.summary.at(-1), 'skipped: binding observation expired');
  assert.match(stale.record.summary[0], /Evidence store cleaning withheld/);
  assert.equal(stale.log.some(entry => /programme\.cjs$/.test(path.basename(entry[1] || ''))), false);
  assert.ok(stale.log.some(entry => entry[1] === job.SCRIPT.footerSweep));
  for (const state of ['DISABLED', 'UNDECIDED']) {
    const off = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state, merged: { status: 'enabled', fresh: true } }) } });
    assert.equal(off.record.summary.at(-1), `skipped: governance is ${state}`);
    assert.equal(off.record.exit, 0);
  }
  const invalid = runSweep(t, { 'toolkit-governance.cjs': { status: 2, stdout: JSON.stringify({ state: 'ERROR', rule: 'M0', merged: { status: 'invalid', fresh: true } }) } });
  assert.equal(invalid.record.reason, 'binding is invalid');
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
  job.runJob(options, { home, run: fake.run, ghPath: GH, nodePath: NODE, ...JOB_DEPS, now: () => new Date('2026-11-01T05:00:05.000Z') });
  assert.deepEqual([seen[0].status, seen[0].skipped_streak, seen[0].skipped_since], ['running', 1, '2026-11-01T04:00:05.000Z']);
});

test('J: a footer sweep MISMATCH fails the run with its code, and the next run retries from the same time', (t) => {
  const home = tempHome(t);
  const first = runFooter(t, { 'toolkit-github-footer-sweep.cjs': { status: 1, stdout: JSON.stringify({ results: [{ status: 'MISMATCH' }] }) } }, home, '2026-10-29T09:00:00.000Z');
  assert.equal(first.record.status, 'failed');
  assert.equal(first.record.exit, 1);
  assert.match(first.record.summary.at(-1), /Footer sweep failed \(exit 1\): 1 MISMATCH; the next run tries again from the same time/);
  assert.equal(first.record.footer_sweep_since, '2026-10-27T09:00:00.000Z');
  const second = runFooter(t, {}, home, '2026-10-29T10:00:00.000Z');
  const sweepArgs = second.log.find(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs');
  assert.equal(sweepArgs[sweepArgs.indexOf('--since') + 1], '2026-10-27T09:00:00.000Z');
  assert.equal(second.record.footer_sweep_since, '2026-10-29T10:00:00.000Z');
});

test('J: the shard job runs only the checkout\'s shard refresh with --open-pr', (t) => {
  const root = checkout(t);
  const fake = fakeRun({ 'refresh-shard-timings.cjs': { status: 0, stdout: 'No refresh trigger crossed; nothing opened.\n' } });
  const record = job.runJob({ job: 'shard-timings', repoRoot: root, taskId: 'toolkit-shard-timings' }, { home: tempHome(t), run: fake.run, ghPath: GH, nodePath: NODE, now: () => new Date('2026-10-26T01:15:00Z') });
  assert.equal(record.status, 'ok');
  assert.deepEqual(fake.log, [[GH, 'auth', 'status'], [NODE, path.join(root, 'repo', 'scripts', 'refresh-shard-timings.cjs'), '--open-pr']]);
  const bare = job.runJob({ job: 'shard-timings', repoRoot: checkout(t, { shards: false }), taskId: 'x-shard-timings' }, { home: tempHome(t), run: fakeRun().run, ghPath: GH, nodePath: NODE });
  assert.deepEqual(bare.summary, ['skipped: this checkout has no CI shards to time']);
});

test('J: every job starts only node and gh, and the runner names no model command line', (t) => {
  const { log } = runSweep(t, {});
  const footer = runFooter(t);
  log.push(...footer.log);
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
  assert.ok(record.summary.some(line => /removed: looked like a secret/.test(line)));
});

test('J: the runner takes only a known job, an absolute checkout and a task id', () => {
  for (const argv of [[], ['other'], ['programme-sweep'], ['programme-sweep', '--repo-root', 'relative', '--task-id', 'x'], ['programme-sweep', '--repo-root', REPO_ROOT, '--task-id', 'Bad Id']]) {
    assert.equal(job.main(argv, { stderr: () => {}, stdout: () => {} }), 2, JSON.stringify(argv));
  }
});

// ---- L. listing -------------------------------------------------------------------------------

// The approved closure matrix. Each action/state family is expanded into table rows below;
// assertions prove effects as well as reported outcomes, with no real scheduler or GitHub access.
const CLOSURE_MATRIX = [
  { row: 'Plan valid GitHub checkout in any governance state', prove(t) {
    for (const state of ['ENABLED', 'DISABLED', 'UNDECIDED', 'UNAVAILABLE', 'ERROR']) {
      const wanted = desired(t, { state, shards: false });
      assert.equal(wanted.wanted.some(d => d.job === 'footer-sweep'), state !== 'ENABLED', state);
      assert.equal(wanted.wanted.some(d => d.job === 'programme-sweep'), state === 'ENABLED', state);
      for (const definition of wanted.wanted) assert.equal(definition.schedule_text, 'hourly, 00:00 to 23:59');
    }
  } },
  { row: 'Binding refresh fails or observation expires', prove(t) {
    for (const [state, reason] of [
      [{ state: 'ENABLED', merged: { status: 'enabled', fresh: false }, refresh: { refreshed: false, reason: 'fetch-failed' } }, 'binding refresh failed: default branch fetch failed'],
      [{ state: 'ENABLED', merged: { status: 'enabled', fresh: false } }, 'binding observation expired'],
      [null, 'governance status could not be read'],
      [{ state: 'UNAVAILABLE', merged: { status: 'unknown', fresh: false } }, 'binding is missing'],
    ]) {
      const answers = { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify(state) } };
      const footer = runFooter(t, answers);
      assert.equal(footer.record.status, 'held');
      assert.match(footer.record.summary[0], new RegExp(reason));
      const args = footer.log.find(entry => entry[1] === job.SCRIPT.footerSweep);
      assert.deepEqual(args.filter((_, index) => args[index - 1] === '--repo'), [BINDING().repository]);
      assert.equal(footer.record.footer_sweep_since, '2026-10-27T09:00:00.000Z');
      const programme = runSweep(t, answers);
      assert.equal(programme.record.reason, reason);
      assert.equal(programme.log.some(entry => entry[1] === job.SCRIPT.programme), false);
      assert.ok(programme.log.some(entry => entry[1] === job.SCRIPT.footerSweep));
      assert.match(tasks.skipText(programme.record), new RegExp(reason));
    }
  } },
  { row: 'Fresh enabled matching binding', prove(t) {
    for (const store of [BINDING().store.repository, BINDING().repository.toUpperCase()]) {
      const binding = BINDING(); binding.store.repository = store;
      const { log, record } = runFooter(t, {}, undefined, undefined, { readObservation: () => ({ status: 'enabled', fresh: true, binding }) });
      const args = log.find(entry => entry[1] === job.SCRIPT.footerSweep);
      assert.deepEqual(args.filter((_, index) => args[index - 1] === '--repo'), store.toLowerCase() === binding.repository.toLowerCase() ? [binding.repository] : [binding.repository, store]);
      assert.equal(record.status, store.toLowerCase() === binding.repository.toLowerCase() ? 'held' : 'ok', 'a duplicate store is refused by the binding schema');
    }
  } },
  { row: 'Stale, invalid or foreign binding', prove(t) {
    const foreign = BINDING(); foreign.repository = 'example/foreign';
    for (const observation of [
      { status: 'enabled', fresh: false, binding: BINDING() },
      { status: 'invalid', fresh: true },
      { status: 'foreign', fresh: true },
      { status: 'enabled', fresh: true, binding: foreign },
      { status: 'enabled', fresh: true, binding: { ...BINDING(), store: { repository: '--help' } } },
      null,
    ]) {
      const { log, record } = runFooter(t, {}, undefined, undefined, { readObservation: () => observation });
      const args = log.find(entry => entry[1] === job.SCRIPT.footerSweep);
      assert.deepEqual(args.filter((_, index) => args[index - 1] === '--repo'), [BINDING().repository]);
      assert.equal(record.status, 'held');
      assert.match(record.summary[0], /Evidence store cleaning withheld/);
      assert.equal(record.footer_sweep_since, '2026-10-27T09:00:00.000Z');
    }
  } },
  { row: 'Invalid/ambiguous/unsupported origin', prove(t) {
    const state = require('../scripts/toolkit-governance-state.cjs');
    for (const urls of [[], ['https://github.com/example/app', 'https://github.com/example/other'], ['file:///example/app'], ['https://gitlab.com/example/app'], ['https://github.com/example/app/extra'], ['https://github.com/example/%61pp']]) {
      const root = checkout(t, { shards: false });
      fs.mkdirSync(path.join(root, '.git'));
      fs.writeFileSync(path.join(root, '.git', 'config'), urls.map(url => `[remote "origin"]\nurl = ${url}\n`).join(''));
      const identity = state.readIdentity(root);
      assert.throws(() => windowsTasks.desiredTasks({ checkout: root, deps: { governance: { readIdentity: () => identity } } }), /no usable github.com origin/);
      const { log, record } = runFooter(t, {}, undefined, undefined, { readIdentity: () => identity });
      assert.equal(record.reason, 'no usable github.com origin repository');
      assert.deepEqual(log, [], 'refuse before authentication, refresh or footer writes');
    }
  } },
  { row: 'Authentication unavailable', prove(t) {
    for (const [answers, deps, reason] of [
      [{ 'gh auth': { status: 1 }, 'reach github': { status: 3 } }, {}, 'offline'],
      [{ 'gh auth': { status: 1 } }, {}, 'gh not signed in'],
      [{}, { ghPath: null }, 'gh is not installed'],
    ]) {
      // An explicit missing resolver is injected below for the not-installed case.
      const missing = reason === 'gh is not installed';
      const { record, log } = runFooter(t, answers, undefined, undefined, missing ? { ghPath: null, resolveGh: () => { throw new Error('missing'); } } : deps);
      assert.equal(record.reason, reason);
      assert.equal(record.footer_sweep_since, '2026-10-27T09:00:00.000Z');
      assert.equal(log.some(entry => entry[1] === job.SCRIPT.footerSweep), false);
    }
  } },
  { row: 'Sweep fails or is interrupted', prove(t) {
    for (const result of [{ status: 1, stdout: '{"results":[{"status":"MISMATCH"}]}' }, { status: 1, stdout: JSON.stringify({ results: [{ repo: BINDING().repository, status: 'CLEANED' }, { repo: BINDING().store.repository, status: 'FAILED' }] }) }, { status: null, error: 'ETIMEDOUT' }, () => { throw new Error('interrupted'); }]) {
      const home = tempHome(t);
      let running;
      const first = runFooter(t, { 'toolkit-github-footer-sweep.cjs': () => {
        running = tasks.readLastRun(footerOptions.taskId, home);
        return typeof result === 'function' ? result() : result;
      } }, home);
      assert.equal(running.status, 'running');
      assert.equal(running.footer_sweep_since, '2026-10-27T09:00:00.000Z');
      assert.equal(first.record.status, 'failed');
      assert.equal(first.record.footer_sweep_since, running.footer_sweep_since);
      const second = runFooter(t, {}, home, '2026-10-29T10:00:00.000Z');
      const args = second.log.find(entry => entry[1] === job.SCRIPT.footerSweep);
      assert.equal(args[args.indexOf('--since') + 1], running.footer_sweep_since);
    }
  } },
  { row: 'Successful complete target batch', prove(t) {
    for (const status of [0, 3, 4]) {
      let time = new Date('2026-10-29T09:00:00.000Z');
      const { record } = runFooter(t, { 'toolkit-github-footer-sweep.cjs': () => { time = new Date('2026-10-29T09:10:00.000Z'); return { status }; } }, undefined, undefined, { now: () => time });
      assert.equal(record.footer_sweep_since, '2026-10-29T09:00:00.000Z');
      assert.equal(record.finished, '2026-10-29T09:10:00.000Z');
    }
    for (const status of ['none', 'disabled']) {
      const { record, log } = runFooter(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: status === 'none' ? 'UNDECIDED' : 'DISABLED', merged: { status, fresh: true } }) } }, undefined, undefined, { readObservation: () => ({ status, fresh: true }) });
      assert.equal(record.status, 'ok');
      assert.equal(record.footer_sweep_since, '2026-10-29T09:00:00.000Z');
      assert.equal(log.find(entry => entry[1] === job.SCRIPT.footerSweep).filter(arg => arg === '--repo').length, 1);
    }
  } },
  { row: 'Unmarked, adopted or unrecorded Windows task', prove(t) {
    for (const taskJob of ['programme-sweep', 'footer-sweep']) for (const ownership of ['unmarked', 'adopted', 'unrecorded']) {
      const home = tempHome(t);
      const wanted = desired(t, { shards: false, state: taskJob === 'footer-sweep' ? 'DISABLED' : 'ENABLED' });
      wanted.wanted = wanted.wanted.filter(d => d.job === taskJob);
      const d = wanted.wanted[0];
      const live = unmarked(d.name, { description: ownership === 'unrecorded' ? d.description : 'Owner task' });
      const scheduler = fakeScheduler({ TOOLKIT: [live] });
      if (ownership === 'adopted') windowsTasks.adoptTask({ folder: 'TOOLKIT', task: d.name, id: d.id, purpose: 'Owner task' }, { scheduler, home });
      const result = windowsTasks.applyTasks(wanted, { scheduler, home });
      assert.equal(result.items[0].action, 'refused');
      assert.deepEqual(scheduler.folders.get('TOOLKIT'), [live]);
      assert.equal(scheduler.calls.some(call => call[0] === 'register' || call[0] === 'start'), false);
    }
  } },
  { row: 'Repeated skip and subsequent recovery', prove(t) {
    const home = tempHome(t);
    const scheduler = fakeScheduler();
    const wanted = desired(t, { shards: false, state: 'DISABLED' });
    wanted.wanted = wanted.wanted.filter(d => d.job === 'footer-sweep');
    windowsTasks.applyTasks(wanted, { scheduler, home });
    const answers = { 'gh auth': { status: 1 }, 'reach github': { status: 3 } };
    runFooter(t, answers, home);
    const skipped = runFooter(t, answers, home, '2026-10-29T10:00:00.000Z');
    assert.match(tasks.skipText(skipped.record), /skipped \(offline\), 2 runs in a row/);
    const listing = () => tasks.formatList(tasks.listTasks({ home, platform: 'win32', scheduler, folderFor: () => 'TOOLKIT' }));
    assert.match(listing(), /TOOLKIT - FOOTER SWEEP: Toolkit\.[\s\S]*skipped \(offline\), 2 runs in a row/);
    const good = runFooter(t, {}, home, '2026-10-29T11:00:00.000Z');
    assert.match(good.record.summary.at(-1), /Resumed after 2 skipped runs/);
    assert.equal(good.record.skipped_streak, undefined);
    assert.match(listing(), /Resumed after 2 skipped runs/);
  } },
];
for (const { row, prove } of CLOSURE_MATRIX) test(`Closure matrix: ${row}`, prove);

test('Acceptance: full-day schedule migration updates in place, then apply is unchanged', t => {
  const home = tempHome(t);
  const root = checkout(t, { shards: false });
  const scheduler = fakeScheduler({ TOOLKIT: [unmarked('Owner reminder')] });
  const legacy = desired(t, { root, shards: false });
  legacy.wanted = legacy.wanted.filter(d => d.job === 'programme-sweep');
  const d = legacy.wanted[0];
  const digest = d.def;
  d.schedule = { kind: 'hourly', at: '08:00', hours: 16 };
  d.def = windowsTasks.definitionDigest(d);
  d.description = d.description.replace(digest, d.def);
  windowsTasks.applyTasks(legacy, { scheduler, home });
  const wanted = desired(t, { root, shards: false });
  assert.deepEqual(windowsTasks.applyTasks(wanted, { scheduler, home }).items.map(item => item.action), ['update']);
  assert.deepEqual(windowsTasks.applyTasks(wanted, { scheduler, home }).items.map(item => item.action), ['current']);
  assert.equal(scheduler.folders.get('TOOLKIT').length, 2);
  for (const task of scheduler.folders.get('TOOLKIT').filter(task => windowsTasks.parseMarker(task.description))) assert.equal(windowsTasks.describeTriggers(task.triggers), 'hourly, 00:00 to 23:59');
  assert.equal(scheduler.folders.get('TOOLKIT').find(task => task.name === 'Owner reminder').description, 'My own task');
});

for (const host of [null, 'other.test']) test(`Setup quietly omits a managed source with ${host || 'a local file origin'}, but refuses the project`, t => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const managed = checkout(t), project = checkout(t), home = tempHome(t), scheduler = fakeScheduler(), lines = [];
  for (const root of [managed, project]) {
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git/config'), `[remote "origin"]\nurl = ${host ? `https://${host}/example/source.git` : 'file:///C:/local/source.git'}\n`);
  }
  const checkoutDeps = { governance: { ...governance(), readIdentity: require('../scripts/toolkit-governance-state.cjs').readIdentity } };
  assert.equal(windowsTasks.readCheckout(managed, checkoutDeps).refusalCode, 'no-github-origin');
  const plans = core.printWindowsTasks({ repoRoot: managed }, { platform: 'win32', home, scheduler, checkoutDeps, workingFolder: project, log: line => lines.push(line) });
  assert.deepEqual(plans, []);
  assert.deepEqual(lines.filter(line => line.includes('refused')), ['Windows scheduled tasks refused for this project: no usable github.com origin repository; footer cleaning refused.']);
  assert.ok(lines.every(line => !line.includes(managed) && !line.includes(project)));
  assert.deepEqual(scheduler.calls, []);
  assert.equal(fs.existsSync(tasks.registryPath(home)), false);
  const same = [];
  core.printWindowsTasks({ repoRoot: managed }, { platform: 'win32', home, scheduler, checkoutDeps, workingFolder: managed, log: line => same.push(line) });
  assert.doesNotMatch(same.join('\n'), /refused/);
  // Direct commands retain the folder the user supplied and still refuse before scheduler access.
  for (const command of ['plan', 'apply']) {
    const errors = [];
    assert.equal(windowsTasks.main([command, '--repo-root', managed], { platform: 'win32', home, scheduler, checkoutDeps, stderr: text => errors.push(text), stdout: () => {} }), 2);
    assert.ok(errors.join('').includes(managed));
    assert.match(errors.join(''), /no usable github.com origin/);
  }
  assert.deepEqual(scheduler.calls, []);
});

for (const target of ['managed', 'project']) for (const route of ['identity', 'desired-origin', 'desired-identity', 'desired-path', 'scheduler']) {
  test(`Setup labels ${target} refusal without leaking paths through ${route}`, t => {
    const core = require('../scripts/setup-toolkit-core.cjs');
    const managed = checkout(t), project = checkout(t), home = tempHome(t), lines = [], reads = new Map();
    const refused = target === 'managed' ? managed : project;
    const scheduler = fakeScheduler();
    if (route === 'scheduler') scheduler.list = () => { throw new Error(`cannot inspect ${refused}, ${JSON.stringify(refused)}, ${refused.replace(/\\/g, '/')}`); };
    const checkoutDeps = { governance: { ...governance(), readIdentity: root => {
      const count = (reads.get(root) || 0) + 1;
      reads.set(root, count);
      if (root === refused) {
        if (route === 'identity' || (route === 'desired-identity' && count === 2)) throw new Error(`identity failed for ${root}`);
        if (route === 'desired-origin' && count === 2) return { valid: false, root };
        if (route === 'desired-path') return { valid: true, root: path.join(root, '"invalid"'), remote: { host: 'github.com', path: '/example/invalid.git' } };
      }
      return { valid: true, root, remote: { host: 'github.com', path: root === managed ? '/example/toolkit.git' : '/example/project.git' } };
    } } };
    const plans = core.printWindowsTasks({ repoRoot: managed }, { platform: 'win32', home, scheduler, checkoutDeps, workingFolder: project, log: line => lines.push(line) });
    const refusals = lines.filter(line => line.includes('Windows scheduled tasks refused'));
    assert.ok(refusals.some(line => line.startsWith(`Windows scheduled tasks refused for ${target === 'managed' ? 'the managed Toolkit checkout' : 'this project'}:`)));
    for (const root of [managed, project]) for (const spelling of [root, JSON.stringify(root).slice(1, -1), root.replace(/\\/g, '/')]) {
      assert.ok(refusals.every(line => !line.includes(spelling)), `${route} leaked a checkout path`);
    }
    assert.match(refusals.join('\n'), route === 'desired-origin' ? /no usable github.com origin/ : route === 'scheduler' ? /cannot inspect/ : route === 'desired-path' ? /cannot be used in a task/ : /checkout identity could not be read/);
    assert.equal(plans.length, route === 'scheduler' ? 0 : 1);
    assert.ok(scheduler.calls.every(row => row[0] === 'list'));
    assert.equal(fs.existsSync(tasks.registryPath(home)), false);
  });
}

test('Acceptance: setup plans managed and original project checkouts once, including projectless starts', t => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const managed = checkout(t);
  const project = checkout(t, { shards: false });
  const toolkitClone = checkout(t, { shards: false });
  const plain = checkout(t, { shards: false });
  const sub = path.join(project, 'sub');
  const identity = folder => folder === plain ? { valid: false, root: null } : { valid: true, root: folder === sub ? project : folder,
    remote: { host: 'github.com', path: folder === managed || folder === toolkitClone ? '/example/toolkit.git' : '/example/project.git' } };
  const checkoutDeps = { governance: { readIdentity: identity, governanceState: () => ({ state: 'DISABLED', merged: { status: 'disabled', fresh: true } }), mergedBinding: () => null } };
  for (const [workingFolder, count, repositories] of [[sub, 2, ['example/toolkit', 'example/project']], [managed, 1, ['example/toolkit']], [toolkitClone, 1, ['example/toolkit']], [plain, 1, ['example/toolkit']]]) {
    const home = tempHome(t);
    const scheduler = fakeScheduler();
    const lines = [];
    const plans = core.printWindowsTasks({ repoRoot: managed }, { workingFolder, platform: 'win32', checkoutDeps, scheduler, home, log: line => lines.push(line) });
    assert.equal(plans.length, count);
    assert.deepEqual(plans.map(plan => plan.repository), repositories);
    assert.equal(lines.filter(line => line.includes(' - FOOTER SWEEP (hourly, 00:00 to 23:59)')).length, count);
    assert.equal(scheduler.calls.every(call => call[0] === 'list'), true);
    assert.equal(fs.existsSync(tasks.registryPath(home)), false);
  }
});

test('Acceptance: actual cache observation validates freshness and origin; working-tree binding grants no store effects', t => {
  const governanceState = require('../scripts/toolkit-governance-state.cjs');
  const cache = require('../scripts/toolkit-governance-binding.cjs');
  const crypto = require('node:crypto');
  const root = checkout(t, { shards: false });
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git/config'), '[remote "origin"]\nurl = https://github.com/weijunswj/ai-agent-toolkit.git\n');
  fs.mkdirSync(path.join(root, '.github'));
  fs.writeFileSync(path.join(root, '.github/toolkit-programme.json'), JSON.stringify({ ...BINDING(), store: { ...BINDING().store, repository: 'example/working-tree-store' } }));
  const identity = governanceState.readIdentity(root);
  for (const variant of ['fresh', 'expired', 'refresh-error', 'foreign', 'absent-cache']) {
    const home = tempHome(t);
    const text = JSON.stringify({ ...BINDING(), ...(variant === 'foreign' ? { repository: 'example/foreign' } : {}) });
    if (variant !== 'absent-cache') cache.writeCache(path.join(home, '.ai-agent-toolkit/user-state'), {
      schema: cache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical,
      default_branch: 'main', commit: 'a'.repeat(40), status: 'present', text,
      bytes_sha256: crypto.createHash('sha256').update(text).digest('hex'),
      fetched_at: variant === 'expired' ? '2026-10-27T09:00:00.000Z' : '2026-10-29T08:59:00.000Z',
      ...(variant === 'refresh-error' ? { refresh_error: 'fetch-failed' } : {}),
    });
    if (variant === 'fresh') {
      const read = cache.readBindingCache(identity, path.join(home, '.ai-agent-toolkit/user-state'));
      assert.ok(read, JSON.stringify(identity));
      assert.equal(governanceState.judgeMerged(read, identity, new Date('2026-10-29T09:00:00.000Z')).status, 'enabled');
    }
    const { record, log } = runFooter(t, {}, home, undefined, { readIdentity: () => identity, readObservation: undefined });
    const args = log.find(entry => entry[1] === job.SCRIPT.footerSweep);
    assert.equal(args.includes('example/working-tree-store'), false);
    assert.equal(args.includes(BINDING().store.repository), variant === 'fresh', JSON.stringify(record));
    assert.equal(record.status, variant === 'fresh' ? 'ok' : 'held', variant);
  }
});

test('Acceptance: skip reporting accepts fixed reasons and refuses hostile or private command text', t => {
  const hostile = require('./support/hostile-inputs.cjs');
  hostile.expectDefaultDeny(assert, text => tasks.skipText({ status: 'skipped', reason: text }).includes(`(${text})`), hostile.cases(['free-text', 'invisible', 'line-breaks']));
  for (const [code, reason] of [
    ['fetch-failed', 'binding refresh failed: default branch fetch failed'],
    ['remote-unreachable', 'binding refresh failed: GitHub unreachable'],
    ['remote-redirected', 'binding refresh failed: origin transport refused'],
    ['default-branch-unknown', 'binding refresh failed: default branch unknown'],
    ['ref-moved', 'binding refresh failed: default branch moved'],
    ['hooks-unguarded', 'binding refresh failed: fetch guards unavailable'],
    ['commit-unreadable', 'binding refresh failed: commit unreadable'],
    ['tree-unreadable', 'binding refresh failed: commit unreadable'],
    ['blob-unreadable', 'binding refresh failed: binding unreadable'],
    ['cache-unwritable', 'binding refresh failed: cache unwritable'],
    ['offline', 'binding refresh failed: governance reads offline'],
    ['private arbitrary error', 'binding refresh failed'],
    ['__proto__', 'binding refresh failed'],
    ['constructor', 'binding refresh failed'],
    ['toString', 'binding refresh failed'],
  ]) {
    const result = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: false }, refresh: { refreshed: false, reason: code } }) } });
    assert.equal(result.record.reason, reason);
    assert.match(tasks.skipText(result.record), new RegExp(reason));
  }
});


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
  assert.deepEqual([row.state, row.source, row.schedule, row.ai, row.result, row.last_result, row.last_run], ['Toolkit', tasks.LIVE, 'hourly, 00:00 to 23:59', 'no AI', 'ok', 'ok', '2026-10-29T01:03:00.000Z']);
  assert.match(tasks.formatList(result), /TOOLKIT - PROGRAMME SWEEP: Toolkit\. Windows Task Scheduler \\TOOLKIT\\; hourly, 00:00 to 23:59; no AI; last run 2026-10-29 01:03 ok/);
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

test('L: the session sweep line names a skip, a failure or a gap of over 2 hours, in fixed words only', (t) => {
  const { home } = listedHome(t);
  const repository = 'weijunswj/ai-agent-toolkit';
  const noon = new Date(2026, 10, 1, 12, 0, 0); // Local noon is inside legacy and full-day schedules.
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
  // Future or recent records do not count as an overdue gap.
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
  for (const duration of ['PT24H', 'P1D']) {
    assert.equal(windowsTasks.describeTriggers([{ kind: 'MSFT_TaskDailyTrigger', start: '2026-10-29T00:00:00+08:00', interval: 'PT1H', duration }]), 'hourly, 00:00 to 23:59');
  }
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

// Disposable Windows qualification. All scheduled processes inject fake GitHub responses and
// use the test home. No process can contact GitHub or the installed Toolkit home.
test('real Task Scheduler: repeated jobs, shapes, cursor copying, rollback and disabled state', { skip: process.platform !== 'win32' || process.env.TOOLKIT_REAL_TASK_SCHEDULER_TEST !== '1' ? 'owner-run only: set TOOLKIT_REAL_TASK_SCHEDULER_TEST=1 on Windows' : false }, t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-real-home-')), scratch = checkout(t, { shards: false });
  const scheduler = windowsTasks.powerShellScheduler();
  const folder = `TOOLKIT-TEST-${process.pid}`;
  assert.deepEqual(scheduler.list(folder), [], 'never use an existing task folder');
  const before = scheduler.list(null).map(row => row.name).sort();
  const runner = path.join(scratch, 'fake-job.cjs');
  const events = path.join(home, 'effects.jsonl');
  const pauseFile = path.join(home, 'pause-after-job');
  const readyFile = path.join(home, 'job-waiting');
  fs.writeFileSync(runner, `const fs=require('node:fs');
const job=require(${JSON.stringify(path.join(ROOT, 'repo/scripts/toolkit-scheduled-job.cjs'))});
const binding=${JSON.stringify(BINDING())}; let tick=0;
const options=job.parseArgs(process.argv.slice(2));
const record=job.runJob(options,{home:${JSON.stringify(home)}, ghPath:'fake-gh', now:()=>new Date(Date.now()+(++tick)),
readIdentity:root=>({valid:true,root,remote:{host:'github.com',path:'/weijunswj/ai-agent-toolkit.git'}}),
readObservation:()=>({status:'enabled',fresh:true,binding}),
run:(file,args)=>{fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({file,args})+'\\n');
if(args[0].endsWith('toolkit-governance.cjs')) return ${JSON.stringify(GOVERNED)};
if(args[1]==='attention') return ${JSON.stringify(ATTENTION)};
return {status:0,stdout:'',stderr:''};}});
if(fs.existsSync(${JSON.stringify(pauseFile)})){fs.writeFileSync(${JSON.stringify(readyFile)},'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);}
process.exitCode=record.exit;
`);
  const wantedFor = state => {
    const wanted = windowsTasks.desiredTasks({ checkout: ROOT, folder, deps: { governance: governance({ state }) } });
    wanted.wanted = wanted.wanted.filter(row => ['programme-sweep', 'footer-sweep'].includes(row.job));
    for (const d of wanted.cleaners) {
      const digest = d.def;
      d.arguments = `--headless "${process.execPath}" "${runner}" ${d.job} --repo-root "${ROOT}" --task-id ${d.id}`;
      d.def = windowsTasks.definitionDigest(d); d.description = d.description.replace(digest, d.def);
    }
    return wanted;
  };
  const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  t.after(() => {
    const recorded = tasks.readRegistry(home).tasks || [];
    for (const live of scheduler.list(folder)) if (live.state === 'Running' && recorded.some(row => row.name === live.name && windowsTasks.parseMarker(live.description)?.id === row.id)) scheduler.stop(folder, live.name);
    const removed = windowsTasks.removeTasks({ folder, scheduler, home });
    assert.ok(removed.items.every(row => row.action === 'removed' || row.action.startsWith('forgotten')));
    assert.deepEqual(scheduler.list(folder), []);
    fs.rmSync(home, { recursive: true, force: true });
  });
  const enabled = wantedFor('ENABLED'), d = enabled.wanted[0];
  const legacy = { ...enabled, wanted: [{ ...d, schedule: { kind: 'hourly', at: '08:00', hours: 16 } }] };
  legacy.wanted[0].def = windowsTasks.definitionDigest(legacy.wanted[0]);
  legacy.wanted[0].description = d.description.replace(d.def, legacy.wanted[0].def);
  assert.equal(windowsTasks.applyTasks(legacy, { home, scheduler }).items[0].done, true);
  baseRun(t, home, '2026-10-01T09:00:00Z', {}, { ...options, taskId: d.id });
  for (let run = 0; run < 2; run++) {
    const previous = tasks.readLastRun(d.id, home);
    const result = windowsTasks.firstRun(d, { home, scheduler, waitMs: 60000, pollMs: 1000 });
    assert.equal(result.status, 'ok', JSON.stringify(result));
    const record = tasks.readLastRun(d.id, home);
    assert.equal(record.status, 'ok'); assert.ok(Date.parse(record.footer_sweep_since) > Date.parse(record.started));
    assert.ok(Date.parse(record.finished) >= Date.parse(record.footer_sweep_since));
    assert.ok(Date.parse(record.footer_sweep_since) > Date.parse(previous.footer_sweep_since));
    pause(2100); // Prevent the scheduler's two-second timestamp tolerance matching the old run.
  }
  const migrated = windowsTasks.applyTasks(enabled, { home, scheduler });
  assert.equal(migrated.items[0].action, 'update'); assert.equal(migrated.items[0].done, true);
  assert.equal(windowsTasks.describeTriggers(scheduler.list(folder)[0].triggers), 'hourly, 00:00 to 23:59');
  // Keep a completed fake job in Running after it released the footer lock. Replacement must
  // disable and stop that real process before copying its cursor and retiring its task.
  fs.writeFileSync(pauseFile, 'pause'); scheduler.start(folder, d.name);
  for (let attempt = 0; attempt < 150 && !fs.existsSync(readyFile); attempt++) pause(200);
  assert.equal(fs.existsSync(readyFile), true, 'the disposable source reached its bounded pause');
  assert.equal(scheduler.info(folder, d.name).state, 'Running');
  const pending = tasks.readLastRun(d.id, home).footer_sweep_since;
  fs.unlinkSync(pauseFile);
  const off = wantedFor('DISABLED');
  const switched = windowsTasks.applyTasks(off, { home, scheduler });
  assert.equal(switched.items[0].done, true); assert.equal(scheduler.list(folder).length, 1);
  assert.equal(tasks.readLastRun(off.wanted[0].id, home).footer_sweep_since, pending);
  assert.equal(windowsTasks.firstRun(off.wanted[0], { home, scheduler, waitMs: 60000, pollMs: 1000 }).status, 'ok');
  const register = scheduler.register;
  let once = false;
  scheduler.register = definition => { register(definition); if (!once) { once = true; throw new Error('qualification failure after prepare'); } };
  const failed = windowsTasks.applyTasks(enabled, { home, scheduler });
  assert.equal(failed.items[0].done, false); assert.match(failed.items[0].error, /restored and verified/);
  scheduler.register = register;
  const f = off.wanted[0]; scheduler.setEnabled(folder, f.name, false);
  const stopped = windowsTasks.applyTasks(enabled, { home, scheduler, firstRunOptions: { waitMs: 60000, pollMs: 1000 } });
  assert.equal(stopped.items[0].done, true); assert.equal(stopped.items[0].first_run, undefined);
  assert.equal(scheduler.list(folder)[0].state, 'Disabled');
  assert.equal(windowsTasks.applyTasks(enabled, { home, scheduler }).items[0].action, 'current');
  assert.deepEqual(scheduler.list(null).map(row => row.name).sort(), before);
  const calls = fs.readFileSync(events, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.filter(row => row.args[0].endsWith('toolkit-github-footer-sweep.cjs')).length, 4);
  assert.ok(calls.every(row => row.file === 'fake-gh' || row.file === process.execPath));
  t.diagnostic(`Verified disposable \\${folder}\\ with fake GitHub, repeated P runs, F run, full-day migration, running-source quiescence, both replacements, cursor copy, rollback, disabled preservation and cleanup.`);
});
