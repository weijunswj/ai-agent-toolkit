#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v2.json');
const DEFAULT_REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

const SCHEMAS = Object.freeze({
  router: 'toolkit.controller.contract-router.v2',
  routeBinding: 'toolkit.controller.route-binding.v2',
  routeDecision: 'toolkit.controller.route-decision.v2',
  ownershipDecision: 'toolkit.controller.ownership-decision.v1',
  executionPlan: 'toolkit.controller.execution-plan.v2',
  repositoryFence: 'toolkit.controller.repository-fence.v1',
  mutationAdmission: 'toolkit.controller.mutation-admission.v1',
  packet: 'toolkit.controller.terminal-packet.v1',
  receipt: 'toolkit.controller.terminal-receipt.v1',
});
const STAGES = Object.freeze(['G0-A', 'G0-B', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'RECONVERGENCE', 'FINAL_AUDIT', 'BROWSER']);
const STACK_IDS = Object.freeze(Object.keys(DEFAULT_REGISTRY.stacks));
const SEMANTIC_SUBAGENT_STAGES = Object.freeze(['G0-B', 'G3']);
const CONTROLLER_MODES = Object.freeze(['OWNER', 'OBSERVER', 'READ_ONLY', 'RECONCILING']);
// Harness identity is retained as adapter/capability context only. It never
// selects a stack and intentionally contains no harness-to-stack mapping.
const HARNESS_POLICY = Object.freeze({});
const ROUTE_STATUSES = Object.freeze(['USER_DECISION_REQUIRED', 'ROUTE_UNAVAILABLE', 'ROUTE_RESOLVED']);
const EXECUTION_PATHS = Object.freeze(['direct-web-executor', 'accepted-a2-loop-reconciliation']);
const TERMINAL_PACKET_INCOMPLETE = 'TERMINAL_PACKET_INCOMPLETE';
const TERMINAL_RECEIPT_INCOMPLETE = 'TERMINAL_RECEIPT_INCOMPLETE';

function isRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  try { return !Array.isArray(value); } catch (_error) { return false; }
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function exactDataKeys(value, keys) {
  if (!exactKeys(value, keys)) return false;
  try {
    return Reflect.ownKeys(value).length === keys.length
      && keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return Boolean(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'));
      });
  } catch (_error) { return false; }
}

function trustedDataValue(value, seen = new Set()) {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') return { ok: Number.isFinite(value), value };
  if (typeof value !== 'object' || seen.has(value)) return { ok: false, reason: 'UNSAFE_DATA_VALUE' };
  const nextSeen = new Set(seen);
  nextSeen.add(value);
  let array;
  try { array = Array.isArray(value); } catch (_error) { return { ok: false, reason: 'UNSAFE_DATA_VALUE' }; }
  if (array) {
    let prototype;
    let lengthDescriptor;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      keys = Reflect.ownKeys(value);
    } catch (_error) { return { ok: false, reason: 'UNSAFE_DATA_VALUE' }; }
    if ((prototype !== Array.prototype && prototype !== null)
      || !lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
      return { ok: false, reason: 'UNSAFE_DATA_VALUE' };
    }
    const output = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); } catch (_error) { return { ok: false, reason: 'UNSAFE_DATA_VALUE' }; }
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, reason: 'UNSAFE_DATA_VALUE' };
      const checked = trustedDataValue(descriptor.value, nextSeen);
      if (!checked.ok) return checked;
      output.push(checked.value);
    }
    for (const key of keys) {
      if (key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= lengthDescriptor.value)) {
        return { ok: false, reason: 'UNSAFE_DATA_VALUE' };
      }
    }
    return { ok: true, value: output };
  }
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch (_error) { return { ok: false, reason: 'UNSAFE_DATA_VALUE' }; }
  if (prototype !== Object.prototype && prototype !== null) return { ok: false, reason: 'INHERITED_AUTHORITY' };
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (_error) { return { ok: false, reason: 'UNSAFE_DATA_VALUE' }; }
  const output = {};
  for (const key of keys) {
    if (typeof key !== 'string') return { ok: false, reason: 'UNSAFE_DATA_VALUE' };
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_error) { return { ok: false, reason: 'UNSAFE_DATA_VALUE' }; }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, reason: 'ACCESSOR_AUTHORITY' };
    const checked = trustedDataValue(descriptor.value, nextSeen);
    if (!checked.ok) return checked;
    output[key] = checked.value;
  }
  return { ok: true, value: output };
}

function singleAliasValue(value, keys) {
  const checked = authorityDataBoundary(value, keys);
  if (!checked.ok) return { ok: false, present: [], reason: checked.reason };
  const present = Object.keys(checked.values);
  if (present.length > 1) return { ok: false, present, reason: 'ALIAS_CONFLICT' };
  if (present.length === 0) return { ok: true, present: [], value: undefined };
  return { ok: true, present, key: present[0], value: checked.values[present[0]] };
}

function ownDescriptor(value, key) {
  if (!isRecord(value)) return null;
  try { return Object.getOwnPropertyDescriptor(value, key) || null; } catch (_error) { return null; }
}

function inheritedDescriptor(value, key) {
  if (!isRecord(value)) return null;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch (_error) { return null; }
  while (prototype !== null) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor) return descriptor;
      prototype = Object.getPrototypeOf(prototype);
    } catch (_error) { return { unsafe: true }; }
  }
  return null;
}

function authorityDataBoundary(value, keys) {
  if (!isRecord(value)) return { ok: false, reason: 'INPUT_NOT_OBJECT' };
  const values = {};
  try {
    for (const key of keys) {
      const own = ownDescriptor(value, key);
      const inherited = inheritedDescriptor(value, key);
      if (inherited?.unsafe || !own && inherited) return { ok: false, reason: 'INHERITED_AUTHORITY' };
      if (!own) continue;
      if (!Object.prototype.hasOwnProperty.call(own, 'value')) return { ok: false, reason: 'ACCESSOR_AUTHORITY' };
      values[key] = own.value;
    }
  } catch (_error) { return { ok: false, reason: 'DESCRIPTOR_READ_FAILED' }; }
  return { ok: true, values };
}

function nestedAuthorityDataBoundary(value, keys) {
  if (value === null || value === undefined) return { ok: true, value };
  const checked = authorityDataBoundary(value, keys);
  if (!checked.ok) return checked;
  return { ok: true, value: { ...checked.values } };
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CANONICAL_VALUE_INVALID');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalSerialize).join(',') + ']';
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort().map((key) => `${canonicalSerialize(key)}:${canonicalSerialize(value[key])}`).join(',') + '}';
  }
  throw new Error('CANONICAL_VALUE_INVALID');
}

function digestValue(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isSafeId(value, max = 256) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9._:/-]+$/.test(value)
    && !value.includes('..');
}

function isTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function result(ok, code, extra = {}) {
  return Object.freeze({ ok, code, ...extra });
}

function routeOnly(value) {
  if (!isRecord(value)) return null;
  if (!exactDataKeys(value, ['provider', 'model', 'reasoning'])) return null;
  const provider = ownDescriptor(value, 'provider')?.value;
  const model = ownDescriptor(value, 'model')?.value;
  const reasoning = ownDescriptor(value, 'reasoning')?.value;
  if (![provider, model, reasoning].every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256)) return null;
  return { provider, model, reasoning };
}

function routeSignature(route) {
  const normalized = routeOnly(route);
  return normalized ? `${normalized.provider}/${normalized.model}/${normalized.reasoning}` : null;
}

function readA2Evidence(options = {}) {
  const selected = singleAliasValue(options, ['a2_accepted', 'a2Accepted']);
  if (!selected.ok) return { ok: false };
  if (selected.present.length === 0) return { ok: true, accepted: false };
  return typeof selected.value === 'boolean'
    ? { ok: true, accepted: selected.value }
    : { ok: false };
}

function validateRegistry(registry) {
  const trusted = trustedDataValue(registry);
  if (!trusted.ok) return result(false, 'STACK_REGISTRY_INVALID');
  registry = trusted.value;
  if (!isRecord(registry)
    || !exactDataKeys(registry, ['schema', 'version', 'stacks'])
    || registry.schema !== 'toolkit.controller.stack-registry.v2'
    || registry.version !== 2
    || !isRecord(registry.stacks)
    || Object.prototype.hasOwnProperty.call(registry, 'default_stack')
    || Object.keys(registry.stacks).length < 1) return result(false, 'STACK_REGISTRY_INVALID');
  for (const stackId of Object.keys(registry.stacks)) {
    if (!STACK_IDS.includes(stackId)) return result(false, 'STACK_REGISTRY_STACK_UNSUPPORTED', { stack_id: stackId });
    const stack = registry.stacks[stackId];
    if (!isRecord(stack) || !exactDataKeys(stack, ['routes', 'subagents']) || !isRecord(stack.routes) || !isRecord(stack.subagents)) {
      return result(false, 'STACK_REGISTRY_STACK_INVALID', { stack_id: stackId });
    }
    if (!STAGES.every((stage) => hasOwn(stack.routes, stage)) || !exactDataKeys(stack.routes, STAGES)) {
      return result(false, 'STACK_REGISTRY_ROUTE_SET_INVALID', { stack_id: stackId });
    }
    if (!exactDataKeys(stack.subagents, SEMANTIC_SUBAGENT_STAGES)) return result(false, 'STACK_REGISTRY_SUBAGENT_SET_INVALID', { stack_id: stackId });
    for (const route of Object.values(stack.routes)) {
      if (!routeOnly(route) || hasOwn(route, 'tier') || hasOwn(route, 'priority')) return result(false, 'STACK_REGISTRY_ROUTE_IDENTITY_INVALID', { stack_id: stackId });
    }
    for (const route of Object.values(stack.subagents)) {
      if (route !== null && (!routeOnly(route) || hasOwn(route, 'tier') || hasOwn(route, 'priority'))) {
        return result(false, 'STACK_REGISTRY_SUBAGENT_INVALID', { stack_id: stackId });
      }
    }
  }
  return result(true, 'STACK_REGISTRY_VALID', { registry: clone(registry), digest: digestValue(registry) });
}

