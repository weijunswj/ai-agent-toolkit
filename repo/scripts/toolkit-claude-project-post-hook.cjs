#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for the Claude Projects post tools (post_message and edit_message) and for PR merges. It
// enforces these rules of the Projects skill from the session's own transcript, so they hold after the context is
// compacted:
// - One running post: the coordinator or a work thread may not start a fresh post while its newest post has no
//   owner message after it, unless that post nears the 8 KB size limit. It must edit the running post instead. A
//   reply under one of its posts (a post with a thread_id) is exempt from this rule and never becomes the running
//   post; the wording rules still apply to it.
// - The project chat's newest message: the hook cannot read the chat, so it uses the session's own reads of it. When
//   a read of the project chat reaches the last page, its newest top-level message decides: the coordinator's own
//   post (not a card) becomes the running post, even one an earlier session wrote, unless an owner message this
//   session saw (by its sent-at time) came after it; an owner message there counts as the owner writing. A work-thread session (one started by a spawn relay, or whose posts land in a thread) skips
//   these reads, since its posts go to its thread and not the chat.
// - Links, only where the owner acts: every numbered item under the **Waiting on you (n):** header (each question and
//   merge ask) carries a link (link text may hold one level of brackets, or a bare https URL), and a /pull/<n> link in
//   such an item without /files is refused with the fix. Prose, plain bullets and PR mentions elsewhere need no link.
// - Wording, on every post and reply: no em-dashes or arrows outside code, and at most one line starting with a bare
//   **Question:** label (prose that mentions the label is not counted).
// - Layout, on top-level posts of 25 words or more, or with an Update, Waiting on you or **Question: line: a **Now:**
//   line first (after an optional "Re: your reply on" line), **[HH:MM] Update:** one-liners with no question or
//   numbered options inside, and one **ELI5:** line as the very last line. The Waiting list opens only at a line that
//   is exactly the header and runs to the next Update or ELI5 line. In it, choice bullets indented three or more
//   spaces (or a tab) sit under a numbered item and need no link; a "(my pick)" choice needs a numbered **Question:**
//   item above it. A question is never flattened: every line starting **Question: must be a numbered item in the
//   list, and an unindented or two-space bullet right after a question or its choices (spacers skipped), or one
//   marked "(my pick)", is refused. Other bullets, spacers and prose are passed over. An edit of an earlier post keeps
//   every one of its Update lines word for word and adds at least one new one.
// - Post fresh after the owner writes: every edit of a top-level post the owner has written after is refused, since
//   anything it adds would sit above the owner's message. Only an owner reply under the running post itself (a
//   thread whose root is that post) leaves the running post open to edits; any other owner message marks every post.
// - Merge summary: in a Projects session (one that has used the Projects tools), a PR merge (the gh merge command, a
//   gh api PUT to .../pulls/<n>/merge or a merge_pull_request tool) is refused until a line of one of its own posts
//   says "external effects" and names that PR; every merge in a command is checked. The command is read word by word
//   with bash or PowerShell quoting rules (see shellSegments), so quotes, escapes and option values never hide or
//   replace the PR, a redirection's stream number and target are never read as it, and a command it cannot finish
//   reading counts as a merge with no number. It is a tripwire on the command text only: curl, GraphQL, wrapper shells, prefixes such as VAR= or sudo, aliases, scripts, direct
//   pushes and a command inside a double-quoted $(...) or backticks are not seen.
// Sessions without these tools (normal chats, Codex and sessions outside Projects) are never touched. Decision cards
// are a separate tool this hook does not check. Input or a transcript it cannot read passes. The
// hook is registered without `onFailure: "block"` so a hook that cannot start never silences every post.
const fs = require('node:fs');

const POST_TOOL = 'mcp__hearthbot__post_message';
const EDIT_TOOL = 'mcp__hearthbot__edit_message';
const CHAT_READ_TOOL = 'mcp__hearthbot__read_project_chat';
const TRACKED_TOOLS = new Set([POST_TOOL, EDIT_TOOL, CHAT_READ_TOOL]);
const SPAWN_RELAY = /^\s*<relay\b[^<>]*\breason=["']spawn["']/;
// Sorts after every ISO time: an owner message with no sent-at counts as later than any chat post.
const LATEST_TIME = String.fromCharCode(0xffff);
const PROJECTS_TOOL = /^mcp__hearthbot__/;
const SHELL_TOOL = /^(?:Bash|PowerShell)$/;
const MERGE_TOOL = /^mcp__.*merge_pull_request$/i;
const NEAR_LIMIT_BYTES = 7000;
const SHORT_POST_WORDS = 25;
const MESSAGE_ID = /\b(cmsg_[A-Za-z0-9]+)\b/;
const UPDATE_LINE = /^\s*(?:[-*]\s+)?\*\*\[\d{1,2}:\d{2}\] Update:\*\*/;
// Only a line that is exactly the header opens the Waiting list, so a bullet or prose that names it does not.
const WAITING_LINE = /^\s*\*\*Waiting on you(?: \(\d+\))?:\*\*\s*$/i;
// An owner item in the Waiting list.
const NUMBERED_LINE = /^\s{0,3}\d+[.)]\s+/;
// An unindented or two-space bullet: its own line, not a choice under an item.
const BULLET_LINE = /^ {0,2}[-*]\s+/;
// A choice bullet under a numbered item.
const SUB_LINE = /^(?: {3,}|\t)[-*]\s+\S/;
// A line asking a question, bare or after a bullet or number marker.
const QUESTION_LINE = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\*\*Question:/;
// A line starting with the bare label, as in "**Question:** merge it?".
const BARE_QUESTION_LINE = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\*\*Question:\*\*/;
const MY_PICK = /\(my pick\)/i;
// A line holding only a spacer: &nbsp; in any form or a line break tag.
const SPACER_LINE = /^(?:\s|&nbsp;|&#160;|&#x[aA]0;|<br\s*\/?>)*$/i;
const NOW_LINE = /^\s*(?:[-*]\s+)?\*\*Now:\*\*/;
const REPLY_LINE = /^\s*Re: your reply on\b/i;
const ELI5_LINE = /^\s*(?:[-*]\s+)?\*\*ELI5:\*\*/;
const BARE_URL = /https?:\/\/\S/;
// Numbered options: a 1 and a 2 in the same style ("1. ... 2.", "1) ... 2)" or "(1) ... (2)").
const OPTION_LISTS = [[/(?:^|\s)1\.\s+\S/, /\s2\.\s+\S/], [/(?:^|\s)1\)\s+\S/, /\s2\)\s+\S/], [/\(1\)\s+\S/, /\(2\)\s+\S/]];
// Finds the 1 marker first, then a 2 marker after it, so a long line stays linear.
function hasOptionList(body) {
  return OPTION_LISTS.some(([one, two]) => {
    const first = one.exec(body);
    return first !== null && two.test(body.slice(first.index + first[0].length));
  });
}

