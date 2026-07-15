'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/setup-toolkit-core.cjs');

function current(supported, profile = {}) {
  return {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported' },
    nativePlugin: { status: 'fresh' },
    agentCapability: { supported },
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
