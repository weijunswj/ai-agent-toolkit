'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const report = require('../scripts/workspace-residue-report.cjs');

const tempFolders = [];
test.after(() => { for (const dir of tempFolders) fs.rmSync(dir, { recursive: true, force: true }); });

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function sink() {
  let text = '';
  return { write: (chunk) => { text += chunk; return true; }, text: () => text };
}

// One checkout with a worktree in each state the report tells apart, built once for the file; the
// report only reads it.
let built = null;
function fixture() {
  if (!built) built = buildFixture();
  return built;
}

function buildFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-residue-')));
  tempFolders.push(root);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.tmp/\n.env\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const lanes = path.join(repo, '.tmp', 'worktrees');
  const add = (name, branch) => {
    const where = path.join(lanes, name);
    git(repo, ['worktree', 'add', '-q', '-b', branch, where]);
    return where;
  };
  const merged = add('merged', 'lane/merged');
  const dirty = add('dirty', 'lane/dirty');
  fs.writeFileSync(path.join(dirty, 'secret-looking.txt'), 'TOKEN=do-not-read\n');
  const locked = add('locked', 'lane/locked');
  git(repo, ['worktree', 'lock', locked]);
  const unmerged = add('unmerged', 'lane/unmerged');
  fs.writeFileSync(path.join(unmerged, 'b.txt'), 'b\n');
  git(unmerged, ['add', '.']);
  git(unmerged, ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-q', '-m', 'lane work']);
  const ignored = add('ignored', 'lane/ignored');
  fs.mkdirSync(path.join(ignored, '.tmp'));
  fs.writeFileSync(path.join(ignored, '.tmp', 'run-stream.jsonl'), '{}\n');
  fs.writeFileSync(path.join(ignored, '.env'), 'KEY=do-not-read\n');
  const gone = add('gone', 'lane/gone');
  fs.rmSync(gone, { recursive: true, force: true });
  const host = path.join(repo, '.claude', 'worktrees', 'host-lane');
  git(repo, ['worktree', 'add', '-q', '-b', 'host/lane', host]);
  git(repo, ['branch', 'old/merged']);
  git(repo, ['branch', 'old/unmerged', 'lane/unmerged']);
  // The primary checkout sits on a lane branch, so the default branch is listed and must be kept.
  git(repo, ['switch', '-q', '-c', 'lane/active']);
  return { repo, merged, dirty, ignored, locked, unmerged, gone, host };
}

// A checkout on main whose primary is on lane/primary, with one extra worktree per name. Each worktree
// is on its own lane branch at the base commit; spaces in a name become dashes in its branch.
function makeCheckout(names) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-residue-')));
  tempFolders.push(root);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['switch', '-q', '-c', 'lane/primary']);
  const paths = {};
  for (const name of names) {
    paths[name] = path.join(repo, '.tmp', 'worktrees', name);
    git(repo, ['worktree', 'add', '-q', '-b', `lane/${name.replace(/ /g, '-')}`, paths[name]]);
  }
  return { repo, paths };
}

// Checkouts shared by the tests that only read them. A test that changes a checkout builds its own.
let lists = null;
function listFixture() {
  if (!lists) lists = makeCheckout(['one', 'two', 'three']);
  return lists;
}

let singles = null;
function singleFixture() {
  if (!singles) {
    singles = makeCheckout(['ready', 'dirty', 'with space']);
    fs.writeFileSync(path.join(singles.paths.dirty, 'scratch.txt'), 'kept\n');
  }
  return singles;
}

// Worktrees made at fixed times: fresh 2.5 hours before NOW, old 30 hours before, and gone with its folder removed.
const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-23T12:00:00Z');
let ages = null;
function ageFixture() {
  if (!ages) {
    ages = makeCheckout(['fresh', 'old', 'gone']);
    const before = (hours) => new Date(NOW - hours * HOUR_MS);
    fs.utimesSync(path.join(ages.paths.fresh, '.git'), before(2.5), before(2.5));
    fs.utimesSync(path.join(ages.paths.old, '.git'), before(30), before(30));
    fs.rmSync(ages.paths.gone, { recursive: true, force: true });
  }
  return ages;
}

