'use strict';
// Synthetic controller and real local child-process fixtures. These are not a
// Codex/Claude/OpenCode launch or cross-host/native qualification receipt.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const support = require('./toolkit-v3-store-test-support.cjs');
function context(options = {}) {
  const state = { launches: 0, successor: null, permission: 'PERMITTED', capability: true,
    writer: 'STOPPED', conflict: false, checkpoint: true, consumed: 0, ambiguous: false, drift: false, reads: 0 };
  let fixture;
  const readers = {
    readV3RenewalObservation(request) {
      state.reads++;
      if (state.drift && state.reads === 2) state.writer = 'ACTIVE';
      let successor = { state: state.ambiguous ? 'AMBIGUOUS' : 'ABSENT', worker_id: null,
        packet_digest: null, checkpoint_digest: null, route: null };
      if (state.successor) {
        const bytes = fs.readFileSync(state.successor);
        const child = JSON.parse(bytes);
        assert.equal(child.request.packet_digest, request.packet_digest);
        assert.equal(receipt.digestValue(child.checkpoint), request.checkpoint_digest);
        assert.deepEqual(child.request.route, request.route);
        successor = { state: 'ACTIVE', worker_id: 'synthetic-child-' + child.pid,
          packet_digest: child.request.packet_digest, checkpoint_digest: receipt.digestValue(child.checkpoint), route: child.request.route };
      }
      return { request_digest: receipt.digestValue(request), checkpoint_verified: state.checkpoint,
        consumer_recovery_verified: true, writer_state: state.writer, conflicting_writer: state.conflict,
        successor, permission: state.permission, capabilities_verified: state.capability,
        native_turns_consumed: state.consumed,
        source_digest: receipt.digestValue({ state: successor.state, source: successor.worker_id, fixture: true }) };
    },
    launchV3Successor(request) {
      state.launches++;
      if (options.ambiguousLaunch) { state.ambiguous = true; throw new Error('controlled lost response'); }
      const recovery = fixture.readCurrentRecoveryCheckpoint();
      const input = path.join(fixture.storeRoot, 'renewal-input.json');
      const output = path.join(fixture.storeRoot, 'renewal-child-readback.json');
      fs.writeFileSync(input, JSON.stringify({ request, checkpoint: recovery.checkpoint }), { flag: 'wx' });
      const code = 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify({...x,pid:process.pid,fixture:true}),{flag:"wx"});';
      const child = cp.spawnSync(process.execPath, ['-e', code, input, output], { timeout: 5000, windowsHide: true,
        encoding: 'utf8', env: { PATH: path.dirname(process.execPath) } });
      assert.equal(child.status, 0, child.stderr);
      state.successor = output; state.consumed++;
      return { worker_id: 'synthetic-child-' + JSON.parse(fs.readFileSync(output)).pid,
        transport_id: request.transport_id, fixture: true };
    },
    readDispatchOutcome(input) {
      return { admission_id: input.admission_id, consumer_key: input.consumer_key, intent_event_id: input.intent_event_id,
        attempt: input.attempt, transport_id: input.transport_id,
        transport_digest: input.transport_digest || receipt.digestValue({ fixture: true, input }),
        outcome: state.successor ? 'confirmed' : state.ambiguous ? 'ambiguous' : 'not-started',
        delayed_completion_excluded: !state.successor && !state.ambiguous };
    },
  };
  fixture = support.createV3StoreFixture({ renewalTransportFixture: options.grant !== false,
    additionalTrustedReaders: readers, checkpointResults: options.checkpointResults, checkpointAction: options.checkpointAction });
  function events(store = fixture.store) {
    const db = new DatabaseSync(store.databasePath, { readOnly: true });
    try { return db.prepare('SELECT event_type FROM semantic_gate_admission_events ORDER BY sequence').all().map(x => x.event_type); }
    finally { db.close(); }
  }
  function consumerKey() {
    const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
    try { return db.prepare('SELECT consumer_key FROM semantic_gate_admissions').get().consumer_key; }
    finally { db.close(); }
  }
  return { fixture, state, events, consumerKey, run: (event = 'SEGMENT_COMPLETE') => fixture.store.executeV3Renewal(fixture.admission, event) };
}
test('completed synthetic segment dispatches one real harmless child which consumes the exact checkpoint', () => {
  const c = context();
  const result = c.run(); assert.equal(result.state, 'SUCCESSOR_CONSUMED_CHECKPOINT');
  assert.equal(result.launches, 1); assert.equal(c.state.launches, 1);
  assert.equal(c.events().filter(e => e === 'DISPATCH_INTENT').length, 1);
  assert.equal(c.events().filter(e => e === 'DISPATCH_CONFIRMED').length, 1);
  assert.equal(result.reset_consumption, false);
});
test('matching active successor is reused with no second launch or counter reset', () => {
  const c = context(); const original = c.run(); const next = c.run();
  assert.equal(next.state, 'REUSE_SUCCESSOR'); assert.equal(next.worker_id, original.worker_id);
  assert.equal(c.state.launches, 1); assert.equal(c.events().filter(e => e === 'DISPATCH_INTENT').length, 1);
});
test('ambiguous launch retains intent and holds every replay even after a lost controller handle', () => {
  const c = context({ ambiguousLaunch: true });
  assert.throws(() => c.run(), e => e.code === 'GPR_PACKET_DISPATCH_UNRESOLVED');
  assert.equal(c.run().state, 'DISPATCH_AMBIGUOUS_HOLD'); assert.equal(c.state.launches, 1);
  const reopened = receipt.createAuthorityPacketStore(c.fixture.storeOptions, c.fixture.trustedReaders);
  const key = c.consumerKey();
  assert.equal(reopened.recoverV3Renewal(key, 'CONTEXT_LOST').state, 'DISPATCH_AMBIGUOUS_HOLD');
  assert.equal(c.events(reopened).filter(e => e === 'DISPATCH_INTENT').length, 1);
});
test('lost controller session reopens durable admission and reuses the independently observed successor', () => {
  const c = context(); const original = c.run();
  const reopened = receipt.createAuthorityPacketStore(c.fixture.storeOptions, c.fixture.trustedReaders);
  const key = c.consumerKey();
  const result = reopened.recoverV3Renewal(key, 'CONTEXT_LOST');
  assert.equal(result.state, 'REUSE_SUCCESSOR'); assert.equal(result.worker_id, original.worker_id);
  assert.equal(c.state.launches, 1); assert.equal(c.events(reopened).filter(e => e === 'DISPATCH_INTENT').length, 1);
});
test('a valid failing product checkpoint permits repair without advancing acceptance; a failed save does not launch', () => {
  const c = context({ checkpointResults: [
    { result_id: 'synthetic-fixture-qualification', status: 'FAIL', summary: 'Synthetic fixture check is represented as unrun; no live qualification occurred.', evidence_ids: [] },
    { result_id: 'v3-lifecycle-state', status: 'UNRUN', summary: 'Synthetic lifecycle snapshot is pending and contains no owner UAT or reviewer acceptance.', evidence_ids: ['synthetic-v3-lifecycle-state'] },
  ] });
  const result = c.run(); assert.equal(result.state, 'SUCCESSOR_CONSUMED_CHECKPOINT');
  assert.equal(result.results.find(r => r.result_id === 'synthetic-fixture-qualification').status, 'FAIL');
  assert.equal(c.fixture.readCurrentRecoveryCheckpoint().checkpoint.owner_acceptance.disposition, 'PENDING');
  const held = context(); held.state.checkpoint = false;
  assert.equal(held.run().state, 'CHECKPOINT_OR_WRITER_HOLD');
  assert.equal(held.run('CHECKPOINT_FAILED').state, 'CHECKPOINT_RECOVERY_REQUIRED'); assert.equal(held.state.launches, 0);
});
test('genuine permission hold and unavailable receiver capability produce zero dependent launches', () => {
  const c = context(); c.state.permission = 'DENIED';
  assert.equal(c.run().state, 'PERMISSION_HOLD'); assert.equal(c.state.launches, 0);
  c.state.permission = 'PERMITTED'; c.state.capability = false;
  assert.equal(c.run().state, 'RECEIVER_CAPABILITY_HOLD'); assert.equal(c.state.launches, 0);
  assert.equal(c.events().filter(e => e === 'DISPATCH_INTENT').length, 0);
});
test('boundary writer drift, absent TURN authority and unknown/consumed history never reach the launcher', () => {
  const drift = context(); drift.state.drift = true;
  assert.equal(drift.run().state, 'BOUNDARY_DRIFT_HOLD'); assert.equal(drift.state.launches, 0);
  const noGrant = context({ grant: false });
  assert.equal(noGrant.run().state, 'EXISTING_AUTHORITY_OR_CONSUMPTION_HOLD'); assert.equal(noGrant.state.launches, 0);
  const used = context(); used.state.consumed = 1;
  assert.equal(used.run().state, 'EXISTING_AUTHORITY_OR_CONSUMPTION_HOLD'); used.state.consumed = null;
  assert.equal(used.run().state, 'EXISTING_AUTHORITY_OR_CONSUMPTION_HOLD'); assert.equal(used.state.launches, 0);
});
test('checkpoint-only continues active executor and forged stores/admissions cannot invoke captured launchers', () => {
  const c = context(); c.state.writer = 'ACTIVE';
  assert.equal(c.run('CHECKPOINT_SAVED').state, 'CONTINUE_SAME_EXECUTOR'); assert.equal(c.state.launches, 0);
  assert.throws(() => c.fixture.store.executeV3Renewal({ ...c.fixture.admission }, 'SEGMENT_COMPLETE'));
  assert.throws(() => c.fixture.store.executeV3Renewal.call({ ...c.fixture.store }, c.fixture.admission, 'SEGMENT_COMPLETE'));
});
test('explicit checkpoint STOP or REQUEST_OWNER cannot be overridden by a permitted launcher observation', () => {
  for (const action of ['STOP','REQUEST_OWNER']) {
    const c = context({ checkpointAction: action });
    assert.equal(c.run().state, 'CHECKPOINT_NEXT_ACTION_HOLD');
    assert.equal(c.state.launches, 0);
    assert.equal(c.events().filter(event => event === 'DISPATCH_INTENT').length, 0);
  }
});
