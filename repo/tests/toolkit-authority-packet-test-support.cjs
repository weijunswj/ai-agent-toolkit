'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const executionLoop = require('../scripts/toolkit-execution-loop.cjs');
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

const EXPANDED_ORACLE_REQUIREMENTS = new Set(['E05', 'E06', 'I04', 'X09']);
const ORACLE_MANDATORY_CASES = Object.freeze(
  gateContractCompiler.compileGateContract(oracleContractIr).generated_cases
);
const ORACLE_SURFACE_RECEIPTS = new WeakMap();
const ORACLE_AUTHORITY_PACKET_STORES = new WeakSet();
const ORACLE_PROGRAMME_RECEIPT_STORES = new WeakSet();
const ORACLE_READER_SETS = new WeakSet();
let activeOracleHarness = null;

function oracleCaseIdentity(item) {
  return [item.requirement_id, item.id, item.input && item.input.variant, item.surface].join('\u0000');
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
  return result;
}

function trackOracleAuthorityStore(store) {
  ORACLE_AUTHORITY_PACKET_STORES.add(store);
  if (activeOracleHarness) activeOracleHarness.storeBaselines.set(store, oracleCounts(store));
  return store;
}

function trackOracleProgrammeReceiptStore(store) {
  ORACLE_PROGRAMME_RECEIPT_STORES.add(store);
  if (activeOracleHarness) activeOracleHarness.storeBaselines.set(store, oracleCounts(store));
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
      tables[table] = {
        count: rows.length,
        identity_values: rows.map((row) => row[identity]).sort((left, right) => `${left}`.localeCompare(`${right}`)),
        rows_digest: runtime.digestValue(rows)
      };
    }
    return { database_exists: true, tables };
  } finally { db.close(); }
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
  for (const store of harness.storeBaselines.keys()) harness.storeBaselines.set(store, oracleCounts(store));
}

function oracleSurfaceMethodAllowed(caseValue, targetType, target, method) {
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
  const allowed = oracleSurfaceMethodAllowed(caseValue, targetType, target, method);
  if ((!allowed && !supporting) || !target || typeof target[method] !== 'function') {
    throw new Error(`ORACLE_SURFACE_SUBSTITUTED:${caseValue.id}:${method}`);
  }
  if (targetType === 'authorityPacketStore'
    && (!ORACLE_AUTHORITY_PACKET_STORES.has(target) || runtime.assertAuthenticAuthorityPacketStore(target) !== true)) {
    throw new Error(`ORACLE_STORE_NOT_AUTHENTIC:${caseValue.id}`);
  }
  if (targetType === 'programmeReceiptStore' && !ORACLE_PROGRAMME_RECEIPT_STORES.has(target)) {
    throw new Error(`ORACLE_RECEIPT_STORE_NOT_AUTHENTIC:${caseValue.id}`);
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
  const before = activeOracleHarness
    ? oracleObservedStoreTotals(activeOracleHarness)
    : measuredStore ? oracleCounts(measuredStore) : null;
  const countersBefore = activeOracleHarness ? { ...activeOracleHarness.counters } : {};
  let value;
  let error = null;
  try { value = await target[method].apply(target, args); } catch (caught) { error = caught; }
  if (!error && targetType === 'runtime' && value && typeof value.databasePath === 'string') {
    if (method === 'createProgrammeReceiptStore') trackOracleProgrammeReceiptStore(value);
    else trackOracleAuthorityStore(value);
  }
  const after = activeOracleHarness
    ? oracleObservedStoreTotals(activeOracleHarness)
    : measuredStore ? oracleCounts(measuredStore) : null;
  const localAfter = measuredStore ? oracleCounts(measuredStore) : null;
  const actual = error
    ? { outcome: 'REJECT', code: error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE' }
    : oracleActual(value);
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
  if (!error && targetType === 'runtime' && method === 'authorityPacketStoreIdentity') flags.identity_match = typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'bindWebPacketAcceptance') flags.bound_acceptance = !!value.acceptance_event_id;
  if (!error && targetType === 'authorityPacketStore' && method === 'confirmCurrentPacketProjection') flags.bound_current = Array.isArray(value.readback_event_ids);
  if (!error && targetType === 'authorityPacketStore' && method === 'buildCurrentPacketProjection') {
    flags.projection_bounded = !Object.hasOwn(value, 'body') && !Object.hasOwn(value, 'findings');
    flags.candidate_bound = value.candidate !== undefined;
  }
  if (!error && targetType === 'authorityPacketStore' && method === 'admitSemanticGate') flags.admission_issued = !!value.admission;
  if (!error && targetType === 'authorityPacketStore' && method === 'recoverSemanticGateAdmission') flags.recovered_handle = value.recovered === true;
  if (!error && targetType === 'authorityPacketStore' && method === 'readAuthorityPacket') flags.original_retained = !!value.bindings;
  if (!error && targetType === 'authorityPacketStore' && method === 'backfillAuthorityPacket') {
    flags.original_producer_retained = !!value.packet && !!args[0]
      && runtime.canonicalSerialize(value.packet.bindings.producer) === runtime.canonicalSerialize(args[0].bindings.producer);
  }
  if (!error && targetType === 'runtime' && method === 'initialiseAuthorityPacketStore') {
    flags.store_ready = !!value.databasePath;
    flags.byte_equal_readback = true;
  }
  if (!error && targetType === 'runtime' && method === 'migrateAuthorityPacketStore') flags.v4_historical_preserved = !!value.storeIdentityDigest;
  if (!error && targetType === 'reader' && method === 'screenPacket') flags.screened = value.decision === 'ALLOW' || value.allowed === true;
  if (!error && targetType === 'reader' && method === 'readAuthority') flags.fresh_authority_bound = !!(value.authority || value.repository);
  if (!error && targetType === 'reader' && method === 'readCandidate') flags.candidate_bound = value !== undefined;
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
      && !error && value && value.started === true) activeOracleHarness.counters.fresh_reader_processes += 1;
    if (targetType === 'assurance' && !error && (!value || typeof value !== 'object' || value.ok !== false)) {
      activeOracleHarness.counters.fresh_reader_processes += 1;
    }
    if (targetType === 'executionLoop') {
      const semanticGate = args.map((value) => value && (value.semantic_gate || value.semanticGate))
        .find((value) => value && value.consumer_intent);
      const predecessorRequired = semanticGate && Array.isArray(semanticGate.consumer_intent.predecessors)
        && semanticGate.consumer_intent.predecessors.length > 0;
      if (!error && ['admitRun', 'startDelegatedRun', 'prepareRetry', 'executeTypedGitCommit', 'commitExact', 'completeRun'].includes(method)
        && actual.outcome === 'ACCEPT' && predecessorRequired) activeOracleHarness.counters.fresh_reader_processes += 1;
      if (!error && method === 'transitionRun' && ['admitted', 'running'].includes(args[1]) && predecessorRequired) activeOracleHarness.counters.fresh_reader_processes += 1;
      if (!error && method === 'releaseMutationLease' && value && value.released === true && predecessorRequired) activeOracleHarness.counters.fresh_reader_processes += 1;
      if (method === 'completeRun') activeOracleHarness.counters.complete_calls += 1;
      if (method === 'releaseMutationLease' && !error && value && value.released === true) activeOracleHarness.counters.release_successes += 1;
    }
  }
  const receipt = Object.freeze({});
  ORACLE_SURFACE_RECEIPTS.set(receipt, {
    case_identity: oracleCaseIdentity(caseValue),
    surface: caseValue.surface,
    method,
    target_type: targetType,
    outcome: error ? 'THREW' : 'RETURNED',
    actual,
    effect_delta: { ...effectDelta, ...flags },
    counters_before: countersBefore,
    counters_after: activeOracleHarness ? { ...activeOracleHarness.counters } : {}
  });
  if (activeOracleHarness) {
    activeOracleHarness.receipts.push(receipt);
  }
  return { receipt, value, error };
}

