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
    list(folder) { calls.push(['list', folder]); return of(folder).map(task => ({ ...task })); },
    markedFolders() { return [...folders.entries()].filter(([name, list]) => name && list.some(task => String(task.description).includes('[toolkit-task v1 '))).map(([name]) => name); },
    register(d) {
      calls.push(['register', d.folder, d.name]);
      const list = folders.get(d.folder) || [];
      const existing = list.find(task => task.name === d.name);
      if (existing && !String(existing.description).includes(`[toolkit-task v1 id=${d.id} `)) throw new Error('not Toolkit\'s');
      const task = { name: d.name, description: d.description, state: 'Ready', execute: d.execute, arguments: d.arguments, working_directory: d.working_directory,
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
    start(folder, name) { calls.push(['start', folder, name]); if (this.onStart) this.onStart(of(folder).find(item => item.name === name)); },
    info(folder, name) { const task = of(folder).find(item => item.name === name); return { state: task.state, last_run: task.last_run, last_result: task.last_result }; },
  };
}

function desired(t, options = {}) {
  return windowsTasks.desiredTasks({ checkout: options.root || checkout(t, options), toolkitRoot: TOOLKIT_ROOT, nodePath: options.nodePath || NODE, systemRoot: 'C:\\Windows',
    folder: options.folder || null, deps: { governance: governance(options) } });
}

const unmarked = (name, extra = {}) => ({ name, description: 'My own task', state: 'Ready', execute: 'C:\\x.exe', arguments: '', working_directory: '', triggers: [], last_run: null, last_result: 0, ...extra });

// ---- G. install, reinstall and remove --------------------------------------------------------

test('G: an ENABLED Toolkit checkout gets three tasks in \\TOOLKIT\\, recorded in the registry', (t) => {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const wanted = desired(t);
  assert.deepEqual(wanted.wanted.map(d => d.name), ['TOOLKIT - PROGRAMME SWEEP', 'TOOLKIT - FOOTER SWEEP', 'TOOLKIT - SHARD TIMINGS']);
  const result = windowsTasks.applyTasks(wanted, { scheduler, home });
  assert.deepEqual(result.items.map(item => [item.action, item.done]), [['create', true], ['create', true], ['create', true]]);
  assert.deepEqual([...scheduler.folders.get('TOOLKIT')].map(task => task.name).sort(), ['TOOLKIT - FOOTER SWEEP', 'TOOLKIT - PROGRAMME SWEEP', 'TOOLKIT - SHARD TIMINGS']);
  const registry = tasks.readRegistry(home);
  assert.equal(registry.status, 'ok');
  assert.deepEqual(registry.tasks.map(entry => [entry.id, entry.folder, entry.schedule, entry.model, entry.effort]),
    [['toolkit-footer-sweep', 'TOOLKIT', 'hourly, 00:00 to 23:59', null, null], ['toolkit-programme-sweep', 'TOOLKIT', 'hourly, 00:00 to 23:59', null, null], ['toolkit-shard-timings', 'TOOLKIT', 'weekly, Monday 09:15', null, null]]);
  const report = windowsTasks.describePlan(result, { applied: true }).join('\n');
  assert.match(report, /TOOLKIT - PROGRAMME SWEEP \(hourly, 00:00 to 23:59\): created\. Brings the programme pages/);
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
  assert.deepEqual(again.items.map(item => item.action), ['current', 'current', 'current']);
  assert.equal(scheduler.calls.filter(call => call[0] === 'register').length, 0);
  assert.equal(fs.readFileSync(tasks.registryPath(home), 'utf8'), before);
  const changed = desired(t, { root, nodePath: 'D:\\node\\node.exe' });
  const plan = windowsTasks.planTasks(changed, { scheduler, home });
  assert.deepEqual(plan.items.map(item => item.action), ['update', 'update', 'update']);
  const updated = windowsTasks.applyTasks(changed, { scheduler, home });
  assert.deepEqual(updated.items.map(item => item.done), [true, true, true]);
  assert.match(scheduler.folders.get('TOOLKIT')[0].arguments, /D:\\node\\node\.exe/);
  assert.deepEqual(tasks.readRegistry(home).tasks.map(entry => entry.definition), [...changed.wanted].sort((a, b) => a.id.localeCompare(b.id)).map(d => d.def));
  assert.equal(scheduler.folders.get('TOOLKIT').length, 3, 'updated in place, not added');
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
  assert.deepEqual(kept.items.map(item => item.action), ['removed', 'removed', 'removed']);
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
  assert.deepEqual(plan.items.map(item => item.action), ['update', 'current', 'current'], 'the action, its arguments and folder are unchanged; only the digest tells');
});

