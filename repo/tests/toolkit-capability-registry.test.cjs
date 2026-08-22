'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-capability-registry.cjs');
const policyPath = path.join(repoRoot, '_projects', 'development', 'repository-capability-registry', '_main', 'repository-capability-policy.json');
const schemaPath = path.join(repoRoot, '_projects', 'development', 'repository-capability-registry', '_main', 'repository-capability-contract.schema.json');
const runtime = require(runtimePath);
const a1 = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs'));

const DEFAULT_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';
const SECRET = 'secret-fixture-value-must-not-persist';
const QUESTION_PROSE = 'Do you want Toolkit to manage this repository?';

function git(repo, args) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function sandbox(remote = DEFAULT_REMOTE, withOrigin = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-capability-registry-'));
  const repo = path.join(root, 'repo');
  const registryPath = path.join(root, 'state', 'repository-governance.v1.json');
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--quiet', repo]);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'Fixture']);
  if (withOrigin) git(repo, ['remote', 'add', 'origin', remote]);
  return { root, repo, registryPath };
}

function cleanup(ctx) {
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

function callOptions(ctx, extra = {}) {
  return {
    cwd: ctx.repo,
    registryPath: ctx.registryPath,
    testOnly: true,
    ...extra,
  };
}

function status(ctx, extra = {}) {
  return runtime.getRepositoryStatus(callOptions(ctx, extra));
}

function ownerAction(statusResult, capabilityId, channel = 'capability-route', operation = 'enable') {
  return {
    confirmed: true,
    category: 'explicit-owner',
    channel,
    operation,
    choice_semantic_id: runtime.capabilityDecisionSemanticId(capabilityId, operation),
    contract_digest: runtime.CONTRACT_DIGEST,
    scope_digest: runtime.capabilityScopeDigest(statusResult.repository_id, capabilityId, operation, channel),
  };
}

function decision(ctx, capabilityId, operation, extra = {}) {
  const current = status(ctx);
  return runtime.writeCapabilityDecision({
    ...callOptions(ctx),
    capabilityId,
    operation,
    ownerAction: ownerAction(current, capabilityId, extra.channel || 'capability-route', operation),
    expectedRevision: current.registry_revision,
    expectedHash: current.snapshot_hash,
    ...extra,
  });
}

function errorCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code || error.message;
  }
  assert.fail('expected a deterministic registry error');
}

test('A2 source/runtime contracts are closed and reuse the accepted A1 remote contract', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  assert.equal(runtime.REMOTE_IDENTITY_CONTRACT_VERSION, a1.REMOTE_IDENTITY_CONTRACT_VERSION);
  assert.deepEqual(runtime.CAPABILITIES, ['repository.governance', 'execution_loop', 'repository.protection']);
  assert.deepEqual(policy.capabilities.map((entry) => entry.id), runtime.CAPABILITIES);
  for (const policyCapability of policy.capabilities) {
    const runtimeCapability = runtime.CONTRACT_SEMANTICS.capabilities[policyCapability.id];
    const expected = {
      effect_id: policyCapability.effect_id,
      boundary_id: policyCapability.boundary_id,
      question_id: policyCapability.question_id,
      choice_semantic_ids: policyCapability.choice_semantic_ids,
      decision_semantic_ids: policyCapability.decision_semantic_ids,
    };
    if (policyCapability.scopes) expected.scopes = policyCapability.scopes;
    assert.deepEqual(runtimeCapability, expected);
  }
  assert.deepEqual([...policy.transitions].sort(), [...runtime.CONTRACT_SEMANTICS.transitions].sort());
  assert.deepEqual(schema.properties.repositories.maxItems, runtime.MAX_REPOSITORIES);
  assert.equal(runtime.CAPABILITIES.includes('codex_review'), false);
  assert.equal(runtime.contractDigest(), runtime.CONTRACT_DIGEST);
  assert.equal(typeof ctx.registryPath, 'string');
});

test('global installation and detection never grant either capability', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const result = runtime.probeRepository(callOptions(ctx, {
    toolkitInstalled: true,
    serviceAvailable: true,
    detectedRepository: true,
    modelOutput: 'enable',
  }));

  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.question_bank.questions.map((question) => question.capability_id), ['repository.governance', 'execution_loop']);
  assert.equal(result.capabilities['repository.protection'].state, 'unresolved');
  assert.equal(result.question_bank.questions.some((question) => question.capability_id === 'repository.protection'), false);
  assert.equal(fs.existsSync(ctx.registryPath), false);
});

