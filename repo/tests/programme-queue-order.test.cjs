'use strict';

// One work queue on the programme graph: tasks in flight keep their bands on top, every other open
// task is QUEUED in work order (priority, then quick wins, then other work, then tasks marked last),
// with hard dependencies held and `order` as the tie-break. Driven through the real reconcile pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
const holder = { session: 'fixture-controller', prefix: 'TEST-' };
const SHA = 'a'.repeat(40);
const epoch = Date.parse('2026-11-08T00:00:00Z');
const temps = [];
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// `tasks` are outcome fields plus `lifecycle` (default PLANNED, so the task is queued).
function fixture(tasks) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 1, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: ['validate'] };
  const outcomes = tasks.map(({ lifecycle: _lifecycle, ...task }, i) => ({ label: `Task ${task.issue}`, class: 'COMMITTED', parent: 1, order: i + 1, ...task }));
  github.addIssue(1);
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 1 });
  let now = epoch;
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(now).toISOString() });
  store.write('parent', 1, state.claimDocument(state.newParent({ repository: binding.repository, parentIssue: 1, outcomes }), holder, {}), { sha: null, previous: null });
  for (const [i, outcome] of outcomes.entries()) {
    const doc = state.newChild({ repository: binding.repository, outcome });
    doc.lifecycle = tasks[i].lifecycle || 'PLANNED';
    store.write('child', outcome.issue, doc, { sha: null, previous: null });
  }
  const pass = () => new state.Reconciler({ store, binding, writer: state.refreshWriter(store.read('parent', 1).doc), refreshFacts: true,
    reader: new state.ProgrammeGraphReader({ transport: github, repository: binding.repository }),
    mutator: new state.GitHubMutator({ transport: github, repository: binding.repository }), toolkitVersion: '3.55.1', now: () => new Date(now).toISOString() });
  const child = n => store.read('child', n).doc;
  const mutate = (n, change) => store.mutate('child', n, { writer: holder, parentDoc: store.read('parent', 1).doc, change: doc => ({ ...doc, ...change(doc) }) });
  const rows = () => github.issues.get(1).body.split('\n').filter(line => /^\|[^|]*\|#\d+\|/.test(line)).map(line => line.split('|').slice(2, 5).map(cell => cell.trim()));
  return { github, binding, store, pass, run: () => pass().run({ apply: true }), child, mutate, rows, parent: () => store.read('parent', 1).doc, time: ms => { now = ms; } };
}
const issuesOf = rows => rows.map(([issue]) => Number(issue.slice(1)));
const openCodes = f => (f.parent().attention || []).filter(entry => ['new', 'acknowledged'].includes(entry.state)).map(entry => entry.code);

// Large P1, small P1, small normal, a dependent pair (the dependent first by hand order), a normal
// task with no size, a task marked last and an optional task.
const WORK_ORDER = [
  { issue: 2, priority: 'P1', size: 'L' },
  { issue: 3, priority: 'P1', size: 'S' },
  { issue: 4, size: 'S' },
  { issue: 8, after: [9] },
  { issue: 9 },
  { issue: 5 },
  { issue: 6, last: true },
  { issue: 7, class: 'OPTIONAL' },
];

test('red-first: the queue runs priority (small first), quick wins, other work with the dependent after its prerequisite, then tasks marked last', () => {
  const f = fixture(WORK_ORDER);
  f.run();
  assert.deepEqual(f.rows().map(([issue, status]) => `${issue} ${status}`), ['#3 QUEUED', '#2 QUEUED', '#4 QUEUED', '#9 QUEUED', '#8 QUEUED', '#5 QUEUED', '#6 QUEUED', '#7 QUEUED']);
  assert.deepEqual(f.github.issues.get(1).subs, [3, 2, 4, 9, 8, 5, 6, 7], 'native sub-issues follow the queue');
  assert.match(f.github.issues.get(1).body, /Order: NOW · IN PROGRESS, NOW · AGENT UAT, NOW · CLOSE CHECK, then QUEUED in work order \(priority, then quick wins, then other work, then tasks marked last; a task follows the tasks it waits for\)/);
  assert.equal(f.pass().plan().effects.filter(effect => effect.kind === 'reorder').length, 0, 'a second pass plans no reorder');
});

