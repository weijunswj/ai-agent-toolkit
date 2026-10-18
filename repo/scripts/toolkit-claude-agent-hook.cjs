#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const control = require('./toolkit-agent-control.cjs');
const { commandDecision, renderNativeHelperDefinition, readNativeSelectionFromEnvironment } = require('./toolkit-v3-native-helper-adapter.cjs');

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
  const profile = control.readProfile('claude-code', options);
  if (profile.topology === control.TOPOLOGIES.BROADER_NATIVE) return commandDecision(input, 'claude-code', {
    binding_path: process.env.TOOLKIT_NATIVE_HELPER_BINDING,
    binding_sha256: process.env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
    helper_identity: process.env.TOOLKIT_NATIVE_HELPER_IDENTITY,
    ...options.native_guard
  });
  const reason = 'Claude native Agent/Task launches are blocked at this hook. Governed V3 workers use only the registry-pinned launcher through an authorised controller; unqualified profiles remain root-only.';
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
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
    ? renderNativeHelperDefinition('claude-code', process.argv[3], readNativeSelectionFromEnvironment()) : decision(input)).then(output => {
    if (input !== null) traceDecision(input, output);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }).catch(() => {
    const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Toolkit could not verify the Claude topology safely; continue root-only.' } };
    if (input !== null) traceDecision(input, output);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  });
}

module.exports = { decision };
