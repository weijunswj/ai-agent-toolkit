'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const zlib = require('node:zlib');
const Ajv2020 = require('ajv/dist/2020');

const packetRuntime = require('../scripts/toolkit-github-program-receipt.cjs');
const control = require('../scripts/toolkit-agent-control.cjs');
const setupCore = require('../scripts/setup-toolkit-core.cjs');
const gateCompiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const graphSurface = require('../scripts/toolkit-programme-surface-v1.cjs');
const programmeRuntime = require('../scripts/toolkit-github-program-state-v5.cjs');
const packetSupport = require('./toolkit-authority-packet-test-support.cjs');
const supplementalSupport = require('./toolkit-authority-packet-supplemental-support.cjs');
const resourceTest = require('./toolkit-resource-test-support.cjs');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'authority-packet-reclosure-run093-v1.json');
const SOURCE_PROOF_PATH = path.join(__dirname, 'fixtures', 'controller-kernel', 'programme-421-proof-v1.json');
const SOURCE_SNAPSHOT_PATH = path.join(__dirname, 'fixtures', 'controller-kernel', 'programme-421-source-snapshot-v1.json');
const HISTORICAL_H2_PATH = path.join(__dirname, 'fixtures', 'github-program-human-surface', 'historical-human-v2-j-k-v1.json');
const RUN = 'toolkit-c1-run093-six-finding-integration-g3-20260926-094';
const LOCK = 'DL-C1-RUN093-SIX-FINDING-INTEGRATION-G3-094';
const K = '41a79a0fa2f1d0e73347ee01cfeed429c8373f92';
const M2 = 'b017f39f0fe50697d22c95c1c0e463f53c5a707c';
const REPOSITORY = 'weijunswj/ai-agent-toolkit';
// Preserve the Run-094 fixture; append only Run-095's two authorized paths in-memory.
const RUN095_ADDITIONAL_PATHS = Object.freeze([
  'repo/tests/toolkit-github-governance-review-reconciler.run177-repair.test.cjs',
  'repo/tests/toolkit-github-governance-review-reconciler.run185-adversarial.test.cjs',
]);
const RUN095_MAXIMUM_CHANGED_PATHS = 51;
function sha256Text(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function completeRead(body, revision = null) {
  return { body, complete: true, byte_length: Buffer.byteLength(body, 'utf8'), body_sha256: sha256Text(body), revision };
}
const MAIN_ONLY_PATHS = Object.freeze([
  'repo/contracts/controller-kernel/stack-registry-v2.json',
  'repo/contracts/controller-kernel/stack-registry-v2.schema.json',
  'repo/tests/controller-policy-separation.test.cjs',
]);
const TRAP_NAMES = Object.freeze([
  'get', 'set', 'has', 'deleteProperty', 'defineProperty', 'getOwnPropertyDescriptor', 'ownKeys',
  'getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'preventExtensions', 'apply', 'construct',
]);
const REQUIRED_CASE_IDS = Object.freeze(`
R093-F1-PROXY-ZERO R093-F1-PROXY-THROW R093-F1-PROXY-REVOKED R093-F1-NESTED-HOOK R093-F1-EXPECTED-ENVELOPE-HOOK
R093-F1-NONZERO-HOOK-COMPLETION R093-F1-UNTYPED-EXCEPTION R093-F1-MISSING-OBSERVATION R093-F1-SKIPPED-RECIPE
R093-F1-PERSIST-HOOK R093-F1-CURRENT-HOOK R093-F1-ADMISSION-HOOK
R093-F2-RAW-GRAPH R093-F2-IDENTITY-ENCODER R093-F2-MALFORMED-GRAPH R093-F2-SECRET-PRIVATE-CANARY R093-F2-ALIAS-BYPASS
R093-F3-J-READBACK R093-F3-HISTORICAL-TAMPER R093-F3-CARRIER-TAMPER R093-F3-UNKNOWN-REVISION R093-F3-DOWNGRADE-CURRENT-PROOF
R093-F3-PARENT-SOURCE R093-F3-HISTORY-SOURCE R093-F3-MIGRATION-SOURCE R093-F3-CHILD-SOURCE-DRIFT
R093-F4-SWAP-NATIVE R093-F4-OMIT R093-F4-DUPLICATE R093-F4-WRONG-DEPENDENCY R093-F4-WRONG-COMPLETION
R093-F4-RETIRED-OUTCOME R093-F4-CARRIER-AS-OUTCOME R093-F4-HISTORICAL-SOURCE-SUBSTITUTION
R093-F5-NO-INVOCATION R093-F5-WRONG-INVOCATION R093-F5-WRONG-FIXTURE R093-F5-MISSING-FIXTURE
R093-F5-WRONG-COUNTER R093-F5-EXTRA-FIELD R093-F5-CONFLICTING-ALIASES R093-F5-UNSUPPORTED-ALIAS
R093-F5-EXPLICIT-MALFORMED R093-F5-ACCESSOR-PROXY R093-F5-CALLER-FLAG R093-F5-NESTED-FLAG
R093-F5-GLOBAL R093-F5-ENV R093-F5-PRELOAD R093-F5-DESCENDANT R093-F5-TEST-RESERVATION-REPLAY
R093-F5-PROFILE-BOOLEAN-BYPASS R093-F5-SETUP-SOURCE-BYPASS R093-F5-DIRECT-ADMISSION-BYPASS R093-F5-LAUNCH-BYPASS
R093-F5-QUEUED-EVIDENCE-LOSS R093-F5-TEST-CONTEXT-LOSS R093-F5-SUPERVISOR-CONTEXT-REPLAY
R093-F6-EMPTY-IDENTITY-SPLIT R093-F6-MALFORMED-OPTIONAL R093-F6-NONEMPTY-DATA-LOSS R093-F6-EMPTY-HEADING R093-F6-HISTORICAL-REWRITE
R093-I-MAIN-SEMANTIC-LOSS R093-I-CANDIDATE-SEMANTIC-LOSS R093-I-UNDECLARED-PATH R093-I-PARENT-TOPOLOGY R093-I-VERSION-SPLIT
R093-F1-DELIVERY-HOOK R093-F1-CLEAN-PACKET-POS R093-F2-CANONICAL-GRAPH-POS R093-F2-READBACK-SCREEN-POS
R093-F3-CURRENT-REVISION-POS R093-F3-J-CHILD-READBACK-POS R093-F4-HUMAN-RENDER-POS R093-F4-THIRTY-ROW-READBACK-POS
R093-F5-READ-PROFILE-FIXTURE-BYPASS R093-F5-CHECKER-WORKFLOW-BYPASS R093-F5-NATIVE-COLLECTOR-POS
R093-F6-NONEMPTY-PRESERVED-POS R093-I-PACKAGE-ALIGNMENT-POS
`.trim().split(/\s+/));

const REGISTRATIONS = new WeakMap();
const CASE_RECEIPTS = new WeakMap();
const COMPLETIONS = new WeakMap();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function caseId(item) {
  if (typeof item.requirement_id !== 'string') {
    if (typeof item.id !== 'string') fail('RUN093_CASE_ID_INVALID');
    return item.id;
  }
  const encoded = JSON.parse(item.id);
  if (!Array.isArray(encoded) || encoded.length !== 4 || encoded[1] !== 'EXPLICIT') fail('RUN093_CASE_ID_INVALID');
  return encoded[2];
}

function caseIdentity(item) {
  return [item.requirement_id, item.id, item.input && item.input.variant, item.surface].join('\u0000');
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function validateFixture(ir = loadFixture()) {
  assert.equal(ir.schema, 'toolkit.gate-contract-ir.v1');
  assert.equal(ir.run, RUN);
  assert.equal(ir.lock, LOCK);
  assert.equal(ir.source_stage, 'G2');
  assert.equal(ir.target_stage, 'G3');
  assert.equal(ir.mutation.forbid_extra_paths, true);
  assert.equal(ir.mutation.allow_paths.length, 49);
  assert.equal(new Set(ir.mutation.allow_paths).size, 49);
  const run095Ir = structuredClone(ir);
  run095Ir.mutation.allow_paths.push(...RUN095_ADDITIONAL_PATHS);
  assert.equal(run095Ir.mutation.allow_paths.length, RUN095_MAXIMUM_CHANGED_PATHS);
  assert.equal(new Set(run095Ir.mutation.allow_paths).size, RUN095_MAXIMUM_CHANGED_PATHS);
  const pathManifestCase = run095Ir.requirements
    .find((requirement) => requirement.id === 'R093-INTEGRATION')
    .cases.find((item) => item.id === 'R093-I-UNDECLARED-PATH');
  assert.equal(pathManifestCase.expected.maximum_paths, 49);
  pathManifestCase.input.variant = 'compare-exact-run095-path-manifest';
  pathManifestCase.expected.maximum_paths = RUN095_MAXIMUM_CHANGED_PATHS;
  const declared = ir.requirements.flatMap((requirement) => requirement.cases.map(caseId));
  assert.equal(declared.length, 81);
  assert.equal(new Set(declared).size, 81);
  assert.deepEqual([...declared].sort(), [...REQUIRED_CASE_IDS].sort());
  const compiled = gateCompiler.compileGateContract(run095Ir);
  const generated = compiled.generated_cases.map(caseId);
  assert.deepEqual([...generated].sort(), [...declared].sort());
  return { ir: run095Ir, compiled, declared };
}

function registerCases(items) {
  const plans = new Map();
  for (const [index, item] of items.entries()) {
    const identity = caseIdentity(item);
    if (plans.has(identity)) fail(`RUN093_DUPLICATE_CASE:${caseId(item)}`);
    plans.set(identity, Object.freeze({
      identity,
      id: caseId(item),
      order: index + 1,
      surface: item.surface,
      input: item.input,
      expected: item.expected,
      binding_digest: packetRuntime.digestValue({ identity, surface: item.surface, input: item.input, expected: item.expected }),
    }));
  }
  if (plans.size !== items.length || items.some((item) => !plans.has(caseIdentity(item)))) fail('RUN093_REGISTRATION_INCOMPLETE');
  const token = Object.freeze({});
  REGISTRATIONS.set(token, plans);
  return token;
}

function receiptFor(plan, observation) {
  const token = Object.freeze({});
  CASE_RECEIPTS.set(token, Object.freeze({
    identity: plan.identity,
    case_id: plan.id,
    order: plan.order,
    surface: plan.surface,
    binding_digest: plan.binding_digest,
    observation: Object.freeze(observation),
    executed: true,
  }));
  return token;
}

function completeRun(registration, receipts) {
  const plans = registration && REGISTRATIONS.get(registration);
  if (!plans || !Array.isArray(receipts) || receipts.length !== plans.size) return null;
  const observed = receipts.map((receipt) => CASE_RECEIPTS.get(receipt));
  if (observed.some((receipt) => !receipt || receipt.executed !== true)) return null;
  if (new Set(observed.map((receipt) => receipt.identity)).size !== plans.size) return null;
  const ordered = [...plans.values()];
  if (observed.some((receipt, index) => receipt.identity !== ordered[index].identity
    || receipt.order !== index + 1 || receipt.case_id !== ordered[index].id
    || receipt.binding_digest !== ordered[index].binding_digest)) return null;
  const completion = Object.freeze({});
  COMPLETIONS.set(completion, Object.freeze({
    declared_count: plans.size,
    registered_count: plans.size,
    executed_count: observed.length,
    case_ids: Object.freeze(observed.map((receipt) => receipt.case_id)),
    observations: Object.freeze(observed),
  }));
  return completion;
}

function verifyCompletion(completion) {
  const record = completion && COMPLETIONS.get(completion);
  if (!record || record.declared_count !== REQUIRED_CASE_IDS.length
    || record.registered_count !== REQUIRED_CASE_IDS.length || record.executed_count !== REQUIRED_CASE_IDS.length
    || new Set(record.case_ids).size !== REQUIRED_CASE_IDS.length
    || REQUIRED_CASE_IDS.some((id) => !record.case_ids.includes(id))) return null;
  return record;
}

function assertExpected(plan, observation) {
  for (const [key, value] of Object.entries(plan.expected)) {
    assert.deepEqual(observation[key], value, `${plan.id}:${key}`);
  }
  return observation;
}

function hookCounters() {
  return {
    getters: 0,
    setters: 0,
    toJSON: 0,
    toString: 0,
    valueOf: 0,
    symbolToPrimitive: 0,
    proxy_traps: 0,
    proxy_traps_by_name: Object.fromEntries(TRAP_NAMES.map((name) => [name, 0])),
  };
}

function observedProxy(target, counters, shouldThrow = false) {
  const handler = {};
  for (const name of TRAP_NAMES) {
    handler[name] = (...args) => {
      counters.proxy_traps += 1;
      counters.proxy_traps_by_name[name] += 1;
      if (shouldThrow) throw new Error(`trap:${name}`);
      if (name === 'apply') return Reflect.apply(...args);
      if (name === 'construct') return Reflect.construct(...args);
      return Reflect[name](...args);
    };
  }
  return new Proxy(target, handler);
}

function hooksAreZero(counters) {
  return counters.getters === 0 && counters.setters === 0 && counters.toJSON === 0
    && counters.toString === 0 && counters.valueOf === 0 && counters.symbolToPrimitive === 0
    && counters.proxy_traps === 0 && TRAP_NAMES.every((name) => counters.proxy_traps_by_name[name] === 0);
}

function packetFailure(action, expectedCode = undefined) {
  let error;
  try { action(); } catch (caught) { error = caught; }
  assert.ok(error, 'production boundary rejects the hostile value');
  assert.equal(error.packetBoundary, true, 'the rejection is typed at the production boundary');
  const reasonCode = error.reason_code || error.code;
  if (expectedCode) assert.equal(reasonCode, expectedCode);
  return { outcome: 'REJECT', reason_code: reasonCode };
}

function boundedTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-control-r093-'));
  resourceTest.registerOwnedRoot(root);
  return root;
}

function hostileHookValue(counters) {
  const target = {};
  Object.defineProperty(target, 'value', { enumerable: true, get() { counters.getters += 1; throw new Error('hostile-getter'); } });
  Object.defineProperty(target, 'setter', { enumerable: true, set() { counters.setters += 1; } });
  Object.defineProperty(target, 'toJSON', { enumerable: true, value() { counters.toJSON += 1; throw new Error('hostile-toJSON'); } });
  Object.defineProperty(target, 'toString', { enumerable: true, value() { counters.toString += 1; throw new Error('hostile-toString'); } });
  Object.defineProperty(target, 'valueOf', { enumerable: true, value() { counters.valueOf += 1; throw new Error('hostile-valueOf'); } });
  Object.defineProperty(target, Symbol.toPrimitive, { enumerable: true, value() { counters.symbolToPrimitive += 1; throw new Error('hostile-toPrimitive'); } });
  return target;
}

async function executeSupplementalFailure(variant) {
  const compiled = supplementalSupport.compileSupplementalFixture();
  const registered = supplementalSupport.registerSupplementalCases(compiled);
  const targetId = supplementalSupport.REQUIRED_CASE_IDS[0];
  let expectedCode;
  if (variant === 'increment-one-trap-counter-after-production') expectedCode = /SUPPLEMENTAL_RECIPE_HOOK_EXECUTED/;
  else if (variant === 'throw-untyped-after-awaited-production') expectedCode = /SUPPLEMENTAL_UNTYPED_EXCEPTION/;
  else if (variant === 'skip-one-registered-observation') expectedCode = /SUPPLEMENTAL_CASE_UNEXECUTED/;
  else if (variant === 'missing-or-substituted-private-recipe') {
    const candidates = supplementalSupport.registrationCandidates(compiled);
    candidates[0].clean_seed += '-substituted';
    assert.throws(() => supplementalSupport.registerSupplementalCases(compiled, candidates), /SUPPLEMENTAL_REGISTRATION_SUBSTITUTED/);
    return { outcome: 'NO_COMPLETION', production_call_count: 0 };
  } else fail(`RUN093_UNSUPPORTED_SUPPLEMENTAL_VARIANT:${variant}`);

  let error;
  try {
    await supplementalSupport.executeSupplementalOracle(registered, {
      ...(variant === 'increment-one-trap-counter-after-production' ? { inject_nonzero_hook_case_id: targetId } : {}),
      ...(variant === 'throw-untyped-after-awaited-production' ? { force_untyped_exception_case_id: targetId } : {}),
      ...(variant === 'skip-one-registered-observation'
        ? { skip_case_identity: supplementalSupport.compiledSummary(compiled).identities.at(-1) } : {}),
    });
  } catch (caught) { error = caught; }
  assert.ok(error, 'incomplete or untyped evidence cannot issue completion');
  assert.match(error.message, expectedCode);
  assert.equal(supplementalSupport.verifySupplementalCompletion(null), null);
  return {
    outcome: 'NO_COMPLETION',
    ...(variant === 'increment-one-trap-counter-after-production' ? { positive_control: 'oracle-calibration' } : {}),
    ...(variant === 'skip-one-registered-observation' ? { unexecuted_count: 1 } : {}),
    ...(variant === 'throw-untyped-after-awaited-production' ? { no_typed_error_manufactured: true } : {}),
  };
}

function deliveryFixture(seed) {
  const packet = packetSupport.packet({ seed });
  const storeOptions = packetSupport.options(packetSupport.stateRoot(`run093-${seed}-`));
  const readers = packetSupport.readers(packet);
  const store = packetRuntime.initialiseAuthorityPacketStore(storeOptions, readers);
  const persisted = store.persistAuthorityPacket(packet, packetSupport.producerAdmission(packet));
  const delivery = store.verifyAuthorityPacketFresh(persisted.packet_id, packet.bindings);
  const expected = {
    packet_id: persisted.packet_id,
    expectedBindings: packet.bindings,
    packet,
    store_identity_digest: store.storeIdentityDigest(),
    runtime_identity_digest: delivery.envelope.runtime_identity_digest,
    namespace_digest: packetRuntime.namespaceDigest({ repository: packet.bindings.repository, parent_issue: packet.bindings.parent_issue, child_issue: packet.bindings.child_issue }),
  };
  return { packet, store, delivery, expected };
}

function executePacketProxyCase(variant) {
  const packet = packetSupport.packet({ seed: `run093-${variant}` });
  const counters = hookCounters();
  let result;
  if (variant === 'object-proxy-all-13-traps') {
    result = packetFailure(() => packetRuntime.validateAuthorityPacket(observedProxy(packet, counters)), 'GPR_PACKET_VALUE_INVALID');
  } else if (variant === 'throwing-proxy-all-13-traps') {
    result = packetFailure(() => packetRuntime.validateAuthorityPacket(observedProxy(packet, counters, true)), 'GPR_PACKET_VALUE_INVALID');
  } else if (variant === 'revoked-object-array-function-buffer-proxies') {
    const revocable = Proxy.revocable(packet, observedProxy({}, counters));
    revocable.revoke();
    result = packetFailure(() => packetRuntime.validateAuthorityPacket(revocable.proxy), 'GPR_PACKET_VALUE_INVALID');
  } else if (variant === 'nested-getter-setter-toJSON-toString-valueOf-toPrimitive-and-proxy') {
    const nested = packetSupport.packet({ seed: `run093-${variant}` });
    nested.body.sections[0].text = observedProxy(hostileHookValue(counters), counters);
    result = packetFailure(() => packetRuntime.validateAuthorityPacket(nested), 'GPR_PACKET_VALUE_INVALID');
  } else if (variant === 'hostile-expected-bindings-envelope') {
    const identity = packetRuntime.authorityPacketIdentities(packet);
    const expected = observedProxy({ packet_id: identity.packet_id, bindings: packet.bindings }, counters);
    result = packetFailure(() => packetRuntime.validateAuthorityPacket(packet, expected), 'GPR_PACKET_VALUE_INVALID');
  } else if (variant === 'ordinary-canonical-object-string-utf8-buffer') {
    const objectResult = packetRuntime.validateAuthorityPacket(packet);
    const canonical = packetRuntime.canonicalSerialize(packet);
    const stringResult = packetRuntime.validateAuthorityPacket(canonical);
    const bufferResult = packetRuntime.validateAuthorityPacket(Buffer.from(canonical, 'utf8'));
    assert.deepEqual(objectResult, stringResult);
    assert.deepEqual(objectResult, bufferResult);
    result = { outcome: 'ACCEPT', positive_control: true, side_effects: 'none' };
  } else fail(`RUN093_UNSUPPORTED_PACKET_VARIANT:${variant}`);
  assert.ok(hooksAreZero(counters), `all named proxy and conversion hooks remain zero for ${variant}`);
  return { ...result, hooks: 'ZERO', side_effects: 'none' };
}

function executeDeliveryProxyCase() {
  const { delivery, expected } = deliveryFixture('delivery-proxy');
  const counters = hookCounters();
  const proxyDelivery = observedProxy(delivery, counters);
  const rejectedDelivery = packetFailure(() => packetRuntime.validateAuthorityPacketDelivery(proxyDelivery, expected), 'GPR_PACKET_READBACK_FAILED');
  assert.ok(hooksAreZero(counters));
  const expectedProxy = observedProxy(expected, counters);
  const rejectedExpected = packetFailure(() => packetRuntime.validateAuthorityPacketDelivery(delivery, expectedProxy), 'GPR_PACKET_READBACK_FAILED');
  assert.ok(hooksAreZero(counters));
  return { ...rejectedDelivery, reason_code: rejectedExpected.reason_code, hooks: 'ZERO', side_effects: 'none' };
}

function executePersistenceProxyCase() {
  const packet = packetSupport.packet({ seed: 'run093-persist-hook' });
  const options = packetSupport.options(packetSupport.stateRoot('run093-persist-'));
  const readers = packetSupport.readers(packet);
  const store = packetRuntime.initialiseAuthorityPacketStore(options, readers);
  const admission = packetSupport.producerAdmission(packet);
  const before = packetSupport.receiptEffectSnapshot(store);
  const counters = hookCounters();
  const rejected = packetFailure(() => store.persistAuthorityPacket(observedProxy(packet, counters), admission), 'GPR_PACKET_VALUE_INVALID');
  const after = packetSupport.receiptEffectSnapshot(store);
  assert.deepEqual(after, before, 'hostile persistence input creates no packet or event');
  assert.ok(hooksAreZero(counters));
  return { ...rejected, hooks: 'ZERO', database_delta: 0 };
}

function executeCurrentOrAdmissionProxyCase(surface) {
  const gate = packetSupport.semanticGate(`run093-${surface}-hook`);
  const before = packetSupport.receiptEffectSnapshot(gate.store);
  const counters = hookCounters();
  const hostileIntent = observedProxy(gate.consumer_intent, counters);
  let error;
  let returned;
  try {
    returned = surface === 'buildCurrentPacketProjection'
      ? gate.store.buildCurrentPacketProjection(hostileIntent, gate.trusted_readers)
      : gate.store.admitSemanticGate(hostileIntent, gate.trusted_readers);
  } catch (caught) { error = caught; }
  assert.ok(error || returned, `${surface} observes the hostile intent result`);
  const reasonCode = error ? error.reason_code || error.code : returned.reason_code || returned.code || returned.reason;
  if (error) assert.equal(error.packetBoundary, true);
  assert.ok(hooksAreZero(counters));
  assert.deepEqual(packetSupport.receiptEffectSnapshot(gate.store), before, `${surface} has no database effect`);
  return {
    outcome: 'REJECT',
    reason_code: reasonCode,
    hooks: 'ZERO',
    ...(surface === 'buildCurrentPacketProjection' ? { projection_delta: 0 } : { admission_delta: 0 }),
  };
}

async function executeF1(plan) {
  const variant = plan.input.variant;
  if (plan.surface === 'validateAuthorityPacket') {
    if (['increment-one-trap-counter-after-production', 'throw-untyped-after-awaited-production',
      'skip-one-registered-observation', 'missing-or-substituted-private-recipe'].includes(variant)) {
      return executeSupplementalFailure(variant);
    }
    return executePacketProxyCase(variant);
  }
  if (plan.surface === 'validateAuthorityPacketDelivery') return executeDeliveryProxyCase();
  if (plan.surface === 'persistAuthorityPacket') return executePersistenceProxyCase();
  if (plan.surface === 'buildCurrentPacketProjection' || plan.surface === 'admitSemanticGate') {
    return executeCurrentOrAdmissionProxyCase(plan.surface);
  }
  if (plan.surface === 'supplemental-completion') return executeSupplementalFailure(variant);
  fail(`RUN093_F1_SURFACE_UNMAPPED:${plan.surface}`);
}

function smallGraphState() {
  return {
    active_lanes: [{ child_issue: 1001, gate: 'G3', current_work: 'Verify the approved patch' }],
    children: [
      {
        boundaries: [], done_when: ['The first outcome is complete.'], eli5: 'First step.', epochs: [],
        finality: { state: 'HELD' }, issue: 1001, lifecycle: 'CURRENT', objective: 'Exercise current state.',
        order: 1, out_of_scope: [], pr_registry: [], scope: [], summary: 'Synthetic current outcome.', title: 'Test current',
      },
      {
        boundaries: [], done_when: ['The second outcome follows the first.'], eli5: 'Second step.', epochs: [],
        finality: { state: 'HELD' }, issue: 1002, lifecycle: 'QUEUED', objective: 'Exercise dependency translation.',
        order: 2, out_of_scope: [], pr_registry: [], scope: [], summary: 'Synthetic queued outcome.', title: 'Test queued',
        dependencies: [1001],
      },
    ],
    evidence_refs: [],
    extensions: [{
      schema: graphSurface.METADATA_SCHEMA,
      outcomes: [{ child_issue: 1001, outcome_id: 'C1' }, { child_issue: 1002, outcome_id: 'C2' }],
    }],
    historical_transitions: [],
    parent: { goal: 'Exercise the screened graph boundary.', issue: 999, title: 'Synthetic graph test' },
    prs: [],
    repository: 'example/toolkit',
    schema: 'toolkit.github-program.state.generic.v1',
  };
}

function rewriteCarrier(body, markerIncludes, mutate) {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => line.includes(markerIncludes));
  assert.notEqual(index, -1);
  const line = lines[index];
  const prefixEnd = line.indexOf('human-v2 ') + 'human-v2 '.length;
  const prefix = line.slice(0, prefixEnd);
  const carrier = JSON.parse(Buffer.from(line.slice(prefixEnd, -4), 'base64url').toString('utf8'));
  mutate(carrier);
  lines[index] = prefix + Buffer.from(packetRuntime.canonicalSerialize(carrier), 'utf8').toString('base64url') + ' -->';
  return lines.join('\n');
}