test('G: setup only plans and reports the tasks, and --remove-toolkit-tasks removes only Toolkit\'s own', async (t) => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const home = tempHome(t);
  const root = checkout(t);
  const scheduler = fakeScheduler();
  const lines = [];
  const plan = core.printWindowsTasks({ repoRoot: root }, { platform: 'win32', scheduler, workingFolder: root, checkoutDeps: { governance: governance() }, home, log: line => lines.push(line) });
  assert.deepEqual(plan[0].items.map(item => item.action), ['create', 'create', 'create']);
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
  // Programme-only tests have a proven companion; migration tests below exercise its absence.
  const scheduler = fakeScheduler();
  const wanted = windowsTasks.desiredTasks({ checkout: REPO_ROOT, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { governance: governance() } });
  const footer = wanted.wanted.find(d => d.job === 'footer-sweep');
  scheduler.register(footer);
  const readRegistry = () => ({ status: 'ok', tasks: [{ ...footer, schedule: footer.schedule_text, host: 'windows', definition: footer.def }] });
  const record = job.runJob(options, { home, run: fake.run, ghPath: GH, nodePath: NODE, ...JOB_DEPS, scheduler, readRegistry, now: () => new Date(clock) });
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
function historical(home, since = '2026-10-01T00:00:00.000Z', extra = {}) {
  const record = { schema: 'toolkit.task-last-run.v1', id: options.taskId, job: options.job, repository: BINDING().repository,
    started: '2026-10-29T08:00:00.000Z', finished: '2026-10-29T08:01:00.000Z', status: 'failed', footer_sweep_since: since, ...extra };
  tasks.writeLastRun(options.taskId, record, home);
  return record;
}

// Additional G0 delta rows: every family has effects and refusal controls.
const DELTA_CLOSURE = [
  ['Updated legacy runner, fresh and failed governance', t => {
    for (const failed of [false, true]) {
      const answers = failed ? { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: false }, refresh: { refreshed: false, reason: 'fetch-failed' } }) } } : {};
      const { record, log, home } = migrationRun(t, { answers });
      assert.equal(record.footer_setup, 'needed');
      assert.equal(record.footer_status, failed ? 'held' : 'ok');
      assert.equal(record.programme_status, failed ? 'skipped' : 'ok');
      assert.equal(record.status, failed ? 'skipped' : 'ok');
      assert.ok(log.findIndex(row => row[1] === job.SCRIPT.footerSweep) >= 0);
      if (!failed) assert.ok(log.findIndex(row => row[1] === job.SCRIPT.footerSweep) < log.findIndex(row => row[1] === job.SCRIPT.programme));
      else assert.ok(!log.some(row => row[1] === job.SCRIPT.programme));
      assert.ok(record.summary.includes(tasks.FOOTER_SETUP_NOTE));
      assert.equal(tasks.readLastRun(options.taskId, home).footer_setup, 'needed');
      // No registry is present in this legacy-runner fixture.
      assert.equal(tasks.sweepLine(BINDING().repository, { home, advisoryOnly: true }), tasks.FOOTER_SETUP_NOTE);
      assert.match(tasks.formatList(tasks.listTasks({ home, platform: 'linux' })), /Footer task not set up/);
    }
  }],
  ['Recorded and live companion ownership, action and stop controls', t => {
    for (const variant of ['ready', 'absent', 'foreign', 'adopted', 'changed', 'marker', 'target', 'unreadable', 'registry-unreadable', 'disabled']) {
      const home = tempHome(t), scheduler = fakeScheduler();
      const wanted = desired(t);
      windowsTasks.applyTasks(wanted, { home, scheduler });
      const live = scheduler.folders.get('TOOLKIT').find(row => row.name.endsWith('FOOTER SWEEP'));
      if (variant === 'absent') scheduler.folders.set('TOOLKIT', []);
      if (variant === 'foreign' || variant === 'adopted') tasks.updateRegistry(home, rows => rows.map(row => row.job !== 'footer-sweep' ? row : { ...row, ...(variant === 'adopted' ? { adopted: true } : { repository: 'other/repository' }) }));
      if (variant === 'changed') live.arguments += ' --changed';
      if (variant === 'marker') live.description = 'Owner task';
      if (variant === 'target') {
        live.arguments = live.arguments.replace(/--repo-root "[^"]+"/, '--repo-root "C:\\foreign"');
        tasks.updateRegistry(home, rows => rows.map(row => row.job === 'footer-sweep' ? { ...row, arguments: live.arguments } : row));
      }
      if (variant === 'disabled') live.state = 'Disabled';
      if (variant === 'unreadable') scheduler.list = () => { throw new Error('private scheduler error'); };
      if (variant === 'registry-unreadable') fs.writeFileSync(tasks.registryPath(home), '{broken');
      const { record, log } = migrationRun(t, { home, scheduler, deps: { readIdentity: root => root === 'C:\\foreign' ? { ...IDENTITY(root), remote: { host: 'github.com', path: '/other/repository' } } : IDENTITY(root) } });
      assert.equal(log.some(row => row[1] === job.SCRIPT.footerSweep), !['ready', 'disabled'].includes(variant), variant);
      assert.equal(record.footer_status, variant === 'disabled' ? 'disabled' : variant === 'ready' ? 'ready' : 'ok', variant);
      assert.equal(record.footer_setup, ['ready', 'disabled'].includes(variant) ? undefined : 'needed', variant);
      assert.ok(!record.summary.join(' ').includes('private scheduler error'));
      if (record.footer_setup) assert.match(tasks.formatList(tasks.listTasks({ home, platform: 'linux' })), variant === 'registry-unreadable' ? /could not be read/ : /Footer task not set up/);
      if (record.footer_setup) assert.equal(tasks.sweepLine(BINDING().repository, { home, advisoryOnly: true }), tasks.FOOTER_SETUP_NOTE);
      if (variant === 'registry-unreadable') {
        const independent = migrationRun(t, { home, scheduler, mode: 'footer-sweep' });
        assert.equal(independent.record.footer_status, 'recovery', 'first import cannot establish historical scope without the registry');
        assert.ok(!independent.log.some(row => row[1] === job.SCRIPT.footerSweep));
      }
    }
  }],
  ['Concurrent starts and delayed apply retain oldest pending cursor', t => {
    const home = tempHome(t), scheduler = fakeScheduler();
    const legacy = desired(t); legacy.wanted = legacy.wanted.filter(row => row.job === 'programme-sweep');
    windowsTasks.applyTasks(legacy, { home, scheduler });
    historical(home);
    let competing;
    const first = migrationRun(t, { home, scheduler, answers: { 'toolkit-github-footer-sweep.cjs': () => {
      competing = migrationRun(t, { home, scheduler, mode: 'footer-sweep' });
      return { status: 1 };
    } } });
    assert.equal(competing.record.footer_status, 'locked');
    assert.ok(!competing.log.some(row => row[1] === job.SCRIPT.footerSweep));
    assert.equal(first.record.footer_sweep_since, '2026-10-01T00:00:00.000Z');
    windowsTasks.applyTasks(desired(t), { home, scheduler });
    const next = migrationRun(t, { home, scheduler, mode: 'footer-sweep', clock: '2026-11-05T09:00:00.000Z' });
    assert.ok(next.log.find(row => row[1] === job.SCRIPT.footerSweep).includes('2026-10-01T00:00:00.000Z'));
    assert.equal(next.record.footer_handover, BINDING().repository.toLowerCase());
    const last = migrationRun(t, { home, scheduler, mode: 'footer-sweep', clock: '2026-11-05T10:00:00.000Z' });
    assert.ok(last.log.find(row => row[1] === job.SCRIPT.footerSweep).includes('2026-11-05T09:00:00.000Z'), 'import only once');
    for (const state of ['Ready', 'Disabled']) {
      const arrivingHome = tempHome(t), arrivingScheduler = fakeScheduler();
      const arriving = migrationRun(t, { home: arrivingHome, scheduler: arrivingScheduler, deps: { takeLock: file => {
        const lock = require('../../skills/github-program-reconciler/scripts/programme.cjs').takeLock(file);
        windowsTasks.applyTasks(desired(t), { home: arrivingHome, scheduler: arrivingScheduler });
        arrivingScheduler.folders.get('TOOLKIT').find(row => row.name.endsWith('FOOTER SWEEP')).state = state;
        return lock;
      } } });
      assert.ok(!arriving.log.some(row => row[1] === job.SCRIPT.footerSweep), 'handover is rechecked inside the lock');
      assert.equal(arriving.record.footer_setup, undefined);
      assert.ok(!arriving.record.summary.includes(tasks.FOOTER_SETUP_NOTE));
    }
  }],
  ['Failure, interruption, store withholding, damage and successful handover', t => {
    for (const variant of ['failed', 'interrupted', 'store-held', 'success', 'bad-time', 'impossible-date', 'future', 'foreign-record', 'record-shape', 'wrong-job', 'broken-record']) {
      const home = tempHome(t), scheduler = fakeScheduler();
      windowsTasks.applyTasks(desired(t), { home, scheduler });
      historical(home, variant === 'bad-time' ? 'bad' : variant === 'impossible-date' ? '2026-02-30T00:00:00.000Z' : variant === 'future' ? '2099-01-01T00:00:00Z' : undefined,
        variant === 'foreign-record' ? { repository: 'other/repo' } : variant === 'record-shape' ? { repository: [BINDING().repository] } : variant === 'wrong-job' ? { job: 'shard-timings' } : {});
      if (variant === 'broken-record') fs.writeFileSync(tasks.lastRunPath(options.taskId, home), '{broken');
      const damaged = ['bad-time', 'impossible-date', 'future', 'foreign-record', 'record-shape', 'wrong-job', 'broken-record'].includes(variant);
      let during;
      const answers = { 'toolkit-github-footer-sweep.cjs': () => {
        during = tasks.readLastRun(footerOptions.taskId, home);
        if (variant === 'interrupted') throw new Error('interrupt');
        return { status: variant === 'failed' ? 1 : 4 };
      } };
      if (variant === 'store-held') answers['toolkit-governance.cjs'] = { status: 1, stdout: GOVERNED.stdout };
      const { record, log } = migrationRun(t, { home, scheduler, mode: 'footer-sweep', answers });
      if (damaged) { assert.equal(record.footer_status, 'recovery', variant); assert.ok(!log.some(row => row[1] === job.SCRIPT.footerSweep)); }
      else {
        assert.equal(during.footer_handover, BINDING().repository.toLowerCase());
        assert.equal(during.footer_sweep_since, '2026-10-01T00:00:00.000Z');
        assert.equal(record.footer_sweep_since, variant === 'success' ? '2026-10-29T09:00:00.000Z' : during.footer_sweep_since);
        assert.equal(record.status, variant === 'success' ? 'ok' : variant === 'store-held' ? 'held' : 'failed');
      }
      if (damaged) {
        const retry = migrationRun(t, { home, scheduler, mode: 'footer-sweep' });
        assert.equal(retry.record.footer_status, 'recovery', 'a recovery hold survives later runs');
        assert.ok(!retry.log.some(row => row[1] === job.SCRIPT.footerSweep));
      }
    }
  }],
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
    const all = desired(t);
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
      if (expected.includes('programme') && !expected.includes('footer')) assert.match(consent, /also cleans the signed-in account's own GitHub posts first if its independent footer task cannot be verified/);
      assert.equal(consent.length > 0, expected.length > 0);
    }
  }],
  ['Both hourly first runs, retry, missing and failed result, timeout and no starts', t => {
    for (const mode of ['programme-sweep', 'footer-sweep']) for (const variant of ['healthy', 'retry', 'missing', 'failed', 'timeout', 'current', 'refused', 'no-first-run']) {
      const home = tempHome(t), scheduler = fakeScheduler();
      const wanted = desired(t); wanted.wanted = wanted.wanted.filter(row => row.job === mode);
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
  const checkoutDeps = { governance: { ...real, governanceState: () => ({ state: 'DISABLED' }), mergedBinding: () => null } };
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
      assert.equal(plans.length, 1); assert.match(lines.join('\n'), /refused/);
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

test('J: programme refresh holds are recorded without running footer cleaning', (t) => {
  const { record, log } = runSweep(t, { 'programme refresh': { status: 1, stdout: JSON.stringify({ holds: [{ code: 'STORE_UNREACHABLE', target: 'store', detail: 'x' }] }) } });
  assert.equal(record.status, 'held');
  assert.match(record.summary[0], /Programme refresh held: STORE_UNREACHABLE store/);
  assert.equal(log.some(entry => path.basename(entry[1] || '') === 'toolkit-github-footer-sweep.cjs'), false);
});

test('J: gh signed out skips with no GitHub call; a stale binding skips before any write', (t) => {
  const out = runSweep(t, { 'gh auth': { status: 1 } });
  assert.equal(out.record.status, 'skipped');
  assert.deepEqual(out.record.summary, ['skipped: gh not signed in']);
  assert.deepEqual(out.log.map(entry => entry.slice(0, 2)), [[GH, 'auth'], [NODE, '-e']], 'gh auth status, then only the github.com connection check');
  const stale = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: false } }) } });
  assert.deepEqual(stale.record.summary, ['skipped: binding observation expired']);
  assert.equal(stale.log.some(entry => /^(programme\.cjs|toolkit-github-footer-sweep\.cjs)$/.test(path.basename(entry[1] || ''))), false);
  for (const state of ['DISABLED', 'UNDECIDED']) {
    const off = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state, merged: { status: 'enabled', fresh: true } }) } });
    assert.deepEqual(off.record.summary, [`skipped: governance is ${state}`]);
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
  assert.match(record.summary[0], /removed: looked like a secret/);
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
      assert.ok(wanted.wanted.some(d => d.job === 'footer-sweep'), state);
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
      assert.equal(programme.log.some(entry => entry[1] === job.SCRIPT.programme || entry[1] === job.SCRIPT.footerSweep), false);
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
      const wanted = desired(t, { shards: false });
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
    const wanted = desired(t, { shards: false });
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
  assert.deepEqual(windowsTasks.applyTasks(wanted, { scheduler, home }).items.map(item => item.action), ['update', 'create']);
  assert.deepEqual(windowsTasks.applyTasks(wanted, { scheduler, home }).items.map(item => item.action), ['current', 'current']);
  assert.equal(scheduler.folders.get('TOOLKIT').length, 3);
  for (const task of scheduler.folders.get('TOOLKIT').filter(task => windowsTasks.parseMarker(task.description))) assert.equal(windowsTasks.describeTriggers(task.triggers), 'hourly, 00:00 to 23:59');
  assert.equal(scheduler.folders.get('TOOLKIT').find(task => task.name === 'Owner reminder').description, 'My own task');
});

