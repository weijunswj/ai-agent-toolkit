'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { world, events, until } = require('./support/scheduled-job-world.cjs');

// Offline adaptation of the ordinary-link Monday probe: local bare origin, real
// status children and git; only connection delays/fetch failure are substituted.
// Seven seconds to report the first failure plus 3.5 seconds for a healthy retry
// reliably exhausts the old shared ten seconds, in all five shard-first rounds.
for (let round = 1; round <= 5; round += 1) test(`ordinary-link shard-first offline round ${round} retains the weekly run`, { timeout: 40000 }, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  w.save({ statusPlan: { [shard.id]: ['ordinary-fetch-failed', 'ordinary-read'] } });
  const first = w.start(shard);
  await until(() => events(w).some(event => event.kind === 'status-child' && event.id === shard.id));
  const second = w.start(sweep);
  const [record] = await Promise.all([first.done, second.done]);
  assert.ok(['ok', 'deferred'].includes(record.status), JSON.stringify(record));
  if (tasks.readLastRun(shard.id, w.home).status !== 'ok') await w.start(sweep, 'retry').done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
  assert.equal(events(w).filter(event => event.kind === 'shards').length, 1);
});
