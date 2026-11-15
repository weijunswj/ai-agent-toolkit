'use strict';

// The refresh failure suite: GitHub slowness, a rate limit, a page edited mid-run, a stop at every
// phase, and two or more comments on one page in one pass. Each case ends in a resumed run that
// completes, plus a loud finding or hold, never a silent half-page. A stop in the closing phase is
// in the closing-comment tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const sweep = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
const { renderScaleFixture } = require('./support/programme-render-scale.cjs');

const NOW = '2026-11-15T00:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const writer = { session: 'fixture-controller', prefix: 'TEST-' };
const CLOUD = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', SWEEP_LOGIN: 'example-bot' };
const drawn = body => /State revision \d+ \(issue-\d+\.json\)/.test(body || '');

// Six catalogued tasks, one not yet attached (links), then three native additions placed first
// (order) and one open PR naming a task (PR links): a first pass enters every queue phase.
function fixture(t) {
  const repository = 'example.test/app';
  const github = new FakeGitHub({ repository, store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n' });
  const outcomes = Array.from({ length: 6 }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, outcome.issue === 505 ? {} : { parent: 421 });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => NOW, toolkitVersion: '3.119.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), writer, {}), { sha: null, previous: null });
  for (let i = 0; i < 3; i += 1) github.addIssue(800 + i, { parent: 421 });
  const subs = github.issues.get(421).subs;
  github.issues.get(421).subs = [...subs.slice(5), ...subs.slice(0, 5)];
  github.addPr(900, { head: 'a'.repeat(40), state: 'OPEN', body: 'Refs #500' });
  const make = pass => new state.Reconciler({ binding, store, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true,
    reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    toolkitVersion: '3.119.0', now: () => NOW, pass });
  const stop = () => store.read('parent', 421).doc.attention?.find(entry => entry.code === 'PASS_STOPPED');
  const tasks = () => store.read('parent', 421).doc.outcomes.map(outcome => outcome.issue);
  const pageWrites = () => github.calls.filter(call => call.method === 'PATCH' && /issues\/(?:5|8)\d\d$/.test(call.path) && call.body?.body !== undefined);
  // The CLI's scheduled sweep, as the cloud workflow runs it, one hour after the last.
  let clock = Date.parse(NOW);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sweepRun = ({ transport = github, ...extra } = {}) => {
    clock += HOUR; github.clock += HOUR;
    let output = '';
    const code = cli.main(['refresh', '--scheduled', '--json'], { transport, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: dir,
      toolkitVersion: '3.119.0', now: () => new Date(clock).toISOString(), passClock: () => clock, lockFile: null, environment: CLOUD,
      requestCap: sweep.passCap({ host: 'cloud', scheduled: true }), stdout: { write: text => { output += text; } }, ...extra });
    return { code, report: JSON.parse(output.slice(output.lastIndexOf('\n{') + 1)) };
  };
  return { github, store, make, stop, tasks, pageWrites, sweepRun };
}

// A pass clock that jumps when the pass enters `target`: past the deadline in planning, and to
// ninety seconds before it elsewhere, inside the two minutes each queue phase keeps for settling.
function stopAt(target) {
  const clock = { at: Date.parse(NOW) };
  class StopAt extends state.RefreshBudget {
    phaseAt(phase, total) {
      super.phaseAt(phase, total);
      if (phase === target && !this.jumped) { this.jumped = true; clock.at = this.deadline - (phase === 'planning' ? -1 : 90 * 1000); }
    }
  }
  return new StopAt({ nowMs: () => clock.at, budgetMs: 10 * 60 * 1000 });
}

for (const phase of ['planning', 'state', 'page', 'links', 'order', 'pr_links', 'task_pages']) {
  test(`stop at ${phase}: the stop is recorded with its phase, the next pass completes every page and the finding resolves`, t => {
    const f = fixture(t);
    const stopped = f.make(stopAt(phase)).run({ apply: true });
    assert.ok(stopped.holds.some(hold => hold.code === 'PASS_STOPPED'), JSON.stringify(stopped.holds));
    assert.deepEqual([f.stop()?.diagnostics.phase, f.stop()?.diagnostics.cause, f.stop()?.state], [phase, 'time_limit', 'new']);
    // Past planning the parent is redrawn with the stop in CURRENT: the page says it may be behind.
    if (phase !== 'planning') assert.match(f.github.issues.get(421).body, /PASS_STOPPED #421: the last refresh stopped at /);
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    f.make().run({ apply: true });
    assert.equal(f.stop().state, 'resolved');
    assert.doesNotMatch(f.github.issues.get(421).body, /PASS_STOPPED/);
    for (const issue of f.tasks()) assert.ok(drawn(f.github.issues.get(issue).body), `#${issue} drawn`);
  });
}

test('stop mid-way through the task pages: the next pass writes only the pages left, none twice', t => {
  const f = fixture(t);
  const clock = { at: Date.parse(NOW) };
  const pass = new state.RefreshBudget({ nowMs: () => clock.at, budgetMs: 10 * 60 * 1000 });
  let written = 0;
  f.github.intercept(call => {
    if (call.method === 'PATCH' && /issues\/(?:5|8)\d\d$/.test(call.path) && call.body?.body !== undefined && ++written === 4) clock.at = pass.deadline - 90 * 1000;
  });
  const stopped = f.make(pass).run({ apply: true });
  f.github.hooks = [];
  assert.ok(stopped.holds.some(hold => hold.code === 'PASS_STOPPED'));
  assert.equal(f.stop().diagnostics.phase, 'task_pages');
  const first = new Set(f.pageWrites().map(call => call.path));
  assert.equal(first.size, 4, 'four pages were written before the stop');
  const before = f.github.calls.length;
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const second = f.github.calls.slice(before).filter(call => call.method === 'PATCH' && /issues\/(?:5|8)\d\d$/.test(call.path) && call.body?.body !== undefined).map(call => call.path);
  assert.ok(second.length > 0 && second.every(page => !first.has(page)), `resumed: ${second.join(', ')}`);
  for (const issue of f.tasks()) assert.ok(drawn(f.github.issues.get(issue).body), `#${issue} drawn`);
});

test('slowness: GitHub answering slowly stops the pass at its time limit, loudly, and a normal pass completes', t => {
  const f = fixture(t);
  let elapsed = 0;
  f.github.intercept(() => { elapsed += 20 * 1000; });
  const slow = f.make(new state.RefreshBudget({ nowMs: () => Date.parse(NOW) + elapsed, budgetMs: 10 * 60 * 1000 })).run({ apply: true });
  f.github.hooks = [];
  assert.ok(slow.holds.some(hold => hold.code === 'PASS_STOPPED'), JSON.stringify(slow.holds));
  assert.equal(f.stop().diagnostics.cause, 'time_limit');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  f.make().run({ apply: true });
  assert.equal(f.stop().state, 'resolved');
  for (const issue of f.tasks()) assert.ok(drawn(f.github.issues.get(issue).body), `#${issue} drawn`);
});

test('rate limit: the hour\'s allowance running out mid-run stops the pass loudly, holds only the refused task, and the next run completes', t => {
  const f = fixture(t);
  let refused = false;
  const transport = {
    request(...input) {
      // The first read of a task's comments is refused: the hour's allowance is spent, as GitHub says
      // with a 403 and no requests remaining. (Waiting out a retry-after is in the request tests.)
      if (!refused && input[0] === 'GET' && /issues\/50\d\/comments/.test(input[1])) {
        refused = true;
        return Object.defineProperty({ status: 403, json: { message: 'API rate limit exceeded.' } }, 'headers', { value: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000', 'x-ratelimit-resource': 'core' }, enumerable: false });
      }
      return f.github.request(...input);
    },
  };
  const limited = f.sweepRun({ transport });
  assert.equal(limited.report.sweep.reason, 'GitHub rate limit', JSON.stringify(limited.report.sweep));
  assert.match(limited.report.metrics, /, complete=no$/);
  // With nothing left of the hour, nothing more is written to GitHub: the stop is loud in the run's
  // held warning and in the saved finding, and the refused read holds only its own task.
  assert.deepEqual(limited.report.holds.map(hold => [hold.code, hold.target]), [['GH_FAILED', '#500'], ['PASS_STOPPED', '#421']]);
  assert.equal(f.stop()?.state, 'new');
  const resumed = f.sweepRun();
  assert.equal(resumed.code, 0, JSON.stringify(resumed.report.holds));
  assert.match(resumed.report.metrics, /, complete=yes$/);
  assert.equal(f.store.read('parent', 421).doc.sweep.queue.length, 0);
  f.sweepRun();
  assert.equal(f.stop().state, 'resolved');
  for (const issue of f.tasks()) assert.ok(drawn(f.github.issues.get(issue).body), `#${issue} drawn`);
});

test('page edited mid-run: only that page is held, every other page is written, and the next pass draws it with the edit kept', t => {
  const f = fixture(t);
  let edited = null;
  f.github.intercept(call => {
    if (edited || call.method !== 'PATCH' || !/issues\/5\d\d$/.test(call.path) || call.body?.body === undefined) return;
    // While the first task page is being written, a person edits a later one.
    const written = Number(call.path.split('/').pop());
    edited = f.tasks().find(issue => issue !== written && issue !== 505 && !drawn(f.github.issues.get(issue).body));
    const issue = f.github.issues.get(edited);
    issue.body = `${issue.body}\nOwner note added mid-run.\n`;
    issue.updated_at = f.github.tick();
  });
  const report = f.make().run({ apply: true });
  f.github.hooks = [];
  assert.ok(edited, 'a later page was edited');
  assert.deepEqual(report.holds.map(hold => [hold.code, hold.target]), [['BODY_MOVED', `#${edited}`]]);
  assert.ok(!drawn(f.github.issues.get(edited).body), 'the edited page was not overwritten');
  for (const issue of f.tasks().filter(issue => issue !== edited)) assert.ok(drawn(f.github.issues.get(issue).body), `#${issue} drawn`);
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.ok(drawn(f.github.issues.get(edited).body));
  assert.match(f.github.issues.get(edited).body, /Owner note added mid-run\./);
});

// The parent needs two archive comments (earlier completed and retired rows) and a body write in
// one pass. GitHub moves the issue's update time to each comment's time, as the fake now does.
function twoComments() {
  const f = renderScaleFixture(state, { proseSize: 400 });
  for (const [i, number] of [...f.children.keys()].entries()) {
    const child = f.children.get(number);
    if (child.lifecycle !== 'DONE') continue;
    child.completed_at = `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`;
    f.store.write('child', number, child, { sha: f.store.read('child', number).sha, previous: f.store.read('child', number).doc });
  }
  const archives = () => [...f.github.comments.values()].filter(comment => comment.issue === 421 && /^<!-- programme-page-archive key=graph-/.test(comment.body));
  const linked = () => /^\[Earlier completed \(30\)\]\(.*\) · \[Retired \(14\)\]\(.*\)$/m.test(f.github.issues.get(421).body);
  return { ...f, archives, linked };
}

test('two or more comments on one page: one pass posts both and writes the page, though each post moves the update time', () => {
  const f = twoComments();
  const result = f.reconciler.run({ apply: true });
  assert.deepEqual(result.holds, []);
  assert.equal(f.archives().length, 2);
  assert.ok(f.linked(), 'the page links both comments in the same pass');
  assert.equal(f.github.issues.get(421).updated_at > f.archives()[0].created_at, true, 'the body write came after the posts');
});

// A busy parent gets comments all the time (decision records, merge records and edits to them), so
// a comment that lands while a pass runs never holds the write: it does not change the page's text,
// and the next pass picks up anything it changes. Only a change to the body itself holds the page.
test('two or more comments on one page: a person\'s comment between the posts does not hold the page', () => {
  const f = twoComments();
  let posts = 0;
  f.github.intercept(call => {
    if (call.method === 'POST' && call.path.endsWith('/issues/421/comments') && ++posts === 1) {
      // After this pass's first post lands, a person comments too: that time is not this pass's own.
      f.github.addComment(421, { body: 'A person comments mid-run.', login: 'someone-else', createdAt: new Date(f.github.clock + 5 * 60 * 1000).toISOString() });
    }
  });
  const result = f.reconciler.run({ apply: true });
  f.github.hooks = [];
  assert.deepEqual(result.holds, []);
  assert.equal(f.archives().length, 2);
  assert.ok(f.linked(), 'the page was written in the same pass');
  assert.deepEqual(f.reconciler.run({ apply: true }).holds, []);
  assert.equal(f.archives().length, 2, 'the archive comments are never posted twice');
});

test('two or more comments on one page: a body edit between the posts holds the page, and the next pass keeps the edit', () => {
  const f = twoComments();
  let posts = 0;
  f.github.intercept(call => {
    if (call.method === 'POST' && call.path.endsWith('/issues/421/comments') && ++posts === 1) {
      const issue = f.github.issues.get(421);
      issue.body = `${issue.body}\nOwner line added mid-run.\n`;
    }
  });
  const held = f.reconciler.run({ apply: true });
  f.github.hooks = [];
  assert.deepEqual(held.holds.map(hold => hold.code), ['BODY_MOVED']);
  assert.deepEqual(f.reconciler.run({ apply: true }).holds, []);
  assert.ok(f.linked());
  assert.match(f.github.issues.get(421).body, /Owner line added mid-run\./);
});

// The live failure: one busy task passed 100 cross-references, its links read as incomplete, and from
// then on no scheduled pass finished: the lease never moved its last finish and the earlier stop
// stayed open. With the links read past the first page, the sweep finishes again.
test('busy task: more than 100 cross-references on one task no longer keep every sweep pass from finishing', t => {
  const f = fixture(t);
  assert.match(f.sweepRun().report.metrics, /, complete=yes$/);
  f.github.issuePrLinks.set(500, { timeline: [...Array.from({ length: 140 }, () => ({ __typename: 'Issue' })), 900] });
  f.store.mutate('parent', 421, { writer, change: doc => {
    doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, now: NOW,
      seen: [{ code: 'PASS_STOPPED', issue: 421, diagnostics: { cause: 'time_limit', phase: 'closing', done: 1, total: 72, started_at: NOW } }] });
    return doc;
  } });
  f.github.issues.get(500).updated_at = new Date(Date.parse(NOW) + 90 * 60 * 1000).toISOString();
  const busy = f.sweepRun();
  assert.match(busy.report.metrics, /, complete=yes$/, JSON.stringify(busy.report.sweep));
  assert.equal(f.stop().state, 'resolved');
});

test('busy task: links GitHub will not page past still leave the pass incomplete, and the lease says why', t => {
  const f = fixture(t);
  f.sweepRun();
  f.github.issuePrLinks.set(500, { timeline: [900], timelineTruncated: true });
  f.github.issues.get(500).updated_at = new Date(Date.parse(NOW) + 90 * 60 * 1000).toISOString();
  const stuck = f.sweepRun();
  assert.match(stuck.report.metrics, /, complete=no$/);
  assert.equal(stuck.report.sweep.reason, 'an incomplete read');
  assert.equal(f.github.readFile('state/sweep-lease.json').reason, 'an incomplete read');
});
