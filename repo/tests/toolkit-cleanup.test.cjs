'use strict';

// toolkit cleanup: only rebuildable scraps inside a scratch root are removed; everything else is
// kept and reported. Real Git repositories in the run's temp folder, no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const cleanup = require('../scripts/toolkit-cleanup.cjs');

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

// A world: a bare remote, a main checkout that ignores .tmp/, a home and an OS temp folder.
function world(t, { store = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-cleanup-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const remote = path.join(base, 'remote.git'), main = path.join(base, 'main'), home = path.join(base, 'home'), tmp = path.join(base, 'ostemp');
  for (const dir of [home, tmp]) fs.mkdirSync(dir);
  spawnSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  spawnSync('git', ['init', '--quiet', '-b', 'main', main]);
  fs.writeFileSync(path.join(main, '.gitignore'), '.tmp/\n*.log\n');
  fs.mkdirSync(path.join(main, 'src'));
  fs.writeFileSync(path.join(main, 'src', 'keep.txt'), 'real work\n');
  git(main, 'add', '.'); git(main, 'commit', '--quiet', '-m', 'first');
  git(main, 'remote', 'add', 'origin', remote); git(main, 'push', '--quiet', '-u', 'origin', 'main');
  git(main, 'remote', 'set-head', 'origin', 'main');
  fs.mkdirSync(path.join(main, '.tmp', 'worktrees'), { recursive: true });
  const made = { base, remote, main, home, tmp, storeDir: null };
  if (store) {
    const storeRemote = path.join(base, 'store.git');
    made.storeDir = path.join(base, 'store');
    spawnSync('git', ['init', '--quiet', '--bare', '-b', 'main', storeRemote]);
    spawnSync('git', ['init', '--quiet', '-b', 'main', made.storeDir]);
    fs.writeFileSync(path.join(made.storeDir, 'report.md'), 'evidence\n');
    git(made.storeDir, 'add', '.'); git(made.storeDir, 'commit', '--quiet', '-m', 'evidence');
    git(made.storeDir, 'remote', 'add', 'origin', storeRemote); git(made.storeDir, 'push', '--quiet', '-u', 'origin', 'main');
    // The binding names the store by its GitHub name; the fake run answers the origin question.
    fs.mkdirSync(path.join(main, '.github'));
    fs.writeFileSync(path.join(main, '.github', 'toolkit-programme.json'), JSON.stringify({ governance: 'enabled', store: { kind: 'github', repository: 'Owner/Store', branch: 'main' } }));
    git(main, 'add', '.'); git(main, 'commit', '--quiet', '-m', 'binding'); git(main, 'push', '--quiet');
  }
  const run = (cmd, args, options) => (made.storeDir && args[1] === made.storeDir && args.slice(2).join(' ') === 'remote get-url origin'
    ? { status: 0, stdout: `${made.originAnswer || 'https://github.com/owner/store.git'}\n`, stderr: '' } : spawnSync(cmd, args, options));
  made.run = run;
  made.cleaner = (extra = {}) => new cleanup.ScratchCleaner({ home, tmpdir: tmp, cwd: main, run, ...extra });
  // An apply with the store read-back satisfied, as a governed session runs it.
  made.apply = (options = {}, extra = {}) => made.cleaner(extra).apply({ storePath: made.storeDir, ...options });
  made.cli = (argv, extra = {}) => { const out = [], err = []; const code = cleanup.main(argv, { home, tmpdir: tmp, cwd: main, run, stdout: text => out.push(text), stderr: text => err.push(text), ...extra }); return { code, out: out.join(''), err: err.join('') }; };
  made.worktree = (name, { push = true } = {}) => {
    const dir = path.join(main, '.tmp', 'worktrees', name);
    git(main, 'worktree', 'add', '--quiet', '-b', `lane/${name}`, dir);
    fs.writeFileSync(path.join(dir, 'work.txt'), `${name}\n`);
    git(dir, 'add', '.'); git(dir, 'commit', '--quiet', '-m', name);
    if (push) git(dir, 'push', '--quiet', '-u', 'origin', `lane/${name}`);
    return dir;
  };
  return made;
}
const byPath = (result, target) => result.items.find(item => item.path === path.resolve(target));

test('a clean pushed worktree, a backup file and temp files are removed and reported in one line', t => {
  const w = world(t);
  const tree = w.worktree('done');
  const backup = path.join(w.main, '.tmp', 'settings.backup.json');
  const folder = path.join(w.main, '.tmp', 'run-1');
  fs.writeFileSync(backup, '{}');
  fs.mkdirSync(path.join(folder, 'deep'), { recursive: true });
  for (const name of ['a.txt', 'b.txt', path.join('deep', 'c.txt')]) fs.writeFileSync(path.join(folder, name), 'x');
  const done = w.cli(['apply', '--path', tree, '--path', backup, '--path', folder, '--store', w.storeDir]);
  assert.equal(done.code, 0);
  assert.match(done.out, /^cleaned: 1 worktree, 4 temp files \(evidence store read back\)\n$/);
  for (const gone of [tree, backup, folder]) assert.equal(fs.existsSync(gone), false, gone);
  assert.equal(fs.readFileSync(path.join(w.main, 'src', 'keep.txt'), 'utf8'), 'real work\n');
  assert.doesNotMatch(git(w.main, 'worktree', 'list'), /done/);
  assert.match(git(w.main, 'branch', '--list', 'lane/done'), /lane\/done/, 'the branch is not deleted with the worktree');
});

test('a dirty worktree, an unpushed one, one with only ignored files, a local branch and a file outside the roots are kept', t => {
  const w = world(t);
  const dirty = w.worktree('dirty'); fs.writeFileSync(path.join(dirty, 'new.txt'), 'unsaved');
  const unpushed = w.worktree('unpushed', { push: false });
  const ignored = w.worktree('ignored'); fs.writeFileSync(path.join(ignored, 'run.log'), 'ignored by git');
  const locked = w.worktree('locked'); git(w.main, 'worktree', 'lock', locked);
  const outside = path.join(w.main, 'src', 'keep.txt');
  const result = w.apply({ paths: [dirty, unpushed, ignored, locked, outside], branches: ['lane/unpushed'] });
  assert.equal(byPath(result, dirty).reason, 'it has uncommitted changes or untracked files');
  assert.equal(byPath(result, unpushed).reason, 'its commit is not on any remote');
  assert.equal(byPath(result, ignored).reason, 'it holds ignored files, which removal would delete');
  assert.equal(byPath(result, locked).reason, 'the worktree is locked');
  assert.deepEqual([byPath(result, outside).action, byPath(result, outside).reason], ['refuse', 'it is outside every scratch root']);
  assert.equal(result.branches[0].reason, 'a worktree has it checked out');
  assert.deepEqual(result.cleaned, { worktrees: 0, files: 0, folders: 0, branches: 0 });
  for (const kept of [dirty, unpushed, ignored, locked, outside]) assert.equal(fs.existsSync(kept), true, kept);
});

test('paths that escape a root, links, nested checkouts, tracked files and the roots themselves are never removed', t => {
  const w = world(t);
  const tmpRoot = path.join(w.main, '.tmp');
  const victim = path.join(w.base, 'victim'); fs.mkdirSync(victim); fs.writeFileSync(path.join(victim, 'owner.txt'), 'owner data');
  const link = path.join(tmpRoot, 'link'); fs.symlinkSync(victim, link, 'junction');
  const holder = path.join(tmpRoot, 'holder'); fs.mkdirSync(holder); fs.symlinkSync(victim, path.join(holder, 'inner'), 'junction');
  const clone = path.join(tmpRoot, 'clone'); spawnSync('git', ['clone', '--quiet', w.remote, clone]);
  const nested = path.join(tmpRoot, 'bundle'); fs.mkdirSync(path.join(nested, 'x', '.git'), { recursive: true });
  const tracked = path.join(w.main, '.tmp', 'tracked.txt'); fs.writeFileSync(tracked, 'tracked'); git(w.main, 'add', '-f', tracked); git(w.main, 'commit', '--quiet', '-m', 'tracked scrap');
  const cases = {
    [path.join(tmpRoot, '..', 'src')]: ['refuse', 'it is outside every scratch root'],
    [tmpRoot]: ['refuse', 'it is outside every scratch root'],
    [path.join(link, 'owner.txt')]: ['refuse', 'a link in its path leads outside the scratch root'],
    [link]: ['keep', 'it is a link; Toolkit never deletes through or around a link'],
    [holder]: ['keep', 'it holds a link, which could lead outside the scratch root'],
    [clone]: ['keep', 'it is a Git checkout that is not a registered worktree of this repository'],
    [nested]: ['keep', 'it holds a Git checkout, which may carry work that exists nowhere else'],
    [tracked]: ['keep', 'Git tracks files in it'],
    [path.join(w.tmp, 'other-app', 'file.txt')]: ['refuse', 'in the OS temp folder only a folder named ai-agent-toolkit-<name> is in scope'],
    [path.join(w.tmp, 'ai-agent-toolkit-')]: ['refuse', 'in the OS temp folder only a folder named ai-agent-toolkit-<name> is in scope'],
    [w.tmp]: ['refuse', 'it is outside every scratch root'],
  };
  fs.mkdirSync(path.join(w.tmp, 'other-app')); fs.writeFileSync(path.join(w.tmp, 'other-app', 'file.txt'), 'another app');
  const result = w.apply({ paths: Object.keys(cases) });
  for (const [target, expected] of Object.entries(cases)) assert.deepEqual([byPath(result, target).action, byPath(result, target).reason], expected, target);
  assert.equal(fs.readFileSync(path.join(victim, 'owner.txt'), 'utf8'), 'owner data');
  assert.equal(fs.existsSync(path.join(w.tmp, 'other-app', 'file.txt')), true);
});

test('a Toolkit-named OS temp folder and the user-state temp folder are in scope; the session folder is kept', t => {
  const w = world(t);
  const named = path.join(w.tmp, 'ai-agent-toolkit-run7'); fs.mkdirSync(named); fs.writeFileSync(path.join(named, 'out.txt'), 'x');
  const state = path.join(w.home, '.ai-agent-toolkit', 'user-state', 'tmp', 'old'); fs.mkdirSync(state, { recursive: true });
  const here = path.join(w.main, '.tmp', 'here'); fs.mkdirSync(here);
  const result = w.apply({ repoRoot: w.main, paths: [named, state, here] }, { cwd: here });
  assert.deepEqual([byPath(result, named).action, byPath(result, state).action], ['removed', 'removed']);
  assert.equal(byPath(result, here).reason, 'this session is working inside it');
  assert.equal(fs.existsSync(w.tmp), true);
});

test('cleanup runs only after the evidence store read-back; a failed read-back deletes nothing and says why', t => {
  const w = world(t);
  const scrap = path.join(w.main, '.tmp', 'scrap.txt'); fs.writeFileSync(scrap, 'x');
  const failures = [
    [{}, 'this repository has an evidence store and no --store <folder> was given'],
    [{ storePath: w.main }, 'that folder is not a checkout of the bound evidence store'],
  ];
  for (const [extra, reason] of failures) {
    const result = w.cleaner().apply({ paths: [scrap], ...extra });
    assert.deepEqual([result.read_back.ok, result.read_back.reason], [false, reason]);
  }
  fs.writeFileSync(path.join(w.storeDir, 'unsaved.md'), 'not committed');
  assert.equal(w.cleaner().apply({ paths: [scrap], storePath: w.storeDir }).read_back.reason, 'the evidence store checkout has changes that are not committed');
  git(w.storeDir, 'add', '.'); git(w.storeDir, 'commit', '--quiet', '-m', 'local only');
  assert.equal(w.cleaner().apply({ paths: [scrap], storePath: w.storeDir }).read_back.reason, 'the evidence store checkout has commits that are not on the remote');
  w.originAnswer = 'https://github.com/owner/other.git';
  assert.equal(w.cleaner().apply({ paths: [scrap], storePath: w.storeDir }).read_back.reason, 'that folder is not a checkout of the bound evidence store');
  w.originAnswer = null;
  assert.equal(fs.existsSync(scrap), true, 'nothing was deleted while the read-back failed');
  const stopped = w.cli(['apply', '--path', scrap]);
  assert.equal(stopped.code, 1);
  assert.match(stopped.out, /^Stopped: nothing was deleted, because this repository has an evidence store and no --store <folder> was given\. Next: /);
  git(w.storeDir, 'push', '--quiet');
  const done = w.cleaner().apply({ paths: [scrap], storePath: w.storeDir });
  assert.deepEqual([done.read_back.ok, done.cleaned.files, fs.existsSync(scrap)], [true, 1, false]);
});

test('a local branch goes only when it is fully in the default branch on the remote', t => {
  const w = world(t);
  git(w.main, 'branch', 'merged'); git(w.main, 'branch', 'ahead');
  git(w.main, 'checkout', '--quiet', 'ahead'); fs.writeFileSync(path.join(w.main, 'src', 'more.txt'), 'm'); git(w.main, 'add', '.'); git(w.main, 'commit', '--quiet', '-m', 'ahead'); git(w.main, 'checkout', '--quiet', 'main');
  const result = w.apply({ branches: ['merged', 'ahead', 'main', 'missing', '--force', 'a..b'] });
  const of = name => result.branches.find(item => item.branch === name);
  assert.equal(of('merged').action, 'removed');
  assert.equal(of('ahead').reason, 'it is not fully in origin/main');
  assert.equal(of('main').reason, 'it is the default branch');
  assert.equal(of('missing').action, 'gone');
  assert.deepEqual([of('--force').action, of('a..b').action], ['refuse', 'refuse']);
  assert.deepEqual(git(w.main, 'branch', '--format=%(refname:short)').split('\n').sort(), ['ahead', 'main']);
  assert.equal(git(w.remote, 'branch', '--format=%(refname:short)'), 'main', 'no remote branch is ever deleted');
});

test('--stale takes only entries untouched for seven days, and expands the worktrees folder', t => {
  const w = world(t);
  const old = path.join(w.main, '.tmp', 'old.txt'), fresh = path.join(w.main, '.tmp', 'fresh.txt');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'x');
  const tree = w.worktree('stale');
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const everything = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? [...everything(path.join(dir, entry.name)), path.join(dir, entry.name)] : [path.join(dir, entry.name)]));
  for (const target of [old, ...everything(tree), tree]) fs.utimesSync(target, past, past);
  const plan = w.cleaner().plan({ stale: true });
  assert.deepEqual(plan.items.map(item => [path.basename(item.path), item.action, item.kind]).sort(), [['old.txt', 'remove', 'file'], ['stale', 'remove', 'worktree']]);
  assert.equal(fs.existsSync(old), true, 'plan removes nothing');
});

