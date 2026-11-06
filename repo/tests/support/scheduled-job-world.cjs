'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const tasks = require('../../scripts/toolkit-tasks.cjs');
const windows = require('../../scripts/toolkit-windows-tasks.cjs');
const support = require('./windows-task-switch-world.cjs');
const worker = path.join(__dirname, 'scheduled-job-process.cjs');
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

module.exports = { world, events, until, pause };
