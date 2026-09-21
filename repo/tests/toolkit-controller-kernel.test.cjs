'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');

const kernel = require('../scripts/toolkit-controller-kernel.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const registry = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v2.json'),
  'utf8',
));
const routerSchema = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'contract-router-v2.schema.json'),
  'utf8',
));
const revision = 'af14f91b0f6335212003a37a5119f233489e598f';
const stack = 'owner-openai-default';

function routeOptions(overrides = {}) {
  return {
    stage: 'G3',
    selected_stack: stack,
    registry_revision: revision,
    route_available: true,
    ...overrides,
  };
}

function validBindingOptions(binding, overrides = {}) {
  return {
    current_registry_revision: revision,
    current_registry_digest: binding.registry_identity.digest,
    stage: binding.stage,
    thread_id: binding.thread_id,
    selected_stack: stack,
    a2_accepted: binding.a2_status === 'accepted',
    route_available: true,
    ...overrides,
  };
}

test('v2 registry is canonical, exact, and free of default or service-tier authority', () => {
  const checked = kernel.validateRegistry(registry);
  assert.equal(checked.ok, true, checked.code);
  assert.equal(registry.schema, 'toolkit.controller.stack-registry.v2');
  assert.deepEqual(Object.keys(registry.stacks).sort(), ['owner-claude', stack].sort());
  assert.deepEqual(kernel.STAGES, ['G0-A', 'G0-B', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'RECONVERGENCE', 'FINAL_AUDIT', 'BROWSER']);
  assert.deepEqual(Object.keys(registry.stacks[stack].subagents).sort(), ['G0-B', 'G3']);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, 'default_stack'), false);
  for (const route of [...Object.values(registry.stacks[stack].routes), ...Object.values(registry.stacks[stack].subagents)]) {
    if (route === null) continue;
    assert.deepEqual(Object.keys(route).sort(), ['model', 'provider', 'reasoning']);
    assert.equal(Object.prototype.hasOwnProperty.call(route, 'tier'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(route, 'priority'), false);
  }
  const oldRegistry = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v1.json'),
    'utf8',
  ));
  assert.equal(kernel.validateRegistry(oldRegistry).ok, false);
});

test('explicit trusted selected stack is required and harness context cannot select a stack', () => {
  const resolved = kernel.resolveRoute(routeOptions({
    harness_identity: { name: 'claude-code', verified: true, source: 'hook' },
  }));
  assert.equal(resolved.ok, true, resolved.code);
  assert.equal(resolved.stack_id, stack);
  assert.equal(resolved.selection_source, 'explicit_trusted_stack');
  assert.deepEqual(resolved.route, {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    reasoning: 'max',
  });
  assert.equal(resolved.binding.schema, 'toolkit.controller.route-binding.v2');
  assert.equal(resolved.binding.version, 2);

  const harnessOnly = kernel.resolveRoute({
    stage: 'G3',
    harness_identity: { name: 'codex', verified: true, source: 'runtime' },
    registry_revision: revision,
    route_available: true,
  });
  assert.equal(harnessOnly.ok, false);
  assert.equal(harnessOnly.code, 'ROUTE_UNAVAILABLE');
  assert.equal(harnessOnly.decision.reason_code, 'SELECTED_STACK_REQUIRED');

  const oldStack = kernel.resolveRoute(routeOptions({ selected_stack: 'owner-openai' }));
  assert.equal(oldStack.ok, false);
  assert.equal(oldStack.decision.reason_code, 'SELECTED_STACK_UNAVAILABLE');

  const tierAuthority = structuredClone(registry);
  tierAuthority.stacks[stack].routes.G3.tier = 'max';
  assert.equal(kernel.validateRegistry(tierAuthority).ok, false);
});

