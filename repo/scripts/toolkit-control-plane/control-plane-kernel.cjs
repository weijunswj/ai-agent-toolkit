'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'toolkit.control-plane.kernel.v1';
const REMOTE_IDENTITY_CONTRACT_VERSION = 'toolkit.control-plane.remote-identity.v1';
const TICKET_CONTRACT_VERSION = 'toolkit.control-plane.authority-ticket.v1';
const LINK_TYPES = new Set(['none', 'symlink', 'junction', 'reparse-point']);
const SECRET_CLASSIFICATIONS = new Set(['none', 'possible', 'confirmed']);
const ROLES = new Set(['executor', 'controller']);
const MAX_TICKET_USES = 8;
const SAFE_GIT_PUSH_OPTIONS = Object.freeze(['--porcelain', '--dry-run']);
const GIT_REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TRUSTED_CONTEXT_STATE = new WeakMap();
const TICKET_STORE_STATE = new WeakMap();
const TICKET_PROVENANCE = new WeakMap();
const TICKET_AUTHORITY_INPUT_FIELDS = new Set(['issuer', 'issuer_role', 'issuer_identity_digest', 'issuer_authority_digest', 'role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types']);
const POLICY = Object.freeze(require('../../../_projects/development/control-plane-kernel/_main/control-plane-policy.json'));
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
  'compound': ['type', 'components'],
  'shell': ['type', 'shell', 'command'],
});

function unsupportedOperationField(operation) {
  const allowed = OPERATION_FIELDS[operation.type];
  return allowed && Object.keys(operation).some((key) => !allowed.includes(key));
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const OPERATION_FIELD_UNION = Object.freeze([...new Set(Object.values(OPERATION_FIELDS).flat())]);
const INPUT_FIELDS = Object.freeze(['enabled', 'activation', 'now', 'repository', 'authority', 'operation', 'ticket', 'session', 'scope']);
const ACTIVATION_FIELDS = Object.freeze(['mode', 'consented']);
const SESSION_FIELDS = Object.freeze(['session_id', 'turn_id', 'call_id']);
const AUTHORITY_FIELDS = Object.freeze(['role', 'identity', 'provider', 'model', 'assignment', 'finality_claim', 'allowed_operation_types']);
const REPOSITORY_FIELDS = Object.freeze(['root', 'worktree', 'remote', 'resolution']);
const RESOLUTION_FIELDS = Object.freeze(['status', 'canonical_path', 'link_type', 'existence']);
const TARGET_FIELDS = Object.freeze(['kind', 'digest', 'path', 'resolution', 'target_class', 'resolved_inside']);

function mergeSecretClassification(left, right) {
  if (left === 'confirmed' || right === 'confirmed') return 'confirmed';
  if (left === 'possible' || right === 'possible') return 'possible';
  return 'none';
}

function descriptorSecretClassification(value, seen = new Set()) {
  if (typeof value === 'string') return deriveSecretClassification([value]);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 'none';
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return 'possible';
  if (!value || seen.has(value)) return 'possible';
  seen.add(value);
  let classification = 'none';
  try {
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string') {
        classification = mergeSecretClassification(classification, 'possible');
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        classification = mergeSecretClassification(classification, 'possible');
        continue;
      }
      classification = mergeSecretClassification(classification, descriptorSecretClassification(descriptor.value, seen));
    }
  } catch {
    classification = 'possible';
  }
  seen.delete(value);
  return classification;
}

function inspectOwnDataRecord(value, allowedFields, reasonCode) {
  if (!isRecord(value)) return failure(reasonCode);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return failure(reasonCode, { secret_classification: 'possible' });
  }
  const allowed = new Set(allowedFields);
  const projection = Object.create(null);
  let firstFailure = null;
  let secretClassification = 'none';
  for (const key of keys) {
    if (typeof key !== 'string') {
      if (!firstFailure) firstFailure = reasonCode;
      secretClassification = mergeSecretClassification(secretClassification, 'possible');
      continue;
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      if (!firstFailure) firstFailure = reasonCode;
      secretClassification = mergeSecretClassification(secretClassification, 'possible');
      continue;
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      if (!firstFailure) firstFailure = reasonCode;
      secretClassification = mergeSecretClassification(secretClassification, 'possible');
      continue;
    }
    secretClassification = mergeSecretClassification(secretClassification, descriptorSecretClassification(descriptor.value));
    if (!descriptor.enumerable || !allowed.has(key)) {
      if (!firstFailure) firstFailure = reasonCode;
      continue;
    }
    projection[key] = descriptor.value;
  }
  if (firstFailure) return failure(firstFailure, { secret_classification: secretClassification });
  return { valid: true, value: projection, secret_classification: secretClassification };
}

function canonicalScalar(value, reasonCode) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return { valid: true, value };
  }
  return failure(reasonCode);
}

function canonicalizeArray(value, itemNormalizer, reasonCode) {
  if (!Array.isArray(value)) return failure(reasonCode);
  let prototype;
  let keys;
  let lengthDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch {
    return failure(reasonCode, { secret_classification: 'possible' });
  }
  if (prototype !== Array.prototype || !lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    return failure(reasonCode, { secret_classification: descriptorSecretClassification(value) });
  }
  const length = lengthDescriptor.value;
  const expectedKeys = new Set();
  for (let index = 0; index < length; index += 1) expectedKeys.add(String(index));
  let firstFailure = null;
  let secretClassification = 'none';
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
      if (!firstFailure) firstFailure = reasonCode;
      secretClassification = mergeSecretClassification(secretClassification, 'possible');
      continue;
    }
    expectedKeys.delete(key);
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      if (!firstFailure) firstFailure = reasonCode;
      secretClassification = mergeSecretClassification(secretClassification, 'possible');
      continue;
    }
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      if (!firstFailure) firstFailure = reasonCode;
      secretClassification = mergeSecretClassification(secretClassification, descriptorSecretClassification(value));
      continue;
    }
    secretClassification = mergeSecretClassification(secretClassification, descriptorSecretClassification(descriptor.value));
  }
  if (expectedKeys.size > 0) firstFailure = firstFailure || reasonCode;
  if (firstFailure) return failure(firstFailure, { secret_classification: secretClassification });
  const projection = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const normalized = itemNormalizer(descriptor.value);
    if (!normalized.valid) return failure(normalized.reason_code || reasonCode, { secret_classification: mergeSecretClassification(secretClassification, normalized.secret_classification || 'none') });
    projection.push(normalized.value);
  }
  return { valid: true, value: projection };
}

function canonicalizeStringArray(value, reasonCode) {
  return canonicalizeArray(value, (item) => {
    if (typeof item !== 'string') return failure(reasonCode);
    return { valid: true, value: item };
  }, reasonCode);
}

