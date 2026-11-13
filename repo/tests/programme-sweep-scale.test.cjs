'use strict';

// The sweep at scale: no fixed limit can stall a big board for good. The cloud pass runs to GitHub's
// own limit less a safety margin, saves its place and the next run resumes; the changed-issues list
// resumes from a cursor; PR discovery's budget grows with the board; the board shows a calm note
// when a pass stops early, and a warning only when the sweep is truly stuck.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const sweep = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep.cjs'));
const { SweepLease, STUCK_MS, STUCK_READS } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep-lease.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = '2026-11-12T01:00:00.000Z';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const controller = { session: 'fixture-controller', prefix: 'TEST-' };
const CLOUD = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', SWEEP_LOGIN: 'example-bot' };

// REST responses that carry GitHub's rate-limit headers: `left.core` falls by one per REST request.
function limited(github, left, limit = 5000) {
  let lowest = Infinity;
  const transport = {
    request(...input) {
      const response = github.request(...input);
      const resource = input[1] === 'graphql' ? 'graphql' : 'core';
      left[resource] -= 1;
      if (resource === 'core') lowest = Math.min(lowest, left.core);
      const out = Object.assign(Object.create(Object.getPrototypeOf(response)), response);
      Object.defineProperty(out, 'headers', { value: { ...(response.headers || {}), 'x-ratelimit-remaining': String(left[resource]),
        'x-ratelimit-limit': String(limit), 'x-ratelimit-resource': resource }, enumerable: false });
      return out;
    },
  };
  return { transport, lowest: () => lowest };
}

function fixture(t, { count = 40 } = {}) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  github.commentsMoveIssue = true;
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n' });
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  let clock = Date.parse(NOW);
  const now = () => new Date(clock).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: '3.68.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 421, outcomes }), controller), { sha: null, previous: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-scale-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = ({ cloud = false, transport = github, ...extra } = {}) => {
    clock += HOUR; github.clock += HOUR;
    let output = '';
    const code = cli.main(['refresh', '--scheduled', '--json'], { transport, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.', toolkitVersion: '3.68.0',
      now, passClock: () => clock, lockFile: cloud ? null : path.join(dir, 'pass.lock'), environment: cloud ? CLOUD : {}, stdout: { write: text => { output += text; } }, ...extra });
    return { code, report: JSON.parse(output.slice(output.lastIndexOf('\n{') + 1)) };
  };
  const stale = () => { for (const outcome of outcomes) Object.assign(github.issues.get(outcome.issue), { title: `Renamed ${outcome.issue}`, body: '', updated_at: github.tick() }); };
  const parent = () => store.read('parent', 421).doc;
  const page = () => github.issues.get(421).body;
  const boardLine = () => page().split('\n').find(line => /^(?:Board updated: |⚠️ )/.test(line));
  return { github, store, run, stale, parent, page, boardLine, outcomes, now: () => clock };
}

test('margin: a tenth of GitHub\'s reported limit, never under 200; the margin, not a cap, stops a cloud pass', () => {
  assert.equal(sweep.passCap({ host: 'cloud', scheduled: true }), Infinity);
  assert.equal(sweep.passCap({ host: 'computer', scheduled: true }), 600, 'the computer keeps its cap');
  for (const [limit, start] of [[5000, 5000], [5000, 900], [12500, 3000], [1000, 600]]) {
    const left = { core: start, graphql: 5000 };
    const transport = { request: (method, endpoint) => {
      const resource = endpoint === 'graphql' ? 'graphql' : 'core';
      left[resource] -= 1;
      return { status: 200, json: { data: {} }, headers: { 'x-ratelimit-remaining': String(left[resource]), 'x-ratelimit-limit': String(limit), 'x-ratelimit-resource': resource } };
    } };
    const requests = new sweep.SweepRequests({ transport, cap: sweep.passCap({ host: 'cloud', scheduled: true }), nowMs: () => 0, wait: () => {} });
    requests.request('GET', 'rate_limit');
    assert.equal(requests.floor(), sweep.margin(limit));
    let pages = 0;
    while (requests.canStartTask(pages)) { for (let i = 0; i < sweep.TASK_COST; i += 1) requests.request('GET', 'task'); pages += 1; }
    assert.equal(requests.bound(), 'GitHub rate limit', `${limit}/${start}: GitHub's count is what stops it`);
    requests.reading = false;
    for (let i = 0; i < pages * sweep.PAGE_COST + requests.reserve; i += 1) requests.request('PATCH', 'page');
    // The pages owed and the reserve fit above the margin: the margin stays for other jobs.
    assert.ok(left.core >= sweep.margin(limit), `${limit} from ${start}: ${pages} tasks left ${left.core}`);
  }
});

