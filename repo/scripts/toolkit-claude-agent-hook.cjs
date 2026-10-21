#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
// Decision modules load inside the guarded path: a missing or broken module becomes a
// handled deny, not a process crash that Claude Code treats as a non-blocking error.
const control = () => require('./toolkit-agent-control.cjs');
const nativeAdapter = () => require('./toolkit-v3-native-helper-adapter.cjs');
const governedRepo = () => require('./toolkit-governed-repo.cjs');
const helperPolicy = () => require('./toolkit-claude-helper-policy.cjs');

// Normal-folder refusal for an agent launched by a subagent. It lives here, not in a decision
// module, so the module-failure path can give the same plain reason.
const ONE_LAYER_DENIAL = Object.freeze({ hookSpecificOutput: Object.freeze({ hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: "Toolkit: a subagent can't start another agent (one layer only). Do the work in this subagent, or hand it back to the main session." }) });

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { return {}; }
}

function decision(input, options = {}) {
  const toolName = String(input.tool_name || input.toolName || '');
  if (!/^(Agent|Task)$/.test(toolName)) return {};
  const taskPin = options.task_profile_sha256 || process.env.TOOLKIT_CLAUDE_TASK_PROFILE_SHA256;
  if (taskPin) {
    const task = require('./toolkit-claude-task-session.cjs');
    const root = options.root || process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT;
    const authorityPins = options.authority_pins || {};
    const taskProfile = task.readPinnedTaskProfile(root, taskPin, authorityPins);
    const context = taskProfile.qualification_override ? options.context_observation || task.readPinnedContextObservation(root,
      options.context_report_sha256 || process.env.TOOLKIT_CLAUDE_CONTEXT_REPORT_SHA256) : undefined;
    return task.taskPrecheck(input, { profile: taskProfile, native_guard: {
      binding_path: process.env.TOOLKIT_NATIVE_HELPER_BINDING,
      binding_sha256: process.env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
      ...options.native_guard
    }, authority_pins: authorityPins, context_observation: context,
      expected_launch_fingerprint: options.expected_launch_fingerprint || process.env.TOOLKIT_CLAUDE_LAUNCH_FINGERPRINT });
  }
  // Outside Toolkit-governed work only one layer applies: the main session launches any agent
  // with no decision, and a subagent never launches another unless the owner chose broader
  // native behaviour. A missing or unreadable profile reads as root-only, so the refusal stays.
  // `agent_id` marks a subagent or teammate caller; `agent_type` alone also appears in a main
  // session started with --agent.
  const environment = options.environment || process.env;
  const governance = options.governance || governedRepo().governedRepo(input.cwd, environment);
  const { readProfile, TOPOLOGIES } = control();
  if (!governance.governed) {
    if (!input.agent_id) return {};
    return readProfile('claude-code', options).topology === TOPOLOGIES.BROADER_NATIVE ? {} : ONE_LAYER_DENIAL;
  }
  const profile = readProfile('claude-code', options);
  if (profile.topology === TOPOLOGIES.BROADER_NATIVE) return nativeAdapter().commandDecision(input, 'claude-code', {
    binding_path: process.env.TOOLKIT_NATIVE_HELPER_BINDING,
    binding_sha256: process.env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
    helper_identity: process.env.TOOLKIT_NATIVE_HELPER_IDENTITY,
    ...options.native_guard
  });
  // Root-only, named-helpers and unconfigured profiles all admit only the Toolkit's own
  // leaf helpers in governed work.
  const { ClaudeNamedHelperPolicy } = helperPolicy();
  return new ClaudeNamedHelperPolicy({ environment, ...options.helper_policy }).decide(input, governance);
}

const CHECK_FAILED_DENIAL = Object.freeze({ hookSpecificOutput: Object.freeze({ hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: 'Toolkit could not check this helper launch safely; do the work in this session.' }) });

// After a decision failure, refuse only what a working hook could refuse: an Agent/Task call
// in a governed repository, or with a launcher marker when governance cannot be determined;
// elsewhere a subagent's Agent/Task call gets the plain one-layer reason, since the profile
// that could lift it was not read.
function outputAfterFailure(input) {
  if (!/^(Agent|Task)$/.test(String(input?.tool_name || input?.toolName || ''))) return {};
  let governed;
  try { governed = governedRepo().governedRepo(input.cwd).governed; }
  catch { governed = ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256'].some(name => Boolean(process.env[name])); }
  if (governed) return CHECK_FAILED_DENIAL;
  return input.agent_id ? ONE_LAYER_DENIAL : {};
}

// Optional qualification evidence: when a launcher sets TOOLKIT_HOOK_DECISION_LOG to an
// absolute path, append one privacy-minimised line per decision (no prompt text).
function traceDecision(input, output) {
  const target = process.env.TOOLKIT_HOOK_DECISION_LOG;
  if (!target || !require('node:path').isAbsolute(target)) return;
  const args = input?.tool_input || {};
  const line = { at: new Date().toISOString(), host: 'claude-code', hook: 'PreToolUse', session_id: input?.session_id || null,
    tool_name: input?.tool_name || null, subagent_type: args.subagent_type ?? args.agent_type ?? null,
    requested_model: typeof args.model === 'string' ? args.model : null, caller_agent_id: input?.agent_id || null,
    decision: output?.hookSpecificOutput?.permissionDecision || 'none', reason: output?.hookSpecificOutput?.permissionDecisionReason || null };
  try { fs.appendFileSync(target, `${JSON.stringify(line)}\n`); } catch { /* tracing never changes the decision */ }
}

if (require.main === module) {
  const input = process.argv[2] === '--print-helper-definition' ? null : readInput();
  Promise.resolve().then(() => input === null
    ? nativeAdapter().renderNativeHelperDefinition('claude-code', process.argv[3], nativeAdapter().readNativeSelectionFromEnvironment()) : decision(input)).then(output => {
    if (input !== null) traceDecision(input, output);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }).catch(() => {
    const output = input === null ? CHECK_FAILED_DENIAL : outputAfterFailure(input);
    if (input !== null) traceDecision(input, output);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  });
}

module.exports = { decision };
