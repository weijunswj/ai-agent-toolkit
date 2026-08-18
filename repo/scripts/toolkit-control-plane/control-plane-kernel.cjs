'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'toolkit.control-plane.kernel.v1';
const REMOTE_IDENTITY_CONTRACT_VERSION = 'toolkit.control-plane.remote-identity.v1';
const TICKET_CONTRACT_VERSION = 'toolkit.control-plane.authority-ticket.v1';
const STRUCTURAL_IMPACT_CONTRACT_VERSION = 'toolkit.control-plane.structural-impact.v1';

const LIMITS = Object.freeze({
  graphDepth: 32,
  compoundDepth: 8,
  compoundComponents: 16,
  totalCompoundComponents: 128,
  ownKeysPerNode: 64,
  arrayLength: 64,
  observedNodes: 512,
  capturedKeys: 8192,
  scalarLength: 4096,
  totalStringUnits: 131072,
  retainedIssues: 1024,
  ticketEntries: 256,
  ticketMaxUses: 8,
  ticketDefaultUses: 1,
  ticketMaxLifetimeMs: 300000,
});

const OPERATION_TYPES = Object.freeze([
  'filesystem.read', 'filesystem.write', 'filesystem.create', 'filesystem.move', 'filesystem.delete',
  'git.read', 'git.branch', 'git.push', 'github.read', 'github.mutation', 'network.request',
  'external.mutation', 'compound', 'shell',
]);
const OPERATION_TYPE_SET = new Set(OPERATION_TYPES);
const HARD_DENY_PRECEDENCE = Object.freeze([
  'CALLER_FINALITY_REJECTED',
  'SECRET_EXFILTRATION_DENIED',
  'CATASTROPHIC_TARGET_DENIED',
]);
const STRUCTURAL_KINDS = new Set([
  'rename', 'remove', 'move', 'resignature', 're-signature', 'contract-shape', 'generated-surface',
  'path', 'symbol', 'command', 'schema-field', 'public-contract', 'internal-contract',
  'repository-identity', 'structural-replace', 'replace',
]);
const RESOLVER_LINK_TYPES = new Set(['none', 'symlink', 'junction', 'reparse-point']);
const SAFE_PUSH_OPTIONS = new Set(['--porcelain', '--dry-run']);
const SECRET_PATH_PARTS = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'credentials', 'secrets']);

const POLICY = Object.freeze({
  policy_version: '1.0.0',
  design_lock: 'DL-AGENT-NATIVE-LOOP-MVP-001-A1-SOIR-R1',
  default_off: true,
  decision_contract: Object.freeze(['allow', 'ask', 'deny', 'unsupported']),
  operation_types: OPERATION_TYPES,
  observation: Object.freeze({
    graph_depth: LIMITS.graphDepth,
    compound_depth: LIMITS.compoundDepth,
    compound_components: LIMITS.compoundComponents,
    total_compound_components: LIMITS.totalCompoundComponents,
    own_keys_per_node: LIMITS.ownKeysPerNode,
    array_length: LIMITS.arrayLength,
    observed_nodes: LIMITS.observedNodes,
    captured_keys: LIMITS.capturedKeys,
    scalar_length: LIMITS.scalarLength,
    total_string_units: LIMITS.totalStringUnits,
    retained_issues: LIMITS.retainedIssues,
  }),
  authority_ticket: Object.freeze({
    max_entries: LIMITS.ticketEntries,
    max_uses: LIMITS.ticketMaxUses,
    default_uses: LIMITS.ticketDefaultUses,
    max_lifetime_ms: LIMITS.ticketMaxLifetimeMs,
    immutable_binding: true,
    atomic_consumption: true,
    public_self_mint: false,
    duck_typed_store: false,
  }),
  hard_deny_precedence: HARD_DENY_PRECEDENCE,
});

const trustedContexts = new WeakSet();
const ticketBindings = new WeakMap();
let ticketSequence = 0;

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObjectLike(value) {
  const type = typeof value;
  return value !== null && (type === 'object' || type === 'function');
}

function safeOwnKeys(value) {
  try {
    return { ok: true, keys: Reflect.ownKeys(value) };
  } catch (_error) {
    return { ok: false, keys: [] };
  }
}

function safeDescriptor(value, key) {
  try {
    return { ok: true, descriptor: Object.getOwnPropertyDescriptor(value, key) };
  } catch (_error) {
    return { ok: false, descriptor: undefined };
  }
}

function safePrototype(value) {
  try {
    return { ok: true, prototype: Object.getPrototypeOf(value) };
  } catch (_error) {
    return { ok: false, prototype: undefined };
  }
}

function safeArrayClassification(value) {
  try {
    return { ok: true, array: Array.isArray(value) };
  } catch (_error) {
    return { ok: false, array: false };
  }
}

function safeType(value) {
  try {
    return typeof value;
  } catch (_error) {
    return 'unknown';
  }
}

function isCanonicalIndex(key) {
  if (typeof key !== 'string' || key === '') return false;
  if (key === '0') return true;
  if (key[0] === '0') return false;
  const number = Number(key);
  return Number.isSafeInteger(number) && number >= 0 && number < 4294967295 && String(number) === key;
}

function sortOwnKeys(keys) {
  const strings = [];
  const symbols = [];
  for (const key of keys) {
    if (typeof key === 'string') strings.push(key);
    else symbols.push(key);
  }
  strings.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return strings.concat(symbols);
}

function issue(context, code, path, node) {
  if (node) node.invalid = true;
  if (context.issueLimitRecorded) return;
  if (context.issues.length < LIMITS.retainedIssues - 1) {
    context.issues.push({ code, path });
    return;
  }
  context.issueLimitRecorded = true;
  const marker = { code: 'OBSERVATION_ISSUE_LIMIT', path: '$' };
  if (context.issues.length < LIMITS.retainedIssues) context.issues.push(marker);
  else context.issues[LIMITS.retainedIssues - 1] = marker;
}

function recordString(context, value, path, node) {
  if (typeof value !== 'string') return;
  const units = value.length;
  if (units > LIMITS.scalarLength) issue(context, 'OBSERVATION_SCALAR_LIMIT', path, node);
  context.stringUnits += units;
  if (context.stringUnits > LIMITS.totalStringUnits) issue(context, 'OBSERVATION_STRING_TOTAL_LIMIT', path, node);
}

function keyToken(key) {
  return typeof key === 'string' ? `s:${key}` : key;
}

function registerKey(context, node, key, countForGlobal) {
  const token = keyToken(key);
  if (node.keyTokens.has(token)) return false;
  node.keyTokens.add(token);
  if (typeof key === 'string') recordString(context, key, `${node.path}.${key}`, node);
  if (countForGlobal && key !== 'length') {
    context.capturedKeys += 1;
    if (context.capturedKeys > LIMITS.capturedKeys) issue(context, 'OBSERVATION_CAPTURED_KEY_LIMIT', node.path, node);
  }
  return true;
}

function makeNode(kind, path) {
  return {
    kind,
    path,
    children: [],
    byString: Object.create(null),
    byIndex: Object.create(null),
    keyTokens: new Set(),
    metadata: Object.create(null),
    invalid: false,
    ownKeysComplete: false,
    prototypeValid: false,
    lengthValid: false,
    lengthValue: null,
    scalar: undefined,
  };
}

function opaqueTicketNode(value, path) {
  return { kind: 'opaque-ticket', path, opaque: value, children: [], invalid: false };
}

function knownFields(spec) {
  const commonOperation = ['type', 'target', 'source', 'destination', 'repository', 'action', 'method', 'remote', 'refspecs', 'options', 'authorized_remote', 'authorized_ref', 'mode', 'branch', 'shell', 'command', 'no_clobber', 'components'];
  const fields = {
    input: ['enabled', 'activation', 'now', 'repository', 'authority', 'operation', 'ticket', 'session', 'scope'],
    activation: ['mode', 'consented'],
    repository: ['root', 'worktree', 'remote', 'resolution'],
    authority: ['role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types'],
    session: ['session_id', 'turn_id', 'call_id'],
    resolution: ['status', 'canonical_path', 'link_type', 'existence'],
    target: ['path', 'kind', 'digest', 'resolution', 'target_class', 'resolved_inside'],
    externalTarget: ['kind', 'digest'],
    operation: commonOperation,
    structural: ['kind', 'identity'],
  };
  return fields[spec] || null;
}

function childSpec(parentSpec, key) {
  if (parentSpec === 'input') {
    if (key === 'activation') return 'activation';
    if (key === 'repository') return 'repository';
    if (key === 'authority') return 'authority';
    if (key === 'operation') return 'operation';
    if (key === 'session') return 'session';
    if (key === 'ticket') return 'opaque-ticket';
  }
  if (parentSpec === 'repository' && key === 'resolution') return 'resolution';
  if (parentSpec === 'target' && key === 'resolution') return 'resolution';
  if (parentSpec === 'operation') {
    if (key === 'target' || key === 'source' || key === 'destination') return 'target';
    if (key === 'components') return 'operation-array';
    if (key === 'refspecs' || key === 'options') return 'string-array';
  }
  if (parentSpec === 'operation-array') return 'operation';
  if (parentSpec === 'authority' && key === 'allowed_operation_types') return 'string-array';
  return null;
}

function addChild(node, key, child, descriptor) {
  const entry = { key, node: child, metadata: descriptor };
  node.children.push(entry);
  if (typeof key === 'string') {
    node.byString[key] = entry;
    if (isCanonicalIndex(key)) node.byIndex[key] = entry;
  }
}

