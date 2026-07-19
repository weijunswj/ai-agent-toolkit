#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const processLaunch = require('./claude-process-launch.cjs');

const SCHEMA = 1;
const CONTROL_VERSION = '2.7.20';
const RESULTS = Object.freeze({ START: 'start', QUEUE: 'queue', REFUSE: 'refuse-root-only' });
const CHECKER_RESULTS = Object.freeze({ PASS: 'PASS', FINDINGS: 'FINDINGS', ADMISSION_DENIED: 'ADMISSION_DENIED', SKIPPED_TRIVIAL: 'SKIPPED_TRIVIAL' });
const HOSTS = Object.freeze({ CODEX: 'codex', CLAUDE: 'claude-code', OPENCODE: 'opencode' });
const ROLES = Object.freeze({ WORKER: 'worker', CHECKER: 'checker' });
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

function controlRoot(options = {}) {
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
    && (entry.status !== 'pending' || (entry.result === undefined && entry.findings_count === undefined)));
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
    const expired = Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms <= now;
    return !(expired && (entry.status === 'reserved' || !pidAlive(entry.owner_pid)));
  });
  state.queue = state.queue.filter((entry) => Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms > now);
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

function readProfile(host = 'claude-code', options = {}) {
  const raw = readJson(profilePath(host, options));
  if (!raw) return rootOnlyProfile(host, 'unconfigured-root-only', 'No verified Toolkit profile is configured.');
  const validEnums = Object.values(TOPOLOGIES).includes(raw.topology) && Object.values(CAPACITY_MODES).includes(raw.capacity_mode);
  const validNumbers = Number.isSafeInteger(raw.manual_maximum) && raw.manual_maximum >= 0 && raw.manual_maximum <= MAX_MANUAL_WORKERS
    && Number.isSafeInteger(raw.worker_estimate_bytes) && raw.worker_estimate_bytes >= MIN_WORKER_COST && raw.worker_estimate_bytes <= MAX_WORKER_COST
    && raw.queue_limit === MAX_QUEUE && raw.reservation_limit === EMERGENCY_WORKER_CEILING;
  const compatible = (raw.topology === TOPOLOGIES.ROOT_ONLY && raw.capacity_mode === CAPACITY_MODES.ROOT_ONLY && raw.manual_maximum === 0)
    || (raw.topology === TOPOLOGIES.CLAUDE_DIRECT && [CAPACITY_MODES.AUTO, CAPACITY_MODES.MANUAL].includes(raw.capacity_mode)
      && (raw.capacity_mode !== CAPACITY_MODES.MANUAL || raw.manual_maximum >= 1))
    || (raw.topology === TOPOLOGIES.BROADER_NATIVE && raw.capacity_mode === CAPACITY_MODES.ROOT_ONLY && raw.manual_maximum === 0);
  const strict = [TOPOLOGIES.ROOT_ONLY, TOPOLOGIES.CLAUDE_DIRECT].includes(raw.topology);
  const strictValid = !strict || (raw.enforcement_verified === true && raw.controller_version === CONTROL_VERSION
    && ['native-agent-hook-deny', 'toolkit-launch-boundary'].includes(raw.enforcement) && validActivationProof(raw.activation_proof)
    && typeof raw.claude_cli === 'string' && raw.claude_cli.length > 0 && (() => { try { processLaunch.validateExecutable(raw.claude_cli); return true; } catch { return false; } })());
  const resourceValid = raw.topology !== TOPOLOGIES.CLAUDE_DIRECT
    || (raw.resource_counter_verified === true && ['proc-meminfo', 'win32-operating-system'].includes(raw.resource_counter_source));
  if (raw.schema !== SCHEMA || raw.host !== host || !validEnums || !validNumbers || !compatible || !strictValid || !resourceValid || typeof raw.updated_at !== 'string') {
    return rootOnlyProfile(host, 'unsupported-root-only', 'The stored Toolkit profile is malformed, contradictory, stale, or from an unsupported schema.');
  }
  return { ...raw, status: 'configured', supported: true };
}

