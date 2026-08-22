'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtime = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-capability-registry.cjs'));

const REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';
const V1_SCHEMA = 'toolkit.repository-capability-registry.v1';
const V1_CAPABILITY_CONTRACT = 'toolkit.repository-capability.v1';
const V1_CONTRACT_DIGEST = '79f3b6fa812ffa6775d603ed66b2937e242745488f281d02c914f867fb491602';

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => `${canonical(key)}:${canonical(value[key])}`).join(',') + '}';
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-capability-registry-migration-'));
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

function scope(repositoryId, capabilityId, operation, channel) {
  return digest({
    identity_contract: 'toolkit.repository-identity.v1',
    repository_id: repositoryId,
    capability_id: capabilityId,
    operation,
    choice_semantic_id: `${capabilityId}.${operation}`,
    provenance_channel: channel,
    contract_digest: V1_CONTRACT_DIGEST,
  });
}

function receipt(repositoryId, capabilityId, priorState, resultingState, decisionKind, channel, revision, decidedAt) {
  const value = {
    receipt_id: '',
    repository_id: repositoryId,
    capability_id: capabilityId,
    prior_state: priorState,
    resulting_state: resultingState,
    decision_kind: decisionKind,
    provenance_category: 'explicit-owner',
    provenance_channel: channel,
    scope_digest: scope(repositoryId, capabilityId, decisionKind, channel),
    registry_schema: V1_SCHEMA,
    identity_contract: 'toolkit.repository-identity.v1',
    capability_contract: V1_CAPABILITY_CONTRACT,
    contract_digest: V1_CONTRACT_DIGEST,
    registry_revision: revision,
    outcome: 'committed',
    decided_at: decidedAt,
  };
  value.receipt_id = digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'receipt_id')));
  return value;
}

function legacyRegistry(ctx) {
  const repositoryId = runtime.repositoryIdForCanonicalRemote(REMOTE);
  const decidedAt = '2026-08-22T00:00:00.000Z';
  return {
    schema: V1_SCHEMA,
    schema_version: 1,
    identity_contract: 'toolkit.repository-identity.v1',
    capability_contract: V1_CAPABILITY_CONTRACT,
    contract_digest: V1_CONTRACT_DIGEST,
    registry_revision: 7,
    migration: { state: 'none' },
    repositories: [{
      repository_id: repositoryId,
      capabilities: [
        {
          capability_id: 'repository.governance',
          state: 'enabled',
          decision_kind: 'enable',
          provenance: { category: 'explicit-owner', channel: 'combined-bank', scope_digest: scope(repositoryId, 'repository.governance', 'enable', 'combined-bank') },
          receipt: receipt(repositoryId, 'repository.governance', 'unresolved', 'enabled', 'enable', 'combined-bank', 7, decidedAt),
        },
        {
          capability_id: 'execution_loop',
          state: 'disabled',
          decision_kind: 'decline',
          provenance: { category: 'explicit-owner', channel: 'combined-bank', scope_digest: scope(repositoryId, 'execution_loop', 'decline', 'combined-bank') },
          receipt: receipt(repositoryId, 'execution_loop', 'unresolved', 'disabled', 'decline', 'combined-bank', 7, decidedAt),
        },
      ],
    }],
  };
}

test('valid v1 decisions migrate without rewriting owner evidence or granting protection', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const source = legacyRegistry(ctx);
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, JSON.stringify(source), 'utf8');
  const before = JSON.parse(JSON.stringify(source));

  const status = runtime.getRepositoryStatus({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true });
  const after = JSON.parse(fs.readFileSync(ctx.registryPath, 'utf8'));
  assert.equal(after.schema, 'toolkit.repository-capability-registry.v2');
  assert.equal(status.capabilities['repository.governance'].state, 'enabled');
  assert.equal(status.capabilities.execution_loop.state, 'disabled');
  assert.equal(status.capabilities['repository.protection'].state, 'unresolved');
  assert.equal(after.registry_revision, before.registry_revision);
  assert.deepEqual(after.repositories[0].capabilities, before.repositories[0].capabilities);
  assert.equal(after.migration.source_snapshot_hash.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(after.migration, 'receipt_payload'), false);
});

test('migration interruption before replacement preserves the legacy bytes and consent state', (t) => {
  for (const faultInjection of ['migration-before-target', 'migration-before-replace']) {
    const ctx = sandbox();
    t.after(() => cleanup(ctx));
    const source = legacyRegistry(ctx);
    fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
    fs.writeFileSync(ctx.registryPath, JSON.stringify(source), 'utf8');
    const beforeBytes = fs.readFileSync(ctx.registryPath);
    const status = runtime.getRepositoryStatus({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true, faultInjection });
    assert.equal(status.status, 'actionable');
    assert.deepEqual(fs.readFileSync(ctx.registryPath), beforeBytes);
    assert.equal(fs.existsSync(ctx.registryPath + '.lock'), false);
  }
});

test('migration readback uncertainty remains fail-closed and preserves an interruption marker', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const source = legacyRegistry(ctx);
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, JSON.stringify(source), 'utf8');
  const status = runtime.getRepositoryStatus({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true, faultInjection: 'post-rename-readback' });
  assert.equal(status.status, 'actionable');
  assert.equal(JSON.parse(fs.readFileSync(ctx.registryPath, 'utf8')).schema, 'toolkit.repository-capability-registry.v2');
  const artifacts = fs.readdirSync(path.dirname(ctx.registryPath));
  assert.equal(artifacts.some((name) => name.includes('.transaction-')), true);
  assert.equal(fs.existsSync(ctx.registryPath + '.lock'), false);
});

test('foreign migration lock blocks without stale takeover or source mutation', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const source = legacyRegistry(ctx);
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, JSON.stringify(source), 'utf8');
  const beforeBytes = fs.readFileSync(ctx.registryPath);
  fs.writeFileSync(runtime.lockPathForTest(ctx.registryPath), JSON.stringify({
    schema: 'toolkit.repository-capability-registry.lock.v1',
    token: 'foreign-token',
    created_at: '2026-08-23T00:00:00.000Z',
  }), 'utf8');
  const status = runtime.getRepositoryStatus({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true });
  assert.equal(status.status, 'actionable');
  assert.deepEqual(fs.readFileSync(ctx.registryPath), beforeBytes);
  assert.equal(fs.existsSync(runtime.lockPathForTest(ctx.registryPath)), true);
});

test('rollback requires exact legacy bytes and restores without changing the legacy revision', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const source = legacyRegistry(ctx);
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, JSON.stringify(source), 'utf8');
  const beforeBytes = fs.readFileSync(ctx.registryPath);
  const migrated = runtime.getRepositoryStatus({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true });
  assert.equal(migrated.status, 'healthy');
  assert.equal(runtime.previewMigrationRollback({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true, beforeBytes }).status, 'safe');
  const rolledBack = runtime.rollbackMigration({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true, beforeBytes });
  assert.equal(rolledBack.status, 'rolled_back');
  assert.deepEqual(fs.readFileSync(ctx.registryPath), beforeBytes);
  assert.equal(runtime.parseRegistryBytes(beforeBytes).registry_revision, source.registry_revision);
  const tampered = Buffer.from(JSON.stringify({ ...source, registry_revision: source.registry_revision + 1 }), 'utf8');
  assert.equal(runtime.previewMigrationRollback({ cwd: ctx.repo, registryPath: ctx.registryPath, testOnly: true, beforeBytes: tampered }).status, 'blocked');
});
