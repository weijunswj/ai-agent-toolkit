'use strict';

const test = require('node:test');
const control = require('../scripts/toolkit-agent-control.cjs');
const {
  assert, fs, path, tmpRoot, isolatedHomeEnv, writeFile, run,
  createGitBackedSetupRepo, codexConfig,
} = require('./toolkit-setup-test-support.cjs');

// Records every Claude invocation, so a test can prove setup launched no session.
function recordingClaude(root) {
  const command = path.join(root, 'Claude CLI With Spaces', 'claude.cjs');
  const log = path.join(root, 'claude-sessions.jsonl');
  writeFile(command, [
    "'use strict';", "const fs = require('node:fs');", "const args = process.argv.slice(2);",
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args }) + '\\n');`,
    "if (args.includes('--version')) { console.log('2.1.999 fixture'); process.exit(0); }",
    "if (args.includes('--print')) { console.log('{}'); process.exit(0); }",
    "process.exit(4);",
  ].join('\n'));
  return { command, log };
}
function sessions(fake) {
  return fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
}
function clearLogs(setupRepo) {
  for (const logName of ['BRIDGE_ARGS.log', 'CLAUDE_PLUGIN_SETUP.log']) {
    const logPath = path.join(setupRepo, logName);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  }
}
const profileRootOf = (root) => path.join(root, '.ai-agent-toolkit', 'agent-control');

test('recommended Claude execution writes a root-only profile and launches no Claude session', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-plugin-behavior', 'instructions', '--claude-settings', 'keep',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\*\*Recommended:\*\* A - Toolkit repos: main session \+ Toolkit G0\/G1 helpers only\. Elsewhere: one layer of subagents\./);
  assert.match(result.stdout, /\*\*Selected:\*\* A - Toolkit repos: main session \+ Toolkit G0\/G1 helpers only\. Elsewhere: one layer of subagents\./);
  assert.doesNotMatch(result.stdout, /Direct Toolkit-managed|toolkit-direct|agent capacity choice|Manual maximum|Capacity mode/i);
  assert.match(result.stdout, /Helper-agent capacity questions shown: no/);
  assert.match(result.stdout, /Selected topology: root-only/);
  assert.equal(sessions(fake).some((entry) => entry.args.includes('--print')), false);
  const profile = JSON.parse(fs.readFileSync(control.profilePath('claude-code', { root: profileRootOf(root) }), 'utf8'));
  assert.equal(profile.topology, control.TOPOLOGIES.ROOT_ONLY);
  assert.equal(profile.capacity_mode, control.CAPACITY_MODES.ROOT_ONLY);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  // The recommended root-only answer also writes only the Toolkit-owned depth key into the temporary Claude settings.
  assert.match(result.stdout, /One-layer subagent setting this run: changed; Your Claude Code user settings set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 \(set by Toolkit\)\. In Claude Code 2\.1\.217 or later this allows one layer/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')),
    { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1' } });
  // Root-only with hook activation verified this run: both protections are named.
  assert.match(result.stdout, /Normal folders: one layer; the main session may start subagents; subagents never start another \(the Claude Code user setting CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1, read by Claude Code 2\.1\.217 or later, and the installed Toolkit hook, verified this run\)\./);
});

test('broader-native execution reports Claude Code\'s own limit, not a one-layer cap', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const env = isolatedHomeEnv(root);
  const base = ['--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-plugin-behavior', 'instructions', '--claude-settings', 'keep'];
  const settings = path.join(root, '.claude', 'settings.json');
  assert.equal(run([...base, '--claude-topology', 'root-only'], { env, timeout: 300000 }).status, 0);
  assert.equal(fs.existsSync(settings), true);
  clearLogs(setupRepo);
  const broader = run([...base, '--claude-topology', 'broader-native'], { env, timeout: 300000 });
  assert.equal(broader.status, 0, broader.stderr || broader.stdout);
  assert.match(broader.stdout, /Selected topology: broader-native/);
  assert.doesNotMatch(broader.stdout, /Normal folders: one layer/);
  assert.match(broader.stdout, /Normal folders: Claude Code's own limit; Toolkit does not refuse nested launches\. CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH is not set in your Claude Code user settings, so Claude Code's own default applies\./);
  assert.equal(fs.existsSync(settings), false, 'Toolkit-created settings file is removed');
});

test('the recommended Claude Code settings are written to the temporary Claude settings and turned off again', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const env = isolatedHomeEnv(root);
  const base = ['--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-plugin-behavior', 'instructions', '--claude-topology', 'broader-native'];
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const on = run(base, { env, timeout: 300000 });
  assert.equal(on.status, 0, on.stderr || on.stdout);
  assert.match(on.stdout, /Claude Code settings this run: No AI attribution in commits and pull requests: on \(set by Toolkit\)\./);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), {
    attribution: false,
    crossSessionInbound: 'accept',
    switchModelsOnFlag: false,
    pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md-and-agents-md' } } }
  });
  clearLogs(setupRepo);
  const off = run([...base, '--claude-settings', 'disable'], { env, timeout: 300000 });
  assert.equal(off.status, 0, off.stderr || off.stdout);
  assert.equal(fs.existsSync(settingsPath), false, 'the file Toolkit created is removed when nothing else is left');
});

test('the retired Toolkit direct topology and capacity flags fail before any setup write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const base = ['--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--claude-cli', fake.command];
  for (const [extra, pattern] of [
    [['--claude-topology', 'toolkit-direct'], /Unsupported --claude-topology choice: toolkit-direct/],
    [['--claude-agent-capacity', 'automatic'], /Unknown argument: --claude-agent-capacity/],
    [['--claude-agent-maximum', '2'], /Unknown argument: --claude-agent-maximum/],
  ]) {
    const result = run([...base, ...extra], { env: isolatedHomeEnv(root), timeout: 300000 });
    assert.notEqual(result.status, 0, extra.join(' '));
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
  }
  assert.equal(fs.existsSync(control.profilePath('claude-code', { root: profileRootOf(root) })), false);
  assert.equal(sessions(fake).length, 0);
});

test('a piped toolkit-direct answer is not a topology choice and writes nothing', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const result = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin, '--claude-cli', fake.command,
  ], { env: isolatedHomeEnv(root), timeout: 300000, input: ['enable', 'enable', 'default', 'enable', 'toolkit-direct', 'instructions', 'keep', ''].join('\n') });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /must be one of: root-only, broader-native, keep/);
  assert.equal(fs.existsSync(control.profilePath('claude-code', { root: profileRootOf(root) })), false);
  assert.equal(sessions(fake).length, 0);
});

test('keep current resolves a stored direct profile to root-only without probing', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const target = control.profilePath('claude-code', { root: profileRootOf(root) });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({
    schema: control.SCHEMA, host: 'claude-code', topology: 'claude-toolkit-direct', capacity_mode: control.CAPACITY_MODES.AUTO,
    manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST, queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
    controller_version: control.CONTROL_VERSION, enforcement_verified: true, enforcement: 'toolkit-launch-boundary', claude_cli: fake.command,
    resource_counter_verified: true, resource_counter_source: 'proc-meminfo', updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
  const kept = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  // Keep leaves the depth setting alone, so the root-only fallback has no native one-layer setting: the install check says so.
  assert.equal(kept.status, 24, kept.stderr || kept.stdout);
  assert.match(kept.stdout, /Install check: action required\n/);
  assert.match(kept.stdout, /Claude Code depth setting: Root-only is selected, but CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH is not set in your Claude Code user settings\./);
  assert.match(kept.stdout, /\*\*Selected:\*\* C - Keep current/);
  assert.match(kept.stdout, /Selected topology: root-only/);
  assert.equal(sessions(fake).some((entry) => entry.args.includes('--print')), false);
  assert.equal(control.readProfile('claude-code', { root: profileRootOf(root) }).topology, control.TOPOLOGIES.ROOT_ONLY);
});

test('a kept root-only profile becomes the safe root-only policy once current enforcement disappears', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const env = isolatedHomeEnv(root);
  const initial = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'root-only', '--claude-plugin-behavior', 'instructions',
  ], { env, timeout: 300000 });
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  assert.equal(control.readProfile('claude-code', { root: profileRootOf(root) }).supported, true);
  clearLogs(setupRepo);
  const downgraded = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--claude-cli', fake.command, '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions',
  ], { env: { ...env, SETUP_FAKE_CLAUDE_TRUST: '0' }, timeout: 300000 });
  assert.equal(downgraded.status, 0, downgraded.stderr || downgraded.stdout);
  assert.match(downgraded.stdout, /safe-root-only/i);
  // The safe fallback reads as expected, never as a failure or as verified.
  assert.match(downgraded.stdout, /Profile outcome this run: safe-root-only: root-only, Toolkit's safe default\. Setup recorded no verified hook activation \(current Claude Code versions do not report one\), so the Toolkit hook keeps root-only\. This is expected; no action is needed\./);
  // Hook activation unverified this run: the native setting is named, the hook only conditionally.
  assert.match(downgraded.stdout, /Normal folders: one layer; the main session may start subagents; subagents never start another \(the Claude Code user setting CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1, read by Claude Code 2\.1\.217 or later\)\. The Toolkit hook also refuses nested launches once the plugin is installed and active\./);
  assert.doesNotMatch(downgraded.stdout, /verified this run/);
  const read = control.readProfile('claude-code', { root: profileRootOf(root) });
  assert.equal(read.supported, false);
  assert.equal(read.topology, control.TOPOLOGIES.ROOT_ONLY);
  assert.equal(sessions(fake).some((entry) => entry.args.includes('--print')), false);
});

test('kept broader-native survives flag and piped execution without probes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const fake = recordingClaude(root);
  const env = isolatedHomeEnv(root);
  control.configureProfile('claude-code', { topology: control.TOPOLOGIES.BROADER_NATIVE, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: profileRootOf(root) });
  const flagged = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--claude-cli', fake.command, '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions', '--yes-recommended',
  ], { env, timeout: 300000 });
  assert.equal(flagged.status, 0, flagged.stderr || flagged.stdout);
  assert.match(flagged.stdout, /Selected topology: broader-native/);
  assert.equal(control.readProfile('claude-code', { root: profileRootOf(root) }).topology, control.TOPOLOGIES.BROADER_NATIVE);
  clearLogs(setupRepo);
  const piped = run([
    '--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin,
    '--claude-cli', fake.command, '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions',
  ], { env, timeout: 300000, input: Array(16).fill('').join('\n') });
  assert.equal(piped.status, 0, piped.stderr || piped.stdout);
  assert.match(piped.stdout, /Selected topology: broader-native/);
  const preserved = control.readProfile('claude-code', { root: profileRootOf(root) });
  assert.equal(preserved.topology, control.TOPOLOGIES.BROADER_NATIVE);
  assert.equal(preserved.capacity_mode, control.CAPACITY_MODES.ROOT_ONLY);
  assert.equal(sessions(fake).length, 0);
});
