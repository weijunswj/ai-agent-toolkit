#!/usr/bin/env node
'use strict';

// `toolkit env`: one place for the API keys and tokens your coding apps use, kept in this
// computer's own credential store (see toolkit-env-store.cjs), never in a plain file, a chat or
// a log. Shown to people as `toolkit env <command>`; run as
//   node <Toolkit checkout>/repo/scripts/toolkit-env.cjs <command>
//
//   status                     key names, which apps use them, present or missing (never values)
//   edit                       open a private file in Notepad (or the default editor) listing every key
//   apply                      save what you typed in that file, delete it, refresh the apps
//   set NAME                   save one value from a hidden prompt (or stdin)
//   remove NAME                remove one key, after a yes/no that names it
//   header NAME                print the {"Authorization":"Bearer <value>"} header an app asks for
//   run --names A,B -- CMD     run CMD with only those keys added to its environment
//   connect SERVER --name NAME point an MCP entry in Claude Code and Codex at the store
//   revoke --feeders           put connected MCP entries back as they were
//   import-codex-env           copy the keys in ~/.codex/.env into the store (the file is unchanged)
//   retire-codex-env           move ~/.codex/.env into a private backup once nothing needs it
//
// Values exist only in the store, in the edit file while it is open, on the stdout of `header`,
// and in the environment of the program `run` starts.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const processLaunch = require('./claude-process-launch.cjs');
const {
  EnvStoreError, MAX_VALUE_BYTES, assertName, assertValue, nameProblem, storeForPlatform, supportReference,
} = require('./toolkit-env-store.cjs');
const {
  ClaudeCodeFeeder, CodexFeeder, FeederError, HARNESSES, OPENCODE_SLOT, STATES, assertHeader, assertServer, helperCommand,
} = require('./toolkit-env-feeders.cjs');

const MANIFEST_SCHEMA = 'ai-agent-toolkit.env-manifest.v1';
const EDIT_STALE_MS = 30 * 60 * 1000;
const UNCHANGED = '<unchanged>';
const SCHEMES = new Set(['Bearer', 'none']);
const DUMP_COMMANDS = new Set(['env', 'printenv', 'set', 'export', 'declare', 'typeset', 'compgen']);
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'dash', 'fish']);

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

