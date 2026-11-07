'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, createGitBackedRealSetupRepo,
  codexConfig, displayedBankReference,
} = require('./toolkit-setup-test-support.cjs');
const BEGIN = '<!-- setup-toolkit-question-bank:begin -->';
const COMPLETE = '<!-- setup-toolkit-question-bank:complete -->';
const VERSION_REL = 'repo/contracts/toolkit-local-bridge/version.json';
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
function pushRelease(f) {
  const source = JSON.parse(fs.readFileSync(path.join(f.setupRepo, ...VERSION_REL.split('/')), 'utf8'));
  const [major, minor, patch] = source.version.split('.').map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  return { from: source.version, to: next, commit: push(f, VERSION_REL, `${JSON.stringify({ ...source, version: next }, null, 2)}\n`) };
}
function bankCount(stdout, marker) {
  return stdout.split(marker).length - 1;
}

// Complete test declarations, split to keep the per-file time budget.
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
