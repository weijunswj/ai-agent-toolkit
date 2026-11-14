'use strict';

// Claude Projects inputs the merge hold reads in a cloud thread, from the host's own prompt text:
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
//                    which the host puts at the very start of a thread's first prompt inside
//                    `<session-context nonce="X">` ... `</session-context nonce="X">`, as one
//                    `<project-instructions nonce="Y">` ... `</project-instructions nonce="Y">`
//                    block. The repository's merged switch (task_prs.auto_merge) is the only grant;
//                    this line can only force it Off. Only that block counts: the shared-file,
//                    repository and folder lists beside it, and anything after the context (a
//                    relay, a citation, a note), are never read. No line defers to the binding; an
//                    On line grants nothing; an Off line, two lines, a second instructions opener or
//                    an unclosed block force Off. It is a snapshot from the first prompt: a later
//                    change reaches only threads started after it, and a session with no snapshot
//                    (a new container) is forced Off.
//
// Tripwire, not a lock: a fully forged top-level wake or session context with the right shape
// would count, as for the typed `merge N` the Projects wake reader already accepts. Required CI and
// the repository's own rules stay the hard limit.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SWITCH_BASENAME = 'projects-task-auto-merge.json';
const SWITCH_SCHEMA = 'toolkit.projects-task-auto-merge.v1';
const MAX_SESSIONS = 256;
const MAX_SWITCH_AGE_MS = 14 * 24 * 60 * 60 * 1000;
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
// at the start of this prompt: 'off' forces task auto-merge Off for this thread; 'none' (no line)
// and 'on' leave the repository's merged switch (task_prs.auto_merge) in charge, since an On line
// grants nothing on its own. null when the prompt does not start with a session context. Only the
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

// The project line as read for each cloud session on this container. It only ever forces Off: a
// session whose instructions were read with no Off line defers to the merged binding. A session with
// no record (its instructions were never read here, or the container restarted) and a store that
// cannot be read both force Off, so a lost Off line never turns task auto-merge On.
class ProjectsSwitch {
  #file; #now;

  constructor({ directory, now = () => new Date() } = {}) {
    this.#file = path.join(directory, SWITCH_BASENAME);
    this.#now = now;
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
      if (!parsed || parsed.schema !== SWITCH_SCHEMA || !parsed.sessions || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) return {};
      const oldest = this.#now().getTime() - MAX_SWITCH_AGE_MS;
      return Object.fromEntries(Object.entries(parsed.sessions).filter(([, entry]) => entry && ['on', 'off', 'none'].includes(entry.value) && Date.parse(entry.at) >= oldest));
    } catch (error) { return error?.code === 'ENOENT' ? {} : null; }
  }

  record(sessionId, value) {
    if (typeof sessionId !== 'string' || !ID.test(sessionId) || !['on', 'off', 'none'].includes(value)) return false;
    const sessions = this.#read() || {};
    delete sessions[sessionId];
    sessions[sessionId] = { value, at: this.#now().toISOString() };
    const kept = Object.fromEntries(Object.entries(sessions).slice(-MAX_SESSIONS));
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: SWITCH_SCHEMA, sessions: kept }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally { fs.rmSync(temp, { force: true }); }
    return true;
  }

  forcedOff(sessionId) {
    const sessions = typeof sessionId === 'string' ? this.#read() : null;
    return !sessions || !['on', 'none'].includes(sessions[sessionId]?.value);
  }
}

module.exports = Object.freeze({ SWITCH_BASENAME, mergeCardQuestion, mergeCardTap, switchSetting, ProjectsSwitch });
