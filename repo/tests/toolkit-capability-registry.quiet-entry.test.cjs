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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-capability-registry-quiet-'));
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

function ownerAction(statusResult, capabilityId, operation = 'enable') {
  return {
    confirmed: true,
    category: 'explicit-owner',
    channel: 'capability-route',
    operation,
    choice_semantic_id: runtime.capabilityDecisionSemanticId(capabilityId, operation),
    contract_digest: runtime.CONTRACT_DIGEST,
    scope_digest: runtime.capabilityScopeDigest(statusResult.repository_id, capabilityId, operation, 'capability-route'),
  };
}

function enable(ctx, capabilityId) {
  const current = runtime.getRepositoryStatus(options(ctx));
  return runtime.writeCapabilityDecision({
    ...options(ctx),
    capabilityId,
    operation: 'enable',
    ownerAction: ownerAction(current, capabilityId),
    expectedRevision: current.registry_revision,
    expectedHash: current.snapshot_hash,
  });
}

function errorCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code || error.message;
  }
  assert.fail('expected deterministic quiet-entry error');
}

test('both unresolved capabilities fan into one bounded bank, with no policy prose', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const result = runtime.probeRepository(options(ctx));
  assert.equal(result.status, 'unresolved');
  assert.equal(result.visible_output, false);
  assert.equal(result.policy_prose, false);
  assert.equal(result.question_bank.kind, 'repository-capability-question-bank');
  assert.equal(result.question_bank.questions.length, 2);
  assert.deepEqual(result.question_bank.questions.map((question) => question.capability_id), runtime.CAPABILITIES);
  for (const question of result.question_bank.questions) {
    assert.equal(typeof question.question_id, 'string');
    assert.equal(typeof question.effect_id, 'string');
    assert.deepEqual(question.choices.map((choice) => choice.semantic_id), [
      question.capability_id + '.decline',
      question.capability_id + '.enable',
    ]);
  }
});

test('one unresolved capability renders only that question and all answered renders nothing', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  enable(ctx, 'repository.governance');
  const one = runtime.probeRepository(options(ctx));
  assert.equal(one.status, 'unresolved');
  assert.deepEqual(one.question_bank.questions.map((question) => question.capability_id), ['execution_loop']);

  enable(ctx, 'execution_loop');
  const healthy = runtime.probeRepository(options(ctx));
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.question_bank, null);
  assert.equal(healthy.visible_output, false);
  assert.equal(healthy.policy_prose, false);
});

