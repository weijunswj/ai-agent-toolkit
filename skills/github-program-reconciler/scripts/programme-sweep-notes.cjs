'use strict';

// Private, per-computer notes beside the existing refresh lock. The cursor is a rotation
// hint over the live catalogue. It contains no facts, effect payloads or completion proof.
const fs = require('node:fs');
const { ProgrammeError } = require('./resolve-executable.cjs');

const SCHEMA = 'toolkit.programme-sweep-rotation.v1';
const METRICS_SCHEMA = 'toolkit.programme-sweep-metrics.v1';
const MAX_BYTES = 1024;
const BATCH_SIZE = 4;
const BATCH_REQUESTS = 48;
const BATCH_MS = 45000;
const REQUEST_MS = 10000;
const PHASES = ['entry', 'resume', 'inventory', 'planning', 'state', 'page', 'links', 'order', 'pr_links', 'task_pages', 'lifecycle', 'closing', 'unknown'];
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
    this.batch = null;
    this.begin();
  }

  begin() {
    this.phases = Object.create(null);
    this.phase = 'entry';
    this.since = this.clock();
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
  }

  request(method, endpoint, privateRepo, options, run) {
    const batch = this.batch;
    let nextOptions = options;
    if (batch) {
      const left = batch.deadline - this.clock();
      if (batch.stopped) throw batch.stopped;
      if (batch.requests >= BATCH_REQUESTS || left <= 0) {
        batch.stopped = new ProgrammeError('SWEEP_SLICE_LIMIT', 'The bounded child check reached its request or time limit.');
        throw batch.stopped;
      }
      batch.requests++;
      nextOptions = { ...options, timeoutMs: Math.min(options?.timeoutMs ?? REQUEST_MS, REQUEST_MS, left) };
    }
    const key = family(method, endpoint, privateRepo);
    const counts = this.row().requests;
    counts[key] = bounded((counts[key] || 0) + 1);
    const response = run(nextOptions);
    if (batch && [401, 403, 429].includes(response?.status)) {
      batch.stopped = new ProgrammeError('SWEEP_SLICE_PROVIDER_HELD', 'The provider refused or throttled the child check. Retry on a later refresh when access is available.');
      throw batch.stopped;
    }
    return response;
  }

  runBatch(deadline, run) {
    this.phaseAt('resume');
    this.batch = { deadline: Math.min(deadline, this.clock() + BATCH_MS), requests: 0, stopped: null };
    try {
      const result = run(() => !this.batch.stopped && this.batch.requests < BATCH_REQUESTS && this.clock() < this.batch.deadline);
      return { ...result, stopped: this.batch.stopped };
    } finally {
      this.batch = null;
      this.phaseAt('entry');
    }
  }

  owned() {
    if (!this.lock.owns()) throw new ProgrammeError('PASS_LOCK_LOST', 'The pass lost its lock before saving the private sweep note.');
  }

  read(scope, issues) {
    this.hadNote = false;
    const name = this.file + '.resume';
    const invalid = () => new ProgrammeError('SWEEP_RESUME_INVALID', 'The private sweep note is invalid or unreadable. Preserve it, then move the .resume file aside before retrying.');
    let fd;
    try {
      if (!fs.lstatSync(name).isFile()) throw invalid();
      fd = fs.openSync(name, 'r');
      this.hadNote = true;
      const raw = Buffer.alloc(MAX_BYTES + 1);
      const size = fs.readSync(fd, raw);
      if (size > MAX_BYTES) throw invalid();
      const value = JSON.parse(raw.toString('utf8', 0, size));
      if (!value || Object.keys(value).sort().join(',') !== 'after,schema,scope'
        || value.schema !== SCHEMA || typeof value.scope !== 'string' || !/^[a-f0-9]{64}$/.test(value.scope)
        || !(value.after === null || Number.isSafeInteger(value.after) && value.after > 0)) throw invalid();
      if (value.scope !== scope) return null;
      if (value.after !== null && !issues.includes(value.after)) throw invalid();
      return value;
    } catch (error) {
      if (error.code === 'ENOENT' && fd === undefined) return null;
      throw invalid();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  replace(suffix, value) {
    this.owned();
    const name = this.file + suffix;
    const draft = name + '.' + this.lock.token + '.draft';
    try {
      fs.writeFileSync(draft, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
      replaceOwnedNote(draft, name, this.lock);
    } catch (error) {
      if (error.code === 'PASS_LOCK_LOST') throw error;
      throw new ProgrammeError('SWEEP_NOTE_WRITE_FAILED', 'The private sweep note could not be saved. Check local access to the refresh lock directory and retry.');
    } finally {
      try { fs.unlinkSync(draft); } catch { /* missing or locked draft; the next lock has its own token */ }
    }
  }

  save(scope, after) { this.replace('.resume', { schema: SCHEMA, scope, after }); }

  clear() {
    this.owned();
    try { fs.unlinkSync(this.file + '.resume'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new ProgrammeError('SWEEP_NOTE_WRITE_FAILED', 'The old private sweep note could not be retired. Check local access and retry.');
    }
  }

  saveMetrics() {
    this.measure();
    try { this.replace('.metrics', { schema: METRICS_SCHEMA, phases: this.phases }); }
    catch { /* Passive measurements never decide whether programme work can run. */ }
  }
}

module.exports = { SweepNotes, BATCH_SIZE, replaceOwnedNote };
