'use strict';

// Mirror closure matrix, race row 2: computer A's handoff commit could not be pushed (kept in its
// checkout), and computer B saved before A's next run. That run catches up first (the race merge
// keeps the store's snapshot folder whole) and plans from the store's snapshot, so the kept removal
// never wedges the checkout and B's save stays.
const assert = require('node:assert/strict');
const test = require('node:test');
const { raceWorld } = require('./support/toolkit-handoff-race-world.cjs');

test('a kept handoff commit meeting a store that moved is caught up before the next run plans', t => {
  const r = raceWorld(t);
  r.drop('c.md');
  r.w.hooks.refusePushes = 4;
  const kept = r.on('a', [], '2026-11-21T13:00:00Z');
  assert.equal(kept.code, 1, JSON.stringify(kept.result));
  assert.ok(r.ahead() > 0, 'the removal commit is kept');
  r.asB(() => { r.put('c.md', 'c v1\n', '2026-11-21T09:20:00Z'); r.put('d.md', 'd v1 (computer B)\n', '2026-11-21T12:30:00Z'); },
    () => { r.drop('c.md'); r.drop('d.md'); }, '2026-11-21T13:10:00Z')();
  const next = r.on('a', [], '2026-11-21T13:20:00Z');
  assert.deepEqual([next.code, next.result.handoff, next.result.removed], [0, 'SAVED', 'memory/c.md'], JSON.stringify(next.result));
  assert.equal(r.row('memory/c.md'), undefined);
  assert.equal(r.has('memory/c.md'), false);
  assert.ok(r.row('memory/d.md') && r.has('memory/d.md'));
  assert.equal(r.w.remoteHas('evidence/store-conflicts'), false);
  assert.equal(r.ahead(), 0);
});
