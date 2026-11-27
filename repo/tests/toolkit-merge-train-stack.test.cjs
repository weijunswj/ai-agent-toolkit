'use strict';

// Trains stack by default. On 23 November 2026 three trains were built on main beside an open one,
// each costing its own bump, CI run and owner ask: build on main now reads the open train pull
// requests and refuses beside one, naming how to stack; it takes find's "onto"; and land lists the
// steps owed after the merge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const { fixture, built, MEMBER_BODY } = require('./support/merge-train-fixture.cjs');

// GitHub facts in find's --live format: one open train pull request, its body the member table.
function openTrainFacts(f, { number = 50, branch = 'toolkit-train/one', base = 'main', head, members = [], repo = 'example/repo' }) {
  const file = path.join(f.root, `open-${number}.json`);
  const table = members.map(([pr, sha]) => `| #${pr} | \`${sha}\` | NORMAL | patch | x |`).join('\n');
  fs.writeFileSync(file, JSON.stringify({
    default_branch: 'main',
    pulls: [{ number, draft: false, base: { ref: base }, head: { ref: branch, sha: head, repo: { full_name: repo } }, body: `## Merge train\n\n| Member | Reviewed head | Tier | Bump | Review |\n|---|---|---|---|---|\n${table}\n` }],
  }));
  return file;
}

test('a build on main beside an open train refuses, names how to stack, and --separate builds beside it on purpose', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const first = built(f, [f.member(1, one)]);
  const open = openTrainFacts(f, { head: first.result.head, members: [[1, one]] });
  const manifest = f.manifestFile({ members: [f.member(2, two)] }, 'next-in.json');
  const before = f.git('rev-parse', 'HEAD');

  const refused = train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/two', '--main', 'main', '--live', open], f.repo, f.opts);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.problems.length, 1);
  assert.match(refused.problems[0], /^train #50 is open, so this train would run beside it and take a bump, a CI run and an owner ask of its own: stack onto #50 instead/);
  assert.ok(refused.problems[0].includes(`git fetch origin toolkit-train/one and build with --onto ${first.result.head}`), refused.problems[0]);
  assert.match(refused.problems[0], /or pass --separate "<reason>" to build beside it on purpose$/);
  assert.equal(f.git('rev-parse', 'HEAD'), before, 'nothing moved');
  assert.throws(() => f.git('rev-parse', '--verify', '--quiet', 'refs/heads/toolkit-train/two'), /git rev-parse/, 'no branch was made');
  const cli = f.cli('build', '--manifest', manifest, '--branch', 'toolkit-train/two', '--main', 'main', '--live', open);
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);

  // A fork's pull request with a member table is not a train here: the build is not held by it.
  const fork = openTrainFacts(f, { number: 60, branch: 'toolkit-train/fork', head: first.result.head, members: [[1, one]], repo: 'someone/fork' });
  const beside = train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/fork-check', '--main', 'main', '--live', fork], f.repo, f.opts);
  assert.equal(beside.ok, true, JSON.stringify(beside));

  // Rebuilding the open train's own branch on main (main moved) is not beside it.
  const rebuilt = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)] }, 'again.json'), '--branch', 'toolkit-train/one', '--main', 'main', '--live', open], f.repo, f.opts);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt));

  const out = path.join(f.root, 'separate.json');
  const separate = train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/two', '--main', 'main', '--live', open, '--separate', 'train 50 waits on a red CI', '--out', out], f.repo, f.opts);
  assert.equal(separate.ok, true, JSON.stringify(separate));
  assert.equal(separate.stacked, false);
  assert.equal(separate.separate, 'train 50 waits on a red CI');
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).separate, 'train 50 waits on a red CI', 'the reason stays with the train');
  assert.throws(() => train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/three', '--main', 'main', '--separate', 'x', '--onto', first.result.head], f.repo, f.opts), /--separate builds on main beside the open trains; drop --onto/);
  assert.throws(() => train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/three', '--main', 'main', '--separate', ' '], f.repo, f.opts), /--separate must say in one line why/);

  // An unreadable open-train list refuses too, never builds on a guess.
  const broken = path.join(f.root, 'broken.json');
  fs.writeFileSync(broken, '{ not json');
  const unread = train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/four', '--main', 'main', '--live', broken], f.repo, f.opts);
  assert.equal(unread.ok, false);
  assert.match(unread.problems[0], /^could not check for open trains \(.*\): build again online, or pass --separate "<reason>"/);
});

