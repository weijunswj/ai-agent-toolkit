'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const test = require('node:test');
let Ajv2020 = null;
try { Ajv2020 = require('ajv/dist/2020'); } catch (_) { /* Optional in dependency-light checkouts. */ }

let failedVerifierCalls = 0;
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (file, args, options) {
  if (failedVerifierCalls > 0 && Array.isArray(args) && args.includes('verify-authority-packet-store')) {
    failedVerifierCalls -= 1;
    return { pid: 1, output: [], stdout: '', stderr: 'injected-verifier-failure', status: 1, signal: null, error: null };
  }
  return originalSpawnSync.call(this, file, args, options);
};

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const support = require('./toolkit-authority-packet-test-support.cjs');
const schemaPath = path.join(__dirname, '../contracts/github-program-receipt/authority-packet-v1.schema.json');
const policyPath = path.join(__dirname, '../contracts/github-program-receipt/github-program-receipt-policy.json');

test.afterEach(() => { failedVerifierCalls = 0; support.cleanup(); });

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function packetFixture(seed = 'packet') {
  return support.packet({ seed, bindings: support.bindings(seed) });
}

const PROXY_TRAP_NAMES = Object.freeze([
  'get', 'set', 'has', 'deleteProperty', 'defineProperty', 'getOwnPropertyDescriptor', 'ownKeys',
  'getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'preventExtensions', 'apply', 'construct',
]);

function observedProxy(target, counters, shouldThrow = false) {
  const handler = {};
  for (const name of PROXY_TRAP_NAMES) {
    handler[name] = (...args) => {
      counters[name] += 1;
      if (shouldThrow) throw new Error(`trap:${name}`);
      if (name === 'apply') return Reflect.apply(...args);
      if (name === 'construct') return Reflect.construct(...args);
      return Reflect[name](...args);
    };
  }
  return new Proxy(target, handler);
}

function proxyTrapCounters() {
  return Object.fromEntries(PROXY_TRAP_NAMES.map((name) => [name, 0]));
}

function initialise(packetValue, root = support.stateRoot()) {
  const storeOptions = support.options(root);
  const readers = support.readers(packetValue);
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readers);
  return { store, storeOptions, packetValue, readers };
}

function schemaValidator() {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat('date-time', () => true);
  return { schema, validate: ajv.compile(schema) };
}

test('Run-077 C2 terminal custody policy and runtime reason codes remain aligned', () => {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const custody = policy.receipt_lifecycle.semantic_terminal_custody;
  const reasons = [
    'GPR_PACKET_OUTGOING_CUSTODY_REQUIRED',
    'GPR_PACKET_OUTGOING_CUSTODY_MISMATCH',
    'GPR_PACKET_AUTHORITY_UNVERIFIED',
  ];
  assert.equal(custody.common_boundary, 'appendReceiptInternal');
  assert.deepEqual(custody.terminal_types, ['EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED']);
  assert.deepEqual(custody.required_input.keys, ['store', 'outcome_ref']);
  assert.equal(custody.required_input.payload_evidence_digest_must_match, true);
  assert.equal(custody.substantive_output_must_preexist, true);
  assert.equal(custody.duplicate_replay_reverifies_custody, true);
  assert.deepEqual(custody.reason_codes, reasons);
  for (const reason of reasons) assert.equal(runtime.AUTHORITY_PACKET_REASON_CODES.includes(reason), true, reason);
});

test('authority packet JSON contract is closed and accepts the complete fixture', { skip: !Ajv2020 }, () => {
  const { schema, validate } = schemaValidator();
  const value = packetFixture();
  assert.equal(schema.$id, runtime.AUTHORITY_PACKET_SCHEMA_ID);
  assert.equal(validate(value), true);
  assert.equal(validate({ ...value, unexpected: true }), false);
  assert.equal(validate({ ...value, bindings: { ...value.bindings, human_owner: 'owner with spaces' } }), false);
});

