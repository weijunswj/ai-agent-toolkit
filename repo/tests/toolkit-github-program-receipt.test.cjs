'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const receiptRuntimePath = path.resolve(__dirname, '../scripts/toolkit-github-program-receipt.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const {
  createProgrammeReceiptStore,
  digestValue,
  validateReceiptChain,
  validateReceiptObject
} = require(receiptRuntimePath);

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
  const root = fs.mkdtempSync(path.join(parent, 'store-'));
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

function start(seed = 'a') {
  const hex = seed.charCodeAt(0).toString(16).padStart(2, '0')[0];
  return {
    base_sha: '1'.repeat(40),
    head_sha: hex.repeat(40),
    tree_sha: '3'.repeat(40),
    status_digest: digestValue({ seed, status: [] }),
    clean_worktree: true,
    ref: { detached: false, name: 'feat/receipt-test' }
  };
}

function candidate(seed = '4') {
  return {
    pr_number: 400,
    branch: 'feat/receipt-test',
    base_ref: 'main',
    base_sha: '1'.repeat(40),
    head_sha: seed.repeat(40),
    tree_sha: '5'.repeat(40)
  };
}

function options(root = stateRoot(), child = 359) {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 240,
    child_issue: child,
    stateRoot: root,
    repositoryRoot
  };
}

function readers(expectedAuthority, expectedStart, now = '2026-08-30T11:00:00.000Z') {
  return {
    now,
    readAuthority: async () => ({ authority: structuredClone(expectedAuthority), later_controlling_comments: [] }),
    readStart: async () => structuredClone(expectedStart)
  };
}

async function startedStore(overrides = {}) {
  const storeOptions = overrides.storeOptions || options();
  const store = createProgrammeReceiptStore(storeOptions);
  const expectedAuthority = overrides.authority || authority();
  const expectedStart = overrides.start || start();
  const now = overrides.now || '2026-08-30T11:00:00.000Z';
  const session = await store.startRun({
    lock: overrides.lock || 'DL-S2-GITHUB-PROGRAM-RECEIPT-TEST-001',
    authority: expectedAuthority,
    start: expectedStart,
    candidate: null,
    lease_ms: overrides.lease_ms || 60000
  }, readers(expectedAuthority, expectedStart, now));
  return { store, session, expectedAuthority, expectedStart, now, storeOptions };
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

async function assertCodeAsync(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function resign(receipt) {
  const result = structuredClone(receipt);
  delete result.receipt_id;
  result.receipt_id = digestValue(result);
  return result;
}

function runChild(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { cwd: repositoryRoot, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr }));
  });
}

test('first allocation persists allocator-owned RUN_STARTED and fresh readback', async () => {
  const { store, session } = await startedStore();
  assert.equal(session.lease.fence_sequence, 1);
  assert.match(session.lease.lease_id, /^lease-/);
  assert.match(session.lease.fence_id, /^fence-/);
  const chain = store.readReceiptChain(session.run_id);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].receipt_type, 'RUN_STARTED');
  assert.equal(chain[0].sequence, 1);
  assert.equal(chain[0].prior_receipt_id, null);
  assert.equal(chain[0].candidate, null);
  assert.deepEqual(store.verifyFreshReadback(session.run_id), chain);
});

test('truthful pre-PR start rejects fake candidate and start movement', async () => {
  const root = stateRoot();
  const store = createProgrammeReceiptStore(options(root));
  const expectedAuthority = authority();
  const expectedStart = start();
  assertCode(() => store.allocateRun({
    lock: 'LOCK-FAKE-PR', authority: expectedAuthority, start: expectedStart,
    candidate: candidate(), lease_ms: 5000
  }), 'GPR_FAKE_START_CANDIDATE');

  const allocated = store.allocateRun({
    lock: 'LOCK-START-MOVED', authority: expectedAuthority, start: expectedStart,
    candidate: null, lease_ms: 5000
  });
  const moved = { ...expectedStart, head_sha: '9'.repeat(40) };
  await assertCodeAsync(() => store.startAllocatedRun(allocated, readers(expectedAuthority, moved, '2026-08-30T11:00:01.000Z')), 'GPR_START_CHANGED');
  assert.equal(store.classifyRecovery(allocated.run_id, allocated.lease.issued_at).status, 'UNSTARTED_ALLOCATION_ACTIVE');
});

