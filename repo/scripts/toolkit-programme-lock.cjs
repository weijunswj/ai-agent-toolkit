'use strict';

// Serialises scheduled job writes to the same programme/store on this computer.
// A lock lives in user-state, names its owner token, host and start time, and cannot
// expire during the scheduler's 30-minute limit. Local state is not a distributed lock.
const crypto = require('node:crypto');
const path = require('node:path');
const { takeLock } = require('../../skills/github-program-reconciler/scripts/programme-lock.cjs');
const { userStateDir } = require('./toolkit-tasks.cjs');
const STALE_MS = 31 * 60 * 1000;

class ProgrammeJobLock {
  constructor({ home, key, now = () => performance.now(), wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), acquire = takeLock, log = () => {}, waitMs = 1000 }) {
    this.file = path.join(userStateDir(home), 'programme-locks', `${crypto.createHash('sha256').update(key.toLowerCase()).digest('hex').slice(0, 24)}.lock`);
    Object.assign(this, { now, wait, acquire, log, waitMs });
  }
  take() {
    const until = this.now() + this.waitMs;
    do {
      const handle = this.acquire(this.file, { staleMs: STALE_MS, onStale: () => this.log('Programme lock: took over a stale job lock.') });
      if (handle) return handle;
      if (this.now() >= until) return null;
      this.wait(Math.min(250, until - this.now()));
    } while (true);
  }
}

module.exports = { ProgrammeJobLock, STALE_MS };
