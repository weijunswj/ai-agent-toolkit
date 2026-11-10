'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const attentionCache = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-attention-cache.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const writer = { session: 'fixture-controller', prefix: 'TEST-' };
const NOW = '2026-11-08T00:00:00.000Z';
const budget = (clock, ms) => state.RefreshBudget ? new state.RefreshBudget({ nowMs: clock, budgetMs: ms }) : undefined;
const openStop = f => f.store.read('parent', 421).doc.attention?.find(entry => entry.code === 'PASS_STOPPED');
const parentWrites = calls => calls.filter(call => call.method === 'PATCH' && call.path.endsWith('/issues/421') && call.body.body);

// Sixty-seven settled tasks, then seventeen native additions placed before them. The next pass
// adopts 17 tasks, makes 17 order moves and writes 18 bodies. Setup writes are outside the counts.
function fixture({ count = 67, added = 17, prepare } = {}) {
  const repository = 'example.test/app';
  const github = new FakeGitHub({ repository, store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n\n## CURRENT\nHand-written notes.\n' });
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  prepare?.(github, outcomes);
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => NOW, toolkitVersion: '3.56.1' });
  const parent = state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), writer, {});
  store.write('parent', 421, parent, { sha: null, previous: null });
  const make = pass => new state.Reconciler({ binding, store, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true,
    reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    toolkitVersion: '3.56.1', now: () => NOW, pass });
  assert.deepEqual(make().run({ apply: true }).holds, []);
  for (let i = 0; i < added; i++) github.addIssue(800 + i, { parent: 421 });
  const subs = github.issues.get(421).subs;
  github.issues.get(421).subs = [...subs.slice(count), ...subs.slice(0, count)];
  const before = { commits: github.commits, calls: github.calls.length, mutations: github.mutations() };
  return { github, store, binding, make, before };
}

function measured(f) {
  const r = f.make();
  const start = f.github.calls.length;
  const plan = r.plan();
  const planning = f.github.calls.length - start;
  const applyStart = f.github.calls.length;
  const result = r.apply(plan);
  const calls = f.github.calls.slice(applyStart);
  return { result, calls, stats: { state_commits: f.github.commits - f.before.commits, github_writes: f.github.mutations() - f.before.mutations,
    planning_requests: planning, apply_requests: calls.length, parent_write_apply_index: calls.findIndex(call => call === parentWrites(calls)[0]) + 1 } };
}

test('A-T1: the 84-row catch-up pass batches state commits by group', t => {
  const f = fixture(); const { result, stats } = measured(f);
  t.diagnostic(JSON.stringify(stats));
  assert.deepEqual(result.holds, []);
  assert.equal(stats.state_commits, 24);
  assert.equal(stats.github_writes, 35);
});

test('A-T2: the parent redraw precedes every queue write', () => {
  const f = fixture(); const { calls } = measured(f);
  const parent = calls.indexOf(parentWrites(calls)[0]);
  const queue = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.method === 'PATCH' && !call.path.endsWith('/issues/421'));
  assert.equal(queue.length, 34);
  assert.ok(queue.every(({ index }) => parent < index), 'parent before order and task page PATCHes');
});

