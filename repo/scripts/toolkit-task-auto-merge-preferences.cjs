'use strict';

// Owns the app-local answer. A missing or unreadable record never grants merge authority.
// Only trusted callers select the host/home; tool payloads are never passed to this owner.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'toolkit.task-auto-merge-preferences.v1';
const HOSTS = Object.freeze(['codex', 'claude-code']);
const normaliseHost = host => host === 'claude' ? 'claude-code' : HOSTS.includes(host) ? host : null;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

class TaskAutoMergePreferences {
  #fs; #host; #file; #writing = false;
  constructor({ host, home = os.homedir(), fileSystem = fs } = {}) {
    this.#fs = fileSystem;
    this.#host = normaliseHost(host);
    this.#file = this.#host ? path.join(home, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${this.#host}.v1.json`) : null;
  }

  #bytes() {
    try {
      const stat = this.#fs.lstatSync(this.#file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid preference file');
      return this.#fs.readFileSync(this.#file);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  inspect() {
    const base = { host: this.#host, value: 'off', digest: null };
    if (!this.#host) return { ...base, status: 'blocked', detail: 'Unknown app; automatic merging is blocked.' };
    try {
      // A write still being verified, or whose restore failed, must not grant permission.
      if (!this.#writing && this.#fs.existsSync(`${this.#file}.lock`)) return { ...base, status: 'blocked', detail: 'A setup write is unfinished; automatic merging is blocked. Finish or repair setup before running it again.' };
      const bytes = this.#bytes();
      if (bytes === null) return { ...base, status: 'missing', detail: 'Off (no answer saved)' };
      const record = JSON.parse(bytes.toString('utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record)
          || Object.keys(record).sort().join(',') !== 'host,schema,value'
          || record.schema !== SCHEMA || record.host !== this.#host || !['off', 'after-gates'].includes(record.value)) throw new Error('Invalid preference record');
      return { ...base, value: record.value, digest: digest(bytes), status: 'saved', detail: record.value === 'after-gates' ? 'On' : 'Off' };
    } catch { return { ...base, status: 'blocked', detail: 'Could not read; automatic merging is blocked. Repair the saved answer before running setup again.' }; }
  }

  verify(expected) {
    const current = this.inspect();
    if (current.status === 'blocked' || !expected || expected.status === 'blocked') throw new Error('Task auto-merge answer is unreadable or blocked. Setup wrote nothing to it.');
    if (current.host !== expected.host || current.status !== expected.status || current.digest !== expected.digest || current.value !== expected.value) throw new Error('Task auto-merge answer changed after the bank was shown. Rerun setup before writing.');
    return current;
  }

  apply(choice, expected) {
    if (!['keep', 'off', 'after-gates'].includes(choice)) throw new Error('Invalid task auto-merge answer');
    this.verify(expected);
    if (choice === 'keep') return { ...expected, changed: false };
    const folder = path.dirname(this.#file);
    this.#fs.mkdirSync(folder, { recursive: true });
    // Exclusive lock prevents two setup writers from overwriting each other's inspected answer.
    const lock = `${this.#file}.lock`;
    const handle = this.#fs.openSync(lock, 'wx');
    this.#writing = true;
    let release = true;
    const temporary = `${this.#file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let before; let written = false;
    const bytes = Buffer.from(`${JSON.stringify({ schema: SCHEMA, host: this.#host, value: choice }, null, 2)}\n`);
    try {
      this.verify(expected);
      before = this.#bytes();
      this.#fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      this.verify(expected);
      this.#fs.renameSync(temporary, this.#file);
      written = true;
      const after = this.inspect();
      if (after.status !== 'saved' || after.value !== choice || after.digest !== digest(bytes)) throw new Error('Task auto-merge read-back failed');
      return { ...after, changed: true };
    } catch (error) {
      if (written) {
        // Do not undo a concurrent edit. Keep the previous bytes for recovery when restore fails.
        try {
          const current = this.#bytes();
          if (!current || !current.equals(bytes)) throw new Error('Preference changed during read-back');
          if (before === null) this.#fs.unlinkSync(this.#file);
          else {
            this.#fs.writeFileSync(temporary, before, { flag: 'wx', mode: 0o600 });
            this.#fs.renameSync(temporary, this.#file);
          }
          const restored = this.#bytes();
          if (before === null ? restored !== null : !restored || !restored.equals(before)) throw new Error('Restore read-back failed');
        } catch {
          release = false;
          const backup = `${this.#file}.recovery-${crypto.randomBytes(8).toString('hex')}`;
          if (before !== null) this.#fs.writeFileSync(backup, before, { flag: 'wx', mode: 0o600 });
          throw new Error(`Task auto-merge write failed; restoration could not be verified. Previous answer: ${before === null ? 'no saved record' : backup}.`);
        }
        throw new Error('Task auto-merge write failed; the previous answer was restored and read back.');
      }
      throw error;
    } finally {
      try {
        if (this.#fs.existsSync(temporary)) this.#fs.unlinkSync(temporary);
      } finally {
        this.#writing = false;
        try { this.#fs.closeSync(handle); }
        finally { if (release) this.#fs.unlinkSync(lock); }
      }
    }
  }
}

module.exports = Object.freeze({ SCHEMA, HOSTS, normaliseHost, TaskAutoMergePreferences });
