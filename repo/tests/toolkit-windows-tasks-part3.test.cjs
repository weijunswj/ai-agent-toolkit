'use strict';
const { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt } = require('./toolkit-windows-tasks-support.cjs');

// Complete original test declarations, split to keep the per-file time budget.
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

test('G: setup prints no per-repository task plan, and --remove-toolkit-tasks removes only Toolkit\'s own', async (t) => {
  const core = require('../scripts/setup-toolkit-core.cjs');
  const home = tempHome(t);
  const root = checkout(t);
  const scheduler = fakeScheduler();
  assert.equal(core.printWindowsTasks, undefined, 'setup prints no task plan for one repository');
  const source = fs.readFileSync(require.resolve('../scripts/setup-toolkit-core.cjs'), 'utf8');
  assert.equal(source.includes('## Windows scheduled tasks'), false, 'setup has no per-repository task section');
  assert.ok(source.includes('const scheduledTaskUpdate = applyScheduledTasks(args);'), 'the computer-wide task update stays');
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

test('J: an exit-zero queued refresh is recorded as held and attention still runs', t => {
  const report = { outcome: 'QUEUED', reason: 'another pass is running on this computer' };
  const { record, home } = runSweep(t, { 'programme refresh': { status: 0, stdout: JSON.stringify(report) } });
  assert.doesNotMatch(record.summary.join(' '), /Programme refresh: done/);
  assert.equal(record.programme_status, 'held');
  assert.equal(record.status, 'held');
  assert.equal(record.exit, 0);
  assert.ok(record.summary.includes('Programme refresh queued: another pass is already running.'));
  assert.ok(record.summary.includes('Attention: clear (stored on #421, written 3 min ago)'));
  assert.deepEqual(tasks.readLastRun('toolkit-programme-sweep', home), record);
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
  const out = runSweep(t, { 'gh auth': { status: 1, stderr: 'You are not logged into any GitHub hosts.' } });
  assert.equal(out.record.status, 'skipped');
  assert.deepEqual(out.record.summary, ['skipped: gh not signed in']);
  assert.deepEqual(out.log.map(entry => entry.slice(0, 2)), [[GH, 'auth']], 'confirmed sign-out needs no network inference');
  const stale = runSweep(t, { 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: false } }) } });
  assert.equal(stale.record.programme_reason, 'binding observation expired');
  assert.equal(stale.record.footer_status, 'held');
  assert.ok(stale.log.some(entry => entry[1] === job.SCRIPT.footerSweep));
  assert.equal(stale.log.some(entry => entry[1] === job.SCRIPT.programme), false);

});

test('J: offline is told apart from signed out, skips count up in a row, and the next good run notes the resume', (t) => {
  const home = tempHome(t);
  const OFFLINE = { 'gh auth': { status: 1, stderr: 'Network unavailable' }, 'reach github': { status: 3 } };
  const first = runSweep(t, OFFLINE, home, '2026-11-01T04:00:05.000Z');
  assert.deepEqual([first.record.status, first.record.exit, first.record.reason, first.record.skipped_streak, first.record.skipped_since], ['skipped', 0, 'offline', 1, '2026-11-01T04:00:05.000Z']);
  assert.deepEqual(first.record.summary, ['skipped: offline']);
  const probe = first.log.find(entry => entry[1] === '-e');
  assert.match(probe[2], /connect\(\{host:'github\.com',port:443,timeout:8000\}\)/, 'one connection to github.com, nothing sent');
  const second = runSweep(t, OFFLINE, home, '2026-11-01T05:00:05.000Z');
  assert.deepEqual([second.record.skipped_streak, second.record.skipped_since], [2, '2026-11-01T04:00:05.000Z']);
  const signedOut = runSweep(t, { 'gh auth': { status: 1, stderr: 'You are not logged into any GitHub hosts.' } }, home, '2026-11-01T06:00:05.000Z');
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
  runSweep(t, { 'gh auth': { status: 1, stderr: 'Network unavailable' }, 'reach github': { status: 3 } }, home, '2026-11-01T04:00:05.000Z');
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
    { answers: { 'toolkit-governance.cjs': { status: 0, stdout: '{broken' } }, reason: 'governance status could not be read', deferred: true },
    { answers: { 'toolkit-governance.cjs': { status: 0, stdout: '{"state":"ENABLED","merged":{"status":"enabled","fresh":false}}' } }, reason: 'binding observation expired', deferred: true },
    { answers: { 'gh auth': { status: 1, stderr: 'You are not logged into any GitHub hosts.' } }, reason: 'gh not signed in' },
    { answers: { 'gh auth': { status: 1, stderr: 'Network unavailable' }, 'reach github': { status: 3 } }, reason: 'offline', deferred: true },
    { answers: { 'refresh-shard-timings.cjs': { status: 2, stderr: 'invalid manifest' } }, failed: true },
  ];
  for (const row of rows) {
    const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, ...row.answers });
    const record = job.runJob({ job: 'shard-timings', repoRoot: checkout(t), taskId: 'x-shard-timings' }, { home: tempHome(t), run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE });
    assert.equal(record.status, row.failed ? 'failed' : row.deferred ? 'deferred' : 'skipped');
    assert.equal(record.exit, row.failed ? 1 : 0);
    if (row.reason) assert.deepEqual(record.summary, [`${row.deferred ? 'deferred' : 'skipped'}: ${row.reason}`]);
    else assert.match(record.summary.join('\n'), /invalid manifest/);
    assert.equal(fake.log.some(entry => entry[1] === job.SCRIPT.shardTimings), !!row.failed);
  }
});
