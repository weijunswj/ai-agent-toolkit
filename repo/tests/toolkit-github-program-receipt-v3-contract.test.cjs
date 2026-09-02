'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const cleanupRoots = new Set();

const digest = 'a'.repeat(64);
const EXPECTED_FINAL_V3_SCHEMA_FINGERPRINT = '503161c994e82fbd0d59f9fd6945be796acff31e75529db7e0f47eb0c0a73378';
const EXPECTED_PRODUCTION_V2_SCHEMA_FINGERPRINT = 'adc7b560ee06ac61a397a5df0a075685269c3bcc95daa400f10f936143807c17';

const HOLDER_ATTESTATION_KEYS = [
  'schema', 'attestation_id', 'algorithm', 'key_id', 'platform', 'repository',
  'parent_issue', 'child_issue', 'lock', 'allocation_id', 'allocation_digest',
  'run_id', 'run_digest', 'lease_id', 'fence_id', 'fence_sequence',
  'authority_digest', 'start_digest', 'broker_identity_digest', 'process_id_digest',
  'process_start_digest', 'boot_id_digest', 'pid_namespace_digest',
  'process_incarnation_digest', 'lease_issued_at', 'lease_expires_at',
  'attestation_digest', 'attestation_tag'
];

const PRE_RECOVERY_EVIDENCE_KEYS = [
  'schema', 'request_id', 'repository', 'parent_issue', 'child_issue', 'lock',
  'namespace_digest', 'old_allocation_id', 'old_run_id', 'old_allocation_digest',
  'old_run_digest', 'old_lease_id', 'old_fence_id', 'old_fence_sequence',
  'old_lease_issued_at', 'old_lease_expires_at', 'old_lease_tip_event_id',
  'old_lease_tip_event_digest', 'old_receipt_tip_id', 'old_receipt_tip_sequence',
  'old_receipt_tip_digest', 'old_receipt_chain_digest', 'zero_operation_count',
  'zero_operation_event_count', 'zero_operation_inventory_digest', 'authority_digest',
  'source_digest', 'start_digest', 'old_holder_classification',
  'old_holder_identity_digest', 'old_holder_attestation_digest', 'recovery_peer_platform',
  'recovery_peer_identity_digest', 'recovery_peer_process_incarnation_digest',
  'broker_identity_digest', 'broker_key_id', 'observed_at', 'authority_observed_at',
  'source_observed_at', 'start_observed_at', 'store_observed_at', 'holder_observed_at'
];

const RECOVERY_RECORD_KEYS = [
  'schema', 'recovery_record_id', 'request_id', 'namespace_digest',
  'old_allocation_id', 'old_run_id', 'old_lease_id', 'old_fence_id',
  'old_fence_sequence', 'pre_recovery_evidence', 'pre_recovery_evidence_digest',
  'terminal_receipt_id', 'terminal_receipt_digest', 'release_event_id',
  'release_event_digest', 'replacement_allocation_id', 'replacement_allocation_digest',
  'replacement_run_id', 'replacement_run_digest', 'replacement_lease_id',
  'replacement_fence_id', 'replacement_fence_sequence',
  'replacement_holder_attestation_id', 'replacement_holder_attestation_digest',
  'new_high_water', 'authority_digest', 'source_digest', 'start_digest',
  'committed_at', 'recovery_record_digest'
];

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
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, GPR_TEST_ROOT: root }
  });
  if (result.status !== 0) throw new Error(`Unable to secure test state root: ${result.stderr}`);
}

function stateRoot() {
  const parent = path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'github-program-receipt', 'tests');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(parent, 0o700);
  const root = fs.mkdtempSync(path.join(parent, 'v3-'));
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  secureWindowsDirectory(root);
  cleanupRoots.add(root);
  return root;
}

function options(root = stateRoot()) {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 240,
    child_issue: 359,
    stateRoot: root,
    repositoryRoot
  };
}

function authority(seed = 'v3') {
  return {
    child_comment_id: 5503102701,
    parent_comment_id: 5503104170,
    node_id: `IC_${seed}`,
    author_login: 'weijunswj',
    author_association: 'OWNER',
    body_digest: runtime.digestValue({ seed, kind: 'body' }),
    updated_at: '2026-09-02T01:00:00.000Z',
    update_identity_digest: runtime.digestValue({ seed, kind: 'update' }),
    scope_digest: runtime.digestValue({ seed, kind: 'scope' })
  };
}

function start() {
  return {
    base_sha: '1'.repeat(40),
    head_sha: '2'.repeat(40),
    tree_sha: '3'.repeat(40),
    status_digest: runtime.digestValue({ status: [] }),
    clean_worktree: true,
    ref: { detached: true, name: null }
  };
}

function readers(expectedAuthority, expectedStart) {
  return {
    now: '2026-09-02T01:10:00.000Z',
    readAuthority: async () => ({ authority: structuredClone(expectedAuthority), later_controlling_comments: [] }),
    readStart: async () => structuredClone(expectedStart)
  };
}

function nowIso() {
  return new Date().toISOString();
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function schemaRows(db) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
}

function schemaDigest(db) {
  return runtime.digestValue(schemaRows(db));
}

function migrationObservation(overrides = {}) {
  return {
    application_id: runtime.APPLICATION_ID,
    user_version: runtime.USER_VERSION,
    schema_fingerprint: runtime.expectedV2SchemaFingerprint(),
    namespace_verified: true,
    integrity_verified: true,
    foreign_keys_verified: true,
    historical_digests_verified: true,
    chain_verified: true,
    high_water_verified: true,
    unresolved_operation_count: 0,
    unexpired_unreleased_allocation_count: 0,
    observed_at: nowIso(),
    ...overrides
  };
}

function migrationObservationFromFixture(fixture) {
  const db = new DatabaseSync(fixture.store.databasePath, { readOnly: true });
  let runIds;
  let observation;
  try {
    const namespace = fixture.storeOptions;
    const metadata = db.prepare('SELECT * FROM metadata WHERE singleton = 1').get();
    const applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
    const userVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
    const integrity = db.prepare('PRAGMA integrity_check').all();
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    const highWater = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get();
    const maximumFence = db.prepare('SELECT COALESCE(MAX(fence_sequence), 0) AS value FROM allocations').get();
    const observedAt = nowIso();
    const unresolved = db.prepare(`
      SELECT COUNT(*) AS value
      FROM mutation_operations o
      JOIN mutation_operation_events e ON e.operation_id = o.operation_id
      WHERE e.sequence = (
        SELECT MAX(inner_event.sequence)
        FROM mutation_operation_events inner_event
        WHERE inner_event.operation_id = o.operation_id
      ) AND e.state IN ('IN_FLIGHT', 'UNKNOWN')
    `).get();
    const unreleased = db.prepare(`
      SELECT COUNT(*) AS value
      FROM allocations a
      WHERE a.expires_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM lease_events e
          WHERE e.allocation_id = a.allocation_id AND e.event_type = 'RELEASED'
        )
    `).get(observedAt);
    runIds = db.prepare('SELECT run_id FROM runs ORDER BY run_id').all();
    observation = migrationObservation({
      application_id: applicationId,
      user_version: userVersion,
      schema_fingerprint: schemaDigest(db),
      namespace_verified: Boolean(metadata
        && metadata.schema_id === 'toolkit.github-program.run-receipt.v1'
        && metadata.namespace_digest === runtime.namespaceDigest({
          repository: namespace.repository,
          parent_issue: namespace.parent_issue,
          child_issue: namespace.child_issue
        })
        && metadata.repository === namespace.repository
        && metadata.parent_issue === namespace.parent_issue
        && metadata.child_issue === namespace.child_issue),
      integrity_verified: integrity.length === 1 && integrity[0].integrity_check === 'ok',
      foreign_keys_verified: foreignKeys.length === 0,
      historical_digests_verified: true,
      chain_verified: true,
      high_water_verified: Boolean(highWater
        && Number(highWater.high_water) === Number(maximumFence.value)),
      unresolved_operation_count: Number(unresolved.value),
      unexpired_unreleased_allocation_count: Number(unreleased.value),
      observed_at: observedAt
    });
  } finally {
    db.close();
  }
  for (const row of runIds) fixture.store.readReceiptChain(row.run_id);
  return observation;
}

function validHolderAttestation(overrides = {}) {
  const value = {
    schema: 'toolkit.github-program.holder-attestation.v1',
    attestation_id: 'attestation-test',
    algorithm: 'HMAC-SHA-256',
    key_id: 'broker-key-v1',
    platform: 'linux',
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 240,
    child_issue: 359,
    lock: 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-003',
    allocation_id: 'allocation-test',
    allocation_digest: digest,
    run_id: 'run-test',
    run_digest: digest,
    lease_id: 'lease-test',
    fence_id: 'fence-test',
    fence_sequence: 1,
    authority_digest: digest,
    start_digest: digest,
    broker_identity_digest: digest,
    process_id_digest: digest,
    process_start_digest: digest,
    boot_id_digest: digest,
    pid_namespace_digest: digest,
    process_incarnation_digest: digest,
    lease_issued_at: '2026-09-02T01:00:00.000Z',
    lease_expires_at: '2026-09-02T02:00:00.000Z',
    attestation_digest: '',
    attestation_tag: digest,
    ...overrides
  };
  const payload = { ...value };
  delete payload.attestation_digest;
  value.attestation_digest = runtime.digestValue(payload);
  return value;
}

test('holder attestation contract requires broker-bound process-incarnation proof', () => {
  assert.equal(runtime.V3_USER_VERSION, 3);
  assert.doesNotThrow(() => runtime.validateHolderAttestation(validHolderAttestation()));
  assert.throws(() => runtime.validateHolderAttestation({
    ...validHolderAttestation(),
    process_incarnation_digest: undefined
  }), (error) => error && error.code === 'GPR_HOLDER_ATTESTATION_INVALID');
});