function loadRegistry(registry = DEFAULT_REGISTRY) {
  const checked = validateRegistry(registry);
  return checked.ok ? checked : result(false, checked.code, checked);
}

function registryIdentity(registry = DEFAULT_REGISTRY, revision = null) {
  const checked = loadRegistry(registry);
  if (!checked.ok || !isSafeId(String(revision || '')) || revision === 'workspace') return result(false, 'REGISTRY_IDENTITY_UNAVAILABLE');
  return result(true, 'REGISTRY_IDENTITY_READY', {
    identity: { revision: String(revision), digest: checked.digest },
  });
}

function normalizeHarness(options = {}) {
  const identity = singleAliasValue(options, ['harness_identity', 'verified_harness', 'harness']);
  const verified = singleAliasValue(options, ['harness_verified']);
  const source = singleAliasValue(options, ['harness_source']);
  if (!identity.ok || !verified.ok || !source.ok) return { name: 'unknown', verified: false, source: 'unavailable', invalid: true };
  if (verified.present.length > 0 && typeof verified.value !== 'boolean') return { name: 'unknown', verified: false, source: 'unavailable', invalid: true };
  if (source.present.length > 0 && !['hook', 'adapter', 'runtime'].includes(source.value)) return { name: 'unknown', verified: false, source: 'unavailable', invalid: true };
  const raw = identity.present.length > 0 ? identity.value : null;
  if (typeof raw === 'string') {
    return {
      name: ['claude-code', 'codex', 'opencode'].includes(raw) ? raw : 'unknown',
      verified: verified.value === true,
      source: source.present.length > 0 ? source.value : 'adapter',
    };
  }
  if (isRecord(raw)) {
    const nested = trustedDataValue(raw);
    if (!nested.ok || Object.keys(nested.value).some((key) => !['name', 'verified', 'source'].includes(key))) {
      return { name: 'unknown', verified: false, source: 'unavailable', invalid: true };
    }
    if (nested.value.verified !== undefined && typeof nested.value.verified !== 'boolean') {
      return { name: 'unknown', verified: false, source: 'unavailable', invalid: true };
    }
    if (nested.value.source !== undefined && !['hook', 'adapter', 'runtime'].includes(nested.value.source)) {
      return { name: 'unknown', verified: false, source: 'unavailable', invalid: true };
    }
    return {
      name: ['claude-code', 'codex', 'opencode'].includes(nested.value.name) ? nested.value.name : 'unknown',
      verified: nested.value.verified === true,
      source: nested.value.source || 'unavailable',
    };
  }
  return { name: 'unknown', verified: false, source: 'unavailable' };
}

function explicitStackSelection(options) {
  const keys = ['selected_stack', 'explicit_stack', 'stack_selection', 'user_stack'];
  const selected = singleAliasValue(options, keys);
  if (!selected.ok) return { present: true, value: null, invalid: true, reason: selected.reason === 'ALIAS_CONFLICT' ? 'STACK_SELECTION_CONFLICT' : selected.reason };
  if (selected.present.length === 0) return { present: false, value: null };
  const raw = selected.value;
  if (typeof raw === 'string') return { present: true, value: raw };
  if (isRecord(raw)) {
    const nested = trustedDataValue(raw);
    if (nested.ok && Object.keys(nested.value).every((key) => ['stack_id', 'trusted', 'selection_source'].includes(key))
      && typeof nested.value.stack_id === 'string'
      && (nested.value.trusted === undefined || nested.value.trusted === true)
      && (nested.value.selection_source === undefined || nested.value.selection_source === 'explicit_trusted_stack')) {
      return { present: true, value: nested.value.stack_id };
    }
  }
  return { present: true, value: null, invalid: true, reason: 'STACK_SELECTION_INVALID' };
}

function routeCapabilityAvailable(route, options = {}) {
  const verifierAlias = singleAliasValue(options, ['route_verifier', 'routeVerifier']);
  if (!verifierAlias.ok) return false;
  const verifier = verifierAlias.value;
  if (typeof verifier === 'function') {
    let checked;
    try { checked = verifier(clone(route)); } catch (_error) { return false; }
    if (checked && typeof checked.then === 'function') return false;
    return checked === true || (isRecord(checked) && checked.available === true);
  }
  const available = singleAliasValue(options, ['route_available', 'available']);
  if (!available.ok) return false;
  if (available.present.length > 0) return typeof available.value === 'boolean' && available.value;
  const runtimeRoute = singleAliasValue(options, ['runtime_route']);
  if (!runtimeRoute.ok) return false;
  if (runtimeRoute.present.length > 0) {
    const trusted = trustedDataValue(runtimeRoute.value);
    return trusted.ok && isRecord(trusted.value) && routeSignature(trusted.value) === routeSignature(route);
  }
  const capability = singleAliasValue(options, ['capability']);
  if (!capability.ok) return false;
  if (capability.present.length > 0) {
    const trusted = trustedDataValue(capability.value);
    return trusted.ok && isRecord(trusted.value) && routeSignature(trusted.value) === routeSignature(route);
  }
  const availableRoutes = singleAliasValue(options, ['available_routes']);
  if (!availableRoutes.ok) return false;
  if (availableRoutes.present.length > 0) {
    const trusted = trustedDataValue(availableRoutes.value);
    return trusted.ok && Array.isArray(trusted.value) && trusted.value.includes(routeSignature(route));
  }
  return false;
}

function resolveRegistryIdentity(loaded, options = {}) {
  const suppliedAlias = singleAliasValue(options, ['registry_identity', 'registryIdentity']);
  if (!suppliedAlias.ok) return result(false, 'REGISTRY_IDENTITY_MISMATCH');
  const supplied = suppliedAlias.present.length === 0 ? null : suppliedAlias.value;
  const suppliedChecked = supplied === null ? { ok: true, value: null } : trustedDataValue(supplied);
  if (!suppliedChecked.ok || supplied !== null && (!isRecord(suppliedChecked.value)
    || !exactDataKeys(suppliedChecked.value, ['revision', 'digest']))) return result(false, 'REGISTRY_IDENTITY_MISMATCH');
  const trustedSupplied = supplied === null ? null : suppliedChecked.value;
  const revisionAlias = singleAliasValue(options, ['registry_revision', 'registryRevision']);
  if (!revisionAlias.ok) return result(false, 'REGISTRY_IDENTITY_UNAVAILABLE');
  const revision = revisionAlias.present.length > 0 ? revisionAlias.value : trustedSupplied?.revision || null;
  if (!isSafeId(String(revision || '')) || revision === 'workspace') return result(false, 'REGISTRY_IDENTITY_UNAVAILABLE');
  const identity = registryIdentity(loaded.registry, revision);
  if (!identity.ok) return identity;
  if (supplied !== null && (trustedSupplied.revision !== identity.identity.revision || trustedSupplied.digest !== identity.identity.digest)) {
    return result(false, 'REGISTRY_IDENTITY_MISMATCH');
  }
  return identity;
}

function routeDecision(stage, selectionSource, status, reasonCode, selectedStack = null) {
  return {
    schema: SCHEMAS.routeDecision,
    version: 2,
    status,
    stage,
    selection_source: selectionSource,
    selected_stack: selectedStack,
    reason_code: reasonCode,
    repair_budget_consumed: false,
  };
}

