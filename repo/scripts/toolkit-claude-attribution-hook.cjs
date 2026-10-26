#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for Bash and PowerShell: refuses a git commit or gh pr create/edit/merge that carries AI
// attribution, a command that skips a governed or guarded repository's commit and push checks, a force push, and a
// push or new pull request whose changes carry a credential or a plain-text finding (see toolkit-attribution-guard.cjs).
// Any other command, or input it cannot read, passes.
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
  try { decision = guard().attributionDecision(input, { notes }); }
  catch {
    const command = input?.tool_input?.command;
    return typeof command === 'string' && mayCarryAttribution(command) ? refuse(CHECK_FAILED_REASON) : 0;
  }
  if (decision?.hookSpecificOutput) {
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