function validPreRecoveryEvidence(overrides = {}) {
  const value = {
    schema: 'toolkit.github-program.pre-recovery-evidence.v1',
    request_id: 'recovery-request-test',
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 240,
    child_issue: 359,
    lock: 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-003',
    namespace_digest: digest,
    old_allocation_id: 'allocation-old',
    old_run_id: 'run-old',
    old_allocation_digest: digest,
    old_run_digest: digest,
    old_lease_id: 'lease-old',
    old_fence_id: 'fence-old',
    old_fence_sequence: 1,
    old_lease_issued_at: '2026-09-02T01:00:00.000Z',
    old_lease_expires_at: '2026-09-02T02:00:00.000Z',
    old_lease_tip_event_id: 'event-old-tip',
    old_lease_tip_event_digest: digest,
    old_receipt_tip_id: digest,
    old_receipt_tip_sequence: 1,
    old_receipt_tip_digest: digest,
    old_receipt_chain_digest: digest,
    zero_operation_count: 0,
    zero_operation_event_count: 0,
    zero_operation_inventory_digest: runtime.ZERO_OPERATION_INVENTORY_DIGEST,
    authority_digest: digest,
    source_digest: digest,
    start_digest: digest,
    old_holder_classification: 'ORPHAN_NONADOPTABLE',
    old_holder_identity_digest: digest,
    old_holder_attestation_digest: digest,
    recovery_peer_platform: 'linux',
    recovery_peer_identity_digest: digest,
    recovery_peer_process_incarnation_digest: digest,
    broker_identity_digest: digest,
    broker_key_id: 'broker-key-v1',
    observed_at: '2026-09-02T02:10:00.000Z',
    authority_observed_at: '2026-09-02T02:01:00.000Z',
    source_observed_at: '2026-09-02T02:02:00.000Z',
    start_observed_at: '2026-09-02T02:03:00.000Z',
    store_observed_at: '2026-09-02T02:04:00.000Z',
    holder_observed_at: '2026-09-02T02:05:00.000Z',
    ...overrides
  };
  return value;
}

function validRecoveryRecord(overrides = {}) {
  const preEvidence = overrides.pre_recovery_evidence || validPreRecoveryEvidence();
  const value = {
    schema: 'toolkit.github-program.recovery-record.v1',
    recovery_record_id: 'recovery-record-test',
    request_id: preEvidence.request_id,
    namespace_digest: preEvidence.namespace_digest,
    old_allocation_id: 'allocation-old',
    old_run_id: 'run-old',
    old_lease_id: 'lease-old',
    old_fence_id: 'fence-old',
    old_fence_sequence: 1,
    pre_recovery_evidence: preEvidence,
    pre_recovery_evidence_digest: runtime.preRecoveryEvidenceDigest(preEvidence),
    terminal_receipt_id: digest,
    terminal_receipt_digest: digest,
    release_event_id: 'event-release',
    release_event_digest: digest,
    replacement_allocation_id: 'allocation-new',
    replacement_allocation_digest: digest,
    replacement_run_id: 'run-new',
    replacement_run_digest: digest,
    replacement_lease_id: 'lease-new',
    replacement_fence_id: 'fence-new',
    replacement_fence_sequence: 2,
    replacement_holder_attestation_id: 'attestation-new',
    replacement_holder_attestation_digest: digest,
    new_high_water: 2,
    authority_digest: digest,
    source_digest: digest,
    start_digest: digest,
    committed_at: '2026-09-02T02:20:00.000Z',
    ...overrides
  };
  if (!Object.hasOwn(overrides, 'pre_recovery_evidence_digest')) {
    value.pre_recovery_evidence_digest = runtime.preRecoveryEvidenceDigest(value.pre_recovery_evidence);
  }
  const payload = { ...value };
  delete payload.recovery_record_digest;
  value.recovery_record_digest = runtime.digestValue(payload);
  return value;
}

const V3_NAMESPACE = {
  repository: 'weijunswj/ai-agent-toolkit',
  parent_issue: 240,
  child_issue: 359
};

function graphStart(seed) {
  const nibble = (seed.charCodeAt(0) % 16).toString(16);
  return {
    ...start(),
    head_sha: nibble.repeat(40),
    status_digest: runtime.digestValue({ seed, status: [] }),
    ref: { detached: false, name: `feat/${seed}` }
  };
}

function durableGraph(seed, fenceSequence, lockId = `LOCK-${seed}`) {
  const graphAuthority = authority(`durable-${seed}`);
  const graphStartValue = graphStart(seed);
  const allocation = {
    allocation_id: `allocation-${seed}`,
    run_id: `run-${seed}`,
    lock_id: lockId,
    lease_id: `lease-${seed}`,
    fence_id: `fence-${seed}`,
    fence_sequence: fenceSequence,
    owner_instance_id: `owner-${seed}`,
    process_id: 1000 + fenceSequence,
    issued_at: `2026-09-02T01:${String(fenceSequence).padStart(2, '0')}:00.000Z`,
    expires_at: `2026-09-02T02:${String(fenceSequence).padStart(2, '0')}:00.000Z`,
    authority_json: runtime.canonicalSerialize(graphAuthority),
    start_json: runtime.canonicalSerialize(graphStartValue)
  };
  allocation.allocation_digest = runtime.digestValue({
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
    authority: graphAuthority,
    start: graphStartValue
  });
  const run = {
    run_id: allocation.run_id,
    allocation_id: allocation.allocation_id,
    lock: allocation.lock_id,
    authority_digest: runtime.digestValue(graphAuthority),
    start_digest: runtime.digestValue(graphStartValue)
  };
  run.run_digest = runtime.digestValue(run);
  return {
    seed,
    allocation,
    run,
    authority: graphAuthority,
    start: graphStartValue,
    authority_digest: run.authority_digest,
    start_digest: run.start_digest
  };
}

function insertDurableGraph(db, graph) {
  const row = graph.allocation;
  db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    row.allocation_id, row.run_id, row.lock_id, row.lease_id, row.fence_id,
    row.fence_sequence, row.owner_instance_id, row.process_id, row.issued_at,
    row.expires_at, row.authority_json, row.start_json, row.allocation_digest
  );
  db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run(
    graph.run.run_id, graph.run.allocation_id, graph.run.lock,
    graph.run.authority_digest, graph.run.start_digest, graph.run.run_digest
  );
}

function durableLeaseEvent(graph, eventType, eventId) {
  const event = {
    event_id: eventId,
    allocation_id: graph.allocation.allocation_id,
    event_type: eventType,
    fence_sequence: graph.allocation.fence_sequence,
    event_at: `2026-09-02T0${eventType === 'RELEASED' ? '3' : '2'}:${String(graph.allocation.fence_sequence).padStart(2, '0')}:30.000Z`,
    detail_digest: runtime.digestValue({ eventId, eventType, seed: graph.seed })
  };
  event.event_digest = runtime.digestValue(event);
  return event;
}

function insertLeaseEvent(db, event) {
  db.prepare('INSERT INTO lease_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    event.event_id, event.allocation_id, event.event_type, event.fence_sequence,
    event.event_at, event.detail_digest, event.event_digest
  );
}

function durableHolder(graph, suffix = graph.seed) {
  return validHolderAttestation({
    attestation_id: `attestation-${suffix}`,
    repository: V3_NAMESPACE.repository,
    parent_issue: V3_NAMESPACE.parent_issue,
    child_issue: V3_NAMESPACE.child_issue,
    lock: graph.allocation.lock_id,
    allocation_id: graph.allocation.allocation_id,
    allocation_digest: graph.allocation.allocation_digest,
    run_id: graph.run.run_id,
    run_digest: graph.run.run_digest,
    lease_id: graph.allocation.lease_id,
    fence_id: graph.allocation.fence_id,
    fence_sequence: graph.allocation.fence_sequence,
    authority_digest: graph.authority_digest,
    start_digest: graph.start_digest,
    broker_identity_digest: runtime.digestValue(`broker-${suffix}`),
    process_id_digest: runtime.digestValue(`process-${suffix}`),
    process_start_digest: runtime.digestValue(`process-start-${suffix}`),
    boot_id_digest: runtime.digestValue(`boot-${suffix}`),
    pid_namespace_digest: runtime.digestValue(`namespace-${suffix}`),
    process_incarnation_digest: runtime.digestValue(`incarnation-${suffix}`),
    lease_issued_at: graph.allocation.issued_at,
    lease_expires_at: graph.allocation.expires_at
  });
}

function insertHolder(db, holder) {
  db.prepare(`INSERT INTO holder_attestations (
    attestation_id, repository, parent_issue, child_issue, lock_id,
    allocation_id, allocation_digest, run_id, run_digest, lease_id, fence_id,
    fence_sequence, algorithm, key_id, platform, authority_digest, start_digest,
    broker_identity_digest, process_id_digest, process_start_digest, boot_id_digest,
    pid_namespace_digest, process_incarnation_digest, lease_issued_at,
    lease_expires_at, attestation_digest, attestation_tag
  ) VALUES (${Array(27).fill('?').join(', ')})`).run(
    holder.attestation_id, holder.repository, holder.parent_issue, holder.child_issue, holder.lock,
    holder.allocation_id, holder.allocation_digest, holder.run_id, holder.run_digest,
    holder.lease_id, holder.fence_id, holder.fence_sequence, holder.algorithm, holder.key_id,
    holder.platform, holder.authority_digest, holder.start_digest, holder.broker_identity_digest,
    holder.process_id_digest, holder.process_start_digest, holder.boot_id_digest,
    holder.pid_namespace_digest, holder.process_incarnation_digest, holder.lease_issued_at,
    holder.lease_expires_at, holder.attestation_digest, holder.attestation_tag
  );
}

function durableStartedReceipt(graph) {
  const receipt = {
    schema: 'toolkit.github-program.run-receipt.v1',
    receipt_type: 'RUN_STARTED',
    receipt_id: '',
    sequence: 1,
    prior_receipt_id: null,
    run_id: graph.run.run_id,
    allocation_id: graph.allocation.allocation_id,
    repository: V3_NAMESPACE.repository,
    parent_issue: V3_NAMESPACE.parent_issue,
    child_issue: V3_NAMESPACE.child_issue,
    lock: graph.allocation.lock_id,
    authority: graph.authority,
    start: graph.start,
    candidate: null,
    lease: {
      lease_id: graph.allocation.lease_id,
      fence_id: graph.allocation.fence_id,
      fence_sequence: graph.allocation.fence_sequence,
      issued_at: graph.allocation.issued_at,
      expires_at: graph.allocation.expires_at
    },
    payload: { classification: 'RUN_STARTED_VERIFIED' },
    created_at: graph.allocation.issued_at
  };
  const payload = structuredClone(receipt);
  delete payload.receipt_id;
  receipt.receipt_id = runtime.digestValue(payload);
  return receipt;
}

function insertReceipt(db, receipt) {
  return runtime.appendV3ReceiptWithChainDigest(db, receipt);
}

