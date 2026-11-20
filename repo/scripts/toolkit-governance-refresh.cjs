'use strict';

// Refreshes several repositories' merged bindings at once, each in its own worker thread, for a cloud
// session start that reads every repository cloned under its start folder within one deadline. Read
// one after another, a slow first read (a cold network on a resume) spent the shared deadline and
// every later repository said it could not check governance; side by side, each read has the whole
// deadline. The caller blocks until every read returns or the deadline (plus a short grace for the
// threads to start and report) passes. A read that has not reported by then counts as
// 'read-timed-out', and one whose thread could not start or failed as 'refresh-failed', so the session
// line names the cause. Never throws. Each read is the ordinary bounded refresh, so it writes only
// this computer's cache and the default branch's tracking ref, and every git call it makes stops at
// the deadline.

const path = require('node:path');
const { Worker, MessageChannel, receiveMessageOnPort, isMainThread, workerData } = require('node:worker_threads');

// Time for the threads to start, load the refresh and report after the deadline stopped their git.
const REPORT_GRACE_MS = 1000;
const WORKER_KIND = 'toolkit-governance-refresh';
const STATE_MODULE = path.join(__dirname, 'toolkit-governance-state.cjs');

// { root: result } with each result as refreshMergedBinding gives it. `module` is the file whose
// refreshMergedBinding each thread runs (tests pass a stand-in); `grace` is for tests.
function refreshAll(roots, { registryOptions = {}, deadline, module = STATE_MODULE, grace = REPORT_GRACE_MS } = {}) {
  const results = new Map();
  const done = new Int32Array(new SharedArrayBuffer(4));
  const running = [];
  for (const root of roots) {
    try {
      const { port1, port2 } = new MessageChannel();
      const thread = new Worker(__filename, { workerData: { kind: WORKER_KIND, root, registryOptions, deadline, module, done, port: port2 }, transferList: [port2] });
      thread.unref();
      thread.on('error', () => { /* reported as refresh-failed below */ });
      running.push({ root, port: port1, thread });
    } catch { results.set(root, { refreshed: false, error: 'refresh-failed' }); }
  }
  for (;;) {
    const seen = Atomics.load(done, 0);
    const left = deadline + grace - Date.now();
    if (seen >= running.length || left <= 0) break;
    Atomics.wait(done, 0, seen, left);
  }
  for (const { root, port, thread } of running) {
    const reported = receiveMessageOnPort(port);
    const result = reported && reported.message && typeof reported.message === 'object' ? reported.message : null;
    results.set(root, result || { refreshed: false, error: 'read-timed-out' });
    try { port.close(); } catch { /* closing only frees the port */ }
    if (!result) thread.terminate().catch(() => {});
  }
  return results;
}

// The thread: one bounded refresh, then its result and one count, whatever happens.
if (!isMainThread && workerData && workerData.kind === WORKER_KIND) {
  let result = { refreshed: false, error: 'refresh-failed' };
  try {
    const refreshed = require(workerData.module).refreshMergedBinding(workerData.root, workerData.registryOptions, { deadline: workerData.deadline });
    if (refreshed && typeof refreshed === 'object') result = { refreshed: refreshed.refreshed === true, error: typeof refreshed.error === 'string' ? refreshed.error : null };
  } catch { /* refresh-failed */ }
  try { workerData.port.postMessage(result); } catch { /* unreported: the caller counts it as timed out */ }
  Atomics.add(workerData.done, 0, 1);
  Atomics.notify(workerData.done, 0);
}

module.exports = Object.freeze({ refreshAll, REPORT_GRACE_MS });
