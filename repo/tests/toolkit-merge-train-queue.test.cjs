'use strict';

// Merge trains form a queue (the owner's design, 27 November 2026). While anything is landing (main's
// required checks running after a merge, or an open train), a pull request that becomes ready never
// waits alone: it joins the last train in the queue while that train takes joiners (behind another
// train, or at the front while main's checks run), else it starts the next train behind it; a joiner
// that conflicts is dropped and boards the next train only after that train lands and its builder's
// resolution on top of main passes a delta review (INT-TK421-1388); the front train lands only once main's
// checks are done. Red on the parent: find stacked every ready pull request into a new train, there
// was no join, land never looked at main's checks, and build left the caller's checkout on the train.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const { fixture, built } = require('./support/merge-train-fixture.cjs');

const at = minutes => new Date(Date.UTC(2026, 10, 27, 0, minutes)).toISOString();
const G2_STAMP = 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus';
const G1_STAMP = 'Route: host-verified opus-5.5/high pin=owner-claude/BUILDER';
const green = [{ id: 1, name: 'validate', status: 'completed', conclusion: 'success' }];
const running = [{ id: 9, name: 'validate', status: 'in_progress', conclusion: null }];

// find's --live facts: ready pull requests at their real heads, and any open train pull requests.
function facts(f, { ready = [], trains = [], main = [], committedAt = undefined }) {
  const pulls = ready.map(([number, head]) => ({ number, draft: false, base: { ref: 'main' }, head: { sha: head }, body: `Change ${number}.\n\n${G1_STAMP}\nBump: patch\nUAT: NOT_REQUIRED (internal)\n\nRefs #${number + 100}` }));
  for (const entry of trains) {
    const table = entry.members.map(([pr, sha]) => `| #${pr} | \`${sha}\` | NORMAL | patch | x |`).join('\n');
    pulls.push({ number: entry.pr, draft: false, base: { ref: entry.base || 'main' }, head: { ref: entry.branch, sha: entry.head, repo: { full_name: 'example/repo' } }, body: `## Merge train\n\n| Member | Reviewed head | Tier | Bump | Review |\n|---|---|---|---|---|\n${table}\n` });
  }
  const file = path.join(f.root, `facts-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({
    default_branch: 'main', pulls, main_checks: main, ...(committedAt ? { main_committed_at: committedAt } : {}),
    comments: Object.fromEntries(ready.map(([number, head]) => [number, [{ body: `Toolkit-G2: PASS ${head} tier=NORMAL\n${G2_STAMP}`, author_association: 'OWNER', created_at: at(1) }]])),
    checks: Object.fromEntries(ready.map(([, head]) => [head, green])),
    files: Object.fromEntries(ready.map(([number]) => [number, [`f${number}.txt`]])),
  }));
  return file;
}
const find = (f, live, extra = []) => {
  const out = path.join(f.root, `found-${Math.random().toString(16).slice(2)}.json`);
  const result = train.run(['find', '--out', out, '--live', live, ...extra], f.repo, f.opts);
  return { result, out, manifest: result.written ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
};

test('build makes the train in a temporary worktree and leaves the caller\'s checkout on its own branch', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  // The 27 November case: a clean primary checkout on its own branch was left on the train branch.
  f.git('switch', '--quiet', '-c', 'my-work', f.main);
  const clean = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)] }, 'clean.json'), '--branch', 'toolkit-train/clean', '--main', 'main', '--live', f.noTrains], f.repo, f.opts);
  assert.equal(clean.ok, true, JSON.stringify(clean));
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), 'my-work', 'a clean checkout stays on its branch');
  // Unsaved files stay as they were too.
  f.write('notes.txt', 'unsaved\n');
  const { result } = built(f, [f.member(1, one)]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), 'my-work', 'the checkout stays on its branch');
  assert.equal(f.git('status', '--porcelain'), '?? notes.txt', 'its files stay as they were');
  assert.equal(f.git('rev-parse', 'toolkit-train/one'), result.head, 'the branch holds the train');
  assert.equal(f.git('worktree', 'list', '--porcelain').split('\n\n').filter(Boolean).length, 1, 'no worktree is left behind');
  // A branch checked out here is refused before anything moves.
  f.git('switch', '--quiet', 'toolkit-train/one');
  assert.throws(() => built(f, [f.member(1, one)]), /toolkit-train\/one is checked out here; switch this checkout to another branch first/);
});

test('find: a ready pull request joins the last train while it takes joiners, else starts the next one behind it', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const train1 = { pr: 50, branch: 'toolkit-train/one', head: one, members: [[1, one]] };
  // Main's checks running, nothing open: even one ready pull request starts a train on main.
  const alone = find(f, facts(f, { ready: [[2, two]], main: running }));
  assert.equal(alone.result.written, true, JSON.stringify(alone.result));
  assert.equal(alone.manifest.onto, undefined);
  assert.equal(alone.manifest.join, undefined);
  assert.match(alone.result.next.join('\n'), /#2 starts a train on main: main's required checks are running, so it does not land alone/);
  // Main's checks done, nothing open: one ready pull request lands alone, as before.
  assert.match(find(f, facts(f, { ready: [[2, two]], main: green })).result.next[0], /merge #2 alone/);
  // The front train while main's checks run: it takes joiners.
  const joins = find(f, facts(f, { ready: [[2, two]], trains: [train1], main: running }));
  assert.deepEqual(joins.manifest.join, { pr: 50, branch: 'toolkit-train/one', head: one });
  assert.deepEqual(joins.manifest.members.map(member => member.pr), [2]);
  assert.match(joins.result.next[0], /^join #2 to train #50 .*main's required checks are running, so it still takes joiners.*toolkit-merge-train\.cjs join --manifest <train #50's manifest> --add /);
  // The front train once main's checks are done: closed to joiners, so the next train starts behind it.
  const next = find(f, facts(f, { ready: [[2, two]], trains: [train1], main: green }));
  assert.deepEqual(next.manifest.onto, { pr: 50, branch: 'toolkit-train/one', head: one });
  assert.equal(next.manifest.join, undefined);
  assert.match(next.result.next.join('\n'), /train #50 closed to joiners \(main's required checks are done\) and lands next: this starts the next train behind it/);
  // A train waiting behind another takes joiners whatever main's checks say.
  const train2 = { pr: 51, branch: 'toolkit-train/two', base: 'toolkit-train/one', head: one, members: [[1, one]] };
  const behind = find(f, facts(f, { ready: [[2, two]], trains: [train1, train2], main: green }));
  assert.equal(behind.manifest.join.pr, 51);
  // --next-train starts the next train instead (ready pull requests a full train has no room for).
  const forced = find(f, facts(f, { ready: [[2, two]], trains: [train1], main: running }), ['--next-train']);
  assert.equal(forced.manifest.onto.pr, 50);
  assert.equal(forced.manifest.join, undefined);
});

test('join adds a ready pull request to an open train without rewriting it, re-bumps once, and drops a conflicting joiner', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const clash = f.branch('pr-3', { 'b.txt': 'other\n' });
  const first = built(f, [f.member(1, one)]);
  assert.equal(first.result.ok, true);
  const start = first.result.head;
  const add = f.manifestFile({ join: { pr: 50, branch: 'toolkit-train/one', head: start }, members: [f.member(2, two, { bump: 'minor' }), f.member(3, clash)] }, 'add.json');
  const joined = train.run(['join', '--manifest', first.out, '--add', add, '--main', 'main'], f.repo, f.opts);
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.deepEqual(joined.joined, [2]);
  assert.deepEqual(joined.dropped.map(entry => [entry.pr, entry.reason]), [[3, 'conflicts with the train']]);
  assert.ok(joined.next.includes("#3 conflicts with train toolkit-train/one, so it is dropped and boards no train for now: once this train lands, its builder merges main into #3's branch and resolves the conflict there, a delta review checks the resolution at the new head, then it boards the next train (node repo/scripts/toolkit-merge-train.cjs find --pr 3)"), joined.next.join('\n'));
  assert.doesNotMatch(joined.next.join('\n'), /--next-train|at once/, 'G2 round 1 M1: no step that cannot succeed');
  // The train body tells the same path for the dropped joiner.
  assert.match(train.body(train.checkManifest(JSON.parse(fs.readFileSync(first.out, 'utf8')))), /\| #3 \| `[0-9a-f]{40}` \| conflicts with the train \| once this train lands, its builder merges main into #3's branch and resolves the conflict there/);
  // Forward only: the old head is inside the new one, so the push needs no force.
  assert.equal(f.git('merge-base', '--is-ancestor', start, 'toolkit-train/one') === '', true);
  assert.equal(f.git('rev-parse', 'toolkit-train/one'), joined.head);
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the caller\'s checkout did not move');
  // One bump at the level of every member, recorded bump revert, and the train verifies.
  assert.equal(f.git('show', `${joined.head}:VERSION`), '1.1.0');
  const boarded = JSON.parse(fs.readFileSync(first.out, 'utf8'));
  assert.deepEqual(boarded.members.map(member => member.pr), [1, 2]);
  assert.equal(boarded.rebumps.length, 1);
  assert.equal(boarded.rebumps[0].of, start);
  const checked = train.run(['verify', '--manifest', first.out, '--head', joined.head, '--main', 'main'], f.repo, f.opts);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  // An unrecorded revert does not verify: the record is what makes it allowed.
  const bare = { ...boarded };
  delete bare.rebumps;
  const loose = path.join(f.root, 'loose.json');
  fs.writeFileSync(loose, JSON.stringify(bare));
  assert.equal(train.run(['verify', '--manifest', loose, '--head', joined.head, '--main', 'main'], f.repo, f.opts).ok, false);
  // Only conflicting joiners: nothing changes.
  const again = f.manifestFile({ join: { pr: 50, branch: 'toolkit-train/one', head: joined.head }, members: [f.member(3, clash)] }, 'again.json');
  const none = train.run(['join', '--manifest', first.out, '--add', again, '--main', 'main'], f.repo, f.opts);
  assert.equal(none.ok, false);
  assert.equal(f.git('rev-parse', 'toolkit-train/one'), joined.head, 'the train is left as it was');
  // A branch here that moved since find read it is refused.
  const stale = f.manifestFile({ join: { pr: 50, branch: 'toolkit-train/one', head: start }, members: [f.member(4, f.branch('pr-4', { 'd.txt': 'd\n' }))] }, 'stale.json');
  assert.throws(() => train.run(['join', '--manifest', first.out, '--add', stale, '--main', 'main'], f.repo, f.opts), /toolkit-train\/one here is at [0-9a-f]{12}, not the head find saw/);
});

// G2 round 1 M1, with the owner's answer (INT-TK421-1388): the printed path for a dropped joiner, followed
// on a fixture, ends with it boarded on the next train.
test('a joiner dropped for conflicting follows its printed steps: the train lands, its builder resolves on main, a delta review passes, it boards the next train', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const clash = f.branch('pr-3', { 'b.txt': 'other\n' });
  const first = built(f, [f.member(1, one)]);
  const add = f.manifestFile({ join: { pr: 50, branch: 'toolkit-train/one', head: first.result.head }, members: [f.member(3, clash)] }, 'add.json');
  const dropped = train.run(['join', '--manifest', first.out, '--add', add, '--main', 'main'], f.repo, f.opts);
  assert.equal(dropped.ok, false);
  assert.match(dropped.next[0], /^#3 conflicts with train toolkit-train\/one, so it is dropped and boards no train for now: once this train lands, /);
  // Step 1: the train lands.
  f.git('merge', '--quiet', '--no-ff', '-m', 'land train #50', 'toolkit-train/one');
  // Step 2: its builder merges main into #3's branch and resolves the conflict there.
  f.git('switch', '--quiet', 'pr-3');
  assert.notEqual(spawnSync('git', ['merge', '--no-edit', 'main'], { cwd: f.repo, encoding: 'utf8' }).status, 0, 'the conflict is real');
  f.write('b.txt', 'b\nother\n');
  f.git('add', 'b.txt');
  f.git('commit', '--quiet', '--no-edit');
  const resolved = f.git('rev-parse', 'HEAD');
  f.git('switch', '--quiet', 'main');
  // Step 3: a delta review passes the resolution (its PASS names the new head); main's checks run after
  // the landing, so find starts the next train with it.
  const found = find(f, facts(f, { ready: [[3, resolved]], main: running }), ['--pr', '3']);
  assert.equal(found.result.written, true, JSON.stringify(found.result));
  assert.deepEqual(found.manifest.members.map(member => [member.pr, member.head]), [[3, resolved]]);
  // Step 4: it boards the next train and that train verifies.
  const out = path.join(f.root, 'next.json');
  const next = train.run(['build', '--manifest', found.out, '--branch', 'toolkit-train/two', '--main', 'main', '--live', f.noTrains, '--out', out], f.repo, f.opts);
  assert.deepEqual([next.ok, next.boarded, next.ejected], [true, [3], []], JSON.stringify(next));
  assert.equal(train.run(['verify', '--manifest', out, '--head', next.head, '--main', 'main'], f.repo, f.opts).ok, true);
  assert.equal(f.git('show', `${next.head}:b.txt`), 'b\nother');
});

test('land waits while main\'s required checks run: the train still takes joiners, then lands', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const first = built(f, [f.member(1, one)]);
  const live = main => {
    const file = path.join(f.root, `land-${main.length}.json`);
    fs.writeFileSync(file, JSON.stringify({ 50: { state: 'OPEN', head: first.result.head, body: '' }, 1: { state: 'OPEN', head: one, body: 'Change.\n\nBump: patch\nUAT: NOT_REQUIRED (internal)\n' }, main_checks: main }));
    return file;
  };
  const busy = train.run(['land', '--manifest', first.out, '--pr', '50', '--head', first.result.head, '--main', 'main', '--live', live(running)], f.repo, f.opts);
  assert.equal(busy.ok, false);
  assert.ok(busy.problems.some(problem => /^main's required checks are still running at [0-9a-f]{12}: the train takes joiners until they finish \(find, then join\), then lands$/.test(problem)), busy.problems.join('\n'));
  const done = train.run(['land', '--manifest', first.out, '--pr', '50', '--head', first.result.head, '--main', 'main', '--live', live(green)], f.repo, f.opts);
  assert.ok(!done.problems.some(problem => /main's required checks/.test(problem)), done.problems.join('\n'));
});

// G2 Low: right after a merge GitHub has not made main's check runs yet. A required check with no run at
// main's head counts as running for ten minutes after that head was committed, in find and in land; after
// that, a check that never ran on main (one that runs on pull requests only) holds nothing.
test('a required check with no run yet at a new main head counts as running, until the head is ten minutes old', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const fresh = new Date(Date.now() - 60000).toISOString();
  const old = new Date(Date.now() - 11 * 60000).toISOString();
  // find: a lone ready pull request starts a train instead of merging alone, and an open front train
  // still takes joiners.
  const alone = find(f, facts(f, { ready: [[2, two]], main: [], committedAt: fresh }));
  assert.equal(alone.result.written, true, JSON.stringify(alone.result));
  assert.equal(alone.result.main_ci, 'running');
  assert.match(find(f, facts(f, { ready: [[2, two]], main: [], committedAt: old })).result.next[0], /merge #2 alone/);
  const train1 = { pr: 50, branch: 'toolkit-train/one', head: one, members: [[1, one]] };
  assert.match(find(f, facts(f, { ready: [[2, two]], trains: [train1], main: [], committedAt: fresh })).result.next[0], /^join #2 to train #50 /);
  // land: the front train waits for the check that has not started yet.
  const first = built(f, [f.member(1, one)]);
  const live = at => {
    const file = path.join(f.root, `land-${Date.parse(at)}.json`);
    fs.writeFileSync(file, JSON.stringify({ 50: { state: 'OPEN', head: first.result.head, body: '' }, 1: { state: 'OPEN', head: one, body: 'Change.\n\nBump: patch\nUAT: NOT_REQUIRED (internal)\n' }, main_checks: [], main_committed_at: at }));
    return file;
  };
  const waits = train.run(['land', '--manifest', first.out, '--pr', '50', '--head', first.result.head, '--main', 'main', '--live', live(fresh)], f.repo, f.opts);
  assert.ok(waits.problems.some(problem => /^main's required checks are still running at /.test(problem)), waits.problems.join('\n'));
  const lands = train.run(['land', '--manifest', first.out, '--pr', '50', '--head', first.result.head, '--main', 'main', '--live', live(old)], f.repo, f.opts);
  assert.ok(!lands.problems.some(problem => /main's required checks/.test(problem)), lands.problems.join('\n'));
  // G2 round 1, L-a: with no required check listed and no run at all yet, a new head counts as running too.
  f.governed(null, { required_checks: [] });
  assert.equal(find(f, facts(f, { ready: [[2, two]], main: [], committedAt: fresh })).result.main_ci, 'running');
  assert.match(find(f, facts(f, { ready: [[2, two]], main: [], committedAt: old })).result.next[0], /merge #2 alone/);
});
