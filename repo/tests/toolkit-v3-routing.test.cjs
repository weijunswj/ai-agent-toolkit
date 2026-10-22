'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const { capturedStack } = require('./support/captured-stack-fixture.cjs');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/controller-kernel/stack-registry-v3.json'), 'utf8'));
const qualification = (status) => Object.fromEntries(compiler.CHEAP_QUALIFIERS.map(key => [key, { status, source: null }]));

test('builder qualifiers never downgrade a lead: every route comes from the selected registry profile', () => {
  for (const id of Object.keys(registry.profiles)) {
    for (const status of ['POSITIVE', 'UNKNOWN', 'NEGATIVE']) {
      const resolved = compiler.resolveContinuousProfile(id, qualification(status), capturedStack(id).snapshot);
      assert.deepEqual(resolved.routes, registry.profiles[id].routes, `${id} ${status}`);
      assert.deepEqual(resolved.reviewers, registry.profiles[id].reviewers, `${id} ${status}`);
    }
  }
});

test('the current registry gives each helper role its own route and G2 reviewers no helper route', () => {
  for (const [id, profile] of Object.entries(registry.profiles)) {
    assert.deepEqual(Object.keys(profile.routes).sort(), ['BUILDER', 'BUILDER_HELPER', 'DESIGN_CHALLENGE', 'DISCOVERY', 'DISCOVERY_HELPER'], id);
    for (const member of profile.reviewers) assert.deepEqual(Object.keys(member).sort(), ['model', 'provider', 'reasoning', 'reviewer_id'], id);
  }
  assert.deepEqual(Object.keys(registry.profiles).sort(), ['owner-claude', 'owner-gpt']);
});