function observeValue(value, spec, context, path, depth) {
  if (context.observedNodes >= LIMITS.observedNodes) return null;
  context.observedNodes += 1;
  if (depth > LIMITS.graphDepth) {
    const node = makeNode('unknown', path);
    issue(context, 'OBSERVATION_GRAPH_DEPTH_LIMIT', path, node);
    return node;
  }
  const type = safeType(value);
  if (spec === 'opaque-ticket') return opaqueTicketNode(value, path);
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint' || type === 'undefined' || type === 'symbol') {
    const node = makeNode('scalar', path);
    node.scalar = value;
    node.scalarType = type;
    if (type === 'string') recordString(context, value, path, node);
    if (type === 'symbol' || type === 'bigint' || type === 'undefined') node.invalid = true;
    return node;
  }
  if (!isObjectLike(value)) {
    const node = makeNode('unknown', path);
    issue(context, 'OBSERVATION_TYPE_INVALID', path, node);
    return node;
  }
  if (context.active.has(value)) {
    const node = makeNode('unknown', path);
    issue(context, 'OBSERVATION_CYCLE', path, node);
    return node;
  }
  context.active.add(value);
  let result;
  const arrayResult = safeArrayClassification(value);
  if (!arrayResult.ok) {
    result = makeNode('unknown', path);
    issue(context, 'OBSERVATION_ARRAY_PROBE_FAILED', path, result);
  } else if (arrayResult.array) {
    result = observeArray(value, spec, context, path, depth);
  } else {
    result = observeRecord(value, spec, context, path, depth);
  }
  context.active.delete(value);
  return result;
}

function probeRecordKey(value, node, key, spec, context, path, depth) {
  registerKey(context, node, key, true);
  const descriptorResult = safeDescriptor(value, key);
  if (!descriptorResult.ok) {
    issue(context, 'OBSERVATION_DESCRIPTOR_FAILED', `${path}.${typeof key === 'string' ? key : '@symbol'}`, node);
    return;
  }
  const descriptor = descriptorResult.descriptor;
  if (!descriptor) {
    node.metadata[key] = { present: false };
    return;
  }
  if (!own(descriptor, 'value')) {
    node.metadata[key] = { present: true, data: false, enumerable: Boolean(descriptor.enumerable) };
    issue(context, 'OBSERVATION_ACCESSOR', `${path}.${typeof key === 'string' ? key : '@symbol'}`, node);
    return;
  }
  const metadata = { present: true, data: true, enumerable: descriptor.enumerable === true, configurable: descriptor.configurable === true, writable: descriptor.writable === true };
  node.metadata[key] = metadata;
  if (!metadata.enumerable) issue(context, 'OBSERVATION_HIDDEN_KEY', `${path}.${typeof key === 'string' ? key : '@symbol'}`, node);
  const childPath = `${path}.${typeof key === 'string' ? key : '@symbol'}`;
  const child = observeValue(descriptor.value, childSpec(spec, key), context, childPath, depth + 1);
  if (child) addChild(node, key, child, metadata);
  else issue(context, 'OBSERVATION_NODE_LIMIT', childPath, node);
}


function probeKnownRecordKey(value, node, key, spec, context, path, depth) {
  const fieldPath = path + '.' + key;
  const descriptorResult = safeDescriptor(value, key);
  if (!descriptorResult.ok) {
    issue(context, 'OBSERVATION_DESCRIPTOR_FAILED', fieldPath, node);
    return 'failed';
  }
  const descriptor = descriptorResult.descriptor;
  if (!descriptor) return 'absent';
  if (!registerKey(context, node, key, true)) return 'present';
  if (!own(descriptor, 'value')) {
    node.metadata[key] = { present: true, data: false, enumerable: Boolean(descriptor.enumerable) };
    issue(context, 'OBSERVATION_ACCESSOR', fieldPath, node);
    return 'present';
  }
  const metadata = { present: true, data: true, enumerable: descriptor.enumerable === true, configurable: descriptor.configurable === true, writable: descriptor.writable === true };
  node.metadata[key] = metadata;
  if (!metadata.enumerable) issue(context, 'OBSERVATION_HIDDEN_KEY', fieldPath, node);
  const child = observeValue(descriptor.value, childSpec(spec, key), context, fieldPath, depth + 1);
  if (child) addChild(node, key, child, metadata);
  else issue(context, 'OBSERVATION_NODE_LIMIT', fieldPath, node);
  return 'present';
}

function observeRecord(value, spec, context, path, depth) {
  const node = makeNode('record', path);
  const prototypeResult = safePrototype(value);
  if (!prototypeResult.ok) issue(context, 'OBSERVATION_PROTOTYPE_FAILED', path, node);
  else if (prototypeResult.prototype !== Object.prototype && prototypeResult.prototype !== null) issue(context, 'OBSERVATION_PROTOTYPE_INVALID', path, node);
  else node.prototypeValid = true;

  const known = knownFields(spec) || [];
  const knownSet = new Set(known);
  const knownStates = new Map();
  let presentKnownCount = 0;
  for (const key of known) {
    const state = probeKnownRecordKey(value, node, key, spec, context, path, depth);
    knownStates.set(key, state);
    if (state === 'present') presentKnownCount += 1;
  }

  const keysResult = safeOwnKeys(value);
  if (!keysResult.ok) {
    issue(context, 'OBSERVATION_OWN_KEYS_FAILED', path, node);
    node.ownKeysComplete = false;
  } else {
    const enumeratedKeys = sortOwnKeys(keysResult.keys);
    const enumeratedKnown = new Set();
    const extraKeys = [];
    for (const key of enumeratedKeys) {
      if (typeof key === 'string' && knownSet.has(key)) enumeratedKnown.add(key);
      else extraKeys.push(key);
    }
    for (const key of known) {
      const state = knownStates.get(key);
      const enumerated = enumeratedKnown.has(key);
      if ((state === 'present' && !enumerated) || (state === 'absent' && enumerated)) {
        issue(context, 'OBSERVATION_KEY_ENUMERATION_MISMATCH', path + '.' + key, node);
      }
    }
    if (enumeratedKeys.length > LIMITS.ownKeysPerNode || presentKnownCount + extraKeys.length > LIMITS.ownKeysPerNode) {
      issue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, node);
    }
    const remaining = Math.max(0, LIMITS.ownKeysPerNode - presentKnownCount);
    const keys = extraKeys.slice(0, remaining);
    const seen = new Set();
    for (const key of keys) {
      const token = keyToken(key);
      if (seen.has(token)) {
        issue(context, 'OBSERVATION_DUPLICATE_KEY', path, node);
        continue;
      }
      seen.add(token);
      probeRecordKey(value, node, key, spec, context, path, depth);
    }
    node.ownKeysComplete = true;
  }
  node.valid = node.prototypeValid && node.ownKeysComplete && !node.invalid;
  return node;
}

function probeArrayKey(value, node, key, spec, context, path, depth) {
  registerKey(context, node, key, key !== 'length');
  const descriptorResult = safeDescriptor(value, key);
  if (!descriptorResult.ok) {
    issue(context, 'OBSERVATION_DESCRIPTOR_FAILED', `${path}.${typeof key === 'string' ? key : '@symbol'}`, node);
    return;
  }
  const descriptor = descriptorResult.descriptor;
  if (!descriptor) {
    node.metadata[key] = { present: false };
    return;
  }
  if (key === 'length') {
    node.metadata.length = { present: true, data: own(descriptor, 'value'), enumerable: descriptor.enumerable === true, configurable: descriptor.configurable === true, writable: descriptor.writable === true };
    if (!own(descriptor, 'value') || descriptor.enumerable !== false || descriptor.configurable !== false || typeof descriptor.writable !== 'boolean' || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > LIMITS.arrayLength) {
      issue(context, 'OBSERVATION_ARRAY_LENGTH_INVALID', path, node);
    } else {
      node.lengthValid = true;
      node.lengthValue = descriptor.value;
    }
    return;
  }
  if (typeof key === 'symbol') issue(context, 'OBSERVATION_SYMBOL_KEY', `${path}.@symbol`, node);
  else if (!isCanonicalIndex(key)) issue(context, 'OBSERVATION_ARRAY_EXTRA_KEY', `${path}.${key}`, node);
  if (!own(descriptor, 'value')) {
    node.metadata[key] = { present: true, data: false, enumerable: Boolean(descriptor.enumerable) };
    issue(context, 'OBSERVATION_ACCESSOR', `${path}.${typeof key === 'string' ? key : '@symbol'}`, node);
    return;
  }
  const metadata = { present: true, data: true, enumerable: descriptor.enumerable === true, configurable: descriptor.configurable === true, writable: descriptor.writable === true };
  node.metadata[key] = metadata;
  if (!metadata.enumerable) issue(context, 'OBSERVATION_HIDDEN_KEY', `${path}.${typeof key === 'string' ? key : '@symbol'}`, node);
  const childPath = `${path}.${typeof key === 'string' ? key : '@symbol'}`;
  const child = observeValue(descriptor.value, spec === 'string-array' ? 'scalar' : childSpec(spec, key), context, childPath, depth + 1);
  if (child) addChild(node, key, child, metadata);
  else issue(context, 'OBSERVATION_NODE_LIMIT', childPath, node);
}

