'use strict';
const {resolveHistorical,originalRegistry}=require('./support/historical-stack-fixture.cjs');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const adapter = require('../scripts/toolkit-codex-agent-adapter.cjs');

const qualification = () => Object.fromEntries(compiler.CHEAP_QUALIFIERS.map(key => [key, { status: 'POSITIVE', source: null }]));

test('all-positive builder qualifiers do not downgrade the OpenAI discovery or builder lead', () => {
  const routes = resolveHistorical('owner-openai-default', qualification()).routes;
  const strong = { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' };
  const helper = { provider: 'openai', model: 'gpt-6-luna', reasoning: 'max' };
  assert.deepEqual(routes.DISCOVERY, strong);
  assert.deepEqual(routes.BUILDER, strong);
  assert.deepEqual(routes.DISCOVERY_HELPER, helper);
  assert.deepEqual(routes.BUILDER_HELPER, helper);
});

test('legacy profile names resolve only against their original pinned historical routes', () => {
  const profiles = originalRegistry;
  assert.doesNotThrow(() => compiler.checkCoreSchema(profiles, compiler.contractSchema('stack-registry-v3.schema.json')));
  for (const [alias, canonical] of Object.entries(profiles.aliases)) {
    const result = resolveHistorical(alias, qualification());
    assert.equal(result.requested_profile_id, alias);
    assert.equal(result.profile_id, canonical);
    assert.deepEqual(result.routes, resolveHistorical(canonical, qualification()).routes);
  }
});

test('both helper routes preserve the historical G0 leaf; G2 reviewers have no helper route', () => {
  const profiles = originalRegistry;
  const v2 = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '../contracts/controller-kernel/stack-registry-v2.json'), 'utf8'));
  for (const id of ['owner-openai-default', 'owner-claude', 'owner-mixed-claude-gpt']) {
    const routes = profiles.profiles[id].routes;
    const oldLeaf = v2.stacks[id].routes.G0.subagent;
    assert.deepEqual(routes.DISCOVERY_HELPER, oldLeaf);
    assert.deepEqual(routes.BUILDER_HELPER, oldLeaf);
    assert.deepEqual(Object.keys(routes.REVIEW_SCOPE).sort(), ['model', 'provider', 'reasoning']);
    assert.deepEqual(Object.keys(routes.REVIEW_EXECUTION).sort(), ['model', 'provider', 'reasoning']);
  }
  const mixed = profiles.profiles['owner-mixed-claude-gpt'].routes;
  assert.deepEqual(mixed.DESIGN_CHALLENGE, { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'xhigh' });
  assert.equal(profiles.profiles['owner-openai-default'].routes.DESIGN_CHALLENGE, null);
  assert.equal(profiles.profiles['owner-claude'].routes.DESIGN_CHALLENGE, null);
});

