'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const n5 = require('../scripts/toolkit-github-program-reconciler.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const repositoryId = '1'.repeat(64);
const ownerKey = `${repository}+240`;

function parentState(overrides = {}) {
  return {
    kind: 'parent', tracker_version: 'v3', repository, parent_issue: 240,
    current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 0, state: 'not_opened' } }],
    pending_work: [{ child_id: 'child-2', issue_number: 320, lifecycle: 'pending', queue_order: 1, objective: 'Truthful review inventory' }],
    other_open_prs: [], terminal: [], deferred_findings: [], owner_detail: 'Owner bytes remain outside the queue projection.',
    ...overrides,
  };
}

function body(state = parentState(), prefix = 'unmanaged-prefix\n', suffix = 'unmanaged-suffix\n') {
  return prefix + n5.renderManagedBlock('parent', state) + suffix;
}

function enabledA2(canonical_remote = 'https://github.com/weijunswj/ai-agent-toolkit.git') {
  return {
    resolveRepositoryIdentity: () => ({ valid: true, repository_id: repositoryId, canonical_remote }),
    getRepositoryStatus: () => ({ status: 'healthy', actionable: false, repository_id: repositoryId, canonical_remote, capabilities: { 'repository.governance': { state: 'enabled' } } }),
  };
}

function authorisedA1() {
  return { authorize: ({ operation }) => ({ decision: 'allow', operation_type: operation.type, operation_digest: a1.operationDigest(operation), target_digest: a1.targetDigest(operation) }) };
}

function adapter(initialBody, options = {}) {
  let current = initialBody;
  let reads = 0;
  let writes = 0;
  let relatedCalls = 0;
  const writePayloads = [];
  const sequence = options.sequence || [];
  const github = {
    getParent() {
      const index = reads;
      reads += 1;
      if (sequence[index] !== undefined) return sequence[index];
      if (options.readbackValue !== undefined && index >= 2) return options.readbackValue;
      if (options.readbackBody !== undefined && index >= 2) return { body: options.readbackBody, complete: options.readbackComplete !== false, revision: `r${index}` };
      return { body: current, complete: true, revision: `r${index}` };
    },
    get values() { return { current, reads, writes, relatedCalls, writePayloads: [...writePayloads] }; },
  };
  if (!options.noUpdate) {
    github.updateParent = (payload) => {
      writes += 1;
      writePayloads.push(payload);
      current = payload.body;
      if (options.updateError) throw new Error('simulated update uncertainty');
      return { accepted: true };
    };
  }
  if (typeof options.reconcileRelated === 'function') {
    github.reconcileRelated = (payload) => {
      relatedCalls += 1;
      return options.reconcileRelated(payload);
    };
  }
  return github;
}

function targetForBody(sourceBody) {
  const parsed = n5.parseManagedBlock(sourceBody, 'parent', { complete: true });
  return { kind: n5.MUTATION_TARGET_KINDS.managed_parent_block, body_digest: parsed.body_digest, managed_digest: parsed.managed_digest };
}

function removeInput(overrides = {}) {
  const { target: overrideTarget, sourceBody, ...rest } = overrides;
  return { repository, parent_issue: 240, target: overrideTarget || targetForBody(sourceBody || body()), update: {}, accepted_preview: true, ...rest };
}

function runtime(initialBody, options = {}) {
  return n5.createRuntime({
    repository,
    authority_broker: options.authority_broker || authorisedA1(),
    a2: options.a2 || enabledA2(),
    github: options.github || adapter(initialBody),
    transaction_owner: options.transaction_owner,
  });
}

test('RED: remove must reject an already-held repository+parent owner before any write', () => {
  const original = body();
  const github = adapter(original);
  const owners = new Map([[ownerKey, true]]);
  const result = runtime(original, { github, transaction_owner: owners }).remove(removeInput());
  assert.equal(result.code, 'PARENT_CONCURRENCY_CONFLICT');
  assert.equal(github.values.reads, 0);
  assert.equal(github.values.writes, 0);
});