function probeCanonicalArrayIndex(value, node, key, spec, context, path, depth) {
  const token = keyToken(key);
  if (node.keyTokens.has(token)) return 'duplicate';
  const childPath = `${path}.${key}`;
  const descriptorResult = safeDescriptor(value, key);
  if (!descriptorResult.ok) {
    issue(context, 'OBSERVATION_DESCRIPTOR_FAILED', childPath, node);
    return 'failed';
  }
  const descriptor = descriptorResult.descriptor;
  if (!descriptor) {
    node.metadata[key] = { present: false };
    return 'absent';
  }
  registerKey(context, node, key, true);
  if (!own(descriptor, 'value')) {
    node.metadata[key] = { present: true, data: false, enumerable: Boolean(descriptor.enumerable) };
    issue(context, 'OBSERVATION_ACCESSOR', childPath, node);
    return 'present';
  }
  const metadata = { present: true, data: true, enumerable: descriptor.enumerable === true, configurable: descriptor.configurable === true, writable: descriptor.writable === true };
  node.metadata[key] = metadata;
  if (!metadata.enumerable) issue(context, 'OBSERVATION_HIDDEN_KEY', childPath, node);
  const child = observeValue(descriptor.value, spec === 'string-array' ? 'scalar' : childSpec(spec, key), context, childPath, depth + 1);
  if (child) addChild(node, key, child, metadata);
  else issue(context, 'OBSERVATION_NODE_LIMIT', childPath, node);
  return 'present';
}

function observeArray(value, spec, context, path, depth) {
  const node = makeNode('array', path);
  const prototypeResult = safePrototype(value);
  if (!prototypeResult.ok) issue(context, 'OBSERVATION_PROTOTYPE_FAILED', path, node);
  else if (prototypeResult.prototype !== Array.prototype) issue(context, 'OBSERVATION_PROTOTYPE_INVALID', path, node);
  else node.prototypeValid = true;

  const keysResult = safeOwnKeys(value);
  let keys = [];
  if (!keysResult.ok) issue(context, 'OBSERVATION_OWN_KEYS_FAILED', path, node);
  else keys = sortOwnKeys(keysResult.keys);
  const hasLengthKey = keys.includes('length');
  const nonStructuralKeys = keys.filter((key) => key !== 'length');
  if (nonStructuralKeys.length > LIMITS.ownKeysPerNode) {
    issue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, node);
  }
  if (hasLengthKey || !keysResult.ok) probeArrayKey(value, node, 'length', spec, context, path, depth);
  else {
    issue(context, 'OBSERVATION_ARRAY_LENGTH_INVALID', path, node);
    probeArrayKey(value, node, 'length', spec, context, path, depth);
  }

  if (node.lengthValid) {
    const indexStates = new Map();
    let presentCanonicalCount = 0;
    for (let index = 0; index < node.lengthValue; index += 1) {
      const key = String(index);
      const state = probeCanonicalArrayIndex(value, node, key, spec, context, path, depth);
      indexStates.set(key, state);
      if (state === 'present') presentCanonicalCount += 1;
    }
    if (keysResult.ok) {
      const enumeratedCanonical = new Set();
      const extraKeys = [];
      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key === 'string' && isCanonicalIndex(key) && Number(key) < node.lengthValue) enumeratedCanonical.add(key);
        else extraKeys.push(key);
      }
      for (let index = 0; index < node.lengthValue; index += 1) {
        const key = String(index);
        const state = indexStates.get(key);
        const enumerated = enumeratedCanonical.has(key);
        if ((state === 'present' && !enumerated) || (state === 'absent' && enumerated) || (state === 'failed' && enumerated)) {
          issue(context, 'OBSERVATION_KEY_ENUMERATION_MISMATCH', `${path}.${key}`, node);
        }
      }
      if (presentCanonicalCount + extraKeys.length > LIMITS.ownKeysPerNode) issue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, node);
      const remaining = Math.max(0, LIMITS.ownKeysPerNode - presentCanonicalCount);
      const seen = new Set(node.keyTokens);
      for (const key of extraKeys.slice(0, remaining)) {
        const token = keyToken(key);
        if (seen.has(token)) continue;
        seen.add(token);
        probeArrayKey(value, node, key, spec, context, path, depth);
      }
    }
  } else {
    const seen = new Set(['s:length']);
    for (const key of nonStructuralKeys.slice(0, LIMITS.ownKeysPerNode)) {
      const token = keyToken(key);
      if (seen.has(token)) continue;
      seen.add(token);
      probeArrayKey(value, node, key, spec, context, path, depth);
    }
  }
  node.ownKeysComplete = keysResult.ok;
  node.valid = node.prototypeValid && node.ownKeysComplete && node.lengthValid && !node.invalid;
  return node;
}

function observeRoot(value, spec = null) {
  const context = { active: new WeakSet(), issues: [], capturedKeys: 0, observedNodes: 0, stringUnits: 0, issueLimitRecorded: false };
  const node = observeValue(value, spec || null, context, '$', 0);
  return { node, issues: context.issues, stats: { capturedKeys: context.capturedKeys, observedNodes: context.observedNodes, stringUnits: context.stringUnits } };
}

function child(node, key) {
  if (!node || !node.byString) return null;
  const entry = node.byString[key];
  return entry ? entry.node : null;
}

function scalar(node) {
  return node && node.kind === 'scalar' ? node.scalar : undefined;
}

function stringValue(node) {
  return typeof scalar(node) === 'string' ? scalar(node) : undefined;
}

function booleanValue(node) {
  return typeof scalar(node) === 'boolean' ? scalar(node) : undefined;
}

function nodeEntries(node) {
  return node && Array.isArray(node.children) ? node.children : [];
}

function nodeHasExtra(node, allowed) {
  for (const entry of nodeEntries(node)) {
    if (typeof entry.key !== 'string' || !allowed.has(entry.key)) return true;
  }
  return false;
}

function validRecordShape(node, allowed, required) {
  if (!node || node.kind !== 'record' || !node.ownKeysComplete || !node.prototypeValid || node.invalid || nodeHasExtra(node, allowed)) return false;
  for (const name of required) {
    const entry = node.byString[name];
    if (!entry || !entry.metadata.data || !entry.metadata.enumerable) return false;
  }
  for (const entry of nodeEntries(node)) {
    if (!entry.metadata.data || !entry.metadata.enumerable) return false;
  }
  return true;
}

function validArrayShape(node) {
  if (!node || node.kind !== 'array' || !node.ownKeysComplete || !node.prototypeValid || !node.lengthValid || node.invalid) return false;
  if (nodeEntries(node).length !== node.lengthValue) return false;
  for (let index = 0; index < node.lengthValue; index += 1) {
    const entry = node.byIndex[String(index)];
    if (!entry || !entry.metadata.data || !entry.metadata.enumerable) return false;
  }
  for (const entry of nodeEntries(node)) {
    if (!isCanonicalIndex(entry.key) || Number(entry.key) >= node.lengthValue || !entry.metadata.data || !entry.metadata.enumerable) return false;
  }
  return true;
}

function normalizeString(node, reason = 'TYPED_OPERATION_REQUIRED') {
  const value = stringValue(node);
  return value !== undefined && value.length > 0 && value.length <= LIMITS.scalarLength ? { valid: true, value } : { valid: false, reason_code: reason };
}

function normalizeBoolean(node, reason = 'TYPED_OPERATION_REQUIRED') {
  const value = booleanValue(node);
  return value === undefined ? { valid: false, reason_code: reason } : { valid: true, value };
}

function normalizeStringArray(node, reason = 'TYPED_OPERATION_REQUIRED') {
  if (!validArrayShape(node)) return { valid: false, reason_code: reason };
  const values = [];
  for (let index = 0; index < node.lengthValue; index += 1) {
    const result = normalizeString(node.byIndex[String(index)].node, reason);
    if (!result.valid) return result;
    values.push(result.value);
  }
  return { valid: true, value: values };
}

function normalizeResolution(node, requireCanonical) {
  const allowed = new Set(['status', 'canonical_path', 'link_type', 'existence']);
  if (!validRecordShape(node, allowed, ['status', 'link_type'])) return { valid: false, reason_code: 'RESOLUTION_INVALID' };
  const status = stringValue(child(node, 'status'));
  const linkType = stringValue(child(node, 'link_type'));
  if (!RESOLVER_LINK_TYPES.has(linkType)) return { valid: false, reason_code: 'UNKNOWN_RESOLVER_LINK_TYPE' };
  if (status !== 'resolved') return { valid: false, reason_code: 'RESOLUTION_INVALID' };
  const canonicalNode = child(node, 'canonical_path');
  const canonical = canonicalNode ? normalizeString(canonicalNode, 'RESOLUTION_INVALID') : { valid: true, value: null };
  if (!canonical.valid && requireCanonical) return canonical;
  const existenceNode = child(node, 'existence');
  const existence = existenceNode ? normalizeString(existenceNode, 'RESOLUTION_INVALID') : { valid: true, value: null };
  if (!existence.valid || (existence.value !== null && !['existing', 'absent', 'unknown'].includes(existence.value))) return { valid: false, reason_code: 'RESOLUTION_INVALID' };
  return { valid: true, value: { status, link_type: linkType, canonical_path: canonical.value, existence: existence.value } };
}

