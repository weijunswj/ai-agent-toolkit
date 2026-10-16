#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { commandDecision, renderNativeHelperDefinition, readNativeSelectionFromEnvironment } = require('./toolkit-v3-native-helper-adapter.cjs');

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

async function decide(input, environment = process.env) {
  if (!['spawn_agent', 'Agent'].includes(input?.tool_name)) return {};
  if (!governed(input, environment)) return {};
  return commandDecision(input, 'codex', {
    binding_path: environment.TOOLKIT_NATIVE_HELPER_BINDING,
    binding_sha256: environment.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
    helper_identity: environment.TOOLKIT_NATIVE_HELPER_IDENTITY
  });
}

async function main() {
  if (process.argv[2] === '--print-helper-definition') {
    process.stdout.write(JSON.stringify(renderNativeHelperDefinition('codex', process.argv[3], readNativeSelectionFromEnvironment()), null, 2) + '\n');
    return;
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { input = { tool_name: 'spawn_agent' }; }
  const output = await decide(input);
  process.stdout.write(JSON.stringify(output) + '\n');
  const denied = output?.hookSpecificOutput?.permissionDecision === 'deny';
  if (denied) {
    // Blocking exit status, with the reason on stderr, for hosts that honour exit 2.
    process.stderr.write(`${output.hookSpecificOutput.permissionDecisionReason}\n`);
    process.exitCode = 2;
  }
}
if (require.main === module) main().catch(() => { process.stderr.write('Toolkit helper guard failed\n'); process.exitCode = 2; });
module.exports = { main, decide, governed };
