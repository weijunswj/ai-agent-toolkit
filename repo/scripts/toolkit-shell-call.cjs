'use strict';

// The one reader of a shell tool call, for every hook check that judges a git or gh command: the
// governance gate, the merge hold and the attribution, force-push and push checks. Hosts shape a
// shell call differently:
//   - Claude Code sends Bash, PowerShell or Monitor with a string `command` and the session folder as
//     the top-level `cwd`;
//   - Codex documents Bash with a string `command`, but its shell and exec tools also carry `cmd`,
//     an argument list, and `workdir`, the folder the command runs in, which can differ from `cwd`.
//     Nested code-mode shell calls arrive as Bash, including when Codex uses PowerShell.
//     This reader only inspects calls the host actually delivers to the hook.
// ShellCall.from(input) reads all of these the same way:
//   - text: a string `command` and a string `cmd` (both, a line apart, when both are given), or an
//     argument list: the script of a shell wrapper (`bash -lc <script>`, `pwsh -Command <script>`,
//     `cmd /c <script>`), else the words quoted so that shell parsing gives back the same words;
//   - folder: `workdir`, else the tool's own `cwd`, else the top-level `cwd`, else this process's
//     folder, a relative value resolved against the top-level `cwd`. `folders` lists only what the
//     call itself names, so a caller can tell a Codex call that named no folder: its top-level `cwd`
//     may not be where the command runs. shellPath() resolves every folder or file a command names
//     the same way, Git Bash drive paths included;
//   - unreadable: a shell call whose command or folder has a type no host sends, or that has no
//     command at all. The checks cannot read it, so a call whose raw input could commit, push or open,
//     edit or merge a pull request is refused (refusal()); any other unreadable call runs.

const os = require('node:os');
const path = require('node:path');

const SHELL_TOOL_NAMES = Object.freeze(['Bash', 'PowerShell', 'Monitor', 'exec_command', 'shell', 'local_shell']);
const SHELL_TOOLS = new RegExp(`^(?:${SHELL_TOOL_NAMES.join('|')})$`);
const UNREADABLE = 'Toolkit could not read this shell command, so it was refused. Retry it; if this repeats, run `setup toolkit`.';
// The same broad screen the launcher uses when a check cannot run (toolkit-codex-helper-hook.ps1):
// git ... commit or push, gh ... pr ... create, new, edit or merge, gh ... issue ... close, and gh ... merge, sync, alias or api.
const GUARDED = [/\bgit\b[\s\S]*\b(?:commit|push)\b/i, /\bgh\b[\s\S]*\bpr\b[\s\S]*\b(?:create|new|edit|merge)\b/i, /\bgh\b[\s\S]*\bissue\b[\s\S]*\bclose\b/i, /\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i];

// A shell program at the start of an argument list, and the option that hands it a script.
const POSIX_SHELL = /^(?:bash|sh|zsh|dash|ksh)$/;
const POWERSHELL = /^(?:pwsh|powershell)$/;
const SCRIPT_OPTION = { posix: /^-[A-Za-z]*c$/, powershell: /^-(?:c|co|com|comm|comma|comman|command)$/i, cmd: /^\/[ck]$/i };
// Backslashes are quoted too: outside quotes, one before a space or quote escapes it.
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
// A command word that runs its quoted arguments as a further command line (bash -c "...",
// pwsh -Command "...", eval "..."), which the checks read up to two levels deep.
const SHELLS = /(?:^|[\\/])(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|eval|invoke-expression|iex)(?:\.exe)?$/i;

