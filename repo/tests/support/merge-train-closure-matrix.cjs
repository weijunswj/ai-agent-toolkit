'use strict';

// The merge-train closure matrix, shared by the two closure test files (split so each stays inside
// its CI time budget). Merge-train closure matrix: no order of eject, catchup, solo landing or identical change lets a
// train land a tree that undoes work already on main. Landing equivalence (the train's tree equals
// a fresh build of its current members on main) refuses every row marked R; rows marked OK must
// pass, so the check never refuses a sound train. The guarantee is for a merge onto the main the
// check saw: row 17 shows why governed repositories require branches to be up to date. Rows run
// elsewhere name their test; side-by-side rows wait for side-by-side trains.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const train = require('../../scripts/toolkit-merge-train.cjs');
const { built } = require('./merge-train-fixture.cjs');

const UNEQUAL = /differs from a fresh build of its members on main/;

// A commit on a new branch made from `from`, with `files` written; returns its SHA.
function commitOn(f, name, from, files) {
  f.git('switch', '--quiet', '-C', name, from);
  for (const [rel, text] of Object.entries(files)) f.write(rel, text);
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', `work on ${name}`);
  const head = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  return head;
}

// Merges `ref` into main the way GitHub lands a pull request (a merge commit), then returns to `back`.
function landOnMain(f, ref, back) {
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', ref);
  if (back) f.git('switch', '--quiet', back);
}

const exists = (f, ref, file) => spawnSync('git', ['cat-file', '-e', `${ref}:${file}`], { cwd: f.repo }).status === 0;

// Running train A (#1) on main, and train B stacked on it holding #2 = X (two commits, x1 then x2)
// and #3 = Z. Returns the commits and B's manifest file; the checkout is left on B.
function stackedPair(f) {
  const a = f.branch('pr-1', { 'a1.txt': 'a1\n' });
  const x1 = commitOn(f, 'pr-2', f.main, { 'x1.txt': 'x1\n' });
  const x2 = commitOn(f, 'pr-2', x1, { 'x2.txt': 'x2\n' });
  const z = f.branch('pr-3', { 'z.txt': 'z\n' });
  const first = built(f, [f.member(1, a)]);
  const out = path.join(f.root, 'stacked.json');
  const stacked = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, x2), f.member(3, z)] }, 'stacked-in.json'),
    '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo, f.opts);
  assert.deepEqual(stacked.boarded, [2, 3], JSON.stringify(stacked.ejected));
  return { a, x1, x2, z, runningHead: first.result.head, out };
}

const run = (f, ...args) => train.run(args, f.repo, f.opts);
const eject = (f, out, main) => run(f, 'eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', main);
const catchup = (f, out) => run(f, 'catchup', '--manifest', out, '--main', 'main');
const verify = (f, out, head = 'toolkit-train/two') => run(f, 'verify', '--manifest', out, '--head', head, '--main', 'main');

// A command that refuses must leave the train branch and its manifest exactly as they were.
function assertRefusedInPlace(f, result, out, before) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.problems.some(problem => UNEQUAL.test(problem)), result.problems.join('\n'));
  assert.equal(f.git('rev-parse', 'HEAD'), before.head, 'the train head is unchanged');
  assert.equal(f.git('status', '--porcelain'), '', 'the checkout is clean');
  assert.equal(fs.readFileSync(out, 'utf8'), before.manifest, 'the manifest is unchanged');
}

const snapshot = (f, out) => ({ head: f.git('rev-parse', 'HEAD'), manifest: fs.readFileSync(out, 'utf8') });

