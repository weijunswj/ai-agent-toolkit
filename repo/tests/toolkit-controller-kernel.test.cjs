'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const kernel = require('../scripts/toolkit-controller-kernel.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const registry = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v1.json'),
  'utf8',
));
const revision = 'af14f91b0f6335212003a37a5119f233489e598f';

test('stack registry removes global defaults and service-tier routing fields', () => {
  const checked = kernel.validateRegistry(registry);
  assert.equal(checked.ok, true, checked.code);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, 'default_stack'), false);
  assert.deepEqual(Object.keys(registry.stacks).sort(), ['owner-claude', 'owner-openai']);
  for (const stack of Object.values(registry.stacks)) {
    for (const route of Object.values(stack.routes)) {
      assert.deepEqual(Object.keys(route).sort(), ['model', 'provider', 'reasoning']);
      assert.equal(Object.prototype.hasOwnProperty.call(route, 'tier'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(route, 'priority'), false);
    }
  }
});

test('explicit stack selection wins over a verified harness policy', () => {
  const resolved = kernel.resolveRoute({
    stage: 'G3',
    selected_stack: 'owner-openai',
    harness_identity: { name: 'claude-code', verified: true, source: 'hook' },
    registry_revision: revision,
    route_available: true,
  });
  assert.equal(resolved.ok, true, resolved.code);
  assert.equal(resolved.stack_id, 'owner-openai');
  assert.equal(resolved.selection_source, 'explicit_web_binding');
  assert.deepEqual(resolved.route, {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    reasoning: 'max',
  });
  assert.equal(resolved.binding.registry_identity.revision, revision);
  assert.equal(resolved.binding.repair_budget_consumed, false);
});

test('route resolution requires live capability and a verified registry identity', () => {
  const noCapability = kernel.resolveRoute({
    stage: 'G3', selected_stack: 'owner-openai', registry_revision: revision,
  });
  assert.equal(noCapability.ok, false);
  assert.equal(noCapability.decision.reason_code, 'ROUTE_CAPABILITY_UNVERIFIED');

  const noRevision = kernel.resolveRoute({
    stage: 'G3', selected_stack: 'owner-openai', route_available: true,
  });
  assert.equal(noRevision.ok, false);
  assert.equal(noRevision.decision.reason_code, 'REGISTRY_IDENTITY_UNAVAILABLE');

  const workspace = kernel.resolveRoute({
    stage: 'G3', selected_stack: 'owner-openai', route_available: true, registry_revision: 'workspace',
  });
  assert.equal(workspace.ok, false);
  assert.equal(workspace.decision.reason_code, 'REGISTRY_IDENTITY_UNAVAILABLE');

  const resolved = kernel.resolveRoute({
    stage: 'G3', selected_stack: 'owner-openai', route_available: true, registry_revision: revision,
  });
  assert.equal(resolved.ok, true, resolved.code);
  const tampered = structuredClone(resolved.binding);
  tampered.route = { provider: 'anthropic', model: 'claude-opus-5', reasoning: 'max' };
  tampered.route_digest = kernel.digestValue(tampered.route);
  assert.equal(kernel.validateRouteBinding(tampered).code, 'ROUTE_BINDING_ROUTE_MISMATCH');
});

