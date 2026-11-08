'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('ordinary setup recommends one helper in the visible capacity question', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root),
    timeout: 300000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Codex helper agents[\s\S]*\*\*Selected:/);
  assert.match(result.stdout, /Helper-agent capacity questions shown: yes/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 2/);
});

test('auto-selected Codex capacity consumes a piped technical approval when unrelated user config must be preserved', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = 'model = "gpt-5.6"\n';
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root),
    input: 'apply\n',
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original));
  assert.match(configured, /max_concurrent_threads_per_session = 2/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
});