function normalizeTarget(node) {
  if (!node || node.kind !== 'record') return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' };
  const localAllowed = new Set(['path', 'kind', 'resolution', 'target_class', 'resolved_inside']);
  const externalAllowed = new Set(['kind', 'digest']);
  const hasPath = Boolean(child(node, 'path'));
  const hasKind = Boolean(child(node, 'kind'));
  if (hasPath) {
    if ((hasKind && stringValue(child(node, 'kind')) !== 'filesystem-target') || child(node, 'digest') || !validRecordShape(node, localAllowed, ['path', 'resolution'])) return { valid: false, reason_code: hasKind || child(node, 'digest') ? 'TARGET_REPRESENTATION_MIXED' : 'TYPED_OPERATION_FIELDS_UNSUPPORTED' };
    const pathResult = normalizeString(child(node, 'path'), 'TYPED_OPERATION_REQUIRED');
    if (!pathResult.valid) return pathResult;
    const resolutionResult = normalizeResolution(child(node, 'resolution'), true);
    if (!resolutionResult.valid) return resolutionResult;
    const canonicalPath = resolutionResult.value.canonical_path;
    if (canonicalPath === null || canonicalPath !== pathResult.value) return { valid: false, reason_code: 'TARGET_CONTEXT_CONFLICT' };
    if (!isAbsolutePath(pathResult.value)) return { valid: false, reason_code: 'TARGET_PATH_INVALID' };
    if (pathResult.value.includes('*') || pathResult.value.includes('?') || pathResult.value.includes('[') || pathResult.value.includes(']') || pathResult.value.toLowerCase().includes(String.fromCharCode(36) + 'env')) return { valid: false, reason_code: 'TARGET_DYNAMIC_PATH_UNSUPPORTED' };
    return { valid: true, value: { kind: 'filesystem', path: pathResult.value, resolution: resolutionResult.value } };
  }
  if (hasKind) {
    if (child(node, 'path') || child(node, 'resolution') || !validRecordShape(node, externalAllowed, ['kind', 'digest'])) return { valid: false, reason_code: 'TARGET_REPRESENTATION_MIXED' };
    const kind = stringValue(child(node, 'kind'));
    const digest = stringValue(child(node, 'digest'));
    if (!['github-repository', 'external-system'].includes(kind) || !/^[a-f0-9]{64}$/.test(digest || '')) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' };
    return { valid: true, value: { kind, digest } };
  }
  return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' };
}

function operationAllowedFields(type) {
  const map = {
    'filesystem.read': ['type', 'target'],
    'filesystem.write': ['type', 'target', 'no_clobber'],
    'filesystem.create': ['type', 'target', 'no_clobber'],
    'filesystem.move': ['type', 'source', 'destination', 'no_clobber'],
    'filesystem.delete': ['type', 'target'],
    'git.read': ['type'],
    'git.branch': ['type', 'mode', 'branch'],
    'git.push': ['type', 'remote', 'refspecs', 'options', 'authorized_remote', 'authorized_ref'],
    'github.read': ['type', 'repository', 'action', 'target'],
    'github.mutation': ['type', 'repository', 'action', 'target'],
    'network.request': ['type', 'source', 'destination', 'method'],
    'external.mutation': ['type', 'target', 'action'],
    'compound': ['type', 'components'],
    shell: ['type', 'shell', 'command'],
  };
  return new Set(map[type] || []);
}

function operationRequiredFields(type) {
  const map = {
    'filesystem.read': ['type', 'target'], 'filesystem.write': ['type', 'target', 'no_clobber'], 'filesystem.create': ['type', 'target', 'no_clobber'],
    'filesystem.move': ['type', 'source', 'destination', 'no_clobber'], 'filesystem.delete': ['type', 'target'], 'git.read': ['type'],
    'git.branch': ['type', 'mode', 'branch'], 'git.push': ['type', 'remote', 'refspecs', 'options', 'authorized_remote', 'authorized_ref'],
    'github.read': ['type', 'repository', 'action', 'target'], 'github.mutation': ['type', 'repository', 'action', 'target'],
    'network.request': ['type', 'source', 'destination', 'method'], 'external.mutation': ['type', 'target', 'action'],
    compound: ['type', 'components'], shell: ['type', 'shell', 'command'],
  };
  return map[type] || [];
}

