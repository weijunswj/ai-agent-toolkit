'use strict';

// The sweep lease (I8 and closure rows R6 and R7): one sweep writes at a time across hosts, a run
// killed before its release is reported by the next pass, a computer's own note wins for the same
// pass, and three passes in a row on a busy state branch raise a finding. The lease and the one state
// commit as one model (rows L1 to L19): the lease owns every write of its file, the state commit
// carries its renewal, and every early end records its stop in one place the next pass reads.
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
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LEASE_FILE = 'state/sweep-lease.json';
const controller = { session: 'fixture-controller', prefix: 'TEST-' };
const SCHEDULED = ['refresh', '--scheduled', '--json'];
const CLOUD = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', SWEEP_LOGIN: 'example-bot' };

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
  // `cloud` runs as the GitHub runner: no local lock or note survives the run.
  const run = ({ argv = ['refresh', '--json'], cloud = false, ...extra } = {}) => {
    let output = '';
    let code = null;
    let error = null;
    try {
      code = cli.main(argv, { transport: github, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
        toolkitVersion: '3.66.0', now: () => new Date(clock).toISOString(), passClock: () => clock, lockFile: cloud ? null : path.join(dir, 'pass.lock'),
        environment: cloud ? CLOUD : {}, stdout: { write: text => { output += text; } }, ...extra });
    } catch (thrown) { error = thrown; }
    let report = null;
    try { report = output ? JSON.parse(output) : null; } catch { report = null; }
    return { code, error, report, output };
  };
  const lease = (host, { endsBy = clock + 55 * MINUTE } = {}) => new SweepLease({ store, repository: github.repository, host, nowMs: () => clock, endsBy });
  const record = () => github.readFile(LEASE_FILE);
  const stops = () => (store.read('parent', 421).doc.attention || []).filter(entry => entry.code === 'PASS_STOPPED');
  const stop = () => stops()[0];
  const note = path.join(dir, 'pass.lock.progress');
  const close = issue => Object.assign(github.issues.get(issue), { state: 'closed', state_reason: 'completed', closed_at: github.tick(), updated_at: github.tick() });
  const lifecycle = issue => store.read('child', issue).doc?.lifecycle;
  const leaseWrites = (message, from = 0) => github.calls.slice(from).filter(call => call.method === 'PUT' && call.path.endsWith('/sweep-lease.json') && (!message || call.body?.message === message));
  return { github, store, binding, dir, run, lease, record, stops, stop, note, close, lifecycle, leaseWrites, now: () => clock, advance: ms => { clock += ms; } };
}

// The state commit window as GitHub sees it: from the batch snapshot to the end of the commit (its
// read-back included). `onSnapshot` runs right after the batch snapshot is read.
function watchWindow(t, f, onSnapshot = () => {}) {
  const window = { start: null, end: null, trees: [] };
  const { currentSnapshot, commitBatch } = state.StateStore.prototype;
  state.StateStore.prototype.currentSnapshot = function patched(...args) {
    if (window.start === null) window.start = f.github.calls.length;
    const snapshot = currentSnapshot.apply(this, args);
    if (window.end === null) onSnapshot();
    return snapshot;
  };
  state.StateStore.prototype.commitBatch = function patched(...args) {
    try { return commitBatch.apply(this, args); } finally { if (window.end === null) window.end = f.github.calls.length; }
  };
  t.after(() => Object.assign(state.StateStore.prototype, { currentSnapshot, commitBatch }));
  f.github.intercept(call => { if (call.method === 'POST' && call.path.endsWith('/git/trees')) window.trees.push(call.body.tree); });
  window.inside = () => f.github.calls.slice(window.start, window.end).filter(call => call.method === 'PUT' && call.path.endsWith('/sweep-lease.json')).map(call => call.body.message);
  window.leaseEntry = () => {
    const entry = window.trees.at(-1)?.find(item => item.path === LEASE_FILE);
    return entry ? JSON.parse(entry.content) : null;
  };
  return window;
}

// A second pass with a state change to commit, one hour after a clean first pass.
function secondPass(f) {
  assert.equal(f.run().code, 0);
  f.close(500);
  f.advance(HOUR);
}

