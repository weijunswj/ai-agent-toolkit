'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../scripts/setup-toolkit-core.cjs');
const control = require('../scripts/toolkit-agent-control.cjs');

function current(supported, profile = {}) {
  const proof = { schema: 3, source: 'claude-plugin-list', plugin_version: '2.7.19', cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64), process_launch_sha256: 'e'.repeat(64), agent_hook_sha256: 'd'.repeat(64) };
  return {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported' },
    nativePlugin: { status: 'fresh', strict_enforcement_verified: supported, trusted: supported, hook_active: supported, activation_proof: supported ? proof : null },
    agentCapability: { supported, launch_supported: supported, resource_counter_supported: supported, resource_counter_source: supported ? 'win32-operating-system' : 'unsupported-or-malformed' },
    agentProfile: { topology: 'root-only', capacity_mode: 'root-only', manual_maximum: 0, ...profile },
  };
}

test('one canonical question specification drives supported Claude choices without hidden menus', () => {
  const args = core.parseArgs(['--plan', '--host', 'claude-code']);
  const specs = core.setupQuestionSpecs(args, current(true));
  const topology = specs.find((row) => row.key === 'claudeTopology');
  const capacity = specs.find((row) => row.key === 'claudeAgentCapacity');
  assert.deepEqual(topology.choices.map((choice) => choice.value), ['toolkit-direct', 'root-only', 'broader-native', 'keep']);
  assert.deepEqual(capacity.choices.map((choice) => choice.value), ['automatic', 'root-only', 'keep', 'manual']);
  assert.equal(capacity.recommended, 'automatic');
  assert.equal(capacity.choices[0].label, 'Manage automatically based on available resources');
  const text = core.renderSetupQuestionBank(specs);
  assert.doesNotMatch(text, /\bAdvanced(?: options)?\b|More options/);
  assert.match(text, /How should Toolkit manage agent capacity\?[\s\S]*Current:[\s\S]*Recommended:[\s\S]*Choices:[\s\S]*Selected:/);
});

test('unsupported Claude capability omits decorative automatic, manual and Toolkit-direct choices', () => {
  const args = core.parseArgs(['--plan', '--host', 'claude-code']);
  const specs = core.setupQuestionSpecs(args, current(false));
  assert.deepEqual(specs.find((row) => row.key === 'claudeTopology').choices.map((choice) => choice.value), ['root-only', 'broader-native', 'keep']);
  assert.deepEqual(specs.find((row) => row.key === 'claudeAgentCapacity').choices.map((choice) => choice.value), ['root-only', 'keep']);
});

test('Codex setup exposes no Claude topology state and Claude setup exposes no Codex capacity row', () => {
  const codex = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), current(false));
  assert.equal(codex.some((row) => row.key.startsWith('claude')), false);
  const claude = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'claude-code']), current(true));
  assert.equal(claude.some((row) => row.key === 'codexHelperCapacity'), false);
});

test('flags accept only implemented topology and capacity outcomes', () => {
  const args = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'toolkit-direct', '--claude-agent-capacity', 'manual', '--claude-agent-maximum', '2']);
  assert.equal(args.setupChoices.claudeTopology, 'toolkit-direct');
  assert.equal(args.setupChoices.claudeAgentCapacity, 'manual');
  assert.equal(args.claudeManualMaximum, 2);
  assert.throws(() => core.parseArgs(['--claude-topology', 'decorative']), /Unsupported/);
  assert.throws(() => core.parseArgs(['--claude-agent-capacity', 'ignored']), /Unsupported/);
});

test('topology and capacity resolve to one canonical compatible outcome', () => {
  const directProfile = current(true, {
    topology: 'claude-toolkit-direct', capacity_mode: 'automatic', manual_maximum: 0, supported: true, status: 'configured',
  });

  const rootUnanswered = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'root-only']);
  core.setupQuestionSpecs(rootUnanswered, directProfile);
  assert.equal(rootUnanswered.setupChoices.claudeAgentCapacity, 'root-only');
  assert.deepEqual(core.resolveClaudeTopologyCapacity(rootUnanswered, directProfile), {
    topology: 'root-only', capacity_mode: 'root-only', manual_maximum: 0,
  });

  const rootKeep = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'root-only', '--claude-agent-capacity', 'keep']);
  assert.equal(core.resolveClaudeTopologyCapacity(rootKeep, directProfile).capacity_mode, 'root-only');

  const automatic = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'toolkit-direct', '--claude-agent-capacity', 'automatic']);
  assert.equal(core.resolveClaudeTopologyCapacity(automatic, directProfile).capacity_mode, 'automatic');

  const manual = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'toolkit-direct', '--claude-agent-capacity', 'manual', '--claude-agent-maximum', '2']);
  assert.deepEqual(core.resolveClaudeTopologyCapacity(manual, directProfile), {
    topology: 'claude-toolkit-direct', capacity_mode: 'manual', manual_maximum: 2,
  });

  const unsupported = core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'toolkit-direct']);
  assert.throws(() => core.resolveClaudeTopologyCapacity(unsupported, current(false)), /unavailable/);
});