// An owner message counts unless it sits inside one of the quoting tags below (a message, note, citation, relay,
// task notification or another session's output), so an owner tag quoted or forwarded inside one of them never counts.
// The runtime also escapes "<" in message text, so a quoted tag usually arrives as plain text; this is the second line
// of defence. Any other wrapper (wake, project, thread or a newer one) is accepted, so a change in the wake's outer
// shape cannot silently stop owner messages from counting.
const QUOTE_TAGS = new Set([
  'message', 'note', 'cited', 'relay', 'coordinator-relay',
  'cross-session-message', 'task-notification', 'child-session-output', 'project_claude_message',
]);
// Returns one entry per owner message: the ts of the innermost <thread> around it (null outside any thread) and its
// sent-at time (null when the wake gives none).
function ownerMessages(text) {
  const open = [];
  const found = [];
  for (const tag of text.matchAll(/<(\/?)([A-Za-z][\w-]*)\b([^<>]*?)(\/?)>/g)) {
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) {
      const at = open.map(item => item.name).lastIndexOf(name);
      if (at !== -1) open.length = at;
      continue;
    }
    if (name === 'message' && /\bfrom=["']human["']/.test(attributes) && !open.some(item => QUOTE_TAGS.has(item.name))) {
      const thread = [...open].reverse().find(item => item.name === 'thread');
      found.push({
        thread: thread ? thread.attributes.match(/\bts=["']([^"']+)["']/)?.[1] || null : null,
        at: attributes.match(/\bsent-at=["']([^"']+)["']/)?.[1] || null,
      });
    }
    if (!selfClosing) open.push({ name, attributes });
  }
  return found;
}

function textOf(text) {
  return typeof text === 'string' ? text : '';
}

function bytes(text) {
  return Buffer.byteLength(textOf(text), 'utf8');
}

function promptText(content) {
  // A message with an image arrives as blocks: an image block, then the wake as a text block.
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
}

// Text the user side of the transcript carries: prompts and wakes, never tool results. A message that arrives while
// a turn runs is first recorded as a queued entry, and may never appear as a prompt of its own.
function userText(entry) {
  if (entry?.isMeta || entry?.isCompactSummary) return '';
  if (entry?.type === 'queue-operation') return entry.operation === 'enqueue' ? promptText(entry.content) : '';
  if (entry?.type === 'attachment' && entry.attachment?.type === 'queued_command') return promptText(entry.attachment.prompt);
  if (entry?.type === 'user') return promptText(entry.message?.content);
  return '';
}

// A work-thread session: one started by a spawn relay (recorded as a meta prompt or a queued entry), or one whose
// post without a thread_id landed in a thread other than its own message.
function threadSession(entries) {
  const pending = new Map();
  for (const entry of entries) {
    if (entry?.type === 'queue-operation' && SPAWN_RELAY.test(promptText(entry.content))) return true;
    if (entry?.type === 'user' && SPAWN_RELAY.test(promptText(entry.message?.content))) return true;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && block.name === POST_TOOL && !block.input?.thread_id) pending.set(block.id, true);
      else if (entry.type === 'user' && block?.type === 'tool_result' && pending.delete(block.tool_use_id) && !block.is_error) {
        let result;
        try { result = JSON.parse(resultText(block)); } catch { continue; }
        if (typeof result?.message_id === 'string' && typeof result.thread_id === 'string' && result.thread_id !== result.message_id) return true;
      }
    }
  }
  return false;
}

// The newest top-level message in a project chat read that reached the last page, or null. The listing is the JSON
// object in the result; message bodies inside it are escaped strings, so they cannot fake its shape.
function chatNewest(text) {
  const start = text.indexOf('{"messages":');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  let listing;
  try { listing = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (listing?.has_more !== false || !Array.isArray(listing.messages)) return null;
  let newest = null;
  for (const message of listing.messages) {
    if (typeof message?.created_at === 'string' && (!newest || message.created_at >= newest.created_at)) newest = message;
  }
  return typeof newest?.id === 'string' && MESSAGE_ID.test(newest.id) ? newest : null;
}

// A card (onboarding, decision or activity) is a JSON object with a kind, not a post.
function isCard(body) {
  try { return typeof JSON.parse(body)?.kind === 'string'; } catch { return false; }
}

function resultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (!Array.isArray(block.content)) return '';
  return block.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
}

