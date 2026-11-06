'use strict';

// The one reader of a shell tool call, for every hook check that judges a git or gh command: the
// governance gate, the merge hold and the attribution, force-push and push checks. Hosts shape a
// shell call differently:
//   - Claude Code sends Bash, PowerShell or Monitor with a string `command` and the session folder as
//     the top-level `cwd`;
//   - Codex documents Bash with a string `command`, but its shell and exec tools also carry `cmd`,
//     an argument list, and `workdir`, the folder the command runs in, which can differ from `cwd`.
//     Codex Desktop's code-mode exec shell calls are an accepted delivery gap, tracked separately.
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
// The same broad screen the hooks use when a check cannot run: git ... commit or push, gh pr
// create, edit or merge, and gh ... merge, sync, alias or api.
const GUARDED = [/\bgit\b[\s\S]*\b(?:commit|push)\b/i, /\bgh\s+pr\s+(?:create|edit|merge)\b/i, /\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i];

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
    if (quote !== "'" && (char === '\\' || char === '`')) {
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
  // push or touch a pull request, or ''.
  refusal() {
    if (!this.#unreadable) return '';
    return GUARDED.some(pattern => pattern.test(this.#raw)) ? UNREADABLE : '';
  }
}

// Additive closure reader. Only executable positions recurse; arguments of echo, grep, git,
// and other data consumers are never interpreted as scripts. No expansion or execution occurs.
function scriptContext(input) {
  const args = input?.tool_input ?? input?.toolInput ?? {};
  const values = [args.command,args.cmd].filter(value => value != null);
  const name = values.length === 1 && Array.isArray(values[0]) && typeof values[0][0] === 'string' ? programName(values[0][0]) : typeof args.shell === 'string' ? programName(args.shell) : '';
  if (POWERSHELL.test(name)) return { powershell: true, uncertainShell: false };
  if (POSIX_SHELL.test(name)) return { powershell: false, uncertainShell: false };
  const tool = input?.tool_name || input?.toolName;
  return { powershell: tool === 'PowerShell', uncertainShell: tool !== 'PowerShell' && tool !== 'Bash' };
}
const MOVES_TARGET = /(?:^|[\s;&|({])(?:cd|pushd|chdir|set-location|sl)\s|\bGH_REPO\s*=/i;
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
  const pattern = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2(?!\w)/y;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state.quote !== "'" && (c === '\\' || c === '`')) { i++; continue; }
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
  const lines = text.split(/\r?\n/); const lastLine = new Map(lines.map((line, i) => [line.replace(/^\t+/, ''), i]));
  const parts = []; const documentState = { quote: '', frames: [] };
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n];
    const { here, doc } = interpolation ? {} : documentOpening(line, documentState);
    if (here || doc) {
      const marker = here ? here[1] + '@' : doc[3];
      if ((lastLine.get(marker) ?? -1) > n) {
        let end = n + 1;
        while (end < lines.length && (doc?.[1] ? lines[end].replace(/^\t+/, '') : lines[end]) !== marker) end++;
        if (end < lines.length) {
          const body = lines.slice(n + 1, end).map(value => doc?.[1] ? value.replace(/^\t+/, '') : value).join('\n');
          const key = `__${here ? 'herestr' : 'heredoc'}_${docs.size}__`;
          const literal = here ? here[1] === "'" || !/[$`]/.test(body) : Boolean(doc[2]) || !/[$`]/.test(body);
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
  const chunks = []; let prefixText = ''; let quote = ''; const blocks = [];
  const emit = value => { chunks.push(value); if (prefixText.length < 64) prefixText += value.slice(0, 64 - prefixText.length); };
  const boundary = () => { prefixText = ''; };
  const balanced = (start, open, close) => {
    let count = 1; let q = '';
    for (let j = start + 1; j < source.length; j++) {
      const c = source[j];
      if (q !== "'" && (c === '\\' || c === '`')) { j++; continue; }
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
    if (quote !== "'" && (c === '\\' || c === '`')) { emit(c + (source[++i] || '')); continue; }
    // Quotes in expanding document bodies are text, not shell quoting. Only their
    // substitution spans execute; ordinary gh words in that text remain data.
    if (interpolation) { emit(c); continue; }
    if (quote) { if (c === quote) quote = ''; emit(c); continue; }
    if (c === "'" || c === '"') { quote = c; emit(c); continue; }
    if (c === '#' && (i === 0 || /[\s;&|{}]/.test(source[i - 1]))) { while (i + 1 < source.length && source[i + 1] !== '\n') i++; continue; }
    if (c === '{') {
      const prefix = prefixText.trim();
      const keyword = /^(?:for(?:each)?|while|until|if|elif|elseif|else|do|then|try|catch|finally|switch|function|filter|%|\.|foreach-object|invoke-command|icm|start-job|measure-command)(?:\b|\s|$)|^[\w-]+\s*\(\s*\)\s*$/i.test(prefix);
      const attached = i > 0 && !/[\s;&|()}]/.test(source[i - 1]) && source[i - 1] !== '@' && !keyword;
      if (attached) {
        const end = balanced(i, '{', '}');
        if (end < 0) { emit(source.slice(i)); break; }
        emit(source.slice(i, end + 1)); i = end; continue;
      }
      if (!prefix || keyword || blocks.at(-1) === 'switch') {
        blocks.push(/^switch\b/i.test(prefix) ? 'switch' : 'block'); emit(';'); boundary(); continue;
      }
      const end = balanced(i, '{', '}');
      emit(" '__inert_block__' "); if (end < 0) break; i = end; boundary(); continue;
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
  let words = [...command.words]; let expanding = [...command.expanding]; let movesTarget = false; let script; let scriptExpanding = false;
  const drop = n => { words.splice(0, n); expanding.splice(0, n); };
  for (;;) {
    const before = words.length;
    while (/^(?:do|then|else|elif|if|while|until|!)$/i.test(words[0] || '')) drop(1);
    while (/^(?:[A-Za-z_]\w*=|\$env:GH_REPO\s*=)/i.test(words[0] || '')) { if (/^(?:GH_REPO=|\$env:GH_REPO)/i.test(words[0])) movesTarget = true; drop(1); }
    const name = programName(words[0] || '');
    const valueFlags = { time: ['-f','-o'], sudo: ['-u','-g','-h','-p','-C','-T','-D','-R','-U'], doas: ['-u'], nice: ['-n'], timeout: ['-k','-s'], env: ['-u','--unset','-C','--chdir'], xargs: ['-I','-L','-n','-P','-d','-E','-s','-a','--replace','--max-lines','--max-args','--max-procs','--delimiter','--eof','--max-chars','--arg-file'], exec: ['-a'] };
    if (name === 'command' && words.slice(1).some(w => w === '-v' || w === '-V')) break;
    if (['nohup','builtin','call','winpty','command','exec','time','sudo','doas','nice','timeout','env','xargs'].includes(name)) {
      drop(1);
      while (words.length) {
        if (/^[A-Za-z_]\w*=/.test(words[0])) { if (/^GH_REPO=/.test(words[0])) movesTarget = true; drop(1); continue; }
        if (words[0] === '--') { drop(1); break; }
        if (name === 'env' && (words[0] === '-S' || words[0] === '--split-string')) { script = words[1]; scriptExpanding = Boolean(expanding[1]); drop(2); break; }
        if (name === 'env' && /^(?:-C|--chdir)(?:=|$)/.test(words[0])) movesTarget = true;
        if (!words[0].startsWith('-')) break;
        const flag = words[0]; drop(1);
        if (valueFlags[name]?.includes(flag)) drop(1);
      }
      if (name === 'timeout' && words.length) drop(1);
    }
    if (before === words.length) break;
  }
  return { words, expanding, movesTarget, script, scriptExpanding };
}

function wordText(command, i, docs = command.docs || new Map()) {
  const value = command.words[i];
  if (value === undefined) return { value };
  const doc = /^(?:\$\(cat )?(__heredoc_\d+__|__herestr_\d+__)(?:\))?$/.exec(value);
  if (doc) { const found = docs.get(doc[1]); return found?.literal ? { value: found.value } : { unresolved: true }; }
  if (command.expanding?.[i] || /__(?:subst|inert_block|heredoc_\d+|herestr_\d+|unreadable_stdin)__/.test(value)) return { unresolved: true };
  return { value };
}

function stdinText(command) {
  const documents = [...command.docs.values()];
  if (documents.length !== 1 || !documents[0].literal || !command.unreadableInput) throw new Error('Stdin content cannot be inspected. Provide a literal heredoc or readable body file.');
  return documents[0].value;
}
function fileIsGenerated(file, command, commands, index) {
  const basename = String(file).replace(/\\/g, '/').split('/').at(-1);
  return file === '-' || /^\/dev\/(?:stdin|fd\/)/.test(file) || command.movesTarget && !/^(?:\/|[A-Za-z]:[\\/])/.test(file)
    || commands.some((earlier, j) => j !== index && (j < index || earlier.nested) && (earlier.allWords || earlier.words).some(word => word.includes(basename)));
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
  const { clean, docs, nested } = readScript(text, context);
  // Protect substitution sentinels from the generic tokenizer's parenthesis separators.
  const substitutions = [];
  const masked = clean.replace(/\$\((?:cat __heredoc_\d+__|__subst__)\)/g, value => { substitutions.push(value); return `__subword_${substitutions.length - 1}__`; });
  let movesTarget = Boolean(context.movesTarget); const result = [];
  for (const command of shellCommands(masked, context)) {
    command.words = command.words.map((word, i) => word.replace(/__subword_(\d+)__/g, (_, n) => { command.expanding[i] = true; return substitutions[n]; }));
    if (context.outerExpansion) command.expanding = command.expanding.map((value,i) => value || /\$/.test(command.words[i]));
    const unwrapped = unwrap(command); let { words, expanding } = unwrapped;
    movesTarget ||= unwrapped.movesTarget;
    if (unwrapped.script !== undefined) { result.push(...executableCommands(unwrapped.script, depth + 1, { ...context, outerExpansion: context.outerExpansion || unwrapped.scriptExpanding, movesTarget })); continue; }
    if (!words.length) { result.push({ words, expanding, allWords: command.words, docs, movesTarget, offsets: command.offsets }); continue; }
    if (/^(?:for|foreach|done|fi|esac)$/i.test(words[0])) continue;
    if (/^(?:export|unset)$/i.test(words[0]) && words.slice(1).some(word => /^GH_REPO(?:=|$)/.test(word))) movesTarget = true;
    if (MOVES_TARGET.test(words[0] + ' ') || /^\$env:GH_REPO$/i.test(words[0])) movesTarget = true;
    const program = programName(words[0]);
    let script = null; let outerExpansion = Boolean(context.outerExpansion);
    if (/^(?:start-process|saps)$/i.test(program)) {
      const file = words.findIndex(word => /^-filepath$/i.test(word));
      const args = words.findIndex(word => /^-argumentlist$/i.test(word));
      const target = file >= 0 ? words[file + 1] : words[1];
      if (/^(?:gh|gh.exe)$/i.test(target || '') && (args < 0 || words.length === args + 1 || expanding.slice(args + 1).some(Boolean))) {
        result.push({ words: ['gh'], expanding: [false], allWords: words, docs, movesTarget, unreadableGh: true }); continue;
      }
      if (target && args >= 0) script = `${target} ${scriptWords(words.slice(args + 1), expanding.slice(args + 1))}`;
    } else if (SHELLS.test(words[0])) {
      const kind = POSIX_SHELL.test(program) ? 'posix' : POWERSHELL.test(program) ? 'powershell' : 'cmd';
      const index = words.findIndex((word, i) => i > 0 && SCRIPT_OPTION[kind].test(word));
      const expression = /^(?:eval|iex|invoke-expression)$/.test(program);
      script = expression ? words.slice(1).join(' ') : index >= 0 ? (kind === 'posix' ? words[index + 1] : words.slice(index + 1).join(' ')) : program === 'powershell' ? words.slice(1).join(' ') : null;
      outerExpansion ||= expression ? expanding.slice(1).some(Boolean) : index >= 0 ? kind === 'posix' ? Boolean(expanding[index + 1]) : expanding.slice(index + 1).some(Boolean) : program === 'powershell' && expanding.slice(1).some(Boolean);
    }
    if (script) {
      const knownShell = POSIX_SHELL.test(program) || POWERSHELL.test(program);
      const inner = executableCommands(script, depth + 1, { ...context, powershell: POSIX_SHELL.test(program) ? false : POWERSHELL.test(program) ? true : context.powershell, uncertainShell: knownShell ? false : context.uncertainShell, outerExpansion, movesTarget });
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
      kept.push(words[i]); keptFlags.push(expanding[i]);
    }
    result.push({ words: kept, expanding: keptFlags, allWords, docs, movesTarget, unreadableInput: allWords.some(word => docs.has(word)), offsets: command.offsets });
  }
  return [...result, ...nested.flatMap(script => executableCommands(script, depth + 1, { ...context, movesTarget }).map(command => ({ ...command, nested: true })))];
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
  return { inherited, noun, verb, rest: words.slice(i), start: i };
}
function closureWriteCandidate(input) {
  const tool = input?.tool_name || '';
  if (!ShellCall.isShellTool(tool)) return /(?:create|update|edit)_pull_request$|close_issue$/.test(tool) || /(?:issue_write|update_issue)$/.test(tool) && String(input?.tool_input?.state).toLowerCase() === 'closed' || GRAPHQL_OPERATION.test(tool);
  return executableCommands(ShellCall.from(input).text, 0, scriptContext(input)).some(({ words, unreadableGh }) => {
    if (unreadableGh) return true;
    const gh = ghCommand(words); if (!gh) return false;
    if (['--help','-h'].includes(gh.rest.at(-1)) && gh.rest.length === 1) return false;
    return gh.noun === 'api' || gh.noun === 'pr' && ['create','edit'].includes(gh.verb) || gh.noun === 'issue' && gh.verb === 'close';
  });
}

module.exports = Object.freeze({ SHELLS, SHELL_TOOL_NAMES, SHELL_TOOLS, UNREADABLE, ShellCall, MOVES_TARGET, GRAPHQL_OPERATION, connectorTarget, executableCommands, scriptCommands, scriptContext, wordText, stdinText, fileIsGenerated, ghCommand, closureWriteCandidate, absoluteShellPath, argvText, assignVariable, assignmentOf, folderWord, plainGitLine, quoteWords, shellCommands, shellOf, shellPath, shellReadings });