test('governance and execution-loop decisions remain independent in both directions', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));

  const initial = status(ctx);
  decision(ctx, 'repository.governance', 'enable');
  const afterGovernance = status(ctx);
  assert.equal(afterGovernance.capabilities['repository.governance'].state, 'enabled');
  assert.equal(afterGovernance.capabilities.execution_loop.state, 'unresolved');

  decision(ctx, 'execution_loop', 'enable');
  const afterLoop = status(ctx);
  assert.equal(afterLoop.capabilities['repository.governance'].state, 'enabled');
  assert.equal(afterLoop.capabilities.execution_loop.state, 'enabled');

  decision(ctx, 'execution_loop', 'disable');
  const afterLoopDisable = status(ctx);
  assert.equal(afterLoopDisable.capabilities['repository.governance'].state, 'enabled');
  assert.equal(afterLoopDisable.capabilities.execution_loop.state, 'disabled');
  assert.equal(afterLoopDisable.registry_revision > initial.registry_revision, true);
});

test('explicit decline/disable is durable and scoped reopen changes only the named capability', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));

  const initial = status(ctx);
  const declined = runtime.writeCapabilityDecision({
    ...callOptions(ctx),
    capabilityId: 'repository.governance',
    operation: 'decline',
    ownerAction: ownerAction(initial, 'repository.governance', 'capability-route', 'decline'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  });
  assert.equal(declined.state, 'disabled');
  assert.equal(status(ctx).capabilities.execution_loop.state, 'unresolved');

  const reopened = runtime.reopenCapability({
    ...callOptions(ctx),
    capabilityId: 'repository.governance',
    ownerAction: ownerAction(status(ctx), 'repository.governance', 'capability-route', 'reopen'),
  });
  assert.deepEqual(reopened.question_bank.questions.map((question) => question.capability_id), ['repository.governance']);
  assert.equal(reopened.writes, 0);
  assert.equal(status(ctx).capabilities['repository.governance'].state, 'disabled');

  decision(ctx, 'repository.governance', 'enable');
  const finalStatus = status(ctx);
  assert.equal(finalStatus.capabilities['repository.governance'].state, 'enabled');
  assert.equal(finalStatus.capabilities.execution_loop.state, 'unresolved');
});

test('silence, timeout, failure, model output, and missing owner action never mutate consent', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = status(ctx);

  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...callOptions(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'OWNER_ACTION_REQUIRED');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...callOptions(ctx),
    capabilityId: 'repository.governance',
    operation: 'timeout',
    ownerAction: ownerAction(initial, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'OPERATION_INVALID');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...callOptions(ctx),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: { confirmed: false, category: 'explicit-owner', channel: 'capability-route' },
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'OWNER_ACTION_REQUIRED');
  assert.equal(status(ctx).capabilities['repository.governance'].state, 'unresolved');
  assert.equal(fs.existsSync(ctx.registryPath), false);
});

test('same canonical remote survives moved/recloned paths while different remotes isolate records', (t) => {
  const shared = DEFAULT_REMOTE;
  const first = sandbox(shared);
  const clone = sandbox(shared);
  const different = sandbox('https://github.com/example/different.git');
  t.after(() => {
    cleanup(first);
    cleanup(clone);
    cleanup(different);
  });

  decision(first, 'execution_loop', 'enable');
  const firstStatus = status(first);
  const cloneStatus = status({ ...clone, registryPath: first.registryPath });
  assert.equal(cloneStatus.repository_id, firstStatus.repository_id);
  assert.equal(cloneStatus.capabilities.execution_loop.state, 'enabled');

  const isolatedDifferent = status({ ...different, registryPath: first.registryPath });
  assert.notEqual(isolatedDifferent.repository_id, firstStatus.repository_id);
  assert.equal(isolatedDifferent.capabilities.execution_loop.state, 'unresolved');
});

test('missing, multiple, and malformed origin identity fail closed', (t) => {
  const missing = sandbox(DEFAULT_REMOTE, false);
  const multiple = sandbox();
  const malformed = sandbox('file:///private/local-repo');
  t.after(() => {
    cleanup(missing);
    cleanup(multiple);
    cleanup(malformed);
  });

  git(multiple.repo, ['remote', 'set-url', '--add', 'origin', 'ssh://git@example.invalid/second.git']);
  assert.equal(status(missing).status, 'actionable');
  assert.equal(status(missing).reason_code, 'ORIGIN_IDENTITY_MISSING');
  assert.equal(status(multiple).reason_code, 'ORIGIN_IDENTITY_AMBIGUOUS');
  assert.equal(status(malformed).reason_code, 'REMOTE_IDENTITY_INVALID');
});

