'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function lingeringPids(lines) {
  const exited = new Set(lines.filter(line => /^exit \d+$/.test(line)).map(line => Number(line.split(' ')[1])));
  return [...new Set(lines.filter(line => /^keeper \d+$/.test(line) || (/^pid \d+$/.test(line) && !exited.has(Number(line.split(' ')[1]))))
    .map(line => Number(line.split(' ')[1])))];
}

// A fake the product had to kill (hang or garbled, and answer-stay on Windows) logs no exit,
// so its pid is still signalled. This keeps the rare pid-reuse exposure from before the bounded
// shutdown change; it can never cause a false pass. Keepers are always stopped before home removal.
async function stopFakes({ logs = [], savedPids = [] }) {
  const lines = logs.flatMap(log => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : []);
  const pids = [...new Set([...savedPids, ...lingeringPids(lines)])];
  // Attempt every PID even if another kill fails, and finish all waits before removing the home.
  const results = await Promise.allSettled(pids.map(async pid => {
    let killError;
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') killError = error; }
    const deadline = Date.now() + 10000;
    for (;;) {
      let queryError;
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; queryError = error; }
      if (Date.now() >= deadline) assert.fail(`Fake Codex process ${pid} did not exit within 10 s` +
        (queryError ? `; exit could not be verified (${queryError.code})` : '; pid is still alive') +
        (killError ? `; kill failed (${killError.code})` : ''));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, `Could not stop all fake Codex processes: ${errors.map(error => error.message).join('; ')}`);
}

module.exports = { lingeringPids, stopFakes };
