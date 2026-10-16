'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const support = require('./toolkit-authority-packet-test-support.cjs');
const fixturePath = path.join(__dirname, 'fixtures/controller-bootstrap-compatibility-predecessor-v1.json');

test.afterEach(() => support.cleanup());

function acceptedFixtureReaders(packetValue, changeSource) {
  const base = support.readers(packetValue);
  return support.readers(packetValue, {
    readGovernance(binding) {
      const result = base.readGovernance(binding);
      return changeSource ? changeSource(structuredClone(result)) : result;
    }
  });
}

function foreignTaskPacket(seed) {
  const packetBindings = support.bindings(seed);
  packetBindings.repository = 'octocat/controller-bootstrap-fixture';
  packetBindings.authority.repository = packetBindings.repository;
  return support.packet({ seed, bindings: packetBindings });
}

function createStore(packetValue, readers) {
  const root = support.stateRoot('controller-bootstrap-compat-');
  const options = {
    ...support.options(root),
    repository: packetValue.bindings.repository,
    parent_issue: packetValue.bindings.parent_issue,
    child_issue: packetValue.bindings.child_issue
  };
  return runtime.initialiseAuthorityPacketStore(options, readers);
}

function eventTypes(store, packetId) {
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    return db.prepare('SELECT event_type FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence')
      .all(packetId).map((row) => row.event_type);
  } finally { db.close(); }
}

test('accepted Toolkit governance remains independent of a foreign task namespace at persistence and acceptance', () => {
  const packetValue = foreignTaskPacket('controller-bootstrap-foreign-task-positive');
  let sourceMode = 'accepted';
  const readers = acceptedFixtureReaders(packetValue, (result) => {
    if (sourceMode === 'truncated') {
      const architecture = result.source_contents.find((item) => item.source_id === 'architecture');
      architecture.content_base64 = architecture.content_base64.slice(0, -4);
    }
    return result;
  });
  const store = createStore(packetValue, readers);
  const ids = runtime.authorityPacketIdentities(packetValue);
  const persisted = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  assert.equal(persisted.packet_id, ids.packet_id);
  assert.equal(packetValue.bindings.repository, 'octocat/controller-bootstrap-fixture');
  assert.equal(packetValue.bindings.governance.repository, 'weijunswj/ai-agent-toolkit');
  assert.deepEqual(store.readAuthorityPacket(ids.packet_id, packetValue.bindings), packetValue);

  const beforeRejectedAcceptance = support.receiptEffectSnapshot(store);
  sourceMode = 'truncated';
  assert.throws(() => store.bindWebPacketAcceptance(ids.packet_id, readers), (error) =>
    error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  assert.deepEqual(support.receiptEffectSnapshot(store), beforeRejectedAcceptance);
  assert.equal(eventTypes(store, ids.packet_id).includes('WEB_ACCEPTANCE_BOUND'), false);

  sourceMode = 'accepted';
  const acceptance = store.bindWebPacketAcceptance(ids.packet_id, readers);
  assert.equal(acceptance.acceptance.disposition, 'ACCEPTED_FOR_CONSUMPTION');
  assert.equal(eventTypes(store, ids.packet_id).includes('WEB_ACCEPTANCE_BOUND'), true);
});

test('governance binding path substitution fails before persistence with zero packet effects', () => {
  const packetValue = foreignTaskPacket('controller-bootstrap-wrong-path');
  const readers = acceptedFixtureReaders(packetValue, (result) => {
    result.binding.sources.find((source) => source.id === 'controller').path = 'repo/ARCHITECTURE.md';
    return result;
  });
  const store = createStore(packetValue, readers);
  const before = support.receiptEffectSnapshot(store);
  assert.throws(() => store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue)), (error) =>
    error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  assert.deepEqual(support.receiptEffectSnapshot(store), before);
  assert.equal(support.receiptEffectSnapshot(store).tables.authority_packets.count, 0);
});

test('task authority cannot rebind the packet to a self-declared governance revision', () => {
  const packetValue = foreignTaskPacket('controller-bootstrap-unaccepted-revision');
  packetValue.bindings.governance.main_commit = 'f'.repeat(40);
  const readers = acceptedFixtureReaders(packetValue);
  const store = createStore(packetValue, readers);
  const before = support.receiptEffectSnapshot(store);
  assert.throws(() => store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue)), (error) =>
    error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  assert.deepEqual(support.receiptEffectSnapshot(store), before);
});