for (const host of ['computer', 'cloud']) test(`lease: while the ${host} holds it, the other sweep writes nothing`, t => {
  const f = fixture(t);
  const held = f.lease(host);
  assert.equal(held.acquire(NOW), true);
  const other = f.lease(host === 'computer' ? 'cloud' : 'computer');
  assert.equal(other.acquire(NOW), false);
  const commits = f.github.commits;
  const queued = f.run();
  assert.equal(queued.code, 0);
  // It names the live holder, so a caller can tell a running sweep from a stuck one.
  assert.equal(queued.report.outcome, 'QUEUED');
  assert.equal(queued.report.reason, 'another sweep is running');
  assert.deepEqual(Object.keys(queued.report.holder).sort(), ['expires_at', 'host', 'started_at']);
  assert.equal(queued.report.holder.host, host);
  assert.equal(queued.report.holder.started_at, NOW);
  assert.ok(Date.parse(queued.report.holder.expires_at) > Date.parse(NOW));
  const text = f.run({ argv: ['refresh'] });
  assert.match(text.output, new RegExp(`^Another sweep is running on ${host === 'cloud' ? 'the cloud runner' : 'a computer'}, started ${NOW}, lease until \\S+Z, so this one wrote nothing\\.`));
  assert.equal(f.github.commits, commits, 'another sweep is running: nothing written');
  // Row L18 (M1): a pass that defers did no work, so it leaves no note and the next pass reports no stop.
  assert.equal(fs.existsSync(f.note), false, 'the deferred pass left no progress note');
  held.release({ complete: true, completeAt: new Date(f.now()).toISOString() });
  f.advance(HOUR);
  assert.equal(f.run().code, 0);
  assert.equal(f.stop(), undefined, 'no PASS_STOPPED for a pass that deferred on purpose');
  assert.equal(fs.existsSync(f.note), false);
  assert.equal(other.acquire(NOW), true);
});

test('lease: a deferred pass keeps an earlier killed pass\'s note, and the next pass reports it', t => {
  const f = fixture(t);
  const started = '2026-11-12T00:30:00.000Z';
  const left = { token: 'dead', started_at: started, phase: 'task_pages', done: 3, total: 9, unreported: true };
  fs.writeFileSync(f.note, `${JSON.stringify(left)}\n`);
  const cloud = f.lease('cloud');
  assert.equal(cloud.acquire(NOW), true);
  assert.equal(f.run({ pidAlive: () => false }).report.outcome, 'QUEUED');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.note, 'utf8')), left, 'the QUEUED pass left the note untouched');
  cloud.release({ complete: true, completeAt: new Date(f.now()).toISOString() });
  f.advance(HOUR);
  assert.equal(f.run({ pidAlive: () => false }).code, 0);
  assert.deepEqual(f.stop().diagnostics, { cause: 'interrupted', phase: 'task_pages', done: 3, total: 9, started_at: started });
  assert.equal(fs.existsSync(f.note), false, 'reported, so the note is gone');
});

test('lease: a holder past its lease stops before its next request', t => {
  const f = fixture(t);
  const held = f.lease('cloud');
  held.acquire(NOW);
  held.check();
  f.advance(TTL_MS);
  assert.throws(() => held.check(), { code: 'PASS_LOCK_LOST' });
  // An expired owner can neither renew nor release over a successor.
  const successor = f.lease('computer');
  assert.equal(successor.acquire(new Date(f.now()).toISOString()), true);
  assert.throws(() => held.renew(), { code: 'PASS_LOCK_LOST' });
  assert.equal(held.release({ complete: true }), false);
  assert.equal(f.record().holder.nonce, successor.nonce);
});

test('lease: expired lease reports the interrupted pass', t => {
  const f = fixture(t);
  // A cloud run took the lease and saved its progress at the state boundary, then was killed.
  const killed = f.lease('cloud');
  killed.acquire(NOW);
  const started = killed.record.holder.progress.started_at;
  killed.saveProgress({ phase: 'state', done: 2, total: 5, started_at: started });
  f.advance(TTL_MS + 1000);
  assert.equal(f.run().code, 0);
  assert.deepEqual(f.stop().diagnostics, { cause: 'interrupted', phase: 'state', done: 2, total: 5, started_at: started });
  assert.equal(f.record().unreported, null, 'reported, so the lease no longer carries it');
  assert.equal(f.record().holder, null);
});

