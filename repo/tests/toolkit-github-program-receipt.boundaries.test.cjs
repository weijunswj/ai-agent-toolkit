'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const runtimePath = path.resolve(__dirname, '../scripts/toolkit-github-program-receipt.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const {
  LIMITS,
  assertRuntimeSupport,
  createProgrammeReceiptStore,
  digestValue,
  validateWindowsStorageProof
} = require(runtimePath);

const cleanupRoots = new Set();

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
  const root = fs.mkdtempSync(path.join(parent, 'boundary-'));
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  secureWindowsDirectory(root);
  cleanupRoots.add(root);
  return root;
}

function nowIso() {
  return new Date().toISOString();
}

test.afterEach(() => {
  for (const root of cleanupRoots) fs.rmSync(root, { recursive: true, force: true });
  cleanupRoots.clear();
});

function authority(seed = 'authority') {
  return {
    child_comment_id: 5468153006,
    parent_comment_id: 5468153976,
    node_id: `IC_${seed}`,
    author_login: 'weijunswj',
    author_association: 'OWNER',
    body_digest: digestValue({ seed, kind: 'body' }),
    updated_at: '2026-08-30T10:31:29.000Z',
    update_identity_digest: digestValue({ seed, kind: 'update' }),
    scope_digest: digestValue({ seed, kind: 'scope' })
  };
}

