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
    f.github.addIssue(pr);
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
  const close = number => Object.assign(fx.issues.get(number), { state: 'closed', closed_at: fx.NOW, state_reason: 'completed' });
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

test('sweep: repeated slow state 0/2 advances verified work across invocations', t => {
  const f = slowRefresh(t);
  f.close(100); f.close(106);
  // Make the first pass reproduce exactly two planned state effects (attention and one child).
  Object.assign(f.issues.get(106), { state: 'open', closed_at: null, state_reason: null });
  const first = f.run();
  const stop = first.report.holds.find(entry => entry.code === 'PASS_STOPPED');
  assert.match(stop.detail, /state \(0 of 2 done\)/);
  assert.equal(f.read(100).lifecycle, 'PLANNED');
  f.close(106);
  const second = f.run();
  assert.equal(f.read(100).lifecycle, 'DONE');
  assert.notEqual(second.report.outcome, 'COMPLETE');
  assert.equal(second.code, 1);
  assert.equal(f.read(106).lifecycle, 'PLANNED');
  const third = f.run();
  assert.equal(f.read(106).lifecycle, 'DONE');
  assert.notEqual(third.report.outcome, 'COMPLETE');
  const metrics = JSON.parse(fs.readFileSync(`${f.file}.metrics`, 'utf8'));
  assert.ok(metrics.phases.resume.requests.issue > 0);
  assert.ok(metrics.phases.resume.elapsed_ms <= 45000);
  assert.ok(Object.values(metrics.phases.resume.requests).reduce((a, b) => a + b, 0) <= 48);
  assert.doesNotMatch(JSON.stringify(metrics), /Synthetic discussion|example\.test|fixture-controller/);
});

const sweepIssue = (call, n) => call.path === `repos/example.test/app/issues/${n}`;
const sweepDoc = (call, n) => call.path.split('?')[0].endsWith(`/contents/state/issue-${n}.json`);
const sweepCursor = f => JSON.parse(fs.readFileSync(`${f.file}.resume`, 'utf8'));

for (const change of ['holder epoch', 'catalogue', 'binding']) {
  test(`sweep: changed ${change} never adopts the old rotation`, t => {
    const f = slowRefresh(t);
    f.close(100);
    assert.equal(f.run().code, 1);
    assert.equal(f.run().code, 1);
    const old = sweepCursor(f);
    assert.equal(old.after, 103);
    if (change === 'holder epoch') {
      const parent = f.parent();
      parent.fence.epoch++;
      f.github.putFile('state/parent-12.json', parent);
    } else if (change === 'catalogue') {
      const parent = f.parent();
      parent.outcomes = parent.outcomes.filter(row => row.issue !== 103);
      f.github.putFile('state/parent-12.json', parent);
    } else f.binding.required_checks = ['new-required-check'];
    f.close(104);
    assert.equal(f.run().code, 1);
    assert.equal(f.read(104).lifecycle, 'PLANNED', 'old position did not start a bounded write');
    assert.notEqual(sweepCursor(f).scope, old.scope);
    assert.equal(sweepCursor(f).after, null);
  });
}

for (const failure of ['malformed', 'foreign cursor', 'oversized', 'bad marker']) {
  test(`sweep: ${failure} checkpoint holds refresh while preview stays read-only`, t => {
    const f = slowRefresh(t);
    f.close(100);
    assert.equal(f.run().code, 1);
    const file = `${f.file}.resume`;
    const text = failure === 'malformed' ? '{' : failure === 'oversized' ? 'x'.repeat(1025)
      : JSON.stringify({ ...sweepCursor(f), ...(failure === 'bad marker' ? { full_first: false } : { after: 999999 }) });
    fs.writeFileSync(file, text);
    const before = [f.github.commits, f.github.mutations()];
    f.run({ slow: false, argv: ['reconcile', '--json'] });
    assert.throws(() => f.run(), { code: 'SWEEP_RESUME_INVALID' });
    assert.deepEqual([f.github.commits, f.github.mutations()], before);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    fs.renameSync(file, file + '.preserved');
    assert.equal(f.run().code, 1, 'a fresh full attempt can arm a new rotation');
    assert.equal(sweepCursor(f).after, null);
  });
}

