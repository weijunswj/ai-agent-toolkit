'use strict';

// The sweep lease: one record per programme in the private store, shared by the computer's sweep and the
// cloud runner. A sweep acquires it with compare-and-swap before any write and releases it at the
// end; while one holds it, another prints "another sweep is running" and writes nothing.
//
// The record also keeps what a pass leaves for the next one: the pass count the rotation runs on,
// the GitHub update time the next changed-issues list reads from, when a pass last finished (the
// board's freshness line), and a stop the state could not hold. A holder's progress is saved on it, so a
// run killed before its release (a runner timeout, a cancelled job) is reported by the next pass
// as an interrupted stop once the lease has expired.
//
// The lease owns every write of its file: acquire, renew, progress, the entry inside the state
// commit and release, one at a time and never nested. While a state commit is open (from the batch
// snapshot to the end of its read-back) the commit itself is the only writer of the file from this
// process, so a lease version that differs from the one held there was written by another host.
const crypto = require('node:crypto');
const state = require('./programme-state.cjs');

// A holder renews its lease while it works, so a scheduled pass of up to an hour keeps it; a run
// that is killed stops renewing, and its lease expires within TTL_MS, and never after the pass's own
// kill time (`endsBy`), so the next hourly pass can take it.
const TTL_MS = 20 * 60 * 1000;
const RENEW_BEFORE_MS = 10 * 60 * 1000;
const STREAK_FINDING = 3;

const empty = repository => ({ schema: 'toolkit.programme-sweep-lease.v1', repository, holder: null, pass: 0, changed_since: null,
  last_complete_at: null, stopped_passes: 0, reason: null, unreported: null, streaks: { busy: 0, graphql: 0 } });
const lost = () => new state.ProgrammeError('PASS_LOCK_LOST', 'The sweep lease changed hands; this pass stopped.');

class SweepLease {
  constructor({ store, repository, host, endsBy, nowMs = Date.now, nonce = crypto.randomBytes(16).toString('hex') }) {
    if (!Number.isFinite(endsBy)) throw new TypeError('SweepLease needs endsBy, the time the pass is killed by.');
    Object.assign(this, { store, repository, host, endsBy, nowMs, nonce });
    this.file = store.sweepRecordPath();
    this.held = null;
    this.acquired = false;
    // Set while a lease write is in flight or a state commit is open: no renewal starts then.
    this.inFlight = false;
    this.window = null;
    // The commit that carried this lease's last write could not be confirmed: re-read before the next write.
    this.unsure = false;
    this.reportedStop = false;
  }

  now() { return new Date(this.nowMs()).toISOString(); }
  expiry() { return new Date(Math.min(this.nowMs() + TTL_MS, this.endsBy)).toISOString(); }

  // The record as it stands, or a fresh one. A record for another repository is refused.
  current() {
    const found = this.store.readPath(this.file, 'sweep_record');
    if (found.doc && found.doc.repository.toLowerCase() !== this.repository.toLowerCase()) {
      throw new state.ProgrammeError('STATE_INVALID', 'The sweep lease belongs to another repository.');
    }
    return { doc: found.doc || empty(this.repository), sha: found.sha };
  }

  // One lease write at a time: a request inside it never starts a renewal.
  writing(fn) {
    const outer = this.inFlight;
    this.inFlight = true;
    try { return fn(); } finally { this.inFlight = outer; }
  }

  // true when this sweep now holds the lease; false when another live sweep does. `startedAt` is the
  // pass start, the same time the computer's own note carries.
  acquire(startedAt) {
    return this.writing(() => {
      const { doc, sha } = this.current();
      if (doc.holder && Date.parse(doc.holder.expires_at) > this.nowMs()) return false;
      const next = structuredClone(doc);
      // A holder that never released was killed: its last saved progress is the stop to report.
      if (doc.holder) {
        next.unreported = { cause: 'interrupted', ...doc.holder.progress };
        next.stopped_passes += 1;
      }
      next.holder = { nonce: this.nonce, host: this.host, expires_at: this.expiry(), progress: { phase: 'planning', done: 0, total: 0, started_at: startedAt } };
      next.pass += 1;
      if (!this.put(next, sha, 'programme sweep: take the lease')) return false;
      this.acquired = true;
      this.record = next;
      return true;
    });
  }

  put(doc, sha, message) {
    try {
      const written = this.store.putVerified(this.file, 'sweep_record', state.canonicalText(state.validateSweepRecord(doc)), sha, message);
      this.held = { doc: written.doc, sha: written.sha };
      return true;
    } catch (error) {
      if (error.code !== 'STATE_CONFLICT') throw error;
      return false;
    }
  }

  // Before a write after an unconfirmed commit: the record must still be this lease's own.
  confirmHeld() {
    if (!this.unsure) return;
    const { doc, sha } = this.current();
    if (doc.holder?.nonce !== this.nonce) throw lost();
    this.held = { doc, sha };
    this.unsure = false;
  }

