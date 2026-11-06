'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { confirmedTaskShape } = require('../scripts/toolkit-task-shape.cjs');
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');
const { fixtureBinding } = require('./support/windows-task-switch-world.cjs');
const { readIdentity } = require('../scripts/toolkit-governance-state.cjs');

test('direct Windows task listing uses the merged schedule folder without a circular dependency warning', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-direct-tasks-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const checkout = path.join(home, 'checkout');
  const folder = 'FIXTURE-SCHEDULE';
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/example/widget.git\n');
  const identity = readIdentity(checkout);
  assert.equal(identity.remote.canonical, 'https://github.com/example/widget.git');
  recordMerged(checkout, { home, text: JSON.stringify(fixtureBinding('example/widget', folder)) });
  const preload = path.join(home, 'win32.cjs');
  fs.writeFileSync(preload, `
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // Keep the real CLI path, but never start PowerShell or Task Scheduler.
    const cp = require('node:child_process');
    const spawnSync = cp.spawnSync;
    cp.spawnSync = (command, ...args) => /powershell/i.test(String(command))
      ? { status: 1, stdout: '', stderr: 'fixture scheduler unavailable' }
      : spawnSync(command, ...args);
  `);
  const result = require('node:child_process').spawnSync(process.execPath,
    ['--require', preload, path.resolve(__dirname, '../scripts/toolkit-tasks.cjs')], {
      cwd: checkout, env: { ...process.env, HOME: home, USERPROFILE: home, TOOLKIT_GOVERNANCE_OFFLINE: '1', NODE_OPTIONS: '', NODE_NO_WARNINGS: '0' },
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Scheduled tasks/);
  assert.ok(result.stdout.includes(`\\${folder}\\`), result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('\\WIDGET\\'), result.stdout);
  assert.doesNotMatch(result.stderr, /circular dependency/i);
});

const LINE = 'Toolkit tasks: recorded Windows tasks do not match confirmed governance. Read fresh governance status, then run toolkit-windows-tasks.cjs plan --repo-root <repo> from the managed Toolkit checkout. Apply only when existing approval covers that plan; otherwise ask the owner. Preserve owner stops and held keep answers.';
const P = 'programme-sweep', S = 'shard-timings', F = 'footer-sweep';
const entry = (job, extra = {}) => ({ id: `fixture-${job}`, host: 'windows', folder: 'FIXTURE', repository: 'Example/Widget', job,
  name: job, schedule: 'hourly', purpose: 'fixture', created: new Date().toISOString(), created_by: 'fixture', model: null, effort: null, ...extra });
const observation = (state, status, fresh = true, extra = {}) => ({ state, repository: 'example/widget', merged: { status, fresh }, ...extra });
const observations = [
  ['fresh enabled', observation('ENABLED', 'enabled'), [1,0,1,0,0,0,0,1,0]],
  ['fresh disabled', observation('DISABLED', 'disabled'), [1,1,0,0,0,0,0,1,0]],
  ['fresh absent', observation('UNDECIDED', 'none'), [1,1,0,0,0,0,0,1,0]],
  ['undecided unknown', observation('UNDECIDED', 'unknown'), Array(9).fill(0)],
  ['stale', observation('ENABLED', 'enabled', false), Array(9).fill(0)],
  ['unavailable', observation('UNAVAILABLE', 'unknown'), Array(9).fill(0)],
  ['error', observation('ERROR', 'invalid'), Array(9).fill(0)],
  ['foreign', observation('UNDECIDED', 'foreign'), Array(9).fill(0)],
];
const shapes = [
  ['P', [entry(P)]], ['P+S', [entry(P),entry(S)]], ['F', [entry(F)]], ['none', []],
  ['owner-stopped', [entry(P, { stopped_by_owner: true, stopped_at: new Date().toISOString() })]],
  ['adopted', [entry(P, { adopted: true })]], ['unreadable', null],
  ['relationship overlap', [entry(P, { replaces: { cleaner: { job: F } } }),entry(F)]],
  ['foreign repo', [entry(P, { repository: 'someone/else' })]],
];
for (const [name, state, expected] of observations) for (const [index, [shape, rows]] of shapes.entries()) {
  test(`task governance table: ${name} / ${shape}`, () => {
    const registry = rows ? { status: 'ok', tasks: rows } : { status: 'unreadable' };
    assert.equal(tasks.taskGovernanceLine(state, { platform: 'win32', environment: {}, registry }), expected[index] ? LINE : null);
  });
}