function configureProfile(host, selected, options = {}) {
  if (host !== 'claude-code') throw new Error('Toolkit-managed agent launch is not supported for this host.');
  const topology = selected.topology;
  const capacityMode = selected.capacity_mode;
  if (!Object.values(TOPOLOGIES).includes(topology)) throw new Error(`Unsupported topology: ${topology}`);
  if (!Object.values(CAPACITY_MODES).includes(capacityMode)) throw new Error(`Unsupported capacity mode: ${capacityMode}`);
  const compatible = (topology === TOPOLOGIES.ROOT_ONLY && capacityMode === CAPACITY_MODES.ROOT_ONLY)
    || (topology === TOPOLOGIES.CLAUDE_DIRECT && [CAPACITY_MODES.AUTO, CAPACITY_MODES.MANUAL].includes(capacityMode))
    || (topology === TOPOLOGIES.BROADER_NATIVE && capacityMode === CAPACITY_MODES.ROOT_ONLY);
  if (!compatible) throw new Error('Topology and capacity mode are incompatible.');
  let manualMaximum = 0;
  if (capacityMode === CAPACITY_MODES.MANUAL) {
    manualMaximum = Number(selected.manual_maximum);
    if (!Number.isSafeInteger(manualMaximum) || manualMaximum < 1 || manualMaximum > MAX_MANUAL_WORKERS) throw new Error('Manual maximum is outside the supported bounds.');
  }
  const workerEstimate = Number(selected.worker_estimate_bytes || DEFAULT_WORKER_COST);
  if (!Number.isSafeInteger(workerEstimate) || workerEstimate < MIN_WORKER_COST || workerEstimate > MAX_WORKER_COST) throw new Error('Worker estimate is outside the supported bounds.');
  const strict = [TOPOLOGIES.ROOT_ONLY, TOPOLOGIES.CLAUDE_DIRECT].includes(topology);
  if (strict && (selected.enforcement_verified !== true || !validActivationProof(selected.activation_proof))) {
    throw new Error('A strict Claude profile requires verified current native hook trust and activation bound to the installed plugin bytes.');
  }
  const claudeCli = strict ? processLaunch.validateExecutable(selected.claude_cli || 'claude') : null;
  const resourceCapability = inspectResourceCapability({ resourceState: selected.resource_state });
  const resourceSource = selected.resource_counter_source || resourceCapability.source;
  if (topology === TOPOLOGIES.CLAUDE_DIRECT && (selected.resource_counter_supported !== true && !resourceCapability.supported
    || !['proc-meminfo', 'win32-operating-system'].includes(resourceSource))) {
    throw new Error('Toolkit-managed direct Claude profiles require supported validated resource counters.');
  }
  const profile = {
    schema: SCHEMA, host, topology, capacity_mode: capacityMode, manual_maximum: manualMaximum,
    worker_estimate_bytes: workerEstimate, queue_limit: MAX_QUEUE, reservation_limit: EMERGENCY_WORKER_CEILING,
    controller_version: CONTROL_VERSION, enforcement_verified: strict, activation_proof: strict ? selected.activation_proof : null,
    claude_cli: claudeCli,
    resource_counter_verified: topology === TOPOLOGIES.CLAUDE_DIRECT,
    resource_counter_source: topology === TOPOLOGIES.CLAUDE_DIRECT ? resourceSource : 'not-applicable',
    updated_at: new Date().toISOString(),
    enforcement: topology === TOPOLOGIES.CLAUDE_DIRECT ? 'toolkit-launch-boundary' : (topology === TOPOLOGIES.ROOT_ONLY ? 'native-agent-hook-deny' : 'outside-toolkit-control'),
  };
  atomicWriteJson(profilePath(host, options), profile);
  return { ...profile, status: 'configured', supported: true };
}

function invalidateProfile(host, reason, options = {}) {
  if (host !== 'claude-code') throw new Error('Toolkit-managed agent launch is not supported for this host.');
  const profile = {
    schema: SCHEMA, host, topology: TOPOLOGIES.ROOT_ONLY, capacity_mode: CAPACITY_MODES.ROOT_ONLY,
    manual_maximum: 0, worker_estimate_bytes: DEFAULT_WORKER_COST, queue_limit: MAX_QUEUE,
    reservation_limit: EMERGENCY_WORKER_CEILING, controller_version: CONTROL_VERSION,
    enforcement_verified: false, enforcement: 'unverified-root-only-policy', updated_at: new Date().toISOString(),
    invalidation_reason: String(reason || 'Current enforcement capability could not be verified.'),
  };
  atomicWriteJson(profilePath(host, options), profile);
  return rootOnlyProfile(host, 'capability-lost-root-only', profile.invalidation_reason);
}
function linuxResources() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const values = Object.fromEntries([...text.matchAll(/^(\w+):\s+(\d+)\s+kB$/gm)].map((m) => [m[1], Number(m[2]) * 1024]));
  return {
    physical_total: values.MemTotal,
    physical_available: values.MemAvailable,
    commit_total: values.CommitLimit,
    commit_available: values.CommitLimit - values.Committed_AS,
    source: 'proc-meminfo',
    host_responsive: true,
  };
}

