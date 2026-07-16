#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const control = require('./toolkit-agent-control.cjs');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { return {}; }
}

function decision(input, options = {}) {
  const toolName = String(input.tool_name || input.toolName || '');
  if (!/^(Agent|Task)$/.test(toolName)) return {};
  const profile = control.readProfile('claude-code', options);
  if (profile.topology === control.TOPOLOGIES.BROADER_NATIVE) return {};
  const reason = profile.topology === control.TOPOLOGIES.CLAUDE_DIRECT
    ? 'Native Claude Agent launches bypass Toolkit resource admission and mode verification. Use repo/scripts/toolkit-agent-control.cjs launch with a complete productive-parent launch specification.'
    : 'Claude agent launch is blocked because the selected or unverifiable Toolkit profile is root-only.';
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(decision(readInput()))}\n`); }
  catch { process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Toolkit could not verify the Claude topology safely; continue root-only.' } })}\n`); }
}

module.exports = { decision };