test('Acceptance: setup plans managed and original project checkouts once, including projectless starts', t => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const managed = checkout(t);
  const project = checkout(t, { shards: false });
  const toolkitClone = checkout(t, { shards: false });
  const plain = checkout(t, { shards: false });
  const sub = path.join(project, 'sub');
  const identity = folder => folder === plain ? { valid: false, root: null } : { valid: true, root: folder === sub ? project : folder,
    remote: { host: 'github.com', path: folder === managed || folder === toolkitClone ? '/example/toolkit.git' : '/example/project.git' } };
  const checkoutDeps = { governance: { readIdentity: identity, governanceState: () => ({ state: 'DISABLED' }), mergedBinding: () => null } };
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

test('Acceptance: a verified companion leaves the historical programme cursor untouched', t => {
  const home = tempHome(t);
  tasks.writeLastRun(options.taskId, { footer_sweep_since: '2000-01-01T00:00:00.000Z', status: 'ok' }, home);
  const { record, log } = runSweep(t, {}, home);
  assert.equal(record.footer_sweep_since, '2000-01-01T00:00:00.000Z', 'historical data stays in the programme record');
  assert.equal(log.some(entry => entry[1] === job.SCRIPT.footerSweep), false);
  const footer = runFooter(t, {}, home);
  assert.equal(footer.record.footer_sweep_since, '2026-10-29T09:00:00.000Z');
  assert.ok(footer.log.find(entry => entry[1] === job.SCRIPT.footerSweep).includes('2026-10-27T09:00:00.000Z'));
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

// ---- the one real registration (owner-run only) ------------------------------------------------

test('real Task Scheduler: register, list and remove under a scratch folder', { skip: process.platform !== 'win32' || process.env.TOOLKIT_REAL_TASK_SCHEDULER_TEST !== '1' ? 'owner-run only: set TOOLKIT_REAL_TASK_SCHEDULER_TEST=1 on Windows' : false }, (t) => {
  const home = tempHome(t);
  const scheduler = windowsTasks.powerShellScheduler();
  const folder = `TOOLKIT-TEST-${process.pid}`;
  t.diagnostic(`Disposable task folder: \\${folder}\\; actions only exit, with no GitHub calls.`);
  assert.deepEqual(scheduler.list(folder), [], 'the disposable folder must not contain existing tasks');
  const wanted = windowsTasks.desiredTasks({ checkout: ROOT, folder, deps: { governance: governance() } });
  // Even an unexpected scheduled trigger is inert. Job retries and author protection are tested
  // with fake processes/GitHub above and in toolkit-github-footer.test.cjs.
  for (const d of wanted.wanted) {
    const before = d.def;
    d.arguments = `--headless "${process.execPath}" -e "process.exit(0)"`;
    d.def = windowsTasks.definitionDigest(d);
    d.description = d.description.replace(before, d.def);
  }
  t.after(() => { try { windowsTasks.removeTasks({ folder, scheduler, home }); } catch { /* reported by the assertions */ } });
  const before = scheduler.list(null).map(task => task.name).sort();
  const legacy = { ...wanted, wanted: wanted.wanted.filter(d => d.job === 'programme-sweep').map(d => {
    const old = { ...d, schedule: { kind: 'hourly', at: '08:00', hours: 16 } };
    old.def = windowsTasks.definitionDigest(old);
    old.description = d.description.replace(d.def, old.def);
    return old;
  }) };
  // No first runs: the real scheduler only registers and reads definitions, never contacts GitHub.
  windowsTasks.applyTasks(legacy, { scheduler, home });
  assert.deepEqual(windowsTasks.applyTasks(wanted, { scheduler, home }).items.map(item => item.action), ['update', 'create', 'create']);
  assert.ok(windowsTasks.applyTasks(wanted, { scheduler, home }).items.every(item => item.action === 'current'));
  assert.deepEqual(scheduler.list(folder).map(task => task.name).sort(), wanted.wanted.map(d => d.name).sort());
  assert.ok(scheduler.list(folder).every(task => windowsTasks.parseMarker(task.description)));
  for (const d of wanted.wanted) {
    const live = scheduler.list(folder).find(task => task.name === d.name);
    assert.deepEqual([live.execute, live.arguments, live.working_directory], [d.execute, d.arguments, d.working_directory]);
    assert.equal(windowsTasks.describeTriggers(live.triggers), d.schedule_text);
  }
  const removed = windowsTasks.removeTasks({ folder, scheduler, home });
  assert.deepEqual(removed.folders, [{ folder, result: 'removed' }]);
  assert.deepEqual(scheduler.list(null).map(task => task.name).sort(), before, 'root-folder tasks unchanged');
});
