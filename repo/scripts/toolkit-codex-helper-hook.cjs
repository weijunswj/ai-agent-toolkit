#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

// The decision modules load inside the guarded path, so a missing or broken module
// denies with the blocking exit status instead of crashing as a non-blocking failure.
const adapter = () => require('./toolkit-v3-native-helper-adapter.cjs');

// Enforcement applies only inside Toolkit itself: a Toolkit checkout at the nearest git
// root, or a session a Toolkit launcher started (launcher marker). It uses the predicate
// shared with the Claude hook with the managed-block test turned off, so repositories that
// only carry the Toolkit-governed rules block keep native Codex helpers until
// the Codex lane (#469) adds a named-helper allow-list. Elsewhere the hook makes no
// decision. Helper depth on Codex stays advisory: PreToolUse carries no caller-agent identity.
const LAUNCHER_MARKERS = ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256'];
function governed(input, environment = process.env) {
  try { return require('./toolkit-governed-repo.cjs').governedRepo(input?.cwd, environment, { managedBlock: false }).governed; }
  // Without the predicate, gate only when a launcher marker says this is governed work.
  catch { return LAUNCHER_MARKERS.some(name => Boolean(environment[name])); }
}

// Native hook names: `spawn_agent` (default and multi_agent_v1 namespaces), the
// `Agent` alias, and the flattened MultiAgentV2 name `<namespace>spawn_agent` for any
// host-valid namespace, hyphenated ones included (`collaborationspawn_agent`, `multi-agentspawn_agent`).
async function decide(input, environment = process.env) {
  if (!governed(input, environment)) return {};
  const { CodexDialect, commandDecision } = adapter();
  if (!CodexDialect.isSpawnRequest(input?.tool_name)) return {};
  return commandDecision(input, 'codex', {
    binding_path: environment.TOOLKIT_NATIVE_HELPER_BINDING,
    binding_sha256: environment.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
    helper_identity: environment.TOOLKIT_NATIVE_HELPER_IDENTITY
  });
}

const HELD = 'Toolkit helper guard failed';
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) + '\n');
  // Blocking exit status, with the reason on stderr, for hosts that honour exit 2.
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}

async function main() {
  if (process.argv[2] === '--print-helper-definition') {
    const { renderNativeHelperDefinition, readNativeSelectionFromEnvironment } = adapter();
    process.stdout.write(JSON.stringify(renderNativeHelperDefinition('codex', process.argv[3], readNativeSelectionFromEnvironment()), null, 2) + '\n');
    return;
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { input = { tool_name: 'spawn_agent' }; }
  const output = await decide(input);
  if (output?.hookSpecificOutput?.permissionDecision === 'deny') return deny(output.hookSpecificOutput.permissionDecisionReason);
  // Codex accepts no bare permissionDecision:allow (it records an unsupported-output
  // hook failure and continues). An admitted request is exit 0 with empty output.
}
if (require.main === module) main().catch(() => deny(HELD));
module.exports = { main, decide, governed };
