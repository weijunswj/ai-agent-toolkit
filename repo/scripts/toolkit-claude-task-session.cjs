'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const { renderNativeHelperDefinition, commandDecision } = require('./toolkit-v3-native-helper-adapter.cjs');
const SCHEMA = 'toolkit.v3.claude-task-session.v2';
const OVERRIDE_SCHEMA = 'toolkit.v3.claude-task-session.parent-only.v3';
const digest = value => compiler.hashCanonical(value);
const bytesDigest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function taskRoot(root) {
  if (!path.isAbsolute(root || '')) fail('CLAUDE_TASK_ROOT_REQUIRED');
  const value = path.resolve(root);
  if (value === path.join(os.homedir(), '.ai-agent-toolkit', 'agent-control')) fail('CLAUDE_GLOBAL_PROFILE_FORBIDDEN');
  let current = path.parse(value).root;
  for (const part of value.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('CLAUDE_TASK_ROOT_ALIAS');
  }
  return value;
}
function authorityPins(options = {}) {
  return { root_disposition_sha256: options.root_disposition_sha256 || process.env.TOOLKIT_CLAUDE_ROOT_DISPOSITION_SHA256,
    owner_reference_sha256: options.owner_reference_sha256 || process.env.TOOLKIT_CLAUDE_OWNER_REFERENCE_SHA256 };
}
function readAuthorityFile(root, name, pin) {
  if (!/^[a-f0-9]{64}$/.test(pin || '')) fail('CLAUDE_OVERRIDE_INDEPENDENT_PIN_REQUIRED');
  const folder = path.join(taskRoot(root), 'authority'), file = path.join(folder, name);
  const directory = fs.lstatSync(folder), stat = fs.lstatSync(file);
  if (!directory.isDirectory() || directory.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()
    || stat.nlink !== 1 || stat.size > 65536) fail('CLAUDE_OVERRIDE_AUTHORITY_ALIAS');
  const bytes = fs.readFileSync(file);if (bytesDigest(bytes) !== pin) fail('CLAUDE_OVERRIDE_AUTHORITY_PIN_DRIFT');
  return compiler.trustedJsonCopy(JSON.parse(bytes));
}
// Explicitly owner-authorised, bounded task-specific overrides live as closed data
// with their provenance; this module holds no model choice or owner record of its own.
const OVERRIDES_PATH = path.join(__dirname, '..', 'contracts', 'controller-kernel', 'qualification-overrides-v1.json');
class QualificationOverrideCatalogue {
  #entries;
  constructor(document) {
    const value = compiler.trustedJsonCopy(document);
    if (!value || value.schema !== 'toolkit.controller.qualification-overrides.v1' || !Array.isArray(value.overrides)) fail('CLAUDE_OVERRIDE_CATALOGUE_INVALID');
    const keys = new Set();
    for (const entry of value.overrides) {
      const key = entry?.owner_reference?.record_reference?.key;
      if (typeof key !== 'string' || !key || keys.has(key) || entry.host !== 'claude-code'
        || !entry.parent_route?.model || !entry.parent_route?.effort) fail('CLAUDE_OVERRIDE_CATALOGUE_INVALID');
      keys.add(key);
    }
    this.#entries = Object.freeze(value.overrides.map(entry => Object.freeze(entry)));
  }
  static load(file = OVERRIDES_PATH) { return new QualificationOverrideCatalogue(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  // Returns the single entry bound by the owner reference's record key, or rejects.
  entryFor(owner, role) {
    const entry = this.#entries.find(item => item.owner_reference.record_reference.key === owner?.record_reference?.key);
    if (!entry || entry.caller_role !== role) fail('CLAUDE_OVERRIDE_AUTHORITY_SCOPE_OR_ROUTE_REJECTED');
    return entry;
  }
}
function qualificationAuthority({ root, cwd, session_id, task_id, binding, role = 'G1' }, options = {}) {
  const pins = authorityPins(options);
  if (!binding || Object.keys(binding).sort().join('|') !== ['owner_reference_sha256','root_disposition_sha256','task_id'].sort().join('|')
    || binding.task_id !== task_id || binding.root_disposition_sha256 !== pins.root_disposition_sha256
    || binding.owner_reference_sha256 !== pins.owner_reference_sha256) fail('CLAUDE_OVERRIDE_AUTHORITY_BINDING_REQUIRED');
  const owner = readAuthorityFile(root, 'owner-reference.json', pins.owner_reference_sha256);
  const disposition = readAuthorityFile(root, 'root-disposition.json', pins.root_disposition_sha256);
  const entry = (options.override_catalogue || QualificationOverrideCatalogue.load()).entryFor(owner, role);
  const keys = (value, expected) => Object.keys(value).sort().join('|') === expected.sort().join('|');
  const route = compiler.trustedJsonCopy(entry.parent_route);
  const exact = value => value.task_id === task_id && value.session_id === session_id && value.cwd === cwd
    && value.control_root === root && digest(value.parent) === digest(route);
  const expectedOwner = entry.owner_reference, expectedDisposition = entry.root_disposition;
  const { phase_limits_ms: expectedPhases, ...expectedLimits } = expectedDisposition;
  if (!keys(owner, ['schema','state','task_id','session_id','cwd','control_root','parent','owner_model_sentinel','record_reference','helper_inference_permitted'])
    || !keys(owner.record_reference || {}, ['repository','path','key','blob','decision_sha256'])
    || !keys(disposition, ['schema','state','task_id','session_id','cwd','control_root','parent','owner_reference_sha256', ...Object.keys(expectedDisposition)])
    || !keys(disposition.phase_limits_ms || {}, Object.keys(expectedPhases))
    || !task_id || typeof task_id !== 'string' || !exact(owner) || !exact(disposition)
    || owner.schema !== expectedOwner.schema || owner.state !== expectedOwner.state
    || owner.owner_model_sentinel !== expectedOwner.owner_model_sentinel
    || owner.record_reference.repository !== expectedOwner.record_reference.repository
    || owner.record_reference.path !== expectedOwner.record_reference.path
    || !/^[a-f0-9]{40}$/.test(owner.record_reference.blob || '')
    || !/^[a-f0-9]{64}$/.test(owner.record_reference.decision_sha256 || '')
    || owner.helper_inference_permitted !== expectedOwner.helper_inference_permitted
    || disposition.owner_reference_sha256 !== pins.owner_reference_sha256
    || Object.entries(expectedLimits).some(([key, value]) => disposition[key] !== value)
    || Object.entries(expectedPhases).some(([key, value]) => disposition.phase_limits_ms[key] !== value)) {
    fail('CLAUDE_OVERRIDE_AUTHORITY_SCOPE_OR_ROUTE_REJECTED');
  }
  return { route, pins, override_id: entry.override_id };
}
function createTaskSessionProfile({ control_root, cwd, session_id, role = 'G1', source_capture, selection, qualification_override }, options = {}) {
  const root = taskRoot(control_root), definition = renderNativeHelperDefinition('claude-code', role, { source_capture, selection });
  if (!path.isAbsolute(cwd || '') || typeof session_id !== 'string' || !session_id.trim()) fail('CLAUDE_TASK_PARENT_REQUIRED');
  const profile = compiler.trustedJsonCopy({ schema: SCHEMA, purpose: 'QUALIFICATION_ONLY', control_root: root,
    cwd: path.resolve(cwd), session_id, caller_role: role, profile_id: selection.profile_id, source_capture, selection,
    registry_revision: definition.registry_revision, helper_identity: definition.helper_identity,
    parent: { model: require('./toolkit-v3-native-helper-adapter.cjs').claudeNativeModel(selection.routes[role === 'G0' ? 'DISCOVERY' : 'BUILDER']), effort: selection.routes[role === 'G0' ? 'DISCOVERY' : 'BUILDER'].reasoning }, helper: definition.native_configuration,
    native_control: { permission_prompts: 'host', ask_rules: ['Agent', 'Task'], hook_timeout_seconds: 10,
      parent_tool_pool: ['Agent'], leaf_disallowed_tools: ['Agent', 'Task'] },
    resource_control: { mode: 'EXTERNAL_SERIAL_FINITE_QUALIFICATION', root_disposition: 'REQUIRED',
      max_inflight_helpers: 1, consumption_bounds: 'UNBOUND', native_concurrency_claim: 'NONE_WITHOUT_EXTERNAL_GATE' },
    inference_authority: 'NONE_FROM_PROFILE', qualification: 'UNQUALIFIED' });
  if (qualification_override !== undefined) {
    if (role !== 'G1') fail('CLAUDE_OVERRIDE_PARENT_ROLE_REJECTED');
    const approved = qualificationAuthority({ root, cwd: profile.cwd, session_id, task_id: qualification_override.task_id,
      binding: qualification_override, role }, options);
    profile.schema = OVERRIDE_SCHEMA;profile.parent = approved.route;
    profile.qualification_override = compiler.trustedJsonCopy(qualification_override);
    profile.memory_control = { process_local_disable_auto_memory: '1', session_auto_memory_enabled: false,
      context_closure_required: true, private_memory_permitted: false };
    profile.resource_control.helper_dispatches_permitted = 0;
    profile.resource_control.helper_inference_permitted = 0;
    profile.resource_control.task_effects_permitted = 0;
  }
  return profile;
}
function validateTaskSessionProfile(raw, options = {}) {
  const p = compiler.trustedJsonCopy(raw);
  const expected = createTaskSessionProfile({ control_root: p.control_root, cwd: p.cwd, session_id: p.session_id, role: p.caller_role, source_capture: p.source_capture, selection: p.selection,
    ...(p.qualification_override === undefined ? {} : { qualification_override: p.qualification_override }) }, options);
  if (digest(p) !== digest(expected)) fail('CLAUDE_TASK_PROFILE_DRIFT');
  return Object.freeze(p);
}
function renderSessionConfiguration(profile, hookPath, options = {}) {
  const p = validateTaskSessionProfile(profile, options);
  if (!path.isAbsolute(hookPath || '')) fail('CLAUDE_TASK_HOOK_REQUIRED');
  const agent = p.helper;
  const config = { settings: { permissions: { ask: [...p.native_control.ask_rules], deny: ['Workflow'] },
    hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: 'node "' + hookPath + '"', timeout: 10 }] }] } },
    agents: { [p.helper_identity]: { description: agent.description, prompt: agent.prompt, model: agent.model,
      effort: agent.effort, disallowedTools: [...p.native_control.leaf_disallowed_tools] } },
    argv: ['--model', p.parent.model, '--effort', p.parent.effort, '--tools', 'Agent',
      '--permission-mode', 'default', '--permission-prompts', 'host', '--input-format', 'stream-json',
      '--output-format', 'stream-json', '--verbose'],
    environment_references: { AI_AGENT_TOOLKIT_CONTROL_ROOT: p.control_root },
    activation: 'REQUIRES_ROOT_DISPOSITION_AND_VERIFIED_HOST_CONTROL; NO_INFERENCE_GRANT' };
  if (p.qualification_override) {
    config.settings.autoMemoryEnabled = false;
    config.environment_references = { ...config.environment_references, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      TOOLKIT_CLAUDE_ROOT_DISPOSITION_SHA256: p.qualification_override.root_disposition_sha256,
      TOOLKIT_CLAUDE_OWNER_REFERENCE_SHA256: p.qualification_override.owner_reference_sha256 };
    config.argv.push('--permission-prompt-tool=stdio');
    config.helper_execution = 'PROHIBITED_PARENT_ONLY_TEST';
  }
  return config;
}
function readPinnedTaskProfile(root, expectedDigest, options = {}) {
  const folder = taskRoot(root);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest || '')) fail('CLAUDE_TASK_PROFILE_PIN_REQUIRED');
  const filename = path.join(folder, 'profiles', 'claude-task-session.json');
  const profileDirectory=fs.lstatSync(path.dirname(filename));
  if(!profileDirectory.isDirectory()||profileDirectory.isSymbolicLink())fail('CLAUDE_TASK_PROFILE_DIRECTORY_ALIAS');
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > 65536) fail('CLAUDE_TASK_PROFILE_FILE_INVALID');
  const bytes = fs.readFileSync(filename);
  if (bytesDigest(bytes) !== expectedDigest) fail('CLAUDE_TASK_PROFILE_PIN_DRIFT');
  const p = validateTaskSessionProfile(JSON.parse(bytes), options);
  if (p.control_root !== folder) fail('CLAUDE_TASK_PROFILE_ROOT_MISMATCH');
  return p;
}
function receiptPath(profile, toolUseId) {
  if (typeof toolUseId !== 'string' || !toolUseId || toolUseId.length > 256) fail('CLAUDE_TOOL_USE_ID_REQUIRED');
  return path.join(profile.control_root, 'prechecks', bytesDigest(Buffer.from(toolUseId)) + '.json');
}
function launchFingerprint(profile, config, options = {}) {
  const p = validateTaskSessionProfile(profile, options);
  return digest({ profile: p, settings: config.settings, agents: config.agents, argv: config.argv,
    environment_references: config.environment_references, hook_watchdog: p.native_control.hook_timeout_seconds,
    ...(config.launch_binding === undefined ? {} : { launch_binding: compiler.trustedJsonCopy(config.launch_binding) }) });
}
function assertQualificationContext(profile, observation, options = {}) {
  const p = validateTaskSessionProfile(profile, options);if (!p.qualification_override) return true;
  let o;try { o = compiler.trustedJsonCopy(observation); } catch { fail('CLAUDE_QUALIFICATION_CONTEXT_NOT_CLOSED'); }
  if (!o || o.schema !== 'toolkit.v3.claude-context-closure.v1' || o.state !== 'VERIFIED'
    || o.task_id !== p.qualification_override.task_id || o.session_id !== p.session_id || o.cwd !== p.cwd
    || o.profile_digest !== digest(p) || o.process_local_disable_auto_memory !== '1'
    || o.effective_auto_memory_enabled !== false || o.policy_complete !== true
    || !/^[a-f0-9]{64}$/.test(o.policy_digest || '') || o.private_memory_read !== false
    || !Array.isArray(o.unexpected_context_sources) || o.unexpected_context_sources.length
    || !Array.isArray(o.relevant_instruction_sources) || !o.relevant_instruction_sources.length
    || o.relevant_instruction_sources.some(s=>s.kind!=='ToolkitProject' || !s.path || !/^[a-f0-9]{64}$/.test(s.sha256||''))
    || o.competing_permission_responder !== false || o.mutable_or_fallback_configuration !== false
    || o.actual_parent?.model !== p.parent.model || o.actual_parent?.effort !== p.parent.effort
    || !/^[a-f0-9]{64}$/.test(o.launch_fingerprint || '')
    || o.launch_fingerprint !== options.expected_launch_fingerprint) fail('CLAUDE_QUALIFICATION_CONTEXT_NOT_CLOSED');
  return true;
}
function readPinnedContextObservation(root, expectedDigest) {
  return readAuthorityFile(root, 'context-closure.json', expectedDigest);
}
async function taskPrecheck(input, { profile, native_guard = {}, authority_pins = {}, context_observation, expected_launch_fingerprint }) {
  const p = validateTaskSessionProfile(profile, authority_pins), event = compiler.trustedJsonCopy(input);
  if (!['Agent', 'Task'].includes(event.tool_name)) return {};
  if (p.qualification_override) assertQualificationContext(p, context_observation, { ...authority_pins, expected_launch_fingerprint });
  let outcome;
  if (event.session_id !== p.session_id || event.cwd !== p.cwd || event.agent_id || event.agent_type) {
    outcome = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'CLAUDE_TASK_CALLER_MISMATCH' } };
  } else outcome = await commandDecision(event, 'claude-code', { ...native_guard, source_capture: p.source_capture, selection: p.selection });
  const permission = outcome.hookSpecificOutput?.permissionDecision;
  const receipt = { schema: 'toolkit.v3.claude-parent-precheck.v1', profile_digest: digest(p),
    session_id: p.session_id, tool_use_id: event.tool_use_id, tool_name: event.tool_name,
    input_digest: digest(event.tool_input), decision: permission === 'allow' ? 'ROUTE_PRECHECK_PASSED' : 'DENY',
    guard_reason: outcome.hookSpecificOutput?.permissionDecisionReason || null,
    downstream_permission: 'MANDATORY_HOST_CALLBACK', inference_authority: 'NONE' };
  const filename = receiptPath(p, event.tool_use_id);fs.mkdirSync(path.dirname(filename), { recursive: true });
  if(fs.lstatSync(path.dirname(filename)).isSymbolicLink())fail('CLAUDE_PRECHECK_DIRECTORY_ALIAS');
  try { fs.writeFileSync(filename, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST' || digest(JSON.parse(fs.readFileSync(filename))) !== digest(receipt)) fail('CLAUDE_PRECHECK_REPLAY_OR_DRIFT'); }
  if (permission !== 'allow') return outcome;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: 'Toolkit route precheck passed; external serial/finite resource gate and host permission callback must admit before Agent creation.' } };
}
module.exports = Object.freeze({ SCHEMA, OVERRIDE_SCHEMA, QualificationOverrideCatalogue, createTaskSessionProfile, validateTaskSessionProfile,
  renderSessionConfiguration, readPinnedTaskProfile, receiptPath, taskPrecheck, launchFingerprint,
  assertQualificationContext, readPinnedContextObservation });
