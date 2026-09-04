'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const fixturePath = path.resolve(__dirname, '../scripts/github-program-broker/tests/fixtures/source-slice-1-vectors.json');
const vectors = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const BROKER_ROOT = path.resolve(__dirname, '../scripts/github-program-broker');
const PROTOCOL_ID = 'toolkit.github-program.broker-ipc.v1';
const LOCK_ID = 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-005';
const NAMESPACE = Object.freeze({ repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359 });
const MAX_SAFE_INTEGER = 9007199254740991;
const MAX_FRAME_PAYLOAD_BYTES = 65536;
const MAX_NESTING_DEPTH = 16;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_BYTES = 4096;

function cargoExecutable() {
  if (process.env.CARGO) return process.env.CARGO;
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const candidate = path.join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'cargo';
}

function brokerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw brokerError('BROKER_INVALID_FIELD');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${canonicalSerialize(key)}:${canonicalSerialize(value[key])}`).join(',')}}`;
  }
  throw brokerError('BROKER_INVALID_FIELD');
}

function digestValue(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function strictParse(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw brokerError('BROKER_MALFORMED_REQUEST');
  }
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length;) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (character === '-' || /[0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (index < raw.length && !',]} \t\r\n'.includes(raw[index])) index += 1;
      const token = raw.slice(start, index);
      if (/[.eE]/.test(token)) throw brokerError('BROKER_INVALID_FIELD');
      const digits = token.startsWith('-') ? token.slice(1) : token;
      if (/^[0-9]+$/.test(digits) && BigInt(digits) > BigInt(MAX_SAFE_INTEGER)) {
        throw brokerError('BROKER_INVALID_FIELD');
      }
      continue;
    }
    index += 1;
  }
  return value;
}