function normalizeOperation(node, traversalState = { total: 0 }, compoundDepth = 0) {
  if (!node || node.kind !== 'record') return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' };
  const type = stringValue(child(node, 'type'));
  if (!type) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' };
  if (!OPERATION_TYPE_SET.has(type)) return { valid: false, reason_code: 'TYPED_OPERATION_UNSUPPORTED' };
  const allowed = operationAllowedFields(type);
  const required = operationRequiredFields(type);
  if (!validRecordShape(node, allowed, required)) {
    if (type === 'shell') return { valid: false, reason_code: 'OPAQUE_OPERATION_UNSUPPORTED', operation_type: type };
    return { valid: false, reason_code: nodeHasExtra(node, allowed) ? 'TYPED_OPERATION_FIELDS_UNSUPPORTED' : 'TYPED_OPERATION_REQUIRED', operation_type: type };
  }
  if (type === 'shell') return { valid: false, reason_code: 'OPAQUE_OPERATION_UNSUPPORTED', operation_type: type };

  if (traversalState.total > LIMITS.totalCompoundComponents) return { valid: false, reason_code: 'COMPOUND_COMPONENT_LIMIT', operation_type: type };

  const result = { type };
  let operationClass = 'read';
  let targetClass = 'none';
  let secret = 'none';
  const targetValues = [];
  const attachTarget = (name, requiredTarget = true) => {
    const targetNode = child(node, name);
    if (!targetNode) return requiredTarget ? { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' } : { valid: true };
    const targetResult = normalizeTarget(targetNode);
    if (!targetResult.valid) return targetResult;
    result[name] = targetResult.value;
    targetValues.push(targetResult.value);
    targetClass = targetResult.value.kind === 'filesystem' ? 'filesystem' : 'external';
    const classification = targetSecretClassification(targetResult.value);
    if (classification === 'confirmed' || (classification === 'possible' && secret === 'none')) secret = classification;
    return { valid: true };
  };

  if (['filesystem.read', 'filesystem.write', 'filesystem.create', 'filesystem.delete'].includes(type)) {
    const attached = attachTarget('target');
    if (!attached.valid) return { ...attached, operation_type: type };
    if (child(node, 'no_clobber')) {
      const noClobber = normalizeBoolean(child(node, 'no_clobber'));
      if (!noClobber.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
      result.no_clobber = noClobber.value;
    }
    if (type !== 'filesystem.read') operationClass = 'write';
  } else if (type === 'filesystem.move') {
    const source = attachTarget('source');
    if (!source.valid) return { ...source, operation_type: type };
    const destination = attachTarget('destination');
    if (!destination.valid) return { ...destination, operation_type: type };
    if (child(node, 'no_clobber')) {
      const noClobber = normalizeBoolean(child(node, 'no_clobber'));
      if (!noClobber.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
      result.no_clobber = noClobber.value;
    }
    operationClass = 'write';
  } else if (type === 'git.branch') {
    const mode = normalizeString(child(node, 'mode'));
    const branch = normalizeString(child(node, 'branch'));
    if (!mode.valid || !branch.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    result.mode = mode.value; result.branch = branch.value;
    operationClass = ['read', 'list', 'show'].includes(mode.value) ? 'read' : 'write';
  } else if (type === 'git.push') {
    const remote = normalizeString(child(node, 'remote'));
    const refspecs = normalizeStringArray(child(node, 'refspecs'));
    const options = normalizeStringArray(child(node, 'options'));
    const authorizedRemote = normalizeString(child(node, 'authorized_remote'));
    const authorizedRef = normalizeString(child(node, 'authorized_ref'));
    if (!remote.valid || !refspecs.valid || !options.valid || !authorizedRemote.valid || !authorizedRef.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    if (!isAuthorizedGitRemoteName(remote.value) || !isAuthorizedGitRemoteName(authorizedRemote.value) || remote.value !== authorizedRemote.value || refspecs.value.length !== 1 || refspecs.value[0] !== 'HEAD:' + authorizedRef.value || !isAuthorizedGitRef(authorizedRef.value) || options.value.length > 2 || options.value.some((option) => !SAFE_PUSH_OPTIONS.has(option)) || new Set(options.value).size !== options.value.length) return { valid: false, reason_code: 'BROADENED_PUSH_TARGET_UNSUPPORTED', operation_type: type };
    result.remote = remote.value; result.refspecs = refspecs.value; result.options = options.value; result.authorized_remote = authorizedRemote.value; result.authorized_ref = authorizedRef.value;
    operationClass = 'write';
  } else if (type === 'git.read') {
    operationClass = 'read';
  } else if (type === 'github.read' || type === 'github.mutation') {
    const repository = normalizeString(child(node, 'repository'));
    const action = normalizeString(child(node, 'action'));
    if (!repository.valid || !action.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    const attached = attachTarget('target');
    if (!attached.valid) return { ...attached, operation_type: type };
    if (result.target.kind !== 'github-repository') return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    if (child(node, 'no_clobber')) {
      const noClobber = normalizeBoolean(child(node, 'no_clobber'));
      if (!noClobber.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
      result.no_clobber = noClobber.value;
    }
    result.repository = repository.value; result.action = action.value; operationClass = type === 'github.read' ? 'read' : 'write';
  } else if (type === 'network.request') {
    const source = attachTarget('source');
    if (!source.valid) return { ...source, operation_type: type };
    const destination = attachTarget('destination');
    if (!destination.valid) return { ...destination, operation_type: type };
    const method = normalizeString(child(node, 'method'));
    if (!method.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    result.method = method.value.toUpperCase(); operationClass = 'write';
    if (result.source.kind !== 'filesystem' || result.destination.kind === 'filesystem') return { valid: false, reason_code: 'TARGET_REPRESENTATION_MIXED', operation_type: type };
  } else if (type === 'external.mutation') {
    const action = normalizeString(child(node, 'action'));
    if (!action.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    const attached = attachTarget('target');
    if (!attached.valid) return { ...attached, operation_type: type };
    if (result.target.kind !== 'external-system') return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    if (child(node, 'no_clobber')) {
      const noClobber = normalizeBoolean(child(node, 'no_clobber'));
      if (!noClobber.valid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
      result.no_clobber = noClobber.value;
    }
    result.action = action.value; operationClass = 'write';
  } else if (type === 'compound') {
    if (compoundDepth >= LIMITS.compoundDepth) return { valid: false, reason_code: 'COMPOUND_DEPTH_LIMIT', operation_type: type };
    const componentsNode = child(node, 'components');
    if (!validArrayShape(componentsNode)) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    if (componentsNode.lengthValue > LIMITS.compoundComponents) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED', operation_type: type };
    if (traversalState.total + componentsNode.lengthValue > LIMITS.totalCompoundComponents) return { valid: false, reason_code: 'COMPOUND_COMPONENT_LIMIT', operation_type: type };
    traversalState.total += componentsNode.lengthValue;
    const components = [];
    for (let index = 0; index < componentsNode.lengthValue; index += 1) {
      const component = normalizeOperation(componentsNode.byIndex[String(index)].node, traversalState, compoundDepth + 1);
      if (!component.valid) return component;
      components.push(component.value);
      if (component.operationClass === 'write') operationClass = 'write';
      if (component.targetClass && component.targetClass !== 'none') targetClass = component.targetClass;
      if (component.secret === 'confirmed') secret = 'confirmed';
      else if (component.secret === 'possible' && secret === 'none') secret = 'possible';
      targetValues.push(...(component.targetValues || []));
    }
    result.components = components; operationClass = operationClass === 'write' ? 'write' : 'read';
  }
  const canonical = { value: result, operationClass, targetClass, secret, targetValues, valid: true, operation_type: type };
  return canonical;
}

function normalizeRepository(node) {
  const allowed = new Set(['root', 'worktree', 'remote', 'resolution']);
  if (!validRecordShape(node, allowed, ['root', 'worktree', 'remote', 'resolution'])) return { valid: false, reason_code: 'REPOSITORY_INVALID' };
  const root = normalizeString(child(node, 'root'), 'REPOSITORY_INVALID');
  const worktree = normalizeString(child(node, 'worktree'), 'REPOSITORY_INVALID');
  const remote = normalizeString(child(node, 'remote'), 'REPOSITORY_INVALID');
  if (!root.valid || !worktree.valid || !remote.valid) return { valid: false, reason_code: 'REPOSITORY_INVALID' };
  const resolution = normalizeResolution(child(node, 'resolution'), false);
  if (!resolution.valid) return resolution;
  const remoteIdentity = validateRemoteIdentity(remote.value);
  if (!remoteIdentity.valid) return { valid: false, reason_code: 'REPOSITORY_INVALID' };
  if (!isAbsolutePath(root.value) || !isAbsolutePath(worktree.value)) return { valid: false, reason_code: 'REPOSITORY_INVALID' };
  const rootKey = normalizePathForComparison(root.value);
  const worktreeKey = normalizePathForComparison(worktree.value);
  if (worktreeKey !== rootKey && !worktreeKey.startsWith(rootKey + '\\')) return { valid: false, reason_code: 'REPOSITORY_INVALID' };
  const repositoryIdentity = digestCanonical({ root: rootKey, worktree: worktreeKey, remote: remoteIdentity.canonical });
  return { valid: true, value: { root: root.value, worktree: worktree.value, remote: remoteIdentity.canonical, remoteInput: remote.value, resolution: resolution.value, root_identity_digest: digestCanonical(rootKey), worktree_identity_digest: digestCanonical(worktreeKey), repository_identity: repositoryIdentity } };
}

function normalizeAuthority(node) {
  const allowed = new Set(['role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types']);
  if (!validRecordShape(node, allowed, ['role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types'])) return { valid: false, reason_code: 'AUTHORITY_IDENTITY_INVALID' };
  const role = normalizeString(child(node, 'role'), 'AUTHORITY_IDENTITY_INVALID');
  const identity = normalizeString(child(node, 'identity'), 'AUTHORITY_IDENTITY_INVALID');
  const provider = normalizeString(child(node, 'provider'), 'AUTHORITY_IDENTITY_INVALID');
  const model = normalizeString(child(node, 'model'), 'AUTHORITY_IDENTITY_INVALID');
  const assignment = normalizeString(child(node, 'assignment'), 'AUTHORITY_IDENTITY_INVALID');
  const finality = normalizeBoolean(child(node, 'finality_claim'), 'AUTHORITY_IDENTITY_INVALID');
  const allowedOperations = normalizeStringArray(child(node, 'allowed_operation_types'), 'AUTHORITY_IDENTITY_INVALID');
  if (![role, identity, provider, model, assignment, finality, allowedOperations].every((value) => value.valid)) return { valid: false, reason_code: 'AUTHORITY_IDENTITY_INVALID' };
  return { valid: true, value: { role: role.value, identity: identity.value, provider: provider.value, model: model.value, assignment: assignment.value, finality_claim: finality.value, allowed_operation_types: allowedOperations.value } };
}

function normalizeSession(node) {
  if (!node) return { valid: true, value: null };
  const allowed = new Set(['session_id', 'turn_id', 'call_id']);
  if (!validRecordShape(node, allowed, ['session_id', 'turn_id', 'call_id'])) return { valid: false, reason_code: 'TICKET_BINDING_MISMATCH' };
  const sessionId = normalizeString(child(node, 'session_id'), 'TICKET_BINDING_MISMATCH');
  const turnId = normalizeString(child(node, 'turn_id'), 'TICKET_BINDING_MISMATCH');
  const callId = normalizeString(child(node, 'call_id'), 'TICKET_BINDING_MISMATCH');
  if (!sessionId.valid || !turnId.valid || !callId.valid) return { valid: false, reason_code: 'TICKET_BINDING_MISMATCH' };
  return { valid: true, value: { session_id: sessionId.value, turn_id: turnId.value, call_id: callId.value } };
}

function normalizeInput(root) {
  const allowed = new Set(['enabled', 'activation', 'now', 'repository', 'authority', 'operation', 'ticket', 'session', 'scope']);
  if (!root || root.kind !== 'record' || !root.ownKeysComplete || !root.prototypeValid || root.invalid) return { valid: false, reason_code: 'TYPED_OPERATION_REQUIRED' };
  const enabled = booleanValue(child(root, 'enabled'));
  const activation = child(root, 'activation');
  if (activation && !validRecordShape(activation, new Set(['mode', 'consented']), ['mode', 'consented'])) return { valid: false, reason_code: 'CONTROL_PLANE_DEFAULT_OFF' };
  const mode = activation ? stringValue(child(activation, 'mode')) : undefined;
  const consented = activation ? booleanValue(child(activation, 'consented')) : undefined;
  if (enabled !== true || mode !== 'explicit-local' || consented !== true) return { valid: false, reason_code: 'CONTROL_PLANE_DEFAULT_OFF', defaultOff: true };
  if (nodeHasExtra(root, allowed)) return { valid: false, reason_code: 'TYPED_OPERATION_FIELDS_UNSUPPORTED' };
  const now = normalizeString(child(root, 'now'), 'REQUEST_TIME_INVALID');
  if (!now.valid || !isExactUtc(now.value)) return { valid: false, reason_code: 'REQUEST_TIME_INVALID' };
  const repository = normalizeRepository(child(root, 'repository'));
  if (!repository.valid) return repository;
  const authority = normalizeAuthority(child(root, 'authority'));
  if (!authority.valid) return authority;
  const traversalState = { total: 0 };
  const operation = normalizeOperation(child(root, 'operation'), traversalState, 0);
  if (!operation.valid) return operation;
  const session = normalizeSession(child(root, 'session'));
  if (!session.valid) return session;
  const scopeNode = child(root, 'scope');
  const scope = scopeNode ? stringValue(scopeNode) : null;
  if (scopeNode && (scope === undefined || scope.length > LIMITS.scalarLength)) return { valid: false, reason_code: 'TICKET_BINDING_MISMATCH' };
  const ticketNode = child(root, 'ticket');
  const ticket = ticketNode && ticketNode.kind === 'opaque-ticket' ? ticketNode.opaque : null;
  return { valid: true, value: { now: now.value, repository: repository.value, authority: authority.value, operation, session: session.value, scope, ticket } };
}

function normalizeStructuralInput(observation) {
  const allowed = new Set(['kind', 'identity']);
  if (!validRecordShape(observation.node, allowed, ['kind', 'identity'])) return { valid: false, reason_code: 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED' };
  const kind = stringValue(child(observation.node, 'kind'));
  const identity = stringValue(child(observation.node, 'identity'));
  if (!kind || !identity) return { valid: false, reason_code: 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED' };
  return { valid: true, value: { kind, identity } };
}

function isExactUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isAbsolutePath(value) {
  return typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/'));
}

function normalizePathForComparison(value) {
  return value.replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase();
}

function isUncShareRoot(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.replace(/[\\/]+$/, '');
  return /^\\\\[^\\/]+[\\/][^\\/]+$/.test(trimmed);
}

function isFilesystemRoot(value) {
  if (typeof value !== 'string') return false;
  if (/^[\\/]+$/.test(value)) return true;
  const trimmed = value.replace(/[\\/]+$/, '');
  return /^[A-Za-z]:$/.test(trimmed) || trimmed === '/' || isUncShareRoot(value);
}

function targetInsideRepository(target, repository) {
  if (!target || target.kind !== 'filesystem') return true;
  const pathValue = normalizePathForComparison(target.path);
  const root = normalizePathForComparison(repository.root);
  const worktree = normalizePathForComparison(repository.worktree);
  return pathValue === root || pathValue.startsWith(`${root}\\`) || pathValue === worktree || pathValue.startsWith(`${worktree}\\`);
}

function targetSecretClassification(targetValue) {
  if (!targetValue || targetValue.kind !== 'filesystem') return 'none';
  const pathValue = targetValue.path.toLowerCase().replaceAll('\\', '/');
  const parts = pathValue.split('/');
  if (parts.some((part) => SECRET_PATH_PARTS.has(part) || part.startsWith('.env.'))) return 'confirmed';
  if (pathValue.includes('*') || pathValue.includes('$') || pathValue.includes('{') || pathValue.includes('}')) return 'possible';
  return 'none';
}

function targetValuesOfCanonical(operation, output = []) {
  if (!operation) return output;
  if (operation.type === 'compound') {
    for (const component of operation.components) targetValuesOfCanonical(component, output);
    return output;
  }
  for (const key of ['target', 'source', 'destination']) if (operation[key]) output.push(operation[key]);
  return output;
}

function targetEvidencePaths(node, output = []) {
  if (!node) return output;
  for (const entry of nodeEntries(node)) {
    if (entry.key === 'path' || entry.key === 'canonical_path') {
      const value = stringValue(entry.node);
      if (value !== undefined) output.push(value);
    }
    targetEvidencePaths(entry.node, output);
  }
  return output;
}

function containsExternalEvidence(node) {
  if (!node) return false;
  const kind = stringValue(child(node, 'kind'));
  if (kind === 'external-system' || kind === 'github-repository') return true;
  for (const entry of nodeEntries(node)) if (containsExternalEvidence(entry.node)) return true;
  return false;
}

function partialHardDeny(rootNode, trustedState = null) {
  const state = { callerFinality: false, secretExfiltration: false, catastrophic: false, secretConfirmed: false, secretPossible: false, visited: new Set() };
  const repositoryEvidence = child(rootNode, 'repository');
  const callerProtectedRoots = [stringValue(child(repositoryEvidence, 'root')), stringValue(child(repositoryEvidence, 'worktree'))];
  const trustedProtectedRoots = trustedState && trustedState.root ? [trustedState.root.root, trustedState.root.worktree] : [];
  const protectedRoots = trustedProtectedRoots.concat(callerProtectedRoots).filter((value) => typeof value === 'string');
  function walk(node) {
    if (!node || state.visited.has(node) || node.kind === 'opaque-ticket') return;
    state.visited.add(node);
    const type = stringValue(child(node, 'type'));
    for (const entry of nodeEntries(node)) {
      if (entry.key === 'finality_claim' && booleanValue(entry.node) === true) state.callerFinality = true;
    }
    const paths = targetEvidencePaths(node, []);
    for (const value of paths) {
      const classification = targetSecretClassification({ kind: 'filesystem', path: value });
      if (classification === 'confirmed') state.secretConfirmed = true;
      if (classification === 'possible') state.secretPossible = true;
    }
    if (type === 'network.request') {
      const source = child(node, 'source');
      const destination = child(node, 'destination');
      const sourcePaths = targetEvidencePaths(source, []);
      const sensitive = sourcePaths.some((value) => targetSecretClassification({ kind: 'filesystem', path: value }) === 'confirmed');
      if (sensitive && containsExternalEvidence(destination)) state.secretExfiltration = true;
    }
    if (['filesystem.delete', 'filesystem.write', 'filesystem.create', 'filesystem.move'].includes(type)) {
      for (const value of paths) if (isFilesystemRoot(value) || protectedRoots.some((root) => normalizePathForComparison(value) === normalizePathForComparison(root))) state.catastrophic = true;
    }
    for (const entry of nodeEntries(node)) walk(entry.node);
  }
  walk(rootNode);
  let reason = null;
  if (state.callerFinality) reason = 'CALLER_FINALITY_REJECTED';
  else if (state.secretExfiltration) reason = 'SECRET_EXFILTRATION_DENIED';
  else if (state.catastrophic) reason = 'CATASTROPHIC_TARGET_DENIED';
  return { reason, secretClassification: state.secretConfirmed ? 'confirmed' : state.secretPossible ? 'possible' : 'none' };
}

function validateRemoteIdentity(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.scalarLength) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  if (value.startsWith('git@')) {
    const separator = value.indexOf(':', 4);
    const hostValue = separator > 4 ? value.slice(4, separator) : '';
    const scpPath = separator > 4 ? value.slice(separator + 1) : '';
    if (!scpPath || scpPath.startsWith('/') || scpPath.includes('?') || scpPath.includes('#') || !/^[A-Za-z0-9.-]+$/.test(hostValue) || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(hostValue) || hostValue.includes('..')) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
    const host = hostValue.toLowerCase();
    const pathValue = `/${scpPath}`;
    return { valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'scp', scheme: 'scp', host, port: null, path: pathValue, user: 'git', canonical: `scp://git@${host}${pathValue}` };
  }
  if (!value.startsWith('https://') && !value.startsWith('ssh://')) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  let parsed;
  try { parsed = new URL(value); } catch (_error) { return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' }; }
  if (!['https:', 'ssh:'].includes(parsed.protocol) || parsed.search || parsed.hash || parsed.password || !parsed.hostname || parsed.hostname.includes(':') || parsed.pathname === '/' || parsed.pathname.length < 2) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  const port = parsed.port ? Number(parsed.port) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  const host = parsed.hostname.toLowerCase();
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  const scheme = parsed.protocol.slice(0, -1);
  const user = parsed.username || null;
  if (scheme === 'https' && user) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  let decodedUser = null;
  try { decodedUser = user ? decodeURIComponent(user) : null; } catch (_error) { return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' }; }
  const userPart = decodedUser ? decodedUser + '@' : '';
  const canonicalPort = port === null || (scheme === 'ssh' && port === 22) || (scheme === 'https' && port === 443) ? '' : ':' + port;
  const canonical = scheme + '://' + userPart + host + canonicalPort + parsed.pathname;
  const result = { valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'url', scheme, host, port, path: parsed.pathname, canonical };
  if (decodedUser) result.user = decodedUser;
  return result;
}

function isAuthorizedGitRemoteName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.scalarLength && /^[A-Za-z0-9._-]+$/.test(value) && !value.startsWith('-');
}

function isAuthorizedGitRef(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.scalarLength && /^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(value) && !value.includes('..');
}

function canonicalTrustedRootContext(rootContext) {
  const boundedString = (value) => typeof value === 'string' && value.length > 0 && value.length <= LIMITS.scalarLength;
  if (!rootContext || typeof rootContext !== 'object' || !boundedString(rootContext.repository_identity) || !/^[a-f0-9]{64}$/.test(rootContext.repository_identity) || !boundedString(rootContext.root) || !boundedString(rootContext.worktree) || !boundedString(rootContext.remote) || !boundedString(rootContext.authorized_remote) || !boundedString(rootContext.authorized_ref) || !/^[a-f0-9]{40}$/.test(rootContext.live_server_ref_sha)) throw new Error('TRUSTED_ROOT_CONTEXT_INVALID');
  if (!isAbsolutePath(rootContext.root) || !isAbsolutePath(rootContext.worktree)) throw new Error('TRUSTED_ROOT_CONTEXT_INVALID');
  const rootKey = normalizePathForComparison(rootContext.root);
  const worktreeKey = normalizePathForComparison(rootContext.worktree);
  if (worktreeKey !== rootKey && !worktreeKey.startsWith(rootKey + '\\')) throw new Error('TRUSTED_ROOT_CONTEXT_INVALID');
  const remoteIdentity = validateRemoteIdentity(rootContext.remote);
  if (!remoteIdentity.valid || !isAuthorizedGitRemoteName(rootContext.authorized_remote) || !isAuthorizedGitRef(rootContext.authorized_ref)) throw new Error('TRUSTED_ROOT_CONTEXT_INVALID');
  const repositoryIdentity = digestCanonical({ root: rootKey, worktree: worktreeKey, remote: remoteIdentity.canonical });
  if (rootContext.repository_identity !== repositoryIdentity) throw new Error('TRUSTED_ROOT_CONTEXT_INVALID');
  return Object.freeze({
    repository_identity: repositoryIdentity,
    root: rootKey,
    worktree: worktreeKey,
    root_identity_digest: digestCanonical(rootKey),
    worktree_identity_digest: digestCanonical(worktreeKey),
    remote: remoteIdentity.canonical,
    authorized_remote: rootContext.authorized_remote,
    authorized_ref: rootContext.authorized_ref,
    live_server_ref_sha: rootContext.live_server_ref_sha,
  });
}

function formatRemoteIdentity(value) {
  const result = validateRemoteIdentity(value);
  return result.valid ? result.canonical : null;
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}` + '"';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  const keys = Reflect.ownKeys(value).filter((key) => typeof key === 'string').sort();
  return `{${keys.map((key) => `${canonicalSerialize(key)}:${canonicalSerialize(value[key])}`).join(',')}}`;
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function canonicalTarget(targetValue) {
  if (!targetValue) return null;
  if (targetValue.kind === 'filesystem') return { kind: 'filesystem', path: targetValue.path, resolution: { status: targetValue.resolution.status, canonical_path: targetValue.resolution.canonical_path, link_type: targetValue.resolution.link_type, existence: targetValue.resolution.existence } };
  return { kind: targetValue.kind, digest: targetValue.digest };
}

function canonicalOperation(operation) {
  if (!operation) return null;
  if (operation.type === 'compound') return { type: 'compound', components: operation.components.map(canonicalOperation) };
  const result = { type: operation.type };
  for (const key of ['target', 'source', 'destination']) if (operation[key]) result[key] = canonicalTarget(operation[key]);
  for (const key of ['repository', 'action', 'method', 'remote', 'authorized_remote', 'authorized_ref', 'mode', 'branch', 'no_clobber', 'refspecs', 'options']) if (own(operation, key)) result[key] = operation[key];
  return result;
}

function operationDigestCanonical(operation) {
  return operation ? digestCanonical(canonicalOperation(operation)) : null;
}

function targetDigestCanonical(operation) {
  if (!operation) return null;
  const targets = targetValuesOfCanonical(operation, []).map(canonicalTarget);
  return digestCanonical(targets.length === 1 ? targets[0] : targets);
}

function operationDigest(operation) {
  const observation = observeRoot(operation, 'operation');
  const normalized = normalizeOperation(observation.node, { total: 0 }, 0);
  return normalized.valid && normalized.operation_type !== 'shell' ? operationDigestCanonical(normalized.value) : null;
}

function targetDigest(operation) {
  const observation = observeRoot(operation, 'operation');
  const normalized = normalizeOperation(observation.node, { total: 0 }, 0);
  return normalized.valid && normalized.operation_type !== 'shell' ? targetDigestCanonical(normalized.value) : null;
}

function secretClassificationFromOperation(operation) {
  const values = targetValuesOfCanonical(operation.value, []);
  let classification = operation.secret || 'none';
  for (const targetValue of values) {
    const candidate = targetSecretClassification(targetValue);
    if (candidate === 'confirmed') classification = 'confirmed';
    else if (candidate === 'possible' && classification === 'none') classification = 'possible';
  }
  return classification;
}

function allOperationTypes(operation, output = []) {
  if (!operation) return output;
  if (operation.type === 'compound') for (const component of operation.components) allOperationTypes(component, output);
  else output.push(operation.type);
  return output;
}

function operationRequiresTicket(operation) {
  if (!operation) return false;
  if (operation.type === 'compound') return operation.components.some(operationRequiresTicket);
  if (['filesystem.create', 'filesystem.write', 'filesystem.move'].includes(operation.type) && operation.no_clobber === true) {
    const targets = targetValuesOfCanonical(operation, []);
    if (targets.length > 0 && targets.every((targetValue) => targetValue.kind === 'filesystem' && targetValue.resolution.existence === 'absent')) return false;
  }
  if (operation.type === 'filesystem.read' || operation.type === 'git.read' || operation.type === 'github.read') return false;
  return true;
}
function operationNeedsOverwriteApproval(operation) {
  if (!operation || operation.type === 'compound') return operation && operation.components.some(operationNeedsOverwriteApproval);
  if (!['filesystem.create', 'filesystem.write', 'filesystem.move'].includes(operation.type)) return false;
  const targets = targetValuesOfCanonical(operation, []);
  return targets.some((targetValue) => targetValue.kind === 'filesystem' && targetValue.resolution.existence === 'existing' && operation.no_clobber !== true);
}

function authorityDigest(authority) {
  return digestCanonical({ role: authority.role, identity: authority.identity, provider: authority.provider, model: authority.model, assignment: authority.assignment });
}

function trustedAuthorityState(authority, rootContext, nowFunction, maxEntries, maxLifetimeMs) {
  if (!authority || typeof authority !== 'object' || !['controller', 'executor'].includes(authority.role) || typeof authority.identity !== 'string' || authority.identity.length === 0 || !Array.isArray(authority.allowed_operation_types)) throw new Error('TRUSTED_AUTHORITY_INVALID');
  const trustedRoot = canonicalTrustedRootContext(rootContext);
  const allowed = new Set(authority.allowed_operation_types);
  for (const type of allowed) if (!OPERATION_TYPE_SET.has(type)) throw new Error('TRUSTED_OPERATION_LIMIT_INVALID');
  const clock = typeof nowFunction === 'function' ? nowFunction : () => Date.now();
  const state = { authority: { role: authority.role, identity: authority.identity, provider: authority.provider, model: authority.model, assignment: authority.assignment, allowed_operation_types: [...allowed] }, authorityDigest: authorityDigest(authority), root: trustedRoot, now: clock, maxEntries: Math.min(Number.isInteger(maxEntries) ? maxEntries : LIMITS.ticketEntries, LIMITS.ticketEntries), maxLifetimeMs: Math.min(Number.isInteger(maxLifetimeMs) ? maxLifetimeMs : LIMITS.ticketMaxLifetimeMs, LIMITS.ticketMaxLifetimeMs), records: new Map(), context: null };
  return state;
}

function ticketError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function ticketNow(state) {
  const value = state.now();
  if (!Number.isFinite(value)) throw ticketError('TICKET_CLOCK_INVALID');
  return value;
}

function compactTickets(state, nowValue = ticketNow(state)) {
  let removed = 0;
  for (const [ticket, record] of state.records) {
    if (record.expiresAt <= nowValue || record.consumedCount >= record.maxUses) {
      state.records.delete(ticket);
      removed += 1;
    }
  }
  return removed;
}

function createTrustedAuthorityContext(authority, options = {}) {
  if (options && own(options, 'issuer')) throw ticketError('TICKET_ISSUER_INPUT_FORBIDDEN');
  const state = trustedAuthorityState(authority, options.root_context, options.now, options.maxEntries, options.maxLifetimeMs);
  const context = {};
  state.context = context;
  contextState.set(context, state);
  trustedContexts.add(context);

  context.issue = (request) => {
    if (!request || typeof request !== 'object' || own(request, 'issuer')) throw ticketError('TICKET_ISSUER_INPUT_FORBIDDEN');
    const nowValue = ticketNow(state);
    const maxUses = request.max_uses === undefined ? LIMITS.ticketDefaultUses : request.max_uses;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > LIMITS.ticketMaxUses) throw ticketError('TICKET_EXPIRY_INVALID');
    if (typeof request.expires_at !== 'string' || !isExactUtc(request.expires_at)) throw ticketError('TICKET_EXPIRY_INVALID');
    const expiresAt = Date.parse(request.expires_at);
    if (expiresAt <= nowValue || expiresAt - nowValue > state.maxLifetimeMs) throw ticketError('TICKET_EXPIRY_INVALID');
    const fields = ['session_id', 'turn_id', 'call_id', 'operation_type', 'operation_digest', 'target_digest'];
    for (const field of fields) if (typeof request[field] !== 'string' || request[field].length === 0) throw ticketError('TICKET_BINDING_INVALID');
    if (!OPERATION_TYPE_SET.has(request.operation_type) || !/^[a-f0-9]{64}$/.test(request.operation_digest) || !/^[a-f0-9]{64}$/.test(request.target_digest)) throw ticketError('TICKET_BINDING_INVALID');
    if (request.scope !== null && request.scope !== undefined && typeof request.scope !== 'string') throw ticketError('TICKET_BINDING_INVALID');
    compactTickets(state, nowValue);
    if (state.records.size >= state.maxEntries) throw ticketError('TICKET_STORE_FULL');
    const issuedAt = new Date(nowValue).toISOString();
    const ticketId = digestCanonical({ sequence: ticketSequence += 1, issuer: state.authorityDigest, session_id: request.session_id, call_id: request.call_id, operation_digest: request.operation_digest });
    const publicTicket = Object.freeze({
      contract_version: TICKET_CONTRACT_VERSION,
      ticket_id: ticketId,
      issuer_role: state.authority.role,
      issuer_identity_digest: digestCanonical(state.authority.identity),
      issuer_authority_digest: state.authorityDigest,
      session_id: request.session_id,
      turn_id: request.turn_id,
      call_id: request.call_id,
      operation_type: request.operation_type,
      operation_digest: request.operation_digest,
      target_digest: request.target_digest,
      scope: request.scope === undefined ? null : request.scope,
      issued_at: issuedAt,
      expires_at: request.expires_at,
      max_uses: maxUses,
      consumed_count: 0,
    });
    const binding = Object.freeze({ context, issuer_role: state.authority.role, issuer_identity_digest: publicTicket.issuer_identity_digest, issuer_authority_digest: state.authorityDigest, session_id: request.session_id, turn_id: request.turn_id, call_id: request.call_id, operation_type: request.operation_type, operation_digest: request.operation_digest, target_digest: request.target_digest, scope: publicTicket.scope });
    ticketBindings.set(publicTicket, binding);
    state.records.set(publicTicket, { binding, expiresAt, maxUses, consumedCount: 0 });
    return publicTicket;
  };
  context.compact = () => compactTickets(state);
  context.size = () => state.records.size;
  context.consume = (ticket, expected) => {
    compactTickets(state);
    const binding = ticketBindings.get(ticket);
    if (!binding) return { valid: false, reason_code: 'TICKET_INVALID' };
    if (binding.context !== context) return { valid: false, reason_code: 'TICKET_AUTHORITY_CONTEXT_MISMATCH' };
    const record = state.records.get(ticket);
    if (!record) return { valid: false, reason_code: 'TICKET_REPLAY' };
    const fields = ['issuer_role', 'issuer_identity_digest', 'issuer_authority_digest', 'session_id', 'turn_id', 'call_id', 'operation_type', 'operation_digest', 'target_digest', 'scope'];
    for (const field of fields) if (binding[field] !== expected[field]) return { valid: false, reason_code: field === 'issuer_role' || field.startsWith('issuer_') ? 'TICKET_AUTHORITY_CONTEXT_MISMATCH' : 'TICKET_BINDING_MISMATCH' };
    if (record.consumedCount >= record.maxUses) {
      state.records.delete(ticket);
      return { valid: false, reason_code: 'TICKET_REPLAY' };
    }
    record.consumedCount += 1;
    if (record.consumedCount >= record.maxUses) state.records.delete(ticket);
    return { valid: true, reason_code: 'TICKET_CONSUMED' };
  };
  return context;
}

function contextRootMatches(context, repository) {
  const state = context && context.__state;
  return Boolean(state);
}

function buildResult(overrides = {}) {
  return {
    contract_version: CONTRACT_VERSION,
    decision: overrides.decision || 'unsupported',
    reason_code: overrides.reason_code || 'UNSUPPORTED',
    operation_type: own(overrides, 'operation_type') ? overrides.operation_type : null,
    operation_class: own(overrides, 'operation_class') ? overrides.operation_class : null,
    target_class: overrides.target_class || 'unknown',
    secret_classification: overrides.secret_classification || 'none',
    operation_digest: own(overrides, 'operation_digest') ? overrides.operation_digest : null,
    target_digest: own(overrides, 'target_digest') ? overrides.target_digest : null,
    ticket_status: overrides.ticket_status || 'not-consumed',
    privacy_safe: true,
    structural_impact_required: Boolean(overrides.structural_impact_required),
  };
}

function trustedContextState(context) {
  return context && trustedContexts.has(context) ? contextState.get(context) : null;
}

const contextState = new WeakMap();

function repositoryMatchesTrusted(repository, state) {
  return Boolean(repository) && repository.root_identity_digest === state.root.root_identity_digest && repository.worktree_identity_digest === state.root.worktree_identity_digest && repository.repository_identity === state.root.repository_identity && repository.remote === state.root.remote;
}

function trustedOperationAllowed(operation, callerAuthority, state) {
  const types = allOperationTypes(operation, []);
  return types.every((type) => state.authority.allowed_operation_types.includes(type) && callerAuthority.allowed_operation_types.includes(type));
}

function consumeForCanonicalOperation(inputValue, normalizedOperation, context, state, operationDigestValue, targetDigestValue) {
  if (!inputValue.ticket) return { valid: false, reason_code: 'TICKET_REQUIRED' };
  if (!inputValue.session || typeof inputValue.scope !== 'string') return { valid: false, reason_code: 'TICKET_BINDING_MISMATCH' };
  const binding = ticketBindings.get(inputValue.ticket);
  if (!binding) return { valid: false, reason_code: 'TICKET_INVALID' };
  if (binding.context !== context) return { valid: false, reason_code: 'TICKET_AUTHORITY_CONTEXT_MISMATCH' };
  const expected = {
    issuer_role: state.authority.role,
    issuer_identity_digest: digestCanonical(state.authority.identity),
    issuer_authority_digest: state.authorityDigest,
    session_id: inputValue.session.session_id,
    turn_id: inputValue.session.turn_id,
    call_id: inputValue.session.call_id,
    operation_type: normalizedOperation.value.type,
    operation_digest: operationDigestValue,
    target_digest: targetDigestValue,
    scope: inputValue.scope,
  };
  return context.consume(inputValue.ticket, expected);
}

function evaluate(input, options = {}) {
  const context = options.trustedAuthorityContext;
  const state = trustedContextState(context);
  const observation = observeRoot(input, 'input');
  const hardDeny = partialHardDeny(observation.node, state);
  const secretClassification = hardDeny.secretClassification;
  if (hardDeny.reason) return buildResult({ decision: 'deny', reason_code: hardDeny.reason, secret_classification: hardDeny.reason === 'SECRET_EXFILTRATION_DENIED' ? 'confirmed' : secretClassification });
  const normalizedInput = normalizeInput(observation.node);
  if (!normalizedInput.valid) {
    if (normalizedInput.defaultOff) return buildResult({ reason_code: 'CONTROL_PLANE_DEFAULT_OFF', secret_classification: secretClassification });
    return buildResult({ reason_code: normalizedInput.reason_code || 'TYPED_OPERATION_REQUIRED', operation_type: normalizedInput.operation_type || null, secret_classification: secretClassification });
  }
  const inputValue = normalizedInput.value;
  const normalizedOperation = inputValue.operation;
  const operationValue = normalizedOperation.value;
  const operationDigestValue = operationDigestCanonical(operationValue);
  const targetDigestValue = targetDigestCanonical(operationValue);
  const operationSecret = secretClassificationFromOperation(normalizedOperation);
  const combinedSecret = operationSecret === 'confirmed' || secretClassification === 'confirmed' ? 'confirmed' : operationSecret === 'possible' || secretClassification === 'possible' ? 'possible' : 'none';
  if (operationValue.type === 'shell') return buildResult({ reason_code: 'OPAQUE_OPERATION_UNSUPPORTED', operation_type: 'shell', secret_classification: combinedSecret });

  if (!state) return buildResult({ reason_code: inputValue.ticket ? 'TICKET_TRUST_SOURCE_REQUIRED' : 'TRUSTED_AUTHORITY_REQUIRED', operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret, operation_digest: null, target_digest: null });
  if (!repositoryMatchesTrusted(inputValue.repository, state)) return buildResult({ reason_code: 'REPOSITORY_INVALID', operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret });
  if (!['executor', 'controller'].includes(inputValue.authority.role)) return buildResult({ reason_code: 'AUTHORITY_IDENTITY_INVALID', operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret });
  if (!trustedOperationAllowed(operationValue, inputValue.authority, state)) return buildResult({ reason_code: 'COMPONENT_AUTHORITY_REQUIRED', operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret, operation_digest: operationDigestValue, target_digest: targetDigestValue });
  const targets = targetValuesOfCanonical(operationValue, []);
  if (targets.some((targetValue) => !targetInsideRepository(targetValue, inputValue.repository))) return buildResult({ reason_code: 'TARGET_OUTSIDE_REPOSITORY', operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret, operation_digest: operationDigestValue, target_digest: targetDigestValue });
  if (operationValue.type === 'git.push' && (operationValue.remote !== state.root.authorized_remote || operationValue.authorized_ref !== state.root.authorized_ref)) return buildResult({ reason_code: 'BROADENED_PUSH_TARGET_UNSUPPORTED', operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret });

  const base = { operation_type: operationValue.type, operation_class: normalizedOperation.operationClass, target_class: normalizedOperation.targetClass, secret_classification: combinedSecret, operation_digest: operationDigestValue, target_digest: targetDigestValue };
  if (operationNeedsOverwriteApproval(operationValue)) return buildResult({ ...base, decision: 'ask', reason_code: 'OVERWRITE_APPROVAL_REQUIRED', ticket_status: 'not-consumed' });
  const needsTicket = operationRequiresTicket(operationValue) || combinedSecret === 'confirmed';
  if (needsTicket) {
    if (!inputValue.ticket) return buildResult({ ...base, decision: 'ask', reason_code: combinedSecret === 'confirmed' && operationValue.type === 'filesystem.read' ? 'SECRET_ACCESS_REQUIRES_TICKET' : operationValue.type === 'git.branch' && normalizedOperation.operationClass === 'write' ? 'MUTATING_GIT_OPERATION_REQUIRES_TICKET' : 'TICKET_REQUIRED', ticket_status: 'required' });
    const consumed = consumeForCanonicalOperation(inputValue, normalizedOperation, context, state, operationDigestValue, targetDigestValue);
    if (!consumed.valid) return buildResult({ ...base, decision: 'deny', reason_code: consumed.reason_code, ticket_status: consumed.reason_code === 'TICKET_REPLAY' ? 'replay' : 'not-consumed' });
    return buildResult({ ...base, decision: 'allow', reason_code: 'TICKET_CONSUMED', ticket_status: 'consumed' });
  }
  return buildResult({ ...base, decision: 'allow', reason_code: 'ROUTINE_READ_ALLOWED', ticket_status: 'not-required' });
}

function assessStructuralImpact(input) {
  const observation = observeRoot(input, 'structural');
  const normalized = normalizeStructuralInput(observation);
  if (!normalized.valid) return { valid: false, reason_code: normalized.reason_code };
  if (!STRUCTURAL_KINDS.has(normalized.value.kind) && normalized.value.kind !== 'value-change') return { valid: false, reason_code: 'STRUCTURAL_IMPACT_KIND_UNSUPPORTED' };
  const required = normalized.value.kind !== 'value-change';
  return { valid: true, required, search_scope: required ? 'targeted-repo-wide' : 'local', consumer_categories: required ? ['source-shape-tests', 'fixtures-and-snapshots', 'generated-surface-assertions', 'docs-config-contracts', 'imports-registrations', 'scripts-manifests-adapters'] : [], compatibility_rule: required ? { issue: 342, status: 'active-until-propagation-verification' } : null, contract_version: STRUCTURAL_IMPACT_CONTRACT_VERSION };
}

const publicApi = {
  CONTRACT_VERSION,
  REMOTE_IDENTITY_CONTRACT_VERSION,
  TICKET_CONTRACT_VERSION,
  POLICY,
  evaluate,
  operationDigest,
  targetDigest,
  validateRemoteIdentity,
  formatRemoteIdentity,
  assessStructuralImpact,
  isFilesystemRoot,
  isUncShareRoot,
};

module.exports = publicApi;
