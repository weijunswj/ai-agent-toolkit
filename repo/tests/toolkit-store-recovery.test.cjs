'use strict';

// toolkit store recovery, retries and resume: a failed or raced push never strands the store
// checkout. The next store step checks the kept commits again and pushes them, a lost race is
// retried with waits, and a push that landed is never sent twice. Each test is one or more rows of
// the closure matrix; the checks on kept commits are in toolkit-store-recovery-checks.test.cjs.
// Real Git against a local bare repository.
const assert = require('node:assert/strict');
const test = require('node:test');
const { git, commitIn, pushes, world, ahead, settled, keptSave, RAW_ADVICE } = require('./support/toolkit-store-world.cjs');

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
