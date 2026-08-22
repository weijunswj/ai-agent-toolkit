'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const repositoryId = '1'.repeat(64);
const candidate = { pr_number: 355, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) };

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function reviewEvidence(overrides = {}) {
  const evidence = {
    repository,
    pr_number: candidate.pr_number,
    current_candidate: candidate,
    expected_candidate: candidate,
    pagination: { pull_requests: true, submitted_reviews: true, inline_conversations: true },
    pagination_evidence: {
      pull_requests: { complete: true, pages: 1, cursor: null, count: 1 },
      submitted_reviews: { complete: true, pages: 1, cursor: null, count: 1 },
      inline_conversations: { complete: true, pages: 1, cursor: null, count: 1 },
    },
    authoritative_counts: { pull_requests: 1, submitted_reviews: 1, inline_conversations: 1 },
    pull_requests: [{
      number: candidate.pr_number,
      state: 'open',
      merged: false,
      head: candidate.head,
      tree: candidate.tree,
      base: candidate.base,
      public_source_ref: 'pull/355',
    }],
    submitted_reviews: [{ id: 'review-1', pr_number: candidate.pr_number, state: 'commented', public_source_ref: 'pull/355/review-1' }],
    inline_conversations: [{ id: 'thread-1', pr_number: candidate.pr_number, resolved: false, outdated: false, closing_reply: false, public_source_ref: 'pull/355#thread-1' }],
    finding_evidence: [],
    stale: false,
    unavailable: false,
    complete: true,
    server_authoritative: true,
    verifiable: true,
    ...overrides,
  };
  if (!hasOwn(overrides, 'authoritative_counts')) {
    evidence.authoritative_counts = {
      pull_requests: Array.isArray(evidence.pull_requests) ? evidence.pull_requests.length : 0,
      submitted_reviews: Array.isArray(evidence.submitted_reviews) ? evidence.submitted_reviews.length : 0,
      inline_conversations: Array.isArray(evidence.inline_conversations) ? evidence.inline_conversations.length : 0,
    };
  }
  if (!hasOwn(overrides, 'pagination_evidence')) {
    evidence.pagination_evidence = Object.fromEntries(Object.keys(evidence.pagination || {}).map((key) => [
      key,
      {
        complete: evidence.pagination[key],
        pages: 1,
        cursor: null,
        count: Array.isArray(evidence[key]) ? evidence[key].length : 0,
      },
    ]));
  }
  if (!hasOwn(overrides, 'evidence_digest')) evidence.evidence_digest = n5.reviewEvidenceDigest(evidence);
  return evidence;
}

function reviewInput(caller = {}, trusted = reviewEvidence()) {
  return {
    ...caller,
    evidence_adapter: {
      getReviewEvidence() {
        return trusted;
      },
    },
  };
}

function parentState(overrides = {}) {
  return {
    kind: 'parent',
    tracker_version: 'v3',
    repository,
    parent_issue: 240,
    current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 0, state: 'not_opened' } }],
    pending_work: [{ child_id: 'child-2', issue_number: 320, lifecycle: 'pending', queue_order: 1, objective: 'Truthful review inventory' }],
    other_open_prs: [],
    terminal: [],
    deferred_findings: [],
    owner_detail: 'Owner bytes remain outside the queue projection.',
    ...overrides,
  };
}

function terminalItem() {
  return {
    child_id: 'done',
    issue_number: 321,
    lifecycle: 'terminal',
    implementation_pr: { number: 355, state: 'merged' },
    objective_status: 'completed',
    outcome: 'Delivered safely',
    detail: 'x'.repeat(500),
  };
}

function terminalProof(item, overrides = {}) {
  const proof = {
    server_authoritative: true,
    verifiable: true,
    complete: true,
    child_id: item.child_id,
    child_issue: item.issue_number,
    disposition: 'accepted',
    outcome: item.outcome,
    parent_chronology_ref: 'issue/240#run-185',
    pr: { number: 355, state: 'merged', public_source_ref: 'pull/355' },
    accepted_commit: { sha: 'd'.repeat(40), public_source_ref: 'commit/dddddddd' },
    ...overrides,
  };
  if (!hasOwn(overrides, 'evidence_digest')) proof.evidence_digest = n5.durableEvidenceDigest(item, proof);
  return proof;
}

