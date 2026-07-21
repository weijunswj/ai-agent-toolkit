'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');

function displayedBankReference(output) {
  const match = String(output || '').match(/Bank reference: ([0-9A-HJKMNP-TV-Z-]+)/);
  assert.ok(match, output);
  return match[1];
}

function auditFixture({ targets = false, retentionDays = 7 } = {}) {
  const target = (name) => ({
    detected: targets,
    enabled: targets,
    synced: targets,
    status: targets ? 'current' : 'not detected',
    synced_version: '',
    path: '',
    name,
  });
  return {
    update_report_enabled: true,
    update_report_open_enabled: false,
    update_report_retention_days: retentionDays,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled: false, last_status: 'configured', repo_path: '' },
    update_report_cleanup: { retention_days: retentionDays, deleted_count: 0, error_count: 0, report_log_directory: 'private-value-never-rendered' },
    targets: { opencode: target('opencode'), ag2: target('ag2') },
  };
}

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

test('Claude Code plan omits unsupported automatic admission and never emits Codex config work', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--host', 'claude-code'], { env: { ...isolatedHomeEnv(root), PATH: '' } });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.host, 'claude-code');
  assert.equal(plan.preferences.helper_capacity_backstop, 'root-only');
  assert.equal(plan.question_bank.some((row) => row.key === 'claudeAgentCapacity'), false);
  assert.doesNotMatch(plan.steps.flatMap((step) => step.commands || []).join('\n'), /agents\.max_threads|agents\.max_depth/);
});

test('plain and JSON plans omit ordinary helper quantity choices', () => {
  const root = tmpRoot();
  const plain = run(['--plan'], { env: isolatedHomeEnv(root) });
  const json = run(['--plan', '--json'], { env: isolatedHomeEnv(root) });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(json.status, 0, json.stderr);
  assert.doesNotMatch(plain.stdout, /Codex helper agents|how many helper|custom number/i);
  const plan = JSON.parse(json.stdout);
  assert.equal(plan.question_bank.some((row) => row.key === 'codexHelperCapacity'), false);
  assert.equal(plan.preferences.helper_capacity_backstop, 'root-only');
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
  assert.deepEqual(keys, [
    'managedCheckout', 'repoAutoUpdate', 'updateReports', 'updateReportRetention', 'codexPluginAutoRefresh',
  ]);
  assert.equal(args.setupChoices.codexHelperCapacity, 'keep');
});

