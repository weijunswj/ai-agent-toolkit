#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for the Claude Projects post tools (post_message and edit_message). It
// enforces these rules of the Projects skill from the session's own transcript, so they hold after the context is
// compacted:
// - One running post: the coordinator or a work thread may not start a fresh post while its newest post has no
//   owner message after it, unless that post nears the 8 KB size limit. It must edit the running post instead. A
//   reply under one of its posts (a post with a thread_id) is exempt from this rule and never becomes the running
//   post; the wording rules still apply to it. Beside a running post, two new posts still pass: a one-line
//   "Gate: ..." anchor, which never becomes the running post, and a post starting "Re: your reply on" once an owner
//   message has arrived since the running post anywhere (a work thread or a reply included).
// - Edit the running post only: while a running post is known, an edit of any other post (an older one, an anchor or
//   one this session never saw) is refused and names the running post. Edits of replies stay exempt.
// - The project memory line: a session with no top-level post of its own and no owner message in the chat yet takes
//   the running post from the newest `RUNNING POST: cmsg_...` line it read with read_memory or wrote with
//   update_memory, so a new coordinator session after a handoff edits that post. Its size is unknown until a chat read
//   shows its body or an edit sets it, so it counts as under the limit.
// - The project chat's newest message: the hook cannot read the chat, so it uses the session's own reads of it. When
//   a read of the project chat reaches the last page, its newest top-level message (passing over cards such as
//   thread starts, routing and activity, and gate anchors) decides: the coordinator's own post becomes the running
//   post, even one an earlier session wrote, unless an owner message this session saw (by its sent-at time) came
//   after it; an owner message there counts as the owner writing. Any page, last or not, that shows the memory post
//   gives its size and time, and an owner message newer than it counts as the owner writing. A work-thread session
//   (one started by a spawn relay, or whose posts land in a thread) skips these reads, since its posts go to its
//   thread and not the chat.
// - Owner messages in the coordinator: an owner wake counts as the owner writing in the main chat unless its thread is
//   a work thread the session knows (from its thread launches, thread listings or a thread-start card in a chat
//   read). An unknown thread still counts, so a misread fails the way the hook worked before.
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
// - Forwarded owner messages: an owner message the coordinator forwards into a work thread arrives as the server's
//   citation inside a relay, and the thread shows it below its posts, so in a work thread it counts as the owner
//   writing there. In the coordinator, only a citation of an owner message in the main project chat counts, and only
//   for its posts from before that message. Each owner message counts once by its id, however often it is queued,
//   delivered, cited or read in the chat.
// Other tools, and so normal chats, Codex and sessions outside Projects, are never touched. Decision cards
// are a separate tool this hook does not check. Input or a transcript it cannot read passes. The
// hook is registered without `onFailure: "block"` so a hook that cannot start never silences every post.
const fs = require('node:fs');

