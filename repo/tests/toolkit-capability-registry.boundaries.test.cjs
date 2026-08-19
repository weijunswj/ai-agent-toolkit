'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtime = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-capability-registry.cjs'));

const REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';

function git(repo, args) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-capability-registry-boundary-'));
  const repo = path.join(root, 'repo');
  const registryPath = path.join(root, 'state', 'repository-governance.v1.json');
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--quiet', repo]);
  git(repo, ['remote', 'add', 'origin', REMOTE]);
  return { root, repo, registryPath };
}

function cleanup(ctx) {
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

function options(ctx, extra = {}) {
  return { cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true, ...extra };
}

function errorCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code || error.message;
  }
  assert.fail('expected a deterministic registry error');
}


function ownerAction(ctx, capabilityId, channel = 'capability-route', operation = 'enable') {
  const identity = runtime.resolveRepositoryIdentity(options(ctx));
  return {
    confirmed: true,
    category: 'explicit-owner',
    channel,
    operation,
    choice_semantic_id: runtime.capabilityDecisionSemanticId(capabilityId, operation),
    contract_digest: runtime.CONTRACT_DIGEST,
    scope_digest: runtime.capabilityScopeDigest(identity.repository_id, capabilityId, operation, channel),
  };
}

function writeValidState(ctx) {
  const initial = runtime.getRepositoryStatus(options(ctx));
  return runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: {
      confirmed: true,
      category: 'explicit-owner',
      channel: 'capability-route',
      operation: 'enable',
      choice_semantic_id: runtime.capabilityDecisionSemanticId('repository.governance', 'enable'),
      contract_digest: runtime.CONTRACT_DIGEST,
      scope_digest: runtime.capabilityScopeDigest(initial.repository_id, 'repository.governance', 'enable', 'capability-route'),
    },
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  });
}

function readRaw(ctx) {
  return JSON.parse(fs.readFileSync(ctx.registryPath, 'utf8'));
}

function writeRaw(ctx, value) {
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, JSON.stringify(value), 'utf8');
}

function transactionArtifacts(ctx) {
  return fs.readdirSync(path.dirname(ctx.registryPath))
    .filter((name) => name.startsWith(path.basename(ctx.registryPath) + '.transaction-'));
}

function assertFailClosed(ctx) {
  const statusResult = runtime.getRepositoryStatus(options(ctx));
  assert.equal(statusResult.status, 'actionable');
  assert.equal(statusResult.reason_code, 'REGISTRY_INTERRUPTED_TRANSACTION');
  const probeResult = runtime.probeRepository(options(ctx));
  assert.equal(probeResult.reason_code, 'REGISTRY_INTERRUPTED_TRANSACTION');
}

test('registry bytes over 1 MiB are rejected before JSON.parse', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, Buffer.alloc(runtime.MAX_REGISTRY_BYTES + 1, 0x20));
  const originalParse = JSON.parse;
  let parseCalled = false;
  JSON.parse = (...args) => {
    parseCalled = true;
    return originalParse(...args);
  };
  try {
    const result = runtime.getRepositoryStatus(options(ctx));
    assert.equal(result.status, 'actionable');
    assert.equal(result.reason_code, 'REGISTRY_OVERSIZED');
    assert.equal(parseCalled, false);
  } finally {
    JSON.parse = originalParse;
  }
});

test('malformed and truncated registries fail closed without creating consent', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, '{"schema":"toolkit.repository-capability-registry.v1"', 'utf8');
  const result = runtime.getRepositoryStatus(options(ctx));
  assert.equal(result.status, 'actionable');
  assert.equal(result.reason_code, 'REGISTRY_MALFORMED');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'execution_loop'),
    expectedRevision: 0,
    expectedHash: null,
  })), 'REGISTRY_MALFORMED');
});

