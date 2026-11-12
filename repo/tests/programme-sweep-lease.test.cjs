'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { SweepGitHub } = require('./support/programme-sweep-github.cjs');
let Lease;
try { ({ SweepLease: Lease } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep-lease.cjs'))); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
for (const host of ['laptop first', 'cloud first', 'expired owner', 'renewed owner']) test(`overlap / I8: ${host}`, () => {
  assert.equal(typeof Lease, 'function');
  let clock = Date.UTC(2026, 10, 12);
  const github = new SweepGitHub();
  const store = new state.StateStore({ transport: github, store: { repository: github.storeRepository, branch: 'main', path: 'state/' }, now: () => new Date(clock).toISOString() });
  const a = new Lease({ store, repository: github.repository, nowMs: () => clock, nonce: 'a'.repeat(32) });
  const b = new Lease({ store, repository: github.repository, nowMs: () => clock, nonce: 'b'.repeat(32) });
  assert.equal(a.acquire(), true); assert.equal(b.acquire(), false);
  if (host === 'expired owner') {
    clock += 16 * 60 * 1000;
    assert.equal(b.acquire(), true); assert.throws(() => a.check(), { code: 'PASS_LOCK_LOST' });
    a.release(); assert.equal(store.readPath(a.file, 'sweep_lease').doc.nonce, 'b'.repeat(32));
  } else {
    if (host === 'renewed owner') { clock += 2 * 60 * 1000; a.check(); assert.equal(b.acquire(), false); }
    a.release(); assert.equal(b.acquire(), true);
  }
  b.release();
});