const POST_TOOL = 'mcp__hearthbot__post_message';
const EDIT_TOOL = 'mcp__hearthbot__edit_message';
const CHAT_READ_TOOL = 'mcp__hearthbot__read_project_chat';
const READ_MEMORY = 'mcp__hearthbot__read_memory';
const UPDATE_MEMORY = 'mcp__hearthbot__update_memory';
const START_THREAD = 'mcp__hearthbot__start_thread';
const LIST_THREADS = 'mcp__hearthbot__list_threads';
const TRACKED_TOOLS = new Set([POST_TOOL, EDIT_TOOL, CHAT_READ_TOOL, READ_MEMORY, UPDATE_MEMORY, START_THREAD, LIST_THREADS]);
// A thread id in a thread launch or thread listing result.
const THREAD_ID_FIELD = /"(?:thread_id|id|ts)"\s*:\s*"(cmsg_[A-Za-z0-9]+)"/g;
// The project memory line naming the running post: the label after an optional bullet, quote, number or heading,
// plain, bold or in backticks, then the message id. Prose that only mentions the label is not a line.
const RUNNING_LINE = /^\s*(?:[-*>]\s*|\d+[.)]\s+|#{1,6}\s+)?`?(?:\*\*)?RUNNING POST:(?:\*\*)?\s*`?(cmsg_[A-Za-z0-9]+)\b/;
// A one-line gate anchor post, as in "Gate: G1 started for PR 700".
const ANCHOR_LINE = /^\s*(?:\*\*)?Gate:(?:\*\*)?\s*\S/i;
const SPAWN_RELAY = /^\s*<relay\b[^<>]*\breason=["']spawn["']/;
// Sorts after every ISO time: an owner message with no sent-at counts as later than any chat post.
const LATEST_TIME = String.fromCharCode(0xffff);
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
// shape cannot silently stop owner messages from counting. The one owner copy inside them that counts is the server's
// citation of an owner message (see RELAY_WRAPPERS); nothing inside that citation counts.
const QUOTE_TAGS = new Set([
  'message', 'note', 'cited', 'relay', 'coordinator-relay',
  'cross-session-message', 'task-notification', 'child-session-output', 'project_claude_message',
]);
// The wrappers a server relay arrives in: <project_claude_message> on a local Remote Control thread, <coordinator-relay>
// in the cloud. A <cited author="user" id="cmsg_..."> directly inside a <relay> that sits only inside these (or in
// none) is the server's copy of an owner message it forwards, so it counts. The server escapes "<" in the
// coordinator's note and in cited bodies, so Claude text cannot build one; a relay inside any other tag is quoted text,
// and a newer wrapper fails toward not counting.
const RELAY_WRAPPERS = new Set(['project_claude_message', 'coordinator-relay']);
const TAG = /<(\/?)([A-Za-z][\w-]*)\b([^<>]*?)(\/?)>/g;
const WHOLE_MESSAGE_ID = /^cmsg_[A-Za-z0-9]+$/;

// The one value of an attribute in a tag, or null when it is missing or given twice ("id" never matches "author-id").
function attribute(attributes, name) {
  const values = [...attributes.matchAll(new RegExp(String.raw`(?:^|\s)${name}=["']([^"']*)["']`, 'g'))];
  return values.length === 1 ? values[0][1] : null;
}

// Returns one entry per owner message: its id (null when not given), the ts of the innermost <thread> around it (null
// outside any thread or for a citation), its time (sent-at, or a citation's at; null when not given) and, for a
// citation, where the owner wrote it (timeline, this-thread or other-thread). Each tag costs constant work, so long
// runs of nested tags stay linear.
function ownerMessages(text) {
  const open = [];
  // Where each tag name sits in `open`, and how many open tags quote or are not relay wrappers.
  const places = new Map();
  let quoting = 0;
  let unwrapped = 0;
  const track = (name, step) => {
    if (QUOTE_TAGS.has(name)) quoting += step;
    if (!RELAY_WRAPPERS.has(name)) unwrapped += step;
  };
  const found = [];
  for (const tag of text.matchAll(TAG)) {
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) {
      const at = places.get(name)?.at(-1);
      while (at !== undefined && open.length > at) {
        const item = open.pop();
        places.get(item.name).pop();
        track(item.name, -1);
      }
      continue;
    }
    if (name === 'message' && /\bfrom=["']human["']/.test(attributes) && quoting === 0) {
      const thread = open[places.get('thread')?.at(-1)];
      const id = attribute(attributes, 'id');
      found.push({
        id: id && WHOLE_MESSAGE_ID.test(id) ? id : null,
        thread: thread ? thread.attributes.match(/\bts=["']([^"']+)["']/)?.[1] || null : null,
        at: attributes.match(/\bsent-at=["']([^"']+)["']/)?.[1] || null,
        where: null,
      });
    } else if (name === 'cited' && open.at(-1)?.name === 'relay' && unwrapped === 1) {
      // Only the relay itself is outside the wrappers, so it is the server's relay, not one quoted in other text.
      const id = attribute(attributes, 'id');
      if (attribute(attributes, 'author') === 'user' && id && WHOLE_MESSAGE_ID.test(id)) {
        found.push({ id, thread: null, at: attribute(attributes, 'at'), where: attribute(attributes, 'where') });
      }
    }
    if (!selfClosing) {
      if (!places.has(name)) places.set(name, []);
      places.get(name).push(open.length);
      open.push({ name, attributes });
      track(name, 1);
    }
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

// The top-level messages of one page of a project chat read, and whether it is the last page, or null. The listing is
// the JSON object in the result; message bodies inside it are escaped strings, so they cannot fake its shape.
function chatPage(text) {
  const start = text.indexOf('{"messages":');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  let listing;
  try { listing = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (typeof listing?.has_more !== 'boolean' || !Array.isArray(listing.messages)) return null;
  return { messages: listing.messages.filter(message => message && typeof message === 'object'), last: !listing.has_more };
}

// A coordinator chat item that is not a status post: a card (thread start, routing, activity, Remote Control or any
// other kind) or a one-line gate anchor. Owner messages are never skipped.
function notStatusPost(message) {
  return message.author !== 'user' && typeof message.body === 'string' && (isCard(message.body) || isAnchor(message.body));
}

// The newest message on the last page, passing over cards and anchors, or null.
function chatNewest(messages) {
  let newest = null;
  for (const message of messages || []) {
    if (notStatusPost(message)) continue;
    if (typeof message.created_at === 'string' && (!newest || message.created_at >= newest.created_at)) newest = message;
  }
  return typeof newest?.id === 'string' && MESSAGE_ID.test(newest.id) ? newest : null;
}

// The running post a project memory text names (the first RUNNING POST line outside code fences), or null. A fence
// may be indented, since read_memory indents every line of the file.
function memoryRunning(text) {
  const unfenced = textOf(text).replace(/(^|\n)[ \t]*(```|~~~)[\s\S]*?(?:\n[ \t]*\2[^\n]*|$)/g, match => match.replace(/[^\n]/g, ' '));
  for (const line of lineSplit(unfenced)) {
    const id = line.match(RUNNING_LINE)?.[1];
    if (id) return id;
  }
  return null;
}

// A one-line Gate: anchor of under 25 words. It never becomes the running post.
function isAnchor(text) {
  const lines = lineSplit(textOf(text)).filter(line => line.trim());
  return lines.length === 1 && ANCHOR_LINE.test(lines[0]) && lines[0].split(/\s+/).filter(Boolean).length < SHORT_POST_WORDS;
}

// Whether a post recorded at `time` came before an owner message sent at `at`; a missing or unreadable time counts as
// before, so the post is closed to edits and the session posts fresh.
function postedBefore(time, at) {
  const posted = Date.parse(time);
  const sent = Date.parse(at);
  return !(posted >= sent);
}

// A card (onboarding, decision, thread start, routing or activity) is a JSON object with a kind, not a post.
function cardKind(body) {
  try {
    const kind = JSON.parse(body)?.kind;
    return typeof kind === 'string' ? kind : null;
  } catch { return null; }
}

function isCard(body) {
  return cardKind(body) !== null;
}

function resultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (!Array.isArray(block.content)) return '';
  return block.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
}

// Walks the transcript and returns the running post (the newest successful top-level post with no owner message
// after it; failing that, the post the project memory names) with its current size, the latest text of each
// successful own post (and whether it is a reply under a post; null when only an edit of it is known), and whether an
// owner message arrived anywhere since the running post.
function readTranscript(lines) {
  let running = null;
  // The newest top-level post, kept after owner messages so a second reply under it is still a reply under it.
  let newest = null;
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
  // Whether an owner message opened the chat in this session, whether the session made a top-level post of its own,
  // and whether any owner message (a work thread's or a reply's included) arrived since the running post was set.
  let chatOwner = false;
  let ownPost = false;
  let ownerSince = false;
  // Work threads this session knows: from its thread launches and listings, and the thread-start cards a chat read
  // shows. An owner message in one of them is not a main-chat message.
  const workThreads = new Set();
  const setRunning = value => {
    running = value;
    newest = value.id;
    ownerSince = false;
  };
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
    chatOwner = true;
  };
  // A citation in the coordinator of an owner chat message it never saw: only its posts from before that message sit
  // above it, and the running post stays open when it came after.
  const ownerWroteBefore = at => {
    for (const post of posts.values()) {
      if (postedBefore(post.time, at)) post.ownerAfter = true;
    }
    const time = at || LATEST_TIME;
    if (ownerAt === null || time > ownerAt) ownerAt = time;
    if (running && posts.get(running.id)?.ownerAfter) running = null;
    chatOwner = true;
  };
  // Owner message ids already counted, so one message counts once however often it is queued, delivered or cited.
  const seen = new Set();
  for (const entry of entries) {
    const owner = ownerMessages(userText(entry)).filter(({ id }) => {
      if (id === null) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    // A work thread shows every owner message forwarded to it below its posts, wherever the owner wrote it. The
    // coordinator posts in the main project chat, so there only an owner message in that chat counts: a wake that is
    // not in a work thread the session knows, or a citation of a chat message. An owner message in a work thread
    // leaves the coordinator's running post open; an unknown thread counts as the chat, as before.
    const wakes = owner.filter(({ where, id, thread }) => (where === null && !(thread !== null && thread !== id && workThreads.has(thread))) || inThread);
    if (wakes.length) ownerWrote(wakes);
    for (const { at } of owner.filter(({ where }) => where === 'timeline' && !inThread)) ownerWroteBefore(at);
    if (owner.length) ownerSince = true;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && TRACKED_TOOLS.has(block.name)) {
        pending.set(block.id, { name: block.name, input: block.input || {} });
      } else if (entry.type === 'user' && block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const call = pending.get(block.tool_use_id);
        pending.delete(block.tool_use_id);
        if (block.is_error) continue;
        if (call.name === READ_MEMORY || call.name === UPDATE_MEMORY) {
          // update_memory replaces the whole file with its one content string; no other field is memory text. The
          // memory line names the running post only for a session that knows none of its own: no own top-level post
          // and no owner message in the chat yet, since either one tells it more than an earlier session's line.
          const id = memoryRunning(call.name === READ_MEMORY ? resultText(block) : textOf(call.input.content));
          if (id && !running && !ownPost && !chatOwner) {
            // Its size is unknown until a chat read shows its body or an edit sets it, so it counts as under the limit.
            setRunning({ id, size: 0, memory: true });
            if (!posts.has(id)) posts.set(id, { text: '', reply: false, ownerAfter: false, time: undefined });
          }
        } else if (call.name === CHAT_READ_TOOL) {
          const listing = inThread ? null : chatPage(resultText(block));
          const messages = listing ? listing.messages : [];
          for (const message of messages) {
            if (message.author !== 'user' && typeof message.body === 'string' && cardKind(message.body)?.startsWith('thread_start')) {
              for (const id of [message.id, message.thread_id]) if (typeof id === 'string' && MESSAGE_ID.test(id)) workThreads.add(id);
            }
          }
          // Any page, not just the last, gives a memory post its real size and time, and shows owner messages after it.
          const shown = running?.memory ? messages.find(message => message.id === running.id) : null;
          if (shown && typeof shown.body === 'string') {
            running.size = bytes(shown.body);
            posts.get(running.id).time = shown.created_at;
          }
          const memoryTime = running?.memory ? posts.get(running.id)?.time : undefined;
          const later = typeof memoryTime === 'string'
            ? messages.filter(message => message.author === 'user' && typeof message.id === 'string' && !seen.has(message.id) && typeof message.created_at === 'string' && message.created_at > memoryTime)
            : [];
          const page = listing?.last ? messages : null;
          const latest = chatNewest(page);
          const fresh = latest?.author === 'user' && !seen.has(latest.id);
          for (const message of messages) {
            if (message.author === 'user' && typeof message.id === 'string') seen.add(message.id);
          }
          if (later.length && !fresh) ownerWrote(later.map(message => ({ thread: null, at: message.created_at })));
          // The owner's top-level message is the newest: it sits below every post, as an owner message in the chat,
          // unless this session already counted it. The coordinator's newest post is the running post only when no
          // owner message seen here (a reply in a thread included) came after it, so it is never both closed to
          // edits and barred from a fresh post.
          if (fresh) ownerWrote([{ thread: null, at: latest.created_at }]);
          // A body near the 8 KB limit may be cut short by the read, so that post is left untracked: a fresh post
          // passes, as for any running post that size, and its edits are never compared with a shortened text.
          else if (latest?.author === 'agent' && typeof latest.body === 'string'
            && bytes(latest.body) < NEAR_LIMIT_BYTES
            && !posts.get(latest.id)?.ownerAfter && (ownerAt === null || ownerAt < latest.created_at)) {
            setRunning({ id: latest.id, size: bytes(latest.body) });
            // Recorded as a top-level post, so a later owner message closes it to edits and its edits are layout-checked.
            posts.set(latest.id, { text: latest.body, reply: false, ownerAfter: false, time: latest.created_at });
          } else if (latest?.author === 'agent' && running?.memory && running.id !== latest.id) {
            // The chat shows a newer post than the memory line names, cut short or closed: the memory line is stale.
            running = null;
          }
        } else if (call.name === START_THREAD || call.name === LIST_THREADS) {
          for (const [, id] of resultText(block).matchAll(THREAD_ID_FIELD)) workThreads.add(id);
        } else if (call.name === POST_TOOL) {
          const id = resultText(block).match(MESSAGE_ID)?.[1];
          const topLevel = id && !call.input.thread_id;
          // The post's time is when its result was recorded.
          if (id) posts.set(id, { text: textOf(call.input.text), reply: Boolean(call.input.thread_id), ownerAfter: false, time: entry.timestamp });
          // A gate anchor sits in the chat but never takes over from the running post.
          if (topLevel && !isAnchor(call.input.text)) {
            ownPost = true;
            setRunning({ id, size: bytes(call.input.text) });
          }
        } else if (typeof call.input.message_id === 'string') {
          const known = posts.get(call.input.message_id);
          posts.set(call.input.message_id, { text: textOf(call.input.text), reply: known ? known.reply : null, ownerAfter: known ? known.ownerAfter : false, time: known?.time });
          if (running && call.input.message_id === running.id) running.size = bytes(call.input.text);
        }
      }
    }
  }
  return { running, posts, ownerSince };
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

// Added to a refusal about a running post known only from the project memory line.
const MEMORY_HINT = ' This post comes from the RUNNING POST line in project memory. If the owner wrote after it, or it nears 8 KB, read the project chat to its last page so this hook sees that, then post again.';

function decide(input, readLines = file => fs.readFileSync(file, 'utf8').split('\n')) {
  const tool = String(input?.tool_name || '');
  if (tool !== POST_TOOL && tool !== EDIT_TOOL) return '';
  if (typeof input.transcript_path !== 'string' || !input.transcript_path) return '';
  let lines;
  try { lines = readLines(input.transcript_path); } catch { return ''; }
  const { running, posts, ownerSince } = readTranscript(lines);
  const text = input?.tool_input?.text;
  const wording = wordingIssue(text);
  if (wording) return `Toolkit Projects rule: post wording. Rewrite the post: ${wording}`;
  // Replies under a post, and edits of a post this transcript never shows, keep only the wording rules.
  const known = tool === EDIT_TOOL ? posts.get(input.tool_input?.message_id) : null;
  const topLevel = tool === POST_TOOL ? !input.tool_input?.thread_id : known?.reply === false;
  // While a running post is known, only it takes edits: an older post, an anchor or a post this session never saw
  // would put the update in the wrong place. Replies under a post stay exempt.
  const target = input.tool_input?.message_id;
  if (tool === EDIT_TOOL && running && target !== running.id && known?.reply !== true) {
    return `Toolkit Projects rule: one running post. Your running post is ${running.id}, so edit that post, not ${typeof target === 'string' ? target : 'this one'}: keep its full text and append a line starting **[HH:MM] Update:** in the owner's local time.${running.memory ? MEMORY_HINT : ''}`;
  }
  // The owner wrote after this post: anything an edit adds or changes would sit above the owner's message.
  if (topLevel && known?.ownerAfter) {
    return 'Toolkit Projects rule: post fresh: the owner wrote since this post. An edit would put your answer above the owner\'s message, so send it with post_message as a new post.';
  }
  if (topLevel) {
    const layout = layoutIssue(text) || (known ? editIssue(known.text, text) : '');
    if (layout) return `Toolkit Projects rule: post layout (a **Now:** line, **[HH:MM] Update:** one-liners, linked **Waiting on you** items, the **ELI5:** line last). Rewrite the post: ${layout}`;
  }
  if (tool !== POST_TOOL || input.tool_input?.thread_id || !running || running.size >= NEAR_LIMIT_BYTES) return '';
  // Two new posts are allowed beside a running post: a one-line gate anchor, and a direct answer ("Re: your reply
  // on ...") to an owner message that arrived since the running post somewhere this session does not count as the
  // chat, such as a work thread or a reply.
  if (isAnchor(text)) return '';
  if (ownerSince && REPLY_LINE.test(lineList(text)[0] || '')) return '';
  return `Toolkit Projects rule: one running post. The owner has not written since your post ${running.id}, so edit it with edit_message instead: keep its full text and append a line starting **[HH:MM] Update:** in the owner's local time. Post fresh only after the owner writes, or once the running post nears 8 KB. A one-line "Gate: ..." anchor may still be posted, and an owner message from a thread or a reply is answered in a fresh post starting "Re: your reply on <topic>".${running.memory ? MEMORY_HINT : ''}`;
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

module.exports = { decide, hasLink, wordingIssue, layoutIssue, editIssue, readTranscript, NEAR_LIMIT_BYTES };
