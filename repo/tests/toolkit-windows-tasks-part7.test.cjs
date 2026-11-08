'use strict';
const { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt } = require('./toolkit-windows-tasks-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
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
    assert.equal(script,(path.isAbsolute(managed) ? path : path.win32).join(managed,'repo','scripts','toolkit-windows-tasks.cjs')); assert.equal(target,project);
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
