'use strict';

// Merge-train eject: taking a boarded member off a pushed train with recorded reverts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const train = require('../scripts/toolkit-merge-train.cjs');
const { fixture, built } = require('./support/merge-train-fixture.cjs');

test('eject takes a boarded member off a bumped train with reverts on top, re-bumps without it and verifies', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const three = f.branch('pr-3', { 'd.txt': 'd\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two, { bump: 'minor' }), f.member(3, three)]);
  assert.equal(f.git('show', `${result.head}:VERSION`), '1.1.0');
  const cli = f.cli('eject', '--manifest', out, '--pr', '2', '--reason', 'failed its review after boarding', '--main', 'main');
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  const ejected = JSON.parse(cli.stdout);
  assert.deepEqual(ejected.members, [1, 3]);
  assert.equal(ejected.reverts.length, 2, 'the old bump, then the boarding merge');
  assert.equal(ejected.reverts[0].of, result.bump);
  assert.ok(ejected.bump, 'a fresh bump for the members left');
  assert.match(ejected.rejoin, new RegExp(`git revert --no-edit ${ejected.reverts[1].commit}`));
  assert.ok(spawnSync('git', ['merge-base', '--is-ancestor', result.head, ejected.head], { cwd: f.repo }).status === 0, 'the old train head stays in history: no rewrite');
  assert.equal(f.git('rev-parse', 'toolkit-train/one'), ejected.head, 'the same branch moves forward');
  assert.equal(f.git('show', `${ejected.head}:VERSION`), '1.0.1', 'bumped at the level of the members left');
  assert.equal(spawnSync('git', ['cat-file', '-e', `${ejected.head}:c.txt`], { cwd: f.repo }).status !== 0, true, 'the ejected change is gone');
  assert.equal(f.git('show', `${ejected.head}:d.txt`), 'd');
  assert.equal(f.git('status', '--porcelain'), '');
  const record = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(record.members.map(member => member.pr), [1, 3]);
  assert.deepEqual(record.ejected, [{ pr: 2, head: two, bump: 'minor', reason: 'failed its review after boarding', merge: f.git('rev-parse', `${result.head}~2`), reverts: ejected.reverts }]);
  const verified = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo, f.opts);
  assert.equal(verified.ok, true, verified.problems.join('\n'));
  assert.match(train.body(train.checkManifest(record)), /^Ejected: #2 at `[0-9a-f]{12}` \(failed its review after boarding\); its boarding is reverted by `[0-9a-f]{12}`, so it does not land with this train\.$/m);

  const again = train.run(['eject', '--manifest', out, '--pr', '3', '--reason', 'second thoughts', '--main', 'main'], f.repo, f.opts);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.reverts[0].of, ejected.bump, 'a second eject replaces the re-bump');
  const twice = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo, f.opts);
  assert.equal(twice.ok, true, twice.problems.join('\n'));
  assert.throws(() => train.run(['eject', '--manifest', out, '--pr', '1', '--reason', 'last', '--main', 'main'], f.repo, f.opts), /last member: close the train pull request instead/);
});

