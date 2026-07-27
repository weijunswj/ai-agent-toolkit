#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const JOURNAL_SCHEMA = 2;
const JOURNAL_HEADER_BYTES = 256;
const JOURNAL_TRAILER_BYTES = 96;
const JOURNAL_MAX_PAYLOAD_BYTES = 512 * 1024;
const JOURNAL_MAX_RECORD_BYTES = JOURNAL_HEADER_BYTES + JOURNAL_MAX_PAYLOAD_BYTES + JOURNAL_TRAILER_BYTES;
const JOURNAL_MAX_RESCUE_ATTEMPTS = 8;
const JOURNAL_MAX_ACTIVE_SEGMENTS = 128;
const JOURNAL_MAX_ACTIVE_BYTES = 64 * 1024 * 1024;
const JOURNAL_MAX_TARGET_ENTRIES = 2200;
const JOURNAL_MAX_TARGET_BYTES = 1024 * 1024 * 1024;
const JOURNAL_SOFT_RESIDUE_ENTRIES = 512;
const JOURNAL_SOFT_RESIDUE_BYTES = 512 * 1024 * 1024;
const JOURNAL_HARD_RESIDUE_ENTRIES = 2048;
const JOURNAL_HARD_RESIDUE_BYTES = 1024 * 1024 * 1024;
const JOURNAL_MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;
const JOURNAL_MAX_TERMINAL_BYTES = 4 * 1024 * 1024;
const JOURNAL_MAX_TERMINAL_ENTRIES = 16;
const JOURNAL_SUPPORTED_NODE_MAJORS = Object.freeze([22, 24]);
const JOURNAL_MAGIC = Buffer.from('4149544b2d4e384e2d4a534547320000', 'hex');
const JOURNAL_COMMIT_MAGIC = Buffer.from('4149544b2d4e384e2d434d5432000000', 'hex');
const ZERO_DIGEST = '0'.repeat(64);
const SEGMENT_PATTERN = /^r-([0-9]{16})-a([0-8])\.jseg$/;
const CHECKPOINT_PATTERN = /^checkpoint-([ab])-([0-9]{16})\.jseg$/;
const RETIRED_CHECKPOINT_PATTERN = /^retired-(checkpoint-[ab]-[0-9]{16}\.jseg)-by-([0-9a-f]{64})\.jseg$/;

const RECORD_KINDS = Object.freeze({
  M00_V1_MIGRATION: 1,
  P00_PREPARED: 10,
  P10_COPIED: 11,
  P15_TRANSFORMING: 12,
  P20_TRANSFORMED: 13,
  T00_REGISTERED: 20,
  T10_DISPLACE_INTENT: 21,
  T20_DISPLACED: 22,
  T30_INSTALL_INTENT: 23,
  T40_INSTALLED: 24,
  T50_VERIFY_INTENT: 25,
  T60_VERIFIED: 26,
  T70_CLEANUP_AUTHORIZED: 27,
  B80_BUSINESS_COMMITTED: 30,
  L10_RETIRE_INTENT: 31,
  L20_LOGICALLY_RETIRED: 32,
  C10_CLEANUP_PENDING: 33,
  C20_CLEANUP_COMPLETE: 34,
  K10_CHECKPOINT_ACTIVE: 40,
  TAIL_SEAL: 255
});
const RECORD_KIND_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(RECORD_KINDS).map(([name, code]) => [code, name])
));

const LEGAL_SUCCESSORS = Object.freeze({
  '': ['M00_V1_MIGRATION'],
  M00_V1_MIGRATION: ['P00_PREPARED'],
  P00_PREPARED: ['P10_COPIED', 'B80_BUSINESS_COMMITTED'],
  P10_COPIED: ['P15_TRANSFORMING', 'B80_BUSINESS_COMMITTED'],
  P15_TRANSFORMING: ['P20_TRANSFORMED', 'B80_BUSINESS_COMMITTED'],
  P20_TRANSFORMED: ['T00_REGISTERED', 'B80_BUSINESS_COMMITTED'],
  T00_REGISTERED: ['T10_DISPLACE_INTENT', 'B80_BUSINESS_COMMITTED'],
  T10_DISPLACE_INTENT: ['T20_DISPLACED', 'B80_BUSINESS_COMMITTED'],
  T20_DISPLACED: ['T30_INSTALL_INTENT', 'B80_BUSINESS_COMMITTED'],
  T30_INSTALL_INTENT: ['T40_INSTALLED', 'B80_BUSINESS_COMMITTED'],
  T40_INSTALLED: ['T50_VERIFY_INTENT', 'B80_BUSINESS_COMMITTED'],
  T50_VERIFY_INTENT: ['T60_VERIFIED', 'B80_BUSINESS_COMMITTED'],
  T60_VERIFIED: ['T70_CLEANUP_AUTHORIZED', 'B80_BUSINESS_COMMITTED'],
  T70_CLEANUP_AUTHORIZED: ['B80_BUSINESS_COMMITTED'],
  B80_BUSINESS_COMMITTED: ['L10_RETIRE_INTENT'],
  L10_RETIRE_INTENT: ['L20_LOGICALLY_RETIRED'],
  L20_LOGICALLY_RETIRED: ['C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE', 'K10_CHECKPOINT_ACTIVE'],
  C10_CLEANUP_PENDING: ['C20_CLEANUP_COMPLETE', 'K10_CHECKPOINT_ACTIVE'],
  C20_CLEANUP_COMPLETE: ['K10_CHECKPOINT_ACTIVE'],
  K10_CHECKPOINT_ACTIVE: []
});

function journalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function targetIdFor(targetPath) {
  return sha256(Buffer.from(normalizedPath(targetPath), 'utf8'));
}

function transactionTokenDigest(ownershipToken) {
  return sha256(Buffer.from(String(ownershipToken || ''), 'utf8'));
}

function uuidBytes(value) {
  const hex = String(value || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw journalError('journal-authority-invalid', 'The repair generation identifier is invalid');
  }
  return Buffer.from(hex, 'hex');
}

function statIdentity(stat) {
  const field = (name, fallback = 0n) => String(
    stat[name] === undefined ? fallback : stat[name]
  );
  return Object.freeze({
    dev: field('dev'),
    ino: field('ino'),
    mode: field('mode'),
    nlink: field('nlink'),
    size: field('size'),
    birthtime_ns: field('birthtimeNs', BigInt(Math.trunc(Number(stat.birthtimeMs || 0) * 1e6))),
    mtime_ns: field('mtimeNs', BigInt(Math.trunc(Number(stat.mtimeMs || 0) * 1e6))),
    ctime_ns: field('ctimeNs', BigInt(Math.trunc(Number(stat.ctimeMs || 0) * 1e6)))
  });
}

function identitiesMatch(left, right) {
  return Boolean(left && right)
    && Object.keys(left).every((key) => String(left[key]) === String(right[key]));
}

function directoryIdentitiesMatch(left, right) {
  return Boolean(left && right)
    && ['dev', 'ino', 'mode', 'nlink', 'birthtime_ns'].every((key) =>
      String(left[key]) === String(right[key])
    );
}

