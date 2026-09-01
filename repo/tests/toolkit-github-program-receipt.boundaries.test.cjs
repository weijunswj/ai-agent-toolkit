'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const runtimePath = path.resolve(__dirname, '../scripts/toolkit-github-program-receipt.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const {
  LIMITS,
  assertRuntimeSupport,
  canonicalSerialize,
  createProgrammeReceiptStore,
  digestValue,
  orphanTakeoverAuthorityScopeDigest,
  verifierIdentityDigest,
  validateOperationDescriptor,
  validateVerifierProcessResult,
  validateWindowsStorageProof
} = require(runtimePath);

const cleanupRoots = new Set();
const liveChildren = new Set();

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
  for (const child of liveChildren) child.kill();
  liveChildren.clear();
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

test('fresh-process verifier protocol rejects spawn, timeout, malformed, noncanonical, extra, stderr, digest, state, and runtime faults', () => {
  const expected = verificationPacket();
  const run = (stdout, stderr = '') => spawnSync(process.execPath, ['--no-warnings', '-e',
    'process.stdout.write(process.env.GPR_STDOUT); process.stderr.write(process.env.GPR_STDERR)'], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, GPR_STDOUT: stdout, GPR_STDERR: stderr }
  });
  assert.deepEqual(validateVerifierProcessResult(run(`${canonicalSerialize(expected)}\n`), expected), expected);
  for (const result of [
    run('{bad json}\n'),
    run(`${JSON.stringify(expected)}\n`),
    run(`${canonicalSerialize(expected)}\nextra\n`),
    run(`${canonicalSerialize(expected)}\n`, 'unexpected stderr'),
    run(`${canonicalSerialize({ ...expected, packet_digest: 'a'.repeat(64) })}\n`),
    run(`${canonicalSerialize(verificationPacket({ chain_digest: 'a'.repeat(64) }))}\n`),
    run(`${canonicalSerialize(verificationPacket({ store_state_digest: 'b'.repeat(64) }))}\n`),
    run(`${canonicalSerialize(verificationPacket({ runtime_identity_digest: 'c'.repeat(64) }))}\n`),
    run('x'.repeat(17 * 1024)),
    run('', 'x'.repeat(17 * 1024)),
    spawnSync(process.execPath, ['-e', 'process.exit(7)'], { encoding: 'utf8' }),
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { encoding: 'utf8', timeout: 20 }),
    spawnSync(path.join(stateRoot(), 'missing-node.exe'), [], { encoding: 'utf8' })
  ]) assertCode(() => validateVerifierProcessResult(result, expected), 'GPR_FRESH_PROCESS_VERIFICATION_FAILED');
});