// Walks the transcript and returns the running post (the newest successful top-level post with no owner message
// after it) with its current size, the latest text of each successful own post (and whether it is a reply under a
// post; null when only an edit of it is known), and whether the session has used the Projects tools.
function readTranscript(lines) {
  let running = null;
  // The newest top-level post, kept after owner messages so a second reply under it is still a reply under it.
  let newest = null;
  let projects = false;
  const pending = new Map();
  const posts = new Map();
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { continue; }
  }
  const inThread = threadSession(entries);
  // The time of the newest owner message seen so far; one with no time counts as later than any chat post.
  let ownerAt = null;
  const ownerWrote = owner => {
    // Only an owner reply under the running post itself leaves that post open to edits; any other owner message
    // (main chat, a work thread, or a reply under an older post) puts every post above it.
    const runningId = newest;
    for (const [id, post] of posts) {
      if (id !== runningId || owner.some(({ thread }) => thread !== runningId)) post.ownerAfter = true;
    }
    for (const { at } of owner) {
      const time = at || LATEST_TIME;
      if (ownerAt === null || time > ownerAt) ownerAt = time;
    }
    running = null;
  };
  for (const entry of entries) {
    const owner = ownerMessages(userText(entry));
    if (owner.length) ownerWrote(owner);
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && PROJECTS_TOOL.test(String(block.name))) projects = true;
      if (entry.type === 'assistant' && block?.type === 'tool_use' && TRACKED_TOOLS.has(block.name)) {
        pending.set(block.id, { name: block.name, input: block.input || {} });
      } else if (entry.type === 'user' && block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const call = pending.get(block.tool_use_id);
        pending.delete(block.tool_use_id);
        if (block.is_error) continue;
        if (call.name === CHAT_READ_TOOL) {
          const latest = inThread ? null : chatNewest(resultText(block));
          // The owner's top-level message is the newest: it sits below every post, as an owner message in the chat.
          // The coordinator's newest post is the running post only when no owner message seen here (a reply in a
          // thread included) came after it, so it is never both closed to edits and barred from a fresh post.
          if (latest?.author === 'user') ownerWrote([{ thread: null, at: latest.created_at }]);
          // A body near the 8 KB limit may be cut short by the read, so that post is left untracked: a fresh post
          // passes, as for any running post that size, and its edits are never compared with a shortened text.
          else if (latest?.author === 'agent' && typeof latest.body === 'string' && !isCard(latest.body)
            && bytes(latest.body) < NEAR_LIMIT_BYTES
            && !posts.get(latest.id)?.ownerAfter && (ownerAt === null || ownerAt < latest.created_at)) {
            running = { id: latest.id, size: bytes(latest.body) };
            newest = latest.id;
            // Recorded as a top-level post, so a later owner message closes it to edits and its edits are layout-checked.
            posts.set(latest.id, { text: latest.body, reply: false, ownerAfter: false });
          }
        } else if (call.name === POST_TOOL) {
          const id = resultText(block).match(MESSAGE_ID)?.[1];
          if (id) posts.set(id, { text: textOf(call.input.text), reply: Boolean(call.input.thread_id), ownerAfter: false });
          if (id && !call.input.thread_id) {
            running = { id, size: bytes(call.input.text) };
            newest = id;
          }
        } else if (typeof call.input.message_id === 'string') {
          const known = posts.get(call.input.message_id);
          posts.set(call.input.message_id, { text: textOf(call.input.text), reply: known ? known.reply : null, ownerAfter: known ? known.ownerAfter : false });
          if (running && call.input.message_id === running.id) running.size = bytes(call.input.text);
        }
      }
    }
  }
  return { running, projects, posts };
}

// Blanks code (a fence of ``` or ~~~ at the start of a line, running to its closing fence or the end, and inline spans)
// so an arrow, a link or a question inside it is not read.
function withoutCode(text) {
  return text.replace(/(^|\n)[ \t]{0,3}(```|~~~)[\s\S]*?(?:\n[ \t]{0,3}\2[^\n]*|$)|`[^`\n]*`/g, match => match.replace(/[^\n]/g, ' '));
}

// A markdown link whose text may hold one level of brackets ("[[09:41] Update card](#cmsg_X)"), or a bare https URL.
// One pass: the scan keeps the "[" that opens the link text and at most one inner "[" inside it; a third "[" makes the
// inner one the new opener. A "]" closes the inner "[" first, then the opener, and either one followed by a "(target)"
// is a link. A target that runs into a space or the end of the line also ends every later target before that point,
// so it is not read again, and the scan stays linear on long runs of brackets.
function hasLink(line) {
  if (BARE_URL.test(line)) return true;
  let open = -1;
  let inner = -1;
  let noTargetBefore = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '[') {
      if (open === -1) open = i;
      else if (inner === -1) inner = i;
      else { open = inner; inner = i; }
      continue;
    }
    if (line[i] !== ']' || open === -1) continue;
    const textStart = (inner === -1 ? open : inner) + 1;
    if (inner === -1) open = -1;
    else inner = -1;
    if (i === textStart || line[i + 1] !== '(' || i + 2 <= noTargetBefore) continue;
    let end = i + 2;
    while (end < line.length && line[end] !== ')' && !/\s/.test(line[end])) end += 1;
    if (line[end] === ')' && end > i + 2) return true;
    noTargetBefore = end;
  }
  return false;
}

// A /pull/<n> link in a Waiting on you item without its /files page.
function filesIssue(line) {
  const files = new Set([...line.matchAll(/\/pull\/(\d+)\/files\b/g)].map(match => match[1]));
  for (const [, value] of line.matchAll(/\/pull\/(\d+)(?!\d)/g)) {
    if (files.has(value)) continue;
    return `PR ${value} in the Waiting on you item "${line.trim().slice(0, 80)}" is linked without /files. Link it as https://github.com/<owner>/<repo>/pull/${value}/files when it is ready for the owner to check and merge, otherwise link the chat thread that owns the work. Keep the item numbered as it is.`;
  }
  return '';
}