test('the command line refuses a run that names nothing, and plan prints what it would do', t => {
  const w = world(t);
  const errors = [];
  assert.equal(cleanup.main(['apply'], { stderr: text => errors.push(text) }), 2);
  assert.match(errors.join(''), /^Stopped: nothing was named to clean\. Next: /);
  assert.equal(cleanup.main(['purge', '--stale'], { stderr: () => {} }), 2);
  const scrap = path.join(w.main, '.tmp', 'a.txt'); fs.writeFileSync(scrap, 'x');
  const lines = [];
  assert.equal(cleanup.main(['plan', '--path', scrap, '--path', path.join(w.main, 'src')], { home: w.home, tmpdir: w.tmp, cwd: w.main, stdout: text => lines.push(text) }), 0);
  assert.match(lines.join(''), /- would remove \(file\): .*a\.txt\n- refused: .*src: it is outside every scratch root\n$/);
});

// ---- review findings: each test below reproduces one finding and holds the fix ------------------

test('nothing inside a worktree or a clone is removed piece by piece, and a Git folder is never a scrap', t => {
  const w = world(t);
  // A registered, pushed worktree with an uncommitted edit and an untracked file.
  const tree = w.worktree('live');
  fs.mkdirSync(path.join(tree, 'lib')); fs.writeFileSync(path.join(tree, 'lib', 'code.js'), 'one\n');
  git(tree, 'add', '.'); git(tree, 'commit', '--quiet', '-m', 'lib'); git(tree, 'push', '--quiet');
  fs.writeFileSync(path.join(tree, 'work.txt'), 'edited, not committed\n');
  fs.writeFileSync(path.join(tree, 'lib', 'new-untracked.js'), 'unsaved\n');
  // A full clone under .tmp with an uncommitted tracked edit, and the same under the user-state root.
  const clone = path.join(w.main, '.tmp', 'clone'); spawnSync('git', ['clone', '--quiet', w.remote, clone]);
  fs.writeFileSync(path.join(clone, 'src', 'keep.txt'), 'edited in the clone\n');
  const stateClone = path.join(w.home, '.ai-agent-toolkit', 'user-state', 'tmp', 'checkout');
  fs.mkdirSync(path.dirname(stateClone), { recursive: true }); spawnSync('git', ['clone', '--quiet', w.remote, stateClone]);
  fs.writeFileSync(path.join(stateClone, 'src', 'keep.txt'), 'edited in the state clone\n');
  const inside = 'it is inside a Git checkout; Toolkit removes a whole clean worktree, never part of one';
  const gitPart = 'part of its path is a Git folder; Toolkit never deletes inside one';
  const cases = {
    [path.join(tree, 'work.txt')]: ['keep', inside],
    [path.join(tree, 'lib')]: ['keep', inside],
    [path.join(tree, 'lib', 'new-untracked.js')]: ['keep', inside],
    [path.join(tree, '.git')]: ['refuse', gitPart],
    [path.join(clone, 'src')]: ['keep', inside],
    [path.join(clone, '.git', 'config')]: ['refuse', gitPart],
    [path.join(clone, '.GIT')]: ['refuse', gitPart],
    [path.join(stateClone, 'src')]: ['keep', inside],
    [path.join(stateClone, 'src', 'keep.txt')]: ['keep', inside],
    [tree]: ['keep', 'it has uncommitted changes or untracked files'],
  };
  // Two runs: the second must not find anything the first loosened.
  for (const round of [1, 2]) {
    const result = w.apply({ paths: Object.keys(cases) });
    for (const [target, expected] of Object.entries(cases)) assert.deepEqual([byPath(result, target).action, byPath(result, target).reason], expected, `run ${round}: ${target}`);
    assert.deepEqual(result.cleaned, { worktrees: 0, files: 0, folders: 0, branches: 0 });
  }
  assert.equal(fs.readFileSync(path.join(tree, 'work.txt'), 'utf8'), 'edited, not committed\n');
  assert.equal(fs.readFileSync(path.join(tree, 'lib', 'new-untracked.js'), 'utf8'), 'unsaved\n');
  assert.equal(git(tree, 'status', '--porcelain'), 'M work.txt\n?? lib/new-untracked.js'.replace('M work', ' M work').trim());
  assert.equal(fs.readFileSync(path.join(clone, 'src', 'keep.txt'), 'utf8'), 'edited in the clone\n');
  assert.equal(fs.readFileSync(path.join(stateClone, 'src', 'keep.txt'), 'utf8'), 'edited in the state clone\n');
});

