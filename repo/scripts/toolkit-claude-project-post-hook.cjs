#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for the Claude Projects post tools (post_message and edit_message) and for PR merges. It
// enforces these rules of the Projects skill from the session's own transcript, so they hold after the context is
// compacted:
// - One running post: the coordinator or a work thread may not start a fresh post while its newest post has no
//   owner message after it, unless that post nears the 8 KB size limit. It must edit the running post instead. A
//   reply under one of its posts (a post with a thread_id) is exempt from this rule and never becomes the running
//   post; the link rule still applies to it.
// - Links: every PR a post names, each number in a list included, must carry a link: link text on that number or a
//   /pull/<n>/files link in the same text. A bare /pull/<n> link outside link text, without /files, is refused with the fix.
// - Wording, on every post and reply: no em-dashes or arrows outside code, and at most one **Question:** block.
// - Layout, on top-level posts of 25 words or more: a **Now:** line first (after an optional "Re: your reply on"
//   line), **[HH:MM] Update:** one-liners with no question or numbered options inside, every item under
//   **Waiting on you** carrying a link, and one **ELI5:** line as the very last line. An edit of an earlier post keeps
//   every one of its Update lines word for word and adds at least one new one.
// - Merge summary: in a Projects session (one that has used the Projects tools), a PR merge (the gh merge command, a
//   gh api PUT to .../pulls/<n>/merge or a merge_pull_request tool) is refused until a line of one of its own posts
//   says "external effects" and names that PR; every merge in a command is checked. The command is read word by word
//   the way the shell reads it (see shellSegments), so quotes, escapes and option values never hide or replace the PR.
//   It is a tripwire on the command text only: curl, GraphQL, wrapper shells, prefixes, aliases, scripts, direct
//   pushes, a variable PR number and a command inside a double-quoted $(...) or backticks are not seen.
// Sessions without these tools (normal chats, Codex and sessions outside Projects) are never touched. Questions go
// on decision cards, a separate tool this hook does not check. Input or a transcript it cannot read passes. The
// hook is registered without `onFailure: "block"` so a hook that cannot start never silences every post.
const fs = require('node:fs');

const POST_TOOL = 'mcp__hearthbot__post_message';
const EDIT_TOOL = 'mcp__hearthbot__edit_message';
const PROJECTS_TOOL = /^mcp__hearthbot__/;
const SHELL_TOOL = /^(?:Bash|PowerShell)$/;
const MERGE_TOOL = /^mcp__.*merge_pull_request$/i;
const NEAR_LIMIT_BYTES = 7000;
const SHORT_POST_WORDS = 25;
const MESSAGE_ID = /\b(cmsg_[A-Za-z0-9]+)\b/;
const UPDATE_LINE = /^\s*(?:[-*]\s+)?\*\*\[\d{1,2}:\d{2}\] Update:\*\*/;
const WAITING_LINE = /^\s*(?:[-*]\s+)?\*\*Waiting on you\b/i;
const ITEM_LINE = /^\s*(?:\d+[.)]|[-*])\s+/;
const NOW_LINE = /^\s*(?:[-*]\s+)?\*\*Now:\*\*/;
const REPLY_LINE = /^\s*Re: your reply on\b/i;
const ELI5_LINE = /^\s*(?:[-*]\s+)?\*\*ELI5:\*\*/;
const LINK = /\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+/;
// Numbered options: a 1 and a 2 in the same style ("1. ... 2.", "1) ... 2)" or "(1) ... (2)").
const OPTION_LISTS = [/(?:^|\s)1\.\s+\S.*\s2\.\s+\S/, /(?:^|\s)1\)\s+\S.*\s2\)\s+\S/, /\(1\)\s+\S.*\(2\)\s+\S/];

// An owner message counts unless it sits inside one of the quoting tags below (a message, note, citation, relay,
// task notification or another session's output), so an owner tag quoted or forwarded inside one of them never counts.
// The runtime also escapes "<" in message text, so a quoted tag usually arrives as plain text; this is the second line
// of defence. Any other wrapper (wake, project, thread or a newer one) is accepted, so a change in the wake's outer
// shape cannot silently stop owner messages from counting.
const QUOTE_TAGS = new Set([
  'message', 'note', 'cited', 'relay', 'coordinator-relay',
  'cross-session-message', 'task-notification', 'child-session-output', 'project_claude_message',
]);
function hasOwnerMessage(text) {
  const open = [];
  for (const tag of text.matchAll(/<(\/?)([A-Za-z][\w-]*)\b([^<>]*?)(\/?)>/g)) {
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at !== -1) open.length = at;
      continue;
    }
    if (name === 'message' && /\bfrom=["']human["']/.test(attributes) && !open.some(item => QUOTE_TAGS.has(item))) return true;
    if (!selfClosing) open.push(name);
  }
  return false;
}