function durableTerminalReceipt(graph, prior, evidenceDigest) {
  const receipt = {
    ...prior,
    receipt_type: 'RUN_INTERRUPTED',
    receipt_id: '',
    sequence: 2,
    prior_receipt_id: prior.receipt_id,
    payload: {
      classification: 'ORPHAN_NONADOPTABLE',
      reason_code: 'BROKER_PROTECTED_RECOVERY',
      evidence_digest: evidenceDigest
    },
    created_at: `2026-09-02T03:${String(graph.allocation.fence_sequence).padStart(2, '0')}:00.000Z`
  };
  const payload = structuredClone(receipt);
  delete payload.receipt_id;
  receipt.receipt_id = runtime.digestValue(payload);
  return receipt;
}

function durablePreEvidence(oldGraph, oldHolder, oldLeaseTip, oldReceipt, requestId) {
  return validPreRecoveryEvidence({
    request_id: requestId,
    repository: V3_NAMESPACE.repository,
    parent_issue: V3_NAMESPACE.parent_issue,
    child_issue: V3_NAMESPACE.child_issue,
    lock: oldGraph.allocation.lock_id,
    namespace_digest: runtime.namespaceDigest(V3_NAMESPACE),
    old_allocation_id: oldGraph.allocation.allocation_id,
    old_run_id: oldGraph.run.run_id,
    old_allocation_digest: oldGraph.allocation.allocation_digest,
    old_run_digest: oldGraph.run.run_digest,
    old_lease_id: oldGraph.allocation.lease_id,
    old_fence_id: oldGraph.allocation.fence_id,
    old_fence_sequence: oldGraph.allocation.fence_sequence,
    old_lease_issued_at: oldGraph.allocation.issued_at,
    old_lease_expires_at: oldGraph.allocation.expires_at,
    old_lease_tip_event_id: oldLeaseTip.event_id,
    old_lease_tip_event_digest: oldLeaseTip.event_digest,
    old_receipt_tip_id: oldReceipt.receipt_id,
    old_receipt_tip_sequence: oldReceipt.sequence,
    old_receipt_tip_digest: oldReceipt.receipt_id,
    old_receipt_chain_digest: runtime.digestValue([oldReceipt]),
    authority_digest: oldGraph.authority_digest,
    source_digest: runtime.digestValue({ source: oldGraph.seed }),
    start_digest: oldGraph.start_digest,
    old_holder_identity_digest: oldHolder.process_incarnation_digest,
    old_holder_attestation_digest: oldHolder.attestation_digest,
    recovery_peer_identity_digest: runtime.digestValue({ peer: requestId }),
    recovery_peer_process_incarnation_digest: runtime.digestValue({ peer_incarnation: requestId }),
    broker_identity_digest: oldHolder.broker_identity_digest,
    observed_at: '2026-09-02T02:30:00.000Z',
    authority_observed_at: '2026-09-02T02:25:00.000Z',
    source_observed_at: '2026-09-02T02:26:00.000Z',
    start_observed_at: '2026-09-02T02:27:00.000Z',
    store_observed_at: '2026-09-02T02:28:00.000Z',
    holder_observed_at: '2026-09-02T02:29:00.000Z'
  });
}

function durableRecoveryRecord(oldGraph, replacementGraph, evidence, terminal, releaseEvent, replacementHolder, id) {
  return validRecoveryRecord({
    recovery_record_id: id,
    request_id: evidence.request_id,
    namespace_digest: runtime.namespaceDigest(V3_NAMESPACE),
    old_allocation_id: oldGraph.allocation.allocation_id,
    old_run_id: oldGraph.run.run_id,
    old_lease_id: oldGraph.allocation.lease_id,
    old_fence_id: oldGraph.allocation.fence_id,
    old_fence_sequence: oldGraph.allocation.fence_sequence,
    pre_recovery_evidence: evidence,
    pre_recovery_evidence_digest: runtime.preRecoveryEvidenceDigest(evidence),
    terminal_receipt_id: terminal.receipt_id,
    terminal_receipt_digest: terminal.receipt_id,
    release_event_id: releaseEvent.event_id,
    release_event_digest: releaseEvent.event_digest,
    replacement_allocation_id: replacementGraph.allocation.allocation_id,
    replacement_allocation_digest: replacementGraph.allocation.allocation_digest,
    replacement_run_id: replacementGraph.run.run_id,
    replacement_run_digest: replacementGraph.run.run_digest,
    replacement_lease_id: replacementGraph.allocation.lease_id,
    replacement_fence_id: replacementGraph.allocation.fence_id,
    replacement_fence_sequence: replacementGraph.allocation.fence_sequence,
    replacement_holder_attestation_id: replacementHolder.attestation_id,
    replacement_holder_attestation_digest: replacementHolder.attestation_digest,
    new_high_water: replacementGraph.allocation.fence_sequence,
    authority_digest: oldGraph.authority_digest,
    source_digest: evidence.source_digest,
    start_digest: oldGraph.start_digest,
    committed_at: '2026-09-02T04:00:00.000Z'
  });
}

function insertRecoveryRecord(db, record) {
  db.prepare(`INSERT INTO recovery_records (
    recovery_record_id, recovery_record_digest, request_id, namespace_digest,
    old_allocation_id, old_run_id, old_lease_id, old_fence_id, old_fence_sequence,
    pre_recovery_evidence_json, pre_recovery_evidence_digest, terminal_receipt_id,
    terminal_receipt_digest, release_event_id, release_event_digest,
    replacement_allocation_id, replacement_allocation_digest, replacement_run_id,
    replacement_run_digest, replacement_lease_id, replacement_fence_id,
    replacement_fence_sequence, replacement_holder_attestation_id,
    replacement_holder_attestation_digest, new_high_water, authority_digest,
    source_digest, start_digest, committed_at
  ) VALUES (${Array(29).fill('?').join(', ')})`).run(
    record.recovery_record_id, record.recovery_record_digest, record.request_id,
    record.namespace_digest, record.old_allocation_id, record.old_run_id,
    record.old_lease_id, record.old_fence_id, record.old_fence_sequence,
    runtime.canonicalSerialize(record.pre_recovery_evidence), record.pre_recovery_evidence_digest,
    record.terminal_receipt_id, record.terminal_receipt_digest, record.release_event_id,
    record.release_event_digest, record.replacement_allocation_id,
    record.replacement_allocation_digest, record.replacement_run_id,
    record.replacement_run_digest, record.replacement_lease_id, record.replacement_fence_id,
    record.replacement_fence_sequence, record.replacement_holder_attestation_id,
    record.replacement_holder_attestation_digest, record.new_high_water,
    record.authority_digest, record.source_digest, record.start_digest, record.committed_at
  );
}

function v3Database(databasePath = ':memory:') {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(runtime.buildFinalV3SchemaSql());
  db.exec(`PRAGMA application_id=${runtime.APPLICATION_ID}`);
  db.exec(`PRAGMA user_version=${runtime.V3_USER_VERSION}`);
  db.prepare('INSERT INTO metadata VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(
    runtime.SCHEMA_ID, runtime.namespaceDigest(V3_NAMESPACE), V3_NAMESPACE.repository,
    V3_NAMESPACE.parent_issue, V3_NAMESPACE.child_issue,
    runtime.expectedFinalV3SchemaFingerprint(), '2026-09-02T00:00:00.000Z'
  );
  db.prepare('INSERT INTO coordination_state VALUES (1, 0)').run();
  return db;
}

function v3HolderFixture() {
  const db = v3Database();
  const first = durableGraph('holder-a', 1);
  const second = durableGraph('holder-b', 2);
  insertDurableGraph(db, first);
  insertDurableGraph(db, second);
  db.prepare('UPDATE coordination_state SET high_water=1 WHERE singleton=1 AND high_water=0').run();
  db.prepare('UPDATE coordination_state SET high_water=2 WHERE singleton=1 AND high_water=1').run();
  return { db, first, second };
}

function v3RecoveryFixture(databasePath = ':memory:') {
  const db = v3Database(databasePath);
  const oldA = durableGraph('recovery-old-a', 1);
  const oldB = durableGraph('recovery-old-b', 3);
  const replacementA = durableGraph('recovery-new-a', 2, oldA.allocation.lock_id);
  const replacementB = durableGraph('recovery-new-b', 4, oldB.allocation.lock_id);
  const oldAHolder = durableHolder(oldA);
  const replacementAHolder = durableHolder(replacementA);
  const oldBHolder = durableHolder(oldB);
  const replacementBHolder = durableHolder(replacementB);
  const oldAStart = durableStartedReceipt(oldA);
  const oldBStart = durableStartedReceipt(oldB);
  const replacementAStart = durableStartedReceipt(replacementA);
  const replacementBStart = durableStartedReceipt(replacementB);
  const oldAAllocated = durableLeaseEvent(oldA, 'ALLOCATED', 'event-recovery-old-a-allocated');
  const oldBAllocated = durableLeaseEvent(oldB, 'ALLOCATED', 'event-recovery-old-b-allocated');
  const replacementAAllocated = durableLeaseEvent(replacementA, 'EXPIRED_TAKEOVER', 'event-recovery-new-a-allocated');
  const replacementBAllocated = durableLeaseEvent(replacementB, 'EXPIRED_TAKEOVER', 'event-recovery-new-b-allocated');
  const oldARelease = durableLeaseEvent(oldA, 'RELEASED', 'event-recovery-old-a-release');
  const oldBRelease = durableLeaseEvent(oldB, 'RELEASED', 'event-recovery-old-b-release');
  const evidenceA = durablePreEvidence(oldA, oldAHolder, oldAAllocated, oldAStart, 'recovery-request-a');
  const evidenceB = durablePreEvidence(oldB, oldBHolder, oldBAllocated, oldBStart, 'recovery-request-b');
  const terminalA = durableTerminalReceipt(oldA, oldAStart, runtime.preRecoveryEvidenceDigest(evidenceA));
  const terminalB = durableTerminalReceipt(oldB, oldBStart, runtime.preRecoveryEvidenceDigest(evidenceB));
  const recordA = durableRecoveryRecord(oldA, replacementA, evidenceA, terminalA, oldARelease, replacementAHolder, 'recovery-record-a');
  const recordB = durableRecoveryRecord(oldB, replacementB, evidenceB, terminalB, oldBRelease, replacementBHolder, 'recovery-record-b');

  for (const graph of [oldA, replacementA]) insertDurableGraph(db, graph);
  for (const highWater of [1, 2]) {
    db.prepare('UPDATE coordination_state SET high_water=? WHERE singleton=1 AND high_water=?').run(highWater, highWater - 1);
  }
  for (const holder of [oldAHolder, replacementAHolder]) insertHolder(db, holder);
  for (const receipt of [oldAStart, replacementAStart]) insertReceipt(db, receipt);
  for (const event of [oldAAllocated, replacementAAllocated, oldARelease]) insertLeaseEvent(db, event);
  insertReceipt(db, terminalA);
  insertRecoveryRecord(db, recordA);

  for (const graph of [oldB, replacementB]) insertDurableGraph(db, graph);
  for (const highWater of [3, 4]) {
    db.prepare('UPDATE coordination_state SET high_water=? WHERE singleton=1 AND high_water=?').run(highWater, highWater - 1);
  }
  for (const holder of [oldBHolder, replacementBHolder]) insertHolder(db, holder);
  for (const receipt of [oldBStart, replacementBStart]) insertReceipt(db, receipt);
  for (const event of [oldBAllocated, replacementBAllocated, oldBRelease]) insertLeaseEvent(db, event);
  insertReceipt(db, terminalB);
  insertRecoveryRecord(db, recordB);
  return {
    db, oldA, replacementA, oldB, replacementB,
    oldAHolder, replacementAHolder, oldBHolder, replacementBHolder,
    oldAStart, replacementAStart, oldBStart, replacementBStart,
    oldAAllocated, oldBAllocated, oldARelease, oldBRelease,
    terminalA, terminalB, evidenceA, evidenceB, recordA, recordB
  };
}