test('candidate introduction is preview-only and immutable', async () => {
  const { store, session } = await startedStore();
  const introduced = candidate();
  const preview = store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW',
    candidate: introduced,
    payload: { classification: 'PREVIEWED' },
    created_at: nowIso()
  });
  assert.deepEqual(preview.receipt.candidate, introduced);
  store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW',
    candidate: introduced,
    payload: { classification: 'PREVIEWED_AGAIN' },
    created_at: nowIso()
  });
  assertCode(() => store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW',
    candidate: candidate('6'),
    payload: { classification: 'CHANGED' },
    created_at: nowIso()
  }), 'GPR_CANDIDATE_CHANGED');
  assert.equal(store.readReceiptChain(session.run_id).length, 3);
});

test('exact duplicate acknowledgement is idempotent and terminal closes the chain atomically', async () => {
  const { store, session } = await startedStore();
  const duplicateAt = nowIso();
  const input = {
    receipt_type: 'EXECUTOR_TERMINAL',
    payload: { classification: 'IMPLEMENTED' },
    created_at: duplicateAt
  };
  const first = store.appendReceipt(session, input);
  const duplicate = store.appendReceipt(session, input);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.receipt.receipt_id, first.receipt.receipt_id);
  assert.equal(store.classifyRecovery(session.run_id).status, 'TERMINAL');
  assertCode(() => store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW', payload: { classification: 'AFTER_TERMINAL' }, created_at: nowIso()
  }), 'GPR_RUN_TERMINAL');
});

test('active lease blocks a different Lock and expiry increments Child-wide fence', async () => {
  const root = stateRoot();
  const store = createProgrammeReceiptStore(options(root));
  const auth = authority();
  const initialStart = start();
  const old = await store.startRun({
    lock: 'LOCK-OLD', authority: auth, start: initialStart, candidate: null,
    lease_ms: 1000
  }, readers(auth, initialStart, '2026-08-30T11:00:00.000Z'));
  assertCode(() => store.allocateRun({
    lock: 'LOCK-NEW', authority: auth, start: initialStart, candidate: null,
    lease_ms: 1000
  }), 'GPR_ACTIVE_LEASE');
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const newer = store.allocateRun({
    lock: 'LOCK-NEW', authority: auth, start: initialStart, candidate: null,
    lease_ms: 1000
  });
  assert.equal(newer.lease.fence_sequence, 2);
  assertCode(() => store.appendReceipt(old, {
    receipt_type: 'RUN_INTERRUPTED', payload: { classification: 'OLD_HOLDER' }, created_at: nowIso()
  }), 'GPR_NEWER_FENCE_EXISTS');
});

test('different Children use independent fence high-water databases', () => {
  const root = stateRoot();
  const auth = authority();
  const initialStart = start();
  const first = createProgrammeReceiptStore(options(root, 359)).allocateRun({
    lock: 'LOCK-A', authority: auth, start: initialStart, candidate: null,
    lease_ms: 5000
  });
  const second = createProgrammeReceiptStore(options(root, 360)).allocateRun({
    lock: 'LOCK-B', authority: auth, start: initialStart, candidate: null,
    lease_ms: 5000
  });
  assert.equal(first.lease.fence_sequence, 1);
  assert.equal(second.lease.fence_sequence, 1);
});

test('repository casing aliases share one Child-wide coordination namespace', () => {
  const root = stateRoot();
  const upperOptions = { ...options(root), repository: 'WeiJunSWJ/AI-Agent-Toolkit' };
  const lowerOptions = options(root);
  const upper = createProgrammeReceiptStore(upperOptions);
  const lower = createProgrammeReceiptStore(lowerOptions);
  assert.equal(upper.databasePath, lower.databasePath);
  upper.allocateRun({
    lock: 'LOCK-CASE-A', authority: authority(), start: start(), candidate: null, lease_ms: 5000
  });
  assertCode(() => lower.allocateRun({
    lock: 'LOCK-CASE-B', authority: authority(), start: start(), candidate: null, lease_ms: 5000
  }), 'GPR_ACTIVE_LEASE');
});