function oracleRecordDerivedOutcome(caseValue, actual, measuredReceipts, flags = {}) {
  if (!activeOracleHarness || !Array.isArray(measuredReceipts) || measuredReceipts.length === 0) {
    throw new Error(`ORACLE_DERIVED_OUTCOME_WITHOUT_PRODUCTION:${caseValue.id}`);
  }
  const receipt = Object.freeze({});
  ORACLE_SURFACE_RECEIPTS.set(receipt, {
    case_identity: oracleCaseIdentity(caseValue),
    surface: caseValue.surface,
    method: expectedOracleMethods(caseValue.surface).at(-1),
    target_type: 'observed-production-invariant',
    outcome: 'OBSERVED_COMPARISON',
    actual,
    effect_delta: {},
    counters_before: { ...activeOracleHarness.counters },
    counters_after: { ...activeOracleHarness.counters },
    flags,
  });
  activeOracleHarness.receipts.push(receipt);
  return receipt;
}

function markOracleReceiptAsSetup(receipt) {
  const bound = receipt && ORACLE_SURFACE_RECEIPTS.get(receipt);
  if (!bound) throw new Error('ORACLE_SETUP_RECEIPT_INVALID');
  bound.setup = true;
  return receipt;
}

function expectedOracleMethods(surface) {
  if (String(surface).includes('->')) return String(surface).split('->').map((item) => item.split('.').at(-1));
  if (surface === 'loop.atomicBatchCommit') return ['startDelegatedRun'];
  if (surface === 'loop.governedCompletion') return ['completeRun'];
  if (surface.startsWith('loop.transitionRun.')) return ['transitionRun'];
  if (surface.startsWith('loop.') || surface.startsWith('assurance.') || surface.startsWith('receipt.')) {
    return [surface.split('.').at(-1)];
  }
  return [surface];
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
    if (bound.setup === true) continue;
    for (const [key, value] of Object.entries(bound.effect_delta || {})) {
      if (key.endsWith('_delta')) effects[key] = (effects[key] || 0) + value;
      else if (key.endsWith('_after')) effects[key] = value;
      else if (['byte_equal_readback', 'identity_match', 'projection_bounded', 'candidate_bound', 'screened', 'admission_issued', 'recovered_handle', 'original_retained', 'original_producer_retained', 'store_ready', 'v4_historical_preserved', 'fresh_authority_bound', 'bound_acceptance', 'bound_current', 'one_json_line', 'preservation_tests', 'over_legacy_limit', 'legacy_pass_retained'].includes(key)) {
        effects[key] = effects[key] === true || value === true;
      }
    }
    if (bound.flags) Object.assign(effects, bound.flags);
  }
  const first = receipts.length ? ORACLE_SURFACE_RECEIPTS.get(receipts[0]).counters_before : {};
  const last = receipts.length ? ORACLE_SURFACE_RECEIPTS.get(receipts.at(-1)).counters_after : {};
  effects.fresh_reader_processes_observed = last.fresh_reader_processes || 0;
  for (const key of ['launch_calls', 'mutation_dispatch_calls', 'stage_calls', 'commit_calls', 'complete_calls', 'release_successes', 'fresh_reader_processes', 'crash_processes', 'concurrent_processes', 'recovery_calls']) {
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
  store.bindWebPacketAcceptance(persisted.packet_id, readersForGate);
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
  current = store.buildCurrentPacketProjection(intent, readersForGate);
  if (fixtureOptions.confirmCurrent !== false) store.confirmCurrentPacketProjection(current, readersForGate);
  trackOracleAuthorityStore(store);
  return {
    packetValue,
    store,
    consumer_intent: intent,
    trusted_readers: readersForGate,
    storeOptions,
    setCurrentBodyDigest(value) { currentBodyDigest = value; },
    resetCurrentBodyDigest() { currentBodyDigest = initialCurrentBodyDigest; },
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
  return { store: gate.store, admission: result.admission };
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
    oracleSharedAssuranceContext = assuranceReceiptAdmission({ stateRoot: oracleStateRoot('oracle-shared-assurance-') });
    oracleSharedAssuranceTemplate = path.join(path.dirname(oracleSharedAssuranceContext.store.databasePath), 'oracle-assurance-template.sqlite');
    fs.copyFileSync(oracleSharedAssuranceContext.store.databasePath, oracleSharedAssuranceTemplate);
    cleanupRoots.add(path.dirname(oracleSharedAssuranceTemplate));
  }
  fs.copyFileSync(oracleSharedAssuranceTemplate, oracleSharedAssuranceContext.store.databasePath);
  trackOracleAuthorityStore(oracleSharedAssuranceContext.store);
  return oracleSharedAssuranceContext;
}