test('lease: local note wins for the same start', t => {
  const f = fixture(t);
  const killed = f.lease('computer');
  killed.acquire(NOW);
  const started = killed.record.holder.progress.started_at;
  killed.saveProgress({ phase: 'planning', done: 0, total: 0, started_at: started });
  // The computer's own note for the same pass is more precise.
  fs.writeFileSync(f.note, JSON.stringify({ token: 'dead', started_at: started, phase: 'task_pages', done: 7, total: 30, unreported: true }));
  f.advance(TTL_MS + 1000);
  assert.equal(f.run({ pidAlive: () => false }).code, 0);
  assert.deepEqual(f.stop().diagnostics, { cause: 'interrupted', phase: 'task_pages', done: 7, total: 30, started_at: started });
  assert.equal(f.record().unreported, null);
  assert.equal(fs.existsSync(f.note), false);
});

test('lease: the lease start is the pass start', t => {
  // Row L19: the clock moves between the pass start and the lease, as GitHub's replies take time.
  const f = fixture(t);
  secondPass(f);
  let killed = false;
  let start = null;
  f.github.intercept(call => {
    if (start === null) start = f.now();
    f.advance(1000);
    if (killed) throw new Error('killed');
    if (call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) killed = true;
    return undefined;
  });
  const result = f.run();
  assert.equal(result.error?.message, 'killed', 'killed after its state commit');
  f.github.hooks = [];
  const note = JSON.parse(fs.readFileSync(f.note, 'utf8'));
  const leased = f.record().holder.progress;
  assert.ok(Date.parse(leased.started_at) <= start, 'the lease records the pass start, before the first request');
  assert.equal(note.started_at, leased.started_at, 'the note and the lease carry the same start');
  f.advance(TTL_MS + 1000);
  assert.equal(f.run({ pidAlive: () => false }).code, 0);
  assert.equal(f.stops().length, 1, 'one stop, reported once');
  assert.equal(f.stop().diagnostics.started_at, leased.started_at);
  assert.equal(f.record().unreported, null);
  assert.equal(fs.existsSync(f.note), false);
});

test('lease: the state boundary progress rides the state commit', t => {
  const f = fixture(t);
  secondPass(f);
  const window = watchWindow(t, f);
  const commits = f.github.commits;
  assert.equal(f.run().code, 0);
  const entry = window.leaseEntry();
  assert.ok(entry && window.trees.at(-1).some(item => /parent-421|issue-50/.test(item.path)), 'progress saved in the same commit');
  assert.equal(entry.holder.progress.phase, 'state');
  assert.equal(entry.holder.expires_at, new Date(f.now() + Math.min(TTL_MS, state.PASS_BUDGETS['after-write'].killMs)).toISOString(), 'the entry also renews the expiry, capped at the kill time');
  assert.ok(f.github.commits - commits >= 3, 'acquire, the state commit with progress, release');
});

test('lease: a long pass renews its lease; a killed one frees it by its kill time or twenty minutes, whichever is sooner', t => {
  // Row L1, with the expiry capped at the pass's kill time (row L16).
  const f = fixture(t);
  const held = f.lease('cloud', { endsBy: f.now() + 55 * MINUTE });
  held.acquire(NOW);
  f.advance(9 * MINUTE);
  assert.equal(held.dueForRenewal(), false);
  f.advance(2 * MINUTE);
  assert.equal(held.dueForRenewal(), true);
  held.renew();
  f.advance(15 * MINUTE);
  held.check();
  assert.equal(f.lease('computer').acquire(NOW), false, 'still held after 26 minutes of work');
  held.renew();
  assert.equal(f.record().holder.expires_at, new Date(Date.parse(NOW) + 46 * MINUTE).toISOString());
  f.advance(14 * MINUTE);
  held.renew();
  assert.equal(f.record().holder.expires_at, new Date(Date.parse(NOW) + 55 * MINUTE).toISOString(), 'capped at the kill time');
  f.advance(6 * MINUTE);
  assert.equal(held.dueForRenewal(), false, 'a renewal at the cap would not move the expiry, so it is not due');
  // The holder dies here: it renews no more, and the lease is free at its kill time.
  f.advance(9 * MINUTE);
  assert.equal(f.lease('computer').acquire(NOW), true);
});

test('lease: a killed pass\'s lease ends by its kill time', t => {
  // Row L16: a refresh after a write is killed fifteen minutes in, before the twenty-minute TTL.
  const f = fixture(t);
  const held = f.lease('computer', { endsBy: f.now() + 15 * MINUTE });
  held.acquire(NOW);
  assert.equal(f.record().holder.expires_at, new Date(Date.parse(NOW) + 15 * MINUTE).toISOString());
  f.advance(6 * MINUTE);
  assert.equal(held.dueForRenewal(), false, 'nothing to renew past the kill time');
  f.advance(9 * MINUTE);
  assert.equal(f.lease('cloud').acquire(new Date(f.now()).toISOString()), true, 'the next pass takes it at the kill time');
  assert.equal(f.record().unreported.cause, 'interrupted');
  assert.throws(() => new SweepLease({ store: f.store, repository: f.github.repository, host: 'cloud' }), TypeError, 'the kill time is a required input');
});

