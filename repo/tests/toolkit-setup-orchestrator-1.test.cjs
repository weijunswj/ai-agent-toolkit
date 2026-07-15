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
    'lite_validation', 'bridge_preferences', 'approved_target_sync',
    'final_bridge_audit', 'host_delegation_control', 'final_summary'
  ]);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false);
});

test('Claude Code plan stays portable-policy-only and never emits Codex config work', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--host', 'claude-code'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.host, 'claude-code');
  assert.equal(plan.preferences.helper_capacity, 'unsupported-policy-only');
  assert.doesNotMatch(plan.steps.flatMap((step) => step.commands || []).join('\n'), /agents\.max_threads|agents\.max_depth/);
});

test('plain and JSON plans share the one-helper recommendation and canonical Codex question row', () => {
  const root = tmpRoot();
  const plain = run(['--plan'], { env: isolatedHomeEnv(root) });
  const json = run(['--plan', '--json'], { env: isolatedHomeEnv(root) });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(json.status, 0, json.stderr);
  assert.match(plain.stdout, /## Computer performance[\s\S]*How many helper agents may Codex use\?[\s\S]*\*\*Recommended:\*\* One helper at most/);
  const plan = JSON.parse(json.stdout);
  const delegationRow = plan.question_bank.find((row) => row.key === 'codexHelperCapacity');
  assert.deepEqual(
    { recommended: delegationRow.recommended, empty_input: delegationRow.empty_input, selected: delegationRow.selected },
    { recommended: 'one-helper', empty_input: 'one-helper', selected: 'one-helper' }
  );
  assert.equal(plan.preferences.helper_capacity, 'one-helper');
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
  assert.ok(keys.indexOf('codexHelperCapacity') < keys.indexOf('codexPluginAutoRefresh'));
  assert.deepEqual(keys, [
    'managedCheckout', 'repoAutoUpdate', 'updateReports', 'updateReportRetention',
    'codexHelperCapacity', 'codexPluginAutoRefresh',
  ]);
});

test('canonical wizard renderer is compact, aligned, and free of implementation vocabulary', () => {
  const args = core.parseArgs(['--plan']);
  const current = {
    managed: { currentPath: '', selectedPath: 'C:\\hidden', defaultPath: 'C:\\hidden', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: {
      repo_auto_update: { enabled: false },
      update_report_enabled: true,
      update_report_open_enabled: true,
      update_report_retention_days: 7,
      codex_plugin_auto_refresh_enabled: false,
      targets: { opencode: { detected: false, enabled: false }, ag2: { detected: false, enabled: false } },
    },
    runtime: { runtime: 'MultiAgentV2' },
    delegation: { status: 'unconfigured', helper_count: null, detail: 'technical detail' },
    nativePlugin: { status: 'fresh' },
  };
  const planned = core.plannedQuestionBank(args, current);
  const text = core.renderSetupQuestionBank(planned.specs);
  assert.match(text, /## Automatic updates[\s\S]*## Computer performance/);
  assert.doesNotMatch(text, /## Other coding apps/);
  assert.doesNotMatch(text, /Update report auto-open|MultiAgentV[12]|max_threads|max_concurrent|AI-AGENT-TOOLKIT|PR #|issue #|C:\\|restore command|migration/i);
  assert.match(text, /How many helper agents may Codex use\?[\s\S]*\*\*Current:\*\*[\s\S]*\*\*Recommended:\*\*[\s\S]*\*\*Choices:\*\*[\s\S]*\*\*Selected:\*\*/);
  assert.match(text, /Accept all displayed recommended settings:[\s\S]*setup-toolkit-question-bank:complete/);
  for (const spec of planned.specs) assert.ok(spec.description.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, spec.key);

  current.delegation.helper_count = 4;
  const unsafe = core.setupQuestionSpecs(args, current).find((spec) => spec.key === 'codexHelperCapacity');
  assert.match(unsafe.current, /Risk:/);
  assert.match(unsafe.choices.find((choice) => choice.value === 'keep').label, /memory risk/);
});

test('missing wizard output retries the complete bank and never emits a shortcut alone', () => {
  const specs = [{
    key: 'example', section: 'Automatic updates', title: 'Example?', description: 'Example control.',
    current: 'Off.', recommended_outcome: 'On.', recommended: 'on', selected: 'on', empty_input: 'on',
    choices: [{ value: 'on', label: 'On - recommended' }, { value: 'off', label: 'Off' }],
  }];
  let writes = 0;
  const retried = core.emitCompleteQuestionBank(specs, { write() { writes += 1; return writes > 1; } });
  assert.equal(retried.attempts, 2);
  assert.equal(writes, 2);
  assert.throws(() => core.emitCompleteQuestionBank(specs, { write() { return false; } }), /no approval prompt or write is allowed/i);
});

test('--yes-recommended applies the visibly recommended one-helper Codex outcome', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /How many helper agents may Codex use\?[\s\S]*One helper at most - recommended/);
  assert.match(result.stdout, /Codex helper-agent runtime: MultiAgentV2/);
  assert.match(result.stdout, /Helper-capacity outcome this run: configured/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 2/);
  assert.ok(backupFiles(root).length > 0);
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
  assert.match(result.stdout, /Proposed Toolkit-managed TOML block:[\s\S]*enabled = true[\s\S]*max_concurrent_threads_per_session = 2[\s\S]*root_agent_usage_hint_text/);
  assert.match(result.stdout, /Codex backup directory:/);
  assert.match(result.stdout, /Normal helper capacity: 1 helper agent; 2 total session threads including the main agent/);
  assert.match(result.stdout, /Exact backup metadata:/);
  assert.match(result.stdout, /Exact restore command \(PowerShell\):/);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original.toString('utf8')));
  assert.match(configured, /\[features\.multi_agent_v2\]\r?\n# AI-AGENT-TOOLKIT:BEGIN CODEX-V2-ENABLEMENT v1\r?\nenabled = true\r?\n# AI-AGENT-TOOLKIT:END CODEX-V2-ENABLEMENT\r?\n# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3\r?\nmax_concurrent_threads_per_session = 2/);
  assert.ok(backupFiles(root).length > 0);
});

test('root-only choice maps V2 to one total session thread', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'root-only'
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 1/);
  assert.match(result.stdout, /Normal helper capacity: 0 helper agents; 1 total session threads including the main agent/);
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
    input: ['disable', 'enable', 'default', 'one-helper', 'keep'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Setup choices confirmed before writes:[\s\S]*How many helper agents may Codex use\?: one-helper[\s\S]*Keep the Codex Toolkit plugin working automatically\?: keep/);
  assert.match(result.stdout, /Question answers initially required: yes/);
  assert.match(result.stdout, /Question answers supplied by complete stdin: yes/);
  assert.match(result.stdout, /Question answers prompted interactively: no/);
  assert.match(result.stdout, /Question bank stopped for answers: no/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY/);
  const bridgeArgs = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeArgs, /--disable-repo-auto-update/);
  assert.match(bridgeArgs, /--disable-update-report-open --enable-update-reports --update-report-retention-days 7 --write/);
  assert.doesNotMatch(bridgeArgs, /codex-plugin-auto-refresh/);
  assert.doesNotMatch(bridgeArgs, /--enable-target opencode/);
});

