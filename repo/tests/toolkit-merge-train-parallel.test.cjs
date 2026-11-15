'use strict';

// Trains side by side: two trains built on main, each on its own branch, so a held train never
// blocks the next. When one lands, catchup on the other takes its bump back with a recorded revert,
// merges main and bumps again from main's new version; verify accepts exactly that.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const { fixture } = require('./support/merge-train-fixture.cjs');

// Two independent trains on main: #1 on toolkit-train/one (patch), #2 on toolkit-train/two (minor).
function twoTrains(t) {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const firstOut = path.join(f.root, 'first.json');
  const first = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)] }, 'first-in.json'), '--branch', 'toolkit-train/one', '--main', 'main', '--out', firstOut], f.repo, f.opts);
  const secondOut = path.join(f.root, 'second.json');
  const second = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two, { bump: 'minor' })] }, 'second-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--out', secondOut], f.repo, f.opts);
  assert.equal(first.ok && second.ok, true);
  assert.equal(second.stacked, false, 'the second train is built on main, not stacked');
  assert.ok(first.bump && second.bump, 'each carries its own bump');
  return { f, one, two, first, firstOut, second, secondOut };
}

function land(f, head) {
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', head);
  return f.git('rev-parse', 'HEAD');
}

test('two trains run side by side: whichever lands first, the other catches up by replacing its bump and lands', t => {
  const { f, two, second, secondOut, first } = twoTrains(t);
  // The second train lands first while the first is held.
  land(f, second.head);
  assert.equal(f.git('show', 'main:VERSION'), '1.1.0');
  f.git('switch', '--quiet', 'toolkit-train/one');
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'first.json'), 'utf8'));
  // Before catchup, land refuses: main moved.
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 9: { state: 'OPEN', head: first.head }, 1: { state: 'OPEN', head: manifest.members[0].head } }));
  const early = train.run(['land', '--manifest', path.join(f.root, 'first.json'), '--pr', '9', '--head', first.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(early.ok, false);
  assert.ok(early.problems.some(problem => /main moved since the train was built: run catchup/.test(problem)), early.problems.join('\n'));

  const caught = train.catchup(f.repo, manifest, { main: 'main', out: path.join(f.root, 'first.json') });
  assert.equal(caught.ok, true, JSON.stringify(caught));
  assert.deepEqual(caught.replaced, { bump: first.bump, revert: f.git('rev-parse', 'HEAD~2') });
  assert.equal(f.git('show', `${caught.head}:VERSION`), '1.1.1', 'the new bump counts from the landed train\'s version');
  assert.equal(f.git('show', `${caught.head}:BUMP-BASE`), f.git('rev-parse', 'main'));
  assert.equal(f.git('status', '--porcelain'), '');
  const recorded = JSON.parse(fs.readFileSync(path.join(f.root, 'first.json'), 'utf8'));
  assert.deepEqual(recorded.replaced_bumps, [caught.replaced]);

  const checked = train.run(['verify', '--manifest', path.join(f.root, 'first.json'), '--head', 'toolkit-train/one', '--main', 'main'], f.repo, f.opts);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  fs.writeFileSync(live, JSON.stringify({ 9: { state: 'OPEN', head: caught.head }, 1: { state: 'OPEN', head: manifest.members[0].head } }));
  const landing = train.run(['land', '--manifest', path.join(f.root, 'first.json'), '--pr', '9', '--head', caught.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(landing.ok, true, JSON.stringify(landing));
  assert.equal(JSON.parse(fs.readFileSync(secondOut, 'utf8')).members[0].head, two);
  // Landed, main holds the train, and catchup has nothing to do.
  land(f, caught.head);
  f.git('switch', '--quiet', 'toolkit-train/one');
  assert.throws(() => train.catchup(f.repo, recorded, { main: 'main' }), /the train has already landed/);
});

test('a held train catches up twice, and verify needs every replaced bump recorded and present', t => {
  const { f, second, firstOut, first } = twoTrains(t);
  land(f, second.head);
  f.git('switch', '--quiet', 'toolkit-train/one');
  const once = train.catchup(f.repo, JSON.parse(fs.readFileSync(firstOut, 'utf8')), { main: 'main', out: firstOut });
  assert.equal(once.ok, true, JSON.stringify(once));
  // Main moves again before the held train lands.
  f.git('switch', '--quiet', 'main');
  f.write('e.txt', 'e\n');
  f.git('add', 'e.txt');
  f.git('commit', '--quiet', '-m', 'main moves again');
  f.git('switch', '--quiet', 'toolkit-train/one');
  const twice = train.catchup(f.repo, JSON.parse(fs.readFileSync(firstOut, 'utf8')), { main: 'main', out: firstOut });
  assert.equal(twice.ok, true, JSON.stringify(twice));
  const manifest = JSON.parse(fs.readFileSync(firstOut, 'utf8'));
  assert.deepEqual(manifest.replaced_bumps.map(entry => entry.bump), [first.bump, once.bump]);
  assert.equal(f.git('show', `${twice.head}:VERSION`), '1.1.1');
  const verify = value => train.verify(f.repo, value, { main: 'main', head: 'toolkit-train/one' });
  assert.equal(verify(manifest).ok, true, JSON.stringify(verify(manifest)));

  // An unrecorded bump revert is a commit of its own; a recorded one that is not on the train fails.
  const unrecorded = verify({ ...manifest, replaced_bumps: manifest.replaced_bumps.slice(1) });
  assert.equal(unrecorded.ok, false);
  assert.ok(unrecorded.problems.some(problem => /commit of its own inside the train|differs from a fresh run of the bump command/.test(problem)), unrecorded.problems.join('\n'));
  const ghost = verify({ ...manifest, replaced_bumps: [...manifest.replaced_bumps, { bump: f.main, revert: second.head }] });
  assert.equal(ghost.ok, false);
  assert.ok(ghost.problems.some(problem => /its recorded revert .* is not on the train/.test(problem)), ghost.problems.join('\n'));
  // A replaced-bump record cannot cover a member's boarding merge.
  const boarding = f.git('rev-parse', `${first.head}~1`);
  const disguised = verify({ ...manifest, replaced_bumps: [{ bump: boarding, revert: manifest.replaced_bumps[0].revert }, manifest.replaced_bumps[1]] });
  assert.equal(disguised.ok, false);
});

test('the manifest refuses a malformed or doubled replaced bump, and a stacked train never reverts a bump', t => {
  const { f, firstOut } = twoTrains(t);
  const manifest = JSON.parse(fs.readFileSync(firstOut, 'utf8'));
  const sha = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  for (const [replaced, pattern] of [
    ['x', /"replaced_bumps" must be a list/],
    [[{ bump: 'short', revert: sha }], /needs "bump" and "revert" as full SHAs/],
    [[{ bump: sha, revert: other }, { bump: sha, revert: 'c'.repeat(40) }], /recorded twice/],
  ]) {
    assert.throws(() => train.checkManifest({ ...manifest, replaced_bumps: replaced }), pattern);
  }
  f.git('switch', '--quiet', 'toolkit-train/one');
  f.git('switch', '--quiet', 'main');
  f.write('e.txt', 'e\n');
  f.git('add', 'e.txt');
  f.git('commit', '--quiet', '-m', 'main moves');
  f.git('switch', '--quiet', 'toolkit-train/one');
  const before = f.git('rev-parse', 'HEAD');
  assert.throws(() => train.catchup(f.repo, { ...manifest, stacked: true }, { main: 'main' }), /stacked train takes no bump until catchup/);
  assert.equal(f.git('rev-parse', 'HEAD'), before, 'nothing changed');
});

test('a catch-up whose main clashes leaves the bumped train exactly as it was', t => {
  const { f, firstOut } = twoTrains(t);
  f.git('switch', '--quiet', 'main');
  f.write('b.txt', 'clash\n');
  f.git('add', 'b.txt');
  f.git('commit', '--quiet', '-m', 'main changes the same file');
  f.git('switch', '--quiet', 'toolkit-train/one');
  const before = f.git('rev-parse', 'HEAD');
  const result = train.catchup(f.repo, JSON.parse(fs.readFileSync(firstOut, 'utf8')), { main: 'main', out: firstOut });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /does not merge cleanly/);
  assert.equal(f.git('rev-parse', 'HEAD'), before, 'the bump revert is undone too');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(JSON.parse(fs.readFileSync(firstOut, 'utf8')).replaced_bumps, undefined, 'nothing recorded');
});
