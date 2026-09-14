'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../scripts/toolkit-route-resolution.cjs');

function code(error) { return error && error.code; }

const treeDigest = route.digestValue({ tree: 'delegated-test' });
const scopeDigest = route.digestValue({ scope: 'delegated-test' });

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
  const child = route.resolveDepthOneLaunch({ role: 'loop-manager', host: 'codex', parent: root, tree_digest: treeDigest, scope_digest: scopeDigest, launch_id: 'loop-child' });
  assert.equal(child.speed, 'standard');
  assert.equal(child.speed_source, 'child-default');
  assert.equal(child.parent_speed, 'priority');
  assert.equal(child.child_priority_authorized, false);
  assert.throws(() => route.resolveDepthOneLaunch({ role: 'loop-manager', host: 'codex', parent: root, tree_digest: treeDigest, scope_digest: scopeDigest, speed: 'priority' }), codeIs('PRIORITY_CHILD_AUTHORITY_REQUIRED'));
});

test('the homogeneous G3 priority child requires explicit authority and tree digests', () => {
  const root = route.resolveRoleRoute({ role: 'g3', host: 'codex', launch_id: 'g3-root' });
  const authorityDigest = route.digestValue({ authority: 'g3-child' });
  const priorityAuthority = route.createPriorityChildAuthority({
    authority_digest: authorityDigest,
    child_launch_id: 'g3-child',
    parent: root,
    tree_digest: treeDigest,
    scope_digest: scopeDigest,
    role: 'g3',
    host: 'codex'
  });
  const child = route.resolveDepthOneLaunch({
    role: 'g3',
    host: 'codex',
    parent: root,
    launch_id: 'g3-child',
    tree_digest: treeDigest,
    scope_digest: scopeDigest,
    speed: 'priority',
    priority_child_authority: priorityAuthority
  });
  assert.equal(child.speed, 'priority');
  assert.equal(child.child_priority_authorized, true);
  assert.match(child.child_authority_digest, /^[a-f0-9]{64}$/);
  for (const changed of [
    { child_launch_id: 'other-child' },
    { parent_launch_id: 'other-parent' },
    { scope_digest: route.digestValue({ scope: 'other' }) },
    { tree_digest: route.digestValue({ tree: 'other' }) },
    { role: 'recon' }
  ]) {
    assert.throws(() => route.resolveDepthOneLaunch({
      role: 'g3', host: 'codex', parent: root, launch_id: 'g3-child', tree_digest: treeDigest,
      scope_digest: scopeDigest, speed: 'priority', priority_child_authority: { ...priorityAuthority, ...changed }
    }), codeIs('PRIORITY_CHILD_AUTHORITY_REQUIRED'));
  }
});

test('route resolution fails closed for nested children and unsupported hosts', () => {
  const root = route.resolveRoleRoute({ role: 'g1', host: 'codex', launch_id: 'g1-root' });
  assert.throws(() => route.resolveDepthOneLaunch({ role: 'g2', host: 'not-a-host', parent: root }), codeIs('ROUTE_UNAVAILABLE'));
  const child = route.resolveDepthOneLaunch({ role: 'g2', host: 'codex', parent: root, tree_digest: treeDigest, scope_digest: scopeDigest, launch_id: 'g2-child' });
  assert.throws(() => route.resolveDepthOneLaunch({ role: 'g1', host: 'codex', parent: child, tree_digest: treeDigest, scope_digest: scopeDigest }), codeIs('ROUTE_UNAVAILABLE'));
});

function codeIs(expected) {
  return (error) => {
    assert.equal(error.code, expected);
    return true;
  };
}
