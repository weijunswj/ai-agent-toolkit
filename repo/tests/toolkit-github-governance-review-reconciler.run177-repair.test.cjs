'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const repositoryId = '1'.repeat(64);
const candidate = { pr_number: 355, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) };

function parentState() {
  return {
    kind: 'parent', tracker_version: 'v3', repository, parent_issue: 240,
    current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 0, state: 'not_opened' } }],
    pending_work: [{ child_id: 'child-2', issue_number: 320, lifecycle: 'pending', queue_order: 1, objective: 'Truthful review inventory' }],
    other_open_prs: [], terminal: [], deferred_findings: [], owner_detail: 'Owner bytes remain outside the queue projection.',
  };
}

function body() {
  return `owner-before\n${n5.renderManagedBlock('parent', parentState())}\nowner-after\n`;
}

function enabledA2(canonical_remote = 'https://github.com/weijunswj/ai-agent-toolkit.git') {
  return {
    resolveRepositoryIdentity: () => ({ valid: true, repository_id: repositoryId, canonical_remote }),
    getRepositoryStatus: () => ({ status: 'healthy', actionable: false, repository_id: repositoryId, canonical_remote, capabilities: { 'repository.governance': { state: 'enabled' } } }),
  };
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

function reconcileInput() {
  return {
    repository,
    parent_issue: 240,
    target: { child_id: 'child-1' },
    update: { type: 'set_field', field: 'owner_detail', value: 'bounded repair' },
    accepted_preview: true,
  };
}

function reviewInput(overrides = {}) {
  return {
    server_authoritative: true,
    verifiable: true,
    pagination: { pull_requests: true, submitted_reviews: true, inline_conversations: true },
    pull_requests: [{ number: candidate.pr_number, state: 'open', merged: false, head: candidate.head, tree: candidate.tree, base: candidate.base, base_ref: 'main', public_source_ref: 'pr/355' }],
    submitted_reviews: [{ id: 'review-1', pr_number: candidate.pr_number, state: 'commented', public_source_ref: 'pr/355/review-1' }],
    inline_conversations: [{ id: 'thread-1', pr_number: candidate.pr_number, resolved: false, outdated: false, closing_reply: false, path: 'repo/scripts/example.cjs', line: 10, public_source_ref: 'pr/355#thread-1' }],
    current_candidate: candidate,
    require_current_candidate: true,
    expected_candidate: candidate,
    ...overrides,
  };
}

function findingInput() {
  return {
    id: 'finding-1',
    source_pr: candidate.pr_number,
    source_thread: 'thread-1',
    source_candidate: candidate,
    component: 'review-boundary',
    path: 'repo/scripts/example.cjs',
    line: 10,
    text: 'Public-safe current candidate review evidence.',
    predicates: Object.fromEntries(n5.A4_MATERIAL_PREDICATES.map((key) => [key, true])),
    exclusions: [],
  };
}

test('A1 rejects every non-exact returned digest binding without reading or writing GitHub', () => {
  for (const mutate of [
    (payload) => ({ ...payload, operation_digest: 'e'.repeat(64) }),
    (payload) => ({ ...payload, target_digest: 'f'.repeat(64) }),
    (payload) => ({ ...payload, operation_digest: payload.target_digest, target_digest: payload.operation_digest }),
    (payload) => ({ ...payload, operation_digest: undefined }),
  ]) {
    const github = githubAdapter(body());
    const result = n5.createRuntime({
      repository,
      a2: enabledA2(),
      authority_broker: { authorize: (payload) => ({ decision: 'allow', operation_type: payload.operation_type, ...mutate(payload) }) },
      github,
    }).reconcile(reconcileInput());
    assert.equal(result.code, 'N5_AUTHORITY_REQUIRED');
    assert.equal(github.values.reads, 0);
    assert.equal(github.values.writes, 0);
  }
});

test('A1 exact operation and target bindings are sent once and accepted', () => {
  const github = githubAdapter(body());
  let authorization;
  const result = n5.createRuntime({
    repository,
    a2: enabledA2(),
    authority_broker: { authorize: (payload) => { authorization = payload; return { decision: 'allow', operation_type: payload.operation_type, operation_digest: a1.operationDigest(payload.operation), target_digest: a1.targetDigest(payload.operation) }; } },
    github,
  }).reconcile(reconcileInput());
  assert.equal(result.code, 'N5_RECONCILED');
  assert.equal(authorization.operation_type, 'github.mutation');
  assert.match(authorization.operation_digest, /^[a-f0-9]{64}$/);
  assert.match(authorization.target_digest, /^[a-f0-9]{64}$/);
  assert.equal(github.values.writes, 1);
});

test('review inventory requires explicit authority, verifiability, and all pagination proofs', () => {
  for (const overrides of [
    { server_authoritative: undefined },
    { server_authoritative: false },
    { verifiable: undefined },
    { pagination: { pull_requests: true, submitted_reviews: false, inline_conversations: true } },
  ]) {
    const result = n5.buildReviewInventory(reviewInput(overrides));
    assert.equal(result.code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
    assert.notEqual(result.review.current, true);
    assert.notEqual(result.review.complete, true);
    assert.notEqual(result.review.verifiable, true);
  }
});

test('review inventory rejects missing, malformed, or mismatched required candidate identity', () => {
  for (const overrides of [
    { current_candidate: undefined },
    { current_candidate: { pr_number: 355, head: 'a'.repeat(40), tree: 'bad', base: 'c'.repeat(40) } },
    { expected_candidate: { ...candidate, head: 'e'.repeat(40) } },
  ]) {
    const result = n5.buildReviewInventory(reviewInput(overrides));
    assert.equal(result.code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
    assert.notEqual(result.review.current, true);
  }
});

test('successful inventory preserves rich source evidence and emits only the canonical A4 review projection', () => {
  const finding = n5.classifyFinding(findingInput());
  assert.equal(finding.ok, true);
  const result = n5.buildReviewInventory(reviewInput({ findings: [finding.finding] }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.review).sort(), ['complete', 'current', 'findings', 'inventory_digest', 'server_authoritative', 'verifiable']);
  assert.equal(result.review.current, true);
  assert.equal(result.review.complete, true);
  assert.equal(result.review.server_authoritative, true);
  assert.equal(result.review.verifiable, true);
  assert.match(result.review.inventory_digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'findings'), false);
  assert.equal(result.inventory.candidate.pr_number, candidate.pr_number);
  assert.equal(result.inventory.candidate.head, candidate.head);
  assert.equal(result.inventory.submitted_reviews[0].id, 'review-1');
  assert.equal(result.inventory.inline_conversations[0].public_source_ref, 'pr/355#thread-1');
  assert.deepEqual(result.inventory.finding_evidence[0].provenance.source_candidate, candidate);
  assert.equal(result.inventory.finding_evidence[0].provenance.source_pr, candidate.pr_number);
  assert.equal(result.review.findings[0].applies_to_current_candidate, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.review.findings[0], 'provenance'), false);
  assert.deepEqual(n5.projectA4Review(result.inventory), result.review);
});

test('finding provenance is source-bound rather than a G1/G2 gate label', () => {
  const result = n5.classifyFinding(findingInput());
  assert.equal(result.ok, true);
  assert.equal(typeof result.finding.provenance, 'object');
  assert.equal(result.finding.provenance.source_pr, candidate.pr_number);
  assert.equal(result.finding.provenance.source_thread, 'thread-1');
  assert.deepEqual(result.finding.provenance.source_candidate, candidate);
  assert.equal(Object.prototype.hasOwnProperty.call(result.finding, 'gate'), false);
  assert.notEqual(result.finding.provenance, 'G1');
  assert.notEqual(result.finding.provenance, 'G2');
});

test('Deferred Findings use typed dispositions and separate linked child evidence', () => {
  assert.deepEqual(n5.DF_DISPOSITIONS, [
    'DEFERRED_REVALIDATE', 'SATISFIED', 'SUPERSEDED', 'OBSOLETE', 'DISPOSED_NONMATERIAL',
    'PROMOTED_TO_EXISTING_CHILD', 'PROMOTED_TO_CHILD',
  ]);
  const finding = n5.classifyFinding({ ...findingInput(), predicates: {} }).finding;
  const registered = n5.registerDeferredFinding({ finding, parent: parentState(), triggers: n5.DF_TRIGGERS });
  assert.equal(registered.code, 'N5_DF_REGISTERED');
  assert.equal(registered.record.disposition, 'DEFERRED_REVALIDATE');
  assert.equal(registered.record.linked_child, null);
  assert.equal(n5.validateDeferredFindingRecord(registered.record).ok, true);

  const base = { ...registered.record };
  const disposed = n5.revalidateDeferredFinding({ record: base, material: false, disposition: 'DISPOSED_NONMATERIAL' });
  assert.equal(disposed.record.disposition, 'DISPOSED_NONMATERIAL');
  assert.equal(disposed.record.linked_child, null);
  assert.equal(n5.validateDeferredFindingRecord(disposed.record).ok, true);

  const existing = n5.revalidateDeferredFinding({ record: base, material: true, compatible_child: { issue_number: 77, direct: true, compatible: true, frozen: false, lifecycle: 'pending' } });
  assert.equal(existing.record.disposition, 'PROMOTED_TO_EXISTING_CHILD');
  assert.equal(existing.record.linked_child, 77);
  assert.doesNotMatch(existing.record.disposition, /:/);
  assert.equal(n5.validateDeferredFindingRecord(existing.record).ok, true);

  const frozen = n5.revalidateDeferredFinding({ record: base, material: true, compatible_child: { issue_number: 77, direct: true, compatible: true, frozen: true, lifecycle: 'current' } });
  assert.equal(frozen.code, 'N5_AUTHORITY_REQUIRED');

  const unowned = n5.revalidateDeferredFinding({ record: base, material: true });
  assert.equal(unowned.code, 'N5_AUTHORITY_REQUIRED');

  const newChild = n5.revalidateDeferredFinding({ record: base, material: true, authorised_new_sibling: { controller_authorised: true, issue_number: 88, direct: true, compatible: true } });
  assert.equal(newChild.record.disposition, 'PROMOTED_TO_CHILD');
  assert.equal(newChild.record.linked_child, 88);
  assert.equal(n5.validateDeferredFindingRecord(newChild.record).ok, true);
});
