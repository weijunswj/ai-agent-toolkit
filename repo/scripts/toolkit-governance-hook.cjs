#!/usr/bin/env node
'use strict';

// Claude Code's governance hook: one script for four events, named by --event.
//   UserPromptSubmit  holds every prompt in an undecided repository (toolkit-governance-gate.cjs);
//                     in a github.com one the turn runs only to show the tap-to-answer card.
//   PreToolUse        refuses every tool there but the card, and agent answers everywhere.
//   PostToolUse       records the answer tapped on the card (AskUserQuestion).
//   SessionStart      adds one line stating the effective governance state, exports the session's
//                     id to its shell commands (CLAUDE_ENV_FILE), so a session an agent starts from
//                     one of them is known not to be the user typing, and records the run's session
//                     mark, so a later process that resumes the session cannot answer.
// The gate module loads inside the guarded path, so a missing or broken module still holds in a
// repository instead of crashing; hooks.json also sets onFailure: "block" for prompts and for the
// state-changing tools (STATE_CHANGING_TOOLS below).
//
// A cloud session (CLAUDE_CODE_REMOTE=true) is not enforced: its container has no lasting user
// registry, so an answer there would be lost, and a write into the clone would show up in the
// session's changes. The session line says so, and the rules text still applies there.

const fs = require('node:fs');

const EVENTS = Object.freeze(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart']);

function readInput(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

const CLOUD_LINE = 'Toolkit governance: not enforced in cloud sessions (no lasting decision store here). Follow the global rules; the controller resolves the repository\'s state before launching cloud gate work.';

function cloudSession(environment) { return Boolean(environment) && environment.CLAUDE_CODE_REMOTE === 'true'; }

// Appends `export TOOLKIT_HOST_SESSION=<id>` to the file Claude Code runs before each shell command of
// this session (the last line wins after /clear). Optional: any failure is ignored.
function exportHostSession(input, environment, gate) {
  const file = environment && environment.CLAUDE_ENV_FILE;
  const id = input && input.session_id;
  if (typeof file !== 'string' || file === '' || typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return false;
  if (!gate || typeof gate.HOST_SESSION_VARIABLE !== 'string') return false;
  try { fs.appendFileSync(file, `export ${gate.HOST_SESSION_VARIABLE}=${id}\n`); return true; } catch { return false; }
}

// The hook's stdout for one event. Never throws.
function respond(event, input, options = {}) {
  if (cloudSession(options.environment || process.env)) {
    if (event !== 'SessionStart') return {};
    let inside = false;
    try { inside = (options.gate || require('./toolkit-governance-gate.cjs')).insideRepository(input.cwd); } catch { inside = false; }
    return inside ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: CLOUD_LINE } } : {};
  }
  let gate;
  try {
    gate = options.gate || require('./toolkit-governance-gate.cjs');
    if (event === 'UserPromptSubmit') {
      const decision = new gate.PromptHold({ ...options, picker: true }).decide({ cwd: input.cwd, prompt: input.prompt, sessionId: gate.sessionIdOf(input) });
      if (decision.action === 'block') return { decision: 'block', reason: decision.reason };
      const context = decision.context ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: decision.context } } : {};
      return decision.notice ? { systemMessage: decision.notice, ...context } : context;
    }
    if (event === 'PreToolUse') {
      const decision = new gate.ToolGate(options).decide(input);
      return decision ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.deny } } : {};
    }
    if (event === 'PostToolUse') {
      if (input.tool_name !== 'AskUserQuestion') return {};
      const picked = new gate.PromptHold(options).picked({ cwd: input.cwd, sessionId: gate.sessionIdOf(input), toolUseId: input.tool_use_id, toolResponse: input.tool_response });
      return picked ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: picked.context } } : {};
    }
    exportHostSession(input, options.environment || process.env, gate);
    gate.startSession(input, options);
    const line = gate.sessionLine(input.cwd, { ...options, sessionId: gate.sessionIdOf(input) });
    return line ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line } } : {};
  } catch {
    return failed(event, input, gate);
  }
}

// The gate's never-act line, spelled out here because the gate module may be what failed to load.
const NEVER_OWNER = 'Never act as the user: do not answer the governance question yourself, start a session or script to answer it, or click a confirmation through a UI or computer use.';

// The tools that change something. A failed check holds them inside a repository; every other tool
// (read-only ones, and the card, whose answer then counts for nothing without the tool gate's note)
// is let through, as it was before the hook saw it. hooks.json matches the same split, with
// onFailure: "block" only on this list, so a hook that cannot even start holds only these too.
const STATE_CHANGING_TOOLS = /^(?:Bash|PowerShell|Monitor|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|mcp__.*)$/;

function failed(event, input, gate) {
  // A failed PostToolUse records nothing, which leaves the repository waiting.
  if (event === 'SessionStart' || event === 'PostToolUse') return {};
  if (event === 'PreToolUse' && !STATE_CHANGING_TOOLS.test(String(input && input.tool_name || ''))) return {};
  let inside = true;
  try { inside = (gate || require('./toolkit-governance-gate.cjs')).insideRepository(input.cwd); } catch { inside = true; }
  if (!inside) return {};
  if (event === 'UserPromptSubmit') return { decision: 'block', reason: `Toolkit: the governance check failed, so your message was held and not sent. If this keeps happening, open Claude Code in a folder outside any git repository and say \`setup toolkit\` to repair the installed hooks. ${NEVER_OWNER}` };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Toolkit: the governance check failed, so nothing runs in this repository until it works again. ${NEVER_OWNER}` } };
}

function main(argv = process.argv.slice(2), stdin = () => fs.readFileSync(0, 'utf8')) {
  const index = argv.indexOf('--event');
  const event = index >= 0 ? argv[index + 1] : null;
  let input = {};
  try { input = readInput(stdin()); } catch { input = {}; }
  // An unknown event name is a broken install: hold as a prompt would be held.
  const output = EVENTS.includes(event) ? respond(event, input) : failed('UserPromptSubmit', input, null);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ EVENTS, CLOUD_LINE, NEVER_OWNER, STATE_CHANGING_TOOLS, exportHostSession, respond, main });
