'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const train = require('../scripts/toolkit-merge-train.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-merge-train.cjs');
const BUMP_SCRIPT = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const [level, base] = process.argv.slice(2);",
  "const [major, minor, patch] = fs.readFileSync('VERSION', 'utf8').trim().split('.').map(Number);",
  "const next = level === 'major' ? [major + 1, 0, 0] : level === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1];",
  "fs.writeFileSync('VERSION', `${next.join('.')}\\n`);",
  "fs.writeFileSync('BUMP-BASE', `${base}\\n`);",
  '',
].join('\n');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-train-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Train test');
  git('config', 'user.email', 'train@example.com');
  git('config', 'commit.gpgsign', 'false');
  write('VERSION', '1.0.0\n');
  write('a.txt', 'one\ntwo\nthree\n');
  write('scripts/bump.cjs', BUMP_SCRIPT);
  git('add', '--all');
  git('commit', '--quiet', '-m', 'base');
  const main = git('rev-parse', 'HEAD');
  const branch = (name, files) => {
    git('switch', '--quiet', '-c', name, main);
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    git('add', '--all');
    git('commit', '--quiet', '-m', `work on ${name}`);
    const head = git('rev-parse', 'HEAD');
    git('switch', '--quiet', 'main');
    return head;
  };
  const member = (pr, head, extra = {}) => ({ pr, head, g2: `G2 PASS report for ${pr}`, tier: 'NORMAL', bump: 'patch', uat: 'UAT: NOT_REQUIRED (internal)', links: [`Refs #${pr + 100}`], ...extra });
  const manifestFile = (value, name = 'manifest.json') => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify({ repository: 'example/repo', bump_command: 'node scripts/bump.cjs {level} {base}', ...value }));
    return file;
  };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--json'], { cwd: repo, encoding: 'utf8' });
  return { root, repo, git, write, main, branch, member, manifestFile, cli };
}

function built(f, members, extra = {}) {
  const out = path.join(f.root, 'boarded.json');
  const result = train.run(['build', '--manifest', f.manifestFile({ members, ...extra }), '--branch', 'toolkit-train/one', '--main', 'main', '--out', out], f.repo);
  return { result, out, boarded: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

test('a clean train boards each member at its reviewed head, bumps once at the highest level and verifies', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two, { bump: 'minor' })]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.boarded, [1, 2]);
  assert.deepEqual(result.ejected, []);
  assert.equal(result.level, 'minor');
  assert.equal(result.stacked, false);
  assert.ok(result.bump, 'one bump commit');
  assert.equal(f.git('show', `${result.head}:VERSION`), '1.1.0');
  assert.equal(f.git('show', `${result.head}:BUMP-BASE`), f.main, 'the bump command gets main as its base');
  assert.equal(f.git('show', '-s', '--format=%P', `${result.head}~1`).split(' ')[1], two, 'member merged at its exact head');
  assert.match(f.git('log', '-1', '--format=%s', `${result.head}~1`), /^Merge train: board #2 at /);
  const cli = f.cli('verify', '--manifest', out, '--head', 'toolkit-train/one', '--main', 'main');
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.equal(JSON.parse(cli.stdout).ok, true);
  assert.equal(f.git('worktree', 'list').split('\n').length, 1, 'verify leaves no worktree behind');
});

