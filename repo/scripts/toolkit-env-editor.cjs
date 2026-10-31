'use strict';

// The editor side of `toolkit env edit`: which app the computer opens a `.env` file with, the
// command that opens the edit file in it, and the cleanup of the copies VS Code-style editors keep
// of that file (Local History and hot-exit backups) once an edit ends. Only program file names and
// counts leave this module; file contents are never read beyond the first line of a backup.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// VS Code-style editors, by program file name: the name used in messages and the user data folder
// they share (same History and Backups layout).
const VSCODE_STYLE = Object.freeze({
  'code.exe': { label: 'VS Code', data: 'Code' },
  'code - insiders.exe': { label: 'VS Code Insiders', data: 'Code - Insiders' },
  'vscodium.exe': { label: 'VSCodium', data: 'VSCodium' },
  'cursor.exe': { label: 'Cursor', data: 'Cursor' },
});

// Reads the program Windows opens a `.env` file with: the newer UserChoiceLatest choice, then the
// older UserChoice, then the class of `.env` itself, and that ProgId's open command. Prints
// {"command":"..."} (empty when nothing is set). Reads the registry only.
const WINDOWS_APP_SCRIPT = String.raw`
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$ErrorActionPreference = 'Stop'
try {
  $ext = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.env'
  $prog = ''
  try { $prog = [string](Get-ItemProperty -LiteralPath "$ext\UserChoiceLatest\ProgId").ProgId } catch {}
  if (-not $prog) { try { $prog = [string](Get-ItemProperty -LiteralPath "$ext\UserChoice").ProgId } catch {} }
  if (-not $prog) { try { $prog = [string](Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\.env').'(default)' } catch {} }
  $command = ''
  if ($prog) { try { $command = [string](Get-ItemProperty -LiteralPath "Registry::HKEY_CLASSES_ROOT\$prog\shell\open\command").'(default)' } catch {} }
  [Console]::Out.Write((@{ command = $command } | ConvertTo-Json -Compress))
} catch {
  exit 3
}
`;

// The program an open command starts: its first token, quoted or not, with %NAME% expanded.
// Returns '' unless that is an absolute path.
function commandProgram(command, environment = process.env) {
  const text = String(command || '').trim();
  const first = text.startsWith('"') ? (/^"([^"]+)"/.exec(text) || [])[1] || '' : text.split(/\s+/)[0] || '';
  const lookup = Object.fromEntries(Object.entries(environment).map(([name, value]) => [name.toLowerCase(), value]));
  const expanded = first.replace(/%([^%]+)%/g, (whole, name) => lookup[name.toLowerCase()] ?? whole);
  return path.win32.isAbsolute(expanded) && !expanded.includes('%') ? path.win32.normalize(expanded) : '';
}

// { program: absolute path or '', name: lower-case program file name or '' }. Windows only.
function findEnvApp({ platform = process.platform, environment = process.env, spawn: run = spawnSync } = {}) {
  if (platform !== 'win32') return { program: '', name: '' };
  const root = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
  const powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_APP_SCRIPT, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (result.error || result.status !== 0) return { program: '', name: '' };
  let command = '';
  try { command = String(JSON.parse(result.stdout).command || ''); } catch {}
  const program = commandProgram(command, environment);
  return { program, name: program ? path.win32.basename(program).toLowerCase() : '' };
}

function isVscodeStyle(name) { return Object.hasOwn(VSCODE_STYLE, String(name || '').toLowerCase()); }

function appLabel(name) { return VSCODE_STYLE[String(name || '').toLowerCase()]?.label || ''; }

// The command that opens the edit file, always by absolute path and never through cmd or a bare
// program name. Windows: a VS Code-style editor found for `.env` starts by its own path in a new
// window with no folder (so workspace extensions and IDE links do not attach to it); anything
// else goes through the Windows shell, which uses the app chosen for `.env` or asks for one.
// macOS and Linux lines are here for when a store exists there; toolkit env stops before them today.
function editorCommand(file, { platform = process.platform, environment = process.env, app = { program: '', name: '' } } = {}) {
  if (platform === 'win32') {
    if (isVscodeStyle(app.name) && app.program && path.win32.isAbsolute(app.program)) return [app.program, ['--new-window', file]];
    const root = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows';
    return [path.win32.join(root, 'explorer.exe'), [file]];
  }
  if (platform === 'darwin') return ['/usr/bin/open', [file]];
  if (platform === 'linux') return ['/usr/bin/xdg-open', [file]];
  throw new Error(`No way to open a file on ${platform}.`);
}

