'use strict';
require('./toolkit-test-temp-guard.cjs');
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
const { managedAgentsDirectory } = require('../scripts/toolkit-claude-helper-policy.cjs');
const { governedHome, makeGoverned } = require('./toolkit-governed-fixture-support.cjs');


function scratch(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-helper-policy-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A governed repository, a Claude config directory with the rendered helpers, and an empty control root.
// `environment` is a Toolkit gate run (a launcher marker, a G1 lead), the only session the named-helper
// policy applies to; `open` is any other session.
function fixture(t, { install = true } = {}) {
  const dir = scratch(t);
  const repo = path.join(dir, 'repo'), plain = path.join(dir, 'plain'), configDir = path.join(dir, 'claude'), controlRoot = path.join(dir, 'control');
  for (const r of [repo, plain]) fs.mkdirSync(path.join(r, '.git'), { recursive: true });
  makeGoverned(repo, 'helper-policy');
  fs.writeFileSync(path.join(plain, 'AGENTS.md'), '# Project rules\n');
  fs.mkdirSync(path.join(configDir, 'agents'), { recursive: true });
  const renderer = ClaudeHelperAgentRenderer.fromRepository('owner-claude', ROOT);
  if (install) for (const role of ['G0', 'G1']) { const { file, text } = renderer.render(role); fs.writeFileSync(path.join(configDir, 'agents', file), text); }
  const open = { CLAUDE_CONFIG_DIR: configDir };
  const environment = { ...open, TOOLKIT_GATE_ROLE: 'G1' };
  const decide = (input, env = environment) => hook.decision({ tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd: repo, ...input },
    { root: controlRoot, environment: env, helper_policy: { toolkitRoot: ROOT } });
  return { dir, repo, plain, configDir, controlRoot, environment, open, decide };
}

const denied = output => output?.hookSpecificOutput?.permissionDecision === 'deny';
const reason = output => output.hookSpecificOutput.permissionDecisionReason;

test('the governed-repo predicate walks to the first .git and follows the governance state, or a launcher marker', t => {
  const dir = scratch(t);
  assert.equal(governedRepo(dir, {}).governed, false, 'no git root');
  assert.equal(governedRepo(dir, { TOOLKIT_GATE_ROLE: 'G1' }).reason, 'launcher-marker');
  const managed = makeGoverned(path.join(dir, 'managed'), 'predicate');
  fs.mkdirSync(path.join(managed, 'src', 'deep'), { recursive: true });
  assert.equal(governedRepo(path.join(managed, 'src', 'deep'), {}).reason, 'governance-enabled');
  // Only the merged binding decides: removing the working tree's copy changes nothing.
  fs.rmSync(path.join(managed, '.github'), { recursive: true });
  assert.equal(governedRepo(managed, {}).reason, 'governance-enabled');
  // The user's yes without a merged binding does not govern: the repository's setup is unfinished.
  const governance = require('../scripts/toolkit-governance-state.cjs');
  const bindingCache = require('../scripts/toolkit-governance-binding.cjs');
  fs.rmSync(bindingCache.cacheFileFor(governance.registryPathFor({ userHome: governedHome(), testOnly: true }), governance.readIdentity(managed).repository_id));
  assert.deepEqual([governedRepo(managed, {}).governed, governedRepo(managed, {}).reason], [false, 'governance-incomplete']);
  // The block and binding without the user's yes do not govern either: the repository is asked.
  const unasked = makeGoverned(path.join(dir, 'unasked'), 'predicate-unasked', { enable: false });
  assert.deepEqual([governedRepo(unasked, {}).governed, governedRepo(unasked, {}).reason], [false, 'governance-undecided']);
  // Declined: the block is ignored.
  const registryPath = path.join(dir, 'state', 'repository-governance.v1.json');
  const registry = require('../scripts/toolkit-capability-registry.cjs');
  const declined = makeGoverned(path.join(dir, 'declined'), 'predicate-declined', { enable: false });
  const childProcess = require('node:child_process');
  childProcess.execFileSync('git', ['-C', declined, 'init', '--quiet']);
  const options = { registryPath, testOnly: true };
  const status = registry.getRepositoryStatus({ cwd: declined, ...options });
  registry.writeCapabilityDecision({ cwd: declined, ...options, capabilityId: 'repository.governance', operation: 'decline',
    ownerAction: { confirmed: true, category: 'explicit-owner', channel: 'capability-route', operation: 'decline',
      choice_semantic_id: registry.capabilityDecisionSemanticId('repository.governance', 'decline'), contract_digest: registry.CONTRACT_DIGEST,
      scope_digest: registry.capabilityScopeDigest(status.repository_id, 'repository.governance', 'decline', 'capability-route') },
    expectedRevision: status.registry_revision, expectedHash: status.snapshot_hash });
  assert.equal(governedRepo(declined, {}, { registryOptions: options }).reason, 'governance-disabled');
  // A nested repository (here a worktree-style `.git` file) stops the walk before the managed parent.
  const nested = path.join(managed, 'vendor', 'lib');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, '.git'), 'gitdir: ../../.git/worktrees/lib\n');
  const inner = governedRepo(nested, {});
  assert.equal(inner.governed, false); assert.equal(inner.root, nested);
  assert.equal(governedRepo(ROOT, {}).governed, false, 'the Toolkit checkout is asked like any other repository');
});

