'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { world, events } = require('./support/scheduled-job-world.cjs');

test('a real killed retry retains the first fetch failure and a later sweep recovers', { timeout: 95000 }, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  w.save({ statusPlan: { [shard.id]: ['fetch-failed', 'kill'] } });
  const record = await w.start(shard).done;
  const killed = events(w).find(event => event.kind === 'status-exit' && event.error === 'ETIMEDOUT');
  assert.ok(killed, 'a real retry child was killed');
  assert.ok(events(w).some(event => event.kind === 'status-child' && event.pid === killed.pid));
  assert.equal(record.status, 'deferred', JSON.stringify(record));
  assert.equal(record.reason, 'binding refresh failed: default branch fetch failed');
  assert.match(record.summary.join(' '), /retry.*could not be read/i);
  await w.start(sweep, 'retry').done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
});
