'use strict';

// Retired Toolkit direct-launch reservation and supervision machinery.
//
// The Toolkit direct (`toolkit-direct`) Claude worker/checker topology is retired
// (Web decision WEB-TK421-D1-OWNER-CORE-CLEANUP-PROMOTION-20261018-28). This module
// keeps only what the byte-pinned historical Run-093/094 reclosure proof
// (repo/tests/toolkit-c1-run093-reclosure.test.cjs) exercises: native and
// repository-test resource admission, sealed reservation provenance, supervisor
// claims and the supervisor process itself. It cannot start a model:
// - the host profile store never yields a direct profile, so admission needs a
//   caller-held historical profile object;
// - admission and the supervisor accept only the verified harmless run093 fixture
//   worker, which writes two fixed lines to a witness file in the control root;
// - `launch` and `checkerWorkflow` always refuse with zero effects.
// It also holds, never prunes or releases, a sealed mode-0 reservation left by the
// historical R093-F5 controller run, so an unresolved effect is not replayed.
//
// Owner: R1 #499. Removal condition: the owner retires the run093 reclosure proof;
// then delete this module and the historical exports of toolkit-agent-control.cjs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { types: utilTypes } = require('node:util');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const processLaunch = require('./claude-process-launch.cjs');
const control = require('./toolkit-agent-control.cjs');

const SCHEMA = control.SCHEMA;
const CONTROL_VERSION = control.CONTROL_VERSION;
const RESOURCE_PROVENANCE_SCHEMA = 'toolkit.agent-control.resource-provenance.v1';
// Recognised only so a sealed historical mode-0 reservation is held, never pruned or released.
const RESOURCE_PROVENANCE_SCHEMA_V2 = 'toolkit.agent-control.resource-provenance.v2';
const RESOURCE_PROVENANCE_KEY_FILE = 'resource-provenance.key';
const SUPERVISOR_CLAIM_SCHEMA = 'toolkit.agent-control.supervisor-claim.v1';
const SUPERVISOR_CLAIM_DIRECTORY = 'supervisor-claims';
const MAX_ACTIVE_SUPERVISOR_CLAIMS = 1024;
const RESOURCE_PRODUCTION_ADMISSION = Symbol('native-resource-admission');
const RESULTS = Object.freeze({ START: 'start', QUEUE: 'queue', REFUSE: 'refuse-root-only' });
const CHECKER_RESULTS = Object.freeze({ PASS: 'PASS', FINDINGS: 'FINDINGS', ADMISSION_DENIED: 'ADMISSION_DENIED' });
const HOSTS = Object.freeze({ CLAUDE: 'claude-code' });
const ROLES = Object.freeze({ WORKER: 'worker', CHECKER: 'checker' });
// Historical wire value of the retired profile topology; the profile store rejects it.
const DIRECT_TOPOLOGY = control.TOPOLOGIES.CLAUDE_DIRECT;
const RESERVATION_TOPOLOGY = 'toolkit-controlled-direct';
const CAPACITY_MODES = control.CAPACITY_MODES;
const GIB = 1024 ** 3;
const RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;
const QUEUE_TTL_MS = 10 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000;
const MAX_QUEUE = control.MAX_QUEUE;
const EMERGENCY_WORKER_CEILING = control.EMERGENCY_WORKER_CEILING;
const MIN_WORKER_COST = GIB;
const MAX_WORKER_COST = 16 * GIB;
const MAX_MANUAL_WORKERS = 64;
const MAX_PROMPT_BYTES = 1024 * 1024;
const REPOSITORY_TEST_RESOURCE_INVOCATION = 'toolkit.repository-test.resource.v1';
const RESOURCE_TEST_CONTEXT = new AsyncLocalStorage();
const NATIVE_RESOURCE_STATES = new WeakSet();
const TEST_RESOURCE_STATES = new WeakSet();
const REPOSITORY_TEST_RESOURCE_FIXTURE = Object.freeze({
  source: 'repository-test-fixture',
  fixture_id: 'healthy-resource-v1',
  physical_total: 17179869184,
  physical_available: 8589934592,
  commit_total: 34359738368,
  commit_available: 17179869184,
  host_responsive: true,
});
const FIXTURE_WORKER_NAME = 'fake-claude.cjs';
const FIXTURE_WITNESS_NAME = 'worker-witness.log';
const FIXTURE_WORKER_MAX_BYTES = 4096;
const FIXTURE_WORKER_MAX_DELAY_MS = 5000;
const RETIRED_REASON = 'The Toolkit direct worker and checker launcher is retired; continue with the root agent or the registry-pinned V3 launcher.';

function controlRoot(options = {}) {
  const testContext = RESOURCE_TEST_CONTEXT.getStore();
  if (testContext) return testContext.root;
  return path.resolve(options.root || process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control'));
}

function statePath(options = {}) { return path.join(controlRoot(options), 'state.json'); }
function lockPath(options = {}) { return path.join(controlRoot(options), 'state.lock'); }
function lockRecoveryPath(options = {}) { return `${lockPath(options)}.recovery`; }

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
  verifyPrivateRegularFile(filePath);
}

function verifyPrivateRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Private Toolkit artifact is not a regular file.');
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) throw new Error('Private Toolkit artifact permissions are not restrictive.');
  return stat;
}

function createPrivateFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    if (content !== '') fs.writeFileSync(fd, content, { encoding: 'utf8' });
    fs.fchmodSync(fd, 0o600);
  } finally { fs.closeSync(fd); }
  verifyPrivateRegularFile(filePath);
}

function resourceProvenanceKey(options = {}, create = false) {
  const filePath = path.join(controlRoot(options), RESOURCE_PROVENANCE_KEY_FILE);
  try {
    verifyPrivateRegularFile(filePath);
    const encoded = fs.readFileSync(filePath, 'utf8').trim();
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) return null;
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) return null;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const key = crypto.randomBytes(32);
  const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(fd, `${key.toString('base64')}\n`, { encoding: 'utf8' });
    fs.fchmodSync(fd, 0o600);
  } finally { fs.closeSync(fd); }
  verifyPrivateRegularFile(filePath);
  return key;
}

function sortResourceValue(value) {
  if (Array.isArray(value)) return value.map(sortResourceValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortResourceValue(value[key])]));
}

function resourceProvenanceMac(kind, entry, key) {
  const provenance = entry.producer_provenance;
  if (!provenance || typeof provenance !== 'object') return '';
  const { mac: _mac, ...producerProvenance } = provenance;
  const { producer_provenance: _producerProvenance, ...entryBody } = entry;
  const payload = JSON.stringify(sortResourceValue({ kind, entry: entryBody, producer_provenance: producerProvenance }));
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

function exactResourceKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000'));
}

function sealResourceProvenance(kind, entry, origin, resourceSource, jobIdentityDigest, options = {}, suppliedKey = undefined) {
  const key = suppliedKey || resourceProvenanceKey(options, true);
  if (!key) throw new Error('Resource provenance could not be persisted safely.');
  const existingAdmissionId = entry.producer_provenance?.schema === RESOURCE_PROVENANCE_SCHEMA
    ? entry.producer_provenance.admission_id : null;
  entry.producer_provenance = {
    schema: RESOURCE_PROVENANCE_SCHEMA,
    origin,
    resource_source: resourceSource,
    admission_id: existingAdmissionId || crypto.randomUUID(),
    job_identity_digest: jobIdentityDigest,
    mac: '',
  };
  entry.producer_provenance.mac = resourceProvenanceMac(kind, entry, key);
  return entry;
}

