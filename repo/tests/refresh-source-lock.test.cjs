'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.resolve(__dirname, '..', 'scripts', 'refresh-source-lock.cjs');
const LOCK = 'repo/source-watch/provenance/widgets/SOURCE-LOCK.json';
const bases = [];

test.after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitFiles(clone, files) {
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(clone, rel);
    if (body === null) fs.rmSync(target);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
  }
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'step');
  return git(clone, 'rev-parse', 'HEAD');
}

function fixture({ adaptedChanges = false, exactGone = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-source-lock-'));
  bases.push(base);
  const clone = path.join(base, 'upstream');
  const root = path.join(base, 'toolkit');
  fs.mkdirSync(clone);
  git(clone, 'init', '-q');
  git(clone, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
  const pinned = commitFiles(clone, {
    'data/a.csv': 'a,b\r\n1,2\r\n',
    'data/gone.csv': 'x\n',
    'scripts/core.py': 'print(1)\n'
  });
  const blob = (rel) => git(clone, 'rev-parse', `${pinned}:${rel}`);
  const lock = {
    source_repo: 'acme/widgets',
    source_commit: pinned,
    files: [
      { mode: 'exact', source_path: 'data/a.csv', root_surface_path: 'skills/w/data/a.csv', source_blob_sha: blob('data/a.csv') },
      { mode: 'adapted', source_path: 'scripts/core.py', root_surface_path: 'skills/w/core.py', source_blob_sha: blob('scripts/core.py') },
      { mode: 'excluded', source_path: 'data/gone.csv', notes: 'not needed' }
    ]
  };
  fs.mkdirSync(path.join(root, path.dirname(LOCK)), { recursive: true });
  fs.writeFileSync(path.join(root, LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'skills/w/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills/w/data/a.csv'), 'a,b\r\n1,2\r\n');
  const head = commitFiles(clone, {
    'data/a.csv': exactGone ? null : 'a,b\n1,3\n',
    'data/gone.csv': null,
    'data/new.csv': 'n\n',
    'scripts/core.py': adaptedChanges ? 'print(2)\n' : 'print(1)\n'
  });
  return { root, clone, head, lockBefore: fs.readFileSync(path.join(root, LOCK), 'utf8') };
}

function run(f, ...extra) {
  return spawnSync(process.execPath, [script, '--root', f.root, '--lock', LOCK, '--clone', f.clone, '--commit', f.head, ...extra], { encoding: 'utf8' });
}

test('dry run plans the refresh and writes nothing; --write copies exact bytes and moves the pins', () => {
  const f = fixture();
  const dry = run(f);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^EXACT data\/a\.csv /m);
  assert.match(dry.stdout, /^DROP-EXCLUDED data\/gone\.csv$/m);
  assert.match(dry.stdout, /^NEW-UPSTREAM data\/new\.csv$/m);
  assert.equal(fs.readFileSync(path.join(f.root, LOCK), 'utf8'), f.lockBefore);

  const write = run(f, '--write');
  assert.equal(write.status, 0, write.stdout + write.stderr);
  assert.equal(fs.readFileSync(path.join(f.root, 'skills/w/data/a.csv'), 'utf8'), 'a,b\n1,3\n');
  const lock = JSON.parse(fs.readFileSync(path.join(f.root, LOCK), 'utf8'));
  assert.equal(lock.source_commit, f.head);
  assert.deepEqual(lock.files.map((entry) => `${entry.mode} ${entry.source_path}`), ['exact data/a.csv', 'adapted scripts/core.py', 'excluded data/new.csv']);
  assert.equal(lock.files[0].source_blob_sha, git(f.clone, 'rev-parse', `${f.head}:data/a.csv`));
});

test('a changed adapted file or a vanished exact file refuses --write until a person decides', () => {
  const adapted = fixture({ adaptedChanges: true });
  const refused = run(adapted, '--write');
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^REFUSED ADAPTED scripts\/core\.py changed upstream/m);
  assert.equal(fs.readFileSync(path.join(adapted.root, LOCK), 'utf8'), adapted.lockBefore);
  assert.equal(fs.readFileSync(path.join(adapted.root, 'skills/w/data/a.csv'), 'utf8'), 'a,b\r\n1,2\r\n');

  const reviewed = run(adapted, '--write', '--adapted-reviewed');
  assert.equal(reviewed.status, 0, reviewed.stdout + reviewed.stderr);
  const lock = JSON.parse(fs.readFileSync(path.join(adapted.root, LOCK), 'utf8'));
  assert.equal(lock.files[1].source_blob_sha, git(adapted.clone, 'rev-parse', `${adapted.head}:scripts/core.py`));

  const gone = fixture({ exactGone: true });
  const goneRun = run(gone, '--write');
  assert.equal(goneRun.status, 1);
  assert.match(goneRun.stdout, /^REFUSED GONE exact data\/a\.csv/m);
  assert.equal(fs.readFileSync(path.join(gone.root, LOCK), 'utf8'), gone.lockBefore);
});

test('a clone of another repository is rejected', () => {
  const f = fixture();
  git(f.clone, 'remote', 'set-url', 'origin', 'https://github.com/someone/else.git');
  const result = run(f, '--write');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not a clone of acme\/widgets/);
  assert.equal(fs.readFileSync(path.join(f.root, LOCK), 'utf8'), f.lockBefore);
});