function executeF2(plan) {
  const variant = plan.input.variant;
  const state = smallGraphState();
  if (variant === 'derived-graph-instead-of-canonical-state') {
    const graph = graphSurface.deriveProgrammeGraph(state);
    let error;
    try { graphSurface.renderProgrammeGraph(graph); } catch (caught) { error = caught; }
    assert.ok(error);
    return { outcome: 'REJECT', reason_code: error.code };
  }
  if (variant === 'second-argument-identity-encoder') {
    let calls = 0;
    let error;
    try { graphSurface.renderProgrammeGraph(state, () => { calls += 1; return 'unsafe'; }); } catch (caught) { error = caught; }
    assert.ok(error);
    return { outcome: 'REJECT', reason_code: error.code, encoder_calls: calls };
  }
  if (variant === 'invalid-or-incomplete-graph-metadata') {
    state.extensions = [];
    const result = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    return { outcome: result.ok ? 'ACCEPT' : 'REJECT', reason_code: result.code };
  }
  if (variant === 'synthetic-secret-private-path-canary') {
    state.children[0].summary = 'password=SYNTHETIC-NOT-A-SECRET';
    const result = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    return { outcome: result.ok ? 'ACCEPT' : 'REJECT', reason_code: result.code, provider_mutation_authorised: result.provider_mutation_authorised };
  }
  if (variant === 'enumerate-renderer-aliases-and-raw-assemblers') {
    const forbidden = ['renderProgrammeParent', 'programmeSurface', 'h2ParentProse', 'h2BuildParentDoc', 'h2ManagedDocument'];
    const noBypass = forbidden.every((name) => !Object.hasOwn(programmeRuntime, name) && !Object.hasOwn(graphSurface, name))
      && !Object.hasOwn(programmeRuntime, 'renderProgrammeGraph')
      && !Object.hasOwn(programmeRuntime.programmeV5, 'currentProjection')
      && Object.keys(programmeRuntime.humanSurfaceV2).sort().join(',') === 'extendHistory,planMigration,readComplete,render';
    assert.equal(noBypass, true);
    return { outcome: 'NO_BYPASS', raw_assembler_exported: false };
  }
  if (variant === 'valid-canonical-five-column-graph') {
    const lines = graphSurface.renderProgrammeGraph(state);
    assert.equal(lines[2], '| Outcome | Status | Current gate | Current work | Complete when |');
    assert.equal(lines.filter((line) => line.startsWith('| C')).length, 2);
    return { outcome: 'ACCEPT', positive_control: true, columns: ['Outcome', 'Status', 'Current gate', 'Current work', 'Complete when'] };
  }
  if (variant === 'read-rendered-canonical-graph-through-screened-boundary') {
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    assert.equal(rendered.ok, true, JSON.stringify(rendered));
    const readback = programmeRuntime.humanSurfaceV2.readComplete({
      read: rendered.read,
      expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
    });
    assert.equal(readback.ok, true, JSON.stringify(readback));
    assert.deepEqual(readback.programme_graph, rendered.programme_graph);
    return { outcome: 'READ_COMPLETE', positive_control: true, graph_identity_bound: true };
  }
  fail(`RUN093_F2_VARIANT_UNMAPPED:${variant}`);
}

