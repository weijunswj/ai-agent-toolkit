'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('already matching user-owned V1 and V2 configs complete without apply, editor, backup, or markers', () => {
  const fixtures = [
    {
      name: 'V2 empty input',
      runtime: 'v2',
      text: ['[features.multi_agent_v2]', 'enabled = true', 'max_concurrent_threads_per_session = 1', `root_agent_usage_hint_text = ${JSON.stringify(delegation.CODEX_V2_ROOT_GUIDANCE)}`, `subagent_usage_hint_text = ${JSON.stringify(delegation.CODEX_V2_HELPER_GUIDANCE)}`, ''].join('\n'),
      args: ['--yes-recommended', '--codex-helper-capacity', 'root-only'],
    },
    {
      name: 'V1 yes-recommended',
      runtime: 'v1',
      text: '[agents]\nmax_threads = 1\nmax_depth = 1\n',
      args: ['--yes-recommended'],
    },
  ];
  for (const fixture of fixtures) {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    const configPath = codexConfig(root);
    const editorLog = path.join(root, 'editor.log');
    const original = Buffer.from(fixture.text);
    writeFile(configPath, fixture.text);
    const result = run([
      '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
      '--skip-codex-plugin-auto-refresh', ...fixture.args,
    ], {
      env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_RUNTIME: fixture.runtime, SETUP_FAKE_CODEX_EDITOR_LOG: editorLog },
      input: fixture.input,
      timeout: 300000,
    });
    assert.equal(result.status, 0, `${fixture.name}: ${result.stderr || result.stdout}`);
    assert.doesNotMatch(result.stdout, /Type apply to approve/);
    assert.match(result.stdout, /Helper-capacity outcome this run: kept|already configured/);
    assert.match(result.stdout, /Configuration changed this run: no/);
    assert.deepEqual(fs.readFileSync(configPath), original);
    assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /AI-AGENT-TOOLKIT/);
    assert.equal(fs.existsSync(editorLog), false);
    assert.deepEqual(backupFiles(root), []);
  }
});

test('user-owned legacy values require one same-flow proposal confirmation under V2', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('[agents]\n# user owned\nmax_threads = 1\nmax_depth = 1\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /Exact affected keys:[\s\S]*Planned exact backup metadata:[\s\S]*Exact restore command after the approved write \(PowerShell\):/);
  assert.match(result.stderr, /Selected helper setting remains unapplied[\s\S]*answer `apply`/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});