test('verify lists files two or more members change and says which review the train needs', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n', 'shared.txt': 'from 1\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const apart = built(f, [f.member(1, one), f.member(2, two)]);
  const clear = train.run(['verify', '--manifest', apart.out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo);
  assert.equal(clear.ok, true, JSON.stringify(clear));
  assert.deepEqual(clear.overlap, []);
  assert.equal(clear.review, 'none: verify and green CI suffice');
  // Both members change the same file in places Git merges cleanly: the train still verifies, and
  // the shared file is named for a delta review.
  f.git('switch', '--quiet', 'main');
  f.write('a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n');
  f.git('commit', '--quiet', '-am', 'longer a.txt');
  const base = f.git('rev-parse', 'HEAD');
  const edit = (name, text) => {
    f.git('switch', '--quiet', '-c', name, base);
    f.write('a.txt', text);
    f.git('commit', '--quiet', '-am', `work on ${name}`);
    const head = f.git('rev-parse', 'HEAD');
    f.git('switch', '--quiet', 'main');
    return head;
  };
  const three = edit('pr-3', 'ONE\ntwo\nthree\nfour\nfive\nsix\n');
  const four = edit('pr-4', 'one\ntwo\nthree\nfour\nfive\nSIX\n');
  const shared = built(f, [f.member(3, three), f.member(4, four)]);
  assert.deepEqual(shared.result.boarded, [3, 4], JSON.stringify(shared.result));
  const flagged = train.run(['verify', '--manifest', shared.out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo);
  assert.equal(flagged.ok, true, JSON.stringify(flagged));
  assert.deepEqual(flagged.overlap, [{ file: 'a.txt', members: [3, 4] }]);
  assert.equal(flagged.review, 'delta review of the shared files');
});

test('build caps a train at six members and body carries every member\'s Pack changes lines', t => {
  const f = fixture(t);
  const heads = [1, 2, 3, 4, 5, 6, 7].map(pr => f.branch(`pr-${pr}`, { [`m${pr}.txt`]: `${pr}\n` }));
  assert.equal(train.MAX_MEMBERS, 6);
  assert.throws(
    () => train.run(['build', '--manifest', f.manifestFile({ members: heads.map((head, index) => f.member(index + 1, head)) }), '--branch', 'toolkit-train/full', '--main', 'main'], f.repo),
    /a train holds at most 6 members; board the rest on the next train/,
  );
  assert.equal(f.git('branch', '--list', 'toolkit-train/full'), '', 'a refused train creates no branch');
  const text = train.body({ members: [
    f.member(1, heads[0], { pack_changes: ['merge-07: now refuses a moved head'] }),
    f.member(2, heads[1]),
    f.member(3, heads[2], { pack_changes: ['push-12: message wording'] }),
  ] }).split('\n');
  const at = text.indexOf('## Pack changes');
  assert.ok(at > 0, 'the train body has one Pack changes heading');
  assert.deepEqual(text.slice(at + 2, at + 4), ['merge-07: now refuses a moved head', 'push-12: message wording']);
  assert.equal(text.filter(line => line === '## Pack changes').length, 1);
  assert.throws(() => train.checkManifest({ members: [f.member(1, heads[0], { pack_changes: ['two\nlines'] })] }), /"pack_changes" must be/);
});

test('a member that conflicts is ejected, never hand-fixed, and the rest still land', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'a.txt': 'one\nTWO from 1\nthree\n' });
  const two = f.branch('pr-2', { 'a.txt': 'one\nTWO from 2\nthree\n' });
  const three = f.branch('pr-3', { 'd.txt': 'd\n' });
  const { result, out, boarded } = built(f, [f.member(1, one), f.member(2, two), f.member(3, three)]);
  assert.deepEqual(result.boarded, [1, 3]);
  assert.equal(result.ejected.length, 1);
  assert.equal(result.ejected[0].pr, 2);
  assert.match(result.ejected[0].reason, /conflicts with the train/);
  // The ejection is owed work: the build names the step, and the train body lists it.
  assert.equal(result.next.length, 1);
  assert.match(result.next[0], /^#2: land it on its own, or rejoin the next train once its review passes the head it boards at \(conflicts with the train/);
  assert.match(train.body(boarded), /^### Ejected$/m);
  assert.match(train.body(boarded), new RegExp(`^\\| #2 \\| \`${two}\` \\| conflicts with the train[^|]* \\| land it on its own, or rejoin the next train once its review passes the head it boards at \\|$`, 'm'));
  assert.deepEqual(boarded.members.map(member => member.pr), [1, 3]);
  assert.equal(f.git('status', '--porcelain'), '', 'the aborted merge leaves a clean tree');
  assert.equal(train.run(['verify', '--manifest', out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo).ok, true);
});

test('verify refuses a commit of its own, an unlisted merge, an edited merge, a hand-resolved merge and a wide bump', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'a.txt': 'one\nTWO from 1\nthree\n' });
  const two = f.branch('pr-2', { 'a.txt': 'one\nTWO from 2\nthree\n' });
  const stray = f.branch('stray', { 'e.txt': 'unreviewed\n' });
  const manifest = f.manifestFile({ members: [f.member(1, one), f.member(2, two)] });
  const verify = head => train.run(['verify', '--manifest', manifest, '--head', head, '--main', 'main'], f.repo);
  const start = name => f.git('switch', '--quiet', '-C', name, f.main);

  start('smuggled');
  f.git('merge', '--no-ff', '--no-edit', one);
  f.write('extra.txt', 'sneaked in\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'extra');
  f.git('merge', '--no-ff', '--no-edit', '-X', 'theirs', two);
  let result = verify('smuggled');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(problem => /a commit of its own inside the train/.test(problem)), result.problems.join('\n'));

  start('unlisted');
  f.git('merge', '--no-ff', '--no-edit', one);
  f.git('merge', '--no-ff', '--no-edit', stray);
  result = verify('unlisted');
  assert.ok(result.problems.some(problem => /neither a member's reviewed head nor main/.test(problem)), result.problems.join('\n'));
  assert.ok(result.problems.some(problem => /#2 at .* is not on the train/.test(problem)), result.problems.join('\n'));

  start('edited');
  f.git('merge', '--no-ff', '--no-commit', one);
  f.write('f.txt', 'edited inside the merge\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '--no-edit');
  result = verify('edited');
  assert.ok(result.problems.some(problem => /differs from Git's own clean merge/.test(problem)), result.problems.join('\n'));

  start('resolved');
  f.git('merge', '--no-ff', '--no-edit', one);
  spawnSync('git', ['merge', '--no-ff', '--no-edit', two], { cwd: f.repo });
  f.write('a.txt', 'one\nTWO resolved by hand\nthree\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '--no-edit');
  result = verify('resolved');
  assert.ok(result.problems.some(problem => /cannot make cleanly: a hand-resolved conflict/.test(problem)), result.problems.join('\n'));

  const solo = f.manifestFile({ members: [f.member(1, one)] }, 'solo.json');
  start('wide-bump');
  f.git('merge', '--no-ff', '--no-edit', one);
  f.write('VERSION', '1.0.1\n');
  f.write('BUMP-BASE', `${f.main}\n`);
  f.write('g.txt', 'not a bump\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'bump plus extra');
  result = train.run(['verify', '--manifest', solo, '--head', 'wide-bump', '--main', 'main'], f.repo);
  assert.ok(result.problems.some(problem => /differs from a fresh run of the bump command/.test(problem)), result.problems.join('\n'));
  assert.equal(f.git('worktree', 'list').split('\n').length, 1);
});

test('a train with no bump command takes no plain commit at all', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const out = path.join(f.root, 'boarded.json');
  const result = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)], bump_command: 'none' }), '--branch', 'toolkit-train/nb', '--main', 'main', '--out', out], f.repo);
  assert.equal(result.bump, null);
  assert.equal(f.git('show', `${result.head}:VERSION`), '1.0.0');
  assert.equal(train.run(['verify', '--manifest', out, '--head', result.head, '--main', 'main'], f.repo).ok, true);
  f.write('h.txt', 'late\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'late');
  const after = train.run(['verify', '--manifest', out, '--head', 'HEAD', '--main', 'main'], f.repo);
  assert.ok(after.problems.some(problem => /no bump to make, so a plain commit is not allowed/.test(problem)), after.problems.join('\n'));
});

test('a train stacked on a running train combines early, takes no bump and cannot land', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const first = built(f, [f.member(1, one)]);
  const out = path.join(f.root, 'next.json');
  const next = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two)] }, 'next-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo);
  assert.equal(next.stacked, true);
  assert.equal(next.bump, null);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 9: { state: 'OPEN', head: next.head }, 2: { state: 'OPEN', head: two } }));
  const landing = train.run(['land', '--manifest', out, '--pr', '9', '--head', next.head, '--main', 'main', '--live', live], f.repo);
  assert.equal(landing.ok, false);
  assert.equal(landing.merge, null);
  assert.ok(landing.problems.some(problem => /neither a member's reviewed head nor main/.test(problem)), landing.problems.join('\n'));
});