function historicalBodies() {
  const fixture = JSON.parse(fs.readFileSync(HISTORICAL_H2_PATH, 'utf8'));
  const decode = (record) => {
    const bytes = zlib.gunzipSync(Buffer.from(record.body_gzip_base64_chunks.join(''), 'base64'));
    assert.equal(bytes.length, record.body_bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.body_sha256);
    return bytes.toString('utf8');
  };
  return {
    fixture,
    j: decode(fixture.j_graphless),
    k: decode(fixture.k_graphful),
    child: decode(fixture.j_historical_child),
    pr: decode(fixture.j_pr_pre_number),
  };
}

function executeF3(plan) {
  const variant = plan.input.variant;
  const { fixture, j, k, child } = historicalBodies();
  if (variant === 'frozen-J-parent-bytes') {
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: j, complete: true, byte_length: Buffer.byteLength(j, 'utf8'), body_sha256: sha256Text(j), revision: null },
      expect: { kind: 'parent', repository: 'weijunswj/ai-agent-toolkit', issue: 240 },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.historical_read_only, true);
    assert.equal(Object.hasOwn(result, 'programme_graph'), false);
    return { outcome: 'READ_COMPLETE', historical_revision: 'J', historical_read_only: true };
  }
  if (variant === 'mutate-J-bytes-and-recompute-read-digest') {
    const changed = j.replace('## ELI5\n', '## ELI5\nTampered.\n');
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: changed, complete: true, byte_length: Buffer.byteLength(changed, 'utf8'), body_sha256: sha256Text(changed), revision: null },
      expect: { kind: 'parent', repository: 'weijunswj/ai-agent-toolkit', issue: 240 },
    });
    assert.equal(result.ok, false);
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'mutate-J-carrier-and-recompute-read-digest') {
    const changed = rewriteCarrier(j, 'PARENT-CARRIER human-v2 ', (carrier) => { carrier.canonical.digest = 'a'.repeat(64); });
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: changed, complete: true, byte_length: Buffer.byteLength(changed, 'utf8'), body_sha256: sha256Text(changed), revision: null },
      expect: { kind: 'parent', repository: 'weijunswj/ai-agent-toolkit', issue: 240 },
    });
    assert.equal(result.ok, false);
    return { outcome: 'REJECT' };
  }
  if (variant === 'unknown-human-v2-renderer-revision') {
    const state = smallGraphState();
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    const changed = rewriteCarrier(rendered.body, 'PARENT-CARRIER human-v2 ', (carrier) => { carrier.renderer_revision = 'human-v2-r999'; });
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: changed, complete: true, byte_length: Buffer.byteLength(changed, 'utf8'), body_sha256: sha256Text(changed), revision: null },
      expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
    });
    assert.equal(result.code, 'CARRIER_INVALID');
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'remove-current-revision-from-current-graphful-document') {
    const state = smallGraphState();
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    const changed = rewriteCarrier(rendered.body, 'PARENT-CARRIER human-v2 ', (carrier) => { delete carrier.renderer_revision; });
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: changed, complete: true, byte_length: Buffer.byteLength(changed, 'utf8'), body_sha256: sha256Text(changed), revision: null },
      expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
    });
    assert.equal(result.code, 'READBACK_MISMATCH');
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'J-parent-read-cannot-create-unproven-current-graph') {
    const result = programmeRuntime.humanSurfaceV2.render({ source: { type: 'PARENT_READ', parent_read: completeRead(j) }, target: { kind: 'parent' } });
    assert.equal(result.code, 'PROGRAMME_GRAPH_METADATA_REQUIRED');
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'J-graphless-source-history-extension') {
    const result = programmeRuntime.humanSurfaceV2.extendHistory({ parent_read: completeRead(j), decision: {}, provider_observations: null });
    assert.equal(result.code, 'PROGRAMME_GRAPH_METADATA_REQUIRED');
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'J-graphless-source-migration') {
    const result = programmeRuntime.humanSurfaceV2.planMigration({
      parent_read: completeRead(j), child_read: completeRead(programmeRuntime.FINALISATION_RENDERED_TARGETS.stage_b.child),
      history_decision: null, provider_observations: null,
    });
    assert.equal(result.code, 'PROGRAMME_GRAPH_METADATA_REQUIRED');
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'J-child-readback-bound-to-exact-J-parent') {
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: child, complete: true, byte_length: Buffer.byteLength(child, 'utf8'), body_sha256: sha256Text(child), revision: null },
      expect: { kind: 'child', repository: 'weijunswj/ai-agent-toolkit', issue: 359, parent_issue: 240, parent_read: completeRead(j) },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.historical_read_only, true);
    return { outcome: 'READ_COMPLETE', positive_control: true, historical_read_only: true };
  }
  if (variant === 'J-child-bound-to-different-accepted-parent') {
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: { body: child, complete: true, byte_length: Buffer.byteLength(child, 'utf8'), body_sha256: sha256Text(child), revision: null },
      expect: { kind: 'child', repository: 'weijunswj/ai-agent-toolkit', issue: 359, parent_issue: 240,
        parent_read: completeRead(programmeRuntime.FINALISATION_RENDERED_TARGETS.stage_a.parent) },
    });
    assert.equal(result.code, 'CHILD_SOURCE_MISMATCH');
    return { outcome: 'REJECT', reason_code: result.code };
  }
  if (variant === 'new-human-v2-r093-document-with-graph-proof') {
    const state = smallGraphState();
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    const result = programmeRuntime.humanSurfaceV2.readComplete({
      read: rendered.read,
      expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.renderer_revision, 'human-v2-r093');
    return { outcome: 'READ_COMPLETE', positive_control: true, renderer_revision: result.renderer_revision };
  }
  fail(`RUN093_F3_VARIANT_UNMAPPED:${variant}:${fixture.schema}`);
}

