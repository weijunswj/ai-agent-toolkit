#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const adapters = require('./toolkit-host-route-adapters.cjs');
const routes = require('./toolkit-route-resolution.cjs');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { return {}; }
}

function decision(input, options = {}) {
  const toolName = String(input.tool_name || input.toolName || '');
  if (!/^(Agent|Task)$/.test(toolName)) return {};
  const launchRecord = input.launch_record || input.launchRecord || input.tool_input?.launch_record || input.toolInput?.launch_record;
  const proof = input.capability_proof || input.capabilityProof || input.tool_input?.capability_proof || input.toolInput?.capability_proof;
  if (!launchRecord || !proof) return deny('EXACT_LAUNCH_REQUIRED');
  try {
    routes.validateResolvedLaunchRecord(launchRecord);
    adapters.assertCapabilityForExactRecord(launchRecord, proof);
    if (launchRecord.host !== 'claude-code') return deny('HOST_CAPABILITY_CONTRADICTION');
    return {};
  } catch (error) {
    return deny(error.code || 'ROUTE_UNAVAILABLE');
  }
}

function deny(code) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Toolkit denied the Claude launch: ${code}.` } };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(decision(readInput()))}\n`); }
  catch { process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Toolkit could not verify the Claude topology safely; continue root-only.' } })}\n`); }
}

module.exports = { decision };