for (const interruption of ['CAS conflict', 'lost write reply', 'lost readback']) {
  test(`sweep: ${interruption} holds its item and serves unrelated work`, t => {
    const f = slowRefresh(t);
    f.close(100);
    assert.equal(f.run().code, 1);
    f.close(101);
    const target = () => f.read(100);
    const pending = target().pending_effects;
    const parent = f.parent();
    const offset = f.github.calls.length;
    const publicBefore = f.github.mutations();
    let faulted = false;
    const partial = f.run({ fault: (call, phase) => {
      if (faulted || phase !== 'entry' || !sweepDoc(call, 100)) return;
      if (interruption === 'lost readback' && call.method === 'GET' && /\?ref=c\d+$/.test(call.path)) {
        faulted = true; return { status: 502, json: {} };
      }
      if (call.method !== 'PUT') return;
      if (interruption === 'CAS conflict') {
        faulted = true;
        f.github.putFile('state/issue-100.json', { ...f.github.readFile('state/issue-100.json'), next_action: 'Concurrent controller change' });
      } else if (interruption === 'lost write reply') {
        faulted = true;
        assert.equal(f.github.route(call.method, call.path, call.body).status, 200);
        return { status: 502, json: {} };
      }
    } });
    assert.equal(partial.code, 1);
    assert.equal(partial.report.outcome, 'HELD');
    assert.deepEqual(partial.report.inventory, { complete: false, reason: 'Full inventory deferred', counts: {} });
    assert.ok(partial.report.holds.some(hold => hold.target === '#100'));
    assert.equal(f.read(101).lifecycle, 'DONE');
    assert.equal(f.github.mutations(), publicBefore, 'no public effect from a partial batch');
    assert.deepEqual(f.parent(), parent, 'no watermark, parent state or attention settlement');
    assert.deepEqual(target().pending_effects, pending);
    assert.equal(sweepCursor(f).after, 103);
    assert.equal(sweepCursor(f).full_first, true, 'the next refresh runs the full path first');
    if (interruption === 'CAS conflict') assert.equal(target().next_action, 'Concurrent controller change');
    const accepted = ['lost write reply', 'lost readback'].includes(interruption);
    if (accepted) {
      assert.equal(target().lifecycle, 'DONE');
      const rev = target().revision;
      assert.equal(f.github.calls.slice(offset).filter(call => call.method === 'PUT' && sweepDoc(call, 100)).length, 1);
      const later = f.github.calls.length;
      f.run({ slow: false });
      assert.equal(target().revision, rev, 'fresh full read recognises the verified lifecycle already present');
      assert.equal(f.github.calls.slice(later).filter(call => call.method === 'PUT' && sweepDoc(call, 100)).length, 0);
    }
  });
}

test('sweep: takeover during source confirmation stops before the child CAS', t => {
  const f = slowRefresh(t);
  f.close(100);
  assert.equal(f.run().code, 1);
  let reads = 0;
  const at = f.github.calls.length;
  assert.throws(() => f.run({ fault: call => {
    if (sweepIssue(call, 100) && ++reads === 2) {
      const prior = f.github.readFile('state/parent-12.json');
      const next = state.claimDocument(prior, { session: 'fixture-successor', prefix: 'TEST-' }, { takeover: true });
      f.github.putFile('state/parent-12.json', next);
    }
  } }), { code: 'STALE_WRITER' });
  assert.equal(f.github.calls.slice(at).filter(call => call.method === 'PUT' && sweepDoc(call, 100)).length, 0);
  assert.equal(f.read(100).lifecycle, 'PLANNED');
});

