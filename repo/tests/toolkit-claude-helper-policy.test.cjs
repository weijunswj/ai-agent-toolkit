'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const hook = require('../scripts/toolkit-claude-agent-hook.cjs');
const control = require('../scripts/toolkit-agent-control.cjs');
const { governedRepo } = require('../scripts/toolkit-governed-repo.cjs');
const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');

const TEMPLATE = fs.readFileSync(path.join(ROOT, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'), 'utf8');

function scratch(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-helper-policy-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A governed repository, a Claude config directory with the rendered helpers, and an empty control root.
function fixture(t, { install = true } = {}) {
  const dir = scratch(t);
  const repo = path.join(dir, 'repo'), plain = path.join(dir, 'plain'), configDir = path.join(dir, 'claude'), controlRoot = path.join(dir, 'control');
  for (const r of [repo, plain]) fs.mkdirSync(path.join(r, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), TEMPLATE);
  fs.writeFileSync(path.join(plain, 'AGENTS.md'), '# Project rules\n');
  fs.mkdirSync(path.join(configDir, 'agents'), { recursive: true });
  const renderer = ClaudeHelperAgentRenderer.fromRepository('owner-claude', ROOT);
  if (install) for (const role of ['G0', 'G1']) { const { file, text } = renderer.render(role); fs.writeFileSync(path.join(configDir, 'agents', file), text); }
  const environment = { CLAUDE_CONFIG_DIR: configDir };
  const decide = (input, env = environment) => hook.decision({ tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd: repo, ...input },
    { root: controlRoot, environment: env, helper_policy: { toolkitRoot: ROOT } });
  return { dir, repo, plain, configDir, controlRoot, environment, decide };
}

const denied = output => output?.hookSpecificOutput?.permissionDecision === 'deny';
const reason = output => output.hookSpecificOutput.permissionDecisionReason;

test('the governed-repo predicate walks to the first .git and needs a managed block, the Toolkit checkout or a launcher marker', t => {
  const dir = scratch(t);
  assert.equal(governedRepo(dir, {}).governed, false, 'no git root');
  assert.equal(governedRepo(dir, { TOOLKIT_GATE_ROLE: 'G1' }).reason, 'launcher-marker');
  const managed = path.join(dir, 'managed');
  fs.mkdirSync(path.join(managed, '.git'), { recursive: true });
  fs.writeFileSync(path.join(managed, 'AGENTS.md'), TEMPLATE);
  fs.mkdirSync(path.join(managed, 'src', 'deep'), { recursive: true });
  assert.equal(governedRepo(path.join(managed, 'src', 'deep'), {}).reason, 'managed-agents-block');
  // A nested repository (here a worktree-style `.git` file) stops the walk before the managed parent.
  const nested = path.join(managed, 'vendor', 'lib');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, '.git'), 'gitdir: ../../.git/worktrees/lib\n');
  const inner = governedRepo(nested, {});
  assert.equal(inner.governed, false); assert.equal(inner.root, nested);
  // Literal marker examples are not a managed block.
  fs.writeFileSync(path.join(nested, 'AGENTS.md'), 'Example: `<!-- AI-AGENT-TOOLKIT:x:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->`\n');
  assert.equal(governedRepo(nested, {}).governed, false);
  assert.equal(governedRepo(ROOT, {}).governed, true, 'the Toolkit checkout');
});

test('outside governed work every main-session agent launch is left to Claude Code', t => {
  const f = fixture(t);
  for (const cwd of [f.plain, f.dir]) {
    for (const tool_input of [{ subagent_type: 'general-purpose' }, {}, { subagent_type: 'Explore', model: 'opus' }]) {
      assert.deepEqual(f.decide({ cwd, tool_input }), {}, `${cwd} ${JSON.stringify(tool_input)}`);
      assert.deepEqual(f.decide({ cwd, tool_name: 'Task', tool_input }), {}, `${cwd} Task ${JSON.stringify(tool_input)}`);
    }
    // A main session started with --agent carries agent_type but no agent_id; it is still the main session.
    assert.deepEqual(f.decide({ cwd, agent_type: 'security-reviewer', tool_input: { subagent_type: 'Explore' } }), {}, `${cwd} --agent main session`);
  }
  assert.deepEqual(hook.decision({ tool_name: 'Read', cwd: f.repo }, { root: f.controlRoot, environment: f.environment }), {});
});

const ONE_LAYER_REASON = "Toolkit: a subagent can't start another agent (one layer only). Do the work in this subagent, or hand it back to the main session.";

test('outside governed work a subagent cannot launch another agent, with a plain one-layer reason', t => {
  const f = fixture(t);
  for (const cwd of [f.plain, f.dir]) {
    for (const tool_name of ['Agent', 'Task']) {
      for (const caller of [{ agent_id: 'a1', agent_type: 'Explore' }, { agent_id: 'a2' }]) {
        const output = f.decide({ cwd, tool_name, ...caller, tool_input: { subagent_type: 'general-purpose', prompt: 'y' } });
        assert.ok(denied(output), `${cwd} ${tool_name} ${JSON.stringify(caller)}`);
        assert.equal(reason(output), ONE_LAYER_REASON);
        assert.doesNotMatch(reason(output), /G0|G1|helper/);
      }
    }
    // Non-agent tools inside a subagent are untouched.
    assert.deepEqual(f.decide({ cwd, tool_name: 'Read', agent_id: 'a1', agent_type: 'Explore', tool_input: {} }), {});
  }
});

test('in governed work a main session started with --agent is the lead; only an agent_id caller is a helper', t => {
  const f = fixture(t);
  // agent_type without agent_id: a --agent main session, judged like any lead launch.
  assert.deepEqual(f.decide({ agent_type: 'security-reviewer', tool_input: { subagent_type: 'toolkit-g0-helper', prompt: 'y' } }), {});
  assert.match(reason(f.decide({ agent_type: 'security-reviewer', tool_input: { subagent_type: 'general-purpose' } })),
    /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: general-purpose\)/);
  for (const caller of [{ agent_id: 'a1', agent_type: 'toolkit-g1-helper' }, { agent_id: 'a2' }]) {
    const output = f.decide({ ...caller, tool_input: { subagent_type: 'toolkit-g0-helper' } });
    assert.equal(reason(output), 'Toolkit: a helper cannot launch another agent. Only the G0 or G1 lead launches helpers.', JSON.stringify(caller));
  }
});