test('once the running train lands, catchup merges main into the stacked train, adds the bump and it lands', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const first = built(f, [f.member(1, one)]);
  const out = path.join(f.root, 'next.json');
  const next = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two, { bump: 'minor' })] }, 'next-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo);
  assert.equal(next.stacked, true);
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  // Main moving under the stacked train refuses catch-up until the running train is in.
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', first.result.head);
  f.git('switch', '--quiet', 'toolkit-train/two');
  const caught = train.catchup(f.repo, manifest, { main: 'main', out });
  assert.equal(caught.ok, true, JSON.stringify(caught));
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).stacked, undefined, 'catchup drops the stacked mark');
  assert.equal(caught.level, 'minor');
  assert.ok(caught.bump, 'one bump commit after the catch-up merge');
  assert.equal(f.git('show', `${caught.head}:VERSION`), '1.1.0', 'the bump runs on top of the landed train');
  assert.equal(f.git('show', '-s', '--format=%P', `${caught.head}~1`).split(' ')[1], f.git('rev-parse', 'main'), 'main came in as one merge commit');
  assert.equal(f.git('status', '--porcelain'), '');
  const checked = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/two', '--main', 'main'], f.repo);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 9: { state: 'OPEN', head: caught.head }, 2: { state: 'OPEN', head: two } }));
  const landing = train.run(['land', '--manifest', out, '--pr', '9', '--head', caught.head, '--main', 'main', '--live', live], f.repo);
  assert.equal(landing.ok, true, JSON.stringify(landing));
  assert.throws(() => train.catchup(f.repo, manifest, { main: 'main' }), /main is already inside the train/);
  // A train that already carries its bump never takes a second one.
  f.git('switch', '--quiet', 'main');
  f.write('e.txt', 'e\n');
  f.git('add', 'e.txt');
  f.git('commit', '--quiet', '-m', 'main moves again');
  f.git('switch', '--quiet', 'toolkit-train/two');
  assert.throws(() => train.catchup(f.repo, manifest, { main: 'main' }), /already carries its bump: only a stacked train/);
});