test('sweep: provider refusal stops the batch and its full follow-on', t => {
  const f = slowRefresh(t);
  f.close(100);
  assert.equal(f.run().code, 1);
  const at = f.github.calls.length;
  const result = f.run({ fault: call => sweepIssue(call, 100) ? { status: 429, json: {} } : undefined });
  assert.equal(result.code, 1);
  assert.equal(result.report.holds[0].code, 'SWEEP_SLICE_PROVIDER_HELD');
  assert.equal(f.github.calls.slice(at).filter(call => sweepIssue(call, 100)).length, 1);
  assert.ok(f.github.calls.slice(at).every(call => call.method === 'GET'), 'no full plan or effect after the refusal');
  assert.deepEqual([sweepCursor(f).after, sweepCursor(f).full_first], [100, true]);
  // The refusal cannot repeat without a full refresh in between: the next run has no batch.
  const next = f.run();
  assert.notEqual(next.report.outcome, 'HELD');
  assert.ok(next.report.holds.some(hold => hold.code === 'PASS_STOPPED'), 'the full path ran and reported its own stop');
  assert.equal(JSON.parse(fs.readFileSync(`${f.file}.metrics`, 'utf8')).phases.resume, undefined);
  assert.deepEqual(sweepCursor(f), { schema: 'toolkit.programme-sweep-rotation.v1', scope: sweepCursor(f).scope, after: 100 }, 'the rotation keeps its place and the marker is spent');
  const third = f.run();
  assert.ok(JSON.parse(fs.readFileSync(`${f.file}.metrics`, 'utf8')).phases.resume, 'the bounded turn resumes after the full attempt');
  assert.equal(third.code, 1);
});

test('sweep: healthy refresh keeps the existing full path and writes only private aggregate metrics', t => {
  const f = slowRefresh(t, { count: 1, discussion: 0, extraIssues: 0, prs: 0 });
  f.close(100);
  const result = f.run({ slow: false });
  assert.equal(result.code, 0, JSON.stringify(result.report.holds));
  assert.equal(f.read(100).lifecycle, 'DONE');
  assert.equal(fs.existsSync(`${f.file}.resume`), false);
  const metrics = JSON.parse(fs.readFileSync(`${f.file}.metrics`, 'utf8'));
  assert.equal(metrics.phases.resume, undefined);
  for (const phase of ['entry', 'inventory', 'planning', 'state']) assert.ok(metrics.phases[phase], phase);
  assert.doesNotMatch(JSON.stringify(result.report), /elapsed_ms|toolkit.programme-sweep-metrics/);
  assert.doesNotMatch(f.page(), /elapsed_ms|toolkit.programme-sweep-metrics/);
});

test('sweep: a slow call uses the bounded request timeout and no CAS starts after the reserve', t => {
  const f = slowRefresh(t);
  f.close(100);
  assert.equal(f.run().code, 1);
  const at = f.github.calls.length;
  const optionsSeen = [];
  const transport = Object.assign(Object.create(f.github), {
    request(method, endpoint, body, options) {
      if (sweepIssue({ path: endpoint }, 100)) optionsSeen.push(options?.timeoutMs);
      return f.github.request(method, endpoint, body);
    },
  });
  const result = f.run({ more: { transport }, fault: (call, _phase, spend) => {
    if (sweepIssue(call, 100)) spend(44000); // A fake request that ignores the supplied deadline.
  } });
  assert.equal(result.code, 1);
  assert.equal(result.report.holds[0].code, 'SWEEP_SLICE_LIMIT');
  assert.equal(sweepCursor(f).full_first, true);
  assert.deepEqual(optionsSeen, [10000]);
  assert.equal(f.github.calls.slice(at).filter(call => call.method === 'PUT').length, 0);
  assert.equal(f.read(100).lifecycle, 'PLANNED');
});

