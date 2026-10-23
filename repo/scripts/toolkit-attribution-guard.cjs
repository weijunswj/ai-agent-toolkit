'use strict';

// Refuses shell commands that would put AI attribution into a commit or a pull request: a
// Co-Authored-By trailer naming Claude or Anthropic, a Claude-Session trailer, a claude.ai session
// link, or a "Generated with Claude Code" footer. It looks only at `git commit` and `gh pr create` /
// `gh pr edit` / `gh pr merge`, in the command text and in a message or body file the command names. Ordinary text
// that merely mentions Claude passes. Used by the Claude Code PreToolUse hook and the Codex helper hook.

const fs = require('node:fs');
const path = require('node:path');

const MESSAGE = 'Remove the AI attribution lines (Co-Authored-By or Claude-Session trailers, claude.ai session links, "Generated with" footers) and retry.';
const ATTRIBUTION_PATTERNS = Object.freeze([
  /Co-Authored-By:[^\n]*(?:Claude|anthropic\.com)/i,
  /Claude-Session:/i,
  /https?:\/\/claude\.ai\/(?:code\/)?(?:session|chat)[^\s"'`)]*/i,
  /Generated with \[?Claude Code/i
]);
const COMMIT_OR_PR = /\bgit\b[^\n;&|]*\bcommit\b|\bgh\s+pr\s+(?:create|edit|merge)\b/;
// -F <file>, -F<file>, --file <file>, --file=<file>, --body-file <file>, --body-file=<file>
const FILE_OPTIONS = /(?:^|\s)(?:-F(?:=|\s+)?|--file(?:=|\s+)|--body-file(?:=|\s+))("[^"]+"|'[^']+'|[^\s"']+)/g;
// Separate commands in one line: each is checked against its own folder.
const COMMAND_SEPARATORS = /&&|\|\||[;|\n]/;
const MAX_FILE_BYTES = 1024 * 1024;

function hasAttribution(text) {
  return ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(String(text || '')));
}

// The message or body files a command names, resolved against the command's working folder.
// git [global options] -C <dir> ...: the folder message files in that git command are relative to.
// Reads the words after `git` up to the subcommand; -c takes a value, other options do not.
function gitDirectory(segment) {
  const words = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const start = words.findIndex((word) => /(?:^|[\\/])git(?:\.exe)?$/i.test(word));
  if (start === -1) return '';
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '-C') return (words[index + 1] || '').replace(/^["']|["']$/g, '');
    if (word === '-c') { index += 1; continue; }
    if (!word.startsWith('-')) return '';
  }
  return '';
}

function namedFiles(command, cwd) {
  const files = [];
  const root = cwd || process.cwd();
  for (const segment of String(command).split(COMMAND_SEPARATORS)) {
    const gitDir = gitDirectory(segment);
    const base = gitDir ? path.resolve(root, gitDir) : root;
    for (const match of segment.matchAll(FILE_OPTIONS)) {
      const raw = match[1].replace(/^["']|["']$/g, '');
      if (raw === '-') continue;
      files.push(path.resolve(base, raw));
    }
  }
  return files;
}

function readSmallFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

// Returns the refusal reason, or '' when the command may run.
function attributionRefusal(command, cwd) {
  const text = String(command || '');
  if (!COMMIT_OR_PR.test(text)) return '';
  if (hasAttribution(text)) return MESSAGE;
  for (const file of namedFiles(text, cwd)) if (hasAttribution(readSmallFile(file))) return MESSAGE;
  return '';
}

// A PreToolUse decision for a shell tool call, in the shape Claude Code and Codex both read.
function attributionDecision(input) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') return {};
  const reason = attributionRefusal(command, input?.cwd);
  return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : {};
}

module.exports = Object.freeze({ MESSAGE, attributionDecision, attributionRefusal, hasAttribution });
