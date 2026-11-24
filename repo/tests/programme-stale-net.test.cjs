'use strict';

// The stale-work net (one lifecycle for every check of work left undone): its row properties (net,
// ack cap, no dispose), the 4-hour callout, the stale-check rows the sweep now raises as findings
// (OWNER_OK_CLOSE, CHILD_NO_NEAREST, POLISH_CAP, ROWS_UNTICKED), and the two noise trims (the 5 per
// cent page-budget margin, a completed close with its closing story). Rows follow the #1225 G0 plan's
// matrices 5.3 (callout) and 5.4 (stale rows).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const HEAD = 'c'.repeat(40);
const HOUR = 3600 * 1000;
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-net-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
const ticked = '## DONE WHEN\n- [x] the first row\n- [x] the second row\n';
const unticked = '## DONE WHEN\n- [ ] the first row\n- [ ] the second row\n';

// A programme with the given tasks under #421. Each task: { issue, title?, body?, state?, createdAt?, doc? }
// where `doc` changes the task's state document after it is made.
function fixture(tasks) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const catalogue = tasks.map((task, i) => ({ issue: task.issue, class: 'COMMITTED', parent: 421, order: i + 1 }));
  const binding = state.validateBinding({
    schema: state.SCHEMA.bindingV2, repository, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'INT-TK421-' }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  });
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const task of tasks) github.addIssue(task.issue, { parent: 421, title: task.title, body: task.body || '', state: task.state || 'open', createdAt: task.createdAt || null });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: catalogue }), controller, {}), { sha: null, previous: null });
  tasks.forEach((task, i) => {
    const doc = state.newChild({ repository, outcome: catalogue[i] });
    store.write('child', task.issue, task.doc ? task.doc(doc) : doc, { sha: null, previous: null });
  });
  const fx = { github, store, binding };
  fx.parent = () => store.read('parent', 421).doc;
  fx.deps = () => ({ transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0', lockFile: path.join(tmp(), 'pass.lock'),
    attentionDir: tmp(), environment: {}, now: () => new Date(github.clock).toISOString(), stdout: { write: text => { fx.output += text; } }, stderr: { write: () => {} } });
  fx.run = (argv, { json = true, writer = true } = {}) => {
    fx.output = '';
    try {
      cli.main([...argv, ...(writer ? ['--session', controller.session, '--controller'] : []), ...(json ? ['--json'] : [])], fx.deps());
      return { result: json ? JSON.parse(fx.output.split(/\n(?=\{)/).at(-1)) : fx.output, error: null };
    } catch (error) { return { result: null, error }; }
  };
  // A full pass with GitHub facts read, as a holder's refresh runs it.
  fx.pass = () => new state.Reconciler({ store, reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    binding, writer: state.refreshWriter(fx.parent()), toolkitVersion: '3.9.0', refreshFacts: true, now: () => new Date(github.clock).toISOString() }).run({ apply: true });
  fx.open = (code, issue) => (fx.parent().attention || []).find(entry => entry.code === code && entry.issue === issue && ['new', 'acknowledged'].includes(entry.state)) || null;
  fx.codes = issue => (fx.parent().attention || []).filter(entry => entry.issue === issue && ['new', 'acknowledged'].includes(entry.state)).map(entry => entry.code).sort();
  return fx;
}

// A task whose PR #22 merged at HEAD, a UAT owed there, the agent's UAT recorded; no gate on it.
const ownerOkDoc = ({ agent = 'PASSED', gate = null } = {}) => doc => Object.assign(doc, {
  lifecycle: 'WAITING_OWNER', pr: { ...doc.pr, number: 22 }, uat: { state: 'PENDING', at_head: HEAD },
  private: { ...doc.private, agent_uat: { state: agent, at_head: HEAD, evidence: 'evidence/uat/REPORT.md' } },
  ...(gate ? { gate: { ...doc.gate, ...gate } } : {}),
});