// A sealed mode-0 (v2) entry never validates here, so any state holding one is
// refused as a whole and left byte-for-byte unchanged.
function validResourceProvenance(kind, entry, key) {
  const provenance = entry && entry.producer_provenance;
  if (!provenance || typeof provenance !== 'object'
    || !exactResourceKeys(provenance, ['admission_id','job_identity_digest','mac','origin','resource_source','schema'])
    || provenance.schema !== RESOURCE_PROVENANCE_SCHEMA
    || !['native', 'repository-test'].includes(provenance.origin)
    || (provenance.origin === 'native' && !['proc-meminfo', 'win32-operating-system'].includes(provenance.resource_source))
    || (provenance.origin === 'repository-test' && provenance.resource_source !== REPOSITORY_TEST_RESOURCE_FIXTURE.source)
    || typeof entry.worker_executable !== 'string'
    || !/^[a-f0-9-]{36}$/.test(provenance.admission_id || '')
    || !/^[a-f0-9]{64}$/.test(provenance.job_identity_digest || '')
    || !/^[a-f0-9]{64}$/.test(provenance.mac || '')
    || !key) return false;
  const expected = Buffer.from(resourceProvenanceMac(kind, entry, key), 'hex');
  const actual = Buffer.from(provenance.mac, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function validStateResourceProvenance(state, options = {}, suppliedKey = undefined) {
  const entries = [
    ...state.reservations.map((entry) => ['reservation', entry]),
    ...state.queue.map((entry) => ['queue', entry]),
  ];
  if (entries.length === 0) return true;
  const key = suppliedKey || resourceProvenanceKey(options, false);
  return Boolean(key && entries.every(([kind, entry]) => validResourceProvenance(kind, entry, key)));
}

function supervisorClaimMac(record, key) {
  const { mac: _mac, ...payload } = record;
  return crypto.createHmac('sha256', key)
    .update(JSON.stringify(sortResourceValue(payload)), 'utf8')
    .digest('hex');
}

function validSupervisorClaimMarker(record, key) {
  if (!record || typeof record !== 'object'
    || Object.keys(record).sort().join('\u0000') !== ['admission_id', 'claimed_at_ms', 'expires_at_ms', 'job_identity_digest', 'mac', 'owner_pid', 'reservation_id', 'schema'].sort().join('\u0000')
    || record.schema !== SUPERVISOR_CLAIM_SCHEMA
    || !/^[a-f0-9-]{36}$/.test(record.reservation_id || '')
    || !/^[a-f0-9-]{36}$/.test(record.admission_id || '')
    || !/^[a-f0-9]{64}$/.test(record.job_identity_digest || '')
    || !Number.isSafeInteger(record.claimed_at_ms) || record.claimed_at_ms <= 0
    || !Number.isSafeInteger(record.expires_at_ms) || record.expires_at_ms < record.claimed_at_ms
    || !Number.isSafeInteger(record.owner_pid) || record.owner_pid <= 0
    || !/^[a-f0-9]{64}$/.test(record.mac || '') || !key) return false;
  const expected = Buffer.from(supervisorClaimMac(record, key), 'hex');
  const actual = Buffer.from(record.mac, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function inspectSupervisorClaimMarkers(options, reservationId, admissionId, key, now) {
  const directory = path.join(controlRoot(options), SUPERVISOR_CLAIM_DIRECTORY);
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return { ok: true, count: 0, claimed: false };
    return { ok: false, count: 0, claimed: false };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, count: 0, claimed: false };
  let names;
  try { names = fs.readdirSync(directory); } catch (_) { return { ok: false, count: 0, claimed: false }; }
  let count = 0;
  for (const name of names) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) return { ok: false, count: 0, claimed: false };
    const filePath = path.join(directory, name);
    let record;
    try {
      verifyPrivateRegularFile(filePath);
      record = readJson(filePath);
    } catch (_) { return { ok: false, count: 0, claimed: false }; }
    if (!validSupervisorClaimMarker(record, key) || name !== `${record.reservation_id}.json`) {
      return { ok: false, count: 0, claimed: false };
    }
    if (record.expires_at_ms <= now) {
      try { fs.unlinkSync(filePath); } catch (_) { return { ok: false, count: 0, claimed: false }; }
      continue;
    }
    count += 1;
    if (record.reservation_id === reservationId || record.admission_id === admissionId) {
      return { ok: true, count, claimed: true };
    }
  }
  return { ok: true, count, claimed: false };
}

function persistSupervisorClaimMarker(entry, options, key, now) {
  const directory = path.join(controlRoot(options), SUPERVISOR_CLAIM_DIRECTORY);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    fs.chmodSync(directory, 0o700);
    const record = {
      schema: SUPERVISOR_CLAIM_SCHEMA,
      reservation_id: entry.id,
      admission_id: entry.producer_provenance.admission_id,
      job_identity_digest: entry.job_identity_digest,
      claimed_at_ms: now,
      expires_at_ms: entry.expires_at_ms,
      owner_pid: process.pid,
      mac: '',
    };
    record.mac = supervisorClaimMac(record, key);
    const filePath = path.join(directory, `${entry.id}.json`);
    createPrivateFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
    return true;
  } catch (_) { return false; }
}

function resourceJobIdentityDigest(spec, workerExecutable = '') {
  const identity = { ...spec };
  delete identity.queue_id;
  delete identity.child_prompt_base64;
  delete identity.estimated_memory_bytes;
  delete identity.tasks_separable;
  delete identity.concurrent_execution_possible;
  delete identity.expected_wall_clock_speedup;
  delete identity.root_retains_longest_or_critical_path;
  delete identity.child_task_is_shorter_or_easier;
  delete identity.root_productive_work_declared;
  identity.child_prompt = Buffer.from(String(spec.child_prompt || spec.child_responsibility), 'utf8').toString('utf8');
  identity.worker_executable = String(workerExecutable || '');
  return crypto.createHash('sha256').update(JSON.stringify(sortResourceValue(identity)), 'utf8').digest('hex');
}

function resourceOrigin(resources, context) {
  if (NATIVE_RESOURCE_STATES.has(resources)) return 'native';
  if (TEST_RESOURCE_STATES.has(resources) && context) return 'repository-test';
  return null;
}