const EM_DASH = String.fromCharCode(0x2014);
const ARROW = String.fromCharCode(0x2192);

// Em-dashes, arrows and more than one line starting with a bare Question label, outside code and HTML comments.
function wordingIssue(text) {
  const plain = withoutCode(textOf(text)).replace(/<!--[\s\S]*?-->/g, ' ');
  if (plain.includes(EM_DASH)) return 'it has an em-dash. Use a comma, a colon or a full stop instead.';
  if (plain.includes('->') || plain.includes(ARROW)) return 'it has an arrow. Say it in words ("then", "so", "leads to") instead.';
  if (lineSplit(plain).filter(line => BARE_QUESTION_LINE.test(line)).length > 1) return 'it has more than one bare **Question:** label. Write each question as a numbered item under **Waiting on you**, `1. **Question: <the ask>?**` with the link to its card or thread, and its choices indented four spaces under it. Do not flatten the questions into plain bullets or bold labels.';
  return '';
}

// Every line ending CommonMark accepts (CRLF, LF or a lone CR) ends a line here too.
function lineSplit(text) {
  return text.split(/\r\n|\r|\n/);
}

function lineList(text) {
  return lineSplit(withoutCode(textOf(text).replace(/\r\n?/g, '\n'))).filter(line => line.trim());
}

function updateLines(text) {
  return lineList(text).filter(line => UPDATE_LINE.test(line)).map(line => line.trim().replace(/^[-*]\s+/, ''));
}

const quoted = line => `"${line.trim().slice(0, 80)}"`;

// The Waiting on you lists and every question line. Each header opens a list that runs to the next Update or ELI5
// line. In it, a numbered line is an owner item and needs a link; a choice is a bullet indented under a numbered item;
// an unindented bullet right after a question or its choices (spacers skipped) is a flattened choice. Anywhere else,
// a question line is a flattened question.
function waitingIssue(lines) {
  let inList = false;
  // The numbered item the next choices sit under, and what the last line that was not a spacer was.
  let item = null;
  let last = '';
  for (const line of lines) {
    if (WAITING_LINE.test(line)) {
      inList = true;
      item = null;
      last = '';
      continue;
    }
    const numbered = inList && NUMBERED_LINE.test(line);
    if (QUESTION_LINE.test(line) && !numbered) {
      return `the question ${quoted(line)} is not a numbered item under **Waiting on you (n):**. Keep the owner's question layout: put it in that list as 1. **Question: <the ask>?** with its link, and indent its choices four spaces under it. Do not flatten it into a plain bullet, a bold label or an Update line.`;
    }
    if (!inList) continue;
    if (SUB_LINE.test(line) && item) {
      const question = QUESTION_LINE.test(item);
      if (MY_PICK.test(line) && !question) {
        return `the choice ${quoted(line)} has no numbered **Question:** item above it. Write the question as 1. **Question: <the ask>?** with its link and indent the choices under it.`;
      }
      last = question ? 'question' : 'item';
      continue;
    }
    if (UPDATE_LINE.test(line) || ELI5_LINE.test(line)) {
      inList = false;
      continue;
    }
    if (SUB_LINE.test(line)) {
      return `the choice ${quoted(line)} has no numbered **Question:** item above it. Write the question as 1. **Question: <the ask>?** with its link and indent the choices under it.`;
    }
    if (numbered) {
      item = line;
      last = QUESTION_LINE.test(line) ? 'question' : 'item';
      if (!hasLink(line)) {
        return `the Waiting on you item ${quoted(line)} has no link. Add the link to the card, thread or PR changes page where the owner acts, and keep the item numbered as it is. If the owner answers in chat and there is no card yet, post the card first and link it. Do not turn the item into a plain bullet or drop its number to get past this check.`;
      }
      const files = filesIssue(line);
      if (files) return files;
      continue;
    }
    if (BULLET_LINE.test(line) && (last === 'question' || MY_PICK.test(line))) {
      return `the choice ${quoted(line)} is not indented under its question. Indent each choice four spaces under its numbered **Question:** item. Do not turn choices into plain bullets.`;
    }
    if (!SPACER_LINE.test(line)) last = '';
  }
  return '';
}

// The approved post layout. Short posts (under 25 words, with no Update, Waiting on you or Question line) are exempt.
function layoutIssue(text) {
  const lines = lineList(text);
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const updates = lines.filter(line => UPDATE_LINE.test(line));
  const listed = lines.some(line => WAITING_LINE.test(line) || QUESTION_LINE.test(line));
  if (words < SHORT_POST_WORDS && !updates.length && !listed) return '';
  const first = REPLY_LINE.test(lines[0]) ? lines[1] : lines[0];
  if (!first || !NOW_LINE.test(first)) return 'its first line must start with **Now:** (where things stand now, rewritten on each edit). A "Re: your reply on <topic>" line may come before it.';
  for (const line of updates) {
    const body = line.replace(UPDATE_LINE, '');
    if (/Question:/i.test(body) || hasOptionList(body)) {
      return `the Update line ${quoted(line)} has a question or numbered options in it. An Update line is one short status sentence; ask the question as a numbered **Question:** item under **Waiting on you** instead, and do not flatten it into a plain bullet.`;
    }
  }
  const waiting = waitingIssue(lines);
  if (waiting) return waiting;
  const eli5 = lines.filter(line => ELI5_LINE.test(line)).length;
  const last = lineSplit(textOf(text)).filter(line => line.trim()).pop();
  if (eli5 !== 1 || !ELI5_LINE.test(last)) return 'it must end with exactly one **ELI5:** line, with nothing after it.';
  return '';
}

