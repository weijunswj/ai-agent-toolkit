'use strict';

// Shared fake scheduler and real status/CLI fixtures for Windows task qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const windowsTasks = require('../../scripts/toolkit-windows-tasks.cjs');
const tasks = require('../../scripts/toolkit-tasks.cjs');
const job = require('../../scripts/toolkit-scheduled-job.cjs');
const shards = require('../../scripts/ci-test-shards.cjs');
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const identityReader = ({ checkout, toolkitRoot }) => ({ checkout, toolkitRoot });
const testRepository = root => { if (!fs.existsSync(path.join(root, '.git'))) throw new Error('registered root is not a repository checkout'); return true; };
const TOOLKIT_ROOT = 'C:\\Toolkit\\ai-agent-toolkit';
const GH = 'C:\\gh\\gh.exe';
const ATTENTION = { status: 0, stdout: JSON.stringify({ line: 'Attention: clear', text: 'Attention: clear (stored on #421, written 3 min ago)' }) };

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-tasks-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// A checkout folder; `shards` adds the Toolkit shard contract, not a local refresher script.
function checkout(t, { shards = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-checkout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  if (shards) {
    addShards(root);
  }
  return root;
}

function addShards(root) {
  fs.mkdirSync(path.join(root, 'repo', 'contracts', 'ci'), { recursive: true });
  fs.mkdirSync(path.join(root, 'repo', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'repo', 'tests', 'example.test.cjs'), '// fixture\n');
  fs.writeFileSync(path.join(root, ...shards.MANIFEST_REL.split('/')), JSON.stringify({
    schema: shards.MANIFEST_SCHEMA,
    systems: Object.fromEntries(shards.SYSTEMS.map(system => [system, { shards: [{ id: `${system}-1`, rest: true }] }])),
  }));
}

function fixtureBinding(repository = 'weijunswj/ai-agent-toolkit', folder = 'TOOLKIT', enabled = true) {
  return { schema: 'toolkit.programme-binding.v2', repository, governance: enabled ? 'enabled' : 'disabled', ...(folder ? { schedule_folder: folder } : {}),
    ...(enabled ? { parents: [{ issue: 1, record_prefix: 'TASK' }], store: { kind: 'github', repository: 'weijunswj/TRANSPORT-ai-agent-toolkit', branch: 'main', path: 'state/' }, required_checks: [] } : {}) };
}

// An in-memory Task Scheduler with the same methods as powerShellScheduler(). register and
// unregister keep the PowerShell side's own marker check.
function fakeScheduler(initial = {}) {
  const folders = new Map(Object.entries(initial).map(([folder, list]) => [folder, list.map(task => ({ ...task }))]));
  const calls = [];
  const key = folder => folder || '';
  const of = folder => folders.get(key(folder)) || [];
  return {
    calls, folders,
    onStart: null,
    list(folder) { calls.push(['list', folder]); return structuredClone(of(folder)); },
    markedFolders() { return [...folders.entries()].filter(([name, list]) => name && list.some(task => String(task.description).includes('[toolkit-task v1 '))).map(([name]) => name); },
    register(d, previous = null) {
      calls.push(['register', d.folder, d.name]);
      const list = folders.get(d.folder) || [];
      const existing = list.find(task => task.name === d.name);
      if (existing && !String(existing.description).includes(`[toolkit-task v1 id=${d.id} `) && !(existing.description === require('../../scripts/toolkit-task-launcher.cjs').DISABLED_DESCRIPTION && previous && assertDefinition(existing, previous))) throw new Error('not Toolkit\'s');
      if (existing && (!previous || !assertDefinition(existing, previous)) || !existing && previous) throw new Error('changed before registration');
      const task = { name: d.name, description: d.description, state: 'Ready', execute: d.execute, arguments: d.arguments, working_directory: d.working_directory,
        actions: [{ execute: d.execute, arguments: d.arguments, working_directory: d.working_directory }],
        triggers: d.schedule.kind === 'hourly' ? [{ kind: 'MSFT_TaskDailyTrigger', start: `2026-10-29T${d.schedule.at}:00+08:00`, interval: 'PT1H', duration: `PT${d.schedule.hours}H` }]
          : d.schedule.kind === 'daily' ? [{ kind: 'MSFT_TaskDailyTrigger', start: `2026-10-29T${d.schedule.at}:00+08:00`, days_interval: 1 }]
          : [{ kind: 'MSFT_TaskWeeklyTrigger', start: `2026-10-26T${d.schedule.at}:00+08:00`, days_of_week: 2 }], last_run: null, last_result: 0x41303 };
      folders.set(d.folder, [...list.filter(item => item.name !== d.name), task]);
    },
    unregister(folder, name, id, previous) {
      calls.push(['unregister', folder, name]);
      const task = of(folder).find(item => item.name === name);
      if (task && !String(task.description).includes(`[toolkit-task v1 id=${id} `)) throw new Error('marker');
      if (task && (!previous || !assertDefinition(task, previous))) throw new Error('changed before removal');
      folders.set(folder, of(folder).filter(item => item.name !== name));
      return { removed: Boolean(task) };
    },
    removeFolderIfEmpty(folder) {
      calls.push(['remove-folder', folder]);
      if (!folders.has(folder)) return { folder: 'absent' };
      if (of(folder).length) return { folder: 'kept' };
      folders.delete(folder);
      return { folder: 'removed' };
    },
    start(folder, name) { calls.push(['start', folder, name]); if (this.onStart) this.onStart(of(folder).find(item => item.name === name)); },
    info(folder, name) { const task = of(folder).find(item => item.name === name); return { state: task.state, last_run: task.last_run, last_result: task.last_result }; },
  };
}

function assertDefinition(a, b) {
  return JSON.stringify(windowsTasks.enrolledDefinition(a)) === JSON.stringify(windowsTasks.enrolledDefinition(b));
}

// A fake process runner: answers by script and records every start.
function fakeRun(answers = {}) {
  const log = [];
  const run = (file, args) => {
    log.push([file, ...args]);
    const name = file === GH ? `gh ${args[0]}` : args[0] === '-e' ? 'reach github' : path.basename(args[0]) === 'programme.cjs' ? `programme ${args[1]}` : path.basename(args[0]);
    const answer = answers[name] || { status: 0, stdout: '' };
    return { stdout: '', stderr: '', ...(typeof answer === 'function' ? answer(args) : answer) };
  };
  return { run, log };
}

function assertLiveRegistry(home, scheduler, registry = tasks) {
  for (const entry of registry.readRegistry(home).tasks) {
    const live = scheduler.list(entry.folder).find(t => t.name === entry.name);
    assert.ok(live, entry.id); assert.notEqual(live.state, 'Disabled');
    assert.deepEqual(windowsTasks.enrolledDefinition(live), entry.enrolled); assert.equal(entry.stopped_by_owner, undefined);
  }
}

// All switch-family sequences share the actual status service, merged observation and CLI.
// Only GitHub processes, native scheduler and the clock are substituted.
function switchWorld(t, { realLocations = false } = {}) {
  const home = tempHome(t), scheduler = fakeScheduler();
  let root = checkout(t), toolkitRoot = TOOLKIT_ROOT;
  const git = (dir, ...args) => require('node:child_process').execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (realLocations) {
    git(root, 'init', '--quiet');
    toolkitRoot = path.join(home, 'managed'); fs.mkdirSync(toolkitRoot);
    git(toolkitRoot, 'init', '--quiet'); git(toolkitRoot, 'remote', 'add', 'origin', 'https://github.com/weijunswj/ai-agent-toolkit.git');
  }
  const saveManaged = () => {
    const file = path.join(home, '.ai-agent-toolkit', 'current', 'state.json');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ repo_path: toolkitRoot }));
  };
  if (realLocations) saveManaged();
  fs.writeFileSync(path.join(root, '.git/config'), '[remote "origin"]\nurl = https://github.com/weijunswj/ai-agent-toolkit.git\n');
  const real = require('../../scripts/toolkit-governance-state.cjs'), cache = require('../../scripts/toolkit-governance-binding.cjs');
  const { ToolkitGovernanceCli } = require('../../scripts/toolkit-governance.cjs');
  const registryPath = path.join(tasks.userStateDir(home), 'repository-governance.v1.json');
  let tick = Date.now(), revision = 0, status;
  t.mock.timers.enable({ apis: ['Date'], now: tick });
  const now = () => { tick += 1000; t.mock.timers.setTime(tick); return new Date(tick); };
  // The physical layout is immutable between explicit fixture moves. Cache only fixed Git
  // reads there, as setup reporting does; governance/status and owner plans stay fresh.
  const primaryCache = new Map(), originCache = new Map();
  const locationReader = request => windowsTasks.readLocations(request, {
    mainCheckout(dir) { if (!primaryCache.has(dir)) primaryCache.set(dir, windowsTasks.mainCheckout(dir)); return primaryCache.get(dir); },
    run(file, args, options) { const key = JSON.stringify([file,args]); if (!originCache.has(key)) originCache.set(key, require('node:child_process').spawnSync(file,args,options)); return originCache.get(key); },
  });
  const deps = { identityReader: realLocations ? locationReader : identityReader, governance: { ...real, governanceState: root => real.governanceState(root, { registryPath, testOnly: true, now: now() }) },
    readObservation: identity => windowsTasks.readTaskObservation(identity, home, now()) };
  scheduler.onStart = live => {
    const mode = live.arguments.includes(' footer-sweep ') ? 'footer-sweep' : 'programme-sweep';
    const fake = fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify(status) }, 'programme attention': ATTENTION });
    const record = job.runJob({ job: mode, repoRoot: root, taskId: /--task-id ([a-z0-9-]+)/.exec(live.arguments)[1] }, { home, now, ghPath: GH, nodePath: NODE,
      readIdentity: real.readIdentity, repositoryReader: testRepository, readObservation: identity => windowsTasks.readTaskObservation(identity, home, now()),
      run: (...args) => { tick += 10000; return fake.run(...args); } });
    Object.assign(live, { last_run: record.started, last_result: 0, state: 'Ready' });
  };
  const fixture = { home, get root() { return root; }, get toolkitRoot() { return toolkitRoot; }, scheduler, now, registry: null,
    verifyLocations() { return locationReader({ checkout: root, toolkitRoot, home }); },
    move(kind) {
      primaryCache.clear(); originCache.clear();
      const old = { root, toolkitRoot };
      if (kind !== 'runner') { const next = root + '-moved'; fs.renameSync(root, next); root = next; t.after(() => fs.rmSync(next, { recursive: true, force: true })); }
      if (kind !== 'checkout') { const next = toolkitRoot + '-moved'; fs.renameSync(toolkitRoot, next); toolkitRoot = next; saveManaged(); }
      return old;
    },
    advance(days) { tick += days * 86400000; t.mock.timers.setTime(tick); },
    offer() { return windowsTasks.desiredTasks({ checkout: root, home, toolkitRoot, nodePath: NODE, deps }); },
    async gov(state, { folder = 'AI-AGENT-TOOLKIT' } = {}) {
      const identity = real.readIdentity(root), text = ['absent','uncertain'].includes(state) ? null : JSON.stringify(fixtureBinding(undefined, folder, state === 'on'));
      const fetched = now(); if (state === 'uncertain') fetched.setHours(fetched.getHours() - 30);
      cache.writeCache(tasks.userStateDir(home), { schema: cache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical,
        default_branch: 'main', commit: (++revision).toString(16).padStart(40, '0'), fetched_at: fetched.toISOString(), status: text ? 'present' : 'absent', text,
        bytes_sha256: text ? require('node:crypto').createHash('sha256').update(text).digest('hex') : null, problem: null });
      let stdout = '';
      const cli = new ToolkitGovernanceCli({ cwd: root, registryOptions: { registryPath, testOnly: true, home, now: now() }, refresh: () => ({ refreshed: true }),
        discoveryGh: () => ({ ok: false, reason: 'fixture offline' }), hookReader: () => null, queueReader: () => null,
        stdout: { write: value => { stdout += value; } }, stderr: { write() {} } });
      await cli.main(['status','--json']); status = JSON.parse(stdout);
      assert.equal(status.state, state === 'on' ? 'ENABLED' : state === 'off' ? 'DISABLED' : state === 'absent' ? 'UNDECIDED' : 'UNAVAILABLE');
    },
    cli(verb, ...args) {
      let text = '', err = '';
      const code = windowsTasks.main([verb,'--repo-root',root,'--json',...args], { platform: 'win32', scheduler, home, now, registry: fixture.registry || undefined, toolkitRoot, nodePath: NODE,
        checkoutDeps: deps, stdout: value => { text += value; }, stderr: value => { err += value; }, firstRunOptions: { wait() {}, pollMs: 1, waitMs: 2 } });
      return { code, json: text ? JSON.parse(text) : null, err };
    },
  };
  return fixture;
}

