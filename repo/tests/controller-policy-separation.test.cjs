'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const controller = fs.readFileSync(path.join(repoRoot, 'repo', 'CONTROLLER.md'), 'utf8');
const architecture = fs.readFileSync(path.join(repoRoot, 'repo', 'ARCHITECTURE.md'), 'utf8');
const registry = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v1.json'),
  'utf8'
));

const requiredStages = ['G0', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'FINAL_AUDIT', 'BROWSER'];

test('controller stage policy is provider/model agnostic', () => {
  assert.match(controller, /## Stage and stack routing/);
  assert.match(controller, /Concrete provider\/model\/reasoning choices live in the cold stack registry/);
  assert.match(controller, /authoritative requested route identity is `provider \+ model \+ reasoning`/i);
  assert.doesNotMatch(controller, /service-tier choices|service tier routing/i);
  for (const stack of Object.values(registry.stacks)) {
    for (const route of Object.values(stack.routes)) {
      assert.equal(controller.includes(route.model), false, `model leaked into Controller law: ${route.model}`);
    }
    for (const route of Object.values(stack.subagents)) {
      if (route) {
        assert.equal(controller.includes(route.model), false, `subagent model leaked into Controller law: ${route.model}`);
      }
    }
  }
});

test('stack registry has complete symbolic routes and only G0/G3 subagent bindings', () => {
  assert.equal(registry.schema, 'toolkit.controller.stack-registry.v1');
  assert.equal(registry.version, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, 'default_stack'), false);
  assert.deepEqual(Object.keys(registry.stacks).sort(), ['owner-claude', 'owner-openai']);
  for (const [stackId, stack] of Object.entries(registry.stacks)) {
    assert.deepEqual(Object.keys(stack.routes).sort(), [...requiredStages].sort(), stackId);
    assert.deepEqual(Object.keys(stack.subagents).sort(), ['G0', 'G3'], stackId);
    for (const route of Object.values(stack.routes)) {
      assert.equal(typeof route.provider, 'string');
      assert.ok(route.provider.length > 0);
      assert.equal(typeof route.model, 'string');
      assert.ok(route.model.length > 0);
      assert.equal(typeof route.reasoning, 'string');
      assert.ok(route.reasoning.length > 0);
      assert.equal(Object.prototype.hasOwnProperty.call(route, 'tier'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(route, 'priority'), false);
    }
  }
});

test('delegation capability is stage law, not model law', () => {
  assert.match(controller, /G0.*G3.*only subagent-capable stages/s);
  assert.match(controller, /Concrete parent\/child model, reasoning and route bindings come from the selected stack registry/);
  assert.match(architecture, /Only G0 and G3 may use semantic depth-1 subagents/);
});

test('stack registry contains the exact owner OpenAI and Claude routes', () => {
  const openai = registry.stacks['owner-openai'];
  const claude = registry.stacks['owner-claude'];
  assert.equal(openai.routes.G3.provider, 'openai');
  assert.equal(openai.routes.G3.model, 'gpt-5.6-luna');
  assert.equal(openai.routes.G3.reasoning, 'max');
  assert.equal(claude.routes.G1.model, 'claude-opus-5');
  assert.equal(claude.routes.G1.reasoning, 'xhigh');
  assert.equal(claude.routes.G2.reasoning, 'xhigh');
  assert.equal(claude.routes.G4.reasoning, 'xhigh');
  assert.equal(claude.routes.FINAL_AUDIT.reasoning, 'max');
  for (const stage of ['G0', 'G3', 'LOOP', 'BROWSER']) assert.equal(claude.routes[stage].reasoning, 'high');
});

test('github presentation mechanics stay in renderer automation, not Controller law', () => {
  for (const presentationToken of ['[ PARENT THREAD ]', 'delivery-child', 'deferred-child']) {
    assert.equal(controller.includes(presentationToken), false, `presentation token leaked into Controller law: ${presentationToken}`);
  }
  assert.match(controller, /authorised renderer\/schema owns concrete presentation mechanics/);
  assert.match(architecture, /Presentation structure, title prefixes, display ordering\/numbering and wording conventions belong to the authorised renderer\/schema/);
});
