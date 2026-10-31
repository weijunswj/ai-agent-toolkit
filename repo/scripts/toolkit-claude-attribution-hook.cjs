#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for Bash and PowerShell: refuses a git commit or gh pr create/edit/merge that carries AI
// attribution, a force push in a governed or guarded repository or to an evidence store, and a push or new pull
// request whose changes carry a credential (see toolkit-attribution-guard.cjs).
// A shell call whose shape it cannot read is refused when its raw input could commit, push or touch a
// pull request (toolkit-shell-call.cjs). Any other command, or hook input that is not JSON, passes.
//
// If the check itself fails (the guard module is missing or throws), only commands the guard would have
// looked at for attribution are refused, with a plain reason; every other command still runs. The hook is
// registered without `onFailure: "block"` on purpose: that would stop every shell command whenever the
// hook process could not start.
const fs = require('node:fs');

const CHECK_FAILED_REASON = 'Toolkit could not check this commit or pull request command for AI attribution lines. Retry it; if this repeats, run `setup toolkit` to repair the Toolkit plugin.';

// A deliberately broad screen, independent of the guard module: `git ... commit` or `gh pr create|edit|merge`.
function mayCarryAttribution(command) {
  return /\bgit\b[\s\S]*\bcommit\b/.test(command) || /\bgh\s+pr\s+(?:create|edit|merge)\b/.test(command);
}

// The command text as the guard reads it (toolkit-shell-call.cjs), or the raw tool input when there
// is none or that module cannot load either, so the screen above still sees the words.
function commandText(input) {
  let text = '';
  try { text = require('./toolkit-shell-call.cjs').ShellCall.from(input, { shell: true }).text; } catch { /* the raw input below */ }
  if (text) return text;
  try { return JSON.stringify(input?.tool_input ?? '') || ''; } catch { return ''; }
}

function refuse(reason) {
  const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.stderr.write(`${reason}\n`);
  return 2;
}

function main(guard = () => require('./toolkit-attribution-guard.cjs')) {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
  catch { return 0; }
  let decision;
  const notes = [];
  try { decision = guard().attributionDecision(input, { notes, host: 'claude' }); }
  catch { return mayCarryAttribution(commandText(input)) ? refuse(CHECK_FAILED_REASON) : 0; }
  if (decision?.hookSpecificOutput) {
    // Notes from a step that could not run go with the refusal, so they are not lost.
    if (notes.length) decision.hookSpecificOutput.permissionDecisionReason += `\n${notes.join('\n')}`;
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.stderr.write(`${decision.hookSpecificOutput.permissionDecisionReason}\n`);
    return 2;
  }
  // A push the check could not read still runs; Claude Code shows `systemMessage` to the user.
  if (notes.length) {
    process.stdout.write(`${JSON.stringify({ systemMessage: notes.join('\n') })}\n`);
    process.stderr.write(`${notes.join('\n')}\n`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, mayCarryAttribution, CHECK_FAILED_REASON };
