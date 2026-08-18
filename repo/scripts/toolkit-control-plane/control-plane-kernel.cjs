'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'toolkit.control-plane.kernel.v1';
const REMOTE_IDENTITY_CONTRACT_VERSION = 'toolkit.control-plane.remote-identity.v1';
const TICKET_CONTRACT_VERSION = 'toolkit.control-plane.authority-ticket.v1';
const POLICY = Object.freeze(require('../../../_projects/development/control-plane-kernel/_main/control-plane-policy.json'));

const LINK_TYPES = new Set(['none', 'symlink', 'junction', 'reparse-point']);
const SECRET_CLASSIFICATIONS = new Set(['none', 'possible', 'confirmed']);
const ROLES = new Set(['executor', 'controller']);
const OPERATION_TYPES = new Set(POLICY.operation_types);
const SAFE_GIT_PUSH_OPTIONS = new Set(['--porcelain', '--dry-run']);
const GIT_REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_TICKET_USES = 8;

const MAX_GRAPH_DEPTH = 32;
const MAX_COMPOUND_DEPTH = 8;
const MAX_COMPOUND_COMPONENTS = 16;
const MAX_TOTAL_COMPOUND_COMPONENTS = 128;
const MAX_OWN_KEYS = 64;
const MAX_ARRAY_LENGTH = 64;
const MAX_OBSERVED_NODES = 512;
const MAX_CAPTURED_KEYS = 8192;
const MAX_SCALAR_LENGTH = 4096;
const MAX_TOTAL_STRING_UNITS = 131072;
const MAX_RETAINED_ISSUES = 1024;
const MAX_TICKET_ENTRIES = 256;
const MAX_TICKET_LIFETIME_MS = 300000;

const TRUSTED_CONTEXT_STATE = new WeakMap();
const TICKET_PROVENANCE = new WeakMap();

const OPERATION_FIELDS = Object.freeze({
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
  'external.mutation': ['type', 'action', 'target'],
  compound: ['type', 'components'],
  shell: ['type', 'shell', 'command'],
});

const INPUT_FIELDS = Object.freeze(['enabled', 'activation', 'now', 'repository', 'authority', 'operation', 'ticket', 'session', 'scope']);
const ACTIVATION_FIELDS = Object.freeze(['mode', 'consented']);
const SESSION_FIELDS = Object.freeze(['session_id', 'turn_id', 'call_id']);
const AUTHORITY_FIELDS = Object.freeze(['role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types']);
const REPOSITORY_FIELDS = Object.freeze(['root', 'worktree', 'remote', 'resolution']);
const RESOLUTION_FIELDS = Object.freeze(['status', 'canonical_path', 'link_type', 'existence']);
const TARGET_FIELDS = Object.freeze(['kind', 'digest', 'path', 'resolution', 'target_class', 'resolved_inside']);
const STRUCTURAL_KINDS = new Set([
  'rename',
  'remove',
  'move',
  'resignature',
  're-signature',
  'contract-shape',
  'generated-surface',
  'path',
  'symbol',
  'command',
  'schema-field',
  'public-contract',
  'internal-contract',
  'repository-identity',
  'structural-replace',
  'replace',
]);

const OPERATION_CLASS = Object.freeze({
  'filesystem.read': 'filesystem-read',
  'filesystem.write': 'filesystem-write',
  'filesystem.create': 'filesystem-create',
  'filesystem.move': 'filesystem-move',
  'filesystem.delete': 'filesystem-delete',
  'git.read': 'git-read',
  'git.branch': 'git-branch',
  'git.push': 'git-push',
  'github.read': 'github-read',
  'github.mutation': 'github-mutation',
  'network.request': 'network-request',
  'external.mutation': 'external-mutation',
  compound: 'compound',
  shell: 'opaque-shell',
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function mergeSecretClassification(left, right) {
  if (left === 'confirmed' || right === 'confirmed') return 'confirmed';
  if (left === 'possible' || right === 'possible') return 'possible';
  return 'none';
}

function addIssue(context, code, path = '', phase = 'shape') {
  if (context.issues.length >= MAX_RETAINED_ISSUES) {
    context.issueOverflow = true;
    return;
  }
  context.issues.push({ code, path, phase });
}

function captureObservedKey(context, node, path) {
  context.capturedKeys += 1;
  if (context.capturedKeys > MAX_CAPTURED_KEYS) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_CAPTURED_KEY_LIMIT', path, 'resource');
    return false;
  }
  return true;
}

function secretClassificationForString(value) {
  if (typeof value !== 'string') return 'possible';
  if (value.length > MAX_SCALAR_LENGTH) return 'possible';
  if (/(^|[\\/])\.env(?:$|[.\\/])|(^|[\\/])(?:id_rsa|id_dsa|private[-_]?key)(?:$|[.\\/])|\.(?:pem|key|p12|pfx)$/i.test(value)) return 'confirmed';
  if (/(?:password|passwd|secret|credential|access[-_]?token|api[-_]?key|private[-_]?key)/i.test(value)) return 'confirmed';
  return 'none';
}

function safeArrayIsArray(value) {
  try {
    return { ok: true, value: Array.isArray(value) };
  } catch {
    return { ok: false, value: false };
  }
}

function safeGetPrototype(value) {
  try {
    return { ok: true, value: Object.getPrototypeOf(value) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeOwnKeys(value) {
  try {
    return { ok: true, value: Reflect.ownKeys(value) };
  } catch {
    return { ok: false, value: [] };
  }
}

function safeGetOwnPropertyDescriptor(value, key) {
  try {
    return { ok: true, value: Object.getOwnPropertyDescriptor(value, key) };
  } catch {
    return { ok: false, value: undefined };
  }
}

function descriptorHasValue(descriptor) {
  return descriptor !== null && typeof descriptor === 'object' && hasOwn(descriptor, 'value');
}

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function scalarObservation(value, context, path) {
  const type = typeof value;
  if (value === null) return { kind: 'scalar', type: 'null', value: null, secret: 'none' };
  if (type === 'string') {
    context.totalStringUnits += value.length;
    const secret = secretClassificationForString(value);
    if (value.length > MAX_SCALAR_LENGTH || context.totalStringUnits > MAX_TOTAL_STRING_UNITS) {
      addIssue(context, 'OBSERVATION_STRING_LIMIT', path, 'resource');
      return { kind: 'scalar', type: 'string', value: value.slice(0, MAX_SCALAR_LENGTH), truncated: true, secret: mergeSecretClassification(secret, 'possible') };
    }
    return { kind: 'scalar', type: 'string', value, secret };
  }
  if (type === 'boolean') return { kind: 'scalar', type, value, secret: 'none' };
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      addIssue(context, 'OBSERVATION_SCALAR_INVALID', path, 'shape');
      return { kind: 'invalid-scalar', type, value: null, secret: 'possible' };
    }
    return { kind: 'scalar', type, value, secret: 'none' };
  }
  addIssue(context, 'OBSERVATION_OPAQUE_VALUE', path, 'shape');
  return { kind: 'opaque', type, value: null, secret: 'possible' };
}

function fieldSpecFor(spec, key) {
  if (!spec || !spec.fields || typeof key !== 'string') return null;
  return hasOwn(spec.fields, key) ? spec.fields[key] : null;
}

function addObservedEntry(node, entry, knownField) {
  node.entries.push(entry);
  if (knownField) node.known[entry.key] = entry;
  else node.unknown.push(entry);
  node.secret = mergeSecretClassification(node.secret, entry.secret || 'none');
}

function observeDescriptor(value, key, fieldSpec, context, path, node, knownField) {
  const descriptorResult = safeGetOwnPropertyDescriptor(value, key);
  if (!descriptorResult.ok) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_DESCRIPTOR_FAILED', path, 'probe');
    addObservedEntry(node, { key, data: false, enumerable: false, descriptorFailed: true, secret: 'possible' }, knownField);
    return;
  }
  const descriptor = descriptorResult.value;
  if (!descriptorHasValue(descriptor)) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ACCESSOR_OR_MISSING', path, 'shape');
    addObservedEntry(node, { key, data: false, enumerable: Boolean(descriptor && descriptor.enumerable), accessor: true, secret: 'possible' }, knownField);
    return;
  }

  const enumerable = descriptor.enumerable === true;
  if (!enumerable) {
    node.shapeInvalid = true;
    addIssue(context, 'OBSERVATION_NON_ENUMERABLE', path, 'shape');
  }

  if (fieldSpec && fieldSpec.opaque === true) {
    addObservedEntry(node, { key, data: true, enumerable, opaque: true, opaqueValue: descriptor.value, secret: 'none' }, knownField);
    return;
  }

  const child = observeValue(descriptor.value, fieldSpec && fieldSpec.child ? fieldSpec.child : null, context, path, node.depth + 1);
  addObservedEntry(node, { key, data: true, enumerable, child, secret: child.secret || 'none' }, knownField);
}

function observeRecord(value, spec, context, path, depth, forcedInvalid = false) {
  if (context.nodes >= MAX_OBSERVED_NODES) {
    addIssue(context, 'OBSERVATION_NODE_LIMIT', path, 'resource');
    return { kind: 'invalid-object', depth, shapeInvalid: true, ownKeysOk: false, protoValid: false, entries: [], known: Object.create(null), unknown: [], secret: 'possible', limit: true };
  }
  context.nodes += 1;
  const prototypeResult = safeGetPrototype(value);
  const prototypeValid = prototypeResult.ok && (prototypeResult.value === Object.prototype || prototypeResult.value === null);
  if (!prototypeValid) addIssue(context, 'OBSERVATION_PROTOTYPE_INVALID', path, 'shape');
  const node = {
    kind: 'record',
    depth,
    ownKeysOk: false,
    protoValid: prototypeValid,
    shapeInvalid: forcedInvalid || !prototypeValid,
    entries: [],
    known: Object.create(null),
    unknown: [],
    secret: 'none',
  };
  const keysResult = safeOwnKeys(value);
  node.ownKeysOk = keysResult.ok;
  if (!keysResult.ok) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_OWN_KEYS_FAILED', path, 'probe');
  }

  const fieldNames = spec && Array.isArray(spec.fieldNames) ? spec.fieldNames : [];
  const fieldNameSet = new Set(fieldNames);
  const processed = new Set();
  const keys = keysResult.ok ? keysResult.value : [];
  if (keys.length > MAX_OWN_KEYS) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, 'resource');
  }
  const boundedKeys = keys.slice(0, MAX_OWN_KEYS);
  for (const key of boundedKeys) {
    if (!captureObservedKey(context, node, path)) break;
    if (typeof key !== 'string') {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_SYMBOL_KEY', path, 'shape');
      addObservedEntry(node, { key: '[symbol]', data: false, symbol: true, secret: 'possible' }, false);
      continue;
    }
    processed.add(key);

    const fieldSpec = fieldSpecFor(spec, key);
    observeDescriptor(value, key, fieldSpec, context, `${path}/${key}`, node, fieldNameSet.has(key));
  }

  // Schema-bound fields are always probed in schema order, including after ownKeys failure.
  for (const key of fieldNames) {
    if (processed.has(key)) continue;
    if (!captureObservedKey(context, node, path)) break;
    if (keysResult.ok) node.shapeInvalid = true;
    const fieldSpec = fieldSpecFor(spec, key);
    observeDescriptor(value, key, fieldSpec, context, `${path}/${key}`, node, true);
  }

  if (!keysResult.ok && fieldNames.length === 0) node.secret = mergeSecretClassification(node.secret, 'possible');
  context.active.delete(value);
  return node;
}

