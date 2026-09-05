'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const fixturePath = path.resolve(__dirname, '../scripts/github-program-broker/tests/fixtures/source-slice-1-vectors.json');
const brokerRoot = path.resolve(__dirname, '../scripts/github-program-broker');
const vectors = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const MAX_FRAME_PAYLOAD_BYTES = 65_536;
const MAX_NESTING_DEPTH = 16;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_BYTES = 4_096;

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('BROKER_INVALID_FIELD');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${canonicalSerialize(key)}:${canonicalSerialize(value[key])}`).join(',')}}`;
  }
  throw new Error('BROKER_INVALID_FIELD');
}

function digestValue(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function skipWhitespace(raw, state) {
  while (/\s/.test(raw[state.index] || '')) state.index += 1;
}

function scanString(raw, state) {
  if (raw[state.index] !== '"') throw new Error('BROKER_MALFORMED_REQUEST');
  const start = state.index;
  state.index += 1;
  while (state.index < raw.length) {
    const character = raw[state.index];
    if (character === '\\') {
      state.index += 2;
      if (raw[state.index - 1] === 'u') state.index += 4;
      continue;
    }
    state.index += 1;
    if (character === '"') return { start, end: state.index };
  }
  throw new Error('BROKER_MALFORMED_REQUEST');
}

function scanValue(raw, state) {
  skipWhitespace(raw, state);
  if (raw[state.index] === '"') {
    scanString(raw, state);
    return;
  }
  if (raw[state.index] === '[') {
    state.index += 1;
    skipWhitespace(raw, state);
    if (raw[state.index] === ']') {
      state.index += 1;
      return;
    }
    while (true) {
      scanValue(raw, state);
      skipWhitespace(raw, state);
      if (raw[state.index] === ']') {
        state.index += 1;
        return;
      }
      if (raw[state.index] !== ',') throw new Error('BROKER_MALFORMED_REQUEST');
      state.index += 1;
    }
  }
  if (raw[state.index] === '{') {
    state.index += 1;
    const keys = new Set();
    skipWhitespace(raw, state);
    if (raw[state.index] === '}') {
      state.index += 1;
      return;
    }
    while (true) {
      const keyRange = scanString(raw, state);
      const key = JSON.parse(raw.slice(keyRange.start, keyRange.end));
      if (keys.has(key)) throw new Error('BROKER_INVALID_FIELD');
      keys.add(key);
      skipWhitespace(raw, state);
      if (raw[state.index] !== ':') throw new Error('BROKER_MALFORMED_REQUEST');
      state.index += 1;
      scanValue(raw, state);
      skipWhitespace(raw, state);
      if (raw[state.index] === '}') {
        state.index += 1;
        return;
      }
      if (raw[state.index] !== ',') throw new Error('BROKER_MALFORMED_REQUEST');
      state.index += 1;
      skipWhitespace(raw, state);
    }
  }
  const start = state.index;
  while (state.index < raw.length && !',]} \t\r\n'.includes(raw[state.index])) state.index += 1;
  if (state.index === start) throw new Error('BROKER_MALFORMED_REQUEST');
}

function strictParse(raw) {
  const state = { index: 0 };
  scanValue(raw, state);
  skipWhitespace(raw, state);
  if (state.index !== raw.length) throw new Error('BROKER_MALFORMED_REQUEST');
  const value = JSON.parse(raw);
  if (canonicalSerialize(value) !== raw) throw new Error('BROKER_MALFORMED_REQUEST');
  return value;
}

function validateLimits(value, depth = 1) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) throw new Error('BROKER_LIMIT_VIOLATION');
    return;
  }
  if (Array.isArray(value)) {
    if (depth > MAX_NESTING_DEPTH || value.length > MAX_ARRAY_ITEMS) throw new Error('BROKER_LIMIT_VIOLATION');
    value.forEach((item) => validateLimits(item, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    if (depth > MAX_NESTING_DEPTH || Object.keys(value).length > MAX_OBJECT_KEYS) throw new Error('BROKER_LIMIT_VIOLATION');
    for (const [key, child] of Object.entries(value)) {
      if (Buffer.byteLength(key, 'utf8') > MAX_STRING_BYTES) throw new Error('BROKER_LIMIT_VIOLATION');
      validateLimits(child, depth + 1);
    }
  }
}

function encodeFrame(payload) {
  if (payload.length > MAX_FRAME_PAYLOAD_BYTES) throw new Error('BROKER_LIMIT_VIOLATION');
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeFrame(frame) {
  if (frame.length < 4) throw new Error('BROKER_MALFORMED_FRAME');
  const length = frame.readUInt32BE(0);
  if (length > MAX_FRAME_PAYLOAD_BYTES) throw new Error('BROKER_LIMIT_VIOLATION');
  if (frame.length !== length + 4) throw new Error('BROKER_MALFORMED_FRAME');
  const payload = frame.subarray(4);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) throw new Error('BROKER_MALFORMED_REQUEST');
  return payload;
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error && error.message === code);
}

test('independent Node canonical serializer and digest match fixed Rust vectors', () => {
  for (const item of vectors.canonical_cases) {
    assert.equal(canonicalSerialize(item.value), item.serialized, item.name);
    assert.equal(digestValue(item.value), item.digest, item.name);
  }
  assert.equal(canonicalSerialize(-0), '0');
  assert.throws(() => canonicalSerialize(1.5), /BROKER_INVALID_FIELD/);

  for (const item of vectors.surrogate_cases) {
    const raw = strictParse(item.raw);
    const serialized = canonicalSerialize(raw);
    assert.equal(Buffer.from(serialized, 'utf8').toString('hex'), item.serialized_hex, item.name);
    assert.equal(digestValue(raw), item.digest, item.name);
  }
});

