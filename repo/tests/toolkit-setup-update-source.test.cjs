'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, tmpRoot, isolatedHomeEnv, run, runTestGit,
  createMinimalSetupRepo, createGitBackedSetupRepo, codexConfig,
} = require('./toolkit-setup-test-support.cjs');

function auditState(repoPath) {
  return {
    update_report_enabled: true,
    update_report_open_enabled: false,
    update_report_retention_days: 7,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled: false, last_status: 'configured', repo_path: repoPath },
    targets: {
      opencode: { detected: false, enabled: false, synced: false },
      ag2: { detected: false, enabled: false, synced: false },
    },
  };
}

function initSetupRepoAt(root, setupRepo) {
  const origin = path.join(root, 'origin.git');
  fs.mkdirSync(setupRepo, { recursive: true });
  runTestGit(root, ['init', '--bare', origin]);
  runTestGit(setupRepo, ['init']);
  runTestGit(setupRepo, ['checkout', '-b', 'main']);
  runTestGit(setupRepo, ['config', 'user.email', 'setup-test@example.invalid']);
  runTestGit(setupRepo, ['config', 'user.name', 'Setup Test']);
  createMinimalSetupRepo(setupRepo);
  runTestGit(setupRepo, ['add', '.']);
  runTestGit(setupRepo, ['commit', '-m', 'base']);
  runTestGit(setupRepo, ['remote', 'add', 'origin', origin]);
  runTestGit(setupRepo, ['push', '-u', 'origin', 'main']);
  return { origin, setupRepo };
}

function configuredSourceSnapshot(configuredPath) {
  if (!configuredPath) return { configured: false };
  if (!fs.existsSync(configuredPath)) return { configured: true, exists: false };
  const git = spawnSync('git', ['-C', configuredPath, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) {
    return { configured: true, exists: true, git: false, entries: fs.readdirSync(configuredPath).sort() };
  }
  return {
    configured: true,
    exists: true,
    git: true,
    status: runTestGit(configuredPath, ['status', '--porcelain']),
    branch: runTestGit(configuredPath, ['branch', '--show-current']),
    remote: runTestGit(configuredPath, ['remote', 'get-url', 'origin']),
    head: runTestGit(configuredPath, ['rev-parse', 'HEAD']),
  };
}

function assertNoSetupWrites(root, setupRepo, beforeStatus, configuredPath, beforeConfigured) {
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.equal(runTestGit(setupRepo, ['status', '--porcelain']), beforeStatus);
  assert.deepEqual(configuredSourceSnapshot(configuredPath), beforeConfigured);
}

test('explicit Update source keep rejects every unpreservable configured state before mutation', () => {
  const cases = [
    {
      name: 'no configured source',
      prepare(root) {
        const fixture = createGitBackedSetupRepo(root);
        return { ...fixture, configuredPath: '' };
      },
    },
    {
      name: 'configured path missing',
      prepare(root) {
        const fixture = createGitBackedSetupRepo(root);
        return { ...fixture, configuredPath: path.join(root, 'missing-source') };
      },
    },
    {
      name: 'configured path is not Git',
      prepare(root) {
        const fixture = createGitBackedSetupRepo(root);
        const configuredPath = path.join(root, 'not-git');
        fs.mkdirSync(configuredPath);
        fs.writeFileSync(path.join(configuredPath, 'marker.txt'), 'unchanged\n');
        return { ...fixture, configuredPath };
      },
    },
    {
      name: 'configured checkout is dirty',
      prepare(root) {
        const fixture = createGitBackedSetupRepo(root);
        fs.writeFileSync(path.join(fixture.setupRepo, 'DIRTY.txt'), 'unchanged\n');
        return { ...fixture, configuredPath: fixture.setupRepo };
      },
    },
    {
      name: 'configured checkout uses the wrong branch',
      prepare(root) {
        const fixture = createGitBackedSetupRepo(root);
        runTestGit(fixture.setupRepo, ['checkout', '-b', 'review-branch']);
        return { ...fixture, configuredPath: fixture.setupRepo };
      },
    },
    {
      name: 'configured checkout uses the wrong remote',
      prepare(root) {
        const fixture = createGitBackedSetupRepo(root);
        runTestGit(fixture.setupRepo, ['remote', 'set-url', 'origin', path.join(root, 'unexpected-origin.git')]);
        return { ...fixture, configuredPath: fixture.setupRepo };
      },
    },
    {
      name: 'configured checkout is in an unsafe managed path',
      prepare(root) {
        const configuredPath = path.join(root, '.codex', 'plugins', 'cache', 'managed-source');
        const configured = initSetupRepoAt(root, configuredPath);
        const probe = createGitBackedSetupRepo(path.join(root, 'probe'));
        return { origin: configured.origin, setupRepo: probe.setupRepo, configuredPath };
      },
    },
  ];

  for (const fixtureCase of cases) {
    const root = tmpRoot();
    const { origin, setupRepo, configuredPath } = fixtureCase.prepare(root);
    const beforeStatus = runTestGit(setupRepo, ['status', '--porcelain']);
    const beforeConfigured = configuredSourceSnapshot(configuredPath);
    const env = {
      ...isolatedHomeEnv(root),
      SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditState(configuredPath)),
    };
    const result = run([
      '--execute', '--repo-root', setupRepo, '--managed-checkout', 'keep',
      '--repo-remote', origin, '--yes-recommended',
    ], { env, timeout: 300000 });
    assert.notEqual(result.status, 0, fixtureCase.name);
    assert.match(result.stderr, /Update source must be one of: default, custom/i, fixtureCase.name);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /missing-source|not-git|DIRTY\.txt|review-branch|unexpected-origin|plugins[\\/]cache/i, fixtureCase.name);
    assertNoSetupWrites(root, setupRepo, beforeStatus, configuredPath, beforeConfigured);
  }
});

