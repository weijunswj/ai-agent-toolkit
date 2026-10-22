'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const processLaunch = require('./claude-process-launch.cjs');

const SCHEMA = 1;
const CONTROL_VERSION = '3.3.0';
// Host-profile topologies the store reads and writes. A stored profile with any other
// topology, such as the retired Toolkit direct topology, reads as unsupported (root-only).
// NAMED_HELPERS admits only the Toolkit G0/G1 leaf helpers in governed work. Toolkit 2.10.x
// reads it as an unsupported profile, which it treats as root-only (deny all), so recording
// it never widens an older installed hook the way broader-native would.
const TOPOLOGIES = Object.freeze({ ROOT_ONLY: 'root-only', BROADER_NATIVE: 'broader-native', NAMED_HELPERS: 'toolkit-named-helpers' });
// Every supported profile is root-only capacity; AUTO and MANUAL are retired direct-topology values.
const CAPACITY_MODES = Object.freeze({ AUTO: 'automatic', ROOT_ONLY: 'root-only', MANUAL: 'manual' });
// Fixed schema-1 profile fields. They are still written so an installed earlier Toolkit
// version sharing this profile directory reads it; remove with the next profile schema.
const DEFAULT_WORKER_COST = 2 * 1024 ** 3;
const MAX_QUEUE = 4;
const EMERGENCY_WORKER_CEILING = 4;

function controlRoot(options = {}) {
  return path.resolve(options.root || process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control'));
}

function profilePath(host = 'claude-code', options = {}) {
  return path.join(controlRoot(options), 'profiles', `${host}.json`);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Private Toolkit artifact is not a regular file.');
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) throw new Error('Private Toolkit artifact permissions are not restrictive.');
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

// The stored agent profile for one host. Reads fail closed to a root-only profile;
// configuration accepts root-only (enforced by the installed native hook, so it needs
// verified activation bound to the installed plugin bytes), toolkit-named-helpers (the
// hook's named-helper policy) or broader-native (outside Toolkit control); invalidation
// records a root-only policy with its reason.
class HostProfileStore {
  #host; #options;

  constructor(host = 'claude-code', options = {}) { this.#host = host; this.#options = options; }

  static #supportedHost(host) {
    if (host !== 'claude-code') throw new Error('Toolkit-managed agent profiles are not supported for this host.');
  }

  static #strict(topology) { return topology === TOPOLOGIES.ROOT_ONLY; }

  get path() { return profilePath(this.#host, this.#options); }

  read() {
    const host = this.#host;
    const raw = readJson(this.path);
    if (!raw) return rootOnlyProfile(host, 'unconfigured-root-only', 'No verified Toolkit profile is configured.');
    const validShape = Object.values(TOPOLOGIES).includes(raw.topology) && raw.capacity_mode === CAPACITY_MODES.ROOT_ONLY
      && raw.manual_maximum === 0 && Number.isSafeInteger(raw.worker_estimate_bytes) && raw.worker_estimate_bytes > 0
      && raw.queue_limit === MAX_QUEUE && raw.reservation_limit === EMERGENCY_WORKER_CEILING;
    const strictValid = !HostProfileStore.#strict(raw.topology) || (raw.enforcement_verified === true && raw.controller_version === CONTROL_VERSION
      && raw.enforcement === 'native-agent-hook-deny' && validActivationProof(raw.activation_proof)
      && typeof raw.claude_cli === 'string' && raw.claude_cli.length > 0 && (() => { try { processLaunch.validateExecutable(raw.claude_cli); return true; } catch { return false; } })());
    if (raw.schema !== SCHEMA || raw.host !== host || !validShape || !strictValid || typeof raw.updated_at !== 'string') {
      return rootOnlyProfile(host, 'unsupported-root-only', 'The stored Toolkit profile is malformed, contradictory, stale, retired, or from an unsupported schema.');
    }
    return { ...raw, status: 'configured', supported: true };
  }

  configure(selectedInput) {
    const host = this.#host;
    HostProfileStore.#supportedHost(host);
    let selected;
    try { selected = JSON.parse(JSON.stringify(selectedInput)); }
    catch (_) { throw new Error('The selected Toolkit profile is malformed.'); }
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) throw new Error('The selected Toolkit profile is malformed.');
    if (Object.hasOwn(selected, 'resource_state') || Object.hasOwn(selected, 'resourceState')) {
      throw new Error('Caller-provided resource evidence cannot configure a production profile.');
    }
    const topology = selected.topology;
    if (!Object.values(TOPOLOGIES).includes(topology)) throw new Error(`Unsupported topology: ${topology}`);
    if (selected.capacity_mode !== CAPACITY_MODES.ROOT_ONLY) throw new Error(`Unsupported capacity mode: ${selected.capacity_mode}`);
    const strict = HostProfileStore.#strict(topology);
    if (strict && (selected.enforcement_verified !== true || !validActivationProof(selected.activation_proof))) {
      throw new Error('A root-only Claude profile requires verified current native hook trust and activation bound to the installed plugin bytes.');
    }
    const profile = {
      schema: SCHEMA, host, topology, capacity_mode: CAPACITY_MODES.ROOT_ONLY, manual_maximum: 0,
      worker_estimate_bytes: DEFAULT_WORKER_COST, queue_limit: MAX_QUEUE, reservation_limit: EMERGENCY_WORKER_CEILING,
      controller_version: CONTROL_VERSION, enforcement_verified: strict, activation_proof: strict ? selected.activation_proof : null,
      claude_cli: strict ? processLaunch.validateExecutable(selected.claude_cli || 'claude') : null,
      updated_at: new Date().toISOString(),
      enforcement: strict ? 'native-agent-hook-deny'
        : topology === TOPOLOGIES.NAMED_HELPERS ? 'native-agent-hook-named-helpers' : 'outside-toolkit-control',
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

module.exports = {
  SCHEMA, CONTROL_VERSION, TOPOLOGIES, CAPACITY_MODES, DEFAULT_WORKER_COST, MAX_QUEUE, EMERGENCY_WORKER_CEILING,
  profilePath, readProfile, configureProfile, invalidateProfile, validActivationProof,
};
