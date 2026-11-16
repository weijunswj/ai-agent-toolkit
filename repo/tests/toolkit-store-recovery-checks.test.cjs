'use strict';

// toolkit store recovery, checks: nothing unscanned leaves (kept commits, hand commits, merged blobs
// and commit messages included), a conflicting race merge keeps both versions and never leaves a
// half-done merge, save, move and merge-branch catch up with a moved store, and no refusal points at
// a raw push. Each test is one or more rows of the closure matrix; retries and resume are in
// toolkit-store-recovery.test.cjs. Real Git against a local bare
// repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { PLANTED, RAW_ADVICE, git, commitIn, pushes, world, merging, settled, keptSave, backToStore } = require('./support/toolkit-store-world.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const spawnGit = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).status;

test('R6: a secret in a kept commit\'s message or blob, or in --message, is refused and nothing is pushed', t => {
  const w = world(t);
  const tip = w.remoteTip();
  const cases = [
    ['a kept commit message', () => { commitIn(w.dir, 'archives/m.md', 'm\n', `notes ${PLANTED}`); }, /commit [0-9a-f]{7} message:1 \(github-token\)/],
    ['a kept commit blob', () => { commitIn(w.dir, 'archives/b.md', `key ${PLANTED}\n`, 'blob'); }, /archives\/b\.md:1 \(github-token\)/],
    ['a secret added and removed again in kept commits', () => {
      commitIn(w.dir, 'archives/gone.md', `key ${PLANTED}\n`, 'add');
      commitIn(w.dir, 'archives/gone.md', 'clean\n', 'clean');
    }, /archives\/gone\.md:1 \(github-token\)/],
  ];
  for (const [label, plant, said] of cases) {
    backToStore(w);
    plant();
    w.write('archives/new.md', 'new\n');
    const run = w.act(['save', '--path', 'archives/new.md', '--message', 'new']);
    assert.equal(run.code, 1, label);
    assert.match(run.result.stopped, said, label);
    assert.ok(!run.result.stopped.includes(PLANTED), 'the finding never prints the secret');
    assert.doesNotMatch(run.result.next, RAW_ADVICE, label);
    assert.equal(w.remoteTip(), tip, label);
    assert.deepEqual(pushes(w.calls), [], label);
    settled(w);
  }
  backToStore(w);
  const head = git(w.dir, 'rev-parse', 'HEAD');
  w.write('archives/x.md', 'x\n');
  const run = w.act(['save', '--path', 'archives/x.md', '--message', `x ${PLANTED}`]);
  assert.match(run.result.stopped, /secret scan found 1 match\(es\) in --message \(github-token\)/);
  assert.ok(!run.result.stopped.includes(PLANTED));
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head, 'nothing is committed');
  settled(w);
});

test('R7: a hand commit outside the folders, deleting a file, adding a link or a submodule is refused by name', t => {
  const w = world(t);
  const tip = w.remoteTip();
  const cases = [
    ['outside the folders', () => commitIn(w.dir, 'loose.json', '{"raw":true}\n', 'raw'), /^commit [0-9a-f]{7}: loose\.json is outside the store folders/],
    ['a deletion', () => { git(w.dir, 'rm', '--quiet', 'archives/old/kept.md'); git(w.dir, 'commit', '--quiet', '-m', 'delete'); }, /^commit [0-9a-f]{7}: archives\/old\/kept\.md would be deleted or changed away/],
    ['a link', () => { fs.symlinkSync('kept.md', path.join(w.dir, 'archives', 'old', 'link.md')); git(w.dir, 'add', '-A'); git(w.dir, 'commit', '--quiet', '-m', 'link'); }, /archives\/old\/link\.md is a link or a nested repository/],
    ['a submodule', () => { git(w.dir, 'update-index', '--add', '--cacheinfo', `160000,${git(w.dir, 'rev-parse', 'HEAD')},archives/sub`); git(w.dir, 'commit', '--quiet', '-m', 'sub'); }, /archives\/sub is a link or a nested repository/],
  ];
  for (const [label, plant, said] of cases) {
    backToStore(w);
    plant();
    w.write('archives/new.md', 'new\n');
    const run = w.act(['save', '--path', 'archives/new.md', '--message', 'new']);
    assert.equal(run.code, 1, label);
    assert.match(run.result.stopped, said, label);
    assert.doesNotMatch(run.result.next, RAW_ADVICE, label);
    assert.equal(w.remoteTip(), tip, label);
    settled(w);
  }
});