function resolveRoute(options = {}) {
  const optionBoundary = authorityDataBoundary(options, [
    'stage', 'selected_stack', 'explicit_stack', 'stack_selection', 'user_stack',
    'harness_identity', 'verified_harness', 'harness', 'harness_verified', 'harness_source',
    'a2_accepted', 'a2Accepted', 'route_verifier', 'routeVerifier', 'route_available', 'available',
    'runtime_route', 'capability', 'available_routes', 'registry', 'registry_identity', 'registryIdentity',
    'registry_revision', 'registryRevision', 'thread_id', 'threadId', 'semantic_subagent', 'semanticSubagent',
    'subagent', 'route_kind',
  ]);
  if (!optionBoundary.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision('UNKNOWN', 'none', 'ROUTE_UNAVAILABLE', 'ROUTE_INPUT_DESCRIPTOR_INVALID') });
  const input = optionBoundary.values;
  const stage = input.stage;
  if (!STAGES.includes(stage)) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision('UNKNOWN', 'none', 'ROUTE_UNAVAILABLE', 'STAGE_UNAVAILABLE') });
  const loaded = loadRegistry(input.registry || DEFAULT_REGISTRY);
  if (!loaded.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, 'none', 'ROUTE_UNAVAILABLE', loaded.code) });

  const explicit = explicitStackSelection(options);
  const harness = normalizeHarness(options);
  if (explicit.invalid) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, 'none', 'ROUTE_UNAVAILABLE', 'SELECTED_STACK_INVALID') });
  if (!explicit.present) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, 'none', 'ROUTE_UNAVAILABLE', 'SELECTED_STACK_REQUIRED'), harness_identity: harness });
  const stackId = explicit.value;
  const selectionSource = 'explicit_trusted_stack';
  if (!STACK_IDS.includes(stackId) || !loaded.registry.stacks[stackId]) {
    return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'SELECTED_STACK_UNAVAILABLE', stackId) });
  }
  if (harness.invalid) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'HARNESS_CONTEXT_INVALID', stackId) });

  const a2 = readA2Evidence(options);
  if (!a2.ok) {
    return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'A2_EVIDENCE_INVALID', stackId) });
  }
  if (stage === 'LOOP' && a2.accepted !== true) {
    return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'A2_NOT_ACCEPTED', stackId) });
  }
  const semanticAlias = singleAliasValue(input, ['semantic_subagent', 'semanticSubagent', 'subagent']);
  if (!semanticAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'SEMANTIC_SUBAGENT_INPUT_INVALID', stackId) });
  const semanticSubagent = semanticAlias.value === true || input.route_kind === 'semantic-subagent';
  if (semanticSubagent && !SEMANTIC_SUBAGENT_STAGES.includes(stage)) {
    return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'SEMANTIC_SUBAGENT_ROLE_UNSUPPORTED', stackId) });
  }
  const routeSource = semanticSubagent ? loaded.registry.stacks[stackId].subagents[stage] : loaded.registry.stacks[stackId].routes[stage];
  const route = routeOnly(routeSource);
  if (!route || !routeCapabilityAvailable(route, input)) {
    const explicitCapabilityFailure = input.route_available === false || input.available === false;
    return result(false, 'ROUTE_UNAVAILABLE', {
      decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', route ? explicitCapabilityFailure ? 'REQUESTED_ROUTE_UNAVAILABLE' : 'ROUTE_CAPABILITY_UNVERIFIED' : 'REQUESTED_ROUTE_UNAVAILABLE', stackId),
      selected_stack: stackId,
      route: route || null,
    });
  }
  const identity = resolveRegistryIdentity(loaded, input);
  if (!identity.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', identity.code, stackId) });
  const threadAlias = singleAliasValue(input, ['thread_id', 'threadId']);
  if (!threadAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'THREAD_ID_INVALID', stackId) });
  const threadId = threadAlias.present.length > 0
    ? threadAlias.value
    : `thread-${digestValue({ stage, stackId, route, registry: identity.identity }).slice(0, 24)}`;
  if (!isSafeId(threadId)) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'THREAD_ID_INVALID', stackId) });
  const a2Status = a2.accepted ? 'accepted' : 'not-accepted';
  const binding = {
    schema: SCHEMAS.routeBinding,
    version: 2,
    thread_id: threadId,
    stage,
    stack_id: stackId,
    selection_source: selectionSource,
    harness_identity: harness,
    registry_identity: identity.identity,
    route,
    route_digest: digestValue(route),
    execution_path: a2Status === 'accepted' ? 'accepted-a2-loop-reconciliation' : 'direct-web-executor',
    a2_status: a2Status,
    status: 'ROUTE_RESOLVED',
    repair_budget_consumed: false,
  };
  return result(true, 'ROUTE_RESOLVED', { binding: deepFreeze(binding), route: clone(route), stack_id: stackId, selection_source: selectionSource });
}

function validateRouteBinding(binding, options = {}) {
  const trustedBinding = trustedDataValue(binding);
  if (!trustedBinding.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_BINDING_INVALID', repair_budget_consumed: false });
  binding = trustedBinding.value;
  const keys = ['schema', 'version', 'thread_id', 'stage', 'stack_id', 'selection_source', 'harness_identity', 'registry_identity', 'route', 'route_digest', 'execution_path', 'a2_status', 'status', 'repair_budget_consumed'];
  if (!isRecord(binding) || !exactDataKeys(binding, keys)
    || binding.schema !== SCHEMAS.routeBinding || binding.version !== 2
    || !isSafeId(binding.thread_id) || !STAGES.includes(binding.stage) || !STACK_IDS.includes(binding.stack_id)
    || binding.selection_source !== 'explicit_trusted_stack'
    || !isRecord(binding.harness_identity) || typeof binding.harness_identity.name !== 'string'
    || typeof binding.harness_identity.verified !== 'boolean' || typeof binding.harness_identity.source !== 'string'
    || !isRecord(binding.registry_identity) || !isSafeId(binding.registry_identity.revision) || binding.registry_identity.revision === 'workspace' || !isDigest(binding.registry_identity.digest)
    || !routeOnly(binding.route) || !isDigest(binding.route_digest) || binding.route_digest !== digestValue(binding.route)
    || !EXECUTION_PATHS.includes(binding.execution_path) || !['not-accepted', 'accepted'].includes(binding.a2_status)
    || binding.status !== 'ROUTE_RESOLVED' || binding.repair_budget_consumed !== false) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_BINDING_INVALID', repair_budget_consumed: false });
  }
  const bindingHarness = authorityDataBoundary(binding.harness_identity, ['name', 'verified', 'source']);
  const bindingRegistry = authorityDataBoundary(binding.registry_identity, ['revision', 'digest']);
  if (!bindingHarness.ok || !bindingRegistry.ok || !exactDataKeys(binding.route, ['provider', 'model', 'reasoning'])) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_BINDING_INVALID', repair_budget_consumed: false });
  }
  const optionBoundary = authorityDataBoundary(options, [
    'registry', 'current_registry_identity', 'currentRegistryIdentity', 'current_registry_revision', 'currentRegistryRevision',
    'registry_revision', 'registryRevision', 'current_registry_digest', 'currentRegistryDigest', 'current_stage', 'currentStage',
    'stage', 'current_thread_id', 'currentThreadId', 'thread_id', 'threadId', 'current_a2_accepted', 'currentA2Accepted',
    'a2_accepted', 'a2Accepted', 'route_verifier', 'routeVerifier', 'route_available', 'available', 'runtime_route',
    'capability', 'available_routes', 'selected_stack', 'explicit_stack', 'stack_selection', 'user_stack',
    'harness_identity', 'verified_harness', 'harness', 'harness_verified', 'harness_source',
  ]);
  if (!optionBoundary.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_INPUT_DESCRIPTOR_INVALID', repair_budget_consumed: false });
  const input = optionBoundary.values;
  if (binding.harness_identity.name !== 'unknown' && !['claude-code', 'codex', 'opencode'].includes(binding.harness_identity.name)) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_BINDING_INVALID', repair_budget_consumed: false });
  }
  const bindingA2Accepted = binding.a2_status === 'accepted';
  const executionA2Accepted = binding.execution_path === 'accepted-a2-loop-reconciliation';
  if (bindingA2Accepted !== executionA2Accepted || binding.stage === 'LOOP' && !bindingA2Accepted) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_A2_EXECUTION_PATH_MISMATCH', repair_budget_consumed: false });
  }
  const loaded = loadRegistry(input.registry || DEFAULT_REGISTRY);
  if (!loaded.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_UNAVAILABLE', repair_budget_consumed: false });
  if (binding.registry_identity.digest !== loaded.digest) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_REGISTRY_DIGEST_MISMATCH', repair_budget_consumed: false });
  const registeredRoute = routeOnly(loaded.registry.stacks[binding.stack_id]?.routes?.[binding.stage]);
  if (!registeredRoute || canonicalSerialize(registeredRoute) !== canonicalSerialize(binding.route)) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_REGISTERED_ROUTE_MISMATCH', repair_budget_consumed: false });
  }

  const currentIdentityAlias = singleAliasValue(input, ['current_registry_identity', 'currentRegistryIdentity']);
  if (!currentIdentityAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_IDENTITY_INVALID', repair_budget_consumed: false });
  const currentIdentityInput = currentIdentityAlias.present.length > 0 ? currentIdentityAlias.value : undefined;
  const currentIdentityChecked = currentIdentityInput === undefined ? { ok: true, value: null } : trustedDataValue(currentIdentityInput);
  if (!currentIdentityChecked.ok || currentIdentityInput !== undefined
    && (!isRecord(currentIdentityChecked.value) || !exactDataKeys(currentIdentityChecked.value, ['revision', 'digest']))) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_IDENTITY_INVALID', repair_budget_consumed: false });
  }
  const currentRevisionAlias = singleAliasValue(input, ['current_registry_revision', 'currentRegistryRevision', 'registry_revision', 'registryRevision']);
  if (!currentRevisionAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_IDENTITY_UNAVAILABLE', repair_budget_consumed: false });
  const currentRevision = currentRevisionAlias.present.length > 0
    ? currentRevisionAlias.value
    : currentIdentityChecked.value?.revision;
  const currentIdentity = registryIdentity(loaded.registry, currentRevision);
  if (!currentIdentity.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_IDENTITY_UNAVAILABLE', repair_budget_consumed: false });
  const currentDigestAlias = singleAliasValue(input, ['current_registry_digest', 'currentRegistryDigest']);
  if (!currentDigestAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_DIGEST_UNAVAILABLE', repair_budget_consumed: false });
  const currentDigest = currentDigestAlias.present.length > 0 ? currentDigestAlias.value : currentIdentityChecked.value?.digest;
  if (currentDigest !== undefined && currentDigest !== currentIdentity.identity.digest) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'CURRENT_REGISTRY_DIGEST_UNAVAILABLE', repair_budget_consumed: false });
  }
  if (binding.registry_identity.revision !== currentIdentity.identity.revision
    || binding.registry_identity.digest !== currentIdentity.identity.digest) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_REGISTRY_STALE', repair_budget_consumed: false });
  }

  const currentStageAlias = singleAliasValue(input, ['current_stage', 'currentStage', 'stage']);
  if (!currentStageAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_STAGE_MISMATCH', repair_budget_consumed: false });
  const currentStage = currentStageAlias.present.length > 0 ? currentStageAlias.value : undefined;
  if (currentStage !== binding.stage) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_STAGE_MISMATCH', repair_budget_consumed: false });
  }
  const currentThreadAlias = singleAliasValue(input, ['current_thread_id', 'currentThreadId', 'thread_id', 'threadId']);
  if (!currentThreadAlias.ok) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_THREAD_MISMATCH', repair_budget_consumed: false });
  const currentThread = currentThreadAlias.present.length > 0 ? currentThreadAlias.value : undefined;
  if (!currentThread || currentThread !== binding.thread_id) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_THREAD_MISMATCH', repair_budget_consumed: false });
  }
  const currentA2Alias = singleAliasValue(input, ['current_a2_accepted', 'currentA2Accepted', 'a2_accepted', 'a2Accepted']);
  const currentA2 = currentA2Alias.present.length === 1 ? currentA2Alias.value : undefined;
  if (!currentA2Alias.ok || currentA2Alias.present.length !== 1 || typeof currentA2 !== 'boolean') {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_A2_EVIDENCE_INVALID', repair_budget_consumed: false });
  }
  if (bindingA2Accepted !== currentA2) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_A2_STATE_MISMATCH', repair_budget_consumed: false });
  }
  if (!routeCapabilityAvailable(binding.route, input)) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_CAPABILITY_UNAVAILABLE', repair_budget_consumed: false });
  }

  const explicit = explicitStackSelection(input);
  if (explicit.invalid || !explicit.present || explicit.value !== binding.stack_id) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_SELECTION_PROVENANCE_MISMATCH', repair_budget_consumed: false });
  }
  const currentHarness = normalizeHarness(input);
  if (currentHarness.invalid) return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_HARNESS_CONTEXT_INVALID', repair_budget_consumed: false });
  const harnessSupplied = ['harness_identity', 'verified_harness', 'harness'].some((key) => hasOwn(options, key));
  if (harnessSupplied && (currentHarness.name !== binding.harness_identity.name || currentHarness.verified !== binding.harness_identity.verified || currentHarness.source !== binding.harness_identity.source)) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_HARNESS_CONTEXT_MISMATCH', repair_budget_consumed: false });
  }
  return result(true, 'ROUTE_BINDING_VALID', { binding: clone(binding) });
}