function textOf(text) {
  return typeof text === 'string' ? text : '';
}

function bytes(text) {
  return Buffer.byteLength(textOf(text), 'utf8');
}

// Text the user side of the transcript carries: prompts and wakes, never tool results.
function userText(entry) {
  if (entry?.isMeta || entry?.isCompactSummary) return '';
  let content;
  if (entry?.type === 'attachment' && entry.attachment?.type === 'queued_command') content = entry.attachment.prompt;
  else if (entry?.type === 'user') content = entry.message?.content;
  else return '';
  // A message with an image arrives as blocks: an image block, then the wake as a text block.
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
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
  let projects = false;
  const pending = new Map();
  const posts = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const text = userText(entry);
    if (text && hasOwnerMessage(text)) running = null;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && PROJECTS_TOOL.test(String(block.name))) projects = true;
      if (entry.type === 'assistant' && block?.type === 'tool_use' && (block.name === POST_TOOL || block.name === EDIT_TOOL)) {
        pending.set(block.id, { name: block.name, input: block.input || {} });
      } else if (entry.type === 'user' && block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const call = pending.get(block.tool_use_id);
        pending.delete(block.tool_use_id);
        if (block.is_error) continue;
        if (call.name === POST_TOOL) {
          const id = resultText(block).match(MESSAGE_ID)?.[1];
          if (id) posts.set(id, { text: textOf(call.input.text), reply: Boolean(call.input.thread_id) });
          if (id && !call.input.thread_id) running = { id, size: bytes(call.input.text) };
        } else if (typeof call.input.message_id === 'string') {
          const known = posts.get(call.input.message_id);
          posts.set(call.input.message_id, { text: textOf(call.input.text), reply: known ? known.reply : null });
          if (running && call.input.message_id === running.id) running.size = bytes(call.input.text);
        }
      }
    }
  }
  return { running, projects, posts };
}

