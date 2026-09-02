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
const EXPECTED_FINAL_V3_SCHEMA_FINGERPRINT = '4144950da411bf0142cc57e99e3743311675c6dfef4b1f01fbbb96373a417798';

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
  delete payload.attestation_tag;
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
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='metadata_no_update'").get());
    db.exec('DROP TRIGGER metadata_no_update');
    assert.notEqual(schemaDigest(db), first);
  } finally {
    db.close();
  }
});

test('final v3 SQL persists and reconstructs the complete immutable evidence contracts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(runtime.buildFinalV3SchemaSql());
    const expectedAuthority = authority('sql');
    const expectedStart = start();
    const allocation = (allocationId, runId, leaseId, fenceId, fenceSequence) => {
      const row = {
        allocation_id: allocationId,
        run_id: runId,
        lock_id: 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-003',
        lease_id: leaseId,
        fence_id: fenceId,
        fence_sequence: fenceSequence,
        owner_instance_id: `owner-${allocationId}`,
        process_id: 1,
        issued_at: '2026-09-02T01:00:00.000Z',
        expires_at: '2026-09-02T02:00:00.000Z',
        authority_json: runtime.canonicalSerialize(expectedAuthority),
        start_json: runtime.canonicalSerialize(expectedStart)
      };
      row.allocation_digest = runtime.digestValue({
        allocation_id: row.allocation_id,
        run_id: row.run_id,
        lock: row.lock_id,
        lease_id: row.lease_id,
        fence_id: row.fence_id,
        fence_sequence: row.fence_sequence,
        owner_instance_id: row.owner_instance_id,
        process_id: row.process_id,
        issued_at: row.issued_at,
        expires_at: row.expires_at,
        authority: expectedAuthority,
        start: expectedStart
      });
      return row;
    };
    const oldAllocation = allocation('allocation-old', 'run-old', 'lease-old', 'fence-old', 1);
    const replacementAllocation = allocation('allocation-new', 'run-new', 'lease-new', 'fence-new', 2);
    for (const row of [oldAllocation, replacementAllocation]) {
      db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        row.allocation_id, row.run_id, row.lock_id, row.lease_id, row.fence_id,
        row.fence_sequence, row.owner_instance_id, row.process_id, row.issued_at,
        row.expires_at, row.authority_json, row.start_json, row.allocation_digest
      );
      const run = {
        run_id: row.run_id,
        allocation_id: row.allocation_id,
        lock: row.lock_id,
        authority_digest: runtime.digestValue(expectedAuthority),
        start_digest: runtime.digestValue(expectedStart)
      };
      db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run(
        run.run_id, run.allocation_id, run.lock, run.authority_digest, run.start_digest,
        runtime.digestValue(run)
      );
    }
    const terminalReceiptId = digest;
    const releaseEventId = 'event-release';
    const releaseEventDigest = digest;
    db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      terminalReceiptId, oldAllocation.run_id, 1, 'RUN_INTERRUPTED', null, '{}', terminalReceiptId
    );
    db.prepare('INSERT INTO lease_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      releaseEventId, oldAllocation.allocation_id, 'RELEASED', 1,
      '2026-09-02T02:15:00.000Z', digest, releaseEventDigest
    );

    const holder = validHolderAttestation({
      allocation_id: replacementAllocation.allocation_id,
      allocation_digest: replacementAllocation.allocation_digest,
      run_id: replacementAllocation.run_id,
      run_digest: runtime.digestValue({ run_id: replacementAllocation.run_id }),
      lease_id: replacementAllocation.lease_id,
      fence_id: replacementAllocation.fence_id,
      fence_sequence: replacementAllocation.fence_sequence
    });
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

    const evidence = validPreRecoveryEvidence();
    const record = validRecoveryRecord({ replacement_holder_attestation_id: holder.attestation_id });
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
      runtime.canonicalSerialize(evidence), record.pre_recovery_evidence_digest,
      record.terminal_receipt_id, record.terminal_receipt_digest, record.release_event_id,
      record.release_event_digest, record.replacement_allocation_id,
      record.replacement_allocation_digest, record.replacement_run_id,
      record.replacement_run_digest, record.replacement_lease_id, record.replacement_fence_id,
      record.replacement_fence_sequence, record.replacement_holder_attestation_id,
      record.replacement_holder_attestation_digest, record.new_high_water,
      record.authority_digest, record.source_digest, record.start_digest, record.committed_at
    );

    const row = db.prepare('SELECT * FROM recovery_records WHERE recovery_record_id = ?').get(record.recovery_record_id);
    const reconstructed = {
      schema: runtime.RECOVERY_RECORD_SCHEMA_ID,
      recovery_record_id: row.recovery_record_id,
      request_id: row.request_id,
      namespace_digest: row.namespace_digest,
      old_allocation_id: row.old_allocation_id,
      old_run_id: row.old_run_id,
      old_lease_id: row.old_lease_id,
      old_fence_id: row.old_fence_id,
      old_fence_sequence: row.old_fence_sequence,
      pre_recovery_evidence: JSON.parse(row.pre_recovery_evidence_json),
      pre_recovery_evidence_digest: row.pre_recovery_evidence_digest,
      terminal_receipt_id: row.terminal_receipt_id,
      terminal_receipt_digest: row.terminal_receipt_digest,
      release_event_id: row.release_event_id,
      release_event_digest: row.release_event_digest,
      replacement_allocation_id: row.replacement_allocation_id,
      replacement_allocation_digest: row.replacement_allocation_digest,
      replacement_run_id: row.replacement_run_id,
      replacement_run_digest: row.replacement_run_digest,
      replacement_lease_id: row.replacement_lease_id,
      replacement_fence_id: row.replacement_fence_id,
      replacement_fence_sequence: row.replacement_fence_sequence,
      replacement_holder_attestation_id: row.replacement_holder_attestation_id,
      replacement_holder_attestation_digest: row.replacement_holder_attestation_digest,
      new_high_water: row.new_high_water,
      authority_digest: row.authority_digest,
      source_digest: row.source_digest,
      start_digest: row.start_digest,
      committed_at: row.committed_at,
      recovery_record_digest: row.recovery_record_digest
    };
    assert.equal(runtime.canonicalSerialize(reconstructed.pre_recovery_evidence),
      runtime.canonicalSerialize(evidence));
    assert.deepEqual(runtime.validateRecoveryRecord(reconstructed), runtime.validateRecoveryRecord(record));
    assert.throws(() => db.exec("UPDATE holder_attestations SET key_id='changed'"), /GPR_APPEND_ONLY/);
    assert.throws(() => db.exec("UPDATE recovery_records SET request_id='changed'"), /GPR_APPEND_ONLY/);
  } finally {
    db.close();
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
    assert.equal(reopened.prepare('SELECT COUNT(*) AS value FROM holder_attestations').get().value, 0);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS value FROM recovery_records').get().value, 0);
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
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM sqlite_schema WHERE name IN ('holder_attestations', 'recovery_records')").get().value, 0);
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
