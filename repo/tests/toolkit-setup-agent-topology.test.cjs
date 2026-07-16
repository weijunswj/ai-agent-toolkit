'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../scripts/setup-toolkit-core.cjs');
const control = require('../scripts/toolkit-agent-control.cjs');

function current(supported, profile = {}) {
  const proof = { schema: 1, source: 'claude-plugin-list', plugin_version: '2.7.2', cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64) };
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
  assert.equal(capacity.choices[0].label, 'Manage automatically based on available resources - recommended');
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
  assert.match(core.renderSetupQuestionBank(planned.specs), /How should Toolkit manage agent capacity\?[\s\S]*Selected:\*\* Root agent only - recommended/);
  assert.match(core.renderSetupQuestionBankTerminal(planned.specs), /How should Toolkit manage agent capacity\?[\s\S]*Selected: Root agent only - recommended/);
});

test('broader-native remains distinct from root-only Toolkit capacity across flags and keep-current', () => {
  const state = current(true, { topology: 'broader-native', capacity_mode: 'root-only', supported: true, status: 'configured' });
  for (const argv of [
    ['--plan', '--host', 'claude-code', '--claude-topology', 'broader-native', '--claude-agent-capacity', 'root-only'],
    ['--plan', '--host', 'claude-code', '--claude-topology', 'keep', '--claude-agent-capacity', 'keep'],
  ]) {
    const resolved = core.resolveClaudeTopologyCapacity(core.parseArgs(argv), state);
    assert.deepEqual(resolved, { topology: 'broader-native', capacity_mode: 'root-only', manual_maximum: 0 });
  }
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

test('explicit Windows cmd path with spaces works through help and version capability probes', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Claude probe path '));
  const fake = path.join(root, 'fake.cjs');
  const wrapper = path.join(root, 'claude.cmd');
  fs.writeFileSync(fake, [
    "if (process.argv.includes('--help')) console.log('--print --output-format --effort --disallowedTools --permission-mode');",
    "else if (process.argv.includes('--version')) console.log('2.1.198 fixture');",
    'else process.exit(1);',
    '',
  ].join('\n'));
  fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  const capability = core.inspectClaudeAgentCapability({ claudeCli: wrapper });
  assert.equal(capability.launch_supported, true);
  assert.match(capability.version, /2\.1\.198/);
});
