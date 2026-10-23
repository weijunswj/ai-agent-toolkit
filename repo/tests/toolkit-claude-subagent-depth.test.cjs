'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeSubagentDepthSetting, SETTING, STATES, LOCK_STALE_MS } = require('../scripts/toolkit-claude-subagent-depth.cjs');
const { canonicalPath } = require('../scripts/toolkit-canonical-path.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');

// Every case uses a temporary Claude config directory and control root, never the real ones.
function fixture(t, settingsText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-claude-depth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configDir = path.join(dir, 'claude');
  const controlRoot = path.join(dir, 'control');
  const settingsPath = path.join(configDir, 'settings.json');
  if (settingsText !== undefined) { fs.mkdirSync(configDir, { recursive: true }); fs.writeFileSync(settingsPath, settingsText); }
  const environment = { CLAUDE_CONFIG_DIR: configDir, AI_AGENT_TOOLKIT_CONTROL_ROOT: controlRoot };
  const setting = () => new ClaudeSubagentDepthSetting({ environment });
  const read = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const recordPath = path.join(controlRoot, 'claude-subagent-depth.json');
  return { configDir, controlRoot, settingsPath, recordPath, environment, setting, read };
}

test('apply holds a lock beside the ownership record: a live lock refuses with nothing changed, a stale one is taken over', t => {
  const f = fixture(t);
  const lock = `${f.recordPath}.lock`;
  fs.mkdirSync(f.controlRoot, { recursive: true });
  fs.writeFileSync(lock, '1\n');
  const waiting = new ClaudeSubagentDepthSetting({ environment: f.environment, lockWaitMs: 0 });
  assert.throws(() => waiting.apply('enable'), /Another Toolkit setup run is changing the Claude Code depth setting/);
  assert.equal(fs.existsSync(f.settingsPath), false, 'nothing written while another run holds the lock');
  assert.equal(fs.existsSync(f.recordPath), false);
  const old = new Date(Date.now() - LOCK_STALE_MS - 1000);
  fs.utimesSync(lock, old, old);
  assert.equal(waiting.apply('enable').changed, true, 'a lock left by a run that died is taken over');
  assert.deepEqual(f.read(), { env: { [SETTING]: '1' } });
  assert.equal(fs.existsSync(lock), false, 'the lock is released after apply');
});

test('turning on with no settings file writes only the one-layer key; turning off removes it and the file Toolkit created', t => {
  const f = fixture(t);
  assert.equal(f.setting().inspect().state, STATES.DEFAULT);
  const on = f.setting().apply('enable');
  assert.equal(on.changed, true);
  assert.deepEqual(f.read(), { env: { [SETTING]: '1' } });
  assert.equal(f.setting().inspect().state, STATES.TOOLKIT);
  assert.equal(f.setting().apply('enable').changed, false, 'already Toolkit-owned');
  const off = f.setting().apply('disable');
  assert.equal(off.changed, true);
  assert.equal(fs.existsSync(f.settingsPath), false, 'no leftover empty settings file');
  assert.equal(fs.existsSync(f.recordPath), false, 'no leftover ownership record');
});

test('turning on and off keeps every other setting and env key exactly', t => {
  const original = { model: 'opus', permissions: { allow: ['Read'] }, env: { OTHER: 'x' } };
  const f = fixture(t, `${JSON.stringify(original, null, 2)}\n`);
  f.setting().apply('enable');
  assert.deepEqual(f.read(), { ...original, env: { OTHER: 'x', [SETTING]: '1' } });
  f.setting().apply('disable');
  assert.deepEqual(f.read(), original);
  // An env object the owner already had stays, even when Toolkit's key was its only entry.
  const g = fixture(t, `${JSON.stringify({ env: {} }, null, 2)}\n`);
  g.setting().apply('enable');
  g.setting().apply('disable');
  assert.deepEqual(g.read(), { env: {} });
});

test('a value the owner set by hand is never changed or removed', t => {
  for (const value of ['1', '2']) {
    const text = `${JSON.stringify({ env: { [SETTING]: value } }, null, 2)}\n`;
    const f = fixture(t, text);
    assert.equal(f.setting().inspect().state, STATES.OWNER);
    for (const choice of ['enable', 'disable', 'keep']) {
      const result = f.setting().apply(choice);
      assert.equal(result.changed, false, `${value} ${choice}`);
      assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), text);
    }
    assert.equal(fs.existsSync(f.recordPath), false);
  }
});

