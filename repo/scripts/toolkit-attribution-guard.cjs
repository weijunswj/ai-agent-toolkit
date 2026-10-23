'use strict';

// Refuses shell commands that would put AI attribution into a commit or a pull request: a
// Co-Authored-By trailer naming Claude or Anthropic, a Claude-Session trailer (: or =), a claude.ai session
// link, or a "Generated with Claude Code" footer. It looks only at `git commit` and `gh pr create` /
// `gh pr edit` / `gh pr merge`, in the command text and in a message or body file the command names. Ordinary text
// that merely mentions Claude passes. Used by the Claude Code PreToolUse hook and the Codex helper hook.

const fs = require('node:fs');
const path = require('node:path');

const MESSAGE = 'Remove the AI attribution lines (Co-Authored-By or Claude-Session trailers, claude.ai session links, "Generated with" footers) and retry.';
const ATTRIBUTION_PATTERNS = Object.freeze([
  /https?:\/\/claude\.ai\/(?:code\/)?(?:session|chat)[^\s"'`)]*/i,
  /Generated with \[?Claude Code/i
]);
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);
const MAX_COMMAND_CHARS = 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_OPTIONS = 64;
const DIRECTORY_LIMIT = `This shell command exceeds the attribution check's ${MAX_DIRECTORY_OPTIONS} git -C options per command. Split it into smaller commands and retry.`;
const MAX_FILE_OPTIONS = 64;
const FILE_LIMIT = `This shell command exceeds the attribution check's ${MAX_FILE_OPTIONS} file options per command or unpaired file options across the text. Split it into smaller commands and retry.`;
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

function trailerStart(line, name) {
  let start = line.indexOf(name);
  while (start !== -1) {
    let end = start + name.length;
    while (line[end] === ' ' || line[end] === '\t') end += 1;
    if (line[end] === ':' || line[end] === '=') return start;
    start = line.indexOf(name, end);
  }
  return -1;
}

function hasAttribution(text) {
  const value = String(text || '');
  const trailer = value.toLowerCase().split('\n').some((line) => {
    if (trailerStart(line, 'claude-session') !== -1) return true;
    const start = trailerStart(line, 'co-authored-by');
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
      if (next && (char === '`' || (quote === '"' ? '"\\$`'.includes(next) : /[\s"'\\;&|()]/.test(next)))) {
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
    if (char === ';' || char === '|' || char === '\n' || char === '(' || char === ')' || (char === '&' && next === '&')) {
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
      ? { base: root, git: false, words: words.slice(start + 3), offsets: offsets.slice(start + 3) } : null;
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
    } else if (!word.startsWith('-')) return word === 'commit' ? { base, git: true, words: words.slice(index + 1), offsets: offsets.slice(index + 1) } : null;
    // Other global options, including --option=value and attached -c values, occupy one word.
  }
  return null;
}

function namedFiles({ words, offsets, git }) {
  const files = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const offset = offsets[index];
    if (word === '--') break;
    let raw; let fileOption = false;
    if (word === '--file' || word === '--body-file' || (!git && word === '-F')) {
      fileOption = true; raw = words[++index];
    } else if (word.startsWith('--file=')) { fileOption = true; raw = word.slice(7); }
    else if (word.startsWith('--body-file=')) { fileOption = true; raw = word.slice(12); }
    else if (!git && word.startsWith('-F')) { fileOption = true; raw = word.slice(word[2] === '=' ? 3 : 2); }
    else if (git && word.startsWith('-') && !word.startsWith('--')) {
      for (let letter = 1; letter < word.length; letter += 1) {
        if (!'mFcCt'.includes(word[letter])) continue;
        const value = word.slice(letter + 1) || words[++index];
        if (word[letter] === 'F') {
          fileOption = true; raw = value;
          // Retain the existing -F=file spelling too.
          if (raw?.startsWith('=')) raw = raw.slice(1);
        }
        break;
      }
    }
    if (fileOption) {
      files.push({ raw, offset });
      if (files.length > MAX_FILE_OPTIONS) return { refusal: FILE_LIMIT };
    }
  }
  return { files };
}

function readSmallFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

// Cache both resolution and inspection for one call, including missing and oversized files.
class AttributionFileScreen {
  constructor(readFile = readSmallFile) {
    this.readFile = readFile;
    this.resolved = new Map();
    this.checked = new Map();
  }

  hasAttribution(base, raw) {
    if (!raw || raw === '-') return false;
    if (!this.resolved.has(base)) this.resolved.set(base, new Map());
    const paths = this.resolved.get(base);
    if (!paths.has(raw)) paths.set(raw, path.resolve(base, raw));
    const file = paths.get(raw);
    if (!this.checked.has(file)) this.checked.set(file, hasAttribution(this.readFile(file)));
    return this.checked.get(file);
  }
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
  const screen = new AttributionFileScreen();
  for (const current of commands) {
    const result = namedFiles(current);
    if (result.refusal) return result.refusal;
    for (const { raw, offset } of result.files) {
      paired.add(offset);
      if (screen.hasAttribution(current.base, raw)) return MESSAGE;
    }
  }
  // The legacy -C interpretation is retained only for unpaired files. Always check the base
  // folder too: a wrapper or an unmatched quote must not silently disable file screening.
  const legacyDirectory = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(text)?.[1]?.replace(/^["']|["']$/g, '');
  const bases = legacyDirectory ? [root, path.resolve(root, legacyDirectory)] : [root];
  let unpaired = 0;
  for (const match of text.matchAll(FILE_OPTIONS)) {
    const offset = match.index + (/\s/.test(match[0][0]) ? 1 : 0);
    if (paired.has(offset)) continue;
    if (++unpaired > MAX_FILE_OPTIONS) return FILE_LIMIT;
    const raw = match[1].replace(/^["']|["']$/g, '');
    if (raw === '-') continue;
    for (const base of bases) if (screen.hasAttribution(base, raw)) return MESSAGE;
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