function pathExists(value) {
  try {
    fs.lstatSync(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function requireOrdinaryDirectory(value, label) {
  const resolved = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(resolved, { bigint: true });
  } catch {
    throw journalError('journal-topology-invalid', `${label} is absent or unprovable`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw journalError('journal-topology-invalid', `${label} is not an ordinary directory`);
  }
  let real;
  try {
    real = normalizedPath(fs.realpathSync.native(resolved));
  } catch {
    throw journalError('journal-topology-invalid', `${label} real path is unprovable`);
  }
  if (real !== normalizedPath(resolved)) {
    throw journalError('journal-topology-invalid', `${label} is redirected or aliased`);
  }
  return Object.freeze({
    identity: statIdentity(stat),
    normalized_path: normalizedPath(resolved),
    real_path: real
  });
}

function fsyncDirectoryIfSupported(directoryPath) {
  if (process.platform === 'win32') return;
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    throw journalError('journal-durability-unavailable', 'Journal directory durability could not be admitted');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureOrdinaryDirectory(directoryPath, parentPath, write) {
  if (pathExists(directoryPath)) return requireOrdinaryDirectory(directoryPath, 'repair journal directory');
  if (!write) {
    throw journalError('journal-missing', 'The repair journal directory does not exist');
  }
  const parent = requireOrdinaryDirectory(parentPath, 'repair journal parent');
  try {
    fs.mkdirSync(directoryPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw journalError('journal-durability-unavailable', 'The repair journal directory could not be created exclusively');
    }
  }
  const created = requireOrdinaryDirectory(directoryPath, 'repair journal directory');
  const parentAfter = requireOrdinaryDirectory(parentPath, 'repair journal parent');
  if (!directoryIdentitiesMatch(parent.identity, parentAfter.identity)) {
    throw journalError('journal-topology-invalid', 'The repair journal parent changed during directory creation');
  }
  fsyncDirectoryIfSupported(parentPath);
  return created;
}

function requireSupportedRuntime(write) {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (write && !JOURNAL_SUPPORTED_NODE_MAJORS.includes(major)) {
    throw journalError(
      'journal-runtime-unsupported',
      'Repair mutation requires the supported Node 22 or Node 24 journal durability adapter'
    );
  }
  return major;
}

function journalPaths(codexHome, targetPath, generationId) {
  const home = path.resolve(codexHome);
  const targetId = targetIdFor(targetPath);
  const base = path.join(home, '.ai-agent-toolkit-n8n-repair');
  const v2 = path.join(base, 'v2');
  const targets = path.join(v2, 'targets');
  const target = path.join(targets, targetId);
  const transactions = path.join(target, 'transactions');
  const transaction = path.join(transactions, String(generationId));
  const segments = path.join(transaction, 'segments');
  const checkpoints = path.join(target, 'checkpoints');
  const targetNormalized = normalizedPath(targetPath);
  const journalNormalized = normalizedPath(target);
  if (
    journalNormalized === targetNormalized
    || journalNormalized.startsWith(`${targetNormalized}${path.sep}`)
    || targetNormalized.startsWith(`${journalNormalized}${path.sep}`)
  ) {
    throw journalError('journal-location-invalid', 'The stable repair journal overlaps the mutable plugin target');
  }
  if (process.platform === 'win32' && Math.max(
    ...[base, v2, targets, target, transactions, transaction, segments, checkpoints].map((value) => value.length)
  ) > 32760) {
    throw journalError('journal-path-unsupported', 'The stable repair journal path exceeds the supported Windows path bound');
  }
  return Object.freeze({
    base,
    checkpoints,
    codex_home: home,
    segments,
    target,
    target_id: targetId,
    targets,
    transaction,
    transactions,
    v2
  });
}

function ensureJournalPaths(paths, write) {
  requireOrdinaryDirectory(paths.codex_home, 'Codex home');
  const ordered = [
    [paths.base, paths.codex_home],
    [paths.v2, paths.base],
    [paths.targets, paths.v2],
    [paths.target, paths.targets],
    [paths.transactions, paths.target],
    [paths.transaction, paths.transactions],
    [paths.segments, paths.transaction],
    [paths.checkpoints, paths.target]
  ];
  for (const [directory, parent] of ordered) ensureOrdinaryDirectory(directory, parent, write);
  return Object.freeze({
    checkpoints: requireOrdinaryDirectory(paths.checkpoints, 'repair checkpoint directory'),
    segments: requireOrdinaryDirectory(paths.segments, 'repair journal segment directory'),
    target: requireOrdinaryDirectory(paths.target, 'repair target journal directory'),
    transaction: requireOrdinaryDirectory(paths.transaction, 'repair transaction journal directory')
  });
}

function writeU64(buffer, value, offset) {
  buffer.writeBigUInt64LE(BigInt(value), offset);
}

function readU64(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function encodeFrame({
  attempt,
  family,
  generationId,
  kind,
  ownershipToken,
  payload,
  previousDigest,
  targetId
}) {
  const kindCode = RECORD_KINDS[kind];
  if (!kindCode) throw journalError('journal-state-invalid', 'The journal record kind is unsupported');
  const payloadValue = Object.freeze({
    journal_schema: JOURNAL_SCHEMA,
    record_kind: kind,
    ...payload
  });
  const payloadBytes = Buffer.from(canonicalJson(payloadValue), 'utf8');
  if (payloadBytes.length > JOURNAL_MAX_PAYLOAD_BYTES) {
    throw journalError('journal-record-too-large', 'The journal record exceeds the locked payload byte limit');
  }
  const total = JOURNAL_HEADER_BYTES + payloadBytes.length + JOURNAL_TRAILER_BYTES;
  const header = Buffer.alloc(JOURNAL_HEADER_BYTES);
  JOURNAL_MAGIC.copy(header, 0);
  header.writeUInt16LE(JOURNAL_SCHEMA, 16);
  header.writeUInt16LE(JOURNAL_HEADER_BYTES, 18);
  header.writeUInt32LE(total, 20);
  header.writeUInt32LE(payloadBytes.length, 24);
  header.writeUInt16LE(kindCode, 28);
  header.writeUInt16LE(kind === 'TAIL_SEAL' ? 1 : 0, 30);
  writeU64(header, family, 32);
  header.writeUInt8(attempt, 40);
  writeU64(header, family, 48);
  uuidBytes(generationId).copy(header, 56);
  crypto.randomBytes(16).copy(header, 72);
  Buffer.from(previousDigest || ZERO_DIGEST, 'hex').copy(header, 88);
  Buffer.from(sha256(payloadBytes), 'hex').copy(header, 120);
  Buffer.from(targetId, 'hex').copy(header, 152);
  Buffer.from(transactionTokenDigest(ownershipToken), 'hex').copy(header, 184);
  const trailer = Buffer.alloc(JOURNAL_TRAILER_BYTES);
  JOURNAL_COMMIT_MAGIC.copy(trailer, 0);
  writeU64(trailer, family, 16);
  trailer.writeUInt8(attempt, 24);
  writeU64(trailer, family, 32);
  trailer.writeUInt32LE(payloadBytes.length, 40);
  trailer.writeUInt32LE(total, 44);
  const frame = Buffer.concat([header, payloadBytes, trailer]);
  const digestInput = Buffer.from(frame);
  digestInput.fill(0, total - JOURNAL_TRAILER_BYTES + 48, total - JOURNAL_TRAILER_BYTES + 80);
  const completeDigest = sha256(digestInput);
  Buffer.from(completeDigest, 'hex').copy(frame, total - JOURNAL_TRAILER_BYTES + 48);
  return Object.freeze({ bytes: frame, complete_digest: completeDigest, payload: payloadValue });
}

function incompleteFrame(bytes, reason) {
  return Object.freeze({
    classification: 'incomplete',
    raw_sha256: sha256(bytes),
    reason,
    size: bytes.length
  });
}

function decodeFrame(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > JOURNAL_MAX_RECORD_BYTES) {
    throw journalError('journal-corrupt', 'A journal segment exceeds the locked record byte limit');
  }
  if (bytes.length < JOURNAL_MAGIC.length) return incompleteFrame(bytes, 'torn-magic');
  if (!bytes.subarray(0, 16).equals(JOURNAL_MAGIC)) {
    throw journalError('journal-corrupt', 'A journal segment has an invalid magic value');
  }
  if (bytes.length < JOURNAL_HEADER_BYTES) return incompleteFrame(bytes, 'torn-header');
  const schema = bytes.readUInt16LE(16);
  const headerLength = bytes.readUInt16LE(18);
  const total = bytes.readUInt32LE(20);
  const payloadLength = bytes.readUInt32LE(24);
  const kindCode = bytes.readUInt16LE(28);
  const family = readU64(bytes, 32);
  const attempt = bytes.readUInt8(40);
  if (
    schema !== JOURNAL_SCHEMA
    || headerLength !== JOURNAL_HEADER_BYTES
    || payloadLength > JOURNAL_MAX_PAYLOAD_BYTES
    || total !== JOURNAL_HEADER_BYTES + payloadLength + JOURNAL_TRAILER_BYTES
    || total > JOURNAL_MAX_RECORD_BYTES
    || !RECORD_KIND_BY_CODE[kindCode]
    || attempt > JOURNAL_MAX_RESCUE_ATTEMPTS
  ) {
    throw journalError('journal-corrupt', 'A journal segment header is invalid');
  }
  if (bytes.length < total) return incompleteFrame(bytes, 'torn-frame');
  if (bytes.length !== total) {
    throw journalError('journal-corrupt', 'A journal segment contains bytes after its complete frame');
  }
  const trailerOffset = total - JOURNAL_TRAILER_BYTES;
  const trailer = bytes.subarray(trailerOffset);
  if (
    !trailer.subarray(0, 16).equals(JOURNAL_COMMIT_MAGIC)
    || readU64(trailer, 16) !== family
    || trailer.readUInt8(24) !== attempt
    || readU64(trailer, 32) !== family
    || trailer.readUInt32LE(40) !== payloadLength
    || trailer.readUInt32LE(44) !== total
  ) {
    throw journalError('journal-corrupt', 'A journal segment commit trailer is invalid');
  }
  const payloadBytes = bytes.subarray(JOURNAL_HEADER_BYTES, trailerOffset);
  if (sha256(payloadBytes) !== bytes.subarray(120, 152).toString('hex')) {
    throw journalError('journal-corrupt', 'A journal segment payload digest is invalid');
  }
  const digestInput = Buffer.from(bytes);
  digestInput.fill(0, trailerOffset + 48, trailerOffset + 80);
  const completeDigest = sha256(digestInput);
  if (completeDigest !== trailer.subarray(48, 80).toString('hex')) {
    throw journalError('journal-corrupt', 'A journal segment complete-record digest is invalid');
  }
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw journalError('journal-corrupt', 'A journal segment payload is malformed');
  }
  if (
    canonicalJson(payload) !== payloadBytes.toString('utf8')
    || payload.journal_schema !== JOURNAL_SCHEMA
    || payload.record_kind !== RECORD_KIND_BY_CODE[kindCode]
  ) {
    throw journalError('journal-corrupt', 'A journal segment payload is not exact canonical schema-2 data');
  }
  return Object.freeze({
    attempt,
    classification: 'complete',
    complete_digest: completeDigest,
    family: Number(family),
    generation_id: bytes.subarray(56, 72).toString('hex'),
    kind: RECORD_KIND_BY_CODE[kindCode],
    ownership_token_digest: bytes.subarray(184, 216).toString('hex'),
    payload,
    previous_digest: bytes.subarray(88, 120).toString('hex'),
    raw_sha256: sha256(bytes),
    size: bytes.length,
    target_id: bytes.subarray(152, 184).toString('hex')
  });
}

function readExactFile(filePath, maximumBytes = JOURNAL_MAX_RECORD_BYTES) {
  const resolved = path.resolve(filePath);
  const parent = requireOrdinaryDirectory(path.dirname(resolved), 'journal file parent');
  let first;
  try {
    first = fs.lstatSync(resolved, { bigint: true });
  } catch {
    throw journalError('journal-drift', 'A journal file disappeared before exact inspection');
  }
  if (!first.isFile() || first.isSymbolicLink() || BigInt(first.size) > BigInt(maximumBytes)) {
    throw journalError('journal-corrupt', 'A journal path is not a bounded ordinary non-link file');
  }
  const firstIdentity = statIdentity(first);
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw journalError('journal-drift', 'A journal file could not be opened without redirect ambiguity');
  }
  let bytes;
  let descriptorIdentity;
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    descriptorIdentity = statIdentity(descriptorStat);
    if (!descriptorStat.isFile() || !identitiesMatch(firstIdentity, descriptorIdentity)) {
      throw journalError('journal-drift', 'A journal file changed before descriptor inspection');
    }
    bytes = Buffer.alloc(Number(descriptorStat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== bytes.length || !identitiesMatch(
      descriptorIdentity,
      statIdentity(fs.fstatSync(descriptor, { bigint: true }))
    )) {
      throw journalError('journal-drift', 'A journal file changed during exact descriptor inspection');
    }
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {
      throw journalError('journal-drift', 'A journal descriptor could not be closed after exact inspection');
    }
  }
  let final;
  let finalReal;
  try {
    final = fs.lstatSync(resolved, { bigint: true });
    finalReal = normalizedPath(fs.realpathSync.native(resolved));
  } catch {
    throw journalError('journal-drift', 'A journal pathname changed after descriptor inspection');
  }
  if (
    finalReal !== normalizedPath(resolved)
    || !identitiesMatch(firstIdentity, statIdentity(final))
    || !identitiesMatch(parent.identity, requireOrdinaryDirectory(path.dirname(resolved), 'journal file parent').identity)
  ) {
    throw journalError('journal-drift', 'A journal pathname or parent changed during inspection');
  }
  return Object.freeze({
    bytes,
    bytes_sha256: sha256(bytes),
    filesystem_identity: descriptorIdentity,
    normalized_path: normalizedPath(resolved),
    parent_identity: parent
  });
}

function writeExclusiveDurable(filePath, bytes, options = {}) {
  const resolved = path.resolve(filePath);
  const parent = requireOrdinaryDirectory(path.dirname(resolved), 'journal segment parent');
  if (options.testHooks?.beforeN8nJournalSegmentWrite) {
    options.testHooks.beforeN8nJournalSegmentWrite({
      attempt: options.attempt,
      family: options.family,
      path: resolved,
      size: bytes.length
    });
  }
  let writeLimit = bytes.length;
  if (options.testHooks?.n8nJournalWriteByteLimit) {
    writeLimit = Number(options.testHooks.n8nJournalWriteByteLimit({
      attempt: options.attempt,
      family: options.family,
      size: bytes.length
    }));
    if (!Number.isInteger(writeLimit) || writeLimit < 0 || writeLimit > bytes.length) {
      throw journalError('journal-test-hook-invalid', 'The synthetic journal write limit is invalid');
    }
  }
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw journalError('journal-destination-race', 'The journal segment destination already exists');
    throw journalError('journal-durability-unavailable', 'The journal segment could not be created exclusively');
  }
  try {
    let offset = 0;
    while (offset < writeLimit) {
      const count = fs.writeSync(descriptor, bytes, offset, writeLimit - offset, offset);
      if (count <= 0) throw journalError('journal-durability-unavailable', 'The journal segment write made no progress');
      offset += count;
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (String(error?.code || '').startsWith('journal-')) throw error;
    throw journalError('journal-durability-unavailable', 'The journal segment could not be flushed');
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {
      throw journalError('journal-durability-unavailable', 'The journal segment descriptor could not be closed');
    }
  }
  fsyncDirectoryIfSupported(path.dirname(resolved));
  if (writeLimit !== bytes.length) {
    throw journalError('journal-incomplete-tail', 'The journal append stopped with one incomplete pre-authorised tail');
  }
  const reopened = readExactFile(resolved);
  if (!reopened.bytes.equals(bytes)) {
    throw journalError('journal-drift', 'The durable journal segment failed exact close-and-reopen verification');
  }
  if (!directoryIdentitiesMatch(parent.identity, reopened.parent_identity.identity)) {
    throw journalError('journal-drift', 'The journal segment parent changed during durable publication');
  }
  if (options.testHooks?.afterN8nJournalSegmentVerified) {
    options.testHooks.afterN8nJournalSegmentVerified({
      attempt: options.attempt,
      family: options.family,
      path: resolved,
      sha256: reopened.bytes_sha256
    });
  }
  return reopened;
}

function scanSegmentDirectory(paths, generationId, ownershipToken) {
  const names = fs.readdirSync(paths.segments)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (names.length > JOURNAL_MAX_ACTIVE_SEGMENTS) {
    throw journalError('journal-hard-limit', 'The active repair journal exceeds the locked segment-entry limit');
  }
  const groups = new Map();
  let totalBytes = 0;
  let observedOwnershipTokenDigest = '';
  for (const name of names) {
    const match = SEGMENT_PATTERN.exec(name);
    if (!match) throw journalError('journal-corrupt', 'The journal segment directory contains an unknown entry');
    const family = Number(match[1]);
    const attempt = Number(match[2]);
    const inspected = readExactFile(path.join(paths.segments, name));
    totalBytes += inspected.bytes.length;
    if (totalBytes > JOURNAL_MAX_ACTIVE_BYTES) {
      throw journalError('journal-hard-limit', 'The active repair journal exceeds the locked byte limit');
    }
    const frame = decodeFrame(inspected.bytes);
    if (frame.classification === 'complete') {
      if (
        frame.family !== family
        || frame.attempt !== attempt
        || frame.target_id !== paths.target_id
        || frame.generation_id !== String(generationId).replace(/-/g, '').toLowerCase()
        || (ownershipToken && frame.ownership_token_digest !== transactionTokenDigest(ownershipToken))
      ) {
        throw journalError('journal-corrupt', 'A journal frame conflicts with its exact transaction namespace');
      }
      if (
        observedOwnershipTokenDigest
        && observedOwnershipTokenDigest !== frame.ownership_token_digest
      ) {
        throw journalError('journal-corrupt', 'Journal frames disagree on their exact ownership-token authority');
      }
      observedOwnershipTokenDigest = frame.ownership_token_digest;
    }
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(Object.freeze({
      attempt,
      file: inspected,
      frame,
      name
    }));
  }
  const records = [];
  let pending = null;
  let previousDigest = ZERO_DIGEST;
  const families = [...groups.keys()].sort((left, right) => left - right);
  for (let familyIndex = 0; familyIndex < families.length; familyIndex += 1) {
    const family = families[familyIndex];
    if (family !== familyIndex + 1) {
      throw journalError('journal-corrupt', 'The journal contains a missing or out-of-order record family');
    }
    const attempts = groups.get(family).sort((left, right) => left.attempt - right.attempt);
    let complete = null;
    const incomplete = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const entry = attempts[index];
      if (entry.attempt !== index || complete) {
        throw journalError('journal-corrupt', 'The journal contains a skipped or post-commit rescue attempt');
      }
      if (entry.frame.classification === 'incomplete') {
        incomplete.push(entry);
      } else {
        complete = entry;
      }
    }
    if (!complete) {
      if (familyIndex !== families.length - 1) {
        throw journalError('journal-corrupt', 'An incomplete journal family is not the physical tail');
      }
      pending = Object.freeze({ attempts: Object.freeze(incomplete), family });
      continue;
    }
    if (complete.frame.previous_digest !== previousDigest) {
      throw journalError('journal-corrupt', 'The journal record chain digest is discontinuous');
    }
    let semanticKind = complete.frame.kind;
    let semanticPayload = complete.frame.payload;
    if (complete.attempt > 0) {
      if (complete.frame.kind !== 'TAIL_SEAL') {
        throw journalError('journal-corrupt', 'A rescue attempt does not contain the required TAIL_SEAL record');
      }
      const sealed = Array.isArray(complete.frame.payload.sealed_tails)
        ? complete.frame.payload.sealed_tails
        : [];
      const expected = incomplete.map((entry) => ({
        attempt: entry.attempt,
        name: entry.name,
        raw_sha256: entry.file.bytes_sha256,
        size: entry.file.bytes.length
      }));
      if (
        canonicalJson(sealed) !== canonicalJson(expected)
        || !RECORD_KINDS[complete.frame.payload.continued_kind]
        || !complete.frame.payload.continued_payload
      ) {
        throw journalError('journal-corrupt', 'A TAIL_SEAL does not exactly bind every incomplete predecessor');
      }
      semanticKind = complete.frame.payload.continued_kind;
      semanticPayload = complete.frame.payload.continued_payload;
    } else if (incomplete.length) {
      throw journalError('journal-corrupt', 'A primary commit appeared after an incomplete primary attempt');
    }
    records.push(Object.freeze({
      attempt: complete.attempt,
      complete_digest: complete.frame.complete_digest,
      family,
      frame_kind: complete.frame.kind,
      kind: semanticKind,
      payload: Object.freeze(semanticPayload),
      segment_identity: complete.file.filesystem_identity,
      segment_name: complete.name,
      segment_path: complete.file.normalized_path,
      segment_sha256: complete.file.bytes_sha256
    }));
    previousDigest = complete.frame.complete_digest;
  }
  return Object.freeze({
    bytes: totalBytes,
    digest: sha256(Buffer.from(canonicalJson(records), 'utf8')),
    pending,
    ownership_token_digest: observedOwnershipTokenDigest,
    previous_digest: previousDigest,
    records: Object.freeze(records)
  });
}

function validateStateProgression(records) {
  let state = '';
  for (const record of records) {
    if (!(LEGAL_SUCCESSORS[state] || []).includes(record.kind)) {
      throw journalError('journal-state-invalid', 'The repair journal contains an illegal or skipped state transition');
    }
    state = record.kind;
  }
  return state;
}

function inspectN8nRepairJournal({
  codexHome,
  generationId,
  ownershipToken,
  targetPath,
  write = false
}) {
  requireSupportedRuntime(write);
  const paths = journalPaths(codexHome, targetPath, generationId);
  if (!pathExists(paths.transaction)) {
    return Object.freeze({
      exists: false,
      paths,
      state: '',
      status: 'missing'
    });
  }
  const topology = ensureJournalPaths(paths, false);
  const scan = scanSegmentDirectory(paths, generationId, ownershipToken);
  const state = validateStateProgression(scan.records);
  return Object.freeze({
    digest: scan.digest,
    exists: true,
    generation_id: generationId,
    ownership_token_digest: transactionTokenDigest(ownershipToken),
    paths,
    pending: scan.pending,
    previous_digest: scan.previous_digest,
    records: scan.records,
    state,
    status: scan.pending
      ? scan.pending.attempts.length > JOURNAL_MAX_RESCUE_ATTEMPTS
        ? 'rescue-exhausted'
        : 'incomplete-tail'
      : state === 'L20_LOGICALLY_RETIRED' || state === 'C10_CLEANUP_PENDING'
        || state === 'C20_CLEANUP_COMPLETE' || state === 'K10_CHECKPOINT_ACTIVE'
        ? 'logically-retired'
        : 'active',
    topology
  });
}

function openN8nRepairJournal({
  codexHome,
  generationId,
  ownershipToken,
  targetPath,
  write = false
}) {
  requireSupportedRuntime(write);
  const paths = journalPaths(codexHome, targetPath, generationId);
  if (!pathExists(paths.transaction)) {
    if (!write) return inspectN8nRepairJournal({
      codexHome,
      generationId,
      ownershipToken,
      targetPath,
      write
    });
    ensureJournalPaths(paths, true);
  }
  return inspectN8nRepairJournal({
    codexHome,
    generationId,
    ownershipToken,
    targetPath,
    write
  });
}

function assertJournalAuthorityUnchanged(authority) {
  const current = inspectN8nRepairJournal({
    codexHome: authority.paths.codex_home,
    generationId: authority.generation_id,
    ownershipToken: authority.ownership_token,
    targetPath: authority.target_path
  });
  if (
    !current.exists
    || current.digest !== authority.digest
    || current.state !== authority.state
    || current.status !== authority.status
  ) {
    throw journalError('journal-drift', 'The exact repair journal authority changed at a mutation boundary');
  }
  return current;
}

function appendN8nRepairJournalRecord(authority, kind, payload = {}, options = {}) {
  requireSupportedRuntime(true);
  if (!RECORD_KINDS[kind] || kind === 'TAIL_SEAL') {
    throw journalError('journal-state-invalid', 'The requested semantic journal transition is invalid');
  }
  const current = authority.exists
    ? assertJournalAuthorityUnchanged(authority)
    : openN8nRepairJournal({
      codexHome: authority.paths.codex_home,
      generationId: authority.generation_id,
      ownershipToken: authority.ownership_token,
      targetPath: authority.target_path,
      write: true
    });
  const previousState = current.state || '';
  if (!(LEGAL_SUCCESSORS[previousState] || []).includes(kind)) {
    const existing = current.records.find((record) => record.kind === kind);
    if (existing && canonicalJson(existing.payload) === canonicalJson({
      journal_schema: JOURNAL_SCHEMA,
      record_kind: kind,
      ...payload
    })) {
      return authority.exists ? authority : current;
    }
    throw journalError('journal-state-invalid', 'The requested repair journal transition is illegal or non-idempotent');
  }
  const family = current.pending?.family || current.records.length + 1;
  const incomplete = current.pending?.attempts || [];
  const attempt = incomplete.length;
  if (attempt > JOURNAL_MAX_RESCUE_ATTEMPTS) {
    throw journalError('journal-rescue-exhausted', 'All nine pre-authorised journal attempts are exhausted');
  }
  const semanticPayload = {
    journal_schema: JOURNAL_SCHEMA,
    record_kind: kind,
    ...payload
  };
  const frameKind = attempt === 0 ? kind : 'TAIL_SEAL';
  const framePayload = attempt === 0
    ? payload
    : {
      continued_kind: kind,
      continued_payload: semanticPayload,
      sealed_tails: incomplete.map((entry) => ({
        attempt: entry.attempt,
        name: entry.name,
        raw_sha256: entry.file.bytes_sha256,
        size: entry.file.bytes.length
      }))
    };
  const encoded = encodeFrame({
    attempt,
    family,
    generationId: authority.generation_id,
    kind: frameKind,
    ownershipToken: authority.ownership_token,
    payload: framePayload,
    previousDigest: current.previous_digest || ZERO_DIGEST,
    targetId: authority.paths.target_id
  });
  const segmentName = `r-${String(family).padStart(16, '0')}-a${attempt}.jseg`;
  writeExclusiveDurable(path.join(authority.paths.segments, segmentName), encoded.bytes, {
    attempt,
    family,
    testHooks: options.testHooks
  });
  const next = inspectN8nRepairJournal({
    codexHome: authority.paths.codex_home,
    generationId: authority.generation_id,
    ownershipToken: authority.ownership_token,
    targetPath: authority.target_path,
    write: true
  });
  const accepted = next.records.at(-1);
  if (
    accepted?.kind !== kind
    || canonicalJson(accepted.payload) !== canonicalJson(semanticPayload)
  ) {
    throw journalError('journal-drift', 'The appended journal transition failed exact semantic reopen verification');
  }
  return Object.freeze({
    ...next,
    ownership_token: authority.ownership_token,
    target_path: authority.target_path
  });
}

function bindJournalAuthority({
  codexHome,
  generationId,
  ownershipToken,
  targetPath,
  write = false
}) {
  const inspected = openN8nRepairJournal({
    codexHome,
    generationId,
    ownershipToken,
    targetPath,
    write
  });
  return Object.freeze({
    ...inspected,
    generation_id: generationId,
    ownership_token: ownershipToken,
    target_path: path.resolve(targetPath)
  });
}

function inspectResidueEntry(entry) {
  const resolved = path.resolve(entry.normalized_path);
  if (!pathExists(resolved)) {
    return Object.freeze({ ...entry, present: false });
  }
  const inspected = readExactFile(resolved, Number(entry.maximum_bytes || JOURNAL_MAX_RECORD_BYTES));
  if (
    entry.bytes_sha256 !== inspected.bytes_sha256
    || !identitiesMatch(entry.filesystem_identity, inspected.filesystem_identity)
  ) {
    throw journalError('journal-retired-residue-drift', 'Logically retired repair residue changed identity or bytes');
  }
  return Object.freeze({ ...entry, present: true });
}

function residueManifest(entries) {
  const normalized = entries
    .map((entry) => ({
      bytes_sha256: entry.bytes_sha256 || '',
      filesystem_identity: entry.filesystem_identity || null,
      kind: entry.evidence_kind || entry.kind || '',
      maximum_bytes: entry.maximum_bytes || JOURNAL_MAX_RECORD_BYTES,
      normalized_path: normalizedPath(entry.normalized_path),
      present: Boolean(entry.present)
    }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.normalized_path), Buffer.from(right.normalized_path)));
  return Object.freeze({
    digest: sha256(Buffer.from(canonicalJson(normalized), 'utf8')),
    entries: Object.freeze(normalized)
  });
}