test('sweep: a changed source lifecycle leaves its child to the full refresh while the next child still progresses', t => {
  const f = slowRefresh(t);
  f.close(100);
  assert.equal(f.run().code, 1);
  f.close(101);
  let read = 0;
  const at = f.github.calls.length;
  const result = f.run({ fault: (call, phase) => {
    if (phase === 'entry' && sweepIssue(call, 100) && ++read === 2) Object.assign(f.issues.get(100), { state: 'open', closed_at: null, state_reason: null });
  } });
  assert.equal(result.code, 1);
  assert.notEqual(result.report.outcome, 'HELD');
  assert.deepEqual(result.report.left_to_full_refresh.map(entry => [entry.code, entry.target]), [['GRAPH_FACT_STALE', '#100']]);
  assert.ok(result.report.holds.some(hold => hold.code === 'PASS_STOPPED'), 'the full refresh had its turn and reported its own stop');
  assert.equal(f.github.calls.slice(at).filter(call => call.method === 'PUT' && sweepDoc(call, 100)).length, 0, 'no bounded write on unconfirmed facts');
  assert.equal(f.read(100).lifecycle, 'PLANNED');
  assert.equal(f.read(101).lifecycle, 'DONE');
  assert.equal(sweepCursor(f).full_first, undefined);
});

test('sweep: losing private-store access during source confirmation refuses the child CAS', t => {
  const f = slowRefresh(t);
  f.close(100);
  assert.equal(f.run().code, 1);
  let reads = 0;
  const at = f.github.calls.length;
  assert.throws(() => f.run({ fault: call => {
    if (sweepIssue(call, 100) && ++reads === 2) f.github.repos.get(f.github.storeRepository.toLowerCase()).private = false;
  } }), { code: 'STATE_STORE_UNVERIFIED' });
  assert.equal(f.github.calls.slice(at).filter(call => call.method === 'PUT').length, 0);
  assert.equal(f.read(100).lifecycle, 'PLANNED');
});

function seedSweepIntent(f, number, digest) {
  const doc = f.read(number);
  const intent = { intent_id: 'earlier-intent', kind: 'replace_block', target: { issue: number, digest }, state: 'UNKNOWN' };
  doc.pending_effects.push(intent);
  f.github.putFile(`state/issue-${number}.json`, doc);
  return intent;
}

function seedSweepRotation(f) {
  const parent = f.parent();
  const writer = state.refreshWriter(parent);
  const scope = state.sha256(state.canonicalText([f.binding, parent.parent_issue, parent.fence.epoch, writer.session_hash, state.sweepCatalogue(parent)]));
  fs.writeFileSync(`${f.file}.resume`, JSON.stringify({ schema: 'toolkit.programme-sweep-rotation.v1', scope, after: null }) + '\n');
}

for (const count of [1, 2, 3, 4]) {
  test(`sweep: a catalogue of ${count} gives a recoverable intent a full readback turn`, t => {
    const f = slowRefresh(t, { count, discussion: 0, extraIssues: 0, prs: 0 });
    assert.equal(f.run({ slow: false }).code, 0);
    const body = f.issues.get(100).body;
    const block = state.findStateBlock(body).block;
    assert.ok(block);
    const intent = seedSweepIntent(f, 100, state.blockDigest(block.body));
    seedSweepRotation(f);
    if (count > 1) f.close(101);
    let sawFullRead = false;
    const at = f.github.calls.length;
    const { report, code } = f.run({ slow: false, fault: (call, phase) => {
      if (phase !== 'planning' || call.method !== 'GET' || !sweepIssue(call, 100)) return;
      sawFullRead = true;
      assert.deepEqual(f.github.readFile('state/issue-100.json').pending_effects, [intent], 'only the full path can clear the saved intent');
      if (count > 1) assert.equal(f.github.readFile('state/issue-101.json').lifecycle, 'DONE', 'unrelated scoped work ran before full planning');
    } });
    assert.equal(sawFullRead, true, 'the existing full plan gets a turn without removing the rotation');
    assert.deepEqual(report.recovered, [{ kind: 'child', number: 100, intent_id: intent.intent_id, outcome: 'DONE' }]);
    assert.equal(code, 0, JSON.stringify(report.holds));
    assert.deepEqual(f.read(100).pending_effects, []);
    assert.equal(f.github.calls.slice(at).filter(call => call.method === 'PATCH' && sweepIssue(call, 100)).length, 0, 'the accepted body was not written again');
    assert.equal(fs.existsSync(`${f.file}.resume`), false);
  });
}