test('RED: remove must rebind immediately and abort on movement without retry', () => {
  const original = body();
  const moved = body(parentState({ owner_detail: 'moved before the write' }));
  const github = adapter(original, { sequence: [
    { body: original, complete: true, revision: 'r0' },
    { body: moved, complete: true, revision: 'r1' },
  ] });
  const result = runtime(original, { github }).remove(removeInput());
  assert.equal(result.code, 'PARENT_CONCURRENCY_CONFLICT');
  assert.equal(github.values.reads, 2);
  assert.equal(github.values.writes, 0);
});

test('RED: successful remove fetches, rebinds, writes once, and reads back immediately', () => {
  const original = body();
  const github = adapter(original);
  const result = runtime(original, { github }).remove(removeInput());
  assert.equal(result.code, 'N5_REMOVED');
  assert.equal(github.values.reads, 3);
  assert.equal(github.values.writes, 1);
});

test('RED: successful remove preserves unmanaged bytes and removes exactly one managed block', () => {
  const prefix = 'prefix-first\nsecond-prefix\n';
  const suffix = '\nfirst-suffix\nsecond-suffix\n';
  const original = body(parentState(), prefix, suffix);
  const parsed = n5.parseManagedBlock(original, 'parent', { complete: true });
  const expected = parsed.prefix + parsed.suffix;
  const github = adapter(original);
  const result = runtime(original, { github }).remove(removeInput({ target: targetForBody(original) }));
  assert.equal(result.code, 'N5_REMOVED');
  assert.equal(github.values.current, expected);
  assert.equal(github.values.current.includes(n5.MANAGED_MARKERS.parent.begin), false);
  assert.equal(github.values.current.includes(n5.MANAGED_MARKERS.parent.end), false);
  assert.equal(github.values.writePayloads[0].body, expected);
});

test('RED: missing updateParent fails closed without a write', () => {
  const original = body();
  const github = adapter(original, { noUpdate: true });
  const result = runtime(original, { github }).remove(removeInput());
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(github.values.writes, 0);
  assert.equal(github.values.reads, 2);
});

test('RED: an uncertain write is attempted once and is never retried', () => {
  const original = body();
  const github = adapter(original, { updateError: true });
  const result = runtime(original, { github }).remove(removeInput());
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(github.values.writes, 1);
  assert.equal(github.values.reads, 2);
});