// Names-only record: each key Toolkit saved (with times) and each MCP entry connected to a key.
// It never holds a value or anything derived from one.
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
      if (error.code === 'ENOENT') return { schema: MANIFEST_SCHEMA, names: {}, bindings: [] };
      throw new EnvError('The Toolkit env record (~/.ai-agent-toolkit/env/manifest.json) could not be read.');
    }
    if (parsed?.schema !== MANIFEST_SCHEMA) throw new EnvError('The Toolkit env record has an unknown format.');
    return { schema: MANIFEST_SCHEMA, names: parsed.names || {}, bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [] };
  }

  // Re-reads the record, applies the change and replaces the file in one step.
  update(change) {
    const record = this.read();
    change(record, this.#now().toISOString());
    writeJsonAtomically(this.#file, record);
    return record;
  }

  touch(record, names, at) {
    for (const name of names) record.names[name] = { added_at: record.names[name]?.added_at || at, updated_at: at };
  }
}

// The editor to open the edit file with, by full path where the system has one: Windows looks for a
// bare program name in the working folder first. Linux's xdg-open is found on PATH (never the folder).
function editorCommand(file, platform = process.platform, environment = process.env) {
  if (platform === 'win32') {
    const root = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
    return [path.win32.join(root, 'System32', 'notepad.exe'), [file]];
  }
  return platform === 'darwin' ? ['/usr/bin/open', ['-t', file]] : ['xdg-open', [file]];
}

function defaultOpener(file, platform = process.platform) {
  const [command, args] = editorCommand(file, platform);
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

const EDIT_HEADER = [
  '# Toolkit env: your keys. Values are never shown here.',
  '# To change a key, replace <unchanged> with the new value (no quotes).',
  '# To add a key, add a line NAME=value. Names look like PROVIDER_SOLUTION_PURPOSE.',
  '# Leaving <unchanged>, a blank value or a deleted line changes nothing.',
  '# To remove a key, use: toolkit env remove NAME',
  '# Save and close this file, then tell your agent "done" (or run: toolkit env apply).',
];

// The private edit file: create, open, read back, delete. One edit at a time; a file not saved
// for 30 minutes is deleted by the next toolkit env command.
class EnvEditSession {
  #directory; #opener; #now; #privateDirectory;

  constructor({ directory, opener = defaultOpener, now = () => new Date(), privateDirectory = ensurePrivateDirectory }) {
    this.#directory = directory;
    this.#opener = opener;
    this.#now = now;
    this.#privateDirectory = privateDirectory;
  }

  #files() {
    let names = [];
    try { names = fs.readdirSync(this.#directory); } catch { return []; }
    return names.filter((name) => /^env-edit-[A-Za-z0-9-]+\.txt$/.test(name)).map((name) => {
      const file = path.join(this.#directory, name);
      return { file, modified: fs.statSync(file).mtimeMs };
    }).sort((left, right) => right.modified - left.modified);
  }

  // Deletes edit files older than 30 minutes; returns how many.
  sweepStale() {
    const now = this.#now().getTime();
    let removed = 0;
    for (const entry of this.#files()) if (now - entry.modified > EDIT_STALE_MS) { this.discard(entry.file); removed += 1; }
    return removed;
  }

  current() {
    const files = this.#files();
    if (files.length > 1) throw new EnvError('More than one edit file is open. Close Notepad, then run toolkit env apply for each, or wait 30 minutes and they are deleted.');
    return files[0]?.file || null;
  }

  async open(names, { launch = true } = {}) {
    let file = this.current();
    const reused = Boolean(file);
    if (!file) {
      this.#privateDirectory(this.#directory);
      file = path.join(this.#directory, `env-edit-${stamp(this.#now())}-${crypto.randomBytes(3).toString('hex')}.txt`);
      fs.writeFileSync(file, `${[...EDIT_HEADER, ...names.map((name) => `${name}=${UNCHANGED}`)].join(os.EOL)}${os.EOL}`, { mode: 0o600, flag: 'wx' });
    }
    const opened = launch ? await this.#opener(file) : false;
    return { file, reused, opened };
  }

  // { values: Map, problems: [line text without values] }. Nothing is saved when problems exist.
  read(file) {
    const values = new Map();
    const problems = [];
    let blank = 0;
    const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
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
      if (values.has(name)) { problems.push(`line ${index + 1}: ${name} appears more than once`); return; }
      if (value === UNCHANGED) return;
      if (value === '' || value === '<remove>') { blank += 1; return; }
      if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) { problems.push(`line ${index + 1}: ${name}: value too long (max ${MAX_VALUE_BYTES} bytes)`); return; }
      values.set(name, value);
    });
    return { values, problems, blank };
  }

  // Overwrites the file before deleting it, so typed values do not linger in free disk space.
  discard(file) {
    try {
      const size = fs.statSync(file).size;
      fs.writeFileSync(file, Buffer.alloc(size));
    } catch {}
    fs.rmSync(file, { force: true });
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
  #store; #manifest; #edit; #feeders; #paths; #ask; #askHidden; #commandFor; #platform; #spawnChild; #now;

  // commandFor(binding) is the helper command an MCP entry runs; it is recorded with each connection.
  constructor({ store, manifest, editSession, feeders, paths, ask, askHidden, commandFor, platform = process.platform, spawnChild = spawn, now = () => new Date() }) {
    this.#store = store;
    this.#manifest = manifest;
    this.#edit = editSession;
    this.#feeders = feeders;
    this.#paths = paths;
    this.#ask = ask;
    this.#askHidden = askHidden;
    this.#commandFor = commandFor;
    this.#platform = platform;
    this.#spawnChild = spawnChild;
    this.#now = now;
  }

  // The real wiring for this user. The helper command always names the managed Toolkit checkout
  // (it survives updates), falling back to this copy only when no managed checkout is recorded.
  // The home folder comes from the given environment, so a test environment never reads real files.
  static forUser({ environment = process.env, homeDir = (process.platform === 'win32' ? environment.USERPROFILE : environment.HOME) || os.homedir(), toolkitRoot, ask, askHidden } = {}) {
    const paths = new EnvPaths({ homeDir, environment });
    let root = toolkitRoot;
    if (!root) {
      try { root = JSON.parse(fs.readFileSync(paths.hubState, 'utf8')).repo_path || ''; } catch {}
      if (!root || !fs.existsSync(path.join(root, 'repo', 'scripts', 'toolkit-env.cjs'))) root = path.resolve(__dirname, '..', '..');
    }
    const commandFor = (binding) => helperCommand({ nodePath: process.execPath, scriptPath: path.join(root, 'repo', 'scripts', 'toolkit-env.cjs'), name: binding.name, header: binding.header, scheme: binding.scheme });
    return new ToolkitEnv({
      store: storeForPlatform(),
      manifest: new EnvManifest({ file: paths.manifest }),
      editSession: new EnvEditSession({ directory: paths.editDir }),
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

  #sweep(out) {
    const removed = this.#edit.sweepStale();
    if (removed) out.push(`Deleted ${removed} unfinished edit file${removed === 1 ? '' : 's'} older than 30 minutes; nothing in ${removed === 1 ? 'it was' : 'them was'} saved.`);
  }

  // One line per app: current, or which entries need attention.
  #feederLines(record = this.#manifest.read()) {
    const lines = [];
    for (const feeder of this.#feeders) {
      const bindings = record.bindings.filter((binding) => binding.harness === feeder.id);
      if (!bindings.length) { lines.push(`${feeder.label}: no MCP entries connected.`); continue; }
      const results = feeder.status(bindings);
      const off = results.filter((result) => result.state !== STATES.CURRENT);
      if (!off.length) lines.push(`${feeder.label}: current (${listNames(bindings.map((binding) => binding.server))}).`);
      else lines.push(`${feeder.label}: ${off.map((result) => `${result.binding.server} ${result.state}`).join(', ')}. Run toolkit env connect ${off[0].binding.server} --name ${off[0].binding.name} to fix it.`);
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
    out.push(names.length ? `${names.length} key${names.length === 1 ? '' : 's'}:` : 'No keys yet. Say "edit my env" or run toolkit env edit to add some.');
    for (const name of names) {
      const users = record.bindings.filter((binding) => binding.name === name)
        .map((binding) => `${this.#feeder(binding.harness)?.label || binding.harness} (${binding.server})`);
      out.push(`  ${name}: ${stored.includes(name) ? 'present' : 'missing'}${users.length ? `, used by ${users.join(', ')}` : ''}`);
    }
    out.push(...this.#feederLines(record));
    out.push('Values are never shown.');
    return { code: 0, out, err: [] };
  }

  async edit({ launch = true } = {}) {
    const out = [];
    this.#sweep(out);
    const names = this.#store.list();
    const session = await this.#edit.open(names, { launch });
    const where = this.#paths.show(session.file);
    if (!launch) out.push(`Edit file: ${session.file}`);
    else if (session.opened) out.push(`${session.reused ? 'Reopened' : 'Opened'} ${where} with your ${names.length} key${names.length === 1 ? '' : 's'}.`);
    else out.push(`Could not open an editor. Open this file yourself: ${session.file}`);
    out.push('Type new values over <unchanged>, add NAME=value lines for new keys, then save and close it. Then say "done" (or run toolkit env apply).');
    return { code: 0, out, err: [] };
  }

  apply() {
    const out = [];
    this.#sweep(out);
    const file = this.#edit.current();
    if (!file) return { code: 0, out: [...out, 'There is no open edit. Say "edit my env" (or run toolkit env edit) first.'], err: [] };
    const { values, problems, blank } = this.#edit.read(file);
    if (problems.length) {
      return { code: 1, out, err: ['Nothing was saved. Fix these lines in the edit file, save it, then apply again:', ...problems.map((problem) => `  ${problem}`), `Edit file: ${file}`] };
    }
    const result = this.#save(values);
    this.#edit.discard(file);
    if (!result.changed.length && !result.added.length) out.push('No changes.');
    if (result.changed.length) out.push(`changed: ${result.changed.join(', ')}`);
    if (result.added.length) out.push(`added: ${result.added.join(', ')}`);
    if (blank) out.push(`${blank} blank value${blank === 1 ? ' was' : 's were'} ignored. To remove a key, use toolkit env remove NAME.`);
    out.push(...this.#feederLines());
    return { code: 0, out, err: [] };
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
      if (failed.length) throw new EnvError(`The store did not keep ${failed.join(', ')}; check it with toolkit env status.`);
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
    this.#manifest.update((record) => { delete record.names[name]; });
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
    if (value === undefined) throw new EnvError(`${name} is not in the Toolkit env store. Add it with toolkit env edit.`);
    return JSON.stringify({ [header]: scheme === 'none' ? value : `${scheme} ${value}` });
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
    if (!this.#store.list().includes(name)) throw new EnvError(`${name} is not in the Toolkit env store yet. Add it first with toolkit env edit or toolkit env set ${name}.`);
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
      out.push('Toolkit will change:', ...changes.map((change) => `  ${change}`), 'A backup of each entry is kept, and toolkit env revoke --feeders puts them back.');
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
    const claude = this.#feeder(HARNESSES.CLAUDE);
    let interim = [];
    try { interim = claude ? claude.interimHelperEntries() : []; } catch {}
    const actions = interim.map((server) => `Claude Code's ${server} entry still uses the old helper that reads ~/.codex/.env. Connect it with toolkit env connect ${server} --name NAME, then delete that helper file.`);
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
      return { state: 'action', summary: `${this.#store.backend} could not be reached.`, actions: [...actions, error instanceof EnvStoreError ? error.message : 'Run toolkit env status to see why.'] };
    }
    const missing = [...new Set(record.bindings.map((binding) => binding.name).filter((name) => !stored.includes(name)))].sort();
    if (missing.length) actions.push(`Connected entries need keys that are not in the store: ${missing.join(', ')}. Add them with toolkit env edit.`);
    for (const binding of record.bindings) {
      const paths = /^"([^"]+)" "([^"]+)"/.exec(binding.command || '');
      if (paths && !(fs.existsSync(paths[1]) && fs.existsSync(paths[2]))) {
        actions.push(`${this.#feeder(binding.harness)?.label || binding.harness} ${binding.server} points at a Node.js or Toolkit copy that moved. Run toolkit env connect ${binding.server} --name ${binding.name} again.`);
      }
    }
    for (const feeder of this.#feeders) {
      const bindings = record.bindings.filter((binding) => binding.harness === feeder.id);
      for (const result of bindings.length ? feeder.status(bindings) : []) {
        if (result.state !== STATES.CURRENT) actions.push(`${feeder.label} ${result.binding.server} ${result.state}. Run toolkit env connect ${result.binding.server} --name ${result.binding.name} to fix it.`);
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
    out.push(`${this.#paths.show(file)} was not changed.`);
    return { code: 0, out, err: [] };
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
    if (notStored.length) throw new EnvError(`Not retired. These keys in the file are not in the store with the same value: ${[...new Set(notStored)].sort().join(', ')}. Run toolkit env import-codex-env, or add them with toolkit env edit.`);
    const codex = this.#feeder(HARNESSES.CODEX);
    const references = codex ? codex.environmentReferences() : [];
    if (references.length) {
      throw new EnvError(`Not retired. Codex still reads keys from its environment for: ${references.map((entry) => `${entry.server} (${entry.name})`).join(', ')}. Connect them first with toolkit env connect SERVER --name NAME.`);
    }
    const note = skipped.length ? ` Lines ${skipped.join(', ')} are not NAME=value with a valid key name and were not imported; check them first.` : '';
    const answer = String(await this.#ask(`Move ${this.#paths.show(file)} into a private backup folder?${note} Type yes to go ahead: `) || '').trim().toLowerCase();
    if (answer !== 'yes' && answer !== 'y') return { code: 0, out: ['Nothing was changed.'], err: [] };
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
        'Restart Codex. Once everything still connects, delete that backup yourself; it is the last plain copy of these values.',
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
  '  edit                         open your keys in Notepad (or your default editor)',
  '  apply                        save the edit, then delete the edit file',
  '  set NAME                     save one value from a hidden prompt',
  '  remove NAME                  remove one key (asks first)',
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

function noExtra(args) {
  // The extra text is not repeated: it may be a value typed in the wrong place.
  if (args.length) throw new EnvError(`There ${args.length === 1 ? 'is 1 argument' : `are ${args.length} arguments`} too many. Never type a value on the command line; run toolkit env for help.`);
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
        case 'status': noExtra(args); return this.#print(env.status());
        case 'edit': { const launch = !takeFlag(args, '--no-open'); noExtra(args); return this.#print(await env.edit({ launch })); }
        case 'apply': noExtra(args); return this.#print(env.apply());
        case 'set': { const [name, ...extra] = args; noExtra(extra); return this.#print(await env.set(name)); }
        case 'remove': { const [name, ...extra] = args; noExtra(extra); return this.#print(await env.remove(name)); }
        case 'header': {
          const header = takeOption(args, '--header') || 'Authorization';
          const scheme = takeOption(args, '--scheme') || 'Bearer';
          const [name, ...extra] = args; noExtra(extra);
          this.#stdout.write(env.header(name, { header, scheme }));
          return 0;
        }
        case 'run': {
          const split = args.indexOf('--');
          if (split === -1) throw new EnvError('Usage: toolkit env run --names A,B -- PROGRAM [ARGS]');
          const before = args.slice(0, split);
          const names = String(takeOption(before, '--names') || '').split(',').map((name) => name.trim()).filter(Boolean);
          noExtra(before);
          const [program, ...programArgs] = args.slice(split + 1);
          return await env.run(names, program, programArgs);
        }
        case 'connect': {
          const name = takeOption(args, '--name');
          const harness = takeOption(args, '--harness') || '';
          const header = takeOption(args, '--header') || 'Authorization';
          const scheme = takeOption(args, '--scheme') || 'Bearer';
          const [server, ...extra] = args; noExtra(extra);
          return this.#print(await env.connect(server, { name, harness, header, scheme }));
        }
        case 'revoke': {
          if (!takeFlag(args, '--feeders')) throw new EnvError('Usage: toolkit env revoke --feeders [--server NAME]');
          const server = takeOption(args, '--server') || '';
          noExtra(args);
          return this.#print(await env.revoke({ server }));
        }
        case 'import-codex-env': noExtra(args); return this.#print(env.importCodexEnv());
        case 'retire-codex-env': noExtra(args); return this.#print(await env.retireCodexEnv());
        case undefined: case 'help': case '--help': this.#stdout.write(`${USAGE.join('\n')}\n`); return 0;
        default: throw new EnvError('That is not a toolkit env command. Run toolkit env for help.');
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

if (require.main === module) {
  const cli = new ToolkitEnvCli({ env: () => ToolkitEnv.forUser({ ask: terminalReader(false), askHidden: terminalReader(true) }) });
  cli.main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = Object.freeze({
  EnvEditSession,
  EnvError,
  EnvManifest,
  EnvPaths,
  ToolkitEnv,
  ToolkitEnvCli,
  dumpsEnvironment,
  editorCommand,
  ensurePrivateDirectory,
  parseDotEnv,
});
