'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
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
  const gate = fs.readFileSync(path.join(repoRoot, 'repo/contracts/agent-rules/gate-rules.md'), 'utf8');
  for (const pattern of [
    /By default G0 delegates suitable separable evidence gathering and G1 suitable independent implementation or validation/,
    /In gate work only a G0 or G1 lead launches helpers; helpers never launch or ask for another agent, and G2 has none/,
  ]) assert.match(global, pattern);
  // Prompt hygiene for gate launches is a gate mechanic, kept in the gate rules.
  assert.match(gate, /Keep model, effort, tier and route out of portable task prompts unless a runtime requires them/);
  for (const pattern of [
    /root session owns integration, validation, conflict resolution and final judgement/,
    /isolated context and one minimal self-contained task/,
    /Mutating siblings need disjoint files and scope; read-only siblings may investigate separable questions in parallel/,
  ]) assert.match(global, pattern);
  for (const text of [agents, global, gate]) {
    // Hardware tokens need word boundaries: PROGRAMME is a fixed task name, not a RAM policy.
    assert.doesNotMatch(text, /\bRAM\b|reservation|\bCPU\b|Children default|never use Fast|medium non-fast|special-worker|host-parity|profile\/capacity|ADMISSION_DENIED|worker-speedup|fork_turns/);
  }
  assert.equal(claude, '@AGENTS.md\n');
  assert.doesNotMatch(claude, /multi_agent_v2|max_concurrent_threads_per_session|agents\.max_threads/);
});