function arrayIndexKey(key) {
  if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) return null;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function observeArray(value, context, path, depth, forcedInvalid = false) {
  if (context.nodes >= MAX_OBSERVED_NODES) {
    addIssue(context, 'OBSERVATION_NODE_LIMIT', path, 'resource');
    return { kind: 'invalid-array', depth, shapeInvalid: true, ownKeysOk: false, protoValid: false, indices: [], unknown: [], secret: 'possible', limit: true };
  }
  context.nodes += 1;
  const prototypeResult = safeGetPrototype(value);
  const prototypeValid = prototypeResult.ok && prototypeResult.value === Array.prototype;
  if (!prototypeValid) addIssue(context, 'OBSERVATION_ARRAY_PROTOTYPE_INVALID', path, 'shape');
  const node = {
    kind: 'array',
    depth,
    ownKeysOk: false,
    protoValid: prototypeValid,
    shapeInvalid: forcedInvalid || !prototypeValid,
    lengthValid: false,
    length: null,
    indices: [],
    unknown: [],
    secret: 'none',
  };
  const lengthResult = safeGetOwnPropertyDescriptor(value, 'length');
  if (lengthResult.ok && descriptorHasValue(lengthResult.value)) {
    const descriptor = lengthResult.value;
    node.length = descriptor.value;
    node.lengthValid = descriptor.enumerable === false && descriptor.configurable === false && typeof descriptor.writable === 'boolean' && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0;
  }
  if (!node.lengthValid) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ARRAY_LENGTH_INVALID', path, 'shape');
  }
  const keysResult = safeOwnKeys(value);
  node.ownKeysOk = keysResult.ok;
  if (!keysResult.ok) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ARRAY_OWN_KEYS_FAILED', path, 'probe');
  }
  const length = node.lengthValid ? node.length : 0;
  if (length > MAX_ARRAY_LENGTH) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ARRAY_LENGTH_LIMIT', path, 'resource');
  }
  const boundedLength = Math.min(length, MAX_ARRAY_LENGTH);
  const seenIndices = new Set();
  const keys = keysResult.ok ? keysResult.value : [];
  if (keys.length > MAX_OWN_KEYS) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, 'resource');
  }
  for (const key of keys.slice(0, MAX_OWN_KEYS)) {
    if (key === 'length') continue;
    if (!captureObservedKey(context, node, path)) break;
    if (typeof key !== 'string') {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_SYMBOL_KEY', path, 'shape');
      node.unknown.push({ key: '[symbol]', data: false, secret: 'possible' });
      continue;
    }
    const index = arrayIndexKey(key);
    if (index === null || index >= length) {
      node.shapeInvalid = true;
      addIssue(context, 'OBSERVATION_ARRAY_EXTRA_KEY', `${path}/${key}`, 'shape');
      observeDescriptor(value, key, null, context, `${path}/${key}`, { entries: node.unknown, known: Object.create(null), unknown: node.unknown, secret: node.secret, shapeInvalid: node.shapeInvalid, depth: node.depth }, false);
      node.secret = mergeSecretClassification(node.secret, node.unknown.at(-1)?.secret || 'none');
      continue;
    }
    seenIndices.add(index);

    const descriptorResult = safeGetOwnPropertyDescriptor(value, key);
    if (!descriptorResult.ok || !descriptorHasValue(descriptorResult.value)) {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_ARRAY_DESCRIPTOR_INVALID', `${path}/${index}`, 'shape');
      node.indices[index] = { index, data: false, secret: 'possible' };
      continue;
    }
    const descriptor = descriptorResult.value;
    if (descriptor.enumerable !== true) {
      node.shapeInvalid = true;
      addIssue(context, 'OBSERVATION_ARRAY_INDEX_NOT_ENUMERABLE', `${path}/${index}`, 'shape');
    }
    const child = observeValue(descriptor.value, null, context, `${path}/${index}`, node.depth + 1);
    node.indices[index] = { index, data: true, enumerable: descriptor.enumerable === true, child, secret: child.secret || 'none' };
    node.secret = mergeSecretClassification(node.secret, child.secret || 'none');
  }
  // A failed ownKeys probe still permits bounded numeric descriptor probes when length is safe.
  if (!keysResult.ok && node.lengthValid) {
    for (let index = 0; index < boundedLength; index += 1) {
      if (node.indices[index]) continue;
      if (!captureObservedKey(context, node, path)) break;
      const descriptorResult = safeGetOwnPropertyDescriptor(value, String(index));
      if (!descriptorResult.ok || !descriptorHasValue(descriptorResult.value)) {
        node.shapeInvalid = true;
        addIssue(context, 'OBSERVATION_ARRAY_INDEX_MISSING', `${path}/${index}`, 'shape');
        node.indices[index] = { index, data: false, secret: 'possible' };
        node.secret = mergeSecretClassification(node.secret, 'possible');
        continue;
      }
      const descriptor = descriptorResult.value;
      const child = observeValue(descriptor.value, null, context, `${path}/${index}`, node.depth + 1);
      node.indices[index] = { index, data: true, enumerable: descriptor.enumerable === true, child, secret: child.secret || 'none' };
      node.secret = mergeSecretClassification(node.secret, child.secret || 'none');
      if (descriptor.enumerable !== true) {
        node.shapeInvalid = true;
        addIssue(context, 'OBSERVATION_ARRAY_INDEX_NOT_ENUMERABLE', `${path}/${index}`, 'shape');
      }
    }
  }
  if (node.lengthValid) {
    for (let index = 0; index < boundedLength; index += 1) {
      if (!node.indices[index]) {
        node.shapeInvalid = true;
        addIssue(context, 'OBSERVATION_ARRAY_INDEX_MISSING', `${path}/${index}`, 'shape');
      }
    }
  }
  if (length > MAX_ARRAY_LENGTH) node.shapeInvalid = true;
  context.active.delete(value);
  return node;
}

function observeValue(value, spec, context, path, depth = 0) {
  if (depth > MAX_GRAPH_DEPTH) {
    addIssue(context, 'OBSERVATION_GRAPH_DEPTH_LIMIT', path, 'resource');
    return { kind: 'depth-limit', depth, shapeInvalid: true, secret: 'possible' };
  }
  const primitiveType = typeof value;
  if (value === null || primitiveType !== 'object') return scalarObservation(value, context, path);
  if (context.active.has(value)) {
    addIssue(context, 'OBSERVATION_CYCLE', path, 'shape');
    return { kind: 'cycle', depth, shapeInvalid: true, secret: 'possible' };
  }
  context.active.add(value);
  const arrayResult = safeArrayIsArray(value);
  if (!arrayResult.ok) {
    addIssue(context, 'OBSERVATION_ARRAY_PROBE_FAILED', path, 'probe');
    const node = observeRecord(value, spec, context, path, depth, true);
    context.active.delete(value);
    return node;
  }
  if (arrayResult.value) return observeArray(value, context, path, depth);
  return observeRecord(value, spec, context, path, depth);
}

function observeRoot(value, spec = null) {
  const context = { nodes: 0, capturedKeys: 0, totalStringUnits: 0, issues: [], issueOverflow: false, active: new WeakSet() };
  const root = observeValue(value, spec, context, '$', 0);
  return { root, issues: context.issues, issueOverflow: context.issueOverflow, secret: root.secret || 'none' };
}

function getEntry(node, key) {
  return node && node.kind === 'record' && hasOwn(node.known, key) ? node.known[key] : null;
}

function getChild(node, key) {
  const entry = getEntry(node, key);
  return entry && entry.data && !entry.opaque ? entry.child : null;
}

function getOpaque(node, key) {
  const entry = getEntry(node, key);
  return entry && entry.data && entry.opaque ? entry.opaqueValue : undefined;
}

function scalarValue(node, expectedType = null) {
  if (!node || node.kind !== 'scalar' || node.truncated) return undefined;
  if (expectedType && node.type !== expectedType) return undefined;
  return node.value;
}

function nodeHasOwnField(node, key) {
  const entry = getEntry(node, key);
  return Boolean(entry && entry.data);
}


function addObservedEntry(node, entry, knownField) {
  node.entries.push(entry);
  if (typeof entry.key === 'string') node.known[entry.key] = entry;
  if (!knownField) node.unknown.push(entry);
  node.secret = mergeSecretClassification(node.secret, entry.secret || 'none');
}

const OBSERVATION_SCHEMAS = {};
OBSERVATION_SCHEMAS.resolution = { fieldNames: RESOLUTION_FIELDS, fields: {} };
OBSERVATION_SCHEMAS.target = { fieldNames: TARGET_FIELDS, fields: { resolution: { child: OBSERVATION_SCHEMAS.resolution } } };
OBSERVATION_SCHEMAS.authority = { fieldNames: AUTHORITY_FIELDS, fields: {} };
OBSERVATION_SCHEMAS.session = { fieldNames: SESSION_FIELDS, fields: {} };
OBSERVATION_SCHEMAS.activation = { fieldNames: ACTIVATION_FIELDS, fields: {} };
OBSERVATION_SCHEMAS.operation = {
  fieldNames: Object.freeze([...new Set(Object.values(OPERATION_FIELDS).flat())]),
  fields: {
    target: { child: OBSERVATION_SCHEMAS.target },
    source: { child: OBSERVATION_SCHEMAS.target },
    destination: { child: OBSERVATION_SCHEMAS.target },
  },
};
OBSERVATION_SCHEMAS.input = {
  fieldNames: INPUT_FIELDS,
  fields: {
    activation: { child: OBSERVATION_SCHEMAS.activation },
    repository: { child: { fieldNames: REPOSITORY_FIELDS, fields: { resolution: { child: OBSERVATION_SCHEMAS.resolution } } } },
    authority: { child: OBSERVATION_SCHEMAS.authority },
    operation: { child: OBSERVATION_SCHEMAS.operation },
    session: { child: OBSERVATION_SCHEMAS.session },
    ticket: { opaque: true },
  },
};
OBSERVATION_SCHEMAS.structural = { fieldNames: ['kind', 'identity'], fields: {} };

function observeRoot(value, spec = OBSERVATION_SCHEMAS.input) {
  const context = { nodes: 0, capturedKeys: 0, totalStringUnits: 0, issues: [], issueOverflow: false, active: new WeakSet() };
  const root = observeValue(value, spec, context, '$', 0);
  return { root, issues: context.issues, issueOverflow: context.issueOverflow, secret: root.secret || 'none' };
}

function operationRequiredFields(type) {
  switch (type) {
    case 'filesystem.read':
    case 'filesystem.delete': return ['type', 'target'];
    case 'filesystem.write':
    case 'filesystem.create': return ['type', 'target', 'no_clobber'];
    case 'filesystem.move': return ['type', 'source', 'destination', 'no_clobber'];
    case 'git.read': return ['type'];
    case 'git.branch': return ['type', 'mode', 'branch'];
    case 'git.push': return ['type', 'remote', 'refspecs', 'options', 'authorized_remote', 'authorized_ref'];
    case 'github.read':
    case 'github.mutation': return ['type', 'repository', 'action', 'target'];
    case 'network.request': return ['type', 'source', 'destination', 'method'];
    case 'external.mutation': return ['type', 'action', 'target'];
    case 'compound': return ['type', 'components'];
    case 'shell': return ['type', 'shell', 'command'];
    default: return ['type'];
  }
}

function entryValueResult(node, key, normalizer) {
  const child = getChild(node, key);
  return child ? normalizer(child) : resultInvalid('TYPED_OPERATION_REQUIRED', node, node?.secret || 'possible');
}