test('sweep: full readback keeps an unreadable prior intent held while another child progresses', t => {
  const f = slowRefresh(t, { count: 2, discussion: 0, extraIssues: 0, prs: 0 });
  const intent = seedSweepIntent(f, 100, 'missing');
  seedSweepRotation(f);
  f.close(101);
  const at = f.github.calls.length;
  const { report, code } = f.run({ slow: false, fault: call => sweepIssue(call, 100) && call.method === 'GET' ? { status: 404, json: {} } : undefined });
  assert.equal(code, 1);
  assert.notEqual(report.outcome, 'COMPLETE');
  assert.deepEqual(report.recovered, [{ kind: 'child', number: 100, intent_id: intent.intent_id, outcome: 'UNKNOWN' }]);
  assert.ok(report.holds.some(hold => hold.code === 'EFFECT_UNKNOWN' && hold.target === '#100'));
  assert.deepEqual(f.read(100).pending_effects, [intent]);
  assert.equal(f.read(101).lifecycle, 'DONE');
  assert.ok(!f.github.calls.slice(at).some(call => call.method === 'PATCH' && sweepIssue(call, 100)));
});

test('sweep: a slow full plan retains the earlier intent and reports the time stop', t => {
  const f = slowRefresh(t);
  const intent = seedSweepIntent(f, 100, 'missing');
  seedSweepRotation(f);
  f.close(101);
  const { report, code } = f.run();
  assert.equal(code, 1);
  assert.notEqual(report.outcome, 'COMPLETE');
  assert.ok(report.holds.some(hold => hold.code === 'PASS_STOPPED'));
  assert.deepEqual(f.read(100).pending_effects, [intent]);
  assert.equal(f.read(101).lifecycle, 'DONE');
  assert.equal(sweepCursor(f).after, 103);
});

test('sweep: a provider stop still defers full readback of an earlier intent', t => {
  const f = slowRefresh(t, { count: 2, discussion: 0, extraIssues: 0, prs: 0 });
  const intent = seedSweepIntent(f, 100, 'missing');
  seedSweepRotation(f);
  const at = f.github.calls.length;
  const { report, code } = f.run({ slow: false, fault: call => sweepIssue(call, 101) ? { status: 429, json: {} } : undefined });
  assert.equal(code, 1);
  assert.equal(report.outcome, 'HELD');
  assert.deepEqual(report.holds.map(hold => hold.code), ['SWEEP_SLICE_PROVIDER_HELD']);
  assert.deepEqual(report.recovered, []);
  assert.deepEqual(f.read(100).pending_effects, [intent]);
  assert.ok(f.github.calls.slice(at).every(call => call.method === 'GET'));
});

// Closure matrix for the bounded turn. A child whose facts cannot be confirmed is left to the full
// refresh in the same pass. Only a write outcome or a batch-wide stop holds the pass, and then
// the next refresh runs the full path first.
const SUBS = 'repos/example.test/app/issues/12/sub_issues';
const sweepAttaches = (f, at) => f.github.calls.slice(at).filter(call => call.method === 'POST' && call.path === SUBS).length;
const sweepBodyWrites = (f, at, n) => f.github.calls.slice(at).filter(call => call.method === 'PATCH' && sweepIssue(call, n) && typeof call.body?.body === 'string').length;
const sweepMetrics = f => JSON.parse(fs.readFileSync(`${f.file}.metrics`, 'utf8')).phases;
const sweepLeft = report => (report.left_to_full_refresh || []).map(entry => [entry.code, entry.target]);