function appendLogicalRetirement(authority, manifest, options = {}) {
  let current = authority;
  if (!['B80_BUSINESS_COMMITTED', 'L10_RETIRE_INTENT', 'L20_LOGICALLY_RETIRED'].includes(current.state)) {
    current = appendN8nRepairJournalRecord(current, 'B80_BUSINESS_COMMITTED', {
      outcome: options.outcome || 'committed',
      winner_digest: options.winnerDigest || '',
      rollback_digest: options.rollbackDigest || ''
    }, options);
  }
  if (current.state === 'B80_BUSINESS_COMMITTED') {
    current = appendN8nRepairJournalRecord(current, 'L10_RETIRE_INTENT', {
      residue_manifest_digest: manifest.digest,
      residue_entries: manifest.entries.length
    }, options);
  }
  if (current.state === 'L10_RETIRE_INTENT') {
    current = appendN8nRepairJournalRecord(current, 'L20_LOGICALLY_RETIRED', {
      residue_manifest: manifest,
      terminal_root: sha256(Buffer.from(`${current.previous_digest}\0${manifest.digest}`, 'utf8'))
    }, options);
  }
  return current;
}

function logicalRetirementManifest(authority) {
  const record = authority.records.find((entry) => entry.kind === 'L20_LOGICALLY_RETIRED');
  return record?.payload?.residue_manifest || null;
}

