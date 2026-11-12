'use strict';

// The pass budget per mode: a scheduled pass has about an hour (50 minutes of work, killed at 55,
// its job stopped at 58), an after-write refresh keeps 10 minutes and defers while the scheduled
// pass holds the lock, and the request cap still stops a pass however much time is left.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = '2026-11-12T01:00:00.000Z';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const controller = { session: 'fixture-controller', prefix: 'TEST-' };

test('budget modes: scheduled 50 minutes, after-write 10; each budget < kill < job timeout < 60 minutes', () => {
  const budgets = state.PASS_BUDGETS;
  assert.ok(budgets, 'one budget setting per mode');
  assert.equal(budgets.scheduled.budgetMs, 50 * MINUTE);
  assert.equal(budgets['after-write'].budgetMs, 10 * MINUTE);
  for (const [mode, budget] of Object.entries(budgets)) {
    assert.ok(budget.budgetMs < budget.killMs && budget.killMs < budget.jobTimeoutMs && budget.jobTimeoutMs < HOUR, mode);
  }
  assert.equal(budgets.scheduled.killMs, 55 * MINUTE);
  assert.equal(budgets.scheduled.jobTimeoutMs, 58 * MINUTE);
  assert.equal(state.REFRESH_BUDGET_MS, budgets['after-write'].budgetMs, 'a refresh with no mode keeps the after-write budget');
  // The reserves keep their sizes; only the budget grows.
  assert.deepEqual([state.PAGE_RESERVE_MS, state.END_RESERVE_MS, state.AGAIN_RESERVE_MS], [3 * MINUTE, MINUTE, 6 * MINUTE]);
});

