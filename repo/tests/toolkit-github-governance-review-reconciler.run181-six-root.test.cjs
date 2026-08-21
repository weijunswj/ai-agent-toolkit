'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const repositoryId = '1'.repeat(64);
const candidate = { pr_number: 355, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) };

function parentState(overrides = {}) {
  return {
    kind: 'parent', tracker_version: 'v3', repository, parent_issue: 240,
    current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 0, state: 'not_opened' } }],
    pending_work: [{ child_id: 'child-2', issue_number: 320, lifecycle: 'pending', queue_order: 1, objective: 'Truthful review inventory' }],
    other_open_prs: [], terminal: [], deferred_findings: [], owner_detail: 'Owner bytes remain outside the queue projection.',
    ...overrides,
  };
}

function body(state = parentState(), prefix = 'outside-prefix\n', suffix = '\noutside-suffix\n') {
  return prefix + n5.renderManagedBlock('parent', state) + suffix;
}

function enabledA2(repository_id = repositoryId, extra = {}) {
  return { status: () => ({ repository_id, capabilities: { 'repository.governance': { state: 'enabled' } }, ...extra }) };
}

function authority() {
  return { authorize: ({ operation }) => ({ decision: 'allow', operation_type: operation.type, operation_digest: a1.operationDigest(operation), target_digest: a1.targetDigest(operation) }) };
}

function adapter(initialBody, options = {}) {
  let current = initialBody;
  let reads = 0;
  let writes = 0;
  let callbackUsed = false;
  const sequence = options.sequence || [];
  const github = {
    getParent() {
      if (options.beforeRead && !callbackUsed) { callbackUsed = true; options.beforeRead(); }
      if (options.readError) throw new Error('read uncertainty');
      const value = sequence[reads] || { body: current, complete: true, revision: `r${reads}` };
      reads += 1;
      return value;
    },
    updateParent(payload) {
      writes += 1;
      if (options.updateError) throw new Error('write uncertainty');
      current = payload.body;
      return { accepted: true };
    },
    get values() { return { current, reads, writes }; },
  };
  if (options.noUpdate) delete github.updateParent;
  if (options.reconcileRelated !== undefined) github.reconcileRelated = options.reconcileRelated;
  return github;
}

function runtime(initialBody, options = {}) {
  return n5.createRuntime({
    repository,
    authority_broker: options.authority_broker || authority(),
    a2: options.a2 || enabledA2(),
    github: options.github || adapter(initialBody),
    transaction_owner: options.transaction_owner,
    ...(Object.prototype.hasOwnProperty.call(options, 'repository_id') ? { repository_id: options.repository_id } : {}),
  });
}

function reconcileInput(overrides = {}) {
  return { repository, parent_issue: 240, target: { child_id: 'child-1' }, update: { type: 'set_field', field: 'owner_detail', value: 'Run-181 bounded repair' }, accepted_preview: true, ...overrides };
}

function managedTarget(sourceBody) {
  const parsed = n5.parseManagedBlock(sourceBody, 'parent', { complete: true });
  assert.equal(parsed.ok, true);
  return { kind: n5.MUTATION_TARGET_KINDS.managed_parent_block, body_digest: parsed.body_digest, managed_digest: parsed.managed_digest };
}

function legacyBody(version = n5.LEGACY_V0_VERSION, extra = '') {
  return `legacy-prefix\n## Queue authority\n- Repository: ${repository}\n- Parent issue: #240\n- Legacy tracker version: ${version}\n## Current execution\n- Child: child-1 | Issue: #299 | Objective: N5 governance | PR: none\n## Active queue\n- Child: child-2 | Issue: #320 | Objective: Truthful review inventory | PR: none\n## Completed or disposed\n- Child: child-3 | Issue: #321 | Objective: Completed repair | PR: #350 | PR state: merged | Objective status: completed | Outcome: Delivered safely\n## Completion gate\n- Gate: strict\n## Governance ownership\n- Owner: controller\n## Mandatory parent reconciliation\n- Required: yes\n${extra}`;
}