function revalidateLogicalRetirement(authority) {
  const current = assertJournalAuthorityUnchanged(authority);
  const manifest = logicalRetirementManifest(current);
  if (!manifest || sha256(Buffer.from(canonicalJson(manifest.entries), 'utf8')) !== manifest.digest) {
    throw journalError('journal-retirement-corrupt', 'The logical-retirement residue manifest is missing or invalid');
  }
  const cleanupAuthorized = current.state === 'C10_CLEANUP_PENDING'
    || current.state === 'C20_CLEANUP_COMPLETE';
  for (const entry of manifest.entries) {
    if (entry.present && pathExists(entry.normalized_path)) {
      inspectResidueEntry(entry);
    } else if (entry.present && !cleanupAuthorized) {
      throw journalError('journal-retired-residue-drift', 'Logically retired residue disappeared before durable cleanup authorisation');
    } else if (entry.present && current.state === 'C20_CLEANUP_COMPLETE') {
      continue;
    }
    else if (pathExists(entry.normalized_path)) {
      throw journalError('journal-retired-residue-drift', 'Previously absent logically retired residue appeared');
    }
  }
  if (
    current.state === 'C20_CLEANUP_COMPLETE'
    && manifest.entries.some((entry) => entry.present && pathExists(entry.normalized_path))
  ) {
    throw journalError('journal-retired-residue-drift', 'Physical cleanup completion conflicts with retained residue');
  }
  return current;
}

