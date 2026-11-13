'use strict';

// The request budget of one sweep process. Requests run one at a time, as GitHub advises; a pass
// never sends more than `cap` of them, keeps `reserve` for saving and settling once reading stops,
// stops reading when GitHub's own remaining count reaches the safety margin, and honours retry-after.
const state = require('./programme-state.cjs');

const CAP = 300;
// The cap per pass, by host and mode. On GitHub a scheduled pass has no cap of its own: it runs under
// the governance App's own hourly allowance, one App per governed repository, and reads until GitHub's
// remaining count reaches the safety margin below. It then saves where it got to and the next run
// resumes, changed and new tasks first. On a computer the pass shares the signed-in account's limit
// with everything else that account does, so it keeps 600. A refresh a session starts after its own
// write stays small, at CAP, on both hosts, so it never spends the hour's allowance.
const GITHUB_LIMIT = Infinity;
const PASS_CAPS = Object.freeze({
  cloud: Object.freeze({ scheduled: GITHUB_LIMIT, 'after-write': CAP }),
  computer: Object.freeze({ scheduled: 600, 'after-write': CAP }),
});
const passCap = ({ host, scheduled }) => (PASS_CAPS[host] || PASS_CAPS.computer)[scheduled === true ? 'scheduled' : 'after-write'];
// How a cap reads in the pass's metrics line.
const capText = cap => (Number.isFinite(cap) ? String(cap) : 'GitHub limit');
const RESERVE = 60;
const LOW_REMAINING = 200;
// The safety margin: a pass stops reading while this share of GitHub's hourly limit (its own
// x-ratelimit-limit) is still left, and never below LOW_REMAINING. Other jobs on the same App (the
// shard timings job, the re-bump push, a sweep started by a merge) keep that much for the hour.
// Change this one number to change the margin.
const MARGIN_SHARE = 0.10;
const margin = limit => Math.max(LOW_REMAINING, Number.isFinite(limit) && limit > 0 ? Math.ceil(limit * MARGIN_SHARE) : 0);
// What one task usually costs to read (comments, its PR, blockers), and what drawing its task page
// costs later in the same pass: measured at about seven requests (the page read, its comments, the
// read before the write, the write, its read-back and the state checks around it). A task is started
// only when its reads and the pages of every task read so far still fit before the reserve, which
// the state commit, the parent page and the lease keep for themselves. An estimate below the real
// cost lets a large parent read every task and then run out before its first page, every pass.
const TASK_COST = 3;
const PAGE_COST = 7;
// Past reading: below SETTLE_FLOOR left the queue phases stop (the stop report and the parent's
// redraw still run); below LAST_REQUESTS only bookkeeping runs (settling intents, the lease).
const SETTLE_FLOOR = 30;
const LAST_REQUESTS = 10;

const stop = reason => Object.assign(new state.ProgrammeError('PASS_STOPPED', `The sweep stopped: ${reason}.`), { reason });

