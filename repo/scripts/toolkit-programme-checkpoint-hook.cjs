#!/usr/bin/env node
'use strict';

// Turn-end (Stop) and after-tool (PostToolUse) hook for Claude Code and Codex.
// - Stop: a session the controller assigned to a gate and that ran `programme.cjs bind` gets its
//   checkpoint journal refreshed (see programme-checkpoint.cjs). Then a session that wrote to GitHub
//   this turn starts the programme refresh in the background (see programme-refresh-trigger.cjs).
// - PostToolUse: a GitHub write marks the session for that refresh. Nothing else runs.
// Every other session returns before any git, gh or network call. The hook never blocks or continues
// a turn: it always exits 0 and never prints to stdout (Codex reads Stop stdout as JSON). A failure is
// recorded locally, where the next checkpoint, `show --session` or the refresh last-run file report it.
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts');
const CHECKPOINT = path.join(SCRIPTS, 'programme-checkpoint.cjs');
const REFRESH = path.join(SCRIPTS, 'programme-refresh-trigger.cjs');

function main(deps = {}) {
  try {
    const raw = deps.stdin !== undefined ? deps.stdin : fs.readFileSync(0, 'utf8');
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object') return 0;
    if (input.hook_event_name === 'PostToolUse') {
      require(REFRESH).markWrite(input, deps);
      return 0;
    }
    if (input.hook_event_name !== undefined && input.hook_event_name !== 'Stop') return 0;
    try { require(CHECKPOINT).runHook(input, deps); } catch { /* the refresh below still runs */ }
    require(REFRESH).onStop(input, deps);
  } catch {
    // Unreadable input or a missing checkpoint module: nothing to record against, and nothing may block.
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
