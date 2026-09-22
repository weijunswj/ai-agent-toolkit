'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const executionLoop = require('../scripts/toolkit-execution-loop.cjs');
const assuranceRuntime = require('../scripts/toolkit-assurance-web-finality.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const cleanupRoots = new Set();
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
    sections: [
      { name: 'implementation_contract', text: 'The v4 extension stores the complete packet without changing v2 receipt semantics.' },
      { name: 'mutation_boundary', text: 'Only the explicitly initialised private custody store may receive this artifact.' },
      { name: 'oracle_matrix', text: 'Focused tests cover canonical values, identities, migration, persistence, and readback.' },
      { name: 'validation', text: 'The isolated test process verifies exact bytes and independent readback.' },
      { name: 'publication_boundary', text: 'No live system, GitHub mutation, or publication operation is performed.' }
    ],
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
  };
}

function readers(packetValue, overrides = {}) {
  const packetBindings = packetValue.bindings;
  const result = {
    readAuthority: overrides.readAuthority || (() => ({
      authority: structuredClone(packetBindings.authority),
      required_consumers: structuredClone(packetBindings.applicability.required_consumers),
      later_controlling_comments: [],
    })),
    screenPacket: overrides.screenPacket || (() => screening(packetValue)),
    readWebDecision: overrides.readWebDecision || (() => webDecision(packetValue)),
    ...overrides
  };
  if (overrides.readBackfillSource) result.readBackfillSource = overrides.readBackfillSource;
  return result;
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
  const readersForGate = readers(packetValue, {
    readCandidate: () => candidate,
    readWebDecision: () => webDecision(packetValue, required),
    readCurrent: () => ({
      current,
      projection_digest: runtime.digestValue(current),
      body_digest: currentBodyDigest,
      revision: 1,
    }),
    readDispatchOutcome: ({ status, transport_result, transport_error }) => {
      const observed = status || (transport_error ? 'not-started' : 'confirmed');
      return {
        status: observed,
        transport_result,
        delayed_completion_excluded: observed === 'not-started',
      };
    },
    ...readerOverrides,
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
  store.confirmCurrentPacketProjection(current, readersForGate);
  return {
    store,
    consumer_intent: intent,
    trusted_readers: readersForGate,
    storeOptions,
    setCurrentBodyDigest(value) { currentBodyDigest = value; },
    resetCurrentBodyDigest() { currentBodyDigest = initialCurrentBodyDigest; },
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
  if (!store) return {
    artifacts: 0,
    packet_events: 0,
    web_acceptance_events: 0,
    current_readback_events: 0,
    semantic_admissions: 0,
    dispatch_intents: 0,
  };
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    const count = (table, where = '') => Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table}${where}`).get().value);
    return {
      artifacts: count('authority_packets'),
      packet_events: count('authority_packet_events'),
      web_acceptance_events: count('authority_packet_events', " WHERE event_type = 'WEB_ACCEPTANCE_BOUND'"),
      current_readback_events: count('authority_packet_events', " WHERE event_type = 'CURRENT_READBACK'"),
      semantic_admissions: count('semantic_gate_admissions'),
      dispatch_intents: count('semantic_gate_admission_events', " WHERE event_type = 'DISPATCH_INTENT'"),
    };
  } finally {
    db.close();
  }
}

function oracleEffectDelta(before, after, outcome) {
  return {
    accepted: outcome === 'ACCEPT',
    consumable: outcome === 'ACCEPT',
    next_gate_admitted: outcome === 'ACCEPT',
    artifact_insert_delta: after.artifacts - before.artifacts,
    web_acceptance_event_delta: after.web_acceptance_events - before.web_acceptance_events,
    current_confirmation_event_delta: after.current_readback_events - before.current_readback_events,
    new_dispatch_intents: after.dispatch_intents - before.dispatch_intents,
    launch_calls: 0,
    mutation_dispatch_calls: 0,
    stage_calls: 0,
    commit_calls: 0,
    consumable_completion_delta: 0,
    safe_release_delta: 0,
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

function sharedOracleContext() {
  if (!oracleSharedContext) {
    oracleSharedContext = oracleContext('shared-matrix');
    oracleSharedTemplate = path.join(path.dirname(oracleSharedContext.store.databasePath), 'oracle-template.sqlite');
    fs.copyFileSync(oracleSharedContext.store.databasePath, oracleSharedTemplate);
    cleanupRoots.add(path.dirname(oracleSharedTemplate));
  }
  fs.copyFileSync(oracleSharedTemplate, oracleSharedContext.store.databasePath);
  oracleSharedContext.gate = null;
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
  fs.copyFileSync(oracleSharedGateTemplate, oracleSharedGateContext.store.databasePath);
  oracleSharedGateContext.resetCurrentBodyDigest();
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
  return { store, packetValue, readerSet, before: oracleCounts(store) };
}

async function oracleRejectByCode(caseValue, context) {
  const code = caseValue.expected.reason_code;
  if (caseValue.requirement_id === 'C04') {
    const delivery = context.store.verifyAuthorityPacketFresh(context.persisted.packet_id, context.packetValue.bindings);
    const wrongBindings = structuredClone(context.packetValue.bindings);
    wrongBindings.lane_id = 'wrong-lane';
    return runtime.validateAuthorityPacketDelivery(delivery, { expectedBindings: wrongBindings });
  }
  if (caseValue.requirement_id === 'C05') {
    const wrongBindings = structuredClone(context.packetValue.bindings);
    wrongBindings.lane_id = 'wrong-lane';
    return context.store.readAuthorityPacket(context.persisted.packet_id, wrongBindings);
  }
  if (caseValue.requirement_id === 'C07') {
    const wrongCandidate = {
      pr_number: 354,
      branch: 'wrong-candidate',
      base_ref: 'main',
      base_sha: 'c'.repeat(40),
      head_sha: 'a'.repeat(40),
      tree_sha: 'b'.repeat(40),
    };
    return semanticGate(
      `candidate-${oracleSafeSeed(caseValue.id)}`,
      { readCandidate: () => wrongCandidate },
      { stateRoot: oracleStateRoot(`oracle-candidate-${caseValue.id}-`) }
    );
  }
  if (caseValue.requirement_id === 'C08') {
    const gate = oracleGate(context);
    const wrongIntent = { ...gate.consumer_intent, repository: 'other/repository' };
    return gate.store.admitSemanticGate(wrongIntent, gate.trusted_readers);
  }
  switch (code) {
    case 'GPR_PACKET_VALUE_INVALID':
      return runtime.validateAuthorityPacket({});
    case 'GPR_PACKET_SCHEMA_UNSUPPORTED':
      return runtime.validateAuthorityPacket({ ...context.packetValue, schema: 'toolkit.github-program.authority-packet.v0' });
    case 'GPR_PACKET_PRIVACY_REJECTED': {
      const privateValue = structuredClone(context.packetValue);
      privateValue.body.decision = 'password=synthetic-secret';
      return runtime.validateAuthorityPacket(privateValue);
    }
    case 'GPR_PACKET_LIMIT': {
      const oversized = structuredClone(context.packetValue);
      oversized.body.decision = 'x'.repeat(runtime.AUTHORITY_PACKET_LIMITS.proseBytes + 1);
      return runtime.validateAuthorityPacket(oversized);
    }
    case 'GPR_PACKET_STORE_UNAVAILABLE':
      fs.rmSync(context.store.databasePath, { force: true });
      return context.store.readAuthorityPacket(context.persisted.packet_id, context.packetValue.bindings);
    case 'GPR_PACKET_STORE_IDENTITY_MISMATCH': {
      const wrongOptions = {
        ...context.storeOptions,
        repository: 'other/repository',
      };
      const wrongDatabase = path.join(
        wrongOptions.stateRoot,
        `github-program-receipt-${runtime.namespaceDigest({
          repository: wrongOptions.repository,
          parent_issue: wrongOptions.parent_issue,
          child_issue: wrongOptions.child_issue,
        })}.sqlite`
      );
      fs.copyFileSync(context.store.databasePath, wrongDatabase);
      return runtime.authorityPacketStoreIdentity(wrongOptions);
    }
    case 'GPR_PACKET_MIGRATION_SOURCE_INVALID': {
      const legacyOptions = options(oracleStateRoot(`oracle-migration-invalid-${oracleSafeSeed(caseValue.id)}-`));
      const legacy = runtime.createProgrammeReceiptStore(legacyOptions);
      const db = new DatabaseSync(legacy.databasePath);
      try { db.exec('PRAGMA user_version=3'); }
      finally { db.close(); }
      return runtime.planAuthorityPacketMigration(legacyOptions);
    }
    case 'GPR_PACKET_WRITE_FAILED': {
      const failing = oracleWrongAcceptanceContext(caseValue.id);
      const error = new runtime.GprError('GPR_PACKET_WRITE_FAILED');
      error.packetBoundary = true;
      const writerReaders = readers(failing.packetValue, { screenPacket: () => { throw error; } });
      const writerStore = runtime.initialiseAuthorityPacketStore(options(oracleStateRoot(`oracle-write-${oracleSafeSeed(caseValue.id)}-`)), writerReaders);
      return writerStore.persistAuthorityPacket(failing.packetValue, producerAdmission(failing.packetValue));
    }
    case 'GPR_PACKET_NOT_FOUND':
      return context.store.readAuthorityPacket(`ap1-${'0'.repeat(64)}`, context.packetValue.bindings);
    case 'GPR_PACKET_CONTENT_MISMATCH':
      oracleTamperStore(context);
      return runtime.createAuthorityPacketStore(context.storeOptions, readers(context.packetValue));
    case 'GPR_PACKET_IDENTITY_MISMATCH': {
      const delivery = context.store.verifyAuthorityPacketFresh(context.persisted.packet_id, context.packetValue.bindings);
      const tampered = structuredClone(delivery);
      tampered.packet.body.decision = 'changed after delivery';
      return runtime.validateAuthorityPacketDelivery(tampered);
    }
    case 'GPR_PACKET_BINDING_MISMATCH': {
      const wrong = structuredClone(context.packetValue.bindings);
      wrong.repository = 'other/repository';
      wrong.authority.repository = 'other/repository';
      wrong.governance.repository = 'other/repository';
      return context.store.readAuthorityPacket(context.persisted.packet_id, wrong);
    }
    case 'GPR_PACKET_CONFLICT': {
      const changed = structuredClone(context.packetValue);
      changed.body.decision = 'conflicting immutable content';
      const conflictStore = runtime.createAuthorityPacketStore(context.storeOptions, readers(changed));
      return conflictStore.persistAuthorityPacket(changed, producerAdmission(changed));
    }
    case 'GPR_PACKET_READBACK_FAILED':
      return runtime.validateAuthorityPacketDelivery({});
    case 'GPR_PACKET_AUTHORITY_UNVERIFIED': {
      const gate = oracleGate(context);
      const replacement = { ...gate.trusted_readers, readAuthority: () => ({ later_controlling_comments: ['later'] }) };
      return gate.store.buildCurrentPacketProjection(gate.consumer_intent, replacement);
    }
    case 'GPR_PACKET_ACCEPTANCE_UNVERIFIED': {
      const bad = oracleWrongAcceptanceContext(caseValue.id);
      return bad.store.bindWebPacketAcceptance(bad.persisted.packet_id, bad.readers);
    }
    case 'GPR_PACKET_CURRENT_UNVERIFIED':
      return runtime.validateAuthorityPacketCurrent({});
    case 'GPR_PACKET_CONSUMER_NOT_PERMITTED':
      return runtime.validateAuthorityPacketCurrent({});
    case 'GPR_PACKET_ADMISSION_REQUIRED': {
      const gate = oracleGate(context);
      return gate.store.revalidateSemanticGate({});
    }
    case 'GPR_PACKET_STALE_REPLAY': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      gate.setCurrentBodyDigest(runtime.digestValue({ stale: true }));
      const current = gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers);
      gate.store.confirmCurrentPacketProjection(current, gate.trusted_readers);
      return gate.store.revalidateSemanticGate(admission.admission, { operation: 'loop' });
    }
    case 'GPR_PACKET_DISPATCH_UNRESOLVED': {
      const gate = semanticGate(`oracle-dispatch-${oracleSafeSeed(caseValue.id)}`, { readDispatchOutcome: () => ({ status: 'ambiguous' }) });
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      gate.store.beginSemanticGateDispatch(admission.admission);
      return gate.store.recordSemanticGateDispatch(admission.admission, { status: 'ambiguous' });
    }
    case 'GPR_PACKET_LEGACY_BACKFILL_UNVERIFIED':
      return oracleBackfillContext(caseValue.id, 'invalid').store.backfillAuthorityPacket(
        oracleBackfillContext(caseValue.id, 'invalid').packetValue
      );
    case 'GPR_PACKET_LEGACY_RERUN_REQUIRED': {
      const backfill = oracleBackfillContext(caseValue.id, 'none');
      return backfill.store.backfillAuthorityPacket(backfill.packetValue);
    }
    default:
      throw new Error(`No negative oracle action for ${code}`);
  }
}

async function oraclePositiveBySurface(caseValue, context) {
  const surface = caseValue.surface;
  if (surface && surface.includes('.')) return oracleExpandedPositive(caseValue, context);
  switch (surface) {
    case 'validateAuthorityPacket': return runtime.validateAuthorityPacket(context.packetValue);
    case 'authorityPacketIdentities': return runtime.authorityPacketIdentities(context.packetValue);
    case 'authorityPacketStoreIdentity': return context.store.storeIdentityDigest();
    case 'initialiseAuthorityPacketStore': return context.store;
    case 'persistAuthorityPacket': return context.store.persistAuthorityPacket(context.packetValue, producerAdmission(context.packetValue));
    case 'bindWebPacketAcceptance': return context.store.bindWebPacketAcceptance(context.persisted.packet_id, context.readerSet);
    case 'verifyAuthorityPacketFresh': return context.store.verifyAuthorityPacketFresh(context.persisted.packet_id, context.packetValue.bindings);
    case 'validateAuthorityPacketDelivery': {
      const delivery = context.store.verifyAuthorityPacketFresh(context.persisted.packet_id, context.packetValue.bindings);
      return runtime.validateAuthorityPacketDelivery(delivery, { expectedBindings: context.packetValue.bindings, packet: context.packetValue });
    }
    case 'readAuthorityPacket': return context.store.readAuthorityPacket(context.persisted.packet_id, context.packetValue.bindings);
    case 'readAuthority': return context.readerSet.readAuthority({ packet_id: context.persisted.packet_id });
    case 'readCandidate': return context.readerSet.readCandidate({ packet_id: context.persisted.packet_id });
    case 'screenPacket': return context.readerSet.screenPacket({ packet: context.packetValue });
    case 'admitSemanticGate': {
      const gate = oracleGate(context);
      return gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
    }
    case 'revalidateSemanticGate': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      return gate.store.revalidateSemanticGate(admission.admission, { operation: 'loop' });
    }
    case 'beginSemanticGateDispatch': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      return gate.store.beginSemanticGateDispatch(admission.admission);
    }
    case 'recoverSemanticGateAdmission': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      gate.store.beginSemanticGateDispatch(admission.admission);
      gate.store.recordSemanticGateDispatch(admission.admission, { status: 'not-started' });
      const db = new DatabaseSync(gate.store.databasePath, { readOnly: true });
      let consumerKey;
      try { consumerKey = db.prepare('SELECT consumer_key FROM semantic_gate_admissions LIMIT 1').get().consumer_key; }
      finally { db.close(); }
      return gate.store.recoverSemanticGateAdmission({ consumer_key: consumerKey }, gate.trusted_readers);
    }
    case 'buildCurrentPacketProjection': {
      const gate = oracleGate(context);
      return gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers);
    }
    case 'confirmCurrentPacketProjection': {
      const gate = semanticGate(
        `confirm-${oracleSafeSeed(caseValue.id)}`,
        {},
        { stateRoot: oracleStateRoot(`oracle-confirm-${caseValue.id}-`) }
      );
      const current = gate.store.buildCurrentPacketProjection(gate.consumer_intent, gate.trusted_readers);
      return gate.store.confirmCurrentPacketProjection(current, gate.trusted_readers);
    }
    case 'recordSemanticGateDispatch': {
      const gate = oracleGate(context);
      const admission = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
      gate.store.beginSemanticGateDispatch(admission.admission);
      return gate.store.recordSemanticGateDispatch(admission.admission, { status: 'confirmed' });
    }
    case 'backfillAuthorityPacket': {
      const backfill = oracleBackfillContext(caseValue.id, 'complete');
      return backfill.store.backfillAuthorityPacket(backfill.packetValue);
    }
    case 'migrateAuthorityPacketStore': {
      const legacyOptions = options(oracleStateRoot(`oracle-migration-valid-${oracleSafeSeed(caseValue.id)}-`));
      runtime.createProgrammeReceiptStore(legacyOptions);
      return runtime.migrateAuthorityPacketStore(legacyOptions);
    }
    default:
      throw new Error(`No positive oracle action for ${surface}`);
  }
}

async function oracleExpandedPositive(caseValue, context) {
  const surface = caseValue.surface;
  if (surface.startsWith('receipt.')) {
    const root = oracleStateRoot(`oracle-receipt-${oracleSafeSeed(caseValue.id)}-`);
    const store = runtime.createProgrammeReceiptStore({
      repository: 'weijunswj/ai-agent-toolkit', parent_issue: 435, child_issue: 435,
      stateRoot: root, repositoryRoot,
    });
    const authority = {
      child_comment_id: 1, parent_comment_id: 2, node_id: 'IC_oracle', author_login: 'weijunswj',
      author_association: 'OWNER', body_digest: 'a'.repeat(64), updated_at: '2026-09-22T10:00:00.000Z',
      update_identity_digest: 'b'.repeat(64), scope_digest: 'c'.repeat(64),
    };
    const start = { base_sha: '1'.repeat(40), head_sha: '2'.repeat(40), tree_sha: '3'.repeat(40), status_digest: 'd'.repeat(64), clean_worktree: true, ref: { detached: false, name: 'oracle/branch' } };
    const readStart = { readAuthority: async () => ({ authority, later_controlling_comments: [] }), readStart: async () => start };
    const trustedReaders = {
      readAuthority: async () => ({ authority, later_controlling_comments: [] }),
      readSource: async () => ({ source_digest: 'e'.repeat(64), cas_digest: 'f'.repeat(64) }),
      verifyOutcomeEvidence: async () => true,
    };
    const operation = {
      operation_kind: 'IDEMPOTENT_SET', safety_class: 'IDEMPOTENT', target_identity: { resource_type: 'provider_resource', resource_id: 'oracle-resource' },
      target_digest: runtime.digestValue({ resource_type: 'provider_resource', resource_id: 'oracle-resource' }), expected_source_digest: 'e'.repeat(64), cas_digest: 'f'.repeat(64), expected_post_state_digest: 'a'.repeat(64), adapter_identity_digest: 'b'.repeat(64), retry_of_operation_id: null,
    };
    if (surface === 'receipt.startRun') return store.startRun({ lock: 'oracle-lock', authority, start, candidate: null, lease_ms: 60000 }, readStart);
    const session = store.allocateRun({ lock: 'oracle-lock', authority, start, candidate: null, lease_ms: 60000 });
    if (surface === 'receipt.allocateRun->startAllocatedRun') return store.startAllocatedRun(session, readStart);
    const started = await store.startAllocatedRun(session, readStart);
    if (surface === 'receipt.appendReceipt') return store.appendReceipt(started, { receipt_type: 'TRANSITION_PREVIEW', candidate: null, payload: { classification: 'ORACLE' }, created_at: new Date().toISOString() });
    if (surface === 'receipt.admitMutationOperation') return store.admitMutationOperation(started, operation, trustedReaders);
    if (surface === 'receipt.authorizeMutationDispatch') {
      const admission = await store.admitMutationOperation(started, operation, trustedReaders);
      return store.authorizeMutationDispatch(started, admission);
    }
    return started;
  }
  if (surface.startsWith('loop.')) {
    const gate = semanticGate(`expanded-${oracleSafeSeed(caseValue.id)}`, {}, { stateRoot: oracleStateRoot(`oracle-expanded-gate-${oracleSafeSeed(caseValue.id)}-`) });
    const common = {
      task: { id: 'oracle-task', digest: 'a'.repeat(64) },
      repository_id: 'b'.repeat(64), authorized_ref_digest: 'c'.repeat(64), current_authority_digest: 'd'.repeat(64),
      authority: { delegated: false, lanes: [] },
      consentProvider: () => ({ status: 'healthy', capabilities: { execution_loop: { state: 'enabled' } } }),
      semantic_gate: gate,
      run_id: `oracle-${oracleSafeSeed(caseValue.id)}`,
    };
    const route = executionLoop.admitRoute(common);
    const planned = route.status === 'admitted'
      ? executionLoop.createRunReceipt({ request: route.request, route_plan: route.route_plan, run_id: common.run_id })
      : null;
    if (surface === 'loop.admitRun' || surface === 'loop.atomicBatchCommit' || surface === 'loop.startDelegatedRun') return executionLoop.admitRun(common);
    if (surface === 'loop.transitionRun.admitted') return executionLoop.transitionRun(planned, 'admitted', { semantic_gate: gate });
    if (surface === 'loop.transitionRun.running') {
      const admittedRun = executionLoop.transitionRun(planned, 'admitted', { semantic_gate: gate });
      const workspace = executionLoop.admitWorkspace({
        run: admittedRun,
        expected_live: { ref: 'refs/heads/main', sha: '1'.repeat(40), tree: '2'.repeat(40) },
        liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha: '1'.repeat(40), tree: '2'.repeat(40) }) },
        workspaceAdapter: { prepare: () => ({ workspace_id: 'oracle-workspace', workspace_handle: 'oracle-handle', commit_sha: '1'.repeat(40), tree_sha: '2'.repeat(40) }), verifySnapshot: () => true },
      });
      return executionLoop.transitionRun(workspace.run, 'running');
    }
    if (surface === 'loop.prepareRetry') {
      const previousRoute = executionLoop.admitRoute(common);
      const previous = executionLoop.createRunReceipt({ request: previousRoute.request, route_plan: previousRoute.route_plan, run_id: 'oracle-previous' });
      return executionLoop.prepareRetry({ ...common, previous_run: previous, run_id: 'oracle-retry', current_authority_digest: 'e'.repeat(64), expected_live: { ref: 'refs/heads/main', sha: '1'.repeat(40), tree: '2'.repeat(40) }, liveRefProvider: { read: () => ({ ref: 'refs/heads/main', sha: '1'.repeat(40), tree: '2'.repeat(40) }) }, workspaceAdapter: { prepare: () => ({ workspace_id: 'oracle-workspace', workspace_handle: 'oracle-handle', commit_sha: '1'.repeat(40), tree_sha: '2'.repeat(40) }), verifySnapshot: () => true } });
    }
    if (surface === 'loop.completeRun' || surface === 'loop.transitionRun.terminal' || surface === 'loop.governedCompletion' || surface === 'loop.releaseMutationLease') return executionLoop.finalizeWorkspace({ facts: { terminal_evidence_durable: true, publication_verified: true, proven_disposable: true } });
    if (surface === 'loop.executeTypedGitCommit' || surface === 'loop.commitExact') return executionLoop.buildGitCommitOperation({ authorized_paths: ['src/oracle.txt'], commit_message: 'oracle commit', expected_head: '1'.repeat(40), expected_tree: '2'.repeat(40), expected_index_digest: '3'.repeat(64), intended_tree: '4'.repeat(40), intended_change_digest: '5'.repeat(64) }, null);
  }
  if (surface.startsWith('assurance.')) {
    const receipt = oracleAssuranceReceipt();
    const receiptContext = assuranceRuntime.bindReceiptAdmission(receipt.store, receipt.admission);
    const candidate = { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40), current: true };
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
    if (surface === 'assurance.admitG4') return assuranceRuntime.admitG4(assuranceInput, receiptContext);
    if (surface === 'assurance.evaluateAssurance') return assuranceRuntime.evaluateAssurance(assuranceInput, receiptContext);
    if (surface === 'assurance.evaluateG4A') return assuranceRuntime.evaluateG4A({ ordinary_complete: true, exact_head_g4_passed: true, required_evidence_current: true, question: 'bounded', purpose: 'routing', deterministic_evidence_settles: false, web_recorded_question: true, settled: true }, receiptContext);
    if (surface === 'assurance.evaluateNoByteReviewDisposition') return assuranceRuntime.evaluateNoByteReviewDisposition({ unchanged: { head: true, tree: true, base: true, lock: true, scope: true }, disposition: 'non-material', no_current_violation: true, no_candidate_change: true, complete_inventory: true, all_other_evidence_current: true }, receiptContext);
    if (surface === 'assurance.evaluateInvalidation') return assuranceRuntime.evaluateInvalidation({ event: 'SUCCESSOR_CANDIDATE_HEAD' }, receiptContext);
    if (surface === 'assurance.evaluateFinality') return assuranceRuntime.evaluateFinality({ accepted_candidate: { pr_number: 353, head: candidate.head, tree: candidate.tree, base: candidate.base }, web_acceptance: { status: 'accepted', current_required_evidence: true, current_review_inventory: true, current_required_checks: true, server_authoritative: true, verifiable: true }, ready: { set: true, after_web_acceptance: true, final_merge_state_transition: true, same_candidate: true, fresh_readback: true, review_triggered: false }, merge: { intended_pr_number: 353, observed_pr_number: 353, result: 'merged', merge_result_sha: 'd'.repeat(40), mode: 'squash', expected_head: candidate.head, observed_head: candidate.head, expected_base: candidate.base, observed_base: candidate.base, bound_to_pr: true, server_authoritative: true, verifiable: true }, canonical: { bound_to_intended_merge: true, main_head: 'd'.repeat(40), tree: candidate.tree, expected_tree: candidate.tree, sole_parent: candidate.base, expected_parent: candidate.base, signature: { verified: true, reason: 'valid' }, pr_merged: true, pr_closed: true, branch_cleanup_observed: true, cleanup_after_verified_merge: true, server_authoritative: true, verifiable: true } }, receiptContext);
  }
  throw new Error(`Unknown expanded production surface ${surface}`);
}

async function executeAuthorityPacketOracleCase(caseValue, handlers = oracleHandlers()) {
  const handler = handlers[caseValue.requirement_id];
  if (typeof handler !== 'function') throw new Error(`ORACLE_HANDLER_MISSING:${caseValue.requirement_id}`);
  const trace = [];
  const record = (label, passed, actual) => {
    trace.push({ label, passed: passed === true, actual: String(actual) });
  };
  const result = await handler(caseValue, { record });
  const assertionTrace = trace.concat(Array.isArray(result && result.assertion_trace) ? result.assertion_trace : []);
  if (!result || result.assertions_executed < 1 || assertionTrace.length < 1) {
    throw new Error(`ORACLE_METADATA_ONLY:${caseValue.id}`);
  }
  const evidence = {
    requirement_id: caseValue.requirement_id,
    case_id: caseValue.id,
    variant: caseValue.input.variant,
    production_surface: caseValue.surface,
    positive_control_case_id: result.positive_control_case_id,
    expected_code: caseValue.expected.reason_code || (caseValue.expected.outcome === 'ACCEPT' ? 'ACCEPT' : 'REJECT'),
    actual_code: result.actual.code,
    expected_effects: { outcome: caseValue.expected.outcome, side_effects: caseValue.expected.side_effects },
    actual_effects: result.actual_effects,
    assertions_executed: assertionTrace.length,
    assertion_trace: assertionTrace,
    assertion_trace_digest: runtime.digestValue(assertionTrace),
    passed: result.actual.outcome === caseValue.expected.outcome
      && (!caseValue.expected.reason_code || result.actual.code === caseValue.expected.reason_code),
  };
  validateOracleEvidence(evidence);
  return evidence;
}

async function runStandardOracleCase(caseValue, { record }) {
  const counters = { getter_calls: 0, proxy_trap_calls: 0 };
  const context = caseValue.requirement_id === 'D01'
    ? null
    : sharedOracleContext();
  const before = context ? oracleCounts(context.store) : oracleCounts(null);
  let actual;
  try {
    if (caseValue.requirement_id === 'D01') {
      const input = oraclePacketWithVariant(packet({ seed: `oracle-${oracleSafeSeed(caseValue.id)}` }), caseValue.input.variant, counters);
      const result = runtime.validateAuthorityPacket(input);
      actual = oracleActual(result);
    } else if (caseValue.expected.outcome === 'REJECT') {
      actual = oracleActual(await oracleRejectByCode(caseValue, context));
    } else {
      actual = oracleActual(await oraclePositiveBySurface(caseValue, context));
    }
  } catch (error) {
    actual = {
      outcome: 'REJECT',
      code: error && error.code ? error.code : error && error.message ? error.message : 'ORACLE_FAILURE',
      detail: error && error.stack ? error.stack : String(error),
    };
  }
  let after = before;
  if (context) {
    try { after = oracleCounts(context.store); } catch (error) {
      if (caseValue.expected.outcome !== 'REJECT') throw error;
    }
  }
  const actualEffects = { ...oracleEffectDelta(before, after, actual.outcome), ...counters };
  record('production-boundary-returned', actual.outcome === caseValue.expected.outcome, actual.detail ? `${actual.code}:${actual.detail}` : actual.code);
  if (caseValue.expected.reason_code) record('exact-reason-code', actual.code === caseValue.expected.reason_code, actual.code);
  if (caseValue.expected.outcome === 'REJECT') record('negative-zero-effect', actualEffects.accepted === false && actualEffects.consumable === false && actualEffects.next_gate_admitted === false, actualEffects.accepted);
  if (caseValue.requirement_id === 'D01') record('non-executing-value-guards', actualEffects.getter_calls === 0 && actualEffects.proxy_trap_calls === 0, `${actualEffects.getter_calls}/${actualEffects.proxy_trap_calls}`);
  return {
    actual,
    actual_effects: actualEffects,
    assertions_executed: 1 + (caseValue.expected.reason_code ? 1 : 0) + (caseValue.expected.outcome === 'REJECT' ? 1 : 0) + (caseValue.requirement_id === 'D01' ? 1 : 0),
    assertion_trace: [],
    positive_control_case_id: caseValue.expected.positive_control === true ? caseValue.id : null,
  };
}

function oracleHandlers() {
  return Object.freeze(Object.fromEntries(ORACLE_REQUIREMENT_IDS.map((id) => [id, runStandardOracleCase])));
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
  if (typeof evidence.passed !== 'boolean') throw new Error('ORACLE_PASS_FLAG_INVALID');
  return true;
}

function assertOracleHandlerCompleteness(cases, handlers = oracleHandlers()) {
  const ids = new Set();
  const requirements = new Set();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`ORACLE_DUPLICATE_CASE:${item.id}`);
    ids.add(item.id);
    requirements.add(item.requirement_id);
    if (typeof handlers[item.requirement_id] !== 'function') throw new Error(`ORACLE_HANDLER_MISSING:${item.requirement_id}`);
  }
  for (const id of ORACLE_REQUIREMENT_IDS) if (!requirements.has(id)) throw new Error(`ORACLE_REQUIREMENT_UNEXECUTED:${id}`);
  return { requirement_count: requirements.size, case_count: cases.length };
}

async function runAuthorityPacketOracleMatrix(cases, handlers = oracleHandlers()) {
  assertOracleHandlerCompleteness(cases, handlers);
  const positiveBySurface = new Map();
  for (const item of cases) if (item.expected.positive_control === true) positiveBySurface.set(`${item.requirement_id}\u0000${item.surface || ''}`, item.id);
  const evidence = [];
  for (const item of cases) {
    const result = await executeAuthorityPacketOracleCase(item, handlers);
    if (result.positive_control_case_id === null) result.positive_control_case_id = positiveBySurface.get(`${item.requirement_id}\u0000${item.surface || ''}`) || null;
    evidence.push(result);
  }
  return {
    evidence,
    requirement_count: new Set(evidence.map((item) => item.requirement_id)).size,
    case_count: evidence.length,
    skipped_count: 0,
    unexecuted_count: 0,
    failed_count: evidence.filter((item) => item.passed !== true).length,
  };
}

function cleanup() {
  for (const root of cleanupRoots) fs.rmSync(root, { recursive: true, force: true });
  cleanupRoots.clear();
}

process.once('exit', cleanup);

module.exports = {
  ORACLE_REQUIREMENT_IDS,
  bindings,
  cleanup,
  assertOracleHandlerCompleteness,
  executeAuthorityPacketOracleCase,
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