function terminalOptions(proof, counter = null) {
  return {
    evidence_adapter: {
      getTerminalEvidence() {
        if (counter) counter.reads += 1;
        return proof;
      },
    },
    durable_evidence: proof,
  };
}

function findingSource(material, overrides = {}) {
  return {
    id: 'finding-185',
    source_pr: candidate.pr_number,
    source_thread: 'thread-185',
    source_candidate: candidate,
    component: 'review-boundary',
    path: 'repo/scripts/example.cjs',
    line: 185,
    public_source_ref: 'pull/355#thread-185',
    text: material ? 'Fresh material current-candidate evidence.' : 'Fresh nonmaterial current-candidate evidence.',
    predicates: Object.fromEntries(n5.A4_MATERIAL_PREDICATES.map((key) => [key, material])),
    exclusions: [],
    ...overrides,
  };
}

function classifyFinding(material, overrides = {}) {
  const result = n5.classifyFinding(findingSource(material, overrides));
  assert.equal(result.ok, true);
  return result.finding;
}

function githubAdapter(initialBody) {
  let current = initialBody;
  let writes = 0;
  return {
    getParent() {
      return { body: current, complete: true, revision: 'r0' };
    },
    updateParent(payload) {
      writes += 1;
      current = payload.body;
    },
    get values() {
      return { current, writes };
    },
  };
}

function runtime(body, github) {
  return n5.createRuntime({
    repository,
    github,
    a2: {
      resolveRepositoryIdentity: () => ({ valid: true, repository_id: repositoryId, canonical_remote: 'https://github.com/weijunswj/ai-agent-toolkit.git' }),
      getRepositoryStatus: () => ({ status: 'healthy', actionable: false, repository_id: repositoryId, canonical_remote: 'https://github.com/weijunswj/ai-agent-toolkit.git', capabilities: { 'repository.governance': { state: 'enabled' } } }),
    },
    authority_broker: {
      authorize: ({ operation }) => ({ decision: 'allow', operation_type: operation.type, operation_digest: a1.operationDigest(operation), target_digest: a1.targetDigest(operation) }),
    },
  });
}

function initialiseInput(state = parentState()) {
  return {
    repository,
    parent_issue: 240,
    target: { kind: n5.MUTATION_TARGET_KINDS.managed_parent_block, mode: 'create' },
    update: { type: 'set_parent_state', state },
    accepted_preview: true,
  };
}

function legacyBody() {
  return 'legacy-prefix\n'
    + '## Queue authority\n'
    + '- Repository: ' + repository + '\n'
    + '- Parent issue: #240\n'
    + '- Legacy tracker version: ' + n5.LEGACY_V0_VERSION + '\n'
    + '## Current execution\n'
    + '- Child: child-1 | Issue: #299 | Objective: N5 governance | PR: none\n'
    + '## Active queue\n'
    + '- Child: child-2 | Issue: #320 | Objective: Truthful review inventory | PR: none\n'
    + '## Completed or disposed\n'
    + '- Child: child-3 | Issue: #321 | Objective: Completed repair | PR: #350 | PR state: merged | Objective status: disposed | Outcome: Disposed without delivery\n'
    + '## Completion gate\n'
    + '- Gate: strict\n'
    + '## Governance ownership\n'
    + '- Owner: controller\n'
    + '## Mandatory parent reconciliation\n'
    + '- Required: yes\n';
}

