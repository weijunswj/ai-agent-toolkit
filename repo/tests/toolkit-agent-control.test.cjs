'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const control = require('../scripts/toolkit-agent-control.cjs');
const hook = require('../scripts/toolkit-claude-agent-hook.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs');
// The wire value of the retired Toolkit direct topology, as an older Toolkit stored it.
const RETIRED_DIRECT = 'claude-toolkit-direct';

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-control-')); }
function activationProof(overrides = {}) {
  return { schema: 3, source: 'claude-plugin-list', plugin_version: control.CONTROL_VERSION,
    cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64), process_launch_sha256: 'e'.repeat(64), agent_hook_sha256: 'd'.repeat(64), ...overrides };
}
function rootOnly(overrides = {}) {
  return { topology: control.TOPOLOGIES.ROOT_ONLY, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY,
    enforcement_verified: true, activation_proof: activationProof(), claude_cli: 'claude', ...overrides };
}
function storedProfile(overrides = {}) {
  return { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.ROOT_ONLY,
    capacity_mode: control.CAPACITY_MODES.ROOT_ONLY, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
    queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
    controller_version: control.CONTROL_VERSION, enforcement_verified: true, enforcement: 'native-agent-hook-deny',
    activation_proof: activationProof(), claude_cli: 'claude', updated_at: new Date().toISOString(), ...overrides };
}
function writeProfile(work, contents) {
  const target = control.profilePath('claude-code', { root: work });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
  return target;
}

test('root-only and broader-native are the only configurable topologies; the retired direct topology is refused', () => {
  const work = root();
  const configured = control.configureProfile('claude-code', rootOnly(), { root: work });
  assert.equal(configured.topology, control.TOPOLOGIES.ROOT_ONLY);
  assert.equal(configured.enforcement, 'native-agent-hook-deny');
  assert.equal(control.readProfile('claude-code', { root: work }).supported, true);
  const broader = control.configureProfile('claude-code', { topology: control.TOPOLOGIES.BROADER_NATIVE, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: work });
  assert.equal(broader.enforcement, 'outside-toolkit-control');
  assert.equal(broader.activation_proof, null);

  const refused = root();
  assert.throws(() => control.configureProfile('claude-code', rootOnly({ topology: RETIRED_DIRECT, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }), { root: refused }), /Unsupported topology/);
  for (const capacity_mode of [control.CAPACITY_MODES.AUTO, control.CAPACITY_MODES.MANUAL]) {
    assert.throws(() => control.configureProfile('claude-code', rootOnly({ capacity_mode }), { root: refused }), /Unsupported capacity mode/);
  }
  assert.throws(() => control.configureProfile('claude-code', rootOnly({ topology: 'future-topology' }), { root: refused }), /Unsupported topology/);
  assert.throws(() => control.configureProfile('claude-code', rootOnly({ resourceState: {} }), { root: refused }), /Caller-provided resource evidence/);
  assert.equal(fs.existsSync(control.profilePath('claude-code', { root: refused })), false);
  assert.throws(() => control.configureProfile('codex', rootOnly(), { root: refused }), /not supported for this host/);
});

test('a stored direct profile, or any corrupted, partial, future or contradictory profile, reads as unsupported root-only', () => {
  const cases = [
    '{',
    JSON.stringify({ schema: control.SCHEMA, host: 'claude-code' }),
    storedProfile({ schema: control.SCHEMA + 1 }),
    storedProfile({ topology: 'future-topology' }),
    storedProfile({ topology: RETIRED_DIRECT, capacity_mode: control.CAPACITY_MODES.AUTO, enforcement: 'toolkit-launch-boundary' }),
    storedProfile({ capacity_mode: control.CAPACITY_MODES.AUTO }),
    storedProfile({ manual_maximum: 1 }),
    storedProfile({ worker_estimate_bytes: -1 }),
    storedProfile({ queue_limit: 5 }),
    storedProfile({ enforcement: 'toolkit-launch-boundary' }),
    storedProfile({ controller_version: '2.10.14' }),
    storedProfile({ claude_cli: './bin/claude' }),
    storedProfile({ activation_proof: activationProof({ schema: 2 }) }),
  ];
  for (const contents of cases) {
    const work = root();
    writeProfile(work, contents);
    const read = control.readProfile('claude-code', { root: work });
    assert.equal(read.topology, control.TOPOLOGIES.ROOT_ONLY, String(contents).slice(0, 80));
    assert.equal(read.supported, false);
    assert.notEqual(read.status, 'configured');
  }
  const current = root();
  writeProfile(current, storedProfile());
  assert.equal(control.readProfile('claude-code', { root: current }).status, 'configured');
});

