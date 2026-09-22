'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const support = require('./toolkit-authority-packet-test-support.cjs');

const ORACLE_FIXTURE = path.join(__dirname, 'fixtures', 'authority-packet-durability-g2-v1.json');

test.afterEach(() => support.cleanup());

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function setup(seed = 'admission') {
  const packetValue = support.packet({ seed });
  const storeOptions = support.options(support.stateRoot(`authority-admission-${seed}-`));
  const required = packetValue.bindings.applicability.required_consumers;
  const authority = packetValue.bindings.authority;
  let current = null;
  let currentBodyDigest = runtime.digestValue({ seed, body: 'current' });
  const readers = support.readers(packetValue, {
    readAuthority: () => ({
      authority: structuredClone(authority),
      required_consumers: structuredClone(required),
      later_controlling_comments: [],
    }),
    readCandidate: () => null,
    readWebDecision: () => {
      const identities = runtime.authorityPacketIdentities(packetValue);
      return {
        packet_id: identities.packet_id,
        packet_digest: identities.packet_digest,
        binding_digest: identities.binding_digest,
        web_source: structuredClone(authority),
        disposition: 'ACCEPTED_FOR_CONSUMPTION',
        permitted_consumers: structuredClone(required),
        applicability: structuredClone(packetValue.bindings.applicability),
      };
    },
    readCurrent: () => ({
      current,
      projection_digest: runtime.digestValue(current),
      body_digest: currentBodyDigest,
      revision: 1,
    }),
    readDispatchOutcome: ({ status }) => ({
      status: status || 'confirmed',
      delayed_completion_excluded: (status || 'confirmed') === 'not-started'
    }),
    screenPacket: (value) => ({
      packet_digest: value && value.bindings
        ? runtime.authorityPacketIdentities(value).packet_digest
        : runtime.authorityPacketIdentities(packetValue).packet_digest,
      decision: 'ALLOW',
      policy_digest: runtime.digestValue('authority-admission-policy'),
      retention_policy_digest: runtime.digestValue('authority-admission-retention'),
    }),
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readers);
  const persisted = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  store.bindWebPacketAcceptance(persisted.packet_id, readers);
  const intent = {
    repository: packetValue.bindings.repository,
    parent_issue: packetValue.bindings.parent_issue,
    child_issue: packetValue.bindings.child_issue,
    lane_id: packetValue.bindings.lane_id,
    human_owner: packetValue.bindings.human_owner,
    consumer: {
      run: `run-${seed}`,
      lock: `lock-${seed}`,
      stage: 'G3',
      role: 'G3',
      scope_digest: required[0].scope_digest,
    },
    candidate: null,
    execution_binding: {
      semantic_run: null,
      receipt_run_id: null,
      loop_run_id: `loop-${seed}`,
      repository_id: 'a'.repeat(64),
      authorized_ref_digest: 'b'.repeat(64),
      current_authority_digest: 'c'.repeat(64),
    },
    predecessors: [{ packet_id: persisted.packet_id, dependency_id: required[0].dependency_id }],
    operation: 'loop',
  };
  current = store.buildCurrentPacketProjection(intent, readers);
  store.confirmCurrentPacketProjection(current, readers);
  return {
    packetValue,
    storeOptions,
    store,
    readers,
    intent,
    setCurrentBodyDigest(value) { currentBodyDigest = value; },
  };
}

test('G2 A01-I06 and X01-X10 oracle fixture compiles with complete coverage', () => {
  const ir = JSON.parse(fs.readFileSync(ORACLE_FIXTURE, 'utf8'));
  const expectedIds = [
    ...Array.from({ length: 5 }, (_, index) => `A0${index + 1}`),
    ...Array.from({ length: 6 }, (_, index) => `B0${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `C0${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `D0${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `E0${index + 1}`),
    ...Array.from({ length: 4 }, (_, index) => `F0${index + 1}`),
    ...Array.from({ length: 6 }, (_, index) => `G0${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `H0${index + 1}`),
    ...Array.from({ length: 6 }, (_, index) => `I0${index + 1}`),
    ...Array.from({ length: 10 }, (_, index) => `X${String(index + 1).padStart(2, '0')}`),
  ];
  assert.equal(ir.mutation.allow_paths.length, 29);
  assert.equal(new Set(ir.mutation.allow_paths).size, 29);
  assert.deepEqual(ir.requirements.map((item) => item.id), expectedIds);
  assert.ok(ir.requirements.every((item) => item.macros.length === 0 && item.cases.length === 2));
  assert.ok(ir.requirements.every((item) => item.cases.some((entry) => entry.id.endsWith('-NEG'))
    && item.cases.some((entry) => entry.id.endsWith('-POS'))));
  const packet = compiler.compileGateContract(ir);
  assert.equal(packet.requirements.length, 66);
  assert.equal(packet.generated_cases.length, 132);
  assert.equal(packet.coverage_map.length, 66);
  assert.ok(packet.generated_cases.every((item) => item.assertion_count > 0));
});

test('semantic admission binds exact CURRENT, acceptance and fresh packet evidence', () => {
  const fixture = setup('positive');
  const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readers);
  assert.ok(Object.isFrozen(admitted.admission));
  assert.equal(admitted.proof.dependency_state, 'PREDECESSORS_VERIFIED');
  assert.equal(admitted.proof.current.revision, 1);
  assert.equal(fixture.store.revalidateSemanticGate(admitted.admission, { operation: 'loop' }).fresh, true);
  assertCode(() => fixture.store.revalidateSemanticGate({}), 'GPR_PACKET_ADMISSION_REQUIRED');

  fixture.store.beginSemanticGateDispatch(admitted.admission);
  fixture.store.recordSemanticGateDispatch(admitted.admission, { status: 'confirmed' });
  const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
  try {
    const events = db.prepare('SELECT event_type FROM semantic_gate_admission_events ORDER BY sequence').all();
    assert.deepEqual(events.map((row) => row.event_type), ['DISPATCH_INTENT', 'DISPATCH_CONFIRMED']);
  } finally { db.close(); }
});

test('ambiguous dispatch remains unresolved until definitive not-started evidence, then recovery is bounded', () => {
  const fixture = setup('recovery');
  const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readers);
  fixture.store.beginSemanticGateDispatch(admitted.admission);
  assertCode(
    () => fixture.store.recordSemanticGateDispatch(admitted.admission, { status: 'ambiguous' }),
    'GPR_PACKET_DISPATCH_UNRESOLVED'
  );
  const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
  let consumerKey;
  try {
    consumerKey = db.prepare('SELECT consumer_key FROM semantic_gate_admissions').get().consumer_key;
  } finally { db.close(); }
  assertCode(
    () => fixture.store.recoverSemanticGateAdmission({ consumer_key: consumerKey }, fixture.readers),
    'GPR_PACKET_DISPATCH_UNRESOLVED'
  );
  fixture.store.recordSemanticGateDispatch(admitted.admission, { status: 'not-started' });
  const recovered = fixture.store.recoverSemanticGateAdmission({ consumer_key: consumerKey }, fixture.readers);
  assert.equal(recovered.recovered, true);
  fixture.store.beginSemanticGateDispatch(recovered.admission);
  fixture.store.recordSemanticGateDispatch(recovered.admission, { status: 'confirmed' });
});

test('changed CURRENT readback fails revalidation before dispatch', () => {
  const fixture = setup('stale-current');
  const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readers);
  fixture.setCurrentBodyDigest(runtime.digestValue({ changed: true }));
  assertCode(
    () => fixture.store.revalidateSemanticGate(admitted.admission, { operation: 'loop' }),
    'GPR_PACKET_CURRENT_UNVERIFIED'
  );
});
