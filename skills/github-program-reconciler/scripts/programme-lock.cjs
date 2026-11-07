'use strict';

// Shared pass lock; built-ins only so session-start callers do not load the programme CLI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// One reconcile pass with --apply at a time per repository on this computer. The lock file holds a
// random token, the owner's process id and host; its modified time is the owner's heartbeat, renewed
// before every GitHub request. Before every request the pass also checks that the lock still holds its
// token, and stops (PASS_LOCK_LOST) if not, so a pass that loses its lock sends no further request
// (one already sent still completes).
//
// The lock is taken over only when its owner is provably gone: on this host, its process has ended;
// its last beat is older than this computer's last start; on another host (a shared profile), it has
// not beaten for LOCK_STALE_MS. A live process that has
// not beaten for LOCK_ABANDONED_MS is taken to be an unrelated process that reused a dead owner's id
// (a pass beats at least every few minutes while awake); if it is in fact a pass waking from a long
// sleep, it finds its token gone and stops before its next request. Anything at the path that is not
// a lock file is replaced. A lock is moved aside and checked before it is replaced, and an owner
// releases only a lock that still holds its own token.
//
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_ABANDONED_MS = 6 * 60 * 60 * 1000;
const LOCK_SCHEMA = 'toolkit.programme-pass-lock.v1';

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function readLock(file) {
  let info;
  try { info = fs.lstatSync(file); } catch { return { missing: true }; }
  if (!info.isFile()) return { broken: true, mtimeMs: info.mtimeMs };
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* unreadable: broken */ }
  if (!lock || lock.schema !== LOCK_SCHEMA || typeof lock.token !== 'string') return { broken: true, mtimeMs: info.mtimeMs };
  return { lock, mtimeMs: info.mtimeMs };
}

// This boot of the computer, read without the wall clock: Linux's boot id where it exists, and the
// uptime counter, which only grows within one boot.
function thisBoot() {
  let bootId = null;
  // Only on Linux: elsewhere the same path can name a file anyone may create.
  if (process.platform === 'linux') {
    try { bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null; } catch { /* unavailable */ }
  }
  return { bootId, uptime: os.uptime() };
}
// The lock was written in an earlier boot when the boot ids differ, or when the uptime now is below
// the uptime the lock recorded. A clock change moves neither.
function earlierBoot(lock, boot) {
  if (lock.boot_id && boot.bootId) return lock.boot_id !== boot.bootId;
  return typeof lock.uptime === 'number' && boot.uptime < lock.uptime;
}

// held, free or stale, with what was seen so a replacement can check it moved the same lock.
function lockState(file, nowMs, alive = pidAlive, boot = thisBoot(), staleMs = LOCK_STALE_MS) {
  const seen = readLock(file);
  if (seen.missing) return { free: true };
  if (seen.broken) return { stale: true, seen };
  const silent = nowMs - seen.mtimeMs;
  // A lock written in an earlier boot belongs to a pass that died with it, even if its process id is
  // in use again. Windows Fast Startup keeps the uptime counter across a shutdown, so there only a
  // restart counts as a new boot; the abandon limit covers the rest.
  const gone = seen.lock.host === os.hostname()
    ? !alive(seen.lock.pid) || silent > LOCK_ABANDONED_MS || earlierBoot(seen.lock, boot)
    : silent > staleMs || silent < -staleMs;
  return gone ? { stale: true, seen } : { held: true, seen };
}

// Returns a handle { token, owns(), beat(), release() }, or null while another live pass holds the
// lock. A null file means no lock (tests that bring their own GitHub).
function takeLock(file, deps = {}) {
  if (!file) return { token: null, owns: () => true, beat() {}, release() {} };
  const now = () => (deps.nowMs === undefined ? Date.now() : deps.nowMs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');
  let recovered = false;
  const owns = () => readLock(file).lock?.token === token;
  const handle = {
    token,
    owns,
    beat() { try { if (owns()) { const at = new Date(); fs.utimesSync(file, at, at); } } catch { /* the next beat retries */ } },
    release() { try { if (owns()) fs.unlinkSync(file); } catch { /* already gone */ } },
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Written whole first, then linked into place: the link fails while any lock is there, and a
    // reader never sees a half-written lock.
    const draft = `${file}.${token}.draft`;
    fs.writeFileSync(draft, JSON.stringify({ schema: LOCK_SCHEMA, token, pid: process.pid, host: os.hostname(), boot_id: (deps.boot || thisBoot()).bootId, uptime: (deps.boot || thisBoot()).uptime, at: new Date(now()).toISOString() }), { mode: 0o600 });
    try {
      fs.linkSync(draft, file);
      if (recovered && deps.onStale) deps.onStale();
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      try { fs.unlinkSync(draft); } catch { /* gone */ }
    }
    const seen = lockState(file, now(), deps.pidAlive, deps.boot || thisBoot(), deps.staleMs);
    if (seen.free) continue;
    if (seen.held) return null;
    // Stale: move it aside, then make sure what moved is what was judged stale.
    const aside = `${file}.stale-${token}`;
    try { fs.renameSync(file, aside); } catch { continue; }
    const moved = readLock(aside);
    const same = seen.seen.broken ? Boolean(moved.broken) : moved.lock?.token === seen.seen.lock.token;
    if (!same) {
      // A live pass took the lock in between: put its lock back and step aside.
      try { fs.linkSync(aside, file); } catch { /* a third pass holds it */ }
      try { fs.unlinkSync(aside); } catch { /* gone */ }
      return null;
    }
    try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* left beside the lock */ }
    recovered = true;
  }
  return null;
}

function lockMinutes(file, nowMs = Date.now()) {
  const at = Date.parse(readLock(file).lock?.at || '');
  return Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 60000)) : null;
}

module.exports = Object.freeze({ takeLock, lockState, lockMinutes, LOCK_STALE_MS, LOCK_ABANDONED_MS });
