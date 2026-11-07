'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const health = require('../scripts/toolkit-task-health.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const { world, memoryStore } = require('./support/task-health-world.cjs');
const s = require('./support/windows-task-switch-world.cjs');

// example/widget is enrolled by the world; enrol example/beta from its own checkout, then give
// each repository its own verified evidence store.
function twoRepositories(t, { betaVerified = true } = {}) {
  const w = world(t), beta = s.checkout(t);
  update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
  const governance = { readIdentity: r => ({ valid: true, root: r, remote: { host: 'github.com', path: r === beta ? '/example/beta.git' : '/example/widget.git' } }), governanceState: () => ({ state: 'DISABLED', merged: { fresh: true, status: 'disabled' } }), readObservation: () => ({ status: 'disabled', fresh: true, binding: s.fixtureBinding('example/beta', 'BETA', false) }) };
  const betaDesired = windows.desiredTasks({ checkout: beta, toolkitRoot: s.TOOLKIT_ROOT, nodePath: s.NODE, home: w.home, deps: { identityReader: s.identityReader, governance } });
  const enrolled = w.updater({ discover: () => [beta], desired: ({ checkout }) => checkout === beta ? betaDesired : w.desired }).run({ apply: true });
  assert.ok(!enrolled.results.some(row => row.refused), JSON.stringify(enrolled.results));
  const stores = { 'example/transport-widget': memoryStore(), 'example/transport-beta': memoryStore() };
  const binding = name => ({ ...s.fixtureBinding(`example/${name}`), store: { kind: 'github', repository: `example/TRANSPORT-${name}`, branch: 'main', path: 'state/' } });
  w.owner.checkout = root => root === w.root ? { certain: true, governanceState: 'ENABLED', repository: 'example/widget', binding: binding('widget') }
    : root === beta && betaVerified ? { certain: true, governanceState: 'ENABLED', repository: 'example/beta', binding: binding('beta') } : null;
  w.owner.storeFactory = store => stores[store.repository.toLowerCase()];
  w.owner.takeLock = () => ({ release() {} });
  const updater = options => w.updater({ discover: () => [beta], desired: ({ checkout }) => checkout === beta ? betaDesired : w.desired, ...options });
  return { w, beta, stores, updater };
}
const shared = store => [...store.files].filter(([file]) => /^task-health\/computer-/.test(file)).flatMap(([, value]) => value.doc.repos.map(repo => repo.repository));

test('Health store: each evidence store receives only its own repository\'s results', t => {
  const { w, stores } = twoRepositories(t);
  const result = w.owner.run();
  assert.equal(result.shared, true);
  assert.deepEqual(shared(stores['example/transport-widget']), ['example/widget']);
  assert.deepEqual(shared(stores['example/transport-beta']), ['example/beta']);
  assert.deepEqual(result.document.repos.map(repo => repo.repository), ['example/beta', 'example/widget'], 'the local file keeps every repository');
});

test('Health store: a repository without its own verified store stays local-only', t => {
  const { w, stores } = twoRepositories(t, { betaVerified: false });
  const result = w.owner.run();
  assert.equal(result.shared, false);
  assert.deepEqual(shared(stores['example/transport-widget']), ['example/widget']);
  assert.equal(stores['example/transport-beta'].writes.length, 0);
  assert.doesNotMatch(health.sessionHealth('example/widget', w.home) || '', /not shared/);
  assert.match(health.sessionHealth('example/beta', w.home) || '', new RegExp(health.LOCAL_ONLY));
});

test('Health store: computer ownership is read only from the repository\'s own store', t => {
  const { updater, stores } = twoRepositories(t);
  const claim = repo => ({ schema: 'toolkit.task-owners.v1', repos: { [repo]: { computer: 'computer-0123456789ab', answer_ref: 'host/other-computer' } } });
  // A claim in another repository's store decides nothing, whichever store is read first.
  stores['example/transport-widget'].put('task-health/owners.json', claim('example/beta'), null);
  stores['example/transport-beta'].put('task-health/owners.json', claim('example/widget'), null);
  const removals = plan => plan.changes.filter(change => change.action === 'remove').map(change => change.repository.toLowerCase());
  assert.deepEqual(removals(updater().run()), []);
  // The same claim in beta's own store hands beta's jobs to the other computer.
  const beta = stores['example/transport-beta'];
  beta.put('task-health/owners.json', claim('example/beta'), beta.read('task-health/owners.json').sha);
  assert.deepEqual([...new Set(removals(updater().run()))], ['example/beta']);
});