function assertShape(w, state) {
  const expected = state === 'on' ? ['programme-sweep','shard-timings'] : ['footer-sweep'];
  assert.deepEqual((w.registry || tasks).readRegistry(w.home).tasks.map(e => e.job).sort(), expected);
  assert.deepEqual(w.scheduler.list('AI-AGENT-TOOLKIT').map(l => l.name).sort(), expected.map(j => windowsTasks.taskName('AI-AGENT-TOOLKIT', j)).sort());
  assertLiveRegistry(w.home, w.scheduler, w.registry || tasks);
  assert.ok((w.registry || tasks).readRegistry(w.home).tasks.every(e => !e.replaces), 'completed switches retain no relationship');
}

// Execute the commands that the held plan actually prints, through the real CLI. Native
// cleanup is interpreted only by the fake scheduler, after its exact inspection command.
function printedRecovery(w, reset = false) {
  let plan = w.cli('plan').json;
  assert.ok(plan);
  const text = plan.next_step;
  if (/Unregister-ScheduledTask/.test(text)) {
    assert.equal(w.cli('apply', '--repair-owned').code, 1, 'repair never adopts an unrecorded native write');
    const cleanup = [...text.matchAll(/Unregister-ScheduledTask -TaskPath '(.*?)' -TaskName '([^']*)' -Confirm:\$false/g)];
    assert.ok(cleanup.length, text);
    for (const [, nativePath, name] of cleanup) {
      const folder = nativePath.slice(1, -1), live = w.scheduler.list(folder).find(l => l.name === name);
      assert.ok(text.includes(`Get-ScheduledTask -TaskPath '${nativePath}' -TaskName '${name}'`));
      assert.ok(live); const marker = windowsTasks.parseMarker(live.description); assert.ok(marker);
      assert.equal(w.scheduler.unregister(folder, name, marker.id, live).removed, true);
    }
    const retried = w.cli('apply');
    if (retried.code === 0) return retried;
    plan = w.cli('plan').json;
  }
  const commands = [...plan.next_step.matchAll(/node "([^"\n]+)" (apply|remove) --repo-root "([^"\n]+)"(?: --folder ([A-Z0-9-]+))?( --repair-owned)?/g)];
  assert.ok(commands.length, plan.next_step);
  const run = match => {
    assert.equal(match[1], (path.isAbsolute(w.toolkitRoot) ? path : path.win32).join(w.toolkitRoot, 'repo', 'scripts', 'toolkit-windows-tasks.cjs')); assert.equal(match[3], w.root);
    return w.cli(match[2], ...(match[4] ? ['--folder', match[4]] : []), ...(match[5] ? ['--repair-owned'] : []));
  };
  if (reset) {
    const remove = commands.find(m => m[2] === 'remove'); assert.ok(remove, plan.next_step);
    assert.equal(run(remove).code, 0);
    const stopped = (w.registry || tasks).readRegistry(w.home).tasks; assert.ok(stopped.every(e => e.stopped_by_owner));
  }
  const repair = commands.find(m => m[2] === 'apply' && m[5]); assert.ok(repair, plan.next_step);
  const result = run(repair); assert.equal(result.code, 0, result.err + JSON.stringify(result.json)); return result;
}

