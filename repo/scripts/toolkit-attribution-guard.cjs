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
// git -C <dir>: message files are relative to that folder.
const GIT_DIR_OPTION = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/;
const MAX_FILE_BYTES = 1024 * 1024;

function hasAttribution(text) {
  return ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(String(text || '')));
}

// The message or body files a command names, resolved against the command's working folder.
function namedFiles(command, cwd) {
  const files = [];
  const gitDir = GIT_DIR_OPTION.exec(String(command))?.[1]?.replace(/^["']|["']$/g, '');
  const base = gitDir ? path.resolve(cwd || process.cwd(), gitDir) : (cwd || process.cwd());
  for (const match of String(command).matchAll(FILE_OPTIONS)) {
    const raw = match[1].replace(/^["']|["']$/g, '');
    if (raw === '-') continue;
    files.push(path.resolve(base, raw));
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