test('the report sorts worktrees and branches into ready to remove and look first, and changes nothing', () => {
  const f = fixture();
  const before = git(f.repo, ['worktree', 'list', '--porcelain']);
  const branchesBefore = git(f.repo, ['branch', '--list']);
  const result = report.collect(f.repo, 'main');
  const byPath = new Map(result.worktrees.map((item) => [path.basename(item.path), item]));
  assert.equal(result.worktrees.length, 7);
  assert.equal(byPath.get('merged').ready, true);
  assert.equal(byPath.get('merged').place, 'repo .tmp/worktrees');
  assert.equal(byPath.get('merged').path, '.tmp/worktrees/merged', 'paths are relative to the checkout');
  assert.equal(result.repo, 'repo', 'no home folder is printed');
  assert.deepEqual(byPath.get('dirty').reasons, ['1 uncommitted change(s)']);
  // git worktree remove deletes ignored files without --force, so kept evidence and .env stop removal.
  assert.deepEqual(byPath.get('ignored').reasons, ['2 ignored item(s) that git worktree remove deletes']);
  assert.equal(byPath.get('ignored').ready, false);
  assert.deepEqual(byPath.get('locked').reasons, ['locked']);
  assert.deepEqual(byPath.get('unmerged').reasons, ['commit not in main']);
  assert.equal(byPath.get('gone').exists, false);
  assert.match(byPath.get('gone').reasons.join(), /folder is gone/);
  assert.equal(byPath.get('host-lane').place, 'Claude Code');
  assert.deepEqual(byPath.get('host-lane').reasons, ['host-made, left to the host']);

  const branches = new Map(result.branches.map((item) => [item.name, item]));
  assert.equal(branches.has('lane/active'), false, 'the current branch is not listed');
  assert.deepEqual(branches.get('main').reasons, ['default branch, keep']);
  // A base given as a commit names no branch and this checkout has no remote HEAD: main is still kept.
  const byCommit = report.collect(f.repo, git(f.repo, ['rev-parse', 'main']));
  assert.deepEqual(byCommit.branches.find((item) => item.name === 'main').reasons, ['default branch, keep']);
  assert.equal(branches.get('main').ready, false);
  assert.equal(branches.get('old/merged').ready, true);
  assert.deepEqual(branches.get('old/unmerged').reasons, ['not merged into main']);
  assert.deepEqual(branches.get('lane/merged').reasons, ['checked out in a worktree']);

  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']), before, 'no worktree record changed');
  assert.equal(git(f.repo, ['branch', '--list']), branchesBefore, 'no branch changed');
  assert.equal(fs.existsSync(f.dirty), true);
  assert.equal(fs.readFileSync(path.join(f.dirty, 'secret-looking.txt'), 'utf8'), 'TOKEN=do-not-read\n');
  assert.equal(fs.existsSync(path.join(f.ignored, '.env')), true);
});

test('the report reads no file contents inside the worktrees', () => {
  const f = fixture();
  const reads = [];
  const originals = { readFileSync: fs.readFileSync, openSync: fs.openSync, createReadStream: fs.createReadStream };
  try {
    for (const name of Object.keys(originals)) {
      fs[name] = (target, ...rest) => { reads.push(String(target)); return originals[name](target, ...rest); };
    }
    report.collect(f.repo, 'main');
  } finally {
    Object.assign(fs, originals);
  }
  assert.deepEqual(reads.filter((item) => item.startsWith(f.repo)), []);
});

test('the text report names what to run and never suggests --force or -D as an action', () => {
  const f = fixture();
  const out = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main'], { out, err: sink() }), 0);
  const text = out.text();
  assert.match(text, /Nothing was changed\./);
  assert.match(text, /ready to remove: \.tmp\/worktrees\/merged \[lane\/merged, repo \.tmp\/worktrees\]/);
  for (const form of [path.dirname(f.repo), path.dirname(f.repo).replace(/\\/g, '/')]) assert.ok(!text.includes(form), 'no absolute path is printed');
  assert.match(text, /look first: .*dirty .*\(1 uncommitted change\(s\)\)/);
  assert.match(text, /git worktree remove <path>, then git worktree prune\. A ready branch: git branch -d <name>\. Never --force or -D\./);
  const json = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--json'], { out: json, err: sink() }), 0);
  assert.equal(JSON.parse(json.text()).schema, 'toolkit-workspace-residue/v1');
});

test('the report refuses a folder that is not a checkout, an unknown base and unknown arguments', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-residue-plain-'));
  tempFolders.push(plain);
  const err = sink();
  assert.equal(report.main(['--repo', plain], { out: sink(), err }), 2);
  assert.match(err.text(), /is not a git checkout/);
  const f = fixture();
  const err2 = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'no-such-ref'], { out: sink(), err: err2 }), 2);
  assert.match(err2.text(), /is not known here/);
  assert.throws(() => report.parseArgs(['--delete']), /Unknown argument/);
  assert.throws(() => report.parseArgs(['--repo']), /needs a value/);
});