test('root-only profiles require exact native activation proof bound to the installed plugin bytes', () => {
  const work = root();
  assert.throws(() => control.configureProfile('claude-code', rootOnly({ activation_proof: undefined }), { root: work }), /trust and activation/i);
  assert.throws(() => control.configureProfile('claude-code', rootOnly({ enforcement_verified: false }), { root: work }), /trust and activation/i);
  assert.throws(() => control.configureProfile('claude-code', rootOnly({ claude_cli: './bin/claude' }), { root: work }), /must be absolute/i);
  for (const bad of [
    null,
    activationProof({ schema: 2 }),
    activationProof({ plugin_version: 'old' }),
    activationProof({ cache_identity: 'bad' }),
    activationProof({ process_launch_sha256: '' }),
    activationProof({ process_launch_sha256: 'malformed' }),
  ]) {
    assert.equal(control.validActivationProof(bad), false);
  }
  assert.equal(control.validActivationProof(activationProof()), true);
  assert.equal(control.validActivationProof(activationProof(), { cachePath: work, pluginVersion: control.CONTROL_VERSION }), false);
});

test('invalidation records a root-only policy that reads as unsupported', () => {
  const work = root();
  control.configureProfile('claude-code', rootOnly(), { root: work });
  const invalidated = control.invalidateProfile('claude-code', 'proof lost', { root: work });
  assert.equal(invalidated.status, 'capability-lost-root-only');
  const stored = JSON.parse(fs.readFileSync(control.profilePath('claude-code', { root: work }), 'utf8'));
  assert.equal(stored.enforcement, 'unverified-root-only-policy');
  // Fixed schema-1 fields stay written so an installed earlier Toolkit reader still parses the file.
  assert.equal(stored.queue_limit, control.MAX_QUEUE);
  assert.equal(stored.reservation_limit, control.EMERGENCY_WORKER_CEILING);
  assert.equal(control.readProfile('claude-code', { root: work }).supported, false);
});

test('Codex and Claude profile state is isolated', () => {
  const work = root();
  control.configureProfile('claude-code', { topology: control.TOPOLOGIES.BROADER_NATIVE, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: work });
  assert.equal(control.readProfile('codex', { root: work }).topology, control.TOPOLOGIES.ROOT_ONLY);
  assert.equal(control.readProfile('codex', { root: work }).supported, false);
  assert.equal(control.readProfile('claude-code', { root: work }).topology, control.TOPOLOGIES.BROADER_NATIVE);
});

test('the Claude hook denies native Agent under root-only and retired direct profiles and requires a routing binding for broader-native', async () => {
  const rootOnlyRoot = root();
  control.configureProfile('claude-code', rootOnly(), { root: rootOnlyRoot });
  const denied = hook.decision({ tool_name: 'Agent' }, { root: rootOnlyRoot }).hookSpecificOutput;
  assert.equal(denied.permissionDecision, 'deny');
  assert.doesNotMatch(denied.permissionDecisionReason, /toolkit-agent-control|launch-spec|direct/i);

  const directRoot = root();
  writeProfile(directRoot, storedProfile({ topology: RETIRED_DIRECT, capacity_mode: control.CAPACITY_MODES.AUTO, enforcement: 'toolkit-launch-boundary' }));
  assert.equal(hook.decision({ tool_name: 'Agent' }, { root: directRoot }).hookSpecificOutput.permissionDecision, 'deny');

  const broaderRoot = root();
  control.configureProfile('claude-code', { topology: control.TOPOLOGIES.BROADER_NATIVE, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: broaderRoot });
  assert.equal((await hook.decision({ tool_name: 'Agent' }, { root: broaderRoot })).hookSpecificOutput.permissionDecision, 'deny');
});

