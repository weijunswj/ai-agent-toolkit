'use strict';
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
const MEMORY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-memory-'));
test.after(() => fs.rmSync(MEMORY_HOME, { recursive: true, force: true }));
const hostile = require('./support/hostile-inputs.cjs');
function copyComputerIdentity(home, replayHome) {
  fs.mkdirSync(tasks.userStateDir(replayHome), { recursive: true });
  fs.copyFileSync(path.join(tasks.userStateDir(home), 'task-computer.json'), path.join(tasks.userStateDir(replayHome), 'task-computer.json'));
}
function desired(t, options = {}) {
  return windowsTasks.desiredTasks({ checkout: options.root || checkout(t, options), toolkitRoot: TOOLKIT_ROOT, nodePath: options.nodePath || NODE, systemRoot: 'C:\\Windows',
    folder: options.folder || null, deps: { identityReader, governance: governance(options) } });
}
const unmarked = (name, extra = {}) => ({ name, description: 'My own task', state: 'Ready', execute: 'C:\\x.exe', arguments: '', working_directory: '', triggers: [], last_run: null, last_result: 0, ...extra });
const REPO_ROOT = path.join(os.tmpdir(), 'tk-job-checkout');
const GOVERNED = { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true } }) };
const BINDING = () => fixtureBinding();
const READ_IDENTITY = root => ({ valid: true, root, remote: { host: 'github.com', path: '/weijunswj/ai-agent-toolkit.git' } });
const OBSERVATION = () => ({ status: 'enabled', fresh: true, binding: BINDING() });
const options = { job: 'programme-sweep', repoRoot: REPO_ROOT, taskId: 'toolkit-programme-sweep' };
function runSweep(t, answers, home = tempHome(t), clock = '2026-10-29T09:00:00.000Z') {
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob({ ...options, repoRoot: checkout(t) }, { home, run: fake.run, repositoryReader: testRepository, ghPath: GH, nodePath: NODE, readIdentity: READ_IDENTITY, readObservation: OBSERVATION, now: () => new Date(clock) });
  return { record, log: fake.log, home };
}
function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), fs.readFileSync(file).toString('base64')];
    }));
}
function listedHome(t) {
  const home = tempHome(t);
  const scheduler = fakeScheduler();
  const wanted = desired(t);
  windowsTasks.applyTasks(wanted, { scheduler, home });
  return { home, scheduler };
}
let baseRunner;
function baseRun(t, home, clock = '2026-10-01T09:00:00Z') {
  if (!baseRunner) {
    const Module = require('node:module');
    const load = name => {
      const file = path.join(ROOT, 'repo/scripts', name);
      const bytes = require('node:child_process').execFileSync('git', ['show', `7affa3000:repo/scripts/${name}`], { cwd: ROOT, timeout: 10000 });
      const mod = new Module(file);
      const original = Module.createRequire(file);
      mod.require = id => id === './toolkit-tasks.cjs' ? baseTasks : original(id);
      mod._compile(bytes.toString(), file);
      return mod.exports;
    };
    const baseTasks = load('toolkit-tasks.cjs');
    baseRunner = load('toolkit-scheduled-job.cjs');
  }
  let tick = Date.parse(clock);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  const receipt = baseRunner.runJob(options, { home, ghPath: GH, nodePath: NODE, mergedBinding: BINDING,
    now: () => new Date(tick += 1000), run: (...args) => { tick += 10000; return fake.run(...args); } });
  assert.equal(receipt.status, 'ok');
  assert.ok(Date.parse(receipt.started) < Date.parse(receipt.footer_sweep_since));
  assert.ok(Date.parse(receipt.footer_sweep_since) < Date.parse(receipt.finished));
  assert.equal(receipt.repository, undefined);
  return receipt;
}
function movingRun(t, { home = tempHome(t), mode = 'programme-sweep', clock = '2026-10-29T09:00:00Z', answers = {}, deps = {} } = {}) {
  let tick = Date.parse(clock);
  const ticks = [];
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION, ...answers });
  const record = job.runJob({ ...options, job: mode, taskId: mode === 'programme-sweep' ? options.taskId : 'toolkit-footer-sweep', repoRoot: checkout(t) }, {
    home, ghPath: GH, nodePath: NODE, repositoryReader: testRepository, readIdentity: READ_IDENTITY, readObservation: OBSERVATION,
    now: () => { ticks.push(tick += 1000); return new Date(tick); },
    run: (...args) => { tick += 10000; return fake.run(...args); }, ...deps,
  });
  return { record, log: fake.log, ticks, home };
}
const sweepCall = result => result.log.find(row => row[1] === job.SCRIPT.footerSweep);
const sinceOf = result => { const call = sweepCall(result); return call && call[call.indexOf('--since') + 1]; };
const stateAnswer = (status, fresh = true) => ({ status: status === 'invalid' ? 2 : 0, stdout: JSON.stringify({ state: status === 'enabled' ? 'ENABLED' : status === 'disabled' ? 'DISABLED' : status === 'none' ? 'UNDECIDED' : status === 'invalid' ? 'ERROR' : 'UNAVAILABLE', ...(status === 'invalid' ? { rule: 'M0' } : {}), merged: { status, fresh } }) });
const stateObservation = (status, fresh = true) => () => ({ status, fresh, ...(['enabled','disabled'].includes(status) ? { binding: fixtureBinding(undefined, undefined, status === 'enabled') } : {}) });
const RUNTIME_MATRIX = [
  ['enabled', true, true, 2], ['disabled', true, false, 1], ['none', true, false, 1],
  ['enabled', false, false, 1], ['unknown', false, false, 1], ['invalid', true, false, 1], ['foreign', true, false, 1],
];
function switchOffer(t, shape, root) { return desired(t, { root, state: shape === 'programme-sweep' ? 'ENABLED' : 'DISABLED' }); }
let currentMainRunner;
function currentMainReceipt(home, root, clock, taskId = 'toolkit-programme-sweep') {
  if (!currentMainRunner) {
    const Module = require('node:module'), file = path.join(ROOT, 'repo/scripts/toolkit-scheduled-job.cjs');
    const bytes = require('node:child_process').execFileSync('git', ['show', 'cbd3d6078:repo/scripts/toolkit-scheduled-job.cjs'], { cwd: ROOT, timeout: 10000 });
    const loaded = new Module(file); loaded.require = Module.createRequire(file); loaded._compile(bytes.toString(), file); currentMainRunner = loaded.exports;
  }
  let tick = Date.parse(clock);
  const fake = fakeRun({ 'toolkit-governance.cjs': GOVERNED, 'programme attention': ATTENTION });
  const receipt = currentMainRunner.runJob({ job: 'programme-sweep', taskId, repoRoot: root }, { home, ghPath: GH, nodePath: NODE,
    repositoryReader: testRepository, mergedBinding: BINDING, now: () => new Date(tick += 1000), run: (...args) => { tick += 10000; return fake.run(...args); } });
  assert.equal(receipt.status, 'ok'); assert.ok(receipt.footer_sweep_since); return receipt;
}
module.exports = { assert, fs, os, path, test, ROOT, memoryRegistry, governance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION, windowsTasks, job, tasks, programmeState, shards, MEMORY_HOME, hostile, copyComputerIdentity, desired, unmarked, REPO_ROOT, GOVERNED, BINDING, READ_IDENTITY, OBSERVATION, options, runSweep, snapshot, listedHome, baseRunner, baseRun, movingRun, sweepCall, sinceOf, stateAnswer, stateObservation, RUNTIME_MATRIX, switchOffer, currentMainRunner, currentMainReceipt };
