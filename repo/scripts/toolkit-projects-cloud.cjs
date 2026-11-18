'use strict';

// Claude Projects inputs the merge hold reads in a cloud thread, from the host's own text:
//
//   Merge card tap   A Projects decision card the merge thread posts with the exact question
//                    `Merge owner/name#N at <full 40 character head SHA>?` and first option `Merge`.
//                    The host wakes the thread with reason "decision-chosen": one trigger message
//                    from a human principal, whose text the host writes as
//                    `Chose "Merge" on the decision card asking "<question>"`, followed by system
//                    notes naming the card (decision_id), the option (option_index=0) and the member
//                    who tapped (actor_account_id, the same as the message's author-id). Only that
//                    whole shape counts, for that pull request at that SHA, once (the decision id
//                    is the delivery id the approval store keeps a receipt for).
//   Off override    The project line `- Task auto-merge: Off` in the owner's project instructions,
//                    read at merge time from the host's opening record of the thread's session
//                    transcript: its first user entry, marked meta (isMeta), of this session, whose
//                    text starts with `<session-context nonce="X">` ... `</session-context nonce="X">`
//                    (the hook never sees that record as a submitted prompt). Inside it, as one
//                    `<project-instructions nonce="Y">` ... `</project-instructions nonce="Y">`
//                    block. The repository's merged switch (task_prs.auto_merge) is the only grant;
//                    this line can only force it Off. Only that block counts: the shared-file,
//                    repository and folder lists beside it, and anything after the context (a
//                    relay, a citation, a note), are never read. No line defers to the binding; an
//                    On line grants nothing; an Off line, two lines, a second instructions opener or
//                    an unclosed block force Off. The record is written when the thread starts: a
//                    later change reaches only threads started after it, and a session whose
//                    transcript is missing or unreadable is forced Off.
//
// Tripwire, not a lock: a fully forged top-level wake, or an edited session transcript, with the
// right shape would count, as for the typed `merge N` the Projects wake reader already accepts.
// Required CI and the repository's own rules stay the hard limit.

const transcriptHead = require('./toolkit-transcript-head.cjs');

const MAX_PROMPT = 512 * 1024;

const ATTRIBUTES = '((?:\\s+[\\w-]+="[^"<>]*")*)';
const TAP_WAKE = new RegExp(`^\\s*<wake${ATTRIBUTES}\\s*>\\s*<project${ATTRIBUTES}\\s*>\\s*<thread${ATTRIBUTES}\\s*>\\s*<message${ATTRIBUTES}\\s*>([^<]*)</message>\\s*</thread>\\s*</project>((?:\\s*<system-note>[^<]*</system-note>)*)\\s*</wake>\\s*$`);
const TAP_TEXT = /^Chose "Merge" on the decision card asking "Merge ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d{0,6}) at ([0-9a-f]{40})\?"$/;
const ID = /^[A-Za-z0-9_.:-]{1,256}$/;

function attributes(text) {
  const names = [...text.matchAll(/([\w-]+)="/g)].map(match => match[1]);
  if (new Set(names).size !== names.length) return null;
  return Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

// Decodes the few entities the host writes in message text. Anything else stays as written, so it
// never matches the exact tap text.
function decoded(text) {
  return text.replace(/&(#34|#39|quot|apos|amp);/g, (entity, name) => ({ '#34': '"', '#39': "'", quot: '"', apos: "'", amp: '&' })[name]);
}

// The question a merge card must carry, for the thread that posts it.
function mergeCardQuestion(repository, pr, sha) { return `Merge ${repository}#${pr} at ${String(sha).toLowerCase()}?`; }

// { repository, pr, sha, id, sentAt } for a well-formed merge card tap, else null.
function mergeCardTap(prompt) {
  const text = String(prompt || '');
  if (text.length > MAX_PROMPT) return null;
  const match = TAP_WAKE.exec(text);
  if (!match) return null;
  const [, wakeText, , , messageText, inner, notesText] = match;
  const wake = attributes(wakeText);
  const message = attributes(messageText);
  if (!wake || !message || wake.reason !== 'decision-chosen') return null;
  if (message.trigger !== 'true' || message.from !== 'human' || message.trust !== 'principal' || message['has-attachments'] !== undefined) return null;
  const notes = new Map();
  for (const [, note] of notesText.matchAll(/<system-note>([^<]*)<\/system-note>/g)) {
    const pair = /^([a-z_]+)=(\S+)$/.exec(note.trim());
    if (!pair) continue;
    if (notes.has(pair[1])) return null;
    notes.set(pair[1], pair[2]);
  }
  const id = notes.get('decision_id');
  const actor = notes.get('actor_account_id');
  if (!id || !ID.test(id) || notes.get('option_index') !== '0' || !actor || actor !== message['author-id']) return null;
  const tap = TAP_TEXT.exec(decoded(inner).trim());
  if (!tap) return null;
  return { repository: tap[1], pr: Number(tap[2]), sha: tap[3], id, sentAt: message['sent-at'] || null };
}

// The project line as read from the owner's project instructions inside the host's session context
// at the start of this text: 'off' forces task auto-merge Off for this thread; 'none' (no line)
// and 'on' leave the repository's merged switch (task_prs.auto_merge) in charge, since an On line
// grants nothing on its own. null when the text does not start with a session context. Only the
// `<project-instructions nonce="Y">` block nested in it counts, up to its own closing tag: the rest
// of the session context also lists shared files, repositories and folders, which agents can name.
// Anything unclear (two lines, a second instructions opener, an unclosed block or context) is 'off'.
function switchSetting(prompt) {
  const text = String(prompt || '');
  if (text.length > MAX_PROMPT) return null;
  const open = /^\s*<session-context nonce="([A-Za-z0-9]{8,128})">/.exec(text);
  if (!open) return null;
  const end = text.indexOf(`</session-context nonce="${open[1]}">`, open[0].length);
  if (end < 0) return 'off';
  const context = text.slice(open[0].length, end);
  const blocks = [...context.matchAll(/<project-instructions nonce="([A-Za-z0-9]{8,128})"[^<>]*>/g)];
  if (blocks.length !== 1) return 'off';
  const start = blocks[0].index + blocks[0][0].length;
  const close = context.indexOf(`</project-instructions nonce="${blocks[0][1]}">`, start);
  if (close < 0) return 'off';
  const lines = context.slice(start, close).split(/\r?\n/).filter(line => /^\s*-\s*Task auto-merge\s*:/i.test(line));
  if (lines.length === 0) return 'none';
  if (lines.length !== 1) return 'off';
  return /^\s*-\s*Task auto-merge\s*:\s*On\b/.test(lines[0]) ? 'on' : 'off';
}

// The project line for this cloud session (switchSetting's 'off', 'none' or 'on'), read from the
// host's opening record of its transcript: the first main-thread user entry, which must be marked
// meta, belong to `sessionId` and hold text. A typed first prompt, tool output, a later wake or
// another session's transcript never counts. null (which forces Off) when it is missing, unreadable
// or not a session context.
function transcriptSetting({ transcriptPath, sessionId } = {}) {
  if (typeof transcriptPath !== 'string' || !transcriptPath || typeof sessionId !== 'string' || !sessionId) return null;
  let entry;
  try { entry = transcriptHead.firstUserEntry(transcriptPath); } catch { return null; }
  if (!entry || entry.isMeta !== true || entry.sessionId !== sessionId) return null;
  const content = entry.message && entry.message.content;
  return typeof content === 'string' ? switchSetting(content) : null;
}

module.exports = Object.freeze({ mergeCardQuestion, mergeCardTap, switchSetting, transcriptSetting });