test('RUN-185 review inventory has one trusted adapter boundary and no caller fallback', () => {
  const callerEvidence = reviewEvidence();
  assert.equal(n5.buildReviewInventory(callerEvidence).code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
  assert.equal(n5.buildReviewInventory(reviewInput(callerEvidence, {
    ...callerEvidence,
    evidence_digest: '0'.repeat(64),
  })).code, 'N5_REVIEW_INVENTORY_INCOMPLETE');

  let reads = 0;
  const trusted = reviewEvidence();
  const result = n5.buildReviewInventory({
    ...trusted,
    evidence_adapter: { getReviewEvidence: () => { reads += 1; return trusted; } },
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 1);
  assert.equal(result.inventory.evidence_binding_digest, trusted.evidence_digest);
  assert.equal(result.inventory.inventory_digest, trusted.evidence_digest);
  assert.deepEqual(result.inventory.authoritative_counts, trusted.authoritative_counts);
});

test('RUN-185 caller review arrays counts pagination facts and digests are assertions only', () => {
  const trusted = reviewEvidence();
  const mismatches = [
    { pull_requests: [] },
    { submitted_reviews: [] },
    { inline_conversations: [] },
    { finding_evidence: [{ id: 'caller-only' }] },
    { authoritative_counts: { pull_requests: 0, submitted_reviews: 1, inline_conversations: 1 } },
    { pagination: { pull_requests: false, submitted_reviews: true, inline_conversations: true } },
    { pagination_evidence: { pull_requests: { complete: true, pages: 2, cursor: 'other', count: 1 }, submitted_reviews: trusted.pagination_evidence.submitted_reviews, inline_conversations: trusted.pagination_evidence.inline_conversations } },
    { evidence_digest: '0'.repeat(64) },
    { evidence_binding_digest: '0'.repeat(64) },
    { inventory_digest: '0'.repeat(64) },
    { candidate: { ...candidate, head: 'e'.repeat(40) } },
  ];
  for (const caller of mismatches) {
    const result = n5.buildReviewInventory(reviewInput(caller, trusted));
    assert.equal(result.code, 'N5_REVIEW_INVENTORY_INCOMPLETE', JSON.stringify(Object.keys(caller)));
  }
});

test('RUN-185 malformed stale incomplete and adapter-failed review evidence fail closed', () => {
  const trusted = reviewEvidence();
  const cases = [
    { complete: false },
    { stale: true },
    { unavailable: true },
    { server_authoritative: false },
    { verifiable: false },
    { pagination: { pull_requests: true, submitted_reviews: false, inline_conversations: true } },
    { authoritative_counts: undefined },
    { authoritative_counts: { pull_requests: 2, submitted_reviews: 1, inline_conversations: 1 } },
    { submitted_reviews: [{ id: 'bad', pr_number: 355 }] },
    { evidence_digest: '0'.repeat(64) },
    { current_candidate: undefined },
  ];
  for (const override of cases) {
    const result = n5.buildReviewInventory(reviewInput({}, reviewEvidence(override)));
    assert.equal(result.code, 'N5_REVIEW_INVENTORY_INCOMPLETE', JSON.stringify(override));
  }
  const thrown = n5.buildReviewInventory({
    ...trusted,
    evidence_adapter: { getReviewEvidence: () => { throw new Error('read failed'); } },
  });
  assert.equal(thrown.code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
});

test('RUN-185 terminal compaction requires trusted adapter proof and binds all identity fields', () => {
  const item = terminalItem();
  const state = parentState({ terminal: [item] });
  const proof = terminalProof(item);
  assert.equal(n5.compactTerminal(state, { durable_evidence: proof }).code, 'PARENT_BODY_LIMIT');

  const counter = { reads: 0 };
  const compacted = n5.compactTerminal(state, terminalOptions(proof, counter));
  assert.equal(compacted.ok, true);
  assert.equal(counter.reads, 1);
  assert.equal(compacted.state.terminal[0].durable_evidence_digest, proof.evidence_digest);

  const callerMismatch = { ...proof, child_id: 'other-child', evidence_digest: proof.evidence_digest };
  assert.equal(n5.compactTerminal(state, { ...terminalOptions(proof), durable_evidence: callerMismatch }).code, 'PARENT_BODY_LIMIT');
  assert.equal(n5.compactTerminal(state, { evidence_adapter: { getTerminalEvidence: () => ({ ...proof, pr: { ...proof.pr, state: 'open' }, evidence_digest: n5.durableEvidenceDigest(item, { ...proof, pr: { ...proof.pr, state: 'open' } }) }) } }).code, 'PARENT_BODY_LIMIT');
  assert.equal(n5.compactTerminal(state, { evidence_adapter: { getTerminalEvidence: () => ({ ...proof, evidence_digest: '0'.repeat(64) }) } }).code, 'PARENT_BODY_LIMIT');
});

test('RUN-185 Deferred-Finding revalidation uses fresh A4 evidence and preserves promotion authority', () => {
  const initial = classifyFinding(false);
  const registered = n5.registerDeferredFinding({ finding: initial, parent: parentState(), triggers: n5.DF_TRIGGERS });
  assert.equal(registered.code, 'N5_DF_REGISTERED');
  const record = registered.record;

  assert.equal(n5.revalidateDeferredFinding({ record, material: false }).code, 'N5_DF_AMBIGUOUS');
  assert.equal(n5.revalidateDeferredFinding({ record, fresh_finding: classifyFinding(true), material: false }).code, 'N5_DF_AMBIGUOUS');
  assert.equal(n5.revalidateDeferredFinding({ record, fresh_finding: classifyFinding(false), material: true }).code, 'N5_DF_AMBIGUOUS');

  const freshNonmaterial = classifyFinding(false, { text: 'Fresh nonmaterial evidence changed at revalidation.' });
  const disposed = n5.revalidateDeferredFinding({ record, fresh_finding: freshNonmaterial, material: false });
  assert.equal(disposed.ok, true);
  assert.equal(disposed.record.disposition, 'DISPOSED_NONMATERIAL');
  assert.equal(disposed.record.evidence_digest, freshNonmaterial.evidence_digest);
  assert.equal(n5.validateDeferredFindingRecord(disposed.record).ok, true);

  const freshMaterial = classifyFinding(true);
  const promoted = n5.revalidateDeferredFinding({
    record,
    fresh_finding: freshMaterial,
    material: true,
    compatible_child: { issue_number: 77, direct: true, compatible: true, frozen: false, lifecycle: 'pending' },
  });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.record.materiality, 'material');
  assert.equal(promoted.record.disposition, 'PROMOTED_TO_EXISTING_CHILD');
  assert.equal(n5.revalidateDeferredFinding({ record, fresh_finding: freshMaterial, material: true, disposition: 'DISPOSED_NONMATERIAL' }).code, 'N5_AUTHORITY_REQUIRED');

  const stale = classifyFinding(false, { source_candidate: { ...candidate, head: 'e'.repeat(40) } });
  assert.equal(n5.revalidateDeferredFinding({ record, fresh_finding: stale, material: false }).code, 'N5_DF_AMBIGUOUS');
  assert.equal(n5.revalidateDeferredFinding({ record, fresh_finding: { ...freshNonmaterial, evidence_digest: '0'.repeat(64) }, material: false }).code, 'N5_DF_AMBIGUOUS');
  assert.equal(n5.revalidateDeferredFinding({ record, fresh_finding: { ...freshNonmaterial, root_digest: '0'.repeat(64) }, material: false }).code, 'N5_DF_AMBIGUOUS');
});

test('RUN-185 residue detection rejects normalized legacy variants without blocking unrelated prose', () => {
  const desired = parentState();
  const exact = legacyBody();
  assert.equal(n5.parseLegacyParent(exact, { complete: true }).ok, true);
  const exactGithub = githubAdapter(exact);
  const exactResult = runtime(exact, exactGithub).initialise(initialiseInput(desired));
  assert.equal(exactResult.code, 'N5_SCOPE_REJECTED');
  assert.equal(exactGithub.values.writes, 0);

  const variant = exact
    .replace('## Queue authority', '##   qUeUe   authority')
    .replace('## Current execution', '## CURRENT\u00a0\u00a0execution')
    .replace('## Active queue', '## active   QUEUE');
  assert.equal(n5.parseLegacyParent(variant, { complete: true }).ok, false);
  const variantGithub = githubAdapter(variant);
  const variantResult = runtime(variant, variantGithub).initialise(initialiseInput(desired));
  assert.equal(variantResult.ok, false);
  assert.equal(variantGithub.values.writes, 0);


  const prose = 'Owner notes: queue authority and execution queue are discussed here, but this is not a tracker.\n';
  const proseGithub = githubAdapter(prose);
  const proseResult = runtime(prose, proseGithub).initialise(initialiseInput(desired));
  assert.equal(proseResult.code, 'N5_RECONCILED');
  assert.equal(proseGithub.values.writes, 1);
  assert.equal(proseGithub.values.current.split(n5.MANAGED_MARKERS.parent.begin).length - 1, 1);
  assert.equal(proseGithub.values.current.split(n5.MANAGED_MARKERS.parent.end).length - 1, 1);
});