function proofData() {
  const proof = JSON.parse(fs.readFileSync(SOURCE_PROOF_PATH, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(SOURCE_SNAPSHOT_PATH, 'utf8'));
  assert.equal(snapshot.schema, 'toolkit.controller.programme-graph-source-snapshot.v1');
  assert.equal(snapshot.immutable, true);
  const bytes = zlib.gunzipSync(Buffer.from(snapshot.source.body_gzip_base64_chunks.join(''), 'base64'));
  assert.equal(bytes.length, proof.parent.body_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.parent.body_sha256);
  const body = bytes.toString('utf8');
  const start = body.indexOf('## Programme Graph\n');
  const end = body.indexOf('## Programme requirements', start);
  assert.ok(start >= 0 && end > start);
  const section = body.slice(start, end);
  assert.equal(Buffer.byteLength(section, 'utf8'), proof.parent.programme_graph_section_bytes);
  assert.equal(crypto.createHash('sha256').update(section, 'utf8').digest('hex'), proof.parent.programme_graph_section_sha256);
  const values = proof.expected_rows.map((row) => Object.fromEntries(proof.row_fields.map((field, index) => [field, row[index]])));
  const lines = section.split('\n').filter((line) => line.startsWith('|'));
  const sourceRows = lines.slice(2).map((line, index) => {
    const cells = [];
    let cell = '';
    for (let offset = 1; offset < line.length - 1; offset += 1) {
      if (line[offset] === '\\' && offset + 1 < line.length - 1) {
        cell += line[offset] + line[offset + 1];
        offset += 1;
      } else if (line[offset] === '|') { cells.push(cell.trim()); cell = ''; }
      else cell += line[offset];
    }
    cells.push(cell.trim());
    const decode = (value) => value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    const decoded = cells.map(decode);
    const outcome = decoded[0].match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?):/);
    const issue = decoded[3].match(/#(\d+)/);
    assert.ok(outcome && issue && decoded.length === 5, `source graph row ${index + 1}`);
    const sourceStatus = decoded[1];
    return {
      outcome_id: outcome[1],
      child_issue: Number(issue[1]),
      order: index + 1,
      source_status: sourceStatus,
      lifecycle: sourceStatus.startsWith('CURRENT') ? 'CURRENT' : sourceStatus.startsWith('COMPLETED') ? 'COMPLETED' : 'QUEUED',
      source_current_gate: decoded[2],
      current_gate: decoded[2] === '—' ? null : decoded[2],
      current_work: decoded[3],
      complete_when_text: decoded[4],
    };
  });
  assert.equal(sourceRows.length, 30);
  const sourceFields = ['outcome_id', 'child_issue', 'order', 'source_status', 'lifecycle', 'source_current_gate', 'current_gate', 'current_work', 'complete_when_text'];
  assert.deepEqual(sourceRows, values.map((row) => Object.fromEntries(sourceFields.map((field) => [field, row[field]]))));
  assert.deepEqual(values.map((row) => row.outcome_id), proof.current_outcome_ids);
  assert.deepEqual(values.map((row) => row.order), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(proof.live_fetch_during_tests, false);
  return { proof, snapshot, body, rows: values };
}

function sourceProofState(proof, rows = proof.expected_rows.map((row) => Object.fromEntries(proof.row_fields.map((field, index) => [field, row[index]])))) {
  const issueByOutcome = new Map(rows.map((row) => [row.outcome_id, row.child_issue]));
  const candidate = {
    repository: 'weijunswj/ai-agent-toolkit', branch: 'c1/compiled-contract-human-routing-056', base_ref: 'main',
    base_sha: 'a'.repeat(40), head: 'b'.repeat(40), tree: 'c'.repeat(40), version: '2.10.10',
  };
  const children = rows.map((row) => {
    const pr = proof.delivery_pr_by_outcome[row.outcome_id] || null;
    return {
      boundaries: [], done_when: [row.complete_when_text], eli5: `Source-backed ${row.outcome_id} outcome.`, epochs: [],
      finality: { state: row.lifecycle === 'CURRENT' ? 'UNMERGED' : 'HELD' }, issue: row.child_issue,
      lifecycle: row.lifecycle, objective: row.complete_when_text, order: row.order, out_of_scope: [],
      pr_registry: pr === null ? [] : [{ accepted_evidence_ref: null, candidate, completes_child: false, draft: true,
        epoch_id: 'G3', github_state: 'OPEN', merged: false, pr, retirement_evidence_ref: null,
        retention_evidence_ref: null, role: 'INTERMEDIATE', status: 'ACTIVE' }],
      scope: [], summary: row.current_work, title: `${row.outcome_id}: source-bound outcome`,
      ...(row.dependencies.length ? { dependencies: row.dependencies.map((id) => issueByOutcome.get(id)) } : {}),
    };
  });
  const metadata = rows.map((row) => ({
    child_issue: row.child_issue, outcome_id: row.outcome_id,
    ...(row.current_gate === null ? {} : { current_gate: row.current_gate }),
    current_work: row.current_work,
    ...(proof.planning_metadata[row.outcome_id] || {}),
    ...(proof.shared_reference_outcomes.includes(row.outcome_id)
      ? { reference_issue_pointers: [{ repository: 'weijunswj/ai-agent-toolkit', issue: 467 }] } : {}),
  }));
  return {
    active_lanes: [], children, evidence_refs: [],
    extensions: [{ schema: graphSurface.METADATA_SCHEMA, outcomes: metadata }],
    historical_transitions: [],
    parent: { goal: 'Prove the frozen source-to-canonical programme graph mapping.', issue: 421, title: 'Toolkit programme source proof' },
    prs: [{ changed_surfaces: [], child_issue: issueByOutcome.get('C1'), design_constraints: [],
      eli5: 'The source-backed C1 delivery PR is historical graph evidence.', evidence_refs: [], number: proof.delivery_pr_by_outcome.C1,
      out_of_scope: [], purpose: 'Bind the known C1 delivery PR for the source proof.', scope: [],
      summary: 'C1 delivery PR source binding.', validation_requirements: [], candidate: null,
      repository: 'weijunswj/ai-agent-toolkit', schema: 'github.program.pr-descriptor.v2' }],
    repository: 'weijunswj/ai-agent-toolkit', schema: 'toolkit.github-program.state.generic.v1',
  };
}

function expectedSourceGraph(proof, rows = proof.expected_rows.map((row) => Object.fromEntries(proof.row_fields.map((field, index) => [field, row[index]])))) {
  return rows.map((row) => ({
    outcome_id: row.outcome_id, order: row.order, status: row.lifecycle, dependencies: row.dependencies,
    native_issue: { repository: 'weijunswj/ai-agent-toolkit', number: row.child_issue },
    delivery_pr: proof.delivery_pr_by_outcome[row.outcome_id]
      ? { repository: 'weijunswj/ai-agent-toolkit', number: proof.delivery_pr_by_outcome[row.outcome_id] } : null,
    current_gate: row.current_gate, current_work: row.current_work, complete_when: [row.complete_when_text],
    ...(proof.planning_metadata[row.outcome_id] || {}),
    ...(proof.shared_reference_outcomes.includes(row.outcome_id)
      ? { reference_issue_pointers: [{ repository: 'weijunswj/ai-agent-toolkit', issue: 467 }] } : {}),
  }));
}

function executeF4(plan) {
  const variant = plan.input.variant;
  const { proof, snapshot, rows } = proofData();
  if (variant === 'swap-C2-C3-native-issue-assignments-and-recompute-digest') {
    const swapped = sourceProofState(proof);
    const c2 = swapped.extensions[0].outcomes.find((row) => row.outcome_id === 'C2');
    const c3 = swapped.extensions[0].outcomes.find((row) => row.outcome_id === 'C3');
    [c2.child_issue, c3.child_issue] = [c3.child_issue, c2.child_issue];
    assert.notDeepEqual(graphSurface.deriveProgrammeGraph(swapped).outcomes, expectedSourceGraph(proof));
    return { outcome: 'SOURCE_MAPPING_MISMATCH' };
  }
  if (variant === 'omit-one-source-outcome') {
    const state = sourceProofState(proof); state.extensions[0].outcomes.pop();
    assert.throws(() => graphSurface.deriveProgrammeGraph(state), (error) => error.code === 'PROGRAMME_GRAPH_CHILD_MAPPING_MISSING');
    return { outcome: 'REJECT', reason_code: 'PROGRAMME_GRAPH_CHILD_MAPPING_MISSING' };
  }
  if (variant === 'duplicate-one-source-outcome') {
    const state = sourceProofState(proof); state.extensions[0].outcomes.push(structuredClone(state.extensions[0].outcomes[0]));
    assert.throws(() => graphSurface.deriveProgrammeGraph(state), (error) => error.code === 'PROGRAMME_GRAPH_METADATA_INVALID');
    return { outcome: 'REJECT', reason_code: 'PROGRAMME_GRAPH_METADATA_INVALID' };
  }
  if (variant === 'wrong-C2-dependency-with-recomputed-digest') {
    const state = sourceProofState(proof); state.children.find((child) => child.issue === 423).dependencies = [435];
    assert.notDeepEqual(graphSurface.deriveProgrammeGraph(state).outcomes, expectedSourceGraph(proof));
    return { outcome: 'SOURCE_MAPPING_MISMATCH' };
  }
  if (variant === 'wrong-C2-completion-with-recomputed-digest') {
    const state = sourceProofState(proof); state.children.find((child) => child.issue === 423).done_when = ['A different source completion condition.'];
    assert.notDeepEqual(graphSurface.deriveProgrammeGraph(state).outcomes, expectedSourceGraph(proof));
    return { outcome: 'SOURCE_MAPPING_MISMATCH' };
  }
  if (variant === 'insert-retired-A2-outcome') {
    const state = sourceProofState(proof); state.extensions[0].outcomes.find((row) => row.outcome_id === 'C3').outcome_id = 'A2';
    assert.throws(() => graphSurface.deriveProgrammeGraph(state), (error) => error.code === 'PROGRAMME_GRAPH_OUTCOME_FORBIDDEN');
    return { outcome: 'REJECT', reason_code: 'PROGRAMME_GRAPH_OUTCOME_FORBIDDEN' };
  }
  if (variant === 'promote-reference-only-467-to-child') {
    const state = sourceProofState(proof);
    state.children.push({ issue: 467, order: 31, lifecycle: 'QUEUED', done_when: ['Not an outcome.'] });
    state.extensions[0].outcomes.push({ child_issue: 467, outcome_id: 'H3-REFERENCE' });
    assert.throws(() => graphSurface.deriveProgrammeGraph(state), (error) => error.code === 'PROGRAMME_GRAPH_REFERENCE_ONLY_ISSUE_IN_MEMBERSHIP');
    return { outcome: 'REJECT', reason_code: 'PROGRAMME_GRAPH_REFERENCE_ONLY_ISSUE_IN_MEMBERSHIP' };
  }
  if (variant === 'change-source-bytes-and-recompute-all-digests') {
    const changed = structuredClone(snapshot);
    const body = zlib.gunzipSync(Buffer.from(changed.source.body_gzip_base64_chunks.join(''), 'base64')).toString('utf8')
      .replace('C1: Controller Kernel + Delivery Contract', 'X1: Controller Kernel + Delivery Contract');
    const bytes = Buffer.from(body, 'utf8');
    changed.source.body_bytes = bytes.length;
    changed.source.body_sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const start = body.indexOf('## Programme Graph\n'), end = body.indexOf('## Programme requirements', start);
    const section = body.slice(start, end);
    changed.source.programme_graph_section_bytes = Buffer.byteLength(section, 'utf8');
    changed.source.programme_graph_section_sha256 = crypto.createHash('sha256').update(section, 'utf8').digest('hex');
    const gzip = zlib.gzipSync(bytes, { level: 9, mtime: 0 }).toString('base64');
    changed.source.body_gzip_base64_chunks = Array.from({ length: Math.ceil(gzip.length / 500) }, (_, index) => gzip.slice(index * 500, (index + 1) * 500));
    assert.notEqual(changed.source.body_sha256, proof.parent.body_sha256);
    return { outcome: 'REJECT', reason: 'immutable external source binding mismatch' };
  }
  if (variant === 'full-bound-snapshot-30-row-graph') {
    const state = sourceProofState(proof);
    const expected = expectedSourceGraph(proof, rows);
    const graph = graphSurface.deriveProgrammeGraph(state);
    assert.deepEqual(graph.outcomes, expected);
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    assert.equal(rendered.ok, true, JSON.stringify(rendered));
    assert.equal(rendered.programme_graph.digest, graph.digest);
    const readback = programmeRuntime.humanSurfaceV2.readComplete({
      read: rendered.read,
      expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
    });
    assert.equal(readback.ok, true, JSON.stringify(readback));
    assert.deepEqual(graphSurface.deriveProgrammeGraph(readback.canonical_state).outcomes, expected);
    return { outcome: plan.surface === 'humanSurfaceV2.render' ? 'RENDER_READY' : 'READ_COMPLETE', positive_control: true, outcome_count: 30 };
  }
  fail(`RUN093_F4_VARIANT_UNMAPPED:${variant}`);
}

function resourceSpec(overrides = {}) {
  return {
    child_responsibility: 'Implement the isolated resource test shard and focused regressions.',
    parent_responsibility: 'Review and integrate the independently completed resource shard.',
    integration_plan: 'The parent owns interface reconciliation and final validation.',
    validation_plan: 'Run focused regressions and inspect the integrated diff.',
    material_benefit: 'A bounded test shard can execute independently while integration proceeds.',
    tasks_separable: true,
    concurrent_execution_possible: true,
    expected_wall_clock_speedup: 'The focused resource check can run alongside integration.',
    root_retains_longest_or_critical_path: true,
    child_task_is_shorter_or_easier: true,
    root_productive_work_declared: true,
    child_prompt: 'Implement the isolated resource shard only.',
    ...overrides,
  };
}

function resourceProfile() {
  return { capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST };
}

function resourceContext(root, callback) {
  return control.withRepositoryTestResourceInvocation(resourceTest.INVOCATION, root, callback);
}

function deniedResourceResult(result, root) {
  assert.equal(result.result, control.RESULTS.REFUSE);
  assert.equal(fs.existsSync(control.statePath({ root })), false);
  assert.equal(fs.existsSync(control.lockPath({ root })), false);
  assert.equal(fs.existsSync(path.join(root, 'jobs')), false);
  return { outcome: 'REFUSE', effects: 'zero' };
}

function executeF5(plan) {
  const variant = plan.input.variant;
  const fixture = resourceTest.FIXTURE;
  const invocation = resourceTest.INVOCATION;
  if (variant === 'platform-native-production-collector-no-fixture-context') {
    const state = control.inspectResources();
    if (!['linux', 'win32'].includes(process.platform)) return { outcome: 'HOLD', platform_gate: 'linux-or-windows' };
    assert.ok(state);
    const expectedSource = process.platform === 'linux' ? 'proc-meminfo' : 'win32-operating-system';
    assert.equal(state.source, expectedSource);
    assert.equal(state.host_responsive, true);
    assert.equal(Object.hasOwn(state, 'fixture_id'), false);
    for (const key of ['physical_total', 'physical_available', 'commit_total', 'commit_available']) assert.ok(Number.isSafeInteger(state[key]) && state[key] > 0);
    assert.ok(state.physical_available <= state.physical_total);
    assert.ok(state.commit_available <= state.commit_total);
    return { outcome: 'ACCEPT', positive_control: true, platform_gate: 'linux-or-windows' };
  }

  const root = boundedTempRoot();
  const noContext = (options) => control.inspectResources(options);
  if (variant === 'fixture-without-private-invocation') {
    assert.equal(noContext({ resourceState: fixture }), null);
    return deniedResourceResult(control.resourceAdmissionDecision(resourceSpec(), resourceProfile(), fixture, { root }), root);
  }
  if (variant === 'wrong-invocation-id-or-fixture-id') {
    const wrong = { ...invocation, fixture_id: 'wrong-fixture' };
    const result = resourceContext(root, () => noContext({ root, repository_test_invocation: wrong, resourceState: fixture }));
    assert.equal(result, null);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'wrong-fixture-identity') {
    const wrong = { ...fixture, fixture_id: 'wrong-fixture' };
    const result = resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, resourceState: wrong }));
    assert.equal(result, null);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'explicit-null-or-absent-fixture-in-test-context') {
    const result = resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, resourceState: null }));
    assert.equal(result, null);
    return { outcome: 'REFUSE_OR_NATIVE_ONLY', fixture_supported: false };
  }
  if (variant === 'invalid-or-contradictory-counter') {
    const invalid = control.inspectResourceCapability({
      root, repository_test_invocation: invocation,
      resourceState: { ...fixture, physical_available: fixture.physical_total + 1 },
    });
    assert.equal(invalid.supported, false);
    return { outcome: 'UNSUPPORTED', effects: 'zero' };
  }
  if (variant === 'fixture-with-extra-field') {
    assert.equal(resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, resourceState: { ...fixture, extra: true } })), null);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'both-spellings-even-equal') {
    assert.equal(resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, repositoryTestInvocation: invocation, resourceState: fixture })), null);
    assert.equal(resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, resourceState: fixture, resource_state: fixture })), null);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'resource-or-resources-alias') {
    assert.equal(resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, resource: fixture })), null);
    assert.equal(resourceContext(root, () => noContext({ root, repository_test_invocation: invocation, resources: fixture })), null);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'null-undefined-array-or-malformed-explicit-evidence') {
    for (const value of [null, undefined, [], { ...fixture, source: 'proc-meminfo' }]) assert.equal(noContext({ resourceState: value }), null);
    return { outcome: 'REFUSE', ambient_fallback: false };
  }
  if (variant === 'accessor-or-proxy-option-or-evidence') {
    let accessorCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'resourceState', { enumerable: true, get() { accessorCalls += 1; return fixture; } });
    assert.equal(noContext(accessor), null);
    const counters = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
    const proxy = new Proxy({ resourceState: fixture }, {
      get(target, key, receiver) { counters.get += 1; return Reflect.get(target, key, receiver); },
      ownKeys(target) { counters.ownKeys += 1; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) { counters.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
      getPrototypeOf(target) { counters.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
    });
    assert.equal(noContext(proxy), null);
    assert.equal(accessorCalls, 0);
    assert.deepEqual(counters, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
    return { outcome: 'REFUSE', hooks: 'ZERO' };
  }
  if (variant === 'caller-supported-or-source-boolean') {
    assert.equal(noContext({ resourceState: fixture, resource_counter_supported: true, resource_counter_source: 'proc-meminfo' }), null);
    return { outcome: 'UNSUPPORTED', effects: 'zero' };
  }
  if (variant === 'nested-fixture-marker') {
    assert.equal(noContext({ resourceState: { ...fixture, nested: { repository_test_invocation: invocation } } }), null);
    return { outcome: 'UNSUPPORTED', effects: 'zero' };
  }
  if (variant === 'mutable-global-marker' || variant === 'environment-marker') {
    const previousGlobal = globalThis.__toolkitRepositoryTestResource;
    const previousEnv = process.env.TOOLKIT_REPOSITORY_TEST_RESOURCE;
    globalThis.__toolkitRepositoryTestResource = invocation;
    process.env.TOOLKIT_REPOSITORY_TEST_RESOURCE = JSON.stringify(invocation);
    try { assert.equal(noContext({ resourceState: fixture }), null); }
    finally {
      if (previousGlobal === undefined) delete globalThis.__toolkitRepositoryTestResource;
      else globalThis.__toolkitRepositoryTestResource = previousGlobal;
      if (previousEnv === undefined) delete process.env.TOOLKIT_REPOSITORY_TEST_RESOURCE;
      else process.env.TOOLKIT_REPOSITORY_TEST_RESOURCE = previousEnv;
    }
    return { outcome: 'UNSUPPORTED', effects: 'zero' };
  }
  if (variant === 'NODE_OPTIONS-preload-or-import-marker') {
    const preload = path.join(root, 'resource-preload.cjs');
    fs.writeFileSync(preload, `globalThis.__toolkitRepositoryTestResource=true;process.env.TOOLKIT_REPOSITORY_TEST_RESOURCE=${JSON.stringify(JSON.stringify(invocation))};`);
    const controlPath = path.resolve(__dirname, '../scripts/toolkit-agent-control.cjs');
    const script = `const c=require(${JSON.stringify(controlPath)});const f=${JSON.stringify(fixture)};const p=${JSON.stringify(resourceProfile())};const s=${JSON.stringify(resourceSpec())};console.log(c.resourceAdmissionDecision(s,p,f,{root:${JSON.stringify(root)}}).result)`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: packetSupport.repositoryRoot,
      env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, NODE_PATH: '' },
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), control.RESULTS.REFUSE);
    assert.equal(fs.existsSync(control.statePath({ root })), false);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'descendant-receives-fixture-bytes-only') {
    const controlPath = path.resolve(__dirname, '../scripts/toolkit-agent-control.cjs');
    const script = `const c=require(${JSON.stringify(controlPath)});const f=${JSON.stringify(fixture)};const p=${JSON.stringify(resourceProfile())};const s=${JSON.stringify(resourceSpec())};console.log(c.resourceAdmissionDecision(s,p,f,{root:${JSON.stringify(root)}}).result)`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: packetSupport.repositoryRoot, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), control.RESULTS.REFUSE);
    assert.equal(fs.existsSync(control.statePath({ root })), false);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'test-reservation-replayed-as-production-proof' || variant === 'queued-retry-reestablishes-resource-provenance'
    || variant === 'child-context-does-not-survive-serialization') {
    const selectedProfile = resourceProfile();
    const selectedSpec = resourceSpec({
      ...(variant === 'queued-retry-reestablishes-resource-provenance' ? { estimated_memory_bytes: 16 * control.GIB } : {}),
    });
    const inputOptions = { root, repository_test_invocation: invocation, resourceState: fixture };
    const first = resourceContext(root, () => control.resourceAdmissionDecision(selectedSpec, selectedProfile, fixture, inputOptions));
    if (variant === 'test-reservation-replayed-as-production-proof') assert.ok([control.RESULTS.START, control.RESULTS.QUEUE].includes(first.result));
    if (variant === 'queued-retry-reestablishes-resource-provenance') assert.equal(first.result, control.RESULTS.QUEUE);
    if (variant === 'child-context-does-not-survive-serialization') assert.ok([control.RESULTS.START, control.RESULTS.QUEUE].includes(first.result));
    const before = fs.readFileSync(control.statePath({ root }));
    const second = control.resourceAdmissionDecision(selectedSpec, selectedProfile, fixture, inputOptions);
    assert.equal(second.result, control.RESULTS.REFUSE);
    assert.deepEqual(fs.readFileSync(control.statePath({ root })), before);
    return { outcome: 'REFUSE', effects: 'zero', fixture_authority_replayed: false };
  }
  if (variant === 'caller-counter-booleans-without-native-proof') {
    const target = control.profilePath('claude-code', { root });
    const selected = {
      topology: control.TOPOLOGIES.CLAUDE_DIRECT, capacity_mode: control.CAPACITY_MODES.AUTO,
      enforcement_verified: true, claude_cli: process.execPath,
      activation_proof: { schema: 3, source: 'claude-plugin-list', plugin_version: control.CONTROL_VERSION,
        cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64),
        process_launch_sha256: 'e'.repeat(64), agent_hook_sha256: 'd'.repeat(64) },
      resource_counter_supported: true, resource_counter_verified: true, resource_counter_source: 'proc-meminfo',
      resourceState: fixture,
    };
    assert.throws(() => control.configureProfile('claude-code', selected, { root }), /Caller-provided resource evidence/);
    assert.equal(fs.existsSync(target), false);
    return { outcome: 'REFUSE', profile_write: false };
  }
  if (variant === 'repository-test-state-cannot-become-production-profile-proof') {
    const profilePath = control.profilePath('claude-code', { root });
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    const stored = {
      schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
      capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
      queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
      controller_version: control.CONTROL_VERSION, enforcement_verified: true, enforcement: 'toolkit-launch-boundary',
      activation_proof: { schema: 3, source: 'claude-plugin-list', plugin_version: control.CONTROL_VERSION,
        cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64),
        process_launch_sha256: 'e'.repeat(64), agent_hook_sha256: 'd'.repeat(64) },
      claude_cli: process.execPath, resource_counter_verified: true, resource_counter_source: fixture.source,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(profilePath, `${JSON.stringify(stored)}\n`);
    const loaded = control.readProfile('claude-code', { root });
    assert.equal(loaded.supported, false);
    assert.equal(loaded.topology, control.TOPOLOGIES.ROOT_ONLY);
    return { outcome: 'UNSUPPORTED', production_supported: false };
  }
  if (variant === 'fixture-reservation-cannot-create-checker-worker') {
    const input = {
      implementation_complete: true, focused_validation_passed: true, diff_ready: true,
      changed_files: ['repo/scripts/toolkit-agent-control.cjs'], change_kind: 'material-code-change',
      task_contract: 'Review the source-backed resource boundary.', diff: '+bounded test-only diff',
      focused_validation: 'Focused local validation passed.', surrounding_invariants: 'No launch without production resource proof.',
    };
    const result = resourceContext(root, () => control.checkerWorkflow(input, { root }));
    assert.equal(result.status, control.CHECKER_RESULTS.ADMISSION_DENIED);
    assert.equal(fs.existsSync(control.statePath({ root })), false);
    assert.equal(fs.existsSync(path.join(root, 'jobs')), false);
    return { outcome: 'REFUSE', effects: 'zero' };
  }
  if (variant === 'fixture-source-reaches-production-profile-setup') {
    const env = { ...process.env, TOOLKIT_REPOSITORY_TEST_RESOURCE: JSON.stringify(invocation) };
    const inspected = setupCore.inspectClaudeAgentCapability({ claudeCli: process.execPath, env, resourceState: fixture, repository_test_invocation: invocation });
    assert.equal(['proc-meminfo', 'win32-operating-system'].includes(inspected.resource_counter_source), true);
    assert.notEqual(inspected.resource_counter_source, fixture.source);
    return { outcome: 'NOT_FIXTURE_AUTHORITY', effects: 'zero' };
  }
  if (variant === 'direct-numerical-evidence-without-test-context') {
    const result = control.resourceAdmissionDecision(resourceSpec(), resourceProfile(), fixture, { root });
    return { ...deniedResourceResult(result, root), reservation_delta: 0 };
  }
  if (variant === 'fixture-evidence-cannot-launch-worker') {
    const result = resourceContext(root, () => control.launch(resourceSpec(), { root, profile: resourceProfile(), resourceState: fixture }));
    return { ...deniedResourceResult(result, root), jobs_created: false };
  }
  if (variant === 'fixture-reservation-cannot-replay-production-supervisor') {
    const result = resourceContext(root, () => control.launch(resourceSpec(), { root, profile: resourceProfile(), resourceState: fixture }));
    return deniedResourceResult(result, root);
  }
  fail(`RUN093_F5_VARIANT_UNMAPPED:${variant}`);
}