test('outside a gate run every main-session agent launch is left to Claude Code, in a governed repository too', t => {
  const f = fixture(t);
  for (const cwd of [f.plain, f.dir, f.repo]) {
    for (const tool_input of [{ subagent_type: 'general-purpose' }, {}, { subagent_type: 'Explore', model: 'opus' }]) {
      assert.deepEqual(f.decide({ cwd, tool_input }, f.open), {}, `${cwd} ${JSON.stringify(tool_input)}`);
      assert.deepEqual(f.decide({ cwd, tool_name: 'Task', tool_input }, f.open), {}, `${cwd} Task ${JSON.stringify(tool_input)}`);
    }
    // A main session started with --agent carries agent_type but no agent_id; it is still the main session.
    assert.deepEqual(f.decide({ cwd, agent_type: 'security-reviewer', tool_input: { subagent_type: 'Explore' } }, f.open), {}, `${cwd} --agent main session`);
  }
  // The same launch in a gate run there gets the named-helper policy.
  assert.match(reason(f.decide({ tool_input: { subagent_type: 'Explore' } })), /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: Explore\)/);
  assert.deepEqual(hook.decision({ tool_name: 'Read', cwd: f.repo }, { root: f.controlRoot, environment: f.environment }), {});
});

const ONE_LAYER_REASON = "Toolkit: a subagent can't start another agent (one layer only). Do the work in this subagent, or hand it back to the main session.";

test('outside a gate run a subagent cannot launch another agent, with a plain one-layer reason, in a governed repository too', t => {
  const f = fixture(t);
  for (const cwd of [f.plain, f.dir, f.repo]) {
    for (const tool_name of ['Agent', 'Task']) {
      for (const caller of [{ agent_id: 'a1', agent_type: 'Explore' }, { agent_id: 'a2' }]) {
        const output = f.decide({ cwd, tool_name, ...caller, tool_input: { subagent_type: 'general-purpose', prompt: 'y' } }, f.open);
        assert.ok(denied(output), `${cwd} ${tool_name} ${JSON.stringify(caller)}`);
        assert.equal(reason(output), ONE_LAYER_REASON);
        assert.doesNotMatch(reason(output), /G0|G1|helper/);
      }
    }
    // Non-agent tools inside a subagent are untouched.
    assert.deepEqual(f.decide({ cwd, tool_name: 'Read', agent_id: 'a1', agent_type: 'Explore', tool_input: {} }, f.open), {});
  }
});

