'use strict';

// Notepad block for test files that run the Toolkit bridge or setup. toolkit-test-temp-guard.cjs
// loads it in the test process and, through NODE_OPTIONS, in every Node child that inherits the
// test environment. Only guarded test runs load it, including the hook-light test that setup and
// repo auto-update run as validation; the bridge and setup code are unchanged.
//
// On Windows the bridge opens each action-required update report with spawn('notepad.exe', ...).
// Here that call gets an inert stand-in child, so no window opens. Any other Notepad start that
// reaches Node's process layer (exec, execFile, a shell command line, the sync variants, or a
// spawn the stand-in missed) is refused with an error and appended to the file named by
// TOOLKIT_TEST_NOTEPAD_RECORD. The temp guard fails the test file when that file has entries.

const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');

const RECORD_VARIABLE = 'TOOLKIT_TEST_NOTEPAD_RECORD';
if (!process.env[RECORD_VARIABLE]) throw new Error(`toolkit-test-notepad-preload.cjs needs ${RECORD_VARIABLE}; load it through toolkit-test-temp-guard.cjs.`);
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'sh', 'bash']);
const NOTEPAD_WORD = /(?:^|[\s"'\\/])notepad(?:\.exe)?(?=$|[\s"'])/i;

function programName(file) {
  return String(file ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

function startsNotepad(file, args, shell) {
  const name = programName(file);
  if (name === 'notepad') return true;
  return Boolean(shell || SHELLS.has(name)) && [file, ...args].some(arg => NOTEPAD_WORD.test(String(arg)));
}

// Read at refusal time: a nested guard (setup running the hook-light test) points it at its own file.
function refuse(file, args) {
  fs.appendFileSync(process.env[RECORD_VARIABLE], `${JSON.stringify({ pid: process.pid, command: [file, ...args].map(String) })}\n`);
  throw new Error('Toolkit test guard refused a Notepad launch; no window was opened.');
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
  if (startsNotepad(file, args, false)) refuse(file, args);
  return start.call(this, options);
};

for (const name of ['spawnSync', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function syncWithoutNotepad(file, args, options) {
    const list = Array.isArray(args) ? args : [];
    const settings = Array.isArray(args) ? options : args;
    if (startsNotepad(file, list, settings && settings.shell)) refuse(file, list);
    return original.apply(this, arguments);
  };
}
const execSync = childProcess.execSync;
childProcess.execSync = function execSyncWithoutNotepad(command, ...rest) {
  if (startsNotepad(command, [], true)) refuse(command, []);
  return execSync.call(this, command, ...rest);
};