test('a Toolkit value the owner later changed becomes the owner value and survives turning off', t => {
  const f = fixture(t);
  f.setting().apply('enable');
  fs.writeFileSync(f.settingsPath, `${JSON.stringify({ env: { [SETTING]: '3' } })}\n`);
  assert.equal(f.setting().inspect().state, STATES.OWNER);
  const off = f.setting().apply('disable');
  assert.equal(off.status, 'owner-value-kept');
  assert.deepEqual(f.read(), { env: { [SETTING]: '3' } });
  assert.equal(fs.existsSync(f.recordPath), false, 'stale ownership record is dropped');
});

test('unreadable settings are held unchanged, and keep never writes', t => {
  for (const text of ['{ not json', '[]', '{"env": "x"}']) {
    const f = fixture(t, text);
    for (const choice of ['enable', 'disable']) {
      const result = f.setting().apply(choice);
      assert.equal(result.status, 'held', `${text} ${choice}`);
      assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), text);
    }
  }
  const f = fixture(t);
  assert.equal(f.setting().apply('keep').changed, false);
  assert.equal(fs.existsSync(f.settingsPath), false);
  assert.throws(() => f.setting().apply('maybe'), /Unsupported Claude subagent depth choice/);
});

function recordOf(f) { return JSON.parse(fs.readFileSync(f.recordPath, 'utf8')); }

test('a control root that cannot hold the ownership record stops turning on before the settings change', t => {
  for (const text of [undefined, `${JSON.stringify({ model: 'opus' }, null, 2)}\n`]) {
    const f = fixture(t, text);
    fs.writeFileSync(f.controlRoot, 'the control root is a file, so no ownership record can be written');
    assert.throws(() => f.setting().apply('enable'));
    assert.equal(f.setting().inspect().state, STATES.DEFAULT, 'the owner setting is not written');
    assert.equal(fs.existsSync(f.settingsPath) ? fs.readFileSync(f.settingsPath, 'utf8') : undefined, text);
  }
});

test('two config folders sharing one control root keep separate entries; turning one off leaves the other', t => {
  const f = fixture(t);
  const otherDir = path.join(path.dirname(f.configDir), 'claude-second');
  const other = new ClaudeSubagentDepthSetting({ environment: { CLAUDE_CONFIG_DIR: otherDir, AI_AGENT_TOOLKIT_CONTROL_ROOT: f.controlRoot } });
  f.setting().apply('enable');
  other.apply('enable');
  assert.equal(f.setting().inspect().state, STATES.TOOLKIT);
  assert.equal(other.inspect().state, STATES.TOOLKIT);
  assert.equal(Object.keys(recordOf(f).entries).length, 2);
  assert.equal(f.setting().apply('disable').changed, true);
  assert.equal(fs.existsSync(f.settingsPath), false, 'the first folder held only Toolkit\'s key');
  assert.equal(other.inspect().state, STATES.TOOLKIT, 'the second folder keeps its entry');
  assert.deepEqual(Object.keys(recordOf(f).entries), [canonicalPath(path.join(otherDir, 'settings.json'))]);
  assert.equal(other.apply('disable').changed, true);
  assert.equal(fs.existsSync(path.join(otherDir, 'settings.json')), false);
  assert.equal(fs.existsSync(f.recordPath), false, 'no entries left, so the record file is removed');
});

test('the same config folder spelled in another case on Windows keeps its ownership', t => {
  if (process.platform !== 'win32') { t.skip('Windows paths are case-folded'); return; }
  const f = fixture(t);
  f.setting().apply('enable');
  const upper = new ClaudeSubagentDepthSetting({ environment: { CLAUDE_CONFIG_DIR: f.configDir.toUpperCase(), AI_AGENT_TOOLKIT_CONTROL_ROOT: f.controlRoot } });
  assert.equal(upper.inspect().state, STATES.TOOLKIT);
  assert.equal(upper.apply('disable').changed, true);
  assert.equal(fs.existsSync(f.settingsPath), false);
  assert.equal(fs.existsSync(f.recordPath), false);
});

test('a manual removal followed by keep drops the stale entry, so an identical later value stays the owner\'s', t => {
  const f = fixture(t);
  f.setting().apply('enable');
  fs.writeFileSync(f.settingsPath, `${JSON.stringify({ env: {} }, null, 2)}\n`);
  assert.equal(f.setting().apply('keep').changed, false);
  assert.equal(fs.existsSync(f.recordPath), false, 'stale entry dropped');
  const manual = `${JSON.stringify({ env: { [SETTING]: '1' } }, null, 2)}\n`;
  fs.writeFileSync(f.settingsPath, manual);
  assert.equal(f.setting().inspect().state, STATES.OWNER);
  assert.equal(f.setting().apply('disable').status, 'owner-value-kept');
  assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), manual);
});

