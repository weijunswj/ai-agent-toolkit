'use strict';

// The one reader of a shell tool call, for every hook check that judges a git or gh command: the
// governance gate, the merge hold and the attribution, force-push and push checks. Hosts shape a
// shell call differently:
//   - Claude Code sends Bash, PowerShell or Monitor with a string `command` and the session folder as
//     the top-level `cwd`;
//   - Codex documents Bash with a string `command`, but its shell and exec tools also carry `cmd`,
//     an argument list, and `workdir`, the folder the command runs in, which can differ from `cwd`.
//     Codex Desktop's code-mode program (`exec`) reaches no hook itself; each shell call it makes
//     arrives as Bash with a string `command` (captured 29 October 2026).
// ShellCall.from(input) reads all of these the same way:
//   - text: a string `command` and a string `cmd` (both, a line apart, when both are given), or an
//     argument list: the script of a shell wrapper (`bash -lc <script>`, `pwsh -Command <script>`,
//     `cmd /c <script>`), else the words quoted so that shell parsing gives back the same words;
//   - folder: `workdir`, else the tool's own `cwd`, else the top-level `cwd`, else this process's
//     folder, a relative value resolved against the top-level `cwd`;
//   - unreadable: a shell call whose command or folder has a type no host sends, or that has no
//     command at all. The checks cannot read it, so a call whose raw input could commit, push or open,
//     edit or merge a pull request is refused (refusal()); any other unreadable call runs.

const path = require('node:path');

const SHELL_TOOL_NAMES = Object.freeze(['Bash', 'PowerShell', 'Monitor', 'exec_command', 'shell', 'local_shell']);
const SHELL_TOOLS = new RegExp(`^(?:${SHELL_TOOL_NAMES.join('|')})$`);
const UNREADABLE = 'Toolkit could not read this shell command, so it was refused. Retry it; if this repeats, run `setup toolkit`.';
// The same broad screen the hooks use when a check cannot run: git ... commit or push, gh pr
// create, edit or merge, and gh ... merge, sync, alias or api.
const GUARDED = [/\bgit\b[\s\S]*\b(?:commit|push)\b/i, /\bgh\s+pr\s+(?:create|edit|merge)\b/i, /\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i];

// A shell program at the start of an argument list, and the option that hands it a script.
const POSIX_SHELL = /^(?:bash|sh|zsh|dash|ksh)$/;
const POWERSHELL = /^(?:pwsh|powershell)$/;
const SCRIPT_OPTION = { posix: /^-[A-Za-z]*c$/, powershell: /^-(?:c|command)$/i, cmd: /^\/[ck]$/i };
// Backslashes are quoted too: outside quotes, one before a space or quote escapes it.
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function programName(word) {
  return path.win32.basename(path.posix.basename(word)).replace(/\.exe$/i, '').toLowerCase();
}

// An argument list as one command line that shellCommands-style parsing reads back word for word:
// plain words as they are, others in single quotes with each quote doubled.
function quoteWords(words) {
  return words.map(word => (word && PLAIN_WORD.test(word) ? word : `'${word.replace(/'/g, "''")}'`)).join(' ');
}

// The command line an argument list runs.
function argvText(words) {
  const program = words.length ? programName(words[0]) : '';
  const kind = POSIX_SHELL.test(program) ? 'posix' : POWERSHELL.test(program) ? 'powershell' : program === 'cmd' ? 'cmd' : null;
  if (kind) {
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index];
      if (SCRIPT_OPTION[kind].test(word)) {
        // bash -c takes one script word (later words are its arguments); PowerShell and cmd read the rest.
        const script = kind === 'posix' ? words.slice(index + 1, index + 2) : words.slice(index + 1);
        if (script.length) return script.join(' ');
        break;
      }
      if (!/^[-/]/.test(word)) break;
    }
  }
  return quoteWords(words);
}

