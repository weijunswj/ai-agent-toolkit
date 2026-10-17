'use strict';

// Owner decision WEB-TK421-CONTINUOUS-FINISH-BEFORE-STOP-20261017-10: already-authorised work
// finishes before stopping, and a genuine HOLD blocks only its dependent steps. These tests drive
// the shipped GateAssignment work/blocker model. They do not prove an automatic scheduler or
// persistent stage advancement, which the immediate next Core (#501) owns.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { GateAssignment } = require('../scripts/toolkit-v3-lifecycle.cjs');

const h = s => crypto.createHash('sha256').update(s).digest('hex');
const AUTHORISED = h('admitted G1 assignment');
const refused = code => error => error.code === code;

function builder() {
  return GateAssignment.admit({ assignment_id: 'g1-finish', programme: 421, child: 461, role: 'G1',
    acceptance: { mode: 'OWNER_UAT', objective_reference: null, owner: 'owner' } })
    .launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' }).gate;
}
const STEPS = ['implement', 'targeted-tests', 'ci-status', 'custody-readback', 'complete-return'];

// One sustained run: take each runnable authorised step, checkpoint, and continue.
function runAuthorised(gate) {
  let current = gate;
  for (let next = current.runnableWork()[0]; next; next = current.runnableWork()[0]) {
    current = current.completeWork(next, h(`evidence:${next}`));
    current = current.transition('s1', 'CHECKPOINT', h(`checkpoint:${next}`));
    current.assertExecutable('s1');
  }
  return current;
}

test('already-authorised steps run to one complete return in the same session without an owner prompt', () => {
  let gate = builder();
  for (const work_id of STEPS) gate = gate.addWork({ work_id, authorised_by: AUTHORISED });
  const finished = runAuthorised(gate);
  const value = finished.value, session = finished.session('s1');
  assert.deepEqual(value.work.map(w => [w.work_id, w.state]), STEPS.map(id => [id, 'DONE']));
  assert.equal(session.state, 'ACTIVE', 'checkpoints never end or renew the healthy session');
  assert.deepEqual([...new Set(session.history.map(e => e.event))], ['LAUNCH', 'CHECKPOINT']);
  assert.equal(value.launch_requests.length, 1, 'no successor or second writer');
  assert.equal(value.decisions.length, 0, 'no owner decision was needed to continue');
  assert.deepEqual(finished.strandedWork(), []);
  const submitted = finished.transition('s1', 'SUBMIT', h('complete return'));
  assert.equal(submitted.session('s1').state, 'SUBMITTED');
});

test('a checkpoint, commit or watcher start is not terminal: stopping there strands authorised work', () => {
  let gate = builder();
  for (const work_id of STEPS) gate = gate.addWork({ work_id, authorised_by: AUTHORISED });
  const checkpointed = gate.completeWork('implement', h('commit')).transition('s1', 'CHECKPOINT', h('ci watcher started'));
  assert.equal(checkpointed.state, 'OPEN');
  assert.equal(checkpointed.session('s1').state, 'ACTIVE');
  assert.deepEqual(checkpointed.runnableWork(), STEPS.slice(1), 'the remaining authorised steps are still due');
  // An executor that stops at that point leaves no live session; the work is reported, never treated as complete.
  const stopped = checkpointed.transition('s1', 'INTERRUPT');
  assert.deepEqual(stopped.strandedWork(), STEPS.slice(1));
  assert.throws(() => stopped.assertExecutable('s1'), refused('V3_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR'));
});

