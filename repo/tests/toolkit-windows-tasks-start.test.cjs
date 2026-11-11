'use strict';

// toolkit-windows-tasks start: starts only a task Toolkit itself owns. The permission block allows
// this command, so its own checks are what keep a foreign task from being started.
const { assert, test, memoryRegistry, fakeScheduler, windowsTasks } = require('./toolkit-windows-tasks-support.cjs');

const MARK = '[toolkit-task v1 id=demo-footer-sweep def=0123456789ab]';
const entry = (extra = {}) => ({ id: 'demo-footer-sweep', name: 'DEMO - Footer sweep', host: 'windows', folder: 'DEMO', ...extra });
const live = (extra = {}) => ({ name: 'DEMO - Footer sweep', description: `Toolkit job. ${MARK}`, ...extra });
function run(argv, { entries = [entry()], tasks = { DEMO: [live()] }, platform = 'win32', corrupt = false } = {}) {
  const scheduler = fakeScheduler(tasks);
  const started = [];
  scheduler.start = (folder, name) => { started.push([folder, name]); };
  const registry = memoryRegistry(entries);
  registry.corrupt = corrupt;
  const out = [], err = [];
  const code = windowsTasks.main(argv, { platform, scheduler, registry, home: '/nowhere', stdout: text => out.push(text), stderr: text => err.push(text) });
  return { code, started, out: out.join(''), err: err.join('') };
}

test('start runs one of Toolkit\'s own recorded tasks and says where its result shows', () => {
  const done = run(['start', '--task', 'demo-footer-sweep']);
  assert.deepEqual([done.code, done.started], [0, [['DEMO', 'DEMO - Footer sweep']]]);
  assert.equal(done.out, 'Started DEMO - Footer sweep in \\DEMO\\. toolkit tasks shows its result when it ends.\n');
  assert.deepEqual(JSON.parse(run(['start', '--task', 'demo-footer-sweep', '--json']).out), { started: { id: 'demo-footer-sweep', name: 'DEMO - Footer sweep', folder: 'DEMO' } });
});

test('start refuses every task that is not provably Toolkit\'s own, and starts nothing', () => {
  const cases = [
    ['an unrecorded id', { entries: [] }, /^Stopped: demo-footer-sweep is not a task Toolkit recorded on this computer\. Next: run toolkit tasks/],
    ['an adopted task', { entries: [entry({ adopted: true })] }, /^Stopped: demo-footer-sweep is not Toolkit's own Windows task/],
    ['a task for another host', { entries: [entry({ host: 'claude-desktop' })] }, /^Stopped: demo-footer-sweep is not Toolkit's own Windows task/],
    ['a task the owner stopped', { entries: [entry({ stopped_by_owner: true, stopped_at: '2026-11-01T00:00:00Z' })] }, /^Stopped: you turned demo-footer-sweep off, and Toolkit never restarts a task you stopped/],
    ['a task missing from Task Scheduler', { tasks: { DEMO: [] } }, /is missing or no longer carries Toolkit's marker/],
    ['a same-named task without the marker', { tasks: { DEMO: [live({ description: 'made by hand' })] } }, /is missing or no longer carries Toolkit's marker/],
    ['a same-named task with another id\'s marker', { tasks: { DEMO: [live({ description: '[toolkit-task v1 id=other-job def=0123456789ab]' })] } }, /is missing or no longer carries Toolkit's marker/],
    ['a marked task in a different folder', { tasks: { OTHER: [live()] } }, /is missing or no longer carries Toolkit's marker/],
    ['an unreadable registry', { corrupt: true }, /could not be read, so no task was started/],
  ];
  for (const [label, world, message] of cases) {
    const refused = run(['start', '--task', 'demo-footer-sweep'], world);
    assert.deepEqual([refused.code, refused.started, refused.out], [1, [], ''], label);
    assert.match(refused.err, message, label);
  }
});

test('start needs a plain task id and does nothing off Windows', () => {
  for (const argv of [['start'], ['start', '--task', '..\\Microsoft\\Windows\\Defrag'], ['start', '--task', 'demo-footer-sweep', '--folder', 'DEMO'], ['start', '--task', 'A B']]) {
    const bad = run(argv);
    assert.deepEqual([bad.code, bad.started], [2, []], argv.join(' '));
  }
  const linux = run(['start', '--task', 'demo-footer-sweep'], { platform: 'linux' });
  assert.deepEqual([linux.code, linux.started], [0, []]);
  assert.match(linux.out, /^not-windows: /);
});
