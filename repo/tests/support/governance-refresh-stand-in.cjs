'use strict';

// Test-only stand-in for the refresh a cloud session start runs in each worker thread
// (toolkit-governance-refresh.cjs). It reads nothing: the repository folder's name says what to do.
//   *slow*    holds its thread until the deadline, then reports the timed-out read
//   *hang*    never reports before the caller stops waiting
//   *throw*   throws
//   other     reports how much of the deadline was left when it started: a read that started with
//             under half of TIME_MS left was starved by an earlier one
const path = require('node:path');

const TIME_MS = 2000;
const sleep = ms => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

function refreshMergedBinding(root, _options, { deadline } = {}) {
  const name = path.basename(root);
  if (name.includes('slow')) { sleep(deadline - Date.now()); return { refreshed: false, error: 'read-timed-out' }; }
  if (name.includes('hang')) { sleep(deadline - Date.now() + 1500); return { refreshed: true, error: null }; }
  if (name.includes('throw')) throw new Error('stand-in failure');
  return { refreshed: false, error: deadline - Date.now() >= TIME_MS / 2 ? 'fetch-failed' : 'read-timed-out' };
}

module.exports = Object.freeze({ refreshMergedBinding, TIME_MS });
