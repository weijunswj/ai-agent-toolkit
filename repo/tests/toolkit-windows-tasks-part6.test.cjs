'use strict';
const { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt } = require('./toolkit-windows-tasks-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
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