test('a record in a superseded schema is not read, so the value it named reads as an owner value and is never removed', t => {
  const text = `${JSON.stringify({ env: { [SETTING]: '1' } }, null, 2)}
`;
  const f = fixture(t, text);
  fs.mkdirSync(f.controlRoot, { recursive: true });
  const old = `${JSON.stringify({ schema: 'ai-agent-toolkit.claude-subagent-depth.v1', settings_path: f.settingsPath, value: '1', created_env: true, created_file: true })}
`;
  fs.writeFileSync(f.recordPath, old);
  assert.equal(f.setting().inspect().state, STATES.OWNER);
  assert.equal(f.setting().apply('disable').status, 'owner-value-kept');
  assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), text);
});

const ONE_LAYER_LABEL = 'Toolkit repos: main session + Toolkit G0/G1 helpers only. Elsewhere: one layer of subagents.';

test('the topology question carries the one-layer depth: root-only sets it, broader-native removes only Toolkit\'s value, keep leaves it', t => {
  const claudeState = { ...baseState(), agentProfile: { supported: true, topology: 'root-only' }, claudeSubagentDepth: { state: STATES.DEFAULT } };
  const claude = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'claude-code']), claudeState);
  assert.equal(claude.some(row => /subagent ?depth|one-layer/i.test(row.key) || row.id === 'claude-one-layer-subagents'), false, 'no separate depth question');
  const topology = claude.find(row => row.key === 'claudeTopology');
  assert.equal(topology.presentation.question_ref, '2.1');
  assert.deepEqual(topology.choices.map(choice => choice.value), ['root-only', 'broader-native', 'keep']);
  assert.equal(topology.recommended, 'root-only');
  assert.equal(topology.choices[0].label, ONE_LAYER_LABEL);
  assert.equal(topology.recommended_outcome, ONE_LAYER_LABEL);
  assert.match(topology.whatThisControls, /the main session may start subagents; subagents never start another/);
  assert.match(topology.current, /CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH is not set in your Claude Code user settings, so Claude Code's own default applies\. The Toolkit hook refuses nested launches in normal folders once/);
  // The default depth depends on the Claude Code version and a server-side value, so no layer count is claimed.
  assert.doesNotMatch(topology.current, /three layers/);
  assert.match(topology.whatThisControls, /read by Claude Code 2\.1\.217 or later; project, local or managed settings can override it in a folder/);
  assert.match(topology.recommendation_reason, /the Claude Code user setting CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 holds Claude Code 2\.1\.217 or later to one layer/);
  assert.throws(() => core.parseArgs(['--claude-one-layer-subagents', 'enable']), /Unknown argument/);

  // The plan follows the answer: recommended root-only sets the key.
  const planned = core.plannedQuestionBank(core.parseArgs(['--plan', '--host', 'claude-code', '--yes-recommended']), claudeState);
  const plan = core.setupPlan(planned.args);
  assert.equal(plan.preferences.claude_subagent_depth, 'enable');
  assert.ok(plan.steps.find(step => step.id === 'host_delegation_control').commands.some(command => /CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"/.test(command)));

  const answered = (topologyAnswer, profile = { supported: true, topology: 'root-only' }) => {
    const args = core.parseArgs(['--execute', '--host', 'claude-code', ...(topologyAnswer ? ['--claude-topology', topologyAnswer] : [])]);
    core.resolveClaudeTopology(args, { agentProfile: profile });
    // A second resolution (as applyHostDelegationControl does) must not change the recorded effect.
    core.resolveClaudeTopology(args, { agentProfile: profile });
    return args;
  };
  const f = fixture(t);
  assert.equal(core.applyClaudeSubagentDepth(answered('root-only'), f.setting()).changed, true);
  assert.deepEqual(f.read(), { env: { [SETTING]: '1' } });
  // keep, including a keep that resolves to root-only for an unsupported profile, changes nothing.
  assert.equal(core.applyClaudeSubagentDepth(answered('keep', { supported: false, topology: 'root-only' }), f.setting()).changed, false);
  assert.equal(core.applyClaudeSubagentDepth(answered(''), f.setting()).changed, false);
  assert.deepEqual(f.read(), { env: { [SETTING]: '1' } });
  // broader-native removes Toolkit's value.
  assert.equal(core.applyClaudeSubagentDepth(answered('broader-native'), f.setting()).changed, true);
  assert.equal(fs.existsSync(f.settingsPath), false);
  // broader-native keeps an owner value.
  const g = fixture(t, `${JSON.stringify({ env: { [SETTING]: '2' } })}\n`);
  assert.equal(core.applyClaudeSubagentDepth(answered('broader-native'), g.setting()).status, 'owner-value-kept');
  assert.deepEqual(g.read(), { env: { [SETTING]: '2' } });
});


function baseState() {
  return {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported' },
    nativePlugin: { status: 'fresh' },
  };
}
