'use strict';

// Private, per-computer measurements beside the existing refresh lock: how long each phase of the
// latest refresh took and how many GitHub requests it made, by family. No facts, no payloads.
const fs = require('node:fs');
const { ProgrammeError } = require('./resolve-executable.cjs');

const METRICS_SCHEMA = 'toolkit.programme-sweep-metrics.v1';
const PHASES = ['entry', 'inventory', 'planning', 'state', 'page', 'links', 'order', 'pr_links', 'task_pages', 'lifecycle', 'closing', 'unknown'];
const COUNTER_MAX = 1000000;
const bounded = n => Math.max(0, Math.min(COUNTER_MAX, Math.floor(n)));

// Windows can briefly hold the previous name open. Keep the old file in place and retry only the
// atomic rename, while the same lock still owns the note. A permanent refusal remains a refusal.
function replaceOwnedNote(draft, name, lock) {
  const waits = [5, 15, 35];
  for (let attempt = 0; ; attempt++) {
    if (!lock.owns()) throw new ProgrammeError('PASS_LOCK_LOST', 'The pass lost its lock before saving a sweep note.');
    try { fs.renameSync(draft, name); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= waits.length) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waits[attempt]);
    }
  }
}

function family(method, endpoint, store) {
  if (endpoint === 'graphql') return 'graphql';
  const pathname = endpoint.split('?')[0].toLowerCase();
  if (pathname === store || pathname.startsWith(store + '/')) return method === 'GET' ? 'store_read' : 'store_write';
  if (pathname.includes('/contents/') || pathname.includes('/git/') || pathname.includes('/branches/')) return method === 'GET' ? 'state_read' : 'state_write';
  if (method !== 'GET') return 'public_effect';
  if (/\/pulls(?:\/|$)/.test(pathname)) return 'pull';
  if (pathname.includes('/comments')) return 'comment';
  if (pathname.includes('/sub_issues')) return 'native';
  if (/\/issues(?:\/|$)/.test(pathname)) return 'issue';
  return 'other';
}

class SweepNotes {
  constructor({ file, lock, clock }) {
    this.file = file;
    this.lock = lock;
    this.clock = clock;
    this.begin();
  }

  begin() {
    this.phases = Object.create(null);
    this.phase = 'entry';
    this.since = this.clock();
    this.reads = null;
  }

  phaseAt(name) {
    if (name === this.phase) return;
    this.measure();
    this.phase = PHASES.includes(name) ? name : 'unknown';
    this.since = this.clock();
  }

  row() {
    return this.phases[this.phase] ??= { elapsed_ms: 0, requests: {} };
  }

  measure() {
    const row = this.row();
    row.elapsed_ms = bounded(row.elapsed_ms + Math.max(0, this.clock() - this.since));
    this.since = this.clock();
  }

  request(method, endpoint, privateRepo, options, run) {
    const key = family(method, endpoint, privateRepo);
    const counts = this.row().requests;
    counts[key] = bounded((counts[key] || 0) + 1);
    return run(options);
  }

  // Passive: a measurement that cannot be saved never decides whether programme work can run.
  saveMetrics() {
    this.measure();
    const name = this.file + '.metrics';
    const draft = name + '.' + this.lock.token + '.draft';
    try {
      const value = { schema: METRICS_SCHEMA, phases: this.phases, ...(this.reads ? { reads: this.reads } : {}) };
      fs.writeFileSync(draft, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
      replaceOwnedNote(draft, name, this.lock);
    } catch { /* not saved this time */ }
    finally { try { fs.unlinkSync(draft); } catch { /* already renamed, or never written */ } }
  }
}

module.exports = { SweepNotes, replaceOwnedNote };
