'use strict';

// A private, per-computer copy of the parent issue's comments, beside the refresh lock, so the next
// pass asks only for comments changed since. The reconciler uses it only when it accounts for
// exactly the comments the issue reports in the same pass; which tasks a pass reads is decided by
// the saved queue in the state, never by this file. A missing, unreadable or foreign file only
// means the comments are read in full again: this file can remove requests, never add a hold, and
// it never authorises a write.
const fs = require('node:fs');
const { replaceOwnedNote } = require('./programme-sweep-notes.cjs');

const SCHEMA = 'toolkit.programme-read-cache.v1';
const MAX_BYTES = 64 * 1024 * 1024;
// Comments changed up to this long before the bookmark are asked for again.
const OVERLAP_MS = 5 * 60 * 1000;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isComment = value => isObject(value) && Number.isSafeInteger(value.id) && typeof value.body === 'string' && isTime(value.created_at);
const isComments = value => Array.isArray(value) && value.every(isComment);

class ReadCache {
  constructor({ file, lock, repository, parent }) {
    this.file = file ? `${file}.reads` : null;
    this.lock = lock;
    this.repository = String(repository || '').toLowerCase();
    this.parent = parent;
    this.discussion = null;
    this.counts = { rows: 0, reused: 0, reread: 0, bookmark: 'none' };
    this.dirty = false;
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      if (fs.statSync(this.file).size > MAX_BYTES) return;
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!isObject(value) || value.schema !== SCHEMA || value.repository !== this.repository || value.parent !== this.parent) return;
      const kept = value.discussion;
      if (isObject(kept) && isTime(kept.bookmark) && isComments(kept.comments)) this.discussion = { bookmark: kept.bookmark, comments: kept.comments };
    } catch { /* no usable copy: read everything */ }
  }

  beginPass() { this.counts = { rows: 0, reused: 0, reread: 0, bookmark: 'none' }; }

  // The time to ask GitHub for changed comments from, or null when there is no copy to build on.
  since() {
    return this.discussion ? new Date(Date.parse(this.discussion.bookmark) - OVERLAP_MS).toISOString() : null;
  }

  setDiscussion(comments, bookmark) {
    this.discussion = isComments(comments) && isTime(bookmark) ? { bookmark, comments } : null;
    this.dirty = true;
  }

  // Only the lock's owner replaces the file. A failed save leaves the previous copy or none.
  save() {
    if (!this.file || !this.dirty) return;
    const draft = `${this.file}.${this.lock?.token || 'x'}.draft`;
    try {
      if (!this.lock?.owns()) return;
      const value = { schema: SCHEMA, repository: this.repository, parent: this.parent, discussion: this.discussion };
      fs.writeFileSync(draft, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
      replaceOwnedNote(draft, this.file, this.lock);
      this.dirty = false;
    } catch { /* the next pass reads from GitHub */ }
    finally { try { fs.unlinkSync(draft); } catch { /* already renamed, or never written */ } }
  }
}

// The stored list with the changed comments laid over it, oldest first as GitHub lists them.
function mergeComments(stored, changed) {
  const byId = new Map(stored.map(comment => [comment.id, comment]));
  for (const comment of changed) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
}

module.exports = { ReadCache, mergeComments, SCHEMA };
