#!/usr/bin/env node
'use strict';

// `toolkit env`: one place for the API keys and tokens your coding apps use, kept in this
// computer's own credential store (see toolkit-env-store.cjs), never in a plain file, a chat or
// a log. Shown to agents as `toolkit env <command>` and to people as the full PowerShell line
// (commandLine); run as
//   node <Toolkit checkout>/repo/scripts/toolkit-env.cjs <command>
//
//   status                     key names, which apps use them, present or missing (never values)
//   edit                       open a private file in Notepad listing every key as NAME=value; each
//                              save is applied (changes, additions, deleted lines remove keys)
//   apply                      "done": apply the last save, delete the file, report names only
//   watch FILE                 (started by edit) the helper that applies each save of FILE
//   set NAME                   save one value from a hidden prompt (or stdin)
//   remove NAME                remove one key, after a yes/no that names it
//   show NAME [--copy]         show one value (or copy it) in the owner's own terminal, never an agent's
//   header NAME                print the {"Authorization":"Bearer <value>"} header an app asks for
//   run --names A,B -- CMD     run CMD with only those keys added to its environment
//   connect SERVER --name NAME point an MCP entry in Claude Code and Codex at the store
//   revoke --feeders           put connected MCP entries back as they were
//   import-codex-env           copy the keys in ~/.codex/.env into the store (the file is unchanged)
//   retire-codex-env           move ~/.codex/.env into a private backup once nothing needs it
//
// Values exist only in the store, in the edit file while it is open (and Notepad's own copy of
// that tab), on the stdout of `header`,
// in the environment of the program `run` starts, and in the owner's own terminal or clipboard
// after `show`.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const processLaunch = require('./claude-process-launch.cjs');
const {
  EnvStoreError, MAX_VALUE_BYTES, PlatformStore, assertName, assertValue, nameProblem, supportReference,
} = require('./toolkit-env-store.cjs');
const {
  ClaudeCodeFeeder, CodexFeeder, FeederError, HARNESSES, OPENCODE_SLOT, STATES, assertHeader, assertServer, helperCommand,
} = require('./toolkit-env-feeders.cjs');

const MANIFEST_SCHEMA = 'ai-agent-toolkit.env-manifest.v1';
const EDIT_STALE_MS = 30 * 60 * 1000;
const EDIT_STABLE_MS = 1500;
const EDIT_TICK_MS = 500;
// Still accepted in commented-out key lines of a stored layout (written by earlier versions).
const UNCHANGED = '<unchanged>';
// Shown instead of a value that one Notepad line cannot hold exactly; the line keeps the value.
const KEPT = /^<kept: change it with toolkit env set ([A-Za-z0-9_]+)>$/;
// The edit file opens in Notepad by full path, so its .env name never picks the app.
const EDIT_FILE = /^env-edit-([0-9a-f]{16})\.env$/;
const editFileName = (id) => `env-edit-${id}.env`;
// Edit files of earlier versions (named .txt, or with another id form): never applied, only wiped.
const ANY_EDIT_FILE = /^env-edit-[A-Za-z0-9-]+\.(?:env|txt)$/;
const EDIT_STATE = 'session.json';
const EDIT_RESULT = 'last-result.json';
const EDIT_WATCH_LOCK = 'watch.lock';
const EDIT_APPLY_LOCK = 'apply.lock';
const EDIT_LOCK_CEILING_MS = 120 * 1000;
const MAX_LAYOUT_LINES = 500;
const MAX_COMMENT_CHARS = 200;
const SCHEMES = new Set(['Bearer', 'none']);
const DUMP_COMMANDS = new Set(['env', 'printenv', 'set', 'export', 'declare', 'typeset', 'compgen']);
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'dash', 'fish']);
// Set (non-empty) in shells that a coding agent starts. Exact names only: a whole prefix such as
// CODEX_ or CLAUDE_ would also match CODEX_HOME or CLAUDE_CONFIG_DIR in the owner's own profile.
const AGENT_MARKERS = Object.freeze([
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT',
  'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED',
]);

function agentContext(environment) { return AGENT_MARKERS.some((name) => Boolean(environment[name])); }

// The PowerShell line a person pastes to run this script: $env:USERPROFILE\... when the script is
// under the home folder, else its absolute path. Never %USERPROFILE%, which PowerShell leaves as is.
function personCommand(scriptPath, home, sub) {
  const relative = path.relative(home, scriptPath);
  const where = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `$env:USERPROFILE\\${relative.replace(/\//g, '\\')}` : scriptPath;
  return `node "${where}" ${sub}`;
}

class EnvError extends Error {
  constructor(message) { super(message); this.code = 'env-stopped'; }
}

function stamp(date) { return date.toISOString().replace(/[:.]/g, '-'); }