function planExecution(options = {}) {
  const bindingDescriptor = isRecord(options) ? Object.getOwnPropertyDescriptor(options, 'binding') : undefined;
  const bindingSupplied = bindingDescriptor !== undefined;
  const bindingValue = bindingSupplied && Object.prototype.hasOwnProperty.call(bindingDescriptor, 'value') ? bindingDescriptor.value : undefined;
  if (bindingSupplied && (!bindingDescriptor || !Object.prototype.hasOwnProperty.call(bindingDescriptor, 'value'))) {
    return result(false, 'ROUTE_UNAVAILABLE', { reason_code: 'STORED_ROUTE_BINDING_INVALID', repair_budget_consumed: false });
  }
  const resolved = bindingSupplied ? validateRouteBinding(bindingValue, options) : resolveRoute(options);
  if (!resolved.ok) return resolved;
  const binding = resolved.binding;
  const plan = {
    schema: SCHEMAS.executionPlan,
    version: 2,
    thread_id: binding.thread_id,
    stage: binding.stage,
    route_binding: clone(binding),
    execution_path: binding.execution_path,
    loop_invoked: false,
    web_reconciliation_required: true,
  };
  return result(true, 'EXECUTION_PLAN_READY', { plan: deepFreeze(plan) });
}

function normalizeControllerMode(value, fallback = 'OBSERVER') {
  const mode = typeof value === 'string' ? value.toUpperCase() : '';
  return CONTROLLER_MODES.includes(mode) ? mode : fallback;
}

function repositoryFenceInput(value) {
  if (typeof value === 'string') return { repository: value, mode: 'OWNER' };
  if (!isRecord(value)) return { repository: null, mode: 'OBSERVER' };
  return {
    repository: value.controller_repository_fence || value.repository || value.repository_id || null,
    mode: normalizeControllerMode(value.controller_mode || value.mode, 'OBSERVER'),
  };
}

function validateRepositoryFence(fence) {
  const keys = ['schema', 'version', 'controller_repository_fence', 'controller_mode', 'binding_digest'];
  if (!isRecord(fence) || !exactKeys(fence, keys)
    || fence.schema !== SCHEMAS.repositoryFence || fence.version !== 1
    || !isSafeId(fence.controller_repository_fence)
    || !CONTROLLER_MODES.includes(fence.controller_mode)
    || !isDigest(fence.binding_digest)) return result(false, 'REPOSITORY_FENCE_INVALID');
  const base = { ...fence };
  delete base.binding_digest;
  if (fence.binding_digest !== digestValue(base)) return result(false, 'REPOSITORY_FENCE_DIGEST_MISMATCH');
  return result(true, 'REPOSITORY_FENCE_VALID', { fence: clone(fence) });
}

function bindRepositoryFence(input = {}) {
  const source = typeof input === 'string' ? { repository: input } : (isRecord(input) ? input : {});
  const repository = source.controller_repository_fence || source.repository || source.repository_id;
  if (!isSafeId(repository)) return result(false, 'REPOSITORY_FENCE_UNAVAILABLE');
  const base = {
    schema: SCHEMAS.repositoryFence,
    version: 1,
    controller_repository_fence: repository,
    controller_mode: normalizeControllerMode(source.controller_mode || source.mode, 'OWNER'),
  };
  const fence = { ...base, binding_digest: digestValue(base) };
  return result(true, 'REPOSITORY_FENCE_BOUND', { fence: deepFreeze(fence), repository, controller_mode: fence.controller_mode });
}

function mutationAuthorityPresent(options = {}) {
  const authority = options.mutation_authority || options.authority || options.scope || null;
  if (options.mutation_authorised === true || options.mutation_authorized === true
    || options.scope_authorised === true || options.scope_authorized === true
    || options.lock_authorised === true || options.lock_authorized === true) return true;
  return isRecord(authority) && (authority.mutation_allowed === true || authority.authorised === true || authority.authorized === true);
}

function priorControllerReconciled(options = {}) {
  if (options.prior_state_reconciled === true || options.reconciled === true) return true;
  if (options.in_flight_reconciled === true && options.admission_reconciled === true) return true;
  const reconciliation = options.reconciliation || options.prior_reconciliation;
  return isRecord(reconciliation) && reconciliation.in_flight === true && reconciliation.admission === true;
}

function explicitTakeoverAuthority(options = {}) {
  return options.explicit_user_web_authority === true
    || options.user_web_authority === true
    || options.takeover_authorised === true
    || options.takeover_authorized === true
    || (isRecord(options.takeover_authority) && (options.takeover_authority.authorised === true || options.takeover_authority.authorized === true));
}

function selectSingleAlias(options, keys) {
  const present = keys.filter((key) => hasOwn(options, key));
  if (present.length !== 1) return result(false, present.length === 0 ? 'MISSING' : 'CONFLICT');
  return result(true, 'SELECTED', { key: present[0], value: options[present[0]] });
}

function mutationDecision(options, fence, target, mode, operation, allowed, reasonCode, extra = {}) {
  return {
    schema: SCHEMAS.mutationAdmission,
    version: 1,
    target_repository: target,
    controller_repository_fence: fence,
    controller_mode: mode,
    operation,
    mutation_allowed: allowed,
    read_allowed: operation === 'read' || allowed === false && reasonCode === 'CROSS_REPOSITORY_READ_ALLOWED',
    reason_code: reasonCode,
    ...extra,
  };
}

