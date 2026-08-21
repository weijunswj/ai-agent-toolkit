'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const mutationTarget = { child_id: 'child-1' };
const mutationUpdate = { type: 'set_field', field: 'owner_detail', value: 'RUN-178 bounded repair' };

function parentState(overrides = {}) {
  return {
    kind: 'parent', tracker_version: 'v3', repository, parent_issue: 240,
    current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 0, state: 'not_opened' } }],
    pending_work: [{ child_id: 'child-2', issue_number: 320, lifecycle: 'pending', queue_order: 1, objective: 'Truthful review inventory' }],
    other_open_prs: [], terminal: [], deferred_findings: [], owner_detail: 'Owner bytes remain outside the queue projection.',
    ...overrides,
  };
}

function body(state = parentState()) {
  return `owner-before\n${n5.renderManagedBlock('parent', state)}owner-after\n`;
}

function enabledA2() {
  return { status: () => ({ capabilities: { 'repository.governance': { state: 'enabled' } } }) };
}

function githubAdapter(initialBody) {
  let current = initialBody;
  let reads = 0;
  let writes = 0;
  return {
    getParent() { reads += 1; return { body: current, complete: true, revision: `r${reads}` }; },
    updateParent(payload) { writes += 1; current = payload.body; },
    get values() { return { reads, writes, current }; },
  };
}

function request(overrides = {}) {
  return {
    repository,
    parent_issue: 240,
    target: { ...mutationTarget },
    update: { ...mutationUpdate },
    accepted_preview: true,
    ...overrides,
  };
}

function expectedScope(overrides = {}) {
  const input = request(overrides);
  return {
    repository: input.repository,
    parent_issue: input.parent_issue,
    intent: input.intent || 'reconcile',
    target: input.target || {},
    update: input.update || {},
  };
}

function expectedOperation(overrides = {}) {
  const scope = expectedScope(overrides);
  return {
    type: 'github.mutation',
    repository: scope.repository,
    action: `n5.${scope.intent}`,
    target: { kind: 'github-repository', digest: n5.sha256(scope) },
  };
}

function exactDecision(payload) {
  return {
    decision: 'allow',
    operation_type: 'github.mutation',
    operation_digest: a1.operationDigest(payload.operation),
    target_digest: a1.targetDigest(payload.operation),
  };
}

function brokerFactory(response = exactDecision) {
  const calls = [];
  return {
    calls,
    value: {
      authorize(payload) {
        calls.push(payload);
        return response(payload);
      },
    },
  };
}

function runWithBroker({ broker, inputOverrides = {}, runtimeRepository = repository, stateOverrides = {} } = {}) {
  const github = githubAdapter(body(parentState({ repository: runtimeRepository, parent_issue: inputOverrides.parent_issue || 240, ...stateOverrides })));
  const result = n5.createRuntime({
    repository: runtimeRepository,
    authority_broker: broker,
    a2: enabledA2(),
    github,
  }).reconcile(request(inputOverrides));
  return { result, github };
}

test('N5 sends one canonical typed A1 operation and real canonical digests', () => {
  const broker = brokerFactory();
  const { result, github } = runWithBroker({ broker: broker.value });
  assert.equal(result.code, 'N5_RECONCILED');
  assert.equal(broker.calls.length, 1);
  const authorization = broker.calls[0];
  const operation = expectedOperation();
  assert.deepEqual(authorization.operation, operation);
  assert.equal(operation.type, 'github.mutation');
  assert.equal(operation.repository, repository);
  assert.equal(operation.action, 'n5.reconcile');
  assert.equal(operation.target.kind, 'github-repository');
  assert.equal(operation.target.digest, n5.sha256(expectedScope()));
  assert.equal(authorization.operation_digest, a1.operationDigest(operation));
  assert.equal(authorization.target_digest, a1.targetDigest(operation));
  assert.equal(github.values.writes, 1);
});

test('evaluate-only broker receives the same canonical A1 binding', () => {
  const calls = [];
  const github = githubAdapter(body());
  const broker = {
    evaluate(payload) {
      calls.push(payload);
      return exactDecision(payload);
    },
  };
  const result = n5.createRuntime({ repository, authority_broker: broker, a2: enabledA2(), github }).reconcile(request());
  assert.equal(result.code, 'N5_RECONCILED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation_digest, a1.operationDigest(calls[0].operation));
  assert.equal(calls[0].target_digest, a1.targetDigest(calls[0].operation));
});

test('each bound mutation input changes the canonical A1 binding', () => {
  const variants = [
    { name: 'repository', inputOverrides: { repository: 'weijunswj/other-repo' }, runtimeRepository: 'weijunswj/other-repo', stateOverrides: { repository: 'weijunswj/other-repo' } },
    { name: 'parent_issue', inputOverrides: { parent_issue: 241 }, stateOverrides: { parent_issue: 241 } },
    { name: 'intent', inputOverrides: { intent: 'initialise' } },
    { name: 'target', inputOverrides: { target: { child_id: 'child-2' } } },
    { name: 'update', inputOverrides: { update: { type: 'set_field', field: 'owner_detail', value: 'different bounded repair' } } },
  ];
  const baselineBroker = brokerFactory();
  const baseline = runWithBroker({ broker: baselineBroker.value });
  assert.equal(baseline.result.code, 'N5_RECONCILED');
  const baselineOperationDigest = baselineBroker.calls[0].operation_digest;
  const baselineTargetDigest = baselineBroker.calls[0].target_digest;
  for (const variant of variants) {
    const broker = brokerFactory();
    const { result } = runWithBroker({ ...variant, broker: broker.value });
    assert.equal(result.code, 'N5_RECONCILED', variant.name);
    assert.notEqual(broker.calls[0].operation_digest, baselineOperationDigest, variant.name);
    assert.notEqual(broker.calls[0].target_digest, baselineTargetDigest, variant.name);
  }
});

test('source no longer contains the custom N5 authorize or authority-digest seam', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/toolkit-github-governance-review-reconciler.cjs'), 'utf8');
  assert.doesNotMatch(source, /options\.a1\.authorize/);
  assert.doesNotMatch(source, /expected_operation_digest\s*=\s*sha256\(operation\)/);
  assert.match(source, /a1\.operationDigest\(operation\)/);
  assert.match(source, /a1\.targetDigest\(operation\)/);
});