function executeF6(plan) {
  const variant = plan.input.variant;
  if (variant === 'absent-versus-empty-reference-pointers') {
    const absent = smallGraphState();
    const empty = structuredClone(absent);
    empty.extensions[0].outcomes[1].reference_issue_pointers = [];
    const left = graphSurface.deriveProgrammeGraph(absent);
    const right = graphSurface.deriveProgrammeGraph(empty);
    assert.equal(left.digest, right.digest);
    assert.deepEqual(left, right);
    return { outcome: 'SAME_CANONICAL_AND_GRAPH_DIGEST' };
  }
  if (variant === 'null-undefined-wrong-type-sparse-invalid-member-or-unknown-key') {
    const cases = [
      (state) => { state.extensions[0].outcomes[1].reference_issue_pointers = null; },
      (state) => { state.extensions[0].outcomes[1].reference_issue_pointers = 'not-an-array'; },
      (state) => { state.extensions[0].outcomes[1].reference_issue_pointers = [{ repository: 'bad', issue: 0 }]; },
      (state) => { state.children[1].dependencies = null; },
      (state) => { state.children[1].scope = 'wrong-type'; },
      (state) => { state.children[1].unknown_optional = []; },
    ];
    for (const mutate of cases) {
      const state = smallGraphState();
      mutate(state);
      const result = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
      assert.equal(result.ok, false);
    }
    return { outcome: 'REJECT' };
  }
  if (variant === 'non-empty-optional-values-preserved' || variant === 'all-nonempty-optional-values-retained') {
    const state = smallGraphState();
    state.extensions[0].outcomes[1].reference_issue_pointers = [{ repository: 'example/toolkit', issue: 88 }];
    state.children[1].scope = ['Non-empty source scope remains.'];
    const graph = graphSurface.deriveProgrammeGraph(state);
    assert.deepEqual(graph.outcomes[1].dependencies, ['C1']);
    assert.deepEqual(graph.outcomes[1].reference_issue_pointers, [{ repository: 'example/toolkit', issue: 88 }]);
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    assert.equal(rendered.ok, true, JSON.stringify(rendered));
    assert.equal(rendered.canonical_state.children[1].scope[0], 'Non-empty source scope remains.');
    return { outcome: 'ACCEPT', positive_control: variant === 'all-nonempty-optional-values-retained', data_loss: false };
  }
  if (variant === 'empty-optional-parent-child-pr-sections') {
    const state = smallGraphState();
    state.children[0].pr_registry = [];
    const rendered = programmeRuntime.humanSurfaceV2.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    assert.equal(rendered.ok, true, JSON.stringify(rendered));
    for (const heading of ['## Completed work', '## Boundaries', '## PR history']) assert.equal(rendered.body.includes(heading), false, heading);
    return { outcome: 'OMIT_OPTIONAL_HEADINGS' };
  }
  if (variant === 'historical-J-K-bytes-unchanged') {
    const fixture = JSON.parse(fs.readFileSync(HISTORICAL_H2_PATH, 'utf8'));
    for (const key of ['j_graphless', 'k_graphful']) {
      const record = fixture[key];
      const body = zlib.gunzipSync(Buffer.from(record.body_gzip_base64_chunks.join(''), 'base64'));
      assert.equal(body.length, record.body_bytes);
      assert.equal(crypto.createHash('sha256').update(body).digest('hex'), record.body_sha256);
    }
    return { outcome: 'READ_COMPLETE', body_rewritten: false };
  }
  fail(`RUN093_F6_VARIANT_UNMAPPED:${variant}`);
}