test('authority packet producer RUN uses the physical Loop intersection', { skip: !Ajv2020 }, () => {
  const { validate } = schemaValidator();
  const packetValue = packetFixture('producer-run-domain');
  packetValue.bindings.producer.run = 'r'.repeat(128);
  assert.equal(runtime.validateAuthorityPacket(packetValue).bindings.producer.run, 'r'.repeat(128));
  assert.equal(validate(packetValue), true);
  for (const run of ['r'.repeat(129), 'producer/run', 'producer\\run', '-leading', 'bad..run']) {
    const malformed = structuredClone(packetValue);
    malformed.bindings.producer.run = run;
    assertCode(() => runtime.validateAuthorityPacket(malformed), 'GPR_PACKET_VALUE_INVALID');
    assert.equal(validate(malformed), false, run);
  }
});

test('authority packet validation rejects noncanonical, sparse, accessor, custom-value, and privacy inputs', () => {
  const value = packetFixture();
  assertCode(() => runtime.validateAuthorityPacket(JSON.stringify(value)), 'GPR_PACKET_VALUE_INVALID');
  const canonicalBytes = Buffer.from(runtime.canonicalSerialize(value), 'utf8');
  assert.equal(runtime.validateAuthorityPacket(canonicalBytes).schema, runtime.AUTHORITY_PACKET_SCHEMA_ID);
  let bufferGetterCalls = 0;
  const decoratedBuffer = Buffer.from(canonicalBytes);
  Object.defineProperty(decoratedBuffer, 'toJSON', { enumerable: true, get() { bufferGetterCalls += 1; return () => ({}); } });
  assertCode(() => runtime.validateAuthorityPacket(decoratedBuffer), 'GPR_PACKET_VALUE_INVALID');
  assert.equal(bufferGetterCalls, 0);
  const sparse = structuredClone(value);
  delete sparse.body.sections[1];
  assertCode(() => runtime.validateAuthorityPacket(sparse), 'GPR_PACKET_VALUE_INVALID');
  const accessor = structuredClone(value);
  Object.defineProperty(accessor.body, 'decision', { enumerable: true, get() { return 'not data'; } });
  assertCode(() => runtime.validateAuthorityPacket(accessor), 'GPR_PACKET_VALUE_INVALID');
  const custom = structuredClone(value);
  custom.body.decision = new String('custom prototype');
  assertCode(() => runtime.validateAuthorityPacket(custom), 'GPR_PACKET_VALUE_INVALID');
  const lone = structuredClone(value);
  lone.body.decision = String.fromCharCode(0xd800);
  assertCode(() => runtime.validateAuthorityPacket(lone), 'GPR_PACKET_VALUE_INVALID');
  const privateValue = structuredClone(value);
  privateValue.body.decision = 'password=raw-secret-value';
  assertCode(() => runtime.validateAuthorityPacket(privateValue), 'GPR_PACKET_PRIVACY_REJECTED');
  const pathValue = structuredClone(value);
  pathValue.body.decision = 'The private file is C:\\Users\\owner\\secret.txt';
  assertCode(() => runtime.validateAuthorityPacket(pathValue), 'GPR_PACKET_PRIVACY_REJECTED');
});