test('verified harness policy maps only the owner harnesses and unknown is a decision hold', () => {
  const claude = kernel.resolveRoute({
    stage: 'G1',
    harness_identity: { name: 'claude-code', verified: true, source: 'runtime' },
    registry_revision: revision,
    route_available: true,
  });
  assert.equal(claude.ok, true, claude.code);
  assert.equal(claude.stack_id, 'owner-claude');
  assert.equal(claude.selection_source, 'verified_harness_policy');
  assert.deepEqual(claude.route, { provider: 'anthropic', model: 'claude-opus-5', reasoning: 'xhigh' });

  for (const name of ['codex', 'opencode']) {
    const openai = kernel.resolveRoute({
      stage: 'G3',
      harness_identity: { name, verified: true, source: 'adapter' },
      registry_revision: revision,
      route_available: true,
    });
    assert.equal(openai.ok, true, `${name}: ${openai.code}`);
    assert.equal(openai.stack_id, 'owner-openai');
  }

  const unknown = kernel.resolveRoute({
    stage: 'G3',
    harness_identity: { name: 'unknown', verified: false, source: 'unavailable' },
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'USER_DECISION_REQUIRED');
  assert.equal(unknown.decision.repair_budget_consumed, false);
});

test('Claude route matrix is exact and unavailable routes do not substitute or consume repair', () => {
  const claude = registry.stacks['owner-claude'].routes;
  for (const stage of ['G0', 'G3', 'LOOP', 'BROWSER']) assert.equal(claude[stage].reasoning, 'high', stage);
  for (const stage of ['G1', 'G2', 'G4']) assert.equal(claude[stage].reasoning, 'xhigh', stage);
  assert.equal(claude.FINAL_AUDIT.reasoning, 'max');
  for (const route of Object.values(claude)) {
    assert.equal(route.provider, 'anthropic');
    assert.equal(route.model, 'claude-opus-5');
  }

  const unavailable = kernel.resolveRoute({
    stage: 'G3',
    selected_stack: 'owner-openai',
    route_available: false,
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'ROUTE_UNAVAILABLE');
  assert.equal(unavailable.decision.reason_code, 'REQUESTED_ROUTE_UNAVAILABLE');
  assert.equal(unavailable.decision.repair_budget_consumed, false);

  const noSubstitution = kernel.resolveRoute({
    stage: 'G3',
    selected_stack: 'owner-openai',
    available_routes: ['openai/gpt-6-astra/high'],
    registry_revision: revision,
  });
  assert.equal(noSubstitution.ok, false);
  assert.equal(noSubstitution.code, 'ROUTE_UNAVAILABLE');
});

test('pre-A2 execution is direct Web to executor and Loop is conditional', () => {
  const direct = kernel.planExecution({ stage: 'G3', selected_stack: 'owner-openai', registry_revision: revision, route_available: true });
  assert.equal(direct.ok, true, direct.code);
  assert.equal(direct.plan.execution_path, 'direct-web-executor');
  assert.equal(direct.plan.loop_invoked, false);
  assert.equal(direct.plan.web_reconciliation_required, true);

  const afterA2 = kernel.planExecution({ stage: 'G3', selected_stack: 'owner-openai', a2_accepted: true, registry_revision: revision, route_available: true });
  assert.equal(afterA2.ok, true, afterA2.code);
  assert.equal(afterA2.plan.execution_path, 'accepted-a2-loop-reconciliation');
  assert.equal(afterA2.plan.loop_invoked, false);

  const blockedLoop = kernel.resolveRoute({ stage: 'LOOP', selected_stack: 'owner-openai' });
  assert.equal(blockedLoop.ok, false);
  assert.equal(blockedLoop.code, 'ROUTE_UNAVAILABLE');
  assert.equal(blockedLoop.decision.reason_code, 'A2_NOT_ACCEPTED');
});

test('cross-user overlap is read-only until handover or authorised concurrency', () => {
  const owner = { user: 'alice', controller: 'web-a' };
  const otherUser = kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit',
    requester: { user: 'bob', controller: 'web-b' },
    current_owner: owner,
    active_overlap: true,
  });
  assert.equal(otherUser.ok, false);
  assert.equal(otherUser.code, 'READ_ONLY');
  assert.equal(otherUser.decision.mutation_allowed, false);
  assert.equal(otherUser.decision.reason_code, 'CROSS_USER_OWNERSHIP_BLOCKED');

  const sameUserDifferentController = kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit',
    requester: { user: 'alice', controller: 'web-c' },
    current_owner: owner,
    active_overlap: true,
  });
  assert.equal(sameUserDifferentController.code, 'USER_DECISION_REQUIRED');

  const handover = kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit',
    requester: { user: 'bob', controller: 'web-b' },
    current_owner: owner,
    active_overlap: true,
    handover: { authorised: true, from: owner, to: { user: 'bob', controller: 'web-b' } },
  });
  assert.equal(handover.ok, true);
  assert.equal(handover.code, 'HANDOVER_AUTHORISED');

  const concurrency = kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit',
    requester: { user: 'bob', controller: 'web-b' },
    current_owner: owner,
    active_overlap: true,
    authorised_concurrency: true,
  });
  assert.equal(concurrency.ok, true);
  assert.equal(concurrency.code, 'CONCURRENCY_AUTHORISED');

  const replacement = kernel.replaceExecutorOwnership({ owner });
  assert.equal(replacement.ok, true);
  assert.deepEqual(replacement.owner, owner);
  assert.equal(replacement.ownership_transferred, false);
});