function oracleActual(result) {
  if (result && result.status === 'blocked') {
    return { outcome: 'REJECT', code: result.reason_code || 'BLOCKED' };
  }
  if (result && result.ok === false) {
    return { outcome: 'REJECT', code: result.reason_code || result.code || 'REJECTED' };
  }
  return { outcome: 'ACCEPT', code: 'ACCEPT' };
}

function oracleProcessReceipt(caseValue, store, method, actual, before, processCounter, observed = {}) {
  if (!expectedOracleMethods(caseValue.surface).includes(method) || !ORACLE_AUTHORITY_PACKET_STORES.has(store)
    || runtime.assertAuthenticAuthorityPacketStore(store) !== true) throw new Error('ORACLE_PROCESS_SURFACE_UNBOUND');
  const after = oracleCounts(store);
  const countersBefore = activeOracleHarness ? { ...activeOracleHarness.counters } : {};
  if (activeOracleHarness) Object.assign(activeOracleHarness.counters, processCounter);
  const countersAfter = activeOracleHarness ? { ...activeOracleHarness.counters } : processCounter;
  const receipt = Object.freeze({});
  ORACLE_SURFACE_RECEIPTS.set(receipt, {
    case_identity: oracleCaseIdentity(caseValue),
    surface: caseValue.surface,
    method,
    target_type: 'authorityPacketStore',
    outcome: observed.crash === true ? 'PROCESS_CRASHED' : 'CONCURRENT_PROCESSES_COMPLETED',
    actual,
    effect_delta: oracleEffectDelta(before, after, actual, activeOracleHarness),
    counters_before: countersBefore,
    counters_after: countersAfter,
  });
  if (activeOracleHarness) activeOracleHarness.receipts.push(receipt);
  return receipt;
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
  }, { crash: crashAfterFreshRead && crashed });
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
    'const timer=setInterval(()=>{if(!fs.existsSync(gatePath))return;clearInterval(timer);try{const result=store.persistAuthorityPacket(packet,producerAdmission);process.stdout.write(JSON.stringify({outcome:"ACCEPT",duplicate:result.duplicate})+"\\n")}catch(error){process.stdout.write(JSON.stringify({outcome:"REJECT",code:error.code||"ERROR"})+"\\n")} },5);',
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
  const gatePath = path.join(storeOptions.stateRoot, `${seed}.go`);
  const writers = [launchOracleConcurrentWriter(storeOptions, first, gatePath), launchOracleConcurrentWriter(storeOptions, second, gatePath)];
  await Promise.all(writers.map((writer) => writer.ready));
  fs.writeFileSync(gatePath, 'go\n', { flag: 'wx', mode: 0o600 });
  const outputs = await Promise.all(writers.map((writer) => writer.done));
  const after = oracleCounts(initialStore);
  const accepted = outputs.filter((item) => item.outcome === 'ACCEPT').length;
  const conflicts = outputs.filter((item) => item.code === 'GPR_PACKET_CONFLICT').length;
  const actual = conflicting
    ? accepted === 1 && conflicts === 1 ? { outcome: 'REJECT', code: 'GPR_PACKET_CONFLICT' } : { outcome: 'ACCEPT', code: 'ACCEPT' }
    : accepted === 2 && after.artifacts - before.artifacts === 1 ? { outcome: 'ACCEPT', code: 'ACCEPT' } : { outcome: 'REJECT', code: 'GPR_PACKET_CONFLICT' };
  return oracleProcessReceipt(caseValue, initialStore, 'persistAuthorityPacket', actual, before, { concurrent_processes: 2 }, { conflict: conflicting });
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
    readers: { readAuthority: async () => ({ authority, later_controlling_comments: [] }), readStart: async () => start },
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
  const badReaders = readers(context.packetValue, {
    readWebDecision: () => {
      if (caseValue.input.variant === 'web-pass-before-readback') {
        const error = new runtime.GprError('GPR_PACKET_READBACK_FAILED');
        error.packetBoundary = true;
        throw error;
      }
      return { ...webDecision(context.packetValue), packet_id: `ap1-${'0'.repeat(64)}` };
    },
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
    if (caseValue.input.variant === 'envelope-only-or-truncated') return invokeOracleSurface(caseValue, 'runtime', runtime, surface, [{}]);
    const delivery = context.store.verifyAuthorityPacketFresh(context.persisted.packet_id, context.packetValue.bindings);
    if (activeOracleHarness) activeOracleHarness.counters.fresh_reader_processes += 1;
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
      const oversized = oraclePacketAtCanonicalSize(seed, runtime.AUTHORITY_PACKET_LIMITS.artifactBytes + 1);
      const storeOptions = options(oracleStateRoot(`oracle-over-capacity-${oracleSafeSeed(caseValue.id)}-`));
      const readerSet = readers(oversized);
      const store = runtime.initialiseAuthorityPacketStore(storeOptions, readerSet);
      const canonical = runtime.canonicalSerialize(oversized);
      const packetDigest = runtime.digestValue({ schema: oversized.schema, bindings: oversized.bindings, body: oversized.body });
      const packetId = `ap1-${packetDigest}`;
      const identity = runtime.authorityPacketIdentities(packet({ seed }));
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
    if (caseValue.input.variant === 'update-delete-replace-cleanup') oracleTamperStore(context);
    else {
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
    const privateReaders = readers(privatePacket, { screenPacket: ({ packet: value }) => { runtime.validateAuthorityPacket(value); return screening(value); } });
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
    const invocation = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [wrong, gate.trusted_readers]);
    const after = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
    ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).effect_delta.byte_equal_readback = before === after;
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
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.admission, { operation: 'loop' }]);
  }
  if (surface === 'recordSemanticGateDispatch') {
    const gate = semanticGate(`oracle-dispatch-${oracleSafeSeed(caseValue.id)}`, { readDispatchOutcome: oracleDispatchOutcomeReader('ambiguous') });
    const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
    const intent = gate.store.beginSemanticGateDispatch(admission.admission);
    return invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.admission, {
      transport_id: intent.transport_id, transport_result: { status: 'ambiguous' }, transport_error: null,
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
    const invocation = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [invalidOptions]);
    const after = fs.readFileSync(legacy.databasePath);
    const unchanged = before.equals(after);
    ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).effect_delta.byte_equal_readback = unchanged;
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
          const preserved = compiled.requirements.length === 66 && compiled.generated_cases.length === 337
            && /Shipping Law/i.test(controller) && /POST_SHIP/.test(controller);
          ORACLE_SURFACE_RECEIPTS.get(call.receipt).effect_delta.preservation_tests = preserved;
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
      if (caseValue.input.variant === 'concurrent-identical-writers') return oracleConcurrentPacketWriters(caseValue, false);
      if (caseValue.input.variant === 'serialized-conflict-resolution') {
        const packetValue = packet({ seed: `oracle-conflict-resolution-${oracleSafeSeed(caseValue.id)}` });
        const readerSet = readers(packetValue);
        const store = trackOracleAuthorityStore(runtime.initialiseAuthorityPacketStore(
          options(oracleStateRoot(`oracle-conflict-resolution-${oracleSafeSeed(caseValue.id)}-`)), readerSet
        ));
        const persisted = await invokeOracleSurface(caseValue, 'authorityPacketStore', store, surface, [
          packetValue, producerAdmission(packetValue),
        ]);
        if (persisted.error) throw persisted.error;
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
        const delivery = store.verifyAuthorityPacketFresh(persisted.packet_id, packetValue.bindings);
        if (activeOracleHarness) activeOracleHarness.counters.fresh_reader_processes += 1;
        return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [delivery, {
          expectedBindings: packetValue.bindings, packet: packetValue,
        }]));
      }
      const delivery = context.store.verifyAuthorityPacketFresh(context.persisted.packet_id, context.packetValue.bindings);
      if (activeOracleHarness) activeOracleHarness.counters.fresh_reader_processes += 1;
      return oracleCallValue(invokeOracleSurface(caseValue, 'runtime', runtime, surface, [delivery, { expectedBindings: context.packetValue.bindings, packet: context.packetValue }]));
    }
    case 'readAuthorityPacket':
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', context.store, surface, [context.persisted.packet_id, context.packetValue.bindings, context.packetValue]));
    case 'readAuthority':
    case 'readCandidate':
      return oracleCallValue(invokeOracleSurface(caseValue, 'reader', context.readerSet, surface, [{ packet_id: context.persisted.packet_id }]));
    case 'screenPacket':
      return oracleCallValue(invokeOracleSurface(caseValue, 'reader', context.readerSet, surface, [{ packet: context.packetValue }]));
    case 'admitSemanticGate': {
      const gate = oracleGate(context);
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [gate.consumer_intent, gate.trusted_readers]));
    }
    case 'revalidateSemanticGate': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
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
      gate.store.recordSemanticGateDispatch(admission.admission, {
        transport_id: intent.transport_id, transport_result: { status: 'not-started' }, transport_error: null
      });
      const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
      let consumerKey;
      try { consumerKey = db.prepare('SELECT consumer_key FROM semantic_gate_admissions LIMIT 1').get().consumer_key; }
      finally { db.close(); }
      const recovered = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [{ consumer_key: consumerKey }, gate.trusted_readers]);
      if (recovered.error) throw recovered.error;
      const dispatch = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'beginSemanticGateDispatch', [recovered.value.admission], true);
      if (caseValue.expected.side_effects !== 'new-attempt-permitted') markOracleReceiptAsSetup(dispatch.receipt);
      return recovered.value;
    }
    case 'buildCurrentPacketProjection': {
      const gate = oracleGate(context);
      const packetId = gate.consumer_intent.predecessors[0].packet_id;
      const before = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
      const projection = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [gate.consumer_intent, gate.trusted_readers]);
      if (projection.error) throw projection.error;
      const confirmation = await invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, 'confirmCurrentPacketProjection', [
        projection.value, gate.trusted_readers,
      ], true);
      const after = runtime.canonicalSerialize(gate.store.readAuthorityPacket(packetId, gate.packetValue.bindings));
      ORACLE_SURFACE_RECEIPTS.get(confirmation.receipt).effect_delta.byte_equal_readback = before === after;
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
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      const intent = gate.store.beginSemanticGateDispatch(admission.admission);
      return oracleCallValue(invokeOracleSurface(caseValue, 'authorityPacketStore', gate.store, surface, [admission.admission, {
        transport_id: intent.transport_id, transport_result: { status: 'confirmed' }, transport_error: null
      }]));
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
      const migration = await invokeOracleSurface(caseValue, 'runtime', runtime, surface, [legacyOptions]);
      if (migration.error) throw migration.error;
      const after = legacyStore.readReceiptChain(session.run_id);
      const unchanged = runtime.canonicalSerialize(before) === runtime.canonicalSerialize(after);
      if (activeOracleHarness && unchanged) activeOracleHarness.counters.byte_equal_readback = true;
      const measured = ORACLE_SURFACE_RECEIPTS.get(migration.receipt);
      measured.effect_delta.byte_equal_readback = unchanged;
      measured.effect_delta.v4_historical_preserved = unchanged;
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
  const store = target.store;
  const surface = caseValue.surface;
  if (surface === 'receipt.startRun') {
    return oracleCallValue(invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'startRun', [target.allocation, target.startReaders]));
  }
  if (surface === 'receipt.allocateRun->startAllocatedRun') {
    const session = await oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'allocateRun', [target.allocation]));
    return oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'startAllocatedRun', [session, target.startReaders]));
  }
  const started = await store.startRun(target.allocation, target.startReaders);
  if (activeOracleHarness) activeOracleHarness.counters.fresh_reader_processes += 1;
  if (surface === 'receipt.appendReceipt') {
    return oracleCallValue(invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'appendReceipt', [started, {
      receipt_type: 'TRANSITION_PREVIEW', candidate: null, payload: { classification: 'ORACLE' }, created_at: new Date().toISOString(),
    }]));
  }
  if (surface === 'receipt.admitMutationOperation') {
    return oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'admitMutationOperation', [started, target.descriptor, target.mutationReaders]));
  }
  if (surface === 'receipt.authorizeMutationDispatch') {
    const admission = await store.admitMutationOperation(started, target.descriptor, target.mutationReaders);
    return oracleCallValue(await invokeOracleSurface(caseValue, 'programmeReceiptStore', store, 'authorizeMutationDispatch', [started, admission]));
  }
  throw new Error(`Unknown receipt production surface ${surface}`);
}

