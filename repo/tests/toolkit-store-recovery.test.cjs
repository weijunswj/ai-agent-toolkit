'use strict';

// toolkit store recovery: a failed or raced push never strands the store checkout. The next store
// step checks the kept commits again and pushes them; a lost race is retried with waits; a
// conflicting race merge keeps both versions and never leaves a half-done merge; nothing unscanned
// leaves (merged blobs and commit messages included); no refusal points at a raw push. Each test is
// one or more rows of the closure matrix (R1 to R17). Real Git against a local bare repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PLANTED, git, commitIn, pushes, world } = require('./support/toolkit-store-world.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PLAIN_PUSH = ['push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main'];
// R16: no Next line or store doc line names a raw push, a reset or a hand merge.
const RAW_ADVICE = /git push|\breset\b|push them yourself|resolve the merge|by hand/i;

const merging = w => fs.existsSync(path.join(w.dir, '.git', 'MERGE_HEAD'));
const ahead = w => Number(git(w.dir, 'rev-list', '--count', 'origin/main..HEAD'));

// R17 and I4, after every row: only the plain push of the bound branch, no half-done merge, nothing
// left staged.
function settled(w) {
  for (const args of pushes(w.calls)) assert.deepEqual(args, PLAIN_PUSH);
  assert.ok(!merging(w), 'no half-done merge is left');
  assert.equal(git(w.dir, 'diff', '--cached', '--name-only'), '', 'nothing is left staged');
}

// R1: a save whose push fails every time, leaving its commit kept in the checkout.
function keptSave(w, file = 'archives/kept/report.md', text = 'report\n') {
  w.write(file, text);
  w.hooks.refusePushes = 4;
  const run = w.act(['save', '--path', file, '--message', `save ${file}`]);
  assert.equal(run.code, 1, JSON.stringify(run.result));
  return run;
}

test('R1 R2: a save whose pushes all fail keeps its commit, and the same save run again pushes it', t => {
  const w = world(t);
  const tip = w.remoteTip();
  const failed = keptSave(w);
  assert.match(failed.result.stopped, /the push to the store failed 4 times; your commit is kept in the store checkout, not pushed\./);
  assert.match(failed.result.next, /run the same store command again/);
  assert.doesNotMatch(failed.result.next, RAW_ADVICE);
  assert.equal(pushes(w.calls).length, 4, 'four attempts, no more');
  assert.deepEqual(w.waits, [2000, 4000, 8000], 'backed-off waits before each retry');
  assert.equal(w.remoteTip(), tip);
  assert.equal(ahead(w), 1);
  settled(w);

  const kept = git(w.dir, 'rev-parse', 'HEAD');
  w.calls.length = 0;
  const again = w.act(['save', '--path', 'archives/kept/report.md', '--message', 'save archives/kept/report.md']);
  assert.equal(again.code, 0, JSON.stringify(again.result));
  assert.equal(again.result.read_back, true);
  assert.equal(again.result.resumed, 1);
  assert.equal(again.result.commit, kept, 'no new commit: the kept one is pushed');
  assert.equal(w.remoteTip(), kept);
  assert.ok(w.remoteHas('archives/kept/report.md'));
  settled(w);
});

test('R3: a new save on top of a kept commit pushes both', t => {
  const w = world(t);
  keptSave(w);
  const kept = git(w.dir, 'rev-parse', 'HEAD');
  w.write('archives/next.md', 'next\n');
  const run = w.act(['save', '--path', 'archives/next.md', '--message', 'next']);
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.equal(run.result.resumed, 1);
  assert.equal(git(w.dir, 'rev-parse', 'HEAD~1'), kept);
  assert.ok(w.remoteHas('archives/kept/report.md') && w.remoteHas('archives/next.md'));
  settled(w);
});