test('margin: the share is one number, so changing the margin is a one-line edit', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep.cjs'), 'utf8');
  assert.equal(text.match(/^const MARGIN_SHARE = /gm).length, 1);
  assert.equal(sweep.margin(5000), 500);
});

// The changed-issues list as GitHub serves it, oldest or newest first; `onRead` may change rows mid-read.
function changedTransport(rows, onRead = () => {}) {
  const calls = [];
  return { calls, request(method, endpoint) {
    const url = new URL(`https://x/${endpoint}`);
    calls.push(url.searchParams.get('since'));
    onRead(calls.length);
    const since = Date.parse(url.searchParams.get('since'));
    const page = Number(url.searchParams.get('page'));
    const listed = rows.filter(row => Date.parse(row.updated_at) >= since).sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.number - b.number);
    if (url.searchParams.get('direction') !== 'asc') listed.reverse();
    return { status: 200, json: listed.slice((page - 1) * 100, page * 100).map(row => ({ ...row })) };
  } };
}

test('S2 / I2: 1,500 changes between passes: the cursor moves forward every pass and the list catches up', () => {
  const start = Date.parse(NOW);
  const rows = Array.from({ length: 1500 }, (_, i) => ({ number: 1000 + i, updated_at: new Date(start + i * 1000).toISOString() }));
  const seen = new Set();
  let since = new Date(start - MINUTE).toISOString();
  let previous = -Infinity;
  let passes = 0;
  for (; passes < 10; passes += 1) {
    const reader = new state.ProgrammeGraphReader({ transport: changedTransport(rows), repository: 'example.test/app' });
    const changed = reader.changedSince(since);
    for (const number of changed.issues) seen.add(number);
    if (changed.complete) break;
    assert.ok(changed.cursor, 'a cut list names where it got to');
    assert.ok(Date.parse(changed.cursor) > previous, 'the cursor only moves forward');
    // I2: every change before the cursor was read.
    assert.ok(rows.filter(row => Date.parse(row.updated_at) < Date.parse(changed.cursor)).every(row => seen.has(row.number)));
    previous = Date.parse(changed.cursor);
    since = new Date(previous - 5 * MINUTE).toISOString();
  }
  assert.ok(passes >= 1 && passes < 10, `caught up in ${passes + 1} passes`);
  assert.equal(seen.size, 1500, 'no change was lost');
});

test('S2: a row changed during the read moves to the end and is still read; a page of one time does not loop', () => {
  const start = Date.parse(NOW);
  const rows = Array.from({ length: 450 }, (_, i) => ({ number: 2000 + i, updated_at: new Date(start + i * 1000).toISOString() }));
  // While the second request runs, an early row changes again: it moves to the end of the list.
  const transport = changedTransport(rows, call => { if (call === 2) rows[3].updated_at = new Date(start + 10000 * 1000).toISOString(); });
  const changed = new state.ProgrammeGraphReader({ transport, repository: 'example.test/app' }).changedSince(new Date(start - MINUTE).toISOString());
  assert.equal(changed.complete, true);
  assert.equal(changed.issues.size, 450);
  assert.equal(changed.order[changed.order.length - 1] === 2003 || changed.order.includes(2003), true);
  // 250 rows changed in the same second: the read pages through them rather than asking again forever.
  const same = Array.from({ length: 250 }, (_, i) => ({ number: 3000 + i, updated_at: NOW }));
  const tied = changedTransport(same);
  const result = new state.ProgrammeGraphReader({ transport: tied, repository: 'example.test/app' }).changedSince(new Date(start - MINUTE).toISOString());
  assert.equal(result.complete, true);
  assert.equal(result.issues.size, 250);
  assert.ok(tied.calls.length <= 4, `${tied.calls.length} requests`);
});

test('S1: the discovery budget grows with the board, so 1,500 tasks never fail on a fixed sixty', () => {
  assert.equal(state.DISCOVERY_BASE, 60);
  assert.equal(state.discoveryBudget(124, 124), 60 + 7 + 248);
  const links = Math.ceil(1500 / 20);
  assert.ok(state.discoveryBudget(1500, 0) >= state.DISCOVERY_BASE + links, 'every link batch of a 1,500-task board fits');
  assert.ok(state.discoveryBudget(10000, 50) > state.discoveryBudget(1500, 50));
});