function settledSweep(t, count) {
  const f = slowRefresh(t, { count, discussion: 0, extraIssues: 0, prs: 0 });
  assert.equal(f.run({ slow: false }).code, 0);
  return f;
}

function unlinkSweepChild(f, number) {
  const parent = f.github.issues.get(12);
  parent.subs = parent.subs.filter(entry => entry !== number);
  f.issues.get(number).parent = null;
}

function acceptedSweepIntent(f, number) {
  const block = state.findStateBlock(f.issues.get(number).body).block;
  assert.ok(block, 'the managed body is really present');
  return seedSweepIntent(f, number, state.blockDigest(block.body));
}

for (const count of [1, 2, 3, 4]) {
  test(`sweep matrix: with ${count} direct children a missing native link is repaired and an accepted intent settled in one refresh`, t => {
    const f = settledSweep(t, count);
    // With one child both conditions sit on it. Otherwise the accepted intent is on another child.
    const holder = count === 1 ? 100 : 101;
    const body = f.issues.get(holder).body;
    const intent = acceptedSweepIntent(f, holder);
    unlinkSweepChild(f, 100);
    if (count > 2) f.close(102);
    seedSweepRotation(f);
    const at = f.github.calls.length;
    const { report, code } = f.run({ slow: false });
    assert.equal(code, 0, JSON.stringify(report.holds));
    assert.equal(report.outcome, undefined, 'the report is the full refresh\'s own');
    assert.equal(report.inventory.complete, true);
    assert.ok(report.findings.some(finding => finding.code === 'NATIVE_PARENT_MISSING' && finding.issue === 100));
    assert.equal(f.issues.get(100).parent, 12);
    assert.equal(sweepAttaches(f, at), 1);
    assert.deepEqual(report.recovered, [{ kind: 'child', number: holder, intent_id: intent.intent_id, outcome: 'DONE' }]);
    assert.deepEqual(f.read(holder).pending_effects, []);
    assert.equal(sweepBodyWrites(f, at, holder), 0, 'the accepted body was not written again');
    assert.equal(f.issues.get(holder).body, body);
    assert.deepEqual(sweepLeft(report), count === 1 ? [] : [['GRAPH_FACT_STALE', '#100']]);
    if (count > 2) assert.equal(f.read(102).lifecycle, 'DONE');
    assert.ok(sweepMetrics(f).resume, 'the bounded turn ran first');
    assert.equal(fs.existsSync(`${f.file}.resume`), false);
    const again = f.github.calls.length;
    assert.equal(f.run({ slow: false }).code, 0);
    assert.deepEqual([sweepAttaches(f, again), sweepBodyWrites(f, again, holder)], [0, 0]);
  });
}

test('sweep matrix: a lone child with only a missing native link is left to the full refresh and repaired', t => {
  const f = settledSweep(t, 1);
  unlinkSweepChild(f, 100);
  seedSweepRotation(f);
  const at = f.github.calls.length;
  const { report, code } = f.run({ slow: false });
  assert.equal(code, 0, JSON.stringify(report.holds));
  assert.deepEqual(sweepLeft(report), [['GRAPH_FACT_STALE', '#100']]);
  assert.deepEqual([f.issues.get(100).parent, sweepAttaches(f, at)], [12, 1]);
});

test('sweep matrix: a stable missing link never keeps a slow full refresh from its turn', t => {
  const f = slowRefresh(t);
  unlinkSweepChild(f, 100);
  assert.equal(f.run().code, 1);
  for (let turn = 0; turn < 3; turn++) {
    const { report, code } = f.run();
    assert.equal(code, 1);
    assert.notEqual(report.outcome, 'HELD', 'never the early held report');
    assert.ok(report.holds.some(hold => hold.code === 'PASS_STOPPED'), 'the full refresh ran and reported its own stop');
    assert.ok(report.inventory.reason !== 'Full inventory deferred');
    assert.equal(sweepCursor(f).full_first, undefined);
  }
});

