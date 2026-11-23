'use strict';

// Setup saves the record refresh compares with only after the answers are applied. A run that answers the bank
// and then stops because setup updated its own scripts applied nothing, so the next refresh shows the bank
// again instead of keeping answers that never took effect.
const test = require('node:test');
const {
  assert, fs, path, spawnSync, tmpRoot, isolatedHomeEnv, writeFile, runTestGit, createGitBackedRealSetupRepo,
  displayedBankReference,
} = require('./toolkit-setup-test-support.cjs');

const BEGIN = '<!-- setup-toolkit-question-bank:begin -->';
const VERSION_REL = 'repo/contracts/toolkit-local-bridge/version.json';

// No update source recorded yet, so setup updates its copy after the answers.
function fixture() {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const audit = JSON.stringify({
    update_report_enabled: true, update_report_open_enabled: false, update_report_retention_days: 7,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled: false, last_status: 'configured', repo_path: '' },
    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(managedPath, 'tmp-reports') },
  });
  return { root, origin, setupRepo, managedPath, env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: audit } };
}

function runManaged(f, extra, input = '') {
  const managedScript = path.join(f.managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  return spawnSync(process.execPath, [managedScript, '--execute', ...extra, '--profile', 'auto-main', '--repo-remote', f.origin], {
    cwd: f.managedPath, encoding: 'utf8', input, env: { ...process.env, ...f.env }, timeout: 300000, windowsHide: true,
  });
}

// A release that changes setup's own version file, so the update after the answers makes setup stop and rerun.
function pushRelease(f) {
  const file = path.join(f.setupRepo, ...VERSION_REL.split('/'));
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [major, minor, patch] = source.version.split('.').map(Number);
  writeFile(file, `${JSON.stringify({ ...source, version: `${major}.${minor}.${patch + 1}` }, null, 2)}\n`);
  runTestGit(f.setupRepo, ['add', VERSION_REL]);
  runTestGit(f.setupRepo, ['commit', '-m', 'release']);
  runTestGit(f.setupRepo, ['push', 'origin', 'main']);
}

test('answers from a run stopped at the self-update rerun are not kept: the next refresh shows the bank', () => {
  const f = fixture();
  pushRelease(f);
  const asked = runManaged(f, []);
  assert.equal(asked.status, 23, asked.stderr || asked.stdout);
  const answered = runManaged(f, [], `${displayedBankReference(asked.stdout)}: all recommended\n`);
  assert.equal(answered.status, 24, answered.stderr || answered.stdout);
  assert.match(answered.stdout, /## Setup updated itself/);
  assert.equal(fs.existsSync(path.join(f.root, '.ai-agent-toolkit', 'user-state', 'setup-question-shapes.json')), false,
    'nothing was applied, so nothing is saved for refresh to compare with');

  const refreshed = runManaged(f, ['--refresh']);
  assert.equal(refreshed.status, 23, refreshed.stderr || refreshed.stdout);
  assert.equal(refreshed.stdout.split(BEGIN).length - 1, 1, 'refresh shows the bank once');
  assert.match(refreshed.stdout, /Refresh: no saved answers to compare with on this computer/);
});
