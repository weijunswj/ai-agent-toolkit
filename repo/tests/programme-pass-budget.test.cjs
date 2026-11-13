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
  // One state commit, then two intent writes for each of the three effect groups (parent page, order,
  // task pages), plus one saved copy for each of the ten pages re-laid in a pass.
  assert.equal(stats.state_commits, 1 + 3 * 2 + state.MAX_RELAYS_PER_PASS);
  assert.equal(stats.github_writes, 35);
});

test('A-T2: the parent redraw precedes every queue write', () => {
  const f = fixture(); const { calls } = measured(f);
  const parent = calls.indexOf(parentWrites(calls)[0]);
  const queue = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.method === 'PATCH' && !call.path.endsWith('/issues/421') && !call.path.startsWith(`repos/${f.github.storeRepository}/`));
  assert.equal(queue.length, 34);
  assert.ok(queue.every(({ index }) => parent < index), 'parent before order and task page PATCHes');
});

test('A-T3: a short budget redraws all saved rows, reports the stop and resumes', () => {
  const f = fixture(); let elapsed = 0;
  f.github.intercept(() => { elapsed += 800; });
  const report = f.make(budget(() => Date.parse(NOW) + elapsed, 200000)).run({ apply: true });
  assert.ok(report.holds.some(entry => entry.code === 'PASS_STOPPED'));
  assert.equal(openStop(f)?.diagnostics.cause, 'time_limit');
  assert.equal((f.github.issues.get(421).body.match(/^\|[^\n]*\|#\d+\|/gm) || []).length, 84);
  assert.match(f.github.issues.get(421).body, /PASS_STOPPED #421: the last refresh stopped at/);
  assert.equal(f.github.calls.slice(f.before.calls).filter(call => call.method === 'PATCH' && !call.path.endsWith('/issues/421') && !call.path.startsWith(`repos/${f.github.storeRepository}/`)).length, 0, 'queue skipped');
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

// These fixtures test recovery and reads, not the sweep's request cap (its own tests measure that),
// so a catch-up pass may draw every page at once.
function cliRun(f, lockFile, extra = {}, argv = ['refresh', '--json']) {
  let output = '';
  const code = cli.main(argv, { transport: f.github, binding: f.binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
    toolkitVersion: '3.56.1', now: () => NOW, passClock: () => Date.parse(NOW), lockFile, environment: {}, requestCap: 1000, stdout: { write: text => { output += text; } }, ...extra });
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
  const report = f.make(budget(() => Date.parse(NOW) + elapsed, 8000)).run({ apply: true });
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
    let reporting = false;
    f.github.intercept(call => {
      // The lost-reply outage ends this pass before any later fresh read could confirm the commit.
      if (landed && injected && row.failure === 'lost_reply' && call.method === 'GET' && call.path.startsWith(`repos/${f.github.storeRepository}/branches/`)) {
        return { status: 502, json: { message: 'fixture transport still unavailable' } };
      }
      // The state tree that carries the predecessor's stop report.
      if (!landed && call.method === 'POST' && call.path.endsWith('/git/trees')) {
        const parent = call.body.tree.find(entry => entry.path === f.store.docPath('parent', 421));
        reporting = Boolean(parent && JSON.parse(parent.content).attention?.some(entry => entry.code === 'PASS_STOPPED' && entry.diagnostics.started_at === oldTime));
      }
      if (!landed && reporting && call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) {
        const response = f.github.route(call.method, call.path, call.body);
        assert.equal(response.status, 200);
        landed = true;
        if (row.failure === 'lost_reply') { injected = true; return { status: 502, json: { message: 'fixture lost commit reply' } }; }
        return response;
      }
      if (landed && !injected && row.failure === 'crash_after_commit' && call.path === 'graphql' && call.body.query.includes('stateSnapshot')
        && call.body.variables.directory.startsWith(`${f.github.sweepHead}:`)) {
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
    if (row.answer === 'disposed' && scoped) {
      assert.equal(recovered.report.effects.length, 0, `exercise the no-effects route: ${JSON.stringify(recovered.report.effects)}`);
      assert.equal(recovered.report.summary, 'No changes');
      assert.deepEqual(recovered.report.writes, { state: 0, github: 0 });
    } else if (row.answer === 'disposed') {
      // The first sweep after the stop draws the board's freshness line; nothing else changes.
      assert.deepEqual(recovered.report.effects.map(effect => [effect.kind, effect.target.issue]), [['replace_block', 421]]);
      assert.match(f.github.issues.get(421).body, /^Board updated: /m);
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
    f.github.addPr(pr, { head: 'a'.repeat(40), body: 'Fixture PR.' }); // only an open PR is ever written
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

const { pageFixture } = require('./support/programme-page-fixture.cjs');

function slowRefresh(t, { count = 60, lockFile, version = '3.59.1', discussion = 741, extraIssues = 80, prs = 320 } = {}) {
  const fx = pageFixture(state, { count, groups: ['LATER'], width: 5 });
  const dir = lockFile ? path.dirname(lockFile) : fs.mkdtempSync(path.join(os.tmpdir(), 'programme-sliced-'));
  if (!lockFile) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = lockFile || path.join(dir, 'pass.lock');
  for (let i = 0; i < extraIssues; i++) fx.github.addIssue(100000 + i, { labels: i % 20 ? ['programme:outside'] : [] });
  for (let i = 0; i < discussion; i++) fx.github.addComment(12, { body: 'Synthetic discussion' });
  for (let i = 0; i < prs; i++) fx.github.addPr(200000 + i, { state: 'CLOSED', head: 'a'.repeat(40) });
  // Closing moves the issue's update time on GitHub.
  const close = number => Object.assign(fx.issues.get(number), { state: 'closed', closed_at: fx.NOW, state_reason: 'completed', updated_at: fx.github.tick() });
  const read = number => fx.store.read('child', number).doc;
  const run = ({ slow = true, fault = null, argv, more = {} } = {}) => {
    let time = Date.parse(fx.NOW);
    let phase = 'entry';
    // Reproduce discovery's per-family planning latency without depending on new metrics.
    const original = state.Reconciler.prototype.plan;
    state.Reconciler.prototype.plan = function (...args) {
      phase = 'planning';
      try { return original.apply(this, args); } finally { phase = 'apply'; }
    };
    fx.github.hooks = [];
    fx.github.intercept(call => {
      time += !slow ? 0 : phase === 'planning' && call.method === 'GET' && call.path.includes(fx.github.storeRepository)
        ? 2700 : phase === 'planning' && call.path.includes('/comments') ? 2800 : 1250;
      return fault?.(call, phase, delay => { time += delay; });
    });
    try {
      return cliRun(fx, file, { now: () => new Date(time).toISOString(), passClock: () => time, toolkitVersion: version, ...more }, argv);
    } finally {
      state.Reconciler.prototype.plan = original;
      fx.github.hooks = [];
    }
  };
  return { ...fx, file, dir, read, close, run };
}


test('sweep: a healthy refresh writes only private aggregate metrics and no rotation note', t => {
  const f = slowRefresh(t, { count: 1, discussion: 0, extraIssues: 0, prs: 0 });
  f.close(100);
  const result = f.run({ slow: false });
  assert.equal(result.code, 0, JSON.stringify(result.report.holds));
  assert.equal(f.read(100).lifecycle, 'DONE');
  assert.equal(fs.existsSync(`${f.file}.resume`), false);
  const metrics = JSON.parse(fs.readFileSync(`${f.file}.metrics`, 'utf8'));
  assert.equal(metrics.phases.resume, undefined);
  for (const phase of ['entry', 'inventory', 'planning', 'state']) assert.ok(metrics.phases[phase], phase);
  assert.deepEqual(Object.keys(metrics.reads).sort(), ['bookmark', 'reread', 'reused', 'rows']);
  assert.doesNotMatch(JSON.stringify(metrics), /Synthetic discussion|example\.test|fixture-controller/);
  assert.doesNotMatch(JSON.stringify(result.report), /elapsed_ms|toolkit.programme-sweep-metrics/);
  assert.doesNotMatch(f.page(), /elapsed_ms|toolkit.programme-sweep-metrics/);
});

const sweepDoc = (call, n) => call.path.split('?')[0].endsWith(`/contents/state/issue-${n}.json`);

for (const omit of [false, true]) {
  test(`state write: ${omit ? 'a read without its version id never requests a write' : 'a healthy read writes with its version id'}`, t => {
    const f = slowRefresh(t, { count: 1, discussion: 0, extraIssues: 0, prs: 0 });
    assert.equal(f.run({ slow: false }).code, 0);
    f.close(100);
    const snapshots = [];
    const writes = [];
    const outcome = f.run({ slow: false, fault: call => {
      if (call.method === 'PUT' && sweepDoc(call, 100)) writes.push(call);
      if (call.method === 'POST' && /\/git\/(trees|commits)$/.test(call.path) || call.method === 'PATCH' && call.path.includes('/git/refs/heads/')) writes.push(call);
      if (call.path !== 'graphql' || !call.body.query.includes('stateSnapshot')) return;
      const answer = f.github.route(call.method, call.path, call.body);
      const entry = answer.json.data.repository.snapshot?.entries.find(item => item.name === 'issue-100.json');
      if (entry) snapshots.push({ head: call.body.variables.directory.split(':')[0], oid: entry.oid });
      if (entry && omit) delete entry.oid;
      return answer;
    } });
    const trees = writes.filter(call => call.path.endsWith('/git/trees'));
    const treeFor100 = trees.filter(call => call.body.tree.some(entry => entry.path.endsWith('issue-100.json')));
    if (!omit) {
      assert.equal(outcome.code, 0);
      assert.equal(writes.some(call => call.method === 'PUT'), false, 'no per-document write');
      assert.equal(treeFor100.length, 1);
      const commit = writes.find(call => call.path.endsWith('/git/commits') && call.body.tree);
      assert.equal(commit.body.parents.length, 1);
      assert.ok(snapshots.some(item => item.head === commit.body.parents[0] && /^[0-9a-f]{40}$/.test(item.oid)), 'the commit builds on the snapshot that gave #100 its version id');
      assert.ok(writes.filter(call => call.method === 'PATCH').every(call => call.body.force === false));
      assert.equal(f.read(100).lifecycle, 'DONE');
      return;
    }
    assert.deepEqual(treeFor100, [], 'no request without the comparison token');
    assert.equal(outcome.code, 1);
    assert.deepEqual(outcome.report.holds.map(hold => [hold.code, hold.target]), [['STATE_TOKEN_MISSING', '#100']]);
    assert.equal(f.read(100).lifecycle, 'PLANNED');
    assert.equal(f.run({ slow: false }).code, 0, 'a later healthy read completes the copy');
    assert.equal(f.read(100).lifecycle, 'DONE');
  });
}

// Reading only what changed. The parent's sub-issue list carries every native child's issue
// facts, empty lists are not requested, the parent's comments are read from a bookmark, and a
// task is read in full only when the saved queue puts it in the pass's scope.
const APP = 'repos/example.test/app';
const readCache = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-read-cache.cjs'));

function readFixture(t, { count = 24, groups = ['COMPLETED'], cached = true } = {}) {
  const fx = pageFixture(state, { count, groups, width: 5 });
  fx.github.commentsMoveIssue = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-reads-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = cached ? path.join(dir, 'pass.lock') : null;
  let time = Date.parse(fx.NOW);
  const run = (extra = {}) => {
    // An hour passes on GitHub too between hourly passes.
    time += 3600000;
    fx.github.clock += 3600000;
    const at = fx.github.calls.length;
    const result = cliRun(fx, file, { now: () => new Date(time).toISOString(), passClock: () => time, toolkitVersion: '3.59.1', ...extra });
    return { ...result, calls: fx.github.calls.slice(at) };
  };
  const gets = (calls, pattern) => calls.filter(call => call.method === 'GET' && pattern.test(call.path)).length;
  const kept = () => JSON.parse(fs.readFileSync(`${file}.reads`, 'utf8'));
  const withPr = (number, pr) => {
    fx.github.addPr(pr, { head: 'b'.repeat(40), state: 'MERGED', merged: true });
    fx.store.mutate('child', number, { writer: fx.writer, parentDoc: fx.parent(), change: doc => { doc.pr = { ...doc.pr, number: pr, state: 'MERGED', head: 'b'.repeat(40) }; return doc; } });
  };
  const prReads = (calls, pr) => calls.filter(call => call.path === 'graphql' && call.body?.variables?.number === pr).length;
  return { ...fx, dir, file, run, gets, kept, withPr, prReads };
}

test('reads: the parent list replaces a read per child, and empty lists are not requested', t => {
  const f = readFixture(t, { count: 6, groups: ['LATER'] });
  assert.equal(f.run().code, 0);
  const second = f.run();
  assert.equal(second.code, 0, JSON.stringify(second.report.holds));
  assert.equal(second.report.reads.rows, 6);
  assert.equal(f.gets(second.calls, new RegExp(`^${APP}/issues/10\\d$`)), 0, 'no single issue read for a child the list shows');
  assert.equal(f.gets(second.calls, new RegExp(`^${APP}/issues/10\\d/sub_issues`)), 0, 'no sub-issue list for a child that reports none');
  assert.equal(f.gets(second.calls, new RegExp(`^${APP}/issues/10\\d/comments`)), 0, 'no comment list for a child that reports none');
  // A child the list cannot vouch for is read on its own, as before.
  f.github.addComment(103, { body: 'A note' });
  f.github.intercept(call => {
    if (call.method !== 'GET' || !call.path.startsWith(`${APP}/issues/12/sub_issues`)) return undefined;
    const listed = f.github.route(call.method, call.path, call.body);
    return { status: listed.status, json: listed.json.map(row => row.number === 104 ? { number: row.number, id: row.id } : row) };
  });
  const third = f.run();
  f.github.hooks = [];
  assert.equal(third.report.reads.rows, 5);
  assert.equal(f.gets(third.calls, new RegExp(`^${APP}/issues/104$`)) >= 1, true, 'the incomplete row falls back to its own read');
  assert.equal(f.gets(third.calls, new RegExp(`^${APP}/issues/103/comments`)) >= 1, true, 'a child with a comment has its list read');
});

test('reads: settled children are reused, and the oldest share is read again each pass', t => {
  const f = readFixture(t);
  f.github.addComment(100, { body: 'Closing story' });
  f.withPr(100, 500);
  const first = f.run();
  assert.equal(first.code, 0, JSON.stringify(first.report.holds));
  assert.deepEqual([first.report.reads.reused, first.report.reads.reread], [0, 0]);
  assert.ok(f.prReads(first.calls, 500) >= 1);
  // The saved queue, not a per-task copy, decides what is read: the first pass read all 24.
  assert.deepEqual([first.report.sweep.read, f.parent().sweep.queue], [24, []]);
  // The first pass wrote every child page, which moved each issue's update time: all are read again once.
  const settling = f.run();
  assert.deepEqual([settling.report.reads.reused, settling.report.reads.reread], [0, 0]);
  const second = f.run();
  assert.equal(second.code, 0);
  assert.deepEqual([second.report.reads.reused, second.report.reads.reread], [22, 2]);
  // An hour later only the parent's freshness line moves; no task changes.
  assert.deepEqual(second.report.effects.map(effect => [effect.kind, effect.target.issue]), [['replace_block', 12]]);
  // Twelve passes in all re-read every task at least once.
  const seen = new Set(second.report.sweep.tasks);
  for (let pass = 0; pass < 11; pass++) {
    const result = f.run();
    assert.equal(result.code, 0);
    for (const number of result.report.sweep.tasks) seen.add(number);
  }
  assert.equal(seen.size, 24);
  // A pass that leaves #100 out asks for neither its comments nor its merged PR.
  const reusing = [f.run(), f.run()].find(result => !result.report.sweep.tasks.includes(100));
  assert.ok(reusing, 'at least one of two passes leaves #100 to its rotation turn');
  assert.equal(f.gets(reusing.calls, new RegExp(`^${APP}/issues/100/comments`)), 0);
  assert.equal(f.prReads(reusing.calls, 500), 0);
});

test('reads: a changed settled child is read live', t => {
  const f = readFixture(t);
  for (const number of [100, 101, 102, 103]) f.github.addComment(number, { body: `Story\n---\nStory ${number}` });
  f.run(); f.run(); f.run();
  const live = (result, number) => f.gets(result.calls, new RegExp(`^${APP}/issues/${number}/comments`)) > 0;
  // A new comment moves the update time and the count.
  f.github.addComment(100, { body: 'Late note' });
  // A deleted comment changes only the count.
  const gone = [...f.github.comments.values()].find(comment => comment.issue === 101).id;
  f.github.comments.delete(gone);
  // A new sub-issue changes neither the update time nor the comments, only the sub-issue count.
  const before = f.github.issues.get(102).updated_at;
  f.github.addIssue(900, { parent: 102 });
  f.github.issues.get(102).updated_at = before;
  const changed = f.run();
  assert.equal(live(changed, 100), true, 'new comment');
  assert.equal(f.gets(changed.calls, new RegExp(`^${APP}/issues/102/sub_issues`)) > 0, true, 'the new sub-issue is found');
  assert.ok(changed.report.effects.some(effect => effect.kind === 'add_native_children'), 'and adopted, as on a full read');
  // A deleted comment moves no update time, so GitHub's changed list cannot show it: #101 is read
  // again on its rotation turn, within twelve passes.
  let turn = live(changed, 101) ? changed : null;
  for (let pass = 0; !turn && pass < 12; pass++) { const result = f.run(); if (result.report.sweep.tasks.includes(101)) turn = result; }
  assert.ok(turn && live(turn, 101), 'the deleted comment reaches #101 within its rotation');
  // A reopened child is no longer settled: nothing kept is used for it.
  Object.assign(f.github.issues.get(103), { state: 'open', closed_at: null, state_reason: null, updated_at: f.github.tick() });
  const reopened = f.run();
  assert.equal(live(reopened, 103), true, 'reopened');
});

test('reads: a child with a pending intent, or with no usable copy, is never reused', t => {
  const f = readFixture(t);
  f.github.addComment(100, { body: 'Story' });
  f.run(); f.run();
  f.run();
  const doc = f.store.read('child', 100).doc;
  doc.pending_effects.push({ intent_id: 'earlier-intent', kind: 'replace_block', target: { issue: 100, digest: 'missing' }, state: 'UNKNOWN' });
  f.github.putFile('state/issue-100.json', doc);
  const pending = f.run();
  assert.ok(f.gets(pending.calls, new RegExp(`^${APP}/issues/100/comments`)) > 0, 'a pending intent is checked against a live read');
  // An unreadable, foreign or wrong-shaped file is rebuilt and its comments read in full. What a
  // pass skips is decided by the saved queue in the state, never by this file.
  for (const text of ['{not json', JSON.stringify({ schema: readCache.SCHEMA, repository: 'someone/else', parent: 12, children: {} }),
    JSON.stringify({ schema: readCache.SCHEMA, repository: 'example.test/app', parent: 12, discussion: { bookmark: 'x', comments: [{}] }, children: { 101: { updated_at: 1 } } })]) {
    fs.writeFileSync(`${f.file}.reads`, text);
    const cold = f.run();
    assert.equal(cold.code === 0 || cold.report.holds.every(hold => hold.code === 'EFFECT_UNKNOWN'), true, JSON.stringify(cold.report.holds));
    assert.equal(cold.report.reads.bookmark, 'full');
    assert.equal(cold.report.reads.reused + cold.report.sweep.read, 24, 'every task is read or left to its turn by the queue');
    assert.deepEqual(f.parent().sweep.queue, [], 'nothing the queue owed was skipped');
    assert.equal(f.kept().schema, readCache.SCHEMA, 'the file is rebuilt');
    assert.equal(Object.hasOwn(f.kept(), 'children'), false, 'the file keeps no per-task copies');
  }
  // The saved queue decides what a pass reads, so the copy has no per-task reuse left.
  for (const name of ['usable', 'setChild', 'dropChild', 'retain']) assert.equal(name in readCache.ReadCache.prototype, false, name);
});

test('reads: the parent comments come from a bookmark that must account for every comment', t => {
  const f = readFixture(t, { count: 2, groups: ['LATER'] });
  for (let i = 0; i < 245; i++) f.github.addComment(12, { body: `Discussion ${i}` });
  // The fake clock gives each comment its own second; leave a gap wider than the bookmark overlap.
  f.github.clock += 3600000;
  for (let i = 245; i < 250; i++) f.github.addComment(12, { body: `Discussion ${i}` });
  const pages = result => f.gets(result.calls.filter(call => !/since=/.test(call.path)), new RegExp(`^${APP}/issues/12/comments`));
  const since = result => f.gets(result.calls.filter(call => /since=/.test(call.path)), new RegExp(`^${APP}/issues/12/comments`));
  // Exact reads per pass: planning reads the discussion once (in full, or through the bookmark), and
  // each of the pass's two parent page draws reads it again through the bookmark just before its
  // body write, so the page never drops a comment posted during the pass.
  const first = f.run();
  assert.deepEqual([first.report.reads.bookmark, since(first), pages(first)], ['full', 2, 3]);
  const planningPages = pages(first);
  const second = f.run();
  assert.deepEqual([second.report.reads.bookmark, since(second), pages(second)], ['used', 3, 0]);
  // New and edited comments arrive through the bookmark read.
  f.github.addComment(12, { body: 'A new note' });
  const edited = [...f.github.comments.values()].find(comment => comment.body === 'Discussion 7');
  f.github.request('PATCH', `${APP}/issues/comments/${edited.id}`, { body: 'Discussion 7, edited' });
  const third = f.run();
  assert.equal(third.report.reads.bookmark, 'used');
  const bodies = f.kept().discussion.comments.map(comment => comment.body);
  assert.equal(bodies.length, 251);
  assert.ok(bodies.includes('A new note') && bodies.includes('Discussion 7, edited') && !bodies.includes('Discussion 7'));
  assert.deepEqual(f.kept().discussion.comments.map(comment => comment.id), f.github.commentsOf(12).map(comment => comment.id), 'same order as a full read');
  // A deleted comment cannot be seen by the bookmark read: the count disagrees, so all pages are read.
  f.github.comments.delete(edited.id);
  const fourth = f.run();
  assert.deepEqual([fourth.report.reads.bookmark, since(fourth), pages(fourth)], ['full', 3, planningPages]);
  assert.equal(f.kept().discussion.comments.length, 250);
  assert.equal(f.run().report.reads.bookmark, 'used');
});

test('reads: a warm pass plans exactly what a pass with no copy plans', t => {
  const script = f => {
    for (const number of [100, 101, 102]) f.github.addComment(number, { body: `Story ${number}` });
    f.withPr(101, 501);
    for (let i = 0; i < 120; i++) f.github.addComment(12, { body: `Discussion ${i}` });
    const reports = [f.run().report, f.run().report];
    f.github.addComment(102, { body: 'More' });
    f.github.addComment(12, { body: 'Decision\n---\nRecorded.' });
    Object.assign(f.github.issues.get(105), { state: 'open', closed_at: null, state_reason: null, updated_at: f.github.tick() });
    f.github.issues.get(106).title = 'Renamed task'; f.github.issues.get(106).updated_at = f.github.tick();
    reports.push(f.run().report, f.run().report);
    return reports.map(({ reads, metrics, ...report }) => report);
  };
  const warm = readFixture(t, { count: 26, groups: ['COMPLETED', 'COMPLETED', 'LATER'] });
  const cold = readFixture(t, { count: 26, groups: ['COMPLETED', 'COMPLETED', 'LATER'], cached: false });
  const [a, b] = [script(warm), script(cold)];
  assert.deepEqual(a, b);
  assert.equal(warm.page(), cold.page());
  for (const number of [100, 102, 105, 106]) assert.equal(warm.github.issues.get(number).body, cold.github.issues.get(number).body, `#${number}`);
  assert.ok(warm.kept().discussion.comments.length >= 121);
});

test('reads: a slow programme finishes its plan, and a cut plan still keeps what it read', t => {
  const f = slowRefresh(t);
  f.close(100);
  const first = f.run();
  // Before reads were reduced this profile stopped at "state (0 of 2 done)" and wrote nothing. Now
  // the first pass finishes planning and state, and each later pass advances the remaining queue.
  const stopOf = result => result.report.holds.find(hold => hold.code === 'PASS_STOPPED')?.detail || '';
  assert.equal(f.read(100).lifecycle, 'DONE');
  assert.equal(first.report.reads.rows, 60);
  assert.doesNotMatch(stopOf(first), /stopped at (planning|state)/);
  assert.ok(first.report.results.filter(entry => entry.outcome === 'DONE').length > 0);
  const second = f.run();
  assert.equal(second.report.reads.bookmark, 'used');
  assert.doesNotMatch(stopOf(second), /stopped at (planning|state)/);
  assert.ok(second.report.results.filter(entry => entry.outcome === 'DONE').length > 0);
  // Planning has the whole budget and no private note can shorten it. A plan that is still cut,
  // here by one very slow read after the comments, writes nothing and keeps what it read.
  fs.rmSync(`${f.file}.reads`);
  f.close(101);
  const cut = f.run({ slow: false, fault: (call, phase, delay) => { if (phase === 'planning' && /issues\?state=closed/.test(call.path)) delay(11 * 60000); } });
  assert.equal(cut.code, 1);
  assert.match(stopOf(cut), /stopped at/);
  assert.deepEqual(cut.report.results, []);
  assert.equal(f.read(101).lifecycle, 'PLANNED');
  assert.equal(f.store.read('parent', 12).doc.sweep.queue[0], 101, 'the cut pass saved its queue with the changed task first');
  assert.ok(JSON.parse(fs.readFileSync(`${f.file}.reads`, 'utf8')).discussion.comments.length >= 741);
  const after = f.run({ slow: false });
  assert.equal(after.report.reads.bookmark, 'used');
  assert.equal(f.read(101).lifecycle, 'DONE');
});
