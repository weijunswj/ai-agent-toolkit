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

// Governance (#542 M3): the same script is Codex's UserPromptSubmit hook, so it shares the helper
// hook's installed Windows launcher. In an undecided repository every prompt is held and every
// state-changing tool refused (toolkit-governance-gate.cjs); everywhere, an agent may not answer the
// governance question for the user. The gate loads inside the guarded path like the adapter.
const gate = () => require('./toolkit-governance-gate.cjs');
// Inside a git repository? Used after a failure, so it must work without the gate module: a missing
// module still holds inside a repository (fail closed) and makes no decision elsewhere.
function insideRepository(cwd) {
  try { return gate().insideRepository(cwd); } catch { /* the plain walk below */ }
  try {
    let current = require('node:path').resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd());
    for (;;) {
      if (fs.existsSync(require('node:path').join(current, '.git'))) return true;
      const parent = require('node:path').dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  } catch { return true; }
}
function promptEvent(input) {
  return input?.hook_event_name === 'UserPromptSubmit' || (typeof input?.prompt === 'string' && !input?.tool_name);
}

// Native hook names: `spawn_agent` (default and multi_agent_v1 namespaces), the
// `Agent` alias, and the flattened MultiAgentV2 name `<namespace>spawn_agent` for any
// host-valid namespace, hyphenated ones included (`collaborationspawn_agent`, `multi-agentspawn_agent`).
async function decide(input, environment = process.env) {
  let governanceDenial;
  try { governanceDenial = new (gate().ToolGate)().decide(input || {}); } catch {
    governanceDenial = insideRepository(input?.cwd) ? { deny: 'Toolkit: the governance check failed, so nothing runs in this repository until it works again.' } : null;
  }
  if (governanceDenial) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: governanceDenial.deny } };
  // Shell commands: refuse AI attribution in commits and pull requests, in every folder.
  if (input?.tool_name === 'Bash') return require('./toolkit-attribution-guard.cjs').attributionDecision(input);
  if (!governed(input, environment)) return {};
  const { CodexDialect, commandDecision } = adapter();
  if (!CodexDialect.isSpawnRequest(input?.tool_name)) return {};
  return commandDecision(input, 'codex', {
    binding_path: environment.TOOLKIT_NATIVE_HELPER_BINDING,
    binding_sha256: environment.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
    helper_identity: environment.TOOLKIT_NATIVE_HELPER_IDENTITY
  });
}

// The UserPromptSubmit decision: { block: reason } or { context } or {}.
function decidePrompt(input, environment = process.env) {
  const decision = new (gate().PromptHold)({ environment }).decide({ cwd: input?.cwd, prompt: input?.prompt });
  if (decision.action === 'block') return { block: decision.reason };
  return decision.context ? { context: decision.context } : {};
}

const PROMPT_FAILED = 'Toolkit: the governance check failed, so your message was held and not sent. Run `setup toolkit` in Codex to repair the installed hook if this keeps happening.';
function holdPrompt(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}
// After a failure, a prompt is held inside a git repository (or when that cannot be told) only.
function promptFailure(input) {
  if (insideRepository(input?.cwd)) holdPrompt(PROMPT_FAILED);
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
  if (promptEvent(input)) {
    let output;
    try { output = decidePrompt(input); } catch { return promptFailure(input); }
    if (output.block) return holdPrompt(output.block);
    if (output.context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: output.context } }) + '\n');
    return;
  }
  const output = await decide(input);
  if (output?.hookSpecificOutput?.permissionDecision === 'deny') return deny(output.hookSpecificOutput.permissionDecisionReason);
  // Codex accepts no bare permissionDecision:allow (it records an unsupported-output
  // hook failure and continues). An admitted request is exit 0 with empty output.
}
if (require.main === module) main().catch(() => deny(HELD));
module.exports = { main, decide, decidePrompt, governed, promptEvent };