test('lease: the batch opens with a renewal when less than ten minutes are left', t => {
  // Rows L2 and L6: the window opens with a fresh expiry, and nothing renews while it is open or
  // while a lease write is in flight.
  const f = fixture(t);
  const held = f.lease('cloud');
  held.acquire(NOW);
  f.advance(11 * MINUTE);
  const before = f.leaseWrites('programme sweep: keep the lease').length;
  held.openBatch(f.store);
  assert.equal(f.leaseWrites('programme sweep: keep the lease').length, before + 1, 'renewed as the window opened');
  assert.equal(f.record().holder.expires_at, new Date(f.now() + TTL_MS).toISOString());
  f.advance(11 * MINUTE);
  assert.equal(held.dueForRenewal(), false, 'no separate renewal while the state commit is open');
  held.closeBatch();
  assert.equal(held.dueForRenewal(), true);
  assert.equal(held.writing(() => held.dueForRenewal()), false, 'no renewal inside another lease write');
});

test('lease: a renewal due during staging rides the state commit', t => {
  // Row L3: the renewal comes due right after the batch snapshot.
  const f = fixture(t);
  secondPass(f);
  const window = watchWindow(t, f, () => f.advance(11 * MINUTE));
  const result = f.run({ argv: SCHEDULED });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.code, 0);
  assert.deepEqual(window.inside(), [], 'no separate lease write inside the commit window');
  assert.equal(window.leaseEntry().holder.expires_at, new Date(f.now() + TTL_MS).toISOString(), 'the commit carries the renewal');
  assert.equal(f.lifecycle(500), 'DONE');
  assert.equal(f.record().holder, null);
  assert.equal(f.record().stopped_passes, 0);
});

test('lease: a renewal due before the ref update rides the state commit', t => {
  // Row L4, the review's probe 2 as a test: eleven minutes pass at the state tree POST.
  const f = fixture(t);
  secondPass(f);
  const window = watchWindow(t, f);
  let jumped = false;
  let built = null;
  f.github.intercept(call => { if (!jumped && call.method === 'POST' && call.path.endsWith('/git/trees')) { jumped = true; built = f.now(); f.advance(11 * MINUTE); } });
  const from = f.github.calls.length;
  const result = f.run({ argv: SCHEDULED });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.code, 0);
  assert.deepEqual(window.inside(), [], 'no "keep the lease" write between the batch snapshot and the read-back');
  assert.equal(f.github.calls.slice(from).filter(call => call.method === 'PATCH' && call.path.includes('/git/refs/heads/')).length, 1, 'one ref update: the pass caused no race of its own');
  assert.equal(window.leaseEntry().holder.expires_at, new Date(built + TTL_MS).toISOString(), 'the committed entry carries the renewed expiry');
  assert.equal(f.lifecycle(500), 'DONE');
  assert.equal(f.record().holder, null);
  assert.equal(f.record().stopped_passes, 0);
});

test('lease: a renewal due during the read-back waits for the commit', t => {
  // Row L5: the ref moved, then the renewal came due; it goes out after the commit, on its version.
  const f = fixture(t);
  secondPass(f);
  const window = watchWindow(t, f);
  let jumped = false;
  f.github.intercept(call => { if (!jumped && call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) { jumped = true; f.advance(11 * MINUTE); } });
  const result = f.run({ argv: SCHEDULED });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.code, 0);
  assert.deepEqual(window.inside(), []);
  assert.ok(f.leaseWrites('programme sweep: keep the lease', window.end).length >= 1, 'renewed after the commit was confirmed');
  assert.equal(f.lifecycle(500), 'DONE');
  assert.equal(f.record().holder, null, 'released: the renewal was not read as a loss');
  assert.equal(f.record().stopped_passes, 0);
});

