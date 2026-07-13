'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');

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

test('plain and JSON plans share the keep recommendation and canonical Codex question row', () => {
  const root = tmpRoot();
  const plain = run(['--plan'], { env: isolatedHomeEnv(root) });
  const json = run(['--plan', '--json'], { env: isolatedHomeEnv(root) });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(json.status, 0, json.stderr);
  assert.match(plain.stdout, /Codex delegation control:[\s\S]*recommended: keep[\s\S]*empty input: keep[\s\S]*selected: keep/);
  const plan = JSON.parse(json.stdout);
  const delegationRow = plan.question_bank.find((row) => row.key === 'codexDelegationControl');
  assert.deepEqual(
    { recommended: delegationRow.recommended, empty_input: delegationRow.empty_input, selected: delegationRow.selected },
    { recommended: 'keep', empty_input: 'keep', selected: 'keep' }
  );
  assert.equal(plan.preferences.delegation_control, 'keep');
});

test('canonical question specification orders delegation before plugin auto-refresh for TTY and stdin', () => {
  const args = core.parseArgs(['--execute']);
  const current = {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    delegation: { status: 'unconfigured', detail: 'not configured' },
    nativePlugin: { status: 'not checked' },
  };
  const keys = core.setupQuestionSpecs(args, current).map((spec) => spec.key);
  assert.ok(keys.indexOf('codexDelegationControl') < keys.indexOf('codexPluginAutoRefresh'));
  assert.deepEqual(keys, [
    'managedCheckout', 'repoAutoUpdate', 'updateReports', 'updateReportOpen', 'updateReportRetention',
    'codexDelegationControl', 'codexPluginAutoRefresh', 'opencodeTarget', 'ag2Target',
  ]);
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
    '--codex-delegation-control', 'limit', '--codex-cli', createFakeCodexAppServer(root)
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`Codex config path: ${escapeRegExp(configPath)}`));
  assert.match(result.stdout, /Proposed Toolkit-managed TOML block:[\s\S]*max_threads = 1[\s\S]*max_depth = 1/);
  assert.match(result.stdout, /Codex backup directory:/);
  assert.match(result.stdout, /Delegation enforcement status: configured/);
  assert.match(result.stdout, /Delegation backup metadata:/);
  assert.match(result.stdout, /Delegation exact restore command:/);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original.toString('utf8')));
  assert.match(configured, /\[agents\]\r?\n# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\r?\nmax_threads = 1\r?\nmax_depth = 1\r?\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS/);
  assert.ok(backupFiles(root).length > 0);
});

test('distinct piped answers follow the canonical question order without shifts', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  writeFile(configPath, 'model = "gpt-5.6"\n');
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--codex-cli', createFakeCodexAppServer(root),
  ], {
    env: isolatedHomeEnv(root),
    input: ['disable', 'enable', 'disable', 'default', 'limit', 'keep', 'skip', 'disable'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Setup choices confirmed before writes:[\s\S]*Codex delegation control: limit[\s\S]*Codex plugin cache auto-refresh and Windows hook repair: keep[\s\S]*OpenCode bridge target: skip[\s\S]*AG2\/Antigravity bridge target: disable/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS/);
  const bridgeArgs = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeArgs, /--disable-repo-auto-update/);
  assert.match(bridgeArgs, /--enable-update-reports --update-report-retention-days 7 --disable-update-report-open --write/);
  assert.match(bridgeArgs, /--disable-target ag2 --write/);
  assert.doesNotMatch(bridgeArgs, /codex-plugin-auto-refresh/);
  assert.doesNotMatch(bridgeArgs, /--enable-target opencode/);
});

test('extra non-empty piped answers fail before any setup write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'unexpected'].join('\n'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected extra non-empty input/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(root)), false);
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
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});