function resourceDataCopy(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('Resource evidence is malformed.');
    return value;
  }
  if (typeof value === 'object' || typeof value === 'function') {
    try { if (utilTypes.isProxy(value)) throw new Error('Resource evidence is malformed.'); }
    catch (_) { throw new Error('Resource evidence is malformed.'); }
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('Resource evidence is malformed.');
  seen.add(value);
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('Resource evidence is malformed.');
    if (array) {
      if (prototype !== Array.prototype && prototype !== null) throw new Error('Resource evidence is malformed.');
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (!length || !Object.hasOwn(length, 'value') || length.enumerable || !Number.isSafeInteger(length.value) || length.value < 0) throw new Error('Resource evidence is malformed.');
      const result = new Array(length.value);
      for (const name of names) {
        if (name === 'length') continue;
        if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= length.value) throw new Error('Resource evidence is malformed.');
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('Resource evidence is malformed.');
      }
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('Resource evidence is malformed.');
        Object.defineProperty(result, String(index), { value: resourceDataCopy(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new Error('Resource evidence is malformed.');
    const result = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('Resource evidence is malformed.');
      Object.defineProperty(result, name, { value: resourceDataCopy(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
    }
    return result;
  } finally { seen.delete(value); }
}

function resourceOptionShell(options = {}) {
  if (options === null || typeof options !== 'object') throw new Error('Resource options are malformed.');
  try { if (utilTypes.isProxy(options)) throw new Error('Resource options are malformed.'); }
  catch (_) { throw new Error('Resource options are malformed.'); }
  if (Array.isArray(options)) throw new Error('Resource options are malformed.');
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Resource options are malformed.');
  const names = Object.getOwnPropertyNames(options);
  if (Object.getOwnPropertySymbols(options).length > 0) throw new Error('Resource options are malformed.');
  const result = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('Resource options are malformed.');
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function withRepositoryTestResourceInvocation(invocation, root, callback) {
  let trustedInvocation;
  try { trustedInvocation = resourceDataCopy(invocation); }
  catch (_) { throw new Error('Repository-test resource invocation is invalid.'); }
  if (!trustedInvocation || typeof trustedInvocation !== 'object'
    || Object.keys(trustedInvocation).sort().join('\u0000') !== ['fixture_id', 'invocation'].join('\u0000')
    || trustedInvocation.invocation !== REPOSITORY_TEST_RESOURCE_INVOCATION
    || trustedInvocation.fixture_id !== REPOSITORY_TEST_RESOURCE_FIXTURE.fixture_id
    || typeof callback !== 'function') throw new Error('Repository-test resource invocation is invalid.');
  if (typeof root !== 'string' || typeof callback !== 'function') throw new Error('Repository-test resource invocation is invalid.');
  const target = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(target) !== tempRoot) throw new Error('Repository-test resource root must be a direct owned temporary directory.');
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Repository-test resource root must be a real temporary directory.');
  const context = Object.freeze({
    invocation: Object.freeze(trustedInvocation),
    root: target,
    fixture: REPOSITORY_TEST_RESOURCE_FIXTURE,
  });
  return RESOURCE_TEST_CONTEXT.run(context, callback);
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

function validLockOwner(owner) {
  return Boolean(owner && Number.isSafeInteger(owner.pid) && owner.pid > 0
    && Number.isSafeInteger(owner.created_at_ms) && owner.created_at_ms > 0);
}

function readLockOwner(target) {
  const ownerPath = path.join(target, 'owner.json');
  try {
    verifyPrivateRegularFile(ownerPath);
    return readJson(ownerPath);
  } catch { return null; }
}

function recoverStaleRecoveryMarker(options = {}) {
  const recovery = lockRecoveryPath(options);
  let stat;
  try { stat = fs.lstatSync(recovery); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Agent admission recovery marker is not a regular directory.');
  const owner = readLockOwner(recovery);
  if (Number.isSafeInteger(owner?.pid) && owner.pid > 0 && pidAlive(owner.pid)) return false;
  const timestamp = validLockOwner(owner) ? owner.created_at_ms : stat.mtimeMs;
  if (!Number.isFinite(timestamp) || Date.now() - timestamp <= LOCK_TTL_MS) return false;
  fs.rmSync(recovery, { recursive: true, force: true });
  return true;
}

function acquireRecoveryMarker(options = {}) {
  const recovery = lockRecoveryPath(options);
  for (;;) {
    try {
      const token = crypto.randomUUID();
      fs.mkdirSync(recovery, { mode: 0o700 });
      fs.chmodSync(recovery, 0o700);
      try {
        atomicWriteJson(path.join(recovery, 'owner.json'), { pid: process.pid, created_at_ms: Date.now(), token });
      } catch (error) {
        fs.rmSync(recovery, { recursive: true, force: true });
        throw error;
      }
      return () => {
        const owner = readLockOwner(recovery);
        if (owner?.pid === process.pid && owner?.token === token) fs.rmSync(recovery, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!recoverStaleRecoveryMarker(options)) return null;
    }
  }
}

function recoverStaleLock(options = {}) {
  const target = lockPath(options);
  const recovery = lockRecoveryPath(options);
  const releaseRecovery = acquireRecoveryMarker(options);
  if (!releaseRecovery) return false;
  try {
    let stat;
    try { stat = fs.lstatSync(target); }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Agent admission lock is not a regular directory.');
    const owner = readLockOwner(target);
    if (Number.isSafeInteger(owner?.pid) && owner.pid > 0 && pidAlive(owner.pid)) return false;
    const timestamp = validLockOwner(owner) ? owner.created_at_ms : stat.mtimeMs;
    if (!Number.isFinite(timestamp) || Date.now() - timestamp <= LOCK_TTL_MS) return false;
    const displaced = path.join(recovery, 'stale-lock');
    fs.renameSync(target, displaced);
    fs.rmSync(displaced, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  } finally {
    releaseRecovery();
  }
}

function acquireLock(options = {}) {
  const root = controlRoot(options);
  const target = lockPath(options);
  fs.mkdirSync(root, { recursive: true });
  const deadline = Date.now() + (options.lockWaitMs || 5000);
  for (;;) {
    if (fs.existsSync(lockRecoveryPath(options))) {
      if (recoverStaleRecoveryMarker(options)) continue;
      if (Date.now() >= deadline) throw new Error('Agent admission is temporarily busy; retry without launching a worker.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      continue;
    }
    try {
      const token = crypto.randomUUID();
      fs.mkdirSync(target, { mode: 0o700 });
      fs.chmodSync(target, 0o700);
      if (fs.existsSync(lockRecoveryPath(options))) {
        fs.rmSync(target, { recursive: true, force: true });
        continue;
      }
      try {
        atomicWriteJson(path.join(target, 'owner.json'), { pid: process.pid, created_at_ms: Date.now(), token });
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        throw error;
      }
      return () => {
        const owner = readLockOwner(target);
        if (owner?.pid === process.pid && owner?.token === token) fs.rmSync(target, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (recoverStaleLock(options)) continue;
      if (Date.now() >= deadline) throw new Error('Agent admission is temporarily busy; retry without launching a worker.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function withLock(options, action) {
  const release = acquireLock(options);
  try { return action(); }
  finally { release(); }
}

function emptyState() { return { schema: SCHEMA, reservations: [], queue: [], checker_reviews: [] }; }

function validReservation(entry) {
  return Boolean(entry && typeof entry === 'object'
    && typeof entry.id === 'string' && entry.id.length > 0
    && Object.values(HOSTS).includes(entry.host) && [RESERVATION_TOPOLOGY, DIRECT_TOPOLOGY].includes(entry.topology) && entry.depth === 1
    && (entry.role === undefined || Object.values(ROLES).includes(entry.role))
    && Number.isSafeInteger(entry.owner_pid) && entry.owner_pid > 0
    && Number.isSafeInteger(entry.created_at_ms) && Number.isSafeInteger(entry.expires_at_ms)
    && entry.created_at_ms > 0 && entry.expires_at_ms >= entry.created_at_ms
    && Number.isSafeInteger(entry.estimated_memory_bytes)
    && entry.estimated_memory_bytes >= MIN_WORKER_COST && entry.estimated_memory_bytes <= MAX_WORKER_COST
    && ['medium', 'high', 'xhigh', 'max'].includes(entry.effort) && ['reserved', 'running'].includes(entry.status));
}

function validQueueEntry(entry) {
  return Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length > 0
    && Object.values(HOSTS).includes(entry.host) && (entry.role === undefined || Object.values(ROLES).includes(entry.role)) && entry.status === RESULTS.QUEUE
    && Number.isSafeInteger(entry.created_at_ms) && Number.isSafeInteger(entry.expires_at_ms)
    && entry.created_at_ms > 0 && entry.expires_at_ms >= entry.created_at_ms);
}

function validCheckerReview(entry) {
  return Boolean(entry && typeof entry === 'object'
    && typeof entry.review_id === 'string' && entry.review_id.trim().length > 0
    && Number.isSafeInteger(entry.admitted_at_ms) && entry.admitted_at_ms > 0
    && Number.isSafeInteger(entry.expires_at_ms) && entry.expires_at_ms >= entry.admitted_at_ms
    && (entry.status === undefined || ['pending', 'completed'].includes(entry.status))
    && (entry.reservation_id === undefined || (typeof entry.reservation_id === 'string' && entry.reservation_id.length > 0))
    && (entry.result === undefined || [CHECKER_RESULTS.PASS, CHECKER_RESULTS.FINDINGS].includes(entry.result))
    && (entry.findings_count === undefined || (Number.isSafeInteger(entry.findings_count) && entry.findings_count >= 0))
    && (entry.findings === undefined || (Array.isArray(entry.findings) && entry.findings.every((finding) => finding && typeof finding.file === 'string'
      && finding.file.length > 0 && typeof finding.evidence === 'string' && finding.evidence.length >= 12)))
    && (entry.reason === undefined || typeof entry.reason === 'string')
    && (entry.status !== 'pending' || (entry.result === undefined && entry.findings_count === undefined
      && entry.findings === undefined && entry.reason === undefined)));
}

function validControlState(raw) {
  if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.reservations) || !Array.isArray(raw.queue)
    || (raw.checker_reviews !== undefined && !Array.isArray(raw.checker_reviews))
    || !raw.reservations.every(validReservation) || !raw.queue.every(validQueueEntry)
    || !(raw.checker_reviews || []).every(validCheckerReview)) return false;
  const ids = [...raw.reservations, ...raw.queue].map((entry) => entry.id);
  const reviewIds = (raw.checker_reviews || []).map((entry) => entry.review_id);
  return new Set(ids).size === ids.length && new Set(reviewIds).size === reviewIds.length;
}

function sanitizeState(raw) {
  if (!validControlState(raw)) return emptyState();
  return {
    schema: SCHEMA,
    reservations: raw.reservations.map((entry) => ({ ...entry })),
    queue: raw.queue.map((entry) => ({ ...entry })),
    checker_reviews: (raw.checker_reviews || []).map((entry) => ({ ...entry })),
  };
}

function readMutableControlState(options = {}) {
  const filePath = statePath(options);
  if (!fs.existsSync(filePath)) return { exists: false, state: emptyState() };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return { exists: true, state: null }; }
  return { exists: true, state: validControlState(raw) ? sanitizeState(raw) : null };
}

function recoverState(state, now = Date.now()) {
  state.reservations = state.reservations.filter((entry) => {
    if (entry.producer_provenance?.schema === RESOURCE_PROVENANCE_SCHEMA_V2) return true;
    const expired = Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms <= now;
    return !(expired && (entry.status === 'reserved' || !pidAlive(entry.owner_pid)));
  });
  state.queue = state.queue.filter((entry) => Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms > now)
    .map((entry) => entry.role === undefined ? { ...entry, role: ROLES.WORKER } : entry);
  const activeReservationIds = new Set(state.reservations.map((entry) => entry.id));
  state.checker_reviews = (state.checker_reviews || []).filter((entry) => {
    if (!Number.isFinite(entry.expires_at_ms) || entry.expires_at_ms <= now) return false;
    return entry.status !== 'pending' || (typeof entry.reservation_id === 'string' && activeReservationIds.has(entry.reservation_id));
  });
  return state;
}

function effectiveEnvironment(options = {}) {
  return Object.prototype.hasOwnProperty.call(options, 'env') ? options.env : process.env;
}

function effectiveClaudeCommand(profile, options = {}) {
  return processLaunch.resolveClaudeCommandInput({
    explicit: options.claudeCli,
    persisted: profile?.claude_cli,
    env: effectiveEnvironment(options),
  });
}

function childLaunchRefusal(options = {}) {
  return effectiveEnvironment(options)?.AI_AGENT_TOOLKIT_CHILD === '1'
    ? refusal('Toolkit-managed children cannot launch further workers.')
    : null;
}

function verifyCurrentClaudeEnforcement(profile, options = {}) {
  const env = effectiveEnvironment(options);
  const current = require('./setup-claude-toolkit-plugin.cjs').verifyCurrentInstalledEnforcement(profile.activation_proof, {
    claudeCommand: effectiveClaudeCommand(profile, options), env,
  });
  return Boolean(current?.verified === true && control.validActivationProof(current.activation_proof)
    && ['schema', 'source', 'plugin_version', 'cache_identity', 'hook_sha256', 'controller_sha256', 'process_launch_sha256', 'agent_hook_sha256']
      .every((key) => current.activation_proof[key] === profile.activation_proof?.[key]));
}

function nativeResourceState(value, source) {
  const state = Object.freeze({
    physical_total: value.physical_total,
    physical_available: value.physical_available,
    commit_total: value.commit_total,
    commit_available: value.commit_available,
    source,
    host_responsive: value.host_responsive === true,
  });
  if (!validResourceState(state) || !['proc-meminfo', 'win32-operating-system'].includes(state.source)) return null;
  NATIVE_RESOURCE_STATES.add(state);
  return state;
}

function parseLinuxMeminfoCounters(before, text, after) {
  if (![0, 1, 2].includes(before) || ![0, 1, 2].includes(after) || before !== after) {
    throw new Error('Linux overcommit mode is unavailable, unsupported, or changed during observation.');
  }
  if (typeof text !== 'string') throw new Error('Linux memory counters are unavailable.');
  const required = new Set(['MemTotal', 'MemAvailable', 'CommitLimit', 'Committed_AS']);
  const raw = Object.create(null);
  for (const line of text.split('\n')) {
    const header = /^(\w+):/.exec(line);
    if (!header || !required.has(header[1])) continue;
    if (Object.hasOwn(raw, header[1])) throw new Error('Linux memory counters are duplicate or malformed.');
    const match = /^(\w+):\s+([0-9]+)\s+(\S+)\s*$/.exec(line);
    if (!match || match[1] !== header[1] || match[3] !== 'kB') throw new Error('Linux memory counters are duplicate or malformed.');
    raw[header[1]] = match[2];
  }
  if ([...required].some((key) => !Object.hasOwn(raw, key))) throw new Error('Linux memory counters are incomplete.');
  const bytes = (name) => {
    const value = BigInt(raw[name]) * 1024n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Linux memory counter exceeds exact integer range.');
    return value;
  };
  const total = bytes('MemTotal');
  const available = bytes('MemAvailable');
  const commitTotal = bytes('CommitLimit');
  const committed = bytes('Committed_AS');
  const commitAvailable = commitTotal - committed;
  if (total < 1n || available < 0n || available > total
    || commitAvailable < -BigInt(Number.MAX_SAFE_INTEGER) || commitAvailable > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Linux memory counter relationships are invalid.');
  }
  return {
    physical_total: Number(total), physical_available: Number(available), commit_total: Number(commitTotal),
    commit_available: Number(commitAvailable), overcommit_mode: before, raw_counters: { ...raw },
  };
}

function linuxResources() {
  const readMode = () => {
    const raw = fs.readFileSync('/proc/sys/vm/overcommit_memory', 'utf8');
    if (!/^[012](?:\n)?$/.test(raw)) throw new Error('Linux overcommit mode is malformed.');
    return Number(raw.trim());
  };
  const before = readMode();
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const after = readMode();
  const counters = parseLinuxMeminfoCounters(before, text, after);
  return nativeResourceState({
    physical_total: counters.physical_total,
    physical_available: counters.physical_available,
    commit_total: counters.commit_total,
    commit_available: counters.commit_available,
    host_responsive: true,
  }, 'proc-meminfo');
}

function windowsResources() {
  const command = '$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{physical_total=[double]$o.TotalVisibleMemorySize*1024;physical_available=[double]$o.FreePhysicalMemory*1024;commit_total=[double]$o.TotalVirtualMemorySize*1024;commit_available=[double]$o.FreeVirtualMemory*1024}|ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error('Windows memory counters are unavailable.');
  return nativeResourceState({ ...JSON.parse(result.stdout), host_responsive: true }, 'win32-operating-system');
}

function testResourceFixture(value) {
  if (!value || typeof value !== 'object'
    || Object.keys(value).sort().join('\u0000') !== ['commit_available', 'commit_total', 'fixture_id', 'host_responsive', 'physical_available', 'physical_total', 'source'].join('\u0000')
    || value.source !== REPOSITORY_TEST_RESOURCE_FIXTURE.source
    || value.fixture_id !== REPOSITORY_TEST_RESOURCE_FIXTURE.fixture_id
    || value.physical_total !== REPOSITORY_TEST_RESOURCE_FIXTURE.physical_total
    || value.physical_available !== REPOSITORY_TEST_RESOURCE_FIXTURE.physical_available
    || value.commit_total !== REPOSITORY_TEST_RESOURCE_FIXTURE.commit_total
    || value.commit_available !== REPOSITORY_TEST_RESOURCE_FIXTURE.commit_available
    || value.host_responsive !== true) return false;
  return true;
}

function selectResourceEvidence(options = {}, positionalProvided = false, positionalResources = undefined) {
  let selected;
  try { selected = resourceOptionShell(options); } catch (_) { return { ok: false, resources: null, options: {} }; }
  if (['resource_origin', 'resourceOrigin', 'resource_provenance', 'resourceProvenance', 'producer_provenance']
    .some((key) => Object.hasOwn(selected, key))) return { ok: false, resources: null, options: selected };
  const context = RESOURCE_TEST_CONTEXT.getStore();
  const invocationKeys = ['repository_test_invocation', 'repositoryTestInvocation'];
  const invocationPresent = invocationKeys.filter((key) => Object.hasOwn(selected, key));
  if (invocationPresent.length > 1) return { ok: false, resources: null, options: selected };
  if (invocationPresent.length === 1) {
    let invocation;
    try { invocation = resourceDataCopy(selected[invocationPresent[0]]); }
    catch (_) { return { ok: false, resources: null, options: selected }; }
    if (!context || !invocation || invocation.invocation !== context.invocation.invocation
      || invocation.fixture_id !== context.invocation.fixture_id
      || Object.keys(invocation).sort().join('\u0000') !== 'fixture_id\u0000invocation') {
      return { ok: false, resources: null, options: selected };
    }
  }
  if (Object.hasOwn(selected, 'resource') || Object.hasOwn(selected, 'resources')) return { ok: false, resources: null, options: selected };
  const evidenceKeys = ['resourceState', 'resource_state'];
  const suppliedEvidenceKeys = evidenceKeys.filter((key) => Object.hasOwn(selected, key));
  if (suppliedEvidenceKeys.length > 1) return { ok: false, resources: null, options: selected };
  const hasOptionEvidence = suppliedEvidenceKeys.length === 1;
  if (positionalProvided && hasOptionEvidence) {
    let left;
    let right;
    try { left = resourceDataCopy(positionalResources); right = resourceDataCopy(selected[suppliedEvidenceKeys[0]]); }
    catch (_) { return { ok: false, resources: null, options: selected }; }
    if (!testResourceFixture(left) || !testResourceFixture(right)) return { ok: false, resources: null, options: selected };
  }
  const evidenceProvided = positionalProvided || hasOptionEvidence;
  if (evidenceProvided) {
    if (!context) return { ok: false, resources: null, options: selected };
    let evidence;
    try { evidence = resourceDataCopy(positionalProvided ? positionalResources : selected[suppliedEvidenceKeys[0]]); }
    catch (_) { return { ok: false, resources: null, options: selected }; }
    if (!testResourceFixture(evidence)) return { ok: false, resources: null, options: selected };
    const fixture = Object.freeze({ ...REPOSITORY_TEST_RESOURCE_FIXTURE });
    TEST_RESOURCE_STATES.add(fixture);
    return { ok: true, resources: fixture, options: selected, context };
  }
  return { ok: true, resources: null, options: selected, context };
}

function inspectResources(options = {}) {
  const selected = selectResourceEvidence(options);
  if (!selected.ok) return null;
  if (selected.resources) return selected.resources;
  try {
    if (process.platform === 'win32') return windowsResources();
    if (process.platform === 'linux') return linuxResources();
  } catch { return null; }
  return null;
}

function validResourceState(resources) {
  try { resources = resourceDataCopy(resources); } catch (_) { return false; }
  if (!resources || !['physical_total', 'physical_available', 'commit_total', 'commit_available']
    .every((key) => Number.isSafeInteger(resources[key])) || resources.physical_total < 1
    || resources.physical_available < 0 || resources.physical_available > resources.physical_total
    || resources.commit_total < 0 || resources.commit_available < -Number.MAX_SAFE_INTEGER
    || resources.commit_available > resources.commit_total || resources.host_responsive !== true) return false;
  if (resources.source === 'win32-operating-system') return resources.physical_available > 0
    && resources.commit_total > 0 && resources.commit_available > 0;
  return true;
}

function inspectResourceCapability(options = {}) {
  const resources = inspectResources(options);
  const supported = Boolean(validResourceState(resources)
    && (NATIVE_RESOURCE_STATES.has(resources) || TEST_RESOURCE_STATES.has(resources)
      && RESOURCE_TEST_CONTEXT.getStore()));
  return { supported, source: supported ? resources.source : 'unsupported-or-malformed', resources: supported ? resources : null };
}

function validateLaunchSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('Launch specification is required.');
  const requiredText = ['child_responsibility', 'parent_responsibility', 'integration_plan', 'validation_plan', 'material_benefit'];
  for (const key of requiredText) if (String(spec[key] || '').trim().length < 12) throw new Error(`${key} must declare a meaningful responsibility.`);
  const child = String(spec.child_responsibility).trim().toLowerCase();
  const parent = String(spec.parent_responsibility).trim().toLowerCase();
  if (child === parent || child.includes(parent) || parent.includes(child)) throw new Error('Parent and child responsibilities must be non-overlapping.');
  if (/^(wait|poll|monitor|narrate|idle)\b|wait for (?:the )?(?:child|result)/i.test(parent)) throw new Error('The parent must retain productive work, not waiting or polling.');
  if (spec.delegates_all_substantive_work === true) throw new Error('Every substantive shard cannot be delegated.');
  const role = String(spec.role || ROLES.WORKER);
  const host = String(spec.host || HOSTS.CLAUDE);
  if (role !== ROLES.WORKER) throw new Error(RETIRED_REASON);
  if (!Object.values(HOSTS).includes(host)) throw new Error('Unsupported child host.');
  // Model routes belong to the pinned V3 registry; this retired path carries none.
  if (Object.hasOwn(spec, 'model')) throw new Error(RETIRED_REASON);
  if (spec.tasks_separable !== true) throw new Error('Worker tasks must be genuinely separable.');
  if (spec.concurrent_execution_possible !== true) throw new Error('Worker tasks must be concurrently executable.');
  if (String(spec.expected_wall_clock_speedup || '').trim().length < 12) {
    throw new Error('Worker launch requires a concrete expected wall-clock speedup rationale.');
  }
  if (spec.root_retains_longest_or_critical_path !== true) {
    throw new Error('The root must retain the longest or critical-path task.');
  }
  if (spec.child_task_is_shorter_or_easier !== true) {
    throw new Error('The child task must be shorter or easier than the root retained task.');
  }
  if (spec.root_productive_work_declared !== true) {
    throw new Error('The root must begin and continue productive work while the child runs.');
  }
  const depth = Number(spec.depth ?? 1);
  if (depth !== 1) throw new Error('The direct-only Toolkit profile blocks nested launches.');
  const effort = String(spec.effort || 'medium').toLowerCase();
  if (!['medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Toolkit-controlled children use medium or explicitly justified higher effort.');
  if (effort !== 'medium') {
    if (String(spec.difficult_role || '').trim().length < 5 || String(spec.effort_justification || '').trim().length < 12) {
      throw new Error('Higher effort requires one named difficult role and a narrow current-task justification.');
    }
  }
  return { ...spec, host, role, depth, effort };
}

function refusal(reason) {
  return { result: RESULTS.REFUSE, reason, safe_action: 'Continue with the root agent only; no worker was launched.' };
}

function validAdmissionProfile(profile) {
  if (!profile || ![CAPACITY_MODES.AUTO, CAPACITY_MODES.MANUAL].includes(profile.capacity_mode)) return false;
  return profile.capacity_mode !== CAPACITY_MODES.MANUAL
    || (Number.isSafeInteger(profile.manual_maximum) && profile.manual_maximum >= 1 && profile.manual_maximum <= MAX_MANUAL_WORKERS);
}

function admissionDecision(specInput, options = {}) {
  try {
    specInput = resourceDataCopy(specInput);
    options = resourceOptionShell(options);
  } catch (_) { return refusal('Resource state could not be verified safely.'); }
  const testContext = RESOURCE_TEST_CONTEXT.getStore();
  if (testContext && options.root && path.resolve(options.root) !== testContext.root) return refusal('Repository-test state must remain inside its owned temporary root.');
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  try { spec = validateLaunchSpec(specInput); }
  catch (error) { return refusal(error.message); }
  const host = String(options.host || spec.host || HOSTS.CLAUDE);
  if (!Object.values(HOSTS).includes(host)) return refusal('The requested host adapter is unsupported.');
  if (host !== spec.host) return refusal('The native host adapter does not match the validated child host contract.');
  // The profile store never yields a direct profile; only a caller-held historical one reaches here.
  if (!options.profile) return refusal(RETIRED_REASON);
  let profile;
  try { profile = resourceDataCopy(options.profile); } catch (_) { return refusal('The selected host admission profile could not be verified safely.'); }
  if (profile.capacity_mode === CAPACITY_MODES.ROOT_ONLY) return refusal('The selected host profile is root-only and cannot admit a child.');
  if (!validAdmissionProfile(profile)) return refusal('The selected host admission profile could not be verified safely.');
  if (profile.supported !== true || profile.status !== 'configured' || profile.enforcement_verified !== true
    || profile.controller_version !== CONTROL_VERSION || profile.topology !== DIRECT_TOPOLOGY) return refusal('The selected Claude profile is root-only, stale, unsupported, or outside the verified Toolkit launch boundary.');
  if (!verifiedFixtureWorker(effectiveClaudeCommand(profile, options), options)) return refusal(RETIRED_REASON);
  if (!verifyCurrentClaudeEnforcement(profile, options)) return refusal('Current Claude plugin trust, hook activation, and installed enforcement identity could not be verified.');
  const selectedResources = selectResourceEvidence(options);
  if (!selectedResources.ok) return refusal('Resource state could not be verified safely.');
  const resources = selectedResources.resources || inspectResources({});
  if (!validResourceState(resources) || !NATIVE_RESOURCE_STATES.has(resources)
    && !(TEST_RESOURCE_STATES.has(resources) && selectedResources.context)) return refusal('Resource state could not be verified safely.');
  return resourceAdmissionDecisionValidated(spec, profile, resources, options, RESOURCE_PRODUCTION_ADMISSION, selectedResources.context);
}

function resourceAdmissionDecision(specInput, profile, resources, options = {}) {
  const positionalProvided = arguments.length >= 3;
  try {
    specInput = resourceDataCopy(specInput);
    profile = resourceDataCopy(profile);
    options = resourceOptionShell(options);
  } catch (_) { return refusal('Resource state could not be verified safely.'); }
  const testContext = RESOURCE_TEST_CONTEXT.getStore();
  if (testContext && options.root && path.resolve(options.root) !== testContext.root) return refusal('Repository-test state must remain inside its owned temporary root.');
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  try { spec = validateLaunchSpec(specInput); }
  catch (error) { return refusal(error.message); }
  if (!profile || profile.capacity_mode === CAPACITY_MODES.ROOT_ONLY) return refusal('The selected host profile is root-only and cannot admit a child.');
  if (!validAdmissionProfile(profile)) return refusal('The selected host admission profile could not be verified safely.');
  const selectedResources = selectResourceEvidence(options, positionalProvided, resources);
  if (!selectedResources.ok) return refusal('Resource state could not be verified safely.');
  resources = selectedResources.resources || inspectResources({});
  if (!validResourceState(resources) || !NATIVE_RESOURCE_STATES.has(resources)
    && !(TEST_RESOURCE_STATES.has(resources) && selectedResources.context)) return refusal('Resource state could not be verified safely.');
  return resourceAdmissionDecisionValidated(spec, profile, resources, options, null, selectedResources.context);
}

function resourceAdmissionDecisionValidated(spec, profile, resources, options, producerAuthority = null, testContext = null) {
  const host = spec.host;
  const origin = resourceOrigin(resources, testContext);
  if (!origin || origin === 'native' && producerAuthority !== RESOURCE_PRODUCTION_ADMISSION
    || origin === 'repository-test' && !testContext) return refusal('Resource provenance could not be established safely.');
  const workerExecutable = effectiveClaudeCommand(profile, options);
  const jobIdentityDigest = resourceJobIdentityDigest(spec, workerExecutable);
  return withLock(options, () => {
    const now = options.now || Date.now();
    const stateFile = statePath(options);
    const rawState = readJson(stateFile);
    if (fs.existsSync(stateFile) && !validControlState(rawState)) return refusal('Toolkit admission state could not be verified safely.');
    const state = recoverState(sanitizeState(rawState || emptyState()), now);
    const legacyQueueIds = new Set((rawState?.queue || [])
      .filter((entry) => entry && entry.role === undefined && Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms > now)
      .map((entry) => entry.id));
    let provenanceKey = resourceProvenanceKey(options, false);
    if (legacyQueueIds.size > 0) {
      if (origin !== 'repository-test' || !testContext || !spec.queue_id || !legacyQueueIds.has(spec.queue_id)) {
        return refusal('Legacy queue provenance cannot be promoted to native authority.');
      }
      provenanceKey = provenanceKey || resourceProvenanceKey(options, true);
      if (!provenanceKey) return refusal('Resource provenance could not be verified safely.');
      const legacyQueue = state.queue.find((entry) => entry.id === spec.queue_id);
      if (!legacyQueue) return refusal('The legacy queue entry is missing or expired.');
      try { sealResourceProvenance('queue', legacyQueue, 'repository-test', resources.source, jobIdentityDigest, options, provenanceKey); }
      catch (_) { return refusal('Repository-test queue provenance could not be preserved safely.'); }
    }
    if (!validStateResourceProvenance(state, options, provenanceKey)) {
      return refusal('Toolkit reservation or queue provenance could not be verified safely.');
    }
    let reservedBytes = 0;
    for (const entry of state.reservations) {
      if (!validReservation(entry) || reservedBytes > Number.MAX_SAFE_INTEGER - entry.estimated_memory_bytes) return refusal('Toolkit reservation memory state could not be verified safely.');
      reservedBytes += entry.estimated_memory_bytes;
    }
    const active = state.reservations.length;
    const maximum = profile.capacity_mode === CAPACITY_MODES.MANUAL ? profile.manual_maximum : EMERGENCY_WORKER_CEILING;
    const physicalReserve = Math.max(4 * GIB, resources.physical_total * 0.25);
    const commitReserve = Math.max(6 * GIB, resources.commit_total * 0.20);
    const requested = Number(spec.estimated_memory_bytes || profile.worker_estimate_bytes);
    if (!Number.isSafeInteger(requested) || requested < MIN_WORKER_COST || requested > MAX_WORKER_COST) return refusal('The requested worker cost is unknown or outside the supported range.');
    const effectivePhysical = Math.max(0, resources.physical_available - reservedBytes);
    const effectiveCommit = Math.max(0, resources.commit_available - reservedBytes);
    const physicalAfter = effectivePhysical - requested;
    const commitAfter = effectiveCommit - requested;
    const critical = resources.physical_available / resources.physical_total < 0.08
      || resources.commit_available / resources.commit_total < 0.08;
    if (critical) return refusal('Current memory pressure is unsafe for another worker.');
    const queuedReservation = spec.queue_id ? state.queue.find((entry) => entry.id === spec.queue_id) : null;
    if (spec.queue_id && !queuedReservation) return refusal('The queue entry is missing or expired.');
    if (queuedReservation && (queuedReservation.host !== host || queuedReservation.role !== spec.role)) return refusal('The queue entry belongs to a different host or child role.');
    if (queuedReservation && (queuedReservation.producer_provenance.origin !== origin
      || queuedReservation.producer_provenance.job_identity_digest !== jobIdentityDigest)) {
      return refusal('The queued request cannot change or promote its resource provenance.');
    }
    const enqueue = (reason) => {
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = {
        id: crypto.randomUUID(), host, topology: RESERVATION_TOPOLOGY, depth: spec.depth, role: spec.role,
        created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, estimated_memory_bytes: requested,
        effort: spec.effort, worker_executable: workerExecutable, job_identity_digest: jobIdentityDigest, status: RESULTS.QUEUE,
      };
      try { sealResourceProvenance('queue', queued, origin, resources.source, jobIdentityDigest, options, provenanceKey); }
      catch (_) { return refusal('Toolkit queue provenance could not be persisted safely.'); }
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason, safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    };
    if (state.queue.length && state.queue[0].id !== spec.queue_id) {
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'An earlier bounded queue entry is still waiting.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      return enqueue('Earlier Toolkit-controlled work is queued.');
    }
    if (active >= maximum || active >= EMERGENCY_WORKER_CEILING || physicalAfter < physicalReserve || commitAfter < commitReserve) {
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      return enqueue('Verified capacity is temporarily unavailable.');
    }
    if (queuedReservation) state.queue.shift();
    if (spec.effort !== 'medium' && state.reservations.some((entry) => entry.effort !== 'medium')) return refusal('A higher-effort child is already active; sibling effort escalation is not allowed.');
    const reservation = {
      id: crypto.randomUUID(), host, topology: RESERVATION_TOPOLOGY, depth: 1, role: spec.role,
      owner_pid: process.pid, created_at_ms: now, expires_at_ms: now + RESERVATION_TTL_MS,
      estimated_memory_bytes: requested, effort: spec.effort, worker_executable: workerExecutable,
      job_identity_digest: jobIdentityDigest, status: 'reserved',
    };
    try { sealResourceProvenance('reservation', reservation, origin, resources.source, jobIdentityDigest, options, provenanceKey); }
    catch (_) { return refusal('Toolkit reservation provenance could not be persisted safely.'); }
    state.reservations.push(reservation);
    atomicWriteJson(statePath(options), state);
    return { result: RESULTS.START, reservation_id: reservation.id, expires_at_ms: reservation.expires_at_ms, host, role: spec.role, effort: spec.effort };
  });
}

function releaseReservation(id, options = {}) {
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state) return false;
    const target = current.state.reservations.find((entry) => entry.id === id);
    if (!target || target.owner_pid !== process.pid || target.producer_provenance?.schema === RESOURCE_PROVENANCE_SCHEMA_V2) return false;
    const state = recoverState(current.state);
    const before = state.reservations.length;
    state.reservations = state.reservations.filter((entry) => entry.id !== id);
    if (state.reservations.length === before) return false;
    state.checker_reviews = state.checker_reviews.filter((entry) => entry.status !== 'pending' || entry.reservation_id !== id);
    atomicWriteJson(statePath(options), state);
    return true;
  });
}

// The only executable either admission or the supervisor accepts: the harmless
// run093 fixture worker written by the historical reclosure test. It answers
// `--version` and `plugin list` and otherwise appends two fixed lines to the
// witness file in the control root. Any other byte, path or witness is refused.
function fixtureWorkerLines(entry, witness, delayMs) {
  return [
    "'use strict';",
    "const fs=require('node:fs');",
    `const entry=${JSON.stringify(entry)};`,
    `const witness=${JSON.stringify(witness)};`,
    'const args=process.argv.slice(2);',
    "if(args[0]==='--version'){process.stdout.write('claude fake\\n');process.exit(0);}",
    "if(args[0]==='plugin'&&args[1]==='list'){process.stdout.write(JSON.stringify({installed:[entry]})+'\\n');process.exit(0);}",
    "fs.appendFileSync(witness,'worker-started\\n');",
    ...(delayMs > 0 ? [`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${delayMs});`] : []),
    "fs.appendFileSync(witness,'worker-completed\\n');",
    '',
  ];
}

function verifiedFixtureWorker(executableInput, options = {}) {
  const root = controlRoot(options);
  const executable = path.resolve(String(executableInput || ''));
  if (executable !== path.join(root, FIXTURE_WORKER_NAME)) return null;
  let bytes;
  try {
    const stat = fs.lstatSync(executable);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FIXTURE_WORKER_MAX_BYTES) return null;
    bytes = fs.readFileSync(executable);
  } catch (_) { return null; }
  const lines = bytes.toString('utf8').split('\n');
  const entryMatch = /^const entry=(.*);$/.exec(lines[2] || '');
  const witnessMatch = /^const witness=(.*);$/.exec(lines[3] || '');
  const delayMatch = /^Atomics\.wait\(new Int32Array\(new SharedArrayBuffer\(4\)\),0,0,([1-9][0-9]*)\);$/.exec(lines[8] || '');
  if (!entryMatch || !witnessMatch) return null;
  let entry;
  let witness;
  try { entry = JSON.parse(entryMatch[1]); witness = JSON.parse(witnessMatch[1]); } catch (_) { return null; }
  const delayMs = delayMatch ? Number(delayMatch[1]) : 0;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)
    || Object.keys(entry).join('|') !== 'id|version|enabled|trusted|hooksActive|installPath'
    || witness !== path.join(root, FIXTURE_WITNESS_NAME)
    || !Number.isSafeInteger(delayMs) || delayMs > FIXTURE_WORKER_MAX_DELAY_MS) return null;
  const expected = Buffer.from(fixtureWorkerLines(entry, witness, delayMs).join('\n'), 'utf8');
  return expected.equals(bytes) ? executable : null;
}

function claimSupervisorReservation(reservationId, spec, jobIdentityDigest, workerExecutable, options = {}) {
  if (RESOURCE_TEST_CONTEXT.getStore() || spec.host !== HOSTS.CLAUDE) return false;
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state) return false;
    const now = Date.now();
    const state = recoverState(current.state, now);
    const key = resourceProvenanceKey(options, false);
    if (!validControlState(state) || !key || !validStateResourceProvenance(state, options, key)) return false;
    const entry = state.reservations.find((item) => item.id === reservationId);
    if (!entry || entry.status !== 'reserved' || entry.expires_at_ms <= now
      || !validResourceProvenance('reservation', entry, key)
      || entry.producer_provenance.origin !== 'native'
      || entry.producer_provenance.job_identity_digest !== jobIdentityDigest
      || entry.job_identity_digest !== jobIdentityDigest
      || entry.worker_executable !== workerExecutable
      || entry.host !== spec.host || entry.role !== spec.role || entry.depth !== spec.depth
      || entry.effort !== spec.effort || entry.topology !== RESERVATION_TOPOLOGY) return false;
    const priorClaims = inspectSupervisorClaimMarkers(options, entry.id, entry.producer_provenance.admission_id, key, now);
    if (!priorClaims.ok || priorClaims.claimed || priorClaims.count >= MAX_ACTIVE_SUPERVISOR_CLAIMS) return false;

    const resources = inspectResources();
    if (!validResourceState(resources) || !NATIVE_RESOURCE_STATES.has(resources)
      || !['proc-meminfo', 'win32-operating-system'].includes(resources.source)) return false;
    let otherReservedBytes = 0;
    for (const reservation of state.reservations) {
      if (!validReservation(reservation)) return false;
      if (reservation.id === entry.id) continue;
      if (otherReservedBytes > Number.MAX_SAFE_INTEGER - reservation.estimated_memory_bytes) return false;
      otherReservedBytes += reservation.estimated_memory_bytes;
    }
    const physicalReserve = Math.max(4 * GIB, resources.physical_total * 0.25);
    const commitReserve = Math.max(6 * GIB, resources.commit_total * 0.20);
    const physicalAfter = resources.physical_available - otherReservedBytes - entry.estimated_memory_bytes;
    const commitAfter = resources.commit_available - otherReservedBytes - entry.estimated_memory_bytes;
    const critical = resources.physical_available / resources.physical_total < 0.08
      || resources.commit_available / resources.commit_total < 0.08;
    if (critical || physicalAfter < physicalReserve || commitAfter < commitReserve
      || state.reservations.length > EMERGENCY_WORKER_CEILING) return false;

    if (!persistSupervisorClaimMarker(entry, options, key, now)) return false;
    entry.owner_pid = process.pid;
    entry.status = 'running';
    try {
      sealResourceProvenance('reservation', entry, entry.producer_provenance.origin,
        entry.producer_provenance.resource_source, entry.producer_provenance.job_identity_digest, options, key);
    } catch (_) { return false; }
    if (!validControlState(state)) return false;
    atomicWriteJson(statePath(options), state);
    return true;
  });
}

// Retired entrypoints. The historical proof calls them to show that fixture
// evidence cannot launch a worker or a checker; they now refuse unconditionally.
function launch() {
  return refusal(RETIRED_REASON);
}

function checkerWorkflow() {
  return {
    status: CHECKER_RESULTS.ADMISSION_DENIED,
    findings: [],
    reason: RETIRED_REASON,
    root_self_review_required: true,
    root_self_review_performed: false,
    root_self_review_contract: 'Perform and report a bounded root self-review; do not represent it as independent verification.',
  };
}

// One supervised fixture run: load and verify the stored job specification and the
// fixture worker, claim the sealed native reservation, run the fixture, then release
// the reservation and remove the job file. A refused claim leaves state untouched.
class WorkerSupervisor {
  #args; #options; #code = 1; #claimed = false;
  #spec; #specPath; #workerExecutable = ''; #jobIdentityDigest = '';

  constructor(args) { this.#args = args; this.#options = { root: args.root }; }

  #loadSpec() {
    const args = this.#args;
    if (!/^[a-f0-9-]{36}$/.test(String(args.reservation || ''))) throw new Error('Toolkit reservation identity is invalid.');
    this.#specPath = path.resolve(String(args.spec || ''));
    const expectedSpecPath = path.join(controlRoot(this.#options), 'jobs', `${args.reservation}.json`);
    if (this.#specPath !== expectedSpecPath) throw new Error('Stored worker specification identity is invalid.');
    verifyPrivateRegularFile(this.#specPath);
    const stored = readJson(this.#specPath);
    const encoded = String(stored?.child_prompt_base64 || '');
    this.#workerExecutable = String(stored?.worker_executable || '');
    if (!this.#workerExecutable || this.#workerExecutable !== args.claudeCli) throw new Error('Stored worker executable identity is invalid.');
    if (!verifiedFixtureWorker(this.#workerExecutable, this.#options)) throw new Error(RETIRED_REASON);
    const promptBytes = Buffer.from(encoded, 'base64');
    if (!encoded || promptBytes.toString('base64') !== encoded || promptBytes.length > MAX_PROMPT_BYTES) {
      throw new Error('Stored child prompt transport is malformed.');
    }
    const jobSpec = { ...stored };
    delete jobSpec.child_prompt_base64;
    delete jobSpec.worker_executable;
    jobSpec.child_prompt = promptBytes.toString('utf8');
    this.#spec = validateLaunchSpec(jobSpec);
    this.#jobIdentityDigest = resourceJobIdentityDigest(this.#spec, this.#workerExecutable);
  }

  #claim() {
    const args = this.#args;
    if (!claimSupervisorReservation(args.reservation, this.#spec, this.#jobIdentityDigest, this.#workerExecutable, this.#options)) {
      throw new Error('Toolkit reservation state could not be verified before worker execution.');
    }
    this.#claimed = true;
  }

  #execute() {
    const result = spawnSync(process.execPath, [this.#workerExecutable], {
      cwd: controlRoot(this.#options),
      env: { ...process.env, AI_AGENT_TOOLKIT_CHILD: '1' },
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    if (result.error) console.error(result.error.message);
    this.#code = Number.isInteger(result.status) ? result.status : 1;
  }

  #settle() {
    if (!this.#claimed) return;
    releaseReservation(this.#args.reservation, this.#options);
    try { if (verifyPrivateRegularFile(this.#specPath)) fs.unlinkSync(this.#specPath); } catch {}
  }

  run() {
    try {
      this.#loadSpec();
      this.#claim();
      this.#execute();
    } finally {
      this.#settle();
    }
    return this.#code;
  }
}

function supervise(args) { return new WorkerSupervisor(args).run(); }

module.exports = {
  RESULTS, CHECKER_RESULTS, HOSTS, ROLES, GIB, LOCK_TTL_MS,
  controlRoot, statePath, lockPath, lockRecoveryPath, acquireLock, withRepositoryTestResourceInvocation,
  inspectResources, inspectResourceCapability, parseLinuxMeminfoCounters, validateLaunchSpec,
  admissionDecision, resourceAdmissionDecision, releaseReservation, recoverState, verifiedFixtureWorker,
  launch, checkerWorkflow, supervise,
};
