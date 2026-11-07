'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('question bank pauses before plugin, config, preference, or target writes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--profile', 'auto-main', '--repo-root', setupRepo, '--repo-remote', origin], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /setup-toolkit-question-bank:complete/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.deepEqual(backupFiles(root), []);
});

test('pre-answered setup does not block on an unclosed stdin pipe', async () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = await runWithUnclosedStdin(script, [
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Configuration changed this run: yes/);
});
