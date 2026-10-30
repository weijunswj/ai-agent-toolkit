#!/usr/bin/env node
'use strict';

// A Codex chat keeps the hook commands it loaded at start, and they name that version's plugin cache
// folder. Installing a newer Toolkit makes Codex delete every older version folder, so the open chat's
// hooks would point at missing files, and Codex lets a tool call run when its hook cannot start. After
// a plugin update, setup writes a small stand-in at each replaced version's path: the current hook
// launchers, this file under the hook script names, and a marker. In the open chat the stand-in refuses
// commits, pushes, pull requests, edits, MCP calls and helper launches with "open a new chat", and lets
// other shell commands and prompts through, so the chat can still read and talk.
//
// The stand-in has no plugin manifest, so Codex never loads it as a plugin. Codex removes it at the
// next plugin update (it deletes every older version folder), and setup removes any it finds after
// STAND_IN_MAX_AGE_DAYS. Removal condition for this file: once no supported upgrade starts from a
// version whose installed hook commands lack the missing-file check, drop the stand-in writer.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const MARKER_NAME = '.toolkit-superseded.json';
const STAND_IN_MAX_AGE_DAYS = 7;
const MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const PLUGIN_NAME = 'ai-agent-toolkit';
const SCRIPT_DIR = ['repo', 'scripts'];
// The hook scripts a Codex hook command names, by role. The .cjs names run this file; the .ps1
// launchers are copied from the current Toolkit and act on the marker.
const NODE_SCRIPTS = Object.freeze({
  helper: 'toolkit-codex-helper-hook.cjs',
  sessionStart: 'toolkit-codex-session-start.cjs',
  checkpoint: 'toolkit-programme-checkpoint-hook.cjs'
});
const POWERSHELL_SCRIPTS = Object.freeze([
  'toolkit-codex-helper-hook.ps1',
  'toolkit-codex-session-start.ps1',
  'toolkit-programme-checkpoint-hook.ps1'
]);
const STAND_IN_FILES = Object.freeze([...Object.values(NODE_SCRIPTS), ...POWERSHELL_SCRIPTS]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
// The shell tool names Codex may report (toolkit-shell-call.cjs and the helper launcher hold the same list).
const SHELL_TOOL = /^(?:Bash|PowerShell|Monitor|exec_command|shell|local_shell)$/;

function supersededReason(marker) {
  const from = marker && VERSION_PATTERN.test(String(marker.from_version)) ? marker.from_version : 'an older version';
  const to = marker && VERSION_PATTERN.test(String(marker.to_version)) ? marker.to_version : 'a newer version';
  return `Toolkit was updated from ${from} to ${to} after this chat started, so its checks no longer run here. `
    + 'Commits, pushes, pull requests, edits and helper launches are refused in this chat. Open a new chat to continue.';
}

// The same wide match the helper launcher uses when it cannot start Node: every command the
// attribution check and the merge hold look at, and more. PowerShell's -match ignores case, so these do too.
function guardedShellCommand(command) {
  const text = String(command || '');
  return /\bgit\b[\s\S]*\b(?:commit|push)\b/i.test(text)
    || /\bgh\s+pr\s+(?:create|edit|merge)\b/i.test(text)
    || /\bgh\b[\s\S]*\b(?:merge|sync|alias|api)\b/i.test(text)
    || /merge-approvals|user-state|TOOLKIT_HOST_SESSION|toolkit-(?:merge-hold|governance-hook|codex-helper-hook)/i.test(text)
    || /\b(?:claude|codex)\b/i.test(text);
}

function commandText(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const parts = [];
  for (const key of ['command', 'cmd']) {
    const value = toolInput[key];
    if (Array.isArray(value)) parts.push(value.join(' '));
    else if (value !== undefined && value !== null) parts.push(String(value));
  }
  return parts.join(' ');
}

// What the stand-in helper hook does with one hook input: { exit, stdout, stderr }.
function helperDecision(input, reason) {
  const event = input && typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
  // A prompt still goes through: the chat can talk, and the model reads the reason as context.
  if (event === 'UserPromptSubmit') return { exit: 0, stdout: `${reason}\n`, stderr: '' };
  const toolName = input && typeof input.tool_name === 'string' ? input.tool_name : '';
  if (SHELL_TOOL.test(toolName) && !guardedShellCommand(commandText(input.tool_input))) {
    // A non-blocking failure: the command runs and Codex shows the reason as a hook notice.
    return { exit: 1, stdout: '', stderr: `${reason}\n` };
  }
  const deny = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  return { exit: 2, stdout: `${JSON.stringify(deny)}\n`, stderr: `${reason}\n` };
}

function readMarker(root) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(root, MARKER_NAME), 'utf8'));
    return marker && typeof marker === 'object' ? marker : null;
  } catch { return null; }
}