test('build stacks onto the manifest onto at the head find saw, prints the base and retarget lines, and catchup drops it', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const first = built(f, [f.member(1, one)]);
  const onto = { pr: 50, branch: 'toolkit-train/one', head: first.result.head };
  const manifest = f.manifestFile({ onto, members: [f.member(2, two)] }, 'stack-in.json');
  const out = path.join(f.root, 'stack.json');
  const stacked = train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/two', '--main', 'main', '--out', out], f.repo, f.opts);
  assert.equal(stacked.ok, true, JSON.stringify(stacked));
  assert.equal(stacked.stacked, true);
  assert.equal(stacked.onto, first.result.head);
  assert.equal(stacked.bump, null, 'a stacked train takes no bump');
  assert.deepEqual(stacked.steps, [
    "open this train's pull request against train #50's branch, not main: gh pr create --head toolkit-train/two --base toolkit-train/one (with the body from body)",
    `once train #50 lands: gh pr edit toolkit-train/two --base main, then node repo/scripts/toolkit-merge-train.cjs catchup --manifest ${out} in a clean checkout of toolkit-train/two`,
  ]);
  const boarded = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual([boarded.stacked, boarded.onto], [true, onto]);

  // --onto must agree with the manifest; a head not fetched here names the fetch; a train already in
  // main (it landed) is no longer something to stack onto.
  assert.throws(() => train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/x', '--main', 'main', '--onto', 'main'], f.repo, f.opts), /--onto and the manifest's onto \(train #50 at [0-9a-f]{12}\) disagree: drop one/);
  const gone = f.manifestFile({ onto: { ...onto, head: 'e'.repeat(40) }, members: [f.member(2, two)] }, 'gone.json');
  assert.throws(() => train.run(['build', '--manifest', gone, '--branch', 'toolkit-train/x', '--main', 'main'], f.repo, f.opts), /train #50's head eeeeeeeeeeee is not here: git fetch origin toolkit-train\/one, then build again/);
  assert.throws(() => train.checkManifest({ onto: { pr: 50, branch: '../x', head: first.result.head }, members: [f.member(2, two)] }), /"onto" must name the open train/);

  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', first.result.head);
  f.write('later.txt', 'later\n');
  f.git('add', 'later.txt');
  f.git('commit', '--quiet', '-m', 'main moves past the landed train');
  // A stacked train left open after the train under it landed is not a train that landed: the
  // refusal names catchup, or find would write the same onto again.
  assert.throws(() => train.run(['build', '--manifest', manifest, '--branch', 'toolkit-train/x', '--main', 'main'], f.repo, f.opts), /train #50 at [0-9a-f]{12} does not contain main: if it landed, run find again; if it is still open \(stacked on a train that landed\), catch it up first \(catchup in a clean checkout of toolkit-train\/one\), then run find again$/);

  f.git('switch', '--quiet', 'toolkit-train/two');
  const caught = train.catchup(f.repo, boarded, { main: 'main', out });
  assert.equal(caught.ok, true, JSON.stringify(caught));
  const after = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual([after.stacked, after.onto], [undefined, undefined], 'catchup drops stacked and onto, so a rebuild starts from main');
});

test('a ready land lists the closing stories, the sessions to archive and the worktrees to remove', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two)]);
  // A lane worktree at #1's head (removable) and a host-made one at #2's head (left to the host).
  const lane = path.join(f.root, 'lane-1');
  f.git('worktree', 'add', '--quiet', lane, 'pr-1');
  f.git('worktree', 'add', '--quiet', '--detach', path.join(f.repo, '.claude', 'worktrees', 'chat-2'), two);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: result.head, body: MEMBER_BODY }, 1: { state: 'OPEN', head: one, body: MEMBER_BODY }, 2: { state: 'OPEN', head: two, body: MEMBER_BODY } }));
  const landing = train.run(['land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(landing.ok, true, JSON.stringify(landing));
  const [stories, sessions, ...trees] = landing.steps;
  assert.match(stories, /^closing stories, once GitHub shows the merge: on train #50 and on each member \(#1, #2\), node .*skills\/github-program-reconciler\/scripts\/programme\.cjs closing-comment --pr <n> --body-file <story file> --dry-run, then the same without --dry-run/);
  assert.equal(sessions, "sessions: archive this train's lane and the finished gate sessions of #1, #2");
  const primary = f.git('worktree', 'list', '--porcelain').split('\n')[0].slice('worktree '.length);
  const laneListed = f.git('worktree', 'list', '--porcelain').split('\n').find(line => /lane-1$/.test(line)).slice('worktree '.length);
  assert.deepEqual(trees.filter(line => !/^worktree .*made by/.test(line)), [`worktree: git -C "${primary}" worktree remove "${laneListed}"`, `branch: git -C "${primary}" branch -d pr-1`]);
  assert.ok(trees.some(line => /^worktree .*chat-2: made by Claude Code, left to its own clean-up$/.test(line)), trees.join('\n'));
  const cli = f.cli('land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live);
  assert.equal(cli.status, 0, cli.stdout);
  assert.deepEqual(JSON.parse(cli.stdout).steps, landing.steps);
  // A refused land owes nothing yet, so it lists no steps.
  fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: 'e'.repeat(40), body: MEMBER_BODY }, 1: { state: 'OPEN', head: one, body: MEMBER_BODY }, 2: { state: 'OPEN', head: two, body: MEMBER_BODY } }));
  const refused = train.run(['land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.deepEqual([refused.steps, refused.merge_step], [[], undefined], 'a refused land names no merge step');
});