test('route resolution uses exact roles and only permits semantic subagents at G0-B and G3', () => {
  const semantic = kernel.resolveRoute(routeOptions({ stage: 'G0-B', semantic_subagent: true }));
  assert.equal(semantic.ok, true, semantic.code);
  assert.deepEqual(semantic.route, registry.stacks[stack].subagents['G0-B']);

  const unsupported = kernel.resolveRoute(routeOptions({ stage: 'G1', semantic_subagent: true }));
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.decision.reason_code, 'SEMANTIC_SUBAGENT_ROLE_UNSUPPORTED');

  const unknown = kernel.resolveRoute(routeOptions({ stage: 'g3' }));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.decision.reason_code, 'STAGE_UNAVAILABLE');

  const unavailable = kernel.resolveRoute(routeOptions({ route_available: false }));
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.decision.reason_code, 'REQUESTED_ROUTE_UNAVAILABLE');
  assert.equal(unavailable.decision.repair_budget_consumed, false);
});

test('route capability, registry identity, and A2 evidence fail closed without substitution', () => {
  assert.equal(kernel.resolveRoute(routeOptions({ route_available: undefined })).decision.reason_code, 'ROUTE_CAPABILITY_UNVERIFIED');
  assert.equal(kernel.resolveRoute({ ...routeOptions(), registry_revision: undefined }).decision.reason_code, 'REGISTRY_IDENTITY_UNAVAILABLE');
  assert.equal(kernel.resolveRoute(routeOptions({ registry_revision: 'workspace' })).decision.reason_code, 'REGISTRY_IDENTITY_UNAVAILABLE');
  assert.equal(kernel.resolveRoute(routeOptions({ available_routes: ['openai/gpt-6-astra/high'], route_available: undefined })).ok, false);
  const invalidA2 = kernel.resolveRoute(routeOptions({ a2_accepted: 'true' }));
  assert.equal(invalidA2.ok, false);
  assert.equal(invalidA2.decision.reason_code, 'A2_EVIDENCE_INVALID');

  const direct = kernel.resolveRoute(routeOptions({ thread_id: 'thread-direct' }));
  assert.equal(direct.ok, true, direct.code);
  const loopWithoutA2 = kernel.resolveRoute(routeOptions({ stage: 'LOOP' }));
  assert.equal(loopWithoutA2.ok, false);
  assert.equal(loopWithoutA2.decision.reason_code, 'A2_NOT_ACCEPTED');
  const loop = kernel.resolveRoute(routeOptions({ stage: 'LOOP', a2_accepted: true, thread_id: 'thread-loop' }));
  assert.equal(loop.ok, true, loop.code);
  assert.equal(loop.binding.execution_path, 'accepted-a2-loop-reconciliation');
});

test('stored v2 route bindings preserve exact selection, identity, capability, and A2 provenance', () => {
  const resolved = kernel.resolveRoute(routeOptions({ thread_id: 'thread-binding-proof' }));
  assert.equal(resolved.ok, true, resolved.code);
  const valid = validBindingOptions(resolved.binding);
  assert.equal(kernel.validateRouteBinding(resolved.binding, valid).code, 'ROUTE_BINDING_VALID');
  for (const mutation of [
    { current_registry_revision: 'stale-revision' },
    { current_registry_digest: '0'.repeat(64) },
    { stage: 'G4' },
    { thread_id: 'other-thread' },
    { a2_accepted: true },
    { route_available: false },
    { selected_stack: 'other-stack' },
  ]) {
    const checked = kernel.validateRouteBinding(resolved.binding, { ...valid, ...mutation });
    assert.equal(checked.ok, false, JSON.stringify(mutation));
    assert.equal(checked.code, 'ROUTE_UNAVAILABLE');
    assert.equal(checked.repair_budget_consumed, false);
  }

  const v1 = structuredClone(resolved.binding);
  v1.schema = 'toolkit.controller.route-binding.v1';
  v1.version = 1;
  v1.selection_source = 'explicit_web_binding';
  assert.equal(kernel.validateRouteBinding(v1, valid).reason_code, 'STORED_ROUTE_BINDING_INVALID');

  const tampered = structuredClone(resolved.binding);
  tampered.route = { provider: 'anthropic', model: 'claude-opus-5', reasoning: 'max' };
  tampered.route_digest = kernel.digestValue(tampered.route);
  assert.equal(kernel.validateRouteBinding(tampered, valid).reason_code, 'STORED_ROUTE_REGISTERED_ROUTE_MISMATCH');
});

