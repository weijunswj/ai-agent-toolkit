'use strict';

// The question card check (toolkit-claude-card-check.cjs): its transcript reader across chunk edges,
// its read budget, its fail-open answers and the Toolkit cards it leaves alone. The hook pack's CARD
// rows prove the same decisions through the real governance hook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const card = require('../scripts/toolkit-claude-card-check.cjs');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-card-check-'));
test.after(() => fs.rmSync(folder, { recursive: true, force: true }));
let count = 0;
function transcript(entries, tail = '\n') {
  const file = path.join(folder, `t${count += 1}.jsonl`);
  fs.writeFileSync(file, entries.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + tail);
  return file;
}
const owner = text => ({ type: 'user', message: { role: 'user', content: text } });
const said = text => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (id, name = 'Bash') => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = id => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(600) }] } });
const question = (text = 'Which fix first?') => ({ questions: [{ question: text, header: 'Fix', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] });
const decide = (file, toolInput = question(), options = {}) => card.cardDecision({ tool_name: 'AskUserQuestion', transcript_path: file, tool_input: toolInput }, options);

test('text earlier in the turn refuses the card, across chunk edges and multibyte text', () => {
  // A long turn of tool calls after the text, read in 64-byte chunks so lines split across them.
  const file = transcript([owner('check it'), said('Résumé of the failure: two tests — both in the reader.'), ...Array.from({ length: 30 }, (_, i) => [tool(`t${i}`), result(`t${i}`)]).flat(), tool('card', 'AskUserQuestion')]);
  assert.equal(card.turnText(file, { chunk: 64 }), 'text');
  assert.deepEqual(decide(file, question(), { chunk: 64 }), { deny: card.TEXT_FIRST });
});

test('a card first in the turn, after tool calls only, or after a turn boundary is shown', () => {
  assert.equal(decide(transcript([said('old turn'), owner('go'), tool('card', 'AskUserQuestion')])), null);
  assert.equal(decide(transcript([owner('go'), tool('a'), result('a'), tool('card', 'AskUserQuestion')]), question(), { chunk: 64 }), null);
  // A host-injected entry (no tool result) also starts the turn: that only ever shortens the read.
  assert.equal(decide(transcript([owner('go'), said('seen'), { type: 'user', isMeta: true, message: { role: 'user', content: '<relay>next</relay>' } }, tool('card', 'AskUserQuestion')])), null);
  // Whitespace-only text, sidechain text, an API error line and a half-written last line are not visible text.
  assert.equal(decide(transcript([owner('go'), said('   '), { ...said('subagent'), isSidechain: true }, { ...said('API Error'), isApiErrorMessage: true }, tool('card', 'AskUserQuestion'), '{"type":"assistant","message":{"content":[{"type":"text","text":"cut'], '')), null);
  // The whole file read with no boundary and no text: the very first entries are this turn.
  assert.equal(decide(transcript([tool('a'), result('a')]), question(), { chunk: 64 }), null);
});

test('an over-long question is refused before the transcript is read', () => {
  const long = 'q'.repeat(card.MAX_QUESTION + 1);
  assert.deepEqual(decide(path.join(folder, 'missing.jsonl'), question(long)), { deny: card.TOO_LONG });
  assert.equal(decide(transcript([owner('go')]), question('q'.repeat(card.MAX_QUESTION))), null);
});

test('a missing transcript or a turn past the read budget shows the card with a note', () => {
  assert.deepEqual(decide(path.join(folder, 'missing.jsonl')), { note: card.UNREAD });
  assert.equal(decide(undefined), null, 'no path given: nothing to read, no note');
  assert.deepEqual(decide(folder), { note: card.UNREAD });
  const long = transcript([owner('go'), ...Array.from({ length: 40 }, (_, i) => [tool(`t${i}`), result(`t${i}`)]).flat()]);
  assert.deepEqual(decide(long, question(), { chunk: 256, budget: 1024 }), { note: card.PARTIAL });
});

test('Toolkit\'s own cards and other tools are left alone', () => {
  const file = transcript([owner('go'), said('context'), tool('card', 'AskUserQuestion')]);
  const picker = { questions: [{ question: 'Turn it on?', header: 'Governance', options: [] }] };
  assert.equal(decide(file, picker, { pickerQuestion: 'Turn it on?' }), null);
  assert.equal(decide(file, question('Merge it?'), { mergeCardOf: input => input.questions[0].question === 'Merge it?' }), null);
  assert.deepEqual(decide(file, question(), { mergeCardOf: () => { throw new Error('broken reader'); } }), { deny: card.TEXT_FIRST });
  assert.equal(card.cardDecision({ tool_name: 'Bash', transcript_path: file, tool_input: { command: 'ls' } }), null);
});
