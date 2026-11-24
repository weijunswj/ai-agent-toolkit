'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference
} = require('./toolkit-setup-test-support.cjs');
function runOwnManagedSetup(root, origin, managedPath) {
  const managedScript = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  return spawnSync(process.execPath, [managedScript, '--execute', '--profile', 'auto-main', '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    cwd: managedPath, encoding: 'utf8', env: { ...process.env, ...isolatedHomeEnv(root) }, timeout: 300000, windowsHide: true
  });
}
function pushToOrigin(setupRepo, rel, text) {
  writeFile(path.join(setupRepo, ...rel.split('/')), text);
  runTestGit(setupRepo, ['add', rel]);
  runTestGit(setupRepo, ['commit', '-m', `update ${rel}`]);
  runTestGit(setupRepo, ['push', 'origin', 'main']);
  return runTestGit(setupRepo, ['rev-parse', 'HEAD']).trim();
}

// Split by complete test declarations to keep the per-file time budget.
test('unsafe managed paths and local divergence still fail before writes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  writeFile(path.join(setupRepo, 'LOCAL_ONLY.md'), 'local-only\n');
  runTestGit(setupRepo, ['add', 'LOCAL_ONLY.md']);
  runTestGit(setupRepo, ['commit', '-m', 'local only']);
  const divergent = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended'], { env: isolatedHomeEnv(root) });
  assert.notEqual(divergent.status, 0);
  assert.match(divergent.stderr, /cannot fast-forward/i);
  assert.equal(fs.existsSync(codexConfig(root)), false);

  const unsafeHome = path.join(root, '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local');
  const unsafe = run(['--execute', '--profile', 'auto-main', '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(unsafeHome) });
  assert.equal(unsafe.status, 1, unsafe.stderr || unsafe.stdout);
  assert.match(unsafe.stderr, /must not live inside plugin cache or temporary marketplace paths/);
});

test('Claude setup verifies only Claude metadata and never mutates Codex config', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-topology', 'root-only', '--claude-plugin-behavior', 'instructions', '--skip-update-report-open'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Selected topology: root-only/);
  assert.doesNotMatch(result.stdout, /Capacity mode:|Manual maximum backstop/);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
});

// Claude Code asks one question: piped input answers it with the displayed bank reference on one line, and a
// second non-empty line is refused before any write. Empty piped lines are not an answer.
test('Claude setup rejects extra non-empty piped input before every setup write', () => {
  const claudeArgs = (repo) => ['--execute', '--host', 'claude-code', '--repo-root', repo.setupRepo, '--repo-remote', repo.origin];
  const validRoot = tmpRoot();
  const validRepo = createGitBackedSetupRepo(validRoot);
  const empty = run(claudeArgs(validRepo), { env: isolatedHomeEnv(validRoot), input: Array(16).fill('').join('\n') });
  assert.equal(empty.status, 23, empty.stderr || empty.stdout);
  const valid = run(claudeArgs(validRepo), { env: isolatedHomeEnv(validRoot), input: `${displayedBankReference(empty.stdout)}: yes\n` });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);

  const rejectedRoot = tmpRoot();
  const rejectedRepo = createGitBackedSetupRepo(rejectedRoot);
  const beforeStatus = runTestGit(rejectedRepo.setupRepo, ['status', '--porcelain']);
  const shown = run(claudeArgs(rejectedRepo), { env: isolatedHomeEnv(rejectedRoot), input: '' });
  assert.equal(shown.status, 23, shown.stderr || shown.stdout);
  const rejected = run(claudeArgs(rejectedRepo), {
    env: isolatedHomeEnv(rejectedRoot),
    input: `${displayedBankReference(shown.stdout)}: yes\nunexpected`,
  });
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.match(rejected.stderr, /Setup question bank received unexpected extra non-empty input\./);
  assert.equal(fs.existsSync(path.join(rejectedRepo.setupRepo, 'CLAUDE_PLUGIN_HELPER_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(rejectedRepo.setupRepo, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(rejectedRepo.setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(runTestGit(rejectedRepo.setupRepo, ['status', '--porcelain']), beforeStatus);
  assert.equal(fs.existsSync(codexConfig(rejectedRoot)), false);
});

test('Claude setup refuses a change typed on a second piped line before any write', () => {
  const claudeArgs = (repo) => ['--execute', '--host', 'claude-code', '--repo-root', repo.setupRepo, '--repo-remote', repo.origin];
  const root = tmpRoot();
  const repo = createGitBackedSetupRepo(root);
  const shown = run(claudeArgs(repo), { env: isolatedHomeEnv(root), input: '' });
  assert.equal(shown.status, 23, shown.stderr || shown.stdout);
  const beforeStatus = runTestGit(repo.setupRepo, ['status', '--porcelain']);
  const rejected = run(claudeArgs(repo), { env: isolatedHomeEnv(root), input: `${displayedBankReference(shown.stdout)}: yes\n3.5=off\n` });
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.match(rejected.stderr, /Setup question bank received unexpected extra non-empty input\./);
  assert.equal(fs.existsSync(path.join(root, '.claude', 'settings.json')), false, 'no Claude Code setting is written');
  assert.equal(fs.existsSync(path.join(repo.setupRepo, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(runTestGit(repo.setupRepo, ['status', '--porcelain']), beforeStatus);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});

test('a no to the Claude Code bank says setup changed none of your settings, and writes none', () => {
  const claudeArgs = (repo) => ['--execute', '--host', 'claude-code', '--repo-root', repo.setupRepo, '--repo-remote', repo.origin];
  const root = tmpRoot();
  const repo = createGitBackedSetupRepo(root);
  const shown = run(claudeArgs(repo), { env: isolatedHomeEnv(root), input: '' });
  assert.equal(shown.status, 23, shown.stderr || shown.stdout);
  const declined = run(claudeArgs(repo), { env: isolatedHomeEnv(root), input: `${displayedBankReference(shown.stdout)}: no\n` });
  assert.equal(declined.status, 0, declined.stderr || declined.stdout);
  assert.match(declined.stdout, /^Nothing changed: you answered no, so setup changed none of your settings\. Say setup toolkit again/m);
  assert.doesNotMatch(declined.stdout, /fast-forwarded|wrote nothing/);
  assert.equal(fs.existsSync(path.join(root, '.claude', 'settings.json')), false);
});
