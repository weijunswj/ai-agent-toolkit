'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('approved V1 zero repair runs before plugin setup that cannot load the broken config', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root, { rejectZeroConfig: true });
  const configPath = codexConfig(root);
  const broken = `[agents]\n${delegation.expectedLegacyBlock(1).replace('max_threads = 1', 'max_threads = 0')}\n`;
  writeFile(configPath, broken);
  const env = { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_RUNTIME: 'v1' };
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--approve-codex-config-proposal', '--skip-codex-plugin-auto-refresh'], { env, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /approved zero-helper repair was applied before Codex plugin setup/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /max_threads = 1\r?\nmax_depth = 1/);
  assert.ok(backupFiles(root).some(file => file.endsWith('config.toml.original')));
});