test('governance source drift blocks revalidation and dispatch with zero intent effects', () => {
  let sourceMode = 'accepted';
  const gate = support.semanticGate('source-revalidation', {
    readGovernance(binding) {
      const result = support.readGovernanceSources(binding);
      if (sourceMode === 'truncated') {
        const controller = result.source_contents.find((item) => item.source_id === 'controller');
        controller.content_base64 = controller.content_base64.slice(0, -4);
      }
      return result;
    }
  });
  const admitted = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const before = support.receiptEffectSnapshot(gate.store);
  sourceMode = 'truncated';
  assert.throws(() => gate.store.beginSemanticGateDispatch(admitted.admission), (error) =>
    error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  assert.deepEqual(support.receiptEffectSnapshot(gate.store), before);

  sourceMode = 'accepted';
  const dispatch = gate.store.beginSemanticGateDispatch(admitted.admission);
  assert.equal(typeof dispatch.event_id, 'string');
  const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
  try {
    const intents = db.prepare("SELECT COUNT(*) AS value FROM semantic_gate_admission_events WHERE event_type = 'DISPATCH_INTENT'").get().value;
    assert.equal(intents, 1);
  } finally { db.close(); }
});

test('bootstrap packet case/effect matrix accepts the exact source and blocks truncated governance before persistence', () => {
  const cases = [
    { name: 'accepted-source', mode: 'accepted', accepted: true },
    { name: 'truncated-architecture', mode: 'truncated', accepted: false }
  ];
  for (const scenario of cases) {
    const packetValue = foreignTaskPacket(`bootstrap-matrix-${scenario.name}`);
    let sourceMode = 'accepted';
    const readers = acceptedFixtureReaders(packetValue, (result) => {
      if (sourceMode === 'truncated') {
        const architecture = result.source_contents.find((item) => item.source_id === 'architecture');
        architecture.content_base64 = architecture.content_base64.slice(0, -4);
      }
      return result;
    });
    const store = createStore(packetValue, readers);
    const before = support.receiptEffectSnapshot(store);
    sourceMode = scenario.mode;
    if (!scenario.accepted) {
      assert.throws(() => store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue)), (error) =>
        error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
      assert.deepEqual(support.receiptEffectSnapshot(store), before, scenario.name);
      assert.equal(support.receiptEffectSnapshot(store).tables.authority_packets.count, 0);
      assert.equal(support.receiptEffectSnapshot(store).tables.authority_packet_events.count, 0);
      continue;
    }
    const persisted = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
    const accepted = store.bindWebPacketAcceptance(persisted.packet_id, readers);
    assert.equal(accepted.acceptance.disposition, 'ACCEPTED_FOR_CONSUMPTION');
    const after = support.receiptEffectSnapshot(store);
    assert.equal(after.tables.authority_packets.count, before.tables.authority_packets.count + 1);
    assert.equal(after.tables.authority_packet_events.count, before.tables.authority_packet_events.count + 2);
    assert.equal(after.tables.authority_packet_events.event_proofs.filter((item) => item.event_type === 'WEB_ACCEPTANCE_BOUND').length, 1);
  }
});