function readStdinJson() {
  try {
    const parsed = JSON.parse(fs.readFileSync(0, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

// Runs as one of the stand-in hook scripts; the file name says which.
function main(scriptPath = __filename) {
  const root = path.resolve(path.dirname(scriptPath), '..', '..');
  const reason = supersededReason(readMarker(root));
  const name = path.basename(scriptPath);
  if (name === NODE_SCRIPTS.sessionStart) {
    process.stdout.write(`${reason}\n`);
    return 0;
  }
  // The checkpoint hook is advisory and Codex reads its stdout as JSON, so it stays silent.
  if (name === NODE_SCRIPTS.checkpoint) return 0;
  // Unreadable input is refused, like any call the stand-in cannot read.
  const result = helperDecision(readStdinJson() || {}, reason);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exit;
}

function sameText(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

// The folder that holds this plugin's version folders in a Codex home.
function pluginCacheBase(codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  return path.join(path.resolve(codexHome), 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME);
}

// Whether a path is a version folder directly under this plugin's Codex cache.
function isPluginVersionPath(target) {
  const resolved = path.resolve(target);
  const parts = resolved.split(path.sep);
  const tail = parts.slice(-5, -1);
  return tail.length === 4 && sameText(tail[0], 'plugins') && sameText(tail[1], 'cache')
    && sameText(tail[2], MARKETPLACE_NAME) && sameText(tail[3], PLUGIN_NAME) && VERSION_PATTERN.test(parts.at(-1));
}

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

// The real version folders (with a plugin manifest) under the plugin cache base, by name.
function installedVersionFolders(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && VERSION_PATTERN.test(entry.name)
        && fs.existsSync(path.join(base, entry.name, '.codex-plugin', 'plugin.json')))
      .map((entry) => entry.name);
  } catch { return []; }
}

// Writes stand-ins for the version folders a plugin update removed. `before` is the list of
// installedVersionFolders() taken before the update; `toVersion` is the version now installed.
// Codex treats the highest version folder as the installed plugin, so only versions older than the
// installed one get a stand-in. Returns { written, skipped } with one reason per skipped version.
function writeStandIns({ base, before, toVersion, sourceRoot, now = new Date() }) {
  const written = [];
  const skipped = [];
  if (!VERSION_PATTERN.test(String(toVersion))) return { written, skipped: [{ version: '*', reason: 'installed version unknown' }] };
  for (const version of before || []) {
    const target = path.join(base, version);
    if (version === toVersion) continue;
    if (!isPluginVersionPath(target)) skipped.push({ version, reason: 'not a Toolkit plugin cache version folder' });
    else if (compareVersions(version, toVersion) >= 0) skipped.push({ version, reason: 'not older than the installed version' });
    else if (fs.existsSync(target)) skipped.push({ version, reason: 'folder still present' });
    else {
      try {
        writeStandIn({ target, fromVersion: version, toVersion, sourceRoot, now });
        written.push(version);
      } catch (error) {
        skipped.push({ version, reason: error.message });
      }
    }
  }
  return { written, skipped };
}

// Builds the stand-in in a temporary sibling and renames it into place, so a folder that appeared in
// the meantime (a real install) is never overwritten: the rename fails instead.
function writeStandIn({ target, fromVersion, toVersion, sourceRoot, now = new Date() }) {
  if (!isPluginVersionPath(target)) throw new Error('not a Toolkit plugin cache version folder');
  const sourceScripts = path.join(path.resolve(sourceRoot), ...SCRIPT_DIR);
  const temp = path.join(path.dirname(target), `.stand-in-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.mkdirSync(path.join(temp, ...SCRIPT_DIR), { recursive: true });
    const self = fs.readFileSync(__filename);
    for (const name of Object.values(NODE_SCRIPTS)) fs.writeFileSync(path.join(temp, ...SCRIPT_DIR, name), self);
    for (const name of POWERSHELL_SCRIPTS) fs.copyFileSync(path.join(sourceScripts, name), path.join(temp, ...SCRIPT_DIR, name));
    const marker = { schema: 1, from_version: fromVersion, to_version: toVersion, written_at: now.toISOString() };
    fs.writeFileSync(path.join(temp, MARKER_NAME), `${JSON.stringify(marker, null, 2)}\n`);
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

// Whether a folder holds exactly a stand-in: the marker and the stand-in scripts, nothing else.
function isStandInFolder(folder) {
  try {
    const top = fs.readdirSync(folder).sort();
    if (top.length !== 2 || top[0] !== MARKER_NAME || top[1] !== SCRIPT_DIR[0]) return false;
    const repo = fs.readdirSync(path.join(folder, SCRIPT_DIR[0]));
    if (repo.length !== 1 || repo[0] !== SCRIPT_DIR[1]) return false;
    const scripts = fs.readdirSync(path.join(folder, ...SCRIPT_DIR)).sort();
    const expected = [...STAND_IN_FILES].sort();
    return scripts.length === expected.length && scripts.every((name, index) => name === expected[index]
      && fs.lstatSync(path.join(folder, ...SCRIPT_DIR, name)).isFile());
  } catch { return false; }
}

// Removes stand-ins older than STAND_IN_MAX_AGE_DAYS. Leaves anything that is not exactly a stand-in.
function removeExpiredStandIns({ base, now = new Date() }) {
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(base); } catch { return removed; }
  for (const name of names) {
    const folder = path.join(base, name);
    if (!VERSION_PATTERN.test(name) || !isStandInFolder(folder)) continue;
    const written = Date.parse(readMarker(folder)?.written_at || '');
    if (!Number.isFinite(written) || now.getTime() - written < STAND_IN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) continue;
    fs.rmSync(folder, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

module.exports = {
  MARKER_NAME,
  STAND_IN_FILES,
  STAND_IN_MAX_AGE_DAYS,
  guardedShellCommand,
  helperDecision,
  installedVersionFolders,
  isPluginVersionPath,
  isStandInFolder,
  main,
  pluginCacheBase,
  removeExpiredStandIns,
  supersededReason,
  writeStandIn,
  writeStandIns
};

if (require.main === module) process.exitCode = main();
