'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { world, events, until } = require('./support/scheduled-job-world.cjs');

for (const order of ['shard-first', 'sweep-first']) test(`a real killed status stays retryable, ${order}`, { timeout: 95000 }, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  w.save({ statusPlan: { [shard.id]: ['kill'] }, startFails: true });
  const firstRow = order === 'shard-first' ? shard : sweep, secondRow = firstRow === shard ? sweep : shard;
  const first = w.start(firstRow);
  await until(() => events(w).some(event => event.kind === 'status-child' && event.id === firstRow.id));
  const second = w.start(secondRow);
  const shardRun = firstRow === shard ? first : second, sweepRun = firstRow === sweep ? first : second;
  const deferred = await shardRun.done;
  await sweepRun.done;
  const line = tasks.sweepLine(shard.repository, { home: w.home });
  const killed = events(w).find(event => event.kind === 'status-exit' && event.id === shard.id && event.error === 'ETIMEDOUT');
  assert.ok(killed, 'spawnSync must really kill a status child at opts.timeout');
  assert.ok(events(w).some(event => event.kind === 'status-child' && event.pid === killed.pid), 'the killed child actually entered status');
  assert.equal(deferred.status, 'deferred', JSON.stringify(deferred));
  assert.match(deferred.reason, /status.*could not be read/);
  assert.match(line, /Shard timings: deferred/);
  assert.match(line, /governance status could not be read/);
  w.save({ startFails: false });
  await w.start(sweep, 'retry').done;
  assert.equal(tasks.readLastRun(shard.id, w.home).status, 'ok');
  assert.equal(events(w).filter(event => event.kind === 'shards').length, 1, 'one completed weekly run');
  assert.ok(events(w).filter(event => event.kind === 'footer').every(event => event.writerLocked));
});

test('a slow normal refresh holder fits the status budget and its waiter', { timeout: 55000 }, async t => {
  const w = world(t), shard = w.rows.find(row => row.job === 'shard-timings'), sweep = w.rows.find(row => row.job === 'programme-sweep');
  w.save({ statusPlan: { [shard.id]: ['slow'] }, statusDelayMs: 14000 });
  const first = w.start(shard);
  await until(() => events(w).some(event => event.kind === 'status-child' && event.id === shard.id));
  const second = w.start(sweep);
  const results = await Promise.all([first.done, second.done]);
  assert.ok(results.every(record => record.status === 'ok'), JSON.stringify(results));
  assert.ok(events(w).filter(event => event.kind === 'status-exit').every(event => !event.error));
});
