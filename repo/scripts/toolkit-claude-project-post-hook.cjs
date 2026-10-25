#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for the Claude Projects post tools (post_message and edit_message). It enforces two
// rules of the Projects skill from the session's own transcript, so they hold after the context is compacted:
// - One running post: the coordinator or a work thread may not start a fresh post while its newest post has no
//   owner message after it, unless that post nears the 8 KB size limit. It must edit the running post instead. A reply under one
//   of its posts (a post with a thread_id) is neither checked nor counted.
// - Links: every "PR <n>" a post names must carry a link, either inside the link text or by a /pull/<n>/files
//   link in the same text. A bare /pull/<n> link without /files is refused with the fix.
// Sessions without these tools (local and CLI sessions) are never touched. Questions go on decision cards, a
// separate tool this hook does not check. Input or a transcript it cannot read passes. The hook is registered without `onFailure: "block"` so a hook that cannot start
// never silences every post.
const fs = require('node:fs');

const POST_TOOL = 'mcp__hearthbot__post_message';
const EDIT_TOOL = 'mcp__hearthbot__edit_message';
const NEAR_LIMIT_BYTES = 7000;
const OWNER_MESSAGE = /<message\b[^>]*\bfrom=["']human["']/;
const MESSAGE_ID = /\b(cmsg_[A-Za-z0-9]+)\b/;

function bytes(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8');
}

// Text the user side of the transcript carries: prompts and wakes, never tool results.
function userText(entry) {
  if (entry?.type === 'attachment' && entry.attachment?.type === 'queued_command') {
    return typeof entry.attachment.prompt === 'string' ? entry.attachment.prompt : '';
  }
  if (entry?.type !== 'user') return '';
  const content = entry.message?.content;
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
// after it), with its current size.
function readTranscript(lines) {
  let running = null;
  const pending = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const text = userText(entry);
    if (text && OWNER_MESSAGE.test(text)) running = null;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && (block.name === POST_TOOL || block.name === EDIT_TOOL)) {
        pending.set(block.id, { name: block.name, input: block.input || {} });
      } else if (entry.type === 'user' && block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const call = pending.get(block.tool_use_id);
        pending.delete(block.tool_use_id);
        if (block.is_error) continue;
        if (call.name === POST_TOOL) {
          const id = resultText(block).match(MESSAGE_ID)?.[1];
          if (id && !call.input.thread_id) running = { id, size: bytes(call.input.text) };
        } else if (running && call.input.message_id === running.id) {
          running.size = bytes(call.input.text);
        }
      }
    }
  }
  return { running };
}

// Blanks code spans so a PR number inside backticks is not read as a mention.
function withoutCode(text) {
  return text.replace(/```[\s\S]*?```|`[^`\n]*`/g, match => ' '.repeat(match.length));
}

function linkIssue(text) {
  if (typeof text !== 'string' || !text) return '';
  const plain = withoutCode(text);
  const linkTexts = [];
  for (const match of plain.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) linkTexts.push([match.index, match.index + match[1].length + 1]);
  for (const match of plain.matchAll(/\b(?:PRs?|pull request)\s*#?(\d{1,6})\b/gi)) {
    const number = match[1];
    if (linkTexts.some(([start, end]) => match.index > start && match.index < end)) continue;
    if (new RegExp(`/pull/${number}/files\\b`).test(plain)) continue;
    if (new RegExp(`/pull/${number}\\b`).test(plain)) {
      return `PR ${number} is linked without /files. Link it as https://github.com/<owner>/<repo>/pull/${number}/files when it is ready for the owner to check and merge, otherwise link the chat thread that owns the work.`;
    }
    return `"${match[0].trim()}" has no link. Put the link on it: [PR ${number}](https://github.com/<owner>/<repo>/pull/${number}/files) when it is ready for the owner to check and merge, otherwise [PR ${number}](#<thread id>) to the chat thread that owns the work.`;
  }
  return '';
}

function decide(input, readLines = file => fs.readFileSync(file, 'utf8').split('\n')) {
  const tool = input?.tool_name;
  if (tool !== POST_TOOL && tool !== EDIT_TOOL) return '';
  if (typeof input.transcript_path !== 'string' || !input.transcript_path) return '';
  let lines;
  try { lines = readLines(input.transcript_path); } catch { return ''; }
  const { running } = readTranscript(lines);
  const issue = linkIssue(input?.tool_input?.text);
  if (issue) return `Toolkit Projects rule: every PR, thread, file or artifact you mention to the owner carries its link. ${issue}`;
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

module.exports = { decide, linkIssue, readTranscript, NEAR_LIMIT_BYTES };