test('budget modes: the workflow, its kill and the computer task take their limits from the setting', () => {
  const scheduled = state.PASS_BUDGETS.scheduled;
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/toolkit-programme-sweep.yml'), 'utf8');
  assert.match(workflow, new RegExp(`timeout-minutes: ${scheduled.jobTimeoutMs / MINUTE}\\b`));
  assert.match(workflow, /toolkit-programme-sweep-action\.cjs refresh/);
  const action = require(path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-action.cjs'));
  assert.equal(action.RUN_TIMEOUT_MS, scheduled.killMs, 'the in-process kill');
  const seen = [];
  action.runRefresh({ root: ROOT, env: {}, spawn: (file, args, options) => { seen.push({ args, options }); return { status: 0, stdout: '{}', stderr: '' }; } });
  assert.ok(seen[0].args.includes('--scheduled'), 'the cloud pass runs in the scheduled mode');
  assert.equal(seen[0].options.timeout, scheduled.killMs);
  const job = require(path.join(ROOT, 'repo/scripts/toolkit-scheduled-job.cjs'));
  assert.equal(job.WORK_BUDGET_MS, 55 * MINUTE);
  const windows = require(path.join(ROOT, 'repo/scripts/toolkit-windows-tasks.cjs'));
  assert.ok(windows.TASK_TIME_LIMIT_MINUTES * MINUTE > job.WORK_BUDGET_MS && windows.TASK_TIME_LIMIT_MINUTES * MINUTE < HOUR, 'the task stop-after leaves the bookkeeping minute and ends before the next hour');
});

test('budget modes: the computer refresh gets what is left before 55 minutes, less the attention step, never under 10', t => {
  const job = require(path.join(ROOT, 'repo/scripts/toolkit-scheduled-job.cjs'));
  const { budgetMs, killMs } = job.computerRefreshBudget(54 * MINUTE);
  assert.equal(budgetMs, 47 * MINUTE, '54 left, less 2 for attention and 5 for the kill slack');
  assert.equal(killMs, 52 * MINUTE);
  assert.equal(job.computerRefreshBudget(58 * MINUTE).budgetMs, 50 * MINUTE, 'never more than the scheduled budget');
  assert.equal(job.computerRefreshBudget(14 * MINUTE).budgetMs, 10 * MINUTE, 'never less than the after-write budget');
  // The hourly task passes that budget to the scheduled mode.
  const s = require('./support/windows-task-switch-world.cjs');
  const home = s.tempHome(t), root = s.checkout(t);
  const fake = s.fakeRun({ 'toolkit-governance.cjs': { status: 0, stdout: JSON.stringify({ state: 'ENABLED', merged: { status: 'enabled', fresh: true } }) }, 'programme.cjs': { status: 0, stdout: '{"holds":[]}' } });
  const calls = [];
  let clock = 0;
  job.runJob({ job: 'programme-sweep', taskId: 'widget-programme-sweep', repoRoot: root }, { home, ghPath: s.GH, repositoryReader: s.testRepository, monotonicNow: () => clock,
    readIdentity: dir => ({ valid: true, root: dir, remote: { host: 'github.com', path: '/example/widget.git' } }),
    readObservation: () => ({ status: 'enabled', fresh: true, binding: s.fixtureBinding('example/widget', 'WIDGET') }),
    run: (file, args, options) => { calls.push({ args, timeout: options.timeout }); return file === s.GH && args[0] === 'auth' ? { status: 0 } : fake.run(file, args, options); } });
  const refresh = calls.find(call => call.args.includes('refresh'));
  assert.ok(refresh, 'the refresh ran');
  const at = refresh.args.indexOf('--budget-ms');
  assert.ok(refresh.args.includes('--scheduled') && at > 0);
  assert.equal(Number(refresh.args[at + 1]), 48 * MINUTE, '55 minutes, less attention and the kill slack');
  assert.equal(refresh.timeout, 53 * MINUTE, 'killed five minutes after its budget');
});

// Tasks natively under #421 with their pages drawn; every request takes `slow` on the pass clock.
function fixture(t, { count = 30, slow = 0 } = {}) {
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
  const full = new state.Reconciler({ store, binding, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true, toolkitVersion: '3.68.0', now,
    reader: new state.ProgrammeGraphReader({ transport: github, repository: github.repository }), mutator: new state.GitHubMutator({ transport: github, repository: github.repository }) });
  assert.deepEqual(full.run({ apply: true }).holds, []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-budget-modes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lockFile = path.join(dir, 'pass.lock');
  let started = clock;
  github.intercept(() => { clock += slow; });
  const run = (argv, extra = {}) => {
    clock += HOUR; github.clock += HOUR; started = clock;
    const calls = github.calls.length;
    let output = '';
    const code = cli.main([...argv, '--json'], { transport: github, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.', toolkitVersion: '3.68.0',
      now, passClock: () => clock, lockFile, environment: {}, stdout: { write: text => { output += text; } }, ...extra });
    return { code, report: JSON.parse(output.slice(output.lastIndexOf('\n{') + 1)), minutes: (clock - started) / MINUTE, requests: github.calls.length - calls };
  };
  const stop = () => store.read('parent', 421).doc.attention?.find(entry => entry.code === 'PASS_STOPPED' && ['new', 'acknowledged'].includes(entry.state));
  return { github, store, run, lockFile, stop, parent: () => store.read('parent', 421).doc, page: number => github.issues.get(number).body, tick: () => github.tick() };
}

test('a slow GitHub: a pass runs past the old 10 minutes and finishes inside the scheduled budget', t => {
  // Eight seconds a request: the first queued pass (every task, every page redrawn) takes longer than ten minutes.
  const f = fixture(t, { count: 30, slow: 8000 });
  // Every task page lost its blocks, so every task is read and its page drawn again.
  for (const outcome of f.parent().outcomes) Object.assign(f.github.issues.get(outcome.issue), { title: `Renamed ${outcome.issue}`, body: '', updated_at: f.tick() });
  const scheduled = f.run(['refresh', '--scheduled']);
  assert.ok(scheduled.minutes > 10, `ran ${scheduled.minutes} minutes`);
  assert.ok(scheduled.minutes < 50);
  assert.equal(scheduled.code, 0, JSON.stringify(scheduled.report.holds));
  assert.equal(f.stop(), undefined, 'no PASS_STOPPED');
  assert.deepEqual(f.parent().sweep.queue, []);
  assert.ok(f.parent().outcomes.every(outcome => f.page(421).includes(`Renamed ${outcome.issue}`) && /State revision \d+ \(issue-/.test(f.page(outcome.issue))), 'pages drawn');
  assert.match(f.page(421), /^Board updated: /m);
});

test('a slow GitHub: the same pass under the after-write budget stops at ten minutes', t => {
  const f = fixture(t, { count: 30, slow: 8000 });
  // Every task page lost its blocks, so every task is read and its page drawn again.
  for (const outcome of f.parent().outcomes) Object.assign(f.github.issues.get(outcome.issue), { title: `Renamed ${outcome.issue}`, body: '', updated_at: f.tick() });
  const afterWrite = f.run(['refresh']);
  assert.ok(afterWrite.minutes <= 10.5, `ran ${afterWrite.minutes} minutes`);
  assert.equal(f.stop()?.diagnostics.cause, 'time_limit');
});

test('an after-write refresh while the scheduled pass holds the lock defers, writes nothing, and the next scheduled pass includes the change', t => {
  const f = fixture(t, { count: 4 });
  f.run(['refresh', '--scheduled']);
  const held = cli.takeLock(f.lockFile);
  held.beat();
  Object.assign(f.github.issues.get(502), { state: 'closed', state_reason: 'completed', closed_at: f.tick(), updated_at: f.tick() });
  const before = { commits: f.github.commits, mutations: f.github.mutations() };
  const deferred = f.run(['refresh']);
  assert.deepEqual([deferred.code, deferred.report.outcome], [0, 'QUEUED']);
  assert.deepEqual({ commits: f.github.commits, mutations: f.github.mutations() }, before, 'nothing written');
  assert.equal(fs.existsSync(cli.againFile(f.lockFile)), true, 'the change is flagged for the running pass');
  held.release();
  assert.equal(f.run(['refresh', '--scheduled']).code, 0);
  assert.equal(f.store.read('child', 502).doc.lifecycle, 'DONE');
});

test('a pass that reaches the request cap at minute 20 stops, saves its place and resumes next hour', t => {
  // Twelve seconds a request and a cap of 100: the cap comes long before the 50-minute budget.
  const f = fixture(t, { count: 30, slow: 12000 });
  for (const outcome of f.parent().outcomes) {
    f.github.addComment(outcome.issue, { body: `Note on ${outcome.issue}` });
    Object.assign(f.github.issues.get(outcome.issue), { title: `Renamed ${outcome.issue}`, updated_at: f.tick() });
  }
  const capped = f.run(['refresh', '--scheduled'], { requestCap: 100 });
  assert.ok(capped.requests <= 100, `${capped.requests} requests`);
  assert.ok(capped.minutes > 15 && capped.minutes < 25, `stopped at minute ${capped.minutes}`);
  const left = f.parent().sweep.queue;
  assert.ok(left.length > 0 && capped.report.sweep.read > 0, JSON.stringify(capped.report.sweep));
  assert.match(f.page(421), /^⚠️ Board out of date .*tasks still to check\.$/m);
  // The capped pass draws the pages of what it read; a pass that only reads leaves the board as stale
  // as before. Thirty changed tasks at about seven requests a page and a cap of 100 take about
  // fifteen hourly passes (the old bound of six held only while pages were never drawn).
  assert.ok(capped.report.holds.every(hold => !/\(0 of \d+ done\)/.test(hold.detail)), `the capped pass drew pages: ${JSON.stringify(capped.report.holds)}`);
  let passes = 0;
  while (f.parent().sweep.queue.length && passes < 20) { f.run(['refresh', '--scheduled'], { requestCap: 100 }); passes += 1; }
  assert.deepEqual(f.parent().sweep.queue, [], 'every task is read in later hours');
});