function memoryRegistry(initial = []) {
  let entries = structuredClone(initial);
  const calls = [];
  return {
    calls, corrupt: false,
    readRegistry() { return this.corrupt ? { status: 'unreadable', reason: 'bad fixture' } : { status: 'ok', tasks: structuredClone(entries) }; },
    updateRegistry(home, change) {
      const next = change(structuredClone(entries));
      for (const entry of next) assert.equal(tasks.entryProblem(entry), null);
      calls.push('write'); entries = structuredClone(next); return next;
    },
    writeTaskBackup() { calls.push('backup'); return 'fixture-backup'; },
  };
}

function fixtureGovernance({ state = 'ENABLED', folder = 'TOOLKIT', repository = 'weijunswj/ai-agent-toolkit', binding = true } = {}) {
  const status = state === 'ENABLED' ? binding ? 'enabled' : 'unknown' : state === 'DISABLED' ? binding ? 'disabled' : 'none' : state === 'UNDECIDED' ? 'none' : 'unknown';
  const source = binding && ['enabled', 'disabled'].includes(status) ? fixtureBinding(repository, folder, status === 'enabled') : null;
  return {
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/${repository}.git` } }),
    governanceState: () => ({ state, merged: { status, fresh: status !== 'unknown' } }),
    mergedBinding: () => source,
    readObservation: () => ({ status, fresh: status !== 'unknown', binding: source }),
  };
}

module.exports = { memoryRegistry, fixtureGovernance, tempHome, checkout, addShards, fixtureBinding, fakeScheduler, assertDefinition, fakeRun, assertLiveRegistry, switchWorld, assertShape, printedRecovery, NODE, identityReader, testRepository, TOOLKIT_ROOT, GH, ATTENTION };
