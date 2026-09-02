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

function validHolderAttestation() {
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
    run_id: 'run-test',
    lease_id: 'lease-test',
    fence_id: 'fence-test',
    fence_sequence: 1,
    authority_digest: digest,
    start_digest: digest,
    process_id_digest: digest,
    process_start_digest: digest,
    boot_id_digest: digest,
    pid_namespace_digest: digest,
    process_incarnation_digest: digest,
    lease_issued_at: '2026-09-02T01:00:00.000Z',
    lease_expires_at: '2026-09-02T02:00:00.000Z',
    attestation_digest: '',
    attestation_tag: digest
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
    evidence_digest: '',
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 240,
    child_issue: 359,
    lock: 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-003',
    allocation_id: 'allocation-test',
    run_id: 'run-test',
    lease_id: 'lease-test',
    fence_id: 'fence-test',
    fence_sequence: 1,
    namespace_digest: digest,
    authority_digest: digest,
    start_digest: digest,
    holder_attestation_digest: digest,
    store_state_digest: digest,
    observed_at: nowIso(),
    holder_classification: 'ORPHAN_NONADOPTABLE',
    operation_count: 0,
    unresolved_operation_count: 0,
    high_water: 1,
    ...overrides
  };
  const payload = { ...value };
  delete payload.evidence_digest;
  value.evidence_digest = runtime.digestValue(payload);
  return value;
}

function validRecoveryRecord(overrides = {}) {
  const value = {
    schema: 'toolkit.github-program.recovery-record.v1',
    recovery_record_id: 'recovery-record-test',
    recovery_record_digest: '',
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 240,
    child_issue: 359,
    lock: 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-003',
    old_allocation_id: 'allocation-old',
    old_run_id: 'run-old',
    old_lease_id: 'lease-old',
    old_fence_id: 'fence-old',
    old_fence_sequence: 1,
    pre_recovery_evidence_digest: digest,
    terminal_receipt_id: digest,
    release_event_id: 'event-release',
    replacement_allocation_id: 'allocation-new',
    replacement_run_id: 'run-new',
    replacement_lease_id: 'lease-new',
    replacement_fence_id: 'fence-new',
    replacement_fence_sequence: 2,
    authority_digest: digest,
    holder_attestation_digest: digest,
    classification: 'ORPHAN_NONADOPTABLE',
    reason_code: 'BROKER_PROTECTED_RECOVERY',
    recovered_at: nowIso(),
    ...overrides
  };
  const payload = { ...value };
  delete payload.recovery_record_digest;
  value.recovery_record_digest = runtime.digestValue(payload);
  return value;
}

test('pre-recovery and recovery contracts are exact, acyclic, and digest-bound', () => {
  const evidence = validPreRecoveryEvidence();
  const record = validRecoveryRecord({ pre_recovery_evidence_digest: evidence.evidence_digest });
  assert.doesNotThrow(() => runtime.validatePreRecoveryEvidence(evidence));
  assert.doesNotThrow(() => runtime.validateRecoveryRecord(record));
  for (const excluded of [
    'terminal_receipt_id', 'release_event_id', 'replacement_allocation_id',
    'replacement_run_id', 'recovery_record_id'
  ]) assert.equal(Object.hasOwn(evidence, excluded), false, excluded);
  assertCode(() => runtime.validatePreRecoveryEvidence({ ...evidence, observed_at: '2026-09-02T01:11:00.000Z' }),
    'GPR_PRE_RECOVERY_EVIDENCE_INVALID');
  assertCode(() => runtime.validateRecoveryRecord({ ...record, replacement_fence_sequence: 3 }),
    'GPR_RECOVERY_RECORD_INVALID');
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

test('v3 JSON schemas are closed and reject secret, path, callback, and raw process fields', () => {
  const contracts = [
    ['holder-attestation-v1.schema.json', 'toolkit.github-program.holder-attestation.v1'],
    ['pre-recovery-evidence-v1.schema.json', 'toolkit.github-program.pre-recovery-evidence.v1'],
    ['recovery-record-v1.schema.json', 'toolkit.github-program.recovery-record.v1']
  ];
  for (const [file, id] of contracts) {
    const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'repo', 'contracts', 'github-program-receipt', file), 'utf8'));
    assert.equal(schema.$id, id);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
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
