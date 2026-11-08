'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const writer = { session: 'fixture-controller', prefix: 'TEST-' };
const NOW = '2026-11-08T00:00:00.000Z';
const budget = (clock, ms) => state.RefreshBudget ? new state.RefreshBudget({ nowMs: clock, budgetMs: ms }) : undefined;
const openStop = f => f.store.read('parent', 421).doc.attention?.find(entry => entry.code === 'PASS_STOPPED');
const parentWrites = calls => calls.filter(call => call.method === 'PATCH' && call.path.endsWith('/issues/421') && call.body.body);

// Sixty-seven settled tasks, then seventeen native additions placed before them. The next pass
// adopts 17 tasks, makes 17 order moves and writes 18 bodies. Setup writes are outside the counts.
function fixture({ count = 67, added = 17 } = {}) {
  const repository = 'example.test/app';
  const github = new FakeGitHub({ repository, store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n\n## CURRENT\nHand-written notes.\n' });
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
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

test('A-T4: transport failure and a dead lock leave interrupted progress, then recover', () => {
  for (const mode of ['transport', 'dead_lock']) {
    const f = fixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-budget-'));
    const lockFile = path.join(dir, 'pass.lock');
    try {
      if (mode === 'transport') {
        let moves = 0;
        f.github.intercept(call => {
          if (call.method === 'PATCH' && call.path.includes('/sub_issues/priority') && ++moves === 5) throw new Error('transport interrupted');
        });
        assert.equal(cliRun(f, lockFile).code, 1);
        f.github.hooks = [];
        assert.equal(f.store.read('parent', 421).doc.pending_effects.filter(entry => entry.kind === 'reorder').length, 13);
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
  let failed = false;
  f.github.intercept(call => { if (!failed && call.method === 'PATCH' && call.path.includes('/sub_issues/priority')) { failed = true; throw new Error('batch interrupted before mutation'); } });
  assert.ok(f.make().run({ apply: true }).holds.some(entry => entry.code === 'EFFECT_UNKNOWN'));
  const saved = f.store.read('parent', 421).doc;
  assert.equal(saved.pending_effects.filter(entry => entry.kind === 'reorder').length, 2);
  f.github.hooks = [];
  f.github.issues.get(421).subs.reverse(); // Neither saved relative move is now present.
  const plan = f.make().plan();
  assert.equal(plan.resolutions.filter(entry => entry.outcome === 'NOT_DONE').length, 2, JSON.stringify({ intents: saved.pending_effects, resolutions: plan.resolutions }));
  assert.ok(plan.resolutions.every(entry => entry.kind === 'parent'));
  // A lost task body readback is a body hold, while its native parent link remains independent.
  const doc = f.store.read('child', 800).doc;
  f.store.mutate('child', 800, { writer, parentDoc: saved, change: d => { d.pending_effects.push({ intent_id: 'old-child', kind: 'replace_block', target: { issue: 800, digest: 'missing' }, state: 'UNKNOWN' }); return d; } });
  const observed = { issues: new Map([[800, null]]), subIssues: new Map(), comments: new Map() };
  const holds = [];
  assert.equal(f.make().recover([{ kind: 'child', number: 800, doc: f.store.read('child', 800).doc }], observed, holds)[0].outcome, 'UNKNOWN');
  assert.deepEqual(holds.map(entry => entry.scope), ['body']);
  assert.ok(doc);
  f.github.issues.get(800).parent = null;
  f.github.issues.get(421).subs = f.github.issues.get(421).subs.filter(number => number !== 800);
  const run = f.make(); const heldPlan = run.plan(); heldPlan.holds.push(...holds);
  const applied = run.apply(heldPlan);
  assert.ok(applied.results.some(entry => entry.kind === 'attach' && entry.target.issue === 800 && entry.outcome === 'DONE'), 'body UNKNOWN leaves its native links usable');
  assert.ok(applied.results.some(entry => entry.kind === 'replace_block' && entry.target.issue === 800 && entry.outcome === 'SKIPPED'));
  assert.ok(applied.results.some(entry => entry.kind === 'replace_block' && entry.target.issue === 801 && entry.outcome === 'DONE'), 'unrelated task pages still run');
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
