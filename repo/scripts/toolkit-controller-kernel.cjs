#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v1.json');
const DEFAULT_REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

const SCHEMAS = Object.freeze({
  router: 'toolkit.controller.contract-router.v1',
  routeBinding: 'toolkit.controller.route-binding.v1',
  routeDecision: 'toolkit.controller.route-decision.v1',
  ownershipDecision: 'toolkit.controller.ownership-decision.v1',
  executionPlan: 'toolkit.controller.execution-plan.v1',
  packet: 'toolkit.controller.terminal-packet.v1',
  receipt: 'toolkit.controller.terminal-receipt.v1',
});
const STAGES = Object.freeze(['G0', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'FINAL_AUDIT', 'BROWSER']);
const STACK_IDS = Object.freeze(['owner-openai', 'owner-claude']);
const HARNESS_POLICY = Object.freeze({
  'claude-code': 'owner-claude',
  codex: 'owner-openai',
  opencode: 'owner-openai',
});
const ROUTE_STATUSES = Object.freeze(['USER_DECISION_REQUIRED', 'ROUTE_UNAVAILABLE', 'ROUTE_RESOLVED']);
const EXECUTION_PATHS = Object.freeze(['direct-web-executor', 'accepted-a2-loop-reconciliation']);
const TERMINAL_PACKET_INCOMPLETE = 'TERMINAL_PACKET_INCOMPLETE';
const TERMINAL_RECEIPT_INCOMPLETE = 'TERMINAL_RECEIPT_INCOMPLETE';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  if (!exactKeys(value, ['provider', 'model', 'reasoning'])) return null;
  if (![value.provider, value.model, value.reasoning].every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256)) return null;
  return { provider: value.provider, model: value.model, reasoning: value.reasoning };
}

function routeSignature(route) {
  const normalized = routeOnly(route);
  return normalized ? `${normalized.provider}/${normalized.model}/${normalized.reasoning}` : null;
}

