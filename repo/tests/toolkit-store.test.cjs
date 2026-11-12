'use strict';

// toolkit store: every store step checks the store itself, scans exactly what it commits, pushes
// only the bound branch with no rewrite and never loses a file. Real Git against a local bare
// repository; only the GitHub read, the binding read and the reported remote address are faked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const store = require('../scripts/toolkit-store.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const ORIGIN = 'https://github.com/owner/store.git';
// Built at run time so this file holds no token shape of its own.
const PLANTED = ['gh', 'p_', 'Zq7Rk2Lm9Xw4Tv8Bn3Hs6Jd1Pf5Yc0Ga2Ue7'].join('');

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

// A bare "GitHub" store with one commit, a checkout of it and a second clone that plays another agent.
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
  const hooks = { beforePush: null };
  // Real Git, except the reported remote address (a GitHub URL) and an optional race before a push.
  const run = (cmd, args, options) => {
    const at = args.indexOf('-C');
    const rest = args.slice(at + 2);
    calls.push(rest);
    if (rest[0] === 'remote' && rest[1] === 'get-url') return { status: 0, stdout: `${rest.includes('--push') ? reported.push : reported.origin}\n`, stderr: '' };
    if (rest[0] === 'push' && hooks.beforePush) { const once = hooks.beforePush; hooks.beforePush = null; once(); }
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
    environment: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    readBinding: () => ({ ok: true, store: { kind: 'github', repository: 'Owner/Store', branch, path: 'state/owner/repo/' } }),
    readGitHub: apiPath => {
      const compared = /^repos\/Owner\/Store\/compare\/([^.]+)\.\.\.(.+)$/.exec(apiPath);
      return compared ? compare(decodeURIComponent(compared[1]), decodeURIComponent(compared[2])) : github;
    },
  };
  const remoteHas = file => spawnSync('git', ['--git-dir', remote, 'cat-file', '-e', `${branch}:${file}`]).status === 0;
  const act = (argv, extra = {}) => {
    const out = []; const err = [];
    const code = store.main([...argv, '--store', dir, '--json'], { ...deps, ...extra, stdout: text => out.push(text), stderr: text => err.push(text) });
    return { code, result: out.length ? JSON.parse(out.join('')) : null, err: err.join('') };
  };
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  return { base, home, tmp, remote, dir, other, calls, reported, hooks, github, deps, remoteHas, act, write, branch };
}

const pushes = calls => calls.filter(args => args[0] === 'push');

test('save commits only the named new files, scans them, pushes the bound branch and reads it back', t => {
  const w = world(t);
  w.write('archives/868/report.md', 'G0 report\n');
  w.write('archives/868/other.md', 'not named\n');
  const { code, result } = w.act(['save', '--path', 'archives/868/report.md', '--message', 'archive 868 report']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.read_back, true);
  assert.equal(result.files, 1);
  assert.ok(w.remoteHas('archives/868/report.md'));
  assert.ok(!w.remoteHas('archives/868/other.md'), 'an unnamed file is never committed');
  assert.equal(git(w.dir, 'log', '-1', '--format=%s'), 'archive 868 report');
  assert.deepEqual(pushes(w.calls), [['push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main']]);
  assert.deepEqual(fs.readdirSync(w.tmp), [], 'the empty hooks folder is removed');
});

