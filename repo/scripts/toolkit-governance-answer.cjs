#!/usr/bin/env node
'use strict';

// Records the user's answer to Toolkit's governance question after the agent read what their reply
// means (owner decision of 28 Oct). Usage: node toolkit-governance-answer.cjs <yes|no|later> <ticket>
//
// The ticket comes from the governance hook, which gives one only when the user's own message
// arrived in the run of the session that was shown the question; it names the repositories asked
// about, works once and lapses after half an hour. This script records nothing without a live
// ticket, prints what it recorded (or why not) for the agent to tell the user, and exits 0 only
// when the answer was recorded.

const gate = require('./toolkit-governance-gate.cjs');

function main(argv) {
  const [word, ticket, ...rest] = argv;
  if (rest.length > 0 || typeof word !== 'string' || typeof ticket !== 'string') {
    process.stderr.write('Usage: node toolkit-governance-answer.cjs <yes|no|later> <ticket>\n');
    return 2;
  }
  let result;
  try { result = new gate.PromptHold().answerTicket(ticket, word.toLowerCase()); } catch {
    result = { ok: false, text: 'Toolkit: the answer could not be recorded, so nothing changed. Ask the user the governance question again.' };
  }
  process.stdout.write(`${result.text}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ main });
