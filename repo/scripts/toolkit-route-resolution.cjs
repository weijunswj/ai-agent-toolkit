#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_VERSION = '2.11.1';
const CONTRACT_VERSION = 'toolkit.route-resolution.resolved-launch-record.v1';
const RECEIPT_CONTRACT_VERSION = 'toolkit.route-resolution.exact-launch-receipt.v1';
const REGISTRY_CONTRACT_VERSION = 'toolkit.route-resolution.role-registry.v1';
const HOSTS = Object.freeze(['codex', 'claude-code', 'opencode']);
const SPEEDS = Object.freeze(['standard', 'priority']);
const REASONING = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const REGISTRY_PATH = path.join(__dirname, '..', 'contracts', 'route-resolution', 'role-registry-v1.json');

class RouteResolutionError extends Error {
  constructor(code, evidence = {}) {
    super(code);
    this.name = 'RouteResolutionError';
    this.code = code;
    this.evidence = evidence;
  }
}

function fail(code, evidence = {}) {
  throw new RouteResolutionError(code, evidence);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '0' : String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${canonicalSerialize(key)}:${canonicalSerialize(value[key])}`).join(',')}}`;
  fail('ROUTE_REGISTRY_INVALID', { reason: 'non-canonical-value' });
}

function digestValue(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSafeId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !/[\0\r\n\t]/.test(value)
    && !value.includes('..')
    && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail('ROUTE_REGISTRY_INVALID', { reason: 'read-failed', message: error.message });
  }
}

function validateRoleRegistry(registry) {
  if (!exactKeys(registry, ['$schema', 'contract_version', 'schema_version', 'registry_id', 'registry_version', 'roles'])
    || registry.contract_version !== REGISTRY_CONTRACT_VERSION
    || registry.schema_version !== 1
    || typeof registry.$schema !== 'string'
    || !isSafeId(registry.registry_id)
    || !/^\d+\.\d+\.\d+$/.test(registry.registry_version)
    || !isRecord(registry.roles)
    || Object.keys(registry.roles).length === 0) {
    fail('ROUTE_REGISTRY_INVALID', { reason: 'shape' });
  }
  for (const [role, value] of Object.entries(registry.roles)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(role)
      || !exactKeys(value, ['provider', 'model', 'reasoning', 'service_tier', 'speed', 'allowed_hosts'])
      || value.provider !== 'openai'
      || !['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna'].includes(value.model)
      || !REASONING.includes(value.reasoning)
      || value.service_tier !== 'standard'
      || !SPEEDS.includes(value.speed)
      || !Array.isArray(value.allowed_hosts)
      || value.allowed_hosts.length === 0
      || new Set(value.allowed_hosts).size !== value.allowed_hosts.length
      || value.allowed_hosts.some((host) => !HOSTS.includes(host))) {
      fail('ROUTE_REGISTRY_INVALID', { reason: 'role', role });
    }
  }
  return deepFreeze(clone(registry));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function loadRoleRegistry(filePath = REGISTRY_PATH) {
  return validateRoleRegistry(readJson(filePath));
}

function roleRegistryDigest(registry = loadRoleRegistry()) {
  validateRoleRegistry(registry);
  return digestValue(registry);
}

function provided(input, field) {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function assertText(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) fail('ROUTE_METADATA_MISSING', { field });
}

function assertExactInput(input, definition, field, code = 'ROUTE_CONTRADICTION') {
  if (!provided(input, field)) return;
  assertText(input[field], field);
  if (input[field] !== definition[field]) fail(code, { field, expected: definition[field], observed: input[field] });
}

function priorityAuthority(input) {
  const nested = isRecord(input.priority_child_authority) ? input.priority_child_authority : {};
  const authorityDigest = nested.authority_digest || input.child_authority_digest || input.authority_digest || null;
  const treeDigest = nested.tree_digest || input.tree_override_digest || input.tree_digest || null;
  const enabled = nested.enabled === true || nested.allow === true || input.allow_priority_child === true;
  const accepted = nested.accepted === true;
  return { enabled, accepted, authorityDigest, treeDigest };
}

function validatePriorityAuthority(input) {
  const authority = priorityAuthority(input);
  if (!authority.enabled || !authority.accepted || !isDigest(authority.authorityDigest) || !isDigest(authority.treeDigest)) {
    fail('PRIORITY_CHILD_AUTHORITY_REQUIRED', { reason: 'explicit-authority-and-tree-override-required' });
  }
  return authority;
}

