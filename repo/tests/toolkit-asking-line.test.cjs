'use strict';

// Red on the parent (the 27 Nov owner test): the desktop asking line said a three-choice question uses
// the card "on your next turn", but nothing gives a chat its next turn, so the agent ended the turn with
// the context and no card ever came. The line now has the agent start one short background wait right
// before it ends the turn, then open the card first, with no text, on the automatic turn the wait brings.
const assert = require('node:assert/strict');
const test = require('node:test');
const { ASKING_LINE, respond } = require('../scripts/toolkit-governance-hook.cjs');

test('the asking line starts a background wait before the turn ends and opens the card first on the automatic turn', () => {
  const [, step] = /\b3\. (.*?) 4\. /.exec(ASKING_LINE) || [];
  assert.ok(step, ASKING_LINE);
  assert.match(step, /three or more choices uses the question card/);
  assert.match(step, /right before you end the turn with the closing message, start one short background wait \(a background command of about 30 seconds\)/);
  assert.match(step, /on the automatic turn it brings open the card first, with no text before it\./);
  assert.doesNotMatch(ASKING_LINE, /on your next turn/, 'no promise of a turn that nothing starts');
  // The rest of the line stands: context in the closing message, never context and card in one turn.
  assert.match(ASKING_LINE, /1\. Put the full context, options and your pick in your closing message and end the turn\./);
  assert.match(ASKING_LINE, /5\. Never write the context and open a card in the same turn: the app cuts it short\./);
});

test('the desktop session start carries the wait step, and other entry points get no asking line', () => {
  const start = environment => respond('SessionStart', { cwd: require('node:os').tmpdir(), session_id: 's1', source: 'startup' }, {
    environment, refreshBinding: () => {},
    gate: { SESSION_TEXT_LIMIT: 10000, startSession() {}, sessionIdOf: input => input.session_id, sessionLine: () => '' },
    repoCatchUp: { catchUp: () => null },
  }).hookSpecificOutput?.additionalContext || '';
  assert.equal(start({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), ASKING_LINE);
  assert.equal(start({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), '');
});