function resignedRecoveryRecord(record, overrides = {}, id = 'recovery-negative') {
  const result = structuredClone(record);
  Object.assign(result, overrides);
  if (overrides.pre_recovery_evidence) {
    result.pre_recovery_evidence_digest = runtime.digestValue(result.pre_recovery_evidence);
  }
  result.recovery_record_id = id;
  delete result.recovery_record_digest;
  result.recovery_record_digest = runtime.digestValue(result);
  return result;
}

test('v3 persistence accepts a coherent holder and independent verifier readback', () => {
  const { db, first } = v3HolderFixture();
  try {
    assert.doesNotThrow(() => insertHolder(db, durableHolder(first)));
    assert.equal(runtime.verifyV3DurableEvidence(db, V3_NAMESPACE), true);
    assert.equal(runtime.verifyFinalV3Database(db, V3_NAMESPACE), true);
  } finally {
    db.close();
  }
});

test('v3 holder persistence rejects canonical-graph cross-mixes despite clean foreign-key validation', () => {
  const cases = [
    ['allocation A plus run B', (first, second) => ({
      run_id: second.run.run_id,
      run_digest: second.run.run_digest,
      lease_id: second.allocation.lease_id,
      fence_id: second.allocation.fence_id,
      fence_sequence: second.allocation.fence_sequence
    })],
    ['wrong allocation digest', (first, second) => ({ allocation_digest: second.allocation.allocation_digest })],
    ['wrong run digest', (first, second) => ({ run_digest: second.run.run_digest })],
    ['run not belonging to allocation', (first, second) => ({ run_id: second.run.run_id })],
    ['wrong lease', (first, second) => ({ lease_id: second.allocation.lease_id })],
    ['wrong fence', (first, second) => ({ fence_id: second.allocation.fence_id })],
    ['wrong fence sequence', (first, second) => ({ fence_sequence: second.allocation.fence_sequence })],
    ['wrong Lock', (first, second) => ({ lock: second.allocation.lock_id })],
    ['wrong authority digest', (first, second) => ({ authority_digest: second.authority_digest })],
    ['wrong start digest', (first, second) => ({ start_digest: second.start_digest })],
    ['wrong lease issued timestamp', (first, second) => ({ lease_issued_at: second.allocation.issued_at })],
    ['wrong lease expiry timestamp', (first, second) => ({ lease_expires_at: second.allocation.expires_at })],
    ['wrong repository namespace', () => ({ repository: 'other/repository' })],
    ['wrong Parent namespace', () => ({ parent_issue: 241 })],
    ['wrong Child namespace', () => ({ child_issue: 360 })],
    ['arbitrary digest-shaped substitution', () => ({ allocation_digest: 'f'.repeat(64) })]
  ];
  assert.equal(cases.length, 16);
  for (const [name, mutate] of cases) {
    const { db, first, second } = v3HolderFixture();
    try {
      const holder = durableHolder(first, `holder-negative-${name.replace(/\W+/g, '-')}`);
      Object.assign(holder, mutate(first, second));
      const payload = { ...holder };
      delete payload.attestation_digest;
      holder.attestation_digest = runtime.digestValue(payload);
      assert.ok(db.prepare('SELECT 1 FROM allocations WHERE allocation_id=?').get(first.allocation.allocation_id));
      assert.ok(db.prepare('SELECT 1 FROM runs WHERE run_id=?').get(second.run.run_id));
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, name);
      assert.throws(() => insertHolder(db, holder), /GPR_V3_HOLDER_COHERENCE/, name);
    } finally {
      db.close();
    }
  }
});

test('v3 persistence accepts coherent recovery chains and independent verifier readback', () => {
  const fixture = v3RecoveryFixture();
  try {
    assert.equal(runtime.verifyV3DurableEvidence(fixture.db, V3_NAMESPACE), true);
    assert.equal(runtime.verifyFinalV3Database(fixture.db, V3_NAMESPACE), true);
  } finally {
    fixture.db.close();
  }
});

test('v3 recovery persistence rejects cross-mixed old/replacement evidence with clean foreign-key validation', () => {
  const fixture = v3RecoveryFixture();
  try {
    const cases = [
      ['old allocation A plus old run B', {
        old_allocation_id: fixture.oldB.allocation.allocation_id,
        old_run_id: fixture.oldA.run.run_id,
        old_lease_id: fixture.oldB.allocation.lease_id,
        old_fence_id: fixture.oldB.allocation.fence_id,
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          old_allocation_id: fixture.oldB.allocation.allocation_id,
          old_run_id: fixture.oldA.run.run_id
        }
      }],
      ['wrong old allocation digest', {
        pre_recovery_evidence: { ...fixture.evidenceA, old_allocation_digest: fixture.oldB.allocation.allocation_digest }
      }],
      ['wrong old run digest', {
        pre_recovery_evidence: { ...fixture.evidenceA, old_run_digest: fixture.oldB.run.run_digest }
      }],
      ['old lease binding mismatch', {
        old_lease_id: fixture.oldB.allocation.lease_id,
        pre_recovery_evidence: { ...fixture.evidenceA, old_lease_id: fixture.oldB.allocation.lease_id }
      }],
      ['old fence binding mismatch', {
        old_fence_id: fixture.oldB.allocation.fence_id,
        pre_recovery_evidence: { ...fixture.evidenceA, old_fence_id: fixture.oldB.allocation.fence_id }
      }],
      ['old fence sequence mismatch', {
        old_fence_sequence: 2,
        replacement_fence_sequence: 3,
        new_high_water: 3,
        pre_recovery_evidence: { ...fixture.evidenceA, old_fence_sequence: 2 }
      }],
      ['old lease issued timestamp mismatch', {
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          old_lease_issued_at: fixture.oldB.allocation.issued_at
        }
      }],
      ['old lease expiry timestamp mismatch', {
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          old_lease_expires_at: fixture.oldB.allocation.expires_at
        }
      }],
      ['old authority binding mismatch', {
        authority_digest: runtime.digestValue('wrong-authority'),
        pre_recovery_evidence: { ...fixture.evidenceA, authority_digest: runtime.digestValue('wrong-authority') }
      }],
      ['old start binding mismatch', {
        start_digest: runtime.digestValue('wrong-start'),
        pre_recovery_evidence: { ...fixture.evidenceA, start_digest: runtime.digestValue('wrong-start') }
      }],
      ['wrong PRE repository namespace', {
        pre_recovery_evidence: { ...fixture.evidenceA, repository: 'other/repository' }
      }],
      ['wrong PRE Parent namespace', {
        pre_recovery_evidence: { ...fixture.evidenceA, parent_issue: 241 }
      }],
      ['wrong PRE Child namespace', {
        pre_recovery_evidence: { ...fixture.evidenceA, child_issue: 360 }
      }],
      ['wrong recovery namespace digest', {
        namespace_digest: runtime.namespaceDigest({
          repository: 'other/repository',
          parent_issue: 240,
          child_issue: 359
        }),
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          namespace_digest: runtime.namespaceDigest({
            repository: 'other/repository',
            parent_issue: 240,
            child_issue: 359
          })
        }
      }],
      ['nonzero operation claim', {
        pre_recovery_evidence: { ...fixture.evidenceA, zero_operation_count: 1 }
      }],
      ['old lease tip from another allocation', {
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          old_lease_tip_event_id: fixture.oldBAllocated.event_id,
          old_lease_tip_event_digest: fixture.oldBAllocated.event_digest
        }
      }],
      ['old receipt tip from another run', {
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          old_receipt_tip_id: fixture.oldBStart.receipt_id,
          old_receipt_tip_digest: fixture.oldBStart.receipt_id,
          old_receipt_chain_digest: runtime.digestValue([fixture.oldBStart])
        }
      }],
      ['old holder attestation from another allocation', {
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          old_holder_attestation_digest: fixture.oldBHolder.attestation_digest
        }
      }],
      ['old broker identity from another holder', {
        pre_recovery_evidence: {
          ...fixture.evidenceA,
          broker_identity_digest: fixture.oldBHolder.broker_identity_digest
        }
      }],
      ['old broker key mismatch', {
        pre_recovery_evidence: { ...fixture.evidenceA, broker_key_id: 'broker-key-other' }
      }],
      ['terminal receipt from another run', {
        terminal_receipt_id: fixture.terminalB.receipt_id,
        terminal_receipt_digest: fixture.terminalB.receipt_id
      }],
      ['wrong terminal receipt digest', {
        terminal_receipt_digest: runtime.digestValue('wrong-terminal')
      }],
      ['terminal evidence from another PRE', {
        terminal_receipt_id: fixture.terminalB.receipt_id,
        terminal_receipt_digest: fixture.terminalB.receipt_id,
        pre_recovery_evidence: fixture.evidenceA
      }],
      ['release event from another allocation', {
        release_event_id: fixture.oldBRelease.event_id,
        release_event_digest: fixture.oldBRelease.event_digest
      }],
      ['wrong release event digest', { release_event_digest: runtime.digestValue('wrong-release') }],
      ['replacement allocation A plus replacement run B', {
        replacement_allocation_id: fixture.replacementB.allocation.allocation_id,
        replacement_run_id: fixture.replacementA.run.run_id,
        replacement_lease_id: fixture.replacementB.allocation.lease_id,
        replacement_fence_id: fixture.replacementB.allocation.fence_id,
        replacement_holder_attestation_id: fixture.replacementBHolder.attestation_id,
        replacement_holder_attestation_digest: fixture.replacementBHolder.attestation_digest
      }],
      ['wrong replacement allocation digest', {
        replacement_allocation_digest: fixture.replacementB.allocation.allocation_digest
      }],
      ['arbitrary replacement digest-shaped substitution', {
        replacement_allocation_digest: 'f'.repeat(64)
      }],
      ['wrong replacement run digest', { replacement_run_digest: fixture.replacementB.run.run_digest }],
      ['replacement lease/fence mismatch', {
        replacement_lease_id: fixture.replacementB.allocation.lease_id,
        replacement_fence_id: fixture.replacementB.allocation.fence_id
      }],
      ['replacement holder from another graph', {
        replacement_holder_attestation_id: fixture.replacementBHolder.attestation_id,
        replacement_holder_attestation_digest: fixture.replacementBHolder.attestation_digest
      }],
      ['wrong replacement holder digest', { replacement_holder_attestation_digest: runtime.digestValue('wrong-holder') }],
      ['replacement fence is not N plus one', { replacement_fence_sequence: 3, new_high_water: 3 }],
      ['coordination high-water mismatch', {}]
    ];
    assert.equal(cases.length, 34);
    for (const [name, overrides] of cases) {
      const candidate = resignedRecoveryRecord(fixture.recordA, overrides, `recovery-negative-${name.replace(/\W+/g, '-')}`);
      if (candidate.new_high_water !== candidate.replacement_fence_sequence) {
        assert.throws(() => insertRecoveryRecord(fixture.db, candidate), /CHECK constraint/, name);
        continue;
      }
      assert.ok(fixture.db.prepare('SELECT 1 FROM receipts WHERE receipt_id=?').get(candidate.terminal_receipt_id));
      assert.ok(fixture.db.prepare('SELECT 1 FROM lease_events WHERE event_id=?').get(candidate.release_event_id));
      assert.equal(fixture.db.prepare('PRAGMA foreign_key_check').all().length, 0, name);
      assert.throws(() => insertRecoveryRecord(fixture.db, candidate),
        /GPR_V3_RECOVERY_COHERENCE|CHECK constraint|FOREIGN KEY constraint/, name);
    }
  } finally {
    fixture.db.close();
  }
});