test('N-1: row properties: the net, the default 72-hour ack cap, and no dispose for POLISH_CAP and OWNER_OK_CLOSE', () => {
  for (const code of ['OWNER_OK_CLOSE', 'CHILD_NO_NEAREST', 'POLISH_CAP', 'ROWS_UNTICKED', 'READY_TO_CLOSE', 'CLOSED_PARENT_OPEN_CHILD', 'TASK_IDLE', 'TASK_MERGED_OPEN']) {
    assert.ok(state.NET_CODES.has(code), `${code} is in the net`);
  }
  for (const code of state.WORK_QUEUE_CODES) assert.ok(state.NET_CODES.has(code), `work-queue code ${code} is in the net`);
  assert.equal(state.NET_CODES.has('BODY_OVER_BUDGET'), false, 'a page-size finding is not stale work');
  const now = '2026-11-23T10:00:00.000Z';
  const entry = (code, issue) => ({ id: state.findingId('reconcile', code, issue, code === 'OWNER_OK_CLOSE' ? HEAD : null), source: 'reconcile', code, issue,
    head: code === 'OWNER_OK_CLOSE' ? HEAD : null, state: 'new', first_seen: now, changed_at: now });
  const doc = { attention: [entry('POLISH_CAP', 5), entry('OWNER_OK_CLOSE', 6), entry('CHILD_NO_NEAREST', 7), entry('READY_TO_CLOSE', 8)], private: {} };
  for (const id of [doc.attention[0].id, doc.attention[1].id]) {
    assert.throws(() => state.answerFinding(doc, { id, state: 'disposed', reason: 'not needed', now }), error => {
      assert.equal(error.code, 'FINDING_NO_DISPOSE');
      assert.match(error.message, /never disposed/);
      assert.match(error.message, new RegExp(`ack --finding ${id} --next <step> with a due time at most 72 hours ahead`), 'names the ack route and its cap');
      assert.match(error.message, /It clears once the work is done \(Controller: /, 'names the clearing route');
      return true;
    });
  }
  const over = new Date(Date.parse(now) + 73 * HOUR).toISOString();
  assert.throws(() => state.answerFinding(doc, { id: doc.attention[0].id, state: 'acknowledged', next: 'ship it', due: over, now }), /at most 72 hours ahead for POLISH_CAP; a longer wait is a tracked task\./);
  const atCap = state.answerFinding(doc, { id: doc.attention[0].id, state: 'acknowledged', next: 'ship it', due: new Date(Date.parse(now) + 72 * HOUR).toISOString(), now });
  assert.equal(atCap.attention[0].state, 'acknowledged', 'an ack at the cap is taken');
  // Codes without no_dispose keep the reasoned dispose, unchanged.
  for (const id of [doc.attention[2].id, doc.attention[3].id]) assert.equal(state.answerFinding(doc, { id, state: 'disposed', reason: 'a new area', now }).attention.find(item => item.id === id).state, 'disposed');
});

test('N-9: netCallout: new under 4 h no, new at 4 h yes, acknowledged ahead no, past due yes (at once), non-net no', () => {
  const now = Date.parse('2026-11-23T12:00:00.000Z');
  const at = ms => new Date(ms).toISOString();
  const mk = (code, issue, fields) => ({ id: state.findingId('reconcile', code, issue, null), source: 'reconcile', code, issue, head: null, first_seen: at(now - 50 * HOUR), ...fields });
  const findings = [
    mk('POLISH_CAP', 1, { state: 'new', changed_at: at(now - 4 * HOUR + 60000) }),            // H2: 3 h 59 m
    mk('CHILD_NO_NEAREST', 2, { state: 'new', changed_at: at(now - 4 * HOUR) }),              // H3: 4 h
    mk('ROWS_UNTICKED', 3, { state: 'acknowledged', changed_at: at(now - 10 * HOUR), due: at(now + HOUR) }),  // H4
    mk('READY_TO_CLOSE', 4, { state: 'acknowledged', changed_at: at(now - 30 * HOUR), due: at(now - 2 * HOUR) }), // H5
    mk('READY_TO_CLOSE', 5, { state: 'new', changed_at: at(now - 60000), due: at(now - HOUR) }),  // past due, stored new again by a pass
    mk('BODY_TOO_LARGE', 6, { state: 'new', changed_at: at(now - 30 * HOUR) }),                // H7: not in the net
    mk('TASK_IDLE', 7, { state: 'resolved', changed_at: at(now - 30 * HOUR) }),                // closed: never
  ];
  const callout = state.netCallout(findings, at(now));
  assert.deepEqual(callout.entries.map(entry => [entry.ref, entry.code, entry.state, entry.hours]),
    [['#2', 'CHILD_NO_NEAREST', 'new', 4], ['#4', 'READY_TO_CLOSE', 'overdue', 2], ['#5', 'READY_TO_CLOSE', 'overdue', 1]], 'oldest first');
  assert.equal(callout.count, 3);
  // H8: seven over 4 h: three oldest named, the count says the rest.
  const seven = [1, 2, 3, 4, 5, 6, 7].map(n => mk('TASK_IDLE', n, { state: 'new', changed_at: at(now - (4 + n) * HOUR) }));
  const many = state.netCallout(seven, now);
  assert.equal(many.count, 7);
  assert.deepEqual(many.oldest.map(entry => entry.ref), ['#7', '#6', '#5']);
  assert.deepEqual(state.netCallout(undefined, now), { count: 0, entries: [], oldest: [] }, 'no list, no callout');
});

test('N-10: attention prints the "Unanswered over 4 h" block and --json adds callout', () => {
  const fx = fixture([1, 2, 3, 4, 5].map(issue => ({ issue, createdAt: null })));
  const parent = fx.parent();
  const old = new Date(fx.github.clock - 6 * HOUR).toISOString();
  const attention = [1, 2, 3, 4, 5].map(issue => ({ id: state.findingId('reconcile', 'CHILD_NO_NEAREST', issue, null), source: 'reconcile', code: 'CHILD_NO_NEAREST', issue, head: null, state: 'new', first_seen: old, changed_at: old }));
  fx.store.mutate('parent', 421, { writer: controller, change: doc => ({ ...doc, attention }) });
  assert.ok(parent);
  const json = fx.run(['attention'], { writer: false });
  assert.equal(json.error, null, json.error?.message);
  assert.equal(json.result.callout.count, 5);
  assert.deepEqual(json.result.callout.entries.map(entry => entry.ref).sort(), ['#1', '#2', '#3', '#4', '#5'], 'same age: all five, tie broken by id');
  const text = fx.run(['attention'], { json: false, writer: false });
  assert.equal(text.error, null, text.error?.message);
  assert.match(text.result, /\nUnanswered over 4 h \(5\): answer each this turn\n- [0-9a-f]{12} CHILD_NO_NEAREST #[1-5]: new for 6 h\n/);
});

test('N-2, N-3: OWNER_OK_CLOSE only for a merged task whose agent UAT passed with no gate open and every row ticked', () => {
  const fx = fixture([
    { issue: 10, body: ticked, doc: ownerOkDoc() },                                                   // R2
    { issue: 11, body: ticked, doc: ownerOkDoc({ gate: { role: 'G1', state: 'SUBMITTED', assignment: { id: 'g1-a', role: 'G1' } } }) }, // R3: gate open
    { issue: 12, body: unticked, doc: ownerOkDoc() },                                                 // an unchecked row: judged, not owner OK
    { issue: 13, body: '', doc: ownerOkDoc() },                                                       // no DONE WHEN heading
    { issue: 14, body: ticked, doc: ownerOkDoc({ agent: 'OWNER_ONLY' }) },                            // the owner must still test
  ]);
  for (const [n, pr] of [[10, 22], [11, 23], [12, 24], [13, 25], [14, 26]]) {
    fx.github.addPr(pr, { head: HEAD, merged: true, state: 'MERGED', body: `Refs #${n}` });
    fx.store.mutate('child', n, { writer: controller, parentDoc: fx.parent(), change: doc => ({ ...doc, pr: { ...doc.pr, number: pr } }) });
  }
  fx.pass();
  const found = fx.open('OWNER_OK_CLOSE', 10);
  assert.ok(found, 'R2 raises OWNER_OK_CLOSE');
  assert.equal(found.head, HEAD, 'bound to the head the UAT ran at');
  for (const n of [11, 12, 13, 14]) assert.equal(fx.open('OWNER_OK_CLOSE', n), null, `#${n} raises none`);
  // Clears once the task closes.
  fx.github.issues.get(10).state = 'closed'; fx.github.issues.get(10).state_reason = 'completed'; fx.github.tick();
  fx.pass();
  assert.equal(fx.open('OWNER_OK_CLOSE', 10), null, 'resolved once the task is closed');
});

test('N-4: CHILD_NO_NEAREST only for a task opened in the last 7 days with no Nearest child: line', () => {
  const fx0 = new FakeGitHub({ repository: 'acme/app' });
  const day = 24 * HOUR;
  const recent = new Date(fx0.clock - 2 * day).toISOString();
  const fx = fixture([
    { issue: 30, createdAt: recent },                                                     // R4
    { issue: 31, createdAt: new Date(fx0.clock - 8 * day).toISOString() },               // R5: older
    { issue: 32, createdAt: recent, body: 'Nearest child: #30, which covers the engine only.\n' },
    { issue: 33, createdAt: recent, state: 'closed' },
  ]);
  fx.pass();
  assert.ok(fx.open('CHILD_NO_NEAREST', 30), 'R4 raises');
  for (const n of [31, 32, 33]) assert.equal(fx.open('CHILD_NO_NEAREST', n), null, `#${n} raises none`);
  // A dispose with the reason holds; adding the line resolves it.
  fx.github.issues.get(30).body = 'Nearest child: #31, a different area.\n'; fx.github.tick();
  fx.pass();
  assert.equal(fx.open('CHILD_NO_NEAREST', 30), null, 'resolved once the line is added');
});

test('N-6: POLISH_CAP: full at 8 rows, over cap above 8 or with two polish tasks open; dispose refused', () => {
  const rows = n => `## ROWS\n${Array.from({ length: n }, (_, i) => `- [ ] row ${i + 1}`).join('\n')}\n`;
  const one = fixture([{ issue: 40, title: 'Polish 9', body: rows(8) }, { issue: 41, title: 'Other task', body: rows(9) }]);
  one.pass();
  assert.ok(one.open('POLISH_CAP', 40), 'R7: full at 8 rows');
  assert.equal(one.open('POLISH_CAP', 41), null, 'a task not titled Polish is not counted');
  const id = one.open('POLISH_CAP', 40).id;
  const disposed = one.run(['dispose', '--finding', id, '--reason', 'later']);
  assert.equal(disposed.error?.code, 'FINDING_NO_DISPOSE');
  one.github.issues.get(40).body = rows(7); one.github.tick();
  one.pass();
  assert.equal(one.open('POLISH_CAP', 40), null, 'resolved under the cap');
  const two = fixture([{ issue: 42, title: 'Polish 10', body: rows(9) }, { issue: 43, title: 'Polish 11', body: rows(1) }]);
  two.pass();
  assert.ok(two.open('POLISH_CAP', 42), 'R8: over cap');
  assert.ok(two.open('POLISH_CAP', 43), 'R8: two open polish tasks flag each');
});

test('N-12: ROWS_UNTICKED for a merged PR with no DONE WHEN or ROWS row ticked; ticking one resolves it', () => {
  const merged = doc => Object.assign(doc, { lifecycle: 'ACTIVE', pr: { ...doc.pr, number: 50 } });
  const fx = fixture([
    { issue: 51, body: unticked, doc: merged },
    { issue: 52, body: '## DONE WHEN\n- [x] done\n- [ ] still open\n', doc: doc => Object.assign(doc, { lifecycle: 'ACTIVE', pr: { ...doc.pr, number: 53 } }) },
    { issue: 54, body: '## DONE WHEN\nNo checkbox rows here.\n', doc: doc => Object.assign(doc, { lifecycle: 'ACTIVE', pr: { ...doc.pr, number: 55 } }) },
    { issue: 56, body: unticked },
  ]);
  for (const [pr, n] of [[50, 51], [53, 52], [55, 54]]) fx.github.addPr(pr, { head: HEAD, merged: true, state: 'MERGED', body: `Refs #${n}` });
  fx.pass();
  assert.ok(fx.open('ROWS_UNTICKED', 51), 'a merged PR with no row ticked raises');
  for (const n of [52, 54, 56]) assert.equal(fx.open('ROWS_UNTICKED', n), null, `#${n} raises none`);
  fx.github.issues.get(51).body = '## DONE WHEN\n- [x] the first row\n- [ ] the second row\n'; fx.github.tick();
  fx.pass();
  assert.equal(fx.open('ROWS_UNTICKED', 51), null, 'resolved once a row is ticked');
});

test('N-7: BODY_OVER_BUDGET only at 5 per cent over the budget', () => {
  assert.equal(state.pageBudgetFinding(7, 'x'.repeat(4199), state.PAGE_BUDGETS.child), null, 'R9: 4,199 raises nothing');
  const r10 = state.pageBudgetFinding(7, 'x'.repeat(4200), state.PAGE_BUDGETS.child);
  assert.equal(r10.code, 'BODY_OVER_BUDGET', 'R10: 4,200 raises');
  assert.equal(r10.diagnostics.threshold, 4000, 'the reduction still aims under the budget itself');
  assert.equal(r10.diagnostics.required_reduction, 201);
  assert.equal(state.pageBudgetFinding(1, 'x'.repeat(10499), state.PAGE_BUDGETS.parent), null);
  assert.ok(state.pageBudgetFinding(1, 'x'.repeat(10500), state.PAGE_BUDGETS.parent));
  assert.equal(state.pageBudgetFinding(2, 'x'.repeat(3149), state.PAGE_BUDGETS.pr), null);
  assert.ok(state.pageBudgetFinding(2, 'x'.repeat(3150), state.PAGE_BUDGETS.pr));
  assert.equal(state.pageBudgetFinding(3, 'x'.repeat(4001), state.PAGE_BUDGETS.child), null, 'a page a few characters over raises nothing (today 4,001 raised)');
});

test('N-8: CLOSED_WITHOUT_ACCEPTANCE is not raised for a completed close with its closing story after the close', () => {
  const done = doc => Object.assign(doc, { lifecycle: 'DONE', closed_by_sweep: true });
  const fx = fixture([{ issue: 60, state: 'closed', doc: done }, { issue: 61, state: 'closed', doc: done }, { issue: 62, state: 'closed', doc: done }]);
  for (const n of [60, 61, 62]) fx.github.issues.get(n).state_reason = 'completed';
  fx.github.addComment(60, { body: 'What shipped and why.\n\n<!-- toolkit-closing kind=story -->' });           // R11
  fx.github.addComment(62, { body: 'An early story.\n\n<!-- toolkit-closing kind=story -->', createdAt: '2026-01-01T00:00:00Z' }); // before the close
  fx.pass();
  assert.equal(fx.open('CLOSED_WITHOUT_ACCEPTANCE', 60), null, 'R11: the story after the close settles it');
  assert.ok(fx.open('CLOSED_WITHOUT_ACCEPTANCE', 61), 'R12: no story, raised as today');
  assert.ok(fx.open('CLOSED_WITHOUT_ACCEPTANCE', 62), 'a story from before the close does not count');
});

test('N-11: validateAttention accepts the new codes and still refuses kind on other codes', () => {
  const now = '2026-11-23T10:00:00.000Z';
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 5, class: 'COMMITTED', parent: 421, order: 1 }] });
  const entry = (code, extra = {}) => ({ id: state.findingId('reconcile', code, 5, extra.head || null, extra.kind || null), source: 'reconcile', code, issue: 5, head: null, state: 'new', first_seen: now, changed_at: now, ...extra });
  for (const code of ['CHILD_NO_NEAREST', 'POLISH_CAP', 'ROWS_UNTICKED']) assert.doesNotThrow(() => state.assertValid('parent', { ...parent, attention: [entry(code)] }), code);
  assert.doesNotThrow(() => state.assertValid('parent', { ...parent, attention: [entry('OWNER_OK_CLOSE', { head: HEAD })] }), 'OWNER_OK_CLOSE is head-bound');
  assert.throws(() => state.assertValid('parent', { ...parent, attention: [entry('POLISH_CAP', { kind: 'issue' })] }), /kind belongs to a closing finding/);
});