// Blanks code (a fence of ``` or ~~~ at the start of a line, running to its closing fence or the end, and inline spans)
// so a PR number or an arrow inside it is not read.
function withoutCode(text) {
  return text.replace(/(^|\n)[ \t]{0,3}(```|~~~)[\s\S]*?(?:\n[ \t]{0,3}\2[^\n]*|$)|`[^`\n]*`/g, match => match.replace(/[^\n]/g, ' '));
}

function linkIssue(text) {
  if (typeof text !== 'string' || !text) return '';
  const plain = withoutCode(text);
  // Link markup is blanked for the scan (same offsets), so "PRs [612](...) and 613" reads as one list.
  const linkTexts = [];
  const scan = plain.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, url, offset) => {
    linkTexts.push([offset, offset + label.length + 1]);
    return ` ${label} ${' '.repeat(url.length + 2)}`;
  });
  const insideLinkText = index => linkTexts.some(([start, end]) => index > start && index < end);
  // A mention names one PR or a list ("PRs 612, 613 and 614"); each number in it needs a link: link text on that
  // number in any mention, or a /pull/<n>/files link anywhere in the post.
  // A one- or two-digit number later in a list, followed by others, more, left, checks, files or tests, is read as a
  // count and not checked; any number right after the PR word (as in "a PR (3 files)") is read as a PR and refused.
  const mentions = [];
  for (const match of scan.matchAll(/\b(?:PRs?|pull requests?)\s*(?:[:(]\s*)?#?(\d{1,6}(?:\s*(?:,(?:\s*(?:and|or))?|&|\/|and|or)\s*#?\d{1,6}\b(?!(?<!\d{3})\s+(?:others|more|left|checks|files|tests)\b))*)\b/gi)) {
    const listStart = match.index + match[0].length - match[1].length;
    for (const number of match[1].matchAll(/\d{1,6}/g)) {
      mentions.push({ match, value: number[0], linked: insideLinkText(listStart + number.index) });
    }
  }
  const linkedNumbers = new Set(mentions.filter(mention => mention.linked).map(mention => mention.value));
  for (const { match, value } of mentions) {
    if (linkedNumbers.has(value)) continue;
    if (new RegExp(`/pull/${value}/files\\b`).test(plain)) continue;
    if (new RegExp(`/pull/${value}\\b`).test(plain)) {
      return `PR ${value} is linked without /files. Link it as https://github.com/<owner>/<repo>/pull/${value}/files when it is ready for the owner to check and merge, otherwise link the chat thread that owns the work.`;
    }
    return `PR ${value} in "${match[0].replace(/\s+/g, ' ').trim()}" has no link. Put the link on it: [PR ${value}](https://github.com/<owner>/<repo>/pull/${value}/files) when it is ready for the owner to check and merge, otherwise [PR ${value}](#<thread id>) to the chat thread that owns the work.`;
  }
  return '';
}

const EM_DASH = String.fromCharCode(0x2014);
const ARROW = String.fromCharCode(0x2192);

// Em-dashes, arrows and more than one Question block, outside code and HTML comments.
function wordingIssue(text) {
  const plain = withoutCode(textOf(text)).replace(/<!--[\s\S]*?-->/g, ' ');
  if (plain.includes(EM_DASH)) return 'it has an em-dash. Use a comma, a colon or a full stop instead.';
  if (plain.includes('->') || plain.includes(ARROW)) return 'it has an arrow. Say it in words ("then", "so", "leads to") instead.';
  if ((plain.match(/\*\*Question:\*\*/g) || []).length > 1) return 'it has more than one **Question:**. Ask one question per post, and put the others on decision cards in the threads that own them.';
  return '';
}

function lineList(text) {
  return withoutCode(textOf(text)).split(/\r?\n/).filter(line => line.trim());
}

function updateLines(text) {
  return lineList(text).filter(line => UPDATE_LINE.test(line)).map(line => line.trim().replace(/^[-*]\s+/, ''));
}

// The approved post layout. Short posts (under 25 words, with no Update or Waiting on you line) are exempt.
function layoutIssue(text) {
  const lines = lineList(text);
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const updates = lines.filter(line => UPDATE_LINE.test(line));
  const waiting = lines.findIndex(line => WAITING_LINE.test(line));
  if (words < SHORT_POST_WORDS && !updates.length && waiting === -1) return '';
  const first = REPLY_LINE.test(lines[0]) ? lines[1] : lines[0];
  if (!first || !NOW_LINE.test(first)) return 'its first line must start with **Now:** (where things stand now, rewritten on each edit). A "Re: your reply on <topic>" line may come before it.';
  for (const line of updates) {
    const body = line.replace(UPDATE_LINE, '');
    if (/Question:/i.test(body) || OPTION_LISTS.some(list => list.test(body))) {
      return `the Update line "${line.trim().slice(0, 80)}" has a question or numbered options in it. An Update line is one short status sentence; put the question on a decision card and list it under **Waiting on you**.`;
    }
  }
  if (waiting !== -1) {
    for (const line of lines.slice(waiting + 1)) {
      if (!ITEM_LINE.test(line) || UPDATE_LINE.test(line) || ELI5_LINE.test(line)) break;
      if (!LINK.test(line)) return `the Waiting on you item "${line.trim().slice(0, 80)}" has no link. Link each item to the card or thread where the owner acts, so it is one tap away.`;
    }
  }
  const eli5 = lines.filter(line => ELI5_LINE.test(line)).length;
  const last = textOf(text).split(/\r?\n/).filter(line => line.trim()).pop();
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

// Shell reading. The merge check reads a command as the shell does, word by word, rather than rewriting its text:
// quotes and escapes are removed and their pieces join into one word (so an empty quote touching a word adds
// nothing, and a quoted option value stays that option's one value), separators inside quotes are text, comments,
// heredoc bodies and $((...)) are skipped, and a $(...) or backtick command inside double quotes is skipped as text.
// Every pass moves forward only, so it runs in linear time.
const SEPARATORS = new Set([';', '&', '|', '(', ')', '\n', '\r']);
const BLANKS = new Set([' ', '\t']);

function skipSingle(text, i) {
  const end = text.indexOf("'", i);
  return end === -1 ? text.length : end + 1;
}

function skipAnsi(text, i) {
  while (i < text.length && text[i] !== "'") i += text[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, text.length);
}

function skipBacktick(text, i) {
  while (i < text.length && text[i] !== '`') i += text[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, text.length);
}

function skipArith(text, i) {
  for (let depth = 2; i < text.length && depth > 0; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
  }
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
    while (i < text.length) {
      const newline = text.indexOf('\n', i);
      const end = newline === -1 ? text.length : newline;
      const line = text.slice(i, end).replace(/\r$/, '');
      i = end + 1;
      if ((strip ? line.replace(/^\t+/, '') : line) === tag) break;
    }
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
  return i;
}

// The command's segments (split at ; & | ( ) and newlines outside quotes), each a list of words.
function shellSegments(text) {
  const segments = [];
  const pending = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const add = part => { word = (word ?? '') + part; };
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (BLANKS.has(c)) { endWord(); i += 1; }
    else if (c === '\\') {
      if (text[i + 1] !== '\n') add(text[i + 1] || '');
      i += 2;
    } else if (c === "'") {
      const end = skipSingle(text, i + 1);
      add(text.slice(i + 1, text[end - 1] === "'" ? end - 1 : end));
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
      add(part);
      i += 1;
    } else if (text.startsWith("$'", i)) {
      const end = skipAnsi(text, i + 2);
      add(text.slice(i + 2, text[end - 1] === "'" ? end - 1 : end).replace(/\\([\s\S])/g, '$1'));
      i = end;
    } else if (text.startsWith('$((', i)) { add('_'); i = skipArith(text, i + 3); }
    else if (c === '`') { add('_'); i = skipBacktick(text, i + 1); }
    else if (c === '#' && word === null) {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
    } else if (text.startsWith('<<<', i)) { endWord(); i += 3; }
    else if (text.startsWith('<<', i)) {
      endWord();
      const read = readDelimiter(text, i + 2);
      if (read.heredoc) pending.push(read.heredoc);
      i = read.i;
    } else if (c === '\n') {
      endSegment();
      i = skipHeredocs(text, i + 1, pending);
    } else if (c === '$' && text[i + 1] === '(') { endSegment(); i += 2; }
    else if (SEPARATORS.has(c)) { endSegment(); i += 1; }
    else if (c === '<' || c === '>') { endWord(); i += 1; }
    else { add(c); i += 1; }
  }
  endSegment();
  return segments;
}

// Options of the merge command that take a value (text, a file or a repository), never the PR to merge.
const MERGE_VALUE_LONG = new Set(['--body', '--body-file', '--subject', '--author-email', '--match-head-commit', '--repo']);
const MERGE_VALUE_SHORT = 'bFtAR';

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

// The PR a gh api call merges: a PUT to .../pulls/<n>/merge, or null.
function apiMergeNumber(args) {
  let method = '';
  let number = null;
  for (let k = 0; k < args.length; k += 1) {
    const arg = args[k];
    if (arg === '-X' || arg === '--method') method = args[(k += 1)] || '';
    else if (/^(?:-X=?|--method=)./.test(arg)) method = arg.replace(/^(?:-X=?|--method=)/, '');
    else number = number ?? arg.match(/(?:^|\/)pulls\/(\d+)\/merge\/?(?:\?|$)/)?.[1] ?? null;
  }
  return /^put$/i.test(method) && number ? number : null;
}

// Every PR a shell command or merge tool merges, as a list of { number } (null when a merge names none), or null when
// the call merges no PR. Only a command at the start of a shell segment counts.
function mergeTargets(tool, toolInput) {
  if (MERGE_TOOL.test(tool)) {
    const number = String(toolInput?.pull_number ?? toolInput?.pullNumber ?? '');
    return [{ number: /^\d+$/.test(number) ? number : null }];
  }
  if (!SHELL_TOOL.test(tool)) return null;
  const targets = [];
  for (const words of shellSegments(textOf(toolInput?.command))) {
    if (words[0] !== 'gh') continue;
    if (words[1] === 'pr' && words[2] === 'merge') targets.push({ number: prMergeNumber(words.slice(3)) });
    else if (words[1] === 'api') {
      const number = apiMergeNumber(words.slice(2));
      if (number) targets.push({ number });
    }
  }
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
  return [...posts.values()].some(({ text }) => withoutCode(text).split(/\r?\n/)
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
  const issue = linkIssue(text);
  if (issue) return `Toolkit Projects rule: every PR, thread, file or artifact you mention to the owner carries its link. ${issue}`;
  const wording = wordingIssue(text);
  if (wording) return `Toolkit Projects rule: post wording. Rewrite the post: ${wording}`;
  // Replies under a post, and edits of a post this transcript never shows, keep only the wording and link rules.
  const known = tool === EDIT_TOOL ? posts.get(input.tool_input?.message_id) : null;
  const topLevel = tool === POST_TOOL ? !input.tool_input?.thread_id : known?.reply === false;
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

module.exports = { decide, linkIssue, wordingIssue, layoutIssue, editIssue, mergeTarget, mergeTargets, readTranscript, NEAR_LIMIT_BYTES };