function canonicalizeSimpleRecord(value, fields, reasonCode, booleanFields = new Set()) {
  const inspected = inspectOwnDataRecord(value, fields, reasonCode);
  if (!inspected.valid) return inspected;
  const projection = Object.create(null);
  for (const key of Object.keys(inspected.value)) {
    const item = inspected.value[key];
    if (booleanFields.has(key)) {
      if (typeof item !== 'boolean') return failure(reasonCode, { secret_classification: inspected.secret_classification || 'none' });
      projection[key] = item;
    } else if (typeof item !== 'string') {
      return failure(reasonCode, { secret_classification: inspected.secret_classification || 'none' });
    } else {
      projection[key] = item;
    }
  }
  return { valid: true, value: deepFreeze(projection) };
}

function canonicalizeResolution(value, reasonCode = 'TARGET_CONTEXT_CONFLICT') {
  const inspected = inspectOwnDataRecord(value, RESOLUTION_FIELDS, reasonCode);
  if (!inspected.valid) return inspected;
  const projection = Object.create(null);
  for (const key of Object.keys(inspected.value)) {
    if (typeof inspected.value[key] !== 'string') return failure(reasonCode, { secret_classification: inspected.secret_classification || 'none' });
    projection[key] = inspected.value[key];
  }
  return { valid: true, value: deepFreeze(projection) };
}

function canonicalizeTarget(value) {
  const inspected = inspectOwnDataRecord(value, TARGET_FIELDS, 'TARGET_CONTEXT_CONFLICT');
  if (!inspected.valid) return inspected;
  const raw = inspected.value;
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(raw, key);
  for (const key of ['kind', 'digest', 'path', 'target_class']) {
    if (hasOwn(key) && typeof raw[key] !== 'string') return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: inspected.secret_classification || 'none' });
  }
  if (hasOwn('resolved_inside') && typeof raw.resolved_inside !== 'boolean') return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: inspected.secret_classification || 'none' });
  let resolution = null;
  if (hasOwn('resolution')) {
    const normalizedResolution = canonicalizeResolution(raw.resolution);
    if (!normalizedResolution.valid) return failure(normalizedResolution.reason_code, { secret_classification: mergeSecretClassification(inspected.secret_classification || 'none', normalizedResolution.secret_classification || 'none') });
    resolution = normalizedResolution.value;
  }
  const hasKind = hasOwn('kind');
  const hasDigest = hasOwn('digest');
  const hasPath = hasOwn('path');
  const hasResolution = hasOwn('resolution');
  const external = hasKind && ['github-repository', 'external-system'].includes(raw.kind);
  if (hasKind && !external) return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: inspected.secret_classification || 'none' });
  if (external) {
    if (!validDigest(raw.digest) || hasPath || hasResolution) return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: hasPath || hasResolution ? mergeSecretClassification(inspected.secret_classification || 'none', 'possible') : inspected.secret_classification || 'none' });
    const projection = Object.create(null);
    projection.kind = raw.kind;
    projection.digest = raw.digest;
    for (const key of ['target_class', 'resolved_inside']) if (hasOwn(key)) projection[key] = raw[key];
    return { valid: true, value: deepFreeze(projection) };
  }
  if (hasDigest || !hasPath || !hasResolution || !nonBlank(raw.path)) return failure('TARGET_CONTEXT_INVALID', { secret_classification: inspected.secret_classification || 'none' });
  const projection = Object.create(null);
  projection.path = raw.path;
  projection.resolution = resolution;
  for (const key of ['target_class', 'resolved_inside']) if (hasOwn(key)) projection[key] = raw[key];
  return { valid: true, value: deepFreeze(projection) };
}

function canonicalizeOperation(value, seen = new Set()) {
  if (seen.has(value)) return failure('TYPED_OPERATION_REQUIRED', { secret_classification: 'possible' });
  const inspected = inspectOwnDataRecord(value, OPERATION_FIELD_UNION, 'TYPED_OPERATION_FIELDS_UNSUPPORTED');
  if (!inspected.valid) return inspected;
  const raw = inspected.value;
  if (typeof raw.type !== 'string' || !nonBlank(raw.type)) return failure('TYPED_OPERATION_REQUIRED', { secret_classification: inspected.secret_classification || 'none' });
  const allowedFields = OPERATION_FIELDS[raw.type];
  const rawKeys = Object.keys(raw);
  if ((allowedFields && rawKeys.some((key) => !allowedFields.includes(key))) || (!allowedFields && rawKeys.some((key) => key !== 'type'))) {
    return failure('TYPED_OPERATION_FIELDS_UNSUPPORTED', { secret_classification: inspected.secret_classification || 'none' });
  }
  const projection = Object.create(null);
  seen.add(value);
  try {
    for (const key of rawKeys) {
      let normalized;
      if (['target', 'source', 'destination'].includes(key)) normalized = canonicalizeTarget(raw[key]);
      else if (key === 'components') normalized = canonicalizeArray(raw[key], (item) => canonicalizeOperation(item, seen), 'TYPED_OPERATION_REQUIRED');
      else if (['refspecs', 'options'].includes(key)) normalized = canonicalizeStringArray(raw[key], key === 'options' ? 'BROADENED_PUSH_TARGET_UNSUPPORTED' : 'TYPED_OPERATION_REQUIRED');
      else normalized = canonicalScalar(raw[key], 'TYPED_OPERATION_REQUIRED');
      if (!normalized.valid) return failure(normalized.reason_code, { secret_classification: mergeSecretClassification(inspected.secret_classification || 'none', normalized.secret_classification || 'none') });
      projection[key] = normalized.value;
    }
  } finally {
    seen.delete(value);
  }
  return { valid: true, value: deepFreeze(projection) };
}

function canonicalizeAuthority(value) {
  const inspected = inspectOwnDataRecord(value, AUTHORITY_FIELDS, 'AUTHORITY_IDENTITY_INVALID');
  if (!inspected.valid) return inspected;
  const projection = Object.create(null);
  for (const key of Object.keys(inspected.value)) {
    if (key === 'allowed_operation_types') {
      const normalized = canonicalizeStringArray(inspected.value[key], 'AUTHORITY_IDENTITY_INVALID');
      if (!normalized.valid) return failure('AUTHORITY_IDENTITY_INVALID', { secret_classification: mergeSecretClassification(inspected.secret_classification || 'none', normalized.secret_classification || 'none') });
      projection[key] = normalized.value;
    } else if (key === 'finality_claim') {
      if (typeof inspected.value[key] !== 'boolean') return failure('AUTHORITY_IDENTITY_INVALID', { secret_classification: inspected.secret_classification || 'none' });
      projection[key] = inspected.value[key];
    } else if (typeof inspected.value[key] !== 'string') {
      return failure('AUTHORITY_IDENTITY_INVALID', { secret_classification: inspected.secret_classification || 'none' });
    } else {
      projection[key] = inspected.value[key];
    }
  }
  return { valid: true, value: deepFreeze(projection) };
}