test('verify accepts only the recorded reverts, each identical to Git\'s own revert', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const before = JSON.parse(fs.readFileSync(out, 'utf8'));
  const result = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  assert.equal(result.ok, true, JSON.stringify(result));
  const record = JSON.parse(fs.readFileSync(out, 'utf8'));
  const check = (value, head = 'toolkit-train/one') => {
    const file = path.join(f.root, 'check.json');
    fs.writeFileSync(file, JSON.stringify(value));
    return train.run(['verify', '--manifest', file, '--head', head, '--main', 'main'], f.repo, f.opts);
  };
  let refused = check(before);
  assert.ok(refused.problems.some(problem => /a commit of its own inside the train/.test(problem)), 'an unrecorded revert is refused: ' + refused.problems.join('\n'));

  const unrecorded = structuredClone(record);
  unrecorded.ejected[0].reverts = unrecorded.ejected[0].reverts.filter(revert => revert.of === record.ejected[0].merge);
  refused = check(unrecorded);
  assert.ok(refused.problems.some(problem => /a commit of its own inside the train/.test(problem)), refused.problems.join('\n'));

  const boardRevert = record.ejected[0].reverts.find(revert => revert.of === record.ejected[0].merge).commit;
  f.git('switch', '--quiet', '-C', 'edited-revert', `${boardRevert}~1`);
  f.git('revert', '--no-commit', '-m', '1', record.ejected[0].merge);
  f.write('sneak.txt', 'smuggled inside a revert\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'edited revert');
  const edited = structuredClone(record);
  edited.ejected[0].reverts = [{ commit: f.git('rev-parse', 'HEAD'), of: record.ejected[0].merge }];
  refused = check(edited, 'edited-revert');
  assert.ok(refused.problems.some(problem => /differs from Git's own revert/.test(problem)), refused.problems.join('\n'));

  const missing = structuredClone(record);
  missing.ejected[0].reverts.push({ commit: 'e'.repeat(40), of: 'f'.repeat(40) });
  refused = check(missing);
  assert.ok(refused.problems.some(problem => /recorded revert eeeeeeeeeeee is not on the train/.test(problem)), refused.problems.join('\n'));

  assert.throws(() => train.checkManifest({ ...record, members: [...record.members, f.member(2, 'a'.repeat(40))] }), /rejoins only a later train/);
  assert.throws(() => train.checkManifest({ ...record, ejected: [{ ...record.ejected[0], reverts: record.ejected[0].reverts.filter(revert => revert.of !== record.ejected[0].merge) }] }), /no recorded revert undoes its boarding merge/);
});

test('eject refuses a member a later member builds on and leaves the train as it was', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b from 1\n' });
  f.git('switch', '--quiet', '-c', 'pr-2', one);
  f.write('b.txt', 'b from 1, changed by 2\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'work on pr-2');
  const two = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  const { result, out } = built(f, [f.member(1, one), f.member(2, two)]);
  const before = fs.readFileSync(out, 'utf8');
  const refused = train.run(['eject', '--manifest', out, '--pr', '1', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  assert.equal(refused.ok, false);
  assert.match(refused.problems[0], /^#2 is built on #1: a later member builds on it, so eject that member first$/);
  assert.equal(f.git('rev-parse', 'HEAD'), result.head);
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'the manifest is unchanged');
});

test('a stacked train ejects with one revert, and land waits until the ejected pull request moves on', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const three = f.branch('pr-3', { 'd.txt': 'd\n' });
  const first = built(f, [f.member(1, one)]);
  const out = path.join(f.root, 'stacked.json');
  const stacked = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two), f.member(3, three)] }, 'stacked-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo, f.opts);
  const result = train.run(['eject', '--manifest', out, '--pr', '3', '--reason', 'failed review', '--main', first.result.head], f.repo, f.opts);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reverts.length, 1, 'no bump to replace on a stacked train');
  assert.equal(result.bump, null);
  assert.ok(stacked.head);

  const solo = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', solo.out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  const live = path.join(f.root, 'live.json');
  const facts = { 60: { state: 'OPEN', head: ejected.head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } };
  fs.writeFileSync(live, JSON.stringify(facts));
  const waiting = train.run(['land', '--manifest', solo.out, '--pr', '60', '--head', ejected.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(waiting.ok, false);
  assert.ok(waiting.problems.some(problem => /ejected #2 is still open at .* GitHub would mark it merged/.test(problem)), waiting.problems.join('\n'));
  fs.writeFileSync(live, JSON.stringify({ ...facts, 2: { state: 'OPEN', head: 'f'.repeat(40) } }));
  const ready = train.run(['land', '--manifest', solo.out, '--pr', '60', '--head', ejected.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(ready.ok, true, ready.problems.join('\n'));
  fs.writeFileSync(live, JSON.stringify({ ...facts, 2: { state: 'CLOSED', head: two } }));
  assert.equal(train.run(['land', '--manifest', solo.out, '--pr', '60', '--head', ejected.head, '--main', 'main', '--live', live], f.repo, f.opts).ok, true);

  // Once the running train lands, the stacked train catches up even though its head is an eject revert.
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', first.result.head);
  f.git('switch', '--quiet', 'toolkit-train/two');
  const caught = train.run(['catchup', '--manifest', out, '--main', 'main'], f.repo, f.opts);
  assert.equal(caught.ok, true, JSON.stringify(caught));
  assert.ok(caught.bump, 'the bump comes after the catch-up merge');
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).stacked, undefined, 'catchup drops the stacked mark');
  const checked = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/two', '--main', 'main'], f.repo, f.opts);
  assert.equal(checked.ok, true, checked.problems.join('\n'));
  assert.equal(f.git('show', `${caught.head}:c.txt`), 'c');
  assert.equal(spawnSync('git', ['cat-file', '-e', `${caught.head}:d.txt`], { cwd: f.repo }).status !== 0, true, 'the ejected member stays out');
});

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

test('eject refuses a member that a later member is built on even when they touch different files, and verify refuses such a train', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b from 1\n' });
  f.git('switch', '--quiet', '-c', 'pr-2', one);
  f.write('c.txt', 'c from 2, built on 1\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'work on pr-2');
  const two = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  const three = f.branch('pr-3', { 'd.txt': 'd\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two), f.member(3, three)]);
  const refused = train.run(['eject', '--manifest', out, '--pr', '1', '--reason', 'failed review', '--main', 'main'], f.repo, f.opts);
  assert.equal(refused.ok, false);
  assert.match(refused.problems[0], /^#2 is built on #1: a later member builds on it, so eject that member first$/);
  assert.equal(f.git('rev-parse', 'HEAD'), result.head);

  // A train put together by hand with #1 reverted under #2 does not verify.
  f.git('switch', '--quiet', '-C', 'by-hand', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', one);
  const board = f.git('rev-parse', 'HEAD');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', two);
  f.git('revert', '--no-edit', '-m', '1', board);
  const manifest = f.manifestFile({ bump_command: 'none', members: [f.member(2, two, { bump: 'none' })], ejected: [{ pr: 1, head: one, bump: 'patch', reason: 'by hand', merge: board, reverts: [{ commit: f.git('rev-parse', 'HEAD'), of: board }] }] }, 'by-hand.json');
  const checked = train.run(['verify', '--manifest', manifest, '--head', 'by-hand', '--main', 'main'], f.repo, f.opts);
  assert.ok(checked.problems.some(problem => /#2 is built on ejected #1: it cannot land without the change it was reviewed on/.test(problem)), checked.problems.join('\n'));
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