test('recommended plan and rendered question surfaces show the same reconciled root-only result', () => {
  const args = core.parseArgs(['--plan', '--host', 'claude-code', '--yes-recommended', '--claude-topology', 'root-only']);
  const planned = core.plannedQuestionBank(args, current(true));
  const resolved = core.resolveClaudeTopologyCapacity(planned.args, current(true));
  assert.equal(resolved.topology, 'root-only');
  assert.equal(resolved.capacity_mode, 'root-only');
  const capacity = planned.specs.find((row) => row.key === 'claudeAgentCapacity');
  assert.equal(capacity.selected, 'root-only');
  assert.deepEqual(capacity.choices.map((choice) => choice.value), ['root-only', 'keep']);
  assert.match(core.renderSetupQuestionBank(planned.specs), /How should Toolkit manage agent capacity\?[\s\S]*Selected:\*\* Root agent only/);
  assert.match(core.renderSetupQuestionBankTerminal(planned.specs), /How should Toolkit manage agent capacity\?[\s\S]*Selected: Root agent only/);
});

test('broader-native remains distinct from root-only Toolkit capacity across flags and keep-current', () => {
  const state = current(true, { topology: 'broader-native', capacity_mode: 'root-only', supported: true, status: 'configured' });
  for (const argv of [
    ['--plan', '--host', 'claude-code', '--claude-topology', 'broader-native', '--claude-agent-capacity', 'root-only'],
    ['--plan', '--host', 'claude-code', '--claude-topology', 'keep', '--claude-agent-capacity', 'keep'],
    ['--plan', '--host', 'claude-code', '--claude-topology', 'keep', '--claude-agent-capacity', 'root-only'],
    ['--plan', '--host', 'claude-code', '--claude-topology=keep', '--claude-agent-capacity=root-only'],
  ]) {
    const resolved = core.resolveClaudeTopologyCapacity(core.parseArgs(argv), state);
    assert.deepEqual(resolved, { topology: 'broader-native', capacity_mode: 'root-only', manual_maximum: 0 });
  }

  const interactive = core.parseArgs(['--execute', '--host', 'claude-code']);
  interactive.setupChoices.claudeTopology = 'keep';
  interactive.setupChoices.claudeAgentCapacity = 'root-only';
  const specs = core.setupQuestionSpecs(interactive, state);
  assert.equal(specs.find((row) => row.key === 'claudeTopology').selected, 'broader-native');
  assert.equal(core.resolveClaudeTopologyCapacity(interactive, state).topology, 'broader-native');

  const planned = core.plannedQuestionBank(core.parseArgs([
    '--plan', '--json', '--host', 'claude-code', '--claude-topology', 'keep', '--claude-agent-capacity', 'root-only',
  ]), state);
  assert.equal(planned.args.setupChoices.claudeTopology, 'broader-native');
  assert.match(JSON.stringify(planned), /broader-native/);

  const unsupported = current(false, { topology: 'broader-native', capacity_mode: 'root-only', supported: false, status: 'unsupported-root-only' });
  assert.deepEqual(core.resolveClaudeTopologyCapacity(core.parseArgs([
    '--plan', '--host', 'claude-code', '--claude-topology', 'keep', '--claude-agent-capacity', 'root-only',
  ]), unsupported), { topology: 'root-only', capacity_mode: 'root-only', manual_maximum: 0 });
});

test('resource-counter loss removes direct automatic and resolves recommended setup to root-only', () => {
  const state = current(true);
  state.agentCapability.resource_counter_supported = false;
  state.agentCapability.supported = false;
  const args = core.parseArgs(['--plan', '--host', 'claude-code', '--yes-recommended']);
  const planned = core.plannedQuestionBank(args, state);
  assert.equal(planned.args.setupChoices.claudeTopology, 'root-only');
  assert.equal(planned.args.setupChoices.claudeAgentCapacity, 'root-only');
  assert.deepEqual(planned.specs.find((row) => row.key === 'claudeAgentCapacity').choices.map((choice) => choice.value), ['root-only', 'keep']);
});

test('resource-counter loss invalidates an existing automatic strict profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-resource-loss-'));
  const previous = process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT;
  process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT = root;
  try {
    const state = current(true, { topology: 'claude-toolkit-direct', capacity_mode: 'automatic', supported: true, status: 'configured' });
    state.agentCapability.resource_counter_supported = false;
    state.agentCapability.supported = false;
    const args = core.parseArgs(['--execute', '--host', 'claude-code', '--claude-topology', 'keep', '--claude-agent-capacity', 'keep']);
    const result = await core.applyHostDelegationControl(args, state, state.nativePlugin);
    assert.equal(result.status, 'capability-lost-root-only');
    assert.equal(control.readProfile('claude-code', { root }).supported, false);
  } finally {
    if (previous === undefined) delete process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT;
    else process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT = previous;
  }
});