test('future schema and stale authority contract are actionable, never implicitly migrated', (t) => {
  const future = sandbox();
  const stale = sandbox();
  t.after(() => {
    cleanup(future);
    cleanup(stale);
  });
  writeValidState(future);
  const futureRegistry = readRaw(future);
  futureRegistry.schema_version = 99;
  writeRaw(future, futureRegistry);
  assert.equal(runtime.getRepositoryStatus(options(future)).reason_code, 'REGISTRY_FUTURE_SCHEMA');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(future),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: ownerAction(future, 'execution_loop'),
    expectedRevision: futureRegistry.registry_revision,
    expectedHash: runtime.snapshotHashForTest(futureRegistry),
  })), 'REGISTRY_FUTURE_SCHEMA');

  writeValidState(stale);
  const staleRegistry = readRaw(stale);
  staleRegistry.contract_digest = 'f'.repeat(64);
  writeRaw(stale, staleRegistry);
  assert.equal(runtime.getRepositoryStatus(options(stale)).reason_code, 'REGISTRY_STALE_CONTRACT');
});

test('duplicate repository and capability records fail closed', (t) => {
  const duplicateRepository = sandbox();
  const duplicateCapability = sandbox();
  t.after(() => {
    cleanup(duplicateRepository);
    cleanup(duplicateCapability);
  });
  writeValidState(duplicateRepository);
  const repositoryRegistry = readRaw(duplicateRepository);
  repositoryRegistry.repositories.push(JSON.parse(JSON.stringify(repositoryRegistry.repositories[0])));
  writeRaw(duplicateRepository, repositoryRegistry);
  assert.equal(runtime.getRepositoryStatus(options(duplicateRepository)).reason_code, 'REGISTRY_DUPLICATE_REPOSITORY');

  writeValidState(duplicateCapability);
  const capabilityRegistry = readRaw(duplicateCapability);
  const record = capabilityRegistry.repositories[0];
  record.capabilities.push(JSON.parse(JSON.stringify(record.capabilities[0])));
  writeRaw(duplicateCapability, capabilityRegistry);
  assert.equal(runtime.getRepositoryStatus(options(duplicateCapability)).reason_code, 'REGISTRY_DUPLICATE_CAPABILITY');
});

test('unknown capability and codex_review records cannot enter the closed A2 catalogue', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  writeValidState(ctx);
  const registry = readRaw(ctx);
  const unknown = JSON.parse(JSON.stringify(registry.repositories[0].capabilities[0]));
  unknown.capability_id = 'codex_review';
  registry.repositories[0].capabilities = [unknown];
  writeRaw(ctx, registry);
  const result = runtime.getRepositoryStatus(options(ctx));
  assert.equal(result.status, 'actionable');
  assert.equal(result.reason_code, 'REGISTRY_UNKNOWN_CAPABILITY');
});

test('recognized interrupted transaction or migration artifacts are preserved and fail closed', (t) => {
  const transaction = sandbox();
  const migration = sandbox();
  const unknown = sandbox();
  t.after(() => {
    cleanup(transaction);
    cleanup(migration);
    cleanup(unknown);
  });
  fs.mkdirSync(path.dirname(transaction.registryPath), { recursive: true });
  const transactionPath = transaction.registryPath + '.tmp-aaaaaaaaaaaaaaaa';
  fs.writeFileSync(transactionPath, 'private staged bytes', 'utf8');
  const transactionResult = runtime.getRepositoryStatus(options(transaction));
  assert.equal(transactionResult.reason_code, 'REGISTRY_INTERRUPTED_TRANSACTION');
  assert.equal(fs.existsSync(transactionPath), true);

  fs.mkdirSync(path.dirname(migration.registryPath), { recursive: true });
  writeRaw(migration, runtime.emptyRegistry());
  const migrationRegistry = readRaw(migration);
  migrationRegistry.migration = { state: 'in_progress', token: 'opaque-fixture' };
  writeRaw(migration, migrationRegistry);
  assert.equal(runtime.getRepositoryStatus(options(migration)).reason_code, 'REGISTRY_INTERRUPTED_MIGRATION');

  fs.mkdirSync(path.dirname(unknown.registryPath), { recursive: true });
  const unknownPath = unknown.registryPath + '.tmp-unknown';
  fs.writeFileSync(unknownPath, 'do not promote or delete', 'utf8');
  assert.equal(runtime.getRepositoryStatus(options(unknown)).status, 'unresolved');
  assert.equal(fs.existsSync(unknownPath), true);
});

