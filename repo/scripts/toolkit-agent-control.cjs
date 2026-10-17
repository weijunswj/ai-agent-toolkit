#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { types: utilTypes } = require('node:util');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const processLaunch = require('./claude-process-launch.cjs');

const SCHEMA = 1;
const CONTROL_VERSION = '3.0.6';
const RESOURCE_PROVENANCE_SCHEMA = 'toolkit.agent-control.resource-provenance.v1';
const RESOURCE_PROVENANCE_SCHEMA_V2 = 'toolkit.agent-control.resource-provenance.v2';
const RESOURCE_PROVENANCE_KEY_FILE = 'resource-provenance.key';
const SUPERVISOR_CLAIM_SCHEMA = 'toolkit.agent-control.supervisor-claim.v1';
const SUPERVISOR_CLAIM_DIRECTORY = 'supervisor-claims';
const MAX_ACTIVE_SUPERVISOR_CLAIMS = 1024;
const RESOURCE_PRODUCTION_ADMISSION = Symbol('native-resource-admission');
const RESULTS = Object.freeze({ START: 'start', QUEUE: 'queue', REFUSE: 'refuse-root-only' });
const CHECKER_RESULTS = Object.freeze({ PASS: 'PASS', FINDINGS: 'FINDINGS', ADMISSION_DENIED: 'ADMISSION_DENIED', SKIPPED_TRIVIAL: 'SKIPPED_TRIVIAL' });
const HOSTS = Object.freeze({ CODEX: 'codex', CLAUDE: 'claude-code', OPENCODE: 'opencode' });
const ROLES = Object.freeze({ WORKER: 'worker', CHECKER: 'checker' });
// Immutable historical run093 wire meaning only. Current Core launch choices are
// resolved from admitted controller evidence by the native adapter, never here.
const MODEL_CONTRACT = Object.freeze({
  codex: Object.freeze({ worker: 'gpt-5.6-sol', checker: 'gpt-5.6-sol', effort: 'medium' }),
  'claude-code': Object.freeze({ worker: 'fable-5', checker: 'opus-4.8', effort: 'medium' }),
  opencode: Object.freeze({ worker: 'gpt-5.6-sol', checker: 'gpt-5.6-sol', effort: 'medium' }),
});
const TOPOLOGIES = Object.freeze({ ROOT_ONLY: 'root-only', CLAUDE_DIRECT: 'claude-toolkit-direct', BROADER_NATIVE: 'broader-native' });
const CAPACITY_MODES = Object.freeze({ AUTO: 'automatic', ROOT_ONLY: 'root-only', MANUAL: 'manual' });
const GIB = 1024 ** 3;
const DEFAULT_WORKER_COST = 2 * GIB;
const RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;
const CHECKER_REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const QUEUE_TTL_MS = 10 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000;
const MAX_QUEUE = 4;
// Deliberately not exposed as setup capacity: this is only an emergency guard.
const EMERGENCY_WORKER_CEILING = 4;
const MIN_WORKER_COST = GIB;
const MAX_WORKER_COST = 16 * GIB;
const MAX_MANUAL_WORKERS = 64;
const MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_CHECKER_OUTPUT_BYTES = 256 * 1024;
const MAX_CHECKER_INPUT_BYTES = 1024 * 1024;
const CHECKER_TIMEOUT_MS = 30 * 60 * 1000;
const REPOSITORY_TEST_RESOURCE_INVOCATION = 'toolkit.repository-test.resource.v1';
const RESOURCE_TEST_CONTEXT = new AsyncLocalStorage();
const NATIVE_RESOURCE_STATES = new WeakSet();
const NATIVE_RESOURCE_METADATA = new WeakMap();
const MODE0_RESOURCE_ENVELOPES = new WeakMap();
const MODE0_RESOURCE_SCHEMA = 'toolkit.agent-control.resource-envelope.v1';
const MODE0_PARENT_BYTES = 1280 * 1024 * 1024;
const MODE0_MANAGEMENT_BYTES = 256 * 1024 * 1024;
const MODE0_WORKER_BYTES = 1024 * 1024 * 1024;
const MODE0_HOST_RESERVE_BYTES = 1792 * 1024 * 1024;
const MODE0_CASE_ID = 'R093-F5-NATIVE-COLLECTOR-POS';
const MODE0_FIXTURE_SOURCE_SHA256 = 'd8c400c946f2c6a4b29e99bc7b9895216856d135e39a550aaca38fa1af98c97d';
const MODE0_REPOSITORY = 'weijunswj/ai-agent-toolkit';
const MODE0_RUN = 'toolkit-core-construction-g3-20261007-001';
const MODE0_LOCK = 'DL-TK-CORE-CONSTRUCTION-G3-20261007-001';
const MODE0_TRANSPORT_RESULT_SCHEMA = 'toolkit.agent-control.resource-operation-result.v1';
const MODE0_TRANSPORT_FRAME_BYTES = 64 * 1024;
const MODE0_WORKER_OUTPUT_BYTES = 8 * 1024 * 1024;
const MODE0_LIFECYCLE_BYTES = 64 * 1024 * 1024;
const MODE0_START_RESULT_SCHEMA = 'toolkit.agent-control.resource-start.v1';
const MODE0_SETTLEMENT_RESULT_SCHEMA = 'toolkit.agent-control.resource-settlement.v1';
const MODE0_SETTLEMENT_PROOFS = new WeakMap();
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

