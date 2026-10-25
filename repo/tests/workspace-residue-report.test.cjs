'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