test('v3 final database independently reopens and rejects canonical tampering', () => {
  const root = stateRoot();
  const databasePath = path.join(root, 'v3.sqlite');
  const fixture = v3RecoveryFixture(databasePath);
  fixture.db.close();

  const reopened = new DatabaseSync(databasePath);
  try {
    assert.equal(runtime.verifyFinalV3Database(reopened, V3_NAMESPACE, databasePath), true);
  } finally {
    reopened.close();
  }

  const tamper = structuredClone(fixture.recordA);
  tamper.replacement_run_id = fixture.replacementB.run.run_id;
  delete tamper.recovery_record_digest;
  tamper.recovery_record_digest = runtime.digestValue(tamper);
  const tamperDb = new DatabaseSync(databasePath);
  try {
    tamperDb.exec('DROP TRIGGER recovery_records_no_update');
    tamperDb.prepare('UPDATE recovery_records SET replacement_run_id=?, recovery_record_digest=? WHERE recovery_record_id=?')
      .run(tamper.replacement_run_id, tamper.recovery_record_digest, fixture.recordA.recovery_record_id);
    tamperDb.exec("CREATE TRIGGER recovery_records_no_update BEFORE UPDATE ON recovery_records BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
  } finally {
    tamperDb.close();
  }

  const readback = new DatabaseSync(databasePath);
  try {
    assertCode(() => runtime.verifyFinalV3Database(readback, V3_NAMESPACE, databasePath), 'GPR_V3_RECOVERY_COHERENCE');
  } finally {
    readback.close();
  }
});

test('v3 independent verifier rejects a holder cross-mix after append-only bypass', () => {
  const { db, first, second } = v3HolderFixture();
  try {
    const holder = durableHolder(first, 'holder-readback');
    insertHolder(db, holder);
    assert.equal(runtime.verifyV3DurableEvidence(db, V3_NAMESPACE), true);

    const tampered = structuredClone(holder);
    tampered.allocation_digest = second.allocation.allocation_digest;
    const payload = { ...tampered };
    delete payload.attestation_digest;
    tampered.attestation_digest = runtime.digestValue(payload);
    db.exec('DROP TRIGGER holder_attestations_no_update');
    db.prepare('UPDATE holder_attestations SET allocation_digest=?, attestation_digest=? WHERE attestation_id=?')
      .run(tampered.allocation_digest, tampered.attestation_digest, holder.attestation_id);
    db.exec("CREATE TRIGGER holder_attestations_no_update BEFORE UPDATE ON holder_attestations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    assertCode(() => runtime.verifyV3DurableEvidence(db, V3_NAMESPACE), 'GPR_V3_HOLDER_COHERENCE');
  } finally {
    db.close();
  }
});

test('v3 independent verifier rejects a run cross-mix after append-only bypass', () => {
  const db = v3Database();
  const first = durableGraph('run-a', 1);
  const second = durableGraph('run-b', 2);
  insertDurableGraph(db, first);
  const row = second.allocation;
  db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    row.allocation_id, row.run_id, row.lock_id, row.lease_id, row.fence_id,
    row.fence_sequence, row.owner_instance_id, row.process_id, row.issued_at,
    row.expires_at, row.authority_json, row.start_json, row.allocation_digest
  );
  db.prepare('UPDATE coordination_state SET high_water=1 WHERE singleton=1 AND high_water=0').run();
  db.prepare('UPDATE coordination_state SET high_water=2 WHERE singleton=1 AND high_water=1').run();
  try {
    const tampered = {
      ...first.run,
      allocation_id: second.allocation.allocation_id,
      lock: second.allocation.lock_id,
      authority_digest: second.authority_digest,
      start_digest: second.start_digest
    };
    delete tampered.run_digest;
    tampered.run_digest = runtime.digestValue(tampered);
    db.exec('DROP TRIGGER runs_no_update');
    db.prepare('UPDATE runs SET allocation_id=?, lock_id=?, authority_digest=?, start_digest=?, run_digest=? WHERE run_id=?')
      .run(tampered.allocation_id, tampered.lock, tampered.authority_digest, tampered.start_digest,
        tampered.run_digest, first.run.run_id);
    db.exec("CREATE TRIGGER runs_no_update BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assertCode(() => runtime.verifyFinalV3Database(db, V3_NAMESPACE), 'GPR_V3_RECOVERY_COHERENCE');
  } finally {
    db.close();
  }
});

test('v3 independent verifier rejects holder tag tampering after append-only bypass', () => {
  const { db, first } = v3HolderFixture();
  try {
    const holder = durableHolder(first, 'holder-tag');
    insertHolder(db, holder);
    db.exec('DROP TRIGGER holder_attestations_no_update');
    db.prepare('UPDATE holder_attestations SET attestation_tag=? WHERE attestation_id=?')
      .run('b'.repeat(64), holder.attestation_id);
    db.exec("CREATE TRIGGER holder_attestations_no_update BEFORE UPDATE ON holder_attestations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    assertCode(() => runtime.verifyFinalV3Database(db, V3_NAMESPACE), 'GPR_V3_HOLDER_COHERENCE');
  } finally {
    db.close();
  }
});

test('durable evidence shapes use the full accepted key sets', () => {
  const holder = validHolderAttestation();
  const preEvidence = validPreRecoveryEvidence();
  const recovery = validRecoveryRecord();
  for (const [name, value, expected] of [
    ['holder attestation', holder, HOLDER_ATTESTATION_KEYS],
    ['pre-recovery evidence', preEvidence, PRE_RECOVERY_EVIDENCE_KEYS],
    ['recovery record', recovery, RECOVERY_RECORD_KEYS]
  ]) {
    const missing = expected.filter((key) => !Object.hasOwn(value, key));
    const unexpected = Object.keys(value).filter((key) => !expected.includes(key));
    assert.deepEqual({ missing, unexpected }, { missing: [], unexpected: [] },
      `${name} missing or under-bound fields`);
  }
});

test('durable evidence validators reject omission of required bindings', () => {
  for (const field of ['allocation_digest', 'run_digest', 'broker_identity_digest']) {
    const holder = validHolderAttestation();
    delete holder[field];
    assertCode(() => runtime.validateHolderAttestation(holder), 'GPR_HOLDER_ATTESTATION_INVALID');
  }
  for (const field of [
    'request_id', 'old_allocation_digest', 'old_run_digest', 'old_receipt_chain_digest',
    'zero_operation_inventory_digest', 'source_digest', 'old_holder_identity_digest',
    'old_holder_attestation_digest', 'broker_identity_digest', 'recovery_peer_identity_digest',
    'recovery_peer_process_incarnation_digest'
  ]) {
    const evidence = validPreRecoveryEvidence();
    delete evidence[field];
    assertCode(() => runtime.validatePreRecoveryEvidence(evidence), 'GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  }
  for (const field of [
    'request_id', 'pre_recovery_evidence', 'terminal_receipt_digest', 'release_event_digest',
    'replacement_allocation_digest', 'replacement_run_digest',
    'replacement_holder_attestation_id', 'replacement_holder_attestation_digest',
    'new_high_water', 'source_digest', 'start_digest', 'committed_at'
  ]) {
    const record = validRecoveryRecord();
    delete record[field];
    assertCode(() => runtime.validateRecoveryRecord(record), 'GPR_RECOVERY_RECORD_INVALID');
  }
});

test('every pre-recovery field is covered by the separate evidence digest', () => {
  const evidence = validPreRecoveryEvidence();
  const original = runtime.preRecoveryEvidenceDigest(evidence);
  for (const key of PRE_RECOVERY_EVIDENCE_KEYS) {
    const changed = structuredClone(evidence);
    changed[key] = typeof changed[key] === 'number' ? changed[key] + 1 : `${changed[key]}-changed`;
    assert.notEqual(runtime.digestValue(changed), original, key);
  }
});

test('pre-recovery and recovery contracts are exact, acyclic, and digest-bound', () => {
  const evidence = validPreRecoveryEvidence();
  const record = validRecoveryRecord({ pre_recovery_evidence_digest: runtime.preRecoveryEvidenceDigest(evidence) });
  assert.doesNotThrow(() => runtime.validatePreRecoveryEvidence(evidence));
  assert.doesNotThrow(() => runtime.validateRecoveryRecord(record));
  for (const excluded of [
    'evidence_digest', 'terminal_receipt_id', 'terminal_receipt_digest',
    'release_event_id', 'release_event_digest', 'replacement_allocation_id',
    'replacement_run_id', 'recovery_record_id', 'recovery_record_digest'
  ]) assert.equal(Object.hasOwn(evidence, excluded), false, excluded);
  assert.equal(runtime.preRecoveryEvidenceDigest(evidence), runtime.digestValue(evidence));
  assertCode(() => runtime.validatePreRecoveryEvidence({ ...evidence, observed_at: '2026-09-02T01:11:00.000Z' }),
    'GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  assertCode(() => runtime.validateRecoveryRecord({ ...record, replacement_fence_sequence: 3 }),
    'GPR_RECOVERY_RECORD_INVALID');
  assertCode(() => runtime.validateRecoveryRecord({ ...record, new_high_water: 3 }),
    'GPR_RECOVERY_RECORD_INVALID');
  assert.equal(Object.isFrozen(runtime.validateRecoveryRecord(record)), true);
  assert.equal(Object.isFrozen(runtime.validateRecoveryRecord(record).pre_recovery_evidence), true);
});

test('recovery record retains immutable pre-evidence and rejects digest mismatch', () => {
  const evidence = validPreRecoveryEvidence();
  const record = validRecoveryRecord({ pre_recovery_evidence: evidence });
  const validated = runtime.validateRecoveryRecord(record);
  assert.deepEqual(validated.pre_recovery_evidence, evidence);
  assert.equal(validated.pre_recovery_evidence_digest, runtime.preRecoveryEvidenceDigest(evidence));
  assertCode(() => runtime.validateRecoveryRecord({
    ...record,
    pre_recovery_evidence_digest: 'b'.repeat(64)
  }), 'GPR_RECOVERY_RECORD_INVALID');
  const mismatchedReceipt = { ...record, terminal_receipt_digest: 'b'.repeat(64) };
  delete mismatchedReceipt.recovery_record_digest;
  mismatchedReceipt.recovery_record_digest = runtime.digestValue(mismatchedReceipt);
  assertCode(() => runtime.validateRecoveryRecord(mismatchedReceipt), 'GPR_RECOVERY_RECORD_INVALID');
});

test('recovery record digest covers every field except itself and has no cycle', () => {
  const record = validRecoveryRecord();
  const digestInput = structuredClone(record);
  delete digestInput.recovery_record_digest;
  assert.equal(record.recovery_record_digest, runtime.digestValue(digestInput));
  for (const key of RECOVERY_RECORD_KEYS.filter((item) => item !== 'recovery_record_digest')) {
    const changed = structuredClone(record);
    if (key === 'pre_recovery_evidence') changed[key].source_digest = 'b'.repeat(64);
    else if (typeof changed[key] === 'number') changed[key] += 1;
    else changed[key] = `${changed[key]}-changed`;
    delete changed.recovery_record_digest;
    assert.notEqual(runtime.digestValue(changed), record.recovery_record_digest, key);
  }
  assert.equal(Object.hasOwn(record.pre_recovery_evidence, 'recovery_record_id'), false);
  assert.equal(Object.hasOwn(record.pre_recovery_evidence, 'recovery_record_digest'), false);
  assert.equal(Object.hasOwn(record.pre_recovery_evidence, 'evidence_digest'), false);
  assert.equal(Object.hasOwn(record, 'terminal_receipt_id'), true);
  assert.equal(Object.hasOwn(record, 'replacement_allocation_id'), true);
});

test('reserved broker orphan semantics use RUN_INTERRUPTED without changing receipt types', () => {
  assert.equal(runtime.RECEIPT_TYPES.includes('ORPHAN_NONADOPTABLE'), false);
  assert.deepEqual(runtime.validateReservedOrphanPayload({
    classification: 'ORPHAN_NONADOPTABLE',
    reason_code: 'BROKER_PROTECTED_RECOVERY',
    evidence_digest: digest
  }), {
    classification: 'ORPHAN_NONADOPTABLE',
    reason_code: 'BROKER_PROTECTED_RECOVERY',
    evidence_digest: digest
  });
  assertCode(() => runtime.validateReservedOrphanPayload({
    classification: 'ORPHAN_NONADOPTABLE',
    reason_code: 'BROKER_PROTECTED_RECOVERY',
    evidence_digest: digest,
    recovery_record_id: 'must-not-bind'
  }), 'GPR_RESERVED_ORPHAN_PAYLOAD_INVALID');
});

test('ordinary receipt append cannot mint the reserved broker orphan classification', async () => {
  const fixture = await legacyFixture({ release: false });
  assertCode(() => fixture.store.interruptRun(fixture.session, {
    payload: {
      classification: 'ORPHAN_NONADOPTABLE',
      reason_code: 'BROKER_PROTECTED_RECOVERY',
      evidence_digest: digest
    },
    created_at: nowIso()
  }), 'GPR_RESERVED_ORPHAN_PAYLOAD_FORBIDDEN');
  assert.equal(fixture.store.readReceiptChain(fixture.session.run_id).length, 1);
});

test('v3 JSON schemas are closed and reject secret, path, callback, and raw process fields', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'repo', 'contracts', 'github-program-receipt', 'github-program-receipt-policy.json'), 'utf8'));
  const v3Policy = policy.sqlite.v3_dormant_contract;
  assert.deepEqual(v3Policy.relational_coherence, {
    trust_source: 'CANONICAL_DURABLE_ROWS',
    holder_persistence: 'V3_INSERT_TRIGGER_EXACT_METADATA_ALLOCATION_RUN_LEASE_FENCE_AUTHORITY_START_BINDINGS',
    recovery_persistence: 'V3_INSERT_TRIGGER_EXACT_OLD_PRE_TERMINAL_RELEASE_REPLACEMENT_BINDINGS',
    independent_reopen_readback: 'verifyFinalV3Database',
    stable_failure_classes: ['GPR_V3_HOLDER_COHERENCE', 'GPR_V3_RECOVERY_COHERENCE'],
    production_v2_unchanged: true
  });
  assert.deepEqual(v3Policy.receipt_chain_digest, {
    table: 'receipt_chain_digests',
    digest: 'SHA256(canonicalSerialize([receipt_1, ..., receipt_n]))',
    source: 'RUNTIME_DERIVED',
    persisted_atomically_with_receipt: true,
    append_only: true,
    independent_reopen_readback: true,
    legacy_v2_backfill: false,
    legacy_missing_readback: 'EXPLICIT_ALLOW_LEGACY_MISSING_RECEIPT_CHAIN_DIGESTS'
  });
  assert.equal(v3Policy.holder_attestation.attestation_digest,
    'SHA256(canonicalSerialize(all_holder_attestation_fields_except_attestation_digest))');
  assert.equal(v3Policy.holder_attestation.attestation_tag_verification,
    'ISSUER_SIDE_ONLY_NONPERSISTED_KEY_READBACK_INTEGRITY_BOUND_BY_ATTESTATION_DIGEST');
  assert.deepEqual([...v3Policy.holder_attestation.required_fields].sort(), [...HOLDER_ATTESTATION_KEYS].sort());
  assert.deepEqual([...v3Policy.recovery.pre_recovery_evidence_fields].sort(), [...PRE_RECOVERY_EVIDENCE_KEYS].sort());
  assert.deepEqual([...v3Policy.recovery.recovery_record_fields].sort(), [...RECOVERY_RECORD_KEYS].sort());
  assert.equal(v3Policy.recovery.pre_recovery_evidence_contains_self_digest, false);
  const contracts = [
    ['holder-attestation-v1.schema.json', 'toolkit.github-program.holder-attestation.v1', HOLDER_ATTESTATION_KEYS],
    ['pre-recovery-evidence-v1.schema.json', 'toolkit.github-program.pre-recovery-evidence.v1', PRE_RECOVERY_EVIDENCE_KEYS],
    ['recovery-record-v1.schema.json', 'toolkit.github-program.recovery-record.v1', RECOVERY_RECORD_KEYS]
  ];
  for (const [file, id, expectedKeys] of contracts) {
    const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'repo', 'contracts', 'github-program-receipt', file), 'utf8'));
    assert.equal(schema.$id, id);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    assert.deepEqual([...schema.required].sort(), [...expectedKeys].sort());
    assert.equal(Object.keys(schema.properties).some((key) => /(?:path|callback|executable|environment|secret|private)/i.test(key)), false);
  }
  assertCode(() => runtime.validateHolderAttestation({ ...validHolderAttestation(), secret: 'not-a-secret' }),
    'GPR_HOLDER_ATTESTATION_INVALID');
  assertCode(() => runtime.validateHolderAttestation({ ...validHolderAttestation(), key_id: 'C:\\private\\broker.key' }),
    'GPR_HOLDER_ATTESTATION_INVALID');
  assertCode(() => runtime.validateHolderAttestation({ ...validHolderAttestation(), callback: 'node -e' }),
    'GPR_HOLDER_ATTESTATION_INVALID');
  assertCode(() => runtime.validatePreRecoveryEvidence({ ...validPreRecoveryEvidence(), process_id: 1234 }),
    'GPR_PRE_RECOVERY_EVIDENCE_INVALID');
});