  // The holder's progress written on its own, once per state commit, when the lease does not live in
  // the state store (a public state branch).
  saveProgress(diagnostics) {
    if (!this.held) return;
    this.writing(() => {
      this.confirmHeld();
      const next = structuredClone(this.held.doc);
      next.holder.progress = { phase: diagnostics.phase, done: diagnostics.done, total: diagnostics.total, started_at: next.holder.progress.started_at };
      if (!this.put(next, this.held.sha, 'programme sweep: progress')) throw lost();
    });
  }

  // Whether the lease has less than RENEW_BEFORE_MS left and renewing would move its expiry; never
  // while a lease write is in flight or a state commit is open.
  dueForRenewal() {
    if (!this.held || this.inFlight || this.window) return false;
    const expires = Date.parse(this.held.doc.holder.expires_at);
    return this.nowMs() >= expires - RENEW_BEFORE_MS && Date.parse(this.expiry()) > expires;
  }

  renew() {
    this.writing(() => {
      this.confirmHeld();
      const next = structuredClone(this.held.doc);
      next.holder.expires_at = this.expiry();
      if (!this.put(next, this.held.sha, 'programme sweep: keep the lease')) throw lost();
    });
  }

  // Opens the state commit window: renews first when due, so the commit starts with ten minutes or
  // more, then holds every separate lease write until closeBatch.
  openBatch(stateStore) {
    if (!this.held) return;
    if (this.dueForRenewal()) this.renew();
    this.window = { stateStore, progressed: false, pending: null };
  }

  // The lease's entry for one attempt of the state commit, or null. When the lease lives in the state
  // store, the commit carries the progress and the renewed expiry, built from the held version; a
  // snapshot holding another version means another host wrote the lease. Otherwise the progress is
  // written beside the commit, once.
  batchEntry(snapshot, diagnostics) {
    const window = this.window;
    if (!window || !this.held) return null;
    if (window.stateStore !== this.store) {
      if (!window.progressed) { window.progressed = true; this.saveProgress(diagnostics); }
      return null;
    }
    this.writing(() => this.confirmHeld());
    if (snapshot.files?.get(this.file.slice(this.store.store.path.length))?.sha !== this.held.sha) {
      throw new state.ProgrammeError('PASS_LOCK_LOST', 'The sweep lease changed hands before the state was saved; this pass stopped and wrote nothing.');
    }
    const next = structuredClone(this.held.doc);
    next.holder.expires_at = this.expiry();
    next.holder.progress = { phase: diagnostics.phase, done: diagnostics.done, total: diagnostics.total, started_at: next.holder.progress.started_at };
    window.pending = next;
    return { path: this.file, text: state.canonicalText(state.validateSweepRecord(next)), sha: this.held.sha };
  }

  // Closes the window. A confirmed commit makes its lease entry the held version; an outcome that
  // could not be confirmed makes the next lease write re-read the record first.
  closeBatch({ committed = null, unsure = false } = {}) {
    const window = this.window;
    if (!window) return;
    this.window = null;
    if (committed && window.pending) this.held = { doc: window.pending, sha: committed };
    if (unsure) this.unsure = true;
  }

  // Before every request: a sweep that outlived its lease stops at once.
  check() {
    if (this.held && this.nowMs() >= Date.parse(this.held.doc.holder.expires_at)) {
      throw new state.ProgrammeError('PASS_LOCK_LOST', 'The sweep outlived its lease, so another sweep may run now; this one stopped before its next request.');
    }
  }

  // The earlier pass's stop that the state does not hold yet, or null.
  unreported() { return this.record?.unreported || null; }

  // Findings for streaks that reached three passes in a row.
  findings() {
    const streaks = this.record?.streaks || {};
    return [...(streaks.busy >= STREAK_FINDING ? ['STATE_BRANCH_BUSY'] : []), ...(streaks.graphql >= STREAK_FINDING ? ['GRAPHQL_REFUSED'] : [])];
  }

  // Release with what this pass leaves for the next. Only the holder releases, with compare-and-swap
  // on the version it reads now: its own state commit or a renewal whose reply was lost may have
  // written it since, and another holder's record is left alone.
  release({ changedSince = null, completeAt = null, complete, stop = null, reason = null, busy = false, graphqlRefused = false }) {
    if (!this.acquired) return false;
    this.acquired = false;
    this.window = null;
    return this.writing(() => {
      const { doc, sha } = this.current();
      if (doc.holder?.nonce !== this.nonce) { this.held = null; return false; }
      const next = structuredClone(doc);
      next.holder = null;
      if (changedSince) next.changed_since = changedSince;
      if (complete) { next.last_complete_at = completeAt; next.stopped_passes = 0; next.reason = null; }
      else { next.stopped_passes += 1; next.reason = reason; }
      if (this.reportedStop) next.unreported = null;
      // A stop the state could not hold (a busy branch, an error exit no local note holds) waits here.
      if (stop) next.unreported = stop;
      next.streaks = { busy: busy ? doc.streaks.busy + 1 : 0, graphql: graphqlRefused ? doc.streaks.graphql + 1 : 0 };
      const released = this.put(next, sha, 'programme sweep: release the lease');
      this.held = null;
      return released;
    });
  }
}

module.exports = { SweepLease, TTL_MS, RENEW_BEFORE_MS, STREAK_FINDING };
