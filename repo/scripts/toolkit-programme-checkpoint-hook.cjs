#!/usr/bin/env node
'use strict';

// Turn-end (Stop) hook for Claude Code and Codex. A session the controller assigned to a gate and that
// ran `programme.cjs bind` gets its checkpoint journal refreshed here (see programme-checkpoint.cjs).
// Every other session returns before any git, gh or network call. The hook never blocks or continues
// a turn: it always exits 0 and never prints to stdout (Codex reads Stop stdout as JSON). A failure is
// recorded in the session's local errors file, where the next checkpoint and `show --session` report it.
const fs = require('node:fs');
const path = require('node:path');

const CHECKPOINT = path.join(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts', 'programme-checkpoint.cjs');

function main(deps = {}) {
  try {
    const raw = deps.stdin !== undefined ? deps.stdin : fs.readFileSync(0, 'utf8');
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object' || (input.hook_event_name !== undefined && input.hook_event_name !== 'Stop')) return 0;
    require(CHECKPOINT).runHook(input, deps);
  } catch {
    // Unreadable input or a missing checkpoint module: nothing to record against, and nothing may block.
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