function canonicalizeRepository(value) {
  const inspected = inspectOwnDataRecord(value, REPOSITORY_FIELDS, 'REPOSITORY_CONTEXT_INVALID');
  if (!inspected.valid) return inspected;
  const projection = Object.create(null);
  for (const key of Object.keys(inspected.value)) {
    if (key === 'resolution') {
      const normalized = canonicalizeResolution(inspected.value[key], 'REPOSITORY_CONTEXT_INVALID');
      if (!normalized.valid) return failure(normalized.reason_code, { secret_classification: mergeSecretClassification(inspected.secret_classification || 'none', normalized.secret_classification || 'none') });
      projection[key] = normalized.value;
    } else if (typeof inspected.value[key] !== 'string') {
      return failure('REPOSITORY_CONTEXT_INVALID', { secret_classification: inspected.secret_classification || 'none' });
    } else {
      projection[key] = inspected.value[key];
    }
  }
  return { valid: true, value: deepFreeze(projection) };
}

function canonicalizeInput(value) {
  const inspected = inspectOwnDataRecord(value, INPUT_FIELDS, 'CONTROL_PLANE_INPUT_INVALID');
  if (!inspected.valid) return inspected;
  const raw = inspected.value;
  const projection = Object.create(null);
  for (const key of Object.keys(raw)) {
    let normalized;
    if (key === 'activation') normalized = canonicalizeSimpleRecord(raw[key], ACTIVATION_FIELDS, 'CONTROL_PLANE_INPUT_INVALID', new Set(['consented']));
    else if (key === 'session') normalized = canonicalizeSimpleRecord(raw[key], SESSION_FIELDS, 'CONTROL_PLANE_INPUT_INVALID');
    else if (key === 'authority') normalized = canonicalizeAuthority(raw[key]);
    else if (key === 'repository') normalized = canonicalizeRepository(raw[key]);
    else if (key === 'operation') normalized = canonicalizeOperation(raw[key]);
    else if (key === 'enabled') normalized = typeof raw[key] === 'boolean' ? { valid: true, value: raw[key] } : failure('CONTROL_PLANE_INPUT_INVALID');
    else if (key === 'now') normalized = typeof raw[key] === 'string' ? { valid: true, value: raw[key] } : failure('CONTROL_PLANE_INPUT_INVALID');
    else if (key === 'scope') normalized = raw[key] === null || typeof raw[key] === 'string' ? { valid: true, value: raw[key] } : failure('CONTROL_PLANE_INPUT_INVALID');
    else normalized = { valid: true, value: raw[key] };
    if (!normalized.valid) return failure(normalized.reason_code, { secret_classification: mergeSecretClassification(inspected.secret_classification || 'none', normalized.secret_classification || 'none') });
    projection[key] = normalized.value;
  }
  return { valid: true, value: deepFreeze(projection) };
}

function trustedStateFromOptions(options) {
  if (!isRecord(options)) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, 'trustedAuthorityContext');
  } catch {
    return null;
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
  return TRUSTED_CONTEXT_STATE.get(descriptor.value) || null;
}
function stableValue(value) {
  if (Array.isArray(value)) {
    const projection = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError('POLICY_DATA_ACCESSOR_REJECTED');
      projection.push(stableValue(descriptor.value));
    }
    return projection;
  }
  if (isRecord(value)) {
    const projection = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError('POLICY_DATA_ACCESSOR_REJECTED');
      projection[key] = stableValue(descriptor.value);
    }
    return projection;
  }
  return value;
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('POLICY_DATA_NUMBER_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableSerialize(value[key])).join(',') + '}';
  throw new TypeError('POLICY_DATA_SERIALIZATION_UNSUPPORTED');
}

function stableStringify(value) { return stableSerialize(stableValue(value)); }
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex'); }
function nonBlank(value) { return typeof value === 'string' && value.trim().length > 0 && value === value.trim(); }
function validDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }

function parseUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function nowFrom(value) {
  if (typeof value === 'function') return nowFrom(value());
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  return parseUtc(value);
}

function failure(reasonCode, extra = {}) { return { valid: false, reason_code: reasonCode, ...extra }; }
function remoteFailure(reasonCode) { return deepFreeze(failure(reasonCode)); }

function canonicalHost(host) {
  const value = String(host || '').toLowerCase();
  if (!value || value.includes('\\') || value.includes('/') || value.includes('@')) return null;
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function validRemotePath(value) { return nonBlank(value) && !/[\\\s\0]/.test(value) && !value.includes('@') && !value.startsWith('//'); }

function validateUrlRemote(value) {
  let url;
  try { url = new URL(value); } catch { return remoteFailure('REMOTE_IDENTITY_INVALID'); }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!['https', 'ssh'].includes(scheme) || !url.hostname || url.hash || url.search) return remoteFailure('REMOTE_IDENTITY_INVALID');
  if (url.password || (scheme === 'https' && url.username) || (scheme === 'ssh' && url.username && url.username !== 'git')) return remoteFailure('REMOTE_IDENTITY_CREDENTIALS_REJECTED');
  const host = canonicalHost(url.hostname);
  if (!host || !validRemotePath(url.pathname) || !url.pathname.startsWith('/') || url.pathname === '/') return remoteFailure('REMOTE_IDENTITY_INVALID');
  const port = url.port ? Number(url.port) : null;
  if (url.port && (!Number.isInteger(port) || port < 1 || port > 65535)) return remoteFailure('REMOTE_IDENTITY_INVALID');
  const hostPart = host.includes(':') ? `[${host}]` : host;
  const userPart = scheme === 'ssh' && url.username ? 'git@' : '';
  return { valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'url', scheme, host, port, path: url.pathname, canonical: `${scheme}://${userPart}${hostPart}${port ? `:${port}` : ''}${url.pathname}` };
}

function validateScpRemote(value) {
  const match = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):([^\s]+)$/.exec(value);
  if (!match || value.includes('@@')) return remoteFailure('REMOTE_IDENTITY_INVALID');
  const [, user, rawHost, remotePath] = match;
  const host = canonicalHost(rawHost);
  if (!host || !validRemotePath(remotePath) || remotePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(remotePath) || remotePath.startsWith('.')) return remoteFailure('REMOTE_IDENTITY_INVALID');
  return { valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'scp', scheme: 'scp', user, host, port: null, path: remotePath, canonical: `${user}@${host}:${remotePath}` };
}

function validateRemoteIdentity(value) {
  if (!nonBlank(value) || /[\0\r\n]/.test(value)) return remoteFailure('REMOTE_IDENTITY_INVALID');
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('//') || value.startsWith('./') || value.startsWith('../')) return remoteFailure('REMOTE_IDENTITY_LOCAL_PATH_REJECTED');
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return deepFreeze(validateUrlRemote(value));
  return deepFreeze(validateScpRemote(value));
}

function formatRemoteIdentity(value) { const result = validateRemoteIdentity(value); return result.valid ? result.canonical : null; }

