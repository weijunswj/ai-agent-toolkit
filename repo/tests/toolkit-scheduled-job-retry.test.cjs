'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const support = require('./support/windows-task-switch-world.cjs');
const worker = path.join(__dirname, 'support/scheduled-job-process.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = world => fs.existsSync(world.events) ? fs.readFileSync(world.events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
async function until(predicate, ms = 10000) {
  const end = performance.now() + ms;
  while (!predicate() && performance.now() < end) await pause(10);
  assert.ok(predicate(), 'bounded process rendezvous');
}
function world(t, repositories = ['example/widget']) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-retry-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const origin = path.join(base, 'origin.git'), writer = path.join(base, 'writer'), home = path.join(base, 'home');
  fs.mkdirSync(home);
  git(base, 'init', '--bare', '-b', 'main', origin); git(base, 'init', '-b', 'main', writer);
  git(writer, 'config', 'user.email', 'fixture@example.test'); git(writer, 'config', 'user.name', 'Fixture');
  git(writer, 'remote', 'add', 'origin', origin);
  const bindingFile = path.join(writer, '.github/toolkit-programme.json'); fs.mkdirSync(path.dirname(bindingFile));
  const scheduler = support.fakeScheduler(), identities = new Map();
  for (const [i, repository] of repositories.entries()) {
    const folder = `REPO${i}`, binding = support.fixtureBinding(repository, folder);
    fs.writeFileSync(bindingFile, JSON.stringify(binding)); git(writer, 'add', '.'); git(writer, 'commit', '-m', 'binding'); git(writer, 'push', 'origin', 'main');
    const localOrigin = repositories.length === 1 ? origin : path.join(base, `origin${i}.git`);
    if (localOrigin !== origin) git(base, 'clone', '--bare', origin, localOrigin);
    const root = path.join(base, `checkout${i}`); git(base, 'clone', localOrigin, root); support.addShards(root);
    identities.set(root, repository);
    const identity = root => ({ valid: true, root, remote: { host: 'github.com', path: `/${identities.get(root)}.git` } });
    const desired = windows.desiredTasks({ checkout: root, toolkitRoot: support.TOOLKIT_ROOT, nodePath: support.NODE, systemRoot: 'C:\\Windows',
      deps: { identityReader: support.identityReader, governance: { readIdentity: identity, governanceState: () => ({ state: 'ENABLED', merged: { status: 'enabled', fresh: true } }), readObservation: () => ({ status: 'enabled', fresh: true, binding }) } } });
    const applied = windows.applyTasks(desired, { home, scheduler });
    assert.ok(!applied.refused && applied.items.every(item => item.action === 'create'), JSON.stringify(applied));
  }
  const rows = tasks.readRegistry(home).tasks;
  const live = path.join(base, 'live.json'), configFile = path.join(base, 'config.json');
  fs.writeFileSync(live, JSON.stringify(Object.fromEntries(scheduler.folders)));
  const config = { base, home, live, events: path.join(base, 'events.jsonl') };
  const save = extra => { Object.assign(config, extra); fs.writeFileSync(configFile, JSON.stringify(config)); };
  save({});
  const start = (entry, mode = 'normal') => {
    const child = spawn(process.execPath, [worker, configFile, entry.id, mode], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`worker timed out: ${stderr}`)); }, 95000);
      child.on('error', reject);
      child.on('close', () => { clearTimeout(timeout); try { resolve(JSON.parse(stdout)); } catch { reject(new Error(stderr || stdout)); } });
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    return { child, done };
  };
  return { ...config, config, rows, scheduler, save, start, git, writer, origin, bindingFile };
}

test('fix3 A: production planner uses native POSIX joining in a real Node process', () => {
  const script = path.resolve(__dirname, '../scripts/toolkit-windows-tasks.cjs');
  const code = `const fs=require('node:fs'),Module=require('node:module'),p=require('node:path');
    const m=new Module(${JSON.stringify(script)});m.filename=${JSON.stringify(script)};m.paths=Module._nodeModulePaths(p.dirname(m.filename));
    const normal=m.require.bind(m);m.require=id=>id==='node:path'?{...p.posix,win32:p.win32,posix:p.posix}:normal(id);
    m._compile(fs.readFileSync(m.filename,'utf8'),m.filename);
    process.stdout.write(m.exports.applyCommand({root:'/home/fixture/project'},{toolkitRoot:'/home/fixture/toolkit'}));`;
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'node "/home/fixture/toolkit/repo/scripts/toolkit-windows-tasks.cjs" apply --repo-root "/home/fixture/project"');
});

test('fix3 B: simultaneous real moved-origin refreshes serialize and retain the weekly run', async t => {
  const w = world(t), sweep = w.rows.find(row => row.job === 'programme-sweep'), shard = w.rows.find(row => row.job === 'shard-timings');
  fs.appendFileSync(w.bindingFile, '\n'); w.git(w.writer, 'commit', '-am', 'move origin'); w.git(w.writer, 'push', 'origin', 'main');
  w.save({ race: true, startGate: path.join(w.base, 'go') });
  const a = w.start(sweep), b = w.start(shard);
  await until(() => fs.existsSync(path.join(w.base, `ready-${sweep.id}`)) && fs.existsSync(path.join(w.base, `ready-${shard.id}`)));
  fs.writeFileSync(w.config.startGate, 'go');
  const results = await Promise.all([a.done, b.done]);
  const refresh = events(w).filter(event => event.kind.startsWith('status-'));
  let active = 0;
  for (const event of refresh) { active += event.kind === 'status-enter' ? 1 : -1; assert.ok(active <= 1, 'refreshes must not overlap'); }
  assert.ok(results.every(record => ['ok', 'deferred'].includes(record.status)), JSON.stringify(results));
  await w.start(sweep, 'retry').done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok', 'weekly job completed, including native catch-up');
  assert.ok(events(w).some(event => event.kind === 'footer' && event.repos.includes(support.fixtureBinding().store.repository)));
  assert.ok(events(w).filter(event => event.kind === 'footer').every(event => event.writerLocked));
});