test('agent control is a profile library: no command runs and nothing is written', () => {
  for (const args of [['launch', '--spec', 'spec.json'], ['checker', '--input', '-'], ['status'], ['core', 'run'], ['core', 'inspect'], ['supervise']]) {
    const work = root();
    const result = spawnSync(process.execPath, [SCRIPT, ...args, '--root', work], { encoding: 'utf8', windowsHide: true, input: '{}' });
    assert.equal(result.status, 0, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
    assert.deepEqual(fs.readdirSync(work), [], args.join(' '));
  }
});

test('no launch-capable, core or retired-history API remains exported', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'toolkit-agent-control-run093-history.cjs')), false);
  for (const name of ['main', 'createCoreCommandSession', 'CoreCommandSession', 'coreRuntimeCommand', 'coreDataCommand',
    'withRepositoryTestResourceInvocation', 'inspectResourceCapability', 'launch', 'checkerWorkflow', 'MODEL_CONTRACT', 'claudeInvocation', 'claudeInvocationArgs', 'runValidatedClaude', 'launchWithResourceEnvelope',
    'admissionDecisionWithResourceEnvelope', 'checkerRequirement', 'checkerLaunchSpec', 'checkerResultStatus', 'readCheckerWorkflowInput',
    'updateReservation', 'updateCheckerReview', 'effectiveClaudeCommand', 'verifyCurrentClaudeEnforcement', 'supervise']) {
    assert.equal(Object.hasOwn(control, name), false, name);
  }
  assert.equal(Object.hasOwn(control.TOPOLOGIES, 'CLAUDE_DIRECT'), false);
  for (const name of ['probeClaudeAgentCapability', 'inspectClaudeAgentCapability']) {
    assert.equal(Object.hasOwn(require('../scripts/setup-toolkit-core.cjs'), name), false, name);
  }
});