test('sweep matrix: a wrong native parent is left to the full refresh, which reports it', t => {
  const f = settledSweep(t, 2);
  f.github.addIssue(900);
  f.github.link(900, 100);
  f.close(101);
  seedSweepRotation(f);
  const at = f.github.calls.length;
  const { report } = f.run({ slow: false });
  assert.notEqual(report.outcome, 'HELD');
  assert.deepEqual(sweepLeft(report), [['GRAPH_FACT_STALE', '#100']]);
  assert.ok(report.findings.some(finding => finding.code === 'NATIVE_PARENT_WRONG' && finding.issue === 100), 'the full refresh gives its own evidence');
  assert.equal(f.read(101).lifecycle, 'DONE');
  assert.equal(f.github.calls.slice(at).filter(call => call.method === 'PUT' && sweepDoc(call, 100)).length, 0);
});

for (const [fact, code] of [['incomplete', 'GRAPH_FACT_STALE'], ['unreadable', 'GH_FAILED']]) {
  test(`sweep matrix: ${fact} issue facts are left to the full refresh, which copies the lifecycle from its own read`, t => {
    const f = settledSweep(t, 2);
    f.close(100); f.close(101);
    seedSweepRotation(f);
    let faulted = false;
    const puts = [];
    const { report, code: exit } = f.run({ slow: false, fault: (call, phase) => {
      if (call.method === 'PUT' && sweepDoc(call, 100)) puts.push(phase);
      if (faulted || phase !== 'entry' || !sweepIssue(call, 100)) return;
      faulted = true;
      if (fact === 'unreadable') return { status: 500, json: {} };
      const { id, ...rest } = f.github.route(call.method, call.path, call.body).json;
      return { status: 200, json: rest };
    } });
    assert.equal(faulted, true);
    assert.equal(exit, 0, JSON.stringify(report.holds));
    assert.deepEqual(sweepLeft(report), [[code, '#100']]);
    assert.deepEqual(puts, ['apply'], 'the only write of that child is the full refresh\'s own');
    assert.deepEqual([f.read(100).lifecycle, f.read(101).lifecycle], ['DONE', 'DONE']);
  });
}

for (const omit of [false, true]) {
  test(`sweep matrix: ${omit ? 'a state read without its version id never requests a write' : 'a healthy state read writes with its version id'}`, t => {
    const f = settledSweep(t, 1);
    f.close(100);
    seedSweepRotation(f);
    const puts = [];
    const outcome = f.run({ slow: false, fault: call => {
        if (!sweepDoc(call, 100)) return;
        if (call.method === 'PUT') puts.push(typeof call.body.sha === 'string');
        if (call.method === 'GET' && omit) {
          const { sha, ...rest } = f.github.route(call.method, call.path, call.body).json;
          assert.equal(typeof sha, 'string');
          return { status: 200, json: rest };
        }
      } });
    if (!omit) {
      assert.equal(outcome.code, 0);
      assert.deepEqual(puts, [true]);
      assert.equal(f.read(100).lifecycle, 'DONE');
      return;
    }
    // The bounded turn leaves the child alone, and the full refresh refuses the same read itself.
    assert.deepEqual(puts, [], 'no request without the comparison token, from either path');
    assert.equal(outcome.code, 1);
    assert.deepEqual(sweepLeft(outcome.report), [['STATE_TOKEN_MISSING', '#100']]);
    assert.deepEqual(outcome.report.holds.map(hold => [hold.code, hold.target]), [['STATE_TOKEN_MISSING', '#100']], 'the full refresh holds that child by its own check');
    assert.equal(f.read(100).lifecycle, 'PLANNED');
    assert.equal(f.run({ slow: false }).code, 0, 'a later healthy read completes the copy');
    assert.equal(f.read(100).lifecycle, 'DONE');
  });
}