// Read shell words in one pass: [{ words, offsets }] per command. Quotes protect separators; shell
// escapes and both Bash and PowerShell line continuations stay inside the same command. Backslashes
// in Windows paths stay.
function shellCommands(text, { powershell = false, uncertainShell = false } = {}) {
  const commands = [];
  let words = []; let offsets = []; let expanding = []; let expands = false; let word = ''; let started = false; let quote = ''; let offset = 0;
  const finishWord = () => { if (started) { words.push(word); offsets.push(offset); expanding.push(expands); } word = ''; started = false; expands = false; };
  const finishCommand = () => { finishWord(); if (words.length) commands.push({ words, offsets, expanding }); words = []; offsets = []; expanding = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (!started) offset = index;
    if (quote !== "'" && (char === '\\' && !powershell || char === '`')) {
      // Preserve the generic reader's unquoted backslash while recording a literal dollar.
      if (!quote && char === '\\' && next === '$') { word += '\\$'; expands ||= powershell || uncertainShell; started = true; index++; continue; }
      if (next === '\n' || (next === '\r' && text[index + 2] === '\n')) {
        index += next === '\r' ? 2 : 1;
        continue;
      }
      if (next && (char === '`' || (quote === '"' ? '"\\$`'.includes(next) : /[\s"'\\;&|()]/.test(next)))) {
        if (char === '\\' && next === '$' && (powershell || uncertainShell)) expands = true;
        word += next; started = true; index += 1; continue;
      }
    }
    if (quote !== "'" && char === '$' && next && (/[A-Za-z0-9_{(?!@#$*:-]/.test(next) || !quote && !/[\s;&|()]/.test(next) || (powershell || uncertainShell) && !/[\s'";&|()]/.test(next))) expands = true;
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

// The shared safe subset for a push checked without interpreting shell syntax: exactly one git
// command, no substitutions anywhere (even quoted), and no unquoted operators or cmd variables.
function plainGitLine(text) {
  if (/\$[({]|`|[<>]\(/.test(text)) return false;
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote !== "'" && char === '\\' && next
      && (quote === '"' ? '"\\$'.includes(next) : /[\s"'\\]/.test(next))) {
      if (!quote && /[\r\n]/.test(next)) return false;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && next === "'") index += 1;
        else quote = '';
      }
    } else if (char === '"' || char === "'") quote = char;
    else if (/[;&|(){}\r\n]/.test(char) || (char === '%' && /^%[^%\s]+%/.test(text.slice(index)))) return false;
  }
  if (quote) return false;
  const commands = shellCommands(text);
  return commands.length === 1 && /(?:^|[\\/])git(?:\.exe)?$/i.test(commands[0].words[0]);
}

// A folder or file a shell command names, resolved against `base` as the shell would: a leading `~`
// (alone, `~/` or `~\`) is the home folder in every shell. On Windows a Git Bash drive path
// (`/c/Users/...`, `/cygdrive/c/...`, any drive letter) names that drive and `/tmp` the user's temp
// folder, as Git Bash reads them; it is the shell behind Claude Code's Bash tool there. Node alone
// would read `/c/Users` as a folder `c` on the current drive, which does not exist, and the checks
// would look in the wrong place. A variable or command substitution (`$HOME`, `$(...)`,
// `$env:USERPROFILE`) is left as written, so its folder is not found and a push from it is refused.
function shellPath(base, value, { platform = process.platform, home = os.homedir(), temp = os.tmpdir() } = {}) {
  const text = String(value);
  const paths = platform === 'win32' ? path.win32 : path;
  const tilde = /^~(?:[\\/](.*))?$/s.exec(text);
  if (tilde) return paths.resolve(home, tilde[1] || '');
  if (platform === 'win32') {
    const drive = /^\/(?:cygdrive\/)?([A-Za-z])(?:\/(.*))?$/s.exec(text);
    if (drive) return path.win32.resolve(`${drive[1].toUpperCase()}:\\`, drive[2] || '');
    const tmp = /^\/tmp(?:\/(.*))?$/s.exec(text);
    if (tmp) return path.win32.resolve(temp, tmp[1] || '');
    return path.win32.resolve(base, text);
  }
  return path.resolve(base, text);
}

// Whether a folder a shell command names stands on its own, whatever folder the command starts in:
// `~`, a rooted path (`/...`, which on Windows also covers Git Bash drive paths), a drive path
// (`C:\...` or `C:/...`) or a network path (`\\server\...`), the last two on Windows only. A relative
// path or a variable does not.
function absoluteShellPath(value, { platform = process.platform } = {}) {
  return (platform === 'win32' ? /^(?:~(?:[\\/]|$)|[\\/]|[A-Za-z]:[\\/])/ : /^(?:~(?:\/|$)|\/)/).test(String(value));
}

// A variable a command segment assigns a literal to, as [key, value]: PowerShell `$name = 'value'`,
// whose names ignore case, or POSIX `name=value`, whose names keep it (`D` and `d` are two variables).
// Anything else is null.
function assignmentOf(words) {
  if (words.length === 3 && /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(words[0]) && words[1] === '=') return [`ps:${words[0].slice(1).toLowerCase()}`, words[2]];
  const posix = words.length === 1 ? /^([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"$`]*)"|'([^']*)'|([^\s"'$`]*))$/.exec(words[0]) : null;
  return posix ? [`sh:${posix[1]}`, posix[2] ?? posix[3] ?? posix[4]] : null;
}

// Leading home variables: `$HOME` (`${HOME}` too) is the home folder in bash and PowerShell alike;
// `$env:USERPROFILE`, `$env:HOME` and `%USERPROFILE%` only in PowerShell and cmd. Bash reads `$env` as
// an unset variable, so such a word is not the home folder there.
const HOME_EVERYWHERE = /^(?:\$HOME|\$\{HOME\})(?=$|[\\/])/;
const HOME_WINDOWS = /^(?:\$env:USERPROFILE|\$env:HOME|%USERPROFILE%)(?=$|[\\/])/i;

// Records an assignment (assignmentOf) in `variables`, noting a name assigned more than once.
function assignVariable(variables, [key, value]) {
  variables.set(key, { value, reassigned: variables.has(key) });
}

// A folder word as the shell would read it: a whole-word variable the same command assigned earlier,
// and a leading home variable as `~` (shellPath resolves it). Names are read only as the shell that
// runs the command reads them (`shell`: 'posix' or 'powershell', from shellOf): a POSIX name in its
// exact case, a PowerShell name in any case, the last assignment winning. When the shell is not known
// (null), a name assigned in both forms or more than once is left unread, so the folder stays the
// literal word and the check fails closed; and the caller also judges the command a second time with
// `shell` 'unset' (shellReadings), where every assigned name reads as empty, as it does in the shell
// that cannot run the assignment, so the folder is the one the command is already in. The home
// variables follow the same shells: a Windows-only one is the home folder in PowerShell and in the
// unknown reading, a literal word in bash, and empty in the 'unset' reading.
function folderWord(word, variables, shell = null) {
  const name = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/.exec(word);
  let value = word;
  if (name) {
    const posix = variables.get(`sh:${name[1] || name[2]}`);
    const power = variables.get(`ps:${(name[1] || name[2]).toLowerCase()}`);
    if (shell === 'posix') value = posix ? posix.value : word;
    else if (shell === 'powershell') value = power ? power.value : word;
    else if (shell === 'unset') value = posix || power ? '' : word;
    else {
      const found = [posix, power].filter(Boolean);
      if (found.length === 1 && !found[0].reassigned) value = found[0].value;
    }
  }
  value = String(value).replace(HOME_EVERYWHERE, '~');
  if (HOME_WINDOWS.test(value)) {
    if (shell === 'unset') return '';
    if (shell !== 'posix') value = value.replace(HOME_WINDOWS, '~');
  }
  return value;
}

// The readings a check judges a command under: the known shell, or for an unknown one both the
// variables as assigned and the variables as unset. A check refuses when any reading refuses.
function shellReadings(shell) { return shell ? [shell] : [null, 'unset']; }

// The shell a call runs in, when the host says: Claude Code's Bash tool runs bash and its PowerShell
// tool PowerShell. Codex names no shell (its Bash tool may run PowerShell on Windows), so it is null.
function shellOf(input, host) {
  if (host !== 'claude') return null;
  const tool = input && (input.tool_name || input.toolName);
  return tool === 'Bash' ? 'posix' : tool === 'PowerShell' ? 'powershell' : null;
}

function programName(word) {
  return path.win32.basename(path.posix.basename(word)).replace(/\.exe$/i, '').toLowerCase();
}

// An argument list as one command line that shellCommands reads back word for word:
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
        // POSIX shells can take more options and -- before the script. Later words are its
        // arguments; PowerShell and cmd read the rest after their command option.
        let start = index + 1;
        if (kind === 'posix') {
          while (start < words.length && /^[-+]/.test(words[start])) {
            // Options with a separate value make the script boundary uncertain here.
            if (/^(?:[-+][oO]|--(?:rcfile|init-file))$/.test(words[start])) return words.join(' ');
            start += 1;
          }
        }
        const script = kind === 'posix' ? words.slice(start, start + 1) : words.slice(start);
        if (script.length && script[0]) return script.join(' ');
        return words.join(' ');
      }
      if (!/^[-/]/.test(word)) break;
    }
  }
  return kind ? words.join(' ') : quoteWords(words);
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
      if (typeof value === 'string') folders.push(shellPath(base, value));
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
  // push, close an issue or touch a pull request, or ''.
  refusal() {
    if (!this.#unreadable) return '';
    return GUARDED.some(pattern => pattern.test(this.#raw)) ? UNREADABLE : '';
  }
}

// Default-deny closure reader: unknown positions containing guarded gh words are marked hidden.
// Attached punctuation, stop-parsing and variable command words are read; documented data stays data.
// This bounded word reader performs no expansion or execution and does not cover all shell syntax.
function scriptContext(input, { host } = {}) {
  const args = input?.tool_input ?? input?.toolInput ?? {};
  const values = [args.command,args.cmd].filter(value => value != null);
  const name = values.length === 1 && Array.isArray(values[0]) && typeof values[0][0] === 'string' ? programName(values[0][0]) : typeof args.shell === 'string' ? programName(args.shell) : '';
  if (POWERSHELL.test(name)) return { powershell: true, uncertainShell: false };
  if (POSIX_SHELL.test(name)) return { powershell: false, uncertainShell: false };
  const tool = input?.tool_name || input?.toolName;
  return { powershell: tool === 'PowerShell', uncertainShell: tool !== 'PowerShell' && tool !== 'Bash', codexBash: host === 'codex' && tool === 'Bash' };
}
const MOVES_TARGET = /(?:^|[\s;&|({])(?:cd|pushd|chdir|set-location|sl|push-location)\s|\bGH_REPO\s*=/i;
const NUMBER_FIELDS = Object.freeze(['pr_number', 'pull_number', 'pullNumber', 'pull_request_number', 'number']);
const GRAPHQL_OPERATION = /(?:^|__)(?:graphql|graphql_query|execute_graphql)$/i;
function connectorTarget(args, numberFields = NUMBER_FIELDS) {
  const given = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const has = key => Object.prototype.hasOwnProperty.call(given, key) && given[key] !== undefined;
  let repository = null; let readable = true; let unclear = null;
  if (has('repository_full_name')) {
    if (typeof given.repository_full_name === 'string' && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(given.repository_full_name)) repository = given.repository_full_name;
    else readable = false;
  }
  if (has('owner') || has('repo')) {
    const pair = typeof given.owner === 'string' && typeof given.repo === 'string' && /^[a-z0-9_.-]+$/i.test(given.owner) && /^[a-z0-9_.-]+$/i.test(given.repo) ? `${given.owner}/${given.repo}` : null;
    if (!pair) readable = false;
    else if (repository && repository.toLowerCase() !== pair.toLowerCase()) unclear = 'repository';
    else repository ||= pair;
  }
  if (!readable) repository = null;
  const numbers = numberFields.filter(has).map(key => {
    const value = given[key];
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  });
  let pr = numbers.length && numbers.every(n => n !== null) ? numbers[0] : null;
  if (pr !== null && numbers.some(n => n !== pr)) { unclear ||= 'pull request'; pr = null; }
  return { repository, pr, unclear };
}

// An opener must occupy shell syntax, not a quoted example. A substitution has
// its own quoting context even inside an outer double-quoted word.
function documentOpening(line, state) {
  const pattern = /<<(-?)\s*(?:(['"])([^'"\n]+)\2|(\\?)([A-Za-z_][\w.-]*))/y;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state.quote !== "'" && (c === '\\' && !state.powershell || c === '`')) { i++; continue; }
    if (state.quote !== "'" && c === '$' && line[i + 1] === '(') { state.frames.push({ quote: state.quote, depth: 1 }); state.quote = ''; i++; continue; }
    if (state.quote) { if (c === state.quote) state.quote = ''; continue; }
    if (c === '#' && (i === 0 || /[\s;&|{}()]/.test(line[i - 1]))) break;
    if (c === '@' && /['"]/.test(line[i + 1] || '') && /^\s*$/.test(line.slice(i + 2))) return { here: { 1: line[i + 1], index: i } };
    if (c === '<' && line[i + 1] === '<' && line[i - 1] !== '<' && line[i + 2] !== '<') {
      pattern.lastIndex = i; const doc = pattern.exec(line); if (doc) return { doc };
    }
    if (c === "'" || c === '"') { state.quote = c; continue; }
    if (state.frames.length && c === '(') state.frames.at(-1).depth++;
    if (state.frames.length && c === ')' && --state.frames.at(-1).depth === 0) state.quote = state.frames.pop().quote;
  }
  return {};
}

// Read documents once by lines, preserving the command on both sides of the opener.
function readScript(text, { powershell = false, interpolation = false } = {}) {
  const docs = new Map(); const nested = [];
  const lines = text.split(/\r?\n/); const lastExact = new Map(); const lastTabbed = new Map();
  lines.forEach((line, i) => { lastExact.set(line, i); lastTabbed.set(line.replace(/^\t+/, ''), i); });
  const parts = []; const documentState = { quote: '', frames: [], powershell };
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n];
    const { here, doc } = interpolation ? {} : documentOpening(line, documentState);
    if (here || doc) {
      const marker = here ? here[1] + '@' : doc[3] ?? doc[5];
      if (((doc?.[1] ? lastTabbed : lastExact).get(marker) ?? -1) > n) {
        let end = n + 1;
        while (end < lines.length && (doc?.[1] ? lines[end].replace(/^\t+/, '') : lines[end]) !== marker) end++;
        if (end < lines.length) {
          const body = lines.slice(n + 1, end).map(value => doc?.[1] ? value.replace(/^\t+/, '') : value).join('\n');
          const key = `__${here ? 'herestr' : 'heredoc'}_${docs.size}__`;
          const literal = here ? here[1] === "'" || !/[$`]/.test(body) : Boolean(doc[2] || doc[4]) || !/[$`]/.test(body);
          docs.set(key, { value: body, literal });
          if (!literal) nested.push(...readScript(body, { powershell, interpolation: true }).nested);
          if (here) line = line.slice(0, here.index) + `'${key}'`;
          else {
            const header = line.slice(0, doc.index) + ' ' + line.slice(doc.index + doc[0].length);
            // Any shell on the header can consume this document, including pipelines and chains.
            if (shellCommands(header).some(command => SHELLS.test(unwrap(command).words[0] || ''))) nested.push(body);
            line = line.slice(0, doc.index) + ` ${key} ` + line.slice(doc.index + doc[0].length);
          }
          n = end;
        }
      }
    }
    parts.push(line);
  }
  const source = parts.join('\n');
  const chunks = []; let prefixText = ''; let quote = ''; let unbalancedBlock = false; const blocks = [];
  let noBlockComment = false; let bodyReadTo = -1; let noBody = false;
  const runsGh = (prefix, body) => !DATA_COMMAND.test(programName(prefix.split(/\s/)[0])) && /\bgh\b/i.test(body);
  const emit = value => { chunks.push(value); if (prefixText.length < 64) prefixText += value.slice(0, 64 - prefixText.length); };
  const boundary = () => { prefixText = ''; };
  const balanced = (start, open, close) => {
    let count = 1; let q = '';
    for (let j = start + 1; j < source.length; j++) {
      const c = source[j];
      if (q !== "'" && (c === '\\' && !powershell || c === '`')) { j++; continue; }
      if (q) { if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#' && /[\s;&|{}()]/.test(source[j - 1] || ' ')) { while (j + 1 < source.length && source[j + 1] !== '\n') j++; continue; }
      if (c === open) count++;
      if (c === close && --count === 0) return j;
    }
    return -1;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote !== "'" && c === '$' && source[i + 1] === '(') {
      const end = balanced(i + 1, '(', ')');
      if (end < 0) { emit(source.slice(i)); break; }
      const inner = source.slice(i + 2, end); nested.push(inner);
      const cat = /^\s*cat\s+(__heredoc_\d+__)\s*$/.exec(inner);
      emit(cat ? `$(cat ${cat[1]})` : '$(__subst__)'); i = end; continue;
    }
    if (quote !== "'" && c === '`' && !powershell) {
      let end = i + 1;
      while (end < source.length && source[end] !== '`') { if (source[end] === '\\') end++; end++; }
      if (end < source.length) { nested.push(source.slice(i + 1, end)); emit('$(__subst__)'); i = end; continue; }
    }
    if (quote !== "'" && (c === '\\' && !powershell || c === '`')) { emit(c + (source[++i] || '')); continue; }
    // Quotes in expanding document bodies are text, not shell quoting. Only their
    // substitution spans execute; ordinary gh words in that text remain data.
    if (interpolation) { emit(c); continue; }
    if (quote) { if (c === quote) quote = ''; emit(c); continue; }
    if (c === "'" || c === '"') { quote = c; emit(c); continue; }
    if (c === '<' && source[i + 1] === '#' && !noBlockComment && (i === 0 || /[\s;&|{}]/.test(source[i - 1]))) { const close = source.indexOf('#>', i + 2); if (close >= 0) { emit(' '); i = close + 1; continue; } noBlockComment = true; }
    if (c === '#' && (i === 0 || /[\s;&|{}]/.test(source[i - 1]))) { while (i + 1 < source.length && source[i + 1] !== '\n') i++; continue; }
    if (c === '{') {
      if (unbalancedBlock) { emit(c); continue; }
      const prefix = prefixText.trim();
      const keyword = /^(?:for(?:each)?|while|until|if|elif|elseif|else|do|then|try|catch|finally|switch|function|filter|%|\.|foreach-object|invoke-command|icm|start-job|measure-command)(?:\b|\s|$)|^[\w-]+\s*\(\s*\)\s*$/i.test(prefix);
      const attached = i > 0 && !/[\s;&|()}]/.test(source[i - 1]) && source[i - 1] !== '@' && !keyword;
      if (attached) {
        const end = balanced(i, '{', '}');
        if (end < 0) { emit(source.slice(i)); break; }
        if (source[i - 1] !== '$' && runsGh(prefix, source.slice(i + 1, end))) nested.push({ text: source.slice(i + 1, end), hidden: true });
        emit(source.slice(i, end + 1)); i = end; continue;
      }
      if (!prefix || keyword || blocks.at(-1) === 'switch') {
        blocks.push(/^switch\b/i.test(prefix) ? 'switch' : 'block'); emit(';'); boundary(); continue;
      }
      if (!powershell) { if (i > bodyReadTo && !noBody) { const end = balanced(i, '{', '}'); if (end < 0) noBody = true; else { bodyReadTo = end; if (runsGh(prefix, source.slice(i + 1, end))) nested.push({ text: source.slice(i + 1, end), hidden: true }); } } emit(c); continue; }
      const end = balanced(i, '{', '}');
      if (end < 0) { unbalancedBlock = true; emit(c); continue; }
      if (runsGh(prefix, source.slice(i + 1, end))) nested.push({ text: source.slice(i + 1, end), hidden: true });
      emit(" '__inert_block__' "); i = end; boundary(); continue;
    }
    if (c === '}' && blocks.length) { blocks.pop(); emit(';'); boundary(); continue; }
    if (c === '&' && source[i + 1] !== '&' && source[i - 1] !== '&' && !/[<>]/.test(source[i - 1] || ' ') && source[i + 1] !== '>') { emit(';'); boundary(); continue; }
    emit(c);
    if (/[;|\n]/.test(c) || c === '&' && source[i - 1] === '&') boundary();
  }
  return { clean: chunks.join(''), docs, nested };
}

// Strip only the documented wrapper subset, keeping expansion flags aligned with words.
function unwrap(command) {
  let at = 0; let tight = null; let movesTarget = false; let hidden = false; let script; let scriptExpanding = false;
  const word = i => tight !== null && i === 0 ? tight : command.words[at + i];
  const drop = n => { at = Math.min(command.words.length, at + n); tight = null; };
  let tightReads = 0;
  for (;;) {
    const before = (command.words.length - at);
    while (/^(?:do|then|else|elif|if|while|until|!)$/i.test(word(0) || '')) drop(1);
    const assignment = /^(?:\[[^\]]+\])*\$[\w:]+$/;
    if (assignment.test(word(0) || '') && /^(?:=|\+=|-=|\*=|\/=|%=|\?\?=)$/.test(word(1) || '')) {
      movesTarget ||= /GH_REPO$/i.test(word(0)); hidden = true; drop(2); continue;
    }
    const attachedValue = /^(?:=|\+=|-=|\*=|\/=|%=|\?\?=)(.+)$/s.exec(word(1) || '');
    if (assignment.test(word(0) || '') && attachedValue) { movesTarget ||= /GH_REPO$/i.test(word(0)); hidden = true; drop(1); tight = attachedValue[1]; continue; }
    const joined = /^(?:\[[^\]]+\])*\$([\w:]+)(?:\?\?=|[+*/%=-]?=)(.*)$/.exec(word(0) || '');
    if (joined && tightReads++ < 8) { movesTarget ||= /GH_REPO$/i.test(joined[1]); hidden = true; if (joined[2]) tight = joined[2]; else drop(1); continue; }
    while (/^(?:[A-Za-z_]\w*=|\$env:GH_REPO\s*=)/i.test(word(0) || '')) { if (/^(?:GH_REPO=|\$env:GH_REPO)/i.test(word(0))) movesTarget = true; drop(1); }
    const name = programName(word(0) || '');
    const valueFlags = { time: ['-f','-o'], sudo: ['-u','-g','-h','-p','-C','-T','-D','-R','-U'], doas: ['-u'], nice: ['-n'], timeout: ['-k','-s'], env: ['-u','--unset','-C','--chdir'], xargs: ['-I','-L','-n','-P','-d','-E','-s','-a','--replace','--max-lines','--max-args','--max-procs','--delimiter','--eof','--max-chars','--arg-file'], exec: ['-a'] };
    if (name === 'command') { let i = 1; while (word(i)?.startsWith('-')) { if (word(i) === '-v' || word(i) === '-V') break; i++; } if (word(i) === '-v' || word(i) === '-V') break; }
    if (['nohup','builtin','call','winpty','command','exec','time','sudo','doas','nice','timeout','env','xargs'].includes(name)) {
      drop(1);
      while ((command.words.length - at)) {
        if (/^[A-Za-z_]\w*=/.test(word(0))) { if (/^GH_REPO=/.test(word(0))) movesTarget = true; drop(1); continue; }
        if (word(0) === '--') { drop(1); break; }
        const split = name === 'env' && /^(?:-[iv0]*S|--split-string(?==|$))=?(.*)$/s.exec(word(0));
        if (split) { script = split[1] || word(1); scriptExpanding = Boolean(command.expanding[at + (split[1] ? 0 : 1)]); drop(split[1] ? 1 : 2); break; }
        if (name === 'env' && /^(?:-C|--chdir)(?:=|$)/.test(word(0))) movesTarget = true;
        if (!word(0).startsWith('-')) break;
        const flag = word(0); drop(1);
        if (valueFlags[name]?.includes(flag)) drop(1);
      }
      if (name === 'timeout' && (command.words.length - at)) drop(1);
    }
    if (before === (command.words.length - at)) break;
  }
  const rest = command.words.slice(at); if (tight !== null) rest[0] = tight;
  return { words: rest, expanding: command.expanding.slice(at), movesTarget, hidden, script, scriptExpanding };
}

function wordText(command, i, docs = command.docs || new Map()) {
  const value = command.words[i];
  if (value === undefined) return { value };
  const doc = /^(?:\$\(cat )?(__heredoc_\d+__|__herestr_\d+__)(?:\))?$/.exec(value);
  if (doc) { const found = docs.get(doc[1]); return found?.literal ? { value: found.value } : { unresolved: true }; }
  if (command.expanding?.[i] || /__(?:subst|inert_block|heredoc_\d+|herestr_\d+)__/.test(value)) return { unresolved: true };
  return { value };
}

function stdinText(command) {
  const documents = [...command.docs.values()];
  if (documents.length !== 1 || !documents[0].literal || !command.unreadableInput) throw new Error('Stdin content cannot be inspected. Provide a literal heredoc or readable body file.');
  return documents[0].value;
}
function fileIsGenerated(file, command, commands, index) {
  const basename = String(file).replace(/\\/g, '/').split('/').at(-1);
  if (file === '-' || /^\/dev\/(?:stdin|fd\/)/.test(file)) return 'stdin';
  if (command.movesTarget && !/^(?:\/|[A-Za-z]:[\\/])/.test(file)) return 'moved';
  return commands.some((earlier, j) => j !== index && (j < index || earlier.nested) && (earlier.allWords || earlier.words).some(word => word.includes(basename))) ? 'named' : false;
}

const DATA_COMMAND = /^(?:echo|printf|write-output|write-host|write-warning|write-error|write-verbose|grep|rg|select-string|cat|get-content|git|command)$/i;
// Attached punctuation still runs gh; --name=gh is an option value.
function attachedProgram(word) { return /^-[^{]*=/.test(word) ? word : word.slice(Math.max(word.lastIndexOf('{'), word.lastIndexOf('=')) + 1); }
// POSIX gh refuses this word too. A quoted '--%' stays data.
function dropStopParsing(command, raw) { const keep = command.words.map((word, i) => !(word === '--%' && raw.startsWith('--%', command.offsets[i]))); if (keep.every(Boolean)) return; for (const key of ['words', 'offsets', 'expanding']) command[key] = command[key].filter((_, i) => keep[i]); }
function guardedGh(gh) { return gh && (gh.variable || gh.noun === 'api' || gh.noun === 'pr' && ['create','new','edit'].includes(gh.verb) || gh.noun === 'issue' && gh.verb === 'close'); }
function startProcess(words, expanding, raw, offsets) {
  let target; let argument; let argumentAt; let strict = true; let movesTarget = false;
  const flags = /^(?:-Wait|-NoNewWindow|-PassThru|-UseNewEnvironment)$/i;
  const values = /^(?:-WindowStyle|-WorkingDirectory|-RedirectStandardOutput|-RedirectStandardError|-RedirectStandardInput|-Verb)$/i;
  for (let i = 1; i < words.length; i++) {
    if (flags.test(words[i])) continue;
    if (values.test(words[i])) { movesTarget ||= /^-WorkingDirectory$/i.test(words[i]); if (words[++i] === undefined) strict = false; continue; }
    if (/^-FilePath$/i.test(words[i])) { if (target !== undefined) strict = false; target = words[++i]; continue; }
    if (/^-ArgumentList$/i.test(words[i])) { if (argumentAt !== undefined) strict = false; argumentAt = ++i; argument = words[i]; continue; }
    if (target === undefined && !words[i].startsWith('-')) target = words[i]; else strict = false;
  }
  const literalAt = i => {
    if (i === undefined || expanding[i]) return false;
    const match = /(?:'(?:[^']|'')*'|"[^"`$]*"|[^\s,'"`$@]+)/y; match.lastIndex = offsets[i];
    const found = match.exec(raw); return Boolean(found && (found.index + found[0].length === raw.length || /\s/.test(raw[found.index + found[0].length])));
  };
  const hasGh = words.some(word => /(?:^|[\\/:\s,(@])gh(?:\.exe)?(?:$|\s)/i.test(word));
  const gh = /(?:^|[\\/])gh(?:\.exe)?$/i.test(target || '');
  const literal = strict && literalAt(argumentAt);
  if (gh) return literal ? { script: `${target} ${argument}`, movesTarget } : { unreadableGh: true, movesTarget };
  if (SHELLS.test(target || '') && argumentAt !== undefined) return literal ? { script: `${target} ${argument}`, movesTarget } : { unreadableGh: hasGh, movesTarget };
  return { unreadableGh: !strict && hasGh, movesTarget };
}

function scriptCommands(text, opts = {}) { return executableCommands(text, 0, opts); }
function scriptWords(words, expanding) {
  if (words.length === 1) return words[0];
  return words.map((word,i) => expanding[i] ? '"' + word.replace(/["\\]/g, '\\$&') + '"' : quoteWords([word])).join(' ');
}
function executableCommands(text, depth = 0, context = {}) {
  if (typeof text !== 'string' || text.length > 1024 * 1024 || depth > 4) {
    if (typeof text === 'string' && !/\bgh\b/i.test(text)) return [];
    throw new Error('Executable command read bound exceeded.');
  }
  if (context.uncertainShell || context.cmd) text = text.replace(/\^\r?\n/g, ' ');
  const { clean, docs, nested } = readScript(text, context);
  // Protect substitution sentinels from the generic tokenizer's parenthesis separators.
  const substitutions = [];
  const masked = clean.replace(/\$\((?:cat __heredoc_\d+__|__subst__)\)/g, value => { substitutions.push(value); return `__subword_${substitutions.length - 1}__`; });
  let movesTarget = Boolean(context.movesTarget); const result = [];
  for (const command of shellCommands(masked, context)) {
    dropStopParsing(command, masked);
    command.words = command.words.map((word, i) => word.replace(/__subword_(\d+)__/g, (_, n) => { command.expanding[i] = true; return substitutions[n]; }));
    if (context.outerExpansion) command.expanding = command.expanding.map((value,i) => value || /\$/.test(command.words[i]));
    const unwrapped = unwrap(command); let { words, expanding } = unwrapped;
    const hidden = Boolean(context.hidden || unwrapped.hidden);
    const nextContext = { ...context, hidden };
    movesTarget ||= unwrapped.movesTarget;
    if (unwrapped.script !== undefined) { result.push(...executableCommands(unwrapped.script, depth + 1, { ...nextContext, outerExpansion: context.outerExpansion || unwrapped.scriptExpanding, movesTarget })); continue; }
    if (!words.length) { result.push({ words, expanding, allWords: command.words, sourceWords: command.words, powershell: context.powershell, docs, movesTarget, offsets: command.offsets }); continue; }
    if (/^(?:for|foreach|done|fi|esac)$/i.test(words[0])) continue;
    if (/^(?:export|unset)$/i.test(words[0]) && words.slice(1).some(word => /^GH_REPO(?:=|$)/.test(word))) movesTarget = true;
    if (MOVES_TARGET.test(words[0] + ' ') || /^\$env:GH_REPO$/i.test(words[0])) movesTarget = true;
    const program = programName(words[0]);
    let script = null; let outerExpansion = Boolean(context.outerExpansion);
    if (/^(?:start-process|saps|start)$/i.test(program)) {
      const start = startProcess(words, expanding, masked, command.offsets.slice(command.words.length - words.length));
      movesTarget ||= start.movesTarget;
      if (start.unreadableGh) { result.push({ words: ['gh'], expanding: [false], allWords: words, docs, movesTarget, unreadableGh: true, hidden }); continue; }
      script = start.script;
    } else if (SHELLS.test(words[0])) {
      const kind = POSIX_SHELL.test(program) ? 'posix' : POWERSHELL.test(program) ? 'powershell' : 'cmd';
      const scriptOption = kind === 'posix' ? /^-[A-Za-z]*c[A-Za-z]*$/ : kind === 'powershell' ? /^(?:--?|\/)(?:c|co|com|comm|comma|comman|command|cwa|commandwithargs)(?::(.*))?$/is : /^\/[ck](.*)$/is;
      const index = words.findIndex((word, i) => i > 0 && scriptOption.test(word));
      const attachedScript = kind !== 'posix' && index >= 0 ? scriptOption.exec(words[index])[1] || '' : '';
      let scriptAt = index + 1;
      if (kind === 'posix' && index >= 0) while (words[scriptAt]?.startsWith('-')) { const flag = words[scriptAt++]; if (['-o','-O','--rcfile','--init-file'].includes(flag)) scriptAt++; }
      const here = kind === 'posix' ? words.findIndex(word => word.startsWith('<<<')) : -1;
      const expression = /^(?:eval|iex|invoke-expression)$/.test(program);
      script = expression ? words.slice(1).join(' ') : index >= 0 ? (kind === 'posix' ? words[scriptAt] : [attachedScript, ...words.slice(index + 1)].filter(Boolean).join(' ')) : here >= 0 ? words[here].slice(3) || words[here + 1] : program === 'powershell' ? words.slice(1).join(' ') : null;
      outerExpansion ||= expression ? expanding.slice(1).some(Boolean) : index >= 0 ? kind === 'posix' ? Boolean(expanding[scriptAt]) : expanding.slice(attachedScript ? index : index + 1).some(Boolean) : here >= 0 ? Boolean(expanding[here] || expanding[here + 1]) : program === 'powershell' && expanding.slice(1).some(Boolean);
    }
    if (script) {
      const knownShell = POSIX_SHELL.test(program) || POWERSHELL.test(program);
      const inner = executableCommands(script, depth + 1, { ...nextContext, cmd: program === 'cmd', powershell: POSIX_SHELL.test(program) ? false : POWERSHELL.test(program) ? true : context.powershell, uncertainShell: knownShell ? false : context.uncertainShell, outerExpansion, movesTarget });
      result.push(...inner);
      if (/^(?:eval|iex|invoke-expression)$/.test(program) && inner.some(command => command.movesTarget)) movesTarget = true;
      continue;
    }
    const allWords = [...words]; const kept = []; const keptFlags = [];
    for (let i = 0; i < words.length; i++) {
      if (/^__heredoc_\d+__$/.test(words[i]) && docs.has(words[i])) continue;
      const redirect = /^(?:\d*>>?|\d*<|&>)/.exec(words[i]);
      const offset = command.offsets[command.words.length - words.length + i];
      if (redirect && masked.slice(offset, offset + redirect[0].length) === redirect[0]) { if (words[i] === redirect[0]) i++; continue; }
      kept.push(words[i]); keptFlags.push(expanding[i] || context.powershell && words[i] === '{' && masked[offset] === '{');
    }
    const record = { words: kept, expanding: keptFlags, allWords, sourceWords: command.words, powershell: context.powershell, docs, movesTarget, hidden, unreadableInput: allWords.some(word => docs.has(word)), offsets: command.offsets };
    result.push(record);
    if (ghCommand(kept) || DATA_COMMAND.test(programName(kept[0] || ''))) continue;
    for (let at = 0; at < kept.length; at++) {
      const bare = attachedProgram(kept[at]); if (at === 0 && bare === kept[0]) continue;
      if (guardedGh(ghCommand([bare, ...kept.slice(at + 1, at + 7)]))) { result.push({ ...record, words: [bare, ...kept.slice(at + 1)], expanding: keptFlags.slice(at), hidden: true }); break; }
      if (SHELLS.test(bare) && (/^(?:eval|iex|invoke-expression|powershell)$/.test(programName(bare)) || kept.slice(at + 1, at + 5).some(word => /^(?:-[A-Za-z]*c[A-Za-z]*|--?command|\/[ck]|<<<)/i.test(word)))) {
        result.push(...executableCommands(scriptWords([bare, ...kept.slice(at + 1)], keptFlags.slice(at)), depth + 1, { ...context, hidden: true, movesTarget })); break;
      }
    }
  }
  return [...result, ...nested.flatMap(script => executableCommands(typeof script === 'string' ? script : script.text, depth + 1, { ...context, hidden: context.hidden || script.hidden, movesTarget }).map(command => ({ ...command, nested: true })))];
}

function closureCommands(input, { host } = {}) {
  const text = ShellCall.from(input).text; const context = scriptContext(input, { host });
  const commands = executableCommands(text, 0, context);
  if ((context.uncertainShell || context.codexBash) && /\\"/.test(text)) {
    const alternate = executableCommands(text, 0, { ...context, powershell: true });
    const count = list => list.filter(command => command.unreadableGh || guardedGh(ghCommand(command.words))).length;
    if (count(alternate) > count(commands)) throw Object.assign(new Error('The shell quoting around this GitHub write can be read two ways, so it was refused. Run the GitHub write as its own command, without backslash-escaped quotes around it.'), { complete: true });
  }
  return commands;
}

function ghCommand(words) {
  if (!/(?:^|[\\/])gh(?:\.exe)?$/i.test(words[0] || '')) return null;
  let i = 1; let inherited;
  const repo = () => {
    if (['-R','--repo'].includes(words[i])) { inherited = words[i + 1]; i += 2; return true; }
    if (/^(?:-R.+|--repo=)/.test(words[i] || '')) { inherited = words[i].startsWith('--') ? words[i].slice(7) : words[i].slice(2); i++; return true; }
    return false;
  };
  repo(); const noun = words[i++]; repo(); const verb = noun === 'api' ? null : words[i++];
  const loose = word => /^@|\$/.test(word || '');
  return { inherited, noun, verb, rest: words.slice(i), start: i, variable: loose(noun) || (noun === 'pr' || noun === 'issue') && loose(verb) };
}
function closureWriteCandidate(input, options = {}) {
  const tool = input?.tool_name || '';
  if (!ShellCall.isShellTool(tool)) return /(?:create|update|edit)_pull_request$|close_issue$/.test(tool) || /(?:issue_write|update_issue)$/.test(tool) && String(input?.tool_input?.state).toLowerCase() === 'closed' || GRAPHQL_OPERATION.test(tool);
  return closureCommands(input, options).some(({ words, unreadableGh }) => {
    if (unreadableGh) return true;
    const gh = ghCommand(words); if (!gh) return false;
    if (['--help','-h'].includes(gh.rest.at(-1)) && gh.rest.length === 1) return false;
    return guardedGh(gh);
  });
}

// ---- evidence store pushes ----------------------------------------------------------------------

// The refusal text for a raw git push to an evidence store this computer has bound. The attribution
// guard and the merge hold both show it, so an agent is pointed at the store command, never at a pull
// request.
const STORE_PUSH_MESSAGE = 'This is a raw git push to an evidence store this computer has bound. Store work goes through the store command, which checks the store, scans what it commits for secrets and pushes only the bound branch: node "<Toolkit folder>/repo/scripts/toolkit-store.cjs" save --store <store folder> --path <path in the store> --message <text> --repo-root <governed repository folder> (--repo-root can go when you run it from the governed repository; run toolkit governance status first if it reports a stale binding). A push the owner wants by hand runs in their own terminal.';

// owner/name, lower case, from a github.com remote URL; null for anything else.
function githubSlug(url) {
  const match = /^(?:(?:https?|git):\/\/(?:[^@/\s]+@)?(?:www\.)?github\.com(?::\d+)?\/|(?:[^@/\s:]+@)?(?:ssh\.)?github\.com:(?!\d+\/)|ssh:\/\/(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?::\d+)?\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim());
  return match ? match[1].toLowerCase() : null;
}

module.exports = Object.freeze({ GUARDED_SCREEN: GUARDED, STORE_PUSH_MESSAGE, githubSlug, SHELLS, SHELL_TOOL_NAMES, SHELL_TOOLS, UNREADABLE, ShellCall, MOVES_TARGET, GRAPHQL_OPERATION, connectorTarget, closureCommands, executableCommands, scriptCommands, scriptContext, wordText, stdinText, fileIsGenerated, ghCommand, closureWriteCandidate, absoluteShellPath, argvText, assignVariable, assignmentOf, folderWord, plainGitLine, quoteWords, shellCommands, shellOf, shellPath, shellReadings });
