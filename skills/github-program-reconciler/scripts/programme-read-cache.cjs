'use strict';

// A private, per-computer copy of slow-changing GitHub reads, beside the refresh lock: the parent
// issue's comments (so the next pass asks only for comments changed since) and, for each settled
// child, its comments and merged pull request. The reconciler uses a copy only together with live
// evidence from the same pass that it is still current. A missing, unreadable, foreign or old file
// only means everything is read from GitHub again: this file can remove requests, never add a
// hold, and it never authorises a write.
const fs = require('node:fs');
const { replaceOwnedNote } = require('./programme-sweep-notes.cjs');

const SCHEMA = 'toolkit.programme-read-cache.v1';
const MAX_BYTES = 64 * 1024 * 1024;
// A copy older than this is read again whatever the live evidence says.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Each pass re-reads the oldest share of the copies it could have used, so every settled child is
// read in full again within this many passes.
const ROTATION = 12;
// Comments changed up to this long before the bookmark are asked for again.
const OVERLAP_MS = 5 * 60 * 1000;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isComment = value => isObject(value) && Number.isSafeInteger(value.id) && typeof value.body === 'string' && isTime(value.created_at);
const isComments = value => Array.isArray(value) && value.every(isComment);

function validChild(entry) {
  return isObject(entry) && isTime(entry.updated_at) && isTime(entry.read_at) && isCount(entry.comment_count) && isCount(entry.sub_total)
    && isComments(entry.comments) && entry.comments.length === entry.comment_count
    && (entry.pr === null || isObject(entry.pr) && Number.isSafeInteger(entry.pr.number) && entry.pr.state === 'MERGED');
}

class ReadCache {
  constructor({ file, lock, repository, parent }) {
    this.file = file ? `${file}.reads` : null;
    this.lock = lock;
    this.repository = String(repository || '').toLowerCase();
    this.parent = parent;
    this.discussion = null;
    this.children = new Map();
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
      for (const [key, entry] of Object.entries(isObject(value.children) ? value.children : {})) {
        if (/^[1-9]\d*$/.test(key) && validChild(entry)) this.children.set(Number(key), entry);
      }
    } catch { /* no usable copy: read everything */ }
  }

  beginPass() { this.counts = { rows: 0, reused: 0, reread: 0, bookmark: 'none' }; }

  // The settled-child copies this pass may use: `candidates` are [number, facts] pairs the caller
  // has already found settled, with live facts from this pass. The oldest share is left out so it
  // is read again.
  usable(candidates, now) {
    const hits = [];
    for (const [number, facts] of candidates) {
      const entry = this.children.get(number);
      if (!entry || entry.updated_at !== facts.updated_at || entry.comment_count !== facts.comments || entry.sub_total !== facts.sub_issues_total) continue;
      const age = Date.parse(now) - Date.parse(entry.read_at);
      if (!(age >= 0 && age < MAX_AGE_MS)) continue;
      hits.push([number, entry]);
    }
    hits.sort((a, b) => Date.parse(a[1].read_at) - Date.parse(b[1].read_at) || a[0] - b[0]);
    const rotate = Math.ceil(hits.length / ROTATION);
    this.counts.reread += rotate;
    this.counts.reused += hits.length - rotate;
    return new Map(hits.slice(rotate));
  }

  setChild(number, entry) {
    if (!validChild(entry)) { this.dropChild(number); return; }
    this.children.set(number, entry);
    this.dirty = true;
  }

  dropChild(number) { if (this.children.delete(number)) this.dirty = true; }

  retain(numbers) {
    const keep = new Set(numbers);
    for (const number of [...this.children.keys()]) if (!keep.has(number)) this.dropChild(number);
  }

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
      const value = { schema: SCHEMA, repository: this.repository, parent: this.parent,
        discussion: this.discussion, children: Object.fromEntries([...this.children].sort((a, b) => a[0] - b[0])) };
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

module.exports = { ReadCache, mergeComments, SCHEMA, ROTATION, MAX_AGE_MS, OVERLAP_MS };