function admitRepositoryMutation(options = {}) {
  const fenceAlias = selectSingleAlias(options, ['fence', 'repository_fence', 'controller_repository_fence']);
  if (!fenceAlias.ok || !isRecord(fenceAlias.value)) {
    return result(false, 'REPOSITORY_FENCE_INVALID', {
      decision: mutationDecision(options, 'unknown', 'unknown', 'OBSERVER', 'mutation', false, 'REPOSITORY_FENCE_INVALID'),
    });
  }
  const validatedFence = validateRepositoryFence(fenceAlias.value);
  if (!validatedFence.ok) {
    return result(false, validatedFence.code, {
      decision: mutationDecision(options, 'unknown', 'unknown', 'OBSERVER', 'mutation', false, validatedFence.code),
    });
  }
  const bound = {
    repository: validatedFence.fence.controller_repository_fence,
    mode: validatedFence.fence.controller_mode,
  };
  const targetAlias = selectSingleAlias(options, ['target_repository', 'targetRepository', 'repository', 'repository_id']);
  const target = targetAlias.ok ? targetAlias.value : null;
  const operation = options.mutation === false || ['read', 'observe', 'evidence'].includes(options.operation) ? 'read' : 'mutation';
  if (!targetAlias.ok || !isSafeId(target)) {
    return result(false, 'REPOSITORY_FENCE_TARGET_INVALID', {
      decision: mutationDecision(options, bound.repository, target || 'unknown', bound.mode, operation, false, 'REPOSITORY_FENCE_TARGET_INVALID'),
    });
  }

  if (operation === 'read') {
    const readCode = target === bound.repository ? 'REPOSITORY_READ_ALLOWED' : 'CROSS_REPOSITORY_READ_ALLOWED';
    return result(true, readCode, {
      decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, readCode),
      evidence_allowed: true,
    });
  }

  if (target !== bound.repository) {
    return result(false, 'CROSS_REPOSITORY_MUTATION_DENIED', {
      decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, 'CROSS_REPOSITORY_MUTATION_DENIED'),
    });
  }

  const takeover = options.takeover === true || options.rebind === true || options.explicit_takeover === true;
  if (!takeover && bound.mode !== 'OWNER') {
    return result(false, 'OBSERVER_MUTATION_DENIED', {
      decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, 'OBSERVER_MUTATION_DENIED'),
    });
  }

  if (!mutationAuthorityPresent(options)) {
    return result(false, 'MUTATION_AUTHORITY_REQUIRED', {
      decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, 'MUTATION_AUTHORITY_REQUIRED'),
    });
  }

  const ownership = options.ownership_decision || options.ownership || options.owner_decision;
  if (isRecord(ownership) && ownership.mutation_allowed !== true) {
    return result(false, ownership.reason_code || 'OWNERSHIP_MUTATION_DENIED', {
      decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, ownership.reason_code || 'OWNERSHIP_MUTATION_DENIED'),
    });
  }

  if (takeover) {
    if (!explicitTakeoverAuthority(options)) {
      return result(false, 'TAKEOVER_AUTHORITY_REQUIRED', {
        decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, 'TAKEOVER_AUTHORITY_REQUIRED'),
      });
    }
    if (!priorControllerReconciled(options)) {
      return result(false, 'PRIOR_CONTROLLER_RECONCILIATION_REQUIRED', {
        decision: mutationDecision(options, bound.repository, target, bound.mode, operation, false, 'PRIOR_CONTROLLER_RECONCILIATION_REQUIRED'),
      });
    }
  }

  const effectiveMode = takeover ? 'OWNER' : bound.mode;
  if (effectiveMode !== 'OWNER') {
    return result(false, 'OBSERVER_MUTATION_DENIED', {
      decision: mutationDecision(options, bound.repository, target, effectiveMode, operation, false, 'OBSERVER_MUTATION_DENIED'),
    });
  }
  return result(true, 'MUTATION_ADMITTED', {
    decision: mutationDecision(options, bound.repository, target, effectiveMode, operation, true, 'MUTATION_ADMITTED', { rebound: takeover }),
    controller_repository_fence: bound.repository,
    controller_mode: effectiveMode,
    rebound: takeover,
  });
}

function normalizeIdentity(value, fallback = 'unknown') {
  if (typeof value === 'string' && value.length > 0) return { user: value, controller: fallback };
  if (!isRecord(value)) return { user: fallback, controller: fallback };
  return {
    user: typeof value.user === 'string' ? value.user : fallback,
    controller: typeof value.controller === 'string' ? value.controller : fallback,
  };
}

function sameIdentity(left, right) {
  return isRecord(left) && isRecord(right) && left.user === right.user && left.controller === right.controller;
}

function admitOwnership(options = {}) {
  const repository = options.repository || options.repository_id;
  const requester = normalizeIdentity(options.requester || options.requester_identity, 'requester');
  const owner = options.current_owner || options.owner || null;
  const activeOverlap = options.active_overlap === true || options.overlap === true || options.active_work === true || (owner !== null && options.active_work !== false);
  const base = {
    schema: SCHEMAS.ownershipDecision,
    version: 1,
    repository: typeof repository === 'string' ? repository : 'unknown',
    requester: `${requester.user}:${requester.controller}`,
    owner: owner ? clone(owner) : null,
    handover: false,
    concurrency_authorised: false,
  };
  if (typeof repository !== 'string' || repository.length === 0) return result(false, 'USER_DECISION_REQUIRED', { decision: { ...base, status: 'USER_DECISION_REQUIRED', decision: 'OWNERSHIP_AMBIGUOUS', mutation_allowed: false, reason_code: 'REPOSITORY_IDENTITY_UNAVAILABLE' } });
  if (!activeOverlap) return result(true, 'OWNER_CLEAR', { decision: { ...base, status: 'ADMITTED', decision: 'OWNER_CLEAR', mutation_allowed: true, reason_code: 'NO_ACTIVE_OVERLAP' } });
  if (owner === null) return result(false, 'USER_DECISION_REQUIRED', { decision: { ...base, status: 'USER_DECISION_REQUIRED', decision: 'OWNERSHIP_AMBIGUOUS', mutation_allowed: false, reason_code: 'ACTIVE_OVERLAP_OWNER_UNAVAILABLE' } });
  const ownerIdentity = normalizeIdentity(owner, 'owner');
  if (sameIdentity(requester, ownerIdentity)) return result(true, 'OWNER_MATCH', { decision: { ...base, status: 'ADMITTED', decision: 'OWNER_MATCH', mutation_allowed: true, reason_code: 'DURABLE_OWNER_MATCH' } });

  const handover = isRecord(options.handover) && options.handover.authorised === true
    && sameIdentity(normalizeIdentity(options.handover.from, 'owner'), ownerIdentity)
    && sameIdentity(normalizeIdentity(options.handover.to, 'requester'), requester);
  if (handover) return result(true, 'HANDOVER_AUTHORISED', { decision: { ...base, status: 'ADMITTED', decision: 'HANDOVER_AUTHORISED', mutation_allowed: true, reason_code: 'EXPLICIT_HANDOVER', handover: true } });

  const concurrency = options.authorised_concurrency === true
    || (isRecord(options.authorised_concurrency) && options.authorised_concurrency.authorised === true)
    || (isRecord(options.concurrency) && options.concurrency.authorised === true);
  if (concurrency) return result(true, 'CONCURRENCY_AUTHORISED', { decision: { ...base, status: 'ADMITTED', decision: 'CONCURRENCY_AUTHORISED', mutation_allowed: true, reason_code: 'EXPLICIT_AUTHORISED_CONCURRENCY', concurrency_authorised: true } });

  const ambiguous = requester.user === ownerIdentity.user || ownerIdentity.user === 'unknown' || requester.user === 'unknown';
  const decision = {
    ...base,
    status: ambiguous ? 'USER_DECISION_REQUIRED' : 'READ_ONLY',
    decision: ambiguous ? 'OWNERSHIP_AMBIGUOUS' : 'OVERLAP_READ_ONLY',
    mutation_allowed: false,
    reason_code: ambiguous ? 'COMPETING_OWNER_AMBIGUOUS' : 'CROSS_USER_OWNERSHIP_BLOCKED',
  };
  return result(false, decision.status, { decision });
}

function replaceExecutorOwnership(options = {}) {
  if (!isRecord(options.owner)) return result(false, 'USER_DECISION_REQUIRED', { code_detail: 'OWNER_UNAVAILABLE' });
  return result(true, 'OWNER_PRESERVED', { owner: clone(options.owner), executor_replaced: true, ownership_transferred: false });
}

function candidateValue(value = {}) {
  const base = isRecord(value.base) ? value.base : {};
  return {
    pr: Object.prototype.hasOwnProperty.call(value, 'pr') ? value.pr : null,
    head: Object.prototype.hasOwnProperty.call(value, 'head') ? value.head : null,
    tree: Object.prototype.hasOwnProperty.call(value, 'tree') ? value.tree : null,
    base: {
      ref: Object.prototype.hasOwnProperty.call(base, 'ref') ? base.ref : null,
      sha: Object.prototype.hasOwnProperty.call(base, 'sha') ? base.sha : null,
    },
  };
}