function normalizeOperation(node, traversalState = { total: 0 }, depth = 0) {
  let secret = aggregateNodeSecret(node);
  if (!node || node.kind !== 'record') return resultInvalid('TYPED_OPERATION_REQUIRED', node, 'possible');
  const typeResult = normalizeString(getChild(node, 'type'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
  secret = mergeSecretClassification(secret, typeResult.secret_classification || 'none');
  if (!typeResult.valid) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret);
  const type = typeResult.value;
  if (!OPERATION_TYPES.has(type)) return resultInvalid('UNSUPPORTED_OPERATION_TYPE', node, secret, { operation_type: type });
  if (type === 'shell') return resultInvalid('OPAQUE_OPERATION_UNSUPPORTED', node, secret, { operation_type: type });
  const fields = OPERATION_FIELDS[type];
  const required = operationRequiredFields(type);
  const shape = exactRecordShape(node, fields, required);
  let missing = false;
  for (const field of required) if (!nodeHasOwnField(node, field)) missing = true;
  if (missing) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
  if (!shape.ok) return resultInvalid('TYPED_OPERATION_FIELDS_UNSUPPORTED', node, secret, { operation_type: type });

  const normalized = { type };
  const children = [];
  const add = (key, valueResult) => {
    secret = mergeSecretClassification(secret, valueResult.secret_classification || 'none');
    if (!valueResult.valid) return false;
    normalized[key] = valueResult.value;
    return true;
  };

  if (['filesystem.read', 'filesystem.write', 'filesystem.create', 'filesystem.delete'].includes(type)) {
    if (!add('target', normalizeTarget(getChild(node, 'target')))) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
  }
  if (type === 'filesystem.move') {
    if (!add('source', normalizeTarget(getChild(node, 'source')))) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (!add('destination', normalizeTarget(getChild(node, 'destination')))) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
  }
  if (['filesystem.write', 'filesystem.create', 'filesystem.move'].includes(type)) {
    if (!add('no_clobber', normalizeBoolean(getChild(node, 'no_clobber'), 'TYPED_OPERATION_REQUIRED'))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
  }
  if (type === 'git.branch') {
    if (!add('mode', normalizeString(getChild(node, 'mode'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true }))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    if (!add('branch', normalizeString(getChild(node, 'branch'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true }))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
  }
  if (type === 'git.push') {
    const remote = normalizeString(getChild(node, 'remote'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const refspecs = normalizeStringArray(getChild(node, 'refspecs'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const options = normalizeStringArray(getChild(node, 'options'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const authorizedRemote = normalizeString(getChild(node, 'authorized_remote'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const authorizedRef = normalizeString(getChild(node, 'authorized_ref'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    for (const item of [remote, refspecs, options, authorizedRemote, authorizedRef]) secret = mergeSecretClassification(secret, item.secret_classification || 'none');
    if (!remote.valid || !refspecs.valid || !options.valid || !authorizedRemote.valid || !authorizedRef.valid) return resultInvalid('BROADENED_PUSH_TARGET_UNSUPPORTED', node, secret, { operation_type: type });
    if (!GIT_REMOTE_NAME_PATTERN.test(remote.value) || remote.value.startsWith('-') || remote.value !== authorizedRemote.value || refspecs.length !== 1 || refspecs[0] !== `HEAD:${authorizedRef.value}` || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(authorizedRef.value) || options.length > 2 || new Set(options).size !== options.length || options.some((option) => !SAFE_GIT_PUSH_OPTIONS.has(option))) {
      return resultInvalid('BROADENED_PUSH_TARGET_UNSUPPORTED', node, secret, { operation_type: type });
    }
    normalized.remote = remote.value;
    normalized.refspecs = refspecs.value;
    normalized.options = options.value;
    normalized.authorized_remote = authorizedRemote.value;
    normalized.authorized_ref = authorizedRef.value;
  }
  if (['github.read', 'github.mutation'].includes(type)) {
    if (!add('repository', normalizeString(getChild(node, 'repository'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true }))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    if (!add('action', normalizeString(getChild(node, 'action'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true }))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    const targetResult = normalizeTarget(getChild(node, 'target'));
    if (!targetResult.valid || targetResult.value.kind !== 'github-repository') return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (!add('target', targetResult)) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
  }
  if (type === 'network.request') {
    const source = normalizeTarget(getChild(node, 'source'));
    const destination = normalizeTarget(getChild(node, 'destination'));
    if (!add('source', source) || !add('destination', destination)) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (destination.value.kind !== 'external-system') return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (!add('method', normalizeString(getChild(node, 'method'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true }))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
  }
  if (type === 'external.mutation') {
    if (!add('action', normalizeString(getChild(node, 'action'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true }))) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    const targetResult = normalizeTarget(getChild(node, 'target'));
    if (!targetResult.valid || targetResult.value.kind !== 'external-system') return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (!add('target', targetResult)) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
  }
  if (type === 'compound') {
    if (depth >= MAX_COMPOUND_DEPTH) return resultInvalid('COMPOUND_DEPTH_LIMIT', node, secret, { operation_type: type });
    const componentsNode = getChild(node, 'components');
    if (!componentsNode || componentsNode.kind !== 'array' || !componentsNode.ownKeysOk || !componentsNode.protoValid || componentsNode.shapeInvalid || !componentsNode.lengthValid || componentsNode.length < 1 || componentsNode.length > MAX_COMPOUND_COMPONENTS) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    if (traversalState.total + componentsNode.length > MAX_TOTAL_COMPOUND_COMPONENTS) return resultInvalid('COMPOUND_COMPONENT_LIMIT', node, secret, { operation_type: type });
    traversalState.total += componentsNode.length;
    for (let index = 0; index < componentsNode.length; index += 1) {
      const childResult = normalizeOperation(componentsNode.indices[index]?.child, traversalState, depth + 1);
      secret = mergeSecretClassification(secret, childResult.secret_classification || 'none');
      children.push(childResult);
      if (!childResult.valid) return resultInvalid(childResult.reason_code || 'TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type, children });
      normalized.components = Object.freeze(children.map((item) => item.value));
    }
  }
  if (type === 'git.read') return resultValid(Object.freeze(normalized), secret);
  if (type === 'filesystem.read' || type === 'filesystem.delete' || type === 'filesystem.write' || type === 'filesystem.create' || type === 'filesystem.move' || type === 'git.branch' || type === 'git.push' || type === 'github.read' || type === 'github.mutation' || type === 'network.request' || type === 'external.mutation' || type === 'compound') return resultValid(Object.freeze(normalized), secret);
  return resultInvalid('UNSUPPORTED_OPERATION_TYPE', node, secret, { operation_type: type });
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableSerialize(value)).digest('hex');
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\0]/.test(value)) return null;
  const slashValue = value.replace(/\//g, '\\');
  const isUnc = slashValue.startsWith('\\\\');
  const drive = /^[A-Za-z]:/.test(slashValue);
  const rootPrefix = isUnc ? '\\\\' : drive ? slashValue.slice(0, 2) + '\\' : slashValue.startsWith('\\') ? '\\' : '';
  const body = isUnc ? slashValue.slice(2) : drive ? slashValue.slice(2) : slashValue.replace(/^\\+/, '');
  const parts = body.split('\\');
  const kept = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (kept.length && kept[kept.length - 1] !== '..') kept.pop();
      else if (!rootPrefix) kept.push('..');
      continue;
    }
    kept.push(part);
  }
  if (isUnc) return `\\\\${kept.join('\\')}`;
  if (drive) return `${slashValue.slice(0, 2)}\\${kept.join('\\')}`;
  if (rootPrefix) return `\\${kept.join('\\')}`;
  return kept.join('\\') || '.';
}

function pathKey(value) {
  const normalized = normalizePath(value);
  return normalized ? normalized.toLowerCase() : null;
}

function samePath(left, right) {
  const a = pathKey(left);
  const b = pathKey(right);
  return Boolean(a && b && a === b);
}

function isWithin(root, candidate) {
  const a = pathKey(root);
  const b = pathKey(candidate);
  return Boolean(a && b && (a === b || b.startsWith(`${a}\\`)));
}

function isUncShareRoot(value) {
  const normalized = normalizePath(value);
  if (!normalized || !normalized.startsWith('\\\\')) return false;
  return normalized.slice(2).split('\\').filter(Boolean).length === 2;
}

function isFilesystemRoot(value) {
  const normalized = normalizePath(value);
  return normalized === '\\' || normalized === '/' || /^[a-z]:\\?$/.test(String(normalized || '').toLowerCase()) || isUncShareRoot(value);
}

function isSecretPathEvidence(value) {
  return secretClassificationForString(value) !== 'none';
}

function targetPathsFromEvidence(node, paths = [], visited = new Set()) {
  if (!node || visited.has(node)) return paths;
  visited.add(node);
  if (node.kind === 'record') {
    const raw = scalarValue(getChild(node, 'path'), 'string');
    if (raw !== undefined) paths.push(raw);
    const resolution = getChild(node, 'resolution');
    const canonical = scalarValue(getChild(resolution, 'canonical_path'), 'string');
    if (canonical !== undefined) paths.push(canonical);
    if (resolution) targetPathsFromEvidence(resolution, paths, visited);
  }
  return paths;
}

function targetIsExternalEvidence(node) {
  return scalarValue(getChild(node, 'kind'), 'string') === 'external-system' || scalarValue(getChild(node, 'kind'), 'string') === 'github-repository';
}

function repositoryPathsFromEvidence(node) {
  return [scalarValue(getChild(node, 'root'), 'string'), scalarValue(getChild(node, 'worktree'), 'string')].filter(Boolean);
}

function protectedPath(pathValue, repositoryPaths) {
  return isFilesystemRoot(pathValue) || repositoryPaths.some((root) => samePath(root, pathValue)) || isUncShareRoot(pathValue);
}

function partialHardDeny(operationNode, repositoryNode, visited = new Set()) {
  if (!operationNode || visited.has(operationNode)) return null;
  visited.add(operationNode);
  const type = scalarValue(getChild(operationNode, 'type'), 'string');
  const repositoryPaths = repositoryPathsFromEvidence(repositoryNode);
  let best = null;
  if (type === 'compound') {
    const components = getChild(operationNode, 'components');
    if (components && components.kind === 'array') {
      const capturedComponents = Array.isArray(components.indices) ? components.indices : [];
      const capturedComponentCount = Math.min(capturedComponents.length, MAX_ARRAY_LENGTH);
      for (let index = 0; index < capturedComponentCount; index += 1) {
        best = chooseHardDeny(best, partialHardDeny(capturedComponents[index]?.child, repositoryNode, visited));
      }
    }
  }
  if (type === 'network.request') {
    const source = getChild(operationNode, 'source');
    const destination = getChild(operationNode, 'destination');
    const sourceSecret = (source?.secret || 'none') !== 'none' || targetPathsFromEvidence(source).some(isSecretPathEvidence);
    if (sourceSecret && targetIsExternalEvidence(destination)) best = chooseHardDeny(best, { reason_code: 'SECRET_EXFILTRATION_DENIED', operation_type: type, operation_class: OPERATION_CLASS[type], target_class: 'external-target', secret_classification: mergeSecretClassification(operationNode.secret || 'none', 'confirmed') });
  }
  if (type === 'filesystem.delete' || type === 'filesystem.move') {
    const targets = type === 'filesystem.move' ? [getChild(operationNode, 'source'), getChild(operationNode, 'destination')] : [getChild(operationNode, 'target')];
    for (const targetNode of targets) {
      if (targetPathsFromEvidence(targetNode).some((pathValue) => protectedPath(pathValue, repositoryPaths))) best = chooseHardDeny(best, { reason_code: 'CATASTROPHIC_TARGET_DENIED', operation_type: type, operation_class: OPERATION_CLASS[type], target_class: 'protected-target', secret_classification: operationNode.secret || 'none' });
    }
  }
  for (const entry of operationNode.entries || []) {
    if (entry && entry.child && typeof entry.key === 'string' && !['type', 'target', 'source', 'destination', 'components'].includes(entry.key)) {
      best = chooseHardDeny(best, partialHardDeny(entry.child, repositoryNode, visited));
    }
  }
  return best;
}

function callerFinalityEvidence(authorityNode) {
  return scalarValue(getChild(authorityNode, 'finality_claim'), 'boolean') === true;
}

function reducePartialHardDeny(observation) {
  const root = observation.root;
  const authority = getChild(root, 'authority');
  if (callerFinalityEvidence(authority)) return { reason_code: 'CALLER_FINALITY_REJECTED', operation_type: null, operation_class: null, target_class: 'unknown-target', secret_classification: observation.secret };
  const operation = getChild(root, 'operation');
  const repository = getChild(root, 'repository');
  const hard = partialHardDeny(operation, repository);
  return hard ? { ...hard, secret_classification: mergeSecretClassification(observation.secret, hard.secret_classification || 'none') } : null;
}


function validateRemoteIdentity(value) {
  if (typeof value !== 'string' || !nonBlank(value) || /[\\\s\0]/.test(value) || value.includes('?') || value.includes('#')) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^/\\\s].+$/.test(value) && !value.includes('://')) {
    const match = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):([^/\\\s].+)$/.exec(value);
    if (!match || match[2].includes('..') || !match[3] || match[3].startsWith('//')) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
    const host = match[2].toLowerCase();
    const pathValue = `/${match[3]}`;
    if (pathValue.split('/').filter(Boolean).length < 2 || host.length < 1) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
    return Object.freeze({ valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'scp', scheme: 'scp', host, port: null, path: pathValue, canonical: `${match[1]}@${host}:${match[3]}`, user: match[1] });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (!['https', 'ssh'].includes(scheme) || parsed.hostname.length < 1 || parsed.pathname.split('/').filter(Boolean).length < 2 || parsed.pathname.startsWith('//')) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  if (parsed.username && scheme === 'https') return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  if (parsed.password) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  if (parsed.hostname.includes(':') && !value.includes(`[${parsed.hostname}]`)) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  const portMatch = parsed.port ? Number(parsed.port) : null;
  if (portMatch !== null && (!Number.isSafeInteger(portMatch) || portMatch < 1 || portMatch > 65535)) return Object.freeze({ valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' });
  const host = parsed.hostname.toLowerCase();
  const user = parsed.username || undefined;
  const userPart = user ? `${user}@` : '';
  const portPart = portMatch === null ? '' : `:${portMatch}`;
  const canonical = `${scheme}://${userPart}${host}${portPart}${parsed.pathname}`;
  return Object.freeze({ valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'url', scheme, host, port: portMatch, path: parsed.pathname, canonical, ...(user ? { user } : {}) });
}

function formatRemoteIdentity(value) {
  const result = validateRemoteIdentity(value);
  return result.valid ? result.canonical : null;
}

function targetsOfOperation(operation, output = []) {
  if (!operation || typeof operation !== 'object') return output;
  if (operation.target) output.push(operation.target);
  if (operation.source) output.push(operation.source);
  if (operation.destination) output.push(operation.destination);
  if (operation.components) for (const component of operation.components) targetsOfOperation(component, output);
  return output;
}

function targetSecretClassification(target) {
  if (!target || target.kind !== 'filesystem-target') return 'none';
  return mergeSecretClassification(secretClassificationForString(target.path), secretClassificationForString(target.resolution?.canonical_path));
}

function protectedCanonicalTarget(target, repository) {
  if (!target || target.kind !== 'filesystem-target') return false;
  const paths = [target.path, target.resolution?.canonical_path].filter(Boolean);
  return paths.some((pathValue) => isFilesystemRoot(pathValue) || samePath(pathValue, repository.root) || samePath(pathValue, repository.worktree) || isUncShareRoot(pathValue));
}

function hardDenyRank(reasonCode) {
  if (reasonCode === 'CALLER_FINALITY_REJECTED') return 0;
  if (reasonCode === 'SECRET_EXFILTRATION_DENIED') return 1;
  if (reasonCode === 'CATASTROPHIC_TARGET_DENIED') return 2;
  return 99;
}

function chooseHardDeny(current, candidate) {
  if (!candidate) return current;
  if (!current || hardDenyRank(candidate.reason_code) < hardDenyRank(current.reason_code)) return candidate;
  return current;
}

function classifyOperation(operation, repository) {
  const type = operation.type;
  const operationClass = OPERATION_CLASS[type] || 'unsupported-operation';
  if (type === 'compound') {
    const components = [];
    let secret = 'none';
    let requiresTicket = false;
    let requiresController = false;
    let hardDeny = null;
    for (const component of operation.components) {
      const classified = classifyOperation(component, repository);
      components.push(classified);
      secret = mergeSecretClassification(secret, classified.secret_classification);
      requiresTicket ||= classified.requires_ticket;
      requiresController ||= classified.requires_controller;
      hardDeny = chooseHardDeny(hardDeny, classified.hard_deny);
      if (!classified.valid) return { valid: false, reason_code: classified.reason_code, operation_type: type, operation_class: operationClass, target_class: 'compound-target', secret_classification: secret, requires_ticket: requiresTicket, requires_controller: requiresController, components, hard_deny: hardDeny };
    }
    return { valid: true, operation_type: type, operation_class: operationClass, target_class: 'compound-target', secret_classification: secret, requires_ticket: requiresTicket, requires_controller: requiresController, components, hard_deny: hardDeny };
  }
  const targets = targetsOfOperation(operation);
  const secret = targets.reduce((value, target) => mergeSecretClassification(value, targetSecretClassification(target)), 'none');
  let hardDeny = null;
  if (type === 'network.request' && secret !== 'none' && operation.destination?.kind === 'external-system') hardDeny = { reason_code: 'SECRET_EXFILTRATION_DENIED', operation_type: type, operation_class: operationClass, target_class: 'external-target', secret_classification: secret };
  if ((type === 'filesystem.delete' || type === 'filesystem.move') && targets.some((target) => protectedCanonicalTarget(target, repository))) hardDeny = chooseHardDeny(hardDeny, { reason_code: 'CATASTROPHIC_TARGET_DENIED', operation_type: type, operation_class: operationClass, target_class: 'protected-target', secret_classification: secret });
  let requiresTicket = false;
  let reasonCode = null;
  let requiresController = false;
  if (type === 'filesystem.read') requiresTicket = secret !== 'none';
  if (type === 'filesystem.create' || type === 'filesystem.write') {
    if (operation.target.resolution.existence === 'absent' && operation.no_clobber === true) requiresTicket = false;
    else { requiresTicket = true; reasonCode = 'OVERWRITE_APPROVAL_REQUIRED'; }
  }
  if (type === 'filesystem.delete' || type === 'filesystem.move' || type === 'git.push' || type === 'external.mutation' || type === 'network.request') requiresTicket = true;
  if (type === 'git.branch' && !['read', 'inspect', 'list', 'status'].includes(operation.mode)) { requiresTicket = true; reasonCode = 'MUTATING_GIT_OPERATION_REQUIRES_TICKET'; }
  if (type === 'github.mutation') { requiresTicket = true; requiresController = true; }
  return { valid: true, operation_type: type, operation_class: operationClass, target_class: hardDeny?.target_class || (targets.length === 0 ? 'no-target' : targets.length === 1 ? (targets[0].kind === 'filesystem-target' ? 'filesystem-target' : 'external-target') : 'compound-target'), secret_classification: secret, requires_ticket: requiresTicket, requires_controller: requiresController, reason_code: reasonCode, hard_deny: hardDeny };
}

function flattenClassifiedComponents(classification, output = []) {
  if (classification?.operation_type === 'compound') for (const component of classification.components || []) flattenClassifiedComponents(component, output);
  else if (classification) output.push(classification);
  return output;
}

function trustedRepositoryIdentity(repository) {
  return repository.root + '|' + repository.worktree + '|' + repository.remote;
}

function trustedContextRootBinding(options) {
  const rootContext = safeReadDataProperty(options, 'root_context');
  if (!rootContext || typeof rootContext !== 'object') return null;
  const observed = observeRoot(rootContext, { fieldNames: ['repository_identity', 'root', 'worktree', 'remote', 'authorized_remote', 'authorized_ref', 'live_server_ref_sha'], fields: {} });
  const node = observed.root;
  const shape = exactRecordShape(node, ['repository_identity', 'root', 'worktree', 'remote', 'authorized_remote', 'authorized_ref', 'live_server_ref_sha'], ['repository_identity', 'root', 'worktree', 'remote', 'authorized_remote', 'authorized_ref', 'live_server_ref_sha']);
  if (!shape.ok) return null;
  const identity = scalarValue(getChild(node, 'repository_identity'), 'string');
  const root = normalizePath(scalarValue(getChild(node, 'root'), 'string'));
  const worktree = normalizePath(scalarValue(getChild(node, 'worktree'), 'string'));
  const remoteValue = scalarValue(getChild(node, 'remote'), 'string');
  const authorizedRemote = scalarValue(getChild(node, 'authorized_remote'), 'string');
  const authorizedRef = scalarValue(getChild(node, 'authorized_ref'), 'string');
  const liveServerRefSha = scalarValue(getChild(node, 'live_server_ref_sha'), 'string');
  const remote = validateRemoteIdentity(remoteValue);
  if (!nonBlank(identity) || !root || !worktree || !/^(?:[A-Za-z]:\\|\\\\|\\|\/)/.test(root) || !/^(?:[A-Za-z]:\\|\\\\|\\|\/)/.test(worktree) || !isWithin(root, worktree) || !remote.valid || !nonBlank(authorizedRemote) || !GIT_REMOTE_NAME_PATTERN.test(authorizedRemote) || !nonBlank(authorizedRef) || !/^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(authorizedRef) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(liveServerRefSha)) return null;
  const canonicalRemote = remote.canonical;
  if (identity !== trustedRepositoryIdentity({ root, worktree, remote: canonicalRemote })) return null;
  return Object.freeze({
    repository_identity_digest: digest(identity),
    root_digest: digest(root),
    worktree_digest: digest(worktree),
    remote: canonicalRemote,
    authorized_remote: authorizedRemote,
    authorized_ref: authorizedRef,
    live_server_ref_sha: liveServerRefSha,
  });
}

function trustedContextMatches(state, inputValue, operation) {
  const binding = state?.rootBinding;
  const repository = inputValue?.repository;
  if (!binding || !repository) return false;
  if (digest(trustedRepositoryIdentity(repository)) !== binding.repository_identity_digest) return false;
  if (digest(repository.root) !== binding.root_digest || digest(repository.worktree) !== binding.worktree_digest || repository.remote !== binding.remote) return false;
  if (operation?.type === 'git.push' && (operation.remote !== binding.authorized_remote || operation.authorized_remote !== binding.authorized_remote || operation.authorized_ref !== binding.authorized_ref)) return false;
  return true;
}

function safeReadDataProperty(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const descriptorResult = safeGetOwnPropertyDescriptor(value, key);
  if (!descriptorResult.ok || !descriptorHasValue(descriptorResult.value)) return undefined;
  return descriptorResult.value.value;
}

function normalizeTrustedAuthority(authority) {
  return normalizeAuthority(observeRoot(authority, OBSERVATION_SCHEMAS.authority).root);
}

function trustedStateFromOptions(options) {
  const candidate = safeReadDataProperty(options, 'trustedAuthorityContext');
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) return null;
  const state = TRUSTED_CONTEXT_STATE.get(candidate);
  return state || null;
}

function ticketRequestObservation(input) {
  return observeRoot(input, { fieldNames: ['session_id', 'turn_id', 'call_id', 'operation_type', 'operation_digest', 'target_digest', 'scope', 'max_uses', 'expires_at', 'issuer', 'issuer_role', 'identity', 'provider', 'model', 'assignment', 'role'], fields: {} }).root;
}

function ticketRequestValue(node, key) {
  const child = getChild(node, key);
  if (!child) return undefined;
  if (child.kind === 'scalar' && !child.truncated) return child.value;
  return undefined;
}

function clockNow(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : Date.now();
    return Number.isFinite(value) ? value : NaN;
  } catch {
    return NaN;
  }
}

function createTrustedAuthorityContext(authority, options = {}) {
  const normalizedAuthority = normalizeTrustedAuthority(authority);
  if (!normalizedAuthority.valid) throw new Error('TRUSTED_AUTHORITY_INVALID');
  const clockCandidate = safeReadDataProperty(options, 'now');
  const maxEntriesCandidate = safeReadDataProperty(options, 'maxEntries');
  const maxLifetimeCandidate = safeReadDataProperty(options, 'maxLifetimeMs');
  const maxEntries = Number.isSafeInteger(maxEntriesCandidate) ? maxEntriesCandidate : MAX_TICKET_ENTRIES;
  const maxLifetimeMs = Number.isSafeInteger(maxLifetimeCandidate) ? maxLifetimeCandidate : MAX_TICKET_LIFETIME_MS;
  if (maxEntries < 1 || maxEntries > MAX_TICKET_ENTRIES || maxLifetimeMs < 1 || maxLifetimeMs > MAX_TICKET_LIFETIME_MS) throw new Error('TICKET_STORE_BOUNDS_INVALID');
  const context = {};
  const authorityContract = normalizedAuthority.value;
  const rootBinding = trustedContextRootBinding(options);
  if (!rootBinding) throw new Error('TRUSTED_ROOT_CONTEXT_INVALID');
  const state = { context, authority: authorityContract, authorityDigest: digest(authorityContract), identityDigest: digest(authorityContract.identity), clock: typeof clockCandidate === 'function' ? clockCandidate : Date.now, maxEntries, maxLifetimeMs, sequence: 0, records: new Map(), rootBinding };
  TRUSTED_CONTEXT_STATE.set(context, state);

  function compact() {
    const now = clockNow(state.clock);
    if (!Number.isFinite(now)) throw new Error('TICKET_TIME_INVALID');
    let removed = 0;
    for (const [id, record] of state.records) {
      if (now >= record.expiresAt || record.uses >= record.maxUses) { state.records.delete(id); removed += 1; }
    }
    return removed;
  }

  function issue(input) {
    compact();
    const observed = ticketRequestObservation(input);
    if (!observed || observed.kind !== 'record' || !observed.ownKeysOk || !observed.protoValid || observed.shapeInvalid) {
      const issuerField = observed?.entries?.some((entry) => typeof entry.key === 'string' && ['issuer', 'issuer_role', 'identity', 'provider', 'model', 'assignment', 'role'].includes(entry.key));
      if (issuerField) throw new Error('TICKET_ISSUER_INPUT_FORBIDDEN');
      throw new Error('TICKET_BINDING_INVALID');
    }
    for (const entry of observed.entries) if (typeof entry.key === 'string' && ['issuer', 'issuer_role', 'identity', 'provider', 'model', 'assignment', 'role'].includes(entry.key)) throw new Error('TICKET_ISSUER_INPUT_FORBIDDEN');
    const sessionId = ticketRequestValue(observed, 'session_id');
    const turnId = ticketRequestValue(observed, 'turn_id');
    const callId = ticketRequestValue(observed, 'call_id');
    const operationType = ticketRequestValue(observed, 'operation_type');
    const operationDigestValue = ticketRequestValue(observed, 'operation_digest');
    const targetDigestValue = ticketRequestValue(observed, 'target_digest');
    const scopeValue = ticketRequestValue(observed, 'scope');
    const maxUsesPresent = nodeHasOwnField(observed, 'max_uses');
    const requestedMaxUses = ticketRequestValue(observed, 'max_uses');
    const maxUses = maxUsesPresent ? requestedMaxUses : POLICY.authority_ticket.default_uses;
    const expiresAtValue = ticketRequestValue(observed, 'expires_at');
    const issuedAt = clockNow(state.clock);
    const expiresAt = parseUtc(expiresAtValue);
    if (!nonBlank(sessionId) || !nonBlank(turnId) || !nonBlank(callId) || !nonBlank(operationType) || !validDigest(operationDigestValue) || !validDigest(targetDigestValue)) throw new Error('TICKET_BINDING_INVALID');
    if (scopeValue !== null && scopeValue !== undefined && !nonBlank(scopeValue)) throw new Error('TICKET_SCOPE_INVALID');
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > MAX_TICKET_USES || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > state.maxLifetimeMs) throw new Error('TICKET_EXPIRY_INVALID');
    if (state.records.size >= state.maxEntries) throw new Error('TICKET_STORE_FULL');
    const payload = { contract_version: TICKET_CONTRACT_VERSION, issuer_role: authorityContract.role, issuer_identity_digest: state.identityDigest, issuer_authority_digest: state.authorityDigest, session_id: sessionId, turn_id: turnId, call_id: callId, operation_type: operationType, operation_digest: operationDigestValue, target_digest: targetDigestValue, scope: scopeValue === undefined ? null : scopeValue, issued_at: new Date(issuedAt).toISOString(), expires_at: expiresAtValue, max_uses: maxUses, consumed_count: 0 };
    const ticketId = digest({ ...payload, sequence: state.sequence += 1 });
    const binding = Object.freeze({ ...payload });
    const ticket = Object.freeze({ ...payload, ticket_id: ticketId });
    const record = { binding, ticketId, uses: 0, maxUses, expiresAt };
    state.records.set(ticketId, record);
    TICKET_PROVENANCE.set(ticket, { context, ticketId });
    return ticket;
  }

  function consume(ticket, binding) {
    const provenance = (ticket !== null && (typeof ticket === 'object' || typeof ticket === 'function')) ? TICKET_PROVENANCE.get(ticket) : undefined;
    if (!provenance) return { valid: false, reason_code: 'TICKET_INVALID' };
    if (provenance.context !== context) return { valid: false, reason_code: 'TICKET_AUTHORITY_CONTEXT_MISMATCH' };
    compact();
    const record = state.records.get(provenance.ticketId);
    if (!record) return { valid: false, reason_code: 'TICKET_REPLAY' };
    const now = clockNow(state.clock);
    if (!Number.isFinite(now)) return { valid: false, reason_code: 'TICKET_TIME_INVALID' };
    if (now >= record.expiresAt) { state.records.delete(record.ticketId); return { valid: false, reason_code: 'TICKET_EXPIRED' }; }
    const fields = ['issuer_role', 'issuer_identity_digest', 'issuer_authority_digest', 'session_id', 'turn_id', 'call_id', 'operation_type', 'operation_digest', 'target_digest', 'scope'];
    if (!fields.every((field) => binding[field] === record.binding[field])) return { valid: false, reason_code: 'TICKET_BINDING_MISMATCH' };
    if (record.uses >= record.maxUses) { state.records.delete(record.ticketId); return { valid: false, reason_code: 'TICKET_REPLAY' }; }
    record.uses += 1;
    if (record.uses >= record.maxUses) state.records.delete(record.ticketId);
    return { valid: true, reason_code: 'TICKET_CONSUMED', consumed_count: record.uses, max_uses: record.maxUses };
  }

  Object.defineProperties(context, {
    issue: { enumerable: false, value: issue },
    consume: { enumerable: false, value: consume },
    compact: { enumerable: false, value: compact },
    size: { enumerable: false, value: () => { compact(); return state.records.size; } },
  });
  return Object.freeze(context);
}

function operationDigestCanonical(operation) {
  return digest(operation);
}

function targetDigestCanonical(operation) {
  return digest({ targets: targetsOfOperation(operation, []) });
}

function operationDigest(operation) {
  try {
    const normalized = normalizeOperation(observeRoot(operation, OBSERVATION_SCHEMAS.operation).root);
    return normalized.valid ? operationDigestCanonical(normalized.value) : null;
  } catch {
    return null;
  }
}
function targetDigest(operation) {
  try {
    const normalized = normalizeOperation(observeRoot(operation, OBSERVATION_SCHEMAS.operation).root);
    return normalized.valid ? targetDigestCanonical(normalized.value) : null;
  } catch {
    return null;
  }
}

function safeOperationDigest(operation) {
  try { return operationDigest(operation); } catch { return null; }
}

function safeTargetDigest(operation) {
  try { return targetDigest(operation); } catch { return null; }
}


function observeDescriptorForRecord(value, key, fieldSpec, context, path, node, knownField) {
  const descriptorResult = safeGetOwnPropertyDescriptor(value, key);
  if (!descriptorResult.ok) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_DESCRIPTOR_FAILED', path, 'probe');
    addObservedEntry(node, { key, data: false, enumerable: false, descriptorFailed: true, secret: 'possible' }, knownField);
    return;
  }
  const descriptor = descriptorResult.value;
  if (descriptor === undefined) {
    addObservedEntry(node, { key, data: false, enumerable: false, missing: true, secret: 'none' }, knownField);
    return;
  }
  if (!descriptorHasValue(descriptor)) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ACCESSOR_OR_MISSING', path, 'shape');
    addObservedEntry(node, { key, data: false, enumerable: Boolean(descriptor && descriptor.enumerable), accessor: true, secret: 'possible' }, knownField);
    return;
  }
  const enumerable = descriptor.enumerable === true;
  if (!enumerable) {
    node.shapeInvalid = true;
    addIssue(context, 'OBSERVATION_NON_ENUMERABLE', path, 'shape');
  }
  if (fieldSpec && fieldSpec.opaque === true) {
    addObservedEntry(node, { key, data: true, enumerable, opaque: true, opaqueValue: descriptor.value, secret: 'none' }, knownField);
    return;
  }
  const child = observeValue(descriptor.value, fieldSpec && fieldSpec.child ? fieldSpec.child : null, context, path, node.depth + 1);
  addObservedEntry(node, { key, data: true, enumerable, child, secret: child.secret || 'none' }, knownField);
}

function observeRecord(value, spec, context, path, depth, forcedInvalid = false) {
  if (context.nodes >= MAX_OBSERVED_NODES) {
    addIssue(context, 'OBSERVATION_NODE_LIMIT', path, 'resource');
    return { kind: 'invalid-object', depth, shapeInvalid: true, ownKeysOk: false, protoValid: false, entries: [], known: Object.create(null), unknown: [], secret: 'possible', limit: true };
  }
  context.nodes += 1;
  const prototypeResult = safeGetPrototype(value);
  const prototypeValid = prototypeResult.ok && (prototypeResult.value === Object.prototype || prototypeResult.value === null);
  if (!prototypeValid) addIssue(context, 'OBSERVATION_PROTOTYPE_INVALID', path, 'shape');
  const node = {
    kind: 'record',
    depth,
    ownKeysOk: false,
    protoValid: prototypeValid,
    shapeInvalid: forcedInvalid || !prototypeValid,
    entries: [],
    known: Object.create(null),
    unknown: [],
    secret: 'none',
  };
  const keysResult = safeOwnKeys(value);
  node.ownKeysOk = keysResult.ok;
  if (!keysResult.ok) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_OWN_KEYS_FAILED', path, 'probe');
  }
  const fieldNames = spec && Array.isArray(spec.fieldNames) ? spec.fieldNames : [];
  const fieldNameSet = new Set(fieldNames);
  const processed = new Set();
  const keys = keysResult.ok ? keysResult.value : [];
  if (keys.length > MAX_OWN_KEYS) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, 'resource');
  }
  for (const key of keys.slice(0, MAX_OWN_KEYS)) {
    if (!captureObservedKey(context, node, path)) break;
    if (typeof key !== 'string') {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_SYMBOL_KEY', path, 'shape');
      addObservedEntry(node, { key: '[symbol]', data: false, symbol: true, secret: 'possible' }, false);
      continue;
    }
    processed.add(key);

    const fieldSpec = fieldSpecFor(spec, key);
    observeDescriptorForRecord(value, key, fieldSpec, context, `${path}/${key}`, node, fieldNameSet.has(key));
  }
  // A failed ownKeys probe still probes only the bounded schema fields in schema order.
  for (const key of fieldNames) {
    if (processed.has(key)) continue;
    if (!captureObservedKey(context, node, path)) break;
    const fieldSpec = fieldSpecFor(spec, key);
    observeDescriptorForRecord(value, key, fieldSpec, context, `${path}/${key}`, node, true);
  }
  context.active.delete(value);
  return node;
}

function observeArray(value, context, path, depth, forcedInvalid = false, itemSpec = null) {
  if (context.nodes >= MAX_OBSERVED_NODES) {
    addIssue(context, 'OBSERVATION_NODE_LIMIT', path, 'resource');
    return { kind: 'invalid-array', depth, shapeInvalid: true, ownKeysOk: false, protoValid: false, indices: [], unknown: [], secret: 'possible', limit: true };
  }
  context.nodes += 1;
  const prototypeResult = safeGetPrototype(value);
  const prototypeValid = prototypeResult.ok && prototypeResult.value === Array.prototype;
  if (!prototypeValid) addIssue(context, 'OBSERVATION_ARRAY_PROTOTYPE_INVALID', path, 'shape');
  const node = { kind: 'array', depth, ownKeysOk: false, protoValid: prototypeValid, shapeInvalid: forcedInvalid || !prototypeValid, lengthValid: false, length: null, indices: [], unknown: [], secret: 'none' };
  const lengthResult = safeGetOwnPropertyDescriptor(value, 'length');
  if (lengthResult.ok && descriptorHasValue(lengthResult.value)) {
    const descriptor = lengthResult.value;
    node.length = descriptor.value;
    node.lengthValid = descriptor.enumerable === false && descriptor.configurable === false && typeof descriptor.writable === 'boolean' && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0;
  }
  if (!node.lengthValid) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ARRAY_LENGTH_INVALID', path, 'shape');
  }
  const keysResult = safeOwnKeys(value);
  node.ownKeysOk = keysResult.ok;
  if (!keysResult.ok) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ARRAY_OWN_KEYS_FAILED', path, 'probe');
  }
  const length = node.lengthValid ? node.length : 0;
  if (length > MAX_ARRAY_LENGTH) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_ARRAY_LENGTH_LIMIT', path, 'resource');
  }
  const boundedLength = Math.min(length, MAX_ARRAY_LENGTH);
  const keys = keysResult.ok ? keysResult.value : [];
  if (keys.length > MAX_OWN_KEYS) {
    node.shapeInvalid = true;
    node.secret = mergeSecretClassification(node.secret, 'possible');
    addIssue(context, 'OBSERVATION_OWN_KEY_LIMIT', path, 'resource');
  }
  const observeIndex = (index, descriptor) => {
    if (!descriptorHasValue(descriptor)) {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_ARRAY_DESCRIPTOR_INVALID', `${path}/${index}`, 'shape');
      node.indices[index] = { index, data: false, secret: 'possible' };
      return;
    }
    if (descriptor.enumerable !== true) {
      node.shapeInvalid = true;
      addIssue(context, 'OBSERVATION_ARRAY_INDEX_NOT_ENUMERABLE', `${path}/${index}`, 'shape');
    }
    const child = observeValue(descriptor.value, itemSpec, context, `${path}/${index}`, node.depth + 1);
    node.indices[index] = { index, data: true, enumerable: descriptor.enumerable === true, child, secret: child.secret || 'none' };
    node.secret = mergeSecretClassification(node.secret, child.secret || 'none');
  };
  for (const key of keys.slice(0, MAX_OWN_KEYS)) {
    if (key === 'length') continue;
    if (!captureObservedKey(context, node, path)) break;
    if (typeof key !== 'string') {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_SYMBOL_KEY', path, 'shape');
      node.unknown.push({ key: '[symbol]', data: false, secret: 'possible' });
      continue;
    }
    const index = arrayIndexKey(key);
    if (index === null || index >= length) {
      node.shapeInvalid = true;
      addIssue(context, 'OBSERVATION_ARRAY_EXTRA_KEY', `${path}/${key}`, 'shape');
      const descriptorResult = safeGetOwnPropertyDescriptor(value, key);
      if (descriptorResult.ok && descriptorHasValue(descriptorResult.value)) {
        const child = observeValue(descriptorResult.value.value, null, context, `${path}/${key}`, node.depth + 1);
        node.unknown.push({ key, data: true, child, secret: child.secret || 'none' });
        node.secret = mergeSecretClassification(node.secret, child.secret || 'none');
      } else {
        node.unknown.push({ key, data: false, secret: 'possible' });
        node.secret = mergeSecretClassification(node.secret, 'possible');
      }
      continue;
    }

    const descriptorResult = safeGetOwnPropertyDescriptor(value, key);
    if (!descriptorResult.ok) {
      node.shapeInvalid = true;
      node.secret = mergeSecretClassification(node.secret, 'possible');
      addIssue(context, 'OBSERVATION_ARRAY_DESCRIPTOR_INVALID', `${path}/${index}`, 'probe');
      node.indices[index] = { index, data: false, secret: 'possible' };
    } else {
      observeIndex(index, descriptorResult.value);
    }
  }
  if (!keysResult.ok && node.lengthValid) {
    for (let index = 0; index < boundedLength; index += 1) {
      if (node.indices[index]) continue;
      if (!captureObservedKey(context, node, path)) break;
      const descriptorResult = safeGetOwnPropertyDescriptor(value, String(index));
      if (!descriptorResult.ok || !descriptorHasValue(descriptorResult.value)) {
        node.shapeInvalid = true;
        node.secret = mergeSecretClassification(node.secret, 'possible');
        addIssue(context, 'OBSERVATION_ARRAY_INDEX_MISSING', `${path}/${index}`, 'shape');
        node.indices[index] = { index, data: false, secret: 'possible' };
      } else observeIndex(index, descriptorResult.value);
    }
  }
  if (node.lengthValid) {
    for (let index = 0; index < boundedLength; index += 1) {
      if (!node.indices[index]) {
        node.shapeInvalid = true;
        addIssue(context, 'OBSERVATION_ARRAY_INDEX_MISSING', `${path}/${index}`, 'shape');
      }
    }
  }
  context.active.delete(value);
  return node;
}

function observeValue(value, spec, context, path, depth = 0) {
  if (depth > MAX_GRAPH_DEPTH) {
    addIssue(context, 'OBSERVATION_GRAPH_DEPTH_LIMIT', path, 'resource');
    return { kind: 'depth-limit', depth, shapeInvalid: true, secret: 'possible' };
  }
  const primitiveType = typeof value;
  if (value === null || primitiveType !== 'object') return scalarObservation(value, context, path);
  if (context.active.has(value)) {
    addIssue(context, 'OBSERVATION_CYCLE', path, 'shape');
    return { kind: 'cycle', depth, shapeInvalid: true, secret: 'possible' };
  }
  context.active.add(value);
  const arrayResult = safeArrayIsArray(value);
  if (!arrayResult.ok) {
    addIssue(context, 'OBSERVATION_ARRAY_PROBE_FAILED', path, 'probe');
    const node = observeRecord(value, spec, context, path, depth, true);
    context.active.delete(value);
    return node;
  }
  if (arrayResult.value) return observeArray(value, context, path, depth, false, spec && spec.arrayItem ? spec.arrayItem : null);
  return observeRecord(value, spec, context, path, depth);
}

OBSERVATION_SCHEMAS.operation.fields.components = { child: { arrayItem: OBSERVATION_SCHEMAS.operation } };

function aggregateNodeSecret(node, visited = new Set()) {
  if (!node || visited.has(node)) return 'none';
  visited.add(node);
  let secret = node.secret || 'none';
  for (const entry of node.entries || []) secret = mergeSecretClassification(secret, entry.secret || 'none');
  for (const entry of node.entries || []) if (entry && entry.child) secret = mergeSecretClassification(secret, aggregateNodeSecret(entry.child, visited));
  for (const index of node.indices || []) if (index && index.child) secret = mergeSecretClassification(secret, aggregateNodeSecret(index.child, visited));
  return secret;
}

function resultInvalid(reason_code, node, secret = 'none', extra = {}) {
  return { valid: false, reason_code, secret_classification: mergeSecretClassification(secret, aggregateNodeSecret(node)), ...extra };
}

function resultValid(value, secret = 'none', extra = {}) {
  return { valid: true, value, secret_classification: secret, ...extra };
}

function exactRecordShape(node, allowedFields, requiredFields = []) {
  if (!node || node.kind !== 'record' || !node.ownKeysOk || !node.protoValid || node.shapeInvalid) return { ok: false, reason_code: 'RECORD_SHAPE_INVALID' };
  const allowed = new Set(allowedFields || []);
  for (const entry of node.entries || []) {
    if (!entry || !entry.data) continue;
    if (typeof entry.key !== 'string' || !allowed.has(entry.key)) return { ok: false, reason_code: 'RECORD_FIELDS_UNSUPPORTED' };
  }
  for (const key of requiredFields || []) if (!nodeHasOwnField(node, key)) return { ok: false, reason_code: 'RECORD_REQUIRED_FIELD_MISSING' };
  return { ok: true };
}

function normalizeString(node, reason_code, options = {}) {
  const value = scalarValue(node, 'string');
  const secret = node?.secret || 'possible';
  if (value === undefined || (options.nonBlank && !nonBlank(value))) return resultInvalid(reason_code, node, secret);
  return resultValid(value, mergeSecretClassification(secret, secretClassificationForString(value)));
}

function normalizeBoolean(node, reason_code) {
  const value = scalarValue(node, 'boolean');
  return value === undefined ? resultInvalid(reason_code, node, node?.secret || 'possible') : resultValid(value, node?.secret || 'none');
}

function normalizeStringArray(node, reason_code, options = {}) {
  if (!node || node.kind !== 'array' || !node.ownKeysOk || !node.protoValid || node.shapeInvalid || !node.lengthValid || node.length > MAX_ARRAY_LENGTH) return resultInvalid(reason_code, node, node?.secret || 'possible');
  const values = [];
  for (let index = 0; index < node.length; index += 1) {
    const item = scalarValue(node.indices[index]?.child, 'string');
    if (item === undefined || (options.nonBlank && !nonBlank(item))) return resultInvalid(reason_code, node, mergeSecretClassification(node.secret || 'none', 'possible'));
    values.push(item);
  }
  const result = resultValid(Object.freeze(values), node.secret || 'none');
  // The typed push normalizer consumes both the result wrapper and its historical array-shaped probes.
  result.length = values.length;
  for (let index = 0; index < values.length; index += 1) result[index] = values[index];
  return result;
}

function parseUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  try { return new Date(parsed).toISOString() === value ? parsed : NaN; } catch { return NaN; }
}

function normalizeResolution(node, options = {}) {
  if (!node) return resultInvalid(options.reason_code || 'RESOLUTION_REQUIRED', node, 'possible');
  const shape = exactRecordShape(node, RESOLUTION_FIELDS, ['status', 'link_type']);
  if (!shape.ok) return resultInvalid(options.reason_code || 'RESOLUTION_INVALID', node, node.secret || 'possible');
  const statusResult = normalizeString(getChild(node, 'status'), 'RESOLUTION_INVALID', { nonBlank: true });
  const linkResult = normalizeString(getChild(node, 'link_type'), 'UNKNOWN_RESOLVER_LINK_TYPE', { nonBlank: true });
  if (!statusResult.valid) return resultInvalid(statusResult.reason_code, node, node.secret || 'possible');
  if (!linkResult.valid || !LINK_TYPES.has(linkResult.value)) return resultInvalid('UNKNOWN_RESOLVER_LINK_TYPE', node, node.secret || 'possible');
  if (statusResult.value !== 'resolved') return resultInvalid('RESOLUTION_INVALID', node, node.secret || 'possible');
  let canonicalPath;
  if (nodeHasOwnField(node, 'canonical_path')) {
    const raw = scalarValue(getChild(node, 'canonical_path'), 'string');
    canonicalPath = normalizePath(raw);
    if (!canonicalPath || /[*?\[\]]/.test(raw) || /\$env(?::|\b)/i.test(raw)) return resultInvalid('TARGET_DYNAMIC_PATH_UNSUPPORTED', node, mergeSecretClassification(node.secret || 'none', 'possible'));
  }
  let existence;
  if (nodeHasOwnField(node, 'existence')) {
    existence = scalarValue(getChild(node, 'existence'), 'string');
    if (!['existing', 'absent', 'unknown'].includes(existence)) return resultInvalid('RESOLUTION_INVALID', node, node.secret || 'possible');
  }
  if (options.requireCanonical && !canonicalPath) return resultInvalid('RESOLUTION_CANONICAL_REQUIRED', node, node.secret || 'possible');
  return resultValid(Object.freeze({ status: statusResult.value, link_type: linkResult.value, ...(canonicalPath ? { canonical_path: canonicalPath } : {}), ...(existence ? { existence } : {}) }), mergeSecretClassification(node.secret || 'none', mergeSecretClassification(statusResult.secret_classification, linkResult.secret_classification)));
}

function normalizeTarget(node) {
  const secret = aggregateNodeSecret(node);
  if (!node || node.kind !== 'record') return resultInvalid('TARGET_INVALID', node, mergeSecretClassification(secret, 'possible'));
  const shape = exactRecordShape(node, TARGET_FIELDS, []);
  if (!shape.ok) return resultInvalid('TARGET_FIELDS_UNSUPPORTED', node, secret);
  const kind = scalarValue(getChild(node, 'kind'), 'string');
  const digestValue = scalarValue(getChild(node, 'digest'), 'string');
  const hasPath = nodeHasOwnField(node, 'path');
  const hasResolution = nodeHasOwnField(node, 'resolution');
  const hasDigest = nodeHasOwnField(node, 'digest');
  const pathValue = hasPath ? scalarValue(getChild(node, 'path'), 'string') : undefined;
  if (pathValue !== undefined && (/[*?\[\]]/.test(pathValue) || /\$env(?::|\b)/i.test(pathValue))) return resultInvalid('TARGET_DYNAMIC_PATH_UNSUPPORTED', node, mergeSecretClassification(secret, 'possible'));
  if (kind === 'external-system' || kind === 'github-repository') {
    if (!hasDigest || !validDigest(digestValue) || hasPath || hasResolution) return resultInvalid('TARGET_REPRESENTATION_MIXED', node, mergeSecretClassification(secret, 'possible'));
    return resultValid(Object.freeze({ kind, digest: digestValue }), secret);
  }
  if (kind !== undefined && kind !== 'filesystem-target') return resultInvalid('TARGET_KIND_UNSUPPORTED', node, mergeSecretClassification(secret, 'possible'));
  if (hasDigest || !hasPath || !hasResolution) return resultInvalid('TARGET_INVALID', node, mergeSecretClassification(secret, 'possible'));
  const rawPath = normalizePath(pathValue);
  if (!rawPath || !/^(?:[A-Za-z]:\\|\\\\|\\|\/)/.test(rawPath) || rawPath === '.') return resultInvalid('TARGET_PATH_INVALID', node, mergeSecretClassification(secret, 'possible'));
  const resolutionResult = normalizeResolution(getChild(node, 'resolution'), { requireCanonical: true });
  if (!resolutionResult.valid) return resultInvalid(resolutionResult.reason_code, node, mergeSecretClassification(secret, resolutionResult.secret_classification));
  const canonicalPath = resolutionResult.value.canonical_path;
  if (!canonicalPath || !samePath(rawPath, canonicalPath)) return resultInvalid('TARGET_CONTEXT_CONFLICT', node, mergeSecretClassification(secret, mergeSecretClassification(secretClassificationForString(rawPath), secretClassificationForString(canonicalPath))));
  return resultValid(Object.freeze({ kind: 'filesystem-target', path: rawPath, resolution: resolutionResult.value }), mergeSecretClassification(secret, mergeSecretClassification(secretClassificationForString(rawPath), secretClassificationForString(canonicalPath))));
}

function normalizeRepository(node) {
  const secret = aggregateNodeSecret(node);
  const shape = exactRecordShape(node, REPOSITORY_FIELDS, ['root', 'worktree', 'remote', 'resolution']);
  if (!shape.ok) return resultInvalid('REPOSITORY_INVALID', node, secret);
  const rootRaw = normalizePath(scalarValue(getChild(node, 'root'), 'string'));
  const worktreeRaw = normalizePath(scalarValue(getChild(node, 'worktree'), 'string'));
  if (!rootRaw || !worktreeRaw || !/^(?:[A-Za-z]:\\|\\\\|\\|\/)/.test(rootRaw) || !/^(?:[A-Za-z]:\\|\\\\|\\|\/)/.test(worktreeRaw) || !isWithin(rootRaw, worktreeRaw)) return resultInvalid('REPOSITORY_PATH_INVALID', node, mergeSecretClassification(secret, 'possible'));
  const remoteValue = scalarValue(getChild(node, 'remote'), 'string');
  const remote = validateRemoteIdentity(remoteValue);
  if (!remote.valid) return resultInvalid('REMOTE_IDENTITY_INVALID', node, secret);
  const resolution = normalizeResolution(getChild(node, 'resolution'));
  if (!resolution.valid) return resultInvalid(resolution.reason_code, node, secret);
  return resultValid(Object.freeze({ root: rootRaw, worktree: worktreeRaw, remote: remote.canonical, resolution: resolution.value }), secret);
}

function normalizeAuthority(node) {
  const secret = aggregateNodeSecret(node);
  const shape = exactRecordShape(node, AUTHORITY_FIELDS, ['role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types']);
  if (!shape.ok) return resultInvalid('AUTHORITY_IDENTITY_INVALID', node, secret);
  const role = scalarValue(getChild(node, 'role'), 'string');
  const identity = scalarValue(getChild(node, 'identity'), 'string');
  const provider = scalarValue(getChild(node, 'provider'), 'string');
  const model = scalarValue(getChild(node, 'model'), 'string');
  const assignment = scalarValue(getChild(node, 'assignment'), 'string');
  const finality = scalarValue(getChild(node, 'finality_claim'), 'boolean');
  const allowed = normalizeStringArray(getChild(node, 'allowed_operation_types'), 'AUTHORITY_OPERATION_TYPES_INVALID', { nonBlank: true });
  if (!ROLES.has(role) || !nonBlank(identity) || !nonBlank(provider) || !nonBlank(model) || !nonBlank(assignment) || typeof finality !== 'boolean' || !allowed.valid || allowed.value.some((type) => !OPERATION_TYPES.has(type))) return resultInvalid('AUTHORITY_IDENTITY_INVALID', node, mergeSecretClassification(secret, allowed.secret_classification || 'none'));
  return resultValid(Object.freeze({ role, identity, provider, model, assignment, finality_claim: finality, allowed_operation_types: allowed.value }), secret);
}

function normalizeSession(node) {
  if (!node) return resultValid(null, 'none');
  const shape = exactRecordShape(node, SESSION_FIELDS, SESSION_FIELDS);
  if (!shape.ok) return resultInvalid('SESSION_INVALID', node, node.secret || 'possible');
  const session_id = scalarValue(getChild(node, 'session_id'), 'string');
  const turn_id = scalarValue(getChild(node, 'turn_id'), 'string');
  const call_id = scalarValue(getChild(node, 'call_id'), 'string');
  if (!nonBlank(session_id) || !nonBlank(turn_id) || !nonBlank(call_id)) return resultInvalid('SESSION_INVALID', node, node.secret || 'possible');
  return resultValid(Object.freeze({ session_id, turn_id, call_id }), node.secret || 'none');
}

function normalizeInput(root) {
  if (!root || root.kind !== 'record') return resultInvalid('INPUT_SHAPE_INVALID', root, 'possible');
  const shape = exactRecordShape(root, INPUT_FIELDS, ['enabled', 'activation', 'now', 'repository', 'authority', 'operation']);
  if (!shape.ok) return resultInvalid(shape.reason_code === 'RECORD_FIELDS_UNSUPPORTED' ? 'INPUT_FIELDS_UNSUPPORTED' : 'INPUT_SHAPE_INVALID', root, aggregateNodeSecret(root));
  const enabled = scalarValue(getChild(root, 'enabled'), 'boolean');
  const activationNode = getChild(root, 'activation');
  const activationShape = exactRecordShape(activationNode, ACTIVATION_FIELDS, ACTIVATION_FIELDS);
  const mode = scalarValue(getChild(activationNode, 'mode'), 'string');
  const consented = scalarValue(getChild(activationNode, 'consented'), 'boolean');
  if (!activationShape.ok || mode === undefined || consented === undefined) return resultInvalid('ACTIVATION_REQUIRED', root, aggregateNodeSecret(root));
  const now = scalarValue(getChild(root, 'now'), 'string');
  if (parseUtc(now) !== parseUtc(now)) return resultInvalid('NOW_INVALID', root, aggregateNodeSecret(root));
  const repository = normalizeRepository(getChild(root, 'repository'));
  if (!repository.valid) return resultInvalid(repository.reason_code, root, mergeSecretClassification(aggregateNodeSecret(root), repository.secret_classification));
  const authority = normalizeAuthority(getChild(root, 'authority'));
  if (!authority.valid) return resultInvalid(authority.reason_code, root, mergeSecretClassification(aggregateNodeSecret(root), authority.secret_classification));
  const operation = normalizeOperation(getChild(root, 'operation'));
  if (!operation.valid) return resultInvalid(operation.reason_code, root, mergeSecretClassification(aggregateNodeSecret(root), operation.secret_classification), { operation_type: operation.operation_type || null });
  const session = normalizeSession(getChild(root, 'session'));
  if (!session.valid) return resultInvalid(session.reason_code, root, mergeSecretClassification(aggregateNodeSecret(root), session.secret_classification));
  let scope = null;
  if (nodeHasOwnField(root, 'scope')) {
    const scopeNode = getChild(root, 'scope');
    if (scopeNode && scopeNode.kind === 'scalar' && scopeNode.type === 'null') scope = null;
    else {
      scope = scalarValue(scopeNode, 'string');
      if (!nonBlank(scope)) return resultInvalid('TICKET_SCOPE_INVALID', root, aggregateNodeSecret(root));
    }
  }
  return resultValid(Object.freeze({ enabled, activation: Object.freeze({ mode, consented }), now, repository: repository.value, authority: authority.value, operation: operation.value, ticket: getOpaque(root, 'ticket'), session: session.value, scope }), aggregateNodeSecret(root));
}

function targetInsideRepository(target, repository) {
  if (!target || target.kind !== 'filesystem-target') return true;
  const paths = [target.path, target.resolution?.canonical_path].filter(Boolean);
  return paths.every((value) => isWithin(repository.root, value) || isWithin(repository.worktree, value));
}

function classifyOperation(operation, repository) {
  const existing = classifyOperationOriginal(operation, repository);
  return existing;
}

const classifyOperationOriginal = classifyOperation;

function classifyOperation(operation, repository) {
  const type = operation.type;
  const operationClass = OPERATION_CLASS[type] || 'unsupported-operation';
  if (type === 'compound') {
    const components = [];
    let secret = 'none';
    let requiresTicket = false;
    let requiresController = false;
    let hardDeny = null;
    for (const component of operation.components) {
      const classified = classifyOperation(component, repository);
      components.push(classified);
      secret = mergeSecretClassification(secret, classified.secret_classification);
      requiresTicket ||= classified.requires_ticket;
      requiresController ||= classified.requires_controller;
      hardDeny = chooseHardDeny(hardDeny, classified.hard_deny);
      if (!classified.valid) return { valid: false, reason_code: classified.reason_code, operation_type: type, operation_class: operationClass, target_class: 'compound-target', secret_classification: secret, requires_ticket: requiresTicket, requires_controller: requiresController, components, hard_deny: hardDeny };
    }
    return { valid: true, operation_type: type, operation_class: operationClass, target_class: 'compound-target', secret_classification: secret, requires_ticket: requiresTicket, requires_controller: requiresController, components, hard_deny: hardDeny };
  }
  const targets = targetsOfOperation(operation);
  const secret = targets.reduce((value, target) => mergeSecretClassification(value, targetSecretClassification(target)), 'none');
  if (targets.some((target) => !targetInsideRepository(target, repository) && target.kind === 'filesystem-target')) return { valid: false, reason_code: 'TARGET_OUTSIDE_REPOSITORY', operation_type: type, operation_class: operationClass, target_class: 'unknown-target', secret_classification: mergeSecretClassification(secret, 'possible'), requires_ticket: false, requires_controller: false, hard_deny: null };
  let hardDeny = null;
  if (type === 'network.request' && secret !== 'none' && operation.destination?.kind === 'external-system') hardDeny = { reason_code: 'SECRET_EXFILTRATION_DENIED', operation_type: type, operation_class: operationClass, target_class: 'external-target', secret_classification: secret };
  if ((type === 'filesystem.delete' || type === 'filesystem.move') && targets.some((target) => protectedCanonicalTarget(target, repository))) hardDeny = chooseHardDeny(hardDeny, { reason_code: 'CATASTROPHIC_TARGET_DENIED', operation_type: type, operation_class: operationClass, target_class: 'protected-target', secret_classification: secret });
  let requiresTicket = false;
  let reasonCode = null;
  let requiresController = false;
  if (type === 'filesystem.read') { requiresTicket = secret !== 'none'; if (requiresTicket) reasonCode = 'SECRET_ACCESS_REQUIRES_TICKET'; }
  if (type === 'filesystem.create' || type === 'filesystem.write') {
    if (operation.target.resolution.existence === 'absent' && operation.no_clobber === true) requiresTicket = false;
    else { requiresTicket = true; reasonCode = 'OVERWRITE_APPROVAL_REQUIRED'; }
  }
  if (type === 'filesystem.delete' || type === 'filesystem.move' || type === 'git.push' || type === 'external.mutation' || type === 'network.request') requiresTicket = true;
  if (type === 'git.branch' && !['read', 'inspect', 'list', 'status'].includes(operation.mode)) { requiresTicket = true; reasonCode = 'MUTATING_GIT_OPERATION_REQUIRES_TICKET'; }
  if (type === 'github.mutation') { requiresTicket = true; requiresController = true; }
  return { valid: true, operation_type: type, operation_class: operationClass, target_class: hardDeny?.target_class || (targets.length === 0 ? 'no-target' : targets.length === 1 ? (targets[0].kind === 'filesystem-target' ? 'filesystem-target' : 'external-target') : 'compound-target'), secret_classification: secret, requires_ticket: requiresTicket, requires_controller: requiresController, reason_code: reasonCode, hard_deny: hardDeny };
}

function ticketBindingFor(inputValue, operation, state) {
  const session = inputValue.session || {};
  return {
    issuer_role: state.authority.role,
    issuer_identity_digest: state.identityDigest,
    issuer_authority_digest: state.authorityDigest,
    session_id: session.session_id,
    turn_id: session.turn_id,
    call_id: session.call_id,
    operation_type: operation.type,
    operation_digest: operationDigestCanonical(operation),
    target_digest: targetDigestCanonical(operation),
    scope: inputValue.scope === undefined ? null : inputValue.scope,
  };
}

function ticketDecision(inputValue, operation, classification, state) {
  if (classification.requires_controller && !state) return { decision: 'deny', reason_code: 'CONTROLLER_TRUST_SOURCE_REQUIRED', ticket_status: 'not-accepted' };
  if (classification.requires_controller && state.authority.role !== 'controller') return { decision: 'deny', reason_code: 'CONTROLLER_GITHUB_AUTHORITY_REQUIRED', ticket_status: 'not-accepted' };
  if (!inputValue.ticket) {
    return { decision: 'ask', reason_code: classification.reason_code || (operation.type === 'filesystem.read' ? 'SECRET_ACCESS_REQUIRES_TICKET' : 'AUTHORITY_TICKET_REQUIRED'), ticket_status: 'missing' };
  }
  if (!state) return { decision: 'deny', reason_code: 'TICKET_TRUST_SOURCE_REQUIRED', ticket_status: 'not-accepted' };
  const binding = ticketBindingFor(inputValue, operation, state);
  let consumed;
  try { consumed = state.context.consume(inputValue.ticket, binding); } catch { consumed = { valid: false, reason_code: 'TICKET_INVALID' }; }
  if (!consumed || consumed.valid !== true) return { decision: 'deny', reason_code: consumed?.reason_code || 'TICKET_INVALID', ticket_status: 'rejected' };
  return { decision: 'allow', reason_code: consumed.reason_code || 'TICKET_CONSUMED', ticket_status: 'consumed' };
}

function publicResult(fields) {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    decision: fields.decision,
    reason_code: fields.reason_code || 'UNSUPPORTED',
    operation_type: fields.operation_type === undefined ? null : fields.operation_type,
    operation_class: fields.operation_class === undefined ? null : fields.operation_class,
    target_class: fields.target_class || 'unknown-target',
    secret_classification: SECRET_CLASSIFICATIONS.has(fields.secret_classification) ? fields.secret_classification : 'possible',
    operation_digest: validDigest(fields.operation_digest) ? fields.operation_digest : null,
    target_digest: validDigest(fields.target_digest) ? fields.target_digest : null,
    ticket_status: fields.ticket_status || 'not-required',
    privacy_safe: true,
    structural_impact_required: fields.structural_impact_required === true,
  });
}

