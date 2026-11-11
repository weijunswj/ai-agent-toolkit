'use strict';
const { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt } = require('./toolkit-windows-tasks-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
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
    const result = movingRun(t, { home, mode, answers: problem === 'identity' ? {} : { 'gh auth': { status: 1, stderr: 'You are not logged into any GitHub hosts.' }, 'reach github': { status: problem === 'offline' ? 3 : 0 } }, deps: problem === 'identity' ? { readIdentity: () => null } : {} });
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

test('apply always reads the repository afresh after the plan was made', t => {
  const home = tempHome(t), managed = checkout(t), project = checkout(t), scheduler = fakeScheduler();
  for (let i = 0; i < 30; i++) scheduler.folders.set('UNRELATED-' + i, [unmarked('Other', { description: `[toolkit-task v1 id=unrelated-${i} def=0123456789ab]` })]);
  const counts = new Map();
  const count = key => counts.set(key, (counts.get(key) || 0) + 1);
  let origin = 'example/widget';
  const gov = root => governance({ repository: root === managed ? 'weijunswj/ai-agent-toolkit' : origin, folder: root === managed ? 'TOOLKIT' : 'WIDGET' });
  const deps = { identityReader: request => { count('location:' + request.checkout); return request; }, reportCheckout: root => root,
    governance: { readIdentity(root) { count('identity:' + root); return gov(root).readIdentity(root); },
      governanceState(root) { count('status:' + root); return gov(root).governanceState(root); } },
    readObservation(identity) { count('observation:' + identity.root); return gov(identity.root).readObservation(); } };
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
