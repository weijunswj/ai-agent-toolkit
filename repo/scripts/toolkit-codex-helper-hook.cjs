#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The decision modules load inside the guarded path, so a missing or broken module
// denies with the blocking exit status instead of crashing as a non-blocking failure.
const adapter = () => require('./toolkit-v3-native-helper-adapter.cjs');

// Enforcement applies where Toolkit V3 governs helper routing: a launcher-pinned
// binding, or a Toolkit source checkout that carries the V3 registry. Elsewhere the
// hook makes no decision, so repositories that have not adopted V3 keep their
// existing native behaviour.
function governed(input, environment = process.env) {
  if (environment.TOOLKIT_NATIVE_HELPER_BINDING) return true;
  let current = path.resolve(typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v3.json'))
      && fs.existsSync(path.join(current, 'repo', 'docs', 'TOOLKIT-V3.md'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
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