function evaluate(input, options = {}) {
  const observation = observeRoot(input, OBSERVATION_SCHEMAS.input);
  const root = observation.root;
  const enabled = scalarValue(getChild(root, 'enabled'), 'boolean');
  if (enabled !== true) return publicResult({ decision: 'unsupported', reason_code: 'CONTROL_PLANE_DEFAULT_OFF', secret_classification: observation.secret });
  const activation = getChild(root, 'activation');
  if (scalarValue(getChild(activation, 'mode'), 'string') !== 'explicit-local' || scalarValue(getChild(activation, 'consented'), 'boolean') !== true) return publicResult({ decision: 'unsupported', reason_code: 'ACTIVATION_REQUIRED', secret_classification: observation.secret });
  const partialDeny = reducePartialHardDeny(observation);
  if (partialDeny) return publicResult({ ...partialDeny, decision: 'deny', ticket_status: 'not-accepted' });
  const normalized = normalizeInput(root);
  if (!normalized.valid) return publicResult({ decision: 'unsupported', reason_code: normalized.reason_code, operation_type: normalized.operation_type || null, secret_classification: normalized.secret_classification, ticket_status: 'not-required' });
  const inputValue = normalized.value;
  const operation = inputValue.operation;
  const state = trustedStateFromOptions(options);
  if (!state) return publicResult({ decision: 'deny', reason_code: 'TICKET_TRUST_SOURCE_REQUIRED', operation_type: operation.type, secret_classification: normalized.secret_classification, ticket_status: 'not-accepted' });
  if (!trustedContextMatches(state, inputValue, operation)) return publicResult({ decision: 'unsupported', reason_code: 'REPOSITORY_INVALID', operation_type: operation.type, secret_classification: normalized.secret_classification, ticket_status: 'not-required' });
  const classification = classifyOperation(operation, inputValue.repository);
  if (!classification.valid) return publicResult({ decision: 'unsupported', reason_code: classification.reason_code, operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification });
  const hardDeny = classification.hard_deny;
  const operationDigestValue = operationDigestCanonical(operation);
  const targetDigestValue = targetDigestCanonical(operation);
  if (hardDeny) return publicResult({ ...hardDeny, decision: 'deny', operation_digest: operationDigestValue, target_digest: targetDigestValue, ticket_status: 'not-accepted' });
  const leaves = flattenClassifiedComponents(classification);
  if (leaves.some((item) => !state.authority.allowed_operation_types.includes(item.operation_type) || !inputValue.authority.allowed_operation_types.includes(item.operation_type))) return publicResult({ decision: 'unsupported', reason_code: 'COMPONENT_AUTHORITY_REQUIRED', operation_type: operation.type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestValue, target_digest: targetDigestValue });
  const ticket = ticketDecision(inputValue, operation, classification, state);
  return publicResult({ ...ticket, operation_type: operation.type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestValue, target_digest: targetDigestValue, structural_impact_required: false });
}

