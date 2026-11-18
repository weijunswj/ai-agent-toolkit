'use strict';

// The parent page's locked layout: a slim CURRENT, a graph of Task | Child # | Status | Waiting on |
// Last Updated with the latest ten COMPLETED rows on the page and the rest behind one link line, a one-line
// AGENT CONTEXT, and a run-checked page budget (BODY_OVER_BUDGET).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { renderScaleFixture } = require('./support/programme-render-scale.cjs');

const HEADER = '| Task | Child # | Status | Waiting on | Last Updated (SGT) |';
const cellsOf = row => row.slice(1, -1).split(/(?<!\\)\|/);
const rowsOf = text => text.split('\n').filter(line => line.startsWith('|') && /^#\d+$/.test(cellsOf(line)[1] || ''));

test('graph columns: the task name, its child number, one status, what it waits on and the update time; PRs stay on the task page', () => {
  const f = renderScaleFixture(state);
  const graph = state.renderParentBlockBody(f.parent, f.children, f.issues);
  assert.ok(graph.split('\n').includes(HEADER), graph.slice(0, 600));
  assert.doesNotMatch(graph, /Task Description|OPTIONAL|LATER · |\| PRs? /);
  const rows = rowsOf(graph);
  assert.equal(rows.length, 72);
  for (const row of rows) {
    const cells = cellsOf(row);
    assert.equal(cells.length, 5, row);
    const issue = Number(/^#(\d+)$/.exec(cells[1])[1]);
    const child = f.children.get(issue);
    const status = child.lifecycle === 'DONE' ? 'COMPLETED' : child.lifecycle === 'RETIRED' ? 'RETIRED'
      : child.lifecycle === 'ACTIVE' ? (child.blockers.length ? 'NOW · QUEUED' : 'NOW · IN PROGRESS') : 'LATER';
    assert.equal(cells[2], status, row);
    assert.match(cells[0], /^Programme task \d+/, 'the Task cell is the name alone; the number has its own column');
    for (const pr of [child.pr, ...child.prs]) assert.ok(!row.includes(`#${pr.number}`), `${row} names no PR`);
  }
});

test('Waiting on names the owner ask, a blocker or the gate, and nothing for queued or finished rows', () => {
  const f = renderScaleFixture(state);
  const at = issue => cellsOf(rowsOf(state.renderParentBlockBody(f.parent, f.children, f.issues)).find(row => cellsOf(row)[1] === `#${issue}`))[3];
  const set = (issue, change) => { const child = f.children.get(issue); change(child); };
  set(500, child => { child.lifecycle = 'WAITING_OWNER'; });
  set(501, child => { child.gate.role = 'G2'; child.pr.number = 2005; child.pr.state = 'OPEN'; child.uat.state = 'PENDING'; });
  set(502, child => { child.blockers = ['waits for PR 1098']; });
  set(503, child => { child.gate.role = 'G1'; });
  assert.equal(at(500), 'Owner: decision');
  assert.equal(at(501), 'Owner: UAT on PR #2005');
  assert.equal(at(502), 'Blocked: waits for PR 1098');
  assert.equal(at(503), 'G1');
  assert.equal(at(510), '-', 'a queued task waits on nobody');
  assert.equal(at(520), '-', 'a finished task waits on nobody');
});

test('a gate at work is the current step; a UAT still owed on an earlier PR shows after it, never in its place', () => {
  const f = renderScaleFixture(state);
  const row = issue => cellsOf(rowsOf(state.renderParentBlockBody(f.parent, f.children, f.issues)).find(line => cellsOf(line)[1] === `#${issue}`))[3];
  const current = () => state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  const child = f.children.get(504);
  Object.assign(child.pr, { number: 2017, state: 'MERGED', head: 'c'.repeat(40) });
  Object.assign(child.uat, { state: 'PENDING', at_head: 'c'.repeat(40) });
  Object.assign(child.gate, { role: 'G1', state: 'ACTIVE', assignment: { id: 'a-504-g1', role: 'G1' } });
  assert.equal(row(504), 'G1, then Owner: UAT on PR #2017');
  assert.match(current(), /^- #504 [^\n]* · PR #2017 · G1 · then your UAT on PR #2017$/m);
  child.gate.state = 'ASSIGNED';
  assert.equal(row(504), 'G1, then Owner: UAT on PR #2017', 'an assigned gate is the next step too');
  for (const idle of ['SUBMITTED', 'INTERRUPTED', 'RETIRED', null]) {
    child.gate.state = idle;
    assert.equal(row(504), 'Owner: UAT on PR #2017', `a ${idle || 'missing'} gate leaves the UAT the current step`);
    assert.match(current(), /^- #504 [^\n]* · waiting on you: your UAT on PR #2017$/m);
  }
  child.gate.state = 'ACTIVE';
  child.blockers = ['waits for PR 1098'];
  assert.equal(row(504), 'Owner: UAT on PR #2017', 'a blocked gate is not at work');
  child.blockers = [];
  child.gate.state = 'WAITING_OWNER';
  assert.equal(row(504), 'Owner: decision');
});

test('a task waiting on the owner with a UAT still owed waits on that UAT, in the graph and in CURRENT; a gate waiting on the owner is still a decision', () => {
  const f = renderScaleFixture(state);
  const row = issue => cellsOf(rowsOf(state.renderParentBlockBody(f.parent, f.children, f.issues)).find(line => cellsOf(line)[1] === `#${issue}`))[3];
  const current = () => state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  const child = f.children.get(504);
  child.lifecycle = 'WAITING_OWNER';
  Object.assign(child.pr, { number: 2017, state: 'MERGED', head: 'c'.repeat(40) });
  Object.assign(child.uat, { state: 'PENDING', at_head: 'c'.repeat(40) });
  assert.equal(row(504), 'Owner: UAT on PR #2017');
  assert.match(current(), /^- #504 [^\n]* · PR #2017 · waiting on you: your UAT on PR #2017$/m);
  Object.assign(child.gate, { role: 'G2', state: 'WAITING_OWNER', assignment: { id: 'a-504-g2', role: 'G2' } });
  assert.equal(row(504), 'Owner: decision', 'the gate asked the owner something');
  assert.match(current(), /^- #504 [^\n]* · PR #2017 · G2 · waiting on you: your decision$/m);
});

// A small programme for the owner-step cases: one outcome per child, all committed and in order.
function ownerFixture(changes) {
  const outcomes = Object.keys(changes).map((issue, order) => ({ issue: Number(issue), class: 'COMMITTED', parent: 7, order }));
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const children = new Map(outcomes.map(outcome => {
    const child = { ...state.newChild({ repository: 'acme/app', outcome }), lifecycle: 'ACTIVE' };
    changes[outcome.issue](child);
    return [outcome.issue, child];
  }));
  const cell = issue => cellsOf(rowsOf(state.renderParentBlockBody(parent, children)).find(line => cellsOf(line)[1] === `#${issue}`));
  return { parent, children, cell };
}

test('owner waits: one owner step per task feeds the board and the list, so the Waiting on cell says Owner: exactly for listed tasks', () => {
  const head = 'c'.repeat(40);
  const uat = (child, number) => { Object.assign(child.pr, { number, state: 'OPEN', head }); Object.assign(child.uat, { state: 'PENDING', at_head: head }); };
  const f = ownerFixture({
    601: child => { Object.assign(child.gate, { role: 'G2', state: 'WAITING_OWNER', assignment: { id: 'a-601', role: 'G2' } }); },
    602: child => { child.lifecycle = 'WAITING_OWNER'; uat(child, 2602); },
    603: child => { child.lifecycle = 'WAITING_OWNER'; },
    604: child => { uat(child, 2604); },
    605: child => { uat(child, 2605); Object.assign(child.gate, { role: 'G2', state: 'ACTIVE', assignment: { id: 'a-605', role: 'G2' } }); },
    606: child => { child.blockers = ['waits for #605']; },
    607: child => { child.lifecycle = 'DONE'; uat(child, 2607); },
    608: child => { child.lifecycle = 'PLANNED'; },
  });
  assert.deepEqual(state.ownerWaits(f.parent, f.children), [
    { issue: 601, ask: 'decision', after: null, pr: null, head: null },
    { issue: 602, ask: 'UAT on PR #2602', after: null, pr: 2602, head },
    { issue: 603, ask: 'decision', after: null, pr: null, head: null },
    { issue: 604, ask: 'UAT on PR #2604', after: null, pr: 2604, head },
    { issue: 605, ask: 'UAT on PR #2605', after: 'G2', pr: 2605, head },
  ], 'blocked, finished and queued tasks wait on nobody');
  const listed = new Set(state.ownerWaits(f.parent, f.children).map(entry => entry.issue));
  for (const issue of f.children.keys()) {
    assert.equal(/\bOwner: /.test(f.cell(issue)[3]), listed.has(issue), `#${issue}: ${f.cell(issue)[3]}`);
  }
  assert.equal(f.cell(605)[3], 'G2, then Owner: UAT on PR #2605');
});

test('CURRENT never says a blocked task waits on the owner: a blocker is not an owner step', () => {
  const f = ownerFixture({ 611: child => { child.blockers = ['waits for #612']; }, 612: child => { child.lifecycle = 'WAITING_OWNER'; } });
  const current = state.renderCurrentBlockBody(f.parent, f.children, new Map(), '2026-11-18T00:00:00Z');
  assert.match(current, /^- #611 [^\n]* · blocked: waits for #612$/m);
  assert.doesNotMatch(current, /waiting on you: blocked/);
  assert.match(current, /^- #612 [^\n]* · waiting on you: your decision$/m);
});

test('a live gate outranks a listed blocker on the board, and its return puts the task back in the queue with no blocker write', () => {
  const f = ownerFixture({ 621: child => { child.lifecycle = 'PLANNED'; child.blockers = ['waits for PR 1098']; } });
  const status = () => f.cell(621)[2];
  assert.equal(status(), 'LATER', 'planned with no PR');
  f.children.set(621, state.assignGate(f.children.get(621), { assignment: 'a-621-g1', role: 'G1' }));
  assert.equal(status(), 'NOW · IN PROGRESS', 'an assigned gate is work in progress, blocker or not');
  assert.equal(f.cell(621)[3], 'G1, then Blocked: waits for PR 1098');
  f.children.get(621).gate.state = 'ACTIVE';
  assert.equal(status(), 'NOW · IN PROGRESS');
  f.children.set(621, state.recordReturn(f.children.get(621), { returnId: 'r-621-g1', assignment: 'a-621-g1' }));
  assert.equal(status(), 'NOW · QUEUED', 'the return leaves the blocker standing');
  assert.equal(f.cell(621)[3], 'Blocked: waits for PR 1098');
  assert.deepEqual(f.children.get(621).blockers, ['waits for PR 1098'], 'no blocker was cleared');
  f.children.get(621).lifecycle = 'PLANNED';
  assert.equal(status(), 'LATER', 'set back to planned with no PR');
});

test('CURRENT lists tasks in progress before queued ones, whatever their priority', () => {
  const outcomes = [{ issue: 2, class: 'COMMITTED', parent: 7, order: 0 }, { issue: 3, class: 'COMMITTED', parent: 7, order: 1 }];
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const doc = (outcome, changes) => ({ ...state.newChild({ repository: 'acme/app', outcome }), lifecycle: 'ACTIVE', ...changes });
  const children = new Map([[2, doc(outcomes[0], { blockers: ['waits for #3'] })], [3, doc(outcomes[1], {})]]);
  const listed = state.renderCurrentBlockBody(parent, children, new Map(), '2026-11-18T00:00:00Z').split('\n')
    .filter(line => /^- #\d+ /.test(line)).map(line => Number(/^- #(\d+) /.exec(line)[1]));
  assert.deepEqual(listed, [3, 2]);
});

test('CURRENT is slim: in progress, one attention line with holds, no Start next or finding lists', () => {
  const f = renderScaleFixture(state);
  f.children.get(500).blockers = ['waits for PR 1098'];
  f.parent.attention = state.foldAttention(f.parent.attention, { source: 'reconcile', complete: false, now: '2026-11-07T00:00:00Z',
    seen: [{ code: 'TASK_IDLE', issue: 505 }] });
  const current = state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  assert.doesNotMatch(current, /Start next|\*\*Work queue\*\*|\*\*Waiting on you\*\*|^- CHILD_REOPENED/m);
  assert.match(current, /^\*\*In progress\*\*$/m);
  assert.match(current, /^- #500 Programme task 1: shared service behaviour/m);
  assert.match(current, /^\*\*Attention: \d+ new, 0 acknowledged, 1 in the work queue, 106 waiting on you\*\* · Holds: 1 · Full list: `programme\.cjs attention`$/m);
  assert.ok(current.length < 1500, `CURRENT is ${current.length} characters`);
});

test('AGENT CONTEXT is one line: the Agent context link, archived notes and the decisions command', () => {
  const comments = [{ id: 77, body: 'Agent context\n---\nbackground', user: { login: 'owner' }, created_at: '2026-11-01T00:00:00Z' }];
  const body = state.renderContextBlockBody(421, comments, 'example.test/app', [{ title: 'Notes archived 2026-11-14 (part 1 of 1)', link: 'https://example.test/c/1' }]);
  const lines = body.split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith('<!--'));
  assert.equal(lines.length, 1, body);
  assert.match(lines[0], /^Agent context: \[comment 77\]\(https:\/\/github\.com\/example\.test\/app\/issues\/421#issuecomment-77\) · Notes: \[Notes archived 2026-11-14 \(part 1 of 1\)\]\(https:\/\/example\.test\/c\/1\) · Decisions: `programme\.cjs trace 421`$/);
  const none = state.renderContextBlockBody(421, [], 'example.test/app', []).split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith('<!--'));
  assert.deepEqual(none, ['Agent context: none yet · Decisions: `programme.cjs trace 421`']);
});

test('the page keeps the latest ten COMPLETED rows; older completed and retired rows sit behind one link line', () => {
  const f = renderScaleFixture(state, { proseSize: 400 });
  for (const [i, number] of [...f.children.keys()].entries()) {
    const child = f.children.get(number);
    if (child.lifecycle === 'DONE') {
      child.completed_at = `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`;
      f.store.write('child', number, child, { sha: f.store.read('child', number).sha, previous: f.store.read('child', number).doc });
    }
  }
  const result = f.reconciler.run({ apply: true });
  assert.deepEqual(result.holds, []);
  const body = f.github.issues.get(421).body;
  const rows = rowsOf(body);
  const completed = rows.filter(row => cellsOf(row)[2] === 'COMPLETED');
  assert.equal(completed.length, 10);
  assert.equal(rows.filter(row => cellsOf(row)[2] === 'RETIRED').length, 0);
  assert.equal(rows.length, 18 + 10);
  // The ten most recent completions stay, most recent last.
  const done = [...f.children.values()].filter(child => child.lifecycle === 'DONE').sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.issue - b.issue);
  assert.deepEqual(completed.map(row => Number(cellsOf(row)[1].slice(1))), done.slice(-10).map(child => child.issue));
  const link = body.split('\n').find(line => line.startsWith('[Earlier completed'));
  assert.match(link, /^\[Earlier completed \(30\)\]\(https:\/\/github\.com\/example\.test\/app\/issues\/421#issuecomment-\d+\) · \[Retired \(14\)\]\(https:\/\/github\.com\/example\.test\/app\/issues\/421#issuecomment-\d+\)$/);
  assert.doesNotMatch(body, /^Archived: /m);
  const archived = [...f.github.comments.values()].filter(comment => comment.issue === 421 && /^<!-- programme-page-archive key=graph-/.test(comment.body));
  assert.equal(archived.length, 2);
  for (const comment of archived) assert.ok(comment.body.split('\n').includes(HEADER), comment.body.slice(0, 300));
  assert.equal(archived.reduce((sum, comment) => sum + rowsOf(comment.body).length, 0), 44);
  assert.ok(body.length < state.PAGE_BUDGETS.parent, `parent is ${body.length} characters`);
  assert.ok(!f.store.read('parent', 421).doc.attention.some(entry => entry.code === 'BODY_OVER_BUDGET'));
  const before = { commits: f.github.commits, writes: f.github.mutations() };
  assert.deepEqual(f.reconciler.run({ apply: true }).holds, []);
  assert.deepEqual({ commits: f.github.commits, writes: f.github.mutations() }, before, 'a settled page makes no writes');
});

test('a parent over its 10,000-character budget raises BODY_OVER_BUDGET with size diagnostics, and it clears once under', () => {
  const f = renderScaleFixture(state, { proseSize: 12000 });
  const result = f.reconciler.run({ apply: true });
  assert.deepEqual(result.holds, [], 'over budget still writes the page');
  const finding = f.store.read('parent', 421).doc.attention.find(entry => entry.code === 'BODY_OVER_BUDGET');
  assert.ok(finding, 'the finding is recorded');
  assert.equal(finding.issue, 421);
  assert.equal(finding.state, 'new');
  assert.equal(finding.diagnostics.threshold, 10000);
  assert.equal(finding.diagnostics.projected_total, f.github.issues.get(421).body.length);
  assert.ok(finding.diagnostics.largest_sections.some(part => part.kind === 'hand_written'));
  // The owner's notes go under one `## Archive` line; the next pass moves them and the finding clears.
  const issue = f.github.issues.get(421);
  issue.body = issue.body.replace('## Owner notes', '## Archive');
  f.reconciler.run({ apply: true });
  f.reconciler.run({ apply: true });
  assert.ok(f.github.issues.get(421).body.length < 10000, `${f.github.issues.get(421).body.length}`);
  assert.equal(f.store.read('parent', 421).doc.attention.find(entry => entry.code === 'BODY_OVER_BUDGET')?.state, 'resolved');
});

test('BODY_OVER_BUDGET is a known size code in runtime and schema', () => {
  assert.equal(state.FINDING_CODES.BODY_OVER_BUDGET.source, 'reconcile');
  assert.deepEqual(state.PAGE_BUDGETS, { parent: 10000, child: 4000, pr: 3000 });
  assert.equal(state.pageBudgetFinding(421, 'x'.repeat(9999), state.PAGE_BUDGETS.parent), null);
  const over = state.pageBudgetFinding(421, 'x'.repeat(10000), state.PAGE_BUDGETS.parent);
  assert.equal(over.code, 'BODY_OVER_BUDGET');
  assert.equal(over.diagnostics.required_reduction, 1);
  const Ajv2020 = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421 });
  parent.attention = state.foldAttention([], { source: 'reconcile', complete: false, now: '2026-11-01T00:00:00Z', seen: [over] });
  assert.deepEqual(state.validateParent(parent), []);
  assert.equal(validate(parent), true, JSON.stringify(validate.errors));
  const bare = { ...parent, attention: [{ ...parent.attention[0], diagnostics: undefined }] };
  delete bare.attention[0].diagnostics;
  assert.equal(validate(bare), false, 'diagnostics are required');
});