test('route and binding descriptor boundaries reject accessors before authority reads', () => {
  let routeGetterRuns = 0;
  const routeInput = { stage: 'G3', registry_revision: revision, route_available: true };
  Object.defineProperty(routeInput, 'selected_stack', {
    enumerable: true,
    get() { routeGetterRuns += 1; return stack; },
  });
  const routeChecked = kernel.resolveRoute(routeInput);
  assert.equal(routeChecked.ok, false);
  assert.equal(routeChecked.decision.reason_code, 'ROUTE_INPUT_DESCRIPTOR_INVALID');
  assert.equal(routeGetterRuns, 0);

  const resolved = kernel.resolveRoute(routeOptions({ thread_id: 'thread-accessor' }));
  assert.equal(resolved.ok, true, resolved.code);
  let bindingGetterRuns = 0;
  const planInput = routeOptions();
  Object.defineProperty(planInput, 'binding', {
    enumerable: true,
    get() { bindingGetterRuns += 1; return resolved.binding; },
  });
  const planChecked = kernel.planExecution(planInput);
  assert.equal(planChecked.ok, false);
  assert.equal(planChecked.reason_code, 'STORED_ROUTE_BINDING_INVALID');
  assert.equal(bindingGetterRuns, 0);

  const availableRoutes = ['openai/gpt-5.6-luna/max'];
  let availableRouteGetterRuns = 0;
  Object.defineProperty(availableRoutes, '0', {
    enumerable: true,
    get() { availableRouteGetterRuns += 1; return 'openai/gpt-5.6-luna/max'; },
  });
  const availableRouteOptions = routeOptions({ available_routes: availableRoutes });
  delete availableRouteOptions.route_available;
  const availableRouteChecked = kernel.resolveRoute(availableRouteOptions);
  assert.equal(availableRouteChecked.ok, false);
  assert.equal(availableRouteGetterRuns, 0);

  const revoked = Proxy.revocable(routeOptions(), {});
  revoked.revoke();
  assert.doesNotThrow(() => kernel.resolveRoute(revoked.proxy));
  assert.equal(kernel.resolveRoute(revoked.proxy).ok, false);
});

test('execution plan is v2 and preserves direct versus accepted-A2 paths', () => {
  const direct = kernel.planExecution(routeOptions({ thread_id: 'thread-plan-direct' }));
  assert.equal(direct.ok, true, direct.code);
  assert.equal(direct.plan.schema, 'toolkit.controller.execution-plan.v2');
  assert.equal(direct.plan.version, 2);
  assert.equal(direct.plan.execution_path, 'direct-web-executor');
  assert.equal(direct.plan.loop_invoked, false);
  assert.equal(direct.plan.web_reconciliation_required, true);

  const accepted = kernel.planExecution(routeOptions({ a2_accepted: true, thread_id: 'thread-plan-a2' }));
  assert.equal(accepted.ok, true, accepted.code);
  assert.equal(accepted.plan.execution_path, 'accepted-a2-loop-reconciliation');
});

test('v2 router schema validates generated binding, decision, and execution plan', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(routerSchema);
  const resolved = kernel.resolveRoute(routeOptions({ thread_id: 'thread-schema' }));
  assert.equal(resolved.ok, true, resolved.code);
  assert.equal(validate(resolved.binding), true, JSON.stringify(validate.errors));
  assert.equal(validate(kernel.resolveRoute({ stage: 'G3' }).decision), true, JSON.stringify(validate.errors));
  const plan = kernel.planExecution(routeOptions({ thread_id: 'thread-schema-plan' }));
  assert.equal(validate(plan.plan), true, JSON.stringify(validate.errors));
});