function gitText(args) {
  const result = spawnSync('git', args, { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail(`RUN093_GIT_READ_FAILED:${args.join(' ')}`);
  return result.stdout.trim();
}

function gitBytes(ref, file) {
  const result = spawnSync('git', ['show', `${ref}:${file}`], { cwd: path.resolve(__dirname, '..', '..'), windowsHide: true });
  if (result.status !== 0) fail(`RUN093_GIT_BLOB_UNAVAILABLE:${ref}:${file}`);
  return result.stdout;
}

function gitMergeBaseTree() {
  const result = spawnSync('git', ['merge-tree', '--write-tree', K, M2], {
    cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8', windowsHide: true,
  });
  if (result.error || ![0, 1].includes(result.status)) fail('RUN093_MERGE_BASE_TREE_UNAVAILABLE');
  const tree = result.stdout.split(/\r?\n/, 1)[0].trim();
  if (!/^[a-f0-9]{40}$/.test(tree)) fail('RUN093_MERGE_BASE_TREE_INVALID');
  return tree;
}

function pullRequestHeadFromEvent(event, env) {
  const pullRequest = event && event.pull_request;
  const headSha = pullRequest && pullRequest.head && pullRequest.head.sha;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY
    || !pullRequest || !Number.isSafeInteger(pullRequest.number) || event.number !== pullRequest.number
    || !pullRequest.base || pullRequest.base.ref !== 'main'
    || !pullRequest.base.repo || pullRequest.base.repo.full_name !== REPOSITORY
    || !/^[a-f0-9]{40}$/.test(headSha || '')) {
    fail('RUN093_PR_EVENT_CANDIDATE_INVALID');
  }
  return headSha;
}

function topologyCandidateHead(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return gitText(['rev-parse', 'HEAD']);
  if (typeof env.GITHUB_EVENT_PATH !== 'string' || env.GITHUB_EVENT_PATH.length === 0) {
    fail('RUN093_PR_EVENT_PATH_MISSING');
  }
  let event;
  try {
    event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch (_error) {
    fail('RUN093_PR_EVENT_INVALID');
  }
  return pullRequestHeadFromEvent(event, env);
}

function executeIntegration(plan, fixture) {
  const variant = plan.input.variant;
  const root = path.resolve(__dirname, '..', '..');
  if (variant === 'current-M2-controller-architecture-registry-policy') {
    const controller = fs.readFileSync(path.join(root, 'repo/CONTROLLER.md'), 'utf8');
    const architecture = fs.readFileSync(path.join(root, 'repo/ARCHITECTURE.md'), 'utf8');
    for (const phrase of [
      'Mandatory requirement coverage closure', 'Mechanism completeness / observability',
      'Commit-required validation sequencing', 'Conditional G3 adversarial pre-publication validation',
      'G1_RECONVERGENCE',
    ]) assert.ok(controller.includes(phrase), `M2 Controller clause retained: ${phrase}`);
    for (const phrase of [
      'For transactional/state-machine work', 'Mechanism completeness is distinct from semantic correctness',
      'G3 performs a pre-publication adversarial validation episode inside the same G3',
    ]) assert.ok(architecture.includes(phrase), `M2 Architecture clause retained: ${phrase}`);
    for (const file of MAIN_ONLY_PATHS) assert.deepEqual(fs.readFileSync(path.join(root, file)), gitBytes(M2, file), `${file} is exact M2 carry`);
    return { outcome: 'PRESERVED' };
  }
  if (variant === 'K-compatible-candidate-contract-preserved') {
    const requiredMarkers = [
      ['repo/scripts/toolkit-github-program-receipt.cjs', 'function packetClosedClone'],
      ['repo/scripts/toolkit-programme-surface-v1.cjs', 'function renderProgrammeGraph(canonicalState)'],
      ['repo/scripts/toolkit-agent-control.cjs', 'function withRepositoryTestResourceInvocation'],
      ['repo/scripts/toolkit-github-program-state-v5.cjs', "const H2_RENDERER_REVISION = 'human-v2-r093'"],
      ['repo/scripts/toolkit-gate-contract-compiler.cjs', 'function trustedJsonCopy'],
      ['repo/scripts/toolkit-evidence-plan-compiler.cjs', 'trustedDataCopy'],
    ];
    for (const [file, marker] of requiredMarkers) assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(marker), `${file}:${marker}`);
    return { outcome: 'PRESERVED' };
  }
  if (variant === 'compare-exact-run095-path-manifest') {
    const allowed = new Set(fixture.mutation.allow_paths);
    const mergeBaseTree = gitMergeBaseTree();
    const tracked = gitText(['diff', '--name-only', mergeBaseTree]).split(/\r?\n/).filter(Boolean);
    const untracked = gitText(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
    const changed = [...new Set([...tracked, ...untracked])];
    const extra = changed.filter((file) => !allowed.has(file));
    assert.deepEqual(extra, []);
    assert.ok(changed.length <= RUN095_MAXIMUM_CHANGED_PATHS);
    assert.deepEqual(RUN095_ADDITIONAL_PATHS.every((file) => changed.includes(file)), true);
    return { outcome: 'WITHIN_ALLOWLIST', maximum_paths: RUN095_MAXIMUM_CHANGED_PATHS };
  }
  if (variant === 'N-ordered-parents-K-M2-first-parent-K') {
    assert.equal(gitText(['cat-file', '-t', K]), 'commit');
    assert.equal(gitText(['cat-file', '-t', M2]), 'commit');
    const head = topologyCandidateHead();
    if (head === K) fail('RUN093_EXACT_N_NOT_CREATED');
    assert.equal(gitText(['cat-file', '-t', head]), 'commit');
    const parents = gitText(['rev-list', '--parents', '-n', '1', head]).split(' ').slice(1);
    assert.deepEqual(parents, [K, M2]);
    const tree = gitText(['rev-parse', `${head}^{tree}`]);
    const identitySource = process.env.GITHUB_EVENT_NAME === 'pull_request'
      ? 'github-event-pull-request-head'
      : 'local-current-HEAD';
    process.stdout.write(`RUN093_TOPOLOGY_HEAD=${head}; TREE=${tree}; PARENTS=${parents.join(',')}; SOURCE=${identitySource}\n`);
    return { outcome: 'EXACT', candidate_sha: head, candidate_tree: tree, ordered_parents: parents, identity_source: identitySource };
  }
  if (variant === 'authoritative-and-checked-native-manifests' || variant === 'Codex-Claude-bridge-and-setup-expectations') {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'repo/contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
    const codexInput = JSON.parse(fs.readFileSync(path.join(root, 'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json'), 'utf8'));
    const claudeInput = JSON.parse(fs.readFileSync(path.join(root, 'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json'), 'utf8'));
    const codexChecked = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
    const claudeChecked = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(version, '2.10.10');
    assert.equal(codexInput.version, version);
    assert.equal(claudeInput.version, version);
    assert.deepEqual(codexChecked, codexInput);
    assert.deepEqual(claudeChecked, claudeInput);
    assert.equal(require('../scripts/toolkit-local-bridge.cjs').BRIDGE_VERSION, version);
    assert.equal(require('../scripts/setup-codex-toolkit-plugin.cjs').EXPECTED_TOOLKIT_VERSION, version);
    const codexDelegationConfig = fs.readFileSync(path.join(root, 'repo/scripts/codex-delegation-config.cjs'), 'utf8');
    assert.ok(codexDelegationConfig.includes(`const TOOLKIT_CLIENT_VERSION = '${version}';`));
    assert.equal(control.CONTROL_VERSION, version);
    return {
      outcome: 'ALIGNED',
      ...(variant === 'Codex-Claude-bridge-and-setup-expectations' ? { positive_control: true } : {}),
      version,
    };
  }
  fail(`RUN093_INTEGRATION_VARIANT_UNMAPPED:${variant}`);
}

test('hosted pull_request topology selection uses the event head instead of synthetic checkout HEAD', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run093-pr-event-'));
  const eventPath = path.join(temporaryRoot, 'event.json');
  const candidateHead = 'd'.repeat(40);
  fs.writeFileSync(eventPath, JSON.stringify({
    number: 447,
    pull_request: {
      number: 447,
      head: { sha: candidateHead },
      base: { ref: 'main', repo: { full_name: REPOSITORY } },
    },
  }));
  try {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: REPOSITORY,
    };
    assert.equal(topologyCandidateHead(env), candidateHead);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

async function executeRun093Case(plan, fixture) {
  if (plan.surface === 'validateAuthorityPacket' || plan.surface === 'validateAuthorityPacketDelivery'
    || plan.surface === 'persistAuthorityPacket' || plan.surface === 'buildCurrentPacketProjection'
    || plan.surface === 'admitSemanticGate' || plan.surface === 'supplemental-completion') return executeF1(plan);
  if (['renderProgrammeGraph', 'humanSurfaceV2.render', 'humanSurfaceV2.readComplete', 'public-export-surface'].includes(plan.surface)) {
    if (plan.id.startsWith('R093-F2-')) return executeF2(plan);
  }
  if (plan.id.startsWith('R093-F3-')) return executeF3(plan);
  if (plan.id.startsWith('R093-F4-')) return executeF4(plan);
  if (plan.id.startsWith('R093-F5-')) return executeF5(plan);
  if (plan.id.startsWith('R093-F6-')) return executeF6(plan);
  if (plan.id.startsWith('R093-I-')) return executeIntegration(plan, fixture);
  fail(`RUN093_CASE_DISPATCH_MISSING:${plan.id}`);
}

test.after(() => packetSupport.cleanup());

test('Run-094 reclosure fixture registers, executes, and verifies every Run-093 F1-F6 and integration case exactly once', async () => {
  const { ir, compiled } = validateFixture();
  const registration = registerCases(compiled.generated_cases);
  const registered = REGISTRATIONS.get(registration);
  assert.equal(registered.size, REQUIRED_CASE_IDS.length);
  const receipts = [];
  let positiveControls = 0;
  for (const plan of registered.values()) {
    const observation = await executeRun093Case(plan, ir);
    assertExpected(plan, observation);
    if (plan.expected.positive_control === true) positiveControls += 1;
    receipts.push(receiptFor(plan, observation));
  }
  const completion = completeRun(registration, receipts);
  const result = verifyCompletion(completion);
  assert.equal(result.declared_count, 81);
  assert.equal(result.registered_count, 81);
  assert.equal(result.executed_count, 81);
  assert.equal(new Set(result.case_ids).size, 81);
  assert.equal(positiveControls, 10);
  assert.equal(verifyCompletion({ executed_count: 80 }), null);
  assert.equal(verifyCompletion(null), null);
  process.stdout.write(`RUN093_REClosure=${result.executed_count}/${result.declared_count}; positives=${positiveControls}; skipped=0\n`);
});