test('valid custom Update source keep preserves its configured checkout through approval and execution', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const env = {
    ...isolatedHomeEnv(root),
    SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditState(setupRepo)),
  };
  const result = run([
    '--execute', '--repo-root', setupRepo, '--managed-checkout', 'keep',
    '--repo-remote', origin, '--yes-recommended', '--codex-helper-capacity', 'keep',
  ], { env, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Update source: Keep the current update source - Preserve this effective behavior: Toolkit uses a separate clean custom checkout/i);
  assert.match(result.stdout, /Managed checkout path: <managed-toolkit-checkout>/);
  const leakedLines = result.stdout.split(/\r?\n/).filter((line) => line.includes(setupRepo)).map((line) => line.replaceAll(setupRepo, '<managed-toolkit-checkout>'));
  assert.deepEqual(leakedLines, []);
  const bridgeArgs = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeArgs, new RegExp(`--repo-path ${setupRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('valid standard Update source keep remains available and preserves the standard checkout', () => {
  const root = tmpRoot();
  const standardPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const { origin, setupRepo } = initSetupRepoAt(root, standardPath);
  const env = {
    ...isolatedHomeEnv(root),
    SETUP_FAKE_AUDIT_JSON: JSON.stringify(auditState(setupRepo)),
  };
  const result = run([
    '--execute', '--managed-checkout', 'keep', '--repo-remote', origin,
    '--yes-recommended', '--codex-helper-capacity', 'keep',
  ], { env, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Update source[\s\S]*\*\*Recommended:\*\* Keep using the verified dedicated clean managed copy/i);
  assert.match(result.stdout, /Update source: Keep the current update source - Preserve this effective behavior: Toolkit uses the dedicated clean managed copy/i);
  assert.match(result.stdout, /Managed checkout path: <managed-toolkit-checkout>/);
  const leakedLines = result.stdout.split(/\r?\n/).filter((line) => line.includes(setupRepo)).map((line) => line.replaceAll(setupRepo, '<managed-toolkit-checkout>'));
  assert.deepEqual(leakedLines, []);
});