test('the time budget stops the worktree loop, lists the rest as not checked and marks the report incomplete', () => {
  const f = listFixture();
  let now = 0;
  const result = report.collect(f.repo, 'main', { budgetMs: 1000, nowMs: () => now, onWorktree: () => { now += 1500; } });
  assert.equal(result.complete, false);
  assert.equal(result.worktrees.length, 3);
  assert.equal(result.worktrees.filter((item) => item.checked).length, 1);
  for (const item of result.worktrees.filter((entry) => !entry.checked)) {
    assert.equal(item.ready, false);
    assert.equal(item.changes, null);
    assert.deepEqual(item.reasons, ['not checked (time budget reached)']);
  }
  assert.match(report.render(result), /Stopped at the time budget: 2 worktrees not checked; run again with a larger --budget-ms\./);
  assert.equal(report.collect(f.repo, 'main').complete, true, 'a run inside the default budget is complete');
});

test('each git call in the worktree loop gets the time left as its timeout, never under a second', () => {
  const f = listFixture();
  let now = 0;
  const calls = [];
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ name: args[0], timeout: options.timeout, elapsed: now });
    return original(command, args, options);
  };
  let result;
  try {
    result = report.collect(f.repo, 'main', { budgetMs: 10000, nowMs: () => now, onWorktree: () => { now += 9500; } });
  } finally {
    childProcess.spawnSync = original;
  }
  // The first worktree gets the whole budget, the second gets 500 ms left (raised to 1000), the third is not checked.
  // Branch checks run after the budget is spent and are not part of the loop.
  const loop = calls.filter((call) => ['status', 'merge-base'].includes(call.name) && call.elapsed < 10000);
  assert.deepEqual(loop.map((call) => call.timeout), [10000, 10000, 1000, 1000]);
  assert.equal(result.complete, false);
});

test('--budget-ms must be a whole number of at least 1000 milliseconds, and defaults to 60000', () => {
  assert.equal(report.parseArgs([]).budgetMs, 60000);
  assert.equal(report.parseArgs(['--budget-ms', '1000']).budgetMs, 1000);
  for (const value of ['5', 'abc', '1.5']) {
    assert.throws(() => report.parseArgs(['--budget-ms', value]), /--budget-ms needs a whole number of milliseconds, at least 1000\./);
  }
  const err = sink();
  assert.equal(report.main(['--budget-ms', '5'], { out: sink(), err }), 2);
  assert.match(err.text(), /^--budget-ms needs a whole number of milliseconds, at least 1000\./);
});

test('text mode writes each worktree line as soon as it is checked, and each line once', () => {
  const f = listFixture();
  const events = [];
  let text = '';
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (args[0] === 'status') events.push('check');
    return original(command, args, options);
  };
  try {
    const out = { write: (chunk) => { events.push(chunk); text += chunk; return true; } };
    assert.equal(report.main(['--repo', f.repo, '--base', 'main'], { out, err: sink() }), 0);
  } finally {
    childProcess.spawnSync = original;
  }
  const lastCheck = events.lastIndexOf('check');
  const firstLine = events.findIndex((event) => event.startsWith('- ') && event.includes('.tmp/worktrees/'));
  assert.ok(lastCheck > 0 && firstLine >= 0 && firstLine < lastCheck, 'a worktree line is written before the last worktree is checked');
  assert.equal(text.split('.tmp/worktrees/one [').length - 1, 1, 'each worktree line is written once');
  assert.doesNotMatch(text, /Stopped at the time budget/);
});

test('the usage line lists the budget, age and worktree options', () => {
  const out = sink();
  assert.equal(report.main(['--help'], { out, err: sink() }), 0);
  for (const option of ['[--budget-ms <n>]', '[--min-age-hours <n>]', '[--worktree <path>]']) {
    assert.ok(out.text().includes(option), option);
  }
});

test('each worktree reports its age in whole hours, and null when its .git file cannot be read', () => {
  const f = ageFixture();
  const byName = new Map(report.collect(f.repo, 'main', { nowMs: () => NOW }).worktrees.map((item) => [path.basename(item.path), item]));
  assert.equal(byName.get('fresh').age_hours, 2);
  assert.equal(byName.get('old').age_hours, 30);
  assert.equal(byName.get('gone').age_hours, null);
});