function assessStructuralImpact(change) {
  const observation = observeRoot(change, OBSERVATION_SCHEMAS.structural);
  const node = observation.root;
  if (!node || node.kind !== 'record' || !node.ownKeysOk || !node.protoValid || node.shapeInvalid) return Object.freeze({ valid: false, reason_code: 'STRUCTURAL_IMPACT_INPUT_INVALID', privacy_safe: true });
  const shape = exactRecordShape(node, ['kind', 'identity'], ['kind', 'identity']);
  if (!shape.ok) return Object.freeze({ valid: false, reason_code: 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED', privacy_safe: true });
  const kind = scalarValue(getChild(node, 'kind'), 'string');
  const identity = scalarValue(getChild(node, 'identity'), 'string');
  if (!nonBlank(kind) || !nonBlank(identity)) return Object.freeze({ valid: false, reason_code: 'STRUCTURAL_IMPACT_INPUT_INVALID', privacy_safe: true });
  if (kind === 'value-change') return Object.freeze({ valid: true, required: false, search_scope: 'local', consumer_categories: [], compatibility_rule: Object.freeze({ issue: 342, status: 'active-until-propagation-verification' }), privacy_safe: true });
  if (!STRUCTURAL_KINDS.has(kind)) return Object.freeze({ valid: false, reason_code: 'STRUCTURAL_IMPACT_KIND_UNSUPPORTED', privacy_safe: true });
  return Object.freeze({ valid: true, required: true, search_scope: 'targeted-repo-wide', consumer_categories: Object.freeze(['source-shape-tests', 'fixtures-and-snapshots', 'generated-surface-assertions', 'docs-config-contracts', 'imports-registrations', 'scripts-manifests-adapters']), compatibility_rule: Object.freeze({ issue: 342, status: 'active-until-propagation-verification' }), privacy_safe: true });
}

const publicApi = {
  CONTRACT_VERSION,
  REMOTE_IDENTITY_CONTRACT_VERSION,
  TICKET_CONTRACT_VERSION,
  POLICY,
  evaluate,
  validateRemoteIdentity,
  formatRemoteIdentity,
  operationDigest,
  targetDigest,
  assessStructuralImpact,
  isFilesystemRoot,
  isUncShareRoot,
};

module.exports = publicApi;

function normalizeStringArray(node, reason_code, options = {}) {
  if (!node || node.kind !== 'array' || !node.ownKeysOk || !node.protoValid || node.shapeInvalid || !node.lengthValid || node.length > MAX_ARRAY_LENGTH) return resultInvalid(reason_code, node, node?.secret || 'possible');
  const values = [];
  for (let index = 0; index < node.length; index += 1) {
    const item = scalarValue(node.indices[index]?.child, 'string');
    if (item === undefined || (options.nonBlank && !nonBlank(item))) return resultInvalid(reason_code, node, mergeSecretClassification(node.secret || 'none', 'possible'));
    values.push(item);
  }
  const result = Object.assign(values, { valid: true, value: Object.freeze(values.slice()), secret_classification: node.secret || 'none' });
  return result;
}

function ticketRequestObservation(input) {
  return observeRoot(input, {
    fieldNames: ['session_id', 'turn_id', 'call_id', 'operation_type', 'operation_digest', 'target_digest', 'scope', 'max_uses', 'expires_at'],
    fields: {},
  }).root;
}

function normalizeOperation(node, traversalState = { total: 0 }, depth = 0) {
  const secret = aggregateNodeSecret(node);
  if (!node || node.kind !== 'record') return resultInvalid('TYPED_OPERATION_REQUIRED', node, 'possible');
  const typeResult = normalizeString(getChild(node, 'type'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
  if (!typeResult.valid) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret);
  const type = typeResult.value;
  if (!OPERATION_TYPES.has(type)) return resultInvalid('UNSUPPORTED_OPERATION_TYPE', node, secret, { operation_type: type });
  if (type === 'shell') return resultInvalid('OPAQUE_OPERATION_UNSUPPORTED', node, secret, { operation_type: type });
  const fields = OPERATION_FIELDS[type];
  const required = operationRequiredFields(type);
  const shape = exactRecordShape(node, fields, []);
  if (!shape.ok) return resultInvalid('TYPED_OPERATION_FIELDS_UNSUPPORTED', node, secret, { operation_type: type });
  for (const field of required) if (!nodeHasOwnField(node, field)) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
  const normalized = { type };
  const add = (key, valueResult) => {
    if (!valueResult.valid) return valueResult;
    normalized[key] = valueResult.value;
    return valueResult;
  };
  const targetFor = (key) => {
    const targetResult = normalizeTarget(getChild(node, key));
    if (!targetResult.valid) return resultInvalid(targetResult.reason_code || 'TARGET_INVALID', node, mergeSecretClassification(secret, targetResult.secret_classification), { operation_type: type });
    normalized[key] = targetResult.value;
    return targetResult;
  };
  if (['filesystem.read', 'filesystem.write', 'filesystem.create', 'filesystem.delete'].includes(type)) {
    const targetResult = targetFor('target');
    if (!targetResult.valid) return targetResult;
  }
  if (type === 'filesystem.move') {
    const sourceResult = targetFor('source');
    if (!sourceResult.valid) return sourceResult;
    const destinationResult = targetFor('destination');
    if (!destinationResult.valid) return destinationResult;
  }
  if (['filesystem.write', 'filesystem.create', 'filesystem.move'].includes(type)) {
    const noClobber = normalizeBoolean(getChild(node, 'no_clobber'), 'TYPED_OPERATION_REQUIRED');
    if (!noClobber.valid) return resultInvalid(noClobber.reason_code, node, secret, { operation_type: type });
    normalized.no_clobber = noClobber.value;
  }
  if (type === 'git.branch') {
    const mode = normalizeString(getChild(node, 'mode'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
    const branch = normalizeString(getChild(node, 'branch'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
    if (!mode.valid || !branch.valid) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    normalized.mode = mode.value;
    normalized.branch = branch.value;
  }
  if (type === 'git.push') {
    const remote = normalizeString(getChild(node, 'remote'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const refspecs = normalizeStringArray(getChild(node, 'refspecs'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const options = normalizeStringArray(getChild(node, 'options'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const authorizedRemote = normalizeString(getChild(node, 'authorized_remote'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    const authorizedRef = normalizeString(getChild(node, 'authorized_ref'), 'BROADENED_PUSH_TARGET_UNSUPPORTED', { nonBlank: true });
    if (!remote.valid || !refspecs.valid || !options.valid || !authorizedRemote.valid || !authorizedRef.valid) return resultInvalid('BROADENED_PUSH_TARGET_UNSUPPORTED', node, secret, { operation_type: type });
    if (!GIT_REMOTE_NAME_PATTERN.test(remote.value) || remote.value.startsWith('-') || remote.value !== authorizedRemote.value || refspecs.length !== 1 || refspecs[0] !== `HEAD:${authorizedRef.value}` || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(authorizedRef.value) || options.length > 2 || new Set(options).size !== options.length || options.some((option) => !SAFE_GIT_PUSH_OPTIONS.has(option))) return resultInvalid('BROADENED_PUSH_TARGET_UNSUPPORTED', node, secret, { operation_type: type });
    normalized.remote = remote.value;
    normalized.refspecs = Object.freeze(refspecs.value.slice());
    normalized.options = Object.freeze(options.value.slice());
    normalized.authorized_remote = authorizedRemote.value;
    normalized.authorized_ref = authorizedRef.value;
  }
  if (type === 'github.read' || type === 'github.mutation') {
    const repository = normalizeString(getChild(node, 'repository'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
    const action = normalizeString(getChild(node, 'action'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
    const targetResult = normalizeTarget(getChild(node, 'target'));
    if (!repository.valid || !action.valid) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    if (!targetResult.valid || targetResult.value.kind !== 'github-repository') return resultInvalid(targetResult.reason_code || 'TARGET_INVALID', node, secret, { operation_type: type });
    normalized.repository = repository.value;
    normalized.action = action.value;
    normalized.target = targetResult.value;
  }
  if (type === 'network.request') {
    const sourceResult = targetFor('source');
    const destinationResult = targetFor('destination');
    const method = normalizeString(getChild(node, 'method'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
    if (!sourceResult.valid || !destinationResult.valid) return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (normalized.destination.kind !== 'external-system') return resultInvalid('TARGET_INVALID', node, secret, { operation_type: type });
    if (!method.valid) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    normalized.method = method.value;
  }
  if (type === 'external.mutation') {
    const action = normalizeString(getChild(node, 'action'), 'TYPED_OPERATION_REQUIRED', { nonBlank: true });
    const targetResult = normalizeTarget(getChild(node, 'target'));
    if (!action.valid) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    if (!targetResult.valid || targetResult.value.kind !== 'external-system') return resultInvalid(targetResult.reason_code || 'TARGET_INVALID', node, secret, { operation_type: type });
    normalized.action = action.value;
    normalized.target = targetResult.value;
  }
  if (type === 'compound') {
    if (depth >= MAX_COMPOUND_DEPTH) return resultInvalid('COMPOUND_DEPTH_LIMIT', node, secret, { operation_type: type });
    const componentsNode = getChild(node, 'components');
    if (!componentsNode || componentsNode.kind !== 'array' || !componentsNode.ownKeysOk || !componentsNode.protoValid || componentsNode.shapeInvalid || !componentsNode.lengthValid || componentsNode.length < 1 || componentsNode.length > MAX_COMPOUND_COMPONENTS) return resultInvalid('TYPED_OPERATION_REQUIRED', node, secret, { operation_type: type });
    if (traversalState.total + componentsNode.length > MAX_TOTAL_COMPOUND_COMPONENTS) return resultInvalid('COMPOUND_COMPONENT_LIMIT', node, secret, { operation_type: type });
    traversalState.total += componentsNode.length;
    const children = [];
    for (let index = 0; index < componentsNode.length; index += 1) {
      const childResult = normalizeOperation(componentsNode.indices[index]?.child, traversalState, depth + 1);
      if (!childResult.valid) return resultInvalid(childResult.reason_code || 'TYPED_OPERATION_REQUIRED', node, mergeSecretClassification(secret, childResult.secret_classification), { operation_type: type });
      children.push(childResult.value);
    }
    normalized.components = Object.freeze(children);
  }
  if (type === 'git.read') return resultValid(Object.freeze(normalized), secret);
  if (['filesystem.read', 'filesystem.delete', 'filesystem.write', 'filesystem.create', 'filesystem.move', 'git.branch', 'git.push', 'github.read', 'github.mutation', 'network.request', 'external.mutation', 'compound'].includes(type)) return resultValid(Object.freeze(normalized), secret);
  return resultInvalid('UNSUPPORTED_OPERATION_TYPE', node, secret, { operation_type: type });
}

function canonicalTargetFromObserved(node) {
  const normalized = normalizeTarget(node);
  if (normalized.valid) return normalized.value;
  return detachedValueFromNode(node, new Set(), TARGET_FIELDS);
}

function detachedValueFromNode(node, visited = new Set(), allowedFields = null) {
  if (!node || visited.has(node)) return null;
  visited.add(node);
  if (node.kind === 'scalar') return node.truncated ? null : node.value;
  if (node.kind === 'opaque') return null;
  if (node.kind === 'array') return Array.from({ length: Math.min(node.length || 0, MAX_ARRAY_LENGTH) }, (_, index) => detachedValueFromNode(node.indices[index]?.child, visited));
  if (node.kind !== 'record') return null;
  const fields = new Set(allowedFields || (node.entries || []).filter((entry) => entry && entry.data && typeof entry.key === 'string').map((entry) => entry.key));
  const output = {};
  for (const key of [...fields].sort()) {
    const entry = getEntry(node, key);
    if (entry && entry.data && entry.child) output[key] = detachedValueFromNode(entry.child, new Set(visited));
  }
  return output;
}

function canonicalOperationFromObserved(node, visited = new Set()) {
  if (!node || visited.has(node) || node.kind !== 'record') return detachedValueFromNode(node, visited);
  visited.add(node);
  const type = scalarValue(getChild(node, 'type'), 'string');
  const fields = OPERATION_FIELDS[type] || ['type'];
  const output = { type: type === undefined ? null : type };
  for (const field of fields) {
    if (field === 'type' || !nodeHasOwnField(node, field)) continue;
    const child = getChild(node, field);
    if (field === 'target' || field === 'source' || field === 'destination') output[field] = canonicalTargetFromObserved(child);
    else if (field === 'components' && child?.kind === 'array') output[field] = Array.from({ length: Math.min(child.length || 0, MAX_COMPOUND_COMPONENTS) }, (_, index) => canonicalOperationFromObserved(child.indices[index]?.child, new Set(visited)));
    else output[field] = detachedValueFromNode(child, new Set(visited));
  }
  return output;
}

function canonicalPlainTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const output = { kind: target.kind };
  if (target.kind === 'filesystem-target') output.path = target.path, output.resolution = target.resolution;
  else output.digest = target.digest;
  return output;
}

function canonicalPlainOperation(operation) {
  if (!operation || typeof operation !== 'object') return null;
  const fields = OPERATION_FIELDS[operation.type] || ['type'];
  const output = { type: operation.type };
  for (const field of fields) {
    if (field === 'type' || !Object.prototype.hasOwnProperty.call(operation, field)) continue;
    if (field === 'target' || field === 'source' || field === 'destination') output[field] = canonicalPlainTarget(operation[field]);
    else if (field === 'components') output[field] = operation.components.map((component) => canonicalPlainOperation(component));
    else if (Array.isArray(operation[field])) output[field] = operation[field].slice();
    else output[field] = operation[field];
  }
  return output;
}

function operationDigestCanonical(operation) {
  return digest(canonicalPlainOperation(operation));
}

function targetDigestCanonical(operation) {
  return digest({ targets: targetsOfOperation(canonicalPlainOperation(operation), []) });
}

function operationDigest(operation) {
  try {
    const normalized = normalizeOperation(observeRoot(operation, OBSERVATION_SCHEMAS.operation).root);
    return normalized.valid ? operationDigestCanonical(normalized.value) : null;
  } catch {
    return null;
  }
}
function targetDigest(operation) {
  try {
    const normalized = normalizeOperation(observeRoot(operation, OBSERVATION_SCHEMAS.operation).root);
    return normalized.valid ? targetDigestCanonical(normalized.value) : null;
  } catch {
    return null;
  }
}


function ticketDecision(inputValue, operation, classification, state) {
  if (!classification.requires_ticket) return { decision: 'allow', reason_code: 'ROUTINE_OPERATION_ALLOWED', ticket_status: 'not-required' };
  if (classification.requires_controller && !state) return { decision: 'deny', reason_code: 'CONTROLLER_TRUST_SOURCE_REQUIRED', ticket_status: 'not-accepted' };
  if (classification.requires_controller && state.authority.role !== 'controller') return { decision: 'deny', reason_code: 'CONTROLLER_GITHUB_AUTHORITY_REQUIRED', ticket_status: 'not-accepted' };
  if (!inputValue.ticket) return { decision: 'ask', reason_code: classification.reason_code || (operation.type === 'filesystem.read' ? 'SECRET_ACCESS_REQUIRES_TICKET' : 'AUTHORITY_TICKET_REQUIRED'), ticket_status: 'missing' };
  if (!state) return { decision: 'deny', reason_code: 'TICKET_TRUST_SOURCE_REQUIRED', ticket_status: 'not-accepted' };
  const binding = ticketBindingFor(inputValue, operation, state);
  let consumed;
  try { consumed = state.context.consume(inputValue.ticket, binding); } catch { consumed = { valid: false, reason_code: 'TICKET_INVALID' }; }
  if (!consumed || consumed.valid !== true) return { decision: 'deny', reason_code: consumed?.reason_code || 'TICKET_INVALID', ticket_status: 'rejected' };
  return { decision: 'allow', reason_code: consumed.reason_code || 'TICKET_CONSUMED', ticket_status: 'consumed' };
}