function windowsResources() {
  const command = '$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{physical_total=[double]$o.TotalVisibleMemorySize*1024;physical_available=[double]$o.FreePhysicalMemory*1024;commit_total=[double]$o.TotalVirtualMemorySize*1024;commit_available=[double]$o.FreeVirtualMemory*1024}|ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error('Windows memory counters are unavailable.');
  return { ...JSON.parse(result.stdout), source: 'win32-operating-system', host_responsive: true };
}

function inspectResources(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'resourceState')) return options.resourceState ? { ...options.resourceState } : null;
  try {
    if (process.platform === 'win32') return windowsResources();
    if (process.platform === 'linux') return linuxResources();
  } catch { return null; }
  return null;
}

function validResourceState(resources) {
  return resources && ['physical_total', 'physical_available', 'commit_total', 'commit_available']
    .every((key) => Number.isSafeInteger(resources[key]) && resources[key] > 0)
    && resources.physical_available <= resources.physical_total
    && resources.commit_available <= resources.commit_total
    && resources.host_responsive === true;
}

function inspectResourceCapability(options = {}) {
  const resources = inspectResources(options);
  const supported = Boolean(validResourceState(resources) && ['proc-meminfo', 'win32-operating-system', 'fixture'].includes(resources.source));
  return { supported, source: supported ? resources.source : 'unsupported-or-malformed', resources: supported ? resources : null };
}


const TRIVIAL_CHANGE_KINDS = new Set(['typo-only-docs', 'mechanical-comment-only', 'generated-only-authoritative-validated']);
const GENERATED_ONLY_PREFIXES = ['skills/', '.codex-plugin/', '.claude-plugin/'];
const PACKAGED_OR_RUNTIME_PREFIXES = [
  'repo/scripts/', 'repo/tests/', '_projects/', 'skills/', '.codex-plugin/', '.claude-plugin/',
  '.agents/', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'package.json', 'package-lock.json',
];
const CHECKER_CONTEXT_LIMITS = Object.freeze({ task: 64 * 1024, files: 64 * 1024, diff: 512 * 1024, validation: 64 * 1024, surrounding: 128 * 1024 });

