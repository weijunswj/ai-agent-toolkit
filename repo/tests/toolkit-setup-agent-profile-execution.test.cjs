'use strict';

const test = require('node:test');
const control = require('../scripts/toolkit-agent-control.cjs');
const {
  assert, fs, path, tmpRoot, isolatedHomeEnv, writeFile, run,
  createGitBackedSetupRepo, codexConfig,
} = require('./toolkit-setup-test-support.cjs');

test('Claude recommended execution writes only the enforceable direct automatic profile', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fakeClaude = path.join(root, 'fake-claude.cjs');
  writeFile(fakeClaude, [
    "'use strict';",
    "if (process.argv.includes('--help')) { console.log('--print --output-format --effort --disallowedTools --permission-mode'); process.exit(0); }",
    "if (process.argv.includes('--version')) { console.log('2.1.198 (fake)'); process.exit(0); }",
    "process.exit(1);",
    '',
  ].join('\n'));
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fakeClaude, '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Direct Toolkit-managed subagents only - recommended/);
  assert.match(result.stdout, /Manage automatically based on available resources - recommended/);
  assert.match(result.stdout, /Selected topology: claude-toolkit-direct/);
  assert.match(result.stdout, /Capacity mode: automatic/);
  const profile = JSON.parse(fs.readFileSync(control.profilePath('claude-code', { root: path.join(root, '.ai-agent-toolkit', 'agent-control') }), 'utf8'));
  assert.equal(profile.topology, control.TOPOLOGIES.CLAUDE_DIRECT);
  assert.equal(profile.capacity_mode, control.CAPACITY_MODES.AUTO);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});

test('kept strict profile is invalidated after current enforcement capability disappears', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fakeClaude = path.join(root, 'fake-claude.cjs');
  writeFile(fakeClaude, [
    "'use strict';",
    "if (process.argv.includes('--help')) { console.log('--print --output-format --effort --disallowedTools --permission-mode'); process.exit(0); }",
    "if (process.argv.includes('--version')) { console.log('2.1.198 (fake)'); process.exit(0); }",
    "process.exit(1);",
    '',
  ].join('\n'));
  const env = isolatedHomeEnv(root);
  const initial = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fakeClaude, '--claude-plugin-behavior', 'instructions',
  ], { env, timeout: 300000 });
  for (const logName of ['BRIDGE_ARGS.log', 'CLAUDE_PLUGIN_SETUP.log']) {
    const logPath = path.join(setupRepo, logName);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  }
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);

  const downgraded = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fakeClaude, '--claude-topology', 'keep',
    '--claude-agent-capacity', 'keep', '--claude-plugin-behavior', 'instructions',
  ], { env: { ...env, SETUP_FAKE_CLAUDE_ENFORCEMENT: '0' }, timeout: 300000 });
  assert.equal(downgraded.status, 0, downgraded.stderr || downgraded.stdout);
  assert.match(downgraded.stdout, /capability-lost-root-only/i);
  const read = control.readProfile('claude-code', { root: path.join(root, '.ai-agent-toolkit', 'agent-control') });
  assert.equal(read.supported, false);
  assert.equal(read.topology, control.TOPOLOGIES.ROOT_ONLY);
});
