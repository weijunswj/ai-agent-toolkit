'use strict';

// toolkit store branches: merge-branch and delete-merged-branch never lose a file or a commit.
// Real Git against a local bare repository; only the GitHub read, the binding read and the reported
// remote address are faked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { PLANTED, git, commitIn, world } = require('./support/toolkit-store-world.cjs');

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
