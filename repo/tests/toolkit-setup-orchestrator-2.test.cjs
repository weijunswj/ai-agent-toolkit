'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

test('empty consolidated delegation answer selects the visible one-helper recommendation', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', '', 'disable'].join('\n'),
    timeout: 300000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /How many helper agents may Codex use\?[\s\S]*\*\*Selected:\*\* One helper at most - recommended/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 2/);
  assert.match(fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8'), /--disable-codex-plugin-auto-refresh --write/);
});

test('explicit keep does not migrate an exact legacy block or create a backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = `[agents]\n${delegation.expectedLegacyBlock(1)}\n`;
  writeFile(configPath, original);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--skip-codex-plugin-auto-refresh'], {
    env: isolatedHomeEnv(root), timeout: 300000, input: ['keep', 'keep', 'keep', 'keep'].join('\n')
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Configuration changed this run: no/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(backupFiles(root), []);
});

test('legacy migration is a distinct explicit choice with a full visible preview', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  writeFile(configPath, `[agents]\n${delegation.expectedLegacyBlock(1)}\n`);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'migrate',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.stdout.indexOf('setup-toolkit-question-bank:complete') < result.stdout.indexOf('# Codex helper-agent config preview'));
  assert.match(result.stdout, /Before semantics:[\s\S]*After semantics:[\s\S]*Proposed Toolkit-managed TOML block:[\s\S]*Planned exact backup metadata:[\s\S]*Restore command setup script:[\s\S]*Exact restore command after the approved write \(PowerShell\):/);
  assert.match(result.stdout, /PR #237 legacy block migrated: yes/);
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
    else assert.match(result.stderr, /managed safety blocker/);
    assert.doesNotMatch(result.stdout, /# setup toolkit checklist/);
  }
});

test('suppressed managed bank retries once and exposes no approval shortcut or writes', () => {
  const root = tmpRoot();
  createFakeManagedSetupScript(root, { exitCode: 23, emitQuestionBank: false });
  const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /managed setup script version/);
  assert.doesNotMatch(result.stdout, /Accept all displayed recommended settings/);
  assert.match(result.stderr, /retrying the same safe pre-write request once/);
  assert.match(result.stderr, /suppressed the complete question bank twice/);
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
  assert.match(result.stdout, /Where should Toolkit updates come from\?[\s\S]*Use the dedicated clean update copy - recommended/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.equal(fs.existsSync(codexConfig(root)), true);
});
