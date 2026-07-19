#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const processLaunch = require('./claude-process-launch.cjs');

const SCHEMA = 1;
const CONTROL_VERSION = '2.7.17';
const RESULTS = Object.freeze({ START: 'start', QUEUE: 'queue', REFUSE: 'refuse-root-only' });
const TOPOLOGIES = Object.freeze({ ROOT_ONLY: 'root-only', CLAUDE_DIRECT: 'claude-toolkit-direct', BROADER_NATIVE: 'broader-native' });
const CAPACITY_MODES = Object.freeze({ AUTO: 'automatic', ROOT_ONLY: 'root-only', MANUAL: 'manual' });
const GIB = 1024 ** 3;
const DEFAULT_WORKER_COST = 2 * GIB;
const RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;
const QUEUE_TTL_MS = 10 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000;
const MAX_QUEUE = 4;
// Deliberately not exposed as setup capacity: this is only an emergency guard.
const EMERGENCY_WORKER_CEILING = 4;
const MIN_WORKER_COST = GIB;
const MAX_WORKER_COST = 16 * GIB;
const MAX_MANUAL_WORKERS = 64;
const MAX_PROMPT_BYTES = 1024 * 1024;

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

function emptyState() { return { schema: SCHEMA, reservations: [], queue: [] }; }

function validReservation(entry) {
  return Boolean(entry && typeof entry === 'object'
    && typeof entry.id === 'string' && entry.id.length > 0
    && entry.host === 'claude-code' && entry.topology === TOPOLOGIES.CLAUDE_DIRECT && entry.depth === 1
    && Number.isSafeInteger(entry.owner_pid) && entry.owner_pid > 0
    && Number.isSafeInteger(entry.created_at_ms) && Number.isSafeInteger(entry.expires_at_ms)
    && entry.created_at_ms > 0 && entry.expires_at_ms >= entry.created_at_ms
    && Number.isSafeInteger(entry.estimated_memory_bytes)
    && entry.estimated_memory_bytes >= MIN_WORKER_COST && entry.estimated_memory_bytes <= MAX_WORKER_COST
    && ['medium', 'high', 'xhigh', 'max'].includes(entry.effort) && ['reserved', 'running'].includes(entry.status));
}

function validQueueEntry(entry) {
  return Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length > 0
    && entry.host === 'claude-code' && entry.status === RESULTS.QUEUE
    && Number.isSafeInteger(entry.created_at_ms) && Number.isSafeInteger(entry.expires_at_ms)
    && entry.created_at_ms > 0 && entry.expires_at_ms >= entry.created_at_ms);
}

function validControlState(raw) {
  if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.reservations) || !Array.isArray(raw.queue)
    || !raw.reservations.every(validReservation) || !raw.queue.every(validQueueEntry)) return false;
  const ids = [...raw.reservations, ...raw.queue].map((entry) => entry.id);
  return new Set(ids).size === ids.length;
}

function sanitizeState(raw) {
  if (!validControlState(raw)) return emptyState();
  return { schema: SCHEMA, reservations: raw.reservations.map((entry) => ({ ...entry })), queue: raw.queue.map((entry) => ({ ...entry })) };
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
    return !(expired && !pidAlive(entry.owner_pid));
  });
  state.queue = state.queue.filter((entry) => Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms > now);
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
  };
}

function windowsResources() {
  const command = '$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{physical_total=[double]$o.TotalVisibleMemorySize*1024;physical_available=[double]$o.FreePhysicalMemory*1024;commit_total=[double]$o.TotalVirtualMemorySize*1024;commit_available=[double]$o.FreeVirtualMemory*1024}|ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error('Windows memory counters are unavailable.');
  return { ...JSON.parse(result.stdout), source: 'win32-operating-system' };
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
    && resources.commit_available <= resources.commit_total;
}