// An edit keeps every earlier Update line word for word, once and in order, and appends at least one new one.
function editIssue(previous, text) {
  const before = updateLines(previous);
  const after = updateLines(text);
  const count = (lines, line) => lines.filter(item => item === line).length;
  const missing = before.find(line => !after.includes(line));
  if (missing) return `it drops or changes the earlier line "${missing.slice(0, 80)}". Keep every Update line word for word.`;
  const repeated = before.find(line => count(after, line) > count(before, line));
  if (repeated) return `it repeats the earlier line "${repeated.slice(0, 80)}". Keep each Update line once.`;
  if (after.filter(line => before.includes(line)).join('\n') !== before.join('\n')) return 'it reorders the earlier Update lines. Keep them in their order and append new ones.';
  const lastKept = before.length ? after.lastIndexOf(before[before.length - 1]) : -1;
  if (after.some((line, index) => index < lastKept && !before.includes(line))) return 'it adds a new Update line above an earlier one. Append new lines after the last earlier line.';
  if (!after.some(line => !before.includes(line))) return 'it adds no new **[HH:MM] Update:** line. Append one short line in the owner\'s local time for what changed.';
  return '';
}

// Shell reading. The merge check reads a command word by word, following bash quoting rules for the Bash tool and
// PowerShell quoting rules for the PowerShell tool, rather than rewriting its text: quotes and escapes are removed and
// their pieces join into one word (so an empty quote touching a word adds nothing, and a quoted option value stays
// that option's one value), separators inside quotes are text, and comments, heredoc or here-string bodies,
// $((...)), redirections and their targets are skipped. A backtick or $(...) command inside double quotes, and an
// unquoted backtick command in bash, is skipped as text. Input the reader cannot finish (an open quote, heredoc or
// bracket, or nesting too deep) is marked open, and an open read that mentions a gh merge counts as a merge with no
// number, so a misread fails toward checking. Every pass moves forward only, so it runs in linear time.
const SEPARATORS = new Set([';', '&', '|', '(', ')', '\n', '\r']);
const BLANKS = new Set([' ', '\t']);
// Set by a reader that runs out of input before its closer.
let readOpen = false;

function skipSingle(text, i) {
  const end = text.indexOf("'", i);
  if (end === -1) readOpen = true;
  return end === -1 ? text.length : end + 1;
}

function skipAnsi(text, i) {
  while (i < text.length && text[i] !== "'") i += text[i] === '\\' ? 2 : 1;
  if (i >= text.length) readOpen = true;
  return Math.min(i + 1, text.length);
}

function skipBacktick(text, i) {
  while (i < text.length && text[i] !== '`') i += text[i] === '\\' ? 2 : 1;
  if (i >= text.length) readOpen = true;
  return Math.min(i + 1, text.length);
}

function skipArith(text, i) {
  let depth = 2;
  for (; i < text.length && depth > 0; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
  }
  if (depth > 0) readOpen = true;
  return i;
}

// A heredoc delimiter after << or <<-: the next word with its quotes and backslashes removed.
function readDelimiter(text, i) {
  const strip = text[i] === '-';
  if (strip) i += 1;
  while (BLANKS.has(text[i])) i += 1;
  let tag = '';
  while (i < text.length && !BLANKS.has(text[i]) && !SEPARATORS.has(text[i]) && text[i] !== '<' && text[i] !== '>') {
    if (text[i] === "'" || text[i] === '"') {
      const end = text.indexOf(text[i], i + 1);
      if (end === -1) readOpen = true;
      const stop = end === -1 ? text.length : end;
      tag += text.slice(i + 1, stop);
      i = stop + 1;
    } else if (text[i] === '\\') {
      tag += text[i + 1] || '';
      i += 2;
    } else {
      tag += text[i];
      i += 1;
    }
  }
  return { i, heredoc: tag ? { tag, strip } : null };
}

// Skips the bodies of the heredocs waiting on this line; i is just after its newline.
function skipHeredocs(text, i, pending) {
  for (const { tag, strip } of pending.splice(0)) {
    let closed = false;
    while (i < text.length && !closed) {
      const newline = text.indexOf('\n', i);
      const end = newline === -1 ? text.length : newline;
      const line = text.slice(i, end).replace(/\r$/, '');
      i = end + 1;
      closed = (strip ? line.replace(/^\t+/, '') : line) === tag;
    }
    if (!closed) readOpen = true;
  }
  return Math.min(i, text.length);
}

function skipDouble(text, i) {
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\') i += 2;
    else if (text.startsWith('$((', i)) i = skipArith(text, i + 3);
    else if (text.startsWith('$(', i)) i = skipCommand(text, i + 2);
    else if (text[i] === '`') i = skipBacktick(text, i + 1);
    else i += 1;
  }
  if (i >= text.length) readOpen = true;
  return Math.min(i + 1, text.length);
}

// A $(...) command inside double quotes: found to its closing bracket, with its own quotes and heredocs, never read.
function skipCommand(text, i) {
  const pending = [];
  for (let depth = 1; i < text.length;) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === "'") i = skipSingle(text, i + 1);
    else if (c === '"') i = skipDouble(text, i + 1);
    else if (text.startsWith("$'", i)) i = skipAnsi(text, i + 2);
    else if (text.startsWith('$((', i)) i = skipArith(text, i + 3);
    else if (c === '`') i = skipBacktick(text, i + 1);
    else if (text.startsWith('<<<', i)) i += 3;
    else if (text.startsWith('<<', i)) {
      const read = readDelimiter(text, i + 2);
      if (read.heredoc) pending.push(read.heredoc);
      i = read.i;
    } else if (c === '\n') i = skipHeredocs(text, i + 1, pending);
    else if (c === '(') { depth += 1; i += 1; }
    else if (c === ')') {
      depth -= 1;
      i += 1;
      if (!depth) return i;
    } else i += 1;
  }
  readOpen = true;
  return i;
}

