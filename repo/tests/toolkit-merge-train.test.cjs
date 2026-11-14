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
  assert.match(finish, /\*\*Merge trains:\*\* two or more merge-ready PRs/);
  assert.match(finish, /Never hand-fix a train: a conflict, moved head or failed bump ejects that member; red CI splits it \(`split`\)/);
  assert.match(finish, /RISKY members each need the owner's typed OK/);
  const guide = read('repo/docs/changelog.d/README.md');
  for (const command of ['build', 'verify', 'body', 'land']) assert.match(guide, new RegExp(`toolkit-merge-train\\.cjs ${command} --manifest`));
  assert.match(guide, /\*\*Batches:\*\* several merge-ready pull requests land as one merge train that bumps once/);
  assert.match(read('repo/ARCHITECTURE.md'), /`repo\/scripts\/toolkit-merge-train\.cjs` \(`build`, `verify`, `body`, `split`, `land`; never merges/);
  assert.match(read('repo/contracts/claude-projects/web-controller-projects/SKILL.md'), /Two or more ready PRs ride one merge train \(`CONTROLLER\.md`\)\./);
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
