'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('visible Toolkit limit removal requires one exact preview approval and remains transactional', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const common = [
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
  ];
  const configured = run(common, { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  const configPath = codexConfig(root);
  const before = fs.readFileSync(configPath);
  const backupsBefore = new Set(backupFiles(root));
  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), { force: true });

  const paused = run([...common, '--codex-helper-capacity', 'remove'], {
    env: isolatedHomeEnv(root), timeout: 300000,
  });
  assert.equal(paused.status, 23, paused.stderr || paused.stdout);
  assert.match(paused.stdout, /# Codex helper-limit removal preview/);
  assert.match(paused.stdout, /After semantics:[\s\S]*higher host default/);
  assert.match(paused.stdout, /Exact affected keys:[\s\S]*Planned exact backup metadata:[\s\S]*Exact restore command/);
  assert.match(paused.stderr, /answer `apply`/);
  assert.deepEqual(fs.readFileSync(configPath), before);
  assert.deepEqual(new Set(backupFiles(root)), backupsBefore);

  const removed = run([
    ...common,
    '--codex-helper-capacity', 'remove',
    '--approve-codex-config-proposal',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.match(removed.stdout, /Helper-capacity outcome this run: removed/);
  assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /AI-AGENT-TOOLKIT|max_concurrent_threads_per_session/);
  const newBackupEntries = backupFiles(root).filter((entry) => !backupsBefore.has(entry));
  assert.equal(newBackupEntries.length, 3);
  assert.equal(newBackupEntries.filter((entry) => entry.endsWith('config.toml.original')).length, 1);
  assert.equal(newBackupEntries.filter((entry) => entry.endsWith('restore.json')).length, 1);
});

test('ordinary capacity choices cannot silently migrate a pending legacy block', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from(`[agents]\n${delegation.expectedLegacyBlock(1)}\n`);
  const editorLog = path.join(root, 'editor.log');
  writeFile(configPath, original.toString('utf8'));
  // The bank reads the V1 form of Toolkit's own block, where one helper is what is already there, so
  // it shows one recommended Keep current and the one-helper flag applies as keep: no Codex check,
  // no migration and no write.
  const kept = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'one-helper',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog } });
  assert.equal(kept.status, 0, kept.stderr || kept.stdout);
  assert.match(kept.stdout, /Helper-capacity outcome this run: kept/);
  assert.match(kept.stdout, /Old Toolkit helper block migrated: no/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.equal(fs.existsSync(editorLog), false);
  assert.deepEqual(backupFiles(root), []);

  // A real change is checked with Codex after the answers: Codex runs V2 here, so the old block
  // can change only through migrate, and setup stops before any plugin, preference or config write.
  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), { force: true });
  fs.rmSync(path.join(setupRepo, 'PLUGIN_SETUP.log'), { force: true });
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'custom', '--codex-helper-count', '1',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog } });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stderr, /can only change through the explicit `migrate` choice/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.equal(fs.existsSync(editorLog), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.deepEqual(backupFiles(root), []);
});