test('R4: a store that moves before three pushes is merged each time and lands on the fourth', t => {
  const w = world(t);
  w.hooks.racePushes = [w.raceIn('archives/r1.md'), w.raceIn('archives/r2.md'), w.raceIn('archives/r3.md')];
  w.write('archives/mine.md', 'mine\n');
  const run = w.act(['save', '--path', 'archives/mine.md', '--message', 'mine']);
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.equal(run.result.merged_remote, true);
  assert.equal(pushes(w.calls).length, 4);
  assert.deepEqual(w.waits, [2000, 4000, 8000]);
  for (const file of ['archives/mine.md', 'archives/r1.md', 'archives/r2.md', 'archives/r3.md']) assert.ok(w.remoteHas(file), file);
  const merges = git(w.dir, 'rev-list', '--merges', '--count', 'HEAD');
  assert.equal(merges, '3', 'one merge commit per race, never a rebase');
  settled(w);

  // A fourth race too: the run stops after four attempts and the next run lands it.
  w.calls.length = 0; w.waits.length = 0;
  w.hooks.racePushes = [1, 2, 3, 4].map(n => w.raceIn(`archives/s${n}.md`));
  w.write('archives/mine2.md', 'mine2\n');
  const lost = w.act(['save', '--path', 'archives/mine2.md', '--message', 'mine2']);
  assert.equal(lost.code, 1);
  assert.equal(pushes(w.calls).length, 4);
  settled(w);
  const next = w.act(['save', '--path', 'archives/mine2.md', '--message', 'mine2']);
  assert.equal(next.code, 0, JSON.stringify(next.result));
  assert.ok(w.remoteHas('archives/mine2.md') && w.remoteHas('archives/s4.md'));
  settled(w);
});

test('R5: a push that timed out but landed is read first and never sent again', t => {
  const w = world(t);
  w.hooks.landButFail = 1;
  w.write('archives/landed.md', 'landed\n');
  const run = w.act(['save', '--path', 'archives/landed.md', '--message', 'landed']);
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.equal(run.result.read_back, true);
  assert.equal(pushes(w.calls).length, 1, 'no second push');
  assert.deepEqual(w.waits, [2000]);
  assert.equal(w.remoteTip(), git(w.dir, 'rev-parse', 'HEAD'));
  settled(w);
});

test('R5 R1: a last push that landed is not reported as failed, and a dropped network counts as a failed try', t => {
  const w = world(t);
  w.hooks.refusePushes = 3;
  w.hooks.landButFail = 1;
  w.write('archives/last.md', 'last\n');
  const run = w.act(['save', '--path', 'archives/last.md', '--message', 'last']);
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.equal(pushes(w.calls).length, 4, 'never a fifth push');
  assert.equal(w.remoteTip(), git(w.dir, 'rev-parse', 'HEAD'));
  settled(w);

  w.calls.length = 0; w.waits.length = 0;
  // The first push fails and the network drops: every read after it fails too.
  w.hooks.refusePushes = 1;
  w.hooks.racePushes = [() => { w.hooks.failFetches = 4; }];
  w.write('archives/offline.md', 'offline\n');
  const offline = w.act(['save', '--path', 'archives/offline.md', '--message', 'offline']);
  assert.equal(offline.code, 1, JSON.stringify(offline.result));
  assert.match(offline.result.stopped, /failed 4 times; your commit is kept/);
  assert.deepEqual(w.waits, [2000, 4000, 8000]);
  assert.equal(pushes(w.calls).length, 1, 'no push while the store cannot be read');
  assert.equal(ahead(w), 1);
  settled(w);
  assert.equal(w.act(['save', '--path', 'archives/offline.md', '--message', 'offline']).code, 0, 'back online, the same save lands');
  assert.ok(w.remoteHas('archives/offline.md'));
  settled(w);
});