test('in governed work the matching Toolkit helpers are allowed and other launches are refused with a plain reason', t => {
  const f = fixture(t);
  for (const name of ['toolkit-g0-helper', 'toolkit-g1-helper']) {
    assert.deepEqual(f.decide({ tool_input: { subagent_type: name, description: 'x', prompt: 'y' } }), {}, name);
    assert.deepEqual(f.decide({ tool_name: 'Task', tool_input: { subagent_type: name, prompt: 'y' } }), {}, `${name} via Task`);
  }
  const cases = [
    [{ tool_input: { subagent_type: 'general-purpose' } }, /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: general-purpose\)/],
    [{ tool_input: { prompt: 'y' } }, /requested: the default agent/],
    // Inherited object keys are not helper names.
    [{ tool_input: { subagent_type: 'constructor' } }, /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: constructor\)/],
    [{ tool_input: { subagent_type: '__proto__' } }, /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: __proto__\)/],
    [{ tool_input: { subagent_type: 'toString' } }, /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: toString\)/],
    [{ agent_id: 'a1', agent_type: 'toolkit-g1-helper', tool_input: { subagent_type: 'toolkit-g0-helper' } }, /a helper cannot launch another agent/],
    [{ tool_input: { subagent_type: 'toolkit-g0-helper', model: 'opus' } }, /cannot override model/],
    [{ tool_input: { subagent_type: 'toolkit-g0-helper', effort: 'low' } }, /cannot override effort/],
    [{ tool_input: { subagent_type: 'toolkit-g1-helper', resume: 'agent-1' } }, /cannot resume or fork/],
    [{ tool_input: { subagent_type: 'toolkit-g1-helper', fork_context: true } }, /cannot resume or fork/],
  ];
  for (const [input, expected] of cases) {
    const output = f.decide(input);
    assert.ok(denied(output), JSON.stringify(input));
    assert.match(reason(output), expected);
    assert.match(reason(output), /^Toolkit: /);
  }
  const g2 = f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } }, { ...f.environment, TOOLKIT_GATE_ROLE: 'G2' });
  assert.match(reason(g2), /G2 review sessions launch no helpers/);
  const forced = f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } }, { ...f.environment, CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-5-5' });
  assert.match(reason(forced), /CLAUDE_CODE_SUBAGENT_MODEL/);
});

test('a helper definition that does not byte-match the selected-stack rendering is refused, including a project override', t => {
  const f = fixture(t);
  const file = path.join(f.configDir, 'agents', 'toolkit-g0-helper.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('effort: xhigh', 'effort: low'));
  const drifted = f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } });
  assert.match(reason(drifted), /does not match the one rendered from the selected stack/);
  assert.match(reason(drifted), /toolkit-claude-helper-agents\.cjs --stack owner-claude --write/);
  fs.writeFileSync(file, original.replace(/explicitly selected stack `owner-claude`/, 'explicitly selected stack `owner-unknown`'));
  assert.ok(denied(f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } })), 'unknown stack');
  fs.writeFileSync(file, original);
  assert.deepEqual(f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } }), {});
  // Project agents outrank user agents, so a differing project copy is what Claude Code would load.
  fs.mkdirSync(path.join(f.repo, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, '.claude', 'agents', 'toolkit-g0-helper.md'), original.replace('maxTurns: 12', 'maxTurns: 99'));
  assert.match(reason(f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } })), /\.claude[\\/]agents[\\/]toolkit-g0-helper\.md\) does not match/);
  const missing = fixture(t, { install: false });
  assert.match(reason(missing.decide({ tool_input: { subagent_type: 'toolkit-g1-helper' } })), /no toolkit-g1-helper definition is installed/);
});

test('the named-helpers topology is a supported profile that older Toolkit hooks read as deny-all', t => {
  const f = fixture(t);
  const profile = control.configureProfile('claude-code', { topology: control.TOPOLOGIES.NAMED_HELPERS, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: f.controlRoot });
  assert.equal(profile.topology, 'toolkit-named-helpers');
  assert.equal(profile.enforcement, 'native-agent-hook-named-helpers');
  assert.equal(control.readProfile('claude-code', { root: f.controlRoot }).supported, true);
  assert.deepEqual(f.decide({ tool_input: { subagent_type: 'toolkit-g1-helper' } }), {});
  assert.ok(denied(f.decide({ tool_input: { subagent_type: 'general-purpose' } })));
  // 2.10.x knew only root-only and broader-native, so any other stored value reads as unsupported root-only.
  assert.equal(['root-only', 'broader-native'].includes(profile.topology), false);
});

test('only the Claude Agent hook blocks on hook failure; SessionStart stays non-blocking, and both hook copies agree', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'toolkit-local-bridge', 'claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(contract, plugin);
  const agent = plugin.hooks.PreToolUse.find(group => group.matcher === 'Agent|Task');
  assert.equal(agent.hooks[0].onFailure, 'block');
  for (const group of plugin.hooks.SessionStart) for (const handler of group.hooks) assert.equal(Object.hasOwn(handler, 'onFailure'), false);
});
