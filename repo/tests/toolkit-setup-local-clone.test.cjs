'use strict';

// Setup fast-forwards the user's own clone of Toolkit only when it is clean and on the default branch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-local-clone-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  git(root, 'clone', origin, seed);
  fs.mkdirSync(path.join(seed, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'repo', 'scripts', 'setup-toolkit.cjs'), '// fixture\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'one');
  git(seed, 'push', 'origin', 'HEAD:main');
  const clone = path.join(root, 'my clone');
  git(root, 'clone', origin, clone);
  const pushNew = (name) => { fs.writeFileSync(path.join(seed, name), `${name}\n`); git(seed, 'add', '-A'); git(seed, 'commit', '-m', name); git(seed, 'push', 'origin', 'HEAD:main'); return git(seed, 'rev-parse', 'HEAD'); };
  const args = { repoRoot: path.join(root, 'managed'), repoRemote: origin, repoBranch: 'main' };
  return { clone, pushNew, args };
}

test('a clean clone on main fast-forwards; a second run is current', (t) => {
  const f = fixture(t);
  const head = f.pushNew('two.txt');
  const result = core.fastForwardLocalClone(f.args, f.clone);
  assert.deepEqual(result, { status: 'fast-forwarded', commit: head });
  assert.equal(git(f.clone, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(core.fastForwardLocalClone(f.args, f.clone), { status: 'current' });
});

test('a dirty clone, another branch or a diverged main is skipped with the reason and left exactly as it was', (t) => {
  const f = fixture(t);
  f.pushNew('two.txt');
  fs.writeFileSync(path.join(f.clone, 'local.txt'), 'mine\n');
  assert.match(core.fastForwardLocalClone(f.args, f.clone).reason, /uncommitted changes/);
  fs.rmSync(path.join(f.clone, 'local.txt'));
  git(f.clone, 'switch', '-c', 'feature');
  assert.match(core.fastForwardLocalClone(f.args, f.clone).reason, /on feature, not main/);
  git(f.clone, 'switch', 'main');
  fs.writeFileSync(path.join(f.clone, 'ahead.txt'), 'ahead\n');
  git(f.clone, 'add', '-A');
  git(f.clone, 'commit', '-m', 'local only');
  const before = git(f.clone, 'rev-parse', 'HEAD');
  assert.match(core.fastForwardLocalClone(f.args, f.clone).reason, /cannot fast-forward/);
  assert.equal(git(f.clone, 'rev-parse', 'HEAD'), before);
});

test('the managed checkout itself and folders that are not Toolkit clones are left alone', (t) => {
  const f = fixture(t);
  assert.equal(core.fastForwardLocalClone({ ...f.args, repoRoot: f.clone }, f.clone), null);
  assert.equal(core.fastForwardLocalClone({ ...f.args, repoRemote: 'https://github.com/someone/else' }, f.clone), null);
  assert.equal(core.fastForwardLocalClone(f.args, os.tmpdir()), null);
});