function start() {
  return {
    base_sha: '1'.repeat(40),
    head_sha: '2'.repeat(40),
    tree_sha: '3'.repeat(40),
    status_digest: digestValue({ status: [] }),
    clean_worktree: true,
    ref: { detached: true, name: null }
  };
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

function readers(expectedAuthority, expectedStart, now) {
  return {
    now,
    readAuthority: async () => ({ authority: structuredClone(expectedAuthority), later_controlling_comments: [] }),
    readStart: async () => structuredClone(expectedStart)
  };
}

async function fixture(overrides = {}) {
  const storeOptions = overrides.storeOptions || options();
  const store = createProgrammeReceiptStore(storeOptions);
  const expectedAuthority = overrides.authority || authority();
  const expectedStart = overrides.start || start();
  const now = overrides.now || '2026-08-30T11:00:00.000Z';
  const session = await store.startRun({
    lock: overrides.lock || 'LOCK-BOUNDARY', authority: expectedAuthority, start: expectedStart,
    candidate: null, lease_ms: overrides.lease_ms || 60000
  }, readers(expectedAuthority, expectedStart, now));
  return { store, session, expectedAuthority, expectedStart, now, storeOptions };
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

test('Windows storage proof rejects untrusted access, wrong owner, and non-fixed drives', () => {
  const current = 'S-1-5-21-1-2-3-1001';
  const valid = {
    current,
    owner: current,
    drive_type: 3,
    rules: [
      { sid: current, type: 'Allow', rights: 'FullControl' },
      { sid: 'S-1-5-18', type: 'Allow', rights: 'FullControl' },
      { sid: 'S-1-5-32-544', type: 'Allow', rights: 'FullControl' }
    ]
  };
  assert.equal(validateWindowsStorageProof(valid), true);
  assertCode(() => validateWindowsStorageProof({
    ...valid,
    rules: [...valid.rules, { sid: 'S-1-5-32-545', type: 'Allow', rights: 'ReadAndExecute' }]
  }), 'GPR_UNSAFE_STATE_ROOT');
  assertCode(() => validateWindowsStorageProof({ ...valid, owner: 'S-1-5-18' }), 'GPR_UNSAFE_STATE_ROOT');
  assertCode(() => validateWindowsStorageProof({ ...valid, drive_type: 4 }), 'GPR_UNSAFE_STATE_ROOT');
});

async function assertCodeAsync(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

test('authority movement before first mutation blocks all adapter calls', async () => {
  const { store, session, expectedAuthority, expectedStart } = await fixture();
  let calls = 0;
  await assertCodeAsync(() => store.performMutation(session, {
    now: '2026-08-30T11:00:01.000Z',
    expected_source_digest: digestValue(expectedStart),
    readAuthority: async () => ({
      authority: expectedAuthority,
      later_controlling_comments: [{ comment_id: 999, body_digest: digestValue('hold') }]
    }),
    readSource: async () => expectedStart,
    mutate: async () => { calls += 1; }
  }), 'GPR_AUTHORITY_CHANGED');
  assert.equal(calls, 0);
});

test('authority is freshly checked between every mutation operation', async () => {
  const { store, session, expectedAuthority, expectedStart } = await fixture();
  let chronologyReads = 0;
  let calls = 0;
  const operation = () => ({
    now: '2026-08-30T11:00:01.000Z',
    expected_source_digest: digestValue(expectedStart),
    readAuthority: async () => {
      chronologyReads += 1;
      return {
        authority: expectedAuthority,
        later_controlling_comments: chronologyReads === 1 ? [] : [{ comment_id: 1000, body_digest: digestValue('revoke') }]
      };
    },
    readSource: async () => expectedStart,
    mutate: async () => { calls += 1; return { ok: true }; }
  });
  assert.deepEqual(await store.performMutation(session, operation()), { ok: true });
  await assertCodeAsync(() => store.performMutation(session, operation()), 'GPR_AUTHORITY_CHANGED');
  assert.equal(calls, 1);
});

test('source movement is checked before every adapter mutation', async () => {
  const { store, session, expectedAuthority, expectedStart } = await fixture();
  let calls = 0;
  await assertCodeAsync(() => store.performMutation(session, {
    now: '2026-08-30T11:00:01.000Z',
    expected_source_digest: digestValue(expectedStart),
    readAuthority: async () => ({ authority: expectedAuthority, later_controlling_comments: [] }),
    readSource: async () => ({ ...expectedStart, head_sha: '9'.repeat(40) }),
    mutate: async () => { calls += 1; }
  }), 'GPR_SOURCE_CHANGED');
  assert.equal(calls, 0);
});

test('an expired holder cannot backdate a receipt before takeover', async () => {
  const { store, session } = await fixture({ lease_ms: 1000 });
  const priorTimestamp = store.readReceiptChain(session.run_id)[0].created_at;
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assertCode(() => store.appendReceipt(session, {
    receipt_type: 'RUN_INTERRUPTED',
    payload: { classification: 'BACKDATED' },
    created_at: priorTimestamp
  }), 'GPR_EXPIRED_FENCE');
  assert.equal(store.readReceiptChain(session.run_id).length, 1);
});

test('zero mutation occurs before verified RUN_STARTED and admission succeeds afterward', async () => {
  const root = stateRoot();
  const store = createProgrammeReceiptStore(options(root));
  const expectedAuthority = authority();
  const expectedStart = start();
  const allocated = store.allocateRun({
    lock: 'LOCK-ZERO-MUTATION', authority: expectedAuthority, start: expectedStart,
    candidate: null, lease_ms: 60000
  });
  let calls = 0;
  const operation = {
    now: '2026-08-30T11:00:00.000Z',
    expected_source_digest: digestValue(expectedStart),
    readAuthority: async () => ({ authority: expectedAuthority, later_controlling_comments: [] }),
    readSource: async () => expectedStart,
    mutate: async () => { calls += 1; return 'mutated'; }
  };
  await assertCodeAsync(() => store.performMutation(allocated, operation), 'GPR_RUN_NOT_STARTED');
  assert.equal(calls, 0);
  const started = await store.startAllocatedRun(allocated, readers(expectedAuthority, expectedStart, operation.now));
  assert.equal(await store.performMutation(started, operation), 'mutated');
  assert.equal(calls, 1);
});

test('unknown mutation outcome is interrupted without blind retry', async () => {
  const { store, session, expectedAuthority, expectedStart } = await fixture();
  let calls = 0;
  await assertCodeAsync(() => store.performMutation(session, {
    now: '2026-08-30T11:00:01.000Z',
    expected_source_digest: digestValue(expectedStart),
    readAuthority: async () => ({ authority: expectedAuthority, later_controlling_comments: [] }),
    readSource: async () => expectedStart,
    mutate: async () => { calls += 1; throw Object.assign(new Error('unknown'), { code: 'ECONNRESET' }); }
  }), 'GPR_MUTATION_OUTCOME_UNKNOWN');
  assert.equal(calls, 1);
  const chain = store.readReceiptChain(session.run_id);
  assert.equal(chain.at(-1).receipt_type, 'RUN_INTERRUPTED');
  assert.equal(chain.at(-1).payload.classification, 'MUTATION_OUTCOME_UNKNOWN');
});

test('terminal append and lease release are atomic and next allocation is N+1', async () => {
  const root = stateRoot();
  const storeOptions = options(root);
  const { store, session, expectedAuthority, expectedStart } = await fixture({ storeOptions });
  store.appendReceipt(session, {
    receipt_type: 'G4_TERMINAL', payload: { classification: 'PASS' },
    created_at: nowIso()
  });
  const next = store.allocateRun({
    lock: 'LOCK-NEXT', authority: expectedAuthority, start: expectedStart,
    candidate: null, lease_ms: 60000
  });
  assert.equal(next.lease.fence_sequence, session.lease.fence_sequence + 1);
});

test('allocator and ledger tampering is blocked and a self-consistent forged schema fails reopen', async () => {
  const { store, session, storeOptions } = await fixture();
  const code = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(store.databasePath)});
    let update = null;
    let remove = null;
    try { db.exec('UPDATE allocations SET lock_id=\"OTHER\"'); } catch (error) { update = error.code; }
    try { db.exec('DELETE FROM receipts'); } catch (error) { remove = error.code; }
    db.close();
    process.stdout.write(JSON.stringify({ update, remove }));
  `;
  const blocked = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', windowsHide: true });
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.ok(JSON.parse(blocked.stdout).update);
  assert.ok(JSON.parse(blocked.stdout).remove);
  assert.equal(store.readReceiptChain(session.run_id).length, 1);

  const tamper = `
    const { DatabaseSync } = require('node:sqlite');
    const { digestValue } = require(${JSON.stringify(runtimePath)});
    const db = new DatabaseSync(${JSON.stringify(store.databasePath)});
    db.exec('DROP TRIGGER allocations_no_update; DROP TRIGGER metadata_no_update');
    const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    db.prepare('UPDATE metadata SET schema_fingerprint = ? WHERE singleton = 1').run(digestValue(rows));
    db.close();
  `;
  assert.equal(spawnSync(process.execPath, ['-e', tamper], { encoding: 'utf8', windowsHide: true }).status, 0);
  assertCode(() => createProgrammeReceiptStore(storeOptions), 'GPR_SCHEMA_MISMATCH');
});

test('rollback journal restores an uncommitted high-water write after process death', async () => {
  const { store, session, storeOptions } = await fixture();
  const crash = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(store.databasePath)});
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; UPDATE coordination_state SET high_water=high_water+1 WHERE singleton=1');
    process.exit(19);
  `;
  const result = spawnSync(process.execPath, ['-e', crash], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 19);
  const reopened = createProgrammeReceiptStore(storeOptions);
  assert.equal(reopened.readReceiptChain(session.run_id).length, 1);
});

test('payload, receipt-count, and database-size limits fail closed', async () => {
  const first = await fixture();
  const oversizedEvidence = Array.from({ length: 50 }, (_, index) => ({
    id: `e${String(index).padStart(3, '0')}${'x'.repeat(156)}`,
    digest: digestValue({ index })
  }));
  assertCode(() => first.store.appendReceipt(first.session, {
    receipt_type: 'TRANSITION_PREVIEW',
    payload: { classification: 'TOO_LARGE', evidence_refs: oversizedEvidence },
    created_at: nowIso()
  }), 'GPR_RECEIPT_TOO_LARGE');

  for (let sequence = 2; sequence <= LIMITS.receiptsPerRun; sequence += 1) {
    first.store.appendReceipt(first.session, {
      receipt_type: 'TRANSITION_PREVIEW', payload: { classification: `STEP_${sequence}` },
      created_at: nowIso()
    });
  }
  assertCode(() => first.store.appendReceipt(first.session, {
    receipt_type: 'TRANSITION_PREVIEW', payload: { classification: 'STEP_OVERFLOW' },
    created_at: nowIso()
  }), 'GPR_SEQUENCE_INVALID');

  const fill = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(first.store.databasePath)});
    let code = null;
    try {
      const pageSize = db.prepare('PRAGMA page_size').get().page_size;
      db.exec('PRAGMA max_page_count=' + Math.floor(${LIMITS.databaseBytes} / pageSize));
      db.exec('BEGIN IMMEDIATE; CREATE TABLE oversized_probe (value BLOB) STRICT; INSERT INTO oversized_probe VALUES (zeroblob(${LIMITS.databaseBytes})); COMMIT');
    } catch (error) {
      code = error.code;
      try { db.exec('ROLLBACK'); } catch (_) {}
    }
    db.close();
    process.stdout.write(JSON.stringify({ code }));
  `;
  const filled = spawnSync(process.execPath, ['-e', fill], { encoding: 'utf8', windowsHide: true });
  assert.equal(filled.status, 0, filled.stderr);
  assert.ok(JSON.parse(filled.stdout).code);
  assert.ok(fs.statSync(first.store.databasePath).size <= LIMITS.databaseBytes);
  assert.equal(first.store.readReceiptChain(first.session.run_id).length, LIMITS.receiptsPerRun);

  const second = await fixture();
  fs.truncateSync(second.store.databasePath, LIMITS.databaseBytes + 4096);
  assertCode(() => createProgrammeReceiptStore(second.storeOptions), 'GPR_DATABASE_LIMIT');
});

test('unsafe roots, sensitive fields, caller fences, and unsupported runtimes are rejected', () => {
  assertCode(() => createProgrammeReceiptStore({
    repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359,
    stateRoot: repositoryRoot, repositoryRoot
  }), 'GPR_UNSAFE_STATE_ROOT');
  const realRoot = stateRoot();
  const linkRoot = path.join(path.dirname(realRoot), `link-${process.pid}-${Date.now()}`);
  try {
    fs.symlinkSync(realRoot, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
    assertCode(() => createProgrammeReceiptStore({
      repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359,
      stateRoot: linkRoot, repositoryRoot
    }), 'GPR_UNSAFE_STATE_ROOT');
  } finally {
    if (fs.existsSync(linkRoot)) fs.unlinkSync(linkRoot);
  }
  assertCode(() => createProgrammeReceiptStore({
    repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359,
    stateRoot: path.resolve(os.tmpdir()), repositoryRoot
  }), 'GPR_UNSAFE_STATE_ROOT');

  const store = createProgrammeReceiptStore(options());
  for (const invalidRef of ['refs:invalid', 'feat//x', '.hidden/x', 'feat/x.lock']) {
    assertCode(() => store.allocateRun({
      lock: 'LOCK-BAD-REF', authority: authority(),
      start: { ...start(), ref: { detached: false, name: invalidRef } },
      candidate: null, lease_ms: 5000
    }), 'GPR_START_INVALID');
  }
  assertCode(() => store.allocateRun({
    lock: 'LOCK-SENSITIVE', authority: authority(), start: start(), candidate: null,
    lease_ms: 5000, lease_id: 'caller-value'
  }), 'GPR_CALLER_FENCE_FORBIDDEN');
  assertCode(() => store.allocateRun({
    lock: 'LOCK-SENSITIVE', authority: authority(), start: start(), candidate: null,
    lease_ms: 5000,
    extra: { access_token: 'not-persisted' }
  }), 'GPR_ALLOCATION_INVALID');
  assertCode(() => assertRuntimeSupport({ nodeVersion: '22.12.0', sqlite: { DatabaseSync() {} } }), 'GPR_UNSUPPORTED_RUNTIME');
  assertCode(() => assertRuntimeSupport({ nodeVersion: '22.13.0', sqlite: {} }), 'GPR_SQLITE_UNAVAILABLE');
  const validRefStore = createProgrammeReceiptStore(options());
  assert.equal(validRefStore.allocateRun({
    lock: 'LOCK-VALID-REF', authority: authority(),
    start: { ...start(), ref: { detached: false, name: 'feat/x]' } },
    candidate: null, lease_ms: 5000
  }).lease.fence_sequence, 1);

  const shadowRoot = stateRoot();
  const originalPath = process.env.PATH;
  process.env.PATH = repositoryRoot;
  try {
    assert.ok(createProgrammeReceiptStore(options(shadowRoot)).databasePath.startsWith(shadowRoot));
  } finally {
    process.env.PATH = originalPath;
  }
});

test('privacy-sensitive receipt payload fields are never persisted', async () => {
  const { store, session } = await fixture();
  assertCode(() => store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW',
    payload: { access_token: 'not-a-real-token' },
    created_at: nowIso()
  }), 'GPR_SENSITIVE_FIELD');
  assertCode(() => store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW',
    payload: { classification: 'RAW_CONTENT', data: 'ordinary raw content' },
    created_at: nowIso()
  }), 'GPR_PAYLOAD_INVALID');
  assert.equal(store.readReceiptChain(session.run_id).length, 1);
});

test('lost supervisor ownership cannot append or mutate', async () => {
  const { store, session, expectedAuthority, expectedStart } = await fixture();
  const impostor = structuredClone(session);
  assertCode(() => store.appendReceipt(impostor, {
    receipt_type: 'RUN_INTERRUPTED', payload: { classification: 'OWNERSHIP_LOST' }, created_at: nowIso()
  }), 'GPR_OWNERSHIP_LOST');
  let calls = 0;
  await assertCodeAsync(() => store.performMutation(impostor, {
    expected_source_digest: digestValue(expectedStart),
    readAuthority: async () => ({ authority: expectedAuthority, later_controlling_comments: [] }),
    readSource: async () => expectedStart,
    mutate: async () => { calls += 1; }
  }), 'GPR_OWNERSHIP_LOST');
  assert.equal(calls, 0);
});