test('A-T3: a short budget redraws all saved rows, reports the stop and resumes', () => {
  const f = fixture(); let elapsed = 0;
  f.github.intercept(() => { elapsed += 800; });
  const report = f.make(budget(() => Date.parse(NOW) + elapsed, 500000)).run({ apply: true });
  assert.ok(report.holds.some(entry => entry.code === 'PASS_STOPPED'));
  assert.equal(openStop(f)?.diagnostics.cause, 'time_limit');
  assert.equal((f.github.issues.get(421).body.match(/^\|[^\n]*\|#\d+\|/gm) || []).length, 84);
  assert.match(f.github.issues.get(421).body, /PASS_STOPPED #421: the last refresh stopped at/);
  assert.equal(f.github.calls.slice(f.before.calls).filter(call => call.method === 'PATCH' && !call.path.endsWith('/issues/421')).length, 0, 'queue skipped');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  f.make().run({ apply: true });
  assert.equal(openStop(f).state, 'resolved');
  assert.equal(f.make().run({ apply: true }).summary, 'No changes', 'resolved progress does not schedule endless attention folds');
  for (const argv of [['refresh', '--json'], ['attention', '--refresh', '--json'], ['reconcile', '--apply', '--controller', '--session', writer.session, '--json']]) {
    const short = fixture({ count: 2, added: 0 }); let ticks = 0;
    short.github.intercept(() => { ticks += 800; });
    assert.equal(cliRun(short, null, { refreshBudgetMs: 1, passClock: () => Date.parse(NOW) + ticks }, argv).code, 1, argv.join(' '));
    assert.equal(openStop(short).diagnostics.phase, 'planning');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-again-'));
  try {
    const next = fixture({ count: 1, added: 1 }); let elapsed = 0; let flagged = false;
    const file = path.join(dir, 'pass.lock');
    next.github.intercept(call => {
      if (!flagged && call.method === 'PATCH') {
        flagged = true; elapsed = 240001;
        fs.writeFileSync(cli.againFile(file), 'again');
      }
    });
    assert.equal(cliRun(next, file, { passClock: () => Date.parse(NOW) + elapsed }).code, 0, 'less than six minutes left does not start another pass');
    assert.equal(fs.existsSync(cli.againFile(file)), true, 'keep the flag for the next refresh');
    next.github.hooks = [];
    assert.equal(cliRun(next, file).code, 0);
    assert.equal(fs.existsSync(cli.againFile(file)), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function cliRun(f, lockFile, extra = {}, argv = ['refresh', '--json']) {
  let output = '';
  const code = cli.main(argv, { transport: f.github, binding: f.binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
    toolkitVersion: '3.56.1', now: () => NOW, passClock: () => Date.parse(NOW), lockFile, environment: {}, stdout: { write: text => { output += text; } }, ...extra });
  return { code, report: JSON.parse(output) };
}

const historyRequest = call => call.path === 'graphql' && call.body.query.includes('query ProgrammePullRequests');

for (const requestMs of [500, 750]) test(`verification at the measured 84-row footprint with ${requestMs} ms per request`, t => {
  const f = fixture();
  for (let number = 900; number < 1105; number++) {
    f.github.addPr(number, { head: 'a'.repeat(40), merged: true, mergedAt: '2026-11-01T00:00:00Z' });
  }
  f.github.prs.get(900).body = 'Refs #500';
  let elapsed = 0;
  f.github.intercept(() => { elapsed += requestMs; });
  const { code, report } = cliRun(f, null, { passClock: () => Date.parse(NOW) + elapsed });
  const calls = f.github.calls.slice(f.before.calls);
  const stats = {
    request_ms: requestMs,
    requests: calls.length,
    inventory_pages: calls.filter(call => call.path === 'graphql' && call.body.query.includes('issues(states: OPEN')).length,
    pr_history_pages: calls.filter(historyRequest).length,
    task_pr_batches: calls.filter(call => call.path === 'graphql' && call.body.query.includes('closedByPullRequestsReferences')).length,
    parent_write_request: calls.findIndex(call => call === parentWrites(calls)[0]) + 1,
    state_commits: f.github.commits - f.before.commits,
    github_writes: f.github.mutations() - f.before.mutations,
    elapsed_ms: elapsed,
  };
  t.diagnostic(JSON.stringify(stats));
  assert.equal(stats.pr_history_pages, 6);
  assert.equal(stats.task_pr_batches, 5);
  assert.ok(stats.parent_write_request > 0);
  if (requestMs === 500) {
    assert.equal(code, 0);
    assert.equal(report.outcome, 'COMPLETE');
    assert.ok(stats.elapsed_ms < state.REFRESH_BUDGET_MS - 120000, 'fits before the queue reserve');
  } else {
    assert.equal(code, 1);
    assert.equal(report.outcome, 'HELD');
    assert.ok(report.holds.some(hold => hold.code === 'PASS_STOPPED'));
    f.github.hooks = [];
    assert.equal(cliRun(f, null).report.outcome, 'COMPLETE');
  }
  assert.match(f.github.issues.get(500).body, /#900/);
  assert.match(f.github.issues.get(816).body, /BEGIN STATE/);
});

for (const requestMs of [500, 750]) test(`verification at the reported production footprint with ${requestMs} ms per request`, t => {
  const oldest = 900;
  const historyStart = Date.parse('2026-11-01T00:00:00Z');
  const f = fixture({ count: 66, added: 17, prepare(github, outcomes) {
    for (const { issue } of outcomes.slice(0, 40)) {
      Object.assign(github.issues.get(issue), { state: 'closed', state_reason: 'completed', closed_at: '2026-10-23T00:00:00Z' });
    }
    for (let index = 0; index < 643; index++) {
      const number = oldest + index;
      const date = new Date(historyStart + index * 60000).toISOString();
      const merged = index < 500;
      const issue = outcomes[index % outcomes.length].issue;
      const linked = index > 0 && index <= 480;
      github.addPr(number, { head: 'a'.repeat(40), state: 'CLOSED', merged, mergedAt: merged ? date : null,
        body: linked ? `Refs #${issue}` : 'Unrelated history' });
      Object.assign(github.prs.get(number), { updated_at: date, closedAt: date, ...(index === 0 ? { createdAt: '2000-01-02T00:00:00Z' } : {}) });
      if (linked && index % 3 === 0) {
        if (!github.issuePrLinks.has(issue)) github.issuePrLinks.set(issue, { timeline: [] });
        github.issuePrLinks.get(issue).timeline.push(number);
      }
    }
    github.addPr(1600, { head: 'a'.repeat(40), body: 'Refs #540' });
    github.addPr(1601, { head: 'b'.repeat(40), body: 'Unrelated open PR' });
  } });

  const readHistory = () => f.store.read('child', 500).doc.prs;
  const savedHistory = readHistory();
  assert.ok(savedHistory.length > 0, 'the task already has saved PR history');
  assert.ok(!savedHistory.some(entry => entry.number === oldest));
  const prior = f.store.read('parent', 421).doc.private.graph_pr_watermark;
  assert.equal(prior, NOW);
  // This previously unrelated PR acquired a task link while the sweep was away. Its reported
  // update time is still behind the old bookmark and older than every other closed PR.
  Object.assign(f.github.prs.get(oldest), { body: 'Refs #500', updated_at: new Date(historyStart + 30000).toISOString() });
  const prs = [...f.github.prs.values()];
  const size = { direct_children: f.github.issues.get(421).subs.length,
    open_issues: [...f.github.issues.values()].filter(issue => issue.state === 'open').length,
    merged_prs: prs.filter(pr => pr.merged).length,
    unmerged_closed_prs: prs.filter(pr => pr.state === 'CLOSED' && !pr.merged).length,
    open_prs: prs.filter(pr => pr.state === 'OPEN').length };
  assert.deepEqual(size, { direct_children: 83, open_issues: 44, merged_prs: 500, unmerged_closed_prs: 143, open_prs: 2 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-footprint-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lockFile = path.join(dir, 'pass.lock');

  function refresh(cost) {
    const start = f.github.calls.length;
    const writes = f.github.mutations();
    const commits = f.github.commits;
    let elapsed = 0;
    const oldestPages = [];
    f.github.intercept((call, github) => {
      elapsed += cost;
      if (!historyRequest(call)) return undefined;
      const response = github.route(call.method, call.path, call.body);
      if (response.json.data.repository.pullRequests.nodes.some(pr => pr.number === oldest)) {
        oldestPages.push(Number(call.body.variables.after || 0) / 100 + 1);
      }
      return response;
    });
    const { code, report } = cliRun(f, lockFile, { now: () => '2026-11-08T08:00:00Z', passClock: () => Date.parse(NOW) + elapsed });
    f.github.hooks = [];
    const calls = f.github.calls.slice(start);
    const count = predicate => calls.filter(predicate).length;
    const historyPages = count(historyRequest);
    const referenceBatches = count(call => call.path === 'graphql' && call.body.query.includes('closedByPullRequestsReferences'));
    const prDetails = count(call => call.path === 'graphql' && call.body.query.includes('pullRequest(number:'));
    const discoveryRequests = historyPages + referenceBatches + prDetails;
    t.diagnostic(JSON.stringify({ ...size, historical_body_links_before: 480, unrelated_closed_before: 163, timeline_links: 160,
      oldest_pr: oldest, oldest_pages: oldestPages, oldest_saved: readHistory().some(entry => entry.number === oldest),
      oldest_on_task_page: /#900\b/.test(f.github.issues.get(500).body), request_ms: cost, requests: calls.length, elapsed_ms: elapsed,
      inventory_pages: count(call => call.path === 'graphql' && call.body.query.includes('issues(states: OPEN')),
      pr_history_pages: historyPages, task_pr_batches: referenceBatches, pr_detail_reads: prDetails,
      discovery_requests: discoveryRequests, parent_write_request: calls.indexOf(parentWrites(calls)[0]) + 1,
      state_commits: f.github.commits - commits, github_writes: f.github.mutations() - writes,
      budget_ms: state.REFRESH_BUDGET_MS, queue_cutoff_ms: state.REFRESH_BUDGET_MS - 120000,
      code, outcome: report.outcome, holds: report.holds.map(hold => hold.code) }));
    assert.equal(report.inventory.counts.PARENT + report.inventory.counts.CHILD, 44);
    assert.equal(historyPages, 14);
    assert.deepEqual(oldestPages, [7, 7]);
    assert.ok(discoveryRequests <= 60);
    return { code, report };
  }

  const result = refresh(requestMs);
  if (requestMs === 750) {
    assert.equal(result.code, 1);
    assert.equal(result.report.outcome, 'HELD');
    assert.ok(result.report.holds.some(hold => hold.code === 'PASS_STOPPED'));
    const recovered = refresh(500);
    assert.equal(recovered.code, 0);
    assert.equal(recovered.report.outcome, 'COMPLETE');
  } else {
    assert.equal(result.code, 0);
    assert.equal(result.report.outcome, 'COMPLETE');
  }
  assert.equal(readHistory().find(entry => entry.number === oldest)?.state, 'MERGED');
  assert.match(f.github.issues.get(500).body, /#900\b/);
  assert.match(f.github.issues.get(816).body, /BEGIN STATE/);
});

test('A-T4: transport failure and a dead lock leave interrupted progress, then recover', () => {
  for (const mode of ['transport', 'dead_lock']) {
    const f = fixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-budget-'));
    const lockFile = path.join(dir, 'pass.lock');
    try {
      if (mode === 'transport') {
        let moves = 0;
        f.github.intercept(call => {
          if (call.method === 'PATCH' && call.path.includes('/sub_issues/priority') && ++moves === 5) throw Object.assign(new Error('transport interrupted'), { code: 'PASS_LOCK_LOST' });
        });
        assert.throws(() => cliRun(f, lockFile), { code: 'PASS_LOCK_LOST' });
        f.github.hooks = [];
        assert.equal(f.store.read('parent', 421).doc.pending_effects.filter(entry => entry.kind === 'reorder').length, 17, 'a pass-stopping error leaves the entire uncommitted group recoverable');
      } else {
        fs.writeFileSync(lockFile, JSON.stringify({ schema: 'toolkit.programme-pass-lock.v1', token: 'dead', pid: 987654, host: os.hostname(), at: NOW }));
        fs.writeFileSync(`${lockFile}.progress`, JSON.stringify({ token: 'dead', started_at: NOW, phase: 'order', done: 4, total: 17, unreported: true }));
      }
      assert.equal(fs.existsSync(`${lockFile}.progress`), true);
      const next = cliRun(f, lockFile, { pidAlive: () => false });
      assert.equal(next.code, 0);
      assert.deepEqual(openStop(f).diagnostics, { cause: 'interrupted', phase: 'order', done: 4, total: 17, started_at: mode === 'transport' ? openStop(f).diagnostics.started_at : NOW });
      assert.equal(openStop(f).state, 'new');
      assert.match(f.github.issues.get(421).body, /stopped at order \(4 of 17 done\)/);
      assert.equal(f.store.read('parent', 421).doc.pending_effects.length, 0);
      assert.equal(fs.existsSync(`${lockFile}.progress`), false);
      assert.equal(cliRun(f, lockFile).code, 0);
      assert.equal(openStop(f).state, 'resolved');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('A-T5: planning exhaustion writes one finding commit and no page or queue', () => {
  const f = fixture(); let elapsed = 0;
  f.github.intercept(() => { elapsed += 800; });
  const report = f.make(budget(() => Date.parse(NOW) + elapsed, 20000)).run({ apply: true });
  assert.equal(f.github.commits - f.before.commits, 1);
  assert.equal(f.github.mutations() - f.before.mutations, 0);
  assert.equal(report.holds[0].code, 'PASS_STOPPED');
  assert.equal(openStop(f).diagnostics.phase, 'planning');
});

test('A-T6: stopped passes retain size findings, parent lifecycle and watermark', () => {
  const f = fixture({ count: 1, added: 0 });
  const finding = { code: 'BODY_TOO_LARGE', issue: 421, diagnostics: state.bodySizeDiagnostics('x'.repeat(60000), 60000) };
  f.store.mutate('parent', 421, { writer, change: doc => { doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [finding], now: NOW }); return doc; } });
  const r = f.make(budget(() => Date.parse(NOW), 170000)); const plan = r.plan();
  plan.effects.push({ kind: 'set_parent_state', target: { issue: 421, state: 'closed', expected: 'open' } },
    { kind: 'advance_pr_watermark', target: { issue: 421 }, watermark: '2026-11-09T00:00:00Z' });
  const prior = f.store.read('parent', 421).doc.private.graph_pr_watermark;
  const result = r.apply(plan);
  assert.ok(result.holds.some(entry => entry.code === 'PASS_STOPPED'));
  assert.equal(f.store.read('parent', 421).doc.attention.find(entry => entry.code === 'BODY_TOO_LARGE').state, 'new');
  assert.equal(f.github.issues.get(421).state, 'open');
  assert.equal(f.store.read('parent', 421).doc.private.graph_pr_watermark, prior);
  const retry = fixture({ count: 1, added: 0 });
  retry.store.mutate('parent', 421, { writer, change: doc => {
    doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, now: NOW,
      seen: [{ code: 'PASS_STOPPED', issue: 421, diagnostics: { cause: 'interrupted', phase: 'order', done: 0, total: 1, started_at: NOW } }] });
    return doc;
  } });
  let resolving = false; let failed = false;
  retry.github.intercept(call => {
    if (call.method === 'PATCH' && call.path.endsWith('/issues/421') && !call.body.body.includes('PASS_STOPPED #421')) resolving = true;
    if (resolving && !failed && call.method === 'GET' && call.path.endsWith('/issues/421')) {
      failed = true; return { status: 502, json: { message: 'lost final redraw readback' } };
    }
  });
  assert.ok(retry.make().run({ apply: true }).holds.some(entry => entry.code === 'EFFECT_UNKNOWN'));
  assert.equal(openStop(retry).state, 'new', 'a failed final redraw cannot resolve an interrupted pass');
  retry.github.hooks = [];
  assert.deepEqual(retry.make().run({ apply: true }).holds, []);
  assert.equal(openStop(retry).state, 'resolved');
});

test('A-T7: a crashed batch recovers each intent; UNKNOWN holds only its scope', () => {
  const f = fixture({ count: 2, added: 2 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-crash-'));
  const lockFile = path.join(dir, 'pass.lock');
  try {
    let failed = false;
    f.github.intercept(call => { if (!failed && call.method === 'PATCH' && call.path.includes('/sub_issues/priority')) { failed = true; throw Object.assign(new Error('batch interrupted before mutation'), { code: 'PASS_LOCK_LOST' }); } });
    assert.throws(() => cliRun(f, lockFile), { code: 'PASS_LOCK_LOST' });
    const saved = f.store.read('parent', 421).doc;
    assert.equal(saved.pending_effects.filter(entry => entry.kind === 'reorder').length, 2);
    f.github.hooks = [];
    f.github.issues.get(421).subs.reverse(); // Neither saved relative move is now present.
    const plan = f.make().plan();
    assert.equal(plan.resolutions.filter(entry => entry.outcome === 'NOT_DONE').length, 2, JSON.stringify({ intents: saved.pending_effects, resolutions: plan.resolutions }));
    assert.ok(plan.resolutions.every(entry => entry.kind === 'parent'));
    assert.equal(cliRun(f, lockFile).code, 0);
    assert.deepEqual(openStop(f).diagnostics, { cause: 'interrupted', phase: 'order', done: 0, total: 2, started_at: NOW });
    assert.equal(openStop(f).state, 'new');
    assert.equal(f.store.read('parent', 421).doc.pending_effects.length, 0);
    assert.equal(cliRun(f, lockFile).code, 0);
    assert.equal(openStop(f).state, 'resolved');
    // A lost task body readback is a body hold, while its native parent link remains independent.
    const doc = f.store.read('child', 800).doc;
    f.store.mutate('child', 800, { writer, parentDoc: saved, change: d => { d.pending_effects.push({ intent_id: 'old-child', kind: 'replace_block', target: { issue: 800, digest: 'missing' }, state: 'UNKNOWN' }); return d; } });
    const observed = { issues: new Map([[800, null]]), subIssues: new Map(), comments: new Map() };
    const holds = [];
    assert.equal(f.make().recover([{ kind: 'child', number: 800, doc: f.store.read('child', 800).doc }], observed, holds)[0].outcome, 'UNKNOWN');
    assert.deepEqual(holds.map(entry => entry.scope), ['body']);
    assert.ok(doc);
    f.github.issues.get(800).parent = null;
    f.github.issues.get(800).body = '';
    f.github.issues.get(801).body = '';
    f.github.issues.get(421).subs = f.github.issues.get(421).subs.filter(number => number !== 800);
    const run = f.make(); const heldPlan = run.plan(); heldPlan.holds.push(...holds);
    const applied = run.apply(heldPlan);
    assert.ok(applied.results.some(entry => entry.kind === 'attach' && entry.target.issue === 800 && entry.outcome === 'DONE'), 'body UNKNOWN leaves its native links usable');
    assert.ok(applied.results.some(entry => entry.kind === 'replace_block' && entry.target.issue === 800 && entry.outcome === 'SKIPPED'));
    assert.ok(applied.results.some(entry => entry.kind === 'replace_block' && entry.target.issue === 801 && entry.outcome === 'DONE'), 'unrelated task pages still run');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Closure rows: issue-scoped apply x attention unchanged/changed must keep an unreported
// predecessor; a subsequent full refresh owns reporting and only a later full pass resolves it.
for (const attentionChange of [false, true]) test(`H1: issue-scoped apply preserves interrupted progress, attention change ${attentionChange}`, () => {
  const f = fixture({ count: 1, added: 0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-scoped-'));
  const lockFile = path.join(dir, 'pass.lock');
  const interrupted = { cause: 'interrupted', phase: 'order', done: 4, total: 17, started_at: NOW };
  try {
    const { cause, ...note } = interrupted;
    fs.writeFileSync(`${lockFile}.progress`, JSON.stringify({ ...note, token: 'dead', unreported: true }));
    if (attentionChange) f.github.issues.get(500).body += 'x'.repeat(60000);
    const scoped = cliRun(f, lockFile, {}, ['reconcile', '--apply', '--controller', '--session', writer.session, '--issue', '500', '--json']);
    assert.equal(scoped.report.results.some(entry => entry.kind === 'update_attention'), attentionChange);
    assert.equal(fs.existsSync(`${lockFile}.progress`), true, 'an unrelated attention write is not a report of the predecessor');
    if (attentionChange) f.github.issues.get(500).body = '';
    assert.equal(cliRun(f, lockFile).code, 0);
    assert.deepEqual(openStop(f).diagnostics, interrupted);
    assert.equal(openStop(f).state, 'new');
    assert.equal(fs.existsSync(`${lockFile}.progress`), false);
    assert.equal(cliRun(f, lockFile).code, 0);
    assert.equal(openStop(f).state, 'resolved');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// I8 closure: an answered stop cannot hide a later event. Resolved stops retain their
// existing reopen rule; identical open reports do not change the entry or its timestamps.
for (const row of [
  { prior: 'disposed', cause: 'interrupted' },
  { prior: 'disposed', cause: 'time_limit' },
  { prior: 'acknowledged', cause: 'time_limit' },
  { prior: 'resolved', cause: 'interrupted' },
]) test(`N1: ${row.prior}, then ${row.cause}, reports a new stop`, () => {
  const f = fixture({ count: 2, added: 0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-reopen-'));
  const lockFile = path.join(dir, 'pass.lock');
  const attentionDir = path.join(dir, 'attention');
  const oldTime = '2026-11-07T23:00:00.000Z';
  const oldDiagnostics = { cause: 'time_limit', phase: 'planning', done: 0, total: 0, started_at: oldTime };
  try {
    f.store.mutate('parent', 421, { writer, change: doc => {
      doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, now: oldTime,
        seen: [{ code: 'PASS_STOPPED', issue: 421, diagnostics: oldDiagnostics }] });
      if (row.prior === 'resolved') doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: true, now: oldTime });
      else doc = state.answerFinding(doc, { id: doc.attention.find(entry => entry.code === 'PASS_STOPPED').id,
        state: row.prior, reason: 'Fixture previous stop answered', now: oldTime });
      return doc;
    } });
    assert.equal(openStop(f).state, row.prior);
    let elapsed = 0;
    const expected = row.cause === 'interrupted'
      ? { cause: 'interrupted', phase: 'task_pages', done: 7, total: 30, started_at: NOW }
      : { cause: 'time_limit', phase: 'task_pages', done: 1, total: 2, started_at: NOW };
    if (row.cause === 'interrupted') {
      fs.writeFileSync(lockFile, JSON.stringify({ schema: 'toolkit.programme-pass-lock.v1', token: 'dead', pid: 987654, host: os.hostname(), at: NOW }));
      const { cause, ...note } = expected;
      fs.writeFileSync(`${lockFile}.progress`, JSON.stringify({ ...note, token: 'dead', unreported: true }));
    } else {
      for (const number of [500, 501]) f.github.issues.get(number).body = '';
      f.github.intercept(call => {
        if (call.method === 'PATCH' && call.path.endsWith('/issues/500')) elapsed = 480001;
      });
    }
    const report = cliRun(f, lockFile, { pidAlive: () => false, passClock: () => Date.parse(NOW) + elapsed, attentionDir });
    assert.equal(report.code, row.cause === 'interrupted' ? 0 : 1);
    const entry = openStop(f);
    assert.equal(entry.state, 'new', 'each different stop needs a new controller answer');
    assert.deepEqual(entry.diagnostics, expected);
    assert.equal(entry.changed_at, NOW);
    assert.equal(fs.existsSync(`${lockFile}.progress`), false, 'the reported progress note is removed');
    const listed = cliRun(f, lockFile, { attentionDir }, ['attention', '--json']).report;
    assert.equal(listed.findings.find(item => item.id === entry.id).state, 'new');
    assert.deepEqual(listed.counts, { new: 1, acknowledged: 0 });
    assert.match(listed.line, /^Attention: 1 new, 0 acknowledged/);
    const current = f.github.issues.get(421).body;
    assert.match(current, /\*\*Attention: 1 new, 0 acknowledged\*\*/);
    assert.ok(current.includes(`- ${state.findingText(entry)}`), 'CURRENT shows the reopened stop without an acknowledged label');
    const cacheDeps = { attentionDir, now: () => NOW };
    assert.deepEqual(attentionCache.readCache(f.binding.repository, cacheDeps).counts, listed.counts);
    assert.match(attentionCache.sessionAttention(f.binding.repository, cacheDeps).line, /^Attention: 1 new, 0 acknowledged\. Run programme\.cjs attention/);
    const parent = f.store.read('parent', 421).doc;
    assert.deepEqual(state.validateParent(parent), []);
    const Ajv = require('ajv/dist/2020');
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'), 'utf8'));
    const validate = new Ajv({ strict: false }).compile(schema);
    assert.equal(validate(parent), true, JSON.stringify(validate.errors));
    const repeat = { source: 'reconcile', complete: false, now: '2026-11-08T01:00:00.000Z',
      seen: [{ code: 'PASS_STOPPED', issue: 421, diagnostics: { ...expected } }] };
    assert.equal(state.foldAttention(parent.attention, repeat), parent.attention, 'an identical open report causes no churn');
    if (row.prior !== 'resolved') {
      const answered = state.answerFinding(parent, { id: entry.id, state: row.prior, reason: 'Fixture repeated report answered', now: NOW });
      assert.equal(state.foldAttention(answered.attention, repeat), answered.attention, 'an identical report does not reopen an answered event');
    } else {
      const resolved = state.foldAttention(parent.attention, { source: 'reconcile', complete: true, now: NOW });
      assert.equal(state.foldAttention(resolved, repeat).find(item => item.id === entry.id).state, 'new', 'resolved-then-seen still reopens, even with identical diagnostics');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// I8 persistence closure: the commit, its reply and the controller's answer are separate events.
for (const scoped of [false, true]) for (const row of [
  { failure: 'lost_reply', answer: 'disposed' },
  { failure: 'lost_reply', answer: 'acknowledged' },
  { failure: 'crash_after_commit', answer: 'disposed' },
]) test(`N2: ${row.failure}, ${row.answer}, ${scoped ? 'issue-scoped' : 'full'} recovery frees the next kill`, () => {
  const f = fixture({ count: 1, added: 0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-saved-stop-'));
  const lockFile = path.join(dir, 'pass.lock');
  const oldTime = '2026-11-04T00:00:00.123Z';
  const interrupted = { cause: 'interrupted', phase: 'task_pages', done: 7, total: 30, started_at: oldTime };
  const { cause, ...note } = interrupted;
  let landed = false; let injected = false;
  try {
    fs.writeFileSync(`${lockFile}.progress`, JSON.stringify({ ...note, token: 'dead', unreported: true }));
    f.github.intercept(call => {
      // The lost-reply outage ends this pass before any later fresh read could confirm the commit.
      if (landed && injected && row.failure === 'lost_reply' && call.method === 'GET'
        && call.path.startsWith(`${f.store.contentsPath('parent', 421)}?ref=`)) {
        return { status: 502, json: { message: 'fixture transport still unavailable' } };
      }
      if (!landed && call.method === 'PUT' && call.body?.content) {
        const doc = JSON.parse(Buffer.from(call.body.content, 'base64').toString('utf8'));
        if (doc.attention?.some(entry => entry.code === 'PASS_STOPPED' && entry.diagnostics.started_at === oldTime)) {
          const response = f.github.route(call.method, call.path, call.body);
          assert.equal(response.status, 200);
          landed = true;
          if (row.failure === 'lost_reply') { injected = true; return { status: 502, json: { message: 'fixture lost commit reply' } }; }
          return response;
        }
      }
      if (landed && !injected && row.failure === 'crash_after_commit' && call.method === 'GET'
        && call.path.startsWith(`${f.store.contentsPath('parent', 421)}?ref=`) && !call.path.endsWith('ref=main')) {
        assert.equal(f.github.route(call.method, call.path, call.body).status, 200);
        injected = true;
        throw Object.assign(new Error('fixture crash after committed readback, before reported'), { code: 'PASS_LOCK_LOST' });
      }
    });
    const earlier = { now: () => oldTime, passClock: () => Date.parse(oldTime) };
    if (row.failure === 'lost_reply') assert.throws(() => cliRun(f, lockFile, earlier), { code: 'GH_FAILED' });
    else assert.throws(() => cliRun(f, lockFile, earlier), { code: 'PASS_LOCK_LOST' });
    assert.equal(landed, true);
    assert.equal(injected, true);
    f.github.hooks = [];
    assert.equal(openStop(f).state, 'new');
    assert.deepEqual(openStop(f).diagnostics, interrupted);
    assert.equal(fs.existsSync(`${lockFile}.progress`), true, 'landed commit alone cannot acknowledge a lost reply or crash');
    f.store.mutate('parent', 421, { writer, change: doc => state.answerFinding(doc, {
      id: doc.attention.find(entry => entry.code === 'PASS_STOPPED').id, state: row.answer, reason: 'Fixture saved stop answered', now: oldTime,
    }) });
    // An independent redraw after disposal leaves no page work to accidentally trigger recovery.
    // It has no local progress object, so it cannot report this lock owner's note.
    if (row.answer === 'disposed') assert.deepEqual(f.make().run({ apply: true }).holds, []);
    const recovered = cliRun(f, lockFile, {}, scoped
      ? ['reconcile', '--apply', '--controller', '--session', writer.session, '--issue', '500', '--json']
      : ['refresh', '--json']);
    assert.equal(recovered.code, 0);
    if (row.answer === 'disposed') {
      assert.equal(recovered.report.effects.length, 0, `exercise the no-effects route: ${JSON.stringify(recovered.report.effects)}`);
      assert.equal(recovered.report.summary, 'No changes');
      assert.deepEqual(recovered.report.writes, { state: 0, github: 0 });
    }
    assert.equal(fs.existsSync(`${lockFile}.progress`), false, 'the stored exact match clears regardless of finding state or planned effects');
    assert.equal(cliRun(f, lockFile).code, 0);
    assert.equal(fs.existsSync(`${lockFile}.progress`), false, 'the next full refresh has no predecessor debt');

    // A later real pass dies in its own task-page phase. Its note must replace the predecessor.
    f.github.issues.get(500).body = '';
    const killedAt = '2026-11-08T01:00:00.456Z';
    let killed = false;
    f.github.intercept(call => {
      if (!killed && call.method === 'PATCH' && call.path.endsWith('/issues/500')) {
        killed = true;
        throw Object.assign(new Error('fixture later kill'), { code: 'PASS_LOCK_LOST' });
      }
    });
    assert.throws(() => cliRun(f, lockFile, { now: () => killedAt, passClock: () => Date.parse(killedAt) }), { code: 'PASS_LOCK_LOST' });
    assert.equal(killed, true);
    const laterNote = JSON.parse(fs.readFileSync(`${lockFile}.progress`, 'utf8'));
    const later = { cause: 'interrupted', phase: 'task_pages', done: 0, total: 1, started_at: killedAt };
    assert.deepEqual({ cause: 'interrupted', phase: laterNote.phase, done: laterNote.done, total: laterNote.total, started_at: laterNote.started_at }, later);
    f.github.hooks = [];
    const refreshedAt = '2026-11-08T02:00:00.000Z';
    assert.equal(cliRun(f, lockFile, { now: () => refreshedAt, passClock: () => Date.parse(refreshedAt) }).code, 0);
    assert.equal(openStop(f).state, 'new');
    assert.deepEqual(openStop(f).diagnostics, later);
    assert.equal(openStop(f).changed_at, refreshedAt);
    assert.equal(fs.existsSync(`${lockFile}.progress`), false);
    assert.ok(f.github.issues.get(421).body.includes(`- ${state.findingText(openStop(f))}`), 'CURRENT shows the later kill with its own full details');
    assert.deepEqual(cliRun(f, lockFile, {}, ['attention', '--json']).report.counts, { new: 1, acknowledged: 0 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const savedState of ['new', 'acknowledged', 'disposed', 'resolved'])
  test(`N2: scoped ${savedState} evidence must match even the start-time milliseconds`, () => {
    const f = fixture({ count: 1, added: 0 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-exact-stop-'));
    const lockFile = path.join(dir, 'pass.lock');
    const saved = { cause: 'interrupted', phase: 'links', done: 2, total: 5, started_at: '2026-11-08T00:00:00.123Z' };
    const interrupted = { ...saved, started_at: '2026-11-08T00:00:00.124Z' };
    const scoped = ['reconcile', '--apply', '--controller', '--session', writer.session, '--issue', '500', '--json'];
    try {
      f.store.mutate('parent', 421, { writer, change: doc => {
        doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, now: NOW,
          seen: [{ code: 'PASS_STOPPED', issue: 421, diagnostics: saved }] });
        doc.attention.find(entry => entry.code === 'PASS_STOPPED').state = savedState;
        return doc;
      } });
      const { cause, ...note } = interrupted;
      fs.writeFileSync(`${lockFile}.progress`, JSON.stringify({ ...note, token: 'dead', unreported: true }));
      assert.equal(cliRun(f, lockFile, {}, scoped).code, 0);
      assert.equal(fs.existsSync(`${lockFile}.progress`), true, 'a one-millisecond mismatch is not persistence evidence');
      assert.deepEqual(openStop(f).diagnostics, saved, 'scoped apply does not fold an unreported parent stop');
      // The controller saves the exact event between passes; the next scoped read must see it.
      f.store.mutate('parent', 421, { writer, change: doc => {
        doc.attention.find(entry => entry.code === 'PASS_STOPPED').diagnostics = interrupted;
        return doc;
      } });
      assert.equal(cliRun(f, lockFile, {}, ['reconcile', '--issue', '500', '--json']).code, 0);
      assert.equal(fs.existsSync(`${lockFile}.progress`), true, 'a dry run cannot clear the note');
      const report = cliRun(f, lockFile, {}, scoped).report;
      assert.equal(report.results.some(entry => entry.kind === 'update_attention'), false);
      assert.equal(fs.existsSync(`${lockFile}.progress`), false, 'fresh exact stored evidence clears without an attention job');
      assert.equal(openStop(f).state, savedState);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

for (const prior of ['acknowledged', 'disposed', 'resolved']) test(`N3: a days-old ${prior} stop reopens with full CURRENT details`, () => {
  const f = fixture({ count: 1, added: 0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-new-stop-'));
  const lockFile = path.join(dir, 'pass.lock');
  const oldTime = '2026-11-04T00:00:00.000Z';
  try {
    f.store.mutate('parent', 421, { writer, change: doc => {
      doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, now: oldTime,
        seen: [{ code: 'PASS_STOPPED', issue: 421, diagnostics: { cause: 'time_limit', phase: 'planning', done: 0, total: 0, started_at: oldTime } }] });
      if (prior === 'resolved') doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: true, now: oldTime });
      else doc = state.answerFinding(doc, { id: doc.attention[0].id, state: prior, reason: 'Fixture old stop answered', now: oldTime });
      return doc;
    } });
    const expected = { cause: 'interrupted', phase: 'task_pages', done: 7, total: 30, started_at: NOW };
    const { cause, ...note } = expected;
    fs.writeFileSync(`${lockFile}.progress`, JSON.stringify({ ...note, token: 'dead', unreported: true }));
    assert.equal(cliRun(f, lockFile).code, 0);
    const entry = openStop(f);
    assert.equal(entry.state, 'new');
    assert.equal(entry.first_seen, oldTime);
    assert.equal(entry.changed_at, NOW);
    assert.deepEqual(entry.diagnostics, expected);
    assert.ok(f.github.issues.get(421).body.includes(`- ${state.findingText(entry)}`), 'a reopened stop retains the phase and counts in CURRENT');
    assert.doesNotMatch(f.github.issues.get(421).body, /waiting on you/i);
    assert.equal(fs.existsSync(`${lockFile}.progress`), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// All finding codes share the same new-state clock. An unchanged observation never resets it.
for (const [code, source] of [['CHECKS_RED', 'reconcile'], ['CHILD_ADDED', 'reconcile'], ['NEEDS_PLACEMENT', 'inventory']])
  test(`N3: ${code} waits 24 hours from becoming new, unchanged reports keep that age`, () => {
    const seen = [{ code, issue: 500 }];
    const first = state.foldAttention([], { source, seen, complete: false, now: '2026-11-04T00:00:00.000Z' });
    const resolved = state.foldAttention(first, { source, complete: true, now: '2026-11-05T00:00:00.000Z' });
    const reopened = state.foldAttention(resolved, { source, seen, complete: false, now: NOW });
    assert.doesNotMatch(state.attentionLine(reopened, NOW), /waiting on you/);
    const unchanged = state.foldAttention(reopened, { source, seen, complete: false, now: '2026-11-08T23:59:59.999Z' });
    assert.equal(unchanged, reopened);
    assert.doesNotMatch(state.attentionLine(unchanged, '2026-11-08T23:59:59.999Z'), /waiting on you/);
    assert.match(state.attentionLine(unchanged, '2026-11-09T00:00:00.000Z'), /1 waiting on you/);
  });

test('M1: one task read-back 502 holds only that task and writes the other pages', () => {
  const f = fixture({ count: 4, added: 0 });
  for (let number = 500; number < 504; number++) f.github.issues.get(number).body = '';
  let written = false; let failed = false;
  f.github.intercept(call => {
    if (call.method === 'PATCH' && call.path.endsWith('/issues/500')) written = true;
    if (written && !failed && call.method === 'GET' && call.path.endsWith('/issues/500')) {
      failed = true; return { status: 502, json: { message: 'fixture read-back failure' } };
    }
  });
  const report = f.make().run({ apply: true });
  assert.equal(failed, true);
  assert.deepEqual(report.holds.map(entry => [entry.code, entry.target, entry.scope]), [['EFFECT_UNKNOWN', '#500', 'body']]);
  assert.equal(report.results.find(entry => entry.kind === 'replace_block' && entry.target.issue === 500).outcome, 'UNKNOWN');
  for (const number of [501, 502, 503]) assert.equal(report.results.find(entry => entry.kind === 'replace_block' && entry.target.issue === number)?.outcome, 'DONE', `#${number} still written`);
  assert.deepEqual(f.store.read('parent', 421).doc.pending_effects.map(entry => [entry.kind, entry.target.issue, entry.state]), [['replace_block', 500, 'UNKNOWN']]);
});

for (const variant of ['unrelated_hold', 'time_stop']) test(`M2: a repair notice survives ${variant} until a later pass posts it`, () => {
  const f = fixture({ count: 1, added: 0 });
  Object.assign(f.binding, { schema: state.SCHEMA.bindingV2, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'TEST-' }] });
  f.binding.parent_lifecycle = { reopen_incomplete: true };
  Object.assign(f.github.issues.get(421), { state: 'closed', events: [{ id: 10, event: 'closed', created_at: NOW, actor: { login: 'fixture-owner' }, commit_id: null }] });
  let failed = false;
  f.github.intercept(call => {
    if (!failed && call.method === 'POST' && call.path.endsWith('/issues/421/comments') && call.body.body.includes('toolkit-parent-repair:')) {
      failed = true; return { status: 502, json: { message: 'fixture notice failure' } };
    }
  });
  assert.ok(f.make().run({ apply: true }).holds.length);
  assert.equal(f.github.issues.get(421).state, 'open');
  const owed = () => f.store.read('parent', 421).doc.pending_effects.filter(entry => entry.kind === 'post_parent_repair');
  const notices = () => f.github.commentsOf(421).filter(entry => entry.body.includes('toolkit-parent-repair:'));
  assert.equal(owed().length, 1);
  f.github.hooks = [];
  let elapsed = 0;
  const pass = budget(() => Date.parse(NOW) + elapsed);
  const run = f.make(pass); const plan = run.plan();
  assert.ok(plan.resolutions.some(entry => entry.intent_id === owed()[0].intent_id && entry.outcome === 'NOT_DONE'));
  if (variant === 'unrelated_hold') plan.holds.push({ code: 'EFFECT_UNKNOWN', target: '#500', scope: 'pr', detail: 'fixture unrelated hold' });
  else elapsed = 550001;
  run.apply(plan);
  assert.equal(notices().length, 0);
  assert.equal(owed().length, 1, 'NOT_DONE is still owed when lifecycle was skipped');
  if (variant === 'time_stop') assert.notEqual(openStop(f).state, 'resolved');
  // Even another complete inventory cannot resolve a stop while a lifecycle hold keeps the notice owed.
  const heldRun = f.make(); const heldPlan = heldRun.plan();
  heldPlan.holds.push({ code: 'EFFECT_UNKNOWN', target: '#421', scope: 'lifecycle', detail: 'fixture lifecycle hold' });
  heldRun.apply(heldPlan);
  assert.equal(owed().length, 1);
  if (variant === 'time_stop') assert.notEqual(openStop(f).state, 'resolved');
  if (variant === 'time_stop') {
    const permission = f.binding.parent_lifecycle;
    delete f.binding.parent_lifecycle;
    assert.deepEqual(f.make().run({ apply: true }).holds, []);
    assert.equal(owed().length, 1, 'a missing repair permission keeps the debt without posting');
    assert.notEqual(openStop(f).state, 'resolved', 'an otherwise complete pass cannot resolve a stop while a notice is owed');
    f.binding.parent_lifecycle = permission;
  }
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(notices().length, 1);
  assert.equal(owed().length, 0);
  if (variant === 'time_stop') assert.equal(openStop(f).state, 'resolved');
  f.make().run({ apply: true });
  assert.equal(notices().length, 1, 'read-back prevents duplicate notices');
});

// The stop clock is phase/count driven, independent of request latency or real elapsed time.
for (const row of [
  { phase: 'links', done: 1, total: 2 }, { phase: 'order', done: 1, total: 2 },
  { phase: 'pr_links', done: 1, total: 2 }, { phase: 'task_pages', done: 1, total: 2 },
  { phase: 'lifecycle', done: 0, total: 2 },
]) test(`M3: a queue stop at ${row.phase} redraws CURRENT in the same pass`, () => {
  const f = fixture({ count: 2, added: 2 });
  if (row.phase === 'links') for (const number of [500, 501]) {
    f.github.issues.get(number).parent = null;
    f.github.issues.get(421).subs = f.github.issues.get(421).subs.filter(n => n !== number);
  }
  let stopped = false; let pass;
  pass = budget(() => {
    if (pass?.phase === row.phase && pass.done >= row.done) stopped = true;
    return Date.parse(NOW) + (stopped ? 480001 : 0);
  });
  const run = f.make(pass); const plan = run.plan();
  if (row.phase === 'pr_links') for (const [number, pr] of [[500, 900], [501, 901]]) {
    f.github.addPr(pr, { head: 'a'.repeat(40) });
    plan.effects.push({ kind: 'replace_pr_nav', target: { issue: number, pr, digest: 'fixture' }, body: 'Fixture PR navigation' });
  }
  const size = { code: 'BODY_TOO_LARGE', issue: 421, diagnostics: state.bodySizeDiagnostics('x'.repeat(60000), 60000) };
  f.store.mutate('parent', 421, { writer, change: doc => {
    doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [size], now: NOW }); return doc;
  } });
  plan.effects.push({ kind: 'set_parent_state', target: { issue: 421, state: 'closed', expected: 'open' } },
    { kind: 'post_parent_repair', target: { issue: 421, marker: '<!-- fixture-notice -->', body: 'Fixture notice' } },
    { kind: 'advance_pr_watermark', target: { issue: 421 }, watermark: '2026-11-09T00:00:00Z' });
  const watermark = f.store.read('parent', 421).doc.private.graph_pr_watermark;
  const result = run.apply(plan);
  assert.equal(stopped, true);
  assert.ok(result.holds.some(entry => entry.code === 'PASS_STOPPED'));
  assert.deepEqual(openStop(f).diagnostics, { cause: 'time_limit', phase: row.phase, done: row.done, total: row.total, started_at: NOW });
  assert.match(f.github.issues.get(421).body, new RegExp(`stopped at ${row.phase.replace('_', ' ')} \\(${row.done} of ${row.total} done\\)`));
  assert.equal(f.github.issues.get(421).state, 'open', 'lifecycle skipped');
  assert.equal(f.github.commentsOf(421).some(entry => entry.body === 'Fixture notice'), false);
  assert.equal(f.store.read('parent', 421).doc.private.graph_pr_watermark, watermark);
  assert.notEqual(f.store.read('parent', 421).doc.attention.find(entry => entry.code === 'BODY_TOO_LARGE').state, 'resolved');
});

test('A-T8: stopped-pass diagnostics are closed and validated in the reader and schema', () => {
  const Ajv = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  const parent = state.newParent({ repository: 'example.test/app', parentIssue: 421, outcomes: [] });
  const diagnostics = { cause: 'time_limit', phase: 'task_pages', done: 34, total: 61, started_at: NOW };
  const make = d => ({ ...parent, attention: [{ id: state.findingId('reconcile', 'PASS_STOPPED', 421), source: 'reconcile', code: 'PASS_STOPPED', issue: 421, head: null,
    state: 'new', first_seen: NOW, changed_at: NOW, diagnostics: d }] });
  assert.deepEqual(state.validateParent(make(diagnostics)), []);
  assert.equal(validate(make(diagnostics)), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...make(diagnostics), pending_effects: [{ intent_id: 'pr-nav', kind: 'replace_pr_nav', target: { issue: 500, pr: 600, digest: 'saved' }, state: 'IN_FLIGHT' }] }), true);
  for (const patch of [{ cause: 'timeout' }, { phase: 'tasks' }, { done: -1 }, { done: 1.5 }, { total: Number.MAX_SAFE_INTEGER + 1 }, { started_at: 'yesterday' }, { private: 'text' }]) {
    const doc = make({ ...diagnostics, ...patch });
    assert.ok(state.validateParent(doc).length, JSON.stringify(patch));
    assert.equal(validate(doc), false, JSON.stringify(patch));
  }
  for (const key of Object.keys(diagnostics)) { const d = { ...diagnostics }; delete d[key]; assert.ok(state.validateParent(make(d)).length); assert.equal(validate(make(d)), false); }
  assert.ok(state.validateParent(make({ ...diagnostics, total: 33 })).length, 'runtime enforces total >= done');
  assert.equal(state.findingText(make(diagnostics).attention[0]), 'PASS_STOPPED #421: the last refresh stopped at task pages (34 of 61 done); the next refresh picks up the rest');
});
