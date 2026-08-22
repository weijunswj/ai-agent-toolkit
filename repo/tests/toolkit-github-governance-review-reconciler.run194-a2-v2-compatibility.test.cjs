'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const a2 = require('../scripts/toolkit-capability-registry.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const repositoryId = '1'.repeat(64);

function parentState() {
  return {
    kind: 'parent',
    tracker_version: 'v3',
    repository,
    parent_issue: 240,
    current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 0, state: 'not_opened' } }],
    pending_work: [],
    other_open_prs: [],
    terminal: [],
    deferred_findings: [],
    owner_detail: 'Owner bytes remain outside the queue projection.',
  };
}

function authority() {
  return {
    authorize: ({ operation }) => ({
      decision: 'allow',
      operation_type: operation.type,
      operation_digest: a1.operationDigest(operation),
      target_digest: a1.targetDigest(operation),
    }),
  };
}

function a2Projection(governanceState = 'enabled') {
  return {
    status: 'healthy',
    actionable: false,
    repository_id: repositoryId,
    canonical_remote: 'https://github.com/weijunswj/ai-agent-toolkit.git',
    registry_revision: 6,
    snapshot_hash: 'a'.repeat(64),
    schema: a2.REGISTRY_SCHEMA,
    capabilities: {
      'repository.governance': { state: governanceState, receipt_id: 'b'.repeat(64) },
      execution_loop: { state: 'disabled', receipt_id: 'c'.repeat(64) },
      'repository.protection': { state: 'enabled', receipt_id: 'd'.repeat(64) },
    },
  };
}

function runtime(status = a2Projection()) {
  const body = n5.renderManagedBlock('parent', parentState());
  return n5.createRuntime({
    repository,
    authority_broker: authority(),
    a2: {
      resolveRepositoryIdentity: () => ({ valid: true, repository_id: repositoryId, canonical_remote: 'https://github.com/weijunswj/ai-agent-toolkit.git' }),
      getRepositoryStatus: () => status,
    },
    github: {
      getParent: () => ({ body, complete: true, revision: 'r0' }),
      updateParent() { throw new Error('read-only compatibility test must not write'); },
    },
  });
}

test('N5 reads the A2 v2 projection and keeps governance consent separate from protection consent', () => {
  const result = runtime().inspect({ kind: 'parent', body: n5.renderManagedBlock('parent', parentState()) });
  assert.equal(result.code, 'N5_INSPECTION_READY');
});

test('N5 does not treat enabled repository protection as repository governance authority', () => {
  const result = runtime(a2Projection('unresolved')).reconcile({
    repository,
    parent_issue: 240,
    target: { child_id: 'child-1' },
    update: { type: 'set_field', field: 'owner_detail', value: 'must remain blocked' },
    accepted_preview: true,
  });
  assert.equal(result.code, 'N5_CONSENT_REQUIRED');
});