function parentRecord(input, registry) {
  if (!isRecord(input.parent)) return null;
  try { return validateResolvedLaunchRecord(input.parent, { registry }); } catch (error) {
    if (error instanceof RouteResolutionError) fail('ROUTE_CONTRADICTION', { reason: 'invalid-parent', parent_code: error.code });
    throw error;
  }
}

function resolveLaunchRecord(input = {}) {
  if (!isRecord(input)) fail('ROUTE_UNAVAILABLE', { reason: 'input-not-object' });
  const registry = input.registry || loadRoleRegistry(input.registry_path || REGISTRY_PATH);
  validateRoleRegistry(registry);
  const role = input.role || input.role_id;
  if (typeof role !== 'string' || !registry.roles[role]) fail('ROUTE_UNAVAILABLE', { reason: 'unknown-role', role: role || null });
  const definition = registry.roles[role];
  const host = input.host || input.host_adapter;
  if (!HOSTS.includes(host) || !definition.allowed_hosts.includes(host)) fail('ROUTE_UNAVAILABLE', { reason: 'unsupported-host', host: host || null, role });
  if (provided(input, 'backend') && input.backend !== host) fail('ROUTE_CONTRADICTION', { field: 'backend', expected: host, observed: input.backend });
  assertExactInput(input, definition, 'provider', 'ROUTE_SUBSTITUTION_FORBIDDEN');
  assertExactInput(input, definition, 'model', 'ROUTE_SUBSTITUTION_FORBIDDEN');
  assertExactInput(input, definition, 'reasoning', 'ROUTE_SUBSTITUTION_FORBIDDEN');
  assertExactInput(input, definition, 'service_tier', 'ROUTE_SUBSTITUTION_FORBIDDEN');
  const depth = input.depth === undefined ? 0 : input.depth;
  if (depth !== 0 && depth !== 1) fail('ROUTE_UNAVAILABLE', { reason: 'depth-out-of-bounds', depth });
  const parent = parentRecord(input, registry);
  if (depth === 1 && !parent) fail('ROUTE_UNAVAILABLE', { reason: 'parent-launch-required' });
  if (depth === 1 && parent && parent.depth !== 0) fail('ROUTE_UNAVAILABLE', { reason: 'nested-child-forbidden' });
  if (depth === 1 && parent && input.parent_launch_id && input.parent_launch_id !== parent.launch_id) {
    fail('ROUTE_CONTRADICTION', { field: 'parent_launch_id' });
  }
  if (depth === 1 && (!isDigest(input.tree_digest) || !isDigest(input.scope_digest))) {
    fail('ROUTE_METADATA_MISSING', { field: !isDigest(input.tree_digest) ? 'tree_digest' : 'scope_digest' });
  }
  if (depth === 0 && ((provided(input, 'tree_digest') && input.tree_digest !== null)
    || (provided(input, 'scope_digest') && input.scope_digest !== null))) {
    fail('ROUTE_CONTRADICTION', { reason: 'root-scope-metadata' });
  }
  const parentSpeed = parent ? parent.speed : (input.parent_speed === undefined ? null : input.parent_speed);
  if (parentSpeed !== null && !SPEEDS.includes(parentSpeed)) fail('ROUTE_METADATA_MISSING', { field: 'parent_speed' });
  let speed;
  let speedSource;
  let childPriorityAuthorized = false;
  let childAuthorityDigest = null;
  if (depth === 1) {
    if (provided(input, 'speed')) {
      if (!SPEEDS.includes(input.speed)) fail('ROUTE_METADATA_MISSING', { field: 'speed' });
      speed = input.speed;
      if (speed === 'priority') {
        if (!parent || parent.role !== 'g3' || parent.model !== 'gpt-5.6-luna' || parent.reasoning !== 'max'
          || definition.model !== 'gpt-5.6-luna' || definition.reasoning !== 'max') {
          fail('PRIORITY_CHILD_AUTHORITY_REQUIRED', { reason: 'non-homogeneous-g3-child' });
        }
        const authority = validatePriorityAuthority(input);
        if (authority.treeDigest !== input.tree_digest) {
          fail('PRIORITY_CHILD_AUTHORITY_REQUIRED', { reason: 'priority-tree-scope-mismatch' });
        }
        childPriorityAuthorized = true;
        childAuthorityDigest = authority.authorityDigest;
        speedSource = 'explicit-child-authority';
      } else {
        speedSource = 'explicit-child-authority';
      }
    } else {
      speed = 'standard';
      speedSource = 'child-default';
    }
  } else {
    if (provided(input, 'speed') && input.speed !== definition.speed) fail('ROUTE_CONTRADICTION', { field: 'speed', expected: definition.speed, observed: input.speed });
    speed = definition.speed;
    speedSource = 'registry-default';
  }
  if (depth === 1 && speed === 'priority' && parentSpeed === 'priority' && !childPriorityAuthorized) {
    fail('CHILD_SPEED_INHERITANCE_REJECTED', { reason: 'priority-was-not-explicitly-authorized' });
  }
  if (depth === 1 && speed === 'priority' && !childPriorityAuthorized) fail('PRIORITY_CHILD_AUTHORITY_REQUIRED');
  const launchId = input.launch_id || `launch-${digestValue({ role, host, depth, parent_launch_id: parent?.launch_id || null, speed, tree_digest: input.tree_digest || null, scope_digest: input.scope_digest || null }).slice(0, 24)}`;
  if (!isSafeId(launchId)) fail('ROUTE_METADATA_MISSING', { field: 'launch_id' });
  const base = {
    contract_version: CONTRACT_VERSION,
    record_version: 1,
    launch_id: launchId,
    role,
    provider: definition.provider,
    model: definition.model,
    reasoning: definition.reasoning,
    service_tier: definition.service_tier,
    speed,
    speed_source: speedSource,
    backend: host,
    host,
    depth,
    parent_launch_id: parent?.launch_id || input.parent_launch_id || null,
    parent_speed: parentSpeed,
    child_priority_authorized: childPriorityAuthorized,
    registry_version: registry.registry_version,
    registry_digest: digestValue(registry),
    child_authority_digest: childAuthorityDigest,
    tree_digest: depth === 1 ? input.tree_digest : null,
    scope_digest: depth === 1 ? input.scope_digest : null,
  };
  const record = { ...base, route_digest: digestValue(base) };
  return validateResolvedLaunchRecord(record, { registry });
}

