'use strict';

// Owner record WEB-TK421-D1-MANUAL-VS-AUTOMATED-ROUTE-20261017-08: model and effort follow
// launch ownership. A human's direct choice for a manually launched first layer is advisory;
// every automation-launched G0/G1/G2 worker, successor and G0/G1 helper uses the exact pinned
// route. These controlled regressions exercise the shipped enforcement points (the helper guard
// and native adapters). They do not qualify a native host.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { capturedStack } = require('./support/captured-stack-fixture.cjs');
const { controllerText } = require('./support/controller-text.cjs');
const { HOST_ENTRIES, createHelperRouteGuard } = require('../scripts/toolkit-v3-helper-guard.cjs');
const { createNativeHelperAdapter, resolveClaudeNativeState, HostDialect } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const h = s => crypto.createHash('sha256').update(s).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

// Host state the adapter observes for one helper call made from a root session.
function hostState(entryId, captured, callerRole = 'G1') {
  const helperRole = callerRole === 'G0' ? 'DISCOVERY_HELPER' : 'BUILDER_HELPER', route = captured.selection.routes[helperRole];
  return { state: 'ready', host_version: 'controlled-ownership-test (not native qualification)',
    registration: { ...HOST_ENTRIES[entryId], registered: true, loaded: true, enabled: true },
    session: { caller_role: callerRole, profile_id: captured.selection.profile_id, registry_revision: captured.selection.registry_digest, lifecycle: 'fresh' },
    routing: { profile_id: captured.selection.profile_id, registry_revision: captured.selection.registry_digest, helper_role: helperRole,
      effective_route: route, native_defaults: route, pinned_defaults: { provider: true, model: true, reasoning: true }, inherited_route: null } };
}

// A manually started Claude root: no launcher binding, so no caller session, workspace or
// model is pinned. The root's own model and effort are whatever the human chose.
function manualClaudeRoot({ rootModel, rootEffort, environment = {} }) {
  const captured = capturedStack('owner-claude'), dispatches = [], state = hostState('claude_parent_agent', captured);
  const binding = { helper_identity: 'ai-agent-toolkit:g1-helper', host_state: state,
    native_config: { loaded_agent: 'ai-agent-toolkit:g1-helper', mods_present: false, provider: 'anthropic', parent_model: rootModel,
      agent_model: 'claude-haiku-5-5', agent_effort: 'xhigh', session_effort: rootEffort, available_models: ['claude-haiku-5-5', 'claude-opus-5-5'] } };
  let toolInput = {};
  const adapter = createNativeHelperAdapter({ source_capture: captured.source_capture, selection: captured.selection,
    entry_id: 'claude_parent_agent', helper_identity: 'ai-agent-toolkit:g1-helper', timeout_ms: 50,
    observe_host_state: () => resolveClaudeNativeState(binding, toolInput, environment),
    dispatch_native: request => { dispatches.push(request); return { first_model_request: 'intercepted', task_effects: 0 }; } });
  return { captured, dispatches, invoke: async (input = {}) => {
    toolInput = { subagent_type: 'ai-agent-toolkit:g1-helper', ...input };
    return adapter.invoke({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'owner-chat', cwd: 'owned', model: rootModel, tool_input: toolInput });
  } };
}

function manualGptStackCodexRoot({ rootModel, rootReasoning }) {
  const captured = capturedStack('owner-gpt'), dispatches = [], state = hostState('codex_spawn_agent', captured);
  const actualRootRoute = Object.freeze({ model:rootModel, reasoning:rootReasoning });
  const adapter = createNativeHelperAdapter({ source_capture:captured.source_capture, selection:captured.selection,
    entry_id:'codex_spawn_agent', helper_identity:'ai-agent-toolkit:g1-helper', timeout_ms:50,
    observe_host_state:() => clone(state),
    dispatch_native:request => { dispatches.push(request); return { first_model_request:'intercepted', task_effects:0 }; } });
  return { captured, dispatches, actualRootRoute, invoke:() => adapter.invoke({ hook_event_name:'PreToolUse', tool_name:'spawn_agent',
    session_id:'human-opened-codex-root', cwd:'owned', model:rootModel, tool_input:{subagent_type:'ai-agent-toolkit:g1-helper'} }) };
}

