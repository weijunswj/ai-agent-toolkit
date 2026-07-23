'use strict';

const test = require('node:test');
const control = require('../scripts/toolkit-agent-control.cjs');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run,
  createGitBackedSetupRepo, codexConfig,
} = require('./toolkit-setup-test-support.cjs');

function recordingClaude(root, behavior = 'success') {
  const command = path.join(root, 'Claude CLI With Spaces', 'claude.cjs');
  const log = path.join(root, 'claude-sessions.jsonl');
  writeFile(command, [
    "'use strict';", "const fs = require('node:fs');", "const args = process.argv.slice(2);",
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, capabilityProbe: process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE || '' }) + '\\n');`,
    "if (args.includes('--version')) { console.log('2.1.999 fixture'); process.exit(0); }",
    ...(behavior === 'fail-checker' ? ["if (args.includes('--print') && args.includes('opus-4.8')) { console.error('unknown model opus-4.8'); process.exit(2); }"] : []),
    "if (args.includes('--print')) { console.log('{}'); process.exit(0); }",
    "process.exit(4);",
  ].join('\n'));
  return { command, log };
}

function runInteractive(root, args, options = {}) {
  const launcher = path.join(root, 'interactive-setup-launcher.cjs');
  writeFile(launcher, [
    "'use strict';",
    "Object.defineProperty(process.stdin, 'isTTY', { value: true });",
    `const setup = require(${JSON.stringify(script)});`,
    `setup.main(${JSON.stringify(args)}).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });`,
    '',
  ].join('\n'));
  return spawnSync(process.execPath, [launcher], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    input: options.input,
    timeout: options.timeout || 300000,
    windowsHide: true,
  });
}

function requireHostResourceCounters(t) {
  if (control.inspectResourceCapability().supported) return true;
  t.skip('validated host resource counters are unavailable; counter-loss fail-closed behavior is covered separately');
  return false;
}

test('ordinary interactive topology selection keeps visible direct and derives automatic capacity', (t) => {
  if (!requireHostResourceCounters(t)) return;
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = runInteractive(root, [
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--claude-cli', fake.command, '--enable-repo-auto-update', '--enable-update-reports',
    '--default-update-report-retention-days', '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), input: 'toolkit-direct\n' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Direct Toolkit-managed subagents only/);
  assert.match(result.stdout, /2\.1 How should Claude Code use agents\?: A - Direct Toolkit-managed subagents only/);
  assert.doesNotMatch(result.stdout, /Claude Code agent capacity choice|Manual maximum for Toolkit-managed Claude workers/);
  assert.match(result.stdout, /Selected topology: claude-toolkit-direct/);
  assert.match(result.stdout, /Capacity mode: automatic/);
  const profileRoot = path.join(root, '.ai-agent-toolkit', 'agent-control');
  const profile = control.readProfile('claude-code', { root: profileRoot });
  assert.equal(profile.topology, control.TOPOLOGIES.CLAUDE_DIRECT);
  assert.equal(profile.capacity_mode, control.CAPACITY_MODES.AUTO);
  const sessions = fs.readFileSync(fake.log, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(sessions.filter((entry) => entry.args.includes('--print')).length, 2);
  assert.equal(sessions.filter((entry) => entry.args.includes('--print')).every((entry) => entry.capabilityProbe === '1'), true);
});

test('ordinary complete piped answers keep visible direct and derive automatic capacity', (t) => {
  if (!requireHostResourceCounters(t)) return;
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--claude-cli', fake.command,
  ], {
    env: isolatedHomeEnv(root),
    timeout: 300000,
    input: ['enable', 'enable', 'default', 'toolkit-direct', 'instructions', ''].join('\n'),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /2\.1 How should Claude Code use agents\?: A - Direct Toolkit-managed subagents only/);
  assert.doesNotMatch(result.stdout, /Claude Code agent capacity choice|Manual maximum for Toolkit-managed Claude workers/);
  assert.match(result.stdout, /Selected topology: claude-toolkit-direct/);
  assert.match(result.stdout, /Capacity mode: automatic/);
  const profileRoot = path.join(root, '.ai-agent-toolkit', 'agent-control');
  const profile = control.readProfile('claude-code', { root: profileRoot });
  assert.equal(profile.topology, control.TOPOLOGIES.CLAUDE_DIRECT);
  assert.equal(profile.capacity_mode, control.CAPACITY_MODES.AUTO);
  const sessions = fs.readFileSync(fake.log, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(sessions.filter((entry) => entry.args.includes('--print')).length, 2);
  assert.equal(sessions.filter((entry) => entry.args.includes('--print')).every((entry) => entry.capabilityProbe === '1'), true);
});

test('Claude recommended execution writes only the enforceable direct automatic profile', (t) => {
  if (!requireHostResourceCounters(t)) return;
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fakeClaude = path.join(root, 'fake-claude.cjs');
  writeFile(fakeClaude, [
    "'use strict';",
    "if (process.argv.includes('--version')) { console.log('2.1.198 (fake)'); process.exit(0); }",
    "if (process.argv.includes('--print')) { console.log('{}'); process.exit(0); }",
    "process.exit(1);",
    '',
  ].join('\n'));
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fakeClaude, '--claude-topology', 'toolkit-direct', '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\*\*Recommended:\*\* B - Root agent only/);
  assert.match(result.stdout, /\*\*Recommended outcome:\*\* Use the root agent only until every strict launch control is verifiable\./);
  assert.match(result.stdout, /\*\*Selected:\*\* A - Direct Toolkit-managed subagents only/);
  assert.doesNotMatch(result.stdout, /How should Toolkit manage agent capacity|Claude Code agent capacity choice/);
  assert.match(result.stdout, /Helper-agent capacity questions shown: no; Toolkit automatically limits controlled children/);
  assert.match(result.stdout, /Selected topology: claude-toolkit-direct/);
  assert.match(result.stdout, /Capacity mode: automatic/);
  const profile = JSON.parse(fs.readFileSync(control.profilePath('claude-code', { root: path.join(root, '.ai-agent-toolkit', 'agent-control') }), 'utf8'));
  assert.equal(profile.topology, control.TOPOLOGIES.CLAUDE_DIRECT);
  assert.equal(profile.capacity_mode, control.CAPACITY_MODES.AUTO);
  assert.equal(profile.claude_cli, fakeClaude);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});

test('keep current preserves compatible direct automatic and manual capacity without a hidden flag', (t) => {
  if (!requireHostResourceCounters(t)) return;
  for (const expectedMode of [control.CAPACITY_MODES.AUTO, control.CAPACITY_MODES.MANUAL]) {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    const fake = recordingClaude(root);
    const env = isolatedHomeEnv(root);
    const initialArgs = [
      '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
      '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'toolkit-direct',
      '--claude-plugin-behavior', 'instructions',
    ];
    if (expectedMode === control.CAPACITY_MODES.MANUAL) {
      initialArgs.push('--claude-agent-capacity', 'manual', '--claude-agent-maximum', '2');
    }
    const initial = run(initialArgs, { env, timeout: 300000 });
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    if (fs.existsSync(fake.log)) fs.unlinkSync(fake.log);
    for (const logName of ['BRIDGE_ARGS.log', 'CLAUDE_PLUGIN_SETUP.log']) {
      const logPath = path.join(setupRepo, logName);
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    }

    const kept = run([
      '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
      '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'keep',
      '--claude-plugin-behavior', 'instructions',
    ], { env, timeout: 300000 });
    assert.equal(kept.status, 0, kept.stderr || kept.stdout);
    assert.match(kept.stdout, /\*\*Selected:\*\* D - Keep current/);
    assert.doesNotMatch(kept.stdout, /Claude Code agent capacity choice|Manual maximum for Toolkit-managed Claude workers/);
    assert.match(kept.stdout, /Selected topology: claude-toolkit-direct/);
    assert.match(kept.stdout, new RegExp(`Capacity mode: ${expectedMode}`));
    const profileRoot = path.join(root, '.ai-agent-toolkit', 'agent-control');
    const profile = control.readProfile('claude-code', { root: profileRoot });
    assert.equal(profile.topology, control.TOPOLOGIES.CLAUDE_DIRECT);
    assert.equal(profile.capacity_mode, expectedMode);
    if (expectedMode === control.CAPACITY_MODES.MANUAL) {
      assert.equal(profile.manual_maximum, 2);
      assert.match(kept.stdout, /Manual Claude worker maximum: 2/);
    }
    const sessions = fs.readFileSync(fake.log, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(sessions.filter((entry) => entry.args.includes('--print')).length, 2);
    assert.equal(sessions.filter((entry) => entry.args.includes('--print')).every((entry) => entry.capabilityProbe === '1'), true);
  }
});

test('kept strict profile is invalidated after current enforcement capability disappears', (t) => {
  if (!requireHostResourceCounters(t)) return;
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fakeClaude = path.join(root, 'fake-claude.cjs');
  writeFile(fakeClaude, [
    "'use strict';",
    "if (process.argv.includes('--version')) { console.log('2.1.198 (fake)'); process.exit(0); }",
    "if (process.argv.includes('--print')) { console.log('{}'); process.exit(0); }",
    "process.exit(1);",
    '',
  ].join('\n'));
  const env = isolatedHomeEnv(root);
  const initial = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fakeClaude, '--claude-topology', 'toolkit-direct', '--claude-plugin-behavior', 'instructions',
  ], { env, timeout: 300000 });
  for (const logName of ['BRIDGE_ARGS.log', 'CLAUDE_PLUGIN_SETUP.log']) {
    const logPath = path.join(setupRepo, logName);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  }
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);

  const downgraded = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fakeClaude, '--claude-topology', 'keep',
    '--claude-plugin-behavior', 'instructions',
  ], { env: { ...env, SETUP_FAKE_CLAUDE_TRUST: '0' }, timeout: 300000 });
  assert.equal(downgraded.status, 0, downgraded.stderr || downgraded.stdout);
  assert.match(downgraded.stdout, /capability-lost-root-only/i);
  const read = control.readProfile('claude-code', { root: path.join(root, '.ai-agent-toolkit', 'agent-control') });
  assert.equal(read.supported, false);
  assert.equal(read.topology, control.TOPOLOGIES.ROOT_ONLY);
});

test('approved root-only setup completes without worker or checker capability probes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'root-only',
    '--claude-agent-capacity', 'root-only', '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(fake.log), false);
  assert.match(result.stdout, /Selected topology: root-only/);
});


test('yes-recommended keeps conservative root-only without unnecessary direct probes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\*\*Selected:\*\* B - Root agent only/);
  assert.match(result.stdout, /Selected topology: root-only/);
  assert.equal(fs.existsSync(fake.log), false);
  const profileRoot = path.join(root, '.ai-agent-toolkit', 'agent-control');
  assert.equal(control.readProfile('claude-code', { root: profileRoot }).topology, control.TOPOLOGIES.ROOT_ONLY);
});
test('direct topology with stale enforcement never probes through the stale plugin', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'toolkit-direct',
    '--claude-plugin-behavior', 'instructions',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CLAUDE_ENFORCEMENT: '0' }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(fake.log), false);
  assert.match(result.stdout, /capability-lost-root-only/i);
});

test('direct topology refresh requiring restart remains root-only without a stale-process probe', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'toolkit-direct',
    '--claude-plugin-behavior', 'install',
  ], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CLAUDE_REFRESH_REQUIRED: '1' }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sessions = fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').trim().split(/\\r?\\n/).filter(Boolean).map(JSON.parse) : [];
  assert.equal(sessions.some((entry) => entry.args.includes('--print')), false);
  assert.match(result.stdout, /restart-pending-root-only/i);
  assert.match(result.stdout, /restart required: yes/i);
});

test('post-approval checker capability failure fails closed after exact isolated probes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root, 'fail-checker');
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'toolkit-direct',
    '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capability-lost-root-only/i);
  const sessions = fs.readFileSync(fake.log, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(sessions.filter((entry) => entry.args.includes('--print')).length, 2);
  assert.equal(sessions.filter((entry) => entry.args.includes('opus-4.8')).length, 1);
  assert.equal(sessions.filter((entry) => entry.args.includes('--print')).every((entry) => entry.capabilityProbe === '1'), true);
});
test('kept broader-native survives root-only capacity across flag and piped execution', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const env = isolatedHomeEnv(root);
  const profileRoot = path.join(root, '.ai-agent-toolkit', 'agent-control');
  control.configureProfile('claude-code', {
    topology: control.TOPOLOGIES.BROADER_NATIVE,
    capacity_mode: control.CAPACITY_MODES.ROOT_ONLY,
  }, { root: profileRoot });

  const flagged = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--claude-cli', fake.command, '--claude-topology', 'keep', '--claude-agent-capacity', 'root-only',
    '--claude-plugin-behavior', 'instructions', '--yes-recommended',
  ], { env, timeout: 300000 });
  assert.equal(flagged.status, 0, flagged.stderr || flagged.stdout);
  assert.match(flagged.stdout, /Selected topology: broader-native/);
  assert.equal(control.readProfile('claude-code', { root: profileRoot }).topology, control.TOPOLOGIES.BROADER_NATIVE);
  assert.equal(fs.existsSync(fake.log), false);
  for (const logName of ['BRIDGE_ARGS.log', 'CLAUDE_PLUGIN_SETUP.log']) {
    const logPath = path.join(setupRepo, logName);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  }

  const piped = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--claude-cli', fake.command,
    '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions',
  ], {
    env,
    timeout: 300000,
    input: Array(16).fill('').join('\n'),
  });
  assert.equal(piped.status, 0, piped.stderr || piped.stdout);
  assert.match(piped.stdout, /Selected topology: broader-native/);
  const preserved = control.readProfile('claude-code', { root: profileRoot });
  assert.equal(preserved.topology, control.TOPOLOGIES.BROADER_NATIVE);
  assert.equal(preserved.capacity_mode, control.CAPACITY_MODES.ROOT_ONLY);
  assert.equal(fs.existsSync(fake.log), false);
});