test('the verifier child opens the existing store read-only and cannot append, adopt, or create operations', async () => {
  const current = await fixture();
  const before = current.store.readReceiptChain(current.session.run_id);
  const result = spawnSync(process.execPath, [
    '--no-warnings', runtimePath, 'verify-run-started',
    '--repository', current.storeOptions.repository,
    '--parent-issue', String(current.storeOptions.parent_issue),
    '--child-issue', String(current.storeOptions.child_issue),
    '--state-root', current.storeOptions.stateRoot,
    '--repository-root', current.storeOptions.repositoryRoot,
    '--run-id', current.session.run_id,
    '--allocation-id', current.session.allocation_id,
    '--receipt-id', current.session.run_started_receipt_id
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.split('\n').filter(Boolean).length, 1);
  assert.deepEqual(current.store.readReceiptChain(current.session.run_id), before);
  const db = new DatabaseSync(current.store.databasePath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS value FROM mutation_operations').get().value, 0);
  db.close();
});

test('mandatory verifier launch strips Node preload and module-path injection variables', async () => {
  const originalOptions = process.env.NODE_OPTIONS;
  const originalPath = process.env.NODE_PATH;
  process.env.NODE_OPTIONS = '--require=C:\\definitely-missing-gpr-preload.cjs';
  process.env.NODE_PATH = 'C:\\untrusted-gpr-modules';
  try {
    const current = await fixture();
    assert.equal(current.store.readReceiptChain(current.session.run_id)[0].receipt_type, 'RUN_STARTED');
  } finally {
    if (originalOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalOptions;
    if (originalPath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = originalPath;
  }
});

test('fresh verifier rejects a validly re-digested but altered RUN_STARTED receipt chain', async () => {
  const current = await fixture();
  const tamper = `
    const { DatabaseSync } = require('node:sqlite');
    const { canonicalSerialize, digestValue } = require(${JSON.stringify(runtimePath)});
    const db = new DatabaseSync(${JSON.stringify(current.store.databasePath)});
    const row = db.prepare('SELECT * FROM receipts WHERE run_id=?').get(${JSON.stringify(current.session.run_id)});
    const receipt = JSON.parse(row.canonical_json);
    receipt.payload.classification = 'ALTERED_AFTER_COMMIT';
    receipt.receipt_id = '';
    const payload = structuredClone(receipt); delete payload.receipt_id;
    receipt.receipt_id = digestValue(payload);
    db.exec('DROP TRIGGER receipts_no_update');
    db.prepare('UPDATE receipts SET receipt_id=?, canonical_json=?, receipt_digest=? WHERE run_id=?').run(receipt.receipt_id, canonicalSerialize(receipt), receipt.receipt_id, receipt.run_id);
    db.exec("CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    db.close();
  `;
  assert.equal(spawnSync(process.execPath, ['-e', tamper], { encoding: 'utf8' }).status, 0);
  const result = spawnSync(process.execPath, [
    '--no-warnings', runtimePath, 'verify-run-started',
    '--repository', current.storeOptions.repository,
    '--parent-issue', String(current.storeOptions.parent_issue),
    '--child-issue', String(current.storeOptions.child_issue),
    '--state-root', current.storeOptions.stateRoot,
    '--repository-root', current.storeOptions.repositoryRoot,
    '--run-id', current.session.run_id,
    '--allocation-id', current.session.allocation_id,
    '--receipt-id', current.session.run_started_receipt_id
  ], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /GPR_VERIFICATION_PACKET_INVALID/);
});

async function assertCodeAsync(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function descriptor(overrides = {}) {
  const targetIdentity = overrides.target_identity || { resource_type: 'git_ref', resource_id: 'refs/heads/main' };
  return {
    operation_kind: 'GIT_REF_UPDATE',
    safety_class: 'CAS',
    target_identity: targetIdentity,
    target_digest: digestValue(targetIdentity),
    expected_source_digest: digestValue('source-a'),
    cas_digest: digestValue('cas-a'),
    expected_post_state_digest: digestValue('post-a'),
    adapter_identity_digest: digestValue('trusted-git-ref-adapter-v1'),
    retry_of_operation_id: null,
    ...overrides
  };
}

function trustedReaders(expectedAuthority, operationDescriptor, overrides = {}) {
  return {
    readAuthority: overrides.readAuthority || (async () => ({ authority: structuredClone(expectedAuthority), later_controlling_comments: [] })),
    readSource: overrides.readSource || (async () => ({
      source_digest: operationDescriptor.expected_source_digest,
      cas_digest: operationDescriptor.cas_digest
    })),
    verifyOutcomeEvidence: overrides.verifyOutcomeEvidence || (async (evidence) => structuredClone(evidence))
  };
}

function outcomeEvidence(operation, classification, overrides = {}) {
  const evidence = {
    operation_id: operation.operation_id,
    logical_operation_digest: operation.logical_operation_digest,
    adapter_identity_digest: operation.adapter_identity_digest,
    target_identity: operation.target_identity,
    target_digest: operation.target_digest,
    provider_operation_key: operation.provider_operation_key,
    cas_digest: operation.cas_digest,
    classification,
    observed_post_state_digest: classification === 'APPLIED'
      ? operation.expected_post_state_digest || digestValue('created-resource') : null,
    rejection_digest: classification === 'NOT_APPLIED' ? digestValue('definitive-pre-effect-rejection') : null,
    delayed_completion_excluded: classification === 'NOT_APPLIED',
    evidence_at: nowIso(),
    evidence_digest: '',
    ...overrides
  };
  const digestInput = structuredClone(evidence);
  delete digestInput.evidence_digest;
  evidence.evidence_digest = digestValue(digestInput);
  return evidence;
}

async function admittedFixture(overrides = {}) {
  const base = await fixture(overrides);
  const operationDescriptor = overrides.descriptor || descriptor();
  const readersForOperation = overrides.trustedReaders || trustedReaders(base.expectedAuthority, operationDescriptor);
  const admission = await base.store.admitMutationOperation(base.session, operationDescriptor, readersForOperation);
  return { ...base, operationDescriptor, readersForOperation, admission };
}

function orphanFixture(overrides = {}) {
  const root = stateRoot();
  const storeOptions = options(root);
  const expectedAuthority = overrides.authority || authority(overrides.seed || 'orphan');
  const expectedStart = overrides.start || start();
  const leaseMs = overrides.lease_ms || 60000;
  const operationState = overrides.operationState || null;
  const operationDescriptor = operationState ? (overrides.descriptor || descriptor()) : null;
  const childCode = `
    const runtime = require(${JSON.stringify(runtimePath)});
    const auth = ${JSON.stringify(expectedAuthority)};
    const start = ${JSON.stringify(expectedStart)};
    const operationState = ${JSON.stringify(operationState)};
    const operationDescriptor = ${JSON.stringify(operationDescriptor)};
    function outcomeEvidence(operation, classification) {
      const evidence = {
        operation_id: operation.operation_id,
        logical_operation_digest: operation.logical_operation_digest,
        adapter_identity_digest: operation.adapter_identity_digest,
        target_identity: operation.target_identity,
        target_digest: operation.target_digest,
        provider_operation_key: operation.provider_operation_key,
        cas_digest: operation.cas_digest,
        classification,
        observed_post_state_digest: classification === 'APPLIED' ? operation.expected_post_state_digest : null,
        rejection_digest: classification === 'NOT_APPLIED' ? runtime.digestValue('definitive-pre-effect-rejection') : null,
        delayed_completion_excluded: classification === 'NOT_APPLIED',
        evidence_at: new Date().toISOString(),
        evidence_digest: ''
      };
      const digestInput = structuredClone(evidence);
      delete digestInput.evidence_digest;
      evidence.evidence_digest = runtime.digestValue(digestInput);
      return evidence;
    }
    (async () => {
      const store = runtime.createProgrammeReceiptStore(${JSON.stringify(storeOptions)});
      const session = await store.startRun({
        lock: ${JSON.stringify(overrides.lock || 'LOCK-ORPHAN')},
        authority: auth,
        start,
        candidate: null,
        lease_ms: ${leaseMs}
      }, {
        readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
        readStart: async () => start
      });
      if (operationDescriptor) {
        const admission = await store.admitMutationOperation(session, operationDescriptor, {
          readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
          readSource: async () => ({
            source_digest: operationDescriptor.expected_source_digest,
            cas_digest: operationDescriptor.cas_digest
          }),
          verifyOutcomeEvidence: async (evidence) => structuredClone(evidence)
        });
        const operation = await store.authorizeMutationDispatch(session, admission);
        if (operationState !== 'IN_FLIGHT') {
          await store.recordMutationOutcome(session, admission, outcomeEvidence(operation, operationState));
        }
      }
      process.stdout.write(JSON.stringify({ run_id: session.run_id, allocation_id: session.allocation_id }));
    })().catch((error) => {
      process.stderr.write(error.code || error.message);
      process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, ['--no-warnings', '-e', childCode], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const identifiers = JSON.parse(child.stdout);
  const store = createProgrammeReceiptStore(storeOptions);
  return {
    store,
    storeOptions,
    expectedAuthority,
    expectedStart,
    oldRunId: identifiers.run_id,
    oldAllocationId: identifiers.allocation_id
  };
}

function orphanTarget(current) {
  const db = new DatabaseSync(current.store.databasePath, { readOnly: true });
  const allocation = db.prepare('SELECT * FROM allocations WHERE allocation_id = ? AND run_id = ?')
    .get(current.oldAllocationId, current.oldRunId);
  const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(current.oldRunId);
  const startSnapshot = JSON.parse(allocation.start_json);
  db.close();
  const chain = current.store.readReceiptChain(current.oldRunId);
  return {
    repository: current.storeOptions.repository,
    parent_issue: current.storeOptions.parent_issue,
    child_issue: current.storeOptions.child_issue,
    lock: allocation.lock_id,
    run_id: allocation.run_id,
    allocation_id: allocation.allocation_id,
    allocation_digest: allocation.allocation_digest,
    run_digest: run.run_digest,
    receipt_tip_id: chain.at(-1).receipt_id,
    receipt_chain_digest: digestValue(chain),
    authority_digest: digestValue(JSON.parse(allocation.authority_json)),
    start_digest: digestValue(startSnapshot),
    lease_digest: digestValue({
      lease_id: allocation.lease_id,
      fence_id: allocation.fence_id,
      fence_sequence: allocation.fence_sequence,
      issued_at: allocation.issued_at,
      expires_at: allocation.expires_at
    }),
    operation_inventory_digest: digestValue([]),
    operation_count: 0,
    namespace_unresolved_operation_count: 0
  };
}

function takeoverRequest(current, overrides = {}) {
  const base = orphanTarget(current);
  const target = { ...base, ...(overrides.target || {}) };
  const requestId = overrides.request_id || ('recovery-request-' + process.pid + '-' + Date.now());
  const observedStart = structuredClone(overrides.observed_start || current.expectedStart);
  const attestationInput = {
    attestation_id: overrides.attestation_id || ('orphan-attestation-' + process.pid + '-' + Date.now()),
    run_id: target.run_id,
    allocation_id: target.allocation_id,
    observed_at: new Date().toISOString(),
    holder_nonadoptable: true,
    operation_count: 0,
    namespace_unresolved_operation_count: 0,
    operation_inventory_digest: target.operation_inventory_digest,
    start_digest: target.start_digest,
    verifier_identity_digest: verifierIdentityDigest(),
    ...(overrides.orphan_attestation || {})
  };
  delete attestationInput.attestation_digest;
  attestationInput.attestation_digest = digestValue(attestationInput);
  const recoveryAuthority = {
    ...authority(overrides.recovery_authority_seed || 'recovery'),
    ...(overrides.recovery_authority || {})
  };
  if (!Object.prototype.hasOwnProperty.call(overrides.recovery_authority || {}, 'scope_digest')) {
    recoveryAuthority.scope_digest = orphanTakeoverAuthorityScopeDigest(
      target, attestationInput.attestation_digest, requestId
    );
  }
  return {
    request_id: requestId,
    target,
    observed_start: observedStart,
    recovery_authority: recoveryAuthority,
    later_controlling_comment_ids: overrides.later_controlling_comment_ids || [],
    orphan_attestation: attestationInput,
    lease_ms: overrides.lease_ms || 60000
  };
}

function trustedRecoveryReaders(current, request, overrides = {}) {
  return {
    readAuthority: overrides.readAuthority || (async () => ({
      authority: structuredClone(request.recovery_authority),
      later_controlling_comments: []
    })),
    readStart: overrides.readStart || (async () => structuredClone(current.expectedStart)),
    readOrphanStatus: overrides.readOrphanStatus || (async () => ({
      status: 'ORPHAN_NONADOPTABLE',
      orphan_attestation: structuredClone(request.orphan_attestation)
    }))
  };
}

function ledgerCounts(store) {
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  const counts = {};
  for (const table of ['allocations', 'runs', 'receipts', 'lease_events', 'mutation_operations', 'mutation_operation_events']) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value;
  }
  counts.high_water = db.prepare('SELECT high_water FROM coordination_state WHERE singleton = 1').get().high_water;
  db.close();
  return counts;
}

function childEnvironment() {
  const env = { ...process.env };
  delete env.PSModulePath;
  return env;
}

function takeoverInChild(current, request) {
  return new Promise((resolve, reject) => {
    const code = `
      const runtime = require(${JSON.stringify(runtimePath)});
      (async () => {
        const store = runtime.createProgrammeReceiptStore(${JSON.stringify(current.storeOptions)});
        const request = ${JSON.stringify(request)};
        const result = await store.takeoverAbandonedRun(request, {
          readAuthority: async () => ({ authority: request.recovery_authority, later_controlling_comments: [] }),
          readStart: async () => (${JSON.stringify(current.expectedStart)}),
          readOrphanStatus: async () => ({
            status: 'ORPHAN_NONADOPTABLE',
            orphan_attestation: request.orphan_attestation
          })
        });
        process.stdout.write(JSON.stringify({
          ok: true,
          status: result.status,
          duplicate: result.duplicate,
          request_id: result.recovery.request_id,
          replacement_run_id: result.recovery.replacement.allocation.run_id
        }));
      })().catch((error) => {
        process.stdout.write(JSON.stringify({ ok: false, code: error.code || error.message }));
      });
    `;
    const child = spawn(process.execPath, ['--no-warnings', '-e', code], {
      cwd: repositoryRoot,
      env: childEnvironment(),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        resolve({ status, stdout: JSON.parse(stdout), stderr });
      } catch (error) {
        reject(new Error(`takeover child failed: status=${status} stdout=${stdout} stderr=${stderr}`, { cause: error }));
      }
    });
  });
}

function liveOrphanFixture(overrides = {}) {
  return new Promise((resolve, reject) => {
    const root = stateRoot();
    const storeOptions = options(root);
    const expectedAuthority = overrides.authority || authority(overrides.seed || 'live-orphan');
    const expectedStart = overrides.start || start();
    const operationDescriptor = descriptor();
    const childCode = `
      const runtime = require(${JSON.stringify(runtimePath)});
      const auth = ${JSON.stringify(expectedAuthority)};
      const start = ${JSON.stringify(expectedStart)};
      const operationDescriptor = ${JSON.stringify(operationDescriptor)};
      let session;
      let store;
      const commands = [];
      let busy = false;
      function outcome(value) {
        process.stdout.write(JSON.stringify(value) + '\\n');
      }
      async function handle(command) {
        if (command === 'append') {
          try {
            store.appendReceipt(session, {
              receipt_type: 'TRANSITION_PREVIEW',
              payload: { classification: 'OLD_HOLDER_APPEND' },
              created_at: new Date().toISOString()
            });
            outcome({ command, ok: true });
          } catch (error) {
            outcome({ command, ok: false, code: error.code || error.message });
          }
        } else if (command === 'operation') {
          try {
            const admission = await store.admitMutationOperation(session, operationDescriptor, {
              readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
              readSource: async () => ({
                source_digest: operationDescriptor.expected_source_digest,
                cas_digest: operationDescriptor.cas_digest
              }),
              verifyOutcomeEvidence: async (evidence) => evidence
            });
            outcome({ command, ok: true, operation_id: admission.operation_id });
          } catch (error) {
            outcome({ command, ok: false, code: error.code || error.message });
          }
        } else if (command === 'close') {
          outcome({ command, ok: true });
          process.exit(0);
        }
      }
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        commands.push(...chunk.split(/\\r?\\n/).filter(Boolean));
        if (busy) return;
        busy = true;
        (async () => {
          while (commands.length) await handle(commands.shift());
          busy = false;
        })().catch((error) => {
          outcome({ ok: false, code: error.code || error.message });
          process.exit(1);
        });
      });
      (async () => {
        store = runtime.createProgrammeReceiptStore(${JSON.stringify(storeOptions)});
        session = await store.startRun({
          lock: ${JSON.stringify(overrides.lock || 'LOCK-LIVE-ORPHAN')},
          authority: auth,
          start,
          candidate: null,
          lease_ms: ${overrides.lease_ms || 60000}
        }, {
          readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
          readStart: async () => start
        });
        outcome({ ready: true, run_id: session.run_id, allocation_id: session.allocation_id });
      })().catch((error) => {
        process.stderr.write(error.code || error.message);
        process.exit(1);
      });
    `;
    const child = spawn(process.execPath, ['--no-warnings', '-e', childCode], {
      cwd: repositoryRoot,
      env: childEnvironment(),
      windowsHide: true
    });
    liveChildren.add(child);
    const messages = [];
    const waiters = [];
    let buffer = '';
    const flush = () => {
      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const waiter = waiters.shift();
        if (waiter) waiter(message);
        else messages.push(message);
      }
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      flush();
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const close = new Promise((resolveClose) => child.on('close', (status) => {
      liveChildren.delete(child);
      resolveClose({ status, stderr });
    }));
    child.on('error', reject);
    const nextMessage = () => messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolveMessage) => waiters.push(resolveMessage));
    nextMessage().then((ready) => {
      if (!ready.ready) {
        reject(new Error('live orphan holder did not become ready'));
        return;
      }
      resolve({
        store: createProgrammeReceiptStore(storeOptions),
        storeOptions,
        expectedAuthority,
        expectedStart,
        oldRunId: ready.run_id,
        oldAllocationId: ready.allocation_id,
        child,
        nextMessage,
        close
      });
    }).catch(reject);
  });
}

function verificationPacket(overrides = {}) {
  const packet = {
    schema: 'toolkit.github-program.run-started-verification.v1',
    run_id: 'run-test',
    allocation_id: 'allocation-test',
    receipt_id: '1'.repeat(64),
    receipt_sequence: 1,
    namespace_digest: '2'.repeat(64),
    authority_digest: '3'.repeat(64),
    start_digest: '4'.repeat(64),
    lease_id: 'lease-test',
    fence_id: 'fence-test',
    fence_sequence: 1,
    chain_digest: '5'.repeat(64),
    store_state_digest: '6'.repeat(64),
    store_identity_digest: '7'.repeat(64),
    node_executable_realpath_digest: '8'.repeat(64),
    runtime_identity_digest: '9'.repeat(64),
    node_version: process.versions.node,
    packet_digest: '',
    ...overrides
  };
  const digestInput = structuredClone(packet);
  delete digestInput.packet_digest;
  packet.packet_digest = digestValue(digestInput);
  return packet;
}

test('declarative operation admission rejects authority, source, CAS, callback, and bundle movement', async () => {
  const { store, session, expectedAuthority } = await fixture();
  const operationDescriptor = descriptor();
  assert.equal(typeof store.performMutation, 'undefined');
  assertCode(() => validateOperationDescriptor({ ...operationDescriptor, mutate() {} }), 'GPR_OPERATION_DESCRIPTOR_INVALID');
  assertCode(() => validateOperationDescriptor({
    ...operationDescriptor,
    target_identity: { resource_type: 'bundle', resource_id: 'resource-a,resource-b' },
    target_digest: digestValue({ resource_type: 'bundle', resource_id: 'resource-a,resource-b' })
  }), 'GPR_OPERATION_DESCRIPTOR_INVALID');
  await assertCodeAsync(() => store.admitMutationOperation(session, operationDescriptor, trustedReaders(expectedAuthority, operationDescriptor, {
    readAuthority: async () => ({ authority: expectedAuthority, later_controlling_comments: [{ comment_id: 999 }] })
  })), 'GPR_AUTHORITY_CHANGED');
  await assertCodeAsync(() => store.admitMutationOperation(session, operationDescriptor, trustedReaders(expectedAuthority, operationDescriptor, {
    readSource: async () => ({ source_digest: digestValue('moved'), cas_digest: operationDescriptor.cas_digest })
  })), 'GPR_SOURCE_CHANGED');
  await assertCodeAsync(() => store.admitMutationOperation(session, operationDescriptor, trustedReaders(expectedAuthority, operationDescriptor, {
    readSource: async () => ({ source_digest: operationDescriptor.expected_source_digest, cas_digest: digestValue('moved-cas') })
  })), 'GPR_SOURCE_CHANGED');
});

test('one opaque admission authorizes exactly one immediate trusted-host dispatch', async () => {
  const { store, session, admission } = await admittedFixture();
  assertCode(() => JSON.stringify(admission), 'GPR_ADMISSION_NONSERIALIZABLE');
  const operation = await store.authorizeMutationDispatch(session, admission);
  assert.equal(operation.operation_id, admission.operation_id);
  await assertCodeAsync(() => store.authorizeMutationDispatch(session, admission), 'GPR_ADMISSION_CONSUMED');
  assert.equal(store.readMutationOperation(operation.operation_id).state, 'IN_FLIGHT');
});

test('later controlling authority after admission refuses dispatch with zero provider writes', async () => {
  const current = await fixture();
  const operationDescriptor = descriptor();
  let authorityMoved = false;
  let providerWrites = 0;
  const currentReaders = trustedReaders(current.expectedAuthority, operationDescriptor, {
    readAuthority: async () => ({
      authority: structuredClone(current.expectedAuthority),
      later_controlling_comments: authorityMoved ? [{ comment_id: 5474456292 }] : []
    })
  });
  const admission = await current.store.admitMutationOperation(
    current.session, operationDescriptor, currentReaders
  );
  const dispatch = async () => {
    const operation = await current.store.authorizeMutationDispatch(current.session, admission);
    providerWrites += 1;
    return operation;
  };
  authorityMoved = true;
  await assertCodeAsync(dispatch, 'GPR_AUTHORITY_CHANGED');
  assert.equal(providerWrites, 0);
  assert.equal(current.store.readMutationOperation(admission.operation_id).state, 'IN_FLIGHT');
});

test('authority movement between completed operations blocks the next admission with zero additional provider writes', async () => {
  const current = await fixture();
  let authorityMoved = false;
  let providerWrites = 0;
  const readAuthority = async () => ({
    authority: structuredClone(current.expectedAuthority),
    later_controlling_comments: authorityMoved ? [{ comment_id: 5474458663 }] : []
  });
  const firstDescriptor = descriptor();
  const firstAdmission = await current.store.admitMutationOperation(current.session, firstDescriptor,
    trustedReaders(current.expectedAuthority, firstDescriptor, { readAuthority }));
  const firstOperation = await current.store.authorizeMutationDispatch(current.session, firstAdmission);
  providerWrites += 1;
  await current.store.recordMutationOutcome(
    current.session, firstAdmission, outcomeEvidence(firstOperation, 'APPLIED')
  );
  assert.equal(current.store.readMutationOperation(firstOperation.operation_id).state, 'APPLIED');

  const secondDescriptor = descriptor({
    target_identity: { resource_type: 'git_ref', resource_id: 'refs/heads/next' },
    target_digest: digestValue({ resource_type: 'git_ref', resource_id: 'refs/heads/next' }),
    expected_post_state_digest: digestValue('post-next')
  });
  authorityMoved = true;
  await assertCodeAsync(() => current.store.admitMutationOperation(current.session, secondDescriptor,
    trustedReaders(current.expectedAuthority, secondDescriptor, { readAuthority })),
  'GPR_AUTHORITY_CHANGED');
  assert.equal(providerWrites, 1);
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

test('a newer fence created before operation admission rejects the stale started holder', async () => {
  const current = await fixture({ lease_ms: 5000 });
  await new Promise((resolve) => setTimeout(resolve,
    Math.max(0, Date.parse(current.session.lease.expires_at) - Date.now() + 30)));
  const newer = current.store.allocateRun({
    lock: 'LOCK-NEWER-FENCE', authority: current.expectedAuthority, start: current.expectedStart,
    candidate: null, lease_ms: 60000
  });
  assert.equal(newer.lease.fence_sequence, current.session.lease.fence_sequence + 1);
  const operationDescriptor = descriptor();
  await assertCodeAsync(() => current.store.admitMutationOperation(current.session, operationDescriptor,
    trustedReaders(current.expectedAuthority, operationDescriptor)), 'GPR_NEWER_FENCE_EXISTS');
});

test('same-process allocation alone cannot grant operation admission before verified RUN_STARTED', async () => {
  const root = stateRoot();
  const store = createProgrammeReceiptStore(options(root));
  const expectedAuthority = authority();
  const expectedStart = start();
  const allocated = store.allocateRun({
    lock: 'LOCK-ZERO-MUTATION', authority: expectedAuthority, start: expectedStart,
    candidate: null, lease_ms: 60000
  });
  const operationDescriptor = descriptor();
  await assertCodeAsync(() => store.admitMutationOperation(allocated, operationDescriptor,
    trustedReaders(expectedAuthority, operationDescriptor)), 'GPR_RUN_NOT_FRESHLY_VERIFIED');
  const started = await store.startAllocatedRun(allocated, readers(expectedAuthority, expectedStart, '2026-08-30T11:00:00.000Z'));
  const admission = await store.admitMutationOperation(started, operationDescriptor,
    trustedReaders(expectedAuthority, operationDescriptor));
  assert.equal(store.readMutationOperation(admission.operation_id).state, 'IN_FLIGHT');
});

test('IN_FLIGHT and UNKNOWN are durable Child-wide holds across release, Lock change, and terminal attempts', async () => {
  const { store, session, expectedAuthority, expectedStart, admission } = await admittedFixture();
  const secondTarget = { resource_type: 'git_ref', resource_id: 'refs/heads/other' };
  const secondDescriptor = descriptor({ target_identity: secondTarget, target_digest: digestValue(secondTarget) });
  await assertCodeAsync(() => store.admitMutationOperation(session, secondDescriptor,
    trustedReaders(expectedAuthority, secondDescriptor)), 'GPR_UNRESOLVED_OPERATION');
  assertCode(() => store.allocateRun({
    lock: 'LOCK-NEW', authority: expectedAuthority, start: expectedStart, candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
  assertCode(() => store.appendReceipt(session, {
    receipt_type: 'EXECUTOR_TERMINAL', payload: { classification: 'SUCCESS' }, created_at: nowIso()
  }), 'GPR_UNRESOLVED_OPERATION');
  store.interruptRun(session, { payload: { classification: 'PROCESS_DIED' }, created_at: nowIso() });
  assertCode(() => store.allocateRun({
    lock: 'LOCK-NEW', authority: expectedAuthority, start: expectedStart, candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
  const operation = store.readMutationOperation(admission.operation_id).operation;
  const reconciled = await store.reconcileMutationOperation(operation.operation_id,
    async () => ({ authority: authority('reconcile'), later_controlling_comments: [] }),
    async () => outcomeEvidence(operation, 'UNKNOWN'));
  assert.equal(reconciled.state, 'UNKNOWN');
  assertCode(() => store.allocateRun({
    lock: 'LOCK-NEWER', authority: expectedAuthority, start: expectedStart, candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
});

test('closed adapter-bound outcome evidence records exact APPLIED, NOT_APPLIED, and UNKNOWN states', async () => {
  for (const classification of ['APPLIED', 'NOT_APPLIED', 'UNKNOWN']) {
    const current = await admittedFixture();
    const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
    const result = await current.store.recordMutationOutcome(current.session, current.admission,
      outcomeEvidence(operation, classification));
    assert.equal(result.state, classification);
    assert.equal(result.events.at(-1).provider_evidence_digest,
      outcomeEvidence(operation, classification, { evidence_at: result.events.at(-1).event_at }).evidence_digest);
  }
});

test('arbitrary, wrong-operation, wrong-adapter, and incomplete outcome claims fail closed to UNKNOWN', async () => {
  const invalidEvidence = [
    (operation) => ({ classification: 'APPLIED' }),
    (operation) => outcomeEvidence(operation, 'APPLIED', { operation_id: 'operation-wrong' }),
    (operation) => outcomeEvidence(operation, 'APPLIED', { adapter_identity_digest: digestValue('wrong-adapter') }),
    (operation) => outcomeEvidence(operation, 'NOT_APPLIED', { delayed_completion_excluded: false })
  ];
  for (const createEvidence of invalidEvidence) {
    const current = await admittedFixture();
    const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
    await assertCodeAsync(() => current.store.recordMutationOutcome(current.session, current.admission,
      createEvidence(operation)), 'GPR_OUTCOME_EVIDENCE_INVALID');
    assert.equal(current.store.readMutationOperation(operation.operation_id).state, 'UNKNOWN');
  }
});

test('failure to append UNKNOWN leaves the already committed IN_FLIGHT hold authoritative', async () => {
  const current = await admittedFixture();
  await current.store.authorizeMutationDispatch(current.session, current.admission);
  const locker = new DatabaseSync(current.store.databasePath);
  locker.exec('BEGIN IMMEDIATE');
  try {
    await assert.rejects(() => current.store.recordMutationOutcome(current.session, current.admission,
      { classification: 'APPLIED' }));
  } finally {
    locker.exec('ROLLBACK');
    locker.close();
  }
  assert.equal(current.store.readMutationOperation(current.admission.operation_id).state, 'IN_FLIGHT');
  assertCode(() => current.store.allocateRun({
    lock: 'LOCK-AFTER-UNKNOWN-WRITE-FAILURE', authority: current.expectedAuthority,
    start: current.expectedStart, candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
});

test('fresh authority and exact provider readback reconcile unresolved operations without adopting the old run', async () => {
  for (const classification of ['APPLIED', 'NOT_APPLIED', 'UNKNOWN']) {
    const current = await admittedFixture();
    const operation = current.store.readMutationOperation(current.admission.operation_id).operation;
    current.store.interruptRun(current.session, { payload: { classification: 'OWNER_DIED' }, created_at: nowIso() });
    const reopened = createProgrammeReceiptStore(current.storeOptions);
    const beforeChain = reopened.readReceiptChain(current.session.run_id);
    const result = await reopened.reconcileMutationOperation(operation.operation_id,
      async () => ({ authority: authority(`reconcile-${classification}`), later_controlling_comments: [] }),
      async () => outcomeEvidence(operation, classification));
    assert.equal(result.state, classification);
    assert.deepEqual(reopened.readReceiptChain(current.session.run_id), beforeChain);
  }
});

test('lease expiry before dispatch performs zero writes and cannot permit takeover or a newer fence', async () => {
  const current = await admittedFixture({ lease_ms: 10000 });
  let writes = 0;
  await new Promise((resolve) => setTimeout(resolve,
    Math.max(0, Date.parse(current.session.lease.expires_at) - Date.now() + 30)));
  await assertCodeAsync(() => current.store.authorizeMutationDispatch(current.session, current.admission), 'GPR_EXPIRED_FENCE');
  assert.equal(writes, 0);
  assert.equal(current.store.readMutationOperation(current.admission.operation_id).state, 'IN_FLIGHT');
  assertCode(() => current.store.allocateRun({
    lock: 'LOCK-AFTER-EXPIRY', authority: current.expectedAuthority, start: current.expectedStart,
    candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
});

test('APPLIED is non-retryable while unchanged freshly revalidated NOT_APPLIED retry is accepted', async () => {
  const applied = await admittedFixture();
  const appliedOperation = await applied.store.authorizeMutationDispatch(applied.session, applied.admission);
  await applied.store.recordMutationOutcome(applied.session, applied.admission, outcomeEvidence(appliedOperation, 'APPLIED'));
  applied.store.interruptRun(applied.session, { payload: { classification: 'COMPLETE' }, created_at: nowIso() });
  const appliedSession = await applied.store.startRun({
    lock: 'LOCK-APPLIED-RETRY', authority: applied.expectedAuthority, start: applied.expectedStart,
    candidate: null, lease_ms: 60000
  }, readers(applied.expectedAuthority, applied.expectedStart, nowIso()));
  const appliedRetry = descriptor({
    retry_of_operation_id: appliedOperation.operation_id
  });
  await assertCodeAsync(() => applied.store.admitMutationOperation(appliedSession, appliedRetry,
    trustedReaders(applied.expectedAuthority, appliedRetry)), 'GPR_OPERATION_ALREADY_APPLIED');

  const notApplied = await admittedFixture();
  const notAppliedOperation = await notApplied.store.authorizeMutationDispatch(notApplied.session, notApplied.admission);
  await notApplied.store.recordMutationOutcome(notApplied.session, notApplied.admission,
    outcomeEvidence(notAppliedOperation, 'NOT_APPLIED'));
  notApplied.store.interruptRun(notApplied.session, { payload: { classification: 'RETRYABLE' }, created_at: nowIso() });
  const retrySession = await notApplied.store.startRun({
    lock: 'LOCK-NOT-APPLIED-RETRY', authority: notApplied.expectedAuthority, start: notApplied.expectedStart,
    candidate: null, lease_ms: 60000
  }, readers(notApplied.expectedAuthority, notApplied.expectedStart, nowIso()));
  await assertCodeAsync(() => notApplied.store.admitMutationOperation(retrySession, notApplied.operationDescriptor,
    trustedReaders(notApplied.expectedAuthority, notApplied.operationDescriptor)), 'GPR_RETRY_REQUIRES_REFERENCE');
  const explicitRetry = {
    ...notApplied.operationDescriptor,
    retry_of_operation_id: notAppliedOperation.operation_id
  };
  const retryAdmission = await notApplied.store.admitMutationOperation(retrySession, explicitRetry,
    trustedReaders(notApplied.expectedAuthority, explicitRetry));
  const retry = notApplied.store.readMutationOperation(retryAdmission.operation_id);
  assert.equal(retry.state, 'IN_FLIGHT');
  assert.notEqual(retry.operation.run_id, notAppliedOperation.run_id);
  assert.equal(retry.operation.fence_sequence > notAppliedOperation.fence_sequence, true);
  assert.equal(retry.operation.authority_digest, notAppliedOperation.authority_digest);
  assert.equal(retry.operation.source_digest, notAppliedOperation.source_digest);
  assert.equal(retry.operation.cas_digest, notAppliedOperation.cas_digest);
  assert.equal(retry.operation.retry_of_operation_id, notAppliedOperation.operation_id);
});

test('NOT_APPLIED retry without a fresh run is rejected', async () => {
  const current = await admittedFixture();
  const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
  await current.store.recordMutationOutcome(
    current.session, current.admission, outcomeEvidence(operation, 'NOT_APPLIED')
  );
  const retryDescriptor = {
    ...current.operationDescriptor,
    retry_of_operation_id: operation.operation_id
  };
  await assertCodeAsync(() => current.store.admitMutationOperation(current.session, retryDescriptor,
    trustedReaders(current.expectedAuthority, retryDescriptor)), 'GPR_RETRY_FORBIDDEN');
});

test('NOT_APPLIED retry under stale ownership without the newer fence is rejected', async () => {
  const current = await admittedFixture();
  const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
  await current.store.recordMutationOutcome(
    current.session, current.admission, outcomeEvidence(operation, 'NOT_APPLIED')
  );
  current.store.interruptRun(current.session, {
    payload: { classification: 'RETRYABLE' }, created_at: nowIso()
  });
  const freshSession = await current.store.startRun({
    lock: 'LOCK-NEWER-FENCE', authority: current.expectedAuthority, start: current.expectedStart,
    candidate: null, lease_ms: 60000
  }, readers(current.expectedAuthority, current.expectedStart, nowIso()));
  assert.equal(freshSession.lease.fence_sequence > current.session.lease.fence_sequence, true);
  const retryDescriptor = {
    ...current.operationDescriptor,
    retry_of_operation_id: operation.operation_id
  };
  await assertCodeAsync(() => current.store.admitMutationOperation(current.session, retryDescriptor,
    trustedReaders(current.expectedAuthority, retryDescriptor)), 'GPR_NEWER_FENCE_EXISTS');
});

test('NOT_APPLIED retry rejects authority movement after the fresh run starts', async () => {
  const current = await admittedFixture();
  const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
  await current.store.recordMutationOutcome(
    current.session, current.admission, outcomeEvidence(operation, 'NOT_APPLIED')
  );
  current.store.interruptRun(current.session, {
    payload: { classification: 'RETRYABLE' }, created_at: nowIso()
  });
  const retrySession = await current.store.startRun({
    lock: 'LOCK-AUTHORITY-MOVED', authority: current.expectedAuthority, start: current.expectedStart,
    candidate: null, lease_ms: 60000
  }, readers(current.expectedAuthority, current.expectedStart, nowIso()));
  const retryDescriptor = {
    ...current.operationDescriptor,
    retry_of_operation_id: operation.operation_id
  };
  await assertCodeAsync(() => current.store.admitMutationOperation(retrySession, retryDescriptor,
    trustedReaders(current.expectedAuthority, retryDescriptor, {
      readAuthority: async () => ({
        authority: structuredClone(current.expectedAuthority),
        later_controlling_comments: [{ comment_id: 5474460226 }]
      })
    })), 'GPR_AUTHORITY_CHANGED');
});

test('NOT_APPLIED retry rejects source or CAS movement from the new descriptor', async () => {
  const current = await admittedFixture();
  const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
  await current.store.recordMutationOutcome(
    current.session, current.admission, outcomeEvidence(operation, 'NOT_APPLIED')
  );
  current.store.interruptRun(current.session, {
    payload: { classification: 'RETRYABLE' }, created_at: nowIso()
  });
  const retrySession = await current.store.startRun({
    lock: 'LOCK-SOURCE-MOVED', authority: current.expectedAuthority, start: current.expectedStart,
    candidate: null, lease_ms: 60000
  }, readers(current.expectedAuthority, current.expectedStart, nowIso()));
  const retryDescriptor = {
    ...current.operationDescriptor,
    retry_of_operation_id: operation.operation_id
  };
  await assertCodeAsync(() => current.store.admitMutationOperation(retrySession, retryDescriptor,
    trustedReaders(current.expectedAuthority, retryDescriptor, {
      readSource: async () => ({
        source_digest: digestValue('moved-source'),
        cas_digest: retryDescriptor.cas_digest
      })
    })), 'GPR_SOURCE_CHANGED');
  await assertCodeAsync(() => current.store.admitMutationOperation(retrySession, retryDescriptor,
    trustedReaders(current.expectedAuthority, retryDescriptor, {
      readSource: async () => ({
        source_digest: retryDescriptor.expected_source_digest,
        cas_digest: digestValue('moved-cas')
      })
    })), 'GPR_SOURCE_CHANGED');
});

test('UNKNOWN remains an unresolved barrier to explicit retry', async () => {
  const current = await admittedFixture();
  const operation = await current.store.authorizeMutationDispatch(current.session, current.admission);
  await current.store.recordMutationOutcome(
    current.session, current.admission, outcomeEvidence(operation, 'UNKNOWN')
  );
  const retryDescriptor = {
    ...current.operationDescriptor,
    retry_of_operation_id: operation.operation_id
  };
  await assertCodeAsync(() => current.store.admitMutationOperation(current.session, retryDescriptor,
    trustedReaders(current.expectedAuthority, retryDescriptor)), 'GPR_UNRESOLVED_OPERATION');
  assertCode(() => current.store.allocateRun({
    lock: 'LOCK-AFTER-UNKNOWN-RETRY', authority: current.expectedAuthority,
    start: current.expectedStart, candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
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

test('allocator, receipt, operation, and event rows are append-only and forged schema fails reopen', async () => {
  const { store, session, storeOptions, admission } = await admittedFixture();
  const code = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(store.databasePath)});
    let update = null;
    let remove = null;
    let operationUpdate = null;
    let eventDelete = null;
    try { db.exec('UPDATE allocations SET lock_id=\"OTHER\"'); } catch (error) { update = error.code; }
    try { db.exec('DELETE FROM receipts'); } catch (error) { remove = error.code; }
    try { db.exec('UPDATE mutation_operations SET lock_id=\"OTHER\"'); } catch (error) { operationUpdate = error.code; }
    try { db.exec('DELETE FROM mutation_operation_events'); } catch (error) { eventDelete = error.code; }
    db.close();
    process.stdout.write(JSON.stringify({ update, remove, operationUpdate, eventDelete }));
  `;
  const blocked = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', windowsHide: true });
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.ok(JSON.parse(blocked.stdout).update);
  assert.ok(JSON.parse(blocked.stdout).remove);
  assert.ok(JSON.parse(blocked.stdout).operationUpdate);
  assert.ok(JSON.parse(blocked.stdout).eventDelete);
  assert.equal(store.readReceiptChain(session.run_id).length, 1);
  assert.equal(store.readMutationOperation(admission.operation_id).events.length, 2);

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

test('operation row digest and operation event-chain tampering are detected after exact trigger restoration', async () => {
  const operationTamper = await admittedFixture();
  const alterOperation = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(operationTamper.store.databasePath)});
    db.exec("DROP TRIGGER mutation_operations_no_update; UPDATE mutation_operations SET operation_digest='${'f'.repeat(64)}'; CREATE TRIGGER mutation_operations_no_update BEFORE UPDATE ON mutation_operations BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    db.close();
  `;
  assert.equal(spawnSync(process.execPath, ['-e', alterOperation], { encoding: 'utf8' }).status, 0);
  assertCode(() => createProgrammeReceiptStore(operationTamper.storeOptions), 'GPR_OPERATION_TAMPERED');

  const eventTamper = await admittedFixture();
  const alterEvent = `
    const { DatabaseSync } = require('node:sqlite');
    const { digestValue } = require(${JSON.stringify(runtimePath)});
    const db = new DatabaseSync(${JSON.stringify(eventTamper.store.databasePath)});
    const row = db.prepare('SELECT * FROM mutation_operation_events WHERE sequence=2').get();
    const payload = { event_id: row.event_id, operation_id: row.operation_id, sequence: row.sequence,
      prior_event_id: null, event_type: row.event_type, state: row.state, event_at: row.event_at,
      authority_digest: row.authority_digest, provider_evidence_digest: row.provider_evidence_digest,
      readback_digest: row.readback_digest, detail_digest: row.detail_digest };
    db.exec('DROP TRIGGER mutation_operation_events_no_update');
    db.prepare('UPDATE mutation_operation_events SET prior_event_id=NULL, event_digest=? WHERE event_id=?').run(digestValue(payload), row.event_id);
    db.exec("CREATE TRIGGER mutation_operation_events_no_update BEFORE UPDATE ON mutation_operation_events BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
    db.close();
  `;
  assert.equal(spawnSync(process.execPath, ['-e', alterEvent], { encoding: 'utf8' }).status, 0);
  assertCode(() => createProgrammeReceiptStore(eventTamper.storeOptions), 'GPR_OPERATION_EVENT_TAMPERED');
});

test('fresh stores use user_version 2 while old v1 and corrupted SQLite stores fail closed', async () => {
  const old = await fixture();
  const versionRead = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(old.store.databasePath)});
    process.stdout.write(String(db.prepare('PRAGMA user_version').get().user_version));
    db.close();
  `], { encoding: 'utf8' });
  assert.equal(versionRead.stdout, '2');
  const downgrade = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(old.store.databasePath)});
    db.exec('PRAGMA user_version=1'); db.close();
  `]);
  assert.equal(downgrade.status, 0);
  assertCode(() => createProgrammeReceiptStore(old.storeOptions), 'GPR_SCHEMA_MISMATCH');

  const corrupted = await fixture();
  const size = fs.statSync(corrupted.store.databasePath).size;
  fs.truncateSync(corrupted.store.databasePath, Math.max(512, Math.floor(size / 2)));
  assert.throws(() => createProgrammeReceiptStore(corrupted.storeOptions),
    (error) => error && ['GPR_STORE_INVALID', 'GPR_INTEGRITY_CHECK_FAILED', 'GPR_SCHEMA_MISMATCH'].includes(error.code));
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

test('PREPARED and IN_FLIGHT commit atomically and process death leaves the unresolved hold durable', async () => {
  const root = stateRoot();
  const storeOptions = options(root);
  const auth = authority('dead-owner');
  const initialStart = start();
  const operationDescriptor = descriptor();
  const childCode = `
    const runtime = require(${JSON.stringify(runtimePath)});
    const auth = ${JSON.stringify(auth)};
    const start = ${JSON.stringify(initialStart)};
    const descriptor = ${JSON.stringify(operationDescriptor)};
    (async () => {
      const store = runtime.createProgrammeReceiptStore(${JSON.stringify(storeOptions)});
      const session = await store.startRun({ lock: 'LOCK-DEAD-OWNER', authority: auth, start, candidate: null, lease_ms: 60000 }, {
        readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
        readStart: async () => start
      });
      const admission = await store.admitMutationOperation(session, descriptor, {
        readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
        readSource: async () => ({ source_digest: descriptor.expected_source_digest, cas_digest: descriptor.cas_digest }),
        verifyOutcomeEvidence: async (evidence) => evidence
      });
      process.stdout.write(admission.operation_id);
    })().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
  `;
  const child = spawnSync(process.execPath, ['--no-warnings', '-e', childCode], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 30000
  });
  assert.equal(child.status, 0, child.stderr);
  const reopened = createProgrammeReceiptStore(storeOptions);
  const operation = reopened.readMutationOperation(child.stdout);
  assert.deepEqual(operation.events.map((event) => event.state), ['PREPARED', 'IN_FLIGHT']);
  assertCode(() => reopened.allocateRun({
    lock: 'LOCK-REPLACEMENT', authority: auth, start: initialStart, candidate: null, lease_ms: 60000
  }), 'GPR_UNRESOLVED_OPERATION');
});

test('process death during or after a trusted write leaves IN_FLIGHT until read-only reconciliation', async () => {
  for (const stage of ['partial-write', 'completed-write']) {
    const root = stateRoot();
    const storeOptions = options(root);
    const auth = authority(stage);
    const initialStart = start();
    const operationDescriptor = descriptor();
    const marker = path.join(root, `${stage}.marker`);
    const childCode = `
      const fs = require('node:fs');
      const runtime = require(${JSON.stringify(runtimePath)});
      const auth = ${JSON.stringify(auth)};
      const start = ${JSON.stringify(initialStart)};
      const descriptor = ${JSON.stringify(operationDescriptor)};
      (async () => {
        const store = runtime.createProgrammeReceiptStore(${JSON.stringify(storeOptions)});
        const session = await store.startRun({ lock: 'LOCK-${stage}', authority: auth, start, candidate: null, lease_ms: 60000 }, {
          readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }), readStart: async () => start
        });
        const trusted = {
          readAuthority: async () => ({ authority: auth, later_controlling_comments: [] }),
          readSource: async () => ({ source_digest: descriptor.expected_source_digest, cas_digest: descriptor.cas_digest }),
          verifyOutcomeEvidence: async (evidence) => evidence
        };
        const admission = await store.admitMutationOperation(session, descriptor, trusted);
        await store.authorizeMutationDispatch(session, admission);
        fs.writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(stage === 'partial-write' ? 'partial' : 'complete')});
        process.stdout.write(admission.operation_id);
        process.exit(23);
      })().catch((error) => { console.error(error.code || error.message); process.exit(1); });
    `;
    const child = spawnSync(process.execPath, ['--no-warnings', '-e', childCode], {
      cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, timeout: 30000
    });
    assert.equal(child.status, 23, child.stderr);
    assert.equal(fs.existsSync(marker), true);
    const reopened = createProgrammeReceiptStore(storeOptions);
    assert.equal(reopened.readMutationOperation(child.stdout).state, 'IN_FLIGHT');
    assertCode(() => reopened.allocateRun({
      lock: `LOCK-${stage}-REPLACEMENT`, authority: auth, start: initialStart, candidate: null, lease_ms: 60000
    }), 'GPR_UNRESOLVED_OPERATION');
  }
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

test('lost supervisor ownership cannot append or obtain operation admission', async () => {
  const { store, session, expectedAuthority } = await fixture();
  const impostor = structuredClone(session);
  assertCode(() => store.appendReceipt(impostor, {
    receipt_type: 'RUN_INTERRUPTED', payload: { classification: 'OWNERSHIP_LOST' }, created_at: nowIso()
  }), 'GPR_OWNERSHIP_LOST');
  const operationDescriptor = descriptor();
  await assertCodeAsync(() => store.admitMutationOperation(impostor, operationDescriptor,
    trustedReaders(expectedAuthority, operationDescriptor)), 'GPR_OWNERSHIP_LOST');
});

test('zero-operation orphan takeover commits one terminal receipt, release, and allocator-owned N+1 replacement', async () => {
  const current = orphanFixture({ seed: 'zero-operation', lock: 'LOCK-ORPHAN-ZERO' });
  const request = takeoverRequest(current, { request_id: 'recovery-zero-operation' });
  const before = ledgerCounts(current.store);
  const result = await current.store.takeoverAbandonedRun(request, trustedRecoveryReaders(current, request));
  const after = ledgerCounts(current.store);

  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.duplicate, false);
  assert.equal(result.recovery.status, 'COMMITTED');
  assert.equal(result.recovery.request_id, request.request_id);
  assert.equal(result.recovery.request_digest, require(runtimePath).orphanTakeoverRequestDigest(request));
  assert.equal(result.recovery.old.receipt_chain_digest, request.target.receipt_chain_digest);
  assert.equal(result.recovery.old.fence_sequence, 1);
  assert.equal(result.recovery.old.fence_usable, false);
  assert.equal(result.recovery.replacement.fence_sequence, 2);
  assert.equal(result.recovery.replacement.started, false);
  assert.equal(result.replacement.started, false);
  assert.equal(result.replacement.lease.fence_sequence, 2);
  assert.equal(result.recovery.recovery_receipt.receipt_type, 'ORPHAN_ABANDONED');
  assert.equal(result.recovery.recovery_receipt.payload.recovery.request_digest, result.recovery.request_digest);
  assert.deepEqual(current.store.readReceiptChain(current.oldRunId).map((receipt) => receipt.receipt_type), [
    'RUN_STARTED', 'ORPHAN_ABANDONED'
  ]);
  assert.equal(after.allocations, before.allocations + 1);
  assert.equal(after.runs, before.runs + 1);
  assert.equal(after.receipts, before.receipts + 1);
  assert.equal(after.lease_events, before.lease_events + 2);
  assert.equal(after.mutation_operations, before.mutation_operations);
  assert.equal(after.high_water, 2);

  const restarted = createProgrammeReceiptStore(current.storeOptions);
  const readback = restarted.readOrphanTakeover({
    run_id: current.oldRunId,
    request_id: request.request_id
  });
  assert.deepEqual(readback, result.recovery);
  assert.equal(readback.replacement.started, false);
});

test('same-process owner and ordinary receipt APIs cannot create ORPHAN_ABANDONED', async () => {
  const current = await fixture();
  const sameProcess = {
    ...current,
    oldRunId: current.session.run_id,
    oldAllocationId: current.session.allocation_id
  };
  const request = takeoverRequest(sameProcess, { request_id: 'recovery-same-process-owner' });
  const before = ledgerCounts(current.store);
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    request, trustedRecoveryReaders(sameProcess, request)
  ), 'GPR_RECOVERY_CURRENT_PROCESS_OWNER');
  assertCode(() => current.store.appendReceipt(current.session, {
    receipt_type: 'ORPHAN_ABANDONED',
    payload: { classification: 'ORPHAN_ABANDONED' },
    created_at: nowIso()
  }), 'GPR_RECOVERY_PATH_REQUIRED');
  assertCode(() => current.store.interruptRun(current.session, {
    payload: { classification: 'ORPHAN_ABANDONED', recovery: {} },
    created_at: nowIso()
  }), 'GPR_RECOVERY_PATH_REQUIRED');
  assert.deepEqual(ledgerCounts(current.store), before);
});

test('missing or invalid recovery authority rejects with zero writes', async () => {
  const current = orphanFixture({ seed: 'authority-rejection' });
  const valid = takeoverRequest(current, { request_id: 'recovery-authority-valid' });
  const before = ledgerCounts(current.store);
  const missing = structuredClone(valid);
  delete missing.recovery_authority;
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    missing, trustedRecoveryReaders(current, valid)
  ), 'GPR_RECOVERY_REQUEST_INVALID');
  const invalid = structuredClone(valid);
  invalid.recovery_authority.scope_digest = 'f'.repeat(64);
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    invalid, trustedRecoveryReaders(current, invalid)
  ), 'GPR_AUTHORITY_CHANGED');
  assert.deepEqual(ledgerCounts(current.store), before);
});

test('caller-fabricated OWNER recovery authority cannot replace trusted controller authority', async () => {
  const current = orphanFixture({ seed: 'fabricated-authority' });
  const request = takeoverRequest(current, { request_id: 'recovery-fabricated-authority' });
  const before = ledgerCounts(current.store);
  const trustedAuthority = {
    ...request.recovery_authority,
    child_comment_id: request.recovery_authority.child_comment_id + 1,
    node_id: 'IC_trusted-recovery-authority'
  };
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(request,
    trustedRecoveryReaders(current, request, {
      readAuthority: async () => ({ authority: trustedAuthority, later_controlling_comments: [] })
    })), 'GPR_AUTHORITY_CHANGED');
  assert.deepEqual(ledgerCounts(current.store), before);
});

test('trusted later controlling chronology rejects a caller-declared empty chronology', async () => {
  const current = orphanFixture({ seed: 'later-authority' });
  const request = takeoverRequest(current, { request_id: 'recovery-later-authority' });
  const before = ledgerCounts(current.store);
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(request,
    trustedRecoveryReaders(current, request, {
      readAuthority: async () => ({
        authority: structuredClone(request.recovery_authority),
        later_controlling_comments: [{ comment_id: 5487000000 }]
      })
    })), 'GPR_AUTHORITY_CHANGED');
  assert.deepEqual(ledgerCounts(current.store), before);
});

test('trusted moved start rejects caller replay of the persisted old start', async () => {
  const current = orphanFixture({ seed: 'replayed-start' });
  const request = takeoverRequest(current, { request_id: 'recovery-replayed-start' });
  const before = ledgerCounts(current.store);
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(request,
    trustedRecoveryReaders(current, request, {
      readStart: async () => ({ ...current.expectedStart, head_sha: '9'.repeat(40) })
    })), 'GPR_RECOVERY_SOURCE_CHANGED');
  assert.deepEqual(ledgerCounts(current.store), before);
});

test('trusted recovery readers fail closed on throws, malformed evidence, and unknown orphan state', async () => {
  const current = orphanFixture({ seed: 'reader-failure' });
  const request = takeoverRequest(current, { request_id: 'recovery-reader-failure' });
  const before = ledgerCounts(current.store);
  const cases = [
    [{ readAuthority: async () => { throw new Error('authority unavailable'); } }, 'GPR_AUTHORITY_UNVERIFIED'],
    [{ readAuthority: async () => ({}) }, 'GPR_AUTHORITY_UNVERIFIED'],
    [{ readStart: async () => { throw new Error('source unavailable'); } }, 'GPR_START_UNVERIFIED'],
    [{ readStart: async () => ({}) }, 'GPR_START_INVALID'],
    [{ readOrphanStatus: async () => { throw new Error('holder unavailable'); } }, 'GPR_RECOVERY_ORPHAN_UNVERIFIED'],
    [{ readOrphanStatus: async () => ({}) }, 'GPR_RECOVERY_ORPHAN_UNVERIFIED'],
    [{ readOrphanStatus: async () => ({ status: 'UNKNOWN', orphan_attestation: null }) }, 'GPR_RECOVERY_ORPHAN_UNVERIFIED']
  ];
  for (const [overrides, code] of cases) {
    await assertCodeAsync(() => current.store.takeoverAbandonedRun(
      request, trustedRecoveryReaders(current, request, overrides)
    ), code);
    assert.deepEqual(ledgerCounts(current.store), before);
  }
});

test('caller-supplied lease, fence, sequence, owner, process, namespace, or state-root values are rejected', async () => {
  const current = orphanFixture({ seed: 'caller-fields' });
  const valid = takeoverRequest(current, { request_id: 'recovery-caller-fields' });
  const before = ledgerCounts(current.store);
  for (const key of [
    'lease_id', 'fence_id', 'fence_sequence', 'owner_instance_id',
    'process_id', 'coordination_namespace', 'state_root'
  ]) {
    const invalid = structuredClone(valid);
    invalid[key] = key === 'fence_sequence' ? 2 : 'caller-value';
    await assertCodeAsync(() => current.store.takeoverAbandonedRun(
      invalid, trustedRecoveryReaders(current, valid)
    ), 'GPR_CALLER_FENCE_FORBIDDEN');
    assert.deepEqual(ledgerCounts(current.store), before);
  }
});

test('zero-operation eligibility rejects every admitted operation state', async () => {
  for (const [operationState, expectedCode] of [
    ['APPLIED', 'GPR_RECOVERY_OPERATIONS_PRESENT'],
    ['NOT_APPLIED', 'GPR_RECOVERY_OPERATIONS_PRESENT'],
    ['IN_FLIGHT', 'GPR_UNRESOLVED_OPERATION'],
    ['UNKNOWN', 'GPR_UNRESOLVED_OPERATION']
  ]) {
    const current = orphanFixture({
      seed: 'operation-' + operationState.toLowerCase(),
      operationState,
      lock: 'LOCK-ORPHAN-' + operationState
    });
    const request = takeoverRequest(current, { request_id: 'recovery-operation-' + operationState.toLowerCase() });
    const before = ledgerCounts(current.store);
    await assertCodeAsync(() => current.store.takeoverAbandonedRun(
      request, trustedRecoveryReaders(current, request)
    ), expectedCode);
    assert.deepEqual(ledgerCounts(current.store), before);
    assert.equal(current.store.readReceiptChain(current.oldRunId).at(-1).receipt_type, 'RUN_STARTED');
  }
});

test('exact duplicate is idempotent while same request ID conflicts and a different request loses the race', async () => {
  const current = orphanFixture({ seed: 'request-idempotence' });
  const request = takeoverRequest(current, { request_id: 'recovery-idempotence' });
  const readers = trustedRecoveryReaders(current, request);
  const committed = await current.store.takeoverAbandonedRun(request, readers);
  const beforeDuplicate = ledgerCounts(current.store);
  const duplicate = await current.store.takeoverAbandonedRun(request, trustedRecoveryReaders(current, request, {
    readAuthority: async () => { throw new Error('must not reread committed duplicate'); },
    readStart: async () => { throw new Error('must not reread committed duplicate'); },
    readOrphanStatus: async () => { throw new Error('must not reread committed duplicate'); }
  }));
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.recovery, committed.recovery);
  assert.deepEqual(ledgerCounts(current.store), beforeDuplicate);

  const conflicting = structuredClone(request);
  conflicting.lease_ms = 60001;
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    conflicting, trustedRecoveryReaders(current, conflicting)
  ), 'GPR_RECOVERY_REQUEST_CONFLICT');
  const different = takeoverRequest(current, { request_id: 'recovery-different-request' });
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    different, trustedRecoveryReaders(current, different)
  ), 'GPR_RECOVERY_LOST_RACE');
  assert.deepEqual(ledgerCounts(current.store), beforeDuplicate);
});

test('stale authority, moved source/start, wrong namespace/target, and remote adapter input fail closed', async () => {
  const current = orphanFixture({ seed: 'target-validation' });
  const base = takeoverRequest(current, { request_id: 'recovery-target-validation' });
  const before = ledgerCounts(current.store);
  const cases = [
    ['wrong repository', { target: { repository: 'other/repository' } }, 'GPR_RECOVERY_NAMESPACE_MISMATCH'],
    ['wrong parent', { target: { parent_issue: 241 } }, 'GPR_RECOVERY_NAMESPACE_MISMATCH'],
    ['wrong child', { target: { child_issue: 360 } }, 'GPR_RECOVERY_NAMESPACE_MISMATCH'],
    ['wrong lock', { target: { lock: 'LOCK-WRONG' } }, 'GPR_RECOVERY_TARGET_MISMATCH'],
    ['wrong run', { target: { run_id: 'run-wrong' } }, 'GPR_RECOVERY_TARGET_NOT_FOUND'],
    ['wrong allocation', { target: { allocation_id: 'allocation-wrong' } }, 'GPR_RECOVERY_TARGET_NOT_FOUND'],
    ['wrong old authority digest', { target: { authority_digest: 'f'.repeat(64) } }, 'GPR_RECOVERY_TARGET_MISMATCH'],
    ['moved source start', { observed_start: { ...current.expectedStart, head_sha: '9'.repeat(40) } }, 'GPR_RECOVERY_SOURCE_CHANGED'],
    ['stale recovery authority', { recovery_authority: { scope_digest: 'f'.repeat(64) } }, 'GPR_AUTHORITY_CHANGED']
  ];
  for (const [label, overrides, expectedCode] of cases) {
    const request = takeoverRequest(current, {
      ...overrides,
      request_id: 'recovery-target-' + label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    });
    await assertCodeAsync(() => current.store.takeoverAbandonedRun(
      request, trustedRecoveryReaders(current, request)
    ), expectedCode);
    assert.deepEqual(ledgerCounts(current.store), before);
  }
  let adapterCalls = 0;
  const invalid = { ...base, adapter: () => { adapterCalls += 1; } };
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    invalid, trustedRecoveryReaders(current, base)
  ), 'GPR_RECOVERY_REQUEST_INVALID');
  assert.equal(adapterCalls, 0);
  assert.deepEqual(ledgerCounts(current.store), before);
});

test('trusted recovery observation rejects active and unverifiable foreign holders with zero writes', async () => {
  const current = await liveOrphanFixture({ seed: 'live-holder', lock: 'LOCK-LIVE-HOLDER' });
  const request = takeoverRequest(current, { request_id: 'recovery-live-holder' });
  const before = ledgerCounts(current.store);

  await assertCodeAsync(() => current.store.takeoverAbandonedRun(request,
    trustedRecoveryReaders(current, request, {
      readOrphanStatus: async () => ({ status: 'ACTIVE_FOREIGN_HOLDER', orphan_attestation: null })
    })), 'GPR_RECOVERY_HOLDER_ACTIVE');
  assert.deepEqual(ledgerCounts(current.store), before);

  await assertCodeAsync(() => current.store.takeoverAbandonedRun(request,
    trustedRecoveryReaders(current, request, {
      readOrphanStatus: async () => ({ status: 'UNKNOWN', orphan_attestation: null })
    })), 'GPR_RECOVERY_ORPHAN_UNVERIFIED');
  assert.deepEqual(ledgerCounts(current.store), before);

  current.child.stdin.write('append\nclose\n');
  const append = await current.nextMessage();
  const closed = await current.nextMessage();
  const exit = await current.close;
  assert.deepEqual(append, { command: 'append', ok: true });
  assert.deepEqual(closed, { command: 'close', ok: true });
  assert.equal(exit.status, 0);
});

test('concurrent identical takeover requests commit once and return one deterministic duplicate', async () => {
  const current = orphanFixture({ seed: 'concurrent-identical', lock: 'LOCK-CONCURRENT-IDENTICAL' });
  const request = takeoverRequest(current, { request_id: 'recovery-concurrent-identical' });
  const results = await Promise.all([
    takeoverInChild(current, request),
    takeoverInChild(current, request)
  ]);
  assert.equal(results.filter((result) => result.status === 0 && result.stdout.ok && result.stdout.status === 'COMMITTED').length, 1);
  assert.equal(results.filter((result) => result.status === 0 && result.stdout.ok && result.stdout.status === 'DUPLICATE').length, 1);
  assert.equal(new Set(results.map((result) => result.stdout.replacement_run_id)).size, 1);
  assert.equal(ledgerCounts(current.store).allocations, 2);
  assert.equal(ledgerCounts(current.store).high_water, 2);
});

test('concurrent different takeover requests have exactly one winner and one lost-race result', async () => {
  const current = orphanFixture({ seed: 'concurrent-different', lock: 'LOCK-CONCURRENT-DIFFERENT' });
  const first = takeoverRequest(current, { request_id: 'recovery-concurrent-a' });
  const second = takeoverRequest(current, { request_id: 'recovery-concurrent-b' });
  const results = await Promise.all([
    takeoverInChild(current, first),
    takeoverInChild(current, second)
  ]);
  assert.equal(results.filter((result) => result.status === 0 && result.stdout.ok && result.stdout.status === 'COMMITTED').length, 1);
  assert.equal(results.filter((result) => result.status === 0 && result.stdout.ok === false
    && result.stdout.code === 'GPR_RECOVERY_LOST_RACE').length, 1);
  assert.equal(ledgerCounts(current.store).allocations, 2);
  assert.equal(ledgerCounts(current.store).high_water, 2);
});

test('not-yet-committed readback is typed and a natural lease-expiry race performs no writes or timestamp rewrite', async () => {
  const beforeCommit = orphanFixture({ seed: 'not-committed', lock: 'LOCK-NOT-COMMITTED' });
  const beforeRequest = takeoverRequest(beforeCommit, { request_id: 'recovery-not-committed' });
  const beforeCounts = ledgerCounts(beforeCommit.store);
  assertCode(() => beforeCommit.store.readOrphanTakeover({
    run_id: beforeCommit.oldRunId,
    request_id: beforeRequest.request_id
  }), 'GPR_RECOVERY_NOT_COMMITTED');
  assert.deepEqual(ledgerCounts(beforeCommit.store), beforeCounts);

  const current = orphanFixture({ seed: 'expiry-race', lock: 'LOCK-EXPIRY-RACE', lease_ms: 5000 });
  const request = takeoverRequest(current, { request_id: 'recovery-expiry-race' });
  const db = new DatabaseSync(current.store.databasePath, { readOnly: true });
  const original = db.prepare('SELECT issued_at, expires_at, allocation_digest FROM allocations WHERE run_id = ?')
    .get(current.oldRunId);
  db.close();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(original.expires_at) - Date.now() + 50)));
  const before = ledgerCounts(current.store);
  await assertCodeAsync(() => current.store.takeoverAbandonedRun(
    request, trustedRecoveryReaders(current, request)
  ), 'GPR_RECOVERY_EXPIRED_RACE');
  assert.deepEqual(ledgerCounts(current.store), before);
  const afterDb = new DatabaseSync(current.store.databasePath, { readOnly: true });
  const after = afterDb.prepare('SELECT issued_at, expires_at, allocation_digest FROM allocations WHERE run_id = ?')
    .get(current.oldRunId);
  afterDb.close();
  assert.deepEqual(after, original);
});

test('corrupt receipt chains and schema versions fail closed before takeover writes', async () => {
  const chainCorrupt = orphanFixture({ seed: 'corrupt-chain', lock: 'LOCK-CORRUPT-CHAIN' });
  const chainRequest = takeoverRequest(chainCorrupt, { request_id: 'recovery-corrupt-chain' });
  const chainDb = new DatabaseSync(chainCorrupt.store.databasePath);
  const row = chainDb.prepare('SELECT * FROM receipts WHERE run_id = ? AND sequence = 1').get(chainCorrupt.oldRunId);
  const receipt = JSON.parse(row.canonical_json);
  receipt.prior_receipt_id = 'f'.repeat(64);
  const receiptPayload = structuredClone(receipt);
  delete receiptPayload.receipt_id;
  receipt.receipt_id = digestValue(receiptPayload);
  chainDb.exec('DROP TRIGGER receipts_no_update');
  chainDb.prepare('UPDATE receipts SET receipt_id = ?, canonical_json = ?, receipt_digest = ? WHERE receipt_id = ?')
    .run(receipt.receipt_id, canonicalSerialize(receipt), receipt.receipt_id, row.receipt_id);
  chainDb.exec("CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
  chainDb.close();
  const chainBefore = ledgerCounts(chainCorrupt.store);
  await assertCodeAsync(() => chainCorrupt.store.takeoverAbandonedRun(
    chainRequest, trustedRecoveryReaders(chainCorrupt, chainRequest)
  ), 'GPR_RECEIPT_TAMPERED');
  assert.deepEqual(ledgerCounts(chainCorrupt.store), chainBefore);

  const schemaCorrupt = orphanFixture({ seed: 'corrupt-schema', lock: 'LOCK-CORRUPT-SCHEMA' });
  const schemaRequest = takeoverRequest(schemaCorrupt, { request_id: 'recovery-corrupt-schema' });
  const schemaDb = new DatabaseSync(schemaCorrupt.store.databasePath);
  schemaDb.exec('PRAGMA user_version = 1');
  schemaDb.close();
  const schemaBefore = ledgerCounts(schemaCorrupt.store);
  await assertCodeAsync(() => schemaCorrupt.store.takeoverAbandonedRun(
    schemaRequest, trustedRecoveryReaders(schemaCorrupt, schemaRequest)
  ), 'GPR_SCHEMA_MISMATCH');
  assert.deepEqual(ledgerCounts(schemaCorrupt.store), schemaBefore);
});

test('semantically tampered recovery evidence fails independent readback after a valid receipt re-sign', async () => {
  const current = orphanFixture({ seed: 'tampered-recovery', lock: 'LOCK-TAMPERED-RECOVERY' });
  const request = takeoverRequest(current, { request_id: 'recovery-tampered-evidence' });
  await current.store.takeoverAbandonedRun(request, trustedRecoveryReaders(current, request));
  const db = new DatabaseSync(current.store.databasePath);
  const row = db.prepare('SELECT * FROM receipts WHERE run_id = ? AND receipt_type = ?')
    .get(current.oldRunId, 'ORPHAN_ABANDONED');
  const receipt = JSON.parse(row.canonical_json);
  receipt.payload.recovery.replacement.allocation_id = receipt.payload.recovery.replacement.run_id;
  const receiptPayload = structuredClone(receipt);
  delete receiptPayload.receipt_id;
  receipt.receipt_id = digestValue(receiptPayload);
  db.exec('DROP TRIGGER receipts_no_update');
  db.prepare('UPDATE receipts SET receipt_id = ?, canonical_json = ?, receipt_digest = ? WHERE receipt_id = ?')
    .run(receipt.receipt_id, canonicalSerialize(receipt), receipt.receipt_id, row.receipt_id);
  db.exec("CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'GPR_APPEND_ONLY'); END;");
  db.close();
  assertCode(() => current.store.readOrphanTakeover({
    run_id: current.oldRunId,
    request_id: request.request_id
  }), 'GPR_RECOVERY_EVIDENCE_TAMPERED');
});