test('broader native behaviour lifts the normal-folder refusal; a missing or unreadable profile keeps it; a gate run is unchanged', async t => {
  const f = fixture(t);
  const nested = cwd => f.decide({ cwd, agent_id: 'a1', agent_type: 'Explore', tool_input: { subagent_type: 'general-purpose' } }, f.open);
  // Missing profile: unconfigured reads as root-only, so the one-layer refusal stays.
  assert.equal(reason(nested(f.plain)), ONE_LAYER_REASON);
  // Unreadable profile: same fail-safe.
  const profileFile = control.profilePath('claude-code', { root: f.controlRoot });
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(profileFile, '{ not json');
  assert.equal(reason(nested(f.plain)), ONE_LAYER_REASON);
  // Broader native: Claude's own defaults outside Toolkit repos, so no decision.
  control.configureProfile('claude-code', { topology: control.TOPOLOGIES.BROADER_NATIVE, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: f.controlRoot });
  assert.equal(control.readProfile('claude-code', { root: f.controlRoot }).topology, control.TOPOLOGIES.BROADER_NATIVE);
  for (const cwd of [f.plain, f.dir]) {
    assert.deepEqual(nested(cwd), {}, cwd);
    assert.deepEqual(f.decide({ cwd, tool_name: 'Task', agent_id: 'a2', tool_input: {} }, f.open), {}, `${cwd} Task`);
  }
  assert.equal(reason(nested(f.repo)), ONE_LAYER_REASON, 'a governed repository keeps one layer');
  assert.equal(reason(f.decide({ tool_name: 'Task', agent_id: 'a2', tool_input: {} }, f.open)), ONE_LAYER_REASON, 'Task keeps one layer too');
  assert.deepEqual(f.decide({ tool_input: { subagent_type: 'general-purpose' } }, f.open), {}, 'the main session may launch any agent');
  // A gate run under broader native without a launcher binding gets the named-helper policy:
  // a subagent caller is refused, the lead may launch a current Toolkit helper, and nothing else.
  assert.match(reason(await f.decide({ agent_id: 'a1', agent_type: 'Explore', tool_input: { subagent_type: 'toolkit-g0-helper' } })), /a helper cannot launch another agent/);
  assert.deepEqual(await f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper', prompt: 'y' } }), {});
  assert.match(reason(await f.decide({ tool_input: { subagent_type: 'general-purpose' } })), /allows only the toolkit-g0-helper and toolkit-g1-helper agents/);
});

test('in governed work a main session started with --agent is the lead; only an agent_id caller is a helper', t => {
  const f = fixture(t);
  // agent_type without agent_id: a --agent main session, judged like any lead launch.
  assert.deepEqual(f.decide({ agent_type: 'security-reviewer', tool_input: { subagent_type: 'toolkit-g0-helper', prompt: 'y' } }), {});
  assert.match(reason(f.decide({ agent_type: 'security-reviewer', tool_input: { subagent_type: 'general-purpose' } })),
    /allows only the toolkit-g0-helper and toolkit-g1-helper agents \(requested: general-purpose\)/);
  for (const caller of [{ agent_id: 'a1', agent_type: 'toolkit-g1-helper' }, { agent_id: 'a2' }]) {
    const output = f.decide({ ...caller, tool_input: { subagent_type: 'toolkit-g0-helper' } });
    assert.equal(reason(output), 'Toolkit: a helper cannot launch another agent. Only the main session launches helpers.', JSON.stringify(caller));
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

test('environment variables that would change the helper model or effort are refused; harmless values pass', t => {
  const f = fixture(t);
  const launch = env => f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper', prompt: 'y' } }, { ...f.environment, ...env });
  const refusals = [
    [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }, /^Toolkit: CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set, so Claude Code ignores the helper model; unset it to use Toolkit helpers\.$/],
    [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'true' }, /CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set/],
    [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-5-5' }, /CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set/],
    [{ CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-5-5' }, /^Toolkit: CLAUDE_CODE_SUBAGENT_MODEL is set, and some Claude Code versions let it replace the helper model; unset it to use Toolkit helpers\.$/],
    [{ CLAUDE_CODE_EFFORT_LEVEL: 'low' }, /^Toolkit: CLAUDE_CODE_EFFORT_LEVEL is set to low, which replaces the helper's xhigh effort; unset it to use Toolkit helpers\.$/],
    [{ CLAUDE_CODE_EFFORT_LEVEL: 'auto' }, /set to auto, which replaces the helper's xhigh effort/],
    [{ CLAUDE_CODE_EFFORT_LEVEL: 'XHIGH' }, /set to XHIGH/],
  ];
  for (const [env, expected] of refusals) {
    const output = launch(env);
    assert.ok(denied(output), JSON.stringify(env));
    assert.match(reason(output), expected);
  }
  // Off values, an empty value and the helper's own effort leave the route unchanged.
  for (const env of [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '0' }, { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'false' }, { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '' },
    { CLAUDE_CODE_EFFORT_LEVEL: '' }, { CLAUDE_CODE_EFFORT_LEVEL: 'xhigh' }, { CLAUDE_CODE_EFFORT_LEVEL: ' xhigh ' }]) {
    assert.deepEqual(launch(env), {}, JSON.stringify(env));
  }
  // The effort check reads the definition Claude Code would load, so a stale definition is reported first.
  const file = path.join(f.configDir, 'agents', 'toolkit-g0-helper.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('effort: xhigh', 'effort: low'));
  assert.match(reason(launch({ CLAUDE_CODE_EFFORT_LEVEL: 'low' })), /does not match the one rendered from the selected stack/);
});

test('A14: definitions are looked up the way Claude Code loads them: managed first, then every project folder from the working directory up, then the user folder', t => {
  const f = fixture(t);
  const managed = path.join(f.dir, 'managed', '.claude', 'agents');
  const decide = (input, cwd = f.repo) => hook.decision({ tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd, ...input },
    { root: f.controlRoot, environment: f.environment, helper_policy: { toolkitRoot: ROOT, managedAgentsDirectory: managed } });
  const launch = { tool_input: { subagent_type: 'toolkit-g1-helper', prompt: 'y' } };
  const original = fs.readFileSync(path.join(f.configDir, 'agents', 'toolkit-g1-helper.md'), 'utf8');
  const changed = original.replace('maxTurns: 60', 'maxTurns: 99');
  // A copy in a folder between the working directory and the git root is loaded before the root's.
  const deep = path.join(f.repo, 'packages', 'app', 'src');
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(path.join(f.repo, 'packages', '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'packages', '.claude', 'agents', 'toolkit-g1-helper.md'), changed);
  assert.match(reason(decide(launch, deep)), /^Toolkit: the project copy .*packages[\\/]\.claude[\\/]agents[\\/]toolkit-g1-helper\.md does not match/);
  assert.deepEqual(decide(launch, f.repo), {}, 'a folder below the working directory is not loaded');
  fs.writeFileSync(path.join(f.repo, 'packages', '.claude', 'agents', 'toolkit-g1-helper.md'), original);
  assert.deepEqual(decide(launch, deep), {}, 'a byte-matching intermediate copy is fine');
  // A managed copy outranks every other location.
  fs.mkdirSync(managed, { recursive: true });
  fs.writeFileSync(path.join(managed, 'toolkit-g1-helper.md'), changed);
  assert.match(reason(decide(launch)), /^Toolkit: the managed copy .* does not match the one rendered from the selected stack\. Toolkit does not change managed files; ask whoever manages this computer's Claude Code settings to update or remove it\.$/);
  fs.writeFileSync(path.join(managed, 'toolkit-g1-helper.md'), original);
  assert.deepEqual(decide(launch), {});
});

test('the managed agents folder follows the documented managed settings folder on each platform', () => {
  assert.equal(managedAgentsDirectory('win32'), 'C:\\Program Files\\ClaudeCode\\.claude\\agents');
  assert.equal(managedAgentsDirectory('darwin'), '/Library/Application Support/ClaudeCode/.claude/agents');
  assert.equal(managedAgentsDirectory('linux'), '/etc/claude-code/.claude/agents');
});

test('a helper file rewritten after the session started is refused until a new session', t => {
  const f = fixture(t);
  const file = path.join(f.configDir, 'agents', 'toolkit-g0-helper.md');
  const transcript = path.join(f.configDir, 'session.jsonl');
  fs.writeFileSync(transcript, '{}\n');
  const started = fs.statSync(transcript).birthtimeMs;
  if (!started) return t.skip('this file system reports no creation time');
  const input = { transcript_path: transcript, tool_input: { subagent_type: 'toolkit-g0-helper', prompt: 'y' } };
  fs.utimesSync(file, new Date(started - 60000), new Date(started - 60000));
  assert.deepEqual(f.decide(input), {}, 'a file older than the session is fine');
  fs.utimesSync(file, new Date(started + 60000), new Date(started + 60000));
  const output = f.decide(input);
  assert.ok(denied(output));
  assert.match(reason(output), /Helper settings changed after this session started\. Start a new session to use them\./);
  assert.deepEqual(f.decide({ tool_input: input.tool_input }), {}, 'without a transcript the check makes no claim');
});

test('a helper definition that does not byte-match the selected-stack rendering is refused, including a project override', t => {
  const f = fixture(t);
  const file = path.join(f.configDir, 'agents', 'toolkit-g0-helper.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('effort: xhigh', 'effort: low'));
  const drifted = f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } });
  assert.match(reason(drifted), /does not match the one rendered from the selected stack/);
  assert.match(reason(drifted), /\) does not match the one rendered from the selected stack\. Run `setup toolkit` to refresh it\.$/);
  fs.writeFileSync(file, original.replace(/explicitly selected stack `owner-claude`/, 'explicitly selected stack `owner-unknown`'));
  assert.ok(denied(f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } })), 'unknown stack');
  fs.writeFileSync(file, original);
  assert.deepEqual(f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } }), {});
  // Project agents outrank user agents, so a differing project copy is what Claude Code would load.
  fs.mkdirSync(path.join(f.repo, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, '.claude', 'agents', 'toolkit-g0-helper.md'), original.replace('maxTurns: 50', 'maxTurns: 99'));
  assert.match(reason(f.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } })), /^Toolkit: the project copy .*[\\/]\.claude[\\/]agents[\\/]toolkit-g0-helper\.md does not match the one rendered from the selected stack\. Toolkit does not change project files; update or remove it\.$/);
  const missing = fixture(t, { install: false });
  assert.match(reason(missing.decide({ tool_input: { subagent_type: 'toolkit-g1-helper' } })), /no toolkit-g1-helper definition is installed/);
});