// The environment an editor starts with: this one without the switch that makes an Electron app
// run as plain Node.js (set in some apps' terminals), which would stop VS Code opening a window.
function editorEnvironment(environment = process.env) {
  const copy = { ...environment };
  for (const name of Object.keys(copy)) if (/^ELECTRON_RUN_AS_NODE$/i.test(name)) delete copy[name];
  return copy;
}

// The user data folders of the VS Code-style editors that exist on this computer.
function editorDataFolders({ platform = process.platform, environment = process.env, homeDir }) {
  let base = '';
  if (platform === 'win32') base = environment.APPDATA || (homeDir ? path.join(homeDir, 'AppData', 'Roaming') : '');
  else if (platform === 'darwin') base = homeDir ? path.join(homeDir, 'Library', 'Application Support') : '';
  else base = environment.XDG_CONFIG_HOME || (homeDir ? path.join(homeDir, '.config') : '');
  if (!base) return [];
  return [...new Set(Object.values(VSCODE_STYLE).map((entry) => entry.data))]
    .map((name) => path.join(base, name)).filter((folder) => { try { return fs.statSync(folder).isDirectory(); } catch { return false; } });
}

// The local path a `file:` URI names (as VS Code writes them), or ''.
function uriPath(uri, platform = process.platform) {
  const match = /^file:\/\/([^/]*)(\/[^\s]*)$/i.exec(String(uri || ''));
  if (!match || match[1]) return '';
  let decoded;
  try { decoded = decodeURIComponent(match[2]); } catch { return ''; }
  if (platform !== 'win32') return decoded;
  return /^\/[A-Za-z]:\//.test(decoded) ? path.win32.normalize(decoded.slice(1)) : '';
}

function sameFolder(a, b, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const left = pathApi.resolve(a);
  const right = pathApi.resolve(b);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function wipe(file) {
  try {
    const size = fs.statSync(file).size;
    fs.writeFileSync(file, Buffer.alloc(size));
  } catch {}
  fs.rmSync(file, { force: true });
}

// The first line of a file, read in small pieces up to 64 KiB.
function firstLine(file) {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(65536);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString('utf8');
    const end = text.indexOf('\n');
    return end === -1 ? text : text.slice(0, end);
  } catch { return ''; } finally { if (handle !== undefined) fs.closeSync(handle); }
}

function list(folder) { try { return fs.readdirSync(folder, { withFileTypes: true }); } catch { return []; } }

// Removes the copies the editors in `folders` keep of edit files in `editDir`, other than `keep`:
// Local History folders whose entries.json names such a file, and hot-exit backups whose first line
// does. Each copy is overwritten with zeros, then deleted. Nothing else is touched, and folders that
// cannot be read are skipped. Returns how many copies were removed.
function cleanEditorCopies({ editDir, folders, isEditFile, keep = '', platform = process.platform }) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const ours = (uri) => {
    const file = uriPath(uri, platform);
    if (!file || !sameFolder(pathApi.dirname(file), editDir, platform) || !isEditFile(pathApi.basename(file))) return false;
    return !(keep && sameFolder(file, keep, platform));
  };
  let removed = 0;
  for (const folder of folders) {
    const history = path.join(folder, 'User', 'History');
    for (const entry of list(history)) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(history, entry.name);
      let resource = '';
      try { resource = JSON.parse(fs.readFileSync(path.join(dir, 'entries.json'), 'utf8')).resource; } catch { continue; }
      if (!ours(resource)) continue;
      for (const item of list(dir)) {
        if (!item.isFile()) continue;
        if (item.name !== 'entries.json') removed += 1;
        wipe(path.join(dir, item.name));
      }
      try { fs.rmdirSync(dir); } catch {}
    }
    const backups = path.join(folder, 'Backups');
    for (const window of list(backups)) {
      if (!window.isDirectory()) continue;
      const files = path.join(backups, window.name, 'file');
      for (const item of list(files)) {
        if (!item.isFile()) continue;
        const backup = path.join(files, item.name);
        if (!ours(firstLine(backup).split(' ')[0])) continue;
        wipe(backup);
        removed += 1;
      }
    }
  }
  return removed;
}

module.exports = Object.freeze({
  VSCODE_STYLE,
  appLabel,
  cleanEditorCopies,
  commandProgram,
  editorCommand,
  editorDataFolders,
  editorEnvironment,
  findEnvApp,
  isVscodeStyle,
  uriPath,
});