test('a planted secret, an unreadable large file or a path outside the store folders commits nothing', t => {
  const w = world(t);
  const head = git(w.dir, 'rev-parse', 'HEAD');
  w.write('archives/x/leak.md', `token = ${PLANTED}\n`);
  let run = w.act(['save', '--path', 'archives/x', '--message', 'leak']);
  assert.equal(run.code, 1);
  assert.match(run.result.stopped, /secret scan found 1 match\(es\): archives\/x\/leak\.md:1 \(github-token\)/);
  assert.ok(!run.result.stopped.includes(PLANTED), 'the finding never prints the secret');
  fs.rmSync(path.join(w.dir, 'archives', 'x'), { recursive: true });

  w.write('evidence/big.log', 'a'.repeat(5 * 1024 * 1024 + 1));
  run = w.act(['save', '--path', 'evidence/big.log', '--message', 'big']);
  assert.match(run.result.stopped, /could not be scanned \(over 5 MB, binary or not UTF-8\): evidence\/big\.log/);
  fs.rmSync(path.join(w.dir, 'evidence'), { recursive: true });

  w.write('elsewhere/x.md', 'x\n');
  assert.match(w.act(['save', '--path', 'elsewhere/x.md', '--message', 'x']).result.stopped, /outside the store folders this command writes \(state\/owner\/repo\/, archives\/, evidence\/\)/);
  w.write('state/owner/repo/doc.md', 'doc\n');
  for (const bad of ['../x', 'archives/../x', '.git/config', 'archives/.GIT/x', '/abs', '-x', 'archives/*', 'archives/x?']) {
    assert.equal(store.storePath(bad), null, bad);
  }
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(w.dir, 'diff', '--cached', '--name-only'), '', 'nothing is left staged after a refusal');
  assert.deepEqual(pushes(w.calls), []);
  assert.equal(w.act(['save', '--path', 'state/owner/repo/doc.md', '--message', 'doc']).code, 0, 'the binding store path is writable');
});

test('save never stages a deletion and never pushes unscanned local commits', t => {
  const w = world(t);
  fs.rmSync(path.join(w.dir, 'archives', 'old', 'kept.md'));
  w.write('archives/old/new.md', 'new\n');
  assert.equal(w.act(['save', '--path', 'archives/old', '--message', 'folder']).code, 0);
  assert.ok(w.remoteHas('archives/old/kept.md'), 'the deleted file stays in the store');
  assert.ok(w.remoteHas('archives/old/new.md'));

  git(w.dir, 'checkout', '--quiet', '--', 'archives/old/kept.md');
  w.write('loose.json', '{"raw":true}\n');
  git(w.dir, 'commit', '--quiet', '-am', 'raw commit');
  w.write('archives/after.md', 'after\n');
  const run = w.act(['save', '--path', 'archives/after.md', '--message', 'after']);
  assert.match(run.result.stopped, /has 1 commit\(s\) the remote lacks, and they were never scanned here/);
});

test('a store that moved during the push is merged in once with a merge commit, then pushed', t => {
  const w = world(t);
  w.hooks.beforePush = () => {
    fs.writeFileSync(path.join(w.other, 'loose-2.json'), '{}\n');
    git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'raced'); git(w.other, 'push', '--quiet', 'origin', 'main');
  };
  w.write('archives/race.md', 'race\n');
  const { code, result } = w.act(['save', '--path', 'archives/race.md', '--message', 'race']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.merged_remote, true);
  assert.ok(w.remoteHas('archives/race.md') && w.remoteHas('loose-2.json'));
  assert.equal(git(w.dir, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'a merge commit, never a rebase');
});