test('final v3 schema fingerprint is deterministic and includes the restored metadata guard', () => {
  const first = runtime.expectedFinalV3SchemaFingerprint();
  const second = runtime.expectedFinalV3SchemaFingerprint();
  assert.equal(first, second);
  assert.equal(first, EXPECTED_FINAL_V3_SCHEMA_FINGERPRINT);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(runtime.buildFinalV3SchemaSql());
    assert.equal(schemaDigest(db), first);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='holder_attestations'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='recovery_records'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='receipt_chain_digests'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='metadata_no_update'").get());
    db.exec('DROP TRIGGER metadata_no_update');
    assert.notEqual(schemaDigest(db), first);
  } finally {
    db.close();
  }
});

test('production v2 fingerprint and dormancy remain unchanged while v3 stays separate', () => {
  assert.equal(runtime.USER_VERSION, 2);
  assert.equal(runtime.expectedV2SchemaFingerprint(), EXPECTED_PRODUCTION_V2_SCHEMA_FINGERPRINT);
  assert.equal(runtime.V3_USER_VERSION, 3);
  assert.equal(typeof runtime.migrateV2ToV3, 'undefined');
  assert.equal(typeof runtime.activateV3, 'undefined');
});

test('final v3 SQL persists and reconstructs the complete immutable evidence contracts', () => {
  const fixture = v3RecoveryFixture();
  try {
    const row = fixture.db.prepare('SELECT * FROM recovery_records WHERE recovery_record_id = ?').get(fixture.recordA.recovery_record_id);
    const reconstructed = {
      schema: runtime.RECOVERY_RECORD_SCHEMA_ID,
      ...row,
      pre_recovery_evidence: JSON.parse(row.pre_recovery_evidence_json)
    };
    delete reconstructed.pre_recovery_evidence_json;
    assert.deepEqual(runtime.validateRecoveryRecord(reconstructed), runtime.validateRecoveryRecord(fixture.recordA));
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS value FROM holder_attestations').get().value, 4);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS value FROM recovery_records').get().value, 2);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS value FROM receipt_chain_digests').get().value, 6);
    assert.equal(fixture.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(fixture.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.throws(() => fixture.db.exec("UPDATE receipt_chain_digests SET chain_digest='f' WHERE sequence=1"), /GPR_APPEND_ONLY/);
    assert.throws(() => fixture.db.exec("DELETE FROM receipt_chain_digests WHERE sequence=1"), /GPR_APPEND_ONLY/);
    assert.throws(() => fixture.db.exec("UPDATE holder_attestations SET key_id='changed'"), /GPR_APPEND_ONLY/);
    assert.throws(() => fixture.db.exec("UPDATE recovery_records SET request_id='changed'"), /GPR_APPEND_ONLY/);
    assert.throws(() => fixture.db.exec("INSERT OR REPLACE INTO holder_attestations SELECT * FROM holder_attestations WHERE attestation_id='attestation-recovery-old-a'"), /GPR_APPEND_ONLY/);
    assert.throws(() => fixture.db.exec("INSERT OR REPLACE INTO recovery_records SELECT * FROM recovery_records WHERE recovery_record_id='recovery-record-a'"), /GPR_APPEND_ONLY/);
  } finally {
    fixture.db.close();
  }
});

