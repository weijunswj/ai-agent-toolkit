'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('explicit migrate is rejected when no exact legacy block is pending', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('model = "gpt-5.6"\n');
  const editorLog = path.join(root, 'editor.log');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'migrate',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog } });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stderr, /No exact Toolkit-managed legacy setting is available to migrate/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.equal(fs.existsSync(editorLog), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.deepEqual(backupFiles(root), []);
});

test('unsupported V2 child tables stop before confirmation or any setup mutation', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const editorLog = path.join(root, 'editor.log');
  const original = Buffer.from('[features.multi_agent_v2]\nenabled = true\n\n[features.multi_agent_v2.custom]\nvalue = "unsupported"\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog } });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stderr, /unsupported child tables/);
  assert.doesNotMatch(result.stdout, /Type apply to approve/);
  assert.doesNotMatch(result.stderr, /answer `apply`/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.equal(fs.existsSync(editorLog), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.deepEqual(backupFiles(root), []);
});
