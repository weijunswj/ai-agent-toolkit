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
    '--yes-recommended', '--claude-topology', 'root-only', '--claude-plugin-behavior', 'instructions', '--skip-update-report-open'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Selected topology: root-only/);
  assert.doesNotMatch(result.stdout, /Capacity mode:|Manual maximum backstop/);
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

// Toolkit 3.3.0 removed the OpenCode and AG2 bridge targets: setup refuses their flags before any write.
test('setup refuses the removed bridge-target flags before any write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  for (const flag of [['--skip-target', 'opencode'], ['--disable-target', 'opencode'], ['--enable-target', 'ag2'],
    ['--keep-target', 'opencode'], ['--opencode-project-root', root]]) {
    const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
      '--skip-codex-plugin-auto-refresh', ...flag], { env: isolatedHomeEnv(root) });
    assert.notEqual(result.status, 0, flag[0]);
    assert.match(result.stderr + result.stdout, new RegExp(`Unknown argument: ${flag[0]}`), flag[0]);
  }
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit', 'current')), false, 'nothing was written');
});

test('setup docs claim no retired automatic admission and keep honest enforcement disclosure', () => {
  const docs = [
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md'
  ];
  for (const relPath of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    if (relPath === 'skills/toolkit-setup/SKILL.md') {
      // V3 section 10: the lead owns setup decisions and default-delegates suitable separable work.
      assert.match(text, /lead owns the interactive setup decisions and integration/i, relPath);
      assert.match(text, /default-delegate suitable separable evidence gathering/i, relPath);
    } else {
      assert.match(text, /root agent alone|root-agent work|handled by the root agent alone|routine setup on the root agent/i, relPath);
      assert.match(text, /must not spawn subagents|do not spawn subagents/i, relPath);
    }
    // The retired Toolkit direct launcher's automatic memory admission is no longer claimed.
    assert.doesNotMatch(text, /limited automatically from verified available memory|automatically limits controlled children/i, relPath);
    if (relPath !== 'skills/toolkit-setup/SKILL.md') assert.match(text, /root-only|root agent alone|root-agent work|handled by the root agent alone/i, relPath);
    assert.match(text, /recommends one helper|recommendation is one helper/i, relPath);
    assert.match(text, /policy-only|no native hard block|no invented host-level enforcement|cannot .*strict enforcement|unsupported .*enforcement|no Markdown-only path is called hard enforcement/i, relPath);
    assert.doesNotMatch(text, /compatible with Codex Security|Codex Security compatible/i, relPath);
  }
  const bridge = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.doesNotMatch(bridge, /compatible with Codex Security|Codex Security compatible/i);
  assert.match(bridge, /executing `?SessionStart`? bridge in that installed cache/i);
  assert.match(bridge, /managed checkout is only its refresh source/i);
});

test('generated Codex and Claude instruction surfaces preserve the compact host-neutral topology policy', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md'), 'utf8');
  const global = fs.readFileSync(path.join(repoRoot, 'repo/contracts/agent-rules/global-rules.md'), 'utf8');
  const claude = fs.readFileSync(path.join(repoRoot, 'skills/repository-agent-rules/repo-local/CLAUDE.shim.template.md'), 'utf8');
  for (const pattern of [
    /G0 must delegate suitable separable evidence gathering, and G1 suitable independent implementation or validation/,
    /Only a G0 or G1 lead launches helpers; helpers never launch or ask for another agent, and G2 has none/,
    /Keep model, effort, tier and route out of portable task prompts unless a runtime requires them/,
  ]) assert.match(global, pattern);
  for (const pattern of [
    /root session owns integration, validation, conflict resolution and final judgement/,
    /isolated context and one minimal self-contained task/,
    /Mutating siblings need disjoint files and scope; read-only siblings may investigate separable questions in parallel/,
  ]) assert.match(global, pattern);
  for (const text of [agents, global]) {
    assert.doesNotMatch(text, /RAM|reservation|CPU|Children default|never use Fast|medium non-fast|special-worker|host-parity|profile\/capacity|ADMISSION_DENIED|worker-speedup|fork_turns/);
  }
  assert.equal(claude, '@AGENTS.md\n');
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

// A setup run from the managed checkout it fast-forwards keeps its old scripts in memory, so an
// update that changes setup's scripts stops the run before any plugin or config step.
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

test('setup that updates its own scripts stops before plugin and config steps, and the next run finishes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const updated = pushToOrigin(setupRepo, 'repo/scripts/setup-self-update-marker.cjs', "'use strict';\n");

  const first = runOwnManagedSetup(root, origin, managedPath);
  assert.equal(first.status, 24, first.stderr || first.stdout);
  assert.match(first.stdout, /## Setup updated itself\nSetup updated its Toolkit copy from [0-9a-f]{7} to [0-9a-f]{7}, and the update changed setup's own scripts\./);
  assert.match(first.stdout, /Run the same setup command again/);
  assert.equal(runTestGit(managedPath, ['rev-parse', 'HEAD']).trim(), updated);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.doesNotMatch(first.stdout, /Configuration changed this run/);

  const second = runOwnManagedSetup(root, origin, managedPath);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.doesNotMatch(second.stdout, /## Setup updated itself/);
  assert.equal(fs.existsSync(codexConfig(root)), true);
});

test('an update outside setup scripts does not stop the setup run', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  pushToOrigin(setupRepo, 'repo/docs/NOTE.md', 'docs only\n');

  const result = runOwnManagedSetup(root, origin, managedPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /## Setup updated itself/);
  assert.equal(fs.existsSync(codexConfig(root)), true);
});