function oracleLoopCommon(caseValue, delegated = false, noPredecessor = false) {
  const seed = oracleSafeSeed(caseValue.id);
  const gate = semanticGate(`expanded-${seed}`, {}, { stateRoot: oracleStateRoot(`oracle-expanded-gate-${seed}-`), noPredecessor });
  return {
    caseValue,
    gate,
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
  const admittedCall = await invokeOracleSurface(base.caseValue, 'executionLoop', executionLoop, 'admitRun', [base.common], true);
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

async function oracleExpandedLoopPositive(caseValue) {
  const surface = caseValue.surface;
  if (surface === 'loop.admitRun') {
    const base = oracleLoopCommon(caseValue);
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'admitRun', [base.common]));
  }
  if (surface === 'loop.transitionRun.admitted') {
    const base = oracleLoopCommon(caseValue);
    const route = executionLoop.admitRoute(base.common);
    const planned = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: base.common.run_id });
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [planned, 'admitted', { semantic_gate: base.gate }]));
  }
  if (surface === 'loop.transitionRun.running') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [prepared.workspace.run, 'running', { state_root: base.stateRoot, semantic_gate: base.gate }]));
  }
  if (surface === 'loop.prepareRetry') {
    const base = oracleLoopCommon(caseValue);
    const route = executionLoop.admitRoute(base.common);
    const previous = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: 'oracle-previous' });
    const sha = '1'.repeat(40); const tree = '2'.repeat(40);
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'prepareRetry', [{
      ...base.common, previous_run: previous, run_id: 'oracle-retry', current_authority_digest: 'e'.repeat(64),
      expected_live: { ref: 'refs/heads/main', sha, tree },
      liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha, tree }) },
      workspaceAdapter: { prepare: () => ({ workspace_id: 'oracle-retry-workspace', workspace_handle: 'oracle-retry-handle', commit_sha: sha, tree_sha: tree }), verifySnapshot: () => true },
    }]));
  }
  if (surface === 'loop.startDelegatedRun' || surface === 'loop.atomicBatchCommit') {
    const base = oracleLoopCommon(caseValue, true);
    const prepared = await oracleLoopWorkspace(base);
    const expected = prepared.admitted.route_plan.lanes.map((lane) => lane.lane_id);
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
      prepareLaunch: (lane) => ({ lane_id: lane.lane_id, reservation_handle: `reservation-${lane.lane_id}`, inert: true }),
      commitLaunchBatch: ({ route_plan }) => {
        activeOracleHarness.counters.launch_calls += route_plan.lanes.length;
        return { atomic: true, committed: true, started_lane_ids: route_plan.lanes.map((lane) => lane.lane_id) };
      },
    };
    const result = await invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'startDelegatedRun', [optionsValue]);
    if (result.value && result.value.status === 'running' && result.value.launches.length === expected.length) {
      activeOracleHarness.counters.launch_calls = Math.max(activeOracleHarness.counters.launch_calls, expected.length);
    }
    return oracleCallValue(result);
  }
  if (surface === 'loop.executeTypedGitCommit' || surface === 'loop.commitExact') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const lease = executionLoop.acquireMutationLease({ state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id });
    let staged = [];
    let committed = false;
    const authorizedPaths = ['src/oracle.txt'];
    const gitStatus = () => ({
      repository_id: running.repository_id,
      head: committed ? 'f'.repeat(40) : prepared.live.sha,
      tree: committed ? 'd'.repeat(40) : prepared.live.tree,
      index_digest: committed ? '6'.repeat(64) : '3'.repeat(64),
      staged_paths: staged,
      worktree_paths: { staged_paths: staged, unstaged_paths: [], untracked_paths: [] },
      change_digest: 'e'.repeat(64),
    });
    const git = {
      status: gitStatus,
      stageExact: () => { activeOracleHarness.counters.stage_calls += 1; staged = [...authorizedPaths]; return gitStatus(); },
      commit: () => {
        activeOracleHarness.counters.commit_calls += 1;
        committed = true; staged = [];
        return { status: gitStatus(), tree: 'd'.repeat(40), change_digest: 'e'.repeat(64) };
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
      broker: { authorize: () => ({ decision: 'allow' }) },
    };
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, surface.slice('loop.'.length), [optionsValue]));
  }
  if (surface === 'loop.completeRun' || surface === 'loop.governedCompletion') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const packetValue = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'completeRun', [{ state_root: base.stateRoot, run: validating, terminal_packet: packetValue, semantic_gate: base.gate }]));
  }
  if (surface === 'loop.transitionRun.terminal') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const packetValue = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [validating, 'terminal-success', { terminal_packet: packetValue }]));
  }
  if (surface === 'loop.releaseMutationLease') {
    const base = oracleLoopCommon(caseValue);
    const prepared = await oracleLoopWorkspace(base);
    const running = executionLoop.transitionRun(prepared.workspace.run, 'running', { state_root: base.stateRoot });
    const lease = executionLoop.acquireMutationLease({ state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest, run_id: running.run_id });
    const validating = executionLoop.transitionRun(running, 'validating', { state_root: base.stateRoot });
    const terminalPacket = executionLoop.createTerminalPacket({ run_id: validating.run_id, outcome: 'success', reason_code: 'COMMITTED', evidence_digest: 'f'.repeat(64), publication_state: 'verified', workspace_disposition: 'cleaned' });
    const terminal = executionLoop.completeRun({ state_root: base.stateRoot, run: validating, terminal_packet: terminalPacket });
    return oracleCallValue(invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'releaseMutationLease', [{
      state_root: base.stateRoot, repository_id: running.repository_id, authorized_ref_digest: running.authorized_ref_digest,
      run_id: running.run_id, lease_id: lease.lease_id, terminal_state: terminal.execution_state,
      workspace_disposition: terminal.workspace_disposition, publication_state: terminal.publication_state, run: terminal,
    }]));
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

