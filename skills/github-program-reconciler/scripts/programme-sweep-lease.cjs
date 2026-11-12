'use strict';

// The sweep lease: one record per programme in the private store, shared by the laptop and the
// cloud runner. A sweep acquires it with compare-and-swap before any write and releases it at the
// end; while one holds it, another prints "another sweep is running" and writes nothing.
//
// The record also keeps what a pass leaves for the next one: the pass count the rotation runs on,
// the GitHub update time the next changed-issues list reads from, when a pass last finished (the
// board's freshness line), and a stop the state could not hold. A holder's progress is saved on it, so a
// run killed before its release (a runner timeout, a cancelled job) is reported by the next pass
// as an interrupted stop once the lease has expired.
const crypto = require('node:crypto');
const state = require('./programme-state.cjs');

// Longer than the cloud job's fifteen-minute timeout and the laptop pass's ten-minute budget, so a
// live holder never loses its lease; a killed one frees it within this time.
const TTL_MS = 20 * 60 * 1000;
const STREAK_FINDING = 3;

const empty = repository => ({ schema: 'toolkit.programme-sweep-lease.v1', repository, holder: null, pass: 0, changed_since: null,
  last_complete_at: null, stopped_passes: 0, reason: null, unreported: null, streaks: { busy: 0, graphql: 0 } });

class SweepLease {
  constructor({ store, repository, host, nowMs = Date.now, nonce = crypto.randomBytes(16).toString('hex') }) {
    Object.assign(this, { store, repository, host, nowMs, nonce });
    this.file = store.sweepRecordPath();
    this.held = null;
    this.reportedStop = false;
  }

  now() { return new Date(this.nowMs()).toISOString(); }

  // The record as it stands, or a fresh one. A record for another repository is refused.
  current() {
    const found = this.store.readPath(this.file, 'sweep_record');
    if (found.doc && found.doc.repository.toLowerCase() !== this.repository.toLowerCase()) {
      throw new state.ProgrammeError('STATE_INVALID', 'The sweep lease belongs to another repository.');
    }
    return { doc: found.doc || empty(this.repository), sha: found.sha };
  }

  // true when this sweep now holds the lease; false when another live sweep does.
  acquire() {
    const { doc, sha } = this.current();
    if (doc.holder && Date.parse(doc.holder.expires_at) > this.nowMs()) return false;
    const next = structuredClone(doc);
    // A holder that never released was killed: its last saved progress is the stop to report.
    if (doc.holder) {
      next.unreported = { cause: 'interrupted', ...doc.holder.progress };
      next.stopped_passes += 1;
    }
    next.holder = { nonce: this.nonce, host: this.host, expires_at: new Date(this.nowMs() + TTL_MS).toISOString(),
      progress: { phase: 'planning', done: 0, total: 0, started_at: this.now() } };
    next.pass += 1;
    if (!this.put(next, sha, 'programme sweep: take the lease')) return false;
    this.record = next;
    return true;
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

  // The holder's progress at the state boundary, so a run killed after it is reported precisely.
  // When the lease lives in the state store itself it rides the state commit (no request of its
  // own); otherwise it is written here, once.
  progress(diagnostics, stateStore) {
    if (!this.held) return null;
    const next = structuredClone(this.held.doc);
    next.holder.progress = { phase: diagnostics.phase, done: diagnostics.done, total: diagnostics.total, started_at: next.holder.progress.started_at };
    const text = state.canonicalText(state.validateSweepRecord(next));
    if (stateStore === this.store) {
      return { path: this.file, text, sha: this.held.sha, committed: blob => { this.held = { doc: next, sha: blob }; } };
    }
    if (!this.put(next, this.held.sha, 'programme sweep: progress')) throw new state.ProgrammeError('PASS_LOCK_LOST', 'The sweep lease changed hands; this pass stopped.');
    return null;
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
  // on the version it reads now: its own state commit may have carried its progress since.
  release({ changedSince = null, completeAt = null, complete, stop = null, reason = null, busy = false, graphqlRefused = false }) {
    if (!this.held) return false;
    const { doc, sha } = this.current();
    if (doc.holder?.nonce !== this.nonce) { this.held = null; return false; }
    const next = structuredClone(doc);
    next.holder = null;
    if (changedSince) next.changed_since = changedSince;
    if (complete) { next.last_complete_at = completeAt; next.stopped_passes = 0; next.reason = null; }
    else { next.stopped_passes += 1; next.reason = reason; }
    if (this.reportedStop) next.unreported = null;
    // A stop the state could not hold (a busy branch, GraphQL refused before any write) waits here.
    if (stop) next.unreported = stop;
    next.streaks = { busy: busy ? doc.streaks.busy + 1 : 0, graphql: graphqlRefused ? doc.streaks.graphql + 1 : 0 };
    const released = this.put(next, sha, 'programme sweep: release the lease');
    this.held = null;
    return released;
  }
}

module.exports = { SweepLease, TTL_MS, STREAK_FINDING };
