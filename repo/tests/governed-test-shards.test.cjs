'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const governed = require('../scripts/governed-test-shards.cjs');
const runTests = require('../scripts/run-tests.cjs');
const v1 = require('../scripts/ci-test-shards.cjs');

const SYSTEM = process.platform === 'win32' ? 'windows' : 'linux';
const NODE = process.execPath;
const python = ['python3', 'python'].find((name) => spawnSync(name, ['--version'], { windowsHide: true }).status === 0) || null;

function repo(t, files, manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-shards-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  if (manifest) {
    fs.mkdirSync(path.join(root, '.github'), { recursive: true });
    fs.writeFileSync(path.join(root, ...governed.MANIFEST_REL.split('/')), JSON.stringify(manifest));
  }
  return root;
}

const nodeList = (shards, extra = {}) => ({ schema: governed.MANIFEST_SCHEMA, systems: { [SYSTEM]: { command: [NODE, '--test', '{files}'], discover: 'tests/**/*.test.js', shards } }, ...extra });
const PASS = "require('node:test')('ok', () => {});\n";
const FAIL = "require('node:test')('bad', () => { throw new Error('boom'); });\n";
const sink = () => { let text = ''; return { write: (chunk) => { text += chunk; }, get text() { return text; } }; };

test('a v2 list runs each file through its command, named shards and the rest shard covering every file once', async (t) => {
  const root = repo(t, { 'tests/a.test.js': PASS, 'tests/deep/b.test.js': PASS, 'tests/c.test.js': PASS, 'tests/helper.js': 'x' },
    nodeList([{ id: `${SYSTEM}-1`, files: ['tests/a.test.js'] }, { id: `${SYSTEM}-2`, rest: true }]));
  const manifest = governed.loadManifest(root);
  const found = governed.discoverAll(root, manifest);
  assert.deepEqual(found[SYSTEM], ['tests/a.test.js', 'tests/c.test.js', 'tests/deep/b.test.js'], 'the glob finds nested files and skips helpers');
  assert.deepEqual(governed.manifestErrors(manifest, found), []);
  assert.deepEqual(governed.resolveShard(manifest, SYSTEM, `${SYSTEM}-2`, found), ['tests/c.test.js', 'tests/deep/b.test.js'], 'a file no shard names goes to the rest shard');
  const out = sink();
  const { exitCode, summary } = await governed.runShard({ root, manifest, system: SYSTEM, shardId: `${SYSTEM}-2`, out });
  assert.equal(exitCode, 0, out.text);
  assert.equal(summary.schema, v1.SUMMARY_SCHEMA, 'the same summary Toolkit shards write');
  assert.deepEqual(summary.files.map((entry) => [entry.file, entry.passed, entry.failed]), [['tests/c.test.js', 1, 0], ['tests/deep/b.test.js', 1, 0]]);
  assert.ok(summary.files.every((entry) => typeof entry.seconds === 'number' && entry.seconds >= 0), 'each file is timed');
  assert.match(out.text, /--- tests\/c\.test\.js/);
});

test('a failing file fails the shard and is named; the others still run', async (t) => {
  const root = repo(t, { 'tests/a.test.js': PASS, 'tests/b.test.js': FAIL }, nodeList([{ id: `${SYSTEM}-1`, rest: true }]));
  const out = sink();
  const { exitCode, summary } = await governed.runShard({ root, manifest: governed.loadManifest(root), system: SYSTEM, shardId: `${SYSTEM}-1`, out });
  assert.equal(exitCode, 1);
  assert.deepEqual(summary.files.map((entry) => [entry.file, entry.passed]), [['tests/a.test.js', 1], ['tests/b.test.js', 0]]);
  assert.match(summary.files[1].error, /exit code [1-9]/);
  assert.match(out.text, /FAILED tests\/b\.test\.js/);
});

test('a test program that is not installed fails each file by name, without a shell and without throwing', async (t) => {
  const root = repo(t, { 'tests/a.test.js': PASS }, { schema: governed.MANIFEST_SCHEMA, systems: { [SYSTEM]: { command: ['toolkit-no-such-program-xyz', '{files}'], discover: 'tests/*.test.js', shards: [{ id: `${SYSTEM}-1`, rest: true }] } } });
  const out = sink();
  const { exitCode, summary } = await governed.runShard({ root, manifest: governed.loadManifest(root), system: SYSTEM, shardId: `${SYSTEM}-1`, out });
  assert.equal(exitCode, 1);
  assert.match(summary.files[0].error, /toolkit-no-such-program-xyz was not found/);
});