function normalizePath(value) {
  if (!nonBlank(value)) return null;
  const replaced = value.replaceAll('/', '\\');
  const unc = replaced.startsWith('\\\\');
  const drive = /^[A-Za-z]:/.test(replaced);
  const prefix = unc ? '\\\\' : drive ? replaced.slice(0, 2) : '';
  const body = unc ? replaced.slice(2) : drive ? replaced.slice(2) : replaced;
  const segments = [];
  for (const segment of body.split('\\')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (segments.length && segments.at(-1) !== '..') segments.pop(); else if (!prefix) segments.push(segment); continue; }
    segments.push(segment);
  }
  if (unc) return `${prefix}${segments.join('\\')}`;
  if (drive) return `${prefix}\\${segments.join('\\')}`;
  return segments.join('\\');
}

function pathKey(value) { const normalized = normalizePath(value); return normalized ? normalized.toLowerCase() : null; }
function samePath(left, right) { const a = pathKey(left); const b = pathKey(right); return Boolean(a && b && a === b); }
function isWithin(root, candidate) { const a = pathKey(root); const b = pathKey(candidate); return Boolean(a && b && (a === b || b.startsWith(`${a}\\`))); }
function isUncShareRoot(value) { const normalized = normalizePath(value); return Boolean(normalized && normalized.startsWith('\\\\') && normalized.slice(2).split('\\').filter(Boolean).length === 2); }
function isFilesystemRoot(value) { const normalized = normalizePath(value); return normalized === '\\' || /^[a-z]:\\?$/.test(String(normalized || '').toLowerCase()) || isUncShareRoot(value); }

function isSecretLike(value) {
  const normalized = String(value || '').replaceAll('\\', '/').toLowerCase();
  const basename = normalized.split('/').at(-1) || '';
  return basename === '.env' || basename.startsWith('.env.') || basename.endsWith('.pem') || basename.endsWith('.key') || basename.includes('credential') || basename.includes('secret') || basename.includes('token');
}

