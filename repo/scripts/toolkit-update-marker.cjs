'use strict';

// The marker the bridge holds while git moves the managed checkout's files (a branch switch or the
// fast-forward), so a reader in a hook that runs at the same session start never reads a
// half-written tree. Claude Code runs the session-start hooks in parallel and runs Toolkit in place
// from that checkout, so the governance hook waits here before it loads its modules and rules.
// The marker sits beside the hub snapshot directory (next to update.lock). It holds only the
// writer's process id and start time. Loads nothing but Node's own modules.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER_NAME = 'update.tree-moving';
// A move takes well under a second; a marker older than this is left over from a killed run.
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

// Runs fn while the marker exists. The marker is best effort: a write failure never stops the move.
function whileTreeMoves(controlRoot, fn) {
  const file = markerPath(controlRoot);
  let written = false;
  try {
    fs.mkdirSync(controlRoot, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    written = true;
  } catch { /* the reader then sees no marker, as before this marker existed */ }
  try { return fn(); }
  finally { if (written) { try { fs.rmSync(file, { force: true }); } catch { /* a leftover marker goes stale */ } } }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Whether the tree is steady: true at once with no marker, a stale one, or one whose writer has
// exited; otherwise polls until the marker goes or `timeoutMs` passes (false).
function waitForSteadyTree(controlRoot = defaultControlRoot(), { timeoutMs = WAIT_MS, now = () => Date.now(), sleep = sleepSync, alive = pidAlive } = {}) {
  const file = markerPath(controlRoot);
  const deadline = now() + timeoutMs;
  for (;;) {
    let marker;
    try { marker = { stat: fs.statSync(file), body: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch (error) { if (error && error.code === 'ENOENT') return true; marker = null; }
    if (marker) {
      if (now() - marker.stat.mtimeMs > STALE_MS) return true;
      if (Number.isSafeInteger(marker.body?.pid) && marker.body.pid > 0 && !alive(marker.body.pid)) return true;
    }
    if (now() >= deadline) return false;
    sleep(POLL_MS);
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

module.exports = Object.freeze({ MARKER_NAME, STALE_MS, WAIT_MS, defaultControlRoot, markerPath, whileTreeMoves, waitForSteadyTree });