test('fix3 B: refresh failures defer the shard and a later sweep starts it', async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  w.save({ refreshFailure: 'fetch-failed' });
  assert.equal((await w.start(shard).done).status, 'deferred');
  w.save({ refreshFailure: null }); await w.start(sweep).done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
  // No usable cached store: a real failed Git read must still keep a retry, whose
  // later refreshed store can differ from the repository fallback lock key.
  w.git(shard.checkout, 'remote', 'set-url', 'origin', path.join(w.base, 'missing-origin.git'));
  const unavailable = await w.start(shard).done;
  assert.equal(unavailable.status, 'deferred');
  w.git(shard.checkout, 'remote', 'set-url', 'origin', w.origin);
  await w.start(sweep).done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
});

test('fix3 C: store release restarts the next-minute repository within a bounded time', { timeout: 95000 }, async t => {
  const w = world(t, ['example/repo-a', 'example/repo-b']);
  const [a, b] = ['example/repo-a', 'example/repo-b'].map(repository => w.rows.find(row => row.repository === repository && row.job === 'programme-sweep'));
  assert.equal(b.repo_minute - a.repo_minute, 1);
  w.save({ holdId: a.id, holdRelease: path.join(w.base, 'release-holder') });
  const first = w.start(a);
  await until(() => events(w).some(event => event.id === a.id && event.kind === 'footer'));
  await pause(60000);
  let deferred, deferredLine;
  try {
    deferred = await w.start(b).done;
    deferredLine = tasks.sweepLine(b.repository, { home: w.home });
  } finally {
    fs.writeFileSync(w.config.holdRelease, 'release');
    await first.done;
  }
  assert.equal(deferred.status, 'deferred');
  assert.deepEqual({ count: deferred.deferred_count, ageSaved: typeof deferred.deferred_since === 'string',
    finalStatus: tasks.readLastRun(b.id, w.home).status,
    starts: events(w).filter(event => event.kind === 'start' && event.name === b.name).length },
  { count: 1, ageSaved: true, finalStatus: 'ok', starts: 1 });
  assert.match(deferredLine, /deferred.*\d+.*(?:min|minute|second)/);
  const times = events(w); assert.ok(times.find(event => event.kind === 'footer' && event.id === b.id).at - times.find(event => event.kind === 'footer' && event.id === a.id).at < 80000);
  assert.ok(times.find(event => event.kind === 'finished' && event.id === b.id && event.status === 'deferred').at - times.find(event => event.kind === 'footer' && event.id === a.id).at >= 60000);
});

for (const status of ['failed', 'signed out', 'deferred']) test(`fix3 D: shard deferral preserves sweep ${status} and does not promise disabled retries`, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  const old = new Date(Date.now() - 3 * 3600000).toISOString();
  const live = JSON.parse(fs.readFileSync(w.live, 'utf8'));
  live[shard.folder].find(row => row.name === shard.name).state = 'Disabled';
  fs.writeFileSync(w.live, JSON.stringify(live));
  tasks.writeLastRun(shard.id, { status: 'deferred', started: old, finished: old, deferred_since: old, deferred_count: 4 }, w.home);
  w.save({ signedOut: status === 'signed out', failProgramme: status === 'failed' });
  await w.start(sweep).done;
  if (status === 'deferred') tasks.writeLastRun(sweep.id, { status: 'deferred', started: new Date().toISOString(), finished: new Date().toISOString(), deferred_since: old, deferred_count: 4 }, w.home);
  const line = tasks.sweepLine(sweep.repository, { home: w.home });
  assert.match(line, status === 'failed' ? /last run failed/ : status === 'signed out' ? /gh not signed in/ : /over 2 hours/);
  assert.doesNotMatch(line, /retries at the next hourly programme sweep/);
});

for (const recased of [true, false]) test(`fix3 D: ${recased ? 're-cased repository catches up' : 'native-start failure note is saved'}`, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  tasks.writeLastRun(shard.id, { status: 'deferred', started: new Date().toISOString() }, w.home);
  if (recased) tasks.updateRegistry(w.home, rows => rows.map(row => row.id === shard.id ? { ...row, repository: row.repository.toUpperCase() } : row));
  w.save({ startFails: true }); const record = await w.start(sweep).done;
  assert.equal(record.status, 'ok', JSON.stringify(record));
  assert.equal(events(w).filter(event => event.kind === 'start').length, 1);
  assert.match(tasks.readLastRun(sweep.id, w.home).summary.join(' '), /retry could not start/);
  assert.deepEqual(tasks.readLastRun(sweep.id, w.home), record);
});
