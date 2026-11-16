'use strict';

// A real-Git world for the store command tests: a bare "GitHub" store with one commit, a checkout
// of it and a second clone that plays another agent. Only the GitHub read, the binding read, the
// reported remote address and the wait between push attempts are faked; a test can race the store
// before a push, refuse a push, or let a push land and still report it failed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const store = require('../../scripts/toolkit-store.cjs');

const ORIGIN = 'https://github.com/owner/store.git';
// Built at run time so no test file holds a token shape of its own.
const PLANTED = ['gh', 'p_', 'Zq7Rk2Lm9Xw4Tv8Bn3Hs6Jd1Pf5Yc0Ga2Ue7'].join('');

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const commitIn = (dir, file, text, message) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '-A'); git(dir, 'commit', '--quiet', '-m', message);
};

const pushes = calls => calls.filter(args => args[0] === 'push');

function world(t, { branch = 'main' } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-store-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const tmp = path.join(base, 'tmp');
  fs.mkdirSync(home); fs.mkdirSync(tmp);
  const remote = path.join(base, 'remote.git');
  git(base, 'init', '--quiet', '--bare', '-b', branch, remote);
  const clone = name => {
    const dir = path.join(base, name);
    git(base, 'clone', '--quiet', remote, dir);
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    return dir;
  };
  const seed = clone('seed');
  git(seed, 'checkout', '--quiet', '-b', branch);
  fs.mkdirSync(path.join(seed, 'archives', 'old'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'archives', 'old', 'kept.md'), 'kept\n');
  fs.writeFileSync(path.join(seed, 'loose.json'), '{}\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '--quiet', '-m', 'seed'); git(seed, 'push', '--quiet', 'origin', branch);
  const dir = clone('store');
  const other = clone('other');
  const calls = [];
  const reported = { origin: ORIGIN, push: ORIGIN };
  // beforePush: one function run before the next push. racePushes: functions run before each next
  // push in turn. refusePushes: how many next pushes fail without reaching the store. landButFail:
  // how many next pushes reach the store but report failure (a timed-out push that landed).
  // failFetches: how many next fetches of the bound branch fail (a dropped network).
  const hooks = { beforePush: null, racePushes: [], refusePushes: 0, landButFail: 0, failFetches: 0 };
  const waits = [];
  // Real Git, except the reported remote address (a GitHub URL) and the push hooks above.
  const run = (cmd, args, options) => {
    const at = args.indexOf('-C');
    const rest = args.slice(at + 2);
    calls.push(rest);
    if (rest[0] === 'remote' && rest[1] === 'get-url') return { status: 0, stdout: `${rest.includes('--push') ? reported.push : reported.origin}\n`, stderr: '' };
    if (rest[0] === 'fetch' && hooks.failFetches > 0) { hooks.failFetches -= 1; return { status: 128, stdout: '', stderr: 'network down in the test' }; }
    if (rest[0] === 'push' && !rest.includes('--delete')) {
      if (hooks.beforePush) { const once = hooks.beforePush; hooks.beforePush = null; once(); }
      if (hooks.racePushes.length) hooks.racePushes.shift()();
      if (hooks.refusePushes > 0) { hooks.refusePushes -= 1; return { status: 1, stdout: '', stderr: 'refused by the test' }; }
      if (hooks.landButFail > 0) { hooks.landButFail -= 1; spawnSync(cmd, args, options); return { status: 1, stdout: '', stderr: 'timed out in the test' }; }
    }
    calls.env = options && options.env;
    return spawnSync(cmd, args, options);
  };
  const github = { full_name: 'Owner/Store', private: true, permissions: { push: true }, default_branch: branch };
  // GitHub's compare answer, worked out on the bare "GitHub" repository itself, never the checkout.
  const inRemote = (...args) => spawnSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' });
  const compare = (from, to) => {
    const [a, b] = [from, to].map(ref => inRemote('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).stdout.trim());
    if (!a || !b) throw new Error('404');
    if (a === b) return { status: 'identical' };
    if (inRemote('merge-base', '--is-ancestor', b, a).status === 0) return { status: 'behind' };
    if (inRemote('merge-base', '--is-ancestor', a, b).status === 0) return { status: 'ahead' };
    return { status: 'diverged' };
  };
  const deps = {
    run, tmpdir: tmp, cwd: base,
    sleep: ms => { waits.push(ms); },
    environment: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    readBinding: () => ({ ok: true, store: { kind: 'github', repository: 'Owner/Store', branch, path: 'state/owner/repo/' } }),
    readGitHub: apiPath => {
      const compared = /^repos\/Owner\/Store\/compare\/([^.]+)\.\.\.(.+)$/.exec(apiPath);
      return compared ? compare(decodeURIComponent(compared[1]), decodeURIComponent(compared[2])) : github;
    },
  };
  const remoteHas = file => spawnSync('git', ['--git-dir', remote, 'cat-file', '-e', `${branch}:${file}`]).status === 0;
  const remoteFile = file => spawnSync('git', ['--git-dir', remote, 'show', `${branch}:${file}`], { encoding: 'utf8' }).stdout;
  const remoteTip = () => inRemote('rev-parse', branch).stdout.trim();
  const act = (argv, extra = {}) => {
    const out = []; const err = [];
    const code = store.main([...argv, '--store', dir, '--json'], { ...deps, ...extra, stdout: text => out.push(text), stderr: text => err.push(text) });
    return { code, result: out.length ? JSON.parse(out.join('')) : null, err: err.join('') };
  };
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  // Another agent commits a file and pushes it to the store.
  const raceIn = (file, text = `${file}\n`) => () => {
    git(other, 'pull', '--quiet', '--no-rebase', 'origin', branch);
    commitIn(other, file, text, `raced ${file}`);
    git(other, 'push', '--quiet', 'origin', branch);
  };
  return { base, home, tmp, remote, dir, other, calls, reported, hooks, waits, github, deps, remoteHas, remoteFile, remoteTip, act, write, raceIn, branch };
}

module.exports = { ORIGIN, PLANTED, git, commitIn, pushes, world };
