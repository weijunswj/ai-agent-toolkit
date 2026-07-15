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

test('Claude setup rejects extra non-empty piped input before every setup write', () => {
  const validRoot = tmpRoot();
  const validRepo = createGitBackedSetupRepo(validRoot);
  const valid = run([
    '--execute', '--host', 'claude-code', '--repo-root', validRepo.setupRepo, '--repo-remote', validRepo.origin,
  ], {
    env: isolatedHomeEnv(validRoot),
    input: ['keep', 'keep', 'keep', 'instructions', '   ', ''].join('\n'),
  });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);

  const rejectedRoot = tmpRoot();
  const rejectedRepo = createGitBackedSetupRepo(rejectedRoot);
  const beforeStatus = runTestGit(rejectedRepo.setupRepo, ['status', '--porcelain']);
  const rejected = run([
    '--execute', '--host', 'claude-code', '--repo-root', rejectedRepo.setupRepo, '--repo-remote', rejectedRepo.origin,
  ], {
    env: isolatedHomeEnv(rejectedRoot),
    input: ['keep', 'keep', 'keep', 'instructions', 'unexpected'].join('\n'),
  });
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.match(rejected.stderr, /Setup question bank received unexpected extra non-empty input\./);
  assert.equal(fs.existsSync(path.join(rejectedRepo.setupRepo, 'CLAUDE_PLUGIN_HELPER_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(rejectedRepo.setupRepo, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(path.join(rejectedRepo.setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(runTestGit(rejectedRepo.setupRepo, ['status', '--porcelain']), beforeStatus);
  assert.equal(fs.existsSync(codexConfig(rejectedRoot)), false);
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
  assert.match(bridge, /executing SessionStart bridge in that installed cache/i);
  assert.match(bridge, /managed checkout is only its refresh source/i);
});

test('generated Codex and Claude instruction surfaces preserve root-first and helper no-recursion policy', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'), 'utf8');
  const claude = fs.readFileSync(path.join(repoRoot, 'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md'), 'utf8');
  for (const pattern of [
    /Complete ordinary work with root agent alone/,
    /Generic parallelism, second opinions.*are insufficient/,
    /prefer one direct specialist/,
    /completes its scope/,
    /cannot spawn another agent/,
    /returns expertise needs to root/,
  ]) assert.match(agents, pattern);
  assert.match(claude, /@AGENTS\.md/);
  assert.match(claude, /Root `AGENTS\.md` is canonical/);
  assert.doesNotMatch(claude, /multi_agent_v2|max_concurrent_threads_per_session|agents\.max_threads/);
});

test('Security policy never raises normal capacity or relabels sequential review as Deep Scan', () => {
  const core = fs.readFileSync(path.join(repoRoot, 'repo/scripts/setup-toolkit-core.cjs'), 'utf8');
  const delegation = fs.readFileSync(path.join(repoRoot, 'repo/scripts/codex-delegation-common.cjs'), 'utf8');
  const docs = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(delegation, /CODEX_V2_RAM_SAFE_HELPERS = 1/);
  assert.doesNotMatch(delegation, /CODEX_V2_RAM_SAFE_HELPERS = [7-9]/);
  assert.match(core, /normal global capacity is never raised automatically/i);
  assert.match(core, /explicitly make a temporary global increase with exact backup, restart, restoration, and another restart/i);
  assert.match(core, /A sequential custom review is not an official Deep Security Scan/i);
  assert.match(docs, /No documented Codex Security scan-scoped capacity activation exists/i);
  assert.match(docs, /explicitly approved temporary global increase with backup and restoration/i);
});