function withoutKey(value, key) {
  const copy = clone(value);
  delete copy[key];
  return copy;
}

function packetIdentity(packet) {
  return { id: packet.packet_id, digest: packet.packet_digest, reference: packet.packet_reference };
}

function boundedText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0\r\n\t]/.test(value);
}

function validPacketCandidate(value) {
  return isRecord(value) && exactKeys(value, ['pr', 'head', 'tree', 'base'])
    && (value.pr === null || Number.isSafeInteger(value.pr) && value.pr >= 1)
    && (value.head === null || isSha(value.head))
    && (value.tree === null || isSha(value.tree))
    && isRecord(value.base) && exactKeys(value.base, ['ref', 'sha'])
    && (value.base.ref === null || boundedText(value.base.ref, 256))
    && (value.base.sha === null || isSha(value.base.sha))
    && candidateMode(value) !== null;
}

function candidateMode(value) {
  if (!isRecord(value) || !exactKeys(value, ['pr', 'head', 'tree', 'base'])
    || !isRecord(value.base) || !exactKeys(value.base, ['ref', 'sha'])) return null;
  const fields = [value.pr, value.head, value.tree, value.base.ref, value.base.sha];
  const none = fields.every((field) => field === null);
  if (none) return 'NONE';
  const bound = Number.isSafeInteger(value.pr) && value.pr >= 1
    && isSha(value.head) && isSha(value.tree)
    && boundedText(value.base.ref, 256) && isSha(value.base.sha);
  return bound ? 'BOUND' : null;
}

function requiredCandidateMode(gate) {
  if (typeof gate !== 'string') return null;
  const normalized = gate.toUpperCase();
  if (/^(?:G0|G1|G2|LOOP|FINAL_AUDIT|BROWSER)(?:_|$)/.test(normalized)) return 'NONE';
  if (/^(?:G3|G4)(?:_|$)/.test(normalized) || /(?:^|_)(?:REPAIR|AMEND)(?:_|$)/.test(normalized)) return 'BOUND';
  return null;
}

function validPacketFinding(value) {
  return isRecord(value) && exactKeys(value, ['id', 'severity', 'summary', 'disposition'])
    && isSafeId(value.id, 128)
    && ['none', 'info', 'low', 'medium', 'high', 'critical'].includes(value.severity)
    && boundedText(value.summary, 2048)
    && ['closed', 'deferred', 'blocking', 'observed'].includes(value.disposition);
}

function validPacketObservation(value) {
  return isRecord(value) && exactKeys(value, ['name', 'value', 'availability'])
    && isSafeId(value.name, 128)
    && (value.value === null || typeof value.value === 'string' || typeof value.value === 'number' || typeof value.value === 'boolean')
    && (typeof value.value !== 'number' || Number.isFinite(value.value))
    && ['observed', 'unavailable'].includes(value.availability);
}

function validEvidenceItem(value) {
  return isRecord(value) && exactKeys(value, ['id', 'digest', 'kind', 'summary'])
    && isSafeId(value.id, 128)
    && isDigest(value.digest)
    && isSafeId(value.kind, 128)
    && boundedText(value.summary, 2048);
}

function validateTerminalPacket(packet, options = {}) {
  const allowDraft = options.allowDraft === true;
  const keys = ['schema', 'version', 'packet_id', 'packet_digest', 'packet_reference', 'run_id', 'repository', 'controller_revision', 'lock', 'gate', 'candidate', 'outcome', 'process', 'findings', 'observations', 'qualifications', 'blockers', 'verdict', 'next_state', 'evidence', 'replay', 'created_at'];
  if (!isRecord(packet) || !exactKeys(packet, keys) || packet.schema !== SCHEMAS.packet || packet.version !== 1
    || !isSafeId(packet.packet_id) || !isDigest(packet.packet_digest) || !isSafeId(packet.packet_reference, 512)
    || !isSafeId(packet.run_id) || typeof packet.repository !== 'string' || packet.repository.length === 0
    || !isSafeId(packet.controller_revision) || typeof packet.lock !== 'string' || packet.lock.length === 0
    || typeof packet.gate !== 'string' || packet.gate.length === 0 || !validPacketCandidate(packet.candidate)
    || !['success', 'failure', 'blocked', 'interrupted'].includes(packet.outcome)
    || !isRecord(packet.process) || packet.process.status !== 'completed' || packet.process.completed !== true
    || !Number.isSafeInteger(packet.process.exit_code) || packet.process.exit_code < 0 || packet.process.exit_code > 255
    || !Array.isArray(packet.findings) || packet.findings.length > 256 || !packet.findings.every(validPacketFinding)
    || !Array.isArray(packet.observations) || packet.observations.length > 256 || !packet.observations.every(validPacketObservation)
    || !Array.isArray(packet.qualifications) || packet.qualifications.length > 256 || !packet.qualifications.every((item) => boundedText(item, 2048))
    || !Array.isArray(packet.blockers) || packet.blockers.length > 256 || !packet.blockers.every((item) => boundedText(item, 2048))
    || !['PASS', 'FAIL', 'HOLD', 'INCOMPLETE'].includes(packet.verdict) || !isRecord(packet.next_state)
    || !exactKeys(packet.next_state, ['state', 'next_admissible_action'])
    || !['TERMINAL', 'HELD', 'RECONCILIATION_REQUIRED'].includes(packet.next_state.state)
    || !isSafeId(packet.next_state.next_admissible_action)
    || !isRecord(packet.evidence) || !exactKeys(packet.evidence, ['complete', 'manifest_id', 'items']) || packet.evidence.complete !== true || !isSafeId(packet.evidence.manifest_id)
    || !Array.isArray(packet.evidence.items) || packet.evidence.items.length > 256 || !packet.evidence.items.every(validEvidenceItem)
    || !isRecord(packet.replay) || !exactKeys(packet.replay, ['durable', 'retrieval_key', 'worker_rerun_required'])
    || (packet.replay.durable !== true && !(allowDraft && packet.replay.durable === false))
    || !isSafeId(packet.replay.retrieval_key, 512) || packet.replay.worker_rerun_required !== (packet.replay.durable === true ? false : true)
    || !isTimestamp(packet.created_at)) return result(false, TERMINAL_PACKET_INCOMPLETE);
  if (packet.packet_reference !== packet.replay.retrieval_key) return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  if (packet.packet_digest !== digestValue(withoutKey(packet, 'packet_digest'))) return result(false, 'TERMINAL_PACKET_DIGEST_MISMATCH');
  const expectedCandidateMode = requiredCandidateMode(packet.gate);
  if (expectedCandidateMode !== null && candidateMode(packet.candidate) !== expectedCandidateMode) return result(false, 'TERMINAL_PACKET_CANDIDATE_MODE_MISMATCH');
  if (packet.outcome === 'success' && packet.process.exit_code !== 0) return result(false, 'TERMINAL_PACKET_PROCESS_MISMATCH');
  return result(true, allowDraft && packet.replay.durable === false ? 'TERMINAL_PACKET_DRAFT_VALID' : 'TERMINAL_PACKET_VALID', { packet: deepFreeze(clone(packet)), identity: packetIdentity(packet) });
}

function createTerminalPacket(input = {}) {
  const process = isRecord(input.process)
    ? { status: 'completed', exit_code: input.process.exit_code, completed: input.process.completed === true }
    : { status: 'completed', exit_code: Number.isSafeInteger(input.exit_code) ? input.exit_code : 0, completed: true };
  if (!isRecord(input)
    || !isSafeId(input.run_id)
    || !boundedText(input.repository, 256)
    || !isSafeId(input.controller_revision)
    || !boundedText(input.lock, 256)
    || !boundedText(input.gate, 128)
    || !['success', 'failure', 'blocked', 'interrupted'].includes(input.outcome)
    || !['PASS', 'FAIL', 'HOLD', 'INCOMPLETE'].includes(input.verdict)
    || !Number.isSafeInteger(process.exit_code) || process.exit_code < 0 || process.exit_code > 255
    || process.completed !== true
    || !isRecord(input.evidence)) return result(false, TERMINAL_PACKET_INCOMPLETE);
  let seed;
  try {
    seed = digestValue({
      schema: SCHEMAS.packet,
      version: 1,
      run_id: input.run_id,
      repository: input.repository,
      controller_revision: input.controller_revision,
      lock: input.lock,
      gate: input.gate,
      candidate: candidateValue(input.candidate),
      outcome: input.outcome,
      process,
      verdict: input.verdict,
    });
  } catch (_error) {
    return result(false, TERMINAL_PACKET_INCOMPLETE);
  }
  const packetId = input.packet_id || `terminal-${seed.slice(0, 24)}`;
  const packetReference = input.packet_reference || `terminal-packet:${packetId}`;
  const base = {
    schema: SCHEMAS.packet,
    version: 1,
    packet_id: packetId,
    packet_reference: packetReference,
    run_id: input.run_id,
    repository: input.repository,
    controller_revision: input.controller_revision,
    lock: input.lock,
    gate: input.gate,
    candidate: candidateValue(input.candidate),
    outcome: input.outcome,
    process,
    findings: Array.isArray(input.findings) ? clone(input.findings) : [],
    observations: Array.isArray(input.observations) ? clone(input.observations) : [],
    qualifications: Array.isArray(input.qualifications) ? clone(input.qualifications) : [],
    blockers: Array.isArray(input.blockers) ? clone(input.blockers) : [],
    verdict: input.verdict,
    next_state: isRecord(input.next_state) ? clone(input.next_state) : { state: 'TERMINAL', next_admissible_action: 'WEB_RECONCILE_PACKET' },
    evidence: clone(input.evidence),
    replay: { durable: false, retrieval_key: packetReference, worker_rerun_required: true },
    created_at: input.created_at || nowIso(input.now),
  };
  let packet;
  try { packet = { ...base, packet_digest: digestValue(base) }; } catch (_error) { return result(false, TERMINAL_PACKET_INCOMPLETE); }
  const checked = validateTerminalPacket(packet, { allowDraft: true });
  return checked.ok ? result(true, 'TERMINAL_PACKET_DRAFT_CREATED', { packet: checked.packet, identity: checked.identity, terminal: false, persisted: false }) : checked;
}