test('authority packet ingestion rejects Proxies before every trap, including revoked and cross-realm targets', () => {
  const calibration = proxyTrapCounters();
  const object = observedProxy({}, calibration);
  void object.missing;
  object.value = 1;
  assert.equal('value' in object, true);
  delete object.value;
  Object.defineProperty(object, 'value', { value: 1, configurable: true });
  Object.getOwnPropertyDescriptor(object, 'value');
  Reflect.ownKeys(object);
  Object.getPrototypeOf(object);
  Object.setPrototypeOf(object, null);
  Object.isExtensible(object);
  Object.preventExtensions(object);
  const callable = observedProxy(function callableTarget() {}, calibration);
  callable();
  Reflect.construct(callable, []);
  assert.deepEqual(PROXY_TRAP_NAMES.filter((name) => calibration[name] > 0).sort(), [...PROXY_TRAP_NAMES].sort());

  const assertRejectedWithoutTraps = (input, expected, label) => {
    const counters = proxyTrapCounters();
    const proxy = observedProxy(input, counters);
    assertCode(() => runtime.validateAuthorityPacket(proxy, expected), 'GPR_PACKET_VALUE_INVALID');
    assert.deepEqual(counters, proxyTrapCounters(), label);
  };
  assertRejectedWithoutTraps(packetFixture('proxy-root'), undefined, 'ordinary object target');
  assertRejectedWithoutTraps([], undefined, 'array target');
  assertRejectedWithoutTraps(function hostileTarget() {}, undefined, 'callable function target');
  assertRejectedWithoutTraps(Buffer.from(runtime.canonicalSerialize(packetFixture('buffer-proxy'))), undefined, 'Buffer target');

  const nestedCounters = proxyTrapCounters();
  const nested = packetFixture('proxy-nested');
  nested.body.sections = observedProxy(nested.body.sections, nestedCounters);
  assertCode(() => runtime.validateAuthorityPacket(nested), 'GPR_PACKET_VALUE_INVALID');
  assert.deepEqual(nestedCounters, proxyTrapCounters(), 'nested array placement');

  const expectedCounters = proxyTrapCounters();
  const clean = packetFixture('proxy-expected');
  const identities = runtime.authorityPacketIdentities(clean);
  const expected = observedProxy({ bindings: clean.bindings, packet_id: identities.packet_id }, expectedCounters);
  assertCode(() => runtime.validateAuthorityPacket(clean, expected), 'GPR_PACKET_VALUE_INVALID');
  assert.deepEqual(expectedCounters, proxyTrapCounters(), 'expected binding placement');

  const revokedCounters = proxyTrapCounters();
  const revoked = Proxy.revocable(packetFixture('proxy-revoked'), observedProxy({}, revokedCounters));
  revoked.revoke();
  assertCode(() => runtime.validateAuthorityPacket(revoked.proxy), 'GPR_PACKET_VALUE_INVALID');
  assert.deepEqual(revokedCounters, proxyTrapCounters(), 'revoked target');

  const crossRealmCounters = proxyTrapCounters();
  const makeCrossRealmProxy = vm.runInNewContext('(target, handler) => new Proxy(target, handler)');
  const crossRealm = makeCrossRealmProxy(packetFixture('proxy-cross-realm'), observedProxy({}, crossRealmCounters));
  assertCode(() => runtime.validateAuthorityPacket(crossRealm), 'GPR_PACKET_VALUE_INVALID');
  assert.deepEqual(crossRealmCounters, proxyTrapCounters(), 'cross-realm target');

  const throwingCounters = proxyTrapCounters();
  const throwing = observedProxy(packetFixture('proxy-throwing'), throwingCounters, true);
  assertCode(() => runtime.validateAuthorityPacket(throwing), 'GPR_PACKET_VALUE_INVALID');
  assert.deepEqual(throwingCounters, proxyTrapCounters(), 'throwing traps remain unobserved');
});

test('authority packet copying rejects conversion hooks without invoking caller getters or methods', () => {
  const counts = { getter: 0, setter: 0, toJSON: 0, toString: 0, valueOf: 0, toPrimitive: 0 };
  const value = packetFixture('conversion-hooks');
  Object.defineProperty(value.body, 'toJSON', { enumerable: true, get() { counts.getter += 1; counts.toJSON += 1; return () => ({}); } });
  Object.defineProperty(value.body, 'toString', { enumerable: true, value() { counts.toString += 1; return ''; } });
  Object.defineProperty(value.body, 'valueOf', { enumerable: true, value() { counts.valueOf += 1; return ''; } });
  Object.defineProperty(value.body, Symbol.toPrimitive, { enumerable: true, value() { counts.toPrimitive += 1; return ''; } });
  Object.defineProperty(value.body, 'setterOnly', { enumerable: true, set() { counts.setter += 1; } });
  assertCode(() => runtime.validateAuthorityPacket(value), 'GPR_PACKET_VALUE_INVALID');
  assert.deepEqual(counts, { getter: 0, setter: 0, toJSON: 0, toString: 0, valueOf: 0, toPrimitive: 0 });
});

