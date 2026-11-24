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
// Agent UAT first: an owed UAT is the owner's step only once the agent's UAT passed at its head.
const agentPassed = child => { child.private = { ...child.private, agent_uat: { state: 'PASSED', at_head: child.uat.at_head, evidence: 'evidence/agent-uat/REPORT.md' } }; };

test('graph columns: the task name, its child number, one status, what it waits on and the update time; PRs stay on the task page', () => {
  const f = renderScaleFixture(state);
  const graph = state.renderParentBlockBody(f.parent, f.children, f.issues);
  assert.ok(graph.split('\n').includes(HEADER), graph.slice(0, 600));
  assert.doesNotMatch(graph, /Task Description|OPTIONAL|LATER|NOW · QUEUED|\| PRs? /);
  const rows = rowsOf(graph);
  assert.equal(rows.length, 72);
  for (const row of rows) {
    const cells = cellsOf(row);
    assert.equal(cells.length, 5, row);
    const issue = Number(/^#(\d+)$/.exec(cells[1])[1]);
    const child = f.children.get(issue);
    const status = child.lifecycle === 'DONE' ? 'COMPLETED' : child.lifecycle === 'RETIRED' ? 'RETIRED'
      : child.lifecycle === 'ACTIVE' && !child.blockers.length ? 'NOW · IN PROGRESS' : 'QUEUED';
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
  set(501, child => { child.gate.role = 'G2'; Object.assign(child.pr, { number: 2005, state: 'OPEN', head: 'c'.repeat(40) }); Object.assign(child.uat, { state: 'PENDING', at_head: 'c'.repeat(40) }); agentPassed(child); });
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
  agentPassed(child);
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
  agentPassed(child);
  assert.equal(row(504), 'Owner: UAT on PR #2017');
  assert.match(current(), /^- #504 [^\n]* · PR #2017 · merged, close check · waiting on you: your UAT on PR #2017$/m);
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
  const uat = (child, number, agent = true) => { Object.assign(child.pr, { number, state: 'OPEN', head }); Object.assign(child.uat, { state: 'PENDING', at_head: head }); if (agent) agentPassed(child); };
  const f = ownerFixture({
    601: child => { Object.assign(child.gate, { role: 'G2', state: 'WAITING_OWNER', assignment: { id: 'a-601', role: 'G2' } }); },
    602: child => { child.lifecycle = 'WAITING_OWNER'; uat(child, 2602); },
    603: child => { child.lifecycle = 'WAITING_OWNER'; },
    604: child => { uat(child, 2604); },
    605: child => { uat(child, 2605); Object.assign(child.gate, { role: 'G2', state: 'ACTIVE', assignment: { id: 'a-605', role: 'G2' } }); },
    606: child => { child.blockers = ['waits for #605']; },
    607: child => { child.lifecycle = 'DONE'; uat(child, 2607); },
    608: child => { child.lifecycle = 'PLANNED'; },
    609: child => { child.lifecycle = 'WAITING_OWNER'; uat(child, 2609, false); },
    610: child => { uat(child, 2610, false); },
  });
  assert.deepEqual(state.ownerWaits(f.parent, f.children), [
    { issue: 601, ask: 'decision', after: null, gate_live: true, pr: null, head: null },
    { issue: 602, ask: 'UAT on PR #2602', after: null, agent_uat: 'PASSED', uat_head: head, pr_state: 'OPEN', gate_live: false, pr: 2602, head },
    { issue: 603, ask: 'decision', after: null, gate_live: false, pr: null, head: null },
    { issue: 604, ask: 'UAT on PR #2604', after: null, agent_uat: 'PASSED', uat_head: head, pr_state: 'OPEN', gate_live: false, pr: 2604, head },
    { issue: 605, ask: 'UAT on PR #2605', after: 'G2', agent_uat: 'PASSED', uat_head: head, pr_state: 'OPEN', gate_live: true, pr: 2605, head },
  ], 'blocked, finished and queued tasks, and UATs the agent still owes, wait on nobody');
  const listed = new Set(state.ownerWaits(f.parent, f.children).map(entry => entry.issue));
  for (const issue of f.children.keys()) {
    assert.equal(/\bOwner: /.test(f.cell(issue)[3]), listed.has(issue), `#${issue}: ${f.cell(issue)[3]}`);
  }
  assert.equal(f.cell(605)[3], 'G2, then Owner: UAT on PR #2605');
  assert.deepEqual([f.cell(609)[3], f.cell(610)[3]], ['Agent: UAT on PR #2609', 'Agent: UAT on PR #2610']);
});

test('CURRENT never says a blocked task waits on the owner: a blocker is not an owner step', () => {
  const f = ownerFixture({ 611: child => { child.blockers = ['waits for #612']; child.gate = { ...child.gate, role: 'G1', state: 'ACTIVE' }; }, 612: child => { child.lifecycle = 'WAITING_OWNER'; } });
  const current = state.renderCurrentBlockBody(f.parent, f.children, new Map(), '2026-11-18T00:00:00Z');
  assert.match(current, /^- #611 [^\n]* · G1 · blocked: waits for #612$/m, 'a blocked task under a live gate is in flight');
  assert.doesNotMatch(current, /waiting on you: blocked/);
  assert.match(current, /^- #612 [^\n]* · waiting on you: your decision$/m);
});

test('a live gate outranks a listed blocker on the board, and its return puts the task back in the queue with no blocker write', () => {
  const f = ownerFixture({ 621: child => { child.lifecycle = 'PLANNED'; child.blockers = ['waits for PR 1098']; } });
  const status = () => f.cell(621)[2];
  assert.equal(status(), 'QUEUED', 'planned with no PR');
  f.children.set(621, state.assignGate(f.children.get(621), { assignment: 'a-621-g1', role: 'G1' }));
  assert.equal(status(), 'NOW · IN PROGRESS', 'an assigned gate is work in progress, blocker or not');
  assert.equal(f.cell(621)[3], 'G1, then Blocked: waits for PR 1098');
  f.children.get(621).gate.state = 'ACTIVE';
  assert.equal(status(), 'NOW · IN PROGRESS');
  f.children.set(621, state.recordReturn(f.children.get(621), { returnId: 'r-621-g1', assignment: 'a-621-g1' }));
  assert.equal(status(), 'QUEUED', 'the return leaves the blocker standing');
  assert.equal(f.cell(621)[3], 'Blocked: waits for PR 1098');
  assert.deepEqual(f.children.get(621).blockers, ['waits for PR 1098'], 'no blocker was cleared');
  f.children.get(621).lifecycle = 'PLANNED';
  assert.equal(status(), 'QUEUED', 'set back to planned with no PR');
});

// A lane wait is one blocker starting `Queued in NOW:`: the task waits only for a free gate lane.
// A gate going live (assign, reopen) drops it in the same write and keeps every other blocker, so a
// gate start is one write and the board shows the worked task in progress after its gate returns.
const LANE_WAIT = 'Queued in NOW: one child at a time; starts when the gate lane frees (INT-TK421-1069)';
// A G2 is accepted only on its PASS verdict, which the command line reads from the task PR.
const G2_PASS = { verdict: 'PASS', head: 'c'.repeat(40), link: 'https://github.com/acme/app/pull/1#issuecomment-1' };

test('a lane wait is a blocker starting `Queued in NOW:`; any other blocker, other `Queued` labels included, is a real block', () => {
  for (const text of [LANE_WAIT, 'Queued in NOW:']) assert.equal(state.isLaneWait(text), true, text);
  for (const text of ['waits for PR 1098', 'queued behind #12', 'Queuedness', ' Queued in NOW:', 'Blocked: Queued in NOW:', 'Queued in NOW', 'queued in NOW: x', '', null,
    'Queued', 'Queued behind #1322 for the gate lane', 'Queued 1 - after Alpha2', 'Queued 1 — after Alpha2', 'Queued, not idle: x', 'Queued leftover: x', 'Queued after #1419: x']) {
    assert.equal(state.isLaneWait(text), false, String(text));
  }
});

test('assign drops the lane wait in the same write, keeps every other blocker, and the task stays in progress after its gate returns', () => {
  const f = ownerFixture({ 641: child => { child.blockers = [LANE_WAIT]; }, 642: child => { child.blockers = [LANE_WAIT, 'waits for PR 1098']; } });
  const writer = { session: 'toolkit-controller', prefix: 'INT-TK-' };
  Object.assign(f.parent.fence, { holder_session: writer.session, holder_prefix: writer.prefix });
  const step = (issue, change) => f.children.set(issue, change(f.children.get(issue)));
  const board = issue => `${f.cell(issue)[2]} | ${f.cell(issue)[3]}`;
  assert.equal(board(641), `QUEUED | Blocked: ${LANE_WAIT}`, 'control: the lane wait queues the task');
  step(641, child => state.assignGate(child, { assignment: 'g2-641', role: 'G2' }));
  assert.deepEqual(f.children.get(641).blockers, [], 'assign dropped the lane wait');
  assert.equal(board(641), 'NOW · IN PROGRESS | G2');
  step(641, child => state.recordReturn(child, { returnId: 'g2-641.r1', assignment: 'g2-641' }));
  step(641, child => state.consumeReturn(child, { returnId: 'g2-641.r1', verdict: 'ACCEPT', writer, parentDoc: f.parent, review: G2_PASS }));
  assert.equal(f.cell(641)[2], 'NOW · IN PROGRESS', 'an accepted gate waiting for its train is not queued for a lane again');
  step(642, child => state.assignGate(child, { assignment: 'g1-642', role: 'G1' }));
  assert.deepEqual(f.children.get(642).blockers, ['waits for PR 1098'], 'every other blocker stays');
  assert.equal(board(642), 'NOW · IN PROGRESS | G1, then Blocked: waits for PR 1098');
  f.children.get(642).blockers.unshift(LANE_WAIT);
  step(642, child => state.assignGate(child, { assignment: 'g2-642', role: 'G2', supersede: true, reason: 'G2 follows G1' }));
  assert.deepEqual(f.children.get(642).blockers, ['waits for PR 1098'], 'assign --supersede drops it too');
  assert.throws(() => state.assignGate({ ...f.children.get(642), blockers: [LANE_WAIT] }, { assignment: 'g2-642b', role: 'G2' }), { code: 'ASSIGNMENT_LIVE' }, 'a refused assign writes nothing');
});

test('reopen drops the lane wait in each of its three branches and keeps every other blocker', () => {
  const writer = { session: 'toolkit-controller', prefix: 'INT-TK-' };
  const f = ownerFixture({ 651: () => {}, 652: () => {}, 653: () => {} });
  Object.assign(f.parent.fence, { holder_session: writer.session, holder_prefix: writer.prefix });
  const step = (issue, change) => f.children.set(issue, change(f.children.get(issue)));
  const wait = (issue, ...others) => { f.children.get(issue).blockers = [LANE_WAIT, ...others]; };
  // An accepted gate reopened under a new assignment.
  step(651, child => state.assignGate(child, { assignment: 'g0-651', role: 'G0' }));
  step(651, child => state.recordReturn(child, { returnId: 'g0-651.r1', assignment: 'g0-651' }));
  step(651, child => state.consumeReturn(child, { returnId: 'g0-651.r1', verdict: 'ACCEPT', writer, parentDoc: f.parent }));
  wait(651);
  step(651, child => state.reopenGate(child, { reason: 'second G0', assignment: 'g0-651b' }));
  assert.deepEqual(f.children.get(651).blockers, [], 'reopen --assignment');
  assert.equal(f.cell(651)[2], 'NOW · IN PROGRESS');
  // A submitted return sent back.
  step(652, child => state.assignGate(child, { assignment: 'g1-652', role: 'G1' }));
  step(652, child => state.recordReturn(child, { returnId: 'g1-652.r1', assignment: 'g1-652' }));
  wait(652, 'waits for PR 1098');
  step(652, child => state.reopenGate(child, { reason: 'fix the review notes' }));
  assert.deepEqual(f.children.get(652).blockers, ['waits for PR 1098'], 'reopen of a submitted return');
  // A gate waiting on the owner continues with the answer.
  step(653, child => state.assignGate(child, { assignment: 'g2-653', role: 'G2' }));
  step(653, child => state.recordReturn(child, { returnId: 'g2-653.r1', assignment: 'g2-653' }));
  step(653, child => state.consumeReturn(child, { returnId: 'g2-653.r1', verdict: 'WAITING_OWNER', writer, parentDoc: f.parent }));
  wait(653);
  step(653, child => state.reopenGate(child, { reason: 'the owner answered' }));
  assert.deepEqual(f.children.get(653).blockers, [], 'reopen of a gate waiting on the owner');
});

test('a return consumed as REOPEN drops the lane wait like reopen, and WAITING_OWNER keeps it', () => {
  const writer = { session: 'toolkit-controller', prefix: 'INT-TK-' };
  const f = ownerFixture({ 671: () => {} });
  Object.assign(f.parent.fence, { holder_session: writer.session, holder_prefix: writer.prefix });
  const submitted = state.recordReturn(state.assignGate(f.children.get(671), { assignment: 'g1-671', role: 'G1' }), { returnId: 'g1-671.r1', assignment: 'g1-671' });
  submitted.blockers = [LANE_WAIT, 'waits for PR 1098'];
  const consume = verdict => state.consumeReturn(submitted, { returnId: 'g1-671.r1', verdict, writer, parentDoc: f.parent, liveHead: null });
  const reopened = consume('REOPEN');
  assert.deepEqual([reopened.gate.state, reopened.blockers], ['ACTIVE', ['waits for PR 1098']], 'the same result as reopen of a submitted return');
  assert.deepEqual(state.reopenGate(submitted, { reason: 'fix the review notes' }).blockers, reopened.blockers);
  f.children.set(671, { ...reopened, blockers: [] });
  assert.equal(f.cell(671)[2], 'NOW · IN PROGRESS');
  const waiting = consume('WAITING_OWNER');
  assert.deepEqual([waiting.gate.state, waiting.blockers], ['WAITING_OWNER', [LANE_WAIT, 'waits for PR 1098']], 'a gate waiting on the owner is not live, so nothing is dropped');
});

test('a lane wait written after the gate ends, or around an interrupted gate, queues the task again', () => {
  const writer = { session: 'toolkit-controller', prefix: 'INT-TK-' };
  const f = ownerFixture({ 661: child => { child.blockers = [LANE_WAIT]; } });
  Object.assign(f.parent.fence, { holder_session: writer.session, holder_prefix: writer.prefix });
  const step = change => f.children.set(661, change(f.children.get(661)));
  step(child => state.assignGate(child, { assignment: 'g0-661', role: 'G0' }));
  step(child => state.recordReturn(child, { returnId: 'g0-661.r1', assignment: 'g0-661' }));
  step(child => state.consumeReturn(child, { returnId: 'g0-661.r1', verdict: 'ACCEPT', writer, parentDoc: f.parent }));
  f.children.get(661).blockers = [LANE_WAIT];
  assert.equal(f.cell(661)[2], 'QUEUED', 'the controller re-queued it after the gate');
  step(child => state.assignGate(child, { assignment: 'g1-661', role: 'G1' }));
  f.children.get(661).blockers = [LANE_WAIT];
  assert.equal(f.cell(661)[2], 'NOW · IN PROGRESS', 'a live gate outranks a wait written meanwhile');
  step(child => state.interruptGate(child, { reason: 'the thread stopped with no result' }));
  assert.deepEqual(f.children.get(661).blockers, [LANE_WAIT], 'interrupt never drops a blocker');
  assert.equal(f.cell(661)[2], 'QUEUED', 'an interrupted gate is not live, so the task queues again');
});

// The Projects route has no executor journals: the controller's holder orders open and end every
// gate (reference/periodic-runs.md, Gate assignments). This walks that route for one task: each gate
// ends, the board drops it, and the next gate supersedes a G1 return that waits for its G2.
test('the gate route a Projects controller follows: each gate ends on its return and the next one supersedes a waiting G1', () => {
  const f = ownerFixture({ 631: child => { child.lifecycle = 'PLANNED'; child.blockers = ['waits for train 76']; } });
  const writer = { session: 'toolkit-controller', prefix: 'INT-TK-' };
  Object.assign(f.parent.fence, { holder_session: writer.session, holder_prefix: writer.prefix });
  const step = change => f.children.set(631, change(f.children.get(631)));
  const close = (id, verdict = 'ACCEPT') => {
    step(child => state.recordReturn(child, { returnId: `${id}.r1`, assignment: id }));
    if (verdict) step(child => state.consumeReturn(child, { returnId: `${id}.r1`, verdict, writer, parentDoc: f.parent, review: G2_PASS }));
  };
  const board = () => `${f.cell(631)[2]} | ${f.cell(631)[3]}`;
  step(child => state.assignGate(child, { assignment: 'g0-631', role: 'G0' }));
  assert.equal(board(), 'NOW · IN PROGRESS | G0, then Blocked: waits for train 76');
  close('g0-631');
  assert.equal(f.children.get(631).gate.state, 'RETIRED');
  step(child => state.assignGate(child, { assignment: 'g1-631', role: 'G1' }));
  assert.equal(board(), 'NOW · IN PROGRESS | G1, then Blocked: waits for train 76', 'an accepted G0 needs no supersede');
  close('g1-631', null);
  assert.equal(board(), 'QUEUED | Blocked: waits for train 76', 'the recorded return ends the G1 on the board');
  assert.throws(() => state.consumeReturn(f.children.get(631), { returnId: 'g1-631.r1', verdict: 'ACCEPT', writer, parentDoc: f.parent }), { code: 'EVIDENCE_STALE' }, 'a G1 is accepted only after a G2 PASS');
  assert.throws(() => state.assignGate(f.children.get(631), { assignment: 'g2-631', role: 'G2' }), { code: 'ASSIGNMENT_LIVE' }, 'the waiting G1 return is still live');
  step(child => state.assignGate(child, { assignment: 'g2-631', role: 'G2', supersede: true, reason: 'G2 follows G1' }));
  assert.equal(board(), 'NOW · IN PROGRESS | G2, then Blocked: waits for train 76');
  close('g2-631');
  assert.equal(board(), 'QUEUED | Blocked: waits for train 76', 'the accepted G2 is no longer live');
  assert.ok(state.completionAccepted(f.children.get(631)), 'an accepted G2 counts toward completion');
  step(child => state.assignGate(child, { assignment: 'g1-631-r2', role: 'G1' }));
  assert.equal(board(), 'NOW · IN PROGRESS | G1, then Blocked: waits for train 76', 'a rework round after a G2 needs no supersede');
  step(child => state.interruptGate(child, { reason: 'the thread stopped with no result' }));
  assert.equal(board(), 'QUEUED | Blocked: waits for train 76', 'an interrupted gate is not live');
});

test('CURRENT lists only tasks in flight: a blocked task is queued, whatever its priority', () => {
  const outcomes = [{ issue: 2, class: 'COMMITTED', parent: 7, order: 0 }, { issue: 3, class: 'COMMITTED', parent: 7, order: 1 }];
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const doc = (outcome, changes) => ({ ...state.newChild({ repository: 'acme/app', outcome }), lifecycle: 'ACTIVE', ...changes });
  const children = new Map([[2, doc(outcomes[0], { blockers: ['waits for #3'] })], [3, doc(outcomes[1], {})]]);
  const listed = state.renderCurrentBlockBody(parent, children, new Map(), '2026-11-18T00:00:00Z').split('\n')
    .filter(line => /^- #\d+ /.test(line)).map(line => Number(/^- #(\d+) /.exec(line)[1]));
  assert.deepEqual(listed, [3]);
});

// A task whose tracked task PR merged while its issue stays open reads `NOW · CLOSE CHECK`,
// never the gate that already returned. The fixture copies the shape the sweep recorded after two
// real merges: PR MERGED, lifecycle ACTIVE and an accepted G2 left RETIRED with its role still set.
const MERGED = 'NOW · CLOSE CHECK';
const MERGED_HEAD = 'c'.repeat(40);
function mergedFixture() {
  const f = renderScaleFixture(state);
  const graph = () => state.renderParentBlockBody(f.parent, f.children, f.issues);
  const row = issue => cellsOf(rowsOf(graph()).find(line => cellsOf(line)[1] === `#${issue}`));
  const board = issue => `${row(issue)[2]} | ${row(issue)[3]}`;
  const order = () => rowsOf(graph()).map(line => Number(cellsOf(line)[1].slice(1)));
  const current = () => state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  const merge = (issue, extra = {}) => {
    const child = f.children.get(issue);
    Object.assign(child.pr, { number: 3000 + issue, state: 'MERGED', head: MERGED_HEAD, merge_sha: MERGED_HEAD });
    child.prs = child.prs.map(pr => (pr.state === 'OPEN' ? { ...pr, state: 'CLOSED' } : pr));
    Object.assign(child.gate, { role: 'G2', state: 'RETIRED' });
    return Object.assign(child, extra);
  };
  return { f, graph, row, board, order, current, merge };
}

test('merged task, issue open, gate returned: NOW · CLOSE CHECK with no stale gate, active or held', () => {
  for (const lifecycle of ['ACTIVE', 'HOLD']) {
    const t = mergedFixture();
    t.merge(500, { lifecycle });
    assert.equal(t.board(500), `${MERGED} | -`, lifecycle);
  }
  const t = mergedFixture();
  t.merge(500, { gate: { role: null, state: null, session_id: null, route: null, returns: [] } });
  assert.equal(t.board(500), `${MERGED} | -`, 'no gate recorded at all');
});

test('merged and waiting on the owner with a UAT owed: the status says merged and Waiting on names the UAT', () => {
  const t = mergedFixture();
  const child = t.merge(501, { lifecycle: 'WAITING_OWNER' });
  Object.assign(child.uat, { state: 'PENDING', at_head: MERGED_HEAD });
  assert.equal(t.board(501), 'NOW · AGENT UAT | Agent: UAT on PR #3501, not started', 'the agent\'s UAT comes first');
  agentPassed(child);
  assert.equal(t.board(501), `${MERGED} | Owner: UAT on PR #3501`);
});

test('merged rows sort after NOW · IN PROGRESS and before QUEUED, and the order line names the band', () => {
  const t = mergedFixture();
  t.merge(500);
  t.f.children.get(503).blockers = ['waits for PR 1098'];
  const order = t.order();
  const statusOf = issue => t.row(issue)[2];
  const firstMerged = order.findIndex(issue => statusOf(issue) === MERGED);
  assert.ok(firstMerged > 0, 'a merged row is drawn after the rows in progress');
  assert.ok(order.slice(0, firstMerged).every(issue => statusOf(issue) === 'NOW · IN PROGRESS'), 'rows in progress lead');
  assert.equal(statusOf(order[firstMerged + 1]), 'QUEUED', 'queued rows follow the merged band');
  assert.match(t.graph(), /Order: NOW · IN PROGRESS, NOW · AGENT UAT, NOW · CLOSE CHECK, then QUEUED in work order/);
});

test('CURRENT agrees with the graph: a merged task reads merged, close check, not its returned gate', () => {
  const t = mergedFixture();
  t.merge(500);
  const line = t.current().split('\n').find(text => text.startsWith('- #500 '));
  assert.ok(line, 'the merged task is still listed in progress');
  assert.match(line, /PR #3500 · merged, close check$/);
  assert.doesNotMatch(line, /· G2/);
});

test('a listed blocker still queues a merged task, so lane waits on multi-slice tasks stay QUEUED', () => {
  const t = mergedFixture();
  const wait = 'Queued in NOW: one child at a time; starts when the gate lane frees';
  t.merge(502, { blockers: [wait] });
  assert.equal(t.board(502), `QUEUED | Blocked: ${wait}`);
  assert.equal(t.current().split('\n').find(text => text.startsWith('- #502 ')), undefined, 'a queued task leaves CURRENT');
});

test('a closed issue is COMPLETED and a task set back to planned is QUEUED, merged or not', () => {
  const t = mergedFixture();
  t.merge(500, { lifecycle: 'DONE', completed_at: '2026-11-07T00:00:00Z' });
  t.merge(501, { lifecycle: 'PLANNED' });
  assert.equal(t.board(500), 'COMPLETED | -');
  assert.equal(t.board(501), 'QUEUED | -');
});

test('a task PR opened after the merge puts the task back in progress, tracked or as another claimant', () => {
  const t = mergedFixture();
  const tracked = t.merge(500);
  tracked.prs.push({ number: 3500, state: 'MERGED', merge_sha: MERGED_HEAD });
  Object.assign(tracked.pr, { number: 3900, state: 'OPEN', head: 'd'.repeat(40), merge_sha: null });
  Object.assign(tracked.gate, { role: 'G2', state: 'ASSIGNED' });
  assert.equal(t.board(500), 'NOW · IN PROGRESS | G2');
  for (const state of ['OPEN', 'DRAFT']) {
    t.merge(501).prs.push({ number: 3901, state, head: 'e'.repeat(40) });
    assert.equal(t.row(501)[2], 'NOW · IN PROGRESS', `another task PR is ${state}`);
    t.f.children.get(501).prs.pop();
  }
});

test('a gate still at the task keeps it in progress with its gate named, whatever the merged PR', () => {
  for (const [gateState, waiting] of [['ASSIGNED', 'G1'], ['ACTIVE', 'G1'], ['SUBMITTED', 'G1'], ['INTERRUPTED', 'G1'], ['WAITING_OWNER', 'Owner: decision']]) {
    const t = mergedFixture();
    Object.assign(t.merge(500).gate, { role: 'G1', state: gateState });
    assert.equal(t.board(500), `NOW · IN PROGRESS | ${waiting}`, gateState);
  }
});

test('a task whose tracked PR closed unmerged or that has no PR stays NOW · IN PROGRESS with its gate', () => {
  const t = mergedFixture();
  Object.assign(t.merge(500).pr, { state: 'CLOSED', merge_sha: null });
  Object.assign(t.f.children.get(501).gate, { role: 'G2', state: 'RETIRED' });
  t.f.children.get(501).pr = { ...t.f.children.get(501).pr, number: null, state: null };
  t.f.children.get(501).prs = [];
  assert.equal(t.board(500), 'NOW · IN PROGRESS | G2');
  assert.equal(t.board(501), 'NOW · IN PROGRESS | G2');
});

test('rows with no merged task PR are unchanged', () => {
  const t = mergedFixture();
  assert.equal(t.board(500), 'NOW · IN PROGRESS | -');
  assert.equal(t.board(510), 'QUEUED | -');
  assert.equal(t.board(520), 'COMPLETED | -');
  assert.ok(!rowsOf(t.graph()).some(line => cellsOf(line)[2] === MERGED), 'the fixture draws no merged row until a PR merges');
});

test('CURRENT is slim: in progress, one attention line with holds, no Start next or finding lists', () => {
  const f = renderScaleFixture(state);
  f.children.get(500).blockers = ['waits for PR 1098'];
  f.parent.attention = state.foldAttention(f.parent.attention, { source: 'reconcile', complete: false, now: '2026-11-07T00:00:00Z',
    seen: [{ code: 'TASK_IDLE', issue: 505 }] });
  const current = state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  assert.doesNotMatch(current, /Start next|\*\*Work queue\*\*|\*\*Waiting on you\*\*|^- CHILD_REOPENED/m);
  assert.match(current, /^\*\*In progress\*\*$/m);
  assert.doesNotMatch(current, /^- #500 /m, 'a blocked task with no live gate is queued, so it leaves CURRENT');
  assert.match(current, /^- #501 Programme task 2: shared service behaviour/m);
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