function validateRegistry(registry) {
  if (!isRecord(registry)
    || !exactKeys(registry, ['schema', 'version', 'stacks'])
    || registry.schema !== 'toolkit.controller.stack-registry.v1'
    || registry.version !== 1
    || !isRecord(registry.stacks)
    || Object.prototype.hasOwnProperty.call(registry, 'default_stack')
    || Object.keys(registry.stacks).length < 2) return result(false, 'STACK_REGISTRY_INVALID');
  for (const stackId of Object.keys(registry.stacks)) {
    if (!STACK_IDS.includes(stackId)) return result(false, 'STACK_REGISTRY_STACK_UNSUPPORTED', { stack_id: stackId });
    const stack = registry.stacks[stackId];
    if (!isRecord(stack) || !exactKeys(stack, ['routes', 'subagents']) || !isRecord(stack.routes) || !isRecord(stack.subagents)) {
      return result(false, 'STACK_REGISTRY_STACK_INVALID', { stack_id: stackId });
    }
    if (!STAGES.every((stage) => hasOwn(stack.routes, stage)) || !exactKeys(stack.routes, STAGES)) {
      return result(false, 'STACK_REGISTRY_ROUTE_SET_INVALID', { stack_id: stackId });
    }
    if (!exactKeys(stack.subagents, ['G0', 'G3'])) return result(false, 'STACK_REGISTRY_SUBAGENT_SET_INVALID', { stack_id: stackId });
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

function registryIdentity(registry = DEFAULT_REGISTRY, revision = 'workspace') {
  const checked = loadRegistry(registry);
  if (!checked.ok || !isSafeId(String(revision))) return result(false, 'REGISTRY_IDENTITY_UNAVAILABLE');
  return result(true, 'REGISTRY_IDENTITY_READY', {
    identity: { revision: String(revision), digest: checked.digest },
  });
}

function normalizeHarness(options = {}) {
  const raw = options.harness_identity || options.verified_harness || options.harness || null;
  if (typeof raw === 'string') {
    return {
      name: ['claude-code', 'codex', 'opencode'].includes(raw) ? raw : 'unknown',
      verified: options.harness_verified === true,
      source: ['hook', 'adapter', 'runtime'].includes(options.harness_source) ? options.harness_source : 'adapter',
    };
  }
  if (isRecord(raw)) {
    return {
      name: ['claude-code', 'codex', 'opencode'].includes(raw.name) ? raw.name : 'unknown',
      verified: raw.verified === true,
      source: ['hook', 'adapter', 'runtime'].includes(raw.source) ? raw.source : 'unavailable',
    };
  }
  return { name: 'unknown', verified: false, source: 'unavailable' };
}

function explicitStackSelection(options) {
  const keys = ['selected_stack', 'explicit_stack', 'stack_selection', 'user_stack'];
  const key = keys.find((item) => hasOwn(options, item));
  if (!key) return { present: false, value: null };
  const raw = options[key];
  if (typeof raw === 'string') return { present: true, value: raw };
  if (isRecord(raw) && typeof raw.stack_id === 'string') return { present: true, value: raw.stack_id };
  return { present: true, value: null };
}

function routeCapabilityAvailable(route, options = {}) {
  const verifier = options.route_verifier || options.routeVerifier;
  if (typeof verifier === 'function') {
    let checked;
    try { checked = verifier(clone(route)); } catch (_error) { return false; }
    if (checked && typeof checked.then === 'function') return false;
    return checked === true || (isRecord(checked) && checked.available === true);
  }
  if (typeof options.route_available === 'boolean') return options.route_available;
  if (typeof options.available === 'boolean') return options.available;
  if (isRecord(options.runtime_route)) return routeSignature(options.runtime_route) === routeSignature(route);
  if (isRecord(options.capability)) return routeSignature(options.capability) === routeSignature(route);
  if (Array.isArray(options.available_routes)) return options.available_routes.includes(routeSignature(route));
  return true;
}

function routeDecision(stage, selectionSource, status, reasonCode, selectedStack = null) {
  return {
    schema: SCHEMAS.routeDecision,
    version: 1,
    status,
    stage,
    selection_source: selectionSource,
    selected_stack: selectedStack,
    reason_code: reasonCode,
    repair_budget_consumed: false,
  };
}

function resolveRoute(options = {}) {
  const stage = options.stage;
  if (!STAGES.includes(stage)) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision('UNKNOWN', 'none', 'ROUTE_UNAVAILABLE', 'STAGE_UNAVAILABLE') });
  const loaded = loadRegistry(options.registry || DEFAULT_REGISTRY);
  if (!loaded.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, 'none', 'ROUTE_UNAVAILABLE', loaded.code) });

  const explicit = explicitStackSelection(options);
  const harness = normalizeHarness(options);
  let stackId;
  let selectionSource;
  if (explicit.present) {
    stackId = explicit.value;
    selectionSource = 'explicit_web_binding';
    if (!STACK_IDS.includes(stackId) || !loaded.registry.stacks[stackId]) {
      return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'SELECTED_STACK_UNAVAILABLE', stackId) });
    }
  } else if (harness.verified === true && HARNESS_POLICY[harness.name]) {
    stackId = HARNESS_POLICY[harness.name];
    selectionSource = 'verified_harness_policy';
  } else {
    return result(false, 'USER_DECISION_REQUIRED', {
      decision: routeDecision(stage, 'none', 'USER_DECISION_REQUIRED', 'HARNESS_UNVERIFIED_OR_UNKNOWN'),
      harness_identity: harness,
    });
  }

  if (stage === 'LOOP' && options.a2_accepted !== true) {
    return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'A2_NOT_ACCEPTED', stackId) });
  }
  const route = routeOnly(loaded.registry.stacks[stackId].routes[stage]);
  if (!route || !routeCapabilityAvailable(route, options)) {
    return result(false, 'ROUTE_UNAVAILABLE', {
      decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'REQUESTED_ROUTE_UNAVAILABLE', stackId),
      selected_stack: stackId,
      route: route || null,
    });
  }
  const identity = registryIdentity(loaded.registry, options.registry_revision || options.registryRevision || 'workspace');
  if (!identity.ok) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', identity.code, stackId) });
  const threadId = options.thread_id || options.threadId || `thread-${digestValue({ stage, stackId, route, registry: identity.identity }).slice(0, 24)}`;
  if (!isSafeId(threadId)) return result(false, 'ROUTE_UNAVAILABLE', { decision: routeDecision(stage, selectionSource, 'ROUTE_UNAVAILABLE', 'THREAD_ID_INVALID', stackId) });
  const a2Status = options.a2_accepted === true ? 'accepted' : 'not-accepted';
  const binding = {
    schema: SCHEMAS.routeBinding,
    version: 1,
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

function validateRouteBinding(binding) {
  const keys = ['schema', 'version', 'thread_id', 'stage', 'stack_id', 'selection_source', 'harness_identity', 'registry_identity', 'route', 'route_digest', 'execution_path', 'a2_status', 'status', 'repair_budget_consumed'];
  if (!isRecord(binding) || !exactKeys(binding, keys)
    || binding.schema !== SCHEMAS.routeBinding || binding.version !== 1
    || !isSafeId(binding.thread_id) || !STAGES.includes(binding.stage) || !STACK_IDS.includes(binding.stack_id)
    || !['explicit_web_binding', 'verified_harness_policy'].includes(binding.selection_source)
    || !isRecord(binding.harness_identity) || typeof binding.harness_identity.name !== 'string'
    || typeof binding.harness_identity.verified !== 'boolean' || typeof binding.harness_identity.source !== 'string'
    || !isRecord(binding.registry_identity) || !isSafeId(binding.registry_identity.revision) || !isDigest(binding.registry_identity.digest)
    || !routeOnly(binding.route) || !isDigest(binding.route_digest) || binding.route_digest !== digestValue(binding.route)
    || !EXECUTION_PATHS.includes(binding.execution_path) || !['not-accepted', 'accepted'].includes(binding.a2_status)
    || binding.status !== 'ROUTE_RESOLVED' || binding.repair_budget_consumed !== false) return result(false, 'ROUTE_BINDING_INVALID');
  return result(true, 'ROUTE_BINDING_VALID', { binding: clone(binding) });
}

function planExecution(options = {}) {
  const resolved = options.binding ? validateRouteBinding(options.binding) : resolveRoute(options);
  if (!resolved.ok) return resolved;
  const binding = resolved.binding;
  const plan = {
    schema: SCHEMAS.executionPlan,
    version: 1,
    thread_id: binding.thread_id,
    stage: binding.stage,
    route_binding: clone(binding),
    execution_path: binding.execution_path,
    loop_invoked: false,
    web_reconciliation_required: true,
  };
  return result(true, 'EXECUTION_PLAN_READY', { plan: deepFreeze(plan) });
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
  const activeOverlap = options.active_overlap === true || options.overlap === true || (owner !== null && options.active_work !== false);
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
  if (!activeOverlap || owner === null) return result(true, 'OWNER_CLEAR', { decision: { ...base, status: 'ADMITTED', decision: 'OWNER_CLEAR', mutation_allowed: true, reason_code: 'NO_ACTIVE_OVERLAP' } });
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
    pr: Number.isSafeInteger(value.pr) ? value.pr : null,
    head: isSha(value.head) ? value.head : null,
    tree: isSha(value.tree) ? value.tree : null,
    base: {
      ref: typeof base.ref === 'string' && base.ref.length > 0 ? base.ref : null,
      sha: isSha(base.sha) ? base.sha : null,
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
    && (value.base.sha === null || isSha(value.base.sha));
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

function validateTerminalPacket(packet) {
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
    || !isRecord(packet.replay) || !exactKeys(packet.replay, ['durable', 'retrieval_key', 'worker_rerun_required']) || packet.replay.durable !== true
    || !isSafeId(packet.replay.retrieval_key, 512) || packet.replay.worker_rerun_required !== false
    || !isTimestamp(packet.created_at)) return result(false, TERMINAL_PACKET_INCOMPLETE);
  if (packet.packet_reference !== packet.replay.retrieval_key) return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  if (packet.packet_digest !== digestValue(withoutKey(packet, 'packet_digest'))) return result(false, 'TERMINAL_PACKET_DIGEST_MISMATCH');
  if (packet.outcome === 'success' && packet.process.exit_code !== 0) return result(false, 'TERMINAL_PACKET_PROCESS_MISMATCH');
  return result(true, 'TERMINAL_PACKET_VALID', { packet: deepFreeze(clone(packet)), identity: packetIdentity(packet) });
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
    || process.completed !== true) return result(false, TERMINAL_PACKET_INCOMPLETE);
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
    evidence: isRecord(input.evidence) ? clone(input.evidence) : { complete: true, manifest_id: `manifest:${packetId}`, items: [] },
    replay: { durable: true, retrieval_key: packetReference, worker_rerun_required: false },
    created_at: input.created_at || nowIso(input.now),
  };
  let packet;
  try { packet = { ...base, packet_digest: digestValue(base) }; } catch (_error) { return result(false, TERMINAL_PACKET_INCOMPLETE); }
  const checked = validateTerminalPacket(packet);
  return checked.ok ? result(true, 'TERMINAL_PACKET_CREATED', { packet: checked.packet, identity: checked.identity }) : checked;
}