test('(a) a manually selected root with a non-recommended model or effort meets no stack-model blocker', async () => {
  const lead = capturedStack('owner-claude').selection.routes.BUILDER;
  assert.deepEqual([lead.model, lead.reasoning], ['opus-5.5', 'high'], 'the registry recommendation the owner may depart from');
  for (const [rootModel, rootEffort] of [['claude-opus-5-5', 'high'], ['claude-haiku-5-5', 'low'], ['claude-sonnet-5-5', 'medium'], ['claude-opus-5-5', 'max']]) {
    const root = manualClaudeRoot({ rootModel, rootEffort });
    const result = await root.invoke();
    assert.equal(result.decision, 'ALLOW', `${rootModel}/${rootEffort}: ${result.code}`);
    assert.equal(root.dispatches.length, 1);
    assert.deepEqual(root.dispatches[0].route, root.captured.selection.routes.BUILDER_HELPER, 'the helper still receives its exact pinned route');
  }
  // Codex: without a launcher binding no caller model is pinned, so the owner's model choice is not compared.
  const captured = capturedStack('owner-gpt'), dispatches = [];
  const adapter = createNativeHelperAdapter({ source_capture: captured.source_capture, selection: captured.selection, entry_id: 'codex_spawn_agent',
    helper_identity: 'ai-agent-toolkit:g1-helper', timeout_ms: 50, observe_host_state: () => clone(hostState('codex_spawn_agent', captured)),
    dispatch_native: request => { dispatches.push(request); return { first_model_request: 'intercepted' }; } });
  const codex = await adapter.invoke({ hook_event_name: 'PreToolUse', tool_name: 'spawn_agent', session_id: 'owner-chat', cwd: 'owned',
    model: 'an-owner-chosen-model', tool_input: { subagent_type: 'ai-agent-toolkit:g1-helper' } });
  assert.equal(codex.decision, 'ALLOW', codex.code);
  assert.deepEqual(dispatches[0].route, captured.selection.routes.BUILDER_HELPER);
});

test('(a) no Toolkit-shipped root entrypoint installs a root model or effort lock', () => {
  for (const rel of ['.claude-plugin/hooks/hooks.json', '.codex-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')).hooks;
    for (const entry of hooks.SessionStart) for (const hook of entry.hooks) {
      assert.doesNotMatch(hook.command, /--model|--effort|gate-session-launcher|EFFORT_LEVEL/, `${rel}: SessionStart ${hook.command}`);
    }
    for (const entry of hooks.PostToolUse) for (const hook of entry.hooks) {
      assert.doesNotMatch(hook.command, /--model|--effort|gate-session-launcher|EFFORT_LEVEL/, `${rel}: PostToolUse ${hook.command}`);
    }
    for (const entry of hooks.Stop) for (const hook of entry.hooks) {
      assert.doesNotMatch(hook.command, /--model|--effort|gate-session-launcher|EFFORT_LEVEL/, `${rel}: Stop ${hook.command}`);
    }
    for (const entry of hooks.UserPromptSubmit) for (const hook of entry.hooks) assert.doesNotMatch(hook.command, /--model|--effort|gate-session-launcher|EFFORT_LEVEL/, `${rel}: UserPromptSubmit`);
    assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'], `${rel}: only the reviewed hook events`);
  }
  for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const key of ['model', 'effort', 'effortLevel', 'settings', 'env']) assert.equal(Object.hasOwn(manifest, key), false, `${rel}: root ${key}`);
  }
  // Claude helper model and effort live only in scoped subagent definitions.
  const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');
  const renderer = new ClaudeHelperAgentRenderer(capturedStack('owner-claude'));
  for (const role of ['G0', 'G1']) {
    const rendered = renderer.render(role);
    assert.match(rendered.file, /^toolkit-g[01]-helper\.md$/);
    assert.match(rendered.text, /^model: claude-haiku-5-5$/m);
    assert.match(rendered.text, /^effort: xhigh$/m);
  }
});