test('S3: the PR lists read past ten pages, bounded only by the pass budget and a runaway guard', () => {
  const prs = Array.from({ length: 1200 }, (_, i) => ({ number: 5000 + i, title: `PR ${i}`, body: '', state: 'open', updated_at: NOW,
    user: { login: 'someone' }, head: { ref: `b${i}`, sha: 'a'.repeat(40) }, base: { repo: { full_name: 'example.test/app' } } }));
  let requests = 0;
  const transport = { request(method, endpoint) {
    requests += 1;
    const page = Number(new URL(`https://x/${endpoint}`).searchParams.get('page'));
    return { status: 200, json: prs.slice((page - 1) * 100, page * 100) };
  } };
  let pages = 0;
  const listed = new state.ProgrammeGraphReader({ transport, repository: 'example.test/app' }).graphPullRequests('open', () => { pages += 1; });
  assert.equal(listed.length, 1200, 'all 1,200 open PRs are listed');
  assert.equal(pages, 13);
  assert.ok(state.LIST_PAGE_GUARD >= 1000);
});

test('limit hit mid-pass: the cloud pass stops at the margin, notes it calmly and the next run resumes from the saved place', t => {
  const f = fixture(t, { count: 60 });
  f.stale();
  // GitHub has 800 of 5,000 left this hour: about 300 above the margin, not enough for 60 stale tasks.
  const left = { core: 800, graphql: 5000 };
  const tight = limited(f.github, left);
  const first = f.run({ cloud: true, transport: tight.transport });
  assert.ok(first.code === 0 || first.report.holds.every(hold => hold.code === 'PASS_STOPPED'), JSON.stringify(first.report.holds));
  const queued = f.parent().sweep.queue;
  assert.ok(queued.length > 0 && first.report.sweep.read > 0, JSON.stringify(first.report.sweep));
  assert.match(first.report.metrics, /, cap=GitHub limit, .*complete=no$/);
  assert.ok(tight.lowest() >= sweep.margin(5000) - sweep.RESERVE, `GitHub's count went to ${tight.lowest()}`);
  assert.equal(f.boardLine(), f.boardLine().replace(/⚠️/g, ''), 'no warning');
  assert.match(f.boardLine(), new RegExp(`^Board updated: .* SGT \\(state revision \\d+\\)\\. Paused at GitHub's hourly App limit; the next run picks up the ${queued.length} tasks left\\.$`));
  // I1: every task not read is queued for the next run.
  const read = new Set(first.report.sweep.tasks);
  assert.ok(f.outcomes.every(outcome => read.has(outcome.issue) || queued.includes(outcome.issue)));
  // A new hour: the next run picks up the queue first and finishes.
  left.core = 5000;
  const second = f.run({ cloud: true, transport: tight.transport });
  assert.equal(second.code, 0, JSON.stringify(second.report.holds));
  assert.ok(queued.every(number => second.report.sweep.tasks.includes(number)), 'the saved place is read');
  assert.deepEqual(f.parent().sweep.queue, []);
  assert.match(f.boardLine(), /^Board updated: .* SGT \(state revision \d+\)$/);
});

test('busy state branch: a pass that saves nothing keeps the changed-since bookmark, so the next pass reads those changes', t => {
  const f = fixture(t, { count: 20 });
  f.run({ cloud: true });
  f.run({ cloud: true });
  const before = f.github.readFile('state/sweep-lease.json').changed_since;
  assert.ok(before, 'a finished pass sets the bookmark');
  const changed = f.outcomes.slice(0, 3).map(outcome => outcome.issue);
  for (const number of changed) Object.assign(f.github.issues.get(number), { state: 'closed', state_reason: 'completed', closed_at: f.github.tick(), updated_at: f.github.tick() });
  // Every save races another writer: the pass stops with the state branch busy and saves nothing.
  f.github.intercept(call => (call.method === 'PATCH' && call.path.includes('/git/refs/heads/') ? { status: 422, json: { message: 'Reference moved' } } : undefined));
  const busy = f.run({ cloud: true });
  assert.equal(busy.report.sweep.noWrite, true, JSON.stringify(busy.report.sweep));
  assert.ok(busy.report.holds.some(hold => hold.code === 'PASS_STOPPED' && /state branch was busy/.test(hold.detail)), JSON.stringify(busy.report.holds));
  assert.equal(f.github.readFile('state/sweep-lease.json').changed_since, before, 'the bookmark does not move past changes nobody saved');
  f.github.hooks = [];
  const next = f.run({ cloud: true });
  assert.equal(next.code, 0, JSON.stringify(next.report.holds));
  assert.ok(changed.every(number => next.report.sweep.tasks.includes(number)), `the changes are read again: ${JSON.stringify(next.report.sweep.tasks)}`);
  assert.ok(changed.every(number => f.store.read('child', number).doc?.lifecycle === 'DONE'), 'and saved this time');
  assert.ok(f.github.readFile('state/sweep-lease.json').changed_since > before, 'a pass that saves moves the bookmark on');
});