// Word building shared by the bash and PowerShell readers. A redirection target is read and then dropped.
function wordReader() {
  const segments = [];
  let words = [];
  let word = null;
  let dropNext = false;
  const reader = {
    segments,
    add(part) { word = (word ?? '') + part; },
    endWord() {
      if (word !== null) {
        if (dropNext) dropNext = false;
        else words.push(word);
      }
      word = null;
    },
    endSegment() {
      reader.endWord();
      dropNext = false;
      if (words.length) segments.push(words);
      words = [];
    },
    wordStarted: () => word !== null,
    // A redirection operator: an all-digit word (or PowerShell's *) right before it is its stream, not an argument.
    redirect(fd) {
      if (word !== null && fd.test(word)) word = null;
      else reader.endWord();
    },
    dropTarget() { dropNext = true; },
  };
  return reader;
}

// The closing bracket for each opening bracket in the raw text (-1 when it never closes), in one pass.
function bracketPairs(text) {
  const pairs = new Int32Array(text.length).fill(-1);
  const open = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') open.push(i);
    else if (text[i] === ')' && open.length) pairs[open.pop()] = i;
  }
  return pairs;
}

// Bash: the command's segments (split at ; & | ( ) and newlines outside quotes), each a list of words.
function bashSegments(text) {
  const pending = [];
  const read = wordReader();
  const pairs = text.includes('((') ? bracketPairs(text) : null;
  // (( starts arithmetic only when its inner bracket closes straight into the outer one, as in ((x<<2)), or never
  // closes; ((cmd) && cmd) is two subshells.
  const arithmetic = i => pairs[i + 1] === -1 || pairs[i] === pairs[i + 1] + 1;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (BLANKS.has(c)) { read.endWord(); i += 1; }
    else if (c === '\\') {
      if (text[i + 1] !== '\n') read.add(text[i + 1] || '');
      i += 2;
    } else if (c === "'") {
      const end = skipSingle(text, i + 1);
      read.add(text.slice(i + 1, text[end - 1] === "'" ? end - 1 : end));
      i = end;
    } else if (c === '"') {
      let part = '';
      for (i += 1; i < text.length && text[i] !== '"';) {
        if (text[i] === '\\' && '"\\$`'.includes(text[i + 1])) { part += text[i + 1]; i += 2; }
        else if (text.startsWith('$((', i)) { part += '_'; i = skipArith(text, i + 3); }
        else if (text.startsWith('$(', i)) { part += '_'; i = skipCommand(text, i + 2); }
        else if (text[i] === '`') { part += '_'; i = skipBacktick(text, i + 1); }
        else { part += text[i]; i += 1; }
      }
      if (i >= text.length) readOpen = true;
      read.add(part);
      i += 1;
    } else if (text.startsWith("$'", i)) {
      const end = skipAnsi(text, i + 2);
      read.add(text.slice(i + 2, text[end - 1] === "'" ? end - 1 : end).replace(/\\([\s\S])/g, '$1'));
      i = end;
    } else if (text.startsWith('$((', i)) { read.add('_'); i = skipArith(text, i + 3); }
    else if (text.startsWith('((', i) && !read.wordStarted() && arithmetic(i)) { read.endSegment(); i = skipArith(text, i + 2); }
    else if (c === '`') { read.add('_'); i = skipBacktick(text, i + 1); }
    else if (c === '#' && !read.wordStarted()) {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
    } else if (text.startsWith('<<<', i)) { read.endWord(); read.dropTarget(); i += 3; }
    else if (text.startsWith('<<', i)) {
      read.endWord();
      const delimiter = readDelimiter(text, i + 2);
      if (delimiter.heredoc) pending.push(delimiter.heredoc);
      i = delimiter.i;
    } else if (c === '\n') {
      read.endSegment();
      i = skipHeredocs(text, i + 1, pending);
    } else if (c === '$' && text[i + 1] === '(') { read.endSegment(); i += 2; }
    else if (c === '&' && text[i + 1] === '>') {
      read.endWord();
      i += text[i + 2] === '>' ? 3 : 2;
      read.dropTarget();
    } else if (c === '<' || c === '>') {
      read.redirect(/^\d+$/);
      i += 1;
      if ((c === '>' && '>|'.includes(text[i])) || (c === '<' && text[i] === '>')) i += 1;
      if (text[i] === '&') {
        i += 1;
        const fd = text.slice(i).match(/^(?:\d+|-)/);
        if (fd) i += fd[0].length;
        else read.dropTarget();
      } else read.dropTarget();
    } else if (SEPARATORS.has(c)) { read.endSegment(); i += 1; }
    else { read.add(c); i += 1; }
  }
  read.endSegment();
  if (pending.length) readOpen = true;
  return read.segments;
}

// PowerShell: a $(...) subexpression found to its closing bracket, with its own quotes, never read.
function skipPowerShellSub(text, i) {
  for (let depth = 1; i < text.length;) {
    const c = text[i];
    if (c === '`') i += 2;
    else if (c === "'") i = skipPowerShellSingle(text, i + 1).i;
    else if (c === '"') i = skipPowerShellDouble(text, i + 1).i;
    else if (c === '(') { depth += 1; i += 1; }
    else if (c === ')') {
      depth -= 1;
      i += 1;
      if (!depth) return i;
    } else i += 1;
  }
  readOpen = true;
  return i;
}

