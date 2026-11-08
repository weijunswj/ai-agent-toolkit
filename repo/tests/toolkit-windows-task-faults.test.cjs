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
const { memoryRegistry, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION } = require('./support/windows-task-switch-world.cjs');
const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const shards = require('../scripts/ci-test-shards.cjs');

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
