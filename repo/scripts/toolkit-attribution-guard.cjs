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
  /Claude-Session:/i,
  /https?:\/\/claude\.ai\/(?:code\/)?(?:session|chat)[^\s"'`)]*/i,
  /Generated with \[?Claude Code/i
]);
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);
const MAX_COMMAND_CHARS = 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_OPTIONS = 64;
const DIRECTORY_LIMIT = `This shell command exceeds the attribution check's ${MAX_DIRECTORY_OPTIONS} git -C options per command. Split it into smaller commands and retry.`;
// Retain the old file screen when shell syntax prevents pairing an option with its command.
const FILE_OPTIONS = /(?:^|\s)(?:-F(?:=|\s+)?|--file(?:=|\s+)|--body-file(?:=|\s+))("[^"]+"|'[^']+'|[^\s"']+)/g;

// One word scan, without retrying the remainder of a line for every occurrence of git.
// Raw text deliberately includes wrappers, substitutions, here-documents and here-strings.
function commitOrPr(text) {
  let git = false;
  for (const [word] of text.matchAll(/\bgit\b|\bcommit\b|[\n;&|]/g)) {
    if (word === 'git') git = true;
    else if (word === 'commit') { if (git) return true; }
    else git = false;
  }
  return /\bgh\s+pr\s+(?:create|edit|merge)\b/.test(text);
}

function hasAttribution(text) {
  const value = String(text || '');
  const trailer = value.toLowerCase().split('\n').some((line) => {
    const start = line.indexOf('co-authored-by:');
    // A trailer naming Claude or an anthropic.com address; this is text matching, not URL checking.
    return start !== -1 && /claude|anthropic\.com/.test(line.slice(start));
  });
  return trailer || ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(value));
}

// Read shell words in one pass. Quotes protect separators; shell escapes and both Bash and
// PowerShell line continuations stay inside the same command. Backslashes in Windows paths stay.
function shellCommands(text) {
  const commands = [];
  let words = []; let offsets = []; let word = ''; let started = false; let quote = ''; let offset = 0;
  const finishWord = () => { if (started) { words.push(word); offsets.push(offset); } word = ''; started = false; };
  const finishCommand = () => { finishWord(); if (words.length) commands.push({ words, offsets }); words = []; offsets = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (!started) offset = index;
    if (quote !== "'" && (char === '\\' || char === '`')) {
      if (next === '\n' || (next === '\r' && text[index + 2] === '\n')) {
        index += next === '\r' ? 2 : 1;
        continue;
      }
      if (next && (char === '`' || (quote === '"' ? '"\\$`'.includes(next) : /[\s"'\\;&|]/.test(next)))) {
        word += next; started = true; index += 1; continue;
      }
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && next === "'") { word += char; index += 1; }
        else quote = '';
      } else word += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '#' && !started) {
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1;
      continue;
    }
    if (char === ';' || char === '|' || char === '\n' || (char === '&' && next === '&')) {
      finishCommand();
      if ((char === '|' || char === '&') && next === char) index += 1;
    } else if (/\s/.test(char)) finishWord();
    else { word += char; started = true; }
  }
  finishCommand();
  return commands;
}

// Find the relevant subcommand after git's global options. Each -C is relative to the previous
// folder, while gh always uses the base folder. Option values cannot be mistaken for subcommands.
function messageCommand({ words, offsets }, root) {
  const start = words.findIndex((word) => /(?:^|[\\/])(?:git|gh)(?:\.exe)?$/i.test(word));
  if (start === -1) return null;
  if (/(?:^|[\\/])gh(?:\.exe)?$/i.test(words[start])) {
    return words[start + 1] === 'pr' && ['create', 'edit', 'merge'].includes(words[start + 2])
      ? { base: root, words: words.slice(start + 3), offsets: offsets.slice(start + 3) } : null;
  }
  let base = root;
  let directories = 0;
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index];
    if (GIT_VALUE_OPTIONS.has(word)) {
      const value = words[++index];
      if (value === undefined) return null;
      if (word === '-C') {
        if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
        if (value) base = path.resolve(base, value);
      }
    } else if (word.startsWith('-C') && word.length > 2) {
      if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
      base = path.resolve(base, word.slice(2));
    } else if (!word.startsWith('-')) return word === 'commit' ? { base, words: words.slice(index + 1), offsets: offsets.slice(index + 1) } : null;
    // Other global options, including --option=value and attached -c values, occupy one word.
  }
  return null;
}

function namedFiles({ words, offsets, base }) {
  const files = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const offset = offsets[index];
    if (word === '--') break;
    let raw;
    if (['-F', '--file', '--body-file'].includes(word)) raw = words[++index];
    else if (word.startsWith('-F')) raw = word.slice(word[2] === '=' ? 3 : 2);
    else if (word.startsWith('--file=')) raw = word.slice(7);
    else if (word.startsWith('--body-file=')) raw = word.slice(12);
    if (raw && raw !== '-') files.push({ file: path.resolve(base, raw), offset });
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
  if (text.length > MAX_COMMAND_CHARS) return `This shell command exceeds the attribution check's ${MAX_COMMAND_CHARS}-character limit. Split it into smaller commands and retry.`;
  const rawCommand = commitOrPr(text);
  if (rawCommand && hasAttribution(text)) return MESSAGE;
  const root = cwd || process.cwd();
  const commands = shellCommands(text).map((current) => messageCommand(current, root)).filter(Boolean);
  if (commands.some((current) => current.refusal)) return DIRECTORY_LIMIT;
  if (!rawCommand && !commands.length) return '';
  if (hasAttribution(text)) return MESSAGE;
  const paired = new Set();
  for (const current of commands) for (const { file, offset } of namedFiles(current)) {
    paired.add(offset);
    if (hasAttribution(readSmallFile(file))) return MESSAGE;
  }
  // The legacy -C interpretation is retained only for unpaired files. Always check the base
  // folder too: a wrapper or an unmatched quote must not silently disable file screening.
  const legacyDirectory = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(text)?.[1]?.replace(/^["']|["']$/g, '');
  for (const match of text.matchAll(FILE_OPTIONS)) {
    const offset = match.index + (/\s/.test(match[0][0]) ? 1 : 0);
    if (paired.has(offset)) continue;
    const raw = match[1].replace(/^["']|["']$/g, '');
    if (raw === '-') continue;
    const bases = legacyDirectory ? [root, path.resolve(root, legacyDirectory)] : [root];
    for (const base of bases) if (hasAttribution(readSmallFile(path.resolve(base, raw)))) return MESSAGE;
  }
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