function reviewInput(overrides = {}) {
  return {
    server_authoritative: true,
    verifiable: true,
    pagination: { pull_requests: true, submitted_reviews: true, inline_conversations: true },
    pull_requests: [{ number: candidate.pr_number, state: 'open', merged: false, head: candidate.head, tree: candidate.tree, base: candidate.base, public_source_ref: 'pr/355' }],
    submitted_reviews: [{ id: 'review-1', pr_number: candidate.pr_number, state: 'commented' }],
    inline_conversations: [{ id: 'thread-1', pr_number: candidate.pr_number, resolved: false, outdated: false, closing_reply: false }],
    current_candidate: candidate,
    expected_candidate: candidate,
    ...overrides,
  };
}

test('B1 binds A2 repository_id before A1 or GitHub and rejects overrides', () => {
  for (const [a2, code] of [
    [{ status: () => ({ capabilities: { 'repository.governance': { state: 'enabled' } } }) }, 'N5_CONSENT_REQUIRED'],
    [enabledA2('malformed'), 'N5_CONSENT_REQUIRED'],
    [enabledA2(repositoryId, { repository: 'other/repo' }), 'N5_REPOSITORY_IDENTITY_MISMATCH'],
  ]) {
    let brokerCalls = 0;
    const github = adapter(body());
    const result = runtime(github.values.current, { a2, authority_broker: { authorize() { brokerCalls += 1; return authority().authorize(...arguments); } }, github }).reconcile(reconcileInput());
    assert.equal(result.code, code);
    assert.equal(brokerCalls, 0);
    assert.equal(github.values.reads, 0);
  }
  const configuredMismatch = runtime(body(), { repository_id: '2'.repeat(64) }).reconcile(reconcileInput());
  assert.equal(configuredMismatch.code, 'N5_REPOSITORY_IDENTITY_MISMATCH');
  const override = runtime(body()).reconcile(reconcileInput({ repository_id: repositoryId }));
  assert.equal(override.code, 'N5_AUTHORITY_REQUIRED');
});

test('B2 enforces one flat queue, lifecycle renumbering, terminal objective status, and global PR uniqueness', () => {
  const moved = n5.applyBoundedUpdate(parentState(), { child_id: 'child-1' }, { type: 'set_lifecycle', lifecycle: 'pending' });
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.state.pending_work.map((item) => item.queue_order), [1, 2]);
  assert.equal(moved.state.current_work.length, 0);
  assert.equal(n5.validateTracker(parentState({ other_open_prs: [{ pr_number: 355, state: 'open' }], current_work: [{ child_id: 'child-1', issue_number: 299, lifecycle: 'current', objective: 'N5 governance', implementation_pr: { number: 355, state: 'open' } }] })).code, 'N5_GOVERNANCE_UNREADY');
  const missingStatus = parentState({ terminal: [{ child_id: 'done', issue_number: 321, lifecycle: 'terminal', outcome: 'done' }] });
  assert.equal(n5.validateTracker(missingStatus).code, 'N5_GOVERNANCE_UNREADY');
  const failedCompletion = parentState({ terminal: [{ child_id: 'done', issue_number: 321, lifecycle: 'terminal', implementation_pr: { number: 355, state: 'closed_unmerged' }, objective_status: 'completed', outcome: 'not delivered' }] });
  assert.equal(n5.validateTracker(failedCompletion).code, 'N5_GOVERNANCE_UNREADY');
  const disposed = parentState({ terminal: [{ child_id: 'disposed', issue_number: 321, lifecycle: 'terminal', implementation_pr: { number: 355, state: 'closed_unmerged' }, objective_status: 'disposed', outcome: 'not delivered' }] });
  assert.equal(n5.validateTracker(disposed).ok, true);
});