// Every key and string in the raw input, a line apart, with line continuations (\, a PowerShell
// backtick or a cmd caret before a line break) joined, so the screen sees the words as a shell would:
// a tab or a continued line still separates them. Past its depth or count bound the walk adds the
// whole input as JSON with its escapes read as spaces, so nothing deeper goes unscreened.
const MAX_SCREEN_DEPTH = 16;
const MAX_SCREEN_ITEMS = 10000;
function screenText(value) {
  const parts = [];
  let cut = false;
  const walk = (item, depth) => {
    if (parts.length >= MAX_SCREEN_ITEMS) { cut = true; return; }
    if (typeof item === 'string') parts.push(item);
    else if (typeof item === 'number' || typeof item === 'boolean') parts.push(String(item));
    else if (item && typeof item === 'object') {
      if (depth >= MAX_SCREEN_DEPTH) { cut = true; return; }
      for (const [key, entry] of Object.entries(item)) {
        if (!Array.isArray(item)) parts.push(key);
        walk(entry, depth + 1);
      }
    }
  };
  walk(value, 0);
  if (cut) { try { parts.push(JSON.stringify(value).replace(/\\[nrt]/g, ' ')); } catch { /* the parts read so far */ } }
  return parts.join('\n').replace(/[\\`^]\r?\n/g, ' ');
}

function stringList(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

class ShellCall {
  #isShell; #text; #joined; #folder; #folders; #unreadable; #raw;

  constructor({ isShell, text, joined, folder, folders, unreadable, raw }) {
    this.#isShell = isShell; this.#text = text; this.#joined = joined; this.#folder = folder; this.#folders = folders; this.#unreadable = unreadable; this.#raw = raw;
  }

  static isShellTool(name) { return typeof name === 'string' && SHELL_TOOLS.test(name); }

  // `shell: true` reads the call as a shell call whatever its tool name, for a caller that has
  // already routed it as one.
  static from(input, { cwd = process.cwd(), shell = false } = {}) {
    const tool = input && (input.tool_name || input.toolName);
    const args = input && (input.tool_input ?? input.toolInput);
    const isShell = shell === true || ShellCall.isShellTool(tool);
    const base = path.resolve(typeof input?.cwd === 'string' && input.cwd ? input.cwd : cwd);
    const raw = screenText(args);
    const named = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    let unreadable = isShell && (args === undefined || args === null ? false : named !== args);
    const texts = [];
    const joined = [];
    for (const field of ['command', 'cmd']) {
      const value = named[field];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') texts.push(value);
      else if (stringList(value)) { texts.push(argvText(value)); joined.push(value.join(' ')); }
      else unreadable = true;
    }
    const folders = [];
    for (const field of ['workdir', 'cwd']) {
      const value = named[field];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value === 'string') folders.push(path.resolve(base, value));
      else unreadable = true;
    }
    if (isShell && !texts.length) unreadable = true;
    return new ShellCall({ isShell, text: texts.join('\n'), joined: joined.join('\n'), folder: folders[0] || base, folders, unreadable: isShell && unreadable, raw });
  }

  get isShell() { return this.#isShell; }
  // The command text every check reads ('' when there is none).
  get text() { return this.#text; }
  // Each argument list joined with plain spaces, unquoted (''), for a reader that also screens the
  // words as they would read without quoting.
  get joinedWords() { return this.#joined; }
  // The folder the command runs in.
  get folder() { return this.#folder; }
  // Every folder the call itself names (workdir and the tool's cwd), resolved.
  get folders() { return [...this.#folders]; }
  get unreadable() { return this.#unreadable; }

  // The refusal for an unreadable call whose raw input (every key and string in it) could commit,
  // push or touch a pull request, or ''.
  refusal() {
    if (!this.#unreadable) return '';
    return GUARDED.some(pattern => pattern.test(this.#raw)) ? UNREADABLE : '';
  }
}

module.exports = Object.freeze({ SHELL_TOOL_NAMES, SHELL_TOOLS, UNREADABLE, ShellCall, argvText, quoteWords });