test('packet identities are deterministic and producer identity is independent of body content', () => {
  const first = packetFixture('identity');
  const second = structuredClone(first);
  second.body.decision = 'A different semantic body with the same producer invocation.';
  const firstIdentity = runtime.authorityPacketIdentities(first);
  const secondIdentity = runtime.authorityPacketIdentities(second);
  assert.notEqual(firstIdentity.packet_id, secondIdentity.packet_id);
  assert.equal(firstIdentity.producer_key, secondIdentity.producer_key);
  assert.equal(firstIdentity.packet_id, `ap1-${firstIdentity.packet_digest}`);
  assert.equal(firstIdentity.content_digest, runtime.digestValue(first.body));
  assert.equal(firstIdentity.binding_digest, runtime.digestValue(first.bindings));
  assert.equal(firstIdentity.canonical_packet_bytes, runtime.canonicalSerialize(first));
  const runtimeIdentity = runtime.authorityPacketRuntimeIdentity();
  assert.match(runtimeIdentity.gate_contract_compiler_digest, /^[a-f0-9]{64}$/);
  assert.match(runtimeIdentity.runtime_identity_digest, /^[a-f0-9]{64}$/);
});

test('packet validation binds recomputed content identities and exact ownership bindings when supplied', () => {
  const original = packetFixture('expected-identity');
  const identity = runtime.authorityPacketIdentities(original);
  const changedBody = structuredClone(original);
  changedBody.body.decision = 'content-only recompute must not preserve the original identity';
  assert.throws(() => runtime.validateAuthorityPacket(changedBody, {
    packet_id: identity.packet_id,
    packet_digest: identity.packet_digest,
    content_digest: identity.content_digest,
  }), (error) => error.code === 'GPR_PACKET_IDENTITY_MISMATCH');
  const changedBinding = structuredClone(original);
  changedBinding.bindings.lane_id = 'different-owner-lane';
  assert.throws(() => runtime.validateAuthorityPacket(changedBinding, {
    binding_digest: identity.binding_digest,
    bindings: original.bindings,
  }), (error) => error.code === 'GPR_PACKET_BINDING_MISMATCH');
  assert.throws(() => runtime.validateAuthorityPacket(original, {
    canonical_packet_bytes: `${identity.canonical_packet_bytes}\n`,
  }), (error) => error.code === 'GPR_PACKET_CONTENT_MISMATCH');
});

test('initialisation creates a v4 store with four strict append-only tables and leaves v2 factory semantics separate', () => {
  const packetValue = packetFixture('schema');
  const { store, storeOptions } = initialise(packetValue);
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), runtime.AUTHORITY_PACKET_USER_VERSION);
    assert.equal(db.prepare('PRAGMA application_id').get().application_id, runtime.APPLICATION_ID);
    const tables = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name IN ('authority_packets','authority_packet_events','semantic_gate_admissions','semantic_gate_admission_events') ORDER BY name").all();
    assert.deepEqual(tables.map((row) => row.name), [
      'authority_packet_events', 'authority_packets', 'semantic_gate_admission_events', 'semantic_gate_admissions'
    ]);
    assert.ok(tables.every((row) => /STRICT/.test(row.sql)));
    assert.equal(runtime.authorityPacketStoreIdentity(storeOptions), store.storeIdentityDigest());
  } finally {
    db.close();
  }
});

