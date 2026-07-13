'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');

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
    '--yes-recommended', '--claude-plugin-behavior', 'instructions', '--skip-update-report-open'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Helper-capacity detail: Host-level delegation enforcement is unsupported/);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
});

test('target keep, skip, enable-sync, and disable remain distinct', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const first = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
    '--skip-codex-plugin-auto-refresh', '--skip-target', 'opencode', '--enable-target', 'ag2'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /OpenCode action this run: skipped/);
  assert.match(first.stdout, /AG2 action this run: enabled\/synced/);
  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), { force: true });
  const second = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
    '--skip-codex-plugin-auto-refresh', '--disable-target', 'opencode', '--keep-target', 'ag2'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /OpenCode action this run: disabled/);
  assert.match(second.stdout, /AG2 action this run: kept/);
});

test('setup docs require explicit V2 opt-in and honest enforcement disclosure', () => {
  const docs = [
    '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md'
  ];
  for (const relPath of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /root agent alone|root-agent work|handled by the root agent alone|routine setup on the root agent/i, relPath);
    assert.match(text, /must not spawn subagents|do not spawn subagents/i, relPath);
    assert.match(text, /MultiAgentV2|multi_agent_v2/i, relPath);
    assert.match(text, /one helper|helper capacity/i, relPath);
    assert.match(text, /root counts|include(?:s|ing)? the root|root-inclusive/i, relPath);
    assert.match(text, /policy-only|no native hard block/i, relPath);
    assert.match(text, /Codex Security[\s\S]{0,400}(never raise|never raises|not raised automatically|no documented)/i, relPath);
    assert.doesNotMatch(text, /compatible with Codex Security|Codex Security compatible/i, relPath);
  }
  const bridge = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.doesNotMatch(bridge, /compatible with Codex Security|Codex Security compatible/i);
});
