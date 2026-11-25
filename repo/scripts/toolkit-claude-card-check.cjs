'use strict';

// Claude Code only: the question card check, run by the governance hook's PreToolUse step on
// AskUserQuestion (toolkit-governance-hook.cjs).
//
// The failure it prevents: the Claude desktop app and Remote Control show a turn's closing message in
// full, but cut text the agent wrote earlier in the same turn to one line, so with a card open the
// owner answers a question without the context written above it. A card is refused when:
//   - the current turn already holds visible assistant text: read from the session transcript
//     (`transcript_path`), back from its end to the last message that is not a tool result
//     (the owner's message, or anything the host injected), skipping subagent (sidechain) entries;
//   - or a question is longer than MAX_QUESTION characters (the card holds the question only).
// The refusal names the route (ROUTE): the context as the closing message, then the card first in the
// turn a short background command starts; the host writes that command's notification as a user
// entry, so it starts a new turn here. A command that ends inside the turn is written as an attachment
// instead and starts none. A card that is the turn's first visible output, or follows only tool calls,
// passes.
//
// Toolkit's own cards pass whatever came before them: the governance question and the exact merge
// card carry everything the owner needs in the card itself.
//
// Fail-open: a transcript path that cannot be read, or a turn longer than the read budget, lets the
// card through with one note, since a refused card leaves the owner unasked. Accepted gap: the host
// does not always write a turn's text to the transcript before the card's hook runs (a 23 Nov 2026
// probe found a text block missing from the transcript entirely), so a card can pass after text;
// the check never refuses a card for text it cannot see.

const fs = require('node:fs');

const MAX_QUESTION = 120;
const CHUNK = 256 * 1024;
const BUDGET = 8 * 1024 * 1024;

const ROUTE = 'Put the full context in this turn\'s closing message. Before you end the turn, start a short background command (about 20 seconds). When it wakes you, open that turn with the card and no text.';
const TEXT_FIRST = `Toolkit: this question card follows text you wrote earlier in this turn. The owner sees a turn's closing message in full, but text written before a card in the same turn is cut to one line. ${ROUTE}`;
const TOO_LONG = `Toolkit: a question on this card is longer than ${MAX_QUESTION} characters. The card holds only a short question, so shorten it. ${ROUTE}`;
const UNREAD = 'Toolkit could not read this session\'s transcript, so it could not check for text before this question card; the card was shown.';
const PARTIAL = 'Toolkit could not read this whole turn of the transcript, so it could not check all of it for text before this question card; the card was shown.';

const parse = line => { try { return JSON.parse(line); } catch { return null; } };

// Whether a transcript entry holds visible assistant text (a text block with more than spaces).
function visibleText(entry) {
  if (!entry || entry.type !== 'assistant' || entry.isApiErrorMessage) return false;
  const content = entry.message && entry.message.content;
  return Array.isArray(content) && content.some(block => block && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '');
}

// Whether a transcript entry starts the current turn: a main-thread user entry that carries no tool
// result (the owner's message, a compaction summary or anything the host injected). Counting every
// injected entry as a start can only shorten the turn read, so it never refuses a card wrongly.
function turnStart(entry) {
  if (!entry || entry.type !== 'user') return false;
  const content = entry.message && entry.message.content;
  return !(Array.isArray(content) && content.some(block => block && block.type === 'tool_result'));
}

// 'text' when the current turn holds visible text, 'clear' when it does not, 'partial' when the
// budget ran out first, or null when the transcript cannot be read. Reads back from the end in
// chunks, so a long transcript is not read whole on every card.
function turnText(file, { budget = BUDGET, chunk = CHUNK } = {}) {
  if (typeof file !== 'string' || file === '') return null;
  let handle;
  try { handle = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) return null;
    let position = stat.size;
    let rest = Buffer.alloc(0);
    let read = 0;
    while (position > 0) {
      if (read >= budget) return 'partial';
      const length = Math.min(chunk, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, position);
      read += length;
      let joined = Buffer.concat([buffer, rest]);
      // Until the file's start, the first line may be cut: keep it for the next chunk.
      let cut = 0;
      if (position > 0) {
        cut = joined.indexOf(0x0a);
        if (cut < 0) { rest = joined; continue; }
        rest = joined.subarray(0, cut);
        joined = joined.subarray(cut + 1);
      }
      const lines = joined.toString('utf8').split('\n');
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parse(lines[index]);
        if (!entry || entry.isSidechain) continue;
        if (visibleText(entry)) return 'text';
        if (turnStart(entry)) return 'clear';
      }
    }
    return 'clear';
  } catch { return null; } finally { try { fs.closeSync(handle); } catch { /* closed */ } }
}

// Whether the card is one Toolkit asks for itself: the governance question or the exact merge card.
function toolkitCard(toolInput, { pickerQuestion, mergeCardOf } = {}) {
  const questions = toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : [];
  if (pickerQuestion && questions.some(question => question && question.question === pickerQuestion)) return true;
  try { return Boolean(mergeCardOf && mergeCardOf(toolInput)); } catch { return false; }
}

// The decision for one AskUserQuestion call: { deny }, { note } or null.
function cardDecision(input, options = {}) {
  if (!input || input.tool_name !== 'AskUserQuestion') return null;
  const toolInput = input.tool_input;
  if (toolkitCard(toolInput, options)) return null;
  const questions = toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : [];
  if (questions.some(question => question && typeof question.question === 'string' && question.question.length > MAX_QUESTION)) return { deny: TOO_LONG };
  // Claude Code always sends a transcript path; a call without one (another host, a direct test
  // run) has nothing to read and gets no note.
  if (typeof input.transcript_path !== 'string' || input.transcript_path === '') return null;
  const found = turnText(input.transcript_path, options);
  if (found === 'text') return { deny: TEXT_FIRST };
  if (found === null) return { note: UNREAD };
  if (found === 'partial') return { note: PARTIAL };
  return null;
}

module.exports = Object.freeze({ MAX_QUESTION, TEXT_FIRST, TOO_LONG, UNREAD, PARTIAL, cardDecision, turnText, visibleText, turnStart });
