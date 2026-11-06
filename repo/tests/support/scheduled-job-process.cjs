'use strict';

// Real-process qualification of the scheduled runner. Git reads/fetches, locks, cache,
// registry and receipts are real. Only GitHub identity/auth, effects and the native
// scheduler are substituted; the scheduler starts another real runner process.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const job = require('../../scripts/toolkit-scheduled-job.cjs');
const tasks = require('../../scripts/toolkit-tasks.cjs');
const cache = require('../../scripts/toolkit-governance-binding.cjs');
const governance = require('../../scripts/toolkit-governance-state.cjs');
const { GH, ATTENTION } = require('./windows-task-switch-world.cjs');
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// The runner moves Date in child processes, while filesystem mtimes keep the real
// clock. Stamp fixture lock drafts on that same moved clock before atomic linking,
// as the existing live-lock fixtures do, so a newborn lock is not 400 days old.
// Acquisition, stale policy, process ownership and all production waits stay real.
if (process.env.TOOLKIT_TEST_CLOCK_OFFSET_DAYS) {
  const link = fs.linkSync;
  fs.linkSync = (source, target, ...rest) => {
    if (String(source).endsWith('.draft') && String(target).startsWith(tasks.userStateDir(config.home) + path.sep) && String(target).endsWith('.lock')) {
      const at = new Date(); fs.utimesSync(source, at, at);
    }
    return link(source, target, ...rest);
  };
}
const [id, mode = 'normal'] = process.argv.slice(3);
const entries = tasks.readRegistry(config.home).tasks;
const entry = entries.find(row => row.id === id);
const repositoryFor = root => entries.find(row => row.checkout === root).repository;
const identityFor = root => ({ valid: true, root, repository_id: require('../../scripts/toolkit-repository-identity.cjs').repositoryIdForCanonicalRemote(`https://github.com/${repositoryFor(root)}.git`),
  remote: { host: 'github.com', path: `/${repositoryFor(root)}.git`, canonical: `https://github.com/${repositoryFor(root)}.git` } });
const event = (kind, extra = {}) => fs.appendFileSync(config.events, JSON.stringify({ kind, id, at: Date.now(), ...extra }) + '\n');
const runGit = (args, options) => {
  if (args[0] === 'ls-remote' && args[1] === '--get-url') return { status: 0, stdout: Buffer.from(identityFor(options.cwd).remote.canonical), stderr: Buffer.alloc(0) };
  if (args.includes('fetch')) {
    // Both contenders must arrive before either fetches on the unfixed head. On the
    // fixed head the first times out this barrier while owning the refresh lock.
    if (config.race) {
      fs.writeFileSync(path.join(config.base, `fetch-${id}`), 'ready');
      const until = performance.now() + 600;
      while (performance.now() < until && fs.readdirSync(config.base).filter(name => name.startsWith('fetch-')).length < 2) sleep(5);
    }
    event('fetch-enter');
  }
  const result = spawnSync('git', args, { ...options, windowsHide: true });
  if (args.includes('fetch')) event('fetch-exit', { status: result.status });
  return result;
};
const run = (file, args, opts) => {
  if (file === GH) return { status: config.signedOut ? 1 : 0, stdout: '' };
  if (args[0] === '-e') return { status: 0, stdout: '' };
  if (args[0] === job.SCRIPT.governance) {
    const identity = identityFor(opts.cwd);
    event('status-enter');
    // Leave an overlap window before the real git fetch (production defaults stay intact).
    if (config.race) sleep(100);
    let refresh = cache.refreshBindingCache(identity, tasks.userStateDir(config.home), { runGit, environment: {} });
    if (config.refreshFailure) refresh = { refreshed: false, error: config.refreshFailure };
    const merged = governance.judgeMerged(cache.readBindingCache(identity, tasks.userStateDir(config.home)), identity, new Date());
    event('status-exit', { refreshed: refresh.refreshed });
    const state = merged.status === 'enabled' ? 'ENABLED' : merged.status === 'disabled' ? 'DISABLED' : 'UNAVAILABLE';
    return { status: 0, stdout: JSON.stringify({ state, merged, ...(refresh.refreshed === false ? { refresh: { refreshed: false, reason: refresh.error } } : {}) }) };
  }
  if (args[0] === job.SCRIPT.footerSweep) {
    const view = governance.judgeMerged(cache.readBindingCache(identityFor(opts.cwd), tasks.userStateDir(config.home)), identityFor(opts.cwd), new Date());
    const key = view?.fresh && view.binding?.store?.repository || entry.repository;
    const lockFile = new (require('../../scripts/toolkit-programme-lock.cjs').ProgrammeJobLock)({ home: config.home, key }).file;
    event('footer', { repos: args.filter((arg, i) => args[i - 1] === '--repo'), writerLocked: fs.existsSync(lockFile) });
    if (config.holdId === id && mode !== 'retry') {
      const until = performance.now() + 80000;
      while (!fs.existsSync(config.holdRelease) && performance.now() < until) sleep(10);
      if (!fs.existsSync(config.holdRelease)) throw new Error('fixture holder release timed out');
    }
    return { status: 0, stdout: '{"results":[]}' };
  }
  if (args[0] === job.SCRIPT.programme) return args[1] === 'attention' ? ATTENTION
    : { status: config.failProgramme ? 2 : 0, stdout: '{"holds":[]}' };
  if (args[0] === job.SCRIPT.shardTimings) { event('shards'); return { status: 0, stdout: 'measured' }; }
  throw new Error(`unexpected process ${file} ${args[0]}`);
};
const scheduler = {
  list: folder => JSON.parse(fs.readFileSync(config.live, 'utf8'))[folder] || [],
  start(folder, name) {
    event('start', { name });
    if (config.startFails) throw new Error('fixture native start failed');
    const target = entries.find(row => row.folder === folder && row.name === name);
    const result = spawnSync(process.execPath, [__filename, process.argv[2], target.id, 'retry'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  },
};
if (config.startGate && mode !== 'retry') {
  fs.writeFileSync(path.join(config.base, `ready-${id}`), 'ready');
  const until = performance.now() + 10000;
  while (!fs.existsSync(config.startGate) && performance.now() < until) sleep(5);
}
const record = job.runJob({ job: entry.job, taskId: id, repoRoot: entry.checkout }, {
  home: config.home, ghPath: GH, run, scheduler, readIdentity: identityFor,
  readObservation: identity => governance.judgeMerged(cache.readBindingCache(identity, tasks.userStateDir(config.home)), identity, new Date()),
});
event('finished', { status: record.status });
process.stdout.write(JSON.stringify(record));
process.exitCode = record.exit;
