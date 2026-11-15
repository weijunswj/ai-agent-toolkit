'use strict';

// Merge-train eject, after the eject: rejoining a later train, landing while the ejected pull
// request still points into the train, and a train that drops its bump. Split from
// toolkit-merge-train-eject.test.cjs so each file stays inside its CI time budget.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const { fixture, built } = require('./support/merge-train-fixture.cjs');

test('an ejected member rejoins a later train only once its branch restores the ejected change', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  assert.match(f.git('log', '-1', '--format=%B', ejected.reverts[1].commit), new RegExp(`^Train-Eject-Head: ${two}$`, 'm'));
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', 'toolkit-train/one');

  f.git('switch', '--quiet', 'pr-2');
  f.write('c2.txt', 'the review fix\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'fix only');
  const fixOnly = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  const later = (name, head) => {
    const file = path.join(f.root, `${name}.json`);
    const result = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, head)] }, `${name}-in.json`), '--branch', `toolkit-train/${name}`, '--main', 'main', '--out', file], f.repo, f.opts);
    return { result, file };
  };
  const refused = later('fix-only', fixOnly);
  assert.deepEqual(refused.result.boarded, []);
  assert.match(refused.result.ejected[0].reason, new RegExp(`without restoring it: on its branch merge main, then git revert --no-edit ${ejected.reverts[1].commit}`));
  f.git('switch', '--quiet', '-C', 'by-hand', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', fixOnly);
  const byHand = train.run(['verify', '--manifest', f.manifestFile({ members: [f.member(2, fixOnly, { bump: 'none' })], bump_command: 'none' }, 'by-hand.json'), '--head', 'by-hand', '--main', 'main'], f.repo, f.opts);
  assert.ok(byHand.problems.some(problem => /#2: it holds .* without restoring it/.test(problem)), byHand.problems.join('\n'));
  assert.equal(f.git('ls-tree', '--name-only', 'by-hand', 'c.txt'), '', 'the ejected change would silently stay reverted');

  f.git('switch', '--quiet', 'pr-2');
  f.git('merge', '--quiet', '--no-edit', 'main');
  f.git('revert', '--no-edit', ejected.reverts[1].commit);
  const restored = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  const rejoined = later('rejoined', restored);
  assert.deepEqual(rejoined.result.boarded, [2], JSON.stringify(rejoined.result.ejected));
  assert.equal(f.git('show', `${rejoined.result.head}:c.txt`), 'c', 'the ejected change is back');
  assert.equal(f.git('show', `${rejoined.result.head}:c2.txt`), 'the review fix');
  const checked = train.run(['verify', '--manifest', rejoined.file, '--head', rejoined.result.head, '--main', 'main'], f.repo, f.opts);
  assert.equal(checked.ok, true, checked.problems.join('\n'));
});

test('after an eject train lands, other pull requests made from main board and verify; only the ejected one is held', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  assert.match(f.git('log', '-1', '--format=%B', ejected.reverts[1].commit), /^Train-Eject-PR: #2$/m);
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', 'toolkit-train/one');
  const fresh = f.branch('pr-5', { 'e.txt': 'e\n' });
  f.git('switch', '--quiet', 'pr-1');
  f.git('merge', '--quiet', '--no-edit', 'main');
  f.write('b2.txt', 'more from 1\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'pr-1 follow-up on main');
  const mergedMain = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  const file = path.join(f.root, 'after.json');
  const result = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(5, fresh), f.member(1, mergedMain)] }, 'after-in.json'), '--branch', 'toolkit-train/after', '--main', 'main', '--out', file], f.repo, f.opts);
  assert.deepEqual(result.boarded, [5, 1], JSON.stringify(result.ejected));
  const checked = train.run(['verify', '--manifest', file, '--head', result.head, '--main', 'main'], f.repo, f.opts);
  assert.equal(checked.ok, true, checked.problems.join('\n'));
});

