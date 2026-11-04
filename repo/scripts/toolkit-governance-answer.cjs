#!/usr/bin/env node
'use strict';

// Accepts the user's answer as a pending proposal request, or a same-run deferral, after the agent
// reads their reply. Usage: node toolkit-governance-answer.cjs <yes|no|later> <ticket>
// When the agent is unsure, `confirm-yes`, `confirm-no` or `confirm-later` sets up a confirmation;
// the user's reply then comes with a ticket restricted to that answer. It grants no governance.
//
// The ticket comes from the governance hook, which gives one only when the user's own message
// arrived in the run of the session that was shown the question; it names the one folder asked
// about, works once and lapses after half an hour. Without a live ticket it saves nothing.
// It prints the pending request, deferral or confirmation (or why it failed), and exits 0 only
// when that operation succeeded. Yes and no require a proposal and merge; later lasts this run.
// Outside github.com governance is off automatically. Direct Projects
// replies must be eligible, fresh and unused; launched sessions never receive or spend a ticket.

const gate = require('./toolkit-governance-gate.cjs');

function main(argv) {
  const [word, ticket, ...rest] = argv;
  if (rest.length > 0 || typeof word !== 'string' || typeof ticket !== 'string') {
    process.stderr.write('Usage: node toolkit-governance-answer.cjs <yes|no|later|confirm-yes|confirm-no|confirm-later> <ticket>\n');
    process.stderr.write('Use only the ticket from the owner\'s reply after Toolkit asked about one named GitHub repository. Yes and no request a proposal; only its merge decides governance.\n');
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
