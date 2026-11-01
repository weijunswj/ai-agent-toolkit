'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../scripts/setup-toolkit-core.cjs');
const control = require('../scripts/toolkit-agent-control.cjs');

const PROOF = { schema: 3, source: 'claude-plugin-list', plugin_version: control.CONTROL_VERSION, cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64), process_launch_sha256: 'e'.repeat(64), agent_hook_sha256: 'd'.repeat(64) };
function current(enforced, profile = {}) {
  return {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported' },
    nativePlugin: { status: 'fresh', strict_enforcement_verified: enforced, trusted: enforced, hook_active: enforced, activation_proof: enforced ? PROOF : null, version: control.CONTROL_VERSION },
    agentProfile: { topology: 'root-only', capacity_mode: 'root-only', manual_maximum: 0, ...profile },
  };
}
function withControlRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-topology-'));
  const previous = process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT;
  process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT = root;
  return Promise.resolve().then(() => callback(root)).finally(() => {
    if (previous === undefined) delete process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT;
    else process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT = previous;
  });
}

test('one canonical topology question offers only root-only, broader-native and keep, with root-only recommended', () => {
  for (const enforced of [true, false]) {
    const args = core.parseArgs(['--plan', '--host', 'claude-code']);
    const specs = core.setupQuestionSpecs(args, current(enforced));
    const topology = specs.find((row) => row.key === 'claudeTopology');
    assert.deepEqual(topology.choices.map((choice) => choice.value), ['keep', 'root-only', 'broader-native']);
    assert.equal(topology.recommended, 'root-only');
    assert.equal(specs.some((row) => /capacity/i.test(row.key) && row.key !== 'codexHelperCapacity'), false);
    const text = core.renderSetupQuestionBank(specs);
    assert.doesNotMatch(text, /Direct Toolkit-managed|toolkit-direct|Fable|Opus|manage agent capacity|manual maximum/i);
    assert.doesNotMatch(text, /\bAdvanced(?: options)?\b|More options/);
  }
});

test('Codex setup exposes no Claude topology state and Claude setup exposes no Codex capacity row', () => {
  const codex = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), current(false));
  assert.equal(codex.some((row) => row.key.startsWith('claude')), false);
  const claude = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'claude-code']), current(true));
  assert.equal(claude.some((row) => row.key === 'codexHelperCapacity'), false);
});

test('flags accept only current topologies; the retired direct choice and capacity flags are refused', () => {
  assert.equal(core.parseArgs(['--claude-topology', 'broader-native']).setupChoices.claudeTopology, 'broader-native');
  assert.equal(core.parseArgs(['--claude-topology=keep']).setupChoices.claudeTopology, 'keep');
  assert.throws(() => core.parseArgs(['--claude-topology', 'toolkit-direct']), /Unsupported --claude-topology choice: toolkit-direct/);
  assert.throws(() => core.parseArgs(['--claude-topology', 'decorative']), /Unsupported/);
  assert.throws(() => core.parseArgs(['--claude-agent-capacity', 'automatic']), /Unknown argument/);
  assert.throws(() => core.parseArgs(['--claude-agent-maximum', '2']), /Unknown argument/);
  assert.equal(Object.hasOwn(core.parseArgs([]).setupChoices, 'claudeAgentCapacity'), false);
});

test('keep preserves only a supported current topology; stale, unsupported and retired direct state resolve to root-only', () => {
  const broader = current(true, { topology: 'broader-native', supported: true, status: 'configured' });
  for (const argv of [['--claude-topology', 'broader-native'], ['--claude-topology', 'keep'], ['--claude-topology=keep']]) {
    const args = core.parseArgs(['--plan', '--host', 'claude-code', ...argv]);
    assert.equal(core.resolveClaudeTopology(args, broader), control.TOPOLOGIES.BROADER_NATIVE);
    assert.equal(args.setupChoices.claudeTopology, 'broader-native');
  }
  for (const [name, state] of [
    ['unsupported broader-native', current(false, { topology: 'broader-native', supported: false, status: 'unsupported-root-only' })],
    ['retired direct', current(true, { topology: 'claude-toolkit-direct', capacity_mode: 'automatic', supported: true, status: 'configured' })],
    ['unknown topology', current(true, { topology: 'future-topology', supported: true, status: 'configured' })],
  ]) {
    assert.equal(core.resolveClaudeTopology(core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'keep']), state), control.TOPOLOGIES.ROOT_ONLY, name);
  }
  assert.equal(core.resolveClaudeTopology(core.parseArgs(['--plan', '--host', 'claude-code', '--claude-topology', 'root-only']), broader), control.TOPOLOGIES.ROOT_ONLY);
});

test('recommended plan resolves to root-only and its rendered surfaces show no capacity or direct text', () => {
  const planned = core.plannedQuestionBank(core.parseArgs(['--plan', '--host', 'claude-code', '--yes-recommended']), current(true));
  assert.equal(planned.args.setupChoices.claudeTopology, 'root-only');
  for (const text of [core.renderSetupQuestionBank(planned.specs), core.renderSetupQuestionBankTerminal(planned.specs)]) {
    assert.doesNotMatch(text, /manage agent capacity|manual maximum|Direct Toolkit-managed/i);
  }
});

test('applying root-only writes the verified profile or the safe root-only policy; no capacity is ever stored', async () => {
  await withControlRoot(async (root) => {
    const args = core.parseArgs(['--execute', '--host', 'claude-code', '--claude-topology', 'root-only']);
    const state = current(true);
    const applied = await core.applyHostDelegationControl(args, state, { ...state.nativePlugin, cache_path: undefined });
    assert.equal(applied.status, 'configured');
    assert.equal(applied.topology, control.TOPOLOGIES.ROOT_ONLY);
    assert.equal(control.readProfile('claude-code', { root }).supported, true);
  });
  await withControlRoot(async (root) => {
    const state = current(false, { topology: 'claude-toolkit-direct', capacity_mode: 'automatic', supported: true, status: 'configured' });
    const args = core.parseArgs(['--execute', '--host', 'claude-code', '--claude-topology', 'keep']);
    const applied = await core.applyHostDelegationControl(args, state, state.nativePlugin);
    assert.equal(applied.status, 'safe-root-only');
    const read = control.readProfile('claude-code', { root });
    assert.equal(read.supported, false);
    assert.equal(read.topology, control.TOPOLOGIES.ROOT_ONLY);
  });
});