test('(c) helpers spawned from a manually selected root stay strictly on their pinned route', async () => {
  for (const [input, environment] of [[{ effort: 'low' }, {}], [{ model: 'claude-opus-5-5' }, {}], [{}, { CLAUDE_CODE_EFFORT_LEVEL: 'low' }],
    [{}, { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-5-5' }]]) {
    const root = manualClaudeRoot({ rootModel: 'claude-sonnet-5-5', rootEffort: 'low', environment });
    const result = await root.invoke(input);
    assert.equal(result.decision, 'DENY', `${JSON.stringify(input)} ${JSON.stringify(environment)}`);
    assert.equal(root.dispatches.length, 0, 'no wrong-route helper inference');
  }
});

test('(d) an owner-chosen low effort on a manually started root is not a root lock', async () => {
  // Its helper is still allowed on the pinned route.
  const root = manualClaudeRoot({ rootModel: 'claude-opus-5-5', rootEffort: 'low' });
  assert.equal((await root.invoke()).decision, 'ALLOW');
  // The installed root entrypoints load no model or effort lock.
  const entries = ['toolkit-claude-agent-hook.cjs', 'toolkit-codex-helper-hook.cjs', 'toolkit-codex-session-start.cjs', 'toolkit-local-bridge.cjs']
    .map(name => path.join(ROOT, 'repo', 'scripts', name));
  const script = 'for (const f of JSON.parse(process.argv[1])) require(f); console.log(JSON.stringify(Object.keys(require.cache)));';
  const run = spawnSync(process.execPath, ['-e', script, JSON.stringify(entries)], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const loaded = JSON.parse(run.stdout);
  assert.ok(loaded.some(file => file.endsWith('toolkit-claude-agent-hook.cjs')), 'positive control: the entrypoints were loaded');
  assert.equal(loaded.some(file => /gate-session-launcher|toolkit-v3-lifecycle/.test(file)), false);
});

test('(e) no root route, however chosen, admits helper delegation from G2, a leaf or an absent request', async () => {
  const captured = capturedStack('owner-claude'), dispatches = [];
  const guard = role => createHelperRouteGuard({ entry_id: 'claude_parent_agent', source_capture: captured.source_capture, selection: captured.selection,
    observe_host_state: () => clone(hostState('claude_parent_agent', captured, role === 'G2' ? 'G1' : role)),
    controlled_dispatch: request => { dispatches.push(request); return {}; } });
  const request = (role, helper_requested = true) => ({ caller_role: role, profile_id: captured.selection.profile_id,
    registry_revision: captured.selection.registry_digest, helper_role: 'BUILDER_HELPER', helper_requested, route_overrides: {}, session_transition: 'fresh' });
  // An owner-opened G2 chat on any model still cannot delegate.
  assert.equal((await guard('G2').invoke(request('G2'))).code, 'CALLER_CANNOT_DELEGATE');
  assert.equal((await guard('G1').invoke(request('G1', false))).decision, 'NOOP_NO_HELPER_REQUEST');
  assert.equal(dispatches.length, 0);
  const root = manualClaudeRoot({ rootModel: 'claude-sonnet-5-5', rootEffort: 'low' });
  const leaf = await root.invoke({});
  assert.equal(leaf.decision, 'ALLOW', 'positive control');
  const adapter = createNativeHelperAdapter({ source_capture: captured.source_capture, selection: captured.selection, entry_id: 'claude_parent_agent',
    helper_identity: 'ai-agent-toolkit:g1-helper', timeout_ms: 50, observe_host_state: () => clone(hostState('claude_parent_agent', captured)),
    dispatch_native: request => { dispatches.push(request); return {}; } });
  const nested = await adapter.invoke({ hook_event_name: 'PreToolUse', tool_name: 'Agent', agent_id: 'helper-1', model: 'claude-haiku-5-5',
    tool_input: { subagent_type: 'ai-agent-toolkit:g1-helper' } });
  assert.equal(nested.code, 'NATIVE_LEAF_CANNOT_DELEGATE');
  assert.equal(dispatches.length, 0);
});

test('synthetic captured sources resolve every non-helper role while documented host limits stay policy-only', () => {
  const expected = {
    'owner-gpt': {
      DISCOVERY: { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' },
      BUILDER: { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' },
      DESIGN_CHALLENGE: { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'xhigh' },
      G2: { reviewer_id: 'sol', provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'xhigh' },
    },
    'owner-claude': {
      DISCOVERY: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
      BUILDER: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
      DESIGN_CHALLENGE: { provider: 'anthropic', model: 'opus-5.5', reasoning: 'xhigh' },
      G2: { reviewer_id: 'opus', provider: 'anthropic', model: 'opus-5.5', reasoning: 'xhigh' },
    },
  };
  const hosts = ['codex', 'claude-code'];
  const roles = ['DISCOVERY', 'BUILDER', 'DESIGN_CHALLENGE', 'G2'];
  const expectedHostSupport = {
    'owner-gpt': {
      codex: { DISCOVERY: true, BUILDER: true, DESIGN_CHALLENGE: true, G2: true },
      'claude-code': { DISCOVERY: false, BUILDER: false, DESIGN_CHALLENGE: false, G2: false },
    },
    'owner-claude': {
      codex: { DISCOVERY: false, BUILDER: false, DESIGN_CHALLENGE: false, G2: false },
      'claude-code': { DISCOVERY: true, BUILDER: true, DESIGN_CHALLENGE: true, G2: true },
    },
  };
  const controller = controllerText();
  const gateRules = fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'agent-rules', 'gate-rules.md'), 'utf8');
  const delivery = fs.readFileSync(path.join(ROOT, 'repo', 'docs', 'TOOLKIT-DELIVERY.md'), 'utf8');

  for (const [profile, roleRoutes] of Object.entries(expected)) {
    const captured = capturedStack(profile);
    assert.equal(captured.selection.profile_id, profile);
    for (const host of hosts) for (const role of roles) {
      const label = `${profile}/${host}/${role}`;
      let resolved;
      if (role === 'G2') {
        const reviewers = captured.selection.reviewers.filter(member => member.reviewer_id === roleRoutes.G2.reviewer_id);
        assert.equal(reviewers.length, 1, `${label}: source must contain exactly one matching reviewer`);
        resolved = reviewers[0];
      } else {
        resolved = captured.selection.routes[role];
      }
      assert.deepEqual(resolved, roleRoutes[role], `${label}: source route resolution`);
      assert.equal(HostDialect.for(host).supports(resolved), expectedHostSupport[profile][host][role],
        `${label}: route compatibility only, not lead or G2 launch qualification`);
    }
  }

  // There is no production lead/G2 launcher API here. These source checks preserve the written
  // capability contract; they do not simulate a launch or qualify either native host.
  assert.match(controller, /exact captured registry revision and pinned CURRENT selection/);
  assert.match(controller, /No unavailable route authorises a model\/effort\/provider fallback/);
  assert.match(gateRules, /Model and effort follow launch ownership/);
  assert.match(gateRules, /a human's own choice .* advisory, not a blocker/);
  assert.match(gateRules, /recorded as the actual route/);
  assert.match(gateRules, /Every automation-launched .* exact pinned route/);
  assert.match(controller, /G2 has no helpers/);
  assert.match(delivery, /ships no mixed stack and does not supply automated cross-host gate launches/);
  assert.match(delivery, /A gatekeeper is no registry role/);
  assert.match(controller, /One gatekeeper per lane is a fresh session in the controller's harness on the mid tier at medium effort \(`agent-cost-control`\)\. It starts gate runs/);
  assert.doesNotMatch(controller, /GATEKEEPER/);
  assert.match(controller, /one blocking call \(no polling or progress posts\).*relays the report verbatim/);
  assert.match(controller, /never judges findings, merges, closes, takes controller authority or a gate's verdict/);
  assert.match(controller, /Every report includes a Route line naming actual model and effort/);
  assert.match(controller, /gatekeeper may start the other harness's gate through that tool's CLI with model\/effort pinned; route proof comes from that CLI's own launch record/);
  assert.match(controller, /This rule supplies no launcher or hook enforcement/);
});

test('synthetic GPT stack G2 requests cannot delegate through either host guard', async () => {
  const captured = capturedStack('owner-gpt'), dispatches = [];
  const hostCases = [
    { host: 'codex', entryId: 'codex_spawn_agent' },
    { host: 'claude-code', entryId: 'claude_parent_agent' },
  ];

  for (const { host, entryId } of hostCases) {
    const guard = createHelperRouteGuard({ entry_id: entryId, source_capture: captured.source_capture, selection: captured.selection,
      observe_host_state: () => clone(hostState(entryId, captured, 'G1')),
      controlled_dispatch: request => { dispatches.push(request); return {}; } });
    const result = await guard.invoke({ caller_role: 'G2', profile_id: 'owner-gpt', registry_revision: captured.selection.registry_digest,
      helper_role: 'BUILDER_HELPER', helper_requested: true, route_overrides: {}, session_transition: 'fresh' });
    assert.equal(result.code, 'CALLER_CANNOT_DELEGATE', `${host}: G2 cannot request helpers`);
  }
  assert.equal(dispatches.length, 0, 'both synthetic host observations refuse before controlled dispatch');
});

test('synthetic human-opened GPT stack Codex root choices remain advisory while the helper stays exact', async () => {
  const recommended = { provider:'openai', model:'gpt-6.1-sol', reasoning:'high' };
  for (const [rootModel, rootReasoning] of [['gpt-6.1-sol', 'low'], ['gpt-6-luna', 'max']]) {
    const root = manualGptStackCodexRoot({ rootModel, rootReasoning });
    assert.deepEqual(root.captured.selection.routes.BUILDER, recommended);
    assert.deepEqual(root.actualRootRoute, { model:rootModel, reasoning:rootReasoning }, 'synthetic actual route chosen by the human');
    const result = await root.invoke();
    assert.equal(result.decision, 'ALLOW', `${rootModel}/${rootReasoning}: ${result.code}`);
    assert.deepEqual(root.dispatches[0].route, root.captured.selection.routes.BUILDER_HELPER,
      'the actual manually chosen root route does not loosen the pinned helper route');
  }
});

test('the cost-control ladder carries the gatekeeper tier rule', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../../skills/agent-cost-control/SKILL.md'), 'utf8');
  assert.match(skill, /\*\*A gatekeeper is on the ladder\.\*\* A session that only starts gate runs, waits and relays their reports is no gate: it runs at step 2 \(mid, medium\), never the small tier, and a raise needs its written reason\./);
});