test('--min-age-hours keeps a worktree made more recently than that out of the ready list', () => {
  const f = ageFixture();
  const byName = new Map(report.collect(f.repo, 'main', { nowMs: () => NOW, minAgeHours: 24 }).worktrees.map((item) => [path.basename(item.path), item]));
  assert.equal(byName.get('old').ready, true);
  assert.equal(byName.get('fresh').ready, false);
  assert.deepEqual(byName.get('fresh').reasons, ['made less than 24 hours ago']);
  assert.match(byName.get('gone').reasons.join(), /age unreadable/);
  for (const value of ['-1', '1.5', 'abc']) {
    assert.throws(() => report.parseArgs(['--min-age-hours', value]), /--min-age-hours needs a whole number of hours, 0 or more\./);
  }
  assert.equal(report.parseArgs(['--min-age-hours', '0']).minAgeHours, 0);
});

test('--worktree prints only the safe removal lines for a ready worktree', () => {
  const f = singleFixture();
  const out = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths.ready], { out, err: sink() }), 0);
  assert.equal(out.text(), 'git worktree remove .tmp/worktrees/ready\ngit branch -d lane/ready\n');
});

test('--worktree says why a worktree is not ready and prints no command', () => {
  const f = singleFixture();
  const out = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths.dirty], { out, err: sink() }), 0);
  assert.equal(out.text(), 'Not ready to remove: 1 uncommitted change(s)\n');
});

test('--worktree JSON adds remove_commands, empty when not ready, and lists no branches', () => {
  const f = singleFixture();
  const readyOut = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths.ready, '--json'], { out: readyOut, err: sink() }), 0);
  const ready = JSON.parse(readyOut.text());
  assert.equal(ready.schema, 'toolkit-workspace-residue/v1');
  assert.equal(ready.complete, true);
  assert.deepEqual(ready.remove_commands, ['git worktree remove .tmp/worktrees/ready', 'git branch -d lane/ready']);
  assert.deepEqual(ready.branches, []);
  const dirtyOut = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths.dirty, '--json'], { out: dirtyOut, err: sink() }), 0);
  assert.deepEqual(JSON.parse(dirtyOut.text()).remove_commands, []);
});

test('--worktree refuses the primary checkout and a path that is not a worktree of this checkout', () => {
  const f = singleFixture();
  assert.throws(() => report.collect(f.repo, 'main', { worktree: f.repo }), { message: 'The primary checkout is not an extra worktree.' });
  const missing = path.join(f.repo, '.tmp', 'worktrees', 'nope');
  assert.throws(() => report.collect(f.repo, 'main', { worktree: missing }), { message: '.tmp/worktrees/nope is not a worktree of this checkout.' });
  const err = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', missing], { out: sink(), err }), 2);
  assert.match(err.text(), /^\.tmp\/worktrees\/nope is not a worktree of this checkout\./);
});

test('--worktree matches the path case-insensitively on Windows only', () => {
  const f = singleFixture();
  const out = sink();
  const code = report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths.ready.toUpperCase()], { out, err: sink() });
  if (process.platform === 'win32') {
    assert.equal(code, 0);
    assert.equal(out.text(), 'git worktree remove .tmp/worktrees/ready\ngit branch -d lane/ready\n');
  } else {
    assert.equal(code, 2, 'a case-sensitive file system does not match the upper-case path');
  }
});

test('--worktree leaves the branch alone while another worktree also has it checked out', () => {
  const f = makeCheckout(['one']);
  git(f.repo, ['worktree', 'add', '-q', '-f', path.join(f.repo, '.tmp', 'worktrees', 'again'), 'lane/one']);
  const out = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths.one], { out, err: sink() }), 0);
  assert.equal(out.text(), 'git worktree remove .tmp/worktrees/one\n');
});

test('--worktree never offers the default branch for deletion', () => {
  const f = makeCheckout(['d']);
  const onMain = path.join(f.repo, '.tmp', 'worktrees', 'on-main');
  git(f.repo, ['worktree', 'add', '-q', onMain, 'main']);
  const out = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', onMain], { out, err: sink() }), 0);
  assert.equal(out.text(), 'git worktree remove .tmp/worktrees/on-main\n');
});

test('--worktree quotes a shown path that has a space', () => {
  const f = singleFixture();
  const out = sink();
  assert.equal(report.main(['--repo', f.repo, '--base', 'main', '--worktree', f.paths['with space']], { out, err: sink() }), 0);
  assert.equal(out.text(), 'git worktree remove ".tmp/worktrees/with space"\ngit branch -d lane/with-space\n');
});