function targetJournalUsage(paths) {
  let entries = 0;
  let bytes = 0;
  const directories = [];
  const files = [];
  const pending = [paths.target];
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) throw journalError('journal-topology-invalid', 'The repair journal contains a redirect');
    if (stat.isDirectory()) {
      const before = requireOrdinaryDirectory(current, 'repair journal inventory directory');
      const names = fs.readdirSync(current)
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
      entries += names.length;
      if (entries > JOURNAL_MAX_TARGET_ENTRIES) {
        throw journalError('journal-hard-limit', 'The target journal exceeds its locked hard storage limit');
      }
      const after = requireOrdinaryDirectory(current, 'repair journal inventory directory');
      if (!directoryIdentitiesMatch(before.identity, after.identity)) {
        throw journalError('journal-topology-invalid', 'The repair journal changed during bounded inventory');
      }
      directories.push(Object.freeze({
        identity: before.identity,
        names: Object.freeze(names),
        path: current
      }));
      for (const name of names) pending.push(path.join(current, name));
    } else if (stat.isFile()) {
      bytes += Number(stat.size);
      files.push(Object.freeze({
        identity: statIdentity(stat),
        path: current
      }));
    } else {
      throw journalError('journal-topology-invalid', 'The repair journal contains a special entry');
    }
    if (bytes > JOURNAL_MAX_TARGET_BYTES) {
      throw journalError('journal-hard-limit', 'The target journal exceeds its locked hard storage limit');
    }
  }
  for (const directory of directories) {
    const current = requireOrdinaryDirectory(directory.path, 'repair journal inventory directory');
    const names = fs.readdirSync(directory.path)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (
      !directoryIdentitiesMatch(directory.identity, current.identity)
      || canonicalJson(names) !== canonicalJson(directory.names)
    ) {
      throw journalError('journal-topology-invalid', 'The repair journal directory changed during bounded inventory');
    }
  }
  for (const file of files) {
    let current;
    try {
      current = fs.lstatSync(file.path, { bigint: true });
    } catch {
      throw journalError('journal-topology-invalid', 'The repair journal file changed during bounded inventory');
    }
    if (
      !current.isFile()
      || current.isSymbolicLink()
      || !identitiesMatch(file.identity, statIdentity(current))
    ) {
      throw journalError('journal-topology-invalid', 'The repair journal file changed during bounded inventory');
    }
  }
  return Object.freeze({
    bytes,
    entries,
    hard_limit: entries >= JOURNAL_HARD_RESIDUE_ENTRIES || bytes >= JOURNAL_HARD_RESIDUE_BYTES,
    soft_limit: entries >= JOURNAL_SOFT_RESIDUE_ENTRIES || bytes >= JOURNAL_SOFT_RESIDUE_BYTES
  });
}