function isDynamicPath(value) { return typeof value !== 'string' || /[*?{}$()%`]/.test(value) || value.includes('\\\\?\\'); }
function deriveSecretClassification(values) { const list = Array.isArray(values) ? values : [values]; if (list.some((value) => typeof value === 'string' && isSecretLike(value))) return 'confirmed'; if (list.some(isDynamicPath)) return 'possible'; return 'none'; }
function operationDigestFromProjection(operation) { return digest(operation); }
function targetDigestFromProjection(operation) { return digest({ targets: [operation.target, operation.source, operation.destination, operation.targets].filter((value) => value !== undefined) }); }
function operationDigest(operation) {
  const normalized = canonicalizeOperation(operation);
  if (!normalized.valid) throw new TypeError(normalized.reason_code || 'TYPED_OPERATION_REQUIRED');
  return operationDigestFromProjection(normalized.value);
}
function targetDigest(operation) {
  const normalized = canonicalizeOperation(operation);
  if (!normalized.valid) throw new TypeError(normalized.reason_code || 'TYPED_OPERATION_REQUIRED');
  return targetDigestFromProjection(normalized.value);
}
function safeOperationDigest(operation) {
  try { return operationDigest(operation); } catch { return null; }
}
function safeTargetDigest(operation) {
  try { return targetDigest(operation); } catch { return null; }
}
function normalizeLinkType(value) { return typeof value === 'string' && LINK_TYPES.has(value) ? value : null; }
function targetEvidenceValues(value) {
  const resolution = isRecord(value?.resolution) ? value.resolution : null;
  return [value?.path, resolution?.canonical_path].filter((item) => item !== undefined && item !== null);
}
function conflictSecretClassification(value) {
  const values = targetEvidenceValues(value);
  const derived = deriveSecretClassification(values);
  if (derived === 'confirmed') return 'confirmed';
  if (values.length > 1) return 'possible';
  return derived;
}
function validGitRemoteName(value) {
  return nonBlank(value) && GIT_REMOTE_NAME_PATTERN.test(value) && !value.includes('..') && !value.endsWith('.') && !value.includes('@{');
}

function authorityIdentityError(authority) {
  if (!isRecord(authority)) return 'AUTHORITY_IDENTITY_INVALID';
  if (!ROLES.has(authority.role) || !nonBlank(authority.provider) || !nonBlank(authority.model) || !nonBlank(authority.assignment)) return 'AUTHORITY_IDENTITY_INVALID';
  if (authority.role.includes('/') || authority.role.includes(' ')) return 'AUTHORITY_IDENTITY_INVALID';
  if (authority.finality_claim === true) return 'CALLER_FINALITY_REJECTED';
  if (authority.finality_claim !== false || !Array.isArray(authority.allowed_operation_types) || authority.allowed_operation_types.some((value) => !nonBlank(value))) return 'AUTHORITY_IDENTITY_INVALID';
  return null;
}

function authorityEvidenceDigest(authority) {
  if (!isRecord(authority) || authorityIdentityError(authority) || !nonBlank(authority.identity)) return null;
  return digest({
    identity: authority.identity,
    role: authority.role,
    provider: authority.provider,
    model: authority.model,
    assignment: authority.assignment,
    finality_claim: authority.finality_claim,
    allowed_operation_types: [...new Set(authority.allowed_operation_types)].sort(),
  });
}

function normalizeTrustedAuthority(authority) {
  const normalized = canonicalizeAuthority(authority);
  if (!normalized.valid || authorityIdentityError(normalized.value) || !nonBlank(normalized.value.identity)) return null;
  const contract = normalized.value;
  return deepFreeze({
    role: contract.role,
    identity: contract.identity,
    provider: contract.provider,
    model: contract.model,
    assignment: contract.assignment,
    finality_claim: contract.finality_claim,
    allowed_operation_types: [...new Set(contract.allowed_operation_types)],
  });
}

function normalizeRepository(repository) {
  if (!isRecord(repository) || !nonBlank(repository.root) || !nonBlank(repository.worktree)) return failure('REPOSITORY_CONTEXT_INVALID');
  const root = normalizePath(repository.root); const worktree = normalizePath(repository.worktree);
  if (!root || !worktree || !isWithin(root, worktree)) return failure('REPOSITORY_CONTEXT_INVALID');
  if (repository.remote !== undefined) { const remote = validateRemoteIdentity(repository.remote); if (!remote.valid) return remote; if (!isRecord(repository.resolution)) return failure('REPOSITORY_IDENTITY_UNRESOLVED'); }
  const resolution = repository.resolution || { status: 'resolved', link_type: 'none' };
  if (resolution.status !== 'resolved') return failure('REPOSITORY_IDENTITY_UNRESOLVED');
  const linkType = normalizeLinkType(resolution.link_type);
  if (!linkType) return failure('UNKNOWN_RESOLVER_LINK_TYPE');
  return { valid: true, root, worktree, remote: repository.remote === undefined ? null : formatRemoteIdentity(repository.remote), link_type: linkType };
}

function normalizeTarget(value, repository) {
  if (!isRecord(value)) return failure('TARGET_CONTEXT_INVALID');
  const externalKinds = ['github-repository', 'external-system'];
  const hasExternalKind = nonBlank(value.kind) && externalKinds.includes(value.kind);
  if (hasExternalKind) {
    const keys = Object.keys(value);
    if (!validDigest(value.digest) || keys.some((key) => !['kind', 'digest', 'target_class', 'resolved_inside'].includes(key))) return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: conflictSecretClassification(value) });
    return { valid: true, target_class: 'external-system', status: 'resolved', path_digest: value.digest, path: null, link_type: 'none', secret_values: [] };
  }
  if (value.kind !== undefined || value.digest !== undefined) return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: conflictSecretClassification(value) });
  if (!nonBlank(value.path)) return failure('TARGET_CONTEXT_INVALID');
  const rawPath = normalizePath(value.path);
  if (!rawPath) return failure('TARGET_CONTEXT_INVALID');
  const resolution = isRecord(value.resolution) ? value.resolution : null;
  if (!resolution || resolution.status !== 'resolved') return failure('TARGET_CONTEXT_INVALID');
  const linkType = normalizeLinkType(resolution.link_type);
  if (!linkType) return failure('UNKNOWN_RESOLVER_LINK_TYPE', { secret_classification: deriveSecretClassification([rawPath, resolution.canonical_path].filter((item) => item !== undefined && item !== null)) });
  const canonicalInput = resolution.canonical_path === undefined ? value.path : resolution.canonical_path;
  const canonicalPath = normalizePath(canonicalInput);
  const secretValues = [rawPath, canonicalPath].filter(Boolean);
  if (!canonicalPath) return failure('TARGET_CONTEXT_INVALID', { secret_classification: deriveSecretClassification([rawPath, canonicalInput].filter((item) => item !== undefined && item !== null)) });
  if (linkType === 'none' && !samePath(rawPath, canonicalPath)) return failure('TARGET_CONTEXT_CONFLICT', { secret_classification: conflictSecretClassification(value) });
  let targetClass = 'outside-repository';
  if (samePath(canonicalPath, repository.root)) targetClass = 'canonical-repository';
  else if (samePath(canonicalPath, repository.worktree)) targetClass = 'canonical-worktree';
  else if (isWithin(repository.root, canonicalPath)) targetClass = 'canonical-repository';
  if (linkType !== 'none') targetClass = 'unresolved-target';
  return { valid: true, target_class: targetClass, status: 'resolved', path_digest: digest(canonicalPath), path: canonicalPath, raw_path: rawPath, secret_values: secretValues, link_type: linkType, existence: resolution.existence || 'unknown' };
}

function operationTargets(operation) { return [operation.target, operation.source, operation.destination, ...(Array.isArray(operation.targets) ? operation.targets : [])].filter((value) => value !== undefined); }

function targetClassForComponents(components) {
  const flattened = components.flatMap(flattenClassifiedComponents);
  return flattened.some((item) => item.target_class === 'external-system') ? 'external-system' : flattened.some((item) => item.target_class === 'outside-repository') ? 'outside-repository' : flattened.some((item) => item.target_class === 'unresolved-target') ? 'unresolved-target' : flattened[0]?.target_class || 'unknown-target';
}

function selectHardDeny(current, candidate) {
  if (!candidate) return current;
  if (!current || candidate.reason_code === 'SECRET_EXFILTRATION_DENIED' || current.reason_code !== 'SECRET_EXFILTRATION_DENIED') return candidate;
  return current;
}

function hardDenyForClassifiedComponents(components, repository, operationType = 'compound') {
  const flattened = components.flatMap(flattenClassifiedComponents);
  const targetClass = targetClassForComponents(flattened);
  const secretValues = flattened.flatMap((item) => Array.isArray(item.secret_values) ? item.secret_values : []);
  const derivedSecretClassification = deriveSecretClassification(secretValues);
  const secretClassification = derivedSecretClassification !== 'none' ? derivedSecretClassification : flattened.some((item) => item.secret_classification === 'confirmed') ? 'confirmed' : flattened.some((item) => item.secret_classification === 'possible') ? 'possible' : 'none';
  const operationClass = operationType === 'compound' ? 'compound' : flattened[0]?.operation_class || operationType;
  if (flattened.some((item) => item.operation_type === 'network.request' && item.secret_classification !== 'none')) return { decision: 'deny', reason_code: 'SECRET_EXFILTRATION_DENIED', operation_type: operationType, operation_class: operationClass, target_class: targetClass, secret_classification: secretClassification, ticket_status: 'not-accepted' };
  if (flattened.some((item) => ['filesystem.delete', 'filesystem.move'].includes(item.operation_type) && item.targets.some((target) => target.path && (isFilesystemRoot(target.path) || samePath(target.path, repository.root))))) return { decision: 'deny', reason_code: 'CATASTROPHIC_TARGET_DENIED', operation_type: operationType, operation_class: operationClass, target_class: 'protected-target', secret_classification: secretClassification, ticket_status: 'not-accepted' };
  return null;
}

function classifyOperation(operation, repository) {
  if (!isRecord(operation) || !nonBlank(operation.type)) return failure('TYPED_OPERATION_REQUIRED');
  if (operation.type === 'shell') return failure('OPAQUE_OPERATION_UNSUPPORTED');
  if (unsupportedOperationField(operation)) return failure('TYPED_OPERATION_FIELDS_UNSUPPORTED');
  if (operation.type === 'compound') {
    if (!Array.isArray(operation.components) || operation.components.length < 1 || operation.components.length > 16) return failure('TYPED_OPERATION_REQUIRED');
    const components = [];
    let firstInvalid = null;
    let hardDeny = null;
    for (const component of operation.components) {
      const classified = classifyOperation(component, repository);
      if (!classified.valid) {
        if (!firstInvalid) firstInvalid = classified;
        hardDeny = selectHardDeny(hardDeny, classified.hard_deny);
        continue;
      }
      components.push(classified);
      hardDeny = selectHardDeny(hardDeny, hardDenyForClassifiedComponents([classified], repository, 'compound'));
    }
    if (firstInvalid) {
      if (hardDeny) return failure(firstInvalid.reason_code, { hard_deny: hardDeny });
      return firstInvalid;
    }
    const targetClass = targetClassForComponents(components);
    const requiresTicket = components.some((item) => item.requires_ticket || (item.secret_classification === 'confirmed' && ['filesystem.read', 'filesystem.create', 'filesystem.write', 'filesystem.move'].includes(item.operation_type)));
    return { valid: true, operation_type: 'compound', operation_class: 'compound', target_class: targetClass, secret_classification: deriveSecretClassification(components.flatMap((item) => item.secret_values)), secret_values: components.flatMap((item) => item.secret_values), requires_ticket: requiresTicket, components };
  }
  const normalizedTargets = [];
  for (const value of operationTargets(operation)) { const target = normalizeTarget(value, repository); if (!target.valid) return target; normalizedTargets.push(target); }
  const paths = normalizedTargets.flatMap((item) => Array.isArray(item.secret_values) ? item.secret_values : [item.path]).filter(Boolean);
  const secretClassification = deriveSecretClassification(paths);
  if (secretClassification === 'possible') return failure('DYNAMIC_TARGET_UNSUPPORTED', { secret_classification: 'possible' });
  if (operation.secret_classification !== undefined && !SECRET_CLASSIFICATIONS.has(operation.secret_classification)) return failure('SECRET_CLASSIFICATION_INVALID');
  const targetClass = normalizedTargets.some((item) => item.target_class === 'external-system') ? 'external-system' : normalizedTargets.some((item) => item.target_class === 'outside-repository') ? 'outside-repository' : normalizedTargets.some((item) => item.target_class === 'unresolved-target') ? 'unresolved-target' : normalizedTargets[0]?.target_class || 'unknown-target';
  if (operation.type === 'filesystem.move') {
    if (normalizedTargets.length !== 2 || operation.source === undefined || operation.destination === undefined) return failure('TYPED_OPERATION_REQUIRED');
  } else if (['filesystem.read', 'filesystem.write', 'filesystem.create', 'filesystem.delete'].includes(operation.type) && normalizedTargets.length !== 1) return failure('TYPED_OPERATION_REQUIRED');
  if (operation.type === 'network.request' && (!operation.source || !operation.destination)) return failure('TYPED_OPERATION_REQUIRED');
  if (['github.read', 'github.mutation', 'external.mutation'].includes(operation.type) && normalizedTargets.length !== 1) return failure('TYPED_OPERATION_REQUIRED');

  let operationClass = operation.type; let requiresTicket = false; let reasonCode = null;
  if (operation.type === 'filesystem.create') {
    if (operation.no_clobber === true && normalizedTargets[0]?.existence === 'absent') operationClass = 'filesystem.create';
    else { operationClass = 'filesystem.overwrite'; requiresTicket = true; reasonCode = 'OVERWRITE_APPROVAL_REQUIRED'; }
  } else if (operation.type === 'filesystem.write' || operation.type === 'filesystem.move') { operationClass = 'filesystem.overwrite'; requiresTicket = true; reasonCode = 'OVERWRITE_APPROVAL_REQUIRED';
  } else if (operation.type === 'filesystem.delete') { operationClass = 'filesystem.delete'; requiresTicket = true; reasonCode = 'DELETE_APPROVAL_REQUIRED';
  } else if (operation.type === 'git.branch') {
    if (!['list', 'show'].includes(operation.mode)) { operationClass = 'git.branch-mutation'; requiresTicket = true; reasonCode = 'MUTATING_GIT_OPERATION_REQUIRES_TICKET'; } else operationClass = 'git.branch-read';
  } else if (operation.type === 'git.push') {
    if (!Array.isArray(operation.refspecs) || operation.refspecs.length !== 1 || !validGitRemoteName(operation.remote) || !validGitRemoteName(operation.authorized_remote) || !nonBlank(operation.authorized_ref)) return failure('GIT_PUSH_TARGET_EVIDENCE_REQUIRED');
    if (!Array.isArray(operation.options) || new Set(operation.options).size !== operation.options.length || operation.options.some((option) => !nonBlank(option) || !SAFE_GIT_PUSH_OPTIONS.includes(option))) return failure('BROADENED_PUSH_TARGET_UNSUPPORTED');
    if (operation.remote !== operation.authorized_remote || operation.refspecs[0] !== `HEAD:${operation.authorized_ref}`) return failure('GIT_PUSH_TARGET_MISMATCH');
    operationClass = 'git.push'; requiresTicket = true; reasonCode = 'GIT_PUSH_REQUIRES_TICKET';
  } else if (operation.type === 'github.mutation' || operation.type === 'external.mutation') { operationClass = operation.type; requiresTicket = true; reasonCode = 'EXTERNAL_MUTATION_REQUIRES_TICKET';
  } else if (operation.type === 'network.request') { operationClass = 'network.request'; requiresTicket = true; reasonCode = secretClassification === 'none' ? 'EXTERNAL_MUTATION_REQUIRES_TICKET' : 'SECRET_EXFILTRATION_DENIED';
  } else if (!['filesystem.read', 'git.read'].includes(operation.type)) return failure('UNSUPPORTED_OPERATION_TYPE');
  return { valid: true, operation_type: operation.type, operation_class: operationClass, target_class: targetClass, targets: normalizedTargets, secret_classification: secretClassification, secret_values: paths, requires_ticket: requiresTicket, reason_code: reasonCode };
}

function ticketRequestFor(input, operation, authority) {
  return {
    issuer_role: authority?.role,
    issuer_identity_digest: nonBlank(authority?.identity) ? digest(authority.identity) : null,
    issuer_authority_digest: authorityEvidenceDigest(authority),
    session_id: input.session?.session_id,
    turn_id: input.session?.turn_id,
    call_id: input.session?.call_id,
    operation_type: operation.type,
    operation_digest: operationDigestFromProjection(operation),
    target_digest: targetDigestFromProjection(operation),
    scope: input.scope === undefined ? null : input.scope,
  };
}

function publicResult(fields) { return deepFreeze({ contract_version: CONTRACT_VERSION, decision: fields.decision, reason_code: fields.reason_code, operation_type: fields.operation_type || null, operation_class: fields.operation_class || null, target_class: fields.target_class || 'unknown-target', secret_classification: fields.secret_classification || 'none', operation_digest: fields.operation_digest || null, target_digest: fields.target_digest || null, ticket_status: fields.ticket_status || 'not-required', privacy_safe: true, structural_impact_required: fields.structural_impact_required === true }); }
function baseFailure(reasonCode, input = {}) { return publicResult({ decision: 'unsupported', reason_code: reasonCode, operation_digest: input.operation ? safeOperationDigest(input.operation) : null, target_digest: input.operation ? safeTargetDigest(input.operation) : null, secret_classification: input.secret_classification || 'none' }); }

class TicketStore {
  constructor(context, options = {}) {
    if (!TRUSTED_CONTEXT_STATE.has(context)) throw new Error('TRUSTED_AUTHORITY_CONTEXT_INVALID');
    this._context = context;
    this._now = options.now || (() => Date.now());
    this._maxEntries = Number.isSafeInteger(options.maxEntries) ? options.maxEntries : 256;
    this._maxLifetimeMs = Number.isSafeInteger(options.maxLifetimeMs) ? options.maxLifetimeMs : 5 * 60 * 1000;
    this._records = new Map();
    this._sequence = 0;
    if (this._maxEntries < 1 || this._maxLifetimeMs < 1) throw new Error('TICKET_STORE_BOUNDS_INVALID');
    TICKET_STORE_STATE.set(this, { context });
  }

  _currentTime() { const value = nowFrom(this._now); if (!Number.isFinite(value)) throw new Error('TICKET_TIME_INVALID'); return value; }

  issue(input) {
    const storeState = TICKET_STORE_STATE.get(this);
    const contextState = storeState ? TRUSTED_CONTEXT_STATE.get(storeState.context) : null;
    if (!contextState) throw new Error('TRUSTED_AUTHORITY_CONTEXT_INVALID');
    this.compact();
    if (!isRecord(input)) throw new Error('TICKET_BINDING_INVALID');
    if (Object.keys(input).some((key) => TICKET_AUTHORITY_INPUT_FIELDS.has(key))) throw new Error('TICKET_ISSUER_INPUT_FORBIDDEN');
    const issuerAuthorityDigest = authorityEvidenceDigest(contextState.authority);
    if (!issuerAuthorityDigest) throw new Error('TICKET_ISSUER_INVALID');
    if (!nonBlank(input.session_id) || !nonBlank(input.turn_id) || !nonBlank(input.call_id) || !nonBlank(input.operation_type) || !validDigest(input.operation_digest) || !validDigest(input.target_digest)) throw new Error('TICKET_BINDING_INVALID');
    const scope = input.scope === undefined || input.scope === null ? null : input.scope;
    if (scope !== null && !nonBlank(scope)) throw new Error('TICKET_SCOPE_INVALID');
    const issuedAt = this._currentTime(); const expiresAt = parseUtc(input.expires_at); const maxUses = input.max_uses;
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > MAX_TICKET_USES || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > this._maxLifetimeMs) throw new Error('TICKET_EXPIRY_INVALID');
    if (this._records.size >= this._maxEntries) throw new Error('TICKET_STORE_FULL');
    const payload = { contract_version: TICKET_CONTRACT_VERSION, issuer_role: contextState.authority.role, issuer_identity_digest: digest(contextState.authority.identity), issuer_authority_digest: issuerAuthorityDigest, session_id: input.session_id, turn_id: input.turn_id, call_id: input.call_id, operation_type: input.operation_type, operation_digest: input.operation_digest, target_digest: input.target_digest, scope, issued_at: new Date(issuedAt).toISOString(), expires_at: input.expires_at, max_uses: maxUses, consumed_count: 0 };
    const frozen = deepFreeze({ ...payload, ticket_id: digest({ ...payload, sequence: this._sequence += 1 }) });
    TICKET_PROVENANCE.set(frozen, { context: storeState.context, store: this, ticket_id: frozen.ticket_id });
    this._records.set(frozen.ticket_id, { ticket: frozen, uses: 0 });
    return frozen;
  }

  consume(ticket, request) {
    const storeState = TICKET_STORE_STATE.get(this);
    if (!storeState || !isRecord(request)) return failure('TICKET_INVALID');
    const provenance = TICKET_PROVENANCE.get(ticket);
    if (!provenance) return failure('TICKET_INVALID');
    if (provenance.context !== storeState.context || provenance.store !== this) return failure('TICKET_AUTHORITY_CONTEXT_MISMATCH');
    this.compact();
    const record = this._records.get(provenance.ticket_id); if (!record) return failure('TICKET_REPLAY');
    const current = this._currentTime(); if (current >= parseUtc(record.ticket.expires_at)) { this._records.delete(record.ticket.ticket_id); return failure('TICKET_EXPIRED'); }
    const matches = ['issuer_role', 'issuer_identity_digest', 'issuer_authority_digest', 'session_id', 'turn_id', 'call_id', 'operation_type', 'operation_digest', 'target_digest', 'scope'].every((key) => request[key] === record.ticket[key]); if (!matches) return failure('TICKET_BINDING_MISMATCH');
    if (record.uses >= record.ticket.max_uses) { this._records.delete(record.ticket.ticket_id); return failure('TICKET_REPLAY'); }
    record.uses += 1;
    record.ticket = deepFreeze({ ...record.ticket, consumed_count: record.uses });
    TICKET_PROVENANCE.set(record.ticket, { context: storeState.context, store: this, ticket_id: record.ticket.ticket_id });
    const valid = deepFreeze({ valid: true, reason_code: 'TICKET_CONSUMED', consumed_count: record.uses, max_uses: record.ticket.max_uses });
    if (record.uses >= record.ticket.max_uses) this._records.delete(record.ticket.ticket_id);
    return valid;
  }

  compact() { const current = this._currentTime(); let removed = 0; for (const [id, record] of this._records) { if (current >= parseUtc(record.ticket.expires_at) || record.uses >= record.ticket.max_uses) { this._records.delete(id); removed += 1; } } return removed; }
  size() { this.compact(); return this._records.size; }
}

function createTrustedAuthorityContext(authority, options = {}) {
  const contract = normalizeTrustedAuthority(authority);
  if (!contract) throw new Error('TRUSTED_AUTHORITY_INVALID');
  const context = {};
  const state = { context, authority: contract, store: null };
  TRUSTED_CONTEXT_STATE.set(context, state);
  const store = new TicketStore(context, options);
  state.store = store;
  Object.defineProperties(context, {
    issue: { enumerable: false, value: (input) => store.issue(input) },
    compact: { enumerable: false, value: () => store.compact() },
    size: { enumerable: false, value: () => store.size() },
  });
  return Object.freeze(context);
}

function flattenClassifiedComponents(classification) {
  if (classification?.operation_type !== 'compound') return [classification];
  return classification.components.flatMap(flattenClassifiedComponents);
}

function ticketDecision(input, operation, classification, trustedState) {
  if (!classification.requires_ticket) return null;
  const components = flattenClassifiedComponents(classification);
  const requiresController = components.some((component) => component.operation_type === 'github.mutation');
  if (requiresController && !trustedState) return publicResult({ decision: 'deny', reason_code: 'CONTROLLER_TRUST_SOURCE_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  if (requiresController && trustedState.authority.role !== 'controller') return publicResult({ decision: 'deny', reason_code: 'CONTROLLER_GITHUB_AUTHORITY_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  if (components.some((component) => component.operation_type === 'network.request' && component.secret_classification !== 'none')) return publicResult({ decision: 'deny', reason_code: 'SECRET_EXFILTRATION_DENIED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'not-accepted' });
  if (!input.ticket) {
    const sensitiveRead = components.some((component) => component.secret_classification === 'confirmed' && ['filesystem.read', 'filesystem.create', 'filesystem.write', 'filesystem.move'].includes(component.operation_type));
    return publicResult({ decision: 'ask', reason_code: sensitiveRead ? 'SECRET_ACCESS_REQUIRES_TICKET' : classification.reason_code || 'AUTHORITY_TICKET_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'missing' });
  }
  if (!trustedState) return publicResult({ decision: 'deny', reason_code: 'TICKET_TRUST_SOURCE_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'not-accepted' });
  const provenance = TICKET_PROVENANCE.get(input.ticket);
  if (!provenance) return publicResult({ decision: 'deny', reason_code: 'TICKET_INVALID', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'rejected' });
  if (provenance.context !== trustedState.context || provenance.store !== trustedState.store) return publicResult({ decision: 'deny', reason_code: 'TICKET_AUTHORITY_CONTEXT_MISMATCH', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'rejected' });
  const consumed = trustedState.store.consume(input.ticket, ticketRequestFor(input, operation, trustedState.authority)); if (!consumed.valid) return publicResult({ decision: 'deny', reason_code: consumed.reason_code, operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'rejected' });
  return publicResult({ decision: 'allow', reason_code: consumed.reason_code, operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation), ticket_status: 'consumed' });
}
function evaluate(input, options = {}) {
  const normalizedInput = canonicalizeInput(input);
  if (!normalizedInput.valid) return baseFailure(normalizedInput.reason_code, { secret_classification: normalizedInput.secret_classification });
  const policyInput = normalizedInput.value;
  const operation = policyInput.operation;
  if (policyInput.enabled !== true || !isRecord(policyInput.activation) || policyInput.activation.mode !== 'explicit-local' || policyInput.activation.consented !== true) return baseFailure('CONTROL_PLANE_DEFAULT_OFF', policyInput);
  const trustedState = trustedStateFromOptions(options);
  const authorityError = authorityIdentityError(policyInput.authority); if (authorityError) return publicResult({ decision: authorityError === 'CALLER_FINALITY_REJECTED' ? 'deny' : 'unsupported', reason_code: authorityError, operation_digest: operation ? operationDigestFromProjection(operation) : null, target_digest: operation ? targetDigestFromProjection(operation) : null });
  if (parseUtc(policyInput.now) === null) return baseFailure('AUTHORITY_TIME_INVALID', policyInput);
  const repository = normalizeRepository(policyInput.repository); if (!repository.valid) return baseFailure(repository.reason_code, policyInput);
  const classification = classifyOperation(operation, repository);
  if (!classification.valid) {
    if (classification.hard_deny) return publicResult({ ...classification.hard_deny, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
    return baseFailure(classification.reason_code, { operation, secret_classification: classification.secret_classification });
  }
  const components = flattenClassifiedComponents(classification);
  const hardDeny = hardDenyForClassifiedComponents(components, repository, classification.operation_type);
  if (hardDeny) return publicResult({ ...hardDeny, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  const hasGithubMutation = components.some((component) => component.operation_type === 'github.mutation');
  if (hasGithubMutation && !trustedState) return publicResult({ decision: 'deny', reason_code: 'CONTROLLER_TRUST_SOURCE_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  if (hasGithubMutation && trustedState.authority.role !== 'controller') return publicResult({ decision: 'deny', reason_code: 'CONTROLLER_GITHUB_AUTHORITY_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  const policyAuthority = trustedState ? trustedState.authority : policyInput.authority;
  if (classification.operation_type === 'compound') { const allowed = new Set(policyAuthority.allowed_operation_types); if (components.some((component) => !allowed.has(component.operation_type))) return publicResult({ decision: 'deny', reason_code: 'COMPONENT_AUTHORITY_REQUIRED', operation_type: 'compound', operation_class: 'compound', target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) }); }
  else if (!policyAuthority.allowed_operation_types.includes(classification.operation_type)) return publicResult({ decision: 'deny', reason_code: 'OPERATION_AUTHORITY_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  const targetAuthorityRequired = components.some((component) => component.operation_type.startsWith('filesystem.') && ['outside-repository', 'unresolved-target', 'unknown-target', 'external-system'].includes(component.target_class));
  if (targetAuthorityRequired) return publicResult({ decision: 'ask', reason_code: 'TARGET_AUTHORITY_REQUIRED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
  const sensitiveRead = components.some((component) => component.secret_classification === 'confirmed' && ['filesystem.read', 'filesystem.create', 'filesystem.write', 'filesystem.move'].includes(component.operation_type));
  if (sensitiveRead) return ticketDecision(policyInput, operation, { ...classification, requires_ticket: true }, trustedState);
  if (classification.requires_ticket) return ticketDecision(policyInput, operation, classification, trustedState);
  return publicResult({ decision: 'allow', reason_code: 'TYPED_OPERATION_ALLOWED', operation_type: classification.operation_type, operation_class: classification.operation_class, target_class: classification.target_class, secret_classification: classification.secret_classification, operation_digest: operationDigestFromProjection(operation), target_digest: targetDigestFromProjection(operation) });
}
function assessStructuralImpact(change) {
  const structuralKinds = new Set(['rename', 'remove', 'move', 'resignature', 're-signature', 'contract-shape', 'contract', 'public-contract', 'internal-contract', 'generated-surface', 'generated-shape', 'path', 'symbol', 'command', 'schema-field', 'repository-identity', 'identity', 'structural-replace', 'replace']);
  const localKinds = new Set(['value-change']);
  const consumerCategories = ['source-shape-tests', 'fixtures-and-snapshots', 'generated-surface-assertions', 'docs-config-contracts', 'imports-registrations', 'scripts-manifests-adapters'];
  const compatibilityRule = { issue: 342, status: 'active-until-propagation-verification', permanent_mechanism: 'deterministic-structural-impact-v1' };
  if (!isRecord(change) || !nonBlank(change.kind) || !nonBlank(change.identity)) return deepFreeze({ valid: false, decision: 'unsupported', reason_code: 'STRUCTURAL_IMPACT_INPUT_INVALID', compatibility_rule: compatibilityRule });
  if (Object.keys(change).some((key) => !['kind', 'identity'].includes(key))) return deepFreeze({ valid: false, decision: 'unsupported', reason_code: 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED', existing_identity_digest: digest(change.identity), compatibility_rule: compatibilityRule });
  if (!structuralKinds.has(change.kind) && !localKinds.has(change.kind)) return deepFreeze({ valid: false, decision: 'unsupported', reason_code: 'STRUCTURAL_IMPACT_KIND_UNSUPPORTED', existing_identity_digest: digest(change.identity), compatibility_rule: compatibilityRule });
  const required = structuralKinds.has(change.kind);
  return deepFreeze({ valid: true, required, search_scope: required ? 'targeted-repo-wide' : 'local', existing_identity_digest: digest(change.identity), consumer_categories: required ? consumerCategories : [], compatibility_rule: compatibilityRule });
}

const publicApi = { CONTRACT_VERSION, REMOTE_IDENTITY_CONTRACT_VERSION, TICKET_CONTRACT_VERSION, MAX_TICKET_USES, POLICY, validateRemoteIdentity, formatRemoteIdentity, operationDigest, targetDigest, evaluate, assessStructuralImpact, isFilesystemRoot, isUncShareRoot };
module.exports = publicApi;
