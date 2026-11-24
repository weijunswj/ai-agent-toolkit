'use strict';

// Mirror closure matrix, race row 1: computer A's handoff save meets a store computer B moved. The
// race merge keeps the store's snapshot folder whole (never one side's manifest beside the other's
// files), and A's run plans again from it, so A's removal, addition and update all land, B's save
// stays, the checkout is not wedged, and B, which never held A's new file, never removes it.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { raceWorld } = require('./support/toolkit-handoff-race-world.cjs');

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

test('a removal, an addition and an update racing another computer\'s save all land on the store\'s snapshot, and that computer keeps them', t => {
  const r = raceWorld(t);
  // A deletes c, adds x and edits a; B (its folder still a v1, b, c, plus a new d) saves first.
  const toA = () => { r.drop('c.md'); r.drop('d.md'); r.put('x.md', 'x: a new decision on computer A\n', '2026-11-21T12:50:00Z'); r.put('a.md', 'a v2 (computer A)\n', '2026-11-21T12:55:00Z'); };
  const toB = () => { r.drop('x.md'); r.put('a.md', 'a v1\n', '2026-11-21T09:00:00Z'); r.put('c.md', 'c v1\n', '2026-11-21T09:20:00Z'); r.put('d.md', 'd v1 (computer B)\n', '2026-11-21T12:40:00Z'); };
  toA();
  r.w.hooks.beforePush = r.asB(toB, toA, '2026-11-21T13:00:30Z');
  const a = r.on('a', [], '2026-11-21T13:00:00Z');
  assert.deepEqual([a.code, a.result.handoff, a.result.removed, a.result.diverged], [0, 'SAVED', 'memory/c.md', undefined], JSON.stringify(a.result));
  assert.equal(r.row('memory/c.md'), undefined, 'the removal landed');
  assert.ok(r.removed('memory/c.md'));
  assert.equal(r.has('memory/c.md'), false);
  assert.ok(r.row('memory/x.md') && r.has('memory/x.md'), 'the addition has its row and its copy');
  assert.equal(r.row('memory/a.md').sha256, sha('a v2 (computer A)\n'), 'the update landed');
  assert.ok(r.row('memory/d.md') && r.has('memory/d.md'), 'B\'s save stays');
  assert.equal(r.w.remoteHas('evidence/store-conflicts'), false, 'no manifest parked beside the store\'s');
  assert.equal(r.ahead(), 0);
  // The checkout is not wedged: a plain save goes out.
  r.w.write('archives/race/report.md', 'report\n');
  assert.equal(r.w.act(['save', '--path', 'archives/race/report.md', '--message', 'report']).code, 0);
  // B's next run: B never held x or A's a v2, and still holds c, which A removed: it changes none of them.
  toB();
  const b = r.on('b', [], '2026-11-21T13:05:00Z');
  assert.deepEqual([b.code, b.result.handoff, b.result.removed, b.result.unlisted], [0, 'UNCHANGED', undefined, undefined], JSON.stringify(b.result));
  assert.ok(r.row('memory/x.md') && r.has('memory/x.md'));
  assert.equal(r.row('memory/a.md').sha256, sha('a v2 (computer A)\n'));
  // A's own next run and check: nothing diverged.
  toA();
  const again = r.on('a', [], '2026-11-21T13:20:00Z');
  assert.deepEqual([again.result.handoff, again.result.diverged], ['UNCHANGED', undefined], JSON.stringify(again.result));
});
