'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');

test('empty consolidated delegation answer means keep and performs no config write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', 'keep', '', 'disable', 'keep', 'keep'].join('\n'),
    timeout: 300000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex delegation control:[\s\S]*recommended: keep[\s\S]*empty input: keep/);
  assert.match(result.stdout, /Delegation enforcement status: kept/);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.match(fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8'), /--disable-codex-plugin-auto-refresh --write/);
});

test('existing exact integer values report configured without rewrite or backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('[agents]\n# user owned\nmax_threads = 1\nmax_depth = 1\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Delegation enforcement status: configured/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});

test('conflicting values remain untouched even after explicit limit approval', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('[agents]\nmax_threads = 6\nmax_depth = 2\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-delegation-control', 'limit'
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Delegation enforcement status: conflicting/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});

test('question bank pauses before plugin, config, preference, or target writes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--profile', 'auto-main', '--repo-root', setupRepo, '--repo-remote', origin], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /# setup toolkit question bank/);
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
  assert.match(result.stdout, /Delegation enforcement status: kept/);
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
    if (scenario.expected === 23) assert.match(result.stdout, /# setup toolkit question bank/);
    else assert.match(result.stderr, /managed safety blocker/);
    assert.doesNotMatch(result.stdout, /# setup toolkit checklist/);
  }
});

test('active fallback is used only when managed setup script is missing', () => {
  const root = tmpRoot();
  const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stdout, /# setup toolkit question bank/);
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
  assert.match(result.stdout, /Managed checkout:[\s\S]*recommended: keep/);
  assert.match(result.stdout, /Delegation enforcement status: kept/);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});