function inspectResourceCapability(options = {}) {
  const resources = inspectResources(options);
  const supported = Boolean(validResourceState(resources) && ['proc-meminfo', 'win32-operating-system', 'fixture'].includes(resources.source));
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
  const depth = Number(spec.depth ?? 1);
  if (depth !== 1) throw new Error('The direct-only Toolkit profile blocks nested launches.');
  const effort = String(spec.effort || 'medium').toLowerCase();
  if (!['medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Toolkit-controlled children use medium or explicitly justified higher effort.');
  if (effort !== 'medium') {
    if (String(spec.difficult_role || '').trim().length < 5 || String(spec.effort_justification || '').trim().length < 12) {
      throw new Error('Higher effort requires one named difficult role and a narrow current-task justification.');
    }
  }
  return { ...spec, depth, effort };
}

function refusal(reason) {
  return { result: RESULTS.REFUSE, reason, safe_action: 'Continue with the root agent only; no worker was launched.' };
}

function admissionDecision(specInput, options = {}) {
  const childRefusal = childLaunchRefusal(options);
  if (childRefusal) return childRefusal;
  let spec;
  try { spec = validateLaunchSpec(specInput); }
  catch (error) { return refusal(error.message); }
  const profile = options.profile || readProfile('claude-code', options);
  if (profile.supported !== true || profile.status !== 'configured' || profile.enforcement_verified !== true
    || profile.controller_version !== CONTROL_VERSION || profile.topology !== TOPOLOGIES.CLAUDE_DIRECT
    || ![CAPACITY_MODES.AUTO, CAPACITY_MODES.MANUAL].includes(profile.capacity_mode)) return refusal('The selected Claude profile is root-only, stale, unsupported, or outside the verified Toolkit launch boundary.');
  if (!verifyCurrentClaudeEnforcement(profile, options)) return refusal('Current Claude plugin trust, hook activation, and installed enforcement identity could not be verified.');
  const resources = inspectResources(options);
  if (!validResourceState(resources)) return refusal('Resource state could not be verified safely.');

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
    if (state.queue.length && state.queue[0].id !== spec.queue_id) {
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'An earlier bounded queue entry is still waiting.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = { id: crypto.randomUUID(), host: 'claude-code', created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, status: RESULTS.QUEUE };
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason: 'Earlier Toolkit-controlled work is queued.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    }
    const temporarilyFull = active >= maximum || active >= EMERGENCY_WORKER_CEILING || physicalAfter < physicalReserve || commitAfter < commitReserve;
    if (temporarilyFull) {
      if (queuedReservation) {
        return { result: RESULTS.QUEUE, queue_id: queuedReservation.id, expires_at_ms: queuedReservation.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
      }
      if (state.queue.length >= MAX_QUEUE) return refusal('The bounded worker queue is full.');
      const queued = { id: crypto.randomUUID(), host: 'claude-code', created_at_ms: now, expires_at_ms: now + QUEUE_TTL_MS, status: RESULTS.QUEUE };
      state.queue.push(queued);
      atomicWriteJson(statePath(options), state);
      return { result: RESULTS.QUEUE, queue_id: queued.id, expires_at_ms: queued.expires_at_ms, reason: 'Verified capacity is temporarily unavailable.', safe_action: 'Continue productive root work and retry before the queue entry expires.' };
    }
    if (queuedReservation) state.queue.shift();
    if (spec.effort !== 'medium' && state.reservations.some((entry) => entry.effort !== 'medium')) return refusal('A higher-effort child is already active; sibling effort escalation is not allowed.');
    const reservation = {
      id: crypto.randomUUID(), host: 'claude-code', topology: TOPOLOGIES.CLAUDE_DIRECT, depth: 1,
      owner_pid: options.ownerPid || process.pid, created_at_ms: now, expires_at_ms: now + RESERVATION_TTL_MS,
      estimated_memory_bytes: requested, effort: spec.effort, status: 'reserved',
    };
    state.reservations.push(reservation);
    atomicWriteJson(statePath(options), state);
    return { result: RESULTS.START, reservation_id: reservation.id, expires_at_ms: reservation.expires_at_ms, profile: TOPOLOGIES.CLAUDE_DIRECT, effort: spec.effort, non_fast: 'CLAUDE_CODE_DISABLE_FAST_MODE=1', productive_parent: true };
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
    atomicWriteJson(statePath(options), state);
    return true;
  });
}

function claudeInvocation(spec, options = {}) {
  const checked = validateLaunchSpec(spec);
  const envInput = effectiveEnvironment(options);
  const executable = processLaunch.resolveClaudeCommandInput({ explicit: options.claudeCli, persisted: options.persistedClaudeCli, env: envInput });
  const promptBytes = options.promptBytes || Buffer.from(String(checked.child_prompt || checked.child_responsibility), 'utf8');
  if (!Buffer.isBuffer(promptBytes) || promptBytes.length > MAX_PROMPT_BYTES) throw new Error('Child prompt exceeds the bounded private transport limit.');
  const args = ['--print', '--output-format', 'json', '--effort', checked.effort, '--disallowedTools', 'Agent', 'Task', '--permission-mode', 'default', '--no-session-persistence'];
  const env = { ...envInput, CLAUDE_CODE_DISABLE_FAST_MODE: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', AI_AGENT_TOOLKIT_CHILD: '1' };
  const parts = processLaunch.claudeSpawnParts(executable, args, { env });
  return { executable: parts.command, args: parts.args, windowsVerbatimArguments: parts.windowsVerbatimArguments, raw_executable: executable, raw_args: args, env, stdin: promptBytes, effort: checked.effort, non_fast: true, max_depth: 1 };
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
  try {
    const encoded = String(spec?.child_prompt_base64 || '');
    const promptBytes = Buffer.from(encoded, 'base64');
    if (!encoded || promptBytes.toString('base64') !== encoded || promptBytes.length > MAX_PROMPT_BYTES) throw new Error('Stored child prompt transport is malformed.');
    const invocation = claudeInvocation(spec, { claudeCli: args.claudeCli, promptBytes });
    if (!updateReservation(args.reservation, { owner_pid: process.pid, status: 'running' }, options)) {
      throw new Error('Toolkit reservation state could not be verified before worker execution.');
    }
    code = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      // The executable passed validation and argv is separate; spawn is required for streaming private stdin.
      // lgtm[js/shell-command-injection-from-environment]
      const child = spawn(invocation.executable, invocation.args, { windowsVerbatimArguments: invocation.windowsVerbatimArguments, env: invocation.env, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'] });
      child.on('error', () => finish(1));
      child.on('exit', (value) => finish(Number.isInteger(value) ? value : 1));
      child.stdin.on('error', () => { child.kill(); finish(1); });
      child.stdin.end(invocation.stdin);
    });
  } finally {
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
  SCHEMA, CONTROL_VERSION, RESULTS, TOPOLOGIES, CAPACITY_MODES, GIB, DEFAULT_WORKER_COST, EMERGENCY_WORKER_CEILING, MAX_QUEUE, MAX_MANUAL_WORKERS, MAX_PROMPT_BYTES, LOCK_TTL_MS,
  controlRoot, profilePath, statePath, lockPath, lockRecoveryPath, readProfile, configureProfile, invalidateProfile, validateLaunchSpec, inspectResources, inspectResourceCapability, validResourceState, validActivationProof, verifyCurrentClaudeEnforcement, effectiveEnvironment, effectiveClaudeCommand, acquireLock, recoverStaleRecoveryMarker,
  admissionDecision, updateReservation, releaseReservation, claudeInvocation, launch, recoverState, pidAlive,
};
