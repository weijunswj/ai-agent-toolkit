'use strict';
const { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt } = require('./toolkit-windows-tasks-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
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

test('G: the registered task runs headless as the logged-on user, ignores a second start and stops at its time limit', () => {
  const script = windowsTasks.SCRIPTS.register;
  assert.match(script, /-LogonType Interactive -RunLevel Limited/);
  assert.match(script, /-StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit \(New-TimeSpan -Minutes \$p\.time_limit_minutes\) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries/);
  // One minute past the job's 55-minute work budget, before the next hourly start.
  assert.equal(windowsTasks.TASK_TIME_LIMIT_MINUTES, 56);
  assert.match(script, /IndexOf\(\$p\.marker_prefix\) -lt 0 -and -not \(\$p\.expected_xml/);
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