function checkerRequirement(input = {}) {
  const files = Array.isArray(input.changed_files) ? input.changed_files.map((value) => String(value).replace(/\\/g, '/')) : [];
  if (!input.implementation_complete || !input.focused_validation_passed || !input.diff_ready || files.length === 0) {
    return { required: false, ready: false, reason: 'Checker decision requires completed implementation, passed focused validation, a ready diff, and changed files.' };
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
  const changedFiles = Array.isArray(input.changed_files) ? input.changed_files.map(String) : [];
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

function checkerLaunchSpec(host, context, overrides = {}) {
  if (!Object.values(HOSTS).includes(host)) throw new Error('Unsupported checker host.');
  const mapping = MODEL_CONTRACT[host];
  const boundedContext = checkerContext(context);
  const childPrompt = JSON.stringify({
    instructions: 'Perform a read-only adversarial review of the bounded ready diff. Do not mutate files, run mutating commands, or launch children.',
    result_contract: {
      statuses: [CHECKER_RESULTS.PASS, CHECKER_RESULTS.FINDINGS],
      pass: 'Return PASS only when no actionable finding remains.',
      findings: 'Return FINDINGS with bounded file and evidence details for every actionable defect.',
      format: 'Return only one JSON object: {"status":"PASS","findings":[]} or {"status":"FINDINGS","findings":[{"file":"...","evidence":"..."}]}.',
    },
    context: boundedContext,
  });
  if (Buffer.byteLength(childPrompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('Checker prompt exceeds the bounded private transport limit.');
  return {
    ...overrides,
    role: ROLES.CHECKER, host, depth: 1, effort: mapping.effort, model: mapping.checker,
    read_only: true, may_edit: false, may_commit: false, may_push: false, may_open_pr: false, may_merge_pr: false, may_spawn_children: false,
    review_id: String(overrides.review_id || crypto.randomUUID()),
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
  if (!envelope || envelope.type !== 'result' || envelope.is_error === true || typeof envelope.result !== 'string') {
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
    if (model !== MODEL_CONTRACT[host].checker || String(spec.effort || 'medium').toLowerCase() !== 'medium') {
      throw new Error('The checker must use the declared host checker model at medium effort.');
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
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  try { spec = validateLaunchSpec(specInput); }
  catch (error) { return refusal(error.message); }
  const host = String(options.host || spec.host || HOSTS.CLAUDE);
  if (!Object.values(HOSTS).includes(host)) return refusal('The requested host adapter is unsupported.');
  if (host !== spec.host) return refusal('The native host adapter does not match the validated child host contract.');
  const profile = options.profile || (host === HOSTS.CLAUDE ? readProfile(HOSTS.CLAUDE, options) : { capacity_mode: CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: DEFAULT_WORKER_COST });
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
  const resources = inspectResources(options);
  if (!validResourceState(resources)) return refusal('Resource state could not be verified safely.');
  return resourceAdmissionDecisionValidated(spec, profile, resources, options);
}

function resourceAdmissionDecision(specInput, profile, resources, options = {}) {
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  try { spec = validateLaunchSpec(specInput); }
  catch (error) { return refusal(error.message); }
  if (!profile || profile.capacity_mode === CAPACITY_MODES.ROOT_ONLY) return refusal('The selected host profile is root-only and cannot admit a child.');
  if (!validAdmissionProfile(profile)) return refusal('The selected host admission profile could not be verified safely.');
  if (!validResourceState(resources)) return refusal('Resource state could not be verified safely.');
  return resourceAdmissionDecisionValidated(spec, profile, resources, options);
}

function resourceAdmissionDecisionValidated(spec, profile, resources, options) {
  const host = spec.host;
  return withLock(options, () => {
    const now = options.now || Date.now();
    const stateFile = statePath(options);
    const rawState = readJson(stateFile);
    if (fs.existsSync(stateFile) && !validControlState(rawState)) return refusal('Toolkit admission state could not be verified safely.');
    const state = recoverState(sanitizeState(rawState || emptyState()), now);
    let reservedBytes = 0;
    for (const entry of state.reservations) {
      if (!validReservation(entry) || reservedBytes > Number.MAX_SAFE_INTEGER - entry.estimated_memory_bytes) return refusal('Toolkit reservation memory state could not be verified safely.');
      reservedBytes += entry.estimated_memory_bytes;
    }
    const active = state.reservations.length;
    if (spec.role === ROLES.CHECKER && state.reservations.some((entry) => entry.role === ROLES.CHECKER)) return refusal('Exactly one independent checker may be active.');
    if (spec.role === ROLES.CHECKER && state.checker_reviews.some((entry) => entry.review_id === spec.review_id)) return refusal('This pre-PR review already admitted its one independent checker.');
    const maximum = profile.capacity_mode === CAPACITY_MODES.MANUAL ? profile.manual_maximum : EMERGENCY_WORKER_CEILING;
    const physicalReserve = Math.max(4 * GIB, resources.physical_total * 0.25);
    const commitReserve = Math.max(6 * GIB, resources.commit_total * 0.20);
    const requested = Number(spec.estimated_memory_bytes || profile.worker_estimate_bytes);
    if (!Number.isSafeInteger(requested) || requested < MIN_WORKER_COST || requested > MAX_WORKER_COST) return refusal('The requested worker cost is unknown or outside the supported range.');
    const effectivePhysical = Math.max(0, resources.physical_available - reservedBytes);
    const effectiveCommit = Math.max(0, resources.commit_available - reservedBytes);
    const physicalAfter = effectivePhysical - requested;
    const commitAfter = effectiveCommit - requested;
    const critical = resources.physical_available / resources.physical_total < 0.08 || resources.commit_available / resources.commit_total < 0.08;
    if (critical) return refusal('Current memory pressure is unsafe for another worker.');
    const queuedReservation = spec.queue_id ? state.queue.find((entry) => entry.id === spec.queue_id) : null;
    if (spec.queue_id && !queuedReservation) return refusal('The queue entry is missing or expired.');
    if (queuedReservation && (queuedReservation.host !== host || queuedReservation.role !== spec.role)) return refusal('The queue entry belongs to a different host or child role.');
    if (state.queue.length && state.queue[0].id !== spec.queue_id) {
      if (spec.role === ROLES.CHECKER) return refusal('The required checker could not be admitted immediately.');
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'An earlier bounded queue entry is still waiting.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = { id: crypto.randomUUID(), host, role: spec.role, created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, status: RESULTS.QUEUE };
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason: 'Earlier Toolkit-controlled work is queued.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    }
    const temporarilyFull = active >= maximum || active >= EMERGENCY_WORKER_CEILING || physicalAfter < physicalReserve || commitAfter < commitReserve;
    if (temporarilyFull) {
      if (spec.role === ROLES.CHECKER) return refusal('Verified memory capacity is unavailable for the required checker.');
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = { id: crypto.randomUUID(), host, role: spec.role, created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, status: RESULTS.QUEUE };
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    }
    if (queuedReservation) state.queue.shift();
    if (spec.effort !== 'medium' && state.reservations.some((entry) => entry.effort !== 'medium')) return refusal('A higher-effort child is already active; sibling effort escalation is not allowed.');
    const reservation = {
      id: crypto.randomUUID(), host, topology: 'toolkit-controlled-direct', depth: 1, role: spec.role,
      owner_pid: options.ownerPid || process.pid, created_at_ms: now, expires_at_ms: now + RESERVATION_TTL_MS,
      estimated_memory_bytes: requested, effort: spec.effort, status: 'reserved',
    };
    state.reservations.push(reservation);
    if (spec.role === ROLES.CHECKER) {
      state.checker_reviews.push({ review_id: spec.review_id, reservation_id: reservation.id, admitted_at_ms: now, expires_at_ms: now + CHECKER_REVIEW_TTL_MS, status: 'pending' });
    }
    atomicWriteJson(statePath(options), state);
    return { result: RESULTS.START, reservation_id: reservation.id, expires_at_ms: reservation.expires_at_ms, profile: 'toolkit-controlled-direct', host, role: spec.role, model: MODEL_CONTRACT[host][spec.role], effort: spec.effort, non_fast: host === HOSTS.CLAUDE ? 'CLAUDE_CODE_DISABLE_FAST_MODE=1' : true, productive_parent: true };
  });
}

function updateReservation(id, updates, options = {}) {
  return withLock(options, () => {
    const current = readMutableControlState(options);
    if (!current.exists || !current.state) return false;
    if (!current.state.reservations.some((item) => item.id === id)) return false;
    const state = recoverState(current.state);
    const entry = state.reservations.find((item) => item.id === id);
    if (!entry) return false;
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
    if (!current.state.reservations.some((entry) => entry.id === id)) return false;
    const state = recoverState(current.state);
    const before = state.reservations.length;
    state.reservations = state.reservations.filter((entry) => entry.id !== id);
    if (state.reservations.length === before) return false;
    state.checker_reviews = state.checker_reviews.filter((entry) => entry.status !== 'pending' || entry.reservation_id !== id);
    atomicWriteJson(statePath(options), state);
    return true;
  });
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
    return [...common, '--tools', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', '--disallowedTools', 'Agent', 'Task', 'Bash', 'Edit', 'Write', 'NotebookEdit', '--permission-mode', 'plan', '--no-session-persistence'];
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
  const parts = processLaunch.claudeSpawnParts(executable, args, { env });
  return { executable: parts.command, args: parts.args, windowsVerbatimArguments: parts.windowsVerbatimArguments, raw_executable: executable, raw_args: args, env, stdin: promptBytes, effort: checked.effort, non_fast: true, max_depth: 1 };
}

function spawnValidatedClaude(invocation, captureChecker) {
  // The production resolver validated this executable, and spawn keeps argv shell-free while streaming private stdin.
  // codeql[js/shell-command-injection-from-environment]
  return spawn(invocation.executable, invocation.args, {
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    env: invocation.env,
    windowsHide: true,
    stdio: ['pipe', captureChecker ? 'pipe' : 'inherit', 'inherit'],
  });
}

function launch(specInput, options = {}) {
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
    const serialized = { ...spec, child_prompt: undefined, child_prompt_base64: promptBytes.toString('base64') };
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

async function supervise(args) {
  const spec = readJson(args.spec);
  const options = { root: args.root };
  let code = 1;
  let checkerOutcome = null;
  try {
    const encoded = String(spec?.child_prompt_base64 || '');
    const promptBytes = Buffer.from(encoded, 'base64');
    if (!encoded || promptBytes.toString('base64') !== encoded || promptBytes.length > MAX_PROMPT_BYTES) throw new Error('Stored child prompt transport is malformed.');
    const invocation = claudeInvocation(spec, { claudeCli: args.claudeCli, promptBytes });
    if (!updateReservation(args.reservation, { owner_pid: process.pid, status: 'running' }, options)) {
      throw new Error('Toolkit reservation state could not be verified before worker execution.');
    }
    const childResult = await new Promise((resolve) => {
      let settled = false;
      let outputBytes = 0;
      let outputExceeded = false;
      const output = [];
      const captureChecker = spec.role === ROLES.CHECKER;
      const finish = (value) => { if (!settled) { settled = true; resolve({ code: value, output: Buffer.concat(output), outputExceeded }); } };
      const child = spawnValidatedClaude(invocation, captureChecker);
      if (captureChecker) {
        child.stdout.on('data', (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > MAX_CHECKER_OUTPUT_BYTES) {
            outputExceeded = true;
            child.kill();
            return;
          }
          output.push(chunk);
          process.stdout.write(chunk);
        });
      }
      child.on('error', () => finish(1));
      child.on('close', (value) => finish(outputExceeded ? 1 : (Number.isInteger(value) ? value : 1)));
      child.stdin.on('error', () => { child.kill(); });
      child.stdin.end(invocation.stdin);
    });
    code = childResult.code;
    if (spec.role === ROLES.CHECKER && code === 0) {
      try { checkerOutcome = checkerResultFromClaudeOutput(childResult.output); }
      catch (error) { console.error(error.message); code = 1; }
    } else if (spec.role === ROLES.CHECKER && childResult.outputExceeded) {
      console.error('Checker output exceeds the bounded result limit.');
    }
  } finally {
    if (spec?.role === ROLES.CHECKER) {
      if (code === 0 && !updateCheckerReview(spec.review_id, 'completed', { ...options, checker_result: checkerOutcome })) code = 1;
      if (code !== 0) clearPendingCheckerReview(spec.review_id, options);
    }
    releaseReservation(args.reservation, options);
    try { if (verifyPrivateRegularFile(args.spec)) fs.unlinkSync(args.spec); } catch {}
  }
  return code;
}

function parseCli(argv) {
  const parsed = { command: argv[0] || '', root: '', spec: '', reservation: '', claudeCli: '' };
  for (let i = 1; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--root') { parsed.root = value; i += 1; }
    else if (argv[i] === '--spec') { parsed.spec = value; i += 1; }
    else if (argv[i] === '--reservation') { parsed.reservation = value; i += 1; }
    else if (argv[i] === '--claude-cli') { parsed.claudeCli = value; i += 1; }
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  if (args.command === 'launch') {
    const result = launch(readJson(path.resolve(args.spec)), { root: args.root, claudeCli: args.claudeCli });
    console.log(JSON.stringify(result, null, 2));
    return result.result === RESULTS.REFUSE ? 2 : 0;
  }
  if (args.command === 'supervise') return supervise(args);
  if (args.command === 'status') {
    const result = withLock({ root: args.root }, () => recoverState(sanitizeState(readJson(statePath({ root: args.root }), emptyState()))));
    console.log(JSON.stringify(result, null, 2)); return 0;
  }
  throw new Error('Usage: toolkit-agent-control.cjs launch --spec <json> [--root <path>]');
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });

module.exports = {
  SCHEMA, CONTROL_VERSION, RESULTS, CHECKER_RESULTS, HOSTS, ROLES, MODEL_CONTRACT, CHECKER_CONTEXT_LIMITS, TOPOLOGIES, CAPACITY_MODES, GIB, DEFAULT_WORKER_COST, EMERGENCY_WORKER_CEILING, MAX_QUEUE, MAX_MANUAL_WORKERS, MAX_PROMPT_BYTES, MAX_CHECKER_OUTPUT_BYTES, LOCK_TTL_MS,
  controlRoot, profilePath, statePath, lockPath, lockRecoveryPath, readProfile, configureProfile, invalidateProfile, validateLaunchSpec, inspectResources, inspectResourceCapability, validResourceState, validActivationProof, verifyCurrentClaudeEnforcement, effectiveEnvironment, effectiveClaudeCommand, acquireLock, recoverStaleRecoveryMarker,
  checkerRequirement, checkerContext, checkerLaunchSpec, checkerResult, checkerResultFromClaudeOutput, checkerAdmissionOutcome, admissionDecision, resourceAdmissionDecision, updateReservation, releaseReservation, updateCheckerReview, clearPendingCheckerReview, claudeInvocationArgs, claudeInvocation, launch, recoverState, pidAlive,
};