test('land refuses while the ejected pull request points at any commit the train holds', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  f.git('switch', '--quiet', '-c', 'pr-2', f.main);
  f.write('c.txt', 'c\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'first on pr-2');
  const early = f.git('rev-parse', 'HEAD');
  f.write('c2.txt', 'c2\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'second on pr-2');
  const two = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 70: { state: 'OPEN', head: ejected.head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: early } }));
  const refused = train.run(['land', '--manifest', out, '--pr', '70', '--head', ejected.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.ok(refused.problems.some(problem => new RegExp(`ejected #2 is still open at ${early.slice(0, 12)}, which the train carries`).test(problem)), refused.problems.join('\n'));
});

test('verify refuses a train that drops its bump, stacked or not, and land refuses a stacked train', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two, { bump: 'minor' })]);
  const noBump = f.git('rev-parse', `${result.head}~1`);
  const dropped = train.run(['verify', '--manifest', out, '--head', noBump, '--main', 'main'], f.repo, f.opts);
  assert.equal(dropped.ok, false);
  assert.ok(dropped.problems.some(problem => /the train has no bump commit/.test(problem)), dropped.problems.join('\n'));
  const quiet = path.join(f.root, 'quiet.json');
  fs.writeFileSync(quiet, JSON.stringify({ ...JSON.parse(fs.readFileSync(out, 'utf8')), members: [f.member(1, one, { bump: 'none' }), f.member(2, two, { bump: 'none' })] }));
  assert.equal(train.run(['verify', '--manifest', quiet, '--head', noBump, '--main', 'main'], f.repo, f.opts).ok, true, 'members that need no bump need no bump commit');
  const three = f.branch('pr-3', { 'd.txt': 'd\n' });
  const stackedOut = path.join(f.root, 'stacked.json');
  const stacked = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(3, three)] }, 'stacked-in.json'), '--branch', 'toolkit-train/next', '--main', 'main', '--onto', result.head, '--out', stackedOut], f.repo, f.opts);
  assert.equal(JSON.parse(fs.readFileSync(stackedOut, 'utf8')).stacked, true);
  const stackedCheck = train.run(['verify', '--manifest', stackedOut, '--head', stacked.head, '--main', result.head], f.repo, f.opts);
  assert.equal(stackedCheck.ok, false, 'a stacked train has no bump until catchup');
  assert.ok(stackedCheck.problems.some(problem => /the train has no bump commit: build it on main, or run catchup on a stacked train/.test(problem)), stackedCheck.problems.join('\n'));
  assert.throws(() => train.checkManifest({ members: [f.member(4, '4'.repeat(40))], stacked: 'yes' }), /"stacked" must be true or false/);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 80: { state: 'OPEN', head: stacked.head }, 3: { state: 'OPEN', head: three } }));
  const landing = train.run(['land', '--manifest', stackedOut, '--pr', '80', '--head', stacked.head, '--main', result.head, '--live', live], f.repo, f.opts);
  assert.equal(landing.ok, false, 'a stacked train never lands, even against the train it stacks on');
  assert.ok(landing.problems.some(problem => /the train is stacked .* catch it up on main first/.test(problem)), landing.problems.join('\n'));
  const flagged = path.join(f.root, 'flagged.json');
  fs.writeFileSync(flagged, JSON.stringify({ ...JSON.parse(fs.readFileSync(out, 'utf8')), stacked: true }));
  fs.writeFileSync(live, JSON.stringify({ 81: { state: 'OPEN', head: noBump }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } }));
  const dodged = train.run(['land', '--manifest', flagged, '--pr', '81', '--head', noBump, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(dodged.ok, false, 'marking a train on main stacked does not dodge its bump at land');
  assert.ok(dodged.problems.some(problem => /the train is stacked .* catch it up on main first/.test(problem)), dodged.problems.join('\n'));
  assert.ok(dodged.problems.some(problem => /the train has no bump commit/.test(problem)), dodged.problems.join('\n'));
});