test('holder HMAC and attestation digest use the locked exclusion sets', () => {
  const holder = vectors.holder.value;
  const tagPayload = Object.fromEntries(Object.entries(holder)
    .filter(([key]) => key !== 'attestation_digest' && key !== 'attestation_tag'));
  const tag = crypto.createHmac(
    'sha256',
    Buffer.from(vectors.holder.key_hex, 'hex')
  )
    .update(Buffer.from('toolkit.github-program.holder-attestation-tag.v1\0', 'utf8'))
    .update(canonicalSerialize(tagPayload), 'utf8')
    .digest('hex');
  assert.equal(tag, vectors.holder.tag);
  const digestPayload = Object.fromEntries(Object.entries(holder)
    .filter(([key]) => key !== 'attestation_digest'));
  assert.equal(digestValue(digestPayload), vectors.holder.attestation_digest);
});

test('raw-wire parsing rejects duplicate keys, noncanonical bytes, and protocol limits', () => {
  expectCode(() => strictParse('{"value":1,"value":2}'), 'BROKER_INVALID_FIELD');
  expectCode(() => strictParse(` ${vectors.request.serialized}`), 'BROKER_MALFORMED_REQUEST');
  expectCode(() => strictParse('{"value":1.0}'), 'BROKER_MALFORMED_REQUEST');
  expectCode(() => strictParse('{"value":9007199254740992}'), 'BROKER_INVALID_FIELD');

  validateLimits(JSON.parse(`[${'['.repeat(MAX_NESTING_DEPTH - 1)}0${']'.repeat(MAX_NESTING_DEPTH - 1)}]`));
  expectCode(
    () => validateLimits(JSON.parse(`[${'['.repeat(MAX_NESTING_DEPTH)}0${']'.repeat(MAX_NESTING_DEPTH)}]`)),
    'BROKER_LIMIT_VIOLATION'
  );
  expectCode(() => validateLimits(new Array(MAX_ARRAY_ITEMS + 1).fill(0)), 'BROKER_LIMIT_VIOLATION');
  expectCode(
    () => validateLimits(Object.fromEntries(new Array(MAX_OBJECT_KEYS + 1).fill(0).map((_, index) => [`k${index}`, 0]))),
    'BROKER_LIMIT_VIOLATION'
  );
  expectCode(() => validateLimits('x'.repeat(MAX_STRING_BYTES + 1)), 'BROKER_LIMIT_VIOLATION');
  expectCode(() => validateLimits('😀'.repeat(2049)), 'BROKER_LIMIT_VIOLATION');
});

test('length-prefixed frames reject truncation, trailing bytes, invalid UTF-8, and overflow', () => {
  const payload = Buffer.from(vectors.request.serialized, 'utf8');
  const frame = encodeFrame(payload);
  assert.equal(frame.subarray(0, 4).toString('hex'), vectors.request.frame_prefix_hex);
  assert.deepEqual(decodeFrame(frame), payload);
  assert.equal(encodeFrame(Buffer.alloc(MAX_FRAME_PAYLOAD_BYTES)).readUInt32BE(0), MAX_FRAME_PAYLOAD_BYTES);
  expectCode(() => encodeFrame(Buffer.alloc(MAX_FRAME_PAYLOAD_BYTES + 1)), 'BROKER_LIMIT_VIOLATION');
  expectCode(() => decodeFrame(Buffer.from([0, 0, 0])), 'BROKER_MALFORMED_FRAME');
  expectCode(() => decodeFrame(Buffer.from([0, 0, 0, 5, 0])), 'BROKER_MALFORMED_FRAME');
  expectCode(() => decodeFrame(Buffer.concat([frame, Buffer.from([0])])), 'BROKER_MALFORMED_FRAME');
  expectCode(() => decodeFrame(Buffer.from([0, 0, 0, 1, 0xff])), 'BROKER_MALFORMED_REQUEST');
  expectCode(() => decodeFrame(Buffer.from([0, 1, 0, 1])), 'BROKER_LIMIT_VIOLATION');
});

test('success result digest binds both operation and typed value', () => {
  const value = {
    kind: 'READBACK_INSPECTION',
    readback: {
      kind: 'NAMESPACE',
      namespace: { repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359 },
      namespace_digest: 'a'.repeat(64)
    }
  };
  const result = { operation: 'READBACK_INSPECTION', value };
  const response = {
    schema: 'toolkit.github-program.broker-ipc.v1',
    request_id: '0123456789abcdef0123456789abcdef',
    ok: true,
    result: { ...result, result_digest: digestValue(result) },
    error: null
  };
  assert.equal(response.result.result_digest, digestValue({ operation: response.result.operation, value: response.result.value }));
  assert.notEqual(response.result.result_digest, digestValue({ operation: 'ALLOCATE_RUN', value }));
});

test('Rust focused contract proof consumes the same fixed vectors', () => {
  const cargo = process.platform === 'win32' && process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe')
    : 'cargo';
  const result = spawnSync(cargo, ['test', '--manifest-path', path.join(brokerRoot, 'Cargo.toml'), '--locked', '--test', 'contracts'], {
    cwd: brokerRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CARGO_TERM_COLOR: 'never' }
  });
  if (result.error && result.error.code === 'ENOENT') {
    assert.fail('Cargo is required for the broker contract proof');
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