test('bootstrap revalidation case/effect matrix blocks dispatch on post-admission source drift', () => {
  let sourceMode = 'accepted';
  const gate = support.semanticGate('bootstrap-case-effect-matrix-dispatch', {
    readGovernance(binding) {
      const result = support.readGovernanceSources(binding);
      if (sourceMode === 'truncated') {
        const controller = result.source_contents.find((item) => item.source_id === 'controller');
        controller.content_base64 = controller.content_base64.slice(0, -4);
      }
      return result;
    }
  });
  const admitted = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const before = support.receiptEffectSnapshot(gate.store);
  sourceMode = 'truncated';
  assert.throws(() => gate.store.beginSemanticGateDispatch(admitted.admission), (error) =>
    error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  const after = support.receiptEffectSnapshot(gate.store);
  assert.deepEqual(after, before);
  assert.equal(after.tables.semantic_gate_admission_events.event_proofs.filter((item) => item.event_type === 'DISPATCH_INTENT').length, 0);
});

test('predecessor fixture retains exact predecessor-produced bytes and identities', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.schema, 'toolkit.github-program.authority-packet-predecessor-fixture.v1');
  assert.equal(fixture.provenance.commit, '051479504b16e694d84ab66d2f091383a74a9ed9');
  assert.equal(fixture.provenance.tree, 'b4c7154780fa2e7c39277d4f1ec67f5699062d48');
  assert.equal(fixture.artifacts.length, 9);
  for (const artifact of fixture.artifacts) {
    const bytes = Buffer.from(artifact.content_base64, 'base64');
    assert.equal(bytes.length, artifact.bytes, artifact.name);
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.name);
    assert.equal(bytes.toString('base64'), artifact.content_base64, artifact.name);
  }
  const packetArtifact = fixture.artifacts.find((item) => item.name === 'predecessor-packet.json');
  const packet = runtime.validateAuthorityPacket(Buffer.from(packetArtifact.content_base64, 'base64'));
  const identities = runtime.authorityPacketIdentities(packet);
  assert.equal(identities.packet_id, fixture.provenance.packet_id);
  assert.equal(identities.packet_digest, fixture.provenance.packet_digest);
  assert.equal(identities.producer_key, fixture.provenance.producer_key);
  const events = JSON.parse(Buffer.from(
    fixture.artifacts.find((item) => item.name === 'predecessor-event-rows.json').content_base64, 'base64'
  ).toString('utf8'));
  assert.deepEqual(events.map((item) => item.event_type), ['READBACK_VERIFIED', 'WEB_ACCEPTANCE_BOUND', 'CURRENT_READBACK']);
});

test('predecessor bytes remain readable, while an unbound copied CURRENT store identity blocks admission', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const artifacts = new Map(fixture.artifacts.map((item) => [item.name, Buffer.from(item.content_base64, 'base64')]));
  const packet = runtime.validateAuthorityPacket(artifacts.get('predecessor-packet.json'));
  const originalDelivery = runtime.validateAuthorityPacketDelivery(
    JSON.parse(artifacts.get('predecessor-fresh-delivery.json').toString('utf8')),
    { expectedBindings: packet.bindings, packet }
  );
  const current = runtime.validateAuthorityPacketCurrent(
    JSON.parse(artifacts.get('predecessor-current-projection.json').toString('utf8'))
  );
  const confirmation = JSON.parse(artifacts.get('predecessor-current-confirmation.json').toString('utf8'));
  const readerSet = support.readers(packet, {
    readCandidate: () => current.candidate,
    readCurrent: () => ({
      current,
      projection_digest: confirmation.projection_digest,
      body_digest: confirmation.body_digest,
      revision: confirmation.revision
    }),
    readDispatchOutcome: () => ({})
  });
  const root = support.stateRoot('predecessor-consume-');
  const store = runtime.initialiseAuthorityPacketStore(support.options(root), readerSet);
  fs.writeFileSync(store.databasePath, artifacts.get('predecessor-authority-packet.sqlite'));

  assert.deepEqual(store.readAuthorityPacket(fixture.provenance.packet_id, packet.bindings), packet);
  const fresh = store.verifyAuthorityPacketFresh(fixture.provenance.packet_id, packet.bindings);
  assert.equal(runtime.canonicalSerialize(fresh.packet), runtime.canonicalSerialize(packet));
  assert.notEqual(fresh.envelope.store_identity_digest, originalDelivery.envelope.store_identity_digest);
  const acceptance = store.bindWebPacketAcceptance(fixture.provenance.packet_id, readerSet);
  assert.equal(acceptance.duplicate, true);
  assert.equal(acceptance.acceptance_event_id, fixture.provenance.acceptance_event_id);

  const beforeRejectedCurrent = support.receiptEffectSnapshot(store);
  assert.throws(() => store.confirmCurrentPacketProjection(current, readerSet), (error) =>
    error && error.code === 'GPR_PACKET_CURRENT_UNVERIFIED');
  assert.deepEqual(support.receiptEffectSnapshot(store), beforeRejectedCurrent);

  const intent = {
    ...current,
    execution_binding: {
      semantic_run: null,
      receipt_run_id: null,
      loop_run_id: 'loop-phasea-predecessor-20261002-001',
      repository_id: 'b'.repeat(64),
      authorized_ref_digest: 'c'.repeat(64),
      current_authority_digest: 'd'.repeat(64)
    },
    predecessors: current.predecessors.map(({ packet_id, dependency_id }) => ({ packet_id, dependency_id })),
    operation: 'loop'
  };
  const beforeRejectedAdmission = support.receiptEffectSnapshot(store);
  assert.throws(() => store.admitSemanticGate(intent, readerSet), (error) =>
    error && error.code === 'GPR_PACKET_BINDING_MISMATCH');
  assert.deepEqual(support.receiptEffectSnapshot(store), beforeRejectedAdmission);
  assert.equal(support.receiptEffectSnapshot(store).tables.semantic_gate_admissions.count, 0);
});