test('a file name reaches the program as one argument, never as shell syntax', async (t) => {
  const root = repo(t, { 'tests/a;echo hi.test.js': PASS }, nodeList([{ id: `${SYSTEM}-1`, rest: true }]));
  const seen = [];
  const fake = (program, args, options) => {
    seen.push({ program, args, shell: options.shell });
    const { EventEmitter } = require('node:events');
    const child = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const { exitCode } = await governed.runShard({ root, manifest: governed.loadManifest(root), system: SYSTEM, shardId: `${SYSTEM}-1`, spawnFn: fake, out: sink() });
  assert.equal(exitCode, 0);
  assert.deepEqual(seen, [{ program: NODE, args: ['--test', 'tests/a;echo hi.test.js'], shell: false }]);
});

test('a file that hangs is stopped at file_timeout_seconds and fails by name, and the others still finish', async (t) => {
  const HANG = "setTimeout(() => {}, 60000);\n";
  const root = repo(t, { 'tests/a.test.js': PASS, 'tests/hang.test.js': HANG },
    nodeList([{ id: `${SYSTEM}-1`, rest: true }], { file_timeout_seconds: 1 }));
  const started = Date.now();
  const { exitCode, summary } = await governed.runShard({ root, manifest: governed.loadManifest(root), system: SYSTEM, shardId: `${SYSTEM}-1`, out: sink() });
  assert.equal(exitCode, 1);
  assert.ok(Date.now() - started < 30000, 'the hung file is stopped, not waited out');
  assert.deepEqual(summary.files.map((entry) => [entry.file, entry.passed, entry.error || null]), [['tests/a.test.js', 1, null], ['tests/hang.test.js', 0, 'timed out after 1 s']]);
  assert.equal(governed.DEFAULT_FILE_TIMEOUT_SECONDS, 900);
});

test('Python tests run through the same command mode', { skip: python ? false : 'no python on this machine' }, async (t) => {
  const root = repo(t, { 'tests/test_ok.py': 'assert 1 + 1 == 2\n', 'tests/test_bad.py': 'raise SystemExit(3)\n' },
    { schema: governed.MANIFEST_SCHEMA, systems: { [SYSTEM]: { command: [python, '{files}'], discover: 'tests/test_*.py', shards: [{ id: `${SYSTEM}-1`, rest: true }] } } });
  const { exitCode, summary } = await governed.runShard({ root, manifest: governed.loadManifest(root), system: SYSTEM, shardId: `${SYSTEM}-1`, out: sink() });
  assert.equal(exitCode, 1);
  assert.deepEqual(summary.files.map((entry) => [entry.file, entry.passed, entry.error || null]), [['tests/test_bad.py', 0, 'exit code 3'], ['tests/test_ok.py', 1, null]]);
});

test('the list refuses shells, a missing or doubled {files}, bad globs, unknown keys and broken shards', () => {
  const found = { linux: ['tests/a.py', 'tests/b.py'] };
  const base = { schema: governed.MANIFEST_SCHEMA, systems: { linux: { command: ['python', '-m', 'pytest', '{files}'], discover: 'tests/*.py', shards: [{ id: 'linux-1', files: ['tests/a.py'] }, { id: 'linux-2', rest: true }] } } };
  assert.deepEqual(governed.manifestErrors(base, found), []);
  const withLinux = (change) => ({ ...base, systems: { linux: { ...base.systems.linux, ...change } } });
  const cases = [
    [withLinux({ command: ['bash', '-c', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['/usr/bin/env', 'pytest', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['pwsh.exe', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['C:\\Windows\\System32\\CMD.EXE', '/c', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['/usr/bin/bash.exe', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['busybox', 'sh', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['xargs', 'pytest', '{files}'] }), /may not start with a shell/],
    [withLinux({ command: ['pytest', 'tests'] }), /exactly once/],
    [withLinux({ command: ['pytest', '{files}', '{files}'] }), /exactly once/],
    [withLinux({ command: ['pytest --x {files}'] }), /at least two/],
    [withLinux({ discover: '../tests/*.py' }), /\.\./],
    [withLinux({ discover: 'C:/tests/*.py' }), /relative/],
    [withLinux({ discover: 'tests/[ab].py' }), /only \*, \*\* and \?/],
    [withLinux({ shards: [{ id: 'linux-1', files: ['tests/c.py'] }, { id: 'linux-2', rest: true }] }), /not a file discover finds/],
    [withLinux({ shards: [{ id: 'linux-1', files: ['tests/a.py', 'tests/b.py'] }, { id: 'linux-2', rest: true }] }), /rest shard is empty/],
    [withLinux({ shards: [{ id: 'linux-1', files: ['tests/a.py'] }] }), /exactly one shard must be the rest shard/],
    [withLinux({ shell: true }), /unknown key shell/],
    [{ ...base, schema: 'toolkit-test-shards/v1' }, /schema must be toolkit-test-shards\/v2/],
    [{ ...base, workflow: '../validate.yml' }, /workflow must be a file name/],
    [{ ...base, systems: { mac: base.systems.linux } }, /unknown system mac/],
    [{ ...base, durations_seconds: { windows: {} } }, /windows is not a system this list names/],
    [{ ...base, file_timeout_seconds: 0 }, /file_timeout_seconds must be a whole number/],
    [{ ...base, file_timeout_seconds: 1.5 }, /file_timeout_seconds must be a whole number/],
  ];
  for (const [manifest, expected] of cases) assert.match(governed.manifestErrors(manifest, found).join('\n'), expected, JSON.stringify(manifest.systems?.linux?.command || manifest.schema));
  assert.match(governed.manifestErrors(base, { linux: [] }).join('\n'), /finds no test file/);
});

test('globs: ** spans folders, * and ? stay inside one name', () => {
  const match = (glob, file) => governed.globRegExp(glob).test(file);
  assert.equal(match('tests/**/test_*.py', 'tests/test_a.py'), true);
  assert.equal(match('tests/**/test_*.py', 'tests/x/y/test_a.py'), true);
  assert.equal(match('tests/*.py', 'tests/x/a.py'), false);
  assert.equal(match('**/*.spec.ts', 'src/a/b.spec.ts'), true);
  assert.equal(match('tests/?.py', 'tests/ab.py'), false);
  assert.equal(match('tests/a.py', 'tests/aXpy'), false, 'a dot is literal');
});

test('run-tests.cjs hands --repo-root runs to the governed runner and keeps its own v1 list unchanged', async (t) => {
  const root = repo(t, { 'tests/a.test.js': PASS, 'tests/b.test.js': PASS }, nodeList([{ id: `${SYSTEM}-1`, rest: true }]));
  const out = sink(), err = sink();
  assert.equal(await runTests.main(['--repo-root', root, '--check'], { out, err }), 0, err.text);
  assert.match(out.text, new RegExp(`${SYSTEM}-1: 2 file\\(s\\)[^]*is usable`));
  const summary = path.join(root, 'out', 'summary.json');
  assert.equal(await runTests.main(['--repo-root', root, '--shard', `${SYSTEM}-1`, '--os', SYSTEM, '--summary', summary], { out, err }), 0, err.text);
  assert.deepEqual(JSON.parse(fs.readFileSync(summary, 'utf8')).files.map((entry) => entry.file), ['tests/a.test.js', 'tests/b.test.js']);
  const other = SYSTEM === 'linux' ? 'windows' : 'linux';
  assert.equal(await runTests.main(['--repo-root', root, '--shard', `${other}-1`, '--os', other], { out, err }), 2, 'the --os must match this machine');
  assert.equal(await runTests.main(['--repo-root', root, '--all'], { out, err: sink() }), 2, 'Toolkit-only modes do not mix with --repo-root');
  const bare = repo(t, { 'tests/a.test.js': PASS });
  const missing = sink();
  assert.equal(await runTests.main(['--repo-root', bare, '--check'], { out: sink(), err: missing }), 2);
  assert.match(missing.text, /has no shard list/);
  // Toolkit's own list stays v1 and usable.
  const manifest = v1.loadManifest();
  assert.equal(manifest.schema, 'toolkit-test-shards/v1');
  assert.deepEqual(v1.manifestErrors(manifest, v1.discoverTestFiles()), []);
});