function validateResolvedLaunchRecord(record, options = {}) {
  const keys = ['contract_version', 'record_version', 'launch_id', 'role', 'provider', 'model', 'reasoning', 'service_tier', 'speed', 'speed_source', 'backend', 'host', 'depth', 'parent_launch_id', 'parent_speed', 'child_priority_authorized', 'registry_version', 'registry_digest', 'child_authority_digest', 'tree_digest', 'scope_digest', 'route_digest'];
  if (!exactKeys(record, keys)
    || record.contract_version !== CONTRACT_VERSION
    || record.record_version !== 1
    || !isSafeId(record.launch_id)
    || !/^[a-z][a-z0-9-]{0,63}$/.test(record.role)
    || record.provider !== 'openai'
    || !['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna'].includes(record.model)
    || !REASONING.includes(record.reasoning)
    || record.service_tier !== 'standard'
    || !SPEEDS.includes(record.speed)
    || !['registry-default', 'child-default', 'explicit-child-authority'].includes(record.speed_source)
    || !HOSTS.includes(record.backend)
    || record.backend !== record.host
    || !HOSTS.includes(record.host)
    || (record.depth !== 0 && record.depth !== 1)
    || (record.parent_launch_id !== null && !isSafeId(record.parent_launch_id))
    || (record.parent_speed !== null && !SPEEDS.includes(record.parent_speed))
    || typeof record.child_priority_authorized !== 'boolean'
    || !/^\d+\.\d+\.\d+$/.test(record.registry_version)
    || !isDigest(record.registry_digest)
    || (record.child_authority_digest !== null && !isDigest(record.child_authority_digest))
    || (record.depth === 0 && (record.tree_digest !== null || record.scope_digest !== null))
    || (record.depth === 1 && (!isDigest(record.tree_digest) || !isDigest(record.scope_digest) || record.parent_launch_id === null))
    || (record.depth === 0 && record.parent_launch_id !== null)
    || !isDigest(record.route_digest)) {
    fail('ROUTE_CONTRADICTION', { reason: 'resolved-record-shape' });
  }
  const registry = validateRoleRegistry(options.registry || loadRoleRegistry());
  const definition = registry.roles[record.role];
  if (!definition
    || record.registry_version !== registry.registry_version
    || record.registry_digest !== digestValue(registry)
    || !definition.allowed_hosts.includes(record.host)
    || record.provider !== definition.provider
    || record.model !== definition.model
    || record.reasoning !== definition.reasoning
    || record.service_tier !== definition.service_tier) {
    fail('ROUTE_CONTRADICTION', { reason: 'registry-substitution', role: record.role });
  }
  if (record.depth === 0 && (record.speed !== definition.speed || record.speed_source !== 'registry-default')) {
    fail('ROUTE_CONTRADICTION', { reason: 'registry-speed-substitution', role: record.role });
  }
  if (record.depth === 1) {
    if (record.speed_source === 'child-default'
      && (record.speed !== 'standard' || record.child_priority_authorized || record.child_authority_digest !== null)) {
      fail('ROUTE_CONTRADICTION', { reason: 'child-default-substitution' });
    }
    if (record.speed_source === 'explicit-child-authority' && record.speed === 'priority'
      && (!record.child_priority_authorized || record.child_authority_digest === null)) {
      fail('ROUTE_CONTRADICTION', { reason: 'priority-child-proof' });
    }
    if (record.speed === 'priority' && (!record.child_priority_authorized || record.child_authority_digest === null)) {
      fail('ROUTE_CONTRADICTION', { reason: 'priority-child-proof' });
    }
    if (record.speed === 'standard' && (record.child_priority_authorized || record.child_authority_digest !== null)) {
      fail('ROUTE_CONTRADICTION', { reason: 'standard-child-authority' });
    }
  }
  if (record.depth === 0 && (record.parent_launch_id !== null || record.parent_speed !== null || record.child_priority_authorized || record.child_authority_digest !== null || record.speed_source !== 'registry-default')) {
    fail('ROUTE_CONTRADICTION', { reason: 'root-record-child-fields' });
  }
  if (record.depth === 1 && record.speed === 'standard' && record.speed_source === 'child-default' && record.parent_speed === 'priority') {
    // This is the positive proof that a root Priority route was not inherited.
  }
  const base = clone(record);
  delete base.route_digest;
  if (digestValue(base) !== record.route_digest) fail('ROUTE_CONTRADICTION', { reason: 'route-digest' });
  return deepFreeze(clone(record));
}

