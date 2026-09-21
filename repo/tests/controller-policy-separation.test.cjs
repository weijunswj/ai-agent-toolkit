'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const controller = fs.readFileSync(path.join(repoRoot, 'repo', 'CONTROLLER.md'), 'utf8');
const architecture = fs.readFileSync(path.join(repoRoot, 'repo', 'ARCHITECTURE.md'), 'utf8');
const registry = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v2.json'),
  'utf8'
));

const requiredStages = ['G0-A', 'G0-B', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'RECONVERGENCE', 'FINAL_AUDIT', 'BROWSER'];

test('controller stage policy is provider/model agnostic', () => {
  assert.match(controller, /## Stage and stack routing/);
  assert.match(controller, /Concrete provider\/model\/reasoning choices live in the cold stack registry/);
  for (const stack of Object.values(registry.stacks)) {
    for (const route of Object.values(stack.routes)) {
      assert.equal(controller.includes(route.model), false, `model leaked into Controller law: ${route.model}`);
      assert.equal(architecture.includes(route.model), false, `model leaked into Architecture law: ${route.model}`);
    }
    for (const route of Object.values(stack.subagents)) {
      if (route) {
        assert.equal(controller.includes(route.model), false, `subagent model leaked into Controller law: ${route.model}`);
        assert.equal(architecture.includes(route.model), false, `subagent model leaked into Architecture law: ${route.model}`);
      }
    }
  }
});

test('stack registry has explicit complete symbolic routes and only G0-B/G3 subagent bindings', () => {
  assert.equal(registry.schema, 'toolkit.controller.stack-registry.v2');
  assert.equal(registry.version, 2);
  for (const [stackId, stack] of Object.entries(registry.stacks)) {
    assert.deepEqual(Object.keys(stack.routes).sort(), [...requiredStages].sort(), stackId);
    assert.deepEqual(Object.keys(stack.subagents).sort(), ['G0-B', 'G3'], stackId);
    for (const route of Object.values(stack.routes)) {
      assert.equal(typeof route.provider, 'string');
      assert.ok(route.provider.length > 0);
      assert.equal(typeof route.model, 'string');
      assert.ok(route.model.length > 0);
      assert.equal(typeof route.reasoning, 'string');
      assert.ok(route.reasoning.length > 0);
    }
  }
});

test('named stacks support explicit cross-harness selection without harness authority', () => {
  for (const stackId of ['owner-openai-default', 'owner-claude']) {
    assert.ok(registry.stacks[stackId], `missing named stack: ${stackId}`);
  }
  assert.equal(Object.hasOwn(registry.stacks, 'owner-deepseek'), false);
  assert.equal(Object.hasOwn(registry.stacks, 'owner-mixed-openai-deepseek'), false);
  assert.match(controller, /Stack selection is an explicit User\/Web execution decision and is independent of the physical harness/);
  assert.match(controller, /HARNESS_HANDOFF_REQUIRED/);
  assert.match(controller, /Subagent prompts name the semantic role\/capability, not a concrete model/i);
  assert.match(architecture, /Stack selection and physical harness selection are orthogonal/);
  assert.match(architecture, /logical lane may hand off between qualified harnesses/);
});

test('Claude stack mirrors current OpenAI role classes without leaking model names into policy', () => {
  const claude = registry.stacks['owner-claude'];
  assert.equal(new Set(Object.values(claude.routes).map((route) => route.model)).size, 1);
  assert.equal(claude.routes['G0-A'].reasoning, 'high');
  assert.equal(claude.routes['G0-B'].reasoning, 'medium');
  assert.equal(claude.routes.G1.reasoning, 'high');
  assert.equal(registry.stacks['owner-openai-default'].routes.G2.reasoning, 'medium');
  assert.equal(claude.routes.G2.reasoning, 'xhigh');
  assert.equal(claude.routes.G3.reasoning, 'medium');
  assert.equal(claude.routes.G4.reasoning, 'medium');
  assert.equal(claude.routes.LOOP.reasoning, 'medium');
  assert.equal(claude.routes.RECONVERGENCE.reasoning, 'high');
  assert.equal(claude.routes.FINAL_AUDIT.reasoning, 'max');
  assert.equal(claude.routes.BROWSER.reasoning, 'xhigh');
  assert.equal(claude.subagents['G0-B'].reasoning, 'medium');
  assert.equal(claude.subagents.G3.reasoning, 'medium');
});

test('delegation capability is stage law, not model law', () => {
  assert.match(controller, /G0-B.*G3.*only subagent-capable stages\/roles/s);
  assert.match(controller, /Concrete parent\/child provider\/model\/reasoning bindings come from the explicitly selected stack registry/);
  assert.match(architecture, /Only G0-B and G3 may use semantic depth-1 subagents/);
});

test('github presentation mechanics stay in renderer automation, not Controller law', () => {
  for (const presentationToken of ['[ PARENT THREAD ]', 'delivery-child', 'deferred-child']) {
    assert.equal(controller.includes(presentationToken), false, `presentation token leaked into Controller law: ${presentationToken}`);
  }
  assert.match(controller, /authorised renderer\/schema owns concrete presentation mechanics/);
  assert.match(architecture, /Presentation structure, title prefixes, display ordering\/numbering and wording conventions belong to the authorised renderer\/schema/);
});

test('stack registry has no default stack or authoritative service tier', () => {
  assert.equal(Object.hasOwn(registry, 'default_stack'), false);
  for (const stack of Object.values(registry.stacks)) {
    for (const route of [...Object.values(stack.routes), ...Object.values(stack.subagents)]) {
      if (route) assert.equal(Object.hasOwn(route, 'tier'), false);
    }
  }
});

test('convergence-first roles are represented without widening delegation', () => {
  assert.match(controller, /G0-A.*problem framing/s);
  assert.match(controller, /G2.*adversarial executable-contract closure/s);
  assert.match(controller, /RECONVERGENCE.*read-only.*not a gate/s);
  assert.match(architecture, /Reconverged correction exception/);
});
