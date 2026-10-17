'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { GateAssignment, successorPacket } = require('../scripts/toolkit-v3-lifecycle.cjs');

const h = label => crypto.createHash('sha256').update(String(label)).digest('hex');
const code = expected => error => error.code === expected;
const uat = { mode: 'OWNER_UAT', objective_reference: null, owner: 'owner' };
function g1() { return GateAssignment.admit({ assignment_id: 'core-g1', programme: 421, child: 461, role: 'G1', acceptance: uat }); }
function launched() { return g1().launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' }).gate; }

test('questions and UAT keep G1 unfinished; checkpoints continue the same session', () => {
  let gate = launched();
  gate = gate.transition('s1', 'CHECKPOINT', h('cp1'));
  assert.equal(gate.session('s1').state, 'ACTIVE');
  gate = gate.transition('s1', 'ASK_OWNER', h('question'));
  assert.equal(gate.session('s1').state, 'WAITING_OWNER');
  assert.equal(gate.state, 'OPEN');
  assert.throws(() => gate.launch({ session_id: 's2', launch_request_id: 'L2', requested_by: 'CONTROLLER' }), code('V3_GATE_DUPLICATE_WRITER'));
  gate = gate.transition('s1', 'OWNER_REPLY', h('answer'));
  gate = gate.transition('s1', 'UAT_READY', h('uat'));
  assert.equal(gate.session('s1').state, 'WAITING_OWNER');
  gate = gate.transition('s1', 'OWNER_REPLY', h('feedback'));
  assert.equal(gate.assertExecutable('s1').state, 'ACTIVE');
  assert.equal(gate.liveSession.session_id, 's1');
});

test('an accepted gate retires its session, which is refused for any further execution', () => {
  let gate = launched().transition('s1', 'SUBMIT', h('return'));
  assert.throws(() => gate.assertExecutable('s1'), code('V3_SUBMITTED_SESSION_AWAITING_CONSUMPTION'));
  // Owner UAT cannot be waived by a missing acceptance record.
  assert.throws(() => gate.consumeReturn({ session_id: 's1', return_digest: h('return'), disposition: 'ACCEPT' }), code('V3_GATE_OWNER_UAT_REQUIRED'));
  const accepted = gate.consumeReturn({ session_id: 's1', return_digest: h('return'), disposition: 'ACCEPT', owner_acceptance_digest: h('owner-ok') });
  gate = accepted.gate;
  assert.equal(accepted.outcome, 'ACCEPTED_SESSION_RETIRED');
  assert.equal(gate.state, 'ACCEPTED');
  assert.throws(() => gate.assertExecutable('s1'), code('V3_RETIRED_SESSION_REFUSED'));
  assert.throws(() => gate.transition('s1', 'CHECKPOINT', null), code('V3_RETIRED_SESSION_REFUSED'));
  assert.throws(() => gate.launch({ session_id: 's9', launch_request_id: 'L9', requested_by: 'CONTROLLER' }), code('V3_GATE_RETIRED'));
});

test('a return is consumed exactly once; replay is a no-op and a competing return is rejected', () => {
  const submitted = launched().transition('s1', 'SUBMIT', h('r'));
  const once = submitted.consumeReturn({ session_id: 's1', return_digest: h('r'), disposition: 'ACCEPT', owner_acceptance_digest: h('ok') });
  const again = once.gate.consumeReturn({ session_id: 's1', return_digest: h('r'), disposition: 'ACCEPT', owner_acceptance_digest: h('ok') });
  assert.equal(again.outcome, 'ALREADY_CONSUMED');
  assert.equal(again.gate.revision, once.gate.revision);
  assert.throws(() => once.gate.consumeReturn({ session_id: 's1', return_digest: h('other'), disposition: 'ACCEPT', owner_acceptance_digest: h('ok') }), code('V3_GATE_RETURN_CONFLICT'));
});

test('an incomplete submitted return reopens the same session instead of starting a new one', () => {
  const reopened = launched().transition('s1', 'SUBMIT', h('partial')).consumeReturn({ session_id: 's1', return_digest: h('partial'), disposition: 'REOPEN' });
  assert.equal(reopened.outcome, 'REOPENED_SAME_SESSION');
  assert.equal(reopened.gate.assertExecutable('s1').state, 'ACTIVE');
  assert.equal(reopened.gate.state, 'OPEN');
});

test('duplicate launch requests reuse the session; a different request cannot add a second writer', () => {
  const first = launched();
  const repeat = first.launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' });
  assert.equal(repeat.outcome, 'EXISTING_SESSION_REUSED');
  assert.equal(repeat.gate.revision, first.revision);
  assert.throws(() => first.launch({ session_id: 's1b', launch_request_id: 'L1', requested_by: 'CONTROLLER' }), code('V3_GATE_LAUNCH_REQUEST_CONFLICT'));
  assert.throws(() => first.launch({ session_id: 's2', launch_request_id: 'L2', requested_by: 'CONTROLLER' }), code('V3_GATE_DUPLICATE_WRITER'));
});

test('an interrupted session is continued by one recoverable successor, never a parallel writer', () => {
  const interrupted = launched().transition('s1', 'INTERRUPT', h('context-loss'));
  assert.throws(() => interrupted.assertExecutable('s1'), code('V3_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR'));
  assert.throws(() => interrupted.launch({ session_id: 's2', launch_request_id: 'L2', requested_by: 'CONTROLLER' }), code('V3_GATE_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR'));
  const next = interrupted.launch({ session_id: 's2', launch_request_id: 'L2', requested_by: 'CONTROLLER', successor_of: 's1' });
  assert.equal(next.outcome, 'SUCCESSOR_LAUNCHED');
  assert.equal(next.gate.session('s1').state, 'RETIRED');
  assert.equal(next.gate.assertExecutable('s2').state, 'ACTIVE');
  assert.throws(() => next.gate.launch({ session_id: 's3', launch_request_id: 'L3', requested_by: 'CONTROLLER', successor_of: 's2' }), code('V3_GATE_DUPLICATE_WRITER'));
});

test('G1 cannot launch or conduct its own G2', () => {
  const g2 = GateAssignment.admit({ assignment_id: 'core-g2', programme: 421, child: 461, role: 'G2', acceptance: uat });
  assert.throws(() => g2.launch({ session_id: 'r1', launch_request_id: 'R1', requested_by: 'G1' }), code('V3_G2_LAUNCH_BY_BUILDER_REFUSED'));
  assert.equal(g2.launch({ session_id: 'r1', launch_request_id: 'R1', requested_by: 'CONTROLLER' }).outcome, 'LAUNCHED');
  const launchedG2 = g2.launch({ session_id: 'r1', launch_request_id: 'R1', requested_by: 'CONTROLLER' }).gate;
  assert.throws(() => launchedG2.transition('r1', 'UAT_READY', null), code('V3_GATE_UAT_NOT_APPLICABLE'));
});

test('acceptance mode is fixed at admission and objective acceptance needs an owner-approved reference', () => {
  assert.throws(() => GateAssignment.admit({ assignment_id: 'x', programme: 1, child: 2, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: null, owner: 'owner' } }), code('V3_GATE_ACCEPTANCE_INVALID'));
  assert.throws(() => GateAssignment.admit({ assignment_id: 'x', programme: 1, child: 2, role: 'G1',
    acceptance: { mode: 'NONE', objective_reference: null, owner: 'owner' } }), code('V3_GATE_ACCEPTANCE_INVALID'));
  const objective = GateAssignment.admit({ assignment_id: 'x', programme: 1, child: 2, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: h('criteria'), owner: 'owner' } })
    .launch({ session_id: 's', launch_request_id: 'l', requested_by: 'CONTROLLER' }).gate;
  assert.throws(() => objective.transition('s', 'UAT_READY', null), code('V3_GATE_UAT_NOT_APPLICABLE'));
  const tampered = objective.value; tampered.acceptance = uat;
  assert.throws(() => GateAssignment.from(tampered, objective.digest), code('V3_GATE_DIGEST_MISMATCH'));
});

