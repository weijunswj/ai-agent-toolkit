'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('migration-required defaults and yes-recommended keep the legacy block unchanged', () => {
  for (const mode of ['empty', 'yes-recommended']) {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    const configPath = codexConfig(root);
    const editorLog = path.join(root, 'editor.log');
    const original = Buffer.from(`[agents]\n${delegation.expectedLegacyBlock(1)}\n`);
    writeFile(configPath, original.toString('utf8'));
    const args = ['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep', '--yes-recommended'];
    const result = run(args, {
      env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog },
      input: undefined,
      timeout: 300000,
    });
    assert.equal(result.status, 0, `${mode}: ${result.stderr || result.stdout}`);
    assert.doesNotMatch(result.stdout, /Update the existing Toolkit helper setting|Codex helper agents[\s\S]*\*\*Selected:/);
    assert.match(result.stdout, /Helper-capacity outcome this run: kept/);
    assert.match(result.stdout, /Old Toolkit helper block migrated: no/);
    assert.match(result.stdout, /Configuration changed this run: no/);
    assert.deepEqual(fs.readFileSync(configPath), original);
    assert.equal(fs.existsSync(editorLog), false);
    assert.deepEqual(backupFiles(root), []);
  }
});

test('legacy migration is a distinct explicit choice with a full visible preview', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = [
    'model = "gpt-5.6"',
    '[agents]',
    delegation.expectedLegacyBlock(1),
    '',
    '[agents.security-reviewer]',
    'description = "preserve me"',
    '',
  ].join('\n');
  const editorLog = path.join(root, 'editor.log');
  writeFile(configPath, original);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'migrate',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.stdout.indexOf('setup-toolkit-question-bank:complete') < result.stdout.indexOf('# Codex helper-agent config preview'));
  assert.match(result.stdout, /Before semantics:[\s\S]*After semantics:[\s\S]*Proposed Toolkit-managed TOML block:[\s\S]*Planned exact backup metadata:[\s\S]*Restore command setup script:[\s\S]*Exact restore command after the approved write \(PowerShell\):/);
  assert.match(result.stdout, /Old Toolkit helper block migrated: yes/);
  assert.match(result.stdout, /Helper-capacity outcome this run: migrated/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /model = "gpt-5.6"/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /\[agents\.security-reviewer\]\ndescription = "preserve me"/);
  assert.equal(fs.readFileSync(editorLog, 'utf8').trim(), 'config/batchWrite');

  const configuredBytes = fs.readFileSync(configPath);
  const backupCount = backupFiles(root).length;
  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), { force: true });
  const repeated = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'one-helper',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog }, timeout: 300000 });
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.match(repeated.stdout, /Helper-capacity outcome this run: kept|already configured/);
  assert.match(repeated.stdout, /Old Toolkit helper block migrated: no/);
  assert.deepEqual(fs.readFileSync(configPath), configuredBytes);
  assert.equal(fs.readFileSync(editorLog, 'utf8').trim(), 'config/batchWrite');
  assert.equal(backupFiles(root).length, backupCount);
});