test('confirmed shape is pure; unknown observations select nothing', () => {
  for (const governanceState of ['ENABLED','DISABLED','UNDECIDED','ERROR','UNAVAILABLE']) {
    assert.equal(confirmedTaskShape({ certain: false, governanceState }), null);
    assert.deepEqual(confirmedTaskShape({ certain: true, governanceState }), governanceState === 'ENABLED' ? [P,S] : ['DISABLED','UNDECIDED'].includes(governanceState) ? [F] : null);
  }
});

test('task governance comparison: stops, latest keep, later replace, overlap, duplicates and platform', () => {
  const on = observation('ENABLED', 'enabled');
  const warn = (rows, opts = {}, state = on) => tasks.taskGovernanceLine(state, { platform: 'win32', environment: {}, registry: { status: 'ok', tasks: rows }, ...opts });
  const choice = (outcome, day) => ({ task: 'fixture-footer-sweep', outcome, at: `2026-11-0${day}T00:00:00.000Z` });
  assert.equal(warn([entry(F, { task_choices: [choice('keep',1)] })]), null);
  assert.equal(warn([entry(F, { task_choices: [choice('keep',1),choice('replace',2)] })]), LINE);
  assert.equal(warn([entry(F, { task_choices: [choice('replace',2),choice('keep',1)] })]), null, 'latest appended keep still holds if the clock moved back');
  assert.equal(warn([entry(P, { task_choices: [choice('keep',1)] }),entry(F, { task_choices: [choice('replace',2)] })]), LINE);
  assert.equal(warn([entry(F, { task_choices: [choice('keep',1),choice('replace',1)] })]), LINE, 'a later recorded replace supersedes keep even in the same millisecond');
  assert.equal(warn([entry(F, { task_choices: [choice('replace',1),choice('keep',1)] })]), null);
  assert.equal(warn([entry(P, { task_choices: [choice('keep',1)] }),entry(F, { task_choices: [choice('replace',1)] })]), null, 'contradictory equal-time records on different rows are uncertain');
  for (const rows of [[entry(S)], [entry(P),entry(P, { id: 'duplicate-job' })], [entry(P),entry(S),entry(F)]]) assert.equal(warn(rows), LINE);
  assert.equal(warn([entry(P, { replaces: { cleaner: { job: F } } }),entry(S)]), null, 'relationship does not count as F');
  assert.equal(warn([entry(F)], { platform: 'linux' }), null);
  assert.equal(tasks.taskGovernanceLine(on, { environment: {}, registry: { status: 'ok', tasks: [entry(F)] } }), process.platform === 'win32' ? LINE : null, 'native platform default');
  assert.equal(warn([entry(F)], { environment: { TOOLKIT_GOVERNANCE_OFFLINE: '1' } }), null);
  assert.equal(warn([entry(F)], {}, { ...on, notes: ['could-not-check-governance'] }), null);
  assert.equal(warn([entry(F)], {}, { ...on, merged: { status: 'enabled', fresh: true, unavailable: true } }), null);
  for (const rows of [[entry(F, { task_choices: {} })], [entry(F, { task_choices: [{}] })], [entry(F, { replaces: { shard: {} } })], [entry('unknown')]]) assert.equal(warn(rows), null);
  assert.equal(warn([entry(F, { host: 'codex', folder: null })]), null);
  assert.equal(warn([entry(P),entry(S),entry(F, { repository: 'other/widget' })]), null);
});

test('bounded registry only: leftover history cannot warn, and no advisory subprocess or directory scan', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-advisory-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const state = observation('DISABLED', 'disabled');
  const options = { home, platform: 'win32', environment: {} };
  tasks.writeRegistry(home, [entry(P)]);
  tasks.writeLastRun('fixture-programme-sweep', { status: 'failed', summary: ['obsolete reminder'] }, home);
  const cp = require('node:child_process');
  const names = ['spawnSync','execFileSync','spawn','exec','execSync','execFile','fork'];
  const originals = names.map(name => cp[name]);
  const readdir = fs.readdirSync;
  try {
    fs.readdirSync = () => { throw new Error('forbidden advisory scan'); };
    for (const name of names) cp[name] = () => { throw new Error('forbidden advisory subprocess'); };
    assert.equal(tasks.taskGovernanceLine(state, options), LINE);
    tasks.writeRegistry(home, []);
    for (let i = 0; i < 3; i++) assert.equal(tasks.taskGovernanceLine(state, options), null);
    fs.writeFileSync(tasks.registryPath(home), '{malformed');
    assert.equal(tasks.taskGovernanceLine(state, options), null);
    fs.writeFileSync(tasks.registryPath(home), ' '.repeat(512 * 1024 + 1));
    assert.equal(tasks.taskGovernanceLine(state, options), null);
  } finally { fs.readdirSync = readdir; names.forEach((name,index) => { cp[name] = originals[index]; }); }
});
