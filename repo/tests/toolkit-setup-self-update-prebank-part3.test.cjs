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