test('B3 requires explicit current/expected candidates and canonical public review evidence', () => {
  assert.equal(n5.buildReviewInventory({ ...reviewInput(), expected_candidate: undefined }).code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
  assert.equal(n5.buildReviewInventory({ ...reviewInput(), pull_requests: [{ number: candidate.pr_number, state: 'open', head: candidate.head, tree: candidate.tree, base: candidate.base }] }).code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
  assert.equal(n5.buildReviewInventory({ ...reviewInput(), inline_conversations: [{ id: 'thread-1', pr_number: candidate.pr_number, resolved: false, outdated: false }] }).code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
  assert.equal(n5.buildReviewInventory({ ...reviewInput(), pull_requests: [{ ...reviewInput().pull_requests[0], tree: 'd'.repeat(40) }] }).code, 'N5_REVIEW_INVENTORY_INCOMPLETE');
  const findingInput = { id: 'finding-181', source_pr: candidate.pr_number, source_thread: 'thread-1', source_candidate: candidate, component: 'review-boundary', path: 'repo/scripts/example.cjs', line: 10, text: 'Public-safe current candidate evidence.', predicates: {} };
  const finding = n5.classifyFinding(findingInput);
  assert.equal(finding.ok, true);
  assert.match(finding.finding.evidence_digest, /^[a-f0-9]{64}$/);
  assert.equal(n5.classifyFinding({ ...findingInput, evidence_digest: '0'.repeat(64) }).ok, false);
  const inventory = n5.buildReviewInventory(reviewInput({ findings: [finding.finding] }));
  assert.equal(inventory.ok, true);
  assert.equal(inventory.inventory.finding_evidence[0].evidence_digest, finding.finding.evidence_digest);
  assert.notEqual(inventory.inventory.candidate, null);
  assert.deepEqual(inventory.inventory.expected_candidate, candidate);
});

test('B4 uses one shared module/process owner registry and releases every terminal path', () => {
  const source = body();
  const owners = new Map();
  let nested;
  let second;
  const github = adapter(source, { beforeRead: () => { nested = second.remove({ repository, parent_issue: 240, target: managedTarget(source), update: {}, accepted_preview: true }); } });
  const first = runtime(source, { github, transaction_owner: owners });
  second = runtime(source, { github: adapter(source), transaction_owner: owners });
  const result = first.remove({ repository, parent_issue: 240, target: managedTarget(source), update: {}, accepted_preview: true });
  assert.equal(nested.code, 'PARENT_CONCURRENCY_CONFLICT');
  assert.equal(result.code, 'N5_REMOVED');
  assert.equal(owners.size, 0);
  const failing = runtime(source, { github: adapter(source, { readError: true }), transaction_owner: owners }).remove({ repository, parent_issue: 240, target: managedTarget(source), update: {}, accepted_preview: true });
  assert.equal(failing.code, 'PARENT_BODY_INCOMPLETE');
  assert.equal(owners.size, 0);
});

test('B5 refuses terminal truncation without proof and retains identity, refs, digest, and owner bytes with proof', () => {
  const terminal = { child_id: 'done', issue_number: 321, lifecycle: 'terminal', implementation_pr: { number: 355, state: 'merged' }, objective_status: 'completed', outcome: 'delivered', detail: 'x'.repeat(500) };
  const state = parentState({ terminal: [terminal] });
  assert.equal(n5.compactTerminal(state).code, 'PARENT_BODY_LIMIT');
  const proof = { server_authoritative: true, verifiable: true, complete: true, child_issue: 321, disposition: 'completed', outcome: 'delivered', parent_chronology_ref: 'issue/240#run-181', pr: { number: 355, public_source_ref: 'pull/355' }, accepted_commit: { sha: '6ae424689d4af042737c403f3a1dc030fbeb0cc3', public_source_ref: 'commit/6ae4246' }, evidence_digest: null };
  proof.evidence_digest = n5.durableEvidenceDigest(terminal, proof);
  const compacted = n5.compactTerminal(state, { durable_evidence: proof });
  assert.equal(compacted.ok, true);
  const compactedItem = compacted.state.terminal[0];
  assert.equal(compactedItem.child_id, terminal.child_id);
  assert.equal(compactedItem.issue_number, terminal.issue_number);
  assert.deepEqual(compactedItem.implementation_pr, terminal.implementation_pr);
  assert.equal(compactedItem.durable_evidence_digest, proof.evidence_digest);
  assert.equal(compacted.state.owner_detail, state.owner_detail);
  assert.equal(n5.compactTerminal(state, { durable_evidence: { ...proof, evidence_digest: '0'.repeat(64) } }).code, 'PARENT_BODY_LIMIT');
});

test('B6 initialise creates only from unmanaged bytes and migrate accepts only exact recognised legacy/v3 targets', () => {
  const initialState = parentState();
  const plain = 'owner-before\n';
  const initialGithub = adapter(plain);
  const initial = runtime(plain, { github: initialGithub }).initialise({ repository, parent_issue: 240, target: { kind: n5.MUTATION_TARGET_KINDS.managed_parent_block, mode: 'create' }, update: { type: 'set_parent_state', state: initialState }, accepted_preview: true });
  assert.equal(initial.code, 'N5_RECONCILED');
  assert.equal(initialGithub.values.writes, 1);
  assert.match(initialGithub.values.current, /AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v3/);
  assert.match(initialGithub.values.current, /^owner-before\n/);

  const legacy = legacyBody();
  const parsedLegacy = n5.parseLegacyParent(legacy, { complete: true });
  assert.equal(parsedLegacy.ok, true);
  const legacyGithub = adapter(legacy);
  const migrated = runtime(legacy, { github: legacyGithub }).migrate({ repository, parent_issue: 240, target: { kind: n5.MUTATION_TARGET_KINDS.legacy_parent_block, source_version: n5.LEGACY_V0_VERSION, source_body_digest: n5.sha256(legacy) }, update: { type: 'set_parent_state', state: parsedLegacy.state }, accepted_preview: true });
  assert.equal(migrated.code, 'N5_RECONCILED');
  assert.equal(legacyGithub.values.writes, 1);
  assert.match(legacyGithub.values.current, /AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v3/);
  assert.match(legacyGithub.values.current, /^legacy-prefix\n/);

  for (const source of [legacyBody('v1'), legacyBody(n5.LEGACY_V0_VERSION, '## Extra\n')]) {
    const github = adapter(source);
    const result = runtime(source, { github }).migrate({ repository, parent_issue: 240, target: { kind: n5.MUTATION_TARGET_KINDS.legacy_parent_block, source_version: n5.LEGACY_V0_VERSION, source_body_digest: n5.sha256(source) }, update: { type: 'set_parent_state', state: parsedLegacy.state }, accepted_preview: true });
    assert.ok(['N5_TRACKER_VERSION_UNSUPPORTED', 'PARENT_PARSE_UNCERTAIN'].includes(result.code));
    assert.equal(github.values.writes, 0);
  }
  const residue = `${n5.MANAGED_MARKERS.child.begin}\nresidue\n${n5.MANAGED_MARKERS.child.end}\n`;
  const residueGithub = adapter(residue);
  const residueResult = runtime(residue, { github: residueGithub }).initialise({ repository, parent_issue: 240, target: { kind: n5.MUTATION_TARGET_KINDS.managed_parent_block, mode: 'create' }, update: { type: 'set_parent_state', state: initialState }, accepted_preview: true });
  assert.equal(residueResult.code, 'PARENT_PARSE_UNCERTAIN');
  assert.equal(residueGithub.values.writes, 0);
});

test('Run-181 source contracts declare all six roots and recognised migration versions', () => {
  const project = path.resolve(__dirname, '../../_projects/development/github-governance-review-reconciler');
  const schema = JSON.parse(fs.readFileSync(path.join(project, '_main', 'github-governance-review-reconciler-contract.schema.json'), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.join(project, '_main', 'github-governance-review-reconciler-policy.json'), 'utf8'));
  const grammar = JSON.parse(fs.readFileSync(path.join(project, '_main', 'tracker-v3-grammar.json'), 'utf8'));
  assert.deepEqual(Object.keys(n5.authorityBoundary().six_root_contract_integrity), ['b1_repository_identity', 'b2_lifecycle_and_pr_uniqueness', 'b3_review_inventory_evidence', 'b4_shared_transaction_registry', 'b5_proof_gated_compaction', 'b6_initialise_and_migrate']);
  assert.equal(schema.required.includes('six_root_contract_integrity'), true);
  assert.deepEqual(policy.six_root_contract_integrity, { b1_repository_identity: true, b2_lifecycle_and_pr_uniqueness: true, b3_review_inventory_evidence: true, b4_shared_transaction_registry: true, b5_proof_gated_compaction: true, b6_initialise_and_migrate: true });
  assert.deepEqual(grammar.legacy_migration.recognised_versions, ['v3', n5.LEGACY_V0_VERSION]);
});