test('R6: a secret in a kept commit\'s message or blob, or in --message, is refused and nothing is pushed', t => {
  const cases = [
    ['a kept commit message', w => { commitIn(w.dir, 'archives/m.md', 'm\n', `notes ${PLANTED}`); }, /commit [0-9a-f]{7} message:1 \(github-token\)/],
    ['a kept commit blob', w => { commitIn(w.dir, 'archives/b.md', `key ${PLANTED}\n`, 'blob'); }, /archives\/b\.md:1 \(github-token\)/],
    ['a secret added and removed again in kept commits', w => {
      commitIn(w.dir, 'archives/gone.md', `key ${PLANTED}\n`, 'add');
      commitIn(w.dir, 'archives/gone.md', 'clean\n', 'clean');
    }, /archives\/gone\.md:1 \(github-token\)/],
  ];
  for (const [label, plant, said] of cases) {
    const w = world(t);
    const tip = w.remoteTip();
    plant(w);
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
  const w = world(t);
  const head = git(w.dir, 'rev-parse', 'HEAD');
  w.write('archives/x.md', 'x\n');
  const run = w.act(['save', '--path', 'archives/x.md', '--message', `x ${PLANTED}`]);
  assert.match(run.result.stopped, /secret scan found 1 match\(es\) in --message \(github-token\)/);
  assert.ok(!run.result.stopped.includes(PLANTED));
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head, 'nothing is committed');
  settled(w);
});

test('R7: a hand commit outside the folders, deleting a file, adding a link or a submodule is refused by name', t => {
  const cases = [
    ['outside the folders', w => commitIn(w.dir, 'loose.json', '{"raw":true}\n', 'raw'), /^commit [0-9a-f]{7}: loose\.json is outside the store folders/],
    ['a deletion', w => { git(w.dir, 'rm', '--quiet', 'archives/old/kept.md'); git(w.dir, 'commit', '--quiet', '-m', 'delete'); }, /^commit [0-9a-f]{7}: archives\/old\/kept\.md would be deleted or changed away/],
    ['a link', w => { fs.symlinkSync('kept.md', path.join(w.dir, 'archives', 'old', 'link.md')); git(w.dir, 'add', '-A'); git(w.dir, 'commit', '--quiet', '-m', 'link'); }, /archives\/old\/link\.md is a link or a nested repository/],
    ['a submodule', w => { git(w.dir, 'update-index', '--add', '--cacheinfo', `160000,${git(w.dir, 'rev-parse', 'HEAD')},archives/sub`); git(w.dir, 'commit', '--quiet', '-m', 'sub'); }, /archives\/sub is a link or a nested repository/],
  ];
  for (const [label, plant, said] of cases) {
    const w = world(t);
    const tip = w.remoteTip();
    plant(w);
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
  for (const command of ['save', 'move', 'merge-branch']) {
    const w = world(t);
    keptSave(w);
    w.raceIn('archives/moved.md')();
    git(w.dir, 'fetch', '--quiet', 'origin');
    const argv = {
      save: () => { w.write('archives/step.md', 'step\n'); return ['save', '--path', 'archives/step.md', '--message', 'step']; },
      move: () => ['move', '--from', 'archives/old/kept.md', '--to', 'archives/older/kept.md', '--message', 'step'],
      'merge-branch': () => {
        git(w.other, 'checkout', '--quiet', '-B', 'side', 'origin/main');
        commitIn(w.other, 'archives/side.md', 'side\n', 'side');
        git(w.other, 'push', '--quiet', 'origin', 'side');
        return ['merge-branch', '--branch', 'side', '--message', 'step'];
      },
    }[command]();
    const run = w.act(argv);
    assert.equal(run.code, 0, `${command}: ${JSON.stringify(run.result)}`);
    assert.equal(run.result.resumed, 1, command);
    assert.ok(w.remoteHas('archives/kept/report.md') && w.remoteHas('archives/moved.md'), command);
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

function spawnGit(cwd, ...args) {
  return require('node:child_process').spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).status;
}

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

test('R15: status shows the kept commits and sync never pushes or merges them', t => {
  const w = world(t);
  keptSave(w);
  const head = git(w.dir, 'rev-parse', 'HEAD');
  w.raceIn('archives/moved.md')();
  w.calls.length = 0;
  assert.equal(w.act(['status']).result.ahead, 1);
  const synced = w.act(['sync']);
  assert.equal(synced.code, 0, JSON.stringify(synced.result));
  assert.equal(synced.result.pending, 1);
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head, 'no merge, no move');
  assert.deepEqual(pushes(w.calls), []);
  assert.ok(!w.calls.some(args => args[0] === 'merge'));
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
