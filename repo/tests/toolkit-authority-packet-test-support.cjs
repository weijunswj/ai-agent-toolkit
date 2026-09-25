'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const executionLoop = require('../scripts/toolkit-execution-loop.cjs');
const controlPlane = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');
const assuranceRuntime = require('../scripts/toolkit-assurance-web-finality.cjs');
const gateContractCompiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const cleanupRoots = new Set();
const ORACLE_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'authority-packet-durability-g2-v1.json');
const oracleContractIr = JSON.parse(fs.readFileSync(ORACLE_FIXTURE_PATH, 'utf8'));
let oracleStateParent;
let oracleSharedContext;
let oracleSharedTemplate;
let oracleSharedGateContext;
let oracleSharedGateTemplate;
let oracleSharedAssuranceContext;
let oracleSharedAssuranceTemplate;

const ORACLE_REQUIREMENT_IDS = Object.freeze([
  'A01', 'A02', 'A03', 'A04', 'A05',
  'B01', 'B02', 'B03', 'B04', 'B05', 'B06',
  'C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09',
  'D01', 'D02', 'D03', 'D04', 'D05',
  'E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08',
  'F01', 'F02', 'F03', 'F04',
  'G01', 'G02', 'G03', 'G04', 'G05', 'G06',
  'H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07',
  'I01', 'I02', 'I03', 'I04', 'I05', 'I06',
  'X01', 'X02', 'X03', 'X04', 'X05', 'X06', 'X07', 'X08', 'X09', 'X10'
]);

function deepFreezeOracleData(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeOracleData(child, seen);
  return Object.freeze(value);
}

const EXPANDED_ORACLE_REQUIREMENTS = new Set(['E05', 'E06', 'I04', 'X09']);
const ORACLE_MANDATORY_CASES = Object.freeze(
  gateContractCompiler.compileGateContract(oracleContractIr).generated_cases
);
deepFreezeOracleData(ORACLE_MANDATORY_CASES);
const ORACLE_SPEC_MANIFEST_CORE = Object.freeze({
  schema: 'ORACLE_SPEC_MANIFEST_V1',
  version: 1,
  source_fixture_blob: '70997368cd0d8e2b148f57d7d0537966a8827d71',
  source_harness_blob: '11daf32ac5a6ddf1a2bdab0d2acbf6fdb8ff40da',
  requirement_count: 66,
  explicit_case_count: 161,
  materialized_case_count: 337,
  ordinary_case_count: 153,
  expanded_case_count: 184,
  expanded_requirements: Object.freeze(['E05', 'E06', 'I04', 'X09']),
  expanded_surface_count: 23,
  identity_set_digest: '20257a4ae6e5f38f9b8cdf0fb1097e9f5580918d72146fb631e3115955682211',
  ordinary_call_rules_digest: '8e1bf56d0a7386af6f4f3cfd97b2ca450597d15282835acb1d1e7eb88020d6bd',
  expanded_surface_codes_digest: '25a3812b6ed3de805646c322915798764611117ae85abcef4ceaa371f92e0860',
});
const ORACLE_ORDINARY_CALL_RULES_V1 = Object.freeze({
  A01: { NEG: { calls: 'P!', effect: 'Z' }, POS: { calls: 'P', effect: 'NEW' } },
  A02: { NEG: { calls: 'P!', effect: 'Z' }, POS: { calls: 'P', effect: 'NEW' } },
  A03: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  A04: { NEG: { calls: 'N!', effect: 'Z' }, POS: { calls: 'N', effect: 'ADM' } },
  A05: { NEG: { calls: 'A!', effect: 'RB0' }, POS: { calls: 'A', effect: 'ACC' } },
  B01: { NEG: { calls: 'INIT!', effect: 'Z' }, POS: { calls: 'INIT', effect: 'STORE' } },
  B02: { NEG: { calls: 'Pcrash!', effect: 'Z' }, POS: { calls: 'P', effect: 'NEW' } },
  B03: { NEG: { calls: 'Acrash!', effect: 'RB0' }, POS: { calls: 'A', effect: 'ACC' } },
  B04: { NEG: { calls: 'F!', effect: 'Z' }, POS: { calls: 'F', effect: 'READ' } },
  B05: { NEG: { calls: 'Ainterrupt!', effect: 'RB1' }, POS: { calls: 'A,A', effect: 'ACCREPLAY' } },
  B06: { NEG: { calls: 'Q!', effect: 'Z' }, POS: { calls: 'Q', effect: 'CUR' } },
  C01: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  C02: { NEG: { calls: 'ID,ID,COMPARE', effect: 'Z' }, POS: { calls: 'ID', effect: 'PURE' } },
  C03: { NEG: { calls: 'SID!', effect: 'Z' }, POS: { calls: 'SID', effect: 'STOREID' } },
  C04: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  C05: { NEG: { calls: 'R!', effect: 'Z' }, POS: { calls: 'R', effect: 'READ' } },
  C06: { NEG: { calls: 'AUTH,COMPARE', effect: 'Z' }, POS: { calls: 'AUTH,COMPARE', effect: 'PURE' } },
  C07: { NEG: { calls: 'CAND,COMPARE', effect: 'Z' }, POS: { calls: 'CAND,COMPARE', effect: 'PURE' } },
  C08: { NEG: { calls: 'N!', effect: 'Z' }, POS: { calls: 'N', effect: 'ADM' } },
  C09: { NEG: { calls: 'A!', effect: 'RB1' }, POS: { calls: 'A', effect: 'ACC' } },
  D01: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  D02: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  D03: { NEG: { calls: 'SCREEN!', effect: 'Z' }, POS: { calls: 'SCREEN', effect: 'PURE' } },
  D04: { NEG: { calls: 'P!', effect: 'Z' }, POS: { calls: 'P', effect: 'NEW' } },
  D05: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  E01: { NEG: { calls: 'Ffault!', effect: 'Z' }, POS: { calls: 'F', effect: 'READ' } },
  E02: { NEG: { calls: 'F,DELIVERY!', effect: 'Z' }, POS: { calls: 'F,DELIVERY', effect: 'READ' } },
  E03: { NEG: { calls: 'F,DELIVERY!', effect: 'Z' }, POS: { calls: 'F,DELIVERY', effect: 'READ' } },
  E04: { NEG: { calls: 'N!', effect: 'Z' }, POS: { calls: 'N', effect: 'ADM' } },
  E07: { NEG: { calls: 'K!', effect: 'Z' }, POS: { calls: 'K', effect: 'RECOVER' } },
  E08: { NEG: { calls: 'N!', effect: 'Z' }, POS: { calls: 'N', effect: 'ADM' } },
  F01: { NEG: { calls: 'B!', effect: 'Z' }, POS: { calls: 'B,Q', effect: 'CUR' } },
  F02: { NEG: { calls: 'P!', effect: 'PRESERVE' }, POS: { calls: 'P,A,A,B,Q,Q', effect: 'REPLAYCHAIN' } },
  F03: { NEG: { calls: 'Q!', effect: 'PRESERVE' }, POS: { calls: 'Q', effect: 'SHRINK' } },
  F04: { NEG: { calls: 'K!', effect: 'Z' }, POS: { calls: 'K', effect: 'RECOVER' } },
  G01: { NEG: { calls: 'P!', effect: 'PRESERVE' }, POS: { calls: 'P', effect: 'REPLAY' } },
  G02: { NEG: { calls: 'P!', effect: 'PRESERVE' }, POS: { calls: 'P', effect: 'REPLAY' } },
  G03: { NEG: { calls: 'RACEconflict', effect: 'RACE' }, POS: { calls: 'RACEidentical', effect: 'RACE' } },
  G04: { NEG: { calls: 'RACEconflict', effect: 'RACE' }, POS: { calls: 'P,P!,A', effect: 'SERIAL' } },
  G05: { NEG: { calls: 'U!', effect: 'Z' }, POS: { calls: 'U', effect: 'READ' } },
  G06: { NEG: { calls: 'DISPATCH!', effect: 'Z' }, POS: { calls: 'DISPATCH', effect: 'DISP' } },
  H01: { NEG: { calls: 'N!', effect: 'Z' }, POS: { calls: 'N', effect: 'ADM0' } },
  H02: { NEG: { calls: 'B!', effect: 'Z' }, POS: { calls: 'B,Q', effect: 'CUR' } },
  H03: { NEG: { calls: 'R!', effect: 'Z' }, POS: { calls: 'R,REOPEN,R', effect: 'READ' } },
  H04: { NEG: { calls: 'R!', effect: 'PRESERVE' }, POS: { calls: 'P!,R', effect: 'CAPREAD' } },
  H05: { NEG: { calls: 'BACKFILL!', effect: 'Z' }, POS: { calls: 'BACKFILL', effect: 'BACK' } },
  H06: { NEG: { calls: 'BACKFILL!', effect: 'Z' }, POS: { calls: 'BACKFILL', effect: 'BACK' } },
  H07: { NEG: { calls: 'BACKFILL!', effect: 'Z' }, POS: { calls: 'BACKFILL', effect: 'BACK' } },
  I01: { NEG: { calls: 'A!', effect: 'RB1' }, POS: { calls: 'A', effect: 'ACC' } },
  I02: { NEG: { calls: 'F,N!', effect: 'READ' }, POS: { calls: 'F', effect: 'READ' } },
  I03: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V', effect: 'PURE' } },
  I05: { NEG: { calls: 'INIT!', effect: 'Z' }, POS: { calls: 'INIT', effect: 'STORE' } },
  I06: { NEG: { calls: 'N!', effect: 'Z' }, POS: { calls: 'N', effect: 'ADM' } },
  X01: { NEG: { calls: 'MIGRATE!', effect: 'DBBYTES' }, POS: { calls: 'MIGRATE', effect: 'MIG' } },
  X02: { NEG: { calls: 'INIT!', effect: 'PRESERVE' }, POS: { calls: 'INIT', effect: 'STORE' } },
  X03: { NEG: { calls: 'Ffault!', effect: 'Z' }, POS: { calls: 'F', effect: 'READ' } },
  X04: { NEG: { calls: 'F,DELIVERY!', effect: 'Z' }, POS: { calls: 'F,DELIVERY', effect: 'BIGREAD' } },
  X05: { NEG: { calls: 'IMPORT2,N!', effect: 'Z' }, POS: { calls: 'IMPORT2,N', effect: 'ADM' } },
  X06: { NEG: { calls: 'K!', effect: 'Z' }, POS: { calls: 'K,BEGIN', effect: 'RECOVERBEGIN' } },
  X07: { NEG: { calls: 'B!,HUMANroundtrip', effect: 'LEGACY' }, POS: { calls: 'B,Q,HUMANroundtrip', effect: 'CURLEGACY' } },
  X08: { NEG: { calls: 'V!', effect: 'Z' }, POS: { calls: 'V,COMPILERS,SHIPPING', effect: 'INTEGRATION' } },
  X10: { NEG: { calls: 'R!', effect: 'PRESERVE' }, POS: { calls: 'P!,R', effect: 'CAPREAD' } },
});
const ORACLE_TOKEN_METHOD_V1 = Object.freeze({
  V: 'validateAuthorityPacket', P: 'persistAuthorityPacket', A: 'bindWebPacketAcceptance',
  Pcrash: 'persistAuthorityPacket', Acrash: 'bindWebPacketAcceptance',
  Ainterrupt: 'bindWebPacketAcceptance', F: 'verifyAuthorityPacketFresh',
  Ffault: 'verifyAuthorityPacketFresh', R: 'readAuthorityPacket',
  ID: 'authorityPacketIdentities', SID: 'authorityPacketStoreIdentity',
  AUTH: 'readAuthority', CAND: 'readCandidate', SCREEN: 'screenPacket',
  DELIVERY: 'validateAuthorityPacketDelivery', INIT: 'initialiseAuthorityPacketStore',
  N: 'admitSemanticGate', B: 'buildCurrentPacketProjection', Q: 'confirmCurrentPacketProjection',
  BEGIN: 'beginSemanticGateDispatch', DISPATCH: 'recordSemanticGateDispatch',
  BACKFILL: 'backfillAuthorityPacket', MIGRATE: 'migrateAuthorityPacketStore',
  REOPEN: 'REOPEN', COMPARE: 'COMPARE', RACEconflict: 'persistAuthorityPacket',
  RACEidentical: 'persistAuthorityPacket', IMPORT2: 'IMPORT2',
  HUMANroundtrip: 'HUMANroundtrip', COMPILERS: 'COMPILERS', SHIPPING: 'SHIPPING',
  U: 'revalidateSemanticGate',
  K: 'recoverSemanticGateAdmission',
});
const ORACLE_TOKEN_TARGET_V1 = Object.freeze({
  AUTH: 'reader', CAND: 'reader', SCREEN: 'reader',
  V: 'runtime', INIT: 'runtime', ID: 'runtime', SID: 'runtime', DELIVERY: 'runtime', MIGRATE: 'runtime',
  HUMANroundtrip: 'human-surface', COMPILERS: 'compiler-tests', SHIPPING: 'shipping-tests',
  IMPORT2: 'process', COMPARE: 'observed-production-invariant',
  REOPEN: 'process',
});
deepFreezeOracleData(ORACLE_ORDINARY_CALL_RULES_V1);
const ORACLE_EXPANDED_SURFACE_CODES_V1 = Object.freeze([
  ['S01', 'receipt.startRun'],
  ['S02', 'receipt.allocateRun->startAllocatedRun'],
  ['S03', 'receipt.admitMutationOperation'],
  ['S04', 'receipt.authorizeMutationDispatch'],
  ['S05', 'loop.admitRun'],
  ['S06', 'loop.prepareRetry'],
  ['S07', 'loop.transitionRun.admitted'],
  ['S08', 'loop.transitionRun.running'],
  ['S09', 'loop.startDelegatedRun'],
  ['S10', 'loop.atomicBatchCommit'],
  ['S11', 'loop.executeTypedGitCommit'],
  ['S12', 'loop.commitExact'],
  ['S13', 'loop.completeRun'],
  ['S14', 'loop.transitionRun.terminal'],
  ['S15', 'loop.governedCompletion'],
  ['S16', 'loop.releaseMutationLease'],
  ['S17', 'receipt.appendReceipt'],
  ['S18', 'assurance.admitG4'],
  ['S19', 'assurance.evaluateAssurance'],
  ['S20', 'assurance.evaluateG4A'],
  ['S21', 'assurance.evaluateNoByteReviewDisposition'],
  ['S22', 'assurance.evaluateInvalidation'],
  ['S23', 'assurance.evaluateFinality'],
]);
const ORACLE_EFFECT_RULE_IDS_V1 = new Set([
  'Z', 'PURE', 'NEW', 'ADM', 'RB0', 'ACC', 'STORE', 'RB1', 'ACCREPLAY', 'CUR',
  'STOREID', 'READ', 'PRESERVE', 'REPLAYCHAIN', 'SHRINK', 'RECOVER', 'REPLAY',
  'RACE', 'SERIAL', 'DISP', 'ADM0', 'CAPREAD', 'BACK', 'DBBYTES', 'MIG',
  'BIGREAD', 'RECOVERBEGIN', 'LEGACY', 'CURLEGACY', 'INTEGRATION',
  ...ORACLE_EXPANDED_SURFACE_CODES_V1.map(([code]) => code),
]);
const ORACLE_SPEC_MANIFEST_V1 = Object.freeze({
  ...ORACLE_SPEC_MANIFEST_CORE,
  ordinary_call_rules: ORACLE_ORDINARY_CALL_RULES_V1,
  expanded_surface_codes: ORACLE_EXPANDED_SURFACE_CODES_V1,
});
deepFreezeOracleData(ORACLE_SPEC_MANIFEST_V1);
const ORACLE_SURFACE_RECEIPTS = new WeakMap();
const ORACLE_AUTHORITY_PACKET_STORES = new WeakSet();
const ORACLE_PROGRAMME_RECEIPT_STORES = new WeakSet();
const ORACLE_PROGRAMME_RECEIPT_STORE_METHODS = new WeakMap();
const ORACLE_MUTATION_ADMISSIONS = new WeakSet();
const ORACLE_READER_SETS = new WeakSet();
const ORACLE_READER_SET_BINDINGS = new WeakMap();
let activeOracleHarness = null;

function gitBlobSha1(bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content])).digest('hex');
}

function recordOracleHarnessEvent(event) {
  for (let harness = activeOracleHarness; harness; harness = harness.parent) {
    if (!Array.isArray(harness.events)) harness.events = [];
    harness.events.push(event);
  }
}

function recordOracleHarnessReceipt(receipt) {
  for (let harness = activeOracleHarness; harness; harness = harness.parent) {
    if (!Array.isArray(harness.receipts)) harness.receipts = [];
    harness.receipts.push(receipt);
  }
}

function recordOracleHarnessReadback(observation) {
  for (let harness = activeOracleHarness; harness; harness = harness.parent) {
    if (!Array.isArray(harness.readbacks)) harness.readbacks = [];
    harness.readbacks.push(Object.freeze({ ...observation }));
  }
}

function oracleArgumentBindingDigest(caseValue, targetType, target, method, args) {
  if (caseValue.requirement_id === 'D01') {
    return runtime.digestValue({ case_identity: oracleCaseIdentity(caseValue), method, argument_count: args.length });
  }
  const references = new Map();
  const normalize = (value) => {
    if (value === null) return { type: 'null' };
    if (value === undefined) return { type: 'undefined' };
    if (typeof value === 'string' || typeof value === 'boolean') return { type: typeof value, value };
    if (typeof value === 'number') return { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
    if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
    if (typeof value === 'symbol') return { type: 'symbol', value: String(value) };
    if (typeof value === 'function') {
      let sourceDigest = null;
      try { sourceDigest = runtime.digestValue(Function.prototype.toString.call(value)); } catch (_) { /* function identity remains typed */ }
      return { type: 'function', source_digest: sourceDigest };
    }
    if (ORACLE_READER_SETS.has(value)) {
      return { type: 'reader-set', binding_digest: ORACLE_READER_SET_BINDINGS.get(value) || null };
    }
    if (ORACLE_AUTHORITY_PACKET_STORES.has(value) || ORACLE_PROGRAMME_RECEIPT_STORES.has(value)) {
      let identityDigest = null;
      try {
        identityDigest = ORACLE_AUTHORITY_PACKET_STORES.has(value) && typeof value.storeIdentityDigest === 'function'
          ? value.storeIdentityDigest() : null;
      } catch (_) { /* the path binding below remains explicit */ }
      return {
        type: ORACLE_AUTHORITY_PACKET_STORES.has(value) ? 'authority-packet-store' : 'programme-receipt-store',
        database_path_digest: runtime.digestValue(value.databasePath),
        store_identity_digest: identityDigest,
      };
    }
    if (Buffer.isBuffer(value)) return { type: 'buffer', byte_length: value.length, bytes_digest: runtime.digestValue(value.toString('base64')) };
    if (ArrayBuffer.isView(value)) {
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      return { type: value.constructor && value.constructor.name || 'typed-array', byte_length: bytes.length, bytes_digest: runtime.digestValue(bytes.toString('base64')) };
    }
    if (value instanceof Date) return { type: 'date', value: value.toISOString() };
    if (references.has(value)) return { type: 'reference', ordinal: references.get(value) };
    references.set(value, references.size + 1);
    if (Array.isArray(value)) return { type: 'array', values: value.map(normalize) };
    if (value instanceof Map) return {
      type: 'map', entries: [...value.entries()].map(([key, child]) => [normalize(key), normalize(child)])
        .sort((left, right) => runtime.canonicalSerialize(left[0]).localeCompare(runtime.canonicalSerialize(right[0]))),
    };
    if (value instanceof Set) return {
      type: 'set', values: [...value.values()].map(normalize).sort((left, right) => runtime.canonicalSerialize(left).localeCompare(runtime.canonicalSerialize(right))),
    };
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch (_) {
      return { type: 'uninspectable-object', reference: references.get(value) };
    }
    const properties = Reflect.ownKeys(descriptors).map((key) => {
      const descriptor = descriptors[key];
      const keyValue = typeof key === 'symbol' ? { symbol: String(key) } : { string: key };
      return Object.hasOwn(descriptor, 'value')
        ? [keyValue, { enumerable: descriptor.enumerable, writable: descriptor.writable, value: normalize(descriptor.value) }]
        : [keyValue, { enumerable: descriptor.enumerable, accessor: true,
          get_digest: descriptor.get ? normalize(descriptor.get).source_digest : null,
          set_digest: descriptor.set ? normalize(descriptor.set).source_digest : null }];
    }).sort((left, right) => runtime.canonicalSerialize(left[0]).localeCompare(runtime.canonicalSerialize(right[0])));
    return { type: 'record', properties };
  };
  const shape = args.map(normalize);
  let targetBinding;
  if (typeof target?.databasePath === 'string') {
    let storeIdentityDigest = null;
    let storeIdentityError;
    if (ORACLE_AUTHORITY_PACKET_STORES.has(target)) {
      try { storeIdentityDigest = target.storeIdentityDigest(); }
      catch (error) { storeIdentityError = error && error.code || 'STORE_IDENTITY_UNAVAILABLE'; }
    }
    targetBinding = {
      type: targetType,
      database_path_digest: runtime.digestValue(target.databasePath),
      store_identity_digest: storeIdentityDigest,
      ...(storeIdentityError ? { store_identity_error: storeIdentityError } : {}),
    };
  } else targetBinding = { type: targetType, module: target === runtime ? 'receipt-runtime'
      : target === executionLoop ? 'execution-loop'
        : target === assuranceRuntime ? 'assurance'
          : ORACLE_READER_SETS.has(target) ? 'bound-reader-set' : 'unknown',
    reader_set_binding_digest: ORACLE_READER_SETS.has(target) ? ORACLE_READER_SET_BINDINGS.get(target) || null : null };
  return runtime.digestValue({ case_identity: oracleCaseIdentity(caseValue), target: targetBinding, method, args: shape });
}

function assertOracleManifestV1() {
  const sourceBytes = fs.readFileSync(ORACLE_FIXTURE_PATH);
  if (gitBlobSha1(sourceBytes) !== ORACLE_SPEC_MANIFEST_V1.source_fixture_blob) {
    throw new Error('ORACLE_MANIFEST_SOURCE_FIXTURE_MISMATCH');
  }
  const explicitCount = oracleContractIr.requirements.reduce((count, requirement) => count + requirement.cases.length, 0);
  const identities = ORACLE_MANDATORY_CASES.map(oracleCaseIdentity).sort();
  const unique = new Set(identities);
  const expanded = ORACLE_MANDATORY_CASES.filter((item) => ORACLE_SPEC_MANIFEST_V1.expanded_requirements.includes(item.requirement_id));
  const expandedSurfaces = new Set(expanded.map((item) => item.surface));
  const ordinary = ORACLE_MANDATORY_CASES.filter((item) => !ORACLE_SPEC_MANIFEST_V1.expanded_requirements.includes(item.requirement_id));
  const ordinaryRuleIds = Object.keys(ORACLE_SPEC_MANIFEST_V1.ordinary_call_rules).sort();
  const ordinaryRequirementIds = [...new Set(ordinary.map((item) => item.requirement_id))].sort();
  let unmappedCaseCount = 0;
  const effectAssignments = new Map();
  for (const item of ORACLE_MANDATORY_CASES) {
    try {
      const plan = expectedOraclePlan(item);
      if (!plan.calls.length || !ORACLE_EFFECT_RULE_IDS_V1.has(plan.effect_rule)
        || plan.positive_control_case_id !== oraclePositiveControlCaseId(item)
        || plan.calls.some((call) => !['ACCEPT', 'REJECT'].includes(call.expected_outcome)
          || !call.target_type || !call.method
          || (call.expected_outcome === 'REJECT' && !call.expected_code))) {
        unmappedCaseCount += 1;
      }
      const assignmentKey = [plan.requirement_id, plan.polarity, plan.surface_code || item.surface].join('\u0000');
      if (!effectAssignments.has(assignmentKey)) effectAssignments.set(assignmentKey, new Set());
      effectAssignments.get(assignmentKey).add(plan.effect_rule);
    } catch (_) {
      unmappedCaseCount += 1;
    }
  }
  const ambiguousEffectRuleCount = [...effectAssignments.values()].filter((rules) => rules.size !== 1).length;
  if (ORACLE_SPEC_MANIFEST_V1.source_harness_blob) {
    const sourceHarness = spawnSync('git', [
      'rev-parse',
      'd04dea7938e791725e7e43b293b6fe35be14ac9e:repo/tests/toolkit-authority-packet-test-support.cjs',
    ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    if (sourceHarness.status !== 0 || String(sourceHarness.stdout).trim() !== ORACLE_SPEC_MANIFEST_V1.source_harness_blob) {
      throw new Error('ORACLE_MANIFEST_SOURCE_HARNESS_MISMATCH');
    }
  }
  if (oracleContractIr.requirements.length !== ORACLE_SPEC_MANIFEST_V1.requirement_count
    || explicitCount !== ORACLE_SPEC_MANIFEST_V1.explicit_case_count
    || identities.length !== ORACLE_SPEC_MANIFEST_V1.materialized_case_count
    || unique.size !== ORACLE_SPEC_MANIFEST_V1.materialized_case_count
    || identities.some((identity) => typeof identity !== 'string' || !identity.includes('\u0000'))
    || runtime.digestValue(identities) !== ORACLE_SPEC_MANIFEST_V1.identity_set_digest
    || expanded.length !== ORACLE_SPEC_MANIFEST_V1.expanded_case_count
    || expandedSurfaces.size !== ORACLE_SPEC_MANIFEST_V1.expanded_surface_count
    || ordinary.length !== ORACLE_SPEC_MANIFEST_V1.ordinary_case_count
    || ordinaryRuleIds.length !== ordinaryRequirementIds.length
    || ordinaryRuleIds.some((id, index) => id !== ordinaryRequirementIds[index])
    || ORACLE_EXPANDED_SURFACE_CODES_V1.length !== ORACLE_SPEC_MANIFEST_V1.expanded_surface_count
    || runtime.digestValue(ORACLE_SPEC_MANIFEST_V1.ordinary_call_rules) !== ORACLE_SPEC_MANIFEST_V1.ordinary_call_rules_digest
    || runtime.digestValue(ORACLE_SPEC_MANIFEST_V1.expanded_surface_codes) !== ORACLE_SPEC_MANIFEST_V1.expanded_surface_codes_digest
    || unmappedCaseCount !== 0
    || ambiguousEffectRuleCount !== 0) {
    throw new Error(`ORACLE_MANIFEST_COVERAGE_MISMATCH:req=${oracleContractIr.requirements.length}:explicit=${explicitCount}:cases=${identities.length}:unique=${unique.size}:identityDigest=${runtime.digestValue(identities)}:ordinary=${ordinary.length}:ordinaryRules=${ordinaryRuleIds.length}:expanded=${expanded.length}:surfaces=${expandedSurfaces.size}:unmapped=${unmappedCaseCount}:ambiguousEffects=${ambiguousEffectRuleCount}`);
  }
  return Object.freeze({
    requirement_count: oracleContractIr.requirements.length,
    explicit_case_count: explicitCount,
    materialized_case_count: identities.length,
    unique_case_count: unique.size,
    expanded_case_count: expanded.length,
    expanded_surface_count: expandedSurfaces.size,
    unmapped_case_count: unmappedCaseCount,
    ambiguous_effect_rule_count: ambiguousEffectRuleCount,
  });
}

const ORACLE_MANIFEST_COVERAGE = assertOracleManifestV1();

function oracleCaseIdentity(item) {
  return [item.requirement_id, item.id, item.input && item.input.variant, item.surface].join('\u0000');
}

function oraclePositiveControlCaseId(item) {
  const controls = ORACLE_MANDATORY_CASES.filter((candidate) => candidate.requirement_id === item.requirement_id
    && candidate.surface === item.surface && candidate.expected.positive_control === true);
  if (controls.length !== 1) throw new Error(`ORACLE_POSITIVE_CONTROL_MISSING:${item.requirement_id}:${item.surface}`);
  const control = controls[0];
  if (item.expected.positive_control === true && oracleCaseIdentity(control) !== oracleCaseIdentity(item)) {
    throw new Error(`ORACLE_POSITIVE_CONTROL_IDENTITY_MISMATCH:${item.id}`);
  }
  return control.id;
}

function oracleCaseContractBinding(item) {
  return runtime.digestValue({
    identity: oracleCaseIdentity(item),
    expected: item.expected,
  });
}

function secureWindowsDirectory(root) {
  if (process.platform !== 'win32') return;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    '$ErrorActionPreference="Stop"',
    '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$icacls=Join-Path $env:SystemRoot "System32\\icacls.exe"',
    '& $icacls $env:GPR_TEST_ROOT "/inheritance:r" "/grant:r" ("*${sid}:(OI)(CI)F") "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null',
    'if ($LASTEXITCODE -ne 0) { throw "icacls-failed" }'
  ].join(';');
  const result = require('node:child_process').spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GPR_TEST_ROOT: root }
  });
  if (result.status !== 0) throw new Error(`Unable to secure test state root: ${result.stderr}`);
}

function stateRoot(prefix = 'authority-packet-') {
  const parent = path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'github-program-receipt', 'tests');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(parent, 0o700);
  const root = fs.mkdtempSync(path.join(parent, prefix));
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  secureWindowsDirectory(root);
  cleanupRoots.add(root);
  return root;
}

function oracleStateRoot(prefix = 'oracle-') {
  if (!oracleStateParent) oracleStateParent = stateRoot('oracle-matrix-');
  const root = fs.mkdtempSync(path.join(oracleStateParent, `${runtime.digestValue(prefix).slice(0, 10)}-`));
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  cleanupRoots.add(root);
  return root;
}

function options(root = stateRoot()) {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 435,
    child_issue: 435,
    stateRoot: root,
    repositoryRoot
  };
}

function sourceReference(seed = 'authority') {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    issue_number: 435,
    comment_id: 5772542748,
    node_id: `IC_${seed}`,
    author_login: 'weijunswj',
    updated_at: '2026-09-22T10:00:00.000Z',
    body_digest: runtime.digestValue({ seed, body: 'authority-packet-test' })
  };
}

function bindings(seed = 'packet') {
  const authority = sourceReference(seed);
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 435,
    child_issue: 435,
    lane_id: 'c1-g3-leaf-a',
    human_owner: 'weijunswj',
    producer: {
      run: `run-${seed}`,
      lock: `lock-${seed}`,
      stage: 'G2',
      role: 'G2'
    },
    authority,
    governance: {
      repository: 'weijunswj/ai-agent-toolkit',
      main_commit: '1'.repeat(40),
      controller_blob: '2'.repeat(40),
      stack_registry_blob: '3'.repeat(40)
    },
    candidate: null,
    applicability: {
      scope_digest: runtime.digestValue({ seed, scope: 'c1' }),
      required_consumers: [{
        class: 'G3',
        dependency_id: 'g3-authority-consumer',
        scope_digest: runtime.digestValue({ seed, consumer: 'g3' })
      }],
      retain_through_child_finality: true,
      retain_through_candidate_finality: false
    }
  };
}

function packet(overrides = {}) {
  const packetBindings = overrides.bindings || bindings(overrides.seed || 'packet');
  const sectionNames = packetBindings.producer.stage === 'G3'
    ? ['implementation', 'candidate_identity', 'validation_results', 'remaining_obligations']
    : ['implementation_contract', 'mutation_boundary', 'oracle_matrix', 'validation', 'publication_boundary'];
  const body = {
    verdict: 'HOLD',
    decision: 'The custody implementation remains pending downstream semantic admission integration.',
    findings: [{
      id: 'finding-custody',
      requirement: 'The packet must be durably retrievable by a fresh reader.',
      observed: 'The packet is complete and is tested against a disposable private store.',
      required: 'Retain the exact artifact and its identities.',
      consequence: 'A consumer cannot proceed without the durable predecessor.',
      disposition: 'NON_BLOCKING',
      evidence_ids: ['authority-source']
    }],
    qualifications: ['This fixture exercises custody only, not downstream admission.'],
    next_state: 'A parent integration must bind the packet to its semantic consumer.',
    sections: sectionNames.map((name) => ({ name, text: `Disposable authority packet fixture for ${name}.` })),
    evidence_refs: [{ id: 'authority-source', kind: 'GITHUB_COMMENT', source: packetBindings.authority }],
    gate_contract_ir: null
  };
  return { schema: runtime.AUTHORITY_PACKET_SCHEMA_ID, bindings: packetBindings, body, ...overrides.packet };
}

function screening(packetValue) {
  const identities = runtime.authorityPacketIdentities(packetValue);
  return {
    packet_digest: identities.packet_digest,
    decision: 'ALLOW',
    policy_digest: runtime.digestValue('authority-packet-test-policy'),
    retention_policy_digest: runtime.digestValue('authority-packet-test-retention')
  };
}

function webDecision(packetValue, requiredConsumers = packetValue.bindings.applicability.required_consumers) {
  const identities = runtime.authorityPacketIdentities(packetValue);
  return {
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    binding_digest: identities.binding_digest,
    web_source: structuredClone(packetValue.bindings.authority),
    disposition: 'ACCEPTED_FOR_CONSUMPTION',
    permitted_consumers: structuredClone(requiredConsumers),
    applicability: structuredClone(packetValue.bindings.applicability),
    successor_applicability: [],
  };
}

function readers(packetValue, overrides = {}) {
  const packetBindings = packetValue.bindings;
  const producerAuthority = structuredClone(overrides.producer_authority || {
    lane_id: packetBindings.lane_id,
    human_owner: packetBindings.human_owner,
    producer: packetBindings.producer,
  });
  const completionApplicability = overrides.completion_applicability === false ? null : structuredClone(overrides.completion_applicability || {
    schema: 'toolkit.github-program.semantic-completion-applicability.v1',
    scope_digest: packetBindings.applicability.scope_digest,
    candidate: packetBindings.candidate,
    required_consumers: [],
    retain_through_child_finality: false,
    retain_through_candidate_finality: false,
  });
  const baseReadAuthority = overrides.readAuthority || (() => ({
    authority: structuredClone(packetBindings.authority),
    required_consumers: structuredClone(packetBindings.applicability.required_consumers),
    ...(overrides.no_predecessor === true ? { no_predecessor_classification: true } : {}),
    later_controlling_comments: [],
  }));
  const { producer_authority: _producerAuthority, completion_applicability: _completionApplicability, no_predecessor: _noPredecessor, ...readerFunctions } = overrides;
  const result = {
    ...readerFunctions,
    readAuthority: (argument) => {
      const observed = baseReadAuthority(argument);
      if (!observed || typeof observed !== 'object' || Array.isArray(observed)) return observed;
      return {
        ...observed,
        producer_authority: Object.hasOwn(observed, 'producer_authority')
          ? observed.producer_authority : structuredClone(producerAuthority),
        ...(Object.hasOwn(observed, 'completion_applicability') || completionApplicability === null
          ? {} : { completion_applicability: structuredClone(completionApplicability) }),
      };
    },
    screenPacket: overrides.screenPacket || (() => screening(packetValue)),
    readWebDecision: overrides.readWebDecision || (() => webDecision(packetValue)),
  };
  if (overrides.readBackfillSource) result.readBackfillSource = overrides.readBackfillSource;
  ORACLE_READER_SETS.add(result);
  const identities = runtime.authorityPacketIdentities(packetValue);
  const overrideBindings = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => [
    name,
    value === undefined
      ? { type: 'undefined' }
      : typeof value === 'function'
      ? { type: 'function', source_digest: runtime.digestValue(Function.prototype.toString.call(value)) }
      : { type: typeof value, digest: runtime.digestValue(value) },
  ]);
  ORACLE_READER_SET_BINDINGS.set(result, runtime.digestValue({
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    binding_digest: identities.binding_digest,
    reader_names: Object.keys(result).sort(),
    overrides: overrideBindings,
  }));
  return result;
}

function trackOracleAuthorityStore(store) {
  ORACLE_AUTHORITY_PACKET_STORES.add(store);
  for (let harness = activeOracleHarness; harness; harness = harness.parent) {
    harness.storeBaselines.set(store, oracleCounts(store));
    if (harness.objectBaselines) harness.objectBaselines.set(store, receiptEffectSnapshot(store));
  }
  return store;
}

function trackOracleProgrammeReceiptStore(store) {
  ORACLE_PROGRAMME_RECEIPT_STORES.add(store);
  if (!ORACLE_PROGRAMME_RECEIPT_STORE_METHODS.has(store)) {
    const methods = Object.create(null);
    for (const [name, value] of Object.entries(store)) {
      if (typeof value === 'function') methods[name] = value;
    }
    ORACLE_PROGRAMME_RECEIPT_STORE_METHODS.set(store, methods);
  }
  for (let harness = activeOracleHarness; harness; harness = harness.parent) {
    harness.storeBaselines.set(store, oracleCounts(store));
    if (harness.objectBaselines) harness.objectBaselines.set(store, receiptEffectSnapshot(store));
  }
  return store;
}

const RECEIPT_EFFECT_TABLES = Object.freeze({
  allocations: 'allocation_id',
  runs: 'run_id',
  coordination_state: 'singleton',
  lease_events: 'event_id',
  receipts: 'receipt_id',
  mutation_operations: 'operation_id',
  mutation_operation_events: 'event_id',
  authority_packets: 'packet_id',
  authority_packet_events: 'event_id',
  semantic_gate_admissions: 'admission_id',
  semantic_gate_admission_events: 'event_id'
});

function receiptEffectSnapshot(store) {
  const databaseExists = !!store && fs.existsSync(store.databasePath);
  const tables = {};
  for (const [table, identity] of Object.entries(RECEIPT_EFFECT_TABLES)) {
    tables[table] = { count: 0, identity_values: [], rows_digest: runtime.digestValue([]) };
  }
  if (!databaseExists) return { database_exists: false, tables };
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    const known = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
    for (const [table, identity] of Object.entries(RECEIPT_EFFECT_TABLES)) {
      if (!known.has(table)) continue;
      const rows = db.prepare(`SELECT * FROM ${table}`).all().map((row) => ({ ...row }))
        .sort((left, right) => runtime.canonicalSerialize(left).localeCompare(runtime.canonicalSerialize(right)));
      const snapshot = {
        count: rows.length,
        identity_values: rows.map((row) => row[identity]).sort((left, right) => `${left}`.localeCompare(`${right}`)),
        rows_digest: runtime.digestValue(rows),
        row_digests: rows.map((row) => ({ identity: row[identity], digest: runtime.digestValue(row) })),
      };
      if (table === 'authority_packet_events') {
        snapshot.event_proofs = rows.map((row) => {
          let event = null;
          try { event = JSON.parse(row.canonical_json); } catch (_) { /* retained as an invalid proof */ }
          const eventCanonical = event && runtime.canonicalSerialize(event);
          return {
            event_id: row.event_id,
            event_key: row.event_key,
            packet_id: row.packet_id,
            sequence: row.sequence,
            prior_event_id: row.prior_event_id,
            event_type: row.event_type,
            payload_digest: event && event.payload !== undefined ? runtime.digestValue(event.payload) : null,
            event_digest_verified: !!event && eventCanonical === row.canonical_json
              && row.event_id === runtime.digestValue(event)
              && event.packet_id === row.packet_id
              && event.sequence === row.sequence
              && event.prior_event_id === row.prior_event_id
              && event.event_type === row.event_type,
            event_key_verified: !!event && row.event_key === runtime.digestValue({
              schema: event.schema, packet_id: event.packet_id, event_type: event.event_type, payload: event.payload,
            }),
          };
        });
      } else if (table === 'semantic_gate_admission_events') {
        snapshot.event_proofs = rows.map((row) => {
          let event = null;
          try { event = JSON.parse(row.canonical_json); } catch (_) { /* retained as an invalid proof */ }
          return {
            event_id: row.event_id,
            admission_id: row.admission_id,
            sequence: row.sequence,
            prior_event_id: row.prior_event_id,
            event_type: row.event_type,
            transport_evidence_digest: event && event.transport_evidence_digest || null,
            event_digest_verified: !!event && runtime.canonicalSerialize(event) === row.canonical_json
              && row.event_id === runtime.digestValue(event)
              && event.admission_id === row.admission_id
              && event.sequence === row.sequence
              && event.prior_event_id === row.prior_event_id
              && event.event_type === row.event_type,
          };
        });
      }
      tables[table] = snapshot;
    }
    const sidecars = {};
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${store.databasePath}${suffix}`;
      sidecars[suffix] = fs.existsSync(sidecar)
        ? runtime.digestValue(fs.readFileSync(sidecar).toString('base64')) : null;
    }
    return {
      database_exists: true,
      database_bytes_digest: runtime.digestValue(fs.readFileSync(store.databasePath).toString('base64')),
      sidecar_digests: sidecars,
      tables,
    };
  } finally { db.close(); }
}

function verifyNewPacketAcceptance(store, packetId, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !beforeSnapshot || !afterSnapshot || !returned) return { readback: false, acceptance: false };
  const beforeProofs = beforeSnapshot.tables.authority_packet_events.event_proofs || [];
  const afterProofs = afterSnapshot.tables.authority_packet_events.event_proofs || [];
  const beforeIds = new Set(beforeProofs.map((event) => event.event_id));
  const beforePacketEvents = beforeProofs.filter((event) => event.packet_id === packetId);
  const newPacketProofs = afterProofs.filter((event) => event.packet_id === packetId && !beforeIds.has(event.event_id));
  const readbackProofs = newPacketProofs.filter((event) => event.event_type === 'READBACK_VERIFIED');
  const acceptanceProofs = newPacketProofs.filter((event) => event.event_type === 'WEB_ACCEPTANCE_BOUND');
  if (newPacketProofs.length !== 2 || readbackProofs.length !== 1 || acceptanceProofs.length !== 1
    || newPacketProofs.some((event) => !event.event_digest_verified || !event.event_key_verified)) {
    return { readback: false, acceptance: false };
  }
  let rows;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    const packetRow = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
    const eventRows = db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence').all(packetId);
    rows = { packetRow, eventRows };
  } finally { db.close(); }
  if (!rows.packetRow) return { readback: false, acceptance: false };
  let packetValue;
  let events;
  try {
    packetValue = JSON.parse(rows.packetRow.canonical_json);
    events = rows.eventRows.map((row) => ({ row, event: JSON.parse(row.canonical_json) }));
  } catch (_) { return { readback: false, acceptance: false }; }
  const identities = runtime.authorityPacketIdentities(packetValue);
  if (identities.packet_id !== packetId
    || rows.packetRow.packet_digest !== identities.packet_digest
    || rows.packetRow.content_digest !== identities.content_digest
    || rows.packetRow.binding_digest !== identities.binding_digest
    || rows.packetRow.canonical_json !== identities.canonical_packet_bytes) {
    return { readback: false, acceptance: false };
  }
  const previousEvents = beforePacketEvents.slice().sort((left, right) => left.sequence - right.sequence);
  const previous = previousEvents.length ? previousEvents[previousEvents.length - 1] : null;
  const newEvents = events.filter(({ row }) => !beforeIds.has(row.event_id));
  if (newEvents.length !== 2) return { readback: false, acceptance: false };
  const expectedSequence = previous ? previous.sequence + 1 : 1;
  let priorId = previous ? previous.event_id : null;
  for (const [index, { row, event }] of newEvents.entries()) {
    if (row.sequence !== expectedSequence + index || row.prior_event_id !== priorId
      || event.sequence !== row.sequence || event.prior_event_id !== priorId
      || row.event_id !== runtime.digestValue(event)
      || row.event_key !== runtime.digestValue({
        schema: event.schema, packet_id: event.packet_id, event_type: event.event_type, payload: event.payload,
      })) return { readback: false, acceptance: false };
    priorId = row.event_id;
  }
  const readback = newEvents.find(({ event }) => event.event_type === 'READBACK_VERIFIED');
  const acceptance = newEvents.find(({ event }) => event.event_type === 'WEB_ACCEPTANCE_BOUND');
  if (!readback || !acceptance || readback.event.sequence >= acceptance.event.sequence) {
    return { readback: false, acceptance: false };
  }
  const readbackPayload = readback.event.payload;
  const expectedReadbackKeys = ['challenge', 'namespace_digest', 'runtime_identity_digest', 'store_identity_digest'];
  const readbackIsExact = runtime.canonicalSerialize(Object.keys(readbackPayload).sort())
      === runtime.canonicalSerialize(expectedReadbackKeys)
    && /^[a-f0-9]{64}$/.test(readbackPayload.challenge)
    && readbackPayload.namespace_digest === runtime.digestValue({ schema: runtime.SCHEMA_ID, ...store.namespace })
    && readbackPayload.store_identity_digest === store.storeIdentityDigest()
    && readbackPayload.runtime_identity_digest === runtime.authorityPacketRuntimeIdentity().runtime_identity_digest;
  const decision = webDecision(packetValue, packetValue.bindings.applicability.required_consumers);
  const expectedAcceptance = {
    schema: runtime.AUTHORITY_PACKET_ACCEPTANCE_SCHEMA_ID,
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    binding_digest: identities.binding_digest,
    web_source: decision.web_source,
    disposition: decision.disposition,
    permitted_consumers: decision.permitted_consumers,
    applicability: decision.applicability,
    successor_applicability: decision.successor_applicability,
    readback_event_id: readback.row.event_id,
  };
  const acceptanceIsExact = runtime.canonicalSerialize(acceptance.event.payload) === runtime.canonicalSerialize(expectedAcceptance)
    && runtime.canonicalSerialize(returned.acceptance) === runtime.canonicalSerialize(expectedAcceptance)
    && returned.acceptance_event_id === acceptance.row.event_id;
  return { readback: readbackIsExact, acceptance: readbackIsExact && acceptanceIsExact };
}

function verifyNewPacketReadback(store, packetId, beforeSnapshot, afterSnapshot) {
  if (!store || !beforeSnapshot || !afterSnapshot) return false;
  const beforeProofs = beforeSnapshot.tables.authority_packet_events?.event_proofs || [];
  const afterProofs = afterSnapshot.tables.authority_packet_events?.event_proofs || [];
  const beforeIds = new Set(beforeProofs.map((event) => event.event_id));
  const priorPacketEvents = beforeProofs.filter((event) => event.packet_id === packetId);
  const newPacketEvents = afterProofs.filter((event) => event.packet_id === packetId && !beforeIds.has(event.event_id));
  if (newPacketEvents.length !== 1 || newPacketEvents[0].event_type !== 'READBACK_VERIFIED'
    || !newPacketEvents[0].event_digest_verified || !newPacketEvents[0].event_key_verified) return false;
  let packetRow;
  let eventRows;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    packetRow = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
    eventRows = db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence').all(packetId);
  } finally { db.close(); }
  if (!packetRow || !Array.isArray(eventRows)) return false;
  let packetValue;
  let events;
  try {
    packetValue = JSON.parse(packetRow.canonical_json);
    events = eventRows.map((row) => ({ row, event: JSON.parse(row.canonical_json) }));
  } catch (_) { return false; }
  let identities;
  try { identities = runtime.authorityPacketIdentities(packetValue); } catch (_) { return false; }
  if (identities.packet_id !== packetId || packetRow.packet_digest !== identities.packet_digest
    || packetRow.content_digest !== identities.content_digest || packetRow.binding_digest !== identities.binding_digest
    || packetRow.canonical_json !== identities.canonical_packet_bytes) return false;
  const prior = priorPacketEvents.sort((left, right) => left.sequence - right.sequence).at(-1) || null;
  const readbacks = events.filter(({ event }) => event.event_type === 'READBACK_VERIFIED');
  if (readbacks.length !== (priorPacketEvents.filter((event) => event.event_type === 'READBACK_VERIFIED').length + 1)) return false;
  const newEvent = events.find(({ row }) => row.event_id === newPacketEvents[0].event_id);
  if (!newEvent || newEvent.row.sequence !== (prior ? prior.sequence + 1 : 1)
    || newEvent.row.prior_event_id !== (prior ? prior.event_id : null)
    || newEvent.event.sequence !== newEvent.row.sequence
    || newEvent.event.prior_event_id !== newEvent.row.prior_event_id
    || newEvent.row.event_id !== runtime.digestValue(newEvent.event)
    || newEvent.row.event_key !== runtime.digestValue({
      schema: newEvent.event.schema,
      packet_id: newEvent.event.packet_id,
      event_type: newEvent.event.event_type,
      payload: newEvent.event.payload,
    })) return false;
  const payload = newEvent.event.payload;
  const expectedKeys = ['challenge', 'namespace_digest', 'runtime_identity_digest', 'store_identity_digest'];
  return newEvent.event.packet_id === packetId && newEvent.event.event_type === 'READBACK_VERIFIED'
    && runtime.canonicalSerialize(Object.keys(payload).sort()) === runtime.canonicalSerialize(expectedKeys)
    && /^[a-f0-9]{64}$/.test(payload.challenge)
    && payload.namespace_digest === runtime.digestValue({ schema: runtime.SCHEMA_ID, ...store.namespace })
    && payload.store_identity_digest === store.storeIdentityDigest()
    && payload.runtime_identity_digest === runtime.authorityPacketRuntimeIdentity().runtime_identity_digest;
}

function verifyBackfillWitness(store, packetValue, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !packetValue || !returned || !beforeSnapshot || !afterSnapshot) return false;
  const identities = runtime.authorityPacketIdentities(packetValue);
  if (returned.packet_id !== identities.packet_id || returned.packet_digest !== identities.packet_digest
    || returned.content_digest !== identities.content_digest || returned.binding_digest !== identities.binding_digest
    || returned.producer_key !== identities.producer_key
    || runtime.canonicalSerialize(returned.packet) !== identities.canonical_packet_bytes) return false;
  const beforeProofs = beforeSnapshot.tables.authority_packet_events?.event_proofs || [];
  const afterProofs = afterSnapshot.tables.authority_packet_events?.event_proofs || [];
  const beforeIds = new Set(beforeProofs.map((event) => event.event_id));
  const priorPacketEvents = beforeProofs.filter((event) => event.packet_id === identities.packet_id);
  const newPacketEvents = afterProofs.filter((event) => event.packet_id === identities.packet_id && !beforeIds.has(event.event_id))
    .sort((left, right) => left.sequence - right.sequence);
  if (newPacketEvents.length !== 2
    || newPacketEvents[0].event_type !== 'READBACK_VERIFIED'
    || newPacketEvents[1].event_type !== 'BACKFILL_AUTHORISED'
    || newPacketEvents.some((event) => !event.event_digest_verified || !event.event_key_verified)) return false;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let packetRow;
  let eventRows;
  try {
    packetRow = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(identities.packet_id);
    eventRows = db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence').all(identities.packet_id);
  } finally { db.close(); }
  if (!packetRow || packetRow.packet_digest !== identities.packet_digest
    || packetRow.content_digest !== identities.content_digest || packetRow.binding_digest !== identities.binding_digest
    || packetRow.producer_key !== identities.producer_key || packetRow.canonical_json !== identities.canonical_packet_bytes
    || !Array.isArray(eventRows)) return false;
  let eventValues;
  try { eventValues = eventRows.map((row) => ({ row, event: JSON.parse(row.canonical_json) })); } catch (_) { return false; }
  const readback = eventValues.find(({ row }) => row.event_id === returned.readback_event_id);
  const backfill = eventValues.find(({ row }) => row.event_id === returned.backfill_event_id);
  if (!readback || !backfill || readback.event.event_type !== 'READBACK_VERIFIED'
    || backfill.event.event_type !== 'BACKFILL_AUTHORISED'
    || readback.row.sequence !== (priorPacketEvents.at(-1)?.sequence || 0) + 1
    || backfill.row.sequence !== readback.row.sequence + 1
    || backfill.row.prior_event_id !== readback.row.event_id) return false;
  const readbackPayload = readback.event.payload;
  const readbackKeys = ['challenge', 'namespace_digest', 'runtime_identity_digest', 'store_identity_digest'];
  const expectedBackfill = {
    authority_ref: packetValue.bindings.authority,
    source_ref: sourceReference('backfill-source'),
    source_packet_digest: identities.packet_digest,
    source_binding_digest: identities.binding_digest,
  };
  return runtime.canonicalSerialize(Object.keys(readbackPayload).sort()) === runtime.canonicalSerialize(readbackKeys)
    && /^[a-f0-9]{64}$/.test(readbackPayload.challenge)
    && readbackPayload.namespace_digest === runtime.digestValue({ schema: runtime.SCHEMA_ID, ...store.namespace })
    && readbackPayload.store_identity_digest === store.storeIdentityDigest()
    && readbackPayload.runtime_identity_digest === runtime.authorityPacketRuntimeIdentity().runtime_identity_digest
    && runtime.canonicalSerialize(backfill.event.payload) === runtime.canonicalSerialize(expectedBackfill)
    && returned.backfill_duplicate === false;
}

function verifyAcceptanceReplay(store, packetId, returned, readerSet, beforeSnapshot, afterSnapshot) {
  if (!store || !returned || returned.duplicate !== true || !readerSet
    || !beforeSnapshot || !afterSnapshot
    || runtime.canonicalSerialize(beforeSnapshot) !== runtime.canonicalSerialize(afterSnapshot)) return false;
  const proofs = afterSnapshot.tables.authority_packet_events?.event_proofs || [];
  const packetProofs = proofs.filter((event) => event.packet_id === packetId);
  const readbacks = packetProofs.filter((event) => event.event_type === 'READBACK_VERIFIED');
  const acceptances = packetProofs.filter((event) => event.event_type === 'WEB_ACCEPTANCE_BOUND');
  if (readbacks.length !== 1 || acceptances.length !== 1
    || packetProofs.length !== 2
    || packetProofs.some((event) => !event.event_digest_verified || !event.event_key_verified)) return false;
  let packetRow;
  let eventRows;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    packetRow = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
    eventRows = db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence').all(packetId);
  } finally { db.close(); }
  if (!packetRow || eventRows.length !== 2) return false;
  let packetValue;
  let eventValues;
  try {
    packetValue = JSON.parse(packetRow.canonical_json);
    eventValues = eventRows.map((row) => ({ row, event: JSON.parse(row.canonical_json) }));
  } catch (_) { return false; }
  const identities = runtime.authorityPacketIdentities(packetValue);
  if (identities.packet_id !== packetId || packetRow.packet_digest !== identities.packet_digest
    || packetRow.content_digest !== identities.content_digest || packetRow.binding_digest !== identities.binding_digest
    || packetRow.canonical_json !== identities.canonical_packet_bytes) return false;
  let priorId = null;
  for (const [index, { row, event }] of eventValues.entries()) {
    if (row.sequence !== index + 1 || row.prior_event_id !== priorId
      || event.sequence !== row.sequence || event.prior_event_id !== priorId
      || row.event_id !== runtime.digestValue(event)
      || row.event_key !== runtime.digestValue({ schema: event.schema, packet_id: event.packet_id, event_type: event.event_type, payload: event.payload })) return false;
    priorId = row.event_id;
  }
  const readback = eventValues[0].event;
  const acceptance = eventValues[1].event;
  if (readback.event_type !== 'READBACK_VERIFIED' || acceptance.event_type !== 'WEB_ACCEPTANCE_BOUND') return false;
  const expectedAcceptance = webDecision(packetValue, packetValue.bindings.applicability.required_consumers);
  expectedAcceptance.schema = runtime.AUTHORITY_PACKET_ACCEPTANCE_SCHEMA_ID;
  expectedAcceptance.readback_event_id = eventValues[0].row.event_id;
  return runtime.canonicalSerialize(acceptance.payload) === runtime.canonicalSerialize(expectedAcceptance)
    && runtime.canonicalSerialize(returned.acceptance) === runtime.canonicalSerialize(expectedAcceptance)
    && returned.acceptance_event_id === eventValues[1].row.event_id;
}

function independentStoreIdentity(databasePath, namespace) {
  if (typeof databasePath !== 'string' || !namespace) return null;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const metadata = db.prepare(
      'SELECT schema_id, namespace_digest, repository, parent_issue, child_issue, schema_fingerprint, created_at FROM metadata WHERE singleton = 1'
    ).get();
    if (!metadata || metadata.namespace_digest !== runtime.namespaceDigest(namespace)
      || metadata.schema_fingerprint !== runtime.expectedAuthorityPacketSchemaFingerprint()) return null;
    const applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
    return runtime.digestValue({
      database_realpath_digest: runtime.digestValue(fs.realpathSync.native(databasePath)),
      namespace,
      application_id: applicationId,
      metadata_creation_identity: metadata,
      schema_fingerprint: metadata.schema_fingerprint,
    });
  } finally { db.close(); }
}

function verifyStoreIdentityIndependently(optionsOrStore, returnedDigest) {
  try {
    const store = optionsOrStore && typeof optionsOrStore.databasePath === 'string' ? optionsOrStore : null;
    const namespace = store ? store.namespace : {
      repository: optionsOrStore.repository,
      parent_issue: optionsOrStore.parent_issue,
      child_issue: optionsOrStore.child_issue,
    };
    const databasePath = store ? store.databasePath : path.join(
      path.resolve(optionsOrStore.stateRoot),
      `github-program-receipt-${runtime.namespaceDigest(namespace)}.sqlite`,
    );
    const expected = independentStoreIdentity(databasePath, namespace);
    const passed = /^[a-f0-9]{64}$/.test(returnedDigest || '') && expected === returnedDigest;
    recordOracleHarnessReadback({
      kind: 'store-identity',
      database_path_digest: runtime.digestValue(databasePath),
      namespace_digest: runtime.namespaceDigest(namespace),
      observed_identity_digest: typeof returnedDigest === 'string' ? returnedDigest : null,
      independently_computed_identity_digest: expected,
      passed,
    });
    return passed;
  } catch (_) {
    recordOracleHarnessReadback({ kind: 'store-identity', passed: false });
    return false;
  }
}

function verifyPrivateAuthorityStore(store, optionsValue, readersValue) {
  let stage = 'inputs';
  let checks = {};
  try {
    checks.input_store_authentic = !!store && runtime.assertAuthenticAuthorityPacketStore(store) === true;
    checks.input_namespace_present = !!(store && store.namespace);
    checks.input_options_present = !!optionsValue;
    checks.input_reader_set_authentic = !!readersValue && ORACLE_READER_SETS.has(readersValue);
    if (!checks.input_store_authentic || !checks.input_namespace_present
      || !checks.input_options_present || !checks.input_reader_set_authentic) {
      recordOracleHarnessReadback({ kind: 'store-reopen', stage, checks, passed: false });
      return false;
    }
    const expectedDatabasePath = path.join(
      path.resolve(optionsValue.stateRoot),
      `github-program-receipt-${runtime.namespaceDigest(store.namespace)}.sqlite`,
    );
    stage = 'initial-identity';
    const before = receiptEffectSnapshot(store);
    const identity = store.storeIdentityDigest();
    const independentIdentity = independentStoreIdentity(store.databasePath, store.namespace);
    checks.database_path_matches = path.resolve(store.databasePath) === path.resolve(expectedDatabasePath);
    checks.initial_identity_matches = independentIdentity === identity;
    checks.namespace_matches_options = runtime.canonicalSerialize(store.namespace) === runtime.canonicalSerialize({
      repository: optionsValue.repository, parent_issue: optionsValue.parent_issue, child_issue: optionsValue.child_issue,
    });
    if (!checks.database_path_matches || !checks.initial_identity_matches || !checks.namespace_matches_options) {
      recordOracleHarnessReadback({ kind: 'store-reopen', stage, checks, passed: false });
      return false;
    }
    stage = 'reopen';
    const reopened = runtime.initialiseAuthorityPacketStore(optionsValue, readersValue);
    const reopenIdentity = independentStoreIdentity(reopened.databasePath, reopened.namespace);
    const after = receiptEffectSnapshot(store);
    stage = 'database-readback';
    const db = new DatabaseSync(store.databasePath, { readOnly: true });
    let metadata;
    let packetCount;
    let admissionCount;
    let eventCount;
    try {
      metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
      packetCount = db.prepare('SELECT COUNT(*) AS n FROM authority_packets').get().n;
      admissionCount = db.prepare('SELECT COUNT(*) AS n FROM semantic_gate_admissions').get().n;
      eventCount = db.prepare('SELECT COUNT(*) AS n FROM authority_packet_events').get().n;
    } finally { db.close(); }
    checks.metadata_namespace_matches = metadata.repository === store.namespace.repository
      && metadata.parent_issue === store.namespace.parent_issue && metadata.child_issue === store.namespace.child_issue
      && metadata.namespace_digest === runtime.namespaceDigest(store.namespace);
    checks.metadata_schema_matches = metadata.schema_fingerprint === runtime.expectedAuthorityPacketSchemaFingerprint();
    checks.authority_rows_match_snapshot = packetCount === before.tables.authority_packets.count
      && admissionCount === before.tables.semantic_gate_admissions.count
      && eventCount === before.tables.authority_packet_events.count;
    checks.reopened_store_authentic = runtime.assertAuthenticAuthorityPacketStore(reopened) === true;
    checks.reopened_identity_matches = reopenIdentity === identity;
    checks.snapshot_unchanged = runtime.canonicalSerialize(before) === runtime.canonicalSerialize(after);
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({
      kind: 'store-reopen',
      store_identity_digest: identity,
      reopened_identity_digest: reopenIdentity,
      stage,
      checks,
      passed,
    });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({ kind: 'store-reopen', stage, checks, error_code: error && error.code || error && error.name || 'ERROR', passed: false });
    return false;
  }
}

function verifyMutationAdmissionWitness(store, session, descriptor, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !session || !descriptor || !ORACLE_MUTATION_ADMISSIONS.has(returned)
    || !beforeSnapshot || !afterSnapshot) return false;
  const beforeOperations = beforeSnapshot.tables.mutation_operations;
  const afterOperations = afterSnapshot.tables.mutation_operations;
  const beforeEvents = beforeSnapshot.tables.mutation_operation_events;
  const afterEvents = afterSnapshot.tables.mutation_operation_events;
  if (!beforeOperations || !afterOperations || !beforeEvents || !afterEvents
    || afterOperations.count !== beforeOperations.count + 1) return false;
  const beforeOperationIds = new Set(beforeOperations.identity_values);
  const expectedLogicalDigest = runtime.digestValue({
    operation_kind: descriptor.operation_kind,
    safety_class: descriptor.safety_class,
    target_identity: descriptor.target_identity,
    target_digest: descriptor.target_digest,
    expected_post_state_digest: descriptor.expected_post_state_digest,
    adapter_identity_digest: descriptor.adapter_identity_digest,
  });
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let operation;
  let allocation;
  let events;
  try {
    allocation = db.prepare('SELECT * FROM allocations WHERE run_id = ?').get(session.run_id);
    const operations = db.prepare('SELECT * FROM mutation_operations WHERE logical_operation_digest = ?').all(expectedLogicalDigest);
    operation = operations.find((row) => row.run_id === session.run_id && !beforeOperationIds.has(row.operation_id));
    if (operation) events = db.prepare('SELECT * FROM mutation_operation_events WHERE operation_id = ? ORDER BY sequence').all(operation.operation_id);
  } finally { db.close(); }
  if (!allocation || !operation || !Array.isArray(events) || events.length !== 2
    || afterEvents.count !== beforeEvents.count + 2
    || operation.operation_id !== `operation-${operation.operation_id.slice('operation-'.length)}`
    || operation.run_id !== session.run_id || operation.allocation_id !== session.allocation_id
    || operation.lock_id !== session.lock || operation.lease_id !== session.lease.lease_id
    || operation.fence_id !== session.lease.fence_id || operation.fence_sequence !== session.lease.fence_sequence
    || operation.authority_digest !== runtime.digestValue(JSON.parse(allocation.authority_json))
    || operation.operation_kind !== descriptor.operation_kind || operation.safety_class !== descriptor.safety_class
    || operation.target_identity_json !== runtime.canonicalSerialize(descriptor.target_identity)
    || operation.target_digest !== descriptor.target_digest || operation.source_digest !== descriptor.expected_source_digest
    || operation.cas_digest !== descriptor.cas_digest
    || operation.expected_post_state_digest !== descriptor.expected_post_state_digest
    || operation.provider_operation_key !== `gpr:${operation.operation_id}`
    || operation.adapter_identity_digest !== descriptor.adapter_identity_digest
    || operation.retry_of_operation_id !== descriptor.retry_of_operation_id) return false;
  const operationPayload = {
    operation_id: operation.operation_id,
    logical_operation_digest: operation.logical_operation_digest,
    run_id: operation.run_id,
    allocation_id: operation.allocation_id,
    lock_id: operation.lock_id,
    authority_digest: operation.authority_digest,
    lease_id: operation.lease_id,
    fence_id: operation.fence_id,
    fence_sequence: operation.fence_sequence,
    operation_kind: operation.operation_kind,
    safety_class: operation.safety_class,
    target_identity_json: operation.target_identity_json,
    target_digest: operation.target_digest,
    source_digest: operation.source_digest,
    cas_digest: operation.cas_digest,
    expected_post_state_digest: operation.expected_post_state_digest,
    provider_operation_key: operation.provider_operation_key,
    adapter_identity_digest: operation.adapter_identity_digest,
    retry_of_operation_id: operation.retry_of_operation_id,
    created_at: operation.created_at,
  };
  if (operation.operation_digest !== runtime.digestValue(operationPayload)) return false;
  let priorEventId = null;
  for (const [index, event] of events.entries()) {
    const eventType = index === 0 ? 'PREPARED' : 'IN_FLIGHT';
    const payload = {
      event_id: event.event_id,
      operation_id: event.operation_id,
      sequence: event.sequence,
      prior_event_id: event.prior_event_id,
      event_type: event.event_type,
      state: event.state,
      event_at: event.event_at,
      authority_digest: event.authority_digest,
      provider_evidence_digest: event.provider_evidence_digest,
      readback_digest: event.readback_digest,
      detail_digest: event.detail_digest,
    };
    if (event.sequence !== index + 1 || event.prior_event_id !== priorEventId
      || event.event_type !== eventType || event.state !== eventType
      || event.authority_digest !== operation.authority_digest || event.readback_digest !== null
      || event.provider_evidence_digest !== runtime.digestValue({ event_type: eventType, state: eventType })
      || event.detail_digest !== runtime.digestValue({ event_type: eventType, state: eventType })
      || event.event_digest !== runtime.digestValue(payload)) return false;
    priorEventId = event.event_id;
  }
  return true;
}

function receiptTableDelta(beforeSnapshot, afterSnapshot, table) {
  const before = beforeSnapshot && beforeSnapshot.tables && beforeSnapshot.tables[table];
  const after = afterSnapshot && afterSnapshot.tables && afterSnapshot.tables[table];
  return before && after ? after.count - before.count : null;
}

function verifyProgrammeAllocationWitness(store, input, returned, beforeSnapshot, afterSnapshot) {
  const checks = {};
  if (returned && returned.status === 'PENDING_AUTHORITY_PREFLIGHT') {
    checks.pending_session_shape = runtime.canonicalSerialize(Object.keys(returned).sort()) === runtime.canonicalSerialize(['status'])
      && !Object.hasOwn(input || {}, 'semantic_gate');
    checks.no_durable_allocation = !!beforeSnapshot && !!afterSnapshot
      && runtime.canonicalSerialize(beforeSnapshot) === runtime.canonicalSerialize(afterSnapshot);
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'programme-allocation-preflight', status: returned.status, checks, passed });
    return passed;
  }
  if (!store || !input || !returned || !beforeSnapshot || !afterSnapshot) return false;
  let db;
  try {
    db = new DatabaseSync(store.databasePath, { readOnly: true });
    const allocation = db.prepare('SELECT * FROM allocations WHERE allocation_id = ?').get(returned.allocation_id);
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(returned.run_id);
    const leaseEvents = db.prepare('SELECT * FROM lease_events WHERE allocation_id = ? ORDER BY fence_sequence, event_at, event_id').all(returned.allocation_id);
    const prior = allocation && db.prepare('SELECT allocation_id, fence_sequence FROM allocations WHERE fence_sequence < ? ORDER BY fence_sequence DESC LIMIT 1').get(allocation.fence_sequence) || null;
    checks.one_allocation = receiptTableDelta(beforeSnapshot, afterSnapshot, 'allocations') === 1;
    checks.one_run = receiptTableDelta(beforeSnapshot, afterSnapshot, 'runs') === 1;
    checks.one_lease_event = receiptTableDelta(beforeSnapshot, afterSnapshot, 'lease_events') === 1 && leaseEvents.length === 1;
    checks.no_receipt_yet = receiptTableDelta(beforeSnapshot, afterSnapshot, 'receipts') === 0;
    checks.input_authority_exact = !!allocation && allocation.authority_json === runtime.canonicalSerialize(input.authority);
    checks.input_start_exact = !!allocation && allocation.start_json === runtime.canonicalSerialize(input.start);
    checks.allocation_digest_exact = !!allocation && allocation.allocation_digest === runtime.digestValue({
      allocation_id: allocation.allocation_id,
      run_id: allocation.run_id,
      lock: allocation.lock_id,
      lease_id: allocation.lease_id,
      fence_id: allocation.fence_id,
      fence_sequence: allocation.fence_sequence,
      owner_instance_id: allocation.owner_instance_id,
      process_id: allocation.process_id,
      issued_at: allocation.issued_at,
      expires_at: allocation.expires_at,
      authority: JSON.parse(allocation.authority_json),
      start: JSON.parse(allocation.start_json),
    });
    const authorityDigest = allocation && runtime.digestValue(JSON.parse(allocation.authority_json));
    const startDigest = allocation && runtime.digestValue(JSON.parse(allocation.start_json));
    const expectedRun = allocation && {
      run_id: allocation.run_id,
      allocation_id: allocation.allocation_id,
      lock: allocation.lock_id,
      authority_digest: authorityDigest,
      start_digest: startDigest,
    };
    checks.run_exact = !!run && run.run_id === allocation.run_id && run.allocation_id === allocation.allocation_id
      && run.lock_id === allocation.lock_id && run.authority_digest === authorityDigest
      && run.start_digest === startDigest && run.run_digest === runtime.digestValue(expectedRun);
    const leaseEvent = leaseEvents[0];
    const eventPayload = leaseEvent && {
      event_id: leaseEvent.event_id,
      allocation_id: leaseEvent.allocation_id,
      event_type: leaseEvent.event_type,
      fence_sequence: leaseEvent.fence_sequence,
      event_at: leaseEvent.event_at,
      detail_digest: leaseEvent.detail_digest,
    };
    const eventDetail = {
      prior_allocation_id: prior ? prior.allocation_id : null,
      prior_fence_sequence: prior ? prior.fence_sequence : null,
    };
    checks.lease_event_exact = !!leaseEvent && leaseEvent.event_at === allocation.issued_at
      && leaseEvent.event_type === (prior ? 'EXPIRED_TAKEOVER' : 'ALLOCATED')
      && leaseEvent.fence_sequence === allocation.fence_sequence
      && leaseEvent.detail_digest === runtime.digestValue(eventDetail)
      && leaseEvent.event_digest === runtime.digestValue(eventPayload);
    const publicSession = allocation && {
      allocation_id: allocation.allocation_id,
      run_id: allocation.run_id,
      lock: allocation.lock_id,
      lease: {
        lease_id: allocation.lease_id,
        fence_id: allocation.fence_id,
        fence_sequence: allocation.fence_sequence,
        issued_at: allocation.issued_at,
        expires_at: allocation.expires_at,
      },
      started: false,
    };
    checks.returned_session_exact = !!allocation && runtime.canonicalSerialize(returned) === runtime.canonicalSerialize(publicSession);
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({
      kind: 'programme-allocation',
      allocation_id: allocation && allocation.allocation_id,
      run_id: allocation && allocation.run_id,
      checks,
      passed,
    });
    return passed;
  } catch (_) {
    recordOracleHarnessReadback({ kind: 'programme-allocation', checks, passed: false });
    return false;
  } finally {
    if (db) db.close();
  }
}

function programmeReceiptStateFacts(db) {
  const counts = {};
  for (const table of ['allocations', 'runs', 'receipts', 'lease_events', 'mutation_operations', 'mutation_operation_events']) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value;
  }
  const latestAllocation = db.prepare('SELECT allocation_id, run_id, fence_sequence, allocation_digest FROM allocations ORDER BY fence_sequence DESC LIMIT 1').get() || null;
  const receiptHeads = db.prepare(`
    SELECT r.run_id, r.receipt_id, r.sequence, r.receipt_digest
    FROM receipts r
    WHERE r.sequence = (SELECT MAX(inner_receipt.sequence) FROM receipts inner_receipt WHERE inner_receipt.run_id = r.run_id)
    ORDER BY r.run_id
  `).all();
  const operationHeads = db.prepare(`
    SELECT o.operation_id, o.operation_digest, e.state, e.event_digest, e.sequence
    FROM mutation_operations o
    JOIN mutation_operation_events e ON e.operation_id = o.operation_id
    WHERE e.sequence = (SELECT MAX(inner_event.sequence) FROM mutation_operation_events inner_event WHERE inner_event.operation_id = o.operation_id)
    ORDER BY o.operation_id
  `).all();
  const leaseHead = db.prepare('SELECT event_id, event_digest, fence_sequence FROM lease_events ORDER BY fence_sequence DESC, event_at DESC, event_id DESC LIMIT 1').get() || null;
  return {
    high_water: db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water,
    counts,
    latest_allocation: latestAllocation,
    receipt_heads: receiptHeads,
    lease_head: leaseHead,
    operation_heads: operationHeads,
  };
}

function verifyProgrammeStartedRunProcess(store, value, allocation, receipt, chain, metadata) {
  const checks = {};
  let db;
  try {
    const executable = fs.realpathSync.native(process.execPath);
    const runtimePath = fs.realpathSync.native(path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs'));
    const serializationPath = fs.realpathSync.native(path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-execution-loop.cjs'));
    const shaFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const runtimeIdentity = {
      node_executable_realpath_digest: runtime.digestValue(executable),
      node_executable_digest: shaFile(executable),
      runtime_realpath_digest: runtime.digestValue(runtimePath),
      runtime_digest: shaFile(runtimePath),
      serialization_realpath_digest: runtime.digestValue(serializationPath),
      serialization_digest: shaFile(serializationPath),
      node_version: process.versions.node,
    };
    const runtimeIdentityDigest = runtime.digestValue(runtimeIdentity);
    const namespace = {
      repository: metadata.repository,
      parent_issue: metadata.parent_issue,
      child_issue: metadata.child_issue,
    };
    db = new DatabaseSync(store.databasePath, { readOnly: true });
    const packetMetadata = db.prepare('SELECT schema_id, namespace_digest, repository, parent_issue, child_issue, schema_fingerprint, created_at FROM metadata WHERE singleton = 1').get();
    const stateDigest = runtime.digestValue(programmeReceiptStateFacts(db));
    const storeIdentityDigest = runtime.digestValue({
      database_realpath_digest: runtime.digestValue(fs.realpathSync.native(store.databasePath)),
      metadata: packetMetadata,
    });
    db.close();
    db = null;
    const expected = {
      schema: 'toolkit.github-program.run-started-verification.v1',
      run_id: value.run_id,
      allocation_id: value.allocation_id,
      receipt_id: receipt.receipt_id,
      receipt_sequence: 1,
      namespace_digest: runtime.namespaceDigest(namespace),
      authority_digest: runtime.digestValue(JSON.parse(allocation.authority_json)),
      start_digest: runtime.digestValue(JSON.parse(allocation.start_json)),
      lease_id: allocation.lease_id,
      fence_id: allocation.fence_id,
      fence_sequence: allocation.fence_sequence,
      chain_digest: runtime.digestValue(chain),
      store_state_digest: stateDigest,
      store_identity_digest: storeIdentityDigest,
      node_executable_realpath_digest: runtimeIdentity.node_executable_realpath_digest,
      runtime_identity_digest: runtimeIdentityDigest,
      node_version: process.versions.node,
    };
    expected.packet_digest = runtime.digestValue(expected);
    const argv = [
      '--no-warnings', runtimePath, 'verify-run-started',
      '--repository', metadata.repository,
      '--parent-issue', String(metadata.parent_issue),
      '--child-issue', String(metadata.child_issue),
      '--state-root', path.dirname(store.databasePath),
      '--repository-root', repositoryRoot,
      '--run-id', value.run_id,
      '--allocation-id', value.allocation_id,
      '--receipt-id', receipt.receipt_id,
    ];
    const env = { ...process.env };
    const nodeInjectionKeys = new Set(['NODE_OPTIONS', 'NODE_PATH', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_REPL_EXTERNAL_MODULE', 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE']);
    for (const key of Object.keys(env)) if (nodeInjectionKeys.has(key.toUpperCase())) delete env[key];
    const processResult = spawnSync(executable, argv, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env,
      shell: false,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 65536,
    });
    const stdout = processResult && typeof processResult.stdout === 'string' ? processResult.stdout : '';
    const stderr = processResult && typeof processResult.stderr === 'string' ? processResult.stderr : '';
    const oneJsonLine = stdout.endsWith('\n') && !stdout.slice(0, -1).includes('\n');
    let packet = null;
    if (oneJsonLine) {
      try { packet = JSON.parse(stdout.slice(0, -1)); } catch (_) { packet = null; }
    }
    const expectedKeys = [
      'schema', 'run_id', 'allocation_id', 'receipt_id', 'receipt_sequence', 'namespace_digest',
      'authority_digest', 'start_digest', 'lease_id', 'fence_id', 'fence_sequence', 'chain_digest',
      'store_state_digest', 'store_identity_digest', 'node_executable_realpath_digest',
      'runtime_identity_digest', 'node_version', 'packet_digest',
    ].sort();
    checks.process_completed = !!processResult && !processResult.error && processResult.signal === null && processResult.status === 0;
    checks.process_streams_bounded = Buffer.byteLength(stdout, 'utf8') <= 65536 && Buffer.byteLength(stderr, 'utf8') <= 65536;
    checks.stderr_empty = stderr === '';
    checks.one_json_line = oneJsonLine;
    checks.packet_shape_exact = !!packet && runtime.canonicalSerialize(Object.keys(packet).sort()) === runtime.canonicalSerialize(expectedKeys);
    checks.packet_matches_independent_state = !!packet && runtime.canonicalSerialize(packet) === runtime.canonicalSerialize(expected);
    checks.packet_digest_valid = !!packet && packet.packet_digest === runtime.digestValue(Object.fromEntries(Object.entries(packet).filter(([key]) => key !== 'packet_digest')));
    checks.stdout_canonical = !!packet && stdout === `${runtime.canonicalSerialize(packet)}\n`;
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({
      kind: 'programme-start-process-readback',
      process: {
        pid: processResult && processResult.pid || null,
        executable_realpath_digest: runtime.digestValue(executable),
        runtime_realpath_digest: runtime.digestValue(runtimePath),
        arguments: argv,
        arguments_digest: runtime.digestValue(argv),
        status: processResult && processResult.status,
        signal: processResult && processResult.signal,
        error_code: processResult && processResult.error && processResult.error.code || null,
        stdout_bytes: Buffer.byteLength(stdout, 'utf8'),
        stdout_digest: runtime.digestValue(stdout),
        stderr_bytes: Buffer.byteLength(stderr, 'utf8'),
        stderr_digest: runtime.digestValue(stderr),
      },
      decoded_packet: packet,
      checks,
      passed,
    });
    return passed;
  } catch (error) {
    if (db) db.close();
    recordOracleHarnessReadback({
      kind: 'programme-start-process-readback',
      error_code: error && error.code || error && error.name || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

function verifyProgrammeStartedRunWitness(store, returned, method, beforeSnapshot, afterSnapshot) {
  const checks = {};
  if (!store || !returned || !beforeSnapshot || !afterSnapshot) return false;
  let db;
  try {
    db = new DatabaseSync(store.databasePath, { readOnly: true });
    const allocation = db.prepare('SELECT * FROM allocations WHERE allocation_id = ?').get(returned.allocation_id);
    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(returned.run_id);
    const receiptRow = db.prepare('SELECT * FROM receipts WHERE receipt_id = ? AND run_id = ?').get(returned.run_started_receipt_id, returned.run_id);
    const metadata = db.prepare('SELECT repository, parent_issue, child_issue FROM metadata WHERE singleton = 1').get();
    const authority = allocation && JSON.parse(allocation.authority_json);
    const start = allocation && JSON.parse(allocation.start_json);
    const authorityDigest = allocation && runtime.digestValue(authority);
    const startDigest = allocation && runtime.digestValue(start);
    const expectedRun = allocation && {
      run_id: allocation.run_id,
      allocation_id: allocation.allocation_id,
      lock: allocation.lock_id,
      authority_digest: authorityDigest,
      start_digest: startDigest,
    };
    const expectedSession = allocation && {
      allocation_id: allocation.allocation_id,
      run_id: allocation.run_id,
      lock: allocation.lock_id,
      lease: {
        lease_id: allocation.lease_id,
        fence_id: allocation.fence_id,
        fence_sequence: allocation.fence_sequence,
        issued_at: allocation.issued_at,
        expires_at: allocation.expires_at,
      },
      started: true,
      run_started_receipt_id: returned.run_started_receipt_id,
    };
    checks.started_session_exact = returned.started === true && !!allocation
      && runtime.canonicalSerialize(Object.keys(returned).sort()) === runtime.canonicalSerialize(Object.keys(expectedSession).sort())
      && runtime.canonicalSerialize(returned) === runtime.canonicalSerialize(expectedSession);
    checks.allocation_and_run_exact = !!allocation && !!run && allocation.allocation_digest === runtime.digestValue({
      allocation_id: allocation.allocation_id,
      run_id: allocation.run_id,
      lock: allocation.lock_id,
      lease_id: allocation.lease_id,
      fence_id: allocation.fence_id,
      fence_sequence: allocation.fence_sequence,
      owner_instance_id: allocation.owner_instance_id,
      process_id: allocation.process_id,
      issued_at: allocation.issued_at,
      expires_at: allocation.expires_at,
      authority,
      start,
    }) && run.run_id === allocation.run_id && run.allocation_id === allocation.allocation_id
      && run.lock_id === allocation.lock_id && run.authority_digest === authorityDigest
      && run.start_digest === startDigest && run.run_digest === runtime.digestValue(expectedRun);
    const chain = store.readReceiptChain(returned.run_id);
    const receipt = chain[0];
    checks.one_started_receipt = chain.length === 1 && !!receiptRow && receipt.receipt_id === returned.run_started_receipt_id
      && receipt.receipt_type === 'RUN_STARTED' && receipt.sequence === 1 && receipt.prior_receipt_id === null
      && receipt.allocation_id === allocation.allocation_id && receipt.run_id === allocation.run_id
      && receipt.lock === allocation.lock_id && runtime.canonicalSerialize(receipt.authority) === runtime.canonicalSerialize(authority)
      && runtime.canonicalSerialize(receipt.start) === runtime.canonicalSerialize(start)
      && runtime.canonicalSerialize(receipt.lease) === runtime.canonicalSerialize(expectedSession.lease)
      && receipt.payload.classification === 'RUN_STARTED_VERIFIED'
      && receiptRow.canonical_json === runtime.canonicalSerialize(receipt)
      && receiptRow.receipt_digest === receipt.receipt_id;
    const expectedAllocationDelta = beforeSnapshot.tables.allocations.identity_values.includes(returned.allocation_id) ? 0 : 1;
    checks.exact_store_deltas = receiptTableDelta(beforeSnapshot, afterSnapshot, 'allocations') === expectedAllocationDelta
      && receiptTableDelta(beforeSnapshot, afterSnapshot, 'runs') === expectedAllocationDelta
      && receiptTableDelta(beforeSnapshot, afterSnapshot, 'lease_events') === expectedAllocationDelta
      && receiptTableDelta(beforeSnapshot, afterSnapshot, 'receipts') === 1
      && receiptTableDelta(beforeSnapshot, afterSnapshot, 'mutation_operations') === 0
      && receiptTableDelta(beforeSnapshot, afterSnapshot, 'mutation_operation_events') === 0;
    db.close();
    db = null;
    const processVerified = checks.one_started_receipt && checks.allocation_and_run_exact
      && !!metadata && verifyProgrammeStartedRunProcess(store, returned, allocation, receipt, chain, metadata);
    checks.fresh_process_readback = processVerified;
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({
      kind: 'programme-started-run',
      run_id: returned.run_id,
      allocation_id: returned.allocation_id,
      receipt_id: returned.run_started_receipt_id,
      method,
      checks,
      passed,
    });
    return passed;
  } catch (error) {
    if (db) db.close();
    recordOracleHarnessReadback({
      kind: 'programme-started-run',
      method,
      error_code: error && error.code || error && error.name || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

function verifyProgrammePreviewReceiptWitness(store, session, input, returned, beforeSnapshot, afterSnapshot) {
  const checks = {};
  if (!store || !session || !input || !returned || !beforeSnapshot || !afterSnapshot) return false;
  try {
    const chain = store.readReceiptChain(session.run_id);
    const returnedReceipt = returned.receipt;
    const db = new DatabaseSync(store.databasePath, { readOnly: true });
    let row;
    try { row = db.prepare('SELECT * FROM receipts WHERE receipt_id = ? AND run_id = ?').get(returnedReceipt && returnedReceipt.receipt_id, session.run_id); }
    finally { db.close(); }
    const beforeReceipts = beforeSnapshot.tables.receipts;
    const afterReceipts = afterSnapshot.tables.receipts;
    const changedTables = Object.keys(beforeSnapshot.tables).filter((table) => table !== 'receipts'
      && beforeSnapshot.tables[table].rows_digest !== afterSnapshot.tables[table].rows_digest);
    const expected = chain[1];
    checks.one_preview_receipt = receiptTableDelta(beforeSnapshot, afterSnapshot, 'receipts') === 1
      && chain.length === 2 && chain[0].receipt_type === 'RUN_STARTED'
      && expected && expected.receipt_type === 'TRANSITION_PREVIEW' && expected.sequence === 2
      && expected.prior_receipt_id === chain[0].receipt_id;
    checks.input_bound_exactly = !!expected && returned.duplicate === false
      && runtime.canonicalSerialize(returnedReceipt) === runtime.canonicalSerialize(expected)
      && expected.receipt_id === returnedReceipt.receipt_id
      && expected.receipt_type === input.receipt_type && expected.candidate === input.candidate
      && runtime.canonicalSerialize(expected.payload) === runtime.canonicalSerialize(input.payload)
      && expected.created_at === input.created_at;
    checks.durable_row_exact = !!row && row.canonical_json === runtime.canonicalSerialize(expected)
      && row.sequence === expected.sequence && row.prior_receipt_id === expected.prior_receipt_id
      && row.receipt_type === expected.receipt_type && row.receipt_digest === expected.receipt_id;
    checks.no_other_store_mutation = changedTables.length === 0
      && Object.keys(beforeSnapshot.tables).filter((table) => table !== 'receipts')
        .every((table) => beforeSnapshot.tables[table].count === afterSnapshot.tables[table].count);
    checks.receipt_identity_added_once = !!beforeReceipts && !!afterReceipts
      && afterReceipts.identity_values.length === beforeReceipts.identity_values.length + 1
      && afterReceipts.identity_values.filter((id) => !beforeReceipts.identity_values.includes(id)).length === 1
      && afterReceipts.identity_values.includes(returnedReceipt.receipt_id);
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({
      kind: 'programme-preview-receipt',
      run_id: session.run_id,
      receipt_id: returnedReceipt && returnedReceipt.receipt_id,
      checks,
      passed,
    });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'programme-preview-receipt',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

function verifyNewPacketArtifact(store, packetValue, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !packetValue || !returned || !beforeSnapshot || !afterSnapshot) return false;
  let identities;
  try { identities = runtime.authorityPacketIdentities(packetValue); } catch (_) { return false; }
  const before = beforeSnapshot.tables.authority_packets;
  const after = afterSnapshot.tables.authority_packets;
  if (!before || !after) return false;
  const newIds = after.identity_values.filter((id) => !before.identity_values.includes(id));
  if (newIds.length !== 1 || newIds[0] !== identities.packet_id
    || after.count !== before.count + 1 || before.identity_values.includes(identities.packet_id)
    || returned.packet_id !== identities.packet_id || returned.duplicate !== false
    || runtime.canonicalSerialize(returned.packet) !== identities.canonical_packet_bytes) return false;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let row;
  try { row = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(identities.packet_id); }
  finally { db.close(); }
  return !!row
    && row.packet_digest === identities.packet_digest
    && row.content_digest === identities.content_digest
    && row.binding_digest === identities.binding_digest
    && row.canonical_json === identities.canonical_packet_bytes
    && runtime.digestValue(JSON.parse(row.canonical_json)) === identities.packet_digest;
}

function verifyExistingPacketReplay(store, packetValue, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !packetValue || !returned || returned.duplicate !== true
    || !beforeSnapshot || !afterSnapshot
    || runtime.canonicalSerialize(beforeSnapshot) !== runtime.canonicalSerialize(afterSnapshot)) return false;
  let identities;
  try { identities = runtime.authorityPacketIdentities(packetValue); } catch (_) { return false; }
  const before = beforeSnapshot.tables.authority_packets;
  const after = afterSnapshot.tables.authority_packets;
  if (!before || !after || !before.identity_values.includes(identities.packet_id)
    || after.count !== before.count || after.rows_digest !== before.rows_digest
    || returned.packet_id !== identities.packet_id || returned.packet_digest !== identities.packet_digest
    || returned.content_digest !== identities.content_digest || returned.binding_digest !== identities.binding_digest
    || returned.producer_key !== identities.producer_key
    || runtime.canonicalSerialize(returned.packet) !== identities.canonical_packet_bytes) return false;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let row;
  try { row = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(identities.packet_id); }
  finally { db.close(); }
  return !!row && row.canonical_json === identities.canonical_packet_bytes
    && row.packet_digest === identities.packet_digest
    && row.content_digest === identities.content_digest
    && row.binding_digest === identities.binding_digest;
}

function verifySemanticAdmissionWitness(store, intent, readersValue, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !intent || !readersValue || !returned || returned.duplicate !== false
    || !returned.admission || !beforeSnapshot || !afterSnapshot
    || runtime.assertAuthenticSemanticGateAdmission(store, returned.admission) !== true) return false;
  const before = beforeSnapshot.tables.semantic_gate_admissions;
  const after = afterSnapshot.tables.semantic_gate_admissions;
  const beforeEvents = beforeSnapshot.tables.semantic_gate_admission_events;
  const afterEvents = afterSnapshot.tables.semantic_gate_admission_events;
  if (!before || !after || !beforeEvents || !afterEvents
    || after.count !== before.count + 1 || afterEvents.count !== beforeEvents.count) return false;
  const newIds = after.identity_values.filter((id) => !before.identity_values.includes(id));
  if (newIds.length !== 1 || newIds[0] !== returned.admission_id) return false;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let row;
  let events;
  try {
    row = db.prepare('SELECT * FROM semantic_gate_admissions WHERE admission_id = ?').get(returned.admission_id);
    events = db.prepare('SELECT * FROM semantic_gate_admission_events WHERE admission_id = ? ORDER BY sequence').all(returned.admission_id);
  } finally { db.close(); }
  if (!row || events.length !== 0) return false;
  let record;
  try { record = JSON.parse(row.canonical_json); } catch (_) { return false; }
  try { runtime.validateSemanticGateAdmission(record); } catch (_) { return false; }
  const authorityObservation = readersValue.readAuthority(intent);
  const expected = {
    schema: runtime.SEMANTIC_GATE_ADMISSION_SCHEMA_ID,
    admission_id: returned.admission_id,
    consumer_key: runtime.digestValue({
      repository: intent.repository,
      parent_issue: intent.parent_issue,
      child_issue: intent.child_issue,
      lane_id: intent.lane_id,
      consumer: intent.consumer,
      candidate: returned.proof.consumer.candidate,
      scope_digest: intent.consumer.scope_digest,
      execution_binding: intent.execution_binding,
    }),
    consumer: intent.consumer,
    repository: intent.repository,
    parent_issue: intent.parent_issue,
    child_issue: intent.child_issue,
    lane_id: intent.lane_id,
    human_owner: intent.human_owner,
    authority: authorityObservation.authority,
    candidate: returned.proof.consumer.candidate,
    scope_digest: intent.consumer.scope_digest,
    current_projection_digest: returned.proof.current.projection_digest,
    current_body_digest: returned.proof.current.body_digest,
    current_revision: returned.proof.current.revision,
    predecessors: returned.proof.predecessors,
    execution_binding: intent.execution_binding,
  };
  return row.admission_id === returned.admission_id
    && row.consumer_key === expected.consumer_key
    && row.canonical_json === runtime.canonicalSerialize(record)
    && runtime.canonicalSerialize(record) === runtime.canonicalSerialize(expected);
}

function verifySemanticDispatchEventWitness(store, intent, admissionResult, dispatchIntent, transport, returned, beforeSnapshot, afterSnapshot) {
  if (!store || !intent || !admissionResult || !admissionResult.admission || !dispatchIntent || !transport || !returned
    || !beforeSnapshot || !afterSnapshot
    || runtime.assertAuthenticSemanticGateAdmission(store, admissionResult.admission) !== true) return false;
  const admissionId = admissionResult.admission_id;
  const beforeAdmission = beforeSnapshot.tables.semantic_gate_admissions;
  const afterAdmission = afterSnapshot.tables.semantic_gate_admissions;
  const beforeEvents = beforeSnapshot.tables.semantic_gate_admission_events;
  const afterEvents = afterSnapshot.tables.semantic_gate_admission_events;
  if (!admissionId || !beforeAdmission || !afterAdmission || !beforeEvents || !afterEvents
    || beforeAdmission.rows_digest !== afterAdmission.rows_digest
    || afterEvents.count !== beforeEvents.count + 1) return false;
  const beforeProofs = beforeEvents.event_proofs || [];
  const afterProofs = afterEvents.event_proofs || [];
  const beforeIds = new Set(beforeProofs.map((event) => event.event_id));
  const additions = afterProofs.filter((event) => !beforeIds.has(event.event_id));
  const intentProofs = beforeProofs.filter((event) => event.admission_id === admissionId);
  const intentProof = intentProofs.at(-1);
  if (additions.length !== 1 || additions[0].event_type !== 'DISPATCH_CONFIRMED'
    || additions[0].admission_id !== admissionId || additions[0].event_digest_verified !== true
    || !intentProof || intentProof.event_id !== dispatchIntent.event_id
    || intentProof.sequence !== dispatchIntent.sequence || intentProof.event_type !== 'DISPATCH_INTENT'
    || intentProof.event_digest_verified !== true || dispatchIntent.attempt !== 1) return false;

  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let admissionRow;
  let eventRow;
  try {
    admissionRow = db.prepare('SELECT * FROM semantic_gate_admissions WHERE admission_id = ?').get(admissionId);
    eventRow = db.prepare('SELECT * FROM semantic_gate_admission_events WHERE event_id = ?').get(additions[0].event_id);
  } finally { db.close(); }
  if (!admissionRow || !eventRow || admissionRow.admission_id !== admissionId) return false;
  let admissionRecord;
  let event;
  try {
    admissionRecord = JSON.parse(admissionRow.canonical_json);
    event = JSON.parse(eventRow.canonical_json);
    runtime.validateSemanticGateAdmission(admissionRecord);
  } catch (_) { return false; }
  if (admissionRow.canonical_json !== runtime.canonicalSerialize(admissionRecord)
    || admissionRecord.admission_id !== admissionId || admissionRecord.consumer_key !== admissionRow.consumer_key) return false;
  const expectedTransportId = runtime.digestValue({
    schema: 'toolkit.github-program.semantic-dispatch-transport.v1',
    admission_id: admissionId,
    consumer_key: admissionRow.consumer_key,
    attempt: dispatchIntent.attempt,
  });
  const transportDigest = runtime.digestValue({
    transport_id: transport.transport_id,
    transport_result: transport.transport_result === undefined ? null : transport.transport_result,
    transport_error: transport.transport_error === undefined ? null : transport.transport_error,
  });
  const observed = {
    admission_id: admissionId,
    consumer_key: admissionRow.consumer_key,
    intent_event_id: dispatchIntent.event_id,
    attempt: dispatchIntent.attempt,
    transport_id: dispatchIntent.transport_id,
    transport_digest: transportDigest,
    outcome: 'confirmed',
    delayed_completion_excluded: false,
  };
  const intentEvidence = {
    admission_id: admissionId,
    consumer_key: admissionRow.consumer_key,
    action: 'DISPATCH_INTENT',
    attempt: dispatchIntent.attempt,
    transport_id: expectedTransportId,
  };
  const expectedEventKeys = [
    'schema', 'admission_id', 'sequence', 'prior_event_id', 'event_type', 'created_at', 'transport_evidence_digest',
  ].sort();
  if (dispatchIntent.transport_id !== expectedTransportId || transport.transport_id !== expectedTransportId
    || transport.transport_result?.status !== 'confirmed' || transport.transport_error !== null
    || intentProof.transport_evidence_digest !== runtime.digestValue(intentEvidence)
    || Object.keys(event).sort().join('\0') !== expectedEventKeys.join('\0')
    || event.schema !== runtime.SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID
    || event.admission_id !== admissionId || event.sequence !== intentProof.sequence + 1
    || event.prior_event_id !== intentProof.event_id || event.event_type !== 'DISPATCH_CONFIRMED'
    || !Number.isFinite(Date.parse(event.created_at))
    || event.transport_evidence_digest !== runtime.digestValue(observed)
    || eventRow.admission_id !== admissionId || eventRow.sequence !== event.sequence
    || eventRow.prior_event_id !== event.prior_event_id || eventRow.event_type !== event.event_type
    || eventRow.event_id !== runtime.digestValue(event)
    || runtime.canonicalSerialize(event) !== eventRow.canonical_json) return false;
  const expectedReturned = {
    event_id: eventRow.event_id,
    event_type: eventRow.event_type,
    sequence: eventRow.sequence,
    transport_evidence_digest: event.transport_evidence_digest,
    ...observed,
  };
  return runtime.canonicalSerialize(returned) === runtime.canonicalSerialize(expectedReturned);
}

function verifyCurrentReadbackWitness(store, projection, returned, readersValue, beforeSnapshot, afterSnapshot) {
  if (!store || !projection || !returned || !readersValue
    || !beforeSnapshot || !afterSnapshot || !Array.isArray(returned.readback_event_ids)) return { created: false, replayed: false };
  let observed;
  try { observed = readersValue.readCurrent(projection); } catch (_) { return { created: false, replayed: false }; }
  if (!observed || runtime.canonicalSerialize(observed.current || observed.projection || observed)
    !== runtime.canonicalSerialize(projection)
    || observed.projection_digest !== runtime.digestValue(projection)
    || !/^[a-f0-9]{64}$/.test(observed.body_digest || '')
    || !(Number.isSafeInteger(observed.revision) && observed.revision >= 1
      || typeof observed.revision === 'string' && observed.revision.length > 0)
    || returned.projection_digest !== observed.projection_digest
    || returned.body_digest !== observed.body_digest || returned.revision !== observed.revision) return { created: false, replayed: false };
  const beforeProofs = beforeSnapshot.tables.authority_packet_events?.event_proofs || [];
  const afterProofs = afterSnapshot.tables.authority_packet_events?.event_proofs || [];
  const beforeIds = new Set(beforeProofs.map((event) => event.event_id));
  const newEvents = afterProofs.filter((event) => event.event_type === 'CURRENT_READBACK' && !beforeIds.has(event.event_id));
  const expectedPayloads = projection.predecessors.map((predecessor) => ({
    packet_id: predecessor.packet_id,
    payload: {
      projection_digest: observed.projection_digest,
      body_digest: observed.body_digest,
      revision: observed.revision,
      acceptance_event_ids: [predecessor.acceptance_event_id],
    },
  }));
  const byPacket = (events) => events.slice().sort((left, right) => left.packet_id.localeCompare(right.packet_id));
  const expectedSorted = expectedPayloads.slice().sort((left, right) => left.packet_id.localeCompare(right.packet_id));
  const created = newEvents.length === expectedPayloads.length
    && byPacket(newEvents).every((event, index) => {
      const expected = expectedSorted[index];
      return event.packet_id === expected.packet_id
        && event.payload_digest === runtime.digestValue(expected.payload)
        && event.event_digest_verified && event.event_key_verified;
    });
  const replayed = expectedPayloads.length > 0 && newEvents.length === 0
    && runtime.canonicalSerialize(beforeSnapshot) === runtime.canonicalSerialize(afterSnapshot)
    && expectedPayloads.every(({ packet_id, payload }) => afterProofs.some((event) => event.packet_id === packet_id
      && event.event_type === 'CURRENT_READBACK' && event.payload_digest === runtime.digestValue(payload)
      && event.event_digest_verified && event.event_key_verified));
  if ((!created && !replayed) || returned.readback_event_ids.length !== projection.predecessors.length) {
    return { created: false, replayed: false };
  }
  const eventIds = expectedSorted.map(({ packet_id, payload }) => afterProofs.find((event) => event.packet_id === packet_id
    && event.event_type === 'CURRENT_READBACK' && event.payload_digest === runtime.digestValue(payload))?.event_id);
  const returnedIds = returned.readback_event_ids.slice().sort();
  if (eventIds.some((id) => !id) || runtime.canonicalSerialize(returnedIds) !== runtime.canonicalSerialize(eventIds.slice().sort())) {
    return { created: false, replayed: false };
  }
  return { created, replayed };
}

function mutateSemanticAdmissionRecord(store, consumerKey, update) {
  if (typeof update !== 'function') throw new Error('SEMANTIC_ADMISSION_MUTATOR_REQUIRED');
  const db = new DatabaseSync(store.databasePath);
  let started = false;
  let triggers = [];
  try {
    triggers = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'semantic_gate_admissions' ORDER BY name").all();
    db.exec('BEGIN IMMEDIATE');
    started = true;
    for (const trigger of triggers) {
      db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
    }
    const row = db.prepare('SELECT admission_id, canonical_json FROM semantic_gate_admissions WHERE consumer_key = ?').get(consumerKey);
    if (!row) throw new Error('SEMANTIC_ADMISSION_FIXTURE_NOT_FOUND');
    const changed = JSON.parse(row.canonical_json);
    update(changed);
    db.prepare('UPDATE semantic_gate_admissions SET canonical_json = ? WHERE admission_id = ? AND consumer_key = ?')
      .run(runtime.canonicalSerialize(changed), row.admission_id, consumerKey);
    for (const trigger of triggers) db.exec(trigger.sql);
    db.exec('COMMIT');
    started = false;
  } catch (error) {
    if (started) {
      try { db.exec('ROLLBACK'); } catch (_) { /* Preserve the fixture failure. */ }
    }
    throw error;
  } finally { db.close(); }
}

function resetOracleEffectBaseline(harness = activeOracleHarness) {
  if (!harness) return;
  for (let current = harness; current; current = current.parent) {
    for (const store of current.storeBaselines.keys()) {
      current.storeBaselines.set(store, oracleCounts(store));
      if (current.objectBaselines) current.objectBaselines.set(store, receiptEffectSnapshot(store));
    }
  }
}

function trackedObjectObservations(harness) {
  const observations = [];
  for (const store of harness.storeBaselines.keys()) {
    const before = harness.objectBaselines && harness.objectBaselines.get(store);
    const after = receiptEffectSnapshot(store);
    if (!before) continue;
    const tables = {};
    for (const [table, beforeTable] of Object.entries(before.tables)) {
      const afterTable = after.tables[table];
      tables[table] = {
        before_count: beforeTable.count,
        after_count: afterTable.count,
        before_digest: beforeTable.rows_digest,
        after_digest: afterTable.rows_digest,
        new_identities: afterTable.identity_values.filter((id) => !beforeTable.identity_values.includes(id)),
        removed_identities: beforeTable.identity_values.filter((id) => !afterTable.identity_values.includes(id)),
      };
    }
    observations.push({
      store_kind: ORACLE_AUTHORITY_PACKET_STORES.has(store) ? 'authority-packet' : 'programme-receipt',
      database_path_digest: runtime.digestValue(store.databasePath),
      before_digest: runtime.digestValue(before),
      after_digest: runtime.digestValue(after),
      unchanged: runtime.canonicalSerialize(before) === runtime.canonicalSerialize(after),
      tables,
    });
  }
  return observations;
}

function oracleSurfaceMethodAllowed(caseValue, targetType, target, method) {
  const required = expectedOraclePlan(caseValue).calls.some((call) => call.target_type === targetType && call.method === method);
  if (required) return true;
  const surface = caseValue.surface;
  const sequence = String(surface).split('->');
  if (sequence.length > 1) {
    if (targetType !== 'programmeReceiptStore') return false;
    return sequence.some((item) => item.split('.').at(-1) === method);
  }
  if (surface.startsWith('receipt.')) {
    return targetType === 'programmeReceiptStore' && surface.slice('receipt.'.length) === method;
  }
  if (surface.startsWith('loop.')) {
    if (targetType !== 'executionLoop') return false;
    if (surface === 'loop.atomicBatchCommit') return method === 'startDelegatedRun';
    if (surface === 'loop.governedCompletion') return method === 'completeRun';
    if (surface.startsWith('loop.transitionRun.')) return method === 'transitionRun';
    return surface.slice('loop.'.length).split('.').at(-1) === method;
  }
  if (surface.startsWith('assurance.')) {
    return targetType === 'assurance' && surface.slice('assurance.'.length) === method;
  }
  if (targetType === 'authorityPacketStore') return surface === method;
  if (targetType === 'reader') return surface === method;
  if (targetType === 'runtime') return surface === method;
  return false;
}

async function invokeOracleSurface(caseValue, targetType, target, method, args = [], supporting = false) {
  const callOptions = supporting && typeof supporting === 'object' ? supporting : {};
  const setupDeclared = callOptions.setup === true;
  const supportingCall = supporting === true || callOptions.supporting === true;
  const allowed = oracleSurfaceMethodAllowed(caseValue, targetType, target, method);
  if ((!allowed && !supportingCall && !setupDeclared) || !target || typeof target[method] !== 'function') {
    throw new Error(`ORACLE_SURFACE_SUBSTITUTED:${caseValue.id}:${method}`);
  }
  if (targetType === 'authorityPacketStore'
    && (!ORACLE_AUTHORITY_PACKET_STORES.has(target) || runtime.assertAuthenticAuthorityPacketStore(target) !== true)) {
    throw new Error(`ORACLE_STORE_NOT_AUTHENTIC:${caseValue.id}`);
  }
  if (targetType === 'programmeReceiptStore' && !ORACLE_PROGRAMME_RECEIPT_STORES.has(target)) {
    throw new Error(`ORACLE_RECEIPT_STORE_NOT_AUTHENTIC:${caseValue.id}`);
  }
  if (targetType === 'programmeReceiptStore'
    && ORACLE_PROGRAMME_RECEIPT_STORE_METHODS.get(target)?.[method] !== target[method]) {
    throw new Error(`ORACLE_RECEIPT_METHOD_SUBSTITUTED:${caseValue.id}:${method}`);
  }
  if (targetType === 'reader' && !ORACLE_READER_SETS.has(target)) {
    throw new Error(`ORACLE_READER_SET_NOT_BOUND:${caseValue.id}`);
  }
  if (targetType === 'runtime' && target !== runtime || targetType === 'executionLoop' && target !== executionLoop
    || targetType === 'assurance' && target !== assuranceRuntime) {
    throw new Error(`ORACLE_PRODUCTION_MODULE_MISMATCH:${caseValue.id}`);
  }
  const measuredStore = targetType === 'authorityPacketStore' || targetType === 'programmeReceiptStore'
    ? target : null;
  const localBefore = measuredStore ? oracleCounts(measuredStore) : null;
  const objectBefore = measuredStore ? receiptEffectSnapshot(measuredStore) : null;
  const before = activeOracleHarness
    ? oracleObservedStoreTotals(activeOracleHarness)
    : measuredStore ? oracleCounts(measuredStore) : null;
  const countersBefore = activeOracleHarness ? { ...activeOracleHarness.counters } : {};
  let value;
  let error = null;
  try { value = await target[method].apply(target, args); } catch (caught) { error = caught; }
  if (!error && targetType === 'programmeReceiptStore' && method === 'admitMutationOperation'
    && value !== null && typeof value === 'object') ORACLE_MUTATION_ADMISSIONS.add(value);
  if (!error && targetType === 'runtime' && value && typeof value.databasePath === 'string') {
    if (method === 'createProgrammeReceiptStore') trackOracleProgrammeReceiptStore(value);
    else trackOracleAuthorityStore(value);
  }
  const after = activeOracleHarness
    ? oracleObservedStoreTotals(activeOracleHarness)
    : measuredStore ? oracleCounts(measuredStore) : null;
  const localAfter = measuredStore ? oracleCounts(measuredStore) : null;
  const objectAfter = measuredStore ? receiptEffectSnapshot(measuredStore) : null;
  const actual = error
    ? { outcome: 'REJECT', code: error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE' }
    : oracleActual(value, targetType, method);
  const effectDelta = before && after ? oracleEffectDelta(before, after, actual, activeOracleHarness) : {};
  const flags = {};
  if (!error && targetType === 'runtime' && method === 'authorityPacketIdentities') {
    flags.identity_match = value.packet_id === `ap1-${value.packet_digest}`
      && value.packet_digest === runtime.digestValue({ schema: value.packet.schema, bindings: value.packet.bindings, body: value.packet.body })
      && value.content_digest === runtime.digestValue(value.packet.body)
      && value.binding_digest === runtime.digestValue(value.packet.bindings);
  }
  if (!error && targetType === 'runtime' && method === 'validateAuthorityPacket') {
    flags.byte_equal_readback = runtime.canonicalSerialize(value) === runtime.canonicalSerialize(args[0]);
  }
  if (!error && targetType === 'runtime' && method === 'authorityPacketStoreIdentity') {
    flags.identity_match = verifyStoreIdentityIndependently(args[0], value);
  }
  if (!error && targetType === 'runtime' && method === 'validateAuthorityPacketDelivery') {
    flags.byte_equal_readback = runtime.canonicalSerialize(value.packet) === value.envelope.canonical_packet_bytes;
    flags.over_legacy_limit = Buffer.byteLength(value.envelope.canonical_packet_bytes, 'utf8') > 16 * 1024;
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'verifyAuthorityPacketFresh') {
    flags.byte_equal_readback = runtime.canonicalSerialize(value.packet) === value.envelope.canonical_packet_bytes
      && value.envelope.challenge.length === 64;
    flags.one_json_line = true;
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'readAuthorityPacket') {
    flags.byte_equal_readback = args[2] === undefined
      ? !!value.bindings
      : runtime.canonicalSerialize(value) === runtime.canonicalSerialize(args[2]);
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'persistAuthorityPacket') {
    flags.one_artifact = after.artifacts >= 1;
    flags.byte_equal_readback = !!value.packet && runtime.canonicalSerialize(value.packet) === runtime.canonicalSerialize(args[0]);
    if (value.duplicate === true) flags.packet_replay_verified = verifyExistingPacketReplay(target, args[0], value, objectBefore, objectAfter);
    else flags.new_packet_witness = verifyNewPacketArtifact(target, args[0], value, objectBefore, objectAfter);
  }
  if (targetType === 'authorityPacketStore' && method === 'bindWebPacketAcceptance') {
    if (!error && value && value.duplicate === true) {
      flags.acceptance_replay_verified = verifyAcceptanceReplay(target, args[0], value, args[1], objectBefore, objectAfter);
      flags.readback_verified = flags.acceptance_replay_verified;
      flags.acceptance_event_verified = flags.acceptance_replay_verified;
      flags.bound_acceptance = flags.acceptance_replay_verified;
    } else if (!error) {
      const witness = verifyNewPacketAcceptance(target, args[0], value, objectBefore, objectAfter);
      flags.readback_verified = witness.readback;
      flags.acceptance_event_verified = witness.acceptance;
      flags.bound_acceptance = witness.acceptance;
    } else {
      flags.readback_verified = verifyNewPacketReadback(target, args[0], objectBefore, objectAfter);
      flags.acceptance_event_verified = false;
      flags.bound_acceptance = false;
    }
  }
  if (!error && targetType === 'programmeReceiptStore' && method === 'admitMutationOperation') {
    flags.operation_witness = verifyMutationAdmissionWitness(target, args[0], args[1], value, objectBefore, objectAfter);
  }
  if (!setupDeclared && !error && targetType === 'programmeReceiptStore' && method === 'allocateRun') {
    flags.allocation_witness = verifyProgrammeAllocationWitness(target, args[0], value, objectBefore, objectAfter);
  }
  if (!setupDeclared && !error && targetType === 'programmeReceiptStore' && ['startRun', 'startAllocatedRun'].includes(method)) {
    flags.started_run_witness = verifyProgrammeStartedRunWitness(target, value, method, objectBefore, objectAfter);
  }
  if (!setupDeclared && !error && targetType === 'programmeReceiptStore' && method === 'appendReceipt') {
    flags.preview_receipt_witness = verifyProgrammePreviewReceiptWitness(target, args[0], args[1], value, objectBefore, objectAfter);
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'confirmCurrentPacketProjection') {
    const witness = verifyCurrentReadbackWitness(target, args[0], value, args[1], objectBefore, objectAfter);
    flags.current_readback_created = witness.created;
    flags.current_readback_replayed = witness.replayed;
    flags.bound_current = witness.created || witness.replayed;
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'buildCurrentPacketProjection') {
    flags.projection_bounded = !Object.hasOwn(value, 'body') && !Object.hasOwn(value, 'findings');
    flags.candidate_bound = value.candidate !== undefined;
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'admitSemanticGate') {
    flags.admission_issued = !!value.admission;
    flags.semantic_admission_witness = verifySemanticAdmissionWitness(target, args[0], args[1], value, objectBefore, objectAfter);
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'recoverSemanticGateAdmission') {
    flags.recovered_handle = value.recovered === true && !!value.admission
      && runtime.assertAuthenticSemanticGateAdmission(target, value.admission) === true;
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'readAuthorityPacket') flags.original_retained = !!value.bindings;
  if (!error && targetType === 'authorityPacketStore' && method === 'backfillAuthorityPacket') {
    flags.original_producer_retained = !!value.packet && !!args[0]
      && runtime.canonicalSerialize(value.packet.bindings.producer) === runtime.canonicalSerialize(args[0].bindings.producer);
    flags.backfill_witness = verifyBackfillWitness(target, args[0], value, objectBefore, objectAfter);
    flags.byte_equal_readback = flags.backfill_witness === true;
  }
  if (!error && targetType === 'runtime' && method === 'initialiseAuthorityPacketStore') {
    flags.store_ready = !!value.databasePath;
    flags.store_schema_verified = verifyPrivateAuthorityStore(value, args[0], args[1]);
    flags.byte_equal_readback = flags.store_schema_verified;
  }
  if (!error && targetType === 'runtime' && method === 'migrateAuthorityPacketStore') flags.v4_historical_preserved = !!value.storeIdentityDigest;
  if (!error && targetType === 'reader' && method === 'screenPacket') flags.screened = value.decision === 'ALLOW' || value.allowed === true;
  if (!error && targetType === 'reader' && method === 'readAuthority') flags.fresh_authority_bound = !!(value.authority || value.repository);
  if (!error && targetType === 'reader' && method === 'readCandidate') flags.candidate_bound = value !== undefined;
  if (!error && targetType === 'assurance' && actual.outcome === 'ACCEPT') {
    flags.assurance_evaluation_witness = verifyAssuranceEvaluationWitness(method, value);
  }
  if (localBefore && localAfter) {
    for (const key of Object.keys(localBefore)) {
      flags[`target_${key}_delta`] = localAfter[key] - localBefore[key];
      flags[`target_${key}_after`] = localAfter[key];
    }
  }
  if (activeOracleHarness) {
    activeOracleHarness.counters.surface_calls = (activeOracleHarness.counters.surface_calls || 0) + 1;
    if (targetType === 'authorityPacketStore' && method === 'verifyAuthorityPacketFresh') activeOracleHarness.counters.fresh_reader_processes += 1;
    if (targetType === 'authorityPacketStore' && method === 'bindWebPacketAcceptance'
      && !error && value && value.duplicate !== true) activeOracleHarness.counters.fresh_reader_processes += 1;
    if (targetType === 'authorityPacketStore' && method === 'backfillAuthorityPacket' && !error) {
      activeOracleHarness.counters.fresh_reader_processes += 1;
    }
    if (targetType === 'authorityPacketStore' && method === 'recoverSemanticGateAdmission') activeOracleHarness.counters.recovery_calls += 1;
    if (targetType === 'authorityPacketStore' && ['admitSemanticGate', 'revalidateSemanticGate', 'backfillAuthorityPacket'].includes(method)
      && !error) activeOracleHarness.counters.fresh_reader_processes += 1;
    if (targetType === 'programmeReceiptStore' && ['startRun', 'startAllocatedRun'].includes(method)
      && !error && value && value.started === true && flags.started_run_witness === true) activeOracleHarness.counters.fresh_reader_processes += 1;
    if (targetType === 'executionLoop') {
      const semanticGate = args.map((value) => value && (value.semantic_gate || value.semanticGate))
        .find((value) => value && value.consumer_intent);
      const predecessorRequired = semanticGate && Array.isArray(semanticGate.consumer_intent.predecessors)
        && semanticGate.consumer_intent.predecessors.length > 0;
      if (!error && ['admitRun', 'startDelegatedRun', 'prepareRetry', 'executeTypedGitCommit', 'commitExact', 'completeRun'].includes(method)
        && actual.outcome === 'ACCEPT' && predecessorRequired) activeOracleHarness.counters.fresh_reader_processes += 1;
      if (!error && method === 'transitionRun' && ['admitted', 'running'].includes(args[1]) && predecessorRequired) activeOracleHarness.counters.fresh_reader_processes += 1;
      if (!error && method === 'releaseMutationLease' && value && value.released === true && predecessorRequired) activeOracleHarness.counters.fresh_reader_processes += 1;
      if (method === 'completeRun' && !error && actual.outcome === 'ACCEPT') activeOracleHarness.counters.complete_calls += 1;
      if (method === 'releaseMutationLease' && !error && value && value.released === true) activeOracleHarness.counters.release_successes += 1;
    }
  }
  const receipt = Object.freeze({});
  const bound = {
    case_identity: oracleCaseIdentity(caseValue),
    surface: caseValue.surface,
    method,
    target_type: targetType,
    outcome: error ? 'THREW' : 'RETURNED',
    actual,
    value_type: error ? 'throw' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    returned_value: error ? undefined : value,
    target_reference: target,
    argument_binding_digest: oracleArgumentBindingDigest(caseValue, targetType, target, method, args),
    object_before: objectBefore,
    object_after: objectAfter,
    effect_delta: { ...effectDelta, ...flags },
    counters_before: countersBefore,
    counters_after: activeOracleHarness ? { ...activeOracleHarness.counters } : {},
    receipt,
    setup_declared: setupDeclared,
    setup: setupDeclared,
  };
  ORACLE_SURFACE_RECEIPTS.set(receipt, bound);
  recordOracleHarnessEvent({
    type: 'production-call',
    sequence: activeOracleHarness ? activeOracleHarness.events.length + 1 : 1,
    case_identity: oracleCaseIdentity(caseValue),
    method,
    target_type: targetType,
    outcome: actual.outcome,
    code: actual.code,
    value_type: bound.value_type,
    argument_binding_digest: bound.argument_binding_digest,
    setup: bound.setup,
    object_before: objectBefore,
    object_after: objectAfter,
  });
  recordOracleHarnessReceipt(receipt);
  return { receipt, value, error };
}

function oracleRecordDerivedOutcome(caseValue, actual, measuredReceipts, flags = {}) {
  if (!activeOracleHarness || !Array.isArray(measuredReceipts) || measuredReceipts.length === 0) {
    throw new Error(`ORACLE_DERIVED_OUTCOME_WITHOUT_PRODUCTION:${caseValue.id}`);
  }
  const caseIdentity = oracleCaseIdentity(caseValue);
  const sourceCalls = measuredReceipts.map((measuredReceipt) => ORACLE_SURFACE_RECEIPTS.get(measuredReceipt));
  if (sourceCalls.some((source) => !source || source.case_identity !== caseIdentity || source.setup === true
    || typeof source.argument_binding_digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.argument_binding_digest))) {
    throw new Error(`ORACLE_DERIVED_BINDING_SOURCE_INVALID:${caseValue.id}`);
  }
  const sourceCallBindings = sourceCalls.map((source) => ({
    case_identity: source.case_identity,
    surface: source.surface,
    method: source.method,
    target_type: source.target_type,
    outcome: source.outcome,
    actual: source.actual,
    value_type: source.value_type,
    result_digest: runtime.digestValue({
      value_type: source.value_type,
      value: source.returned_value === undefined ? null : source.returned_value,
    }),
    argument_binding_digest: source.argument_binding_digest,
  }));
  const argumentBindingDigest = runtime.digestValue({
    schema: 'toolkit.github-program.oracle-production-comparison-binding.v1',
    case_identity: caseIdentity,
    method: 'COMPARE',
    comparison: { outcome: actual.outcome, code: actual.code, flags },
    source_calls: sourceCallBindings,
  });
  const receipt = Object.freeze({});
  ORACLE_SURFACE_RECEIPTS.set(receipt, {
    case_identity: caseIdentity,
    surface: caseValue.surface,
    method: 'COMPARE',
    target_type: 'observed-production-invariant',
    outcome: 'OBSERVED_COMPARISON',
    actual,
    argument_binding_digest: argumentBindingDigest,
    source_call_count: sourceCallBindings.length,
    source_call_binding_digests: sourceCallBindings.map((source) => source.argument_binding_digest),
    effect_delta: {},
    counters_before: { ...activeOracleHarness.counters },
    counters_after: { ...activeOracleHarness.counters },
    flags,
  });
  recordOracleHarnessEvent({
    type: 'comparison',
    sequence: activeOracleHarness.events.length + 1,
    case_identity: oracleCaseIdentity(caseValue),
    method: 'COMPARE',
    outcome: actual.outcome,
    code: actual.code,
    argument_binding_digest: argumentBindingDigest,
    source_call_count: sourceCallBindings.length,
    flags: structuredClone(flags),
  });
  recordOracleHarnessReceipt(receipt);
  return receipt;
}

function markOracleReceiptAsSetup(receipt) {
  const bound = receipt && ORACLE_SURFACE_RECEIPTS.get(receipt);
  if (!bound || bound.setup_declared !== true) throw new Error('ORACLE_SETUP_NOT_PREDECLARED');
  bound.setup = true;
  return receipt;
}

function expectedOracleSurfaceMethods(surface) {
  if (String(surface).includes('->')) return String(surface).split('->').map((item) => item.split('.').at(-1));
  if (surface === 'loop.atomicBatchCommit') return ['startDelegatedRun'];
  if (surface === 'loop.governedCompletion') return ['completeRun'];
  if (surface.startsWith('loop.transitionRun.')) return ['transitionRun'];
  if (surface.startsWith('loop.') || surface.startsWith('assurance.') || surface.startsWith('receipt.')) {
    return [surface.split('.').at(-1)];
  }
  return [surface];
}

function expectedOraclePlan(caseValue) {
  const polarity = caseValue.expected.positive_control === true ? 'POS' : 'NEG';
  const expanded = ORACLE_SPEC_MANIFEST_V1.expanded_requirements.includes(caseValue.requirement_id);
  let rawCalls;
  let effectRule;
  let surfaceCode = null;
  if (expanded) {
    const surfaceRule = ORACLE_EXPANDED_SURFACE_CODES_V1.find(([, surface]) => surface === caseValue.surface);
    if (!surfaceRule) throw new Error('ORACLE_SURFACE_RULE_MISSING:' + caseValue.surface);
    [surfaceCode] = surfaceRule;
    rawCalls = expectedOracleSurfaceMethods(caseValue.surface).map((method) => ({ token: method, method }));
    if (caseValue.surface === 'receipt.authorizeMutationDispatch' && polarity === 'POS') {
      rawCalls.push({ ...rawCalls[0] });
      rawCalls[1].expected_outcome = 'REJECT';
      rawCalls[1].expected_code = 'GPR_ADMISSION_CONSUMED';
    }
    if (rawCalls.length > 0 && caseValue.expected.outcome === 'REJECT') {
      rawCalls[rawCalls.length - 1].expected_outcome = 'REJECT';
    }
    effectRule = polarity === 'POS' ? surfaceCode : 'Z';
  } else {
    const rule = ORACLE_ORDINARY_CALL_RULES_V1[caseValue.requirement_id];
    if (!rule) throw new Error('ORACLE_CALL_RULE_MISSING:' + caseValue.requirement_id);
    const selected = rule[polarity];
    rawCalls = selected.calls.split(',').map((rawToken) => {
      const rejected = rawToken.endsWith('!');
      const token = rejected ? rawToken.slice(0, -1) : rawToken;
      const method = ORACLE_TOKEN_METHOD_V1[token];
      if (!method) throw new Error('ORACLE_CALL_TOKEN_UNKNOWN:' + token);
      return { token, method, expected_outcome: rejected ? 'REJECT' : null };
    });
    effectRule = selected.effect;
  }
  const calls = rawCalls.map((step, index) => {
    const expectedOutcome = step.expected_outcome
      || (step.token === 'RACEconflict' ? 'REJECT' : null)
      || (step.token === 'COMPARE' && caseValue.expected.outcome === 'REJECT' ? 'REJECT' : 'ACCEPT');
    let expectedCode = step.expected_code || null;
    if (expectedOutcome === 'REJECT' && !expectedCode) {
      if (caseValue.expected.outcome === 'REJECT') expectedCode = caseValue.expected.reason_code;
      else if (caseValue.requirement_id === 'G04' && polarity === 'POS' && index === 1) expectedCode = 'GPR_PACKET_CONFLICT';
      else if (['H04', 'X10'].includes(caseValue.requirement_id) && polarity === 'POS' && index === 0) expectedCode = 'GPR_PACKET_LIMIT';
      else expectedCode = 'ORACLE_EXPECTED_REJECTION_CODE_UNMAPPED';
    }
    let targetType = ORACLE_TOKEN_TARGET_V1[step.token];
    if (!targetType) {
      if (caseValue.surface.startsWith('receipt.')) targetType = 'programmeReceiptStore';
      else if (caseValue.surface.startsWith('loop.')) targetType = 'executionLoop';
      else if (caseValue.surface.startsWith('assurance.')) targetType = 'assurance';
      else targetType = 'authorityPacketStore';
    }
    return Object.freeze({
      ordinal: index + 1,
      token: step.token,
      method: step.method,
      target_type: targetType,
      expected_outcome: expectedOutcome,
      expected_code: expectedCode,
      role: 'required',
    });
  });
  let decisionCallIndex = calls.length - 1;
  if (caseValue.surface === 'receipt.authorizeMutationDispatch' && polarity === 'POS') decisionCallIndex = 0;
  else {
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      if (!['human-surface', 'compiler-tests', 'shipping-tests'].includes(calls[index].target_type)) {
        decisionCallIndex = index;
        break;
      }
    }
  }
  return Object.freeze({
    identity: oracleCaseIdentity(caseValue),
    requirement_id: caseValue.requirement_id,
    polarity,
    surface_code: surfaceCode,
    effect_rule: effectRule,
    calls: Object.freeze(calls),
    decision_call_index: decisionCallIndex,
    positive_control_case_id: oraclePositiveControlCaseId(caseValue),
  });
}

function expectedOracleMethods(caseValue) {
  return expectedOraclePlan(caseValue).calls.map((call) => call.method);
}

function measuredOracleEffects(receipts) {
  const effects = {
    artifacts_delta: 0, packet_events_delta: 0, web_acceptance_events_delta: 0, readback_events_delta: 0,
    current_readback_events_delta: 0, consumer_completed_events_delta: 0, semantic_admissions_delta: 0,
    dispatch_intents_delta: 0, dispatch_confirmed_delta: 0, dispatch_not_started_delta: 0,
    allocations_delta: 0, receipts_delta: 0, mutation_operations_delta: 0, mutation_operation_events_delta: 0,
  };
  for (const receipt of receipts) {
    const bound = ORACLE_SURFACE_RECEIPTS.get(receipt);
    if (!bound) throw new Error('ORACLE_EFFECT_RECEIPT_INVALID');
    if (bound.setup === true) {
      if (bound.include_setup_effect_deltas === true) {
        for (const [key, value] of Object.entries(bound.effect_delta || {})) {
          if (key.endsWith('_delta')) effects[key] = (effects[key] || 0) + value;
        }
      }
      for (const key of ['operation_witness', 'readback_verified', 'acceptance_event_verified', 'acceptance_replay_verified', 'started_run_witness', 'semantic_admission_witness']) {
        if (bound.effect_delta && bound.effect_delta[key] === true) effects[key] = true;
      }
      continue;
    }
    for (const [key, value] of Object.entries(bound.effect_delta || {})) {
      if (key.endsWith('_delta')) effects[key] = (effects[key] || 0) + value;
      else if (key.endsWith('_after')) effects[key] = value;
      else if (['byte_equal_readback', 'new_packet_witness', 'packet_replay_verified', 'identity_match', 'projection_bounded', 'candidate_bound', 'screened', 'admission_issued', 'semantic_admission_witness', 'dispatch_witness', 'custody_attack_witness', 'recovered_handle', 'original_retained', 'original_producer_retained', 'backfill_witness', 'store_ready', 'store_schema_verified', 'v4_historical_preserved', 'migration_witness', 'import_order_witness', 'fresh_authority_bound', 'bound_acceptance', 'readback_verified', 'acceptance_event_verified', 'acceptance_replay_verified', 'operation_witness', 'started_run_witness', 'preview_receipt_witness', 'loop_admission_witness', 'retry_witness', 'transition_witness', 'terminal_transition_witness', 'delegated_run_witness', 'git_commit_witness', 'terminal_completion_witness', 'lease_release_witness', 'assurance_admission_witness', 'assurance_evaluation_witness', 'bound_current', 'current_readback_created', 'current_readback_replayed', 'one_json_line', 'preservation_tests', 'over_legacy_limit', 'legacy_pass_retained', 'race_witness', 'legacy_bytes_witness', 'current_legacy_witness', 'compiler_results_verified', 'shipping_results_verified', 'oracle_inventory_verified'].includes(key)) {
        effects[key] = effects[key] === true || value === true;
      }
    }
    if (bound.flags) Object.assign(effects, bound.flags);
  }
  const first = receipts.length ? ORACLE_SURFACE_RECEIPTS.get(receipts[0]).counters_before : {};
  const last = receipts.length ? ORACLE_SURFACE_RECEIPTS.get(receipts.at(-1)).counters_after : {};
  effects.fresh_reader_processes_observed = last.fresh_reader_processes || 0;
  for (const key of ['launch_calls', 'atomic_batch_commit_calls', 'mutation_dispatch_calls', 'stage_calls', 'commit_calls', 'complete_calls', 'release_successes', 'fresh_reader_processes', 'crash_processes', 'concurrent_processes', 'recovery_calls']) {
    effects[key] = (last[key] || 0) - (first[key] || 0);
  }
  effects.production_surface_calls = new Set(receipts.filter((receipt) => {
    const bound = ORACLE_SURFACE_RECEIPTS.get(receipt);
    return bound && bound.setup !== true && bound.target_type !== 'observed-production-invariant';
  }).map((receipt) => ORACLE_SURFACE_RECEIPTS.get(receipt).case_identity)).size;
  return effects;
}

function aggregateOracleCounts(harness, baseline) {
  const total = oracleCounts(null);
  for (const [store, before] of harness.storeBaselines) {
    const observed = oracleCounts(store);
    const values = baseline ? before : observed;
    for (const key of Object.keys(total)) total[key] += values[key] || 0;
  }
  return total;
}

const ORACLE_PERSISTED_DELTA_KEYS = Object.freeze([
  'artifacts_delta', 'packet_events_delta', 'web_acceptance_events_delta', 'readback_events_delta',
  'current_readback_events_delta', 'consumer_completed_events_delta', 'backfill_events_delta',
  'semantic_admissions_delta', 'dispatch_intents_delta', 'dispatch_confirmed_delta',
  'dispatch_not_started_delta', 'allocations_delta', 'receipts_delta', 'mutation_operations_delta',
  'mutation_operation_events_delta',
]);

function oracleEffectsHaveNoPersistentChange(effects) {
  return ORACLE_PERSISTED_DELTA_KEYS.every((key) => effects[key] === 0)
    && effects.tracked_objects.every((item) => item.unchanged === true);
}

function oracleEffectsHaveOnlyCurrentProjectionReadback(effects, currentCall) {
  const expectedReadbacks = currentCall && currentCall.returned_value
    && Array.isArray(currentCall.returned_value.readback_event_ids)
    ? currentCall.returned_value.readback_event_ids.length : 0;
  if (!expectedReadbacks || effects.current_readback_events_delta !== expectedReadbacks
    || effects.packet_events_delta !== expectedReadbacks
    || ORACLE_PERSISTED_DELTA_KEYS.some((key) => !['packet_events_delta', 'current_readback_events_delta'].includes(key)
      && effects[key] !== 0)) return false;
  let observedReadbacks = 0;
  for (const item of effects.tracked_objects) {
    for (const [tableName, table] of Object.entries(item.tables)) {
      const countDelta = table.after_count - table.before_count;
      const identityDelta = table.new_identities.length;
      if (tableName === 'authority_packet_events' && countDelta >= 0
        && identityDelta === countDelta && table.removed_identities.length === 0) {
        observedReadbacks += countDelta;
      } else if (countDelta !== 0 || identityDelta !== 0 || table.removed_identities.length !== 0
        || table.before_digest !== table.after_digest) return false;
    }
  }
  return observedReadbacks === expectedReadbacks;
}

function oracleCurrentReadbackProof(projection, returned, beforeSnapshot, afterSnapshot) {
  if (!projection || !returned || !beforeSnapshot || !afterSnapshot
    || !Array.isArray(projection.predecessors) || !Array.isArray(returned.readback_event_ids)) {
    return { passed: false, failure: 'RETURN_SHAPE' };
  }
  if (returned.projection_digest !== runtime.digestValue(projection)) return { passed: false, failure: 'PROJECTION_DIGEST' };
  if (!/^[a-f0-9]{64}$/.test(returned.body_digest || '')
    || !Number.isSafeInteger(returned.revision) || returned.revision < 1) {
    return { passed: false, failure: 'BODY_DIGEST_OR_REVISION' };
  }
  if (runtime.canonicalSerialize(returned.projection) !== runtime.canonicalSerialize(projection)) {
    return { passed: false, failure: 'PROJECTION_VALUE' };
  }
  const beforeProofs = beforeSnapshot.tables.authority_packet_events?.event_proofs || [];
  const afterProofs = afterSnapshot.tables.authority_packet_events?.event_proofs || [];
  const beforeIds = new Set(beforeProofs.map((event) => event.event_id));
  const expected = projection.predecessors.map((predecessor) => ({
    packet_id: predecessor.packet_id,
    payload: {
      projection_digest: returned.projection_digest,
      body_digest: returned.body_digest,
      revision: returned.revision,
      acceptance_event_ids: [predecessor.acceptance_event_id],
    },
  })).sort((left, right) => left.packet_id.localeCompare(right.packet_id));
  const newEvents = afterProofs.filter((event) => event.event_type === 'CURRENT_READBACK' && !beforeIds.has(event.event_id));
  if (expected.length === 0 || returned.readback_event_ids.length !== expected.length) {
    return { passed: false, failure: `EVENT_COUNTS_${expected.length}_${newEvents.length}_${returned.readback_event_ids.length}` };
  }
  const matchedEvents = expected.map(({ packet_id, payload }) => afterProofs.find((candidate) => candidate.packet_id === packet_id
      && candidate.event_type === 'CURRENT_READBACK'
      && candidate.payload_digest === runtime.digestValue(payload)
      && candidate.event_digest_verified === true && candidate.event_key_verified === true));
  const eventIds = matchedEvents.map((event) => event && event.event_id);
  if (eventIds.some((eventId) => typeof eventId !== 'string')) return { passed: false, failure: 'EVENT_PAYLOAD' };
  if (runtime.canonicalSerialize(eventIds.slice().sort())
    !== runtime.canonicalSerialize(returned.readback_event_ids.slice().sort())) {
    return { passed: false, failure: 'RETURNED_EVENT_IDS' };
  }
  const replayed = matchedEvents.every((event) => beforeIds.has(event.event_id));
  const created = matchedEvents.every((event) => !beforeIds.has(event.event_id));
  if (replayed && runtime.canonicalSerialize(beforeSnapshot) === runtime.canonicalSerialize(afterSnapshot)) {
    return { passed: true, failure: null, replayed: true, created: false };
  }
  if (created && newEvents.length === expected.length) {
    return { passed: true, failure: null, replayed: false, created: true };
  }
  return { passed: false, failure: `EVENT_NOT_ATOMIC_${expected.length}_${newEvents.length}`, replayed: false, created: false };
}

function oracleEffectsHaveNoConsequence(effects) {
  return oracleEffectsHaveNoPersistentChange(effects)
    && effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0
    && effects.stage_calls === 0 && effects.commit_calls === 0
    && effects.complete_calls === 0 && effects.release_successes === 0;
}

function oracleCallWithMethod(calls, method, ordinal = 0) {
  return calls.filter((call) => call.method === method)[ordinal] || null;
}

function oracleCallFlag(call, name) {
  return !!call && !!call.effect_delta && call.effect_delta[name] === true;
}

function oracleCallTableDelta(call, table) {
  const before = call && call.object_before && call.object_before.tables && call.object_before.tables[table];
  const after = call && call.object_after && call.object_after.tables && call.object_after.tables[table];
  if (!before || !after) return null;
  return { delta: after.count - before.count, before, after };
}

function oracleAllCallBindingsObserved(calls) {
  return calls.length > 0 && calls.every((call) => typeof call.argument_binding_digest === 'string'
    && /^[a-f0-9]{64}$/.test(call.argument_binding_digest));
}

function oracleManifestEffectMatches(effectRule, effects, actual, calls, caseValue) {
  const delta = (key) => effects[`${key}_delta`] ?? 0;
  const noDispatch = delta('dispatch_intents') === 0 && delta('dispatch_confirmed') === 0
    && delta('dispatch_not_started') === 0 && effects.launch_calls === 0
    && effects.mutation_dispatch_calls === 0;
  const noPacketAcceptance = delta('web_acceptance_events') === 0 && delta('readback_events') === 0;
  const packetCall = oracleCallWithMethod(calls, 'persistAuthorityPacket');
  const acceptanceCalls = calls.filter((call) => call.method === 'bindWebPacketAcceptance');
  const admissionCall = oracleCallWithMethod(calls, 'admitSemanticGate');
  const currentCall = oracleCallWithMethod(calls, 'confirmCurrentPacketProjection');
  const operationCall = oracleCallWithMethod(calls, 'admitMutationOperation');
  switch (effectRule) {
    case 'Z':
      if (caseValue.expected.side_effects === 'zero-artifacts'
        && caseValue.input.variant === 'writer-killed-before-commit') {
        const unchangedRows = effects.tracked_objects.length > 0 && effects.tracked_objects.every((item) =>
          Object.values(item.tables).every((table) => table.before_count === table.after_count
            && table.before_digest === table.after_digest
            && table.new_identities.length === 0 && table.removed_identities.length === 0));
        return actual.outcome === 'REJECT' && actual.code === caseValue.expected.reason_code
          && effects.crash_processes === 1 && delta('artifacts') === 0
          && delta('packet_events') === 0 && delta('web_acceptance_events') === 0
          && delta('readback_events') === 0 && delta('semantic_admissions') === 0
          && noDispatch && unchangedRows && oracleAllCallBindingsObserved(calls);
      }
      if (caseValue.expected.side_effects === 'no-launch'
        && caseValue.surface === 'receipt.allocateRun->startAllocatedRun') {
        const allocation = oracleCallWithMethod(calls, 'allocateRun');
        const start = oracleCallWithMethod(calls, 'startAllocatedRun');
        const rejectedStartUnchanged = !!start && !!start.object_before && !!start.object_after
          && runtime.canonicalSerialize(start.object_before) === runtime.canonicalSerialize(start.object_after);
        return actual.outcome === 'REJECT' && actual.code === caseValue.expected.reason_code
          && calls.length === 2 && !!allocation && allocation.actual.outcome === 'ACCEPT'
          && oracleCallFlag(allocation, 'allocation_witness')
          && !!start && start.actual.outcome === 'REJECT' && start.actual.code === caseValue.expected.reason_code
          && rejectedStartUnchanged && delta('allocations') === 1 && delta('receipts') === 0
          && delta('mutation_operations') === 0 && delta('mutation_operation_events') === 0
          && delta('dispatch_intents') === 0 && delta('dispatch_confirmed') === 0
          && delta('dispatch_not_started') === 0 && effects.launch_calls === 0
          && effects.atomic_batch_commit_calls === 0 && effects.mutation_dispatch_calls === 0
          && effects.stage_calls === 0 && effects.commit_calls === 0 && effects.complete_calls === 0
          && effects.release_successes === 0 && oracleAllCallBindingsObserved(calls);
      }
      return oracleEffectsHaveNoConsequence(effects) && oracleAllCallBindingsObserved(calls)
        && (caseValue.requirement_id !== 'X05' || effects.import_order_witness === true);
    case 'PURE':
      return oracleEffectsHaveNoConsequence(effects) && oracleAllCallBindingsObserved(calls);
    case 'NEW': {
      const table = oracleCallTableDelta(packetCall, 'authority_packets');
      const events = oracleCallTableDelta(packetCall, 'authority_packet_events');
      return !!packetCall && packetCall.returned_value && packetCall.returned_value.duplicate === false
        && oracleCallFlag(packetCall, 'new_packet_witness') && oracleCallFlag(packetCall, 'byte_equal_readback')
        && !!table && table.delta === 1 && !!events && events.delta === 0
        && delta('artifacts') === 1 && delta('packet_events') === 0 && noDispatch
        && oracleAllCallBindingsObserved(calls);
    }
    case 'PRESERVE':
      return oracleEffectsHaveNoPersistentChange(effects) && noDispatch
        && effects.tracked_objects.every((item) => Object.values(item.tables).every((table) =>
          table.new_identities.length === 0 && table.removed_identities.length === 0
          && table.before_digest === table.after_digest))
        && (caseValue.requirement_id !== 'H04' || effects.custody_attack_witness === true)
        && oracleAllCallBindingsObserved(calls);
    case 'RB0':
      return actual.outcome === 'REJECT' && noPacketAcceptance
        && oracleEffectsHaveNoConsequence(effects)
        && acceptanceCalls.length === 1 && !oracleCallFlag(acceptanceCalls[0], 'readback_verified')
        && !oracleCallFlag(acceptanceCalls[0], 'acceptance_event_verified');
    case 'RB1':
      return actual.outcome === 'REJECT' && delta('readback_events') === 1
        && delta('web_acceptance_events') === 0 && delta('packet_events') === 1
        && acceptanceCalls.length === 1 && oracleCallFlag(acceptanceCalls[0], 'readback_verified')
        && !oracleCallFlag(acceptanceCalls[0], 'acceptance_event_verified')
        && noDispatch;
    case 'ACC':
      return acceptanceCalls.length === 1 && delta('readback_events') === 1
        && delta('web_acceptance_events') === 1 && delta('packet_events') === 2
        && oracleCallFlag(acceptanceCalls[0], 'readback_verified')
        && oracleCallFlag(acceptanceCalls[0], 'acceptance_event_verified')
        && oracleCallFlag(acceptanceCalls[0], 'bound_acceptance') && noDispatch;
    case 'STORE': {
      const initCall = oracleCallWithMethod(calls, 'initialiseAuthorityPacketStore');
      const store = initCall && initCall.returned_value;
      if (!store || typeof store.databasePath !== 'string' || !store.namespace
        || runtime.assertAuthenticAuthorityPacketStore(store) !== true) return false;
      const db = new DatabaseSync(store.databasePath, { readOnly: true });
      try {
        const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
        const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
        const packetRows = tables.has('authority_packets') ? db.prepare('SELECT COUNT(*) AS n FROM authority_packets').get().n : -1;
        const admissions = tables.has('semantic_gate_admissions') ? db.prepare('SELECT COUNT(*) AS n FROM semantic_gate_admissions').get().n : -1;
        return !!metadata && metadata.repository === store.namespace.repository
          && metadata.parent_issue === store.namespace.parent_issue && metadata.child_issue === store.namespace.child_issue
          && metadata.schema_fingerprint === runtime.expectedAuthorityPacketSchemaFingerprint()
          && delta('packet_events') === 0 && delta('semantic_admissions') === 0
          && oracleCallFlag(initCall, 'store_ready')
          && oracleCallFlag(initCall, 'store_schema_verified')
          && noPacketAcceptance && noDispatch;
      } finally { db.close(); }
    }
    case 'STOREID':
      return calls.length === 1 && calls[0].method === 'authorityPacketStoreIdentity'
        && oracleCallFlag(calls[0], 'identity_match') && typeof calls[0].returned_value === 'string'
        && /^[a-f0-9]{64}$/.test(calls[0].returned_value)
        && oracleEffectsHaveNoConsequence(effects);
    case 'READ': {
      const readMethods = new Set([
        'verifyAuthorityPacketFresh', 'readAuthorityPacket', 'validateAuthorityPacketDelivery',
        'revalidateSemanticGate', 'REOPEN',
      ]);
      const hasReadSurface = calls.some((call) => readMethods.has(call.method));
      const exactRead = calls.some((call) => oracleCallFlag(call, 'byte_equal_readback')
        || oracleCallFlag(call, 'original_retained'));
      const freshRevalidation = calls.some((call) => call.method === 'revalidateSemanticGate')
        && effects.fresh_reader_processes_observed > 0;
      const freshProcessRequired = calls.some((call) => ['revalidateSemanticGate', 'REOPEN'].includes(call.method));
      return hasReadSurface && (exactRead || freshRevalidation)
        && (!freshProcessRequired || effects.fresh_reader_processes_observed > 0)
        && oracleAllCallBindingsObserved(calls)
        && oracleEffectsHaveNoPersistentChange(effects) && noDispatch;
    }
    case 'ACCREPLAY':
      return acceptanceCalls.length === 2 && delta('readback_events') === 1
        && delta('web_acceptance_events') === 1 && delta('packet_events') === 2
        && oracleCallFlag(acceptanceCalls[0], 'acceptance_event_verified')
        && oracleCallFlag(acceptanceCalls[1], 'acceptance_replay_verified')
        && acceptanceCalls[1].returned_value && acceptanceCalls[1].returned_value.duplicate === true
        && oracleCallTableDelta(acceptanceCalls[1], 'authority_packet_events')?.delta === 0
        && noDispatch;
    case 'CUR': {
      const projectionCall = oracleCallWithMethod(calls, 'buildCurrentPacketProjection');
      if (projectionCall) return oracleCallFlag(projectionCall, 'projection_bounded')
        && oracleCallFlag(projectionCall, 'candidate_bound') && oracleEffectsHaveNoConsequence(effects);
      return !!currentCall && oracleCallFlag(currentCall, 'bound_current')
        && oracleCallFlag(currentCall, 'current_readback_created')
        && delta('current_readback_events') === currentCall.returned_value.readback_event_ids.length
        && noDispatch;
    }
    case 'REPLAYCHAIN': {
      const replayCall = packetCall;
      const firstAcceptance = acceptanceCalls[0];
      const acceptanceReplay = acceptanceCalls[1];
      const projectionCall = oracleCallWithMethod(calls, 'buildCurrentPacketProjection');
      const currentCalls = calls.filter((call) => call.method === 'confirmCurrentPacketProjection');
      return !!replayCall && oracleCallFlag(replayCall, 'packet_replay_verified')
        && replayCall.returned_value && replayCall.returned_value.duplicate === true
        && acceptanceCalls.length === 2 && oracleCallFlag(firstAcceptance, 'acceptance_event_verified')
        && oracleCallFlag(acceptanceReplay, 'acceptance_replay_verified')
        && !!projectionCall && oracleCallFlag(projectionCall, 'projection_bounded')
        && currentCalls.length === 2 && oracleCallFlag(currentCalls[0], 'current_readback_created')
        && oracleCallFlag(currentCalls[1], 'current_readback_replayed')
        && delta('artifacts') === 0 && delta('readback_events') === 1
        && delta('web_acceptance_events') === 1 && delta('current_readback_events') === projectionCall.returned_value.predecessors.length
        && noDispatch;
    }
    case 'SHRINK':
      return !!currentCall && oracleCallFlag(currentCall, 'bound_current')
        && oracleCallFlag(currentCall, 'current_readback_created')
        && delta('artifacts') === 0 && delta('current_readback_events') === currentCall.returned_value.readback_event_ids.length
        && effects.tracked_objects.every((item) => item.tables.authority_packets.new_identities.length === 0
          && item.tables.authority_packets.removed_identities.length === 0)
        && noDispatch;
    case 'RECOVER': {
      const recovered = oracleCallWithMethod(calls, 'recoverSemanticGateAdmission');
      return !!recovered && oracleCallFlag(recovered, 'recovered_handle')
        && delta('semantic_admissions') === 0 && delta('dispatch_intents') === 0
        && delta('dispatch_confirmed') === 0 && delta('consumer_completed_events') === 0
        && effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0;
    }
    case 'REPLAY':
      return !!packetCall && oracleCallFlag(packetCall, 'packet_replay_verified')
        && packetCall.returned_value && packetCall.returned_value.duplicate === true
        && delta('artifacts') === 0 && delta('packet_events') === 0 && noDispatch;
    case 'RACE':
      return effects.race_witness === true && effects.concurrent_processes === 2
        && delta('artifacts') === 1 && delta('packet_events') === 0 && noDispatch;
    case 'SERIAL':
      return calls.length === 3 && calls[0].method === 'persistAuthorityPacket'
        && oracleCallFlag(calls[0], 'new_packet_witness')
        && calls[1].actual.outcome === 'REJECT' && calls[1].actual.code === 'GPR_PACKET_CONFLICT'
        && oracleCallFlag(calls[2], 'acceptance_event_verified')
        && delta('artifacts') === 1 && delta('web_acceptance_events') === 1
        && delta('readback_events') === 1 && noDispatch;
    case 'DISP':
      return effects.dispatch_witness === true && delta('dispatch_intents') === 1
        && delta('dispatch_confirmed') === 1 && delta('dispatch_not_started') === 0
        && effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0;
    case 'ADM':
    case 'ADM0':
      return !!admissionCall && oracleCallFlag(admissionCall, 'semantic_admission_witness')
        && delta('semantic_admissions') === 1 && noDispatch
        && (caseValue.requirement_id !== 'X05' || effects.import_order_witness === true)
        && (effectRule !== 'ADM0' || admissionCall.returned_value.proof.dependency_state === 'NO_PREDECESSOR'
          && admissionCall.returned_value.proof.predecessors.length === 0);
    case 'CAPREAD': {
      const read = oracleCallWithMethod(calls, 'readAuthorityPacket');
      const write = calls.find((call) => call.method === 'persistAuthorityPacket' && call.actual.outcome === 'REJECT');
      return !!read && !!write && oracleCallFlag(read, 'byte_equal_readback')
        && oracleCallFlag(read, 'original_retained') && delta('artifacts') === 0
        && oracleEffectsHaveNoConsequence(effects);
    }
    case 'BACK':
      return effects.backfill_witness === true
        && oracleCallFlag(oracleCallWithMethod(calls, 'backfillAuthorityPacket'), 'backfill_witness')
        && oracleCallFlag(oracleCallWithMethod(calls, 'backfillAuthorityPacket'), 'byte_equal_readback')
        && delta('artifacts') === 1
        && delta('backfill_events') === 1 && delta('readback_events') === 1
        && effects.fresh_reader_processes_observed > 0 && noDispatch;
    case 'DBBYTES':
      return actual.outcome === 'REJECT' && oracleEffectsHaveNoPersistentChange(effects)
        && calls.every((call) => call.object_before && call.object_after
          && call.object_before.database_bytes_digest === call.object_after.database_bytes_digest
          && runtime.canonicalSerialize(call.object_before.sidecar_digests) === runtime.canonicalSerialize(call.object_after.sidecar_digests));
    case 'MIG':
      return effects.migration_witness === true && delta('artifacts') === 0
        && delta('packet_events') === 0 && noDispatch;
    case 'BIGREAD':
      return calls.some((call) => oracleCallFlag(call, 'over_legacy_limit')
        && oracleCallFlag(call, 'byte_equal_readback'))
        && effects.fresh_reader_processes_observed > 0 && delta('allocations') === 0
        && delta('receipts') === 0 && delta('mutation_operations') === 0;
    case 'RECOVERBEGIN':
      return effects.recovered_handle === true && delta('dispatch_not_started') === 1
        && delta('dispatch_intents') === 1 && delta('dispatch_confirmed') === 0
        && delta('semantic_admissions') === 0 && effects.launch_calls === 0
        && effects.mutation_dispatch_calls === 0 && delta('consumer_completed_events') === 0;
    case 'LEGACY':
      return effects.legacy_bytes_witness === true && oracleEffectsHaveNoPersistentChange(effects)
        && noDispatch;
    case 'CURLEGACY': {
      const projectionCall = oracleCallWithMethod(calls, 'buildCurrentPacketProjection');
      const currentCall = oracleCallWithMethod(calls, 'confirmCurrentPacketProjection');
      const readbackProof = oracleCurrentReadbackProof(projectionCall && projectionCall.returned_value,
        currentCall && currentCall.returned_value, currentCall && currentCall.object_before,
        currentCall && currentCall.object_after);
      const readbackEffects = readbackProof.replayed
        ? oracleEffectsHaveNoPersistentChange(effects)
        : oracleEffectsHaveOnlyCurrentProjectionReadback(effects, currentCall);
      return effects.current_legacy_witness === true
        && oracleCallFlag(projectionCall, 'projection_bounded')
        && readbackProof.passed && readbackEffects && noDispatch;
    }
    case 'INTEGRATION':
      return effects.compiler_results_verified === true && effects.shipping_results_verified === true
        && effects.oracle_inventory_verified === true && noDispatch;
    default:
      if (ORACLE_EXPANDED_SURFACE_CODES_V1.some(([code]) => code === effectRule)) {
        return oracleExpandedEffectMatches(effectRule, effects, actual, calls, caseValue);
      }
      return false;
  }
}

function oracleExpandedEffectMatches(effectRule, effects, actual, calls, caseValue) {
  const delta = (key) => effects[`${key}_delta`] ?? 0;
  const noDispatch = delta('dispatch_intents') === 0 && delta('dispatch_confirmed') === 0
    && delta('dispatch_not_started') === 0 && effects.launch_calls === 0
    && effects.mutation_dispatch_calls === 0;
  if (actual.outcome !== 'ACCEPT' || !oracleAllCallBindingsObserved(calls)) return false;
  switch (effectRule) {
    case 'S01': return oracleCallFlag(oracleCallWithMethod(calls, 'startRun'), 'started_run_witness')
      && delta('allocations') === 1 && delta('receipts') === 1 && noDispatch;
    case 'S02': return oracleCallFlag(oracleCallWithMethod(calls, 'allocateRun'), 'allocation_witness')
      && oracleCallFlag(oracleCallWithMethod(calls, 'startAllocatedRun'), 'started_run_witness')
      && delta('allocations') === 1 && delta('receipts') === 1 && noDispatch;
    case 'S03': return oracleCallFlag(oracleCallWithMethod(calls, 'admitMutationOperation'), 'operation_witness')
      && delta('mutation_operations') === 1 && delta('mutation_operation_events') === 2 && noDispatch;
    case 'S04': return effects.operation_witness === true
      && calls.length === 2 && calls[1].actual.outcome === 'REJECT'
      && calls[1].actual.code === 'GPR_ADMISSION_CONSUMED'
      && delta('mutation_operations') === 1 && delta('mutation_operation_events') === 2 && noDispatch;
    case 'S05': return effects.loop_admission_witness === true && effects.fresh_reader_processes_observed > 0 && noDispatch;
    case 'S06': return effects.retry_witness === true && effects.fresh_reader_processes_observed > 0 && noDispatch;
    case 'S07': return effects.transition_witness === true && noDispatch;
    case 'S08': return effects.transition_witness === true && effects.fresh_reader_processes_observed > 0 && noDispatch;
    case 'S09':
    case 'S10': return effects.delegated_run_witness === true && delta('dispatch_intents') === 1
      && delta('dispatch_confirmed') + delta('dispatch_not_started') === 1
      && effects.atomic_batch_commit_calls === 1
      && effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0;
    case 'S11':
    case 'S12': return effects.git_commit_witness === true && effects.stage_calls === 1
      && effects.commit_calls === 1 && noDispatch;
    case 'S13':
    case 'S15': return effects.terminal_completion_witness === true && effects.complete_calls === 1
      && delta('consumer_completed_events') === 1 && noDispatch;
    case 'S14': return effects.terminal_transition_witness === true
      && oracleEffectsHaveNoPersistentChange(effects) && noDispatch;
    case 'S16': return effects.lease_release_witness === true && effects.release_successes === 1 && noDispatch;
    case 'S17': return effects.preview_receipt_witness === true && delta('receipts') === 1
      && effects.release_successes === 0 && noDispatch;
    case 'S18': return effects.assurance_admission_witness === true
      && effects.fresh_reader_processes_observed > 0 && noDispatch;
    case 'S19':
    case 'S20':
    case 'S21':
    case 'S22':
    case 'S23': return effects.assurance_evaluation_witness === true
      && oracleEffectsHaveNoPersistentChange(effects) && noDispatch;
    default: return false;
  }
}

function oracleExpectedEffectMatches(label, effects, actual, productionSurface) {
  const delta = (key) => effects[`target_${key}_delta`] ?? effects[`${key}_delta`] ?? 0;
  const after = (key) => effects[`target_${key}_after`] ?? effects[`${key}_after`];
  switch (label) {
    case 'zero-artifacts':
    case 'no-artifact':
    case 'no-duplicate-artifact':
      return delta('artifacts') === 0;
    case 'one-artifact':
    case 'one-immutable-artifact':
    case 'one-complete-row':
    case 'one-row':
    case 'same-id-one-row':
    case 'local-custody':
      return delta('artifacts') === 1 || (delta('artifacts') === 0 && after('artifacts') === 1);
    case 'at-most-one-artifact':
    case 'one-winner':
      return after('artifacts') <= 1;
    case 'one-acceptance':
    case 'one-acceptance-event':
    case 'one-acceptance-identity':
      return delta('web_acceptance_events') === 1;
    case 'bound-acceptance':
      return effects.bound_acceptance === true;
    case 'bound-current':
      return effects.bound_current === true;
    case 'existing-readable':
      return effects.original_retained === true;
    case 'original-producer-retained':
      return effects.original_producer_retained === true;
    case 'no-acceptance-event':
      return delta('web_acceptance_events') === 0;
    case 'one-current-readback':
      return delta('current_readback_events') === 1;
    case 'one-admission-record':
      return delta('semantic_admissions') === 1;
    case 'admission-issued':
      return effects.semantic_admissions_after >= 1;
    case 'recovered-handle':
      return effects.recovered_handle === true;
    case 'no-admission':
      return delta('semantic_admissions') === 0;
    case 'one-intent':
      return effects.production_surface_calls === 1
        && (delta('dispatch_intents') === 1 || delta('semantic_admissions') === 1
          || delta('allocations') === 1 || delta('receipts') === 1 || delta('mutation_operations') === 1
          || effects.semantic_admissions_after >= 1 || effects.fresh_reader_processes_observed === 1
          || effects.launch_calls > 0 || effects.mutation_dispatch_calls > 0 || effects.stage_calls > 0
          || effects.commit_calls > 0 || effects.complete_calls > 0 || effects.release_successes > 0);
    case 'no-dispatch':
    case 'zero-dispatch':
      return delta('dispatch_confirmed') === 0 && delta('dispatch_not_started') === 0;
    case 'one-recorded-outcome':
      return delta('dispatch_confirmed') + delta('dispatch_not_started') === 1;
    case 'one-readback-one-acceptance':
      return delta('readback_events') === 1 && delta('web_acceptance_events') === 1;
    case 'no-launch':
    case 'no-relaunch':
      return effects.launch_calls === 0;
    case 'zero-side-effects':
      return [
        'artifacts_delta', 'packet_events_delta', 'web_acceptance_events_delta', 'readback_events_delta',
        'current_readback_events_delta', 'consumer_completed_events_delta', 'semantic_admissions_delta',
        'dispatch_intents_delta', 'dispatch_confirmed_delta', 'dispatch_not_started_delta',
        'receipts_delta', 'mutation_operations_delta', 'mutation_operation_events_delta',
        'consumable_completion_delta', 'safe_release_delta',
      ].every((key) => (effects[key] || 0) === 0)
        && effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0
        && effects.stage_calls === 0 && effects.commit_calls === 0;
    case 'none':
      return Object.keys(effects).every((key) => !key.endsWith('_delta') || effects[key] === 0)
        && effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0
        && effects.stage_calls === 0 && effects.commit_calls === 0;
    case 'byte-equal-delivery':
    case 'exact-preserved':
    case 'exact-roundtrip':
    case 'exactly-retrievable':
    case 'original-retained':
    case 'original-unchanged':
    case 'projection-preserved':
    case 'legacy-bytes-preserved':
    case 'v2-unchanged':
    case 'v4-historical-preserved':
      return effects.byte_equal_readback === true;
    case 'read-only-proof':
    case 'fresh-proof':
      return effects.fresh_reader_processes_observed > 0;
    case 'fresh-authority-bound':
      return effects.fresh_authority_bound === true;
    case 'deterministic-identities':
    case 'stable-store-identity':
      return effects.identity_match === true;
    case 'no-projection':
      return delta('current_readback_events') === 0;
    case 'no-recovery':
      return actual.outcome === 'REJECT' && effects.recovered_handle !== true;
    case 'no-acceptance':
      return delta('web_acceptance_events') === 0;
    case 'bounded-projection':
      return effects.projection_bounded === true;
    case 'candidate-blocked':
      return actual.outcome === 'REJECT' && delta('semantic_admissions') === 0;
    case 'candidate-bound':
      return actual.outcome === 'ACCEPT' && effects.candidate_bound === true;
    case 'compiler-and-shipping-green':
      return effects.preservation_tests === true;
    case 'fresh-custody':
      return (delta('consumer_completed_events') === 1 || delta('backfill_events') === 1)
        && effects.fresh_reader_processes_observed > 0;
    case 'custody-retained':
    case 'required-row-retained':
      return after('artifacts') >= 1;
    case 'custody-unchanged':
      return delta('current_readback_events') === 0;
    case 'ordinary-validation':
    case 'complete-api':
    case 'recordable-decision':
    case 'store-ready':
      return actual.outcome === 'ACCEPT';
    case 'store-blocked':
    case 'finality-blocked':
      return actual.outcome === 'REJECT';
    case 'screened':
      return effects.screened === true;
    case 'reopen-verified':
      return effects.byte_equal_readback === true;
    case 'byte-equal-delivery':
      return effects.byte_equal_readback === true && effects.fresh_reader_processes_observed > 0;
    case 'one-json-line':
      return effects.one_json_line === true;
    case 'legacy-pass-retained':
      return effects.legacy_pass_retained === true;
    case 'v2-unchanged':
    case 'v4-historical-preserved':
    case 'exactly-retrievable':
    case 'original-retained':
    case 'original-unchanged':
    case 'exact-preserved':
    case 'exact-roundtrip':
    case 'projection-preserved':
    case 'legacy-bytes-preserved':
      return effects.byte_equal_readback === true;
    case 'no-authority-mint':
    case 'no-bypass':
      return delta('semantic_admissions') === 0 && delta('dispatch_intents') === 0;
    case 'no-delete':
    case 'no-grandfathering':
      return delta('artifacts') === 0;
    case 'no-network-fallback':
      return effects.launch_calls === 0 && effects.mutation_dispatch_calls === 0;
    case 'new-attempt-permitted':
      return delta('dispatch_intents') === 1;
    case 'no-blind-repeat':
      return delta('current_readback_events') === 0;
    case 'local-custody':
      return effects.store_ready === true;
    case 'distinct-bound-consumer':
      return effects.admission_issued === true;
    case 'run-started-limit-unchanged':
      return delta('receipts') === 0;
    case 'same-id-one-row':
      return after('artifacts') === 1;
    case 'one-winner':
    case 'at-most-one-artifact':
      return effects.artifacts_after <= 1;
    default:
      return false;
  }
}

function producerAdmission(packetValue, overrides = {}) {
  return {
    bindings: structuredClone(packetValue.bindings),
    authority: structuredClone(packetValue.bindings.authority),
    producer: structuredClone(packetValue.bindings.producer),
    candidate: packetValue.bindings.candidate,
    screening: screening(packetValue),
    ...overrides
  };
}

function semanticGate(seed = 'loop', readerOverrides = {}, fixtureOptions = {}) {
  const packetBindings = bindings(`loop-${seed}`);
  const candidate = fixtureOptions.candidate === undefined ? packetBindings.candidate : fixtureOptions.candidate;
  packetBindings.candidate = candidate === null ? null : structuredClone(candidate);
  let required = fixtureOptions.noPredecessor === true ? [] : packetBindings.applicability.required_consumers;
  if (fixtureOptions.scope_digest) {
    required = required.map((item) => ({ ...item, scope_digest: fixtureOptions.scope_digest }));
  }
  packetBindings.applicability.required_consumers = structuredClone(required);
  const packetValue = packet({ bindings: packetBindings });
  const storeOptions = options(fixtureOptions.stateRoot || stateRoot(`authority-loop-${seed}-`));
  let current = null;
  let currentBodyDigest = runtime.digestValue({ seed, body: 'current' });
  const initialCurrentBodyDigest = currentBodyDigest;
  let authoritySource = structuredClone(packetBindings.authority);
  const { producer_authority: _producerAuthority, completion_applicability: _completionApplicability, ...gateReaderFunctions } = readerOverrides;
  const readAuthority = gateReaderFunctions.readAuthority || (() => ({
    authority: structuredClone(authoritySource),
    required_consumers: structuredClone(required),
    ...(fixtureOptions.noPredecessor === true ? { no_predecessor_classification: true } : {}),
    later_controlling_comments: [],
  }));
  const readersForGate = readers(packetValue, {
    readCandidate: () => candidate,
    readWebDecision: () => webDecision(packetValue, required),
    readCurrent: () => ({
      current,
      projection_digest: runtime.digestValue(current),
      body_digest: currentBodyDigest,
      revision: 1,
    }),
    readDispatchOutcome: (input) => {
      const observed = input.status || (input.transport_error ? 'not-started' : 'confirmed');
      const transportDigest = input.transport_digest || runtime.digestValue({
        admission_id: input.admission_id,
        intent_event_id: input.intent_event_id,
        transport_id: input.transport_id,
        outcome: observed,
      });
      return {
        admission_id: input.admission_id,
        consumer_key: input.consumer_key,
        intent_event_id: input.intent_event_id,
        attempt: input.attempt,
        transport_id: input.transport_id,
        transport_digest: transportDigest,
        outcome: observed,
        delayed_completion_excluded: observed === 'not-started',
      };
    },
    ...gateReaderFunctions,
    readAuthority,
    producer_authority: readerOverrides.producer_authority,
    completion_applicability: readerOverrides.completion_applicability,
    no_predecessor: fixtureOptions.noPredecessor === true,
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readersForGate);
  const persisted = store.persistAuthorityPacket(packetValue, producerAdmission(packetValue));
  if (fixtureOptions.bindAcceptance !== false) store.bindWebPacketAcceptance(persisted.packet_id, readersForGate);
  const intent = {
    repository: packetValue.bindings.repository,
    parent_issue: packetValue.bindings.parent_issue,
    child_issue: packetValue.bindings.child_issue,
    lane_id: packetValue.bindings.lane_id,
    human_owner: packetValue.bindings.human_owner,
    consumer: {
      run: `semantic-${seed}`,
      lock: `lock-${seed}`,
      stage: 'G3',
      role: 'G3',
      scope_digest: fixtureOptions.scope_digest || required[0]?.scope_digest || runtime.digestValue({ seed, scope: 'consumer' }),
    },
    candidate: null,
    execution_binding: {
      semantic_run: null,
      receipt_run_id: null,
      loop_run_id: `loop-${seed}`,
      repository_id: 'b'.repeat(64),
      authorized_ref_digest: 'c'.repeat(64),
      current_authority_digest: 'd'.repeat(64),
    },
    predecessors: required.length === 0 ? [] : [{ packet_id: persisted.packet_id, dependency_id: required[0].dependency_id }],
    operation: 'loop',
  };
  if (fixtureOptions.buildCurrent !== false) current = store.buildCurrentPacketProjection(intent, readersForGate);
  if (fixtureOptions.confirmCurrent !== false) store.confirmCurrentPacketProjection(current, readersForGate);
  trackOracleAuthorityStore(store);
  return {
    packetValue,
    persisted,
    store,
    consumer_intent: intent,
    trusted_readers: readersForGate,
    storeOptions,
    setCurrentBodyDigest(value) { currentBodyDigest = value; },
    resetCurrentBodyDigest() { currentBodyDigest = initialCurrentBodyDigest; },
    setCurrentProjection(value) { current = structuredClone(value); },
    setAuthoritySource(value) { authoritySource = structuredClone(value); },
  };
}

let assuranceSequence = 0;

function assuranceCandidate(value = null) {
  if (value === null) return null;
  return {
    pr_number: 354,
    branch: 'c1-g3-assurance',
    base_ref: 'main',
    base_sha: value.base,
    head_sha: value.head,
    tree_sha: value.tree,
  };
}

function assuranceReceiptAdmission(overrides = {}) {
  const tuple = overrides.consumer && Object.hasOwn(overrides.consumer, 'candidate')
    ? overrides.consumer.candidate
    : { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) };
  const gate = semanticGate(`assurance-${++assuranceSequence}`, {}, {
    candidate: assuranceCandidate(tuple),
    noPredecessor: overrides.dependency_state !== 'PREDECESSORS_VERIFIED',
    scope_digest: overrides.scope_digest || 'd'.repeat(64),
    stateRoot: overrides.stateRoot,
  });
  const result = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  return { store: gate.store, admission: result.admission, packetValue: gate.packetValue };
}

function oracleSafeSeed(caseId) {
  return runtime.digestValue(String(caseId)).slice(0, 16);
}

function oracleCounts(store) {
  const empty = {
    artifacts: 0, packet_events: 0, web_acceptance_events: 0, readback_events: 0,
    current_readback_events: 0, consumer_completed_events: 0, backfill_events: 0, semantic_admissions: 0,
    dispatch_intents: 0, dispatch_confirmed: 0, dispatch_not_started: 0,
    allocations: 0, receipts: 0, mutation_operations: 0, mutation_operation_events: 0,
  };
  if (!store) return empty;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
    const count = (table, where = '') => tables.has(table)
      ? Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table}${where}`).get().value)
      : 0;
    return {
      artifacts: count('authority_packets'),
      packet_events: count('authority_packet_events'),
      web_acceptance_events: count('authority_packet_events', " WHERE event_type = 'WEB_ACCEPTANCE_BOUND'"),
      readback_events: count('authority_packet_events', " WHERE event_type = 'READBACK_VERIFIED'"),
      current_readback_events: count('authority_packet_events', " WHERE event_type = 'CURRENT_READBACK'"),
      consumer_completed_events: count('authority_packet_events', " WHERE event_type = 'CONSUMER_COMPLETED'"),
      backfill_events: count('authority_packet_events', " WHERE event_type = 'BACKFILL_AUTHORISED'"),
      semantic_admissions: count('semantic_gate_admissions'),
      dispatch_intents: count('semantic_gate_admission_events', " WHERE event_type = 'DISPATCH_INTENT'"),
      dispatch_confirmed: count('semantic_gate_admission_events', " WHERE event_type = 'DISPATCH_CONFIRMED'"),
      dispatch_not_started: count('semantic_gate_admission_events', " WHERE event_type = 'DISPATCH_NOT_STARTED'"),
      allocations: count('allocations'),
      receipts: count('receipts'),
      mutation_operations: count('mutation_operations'),
      mutation_operation_events: count('mutation_operation_events'),
    };
  } finally {
    db.close();
  }
}

function oraclePacketArtifactByteIdentity(store, packetId) {
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT packet_id, packet_digest, content_digest, binding_digest, canonical_json
      FROM authority_packets WHERE packet_id = ?`).get(packetId);
    if (!row) return null;
    const bytes = Buffer.from(row.canonical_json, 'utf8');
    return {
      packet_id: row.packet_id,
      packet_digest: row.packet_digest,
      content_digest: row.content_digest,
      binding_digest: row.binding_digest,
      canonical_json_byte_length: bytes.length,
      canonical_json_byte_digest: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    db.close();
  }
}

function oracleObservedStoreTotals(harness = activeOracleHarness) {
  if (!harness) return oracleCounts(null);
  const total = oracleCounts(null);
  const seenPaths = new Set();
  for (const store of harness.storeBaselines.keys()) {
    if (!store || typeof store.databasePath !== 'string' || seenPaths.has(store.databasePath)) continue;
    seenPaths.add(store.databasePath);
    const observed = oracleCounts(store);
    for (const key of Object.keys(total)) total[key] += observed[key] || 0;
  }
  return total;
}

function oracleEffectDelta(before, after, actual, harness = activeOracleHarness) {
  const delta = {};
  for (const key of Object.keys(before)) delta[`${key}_delta`] = after[key] - before[key];
  const counters = harness ? harness.counters : {};
  return {
    ...delta,
    ...Object.fromEntries(Object.entries(after).map(([key, value]) => [`${key}_after`, value])),
    accepted: actual.outcome === 'ACCEPT',
    consumable: delta.semantic_admissions_delta > 0 || delta.web_acceptance_events_delta > 0,
    next_gate_admitted: delta.semantic_admissions_delta > 0,
    launch_calls: counters.launch_calls || 0,
    atomic_batch_commit_calls: counters.atomic_batch_commit_calls || 0,
    mutation_dispatch_calls: counters.mutation_dispatch_calls || 0,
    stage_calls: counters.stage_calls || 0,
    commit_calls: counters.commit_calls || 0,
    consumable_completion_delta: counters.complete_calls || 0,
    safe_release_delta: counters.release_successes || 0,
    fresh_reader_processes: counters.fresh_reader_processes || 0,
    crash_processes: counters.crash_processes || 0,
    concurrent_processes: counters.concurrent_processes || 0,
    byte_equal_readback: counters.byte_equal_readback || false,
  };
}

function oracleContext(caseId, readerOverrides = {}) {
  const seed = `oracle-${oracleSafeSeed(caseId)}`;
  const packetValue = packet({ seed });
  const storeOptions = options(oracleStateRoot(`${seed}-`));
  const readerSet = readers(packetValue, {
    readCandidate: () => packetValue.bindings.candidate,
    ...readerOverrides,
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
  const persisted = store.persistAuthorityPacket(packetValue, producerAdmission(packetValue));
  trackOracleAuthorityStore(store);
  return {
    packetValue,
    storeOptions,
    readerSet,
    store,
    persisted,
    before: oracleCounts(store),
    gate: null,
  };
}

function oracleG2PassPacket(seed = 'oracle-g2-pass') {
  const value = packet({ seed });
  value.body.verdict = 'PASS';
  value.body.gate_contract_ir = structuredClone(oracleContractIr);
  return value;
}

function oraclePacketAtCanonicalSize(seed, targetBytes) {
  const value = packet({ seed });
  for (const section of value.body.sections) section.text = '';
  let remaining = targetBytes
    - Buffer.byteLength(runtime.canonicalSerialize(value), 'utf8');
  for (let index = 0; index < value.body.sections.length; index += 1) {
    const section = value.body.sections[index];
    const minimumForLaterSections = value.body.sections.length - index - 1;
    const length = Math.min(remaining - minimumForLaterSections, runtime.AUTHORITY_PACKET_LIMITS.proseBytes);
    section.text = 'x'.repeat(length);
    remaining -= length;
  }
  if (remaining !== 0 || Buffer.byteLength(runtime.canonicalSerialize(value), 'utf8') !== targetBytes) {
    throw new Error('ORACLE_BOUNDARY_PACKET_SIZE_UNREACHABLE');
  }
  return value;
}

function oracleBoundarySizedPacket(seed) {
  return oraclePacketAtCanonicalSize(seed, runtime.AUTHORITY_PACKET_LIMITS.artifactBytes);
}

function sharedOracleContext() {
  if (!oracleSharedContext) {
    oracleSharedContext = oracleContext('shared-matrix');
    oracleSharedTemplate = path.join(path.dirname(oracleSharedContext.store.databasePath), 'oracle-template.sqlite');
    fs.copyFileSync(oracleSharedContext.store.databasePath, oracleSharedTemplate);
    cleanupRoots.add(path.dirname(oracleSharedTemplate));
  }
  for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${oracleSharedContext.store.databasePath}${suffix}`, { force: true });
  fs.copyFileSync(oracleSharedTemplate, oracleSharedContext.store.databasePath);
  oracleSharedContext.gate = null;
  trackOracleAuthorityStore(oracleSharedContext.store);
  return oracleSharedContext;
}

function oracleGate(context, noPredecessor = false) {
  if (noPredecessor) return semanticGate(
    `no-predecessor-${oracleSafeSeed(context.packetValue.bindings.producer.run)}`,
    {},
    { noPredecessor: true, stateRoot: oracleStateRoot('oracle-no-predecessor-') }
  );
  if (!oracleSharedGateContext) {
    oracleSharedGateContext = semanticGate(
      'oracle-shared-gate',
      {},
      { stateRoot: oracleStateRoot('oracle-shared-gate-') }
    );
    oracleSharedGateTemplate = path.join(path.dirname(oracleSharedGateContext.store.databasePath), 'oracle-gate-template.sqlite');
    fs.copyFileSync(oracleSharedGateContext.store.databasePath, oracleSharedGateTemplate);
    cleanupRoots.add(path.dirname(oracleSharedGateTemplate));
  }
  for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${oracleSharedGateContext.store.databasePath}${suffix}`, { force: true });
  fs.copyFileSync(oracleSharedGateTemplate, oracleSharedGateContext.store.databasePath);
  oracleSharedGateContext.resetCurrentBodyDigest();
  trackOracleAuthorityStore(oracleSharedGateContext.store);
  return oracleSharedGateContext;
}

function oracleAssuranceReceipt() {
  if (!oracleSharedAssuranceContext) {
    oracleSharedAssuranceContext = assuranceReceiptAdmission({
      dependency_state: 'PREDECESSORS_VERIFIED',
      consumer: { candidate: { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) } },
      scope_digest: 'd'.repeat(64),
      stateRoot: oracleStateRoot('oracle-shared-assurance-'),
    });
    oracleSharedAssuranceTemplate = path.join(path.dirname(oracleSharedAssuranceContext.store.databasePath), 'oracle-assurance-template.sqlite');
    fs.copyFileSync(oracleSharedAssuranceContext.store.databasePath, oracleSharedAssuranceTemplate);
    cleanupRoots.add(path.dirname(oracleSharedAssuranceTemplate));
  }
  fs.copyFileSync(oracleSharedAssuranceTemplate, oracleSharedAssuranceContext.store.databasePath);
  trackOracleAuthorityStore(oracleSharedAssuranceContext.store);
  return oracleSharedAssuranceContext;
}

function oracleActual(result, targetType, method) {
  if (targetType === 'programmeReceiptStore' && method === 'admitMutationOperation') {
    return result !== null && typeof result === 'object' && ORACLE_MUTATION_ADMISSIONS.has(result)
      ? { outcome: 'ACCEPT', code: 'ACCEPT' }
      : { outcome: 'REJECT', code: 'ORACLE_RESULT_SHAPE_INVALID' };
  }
  if (targetType === 'runtime' && method === 'authorityPacketStoreIdentity') {
    return typeof result === 'string' && /^[a-f0-9]{64}$/.test(result)
      ? { outcome: 'ACCEPT', code: 'ACCEPT' }
      : { outcome: 'REJECT', code: 'ORACLE_RESULT_SHAPE_INVALID' };
  }
  if (result === null || result === undefined || typeof result !== 'object') {
    return { outcome: 'REJECT', code: 'ORACLE_RESULT_SHAPE_INVALID' };
  }
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(result); } catch (_) {
    return { outcome: 'REJECT', code: 'ORACLE_RESULT_SHAPE_INVALID' };
  }
  if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
    return { outcome: 'REJECT', code: 'ORACLE_RESULT_SHAPE_INVALID' };
  }
  const status = descriptors.status && descriptors.status.value;
  const ok = descriptors.ok && descriptors.ok.value;
  const reason = descriptors.reason_code && descriptors.reason_code.value;
  const code = descriptors.code && descriptors.code.value;
  if (status === 'blocked') return { outcome: 'REJECT', code: typeof reason === 'string' && reason ? reason : 'BLOCKED' };
  if (ok === false) return { outcome: 'REJECT', code: typeof reason === 'string' && reason ? reason : typeof code === 'string' && code ? code : 'REJECTED' };
  if (!Array.isArray(result) && Object.keys(descriptors).length === 0) {
    return { outcome: 'REJECT', code: 'ORACLE_RESULT_SHAPE_INVALID' };
  }
  return { outcome: 'ACCEPT', code: 'ACCEPT' };
}

function oracleProcessReceipt(caseValue, store, method, actual, before, processCounter, observed = {}) {
  const plannedCall = expectedOraclePlan(caseValue).calls.find((call) => call.method === method);
  if (!plannedCall || !['authorityPacketStore', 'process'].includes(plannedCall.target_type)
    || !ORACLE_AUTHORITY_PACKET_STORES.has(store)
    || runtime.assertAuthenticAuthorityPacketStore(store) !== true) throw new Error('ORACLE_PROCESS_SURFACE_UNBOUND');
  const after = oracleCounts(store);
  const objectAfter = receiptEffectSnapshot(store);
  const countersBefore = activeOracleHarness ? { ...activeOracleHarness.counters } : {};
  if (activeOracleHarness) Object.assign(activeOracleHarness.counters, processCounter);
  const countersAfter = activeOracleHarness ? { ...activeOracleHarness.counters } : processCounter;
  const processWitnessFlags = {};
  if (method === 'bindWebPacketAcceptance' && plannedCall.target_type === 'authorityPacketStore'
    && observed.before_snapshot && objectAfter) {
    const beforeEvents = observed.before_snapshot.tables?.authority_packet_events?.event_proofs || [];
    const afterEvents = objectAfter.tables?.authority_packet_events?.event_proofs || [];
    const beforeEventIds = new Set(beforeEvents.map((event) => event.event_id));
    const newReadbacks = afterEvents.filter((event) => event.event_type === 'READBACK_VERIFIED'
      && !beforeEventIds.has(event.event_id));
    const packetId = newReadbacks.length === 1 ? newReadbacks[0].packet_id : null;
    const readbackVerified = !!packetId
      && verifyNewPacketReadback(store, packetId, observed.before_snapshot, objectAfter);
    processWitnessFlags.readback_verified = readbackVerified;
    processWitnessFlags.byte_equal_readback = readbackVerified;
    processWitnessFlags.acceptance_event_verified = false;
    processWitnessFlags.bound_acceptance = false;
  }
  if (method === 'IMPORT2' && plannedCall.target_type === 'process') {
    processWitnessFlags.import_order_witness = observed.import_order_witness === true;
  }
  const receipt = Object.freeze({});
  ORACLE_SURFACE_RECEIPTS.set(receipt, {
    case_identity: oracleCaseIdentity(caseValue),
    surface: caseValue.surface,
    method,
    target_type: plannedCall.target_type,
    outcome: observed.crash === true ? 'PROCESS_CRASHED'
      : plannedCall.target_type === 'process' ? 'PROCESS_COMPLETED' : 'CONCURRENT_PROCESSES_COMPLETED',
    actual,
    value_type: 'process-result',
    argument_binding_digest: runtime.digestValue({ case_identity: oracleCaseIdentity(caseValue), method, store_identity: store.storeIdentityDigest() }),
    object_before: observed.before_snapshot || null,
    object_after: objectAfter,
    effect_delta: {
      ...oracleEffectDelta(before, after, actual, activeOracleHarness),
      ...processWitnessFlags,
      ...(observed.race_witness === true ? { race_witness: true } : {}),
    },
    counters_before: countersBefore,
    counters_after: countersAfter,
    receipt,
    setup: false,
  });
  recordOracleHarnessEvent({
    type: 'process-call',
    sequence: activeOracleHarness ? activeOracleHarness.events.length + 1 : 1,
    case_identity: oracleCaseIdentity(caseValue),
    method,
    target_type: plannedCall.target_type,
    outcome: actual.outcome,
    code: actual.code,
    value_type: 'process-result',
    argument_binding_digest: runtime.digestValue({ case_identity: oracleCaseIdentity(caseValue), method, store_identity: store.storeIdentityDigest() }),
    setup: false,
    object_before: observed.before_snapshot || null,
    object_after: objectAfter,
  });
  recordOracleHarnessReceipt(receipt);
  return receipt;
}

function oracleEvidenceReceipt(caseValue, method, targetType, actual, flags, evidence, sourceReceipts) {
  const plannedCall = expectedOraclePlan(caseValue).calls.find((call) => call.method === method);
  if (!activeOracleHarness || !plannedCall || plannedCall.target_type !== targetType
    || !Array.isArray(sourceReceipts) || sourceReceipts.length === 0) {
    throw new Error(`ORACLE_EVIDENCE_SURFACE_UNBOUND:${caseValue.id}:${method}`);
  }
  const sourceCalls = sourceReceipts.map((sourceReceipt) => ORACLE_SURFACE_RECEIPTS.get(sourceReceipt));
  if (sourceCalls.some((source) => !source || source.case_identity !== oracleCaseIdentity(caseValue)
    || source.setup === true || typeof source.argument_binding_digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(source.argument_binding_digest))) {
    throw new Error(`ORACLE_EVIDENCE_SOURCE_INVALID:${caseValue.id}:${method}`);
  }
  const evidenceDigest = runtime.digestValue(evidence);
  const sourceBindings = sourceCalls.map((source) => ({
    method: source.method,
    target_type: source.target_type,
    outcome: source.outcome,
    actual: source.actual,
    argument_binding_digest: source.argument_binding_digest,
  }));
  const argumentBindingDigest = runtime.digestValue({
    schema: 'toolkit.github-program.oracle-bounded-evidence-call.v1',
    case_identity: oracleCaseIdentity(caseValue),
    method,
    target_type: targetType,
    evidence_digest: evidenceDigest,
    source_bindings: sourceBindings,
  });
  const receipt = Object.freeze({});
  const bound = {
    case_identity: oracleCaseIdentity(caseValue),
    surface: caseValue.surface,
    method,
    target_type: targetType,
    outcome: actual.outcome === 'ACCEPT' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_REJECTED',
    actual,
    value_type: 'bounded-evidence',
    argument_binding_digest: argumentBindingDigest,
    evidence_digest: evidenceDigest,
    source_call_count: sourceBindings.length,
    source_call_binding_digests: sourceBindings.map((source) => source.argument_binding_digest),
    effect_delta: { ...flags },
    counters_before: { ...activeOracleHarness.counters },
    counters_after: { ...activeOracleHarness.counters },
    receipt,
    setup: false,
  };
  ORACLE_SURFACE_RECEIPTS.set(receipt, bound);
  recordOracleHarnessEvent({
    type: 'bounded-evidence-call',
    sequence: activeOracleHarness.events.length + 1,
    case_identity: oracleCaseIdentity(caseValue),
    method,
    target_type: targetType,
    outcome: actual.outcome,
    code: actual.code,
    argument_binding_digest: argumentBindingDigest,
    evidence_digest: evidenceDigest,
    source_call_count: sourceBindings.length,
  });
  recordOracleHarnessReceipt(receipt);
  return receipt;
}

function oracleRunNodeTests(testPaths, options = []) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const child = require('node:child_process').spawnSync(process.execPath,
    ['--no-warnings', '--test', '--test-reporter=tap', ...options, ...testPaths], {
      cwd: repositoryRoot,
      env: childEnvironment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    });
  const stdout = child && typeof child.stdout === 'string' ? child.stdout : '';
  const summary = (name) => {
    const match = stdout.match(new RegExp(`# ${name} (\\d+)`));
    return match ? Number(match[1]) : null;
  };
  const tests = summary('tests');
  const passed = summary('pass');
  const failed = summary('fail');
  const commandPassed = !!child && child.status === 0 && child.signal === null && !child.error
    && tests !== null && passed !== null && failed === 0 && passed > 0;
  return {
    command_passed: commandPassed,
    status: child ? child.status : null,
    signal: child && child.signal ? String(child.signal) : null,
    error_code: child && child.error && child.error.code ? String(child.error.code) : null,
    error: child && child.error ? String(child.error.message || child.error) : null,
    tests,
    passed,
    failed,
    stdout_digest: crypto.createHash('sha256').update(stdout, 'utf8').digest('hex'),
    stderr_digest: crypto.createHash('sha256').update(child && typeof child.stderr === 'string' ? child.stderr : '', 'utf8').digest('hex'),
  };
}

function oracleSemanticModuleImportProcess(caseValue, store) {
  const before = oracleCounts(store);
  const receiptPath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs');
  const loopPath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-execution-loop.cjs');
  const script = [
    "'use strict';",
    'const [receiptPath, loopPath, optionsText, order] = process.argv.slice(1);',
    'let receipt; let loop;',
    "if (order === 'receipt-first') { receipt = require(receiptPath); loop = require(loopPath); }",
    "else { loop = require(loopPath); receipt = require(receiptPath); }",
    'const options = JSON.parse(optionsText);',
    'const readers = { readAuthority: () => ({}), readCurrent: () => ({}), readWebDecision: () => ({}), readCandidate: () => ({}), readDispatchOutcome: () => ({}), screenPacket: () => ({ decision: "ALLOW" }) };',
    'const authorityStore = receipt.initialiseAuthorityPacketStore(options, readers);',
    "const requiredReceipt = ['createProgrammeReceiptStore','createAuthorityPacketStore','initialiseAuthorityPacketStore','migrateAuthorityPacketStore','assertAuthenticAuthorityPacketStore','assertAuthenticSemanticGateAdmission','validateSemanticGateAdmission','expectedAuthorityPacketSchemaFingerprint','canonicalSerialize','digestValue'];",
    "const requiredLoop = ['POLICY','admitRun','prepareRetry','transitionRun','startDelegatedRun','executeTypedGitCommit','commitExact','completeRun','releaseMutationLease','canonicalSerialize','digestValue'];",
    "const requiredStore = ['admitSemanticGate','revalidateSemanticGate','beginSemanticGateDispatch','recordSemanticGateDispatch','recoverSemanticGateAdmission'];",
    'const policyApis = loop.POLICY && loop.POLICY.semantic_admission && loop.POLICY.semantic_admission.required_receipt_apis;',
    'const apiExact = Array.isArray(policyApis) && JSON.stringify([...policyApis].sort()) === JSON.stringify([...requiredStore].sort());',
    'const missingReceipt = requiredReceipt.filter((name) => typeof receipt[name] !== "function");',
    'const missingLoop = requiredLoop.filter((name) => name === "POLICY" ? !loop.POLICY : typeof loop[name] !== "function");',
    'const missingStore = requiredStore.filter((name) => typeof authorityStore[name] !== "function");',
    'const sharedPrimitives = receipt.canonicalSerialize === loop.canonicalSerialize && receipt.digestValue === loop.digestValue;',
    'const complete = missingReceipt.length === 0 && missingLoop.length === 0 && missingStore.length === 0',
    '  && apiExact && sharedPrimitives && Object.values(receipt).every((value) => value !== undefined) && Object.values(loop).every((value) => value !== undefined);',
    'process.stdout.write(JSON.stringify({ order, complete, receipt_exports: Object.keys(receipt).sort(), loop_exports: Object.keys(loop).sort() }) + "\\n");',
    'if (!complete) process.exitCode = 1;',
  ].join('\n');
  const orders = [
    { name: 'receipt-first', root: oracleStateRoot(`oracle-import-order-receipt-first-${oracleSafeSeed(caseValue.id)}-`) },
    { name: 'loop-first', root: oracleStateRoot(`oracle-import-order-loop-first-${oracleSafeSeed(caseValue.id)}-`) },
  ];
  const results = orders.map(({ name, root }) => {
    const result = require('node:child_process').spawnSync(process.execPath, [
      '--no-warnings', '-e', script, receiptPath, loopPath, JSON.stringify(options(root)), name,
    ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    let value = null;
    try {
      const lines = String(result.stdout || '').trim().split(/\r?\n/);
      if (lines.length === 1) value = JSON.parse(lines[0]);
    } catch (_) { /* A malformed child result remains a failed import proof. */ }
    return {
      passed: !!result && result.status === 0 && result.signal === null && !result.error
        && result.stderr === '' && !!value && value.complete === true && value.order === name,
      receipt_exports: value && value.receipt_exports,
      loop_exports: value && value.loop_exports,
    };
  });
  const witness = results.length === 2 && results.every((result) => result.passed)
    && runtime.canonicalSerialize(results[0].receipt_exports) === runtime.canonicalSerialize(results[1].receipt_exports)
    && runtime.canonicalSerialize(results[0].loop_exports) === runtime.canonicalSerialize(results[1].loop_exports);
  const actual = witness
    ? { outcome: 'ACCEPT', code: 'ACCEPT' }
    : { outcome: 'REJECT', code: 'GPR_PACKET_ADMISSION_REQUIRED' };
  return oracleProcessReceipt(caseValue, store, 'IMPORT2', actual, before, {}, { import_order_witness: witness });
}

function oracleReopenPacketReaderProcess(caseValue, context) {
  const store = context.store;
  const before = oracleCounts(store);
  const beforeSnapshot = receiptEffectSnapshot(store);
  const identities = runtime.authorityPacketIdentities(context.packetValue);
  const challenge = crypto.randomBytes(32).toString('hex');
  const runtimePath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs');
  const result = spawnSync(process.execPath, [
    '--no-warnings', runtimePath, 'read-authority-packet',
    '--repository', context.storeOptions.repository,
    '--parent-issue', String(context.storeOptions.parent_issue),
    '--child-issue', String(context.storeOptions.child_issue),
    '--state-root', context.storeOptions.stateRoot,
    '--repository-root', context.storeOptions.repositoryRoot,
    '--packet-id', identities.packet_id,
    '--expected-bindings', runtime.canonicalSerialize(context.packetValue.bindings),
    '--challenge', challenge,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: runtime.AUTHORITY_PACKET_LIMITS.deliveryBytes + 1,
  });
  let delivery;
  const stdout = result && typeof result.stdout === 'string' ? result.stdout : '';
  const oneJsonLine = stdout.endsWith('\n') && !stdout.slice(0, -1).includes('\n');
  if (oneJsonLine) {
    try { delivery = JSON.parse(stdout.slice(0, -1)); } catch (_) { delivery = null; }
  }
  const expectedEnvelope = {
    schema: runtime.AUTHORITY_PACKET_DELIVERY_SCHEMA_ID,
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    content_digest: identities.content_digest,
    binding_digest: identities.binding_digest,
    producer_key: identities.producer_key,
    namespace_digest: runtime.namespaceDigest(store.namespace),
    store_identity_digest: store.storeIdentityDigest(),
    runtime_identity_digest: runtime.authorityPacketRuntimeIdentity().runtime_identity_digest,
    challenge,
    canonical_packet_bytes: identities.canonical_packet_bytes,
  };
  const envelope = delivery && delivery.envelope;
  const expectedEnvelopeKeys = Object.keys(expectedEnvelope).sort();
  const passed = !!result && !result.error && result.signal === null && result.status === 0
    && result.stderr === '' && oneJsonLine && delivery && typeof delivery === 'object'
    && runtime.canonicalSerialize(Object.keys(delivery).sort()) === runtime.canonicalSerialize(['envelope', 'packet'])
    && envelope && runtime.canonicalSerialize(Object.keys(envelope).sort()) === runtime.canonicalSerialize(expectedEnvelopeKeys)
    && runtime.canonicalSerialize(envelope) === runtime.canonicalSerialize(expectedEnvelope)
    && runtime.canonicalSerialize(delivery.packet) === runtime.canonicalSerialize(context.packetValue);
  const actual = passed
    ? { outcome: 'ACCEPT', code: 'ACCEPT' }
    : { outcome: 'REJECT', code: 'GPR_PACKET_READBACK_FAILED' };
  return oracleProcessReceipt(caseValue, store, 'REOPEN', actual, before,
    { fresh_reader_processes: 1 }, { before_snapshot: beforeSnapshot });
}

function oracleCrashDuringPacketWrite(caseValue, context) {
  const writerOptions = options(oracleStateRoot(`oracle-writer-crash-${oracleSafeSeed(caseValue.id)}-`));
  const writerPacket = packet({ seed: `oracle-writer-crash-${oracleSafeSeed(caseValue.id)}` });
  const writerReaders = readers(writerPacket, {
    screenPacket: ({ packet: value }) => {
      runtime.validateAuthorityPacket(value);
      return screening(value);
    },
  });
  const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(writerOptions, writerReaders));
  const before = oracleCounts(store);
  const runtimePath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs');
  const script = [
    "const sqlite=require('node:sqlite');",
    "const originalPrepare=sqlite.DatabaseSync.prototype.prepare;",
    "sqlite.DatabaseSync.prototype.prepare=function(sql){const statement=originalPrepare.call(this,sql);if(String(sql).includes('INSERT INTO authority_packets VALUES')){const originalRun=statement.run;statement.run=function(...args){const result=originalRun.apply(this,args);process.kill(process.pid,'SIGKILL');return result}}return statement};",
    'const runtime=require(process.argv[1]);',
    'const options=JSON.parse(process.argv[2]);',
    'const packet=JSON.parse(process.argv[3]);',
    'const producerAdmission=JSON.parse(process.argv[4]);',
    'const readers={readAuthority:()=>({authority:packet.bindings.authority,producer_authority:{lane_id:packet.bindings.lane_id,human_owner:packet.bindings.human_owner,producer:packet.bindings.producer},required_consumers:packet.bindings.applicability.required_consumers,later_controlling_comments:[]}),screenPacket:({packet:value})=>{const ids=runtime.authorityPacketIdentities(value);return {packet_digest:ids.packet_digest,decision:"ALLOW",policy_digest:runtime.digestValue("crash-policy"),retention_policy_digest:runtime.digestValue("crash-retention")}}};',
    'const store=runtime.initialiseAuthorityPacketStore(options,readers);',
    'store.persistAuthorityPacket(packet,producerAdmission);',
  ].join('');
  const result = spawnSync(process.execPath, ['--no-warnings', '-e', script,
    runtimePath, JSON.stringify(writerOptions), JSON.stringify(writerPacket), JSON.stringify(producerAdmission(writerPacket))], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  const crashed = !!result && (result.signal !== null || result.status !== 0);
  if (!crashed) return oracleProcessReceipt(caseValue, store, 'persistAuthorityPacket', { outcome: 'ACCEPT', code: 'ACCEPT' }, before, { crash_processes: 0 }, { crash: false });
  const after = oracleCounts(store);
  const actual = after.artifacts === before.artifacts
    ? { outcome: 'REJECT', code: 'GPR_PACKET_WRITE_FAILED' }
    : { outcome: 'ACCEPT', code: 'ACCEPT' };
  return oracleProcessReceipt(caseValue, store, 'persistAuthorityPacket', actual, before, { crash_processes: 1 }, { crash: true });
}

function oracleAcceptanceProcessFailure(caseValue, context, fault) {
  const before = oracleCounts(context.store);
  const beforeSnapshot = receiptEffectSnapshot(context.store);
  const runtimePath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs');
  const crashAfterFreshRead = fault === 'producer-crash-before-readback';
  const failAcceptanceWrite = fault === 'acceptance-write-interrupted';
  const setup = [];
  if (crashAfterFreshRead) {
    setup.push(
      "const childProcess=require('node:child_process');",
      'const originalSpawnSync=childProcess.spawnSync;',
      "childProcess.spawnSync=function(file,args,options){const result=originalSpawnSync.call(this,file,args,options);if(Array.isArray(args)&&args.includes('read-authority-packet'))process.kill(process.pid,'SIGKILL');return result};"
    );
  }
  if (failAcceptanceWrite) {
    setup.push(
      "const sqlite=require('node:sqlite');",
      'const originalPrepare=sqlite.DatabaseSync.prototype.prepare;',
      'let eventInsertCount=0;',
      "sqlite.DatabaseSync.prototype.prepare=function(sql){const statement=originalPrepare.call(this,sql);if(String(sql).includes('INSERT INTO authority_packet_events VALUES')){const originalRun=statement.run;statement.run=function(...args){eventInsertCount+=1;if(eventInsertCount===2){const error=new Error('injected acceptance write fault');error.code='SQLITE_IOERR';throw error}return originalRun.apply(this,args)}}return statement};"
    );
  }
  setup.push(
    'const runtime=require(process.argv[1]);',
    'const options=JSON.parse(process.argv[2]);',
    'const packet=JSON.parse(process.argv[3]);',
    'const readers={readAuthority:()=>({authority:packet.bindings.authority,producer_authority:{lane_id:packet.bindings.lane_id,human_owner:packet.bindings.human_owner,producer:packet.bindings.producer},required_consumers:packet.bindings.applicability.required_consumers,later_controlling_comments:[]}),screenPacket:({packet:value})=>{const ids=runtime.authorityPacketIdentities(value);return {packet_digest:ids.packet_digest,decision:"ALLOW",policy_digest:runtime.digestValue("acceptance-policy"),retention_policy_digest:runtime.digestValue("acceptance-retention")}},readWebDecision:()=>{const ids=runtime.authorityPacketIdentities(packet);return {packet_id:ids.packet_id,packet_digest:ids.packet_digest,binding_digest:ids.binding_digest,web_source:packet.bindings.authority,disposition:"ACCEPTED_FOR_CONSUMPTION",permitted_consumers:packet.bindings.applicability.required_consumers,applicability:packet.bindings.applicability,successor_applicability:[]}}};',
    'const store=runtime.createAuthorityPacketStore(options,readers);',
    'try{store.bindWebPacketAcceptance(runtime.authorityPacketIdentities(packet).packet_id)}catch(error){process.stdout.write(JSON.stringify({outcome:"REJECT",code:error.code||"ERROR"})+"\\n");process.exit(0)}',
    'process.stdout.write(JSON.stringify({outcome:"ACCEPT",code:"ACCEPT"})+"\\n");'
  );
  const child = spawnSync(process.execPath, ['--no-warnings', '-e', setup.join(''),
    runtimePath, JSON.stringify(context.storeOptions), JSON.stringify(context.packetValue)], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
  const crashed = !!child && (child.signal !== null || child.status !== 0 || child.error != null);
  const after = oracleCounts(context.store);
  let actual;
  if (crashAfterFreshRead && crashed && after.web_acceptance_events === before.web_acceptance_events) {
    actual = { outcome: 'REJECT', code: 'GPR_PACKET_READBACK_FAILED' };
  } else if (failAcceptanceWrite && crashed) {
    actual = { outcome: 'REJECT', code: child.error && child.error.code || child.signal || `ORACLE_EXIT_${child.status}` };
  } else if (failAcceptanceWrite) {
    try {
      const output = JSON.parse(String(child.stdout).trim());
      actual = output.outcome === 'REJECT' && output.code === 'GPR_PACKET_WRITE_FAILED'
        ? { outcome: 'REJECT', code: 'GPR_PACKET_WRITE_FAILED' }
        : { outcome: 'ACCEPT', code: 'ACCEPT' };
    } catch (_) { actual = { outcome: 'REJECT', code: 'ORACLE_PROCESS_OUTPUT_INVALID' }; }
  } else {
    actual = { outcome: 'REJECT', code: 'GPR_PACKET_READBACK_FAILED' };
  }
  return oracleProcessReceipt(caseValue, context.store, 'bindWebPacketAcceptance', actual, before, {
    crash_processes: crashed ? 1 : 0,
  }, { crash: crashAfterFreshRead && crashed, before_snapshot: beforeSnapshot });
}

function oracleFreshReaderFailureProcess(caseValue, context) {
  const before = oracleCounts(context.store);
  const runtimePath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs');
  const script = [
    "const childProcess=require('node:child_process');",
    'const originalSpawnSync=childProcess.spawnSync;',
    "childProcess.spawnSync=function(file,args,options){if(Array.isArray(args)&&args.includes('read-authority-packet')){const error=new Error('injected runtime timeout');error.code='ETIMEDOUT';return {pid:0,output:[],stdout:'',stderr:'',status:null,signal:null,error}}return originalSpawnSync.call(this,file,args,options)};",
    'const runtime=require(process.argv[1]);',
    'const options=JSON.parse(process.argv[2]);',
    'const packet=JSON.parse(process.argv[3]);',
    'const readers={readAuthority:()=>({authority:packet.bindings.authority,producer_authority:{lane_id:packet.bindings.lane_id,human_owner:packet.bindings.human_owner,producer:packet.bindings.producer},required_consumers:packet.bindings.applicability.required_consumers,later_controlling_comments:[]}),screenPacket:({packet:value})=>{const ids=runtime.authorityPacketIdentities(value);return {packet_digest:ids.packet_digest,decision:"ALLOW",policy_digest:runtime.digestValue("timeout-policy"),retention_policy_digest:runtime.digestValue("timeout-retention")}}};',
    'const store=runtime.createAuthorityPacketStore(options,readers);',
    'try{store.verifyAuthorityPacketFresh(runtime.authorityPacketIdentities(packet).packet_id,packet.bindings);process.stdout.write(JSON.stringify({outcome:"ACCEPT",code:"ACCEPT"})+"\\n")}catch(error){process.stdout.write(JSON.stringify({outcome:"REJECT",code:error.code||"ERROR"})+"\\n")} ',
  ].join('');
  const result = spawnSync(process.execPath, ['--no-warnings', '-e', script,
    runtimePath, JSON.stringify(context.storeOptions), JSON.stringify(context.packetValue)], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  let actual = { outcome: 'REJECT', code: 'ORACLE_PROCESS_OUTPUT_INVALID' };
  try { actual = JSON.parse(String(result.stdout).trim()); } catch (_) { /* Remain a failed, observed subprocess result. */ }
  return oracleProcessReceipt(caseValue, context.store, 'verifyAuthorityPacketFresh', actual, before, {
    fresh_reader_processes: 1,
  }, { injected_runtime_failure: true });
}

function launchOracleConcurrentWriter(optionsValue, packetValue, gatePath) {
  const runtimePath = path.join(repositoryRoot, 'repo', 'scripts', 'toolkit-github-program-receipt.cjs');
  const script = [
    'const fs=require("node:fs");',
    'const runtime=require(process.argv[1]);',
    'const options=JSON.parse(process.argv[2]);',
    'const packet=JSON.parse(process.argv[3]);',
    'const gatePath=process.argv[4];',
    'const producerAdmission=JSON.parse(process.argv[5]);',
    'const readers={readAuthority:()=>({authority:packet.bindings.authority,producer_authority:{lane_id:packet.bindings.lane_id,human_owner:packet.bindings.human_owner,producer:packet.bindings.producer},required_consumers:packet.bindings.applicability.required_consumers,later_controlling_comments:[]}),screenPacket:({packet:value})=>{const ids=runtime.authorityPacketIdentities(value);return {packet_digest:ids.packet_digest,decision:"ALLOW",policy_digest:runtime.digestValue("race-policy"),retention_policy_digest:runtime.digestValue("race-retention")}}};',
    'const store=runtime.initialiseAuthorityPacketStore(options,readers);',
    'process.stdout.write("READY\\n");',
    'const timer=setInterval(()=>{if(!fs.existsSync(gatePath))return;clearInterval(timer);try{const result=store.persistAuthorityPacket(packet,producerAdmission);process.stdout.write(JSON.stringify({outcome:"ACCEPT",duplicate:result.duplicate,packet_id:result.packet_id,packet_digest:result.packet_digest,content_digest:result.content_digest,binding_digest:result.binding_digest,producer_key:result.producer_key})+"\\n")}catch(error){process.stdout.write(JSON.stringify({outcome:"REJECT",code:error.code||"ERROR"})+"\\n")} },5);',
  ].join('');
  const child = spawn(process.execPath, ['--no-warnings', '-e', script,
    runtimePath, JSON.stringify(optionsValue), JSON.stringify(packetValue), gatePath,
    JSON.stringify(producerAdmission(packetValue))], {
    cwd: repositoryRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const done = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.split(/\r?\n/).includes('READY')) readyResolve();
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const rows = output.split(/\r?\n/).filter((line) => line.startsWith('{'));
      if (code !== 0 || rows.length !== 1) return reject(new Error(`ORACLE_CONCURRENT_WRITER_FAILED:${code}:${signal}:${errors}`));
      try { resolve(JSON.parse(rows[0])); } catch (error) { reject(error); }
    });
  });
  let timeoutHandle;
  const readyTimeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('ORACLE_CONCURRENT_WRITER_READY_TIMEOUT')), 30000);
  });
  const readyResult = Promise.race([ready, readyTimeout]);
  readyResult.finally(() => clearTimeout(timeoutHandle));
  return { child, ready: readyResult, done };
}

async function oracleConcurrentPacketWriters(caseValue, conflicting) {
  const seed = `oracle-concurrent-${oracleSafeSeed(caseValue.id)}`;
  const storeOptions = options(oracleStateRoot(`${seed}-`));
  const first = packet({ seed });
  const second = structuredClone(first);
  if (conflicting) second.body.decision = 'concurrent conflicting packet body';
  const initialStore = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(storeOptions, readers(first)));
  const before = oracleCounts(initialStore);
  const beforeSnapshot = receiptEffectSnapshot(initialStore);
  const gatePath = path.join(storeOptions.stateRoot, `${seed}.go`);
  const writers = [launchOracleConcurrentWriter(storeOptions, first, gatePath), launchOracleConcurrentWriter(storeOptions, second, gatePath)];
  await Promise.all(writers.map((writer) => writer.ready));
  fs.writeFileSync(gatePath, 'go\n', { flag: 'wx', mode: 0o600 });
  const outputs = await Promise.all(writers.map((writer) => writer.done));
  const after = oracleCounts(initialStore);
  const afterSnapshot = receiptEffectSnapshot(initialStore);
  const accepted = outputs.filter((item) => item.outcome === 'ACCEPT').length;
  const conflicts = outputs.filter((item) => item.code === 'GPR_PACKET_CONFLICT').length;
  const actual = conflicting
    ? accepted === 1 && conflicts === 1 ? { outcome: 'REJECT', code: 'GPR_PACKET_CONFLICT' } : { outcome: 'ACCEPT', code: 'ACCEPT' }
    : accepted === 2 && after.artifacts - before.artifacts === 1 ? { outcome: 'ACCEPT', code: 'ACCEPT' } : { outcome: 'REJECT', code: 'GPR_PACKET_CONFLICT' };
  const raceWitness = verifyConcurrentPacketWriterWitness(
    initialStore, first, second, outputs, conflicting, beforeSnapshot, afterSnapshot,
  );
  return oracleProcessReceipt(caseValue, initialStore, 'persistAuthorityPacket', actual, before, { concurrent_processes: 2 }, {
    conflict: conflicting,
    race_witness: raceWitness,
    before_snapshot: beforeSnapshot,
  });
}

function verifyConcurrentPacketWriterWitness(store, first, second, outputs, conflicting, beforeSnapshot, afterSnapshot) {
  if (!store || !first || !second || !Array.isArray(outputs) || outputs.length !== 2
    || !beforeSnapshot || !afterSnapshot) return false;
  const acceptedKeys = ['binding_digest', 'content_digest', 'duplicate', 'outcome', 'packet_digest', 'packet_id', 'producer_key'];
  const rejectedKeys = ['code', 'outcome'];
  if (outputs.some((item) => !item || !['ACCEPT', 'REJECT'].includes(item.outcome)
    || runtime.canonicalSerialize(Object.keys(item).sort()) !== runtime.canonicalSerialize(
      item.outcome === 'ACCEPT' ? acceptedKeys : rejectedKeys,
    ))) return false;
  const accepted = outputs.filter((item) => item.outcome === 'ACCEPT');
  const rejected = outputs.filter((item) => item.outcome === 'REJECT');
  if (conflicting) {
    if (accepted.length !== 1 || rejected.length !== 1 || rejected[0].code !== 'GPR_PACKET_CONFLICT'
      || accepted[0].duplicate !== false) return false;
  } else if (accepted.length !== 2 || rejected.length !== 0
    || runtime.canonicalSerialize(accepted.map((item) => item.duplicate).sort())
      !== runtime.canonicalSerialize([false, true])) return false;
  const beforeRows = beforeSnapshot.tables.authority_packets;
  const afterRows = afterSnapshot.tables.authority_packets;
  if (!beforeRows || !afterRows || afterRows.count !== beforeRows.count + 1) return false;
  const newIds = afterRows.identity_values.filter((id) => !beforeRows.identity_values.includes(id));
  if (newIds.length !== 1 || accepted.some((item) => item.packet_id !== newIds[0])) return false;
  const candidates = [first, second].map((value) => runtime.authorityPacketIdentities(value));
  const written = candidates.find((item) => item.packet_id === newIds[0]);
  if (!written) return false;
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  let row;
  try { row = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(newIds[0]); }
  finally { db.close(); }
  if (!row || row.packet_digest !== written.packet_digest || row.content_digest !== written.content_digest
    || row.binding_digest !== written.binding_digest || row.producer_key !== written.producer_key
    || row.canonical_json !== written.canonical_packet_bytes) return false;
  if (accepted.some((item) => item.packet_digest !== row.packet_digest
    || item.content_digest !== row.content_digest || item.binding_digest !== row.binding_digest
    || item.producer_key !== row.producer_key)) return false;
  if (afterSnapshot.tables.authority_packet_events.rows_digest !== beforeSnapshot.tables.authority_packet_events.rows_digest
    || afterSnapshot.tables.semantic_gate_admissions.rows_digest !== beforeSnapshot.tables.semantic_gate_admissions.rows_digest
    || afterSnapshot.tables.semantic_gate_admission_events.rows_digest !== beforeSnapshot.tables.semantic_gate_admission_events.rows_digest) return false;
  for (const table of ['allocations', 'runs', 'coordination_state', 'lease_events', 'receipts', 'mutation_operations', 'mutation_operation_events']) {
    if (afterSnapshot.tables[table].rows_digest !== beforeSnapshot.tables[table].rows_digest) return false;
  }
  return conflicting || accepted[0].packet_id === accepted[1].packet_id;
}

function oraclePacketWithVariant(packetValue, variant, counters) {
  const value = structuredClone(packetValue);
  const body = value.body;
  switch (variant) {
    case 'accessor':
      Object.defineProperty(body, 'decision', { enumerable: true, get() { counters.getter_calls += 1; return 'getter'; } });
      return value;
    case 'self-modifying-accessor':
      Object.defineProperty(body, 'decision', { enumerable: true, get() { counters.getter_calls += 1; body.next_state = 'mutated'; return 'getter'; } });
      return value;
    case 'proxy':
      return new Proxy(value, { get(target, key, receiver) { counters.proxy_trap_calls += 1; return Reflect.get(target, key, receiver); } });
    case 'revoked-proxy': {
      const revoked = Proxy.revocable(value, { get(target, key, receiver) { counters.proxy_trap_calls += 1; return Reflect.get(target, key, receiver); } });
      revoked.revoke();
      return revoked.proxy;
    }
    case 'function':
      body.decision = () => 'function';
      return value;
    case 'symbol-value':
      body.decision = Symbol('value');
      return value;
    case 'symbol-key':
      body[Symbol('key')] = 'symbol-key';
      return value;
    case 'inherited-data': {
      const inherited = Object.create({ inherited: true });
      Object.assign(inherited, body);
      value.body = inherited;
      return value;
    }
    case 'custom-prototype':
      value.body = Object.assign(Object.create({ custom: true }), body);
      return value;
    case 'toJSON':
      body.toJSON = () => ({}) ;
      return value;
    case 'non-enumerable':
      Object.defineProperty(body, 'hidden', { enumerable: false, value: 'hidden' });
      return value;
    case 'sparse-array':
      delete body.sections[1];
      return value;
    case 'array-extra-property':
      body.sections.extra = 'extra';
      return value;
    case 'cycle':
      body.cycle = body;
      return value;
    case 'undefined':
      body.decision = undefined;
      return value;
    case 'bigint':
      body.decision = 1n;
      return value;
    case 'fraction':
      body.sequence = 1.5;
      return value;
    case 'unsafe-number':
      body.sequence = Number.MAX_SAFE_INTEGER + 1;
      return value;
    case 'non-finite-number':
      body.sequence = Infinity;
      return value;
    case 'negative-zero':
      body.sequence = -0;
      return value;
    case 'unpaired-surrogate':
      body.decision = String.fromCharCode(0xd800);
      return value;
    case 'unknown-key':
      body.unknown_key = true;
      return value;
    case 'unknown-discriminant':
      body.verdict = 'UNKNOWN';
      return value;
    case 'duplicate-json-key':
      return `{"schema":"${runtime.AUTHORITY_PACKET_SCHEMA_ID}","schema":"duplicate"}`;
    case 'alternate-whitespace':
      return ` ${runtime.canonicalSerialize(packetValue)}`;
    case 'key-order': {
      const parsed = JSON.parse(runtime.canonicalSerialize(packetValue));
      return JSON.stringify({ body: parsed.body, bindings: parsed.bindings, schema: parsed.schema });
    }
    case 'escaping':
      return runtime.canonicalSerialize(packetValue).replace('custody', '\\u0063ustody');
    case 'trailing-newline':
      return `${runtime.canonicalSerialize(packetValue)}\n`;
    case 'bom':
      return `\ufeff${runtime.canonicalSerialize(packetValue)}`;
    case 'malformed-utf8':
      return Buffer.from([0xff, 0xfe, 0xfd]);
    default:
      return value;
  }
}

function oracleTamperStore(context) {
  const db = new DatabaseSync(context.store.databasePath);
  try {
    db.exec('DROP TRIGGER authority_packets_no_update');
    db.prepare('UPDATE authority_packets SET canonical_json = ?').run('{}');
    db.exec("CREATE TRIGGER authority_packets_no_update BEFORE UPDATE ON authority_packets BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
  } finally {
    db.close();
  }
}

function oracleAttemptAppendOnlyCustodyMutations(context) {
  const store = context.store;
  const packetId = context.persisted.packet_id;
  const beforeSnapshot = receiptEffectSnapshot(store);
  const attempts = [];
  let originalRow;
  const db = new DatabaseSync(store.databasePath);
  try {
    originalRow = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId);
    const operations = [
      ['update', () => db.prepare('UPDATE authority_packets SET canonical_json = ? WHERE packet_id = ?').run('{}', packetId)],
      ['delete', () => db.prepare('DELETE FROM authority_packets WHERE packet_id = ?').run(packetId)],
      ['replace', () => db.prepare('INSERT OR REPLACE INTO authority_packets VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        originalRow.packet_id, originalRow.producer_key, originalRow.packet_digest, originalRow.content_digest,
        originalRow.binding_digest, originalRow.canonical_json, originalRow.created_at,
      )],
      ['cleanup', () => db.prepare('DELETE FROM authority_packets').run()],
    ];
    for (const [name, operation] of operations) {
      try {
        operation();
        attempts.push({ name, blocked: false, diagnostic: 'operation-succeeded' });
      } catch (error) {
        const diagnostic = String(error && error.message || error);
        attempts.push({ name, blocked: diagnostic.includes('GPR_APPEND_ONLY'), diagnostic });
      }
      if (attempts.at(-1).blocked !== true) break;
    }
  } finally { db.close(); }
  const afterSnapshot = receiptEffectSnapshot(store);
  const readDb = new DatabaseSync(store.databasePath, { readOnly: true });
  let retainedRow;
  try { retainedRow = readDb.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(packetId); }
  finally { readDb.close(); }
  const tableNames = Object.keys(beforeSnapshot.tables);
  const checks = {
    packet_existed_before: !!originalRow,
    attacks_blocked: attempts.length === 4 && attempts.every((attempt) => attempt.blocked === true),
    all_tables_unchanged: tableNames.every((name) => beforeSnapshot.tables[name].count === afterSnapshot.tables[name].count
      && beforeSnapshot.tables[name].rows_digest === afterSnapshot.tables[name].rows_digest
      && runtime.canonicalSerialize(beforeSnapshot.tables[name].identity_values) === runtime.canonicalSerialize(afterSnapshot.tables[name].identity_values)),
    exact_row_retained: !!originalRow && !!retainedRow
      && runtime.canonicalSerialize(originalRow) === runtime.canonicalSerialize(retainedRow)
      && retainedRow.canonical_json === runtime.canonicalSerialize(context.packetValue)
      && retainedRow.packet_id === packetId,
    sidecars_unchanged: runtime.canonicalSerialize(beforeSnapshot.sidecar_digests) === runtime.canonicalSerialize(afterSnapshot.sidecar_digests),
  };
  const passed = Object.values(checks).every(Boolean);
  recordOracleHarnessReadback({ kind: 'append-only-custody-attacks', checks, attempts, passed });
  return { passed, checks, attempts, beforeSnapshot, afterSnapshot, retainedRow };
}

function oracleForeignKeyCorruptStore(store) {
  const db = new DatabaseSync(store.databasePath);
  try {
    const triggers = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='authority_packet_events' ORDER BY name").all();
    db.exec('PRAGMA foreign_keys=OFF');
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
    const packetId = `ap1-${'0'.repeat(64)}`;
    const payload = {
      namespace_digest: '1'.repeat(64),
      store_identity_digest: '2'.repeat(64),
      runtime_identity_digest: '3'.repeat(64),
      challenge: '4'.repeat(64),
    };
    const event = {
      schema: runtime.AUTHORITY_PACKET_EVENT_SCHEMA_ID,
      packet_id: packetId,
      sequence: 1,
      prior_event_id: null,
      event_type: 'READBACK_VERIFIED',
      payload,
      created_at: new Date().toISOString(),
    };
    const eventId = runtime.digestValue(event);
    const eventKey = runtime.digestValue({ schema: event.schema, packet_id: packetId, event_type: event.event_type, payload });
    db.prepare('INSERT INTO authority_packet_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      eventId, packetId, eventKey, 1, null, event.event_type, runtime.canonicalSerialize(event)
    );
    for (const trigger of triggers) db.exec(trigger.sql);
    db.exec('PRAGMA foreign_keys=ON');
  } finally { db.close(); }
  return store;
}

function oracleWrongAcceptanceContext(caseId) {
  const packetValue = packet({ seed: `oracle-acceptance-${oracleSafeSeed(caseId)}` });
  const storeOptions = options(oracleStateRoot(`oracle-acceptance-${oracleSafeSeed(caseId)}-`));
  const badReaders = readers(packetValue, {
    readWebDecision: () => ({
      ...webDecision(packetValue),
      packet_id: `ap1-${'0'.repeat(64)}`,
    }),
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, badReaders);
  const persisted = store.persistAuthorityPacket(packetValue, producerAdmission(packetValue));
  trackOracleAuthorityStore(store);
  return { store, persisted, readers: badReaders, packetValue, before: oracleCounts(store) };
}

function oracleBackfillContext(caseId, sourceMode) {
  const packetValue = packet({ seed: `oracle-backfill-${oracleSafeSeed(caseId)}` });
  const identities = runtime.authorityPacketIdentities(packetValue);
  const readerOverrides = sourceMode === 'complete'
    ? {
      readBackfillSource: () => ({
        source_ref: sourceReference('backfill-source'),
        source_packet: structuredClone(packetValue),
        source_packet_digest: identities.packet_digest,
        source_binding_digest: identities.binding_digest,
        producer_key: identities.producer_key,
        screening: screening(packetValue),
      }),
    }
    : sourceMode === 'invalid'
      ? { readBackfillSource: () => ({ source_ref: {} }) }
      : {};
  const storeOptions = options(oracleStateRoot(`oracle-backfill-${oracleSafeSeed(caseId)}-`));
  const readerSet = readers(packetValue, readerOverrides);
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
  trackOracleAuthorityStore(store);
  return { store, packetValue, readerSet, before: oracleCounts(store) };
}

function oracleV2ReceiptInputs(seed) {
  const authority = {
    child_comment_id: 1, parent_comment_id: 2, node_id: `IC_${seed}`, author_login: 'weijunswj',
    author_association: 'OWNER', body_digest: 'a'.repeat(64), updated_at: '2026-09-22T10:00:00.000Z',
    update_identity_digest: 'b'.repeat(64), scope_digest: 'c'.repeat(64),
  };
  const start = {
    base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), tree_sha: '3'.repeat(40),
    status_digest: 'd'.repeat(64), clean_worktree: true, ref: { detached: false, name: `oracle/${seed}` },
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

function oracleRejectValidationSurface(caseValue, context) {
  const original = structuredClone(context.packetValue);
  const identity = runtime.authorityPacketIdentities(original);
  const value = structuredClone(original);
  let expected = {};
  switch (caseValue.input.variant) {
    case 'changed-ownership-binding':
      value.bindings.lane_id = 'different-owned-lane';
      expected = { bindings: original.bindings };
      break;
    case 'section-or-evidence-tamper':
      value.body.sections[0].text += ' changed content';
      expected = { packet_id: identity.packet_id, packet_digest: identity.packet_digest, content_digest: identity.content_digest };
      break;
    case 'integration-regression':
      value.body.decision += ' integration regression';
      expected = { canonical_packet_bytes: identity.canonical_packet_bytes };
      break;
    case 'unknown-or-downgraded-schema':
      value.schema = 'toolkit.github-program.authority-packet.v0';
      break;
    case 'unknown-key':
      value.unexpected = true;
      break;
    case 'unknown-discriminant':
      value.schema = 'toolkit.github-program.authority-packet.unknown.v9';
      break;
    case 'credential-private-canary':
    case 'existing-negative-fixture':
      value.body.decision = 'password=synthetic-secret';
      break;
    case 'pointer-or-digest':
      value.body = { summary: identity.packet_digest };
      break;
    case 'reference-only-body':
      value.body = { evidence_refs: structuredClone(original.body.evidence_refs) };
      break;
    default:
      if (caseValue.expected.reason_code === 'GPR_PACKET_IDENTITY_MISMATCH') {
        value.body.decision += ' changed';
        expected = { packet_digest: identity.packet_digest, content_digest: identity.content_digest };
      } else if (caseValue.expected.reason_code === 'GPR_PACKET_BINDING_MISMATCH') {
        value.bindings.lane_id = 'different-owned-lane';
        expected = { bindings: original.bindings };
      } else if (caseValue.expected.reason_code === 'GPR_PACKET_CONTENT_MISMATCH') {
        expected = { canonical_packet_bytes: `${identity.canonical_packet_bytes}\n` };
      } else if (caseValue.expected.reason_code === 'GPR_PACKET_SCHEMA_UNSUPPORTED') {
        value.schema = 'toolkit.github-program.authority-packet.v0';
      } else {
        value.body.sections = [];
      }
  }
  return invokeOracleSurface(caseValue, 'runtime', runtime, 'validateAuthorityPacket', [value, expected]);
}

async function oracleRejectPersistenceSurface(caseValue, context) {
  const variant = caseValue.input.variant;
  if (variant === 'writer-killed-before-commit') return oracleCrashDuringPacketWrite(caseValue, context);
  if (variant === 'concurrent-conflicting-writers' || variant === 'conflicting-race') {
    return oracleConcurrentPacketWriters(caseValue, true);
  }
  const value = structuredClone(context.packetValue);
  if (variant === 'summary-only' || variant === 'terminal-envelope') {
    value.body = { schema: 'toolkit.execution-loop.terminal-packet.v1', summary: 'lifecycle only' };
  } else if (variant === 'oversize-or-unsafe') {
    value.body.decision = 'x'.repeat(runtime.AUTHORITY_PACKET_LIMITS.proseBytes + 1);
  } else {
    value.body.decision += ' conflicting same-producer content';
  }
  const store = ['repeated-content-changing-write', 'identity-mismatch', 'same-producer-conflict'].includes(variant)
    ? trackOracleAuthorityStore(runtime.createAuthorityPacketStore(context.storeOptions, readers(value)))
    : context.store;
  const admission = ['summary-only', 'terminal-envelope', 'oversize-or-unsafe'].includes(variant)
    ? {} : producerAdmission(value);
  const invocation = await invokeOracleSurface(caseValue, 'authorityPacketStore', store, 'persistAuthorityPacket', [value, admission]);
  if (caseValue.expected.side_effects === 'original-unchanged' || caseValue.expected.side_effects === 'original-retained') {
    const retained = store.readAuthorityPacket(context.persisted.packet_id, context.packetValue.bindings);
    ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).effect_delta.byte_equal_readback =
      runtime.canonicalSerialize(retained) === runtime.canonicalSerialize(context.packetValue);
  }
  return invocation;
}

function oracleRejectAcceptanceSurface(caseValue, context) {
  if (caseValue.input.variant === 'producer-crash-before-readback') {
    return oracleAcceptanceProcessFailure(caseValue, context, 'producer-crash-before-readback');
  }
  if (caseValue.input.variant === 'acceptance-write-interrupted') {
    return oracleAcceptanceProcessFailure(caseValue, context, 'acceptance-write-interrupted');
  }
  const badReaders = caseValue.input.variant === 'web-pass-before-readback'
    ? readers(context.packetValue, {
      screenPacket: () => {
        const error = new runtime.GprError('GPR_PACKET_READBACK_FAILED');
        error.packetBoundary = true;
        throw error;
      },
    })
    : readers(context.packetValue, {
      readWebDecision: () => ({ ...webDecision(context.packetValue), packet_id: `ap1-${'0'.repeat(64)}` }),
    });
  const store = trackOracleAuthorityStore(runtime.createAuthorityPacketStore(context.storeOptions, badReaders));
  return invokeOracleSurface(caseValue, 'authorityPacketStore', store, 'bindWebPacketAcceptance', [context.persisted.packet_id, badReaders]);
}

async function oracleRejectByCode(caseValue, context) {
  const code = caseValue.expected.reason_code;
  const surface = caseValue.surface;
  if (surface.startsWith('assurance.') || surface.startsWith('loop.') || surface.startsWith('receipt.')) {
    return oracleExpandedNegative(caseValue, context);
  }
  if (surface === 'validateAuthorityPacket') return oracleRejectValidationSurface(caseValue, context);
  if (surface === 'authorityPacketIdentities') {
    const first = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [context.packetValue]);
    const changed = structuredClone(context.packetValue);
    changed.body.decision += ' content-only change';
    const second = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [changed]);
    const identityBound = first.value.producer_key === second.value.producer_key
      && first.value.packet_digest !== second.value.packet_digest
      && first.value.content_digest !== second.value.content_digest;
    return oracleRecordDerivedOutcome(caseValue, {
      outcome: identityBound ? 'REJECT' : 'ACCEPT',
      code: identityBound ? 'GPR_PACKET_IDENTITY_MISMATCH' : 'ACCEPT',
    }, [first.receipt, second.receipt], { identity_match: identityBound });
  }
  if (surface === 'persistAuthorityPacket') return oracleRejectPersistenceSurface(caseValue, context);
  if (surface === 'bindWebPacketAcceptance') return oracleRejectAcceptanceSurface(caseValue, context);
  if (surface === 'verifyAuthorityPacketFresh') {
    if (caseValue.input.variant === 'transport-as-authority') {
      const delivery = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
        context.persisted.packet_id, context.packetValue.bindings,
      ]);
      if (delivery.error) throw delivery.error;
      const gate = oracleGate(context);
      const forgedIntent = {
        ...gate.consumer_intent,
        execution_binding: {
          ...gate.consumer_intent.execution_binding,
          semantic_run: JSON.stringify(delivery.value),
        },
      };
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'admitSemanticGate', [
        forgedIntent, gate.trusted_readers,
      ], true);
    }
    if (caseValue.input.variant === 'runtime-injection-timeout-stream' || caseValue.input.variant === 'same-process-reread') {
      const receipt = oracleFreshReaderFailureProcess(caseValue, context);
      return receipt;
    }
    if (caseValue.input.variant === 'producer-session-only') {
      const emptyStore = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
        options(oracleStateRoot(`oracle-session-only-${oracleSafeSeed(caseValue.id)}-`)), context.readerSet
      ));
      return invokeOracleSurface(caseValue, 'authorityPacketStore', emptyStore, surface, [
        context.persisted.packet_id, context.packetValue.bindings,
      ]);
    }
    const wrong = structuredClone(context.packetValue.bindings);
    return invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
      context.persisted.packet_id, wrong,
    ]);
  }
  if (surface === 'validateAuthorityPacketDelivery') {
    const fresh = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, 'verifyAuthorityPacketFresh', [
      context.persisted.packet_id, context.packetValue.bindings,
    ], true);
    if (fresh.error) throw fresh.error;
    if (caseValue.input.variant === 'envelope-only-or-truncated') {
      return invokeOracleSurface(caseValue, 'runtime', runtime, surface, [{}]);
    }
    const delivery = structuredClone(fresh.value);
    const tampered = structuredClone(delivery);
    if (caseValue.input.variant === 'delivery-over-capacity') tampered.envelope.canonical_packet_bytes = 'x'.repeat(runtime.AUTHORITY_PACKET_LIMITS.deliveryBytes + 1);
    else tampered.packet.body.decision += ' changed delivery';
    return invokeOracleSurface(caseValue, 'runtime', runtime, surface, [tampered]);
  }
  if (surface === 'authorityPacketStoreIdentity') {
    const wrong = { ...context.storeOptions, repository: 'other/repository' };
    const wrongPath = path.join(wrong.stateRoot, `github-program-receipt-${runtime.namespaceDigest({ repository: wrong.repository, parent_issue: wrong.parent_issue, child_issue: wrong.child_issue })}.sqlite`);
    fs.copyFileSync(context.store.databasePath, wrongPath);
    return invokeOracleSurface(caseValue, 'runtime', runtime, surface, [wrong]);
  }
  if (surface === 'readAuthorityPacket') {
    if (caseValue.input.variant === 'capacity-read-delete-fallback') {
      const seed = `oracle-over-capacity-${oracleSafeSeed(caseValue.id)}`;
      const validPacket = packet({ seed });
      const oversized = oraclePacketAtCanonicalSize(seed, runtime.AUTHORITY_PACKET_LIMITS.artifactBytes + 1);
      const storeOptions = options(oracleStateRoot(`oracle-over-capacity-${oracleSafeSeed(caseValue.id)}-`));
      const readerSet = readers(validPacket);
      const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
      const canonical = runtime.canonicalSerialize(oversized);
      const packetDigest = runtime.digestValue({ schema: oversized.schema, bindings: oversized.bindings, body: oversized.body });
      const packetId = `ap1-${packetDigest}`;
      const identity = runtime.authorityPacketIdentities(validPacket);
      const db = new DatabaseSync(store.databasePath);
      try {
        db.prepare('INSERT INTO authority_packets VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          packetId, identity.producer_key, packetDigest, runtime.digestValue(oversized.body),
          runtime.digestValue(oversized.bindings), canonical, new Date().toISOString()
        );
      } finally { db.close(); }
      trackOracleAuthorityStore(store);
      return invokeOracleSurface(caseValue, 'authorityPacketStore', store, surface, [packetId, oversized.bindings]);
    }
    const wrong = structuredClone(context.packetValue.bindings);
    if (caseValue.input.variant === 'producer-relabel') wrong.lane_id = 'wrong-lane';
    if (caseValue.input.variant === 'required-packet-unreadable') {
      return invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [`ap1-${'0'.repeat(64)}`, wrong]);
    }
    if (caseValue.input.variant === 'update-delete-replace-cleanup') {
      const custodyAttack = oracleAttemptAppendOnlyCustodyMutations(context);
      oracleTamperStore(context);
      const db = new DatabaseSync(context.store.databasePath, { readOnly: true });
      let retainedRow;
      try { retainedRow = db.prepare('SELECT * FROM authority_packets WHERE packet_id = ?').get(context.persisted.packet_id); }
      finally { db.close(); }
      const retained = !!retainedRow && retainedRow.packet_id === context.persisted.packet_id
        && retainedRow.canonical_json === '{}';
      recordOracleHarnessReadback({ kind: 'h04-required-row-retained', passed: retained,
        checks: { row_retained: retained, append_only_attacks_blocked: custodyAttack.passed } });
      if (!retained) throw new Error(`ORACLE_REQUIRED_PACKET_NOT_RETAINED:${caseValue.id}`);
      resetOracleEffectBaseline();
      const invocation = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.persisted.packet_id, context.packetValue.bindings]);
      ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).effect_delta.custody_attack_witness = custodyAttack.passed;
      return invocation;
    } else {
      wrong.repository = 'other/repository';
      wrong.authority.repository = 'other/repository';
      wrong.governance.repository = 'other/repository';
    }
    return invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.persisted.packet_id, wrong]);
  }
  if (surface === 'readAuthority') {
    const badReaders = readers(context.packetValue, { readAuthority: () => ({ authority: context.packetValue.bindings.authority, later_controlling_comments: [{ id: 1 }] }) });
    const call = await invokeOracleSurface(caseValue, 'reader', badReaders, surface, [{ packet_id: context.persisted.packet_id }]);
    const rejected = call.value && Array.isArray(call.value.later_controlling_comments) && call.value.later_controlling_comments.length > 0;
    return oracleRecordDerivedOutcome(caseValue, { outcome: rejected ? 'REJECT' : 'ACCEPT', code: rejected ? 'GPR_PACKET_AUTHORITY_UNVERIFIED' : 'ACCEPT' }, [call.receipt]);
  }
  if (surface === 'readCandidate') {
    const gate = oracleGate(context);
    const moved = { pr_number: 354, branch: 'wrong-candidate', base_ref: 'main', base_sha: 'c'.repeat(40), head_sha: 'a'.repeat(40), tree_sha: 'b'.repeat(40) };
    const badReaders = readers(context.packetValue, { readCandidate: () => moved });
    const call = await invokeOracleSurface(caseValue, 'reader', badReaders, surface, [{ packet_id: context.persisted.packet_id }]);
    const rejected = call.value && runtime.canonicalSerialize(call.value) !== runtime.canonicalSerialize(gate.consumer_intent.candidate);
    return oracleRecordDerivedOutcome(caseValue, { outcome: rejected ? 'REJECT' : 'ACCEPT', code: rejected ? 'GPR_PACKET_BINDING_MISMATCH' : 'ACCEPT' }, [call.receipt], { candidate_bound: !rejected });
  }
  if (surface === 'screenPacket') {
    const privatePacket = structuredClone(context.packetValue);
    privatePacket.body.decision = 'password=synthetic-secret';
    const privateReaders = readers(context.packetValue, { screenPacket: ({ packet: value }) => { runtime.validateAuthorityPacket(value); return screening(value); } });
    return invokeOracleSurface(caseValue, 'reader', privateReaders, surface, [{ packet: privatePacket }]);
  }
  if (surface === 'confirmCurrentPacketProjection') {
    const gate = oracleGate(context);
    const bad = structuredClone(gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers));
    if (caseValue.input.variant === 'remove-required-predecessor') bad.predecessors = [];
    else bad.consumer.scope_digest = runtime.digestValue({ changed: caseValue.id });
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [bad, gate.trusted_readers]);
  }
  if (surface === 'buildCurrentPacketProjection') {
    const gate = oracleGate(context);
    const wrong = { ...gate.consumer_intent, consumer: { ...gate.consumer_intent.consumer, scope_digest: runtime.digestValue({ changed: caseValue.id }) } };
    const packetId = gate.consumer_intent.predecessors[0].packet_id;
    const before = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
    const beforeArtifact = caseValue.requirement_id === 'X07'
      ? oraclePacketArtifactByteIdentity(gate.store, packetId) : null;
    const invocation = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [wrong, gate.trusted_readers]);
    const after = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
    ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).effect_delta.byte_equal_readback = before === after;
    if (caseValue.requirement_id === 'X07') {
      const afterArtifact = oraclePacketArtifactByteIdentity(gate.store, packetId);
      const preserved = !!invocation.error && invocation.error.code === caseValue.expected.reason_code
        && !!beforeArtifact && runtime.canonicalSerialize(beforeArtifact) === runtime.canonicalSerialize(afterArtifact);
      oracleEvidenceReceipt(caseValue, 'HUMANroundtrip', 'human-surface', {
        outcome: preserved ? 'ACCEPT' : 'REJECT', code: preserved ? 'ACCEPT' : 'GPR_PACKET_CURRENT_UNVERIFIED',
      }, {
        legacy_bytes_witness: preserved,
        byte_equal_readback: preserved,
      }, {
        before_artifact: beforeArtifact,
        after_artifact: afterArtifact,
        rejected_projection_code: invocation.error && invocation.error.code || null,
      }, [invocation.receipt]);
    }
    return invocation;
  }
  if (surface === 'admitSemanticGate') {
    if (caseValue.input.variant === 'missing-no-predecessor-classification') {
      const seed = `oracle-no-predecessor-unclassified-${oracleSafeSeed(caseValue.id)}`;
      let includeRequiredConsumers = true;
      const gate = semanticGate(seed, {
        readAuthority: () => ({
          authority: sourceReference(`loop-${seed}`),
          ...(includeRequiredConsumers ? { required_consumers: [] } : {}),
          later_controlling_comments: [],
        }),
      }, { noPredecessor: true, stateRoot: oracleStateRoot(`oracle-no-predecessor-unclassified-${oracleSafeSeed(caseValue.id)}-`) });
      includeRequiredConsumers = false;
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [gate.consumer_intent, gate.trusted_readers]);
    }
    const gate = oracleGate(context);
    if (caseValue.input.variant === 'missing-or-mismatched-current-readback') {
      gate.setCurrentBodyDigest(runtime.digestValue({ stale_current: caseValue.id }));
    }
    if (caseValue.input.variant === 'forged-or-serialized-handle') {
      const serializedAdmission = JSON.stringify({
        schema: runtime.SEMANTIC_GATE_ADMISSION_SCHEMA_ID,
        admission_id: 'forged-serialized-admission',
        consumer_key: 'a'.repeat(64),
      });
      const forgedIntent = JSON.parse(JSON.stringify({
        ...gate.consumer_intent,
        execution_binding: { ...gate.consumer_intent.execution_binding, semantic_run: serializedAdmission },
      }));
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [forgedIntent, gate.trusted_readers]);
    }
    if (caseValue.input.variant === 'lifecycle-or-compiler-custody') {
      const nonSemanticCustody = JSON.stringify({
        schema: 'toolkit.execution-loop.terminal-packet.v1',
        run_id: gate.consumer_intent.consumer.run,
        gate_contract_compiler_digest: runtime.digestValue('lifecycle-or-compiler-only'),
      });
      const intent = JSON.parse(JSON.stringify({
        ...gate.consumer_intent,
        execution_binding: { ...gate.consumer_intent.execution_binding, semantic_run: nonSemanticCustody },
      }));
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [intent, gate.trusted_readers]);
    }
    if (caseValue.input.variant === 'partial-circular-export') {
      oracleSemanticModuleImportProcess(caseValue, gate.store);
      const partialExport = JSON.stringify({
        schema: runtime.SEMANTIC_GATE_ADMISSION_SCHEMA_ID,
        partial: true,
        consumer_key: 'a'.repeat(64),
      });
      const intent = JSON.parse(JSON.stringify({
        ...gate.consumer_intent,
        execution_binding: { ...gate.consumer_intent.execution_binding, semantic_run: partialExport },
      }));
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [intent, gate.trusted_readers]);
    }
    if (caseValue.input.variant === 'chronology-only-input') {
      const { consumer: _consumer, ...intentWithoutSemanticConsumer } = gate.consumer_intent;
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [
        { ...intentWithoutSemanticConsumer, chronology: [{ order: 1, source: 'bounded-history' }] },
        gate.trusted_readers,
      ]);
    }
    const wrongIntent = { ...gate.consumer_intent, repository: caseValue.input.variant === 'consumer-relabelled-producer' ? 'other/repository' : gate.consumer_intent.repository };
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [wrongIntent, gate.trusted_readers]);
  }
  if (surface === 'recoverSemanticGateAdmission') {
    if (caseValue.input.variant === 'intent-without-outcome') {
      const gate = semanticGate(`oracle-recovery-unresolved-${oracleSafeSeed(caseValue.id)}`, {
        readDispatchOutcome: oracleDispatchOutcomeReader('ambiguous'),
      }, { stateRoot: oracleStateRoot(`oracle-recovery-unresolved-${oracleSafeSeed(caseValue.id)}-`) });
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      gate.store.beginSemanticGateDispatch(admission.admission);
      const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
      let consumerKey;
      try { consumerKey = db.prepare('SELECT consumer_key FROM semantic_gate_admissions LIMIT 1').get().consumer_key; }
      finally { db.close(); }
      resetOracleEffectBaseline();
      return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [{ consumer_key: consumerKey }, gate.trusted_readers]);
    }
    const gate = oracleGate(context);
    const lifecycleOnlyIdentity = { consumer_key: runtime.digestValue({ lifecycle_only: caseValue.id }) };
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [lifecycleOnlyIdentity, gate.trusted_readers]);
  }
  if (surface === 'revalidateSemanticGate') {
    const gate = oracleGate(context);
    const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
    if (caseValue.input.variant === 'superseded-predecessor') {
      const current = gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers);
      gate.setCurrentBodyDigest(runtime.digestValue({ changed_current: caseValue.id }));
      gate.store.confirmCurrentPacketProjection(current, gate.trusted_readers);
    } else {
      gate.setCurrentBodyDigest(runtime.digestValue({ stale: caseValue.id }));
    }
    resetOracleEffectBaseline();
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.admission, { operation: 'loop' }]);
  }
  if (surface === 'recordSemanticGateDispatch') {
    const gate = semanticGate(`oracle-dispatch-${oracleSafeSeed(caseValue.id)}`, { readDispatchOutcome: oracleDispatchOutcomeReader('ambiguous') });
    const admission = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'admitSemanticGate', [gate.consumer_intent, gate.trusted_readers], { setup: true });
    if (admission.error) throw admission.error;
    const intent = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'beginSemanticGateDispatch', [admission.value.admission], { setup: true });
    if (intent.error) throw intent.error;
    resetOracleEffectBaseline();
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.value.admission, {
      transport_id: intent.value.transport_id, transport_result: { status: 'ambiguous' }, transport_error: null,
    }]);
  }
  if (surface === 'recoverSemanticGateAdmission') {
    const gate = semanticGate(`oracle-recovery-${oracleSafeSeed(caseValue.id)}`, { readDispatchOutcome: oracleDispatchOutcomeReader('ambiguous') });
    const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
    gate.store.beginSemanticGateDispatch(admission.admission);
    const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
    const consumerKey = db.prepare('SELECT consumer_key FROM semantic_gate_admissions LIMIT 1').get().consumer_key;
    db.close();
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [{ consumer_key: consumerKey }, gate.trusted_readers]);
  }
  if (surface === 'backfillAuthorityPacket') {
    const mode = caseValue.input.variant === 'inferred-or-incomplete-source' ? 'invalid' : 'none';
    const backfill = oracleBackfillContext(caseValue.id, mode);
    return invokeOracleSurface(caseValue, 'authorityPacketStore', backfill.store, surface, [backfill.packetValue]);
  }
  if (surface === 'migrateAuthorityPacketStore') {
    const invalidOptions = options(oracleStateRoot(`oracle-migration-invalid-${oracleSafeSeed(caseValue.id)}-`));
    const legacy = trackOracleProgrammeReceiptStore(runtime.createProgrammeReceiptStore(invalidOptions));
    const db = new DatabaseSync(legacy.databasePath);
    try { db.exec('PRAGMA user_version=3'); } finally { db.close(); }
    const before = fs.readFileSync(legacy.databasePath);
    const beforeSnapshot = receiptEffectSnapshot(legacy);
    resetOracleEffectBaseline();
    const invocation = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [invalidOptions]);
    const after = fs.readFileSync(legacy.databasePath);
    const afterSnapshot = receiptEffectSnapshot(legacy);
    const unchanged = before.equals(after);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.object_before = beforeSnapshot;
    bound.object_after = afterSnapshot;
    bound.effect_delta.byte_equal_readback = unchanged;
    const event = activeOracleHarness && activeOracleHarness.events.at(-1);
    if (event && event.type === 'production-call' && event.method === surface) {
      event.object_before = beforeSnapshot;
      event.object_after = afterSnapshot;
    }
    return invocation;
  }
  if (surface === 'initialiseAuthorityPacketStore') {
    const storeOptions = options(oracleStateRoot(`oracle-init-invalid-${oracleSafeSeed(caseValue.id)}-`));
    const readerSet = readers(context.packetValue);
    const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(storeOptions, readerSet));
    if (caseValue.input.variant === 'altered-schema-guard') {
      store.persistAuthorityPacket(context.packetValue, producerAdmission(context.packetValue));
      oracleTamperStore({ store });
    } else {
      oracleForeignKeyCorruptStore(store);
    }
    resetOracleEffectBaseline();
    return invokeOracleSurface(caseValue, 'runtime', runtime, surface, [storeOptions, readerSet]);
  }
  throw new Error(`No production rejection handler for surface ${surface}`);
}
async function oracleCallValue(invocation) {
  invocation = await invocation;
  if (invocation.error) throw invocation.error;
  return invocation.value;
}

function oracleDispatchOutcomeReader(outcome) {
  return (input) => {
    const actualOutcome = typeof outcome === 'function' ? outcome(input) : outcome;
    return {
      admission_id: input.admission_id,
      consumer_key: input.consumer_key,
      intent_event_id: input.intent_event_id,
      attempt: input.attempt,
      transport_id: input.transport_id,
      transport_digest: input.transport_digest || runtime.digestValue({
        transport_id: input.transport_id,
        outcome: actualOutcome,
      }),
      outcome: actualOutcome,
      delayed_completion_excluded: actualOutcome === 'not-started',
    };
  };
}

async function oraclePositiveBySurface(caseValue, context) {
  const surface = caseValue.surface;
  if (surface && surface.includes('.')) return oracleExpandedPositive(caseValue, context);
  switch (surface) {
    case 'validateAuthorityPacket': {
      if (caseValue.expected.side_effects === 'legacy-pass-retained' || caseValue.expected.side_effects === 'compiler-and-shipping-green') {
        const value = oracleG2PassPacket(`oracle-${oracleSafeSeed(caseValue.id)}`);
        const call = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [value]);
        if (caseValue.expected.side_effects === 'compiler-and-shipping-green') {
          const compiled = gateContractCompiler.compileGateContract(value.body.gate_contract_ir);
          const controller = fs.readFileSync(path.join(repositoryRoot, 'repo', 'CONTROLLER.md'), 'utf8');
          const caseIds = compiled.generated_cases.map((item) => item.id);
          const oracleInventoryVerified = compiled.requirements.length === 66
            && compiled.generated_cases.length === 337 && compiled.coverage_map.length === 66
            && new Set(caseIds).size === caseIds.length
            && compiled.generated_cases.every((item) => item.assertion_count > 0);
          const compilerTests = oracleRunNodeTests([
            'repo/tests/toolkit-evidence-plan-compiler.test.cjs',
            'repo/tests/toolkit-gate-contract-compiler.test.cjs',
          ]);
          const compilerResultsVerified = compilerTests.command_passed && oracleInventoryVerified;
          const compilerFailureCode = !compilerTests.command_passed
            ? `ORACLE_COMPILER_TESTS_FAILED_${compilerTests.error_code || compilerTests.status}_${compilerTests.tests}_${compilerTests.passed}_${compilerTests.failed}`
            : 'ORACLE_COMPILER_INVENTORY_MISMATCH';
          const compilerReceipt = oracleEvidenceReceipt(caseValue, 'COMPILERS', 'compiler-tests', {
            outcome: compilerResultsVerified ? 'ACCEPT' : 'REJECT',
            code: compilerResultsVerified ? 'ACCEPT' : compilerFailureCode,
          }, {
            compiler_results_verified: compilerResultsVerified,
            oracle_inventory_verified: oracleInventoryVerified,
          }, {
            compiler_test_paths: [
              'repo/tests/toolkit-evidence-plan-compiler.test.cjs',
              'repo/tests/toolkit-gate-contract-compiler.test.cjs',
            ],
            compiler_test_summary: compilerTests,
            generated_case_count: compiled.generated_cases.length,
            generated_case_identity_count: new Set(caseIds).size,
            requirement_count: compiled.requirements.length,
            coverage_map_count: compiled.coverage_map.length,
            gate_contract_digest: runtime.digestValue(value.body.gate_contract_ir),
          }, [call.receipt]);
          const shippingPattern = 'shipping-first policy|shipping scope admission|POST_SHIP findings|shipping repair routing|G4 repair handoff|G3 leaf guidance|candidate acceptance|shipping policy remains symbolic';
          const shippingTests = oracleRunNodeTests(['repo/tests/controller-policy-separation.test.cjs'], [
            `--test-name-pattern=${shippingPattern}`,
          ]);
          const shippingResultsVerified = shippingTests.command_passed && shippingTests.passed === 9;
          const shippingReceipt = oracleEvidenceReceipt(caseValue, 'SHIPPING', 'shipping-tests', {
            outcome: shippingResultsVerified ? 'ACCEPT' : 'REJECT',
            code: shippingResultsVerified ? 'ACCEPT' : 'ORACLE_SHIPPING_REGRESSION_FAILED',
          }, { shipping_results_verified: shippingResultsVerified }, {
            shipping_test_path: 'repo/tests/controller-policy-separation.test.cjs',
            shipping_test_name_pattern: shippingPattern,
            shipping_test_summary: shippingTests,
            controller_digest: crypto.createHash('sha256').update(controller, 'utf8').digest('hex'),
          }, [call.receipt, compilerReceipt]);
          ORACLE_SURFACE_RECEIPTS.get(call.receipt).effect_delta.preservation_tests = compilerResultsVerified
            && shippingResultsVerified && oracleInventoryVerified;
          ORACLE_SURFACE_RECEIPTS.get(shippingReceipt).effect_delta.preservation_tests = compilerResultsVerified
            && shippingResultsVerified && oracleInventoryVerified;
        }
        if (caseValue.expected.side_effects === 'legacy-pass-retained') {
          ORACLE_SURFACE_RECEIPTS.get(call.receipt).effect_delta.legacy_pass_retained = call.value.body.verdict === 'PASS';
        }
        return oracleCallValue(call);
      }
      return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [context.packetValue]));
    }
    case 'authorityPacketIdentities':
      return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [context.packetValue]));
    case 'authorityPacketStoreIdentity':
      return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [context.storeOptions]));
    case 'initialiseAuthorityPacketStore':
      return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [context.storeOptions, context.readerSet]));
    case 'persistAuthorityPacket':
      if (caseValue.requirement_id === 'F02' && caseValue.expected.positive_control === true) {
        const gate = semanticGate(`oracle-replay-chain-${oracleSafeSeed(caseValue.id)}`, {}, {
          stateRoot: oracleStateRoot(`oracle-replay-chain-${oracleSafeSeed(caseValue.id)}-`),
          bindAcceptance: false,
          buildCurrent: false,
          confirmCurrent: false,
        });
        const packetId = gate.persisted.packet_id;
        const persisted = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [
          gate.packetValue, producerAdmission(gate.packetValue),
        ]);
        if (persisted.error) throw persisted.error;
        if (persisted.value.packet_id !== packetId) throw new Error(`ORACLE_REPLAY_CHAIN_PACKET_ID_CHANGED:${caseValue.id}`);
        const firstAcceptance = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'bindWebPacketAcceptance', [
          packetId, gate.trusted_readers,
        ]);
        if (firstAcceptance.error) throw firstAcceptance.error;
        const acceptanceReplay = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'bindWebPacketAcceptance', [
          packetId, gate.trusted_readers,
        ]);
        if (acceptanceReplay.error) throw acceptanceReplay.error;
        const projection = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'buildCurrentPacketProjection', [
          gate.consumer_intent, gate.trusted_readers,
        ]);
        if (projection.error) throw projection.error;
        gate.setCurrentProjection(projection.value);
        const firstConfirmation = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'confirmCurrentPacketProjection', [
          projection.value, gate.trusted_readers,
        ]);
        if (firstConfirmation.error) throw firstConfirmation.error;
        const confirmationReplay = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'confirmCurrentPacketProjection', [
          projection.value, gate.trusted_readers,
        ]);
        return oracleCallValue(confirmationReplay);
      }
      if (['A01', 'A02', 'B02'].includes(caseValue.requirement_id)
        && caseValue.expected.positive_control === true) {
        const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
          options(oracleStateRoot(`oracle-new-packet-${oracleSafeSeed(caseValue.id)}-`)), context.readerSet,
        ));
        return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', store, surface, [
          context.packetValue, producerAdmission(context.packetValue),
        ]));
      }
      if (caseValue.input.variant === 'concurrent-identical-writers') return oracleConcurrentPacketWriters(caseValue, false);
      if (caseValue.input.variant === 'serialized-conflict-resolution') {
        const packetValue = packet({ seed: `oracle-conflict-resolution-${oracleSafeSeed(caseValue.id)}` });
        const conflictPacket = structuredClone(packetValue);
        conflictPacket.body.decision = 'serialized conflicting packet body';
        const readerSet = readers(packetValue, { screenPacket: ({ packet: value }) => screening(value) });
        const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
          options(oracleStateRoot(`oracle-conflict-resolution-${oracleSafeSeed(caseValue.id)}-`)), readerSet
        ));
        const persisted = await invokeOracleSurface(caseValue, 'authorityPacketStore', store, surface, [
          packetValue, producerAdmission(packetValue),
        ]);
        if (persisted.error) throw persisted.error;
        const conflict = await invokeOracleSurface(caseValue, 'authorityPacketStore', store, surface, [
          conflictPacket, producerAdmission(conflictPacket),
        ]);
        if (!conflict.error || conflict.error.code !== 'GPR_PACKET_CONFLICT') {
          throw new Error(`ORACLE_SERIALIZED_CONFLICT_NOT_REJECTED:${caseValue.id}`);
        }
        return oracleCallValue(await invokeOracleSurface(caseValue, 'authorityPacketStore', store, 'bindWebPacketAcceptance', [
          persisted.value.packet_id, readerSet,
        ], true));
      }
      if (caseValue.input.variant === 'boundary-sized-safe') {
        const packetValue = oracleBoundarySizedPacket(`oracle-boundary-${oracleSafeSeed(caseValue.id)}`);
        const readerSet = readers(packetValue);
        const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
          options(oracleStateRoot(`oracle-boundary-${oracleSafeSeed(caseValue.id)}-`)), readerSet
        ));
        return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', store, surface, [
          packetValue, producerAdmission(packetValue),
        ]));
      }
      if (caseValue.input.variant === 'identical-repersistence') {
        const freshStore = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
          options(oracleStateRoot(`oracle-idempotent-${oracleSafeSeed(caseValue.id)}-`)), context.readerSet
        ));
        freshStore.persistAuthorityPacket(context.packetValue, producerAdmission(context.packetValue));
        return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', freshStore, surface, [context.packetValue, producerAdmission(context.packetValue)]));
      }
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.packetValue, producerAdmission(context.packetValue)]));
    case 'bindWebPacketAcceptance':
      if (caseValue.requirement_id === 'B05' && caseValue.expected.positive_control === true) {
        const first = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
          context.persisted.packet_id, context.readerSet,
        ]);
        if (first.error) throw first.error;
        const replay = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
          context.persisted.packet_id, context.readerSet,
        ]);
        return oracleCallValue(replay);
      }
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.persisted.packet_id, context.readerSet]));
    case 'verifyAuthorityPacketFresh':
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.persisted.packet_id, context.packetValue.bindings]));
    case 'validateAuthorityPacketDelivery': {
      if (caseValue.input.variant === 'valid-over-16k-packet') {
        const packetValue = structuredClone(context.packetValue);
        packetValue.body.sections[0].text = 'bounded authority detail '.repeat(1000);
        const readerSet = readers(packetValue);
        const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
          options(oracleStateRoot(`oracle-delivery-large-${oracleSafeSeed(caseValue.id)}-`)), readerSet
        ));
        const persisted = store.persistAuthorityPacket(packetValue, producerAdmission(packetValue));
        const fresh = await invokeOracleSurface(caseValue, 'authorityPacketStore', store, 'verifyAuthorityPacketFresh', [
          persisted.packet_id, packetValue.bindings,
        ], true);
        if (fresh.error) throw fresh.error;
        const delivery = fresh.value;
        return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [delivery, {
          expectedBindings: packetValue.bindings, packet: packetValue,
        }]));
      }
      const fresh = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, 'verifyAuthorityPacketFresh', [
        context.persisted.packet_id, context.packetValue.bindings,
      ], true);
      if (fresh.error) throw fresh.error;
      const delivery = fresh.value;
      return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [delivery, { expectedBindings: context.packetValue.bindings, packet: context.packetValue }]));
    }
    case 'readAuthorityPacket':
      if (caseValue.requirement_id === 'H03' && caseValue.expected.positive_control === true) {
        const first = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
          context.persisted.packet_id, context.packetValue.bindings, context.packetValue,
        ]);
        if (first.error) throw first.error;
        oracleReopenPacketReaderProcess(caseValue, context);
        return oracleCallValue(await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
          context.persisted.packet_id, context.packetValue.bindings, context.packetValue,
        ]));
      }
      if (['H04', 'X10'].includes(caseValue.requirement_id) && caseValue.expected.positive_control === true) {
        const oversized = oraclePacketAtCanonicalSize(`oracle-over-capacity-${oracleSafeSeed(caseValue.id)}`,
          runtime.AUTHORITY_PACKET_LIMITS.artifactBytes + 1);
        const write = await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store,
          'persistAuthorityPacket', [oversized, {}]);
        if (!write.error || write.error.code !== 'GPR_PACKET_LIMIT') {
          throw new Error(`ORACLE_CAPACITY_WRITE_NOT_BLOCKED:${write.error && write.error.code || 'ACCEPTED'}`);
        }
        ORACLE_SURFACE_RECEIPTS.get(write.receipt).effect_delta.over_legacy_limit =
          Buffer.byteLength(runtime.canonicalSerialize(oversized), 'utf8') > runtime.AUTHORITY_PACKET_LIMITS.artifactBytes;
        return oracleCallValue(await invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [
          context.persisted.packet_id, context.packetValue.bindings, context.packetValue,
        ]));
      }
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.persisted.packet_id, context.packetValue.bindings, context.packetValue]));
    case 'readAuthority':
      if (caseValue.requirement_id === 'C06') {
        const call = await invokeOracleSurface(caseValue, 'reader', context.readerSet, surface, [
          { packet_id: context.persisted.packet_id },
        ]);
        if (call.error) throw call.error;
        const expectedAuthority = {
          authority: context.packetValue.bindings.authority,
          producer_authority: {
            lane_id: context.packetValue.bindings.lane_id,
            human_owner: context.packetValue.bindings.human_owner,
            producer: context.packetValue.bindings.producer,
          },
          required_consumers: context.packetValue.bindings.applicability.required_consumers,
          completion_applicability: {
            schema: 'toolkit.github-program.semantic-completion-applicability.v1',
            scope_digest: context.packetValue.bindings.applicability.scope_digest,
            candidate: context.packetValue.bindings.candidate,
            required_consumers: [],
            retain_through_child_finality: false,
            retain_through_candidate_finality: false,
          },
          later_controlling_comments: [],
        };
        const exactAuthority = runtime.canonicalSerialize(call.value) === runtime.canonicalSerialize(expectedAuthority);
        return oracleRecordDerivedOutcome(caseValue, {
          outcome: exactAuthority ? 'ACCEPT' : 'REJECT',
          code: exactAuthority ? 'ACCEPT' : 'GPR_PACKET_AUTHORITY_UNVERIFIED',
        }, [call.receipt], { authority_revision_current: exactAuthority });
      }
      return oracleCallValue(invokeOracleSurface(caseValue, 'reader', context.readerSet, surface, [{ packet_id: context.persisted.packet_id }]));
    case 'readCandidate':
      if (caseValue.requirement_id === 'C07') {
        const candidatePacket = structuredClone(context.packetValue);
        const expectedCandidate = {
          pr_number: 354,
          branch: 'candidate/current',
          base_ref: 'main',
          base_sha: 'c'.repeat(40),
          head_sha: 'a'.repeat(40),
          tree_sha: 'b'.repeat(40),
        };
        candidatePacket.bindings.candidate = expectedCandidate;
        const candidateReaders = readers(candidatePacket, { readCandidate: () => structuredClone(expectedCandidate) });
        const call = await invokeOracleSurface(caseValue, 'reader', candidateReaders, surface, [
          { packet_id: context.persisted.packet_id },
        ]);
        if (call.error) throw call.error;
        const web = webDecision(candidatePacket, candidatePacket.bindings.applicability.required_consumers);
        const exactCandidate = runtime.canonicalSerialize(call.value) === runtime.canonicalSerialize(expectedCandidate);
        const successorApplicabilityExplicit = Array.isArray(web.successor_applicability)
          && runtime.canonicalSerialize(web.applicability) === runtime.canonicalSerialize(candidatePacket.bindings.applicability);
        return oracleRecordDerivedOutcome(caseValue, {
          outcome: exactCandidate && successorApplicabilityExplicit ? 'ACCEPT' : 'REJECT',
          code: exactCandidate && successorApplicabilityExplicit ? 'ACCEPT' : 'GPR_PACKET_BINDING_MISMATCH',
        }, [call.receipt], {
          candidate_tuple_exact: exactCandidate,
          successor_applicability_explicit: successorApplicabilityExplicit,
        });
      }
      return oracleCallValue(invokeOracleSurface(caseValue, 'reader', context.readerSet, surface, [{ packet_id: context.persisted.packet_id }]));
    case 'screenPacket':
      return oracleCallValue(invokeOracleSurface(caseValue, 'reader', context.readerSet, surface, [{ packet: context.packetValue }]));
    case 'admitSemanticGate': {
      const gate = oracleGate(context, caseValue.requirement_id === 'H01');
      if (caseValue.requirement_id === 'X05') oracleSemanticModuleImportProcess(caseValue, gate.store);
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [gate.consumer_intent, gate.trusted_readers]));
    }
    case 'revalidateSemanticGate': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      resetOracleEffectBaseline();
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.admission, { operation: 'loop' }]));
    }
    case 'beginSemanticGateDispatch': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.admission]));
    }
    case 'recoverSemanticGateAdmission': {
      const gate = semanticGate(`oracle-recover-${oracleSafeSeed(caseValue.id)}`, {
        readDispatchOutcome: oracleDispatchOutcomeReader((input) => input.recovery ? 'not-started' : 'not-started')
      }, { stateRoot: oracleStateRoot(`oracle-recover-${caseValue.id}-`) });
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      const intent = gate.store.beginSemanticGateDispatch(admission.admission);
      const dispatchRecord = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'recordSemanticGateDispatch', [admission.admission, {
        transport_id: intent.transport_id, transport_result: { status: 'not-started' }, transport_error: null
      }], { setup: true });
      if (dispatchRecord.error) throw dispatchRecord.error;
      ORACLE_SURFACE_RECEIPTS.get(dispatchRecord.receipt).include_setup_effect_deltas = true;
      const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
      let consumerKey;
      try { consumerKey = db.prepare('SELECT consumer_key FROM semantic_gate_admissions LIMIT 1').get().consumer_key; }
      finally { db.close(); }
      const recovered = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [{ consumer_key: consumerKey }, gate.trusted_readers]);
      if (recovered.error) throw recovered.error;
      const setupCall = caseValue.expected.side_effects !== 'new-attempt-permitted';
      const dispatch = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'beginSemanticGateDispatch', [recovered.value.admission], {
        setup: setupCall,
        supporting: !setupCall,
      });
      if (setupCall) markOracleReceiptAsSetup(dispatch.receipt);
      return recovered.value;
    }
    case 'buildCurrentPacketProjection': {
      const gate = oracleGate(context);
      const packetId = gate.consumer_intent.predecessors[0].packet_id;
      const before = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
      const beforeArtifact = caseValue.requirement_id === 'X07'
        ? oraclePacketArtifactByteIdentity(gate.store, packetId) : null;
      const projection = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [gate.consumer_intent, gate.trusted_readers]);
      if (projection.error) throw projection.error;
      const confirmation = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'confirmCurrentPacketProjection', [
        projection.value, gate.trusted_readers,
      ], true);
      if (confirmation.error) throw confirmation.error;
      const after = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
      const afterArtifact = caseValue.requirement_id === 'X07'
        ? oraclePacketArtifactByteIdentity(gate.store, packetId) : null;
      ORACLE_SURFACE_RECEIPTS.get(confirmation.receipt).effect_delta.byte_equal_readback = before === after;
      if (caseValue.requirement_id === 'X07') {
        const humanRoundtrip = JSON.parse(JSON.stringify(projection.value));
        const projectionExact = runtime.canonicalSerialize(humanRoundtrip) === runtime.canonicalSerialize(projection.value)
          && runtime.canonicalSerialize(confirmation.value.projection) === runtime.canonicalSerialize(humanRoundtrip);
        const artifactRetained = !!beforeArtifact
          && runtime.canonicalSerialize(beforeArtifact) === runtime.canonicalSerialize(afterArtifact);
        const confirmationBound = ORACLE_SURFACE_RECEIPTS.get(confirmation.receipt);
        const currentReadbackProof = oracleCurrentReadbackProof(projection.value, confirmation.value,
          confirmationBound.object_before, confirmationBound.object_after);
        const currentReadbackWitness = currentReadbackProof.passed;
        const currentWitness = projectionExact && artifactRetained && before === after
          && currentReadbackWitness;
        const witnessFailureCode = !projectionExact ? 'ORACLE_PROJECTION_ROUNDTRIP_MISMATCH'
          : !artifactRetained || before !== after ? 'ORACLE_LEGACY_PACKET_CHANGED'
            : `ORACLE_CURRENT_READBACK_${currentReadbackProof.failure}`;
        oracleEvidenceReceipt(caseValue, 'HUMANroundtrip', 'human-surface', {
          outcome: currentWitness ? 'ACCEPT' : 'REJECT', code: currentWitness ? 'ACCEPT' : witnessFailureCode,
        }, {
          current_legacy_witness: currentWitness,
          byte_equal_readback: artifactRetained && before === after,
        }, {
          projection_digest: runtime.digestValue(projection.value),
          roundtrip_digest: runtime.digestValue(humanRoundtrip),
          confirmed_projection_digest: runtime.digestValue(confirmation.value.projection),
          before_artifact: beforeArtifact,
          after_artifact: afterArtifact,
          readback_event_ids: confirmation.value.readback_event_ids,
        }, [projection.receipt, confirmation.receipt]);
      }
      return oracleCallValue(confirmation);
    }
    case 'confirmCurrentPacketProjection': {
      const gate = semanticGate(`confirm-${oracleSafeSeed(caseValue.id)}`, {}, {
        stateRoot: oracleStateRoot(`oracle-confirm-${caseValue.id}-`), confirmCurrent: false,
      });
      const current = gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers);
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [current, gate.trusted_readers]));
    }
    case 'recordSemanticGateDispatch': {
      const gate = oracleGate(context);
      const admission = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'admitSemanticGate', [gate.consumer_intent, gate.trusted_readers], { setup: true });
      if (admission.error) throw admission.error;
      const intent = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'beginSemanticGateDispatch', [admission.value.admission], { setup: true });
      if (intent.error) throw intent.error;
      ORACLE_SURFACE_RECEIPTS.get(intent.receipt).include_setup_effect_deltas = true;
      resetOracleEffectBaseline();
      const transport = { transport_id: intent.value.transport_id, transport_result: { status: 'confirmed' }, transport_error: null };
      const invocation = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.value.admission, transport]);
      if (invocation.error) throw invocation.error;
      ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).effect_delta.dispatch_witness = verifySemanticDispatchEventWitness(
        gate.store, gate.consumer_intent, admission.value, intent.value, transport, invocation.value,
        ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).object_before,
        ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).object_after,
      );
      return invocation.value;
    }
    case 'backfillAuthorityPacket': {
      const backfill = oracleBackfillContext(caseValue.id, 'complete');
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', backfill.store, surface, [backfill.packetValue]));
    }
    case 'migrateAuthorityPacketStore': {
      const seed = oracleSafeSeed(caseValue.id);
      const legacyOptions = options(oracleStateRoot(`oracle-migration-valid-${seed}-`));
      const inputs = oracleV2ReceiptInputs(seed);
      const legacyStore = trackOracleProgrammeReceiptStore(runtime.createProgrammeReceiptStore(legacyOptions));
      const session = await legacyStore.startRun({ lock: `lock-${seed}`, authority: inputs.authority, start: inputs.start, candidate: null, lease_ms: 60000 }, inputs.readers);
      legacyStore.interruptRun(session, { payload: { classification: 'RUN_INTERRUPTED' } });
      const before = legacyStore.readReceiptChain(session.run_id);
      const sourceDb = new DatabaseSync(legacyStore.databasePath, { readOnly: true });
      let beforeRows;
      try { beforeRows = sourceDb.prepare('SELECT * FROM receipts WHERE run_id = ? ORDER BY sequence').all(session.run_id).map((row) => ({ ...row })); }
      finally { sourceDb.close(); }
      const migration = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [legacyOptions]);
      if (migration.error) throw migration.error;
      const after = legacyStore.readReceiptChain(session.run_id);
      const unchanged = runtime.canonicalSerialize(before) === runtime.canonicalSerialize(after);
      const targetDb = new DatabaseSync(migration.value.databasePath, { readOnly: true });
      let targetVersion;
      let targetFingerprint;
      let integrity;
      let foreignKeyErrors;
      let afterRows;
      try {
        targetVersion = Number(targetDb.prepare('PRAGMA user_version').get().user_version);
        targetFingerprint = targetDb.prepare('SELECT schema_fingerprint FROM metadata WHERE singleton = 1').get()?.schema_fingerprint;
        integrity = targetDb.prepare('PRAGMA integrity_check').all();
        foreignKeyErrors = targetDb.prepare('PRAGMA foreign_key_check').all();
        afterRows = targetDb.prepare('SELECT * FROM receipts WHERE run_id = ? ORDER BY sequence').all(session.run_id).map((row) => ({ ...row }));
      } finally { targetDb.close(); }
      const historicalRowsExact = runtime.canonicalSerialize(beforeRows) === runtime.canonicalSerialize(afterRows)
        && before.map((item) => item.receipt_type).join(',') === 'RUN_STARTED,RUN_INTERRUPTED';
      const migrationVerified = unchanged && historicalRowsExact
        && migration.value.databasePath === legacyStore.databasePath
        && typeof migration.value.storeIdentityDigest === 'function'
        && migration.value.storeIdentityDigest().length === 64
        && runtime.assertAuthenticAuthorityPacketStore(migration.value) === true
        && targetVersion === runtime.AUTHORITY_PACKET_USER_VERSION
        && targetFingerprint === runtime.expectedAuthorityPacketSchemaFingerprint()
        && integrity.length === 1 && integrity[0].integrity_check === 'ok'
        && foreignKeyErrors.length === 0;
      if (activeOracleHarness && unchanged) activeOracleHarness.counters.byte_equal_readback = true;
      const measured = ORACLE_SURFACE_RECEIPTS.get(migration.receipt);
      measured.effect_delta.byte_equal_readback = unchanged;
      measured.effect_delta.v4_historical_preserved = migrationVerified;
      measured.effect_delta.migration_witness = migrationVerified;
      return migration.value;
    }
    default:
      throw new Error(`No positive oracle action for ${surface}`);
  }
}

function oracleReceiptAuthority(seed) {
  return {
    child_comment_id: 1, parent_comment_id: 2, node_id: `IC_${seed}`, author_login: 'weijunswj',
    author_association: 'OWNER', body_digest: 'a'.repeat(64), updated_at: '2026-09-22T10:00:00.000Z',
    update_identity_digest: 'b'.repeat(64), scope_digest: 'c'.repeat(64),
  };
}

function oracleReceiptExecution(caseValue) {
  const seed = oracleSafeSeed(caseValue.id);
  const gate = semanticGate(`receipt-${seed}`, {}, { stateRoot: oracleStateRoot(`oracle-receipt-gate-${seed}-`) });
  const semanticRun = gate.consumer_intent.consumer.run;
  const receiptRunId = `receipt-${seed}`;
  const loopRunId = gate.consumer_intent.execution_binding.loop_run_id;
  gate.consumer_intent.execution_binding.semantic_run = semanticRun;
  gate.consumer_intent.execution_binding.receipt_run_id = receiptRunId;
  const semanticAdmission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  const authority = oracleReceiptAuthority(seed);
  const start = {
    base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), tree_sha: '3'.repeat(40),
    status_digest: 'd'.repeat(64), clean_worktree: true, ref: { detached: false, name: `oracle/${seed}` },
  };
  const requiredConsumers = gate.consumer_intent.predecessors.map((item) => ({
    class: gate.consumer_intent.consumer.stage,
    dependency_id: item.dependency_id,
    scope_digest: gate.consumer_intent.consumer.scope_digest,
  }));
  let declareDependencies = true;
  let declareSemanticBinding = true;
  let observedBinding = { semantic_run: semanticRun, receipt_run_id: receiptRunId, loop_run_id: loopRunId };
  const authoritySnapshot = () => ({
    authority,
    ...(declareDependencies ? { required_consumers: requiredConsumers } : {}),
    completion_applicability: {
      schema: 'toolkit.github-program.semantic-completion-applicability.v1',
      scope_digest: gate.consumer_intent.consumer.scope_digest,
      candidate: null,
      required_consumers: [],
      retain_through_child_finality: false,
      retain_through_candidate_finality: false,
    },
    ...(declareSemanticBinding ? { semantic_binding: structuredClone(observedBinding) } : {}),
    later_controlling_comments: [],
  });
  const store = trackOracleProgrammeReceiptStore(runtime.createProgrammeReceiptStore(options(oracleStateRoot(`oracle-receipt-${seed}-`))));
  const semantic_gate = { store: gate.store, admission: semanticAdmission.admission };
  const allocation = {
    lock: gate.consumer_intent.consumer.lock,
    authority,
    start,
    candidate: null,
    lease_ms: 60000,
    semantic_gate,
  };
  const startReaders = { readAuthority: authoritySnapshot, readStart: async () => start };
  const targetIdentity = { resource_type: 'provider_resource', resource_id: `oracle-${seed}` };
  const descriptor = {
    operation_kind: 'IDEMPOTENT_SET', safety_class: 'IDEMPOTENT', target_identity: targetIdentity,
    target_digest: runtime.digestValue(targetIdentity), expected_source_digest: 'e'.repeat(64),
    cas_digest: 'f'.repeat(64), expected_post_state_digest: '1'.repeat(64),
    adapter_identity_digest: '2'.repeat(64), retry_of_operation_id: null,
  };
  const mutationReaders = {
    readAuthority: authoritySnapshot,
    readSource: async () => ({ source_digest: descriptor.expected_source_digest, cas_digest: descriptor.cas_digest }),
    verifyOutcomeEvidence: async (value) => value,
  };
  return {
    store, gate, allocation, startReaders, mutationReaders, descriptor, semantic_gate,
    setDeclaredDependencies(value) { declareDependencies = value; },
    setDeclaredSemanticBinding(value) { declareSemanticBinding = value; },
    setObservedBinding(value) { observedBinding = structuredClone(value); },
  };
}

async function oracleExpandedReceiptPositive(caseValue) {
  const target = oracleReceiptExecution(caseValue);
  resetOracleEffectBaseline();
  const store = target.store;
  const surface = caseValue.surface;
  if (surface === 'receipt.startRun') {
    return oracleCallValue(invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'startRun', [target.allocation, target.startReaders]));
  }
  if (surface === 'receipt.allocateRun->startAllocatedRun') {
    const session = await oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'allocateRun', [target.allocation]));
    return oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'startAllocatedRun', [session, target.startReaders]));
  }
  if (surface === 'receipt.authorizeMutationDispatch') {
    const start = await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'startRun', [target.allocation, target.startReaders], { setup: true });
    if (start.error) throw start.error;
    const admission = await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'admitMutationOperation', [start.value, target.descriptor, target.mutationReaders], { setup: true });
    if (admission.error) throw admission.error;
    ORACLE_SURFACE_RECEIPTS.get(admission.receipt).include_setup_effect_deltas = true;
    const firstAuthorization = await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'authorizeMutationDispatch', [start.value, admission.value]);
    if (firstAuthorization.error) throw firstAuthorization.error;
    await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'authorizeMutationDispatch', [start.value, admission.value]);
    return firstAuthorization.value;
  }
  const started = await store.startRun(target.allocation, target.startReaders);
  if (activeOracleHarness) activeOracleHarness.counters.fresh_reader_processes += 1;
  if (surface === 'receipt.appendReceipt') {
    resetOracleEffectBaseline();
    return oracleCallValue(invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'appendReceipt', [started, {
      receipt_type: 'TRANSITION_PREVIEW', candidate: null, payload: { classification: 'ORACLE' }, created_at: new Date().toISOString(),
    }]));
  }
  if (surface === 'receipt.admitMutationOperation') {
    return oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'admitMutationOperation', [started, target.descriptor, target.mutationReaders]));
  }
  throw new Error(`Unknown receipt production surface ${surface}`);
}

function oracleLoopCommon(caseValue, delegated = false, noPredecessor = false) {
  const seed = oracleSafeSeed(caseValue.id);
  const completionApplicability = ['loop.completeRun', 'loop.governedCompletion'].includes(caseValue.surface)
    ? {
      schema: 'toolkit.github-program.semantic-completion-applicability.v1',
      scope_digest: runtime.digestValue({ seed, scope: 'terminal-completion' }),
      candidate: null,
      required_consumers: [{
        class: 'G4', dependency_id: `g4-${seed}`,
        scope_digest: runtime.digestValue({ seed, scope: 'terminal-completion' }),
      }],
      retain_through_child_finality: true,
      retain_through_candidate_finality: false,
    }
    : null;
  const gate = semanticGate(`expanded-${seed}`, completionApplicability
    ? { completion_applicability: completionApplicability } : {}, {
    stateRoot: oracleStateRoot(`oracle-expanded-gate-${seed}-`), noPredecessor,
  });
  return {
    caseValue,
    gate,
    completionApplicability,
    stateRoot: oracleStateRoot(`oracle-loop-state-${seed}-`),
    common: {
      task: { id: `oracle-task-${seed}`, digest: 'a'.repeat(64) },
      repository_id: 'b'.repeat(64), authorized_ref_digest: 'c'.repeat(64), current_authority_digest: 'd'.repeat(64),
      authority: delegated ? { delegated: true, lanes: ['worker-a', 'worker-b'] } : { delegated: false, lanes: [] },
      adapters: delegated ? {
        'worker-a': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
        'worker-b': { available: true, provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', reasoning: 'high', role: 'worker', host_classification: 'guidance-only' },
      } : {},
      consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
      semantic_gate: gate,
      run_id: `oracle-${seed}`,
    },
  };
}

async function oracleLoopWorkspace(base) {
  const admittedCall = await invokeOracleSurface(base.caseValue, 'executionLoop', executionLoop, 'admitRun', [base.common], { setup: true });
  if (admittedCall.error) throw admittedCall.error;
  markOracleReceiptAsSetup(admittedCall.receipt);
  const admitted = admittedCall.value;
  const live = { ref: 'refs/heads/main', sha: '1'.repeat(40), tree: '2'.repeat(40) };
  const workspace = executionLoop.admitWorkspace({
    state_root: base.stateRoot,
    run: admitted.run,
    expected_live: live,
    liveRefProvider: { read: () => live },
    workspaceAdapter: {
      prepare: () => ({ workspace_id: `workspace-${base.common.run_id}`, workspace_handle: `handle-${base.common.run_id}`, commit_sha: live.sha, tree_sha: live.tree }),
      verifySnapshot: () => true,
    },
  });
  return { ...base, admitted, live, workspace };
}

async function verifyOracleLoopRunWitness(caseValue, gate, returned, options = {}) {
  const checks = {};
  try {
    const run = options.run;
    const request = executionLoop.validateRequest(options.request);
    const routePlan = executionLoop.validateRoutePlan(options.routePlan);
    const validatedRun = executionLoop.validateRunReceipt(run);
    const workspaceReceipt = options.workspaceReceipt || null;
    checks.run_binding_exact = runtime.canonicalSerialize(run) === runtime.canonicalSerialize(validatedRun)
      && run.execution_state === options.expectedState
      && run.run_id === options.expectedRunId
      && run.request_digest === runtime.digestValue(request)
      && run.repository_id === request.repository_id
      && run.authorized_ref_digest === request.authorized_ref_digest
      && run.current_authority_digest === request.current_authority_digest
      && run.route_digest === routePlan.route_digest
      && run.authority_binding_digest === runtime.digestValue({
        run_id: run.run_id,
        request_id: request.request_id,
        current_authority_digest: run.current_authority_digest,
        repository_id: run.repository_id,
        authorized_ref_digest: run.authorized_ref_digest,
        route_digest: routePlan.route_digest,
      })
      && runtime.canonicalSerialize(run.current_lanes.map((lane) => lane.lane_id))
        === runtime.canonicalSerialize(routePlan.lanes.map((lane) => lane.lane_id));
    checks.route_request_exact = runtime.canonicalSerialize(options.request) === runtime.canonicalSerialize(request)
      && runtime.canonicalSerialize(options.routePlan) === runtime.canonicalSerialize(routePlan)
      && routePlan.request_id === request.request_id
      && routePlan.repository_id === request.repository_id
      && routePlan.authorized_ref_digest === request.authorized_ref_digest
      && routePlan.delegated === request.delegated
      && routePlan.root_only === !request.delegated
      && runtime.canonicalSerialize(routePlan.lanes.map((lane) => lane.lane_id))
        === runtime.canonicalSerialize(options.expectedLaneIds || []);
    checks.workspace_exact = workspaceReceipt === null
      ? run.workspace_receipt_digest === null
      : executionLoop.validateWorkspaceReceipt(workspaceReceipt).verified === true
        && workspaceReceipt.run_id === run.run_id
        && workspaceReceipt.repository_id === run.repository_id
        && workspaceReceipt.authorized_ref_digest === run.authorized_ref_digest
        && run.workspace_receipt_digest === runtime.digestValue(workspaceReceipt);
    if (options.wrapperStatus) {
      checks.wrapper_exact = returned.status === options.wrapperStatus
        && Array.isArray(returned.launches)
        && runtime.canonicalSerialize(returned.launches) === runtime.canonicalSerialize(options.expectedLaunches || [])
        && returned.run === run
        && runtime.canonicalSerialize(returned.route_plan) === runtime.canonicalSerialize(routePlan)
        && (options.wrapperStatus !== 'admitted'
          || runtime.canonicalSerialize(returned.request) === runtime.canonicalSerialize(request)
            && returned.consent && returned.consent.enabled === true
            && returned.consent.state === 'enabled'
            && /^[a-f0-9]{64}$/.test(returned.consent.status_digest))
        && (options.wrapperStatus !== 'ready'
          || returned.workspace_receipt && runtime.canonicalSerialize(returned.workspace_receipt) === runtime.canonicalSerialize(workspaceReceipt));
      if (options.wrapperStatus === 'running') {
        checks.wrapper_exact = checks.wrapper_exact && returned.consent && returned.consent.enabled === true
          && returned.consent.state === 'enabled' && /^[a-f0-9]{64}$/.test(returned.consent.status_digest)
          && runtime.canonicalSerialize(returned.workspace_receipt) === runtime.canonicalSerialize(workspaceReceipt);
      }
    } else checks.wrapper_exact = returned === run;

    const beforeCount = options.beforeSnapshot && options.beforeSnapshot.tables.semantic_gate_admissions.count;
    const afterCount = options.afterSnapshot && options.afterSnapshot.tables.semantic_gate_admissions.count;
    checks.admission_delta_exact = Number.isSafeInteger(beforeCount) && Number.isSafeInteger(afterCount)
      && afterCount - beforeCount === options.admissionDelta;
    const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
    let rows;
    try { rows = db.prepare('SELECT * FROM semantic_gate_admissions ORDER BY created_at, admission_id').all(); }
    finally { db.close(); }
    const records = rows.map((row) => ({ row, record: JSON.parse(row.canonical_json) }));
    const matching = records.filter(({ record }) => record.execution_binding
      && record.execution_binding.loop_run_id === run.run_id);
    const expectedExecutionBinding = {
      ...gate.consumer_intent.execution_binding,
      semantic_run: gate.consumer_intent.consumer.run,
      loop_run_id: run.run_id,
      repository_id: run.repository_id,
      authorized_ref_digest: run.authorized_ref_digest,
      current_authority_digest: run.current_authority_digest,
    };
    checks.admission_record_exact = matching.length === 1
      && runtime.canonicalSerialize(runtime.validateSemanticGateAdmission(matching[0].record))
        === runtime.canonicalSerialize(matching[0].record)
      && matching[0].row.admission_id === matching[0].record.admission_id
      && matching[0].row.consumer_key === matching[0].record.consumer_key
      && matching[0].row.canonical_json === runtime.canonicalSerialize(matching[0].record)
      && matching[0].record.repository === gate.consumer_intent.repository
      && matching[0].record.parent_issue === gate.consumer_intent.parent_issue
      && matching[0].record.child_issue === gate.consumer_intent.child_issue
      && matching[0].record.lane_id === gate.consumer_intent.lane_id
      && matching[0].record.human_owner === gate.consumer_intent.human_owner
      && runtime.canonicalSerialize(matching[0].record.consumer) === runtime.canonicalSerialize(gate.consumer_intent.consumer)
      && matching[0].record.candidate === gate.consumer_intent.candidate
      && runtime.canonicalSerialize(matching[0].record.execution_binding) === runtime.canonicalSerialize(expectedExecutionBinding)
      && matching[0].record.predecessors.length === 1
      && matching[0].record.predecessors[0].packet_id === gate.persisted.packet_id
      && matching[0].record.predecessors[0].dependency_id === gate.consumer_intent.predecessors[0].dependency_id;

    const packet = gate.store.readAuthorityPacket(gate.persisted.packet_id, gate.packetValue.bindings);
    const packetIdentity = runtime.authorityPacketIdentities(packet);
    const reopened = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store,
      'verifyAuthorityPacketFresh', [gate.persisted.packet_id, gate.packetValue.bindings], { setup: true });
    const reopenedBound = ORACLE_SURFACE_RECEIPTS.get(reopened.receipt);
    checks.predecessor_packet_fresh_readback = !reopened.error
      && reopenedBound.actual.outcome === 'ACCEPT'
      && reopenedBound.effect_delta.byte_equal_readback === true
      && packetIdentity.packet_id === gate.persisted.packet_id
      && reopened.value.envelope.packet_id === gate.persisted.packet_id
      && reopened.value.envelope.packet_digest === packetIdentity.packet_digest
      && reopened.value.envelope.content_digest === packetIdentity.content_digest
      && reopened.value.envelope.binding_digest === packetIdentity.binding_digest
      && runtime.canonicalSerialize(reopened.value.packet) === packetIdentity.canonical_packet_bytes;

    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'execution-loop-admission', run_id: run.run_id, checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'execution-loop-admission',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function verifyOracleDelegatedRunWitness(caseValue, base, prepared, returned, evidence = {}) {
  const checks = {};
  try {
    const expectedLaneIds = prepared.admitted.route_plan.lanes.map((lane) => lane.lane_id);
    const beforeSnapshot = evidence.beforeSnapshot;
    const afterSnapshot = evidence.afterSnapshot;
    checks.execution_run_witness = await verifyOracleLoopRunWitness(caseValue, base.gate, returned, {
      run: returned.run,
      request: prepared.admitted.request,
      routePlan: prepared.admitted.route_plan,
      expectedRunId: prepared.workspace.run.run_id,
      expectedState: 'running',
      expectedLaneIds,
      expectedLaunches: expectedLaneIds,
      wrapperStatus: 'running',
      workspaceReceipt: prepared.workspace.workspace_receipt,
      admissionDelta: 0,
      beforeSnapshot,
      afterSnapshot,
    });

    checks.atomic_batch_adapter_called_once = evidence.reservationLaneIds.length === expectedLaneIds.length
      && runtime.canonicalSerialize(evidence.reservationLaneIds) === runtime.canonicalSerialize(expectedLaneIds)
      && evidence.commitCalls === 1
      && evidence.batchCommitInput
      && evidence.batchCommitResult
      && evidence.batchCommitResult.atomic === true
      && evidence.batchCommitResult.committed === true
      && runtime.canonicalSerialize(evidence.batchCommitResult.started_lane_ids) === runtime.canonicalSerialize(expectedLaneIds);

    const db = new DatabaseSync(base.gate.store.databasePath, { readOnly: true });
    let matching;
    let events;
    try {
      const rows = db.prepare('SELECT * FROM semantic_gate_admissions ORDER BY admission_id').all()
        .map((row) => ({ row, record: JSON.parse(row.canonical_json) }));
      matching = rows.filter(({ record }) => record.execution_binding
        && record.execution_binding.loop_run_id === returned.run.run_id);
      events = matching.length === 1
        ? db.prepare('SELECT * FROM semantic_gate_admission_events WHERE admission_id = ? ORDER BY sequence').all(matching[0].record.admission_id)
        : [];
    } finally { db.close(); }
    checks.dispatch_row_bound = matching.length === 1
      && runtime.validateSemanticGateAdmission(matching[0].record)
      && matching[0].row.canonical_json === runtime.canonicalSerialize(matching[0].record)
      && matching[0].record.predecessors.length === 1
      && matching[0].record.predecessors[0].packet_id === base.gate.persisted.packet_id;

    const admission = matching[0] && matching[0].record;
    const transportId = admission && runtime.digestValue({
      schema: 'toolkit.github-program.semantic-dispatch-transport.v1',
      admission_id: admission.admission_id,
      consumer_key: admission.consumer_key,
      attempt: 1,
    });
    const intentEvidence = admission && {
      admission_id: admission.admission_id,
      consumer_key: admission.consumer_key,
      action: 'DISPATCH_INTENT',
      attempt: 1,
      transport_id: transportId,
    };
    const observedDispatch = admission && {
      admission_id: admission.admission_id,
      consumer_key: admission.consumer_key,
      intent_event_id: events[0] && events[0].event_id,
      attempt: 1,
      transport_id: transportId,
      transport_digest: runtime.digestValue({
        transport_id: transportId,
        transport_result: evidence.batchCommitResult,
        transport_error: null,
      }),
      outcome: 'confirmed',
      delayed_completion_excluded: false,
    };
    const eventValues = events.map((row) => ({ row, event: JSON.parse(row.canonical_json) }));
    checks.dispatch_chain_exact = eventValues.length === 2
      && eventValues[0].row.sequence === 1 && eventValues[0].row.event_type === 'DISPATCH_INTENT'
      && eventValues[0].event.schema === runtime.SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID
      && eventValues[0].event.admission_id === admission.admission_id
      && eventValues[0].event.sequence === 1 && eventValues[0].event.prior_event_id === null
      && eventValues[0].event.event_type === 'DISPATCH_INTENT'
      && eventValues[0].event.transport_evidence_digest === runtime.digestValue(intentEvidence)
      && eventValues[0].row.event_id === runtime.digestValue(eventValues[0].event)
      && eventValues[1].row.sequence === 2 && eventValues[1].row.event_type === 'DISPATCH_CONFIRMED'
      && eventValues[1].event.schema === runtime.SEMANTIC_GATE_ADMISSION_EVENT_SCHEMA_ID
      && eventValues[1].event.admission_id === admission.admission_id
      && eventValues[1].event.sequence === 2 && eventValues[1].event.prior_event_id === eventValues[0].row.event_id
      && eventValues[1].event.event_type === 'DISPATCH_CONFIRMED'
      && eventValues[1].event.transport_evidence_digest === runtime.digestValue(observedDispatch)
      && eventValues[1].row.event_id === runtime.digestValue(eventValues[1].event)
      && receiptTableDelta(beforeSnapshot, afterSnapshot, 'semantic_gate_admission_events') === 2;
    checks.adapter_input_exact = evidence.batchCommitInput
      && runtime.canonicalSerialize(Object.keys(evidence.batchCommitInput).sort()) === runtime.canonicalSerialize([
        'route_plan', 'reservations', 'run_id', 'transport_id', 'repository_id',
        'authorized_ref_digest', 'current_authority_digest', 'workspace_receipt',
      ].sort())
      && runtime.canonicalSerialize(evidence.batchCommitInput.route_plan) === runtime.canonicalSerialize(prepared.admitted.route_plan)
      && runtime.canonicalSerialize(evidence.batchCommitInput.reservations) === runtime.canonicalSerialize(expectedLaneIds.map((lane_id) => ({
        lane_id, reservation_handle: `reservation-${lane_id}`, inert: true,
      })))
      && evidence.batchCommitInput.run_id === returned.run.run_id
      && evidence.batchCommitInput.transport_id === transportId
      && evidence.batchCommitInput.repository_id === returned.run.repository_id
      && evidence.batchCommitInput.authorized_ref_digest === returned.run.authorized_ref_digest
      && evidence.batchCommitInput.current_authority_digest === returned.run.current_authority_digest
      && runtime.canonicalSerialize(evidence.batchCommitInput.workspace_receipt) === runtime.canonicalSerialize(prepared.workspace.workspace_receipt);
    checks.no_external_launch = ORACLE_SURFACE_RECEIPTS.get(evidence.surfaceReceipt).counters_after.launch_calls
      - ORACLE_SURFACE_RECEIPTS.get(evidence.surfaceReceipt).counters_before.launch_calls === 0
      && ORACLE_SURFACE_RECEIPTS.get(evidence.surfaceReceipt).counters_after.mutation_dispatch_calls
        - ORACLE_SURFACE_RECEIPTS.get(evidence.surfaceReceipt).counters_before.mutation_dispatch_calls === 0;

    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'execution-loop-delegated-dispatch', run_id: returned.run.run_id, checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'execution-loop-delegated-dispatch',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function verifyOracleGitCommitWitness(caseValue, base, prepared, running, invocation, evidence = {}) {
  const checks = {};
  try {
    const paths = ['src/oracle.txt'];
    const expectedOperation = {
      type: 'git.commit',
      expected_head: prepared.live.sha,
      expected_tree: prepared.live.tree,
      authorized_paths: paths,
      authorized_paths_digest: runtime.digestValue(paths),
      expected_index_digest: '3'.repeat(64),
      intended_tree: 'd'.repeat(40),
      intended_change_digest: 'e'.repeat(64),
      commit_message: 'oracle bounded commit',
      commit_message_digest: runtime.digestValue('oracle bounded commit'),
      amend: false,
      allow_empty: false,
      author_mutation: false,
      committer_mutation: false,
      config_mutation: false,
      options: [],
    };
    const operationDigest = controlPlane.operationDigest(expectedOperation);
    const targetDigest = controlPlane.targetDigest(expectedOperation);
    const expectedAuthorityBindingDigest = runtime.digestValue({
      run_id: running.run_id,
      repository_id: running.repository_id,
      authorized_ref_digest: running.authorized_ref_digest,
      current_authority_digest: running.current_authority_digest,
      operation_digest: operationDigest,
      target_digest: targetDigest,
    });
    const consentStatusDigest = runtime.digestValue({
      state: 'enabled', status: 'healthy', registry_revision: null, snapshot_hash: null,
    });

    checks.execution_run_witness = await verifyOracleLoopRunWitness(caseValue, base.gate, running, {
      run: running,
      request: prepared.admitted.request,
      routePlan: prepared.admitted.route_plan,
      expectedRunId: prepared.workspace.run.run_id,
      expectedState: 'running',
      workspaceReceipt: prepared.workspace.workspace_receipt,
      admissionDelta: 0,
      beforeSnapshot: evidence.beforeSnapshot,
      afterSnapshot: evidence.afterSnapshot,
    });
    const expectedBrokerInput = {
      run_id: running.run_id,
      repository_id: running.repository_id,
      authorized_ref_digest: running.authorized_ref_digest,
      current_authority_digest: running.current_authority_digest,
      operation_type: 'git.commit',
      operation_digest: operationDigest,
      target_digest: targetDigest,
      scope_digest: runtime.digestValue({
        repository_id: running.repository_id,
        authorized_ref_digest: running.authorized_ref_digest,
      }),
      session_id: null,
      turn_id: null,
      call_id: null,
      operation: expectedOperation,
    };
    checks.authorization_request_exact = evidence.brokerCalls === 1
      && runtime.canonicalSerialize(evidence.brokerInput) === runtime.canonicalSerialize(expectedBrokerInput)
      && runtime.canonicalSerialize(evidence.brokerDecision) === runtime.canonicalSerialize({ decision: 'allow' });
    checks.stage_exact = evidence.stageCalls === 1
      && runtime.canonicalSerialize(evidence.stageInput) === runtime.canonicalSerialize({ paths });
    checks.commit_exact = evidence.commitCalls === 1
      && runtime.canonicalSerialize(evidence.commitInput) === runtime.canonicalSerialize({
        message: 'oracle bounded commit', amend: false, allow_empty: false, options: [], paths,
      })
      && evidence.commitResult
      && runtime.canonicalSerialize(evidence.commitResult) === runtime.canonicalSerialize({
        status: {
          repository_id: running.repository_id,
          head: 'f'.repeat(40),
          tree: 'd'.repeat(40),
          index_digest: '6'.repeat(64),
          staged_paths: [],
          worktree_paths: { staged_paths: [], unstaged_paths: [], untracked_paths: [] },
          change_digest: 'e'.repeat(64),
        },
        tree: 'd'.repeat(40),
        change_digest: 'e'.repeat(64),
      })
      && evidence.committed === true;
    const emptyPaths = { staged_paths: [], unstaged_paths: [], untracked_paths: [] };
    const expectedStatuses = [
      { repository_id: running.repository_id, head: prepared.live.sha, tree: prepared.live.tree, index_digest: '3'.repeat(64), staged_paths: [], worktree_paths: emptyPaths, change_digest: 'e'.repeat(64) },
      { repository_id: running.repository_id, head: prepared.live.sha, tree: prepared.live.tree, index_digest: '3'.repeat(64), staged_paths: paths, worktree_paths: { staged_paths: paths, unstaged_paths: [], untracked_paths: [] }, change_digest: 'e'.repeat(64) },
      { repository_id: running.repository_id, head: 'f'.repeat(40), tree: 'd'.repeat(40), index_digest: '6'.repeat(64), staged_paths: [], worktree_paths: emptyPaths, change_digest: 'e'.repeat(64) },
    ];
    checks.status_sequence_exact = evidence.statusCalls === 3
      && runtime.canonicalSerialize(evidence.statusSnapshots) === runtime.canonicalSerialize(expectedStatuses);
    checks.consent_exact = evidence.consentCalls === 1
      && runtime.canonicalSerialize(evidence.consentStatus) === runtime.canonicalSerialize({
        status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } },
      });
    const expectedResult = {
      status: 'committed',
      operation_digest: operationDigest,
      target_digest: targetDigest,
      authority_binding_digest: expectedAuthorityBindingDigest,
      consent_status_digest: consentStatusDigest,
      result_tree_digest: runtime.digestValue('d'.repeat(40)),
      result_change_digest: 'e'.repeat(64),
    };
    checks.result_exact = invocation.value
      && runtime.canonicalSerialize(Object.keys(invocation.value).sort()) === runtime.canonicalSerialize(Object.keys(expectedResult).sort())
      && runtime.canonicalSerialize(invocation.value) === runtime.canonicalSerialize(expectedResult);

    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'execution-loop-typed-git-commit', run_id: running.run_id, checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'execution-loop-typed-git-commit',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function verifyOracleTerminalCompletionWitness(
  caseValue, base, prepared, terminalRun, terminalPacket, persisted, substantiveResult,
  admission, admissionId, outcomeRef, gateBefore, gateAfter, outputBefore, outputAfter,
) {
  const checks = {};
  try {
    checks.execution_run_witness = await verifyOracleLoopRunWitness(caseValue, base.gate, terminalRun, {
      run: terminalRun,
      request: prepared.admitted.request,
      routePlan: prepared.admitted.route_plan,
      expectedRunId: prepared.workspace.run.run_id,
      expectedState: 'terminal-success',
      workspaceReceipt: prepared.workspace.workspace_receipt,
      admissionDelta: 0,
      beforeSnapshot: gateBefore,
      afterSnapshot: gateAfter,
    });

    const identities = runtime.authorityPacketIdentities(substantiveResult.packet);
    const { schema: _completionSchema, candidate: _completionCandidate, ...expectedPacketApplicability } = base.completionApplicability;
    const readback = substantiveResult.store.readAuthorityPacket(identities.packet_id, substantiveResult.packet.bindings);
    checks.output_packet_exact = persisted.packet_id === identities.packet_id
      && persisted.packet_digest === identities.packet_digest
      && persisted.content_digest === identities.content_digest
      && persisted.binding_digest === identities.binding_digest
      && outcomeRef === identities.packet_digest
      && runtime.canonicalSerialize(readback) === identities.canonical_packet_bytes
      && runtime.canonicalSerialize(substantiveResult.packet.bindings.applicability)
        === runtime.canonicalSerialize(expectedPacketApplicability)
      && substantiveResult.packet.bindings.producer.run === terminalRun.run_id
      && substantiveResult.packet.bindings.producer.lock === base.gate.consumer_intent.consumer.lock
      && substantiveResult.packet.bindings.producer.stage === 'G3'
      && substantiveResult.packet.bindings.producer.role === 'G3';

    checks.terminal_packet_exact = executionLoop.validateTerminalPacket(terminalPacket)
      && terminalPacket.run_id === terminalRun.run_id
      && terminalPacket.outcome === 'success'
      && terminalPacket.reason_code === 'COMMITTED'
      && terminalPacket.evidence_digest === outcomeRef
      && terminalPacket.publication_state === 'verified'
      && terminalPacket.workspace_disposition === 'cleaned'
      && terminalRun.terminal_packet_digest === runtime.digestValue(terminalPacket)
      && terminalRun.publication_state === terminalPacket.publication_state
      && terminalRun.workspace_disposition === terminalPacket.workspace_disposition;

    const durableOptions = {
      state_root: base.stateRoot,
      repository_id: terminalRun.repository_id,
      authorized_ref_digest: terminalRun.authorized_ref_digest,
      run_id: terminalRun.run_id,
    };
    checks.durable_completion_exact = runtime.canonicalSerialize(executionLoop.readDurableRun(durableOptions))
        === runtime.canonicalSerialize(terminalRun)
      && runtime.canonicalSerialize(executionLoop.readDurableWorkspaceReceipt(durableOptions))
        === runtime.canonicalSerialize(prepared.workspace.workspace_receipt)
      && runtime.canonicalSerialize(executionLoop.readDurableTerminalPacket(durableOptions))
        === runtime.canonicalSerialize(terminalPacket);

    const verification = await invokeOracleSurface(
      caseValue, 'authorityPacketStore', base.gate.store, 'verifySemanticCompletion',
      [admission, substantiveResult.store, outcomeRef], { setup: true },
    );
    if (verification.error) throw verification.error;
    markOracleReceiptAsSetup(verification.receipt);
    checks.completion_receipt_fresh_readback = verification.value.verified === true
      && verification.value.outcome_ref === identities.packet_digest
      && verification.value.packet_id === identities.packet_id;

    const db = new DatabaseSync(substantiveResult.store.databasePath, { readOnly: true });
    let eventRows;
    try {
      eventRows = db.prepare('SELECT * FROM authority_packet_events WHERE packet_id = ? ORDER BY sequence').all(identities.packet_id);
    } finally { db.close(); }
    const expectedPayload = {
      admission_id: admissionId,
      consumer: {
        run: terminalRun.run_id,
        lock: base.gate.consumer_intent.consumer.lock,
        stage: base.gate.consumer_intent.consumer.stage,
        role: base.gate.consumer_intent.consumer.role,
        scope_digest: base.gate.consumer_intent.consumer.scope_digest,
      },
      outcome_ref: identities.packet_digest,
    };
    const event = eventRows.length === 1 ? JSON.parse(eventRows[0].canonical_json) : null;
    checks.completion_event_exact = eventRows.length === 1
      && eventRows[0].sequence === 1
      && eventRows[0].event_type === 'CONSUMER_COMPLETED'
      && event && event.schema === runtime.AUTHORITY_PACKET_EVENT_SCHEMA_ID
      && event.packet_id === identities.packet_id
      && event.sequence === 1 && event.prior_event_id === null
      && event.event_type === 'CONSUMER_COMPLETED'
      && runtime.canonicalSerialize(event.payload) === runtime.canonicalSerialize(expectedPayload)
      && eventRows[0].event_id === runtime.digestValue(event)
      && receiptTableDelta(outputBefore, outputAfter, 'authority_packet_events') === 1;

    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'execution-loop-terminal-completion', run_id: terminalRun.run_id, checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'execution-loop-terminal-completion',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function verifyOracleLeaseReleaseWitness(caseValue, base, prepared, terminalRun, terminalPacket, lease, releaseOptions, invocation, evidence = {}) {
  const checks = {};
  try {
    checks.execution_run_witness = await verifyOracleLoopRunWitness(caseValue, base.gate, terminalRun, {
      run: terminalRun,
      request: prepared.admitted.request,
      routePlan: prepared.admitted.route_plan,
      expectedRunId: prepared.workspace.run.run_id,
      expectedState: 'terminal-success',
      workspaceReceipt: prepared.workspace.workspace_receipt,
      admissionDelta: 0,
      beforeSnapshot: evidence.beforeSnapshot,
      afterSnapshot: evidence.afterSnapshot,
    });
    const durableOptions = {
      state_root: base.stateRoot,
      repository_id: terminalRun.repository_id,
      authorized_ref_digest: terminalRun.authorized_ref_digest,
      run_id: terminalRun.run_id,
    };
    checks.durable_terminal_exact = runtime.canonicalSerialize(executionLoop.readDurableRun(durableOptions))
        === runtime.canonicalSerialize(terminalRun)
      && runtime.canonicalSerialize(executionLoop.readDurableWorkspaceReceipt(durableOptions))
        === runtime.canonicalSerialize(prepared.workspace.workspace_receipt)
      && runtime.canonicalSerialize(executionLoop.readDurableTerminalPacket(durableOptions))
        === runtime.canonicalSerialize(terminalPacket)
      && executionLoop.validateTerminalPacket(terminalPacket)
      && terminalRun.terminal_packet_digest === runtime.digestValue(terminalPacket)
      && terminalPacket.workspace_disposition === 'cleaned'
      && terminalPacket.publication_state === 'verified';
    checks.release_binding_exact = runtime.canonicalSerialize(releaseOptions) === runtime.canonicalSerialize({
      state_root: base.stateRoot,
      repository_id: terminalRun.repository_id,
      authorized_ref_digest: terminalRun.authorized_ref_digest,
      run_id: terminalRun.run_id,
      lease_id: lease.lease_id,
      terminal_state: terminalRun.execution_state,
      workspace_disposition: terminalRun.workspace_disposition,
      publication_state: terminalRun.publication_state,
      run: terminalRun,
    })
      && lease.kind === 'mutation-lease'
      && lease.repository_id === terminalRun.repository_id
      && lease.authorized_ref_digest === terminalRun.authorized_ref_digest
      && lease.run_id === terminalRun.run_id
      && typeof evidence.leaseBefore === 'object'
      && runtime.canonicalSerialize(evidence.leaseBefore) === runtime.canonicalSerialize(lease);
    checks.release_result_exact = invocation.value
      && runtime.canonicalSerialize(invocation.value) === runtime.canonicalSerialize({ released: true });
    let afterReleaseCode = null;
    try {
      executionLoop.verifyOwnedMutationLease({ ...releaseOptions, mutation_lease: lease });
    } catch (error) {
      afterReleaseCode = error && error.code || null;
    }
    checks.lease_removed = afterReleaseCode === 'LEASE_REQUIRED';
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'execution-loop-mutation-lease-release', run_id: terminalRun.run_id, checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'execution-loop-mutation-lease-release',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function verifyOracleTerminalTransitionWitness(caseValue, base, prepared, inputRun, terminalPacket, invocation, beforeSnapshot, afterSnapshot, inputBytes) {
  const checks = {};
  try {
    const terminalRun = invocation.value;
    checks.execution_run_witness = await verifyOracleLoopRunWitness(caseValue, base.gate, terminalRun, {
      run: terminalRun,
      request: prepared.admitted.request,
      routePlan: prepared.admitted.route_plan,
      expectedRunId: prepared.workspace.run.run_id,
      expectedState: 'terminal-success',
      workspaceReceipt: prepared.workspace.workspace_receipt,
      admissionDelta: 0,
      beforeSnapshot,
      afterSnapshot,
    });
    const expectedRun = {
      ...inputRun,
      execution_state: 'terminal-success',
      updated_at: terminalRun.updated_at,
      terminal_packet_digest: runtime.digestValue(terminalPacket),
      publication_state: terminalPacket.publication_state,
      workspace_disposition: terminalPacket.workspace_disposition,
    };
    checks.transition_result_exact = executionLoop.validateTerminalPacket(terminalPacket)
      && terminalPacket.run_id === inputRun.run_id
      && terminalPacket.outcome === 'success'
      && terminalRun.execution_state === 'terminal-success'
      && terminalRun.terminal_packet_digest === runtime.digestValue(terminalPacket)
      && terminalRun.publication_state === 'verified'
      && terminalRun.workspace_disposition === 'cleaned'
      && runtime.canonicalSerialize(terminalRun) === runtime.canonicalSerialize(expectedRun)
      && runtime.canonicalSerialize(inputRun) === inputBytes;
    checks.receipt_store_unchanged = runtime.canonicalSerialize(beforeSnapshot) === runtime.canonicalSerialize(afterSnapshot);
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'execution-loop-terminal-transition', run_id: terminalRun.run_id, checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'execution-loop-terminal-transition',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function oracleExpandedLoopPositive(caseValue) {
  const surface = caseValue.surface;
  if (surface === 'loop.admitRun') {
    const base = oracleLoopCommon(caseValue);
    const before = receiptEffectSnapshot(base.gate.store);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'admitRun', [base.common]);
    if (invocation.error) throw invocation.error;
    const after = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.loop_admission_witness = await verifyOracleLoopRunWitness(
      caseValue, base.gate, invocation.value, {
        run: invocation.value.run,
        request: invocation.value.request,
        routePlan: invocation.value.route_plan,
        expectedRunId: base.common.run_id,
        expectedState: 'admitted',
        wrapperStatus: 'admitted',
        admissionDelta: 1,
        beforeSnapshot: before,
        afterSnapshot: after,
      }
    );
    return invocation.value;
  }
  if (surface === 'loop.transitionRun.admitted') {
    const base = oracleLoopCommon(caseValue);
    const route = executionLoop.admitRoute(base.common);
    const planned = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: base.common.run_id });
    const before = receiptEffectSnapshot(base.gate.store);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [planned, 'admitted', { semantic_gate: base.gate }]);
    if (invocation.error) throw invocation.error;
    const after = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.transition_witness = await verifyOracleLoopRunWitness(
      caseValue, base.gate, invocation.value, {
        run: invocation.value,
        request: route.request,
        routePlan: route.route_plan,
        expectedRunId: base.common.run_id,
        expectedState: 'admitted',
        admissionDelta: 1,
        beforeSnapshot: before,
        afterSnapshot: after,
      }
    );
    return invocation.value;
  }
  if (surface === 'loop.transitionRun.running') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const before = receiptEffectSnapshot(base.gate.store);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [prepared.workspace.run, 'running', { state_root: base.stateRoot, semantic_gate: base.gate }]);
    if (invocation.error) throw invocation.error;
    const after = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.transition_witness = await verifyOracleLoopRunWitness(
      caseValue, base.gate, invocation.value, {
        run: invocation.value,
        request: prepared.admitted.request,
        routePlan: prepared.admitted.route_plan,
        expectedRunId: prepared.workspace.run.run_id,
        expectedState: 'running',
        workspaceReceipt: prepared.workspace.workspace_receipt,
        admissionDelta: 0,
        beforeSnapshot: before,
        afterSnapshot: after,
      }
    );
    return invocation.value;
  }
  if (surface === 'loop.prepareRetry') {
    const base = oracleLoopCommon(caseValue);
    const route = executionLoop.admitRoute(base.common);
    const previous = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: 'oracle-previous' });
    const sha = '1'.repeat(40); const tree = '2'.repeat(40);
    const retryOptions = {
      ...base.common, previous_run: previous, run_id: 'oracle-retry', current_authority_digest: 'e'.repeat(64),
      expected_live: { ref: 'refs/heads/main', sha, tree },
      liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha, tree }) },
      workspaceAdapter: { prepare: () => ({ workspace_id: 'oracle-retry-workspace', workspace_handle: 'oracle-retry-handle', commit_sha: sha, tree_sha: tree }), verifySnapshot: () => true },
    };
    const retryRoute = executionLoop.admitRoute(retryOptions);
    const before = receiptEffectSnapshot(base.gate.store);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'prepareRetry', [retryOptions]);
    if (invocation.error) throw invocation.error;
    const after = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.retry_witness = await verifyOracleLoopRunWitness(
      caseValue, base.gate, invocation.value, {
        run: invocation.value.run,
        request: retryRoute.request,
        routePlan: invocation.value.route_plan,
        expectedRunId: 'oracle-retry',
        expectedState: 'workspace-ready',
        wrapperStatus: 'ready',
        workspaceReceipt: invocation.value.workspace_receipt,
        admissionDelta: 1,
        beforeSnapshot: before,
        afterSnapshot: after,
      }
    );
    return invocation.value;
  }
  if (surface === 'loop.startDelegatedRun' || surface === 'loop.atomicBatchCommit') {
    const base = oracleLoopCommon(caseValue, true);
    const prepared = await oracleLoopWorkspace(base);
    const expected = prepared.admitted.route_plan.lanes.map((lane) => lane.lane_id);
    const reservationLaneIds = [];
    let commitCalls = 0;
    let batchCommitInput = null;
    let batchCommitResult = null;
    const optionsValue = {
      ...base.common,
      run_id: prepared.workspace.run.run_id,
      repository_id: prepared.workspace.run.repository_id,
      authorized_ref_digest: prepared.workspace.run.authorized_ref_digest,
      current_authority_digest: prepared.workspace.run.current_authority_digest,
      route_plan: prepared.admitted.route_plan,
      run: prepared.workspace.run,
      workspace_receipt: prepared.workspace.workspace_receipt,
      liveRefProvider: { read: () => prepared.live },
      semantic_gate: base.gate,
      prepareLaunch: (lane) => {
        reservationLaneIds.push(lane.lane_id);
        return { lane_id: lane.lane_id, reservation_handle: `reservation-${lane.lane_id}`, inert: true };
      },
      commitLaunchBatch: (input) => {
        commitCalls += 1;
        activeOracleHarness.counters.atomic_batch_commit_calls += 1;
        batchCommitInput = input;
        batchCommitResult = { atomic: true, committed: true, started_lane_ids: input.route_plan.lanes.map((lane) => lane.lane_id) };
        return batchCommitResult;
      },
    };
    const beforeSnapshot = receiptEffectSnapshot(base.gate.store);
    const result = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'startDelegatedRun', [optionsValue]);
    if (result.error) throw result.error;
    const afterSnapshot = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(result.receipt);
    bound.effect_delta.delegated_run_witness = await verifyOracleDelegatedRunWitness(
      caseValue, base, prepared, result.value, {
        reservationLaneIds,
        commitCalls,
        batchCommitInput,
        batchCommitResult,
        beforeSnapshot,
        afterSnapshot,
        surfaceReceipt: result.receipt,
      }
    );
    return result.value;
  }
  if (surface === 'loop.executeTypedGitCommit' || surface === 'loop.commitExact') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const lease = executionLoop.acquireMutationLease({ state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id });
    let staged = [];
    let committed = false;
    let statusCalls = 0;
    let stageCalls = 0;
    let commitCalls = 0;
    let brokerCalls = 0;
    let consentCalls = 0;
    let stageInput = null;
    let commitInput = null;
    let commitResult = null;
    let brokerInput = null;
    let brokerDecision = null;
    const consentStatus = { status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } };
    const statusSnapshots = [];
    const authorizedPaths = ['src/oracle.txt'];
    const gitStatus = () => {
      statusCalls += 1;
      const snapshot = {
        repository_id: running.repository_id,
        head: committed ? 'f'.repeat(40) : prepared.live.sha,
        tree: committed ? 'd'.repeat(40) : prepared.live.tree,
        index_digest: committed ? '6'.repeat(64) : '3'.repeat(64),
        staged_paths: [...staged],
        worktree_paths: { staged_paths: [...staged], unstaged_paths: [], untracked_paths: [] },
        change_digest: 'e'.repeat(64),
      };
      statusSnapshots.push(structuredClone(snapshot));
      return snapshot;
    };
    const git = {
      status: gitStatus,
      stageExact: (input) => {
        stageCalls += 1;
        activeOracleHarness.counters.stage_calls += 1;
        stageInput = structuredClone(input);
        staged = [...authorizedPaths];
        return gitStatus();
      },
      commit: (input) => {
        commitCalls += 1;
        activeOracleHarness.counters.commit_calls += 1;
        commitInput = structuredClone(input);
        committed = true; staged = [];
        commitResult = { status: gitStatus(), tree: 'd'.repeat(40), change_digest: 'e'.repeat(64) };
        return commitResult;
      },
    };
    const optionsValue = {
      ...base.common,
      run_id: running.run_id,
      repository_id: running.repository_id,
      authorized_ref_digest: running.authorized_ref_digest,
      current_authority_digest: running.current_authority_digest,
      run: running,
      semantic_gate: base.gate,
      route_plan: prepared.admitted.route_plan,
      workspace_receipt: prepared.workspace.workspace_receipt,
      liveRefProvider: { read: () => prepared.live },
      state_root: base.stateRoot,
      mutation_lease: lease,
      authorized_paths: authorizedPaths,
      expected_head: prepared.live.sha,
      expected_tree: prepared.live.tree,
      expected_index_digest: '3'.repeat(64),
      commit_message: 'oracle bounded commit',
      intended_tree: 'd'.repeat(40),
      intended_change_digest: 'e'.repeat(64),
      git,
      broker: { authorize: (input) => {
        brokerCalls += 1;
        brokerInput = structuredClone(input);
        brokerDecision = { decision: 'allow' };
        return brokerDecision;
      } },
      consentProvider: () => {
        consentCalls += 1;
        return consentStatus;
      },
    };
    const beforeSnapshot = receiptEffectSnapshot(base.gate.store);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, surface.slice('loop.'.length), [optionsValue]);
    if (invocation.error) throw invocation.error;
    const afterSnapshot = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.git_commit_witness = await verifyOracleGitCommitWitness(
      caseValue, base, prepared, running, invocation, {
        beforeSnapshot, afterSnapshot,
        stageCalls, stageInput, commitCalls, commitInput, commitResult, committed,
        statusCalls, statusSnapshots,
        brokerCalls, brokerInput, brokerDecision,
        consentCalls, consentStatus,
      }
    );
    return invocation.value;
  }
  if (surface === 'loop.completeRun' || surface === 'loop.governedCompletion') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const completionBindings = structuredClone(base.gate.packetValue.bindings);
    completionBindings.producer = {
      run: validating.run_id,
      lock: base.gate.consumer_intent.consumer.lock,
      stage: 'G3',
      role: 'G3',
    };
    const { schema: _completionSchema, candidate: _completionCandidate, ...packetApplicability } = base.completionApplicability;
    completionBindings.applicability = structuredClone(packetApplicability);
    completionBindings.candidate = base.completionApplicability.candidate;
    const substantivePacket = packet({ bindings: completionBindings });
    const substantiveStore = runtime.initialiseAuthorityPacketStore(
      options(oracleStateRoot(`oracle-loop-completion-output-${oracleSafeSeed(caseValue.id)}-`)),
      readers(substantivePacket),
    );
    const substantiveProducerAdmission = producerAdmission(substantivePacket);
    const substantivePersisted = substantiveStore.persistAuthorityPacket(substantivePacket, substantiveProducerAdmission);
    trackOracleAuthorityStore(substantiveStore);
    const substantiveResult = {
      store: substantiveStore,
      packet: substantivePacket,
      producer_admission: substantiveProducerAdmission,
    };
    const outcomeRef = runtime.authorityPacketIdentities(substantivePacket).packet_digest;
    const terminalPacket = executionLoop.createTerminalPacket({
      run_id: validating.run_id,
      outcome: 'success',
      reason_code: 'COMMITTED',
      evidence_digest: outcomeRef,
      publication_state: 'verified',
      workspace_disposition: 'cleaned',
    });
    const admissionDb = new DatabaseSync(base.gate.store.databasePath, { readOnly: true });
    let matchingAdmission;
    try {
      matchingAdmission = admissionDb.prepare('SELECT * FROM semantic_gate_admissions ORDER BY admission_id').all()
        .map((row) => ({ row, record: JSON.parse(row.canonical_json) }))
        .filter(({ record }) => record.execution_binding
          && record.execution_binding.loop_run_id === validating.run_id);
    } finally { admissionDb.close(); }
    if (matchingAdmission.length !== 1) throw new Error('ORACLE_COMPLETION_SETUP_ADMISSION_NOT_UNIQUE');
    const admissionInvocation = await invokeOracleSurface(
      caseValue, 'authorityPacketStore', base.gate.store, 'recoverSemanticGateAdmission',
      [{ consumer_key: matchingAdmission[0].record.consumer_key }, base.gate.trusted_readers], { setup: true },
    );
    if (admissionInvocation.error) throw admissionInvocation.error;
    markOracleReceiptAsSetup(admissionInvocation.receipt);
    if (admissionInvocation.value.recovered !== true
      || admissionInvocation.value.admission_id !== matchingAdmission[0].row.admission_id
      || !admissionInvocation.value.admission) {
      throw new Error('ORACLE_COMPLETION_SETUP_ADMISSION_RECOVERY_MISMATCH');
    }
    resetOracleEffectBaseline();
    const gateBefore = receiptEffectSnapshot(base.gate.store);
    const outputBefore = receiptEffectSnapshot(substantiveStore);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'completeRun', [{
      state_root: base.stateRoot,
      run: validating,
      terminal_packet: terminalPacket,
      semantic_gate: base.gate,
      substantive_result: substantiveResult,
    }]);
    if (invocation.error) throw invocation.error;
    const gateAfter = receiptEffectSnapshot(base.gate.store);
    const outputAfter = receiptEffectSnapshot(substantiveStore);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.terminal_completion_witness = await verifyOracleTerminalCompletionWitness(
      caseValue, base, prepared, invocation.value, terminalPacket, substantivePersisted,
      substantiveResult, admissionInvocation.value.admission, admissionInvocation.value.admission_id, outcomeRef,
      gateBefore, gateAfter, outputBefore, outputAfter,
    );
    return invocation.value;
  }
  if (surface === 'loop.transitionRun.terminal') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const terminalPacket = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    resetOracleEffectBaseline();
    const beforeSnapshot = receiptEffectSnapshot(base.gate.store);
    const inputBytes = runtime.canonicalSerialize(validating);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [validating, 'terminal-success', { terminal_packet: terminalPacket }]);
    if (invocation.error) throw invocation.error;
    const afterSnapshot = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.terminal_transition_witness = await verifyOracleTerminalTransitionWitness(
      caseValue, base, prepared, validating, terminalPacket, invocation, beforeSnapshot, afterSnapshot, inputBytes,
    );
    return invocation.value;
  }
  if (surface === 'loop.releaseMutationLease') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const lease = executionLoop.acquireMutationLease({ state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const terminalPacket = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    const terminal = executionLoop.completeRun({ state_root: base.stateRoot, run: validating, terminal_packet: terminalPacket });
    const releaseOptions = {
      state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest,
      run_id: running.run_id, lease_id: lease.lease_id, terminal_state: terminal.execution_state,
      workspace_disposition: terminal.workspace_disposition, publication_state: terminal.publication_state, run: terminal,
    };
    const leaseBefore = executionLoop.verifyOwnedMutationLease({ ...releaseOptions, mutation_lease: lease });
    const beforeSnapshot = receiptEffectSnapshot(base.gate.store);
    const invocation = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'releaseMutationLease', [releaseOptions]);
    if (invocation.error) throw invocation.error;
    const afterSnapshot = receiptEffectSnapshot(base.gate.store);
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.lease_release_witness = await verifyOracleLeaseReleaseWitness(
      caseValue, base, prepared, terminal, terminalPacket, lease, releaseOptions, invocation,
      { leaseBefore, beforeSnapshot, afterSnapshot },
    );
    return invocation.value;
  }
  throw new Error(`Unknown Loop production surface ${surface}`);
}

function oracleAssuranceInputs(candidate = { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40), current: true }) {
  const assuranceInput = {
    contract_version: assuranceRuntime.CONTRACT_VERSION,
    candidate,
    pr: { number: 353, head: candidate.head, tree: candidate.tree, base: candidate.base, base_ref: 'main', open: true, server_authoritative: true, verifiable: true },
    lock: { id: assuranceRuntime.DESIGN_LOCK_ID, current: true, server_authoritative: true, verifiable: true },
    scope: { digest: 'd'.repeat(64), current: true, authorised: true, server_authoritative: true, verifiable: true },
    g4: { status: 'PASS', provider: 'OpenAI', model_class: 'GPT-5.6 Sol High', reasoning: 'high', mode: 'standard', fresh: true, isolated: true, read_only: true, complete_candidate: true, candidate_head: candidate.head, candidate_tree: candidate.tree, candidate_base: candidate.base, lock_id: assuranceRuntime.DESIGN_LOCK_ID, scope_digest: 'd'.repeat(64), root_only: true, mutation_authority: false, ready_authority: false, merge_authority: false, cleanup_authority: false, finality_authority: false, current: true, complete: true, server_authoritative: true, verifiable: true },
    review: { current: true, complete: true, server_authoritative: true, verifiable: true, inventory_digest: 'e'.repeat(64), findings: [] },
    required_checks: { current: true, complete: true, server_authoritative: true, verifiable: true, inventory_digest: 'f'.repeat(64), items: [{ id: 'required-ci', required: true, status: 'success', server_authoritative: true, verifiable: true }] },
  };
  return { candidate, assuranceInput };
}

function oracleAssuranceActionInputs(candidate, assuranceInput, receiptContext) {
  return {
    'assurance.admitG4': [assuranceInput, receiptContext],
    'assurance.evaluateAssurance': [assuranceInput, receiptContext],
    'assurance.evaluateG4A': [{ ordinary_complete: true, exact_head_g4_passed: true, required_evidence_current: true, question: 'bounded', purpose: 'routing', deterministic_evidence_settles: false, web_recorded_question: true, settled: true, candidate, scope_digest: assuranceInput.scope.digest }, receiptContext],
    'assurance.evaluateNoByteReviewDisposition': [{ unchanged: { head: true, tree: true, base: true, lock: true, scope: true }, disposition: 'non-material', no_current_violation: true, no_candidate_change: true, complete_inventory: true, all_other_evidence_current: true, candidate, scope_digest: assuranceInput.scope.digest }, receiptContext],
    'assurance.evaluateInvalidation': [{ event: 'SUCCESSOR_CANDIDATE_HEAD' }, receiptContext],
    'assurance.evaluateFinality': [{ accepted_candidate: { pr_number: 353, head: candidate.head, tree: candidate.tree, base: candidate.base }, web_acceptance: { status: 'accepted', current_required_evidence: true, current_review_inventory: true, current_required_checks: true, server_authoritative: true, verifiable: true }, ready: { set: true, after_web_acceptance: true, final_merge_state_transition: true, same_candidate: true, fresh_readback: true, review_triggered: false }, merge: { intended_pr_number: 353, observed_pr_number: 353, result: 'merged', merge_result_sha: 'd'.repeat(40), mode: 'squash', expected_head: candidate.head, observed_head: candidate.head, expected_base: candidate.base, observed_base: candidate.base, bound_to_pr: true, server_authoritative: true, verifiable: true }, canonical: { bound_to_intended_merge: true, main_head: 'd'.repeat(40), tree: candidate.tree, expected_tree: candidate.tree, sole_parent: candidate.base, expected_parent: candidate.base, signature: { verified: true, reason: 'valid' }, pr_merged: true, pr_closed: true, branch_cleanup_observed: true, cleanup_after_verified_merge: true, server_authoritative: true, verifiable: true } }, receiptContext],
  };
}

function verifyAssuranceEvaluationWitness(method, value) {
  const expected = {
    evaluateAssurance: {
      verdict: 'PASS', code: 'PASS_AND_STOP', g4_status: 'PASS', stop: true,
      finality_blocked: false, material_blocker: false, non_blocking_findings: 0,
      next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
    },
    evaluateFinality: {
      code: 'FINALITY_VERIFIED', verdict: 'VERIFIED', finality_blocked: false,
      g4_rerun: false, branch_cleanup_verified: true,
    },
    evaluateG4A: {
      ok: true, code: 'G4A_ELIGIBLE', allowed: true, model_class: assuranceRuntime.G4A_MODEL,
      fresh: true, isolated: true, read_only: true, helpers: false,
      mutation_authority: false, finality_authority: false,
      question: 'bounded', next_action: 'RUN_G4A',
    },
    evaluateInvalidation: {
      code: 'G4_INVALIDATED_CANDIDATE_MOVEMENT', g4_invalidated: true,
      successor_invalidates_prior_g4: true, fresh_admission_required: true,
      fresh_complete_candidate_g4_required: true, fresh_g4_required: true,
    },
    evaluateNoByteReviewDisposition: {
      eligible: true, code: 'NO_BYTE_REVIEW_DISPOSITION_ACCEPTED',
      g4_invalidated: false, fresh_g4_required: false, finality_blocked: false,
    },
  }[method];
  if (!expected || !value) return false;
  try { return runtime.canonicalSerialize(value) === runtime.canonicalSerialize(expected); }
  catch (_) { return false; }
}

async function verifyOracleAssuranceAdmissionWitness(caseValue, receipt, assuranceInput, returned) {
  const checks = {};
  try {
    const expected = {
      operation: 'G4',
      candidate: {
        head: assuranceInput.candidate.head,
        tree: assuranceInput.candidate.tree,
        base: assuranceInput.candidate.base,
      },
      scope_digest: assuranceInput.scope.digest,
    };
    const proof = receipt.store.revalidateSemanticGate(receipt.admission, expected);
    checks.dependency_proof = assuranceRuntime.validateReceiptDependencyProof(proof, expected).length === 0
      && proof.dependency_state === 'PREDECESSORS_VERIFIED'
      && proof.predecessors.length === 1;
    if (!checks.dependency_proof) throw new Error('ASSURANCE_DEPENDENCY_PROOF_INVALID');

    const predecessor = proof.predecessors[0];
    const packet = receipt.store.readAuthorityPacket(predecessor.packet_id, receipt.packetValue.bindings);
    const identities = runtime.authorityPacketIdentities(packet);
    checks.packet_matches_predecessor = identities.packet_id === predecessor.packet_id
      && identities.packet_digest === predecessor.packet_digest
      && identities.content_digest === predecessor.content_digest
      && identities.binding_digest === predecessor.binding_digest
      && packet.bindings.candidate.head_sha === expected.candidate.head
      && packet.bindings.candidate.tree_sha === expected.candidate.tree
      && packet.bindings.candidate.base_sha === expected.candidate.base;
    if (!checks.packet_matches_predecessor) throw new Error('ASSURANCE_PREDECESSOR_PACKET_MISMATCH');

    const reopened = await invokeOracleSurface(caseValue, 'authorityPacketStore', receipt.store,
      'verifyAuthorityPacketFresh', [predecessor.packet_id, packet.bindings], { setup: true });
    const reopenedBound = ORACLE_SURFACE_RECEIPTS.get(reopened.receipt);
    checks.fresh_process_readback = !reopened.error && reopenedBound.actual.outcome === 'ACCEPT'
      && reopenedBound.effect_delta.byte_equal_readback === true
      && runtime.canonicalSerialize(reopened.value.packet) === identities.canonical_packet_bytes
      && reopened.value.envelope.packet_id === predecessor.packet_id
      && reopened.value.envelope.packet_digest === predecessor.packet_digest
      && reopened.value.envelope.content_digest === predecessor.content_digest
      && reopened.value.envelope.binding_digest === predecessor.binding_digest
      && reopened.value.envelope.store_identity_digest === predecessor.store_identity_digest
      && /^[a-f0-9]{64}$/.test(reopened.value.envelope.challenge);

    const expectedResult = {
      ok: true,
      code: 'G4_ADMISSION_ACCEPTED',
      admitted: true,
      contract_version: assuranceRuntime.CONTRACT_VERSION,
      authority: assuranceRuntime.G4_AUTHORITY,
      model_class: assuranceRuntime.G4_MODEL,
      fresh: true,
      isolated: true,
      read_only: true,
      complete_candidate: true,
      mutation_authority: false,
      finality_authority: false,
    };
    checks.exact_admission_result = runtime.canonicalSerialize(returned) === runtime.canonicalSerialize(expectedResult);
    const passed = Object.values(checks).every(Boolean);
    recordOracleHarnessReadback({ kind: 'assurance-g4-admission', checks, passed });
    return passed;
  } catch (error) {
    recordOracleHarnessReadback({
      kind: 'assurance-g4-admission',
      error_code: error && error.code || error && error.name || 'ERROR',
      error_message: error && error.message || 'ERROR',
      checks,
      passed: false,
    });
    return false;
  }
}

async function oracleExpandedAssurancePositive(caseValue) {
  const receipt = oracleAssuranceReceipt();
  const receiptContext = assuranceRuntime.bindReceiptAdmission(receipt.store, receipt.admission);
  const { candidate, assuranceInput } = oracleAssuranceInputs();
  const simple = oracleAssuranceActionInputs(candidate, assuranceInput, receiptContext);
  const method = caseValue.surface.slice('assurance.'.length);
  const invocation = await invokeOracleSurface(caseValue, 'assurance', assuranceRuntime, method, simple[caseValue.surface]);
  if (invocation.error) throw invocation.error;
  if (method === 'admitG4') {
    const bound = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt);
    bound.effect_delta.assurance_admission_witness = await verifyOracleAssuranceAdmissionWitness(
      caseValue, receipt, assuranceInput, invocation.value
    );
  }
  return invocation.value;
}

async function oracleExpandedPositive(caseValue, context) {
  if (caseValue.surface.startsWith('receipt.')) return oracleExpandedReceiptPositive(caseValue);
  if (caseValue.surface.startsWith('loop.')) return oracleExpandedLoopPositive(caseValue);
  if (caseValue.surface.startsWith('assurance.')) return oracleExpandedAssurancePositive(caseValue);
  throw new Error(`Unknown expanded production surface ${caseValue.surface}`);
}

function oracleInvalidSemanticGate(gate) {
  return {
    store: { admitSemanticGate: () => ({ admission: {} }) },
    admission: {},
    consumer_intent: gate.consumer_intent,
    trusted_readers: gate.trusted_readers,
    consumer_identity: { consumer_key: '0'.repeat(64) },
  };
}

async function oracleExpandedReceiptNegative(caseValue) {
  const target = oracleReceiptExecution(caseValue);
  const surface = caseValue.surface;
  const variant = caseValue.input.variant;
  const fakeGate = { store: {}, admission: {} };
  if (surface === 'receipt.startRun') {
    const input = { ...target.allocation };
    if (variant === 'missing-handle') delete input.semantic_gate;
    else input.semantic_gate = fakeGate;
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'startRun', [input, target.startReaders]);
  }
  if (surface === 'receipt.allocateRun->startAllocatedRun') {
    let allocationInput = { ...target.allocation };
    if (variant !== 'missing-handle') allocationInput.semantic_gate = fakeGate;
    let allocated = caseValue.requirement_id === 'X09'
      ? await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [allocationInput], { setup: true })
      : await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [allocationInput]);
    if (caseValue.requirement_id === 'X09' && !allocated.error) {
      ORACLE_SURFACE_RECEIPTS.get(allocated.receipt).setup = false;
    }
    if (allocated.error) {
      allocationInput = { ...target.allocation };
      delete allocationInput.semantic_gate;
      allocated = await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [allocationInput]);
    }
    if (allocated.error) return allocated;
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'startAllocatedRun', [allocated.value, target.startReaders]);
  }
  if (surface === 'receipt.appendReceipt') {
    target.setDeclaredDependencies(true);
    const allocationInput = { ...target.allocation };
    delete allocationInput.semantic_gate;
    const session = await target.store.allocateRun(allocationInput);
    try { await target.store.startAllocatedRun(session, target.startReaders); } catch (_) { /* Keep the real unstarted allocation for the named append boundary. */ }
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'appendReceipt', [session, {
      receipt_type: 'TRANSITION_PREVIEW', candidate: null, payload: { classification: 'ORACLE' }, created_at: new Date().toISOString(),
    }]);
  }
  if (surface === 'receipt.admitMutationOperation') {
    target.setDeclaredDependencies(false);
    const allocationInput = { ...target.allocation };
    delete allocationInput.semantic_gate;
    const started = await target.store.startRun(allocationInput, target.startReaders);
    target.setDeclaredDependencies(true);
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'admitMutationOperation', [started, target.descriptor, target.mutationReaders]);
  }
  if (surface === 'receipt.authorizeMutationDispatch') {
    target.setDeclaredDependencies(false);
    const allocationInput = { ...target.allocation };
    delete allocationInput.semantic_gate;
    const started = await target.store.startRun(allocationInput, target.startReaders);
    const admission = await target.store.admitMutationOperation(started, target.descriptor, target.mutationReaders);
    target.setDeclaredDependencies(true);
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'authorizeMutationDispatch', [started, admission]);
  }
  throw new Error(`Unknown receipt rejection surface ${surface}`);
}

async function oracleExpandedLoopNegative(caseValue) {
  const surface = caseValue.surface;
  const variant = caseValue.input.variant;
  const delegated = surface === 'loop.startDelegatedRun' || surface === 'loop.atomicBatchCommit';
  const base = oracleLoopCommon(caseValue, delegated, true);
  const invokeNegativeSurface = (...args) => {
    resetOracleEffectBaseline();
    return invokeOracleSurface(...args);
  };
  const fakeGate = oracleInvalidSemanticGate(base.gate);
  const suppliedGate = variant === 'cross-repository'
    ? { ...base.gate, consumer_intent: { ...base.gate.consumer_intent, repository: 'other/repository' } }
    : variant === 'missing-handle' ? undefined : fakeGate;
  const common = { ...base.common };
  if (variant === 'cross-repository'
    && !['loop.commitExact', 'loop.executeTypedGitCommit', 'loop.completeRun', 'loop.governedCompletion', 'loop.transitionRun.terminal', 'loop.releaseMutationLease'].includes(surface)) {
    common.repository_id = 'f'.repeat(64);
  }
  if (surface === 'loop.admitRun') {
    if (suppliedGate) common.semantic_gate = suppliedGate;
    else delete common.semantic_gate;
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'admitRun', [common]);
  }
  if (surface === 'loop.transitionRun.admitted') {
    const route = executionLoop.admitRoute(common);
    const planned = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: common.run_id });
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [planned, 'admitted', suppliedGate ? { semantic_gate: suppliedGate } : {}]);
  }
  if (surface === 'loop.prepareRetry') {
    const route = executionLoop.admitRoute(common);
    const previous = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: 'oracle-previous' });
    const sha = '1'.repeat(40); const tree = '2'.repeat(40);
    const optionsValue = {
      ...common,
      previous_run: previous,
      run_id: 'oracle-retry',
      current_authority_digest: 'e'.repeat(64),
      expected_live: { ref: 'refs/heads/main', sha, tree },
      liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha, tree }) },
      workspaceAdapter: {
        prepare: () => ({ workspace_id: 'oracle-retry-workspace', workspace_handle: 'oracle-retry-handle', commit_sha: sha, tree_sha: tree }),
        verifySnapshot: () => true,
      },
    };
    if (suppliedGate) optionsValue.semantic_gate = suppliedGate;
    else delete optionsValue.semantic_gate;
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'prepareRetry', [optionsValue]);
  }

  const prepared = await oracleLoopWorkspace(base);
  const clonedRun = (run) => structuredClone(run);
  if (surface === 'loop.transitionRun.running') {
    const optionsValue = suppliedGate ? { semantic_gate: suppliedGate } : {};
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [clonedRun(prepared.workspace.run), 'running', optionsValue]);
  }
  if (surface === 'loop.startDelegatedRun' || surface === 'loop.atomicBatchCommit') {
    const expected = prepared.admitted.route_plan.lanes.map((lane) => lane.lane_id);
    const optionsValue = {
      ...base.common,
      run_id: prepared.workspace.run.run_id,
      repository_id: prepared.workspace.run.repository_id,
      authorized_ref_digest: prepared.workspace.run.authorized_ref_digest,
      current_authority_digest: prepared.workspace.run.current_authority_digest,
      route_plan: prepared.admitted.route_plan,
      run: clonedRun(prepared.workspace.run),
      workspace_receipt: prepared.workspace.workspace_receipt,
      liveRefProvider: { read: () => prepared.live },
      prepareLaunch: (lane) => ({ lane_id: lane.lane_id, reservation_handle: `reservation-${lane.lane_id}`, inert: true }),
      commitLaunchBatch: ({ route_plan }) => {
        activeOracleHarness.counters.launch_calls += route_plan.lanes.length;
        return { atomic: true, committed: true, started_lane_ids: route_plan.lanes.map((lane) => lane.lane_id) };
      },
    };
    if (suppliedGate) optionsValue.semantic_gate = suppliedGate;
    else delete optionsValue.semantic_gate;
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'startDelegatedRun', [optionsValue]);
  }
  if (surface === 'loop.executeTypedGitCommit' || surface === 'loop.commitExact') {
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const lease = executionLoop.acquireMutationLease({ state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id });
    let staged = [];
    let committed = false;
    const paths = ['src/oracle.txt'];
    const status = () => ({ repository_id: running.repository_id, head: committed ? 'f'.repeat(40) : prepared.live.sha, tree: committed ? 'd'.repeat(40) : prepared.live.tree, index_digest: committed ? '6'.repeat(64) : '3'.repeat(64), staged_paths: staged, worktree_paths: { staged_paths: staged, unstaged_paths: [], untracked_paths: [] }, change_digest: 'e'.repeat(64) });
    const git = {
      status,
      stageExact: () => { activeOracleHarness.counters.stage_calls += 1; staged = [...paths]; return status(); },
      commit: () => { activeOracleHarness.counters.commit_calls += 1; committed = true; staged = []; return { status: status(), tree: 'd'.repeat(40), change_digest: 'e'.repeat(64) }; },
    };
    const optionsValue = {
      ...base.common, run_id: running.run_id, repository_id: running.repository_id,
      authorized_ref_digest: running.authorized_ref_digest, current_authority_digest: running.current_authority_digest,
      run: clonedRun(running), route_plan: prepared.admitted.route_plan, workspace_receipt: prepared.workspace.workspace_receipt,
      liveRefProvider: { read: () => prepared.live },
      state_root: base.stateRoot, mutation_lease: lease, authorized_paths: paths,
      expected_head: prepared.live.sha, expected_tree: prepared.live.tree, expected_index_digest: '3'.repeat(64),
      commit_message: 'oracle bounded commit', intended_tree: 'd'.repeat(40), intended_change_digest: 'e'.repeat(64),
      git, broker: { authorize: () => ({ decision: 'allow' }) },
    };
    if (suppliedGate) optionsValue.semantic_gate = suppliedGate;
    else delete optionsValue.semantic_gate;
    if (variant === 'cross-repository' && ['loop.commitExact', 'loop.executeTypedGitCommit'].includes(surface)) {
      optionsValue.run = running;
      delete optionsValue.semantic_gate;
      base.gate.setAuthoritySource({ ...sourceReference(`loop-expanded-${oracleSafeSeed(caseValue.id)}`), repository: 'other/repository' });
    }
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, surface.slice('loop.'.length), [optionsValue]);
  }
  if (surface === 'loop.completeRun' || surface === 'loop.governedCompletion' || surface === 'loop.transitionRun.terminal') {
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const terminalPacket = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    const crossRepository = variant === 'cross-repository';
    if (crossRepository) base.gate.setAuthoritySource({ ...sourceReference(`loop-expanded-${oracleSafeSeed(caseValue.id)}`), repository: 'other/repository' });
    if (surface === 'loop.transitionRun.terminal') {
      const optionsValue = crossRepository ? { terminal_packet: terminalPacket }
        : suppliedGate ? { semantic_gate: suppliedGate, terminal_packet: terminalPacket } : { terminal_packet: terminalPacket };
      return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [crossRepository ? validating : clonedRun(validating), 'terminal-success', optionsValue]);
    }
    const optionsValue = { state_root: base.stateRoot, run: crossRepository ? validating : clonedRun(validating), terminal_packet: terminalPacket };
    if (suppliedGate && !crossRepository) optionsValue.semantic_gate = suppliedGate;
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'completeRun', [optionsValue]);
  }
  if (surface === 'loop.releaseMutationLease') {
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const lease = executionLoop.acquireMutationLease({ state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const terminalPacket = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    const terminal = executionLoop.completeRun({ state_root: base.stateRoot, run: validating, terminal_packet: terminalPacket });
    const crossRepository = variant === 'cross-repository';
    if (crossRepository) base.gate.setAuthoritySource({ ...sourceReference(`loop-expanded-${oracleSafeSeed(caseValue.id)}`), repository: 'other/repository' });
    const optionsValue = {
      state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest,
      run_id: running.run_id, lease_id: lease.lease_id, terminal_state: terminal.execution_state,
      workspace_disposition: terminal.workspace_disposition, publication_state: terminal.publication_state, run: crossRepository ? terminal : clonedRun(terminal),
    };
    if (suppliedGate && !crossRepository) optionsValue.semantic_gate = suppliedGate;
    return invokeNegativeSurface(caseValue, 'executionLoop', executionLoop, 'releaseMutationLease', [optionsValue]);
  }
  throw new Error(`No Loop negative production surface ${surface}`);
}

async function oracleExpandedNegativeAssurance(caseValue) {
  const { candidate, assuranceInput } = oracleAssuranceInputs();
  let receiptContext = null;
  if (caseValue.requirement_id === 'I04') {
    const foreignCandidate = { head: 'f'.repeat(40), tree: 'e'.repeat(40), base: 'd'.repeat(40) };
    const gate = semanticGate(`assurance-negative-${oracleSafeSeed(caseValue.id)}`, {}, {
      candidate: assuranceCandidate(foreignCandidate),
      noPredecessor: true,
      scope_digest: assuranceInput.scope.digest,
      stateRoot: oracleStateRoot(`oracle-assurance-negative-${oracleSafeSeed(caseValue.id)}-`),
    });
    const admission = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store,
      'admitSemanticGate', [gate.consumer_intent, gate.trusted_readers], { setup: true });
    if (admission.error) throw admission.error;
    receiptContext = assuranceRuntime.bindReceiptAdmission(gate.store, admission.value.admission);
    resetOracleEffectBaseline();
  } else if (caseValue.requirement_id === 'E06' || caseValue.requirement_id === 'X09') {
    receiptContext = { store: { revalidateSemanticGate: () => true }, admission: {} };
  }
  const method = caseValue.surface.slice('assurance.'.length);
  const args = oracleAssuranceActionInputs(candidate, assuranceInput, receiptContext)[caseValue.surface];
  if (method === 'evaluateInvalidation') {
    args[0] = {
      event: 'SUCCESSOR_CANDIDATE_HEAD',
      semantic_run: 'semantic-oracle-run',
      repository: caseValue.requirement_id === 'I04' ? 'other/repository' : 'weijunswj/ai-agent-toolkit',
    };
  }
  return invokeOracleSurface(caseValue, 'assurance', assuranceRuntime, method, args);
}

async function oracleExpandedNegativeReceipt(caseValue) {
  const target = oracleReceiptExecution(caseValue);
  resetOracleEffectBaseline();
  const invokeNegativeSurface = (...args) => {
    resetOracleEffectBaseline();
    return invokeOracleSurface(...args);
  };
  const surface = caseValue.surface;
  const variant = caseValue.input.variant;
  const crossRepository = caseValue.requirement_id === 'I04' && variant === 'cross-repository';
  const supersedeGateAuthority = () => target.gate.setAuthoritySource({ ...sourceReference(), repository: 'other/repository' });
  if (surface === 'receipt.startRun') {
    const input = { ...target.allocation };
    if (crossRepository) supersedeGateAuthority();
    else if (variant === 'missing-handle') delete input.semantic_gate;
    else input.semantic_gate = { store: {}, admission: {} };
    return invokeNegativeSurface(caseValue, 'programmeReceiptStore', target.store, 'startRun', [input, target.startReaders]);
  }
  if (surface === 'receipt.allocateRun->startAllocatedRun') {
    let input = { ...target.allocation };
    if (crossRepository) input.semantic_gate = target.semantic_gate;
    else if (variant === 'plain-shaped-object') input.semantic_gate = { store: {}, admission: {} };
    else delete input.semantic_gate;
    let allocated = caseValue.requirement_id === 'X09'
      ? await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [input], { setup: true })
      : await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [input]);
    if (caseValue.requirement_id === 'X09' && !allocated.error) {
      ORACLE_SURFACE_RECEIPTS.get(allocated.receipt).setup = false;
    }
    if (crossRepository && !allocated.error) supersedeGateAuthority();
    if (allocated.error) {
      input = { ...target.allocation };
      delete input.semantic_gate;
      allocated = await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [input]);
    }
    if (allocated.error) return allocated;
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'startAllocatedRun', [allocated.value, target.startReaders]);
  }
  if (surface === 'receipt.appendReceipt') {
    target.setDeclaredDependencies(true);
    const input = { ...target.allocation };
    if (!crossRepository) delete input.semantic_gate;
    const session = await target.store.allocateRun(input);
    try { await target.store.startAllocatedRun(session, target.startReaders); } catch (error) {
      if (crossRepository) throw error;
    }
    if (crossRepository) supersedeGateAuthority();
    return invokeNegativeSurface(caseValue, 'programmeReceiptStore', target.store, 'appendReceipt', [session, {
      receipt_type: 'TRANSITION_PREVIEW', candidate: null, payload: { classification: 'ORACLE' }, created_at: new Date().toISOString(),
    }]);
  }
  if (surface === 'receipt.admitMutationOperation') {
    target.setDeclaredDependencies(crossRepository);
    const input = { ...target.allocation }; delete input.semantic_gate;
    let started;
    try {
      started = crossRepository
        ? await target.store.startRun(target.allocation, target.startReaders)
        : await target.store.startRun(input, target.startReaders);
    } catch (error) {
      throw error;
    }
    target.setDeclaredDependencies(true);
    if (crossRepository) supersedeGateAuthority();
    return invokeNegativeSurface(caseValue, 'programmeReceiptStore', target.store, 'admitMutationOperation', [started, target.descriptor, target.mutationReaders]);
  }
  if (surface === 'receipt.authorizeMutationDispatch') {
    target.setDeclaredDependencies(crossRepository);
    const input = { ...target.allocation }; delete input.semantic_gate;
    const started = crossRepository
      ? await target.store.startRun(target.allocation, target.startReaders)
      : await target.store.startRun(input, target.startReaders);
    const admission = await target.store.admitMutationOperation(started, target.descriptor, target.mutationReaders);
    target.setDeclaredDependencies(true);
    if (crossRepository) supersedeGateAuthority();
    return invokeNegativeSurface(caseValue, 'programmeReceiptStore', target.store, 'authorizeMutationDispatch', [started, admission]);
  }
  throw new Error(`No receipt negative production surface ${surface}`);
}

async function oracleExpandedNegative(caseValue) {
  if (caseValue.surface.startsWith('receipt.')) return oracleExpandedNegativeReceipt(caseValue);
  if (caseValue.surface.startsWith('loop.')) return oracleExpandedLoopNegative(caseValue);
  if (caseValue.surface.startsWith('assurance.')) return oracleExpandedNegativeAssurance(caseValue);
  throw new Error(`Unknown expanded negative production surface ${caseValue.surface}`);
}

async function executeAuthorityPacketOracleCase(caseValue, handlers = oracleHandlers()) {
  const identity = oracleCaseIdentity(caseValue);
  const mandatory = ORACLE_MANDATORY_CASES.find((item) => oracleCaseIdentity(item) === identity);
  if (!mandatory || oracleCaseContractBinding(mandatory) !== oracleCaseContractBinding(caseValue)) {
    throw new Error(`ORACLE_CASE_IDENTITY_UNKNOWN:${caseValue.id}`);
  }
  const handler = handlers[identity];
  if (typeof handler !== 'function') throw new Error(`ORACLE_HANDLER_MISSING:${caseValue.id}`);
  const parentHarness = activeOracleHarness;
  const harness = {
    case_identity: identity,
    parent: parentHarness,
    events: [],
    receipts: [],
    readbacks: [],
    assertions: [],
    storeBaselines: new Map(),
    objectBaselines: new Map(),
    counters: {
      launch_calls: 0, atomic_batch_commit_calls: 0, mutation_dispatch_calls: 0, stage_calls: 0, commit_calls: 0,
      complete_calls: 0, release_successes: 0, fresh_reader_processes: 0,
      crash_processes: 0, concurrent_processes: 0, recovery_calls: 0,
    },
  };
  activeOracleHarness = harness;
  const trace = harness.assertions;
  const record = (label, passed, actual) => {
    trace.push({ label, passed: passed === true, actual: String(actual) });
    harness.events.push({
      type: 'assertion',
      sequence: harness.events.length + 1,
      case_identity: identity,
      label: String(label),
      passed: passed === true,
      actual: String(actual),
    });
  };
  try {
    const handlerRecord = handler === runStandardOracleCase
      ? record
      : () => { throw new Error('ORACLE_CALLER_ASSERTION_FORBIDDEN'); };
    const result = await handler(caseValue, Object.freeze({ record: handlerRecord }));
    if (!result) throw new Error(`ORACLE_METADATA_ONLY:${caseValue.id}`);
    const handlerFailure = trace.find((item) => item && item.label === 'handler-action-error');
    if (handlerFailure) throw new Error(`ORACLE_HANDLER_ACTION_FAILED:${caseValue.id}:${handlerFailure.actual}`);
    const returnedReceipts = Array.isArray(result.production_surface_receipts) ? result.production_surface_receipts : [];
    if (returnedReceipts.length !== harness.receipts.length
      || returnedReceipts.some((receipt, index) => receipt !== harness.receipts[index])) {
      throw new Error(`ORACLE_CALL_SEQUENCE_MISMATCH:${caseValue.id}:returned-receipts`);
    }
    const boundaryCalls = harness.receipts.map((receipt) => {
      const bound = receipt && ORACLE_SURFACE_RECEIPTS.get(receipt);
      if (!bound || bound.case_identity !== identity) throw new Error(`ORACLE_UNBOUND_SURFACE_RECEIPT:${caseValue.id}`);
      return bound;
    });
    const requiredCalls = boundaryCalls.filter((call) => call.setup !== true);
    const plan = expectedOraclePlan(caseValue);
    const expectedMethods = plan.calls.map((call) => call.method);
    const observedMethods = requiredCalls.map((call) => call.method);
    if (observedMethods.length !== expectedMethods.length
      || requiredCalls.some((call, index) => call.method !== expectedMethods[index]
        || call.target_type !== plan.calls[index].target_type)) {
      throw new Error(`ORACLE_CALL_SEQUENCE_MISMATCH:${caseValue.id}:expected=${expectedMethods.join(',')}:observed=${observedMethods.join(',')}`);
    }
    if (requiredCalls.some((call, index) => !call.actual
      || call.actual.outcome !== plan.calls[index].expected_outcome)) {
      const failed = requiredCalls.findIndex((call, index) => !call.actual
        || call.actual.outcome !== plan.calls[index].expected_outcome);
      const expected = plan.calls[failed];
      const observed = requiredCalls[failed] && requiredCalls[failed].actual;
      throw new Error('ORACLE_REQUIRED_CALL_FAILED:' + caseValue.id + ':step=' + (failed + 1)
        + ':expected=' + expected.expected_outcome + ':observed=' + (observed && observed.outcome)
        + ':code=' + (observed && observed.code));
    }
    if (requiredCalls.some((call, index) => plan.calls[index].expected_code
      && call.actual.code !== plan.calls[index].expected_code)) {
      const mismatched = requiredCalls.findIndex((call, index) => plan.calls[index].expected_code
        && call.actual.code !== plan.calls[index].expected_code);
      throw new Error(`ORACLE_REQUIRED_CALL_CODE_MISMATCH:${caseValue.id}:step=${mismatched + 1}:expected=${plan.calls[mismatched].expected_code}:observed=${requiredCalls[mismatched].actual.code}`);
    }
    const primaryCall = requiredCalls[plan.decision_call_index];
    if (!primaryCall || !primaryCall.actual) throw new Error(`ORACLE_ACTUAL_OBSERVATION_MISSING:${caseValue.id}`);
    const actual = primaryCall.actual;
    if (actual.outcome !== caseValue.expected.outcome
      || caseValue.expected.reason_code && actual.code !== caseValue.expected.reason_code) {
      throw new Error(`ORACLE_ACTUAL_MISMATCH:${caseValue.id}:${actual.code}`);
    }
    const actualEffects = measuredOracleEffects(harness.receipts);
    actualEffects.tracked_objects = trackedObjectObservations(harness);
    actualEffects.independent_readbacks = harness.readbacks.slice();
    actualEffects.protected_state_unchanged = actualEffects.tracked_objects.every((item) => item.unchanged);
    actualEffects.object_specific_observations = requiredCalls.map((call) => ({
      method: call.method,
      target_type: call.target_type,
      argument_binding_digest: call.argument_binding_digest,
      before: call.object_before,
      after: call.object_after,
    }));
    const effectMatch = oracleManifestEffectMatches(plan.effect_rule, actualEffects, actual, requiredCalls, caseValue);
    if (!effectMatch) {
      const diagnostic = JSON.stringify({
        deltas: Object.fromEntries(ORACLE_PERSISTED_DELTA_KEYS.map((key) => [key, actualEffects[key]])),
        calls: requiredCalls.map((call) => ({
          method: call.method,
          outcome: call.actual && call.actual.outcome,
          code: call.actual && call.actual.code,
          flags: Object.fromEntries(Object.entries(call.effect_delta || {}).filter(([, value]) => typeof value === 'boolean')),
        })),
        effect_checks: {
          no_persistent_change: oracleEffectsHaveNoPersistentChange(actualEffects),
          no_consequence: oracleEffectsHaveNoConsequence(actualEffects),
          no_dispatch: actualEffects.launch_calls === 0 && actualEffects.mutation_dispatch_calls === 0
            && actualEffects.dispatch_intents_delta === 0 && actualEffects.dispatch_confirmed_delta === 0
            && actualEffects.dispatch_not_started_delta === 0,
          all_call_bindings: oracleAllCallBindingsObserved(requiredCalls),
          fresh_reader_processes_observed: actualEffects.fresh_reader_processes_observed,
          tracked_objects: actualEffects.tracked_objects.map((item) => ({
            store_kind: item.store_kind, unchanged: item.unchanged,
            changed_tables: Object.entries(item.tables).filter(([, table]) => table.before_digest !== table.after_digest)
              .map(([name]) => name),
          })),
        },
        readbacks: harness.readbacks.map((item) => ({
          kind: item.kind, passed: item.passed, stage: item.stage,
          checks: item.checks, error_code: item.error_code, error_message: item.error_message,
        })),
      });
      throw new Error(`ORACLE_EFFECT_MISMATCH:${caseValue.id}:${plan.effect_rule}:${diagnostic}`);
    }
    record('actual-boundary-outcome', actual.outcome === caseValue.expected.outcome, `${actual.outcome}:${actual.code}`);
    record('expected-side-effects-observed', effectMatch, JSON.stringify(actualEffects));
    if (trace.length < 1) throw new Error(`ORACLE_METADATA_ONLY:${caseValue.id}`);
    if (trace.some((item) => !item || item.passed !== true)) {
      throw new Error(`ORACLE_ASSERTION_FAILED:${caseValue.id}:${trace.filter((item) => !item || item.passed !== true).map((item) => `${item && item.label}:${item && item.actual}`).join('|')}`);
    }
    const positiveControl = oraclePositiveControlCaseId(caseValue);
    const evidence = {
      requirement_id: caseValue.requirement_id,
      case_id: caseValue.id,
      variant: caseValue.input.variant,
      production_surface: caseValue.surface,
      positive_control_case_id: positiveControl,
      expected_code: caseValue.expected.reason_code || (caseValue.expected.outcome === 'ACCEPT' ? 'ACCEPT' : 'REJECT'),
      actual_code: actual.code,
      expected_effects: { outcome: caseValue.expected.outcome, side_effects: caseValue.expected.side_effects, effect_rule: plan.effect_rule },
      actual_effects: actualEffects,
      assertions_executed: trace.length,
      assertion_trace: trace.slice(),
      assertion_trace_digest: runtime.digestValue(trace),
      passed: actual.outcome === caseValue.expected.outcome
        && (!caseValue.expected.reason_code || actual.code === caseValue.expected.reason_code)
        && trace.every((item) => item && item.passed === true)
        && effectMatch,
    };
    validateOracleEvidence(evidence);
    return evidence;
  } finally {
    activeOracleHarness = parentHarness;
  }
}

async function runStandardOracleCase(caseValue, { record }) {
  const plan = expectedOraclePlan(caseValue);
  const counters = { getter_calls: 0, proxy_trap_calls: 0 };
  const harness = {
    parent: activeOracleHarness,
    events: [],
    storeBaselines: new Map(),
    objectBaselines: new Map(),
    receipts: [],
    readbacks: [],
    counters: {
      launch_calls: 0, atomic_batch_commit_calls: 0, mutation_dispatch_calls: 0, stage_calls: 0, commit_calls: 0,
      complete_calls: 0, release_successes: 0, fresh_reader_processes: 0,
      crash_processes: 0, concurrent_processes: 0, recovery_calls: 0,
    },
  };
  const previousHarness = activeOracleHarness;
  activeOracleHarness = harness;
  const context = caseValue.requirement_id === 'D01'
    ? null
    : sharedOracleContext();
  resetOracleEffectBaseline(harness);
  let actual;
  const plannedDecision = () => {
    const required = harness.receipts.filter((receipt) => {
      const bound = ORACLE_SURFACE_RECEIPTS.get(receipt);
      return bound && bound.setup !== true;
    });
    const receipt = required[plan.decision_call_index];
    const bound = receipt && ORACLE_SURFACE_RECEIPTS.get(receipt);
    return bound && bound.actual;
  };
  try {
    if (caseValue.requirement_id === 'D01') {
      const input = oraclePacketWithVariant(packet({ seed: `oracle-${oracleSafeSeed(caseValue.id)}` }), caseValue.input.variant, counters);
      const invocation = await invokeOracleSurface(caseValue, 'runtime', runtime, 'validateAuthorityPacket', [input]);
      activeOracleHarness.counters.getter_calls = counters.getter_calls;
      activeOracleHarness.counters.proxy_trap_calls = counters.proxy_trap_calls;
      actual = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).actual;
    } else if (caseValue.expected.outcome === 'REJECT') {
      await oracleRejectByCode(caseValue, context);
      actual = plannedDecision();
    } else {
      await oraclePositiveBySurface(caseValue, context);
      actual = plannedDecision();
    }
  } catch (error) {
    actual = { outcome: 'REJECT', code: error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE' };
    record('handler-action-error', false, error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE');
  }
  if (!actual) {
    const requiredCalls = harness.receipts.map((receipt) => ORACLE_SURFACE_RECEIPTS.get(receipt))
      .filter((receipt) => receipt && receipt.setup !== true)
      .map((receipt) => ({ method: receipt.method, outcome: receipt.outcome, code: receipt.actual && receipt.actual.code }));
    actual = { outcome: 'REJECT', code: 'ORACLE_DECISION_RECEIPT_MISSING' };
    record('primary-production-decision-present', false, JSON.stringify({ case_id: caseValue.id, required_calls: requiredCalls }));
  }
  record('production-boundary-returned', actual && actual.outcome === caseValue.expected.outcome, actual && actual.code);
  if (caseValue.expected.reason_code) record('exact-reason-code', actual.code === caseValue.expected.reason_code, actual && actual.code);
  if (caseValue.expected.outcome === 'REJECT') {
    const observed = measuredOracleEffects(harness.receipts);
    record('negative-zero-effect', observed.semantic_admissions_delta === 0
      && observed.web_acceptance_events_delta === 0 && observed.launch_calls === 0
      && observed.mutation_dispatch_calls === 0, JSON.stringify(observed));
  }
  if (caseValue.requirement_id === 'D01') record('non-executing-value-guards', counters.getter_calls === 0 && counters.proxy_trap_calls === 0, `${counters.getter_calls}/${counters.proxy_trap_calls}`);
  activeOracleHarness = previousHarness;
  return {
    production_surface_receipts: harness.receipts,
    assertion_trace: [],
    positive_control_case_id: caseValue.expected.positive_control === true ? caseValue.id : null,
  };
}

function oracleHandlers() {
  return Object.freeze(Object.fromEntries(ORACLE_MANDATORY_CASES.map((item) => [
    oracleCaseIdentity(item), runStandardOracleCase
  ])));
}

function materializeOracleCases(ir) {
  const materialized = [];
  for (const requirement of ir.requirements) {
    for (const item of requirement.cases) {
      const surfaces = !item.surface && EXPANDED_ORACLE_REQUIREMENTS.has(requirement.id)
        ? requirement.surfaces
        : [item.surface];
      for (const surface of surfaces) {
        materialized.push({
          ...structuredClone(item),
          id: surfaces.length > 1 ? `${item.id}-${String(surface).replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/g, '')}` : item.id,
          surface,
          requirement_id: requirement.id,
          invariant: requirement.invariant,
        });
      }
    }
  }
  return materialized;
}

function validateOracleEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') throw new Error('ORACLE_EVIDENCE_INVALID');
  for (const key of ['requirement_id', 'case_id', 'variant', 'production_surface', 'expected_code', 'actual_code', 'expected_effects', 'actual_effects', 'assertions_executed', 'assertion_trace', 'assertion_trace_digest', 'passed']) {
    if (!Object.hasOwn(evidence, key)) throw new Error(`ORACLE_EVIDENCE_FIELD_MISSING:${key}`);
  }
  if (!Number.isInteger(evidence.assertions_executed) || evidence.assertions_executed < 1 || !Array.isArray(evidence.assertion_trace) || evidence.assertion_trace.length < 1) throw new Error('ORACLE_ASSERTIONS_NOT_EXECUTED');
  if (runtime.digestValue(evidence.assertion_trace) !== evidence.assertion_trace_digest) throw new Error('ORACLE_ASSERTION_TRACE_MISMATCH');
  if (evidence.assertion_trace.some((item) => !item || item.passed !== true)) throw new Error('ORACLE_ASSERTION_FAILED');
  if (typeof evidence.passed !== 'boolean') throw new Error('ORACLE_PASS_FLAG_INVALID');
  return true;
}

function assertOracleHandlerCompleteness(cases, handlers = oracleHandlers()) {
  if (!Array.isArray(cases)) throw new Error('ORACLE_CASE_SET_INVALID');
  const ids = new Set();
  const expected = new Map(ORACLE_MANDATORY_CASES.map((item) => [oracleCaseIdentity(item), item]));
  for (const item of cases) {
    const identity = oracleCaseIdentity(item);
    if (ids.has(identity)) throw new Error(`ORACLE_DUPLICATE_CASE:${item.id}`);
    ids.add(identity);
    const canonical = expected.get(identity);
    if (!canonical || oracleCaseContractBinding(canonical) !== oracleCaseContractBinding(item)) {
      throw new Error(`ORACLE_CASE_IDENTITY_UNKNOWN:${item.id}`);
    }
    if (typeof handlers[identity] !== 'function') throw new Error(`ORACLE_HANDLER_MISSING:${item.id}`);
  }
  for (const item of ORACLE_MANDATORY_CASES) {
    const identity = oracleCaseIdentity(item);
    if (!ids.has(identity)) throw new Error(`ORACLE_CASE_UNEXECUTED:${item.id}`);
  }
  if (ids.size !== ORACLE_MANDATORY_CASES.length) throw new Error('ORACLE_CASE_SET_INCOMPLETE');
  return { requirement_count: new Set(cases.map((item) => item.requirement_id)).size, case_count: cases.length };
}

async function runAuthorityPacketOracleMatrix(cases, handlers = oracleHandlers()) {
  assertOracleHandlerCompleteness(cases, handlers);
  const evidence = [];
  for (const item of cases) {
    const result = await executeAuthorityPacketOracleCase(item, handlers);
    if (result.positive_control_case_id !== oraclePositiveControlCaseId(item)) {
      throw new Error(`ORACLE_POSITIVE_CONTROL_MISMATCH:${item.id}`);
    }
    if (result.passed !== true) throw new Error(`ORACLE_CASE_FAILED:${item.id}`);
    evidence.push(result);
  }
  const mandatoryIds = new Set(ORACLE_MANDATORY_CASES.map(oracleCaseIdentity));
  const executedIds = new Set(evidence.map((item) => [item.requirement_id, item.case_id, item.variant, item.production_surface].join('\u0000')));
  const skipped_count = Math.max(0, cases.length - evidence.length);
  const unexecuted_count = [...mandatoryIds].filter((identity) => !executedIds.has(identity)).length;
  const failed_count = evidence.filter((item) => item.passed !== true).length;
  if (skipped_count !== 0 || unexecuted_count !== 0 || failed_count !== 0) {
    throw new Error(`ORACLE_MATRIX_INCOMPLETE:skipped=${skipped_count}:unexecuted=${unexecuted_count}:failed=${failed_count}`);
  }
  return {
    evidence,
    requirement_count: new Set(evidence.map((item) => item.requirement_id)).size,
    case_count: evidence.length,
    skipped_count,
    unexecuted_count,
    failed_count,
  };
}

function cleanup() {
  for (const root of cleanupRoots) fs.rmSync(root, { recursive: true, force: true });
  cleanupRoots.clear();
  oracleStateParent = null;
  oracleSharedContext = null;
  oracleSharedTemplate = null;
  oracleSharedGateContext = null;
  oracleSharedGateTemplate = null;
  oracleSharedAssuranceContext = null;
  oracleSharedAssuranceTemplate = null;
}

process.once('exit', cleanup);

module.exports = {
  ORACLE_MANIFEST_COVERAGE,
  ORACLE_REQUIREMENT_IDS,
  ORACLE_MANDATORY_CASES,
  ORACLE_SPEC_MANIFEST_V1,
  oracleCaseIdentity,
  oracleDispatchOutcomeReader,
  mutateSemanticAdmissionRecord,
  receiptEffectSnapshot,
  bindings,
  cleanup,
  assertOracleHandlerCompleteness,
  executeAuthorityPacketOracleCase,
  invokeOracleSurface,
  oracleContext,
  oracleHandlers,
  materializeOracleCases,
  options,
  packet,
  producerAdmission,
  readers,
  repositoryRoot,
  screening,
  webDecision,
  sourceReference,
  semanticGate,
  assuranceReceiptAdmission,
  runAuthorityPacketOracleMatrix,
  stateRoot
};