function bindingMatchesPacket(packet, expected = {}) {
  if (expected.run_id && packet.run_id !== expected.run_id) return false;
  if (expected.repository && packet.repository !== expected.repository) return false;
  if (expected.controller_revision && packet.controller_revision !== expected.controller_revision) return false;
  if (expected.lock && packet.lock !== expected.lock) return false;
  if (expected.gate && packet.gate !== expected.gate) return false;
  if (expected.candidate && digestValue(packet.candidate) !== digestValue(candidateValue(expected.candidate))) return false;
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
  const checked = options.packet ? validateTerminalPacket(options.packet) : result(false, TERMINAL_PACKET_INCOMPLETE);
  if (!checked.ok) return checked;
  if (!storePut(options.store, checked.packet.packet_reference, checked.packet)) return result(false, 'TERMINAL_PACKET_NOT_DURABLE', { identity: checked.identity });
  const replayed = replayTerminalPacket({ store: options.store, identity: checked.identity, expected: options.expected });
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
  if (identity.id && identity.id !== checked.identity.id || identity.digest && identity.digest !== checked.identity.digest || identity.reference && identity.reference !== checked.identity.reference) return result(false, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  const live = options.live;
  if (!isRecord(live) || !bindingMatchesPacket(checked.packet, live)) return result(false, 'LIVE_APPLICABILITY_UNAVAILABLE');
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
  const kind = object.kind === 'pull_request' ? 'pull_request' : 'issue';
  const terminalState = object.terminal_state || (kind === 'pull_request' ? 'CLOSED_UNMERGED' : 'CLOSED');
  const dispositionKind = input.terminal_disposition?.kind || (kind === 'pull_request' && terminalState === 'MERGED' ? 'PR_MERGED' : kind === 'pull_request' ? 'PR_CLOSED_UNMERGED' : 'ISSUE_COMPLETED');
  const authority = isRecord(input.authority) ? clone(input.authority) : { reference: 'authority:unavailable', digest: digestValue({ kind, number: object.number, type: 'authority' }) };
  const evidence = isRecord(input.evidence) ? clone(input.evidence) : { reference: 'evidence:unavailable', digest: digestValue({ kind, number: object.number, type: 'evidence' }) };
  const base = {
    schema: SCHEMAS.receipt,
    version: 1,
    object: { kind, repository: object.repository, number: object.number, terminal_state: terminalState },
    terminal_disposition: {
      kind: dispositionKind,
      summary: input.terminal_disposition?.summary || 'Terminal outcome reconciled from the controlling authority.',
      controlling_lock: input.terminal_disposition?.controlling_lock ?? null,
    },
    authority,
    evidence,
    candidate: normalizeReceiptCandidate(input.candidate, kind),
    successor: input.successor ?? null,
    created_at: input.created_at || nowIso(input.now),
    readback: {
      verified: true,
      reference: input.readback?.reference || `receipt:${kind}:${object.repository}:${object.number}`,
      digest: input.readback?.digest || digestValue({ kind, number: object.number, terminalState, evidence: evidence.digest }),
    },
  };
  let seed;
  try { seed = digestValue(base); } catch (_error) { return result(false, TERMINAL_RECEIPT_INCOMPLETE); }
  const receipt = { ...base, receipt_id: input.receipt_id || `receipt-${seed.slice(0, 24)}` };
  try { receipt.receipt_digest = digestValue(receipt); } catch (_error) { return result(false, TERMINAL_RECEIPT_INCOMPLETE); }
  const checked = validateTerminalReceipt(receipt);
  return checked.ok ? result(true, 'TERMINAL_RECEIPT_CREATED', { receipt: checked.receipt, identity: checked.identity }) : checked;
}

function reconcileTerminalReceipt(options = {}) {
  const object = options.object;
  const terminal = isRecord(object) && ['CLOSED', 'MERGED', 'CLOSED_UNMERGED'].includes(object.terminal_state);
  if (terminal && !options.receipt) return result(false, TERMINAL_RECEIPT_INCOMPLETE, { replay_allowed: false, reopen_allowed: false });
  if (!options.receipt) return result(true, 'TERMINAL_RECEIPT_NOT_YET_REQUIRED', { terminal: false });
  const checked = validateTerminalReceipt(options.receipt);
  if (!checked.ok) return checked;
  if (isRecord(object) && (checked.receipt.object.kind !== object.kind || checked.receipt.object.repository !== object.repository || checked.receipt.object.number !== object.number || checked.receipt.object.terminal_state !== object.terminal_state)) return result(false, 'TERMINAL_RECEIPT_IDENTITY_MISMATCH', { replay_allowed: false, reopen_allowed: false });
  return result(true, options.transport_ambiguous === true ? 'TERMINAL_RECEIPT_AMBIGUOUS_OUTCOME_RECONCILED' : 'TERMINAL_RECEIPT_READBACK_VERIFIED', { receipt: checked.receipt, identity: checked.identity, replay_allowed: false, reopen_allowed: false });
}

module.exports = Object.freeze({
  REGISTRY_PATH,
  SCHEMAS,
  STAGES,
  STACK_IDS,
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