test('exclusive foreign locks fail closed and do not change prior consent', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  writeValidState(ctx);
  const before = fs.readFileSync(ctx.registryPath, 'utf8');
  fs.writeFileSync(runtime.lockPathForTest(ctx.registryPath), JSON.stringify({
    schema: runtime.LOCK_SCHEMA,
    token: 'foreign-token-123456',
    created_at: '2026-08-19T00:00:00.000Z',
  }), 'utf8');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'execution_loop'),
    expectedRevision: readRaw(ctx).registry_revision,
    expectedHash: runtime.snapshotHashForTest(readRaw(ctx)),
  })), 'REGISTRY_LOCK_BUSY');
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), before);
});

test('malformed foreign locks are indeterminate and are never removed', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  const lockPath = runtime.lockPathForTest(ctx.registryPath);
  fs.writeFileSync(lockPath, '{malformed', 'utf8');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: 0,
    expectedHash: null,
  })), 'REGISTRY_LOCK_INDETERMINATE');
  assert.equal(fs.existsSync(lockPath), true);
});

test('stale revision/hash CAS cannot merge or overwrite a newer decision', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  const oldExpected = { expectedRevision: initial.registry_revision, expectedHash: initial.snapshot_hash };
  runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    ...oldExpected,
  });
  const current = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'execution_loop'),
    ...oldExpected,
  })), 'REGISTRY_CAS_MISMATCH');
  const after = runtime.getRepositoryStatus(options(ctx));
  assert.equal(after.capabilities['repository.governance'].state, 'enabled');
  assert.equal(after.capabilities.execution_loop.state, 'unresolved');
});

test('atomic replacement failure leaves the prior canonical bytes unchanged', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: 0,
    expectedHash: null,
  });
  const before = fs.readFileSync(ctx.registryPath, 'utf8');
  const current = runtime.getRepositoryStatus(options(ctx));
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error('simulated atomic replacement failure');
    error.code = 'EXDEV';
    throw error;
  };
  try {
    assert.equal(errorCode(() => runtime.writeCapabilityDecision({
      ...options(ctx),
      capabilityId: 'execution_loop',
      operation: 'enable',
      ownerAction: ownerAction(ctx, 'execution_loop'),
      expectedRevision: current.registry_revision,
      expectedHash: current.snapshot_hash,
    })), 'REGISTRY_ATOMIC_REPLACE_FAILED');
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), before);
  const staged = fs.readdirSync(path.dirname(ctx.registryPath)).filter((name) => name.startsWith('repository-governance.v1.json.tmp-'));
  assert.equal(staged.length, 1);
  for (const file of staged) fs.rmSync(path.join(path.dirname(ctx.registryPath), file), { force: true });
});

test('pre-rename marker-directory durability failure prevents canonical replacement', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: 0,
    expectedHash: null,
  });
  const before = fs.readFileSync(ctx.registryPath, 'utf8');
  const current = runtime.getRepositoryStatus(options(ctx));
  const originalRename = fs.renameSync;
  let canonicalRenameCalls = 0;
  fs.renameSync = (source, destination) => {
    if (destination === ctx.registryPath) canonicalRenameCalls += 1;
    return originalRename(source, destination);
  };
  try {
    assert.equal(errorCode(() => runtime.writeCapabilityDecision({
      ...options(ctx, { faultInjection: 'pre-rename-marker-durability' }),
      capabilityId: 'execution_loop',
      operation: 'enable',
      ownerAction: ownerAction(ctx, 'execution_loop'),
      expectedRevision: current.registry_revision,
      expectedHash: current.snapshot_hash,
    })), 'REGISTRY_ATOMIC_REPLACE_FAILED');
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(canonicalRenameCalls, 0);
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), before);
  const raw = readRaw(ctx);
  const record = raw.repositories.find((entry) => entry.repository_id === current.repository_id);
  assert.equal(record.capabilities.find((entry) => entry.capability_id === 'repository.governance').state, 'enabled');
  assert.equal(record.capabilities.some((entry) => entry.capability_id === 'execution_loop'), false);
  assert.equal(transactionArtifacts(ctx).length, 1);
  assertFailClosed(ctx);
});