test('R8: a clean hand commit inside the folders is checked again and pushed', t => {
  const w = world(t);
  commitIn(w.dir, 'archives/hand.md', 'hand\n', 'hand commit');
  const run = w.act(['save', '--path', 'archives/hand.md', '--message', 'hand']);
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.equal(run.result.resumed, 1);
  assert.ok(w.remoteHas('archives/hand.md'));
  settled(w);
});

test('R9: a race merge that conflicts keeps the store copy in place and ours under evidence/store-conflicts', t => {
  const w = world(t);
  w.hooks.racePushes = [w.raceIn('archives/same.md', 'theirs\n')];
  w.write('archives/same.md', 'ours\n');
  const run = w.act(['save', '--path', 'archives/same.md', '--message', 'ours']);
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.deepEqual(run.result.conflicts, ['archives/same.md']);
  assert.equal(run.result.kept_ours.length, 1);
  const parked = run.result.kept_ours[0];
  assert.match(parked, /^evidence\/store-conflicts\/\d{8}T\d{6}Z-[0-9a-f]{7}\/archives\/same\.md$/);
  assert.equal(w.remoteFile('archives/same.md'), 'theirs\n', 'the store copy stays in place');
  assert.equal(w.remoteFile(parked), 'ours\n', 'ours is kept beside it');
  assert.equal(fs.readFileSync(path.join(w.dir, ...parked.split('/')), 'utf8'), 'ours\n', 'the checkout holds it too');
  assert.equal(git(w.dir, 'status', '--porcelain'), '', 'the checkout is clean');
  assert.equal(git(w.dir, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'a merge commit');
  settled(w);
});

test('R10: a race merge that auto-merges a secret into a new blob is refused before the push', t => {
  const w = world(t);
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index}`);
  commitIn(w.other, 'archives/both.md', `${lines.join('\n')}\n`, 'base');
  git(w.other, 'push', '--quiet', 'origin', 'main');
  git(w.dir, 'pull', '--quiet', '--no-rebase', 'origin', 'main');
  const tip = w.remoteTip();
  w.hooks.racePushes = [() => {
    git(w.other, 'pull', '--quiet', '--no-rebase', 'origin', 'main');
    commitIn(w.other, 'archives/both.md', `${lines.map((line, index) => (index === 11 ? `key ${PLANTED}` : line)).join('\n')}\n`, 'theirs');
    git(w.other, 'push', '--quiet', 'origin', 'main');
  }];
  w.write('archives/both.md', `${lines.map((line, index) => (index === 0 ? 'ours' : line)).join('\n')}\n`);
  const run = w.act(['save', '--path', 'archives/both.md', '--message', 'ours']);
  assert.equal(run.code, 1, JSON.stringify(run.result));
  assert.match(run.result.stopped, /archives\/both\.md:12 \(github-token\)/);
  assert.equal(pushes(w.calls).length, 1, 'only the push the race refused');
  assert.notEqual(w.remoteTip(), git(w.dir, 'rev-parse', 'HEAD'));
  assert.ok(w.remoteTip() !== tip && !w.remoteFile('archives/both.md').startsWith('ours'), 'our merged blob never reached the store');
  settled(w);
});

test('R11 R14: save, move and merge-branch catch up with a moved store and push kept commits with their own', t => {
  const w = world(t);
  for (const command of ['save', 'move', 'merge-branch']) {
    w.calls.length = 0;
    keptSave(w, `archives/kept/${command}.md`);
    w.raceIn(`archives/moved-${command}.md`)();
    git(w.dir, 'fetch', '--quiet', 'origin');
    const argv = {
      save: () => { w.write('archives/step.md', 'step\n'); return ['save', '--path', 'archives/step.md', '--message', 'step']; },
      move: () => ['move', '--from', 'archives/old/kept.md', '--to', 'archives/older/kept.md', '--message', 'step'],
      'merge-branch': () => {
        git(w.other, 'checkout', '--quiet', '-B', 'side', 'origin/main');
        commitIn(w.other, 'archives/side.md', 'side\n', 'side');
        git(w.other, 'push', '--quiet', 'origin', 'side');
        git(w.other, 'checkout', '--quiet', 'main');
        return ['merge-branch', '--branch', 'side', '--message', 'step'];
      },
    }[command]();
    const run = w.act(argv);
    assert.equal(run.code, 0, `${command}: ${JSON.stringify(run.result)}`);
    assert.equal(run.result.resumed, 1, command);
    assert.ok(w.remoteHas(`archives/kept/${command}.md`) && w.remoteHas(`archives/moved-${command}.md`), command);
    settled(w);
  }
});

test('R12: a half-done merge is refused by every step with a store Next, and sync cancels it keeping the commits', t => {
  const w = world(t);
  commitIn(w.dir, 'archives/c.md', 'ours\n', 'ours');
  const ours = git(w.dir, 'rev-parse', 'HEAD');
  w.raceIn('archives/c.md', 'theirs\n')();
  git(w.dir, 'fetch', '--quiet', 'origin');
  assert.notEqual(spawnGit(w.dir, 'merge', '--no-edit', 'origin/main'), 0, 'the hand merge conflicts');
  assert.ok(merging(w));
  w.write('archives/new.md', 'new\n');
  git(w.other, 'push', '--quiet', 'origin', 'HEAD:refs/heads/side');
  for (const argv of [['save', '--path', 'archives/new.md', '--message', 'm'], ['move', '--from', 'loose.json', '--to', 'archives/loose.json', '--message', 'm'], ['merge-branch', '--branch', 'side', '--message', 'm']]) {
    const run = w.act(argv);
    assert.equal(run.code, 1, argv[0]);
    assert.match(run.result.stopped, /half-done merge/, argv[0]);
    assert.match(run.result.next, /^run sync/, argv[0]);
  }
  assert.deepEqual(pushes(w.calls), []);
  assert.equal(w.act(['status']).result.half_done_merge, true);
  const synced = w.act(['sync']);
  assert.equal(synced.code, 0, JSON.stringify(synced.result));
  assert.equal(synced.result.cancelled_merge, true);
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), ours, 'the commit is kept');
  assert.ok(!merging(w));
  const saved = w.act(['save', '--path', 'archives/new.md', '--message', 'new']);
  assert.equal(saved.code, 0, JSON.stringify(saved.result));
  assert.deepEqual(saved.result.conflicts, ['archives/c.md']);
  assert.equal(w.remoteFile('archives/c.md'), 'theirs\n');
  assert.equal(w.remoteFile(saved.result.kept_ours[0]), 'ours\n');
  settled(w);
});

test('R13: other staged changes are refused and nothing is committed', t => {
  const w = world(t);
  w.write('archives/staged.md', 'staged\n');
  git(w.dir, 'add', 'archives/staged.md');
  const head = git(w.dir, 'rev-parse', 'HEAD');
  w.write('archives/new.md', 'new\n');
  const run = w.act(['save', '--path', 'archives/new.md', '--message', 'new']);
  assert.match(run.result.stopped, /already has staged changes/);
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(pushes(w.calls), []);
});

test('R16: no Next line in the store command and no store doc line names a raw push, a reset or a hand merge', () => {
  const source = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-store.cjs'), 'utf8');
  const nexts = [...source.matchAll(/new StoreError\((.+)\);?$/gm)].map(match => match[1]);
  assert.ok(nexts.length > 40, 'every refusal is read');
  for (const line of nexts) assert.doesNotMatch(line, RAW_ADVICE, line);
  assert.doesNotMatch(/const KEPT_REFUSED = (.+);/.exec(source)[1], RAW_ADVICE);
  const doc = fs.readFileSync(path.join(ROOT, 'repo', 'docs', 'TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  const storeBlock = doc.slice(doc.indexOf('`toolkit store` routes to'), doc.indexOf('`toolkit cleanup` routes to'));
  assert.ok(storeBlock.length > 500);
  assert.doesNotMatch(storeBlock.replace(/A raw `git push` to a store[^.]*\./g, '').replace(/pointing at `save`; other raw `git` in the store still works\./, ''), /push them yourself|resolve the merge|\breset\b|refused, because they were never scanned/i);
});