test('the pre-flight refuses anything that is not the private, writable bound store on its branch', t => {
  const w = world(t);
  w.write('archives/a.md', 'a\n');
  const save = extra => w.act(['save', '--path', 'archives/a.md', '--message', 'a'], extra);
  const cases = [
    ['another origin', () => { w.reported.origin = 'https://github.com/someone/else.git'; }, () => { w.reported.origin = ORIGIN; }, /not a checkout of the bound evidence store/],
    ['a second push address', () => { w.reported.push = `${ORIGIN}\nhttps://github.com/someone/else.git`; }, () => { w.reported.push = ORIGIN; }, /pushes somewhere other than the evidence store/],
    ['a push rule', () => git(w.dir, 'config', 'remote.origin.push', '+refs/heads/main:refs/heads/main'), () => git(w.dir, 'config', '--unset', 'remote.origin.push'), /own config that could change a step \(remote\.origin\.push\)/],
    ['a mirror', () => git(w.dir, 'config', 'remote.origin.mirror', 'true'), () => git(w.dir, 'config', '--unset', 'remote.origin.mirror'), /remote\.origin\.mirror/],
    ['a URL rewrite', () => git(w.dir, 'config', 'url.https://evil.example/.insteadOf', 'https://github.com/'), () => git(w.dir, 'config', '--remove-section', 'url.https://evil.example/'), /url\.https:\/\/evil\.example\/\.insteadof/],
    ['a credential helper', () => git(w.dir, 'config', 'credential.helper', '!evil'), () => git(w.dir, 'config', '--unset', 'credential.helper'), /credential\.helper/],
    ['a clean filter', () => git(w.dir, 'config', 'filter.x.clean', 'evil'), () => git(w.dir, 'config', '--remove-section', 'filter.x'), /filter\.x\.clean/],
    ['its own hooks path', () => git(w.dir, 'config', 'core.hooksPath', '.githooks'), () => git(w.dir, 'config', '--unset', 'core.hooksPath'), /core\.hookspath/],
    ['another branch', () => git(w.dir, 'checkout', '--quiet', '-b', 'side'), () => git(w.dir, 'checkout', '--quiet', 'main'), /not on the bound branch main/],
    ['a public store', () => { w.github.private = false; }, () => { w.github.private = true; }, /is not private/],
    ['no write access', () => { w.github.permissions.push = false; }, () => { w.github.permissions.push = true; }, /cannot write to the evidence store/],
    ['a bound branch that is not the default', () => { w.github.default_branch = 'trunk'; }, () => { w.github.default_branch = 'main'; }, /not the store's default branch/],
    ['another repository on GitHub', () => { w.github.full_name = 'Owner/Other'; }, () => { w.github.full_name = 'Owner/Store'; }, /names a different repository/],
  ];
  for (const [label, set, unset, said] of cases) {
    set();
    const run = save();
    unset();
    assert.equal(run.code, 1, label);
    assert.match(run.result.stopped, said, label);
  }
  assert.match(save({ readGitHub: () => { throw new Error('offline'); } }).result.stopped, /GitHub could not be read/);
  assert.match(save({ readBinding: () => ({ ok: false, reason: 'the merged binding was not read in the last day' }) }).result.stopped, /no bound evidence store: the merged binding was not read in the last day/);
  assert.match(save({ readBinding: () => ({ ok: true, store: { kind: 'github', repository: 'Owner/Store', branch: '--mirror', path: 'x/' } }) }).result.stopped, /not a plain branch name/);
  const sub = store.main(['status', '--store', path.join(w.dir, 'archives'), '--json'], { ...w.deps, stdout: () => {} });
  assert.equal(sub, 1, 'a folder inside the checkout is not the store top');
  assert.deepEqual(pushes(w.calls), [], 'no refused run pushes');
  assert.deepEqual(fs.readdirSync(w.tmp), [], 'every refused run removes its hooks folder');

  // The caller's GIT_* environment never reaches Git: a GIT_DIR naming another repository is dropped.
  const run = save({ environment: { ...w.deps.environment, GIT_DIR: path.join(w.other, '.git'), GIT_WORK_TREE: w.other } });
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.ok(w.remoteHas('archives/a.md'));
});

test('a repository hook in the store checkout never runs', t => {
  const w = world(t);
  const marker = path.join(w.base, 'HOOK-RAN');
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'pre-push']) {
    fs.writeFileSync(path.join(w.dir, '.git', 'hooks', name), `#!/bin/sh\necho ran > "${marker.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
  }
  w.write('archives/h.md', 'h\n');
  assert.equal(w.act(['save', '--path', 'archives/h.md', '--message', 'h']).code, 0);
  assert.ok(!fs.existsSync(marker));
});

test('status and sync read and fast-forward only', t => {
  const w = world(t);
  fs.writeFileSync(path.join(w.other, 'archives', 'old', 'b.md'), 'b\n');
  git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'b'); git(w.other, 'push', '--quiet', 'origin', 'main');
  const status = w.act(['status']);
  assert.equal(status.code, 0);
  assert.equal(status.result.checked, true);
  assert.equal(status.result.ahead, 0);
  const synced = w.act(['sync']);
  assert.equal(synced.code, 0);
  assert.equal(synced.result.commit, git(w.other, 'rev-parse', 'HEAD'));
  assert.ok(w.calls.filter(args => args[0] === 'merge').every(args => args.includes('--ff-only')));
});

test('move renames with git mv only, inside the store folders', t => {
  const w = world(t);
  assert.match(w.act(['move', '--from', 'loose.json', '--to', 'elsewhere/loose.json', '--message', 'm']).result.stopped, /outside the store folders/);
  assert.match(w.act(['move', '--from', 'loose.json', '--to', 'archives/old/kept.md', '--message', 'm']).result.stopped, /already exists/);
  const outside = path.join(w.base, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.dir, 'archives', 'link'), 'junction');
  assert.match(w.act(['move', '--from', 'loose.json', '--to', 'archives/link/deep/loose.json', '--message', 'm']).result.stopped, /archives\/link leads out of the store checkout through a link/);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing is created through the link');
  w.write('archives/real.md', 'real\n');
  fs.symlinkSync(path.join(outside), path.join(w.dir, 'evidence-link'), 'junction');
  assert.match(w.act(['save', '--path', 'archives/link', '--message', 'm']).result.stopped, /leads out of it through a link/);
  fs.rmSync(path.join(w.dir, 'archives', 'link')); fs.rmSync(path.join(w.dir, 'evidence-link')); fs.rmSync(path.join(w.dir, 'archives', 'real.md'));
  const { code, result } = w.act(['move', '--from', 'loose.json', '--to', 'archives/loose/loose.json', '--message', 'tidy loose file']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.ok(w.remoteHas('archives/loose/loose.json') && !w.remoteHas('loose.json'));
  assert.match(git(w.dir, 'show', '--name-status', '-M100%', '--format=', 'HEAD'), /^R100\tloose\.json\tarchives\/loose\/loose\.json$/);
});

test('merge-branch merges with a merge commit, refuses deletions and secrets, and aborts cleanly', t => {
  const w = world(t);
  const branchWith = (name, change) => {
    git(w.other, 'checkout', '--quiet', '-B', name, 'origin/main');
    change();
    git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', name); git(w.other, 'push', '--quiet', '--force', 'origin', name);
  };
  branchWith('cloud-add', () => fs.writeFileSync(path.join(w.other, 'archives', 'old', 'cloud.md'), 'cloud\n'));
  branchWith('cloud-delete', () => fs.rmSync(path.join(w.other, 'archives', 'old', 'kept.md')));
  branchWith('cloud-leak', () => fs.writeFileSync(path.join(w.other, 'handoff.md'), `key ${PLANTED}\n`));

  assert.match(w.act(['merge-branch', '--branch', 'cloud-delete', '--message', 'm']).result.stopped, /archives\/old\/kept\.md would be deleted or changed away/);
  assert.ok(!fs.existsSync(path.join(w.dir, '.git', 'MERGE_HEAD')), 'the refused merge is aborted');
  assert.match(w.act(['merge-branch', '--branch', 'cloud-leak', '--message', 'm']).result.stopped, /handoff\.md:1 \(github-token\)/);
  assert.ok(!fs.existsSync(path.join(w.dir, '.git', 'MERGE_HEAD')));
  assert.match(w.act(['merge-branch', '--branch', 'main', '--message', 'm']).result.stopped, /is the bound store branch itself/);

  const { code, result } = w.act(['merge-branch', '--branch', 'cloud-add', '--message', 'merge cloud-add']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.ok(w.remoteHas('archives/old/cloud.md'));
  assert.equal(git(w.dir, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3);
  assert.equal(w.act(['merge-branch', '--branch', 'cloud-add', '--message', 'again']).result.nothing_to_merge, true);
});

test('delete-merged-branch deletes only a branch already in the bound branch', t => {
  const w = world(t);
  git(w.other, 'checkout', '--quiet', '-B', 'merged-one', 'origin/main');
  git(w.other, 'push', '--quiet', 'origin', 'merged-one');
  git(w.other, 'checkout', '--quiet', '-B', 'open-one', 'origin/main');
  fs.writeFileSync(path.join(w.other, 'open.md'), 'open\n');
  git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'open'); git(w.other, 'push', '--quiet', 'origin', 'open-one');

  assert.match(w.act(['delete-merged-branch', '--branch', 'open-one']).result.stopped, /has commits that are not in main, so deleting it could lose the only copy/);
  assert.match(w.act(['delete-merged-branch', '--branch', 'main']).result.stopped, /is the bound store branch itself/);
  assert.match(w.act(['delete-merged-branch', '--branch', 'missing']).result.stopped, /has no branch missing/);
  assert.equal(w.act(['delete-merged-branch', '--branch', '--mirror']).code, 2);
  assert.equal(w.act(['delete-merged-branch', '--branch', '-x']).code, 2);
  const { code, result } = w.act(['delete-merged-branch', '--branch', 'merged-one']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(git(w.remote, 'branch', '--list', 'merged-one'), '');
  assert.notEqual(git(w.remote, 'branch', '--list', 'open-one'), '');
});

test('no step ever force-pushes, mirrors, rewrites or pushes a branch but the bound one', t => {
  const w = world(t);
  git(w.other, 'checkout', '--quiet', '-B', 'done', 'origin/main'); git(w.other, 'push', '--quiet', 'origin', 'done');
  w.write('archives/s.md', 's\n');
  w.act(['save', '--path', 'archives/s.md', '--message', 's']);
  w.act(['move', '--from', 'archives/s.md', '--to', 'archives/t.md', '--message', 't']);
  w.act(['delete-merged-branch', '--branch', 'done']);
  const all = pushes(w.calls);
  assert.ok(all.length >= 3);
  for (const args of all) {
    const deleting = args.includes('--delete');
    assert.ok(!args.some(word => /^(?:--force|-f|--mirror|--all|--prune|--tags)$/.test(word) || /^\+/.test(word) || /^:/.test(word)), args.join(' '));
    if (deleting) assert.deepEqual(args, ['push', '--quiet', `--force-with-lease=refs/heads/done:${git(w.other, 'rev-parse', 'done')}`, 'origin', '--delete', 'refs/heads/done']);
    else assert.deepEqual(args, ['push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main']);
  }
  assert.ok(!w.calls.some(args => /^(?:rebase|filter-branch|update-ref)$/.test(args[0]) || (args[0] === 'reset' && args.includes('--hard')) || (args[0] === 'commit' && args.includes('--amend'))));
});

test('the command line refuses unknown commands, flags and messages, and the flag table is pinned', () => {
  for (const argv of [[], ['upload'], ['save', '--store', 'x', '--path', 'a'], ['save', '--store', 'x', '--message', 'm'], ['save', '--store', 'x', '--path', 'a', '--message', 'two\nlines'],
    ['status', '--force'], ['status', '--store', 'a', '--store', 'b'], ['move', '--store', 'x', '--from', 'a', '--message', 'm'], ['delete-merged-branch', '--store', 'x'], ['sync', '--path', 'a']]) {
    assert.equal(store.main(argv, { stdout: () => {}, stderr: () => {} }), 2, argv.join(' '));
  }
  assert.deepEqual(store.COMMANDS, ['status', 'sync', 'save', 'move', 'merge-branch', 'delete-merged-branch']);
  assert.deepEqual(store.VALUE_FLAGS, {
    status: ['--store', '--repo-root'], sync: ['--store', '--repo-root'], save: ['--store', '--repo-root', '--path', '--message'],
    move: ['--store', '--repo-root', '--from', '--to', '--message'], 'merge-branch': ['--store', '--repo-root', '--branch', '--message'],
    'delete-merged-branch': ['--store', '--repo-root', '--branch'],
  });
  const flags = [...fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-store.cjs'), 'utf8').matchAll(/'(--[a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(flags)].filter(flag => !['--literal-pathspecs', '--show-toplevel', '--push', '--all', '--list', '--show-scope', '--includes', '--quiet', '--no-tags', '--no-recurse-submodules', '--left-right', '--count', '--cached', '--raw', '--no-abbrev', '--ignore-removal', '--ff-only', '--no-ff', '--no-edit', '--no-commit', '--abort', '--is-ancestor', '--heads', '--delete', '--porcelain', '--untracked-files=all', '--is-shallow-repository', '--objects', '--batch-check=%(objecttype) %(objectname)'].includes(flag)).sort(),
    ['--branch', '--from', '--json', '--message', '--path', '--repo-root', '--store', '--to'], 'every caller flag is in the pinned table');
  assert.equal(store.mergedStoreBinding(os.tmpdir()).ok, false);
});

// ---- G2 round 1 findings: each test below reproduces one finding and holds the fix ---------------

const zlib = require('node:zlib');
const commitIn = (dir, file, text, message) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '-A'); git(dir, 'commit', '--quiet', '-m', message);
};

test('a graft in the store checkout cannot make an unmerged branch look merged, and the merged check is GitHub\'s', t => {
  const w = world(t);
  git(w.other, 'checkout', '--quiet', '-B', 'only-copy', 'origin/main');
  commitIn(w.other, 'only.md', 'only copy\n', 'only');
  git(w.other, 'push', '--quiet', 'origin', 'only-copy');
  const tip = git(w.other, 'rev-parse', 'HEAD');
  git(w.dir, 'fetch', '--quiet', 'origin', 'only-copy');
  fs.writeFileSync(path.join(w.dir, '.git', 'info', 'grafts'), `${git(w.dir, 'rev-parse', 'origin/main')} ${tip}\n`);
  const run = w.act(['delete-merged-branch', '--branch', 'only-copy']);
  assert.equal(run.code, 1, JSON.stringify(run.result));
  assert.match(run.result.stopped, /has commits that are not in main/);
  assert.notEqual(git(w.remote, 'branch', '--list', 'only-copy'), '', 'the only copy is still on the store');
  // Every Git call runs with grafts pointed at a missing file and the commit-graph off.
  assert.ok(w.calls.env.GIT_GRAFT_FILE && !fs.existsSync(w.calls.env.GIT_GRAFT_FILE));
});

test('a graft cannot turn a save into a history rewrite, and the read-back checks the old tip on GitHub', t => {
  const w = world(t);
  const tip = git(w.dir, 'rev-parse', 'origin/main');
  git(w.dir, 'checkout', '--quiet', '--orphan', 'tmpx');
  git(w.dir, 'rm', '-rq', '--cached', '.');
  fs.rmSync(path.join(w.dir, 'archives'), { recursive: true, force: true }); fs.rmSync(path.join(w.dir, 'loose.json'), { force: true });
  commitIn(w.dir, 'archives/rewritten.md', 'history replaced\n', 'orphan');
  const orphan = git(w.dir, 'rev-parse', 'HEAD');
  git(w.dir, 'branch', '-f', 'main', orphan); git(w.dir, 'checkout', '--quiet', 'main'); git(w.dir, 'branch', '-D', 'tmpx');
  fs.writeFileSync(path.join(w.dir, '.git', 'info', 'grafts'), `${orphan} ${tip}\n`);
  w.write('archives/new.md', 'n\n');
  const run = w.act(['save', '--path', 'archives/new.md', '--message', 'save']);
  assert.equal(run.code, 1);
  assert.deepEqual(pushes(w.calls), [], 'nothing is pushed');
  assert.equal(spawnSync('git', ['--git-dir', w.remote, 'merge-base', '--is-ancestor', tip, 'main']).status, 0, 'the remote history is intact');
});

test('a shallow store checkout is refused', t => {
  const w = world(t);
  const shallow = path.join(w.base, 'shallow');
  git(w.base, 'clone', '--quiet', '--depth', '1', `file://${w.remote}`, shallow);
  git(shallow, 'config', 'user.name', 'Test'); git(shallow, 'config', 'user.email', 'test@example.invalid');
  const out = [];
  assert.equal(store.main(['status', '--store', shallow, '--json'], { ...w.deps, stdout: text => out.push(text) }), 1);
  assert.match(JSON.parse(out.join('')).stopped, /shallow/);
});

test('a branch name that differs from the bound branch only by case is refused, and other branches never touch the bound tracking ref', t => {
  const w = world(t);
  for (const command of [['merge-branch', '--branch', 'Main', '--message', 'm'], ['delete-merged-branch', '--branch', 'MAIN']]) {
    assert.match(w.act(command).result.stopped, /is the bound store branch itself/, command.join(' '));
  }
  git(w.other, 'checkout', '--quiet', '-B', 'cloud', 'origin/main');
  commitIn(w.other, 'archives/cloud.md', 'cloud\n', 'cloud');
  git(w.other, 'push', '--quiet', 'origin', 'cloud');
  assert.equal(w.act(['merge-branch', '--branch', 'cloud', '--message', 'm']).code, 0);
  for (const args of w.calls.filter(call => call[0] === 'fetch')) {
    const spec = args.at(-1);
    assert.ok(spec === '+refs/heads/main:refs/remotes/origin/main' || spec === '+refs/heads/cloud:refs/toolkit-store/cloud', spec);
  }
});

test('a file the scan cannot read as text (gzip, UTF-16) is refused', t => {
  const w = world(t);
  fs.mkdirSync(path.join(w.dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(w.dir, 'evidence', 'logs.gz'), zlib.gzipSync(`token = ${PLANTED}\n`));
  assert.match(w.act(['save', '--path', 'evidence/logs.gz', '--message', 'gz']).result.stopped, /could not be scanned \(over 5 MB, binary or not UTF-8\): evidence\/logs\.gz/);
  fs.rmSync(path.join(w.dir, 'evidence', 'logs.gz'));
  fs.writeFileSync(path.join(w.dir, 'evidence', 'u16.txt'), Buffer.from(`token = ${PLANTED}\n`, 'utf16le'));
  assert.match(w.act(['save', '--path', 'evidence/u16.txt', '--message', 'u16']).result.stopped, /evidence\/u16\.txt/);
  assert.ok(!w.remoteHas('evidence/logs.gz') && !w.remoteHas('evidence/u16.txt'));
  assert.deepEqual(pushes(w.calls), []);
});

test('merge-branch scans every commit the branch brings in, and keeps to the store folders', t => {
  const w = world(t);
  git(w.other, 'checkout', '--quiet', '-B', 'hist', 'origin/main');
  commitIn(w.other, 'archives/tmp.md', `key ${PLANTED}\n`, 'leak');
  fs.rmSync(path.join(w.other, 'archives', 'tmp.md'));
  commitIn(w.other, 'archives/clean.md', 'clean\n', 'cleanup');
  git(w.other, 'push', '--quiet', 'origin', 'hist');
  assert.match(w.act(['merge-branch', '--branch', 'hist', '--message', 'm']).result.stopped, /archives\/tmp\.md:1 \(github-token\)/);
  assert.ok(!spawnSync('git', ['--git-dir', w.remote, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).stdout.split('\n').includes('leak'));
  assert.ok(!fs.existsSync(path.join(w.dir, '.git', 'MERGE_HEAD')));

  git(w.other, 'checkout', '--quiet', '-B', 'wf', 'origin/main');
  commitIn(w.other, '.github/workflows/x.yml', 'on: push\n', 'wf');
  git(w.other, 'push', '--quiet', 'origin', 'wf');
  assert.match(w.act(['merge-branch', '--branch', 'wf', '--message', 'm']).result.stopped, /\.github\/workflows\/x\.yml is outside the store folders/);
  assert.ok(!w.remoteHas('.github/workflows/x.yml'));
});

test('global push settings that could widen a push are refused, and git is found on PATH by full path', t => {
  const w = world(t);
  w.write('archives/g.md', 'g\n');
  for (const [key, section, name, value] of [['remote.origin.mirror', 'remote "origin"', 'mirror', 'true'], ['remote.origin.push', 'remote "origin"', 'push', '+refs/heads/*:refs/heads/*'], ['push.followtags', 'push', 'followTags', 'true']]) {
    fs.writeFileSync(path.join(w.home, '.gitconfig'), `[${section}]\n\t${name} = ${value}\n`);
    const run = w.act(['save', '--path', 'archives/g.md', '--message', 'g']);
    assert.ok((run.result?.stopped || '').includes(`could widen a store push (${key})`), key);
  }
  fs.rmSync(path.join(w.home, '.gitconfig'));
  const seen = [];
  assert.equal(w.act(['save', '--path', 'archives/g.md', '--message', 'g'], { run: (cmd, args, options) => { seen.push(cmd); return w.deps.run(cmd, args, options); } }).code, 0);
  assert.ok(seen.every(cmd => path.isAbsolute(cmd)), 'git is run by its full path');
});