test('a genuine HOLD blocks only its dependent steps while independent authorised work continues', () => {
  let gate = builder();
  for (const [blocker_id, kind] of [['owner-uat', 'OWNER_DECISION'], ['native-permission', 'PERMISSION'],
    ['unknown-effect', 'EXTERNAL'], ['ci-pending', 'EXTERNAL'], ['independent-g2', 'EXTERNAL']]) gate = gate.addBlocker({ blocker_id, kind });
  for (const [work_id, blocked_by] of [['merge', ['native-permission', 'independent-g2']], ['record-uat', ['owner-uat']],
    ['replay-publication', ['unknown-effect']], ['claim-ci-green', ['ci-pending']],
    ['docs-alignment', []], ['custody-upload', []], ['current-projection', []]]) gate = gate.addWork({ work_id, authorised_by: AUTHORISED, blocked_by });
  assert.deepEqual(gate.runnableWork(), ['docs-alignment', 'custody-upload', 'current-projection']);
  for (const held of ['merge', 'record-uat', 'replay-publication', 'claim-ci-green']) {
    assert.throws(() => gate.completeWork(held, h(held)), refused('V3_GATE_WORK_BLOCKED'), held);
  }
  // The hold does not stop the session; independent work finishes in the same run.
  gate = runAuthorised(gate);
  assert.equal(gate.session('s1').state, 'ACTIVE');
  assert.deepEqual(gate.value.work.filter(w => w.state === 'DONE').map(w => w.work_id), ['docs-alignment', 'custody-upload', 'current-projection']);
  // Settling CI releases exactly its dependent step; merge still waits on permission and independent G2.
  let cleared = gate.clearBlocker({ blocker_id: 'ci-pending', evidence_digest: h('ci terminal green') });
  assert.deepEqual(cleared.continue_work, ['claim-ci-green']);
  cleared = cleared.gate.clearBlocker({ blocker_id: 'native-permission', evidence_digest: h('owner permission') });
  assert.deepEqual(cleared.continue_work, [], 'merge still depends on independent G2');
  assert.deepEqual(cleared.gate.runnableWork(), ['claim-ci-green']);
  assert.throws(() => cleared.gate.completeWork('replay-publication', h('replay')), refused('V3_GATE_WORK_BLOCKED'), 'an unknown effect is never replayed');
  assert.throws(() => cleared.gate.clearBlocker({ blocker_id: 'unknown-effect', evidence_digest: 'not evidence' }), refused('V3_GATE_BLOCKER_INVALID'));
});

test('continuing never admits a duplicate writer, a self-launched G2 or an owner-UAT shortcut', () => {
  const gate = builder();
  assert.throws(() => gate.launch({ session_id: 's2', launch_request_id: 'L2', requested_by: 'CONTROLLER' }), refused('V3_GATE_DUPLICATE_WRITER'));
  assert.equal(gate.launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' }).outcome, 'EXISTING_SESSION_REUSED');
  const review = GateAssignment.admit({ assignment_id: 'g2-review', programme: 421, child: 461, role: 'G2',
    acceptance: { mode: 'OBJECTIVE', objective_reference: h('criteria'), owner: 'owner' } });
  assert.throws(() => review.launch({ session_id: 'r1', launch_request_id: 'R1', requested_by: 'G1' }), refused('V3_G2_LAUNCH_BY_BUILDER_REFUSED'));
  // Owner UAT keeps G1 unfinished in the same session; independent work may continue, acceptance may not be manufactured.
  const waiting = gate.addWork({ work_id: 'pr-body', authorised_by: AUTHORISED }).transition('s1', 'UAT_READY', h('uat ready'));
  assert.equal(waiting.session('s1').state, 'WAITING_OWNER');
  const continued = waiting.completeWork('pr-body', h('pr body')).transition('s1', 'CHECKPOINT', h('waiting checkpoint'));
  assert.equal(continued.session('s1').state, 'WAITING_OWNER');
  const replied = continued.transition('s1', 'OWNER_REPLY', h('owner feedback')).transition('s1', 'SUBMIT', h('return'));
  assert.throws(() => replied.consumeReturn({ session_id: 's1', return_digest: h('return'), disposition: 'ACCEPT' }), refused('V3_GATE_OWNER_UAT_REQUIRED'));
});
