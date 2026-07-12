'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');

test('plan mode remains read-only and exposes the existing setup journey', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.name, 'setup toolkit');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'upfront_setup_checklist', 'managed_main_checkout', 'codex_native_plugin_cache',
    'host_delegation_control', 'lite_validation', 'bridge_preferences',
    'approved_target_sync', 'final_summary'
  ]);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false);
});

test('Claude Code plan stays portable-policy-only and never emits Codex config work', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--host', 'claude-code'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.host, 'claude-code');
  assert.equal(plan.preferences.delegation_control, 'unsupported-policy-only');
  assert.doesNotMatch(plan.steps.flatMap((step) => step.commands || []).join('\n'), /agents\.max_threads|agents\.max_depth/);
});

test('--yes-recommended keeps an unconfigured Codex config unchanged pending native UAT', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex delegation control:[\s\S]*recommended: keep[\s\S]*selected: keep/);
  assert.match(result.stdout, /Delegation enforcement status: kept/);
  assert.match(result.stdout, /Delegation native UAT: pending/);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.deepEqual(backupFiles(root), []);
});

test('explicit limit previews path and block, creates backup, and writes only after setup succeeds', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  writeFile(configPath, 'model = "gpt-5.6"\r\n');
  const original = fs.readFileSync(configPath);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
    '--codex-delegation-control', 'limit'
  ], { env: isolatedHomeEnv(root), timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`Codex config path: ${escapeRegExp(configPath)}`));
  assert.match(result.stdout, /Proposed Toolkit-managed TOML block:[\s\S]*max_threads = 1[\s\S]*max_depth = 1/);
  assert.match(result.stdout, /Delegation enforcement status: configured/);
  assert.match(result.stdout, /Delegation backup metadata:/);
  assert.match(result.stdout, /Delegation exact restore command:/);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original.toString('utf8')));
  assert.match(configured, /\[agents\]\r\n# AI-AGENT-TOOLKIT:BEGIN/);
  assert.ok(backupFiles(root).length > 0);
});

test('downstream setup failure cannot mutate Codex config or create a backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root, { validationFailure: true });
  const configPath = codexConfig(root);
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
    '--codex-delegation-control', 'limit'
  ], { env: isolatedHomeEnv(root), timeout: 60000 });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});