class SweepRequests {
  constructor({ transport, cap = CAP, reserve = Math.min(RESERVE, Math.floor(cap / 3)), nowMs = Date.now,
    wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
    Object.assign(this, { transport, cap, reserve, nowMs, wait });
    this.count = 0;
    this.reading = true;
    this.reason = null;
    this.retryAt = 0;
    this.active = false;
    // GitHub's last reported x-ratelimit-remaining for the REST (core) limit, or null before any REST
    // response carried one. GraphQL has its own limit, named by x-ratelimit-resource, and never
    // stands in for it: pages are drawn over REST.
    this.remaining = null;
    // GitHub's last reported x-ratelimit-limit for the same REST limit, or null.
    this.limit = null;
  }

  // The remaining count below which this pass leaves GitHub's allowance to others.
  floor() { return margin(this.limit); }

  // What this pass may still spend: its own cap, and GitHub's remaining count above the margin.
  left() { return Math.min(this.cap - this.count, this.remaining === null ? Infinity : this.remaining - this.floor()); }

  // Which limit stops this pass: GitHub's hourly allowance, or the pass's own request cap.
  bound() { return this.remaining !== null && this.remaining - this.floor() <= this.cap - this.count ? 'GitHub rate limit' : 'request cap'; }

  // Whether another task may start: its reads, and the pages of the `pages` tasks read so far that
  // may need one (plus its own when `needsPage`), must fit before the reserve.
  // GitHub's own remaining count bounds it too (left()): the reads and pages must also fit above the
  // margin, so a pass never draws pages into the share the margin keeps for other jobs.
  canStartTask(pages = 0, needsPage = true) {
    const need = this.reserve + TASK_COST + PAGE_COST * (pages + (needsPage ? 1 : 0));
    return !this.reason && this.left() >= need;
  }

  request(method, endpoint, body, options) {
    if (this.active) throw new state.ProgrammeError('SERIAL_REQUEST_REQUIRED', 'A sweep request is already running.');
    if (this.count >= this.cap) throw stop('request cap');
    if (this.reading && (this.reason || this.left() <= this.reserve)) throw stop(this.reason || this.bound());
    if (this.retryAt > this.nowMs()) {
      if (this.reading) throw stop('GitHub rate limit');
      this.wait(this.retryAt - this.nowMs());
    }
    this.active = true;
    this.count += 1;
    // Past reading, a low budget ends the queue phases cleanly; what is left records the stop and redraws.
    if (!this.reading && this.left() <= SETTLE_FLOOR && !this.limited) { this.limited = true; this.onLimit?.(this.bound()); }
    if (!this.reading && this.left() <= LAST_REQUESTS && !this.exhausted) { this.exhausted = true; this.onExhausted?.(); }
    try {
      const response = this.transport.request(method, endpoint, body, options);
      const headers = response?.headers || {};
      // GitHub's own time at the start of the pass: the next pass reads what changed since then.
      if (!this.serverStart && Number.isFinite(Date.parse(headers.date))) this.serverStart = new Date(Date.parse(headers.date)).toISOString();
      if (headers['x-ratelimit-remaining'] !== undefined && Number.isFinite(Number(headers['x-ratelimit-remaining']))) {
        const remaining = Number(headers['x-ratelimit-remaining']);
        const resource = headers['x-ratelimit-resource'];
        if (resource === undefined || resource === 'core') {
          this.remaining = remaining;
          const limit = Number(headers['x-ratelimit-limit']);
          if (Number.isFinite(limit) && limit > 0) this.limit = limit;
          if (remaining < this.floor()) this.reason = 'GitHub rate limit';
        } else if (remaining < LOW_REMAINING) this.reason = 'GitHub rate limit';
      }
      if (headers['retry-after'] !== undefined) {
        const seconds = Number(headers['retry-after']);
        this.retryAt = Number.isFinite(seconds) ? this.nowMs() + Math.max(0, seconds) * 1000 : Date.parse(headers['retry-after']) || this.nowMs();
        this.reason = 'GitHub rate limit';
      }
      return response;
    } finally { this.active = false; }
  }

  // The cloud transport checks each token reaches only its own repository; those reads count too.
  verify() {
    if (typeof this.transport.verify !== 'function') return true;
    this.transport.verify();
    this.count += this.transport.routes.size;
    return true;
  }

  graphql(query, variables) {
    const response = this.request('POST', 'graphql', { query, variables });
    if (response.status !== 200 || response.json?.errors?.length) throw new state.ProgrammeError('GH_GRAPHQL_FAILED', `GraphQL query failed (${response.status}).`);
    return response.json.data;
  }
}

module.exports = { SweepRequests, CAP, GITHUB_LIMIT, PASS_CAPS, passCap, capText, RESERVE, LOW_REMAINING, MARGIN_SHARE, margin, TASK_COST, PAGE_COST, SETTLE_FLOOR, LAST_REQUESTS };
