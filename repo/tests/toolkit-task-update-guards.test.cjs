'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tasks = require('../scripts/toolkit-tasks.cjs');
const job = require('../scripts/toolkit-scheduled-job.cjs');
const health = require('../scripts/toolkit-task-health.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
const { world, memoryStore } = require('./support/task-health-world.cjs');
const s = require('./support/windows-task-switch-world.cjs');
for (const state of ['owner stop', 'disabled', 'permission denied', 'unreadable registry']) test(`update authority matrix: ${state} stops effects`, t => {
  const w = world(t);
  update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
  w.updater().installHealth(w.desired); // Independent computer task is already current.
  const before = w.scheduler.calls.length;
  if (state === 'owner stop') tasks.updateRegistry(w.home, rows => rows.map(row => ({ ...row, stopped_by_owner: true, stopped_at: w.at.toISOString() })));
  if (state === 'disabled') w.scheduler.folders.get(w.entry.folder)[0].state = 'Disabled';
  if (state === 'permission denied') w.scheduler.list = () => { throw new Error('Access denied'); };
  if (state === 'unreadable registry') fs.writeFileSync(tasks.registryPath(w.home), '{');
  const run = () => w.updater({ question: () => assert.fail('No owner choice can clear this state') }).run({ apply: true });
  if (state === 'unreadable registry') assert.throws(run, /unreadable/);
  else run();
  assert.ok(w.scheduler.calls.slice(before).every(call => !['register', 'unregister', 'start'].includes(call[0]) || state === 'owner stop' && call[1] !== w.entry.folder));
});
for (const fresh of [false, true]) for (const enabled of [false, true]) test(`store authority matrix: fresh=${fresh}, enabled=${enabled}`, t => {
  const w = world(t), store = memoryStore(); let verifies = 0;
  store.verify = () => { verifies++; return true; };
  w.owner.checkout = () => ({ certain: fresh, governanceState: enabled ? 'ENABLED' : 'DISABLED', repository: 'example/widget', binding: s.fixtureBinding('example/widget') });
  w.owner.storeFactory = () => store;
  const result = w.owner.run();
  assert.equal(result.shared, fresh && enabled); assert.equal(verifies, fresh && enabled ? 1 : 0);
});
test('real store adapter checks private writable branch, CAS, secret scan and exact commit readback', t => {
  const w = world(t), document = w.owner.collect(), calls = [], files = new Map();
  const store = { repository: 'example/evidence', branch: 'main', path: 'state/' };
  const transport = { request(method, endpoint, body) {
    calls.push({ method, endpoint, body });
    if (endpoint === 'repos/example/evidence') return { status: 200, json: { private: true, permissions: { push: true } } };
    if (endpoint.includes('/branches/')) return { status: 200, json: {} };
    if (method === 'PUT') { files.set(endpoint, body.content); return { status: 201, json: { commit: { sha: 'a'.repeat(40) } } }; }
    const content = files.get(endpoint.split('?')[0]); return content ? { status: 200, json: { encoding: 'base64', content, sha: 'b'.repeat(40) } } : { status: 404 };
  } };
  const adapter = new health.HealthStore({ transport, store }); adapter.verify();
  const file = `task-health/${document.computer}.json`; adapter.put(file, document, null);
  assert.ok(calls.some(call => call.method === 'GET' && call.endpoint.endsWith(`?ref=${'a'.repeat(40)}`)));
  const puts = calls.filter(call => call.method === 'PUT').length;
  assert.throws(() => adapter.put(file, { value: ['gh', 'p_', 'a'.repeat(36)].join('') }, null), /secret/);
  assert.equal(calls.filter(call => call.method === 'PUT').length, puts);
  const conflict = new health.HealthStore({ store, transport: { request: (method, endpoint) => method === 'PUT' ? { status: 409 } : transport.request(method, endpoint) } });
  assert.throws(() => conflict.put(file, document, 'old'), /changed or write failed/);
  for (const repo of [{ private: false, permissions: { push: true } }, { private: true, permissions: { push: false } }]) {
    const refused = new health.HealthStore({ store, transport: { request: () => ({ status: 200, json: repo }) } });
    assert.throws(() => refused.verify(), /not private|cannot write/);
  }
});
test('corrupt ref retains origin footer work and exposes the fetch failure in health', t => {
  const w = world(t), git = args => spawnSync('git', ['-C', w.root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(git(['init', '--quiet']).status, 0);
  const ref = path.join(w.root, '.git/refs/remotes/origin/main'); fs.mkdirSync(path.dirname(ref), { recursive: true }); fs.writeFileSync(ref, 'broken-ref\n');
  assert.notEqual(git(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']).status, 0);
  const binding = s.fixtureBinding('example/widget'), fake = s.fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true }, refresh: { refreshed: false, reason: 'fetch-failed' } }) } });
  const record = job.runJob({ job: 'footer-sweep', repoRoot: w.root, taskId: w.entry.id }, { home: w.home, ghPath: s.GH, run: fake.run, repositoryReader: s.testRepository,
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: '/example/widget.git' } }), readObservation: () => ({ status: 'enabled', fresh: true, binding }) });
  assert.ok(fake.log.some(call => call[1] === job.SCRIPT.footerSweep));
  assert.match(record.summary.join(' '), /default branch fetch failed/);
  // The footer result is held, retaining the retry window. Preserve its public reason.
  assert.ok(w.owner.collect().repos[0].flags.some(flag => flag.includes('default branch fetch failed')));
});
test('loud failure is present in tasks, the single session task line and the health file', t => {
  const w = world(t); tasks.writeLastRun(w.entry.id, { status: 'failed', started: w.at.toISOString(), finished: w.at.toISOString(), summary: ['Fixture failure'] }, w.home);
  const saved = w.owner.run();
  assert.match(tasks.formatList(tasks.listTasks({ home: w.home, scheduler: w.scheduler, platform: 'win32', folderFor: () => null })), /failed/);
  assert.match(tasks.sweepLine('example/widget', { home: w.home, now: w.at }), /last run failed/);
  assert.ok(saved.document.repos[0].flags.some(flag => flag.includes('last run failed')));
});
test('setup uses the same saved approval and stops on pending host questions', t => {
  const w = world(t); let runs = 0;
  const updater = { run: options => { runs++; assert.equal(options.apply, true); return { plans: [], questions: [update.approvalQuestion()] }; } };
  assert.equal(core.applyScheduledTasks({ repoRoot: w.root }, { home: w.home, platform: 'win32', updater, log() {} }), null);
  update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/setup-answer' }, '3.52.0');
  assert.deepEqual(core.applyScheduledTasks({ repoRoot: w.root }, { home: w.home, platform: 'win32', updater, log() {} }), { held: true }); assert.equal(runs, 1);
  const rows = core.setupQuestionDocumentationSpecs(), approval = rows.find(row => row.id === 'scheduled-task-update');
  assert.equal(approval.recommended, 'no'); assert.match(approval.whatThisControls, /TASK HEALTH/);
});

