'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

test('ordinary setup automatically selects the root-only safety outcome without a quantity row', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root),
    timeout: 300000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Codex helper agents[\s\S]*\*\*Selected:/);
  assert.match(result.stdout, /Helper-agent capacity questions shown: no/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 1/);
});

test('auto-selected Codex capacity consumes a piped technical approval when unrelated user config must be preserved', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = 'model = "gpt-5.6"\n';
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root),
    input: 'apply\n',
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original));
  assert.match(configured, /max_concurrent_threads_per_session = 1/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
});
test('ordinary setup preserves conflicting user-owned Codex state instead of defaulting it to root-only', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = '[features.multi_agent_v2]\nenabled = false\n';
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Helper-capacity outcome this run: kept/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(backupFiles(root), []);
});
test('explicit keep does not migrate an exact legacy block or create a backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = `[agents]\n${delegation.expectedLegacyBlock(1)}\n`;
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--skip-codex-plugin-auto-refresh', '--yes-recommended', '--codex-helper-capacity', 'keep'], {
    env: isolatedHomeEnv(root), timeout: 300000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Configuration changed this run: no/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(backupFiles(root), []);
});

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
    assert.match(result.stdout, /PR #237 legacy block migrated: no/);
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
  assert.match(result.stdout, /PR #237 legacy block migrated: yes/);
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
  assert.match(repeated.stdout, /PR #237 legacy block migrated: no/);
  assert.deepEqual(fs.readFileSync(configPath), configuredBytes);
  assert.equal(fs.readFileSync(editorLog, 'utf8').trim(), 'config/batchWrite');
  assert.equal(backupFiles(root).length, backupCount);
});

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
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'one-helper',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CODEX_EDITOR_LOG: editorLog } });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stderr, /can only change through the explicit `migrate` choice/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.equal(fs.existsSync(editorLog), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.deepEqual(backupFiles(root), []);
});

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
  assert.match(result.stderr, /No exact Toolkit-managed PR #237 legacy setting is available to migrate/);
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
      text: '[agents]\nmax_threads = 0\nmax_depth = 1\n',
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

test('managed question-bank pause and safety blocker are never bypassed by active fallback', () => {
  for (const scenario of [
    { expected: 23, emitQuestionBank: true, extraLines: [] },
    { expected: 1, emitQuestionBank: false, extraLines: ["console.error('managed safety blocker');"] }
  ]) {
    const root = tmpRoot();
    createFakeManagedSetupScript(root, { exitCode: scenario.expected, emitQuestionBank: scenario.emitQuestionBank, extraLines: scenario.extraLines });
    const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
    assert.equal(result.status, scenario.expected, result.stderr || result.stdout);
    assert.match(result.stdout, /# setup toolkit managed route/);
    if (scenario.expected === 23) assert.match(result.stdout, /setup-toolkit-question-bank:complete/);
    else assert.match(result.stderr, /Managed setup failed before completing the question-bank protocol/);
    assert.doesNotMatch(result.stdout, /# setup toolkit checklist/);
  }
});

test('suppressed managed bank fails once with a precise no-output diagnosis and no writes', () => {
  const root = tmpRoot();
  createFakeManagedSetupScript(root, { exitCode: 23, emitQuestionBank: false });
  const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /managed setup script version/);
  assert.doesNotMatch(result.stdout, /Accept all displayed recommended settings/);
  assert.match(result.stderr, /Managed setup returned no question-bank output/);
  assert.doesNotMatch(result.stderr, /retry/i);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});

test('active fallback is used only when managed setup script is missing', () => {
  const root = tmpRoot();
  const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stdout, /setup-toolkit-question-bank:complete/);
});

test('managed setup script can run from its own standard managed checkout', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const managedScript = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  const result = spawnSync(process.execPath, [managedScript, '--execute', '--profile', 'auto-main', '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    cwd: managedPath, encoding: 'utf8', env: { ...process.env, ...isolatedHomeEnv(root) }, timeout: 300000, windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /1\.1 Update source[\s\S]*\*\*Selected:\*\* A - Use the dedicated clean update copy/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.equal(fs.existsSync(codexConfig(root)), true);
});
