'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const tasks = require('../scripts/toolkit-tasks.cjs');
const { world, events, until, pause } = require('./support/scheduled-job-world.cjs');

test('fix3 C: store release restarts the next-minute repository within a bounded time', { timeout: 95000 }, async t => {
  const w = world(t, ['example/repo-a', 'example/repo-b']);
  const [a, b] = ['example/repo-a', 'example/repo-b'].map(repository => w.rows.find(row => row.repository === repository && row.job === 'programme-sweep'));
  assert.equal(b.repo_minute - a.repo_minute, 1);
  w.save({ holdId: a.id, holdRelease: path.join(w.base, 'release-holder') });
  const first = w.start(a);
  await until(() => events(w).some(event => event.id === a.id && event.kind === 'footer'));
  await pause(60000);
  let deferred, deferredLine;
  try {
    deferred = await w.start(b).done;
    deferredLine = tasks.sweepLine(b.repository, { home: w.home });
  } finally {
    fs.writeFileSync(w.config.holdRelease, 'release');
    await first.done;
  }
  assert.equal(deferred.status, 'deferred');
  assert.deepEqual({ count: deferred.deferred_count, ageSaved: typeof deferred.deferred_since === 'string',
    finalStatus: tasks.readLastRun(b.id, w.home).status,
    starts: events(w).filter(event => event.kind === 'start' && event.name === b.name).length },
  { count: 1, ageSaved: true, finalStatus: 'ok', starts: 1 });
  assert.match(deferredLine, /deferred.*\d+.*(?:min|minute|second)/);
  const times = events(w); assert.ok(times.find(event => event.kind === 'footer' && event.id === b.id).at - times.find(event => event.kind === 'footer' && event.id === a.id).at < 80000);
  assert.ok(times.find(event => event.kind === 'finished' && event.id === b.id && event.status === 'deferred').at - times.find(event => event.kind === 'footer' && event.id === a.id).at >= 60000);
});