function transactionResidueManifest(authority) {
  const transactionRoot = authority.paths.transaction;
  const segmentsRoot = authority.paths.segments;
  const transactionNames = fs.readdirSync(transactionRoot)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (
    transactionNames.length !== 1
    || transactionNames[0] !== path.basename(segmentsRoot)
  ) {
    throw journalError('journal-corrupt', 'The terminal transaction journal contains an unknown entry');
  }
  requireOrdinaryDirectory(segmentsRoot, 'terminal transaction segment directory');
  const entries = fs.readdirSync(segmentsRoot)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map((name) => {
      if (!SEGMENT_PATTERN.test(name)) {
        throw journalError('journal-corrupt', 'The terminal transaction journal contains an unknown segment');
      }
      const inspected = readExactFile(path.join(segmentsRoot, name));
      return Object.freeze({
        bytes_sha256: inspected.bytes_sha256,
        filesystem_identity: inspected.filesystem_identity,
        relative_path: `segments/${name}`
      });
    });
  if (entries.length > JOURNAL_MAX_ACTIVE_SEGMENTS) {
    throw journalError('journal-hard-limit', 'The terminal transaction residue exceeds its locked entry limit');
  }
  return Object.freeze({
    digest: sha256(Buffer.from(canonicalJson(entries), 'utf8')),
    entries: Object.freeze(entries)
  });
}

function readCheckpointFile(checkpointPath, name) {
  const inspected = readExactFile(checkpointPath, JOURNAL_MAX_CHECKPOINT_BYTES);
  let frame;
  try {
    frame = decodeFrame(inspected.bytes);
  } catch {
    throw journalError('journal-checkpoint-corrupt', 'A checkpoint authority is incomplete or corrupt');
  }
  if (frame.classification !== 'complete' || frame.kind !== 'K10_CHECKPOINT_ACTIVE') {
    throw journalError('journal-checkpoint-corrupt', 'A checkpoint authority is incomplete or invalid');
  }
  return Object.freeze({
    epoch: Number(CHECKPOINT_PATTERN.exec(name)?.[2] || 0),
    frame,
    inspected,
    name
  });
}

function checkpointInventory(checkpointsPath) {
  const active = [];
  const retired = [];
  let bytes = 0;
  const names = fs.readdirSync(checkpointsPath)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (names.length > JOURNAL_MAX_TERMINAL_ENTRIES) {
    throw journalError('journal-hard-limit', 'Checkpoint retention exceeds its locked entry limit');
  }
  for (const name of names) {
    const activeMatch = CHECKPOINT_PATTERN.exec(name);
    const retiredMatch = RETIRED_CHECKPOINT_PATTERN.exec(name);
    if (activeMatch) {
      const value = readCheckpointFile(path.join(checkpointsPath, name), name);
      bytes += value.inspected.bytes.length;
      active.push(value);
      continue;
    }
    if (retiredMatch) {
      const sourceName = retiredMatch[1];
      const value = readCheckpointFile(path.join(checkpointsPath, name), sourceName);
      bytes += value.inspected.bytes.length;
      retired.push(Object.freeze({
        ...value,
        activation_digest: retiredMatch[2],
        quarantine_name: name
      }));
      continue;
    }
    throw journalError('journal-checkpoint-corrupt', 'The checkpoint directory contains an unknown entry');
  }
  if (bytes > JOURNAL_MAX_TERMINAL_BYTES) {
    throw journalError('journal-hard-limit', 'Checkpoint retention exceeds its locked byte limit');
  }
  active.sort((left, right) => left.epoch - right.epoch);
  retired.sort((left, right) => left.epoch - right.epoch);
  if (active.length > 3 || retired.length > 1) {
    throw journalError('journal-checkpoint-corrupt', 'Checkpoint retention exceeds its one-step restart prefix');
  }
  for (let index = 1; index < active.length; index += 1) {
    if (
      active[index].epoch !== active[index - 1].epoch + 1
      || active[index].frame.payload.previous_checkpoint_digest
        !== active[index - 1].frame.complete_digest
    ) {
      throw journalError('journal-checkpoint-corrupt', 'The active checkpoint chain is discontinuous');
    }
  }
  return Object.freeze({
    active: Object.freeze(active),
    retired: Object.freeze(retired)
  });
}

function checkpointRetirementMatches(entry, expected) {
  return entry.name === expected.name
    && entry.frame.complete_digest === expected.digest
    && entry.inspected.bytes_sha256 === expected.bytes_sha256;
}