test('persistence is atomic, immutable, idempotent by identity, and readable after reopen', () => {
  const packetValue = packetFixture('persist');
  const { store, storeOptions } = initialise(packetValue);
  const first = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  const duplicate = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.packet_id, duplicate.packet_id);
  const reopened = runtime.createAuthorityPacketStore(storeOptions, support.readers(packetValue));
  assert.deepEqual(reopened.readAuthorityPacket(first.packet_id, packetValue.bindings), packetValue);
  const conflicting = structuredClone(packetValue);
  conflicting.body.decision = 'Conflicting immutable result for the same producer key.';
  const conflictReaders = runtime.createAuthorityPacketStore(storeOptions, support.readers(conflicting));
  assertCode(() => conflictReaders.persistAuthorityPacket(conflicting, support.producerAdmission(conflicting)), 'GPR_PACKET_CONFLICT');
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS value FROM authority_packets').get().value, 1); }
  finally { db.close(); }
});

test('authenticity guards return no mutable ownership or reader state and reject cross-store handles', () => {
  const gate = support.semanticGate('private-ownership');
  const admitted = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const second = runtime.createAuthorityPacketStore(gate.storeOptions, gate.trusted_readers);
  const storeGuard = runtime.assertAuthenticAuthorityPacketStore(gate.store);
  assert.equal(storeGuard, true);
  assert.equal(typeof storeGuard, 'boolean');
  assert.equal(runtime.assertAuthenticSemanticGateAdmission(gate.store, admitted.admission), true);
  assert.equal(gate.store.bindWebPacketAcceptance(gate.consumer_intent.predecessors[0].packet_id, gate.trusted_readers).duplicate, true);
  assert.throws(() => second.revalidateSemanticGate(admitted.admission), (error) => error.code === 'GPR_PACKET_ADMISSION_REQUIRED');
  const assurance = require('../scripts/toolkit-assurance-web-finality.cjs');
  assert.throws(() => assurance.bindReceiptAdmission(second, admitted.admission), /RECEIPT_ADMISSION_INVALID/);
});

