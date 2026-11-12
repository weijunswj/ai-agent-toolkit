'use strict';

// The request budget of one sweep process. Requests run one at a time, as GitHub advises; a pass
// never sends more than `cap` of them, keeps `reserve` for saving and settling once reading stops,
// stops reading when GitHub reports fewer than LOW_REMAINING left, and honours retry-after.
const state = require('./programme-state.cjs');

const CAP = 300;
const RESERVE = 60;
const LOW_REMAINING = 200;
// The most one task's reads can cost (issue, blockers, PR, journals, comments, PR pages), and the
// page writes that may follow for it. A task is started only when that much is still left.
const TASK_COST = 9;
// Requests kept after the queue phases stop: the stop report, the parent redraw and its intents.
const SETTLE_FLOOR = 40;

const stop = reason => Object.assign(new state.ProgrammeError('PASS_STOPPED', `The sweep stopped reading: ${reason}.`), { reason });

class SweepRequests {
  constructor({ transport, cap = CAP, reserve = RESERVE, nowMs = Date.now,
    wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
    Object.assign(this, { transport, cap, reserve, nowMs, wait });
    this.count = 0;
    this.reading = true;
    this.reason = null;
    this.retryAt = 0;
    this.active = false;
  }

  left() { return this.cap - this.count; }

  // Whether another task may start: its reads and pages must fit before the reserve.
  canStartTask() { return !this.reason && this.left() >= this.reserve + TASK_COST; }

  request(method, endpoint, body, options) {
    if (this.active) throw new state.ProgrammeError('SERIAL_REQUEST_REQUIRED', 'A sweep request is already running.');
    if (this.count >= this.cap) throw stop('request cap');
    if (this.reading && (this.reason || this.left() <= this.reserve)) throw stop(this.reason || 'request cap');
    if (this.retryAt > this.nowMs()) {
      if (this.reading) throw stop('GitHub rate limit');
      this.wait(this.retryAt - this.nowMs());
    }
    this.active = true;
    this.count += 1;
    // Past reading, a low budget ends the queue phases cleanly; what is left records the stop and redraws.
    if (!this.reading && this.left() <= SETTLE_FLOOR && !this.limited) { this.limited = true; this.onLimit?.('request cap'); }
    try {
      const response = this.transport.request(method, endpoint, body, options);
      const headers = response?.headers || {};
      // GitHub's own time at the start of the pass: the next pass reads what changed since then.
      if (!this.serverStart && Number.isFinite(Date.parse(headers.date))) this.serverStart = new Date(Date.parse(headers.date)).toISOString();
      if (headers['x-ratelimit-remaining'] !== undefined && Number(headers['x-ratelimit-remaining']) < LOW_REMAINING) this.reason = 'GitHub rate limit';
      if (headers['retry-after'] !== undefined) {
        const seconds = Number(headers['retry-after']);
        this.retryAt = Number.isFinite(seconds) ? this.nowMs() + Math.max(0, seconds) * 1000 : Date.parse(headers['retry-after']) || this.nowMs();
        this.reason = 'GitHub rate limit';
      }
      return response;
    } finally { this.active = false; }
  }

  graphql(query, variables) {
    const response = this.request('POST', 'graphql', { query, variables });
    if (response.status !== 200 || response.json?.errors?.length) throw new state.ProgrammeError('GH_GRAPHQL_FAILED', `GraphQL query failed (${response.status}).`);
    return response.json.data;
  }
}

module.exports = { SweepRequests, CAP, RESERVE, LOW_REMAINING, TASK_COST, SETTLE_FLOOR };