function bindingMatchesPacket(packet, expected = {}) {
  for (const key of ['run_id', 'repository', 'controller_revision', 'lock', 'gate']) {
    if (Object.prototype.hasOwnProperty.call(expected, key) && packet[key] !== expected[key]) return false;
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'candidate')) {
    const expectedCandidate = candidateValue(expected.candidate);
    if (candidateMode(expectedCandidate) === null
      || digestValue(packet.candidate) !== digestValue(expectedCandidate)) return false;
  }
  return true;
}

function evaluateWorkerCompletion(options = {}) {
  const process = options.process;
  if (!isRecord(process) || process.completed !== true || process.status !== 'completed' || !Number.isSafeInteger(process.exit_code)) {
    return result(false, TERMINAL_PACKET_INCOMPLETE, { terminal: false, worker_completed: false });
  }
  if (!options.packet) return result(false, TERMINAL_PACKET_INCOMPLETE, { terminal: false, worker_completed: true, packet_produced: false });
  const checked = typeof options.packet === 'string' ? parseTerminalPacket(options.packet) : validateTerminalPacket(options.packet);
  if (!checked.ok) return result(false, checked.code, { terminal: false, worker_completed: true, packet_produced: true });
  if (!bindingMatchesPacket(checked.packet, options.expected || options.binding || {})) return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH', { terminal: false, worker_completed: true, packet_produced: true, identity: checked.identity });
  return result(true, 'TERMINAL_PACKET_READY', { terminal: true, worker_completed: true, packet_produced: true, packet: checked.packet, identity: checked.identity, worker_rerun_required: false });
}

function parseTerminalPacket(value) {
  if (typeof value !== 'string' || value.length === 0) return result(false, TERMINAL_PACKET_INCOMPLETE);
  let parsed;
  try { parsed = JSON.parse(value); } catch (_error) { return result(false, TERMINAL_PACKET_INCOMPLETE); }
  return validateTerminalPacket(parsed);
}

function createPacketStore(initial = []) {
  const records = new Map();
  for (const item of initial) {
    if (isRecord(item) && typeof item.key === 'string') records.set(item.key, typeof item.value === 'string' ? item.value : clone(item.value));
  }
  return Object.freeze({
    put(key, value) { records.set(key, typeof value === 'string' ? value : clone(value)); return true; },
    get(key) { return records.has(key) ? clone(records.get(key)) : null; },
  });
}

function storePut(store, key, value) {
  if (!store || typeof store.put !== 'function' && typeof store.write !== 'function') return false;
  const fn = store.put || store.write;
  try {
    const written = fn.call(store, key, typeof value === 'string' ? value : clone(value));
    return written && typeof written.then === 'function' ? false : written !== false;
  } catch (_error) { return false; }
}

function storeGet(store, key) {
  if (!store || typeof store.get !== 'function' && typeof store.read !== 'function') return null;
  const fn = store.get || store.read;
  try {
    const value = fn.call(store, key);
    return value && typeof value.then === 'function' ? null : value;
  } catch (_error) { return null; }
}

function persistTerminalPacket(options = {}) {
  const checked = options.packet ? validateTerminalPacket(options.packet, { allowDraft: true }) : result(false, TERMINAL_PACKET_INCOMPLETE);
  if (!checked.ok) return checked;
  let packet = checked.packet;
  if (packet.replay.durable !== true) {
    const durableBase = {
      ...packet,
      replay: { durable: true, retrieval_key: packet.packet_reference, worker_rerun_required: false },
    };
    packet = { ...durableBase, packet_digest: digestValue(withoutKey(durableBase, 'packet_digest')) };
  }
  const final = validateTerminalPacket(packet);
  if (!final.ok) return final;
  if (!storePut(options.store, final.packet.packet_reference, final.packet)) return result(false, 'TERMINAL_PACKET_NOT_DURABLE', { identity: final.identity });
  const replayed = replayTerminalPacket({ store: options.store, identity: final.identity, expected: options.expected });
  if (!replayed.ok) return replayed;
  return result(true, 'TERMINAL_PACKET_DURABLE', { packet: replayed.packet, identity: replayed.identity });
}

function replayTerminalPacket(options = {}) {
  const identity = typeof options.identity === 'string' ? { reference: options.identity } : (options.identity || {});
  const key = identity.reference || identity.id;
  if (!isSafeId(key, 512)) return result(false, TERMINAL_PACKET_INCOMPLETE);
  const raw = storeGet(options.store, key);
  if (raw === null || raw === undefined) return result(false, TERMINAL_PACKET_INCOMPLETE);
  const checked = typeof raw === 'string' ? parseTerminalPacket(raw) : validateTerminalPacket(raw);
  if (!checked.ok) return checked;
  if (identity.id && checked.identity.id !== identity.id || identity.digest && checked.identity.digest !== identity.digest || identity.reference && checked.identity.reference !== identity.reference) {
    return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  }
  if (!bindingMatchesPacket(checked.packet, options.expected || {})) return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  return result(true, 'TERMINAL_PACKET_REPLAYED', { packet: checked.packet, identity: checked.identity, worker_rerun_required: false });
}

function admitNextGate(options = {}) {
  const checked = options.packet ? validateTerminalPacket(options.packet) : result(false, TERMINAL_PACKET_INCOMPLETE);
  if (!checked.ok) return checked;
  const identity = options.packet_identity || options.identity || {};
  if (!isRecord(identity) || !exactKeys(identity, ['id', 'digest', 'reference'])
    || !isSafeId(identity.id) || !isDigest(identity.digest) || !isSafeId(identity.reference, 512)
    || identity.id !== checked.identity.id || identity.digest !== checked.identity.digest || identity.reference !== checked.identity.reference) return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  const live = options.live;
  const liveKeys = ['run_id', 'repository', 'controller_revision', 'lock', 'gate', 'candidate'];
  if (!isRecord(live) || !liveKeys.every((key) => hasOwn(live, key))
    || !liveKeys.slice(0, 5).every((key) => boundedText(live[key], key === 'gate' ? 128 : 256))
    || !validPacketCandidate(live.candidate) || candidateMode(live.candidate) === null
    || !bindingMatchesPacket(checked.packet, live)) return result(false, 'LIVE_APPLICABILITY_UNAVAILABLE');
  if (typeof options.verify_applicability === 'function') {
    let applicable;
    try { applicable = options.verify_applicability(checked.packet, live); } catch (_error) { return result(false, 'LIVE_APPLICABILITY_UNAVAILABLE'); }
    if (applicable !== true) return result(false, 'LIVE_APPLICABILITY_CHANGED');
  }
  return result(true, 'NEXT_GATE_PACKET_BOUND', { identity: checked.identity, packet: checked.packet });
}

function normalizeReceiptCandidate(input, kind) {
  if (kind === 'issue') return null;
  const candidate = isRecord(input) ? input : {};
  return {
    head: isSha(candidate.head) ? candidate.head : null,
    base: isSha(candidate.base) ? candidate.base : null,
    tree: isSha(candidate.tree) ? candidate.tree : null,
    merge_commit: isSha(candidate.merge_commit) ? candidate.merge_commit : null,
  };
}