test('agent-facing setup docs match the report question rows', () => {
  const args = core.parseArgs(['--plan']);
  const current = {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    delegation: { status: 'unconfigured', detail: 'not configured' },
    nativePlugin: { status: 'not checked' },
  };
  const reportRows = core.setupQuestionSpecs(args, current)
    .filter((spec) => /report/i.test(`${spec.key} ${spec.title}`));
  assert.deepEqual(reportRows.map((spec) => spec.key), ['updateReports', 'updateReportRetention']);
  assert.equal(reportRows.some((spec) => /open/i.test(spec.key)), false);

  const docs = [
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
    '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/SKILL.md',
  ];
  for (const relPath of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /report creation|update report writes|meaningful update reports (?:stay|are) enabled/i, relPath);
    assert.match(text, /report creation and retention|report(?:\/log)? retention|reports\/logs older than|reports.*kept for/i, relPath);
    assert.match(text, /(?:action-required|failed or safety-blocked|reports (?:needing|requiring) action)[^.;\n]{0,120}open automatically/i, relPath);
    assert.match(text, /successful[^.;\n]{0,100}reports (?:remain|stay) closed/i, relPath);
    assert.doesNotMatch(text, /(?:question bank|wizard)[^.\n]*(?:report auto-open|report opening)/i, relPath);
    assert.doesNotMatch(text, /(?:ask|answer|pipe|choice)[^.\n]{0,100}(?:report auto-open|report opening)/i, relPath);
  }
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
  const terminal = core.renderSetupQuestionBankTerminal(planned.specs);
  assert.match(text, /## 1\. Updates and reports[\s\S]*## 2\. Computer performance/);
  assert.doesNotMatch(text, /## \d+\. Other coding apps/);
  assert.doesNotMatch(text, /Update report auto-open|MultiAgentV[12]|max_threads|max_concurrent|AI-AGENT-TOOLKIT|PR #|issue #|C:\\|restore command|migration/i);
  assert.doesNotMatch(text, /Codex helper agents|One helper at most|Use a custom number/i);
  assert.doesNotMatch(text, /\bAdvanced(?: options)?\b|Show advanced choices|More options/);
  assert.doesNotMatch(text, /\*\*Choices:\*\*[^\n]*(?:\/|\|)/);
  assert.doesNotMatch(terminal, /Codex helper agents|One helper at most|Use a custom number/i);
  assert.doesNotMatch(terminal, /Choices:[^\n]*(?:\/|,)/);
  assert.match(text, /Reply with the displayed bank reference[\s\S]*: all recommended`[\s\S]*setup-toolkit-question-bank:complete/);
  for (const spec of planned.specs) assert.ok(spec.description.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, spec.key);

  current.delegation.helper_count = 4;
  assert.equal(core.setupQuestionSpecs(args, current).some((spec) => spec.key === 'codexHelperCapacity'), false);
});

test('ordinary bank removes quantity choice while advanced compatibility flags remain restrictive', () => {
  const args = core.parseArgs(['--plan', '--codex-helper-count', '2', '--approve-high-helper-capacity']);
  const current = { managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' }, audit: { repo_auto_update: {}, targets: {} }, runtime: { runtime: 'MultiAgentV2' }, delegation: { status: 'configured', helper_count: 4 }, nativePlugin: { status: 'not checked' } };
  const specs = core.setupQuestionSpecs(args, current);
  assert.equal(specs.some((spec) => spec.key === 'codexHelperCapacity'), false);
  assert.equal(args.setupChoices.codexHelperCapacity, 'custom');
  assert.equal(args.codexHelperCount, 2);
});

test('missing wizard output fails after one render and never emits a shortcut alone', () => {
  const specs = [{
    key: 'example', section: 'Automatic updates', title: 'Example?', description: 'Example control.',
    current: 'Off.', recommended_outcome: 'On.', recommended: 'on', selected: 'on', empty_input: 'on',
    choices: [{ value: 'on', label: 'On - recommended' }, { value: 'off', label: 'Off' }],
  }];
  let writes = 0;
  assert.throws(() => core.emitCompleteQuestionBank(specs, { write() { writes += 1; return false; } }), /no approval prompt or write is allowed/i);
  assert.equal(writes, 1);
  assert.throws(() => core.emitCompleteQuestionBank(specs, { write() { return false; } }), /no approval prompt or write is allowed/i);
});

test('--yes-recommended applies the visibly recommended root-only Codex outcome', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const ordinaryBank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.doesNotMatch(ordinaryBank, /Codex helper agents|helper quantity/i);
  assert.match(result.stdout, /Helper-agent capacity questions shown: no/);
  assert.match(result.stdout, /Codex helper-agent runtime: MultiAgentV2/);
  assert.match(result.stdout, /Helper-capacity outcome this run: configured/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 1/);
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
    input: ['disable', 'enable', 'default', 'keep'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Setup choices confirmed before writes:[\s\S]*2\.1 Codex Toolkit maintenance: C - Keep current \(canonical: keep; effective: disable\)/);
  assert.doesNotMatch(result.stdout, /Codex helper agents:/);
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

test('explicit textual all recommended approves the exact visible bank', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const env = isolatedHomeEnv(root);
  const preview = run(['--execute', '--repo-remote', origin], { env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  const result = run(['--execute', '--repo-remote', origin], {
    env,
    input: `${reference}: all recommended\n`,
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Question answer source: user-approved all recommended/);
  assert.equal((result.stdout.match(/setup-toolkit-question-bank:begin/g) || []).length, 1);
  assert.equal((result.stdout.match(/setup-toolkit-question-bank:complete/g) || []).length, 1);
  assert.ok(result.stdout.indexOf('setup-toolkit-question-bank:complete') < result.stdout.indexOf('Setup choices confirmed before writes:'));
});

test('changed-only piped answer applies recommendations except exact indexed changes', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const env = isolatedHomeEnv(root);
  const preview = run(['--execute', '--repo-remote', origin], { env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  const result = run(['--execute', '--repo-remote', origin], {
    env,
    input: `${reference}: 1.2=b, 2.1=B\n`,
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Question answer source: user-approved recommended except listed changes/);
  assert.match(result.stdout, /1\.2 Automatic updates: B - Turn off \(canonical: disable; effective: disable\)/);
  assert.match(result.stdout, /2\.1 Codex Toolkit maintenance: B - Turn off \(canonical: disable; effective: disable\)/);
  assert.match(result.stdout, /1\.3 Update reports: A - Keep reports \(canonical: enable; effective: enable\)/);
});

test('cross-process concise replay fails before mapping across host and conditional target changes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const baseArgs = ['--execute', '--repo-root', setupRepo, '--repo-remote', origin];
  const baseEnv = isolatedHomeEnv(root);

  const codexPreview = run(baseArgs, { env: baseEnv, input: '' });
  const codexReference = displayedBankReference(codexPreview.stdout);
  const claudeReplay = run([...baseArgs, '--host', 'claude-code'], {
    env: baseEnv,
    input: `${codexReference}: 2.1=B\n`,
  });
  assert.notEqual(claudeReplay.status, 0);
  assert.match(claudeReplay.stderr, /reference is stale or belongs to a different rendered bank/);
  assert.doesNotMatch(claudeReplay.stderr, /unavailable question|unavailable choice/);

  const withTargetsEnv = { ...baseEnv, SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditFixture({ targets: true })) };
  const withoutTargetsEnv = { ...baseEnv, SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditFixture({ targets: false })) };
  const withTargetsPreview = run(baseArgs, { env: withTargetsEnv, input: '' });
  const withTargetsReference = displayedBankReference(withTargetsPreview.stdout);
  const removedReplay = run(baseArgs, { env: withoutTargetsEnv, input: `${withTargetsReference}: 3.1=D\n` });
  assert.notEqual(removedReplay.status, 0);
  assert.match(removedReplay.stderr, /reference is stale or belongs/);

  const withoutTargetsPreview = run(baseArgs, { env: withoutTargetsEnv, input: '' });
  const withoutTargetsReference = displayedBankReference(withoutTargetsPreview.stdout);
  const addedReplay = run(baseArgs, { env: withTargetsEnv, input: `${withoutTargetsReference}: all recommended\n` });
  assert.notEqual(addedReplay.status, 0);
  assert.match(addedReplay.stderr, /reference is stale or belongs/);
});

test('cross-process concise replay fails when a displayed recommendation changes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const args = ['--execute', '--repo-root', setupRepo, '--repo-remote', origin];
  const env = isolatedHomeEnv(root);
  const initial = run(args, {
    env: { ...env, SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditFixture({ retentionDays: 7 })) },
    input: '',
  });
  const reference = displayedBankReference(initial.stdout);
  const replay = run(args, {
    env: { ...env, SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditFixture({ retentionDays: 30 })) },
    input: `${reference}: all recommended\n`,
  });
  assert.notEqual(replay.status, 0);
  assert.match(replay.stderr, /reference is stale or belongs/);
});

test('non-interactive concise input rejects missing malformed and secondary-detail values before writes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const args = ['--execute', '--repo-remote', origin];
  const env = isolatedHomeEnv(root);
  const preview = run(args, { env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  for (const [input, expected] of [
    ['all recommended\n', /require the displayed bank reference/],
    ['BAD: all recommended\n', /malformed or truncated/],
    [`${reference.slice(0, -1)}: all recommended\n`, /malformed or truncated/],
  ]) {
    const rejected = run(args, { env, input });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, expected);
  }
  const plan = run(['--plan', '--json', '--repo-remote', origin], { env });
  const bank = JSON.parse(plan.stdout).question_bank;
  const retention = bank.find((row) => row.id === 'report-retention');
  const custom = retention.choices.find((choice) => choice.value === 'custom');
  const secondary = run(args, {
    env,
    input: `${reference}: ${retention.presentation.question_ref}=${custom.presentation_ref}\n`,
  });
  assert.notEqual(secondary.status, 0);
  assert.match(secondary.stderr, /requires additional values.*update-report-retention-days/i);
  const updateSource = bank.find((row) => row.id === 'update-source');
  const customSource = updateSource.choices.find((choice) => choice.value === 'custom');
  const sourceSecondary = run(args, {
    env,
    input: `${reference}: ${updateSource.presentation.question_ref}=${customSource.presentation_ref}\n`,
  });
  assert.notEqual(sourceSecondary.status, 0);
  assert.match(sourceSecondary.stderr, /requires additional values.*--repo-root/i);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
});

test('extra non-empty piped answers fail before any setup write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', 'keep', 'unexpected'].join('\n'),
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
