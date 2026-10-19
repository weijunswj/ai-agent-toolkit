#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const processLaunch = require('./claude-process-launch.cjs');

const SCHEMA = 1;
const CONTROL_VERSION = '3.0.9';
// Host-profile topologies the store reads and writes. CLAUDE_DIRECT is the wire value of
// the retired Toolkit direct topology: the store rejects it, and it is exported only for
// the byte-pinned run093 historical proof (see toolkit-agent-control-run093-history.cjs).
const SUPPORTED_TOPOLOGIES = Object.freeze({ ROOT_ONLY: 'root-only', BROADER_NATIVE: 'broader-native' });
const TOPOLOGIES = Object.freeze({ ...SUPPORTED_TOPOLOGIES, CLAUDE_DIRECT: 'claude-toolkit-direct' });
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
// verified activation bound to the installed plugin bytes) or broader-native (outside
// Toolkit control); invalidation records a root-only policy with its reason.
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
    const validShape = Object.values(SUPPORTED_TOPOLOGIES).includes(raw.topology) && raw.capacity_mode === CAPACITY_MODES.ROOT_ONLY
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
    if (topology === TOPOLOGIES.CLAUDE_DIRECT) throw new Error('The Toolkit direct topology is retired; choose root-only or broader-native.');
    if (!Object.values(SUPPORTED_TOPOLOGIES).includes(topology)) throw new Error(`Unsupported topology: ${topology}`);
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
      enforcement: strict ? 'native-agent-hook-deny' : 'outside-toolkit-control',
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

function parseCli(argv) {
  if(argv[0]==='core'&&['inspect','compile','delegation-plan','run','recover','qualify'].includes(argv[1]))argv=['core-'+argv[1],...argv.slice(2)];
  const parsed = { command: argv[0] || '', root: '', spec: '', input: '', reservation: '', claudeCli: '' };
  for (let i = 1; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--root') { parsed.root = value; i += 1; }
    else if (argv[i] === '--spec') { parsed.spec = value; i += 1; }
    else if (argv[i] === '--input') { parsed.input = value; i += 1; }
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
  // Historical only: runs the verified run093 fixture worker for the pinned proof.
  if (args.command === 'supervise') return require('./toolkit-agent-control-run093-history.cjs').supervise(args);
  throw new Error('Usage: toolkit-agent-control.cjs core inspect|compile|delegation-plan --input <json> | core run|recover|qualify (installed context only)');
}

module.exports = {
  createCoreCommandSession, CoreCommandSession, main, coreRuntimeCommand, coreDataCommand,
  SCHEMA, CONTROL_VERSION, TOPOLOGIES, CAPACITY_MODES, DEFAULT_WORKER_COST, MAX_QUEUE, EMERGENCY_WORKER_CEILING,
  profilePath, readProfile, configureProfile, invalidateProfile, validActivationProof,
};

// Retired direct-launch names read by the byte-pinned run093 historical proof. They are
// forwarded lazily, so current consumers never load the historical module. The proof
// also requires this file to define withRepositoryTestResourceInvocation itself.
function withRepositoryTestResourceInvocation(invocation, root, callback) {
  return require('./toolkit-agent-control-run093-history.cjs').withRepositoryTestResourceInvocation(invocation, root, callback);
}
module.exports.withRepositoryTestResourceInvocation = withRepositoryTestResourceInvocation;
for (const name of ['RESULTS', 'CHECKER_RESULTS', 'HOSTS', 'ROLES', 'GIB', 'statePath', 'lockPath',
  'inspectResources', 'inspectResourceCapability', 'validateLaunchSpec',
  'admissionDecision', 'resourceAdmissionDecision', 'releaseReservation', 'launch', 'checkerWorkflow']) {
  Object.defineProperty(module.exports, name, {
    enumerable: true,
    get: () => require('./toolkit-agent-control-run093-history.cjs')[name],
  });
}

// Run after the exports exist: `supervise` loads the history module, which requires this one.
if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