test('post-rename durability failure leaves replacement consent fail-closed', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx, { faultInjection: 'post-rename-durability' }),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'REGISTRY_ATOMIC_REPLACE_FAILED');
  assertFailClosed(ctx);
  const raw = readRaw(ctx);
  assert.equal(raw.registry_revision, 1);
  assert.equal(raw.repositories[0].capabilities[0].state, 'enabled');
  const markerFiles = transactionArtifacts(ctx);
  assert.equal(markerFiles.length, 1);
  const markerPath = path.join(path.dirname(ctx.registryPath), markerFiles[0]);
  const markerText = fs.readFileSync(markerPath, 'utf8');
  assert.equal(markerText.includes(ctx.root), false);
  assert.equal(markerText.includes(REMOTE), false);
  assert.equal(markerText.includes('codex_review'), false);
  assert.ok(Buffer.byteLength(markerText, 'utf8') <= 4096);
  const marker = JSON.parse(markerText);
  assert.deepEqual(Object.keys(marker).sort(), ['expected_hash', 'expected_revision', 'schema', 'token']);
  assert.equal(marker.expected_revision, 1);
  assert.match(marker.expected_hash, /^[a-f0-9]{64}$/);
});

test('post-rename canonical readback failure leaves replacement consent fail-closed', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx, { faultInjection: 'post-rename-readback' }),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'REGISTRY_COMMIT_VERIFY_FAILED');
  assertFailClosed(ctx);
  assert.equal(readRaw(ctx).repositories[0].capabilities[0].state, 'enabled');
  assert.equal(transactionArtifacts(ctx).length, 1);
});

test('lock-release failure leaves replacement consent fail-closed', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx, { faultInjection: 'lock-release' }),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'REGISTRY_LOCK_RELEASE_FAILED');
  assertFailClosed(ctx);
  assert.equal(readRaw(ctx).repositories[0].capabilities[0].state, 'enabled');
  assert.equal(transactionArtifacts(ctx).length, 1);
  assert.equal(fs.existsSync(runtime.lockPathForTest(ctx.registryPath)), true);
});

test('transaction finalisation failure leaves replacement consent fail-closed', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx, { faultInjection: 'transaction-finalize' }),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'REGISTRY_TRANSACTION_FINALIZE_FAILED');
  assertFailClosed(ctx);
  assert.equal(readRaw(ctx).repositories[0].capabilities[0].state, 'enabled');
  assert.equal(transactionArtifacts(ctx).length, 1);
  assert.equal(fs.existsSync(runtime.lockPathForTest(ctx.registryPath)), false);
});

test('successful replacement finalises transaction evidence after complete success', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  const committed = runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(ctx, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  });
  assert.equal(committed.status, 'committed');
  assert.equal(committed.repository_id, initial.repository_id);
  assert.equal(committed.capability_id, 'repository.governance');
  assert.equal(committed.state, 'enabled');
  assert.equal(committed.registry_revision, 1);
  assert.match(committed.receipt_id, /^[a-f0-9]{64}$/);
  assert.deepEqual(transactionArtifacts(ctx), []);
  assert.equal(fs.existsSync(runtime.lockPathForTest(ctx.registryPath)), false);
  const status = runtime.getRepositoryStatus(options(ctx));
  assert.equal(status.status, 'unresolved');
  assert.equal(status.registry_revision, 1);
  assert.equal(status.capabilities['repository.governance'].state, 'enabled');
  assert.equal(status.capabilities['repository.governance'].receipt_id, committed.receipt_id);
  const repeat = runtime.getRepositoryStatus(options(ctx));
  assert.equal(repeat.registry_revision, status.registry_revision);
  assert.equal(repeat.capabilities['repository.governance'].receipt_id, committed.receipt_id);
  assert.deepEqual(transactionArtifacts(ctx), []);
});