// A single-quoted PowerShell string ('' is one quote).
function skipPowerShellSingle(text, i) {
  let part = '';
  while (i < text.length) {
    if (text[i] === "'" && text[i + 1] === "'") { part += "'"; i += 2; }
    else if (text[i] === "'") return { i: i + 1, part };
    else { part += text[i]; i += 1; }
  }
  readOpen = true;
  return { i, part };
}

// A double-quoted PowerShell string: a backtick escapes the next character, "" is one quote, $(...) is skipped.
function skipPowerShellDouble(text, i) {
  let part = '';
  while (i < text.length) {
    if (text[i] === '`') { part += text[i + 1] || ''; i += 2; }
    else if (text[i] === '"' && text[i + 1] === '"') { part += '"'; i += 2; }
    else if (text[i] === '"') return { i: i + 1, part };
    else if (text.startsWith('$(', i)) { part += '_'; i = skipPowerShellSub(text, i + 2); }
    else { part += text[i]; i += 1; }
  }
  readOpen = true;
  return { i, part };
}

// PowerShell: the command's segments (split at ; & | ( ) { } and newlines outside quotes), each a list of words.
function powerShellSegments(text) {
  const read = wordReader();
  const separators = new Set([...SEPARATORS, '{', '}']);
  for (let i = 0; i < text.length;) {
    const c = text[i];
    const hereString = (c === '@' && (text[i + 1] === "'" || text[i + 1] === '"')) ? text.slice(i + 2).match(/^[ \t]*\r?\n/) : null;
    if (BLANKS.has(c)) { read.endWord(); i += 1; }
    else if (hereString) {
      // A here-string runs to a line that starts with its closing quote and @.
      const close = new RegExp(`\\n${text[i + 1]}@`).exec(text.slice(i));
      read.add('_');
      if (close) i += close.index + 3;
      else { readOpen = true; i = text.length; }
    } else if (c === '`') {
      const next = text[i + 1];
      if (next === '\r' && text[i + 2] === '\n') i += 3;
      else {
        if (next !== '\n') read.add(next || '');
        i += 2;
      }
    } else if (c === "'") {
      const single = skipPowerShellSingle(text, i + 1);
      read.add(single.part);
      i = single.i;
    } else if (c === '"') {
      const double = skipPowerShellDouble(text, i + 1);
      read.add(double.part);
      i = double.i;
    } else if (text.startsWith('<#', i)) {
      const end = text.indexOf('#>', i + 2);
      if (end === -1) readOpen = true;
      i = end === -1 ? text.length : end + 2;
    } else if (c === '#' && !read.wordStarted()) {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
    } else if (c === '>') {
      read.redirect(/^[1-6*]$/);
      i += text[i + 1] === '>' ? 2 : 1;
      if (text[i] === '&' && /\d/.test(text[i + 1] || '')) i += 2;
      else read.dropTarget();
    } else if (c === '$' && text[i + 1] === '(') { read.endSegment(); i += 2; }
    else if (separators.has(c)) { read.endSegment(); i += 1; }
    else { read.add(c); i += 1; }
  }
  read.endSegment();
  return read.segments;
}

// The segments of a command for the given shell tool, and whether the reader ran out of input before a closer.
function shellSegments(text, tool = 'Bash') {
  readOpen = false;
  try {
    const segments = tool === 'PowerShell' ? powerShellSegments(text) : bashSegments(text);
    return { segments, open: readOpen };
  } catch {
    // Nesting too deep for the reader: treated as open.
    return { segments: [], open: true };
  }
}