function resolveDepthOneLaunch(input = {}) {
  return resolveLaunchRecord({ ...input, depth: 1 });
}

function resolveRoleRoute(input = {}) {
  return resolveLaunchRecord(input);
}

function createExactLaunchReceipt({ launch_record, capability_proof_digest, status = 'accepted', started = false, completed = false } = {}) {
  const record = launch_record || arguments[0]?.launchRecord;
  if (!record) fail('EXACT_LAUNCH_REQUIRED');
  validateResolvedLaunchRecord(record);
  if (!isDigest(capability_proof_digest)) fail('ROUTE_METADATA_MISSING', { field: 'capability_proof_digest' });
  if (!['accepted', 'rejected', 'unsupported', 'contradictory'].includes(status)) fail('ROUTE_METADATA_MISSING', { field: 'status' });
  if (typeof started !== 'boolean' || typeof completed !== 'boolean') fail('ROUTE_METADATA_MISSING', { field: 'receipt-state' });
  const base = {
    contract_version: RECEIPT_CONTRACT_VERSION,
    receipt_id: `receipt-${digestValue({ route_digest: record.route_digest, capability_proof_digest, status }).slice(0, 24)}`,
    launch_record_digest: record.route_digest,
    capability_proof_digest,
    host: record.host,
    adapter_id: `host-adapter-${record.host}`,
    status,
    started,
    completed
  };
  return deepFreeze(base);
}

function validateExactLaunchReceipt(receipt) {
  const keys = ['contract_version', 'receipt_id', 'launch_record_digest', 'capability_proof_digest', 'host', 'adapter_id', 'status', 'started', 'completed'];
  if (!exactKeys(receipt, keys)
    || receipt.contract_version !== RECEIPT_CONTRACT_VERSION
    || !isSafeId(receipt.receipt_id)
    || !isDigest(receipt.launch_record_digest)
    || !isDigest(receipt.capability_proof_digest)
    || !HOSTS.includes(receipt.host)
    || !isSafeId(receipt.adapter_id)
    || !['accepted', 'rejected', 'unsupported', 'contradictory'].includes(receipt.status)
    || typeof receipt.started !== 'boolean'
    || typeof receipt.completed !== 'boolean') fail('ROUTE_CONTRADICTION', { reason: 'receipt-shape' });
  return deepFreeze(clone(receipt));
}

module.exports = Object.freeze({
  PACKAGE_VERSION,
  CONTRACT_VERSION,
  RECEIPT_CONTRACT_VERSION,
  REGISTRY_CONTRACT_VERSION,
  REGISTRY_PATH,
  HOSTS,
  RouteResolutionError,
  canonicalSerialize,
  digestValue,
  isDigest,
  loadRoleRegistry,
  validateRoleRegistry,
  roleRegistryDigest,
  resolveRoleRoute,
  resolveRoute: resolveRoleRoute,
  resolveLaunchRecord,
  resolveDepthOneLaunch,
  validateResolvedLaunchRecord,
  createExactLaunchReceipt,
  validateExactLaunchReceipt
});
