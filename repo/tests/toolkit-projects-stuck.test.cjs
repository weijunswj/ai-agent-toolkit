'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { classify, report } = require('../scripts/toolkit-projects-stuck.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-projects-stuck.cjs');
const NOW = Date.parse('2026-11-15T12:00:00Z');
const ago = minutes => new Date(NOW - minutes * 60000).toISOString();
const PAGE = [{ threads: 3, next_cursor: null }];

// A recorded thread as the hourly nudge writes it; each sample changes only what it tests.
function thread(id, extra = {}) {
  return { id, title: `Lane ${id}`, state: 'blocked', last_activity_at: ago(10), owes_work: true, waiting_on: null, ...extra };
}

function run(threads, { pages = PAGE, previous = null, ledger = [] } = {}) {
  return classify({ now: new Date(NOW).toISOString(), pages, previous, threads }, ledger);
}

function kinds(result) {
  return Object.fromEntries(result.results.map(item => [item.thread.id, item.kind]));
}

test('S1: failed and stopped threads get a continue message first, busy and waiting ones nothing', () => {
  const result = run([
    thread('stopped', { state: 'stopped', last_activity_at: ago(5) }),
    thread('failed', { state: 'failed' }),
    thread('finished', { state: 'stopped', owes_work: false }),
    thread('ci', { last_activity_at: ago(300), waiting_on: 'ci' }),
    thread('long-quiet', { state: 'working', last_activity_at: ago(170) }),
    thread('long-run', { state: 'working', last_activity_at: ago(200) }),
    thread('gate-output', { state: 'stopped', last_activity_at: ago(400), fresh_output_at: ago(30) })
  ]);
  assert.deepEqual(kinds(result), {
    stopped: 'STALLED', failed: 'STALLED', finished: 'OK', ci: 'WAITING',
    'long-quiet': 'BUSY', 'long-run': 'OWNER', 'gate-output': 'BUSY'
  });
  // A run past twice its expected time goes to the owner, never to a successor.
  assert.match(result.results.find(item => item.thread.id === 'long-run').reason, /long run, working but quiet 200 min/);
  assert.match(result.results[0].reason, /stopped while it owes work, send a continue message/);
  assert.deepEqual(result.prefixes, ['STUCK FOR OWNER: 1 | ']);
  // A lane's own expected time moves the long-run line.
  assert.equal(kinds(run([thread('slow', { state: 'working', last_activity_at: ago(200), expected_minutes: 120 })])).slow, 'BUSY');
});

