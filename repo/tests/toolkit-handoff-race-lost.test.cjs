'use strict';

// Mirror closure matrix, race row 3: computer B saves before the first push of both of computer A's
// passes, so A's run ends with the store's snapshot (took_store) and its own edit not landed. A's
// folder record is written from the manifest that landed, so it still holds the stored row, and A's
// next run writes the edit instead of calling it diverged.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { FOLDER, raceWorld } = require('./support/toolkit-handoff-race-world.cjs');

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

test('a run that loses the race on every pass keeps the store\'s snapshot, and its folder record holds what landed', t => {
  const r = raceWorld(t, { bHolds: false });
  r.put('a.md', 'a v2 (computer A)\n', '2026-11-21T12:50:00Z');
  let turn = 0;
  const bTurn = () => {
    turn += 1;
    r.asB(() => { r.put('a.md', 'a v1\n', '2026-11-21T09:00:00Z'); r.put('d.md', `d v${turn} (computer B)\n`, `2026-11-21T12:3${turn}:00Z`); },
      () => { r.drop('d.md'); r.put('a.md', 'a v2 (computer A)\n', '2026-11-21T12:50:00Z'); }, `2026-11-21T13:0${turn}:30Z`)();
  };
  // Before each pass's first push; each retry after the race merge goes out.
  r.w.hooks.racePushes = [bTurn, () => {}, bTurn, () => {}];
  const a = r.on('a', [], '2026-11-21T13:00:00Z');
  const turns = turn;
  const landed = r.row('memory/a.md').sha256;
  const parked = r.w.remoteHas('evidence/store-conflicts');
  // A's next run, with no race: its record held what landed (a v1), so it writes its edit.
  const again = r.on('a', [], '2026-11-21T13:20:00Z');
  assert.deepEqual([again.code, again.result.handoff, again.result.diverged], [0, 'SAVED', undefined], JSON.stringify(again.result));
  assert.equal(r.row('memory/a.md').sha256, sha('a v2 (computer A)\n'));
  // The racing run itself: SAVED with the store's snapshot, its own edit not landed, nothing parked.
  assert.deepEqual([a.code, a.result.handoff, a.result.took_store, turns], [0, 'SAVED', [FOLDER], 2], JSON.stringify(a.result));
  assert.equal(landed, sha('a v1\n'), 'A\'s edit never landed in the racing run');
  assert.equal(parked, false);
});
