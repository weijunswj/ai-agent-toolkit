'use strict';

// The sweep lease (I8 and closure rows R6 and R7): one sweep writes at a time across hosts, a run
// killed before its release is reported by the next pass, a computer's own note wins for the same
// pass, and three passes in a row on a busy state branch raise a finding.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { SweepLease, TTL_MS } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep-lease.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = '2026-11-12T01:00:00.000Z';
const controller = { session: 'fixture-controller', prefix: 'TEST-' };

function fixture(t) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n' });
  const outcomes = [500, 501].map((issue, i) => ({ issue, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => NOW });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 421, outcomes }), controller), { sha: null, previous: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-lease-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = Date.parse(NOW);
  const run = (extra = {}) => {
    let output = '';
    const code = cli.main(['refresh', '--json'], { transport: github, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
      toolkitVersion: '3.66.0', now: () => new Date(clock).toISOString(), passClock: () => clock, lockFile: path.join(dir, 'pass.lock'), environment: {},
      stdout: { write: text => { output += text; } }, ...extra });
    return { code, report: JSON.parse(output) };
  };
  const lease = (host, nowMs = () => clock) => new SweepLease({ store, repository: github.repository, host, nowMs });
  const record = () => store.read('parent', 421) && github.readFile('state/sweep-lease.json');
  const stop = () => store.read('parent', 421).doc.attention?.find(entry => entry.code === 'PASS_STOPPED');
  return { github, store, binding, dir, run, lease, record, stop, advance: ms => { clock += ms; } };
}

for (const host of ['computer', 'cloud']) test(`lease: while the ${host} holds it, the other sweep writes nothing`, t => {
  const f = fixture(t);
  const held = f.lease(host);
  assert.equal(held.acquire(), true);
  const other = f.lease(host === 'computer' ? 'cloud' : 'computer');
  assert.equal(other.acquire(), false);
  const commits = f.github.commits;
  const queued = f.run();
  assert.equal(queued.code, 0);
  assert.deepEqual(queued.report, { outcome: 'QUEUED', reason: 'another sweep is running' });
  assert.equal(f.github.commits, commits, 'another sweep is running: nothing written');
  held.release({ complete: false });
  assert.equal(other.acquire(), true);
});

test('lease: a holder past its lease stops before its next request', t => {
  const f = fixture(t);
  const held = f.lease('cloud');
  held.acquire();
  held.check();
  f.advance(TTL_MS);
  assert.throws(() => held.check(), { code: 'PASS_LOCK_LOST' });
  // An expired owner can neither renew nor release over a successor.
  const successor = f.lease('computer');
  assert.equal(successor.acquire(), true);
  assert.equal(held.release({ complete: true }), false);
  assert.equal(f.record().holder.nonce, successor.nonce);
});

test('lease: expired lease reports the interrupted pass', t => {
  const f = fixture(t);
  // A cloud run took the lease and saved its progress at the state boundary, then was killed.
  const killed = f.lease('cloud');
  killed.acquire();
  const started = killed.record.holder.progress.started_at;
  killed.progress({ phase: 'state', done: 2, total: 5, started_at: started }, null);
  f.advance(TTL_MS + 1000);
  assert.equal(f.run().code, 0);
  assert.deepEqual(f.stop().diagnostics, { cause: 'interrupted', phase: 'state', done: 2, total: 5, started_at: started });
  assert.equal(f.record().unreported, null, 'reported, so the lease no longer carries it');
  assert.equal(f.record().holder, null);
});

test('lease: local note wins for the same start', t => {
  const f = fixture(t);
  const killed = f.lease('computer');
  killed.acquire();
  const started = killed.record.holder.progress.started_at;
  killed.progress({ phase: 'planning', done: 0, total: 0, started_at: started }, null);
  // The computer's own note for the same pass is more precise.
  fs.writeFileSync(path.join(f.dir, 'pass.lock.progress'), JSON.stringify({ token: 'dead', started_at: started, phase: 'task_pages', done: 7, total: 30, unreported: true }));
  f.advance(TTL_MS + 1000);
  assert.equal(f.run({ pidAlive: () => false }).code, 0);
  assert.deepEqual(f.stop().diagnostics, { cause: 'interrupted', phase: 'task_pages', done: 7, total: 30, started_at: started });
  assert.equal(f.record().unreported, null);
  assert.equal(fs.existsSync(path.join(f.dir, 'pass.lock.progress')), false);
});

test('lease: the state boundary progress rides the state commit', t => {
  const f = fixture(t);
  f.run();
  const commits = f.github.commits;
  // Closing the task changes its state, so the pass has a state commit to carry the progress.
  Object.assign(f.github.issues.get(500), { state: 'closed', state_reason: 'completed', closed_at: f.github.tick(), updated_at: f.github.tick() });
  const trees = [];
  f.github.intercept(call => { if (call.method === 'POST' && call.path.endsWith('/git/trees')) trees.push(call.body.tree.map(entry => entry.path)); });
  f.advance(60 * 60 * 1000);
  assert.equal(f.run().code, 0);
  assert.ok(trees.some(paths => paths.includes('state/sweep-lease.json') && paths.some(file => /parent-421|issue-50/.test(file))), 'progress saved in the same commit');
  assert.ok(f.github.commits - commits >= 3, 'acquire, the state commit with progress, release');
});

test('batch: STATE_BRANCH_BUSY after three', t => {
  const f = fixture(t);
  f.run();
  Object.assign(f.github.issues.get(500), { state: 'closed', state_reason: 'completed', closed_at: f.github.tick(), updated_at: f.github.tick() });
  const busy = () => {
    f.github.hooks = [];
    f.github.intercept(call => (call.method === 'PATCH' && call.path.includes('/git/refs/heads/') ? { status: 422, json: { message: 'Reference moved' } } : undefined));
    f.advance(60 * 60 * 1000);
    return f.run();
  };
  for (let pass = 1; pass <= 3; pass += 1) {
    const result = busy();
    assert.equal(result.code, 1);
    assert.ok(result.report.holds.some(hold => hold.code === 'PASS_STOPPED' && /state branch was busy/.test(hold.detail)));
    assert.equal(f.record().streaks.busy, pass);
    assert.equal(f.record().unreported.phase, 'state', 'the stop the state could not hold waits in the lease');
  }
  f.github.hooks = [];
  f.advance(60 * 60 * 1000);
  assert.equal(f.run().code, 0);
  const attention = f.store.read('parent', 421).doc.attention;
  assert.equal(attention.find(entry => entry.code === 'STATE_BRANCH_BUSY')?.state, 'new');
  assert.equal(f.stop().diagnostics.phase, 'state', 'the last busy stop is reported once the state can hold it');
  assert.equal(f.record().streaks.busy, 0);
});

test('lease: a long pass renews its lease; a killed one frees it within twenty minutes', t => {
  const f = fixture(t);
  const held = f.lease('cloud');
  held.acquire();
  f.advance(9 * 60 * 1000);
  assert.equal(held.dueForRenewal(), false);
  f.advance(2 * 60 * 1000);
  assert.equal(held.dueForRenewal(), true);
  held.renew();
  f.advance(15 * 60 * 1000);
  held.check();
  assert.equal(f.lease('computer').acquire(), false, 'still held after 26 minutes of work');
  // The holder dies here: it renews no more, and the lease is free once it expires.
  f.advance(TTL_MS);
  assert.equal(f.lease('computer').acquire(), true);
});