test('refusals give one plain next step: the generator by absolute path when nothing is installed, setup toolkit for a stale user copy, and no repo-relative command', t => {
  const generator = `node "${ROOT.replace(/\\/g, '/')}/repo/scripts/toolkit-claude-helper-agents.cjs" --stack <stack> --write`;
  const missing = fixture(t, { install: false });
  assert.equal(reason(missing.decide({ tool_input: { subagent_type: 'toolkit-g1-helper' } })),
    `Toolkit: no toolkit-g1-helper definition is installed. Install the Toolkit helpers with ${generator}.`);
  const stale = fixture(t);
  const userFile = path.join(stale.configDir, 'agents', 'toolkit-g0-helper.md');
  fs.writeFileSync(userFile, fs.readFileSync(userFile, 'utf8').replace('effort: xhigh', 'effort: low'));
  assert.equal(reason(stale.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } })),
    `Toolkit: the installed toolkit-g0-helper definition (${userFile}) does not match the one rendered from the selected stack. Run \`setup toolkit\` to refresh it.`);
  const project = fixture(t);
  fs.mkdirSync(path.join(project.repo, '.claude', 'agents'), { recursive: true });
  const projectFile = path.join(project.repo, '.claude', 'agents', 'toolkit-g0-helper.md');
  fs.writeFileSync(projectFile, fs.readFileSync(path.join(project.configDir, 'agents', 'toolkit-g0-helper.md'), 'utf8').replace('maxTurns: 50', 'maxTurns: 99'));
  assert.equal(reason(project.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } })),
    `Toolkit: the project copy ${projectFile} does not match the one rendered from the selected stack. Toolkit does not change project files; update or remove it.`);
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
