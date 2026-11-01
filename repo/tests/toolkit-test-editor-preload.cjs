'use strict';

// Notepad and editor block for test files that run the Toolkit bridge or setup. toolkit-test-temp-guard.cjs
// loads it in the test process and, through NODE_OPTIONS, in every Node child that inherits the
// test environment. Only guarded test runs load it, including the hook-light test that setup and
// repo auto-update run as validation; the bridge and setup code are unchanged.
//
// It also refuses writes to the real user-level instruction files named by
// TOOLKIT_TEST_PROTECTED_FILES, so the global rules installer can never touch them in a test.
//
// On Windows the bridge opens each action-required update report with spawn('notepad.exe', ...).
// Here that call gets an inert stand-in child, so no window opens. Any other Notepad start that
// reaches Node's process layer (exec, execFile, a shell command line, the sync variants, or a
// spawn the stand-in missed) is refused with an error and appended to the file named by
// TOOLKIT_TEST_EDITOR_RECORD. The temp guard fails the test file when that file has entries.
//
// toolkit env edit opens its key file through the Windows shell (explorer.exe), open, xdg-open or a
// VS Code-style editor. Any of those programs started with a Toolkit env edit file, directly or in
// a shell command line, is refused and recorded the same way, so a test never shows real keys in a
// window.

const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const RECORD_VARIABLE = 'TOOLKIT_TEST_EDITOR_RECORD';
if (!process.env[RECORD_VARIABLE]) throw new Error(`toolkit-test-editor-preload.cjs needs ${RECORD_VARIABLE}; load it through toolkit-test-temp-guard.cjs.`);
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'sh', 'bash']);
const NOTEPAD_WORD = /(?:^|[\s"'\\/])notepad(?:\.exe)?(?=$|[\s"'])/i;

function programName(file) {
  return String(file ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

// Programs toolkit env edit can open its key file with, and the key file's name.
const OPENERS = new Set(['explorer', 'open', 'xdg-open', 'code', 'code - insiders', 'vscodium', 'cursor']);
const EDIT_FILE_WORD = /env-edit-[A-Za-z0-9-]+\.(?:env|txt)/i;
const OPENER_WORD = /(?:^|[\s"'\\/])(?:explorer|open|xdg-open|code|code - insiders|vscodium|cursor)(?:\.exe)?(?=$|[\s"'])/i;

function startsEditorOpen(file, args, shell) {
  const name = programName(file);
  if (name === 'notepad') return true;
  const words = [file, ...args].map(String);
  if (OPENERS.has(name) && words.some(arg => EDIT_FILE_WORD.test(arg))) return true;
  if (!(shell || SHELLS.has(name))) return false;
  return words.some(arg => NOTEPAD_WORD.test(arg)) || (words.some(arg => OPENER_WORD.test(arg)) && words.some(arg => EDIT_FILE_WORD.test(arg)));
}

// Read at refusal time: a nested guard (setup running the hook-light test) points it at its own file.
function refuse(file, args) {
  fs.appendFileSync(process.env[RECORD_VARIABLE], `${JSON.stringify({ pid: process.pid, command: [file, ...args].map(String) })}\n`);
  throw new Error('Toolkit test guard refused a Notepad or editor launch; no window was opened.');
}

function inertChild() {
  const child = new EventEmitter();
  Object.assign(child, { pid: undefined, stdin: null, stdout: null, stderr: null, stdio: [null, null, null] });
  child.unref = () => child;
  child.ref = () => child;
  child.kill = () => false;
  return child;
}

const spawn = childProcess.spawn;
childProcess.spawn = function spawnWithoutNotepad(command, ...rest) {
  if (programName(command) === 'notepad') return inertChild();
  return spawn.call(this, command, ...rest);
};

// spawn, exec, execFile and fork all start their process through ChildProcess.prototype.spawn.
const start = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function startUnlessNotepad(options) {
  const file = options && options.file;
  const args = ((options && options.args) || []).slice(1);
  if (startsEditorOpen(file, args, false)) refuse(file, args);
  return start.call(this, options);
};

for (const name of ['spawnSync', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function syncWithoutNotepad(file, args, options) {
    const list = Array.isArray(args) ? args : [];
    const settings = Array.isArray(args) ? options : args;
    if (startsEditorOpen(file, list, settings && settings.shell)) refuse(file, list);
    return original.apply(this, arguments);
  };
}
// The temp guard names the real user-level instruction files; a test must never write them.
const protectedFiles = new Set(JSON.parse(process.env.TOOLKIT_TEST_PROTECTED_FILES || '[]')
  .map(file => path.resolve(file).toLowerCase()));
function refuseProtected(target) {
  if (typeof target === 'string' && protectedFiles.has(path.resolve(target).toLowerCase())) {
    throw new Error(`Toolkit test guard refused a write to the real instruction file ${target}; isolate the test's home.`);
  }
}
for (const name of ['writeFileSync', 'appendFileSync', 'rmSync', 'unlinkSync']) {
  const original = fs[name];
  fs[name] = function guardedWrite(target, ...rest) {
    refuseProtected(target);
    return original.call(this, target, ...rest);
  };
}
for (const name of ['renameSync', 'copyFileSync']) {
  const original = fs[name];
  fs[name] = function guardedMove(from, to, ...rest) {
    refuseProtected(to);
    return original.call(this, from, to, ...rest);
  };
}

const execSync = childProcess.execSync;
childProcess.execSync = function execSyncWithoutNotepad(command, ...rest) {
  if (startsEditorOpen(command, [], true)) refuse(command, []);
  return execSync.call(this, command, ...rest);
};