test('the read-back cannot be skipped: no repository, no binding or another repository deletes nothing', t => {
  const w = world(t);
  const bare = world(t, { store: false });
  const state = path.join(w.home, '.ai-agent-toolkit', 'user-state', 'tmp', 'report.md'); fs.mkdirSync(path.dirname(state), { recursive: true }); fs.writeFileSync(state, 'a review waiting for upload');
  const named = path.join(w.tmp, 'ai-agent-toolkit-g2'); fs.mkdirSync(named); fs.writeFileSync(path.join(named, 'report.md'), 'x');
  const plain = path.join(w.base, 'plain'); fs.mkdirSync(plain);
  // Outside any repository: Git must not find the run's own checkout above the temp folder.
  const outside = (cmd, args, options) => spawnSync(cmd, args, { ...options, env: { ...process.env, GIT_CEILING_DIRECTORIES: w.base } });
  const unbound = w.cleaner({ cwd: plain, run: outside }).apply({ repoRoot: bare.main, paths: [state, named] });
  assert.deepEqual([unbound.read_back.ok, unbound.read_back.reason], [false, 'this repository binds no evidence store, so nothing could be read back']);
  for (const repoRoot of [plain, null]) {
    const none = w.cleaner({ cwd: plain, run: outside }).apply({ repoRoot, paths: [state, named] });
    assert.deepEqual([none.read_back.ok, none.read_back.reason], [false, 'this folder is not inside a repository, so no evidence store could be read back'], String(repoRoot));
  }
  // From inside the governed repository, another repository cannot be named to dodge its store.
  assert.throws(() => w.cleaner().apply({ repoRoot: bare.main, paths: [state] }), /^Error: Stopped: --repo-root names a different repository from the one this session is in\./);
  const refused = w.cli(['apply', '--repo-root', bare.main, '--path', state]);
  assert.deepEqual([refused.code, refused.out], [1, '']);
  assert.match(refused.err, /^Stopped: --repo-root names a different repository/);
  const missing = w.cli(['apply', '--path', state, '--path', named]);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /^Stopped: nothing was deleted, because this repository has an evidence store and no --store <folder> was given\./);
  for (const kept of [state, path.join(named, 'report.md')]) assert.equal(fs.existsSync(kept), true, kept);
  const done = w.apply({ paths: [state, named] });
  assert.deepEqual([done.read_back.note, done.cleaned.files], ['evidence store read back', 2]);
});