test('constructor-captured screening cannot be replaced through the supplied reader object', () => {
  const packetValue = packetFixture('captured-reader');
  const storeOptions = support.options(support.stateRoot('authority-packet-captured-reader-'));
  let screeningDecision = 'ALLOW';
  let replacementCalls = 0;
  const readers = support.readers(packetValue, {
    screenPacket: ({ packet }) => ({ ...support.screening(packet), decision: screeningDecision }),
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readers);
  const persisted = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  screeningDecision = 'REJECT';
  readers.screenPacket = ({ packet }) => { replacementCalls += 1; return support.screening(packet); };
  const changedPacket = structuredClone(packetValue);
  changedPacket.body.decision += ' follow-up body';
  assert.throws(
    () => store.persistAuthorityPacket(changedPacket, support.producerAdmission(changedPacket)),
    (error) => error.code === 'GPR_PACKET_PRIVACY_REJECTED'
  );
  assert.throws(
    () => store.bindWebPacketAcceptance(persisted.packet_id, readers),
    (error) => error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED'
  );
  assert.equal(replacementCalls, 0);
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS value FROM authority_packets').get().value, 1); }
  finally { db.close(); }
});

test('producer lane and owner must match independent trusted producer authority before persistence', () => {
  const packetValue = packetFixture('trusted-producer-lane');
  packetValue.bindings.lane_id = 'unapproved-lane';
  const trustedProducer = {
    lane_id: 'c1-g3-leaf-a',
    human_owner: packetValue.bindings.human_owner,
    producer: structuredClone(packetValue.bindings.producer),
  };
  const storeOptions = support.options(support.stateRoot('authority-packet-trusted-producer-'));
  const readerSet = support.readers(packetValue, {
    producer_authority: trustedProducer,
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
  assert.throws(
    () => store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue)),
    (error) => error.code === 'GPR_PACKET_AUTHORITY_UNVERIFIED'
  );
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM authority_packets').get().n, 0); }
  finally { db.close(); }
});

test('fresh-process delivery returns a full packet larger than the legacy 16 KiB verifier limit', () => {
  const packetValue = packetFixture('fresh-reader');
  packetValue.body.sections[0].text = 'bounded implementation detail '.repeat(1200);
  const { store } = initialise(packetValue);
  const persisted = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  const delivery = store.verifyAuthorityPacketFresh(persisted.packet_id, packetValue.bindings);
  assert.ok(Buffer.byteLength(delivery.envelope.canonical_packet_bytes, 'utf8') > 16 * 1024);
  assert.equal(delivery.envelope.challenge.length, 64);
  assert.deepEqual(delivery.packet, packetValue);
  assert.deepEqual(runtime.validateAuthorityPacketDelivery(delivery, {
    packet_id: persisted.packet_id,
    expectedBindings: packetValue.bindings,
    packet: packetValue,
    store_identity_digest: store.storeIdentityDigest(),
    runtime_identity_digest: delivery.envelope.runtime_identity_digest,
    namespace_digest: runtime.namespaceDigest({ repository: 'weijunswj/ai-agent-toolkit', parent_issue: 435, child_issue: 435 })
  }), delivery);
  const oversizedDelivery = structuredClone(delivery);
  oversizedDelivery.envelope.canonical_packet_bytes = 'x'.repeat(runtime.AUTHORITY_PACKET_LIMITS.deliveryBytes + 1);
  assertCode(() => runtime.validateAuthorityPacketDelivery(oversizedDelivery), 'GPR_PACKET_LIMIT');

  const traps = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const handler = {
    get(target, key, receiver) { traps.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { traps.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { traps.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { traps.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  };
  assertCode(() => runtime.validateAuthorityPacketDelivery(new Proxy(delivery, handler)), 'GPR_PACKET_READBACK_FAILED');
  assert.deepEqual(traps, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
  assertCode(() => runtime.validateAuthorityPacketDelivery(delivery, new Proxy({ bindings: packetValue.bindings }, handler)), 'GPR_PACKET_READBACK_FAILED');
  assert.deepEqual(traps, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
  const processResult = { error: null, signal: null, status: 0, stdout: runtime.canonicalSerialize(delivery) + '\n', stderr: '' };
  assertCode(() => runtime.validateAuthorityPacketDeliveryProcessResult(new Proxy(processResult, handler), {}), 'GPR_PACKET_READBACK_FAILED');
  assert.deepEqual(traps, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
});

test('authority packet event identities are append-only and duplicate-safe', () => {
  const packetValue = packetFixture('events');
  const { store, readers } = initialise(packetValue);
  const persisted = store.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  const first = store.bindWebPacketAcceptance(persisted.packet_id, readers);
  const duplicate = store.bindWebPacketAcceptance(persisted.packet_id, readers);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.acceptance_event_id, first.acceptance_event_id);
  assert.equal(store.readAuthorityPacket(persisted.packet_id, packetValue.bindings).bindings.repository, 'weijunswj/ai-agent-toolkit');
  const db = new DatabaseSync(store.databasePath);
  try {
    assert.throws(() => db.exec(`UPDATE authority_packets SET canonical_json='{}' WHERE packet_id='${persisted.packet_id}'`), /GPR_APPEND_ONLY/);
    assert.throws(() => db.exec(`DELETE FROM authority_packet_events WHERE packet_id='${persisted.packet_id}'`), /GPR_APPEND_ONLY/);
    assert.throws(() => db.exec(`INSERT OR REPLACE INTO authority_packets SELECT * FROM authority_packets WHERE packet_id='${persisted.packet_id}'`), /GPR_APPEND_ONLY/);
  } finally { db.close(); }
});

test('migration is explicit, quiescent, preserves v2 receipt rows, and rejects v3 input', () => {
  const root = support.stateRoot('authority-packet-migration-');
  const storeOptions = support.options(root);
  const legacy = runtime.createProgrammeReceiptStore(storeOptions);
  const plan = runtime.planAuthorityPacketMigration(storeOptions);
  assert.equal(plan.target_user_version, runtime.AUTHORITY_PACKET_USER_VERSION);
  assert.equal(plan.target_schema_fingerprint, runtime.expectedAuthorityPacketSchemaFingerprint());
  const migrated = runtime.migrateAuthorityPacketStore(storeOptions);
  assert.equal(migrated.storeIdentityDigest().length, 64);
  const db = new DatabaseSync(migrated.databasePath, { readOnly: true });
  try { assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 4); }
  finally { db.close(); }
  assert.equal(typeof legacy.readReceiptChain, 'function');
  const v3 = new DatabaseSync(migrated.databasePath);
  try { v3.exec('PRAGMA user_version=3'); }
  finally { v3.close(); }
  assertCode(() => runtime.planAuthorityPacketMigration(storeOptions), 'GPR_PACKET_MIGRATION_SOURCE_INVALID');
});

function v2ReceiptInputs(seed) {
  const authority = {
    child_comment_id: 1,
    parent_comment_id: 2,
    node_id: `IC_${seed}`,
    author_login: 'weijunswj',
    author_association: 'OWNER',
    body_digest: 'a'.repeat(64),
    updated_at: '2026-09-22T10:00:00.000Z',
    update_identity_digest: 'b'.repeat(64),
    scope_digest: 'c'.repeat(64),
  };
  const start = {
    base_sha: '1'.repeat(40),
    head_sha: '2'.repeat(40),
    tree_sha: '3'.repeat(40),
    status_digest: 'd'.repeat(64),
    clean_worktree: true,
    ref: { detached: false, name: `oracle/${seed}` },
  };
  return {
    authority,
    start,
    readers: {
      readAuthority: async () => ({
        authority,
        later_controlling_comments: [],
        completion_applicability: {
          schema: 'toolkit.github-program.semantic-completion-applicability.v1',
          scope_digest: authority.scope_digest,
          candidate: null,
          required_consumers: [],
          retain_through_child_finality: false,
          retain_through_candidate_finality: false,
        },
      }),
      readStart: async () => start,
    },
  };
}

test('populated v2 receipt APIs remain readable after v4 migration and failed fresh verification gates packet use', async () => {
  const successfulOptions = support.options(support.stateRoot('authority-packet-v2-history-'));
  const successfulInputs = v2ReceiptInputs('historical');
  const successfulLegacy = runtime.createProgrammeReceiptStore(successfulOptions);
  const session = await successfulLegacy.startRun({
    lock: 'historical-lock', authority: successfulInputs.authority, start: successfulInputs.start,
    candidate: null, lease_ms: 60000,
  }, successfulInputs.readers);
  successfulLegacy.interruptRun(session, { payload: { classification: 'RUN_INTERRUPTED' } });
  runtime.migrateAuthorityPacketStore(successfulOptions);
  assert.deepEqual(successfulLegacy.readReceiptChain(session.run_id).map((item) => item.receipt_type), ['RUN_STARTED', 'RUN_INTERRUPTED']);

  const heldOptions = support.options(support.stateRoot('authority-packet-v2-verifier-hold-'));
  const heldInputs = v2ReceiptInputs('verifier-hold');
  const heldLegacy = runtime.createProgrammeReceiptStore(heldOptions);
  const heldSession = await heldLegacy.startRun({
    lock: 'verifier-hold-lock', authority: heldInputs.authority, start: heldInputs.start,
    candidate: null, lease_ms: 60000,
  }, heldInputs.readers);
  heldLegacy.interruptRun(heldSession, { payload: { classification: 'RUN_INTERRUPTED' } });
  failedVerifierCalls = 1;
  assertCode(() => runtime.migrateAuthorityPacketStore(heldOptions), 'GPR_PACKET_READBACK_FAILED');
  failedVerifierCalls = 1;
  const packetValue = packetFixture('post-failed-verifier');
  const readers = support.readers(packetValue);
  assertCode(() => runtime.createAuthorityPacketStore(heldOptions, readers), 'GPR_PACKET_READBACK_FAILED');
  const verified = runtime.createAuthorityPacketStore(heldOptions, readers);
  const persisted = verified.persistAuthorityPacket(packetValue, support.producerAdmission(packetValue));
  assert.equal(persisted.packet_id, runtime.authorityPacketIdentities(packetValue).packet_id);
  assert.deepEqual(heldLegacy.readReceiptChain(heldSession.run_id).map((item) => item.receipt_type), ['RUN_STARTED', 'RUN_INTERRUPTED']);
});

test('migration refuses an unexpired unreleased legacy allocation', async () => {
  const root = support.stateRoot('authority-packet-quiescence-');
  const storeOptions = support.options(root);
  const legacy = runtime.createProgrammeReceiptStore(storeOptions);
  const inputs = v2ReceiptInputs('quiescence');
  await legacy.startRun({
    lock: 'legacy-lock', authority: inputs.authority, start: inputs.start,
    candidate: null, lease_ms: 60000,
  }, inputs.readers);
  assertCode(() => runtime.planAuthorityPacketMigration(storeOptions), 'GPR_PACKET_MIGRATION_NOT_QUIESCENT');
});

test('backfill requires a complete trusted source and records the original producer unchanged', () => {
  const packetValue = packetFixture('backfill');
  const root = support.stateRoot('authority-packet-backfill-');
  const storeOptions = support.options(root);
  const identities = runtime.authorityPacketIdentities(packetValue);
  const readerSet = support.readers(packetValue, {
    readBackfillSource: () => ({
      source_ref: support.sourceReference('historical-source'),
      source_packet: structuredClone(packetValue),
      source_packet_digest: identities.packet_digest,
      source_binding_digest: identities.binding_digest,
      producer_key: identities.producer_key,
      screening: support.screening(packetValue)
    })
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
  const result = store.backfillAuthorityPacket(packetValue);
  assert.equal(result.backfill_duplicate, false);
  assert.equal(result.readback_event_id.length, 64);
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let custodyEvents;
  try {
    custodyEvents = db.prepare(
      'SELECT event_id, sequence, event_type, prior_event_id FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence'
    ).all(result.packet_id);
  } finally { db.close(); }
  assert.deepEqual(custodyEvents.map((event) => event.event_type), ['READBACK_VERIFIED', 'BACKFILL_AUTHORISED']);
  assert.equal(custodyEvents[0].event_id, result.readback_event_id);
  assert.equal(custodyEvents[1].event_id, result.backfill_event_id);
  assert.equal(custodyEvents[1].sequence, custodyEvents[0].sequence + 1);
  assert.equal(custodyEvents[1].prior_event_id, custodyEvents[0].event_id);
  assert.equal(store.readAuthorityPacket(result.packet_id, packetValue.bindings).bindings.producer.run, 'run-backfill');
  const failedStore = runtime.initialiseAuthorityPacketStore(support.options(support.stateRoot('authority-packet-backfill-fail-')), support.readers(packetValue));
  assertCode(() => failedStore.backfillAuthorityPacket(packetValue), 'GPR_PACKET_LEGACY_RERUN_REQUIRED');
});

test('packet boundary failures use the exact typed terminal envelope', () => {
  const envelope = runtime.packetFailureEnvelope({ reason_code: 'GPR_PACKET_NOT_FOUND' });
  assert.deepEqual(envelope, {
    ok: false,
    code: 'TERMINAL_PACKET_DURABILITY_UNVERIFIED',
    reason_code: 'GPR_PACKET_NOT_FOUND',
    accepted: false,
    consumable: false,
    next_gate_admitted: false
  });
});