test('P0 leads P1 and size breaks ties inside the priority step; order and then the child number break the rest', () => {
  const f = fixture([{ issue: 2, priority: 'P1' }, { issue: 3, priority: 'P1', size: 'M' }, { issue: 4, priority: 'P0', size: 'L' }, { issue: 5, size: 'S', order: 9 }, { issue: 6, size: 'S', order: 9 }]);
  f.run();
  assert.deepEqual(issuesOf(f.rows()), [4, 3, 2, 5, 6]);
  assert.match(f.pass().plan().findings.find(entry => entry.code === 'ORDER_TIE').detail, /^#5, #6 share order 9 in the quick step of the queue/);
});

test('no new fields: the queue is the old planned and blocked rows merged by order, then issue, below the rows in flight', () => {
  const f = fixture([{ issue: 2, order: 5 }, { issue: 3, order: 2, lifecycle: 'ACTIVE' }, { issue: 4, order: 3 }, { issue: 5, order: 1, lifecycle: 'ACTIVE' }, { issue: 6, order: 3 }]);
  f.mutate(5, () => ({ blockers: ['Laptop offline'] }));
  f.run();
  assert.deepEqual(f.rows(), [['#3', 'NOW · IN PROGRESS', '-'], ['#5', 'QUEUED', 'Blocked: Laptop offline'], ['#4', 'QUEUED', '-'], ['#6', 'QUEUED', '-'], ['#2', 'QUEUED', '-']]);
});

test('tasks in flight stay above the queue: AGENT UAT, CLOSE CHECK and a blocked task under a live gate; CURRENT lists only them', () => {
  const MERGED = { merged: true, mergedAt: '2026-11-07T00:00:00Z' };
  const f = fixture([{ issue: 2, priority: 'P0' }, { issue: 3, lifecycle: 'ACTIVE' }, { issue: 4, lifecycle: 'ACTIVE' }, { issue: 5, lifecycle: 'ACTIVE' }, { issue: 6, lifecycle: 'ACTIVE' }]);
  f.github.addPr(33, { head: SHA, body: 'Refs #3', ...MERGED }); f.github.addPr(44, { head: SHA, body: 'Refs #4', ...MERGED });
  f.mutate(3, doc => ({ pr: { ...doc.pr, number: 33 }, uat: { state: 'PENDING', at_head: SHA } }));
  f.mutate(4, doc => ({ pr: { ...doc.pr, number: 44 } }));
  f.mutate(5, doc => ({ ...state.assignGate(doc, { assignment: 'g1-a1', role: 'G1' }), blockers: ['Waiting for a key'] }));
  f.mutate(6, () => ({ blockers: ['Laptop offline'] }));
  f.run();
  assert.deepEqual(f.rows().map(([issue, status]) => `${issue} ${status}`), ['#5 NOW · IN PROGRESS', '#3 NOW · AGENT UAT', '#4 NOW · CLOSE CHECK', '#2 QUEUED', '#6 QUEUED']);
  assert.equal(f.rows().find(([issue]) => issue === '#6')[2], 'Blocked: Laptop offline');
  const current = f.github.issues.get(1).body.split('**In progress**')[1].split('\n\n')[0];
  assert.deepEqual(current.trim().split('\n').map(line => line.split(' ')[1]), ['#5', '#3', '#4'], 'queued rows, blocked or not, leave CURRENT');
  assert.match(f.github.issues.get(1).body, /Holds: 2 /, 'both blocked tasks still count as holds');
});

test('the same state always gives the same bytes, whatever order the catalogue lists its tasks in', () => {
  const f = fixture(WORK_ORDER);
  f.run();
  const parent = f.parent();
  const children = new Map(parent.outcomes.map(outcome => [outcome.issue, f.child(outcome.issue)]));
  const render = doc => [state.renderParentBlockBody(doc, children, new Map()), state.renderCurrentBlockBody(doc, children, new Map(), new Date(epoch).toISOString())].join('\n');
  const shuffled = { ...parent, outcomes: [...parent.outcomes].reverse() };
  assert.equal(render(shuffled), render(parent));
  assert.equal(render(parent), render(structuredClone(parent)));
  assert.deepEqual(state.queueOrder([...parent.outcomes].reverse()).rows.map(outcome => outcome.issue), state.queueOrder(parent.outcomes).rows.map(outcome => outcome.issue));
});

test('a dependency loop is reported once and never looped: both tasks keep their step order', () => {
  const f = fixture([{ issue: 2, after: [3] }, { issue: 3, after: [2] }, { issue: 4, after: [3] }, { issue: 5, size: 'S' }]);
  const report = f.run();
  assert.deepEqual(issuesOf(f.rows()), [5, 2, 3, 4], 'the loop keeps hand order; a task waiting on it still follows it');
  assert.deepEqual(report.findings.filter(entry => entry.code === 'DEPENDENCY_CYCLE').map(entry => entry.detail.split(' wait')[0]), ['#2, #3']);
  assert.deepEqual(openCodes(f).filter(code => code === 'DEPENDENCY_CYCLE'), ['DEPENDENCY_CYCLE']);
  assert.equal(state.FINDING_CODES.DEPENDENCY_CYCLE.queue, undefined, 'report-only, not a work-queue finding');
});

test('a prerequisite in flight or finished is already met, so the dependent keeps its own place', () => {
  const f = fixture([{ issue: 2, after: [4, 5] }, { issue: 3 }, { issue: 4, lifecycle: 'ACTIVE' }, { issue: 5, lifecycle: 'DONE' }]);
  f.run();
  assert.deepEqual(issuesOf(f.rows()), [4, 2, 3, 5]);
});

test('the LATER band and its batch alarm are gone: a planned-only graph raises no BATCH_NEXT, however long it waits', () => {
  const f = fixture([{ issue: 2 }, { issue: 3 }]);
  f.run(); f.time(epoch + 3 * 3600 * 1000); const report = f.run();
  assert.ok(!report.findings.some(entry => entry.code === 'BATCH_NEXT'));
  assert.ok(!Object.hasOwn(state.FINDING_CODES, 'BATCH_NEXT'));
  assert.ok(!f.rows().some(([, status]) => /LATER|NOW · QUEUED/.test(status)));
});

for (const [code, issue] of [['BATCH_NEXT', 1], ['QUEUED_BUT_MOVING', 2]]) test(`a stored ${code} finding from an older Toolkit still reads, is never listed as open, and the next write drops it`, () => {
  const f = fixture([{ issue: 2 }]);
  f.run();
  const read = f.store.read('parent', 1);
  const doc = structuredClone(read.doc);
  const stamp = new Date(epoch).toISOString();
  doc.attention = [...(doc.attention || []), { id: state.findingId('reconcile', code, issue), source: 'reconcile', code, issue, head: null, state: 'new', first_seen: stamp, changed_at: stamp }];
  assert.deepEqual(state.validateParent(doc), [], 'the old code still reads');
  // Stored as an older Toolkit wrote it, bytes and all.
  f.github.putFile(f.store.docPath('parent', 1), doc); f.store.ownWrites?.clear();
  assert.ok(f.parent().attention.some(entry => entry.code === code), 'the stored file holds it and reads');
  assert.ok(!state.openFindings(f.parent().attention).some(entry => entry.code === code), 'never counted or listed as open');
  assert.equal(state.attentionCounts(f.parent().attention).new, state.attentionCounts(f.parent().attention.filter(entry => entry.code !== code)).new, 'nor in the attention counts');
  assert.ok(!Object.hasOwn(state.FINDING_CODES, code));
  f.time(epoch + 60 * 1000); f.run();
  assert.ok(!f.parent().attention.some(entry => entry.code === code), 'the next write drops it');
  assert.deepEqual(state.validateParent(f.parent()), []);
});

test('the validator refuses bad work-order fields with a named error', () => {
  const doc = state.newParent({ repository: 'example.test/app', parentIssue: 1, outcomes: [{ issue: 2, class: 'COMMITTED', parent: 1, order: 1 }, { issue: 3, class: 'COMMITTED', parent: 1, order: 2 }] });
  const errors = patch => state.validateParent({ ...doc, outcomes: [{ ...doc.outcomes[0], ...patch }, doc.outcomes[1]] });
  assert.deepEqual(errors({ priority: 'P1', size: 'S', after: [3] }), []);
  assert.match(errors({ priority: 'P2' }).join('\n'), /outcomes\[0\]\.priority must be P0 or P1, or left out/);
  assert.match(errors({ size: 'XL' }).join('\n'), /outcomes\[0\]\.size must be S, M, L, or left out/);
  assert.match(errors({ priority: 'P0', last: true }).join('\n'), /priority cannot go with last or class OPTIONAL/);
  assert.match(errors({ priority: 'P0', class: 'OPTIONAL' }).join('\n'), /priority cannot go with last or class OPTIONAL/);
  assert.match(errors({ after: [9] }).join('\n'), /outcome 2: after names #9, which is not a catalogued task/);
  assert.match(errors({ after: [2] }).join('\n'), /outcome 2: after cannot name the task itself/);
  assert.match(errors({ after: [3, 3] }).join('\n'), /outcome 2: after names an issue twice/);
  assert.match(errors({ after: [] }).join('\n'), /outcome 2: after must be a list of issue numbers/);
  assert.match(errors({ after: '3' }).join('\n'), /outcome 2: after must be a list of issue numbers/);
});

test('show --queue explains each queued row and writes nothing', () => {
  const f = fixture(WORK_ORDER);
  f.run();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-order-')); temps.push(dir);
  let out = '';
  const deps = { transport: f.github, binding: f.binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: dir, toolkitVersion: '3.55.1',
    lockFile: path.join(dir, 'pass.lock'), attentionDir: path.join(dir, 'attention'), stateCheckpointDir: path.join(dir, 'checkpoints'),
    environment: {}, now: () => new Date(epoch).toISOString(), stdout: { write: text => { out += text; } } };
  const writes = () => f.github.calls.filter(call => call.method !== 'GET' && call.path !== 'graphql').length;
  const before = writes();
  assert.equal(cli.main(['show', '--queue', '--json'], deps), 0);
  const result = JSON.parse(out);
  assert.deepEqual(result.queue.rows.map(row => [row.place, row.issue, row.step]), [[1, 3, 'priority'], [2, 2, 'priority'], [3, 4, 'quick'], [4, 9, 'other'], [5, 8, 'other'], [6, 5, 'other'], [7, 6, 'last'], [8, 7, 'last']]);
  assert.equal(result.queue.rows[4].why, 'order 4, after #9, moved after #9');
  assert.equal(result.queue.rows[0].why, 'priority P1, size S, order 2');
  assert.equal(result.queue.rows[7].why, 'optional, order 8');
  out = '';
  assert.equal(cli.main(['show', '--queue'], deps), 0);
  assert.match(out, /^Queue of #1 \(state revision \d+\), in work order/);
  assert.match(out, /^5\. #8 · other · order 4, after #9, moved after #9$/m);
  assert.equal(writes(), before, 'read-only');
  assert.throws(() => cli.parseArgs(['show', '--queue', '--issue', '2']), { code: 'USAGE' });
  assert.throws(() => cli.parseArgs(['refresh', '--queue']), { code: 'USAGE' });
});
