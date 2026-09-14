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
    '--yes-recommended', '--claude-topology', 'root-only', '--claude-agent-capacity', 'root-only', '--claude-plugin-behavior', 'instructions', '--skip-update-report-open'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Route contract: toolkit\.route-resolution\.resolved-launch-record\.v1/);
  assert.match(result.stdout, /Host adapters: capability proof only/);
  assert.doesNotMatch(result.stdout, /Selected topology:|Capacity mode:/);
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
    input: Array(16).fill('').join('\n'),
  });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);

  const rejectedRoot = tmpRoot();
  const rejectedRepo = createGitBackedSetupRepo(rejectedRoot);
  const beforeStatus = runTestGit(rejectedRepo.setupRepo, ['status', '--porcelain']);
  const rejected = run([
    '--execute', '--host', 'claude-code', '--repo-root', rejectedRepo.setupRepo, '--repo-remote', rejectedRepo.origin,
  ], {
    env: isolatedHomeEnv(rejectedRoot),
    input: `${Array(16).fill('').join('\n')}\nunexpected`,
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

test('setup docs explain route resolution and honest enforcement disclosure', () => {
  const docs = [
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md'
  ];
  for (const relPath of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /root agent alone|root-agent work|handled by the root agent alone|routine setup on the root agent/i, relPath);
    assert.match(text, /must not spawn subagents|do not spawn subagents/i, relPath);
    assert.match(text, /versioned role registry|exact (?:resolved )?launch record|capability(?:-only)? host adapter/i, relPath);
    assert.match(text, /RAM|resource admission|reservations?|queue(?:\/refusal)?|checker/i, relPath);
    assert.match(text, /does not|no longer|never|cannot|fails closed|unavailable/i, relPath);
    assert.match(text, /root-only|root agent alone|root-agent work|handled by the root agent alone/i, relPath);
    assert.doesNotMatch(text, /compatible with Codex Security|Codex Security compatible/i, relPath);
  }
  const bridge = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.doesNotMatch(bridge, /compatible with Codex Security|Codex Security compatible/i);
  assert.match(bridge, /executing `?SessionStart`? bridge in that installed cache/i);
  assert.match(bridge, /managed checkout is only its refresh source/i);
  assert.match(bridge, /does not use host-reported RAM, resource admission, reservation, queue, or model-selection hints as launch policy/i);
});

test('generated Codex and Claude instruction surfaces preserve the compact host-neutral topology policy', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md'), 'utf8');
  const claude = fs.readFileSync(path.join(repoRoot, 'skills/repository-agent-rules/repo-local/CLAUDE.shim.template.md'), 'utf8');
  for (const pattern of [
    /root or parent executor owns integration, validation, conflict resolution, and final judgment/i,
    /Optional depth-1 subagents may be used only when work is genuinely separable/,
    /materially accelerates the critical path/,
    /true isolated context and a minimal self-contained task packet/,
    /must not spawn or delegate to other subagents/,
    /Mutating sibling subagents require disjoint mutation ownership and scope/,
    /Read-only siblings may investigate genuinely separable questions in parallel/,
    /Model, reasoning, service tier, and route are launch\/controller metadata/,
  ]) assert.match(agents, pattern);
  assert.doesNotMatch(agents.match(/## Agent Topology And Delegation\n([\s\S]*?)(?=\n## )/)?.[0] || '', /RAM|reservation|CPU|Children default|never use Fast|medium non-fast|special-worker|host-parity|profile\/capacity|ADMISSION_DENIED|worker-speedup|fork_turns/);
  assert.match(claude, /@AGENTS\.md/);
  assert.match(claude, /Root `AGENTS\.md` is canonical/);
  assert.doesNotMatch(claude, /multi_agent_v2|max_concurrent_threads_per_session|agents\.max_threads/);
});

test('Route policy never turns host capacity or review labels into launch authority', () => {
  const core = fs.readFileSync(path.join(repoRoot, 'repo/scripts/setup-toolkit-core.cjs'), 'utf8');
  const delegation = fs.readFileSync(path.join(repoRoot, 'repo/scripts/codex-delegation-common.cjs'), 'utf8');
  const docs = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(delegation, /CODEX_V2_RAM_SAFE_HELPERS = 1/);
  assert.doesNotMatch(delegation, /CODEX_V2_RAM_SAFE_HELPERS = [7-9]/);
  assert.match(core, /routeResolution\.CONTRACT_VERSION/);
  assert.match(core, /resource_admission:\s*false/);
  assert.match(core, /reservation_queue_policy:\s*false/);
  assert.match(core, /mandatory_pre_pr_checker:\s*false/);
  assert.match(core, /never inherits a Priority root/i);
  assert.doesNotMatch(core, /Fable 5|Opus 4\.8|Deep Security Scan/i);
  assert.match(docs, /active route contract does not use host-reported RAM, resource admission, reservation, queue, or model-selection hints as launch policy/i);
  assert.match(docs, /mandatory independent pre-PR checker route is retired/i);
});
