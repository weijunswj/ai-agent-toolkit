#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

// The decision modules load inside the guarded path, so a missing or broken module
// denies with the blocking exit status instead of crashing as a non-blocking failure.
const adapter = () => require('./toolkit-v3-native-helper-adapter.cjs');

// Enforcement applies in Toolkit-governed work: a repository whose governance state is ENABLED
// with the governed rules in force, or a session a Toolkit launcher started (launcher marker),
// the same predicate the Claude hook uses. Elsewhere the hook makes no
// decision. Helper depth on Codex stays instruction-level: PreToolUse carries no caller-agent identity.
const LAUNCHER_MARKERS = ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256'];
function governance(input, environment = process.env) {
  try { return require('./toolkit-governed-repo.cjs').governedRepo(input?.cwd, environment); }
  // Without the predicate, gate only when a launcher marker says this is governed work.
  catch { return { governed: LAUNCHER_MARKERS.some(name => Boolean(environment[name])), root: null, gate_role: environment.TOOLKIT_GATE_ROLE || null }; }
}
function governed(input, environment = process.env) { return governance(input, environment).governed; }

// Governance: the same script is Codex's UserPromptSubmit hook, so it shares the helper
// hook's installed Windows launcher. In an undecided repository every prompt is held and every
// state-changing tool refused (toolkit-governance-gate.cjs); everywhere, an agent may not answer the
// governance question for the user. The gate loads inside the guarded path like the adapter.
const gate = () => require('./toolkit-governance-gate.cjs');
// The gate's never-act line, spelled out here because the gate module may be what failed to load.
const NEVER_OWNER = 'Never act as the user: do not answer the governance question yourself, start a session or script to answer it, or click a confirmation through a UI or computer use.';
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

// Native hook names: `spawn_agent` (V1 `multi_agent` and the default namespace), the `Agent`
// alias, and the flattened V2 `multi_agent_v2` name `<namespace>spawn_agent` for any host-valid
// namespace, hyphenated ones included (`collaborationspawn_agent`, `multi-agentspawn_agent`).
// `notes` collects what a shell check could not check, for the caller to show the user.
async function decide(input, environment = process.env, { notes } = {}) {
  let governanceDenial;
  try { governanceDenial = new (gate().ToolGate)().decide(input || {}); } catch {
    governanceDenial = insideRepository(input?.cwd) ? { deny: `Toolkit: the governance check failed, so nothing runs in this repository until it works again. ${NEVER_OWNER}` } : null;
  }
  if (governanceDenial) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: governanceDenial.deny } };
  // Merges: the merge hold, a tripwire that waits for the user's own "merge N" (toolkit-merge-hold.cjs), in every folder.
  const mergeDenial = mergeDecision(input);
  if (mergeDenial) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: mergeDenial.deny } };
  // Shell commands, under any of the shell tool names Codex may report: refuse AI attribution in
  // commits and pull requests, skipped checks, force pushes and pushes that carry a credential.
  // Codex's top-level cwd is the chat's folder, which may not be where a call with no workdir runs.
  if (require('./toolkit-shell-call.cjs').ShellCall.isShellTool(input?.tool_name)) return require('./toolkit-attribution-guard.cjs').attributionDecision(input, { notes, sessionFolderOnly: true });
  const state = governance(input, environment);
  if (!state.governed) return {};
  const { CodexDialect, commandDecision } = adapter();
  if (!CodexDialect.isSpawnRequest(input?.tool_name)) return {};
  // A launcher that bound this session to a helper route checks the launch against that binding.
  if (environment.TOOLKIT_NATIVE_HELPER_BINDING) return commandDecision(input, 'codex', {
    binding_path: environment.TOOLKIT_NATIVE_HELPER_BINDING,
    binding_sha256: environment.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
    helper_identity: environment.TOOLKIT_NATIVE_HELPER_IDENTITY
  });
  // Otherwise only the Toolkit's own helpers, with the agent files setup installs, may launch.
  const { CodexNamedHelperPolicy } = require('./toolkit-codex-helper-policy.cjs');
  return new CodexNamedHelperPolicy({ environment }).decide(input, state);
}

// The merge hold's decision, failing closed for a call that may merge when the module cannot run.
function mergeDecision(input) {
  try { return require('./toolkit-merge-hold.cjs').decide(input || {}); } catch {
    let mayMerge = true;
    try { mayMerge = require('./toolkit-merge-hold.cjs').mayMerge(input || {}); } catch { mayMerge = /merge|push/i.test(JSON.stringify(input || {})); }
    return mayMerge ? { deny: 'Toolkit: the merge check failed, so this merge or push is refused. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.' } : null;
  }
}

// The UserPromptSubmit decision: { block: reason } or { context } or {}.
function decidePrompt(input, environment = process.env) {
  const decision = new (gate().PromptHold)({ environment }).decide({ cwd: input?.cwd, prompt: input?.prompt, sessionId: gate().sessionIdOf(input) });
  if (decision.action === 'block') return { block: decision.reason };
  // A "merge N" the user types is kept for the merge hold, but not while the governance question holds
  // the message: the user types it again after answering. A failure only means a later merge is refused.
  try { require('./toolkit-merge-hold.cjs').recordPrompt(input || {}, { environment }); } catch { /* fail closed later */ }
  return decision.context ? { context: decision.context } : {};
}

const PROMPT_FAILED = `Toolkit: the governance check failed, so your message was held and not sent. If this keeps happening, open Codex in a folder outside any git repository and say \`setup toolkit\` to repair the installed hooks. ${NEVER_OWNER}`;
function holdPrompt(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}
// After a failure, a prompt is held inside a git repository (or when that cannot be told) only.
function promptFailure(input) {
  if (insideRepository(input?.cwd)) holdPrompt(PROMPT_FAILED);
}

const HELD = `Toolkit helper guard failed. ${NEVER_OWNER}`;
// The way through depends on the cause the note names; a cause that stays the same refuses every retry.
const UNCHECKED_PUSH = [
  'Codex does not show Toolkit\'s warnings, so this push or pull request is refused instead of going out unchecked.',
  'Fix what the note above names, then retry: for a check that took too long or read too much, push fewer new commits at a time (an older commit first, for example `git push origin <older commit>:<branch>`); with no base branch found, run `git fetch origin` or name `--base`; for an unreadable setting, fix the file it names; when git was not found or could not run, run `setup toolkit`.',
].join('\n');
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
  const notes = [];
  const output = await decide(input, process.env, { notes });
  // Notes from a check that could not run go with the refusal, so they are not lost.
  if (output?.hookSpecificOutput?.permissionDecision === 'deny') return deny([output.hookSpecificOutput.permissionDecisionReason, ...notes].join('\n'));
  // A push or new pull request the push check could not check is refused here, not let through with
  // a warning: Codex showed neither the agent nor its session record a hook's systemMessage
  // (captured 29 October 2026), so the user would never see that it ran unchecked.
  if (notes.length) return deny([...notes.map(note => note.replace(', so it was let through', '')), UNCHECKED_PUSH].join('\n'));
  // Codex accepts no bare permissionDecision:allow (it records an unsupported-output
  // hook failure and continues). An admitted request is exit 0 with empty output.
}
if (require.main === module) main().catch(() => deny(HELD));
module.exports = { main, decide, decidePrompt, governed, promptEvent, NEVER_OWNER, PROMPT_FAILED };