test('explicit predecessor backfill retains exact packet bytes and rechecks the source before Web acceptance', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const packetArtifact = fixture.artifacts.find((item) => item.name === 'predecessor-packet.json');
  const packetBytes = Buffer.from(packetArtifact.content_base64, 'base64');
  const packetValue = runtime.validateAuthorityPacket(packetBytes);
  const identities = runtime.authorityPacketIdentities(packetBytes);
  const base = support.readers(packetValue);
  assert.equal(packetBytes.length, packetArtifact.bytes);
  assert.equal(require('node:crypto').createHash('sha256').update(packetBytes).digest('hex'), packetArtifact.sha256);
  assert.equal(packetBytes.toString('utf8'), identities.canonical_packet_bytes);
  assert.equal(packetValue.body.evidence_refs.filter((item) => item.kind === 'GIT_BLOB').length, 0);
  assert.notDeepEqual(
    base.readAuthority({ repository: packetValue.bindings.repository }).governance_binding.governance,
    packetValue.bindings.governance
  );

  let sourceMode = 'exact';
  const readers = support.readers(packetValue, {
    readGovernance(binding) {
      const result = base.readGovernance(binding);
      if (sourceMode === 'governance-drift') {
        const controller = result.source_contents.find((item) => item.source_id === 'controller');
        controller.content_base64 = Buffer.from('changed governance source bytes', 'utf8').toString('base64');
      }
      return result;
    },
    readBackfillSource() {
      const sourcePacket = sourceMode === 'packet-drift'
        ? { ...packetValue, body: { ...packetValue.body, decision: `${packetValue.body.decision} changed` } }
        : packetValue;
      return {
        source_ref: support.sourceReference('predecessor-backfill'),
        source_packet_digest: identities.packet_digest,
        source_binding_digest: identities.binding_digest,
        producer_key: identities.producer_key,
        source_packet: sourcePacket,
        screening: support.screening(packetValue)
      };
    }
  });
  const store = createStore(packetValue, readers);
  const before = support.receiptEffectSnapshot(store);

  sourceMode = 'governance-drift';
  assert.throws(() => store.backfillAuthorityPacket(packetBytes, readers), (error) =>
    error && error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED');
  assert.deepEqual(support.receiptEffectSnapshot(store), before);
  assert.deepEqual(eventTypes(store, identities.packet_id), []);

  sourceMode = 'packet-drift';
  assert.throws(() => store.backfillAuthorityPacket(packetBytes, readers), (error) =>
    error && error.code === 'GPR_PACKET_LEGACY_RERUN_REQUIRED');
  assert.deepEqual(support.receiptEffectSnapshot(store), before);
  assert.deepEqual(eventTypes(store, identities.packet_id), []);

  sourceMode = 'exact';
  const backfill = store.backfillAuthorityPacket(packetBytes, readers);
  assert.equal(backfill.packet_digest, identities.packet_digest);
  assert.deepEqual(store.readAuthorityPacket(identities.packet_id, packetValue.bindings), packetValue);
  assert.deepEqual(eventTypes(store, identities.packet_id), ['READBACK_VERIFIED', 'BACKFILL_AUTHORISED']);

  const acceptance = store.bindWebPacketAcceptance(identities.packet_id, readers);
  assert.equal(acceptance.acceptance.disposition, 'ACCEPTED_FOR_CONSUMPTION');
  assert.equal(acceptance.duplicate, false);
  assert.notEqual(acceptance.acceptance.readback_event_id, backfill.readback_event_id);
  assert.deepEqual(store.readAuthorityPacket(identities.packet_id, packetValue.bindings), packetValue);
  assert.deepEqual(eventTypes(store, identities.packet_id), [
    'READBACK_VERIFIED', 'BACKFILL_AUTHORISED', 'READBACK_VERIFIED', 'WEB_ACCEPTANCE_BOUND'
  ]);

  const beforeChangedSource = support.receiptEffectSnapshot(store);
  sourceMode = 'packet-drift';
  assert.throws(() => store.bindWebPacketAcceptance(identities.packet_id, readers), (error) =>
    error && error.code === 'GPR_PACKET_LEGACY_RERUN_REQUIRED');
  assert.deepEqual(support.receiptEffectSnapshot(store), beforeChangedSource);
  assert.deepEqual(eventTypes(store, identities.packet_id), [
    'READBACK_VERIFIED', 'BACKFILL_AUTHORISED', 'READBACK_VERIFIED', 'WEB_ACCEPTANCE_BOUND'
  ]);
});