test('a Claude Agent hook call whose input cannot be read is refused in governed work and left alone elsewhere', () => {
  // The hook runs only for the Agent|Task matcher, so unreadable input is an agent launch Toolkit cannot check.
  const HOOK = path.join(__dirname, '..', 'scripts', 'toolkit-claude-agent-hook.cjs');
  const CHECKOUT = path.resolve(__dirname, '..', '..');
  const dir = root();
  const clean = { ...process.env, AI_AGENT_TOOLKIT_CONTROL_ROOT: dir };
  for (const key of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) delete clean[key];
  const call = (input, cwd, env = clean) => {
    const result = spawnSync(process.execPath, [HOOK], { input, cwd, encoding: 'utf8', windowsHide: true, env });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const READ_DENIAL = /^Toolkit could not read this agent launch, so it cannot check it; do the work in this session\.$/;
  try {
    for (const input of ['{ not json', 'null', '[]', '"Agent"', JSON.stringify({ hook_event_name: 'PreToolUse', tool_input: {} })]) {
      const governed = call(input, CHECKOUT).hookSpecificOutput;
      assert.equal(governed?.permissionDecision, 'deny', `governed: ${input}`);
      assert.match(governed.permissionDecisionReason, READ_DENIAL);
      assert.deepEqual(call(input, dir), {}, `normal folder: ${input}`);
      assert.equal(call(input, dir, { ...clean, TOOLKIT_GATE_ROLE: 'G1' }).hookSpecificOutput?.permissionDecision, 'deny', `launcher marker: ${input}`);
    }
    // A readable input names its own working folder; it decides governance.
    const named = call(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: CHECKOUT }), dir).hookSpecificOutput;
    assert.equal(named?.permissionDecision, 'deny');
    assert.deepEqual(call(JSON.stringify({ tool_name: 'Read', cwd: CHECKOUT }), CHECKOUT), {}, 'other tools are untouched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Claude hook whose decision modules cannot load still denies Agent and Task as a handled decision', () => {
  // Claude Code treats a hook process error (crash, non-zero exit other than 2) as non-blocking,
  // so a missing or broken module must surface as the hook's own deny, not as a crash.
  // In governed work (here the Toolkit checkout) a missing decision module denies; without the shared
  // predicate only a launcher marker gates, so ordinary work is never blocked by a broken install.
  const HOOK = path.join(__dirname, '..', 'scripts', 'toolkit-claude-agent-hook.cjs');
  const ONE_LAYER = /^Toolkit: a subagent can't start another agent \(one layer only\)\. Do the work in this subagent, or hand it back to the main session\.$/;
  const CHECKOUT = path.resolve(__dirname, '..', '..');
  const dir = root();
  const clean = { ...process.env, AI_AGENT_TOOLKIT_CONTROL_ROOT: dir };
  for (const key of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) delete clean[key];
  const call = (file, input, env = clean) => spawnSync(process.execPath, [file], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, env });
  try {
    const copy = path.join(dir, 'toolkit-claude-agent-hook.cjs'); fs.copyFileSync(HOOK, copy);
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'toolkit-governed-repo.cjs'), path.join(dir, 'toolkit-governed-repo.cjs'));
    for (const tool of ['Agent', 'Task']) {
      const broken = call(copy, { tool_name: tool, hook_event_name: 'PreToolUse', cwd: CHECKOUT, tool_input: { subagent_type: 'toolkit-g1-helper' } });
      assert.equal(broken.status, 0, broken.stderr);
      const output = JSON.parse(broken.stdout).hookSpecificOutput;
      assert.equal(output.permissionDecision, 'deny', tool);
      assert.match(output.permissionDecisionReason, /could not check this helper launch safely/);
    }
    // Same boundary, intact modules: the named-helper policy decides.
    const intact = call(HOOK, { tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd: CHECKOUT, tool_input: {} });
    assert.equal(intact.status, 0, intact.stderr);
    assert.match(JSON.parse(intact.stdout).hookSpecificOutput.permissionDecisionReason, /allows only the toolkit-g0-helper and toolkit-g1-helper agents/);
    const outside = call(copy, { tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd: dir, tool_input: {} });
    assert.deepEqual(JSON.parse(outside.stdout), {}, 'ungoverned work is untouched by a broken install');
    const nested = JSON.parse(call(copy, { tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd: dir, agent_id: 'a1', agent_type: 'Explore', tool_input: {} }).stdout);
    assert.equal(nested.hookSpecificOutput.permissionDecision, 'deny', 'a subagent launch stays refused when modules are missing');
    assert.match(nested.hookSpecificOutput.permissionDecisionReason, ONE_LAYER);
    // Intact modules outside governed work: a subagent launch gets the plain one-layer reason.
    const nestedIntact = call(HOOK, { tool_name: 'Task', hook_event_name: 'PreToolUse', cwd: dir, agent_id: 'a1', agent_type: 'Explore', tool_input: {} });
    assert.equal(nestedIntact.status, 0, nestedIntact.stderr);
    assert.match(JSON.parse(nestedIntact.stdout).hookSpecificOutput.permissionDecisionReason, ONE_LAYER);
    fs.rmSync(path.join(dir, 'toolkit-governed-repo.cjs'));
    assert.deepEqual(JSON.parse(call(copy, { tool_name: 'Agent', cwd: CHECKOUT, tool_input: {} }).stdout), {}, 'no predicate and no launcher marker: no gate');
    // The module-failure path gives a subagent caller the same plain one-layer reason.
    const failedNested = JSON.parse(call(copy, { tool_name: 'Agent', cwd: dir, agent_id: 'a1', tool_input: {} }).stdout).hookSpecificOutput;
    assert.equal(failedNested.permissionDecision, 'deny');
    assert.match(failedNested.permissionDecisionReason, ONE_LAYER);
    const marked = JSON.parse(call(copy, { tool_name: 'Agent', cwd: CHECKOUT, tool_input: {} }, { ...clean, TOOLKIT_GATE_ROLE: 'G1' }).stdout);
    assert.equal(marked.hookSpecificOutput.permissionDecision, 'deny', 'a launcher marker gates even without the predicate');
    const other = call(copy, { tool_name: 'Read' });
    assert.deepEqual(JSON.parse(other.stdout), {}, 'other tools are untouched even when modules are missing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