test('missing, non-allow, malformed, stale, swapped, and authority-leaking broker responses fail before GitHub', () => {
  const cases = [
    ['missing broker', undefined],
    ['ask', brokerFactory((payload) => ({ ...exactDecision(payload), decision: 'ask' })).value],
    ['deny', brokerFactory((payload) => ({ ...exactDecision(payload), decision: 'deny' })).value],
    ['unsupported', brokerFactory((payload) => ({ ...exactDecision(payload), decision: 'unsupported' })).value],
    ['malformed', brokerFactory(() => null).value],
    ['wrong operation type', brokerFactory((payload) => ({ ...exactDecision(payload), operation_type: 'github.read' })).value],
    ['wrong operation digest', brokerFactory((payload) => ({ ...exactDecision(payload), operation_digest: 'e'.repeat(64) })).value],
    ['wrong target digest', brokerFactory((payload) => ({ ...exactDecision(payload), target_digest: 'f'.repeat(64) })).value],
    ['swapped digests', brokerFactory((payload) => { const decision = exactDecision(payload); return { ...decision, operation_digest: decision.target_digest, target_digest: decision.operation_digest }; }).value],
    ['old custom digest', brokerFactory((payload) => ({
      decision: 'allow', operation_type: 'github.mutation',
      operation_digest: n5.sha256({ operation_type: 'github.mutation', repository, parent_issue: 240, intent: 'reconcile', target: mutationTarget, update: mutationUpdate }),
      target_digest: n5.sha256(mutationTarget),
      operation: payload.operation,
    })).value],
    ['issuer leakage', brokerFactory((payload) => ({ ...exactDecision(payload), issuer: 'a1' })).value],
    ['self-mint leakage', brokerFactory((payload) => ({ ...exactDecision(payload), self_mint: true })).value],
    ['createIssuer leakage', brokerFactory((payload) => ({ ...exactDecision(payload), createIssuer: true })).value],
  ];
  for (const [name, broker] of cases) {
    const { result, github } = runWithBroker({ broker });
    assert.equal(result.code, 'N5_AUTHORITY_REQUIRED', name);
    assert.equal(github.values.reads, 0, name);
    assert.equal(github.values.writes, 0, name);
  }
});

test('arbitrary caller-authored mutation action is rejected before GitHub', () => {
  const broker = brokerFactory();
  const { result, github } = runWithBroker({ broker: broker.value, inputOverrides: { intent: 'caller-authored-action' } });
  assert.equal(result.code, 'N5_AUTHORITY_REQUIRED');
  assert.equal(broker.calls.length, 0);
  assert.equal(github.values.reads, 0);
  assert.equal(github.values.writes, 0);
});

test('the four mutating N5 intents use the closed source-owned action mapping', () => {
  for (const [method, intent] of [['initialise', 'initialise'], ['migrate', 'migrate'], ['reconcile', 'reconcile'], ['remove', 'remove']]) {
    const broker = brokerFactory();
    const github = githubAdapter(body());
    const runtime = n5.createRuntime({ repository, authority_broker: broker.value, a2: enabledA2(), github });
    const result = runtime[method](request());
    assert.equal(result.ok, true, method);
    assert.equal(broker.calls.length, 1, method);
    assert.equal(broker.calls[0].operation.action, `n5.${intent}`);
    assert.deepEqual(broker.calls[0].operation, expectedOperation({ intent }));
  }
});

test('source policy declares the canonical A1 broker and closed action mapping', () => {
  const policyPath = path.resolve(__dirname, '../../_projects/development/github-governance-review-reconciler/_main/github-governance-review-reconciler-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  assert.equal(policy.authority.a1.broker, 'authority_broker');
  assert.equal(policy.authority.a1.operation_shape, 'canonical-typed');
  assert.deepEqual(policy.authority.a1.canonical_digest_source, ['operationDigest', 'targetDigest']);
  assert.deepEqual(policy.authority.a1.mutation_actions, {
    initialise: 'n5.initialise',
    migrate: 'n5.migrate',
    reconcile: 'n5.reconcile',
    remove: 'n5.remove',
  });
});

test('read-only intents never invoke the mutation broker', () => {
  let brokerCalls = 0;
  const broker = { authorize() { brokerCalls += 1; throw new Error('mutation broker invoked for read-only intent'); } };
  const runtime = n5.createRuntime({ repository, authority_broker: broker, a2: enabledA2(), github: githubAdapter(body()) });
  const parentBody = body();
  assert.equal(runtime.inspect({ body: parentBody, kind: 'parent' }).ok, true);
  assert.equal(runtime.preview({ body: parentBody, kind: 'parent', target: mutationTarget, update: mutationUpdate }).ok, true);
  assert.equal(runtime.validate({ body: parentBody, kind: 'parent' }).ok, true);
  assert.equal(runtime.show({ body: parentBody, kind: 'parent' }).ok, true);
  assert.equal(brokerCalls, 0);
});
