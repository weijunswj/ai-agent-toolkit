'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
let Ajv2020 = null;
try { Ajv2020 = require('ajv/dist/2020'); } catch (_) { /* Optional in dependency-light checkouts. */ }

const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const reconciler = require('../scripts/toolkit-github-governance-review-reconciler.cjs');
const programme = require('../scripts/toolkit-github-program-state-v5.cjs');
const assurance = require('../scripts/toolkit-assurance-web-finality.cjs');
const support = require('./toolkit-authority-packet-test-support.cjs');

const ORACLE_FIXTURE = path.join(__dirname, 'fixtures', 'authority-packet-durability-g2-v1.json');

test.afterEach(() => support.cleanup());

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function setup(seed = 'admission', setupOptions = {}) {
  const packetValue = support.packet({ seed });
  const storeOptions = support.options(support.stateRoot(`authority-admission-${seed}-`));
  const required = packetValue.bindings.applicability.required_consumers;
  const authority = packetValue.bindings.authority;
  let current = null;
  let currentBodyDigest = runtime.digestValue({ seed, body: 'current' });
  let recoveryOutcome = 'confirmed';
  const readers = support.readers(packetValue, {
    readAuthority: () => ({
      authority: structuredClone(authority),
      required_consumers: structuredClone(required),
      later_controlling_comments: [],
    }),
    readCandidate: () => setupOptions.readCandidate ? setupOptions.readCandidate() : null,
    readWebDecision: () => {
      const identities = runtime.authorityPacketIdentities(packetValue);
      return {
        packet_id: identities.packet_id,
        packet_digest: identities.packet_digest,
        binding_digest: identities.binding_digest,
        web_source: structuredClone(authority),
        disposition: 'ACCEPTED_FOR_CONSUMPTION',
        permitted_consumers: structuredClone(setupOptions.permitted_consumers === undefined ? required : setupOptions.permitted_consumers),
        applicability: structuredClone(packetValue.bindings.applicability),
        successor_applicability: structuredClone(setupOptions.successor_applicability || []),
      };
    },
    readCurrent: () => ({
      current,
      projection_digest: runtime.digestValue(current),
      body_digest: currentBodyDigest,
      revision: 1,
    }),
    readDispatchOutcome: setupOptions.readDispatchOutcome || ((input) => {
      const outcome = input.recovery ? recoveryOutcome : input.transport_result && input.transport_result.status
        || (input.transport_error ? 'not-started' : 'confirmed');
      return {
        admission_id: input.admission_id,
        consumer_key: input.consumer_key,
        intent_event_id: input.intent_event_id,
        attempt: input.attempt,
        transport_id: input.transport_id,
        transport_digest: input.transport_digest || runtime.digestValue({ transport_id: input.transport_id, outcome }),
        outcome,
        delayed_completion_excluded: outcome === 'not-started',
      };
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
    candidate: setupOptions.candidate || null,
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
    setRecoveryOutcome(value) { recoveryOutcome = value; },
    setCurrentBodyDigest(value) { currentBodyDigest = value; },
  };
}

function multiPredecessorSetup(seed, count) {
  const scope = runtime.digestValue({ seed, scope: 'shared-consumer' });
  const required = Array.from({ length: count }, (_, index) => ({
    class: 'G3', dependency_id: `dep-${String(index).padStart(2, '0')}`, scope_digest: scope,
  }));
  const authority = support.sourceReference(`${seed}-authority`);
  const packetValues = required.map((consumer, index) => {
    const packetBindings = support.bindings(`${seed}-${index}`);
    packetBindings.authority = structuredClone(authority);
    packetBindings.producer.run = `producer-${seed}-${index}`;
    packetBindings.applicability.scope_digest = scope;
    packetBindings.applicability.required_consumers = [consumer];
    return support.packet({ bindings: packetBindings });
  });
  const packetById = new Map(packetValues.map((value) => [runtime.authorityPacketIdentities(value).packet_id, value]));
  let current = null;
  const readerSet = support.readers(packetValues[0], {
    readAuthority: ({ packet_id }) => {
      const source = packet_id ? packetById.get(packet_id) : packetValues[0];
      return {
        authority: structuredClone(authority),
        required_consumers: structuredClone(required),
        later_controlling_comments: [],
        producer_authority: {
          lane_id: source.bindings.lane_id,
          human_owner: source.bindings.human_owner,
          producer: structuredClone(source.bindings.producer),
        },
      };
    },
    screenPacket: ({ packet: value }) => support.screening(value),
    readWebDecision: ({ packet_id }) => {
      const value = packetById.get(packet_id);
      return support.webDecision(value, value.bindings.applicability.required_consumers);
    },
    readCandidate: () => null,
    readCurrent: () => ({ current, projection_digest: runtime.digestValue(current), body_digest: runtime.digestValue({ seed, body: 'current' }), revision: 1 }),
    readDispatchOutcome: support.oracleDispatchOutcomeReader('confirmed'),
  });
  const storeOptions = support.options(support.stateRoot(`authority-multi-${seed}-`));
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
  const persisted = packetValues.map((value) => store.persistAuthorityPacket(value, support.producerAdmission(value)));
  const accepted = persisted.map((value) => store.bindWebPacketAcceptance(value.packet_id, readerSet));
  const intent = {
    repository: packetValues[0].bindings.repository,
    parent_issue: packetValues[0].bindings.parent_issue,
    child_issue: packetValues[0].bindings.child_issue,
    lane_id: packetValues[0].bindings.lane_id,
    human_owner: packetValues[0].bindings.human_owner,
    consumer: { run: `consumer-${seed}`, lock: `lock-${seed}`, stage: 'G3', role: 'G3', scope_digest: scope },
    candidate: null,
    execution_binding: { semantic_run: null, receipt_run_id: null, loop_run_id: `loop-${seed}`, repository_id: 'a'.repeat(64), authorized_ref_digest: 'b'.repeat(64), current_authority_digest: 'c'.repeat(64) },
    predecessors: persisted.map((value, index) => ({ packet_id: value.packet_id, dependency_id: required[index].dependency_id })),
    operation: 'loop',
  };
  current = store.buildCurrentPacketProjection(intent, readerSet);
  return {
    store, storeOptions, readerSet, intent, current, required, accepted,
    setCurrent(value) { current = value; },
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
  assert.ok(ir.requirements.every((item) => item.macros.length === 0));
  assert.equal(ir.requirements.find((item) => item.id === 'D01').cases.length, 31);
  assert.ok(ir.requirements.filter((item) => item.id !== 'D01').every((item) => item.cases.length === 2));
  assert.ok(ir.requirements.every((item) => item.cases.some((entry) => entry.id.endsWith('-NEG') || entry.id.startsWith('D01-NEG-'))
    && item.cases.some((entry) => entry.id.endsWith('-POS'))));
  const packet = compiler.compileGateContract(ir);
  assert.equal(packet.requirements.length, 66);
  assert.equal(packet.generated_cases.length, 337);
  assert.equal(packet.coverage_map.length, 66);
  assert.ok(packet.generated_cases.every((item) => item.assertion_count > 0));
});

test('F14 executes every compiled oracle case through production-backed boundaries', async () => {
  const ir = JSON.parse(fs.readFileSync(ORACLE_FIXTURE, 'utf8'));
  const packet = compiler.compileGateContract(ir);
  const result = await support.runAuthorityPacketOracleMatrix(packet.generated_cases);
  assert.equal(result.requirement_count, 66);
  assert.equal(result.case_count, 337);
  assert.equal(result.skipped_count, 0);
  assert.equal(result.unexecuted_count, 0);
  assert.equal(result.failed_count, 0);
  assert.ok(result.evidence.every((item) => item.passed === true));
  assert.ok(result.evidence.every((item) => item.assertions_executed > 0));
  assert.ok(result.evidence.every((item) => item.production_surface));
});

test('F14 corrupted-store rejection cases exercise the verified v4 initializer', async () => {
  const cases = support.ORACLE_MANDATORY_CASES.filter((item) => [
    'missing-or-wrong-store', 'network-store-fallback', 'altered-schema-guard',
  ].includes(item.input.variant));
  assert.equal(cases.length, 3);
  for (const item of cases) {
    const result = await support.executeAuthorityPacketOracleCase(item);
    assert.equal(result.passed, true, item.id);
  }
});

test('semantic admission binds exact CURRENT, acceptance and fresh packet evidence', () => {
  const fixture = setup('positive');
  const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readers);
  assert.ok(Object.isFrozen(admitted.admission));
  assert.equal(admitted.proof.dependency_state, 'PREDECESSORS_VERIFIED');
  assert.equal(admitted.proof.current.revision, 1);
  assert.equal(fixture.store.revalidateSemanticGate(admitted.admission, { operation: 'loop' }).fresh, true);
  assertCode(() => fixture.store.revalidateSemanticGate({}), 'GPR_PACKET_ADMISSION_REQUIRED');

  const intent = fixture.store.beginSemanticGateDispatch(admitted.admission);
  fixture.store.recordSemanticGateDispatch(admitted.admission, { transport_id: intent.transport_id, transport_result: { status: 'confirmed' }, transport_error: null });
  const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
  try {
    const events = db.prepare('SELECT event_type FROM semantic_gate_admission_events ORDER BY sequence').all();
    assert.deepEqual(events.map((row) => row.event_type), ['DISPATCH_INTENT', 'DISPATCH_CONFIRMED']);
  } finally { db.close(); }
});

test('ambiguous dispatch remains unresolved until definitive not-started evidence, then recovery is bounded', () => {
  const fixture = setup('recovery');
  const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readers);
  const intent = fixture.store.beginSemanticGateDispatch(admitted.admission);
  assertCode(
    () => fixture.store.recordSemanticGateDispatch(admitted.admission, { transport_id: intent.transport_id, transport_result: { status: 'ambiguous' }, transport_error: null }),
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
  fixture.setRecoveryOutcome('not-started');
  const recovered = fixture.store.recoverSemanticGateAdmission({ consumer_key: consumerKey }, fixture.readers);
  assert.equal(recovered.recovered, true);
  const retryIntent = fixture.store.beginSemanticGateDispatch(recovered.admission);
  fixture.store.recordSemanticGateDispatch(recovered.admission, { transport_id: retryIntent.transport_id, transport_result: { status: 'confirmed' }, transport_error: null });
});

test('unbound not-started transport evidence cannot append a retry permission', () => {
  const validReader = support.oracleDispatchOutcomeReader('not-started');
  const fixture = setup('unbound-transport', {
    readDispatchOutcome: (input) => ({ ...validReader(input), transport_id: '0'.repeat(64) }),
  });
  const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readers);
  const intent = fixture.store.beginSemanticGateDispatch(admitted.admission);
  assertCode(() => fixture.store.recordSemanticGateDispatch(admitted.admission, {
    transport_id: intent.transport_id,
    transport_result: { status: 'not-started' },
    transport_error: null,
  }), 'GPR_PACKET_DISPATCH_UNRESOLVED');
  const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
  try {
    const events = db.prepare('SELECT event_type FROM semantic_gate_admission_events ORDER BY sequence').all();
    assert.deepEqual(events.map((row) => row.event_type), ['DISPATCH_INTENT']);
  } finally { db.close(); }
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

test('semantic admission enforces permitted consumer subsets and exact successor candidate applicability', () => {
  const denied = setup('empty-consumers', { permitted_consumers: [] });
  assertCode(() => denied.store.admitSemanticGate(denied.intent, denied.readers), 'GPR_PACKET_CONSUMER_NOT_PERMITTED');
  let db = new DatabaseSync(denied.store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_gate_admissions').get().n, 0); }
  finally { db.close(); }

  const candidate = {
    pr_number: 354,
    branch: 'c1-successor-candidate',
    base_ref: 'main',
    base_sha: '1'.repeat(40),
    head_sha: '2'.repeat(40),
    tree_sha: '3'.repeat(40),
  };
  const candidateReader = () => ({ candidate, candidate_reuse: true });
  const implicit = setup('implicit-successor', { candidate, readCandidate: candidateReader });
  assertCode(() => implicit.store.admitSemanticGate(implicit.intent, implicit.readers), 'GPR_PACKET_BINDING_MISMATCH');
  db = new DatabaseSync(implicit.store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_gate_admissions').get().n, 0); }
  finally { db.close(); }

  const exact = setup('exact-successor', {
    candidate,
    readCandidate: candidateReader,
    successor_applicability: [{
      scope_digest: support.bindings('exact-successor').applicability.required_consumers[0].scope_digest,
      candidate,
    }],
  });
  const admitted = exact.store.admitSemanticGate(exact.intent, exact.readers);
  assert.equal(admitted.proof.dependency_state, 'PREDECESSORS_VERIFIED');
  assert.equal(exact.store.revalidateSemanticGate(admitted.admission).fresh, true);
});

test('receipt-produced CURRENT passes AJV and real N5, v5, and assurance consumers without rewriting', { skip: !Ajv2020 }, () => {
  const gate = support.semanticGate('current-cross-runtime');
  const current = gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers);
  const publishedSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/github-program-reconciler/programme-state-v5.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile({
    ...publishedSchema.$defs.authorityPacketCurrent,
    $defs: publishedSchema.$defs,
  });
  assert.equal(validate(current), true, JSON.stringify(validate.errors));
  assert.equal(reconciler.validateAuthorityPacketCurrent(current, {
    repository: current.repository,
    parent_issue: current.parent_issue,
    child_issue: current.child_issue,
  }), true);
  assert.equal(programme.validateAuthorityPacketCurrent(current, {
    repository: current.repository,
    parent_issue: current.parent_issue,
    child_issue: current.child_issue,
  }), true);
  const admitted = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const assuranceContext = assurance.bindReceiptAdmission(gate.store, admitted.admission);
  assert.equal(assurance.evaluateInvalidation({ event: 'SUCCESSOR_CANDIDATE_HEAD' }, assuranceContext).g4_invalidated, true);
});

test('v2 start and mutation bind semantic, receipt, and Loop RUN identities while ordinary v2 remains compatible', async () => {
  const gate = support.semanticGate('receipt-semantic-binding');
  const semanticRun = gate.consumer_intent.consumer.run;
  const receiptRun = 'receipt-run072-bound';
  const loopRun = gate.consumer_intent.execution_binding.loop_run_id;
  gate.consumer_intent.execution_binding.semantic_run = semanticRun;
  gate.consumer_intent.execution_binding.receipt_run_id = receiptRun;
  const admitted = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const v2Authority = {
    child_comment_id: 1, parent_comment_id: 2, node_id: 'IC_run072_semantic_binding',
    author_login: 'weijunswj', author_association: 'OWNER', body_digest: 'a'.repeat(64),
    updated_at: '2026-09-22T10:00:00.000Z', update_identity_digest: 'b'.repeat(64), scope_digest: 'c'.repeat(64),
  };
  const start = { base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), tree_sha: '3'.repeat(40), status_digest: 'd'.repeat(64), clean_worktree: true, ref: { detached: false, name: 'oracle/run072-semantic' } };
  const required = [{ class: 'G3', dependency_id: gate.consumer_intent.predecessors[0].dependency_id, scope_digest: gate.consumer_intent.consumer.scope_digest }];
  let observedBinding = { semantic_run: semanticRun, receipt_run_id: receiptRun, loop_run_id: loopRun };
  const readAuthority = async () => ({ authority: v2Authority, required_consumers: required, semantic_binding: structuredClone(observedBinding), later_controlling_comments: [] });
  const store = runtime.createProgrammeReceiptStore(support.options(support.stateRoot('run072-v2-semantic-binding-')));
  const session = await store.startRun({
    lock: 'receipt-semantic-lock', authority: v2Authority, start, candidate: null, lease_ms: 60000,
    semantic_gate: { store: gate.store, admission: admitted.admission },
  }, { readAuthority, readStart: async () => start });
  assert.equal(session.started, true);
  assert.equal(session.run_id, receiptRun);

  const target = { resource_type: 'provider_resource', resource_id: 'run072-semantic-resource' };
  const descriptor = {
    operation_kind: 'IDEMPOTENT_SET', safety_class: 'IDEMPOTENT', target_identity: target,
    target_digest: runtime.digestValue(target), expected_source_digest: 'e'.repeat(64), cas_digest: 'f'.repeat(64),
    expected_post_state_digest: '1'.repeat(64), adapter_identity_digest: '2'.repeat(64), retry_of_operation_id: null,
  };
  let providerCalls = 0;
  const mutationReaders = {
    readAuthority,
    readSource: async () => ({ source_digest: descriptor.expected_source_digest, cas_digest: descriptor.cas_digest }),
    verifyOutcomeEvidence: async (value) => value,
  };
  observedBinding = { ...observedBinding, loop_run_id: 'wrong-loop-run' };
  await assert.rejects(store.admitMutationOperation(session, descriptor, mutationReaders),
    (error) => error.code === 'GPR_PACKET_BINDING_MISMATCH');
  let db = new DatabaseSync(store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mutation_operations').get().n, 0); }
  finally { db.close(); }
  observedBinding = { semantic_run: semanticRun, receipt_run_id: receiptRun, loop_run_id: loopRun };
  const mutation = await store.admitMutationOperation(session, descriptor, mutationReaders);
  observedBinding = { ...observedBinding, receipt_run_id: 'wrong-receipt-run' };
  await assert.rejects(store.authorizeMutationDispatch(session, mutation),
    (error) => error.code === 'GPR_PACKET_BINDING_MISMATCH');
  assert.equal(providerCalls, 0);

  const ordinaryRoot = support.stateRoot('run072-v2-ordinary-');
  const ordinary = runtime.createProgrammeReceiptStore(support.options(ordinaryRoot));
  const ordinaryAuthority = { ...v2Authority, node_id: 'IC_run072_ordinary' };
  const ordinaryStarted = await ordinary.startRun({ lock: 'ordinary-lock', authority: ordinaryAuthority, start, candidate: null, lease_ms: 60000 }, {
    readAuthority: async () => ({ authority: ordinaryAuthority, later_controlling_comments: [] }),
    readStart: async () => start,
  });
  assert.equal(ordinaryStarted.started, true);

  for (const mode of ['startRun', 'allocateRun-startAllocatedRun']) {
    const missingStore = runtime.createProgrammeReceiptStore(support.options(support.stateRoot(`run072-v2-missing-${mode}-`)));
    const missingAuthority = { ...v2Authority, node_id: `IC_missing_${mode.replace(/[^A-Za-z0-9]/g, '_')}` };
    const missingReaders = {
      readAuthority: async () => ({ authority: missingAuthority, required_consumers: required, semantic_binding: observedBinding, later_controlling_comments: [] }),
      readStart: async () => start,
    };
    if (mode === 'startRun') {
      await assert.rejects(
        missingStore.startRun({ lock: 'missing-lock', authority: missingAuthority, start, candidate: null, lease_ms: 60000 }, missingReaders),
        (error) => error.code === 'GPR_PACKET_ADMISSION_REQUIRED'
      );
    } else {
      const allocated = missingStore.allocateRun({ lock: 'missing-lock', authority: missingAuthority, start, candidate: null, lease_ms: 60000 });
      await assert.rejects(missingStore.startAllocatedRun(allocated, missingReaders),
        (error) => error.code === 'GPR_PACKET_ADMISSION_REQUIRED');
    }
    db = new DatabaseSync(missingStore.databasePath, { readOnly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0); }
    finally { db.close(); }
  }
});

test('CURRENT confirmation validates 2, 3, and 16 predecessors before one transaction', () => {
  for (const count of [2, 3, 16]) {
    const fixture = multiPredecessorSetup(`positive-${count}`, count);
    const confirmed = fixture.store.confirmCurrentPacketProjection(fixture.current, fixture.readerSet);
    const admitted = fixture.store.admitSemanticGate(fixture.intent, fixture.readerSet);
    assert.equal(admitted.proof.predecessors.length, count);
    assert.equal(confirmed.readback_event_ids.length, count);
    const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM authority_packet_events WHERE event_type='CURRENT_READBACK'").get().n, count);
    } finally { db.close(); }
  }

  const mixed = multiPredecessorSetup('mixed-acceptance', 2);
  const bad = structuredClone(mixed.current);
  bad.predecessors[1].acceptance_event_id = bad.predecessors[0].acceptance_event_id;
  mixed.setCurrent(bad);
  assertCode(() => mixed.store.confirmCurrentPacketProjection(bad, mixed.readerSet), 'GPR_PACKET_CONTENT_MISMATCH');
  let db = new DatabaseSync(mixed.store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM authority_packet_events WHERE event_type='CURRENT_READBACK'").get().n, 0); }
  finally { db.close(); }

  const local = multiPredecessorSetup('foreign-local', 1);
  const foreign = multiPredecessorSetup('foreign-store', 1);
  local.setCurrent(foreign.current);
  assertCode(() => local.store.confirmCurrentPacketProjection(foreign.current, local.readerSet), 'GPR_PACKET_NOT_FOUND');
  db = new DatabaseSync(local.store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM authority_packet_events WHERE event_type='CURRENT_READBACK'").get().n, 0); }
  finally { db.close(); }
});

test('oracle requires the full case identity set and rejects false assertions and mismatched measured effects', async () => {
  const generated = compiler.compileGateContract(JSON.parse(fs.readFileSync(ORACLE_FIXTURE, 'utf8'))).generated_cases;
  const onePerRequirement = generated.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.requirement_id === item.requirement_id) === index);
  assert.throws(() => support.assertOracleHandlerCompleteness(onePerRequirement), /ORACLE_CASE_UNEXECUTED/);

  const acceptanceCase = generated.find((item) => item.requirement_id === 'A05'
    && item.expected.positive_control === true && item.surface === 'bindWebPacketAcceptance');
  const key = support.oracleCaseIdentity(acceptanceCase);
  const falseAssertionHandlers = {
    [key]: async (item, { record }) => {
      const context = support.oracleContext(item.id);
      const call = await support.invokeOracleSurface(item, 'authorityPacketStore', context.store, item.surface, [context.persisted.packet_id, context.readerSet]);
      record('false-production-effect-assertion', false, 'deliberately-false');
      return { production_surface_receipts: [call.receipt] };
    },
  };
  await assert.rejects(
    support.executeAuthorityPacketOracleCase(acceptanceCase, falseAssertionHandlers),
    /ORACLE_ASSERTION_FAILED/
  );

  const mismatchedEffectHandlers = {
    [key]: async (item, { record }) => {
      const context = support.oracleContext(item.id);
      context.store.bindWebPacketAcceptance(context.persisted.packet_id, context.readerSet);
      const call = await support.invokeOracleSurface(item, 'authorityPacketStore', context.store, item.surface, [context.persisted.packet_id, context.readerSet]);
      record('named-boundary-called', !call.error, call.error ? call.error.code : 'ACCEPTED_DUPLICATE');
      return { production_surface_receipts: [call.receipt] };
    },
  };
  await assert.rejects(
    support.executeAuthorityPacketOracleCase(acceptanceCase, mismatchedEffectHandlers),
    /ORACLE_EFFECT_MISMATCH/
  );
});