test('sweep matrix: a write refused in every bounded turn cannot keep the full refresh away', t => {
  const f = settledSweep(t, 2);
  f.close(100);
  unlinkSweepChild(f, 101);
  seedSweepRotation(f);
  // A competing writer wins only while the bounded turn is writing.
  const fault = (call, phase) => (phase === 'entry' && call.method === 'PUT' && sweepDoc(call, 100) ? { status: 409, json: {} } : undefined);
  const at = f.github.calls.length;
  const first = f.run({ slow: false, fault });
  assert.deepEqual([first.code, first.report.outcome], [1, 'HELD']);
  assert.deepEqual(first.report.holds.map(hold => [hold.code, hold.target]), [['STATE_CONFLICT', '#100']]);
  assert.deepEqual(sweepLeft(first.report), [['GRAPH_FACT_STALE', '#101']]);
  assert.equal(sweepAttaches(f, at), 0);
  assert.equal(sweepCursor(f).full_first, true);
  const second = f.run({ slow: false, fault });
  assert.equal(second.code, 0, JSON.stringify(second.report.holds));
  assert.equal(sweepMetrics(f).resume, undefined, 'no bounded turn in front of this full refresh');
  assert.deepEqual([f.issues.get(101).parent, sweepAttaches(f, at)], [12, 1]);
  assert.equal(f.read(100).lifecycle, 'DONE');
  assert.equal(fs.existsSync(`${f.file}.resume`), false);
});

test('sweep matrix: attention --refresh --json keeps HELD, the deferred inventory and the holds, beside done results', t => {
  const f = settledSweep(t, 2);
  const attention = ['attention', '--refresh', '--json'];
  const done = f.run({ slow: false, argv: attention });
  assert.deepEqual([done.code, done.report.refreshed], [0, { outcome: 'DONE', inventory_complete: true, holds: [] }]);
  f.close(100);
  seedSweepRotation(f);
  const held = f.run({ slow: false, argv: attention, fault: call => sweepIssue(call, 100) ? { status: 429, json: {} } : undefined });
  assert.equal(held.code, 1);
  assert.deepEqual({ ...held.report.refreshed, holds: held.report.refreshed.holds.map(hold => hold.code) },
    { outcome: 'HELD', inventory_complete: false, inventory_reason: 'Full inventory deferred', holds: ['SWEEP_SLICE_PROVIDER_HELD'] });
  // A full refresh with its own holds keeps its existing status and exit.
  unlinkSweepChild(f, 101);
  const full = f.run({ slow: false, argv: attention, fault: call => call.method === 'POST' && call.path === SUBS ? { status: 500, json: {} } : undefined });
  assert.equal(full.code, 1);
  assert.equal(full.report.refreshed.outcome, 'DONE');
  assert.ok(full.report.refreshed.holds.length);
  // Plain text names the held refresh, not an unreadable inventory.
  seedSweepRotation(f);
  let text = '';
  f.github.intercept(call => sweepIssue(call, 100) ? { status: 429, json: {} } : undefined);
  const exit = cli.main(['attention', '--refresh'], { transport: f.github, binding: f.binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
    toolkitVersion: '3.59.1', now: () => f.NOW, passClock: () => Date.parse(f.NOW), lockFile: f.file, environment: {}, stdout: { write: chunk => { text += chunk; } } });
  f.github.hooks = [];
  assert.equal(exit, 1);
  assert.match(text, /The refresh was held before the full scan/);
  assert.match(text, /SWEEP_SLICE_PROVIDER_HELD/);
  assert.doesNotMatch(text, /INVENTORY_INCOMPLETE/);
});