test('active overlap without a verifiable owner requires a user decision', () => {
  const missingOwner = kernel.admitOwnership({
    repository: 'weijunswj/ai-agent-toolkit',
    requester: { user: 'bob', controller: 'web-b' },
    active_overlap: true,
  });
  assert.equal(missingOwner.ok, false);
  assert.equal(missingOwner.code, 'USER_DECISION_REQUIRED');
  assert.equal(missingOwner.decision.mutation_allowed, false);
  assert.equal(missingOwner.decision.reason_code, 'ACTIVE_OVERLAP_OWNER_UNAVAILABLE');
});

test('repository fence denies cross-repository mutation while permitting read evidence', () => {
  const fence = kernel.bindRepositoryFence({ repository: 'weijunswj/ai-agent-toolkit', controller_mode: 'OWNER' });
  assert.equal(fence.ok, true, fence.code);
  assert.equal(kernel.validateRepositoryFence(fence.fence).ok, true);

  const crossWrite = kernel.admitRepositoryMutation({
    fence: fence.fence,
    target_repository: 'weijunswj/sqag',
    mutation_authorised: true,
  });
  assert.equal(crossWrite.ok, false);
  assert.equal(crossWrite.code, 'CROSS_REPOSITORY_MUTATION_DENIED');

  const crossRead = kernel.admitRepositoryMutation({
    fence: fence.fence,
    target_repository: 'weijunswj/sqag',
    operation: 'read',
  });
  assert.equal(crossRead.ok, true);
  assert.equal(crossRead.code, 'CROSS_REPOSITORY_READ_ALLOWED');
  assert.equal(crossRead.decision.mutation_allowed, false);
});

test('observer mutation is denied and timeout cannot self-promote', () => {
  const observer = kernel.bindRepositoryFence({ repository: 'weijunswj/sqag', controller_mode: 'OBSERVER' });
  assert.equal(observer.ok, true, observer.code);
  const denied = kernel.admitRepositoryMutation({
    fence: observer.fence,
    target_repository: 'weijunswj/sqag',
    mutation_authorised: true,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'OBSERVER_MUTATION_DENIED');

  const timeoutTakeover = kernel.admitRepositoryMutation({
    fence: observer.fence,
    target_repository: 'weijunswj/sqag',
    takeover: true,
    timeout: true,
    mutation_authorised: true,
  });
  assert.equal(timeoutTakeover.ok, false);
  assert.equal(timeoutTakeover.code, 'TAKEOVER_AUTHORITY_REQUIRED');
});

test('explicit takeover requires prior reconciliation and then still requires mutation authority', () => {
  const observer = kernel.bindRepositoryFence({ repository: 'weijunswj/ai-agent-toolkit', controller_mode: 'OBSERVER' });
  const notReconciled = kernel.admitRepositoryMutation({
    fence: observer.fence,
    target_repository: 'weijunswj/ai-agent-toolkit',
    takeover: true,
    explicit_user_web_authority: true,
    mutation_authorised: true,
  });
  assert.equal(notReconciled.ok, false);
  assert.equal(notReconciled.code, 'PRIOR_CONTROLLER_RECONCILIATION_REQUIRED');

  const admitted = kernel.admitRepositoryMutation({
    fence: observer.fence,
    target_repository: 'weijunswj/ai-agent-toolkit',
    takeover: true,
    explicit_user_web_authority: true,
    prior_state_reconciled: true,
    mutation_authorised: true,
  });
  assert.equal(admitted.ok, true, admitted.code);
  assert.equal(admitted.controller_mode, 'OWNER');
  assert.equal(admitted.rebound, true);
});
