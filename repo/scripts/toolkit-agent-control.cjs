#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const SCHEMA = 1;
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

function controlRoot(options = {}) {
  return path.resolve(options.root || process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control'));
}

function profilePath(host = 'claude-code', options = {}) {
  return path.join(controlRoot(options), 'profiles', `${host}.json`);
}

function statePath(options = {}) { return path.join(controlRoot(options), 'state.json'); }
function lockPath(options = {}) { return path.join(controlRoot(options), 'state.lock'); }

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, filePath);
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

function acquireLock(options = {}) {
  const root = controlRoot(options);
  const target = lockPath(options);
  fs.mkdirSync(root, { recursive: true });
  const deadline = Date.now() + (options.lockWaitMs || 5000);
  for (;;) {
    try {
      fs.mkdirSync(target);
      try {
        atomicWriteJson(path.join(target, 'owner.json'), { pid: process.pid, created_at_ms: Date.now() });
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        throw error;
      }
      return () => {
        const owner = readJson(path.join(target, 'owner.json'));
        if (owner?.pid === process.pid) fs.rmSync(target, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readJson(path.join(target, 'owner.json'));
      const stale = owner && Number.isFinite(owner.created_at_ms) && Date.now() - owner.created_at_ms > LOCK_TTL_MS;
      if (stale && !pidAlive(owner.pid)) {
        fs.rmSync(target, { recursive: true, force: true });
        continue;
      }
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

function sanitizeState(raw) {
  if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.reservations) || !Array.isArray(raw.queue)) return emptyState();
  return { schema: SCHEMA, reservations: raw.reservations.filter((v) => v && typeof v === 'object'), queue: raw.queue.filter((v) => v && typeof v === 'object') };
}

function validControlState(raw) {
  return Boolean(raw && raw.schema === SCHEMA && Array.isArray(raw.reservations) && Array.isArray(raw.queue));
}

function recoverState(state, now = Date.now()) {
  state.reservations = state.reservations.filter((entry) => {
    const expired = Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms <= now;
    return !(expired && !pidAlive(entry.owner_pid));
  });
  state.queue = state.queue.filter((entry) => Number.isFinite(entry.expires_at_ms) && entry.expires_at_ms > now);
  return state;
}

function readProfile(host = 'claude-code', options = {}) {
  const raw = readJson(profilePath(host, options));
  if (!raw || raw.schema !== SCHEMA || raw.host !== host) {
    return { schema: SCHEMA, host, topology: TOPOLOGIES.ROOT_ONLY, capacity_mode: CAPACITY_MODES.ROOT_ONLY, manual_maximum: 0, status: 'unconfigured-root-only' };
  }
  return raw;
}

function configureProfile(host, selected, options = {}) {
  if (host !== 'claude-code') throw new Error('Toolkit-managed agent launch is not supported for this host.');
  const topology = selected.topology;
  const capacityMode = selected.capacity_mode;
  if (!Object.values(TOPOLOGIES).includes(topology)) throw new Error(`Unsupported topology: ${topology}`);
  if (!Object.values(CAPACITY_MODES).includes(capacityMode)) throw new Error(`Unsupported capacity mode: ${capacityMode}`);
  if (topology !== TOPOLOGIES.CLAUDE_DIRECT && capacityMode === CAPACITY_MODES.AUTO) {
    throw new Error('Automatic admission is available only for the Toolkit-managed direct Claude topology.');
  }
  let manualMaximum = 0;
  if (capacityMode === CAPACITY_MODES.MANUAL) {
    manualMaximum = Number(selected.manual_maximum);
    if (!Number.isSafeInteger(manualMaximum) || manualMaximum < 1) throw new Error('Manual maximum must be a positive integer.');
  }
  const profile = {
    schema: SCHEMA,
    host,
    topology,
    capacity_mode: capacityMode,
    manual_maximum: manualMaximum,
    updated_at: new Date().toISOString(),
    enforcement: topology === TOPOLOGIES.CLAUDE_DIRECT ? 'toolkit-launch-boundary' : (topology === TOPOLOGIES.ROOT_ONLY ? 'native-agent-hook-deny' : 'outside-toolkit-control'),
  };
  atomicWriteJson(profilePath(host, options), profile);
  return profile;
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
    .every((key) => Number.isFinite(resources[key]) && resources[key] > 0)
    && resources.physical_available <= resources.physical_total
    && resources.commit_available <= resources.commit_total;
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
  let spec;
  try { spec = validateLaunchSpec(specInput); }
  catch (error) { return refusal(error.message); }
  const profile = options.profile || readProfile('claude-code', options);
  if (profile.topology !== TOPOLOGIES.CLAUDE_DIRECT || profile.capacity_mode === CAPACITY_MODES.ROOT_ONLY) return refusal('The selected Claude topology is root-only or outside the Toolkit launch boundary.');
  const resources = inspectResources(options);
  if (!validResourceState(resources)) return refusal('Resource state could not be verified safely.');

  return withLock(options, () => {
    const now = options.now || Date.now();
    const stateFile = statePath(options);
    const rawState = readJson(stateFile);
    if (fs.existsSync(stateFile) && !validControlState(rawState)) return refusal('Toolkit admission state could not be verified safely.');
    const state = recoverState(sanitizeState(rawState || emptyState()), now);
    const active = state.reservations.length;
    const maximum = profile.capacity_mode === CAPACITY_MODES.MANUAL ? profile.manual_maximum : EMERGENCY_WORKER_CEILING;
    const physicalReserve = Math.max(4 * GIB, resources.physical_total * 0.25);
    const commitReserve = Math.max(6 * GIB, resources.commit_total * 0.20);
    const requested = Number(spec.estimated_memory_bytes || DEFAULT_WORKER_COST);
    if (!Number.isFinite(requested) || requested < GIB || requested > 16 * GIB) return refusal('The requested worker cost is unknown or outside the supported range.');
    const physicalAfter = resources.physical_available - requested;
    const commitAfter = resources.commit_available - requested;
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
    const state = recoverState(sanitizeState(readJson(statePath(options), emptyState())));
    const entry = state.reservations.find((item) => item.id === id);
    if (!entry) return false;
    Object.assign(entry, updates);
    atomicWriteJson(statePath(options), state);
    return true;
  });
}

function releaseReservation(id, options = {}) {
  return withLock(options, () => {
    const state = recoverState(sanitizeState(readJson(statePath(options), emptyState())));
    const before = state.reservations.length;
    state.reservations = state.reservations.filter((entry) => entry.id !== id);
    atomicWriteJson(statePath(options), state);
    return state.reservations.length !== before;
  });
}

function claudeInvocation(spec, options = {}) {
  const checked = validateLaunchSpec(spec);
  const executable = options.claudeCli || process.env.AI_AGENT_TOOLKIT_CLAUDE_CLI || 'claude';
  const args = ['--print', '--output-format', 'json', '--effort', checked.effort, '--disallowedTools', 'Agent', '--permission-mode', 'default', String(checked.child_prompt || checked.child_responsibility)];
  const env = { ...process.env, CLAUDE_CODE_DISABLE_FAST_MODE: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', AI_AGENT_TOOLKIT_CHILD: '1' };
  const parts = require('./setup-claude-toolkit-plugin.cjs').claudeSpawnParts(executable, args);
  return { executable: parts.command, args: parts.args, shell: parts.shell, raw_executable: executable, raw_args: args, env, effort: checked.effort, non_fast: true, max_depth: 1 };
}

function launch(specInput, options = {}) {
  const spec = validateLaunchSpec(specInput);
  const admitted = admissionDecision(spec, options);
  if (admitted.result !== RESULTS.START) return admitted;
  const root = controlRoot(options);
  const jobs = path.join(root, 'jobs');
  fs.mkdirSync(jobs, { recursive: true });
  const specPath = path.join(jobs, `${admitted.reservation_id}.json`);
  atomicWriteJson(specPath, spec);
  const outputPath = path.join(jobs, `${admitted.reservation_id}.stdout.json`);
  const errorPath = path.join(jobs, `${admitted.reservation_id}.stderr.log`);
  const out = fs.openSync(outputPath, 'a');
  const err = fs.openSync(errorPath, 'a');
  try {
    const supervisorArgs = [__filename, 'supervise', '--root', root, '--reservation', admitted.reservation_id, '--spec', specPath];
    if (options.claudeCli) supervisorArgs.push('--claude-cli', options.claudeCli);
    const supervisor = spawn(process.execPath, supervisorArgs, { detached: true, windowsHide: true, stdio: ['ignore', out, err], env: process.env });
    supervisor.unref();
    return { ...admitted, supervisor_pid: supervisor.pid, output_path: outputPath, error_path: errorPath, status: 'launched' };
  } catch (error) {
    releaseReservation(admitted.reservation_id, options);
    return refusal('Worker launch failed safely before execution.');
  } finally {
    fs.closeSync(out); fs.closeSync(err);
  }
}

async function supervise(args) {
  const spec = readJson(args.spec);
  const options = { root: args.root };
  const invocation = claudeInvocation(spec, { claudeCli: args.claudeCli });
  updateReservation(args.reservation, { owner_pid: process.pid, status: 'running' }, options);
  const code = await new Promise((resolve) => {
    const child = spawn(invocation.executable, invocation.args, { shell: invocation.shell, env: invocation.env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', () => resolve(1));
    child.on('exit', (value) => resolve(Number.isInteger(value) ? value : 1));
  });
  releaseReservation(args.reservation, options);
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
  SCHEMA, RESULTS, TOPOLOGIES, CAPACITY_MODES, GIB, DEFAULT_WORKER_COST, EMERGENCY_WORKER_CEILING,
  controlRoot, profilePath, statePath, readProfile, configureProfile, validateLaunchSpec, inspectResources,
  admissionDecision, updateReservation, releaseReservation, claudeInvocation, launch, recoverState, pidAlive,
};