// Options of the merge command that take a value (text, a file or a repository), never the PR to merge.
const MERGE_VALUE_LONG = new Set(['--body', '--body-file', '--subject', '--author-email', '--match-head-commit', '--repo']);
const MERGE_VALUE_SHORT = 'bFtAR';
// Words that may come before a command in bash: compound command keywords, a group and timing.
const COMMAND_PREFIXES = new Set(['{', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time']);

// The PR a selector names (628, #628 or a pull URL), or null for a branch name or nothing.
function selectorNumber(selector) {
  if (typeof selector !== 'string') return null;
  const number = selector.match(/^#?(\d+)$/) || selector.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return number ? number[1] : null;
}

// The first argument of the gh merge command that is not an option or an option's value.
function prMergeNumber(args) {
  for (let k = 0; k < args.length; k += 1) {
    const arg = args[k];
    // An empty argument makes gh refuse the call, so the next one is read: the stricter reading.
    if (arg === '') continue;
    if (arg === '--') return selectorNumber(args[k + 1]);
    if (arg.startsWith('--')) {
      if (MERGE_VALUE_LONG.has(arg) && !arg.includes('=')) k += 1;
      continue;
    }
    if (arg.length > 1 && arg.startsWith('-')) {
      // A short flag group: a value flag takes the rest of the word, or the next word when it ends the group.
      const at = [...arg.slice(1)].findIndex(flag => MERGE_VALUE_SHORT.includes(flag));
      if (at === arg.length - 2) k += 1;
      continue;
    }
    return selectorNumber(arg);
  }
  return null;
}

// A gh api PUT to .../pulls/<n>/merge, as { number } (null when the PR is not a plain number, such as $PR), or null.
function apiMerge(args) {
  let method = '';
  let pull = null;
  for (let k = 0; k < args.length; k += 1) {
    const arg = args[k];
    if (arg === '-X' || arg === '--method') method = args[(k += 1)] || '';
    else if (/^(?:-X=?|--method=)./.test(arg)) method = arg.replace(/^(?:-X=?|--method=)/, '');
    else pull = pull ?? arg.match(/(?:^|\/)pulls\/([^/\s]+)\/merge\/?(?:\?|$)/)?.[1] ?? null;
  }
  if (!/^put$/i.test(method) || pull === null) return null;
  return { number: /^\d+$/.test(pull) ? pull : null };
}

// Every PR a shell command or merge tool merges, as a list of { number } (null when a merge names none), or null when
// the call merges no PR. Only a command at the start of a shell segment (after compound keywords) counts.
function mergeTargets(tool, toolInput) {
  if (MERGE_TOOL.test(tool)) {
    const number = String(toolInput?.pull_number ?? toolInput?.pullNumber ?? '');
    return [{ number: /^\d+$/.test(number) ? number : null }];
  }
  if (!SHELL_TOOL.test(tool)) return null;
  const command = textOf(toolInput?.command);
  const { segments, open } = shellSegments(command, tool);
  const targets = [];
  for (const words of segments) {
    let start = 0;
    while (COMMAND_PREFIXES.has(words[start])) start += words[start] === 'time' && words[start + 1] === '-p' ? 2 : 1;
    if (words[start] !== 'gh') continue;
    if (words[start + 1] === 'pr' && words[start + 2] === 'merge') targets.push({ number: prMergeNumber(words.slice(start + 3)) });
    else if (words[start + 1] === 'api') {
      const target = apiMerge(words.slice(start + 2));
      if (target) targets.push(target);
    }
  }
  // A read that could not finish fails toward checking when the text mentions a gh merge.
  const gh = open ? command.search(/\bgh\b/) : -1;
  if (gh !== -1 && /\bmerge/.test(command.slice(gh)) && !targets.some(target => target.number === null)) targets.push({ number: null });
  return targets.length ? targets : null;
}

// The first PR a call merges, or null.
function mergeTarget(tool, toolInput) {
  return mergeTargets(tool, toolInput)?.[0] ?? null;
}

// The PR word, then the number alone or in a list ("PR 628", "PRs 627 and 628"), or a /pull/<n> link. A bare #<n> is
// not read as a PR, since it may be an issue, and the number never matches inside a longer one.
function namesPr(line, number) {
  if (number === null) return true;
  const list = String.raw`(?:\d+\s*(?:,(?:\s*(?:and|or))?|&|\/|and|or)\s*#?)*`;
  return new RegExp(String.raw`\b(?:PRs?|pull requests?)\s*(?:[:(]\s*)?#?${list}${number}(?!\d)|/pull/${number}(?!\d)`, 'i').test(line);
}

// One line of an own post, outside code, says "external effects" and names the PR.
function summarised(target, posts) {
  return [...posts.values()].some(({ text }) => lineSplit(withoutCode(text.replace(/\r\n?/g, '\n')))
    .some(line => /\bexternal effects?\b/i.test(line) && namesPr(line, target.number)));
}

function mergeIssue(target, posts) {
  if (summarised(target, posts)) return '';
  const pr = target.number === null ? 'this PR' : `PR ${target.number}`;
  return `Toolkit Projects rule: before every merge, post a short summary of the merge's external effects (what changes on the user's machines, hooks, rules, setup defaults and other repos) with the diff link, and merge only after the user's OK. None of your posts names the external effects of ${pr} yet: add them to your running post on one line that says "external effects" and names ${pr}, then merge.`;
}

function decide(input, readLines = file => fs.readFileSync(file, 'utf8').split('\n')) {
  const tool = String(input?.tool_name || '');
  const post = tool === POST_TOOL || tool === EDIT_TOOL;
  const merge = post ? null : mergeTargets(tool, input?.tool_input);
  if (!post && !merge) return '';
  if (typeof input.transcript_path !== 'string' || !input.transcript_path) return '';
  let lines;
  try { lines = readLines(input.transcript_path); } catch { return ''; }
  const { running, projects, posts } = readTranscript(lines);
  if (merge) {
    if (!projects) return '';
    for (const target of merge) {
      const issue = mergeIssue(target, posts);
      if (issue) return issue;
    }
    return '';
  }
  const text = input?.tool_input?.text;
  const wording = wordingIssue(text);
  if (wording) return `Toolkit Projects rule: post wording. Rewrite the post: ${wording}`;
  // Replies under a post, and edits of a post this transcript never shows, keep only the wording rules.
  const known = tool === EDIT_TOOL ? posts.get(input.tool_input?.message_id) : null;
  const topLevel = tool === POST_TOOL ? !input.tool_input?.thread_id : known?.reply === false;
  // The owner wrote after this post: anything an edit adds or changes would sit above the owner's message.
  if (topLevel && known?.ownerAfter) {
    return 'Toolkit Projects rule: post fresh: the owner wrote since this post. An edit would put your answer above the owner\'s message, so send it with post_message as a new post.';
  }
  if (topLevel) {
    const layout = layoutIssue(text) || (known ? editIssue(known.text, text) : '');
    if (layout) return `Toolkit Projects rule: post layout (a **Now:** line, **[HH:MM] Update:** one-liners, linked **Waiting on you** items, the **ELI5:** line last). Rewrite the post: ${layout}`;
  }
  if (tool !== POST_TOOL || input.tool_input?.thread_id || !running || running.size >= NEAR_LIMIT_BYTES) return '';
  return `Toolkit Projects rule: one running post. The owner has not written since your post ${running.id}, so edit it with edit_message instead: keep its full text and append a line starting **[HH:MM] Update:** in the owner's local time. Post fresh only after the owner writes, or once the running post nears 8 KB.`;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
  catch { return 0; }
  let reason;
  try { reason = decide(input); }
  catch { return 0; }
  if (!reason) return 0;
  const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.stderr.write(`${reason}\n`);
  return 2;
}

if (require.main === module) process.exitCode = main();

module.exports = { decide, hasLink, wordingIssue, layoutIssue, editIssue, mergeTarget, mergeTargets, readTranscript, NEAR_LIMIT_BYTES };