test('M4: a pass that starts below the margin ends calmly: exit 0, the pause note, no stop finding', t => {
  const f = fixture(t, { count: 20 });
  f.run({ cloud: true });
  f.stale();
  // An extra start while GitHub's hourly count is already under the margin (500 of 5,000).
  const left = { core: 300, graphql: 5000 };
  const low = limited(f.github, left);
  const before = f.page();
  const queueBefore = f.parent().sweep.queue;
  const result = f.run({ cloud: true, transport: low.transport });
  assert.equal(result.code, 0, 'not a failure: the job stays green');
  assert.deepEqual(result.report, { outcome: 'PAUSED', reason: 'GitHub rate limit' });
  assert.equal(f.page(), before, 'nothing is drawn under the margin');
  assert.deepEqual(f.parent().sweep.queue, queueBefore, 'the saved place is kept');
  const lease = f.github.readFile('state/sweep-lease.json');
  assert.equal(lease.unreported, null, 'no stop is left for the next pass to report');
  assert.ok(!(f.parent().attention || []).some(entry => entry.code === 'PASS_STOPPED'), 'no stop finding');
  // The action turns it into a calm summary line and no follow-up.
  const action = require(path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-action.cjs'));
  assert.match(action.summaryLine(result.report), /^Programme Sweep paused: GitHub's hourly App limit/);
  assert.equal(action.followUpAt(result.report, 1, 2), 0);
  // A new hour: the next run reads the changes.
  left.core = 5000;
  const next = f.run({ cloud: true, transport: low.transport });
  assert.equal(next.code, 0, JSON.stringify(next.report.holds));
  assert.ok(next.report.sweep.read > 0);
});

test('history: each unfinished pass is kept beside the lease, the lease keeps its old fields, the window is six hours', t => {
  const f = fixture(t, { count: 30 });
  // Finished passes write no history: the lease's last finish time already rules out "stuck".
  f.run({ cloud: true });
  f.run({ cloud: true });
  assert.equal(f.github.readFile('state/sweep-history.json'), null);
  // Passes cut short by a small cap are kept, each with what it read and left.
  for (let i = 0; i < 2; i += 1) { f.stale(); f.run({ cloud: true, requestCap: 120 }); }
  const history = f.github.readFile('state/sweep-history.json');
  assert.ok(history, 'the history file exists');
  assert.deepEqual(state.validateSweepHistory(history), history);
  assert.equal(history.passes.length, 2);
  assert.ok(history.passes.every(entry => entry.complete === false && Number.isInteger(entry.read) && entry.left > 0), JSON.stringify(history.passes));
  // An older sweep reads the lease with its strict field list: nothing new is added there.
  assert.deepEqual(Object.keys(f.github.readFile('state/sweep-lease.json')).sort(),
    ['changed_since', 'holder', 'last_complete_at', 'pass', 'reason', 'repository', 'schema', 'stopped_passes', 'streaks', 'unreported']);
  // Passes older than six hours drop out.
  for (let i = 0; i < 8; i += 1) { f.stale(); f.run({ cloud: true, requestCap: 120 }); }
  const kept = f.github.readFile('state/sweep-history.json').passes;
  assert.ok(kept.length > 0 && kept.every(entry => f.now() - Date.parse(entry.at) <= STUCK_MS), JSON.stringify(kept.map(entry => entry.at)));
  assert.throws(() => state.validateSweepHistory({ ...history, passes: [{ at: NOW, read: -1, left: 0, complete: true }] }), { code: 'STATE_INVALID' });
});

test('stuck rule: only when no pass finished for six hours and the passes in them read fewer than ten tasks', () => {
  const at = Date.parse(NOW);
  const lease = ({ started, complete = null, passes = [] }) => {
    const value = new SweepLease({ store: { sweepRecordPath: () => 'state/sweep-lease.json' }, repository: 'example.test/app', host: 'cloud', nowMs: () => at, endsBy: at + HOUR });
    value.record = { last_complete_at: complete };
    value.history = { doc: { schema: state.SWEEP_HISTORY_SCHEMA, repository: 'example.test/app', started_at: new Date(started).toISOString(),
      passes: passes.map(([ago, read]) => ({ at: new Date(at - ago).toISOString(), read, left: 50, complete: false })) } };
    return value;
  };
  const hours = n => n * HOUR;
  assert.equal(STUCK_READS, 10);
  // Watched for seven hours, three passes read three tasks in all, nothing finished: stuck.
  assert.deepEqual(lease({ started: at - hours(7), passes: [[hours(5), 1], [hours(3), 1], [hours(1), 1]] }).stuck(0), { stuck: true, read: 3 });
  // This pass's own reads count.
  assert.equal(lease({ started: at - hours(7), passes: [[hours(1), 3]] }).stuck(7).stuck, false);
  // Ten tasks read in six hours is progress, however slow.
  assert.equal(lease({ started: at - hours(7), passes: [[hours(5), 5], [hours(1), 5]] }).stuck(0).stuck, false);
  // Reads older than six hours do not count.
  assert.equal(lease({ started: at - hours(9), passes: [[hours(8), 50], [hours(2), 1]] }).stuck(0).stuck, true);
  // A pass finished within six hours: not stuck.
  assert.equal(lease({ started: at - hours(9), complete: new Date(at - hours(5)).toISOString(), passes: [[hours(2), 0]] }).stuck(0).stuck, false);
  // The history covers less than six hours: too early to say.
  assert.equal(lease({ started: at - hours(2), passes: [[hours(1), 0]] }).stuck(0).stuck, false);
  // No history readable: never stuck.
  const unread = lease({ started: at - hours(9) }); unread.history = null;
  assert.equal(unread.stuck(0).stuck, false);
});

test('board note: each early stop reads calmly; only a stuck sweep warns', () => {
  const parent = { revision: 7 };
  const line = ({ reason = null, left = 12, host = 'cloud', stuck = false, stopped = false, pausedBy = null, complete = false } = {}) => state.Reconciler.prototype.boardLine.call({
    board: { record: { last_complete_at: '2026-11-11T20:00:00.000Z', reason: null }, time: NOW, complete, left },
    stopReason: reason, pausedBy, pass: { stopped, stopReason: null }, now: () => NOW, sweepRead: 0,
    queued: { host, stuck: () => ({ stuck, read: 2 }) },
  }, parent);
  assert.equal(line({ complete: true }), 'Board updated: 12 Nov 2026, 09:00 SGT (state revision 7)');
  assert.equal(line({ pausedBy: 'GitHub rate limit' }), 'Board updated: 12 Nov 2026, 09:00 SGT (state revision 7). Paused at GitHub\'s hourly App limit; the next run picks up the 12 tasks left.');
  assert.equal(line({ pausedBy: 'GitHub rate limit', host: 'computer' }), 'Board updated: 12 Nov 2026, 09:00 SGT (state revision 7). Paused at GitHub\'s hourly limit; the next run picks up the 12 tasks left.');
  assert.equal(line({ pausedBy: 'time limit', left: 1 }), 'Board updated: 12 Nov 2026, 09:00 SGT (state revision 7). Paused at this pass\'s time limit; the next run picks up the 1 task left.');
  assert.equal(line({}), 'Board updated: 12 Nov 2026, 09:00 SGT (state revision 7). The next run picks up the 12 tasks left.');
  assert.equal(line({ reason: 'state branch busy', left: 0 }), 'Board updated: 12 Nov 2026, 09:00 SGT (state revision 7). Not every read finished (state branch busy); the next run reads it again.');
  for (const text of [line({ pausedBy: 'GitHub rate limit' }), line({}), line({ reason: 'an error', left: 0 })]) assert.doesNotMatch(text, /⚠️/);
  assert.equal(line({ stuck: true, pausedBy: 'GitHub rate limit' }),
    '⚠️ Sweep stuck: no pass has finished since 12 Nov 2026, 04:00 SGT, and the passes in the last 6 hours read 2 tasks. 12 tasks still to check (GitHub rate limit).');
});