function controlRoot(options = {}) {
  const testContext = RESOURCE_TEST_CONTEXT.getStore();
  if (testContext) return testContext.root;
  return path.resolve(options.root || process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control'));
}

function profilePath(host = 'claude-code', options = {}) {
  return path.join(controlRoot(options), 'profiles', `${host}.json`);
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

function validMode0ResourceEnvelope(input, expected = {}) {
  let e;
  try { e = resourceDataCopy(input); } catch (_) { return false; }
  const top = ['schema','repository','run','lock','decision_digest','case_id','workload_digest','job_identity_digest',
    'host_id','boot_id','overcommit_mode','observed_at_ms','expires_at_ms','dispatch_id','parent','management',
    'worker','transport','resources'];
  const parentKeys = ['path','device','inode','cgroup_id','memory_max','memory_current','memory_swap_max','cpu_quota','cpu_period','pids_max'];
  const leafKeys = ['container_id','path','cgroup_id','memory_max','memory_current','memory_swap_max','cpu_quota','cpu_period','pids_max'];
  const transportKeys = ['socket_path','owner_uid','device','inode','mount_id','server_generation'];
  const resourceKeys = ['source','physical_total','physical_available','commit_total','commit_available','host_responsive'];
  const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const identity = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f]/.test(v);
  const canonicalCgroupPath = (v) => identity(v) && path.posix.isAbsolute(v) && path.posix.normalize(v) === v && v !== '/';
  const nestedCgroupPath = (parent, child) => {
    if (!canonicalCgroupPath(parent) || !canonicalCgroupPath(child)) return false;
    const relative = path.posix.relative(parent, child);
    return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.posix.sep}`) && !path.posix.isAbsolute(relative);
  };
  const quota = (v, p) => Number.isSafeInteger(v) && v > 0 && Number.isSafeInteger(p) && p > 0 && v <= p;
  if (!exactResourceKeys(e, top) || e.schema !== MODE0_RESOURCE_SCHEMA || e.case_id !== MODE0_CASE_ID
    || e.overcommit_mode !== 0 || e.repository !== MODE0_REPOSITORY || e.run !== MODE0_RUN || e.lock !== MODE0_LOCK
    || !digest(e.decision_digest) || !digest(e.workload_digest) || !digest(e.job_identity_digest)
    || !identity(e.host_id) || !identity(e.boot_id) || !identity(e.dispatch_id)
    || !Number.isSafeInteger(e.observed_at_ms) || e.observed_at_ms <= 0
    || !Number.isSafeInteger(e.expires_at_ms) || e.expires_at_ms <= e.observed_at_ms
    || e.expires_at_ms - e.observed_at_ms > 455000
    || !exactResourceKeys(e.parent, parentKeys) || !exactResourceKeys(e.management, leafKeys)
    || !exactResourceKeys(e.worker, [...leafKeys,'executable_path','executable_sha256'])
    || !exactResourceKeys(e.transport, transportKeys) || !exactResourceKeys(e.resources, resourceKeys)) return false;
  for (const group of [e.parent, e.management, e.worker]) {
    if (!identity(group.path) || !identity(group.cgroup_id) || !Number.isSafeInteger(group.memory_current)
      || group.memory_current < 0 || !Number.isSafeInteger(group.memory_swap_max) || group.memory_swap_max !== 0
      || !quota(group.cpu_quota, group.cpu_period) || !Number.isSafeInteger(group.pids_max)
      || group.pids_max < 1 || group.pids_max > 128) return false;
  }
  if (!Number.isSafeInteger(e.parent.device) || e.parent.device < 0 || !Number.isSafeInteger(e.parent.inode) || e.parent.inode < 1
    || e.parent.memory_max !== MODE0_PARENT_BYTES || e.parent.memory_current > e.parent.memory_max - MODE0_WORKER_BYTES
    || !canonicalCgroupPath(e.parent.path) || !nestedCgroupPath(e.parent.path, e.management.path)
    || !nestedCgroupPath(e.parent.path, e.worker.path) || e.management.path === e.worker.path
    || new Set([e.parent.cgroup_id, e.management.cgroup_id, e.worker.cgroup_id]).size !== 3
    || e.management.container_id === e.worker.container_id
    || e.parent.pids_max > 128 || e.management.memory_max !== MODE0_MANAGEMENT_BYTES
    || e.management.memory_current > MODE0_MANAGEMENT_BYTES || e.worker.memory_max !== MODE0_WORKER_BYTES
    || e.worker.memory_current >= MODE0_WORKER_BYTES
    || !/^[a-f0-9]{64}$/.test(e.management.container_id || '') || !/^[a-f0-9]{64}$/.test(e.worker.container_id || '')
    || !identity(e.worker.executable_path) || !digest(e.worker.executable_sha256)
    || !identity(e.transport.socket_path) || !path.posix.isAbsolute(e.transport.socket_path)
    || e.transport.socket_path.length >= 108 || !Number.isSafeInteger(e.transport.owner_uid) || e.transport.owner_uid < 0
    || !Number.isSafeInteger(e.transport.device) || e.transport.device < 0 || !Number.isSafeInteger(e.transport.inode) || e.transport.inode < 1
    || !identity(e.transport.mount_id) || !digest(e.transport.server_generation)) return false;
  if (!exactResourceKeys(e.resources, resourceKeys) || e.resources.source !== 'proc-meminfo'
    || !Number.isSafeInteger(e.resources.physical_total) || e.resources.physical_total < 1
    || !Number.isSafeInteger(e.resources.physical_available) || e.resources.physical_available < MODE0_HOST_RESERVE_BYTES
    || !Number.isSafeInteger(e.resources.commit_total) || e.resources.commit_total < 0
    || !Number.isSafeInteger(e.resources.commit_available) || e.resources.commit_available < -Number.MAX_SAFE_INTEGER
    || e.resources.commit_available > e.resources.commit_total || e.resources.host_responsive !== true) return false;
  const now = Number.isSafeInteger(expected.now) ? expected.now : Date.now();
  if (e.observed_at_ms > now + 1000 || !expected.allowExpired && e.expires_at_ms <= now) return false;
  for (const key of ['repository','run','lock','decision_digest','workload_digest','job_identity_digest']) {
    if (expected[key] !== undefined && e[key] !== expected[key]) return false;
  }
  if (expected.workerExecutable !== undefined && e.worker.executable_path !== expected.workerExecutable) return false;
  if (expected.workerExecutableSha256 !== undefined && e.worker.executable_sha256 !== expected.workerExecutableSha256) return false;
  return true;
}

function mode0TransportMountId(targetPath) {
  const absolute = path.resolve(targetPath);
  const unescape = (value) => value.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\');
  let selected = null;
  for (const line of fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n')) {
    const fields = line.split(' ');
    if (fields.length < 6) continue;
    const mountPoint = unescape(fields[4]);
    if ((absolute === mountPoint || absolute.startsWith(`${mountPoint}${path.sep}`))
      && (!selected || mountPoint.length > selected.mountPoint.length)) selected = { id: fields[0], mountPoint };
  }
  if (!selected || !/^\d+$/.test(selected.id)) throw new Error('Mode-0 transport mount identity is unavailable.');
  return selected.id;
}

function assertPinnedMode0Transport(envelope) {
  if (process.platform !== 'linux' || !validMode0ResourceEnvelope(envelope, { allowExpired: false })) {
    throw new Error('Mode-0 transport envelope is invalid or expired.');
  }
  const expected = envelope.transport;
  const stat = fs.lstatSync(expected.socket_path);
  if (!stat.isSocket() || stat.isSymbolicLink() || stat.uid !== expected.owner_uid
    || stat.dev !== expected.device || stat.ino !== expected.inode
    || mode0TransportMountId(expected.socket_path) !== expected.mount_id) {
    throw new Error('Pinned mode-0 transport endpoint identity changed.');
  }
}

function mode0TransportRequest(envelope, action, reservationId) {
  if (!['OBSERVE', 'START', 'SETTLE'].includes(action) || !/^[a-f0-9-]{36}$/.test(reservationId || '')) {
    return Promise.reject(new Error('Mode-0 resource operation identity is invalid.'));
  }
  try { assertPinnedMode0Transport(envelope); }
  catch (error) { return Promise.reject(error); }
  const request = {
    action,
    case_id: envelope.case_id,
    decision_digest: envelope.decision_digest,
    job_identity_digest: envelope.job_identity_digest,
    lock: envelope.lock,
    repository: envelope.repository,
    run: envelope.run,
    dispatch_id: envelope.dispatch_id,
    reservation_id: reservationId,
    transport_generation: envelope.transport.server_generation,
  };
  const requestBytes = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8');
  if (requestBytes.length > MODE0_TRANSPORT_FRAME_BYTES) return Promise.reject(new Error('Mode-0 resource request exceeds its bound.'));
  const timeoutMs = action === 'START' ? 180000 : action === 'SETTLE' ? 110000 : 10000;
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0);
    let done = false;
    const socket = net.createConnection({ path: envelope.transport.socket_path });
    const fail = (error) => {
      if (done) return;
      done = true;
      socket.destroy();
      reject(error instanceof Error ? error : new Error('Mode-0 resource transport failed.'));
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('Mode-0 resource operation timed out; effects remain unresolved.')));
    socket.once('connect', () => socket.write(requestBytes));
    socket.on('data', (chunk) => {
      if (done) return;
      response = Buffer.concat([response, chunk]);
      if (response.length > MODE0_TRANSPORT_FRAME_BYTES) return fail(new Error('Mode-0 resource response exceeds its bound.'));
      const newline = response.indexOf(0x0a);
      if (newline >= 0 && newline !== response.length - 1) return fail(new Error('Mode-0 resource response framing is invalid.'));
    });
    socket.once('error', fail);
    socket.once('end', () => {
      if (done) return;
      const newline = response.indexOf(0x0a);
      if (newline < 0 || newline !== response.length - 1) return fail(new Error('Mode-0 resource response is incomplete.'));
      let value;
      try { value = resourceDataCopy(JSON.parse(response.subarray(0, newline).toString('utf8'))); }
      catch { return fail(new Error('Mode-0 resource response could not be verified.')); }
      if (action === 'OBSERVE') {
        if (!validMode0ResourceEnvelope(value, {
          repository: envelope.repository, run: envelope.run, lock: envelope.lock,
          decision_digest: envelope.decision_digest, workload_digest: envelope.workload_digest,
          job_identity_digest: envelope.job_identity_digest,
          workerExecutable: envelope.worker.executable_path,
          workerExecutableSha256: envelope.worker.executable_sha256,
        }) || value.dispatch_id !== envelope.dispatch_id || value.transport.server_generation !== envelope.transport.server_generation) {
          return fail(new Error('Fresh mode-0 observation does not match the sealed dispatch.'));
        }
      } else if (!exactResourceKeys(value, ['schema','action','decision_digest','job_identity_digest','dispatch_id','reservation_id','transport_generation','result'])
        || value.schema !== MODE0_TRANSPORT_RESULT_SCHEMA || value.action !== action
        || value.decision_digest !== envelope.decision_digest || value.job_identity_digest !== envelope.job_identity_digest
        || value.dispatch_id !== envelope.dispatch_id || value.reservation_id !== reservationId
        || value.transport_generation !== envelope.transport.server_generation || !value.result || typeof value.result !== 'object') {
        return fail(new Error('Mode-0 resource operation reply is not bound to the sealed dispatch.'));
      }
      done = true;
      socket.destroy();
      resolve(value);
    });
  });
}

function sameMode0EnvelopeIdentity(leftInput, rightInput) {
  let left, right;
  try { left = resourceDataCopy(leftInput); right = resourceDataCopy(rightInput); } catch (_) { return false; }
  for (const value of [left, right]) {
    delete value.observed_at_ms;
    for (const group of [value.parent, value.management, value.worker]) delete group.memory_current;
    delete value.resources.physical_available;
    delete value.resources.commit_available;
  }
  return JSON.stringify(sortResourceValue(left)) === JSON.stringify(sortResourceValue(right));
}

function mode0NativeObservationMatches(envelope, resources) {
  const metadata = resources && NATIVE_RESOURCE_METADATA.get(resources);
  return process.platform === 'linux' && validResourceState(resources) && NATIVE_RESOURCE_STATES.has(resources)
    && resources.source === 'proc-meminfo' && metadata?.overcommit_mode === 0
    && envelope.resources.physical_total === resources.physical_total
    && envelope.resources.commit_total === resources.commit_total
    && envelope.resources.host_responsive === resources.host_responsive
    // Availability is sampled twice at different boundaries. Bind both native samples to
    // the same host totals and independently require enough headroom; do not require an
    // instantaneous counter to remain byte-for-byte constant between observations.
    && Number.isSafeInteger(envelope.resources.physical_available)
    && envelope.resources.physical_available >= MODE0_HOST_RESERVE_BYTES
    && resources.physical_available >= MODE0_HOST_RESERVE_BYTES
    && Number.isSafeInteger(envelope.resources.commit_available)
    && envelope.resources.commit_available >= 0
    && Number.isSafeInteger(resources.commit_available)
    && resources.commit_available >= 0;
}

function validMode0OperationEnvelope(previous, fresh, spec, workerExecutable, jobIdentityDigest, resources) {
  return validMode0ResourceEnvelope(fresh, {
    repository: previous.repository, run: previous.run, lock: previous.lock,
    decision_digest: previous.decision_digest, workload_digest: jobIdentityDigest,
    job_identity_digest: jobIdentityDigest, workerExecutable,
    workerExecutableSha256: previous.worker.executable_sha256,
  }) && sameMode0EnvelopeIdentity(previous, fresh)
    && fresh.observed_at_ms > previous.observed_at_ms
    && fresh.resources.physical_available >= MODE0_HOST_RESERVE_BYTES
    && fresh.parent.memory_current <= fresh.parent.memory_max - MODE0_WORKER_BYTES
    && fresh.management.memory_current <= MODE0_MANAGEMENT_BYTES
    && fresh.worker.memory_current < MODE0_WORKER_BYTES
    && Number(spec.estimated_memory_bytes || 0) === MODE0_WORKER_BYTES
    && mode0NativeObservationMatches(fresh, resources);
}

function mode0ResultDigest(value, excludedKey) {
  const body = { ...value };
  delete body[excludedKey];
  return crypto.createHash('sha256').update(JSON.stringify(sortResourceValue(body)), 'utf8').digest('hex');
}

function readMode0Output(filePath, expectedBytes, expectedSha256) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > MODE0_WORKER_OUTPUT_BYTES
    || !/^[a-f0-9]{64}$/.test(String(expectedSha256 || ''))) throw new Error('Settled worker output evidence is invalid.');
  const stat = verifyPrivateRegularFile(filePath);
  if (stat.size !== expectedBytes) throw new Error('Settled worker output length does not match its receipt.');
  const bytes = fs.readFileSync(filePath);
  if (bytes.length !== expectedBytes || crypto.createHash('sha256').update(bytes).digest('hex') !== expectedSha256) {
    throw new Error('Settled worker output bytes do not match its receipt.');
  }
  return bytes;
}

function validateMode0StartResult(result, envelope, reservationId, workerExecutable) {
  const keys = ['schema','outcome','reservation_id','dispatch_id','job_identity_digest','worker_container_id',
    'worker_cgroup_id','worker_executable_sha256','started_at_ms','start_receipt_digest'];
  if (!exactResourceKeys(result, keys) || result.schema !== MODE0_START_RESULT_SCHEMA || result.outcome !== 'STARTED'
    || result.reservation_id !== reservationId || result.dispatch_id !== envelope.dispatch_id
    || result.job_identity_digest !== envelope.job_identity_digest
    || result.worker_container_id !== envelope.worker.container_id || result.worker_cgroup_id !== envelope.worker.cgroup_id
    || result.worker_executable_sha256 !== envelope.worker.executable_sha256
    || !Number.isSafeInteger(result.started_at_ms) || result.started_at_ms <= envelope.observed_at_ms
    || result.started_at_ms >= envelope.expires_at_ms || !/^[a-f0-9]{64}$/.test(result.start_receipt_digest || '')
    || executableDigest(workerExecutable) !== envelope.worker.executable_sha256
    || mode0ResultDigest(result, 'start_receipt_digest') !== result.start_receipt_digest) throw new Error('Externally placed worker START receipt did not verify.');
  return result;
}

function validateMode0SettlementResult(result, start, envelope, reservationId) {
  const keys = ['schema','outcome','exit_code','reservation_id','dispatch_id','job_identity_digest','parent_cgroup_id',
    'management_cgroup_id','worker_cgroup_id','management_container_id','worker_container_id','domain_empty',
    'settled_at_ms','start_receipt_digest','stdout_bytes','stdout_sha256','stderr_bytes','stderr_sha256','outcome_digest'];
  if (!exactResourceKeys(result, keys) || result.schema !== MODE0_SETTLEMENT_RESULT_SCHEMA
    || !['SUCCEEDED','FAILED'].includes(result.outcome) || !Number.isSafeInteger(result.exit_code)
    || result.outcome === 'SUCCEEDED' && result.exit_code !== 0 || result.outcome === 'FAILED' && result.exit_code === 0
    || result.reservation_id !== reservationId || result.dispatch_id !== envelope.dispatch_id
    || result.job_identity_digest !== envelope.job_identity_digest
    || result.parent_cgroup_id !== envelope.parent.cgroup_id
    || result.management_cgroup_id !== envelope.management.cgroup_id
    || result.worker_cgroup_id !== envelope.worker.cgroup_id
    || result.management_container_id !== envelope.management.container_id
    || result.worker_container_id !== envelope.worker.container_id || result.domain_empty !== true
    || !Number.isSafeInteger(result.settled_at_ms) || result.settled_at_ms <= start.started_at_ms
    || result.settled_at_ms >= envelope.expires_at_ms
    || result.start_receipt_digest !== start.start_receipt_digest
    || !Number.isSafeInteger(result.stdout_bytes) || result.stdout_bytes < 0 || result.stdout_bytes > MODE0_WORKER_OUTPUT_BYTES
    || !Number.isSafeInteger(result.stderr_bytes) || result.stderr_bytes < 0 || result.stderr_bytes > MODE0_WORKER_OUTPUT_BYTES
    || !/^[a-f0-9]{64}$/.test(result.stdout_sha256 || '') || !/^[a-f0-9]{64}$/.test(result.stderr_sha256 || '')
    || !/^[a-f0-9]{64}$/.test(result.outcome_digest || '') || mode0ResultDigest(result, 'outcome_digest') !== result.outcome_digest) {
    throw new Error('External worker settlement did not prove a known terminal outcome and empty domain.');
  }
  return result;
}

function sealResourceProvenance(kind, entry, origin, resourceSource, jobIdentityDigest, options = {}, suppliedKey = undefined, mode0Envelope = null) {
  const key = suppliedKey || resourceProvenanceKey(options, true);
  if (!key) throw new Error('Resource provenance could not be persisted safely.');
  const existingAdmissionId = [RESOURCE_PROVENANCE_SCHEMA, RESOURCE_PROVENANCE_SCHEMA_V2].includes(entry.producer_provenance?.schema)
    ? entry.producer_provenance.admission_id : null;
  entry.producer_provenance = {
    schema: mode0Envelope ? RESOURCE_PROVENANCE_SCHEMA_V2 : RESOURCE_PROVENANCE_SCHEMA,
    origin,
    resource_source: resourceSource,
    admission_id: existingAdmissionId || crypto.randomUUID(),
    job_identity_digest: jobIdentityDigest,
    ...(mode0Envelope ? { mode0_envelope: mode0Envelope } : {}),
    mac: '',
  };
  entry.producer_provenance.mac = resourceProvenanceMac(kind, entry, key);
  return entry;
}

function validResourceProvenance(kind, entry, key) {
  const provenance = entry && entry.producer_provenance;
  const v2 = provenance?.schema === RESOURCE_PROVENANCE_SCHEMA_V2;
  if (!provenance || typeof provenance !== 'object'
    || !exactResourceKeys(provenance, v2
      ? ['admission_id','job_identity_digest','mac','mode0_envelope','origin','resource_source','schema']
      : ['admission_id','job_identity_digest','mac','origin','resource_source','schema'])
    || ![RESOURCE_PROVENANCE_SCHEMA, RESOURCE_PROVENANCE_SCHEMA_V2].includes(provenance.schema)
    || !['native', 'repository-test'].includes(provenance.origin)
    || (provenance.origin === 'native' && !['proc-meminfo', 'win32-operating-system'].includes(provenance.resource_source))
    || (provenance.origin === 'repository-test' && provenance.resource_source !== REPOSITORY_TEST_RESOURCE_FIXTURE.source)
    || (v2 && (kind !== 'reservation' || provenance.origin !== 'native' || provenance.resource_source !== 'proc-meminfo'
      || !validMode0ResourceEnvelope(provenance.mode0_envelope, { job_identity_digest: provenance.job_identity_digest, allowExpired: true })))
    || (!v2 && Object.hasOwn(provenance, 'mode0_envelope'))
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
    && Object.values(HOSTS).includes(entry.host) && (entry.topology === 'toolkit-controlled-direct' || (entry.host === HOSTS.CLAUDE && entry.topology === TOPOLOGIES.CLAUDE_DIRECT)) && entry.depth === 1
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

function rootOnlyProfile(host, status, reason) {
  return { schema: SCHEMA, host, topology: TOPOLOGIES.ROOT_ONLY, capacity_mode: CAPACITY_MODES.ROOT_ONLY, manual_maximum: 0, status, supported: false, reason };
}

function validActivationProof(proof, expected = {}) {
  const structurallyValid = Boolean(proof && proof.schema === 3 && proof.source === 'claude-plugin-list'
    && proof.plugin_version === CONTROL_VERSION
    && ['cache_identity', 'hook_sha256', 'controller_sha256', 'process_launch_sha256', 'agent_hook_sha256']
      .every((key) => /^[a-f0-9]{64}$/.test(String(proof[key] || ''))));
  if (!structurallyValid) return false;
  if (expected.pluginVersion && proof.plugin_version !== expected.pluginVersion) return false;
  if (expected.cachePath) {
    const identity = crypto.createHash('sha256').update(path.resolve(expected.cachePath)).digest('hex');
    if (proof.cache_identity !== identity) return false;
  }
  return true;
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
  return Boolean(current?.verified === true && validActivationProof(current.activation_proof)
    && ['schema', 'source', 'plugin_version', 'cache_identity', 'hook_sha256', 'controller_sha256', 'process_launch_sha256', 'agent_hook_sha256']
      .every((key) => current.activation_proof[key] === profile.activation_proof?.[key]));
}

// The stored launch profile for one host. Reads fail closed to a root-only profile;
// configuration validates the selection, verified activation and native resource
// counters before writing; invalidation records a root-only policy with its reason.
class HostProfileStore {
  #host; #options;

  constructor(host = 'claude-code', options = {}) { this.#host = host; this.#options = options; }

  static #supportedHost(host) {
    if (host !== 'claude-code') throw new Error('Toolkit-managed agent launch is not supported for this host.');
  }

  static #compatible(topology, capacityMode) {
    return (topology === TOPOLOGIES.ROOT_ONLY && capacityMode === CAPACITY_MODES.ROOT_ONLY)
      || (topology === TOPOLOGIES.CLAUDE_DIRECT && [CAPACITY_MODES.AUTO, CAPACITY_MODES.MANUAL].includes(capacityMode))
      || (topology === TOPOLOGIES.BROADER_NATIVE && capacityMode === CAPACITY_MODES.ROOT_ONLY);
  }

  static #strict(topology) { return [TOPOLOGIES.ROOT_ONLY, TOPOLOGIES.CLAUDE_DIRECT].includes(topology); }

  get path() { return profilePath(this.#host, this.#options); }

  read() {
    const host = this.#host;
    const raw = readJson(this.path);
    if (!raw) return rootOnlyProfile(host, 'unconfigured-root-only', 'No verified Toolkit profile is configured.');
    const validEnums = Object.values(TOPOLOGIES).includes(raw.topology) && Object.values(CAPACITY_MODES).includes(raw.capacity_mode);
    const validNumbers = Number.isSafeInteger(raw.manual_maximum) && raw.manual_maximum >= 0 && raw.manual_maximum <= MAX_MANUAL_WORKERS
      && Number.isSafeInteger(raw.worker_estimate_bytes) && raw.worker_estimate_bytes >= MIN_WORKER_COST && raw.worker_estimate_bytes <= MAX_WORKER_COST
      && raw.queue_limit === MAX_QUEUE && raw.reservation_limit === EMERGENCY_WORKER_CEILING;
    const compatible = HostProfileStore.#compatible(raw.topology, raw.capacity_mode)
      && (raw.topology === TOPOLOGIES.CLAUDE_DIRECT
        ? (raw.capacity_mode !== CAPACITY_MODES.MANUAL || raw.manual_maximum >= 1)
        : raw.manual_maximum === 0);
    const strictValid = !HostProfileStore.#strict(raw.topology) || (raw.enforcement_verified === true && raw.controller_version === CONTROL_VERSION
      && ['native-agent-hook-deny', 'toolkit-launch-boundary'].includes(raw.enforcement) && validActivationProof(raw.activation_proof)
      && typeof raw.claude_cli === 'string' && raw.claude_cli.length > 0 && (() => { try { processLaunch.validateExecutable(raw.claude_cli); return true; } catch { return false; } })());
    const testContext = RESOURCE_TEST_CONTEXT.getStore();
    const currentResources = raw.topology === TOPOLOGIES.CLAUDE_DIRECT && !testContext
      ? inspectResources() : null;
    const resourceValid = raw.topology !== TOPOLOGIES.CLAUDE_DIRECT
      || (raw.resource_counter_verified === true
        && ['proc-meminfo', 'win32-operating-system'].includes(raw.resource_counter_source)
        && (testContext || NATIVE_RESOURCE_STATES.has(currentResources) && validResourceState(currentResources)
          && currentResources.source === raw.resource_counter_source));
    if (raw.schema !== SCHEMA || raw.host !== host || !validEnums || !validNumbers || !compatible || !strictValid || !resourceValid || typeof raw.updated_at !== 'string') {
      return rootOnlyProfile(host, 'unsupported-root-only', 'The stored Toolkit profile is malformed, contradictory, stale, or from an unsupported schema.');
    }
    return { ...raw, status: 'configured', supported: true,
      ...(testContext ? { resource_evidence_context: 'repository-test-fixture', production_supported: false } : { production_supported: true }) };
  }

  configure(selectedInput) {
    const host = this.#host;
    HostProfileStore.#supportedHost(host);
    if (RESOURCE_TEST_CONTEXT.getStore()) throw new Error('Repository-test resource context cannot configure a production profile.');
    let selected;
    try { selected = resourceDataCopy(selectedInput); this.#options = resourceOptionShell(this.#options); }
    catch (_) { throw new Error('The selected Toolkit profile is malformed.'); }
    const topology = selected.topology;
    const capacityMode = selected.capacity_mode;
    if (!Object.values(TOPOLOGIES).includes(topology)) throw new Error(`Unsupported topology: ${topology}`);
    if (!Object.values(CAPACITY_MODES).includes(capacityMode)) throw new Error(`Unsupported capacity mode: ${capacityMode}`);
    if (!HostProfileStore.#compatible(topology, capacityMode)) throw new Error('Topology and capacity mode are incompatible.');
    let manualMaximum = 0;
    if (capacityMode === CAPACITY_MODES.MANUAL) {
      manualMaximum = Number(selected.manual_maximum);
      if (!Number.isSafeInteger(manualMaximum) || manualMaximum < 1 || manualMaximum > MAX_MANUAL_WORKERS) throw new Error('Manual maximum is outside the supported bounds.');
    }
    const workerEstimate = Number(selected.worker_estimate_bytes || DEFAULT_WORKER_COST);
    if (!Number.isSafeInteger(workerEstimate) || workerEstimate < MIN_WORKER_COST || workerEstimate > MAX_WORKER_COST) throw new Error('Worker estimate is outside the supported bounds.');
    const strict = HostProfileStore.#strict(topology);
    if (strict && (selected.enforcement_verified !== true || !validActivationProof(selected.activation_proof))) {
      throw new Error('A strict Claude profile requires verified current native hook trust and activation bound to the installed plugin bytes.');
    }
    const claudeCli = strict ? processLaunch.validateExecutable(selected.claude_cli || 'claude') : null;
    if (Object.hasOwn(selected, 'resource_state') || Object.hasOwn(selected, 'resourceState')) {
      throw new Error('Caller-provided resource evidence cannot configure a production profile.');
    }
    const direct = topology === TOPOLOGIES.CLAUDE_DIRECT;
    const resourceCapability = direct ? inspectResourceCapability() : { supported: false, source: 'not-applicable' };
    const resourceSource = resourceCapability.source;
    if (direct && (!resourceCapability.supported || !['proc-meminfo', 'win32-operating-system'].includes(resourceSource))) {
      throw new Error('Toolkit-managed direct Claude profiles require supported validated resource counters.');
    }
    const profile = {
      schema: SCHEMA, host, topology, capacity_mode: capacityMode, manual_maximum: manualMaximum,
      worker_estimate_bytes: workerEstimate, queue_limit: MAX_QUEUE, reservation_limit: EMERGENCY_WORKER_CEILING,
      controller_version: CONTROL_VERSION, enforcement_verified: strict, activation_proof: strict ? selected.activation_proof : null,
      claude_cli: claudeCli,
      resource_counter_verified: direct,
      resource_counter_source: direct ? resourceSource : 'not-applicable',
      updated_at: new Date().toISOString(),
      enforcement: direct ? 'toolkit-launch-boundary' : (topology === TOPOLOGIES.ROOT_ONLY ? 'native-agent-hook-deny' : 'outside-toolkit-control'),
    };
    atomicWriteJson(this.path, profile);
    return { ...profile, status: 'configured', supported: true };
  }

  invalidate(reason) {
    const host = this.#host;
    HostProfileStore.#supportedHost(host);
    const profile = {
      schema: SCHEMA, host, topology: TOPOLOGIES.ROOT_ONLY, capacity_mode: CAPACITY_MODES.ROOT_ONLY,
      manual_maximum: 0, worker_estimate_bytes: DEFAULT_WORKER_COST, queue_limit: MAX_QUEUE,
      reservation_limit: EMERGENCY_WORKER_CEILING, controller_version: CONTROL_VERSION,
      enforcement_verified: false, enforcement: 'unverified-root-only-policy', updated_at: new Date().toISOString(),
      invalidation_reason: String(reason || 'Current enforcement capability could not be verified.'),
    };
    atomicWriteJson(this.path, profile);
    return rootOnlyProfile(host, 'capability-lost-root-only', profile.invalidation_reason);
  }
}

function readProfile(host = 'claude-code', options = {}) { return new HostProfileStore(host, options).read(); }
function configureProfile(host, selected, options = {}) { return new HostProfileStore(host, options).configure(selected); }
function invalidateProfile(host, reason, options = {}) { return new HostProfileStore(host, options).invalidate(reason); }
function nativeResourceState(value, source, metadata = null) {
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
  if (metadata) NATIVE_RESOURCE_METADATA.set(state, Object.freeze({ ...metadata }));
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
  }, 'proc-meminfo', { overcommit_mode: counters.overcommit_mode, raw_counters: counters.raw_counters });
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

function executableDigest(filePath) {
  const absolute = path.resolve(String(filePath || ''));
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(absolute) !== absolute) throw new Error('Worker executable identity is not a private regular file.');
  return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

function mode0ControlledFixtureWorker(rootInput) {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') throw new Error('The controlled fixture worker is unavailable.');
  const root = path.resolve(String(rootInput || ''));
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid()
    || (rootStat.mode & 0o077) !== 0 || fs.realpathSync(root) !== root) throw new Error('The controlled fixture root is not task-owned.');
  const sourcePath = path.resolve(__dirname, '../tests/toolkit-c1-run093-reclosure.test.cjs');
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || fs.realpathSync(sourcePath) !== sourcePath
    || sourceStat.size !== 116672) throw new Error('The accepted fixture source identity is unavailable.');
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceDigest = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  if (sourceBytes.length !== 116672 || sourceDigest !== MODE0_FIXTURE_SOURCE_SHA256) throw new Error('The accepted fixture source bytes changed.');
  const source = sourceBytes.toString('utf8');
  const startMarker = '  fs.writeFileSync(cli, [';
  const endMarker = "  ].join('\\n'), 'utf8');";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || source.indexOf(startMarker, start + 1) >= 0
    || source.indexOf(endMarker, end + 1) >= 0) throw new Error('The accepted fixture executable template is ambiguous.');
  const delayMatches = [...source.matchAll(/const worker = createSupervisorFixture\(root, ([0-9]+)\);/g)];
  if (delayMatches.length !== 1 || Number(delayMatches[0][1]) !== 1000) throw new Error('The accepted fixture lifecycle bound changed.');
  const setup = require('./setup-claude-toolkit-plugin.cjs');
  const executable = path.join(root, 'fake-claude.cjs');
  const witness = path.join(root, 'worker-witness.log');
  const entry = {
    id: setup.pluginId(), version: CONTROL_VERSION, enabled: true, trusted: true,
    hooksActive: true, installPath: path.join(root, 'cache'),
  };
  const template = source.slice(start + startMarker.length, end);
  const scriptLines = [];
  for (const rawLine of template.split(/\r?\n/)) {
    let expression = rawLine.trim();
    if (!expression) continue;
    if (expression.endsWith(',')) expression = expression.slice(0, -1).trim();
    if (expression.startsWith('"')) {
      scriptLines.push(JSON.parse(expression));
    } else if (/^'[^'\\]*'$/.test(expression)) {
      scriptLines.push(expression.slice(1, -1));
    } else if (expression === '`const entry=${JSON.stringify(entry)};`') {
      scriptLines.push(`const entry=${JSON.stringify(entry)};`);
    } else if (expression === '`const witness=${JSON.stringify(witness)};`') {
      scriptLines.push(`const witness=${JSON.stringify(witness)};`);
    } else if (expression === '...(workerDelayMs > 0 ? [`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${workerDelayMs});`] : [])') {
      scriptLines.push('Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);');
    } else {
      throw new Error('The accepted fixture executable template contains an unsupported expression.');
    }
  }
  const expectedBytes = Buffer.from(scriptLines.join('\n'), 'utf8');
  const stat = fs.lstatSync(executable);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid()
    || (stat.mode & 0o022) !== 0 || fs.realpathSync(executable) !== executable) throw new Error('The controlled fixture executable path is not owned and regular.');
  const executableBytes = fs.readFileSync(executable);
  if (!executableBytes.equals(expectedBytes)) throw new Error('The controlled fixture executable bytes do not match the accepted source.');
  // This immutable test worker supplies the bounded child process only; host admission always uses readProfile.
  return Object.freeze({
    executable, executable_sha256: crypto.createHash('sha256').update(executableBytes).digest('hex'),
    source_sha256: sourceDigest,
  });
}

async function captureMode0ResourceEnvelope(spec, profile, options, effectChannel) {
  let receipt;
  try { receipt = require('./toolkit-github-program-receipt.cjs'); receipt.assertAuthenticControllerEffectChannel(effectChannel); }
  catch (_) { return null; }
  if (typeof effectChannel.resourceOperation !== 'function') return null;
  let snapshot;
  try { snapshot = effectChannel.snapshot(); } catch (_) { return null; }
  const identity = snapshot?.decision?.identity;
  if (!identity || snapshot.consumer?.stage !== 'G3' || identity.repository !== MODE0_REPOSITORY
    || identity.run !== MODE0_RUN || identity.lock !== MODE0_LOCK
    || !/^[a-f0-9]{64}$/.test(snapshot.decision_digest || '')) return null;
  const resources = inspectResources();
  const metadata = resources && NATIVE_RESOURCE_METADATA.get(resources);
  if (process.platform !== 'linux' || !validResourceState(resources) || !NATIVE_RESOURCE_STATES.has(resources)
    || resources.source !== 'proc-meminfo' || metadata?.overcommit_mode !== 0) return null;
  let workerExecutable;
  let workerExecutableSha256;
  try {
    workerExecutable = processLaunch.assertExecutableAvailable(effectiveClaudeCommand(profile, options), { env: effectiveEnvironment(options) });
    workerExecutableSha256 = executableDigest(workerExecutable);
  } catch (_) { return null; }
  const jobIdentityDigest = resourceJobIdentityDigest(spec, workerExecutable);
  let envelope;
  try {
    envelope = resourceDataCopy(await effectChannel.resourceOperation({
      action: 'OBSERVE', case_id: MODE0_CASE_ID, decision_digest: snapshot.decision_digest,
      job_identity_digest: jobIdentityDigest, lock: identity.lock, repository: identity.repository, run: identity.run,
    }));
  } catch (_) { return null; }
  if (!validMode0ResourceEnvelope(envelope, {
    repository: identity.repository, run: identity.run, lock: identity.lock,
    decision_digest: snapshot.decision_digest, workload_digest: jobIdentityDigest,
    job_identity_digest: jobIdentityDigest, workerExecutable, workerExecutableSha256,
  })) return null;
  if (envelope.resources.physical_total !== resources.physical_total
    || envelope.resources.commit_total !== resources.commit_total
    || resources.physical_available < MODE0_HOST_RESERVE_BYTES) return null;
  MODE0_RESOURCE_ENVELOPES.set(envelope, Object.freeze({ decision_digest: snapshot.decision_digest, job_identity_digest: jobIdentityDigest }));
  return { envelope, resources, workerExecutable, jobIdentityDigest };
}


const TRIVIAL_CHANGE_KINDS = new Set(['typo-only-docs', 'mechanical-comment-only', 'generated-only-authoritative-validated']);
const GENERATED_ONLY_PREFIXES = ['skills/', '.codex-plugin/', '.claude-plugin/'];
const PACKAGED_OR_RUNTIME_PREFIXES = [
  'repo/scripts/', 'repo/tests/', 'repo/contracts/', 'repo/source-watch/', 'skills/', '.codex-plugin/', '.claude-plugin/',
  '.agents/', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'package.json', 'package-lock.json',
];
const CHECKER_CONTEXT_LIMITS = Object.freeze({ task: 64 * 1024, files: 64 * 1024, diff: 512 * 1024, validation: 64 * 1024, surrounding: 128 * 1024 });

function canonicalChangedFiles(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const slash = String(value).replace(/\\/g, '/');
    if (!slash || slash.startsWith('/') || /^[A-Za-z]:[/]/.test(slash)) throw new Error('Changed files must use repository-relative paths.');
    const normalized = path.posix.normalize(slash);
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) throw new Error('Changed files must stay inside the repository.');
    return normalized;
  });
}

function checkerRequirement(input = {}) {
  const rawFiles = Array.isArray(input.changed_files) ? input.changed_files : [];
  if (input.implementation_complete !== true || input.focused_validation_passed !== true
    || input.diff_ready !== true || rawFiles.length === 0) {
    return { required: false, ready: false, reason: 'Checker decision requires completed implementation, passed focused validation, a ready diff, and changed files.' };
  }
  let files;
  try { files = canonicalChangedFiles(rawFiles); }
  catch {
    return { required: true, ready: true, reason: 'Noncanonical changed-file paths cannot qualify for trivial checker skipping.' };
  }
  const highRisk = files.some((file) => PACKAGED_OR_RUNTIME_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix)));
  const trivialKind = String(input.change_kind || '');
  const docsOnly = files.every((file) => /\.(?:md|txt)$/i.test(file));
  const generatedOnly = trivialKind === 'generated-only-authoritative-validated'
    && input.authoritative_source_independently_validated === true
    && files.every((file) => GENERATED_ONLY_PREFIXES.some((prefix) => file.startsWith(prefix)));
  const docsTrivial = ['typo-only-docs', 'mechanical-comment-only'].includes(trivialKind) && docsOnly && !highRisk;
  const permittedTrivial = TRIVIAL_CHANGE_KINDS.has(trivialKind) && (docsTrivial || generatedOnly);
  return permittedTrivial
    ? { required: false, ready: true, result: CHECKER_RESULTS.SKIPPED_TRIVIAL, reason: 'The deterministic trivial-change classifier matched a verified docs-only or declared generated-only contract.' }
    : { required: true, ready: true, reason: highRisk ? 'Packaged or runtime behavior requires independent pre-PR checking.' : 'Meaningful code-changing work requires independent pre-PR checking.' };
}

function boundedText(value, limit, label) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error(`${label} exceeds the bounded checker context limit.`);
  return text;
}

function requiredBoundedText(value, limit, label) {
  const text = boundedText(value, limit, label);
  if (!text.trim()) throw new Error(`${label} is required for checker review.`);
  return text;
}

function checkerContext(input = {}) {
  const changedFiles = canonicalChangedFiles(input.changed_files);
  if (!changedFiles.length || changedFiles.length > 200) throw new Error('Checker context requires 1-200 changed files.');
  if (Buffer.byteLength(JSON.stringify(changedFiles), 'utf8') > CHECKER_CONTEXT_LIMITS.files) throw new Error('Changed-file list exceeds the bounded checker context limit.');
  return Object.freeze({
    task_contract: requiredBoundedText(input.task_contract, CHECKER_CONTEXT_LIMITS.task, 'Task contract'),
    changed_files: Object.freeze(changedFiles),
    diff: requiredBoundedText(input.diff, CHECKER_CONTEXT_LIMITS.diff, 'Diff'),
    focused_validation: requiredBoundedText(input.focused_validation, CHECKER_CONTEXT_LIMITS.validation, 'Focused validation'),
    surrounding_invariants: boundedText(input.surrounding_invariants, CHECKER_CONTEXT_LIMITS.surrounding, 'Surrounding invariants'),
    review_checks: Object.freeze(['semantic parity', 'edge and fail-closed cases', 'behavioral test strength', 'Windows/POSIX portability', 'security and privacy', 'generated-source coupling', 'version alignment', 'stale-state migration', 'user-owned-state preservation', 'scope control']),
  });
}

function buildCheckerPrompt(context) {
  const boundedContext = checkerContext(context);
  const childPrompt = JSON.stringify({
    instructions: 'Perform a local-only read-only adversarial review of the bounded ready diff. Do not mutate files, run mutating commands, access network tools, or launch children.',
    result_contract: {
      statuses: [CHECKER_RESULTS.PASS, CHECKER_RESULTS.FINDINGS],
      pass: 'Return PASS only when no actionable finding remains.',
      findings: 'Return FINDINGS with bounded file and evidence details for every actionable defect.',
      format: 'Return only one JSON object: {"status":"PASS","findings":[]} or {"status":"FINDINGS","findings":[{"file":"...","evidence":"..."}]}.',
    },
    context: boundedContext,
  });
  if (Buffer.byteLength(childPrompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('Checker prompt exceeds the bounded private transport limit.');
  const digest = crypto.createHash('sha256').update(childPrompt, 'utf8').digest('hex');
  return { boundedContext, childPrompt, digest };
}

function validateCheckerPrompt(childPrompt) {
  let rebuilt;
  try {
    const parsed = JSON.parse(String(childPrompt || ''));
    rebuilt = buildCheckerPrompt(parsed?.context);
  } catch { throw new Error('Checker launch requires a factory-validated bounded context prompt.'); }
  if (rebuilt.childPrompt !== childPrompt) throw new Error('Checker launch requires a factory-validated bounded context prompt.');
  return rebuilt;
}

function checkerLaunchSpec(host, context, overrides = {}) {
  if (!Object.values(HOSTS).includes(host)) throw new Error('Unsupported checker host.');
  const mapping = MODEL_CONTRACT[host];
  const { childPrompt, digest } = buildCheckerPrompt(context);
  return {
    ...overrides,
    role: ROLES.CHECKER, host, depth: 1, effort: mapping.effort, model: mapping.checker,
    read_only: true, may_edit: false, may_commit: false, may_push: false, may_open_pr: false, may_merge_pr: false, may_spawn_children: false,
    review_id: 'checker-' + digest,
    checker_context_digest: digest,
    child_responsibility: 'Adversarially review the bounded ready diff and report evidence without mutating it.',
    parent_responsibility: 'Inspect checker evidence, own every fix, and retain final integration judgement.',
    integration_plan: 'The root alone applies any fixes and integrates the final implementation.',
    validation_plan: 'The root reruns focused validation after every accepted checker finding.',
    material_benefit: 'A fresh bounded context can catch semantic defects before pull-request review.',
    child_prompt: childPrompt,
  };
}

function checkerResult(status, details = {}) {
  if (!Object.values(CHECKER_RESULTS).includes(status)) throw new Error('Unknown checker result.');
  const findings = Array.isArray(details.findings) ? details.findings : [];
  if (status === CHECKER_RESULTS.FINDINGS && (!findings.length || findings.some((finding) => !finding || typeof finding.file !== 'string' || !finding.file || typeof finding.evidence !== 'string' || finding.evidence.length < 12))) throw new Error('FINDINGS requires bounded file and evidence details.');
  if (status === CHECKER_RESULTS.PASS && findings.length) throw new Error('PASS cannot contain findings.');
  if (status === CHECKER_RESULTS.ADMISSION_DENIED && details.root_self_review_performed !== true) throw new Error('ADMISSION_DENIED requires a recorded bounded root self-review.');
  return { status, findings, reason: String(details.reason || ''), root_self_review_performed: details.root_self_review_performed === true };
}

function checkerResultFromClaudeOutput(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  if (!bytes.length || bytes.length > MAX_CHECKER_OUTPUT_BYTES) throw new Error('Checker output is empty or exceeds the bounded result limit.');
  let envelope;
  try { envelope = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Checker output is not valid Claude JSON.'); }
  if (!envelope || envelope.type !== 'result' || envelope.subtype !== 'success'
    || envelope.is_error !== false || typeof envelope.result !== 'string') {
    throw new Error('Checker output is not a successful Claude result envelope.');
  }
  let payload;
  try { payload = JSON.parse(envelope.result); }
  catch { throw new Error('Checker result payload is not valid JSON.'); }
  if (!payload || typeof payload !== 'object' || ![CHECKER_RESULTS.PASS, CHECKER_RESULTS.FINDINGS].includes(payload.status)) {
    throw new Error('Checker result payload must be PASS or FINDINGS.');
  }
  return checkerResult(payload.status, { findings: payload.findings, reason: payload.reason });
}

function checkerAdmissionOutcome(admission, details = {}) {
  if (admission?.result === RESULTS.START) return { status: 'ADMITTED', reservation_id: admission.reservation_id };
  if (details.root_self_review_performed !== true) {
    return {
      status: CHECKER_RESULTS.ADMISSION_DENIED,
      findings: [],
      reason: 'The canonical Toolkit resource gate could not safely admit the checker.',
      root_self_review_required: true,
      root_self_review_performed: false,
      root_self_review_contract: 'Perform and report a bounded root self-review; do not represent it as independent verification.',
    };
  }
  return checkerResult(CHECKER_RESULTS.ADMISSION_DENIED, {
    reason: 'The canonical Toolkit resource gate could not safely admit the checker.',
    root_self_review_performed: details.root_self_review_performed === true,
  });
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
  if (!Object.values(ROLES).includes(role)) throw new Error('Unsupported child role.');
  if (!Object.values(HOSTS).includes(host)) throw new Error('Unsupported child host.');
  const expectedModel = MODEL_CONTRACT[host][role];
  const model = String(spec.model || expectedModel);
  if (model !== expectedModel) throw new Error('The child must use the declared sticky host model contract.');
  if (role === ROLES.CHECKER) {
    const immutable = spec.read_only === true && spec.may_edit === false && spec.may_commit === false && spec.may_push === false
      && spec.may_open_pr === false && spec.may_merge_pr === false && spec.may_spawn_children === false;
    if (!immutable || !String(spec.review_id || '').trim()) throw new Error('The checker must be a bounded read-only direct reviewer.');
    const prompt = validateCheckerPrompt(spec.child_prompt);
    if (spec.checker_context_digest !== prompt.digest || spec.review_id !== 'checker-' + prompt.digest) {
      throw new Error('Checker identity must be derived from its factory-validated bounded context.');
    }
    if (model !== MODEL_CONTRACT[host].checker || String(spec.effort || 'medium').toLowerCase() !== 'medium') {
      throw new Error('The checker must use the declared host checker model at medium effort.');
    }
  } else {
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
  return { ...spec, host, role, model, depth, effort };
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
  let profile = options.profile || (host === HOSTS.CLAUDE ? readProfile(HOSTS.CLAUDE, options) : { capacity_mode: CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: DEFAULT_WORKER_COST });
  if (options.profile) {
    try { profile = resourceDataCopy(profile); } catch (_) { return refusal('The selected host admission profile could not be verified safely.'); }
  }
  if (profile.capacity_mode === CAPACITY_MODES.ROOT_ONLY) return refusal('The selected host profile is root-only and cannot admit a child.');
  if (!validAdmissionProfile(profile)) return refusal('The selected host admission profile could not be verified safely.');
  if (host === HOSTS.CLAUDE) {
    if (profile.supported !== true || profile.status !== 'configured' || profile.enforcement_verified !== true
      || profile.controller_version !== CONTROL_VERSION || profile.topology !== TOPOLOGIES.CLAUDE_DIRECT
      || ![CAPACITY_MODES.AUTO, CAPACITY_MODES.MANUAL].includes(profile.capacity_mode)) return refusal('The selected Claude profile is root-only, stale, unsupported, or outside the verified Toolkit launch boundary.');
    if (!verifyCurrentClaudeEnforcement(profile, options)) return refusal('Current Claude plugin trust, hook activation, and installed enforcement identity could not be verified.');
  } else {
    return refusal('No production Toolkit launch interceptor is installed for this host; native child launches remain root-only.');
  }
  const selectedResources = selectResourceEvidence(options);
  if (!selectedResources.ok) return refusal('Resource state could not be verified safely.');
  const resources = selectedResources.resources || inspectResources({});
  if (!validResourceState(resources) || !NATIVE_RESOURCE_STATES.has(resources)
    && !(TEST_RESOURCE_STATES.has(resources) && selectedResources.context)) return refusal('Resource state could not be verified safely.');
  return resourceAdmissionDecisionValidated(spec, profile, resources, options, RESOURCE_PRODUCTION_ADMISSION, selectedResources.context);
}

async function admissionDecisionWithResourceEnvelope(specInput, effectChannel, options = {}) {
  try { specInput = resourceDataCopy(specInput); options = resourceOptionShell(options); }
  catch (_) { return refusal('Resource state could not be verified safely.'); }
  if (['resourceState','resource_state','resource','resources','resource_origin','resourceOrigin','resource_provenance',
    'resourceProvenance','producer_provenance','repository_test_invocation','repositoryTestInvocation','effectChannel']
    .some((key) => Object.hasOwn(options, key))) return refusal('Mode-0 resource authority cannot be supplied through options or fixtures.');
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  try { spec = validateLaunchSpec(specInput); } catch (error) { return refusal(error.message); }
  if (spec.host !== HOSTS.CLAUDE || spec.role !== ROLES.WORKER || spec.depth !== 1 || spec.queue_id
    || Number(spec.estimated_memory_bytes || 0) !== MODE0_WORKER_BYTES) return refusal('The mode-0 envelope is limited to its exact worker request.');
  let profile = options.profile || readProfile(HOSTS.CLAUDE, options);
  if (options.profile) {
    try { profile = resourceDataCopy(profile); } catch (_) { return refusal('The selected host admission profile could not be verified safely.'); }
  }
  if (profile.capacity_mode === CAPACITY_MODES.ROOT_ONLY || !validAdmissionProfile(profile)
    || profile.supported !== true || profile.status !== 'configured' || profile.enforcement_verified !== true
    || profile.controller_version !== CONTROL_VERSION || profile.topology !== TOPOLOGIES.CLAUDE_DIRECT
    || !verifyCurrentClaudeEnforcement(profile, { ...options, claudeCli: profile.claude_cli })) return refusal('The selected host profile is not the current verified Claude enforcement boundary.');
  const captured = await captureMode0ResourceEnvelope(spec, profile, options, effectChannel);
  if (!captured) return refusal('The authentic current mode-0 host envelope could not be verified.');
  return resourceAdmissionDecisionValidated(spec, profile, captured.resources, options,
    RESOURCE_PRODUCTION_ADMISSION, null, captured.envelope);
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

function resourceAdmissionDecisionValidated(spec, profile, resources, options, producerAuthority = null, testContext = null, mode0Envelope = null) {
  const host = spec.host;
  const origin = resourceOrigin(resources, testContext);
  if (!origin || origin === 'native' && producerAuthority !== RESOURCE_PRODUCTION_ADMISSION
    || origin === 'repository-test' && !testContext) return refusal('Resource provenance could not be established safely.');
  const workerExecutable = host === HOSTS.CLAUDE ? effectiveClaudeCommand(profile, options) : '';
  const jobIdentityDigest = resourceJobIdentityDigest(spec, workerExecutable);
  const mode0Metadata = NATIVE_RESOURCE_METADATA.get(resources);
  const mode0Binding = mode0Envelope && MODE0_RESOURCE_ENVELOPES.get(mode0Envelope);
  if (mode0Envelope && (!mode0Binding || process.platform !== 'linux' || mode0Metadata?.overcommit_mode !== 0
    || host !== HOSTS.CLAUDE || spec.role !== ROLES.WORKER || spec.depth !== 1
    || Number(spec.estimated_memory_bytes || 0) !== MODE0_WORKER_BYTES
    || mode0Binding.job_identity_digest !== jobIdentityDigest
    || !validMode0ResourceEnvelope(mode0Envelope, { job_identity_digest: jobIdentityDigest, workload_digest: jobIdentityDigest }))) {
    return refusal('The captured mode-0 resource envelope does not bind this exact worker.');
  }
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
    if (spec.role === ROLES.CHECKER && state.reservations.some((entry) => entry.role === ROLES.CHECKER)) return refusal('Exactly one independent checker may be active.');
    if (spec.role === ROLES.CHECKER && state.checker_reviews.some((entry) => entry.review_id === spec.review_id)) return refusal('This pre-PR review already admitted its one independent checker.');
    const maximum = profile.capacity_mode === CAPACITY_MODES.MANUAL ? profile.manual_maximum : EMERGENCY_WORKER_CEILING;
    const physicalReserve = mode0Envelope ? MODE0_HOST_RESERVE_BYTES : Math.max(4 * GIB, resources.physical_total * 0.25);
    const commitReserve = mode0Envelope ? 0 : Math.max(6 * GIB, resources.commit_total * 0.20);
    const requested = Number(spec.estimated_memory_bytes || profile.worker_estimate_bytes);
    if (!Number.isSafeInteger(requested) || requested < MIN_WORKER_COST || requested > MAX_WORKER_COST) return refusal('The requested worker cost is unknown or outside the supported range.');
    if (mode0Envelope && (requested !== MODE0_WORKER_BYTES || active !== 0 || state.queue.length !== 0
      || state.checker_reviews.some((entry) => entry.status === 'pending')
      || resources.physical_available < MODE0_HOST_RESERVE_BYTES
      || mode0Envelope.resources.physical_available < MODE0_HOST_RESERVE_BYTES)) {
      return refusal('The fixed mode-0 envelope requires an otherwise empty reservation state and the fresh host reserve.');
    }
    const effectivePhysical = Math.max(0, resources.physical_available - reservedBytes);
    const effectiveCommit = Math.max(0, resources.commit_available - reservedBytes);
    const physicalAfter = effectivePhysical - requested;
    const commitAfter = effectiveCommit - requested;
    const critical = !mode0Envelope && (resources.physical_available / resources.physical_total < 0.08
      || resources.commit_available / resources.commit_total < 0.08);
    if (critical) return refusal('Current memory pressure is unsafe for another worker.');
    const queuedReservation = spec.queue_id ? state.queue.find((entry) => entry.id === spec.queue_id) : null;
    if (spec.queue_id && !queuedReservation) return refusal('The queue entry is missing or expired.');
    if (queuedReservation && (queuedReservation.host !== host || queuedReservation.role !== spec.role)) return refusal('The queue entry belongs to a different host or child role.');
    if (queuedReservation && (queuedReservation.producer_provenance.origin !== origin
      || queuedReservation.producer_provenance.job_identity_digest !== jobIdentityDigest)) {
      return refusal('The queued request cannot change or promote its resource provenance.');
    }
    if (state.queue.length && state.queue[0].id !== spec.queue_id) {
      if (spec.role === ROLES.CHECKER) return refusal('The required checker could not be admitted immediately.');
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'An earlier bounded queue entry is still waiting.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = {
        id: crypto.randomUUID(), host, topology: 'toolkit-controlled-direct', depth: spec.depth, role: spec.role,
        created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, estimated_memory_bytes: requested,
        effort: spec.effort, worker_executable: workerExecutable, job_identity_digest: jobIdentityDigest, status: RESULTS.QUEUE,
      };
      try { sealResourceProvenance('queue', queued, origin, resources.source, jobIdentityDigest, options, provenanceKey); }
      catch (_) { return refusal('Toolkit queue provenance could not be persisted safely.'); }
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason: 'Earlier Toolkit-controlled work is queued.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    }
    const temporarilyFull = mode0Envelope
      ? active !== 0 || resources.physical_available < MODE0_HOST_RESERVE_BYTES
      : active >= maximum || active >= EMERGENCY_WORKER_CEILING || physicalAfter < physicalReserve || commitAfter < commitReserve;
    if (temporarilyFull) {
      if (mode0Envelope) return refusal('The exact mode-0 envelope is not capacity-positive and cannot be queued.');
      if (spec.role === ROLES.CHECKER) return refusal('Verified memory capacity is unavailable for the required checker.');
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = {
        id: crypto.randomUUID(), host, topology: 'toolkit-controlled-direct', depth: spec.depth, role: spec.role,
        created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, estimated_memory_bytes: requested,
        effort: spec.effort, worker_executable: workerExecutable, job_identity_digest: jobIdentityDigest, status: RESULTS.QUEUE,
      };
      try { sealResourceProvenance('queue', queued, origin, resources.source, jobIdentityDigest, options, provenanceKey); }
      catch (_) { return refusal('Toolkit queue provenance could not be persisted safely.'); }
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    }
    if (queuedReservation) state.queue.shift();
    if (spec.effort !== 'medium' && state.reservations.some((entry) => entry.effort !== 'medium')) return refusal('A higher-effort child is already active; sibling effort escalation is not allowed.');
    const reservation = {
      id: crypto.randomUUID(), host, topology: 'toolkit-controlled-direct', depth: 1, role: spec.role,
      owner_pid: process.pid, created_at_ms: now, expires_at_ms: now + RESERVATION_TTL_MS,
      estimated_memory_bytes: requested, effort: spec.effort, worker_executable: workerExecutable,
      job_identity_digest: jobIdentityDigest, status: 'reserved',
    };
    try { sealResourceProvenance('reservation', reservation, origin, resources.source, jobIdentityDigest, options, provenanceKey, mode0Envelope); }
    catch (_) { return refusal('Toolkit reservation provenance could not be persisted safely.'); }
    state.reservations.push(reservation);
    if (spec.role === ROLES.CHECKER) {
      state.checker_reviews.push({ review_id: spec.review_id, reservation_id: reservation.id, admitted_at_ms: now, expires_at_ms: now + CHECKER_REVIEW_TTL_MS, status: 'pending' });
    }
    atomicWriteJson(statePath(options), state);
    return { result: RESULTS.START, reservation_id: reservation.id, expires_at_ms: reservation.expires_at_ms, profile: 'toolkit-controlled-direct', host, role: spec.role, model: MODEL_CONTRACT[host][spec.role], effort: spec.effort, non_fast: host === HOSTS.CLAUDE ? 'CLAUDE_CODE_DISABLE_FAST_MODE=1' : true, productive_parent: true };
  });
}

function updateReservation(id, updates, options = {}) {
  try { updates = resourceDataCopy(updates); } catch (_) { return false; }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)
    || Object.keys(updates).some((key) => !['status', 'owner_pid'].includes(key))
    || updates.status !== 'running'
    || Object.hasOwn(updates, 'owner_pid') && (!Number.isSafeInteger(updates.owner_pid) || updates.owner_pid <= 0)) return false;
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state) return false;
    if (!current.state.reservations.some((item) => item.id === id)) return false;
    const state = recoverState(current.state);
    const entry = state.reservations.find((item) => item.id === id);
    if (!entry || entry.status !== 'reserved') return false;
    if (entry.producer_provenance) return false;
    Object.assign(entry, updates);
    if (!validControlState(state)) return false;
    atomicWriteJson(statePath(options), state);
    return true;
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

function releaseSettledMode0Reservation(id, proof, options = {}) {
  const binding = proof && MODE0_SETTLEMENT_PROOFS.get(proof);
  if (!binding || binding.reservation_id !== id || binding.owner_pid !== process.pid) return false;
  const released = withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state || !validControlState(current.state)) return false;
    const now = Date.now();
    const state = recoverState(current.state, now);
    const key = resourceProvenanceKey(options, false);
    if (!key || !validControlState(state) || !validStateResourceProvenance(state, options, key)) return false;
    const entry = state.reservations.find((item) => item.id === id);
    if (!entry || entry.status !== 'running' || entry.owner_pid !== process.pid
      || entry.producer_provenance?.schema !== RESOURCE_PROVENANCE_SCHEMA_V2
      || !validResourceProvenance('reservation', entry, key)
      || entry.producer_provenance.admission_id !== binding.admission_id
      || entry.producer_provenance.job_identity_digest !== binding.job_identity_digest
      || !sameMode0EnvelopeIdentity(entry.producer_provenance.mode0_envelope, binding.envelope)
      || binding.settled_at_ms <= binding.started_at_ms || binding.domain_empty !== true
      || state.reservations.length !== 1 || state.queue.length !== 0
      || state.checker_reviews.some((review) => review.status === 'pending')) return false;
    const before = state.reservations.length;
    state.reservations = state.reservations.filter((item) => item.id !== id);
    if (state.reservations.length !== before - 1 || !validControlState(state)) return false;
    atomicWriteJson(statePath(options), state);
    return true;
  });
  if (released) MODE0_SETTLEMENT_PROOFS.delete(proof);
  return released;
}

function updateCheckerReview(reviewId, status, options = {}) {
  if (!['pending', 'completed'].includes(status)) return false;
  let outcome = null;
  if (status === 'completed') {
    try {
      const candidate = options.checker_result || {};
      if (![CHECKER_RESULTS.PASS, CHECKER_RESULTS.FINDINGS].includes(candidate.status)) return false;
      outcome = checkerResult(candidate.status, { findings: candidate.findings, reason: candidate.reason });
    } catch { return false; }
  }
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state) return false;
    const state = recoverState(current.state);
    const entry = state.checker_reviews.find((item) => item.review_id === reviewId);
    if (!entry) return false;
    entry.status = status;
    if (outcome) {
      entry.result = outcome.status;
      entry.findings_count = outcome.findings.length;
      entry.findings = outcome.findings;
      entry.reason = outcome.reason;
    }
    if (!validControlState(state)) return false;
    atomicWriteJson(statePath(options), state);
    return true;
  });
}

function clearPendingCheckerReview(reviewId, options = {}) {
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state) return false;
    const state = recoverState(current.state);
    const before = state.checker_reviews.length;
    state.checker_reviews = state.checker_reviews.filter((entry) => entry.review_id !== reviewId || entry.status === 'completed');
    if (state.checker_reviews.length === before) return false;
    atomicWriteJson(statePath(options), state);
    return true;
  });
}
function claudeInvocationArgs(checked) {
  const common = ['--print', '--output-format', 'json', '--model', checked.model, '--effort', checked.effort];
  if (checked.role === ROLES.CHECKER) {
    return [...common, '--tools', 'Read', 'Glob', 'Grep', '--disallowedTools', 'Agent', 'Task', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', '--permission-mode', 'plan', '--no-session-persistence'];
  }
  return [...common, '--disallowedTools', 'Agent', 'Task', '--permission-mode', 'default', '--no-session-persistence'];
}

function claudeInvocation(spec, options = {}) {
  const checked = validateLaunchSpec(spec);
  const envInput = effectiveEnvironment(options);
  const executable = processLaunch.resolveClaudeCommandInput({ explicit: options.claudeCli, persisted: options.persistedClaudeCli, env: envInput });
  const promptBytes = options.promptBytes || Buffer.from(String(checked.child_prompt || checked.child_responsibility), 'utf8');
  if (!Buffer.isBuffer(promptBytes) || promptBytes.length > MAX_PROMPT_BYTES) throw new Error('Child prompt exceeds the bounded private transport limit.');
  const args = claudeInvocationArgs(checked);
  const env = { ...envInput, CLAUDE_CODE_DISABLE_FAST_MODE: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', AI_AGENT_TOOLKIT_CHILD: '1' };
  if (checked.role === ROLES.CHECKER) env.AI_AGENT_TOOLKIT_CHECKER = '1';
  else delete env.AI_AGENT_TOOLKIT_CHECKER;
  const validatedExecutable = processLaunch.assertExecutableAvailable(executable, { env });
  return { executable: validatedExecutable, args, raw_executable: validatedExecutable, raw_args: args, env, stdin: promptBytes, effort: checked.effort, non_fast: true, max_depth: 1 };
}

function runValidatedClaude(invocation, captureChecker, options = {}) {
  const requestedTimeout = Number(options.checkerTimeoutMs);
  const checkerTimeoutMs = Number.isSafeInteger(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, CHECKER_TIMEOUT_MS)
    : CHECKER_TIMEOUT_MS;
  // Reuse the validated shell-free Claude launcher that setup probes and native enforcement share.
  const result = require('./setup-claude-toolkit-plugin.cjs').spawnClaude(invocation.raw_executable, invocation.raw_args, {
    env: invocation.env,
    windowsHide: true,
    input: invocation.stdin,
    timeout: captureChecker ? checkerTimeoutMs : undefined,
    killSignal: 'SIGTERM',
    maxBuffer: captureChecker ? MAX_CHECKER_OUTPUT_BYTES : undefined,
    stdio: ['pipe', captureChecker ? 'pipe' : 'inherit', 'inherit'],
  });
  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    output: captureChecker && Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    outputExceeded: result.error?.code === 'ENOBUFS',
    error: result.error || null,
  };
}

const CHECKER_INPUT_KEYS = new Set([
  'implementation_complete', 'focused_validation_passed', 'diff_ready', 'changed_files', 'change_kind',
  'authoritative_source_independently_validated', 'task_contract', 'diff', 'focused_validation',
  'surrounding_invariants', 'host', 'estimated_memory_bytes',
]);

function validateCheckerWorkflowInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Checker workflow input must be a JSON object.');
  const unexpected = Object.keys(input).filter((key) => !CHECKER_INPUT_KEYS.has(key));
  if (unexpected.length) throw new Error(`Checker workflow input contains unsupported fields: ${unexpected.join(', ')}.`);
  const host = String(input.host || HOSTS.CLAUDE);
  if (host !== HOSTS.CLAUDE) throw new Error('The supported checker launch workflow currently requires the verified Claude direct host.');
  return { ...input, host };
}

function checkerWorkflow(input, options = {}) {
  const checkedInput = validateCheckerWorkflowInput(input);
  const requirement = checkerRequirement(checkedInput);
  if (!requirement.ready) throw new Error(requirement.reason);
  if (!requirement.required) return checkerResult(CHECKER_RESULTS.SKIPPED_TRIVIAL, { reason: requirement.reason });
  const context = checkerContext(checkedInput);
  const overrides = {};
  if (checkedInput.estimated_memory_bytes !== undefined) overrides.estimated_memory_bytes = checkedInput.estimated_memory_bytes;
  const spec = checkerLaunchSpec(checkedInput.host, context, overrides);
  const launched = launch(spec, options);
  if (launched.result !== RESULTS.START) return checkerAdmissionOutcome(launched);
  const resultArgs = [path.resolve(__filename), 'checker-result', '--review-id', spec.review_id];
  if (options.root) resultArgs.push('--root', path.resolve(options.root));
  const quoteArgument = process.platform === 'win32'
    ? require('./codex-delegation-config.cjs').quotePowerShellArgument
    : require('./codex-delegation-config.cjs').quotePosixArgument;
  return {
    status: 'PENDING',
    review_id: spec.review_id,
    reservation_id: launched.reservation_id,
    result_invocation: { executable: process.execPath, args: resultArgs },
    result_command: ['node', ...resultArgs.map(quoteArgument)].join(' '),
    root_action: 'Continue productive root work; retrieve the validated result when it is needed for integration.',
  };
}

function checkerResultStatus(reviewId, options = {}) {
  const expected = String(reviewId || '');
  if (!/^checker-[a-f0-9]{64}$/.test(expected)) throw new Error('A deterministic checker review ID is required.');
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (current.exists && !current.state) throw new Error('Toolkit admission state could not be verified safely.');
    const state = recoverState(current.state || emptyState());
    const entry = state.checker_reviews.find((item) => item.review_id === expected);
    if (!entry) return { status: 'RETRY_REQUIRED', review_id: expected, reason: 'No pending or completed checker result exists; a failed attempt may be retried with the same bounded input.' };
    if (entry.status !== 'completed') return { status: 'PENDING', review_id: expected, root_action: 'Continue productive root work; do not idle-poll the checker.' };
    return checkerResult(entry.result, { findings: entry.findings || [], reason: entry.reason || '' });
  });
}

function readBoundedFd(fd, limit = MAX_CHECKER_INPUT_BYTES) {
  const chunks = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
    const count = fs.readSync(fd, chunk, 0, chunk.length, null);
    if (count === 0) break;
    total += count;
    if (total > limit) throw new Error('Checker workflow input exceeds the bounded private input limit.');
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

function readCheckerWorkflowInput(inputPath, options = {}) {
  let bytes;
  if (inputPath === '-') bytes = readBoundedFd(0);
  else {
    const target = path.resolve(String(inputPath || ''));
    const ownedInputRoot = path.join(controlRoot(options), 'inputs');
    if (path.dirname(target) !== ownedInputRoot) throw new Error('Checker input files must be direct private children of the Toolkit control inputs directory.');
    const stat = verifyPrivateRegularFile(target);
    try {
      if (stat.size > MAX_CHECKER_INPUT_BYTES) throw new Error('Checker workflow input exceeds the bounded private input limit.');
      bytes = fs.readFileSync(target);
    }
    finally { fs.unlinkSync(target); }
  }
  if (!bytes.length) throw new Error('Checker workflow input is empty.');
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Checker workflow input is not valid JSON.'); }
}

function claimLegacySupervisorReservation(reservationId, spec, jobIdentityDigest, workerExecutable, options = {}) {
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
      || entry.effort !== spec.effort || entry.topology !== 'toolkit-controlled-direct') return false;
    const priorClaims = inspectSupervisorClaimMarkers(options, entry.id, entry.producer_provenance.admission_id, key, now);
    if (!priorClaims.ok || priorClaims.claimed || priorClaims.count >= MAX_ACTIVE_SUPERVISOR_CLAIMS) return false;
    if (spec.role === ROLES.CHECKER) {
      const checkerReview = state.checker_reviews.find((review) => review.review_id === spec.review_id
        && review.reservation_id === entry.id && review.status === 'pending' && review.expires_at_ms > now);
      if (!checkerReview) return false;
    }

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

function mode0ReservationSnapshot(reservationId, options = {}) {
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state || !validControlState(current.state)) return { mode0: false, invalid: true };
    const entry = current.state.reservations.find((item) => item.id === reservationId);
    if (entry?.producer_provenance?.schema !== RESOURCE_PROVENANCE_SCHEMA_V2) return { mode0: false };
    const key = resourceProvenanceKey(options, false);
    const state = recoverState(current.state, Date.now());
    if (!key || !validControlState(state) || !validStateResourceProvenance(state, options, key)
      || !validResourceProvenance('reservation', entry, key)) return { mode0: true, invalid: true };
    return {
      mode0: true,
      envelope: resourceDataCopy(entry.producer_provenance.mode0_envelope),
      admission_id: entry.producer_provenance.admission_id,
      job_identity_digest: entry.producer_provenance.job_identity_digest,
    };
  });
}

async function claimMode0SupervisorReservation(reservationId, spec, jobIdentityDigest, workerExecutable, options, initialEnvelope) {
  const snapshot = withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state || !validControlState(current.state)) return null;
    const now = Date.now();
    const state = recoverState(current.state, now);
    const key = resourceProvenanceKey(options, false);
    if (!key || !validControlState(state) || !validStateResourceProvenance(state, options, key)) return null;
    const entry = state.reservations.find((item) => item.id === reservationId);
    if (!entry || entry.status !== 'reserved' || entry.expires_at_ms <= now
      || entry.producer_provenance?.schema !== RESOURCE_PROVENANCE_SCHEMA_V2
      || !validResourceProvenance('reservation', entry, key)
      || entry.producer_provenance.origin !== 'native'
      || entry.producer_provenance.job_identity_digest !== jobIdentityDigest
      || entry.job_identity_digest !== jobIdentityDigest || entry.worker_executable !== workerExecutable
      || entry.host !== HOSTS.CLAUDE || entry.role !== ROLES.WORKER || entry.depth !== 1
      || entry.topology !== 'toolkit-controlled-direct' || entry.estimated_memory_bytes !== MODE0_WORKER_BYTES
      || state.reservations.length !== 1 || state.queue.length !== 0
      || state.checker_reviews.some((review) => review.status === 'pending')) return null;
    const priorClaims = inspectSupervisorClaimMarkers(options, entry.id, entry.producer_provenance.admission_id, key, now);
    if (!priorClaims.ok || priorClaims.claimed || priorClaims.count >= MAX_ACTIVE_SUPERVISOR_CLAIMS
      || !sameMode0EnvelopeIdentity(initialEnvelope, entry.producer_provenance.mode0_envelope)) return null;
    return { envelope: resourceDataCopy(entry.producer_provenance.mode0_envelope), admission_id: entry.producer_provenance.admission_id };
  });
  if (!snapshot) return false;
  let fresh;
  try { fresh = await mode0TransportRequest(snapshot.envelope, 'OBSERVE', reservationId); }
  catch (_) { return false; }
  const observed = inspectResources();
  if (!validMode0OperationEnvelope(snapshot.envelope, fresh, spec, workerExecutable, jobIdentityDigest, observed)) return false;
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state || !validControlState(current.state)) return false;
    const now = Date.now();
    const state = recoverState(current.state, now);
    const key = resourceProvenanceKey(options, false);
    if (!key || !validControlState(state) || !validStateResourceProvenance(state, options, key)) return false;
    const entry = state.reservations.find((item) => item.id === reservationId);
    if (!entry || entry.status !== 'reserved' || entry.expires_at_ms <= now
      || entry.producer_provenance?.schema !== RESOURCE_PROVENANCE_SCHEMA_V2
      || !validResourceProvenance('reservation', entry, key)
      || entry.producer_provenance.admission_id !== snapshot.admission_id
      || entry.producer_provenance.job_identity_digest !== jobIdentityDigest
      || entry.job_identity_digest !== jobIdentityDigest || entry.worker_executable !== workerExecutable
      || entry.host !== HOSTS.CLAUDE || entry.role !== ROLES.WORKER || entry.depth !== 1
      || entry.topology !== 'toolkit-controlled-direct' || entry.estimated_memory_bytes !== MODE0_WORKER_BYTES
      || state.reservations.length !== 1 || state.queue.length !== 0
      || state.checker_reviews.some((review) => review.status === 'pending')
      || !sameMode0EnvelopeIdentity(snapshot.envelope, entry.producer_provenance.mode0_envelope)
      || !mode0NativeObservationMatches(fresh, inspectResources())
      || fresh.observed_at_ms > now + 1000 || fresh.expires_at_ms <= now
      || fresh.resources.physical_available < MODE0_HOST_RESERVE_BYTES) return false;
    if (!persistSupervisorClaimMarker(entry, options, key, now)) return false;
    entry.owner_pid = process.pid;
    entry.status = 'running';
    try {
      sealResourceProvenance('reservation', entry, 'native', 'proc-meminfo', jobIdentityDigest, options, key, snapshot.envelope);
    } catch (_) { return false; }
    if (!validControlState(state)) return false;
    atomicWriteJson(statePath(options), state);
    return true;
  });
}

async function claimSupervisorReservation(reservationId, spec, jobIdentityDigest, workerExecutable, options = {}) {
  if (RESOURCE_TEST_CONTEXT.getStore() || spec.host !== HOSTS.CLAUDE) return false;
  const candidate = mode0ReservationSnapshot(reservationId, options);
  if (candidate.mode0) {
    if (candidate.invalid || !candidate.envelope) return false;
    return claimMode0SupervisorReservation(reservationId, spec, jobIdentityDigest, workerExecutable, options, candidate.envelope);
  }
  return claimLegacySupervisorReservation(reservationId, spec, jobIdentityDigest, workerExecutable, options);
}

function mode0LifecycleByteCount(root, reservationId) {
  const jobs = path.join(root, 'jobs');
  const jobNames = [`${reservationId}.json`, `${reservationId}.stdout.json`, `${reservationId}.stderr.log`,
    `${reservationId}.mode0.stdout`, `${reservationId}.mode0.stderr`];
  let total = 0;
  const seen = new Set();
  for (const target of [...jobNames.map((name) => path.join(jobs, name)), statePath({ root })]) {
    if (seen.has(target)) continue;
    seen.add(target);
    const stat = verifyPrivateRegularFile(target);
    if (total > MODE0_LIFECYCLE_BYTES - stat.size) throw new Error('Mode-0 lifecycle evidence exceeds its total bound.');
    total += stat.size;
  }
  return total;
}

async function executeMode0Lifecycle(reservationId, spec, workerExecutable, jobIdentityDigest, options = {}) {
  const snapshot = mode0ReservationSnapshot(reservationId, options);
  if (!snapshot.mode0 || snapshot.invalid || !snapshot.envelope) throw new Error('The sealed mode-0 reservation could not be recovered.');
  const envelope = snapshot.envelope;
  if (envelope.job_identity_digest !== jobIdentityDigest || envelope.worker.executable_path !== workerExecutable
    || executableDigest(workerExecutable) !== envelope.worker.executable_sha256) throw new Error('The sealed mode-0 job identity changed.');
  const preStart = await mode0TransportRequest(envelope, 'OBSERVE', reservationId);
  const native = inspectResources();
  if (!validMode0OperationEnvelope(envelope, preStart, spec, workerExecutable, jobIdentityDigest, native)) {
    throw new Error('The fresh pre-start mode-0 observation no longer meets the admitted envelope.');
  }
  const startReply = await mode0TransportRequest(envelope, 'START', reservationId);
  const start = validateMode0StartResult(startReply.result, preStart, reservationId, workerExecutable);
  const settleReply = await mode0TransportRequest(envelope, 'SETTLE', reservationId);
  const settlement = validateMode0SettlementResult(settleReply.result, start, preStart, reservationId);
  const jobs = path.join(controlRoot(options), 'jobs');
  const stdout = readMode0Output(path.join(jobs, `${reservationId}.mode0.stdout`), settlement.stdout_bytes, settlement.stdout_sha256);
  const stderr = readMode0Output(path.join(jobs, `${reservationId}.mode0.stderr`), settlement.stderr_bytes, settlement.stderr_sha256);
  mode0LifecycleByteCount(controlRoot(options), reservationId);
  const proof = Object.freeze({ schema: MODE0_SETTLEMENT_RESULT_SCHEMA, settlement_digest: settlement.outcome_digest });
  const current = mode0ReservationSnapshot(reservationId, options);
  if (!current.mode0 || current.invalid || !current.envelope) throw new Error('The mode-0 reservation changed before settled release.');
  MODE0_SETTLEMENT_PROOFS.set(proof, {
    reservation_id: reservationId,
    owner_pid: process.pid,
    admission_id: current.admission_id,
    job_identity_digest: jobIdentityDigest,
    envelope: current.envelope,
    started_at_ms: start.started_at_ms,
    settled_at_ms: settlement.settled_at_ms,
    domain_empty: settlement.domain_empty,
  });
  if (!releaseSettledMode0Reservation(reservationId, proof, options)) {
    MODE0_SETTLEMENT_PROOFS.delete(proof);
    throw new Error('The exact externally settled reservation could not be released once.');
  }
  if (stdout.length) process.stdout.write(stdout);
  if (stderr.length) process.stderr.write(stderr);
  return settlement.exit_code;
}

function launch(specInput, options = {}) {
  try {
    specInput = resourceDataCopy(specInput);
    options = resourceOptionShell(options);
  } catch (_) { return refusal('Resource state could not be verified safely.'); }
  if (RESOURCE_TEST_CONTEXT.getStore()) return refusal('Repository-test resource context cannot launch production workers.');
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  let promptBytes;
  let profile;
  let claudeCli;
  try {
    profile = options.profile || readProfile('claude-code', options);
    claudeCli = effectiveClaudeCommand(profile, options);
    spec = validateLaunchSpec(specInput);
    promptBytes = Buffer.from(String(spec.child_prompt || spec.child_responsibility), 'utf8');
    if (promptBytes.length > MAX_PROMPT_BYTES) return refusal('Child prompt exceeds the bounded private transport limit.');
    claudeCli = processLaunch.assertExecutableAvailable(claudeCli, { env: effectiveEnvironment(options) });
  } catch (error) { return refusal(error.message); }
  const admitted = admissionDecision(spec, { ...options, profile, claudeCli });
  if (admitted.result !== RESULTS.START) return admitted;
  const root = controlRoot(options);
  const jobs = path.join(root, 'jobs');
  const specPath = path.join(jobs, `${admitted.reservation_id}.json`);
  const outputPath = path.join(jobs, `${admitted.reservation_id}.stdout.json`);
  const errorPath = path.join(jobs, `${admitted.reservation_id}.stderr.log`);
  let out;
  let err;
  try {
    const serialized = {
      ...spec,
      child_prompt: undefined,
      child_prompt_base64: promptBytes.toString('base64'),
      worker_executable: claudeCli,
    };
    createPrivateFile(specPath, `${JSON.stringify(serialized, null, 2)}\n`);
    createPrivateFile(outputPath);
    createPrivateFile(errorPath);
    out = fs.openSync(outputPath, 'w');
    err = fs.openSync(errorPath, 'w');
    const supervisorArgs = [__filename, 'supervise', '--root', root, '--reservation', admitted.reservation_id, '--spec', specPath];
    supervisorArgs.push('--claude-cli', claudeCli);
    const supervisor = spawn(process.execPath, supervisorArgs, { detached: true, windowsHide: true, stdio: ['ignore', out, err], env: effectiveEnvironment(options) });
    supervisor.unref();
    return { ...admitted, supervisor_pid: supervisor.pid, spec_path: specPath, output_path: outputPath, error_path: errorPath, status: 'launched' };
  } catch {
    releaseReservation(admitted.reservation_id, options);
    if (spec.role === ROLES.CHECKER) clearPendingCheckerReview(spec.review_id, options);
    for (const privatePath of [specPath, outputPath, errorPath]) {
      try { if (fs.existsSync(privatePath) && verifyPrivateRegularFile(privatePath)) fs.unlinkSync(privatePath); } catch {}
    }
    return refusal('Worker launch failed safely before execution.');
  } finally {
    if (out !== undefined) fs.closeSync(out);
    if (err !== undefined) fs.closeSync(err);
  }
}

async function launchWithResourceEnvelope(specInput, effectChannel, options = {}) {
  try {
    specInput = resourceDataCopy(specInput);
    options = resourceOptionShell(options);
  } catch (_) { return refusal('Resource state could not be verified safely.'); }
  if (RESOURCE_TEST_CONTEXT.getStore()) return refusal('Repository-test resource context cannot launch production workers.');
  const optionKeys = Object.keys(options);
  if (optionKeys.length !== 1 || optionKeys[0] !== 'root' || typeof options.root !== 'string'
    || !path.isAbsolute(options.root) || path.resolve(options.root) !== options.root) {
    return refusal('Mode-0 launch requires its exact owned resource root.');
  }
  if (['resourceState','resource_state','resource','resources','resource_origin','resourceOrigin','resource_provenance',
    'resourceProvenance','producer_provenance','repository_test_invocation','repositoryTestInvocation','effectChannel']
    .some((key) => Object.hasOwn(options, key))) return refusal('Mode-0 resource authority cannot be supplied through options or fixtures.');
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  let promptBytes;
  let profile;
  let claudeCli;
  try {
    const fixtureWorker = mode0ControlledFixtureWorker(options.root);
    profile = readProfile(HOSTS.CLAUDE, options);
    claudeCli = fixtureWorker.executable;
    spec = validateLaunchSpec(specInput);
    if (spec.host !== HOSTS.CLAUDE || spec.role !== ROLES.WORKER || spec.depth !== 1 || spec.queue_id
      || Number(spec.estimated_memory_bytes || 0) !== MODE0_WORKER_BYTES) {
      return refusal('The mode-0 envelope is limited to its exact worker request.');
    }
    promptBytes = Buffer.from(String(spec.child_prompt || spec.child_responsibility), 'utf8');
    if (promptBytes.length > MAX_PROMPT_BYTES) return refusal('Child prompt exceeds the bounded private transport limit.');
    claudeCli = processLaunch.assertExecutableAvailable(claudeCli, { env: effectiveEnvironment(options) });
  } catch (error) { return refusal(error.message); }
  const admitted = await admissionDecisionWithResourceEnvelope(spec, effectChannel, { ...options, profile, claudeCli });
  if (admitted.result !== RESULTS.START) return admitted;
  const root = controlRoot(options);
  const jobs = path.join(root, 'jobs');
  const specPath = path.join(jobs, `${admitted.reservation_id}.json`);
  const outputPath = path.join(jobs, `${admitted.reservation_id}.stdout.json`);
  const errorPath = path.join(jobs, `${admitted.reservation_id}.stderr.log`);
  const mode0StdoutPath = path.join(jobs, `${admitted.reservation_id}.mode0.stdout`);
  const mode0StderrPath = path.join(jobs, `${admitted.reservation_id}.mode0.stderr`);
  let out;
  let err;
  try {
    const serialized = {
      ...spec,
      child_prompt: undefined,
      child_prompt_base64: promptBytes.toString('base64'),
      worker_executable: claudeCli,
    };
    createPrivateFile(specPath, `${JSON.stringify(serialized, null, 2)}\n`);
    createPrivateFile(outputPath);
    createPrivateFile(errorPath);
    createPrivateFile(mode0StdoutPath);
    createPrivateFile(mode0StderrPath);
    mode0LifecycleByteCount(root, admitted.reservation_id);
    const expectedJobIdentityDigest = resourceJobIdentityDigest(spec, claudeCli);
    const preclaimSnapshot = withLock({ root }, () => {
      const stateFile = statePath({ root });
      const stateStat = verifyPrivateRegularFile(stateFile);
      const stateBytes = fs.readFileSync(stateFile);
      const specStat = verifyPrivateRegularFile(specPath);
      const specBytes = fs.readFileSync(specPath);
      if (stateBytes.length !== stateStat.size || specBytes.length !== specStat.size
        || stateBytes.length > MODE0_LIFECYCLE_BYTES || specBytes.length > MODE0_LIFECYCLE_BYTES) {
        throw new Error('Mode-0 pre-claim evidence changed or exceeded its bound.');
      }
      const stateAfter = verifyPrivateRegularFile(stateFile);
      const specAfter = verifyPrivateRegularFile(specPath);
      const stateBytesAfter = fs.readFileSync(stateFile);
      const specBytesAfter = fs.readFileSync(specPath);
      if (stateAfter.dev !== stateStat.dev || stateAfter.ino !== stateStat.ino || stateAfter.size !== stateStat.size
        || stateAfter.mtimeMs !== stateStat.mtimeMs || stateAfter.ctimeMs !== stateStat.ctimeMs
        || specAfter.dev !== specStat.dev || specAfter.ino !== specStat.ino || specAfter.size !== specStat.size
        || specAfter.mtimeMs !== specStat.mtimeMs || specAfter.ctimeMs !== specStat.ctimeMs
        || !stateBytes.equals(stateBytesAfter) || !specBytes.equals(specBytesAfter)) {
        throw new Error('Mode-0 pre-claim files changed while their bytes were captured.');
      }
      const state = JSON.parse(stateBytes.toString('utf8'));
      const storedSpec = JSON.parse(specBytes.toString('utf8'));
      const key = resourceProvenanceKey({ root }, false);
      const entry = Array.isArray(state?.reservations)
        ? state.reservations.find((item) => item.id === admitted.reservation_id) : null;
      if (!validControlState(state) || !key || !validStateResourceProvenance(state, { root }, key)
        || state.reservations.length !== 1 || state.queue.length !== 0
        || state.checker_reviews.some((review) => review.status === 'pending')
        || !entry || entry.status !== 'reserved' || entry.expires_at_ms <= Date.now()
        || entry.producer_provenance?.schema !== RESOURCE_PROVENANCE_SCHEMA_V2
        || !validResourceProvenance('reservation', entry, key)
        || entry.producer_provenance.job_identity_digest !== expectedJobIdentityDigest
        || entry.job_identity_digest !== expectedJobIdentityDigest
        || entry.worker_executable !== claudeCli
        || storedSpec.worker_executable !== claudeCli || storedSpec.host !== HOSTS.CLAUDE
        || storedSpec.role !== ROLES.WORKER || storedSpec.depth !== 1
        || Number(storedSpec.estimated_memory_bytes || 0) !== MODE0_WORKER_BYTES) {
        throw new Error('The exact sealed mode-0 pre-claim state or spec could not be verified.');
      }
      const envelope = resourceDataCopy(entry.producer_provenance.mode0_envelope);
      const capture = (filePath, bytes) => Object.freeze({
        path: filePath,
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        base64: bytes.toString('base64'),
      });
      return Object.freeze({
        schema: 'toolkit.agent-control.mode0-preclaim-snapshot.v1',
        reservation_id: admitted.reservation_id,
        job_identity_digest: expectedJobIdentityDigest,
        dispatch_id: envelope.dispatch_id,
        decision_digest: envelope.decision_digest,
        captured_at_ms: Date.now(),
        expires_at_ms: envelope.expires_at_ms,
        state: capture(stateFile, stateBytes),
        spec: capture(specPath, specBytes),
      });
    });
    out = fs.openSync(outputPath, 'w');
    err = fs.openSync(errorPath, 'w');
    const supervisorArgs = [__filename, 'supervise', '--root', root, '--reservation', admitted.reservation_id,
      '--spec', specPath, '--claude-cli', claudeCli];
    const supervisor = spawn(process.execPath, supervisorArgs, {
      detached: false, windowsHide: true, stdio: ['ignore', out, err],
      env: effectiveEnvironment(options),
    });
    const supervisorCompletion = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(completionTimer);
        resolve(Object.freeze(result));
      };
      const completionTimer = setTimeout(() => finish({
        state: 'UNRESOLVED',
        reason: 'MODE0_SUPERVISOR_COMPLETION_TIMEOUT',
        observed_at_ms: Date.now(),
      }), Math.max(1, Math.min(455000, preclaimSnapshot.expires_at_ms - Date.now())));
      if (typeof completionTimer.unref === 'function') completionTimer.unref();
      supervisor.once('error', () => finish({ state: 'SPAWN_ERROR', exit_code: null, signal: null, observed_at_ms: Date.now() }));
      supervisor.once('close', (exitCode, signal) => finish({
        state: 'CLOSED',
        exit_code: Number.isSafeInteger(exitCode) ? exitCode : null,
        signal: signal || null,
        observed_at_ms: Date.now(),
      }));
    });
    return {
      ...admitted,
      supervisor_pid: supervisor.pid,
      spec_path: specPath,
      output_path: outputPath,
      error_path: errorPath,
      settlement_stdout_path: mode0StdoutPath,
      settlement_stderr_path: mode0StderrPath,
      preclaim_snapshot: preclaimSnapshot,
      supervisor_completion: supervisorCompletion,
      status: 'launched',
    };
  } catch {
    return refusal('Worker launch could not be started safely; the mode-0 reservation remains held for recovery.');
  } finally {
    if (out !== undefined) fs.closeSync(out);
    if (err !== undefined) fs.closeSync(err);
  }
}

// One supervised worker run: load and verify the stored job specification, claim the
// reservation, execute the worker (mode-0 lifecycle or a validated Claude child) and
// settle checker review and reservation state. Settlement always runs; a mode-0
// reservation whose outcome is unresolved is retained, never released.
class WorkerSupervisor {
  #args; #options; #code = 1; #checkerOutcome = null; #claimed = false; #mode0 = false; #mode0Settled = false;
  #spec; #specPath; #workerExecutable = ''; #promptBytes = null; #jobIdentityDigest = '';

  constructor(args) { this.#args = args; this.#options = { root: args.root }; }

  // Verify the stored specification is the private job file for this reservation.
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
    this.#promptBytes = Buffer.from(encoded, 'base64');
    if (!encoded || this.#promptBytes.toString('base64') !== encoded || this.#promptBytes.length > MAX_PROMPT_BYTES) {
      throw new Error('Stored child prompt transport is malformed.');
    }
    const jobSpec = { ...stored };
    delete jobSpec.child_prompt_base64;
    delete jobSpec.worker_executable;
    jobSpec.child_prompt = this.#promptBytes.toString('utf8');
    this.#spec = validateLaunchSpec(jobSpec);
    this.#jobIdentityDigest = resourceJobIdentityDigest(this.#spec, this.#workerExecutable);
  }

  async #claim() {
    const args = this.#args;
    const mode0Candidate = mode0ReservationSnapshot(args.reservation, this.#options);
    if (mode0Candidate.mode0 && (mode0Candidate.invalid || !mode0Candidate.envelope)) {
      throw new Error('The sealed mode-0 reservation could not be verified before worker execution.');
    }
    this.#mode0 = mode0Candidate.mode0 === true;
    if (!await claimSupervisorReservation(args.reservation, this.#spec, this.#jobIdentityDigest, this.#workerExecutable, this.#options)) {
      throw new Error('Toolkit reservation state could not be verified before worker execution.');
    }
    this.#claimed = true;
  }

  async #execute() {
    if (this.#mode0) {
      this.#code = await executeMode0Lifecycle(this.#args.reservation, this.#spec, this.#workerExecutable, this.#jobIdentityDigest, this.#options);
      this.#mode0Settled = true;
      return;
    }
    const checker = this.#spec.role === ROLES.CHECKER;
    const invocation = claudeInvocation(this.#spec, { claudeCli: this.#workerExecutable, promptBytes: this.#promptBytes });
    const childResult = runValidatedClaude(invocation, checker);
    if (!childResult.outputExceeded && childResult.output.length) process.stdout.write(childResult.output);
    if (childResult.error && !childResult.outputExceeded) console.error(childResult.error.message);
    this.#code = childResult.code;
    if (checker && this.#code === 0) {
      try { this.#checkerOutcome = checkerResultFromClaudeOutput(childResult.output); }
      catch (error) { console.error(error.message); this.#code = 1; }
    } else if (checker && childResult.outputExceeded) {
      console.error('Checker output exceeds the bounded result limit.');
    }
  }

  #settle() {
    const args = this.#args, options = this.#options;
    if (this.#claimed && !this.#mode0 && this.#spec?.role === ROLES.CHECKER) {
      if (this.#code === 0 && !updateCheckerReview(this.#spec.review_id, 'completed', { ...options, checker_result: this.#checkerOutcome })) this.#code = 1;
      if (this.#code !== 0) clearPendingCheckerReview(this.#spec.review_id, options);
    }
    if (this.#claimed && !this.#mode0) {
      releaseReservation(args.reservation, options);
      try { if (verifyPrivateRegularFile(this.#specPath)) fs.unlinkSync(this.#specPath); } catch {}
    }
    if (this.#mode0 && !this.#mode0Settled) console.error('Mode-0 worker outcome remains unresolved; the reservation is retained.');
  }

  async run() {
    try {
      this.#loadSpec();
      await this.#claim();
      await this.#execute();
    } finally {
      this.#settle();
    }
    return this.#code;
  }
}
async function supervise(args){return new WorkerSupervisor(args).run();}

function parseCli(argv) {
  if(argv[0]==='core'&&['inspect','compile','delegation-plan','run','recover','qualify'].includes(argv[1]))argv=['core-'+argv[1],...argv.slice(2)];
  const parsed = { command: argv[0] || '', root: '', spec: '', input: '', reviewId: '', reservation: '', claudeCli: '' };
  for (let i = 1; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--root') { parsed.root = value; i += 1; }
    else if (argv[i] === '--spec') { parsed.spec = value; i += 1; }
    else if (argv[i] === '--input') { parsed.input = value; i += 1; }
    else if (argv[i] === '--review-id') { parsed.reviewId = value; i += 1; }
    else if (argv[i] === '--reservation') { parsed.reservation = value; i += 1; }
    else if (argv[i] === '--claude-cli') { parsed.claudeCli = value; i += 1; }
  }
  return parsed;
}


async function coreRuntimeCommand(command, adapter, request = {}) {
  const runtime = require('./toolkit-codex-agent-adapter.cjs');
  runtime.assertAuthenticCodexAdapter(adapter);
  const compiler = require('./toolkit-gate-contract-compiler.cjs');
  request = compiler.trustedJsonCopy(request);
  if (command === 'core-inspect' && Object.keys(request).length === 0) return adapter.inspect();
  if (command === 'core-recover' && Object.keys(request).length === 0) return adapter.recover();
  if (command === 'core-qualify' && ['role','reviewer_id|role'].includes(Object.keys(request).sort().join('|'))) return adapter.qualify(request.role,request.reviewer_id ?? null);
  if (command === 'core-run' && ['instruction|role','instruction|reviewer_id|role'].includes(Object.keys(request).sort().join('|'))) return adapter.run(request.role,request.instruction,request.reviewer_id ?? null);
  throw Object.assign(new Error('Toolkit core request held. Reference: CORE_REQUEST_INVALID'),{code:'CORE_REQUEST_INVALID'});
}
// The installed launcher constructs this session from already authenticated
// in-process handles. JSON, environment variables and CLI flags cannot grant
// a runtime context or replace the captured CURRENT receiver.
const CORE_COMMAND_SESSIONS = new WeakSet();
class CoreCommandSession {
  #adapter; #selection;
  constructor({ adapter, stack_session }) {
    require('./toolkit-codex-agent-adapter.cjs').assertAuthenticCodexAdapter(adapter);
    require('./toolkit-stack-selection.cjs').assertCurrentStackSelectionSession(stack_session);
    this.#adapter = adapter; this.#selection = stack_session;
    CORE_COMMAND_SESSIONS.add(this);
    Object.defineProperty(this, 'execute', {value:(command,request)=>this.#execute(command,request),enumerable:true});
    Object.freeze(this);
  }
  async #execute(command, request = {}) {
    const value = require('./toolkit-gate-contract-compiler.cjs').trustedJsonCopy(request);
    const admission = this.#selection.evaluate({event:'admission'});
    if (admission.state !== 'ADMITTED_SELECTION') return admission;
    if (admission.selection.profile_id !== this.#adapter.inspect().profile_id
      || value.role !== undefined && value.role !== admission.binding.role
      || (value.reviewer_id ?? null) !== admission.binding.reviewer_id) {
      throw Object.assign(new Error('CORE_STACK_SESSION_BINDING_DRIFT'), {code:'CORE_STACK_SESSION_BINDING_DRIFT'});
    }
    return coreRuntimeCommand(command, this.#adapter, value);
  }
}
// Production assembly reuses the existing authority, CURRENT and receipt stores.
// The caller supplies the already authorised host readers; this function neither
// discovers credentials nor creates a new permission or configuration channel.
async function createCoreCommandSession(input) {
  const keys=['authority_store_options','check_capability','consumer_intent','present_question',
    'receipt_lease_ms','receipt_store_options','repository_root','source_capture','trusted_authority_readers'];
  if(!input || typeof input!=='object' || require('node:util').types.isProxy(input)
    || Object.keys(input).sort().join('|')!==keys.sort().join('|'))throw new Error('CORE_CONTEXT_INPUT_INVALID');
  const receipt=require('./toolkit-github-program-receipt.cjs'),selection=require('./toolkit-stack-selection.cjs');
  const intent=require('./toolkit-gate-contract-compiler.cjs').trustedJsonCopy(input.consumer_intent);
  const store=receipt.createAuthorityPacketStore(input.authority_store_options,input.trusted_authority_readers);
  const stackSession=new selection.CurrentStackSelectionSession({store,consumer_intent:intent,
    source_capture:input.source_capture,role:intent.consumer.role,reviewer_id:intent.consumer.reviewer_id??null,
    present_question:input.present_question,check_capability:input.check_capability});
  const selected=stackSession.evaluate({event:'admission'});
  if(selected.state!=='ADMITTED_SELECTION')return selected;
  const admitted=store.admitSemanticGate(intent,input.trusted_authority_readers);
  const compiled=store.readControllerDecision(admitted.admission);
  const receiptStore=receipt.createProgrammeReceiptStore(input.receipt_store_options);
  const observed=input.trusted_authority_readers;
  if(typeof observed.readAuthority!=='function'||typeof observed.readStart!=='function')throw new Error('CORE_CONTEXT_READERS_REQUIRED');
  const authority=await observed.readAuthority({}),start=await observed.readStart({});
  const session=await receiptStore.startRun({lock:compiled.decision.identity.lock,authority:authority.authority,
    start,candidate:null,lease_ms:input.receipt_lease_ms,semantic_gate:{store,admission:admitted.admission}},observed);
  const channel=receipt.createControllerEffectChannel(receiptStore,session,store,admitted.admission);
  const adapter=require('./toolkit-codex-agent-adapter.cjs').createCodexAdapter(channel,input.repository_root);
  return new CoreCommandSession({adapter,stack_session:stackSession});
}
function coreDataCommand(command, input) {
  const runtime = require('./toolkit-codex-agent-adapter.cjs');
  if(command === 'core-delegation-plan') {
    const compiler = require('./toolkit-gate-contract-compiler.cjs');
    const value = compiler.trustedJsonCopy(input);
    if(Object.keys(value).sort().join('|') !== 'decision|delegation') throw new Error('CORE_REQUEST_INVALID');
    return compiler.planV3Delegation(value.delegation,value.decision);
  }
  if(command === 'core-inspect') return runtime.inspect(input);
  if(command === 'core-compile') {
    const compiler = require('./toolkit-gate-contract-compiler.cjs');
    const value = compiler.trustedJsonCopy(input);
    if(Object.keys(value).sort().join('|') !== 'decision|observations') throw new Error('CORE_REQUEST_INVALID');
    return compiler.compileControllerDecision(value.decision,value.observations);
  }
  throw new Error('CORE_REQUEST_INVALID');
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseCli(argv);
  if (['core-inspect','core-compile','core-delegation-plan'].includes(args.command)) {
    if(!args.input)throw new Error('CORE_INPUT_REQUIRED');
    const file=path.resolve(args.input),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024)throw new Error('CORE_INPUT_UNSAFE');
    console.log(JSON.stringify(coreDataCommand(args.command,JSON.parse(fs.readFileSync(file,'utf8'))),null,2));return 0;
  }
  if (['core-run','core-recover','core-qualify'].includes(args.command)) {
    if (dependencies.core_session && CORE_COMMAND_SESSIONS.has(dependencies.core_session)) {
      let request = {};
      if (args.input) {
        const file=path.resolve(args.input),stat=fs.lstatSync(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024)throw new Error('CORE_INPUT_UNSAFE');
        request=JSON.parse(fs.readFileSync(file,'utf8'));
      }
      const result=await dependencies.core_session.execute(args.command,request);
      console.log(JSON.stringify(result,null,2));
      return ['HOLD','ASK_AND_HOLD'].includes(result?.state)||result?.status==='HOLD'?2:0;
    }
    console.log(JSON.stringify({status:'HOLD',code:'CORE_AUTHENTIC_INSTALLED_CONTEXT_REQUIRED',command:args.command}));return 2;
  }
  if (args.command === 'launch') {
    const result = launch(readJson(path.resolve(args.spec)), { root: args.root, claudeCli: args.claudeCli });
    console.log(JSON.stringify(result, null, 2));
    return result.result === RESULTS.REFUSE ? 2 : 0;
  }
  if (args.command === 'supervise') return supervise(args);
  if (args.command === 'checker') {
    const result = checkerWorkflow(readCheckerWorkflowInput(args.input, { root: args.root }), { root: args.root, claudeCli: args.claudeCli });
    console.log(JSON.stringify(result, null, 2));
    return result.status === CHECKER_RESULTS.ADMISSION_DENIED ? 2 : 0;
  }
  if (args.command === 'checker-result') {
    const result = checkerResultStatus(args.reviewId, { root: args.root });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'RETRY_REQUIRED' ? 2 : 0;
  }
  if (args.command === 'status') {
    const result = withLock({ root: args.root }, () => recoverState(sanitizeState(readJson(statePath({ root: args.root }), emptyState()))));
    console.log(JSON.stringify(result, null, 2)); return 0;
  }
  throw new Error('Usage: toolkit-agent-control.cjs checker --input - [--root <path>] | checker-result --review-id <id> [--root <path>] | launch --spec <json> [--root <path>]');
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });

module.exports = {
  createCoreCommandSession, CoreCommandSession, main, coreRuntimeCommand, coreDataCommand,
  SCHEMA, CONTROL_VERSION, RESULTS, CHECKER_RESULTS, HOSTS, ROLES, MODEL_CONTRACT, CHECKER_CONTEXT_LIMITS, TOPOLOGIES, CAPACITY_MODES, GIB, DEFAULT_WORKER_COST, EMERGENCY_WORKER_CEILING, MAX_QUEUE, MAX_MANUAL_WORKERS, MAX_PROMPT_BYTES, MAX_CHECKER_INPUT_BYTES, MAX_CHECKER_OUTPUT_BYTES, CHECKER_TIMEOUT_MS, LOCK_TTL_MS,
  controlRoot, profilePath, statePath, lockPath, lockRecoveryPath, readProfile, configureProfile, invalidateProfile, validateLaunchSpec, inspectResources, inspectResourceCapability, validResourceState, parseLinuxMeminfoCounters, validActivationProof, verifyCurrentClaudeEnforcement, effectiveEnvironment, effectiveClaudeCommand, acquireLock, recoverStaleRecoveryMarker, withRepositoryTestResourceInvocation,
  checkerRequirement, checkerContext, buildCheckerPrompt, validateCheckerPrompt, checkerLaunchSpec, checkerResult, checkerResultFromClaudeOutput, checkerAdmissionOutcome, validateCheckerWorkflowInput, checkerWorkflow, checkerResultStatus, readCheckerWorkflowInput, admissionDecision, admissionDecisionWithResourceEnvelope, resourceAdmissionDecision, updateReservation, releaseReservation, updateCheckerReview, clearPendingCheckerReview, claudeInvocationArgs, claudeInvocation, runValidatedClaude, launch, launchWithResourceEnvelope, recoverState, pidAlive,
};