test('failed health job has its own visible receipt and foreign ownership stops sharing', t => {
  const w = world(t); update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
  w.updater().run({ apply: true });
  const entry = tasks.readRegistry(w.home).tasks.find(row => row.job === 'task-health');
  const options = { job: 'task-health', taskId: entry.id, repoRoot: w.root };
  const scheduler = { ...w.scheduler, list() { throw new Error('Native permission denied'); } };
  const record = job.runJob(options, { home: w.home, scheduler, platform: 'win32' });
  assert.equal(record.status, 'failed'); assert.equal(record.exit, 1);
  assert.match(tasks.sweepLine('example/widget', { home: w.home }), /Task health: last run failed/);
  tasks.updateRegistry(w.home, rows => rows.map(row => row.id === entry.id ? { ...row, job_owner: 'local-00000000-0000-0000-0000-000000000000' } : row));
  assert.equal(job.runJob(options, { home: w.home, scheduler, platform: 'win32' }).status, 'skipped');
});

test('health registration rolls back its own unchanged native write if enrolment persistence fails', t => {
  const w = world(t); update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
  const real = tasks.updateRegistry;
  t.mock.method(tasks, 'updateRegistry', (home, change) => real(home, rows => {
    const next = change(rows); if (next.some(row => row.job === 'task-health')) throw new Error('Fixture disk failure'); return next;
  }));
  // The health failure is reported beside the repository results, with the same restoration proof.
  const result = w.updater().run({ apply: true });
  assert.ok(result.results.some(row => row.task === 'task-health' && row.refused && /New registration removed and read back/.test(row.reason)), JSON.stringify(result.results));
  assert.equal(w.scheduler.list('TOOLKIT-HEALTH').length, 0);
  assert.ok(!tasks.readRegistry(w.home).tasks.some(row => row.job === 'task-health'));
});

for (const state of ['folder', 'id', 'name', 'missing baseline', 'foreign computer', 'adopted']) test(`computer health identity matrix: ${state} cannot create a second health task`, t => {
  const w = world(t); update.saveApproval(w.home, { decision: 'standing', answer_ref: 'host/standing' }, '3.52.0');
  w.updater().run({ apply: true });
  tasks.updateRegistry(w.home, rows => rows.map(row => {
    if (row.job !== 'task-health') return row;
    const next = { ...row };
    if (state === 'folder') next.folder = 'OTHER';
    if (state === 'id') next.id = 'other-task-health';
    if (state === 'name') next.name = 'Other health task';
    if (state === 'missing baseline') delete next.enrolled;
    if (state === 'foreign computer') next.job_owner = 'local-00000000-0000-0000-0000-000000000000';
    if (state === 'adopted') next.adopted = true;
    return next;
  }));
  assert.equal(w.updater().run().computer_task.action, 'refused');
  const before = w.scheduler.calls.length;
  try { w.updater().run({ apply: true }); } catch (error) { assert.match(error.message, /Health task/); }
  assert.ok(w.scheduler.calls.slice(before).every(call => !['register', 'unregister', 'start'].includes(call[0])));
  assert.equal(w.scheduler.list('TOOLKIT-HEALTH').length, 1);
});