test('partial, malformed, and abandoned combined answers write nothing', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const initial = runtime.getRepositoryStatus(options(ctx));
  const bank = runtime.probeRepository(options(ctx)).question_bank;
  const action = (capabilityId, operation) => ({
    capability_id: capabilityId,
    operation,
    choice_semantic_id: runtime.capabilityDecisionSemanticId(capabilityId, operation),
    ownerAction: {
      confirmed: true,
      category: 'explicit-owner',
      channel: 'combined-bank',
      operation,
      choice_semantic_id: runtime.capabilityDecisionSemanticId(capabilityId, operation),
      contract_digest: runtime.CONTRACT_DIGEST,
      scope_digest: runtime.capabilityScopeDigest(initial.repository_id, capabilityId, operation, 'combined-bank'),
    },
  });

  assert.equal(errorCode(() => runtime.writeCombinedDecisions({
    ...options(ctx),
    answers: [action('repository.governance', 'enable')],
    bank,
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'COMBINED_ANSWER_PARTIAL');
  assert.equal(errorCode(() => runtime.writeCombinedDecisions({
    ...options(ctx),
    answers: [],
    bank,
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'COMBINED_ANSWER_ABANDONED');
  assert.equal(errorCode(() => runtime.writeCombinedDecisions({
    ...options(ctx),
    answers: [action('repository.governance', 'enable'), {
      capability_id: 'execution_loop',
      operation: 'enable',
      choice_semantic_id: runtime.capabilityDecisionSemanticId('execution_loop', 'enable'),
      ownerAction: {
        confirmed: false,
        category: 'explicit-owner',
        channel: 'combined-bank',
        operation: 'enable',
        choice_semantic_id: runtime.capabilityDecisionSemanticId('execution_loop', 'enable'),
        contract_digest: runtime.CONTRACT_DIGEST,
        scope_digest: runtime.capabilityScopeDigest(initial.repository_id, 'execution_loop', 'enable', 'combined-bank'),
      },
    }],
    bank,
    expectedRevision: initial.registry_revision,
    expectedHash: initial.snapshot_hash,
  })), 'OWNER_ACTION_REQUIRED');
  assert.equal(fs.existsSync(ctx.registryPath), false);
});

test('healthy exact repository open is a deterministic local read-only no-op', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  enable(ctx, 'repository.governance');
  enable(ctx, 'execution_loop');
  const firstInstrumentation = {
    model_calls: 0,
    network_calls: 0,
    writes: 0,
    visible_output: 0,
    policy_prose: 0,
    bridge_calls: 0,
    native_hook_calls: 0,
    github_calls: 0,
    provider_calls: 0,
    renderer_calls: 0,
  };
  const first = runtime.probeRepository(options(ctx, {
    instrumentation: firstInstrumentation,
  }));
  const secondInstrumentation = {
    model_calls: 0,
    network_calls: 0,
    writes: 0,
    visible_output: 0,
    policy_prose: 0,
    bridge_calls: 0,
    native_hook_calls: 0,
    github_calls: 0,
    provider_calls: 0,
    renderer_calls: 0,
  };
  const second = runtime.probeRepository(options(ctx, {
    instrumentation: secondInstrumentation,
  }));
  assert.deepEqual(second, first);
  assert.deepEqual(firstInstrumentation, secondInstrumentation);
  assert.equal(first.status, 'healthy');
  assert.equal(first.visible_output, false);
  assert.equal(first.policy_prose, false);
  assert.equal(firstInstrumentation.model_calls, 0);
  assert.equal(firstInstrumentation.network_calls, 0);
  assert.equal(firstInstrumentation.writes, 0);
  assert.equal(firstInstrumentation.visible_output, 0);
  assert.equal(firstInstrumentation.renderer_calls, 0);
});

test('ephemeral duplicate suppression does not persist silence as a decision', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  const sessionMemo = new Set();
  const first = runtime.probeRepository(options(ctx, { sessionMemo }));
  const second = runtime.probeRepository(options(ctx, { sessionMemo }));
  assert.equal(first.question_bank.questions.length, 2);
  assert.equal(second.question_bank, null);
  assert.equal(second.suppressed, true);
  assert.equal(fs.existsSync(ctx.registryPath), false);
  assert.equal(runtime.getRepositoryStatus(options(ctx)).capabilities['repository.governance'].state, 'unresolved');
});

test('answered capability is not reopened by an unrelated unresolved capability', (t) => {
  const ctx = sandbox();
  t.after(() => cleanup(ctx));
  enable(ctx, 'repository.governance');
  const result = runtime.probeRepository(options(ctx));
  assert.deepEqual(result.question_bank.questions.map((question) => question.capability_id), ['execution_loop']);
  assert.equal(runtime.getRepositoryStatus(options(ctx)).capabilities['repository.governance'].state, 'enabled');
});

test('missing identity is actionable but does not invoke model, network, or write paths', (t) => {
  const ctx = sandbox(REMOTE);
  t.after(() => cleanup(ctx));
  git(ctx.repo, ['remote', 'remove', 'origin']);
  const instrumentation = {
    model_calls: 0,
    network_calls: 0,
    writes: 0,
    visible_output: 0,
    policy_prose: 0,
  };
  const result = runtime.probeRepository(options(ctx, { instrumentation }));
  assert.equal(result.status, 'actionable');
  assert.equal(result.reason_code, 'ORIGIN_IDENTITY_MISSING');
  assert.deepEqual(instrumentation, {
    model_calls: 0,
    network_calls: 0,
    writes: 0,
    visible_output: 0,
    policy_prose: 0,
  });
  assert.equal(fs.existsSync(ctx.registryPath), false);
});