function displayHome(file, home) {
  const relative = path.relative(home, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `~/${relative.replace(/\\/g, '/')}` : file;
}

// Where everything lives, from one home folder and environment.
class EnvPaths {
  #home; #environment;

  constructor({ homeDir = os.homedir(), environment = process.env } = {}) {
    this.#home = path.resolve(homeDir);
    this.#environment = environment;
  }

  get home() { return this.#home; }
  get toolkitHome() { return path.join(this.#home, '.ai-agent-toolkit'); }
  get envDir() { return path.join(this.toolkitHome, 'env'); }
  get manifest() { return path.join(this.envDir, 'manifest.json'); }
  get editDir() { return path.join(this.envDir, 'edit'); }
  get backupsDir() { return path.join(this.toolkitHome, 'backups'); }
  get hubState() { return path.join(this.toolkitHome, 'current', 'state.json'); }
  get codexHome() { return path.resolve(this.#environment.CODEX_HOME || path.join(this.#home, '.codex')); }
  get codexEnvFile() { return path.join(this.codexHome, '.env'); }
  get claudeJson() {
    return this.#environment.CLAUDE_CONFIG_DIR ? path.join(this.#environment.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(this.#home, '.claude.json');
  }

  show(file) { return displayHome(file, this.#home); }
}

// Replaces a Windows file's or folder's whole permission list with one entry: full control for
// the current user (inherited by a folder's contents). Removing inherited entries is not enough:
// a folder made where nothing is inherited gets explicit SYSTEM and Administrators entries.
// The path arrives base64-encoded, since Windows PowerShell reads stdin in the console code page.
const WINDOWS_PRIVATE_SCRIPT = String.raw`
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$ErrorActionPreference = 'Stop'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $target = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($request.path))
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.folder) {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    [System.IO.Directory]::SetAccessControl($target, $acl)
  } else {
    $acl = [System.Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))
    [System.IO.File]::SetAccessControl($target, $acl)
  }
  [Console]::Out.Write('ok')
} catch {
  exit 3
}
`;

// Only the current user can open the file or folder: 0700/0600 elsewhere, one entry on Windows.
// Returns false when it could not be done.
function restrictToCurrentUser(target, folder, { platform = process.platform, environment = process.env, spawn: run = spawnSync } = {}) {
  if (platform !== 'win32') { fs.chmodSync(target, folder ? 0o700 : 0o600); return true; }
  const root = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
  const powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PRIVATE_SCRIPT, 'utf16le').toString('base64')], {
    input: JSON.stringify({ path: Buffer.from(target, 'utf8').toString('base64'), folder }), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  return !result.error && result.status === 0 && result.stdout === 'ok';
}

// Puts text on the Windows clipboard, marked so clipboard history and cloud sync skip it where
// Windows honours the marks (best effort). The text arrives base64-encoded on stdin, never in argv.
const WINDOWS_CLIPBOARD_SCRIPT = String.raw`
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()))
  $data = [System.Windows.Forms.DataObject]::new()
  $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $text)
  $data.SetData('ExcludeClipboardContentFromMonitorProcessing', [System.IO.MemoryStream]::new([byte[]]@(0)))
  $data.SetData('CanIncludeInClipboardHistory', [System.IO.MemoryStream]::new([byte[]]@(0, 0, 0, 0)))
  $data.SetData('CanUploadToCloudClipboard', [System.IO.MemoryStream]::new([byte[]]@(0, 0, 0, 0)))
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  [Console]::Out.Write('ok')
} catch {
  exit 3
}
`;

// Returns false when the clipboard could not be set.
function copyToClipboard(text, { platform = process.platform, environment = process.env, spawn: run = spawnSync } = {}) {
  if (platform !== 'win32') return false;
  const root = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
  const powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', Buffer.from(WINDOWS_CLIPBOARD_SCRIPT, 'utf16le').toString('base64')], {
    input: Buffer.from(text, 'utf8').toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  return !result.error && result.status === 0 && result.stdout === 'ok';
}

function ensurePrivateDirectory(directory, options = {}) {
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existed) return;
  if (!restrictToCurrentUser(directory, true, options)) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new EnvError('Toolkit could not make a private folder for this, so it stopped.');
  }
}

// A moved file keeps the permissions it had, so it gets its own.
function makePrivateFile(file, options = {}) {
  if (!restrictToCurrentUser(file, false, options)) throw new EnvError(`The file was moved to ${file}, but Toolkit could not limit it to your account; check its permissions.`);
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Names-only record: each key Toolkit saved (with times), each MCP entry connected to a key, and the
// layout of the edit file (comment lines, key names and blank lines). Assignment values never
// enter the layout. Comments are screened, but arbitrary prose cannot be certified secret-free.
class EnvManifest {
  #file; #now;

  constructor({ file, now = () => new Date() }) {
    this.#file = file;
    this.#now = now;
  }

  get exists() { return fs.existsSync(this.#file); }

  read() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { schema: MANIFEST_SCHEMA, names: {}, bindings: [], layout: [] };
      throw new EnvError('The Toolkit env record (~/.ai-agent-toolkit/env/manifest.json) could not be read.');
    }
    if (parsed?.schema !== MANIFEST_SCHEMA) throw new EnvError('The Toolkit env record has an unknown format.');
    const layout = checkedLayout(parsed.layout === undefined ? [] : parsed.layout);
    return { schema: MANIFEST_SCHEMA, names: parsed.names || {}, bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [], layout };
  }

  // Re-reads the record, applies the change and replaces the file in one step.
  update(change) {
    const record = this.read();
    change(record, this.#now().toISOString());
    checkedLayout(record.layout);
    writeJsonAtomically(this.#file, record);
    return record;
  }

  touch(record, names, at) {
    for (const name of names) record.names[name] = { added_at: record.names[name]?.added_at || at, updated_at: at };
  }
}

// Screen NAME=value assignments, common token prefixes, long opaque runs and hidden controls.
// Empty/unchanged assignments still pass the token screens; NFKC catches fullwidth equals.
// This cannot prove human-readable text is not a password. Refusals never repeat comment text.
function secretLikeComment(text) {
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (char === '\u200d') {
      let before = index - 1;
      while (before >= 0 && /[\uFE0F\p{Emoji_Modifier}]/u.test(chars[before])) before -= 1;
      if (before < 0 || !/\p{Extended_Pictographic}/u.test(chars[before]) || !/\p{Extended_Pictographic}/u.test(chars[index + 1] || '')) return true;
    } else if (/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/u.test(char)) return true;
  }
  const body = text.normalize('NFKC');
  let commentedName = '';
  // Consume each name once, then inspect its suffix rather than retrying a greedy name pattern
  // at every letter when a long comment contains no equals sign.
  for (const match of body.matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu)) {
    let at = match.index + match[0].length;
    while (at < body.length && /\s/u.test(body[at])) at += 1;
    if (body[at] !== '=' || body[at + 1] === '=') continue;
    at += 1;
    while (at < body.length && /\s/u.test(body[at])) at += 1;
    if (at < body.length && body.slice(at).trim() !== UNCHANGED) return true;
    if (body.slice(0, match.index).trim() === '#' && !nameProblem(match[0])) commentedName = match[0];
  }
  if (/(?:^|[^\p{L}\p{N}_])(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[\p{L}\p{N}_-]+/u.test(body)) return true;
  for (const [word] of body.matchAll(/\S+/gu)) {
    const isPath = /^https?:\/\//i.test(word) || ((word.includes('/') || word.includes('\\')) && /\.[A-Za-z0-9]+$/.test(word));
    // For URLs and file paths, screen each component so the separators are not counted as part
    // of one opaque token. Other runs retain the base64 alphabet, including slash and padding.
    const runs = isPath ? /[\p{L}\p{M}\p{N}_\-+=]{24,}/gu : /[\p{L}\p{M}\p{N}_\-+/=.]{24,}/gu;
    // A valid stored-key name may itself be long. Exempt only that name (and its equals),
    // never the rest of the comment or the token-prefix screen above.
    for (const [run] of word.matchAll(runs)) {
      if (commentedName && (run === commentedName || run === `${commentedName}=`)) continue;
      if (/[\p{L}\p{N}]/u.test(run)) return true;
    }
  }
  return false;
}

// Validate both old records and pending writes, so a pre-existing unsafe layout is never copied
// into another edit file or propagated by an unrelated manifest update.
function checkedLayout(layout) {
  if (!Array.isArray(layout) || layout.length > MAX_LAYOUT_LINES) throw new EnvError('The Toolkit env layout has an invalid format or too many lines.');
  const invalid = [];
  layout.forEach((entry, index) => {
    const valid = typeof entry === 'string' && entry === entry.trim() && (entry === '' || (entry.startsWith('#')
      ? entry.length <= MAX_COMMENT_CHARS && !secretLikeComment(entry)
      : !nameProblem(entry)));
    if (!valid) invalid.push(index + 1);
  });
  if (invalid.length) throw new EnvError(`The Toolkit env layout is unsafe or invalid: layout entr${invalid.length === 1 ? 'y' : 'ies'} ${invalid.join(', ')} (counting from 1) in the "layout" list of ~/.ai-agent-toolkit/env/manifest.json. Remove or reword ${invalid.length === 1 ? 'it' : 'them'} before trying again.`);
  return layout;
}

// The names-only layout of env-file lines: comment lines, key names and single blank lines, in
// order. Values are never kept. Lines `skip` matches (the edit file's own header) are left out.
// Returns { layout, refused: [line numbers of comments that look like a secret or are too long] }.
function layoutOf(lines, { skip = () => false } = {}) {
  const layout = [];
  const refused = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (skip(text)) return;
    if (!text) { if (layout.length && layout.at(-1) !== '') layout.push(''); return; }
    if (text.startsWith('#')) {
      if (text.length > MAX_COMMENT_CHARS || secretLikeComment(text)) refused.push(index + 1);
      else layout.push(text);
      return;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(text);
    if (match && !nameProblem(match[1]) && !layout.includes(match[1])) layout.push(match[1]);
  });
  while (layout.at(-1) === '') layout.pop();
  return { layout: layout.slice(0, MAX_LAYOUT_LINES), refused };
}

// A value one NAME=value line gives back exactly: no line breaks, no spaces at either end (they are
// dropped when read), no wrapping quotes (refused when read) and not the kept marker itself.
function fitsOnALine(value) {
  return value !== '' && value === value.trim() && !/[\r\n\u2028\u2029]/.test(value) && !KEPT.test(value)
    && !(value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]);
}

function editLine(name, value) { return `${name}=${fitsOnALine(value) ? value : `<kept: change it with toolkit env set ${name}>`}`; }

// The edit file's body: the stored layout with each stored key as NAME=value, then any stored key
// the layout does not mention. Names in the layout that are no longer stored are left out.
function editBody(values, layout = []) {
  const shown = new Set();
  const body = [];
  for (const entry of layout) {
    if (entry === '' || entry.startsWith('#')) body.push(entry);
    else if (values.has(entry) && !shown.has(entry)) { body.push(editLine(entry, values.get(entry))); shown.add(entry); }
  }
  while (body.at(-1) === '') body.pop();
  const rest = [...values.keys()].sort().filter((name) => !shown.has(name));
  if (rest.length && body.length) body.push('');
  return [...body, ...rest.map((name) => editLine(name, values.get(name)))];
}

// Keeps a layout's comments and blank lines and only the key names that are stored.
function storedLayout(layout, names) {
  const stored = new Set(names);
  const kept = layout.filter((entry) => entry === '' || entry.startsWith('#') || stored.has(entry));
  while (kept.at(-1) === '') kept.pop();
  return kept;
}

// The editor to open the edit file with, by full path: Windows looks for a bare program name in the
// working folder first. Toolkit supports Windows computers only.
function editorCommand(file, platform = process.platform, environment = process.env) {
  if (platform !== 'win32') throw new EnvError(`toolkit env supports Windows only; this computer runs ${platform}.`);
  const root = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
  return [path.win32.join(root, 'System32', 'notepad.exe'), [file]];
}

function defaultOpener(file, platform = process.platform) {
  const [command, args] = editorCommand(file, platform);
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

// Starts the helper that applies each save of an edit file: this script's `watch` command, given
// the file's path only, detached, with no window, no output and no log.
function defaultHelperStarter(file) {
  const child = spawn(process.execPath, [__filename, 'watch', file], { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => {});
  child.unref();
  return true;
}

// The edit file's header, for the person reading it in Notepad. `command(sub)` gives the full line
// to run. Its lines are matched by these fixed beginnings, so the header of a file made by an
// earlier Toolkit version (or for another script path) is never adopted as the user's comment.
const EDIT_STATUS_START = '# Status:';
const EDIT_HEADER_STARTS = Object.freeze([
  '# Toolkit env: your keys',
  '# Close any older Toolkit env tab',
  '# Change a value, add a NAME=value line',
  '# Each save is applied within a few seconds',
  '# A line showing <kept:',
  '# Your own # comment and section lines are kept',
  '# When you are finished, save',
  EDIT_STATUS_START,
  // Earlier versions' headers.
  '# To change a key, replace <unchanged> with the new value',
  '# To add a key, add a line NAME=value.',
  '# Leaving <unchanged>, a blank value or a deleted line changes nothing.',
  '# To remove a key, use:',
  '# Save and close this file',
]);

function editHeader(id, command) {
  return [
    `# Toolkit env: your keys, with their real values (edit ${id}). Keep this file to yourself.`,
    '# Close any older Toolkit env tab: only this newest one is saved.',
    '# Change a value, add a NAME=value line, or delete a line to remove that key. No quotes; spaces at either end are dropped.',
    '# Each save is applied within a few seconds. A save that would remove every key is not applied.',
    '# A line showing <kept: ...> holds a value one line cannot show exactly; leave it, and it stays as it is.',
    '# Your own # comment and section lines are kept (never put a key or token in one).',
    `# When you are finished, save, close this tab, then tell your agent "done", or in PowerShell run: ${command('apply')}`,
    `${EDIT_STATUS_START} nothing saved from this tab yet.`,
  ];
}

function isHeaderLine(text) { return EDIT_HEADER_STARTS.some((start) => text.startsWith(start)); }

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

// A hash of each listed key's stored value, kept with the edit's state, so a later save can tell a key
// that changed outside Toolkit (which leaves no record) from one only this tab touched.
function valueHashes(values) { return Object.fromEntries([...values].map(([name, value]) => [name, sha256(Buffer.from(value, 'utf8'))])); }

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Windows 11 Notepad can keep the text of an open tab in its own tab-restore data after the file is
// deleted, and bring the tab back. Toolkit cannot reliably see that data from an app's shell, so every
// end of an edit says so.
const NOTEPAD_COPY_NOTE = 'Close the Toolkit env tab in Notepad without saving: Notepad can keep its own copy of an open tab and bring it back. To stop that for good, set Notepad > Settings > When Notepad starts to "Start new session".';

// The private edit folder: the open edit file, its names-only state (edit id, when it was made and
// last saved, the key names it listed, a hash of the last content handled), the names-only result
// of saves the helper applied, and the locks. One edit at a time: every new edit replaces the file.
class EnvEditSession {
  #directory; #opener; #now; #privateDirectory; #startHelper; #alive; #lockWaitMs;

  constructor({ directory, opener = defaultOpener, now = () => new Date(), privateDirectory = ensurePrivateDirectory, startHelper = () => false, alive = processAlive, lockWaitMs = 30000 }) {
    this.#directory = directory;
    this.#opener = opener;
    this.#now = now;
    this.#privateDirectory = privateDirectory;
    this.#startHelper = startHelper;
    this.#alive = alive;
    this.#lockWaitMs = lockWaitMs;
  }

  get directory() { return this.#directory; }

  #path(name) { return path.join(this.#directory, name); }

  // Every edit file in the folder, of this version or an earlier one: { file, id } (id null for an earlier one).
  files() {
    let names = [];
    try { names = fs.readdirSync(this.#directory); } catch { return []; }
    return names.filter((name) => ANY_EDIT_FILE.test(name)).sort()
      .map((name) => ({ file: this.#path(name), id: EDIT_FILE.exec(name)?.[1] || null }));
  }

  #readJson(name) {
    try { return JSON.parse(fs.readFileSync(this.#path(name), 'utf8')); } catch { return null; }
  }

  state() {
    const state = this.#readJson(EDIT_STATE);
    return state && typeof state.id === 'string' && EDIT_FILE.test(editFileName(state.id)) ? state : null;
  }

  writeState(state) { writeJsonAtomically(this.#path(EDIT_STATE), state); }

  clearState() { fs.rmSync(this.#path(EDIT_STATE), { force: true }); }

  fileFor(id) { return this.#path(editFileName(id)); }

  // The open edit file, or null.
  currentFile() {
    const state = this.state();
    return state && fs.existsSync(this.fileFor(state.id)) ? this.fileFor(state.id) : null;
  }

  // Names-only results of saves not yet reported by "done".
  result() { return this.#readJson(EDIT_RESULT); }

  addResult({ changed = [], added = [], removed = [], notes = [] } = {}) {
    const result = this.result() || { changed: [], added: [], removed: [], notes: [] };
    const drop = (list, names) => list.filter((name) => !names.includes(name));
    result.removed = drop(result.removed, [...added, ...changed]);
    result.added = [...new Set([...drop(result.added, removed), ...added])].sort();
    result.changed = [...new Set([...drop(result.changed, removed), ...changed])].filter((name) => !result.added.includes(name)).sort();
    result.removed = [...new Set([...result.removed, ...removed])].filter((name) => !result.added.includes(name)).sort();
    result.notes = [...new Set([...result.notes, ...notes])];
    writeJsonAtomically(this.#path(EDIT_RESULT), result);
  }

  takeResult() {
    const result = this.result();
    fs.rmSync(this.#path(EDIT_RESULT), { force: true });
    return result;
  }

  // Runs one save, edit or sweep at a time across the helper and commands.
  // With no edit folder yet there is nothing to guard, and the folder is made private only by create.
  // The lock holds { pid, started_at }. It is taken over only when that process has ended, or after
  // EDIT_LOCK_CEILING_MS as a last resort (a save makes several Credential Manager calls of about a
  // second each, so a live holder can need well over 15 seconds).
  withLock(work) {
    if (!fs.existsSync(this.#directory)) return work();
    const lock = this.#path(EDIT_APPLY_LOCK);
    const until = Date.now() + this.#lockWaitMs;
    let handle;
    for (;;) {
      try { handle = fs.openSync(lock, 'wx'); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let holder = null;
        let age = 0;
        try { age = Date.now() - fs.statSync(lock).mtimeMs; holder = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch {}
        const ended = Number.isInteger(holder?.pid) && !this.#alive(holder.pid);
        if (ended || age > EDIT_LOCK_CEILING_MS) { fs.rmSync(lock, { force: true }); continue; }
        if (Date.now() > until) throw Object.assign(new EnvError('Another toolkit env command is saving your keys right now. Try again in a moment.'), { busy: true });
        sleepSync(50);
      }
    }
    fs.writeSync(handle, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    try { return work(); }
    finally { fs.closeSync(handle); fs.rmSync(lock, { force: true }); }
  }

  // Writes a fresh edit file from `values` and records its state. The caller wipes any older file first.
  create(values, { layout = [], header = () => [] } = {}) {
    this.#privateDirectory(this.#directory);
    const id = crypto.randomBytes(8).toString('hex');
    const file = this.fileFor(id);
    const content = Buffer.from(`${[...header(id), ...editBody(values, layout)].join(os.EOL)}${os.EOL}`, 'utf8');
    fs.writeFileSync(file, content, { mode: 0o600, flag: 'wx' });
    const at = this.#now();
    this.writeState({ id, created_at: at.toISOString(), baseline_at: at.toISOString(), last_save_ms: at.getTime(), snapshot: [...values.keys()].sort(), hashes: valueHashes(values), handled: sha256(content), refused: false });
    return { file, id };
  }

  async open(file) { return this.#opener(file); }

  startHelper(file) {
    try { return Boolean(this.#startHelper(file)); } catch { return false; }
  }

  // { entries: Map name -> { value, line, kept }, problems: [line text without values], layout }.
  // Nothing is saved when problems exist.
  read(file, bytes = fs.readFileSync(file)) {
    const entries = new Map();
    const problems = [];
    // Notepad's "UTF-16 LE/BE" encodings: every line would look wrong, so say what is wrong instead.
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
      return { entries, problems: ['the file is saved as UTF-16; in Notepad use File > Save as with Encoding UTF-8, then save again'], layout: [], utf16: true };
    }
    const lines = bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/);
    const { layout, refused } = layoutOf(lines, { skip: isHeaderLine });
    for (const line of refused) problems.push(`line ${line}: this comment looks like it may hold a key or token (or is over ${MAX_COMMENT_CHARS} characters); remove or reword it`);
    lines.forEach((line, index) => {
      const text = line.trim();
      if (!text || text.startsWith('#')) return;
      const at = text.indexOf('=');
      if (at <= 0) { problems.push(`line ${index + 1} is not NAME=value`); return; }
      const name = text.slice(0, at).trim();
      const value = text.slice(at + 1).trim();
      const problem = nameProblem(name);
      // Never repeat text that is not a valid name: it may be part of a value.
      if (problem) { problems.push(`line ${index + 1}: the text before = is not a valid key name (${problem})`); return; }
      if (entries.has(name)) { problems.push(`line ${index + 1}: the key name appears more than once`); return; }
      if (value === '') { problems.push(`line ${index + 1} has no value; to remove a key, delete its whole line`); return; }
      const kept = KEPT.exec(value);
      if (kept) { entries.set(name, { line: index + 1, kept: kept[1] }); return; }
      // Quotes would be saved as part of the value; the header says to type it without them.
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) { problems.push(`line ${index + 1}: remove the quotes around the value`); return; }
      if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) { problems.push(`line ${index + 1}: value too long (max ${MAX_VALUE_BYTES} bytes)`); return; }
      entries.set(name, { value, line: index + 1 });
    });
    return { entries, problems, layout, utf16: false };
  }

  // Replaces the file's status line (keeping every other line, so line numbers stay put) and
  // returns the hash of what was written. A file whose status line was deleted gets a new one at the
  // top; `textFor(added)` words the status for that case. Writes nothing, and returns null, when the
  // file no longer holds `checked` (a newer save arrived; it is handled on its own).
  writeStatus(file, textFor, checked) {
    let current;
    try { current = fs.readFileSync(file); } catch { return null; }
    if (!current.equals(checked)) return null;
    const content = current.toString('utf8');
    const lines = content.split('\n');
    const index = lines.findIndex((line) => line.trim().startsWith(EDIT_STATUS_START));
    if (index === -1) lines.unshift(`${EDIT_STATUS_START} ${textFor(true)}${content.includes('\r\n') || !content ? os.EOL.replace('\n', '') : ''}`);
    else lines[index] = `${EDIT_STATUS_START} ${textFor(false)}${lines[index].endsWith('\r') ? '\r' : ''}`;
    const bytes = Buffer.from(lines.join('\n'), 'utf8');
    fs.writeFileSync(file, bytes);
    return sha256(bytes);
  }

  hash(file) { try { return sha256(fs.readFileSync(file)); } catch { return null; } }

  // Overwrites the file before deleting it, so typed values do not linger in free disk space.
  discard(file) {
    try {
      const size = fs.statSync(file).size;
      fs.writeFileSync(file, Buffer.alloc(size));
    } catch {}
    fs.rmSync(file, { force: true });
  }

  // The helper's lock: { id, pid } of the one helper watching the folder.
  watchLock() { return this.#readJson(EDIT_WATCH_LOCK); }

  takeWatchLock(id, pid) { writeJsonAtomically(this.#path(EDIT_WATCH_LOCK), { id, pid }); }

  releaseWatchLock(id, pid) {
    const lock = this.watchLock();
    if (lock && lock.id === id && lock.pid === pid) fs.rmSync(this.#path(EDIT_WATCH_LOCK), { force: true });
  }
}

// Parses ~/.codex/.env the way dotenv files are usually written: comments, blank lines, an
// optional `export `, NAME=value with optional single or double quotes. Returns names and values,
// plus the line numbers it could not read (their text is never returned).
function parseDotEnv(text) {
  const entries = [];
  const skipped = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) { skipped.push(index + 1); return; }
    let value = match[2];
    if (value.startsWith('"')) {
      const end = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(value);
      if (!end) { skipped.push(index + 1); return; }
      value = end[1].replace(/\\(.)/g, (whole, char) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }[char] ?? whole));
    } else if (value.startsWith("'")) {
      const end = /^'([^']*)'\s*(?:#.*)?$/.exec(value);
      if (!end) { skipped.push(index + 1); return; }
      value = end[1];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    entries.push({ name: match[1], value, line: index + 1 });
  });
  return { entries, skipped };
}

function listNames(names) { return names.length ? names.join(', ') : 'none'; }

// The commands. Each returns { code, out: [lines], err: [lines] }; `header` and `run` write
// directly. Every value-free message is safe to show; values never reach out or err.
class ToolkitEnv {
  #store; #manifest; #edit; #feeders; #paths; #ask; #askHidden; #askTerminal; #commandFor; #platform; #spawnChild; #now;
  #environment; #scriptPath; #tty; #clipboard;

  // commandFor(binding) is the helper command an MCP entry runs; it is recorded with each connection.
  // scriptPath is the script people are told to run. askTerminal reads one visible line from a
  // terminal only, tty() says whether stdin and stdout are terminals, and clipboard(text) copies.
  constructor({
    store, manifest, editSession, feeders, paths, ask, askHidden, askTerminal, commandFor, platform = process.platform, spawnChild = spawn, now = () => new Date(),
    environment = process.env, scriptPath = __filename, tty = () => ({ stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY) }), clipboard = copyToClipboard,
  }) {
    this.#store = store;
    this.#manifest = manifest;
    this.#edit = editSession;
    this.#feeders = feeders;
    this.#paths = paths;
    this.#ask = ask;
    this.#askHidden = askHidden;
    this.#askTerminal = askTerminal;
    this.#commandFor = commandFor;
    this.#platform = platform;
    this.#spawnChild = spawnChild;
    this.#now = now;
    this.#environment = environment;
    this.#scriptPath = scriptPath;
    this.#tty = tty;
    this.#clipboard = clipboard;
  }

  // How to name a command in a message: `toolkit env <sub>` for an agent (which runs the script
  // itself), the full PowerShell line for a person in their own terminal.
  commandLine(sub) {
    return agentContext(this.#environment) ? `toolkit env ${sub}` : this.#personCommand(sub);
  }

  #personCommand(sub) { return personCommand(this.#scriptPath, this.#paths.home, sub); }

  // The real wiring for this user. The helper command always names the managed Toolkit checkout
  // (it survives updates), falling back to this copy only when no managed checkout is recorded.
  // The home folder comes from the given environment, so a test environment never reads real files.
  static forUser({ environment = process.env, homeDir = (process.platform === 'win32' ? environment.USERPROFILE : environment.HOME) || os.homedir(), toolkitRoot, ask, askHidden, askTerminal, platform = process.platform } = {}) {
    const paths = new EnvPaths({ homeDir, environment });
    let root = toolkitRoot;
    if (!root) {
      try { root = JSON.parse(fs.readFileSync(paths.hubState, 'utf8')).repo_path || ''; } catch {}
      if (!root || !fs.existsSync(path.join(root, 'repo', 'scripts', 'toolkit-env.cjs'))) root = path.resolve(__dirname, '..', '..');
    }
    const scriptPath = path.join(root, 'repo', 'scripts', 'toolkit-env.cjs');
    const commandFor = (binding) => helperCommand({ nodePath: process.execPath, scriptPath, name: binding.name, header: binding.header, scheme: binding.scheme });
    return new ToolkitEnv({
      environment,
      scriptPath,
      askTerminal,
      clipboard: (text) => copyToClipboard(text, { platform, environment }),
      store: new PlatformStore({ platform }),
      manifest: new EnvManifest({ file: paths.manifest }),
      editSession: new EnvEditSession({ directory: paths.editDir, startHelper: defaultHelperStarter }),
      feeders: [
        new ClaudeCodeFeeder({ claudeJson: paths.claudeJson, commandFor }),
        new CodexFeeder({ codexHome: paths.codexHome, commandFor }),
      ],
      paths,
      ask,
      askHidden,
      commandFor,
    });
  }

  #feeder(id) { return this.#feeders.find((feeder) => feeder.id === id); }

  // Wipes edit files that are not the open edit (an older tab saved again, or a file of an earlier
  // version) and closes an edit 30 minutes after its last save. Returns the lines to report.
  #sweepEdits() {
    const lines = [];
    const state = this.#edit.state();
    let earlier = 0;
    for (const { file, id } of this.#edit.files()) {
      if (id && id === state?.id) continue;
      if (!id) { this.#edit.discard(file); earlier += 1; continue; }
      let differs = [];
      try {
        const { entries } = this.#edit.read(file);
        const listed = [...entries].filter(([name, entry]) => !entry.kept && !nameProblem(name)).map(([name]) => name);
        const stored = new Set(this.#store.list());
        const current = this.#store.readAll(listed.filter((name) => stored.has(name)));
        differs = listed.filter((name) => current.get(name) !== entries.get(name).value).sort();
      } catch {}
      this.#edit.discard(file);
      lines.push(`An older Notepad tab was saved and ignored. Use the newest tab; close the older one.${differs.length ? ` Its lines for ${differs.join(', ')} differ from what is stored; retype them in the newest tab if you still want them.` : ''}`);
    }
    // An update in the middle of an edit: the earlier version's helper may already have applied saves
    // from that file, and they are reported with the edit's other saves.
    if (earlier) lines.push(`Deleted ${earlier} edit file${earlier === 1 ? '' : 's'} from an earlier Toolkit version; ${this.#edit.result() ? `saves already applied from ${earlier === 1 ? 'it' : 'them'} are listed with your other saves, and nothing else in ${earlier === 1 ? 'it was' : 'them was'} saved` : `nothing in ${earlier === 1 ? 'it was' : 'them was'} saved`}.`);
    if (state && this.#now().getTime() - state.last_save_ms >= EDIT_STALE_MS) {
      const file = this.#edit.currentFile();
      const unapplied = file && (state.refused || this.#edit.hash(file) !== state.handled);
      if (file) this.#edit.discard(file);
      this.#edit.clearState();
      lines.push(`Closed your env edit 30 minutes after its last save${unapplied ? '; its last save was not applied' : ''}.`);
      if (file) lines.push(NOTEPAD_COPY_NOTE);
    }
    return lines;
  }

  #sweep(out) { out.push(...this.#edit.withLock(() => this.#sweepEdits())); }

  // One line per app: current, or which entries need attention.
  #feederLines(record = this.#manifest.read()) {
    const lines = [];
    for (const feeder of this.#feeders) {
      const bindings = record.bindings.filter((binding) => binding.harness === feeder.id);
      if (!bindings.length) { lines.push(`${feeder.label}: no MCP entries connected.`); continue; }
      const results = feeder.status(bindings);
      const off = results.filter((result) => result.state !== STATES.CURRENT);
      if (!off.length) lines.push(`${feeder.label}: current (${listNames(bindings.map((binding) => binding.server))}).`);
      else lines.push(`${feeder.label}: ${off.map((result) => `${result.binding.server} ${result.state}`).join(', ')}. Run ${this.commandLine(`connect ${off[0].binding.server} --name ${off[0].binding.name}`)} to fix it.`);
    }
    lines.push(`${OPENCODE_SLOT.label}: not supported yet.`);
    return lines;
  }

  status() {
    const out = [];
    this.#sweep(out);
    const record = this.#manifest.read();
    const stored = this.#store.list();
    const names = [...new Set([...stored, ...Object.keys(record.names), ...record.bindings.map((binding) => binding.name)])].sort();
    out.push(`Toolkit env store: ${this.#store.backend}`);
    out.push(names.length ? `${names.length} key${names.length === 1 ? '' : 's'}:` : `No keys yet. Ask your agent to show your keys, or run ${this.commandLine('edit')} to add some.`);
    for (const name of names) {
      const users = record.bindings.filter((binding) => binding.name === name)
        .map((binding) => `${this.#feeder(binding.harness)?.label || binding.harness} (${binding.server})`);
      out.push(`  ${name}: ${stored.includes(name) ? 'present' : 'missing'}${users.length ? `, used by ${users.join(', ')}` : ''}`);
    }
    out.push(...this.#feederLines(record));
    const pending = this.#edit.result();
    if (pending) out.push(...this.#resultLines(pending, 'Saved from Notepad since the last "done"'));
    out.push('Values are never shown.');
    return { code: 0, out, err: [] };
  }

  // Every edit writes a fresh file from the store: an open edit file is wiped first (never saved
  // or merged), and its helper exits because its file has gone.
  async edit({ launch = true } = {}) {
    const out = [];
    const created = this.#edit.withLock(() => {
      out.push(...this.#sweepEdits());
      const state = this.#edit.state();
      const file = this.#edit.currentFile();
      if (file) {
        const unapplied = state.refused || this.#edit.hash(file) !== state.handled;
        this.#edit.discard(file);
        if (unapplied) out.push('Your last save in the earlier tab was not applied; the new file shows what is stored now.');
      }
      this.#edit.clearState();
      out.push(...this.#resultLines(this.#edit.takeResult(), 'Saved from the earlier tab'));
      const names = this.#store.list();
      const values = this.#store.readAll(names);
      const made = this.#edit.create(values, { layout: this.#manifest.read().layout, header: (id) => editHeader(id, (sub) => this.#personCommand(sub)) });
      return { ...made, count: values.size };
    });
    const watching = this.#edit.startHelper(created.file);
    const opened = launch ? await this.#edit.open(created.file) : false;
    const where = this.#paths.show(created.file);
    if (!launch) out.push(`Edit file: ${created.file}`);
    else if (opened) out.push(`Opened ${where} with your ${created.count} key${created.count === 1 ? '' : 's'}. Close any older Toolkit env tab.`);
    else out.push(`Could not open an editor. Open this file yourself: ${created.file}`);
    out.push(watching
      ? 'Change a value, add a NAME=value line, or delete a line to remove that key, then save: each save is applied within a few seconds.'
      : 'Change a value, add a NAME=value line, or delete a line to remove that key, then save: your saves are applied when you finish.');
    out.push(agentContext(this.#environment) ? 'When finished, close the tab and say "done" (or run toolkit env apply).' : `When finished, close the tab and run: ${this.commandLine('apply')}`);
    return { code: 0, out, err: [] };
  }

  // "done": applies the last save if it was not applied yet, deletes the edit file and reports, by
  // name only, everything the edit changed, added and removed.
  apply() {
    return this.#edit.withLock(() => {
      const out = this.#sweepEdits();
      const state = this.#edit.state();
      const file = this.#edit.currentFile();
      if (!file) {
        if (state) this.#edit.clearState();
        const earlier = this.#edit.takeResult();
        if (earlier) return { code: 0, out: [...out, ...this.#resultLines(earlier, 'Saved'), ...this.#feederLines()], err: [] };
        return { code: 0, out: [...out, `There is no open edit. Ask your agent to show your keys, or run ${this.commandLine('edit')} first.`], err: [] };
      }
      if (state.refused || this.#edit.hash(file) !== state.handled) {
        const outcome = this.#applySave(file, state);
        if (!outcome.ok) return { code: 1, out, err: [...this.#refusalLines(outcome), `Edit file: ${file}`] };
      }
      this.#edit.discard(file);
      this.#edit.clearState();
      const result = this.#edit.takeResult();
      out.push(...this.#resultLines(result, null));
      out.push(NOTEPAD_COPY_NOTE);
      out.push(...this.#feederLines());
      return { code: 0, out, err: [] };
    });
  }

  // The names-only lines for a result; `label` prefixes them when they report an earlier tab.
  #resultLines(result, label) {
    if (!result) return label ? [] : ['No changes.'];
    const lines = [...result.notes];
    const named = [['changed', result.changed], ['added', result.added], ['removed', result.removed]].filter(([, names]) => names.length);
    if (!named.length) { if (!label) lines.push('No changes.'); return lines; }
    for (const [kind, names] of named) lines.push(`${label ? `${label}, ` : ''}${kind}: ${names.join(', ')}`);
    return lines;
  }

  #refusalLines(outcome) {
    if (outcome.problems) return ['Nothing was saved. Fix these lines in the edit file and save it again (then say "done"):', ...outcome.problems.map((problem) => `  ${problem}`)];
    if (outcome.conflicts) return [`Your keys changed while this tab was open, so nothing was saved: ${outcome.conflicts.join(', ')}. Ask for your keys again for a fresh tab, and copy your changes across from this one.`];
    return [`Nothing was saved: this save would remove every key. To remove them all, run ${this.commandLine('remove NAME')} for each one.`];
  }

  // `added`: the status line is new at the top, so the save's line numbers are one lower than shown.
  #statusText(outcome, added) {
    const time = this.#now().toISOString().slice(11, 16);
    if (outcome.problems) return `NOT SAVED (${time} UTC). Fix: ${outcome.problems.join('; ')}${added ? ' (line numbers count from the line below this one)' : ''}`;
    if (outcome.conflicts) return `NOT SAVED (${time} UTC). These keys changed while this tab was open: ${outcome.conflicts.join(', ')}. Ask for your keys again for a fresh tab, and copy your changes across.`;
    return `NOT SAVED (${time} UTC). This save would remove every key.`;
  }

  // Applies one save of the open edit file, whole or not at all, and records the outcome: on
  // success the state moves on to what is now stored; on refusal the file's status line says why.
  #applySave(file, state) {
    const bytes = fs.readFileSync(file);
    const outcome = this.#checkSave(file, state, bytes);
    const now = this.#now();
    if (!outcome.ok) {
      const parsed = !outcome.utf16;
      const written = parsed ? this.#edit.writeStatus(file, (added) => this.#statusText(outcome, added), bytes) : null;
      this.#edit.writeState({ ...state, refused: true, handled: written || sha256(bytes), last_save_ms: now.getTime() });
      return outcome;
    }
    this.#edit.writeState({ ...state, baseline_at: outcome.at, snapshot: outcome.snapshot, hashes: outcome.hashes, refused: false, handled: sha256(bytes), last_save_ms: now.getTime() });
    this.#edit.addResult(outcome);
    return outcome;
  }

  // The save's changes, additions and removals, or why none can be made. A key listed when the tab
  // was made (or last saved) that changed elsewhere since, or a key added elsewhere that the file
  // also sets differently, is a conflict; only keys the tab listed can be removed.
  #checkSave(file, state, bytes) {
    const parsed = this.#edit.read(file, bytes);
    const problems = [...parsed.problems];
    const stored = new Set(this.#store.list());
    for (const [name, entry] of parsed.entries) {
      if (entry.kept && (entry.kept !== name || !stored.has(name))) problems.push(`line ${entry.line}: a <kept: ...> line works only for the key it was written for; type the value instead`);
    }
    if (problems.length) return { ok: false, problems, utf16: parsed.utf16 };
    const snapshot = new Set(state.snapshot);
    const record = this.#manifest.read();
    const listed = [...parsed.entries.keys()];
    const current = this.#store.readAll([...new Set([...listed, ...snapshot])].filter((name) => stored.has(name)));
    const hashes = state.hashes || {};
    const elsewhere = (name) => (record.names[name]?.updated_at || '') > state.baseline_at
      || (name in hashes && current.has(name) && sha256(Buffer.from(current.get(name), 'utf8')) !== hashes[name]);
    const writes = new Map();
    const conflicts = [];
    for (const [name, entry] of parsed.entries) {
      if (entry.kept || current.get(name) === entry.value) continue;
      if (snapshot.has(name) ? !stored.has(name) || elsewhere(name) : stored.has(name)) conflicts.push(name);
      else writes.set(name, entry.value);
    }
    const removals = [...snapshot].filter((name) => !parsed.entries.has(name) && stored.has(name)).sort();
    conflicts.push(...removals.filter(elsewhere));
    if (conflicts.length) return { ok: false, conflicts: [...new Set(conflicts)].sort() };
    // An emptied tab (select all, delete, save) removes every key it listed; a key added elsewhere
    // meanwhile must not turn that into an allowed save.
    if (removals.length && removals.length === [...snapshot].filter((name) => stored.has(name)).length) return { ok: false, removeAll: true };
    if (writes.size) {
      this.#store.writeAll(writes);
      const after = this.#store.readAll([...writes.keys()]);
      const failed = [...writes.keys()].filter((name) => after.get(name) !== writes.get(name)).sort();
      if (failed.length) throw new EnvError(`The store did not keep ${failed.join(', ')}; check it with ${this.commandLine('status')}.`);
    }
    for (const name of removals) this.#store.remove(name);
    const left = this.#store.list();
    const stuck = removals.filter((name) => left.includes(name));
    if (stuck.length) throw new EnvError(`The store did not remove ${stuck.join(', ')}; check it with ${this.commandLine('status')}.`);
    let at = '';
    this.#manifest.update((current, now) => {
      at = now;
      this.#manifest.touch(current, [...writes.keys()], now);
      for (const name of removals) delete current.names[name];
      current.layout = storedLayout(parsed.layout, left);
    });
    return {
      ok: true,
      at,
      snapshot: listed.filter((name) => left.includes(name)).sort(),
      // What each listed key now holds: this save's value, or the stored one it left alone.
      hashes: valueHashes(new Map(listed.filter((name) => left.includes(name)).map((name) => [name, writes.has(name) ? writes.get(name) : current.get(name)]))),
      changed: [...writes.keys()].filter((name) => stored.has(name)).sort(),
      added: [...writes.keys()].filter((name) => !stored.has(name)).sort(),
      removed: removals,
    };
  }

  // The helper behind every save: one per edit folder, watching only the open edit file. Each tick
  // wipes older tabs, applies a save once the file has stopped changing for 1.5 seconds, and ends
  // the edit 30 minutes after its last save. It prints nothing; results go to the edit folder.
  editWatcher(file, { pid = process.pid, alive = processAlive } = {}) {
    const resolved = path.resolve(String(file || ''));
    const id = EDIT_FILE.exec(path.basename(resolved))?.[1];
    if (!id || path.dirname(resolved) !== path.resolve(this.#edit.directory)) throw new EnvError('watch only follows a Toolkit env edit file in its own folder.');
    let seen = '';
    let since = 0;
    const statKey = () => { try { const stat = fs.statSync(resolved); return `${stat.size}:${stat.mtimeMs}`; } catch { return null; } };
    const release = () => { this.#edit.releaseWatchLock(id, pid); return false; };
    return {
      start: () => {
        const lock = this.#edit.watchLock();
        if (lock && lock.id === id && lock.pid !== pid && alive(lock.pid)) return false;
        if (this.#edit.state()?.id !== id) return false;
        this.#edit.takeWatchLock(id, pid);
        seen = statKey() || '';
        since = this.#now().getTime();
        return true;
      },
      tick: () => {
        const lock = this.#edit.watchLock();
        if (!lock || lock.id !== id || lock.pid !== pid) return false;
        try {
          return this.#edit.withLock(() => {
            const notes = this.#sweepEdits();
            if (notes.length) this.#edit.addResult({ notes });
            const state = this.#edit.state();
            if (!state || state.id !== id) return release();
            const key = statKey();
            if (!key) return release();
            const now = this.#now().getTime();
            if (key !== seen) { seen = key; since = now; }
            else if (now - since >= EDIT_STABLE_MS && this.#edit.hash(resolved) !== state.handled) this.#applySave(resolved, state);
            return true;
          });
        } catch (error) {
          // A command holding the lock for a moment: try again on the next tick.
          if (error.busy) return true;
          throw error;
        }
      },
    };
  }

  // Runs the helper until its edit ends. Errors end it quietly: the next command sweeps the folder.
  async watch(file) {
    const watcher = this.editWatcher(file);
    if (!watcher.start()) return 0;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        let going = false;
        try { going = watcher.tick(); } catch {}
        if (!going) { clearInterval(timer); resolve(); }
      }, EDIT_TICK_MS);
    });
    return 0;
  }

  // Writes only what differs, reads it back and records names.
  #save(values) {
    const names = [...values.keys()].sort();
    const before = this.#store.readAll(names);
    const changes = new Map(names.filter((name) => before.get(name) !== values.get(name)).map((name) => [name, values.get(name)]));
    if (changes.size) {
      this.#store.writeAll(changes);
      const after = this.#store.readAll([...changes.keys()]);
      const failed = [...changes.keys()].filter((name) => after.get(name) !== changes.get(name));
      if (failed.length) throw new EnvError(`The store did not keep ${failed.join(', ')}; check it with ${this.commandLine('status')}.`);
      this.#manifest.update((record, at) => this.#manifest.touch(record, [...changes.keys()], at));
    }
    return {
      changed: [...changes.keys()].filter((name) => before.has(name)),
      added: [...changes.keys()].filter((name) => !before.has(name)),
    };
  }

  async set(name) {
    assertName(name);
    const out = [];
    this.#sweep(out);
    const value = await this.#askHidden(`Type the value for ${name} (it is not shown), then press Enter: `);
    assertValue(name, value);
    const result = this.#save(new Map([[name, value]]));
    out.push(result.added.length ? `added: ${name}` : result.changed.length ? `changed: ${name}` : `${name} already had that value; nothing changed.`);
    out.push(...this.#feederLines());
    return { code: 0, out, err: [] };
  }

  async remove(name) {
    assertName(name);
    const out = [];
    this.#sweep(out);
    if (!this.#store.list().includes(name)) return { code: 0, out: [...out, `${name} is not in the store; nothing to remove.`], err: [] };
    const users = this.#manifest.read().bindings.filter((binding) => binding.name === name)
      .map((binding) => `${this.#feeder(binding.harness)?.label || binding.harness} (${binding.server})`);
    const warning = users.length ? ` ${users.join(' and ')} will stop connecting until you add it again.` : '';
    const answer = String(await this.#ask(`Remove ${name} from the Toolkit env store?${warning} Type yes to remove it: `) || '').trim().toLowerCase();
    if (answer !== 'yes' && answer !== 'y') return { code: 0, out: [...out, `Kept ${name}.`], err: [] };
    this.#store.remove(name);
    this.#manifest.update((record) => { delete record.names[name]; record.layout = (record.layout || []).filter((entry) => entry !== name); });
    out.push(`removed: ${name}`);
    out.push(...this.#feederLines());
    return { code: 0, out, err: [] };
  }

  // Prints exactly one JSON header object for the app that asked. Nothing else on stdout.
  header(name, { header = 'Authorization', scheme = 'Bearer' } = {}) {
    assertName(name);
    assertHeader(header);
    if (!SCHEMES.has(scheme)) throw new EnvError('The scheme is Bearer or none.');
    const value = this.#store.read(name);
    if (value === undefined) throw new EnvError(`${name} is not in the Toolkit env store. Add it with ${this.commandLine('edit')}.`);
    return JSON.stringify({ [header]: scheme === 'none' ? value : `${scheme} ${value}` });
  }

  // Shows one value to the owner in a terminal they opened themselves, or copies it. Every check
  // runs before the store is read: one name, no agent marker, a real terminal on both ends, the key
  // exists, and the owner retypes its name. Nothing about it is recorded.
  async show(name, { copy = false } = {}) {
    assertName(name);
    if (agentContext(this.#environment)) {
      throw new EnvError(`toolkit env show only runs in a PowerShell window you opened yourself, not through an agent or an app's built-in terminal. Open PowerShell and run: ${this.#personCommand(`show ${name}${copy ? ' --copy' : ''}`)}`);
    }
    const tty = this.#tty();
    if (!tty.stdin || !tty.stdout) throw new EnvError('show needs a terminal you type into; it does not read from a pipe or print into a file.');
    if (!this.#store.list().includes(name)) throw new EnvError(`${name} is not in the Toolkit env store.`);
    const answer = await this.#askTerminal(`Type ${name} again to show its value: `);
    if (answer !== name) return { code: 0, out: ['Not shown.'], err: [] };
    const value = this.#store.read(name);
    if (value === undefined) throw new EnvError(`${name} is not in the Toolkit env store.`);
    if (!copy) return { code: 0, out: [value], err: ['Shown once. Clear the window when done (Clear-Host) and don\'t paste it into a chat.'] };
    if (!this.#clipboard(value)) throw new EnvError('The value could not be put on the clipboard, so nothing was copied.');
    return { code: 0, out: [], err: [`Copied ${name} to the clipboard. Windows clipboard history (Win+V) and clipboard sync across devices can keep a copy; clear it in Settings > System > Clipboard > Clear.`] };
  }

  // Starts the program with only the named keys added, and passes its exit code back.
  async run(names, command, args, { stdio = 'inherit' } = {}) {
    if (!names.length) throw new EnvError('Name the keys to pass with --names A,B.');
    names.forEach(assertName);
    if (!command) throw new EnvError('Give the program to run after --.');
    if (dumpsEnvironment(command, args)) throw new EnvError(`toolkit env run does not start ${path.basename(command)} with these arguments, because it would print the environment.`);
    const values = this.#store.readAll(names);
    const missing = names.filter((name) => !values.has(name));
    if (missing.length) throw new EnvError(`Not in the Toolkit env store: ${missing.join(', ')}.`);
    let parts;
    try { parts = processLaunch.directSpawnParts(command, args, { label: 'Program', platform: this.#platform }); }
    catch (error) { throw new EnvError(/command script/.test(error.message) ? error.message : 'The program after -- was not found.'); }
    return new Promise((resolve) => {
      const child = this.#spawnChild(parts.command, parts.args, {
        env: { ...process.env, ...Object.fromEntries(values) },
        stdio,
        windowsHide: true,
        shell: false,
      });
      child.once('error', () => resolve(127));
      child.once('close', (code) => resolve(code === null ? 1 : code));
    });
  }

  // Connects an MCP entry in each app that has it (or the named app) to a stored key.
  async connect(server, { name, harness = '', header = 'Authorization', scheme = 'Bearer' }) {
    assertServer(server);
    assertName(name);
    assertHeader(header);
    if (!SCHEMES.has(scheme)) throw new EnvError('The scheme is Bearer or none.');
    if (!this.#store.list().includes(name)) throw new EnvError(`${name} is not in the Toolkit env store yet. Add it first with ${this.commandLine('edit')} or ${this.commandLine(`set ${name}`)}.`);
    const wanted = harness ? harness.split(',').map((entry) => entry.trim()) : this.#feeders.map((feeder) => feeder.id);
    const unknown = wanted.filter((id) => !this.#feeder(id));
    if (unknown.length) throw new EnvError('--harness takes claude-code, codex or both, separated by a comma.');
    const out = [];
    const plans = [];
    for (const id of wanted) {
      const feeder = this.#feeder(id);
      const binding = { harness: id, server, name, header, scheme, command: this.#commandFor({ name, header, scheme }) };
      const plan = feeder.plan(binding);
      if (!plan.ok) {
        if (harness) throw new FeederError(plan.hold);
        out.push(`Skipped ${feeder.label}: ${plan.hold}`);
        continue;
      }
      plans.push({ feeder, binding, plan });
    }
    if (!plans.length) throw new EnvError('No app has an MCP entry with that name that Toolkit can connect. Check the name with claude mcp list or in the Codex config.');
    const changes = plans.flatMap((entry) => entry.plan.changes);
    if (changes.length) {
      out.push('Toolkit will change:', ...changes.map((change) => `  ${change}`), `A backup of each entry is kept, and ${this.commandLine('revoke --feeders')} puts them back.`);
      const answer = String(await this.#ask(`Connect ${server} to ${name} in ${plans.map((entry) => entry.feeder.label).join(' and ')}? Type yes to go ahead: `) || '').trim().toLowerCase();
      if (answer !== 'yes' && answer !== 'y') return { code: 0, out: [...out, 'Nothing was changed.'], err: [] };
    }
    const backupDir = path.join(this.#paths.backupsDir, 'env-feeders', `${stamp(this.#now())}-${server}`);
    let restart = false;
    for (const { feeder, binding, plan } of plans) {
      let backup = '';
      if (!plan.current) {
        ensurePrivateDirectory(path.dirname(backupDir));
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const result = await feeder.project(binding, { backupDir });
        restart = restart || Boolean(result.restart);
        if (result.load_check) out.push(result.load_check.detail);
        backup = backupDir;
      }
      this.#manifest.update((record, at) => {
        const existing = record.bindings.find((entry) => entry.harness === binding.harness && entry.server === server);
        const kept = existing?.backup || backup;
        record.bindings = record.bindings.filter((entry) => entry !== existing);
        record.bindings.push({ ...binding, bound_at: at, ...(kept ? { backup: kept } : {}) });
      });
      out.push(`${feeder.label}: ${server} ${plan.current ? 'was already connected' : 'now reads'} ${name} from the store.`);
    }
    if (restart) out.push('Restart Codex once so it loads the new entry. After that, changed values apply on the next connection.');
    return { code: 0, out, err: [] };
  }

  async revoke({ server = '' } = {}) {
    const record = this.#manifest.read();
    const bindings = record.bindings.filter((binding) => !server || binding.server === server);
    if (!bindings.length) return { code: 0, out: ['No connected MCP entries to put back.'], err: [] };
    const listed = bindings.map((binding) => `${this.#feeder(binding.harness)?.label || binding.harness} ${binding.server}`);
    const answer = String(await this.#ask(`Put ${listed.join(', ')} back as they were before Toolkit connected them? Type yes to go ahead: `) || '').trim().toLowerCase();
    if (answer !== 'yes' && answer !== 'y') return { code: 0, out: ['Nothing was changed.'], err: [] };
    const out = [];
    let restart = false;
    for (const binding of bindings) {
      const feeder = this.#feeder(binding.harness);
      if (binding.backup) {
        const result = await feeder.revoke(binding);
        restart = restart || Boolean(result.restart);
        if (result.load_check) out.push(result.load_check.detail);
      }
      this.#manifest.update((current) => {
        current.bindings = current.bindings.filter((entry) => !(entry.harness === binding.harness && entry.server === binding.server));
      });
      out.push(`${feeder.label}: ${binding.server} is back to how it was.`);
    }
    if (restart) out.push('Restart Codex so it loads the restored entry.');
    return { code: 0, out, err: [] };
  }

  // For the install check: the store, keys a connected entry needs but the store lacks, entries
  // that drifted, and entries still on the old helper that read ~/.codex/.env. Names only.
  // { state: 'not-set-up' | 'passed' | 'action', summary, actions: [] }
  health() {
    // No key store on this computer (Toolkit supports Windows only): nothing to check.
    if (typeof this.#store.available === 'function' && !this.#store.available()) return { state: 'skipped', summary: 'no key store on this computer', actions: [] };
    const claude = this.#feeder(HARNESSES.CLAUDE);
    let interim = [];
    try { interim = claude ? claude.interimHelperEntries() : []; } catch {}
    const actions = interim.map((server) => `Claude Code's ${server} entry still uses the old helper that reads ~/.codex/.env. Connect it with ${this.commandLine(`connect ${server} --name NAME`)}, then delete that helper file.`);
    if (!this.#manifest.exists) {
      return interim.length ? { state: 'action', summary: 'An MCP entry still uses the old ~/.codex/.env helper.', actions } : { state: 'not-set-up', summary: 'not set up', actions: [] };
    }
    const record = this.#manifest.read();
    if (!record.bindings.length) {
      const count = Object.keys(record.names).length;
      return { state: actions.length ? 'action' : 'passed', summary: `${this.#store.backend}, ${count} key${count === 1 ? '' : 's'} saved, no connected entries.`, actions };
    }
    let stored;
    try { stored = this.#store.list(); }
    catch (error) {
      return { state: 'action', summary: `${this.#store.backend} could not be reached.`, actions: [...actions, error instanceof EnvStoreError ? error.message : `Run ${this.commandLine('status')} to see why.`] };
    }
    const missing = [...new Set(record.bindings.map((binding) => binding.name).filter((name) => !stored.includes(name)))].sort();
    if (missing.length) actions.push(`Connected entries need keys that are not in the store: ${missing.join(', ')}. Add them with ${this.commandLine('edit')}.`);
    for (const binding of record.bindings) {
      const paths = /^"([^"]+)" "([^"]+)"/.exec(binding.command || '');
      if (paths && !(fs.existsSync(paths[1]) && fs.existsSync(paths[2]))) {
        actions.push(`${this.#feeder(binding.harness)?.label || binding.harness} ${binding.server} points at a Node.js or Toolkit copy that moved. Run ${this.commandLine(`connect ${binding.server} --name ${binding.name}`)} again.`);
      }
    }
    for (const feeder of this.#feeders) {
      const bindings = record.bindings.filter((binding) => binding.harness === feeder.id);
      for (const result of bindings.length ? feeder.status(bindings) : []) {
        if (result.state !== STATES.CURRENT) actions.push(`${feeder.label} ${result.binding.server} ${result.state}. Run ${this.commandLine(`connect ${result.binding.server} --name ${result.binding.name}`)} to fix it.`);
      }
    }
    const summary = `${this.#store.backend}, ${stored.length} key${stored.length === 1 ? '' : 's'}, ${record.bindings.length} connected entr${record.bindings.length === 1 ? 'y' : 'ies'}`;
    return { state: actions.length ? 'action' : 'passed', summary: actions.length ? `${summary}; needs attention.` : `${summary}, all current.`, actions };
  }

  // Copies each NAME=value of ~/.codex/.env into the store and checks each one by reading it back.
  // The file is not changed. Keys already stored with a different value keep the stored value.
  importCodexEnv() {
    const out = [];
    this.#sweep(out);
    const file = this.#paths.codexEnvFile;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { return { code: 0, out: [...out, `There is no ${this.#paths.show(file)} to import.`], err: [] }; }
    const { entries, skipped } = parseDotEnv(text);
    const notRule = [];
    const tooLong = [];
    const empty = [];
    const candidates = new Map();
    for (const { name, value, line } of entries) {
      // A name that fails the rule may be part of a value (a value on its own line), so it is
      // reported by line number only.
      if (nameProblem(name)) notRule.push(line);
      else if (value === '') empty.push(name);
      else if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) tooLong.push(name);
      else candidates.set(name, value);
    }
    const stored = this.#store.readAll([...candidates.keys()]);
    const differs = [...candidates.keys()].filter((name) => stored.has(name) && stored.get(name) !== candidates.get(name));
    for (const name of differs) candidates.delete(name);
    const already = [...candidates.keys()].filter((name) => stored.get(name) === candidates.get(name));
    const toWrite = new Map([...candidates].filter(([name]) => !already.includes(name)));
    if (toWrite.size) {
      this.#store.writeAll(toWrite);
      const back = this.#store.readAll([...toWrite.keys()]);
      const failed = [...toWrite.keys()].filter((name) => back.get(name) !== toWrite.get(name));
      if (failed.length) throw new EnvError(`Read-back failed for ${failed.join(', ')}. Nothing else was changed; keep ${this.#paths.show(file)}.`);
      this.#manifest.update((record, at) => this.#manifest.touch(record, [...toWrite.keys()], at));
    }
    out.push(`imported: ${toWrite.size} name${toWrite.size === 1 ? '' : 's'}${toWrite.size ? ` (${[...toWrite.keys()].sort().join(', ')})` : ''}`);
    if (already.length) out.push(`already in the store with the same value: ${already.sort().join(', ')}`);
    if (differs.length) out.push(`kept the store's value (it differs from the file): ${differs.sort().join(', ')}`);
    if (notRule.length) out.push(`not imported, line${notRule.length === 1 ? '' : 's'} ${notRule.join(', ')}: the text before = is not a valid key name (names look like PROVIDER_SOLUTION_PURPOSE; check ${notRule.length === 1 ? 'it' : 'them'} in Notepad)`);
    if (empty.length) out.push(`not imported, empty value: ${empty.sort().join(', ')}`);
    if (tooLong.length) out.push(`not imported, value too long (max ${MAX_VALUE_BYTES} bytes): ${tooLong.sort().join(', ')}`);
    if (skipped.length) out.push(`skipped lines: ${skipped.join(', ')} (not NAME=value; check them in Notepad before retiring the file)`);
    out.push(...this.#adoptLayout(text));
    out.push(`${this.#paths.show(file)} was not changed.`);
    return { code: 0, out, err: [] };
  }

  // Saves an env file's comment and section lines (and key order) as the edit layout when Toolkit has
  // none yet, so they survive the file being retired. Returns the lines to report.
  #adoptLayout(text) {
    const { layout, refused } = layoutOf(String(text).replace(/^\uFEFF/, '').split(/\r?\n/));
    const out = [];
    if (refused.length) out.push(`not kept as layout, comment line${refused.length === 1 ? '' : 's'} ${refused.join(', ')}: ${refused.length === 1 ? 'it looks' : 'they look'} like ${refused.length === 1 ? 'it' : 'they'} may hold a key or token`);
    const comments = layout.filter((entry) => entry.startsWith('#')).length;
    if (!comments) return out;
    if (this.#manifest.read().layout.length) return [...out, 'Kept your existing toolkit env edit layout; the file\'s comment lines were not copied.'];
    this.#manifest.update((record) => { record.layout = storedLayout(layout, this.#store.list()); });
    return [...out, `kept ${comments} comment line${comments === 1 ? '' : 's'} and the key order for toolkit env edit (names and comments only).`];
  }

  // Moves ~/.codex/.env into a private backup folder once every key in it is in the store and no
  // Codex MCP entry still reads one from the environment. Never deletes it.
  async retireCodexEnv() {
    const file = this.#paths.codexEnvFile;
    if (!fs.existsSync(file)) return { code: 0, out: [`There is no ${this.#paths.show(file)}; nothing to retire.`], err: [] };
    const parsed = parseDotEnv(fs.readFileSync(file, 'utf8'));
    // Lines whose text before = is not a valid name are reported by number only, like other lines
    // that are not NAME=value: that text may be part of a value.
    const entries = parsed.entries.filter((entry) => !nameProblem(entry.name));
    const skipped = [...parsed.skipped, ...parsed.entries.filter((entry) => nameProblem(entry.name)).map((entry) => entry.line)].sort((a, b) => a - b);
    const stored = this.#store.readAll(entries.map((entry) => entry.name));
    const notStored = entries.filter((entry) => stored.get(entry.name) !== entry.value).map((entry) => entry.name);
    if (notStored.length) throw new EnvError(`Not retired. These keys in the file are not in the store with the same value: ${[...new Set(notStored)].sort().join(', ')}. Run ${this.commandLine('import-codex-env')}, or add them with ${this.commandLine('edit')}.`);
    const codex = this.#feeder(HARNESSES.CODEX);
    const references = codex ? codex.environmentReferences() : [];
    if (references.length) {
      throw new EnvError(`Not retired. Codex still reads keys from its environment for: ${references.map((entry) => `${entry.server} (${entry.name})`).join(', ')}. Connect them first with ${this.commandLine('connect SERVER --name NAME')}.`);
    }
    const note = skipped.length ? ` Lines ${skipped.join(', ')} are not NAME=value with a valid key name and were not imported; check them first.` : '';
    const answer = String(await this.#ask(`Move ${this.#paths.show(file)} into a private backup folder?${note} Type yes to go ahead: `) || '').trim().toLowerCase();
    if (answer !== 'yes' && answer !== 'y') return { code: 0, out: ['Nothing was changed.'], err: [] };
    const text = fs.readFileSync(file, 'utf8');
    const layoutLines = this.#adoptLayout(text);
    // Comment lines the record does not hold exist only in the file, so the backup is their only copy.
    const fileLayout = layoutOf(text.replace(/^\uFEFF/, '').split(/\r?\n/));
    const kept = new Set(this.#manifest.read().layout);
    const onlyHere = fileLayout.refused.length + fileLayout.layout.filter((entry) => entry.startsWith('#') && !kept.has(entry)).length;
    ensurePrivateDirectory(this.#paths.backupsDir);
    const folder = path.join(this.#paths.backupsDir, `env-retire-${stamp(this.#now())}`);
    ensurePrivateDirectory(folder);
    const target = path.join(folder, 'codex.env');
    fs.renameSync(file, target);
    makePrivateFile(target);
    return {
      code: 0,
      out: [
        `Moved ${this.#paths.show(file)} to ${this.#paths.show(target)}.`,
        ...layoutLines,
        `Restart Codex. Once everything still connects, delete that backup yourself; it is the last plain copy of these values${onlyHere ? `, and the only copy of ${onlyHere} comment line${onlyHere === 1 ? '' : 's'}` : ''}.`,
        `To undo before then, move it back to ${this.#paths.show(file)} and restart Codex.`,
      ],
      err: [],
    };
  }
}

// Commands that would print the whole environment, run directly or through a shell.
function dumpsEnvironment(command, args) {
  const base = path.basename(String(command)).toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, '');
  if (DUMP_COMMANDS.has(base)) return true;
  if (!SHELLS.has(base)) return false;
  const text = args.join(' ').toLowerCase();
  if (/\benv:|\$env:|\[environment\]::getenvironmentvariables/.test(text)) return true;
  return /(?:^|[\s;&|(/])(?:env|printenv|set|export|declare|typeset|compgen)(?:\s*$|\s*[;&|)]|\s+-p\b)/.test(text);
}

const USAGE = [
  'toolkit env keeps your API keys and tokens in this computer\'s credential store.',
  '  status                       list keys and which apps use them (values are never shown)',
  '  edit                         open your keys in Notepad as NAME=value lines; every save is applied',
  '  apply                        finish the edit: apply the last save, then delete the edit file',
  '  set NAME                     save one value from a hidden prompt',
  '  remove NAME                  remove one key (asks first)',
  '  show NAME [--copy]           show one value, or copy it, in a PowerShell window you opened yourself',
  '  connect SERVER --name NAME   connect an MCP entry in Claude Code and Codex to a key',
  '  revoke --feeders             put connected MCP entries back as they were',
  '  run --names A,B -- PROGRAM   run a program with only those keys in its environment',
  '  header NAME                  print the header an app asks for (used by the apps)',
  '  import-codex-env             copy ~/.codex/.env into the store (the file is unchanged)',
  '  retire-codex-env             move ~/.codex/.env to a private backup once nothing needs it',
];

function takeOption(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new EnvError(`${flag} needs a value.`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function noExtra(args, env) {
  // The extra text is not repeated: it may be a value typed in the wrong place.
  if (args.length) throw new EnvError(`There ${args.length === 1 ? 'is 1 argument' : `are ${args.length} arguments`} too many. Never type a value on the command line; run ${env.commandLine('help')} for help.`);
}

// Parses arguments and maps every failure to a plain message with a reference. No other work.
class ToolkitEnvCli {
  #env; #stdout; #stderr;

  constructor({ env, stdout = process.stdout, stderr = process.stderr }) {
    this.#env = env;
    this.#stdout = stdout;
    this.#stderr = stderr;
  }

  #print(result) {
    if (result.out.length) this.#stdout.write(`${result.out.join('\n')}\n`);
    if (result.err.length) this.#stderr.write(`${result.err.join('\n')}\n`);
    return result.code;
  }

  async main(argv) {
    const [command, ...rest] = argv;
    const args = [...rest];
    try {
      const env = typeof this.#env === 'function' ? this.#env() : this.#env;
      switch (command) {
        case 'status': noExtra(args, env); return this.#print(env.status());
        case 'edit': { const launch = !takeFlag(args, '--no-open'); noExtra(args, env); return this.#print(await env.edit({ launch })); }
        case 'apply': noExtra(args, env); return this.#print(env.apply());
        case 'watch': { const [file, ...extra] = args; noExtra(extra, env); return await env.watch(file); }
        case 'set': { const [name, ...extra] = args; noExtra(extra, env); return this.#print(await env.set(name)); }
        case 'remove': { const [name, ...extra] = args; noExtra(extra, env); return this.#print(await env.remove(name)); }
        case 'show': { const copy = takeFlag(args, '--copy'); const [name, ...extra] = args; noExtra(extra, env); return this.#print(await env.show(name, { copy })); }
        case 'header': {
          const header = takeOption(args, '--header') || 'Authorization';
          const scheme = takeOption(args, '--scheme') || 'Bearer';
          const [name, ...extra] = args; noExtra(extra, env);
          this.#stdout.write(env.header(name, { header, scheme }));
          return 0;
        }
        case 'run': {
          const split = args.indexOf('--');
          if (split === -1) throw new EnvError(`Usage: ${env.commandLine('run --names A,B -- PROGRAM [ARGS]')}`);
          const before = args.slice(0, split);
          const names = String(takeOption(before, '--names') || '').split(',').map((name) => name.trim()).filter(Boolean);
          noExtra(before, env);
          const [program, ...programArgs] = args.slice(split + 1);
          return await env.run(names, program, programArgs);
        }
        case 'connect': {
          const name = takeOption(args, '--name');
          const harness = takeOption(args, '--harness') || '';
          const header = takeOption(args, '--header') || 'Authorization';
          const scheme = takeOption(args, '--scheme') || 'Bearer';
          const [server, ...extra] = args; noExtra(extra, env);
          return this.#print(await env.connect(server, { name, harness, header, scheme }));
        }
        case 'revoke': {
          if (!takeFlag(args, '--feeders')) throw new EnvError(`Usage: ${env.commandLine('revoke --feeders [--server NAME]')}`);
          const server = takeOption(args, '--server') || '';
          noExtra(args, env);
          return this.#print(await env.revoke({ server }));
        }
        case 'import-codex-env': noExtra(args, env); return this.#print(env.importCodexEnv());
        case 'retire-codex-env': noExtra(args, env); return this.#print(await env.retireCodexEnv());
        case undefined: case 'help': case '--help': this.#stdout.write(`${USAGE.join('\n')}\n`); return 0;
        default: throw new EnvError(`That is not a toolkit env command. Run ${env.commandLine('help')} for help.`);
      }
    } catch (error) {
      const reference = supportReference();
      const known = error instanceof EnvError || error instanceof EnvStoreError || error instanceof FeederError;
      this.#stderr.write(known
        ? `${error.message} (${reference})\n`
        : `Toolkit env stopped because of an unexpected problem (${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}). Nothing was shown or logged. (${reference})\n`);
      return 1;
    }
  }
}

// Reads one line; on a terminal the typed text is hidden (for values).
function terminalReader(hidden) {
  return (question) => new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const chunks = [];
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(hidden ? text.replace(/\r?\n$/, '') : text.split(/\r?\n/)[0]);
      });
      if (!hidden) process.stderr.write(question);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => { if (text.includes(question)) process.stderr.write(question); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stderr.write('\n');
      resolve(answer);
    });
  });
}

// Reads one visible line from a terminal only. Unlike terminalReader, it never reads a pipe.
function ttyLine(question) {
  if (!process.stdin.isTTY) return Promise.reject(new EnvError('show needs a terminal you type into; it does not read from a pipe or print into a file.'));
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

if (require.main === module) {
  const cli = new ToolkitEnvCli({ env: () => ToolkitEnv.forUser({ ask: terminalReader(false), askHidden: terminalReader(true), askTerminal: ttyLine }) });
  cli.main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = Object.freeze({
  AGENT_MARKERS,
  EnvEditSession,
  EnvError,
  EnvManifest,
  EnvPaths,
  ToolkitEnv,
  ToolkitEnvCli,
  copyToClipboard,
  dumpsEnvironment,
  editorCommand,
  ensurePrivateDirectory,
  parseDotEnv,
});
