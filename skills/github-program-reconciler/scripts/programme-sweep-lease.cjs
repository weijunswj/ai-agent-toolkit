'use strict';
const crypto = require('node:crypto');
const state = require('./programme-state.cjs');
const TTL_MS = 15 * 60 * 1000;

// Both host routes use the same private-store CAS lease. A process that outlives its lease stops
// before its next request; an expired owner can neither renew nor delete a successor's lease.
class SweepLease {
  constructor({ store, repository, nowMs = Date.now, nonce = crypto.randomBytes(16).toString('hex') }) {
    Object.assign(this, { store, repository, nowMs, nonce });
    this.file = `${store.store.path}sweep-lease.json`;
    this.held = null;
    this.nextRenew = 0;
  }
  acquire() {
    const current = this.store.readPath(this.file, 'sweep_lease');
    if (current.doc && current.doc.repository !== this.repository) throw new state.ProgrammeError('STATE_INVALID', 'The sweep lease belongs to another repository.');
    if (current.doc && Date.parse(current.doc.expires_at) > this.nowMs() && current.doc.nonce !== this.nonce) return false;
    return this.replace(current.sha);
  }
  replace(sha) {
    const doc = { schema: 'toolkit.programme-sweep-lease.v1', repository: this.repository, nonce: this.nonce, expires_at: new Date(this.nowMs() + TTL_MS).toISOString() };
    try {
      const result = this.store.putVerified(this.file, 'sweep_lease', state.canonicalText(doc), sha, 'programme sweep: lease');
      this.held = { doc, sha: result.sha }; this.nextRenew = this.nowMs() + 60000;
      return true;
    } catch (error) { if (error.code !== 'STATE_CONFLICT') throw error; return false; }
  }
  check() {
    if (!this.held || this.nowMs() >= Date.parse(this.held.doc.expires_at)) throw new state.ProgrammeError('PASS_LOCK_LOST', 'Another sweep may own the expired lease; this sweep stopped.');
    if (this.nowMs() >= this.nextRenew && !this.replace(this.held.sha)) {
      this.held = null; throw new state.ProgrammeError('PASS_LOCK_LOST', 'Another sweep owns the lease; this sweep stopped.');
    }
  }
  release() {
    if (!this.held) return;
    const current = this.store.readPath(this.file, 'sweep_lease');
    if (current.doc?.nonce === this.nonce && current.sha === this.held.sha) {
      const response = this.store.transport.request('DELETE', this.store.encodedContents(this.file), {
        branch: this.store.store.branch, sha: this.held.sha, message: 'programme sweep: release lease',
      });
      if (![200, 409, 404].includes(response.status)) throw new state.ProgrammeError('LEASE_RELEASE_FAILED', 'The sweep lease could not be released; it expires after fifteen minutes.');
      this.store.ownWrites.delete(this.file);
    }
    this.held = null;
  }
}
module.exports = { SweepLease, TTL_MS };