test('scope-bound owner provenance rejects cross-capability and wrong-channel answers', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  const badScope = runtime.capabilityScopeDigest(initial.repository_id, 'execution_loop', 'enable', 'capability-route');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: {
      confirmed: true,
      category: 'explicit-owner',
      channel: 'capability-route',
      operation: 'enable',
      choice_semantic_id: runtime.capabilityDecisionSemanticId('execution_loop', 'enable'),
      contract_digest: runtime.CONTRACT_DIGEST,
      scope_digest: badScope,
    },
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'OWNER_DECISION_BINDING_MISMATCH');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: {
      confirmed: true,
      category: 'service-detection',
      channel: 'capability-route',
      operation: 'enable',
      choice_semantic_id: runtime.capabilityDecisionSemanticId('repository.governance', 'enable'),
      contract_digest: runtime.CONTRACT_DIGEST,
      scope_digest: runtime.capabilityScopeDigest(initial.repository_id, 'repository.governance', 'enable', 'capability-route'),
    },
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'OWNER_ACTION_REQUIRED');
  assert.equal(fs.existsSync(ctx.registryPath), false);
});

test('combined answers validate completely before one revision is committed', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  const bank = runtime.probeRepository(options(ctx)).question_bank;
  const answer = (capabilityId, operation) => {
    const validOperation = runtime.BINDING_OPERATIONS.includes(operation);
    const choiceSemanticId = validOperation ? runtime.capabilityDecisionSemanticId(capabilityId, operation) : 'invalid.choice';
    return {
      capability_id: capabilityId,
      operation,
      choice_semantic_id: choiceSemanticId,
      ownerAction: {
        confirmed: true,
        category: 'explicit-owner',
        channel: 'combined-bank',
        operation,
        choice_semantic_id: choiceSemanticId,
        contract_digest: runtime.CONTRACT_DIGEST,
        scope_digest: validOperation
          ? runtime.capabilityScopeDigest(initial.repository_id, capabilityId, operation, 'combined-bank')
          : '0'.repeat(64),
      },
    };
  };

  for (const answers of [
    [],
    [answer('repository.governance', 'enable')],
    [answer('repository.governance', 'bogus'), answer('execution_loop', 'enable')],
  ]) {
    assert.equal(errorCode(() => runtime.writeCombinedDecisions({
      ...options(ctx),
      answers,
      bank,
      expectedRevision: initial.registry_revision,
      expectedHash: initial.snapshot_hash,
    })), answers.length === 0 ? 'COMBINED_ANSWER_ABANDONED' : answers.length === 1 ? 'COMBINED_ANSWER_PARTIAL' : 'COMBINED_ANSWER_INVALID');
    assert.equal(fs.existsSync(ctx.registryPath), false);
  }

  const committed = runtime.writeCombinedDecisions({
    ...options(ctx),
    answers: [answer('repository.governance', 'decline'), answer('execution_loop', 'enable')],
    bank,
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  });
  assert.equal(committed.registry_revision, 1);
  const after = runtime.getRepositoryStatus(options(ctx));
  assert.equal(after.capabilities['repository.governance'].state, 'disabled');
  assert.equal(after.capabilities.execution_loop.state, 'enabled');
});

