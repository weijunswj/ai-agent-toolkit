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
const { memoryRegistry, fixtureGovernance: governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION } = require('./support/windows-task-switch-world.cjs');
const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const shards = require('../scripts/ci-test-shards.cjs');

const MEMORY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-authority-'));
test.after(() => fs.rmSync(MEMORY_HOME, { recursive: true, force: true }));

const matrixKinds = ['managed checkout', 'plugin copy', 'linked worktree', 'other copy'];
const matrixTargets = ['main checkout', 'linked worktree', 'missing/not a repo'];
const matrixStates = ['absent', 'healthy same repository', 'healthy other repository', 'healthy other checkout', 'disabled', 'edited action', 'edited trigger', 'removed by owner', 'adopted/unowned', 'corrupt registry'];
const matrixRequesters = ['agent standing', 'owner explicit', 'setup plan'];
for (const shape of ['programme', 'footer']) for (const toolkit of matrixKinds) for (const target of matrixTargets) for (const state of matrixStates) for (const requester of matrixRequesters) {
  test(`closure: ${shape} / ${toolkit} / ${target} / ${state} / ${requester}`, () => {
    const scheduler = fakeScheduler();
    const registry = memoryRegistry();
    const root = 'C:\\Repositories\\widget';
    const wanted = windowsTasks.desiredTasks({ checkout: root, toolkitRoot: TOOLKIT_ROOT, nodePath: NODE, deps: { identityReader, governance: governance({ repository: 'example/widget', folder: 'WIDGET', state: shape === 'footer' ? 'UNDECIDED' : 'ENABLED' }) } });
    const owner = () => new windowsTasks.WindowsTaskOwner({ scheduler, registry, home: MEMORY_HOME, identityReader,
      now: () => new Date('2026-11-05T00:00:00.000Z'), repairOwned: requester === 'owner explicit' });
    if (state !== 'absent') assert.ok(owner().apply(wanted).items.every(item => item.done));
    if (state === 'healthy other repository') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, repository: 'someone-else/widget' })));
    if (state === 'healthy other checkout') registry.updateRegistry(null, rows => rows.map(row => ({ ...row, checkout: 'C:\\Old\\widget' })));
    if (state === 'disabled') scheduler.folders.get('WIDGET')[0].state = 'Disabled';
    if (state === 'edited action') scheduler.folders.get('WIDGET')[0].arguments += ' --owner-edit';
    if (state === 'edited trigger') scheduler.folders.get('WIDGET')[shape === 'footer' ? 0 : 1].triggers = [{ kind: 'MSFT_TaskWeeklyTrigger', start: '2099-01-01T09:15:00', days_of_week: 2 }];
    if (state === 'removed by owner') owner().remove('WIDGET', wanted);
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
      const instance = new windowsTasks.WindowsTaskOwner({ scheduler, registry, home: MEMORY_HOME, identityReader: reader,
        now: () => new Date('2026-11-05T00:00:00.000Z'), repairOwned: requester === 'owner explicit' });
      return requester === 'setup plan' ? instance.plan(wanted) : instance.apply(wanted);
    };
    if (!validLocation || state === 'corrupt registry' && requester !== 'setup plan') assert.throws(invoke);
    else { result = invoke(); assert.equal(result.items.every(item => !['refused', 'owner-choice-required'].includes(item.action)), allowed); }
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