function exactKeys(value, keys) {
  return value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 160
    && !value.startsWith('-')
    && !value.includes('..')
    && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function validateLimits(value, depth = 1) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) throw brokerError('BROKER_LIMIT_VIOLATION');
    return;
  }
  if (Array.isArray(value)) {
    if (depth > MAX_NESTING_DEPTH) throw brokerError('BROKER_LIMIT_VIOLATION');
    if (value.length > MAX_ARRAY_ITEMS) throw brokerError('BROKER_LIMIT_VIOLATION');
    value.forEach((item) => validateLimits(item, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    if (depth > MAX_NESTING_DEPTH) throw brokerError('BROKER_LIMIT_VIOLATION');
    const keys = Object.keys(value);
    if (keys.length > MAX_OBJECT_KEYS) throw brokerError('BROKER_LIMIT_VIOLATION');
    keys.forEach((key) => {
      if (Buffer.byteLength(key, 'utf8') > MAX_STRING_BYTES) throw brokerError('BROKER_LIMIT_VIOLATION');
      validateLimits(value[key], depth + 1);
    });
  }
}

function validateOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) || typeof operation.kind !== 'string') {
    throw brokerError('BROKER_INVALID_FIELD');
  }
  const digest = (value) => {
    if (!isDigest(value)) throw brokerError('BROKER_INVALID_FIELD');
  };
  switch (operation.kind) {
    case 'READBACK_INSPECTION':
      if (!exactKeys(operation, ['kind', 'target']) || !['NAMESPACE', 'RUN', 'RECEIPT_CHAIN', 'MUTATION', 'RECOVERY'].includes(operation.target)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'ALLOCATE_RUN':
      if (!exactKeys(operation, ['kind', 'authority', 'start', 'candidate', 'lease_ms'])
        || !Number.isSafeInteger(operation.lease_ms) || operation.lease_ms < 1000 || operation.lease_ms > 86400000
        || !exactKeys(operation.authority, ['child_comment_id', 'parent_comment_id', 'node_id', 'author_login', 'author_association', 'body_digest', 'updated_at', 'update_identity_digest', 'scope_digest'])
        || operation.authority.author_association !== 'OWNER'
        || !isDigest(operation.authority.body_digest) || !isDigest(operation.authority.update_identity_digest) || !isDigest(operation.authority.scope_digest)
        || !exactKeys(operation.start, ['base_sha', 'head_sha', 'tree_sha', 'status_digest', 'clean_worktree', 'ref'])
        || !isSha(operation.start.base_sha) || !isSha(operation.start.head_sha) || !isSha(operation.start.tree_sha)
        || !isDigest(operation.start.status_digest) || operation.start.clean_worktree !== true
        || !exactKeys(operation.start.ref, ['detached', 'name']) || operation.start.ref.detached !== false
        || typeof operation.start.ref.name !== 'string' || operation.candidate !== null) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'START_RUN':
      if (!exactKeys(operation, ['kind', 'allocation_id']) || !isIdentifier(operation.allocation_id)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'APPEND_RECEIPT':
      if (!exactKeys(operation, ['kind', 'receipt']) || !operation.receipt
        || !exactKeys(operation.receipt, ['receipt_type', 'candidate', 'payload', 'created_at'])
        || !['TRANSITION_PREVIEW', 'EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED'].includes(operation.receipt.receipt_type)
        || operation.receipt.candidate !== null || !operation.receipt.payload
        || typeof operation.receipt.payload.classification !== 'string'
        || !isTimestamp(operation.receipt.created_at)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'INTERRUPT_RUN':
      if (!exactKeys(operation, ['kind', 'reason']) || !['REQUESTED', 'BROKER_RECOVERY', 'SHUTDOWN'].includes(operation.reason)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'MUTATION_ADMIT': {
      const descriptor = operation.descriptor;
      if (!exactKeys(operation, ['descriptor', 'kind']) || !exactKeys(descriptor, ['adapter_identity_digest', 'cas_digest', 'expected_post_state_digest', 'expected_source_digest', 'operation_kind', 'retry_of_operation_id', 'safety_class', 'target_digest', 'target_identity'])
        || !exactKeys(descriptor.target_identity, ['resource_type', 'resource_id'])) throw brokerError('BROKER_INVALID_FIELD');
      if (!['GIT_REF_UPDATE', 'CONDITIONAL_PROVIDER_UPDATE', 'IDEMPOTENT_SET', 'APPEND_CREATE'].includes(descriptor.operation_kind)) throw brokerError('BROKER_INVALID_FIELD');
      if (!['CAS', 'IDEMPOTENT', 'APPEND_IDEMPOTENT'].includes(descriptor.safety_class)) throw brokerError('BROKER_INVALID_FIELD');
      ['target_digest', 'expected_source_digest', 'cas_digest', 'adapter_identity_digest'].forEach((key) => digest(descriptor[key]));
      if (descriptor.expected_post_state_digest !== null) digest(descriptor.expected_post_state_digest);
      if (descriptor.retry_of_operation_id !== null && !isIdentifier(descriptor.retry_of_operation_id)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    }
    case 'MUTATION_DISPATCH':
    case 'MUTATION_RECONCILE':
      if (!exactKeys(operation, ['kind', 'operation_id']) || !isIdentifier(operation.operation_id)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'MUTATION_OUTCOME':
      if (!exactKeys(operation, ['kind', 'operation_id', 'evidence']) || !isIdentifier(operation.operation_id)
        || !operation.evidence
        || !exactKeys(operation.evidence, ['operation_id', 'logical_operation_digest', 'adapter_identity_digest', 'target_identity', 'target_digest', 'provider_operation_key', 'cas_digest', 'classification', 'observed_post_state_digest', 'rejection_digest', 'delayed_completion_excluded', 'evidence_at', 'evidence_digest'])
        || operation.evidence.operation_id !== operation.operation_id
        || !['APPLIED', 'NOT_APPLIED', 'UNKNOWN'].includes(operation.evidence.classification)
        || !isTimestamp(operation.evidence.evidence_at)) throw brokerError('BROKER_INVALID_FIELD');
      return;
    case 'ORPHAN_RECOVERY':
      if (!exactKeys(operation, ['evidence_digest', 'kind', 'old_run_digest'])) throw brokerError('BROKER_INVALID_FIELD');
      digest(operation.old_run_digest);
      digest(operation.evidence_digest);
      return;
    case 'MIGRATE_V2_TO_V3':
      if (!exactKeys(operation, ['kind', 'source_schema_fingerprint'])) throw brokerError('BROKER_INVALID_FIELD');
      digest(operation.source_schema_fingerprint);
      return;
    default:
      throw brokerError('BROKER_UNSUPPORTED_OPERATION');
  }
}

function validateRequest(value) {
  validateLimits(value);
  if (!exactKeys(value, ['expected', 'lock', 'namespace', 'operation', 'request_id', 'schema'])) throw brokerError('BROKER_INVALID_FIELD');
  if (value.schema !== PROTOCOL_ID) throw brokerError('BROKER_UNSUPPORTED_SCHEMA');
  if (typeof value.request_id !== 'string' || !/^[a-f0-9]{32}$/.test(value.request_id)) throw brokerError('BROKER_INVALID_FIELD');
  if (!exactKeys(value.namespace, ['child_issue', 'parent_issue', 'repository'])
    || value.namespace.repository !== NAMESPACE.repository
    || value.namespace.parent_issue !== NAMESPACE.parent_issue
    || value.namespace.child_issue !== NAMESPACE.child_issue) throw brokerError('BROKER_INVALID_FIELD');
  if (value.lock !== LOCK_ID) throw brokerError('BROKER_INVALID_FIELD');
  if (!exactKeys(value.expected, ['state_digest']) || (value.expected.state_digest !== null && !isDigest(value.expected.state_digest))) throw brokerError('BROKER_INVALID_FIELD');
  validateOperation(value.operation);
  return value;
}

function encodeFrame(payload) {
  if (payload.length > MAX_FRAME_PAYLOAD_BYTES) throw brokerError('BROKER_LIMIT_VIOLATION');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeFrame(frame) {
  if (frame.length < 4) throw brokerError('BROKER_MALFORMED_FRAME');
  const length = frame.readUInt32BE(0);
  if (length > MAX_FRAME_PAYLOAD_BYTES) throw brokerError('BROKER_LIMIT_VIOLATION');
  if (frame.length !== length + 4) throw brokerError('BROKER_MALFORMED_FRAME');
  const payload = frame.subarray(4);
  const decoded = payload.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(payload)) throw brokerError('BROKER_MALFORMED_REQUEST');
  return payload;
}

function expectedError(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function operationCases() {
  const digest = 'a'.repeat(64);
  const authority = {
    child_comment_id: 359,
    parent_comment_id: 240,
    node_id: 'node-id',
    author_login: 'owner',
    author_association: 'OWNER',
    body_digest: digest,
    updated_at: '2026-09-04T12:00:00.000Z',
    update_identity_digest: digest,
    scope_digest: digest
  };
  const start = {
    base_sha: '0'.repeat(40),
    head_sha: '1'.repeat(40),
    tree_sha: '2'.repeat(40),
    status_digest: digest,
    clean_worktree: true,
    ref: { detached: false, name: 'refs/heads/main' }
  };
  const targetIdentity = { resource_type: 'git_ref', resource_id: 'refs/heads/main' };
  return [
    { kind: 'READBACK_INSPECTION', target: 'NAMESPACE' },
    { kind: 'ALLOCATE_RUN', authority, start, candidate: null, lease_ms: 1000 },
    { kind: 'START_RUN', allocation_id: 'allocation-test' },
    {
      kind: 'APPEND_RECEIPT',
      receipt: {
        receipt_type: 'TRANSITION_PREVIEW',
        candidate: null,
        payload: { classification: 'TRANSITION_PREVIEW' },
        created_at: '2026-09-04T12:00:00.000Z'
      }
    },
    { kind: 'INTERRUPT_RUN', reason: 'REQUESTED' },
    {
      kind: 'MUTATION_ADMIT',
      descriptor: {
        operation_kind: 'GIT_REF_UPDATE',
        safety_class: 'CAS',
        target_identity: targetIdentity,
        target_digest: digest,
        expected_source_digest: digest,
        cas_digest: digest,
        expected_post_state_digest: digest,
        adapter_identity_digest: digest,
        retry_of_operation_id: null
      }
    },
    { kind: 'MUTATION_DISPATCH', operation_id: 'operation-test' },
    {
      kind: 'MUTATION_OUTCOME',
      operation_id: 'operation-test',
      evidence: {
        operation_id: 'operation-test',
        logical_operation_digest: digest,
        adapter_identity_digest: digest,
        target_identity: targetIdentity,
        target_digest: digest,
        provider_operation_key: 'gpr:operation-test',
        cas_digest: digest,
        classification: 'APPLIED',
        observed_post_state_digest: digest,
        rejection_digest: null,
        delayed_completion_excluded: false,
        evidence_at: '2026-09-04T12:00:00.000Z',
        evidence_digest: digest
      }
    },
    { kind: 'MUTATION_RECONCILE', operation_id: 'operation-test' },
    { kind: 'ORPHAN_RECOVERY', old_run_digest: digest, evidence_digest: digest },
    { kind: 'MIGRATE_V2_TO_V3', source_schema_fingerprint: digest }
  ];
}

test('canonical JSON, SHA-256, Unicode, safe integers, and fixed bytes agree with independent goldens', () => {
  for (const item of vectors.canonical_cases) {
    assert.equal(canonicalSerialize(item.value), item.serialized, item.name);
    assert.equal(digestValue(item.value), item.digest, item.name);
  }
  assert.equal(canonicalSerialize(-0), '0');
  expectedError(() => canonicalSerialize(1.5), 'BROKER_INVALID_FIELD');
  for (const item of vectors.invalid_json) expectedError(() => strictParse(item.raw), item.code);
});

test('holder HMAC tag and attestation digest use the exact locked exclusion sets', () => {
  const holder = vectors.holder.value;
  const tagPayload = Object.fromEntries(Object.entries(holder).filter(([key]) => key !== 'attestation_digest' && key !== 'attestation_tag'));
  const tagPayloadSerialized = canonicalSerialize(tagPayload);
  assert.equal(tagPayloadSerialized, vectors.holder.tag_payload_serialized);
  const tag = crypto.createHmac('sha256', Buffer.from(vectors.holder.key_hex, 'hex'))
    .update(Buffer.from('toolkit.github-program.holder-attestation-tag.v1\0', 'utf8'))
    .update(tagPayloadSerialized, 'utf8')
    .digest('hex');
  assert.equal(tag, vectors.holder.tag);
  const digestPayload = Object.fromEntries(Object.entries(holder).filter(([key]) => key !== 'attestation_digest'));
  assert.equal(canonicalSerialize(digestPayload), vectors.holder.attestation_digest_payload_serialized);
  assert.equal(digestValue(digestPayload), vectors.holder.attestation_digest);
});

test('typed v1 envelope, operations, request ID, and frame boundaries are closed', () => {
  const request = JSON.parse(vectors.request.serialized);
  assert.deepEqual(validateRequest(request), request);
  assert.equal(canonicalSerialize(request), vectors.request.serialized);
  assert.equal(digestValue(request), vectors.request.digest);
  const payload = Buffer.from(vectors.request.serialized, 'utf8');
  assert.equal(payload.length, vectors.request.payload_length);
  const frame = encodeFrame(payload);
  assert.equal(frame.subarray(0, 4).toString('hex'), vectors.request.frame_prefix_hex);
  assert.deepEqual(decodeFrame(frame), payload);
  assert.equal(encodeFrame(Buffer.alloc(MAX_FRAME_PAYLOAD_BYTES)).subarray(0, 4).toString('hex'), '00010000');
  expectedError(() => encodeFrame(Buffer.alloc(MAX_FRAME_PAYLOAD_BYTES + 1)), 'BROKER_LIMIT_VIOLATION');
  expectedError(() => decodeFrame(Buffer.from([0, 0, 0])), 'BROKER_MALFORMED_FRAME');
  expectedError(() => decodeFrame(Buffer.from([0, 0, 0, 5, 0])), 'BROKER_MALFORMED_FRAME');
  expectedError(() => decodeFrame(Buffer.concat([frame, Buffer.from([0])])), 'BROKER_MALFORMED_FRAME');
  expectedError(() => decodeFrame(Buffer.from([0, 0, 0, 1, 0xff])), 'BROKER_MALFORMED_REQUEST');
  expectedError(() => decodeFrame(Buffer.from([0, 1, 0, 1])), 'BROKER_LIMIT_VIOLATION');

  for (const operation of operationCases()) validateRequest({ ...request, operation });
  expectedError(() => validateRequest({ ...request, schema: 'toolkit.github-program.broker-ipc.v2' }), 'BROKER_UNSUPPORTED_SCHEMA');
  expectedError(() => validateRequest({ ...request, operation: { kind: 'SQL_RPC' } }), 'BROKER_UNSUPPORTED_OPERATION');
  expectedError(() => validateRequest({ ...request, database_path: 'C:/private.sqlite' }), 'BROKER_INVALID_FIELD');
  expectedError(() => validateRequest({ ...request, request_id: 'ABC' }), 'BROKER_INVALID_FIELD');
  expectedError(() => validateRequest({ ...request, namespace: { ...request.namespace, child_issue: 360 } }), 'BROKER_INVALID_FIELD');
  expectedError(() => validateRequest({ ...request, operation: { ...request.operation, fence_sequence: 7 } }), 'BROKER_INVALID_FIELD');
  expectedError(() => validateRequest({ ...request, operation: { ...request.operation, hmac_key: '00' } }), 'BROKER_INVALID_FIELD');

  const requestId = crypto.randomBytes(16).toString('hex');
  assert.match(requestId, /^[a-f0-9]{32}$/);
  assert.equal(requestId.length, 32);
});

test('identity constructors have fixed domain-separated and lossless decimal vectors', () => {
  for (const item of vectors.identities) {
    assert.equal(canonicalSerialize(item.value), item.serialized, item.name);
    assert.equal(digestValue(item.value), item.digest, item.name);
  }
  assert.notEqual(vectors.identities.find((item) => item.name === 'store-binding').digest, vectors.identities.find((item) => item.name === 'path-binding').digest);
});

test('protocol limits classify nesting, container, and UTF-8 string overflow', () => {
  validateLimits(JSON.parse(`[${'['.repeat(MAX_NESTING_DEPTH - 1)}0${']'.repeat(MAX_NESTING_DEPTH - 1)}]`));
  expectedError(() => validateLimits(JSON.parse(`[${'['.repeat(MAX_NESTING_DEPTH)}0${']'.repeat(MAX_NESTING_DEPTH)}]`)), 'BROKER_LIMIT_VIOLATION');
  expectedError(() => validateLimits(new Array(MAX_ARRAY_ITEMS + 1).fill(0)), 'BROKER_LIMIT_VIOLATION');
  expectedError(() => validateLimits(Object.fromEntries(new Array(MAX_OBJECT_KEYS + 1).fill(0).map((_, index) => [`k${index}`, 0]))), 'BROKER_LIMIT_VIOLATION');
  expectedError(() => validateLimits('x'.repeat(MAX_STRING_BYTES + 1)), 'BROKER_LIMIT_VIOLATION');
  expectedError(() => validateLimits('😀'.repeat(2049)), 'BROKER_LIMIT_VIOLATION');
});

test('Rust focused contract suite consumes the same fixed vectors when Cargo is available', (context) => {
  const result = spawnSync(cargoExecutable(), ['test', '--manifest-path', path.join(BROKER_ROOT, 'Cargo.toml'), '--locked', '--test', 'contracts'], {
    cwd: BROKER_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CARGO_TERM_COLOR: 'never' }
  });
  if (result.error && result.error.code === 'ENOENT') {
    context.skip('Cargo/Rust is not installed in this environment');
    return;
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