function resumeCheckpointRetention(checkpointsPath, inventory, options = {}) {
  const latest = inventory.active.at(-1);
  const expected = latest?.frame.payload?.superseded_checkpoint || null;
  const quarantined = inventory.retired[0] || null;
  if (!expected) {
    if (quarantined || inventory.active.length > 2) {
      throw journalError('journal-checkpoint-corrupt', 'Checkpoint retirement residue lacks exact successor authority');
    }
    return inventory;
  }
  const source = inventory.active.find((entry) => entry.name === expected.name) || null;
  const quarantineName = `retired-${expected.name}-by-${latest.frame.complete_digest}.jseg`;
  if (quarantined) {
    if (
      quarantined.quarantine_name !== quarantineName
      || quarantined.activation_digest !== latest.frame.complete_digest
      || !checkpointRetirementMatches(quarantined, expected)
      || source
    ) {
      throw journalError('journal-checkpoint-drift', 'Checkpoint retirement residue conflicts with its exact successor authority');
    }
  } else if (source) {
    if (!checkpointRetirementMatches(source, expected)) {
      throw journalError('journal-checkpoint-drift', 'The superseded checkpoint changed before restart-safe retirement');
    }
    const quarantinePath = path.join(checkpointsPath, quarantineName);
    fs.renameSync(path.join(checkpointsPath, source.name), quarantinePath);
    const moved = readCheckpointFile(quarantinePath, source.name);
    if (!checkpointRetirementMatches(moved, expected)) {
      if (!pathExists(path.join(checkpointsPath, source.name))) {
        fs.renameSync(quarantinePath, path.join(checkpointsPath, source.name));
      }
      throw journalError('journal-checkpoint-drift', 'The moved checkpoint did not match its exact successor authority');
    }
    if (options.testHooks?.afterN8nCheckpointRetirementMove) {
      options.testHooks.afterN8nCheckpointRetirementMove({
        checkpoint_digest: expected.digest,
        checkpoint_name: expected.name
      });
    }
  }
  const quarantinePath = path.join(checkpointsPath, quarantineName);
  if (pathExists(quarantinePath)) {
    const final = readCheckpointFile(quarantinePath, expected.name);
    if (!checkpointRetirementMatches(final, expected)) {
      throw journalError('journal-checkpoint-drift', 'Checkpoint retirement residue changed before physical deletion');
    }
    if (options.testHooks?.beforeN8nCheckpointResidueDelete) {
      options.testHooks.beforeN8nCheckpointResidueDelete({
        checkpoint_digest: expected.digest,
        checkpoint_name: expected.name
      });
    }
    const finalBoundary = readCheckpointFile(quarantinePath, expected.name);
    if (!checkpointRetirementMatches(finalBoundary, expected)) {
      throw journalError('journal-checkpoint-drift', 'Checkpoint retirement residue changed at its deletion boundary');
    }
    fs.unlinkSync(quarantinePath);
    fsyncDirectoryIfSupported(checkpointsPath);
  }
  const recovered = checkpointInventory(checkpointsPath);
  if (recovered.active.length > 2 || recovered.retired.length) {
    throw journalError('journal-checkpoint-corrupt', 'Checkpoint retention did not reach its bounded restart state');
  }
  return recovered;
}

function writeTerminalCheckpoint(authority, options = {}) {
  let inventory = resumeCheckpointRetention(
    authority.paths.checkpoints,
    checkpointInventory(authority.paths.checkpoints),
    options
  );
  const previous = inventory.active.at(-1) || null;
  const terminal = authority.records.at(-1);
  const retirement = authority.records.find((entry) => entry.kind === 'L20_LOGICALLY_RETIRED');
  if (
    !terminal
    || !retirement
    || !['L20_LOGICALLY_RETIRED', 'C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE'].includes(authority.state)
  ) {
    throw journalError('journal-state-invalid', 'A terminal checkpoint requires logical-retirement authority');
  }
  if (
    previous?.frame.payload?.terminal_record_digest === terminal.complete_digest
    && previous.frame.payload.terminal_state === authority.state
  ) {
    return Object.freeze({
      cumulative_terminal_root: previous.frame.payload.cumulative_terminal_root,
      digest: previous.frame.complete_digest,
      epoch: previous.epoch,
      name: previous.name,
      slot: previous.frame.payload.slot
    });
  }
  const epoch = previous ? previous.epoch + 1 : 1;
  const slot = epoch % 2 === 1 ? 'a' : 'b';
  const superseded = inventory.active.length === 2 ? inventory.active[0] : null;
  const cumulativeRoot = sha256(Buffer.from([
    previous?.frame.payload?.cumulative_terminal_root || ZERO_DIGEST,
    terminal.complete_digest,
    retirement.payload.residue_manifest.digest
  ].join('\0'), 'utf8'));
  const encoded = encodeFrame({
    attempt: 0,
    family: epoch,
    generationId: authority.generation_id,
    kind: 'K10_CHECKPOINT_ACTIVE',
    ownershipToken: authority.ownership_token,
    payload: {
      cumulative_terminal_root: cumulativeRoot,
      generation_id: authority.generation_id,
      previous_checkpoint_digest: previous?.frame.complete_digest || ZERO_DIGEST,
      residue_manifest_digest: retirement.payload.residue_manifest.digest,
      slot,
      superseded_checkpoint: superseded
        ? {
          bytes_sha256: superseded.inspected.bytes_sha256,
          digest: superseded.frame.complete_digest,
          generation_id: superseded.frame.payload.generation_id,
          name: superseded.name,
          ownership_token_digest: superseded.frame.ownership_token_digest,
          terminal_record_digest: superseded.frame.payload.terminal_record_digest,
          terminal_state: superseded.frame.payload.terminal_state,
          transaction_authority_digest: superseded.frame.payload.transaction_authority_digest,
          transaction_residue_manifest: superseded.frame.payload.transaction_residue_manifest
        }
        : null,
      terminal_record_digest: terminal.complete_digest,
      terminal_state: authority.state,
      transaction_authority_digest: authority.digest,
      transaction_residue_manifest: transactionResidueManifest(authority)
    },
    previousDigest: previous?.frame.complete_digest || ZERO_DIGEST,
    targetId: authority.paths.target_id
  });
  const name = `checkpoint-${slot}-${String(epoch).padStart(16, '0')}.jseg`;
  writeExclusiveDurable(path.join(authority.paths.checkpoints, name), encoded.bytes, {
    attempt: 0,
    family: epoch,
    testHooks: options.testHooks
  });
  const verified = decodeFrame(readExactFile(path.join(authority.paths.checkpoints, name), JOURNAL_MAX_CHECKPOINT_BYTES).bytes);
  if (verified.classification !== 'complete' || verified.complete_digest !== encoded.complete_digest) {
    throw journalError('journal-checkpoint-corrupt', 'The inactive checkpoint failed exact activation verification');
  }
  if (options.testHooks?.afterN8nCheckpointPublished) {
    options.testHooks.afterN8nCheckpointPublished({
      checkpoint_digest: verified.complete_digest,
      checkpoint_name: name,
      epoch
    });
  }
  inventory = resumeCheckpointRetention(
    authority.paths.checkpoints,
    checkpointInventory(authority.paths.checkpoints),
    options
  );
  if (inventory.active.at(-1)?.frame.complete_digest !== verified.complete_digest) {
    throw journalError('journal-checkpoint-drift', 'The activated checkpoint is no longer the exact terminal authority');
  }
  return Object.freeze({
    cumulative_terminal_root: cumulativeRoot,
    digest: verified.complete_digest,
    epoch,
    name,
    slot
  });
}

function movedFilesystemIdentityMatches(left, right) {
  return Boolean(left && right)
    && ['dev', 'ino', 'mode', 'nlink', 'size', 'birthtime_ns', 'mtime_ns'].every((field) =>
      String(left[field]) === String(right[field])
    );
}

function inspectCompactionResidue(rootPath, expectedManifest, allowMissing) {
  if (!pathExists(rootPath)) return Object.freeze({ absent: true, entries: [] });
  requireOrdinaryDirectory(rootPath, 'checkpointed transaction residue');
  const segmentsPath = path.join(rootPath, 'segments');
  requireOrdinaryDirectory(segmentsPath, 'checkpointed transaction segment residue');
  const rootNames = fs.readdirSync(rootPath);
  if (rootNames.length !== 1 || rootNames[0] !== 'segments') {
    throw journalError('journal-compaction-drift', 'Checkpointed transaction residue contains an unknown entry');
  }
  const expected = new Map(expectedManifest.entries.map((entry) => [entry.relative_path, entry]));
  const entries = [];
  for (const name of fs.readdirSync(segmentsPath)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
    const relativePath = `segments/${name}`;
    const expectedEntry = expected.get(relativePath);
    if (!expectedEntry) {
      throw journalError('journal-compaction-drift', 'Checkpointed transaction residue contains an unbound segment');
    }
    const inspected = readExactFile(path.join(segmentsPath, name));
    if (
      inspected.bytes_sha256 !== expectedEntry.bytes_sha256
      || !movedFilesystemIdentityMatches(
        inspected.filesystem_identity,
        expectedEntry.filesystem_identity
      )
    ) {
      throw journalError('journal-compaction-drift', 'Checkpointed transaction residue changed identity or bytes');
    }
    entries.push(Object.freeze({
      ...expectedEntry,
      absolute_path: path.join(segmentsPath, name)
    }));
  }
  if (!allowMissing && entries.length !== expectedManifest.entries.length) {
    throw journalError('journal-compaction-drift', 'Checkpointed transaction residue is incomplete before compaction');
  }
  return Object.freeze({ absent: false, entries: Object.freeze(entries) });
}

