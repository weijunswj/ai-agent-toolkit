'use strict';

// A pass owns its queue, request budget and effects. No queue or clock survives in a module global.
const state = require('./programme-state.cjs');
const copy = value => structuredClone(value);
const stop = reason => Object.assign(new state.ProgrammeError('SWEEP_STOP', reason), { reason });
const ROTATION = 12;
const OVERLAP_MS = 5 * 60 * 1000;

class SweepRequests {
  constructor({ transport, cap = 300, reserve = 60, nowMs = Date.now, deadline = Infinity,
    wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
    this.transport = transport; this.cap = cap; this.reserve = reserve;
    this.nowMs = nowMs; this.deadline = deadline; this.wait = wait;
    this.count = 0; this.settling = false; this.reason = null; this.retryAt = 0;
    this.active = false; this.phases = {}; this.phase = 'opening'; this.phaseStart = nowMs();
  }
  phaseAt(phase) {
    if (phase !== this.phase) this.observePhase?.(phase);
    this.phases[this.phase] = (this.phases[this.phase] || 0) + (this.nowMs() - this.phaseStart) / 1000;
    this.phase = phase; this.phaseStart = this.nowMs();
  }
  canWork() {
    const enoughTime = this.nowMs() < this.deadline - 180000;
    if (!enoughTime) this.observeStop?.();
    this.stopReason = this.reason || (!enoughTime ? 'time limit' : this.count >= this.cap - this.reserve ? 'request cap' : null);
    return !this.stopReason;
  }
  request(method, endpoint, body, options) {
    if (this.active) throw new state.ProgrammeError('SERIAL_REQUEST_REQUIRED', 'A sweep request is already running.');
    if (this.count >= this.cap || !this.settling && !this.canWork()) throw stop(this.reason || (this.count >= this.cap - this.reserve ? 'request cap' : 'time limit'));
    if (this.retryAt > this.nowMs()) {
      const delay = this.retryAt - this.nowMs();
      if (!this.settling || this.nowMs() + delay >= this.deadline) throw stop('GitHub rate limit');
      this.wait(delay);
    }
    this.active = true; this.count++;
    try {
      const response = this.transport.request(method, endpoint, body, options);
      const headers = response.headers || {};
      if (headers['x-ratelimit-remaining'] !== undefined && Number(headers['x-ratelimit-remaining']) < 200) this.reason = 'GitHub rate limit';
      if (headers['retry-after'] !== undefined) {
        const seconds = Number(headers['retry-after']);
        this.retryAt = Number.isFinite(seconds) ? this.nowMs() + Math.max(0, seconds) * 1000 : Date.parse(headers['retry-after']);
        this.reason = 'GitHub rate limit';
      }
      if (response.status === 401) throw new state.ProgrammeError('GH_AUTH', 'GitHub rejected the sign-in.');
      return response;
    } finally { this.active = false; }
  }
  graphql(query, variables) {
    const response = this.request('POST', 'graphql', { query, variables });
    if (response.status !== 200 || response.json?.errors?.length) throw new state.ProgrammeError('GH_GRAPHQL_FAILED', 'GitHub could not read the requested facts.');
    return response.json.data;
  }
}

function queueState(parent) {
  return copy(parent.sweep || { pass: 0, queue: [], checked: {}, failures: {}, last_started_at: null,
    pages_pending: true, stopped_passes: 0, reason: 'first sweep' });
}

class ProgrammeSweep {
  constructor({ load, discover, readTask, save, draw, canWork, now = () => new Date().toISOString(), requests = null }) {
    Object.assign(this, { load, discover, readTask, save, draw, canWork, now, requests });
  }
  run() {
    const started = this.now();
    let snapshot = this.load();
    const initialChildren = snapshot.children;
    let parent = copy(snapshot.parent);
    const progress = queueState(parent);
    if (!parent.sweep) progress.queue = parent.outcomes.map(outcome => outcome.issue);
    // These are projections of already persisted revisions. No GitHub fact read may precede them.
    let previousPages = false;
    if (progress.pages_pending) {
      const pages = this.draw(snapshot);
      previousPages = pages.complete;
      if (pages.remaining) progress.page_queue = pages.remaining;
    }
    if (previousPages && progress.queue.length === 0 && progress.last_started_at && !parent.pending_effects.length) {
      parent.volatile = { ...parent.volatile, last_complete_at: progress.last_started_at };
      progress.stopped_passes = 0;
    }
    progress.pass++;
    if (this.requests) this.requests.settling = false;
    const changedDocs = new Map();
    let discovery;
    try { discovery = this.discover(parent, progress); }
    catch (error) {
      if (error instanceof TypeError || error instanceof ReferenceError) throw error;
      if (['STALE_WRITER', 'PASS_LOCK_LOST', 'GH_AUTH'].includes(error.code)) throw error;
      progress.reason = error.code === 'SWEEP_STOP' ? error.reason : 'GitHub inventory could not be read';
    }
    if (discovery) {
      parent.outcomes = discovery.outcomes;
      const known = new Set(parent.outcomes.map(outcome => outcome.issue));
      const changed = new Set(discovery.changed.filter(number => known.has(number)));
      const oldest = parent.outcomes.map(outcome => outcome.issue).sort((a, b) => (progress.checked[a] || 0) - (progress.checked[b] || 0) || a - b);
      const rotation = oldest.filter(number => !progress.checked[number] || progress.pass - progress.checked[number] >= ROTATION)
        .concat(oldest.slice(0, Math.ceil(known.size / ROTATION)));
      // A task approaching its rotation deadline cannot be displaced indefinitely by changed rows.
      const overdue = oldest.filter(number => progress.pass - (progress.checked[number] || 0) >= ROTATION - 1);
      progress.queue = [...new Set([...overdue, ...changed, ...progress.queue, ...rotation])].filter(number => known.has(number));
      progress.last_started_at = started;
      progress.reason = null;
      parent.sweep = progress;
      const attempted = new Set();
      while (progress.queue.length && this.canWork()) {
        const number = progress.queue[0];
        if (attempted.has(number)) break;
        attempted.add(number);
        try {
          const doc = this.readTask(parent.outcomes.find(outcome => outcome.issue === number), snapshot, parent);
          changedDocs.set(number, doc);
          progress.queue.shift(); progress.checked[number] = progress.pass; delete progress.failures[number];
        } catch (error) {
          if (error instanceof TypeError || error instanceof ReferenceError) throw error;
          if (['STALE_WRITER', 'PASS_LOCK_LOST', 'GH_AUTH'].includes(error.code)) throw error;
          if (error.code === 'SWEEP_STOP') { progress.reason = error.reason; break; }
          progress.queue.push(progress.queue.shift());
          progress.failures[number] = (progress.failures[number] || 0) + 1;
          if (progress.failures[number] >= 3) parent.attention = state.foldAttention(parent.attention, {
            source: 'reconcile', complete: false, now: started, seen: [{ code: 'SWEEP_TASK_UNREADABLE', issue: number }],
          });
        }
      }
      if (progress.queue.length && !progress.reason) progress.reason = this.requests?.stopReason || (this.canWork() ? 'task read failed' : 'pass limit');
    }
    if (progress.reason || progress.queue.length) progress.stopped_passes++;
    progress.pages_pending = true;
    if (progress.page_queue) progress.page_queue = [...new Set([...progress.page_queue, ...changedDocs.keys(), parent.parent_issue])];
    parent.sweep = progress;
    if (this.requests) { this.requests.settling = true; this.requests.phaseAt('state'); }
    snapshot = this.save({ parent, children: changedDocs, base: snapshot, pagesConfirmed: previousPages });
    if (this.requests) this.requests.phaseAt('pages');
    const pages = this.draw(snapshot);
    const queueLeft = snapshot.parent.sweep.queue.length;
    if (this.requests) this.requests.phaseAt('finished');
    const phases = Object.entries(this.requests?.phases || {}).map(([phase, seconds]) => `${phase}=${seconds.toFixed(3)}s`).join(', ');
    const metrics = `requests=${this.requests?.count || 0}${phases ? `, ${phases}` : ''}, queue=${queueLeft}`;
    const factChanges = [...changedDocs].filter(([number, doc]) => !initialChildren.has(number) || !state.sameState(initialChildren.get(number), doc)).length;
    return { repository: parent.repository, parent_issue: parent.parent_issue, mode: 'apply', parent_revision: snapshot.parent.revision,
      queue_left: queueLeft, metrics, summary: factChanges ? `Updated ${factChanges} tasks` : 'No changes',
      holds: queueLeft || !pages.complete ? [{ code: 'SWEEP_INCOMPLETE', detail: progress.reason || 'pages still to draw' }] : [],
      findings: [], results: [], effects: [], close_list: [], recovered: [], next_action: queueLeft ? 'Run the sweep again to check the remaining tasks' : 'Read the programme board',
      writes: { state: snapshot.stateWrites ?? factChanges, github: pages.writes || 0 } };
  }
}

module.exports = { ProgrammeSweep, SweepRequests, queueState, ROTATION, OVERLAP_MS };
