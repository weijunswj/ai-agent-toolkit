'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('approved safe helper proposal completes in the same setup flow and preserves legacy bytes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('[agents]\nmax_threads = 6\nmax_depth = 2\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-delegation-control', 'limit',
    '--approve-codex-config-proposal'
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original.toString('utf8')));
  assert.match(configured, /max_concurrent_threads_per_session = 2/);
  assert.ok(backupFiles(root).length > 0);
  assert.match(result.stdout, /Configuration changed this run: yes/);
});

test('setup rejects V1 and V2 config drift after proposal approval without editor or backup', () => {
  const fixtures = [
    {
      runtime: 'v2',
      original: '[features.multi_agent_v2]\nenabled = true\nmax_concurrent_threads_per_session = 6\nroot_agent_usage_hint_text = "custom root"\nsubagent_usage_hint_text = "custom helper"\n',
      drift: '[features.multi_agent_v2]\nenabled = true\nmax_concurrent_threads_per_session = 5\nroot_agent_usage_hint_text = "custom root"\nsubagent_usage_hint_text = "custom helper"\n',
    },
    {
      runtime: 'v1',
      original: 'approval_policy = "on-request"\n[agents]\nmax_threads = 6\nmax_depth = 2\n',
      drift: 'approval_policy = "never"\n[agents]\nmax_threads = 6\nmax_depth = 2\n',
    },
  ];

  for (const fixture of fixtures) {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    const configPath = codexConfig(root);
    const editorLog = path.join(root, 'editor.log');
    writeFile(configPath, fixture.original);
    const result = run([
      '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
      '--skip-codex-plugin-auto-refresh', '--yes-recommended', '--codex-helper-capacity', 'one-helper', '--approve-codex-config-proposal',
    ], {
      env: {
        ...isolatedHomeEnv(root),
        SETUP_FAKE_CODEX_RUNTIME: fixture.runtime,
        SETUP_FAKE_AUDIT_COUNT_PATH: path.join(root, 'audit-count'),
        SETUP_FAKE_CONFIG_DRIFT_CONTENT: fixture.drift,
        SETUP_FAKE_CODEX_EDITOR_LOG: editorLog,
      },
      timeout: 300000,
    });
    assert.equal(result.status, 23, `${fixture.runtime}: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /# Codex helper-agent config preview/);
    assert.match(result.stdout, /Exact affected keys:/);
    assert.match(result.stderr, /Selected helper setting remains unapplied/);
    assert.match(result.stderr, /configuration changed after you approved the proposal/i);
    assert.match(result.stderr, /rerun setup to receive a fresh proposal/i);
    assert.doesNotMatch(result.stdout, /# setup toolkit final summary/);
    assert.doesNotMatch(result.stdout, /Configuration changed this run: yes/);
    assert.equal(fs.readFileSync(configPath, 'utf8'), fixture.drift);
    assert.equal(fs.existsSync(editorLog), false);
    assert.deepEqual(backupFiles(root), []);
    assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), true);
  }
});
