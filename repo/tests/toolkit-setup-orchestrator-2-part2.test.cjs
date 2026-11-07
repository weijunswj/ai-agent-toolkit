'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('ordinary setup preserves conflicting user-owned Codex state instead of defaulting it to root-only', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = '[features.multi_agent_v2]\nenabled = false\n';
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Helper-capacity outcome this run: kept/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(backupFiles(root), []);
});

test('explicit keep does not migrate an exact legacy block or create a backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = `[agents]\n${delegation.expectedLegacyBlock(1)}\n`;
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--skip-codex-plugin-auto-refresh', '--yes-recommended', '--codex-helper-capacity', 'keep'], {
    env: isolatedHomeEnv(root), timeout: 300000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Configuration changed this run: no/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(backupFiles(root), []);
});