test('lease: a race from another writer rebuilds the lease entry and commits', t => {
  // Row L7: another state writer moves the store branch before the ref update.
  const f = fixture(t);
  secondPass(f);
  const window = watchWindow(t, f);
  let raced = false;
  f.github.intercept(call => {
    if (!raced && call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) { raced = true; f.github.putFile('state/journal-example.json', { note: 'another writer' }); }
  });
  const from = f.github.calls.length;
  const result = f.run();
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.code, 0);
  assert.equal(f.github.calls.slice(from).filter(call => call.method === 'PATCH' && call.path.includes('/git/refs/heads/')).length, 2, 'one race, one retry');
  assert.equal(window.trees.filter(tree => tree.some(item => item.path === LEASE_FILE)).length, 2, 'the lease entry was rebuilt for the retry');
  assert.equal(f.lifecycle(500), 'DONE');
  assert.equal(f.record().holder, null);
  assert.equal(f.record().stopped_passes, 0);
});

test('lease: a takeover during the batch still stops the pass', t => {
  // Row L8: another host takes the lease while the commit is open; nothing is committed.
  const f = fixture(t);
  secondPass(f);
  let taken = null;
  f.github.intercept(call => {
    if (!taken && call.method === 'POST' && call.path.endsWith('/git/trees')) {
      taken = { ...f.github.readFile(LEASE_FILE), holder: { nonce: 'f'.repeat(32), host: 'computer', expires_at: new Date(f.now() + TTL_MS).toISOString(),
        progress: { phase: 'planning', done: 0, total: 0, started_at: new Date(f.now()).toISOString() } } };
      f.github.putFile(LEASE_FILE, taken);
    }
  });
  const result = f.run();
  assert.equal(result.error?.code, 'PASS_LOCK_LOST');
  assert.notEqual(f.lifecycle(500), 'DONE', 'nothing committed');
  assert.deepEqual(f.record(), taken, 'the new holder\'s lease is not touched');
});

test('lease: an unsure commit re-reads the lease before the next write', t => {
  // Row L10: the commit carrying the lease entry landed, but its outcome was not confirmed.
  const f = fixture(t);
  const held = f.lease('cloud');
  held.acquire(NOW);
  held.openBatch(f.store);
  const entry = held.batchEntry(f.store.readSnapshot(), { cause: 'interrupted', phase: 'state', done: 1, total: 2, started_at: NOW });
  f.store.putVerified(held.file, 'sweep_record', entry.text, entry.sha, 'the state commit landed');
  held.closeBatch({ unsure: true });
  f.advance(11 * MINUTE);
  held.renew();
  assert.equal(f.record().holder.nonce, held.nonce, 'its own landed write was not read as a loss');
  assert.equal(f.record().holder.progress.phase, 'state');
  // When the record is another holder's, the next write stops the pass.
  held.openBatch(f.store);
  held.closeBatch({ unsure: true });
  f.github.putFile(LEASE_FILE, { ...f.record(), holder: { ...f.record().holder, nonce: 'e'.repeat(32) } });
  f.advance(11 * MINUTE);
  assert.throws(() => held.renew(), { code: 'PASS_LOCK_LOST' });
});

test('lease: a renewal that gets no reply ends the pass with its stop recorded', t => {
  // Row L11 on the cloud: the renewal after the commit gets a 502.
  const f = fixture(t);
  secondPass(f);
  let jumped = false;
  f.github.intercept(call => {
    if (!jumped && call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) { jumped = true; f.advance(11 * MINUTE); }
    if (call.method === 'PUT' && call.body?.message === 'programme sweep: keep the lease') return { status: 502, json: { message: 'Bad gateway' } };
    return undefined;
  });
  const result = f.run({ cloud: true, argv: SCHEDULED });
  assert.equal(result.error?.code, 'GH_FAILED', result.error?.message);
  f.github.hooks = [];
  assert.equal(f.record().holder, null, 'released after the failed renewal');
  assert.equal(f.record().unreported.cause, 'interrupted');
  assert.equal(f.record().reason, 'a GitHub request failed');
  f.advance(HOUR);
  assert.equal(f.run().code, 0);
  assert.equal(f.stops().length, 1);
  assert.equal(f.stop().diagnostics.cause, 'interrupted');
  assert.equal(f.lifecycle(500), 'DONE', 'the committed state is kept');
});

