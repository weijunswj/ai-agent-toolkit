'use strict';

// Keeps a reader in a hook that runs at the same session start from ever reading a half-written
// Toolkit checkout. Claude Code runs the session-start hooks in parallel and runs Toolkit in place
// from the managed checkout, so while the bridge hook switches or fast-forwards that checkout, the
// governance hook may be loading its modules and rules from it.
//
// Two markers sit beside the hub snapshot directory (next to update.lock), each holding only a
// process id and start time:
//   update.tree-moving     the bridge holds it while git moves the checkout's files.
//   update.readers/<id>    each reader holds one for its whole run.
// Each side writes its own marker first and then looks for the other's, so at least one of two
// that start together sees the other. The mover then waits for the readers to finish, and a reader
// that finds a move steps back and waits for it to end. Neither waits more than WAIT_MS: a move
// still held off then does not run (the update runs at the next session start), and a reader still
// held off reads nothing. Markers older than STALE_MS, or from an exited process, hold no one.
// Loads nothing but Node's own modules.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER_NAME = 'update.tree-moving';
const READERS_NAME = 'update.readers';
// A move or a read takes well under a second; a marker older than this is left over from a killed run.
const STALE_MS = 2 * 60 * 1000;
const WAIT_MS = 15 * 1000;
const POLL_MS = 100;

function defaultControlRoot(environment = process.env) {
  const home = (process.platform === 'win32' ? environment.USERPROFILE : environment.HOME) || os.homedir();
  return path.join(home, '.ai-agent-toolkit');
}

function markerPath(controlRoot) {
  return path.join(controlRoot, MARKER_NAME);
}

function readersPath(controlRoot) {
  return path.join(controlRoot, READERS_NAME);
}

function timing({ now = () => Date.now(), sleep = sleepSync, alive = pidAlive } = {}) {
  return { now, sleep, alive };
}

// Writes this process's marker; best effort, so a write failure leaves things as before markers existed.
function writeMarker(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    return true;
  } catch { return false; }
}

function removeMarker(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* a leftover marker goes stale */ }
}

// Whether a marker holds anyone: missing, stale, unreadable for long, or from an exited process does not.
function holds(file, { now, alive }) {
  let stat, body;
  try { stat = fs.statSync(file); } catch { return false; }
  if (now() - stat.mtimeMs > STALE_MS) return false;
  try { body = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return true; } // being written
  return !(Number.isSafeInteger(body?.pid) && body.pid > 0 && !alive(body.pid));
}

// Runs fn while holding the moving marker, once no reader is reading; returns fn's result, or null
// when readers still held the move off after `timeoutMs` (fn then did not run).
function whileTreeMoves(controlRoot, fn, options = {}) {
  const clock = timing(options);
  const file = markerPath(controlRoot);
  const written = writeMarker(file);
  try {
    if (written && !readersDone(controlRoot, options.timeoutMs ?? WAIT_MS, clock)) return null;
    return fn();
  } finally { if (written) removeMarker(file); }
}

function readersDone(controlRoot, timeoutMs, clock) {
  const deadline = clock.now() + timeoutMs;
  const folder = readersPath(controlRoot);
  for (;;) {
    let busy = false;
    let names = [];
    try { names = fs.readdirSync(folder); } catch { return true; }
    for (const name of names) {
      const file = path.join(folder, name);
      if (holds(file, clock)) busy = true;
      else removeMarker(file);
    }
    if (!busy) return true;
    if (clock.now() >= deadline) return false;
    clock.sleep(POLL_MS);
  }
}

// Runs fn while holding a reader marker, once no move is running: { steady: true, value } with
// fn's result, or { steady: false } when a move was still running after `timeoutMs` (fn did not run).
function whileReading(controlRoot, fn, options = {}) {
  const clock = timing(options);
  const deadline = clock.now() + (options.timeoutMs ?? WAIT_MS);
  const file = path.join(readersPath(controlRoot), `${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  for (;;) {
    const written = writeMarker(file);
    if (!holds(markerPath(controlRoot), clock)) {
      try { return { steady: true, value: fn() }; } finally { if (written) removeMarker(file); }
    }
    // A move is running: step back so it can finish, wait for it, then try again.
    if (written) removeMarker(file);
    if (!waitForSteadyTree(controlRoot, { ...clock, timeoutMs: Math.max(0, deadline - clock.now()) })) return { steady: false };
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Whether the tree is steady: true at once with no moving marker, a stale one, or one whose writer
// has exited; otherwise polls until the marker goes or `timeoutMs` passes (false).
function waitForSteadyTree(controlRoot = defaultControlRoot(), options = {}) {
  const clock = timing(options);
  const deadline = clock.now() + (options.timeoutMs ?? WAIT_MS);
  for (;;) {
    if (!holds(markerPath(controlRoot), clock)) return true;
    if (clock.now() >= deadline) return false;
    clock.sleep(POLL_MS);
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

module.exports = Object.freeze({
  MARKER_NAME, READERS_NAME, STALE_MS, WAIT_MS, defaultControlRoot, markerPath, readersPath, whileTreeMoves, whileReading, waitForSteadyTree,
});
