'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { switchWorld, assertShape, printedRecovery } = require('./support/windows-task-switch-world.cjs');
const movedRows = ['live intact', 'live edited', 'stopped live', 'stopped absent', 'absent modern', 'absent legacy'];

// Split by complete test declarations to keep the per-file time budget.
for (const move of ["both"])
test(`moved recovery table: ${move}`, async t => {
  const w = switchWorld(t, { realLocations: true }), snapshots = [];
  // Build each genuine interruption at the enrolled address, then rename once and replay
  // every snapshot at the moved address. No live/registry path field simulates relocation.
  for (const phase of ['before effects','relationship','partial retirement']) for (const target of ['on','off','absent']) {
    tasks.writeRegistry(w.home, []); w.scheduler.folders.clear();
    const source = target === 'on' ? 'off' : 'on';
    await w.gov(source); assert.equal(w.cli('apply').code, 0);
    await w.gov(target);
    if (phase !== 'before effects') {
      const sourceId = w.cli('plan').json.source.id;
      let fired = false;
      if (phase === 'relationship') {
        const unregister = w.scheduler.unregister;
        w.scheduler.unregister = (...args) => { if (args[2] === sourceId) { fired = true; throw new Error('fixture interrupted before retirement'); } return unregister(...args); };
        assert.equal(w.cli('apply').code, 1); w.scheduler.unregister = unregister;
        assert.ok(tasks.readRegistry(w.home).tasks.some(e => e.replaces));
      } else {
        w.registry = { ...tasks, updateRegistry(...args) {
          const out = tasks.updateRegistry(...args);
          if (!fired && !out.some(e => e.id === sourceId)) { fired = true; throw new Error('fixture interrupted after atomic retirement'); }
          return out;
        } };
        assert.equal(w.cli('apply').code, 1); w.registry = null;
        assert.ok(!tasks.readRegistry(w.home).tasks.some(e => e.id === sourceId || e.replaces));
      }
      assert.equal(fired, true);
    }

    snapshots.push({ phase, target, entries: tasks.readRegistry(w.home).tasks, live: structuredClone([...w.scheduler.folders]) });
  }
  const old = w.move(move);
  if (move !== 'checkout') assert.throws(() => windowsTasks.readLocations({ checkout: w.root, toolkitRoot: old.toolkitRoot, home: w.home }), /ENOENT|could not|identity/);
  assert.deepEqual(w.verifyLocations(), { checkout: w.root, toolkitRoot: w.toolkitRoot });
  const folder = 'AI-AGENT-TOOLKIT';
  let cells = 0;
  for (const baseline of snapshots) for (const row of movedRows) {
    const { phase, target } = baseline; cells++;
    tasks.writeRegistry(w.home, baseline.entries);
    w.scheduler.folders.clear(); for (const [folder, rows] of structuredClone(baseline.live)) w.scheduler.folders.set(folder, rows);
    if (row === 'live edited') for (const live of w.scheduler.folders.get(folder)) { live.arguments += ' --owner-edit'; live.actions[0].arguments = live.arguments; live.definition_xml = '<edited/>'; }
    if (row.startsWith('stopped')) tasks.updateRegistry(w.home, rows => rows.map(e => ({ ...e, stopped_by_owner: true, stopped_at: w.now().toISOString() })));
    if (row.includes('absent')) w.scheduler.folders.set(folder, []);
    if (row === 'absent legacy') tasks.updateRegistry(w.home, rows => rows.map(e => { const next = { ...e }; delete next.enrolled; return next; }));
    const snapshot = () => ({ registry: fs.readFileSync(tasks.registryPath(w.home)).toString('base64'), live: JSON.stringify([...w.scheduler.folders]) });
    const before = snapshot();
    await w.gov('uncertain');
    for (const args of [[], ['--repair-owned']]) {
      const held = w.cli('apply', ...args); assert.equal(held.code, 1);
      assert.match(held.json.next_step, /refresh governance status/i);
      assert.doesNotMatch(held.json.next_step, /node .* (apply|remove) /);
      assert.deepEqual(snapshot(), before, 'uncertain governance has byte-for-byte no effects');
    }
    await w.gov(target);
    const plan = w.cli('plan'); assert.equal(plan.code, 1);
    assert.match(plan.json.next_step, /Explicit approval/);
    assert.match(plan.json.next_step, /owner-stop reactivation/);
    const ordinary = w.cli('apply'); assert.equal(ordinary.code, 1);
    assert.deepEqual(snapshot(), before, 'standing ordinary apply has byte-for-byte no effects after every move');
    // Only the ON partial-retirement snapshot has already dropped every obsolete
    // enrolment. Pin this independently of the implementation's switching decision.
    const sameShape = phase === 'partial retirement' && target === 'on';
    assert.equal(plan.json.switching, !sameShape);
    const reset = !sameShape && (row.startsWith('live') || row === 'stopped live' || row === 'absent legacy');
    if (reset) {
      assert.match(plan.json.next_step, /Complete approved reset: node .* remove --repo-root/);
      assert.doesNotMatch(plan.json.next_step, /Owner-authorised recovery: node/);
      assert.equal(w.cli('apply', '--repair-owned').code, 1);
      assert.deepEqual(snapshot(), before, 'live and legacy cross-shape repair retains every refusal before effects');
    } else assert.match(plan.json.next_step, /Owner-authorised recovery: node .* --repair-owned/);
    const result = printedRecovery(w, reset);
    assertShape(w, target);
    const entries = tasks.readRegistry(w.home).tasks;
    assert.ok(entries.every(e => e.checkout === w.root && e.toolkit_root === w.toolkitRoot && !e.stopped_by_owner));
    assert.ok(w.scheduler.list(folder).every(l => l.state === 'Ready'), 'successful repair enables each live task');
    assert.equal(result.json.items.find(i => i.first_run)?.first_run.status, 'ok', 'a completed first run is checked separately');
    assert.doesNotMatch(result.json.next_step, /^Run apply/);
    assert.equal(w.cli('apply').code, 0);
  }
  assert.equal(cells, 54, 'all phases, governance shapes and participant states proved');
});