test('a usage-limit cut-off continues on one message; a successor only when it stays quiet', () => {
  // Run 1: failed (as a usage-limit or API-error cut-off leaves it): a continue message, no successor.
  const cut = run([thread('cut', { state: 'failed', last_activity_at: ago(40) })]);
  assert.equal(kinds(cut).cut, 'STALLED');
  // Run 2: still failed, and nothing of its own since run 1: now it gets a successor.
  const quiet = run([thread('cut', { state: 'failed', last_activity_at: ago(100) })], { previous: { run_at: ago(60), stalled: ['cut'] } });
  assert.equal(kinds(quiet).cut, 'STUCK');
  assert.match(quiet.results[0].reason, /failed, no answer to the last run's continue message/);
  // It resumed after the message: working again, or idle and recently active, never stuck.
  const resumed = { previous: { run_at: ago(60), stalled: ['cut'] } };
  assert.equal(kinds(run([thread('cut', { state: 'working', last_activity_at: ago(5) })], resumed)).cut, 'BUSY');
  assert.equal(kinds(run([thread('cut', { state: 'blocked', last_activity_at: ago(20) })], resumed)).cut, 'OK');
  // The continue message itself moves last_activity_at; only the thread's own activity counts as an answer.
  const pingOnly = run([thread('cut', { state: 'failed', last_activity_at: ago(55), last_own_activity_at: ago(100) })], resumed);
  assert.equal(kinds(pingOnly).cut, 'STUCK');
  const answeredPing = run([thread('idle', { last_activity_at: ago(55), last_own_activity_at: ago(50) })], { previous: { run_at: ago(60), stalled: ['idle'] } });
  assert.equal(kinds(answeredPing).idle, 'STALLED');
});

test('L1: a recorded wait comes before every dead check, so an open owner card is never superseded', () => {
  const parked = { status: 'active', connected: false, served: false, last_activity_at: ago(30), device_reachable: true };
  const result = run([
    thread('card-parked', { waiting_on: 'owner merge card', rc: parked }),
    thread('review-ended', { waiting_on: 'review queue', rc: { ...parked, status: 'ended' } }),
    thread('card-failed', { state: 'failed', waiting_on: 'owner decision card' })
  ], { previous: { run_at: ago(60), stalled: ['card-failed'] } });
  assert.deepEqual(kinds(result), { 'card-parked': 'WAITING', 'review-ended': 'WAITING', 'card-failed': 'WAITING' });
});

test('N2: an idle thread owing work gets one ping, and gets a successor only after ignoring it', () => {
  const first = run([thread('idle', { last_activity_at: ago(50) }), thread('fresh', { last_activity_at: ago(20) })]);
  assert.deepEqual(kinds(first), { idle: 'STALLED', fresh: 'OK' });
  assert.equal(first.prefixes.length, 0);
  assert.equal(first.act, true);
  // Next run: still quiet since the run that listed it, so the ping went unanswered.
  const ignored = run([thread('idle', { last_activity_at: ago(110) })], { previous: { run_at: ago(60), stalled: ['idle'] } });
  assert.equal(kinds(ignored).idle, 'STUCK');
  assert.match(ignored.results[0].reason, /missed the last run's ping, quiet 110 min/);
  // It answered after that run: stalled again at most, never stuck.
  const answered = run([thread('idle', { last_activity_at: ago(50) })], { previous: { run_at: ago(60), stalled: ['idle'] } });
  assert.equal(kinds(answered).idle, 'STALLED');
  // A blocked thread waiting on the owner's answer is never stale.
  assert.equal(kinds(run([thread('prompt', { last_activity_at: ago(300), waiting_on: 'owner approval card' })])).prompt, 'WAITING');
});

test('N1: the scan follows next_cursor past empty pages, and a cut-off scan says so', () => {
  const pages = [{ threads: 0, next_cursor: 'a' }, { threads: 1, next_cursor: 'b' }, { threads: 1, next_cursor: null }];
  const full = run([thread('page-three', { last_activity_at: ago(60) })], { pages });
  assert.equal(full.incomplete, null);
  assert.equal(kinds(full)['page-three'], 'STALLED');
  assert.match(report(full), /^PREFIXES: none\nSTUCK CHECK: pages 3, threads 1 \| /);
  const cut = run([], { pages: pages.slice(0, 2) });
  assert.deepEqual(cut.prefixes, ['THREAD SCAN INCOMPLETE: pages 2, the last page still has a next_cursor | ']);
  assert.equal(cut.act, true);
  // A page without a cursor before the last one is a broken recording, not a scan.
  assert.throws(() => run([], { pages: [{ threads: 1, next_cursor: null }, { threads: 1, next_cursor: null }] }), /pages after the last page/);
});

test('Remote Control: lost contact gives exactly one successor, an offline device none', () => {
  const rc = (extra = {}) => ({ status: 'active', connected: false, served: false, last_activity_at: ago(12), device_reachable: true, ...extra });
  const result = run([
    thread('lost', { rc: rc() }),
    thread('blip', { rc: rc({ last_activity_at: ago(5) }) }),
    thread('offline', { rc: rc({ device_reachable: false }) }),
    thread('ended', { rc: rc({ status: 'ended' }) }),
    thread('card', { rc: rc({ status: 'waiting_for_approval' }) }),
    thread('done-lane', { owes_work: false, rc: rc() }),
    thread('healthy', { rc: rc({ connected: true, served: true }) })
  ]);
  assert.deepEqual(kinds(result), {
    lost: 'STUCK', blip: 'OK', offline: 'OFFLINE', ended: 'STUCK', card: 'OWNER', 'done-lane': 'OK', healthy: 'OK'
  });
  assert.match(result.results[0].reason, /Remote Control not connected or served, session quiet 12 min/);
  // After the coordinator starts the successor, the old lane is superseded and the new one is not stuck.
  const ledger = [{ lane: 'lost', old: 'lost', new: 'lost-2', at: ago(2) }];
  const after = run([thread('lost', { rc: rc({ last_activity_at: ago(14) }) }), thread('lost-2', { state: 'working' })], { ledger });
  assert.deepEqual(kinds(after), { lost: 'SUPERSEDED', 'lost-2': 'BUSY' });
  assert.equal(after.results.filter(item => item.kind === 'STUCK').length, 0);
});

test('S3: a second stall within 2 hours goes to the owner, not a third thread', () => {
  const ledger = [{ lane: 'lane', old: 'lane', new: 'lane-2', at: ago(90) }];
  const pinged = { run_at: ago(60), stalled: ['lane-2'] };
  const second = run([thread('lane-2', { state: 'stopped', last_activity_at: ago(70) })], { ledger, previous: pinged });
  assert.equal(kinds(second)['lane-2'], 'OWNER');
  assert.match(second.results[0].reason, /stopped, no answer to the last run's continue message; second stall within 2 hours of successor lane-2/);
  assert.match(report(second), /^PREFIXES: STUCK FOR OWNER: 1 \| \n/);
  assert.match(report(second), /\nOWNER lane-2 \| Lane lane-2 \| lane lane \| /);
  // Past the window, the lane may get its next successor.
  const later = run([thread('lane-2', { state: 'stopped', last_activity_at: ago(70) })], { ledger: [{ ...ledger[0], at: ago(130) }], previous: pinged });
  assert.equal(kinds(later)['lane-2'], 'STUCK');
});

test('the report keeps each thread on one line and the command exits by what needs action', (t) => {
  const odd = run([thread('odd', { state: 'failed', title: 'Fix | it\nnow' })]);
  assert.match(report(odd), /\nSTALLED odd \| Fix it now \| failed while it owes work, send a continue message\n$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true });
  const input = threads => write('input.json', { now: new Date(NOW).toISOString(), pages: PAGE, threads });
  const quiet = cli('--input', input([thread('ok')]), '--ledger', path.join(dir, 'no-ledger-yet.json'));
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /^PREFIXES: none\n/);
  const due = cli('--input', input([thread('dead', { rc: { status: 'ended', connected: false, served: false, last_activity_at: ago(30), device_reachable: true } })]), '--ledger', write('ledger.json', []));
  assert.equal(due.status, 1, due.stderr);
  assert.match(due.stdout, /^PREFIXES: STUCK THREADS: 1 \| \n/);
  for (const args of [[], ['--input'], ['--ledger', 'x'], ['--input', write('bad.json', '{')], ['--input', input([{ id: 'x' }])], ['--input', 'a', '--input', 'b']]) {
    const bad = cli(...args);
    assert.equal(bad.status, 2, JSON.stringify(args));
    assert.match(bad.stderr, /Stuck-thread input could not be read/);
  }
});