test('final v3 SQL blocks OR REPLACE on every populated append-only table', () => {
  const fixture = v3RecoveryFixture();
  try {
    for (const statement of [
      "INSERT OR REPLACE INTO metadata SELECT * FROM metadata WHERE singleton=1",
      "INSERT OR REPLACE INTO coordination_state SELECT * FROM coordination_state WHERE singleton=1",
      "INSERT OR REPLACE INTO allocations SELECT * FROM allocations WHERE allocation_id='allocation-recovery-old-a'",
      "INSERT OR REPLACE INTO runs SELECT * FROM runs WHERE run_id='run-recovery-old-a'",
      "INSERT OR REPLACE INTO receipts SELECT * FROM receipts WHERE receipt_id=(SELECT receipt_id FROM receipts WHERE run_id='run-recovery-old-a' AND sequence=1)",
      "INSERT OR REPLACE INTO lease_events SELECT * FROM lease_events WHERE event_id='event-recovery-old-a-allocated'",
      "INSERT OR REPLACE INTO holder_attestations SELECT * FROM holder_attestations WHERE attestation_id='attestation-recovery-old-a'",
      "INSERT OR REPLACE INTO recovery_records SELECT * FROM recovery_records WHERE recovery_record_id='recovery-record-a'",
      "INSERT OR REPLACE INTO receipt_chain_digests SELECT * FROM receipt_chain_digests WHERE receipt_id=(SELECT receipt_id FROM receipts WHERE run_id='run-recovery-old-a' AND sequence=1)"
    ]) assert.throws(() => fixture.db.exec(statement), /GPR_APPEND_ONLY/);
  } finally {
    fixture.db.close();
  }
});

test('migration planning requires exact v2 recognition and migration quiescence', () => {
  const plan = runtime.buildV2ToV3MigrationPlan(migrationObservation());
  assert.equal(plan.schema, runtime.V3_MIGRATION_PLAN_SCHEMA_ID);
  assert.equal(plan.source_user_version, 2);
  assert.equal(plan.target_user_version, 3);
  assert.equal(plan.target_schema_fingerprint, runtime.expectedFinalV3SchemaFingerprint());
  assert.deepEqual(plan.steps.map((step) => step.action), [
    'RECOGNIZE_EXACT_CANONICAL_V2',
    'VERIFY_NAMESPACE_INTEGRITY_FK_HISTORICAL_DIGESTS_AND_CHAIN',
    'CHECK_MIGRATION_QUIESCENCE',
    'BEGIN_IMMEDIATE',
    'REVERIFY_V2_SOURCE_INSIDE_TRANSACTION',
    'REMOVE_METADATA_NO_UPDATE',
    'ADD_FINAL_V3_TABLES_INDEXES_AND_TRIGGERS',
    'WRITE_EXPECTED_FINAL_V3_FINGERPRINT',
    'RESTORE_METADATA_NO_UPDATE',
    'SET_USER_VERSION_3',
    'VERIFY_FINAL_V3_SCHEMA_FINGERPRINT',
    'REVERIFY_INTEGRITY_FK_HISTORICAL_DIGESTS_AND_HIGH_WATER',
    'COMMIT',
    'INDEPENDENT_REOPEN_AND_READBACK'
  ]);
  for (const overrides of [
    { user_version: 3 },
    { application_id: runtime.APPLICATION_ID + 1 },
    { schema_fingerprint: 'f'.repeat(64) },
    { historical_digests_verified: false },
    { pid_liveness: true }
  ]) assertCode(() => runtime.buildV2ToV3MigrationPlan(migrationObservation(overrides)),
    'GPR_V2_MIGRATION_SOURCE_INVALID');
  for (const overrides of [
    { unresolved_operation_count: 1 },
    { unexpired_unreleased_allocation_count: 1 }
  ]) assertCode(() => runtime.buildV2ToV3MigrationPlan(migrationObservation(overrides)),
    'GPR_MIGRATION_NOT_QUIESCENT');
});

test('migration quiescence rejects an actual unexpired unreleased v2 allocation', async () => {
  const fixture = await activeLegacyFixture();
  const observation = migrationObservationFromFixture(fixture);
  assert.equal(observation.unresolved_operation_count, 0);
  assert.equal(observation.unexpired_unreleased_allocation_count, 1);
  assertCode(() => runtime.buildV2ToV3MigrationPlan(observation), 'GPR_MIGRATION_NOT_QUIESCENT');
});

function applyMigrationFixture(databasePath, plan) {
  const db = new DatabaseSync(databasePath);
  try {
    assert.equal(Number(db.prepare('PRAGMA application_id').get().application_id), plan.source_application_id);
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), plan.source_user_version);
    assert.equal(schemaDigest(db), plan.source_schema_fingerprint);
    db.exec('BEGIN IMMEDIATE');
    try {
      assert.equal(Number(db.prepare('PRAGMA application_id').get().application_id), plan.source_application_id);
      assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), plan.source_user_version);
      assert.equal(schemaDigest(db), plan.source_schema_fingerprint);
      db.exec('DROP TRIGGER metadata_no_update');
      db.exec(plan.schema_sql);
      db.prepare('UPDATE metadata SET schema_fingerprint = ? WHERE singleton = 1').run(plan.target_schema_fingerprint);
      db.exec(plan.metadata_no_update_trigger_sql);
      db.exec(`PRAGMA user_version=${plan.target_user_version}`);
      assert.equal(schemaDigest(db), plan.target_schema_fingerprint);
      assert.equal(db.prepare('SELECT schema_fingerprint FROM metadata WHERE singleton = 1').get().schema_fingerprint,
        plan.target_schema_fingerprint);
      assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), plan.target_user_version);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) { /* Preserve the original fixture failure. */ }
      throw error;
    }
  } finally {
    db.close();
  }
}

async function legacyFixture({ release = true } = {}) {
  const storeOptions = options();
  const store = runtime.createProgrammeReceiptStore(storeOptions);
  const expectedAuthority = authority();
  const expectedStart = start();
  const session = await store.startRun({
    lock: 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-003',
    authority: expectedAuthority,
    start: expectedStart,
    candidate: null,
    lease_ms: 60000
  }, readers(expectedAuthority, expectedStart));
  if (release) {
    store.interruptRun(session, {
      payload: { classification: 'S1_DISPOSABLE_FIXTURE' },
      created_at: nowIso()
    });
  }
  return { store, storeOptions, session };
}

async function releasedLegacyFixture() {
  return legacyFixture({ release: true });
}

async function activeLegacyFixture() {
  return legacyFixture({ release: false });
}

function legacyRows(db) {
  return {
    allocations: db.prepare('SELECT * FROM allocations ORDER BY fence_sequence').all(),
    runs: db.prepare('SELECT * FROM runs ORDER BY run_id').all(),
    receipts: db.prepare('SELECT * FROM receipts ORDER BY run_id, sequence').all(),
    lease_events: db.prepare('SELECT * FROM lease_events ORDER BY fence_sequence, event_at, event_id').all(),
    mutation_operations: db.prepare('SELECT * FROM mutation_operations ORDER BY operation_id').all(),
    mutation_operation_events: db.prepare('SELECT * FROM mutation_operation_events ORDER BY operation_id, sequence').all(),
    coordination_state: db.prepare('SELECT * FROM coordination_state').all()
  };
}