function validateTerminalReceipt(receipt) {
  const keys = ['schema', 'version', 'receipt_id', 'receipt_digest', 'object', 'terminal_disposition', 'authority', 'evidence', 'candidate', 'successor', 'created_at', 'readback'];
  if (!isRecord(receipt) || !exactKeys(receipt, keys) || receipt.schema !== SCHEMAS.receipt || receipt.version !== 1
    || !isSafeId(receipt.receipt_id) || !isDigest(receipt.receipt_digest) || !isRecord(receipt.object)
    || !exactKeys(receipt.object, ['kind', 'repository', 'number', 'terminal_state'])
    || !['issue', 'pull_request'].includes(receipt.object.kind) || !boundedText(receipt.object.repository, 256)
    || !Number.isSafeInteger(receipt.object.number) || receipt.object.number < 1
    || !['CLOSED', 'MERGED', 'CLOSED_UNMERGED'].includes(receipt.object.terminal_state)
    || !isRecord(receipt.terminal_disposition) || !exactKeys(receipt.terminal_disposition, ['kind', 'summary', 'controlling_lock'])
    || !['ISSUE_COMPLETED', 'ISSUE_SUPERSEDED', 'ISSUE_TRANSFERRED', 'ISSUE_DUPLICATE', 'ISSUE_NOT_PLANNED', 'PR_MERGED', 'PR_CLOSED_UNMERGED'].includes(receipt.terminal_disposition.kind)
    || !boundedText(receipt.terminal_disposition.summary, 2048)
    || (receipt.terminal_disposition.controlling_lock !== null && !boundedText(receipt.terminal_disposition.controlling_lock, 256))
    || !isRecord(receipt.authority) || !exactKeys(receipt.authority, ['reference', 'digest']) || !boundedText(receipt.authority.reference, 1024) || !isDigest(receipt.authority.digest)
    || !isRecord(receipt.evidence) || !exactKeys(receipt.evidence, ['reference', 'digest']) || !boundedText(receipt.evidence.reference, 1024) || !isDigest(receipt.evidence.digest)
    || (receipt.candidate !== null && (!isRecord(receipt.candidate) || !exactKeys(receipt.candidate, ['head', 'base', 'tree', 'merge_commit']) || (receipt.candidate.head !== null && !isSha(receipt.candidate.head)) || (receipt.candidate.base !== null && !isSha(receipt.candidate.base)) || (receipt.candidate.tree !== null && !isSha(receipt.candidate.tree)) || (receipt.candidate.merge_commit !== null && !isSha(receipt.candidate.merge_commit))))
    || (receipt.successor !== null && !boundedText(receipt.successor, 1024)) || !isTimestamp(receipt.created_at)
    || !isRecord(receipt.readback) || !exactKeys(receipt.readback, ['verified', 'reference', 'digest']) || receipt.readback.verified !== true || !boundedText(receipt.readback.reference, 1024) || !isDigest(receipt.readback.digest)) return result(false, TERMINAL_RECEIPT_INCOMPLETE);
  if (receipt.object.kind === 'pull_request' && receipt.object.terminal_state === 'MERGED' && (!receipt.candidate || !isSha(receipt.candidate.merge_commit))) return result(false, 'TERMINAL_RECEIPT_MERGE_IDENTITY_MISSING');
  if (receipt.object.terminal_state === 'CLOSED_UNMERGED' && receipt.candidate && receipt.candidate.merge_commit !== null) return result(false, 'TERMINAL_RECEIPT_DISPOSITION_INVALID');
  if (receipt.receipt_digest !== digestValue(withoutKey(receipt, 'receipt_digest'))) return result(false, 'TERMINAL_RECEIPT_DIGEST_MISMATCH');
  return result(true, 'TERMINAL_RECEIPT_VALID', { receipt: deepFreeze(clone(receipt)), identity: { id: receipt.receipt_id, digest: receipt.receipt_digest, reference: receipt.readback.reference } });
}

function createTerminalReceipt(input = {}) {
  if (!isRecord(input)) return result(false, TERMINAL_RECEIPT_INCOMPLETE);
  const object = isRecord(input.object) ? input.object : {};
  if (!['issue', 'pull_request'].includes(object.kind)
    || !boundedText(object.repository, 256)
    || !Number.isSafeInteger(object.number) || object.number < 1
    || (object.terminal_state !== undefined && !['CLOSED', 'MERGED', 'CLOSED_UNMERGED'].includes(object.terminal_state))) {
    return result(false, TERMINAL_RECEIPT_INCOMPLETE);
  }
  if (!isRecord(input.authority) || !isRecord(input.evidence) || !isRecord(input.readback)) {
    return result(false, TERMINAL_RECEIPT_INCOMPLETE);
  }
  const kind = object.kind === 'pull_request' ? 'pull_request' : 'issue';
  const terminalState = object.terminal_state || (kind === 'pull_request' ? 'CLOSED_UNMERGED' : 'CLOSED');
  const dispositionKind = input.terminal_disposition?.kind || (kind === 'pull_request' && terminalState === 'MERGED' ? 'PR_MERGED' : kind === 'pull_request' ? 'PR_CLOSED_UNMERGED' : 'ISSUE_COMPLETED');
  const base = {
    schema: SCHEMAS.receipt,
    version: 1,
    object: { kind, repository: object.repository, number: object.number, terminal_state: terminalState },
    terminal_disposition: {
      kind: dispositionKind,
      summary: input.terminal_disposition?.summary || 'Terminal outcome reconciled from the controlling authority.',
      controlling_lock: input.terminal_disposition?.controlling_lock ?? null,
    },
    authority: clone(input.authority),
    evidence: clone(input.evidence),
    candidate: normalizeReceiptCandidate(input.candidate, kind),
    successor: input.successor ?? null,
    created_at: input.created_at || nowIso(input.now),
    readback: clone(input.readback),
  };
  let seed;
  try { seed = digestValue(base); } catch (_error) { return result(false, TERMINAL_RECEIPT_INCOMPLETE); }
  const receipt = { ...base, receipt_id: input.receipt_id || `receipt-${seed.slice(0, 24)}` };
  try { receipt.receipt_digest = digestValue(receipt); } catch (_error) { return result(false, TERMINAL_RECEIPT_INCOMPLETE); }
  const checked = validateTerminalReceipt(receipt);
  return checked.ok ? result(true, 'TERMINAL_RECEIPT_CREATED', { receipt: checked.receipt, identity: checked.identity }) : checked;
}

function sameTerminalObject(left, right) {
  return isRecord(left) && isRecord(right)
    && left.kind === right.kind
    && left.repository === right.repository
    && left.number === right.number
    && left.terminal_state === right.terminal_state;
}

function independentReadbackMatches(observed, object, readback) {
  if (!isRecord(observed) || observed.verified !== true
    || observed.reference !== readback.reference || observed.digest !== readback.digest) return false;
  const observedObject = observed.object || observed.terminal_object || observed.observed_object;
  if (observedObject) return sameTerminalObject(observedObject, object);
  return observed.kind === object.kind
    && observed.repository === object.repository
    && observed.number === object.number
    && observed.terminal_state === object.terminal_state;
}

function reconcileTerminalReceipt(options = {}) {
  const object = options.object;
  const terminal = isRecord(object) && ['CLOSED', 'MERGED', 'CLOSED_UNMERGED'].includes(object.terminal_state);
  if (terminal && !options.receipt) return result(false, TERMINAL_RECEIPT_INCOMPLETE, { replay_allowed: false, reopen_allowed: false });
  if (!options.receipt) return result(true, 'TERMINAL_RECEIPT_NOT_YET_REQUIRED', { terminal: false });
  const checked = validateTerminalReceipt(options.receipt);
  if (!checked.ok) return checked;
  const observedObject = isRecord(object) ? object : checked.receipt.object;
  if (isRecord(object) && !sameTerminalObject(checked.receipt.object, object)) return result(false, 'TERMINAL_RECEIPT_IDENTITY_MISMATCH', { replay_allowed: false, reopen_allowed: false });
  const observed = options.observed_readback || options.observedReadback || options.readback_observation || null;
  if (!independentReadbackMatches(observed, observedObject, checked.receipt.readback)) {
    return result(false, 'TERMINAL_RECEIPT_READBACK_UNVERIFIED', { replay_allowed: false, reopen_allowed: false });
  }
  return result(true, options.transport_ambiguous === true ? 'TERMINAL_RECEIPT_AMBIGUOUS_OUTCOME_RECONCILED' : 'TERMINAL_RECEIPT_READBACK_VERIFIED', { receipt: checked.receipt, identity: checked.identity, replay_allowed: false, reopen_allowed: false });
}

module.exports = Object.freeze({
  REGISTRY_PATH,
  SCHEMAS,
  STAGES,
  STACK_IDS,
  CONTROLLER_MODES,
  HARNESS_POLICY,
  ROUTE_STATUSES,
  EXECUTION_PATHS,
  TERMINAL_PACKET_INCOMPLETE,
  TERMINAL_RECEIPT_INCOMPLETE,
  canonicalSerialize,
  digestValue,
  validateRegistry,
  loadRegistry,
  registryIdentity,
  routeSignature,
  resolveRoute,
  validateRouteBinding,
  planExecution,
  bindRepositoryFence,
  validateRepositoryFence,
  admitRepositoryMutation,
  admitMutation: admitRepositoryMutation,
  admitRepositoryAccess: admitRepositoryMutation,
  admitOwnership,
  evaluateOwnership: admitOwnership,
  replaceExecutorOwnership,
  createTerminalPacket,
  validateTerminalPacket,
  parseTerminalPacket,
  evaluateWorkerCompletion,
  completeWorker: evaluateWorkerCompletion,
  createPacketStore,
  persistTerminalPacket,
  replayTerminalPacket,
  admitNextGate,
  createTerminalReceipt,
  validateTerminalReceipt,
  reconcileTerminalReceipt,
  resolveAmbiguousTerminalTransport: reconcileTerminalReceipt,
});