test('backfill rechecks source and governance after fresh-process delivery before authorization events', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const packetArtifact = fixture.artifacts.find((item) => item.name === 'predecessor-packet.json');
  const packetBytes = Buffer.from(packetArtifact.content_base64, 'base64');
  const packetValue = runtime.validateAuthorityPacket(packetBytes);
  const identities = runtime.authorityPacketIdentities(packetBytes);

  for (const scenario of [
    { drift: 'source', expectedCode: 'GPR_PACKET_LEGACY_RERUN_REQUIRED', expectedGovernanceReads: 2 },
    { drift: 'governance', expectedCode: 'GPR_PACKET_AUTHORITY_UNVERIFIED', expectedGovernanceReads: 3 }
  ]) {
    let sourceReads = 0;
    let governanceReads = 0;
    const base = support.readers(packetValue);
    const readers = support.readers(packetValue, {
      readGovernance(binding) {
        governanceReads += 1;
        const result = base.readGovernance(binding);
        if (scenario.drift === 'governance' && governanceReads === 3) {
          const controller = result.source_contents.find((item) => item.source_id === 'controller');
          controller.content_base64 = Buffer.from('late governance source drift', 'utf8').toString('base64');
        }
        return result;
      },
      readBackfillSource() {
        sourceReads += 1;
        return {
          source_ref: support.sourceReference(
            scenario.drift === 'source' && sourceReads === 4
              ? 'predecessor-backfill-late-drift' : 'predecessor-backfill-stable'
          ),
          source_packet_digest: identities.packet_digest,
          source_binding_digest: identities.binding_digest,
          producer_key: identities.producer_key,
          source_packet: packetValue,
          screening: support.screening(packetValue)
        };
      }
    });
    const store = createStore(packetValue, readers);
    const before = support.receiptEffectSnapshot(store);

    assert.throws(() => store.backfillAuthorityPacket(packetBytes, readers), (error) =>
      error && error.code === scenario.expectedCode);

    const after = support.receiptEffectSnapshot(store);
    const changedTables = Object.entries(after.tables)
      .filter(([table, snapshot]) => snapshot.count !== before.tables[table].count
        || snapshot.rows_digest !== before.tables[table].rows_digest)
      .map(([table, snapshot]) => ({ table, delta: snapshot.count - before.tables[table].count }));
    assert.deepEqual(changedTables, [{ table: 'authority_packets', delta: 1 }]);
    assert.equal(after.tables.authority_packets.count, before.tables.authority_packets.count + 1);
    assert.equal(after.tables.authority_packet_events.count, before.tables.authority_packet_events.count);
    assert.deepEqual(eventTypes(store, identities.packet_id), []);
    assert.deepEqual(store.readAuthorityPacket(identities.packet_id, packetValue.bindings), packetValue);
    assert.equal(sourceReads, 4);
    assert.equal(governanceReads, scenario.expectedGovernanceReads);
  }
});