test('v3 schema persists a strict receipt-chain sidecar contract', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(runtime.buildFinalV3SchemaSql());
    const table = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='receipt_chain_digests'").get();
    assert.ok(table);
    assert.match(table.sql, /length\(receipt_id\) = 64/);
    assert.match(table.sql, /length\(chain_digest\) = 64/);
    assert.match(table.sql, /FOREIGN KEY \(receipt_id\)[\s\S]+DEFERRABLE INITIALLY DEFERRED/);
    assert.match(table.sql, /FOREIGN KEY \(run_id, sequence\)[\s\S]+DEFERRABLE INITIALLY DEFERRED/);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='receipt_chain_digests_run_sequence'").get());
  } finally {
    db.close();
  }
});

test('v3 receipt sidecar stores the full canonical receipt prefix', () => {
  const fixture = v3RecoveryFixture();
  try {
    const rows = fixture.db.prepare(`SELECT receipt_id, run_id, sequence, chain_digest
      FROM receipt_chain_digests WHERE run_id=? ORDER BY sequence`).all(fixture.oldA.run.run_id);
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      {
        receipt_id: fixture.oldAStart.receipt_id,
        run_id: fixture.oldA.run.run_id,
        sequence: 1,
        chain_digest: runtime.digestValue([fixture.oldAStart])
      },
      {
        receipt_id: fixture.terminalA.receipt_id,
        run_id: fixture.oldA.run.run_id,
        sequence: 2,
        chain_digest: runtime.digestValue([fixture.oldAStart, fixture.terminalA])
      }
    ]);
  } finally {
    fixture.db.close();
  }
});

test('v3 receipt and sidecar append roll back together', () => {
  const db = v3Database();
  try {
    const graph = durableGraph('atomic-sidecar', 1);
    insertDurableGraph(db, graph);
    db.prepare('UPDATE coordination_state SET high_water=1 WHERE singleton=1 AND high_water=0').run();
    const receipt = durableStartedReceipt(graph);
    db.exec("CREATE TRIGGER test_receipt_sidecar_abort BEFORE INSERT ON receipt_chain_digests BEGIN SELECT RAISE(ABORT, 'TEST_SIDECAR_ABORT'); END;");
    assert.throws(() => runtime.appendV3ReceiptWithChainDigest(db, receipt), /TEST_SIDECAR_ABORT/);
    assert.equal(db.prepare('SELECT COUNT(*) AS value FROM receipts').get().value, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS value FROM receipt_chain_digests').get().value, 0);
  } finally {
    db.close();
  }
});

test('v3 receipt sidecar digest cannot be supplied by the caller', () => {
  const db = v3Database();
  try {
    const graph = durableGraph('caller-sidecar', 1);
    insertDurableGraph(db, graph);
    db.prepare('UPDATE coordination_state SET high_water=1 WHERE singleton=1 AND high_water=0').run();
    assertCode(() => runtime.appendV3ReceiptWithChainDigest(db, {
      ...durableStartedReceipt(graph),
      chain_digest: 'a'.repeat(64)
    }), 'GPR_RECEIPT_INVALID');
  } finally {
    db.close();
  }
});

test('v3 independent verifier rejects a tampered receipt-chain prefix digest', () => {
  const fixture = v3RecoveryFixture();
  try {
    fixture.db.exec('DROP TRIGGER receipt_chain_digests_no_update');
    fixture.db.prepare('UPDATE receipt_chain_digests SET chain_digest=? WHERE receipt_id=?')
      .run('f'.repeat(64), fixture.terminalA.receipt_id);
    fixture.db.exec("CREATE TRIGGER receipt_chain_digests_no_update BEFORE UPDATE ON receipt_chain_digests BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    assertCode(() => runtime.verifyFinalV3Database(fixture.db, V3_NAMESPACE), 'GPR_V3_RECOVERY_COHERENCE');
  } finally {
    fixture.db.close();
  }
});

test('v3 independent verifier rejects a missing receipt-chain sidecar row', () => {
  const fixture = v3RecoveryFixture();
  try {
    fixture.db.exec('DROP TRIGGER receipt_chain_digests_no_delete');
    fixture.db.prepare('DELETE FROM receipt_chain_digests WHERE receipt_id=?').run(fixture.terminalA.receipt_id);
    fixture.db.exec("CREATE TRIGGER receipt_chain_digests_no_delete BEFORE DELETE ON receipt_chain_digests BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    assertCode(() => runtime.verifyFinalV3Database(fixture.db, V3_NAMESPACE), 'GPR_V3_RECOVERY_COHERENCE');
  } finally {
    fixture.db.close();
  }
});

test('recovery persistence rejects a holder identity that is not the selected holder incarnation', () => {
  const fixture = v3RecoveryFixture();
  try {
    const old = durableGraph('red-old', 5);
    const replacement = durableGraph('red-new', 6, old.allocation.lock_id);
    const oldHolder = durableHolder(old);
    const replacementHolder = durableHolder(replacement);
    const oldStart = durableStartedReceipt(old);
    const replacementStart = durableStartedReceipt(replacement);
    const oldAllocated = durableLeaseEvent(old, 'ALLOCATED', 'event-red-old-allocated');
    const replacementAllocated = durableLeaseEvent(replacement, 'EXPIRED_TAKEOVER', 'event-red-new-allocated');
    const oldRelease = durableLeaseEvent(old, 'RELEASED', 'event-red-old-release');
    for (const graph of [old, replacement]) insertDurableGraph(fixture.db, graph);
    for (const highWater of [5, 6]) {
      fixture.db.prepare('UPDATE coordination_state SET high_water=? WHERE singleton=1 AND high_water=?').run(highWater, highWater - 1);
    }
    for (const holder of [oldHolder, replacementHolder]) insertHolder(fixture.db, holder);
    for (const receipt of [oldStart, replacementStart]) insertReceipt(fixture.db, receipt);
    for (const event of [oldAllocated, replacementAllocated, oldRelease]) insertLeaseEvent(fixture.db, event);
    const validEvidence = durablePreEvidence(old, oldHolder, oldAllocated, oldStart, 'recovery-request-red');
    const evidence = {
      ...validEvidence,
      old_holder_identity_digest: runtime.digestValue('wrong-process-incarnation')
    };
    const terminal = durableTerminalReceipt(old, oldStart, runtime.preRecoveryEvidenceDigest(evidence));
    insertReceipt(fixture.db, terminal);
    const record = durableRecoveryRecord(old, replacement, evidence, terminal, oldRelease, replacementHolder, 'recovery-record-red');
    assert.throws(() => insertRecoveryRecord(fixture.db, record), /GPR_V3_RECOVERY_COHERENCE/);
  } finally {
    fixture.db.close();
  }
});

test('exact disposable v2 fixture migrates atomically to final v3 without legacy backfill', async () => {
  const fixture = await releasedLegacyFixture();
  const beforeDb = new DatabaseSync(fixture.store.databasePath);
  const beforeRows = legacyRows(beforeDb);
  const plan = runtime.buildV2ToV3MigrationPlan(migrationObservationFromFixture(fixture));
  beforeDb.close();

  applyMigrationFixture(fixture.store.databasePath, plan);

  const reopened = new DatabaseSync(fixture.store.databasePath);
  try {
    assert.equal(Number(reopened.prepare('PRAGMA user_version').get().user_version), 3);
    assert.equal(schemaDigest(reopened), plan.target_schema_fingerprint);
    assert.equal(runtime.verifyFinalV3Database(reopened, fixture.storeOptions, fixture.store.databasePath, {
      allowLegacyMissingReceiptChainDigests: true
    }), true);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS value FROM holder_attestations').get().value, 0);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS value FROM recovery_records').get().value, 0);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS value FROM receipt_chain_digests').get().value, 0);
    assert.deepEqual(legacyRows(reopened), beforeRows);
    const allocationColumns = reopened.prepare('PRAGMA table_info(allocations)').all().map((row) => row.name);
    assert.equal(allocationColumns.includes('holder_attestation'), false);
    assert.equal(allocationColumns.includes('process_incarnation_digest'), false);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.throws(() => reopened.exec("UPDATE metadata SET schema_fingerprint='f' WHERE singleton=1"));
  } finally {
    reopened.close();
  }
  assertCode(() => runtime.createProgrammeReceiptStore(fixture.storeOptions), 'GPR_SCHEMA_MISMATCH');
});

test('failure before migration commit leaves the disposable fixture intact v2', async () => {
  const fixture = await releasedLegacyFixture();
  const plan = runtime.buildV2ToV3MigrationPlan(migrationObservationFromFixture(fixture));
  const crash = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(fixture.store.databasePath)});
    db.exec('BEGIN IMMEDIATE');
    db.exec('DROP TRIGGER metadata_no_update');
    db.exec(${JSON.stringify(plan.schema_sql)});
    process.exit(19);
  `;
  const result = spawnSync(process.execPath, ['-e', crash], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 19, result.stderr);
  const reopened = runtime.createProgrammeReceiptStore(fixture.storeOptions);
  const db = new DatabaseSync(fixture.store.databasePath);
  try {
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 2);
    assert.equal(schemaDigest(db), runtime.expectedV2SchemaFingerprint());
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM sqlite_schema WHERE name IN ('holder_attestations', 'recovery_records', 'receipt_chain_digests')").get().value, 0);
    assert.equal(reopened.readReceiptChain(fixture.session.run_id).length, 2);
  } finally {
    db.close();
  }
});

test('production runtime remains v2-only and exposes no migration command or activation route', () => {
  assert.equal(runtime.USER_VERSION, 2);
  assert.equal(runtime.V3_USER_VERSION, 3);
  assert.equal(typeof runtime.migrateV2ToV3, 'undefined');
  assert.equal(typeof runtime.activateV3, 'undefined');
  const result = spawnSync(process.execPath, [
    path.resolve(repositoryRoot, 'repo/scripts/toolkit-github-program-receipt.cjs'),
    'migrate-v2-to-v3'
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GPR_COMMAND_INVALID/);
});

test('receipt-v1 remains the historical compatibility contract', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'repo', 'contracts', 'github-program-receipt', 'run-receipt-v1.schema.json'), 'utf8'));
  assert.equal(schema.$id, 'toolkit.github-program.run-receipt.v1');
  assert.deepEqual(schema.properties.receipt_type.enum, [
    'RUN_STARTED', 'TRANSITION_PREVIEW', 'EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED'
  ]);
  assert.equal(schema.$defs.payload.properties.recovery_record_id, undefined);
  assert.equal(schema.$defs.payload.properties.holder_attestation_digest, undefined);
});

test.afterEach(() => {
  for (const root of cleanupRoots) fs.rmSync(root, { recursive: true, force: true });
  cleanupRoots.clear();
});