test('a failed catch-up bump leaves the train at its pre-merge head, and verify refuses a train with no bump', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const first = built(f, [f.member(1, one)]);
  const out = path.join(f.root, 'next.json');
  train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two)] }, 'next-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo);
  // A stacked train holds no bump, so verify refuses it until catchup adds one.
  const early = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/two', '--main', first.result.head], f.repo);
  assert.equal(early.ok, false);
  assert.ok(early.problems.some(problem => /the train has no bump commit/.test(problem)), early.problems.join('\n'));
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', first.result.head);
  f.git('switch', '--quiet', 'toolkit-train/two');
  const before = f.git('rev-parse', 'HEAD');
  const broken = { ...JSON.parse(fs.readFileSync(out, 'utf8')), bump_command: 'node scripts/missing-bump.cjs {level}' };
  const caught = train.catchup(f.repo, broken, { main: 'main' });
  assert.equal(caught.ok, false);
  assert.match(caught.problems[0], /the bump command failed/);
  assert.equal(f.git('rev-parse', 'HEAD'), before, 'the catch-up merge is undone with the failed bump');
  assert.equal(f.git('status', '--porcelain'), '');
});

test('catchup refuses a main that clashes with the stacked train and leaves the tree clean', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'a.txt': 'one\nTWO from 2\nthree\n' });
  const first = built(f, [f.member(1, one)]);
  const out = path.join(f.root, 'next.json');
  train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two)] }, 'next-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo);
  f.git('switch', '--quiet', 'main');
  f.write('a.txt', 'one\nTWO on main\nthree\n');
  f.git('commit', '--quiet', '-am', 'clash on main');
  f.git('switch', '--quiet', 'toolkit-train/two');
  const before = f.git('rev-parse', 'HEAD');
  const caught = train.catchup(f.repo, JSON.parse(fs.readFileSync(out, 'utf8')), { main: 'main' });
  assert.equal(caught.ok, false);
  assert.match(caught.problems[0], /does not merge cleanly into the train: eject the clashing member/);
  assert.equal(f.git('rev-parse', 'HEAD'), before);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('land checks live heads, main and RISKY owner OKs before it names the one merge', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two, { tier: 'RISKY', owner_ok: 'owner typed merge 2' })]);
  const live = path.join(f.root, 'live.json');
  const facts = { 50: { state: 'OPEN', head: result.head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } };
  fs.writeFileSync(live, JSON.stringify(facts));
  const ready = f.cli('land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live);
  assert.equal(ready.status, 0, ready.stdout);
  assert.deepEqual(JSON.parse(ready.stdout).merge, { repository: 'example/repo', pr: 50, head: result.head, method: 'merge commit' });

  fs.writeFileSync(live, JSON.stringify({ ...facts, 1: { state: 'OPEN', head: two } }));
  let refused = train.run(['land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo);
  assert.ok(refused.problems.some(problem => /#1 moved to .* after boarding/.test(problem)), refused.problems.join('\n'));

  const boarded = JSON.parse(fs.readFileSync(out, 'utf8'));
  delete boarded.members[1].owner_ok;
  const noOk = path.join(f.root, 'no-ok.json');
  fs.writeFileSync(noOk, JSON.stringify(boarded));
  fs.writeFileSync(live, JSON.stringify(facts));
  refused = train.run(['land', '--manifest', noOk, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo);
  assert.ok(refused.problems.some(problem => /#2 is RISKY and has no owner merge OK/.test(problem)), refused.problems.join('\n'));

  f.git('switch', '--quiet', 'main');
  f.write('main-moved.txt', 'later\n');
  f.git('add', '--all');
  f.git('commit', '--quiet', '-m', 'main moves');
  const cli = f.cli('land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live);
  assert.equal(cli.status, 1);
  assert.ok(JSON.parse(cli.stdout).problems.some(problem => /main moved since the train was built/.test(problem)));
});

test('body lists every member with one Bump line, the strictest UAT line and every closing line', t => {
  const f = fixture(t);
  const manifest = train.checkManifest({ members: [
    f.member(1, '1'.repeat(40)),
    f.member(2, '2'.repeat(40), { bump: 'minor', tier: 'RISKY', uat: 'UAT: OWNER_TEST_NEEDED (try it)', links: ['Closes #7'] }),
  ] });
  const text = train.body(manifest);
  assert.match(text, /^\| #1 \| `1{40}` \| NORMAL \| patch \| G2 PASS report for 1 \|$/m);
  assert.match(text, /^Tier: RISKY$/m);
  assert.match(text, /^Bump: minor$/m);
  assert.match(text, /^UAT: OWNER_TEST_NEEDED \(each member's own test after the merge: #2\)$/m);
  assert.equal(text.match(/^UAT: /gm).length, 1);
  assert.match(text, /^Refs #101$/m);
  assert.doesNotMatch(text, /^(Closes|Fixes|Resolves) /m, 'no closing line on a train that waits on an owner test');
  assert.match(text, /^Refs #7 \(closed by #2's own closing line when the train lands\)$/m);
  assert.doesNotMatch(text, /Generated with|Co-Authored-By/);
  assert.doesNotMatch(text, /Ejected/, 'no section when nothing was ejected');
  const quiet = train.body(train.checkManifest({ members: [f.member(3, '3'.repeat(40), { bump: 'none', uat: 'UAT: PASSED (owner OK)' })] }));
  assert.match(quiet, /^Bump: none$/m);
  assert.match(quiet, /^UAT: NOT_REQUIRED \(no member needs an owner test: #3\)$/m);
  const closing = train.body(train.checkManifest({ members: [f.member(4, '4'.repeat(40), { links: ['Closes #8'] })] }));
  assert.match(closing, /^Closes #8$/m, 'a train with no owner test keeps its closing lines');
});

test('split halves a red train for a bisect, and a train of one names its culprit', t => {
  const f = fixture(t);
  const members = [1, 2, 3].map(pr => f.member(pr, String(pr).repeat(40)));
  const prefix = path.join(f.root, 'half');
  const result = train.split(train.checkManifest({ members }), prefix);
  assert.deepEqual(result.halves.map(half => half.members), [[1, 2], [3]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${prefix}-b.json`, 'utf8')).members.map(member => member.pr), [3]);
  assert.throws(() => train.split(train.checkManifest({ members: [members[0]] }), prefix), /cannot split; that member is the culprit/);
});

test('the manifest refuses short heads, duplicates, a missing review, a bad UAT line and a bad closing line', t => {
  const f = fixture(t);
  const good = f.member(1, 'a'.repeat(40));
  const cases = [
    [{ members: [] }, /non-empty "members"/],
    [{ members: [{ ...good, head: 'abc1234' }] }, /full 40-character SHA/],
    [{ members: [good, { ...good, head: 'b'.repeat(40) }] }, /listed twice/],
    [{ members: [{ ...good, g2: '' }] }, /"g2" must name its review PASS/],
    [{ members: [{ ...good, tier: 'HUGE' }] }, /"tier" must be/],
    [{ members: [{ ...good, uat: 'UAT: MAYBE' }] }, /"uat" must be its one UAT: line/],
    [{ members: [{ ...good, links: ['Closes everything'] }] }, /"links" lines/],
    [{ members: [good], repository: 'not a repo' }, /owner\/name/],
  ];
  for (const [value, pattern] of cases) assert.throws(() => train.checkManifest(value), pattern);
  const cli = f.cli('verify', '--manifest', path.join(f.root, 'missing.json'), '--head', 'main');
  assert.equal(cli.status, 2);
  assert.match(JSON.parse(cli.stdout).error, /not readable JSON/);
  const ref = f.cli('build', '--manifest', f.manifestFile({ members: [good] }), '--branch', '../escape');
  assert.equal(ref.status, 2);
  assert.match(JSON.parse(ref.stdout).error, /not a plain ref/);
});

test('a failed bump stops the build with a clean tree and names the cause', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const out = path.join(f.root, 'boarded.json');
  const result = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)], bump_command: 'node scripts/missing-bump.cjs {level}' }), '--branch', 'toolkit-train/fail', '--main', 'main', '--out', out], f.repo);
  assert.equal(result.ok, false);
  assert.equal(result.bump, null);
  assert.match(result.problems[0], /the bump command failed: .*must hold main's version before it boards/s);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('the controller, the changelog guide and the repo map describe the train the script runs', () => {
  const root = path.join(__dirname, '..', '..');
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const finish = read('repo/controller/evidence-and-finish.md');
  assert.match(finish, /\*\*Merge trains:\*\* ready means G2 PASS at an exact head and green CI\. With main free, two or more ready PRs land as one train, chosen unasked/);
  // Rolling trains: the open train boards while a landing is in flight, closes when main frees, and
  // the next opens at once; a lone ready PR merges alone and nothing waits on a train.
  assert.match(finish, /while a landing is in flight, ready PRs board the open train stacked on it \(`build --onto`, no bump\)\. When main frees, boarding closes, `catchup` merges main in and bumps once/);
  assert.match(finish, /the next train opens at once\. A lone ready PR merges alone; no PR waits on a train\./);
  assert.match(finish, /Never hand-fix a train: a conflict, moved head or failed bump ejects that member to a later train once fixed and re-reviewed; red CI splits it \(`split`\)/);
  assert.match(finish, /RISKY members each need the owner's typed OK/);
  const guide = read('repo/docs/changelog.d/README.md');
  for (const command of ['build', 'verify', 'body', 'land', 'eject']) assert.match(guide, new RegExp(`toolkit-merge-train\\.cjs ${command} --manifest`));
  assert.match(guide, /\*\*Eject after boarding:\*\* .*It never rewrites the branch/);
  assert.match(guide, /\*\*Batches:\*\* several merge-ready pull requests land as one merge train that bumps once/);
  assert.match(read('repo/ARCHITECTURE.md'), /`repo\/scripts\/toolkit-merge-train\.cjs` \(`build`, `catchup`, `verify`, `body`, `split`, `land`, `eject`; never merges/);
  // Every controller type learns the train is its own default: CONTROLLER.md routes the merge step
  // to the page that holds it, the Projects skill puts it ahead of the one-PR bump route, and the
  // hourly nudge flags ready PRs that should ride together.
  // A train lane is mechanical: no G0 or G1, the small tier, no conflict fixes, and no G2 of its
  // own unless verify lists files two or more members change.
  const roles = read('repo/controller/roles-and-routes.md');
  assert.match(roles, /\*\*Merge-train lanes:\*\* running a train \(`toolkit-merge-train\.cjs` build, catchup, verify, body, land, eject\) is mechanical: no G0 or G1, the small tier at medium effort/);
  assert.match(roles, /The lane never resolves a conflict or edits code; it ejects the member, whose builder fixes it\./);
  assert.match(roles, /The train needs no G2 of its own once `verify` passes and CI is green; only files `verify` lists under `overlap` \(two or more members change them\) get a short delta review\./);
  assert.match(roles, /A train holds at most 6 members \(`build` refuses a seventh\); later ready PRs board the next\. A member that fails CI or its delta review is ejected at once and the rest carry on: once the train is pushed, `eject` adds revert commits on the same branch and PR, never a rebuild or force-push\./);
  assert.match(roles, /Never edit a train or member PR body while its CI runs; queue the edit until CI ends\./);
  assert.match(roles, /The train's merge ask goes up where `land` and the merge run, never relayed/);
  assert.match(read('repo/contracts/claude-projects/web-controller-projects/reference/cloud-hook-parity.md'), /A merge train's merge thread is the train thread: it posts the card for the train PR at its head and runs `land` and the merge itself[\s\S]*Fallback: the owner types `merge PR N at <full SHA> as a merge commit` in the train thread\./);
  assert.match(roles, /At boarding, copy each member's `Pack changes` lines into its manifest entry \(`pack_changes`\)/);
  assert.match(roles, /A stacked train's PR targets the running train's branch \(main's version check would call its fragments unfolded\) until that train lands, then main, before `catchup`\./);
  assert.match(read('repo/docs/changelog.d/README.md'), /Open its pull request against the running train's branch, not main/);
  assert.match(read('repo/CONTROLLER.md'), /\[Roles and routes\]\(controller\/roles-and-routes\.md\) `[0-9a-f]{12}`: before resolving a route or launching, relaying or reviewing a gate, helper or merge-train lane\./);
  assert.match(read('skills/agent-cost-control/SKILL.md'), /\*\*A merge-train lane is on the ladder\.\*\* Building, verifying and landing a merge train is mechanical and needs no G0 or G1: step 1 \(small, medium\)\. It never resolves a conflict or edits code/);
  assert.match(read('repo/CONTROLLER.md'), /\[Evidence, progress and finish\]\(controller\/evidence-and-finish\.md\) `[0-9a-f]{12}`: before merging,/);
  assert.match(read('repo/contracts/claude-projects/web-controller-projects/SKILL.md'), /Toolkit PRs hold main's version\. Ready PRs ride rolling merge trains unasked \(cheap, no gates: `CONTROLLER\.md`\); a lone one: the merge thread, before the check and any card, merges `main` in/);
  assert.match(read('repo/contracts/claude-projects/web-controller-projects/tasks/hourly-nudge.md'), /Flag `train due: <PR numbers>` when two or more PRs each have green CI and a G2 PASS at their current head, carry no bump of their own and no merge train holds them/);
});

test('build refuses a branch checked out in another worktree and changes nothing', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const other = path.join(f.root, 'other');
  f.git('worktree', 'add', '--quiet', '-b', 'toolkit-train/busy', other, f.main);
  f.git('switch', '--quiet', '--detach', f.main);
  const before = f.git('rev-parse', 'toolkit-train/busy');
  assert.throws(
    () => train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)] }), '--branch', 'toolkit-train/busy', '--main', 'main'], f.repo),
    /toolkit-train\/busy is checked out in another worktree/,
  );
  assert.equal(f.git('rev-parse', 'toolkit-train/busy'), before);
  assert.equal(f.git('rev-parse', 'HEAD'), f.main);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: other, encoding: 'utf8' }).stdout, '');
  const own = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)] }), '--branch', 'toolkit-train/free', '--main', 'main'], f.repo);
  assert.equal(own.ok, true, 'a branch no other worktree holds still builds');
});

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
  const verified = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo);
  assert.equal(verified.ok, true, verified.problems.join('\n'));
  assert.match(train.body(train.checkManifest(record)), /^Ejected: #2 at `[0-9a-f]{12}` \(failed its review after boarding\); its boarding is reverted by `[0-9a-f]{12}`, so it does not land with this train\.$/m);

  const again = train.run(['eject', '--manifest', out, '--pr', '3', '--reason', 'second thoughts', '--main', 'main'], f.repo);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.reverts[0].of, ejected.bump, 'a second eject replaces the re-bump');
  const twice = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/one', '--main', 'main'], f.repo);
  assert.equal(twice.ok, true, twice.problems.join('\n'));
  assert.throws(() => train.run(['eject', '--manifest', out, '--pr', '1', '--reason', 'last', '--main', 'main'], f.repo), /last member: close the train pull request instead/);
});

test('verify accepts only the recorded reverts, each identical to Git\'s own revert', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const before = JSON.parse(fs.readFileSync(out, 'utf8'));
  const result = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo);
  assert.equal(result.ok, true, JSON.stringify(result));
  const record = JSON.parse(fs.readFileSync(out, 'utf8'));
  const check = (value, head = 'toolkit-train/one') => {
    const file = path.join(f.root, 'check.json');
    fs.writeFileSync(file, JSON.stringify(value));
    return train.run(['verify', '--manifest', file, '--head', head, '--main', 'main'], f.repo);
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
  const refused = train.run(['eject', '--manifest', out, '--pr', '1', '--reason', 'failed review', '--main', 'main'], f.repo);
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
  const stacked = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, two), f.member(3, three)] }, 'stacked-in.json'), '--branch', 'toolkit-train/two', '--main', 'main', '--onto', first.result.head, '--out', out], f.repo);
  const result = train.run(['eject', '--manifest', out, '--pr', '3', '--reason', 'failed review', '--main', first.result.head], f.repo);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reverts.length, 1, 'no bump to replace on a stacked train');
  assert.equal(result.bump, null);
  assert.ok(stacked.head);

  const solo = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', solo.out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo);
  const live = path.join(f.root, 'live.json');
  const facts = { 60: { state: 'OPEN', head: ejected.head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } };
  fs.writeFileSync(live, JSON.stringify(facts));
  const waiting = train.run(['land', '--manifest', solo.out, '--pr', '60', '--head', ejected.head, '--main', 'main', '--live', live], f.repo);
  assert.equal(waiting.ok, false);
  assert.ok(waiting.problems.some(problem => /ejected #2 is still open at .* GitHub would mark it merged/.test(problem)), waiting.problems.join('\n'));
  fs.writeFileSync(live, JSON.stringify({ ...facts, 2: { state: 'OPEN', head: 'f'.repeat(40) } }));
  const ready = train.run(['land', '--manifest', solo.out, '--pr', '60', '--head', ejected.head, '--main', 'main', '--live', live], f.repo);
  assert.equal(ready.ok, true, ready.problems.join('\n'));
  fs.writeFileSync(live, JSON.stringify({ ...facts, 2: { state: 'CLOSED', head: two } }));
  assert.equal(train.run(['land', '--manifest', solo.out, '--pr', '60', '--head', ejected.head, '--main', 'main', '--live', live], f.repo).ok, true);

  // Once the running train lands, the stacked train catches up even though its head is an eject revert.
  f.git('switch', '--quiet', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', first.result.head);
  f.git('switch', '--quiet', 'toolkit-train/two');
  const caught = train.run(['catchup', '--manifest', out, '--main', 'main'], f.repo);
  assert.equal(caught.ok, true, JSON.stringify(caught));
  assert.ok(caught.bump, 'the bump comes after the catch-up merge');
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).stacked, undefined, 'catchup drops the stacked mark');
  const checked = train.run(['verify', '--manifest', out, '--head', 'toolkit-train/two', '--main', 'main'], f.repo);
  assert.equal(checked.ok, true, checked.problems.join('\n'));
  assert.equal(f.git('show', `${caught.head}:c.txt`), 'c');
  assert.equal(spawnSync('git', ['cat-file', '-e', `${caught.head}:d.txt`], { cwd: f.repo }).status !== 0, true, 'the ejected member stays out');
});

test('an ejected member rejoins a later train only once its branch restores the ejected change', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo);
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
    const result = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(2, head)] }, `${name}-in.json`), '--branch', `toolkit-train/${name}`, '--main', 'main', '--out', file], f.repo);
    return { result, file };
  };
  const refused = later('fix-only', fixOnly);
  assert.deepEqual(refused.result.boarded, []);
  assert.match(refused.result.ejected[0].reason, new RegExp(`without restoring it: on its branch merge main, then git revert --no-edit ${ejected.reverts[1].commit}`));
  f.git('switch', '--quiet', '-C', 'by-hand', 'main');
  f.git('merge', '--quiet', '--no-ff', '--no-edit', fixOnly);
  const byHand = train.run(['verify', '--manifest', f.manifestFile({ members: [f.member(2, fixOnly, { bump: 'none' })], bump_command: 'none' }, 'by-hand.json'), '--head', 'by-hand', '--main', 'main'], f.repo);
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
  const checked = train.run(['verify', '--manifest', rejoined.file, '--head', rejoined.result.head, '--main', 'main'], f.repo);
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
  const refused = train.run(['eject', '--manifest', out, '--pr', '1', '--reason', 'failed review', '--main', 'main'], f.repo);
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
  const checked = train.run(['verify', '--manifest', manifest, '--head', 'by-hand', '--main', 'main'], f.repo);
  assert.ok(checked.problems.some(problem => /#2 is built on ejected #1: it cannot land without the change it was reviewed on/.test(problem)), checked.problems.join('\n'));
});

test('after an eject train lands, other pull requests made from main board and verify; only the ejected one is held', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { out } = built(f, [f.member(1, one), f.member(2, two)]);
  const ejected = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo);
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
  const result = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(5, fresh), f.member(1, mergedMain)] }, 'after-in.json'), '--branch', 'toolkit-train/after', '--main', 'main', '--out', file], f.repo);
  assert.deepEqual(result.boarded, [5, 1], JSON.stringify(result.ejected));
  const checked = train.run(['verify', '--manifest', file, '--head', result.head, '--main', 'main'], f.repo);
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
  const ejected = train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'failed review', '--main', 'main'], f.repo);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 70: { state: 'OPEN', head: ejected.head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: early } }));
  const refused = train.run(['land', '--manifest', out, '--pr', '70', '--head', ejected.head, '--main', 'main', '--live', live], f.repo);
  assert.ok(refused.problems.some(problem => new RegExp(`ejected #2 is still open at ${early.slice(0, 12)}, which the train carries`).test(problem)), refused.problems.join('\n'));
});

test('verify refuses a train that drops its bump, stacked or not, and land refuses a stacked train', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two, { bump: 'minor' })]);
  const noBump = f.git('rev-parse', `${result.head}~1`);
  const dropped = train.run(['verify', '--manifest', out, '--head', noBump, '--main', 'main'], f.repo);
  assert.equal(dropped.ok, false);
  assert.ok(dropped.problems.some(problem => /the train has no bump commit/.test(problem)), dropped.problems.join('\n'));
  const quiet = path.join(f.root, 'quiet.json');
  fs.writeFileSync(quiet, JSON.stringify({ ...JSON.parse(fs.readFileSync(out, 'utf8')), members: [f.member(1, one, { bump: 'none' }), f.member(2, two, { bump: 'none' })] }));
  assert.equal(train.run(['verify', '--manifest', quiet, '--head', noBump, '--main', 'main'], f.repo).ok, true, 'members that need no bump need no bump commit');
  const three = f.branch('pr-3', { 'd.txt': 'd\n' });
  const stackedOut = path.join(f.root, 'stacked.json');
  const stacked = train.run(['build', '--manifest', f.manifestFile({ members: [f.member(3, three)] }, 'stacked-in.json'), '--branch', 'toolkit-train/next', '--main', 'main', '--onto', result.head, '--out', stackedOut], f.repo);
  assert.equal(JSON.parse(fs.readFileSync(stackedOut, 'utf8')).stacked, true);
  const stackedCheck = train.run(['verify', '--manifest', stackedOut, '--head', stacked.head, '--main', result.head], f.repo);
  assert.equal(stackedCheck.ok, false, 'a stacked train has no bump until catchup');
  assert.ok(stackedCheck.problems.some(problem => /the train has no bump commit: build it on main, or run catchup on a stacked train/.test(problem)), stackedCheck.problems.join('\n'));
  assert.throws(() => train.checkManifest({ members: [f.member(4, '4'.repeat(40))], stacked: 'yes' }), /"stacked" must be true or false/);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 80: { state: 'OPEN', head: stacked.head }, 3: { state: 'OPEN', head: three } }));
  const landing = train.run(['land', '--manifest', stackedOut, '--pr', '80', '--head', stacked.head, '--main', result.head, '--live', live], f.repo);
  assert.equal(landing.ok, false, 'a stacked train never lands, even against the train it stacks on');
  assert.ok(landing.problems.some(problem => /the train is stacked .* catch it up on main first/.test(problem)), landing.problems.join('\n'));
  const flagged = path.join(f.root, 'flagged.json');
  fs.writeFileSync(flagged, JSON.stringify({ ...JSON.parse(fs.readFileSync(out, 'utf8')), stacked: true }));
  fs.writeFileSync(live, JSON.stringify({ 81: { state: 'OPEN', head: noBump }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } }));
  const dodged = train.run(['land', '--manifest', flagged, '--pr', '81', '--head', noBump, '--main', 'main', '--live', live], f.repo);
  assert.equal(dodged.ok, false, 'marking a train on main stacked does not dodge its bump at land');
  assert.ok(dodged.problems.some(problem => /the train is stacked .* catch it up on main first/.test(problem)), dodged.problems.join('\n'));
  assert.ok(dodged.problems.some(problem => /the train has no bump commit/.test(problem)), dodged.problems.join('\n'));
});