test('a scratch root that is a link is refused, so nothing behind it is deleted', t => {
  const w = world(t);
  const victim = path.join(w.base, 'victim'); fs.mkdirSync(victim); fs.writeFileSync(path.join(victim, 'owner.txt'), 'owner data');
  const stateParent = path.join(w.home, '.ai-agent-toolkit', 'user-state'); fs.mkdirSync(stateParent, { recursive: true });
  fs.symlinkSync(victim, path.join(stateParent, 'tmp'), 'junction');
  fs.rmSync(path.join(w.main, '.tmp'), { recursive: true }); fs.symlinkSync(victim, path.join(w.main, '.tmp'), 'junction');
  const targets = [path.join(stateParent, 'tmp', 'owner.txt'), path.join(w.main, '.tmp', 'owner.txt')];
  const result = w.apply({ paths: targets });
  for (const target of targets) assert.deepEqual([byPath(result, target).action, byPath(result, target).reason], ['refuse', 'its scratch root is a link, not a real folder'], target);
  assert.equal(fs.readFileSync(path.join(victim, 'owner.txt'), 'utf8'), 'owner data');
});

test('--stale keeps a folder whose deep file changed recently', t => {
  const w = world(t);
  const folder = path.join(w.main, '.tmp', 'lane'); const deep = path.join(folder, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'live.txt'), 'being written now');
  const idle = path.join(w.main, '.tmp', 'idle'); fs.mkdirSync(path.join(idle, 'a', 'b'), { recursive: true }); fs.writeFileSync(path.join(idle, 'a', 'b', 'old.txt'), 'x');
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  for (const target of [folder, path.join(folder, 'a'), deep, path.join(idle, 'a', 'b', 'old.txt'), path.join(idle, 'a', 'b'), path.join(idle, 'a'), idle]) fs.utimesSync(target, past, past);
  assert.deepEqual(w.cleaner().plan({ stale: true }).items.map(item => path.basename(item.path)), ['idle']);
});