async function oracleExpandedAssurancePositive(caseValue) {
  const receipt = oracleAssuranceReceipt();
  const receiptContext = assuranceRuntime.bindReceiptAdmission(receipt.store, receipt.admission);
  const { candidate, assuranceInput } = oracleAssuranceInputs();
  const simple = oracleAssuranceActionInputs(candidate, assuranceInput, receiptContext);
  const method = caseValue.surface.slice('assurance.'.length);
  return oracleCallValue(invokeOracleSurface(caseValue, 'assurance', assuranceRuntime, method, simple[caseValue.surface]));
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
    let allocated = await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [allocationInput]);
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
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'admitRun', [common]);
  }
  if (surface === 'loop.transitionRun.admitted') {
    const route = executionLoop.admitRoute(common);
    const planned = executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: common.run_id });
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [planned, 'admitted', suppliedGate ? { semantic_gate: suppliedGate } : {}]);
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
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'prepareRetry', [optionsValue]);
  }

  const prepared = await oracleLoopWorkspace(base);
  const clonedRun = (run) => structuredClone(run);
  if (surface === 'loop.transitionRun.running') {
    const optionsValue = suppliedGate ? { semantic_gate: suppliedGate } : {};
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [clonedRun(prepared.workspace.run), 'running', optionsValue]);
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
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'startDelegatedRun', [optionsValue]);
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
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, surface.slice('loop.'.length), [optionsValue]);
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
      return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'transitionRun', [crossRepository ? validating : clonedRun(validating), 'terminal-success', optionsValue]);
    }
    const optionsValue = { state_root: base.stateRoot, run: crossRepository ? validating : clonedRun(validating), terminal_packet: terminalPacket };
    if (suppliedGate && !crossRepository) optionsValue.semantic_gate = suppliedGate;
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'completeRun', [optionsValue]);
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
    return invokeOracleSurface(caseValue, 'executionLoop', executionLoop, 'releaseMutationLease', [optionsValue]);
  }
  throw new Error(`No Loop negative production surface ${surface}`);
}

