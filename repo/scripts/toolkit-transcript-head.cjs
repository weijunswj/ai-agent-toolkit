'use strict';

// Reads the head of a Claude Code session transcript (one JSON entry per line), for the hooks that
// need what the host wrote first: the gate route check's brief (toolkit-gate-route.cjs) and a Claude
// Projects thread's session context (toolkit-projects-cloud.cjs). It loads only node:fs and never
// writes.

const fs = require('node:fs');

const HEAD_BYTES = 2 * 1024 * 1024;

function readSlice(file, start, length) {
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, start);
    return buffer.subarray(0, read).toString('utf8');
  } finally { fs.closeSync(handle); }
}

const parse = line => { try { return JSON.parse(line); } catch { return null; } };

// The first main-thread (not sidechain) `type: "user"` entry that `accept` takes, or null when the
// file is missing or holds none in its first HEAD_BYTES. With no `accept`, the very first one.
function firstUserEntry(file, accept = () => true) {
  let size;
  try { size = fs.statSync(file).size; } catch { return null; }
  // The first entries sit near the top: read in steps, so a long transcript is not read whole on
  // every tool call. A slice may end mid-line; that line is read again with the next, longer slice.
  for (let length = 128 * 1024; ; length *= 4) {
    const whole = length >= size || length >= HEAD_BYTES;
    const lines = readSlice(file, 0, Math.min(size, length, HEAD_BYTES)).split('\n');
    for (const line of whole ? lines : lines.slice(0, -1)) {
      const entry = parse(line);
      if (entry && entry.type === 'user' && !entry.isSidechain && accept(entry)) return entry;
    }
    if (whole) return null;
  }
}

module.exports = Object.freeze({ HEAD_BYTES, firstUserEntry, readSlice });