// Kind: S = stacked train (runs today), P = trains side by side (later). Expect: R = refused, OK = lands.
const MATRIX = [
  { row: 1, kind: 'P, S', expect: 'OK', sequence: 'build, verify, land', elsewhere: ['toolkit-merge-train.test.cjs', 'a clean train boards each member at its reviewed head, bumps once at the highest level and verifies'] },
  { row: 2, kind: 'S', expect: 'OK', sequence: 'A lands, B catches up and lands', elsewhere: ['toolkit-merge-train.test.cjs', 'once the running train lands, catchup merges main into the stacked train, adds the bump and it lands'] },
  { row: 3, kind: 'P', expect: 'OK', sequence: 'T2 lands, T1 catches up over its replaced bump, lands', later: 'side-by-side trains' },
  { row: 4, kind: 'S', expect: 'OK', sequence: 'eject X (nothing of X on main), catch up, land', elsewhere: ['toolkit-merge-train-eject.test.cjs', 'a stacked train ejects with one revert, and land waits until the ejected pull request moves on'] },
  {
    row: 5, kind: 'S', expect: 'R', sequence: 'X lands alone at its head; catch up; eject X: eject refuses, and the same eject made by hand fails verify',
    run(f) {
      const { x2, runningHead, out } = stackedPair(f);
      landOnMain(f, runningHead);
      landOnMain(f, x2, 'toolkit-train/two');
      const caught = catchup(f, out);
      assert.equal(caught.ok, true);
      const before = snapshot(f, out);
      assertRefusedInPlace(f, eject(f, out, 'main'), out, before);
      // The same eject made without the self-check (as eject did before it, or by hand) fails verify,
      // so land refuses it too.
      const board = f.git('log', '--first-parent', '--format=%H', '--grep', '^Merge train: board #2 ', 'main..HEAD');
      f.git('revert', '--no-edit', caught.bump);
      const bumpRevert = f.git('rev-parse', 'HEAD');
      f.git('revert', '--no-edit', '-m', '1', board);
      const boardRevert = f.git('rev-parse', 'HEAD');
      assert.equal(spawnSync(process.execPath, ['scripts/bump.cjs', 'patch', f.git('rev-parse', 'main')], { cwd: f.repo }).status, 0);
      f.git('commit', '--quiet', '-am', 'Merge train: bump patch for #3');
      const manifest = JSON.parse(before.manifest);
      const byHand = f.manifestFile({ ...manifest, members: manifest.members.filter(member => member.pr !== 2),
        ejected: [{ pr: 2, head: x2, bump: 'patch', reason: 'by hand', merge: board, reverts: [{ commit: bumpRevert, of: caught.bump }, { commit: boardRevert, of: board }] }] }, 'by-hand.json');
      const checked = verify(f, byHand);
      assert.equal(checked.ok, false);
      assert.deepEqual(checked.problems.filter(problem => !UNEQUAL.test(problem)), [], 'only landing equivalence catches it');
      assert.match(checked.problems.join('\n'), /\(x1\.txt, x2\.txt\)/, 'it names the files the landing would delete');
    },
  },
  {
    row: 6, kind: 'S', expect: 'R', sequence: 'eject X; X lands alone at the same head; catch up: catchup refuses',
    run(f) {
      const { x2, runningHead, out } = stackedPair(f);
      assert.equal(eject(f, out, runningHead).ok, true);
      landOnMain(f, runningHead);
      landOnMain(f, x2, 'toolkit-train/two');
      const before = snapshot(f, out);
      assertRefusedInPlace(f, catchup(f, out), out, before);
    },
  },
  {
    row: 7, kind: 'S', expect: 'R', sequence: 'eject X; X moves its head and lands alone; catch up: catchup refuses',
    run(f) {
      const { x2, runningHead, out } = stackedPair(f);
      assert.equal(eject(f, out, runningHead).ok, true);
      const moved = commitOn(f, 'pr-2-moved', x2, { 'x3.txt': 'x3\n' });
      landOnMain(f, runningHead);
      landOnMain(f, moved, 'toolkit-train/two');
      const before = snapshot(f, out);
      assertRefusedInPlace(f, catchup(f, out), out, before);
    },
  },
  { row: 8, kind: 'P', expect: 'R', sequence: 'eject X from T1; X rides T2, which lands first', later: 'side-by-side trains' },
  {
    row: 9, kind: 'S', expect: 'R', sequence: 'eject X; a pull request built on X\'s earlier commit lands; catch up: catchup refuses',
    run(f) {
      const { x1, runningHead, out } = stackedPair(f);
      assert.equal(eject(f, out, runningHead).ok, true);
      const w = commitOn(f, 'pr-4', x1, { 'w.txt': 'w\n' });
      landOnMain(f, runningHead);
      landOnMain(f, w, 'toolkit-train/two');
      const before = snapshot(f, out);
      assertRefusedInPlace(f, catchup(f, out), out, before);
    },
  },
  {
    row: 10, kind: 'S (P later)', expect: 'R', sequence: 'a pull request built on X\'s earlier commit lands; catch up; eject X: eject refuses',
    run(f) {
      const { x1, runningHead, out } = stackedPair(f);
      const w = commitOn(f, 'pr-4', x1, { 'w.txt': 'w\n' });
      landOnMain(f, runningHead);
      landOnMain(f, w, 'toolkit-train/two');
      assert.equal(catchup(f, out).ok, true);
      const before = snapshot(f, out);
      assertRefusedInPlace(f, eject(f, out, 'main'), out, before);
      assert.ok(exists(f, 'main', 'x1.txt'), 'the change stays on main');
    },
  },
  {
    row: 11, kind: 'S', expect: 'R', sequence: 'an identical change lands through another pull request; catch up; eject X: eject refuses',
    run(f) {
      const { runningHead, out } = stackedPair(f);
      const twin = commitOn(f, 'pr-5', f.main, { 'x1.txt': 'x1\n' });
      landOnMain(f, runningHead);
      landOnMain(f, twin, 'toolkit-train/two');
      assert.equal(catchup(f, out).ok, true);
      const before = snapshot(f, out);
      assertRefusedInPlace(f, eject(f, out, 'main'), out, before);
    },
  },
  {
    row: 12, kind: 'S', expect: 'OK', sequence: 'eject X; an identical change lands through another pull request; catch up, verify, land: the change stays',
    run(f) {
      const { x2, z, runningHead, out } = stackedPair(f);
      assert.equal(eject(f, out, runningHead).ok, true);
      const twin = commitOn(f, 'pr-5', f.main, { 'x1.txt': 'x1\n' });
      landOnMain(f, runningHead);
      landOnMain(f, twin, 'toolkit-train/two');
      const caught = catchup(f, out);
      assert.equal(caught.ok, true, JSON.stringify(caught));
      const checked = verify(f, out);
      assert.equal(checked.ok, true, checked.problems.join('\n'));
      const live = path.join(f.root, 'live.json');
      fs.writeFileSync(live, JSON.stringify({ 9: { state: 'OPEN', head: caught.head }, 2: { state: 'CLOSED', head: x2 }, 3: { state: 'OPEN', head: z } }));
      const landing = run(f, 'land', '--manifest', out, '--pr', '9', '--head', caught.head, '--main', 'main', '--live', live);
      assert.equal(landing.ok, true, landing.problems.join('\n'));
      landOnMain(f, caught.head);
      assert.equal(f.git('show', 'main:x1.txt'), 'x1', 'the other pull request\'s change stays on main');
      assert.ok(exists(f, 'main', 'z.txt') && !exists(f, 'main', 'x2.txt'), 'Z lands, ejected X does not');
    },
  },
  {
    row: 13, kind: 'P, S', expect: 'R', sequence: 'member W built on X\'s earlier commit stays on board; eject X: eject refuses',
    run(f) {
      const x1 = commitOn(f, 'pr-2', f.main, { 'x1.txt': 'x1\n' });
      const x2 = commitOn(f, 'pr-2', x1, { 'x2.txt': 'x2\n' });
      const w = commitOn(f, 'pr-4', x1, { 'w.txt': 'w\n' });
      const { out } = built(f, [f.member(2, x2), f.member(4, w)]);
      const before = snapshot(f, out);
      assertRefusedInPlace(f, run(f, 'eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'), out, before);
    },
  },
  { row: 14, kind: 'P, S', expect: 'R', sequence: 'main moved since the last bump, no catch-up', elsewhere: ['toolkit-merge-train.test.cjs', 'land checks live heads, main and RISKY owner OKs before it names the one merge'] },
  {
    row: 15, kind: 'P, S', expect: 'OK', sequence: 'a member already on main at build is dropped; the rest verify and land',
    run(f) {
      const landed = f.branch('pr-2', { 'x1.txt': 'x1\n' });
      const z = f.branch('pr-3', { 'z.txt': 'z\n' });
      landOnMain(f, landed);
      const { result, out } = built(f, [f.member(2, landed), f.member(3, z)]);
      assert.deepEqual(result.boarded, [3]);
      assert.equal(result.ejected[0].reason, 'already on the train base');
      const checked = verify(f, out, result.head);
      assert.equal(checked.ok, true, checked.problems.join('\n'));
      landOnMain(f, result.head);
      assert.ok(exists(f, 'main', 'x1.txt') && exists(f, 'main', 'z.txt'));
    },
  },
  {
    row: 16, kind: 'P, S', expect: 'R', sequence: 'a member does not merge cleanly onto today\'s main: verify names it',
    // The hand-resolved merge was already refused before landing equivalence; this row proves the
    // fresh build names the member, not a new refusal.
    run(f) {
      const x = f.branch('pr-2', { 'a.txt': 'one\nTWO from 2\nthree\n' });
      f.write('a.txt', 'one\nTWO on main\nthree\n');
      f.git('commit', '--quiet', '-am', 'main changes the same line');
      f.git('switch', '--quiet', '-c', 'by-hand', 'main');
      assert.notEqual(spawnSync('git', ['merge', '--no-ff', '--no-edit', x], { cwd: f.repo }).status, 0);
      f.write('a.txt', 'one\nTWO from 2\nthree\n');
      f.git('commit', '--quiet', '-am', 'hand-resolved');
      const manifest = f.manifestFile({ bump_command: 'none', members: [f.member(2, x, { bump: 'none' })] }, 'by-hand.json');
      const checked = run(f, 'verify', '--manifest', manifest, '--head', 'by-hand', '--main', 'main');
      assert.ok(checked.problems.some(problem => /a fresh build of the members on main fails \(#2 does not merge cleanly onto main\): rebuild the train on main/.test(problem)), checked.problems.join('\n'));
    },
  },
  {
    row: 17, kind: 'P, S', expect: 'R', sequence: 'eject X; land passes; a pull request built on X\'s earlier commit lands before the merge: land refuses, and only an up-to-date merge is safe',
    run(f) {
      const x1 = commitOn(f, 'pr-2', f.main, { 'x1.txt': 'x1\n' });
      const x2 = commitOn(f, 'pr-2', x1, { 'x2.txt': 'x2\n' });
      const z = f.branch('pr-3', { 'z.txt': 'z\n' });
      const { out } = built(f, [f.member(2, x2), f.member(3, z)]);
      const ejected = run(f, 'eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main');
      assert.equal(ejected.ok, true, JSON.stringify(ejected));
      const live = path.join(f.root, 'live.json');
      fs.writeFileSync(live, JSON.stringify({ 9: { state: 'OPEN', head: ejected.head }, 2: { state: 'CLOSED', head: x2 }, 3: { state: 'OPEN', head: z } }));
      const land = () => run(f, 'land', '--manifest', out, '--pr', '9', '--head', ejected.head, '--main', 'main', '--live', live);
      assert.equal(land().ok, true, 'the train is sound for the main land checked');
      landOnMain(f, commitOn(f, 'pr-4', x1, { 'w.txt': 'w\n' }));
      const late = land();
      assert.equal(late.ok, false);
      assert.ok(late.problems.some(problem => /main moved since the train was built/.test(problem)), late.problems.join('\n'));
      // What GitHub's up-to-date rule checks: main is no longer inside the train head, so the merge is
      // refused. Merged anyway, the eject revert would delete the change that just reached main.
      assert.notEqual(spawnSync('git', ['merge-base', '--is-ancestor', 'main', ejected.head], { cwd: f.repo }).status, 0);
      landOnMain(f, ejected.head);
      assert.equal(exists(f, 'main', 'x1.txt'), false, 'without the up-to-date rule the landing deletes x1');
    },
  },
  {
    row: 18, kind: 'S', expect: 'OK', sequence: 'main moves past the running train; eject from the stacked train with that main; catch up, verify: no false refusal',
    run(f) {
      const { runningHead, out } = stackedPair(f);
      landOnMain(f, runningHead);
      landOnMain(f, f.branch('pr-6', { 'q.txt': 'q\n' }), 'toolkit-train/two');
      const ejected = eject(f, out, 'main');
      assert.equal(ejected.ok, true, JSON.stringify(ejected));
      assert.equal(catchup(f, out).ok, true);
      const checked = verify(f, out);
      assert.equal(checked.ok, true, checked.problems.join('\n'));
      assert.ok(exists(f, 'toolkit-train/two', 'q.txt') && exists(f, 'toolkit-train/two', 'z.txt') && !exists(f, 'toolkit-train/two', 'x2.txt'));
    },
  },
];

module.exports = { MATRIX };