test('owner decisions are recorded once; stale or competing input is rejected', () => {
  let gate = launched();
  const recorded = gate.recordOwnerDecision({ question_id: 'q1', decision_digest: h('yes'), provenance_digest: h('chat'), based_on_revision: gate.revision });
  gate = recorded.gate;
  assert.equal(gate.recordOwnerDecision({ question_id: 'q1', decision_digest: h('yes'), provenance_digest: h('relay'), based_on_revision: 0 }).outcome, 'ALREADY_RECORDED');
  assert.throws(() => gate.recordOwnerDecision({ question_id: 'q1', decision_digest: h('no'), provenance_digest: h('relay'), based_on_revision: gate.revision }), code('V3_GATE_DECISION_CONFLICT'));
  assert.throws(() => gate.recordOwnerDecision({ question_id: 'q2', decision_digest: h('no'), provenance_digest: h('relay'), based_on_revision: gate.revision - 1 }), code('V3_GATE_DECISION_STALE'));
});

test('clearing a blocker releases exactly the authorised work it held', () => {
  let gate = launched().addBlocker({ blocker_id: 'perm', kind: 'PERMISSION' });
  gate = gate.addWork({ work_id: 'upload', authorised_by: h('standing'), blocked_by: ['perm'] });
  gate = gate.addWork({ work_id: 'docs', authorised_by: h('standing') });
  assert.deepEqual(gate.runnableWork(), ['docs']);
  assert.throws(() => gate.completeWork('upload', h('done')), code('V3_GATE_WORK_BLOCKED'));
  const cleared = gate.clearBlocker({ blocker_id: 'perm', evidence_digest: h('approved') });
  assert.deepEqual(cleared.continue_work, ['upload']);
  assert.equal(cleared.gate.completeWork('upload', h('done')).runnableWork().includes('upload'), false);
});

test('authorised work with no live session is reported as stranded', () => {
  let gate = launched().addWork({ work_id: 'publish', authorised_by: h('standing') });
  assert.deepEqual(gate.strandedWork(), []);
  gate = gate.transition('s1', 'INTERRUPT', h('crash'));
  assert.deepEqual(gate.strandedWork(), ['publish']);
});

test('a fresh next gate receives recoverable state, not a reset budget or rediscovery', () => {
  let gate = launched().addWork({ work_id: 'later', authorised_by: h('standing') });
  gate = gate.transition('s1', 'SUBMIT', h('ret'))
    .consumeReturn({ session_id: 's1', return_digest: h('ret'), disposition: 'ACCEPT', owner_acceptance_digest: h('uat') }).gate;
  const packet = successorPacket(gate, { next_role: 'G2', carried_evidence: ['candidate', 'uat'] });
  assert.equal(packet.budget_reset, false);
  assert.equal(packet.rediscovery_required, false);
  assert.equal(packet.predecessor.digest, gate.digest);
  assert.deepEqual(packet.remaining_work.map(w => w.work_id), ['later']);
  assert.equal(packet.consumed_returns.length, 1);
  assert.throws(() => successorPacket(launched(), { next_role: 'G2', carried_evidence: [] }), code('V3_GATE_SUCCESSOR_INVALID'));
});

test('a serialized state cannot hold two live writers', () => {
  const value = launched().value;
  value.sessions.push({ ...value.sessions[0], session_id: 's2', launch_request_id: 'L2' });
  assert.throws(() => GateAssignment.from(value), code('V3_GATE_WRITER_CONFLICT'));
});