test('historical Claude and mixed bindings retain their original split roles and challenge meaning', () => {
  const profiles = originalRegistry.profiles;
  const claude = profiles['owner-claude'].routes;
  assert.deepEqual(claude.DISCOVERY, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(claude.BUILDER, claude.DISCOVERY);
  assert.deepEqual(claude.REVIEW_SCOPE, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'xhigh' });
  assert.deepEqual(claude.REVIEW_EXECUTION, claude.REVIEW_SCOPE);
  assert.equal(claude.DESIGN_CHALLENGE, null);

  const mixed = profiles['owner-mixed-claude-gpt'].routes;
  assert.deepEqual(mixed.DISCOVERY, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' });
  assert.deepEqual(mixed.BUILDER, mixed.DISCOVERY);
  assert.deepEqual(mixed.REVIEW_SCOPE, { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'xhigh' });
  assert.deepEqual(mixed.REVIEW_EXECUTION, { provider: 'anthropic', model: 'opus-5.5', reasoning: 'xhigh' });
  assert.deepEqual(mixed.DESIGN_CHALLENGE, { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'xhigh' });

  const decisionSchema = compiler.contractSchema('controller-decision-v1.schema.json');
  assert.equal(Object.hasOwn(decisionSchema.properties.selection.properties, 'service_tier'), false);
  assert.equal(decisionSchema.properties.selection.required.includes('service_tier'), false);
});

test('discovery and builder have distinct leaf dispatch tools; leaves and reviewers cannot nest delegation', () => {
  const names = role => adapter.toolDefinitions(role).map(item => item.name);
  assert.deepEqual(names('DISCOVERY'), ['toolkit_read', 'toolkit_search', 'toolkit_request_helper']);
  assert.deepEqual(names('BUILDER'), ['toolkit_read', 'toolkit_search', 'toolkit_apply_patch', 'toolkit_validate', 'toolkit_request_helper']);
  assert.deepEqual(adapter.toolDefinitions('DISCOVERY').at(-1).inputSchema.properties.role.enum, ['DISCOVERY_HELPER', 'BUILDER_HELPER']);
  assert.deepEqual(names('DISCOVERY_HELPER'), ['toolkit_read', 'toolkit_search']);
  assert.deepEqual(names('BUILDER_HELPER'), ['toolkit_read', 'toolkit_search', 'toolkit_apply_patch', 'toolkit_validate']);
  assert.deepEqual(names('REVIEW_SCOPE'), ['toolkit_read', 'toolkit_search']);
  assert.deepEqual(names('REVIEW_EXECUTION'), ['toolkit_read', 'toolkit_search']);
});

test('launcher leaves tier to the controller and accepts exact model and effort without a worker tier receipt', () => {
  const root = path.resolve(__dirname, '../..');
  const qualificationInput = {
    thread_start: { model: 'ignored', modelProvider: 'openai', cwd: root, approvalPolicy: 'never', sandbox: 'read-only', config: {} },
    turn_start: { model: 'ignored', effort: 'high', cwd: root, approvalPolicy: 'never', sandboxPolicy: {} },
    binding: { qualification_digest: 'a'.repeat(64) }
  };
  function request(model, reasoning, role) {
    const route = { provider: 'openai', model, reasoning };
    const snapshot = { decision_digest: 'b'.repeat(64), decision: { selection: { routes: { [role]: route } } } };
    const input = JSON.parse(JSON.stringify(qualificationInput));
    input.thread_start.model = model;
    input.thread_start.config.model_reasoning_effort = reasoning;
    input.turn_start.model = model;
    input.turn_start.effort = reasoning;
    return adapter.buildNativeRequest(snapshot, input, role, 'bounded test');
  }
  assert.equal(Object.hasOwn(request('gpt-6.1-sol', 'high', 'BUILDER').thread_start, 'serviceTier'), false);
  assert.equal(Object.hasOwn(request('gpt-6-luna', 'max', 'BUILDER_HELPER').thread_start, 'serviceTier'), false);
  assert.equal(Object.hasOwn(request('gpt-6-astra', 'high', 'REVIEW_EXECUTION').thread_start, 'serviceTier'), false);

  const route = { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'high' };
  const resolved = { model: route.model, modelProvider: route.provider, reasoningEffort: route.reasoning,
    cwd: root, approvalPolicy: 'never', sandbox: { type: 'readOnly' }, instructionSources: [path.join(root, 'AGENTS.md')] };
  const proof = { resolved_thread: resolved };
  const noTierReceipt = { ...resolved, thread: { id: 'no-tier-receipt' } };
  assert.equal(adapter.validateResolvedThread(noTierReceipt, proof, route, root).thread, 'no-tier-receipt');
  assert.throws(() => adapter.validateResolvedThread({ ...noTierReceipt, reasoningEffort: 'max' }, proof, route, root));
  assert.throws(() => adapter.validateResolvedThread({ ...noTierReceipt, model: 'gpt-6-luna' }, proof, route, root));
});
