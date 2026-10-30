'use strict';

// With automatic updates recorded on, setup run straight from the managed copy updates that copy
// before it shows the choices, so an update of setup's own files never asks the owner twice. Every
// other route keeps the update after the answers. One test per row of the plan's invariant table.
const test = require('node:test');
const {
  assert, fs, path, spawnSync, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, createGitBackedRealSetupRepo,
  codexConfig, displayedBankReference,
} = require('./toolkit-setup-test-support.cjs');

const BEGIN = '<!-- setup-toolkit-question-bank:begin -->';
const COMPLETE = '<!-- setup-toolkit-question-bank:complete -->';
const VERSION_REL = 'repo/contracts/toolkit-local-bridge/version.json';

// The fixture's bridge returns this audit, so the recorded automatic-update state is set per test.
function audit(managedPath, enabled, repoPath = managedPath) {
  return JSON.stringify({
    update_report_enabled: true, update_report_open_enabled: false, update_report_retention_days: 7,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled, last_status: 'configured', repo_path: repoPath },
    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(managedPath, 'tmp-reports') },
  });
}

function fixture({ autoUpdate = true, repoPath } = {}) {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const env = { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: audit(managedPath, autoUpdate, repoPath) };
  return { root, origin, setupRepo, managedPath, env, head: () => runTestGit(managedPath, ['rev-parse', 'HEAD']) };
}

function runManaged(f, { input = '', extra = ['--execute'], env = {} } = {}) {
  const managedScript = path.join(f.managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  return spawnSync(process.execPath, [managedScript, ...extra, '--profile', 'auto-main', '--repo-remote', f.origin], {
    cwd: f.managedPath, encoding: 'utf8', input, env: { ...process.env, ...f.env, ...env }, timeout: 300000, windowsHide: true
  });
}

function push(f, rel, text) {
  writeFile(path.join(f.setupRepo, ...rel.split('/')), text);
  runTestGit(f.setupRepo, ['add', rel]);
  runTestGit(f.setupRepo, ['commit', '-m', `update ${rel}`]);
  runTestGit(f.setupRepo, ['push', 'origin', 'main']);
  return runTestGit(f.setupRepo, ['rev-parse', 'HEAD']);
}

// A release: version.json, one of setup's own paths, moves to the next patch version.
function pushRelease(f) {
  const source = JSON.parse(fs.readFileSync(path.join(f.setupRepo, ...VERSION_REL.split('/')), 'utf8'));
  const [major, minor, patch] = source.version.split('.').map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  return { from: source.version, to: next, commit: push(f, VERSION_REL, `${JSON.stringify({ ...source, version: next }, null, 2)}\n`) };
}

function bankCount(stdout, marker) {
  return stdout.split(marker).length - 1;
}

test('automatic updates on: a release that changes setup stops before any table, and the rerun shows one table', () => {
  const f = fixture();
  const release = pushRelease(f);

  const first = runManaged(f);
  assert.equal(first.status, 24, first.stderr || first.stdout);
  assert.match(first.stdout, /## Setup updated itself\nSetup updated its Toolkit copy from [0-9a-f]{7} to [0-9a-f]{7}, and the update changed setup's own scripts\./);
  assert.ok(first.stdout.includes(`Setup updated itself from Toolkit ${release.from} to ${release.to} before showing the choices.`), first.stdout);
  assert.match(first.stdout, /shows the choices once/);
  assert.doesNotMatch(first.stdout, /earlier answers/);
  assert.equal(bankCount(first.stdout, BEGIN), 0);
  assert.equal(f.head(), release.commit);
  assert.equal(fs.existsSync(codexConfig(f.root)), false);

  const second = runManaged(f);
  assert.equal(second.status, 23, second.stderr || second.stdout);
  assert.equal(bankCount(second.stdout, BEGIN), 1);
  assert.equal(bankCount(second.stdout, COMPLETE), 1);
  assert.doesNotMatch(second.stdout, /## Setup updated itself/);
  assert.match(second.stdout, /Review every visible choice before setup changes any settings\./);

  const third = runManaged(f, { input: `${displayedBankReference(second.stdout)}: all recommended\n` });
  assert.equal(third.status, 0, third.stderr || third.stdout);
  assert.doesNotMatch(third.stdout, /## Setup updated itself/);
  assert.equal(fs.existsSync(codexConfig(f.root)), true);
});

test('automatic updates on: an update outside setup paths is made before the table in the same run', () => {
  const f = fixture();
  const updated = push(f, 'repo/docs/NOTE.md', 'docs only\n');
  const result = runManaged(f);
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(bankCount(result.stdout, BEGIN), 1);
  assert.doesNotMatch(result.stdout, /## Setup updated itself/);
  assert.equal(f.head(), updated);
  assert.equal(fs.existsSync(codexConfig(f.root)), false);
});

for (const [label, options] of [
  ['off', { autoUpdate: false }],
  ['on for another folder', { autoUpdate: true, repoPath: path.join(tmpRoot(), 'elsewhere') }],
]) test(`automatic updates ${label}: the table comes first and the update waits for the answer`, () => {
  const f = fixture(options);
  const before = f.head();
  const release = pushRelease(f);

  const asked = runManaged(f);
  assert.equal(asked.status, 23, asked.stderr || asked.stdout);
  assert.equal(bankCount(asked.stdout, BEGIN), 1);
  assert.equal(f.head(), before);

  const answered = runManaged(f, { input: `${displayedBankReference(asked.stdout)}: all recommended\n` });
  assert.equal(answered.status, 24, answered.stderr || answered.stdout);
  assert.ok(answered.stdout.includes(`Setup updated itself from Toolkit ${release.from} to ${release.to} after you answered the choices.`), answered.stdout);
  assert.match(answered.stdout, /Your earlier answers were for the older setup, so the next run shows the choices again\./);
  assert.equal(f.head(), release.commit);
  assert.equal(fs.existsSync(codexConfig(f.root)), false);
});

test('automatic updates on: the delegated child route shows the table before any update', () => {
  const f = fixture();
  const before = f.head();
  pushRelease(f);
  // The bootstrap copy (this checkout) hands the run to the managed copy's setup as a child.
  const result = run(['--execute', '--profile', 'auto-main', '--repo-remote', f.origin], { env: f.env, input: '' });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /delegating to the managed checkout setup script/);
  assert.equal(bankCount(result.stdout, BEGIN), 1);
  assert.equal(f.head(), before);
});

test('automatic updates on: plan and explain runs never update the managed copy', () => {
  const f = fixture();
  const before = f.head();
  pushRelease(f);
  for (const extra of [['--plan'], ['--plan', '--explain', '1.1']]) {
    const result = runManaged(f, { extra });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(f.head(), before, extra.join(' '));
  }
});

test('automatic updates on: a dirty managed copy stops before any table and writes nothing', () => {
  const f = fixture();
  const before = f.head();
  pushRelease(f);
  writeFile(path.join(f.managedPath, 'LOCAL_EDIT.md'), 'local edit\n');
  const result = runManaged(f);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /managed Toolkit source checkout must be clean before setup can continue/);
  assert.equal(bankCount(result.stdout, BEGIN), 0);
  assert.equal(f.head(), before);
  assert.equal(fs.existsSync(codexConfig(f.root)), false);
});