test('extra non-empty piped answers fail before any setup write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', 'keep', 'keep', 'unexpected'].join('\n'),
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

test('final bridge audit failure occurs before delegation config commitment', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
    '--codex-delegation-control', 'limit', '--codex-cli', createFakeCodexAppServer(root)
  ], {
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_MALFORMED: '1' },
    timeout: 300000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Final bridge audit did not return valid JSON/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});

test('custom helper counts above one require separate RAM-risk approval', () => {
  const blockedRoot = tmpRoot();
  const blockedRepo = createGitBackedSetupRepo(blockedRoot);
  const blocked = run([
    '--execute', '--repo-root', blockedRepo.setupRepo, '--repo-remote', blockedRepo.origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-count', '2',
  ], { env: isolatedHomeEnv(blockedRoot), timeout: 300000 });
  assert.equal(blocked.status, 23, blocked.stderr || blocked.stdout);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /More than one helper may exhaust RAM|require the exact approval answer/);
  assert.equal(fs.existsSync(codexConfig(blockedRoot)), false);
  assert.deepEqual(backupFiles(blockedRoot), []);

  const approvedRoot = tmpRoot();
  const approvedRepo = createGitBackedSetupRepo(approvedRoot);
  const approved = run([
    '--execute', '--repo-root', approvedRepo.setupRepo, '--repo-remote', approvedRepo.origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-count', '2',
    '--approve-high-helper-capacity', '--codex-cli', createFakeCodexAppServer(approvedRoot),
  ], { env: isolatedHomeEnv(approvedRoot), timeout: 300000 });
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  assert.match(approved.stdout, /RAM-risk approval for more than one helper: approved/);
  assert.match(approved.stdout, /Normal helper capacity: 2 helper agents; 3 total session threads including the main agent/);
  assert.match(approved.stdout, /Defined multi-worker workflow exception: Only when the user invoked that workflow/);
  assert.match(approved.stdout, /helpers must not spawn helpers; root retains coordination and final judgment/);
  assert.match(approved.stdout, /Never imply that an official Deep Scan can run with insufficient capacity/);
  assert.match(fs.readFileSync(codexConfig(approvedRoot), 'utf8'), /max_concurrent_threads_per_session = 3/);
});
