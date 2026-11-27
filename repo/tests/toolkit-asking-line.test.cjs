'use strict';

// The desktop asking line once had the agent open a question card on a later turn, started by a
// background wait; the 27 Nov 2026 retest showed agents skipping it, and the owner decided how a question
// shows (card, end-of-turn box or text) is the app's choice (INT-TK421-1389). The line keeps only what
// avoids lost context: the context, options and pick go in the closing message.
const assert = require('node:assert/strict');
const test = require('node:test');
const { ASKING_LINE, respond } = require('../scripts/toolkit-governance-hook.cjs');

test('the asking line keeps the context in the closing message and leaves the question\'s form to the app', () => {
  assert.match(ASKING_LINE, /1\. Put the full context, options and your pick in your closing message and end the turn\./);
  assert.match(ASKING_LINE, /2\. Leave how the question shows \(a card, the end-of-turn box or plain text\) to the app\./);
  assert.match(ASKING_LINE, /Toolkit's exact merge card keeps its own text\.$/);
  // No step steers a card: no wait to start, no next-turn card, no card shape.
  assert.doesNotMatch(ASKING_LINE, /background|automatic turn|next turn|question card|open the card|open a card|card holds/);
});

test('the desktop session start carries the line, and other entry points get no asking line', () => {
  const start = environment => respond('SessionStart', { cwd: require('node:os').tmpdir(), session_id: 's1', source: 'startup' }, {
    environment, refreshBinding: () => {},
    gate: { SESSION_TEXT_LIMIT: 10000, startSession() {}, sessionIdOf: input => input.session_id, sessionLine: () => '' },
    repoCatchUp: { catchUp: () => null },
  }).hookSpecificOutput?.additionalContext || '';
  assert.equal(start({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), ASKING_LINE);
  assert.equal(start({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), '');
});
