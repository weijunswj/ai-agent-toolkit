#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for Bash and PowerShell: refuses a git commit or gh pr create/edit/merge that carries AI
// attribution (see toolkit-attribution-guard.cjs). Any other command, or input it cannot read, passes.
const fs = require('node:fs');

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
  catch { return 0; }
  const decision = require('./toolkit-attribution-guard.cjs').attributionDecision(input);
  if (decision.hookSpecificOutput) {
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.stderr.write(`${decision.hookSpecificOutput.permissionDecisionReason}\n`);
    return 2;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
