'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeSubagentDepthSetting, SETTING, STATES } = require('../scripts/toolkit-claude-subagent-depth.cjs');
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

test('setup asks the one-layer question for Claude Code only, recommended on, and writes only when answered', t => {
  const claudeState = { ...baseState(), agentProfile: { supported: true, topology: 'root-only' }, claudeSubagentDepth: { state: STATES.DEFAULT } };
  const claude = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'claude-code']), claudeState);
  const depth = claude.find(row => row.key === 'claudeSubagentDepth');
  assert.ok(depth);
  assert.equal(depth.presentation.question_ref, '2.2');
  assert.equal(depth.recommended, 'enable');
  assert.deepEqual(depth.choices.map(choice => choice.value), ['enable', 'disable', 'keep']);
  assert.match(depth.whatThisControls, /the main session may start subagents; subagents never start another/);
  assert.equal(core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), baseState()).some(row => row.key === 'claudeSubagentDepth'), false);
  assert.equal(core.parseArgs(['--claude-one-layer-subagents', 'disable']).setupChoices.claudeSubagentDepth, 'disable');
  assert.equal(core.parseArgs(['--claude-one-layer-subagents=keep']).setupChoices.claudeSubagentDepth, 'keep');
  assert.throws(() => core.parseArgs(['--claude-one-layer-subagents', 'on']), /Unsupported --claude-one-layer-subagents choice: on/);

  const planned = core.plannedQuestionBank(core.parseArgs(['--plan', '--host', 'claude-code', '--yes-recommended']), claudeState);
  assert.equal(planned.args.setupChoices.claudeSubagentDepth, 'enable');
  const plan = core.setupPlan({ host: 'claude-code', setupChoices: planned.args.setupChoices });
  assert.equal(plan.preferences.claude_one_layer_subagents, 'enable');
  assert.ok(plan.steps.find(step => step.id === 'host_delegation_control').commands.some(command => /CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"/.test(command)));

  // Unanswered or keep: nothing is written.
  const f = fixture(t);
  const unanswered = core.applyClaudeSubagentDepth(core.parseArgs(['--execute', '--host', 'claude-code']), f.setting());
  assert.equal(unanswered.changed, false);
  assert.equal(fs.existsSync(f.settingsPath), false);
  const answered = core.applyClaudeSubagentDepth(core.parseArgs(['--execute', '--host', 'claude-code', '--claude-one-layer-subagents', 'enable']), f.setting());
  assert.equal(answered.changed, true);
  assert.deepEqual(f.read(), { env: { [SETTING]: '1' } });
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