test('RED: missing or malformed readback fails closed', () => {
  const original = body();
  const missing = adapter(original, { readbackValue: { complete: true } });
  const malformed = adapter(original, { readbackValue: { body: original, complete: false } });
  assert.equal(runtime(original, { github: missing }).remove(removeInput()).code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(runtime(original, { github: malformed }).remove(removeInput()).code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('RED: mismatched readback fails closed and is not reported as removed', () => {
  const original = body();
  const mismatch = body(parentState({ owner_detail: 'unexpected readback' }));
  const github = adapter(original, { readbackBody: mismatch });
  const result = runtime(original, { github }).remove(removeInput());
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('RED: related reconciliation is invoked after readback and fails closed on throw or non-ok', () => {
  const original = body();
  const throwing = adapter(original, { reconcileRelated: () => { throw new Error('related uncertainty'); } });
  const nonOk = adapter(original, { reconcileRelated: () => ({ ok: false }) });
  assert.equal(runtime(original, { github: throwing }).remove(removeInput()).code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(runtime(original, { github: nonOk }).remove(removeInput()).code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(throwing.values.relatedCalls, 1);
  assert.equal(nonOk.values.relatedCalls, 1);
});

test('RED: valid related reconciliation succeeds with a deterministic transition id', () => {
  const original = body();
  const parsed = n5.parseManagedBlock(original, 'parent', { complete: true });
  const expected = parsed.prefix + parsed.suffix;
  let relatedPayload;
  const github = adapter(original, { reconcileRelated: (payload) => { relatedPayload = payload; return { ok: true }; } });
  const result = runtime(original, { github }).remove(removeInput());
  assert.equal(result.code, 'N5_REMOVED');
  assert.equal(github.values.relatedCalls, 1);
  assert.equal(relatedPayload.repository, repository);
  assert.equal(relatedPayload.parent_issue, 240);
  assert.equal(relatedPayload.transition_id, n5.sha256({ before: n5.sha256(original), after: n5.sha256(expected) }));
});

function assertReleased(options, expectedCode) {
  const original = body();
  const owners = new Map();
  const firstGithub = adapter(original, options);
  const first = runtime(original, { github: firstGithub, transaction_owner: owners }).remove(removeInput());
  assert.equal(first.code, expectedCode);
  assert.equal(owners.has(ownerKey), false);
  const secondGithub = adapter(original);
  const second = runtime(original, { github: secondGithub, transaction_owner: owners }).remove(removeInput());
  assert.equal(second.code, 'N5_REMOVED');
  assert.equal(secondGithub.values.writes, 1);
}

test('RED: owner is released after success, conflict, write, readback, and related failures', () => {
  assertReleased({}, 'N5_REMOVED');
  assertReleased({ sequence: [{ body: body(), complete: true, revision: 'r0' }, { body: body(parentState({ owner_detail: 'moved' })), complete: true, revision: 'r1' }] }, 'PARENT_CONCURRENCY_CONFLICT');
  assertReleased({ updateError: true }, 'PARENT_RECONCILIATION_INCOMPLETE');
  assertReleased({ readbackValue: { body: body(), complete: false } }, 'PARENT_RECONCILIATION_INCOMPLETE');
  assertReleased({ reconcileRelated: () => ({ ok: false }) }, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('A1 n5.remove operation binding remains canonical and exact', () => {
  const original = body();
  let received;
  const broker = { authorize: (input) => { received = input; return { decision: 'allow', operation_type: input.operation.type, operation_digest: a1.operationDigest(input.operation), target_digest: a1.targetDigest(input.operation) }; } };
  const result = runtime(original, { authority_broker: broker }).remove(removeInput());
  assert.equal(result.code, 'N5_REMOVED');
  assert.equal(received.operation.type, 'github.mutation');
  assert.equal(received.operation.action, 'n5.remove');
  assert.deepEqual(received.operation.target, { kind: 'github-repository', digest: n5.sha256({ repository, repository_id: repositoryId, parent_issue: 240, intent: 'remove', target: targetForBody(original), update: {} }) });
  assert.equal(received.operation_digest, a1.operationDigest(received.operation));
  assert.equal(received.target_digest, a1.targetDigest(received.operation));
});

test('wrong or missing A1 remove binding fails before all GitHub access', () => {
  for (const authority_broker of [
    { authorize: ({ operation }) => ({ decision: 'allow', operation_type: operation.type, operation_digest: '0'.repeat(64), target_digest: a1.targetDigest(operation) }) },
    { authorize: ({ operation }) => ({ decision: 'allow', operation_type: operation.type, operation_digest: a1.operationDigest(operation) }) },
  ]) {
    const original = body();
    const github = adapter(original);
    const result = runtime(original, { authority_broker, github }).remove(removeInput());
    assert.equal(result.code, 'N5_AUTHORITY_REQUIRED');
    assert.equal(github.values.reads, 0);
    assert.equal(github.values.writes, 0);
  }
});

test('read-only N5 intents remain non-mutating', () => {
  const original = body();
  const github = adapter(original);
  const rt = runtime(original, { github });
  assert.equal(rt.inspect({ kind: 'parent', body: original }).code, 'N5_INSPECTION_READY');
  assert.equal(rt.preview({ kind: 'parent', body: original, update: { type: 'set_field', field: 'owner_detail', value: 'preview' } }).code, 'N5_PREVIEW_READY');
  assert.equal(rt.validate({ kind: 'parent', body: original }).code, 'N5_VALID');
  assert.equal(rt.show({ kind: 'parent', body: original }).code, 'N5_SHOW_READY');
  assert.equal(github.values.reads, 0);
  assert.equal(github.values.writes, 0);
});