test('caller repository-id/path spoofing cannot select another durable record', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = status(ctx);
  assert.equal(errorCode(() => runtime.getRepositoryStatus(callOptions(ctx, {
    repositoryId: 'f'.repeat(64),
  }))), 'REPOSITORY_ID_SPOOF_ATTEMPT');
  assert.equal(errorCode(() => runtime.writeCapabilityDecision({
    ...callOptions(ctx),
    repositoryId: 'f'.repeat(64),
    capabilityId: 'repository.governance',
    operation: 'enable',
    ownerAction: ownerAction(initial, 'repository.governance'),
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'REPOSITORY_ID_SPOOF_ATTEMPT');
});

test('only privacy-safe digest and compact current receipts persist', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  decision(ctx, 'repository.governance', 'enable');
  decision(ctx, 'execution_loop', 'enable');
  decision(ctx, 'repository.governance', 'disable');
  const text = fs.readFileSync(ctx.registryPath, 'utf8');
  const parsed = JSON.parse(text);

  assert.equal(text.includes(ctx.root), false);
  assert.equal(text.includes(DEFAULT_REMOTE), false);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(QUESTION_PROSE), false);
  assert.equal(text.includes('codex_review'), false);
  assert.equal(parsed.repositories.length, 1);
  assert.equal(parsed.repositories[0].capabilities.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.repositories[0], 'events'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.repositories[0].capabilities[0], 'history'), false);
  for (const capability of parsed.repositories[0].capabilities) {
    assert.match(capability.receipt.receipt_id, /^[a-f0-9]{64}$/);
    assert.equal(capability.receipt.outcome, 'committed');
    assert.equal(capability.receipt.repository_id, parsed.repositories[0].repository_id);
    assert.equal(capability.receipt.capability_id, capability.capability_id);
  }
});

test('all answered state is healthy, silent, and outside the codex_review preference lane', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  decision(ctx, 'repository.governance', 'enable');
  decision(ctx, 'execution_loop', 'enable');
  const instrumentation = {
    model_calls: 0,
    network_calls: 0,
    writes: 0,
    visible_output: 0,
    policy_prose: 0,
    github_calls: 0,
    review_triggers: 0,
    timers: 0,
  };
  const result = runtime.probeRepository(callOptions(ctx, {
    instrumentation,
    toolkitInstalled: true,
    serviceAvailable: false,
  }));
  assert.equal(result.status, 'healthy');
  assert.equal(result.question_bank, null);
  assert.equal(result.visible_output, false);
  assert.equal(result.policy_prose, false);
  assert.deepEqual(instrumentation, {
    model_calls: 0,
    network_calls: 0,
    writes: 0,
    visible_output: 0,
    policy_prose: 0,
    github_calls: 0,
    review_triggers: 0,
    timers: 0,
  });
});

test('explicit status/setup/reopen/enable/disable operations are deterministic and capability-specific', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.status(callOptions(ctx));
  assert.deepEqual(Object.keys(initial.capabilities), runtime.CAPABILITIES);
  const setup = runtime.setupCapability({
    ...callOptions(ctx),
    capabilityId: 'execution_loop',
  });
  assert.deepEqual(setup.question_bank.questions.map((question) => question.capability_id), ['execution_loop']);
  assert.equal(setup.writes, 0);
  decision(ctx, 'execution_loop', 'enable');
  const enabled = runtime.status(callOptions(ctx));
  assert.equal(enabled.capabilities.execution_loop.state, 'enabled');
  decision(ctx, 'execution_loop', 'disable');
  assert.equal(runtime.status(callOptions(ctx)).capabilities.execution_loop.state, 'disabled');
  assert.equal(runtime.status(callOptions(ctx)).capabilities['repository.governance'].state, 'unresolved');
});

test('A1 remote validation is the only canonicalisation path for durable identity', (t) => {
  const ctx = sandbox('git@github.com:weijunswj/ai-agent-toolkit.git');
  t.after(() => cleanup(ctx));
  const identity = runtime.resolveRepositoryIdentity(callOptions(ctx));
  const a1Remote = a1.validateRemoteIdentity('git@github.com:weijunswj/ai-agent-toolkit.git');
  assert.equal(a1Remote.valid, true);
  assert.equal(identity.remote_contract, a1.REMOTE_IDENTITY_CONTRACT_VERSION);
  assert.equal(identity.repository_id, runtime.repositoryIdForCanonicalRemote(a1Remote.canonical));
  assert.match(identity.repository_id, /^[a-f0-9]{64}$/);
  assert.equal(identity.persisted_fields.includes('remote'), false);
  assert.equal(identity.persisted_fields.includes('path'), false);
});

test('semantic digest is independent of cosmetic question wording and display order', () => {
  const altered = runtime.authoritySemanticsForTest({
    cosmetic_question_text: 'different wording',
    display_order: ['execution_loop', 'repository.governance'],
  });
  assert.equal(runtime.contractDigest(altered), runtime.CONTRACT_DIGEST);
  const alteredMeaning = runtime.authoritySemanticsForTest({
    effect_id_override: { execution_loop: 'different-authority' },
  });
  assert.notEqual(runtime.contractDigest(alteredMeaning), runtime.CONTRACT_DIGEST);
  assert.match(crypto.createHash('sha256').update(runtime.canonicalSerialize(alteredMeaning)).digest('hex'), /^[a-f0-9]{64}$/);
});