test('owner approvals bind exact operation, choice, channel, and contract', (t) => {
  const ctx = sandbox();
  const declineCtx = sandbox();
  t.after(() => {
    cleanup(ctx);
    cleanup(declineCtx);
  });

  const initial = runtime.getRepositoryStatus(options(ctx));
  const enableAction = ownerAction(ctx, 'repository.governance', 'capability-route', 'enable');
  runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: enableAction,
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  });
  const current = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'repository.governance',
    operation: 'disable',
    ownerAction: enableAction,
    expectedRevision: current.registry_revision,
    expectedHash: current.snapshot_hash,
  })), 'OWNER_DECISION_BINDING_MISMATCH');
  assert.equal(runtime.getRepositoryStatus(options(ctx)).capabilities['repository.governance'].state, 'enabled');

  const wrongChoice = {
    ...ownerAction(ctx, 'execution_loop', 'capability-route', 'enable'),
    choice_semantic_id: 'execution_loop.decline',
  };
  const loopCurrent = runtime.getRepositoryStatus(options(ctx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: wrongChoice,
    expectedRevision: loopCurrent.registry_revision,
    expectedHash: loopCurrent.snapshot_hash,
  })), 'OWNER_DECISION_BINDING_MISMATCH');

  const wrongContract = {
    ...ownerAction(ctx, 'execution_loop', 'capability-route', 'enable'),
    contract_digest: 'f'.repeat(64),
  };
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: wrongContract,
    expectedRevision: loopCurrent.registry_revision,
    expectedHash: loopCurrent.snapshot_hash,
  })), 'OWNER_CONTRACT_MISMATCH');

  const wrongChannel = ownerAction(ctx, 'execution_loop', 'combined-bank', 'enable');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId: 'execution_loop',
    operation: 'enable',
    ownerAction: wrongChannel,
    expectedRevision: loopCurrent.registry_revision,
    expectedHash: loopCurrent.snapshot_hash,
  })), 'OWNER_ACTION_REQUIRED');

  const declineInitial = runtime.getRepositoryStatus(options(declineCtx));
  const declineAction = ownerAction(declineCtx, 'repository.governance', 'capability-route', 'decline');
  runtime.writeCapabilityDecision({
    ...options(declineCtx),
    capabilityId: 'repository.governance',
    operation: 'decline',
    ownerAction: declineAction,
    expectedRevision: declineInitial.registry_revision,
    expectedHash: declineInitial.snapshot_hash,
  });
  const declineCurrent = runtime.getRepositoryStatus(options(declineCtx));
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...options(declineCtx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: declineAction,
    expectedRevision: declineCurrent.registry_revision,
    expectedHash: declineCurrent.snapshot_hash,
  })), 'OWNER_DECISION_BINDING_MISMATCH');
  assert.equal(runtime.getRepositoryStatus(options(declineCtx)).capabilities['repository.governance'].state, 'disabled');
});

test('combined bank canonical choices cannot be tampered, swapped, or omitted', (t) => {
  const cases = [
    {
      name: 'effect',
      mutateBank: (bank) => { bank.questions[0].effect_id = 'tampered-effect'; },
    },
    {
      name: 'swapped semantic id',
      mutateBank: (bank) => { bank.questions[0].choices[0].semantic_id = bank.questions[0].choices[1].semantic_id; },
    },
    {
      name: 'missing choice',
      mutateBank: (bank) => { bank.questions[0].choices.pop(); },
    },
    {
      name: 'answer choice mismatch',
      mutateAnswers: (answers) => { answers[0].choice_semantic_id = 'repository.governance.decline'; },
    },
  ];
  for (const testCase of cases) {
    const ctx = sandbox();
    t.after(() => cleanup(ctx));
    const initial = runtime.getRepositoryStatus(options(ctx));
    const bank = JSON.parse(JSON.stringify(runtime.probeRepository(options(ctx)).question_bank));
    const answer = (capabilityId, operation) => ({
      capability_id: capabilityId,
      operation,
      choice_semantic_id: runtime.capabilityDecisionSemanticId(capabilityId, operation),
      ownerAction: ownerAction(ctx, capabilityId, 'combined-bank', operation),
    });
    const answers = [answer('repository.governance', 'enable'), answer('execution_loop', 'enable')];
    if (testCase.mutateBank) testCase.mutateBank(bank);
    if (testCase.mutateAnswers) testCase.mutateAnswers(answers);
    assert.equal(errorCode(() => runtime.writeCombinedDecisions({
      ...options(ctx),
      bank,
      answers,
      expectedRevision: initial.registry_revision,
      expectedHash: initial.snapshot_hash,
    })), 'COMBINED_ANSWER_INVALID', testCase.name);
    assert.equal(fs.existsSync(ctx.registryPath), false, testCase.name);
  }
});