test('lease: a pass that lost its local lock records its stop in the lease', t => {
  // Row L12: another process on this computer took the lock, so this pass does not own the note.
  const f = fixture(t);
  secondPass(f);
  const lockFile = path.join(f.dir, 'pass.lock');
  let replaced = false;
  f.github.intercept(call => {
    if (!replaced && call.method === 'POST' && call.path.endsWith('/git/trees')) {
      replaced = true;
      fs.writeFileSync(lockFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(lockFile, 'utf8')), token: 'another-pass' }));
    }
  });
  const result = f.run();
  assert.equal(result.error?.code, 'PASS_LOCK_LOST');
  f.github.hooks = [];
  assert.equal(f.record().holder, null);
  assert.equal(f.record().unreported.cause, 'interrupted');
  assert.equal(f.record().reason, 'another pass took over');
  fs.rmSync(lockFile, { force: true });
  f.advance(HOUR);
  assert.equal(f.run({ pidAlive: () => false }).code, 0);
  assert.equal(f.stops().length, 1, 'the stop is reported once');
  assert.equal(f.record().unreported, null);
});

test('lease: a cloud pass that ends with an error records its stop in the lease', t => {
  // Row L13: the state commit's ref update gets no reply twice.
  const f = fixture(t);
  secondPass(f);
  f.github.intercept(call => (call.method === 'PATCH' && call.path.includes('/git/refs/heads/') ? { status: 502, json: { message: 'Bad gateway' } } : undefined));
  const result = f.run({ cloud: true });
  assert.equal(result.error?.code, 'GH_FAILED');
  f.github.hooks = [];
  const left = f.record();
  assert.equal(left.holder, null);
  assert.equal(left.unreported.cause, 'interrupted');
  assert.equal(left.unreported.phase, 'state');
  assert.equal(left.reason, 'a GitHub request failed');
  assert.equal(left.stopped_passes, 1);
  f.advance(HOUR);
  assert.equal(f.run({ cloud: true }).code, 0);
  assert.deepEqual(f.stop().diagnostics, left.unreported, 'the next pass reports it');
  assert.equal(f.record().unreported, null);
});

test('lease: on the computer an error stop is in the note only', t => {
  // Row L14: the local note records it, so the lease carries no second copy.
  const f = fixture(t);
  secondPass(f);
  f.github.intercept(call => (call.method === 'PATCH' && call.path.includes('/git/refs/heads/') ? { status: 502, json: { message: 'Bad gateway' } } : undefined));
  const result = f.run();
  assert.equal(result.error?.code, 'GH_FAILED');
  f.github.hooks = [];
  assert.equal(f.record().holder, null);
  assert.equal(f.record().unreported, null, 'no stop in the lease');
  assert.equal(JSON.parse(fs.readFileSync(f.note, 'utf8')).unreported, true, 'the note holds it');
  f.advance(HOUR);
  assert.equal(f.run({ pidAlive: () => false }).code, 0);
  assert.equal(f.stops().length, 1, 'exactly one record');
  assert.equal(fs.existsSync(f.note), false);
});

test('lease: a pass killed after its state commit is reported at phase state with the state kept', t => {
  // Row L17: the runner dies during the read-back; the commit carried the lease's progress.
  const f = fixture(t);
  secondPass(f);
  let killed = false;
  f.github.intercept(call => {
    if (killed) throw new Error('killed');
    if (call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) killed = true;
    return undefined;
  });
  assert.equal(f.run({ cloud: true }).error?.message, 'killed');
  f.github.hooks = [];
  assert.equal(f.record().holder.progress.phase, 'state', 'the commit carried phase state');
  f.advance(TTL_MS + 1000);
  assert.equal(f.run().code, 0);
  assert.equal(f.stop().diagnostics.phase, 'state');
  assert.equal(f.stop().diagnostics.cause, 'interrupted');
  assert.equal(f.lifecycle(500), 'DONE', 'the committed state is kept');
});

test('batch: STATE_BRANCH_BUSY after three', t => {
  const f = fixture(t);
  f.run();
  f.close(500);
  const busy = () => {
    f.github.hooks = [];
    f.github.intercept(call => (call.method === 'PATCH' && call.path.includes('/git/refs/heads/') ? { status: 422, json: { message: 'Reference moved' } } : undefined));
    f.advance(HOUR);
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
  f.advance(HOUR);
  assert.equal(f.run().code, 0);
  const attention = f.store.read('parent', 421).doc.attention;
  assert.equal(attention.find(entry => entry.code === 'STATE_BRANCH_BUSY')?.state, 'new');
  assert.equal(f.stop().diagnostics.phase, 'state', 'the last busy stop is reported once the state can hold it');
  assert.equal(f.record().streaks.busy, 0);
});