test('explicit Windows cmd path with spaces works through bounded launch and version capability probes', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Claude probe path '));
  const fake = path.join(root, 'fake.cjs');
  const wrapper = path.join(root, 'claude.cmd');
  fs.writeFileSync(fake, [
    "if (process.argv.includes('--version')) console.log('2.1.198 fixture');",
    "else if (process.argv.includes('--print')) console.log('{}');",
    'else process.exit(1);',
    '',
  ].join('\n'));
  fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  const capability = core.inspectClaudeAgentCapability({ claudeCli: wrapper });
  assert.equal(capability.launch_supported, true);
  assert.match(capability.version, /2\.1\.198/);
});

function capabilityCli(root, behavior) {
  const target = path.join(root, `claude-${behavior}.cjs`);
  fs.writeFileSync(target, [
    "'use strict';",
    "const fs=require('node:fs');const args=process.argv.slice(2);",
    "if(args.includes('--version')){console.log('2.1.999 fixture');process.exit(0);}",
    "if(args.includes('--help')){console.log('--print only');process.exit(0);}",
    `if(args.includes('--print')){fs.writeFileSync(${JSON.stringify(path.join(root, `${behavior}.json`))},JSON.stringify({args,stdin:fs.readFileSync(0,'utf8')}));${behavior === 'supported' ? "console.log('{}');process.exit(0);" : behavior === 'unsupported' ? "console.error('unknown option --effort');process.exit(2);" : "console.error('authentication required: sign in');process.exit(3);"}}`,
    'process.exit(4);',
    '',
  ].join('\n'));
  return target;
}

test('bounded exact-argv probe succeeds even when help omits supported flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-capability-supported-'));
  const capability = core.inspectClaudeAgentCapability({ claudeCli: capabilityCli(root, 'supported') });
  assert.equal(capability.launch_supported, true);
  assert.equal(capability.launch_probe_status, 'supported');
  const probe = JSON.parse(fs.readFileSync(path.join(root, 'supported.json'), 'utf8'));
  assert.deepEqual(probe.args, ['--print', '--output-format', 'json', '--effort', 'medium', '--disallowedTools', 'Agent', 'Task', '--permission-mode', 'default', '--no-session-persistence']);
  assert.equal(probe.stdin, '');
});

for (const variable of ['CLAUDE_TOOLKIT_CLAUDE_CLI', 'CLAUDE_CLI_PATH']) {
  test(`setup capability uses the same ${variable} override as Claude plugin verification`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-capability-env-'));
    const command = capabilityCli(root, 'supported');
    const env = { PATH: '', [variable]: command };
    const capability = core.inspectClaudeAgentCapability({ env });
    assert.equal(capability.launch_supported, true);
    assert.equal(capability.claude_command, command);
  });
}

test('setup capability command precedence is explicit, AI env, helper env, legacy env, persisted, then bare', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-capability-precedence-'));
  const commands = Object.fromEntries(['explicit', 'ai', 'helper', 'legacy', 'persisted'].map((name) => [name, capabilityCli(root, `${name}-supported`)]));
  const env = {
    AI_AGENT_TOOLKIT_CLAUDE_CLI: commands.ai,
    CLAUDE_TOOLKIT_CLAUDE_CLI: commands.helper,
    CLAUDE_CLI_PATH: commands.legacy,
  };
  assert.equal(core.inspectClaudeAgentCapability({ claudeCli: commands.explicit, persistedClaudeCli: commands.persisted, env }).claude_command, commands.explicit);
  delete env.AI_AGENT_TOOLKIT_CLAUDE_CLI;
  assert.equal(core.inspectClaudeAgentCapability({ persistedClaudeCli: commands.persisted, env }).claude_command, commands.helper);
  delete env.CLAUDE_TOOLKIT_CLAUDE_CLI;
  assert.equal(core.inspectClaudeAgentCapability({ persistedClaudeCli: commands.persisted, env }).claude_command, commands.legacy);
  delete env.CLAUDE_CLI_PATH;
  assert.equal(core.inspectClaudeAgentCapability({ persistedClaudeCli: commands.persisted, env }).claude_command, commands.persisted);
});

test('capability probe distinguishes unsupported syntax from unrelated runtime failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-capability-failures-'));
  const unsupported = core.inspectClaudeAgentCapability({ claudeCli: capabilityCli(root, 'unsupported') });
  assert.equal(unsupported.launch_supported, false);
  assert.equal(unsupported.launch_probe_status, 'unsupported-syntax');
  const auth = core.inspectClaudeAgentCapability({ claudeCli: capabilityCli(root, 'auth') });
  assert.equal(auth.launch_supported, false);
  assert.equal(auth.launch_probe_status, 'indeterminate-runtime-failure');
  assert.doesNotMatch(auth.detector, /unsupported-syntax/);
});