test('real child processes serialize concurrent allocation', async () => {
  const root = stateRoot();
  const storeOptions = options(root);
  createProgrammeReceiptStore(storeOptions);
  const input = {
    lock: 'LOCK-CONCURRENT', authority: authority(), start: start(), candidate: null,
    lease_ms: 10000
  };
  const code = `
    const { createProgrammeReceiptStore } = require(${JSON.stringify(receiptRuntimePath)});
    try {
      const session = createProgrammeReceiptStore(${JSON.stringify(storeOptions)}).allocateRun(${JSON.stringify(input)});
      process.stdout.write(JSON.stringify({ ok: true, fence: session.lease.fence_sequence }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
    }
  `;
  const results = await Promise.all([runChild(code), runChild(code)]);
  const payloads = results.map((result) => JSON.parse(result.stdout));
  assert.equal(payloads.filter((item) => item.ok).length, 1);
  assert.equal(payloads.filter((item) => item.code === 'GPR_ACTIVE_LEASE').length, 1);
  assert.equal(payloads.find((item) => item.ok).fence, 1);
});

test('restart and fresh child process read the durable receipt chain', async () => {
  const { store, session, storeOptions } = await startedStore();
  store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW', payload: { classification: 'READY' },
    created_at: nowIso()
  });
  const restarted = createProgrammeReceiptStore(storeOptions);
  assert.equal(restarted.readReceiptChain(session.run_id).length, 2);
  const result = spawnSync(process.execPath, [
    receiptRuntimePath, 'inspect',
    '--repository', storeOptions.repository,
    '--parent-issue', String(storeOptions.parent_issue),
    '--child-issue', String(storeOptions.child_issue),
    '--state-root', storeOptions.stateRoot,
    '--repository-root', storeOptions.repositoryRoot,
    '--run-id', session.run_id
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).chain.length, 2);
});

test('serialized ownership and a different store object cannot mutate a live run', async () => {
  const { store, session, storeOptions } = await startedStore();
  const serialized = JSON.parse(JSON.stringify(session));
  assertCode(() => store.appendReceipt(serialized, {
    receipt_type: 'TRANSITION_PREVIEW', payload: { classification: 'IMPOSTOR' }, created_at: nowIso()
  }), 'GPR_OWNERSHIP_LOST');
  const reopened = createProgrammeReceiptStore(storeOptions);
  assertCode(() => reopened.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW', payload: { classification: 'WRONG_STORE' }, created_at: nowIso()
  }), 'GPR_OWNERSHIP_LOST');
});

test('unstarted allocation recovery is typed and does not adopt the run', () => {
  const store = createProgrammeReceiptStore(options());
  const allocated = store.allocateRun({
    lock: 'LOCK-UNSTARTED', authority: authority(), start: start(), candidate: null,
    lease_ms: 1000
  });
  assert.equal(store.classifyRecovery(allocated.run_id, allocated.lease.issued_at).status, 'UNSTARTED_ALLOCATION_ACTIVE');
  assert.equal(store.classifyRecovery(allocated.run_id, allocated.lease.expires_at).status, 'UNSTARTED_ALLOCATION_EXPIRED');
});

test('receipt validation rejects IDs, sequence regressions, chain breaks, and binding mismatches', async () => {
  const { store, session } = await startedStore();
  store.appendReceipt(session, {
    receipt_type: 'TRANSITION_PREVIEW', payload: { classification: 'READY' },
    created_at: nowIso()
  });
  const chain = store.readReceiptChain(session.run_id);
  const tampered = structuredClone(chain[0]);
  tampered.payload.classification = 'ALTERED';
  assertCode(() => validateReceiptObject(tampered), 'GPR_RECEIPT_TAMPERED');
  assertCode(() => validateReceiptChain([chain[0], chain[0]]), 'GPR_RECEIPT_DUPLICATE');

  const regression = resign({ ...chain[1], sequence: 3 });
  assertCode(() => validateReceiptChain([chain[0], regression]), 'GPR_SEQUENCE_REGRESSION');
  const broken = resign({ ...chain[1], prior_receipt_id: 'f'.repeat(64) });
  assertCode(() => validateReceiptChain([chain[0], broken]), 'GPR_CHAIN_BROKEN');

  for (const patch of [
    { repository: 'weijunswj/other' },
    { parent_issue: 241 },
    { child_issue: 360 },
    { lock: 'DIFFERENT-LOCK' }
  ]) {
    const mismatched = resign({ ...chain[1], ...patch });
    assertCode(() => validateReceiptChain([chain[0], mismatched]), 'GPR_CHAIN_BROKEN');
  }
});