test('ownership remains read-only across users and does not self-promote on timeout', () => {
  const owner = { user: 'alice', controller: 'web-a' };
  const otherUser = kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit', requester: { user: 'bob', controller: 'web-b' },
    current_owner: owner, active_overlap: true,
  });
  assert.equal(otherUser.code, 'READ_ONLY');
  assert.equal(otherUser.decision.mutation_allowed, false);
  assert.equal(otherUser.decision.reason_code, 'CROSS_USER_OWNERSHIP_BLOCKED');
  assert.equal(kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit', requester: { user: 'alice', controller: 'web-c' },
    current_owner: owner, active_overlap: true,
  }).code, 'USER_DECISION_REQUIRED');
  assert.equal(kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit', requester: { user: 'bob', controller: 'web-b' },
    current_owner: owner, active_overlap: true,
    handover: { authorised: true, from: owner, to: { user: 'bob', controller: 'web-b' } },
  }).code, 'HANDOVER_AUTHORISED');
  assert.equal(kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit', requester: { user: 'bob', controller: 'web-b' },
    current_owner: owner, active_overlap: true, authorised_concurrency: true,
  }).code, 'CONCURRENCY_AUTHORISED');
  assert.equal(kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit', requester: { user: 'bob', controller: 'web-b' },
    active_overlap: true,
  }).code, 'USER_DECISION_REQUIRED');
});

test('repository fence denies cross-repository mutation and timeout takeover', () => {
  const fence = kernel.bindRepositoryFence({ repository: 'weijunswj/ai-agent-toolkit', controller_mode: 'OWNER' });
  assert.equal(fence.ok, true, fence.code);
  assert.equal(kernel.validateRepositoryFence(fence.fence).ok, true);
  assert.equal(kernel.admitRepositoryMutation({
    fence: fence.fence, target_repository: 'weijunswj/sqag', mutation_authorised: true,
  }).code, 'CROSS_REPOSITORY_MUTATION_DENIED');
  const crossRead = kernel.admitRepositoryMutation({ fence: fence.fence, target_repository: 'weijunswj/sqag', operation: 'read' });
  assert.equal(crossRead.code, 'CROSS_REPOSITORY_READ_ALLOWED');
  assert.equal(crossRead.decision.mutation_allowed, false);
  assert.equal(kernel.admitRepositoryMutation({
    fence: fence.fence, repository_fence: fence.fence,
    target_repository: 'weijunswj/ai-agent-toolkit', operation: 'read',
  }).code, 'REPOSITORY_FENCE_INVALID');

  const observer = kernel.bindRepositoryFence({ repository: 'weijunswj/sqag', controller_mode: 'OBSERVER' });
  assert.equal(kernel.admitRepositoryMutation({ fence: observer.fence, target_repository: 'weijunswj/sqag', mutation_authorised: true }).code, 'OBSERVER_MUTATION_DENIED');
  assert.equal(kernel.admitRepositoryMutation({
    fence: observer.fence, target_repository: 'weijunswj/sqag', takeover: true, timeout: true, mutation_authorised: true,
  }).code, 'TAKEOVER_AUTHORITY_REQUIRED');
  assert.equal(kernel.admitRepositoryMutation({
    fence: observer.fence, target_repository: 'weijunswj/sqag', takeover: true,
    explicit_user_web_authority: true, mutation_authorised: true,
  }).code, 'PRIOR_CONTROLLER_RECONCILIATION_REQUIRED');
  const rebound = kernel.admitRepositoryMutation({
    fence: observer.fence, target_repository: 'weijunswj/sqag', takeover: true,
    explicit_user_web_authority: true, prior_state_reconciled: true, mutation_authorised: true,
  });
  assert.equal(rebound.ok, true, rebound.code);
  assert.equal(rebound.controller_mode, 'OWNER');
  assert.equal(rebound.rebound, true);
});