function compactSupersededTransaction(authority, checkpoint, options = {}) {
  const inventory = checkpointInventory(authority.paths.checkpoints);
  const active = inventory.active.find((entry) => entry.frame.complete_digest === checkpoint.digest);
  const superseded = active?.frame.payload?.superseded_checkpoint || null;
  if (!superseded) return Object.freeze({ compacted: false, reason: 'no-superseded-transaction' });
  if (superseded.terminal_state !== 'C20_CLEANUP_COMPLETE') {
    return Object.freeze({ compacted: false, reason: 'cleanup-incomplete' });
  }
  if (superseded.generation_id === active.frame.payload.generation_id) {
    return Object.freeze({ compacted: false, reason: 'same-transaction-checkpoint' });
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(superseded.generation_id)
    || !superseded.transaction_residue_manifest
    || sha256(Buffer.from(canonicalJson(superseded.transaction_residue_manifest.entries), 'utf8'))
      !== superseded.transaction_residue_manifest.digest
  ) {
    throw journalError('journal-compaction-corrupt', 'A successor checkpoint lacks exact transaction compaction authority');
  }
  const sourcePath = path.join(authority.paths.transactions, superseded.generation_id);
  const quarantineName = `retired-transaction-${superseded.generation_id}-by-${checkpoint.digest}`;
  const quarantinePath = path.join(authority.paths.transactions, quarantineName);
  const sourceExists = pathExists(sourcePath);
  const quarantineExists = pathExists(quarantinePath);
  if (sourceExists && quarantineExists) {
    throw journalError('journal-compaction-drift', 'Both active and retired paths claim one checkpointed transaction');
  }
  if (sourceExists) {
    inspectCompactionResidue(sourcePath, superseded.transaction_residue_manifest, false);
    fs.renameSync(sourcePath, quarantinePath);
    inspectCompactionResidue(quarantinePath, superseded.transaction_residue_manifest, false);
    if (options.testHooks?.afterN8nTransactionCompactionMove) {
      options.testHooks.afterN8nTransactionCompactionMove({
        generation_id: superseded.generation_id,
        terminal_record_digest: superseded.terminal_record_digest
      });
    }
  }
  if (!pathExists(quarantinePath)) {
    return Object.freeze({ compacted: true, reason: 'already-absent' });
  }
  for (;;) {
    const residue = inspectCompactionResidue(
      quarantinePath,
      superseded.transaction_residue_manifest,
      true
    );
    const entry = residue.entries[0];
    if (!entry) break;
    if (options.testHooks?.beforeN8nTransactionCompactionDelete) {
      options.testHooks.beforeN8nTransactionCompactionDelete({
        generation_id: superseded.generation_id,
        relative_path: entry.relative_path
      });
    }
    const final = inspectCompactionResidue(
      quarantinePath,
      superseded.transaction_residue_manifest,
      true
    ).entries.find((candidate) => candidate.relative_path === entry.relative_path);
    if (!final || final.bytes_sha256 !== entry.bytes_sha256) {
      throw journalError('journal-compaction-drift', 'Checkpointed transaction residue changed at its deletion boundary');
    }
    fs.unlinkSync(entry.absolute_path);
    if (options.testHooks?.afterN8nTransactionCompactionDelete) {
      options.testHooks.afterN8nTransactionCompactionDelete({
        generation_id: superseded.generation_id,
        relative_path: entry.relative_path
      });
    }
  }
  fs.rmdirSync(path.join(quarantinePath, 'segments'));
  fs.rmdirSync(quarantinePath);
  fsyncDirectoryIfSupported(authority.paths.transactions);
  return Object.freeze({ compacted: true, reason: 'checkpointed-transaction-removed' });
}

function discoverN8nRepairJournalsForTarget({ codexHome, targetPath, write = false }) {
  const targetPaths = journalPaths(
    codexHome,
    targetPath,
    '00000000-0000-0000-0000-000000000000'
  );
  if (!pathExists(targetPaths.transactions)) return Object.freeze([]);
  requireOrdinaryDirectory(targetPaths.target, 'repair target journal directory');
  requireOrdinaryDirectory(targetPaths.transactions, 'repair transaction journal directory');
  if (pathExists(targetPaths.checkpoints)) {
    const initialCheckpoints = checkpointInventory(targetPaths.checkpoints);
    if (!write && (initialCheckpoints.active.length > 2 || initialCheckpoints.retired.length)) {
      throw journalError(
        'journal-checkpoint-maintenance-required',
        'Checkpoint retention has an exact restart prefix requiring approved write recovery'
      );
    }
    const recoveredCheckpoints = write
      ? resumeCheckpointRetention(targetPaths.checkpoints, initialCheckpoints)
      : initialCheckpoints;
    const latest = recoveredCheckpoints.active.at(-1);
    if (write && latest?.frame.payload?.superseded_checkpoint) {
      compactSupersededTransaction(
        { paths: targetPaths },
        { digest: latest.frame.complete_digest }
      );
    }
  }
  const names = fs.readdirSync(targetPaths.transactions)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (names.length > JOURNAL_MAX_TERMINAL_ENTRIES + 2) {
    throw journalError('journal-hard-limit', 'The target has too many retained transaction authorities');
  }
  const result = [];
  for (const generationId of names) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationId)) {
      throw journalError('journal-compaction-pending', 'The target journal contains unretired physical compaction residue');
    }
    const paths = journalPaths(codexHome, targetPath, generationId);
    ensureJournalPaths(paths, false);
    const preliminary = scanSegmentDirectory(paths, generationId, '');
    const token = preliminary.records[0]?.payload?.ownership_token;
    if (
      preliminary.records[0]?.kind !== 'M00_V1_MIGRATION'
      || !/^[0-9a-f]{48}$/i.test(String(token || ''))
      || transactionTokenDigest(token) !== preliminary.ownership_token_digest
    ) {
      throw journalError('journal-authority-invalid', 'A retained transaction journal cannot prove its exact ownership token');
    }
    result.push(bindJournalAuthority({
      codexHome,
      generationId,
      ownershipToken: token,
      targetPath,
      write: false
    }));
  }
  return Object.freeze(result);
}

module.exports = {
  JOURNAL_HARD_RESIDUE_BYTES,
  JOURNAL_HARD_RESIDUE_ENTRIES,
  JOURNAL_HEADER_BYTES,
  JOURNAL_MAX_ACTIVE_BYTES,
  JOURNAL_MAX_ACTIVE_SEGMENTS,
  JOURNAL_MAX_CHECKPOINT_BYTES,
  JOURNAL_MAX_PAYLOAD_BYTES,
  JOURNAL_MAX_RECORD_BYTES,
  JOURNAL_MAX_RESCUE_ATTEMPTS,
  JOURNAL_MAX_TARGET_BYTES,
  JOURNAL_MAX_TARGET_ENTRIES,
  JOURNAL_MAX_TERMINAL_BYTES,
  JOURNAL_MAX_TERMINAL_ENTRIES,
  JOURNAL_SCHEMA,
  JOURNAL_SOFT_RESIDUE_BYTES,
  JOURNAL_SOFT_RESIDUE_ENTRIES,
  JOURNAL_SUPPORTED_NODE_MAJORS,
  JOURNAL_TRAILER_BYTES,
  LEGAL_SUCCESSORS,
  RECORD_KINDS,
  appendLogicalRetirement,
  appendN8nRepairJournalRecord,
  assertJournalAuthorityUnchanged,
  bindJournalAuthority,
  canonicalJson,
  compactSupersededTransaction,
  decodeFrame,
  discoverN8nRepairJournalsForTarget,
  encodeFrame,
  inspectN8nRepairJournal,
  journalPaths,
  logicalRetirementManifest,
  openN8nRepairJournal,
  residueManifest,
  revalidateLogicalRetirement,
  sha256,
  targetIdFor,
  targetJournalUsage,
  writeTerminalCheckpoint
};
