'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../scripts/toolkit-route-resolution.cjs');

function code(error) { return error && error.code; }

test('role registry resolves the frozen routes without host policy substitution', () => {
  const record = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'g3-root' });
  assert.equal(record.model, 'gpt-5.6-luna');
  assert.equal(record.reasoning, 'max');
  assert.equal(record.service_tier, 'standard');
  assert.equal(record.speed, 'priority');
  assert.equal(record.speed_source, 'registry-default');
  assert.throws(() => route.resolveRoleRoute({ role: 'g3', host: 'codex', model: 'gpt-6-astra' }), codeIs('ROUTE_SUBSTITUTION_FORBIDDEN'));
});

test('omitted depth-one child speed is Standard and never inherits root Priority', () => {
  const root = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'g3-root' });
  const child = route.resolveDepthOneLaunch({ role: 'loop-manager', host: 'codex', parent: root, launch_id: 'loop-child' });
  assert.equal(child.speed, 'standard');
  assert.equal(child.speed_source, 'child-default');
  assert.equal(child.parent_speed, 'priority');
  assert.equal(child.child_priority_authorized, false);
  assert.throws(() => route.resolveDepthOneLaunch({ role: 'loop-manager', host: 'codex', parent: root, speed: 'priority' }), codeIs('PRIORITY_CHILD_AUTHORITY_REQUIRED'));
});

test('the homogeneous G3 priority child requires explicit authority and tree digests', () => {
  const root = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'g3-root' });
  const child = route.resolveDepthOneLaunch({
    role: 'g3',
    host: 'codex',
    parent: root,
    launch_id: 'g3-child',
    speed: 'priority',
    priority_child_authority: {
      enabled: true,
      authority_digest: route.digestValue({ authority: 'g3-child' }),
      tree_digest: route.digestValue({ tree: 'g3-child' })
    }
  });
  assert.equal(child.speed, 'priority');
  assert.equal(child.child_priority_authorized, true);
  assert.match(child.child_authority_digest, /^[a-f0-9]{64}$/);
});

test('route resolution fails closed for nested children and unsupported hosts', () => {
  const root = route.resolveRoleRoute({ role: 'g1', host: 'codex', launch_id: 'g1-root' });
  assert.throws(() => route.resolveDepthOneLaunch({ role: 'g2', host: 'not-a-host', parent: root }), codeIs('ROUTE_UNAVAILABLE'));
  const child = route.resolveDepthOneLaunch({ role: 'g2', host: 'codex', parent: root, launch_id: 'g2-child' });
  assert.throws(() => route.resolveDepthOneLaunch({ role: 'g1', host: 'codex', parent: child }), codeIs('ROUTE_UNAVAILABLE'));
});

function codeIs(expected) {
  return (error) => {
    assert.equal(error.code, expected);
    return true;
  };
}