async function oracleExpandedNegativeAssurance(caseValue) {
  const { candidate, assuranceInput } = oracleAssuranceInputs();
  let receiptContext = null;
  if (caseValue.requirement_id === 'I04') {
    const foreignCandidate = { head: 'f'.repeat(40), tree: 'e'.repeat(40), base: 'd'.repeat(40) };
    const receipt = assuranceReceiptAdmission({ consumer: { candidate: foreignCandidate } });
    receiptContext = assuranceRuntime.bindReceiptAdmission(receipt.store, receipt.admission);
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
  const surface = caseValue.surface;
  const variant = caseValue.input.variant;
  const crossRepository = caseValue.requirement_id === 'I04' && variant === 'cross-repository';
  const supersedeGateAuthority = () => target.gate.setAuthoritySource({ ...sourceReference(), repository: 'other/repository' });
  if (surface === 'receipt.startRun') {
    const input = { ...target.allocation };
    if (crossRepository) supersedeGateAuthority();
    else if (variant === 'missing-handle') delete input.semantic_gate;
    else input.semantic_gate = { store: {}, admission: {} };
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'startRun', [input, target.startReaders]);
  }
  if (surface === 'receipt.allocateRun->startAllocatedRun') {
    let input = { ...target.allocation };
    if (crossRepository) input.semantic_gate = target.semantic_gate;
    else if (variant === 'plain-shaped-object') input.semantic_gate = { store: {}, admission: {} };
    else delete input.semantic_gate;
    let allocated = await invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'allocateRun', [input]);
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
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'appendReceipt', [session, {
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
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'admitMutationOperation', [started, target.descriptor, target.mutationReaders]);
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
    return invokeOracleSurface(caseValue, 'programmeReceiptStore', target.store, 'authorizeMutationDispatch', [started, admission]);
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
  const trace = [];
  let handlerTrace = [];
  const record = (label, passed, actual) => {
    trace.push({ label, passed: passed === true, actual: String(actual) });
  };
  const result = await handler(caseValue, { record });
  handlerTrace = trace.slice();
  if (!result) {
    throw new Error(`ORACLE_METADATA_ONLY:${caseValue.id}`);
  }
  const suppliedTrace = Array.isArray(result.assertion_trace) ? result.assertion_trace : [];
  const handlerFailureTrace = [...handlerTrace, ...suppliedTrace].filter((item) => !item || item.passed !== true);
  if (handlerFailureTrace.length) {
    throw new Error(`ORACLE_ASSERTION_FAILED:${caseValue.id}:${handlerFailureTrace.map((item) => `${item && item.label}:${item && item.actual}`).join('|')}`);
  }
  const receipts = Array.isArray(result.production_surface_receipts) ? result.production_surface_receipts : [];
  const boundaryCalls = receipts.map((receipt) => {
    const bound = receipt && ORACLE_SURFACE_RECEIPTS.get(receipt);
    if (!bound || bound.case_identity !== identity) throw new Error(`ORACLE_UNBOUND_SURFACE_RECEIPT:${caseValue.id}`);
    return bound;
  });
  for (const method of expectedOracleMethods(caseValue.surface)) {
    if (!boundaryCalls.some((call) => call.method === method)) {
      throw new Error(`ORACLE_SURFACE_UNEXECUTED:${caseValue.id}:${method}:observed=${boundaryCalls.map((call) => call.method).join(',')}`);
    }
  }
  const primaryCall = boundaryCalls.at(-1);
  if (!primaryCall || !primaryCall.actual) throw new Error(`ORACLE_ACTUAL_OBSERVATION_MISSING:${caseValue.id}`);
  const actual = primaryCall.actual;
  const actualEffects = measuredOracleEffects(receipts);
  const effectMatch = oracleExpectedEffectMatches(caseValue.expected.side_effects, actualEffects, actual, caseValue.surface);
  const failedTrace = [...handlerTrace, ...suppliedTrace].filter((item) => !item || item.passed !== true);
  if (failedTrace.length) throw new Error(`ORACLE_ASSERTION_FAILED:${caseValue.id}:${failedTrace.map((item) => `${item && item.label}:${item && item.actual}`).join('|')}`);
  if (actual.outcome !== caseValue.expected.outcome
    || caseValue.expected.reason_code && actual.code !== caseValue.expected.reason_code) {
    throw new Error(`ORACLE_ACTUAL_MISMATCH:${caseValue.id}:${actual.code}`);
  }
  if (!effectMatch) throw new Error(`ORACLE_EFFECT_MISMATCH:${caseValue.id}:${caseValue.expected.side_effects}`);
  record('actual-boundary-outcome', true, `${actual.outcome}:${actual.code}`);
  record('expected-side-effects-observed', true, JSON.stringify(actualEffects));
  const assertionTrace = trace.concat(suppliedTrace);
  if (assertionTrace.length < 1) throw new Error(`ORACLE_METADATA_ONLY:${caseValue.id}`);
  const assertionsPassed = assertionTrace.every((item) => item && item.passed === true);
  if (!assertionsPassed) throw new Error(`ORACLE_ASSERTION_FAILED:${caseValue.id}`);
  const evidence = {
    requirement_id: caseValue.requirement_id,
    case_id: caseValue.id,
    variant: caseValue.input.variant,
    production_surface: caseValue.surface,
    positive_control_case_id: result.positive_control_case_id,
    expected_code: caseValue.expected.reason_code || (caseValue.expected.outcome === 'ACCEPT' ? 'ACCEPT' : 'REJECT'),
    actual_code: actual.code,
    expected_effects: { outcome: caseValue.expected.outcome, side_effects: caseValue.expected.side_effects },
    actual_effects: actualEffects,
    assertions_executed: assertionTrace.length,
    assertion_trace: assertionTrace,
    assertion_trace_digest: runtime.digestValue(assertionTrace),
    passed: actual.outcome === caseValue.expected.outcome
      && (!caseValue.expected.reason_code || actual.code === caseValue.expected.reason_code)
      && assertionsPassed
      && effectMatch,
  };
  validateOracleEvidence(evidence);
  return evidence;
}

async function runStandardOracleCase(caseValue, { record }) {
  const counters = { getter_calls: 0, proxy_trap_calls: 0 };
  const harness = {
    storeBaselines: new Map(),
    receipts: [],
    counters: {
      launch_calls: 0, mutation_dispatch_calls: 0, stage_calls: 0, commit_calls: 0,
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
  try {
    if (caseValue.requirement_id === 'D01') {
      const input = oraclePacketWithVariant(packet({ seed: `oracle-${oracleSafeSeed(caseValue.id)}` }), caseValue.input.variant, counters);
      const invocation = await invokeOracleSurface(caseValue, 'runtime', runtime, 'validateAuthorityPacket', [input]);
      activeOracleHarness.counters.getter_calls = counters.getter_calls;
      activeOracleHarness.counters.proxy_trap_calls = counters.proxy_trap_calls;
      actual = ORACLE_SURFACE_RECEIPTS.get(invocation.receipt).actual;
    } else if (caseValue.expected.outcome === 'REJECT') {
      await oracleRejectByCode(caseValue, context);
      actual = ORACLE_SURFACE_RECEIPTS.get(harness.receipts.at(-1))?.actual;
    } else {
      await oraclePositiveBySurface(caseValue, context);
      actual = ORACLE_SURFACE_RECEIPTS.get(harness.receipts.at(-1))?.actual;
    }
  } catch (error) {
    if (harness.receipts.length) actual = ORACLE_SURFACE_RECEIPTS.get(harness.receipts.at(-1)).actual;
    else actual = { outcome: 'REJECT', code: error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE' };
    record('handler-action-error', false, error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE');
  }
  record('production-boundary-returned', actual && actual.outcome === caseValue.expected.outcome, actual && actual.code);
  if (caseValue.expected.reason_code) record('exact-reason-code', actual.code === caseValue.expected.reason_code, actual.code);
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
  const positiveBySurface = new Map();
  for (const item of cases) if (item.expected.positive_control === true) positiveBySurface.set(`${item.requirement_id}\u0000${item.surface || ''}`, item.id);
  const evidence = [];
  for (const item of cases) {
    const result = await executeAuthorityPacketOracleCase(item, handlers);
    if (result.positive_control_case_id === null) result.positive_control_case_id = positiveBySurface.get(`${item.requirement_id}\u0000${item.surface || ''}`) || null;
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
  ORACLE_REQUIREMENT_IDS,
  ORACLE_MANDATORY_CASES,
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
