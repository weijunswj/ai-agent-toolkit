'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.join(repoRoot, '_projects', 'development', 'repo-auto-code');
const mainRoot = path.join(projectRoot, '_main');
const fixtureRoot = path.join(mainRoot, 'fixtures');
const templateRoot = path.join(mainRoot, 'templates');
const fixturePrefix = '_projects/development/repo-auto-code/_main/fixtures';
const mergeCommit = '5556923fade39ad29afd2da8fcd0784fb6c1709f';
const mergeTree = '23cf3c44ca858013195c7894be6ccc804c18a224';
const sourceLockBlob = '6d79d0c7fd12f2212ae7925befc8955398a3bde8';

const addedFixtures = [
  'valid-explicit-closure-lease-activation.json',
  'valid-authorised-repository-file-mutation.json',
  'valid-consolidated-amend-fresh-g4.json',
  'valid-g4-pass-return-to-web.json',
  'valid-evaluation-candidate.json',
  'valid-interrupted-session-recovery.json',
  'valid-one-pilot-containment.json',
  'valid-separate-merge-install-pilot-grants.json',
  'valid-web-assurance-clear.json',
  'valid-runtime-resolved-neutral-route.json',
  'invalid-closure-lease-not-activated.json',
  'invalid-context-only-activation.json',
  'invalid-installation-implies-activation.json',
  'invalid-cross-repository-fanout.json',
  'invalid-unrelated-child-selection.json',
  'invalid-cross-pr-mutation.json',
  'invalid-duplicate-roots.json',
  'invalid-expiry-takeover.json',
  'invalid-root-replacement-without-grant.json',
  'invalid-implementation-worker-governance-mutation.json',
  'invalid-helper-governance-mutation.json',
  'invalid-root-governance-finality-mutation.json',
  'invalid-manager-g4-override.json',
  'invalid-suppressed-g4-finding.json',
  'invalid-g4-finding-conflict-continuation.json',
  'invalid-g4-not-isolated.json',
  'invalid-fresh-g4-skipped-after-amendment.json',
  'invalid-nonconvergence-same-root-cause.json',
  'invalid-nonconvergence-third-amend.json',
  'invalid-model-limit-continuation.json',
  'invalid-unsupported-delegation-continuation.json',
  'invalid-authority-movement-continuation.json',
  'invalid-evaluation-candidate-private-identifiers.json',
  'invalid-duplicate-evaluation-candidate.json',
  'invalid-evaluation-candidate-revision-mismatch.json',
  'invalid-executor-grades-candidate.json',
  'invalid-direct-ledger-write.json',
  'invalid-auto-review-mutation.json',
  'invalid-scheduled-task-creation.json',
  'invalid-retired-relay-residue.json',
  'invalid-second-pilot-activation.json',
  'invalid-unproven-cleanup-claim.json',
  'invalid-scope-ambiguity-continuation.json',
  'invalid-design-lock-ambiguity-continuation.json',
  'invalid-user-decision-required-continuation.json',
  'invalid-web-assurance-concern-merge.json',
  'invalid-web-assurance-as-authoritative-g4.json',
  'invalid-automatic-next-task-activation.json',
  'invalid-hardcoded-provider-model-or-harness.json',
  'invalid-missing-reference-reasoning-equivalent.json',
  'invalid-unverified-harness-capability-substitution.json',
  'invalid-harness-specific-authority-expansion.json'
].sort();

const modifiedFixtures = [
  'invalid-body-comment-disagreement.json',
  'invalid-caller-supplied-lease-fields.json',
  'invalid-duplicate-claims.json',
  'invalid-generic-consent-only.json',
  'invalid-malformed-agents-block.json',
  'invalid-missing-provider-routing.json',
  'invalid-missing-skill.json',
  'invalid-missing-valid-open-reviews.json',
  'invalid-non-atomic-claim.json',
  'invalid-ordinary-executor-self-setup.json',
  'invalid-progression-during-parent-reconciliation.json',
  'invalid-stale-g4.json',
  'invalid-substantive-execution-during-reconciliation.json',
  'valid-active-to-current.json',
  'valid-completion-finality.json',
  'valid-current-to-completed.json',
  'valid-final-audit-after-terminal-work.json',
  'valid-four-surface-reconciliation.json',
  'valid-governance-readiness.json'
].sort();

const deletedFixtures = [
  'invalid-active-or-duplicate-scheduler.json',
  'invalid-ambiguous-scheduler.json',
  'invalid-cross-repository-scheduler-receipt.json',
  'invalid-crossed-handoff-markers.json',
  'invalid-disabled-scheduler.json',
  'invalid-duplicate-ote-eto-markers.json',
  'invalid-duplicate-packets.json',
  'invalid-duplicate-scheduler.json',
  'invalid-final-live-prompt.json',
  'invalid-incomplete-teardown.json',
  'invalid-live-prompt-after-completion.json',
  'invalid-missing-handoff-marker.json',
  'invalid-nested-handoff-markers.json',
  'invalid-out-of-order-handoff-markers.json',
  'invalid-partial-publication.json',
  'invalid-paused-scheduler.json',
  'invalid-unverifiable-missing-scheduler.json',
  'valid-blocked-first-skip.json',
  'valid-exact-dual-scheduler-removal.json',
  'valid-existing-pr-adoption.json',
  'valid-first-eligible-pickup.json',
  'valid-first-run.json',
  'valid-parallel-prs.json',
  'valid-processed-prompt.json',
  'valid-same-pr-fast-forward.json'
].sort();

const acceptedDeletedFixtures = deletedFixtures.filter((name) => name.startsWith('valid-'));
const rejectedDeletedFixtures = deletedFixtures.filter((name) => name.startsWith('invalid-'));

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function namesAt(ref) {
  const output = git('ls-tree', '-r', '--name-only', ref, '--', fixturePrefix);
  return output.split(/\r?\n/).filter(Boolean).map((entry) => path.basename(entry)).sort();
}

function currentFixtureNames() {
  return fs.readdirSync(fixtureRoot).filter((name) => name.endsWith('.json')).sort();
}

function readJson(name) {
  const fullPath = path.join(fixtureRoot, name);
  const fixture = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  assert.equal(fixture.id, name.replace(/\.json$/, ''), name + ' id must match its filename');
  return fixture;
}

function classification(fixture) {
  const accepted = typeof fixture.accepted === 'boolean'
    ? fixture.accepted
    : fixture.expected && typeof fixture.expected.accepted === 'boolean'
      ? fixture.expected.accepted
      : null;
  assert.equal(typeof accepted, 'boolean', fixture.id + ' needs an accepted classification');
  const mutationProhibited = typeof fixture.mutationProhibited === 'boolean'
    ? fixture.mutationProhibited
    : fixture.expected && fixture.expected.mutationProhibited;
  if (!accepted) {
    assert.equal(mutationProhibited, true, fixture.id + ' rejection must prohibit mutation');
  }
  return accepted;
}

function allEqual(values) {
  return values.length > 0 && values.every((value) => value === values[0]);
}

function deriveDecision(fixture) {
  if (fixture.evidence) {
    assert.equal(fixture.evidence.rawEvidence, true, fixture.id + ' must use raw evidence');
    if (fixture.evidence.valid === false) return false;
    assert.equal(fixture.evidence.valid, true, fixture.id + ' accepted evidence must be valid');
    const proof = fixture.evidence.proof || fixture.evidence;
    assert.ok(proof && typeof proof === 'object', fixture.id + ' needs evidence proof');

    if (fixture.scenario === 'runtime-neutral-route') {
      for (const key of [
        'provider',
        'canonicalBaseModel',
        'reasoningOrEffort',
        'referenceFamilyReasoningEquivalent',
        'solEquivalentReasoning',
        'harnessAdapter',
        'surface',
        'role',
        'exactAuthority'
      ]) {
        assert.equal(typeof proof[key], 'string', fixture.id + ' route field ' + key);
      }
      assert.equal(proof.fastMode, 'prohibited');
      assert.equal(proof.substitution, 'prohibited');
    }
    if (fixture.scenario === 'assurance-clear') {
      assert.equal(proof.g4Verdict, 'PASS');
      assert.equal(proof.webAdjudicated, true);
      assert.equal(proof.assuranceVerdict, 'CLEAR');
      assert.equal(proof.authoritativeG4Count, 1);
    }
    return true;
  }

  const state = fixture.state || {};
  if (fixture.scenario === 'owner_authorised_final_audit_change') {
    const queue = Array.isArray(state.parent && state.parent.activeQueue)
      ? state.parent.activeQueue
      : [];
    return state.selectedChild === '#251' &&
      state.moved === false &&
      state.reordered === false &&
      state.bypassedBlocked === false &&
      state.declarationChange &&
      state.declarationChange.requested === true &&
      state.declarationChange.authorized === true &&
      queue.some((entry) => entry.finalAudit === true && entry.terminal === false);
  }

  const reconciliation = state.reconciliation;
  if (!reconciliation) return false;
  const binding = reconciliation.binding || {};
  const surfaces = reconciliation.surfaces || {};
  const surfaceStatuses = Object.values(surfaces)
    .map((surface) => surface && (surface.status || surface.bodyDigest || surface.body))
    .filter((value) => value !== undefined);
  const preservation = reconciliation.preservation || {};
  return reconciliation.surfacesAgree === true &&
    reconciliation.readBackExact === true &&
    binding.parentEntryCount === 1 &&
    binding.partialWrite === false &&
    binding.concurrentBeforeWrite === false &&
    binding.concurrentAfterWrite === false &&
    allEqual(surfaceStatuses) &&
    JSON.stringify(preservation.before || null) === JSON.stringify(preservation.after || null);
}

function findFixtureBaseline() {
  const candidateRefs = git('rev-list', '--first-parent', '--merges', '--max-count=10', 'HEAD')
    .split(/\r?\n/).filter(Boolean);
  for (const ref of candidateRefs) {
    if (namesAt(ref).length === 85) return ref;
  }
  return null;
}

function baselineFixtureNames() {
  const baseline = findFixtureBaseline();
  if (baseline) {
    assert.equal(baseline, mergeCommit);
    assert.equal(git('rev-parse', baseline + '^{tree}'), mergeTree);
    return namesAt(baseline);
  }

  // Hosted PR validation intentionally uses a depth-one checkout. In that
  // mode the explicit A3 add/delete allowlist is the complete baseline
  // reconciliation evidence; no fixture or authority verdict is inferred.
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'true');
  return currentFixtureNames()
    .filter((name) => !addedFixtures.includes(name))
    .concat(deletedFixtures)
    .sort();
}

function activeSourceFiles() {
  const files = [
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'SOURCE-MANIFEST.md'),
    path.join(projectRoot, 'toolkit.project.json'),
    path.join(mainRoot, 'architecture.md'),
    path.join(mainRoot, 'failure-matrix.md'),
    path.join(mainRoot, 'protocol.md'),
    path.join(mainRoot, 'state-machine.md'),
    path.join(templateRoot, 'AGENTS.auto-code.managed.md'),
    path.join(repoRoot, 'repo', 'tests', 'repo-auto-code-design.test.cjs')
  ];
  for (const name of fs.readdirSync(templateRoot)) files.push(path.join(templateRoot, name));
  for (const name of currentFixtureNames()) files.push(path.join(fixtureRoot, name));
  return files;
}

test('filesystem discovery reconciles the exact A3 fixture arithmetic', () => {
  const existing = baselineFixtureNames();
  const current = currentFixtureNames();
  const existingSet = new Set(existing);
  const currentSet = new Set(current);
  const added = current.filter((name) => !existingSet.has(name)).sort();
  const deleted = existing.filter((name) => !currentSet.has(name)).sort();
  const retained = current.filter((name) => existingSet.has(name)).sort();

  assert.equal(existing.length, 85);
  assert.equal(added.length, 52);
  assert.deepEqual(added, addedFixtures);
  assert.equal(deleted.length, 25);
  assert.equal(retained.length, 60);
  assert.equal(current.length, 112);
  assert.equal(new Set(current).size, current.length);

  assert.deepEqual(deleted, deletedFixtures);
  assert.equal(acceptedDeletedFixtures.length, 8);
  assert.equal(rejectedDeletedFixtures.length, 17);

  const fixtures = current.map(readJson);
  const ids = fixtures.map((fixture) => fixture.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const fixture of fixtures) {
    const expected = classification(fixture);
    const derived = deriveDecision(fixture);
    assert.equal(derived, expected, fixture.id + ' decision must derive from raw evidence');
  }

  const accepted = fixtures.filter((fixture) => classification(fixture)).length;
  const rejected = fixtures.length - accepted;
  const retainedAccepted = fixtures
    .filter((fixture) => retained.includes(fixture.id + '.json') && classification(fixture)).length;
  const retainedRejected = retained.length - retainedAccepted;
  assert.equal(retainedAccepted + acceptedDeletedFixtures.length, 15);
  assert.equal(retainedRejected + rejectedDeletedFixtures.length, 70);
  assert.equal(accepted, 17);
  assert.equal(rejected, 95);
  assert.equal(15 - 8 + 10, accepted);
  assert.equal(70 - 17 + 42, rejected);

  for (const name of addedFixtures.concat(modifiedFixtures)) {
    const fixture = readJson(name);
    assert.equal(typeof fixture.accepted, 'boolean', name + ' needs top-level accepted');
    assert.equal(fixture.evidence.rawEvidence, true, name + ' needs raw evidence');
    assert.equal(Object.hasOwn(fixture, 'projectionDefaults'), false);
    assert.equal(Object.hasOwn(fixture, 'readinessVerdict'), false);
    assert.equal(Object.hasOwn(fixture, 'completionVerdict'), false);
    assert.equal(Object.hasOwn(fixture, 'fallback'), false);
  }
});

test('source and output declarations stay source-only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8'));
  assert.deepEqual(manifest.outputs, []);
  assert.deepEqual(manifest.writes.allowed, []);
  assert.equal(manifest.surface.publish_as, 'source_only');
  assert.equal(manifest.requires_approval, true);
  assert.equal(manifest.run_commands_by_default, false);
  const baseline = findFixtureBaseline();
  if (baseline) {
    assert.equal(git('diff', '--name-only', baseline, '--', '_projects/development/repo-auto-code/SOURCE-LOCK.json'), '');
  }
  assert.equal(git('hash-object', '_projects/development/repo-auto-code/SOURCE-LOCK.json'), sourceLockBlob);
  for (const denied of ['scheduled-tasks/**', 'activation/**', 'runtime/**', 'pilot/**', 'queue/**']) {
    assert.ok(manifest.writes.denied.includes(denied));
  }
});

test('generic role templates require runtime route values and exact failure semantics', () => {
  const expected = [
    'AGENTS.auto-code.managed.md',
    'closure-manager.prompt.md',
    'implementation-worker.prompt.md',
    'final-pre-g4-reviewer.prompt.md',
    'authoritative-g4-reviewer.prompt.md',
    'independent-assurance-audit.prompt.md',
    'evaluation-candidate.comment.md'
  ].sort();
  assert.deepEqual(fs.readdirSync(templateRoot).sort(), expected);
  const prompts = expected.filter((name) => name.endsWith('.prompt.md') || name.startsWith('AGENTS.'));
  const required = [
    'Provider: {{provider}}',
    'Canonical base model: {{canonical_base_model}}',
    'Reasoning or effort: {{reasoning_or_effort}}',
    'Reference-family reasoning equivalent: {{reference_family_reasoning_equivalent}}',
    'Sol-equivalent reasoning: {{sol_equivalent_reasoning}}',
    'Harness/adapter',
    'Surface',
    'Role: {{role}}',
    'Exact repository: {{repository}}',
    'Exact scope: {{scope}}',
    'Exact authority: {{authority}}',
    'Fast mode: prohibited',
    'Route substitution: prohibited',
    'UNSUPPORTED_DELEGATION'
  ];
  for (const name of prompts) {
    const text = fs.readFileSync(path.join(templateRoot, name), 'utf8');
    for (const fragment of required) assert.ok(text.includes(fragment), name + ' missing ' + fragment);
  }
  const candidate = fs.readFileSync(path.join(templateRoot, 'evaluation-candidate.comment.md'), 'utf8');
  assert.ok(candidate.includes('evaluation-candidate:v1'));
  assert.ok(candidate.includes('public_safe_label'));
});

test('architecture contains the role, authority, reconciliation, G4, assurance, and continuation gates', () => {
  const text = [
    'architecture.md',
    'failure-matrix.md',
    'protocol.md',
    'state-machine.md',
    'AGENTS.auto-code.managed.md'
  ].map((name) => fs.readFileSync(path.join(name.endsWith('.managed.md') ? templateRoot : mainRoot, name), 'utf8')).join('\n');
  for (const fragment of [
    'Web governance controller',
    'Closure manager',
    'Implementation/amendment worker',
    'Final pre-G4 reviewer',
    'Authoritative technical G4 reviewer',
    'Independent assurance auditor',
    'Evaluation-staging lane',
    'CLOSURE_LEASE_NOT_ACTIVATED',
    'UNSUPPORTED_DELEGATION',
    'PARENT_RECONCILIATION_INCOMPLETE',
    'Exactly one authoritative technical G4 verdict',
    'CLEAR or CONCERN',
    'Completion and merge',
    'next task'
  ]) {
    assert.ok(text.includes(fragment), 'missing architecture requirement ' + fragment);
  }
});

test('new fixture decisions contain no authority-bearing defaults or route identity literals', () => {
  const forbidden = [
    Buffer.from('T3BlbkFJ', 'base64').toString(),
    Buffer.from('R1BULTU', 'base64').toString(),
    Buffer.from('Q29kZXg=', 'base64').toString(),
    Buffer.from('Q2xhdWRl', 'base64').toString(),
    Buffer.from('R2VtaW5p', 'base64').toString()
  ];

  const text = activeSourceFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const literal of forbidden) assert.doesNotMatch(text, new RegExp(literal));
  for (const name of addedFixtures.concat(modifiedFixtures)) {
    const textOfFixture = fs.readFileSync(path.join(fixtureRoot, name), 'utf8');
    assert.doesNotMatch(textOfFixture, /projectionDefaults|readinessVerdict|completionVerdict|fallback/);
  }
});


const a4ContractFiles = [
  path.join(mainRoot, 'architecture.md'),
  path.join(mainRoot, 'protocol.md'),
  path.join(mainRoot, 'state-machine.md'),
  path.join(mainRoot, 'failure-matrix.md'),
  path.join(templateRoot, 'closure-manager.prompt.md'),
  path.join(templateRoot, 'final-pre-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'authoritative-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'independent-assurance-audit.prompt.md')
];

function a4ContractText() {
  return a4ContractFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

function assertA4Terms(terms) {
  const text = a4ContractText();
  for (const term of terms) assert.ok(text.includes(term), 'A4 contract missing ' + term);
}

function exactReviewIdentity(identity) {
  assert.ok(identity && typeof identity === 'object');
  for (const key of ['repository', 'pr', 'head', 'capability']) {
    assert.equal(typeof identity[key], 'string', 'review identity needs ' + key);
  }
  return ['repository', 'pr', 'head', 'capability'].map((key) => identity[key]).join('|');
}

function usableReview(review, expectedIdentity) {
  if (!review || review.rawEvidence !== true) return false;
  if (!review.identity || typeof review.identity !== 'object') return false;
  if (review.state !== 'pending' && review.state !== 'completed') return false;
  return exactReviewIdentity(review.identity) === exactReviewIdentity(expectedIdentity);
}

function externalReviewGate(evidence) {
  assert.ok(evidence && Array.isArray(evidence.reviews));
  assert.equal(typeof evidence.limitExhausted, 'boolean');
  const currentIdentity = exactReviewIdentity(evidence.identity);
  if (evidence.limitExhausted === true) {
    return { decision: 'REVIEW_LIMIT_EXHAUSTED', technicalVerdict: 'BLOCKED', freshG4Required: false };
  }
  const matching = evidence.reviews.filter((review) => usableReview(review, evidence.identity));
  if (matching.some((review) => review.state === 'pending')) {
    return { decision: 'PENDING_REVIEW_REUSED', technicalVerdict: 'WAIT', freshG4Required: false };
  }
  if (matching.some((review) => review.state === 'completed')) {
    return { decision: 'COMPLETED_REVIEW_CONSUMED', technicalVerdict: 'ADJUDICATE', freshG4Required: false };
  }
  const previousIdentity = evidence.previousIdentity;
  const changedHead = previousIdentity &&
    exactReviewIdentity(previousIdentity) !== currentIdentity;
  return {
    decision: 'NEW_REVIEW_REQUIRED',
    technicalVerdict: 'BLOCKED',
    freshG4Required: changedHead === true
  };
}

function g4ThreadPermission(evidence) {
  assert.equal(typeof evidence.finalExactHead, 'boolean');
  assert.equal(typeof evidence.bounded, 'boolean');
  assert.equal(typeof evidence.evidenceBound, 'boolean');
  if (evidence.action === 'resolve') return false;
  if (evidence.phase === 'AMEND') return false;
  return evidence.action === 'reply' &&
    evidence.verdict === 'PASS' &&
    evidence.finalExactHead === true &&
    evidence.bounded === true &&
    evidence.evidenceBound === true;
}

function assuranceGate(evidence) {
  assert.equal(typeof evidence.webVerified, 'boolean');
  assert.equal(typeof evidence.finalExactHead, 'boolean');
  assert.equal(typeof evidence.webAdjudicated, 'boolean');
  if (evidence.webVerified !== true) return 'WEB_VERIFICATION_REQUIRED';
  if (evidence.g4Verdict !== 'PASS' ||
      evidence.finalExactHead !== true ||
      evidence.webAdjudicated !== true) {
    return 'ASSURANCE_ORDER_INVALID';
  }
  return 'ASSURANCE_ELIGIBLE';
}

function assuranceOutcome(verdict) {
  assert.ok(verdict === 'CLEAR' || verdict === 'CONCERN');
  if (verdict === 'CLEAR') {
    return { webFinality: true, mergeAuthorized: false, returnToLoop: false };
  }
  return { webFinality: false, mergeAuthorized: false, returnToLoop: true };
}

function concernDisposition(threads) {
  assert.ok(Array.isArray(threads));
  const resolvedIds = [];
  const openIds = [];
  for (const thread of threads) {
    assert.equal(typeof thread.id, 'string');
    assert.equal(typeof thread.concernRelated, 'boolean');
    assert.equal(typeof thread.independentlyProven, 'boolean');
    if (thread.concernRelated === false && thread.independentlyProven === true) {
      resolvedIds.push(thread.id);
    } else {
      openIds.push(thread.id);
    }
  }
  return { resolvedIds, openIds, returnToLoop: openIds, mergeAuthorized: false };
}

function resolvedThreadDisposition(thread) {
  assert.equal(thread.resolved, true);
  assert.equal(typeof thread.regressed, 'boolean');
  assert.equal(typeof thread.contraryEvidence, 'boolean');
  assert.equal(typeof thread.actor, 'string');
  if (thread.regressed === true || thread.contraryEvidence === true) {
    return thread.actor === 'web' ? 'REOPEN_BY_WEB' : 'REOPEN_PROHIBITED';
  }
  return 'RETAIN_RESOLVED';
}

test('A4 source defines an exact-head idempotent external-review identity', () => {
  assertA4Terms([
    'external-review capability',
    'one usable pending review suppresses',
    'one usable completed review is consumed',
    'materially amended head creates a new identity',
    'newly isolated authoritative G4',
    'REVIEW_LIMIT_EXHAUSTED'
  ]);
});

test('A4 suppresses a duplicate trigger for a pending usable review', () => {
  const identity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  assert.deepEqual(externalReviewGate({
    identity,
    previousIdentity: null,
    limitExhausted: false,
    reviews: [{ identity, state: 'pending', rawEvidence: true }]
  }), { decision: 'PENDING_REVIEW_REUSED', technicalVerdict: 'WAIT', freshG4Required: false });
});

test('A4 consumes a completed usable review without retriggering', () => {
  const identity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  assert.deepEqual(externalReviewGate({
    identity,
    previousIdentity: null,
    limitExhausted: false,
    reviews: [{ identity, state: 'completed', rawEvidence: true }]
  }), { decision: 'COMPLETED_REVIEW_CONSUMED', technicalVerdict: 'ADJUDICATE', freshG4Required: false });
});

test('A4 requires new review and fresh G4 after a changed head', () => {
  const previousIdentity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  const identity = { ...previousIdentity, head: 'head-b' };
  assert.deepEqual(externalReviewGate({
    identity,
    previousIdentity,
    limitExhausted: false,
    reviews: [{ identity: previousIdentity, state: 'completed', rawEvidence: true }]
  }), { decision: 'NEW_REVIEW_REQUIRED', technicalVerdict: 'BLOCKED', freshG4Required: true });
});

test('A4 rejects unbound and unusable review evidence', () => {
  const identity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  const otherIdentity = { ...identity, pr: 'pr-other' };
  assert.deepEqual(externalReviewGate({
    identity,
    previousIdentity: null,
    limitExhausted: false,
    reviews: [
      { identity: otherIdentity, state: 'completed', rawEvidence: true },
      { identity, state: 'completed', rawEvidence: false }
    ]
  }), { decision: 'NEW_REVIEW_REQUIRED', technicalVerdict: 'BLOCKED', freshG4Required: false });
});

test('A4 treats review or model exhaustion as a blocker, never PASS', () => {
  const identity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  const result = externalReviewGate({
    identity,
    previousIdentity: null,
    limitExhausted: true,
    reviews: []
  });
  assert.equal(result.decision, 'REVIEW_LIMIT_EXHAUSTED');
  assert.equal(result.technicalVerdict, 'BLOCKED');
  assert.notEqual(result.technicalVerdict, 'PASS');
});

test('A4 prohibits a technical reply during an AMEND cycle', () => {
  assertA4Terms(['During every AMEND cycle', 'must not reply to or resolve review threads']);
  assert.equal(g4ThreadPermission({
    phase: 'AMEND',
    action: 'reply',
    verdict: 'AMEND',
    finalExactHead: false,
    bounded: true,
    evidenceBound: true
  }), false);
});

test('A4 prohibits authoritative G4 thread resolution in every phase', () => {
  assertA4Terms(['Thread resolution is always prohibited', 'every thread remains unresolved']);
  assert.equal(g4ThreadPermission({
    phase: 'FINAL',
    action: 'resolve',
    verdict: 'PASS',
    finalExactHead: true,
    bounded: true,
    evidenceBound: true
  }), false);
});

test('A4 permits only a bounded evidence reply after final technical PASS', () => {
  assertA4Terms(['bounded, evidence-backed technical reply']);
  const evidence = {
    phase: 'FINAL',
    action: 'reply',
    verdict: 'PASS',
    finalExactHead: true,
    bounded: true,
    evidenceBound: true
  };
  assert.equal(g4ThreadPermission(evidence), true);
  assert.equal(g4ThreadPermission({ ...evidence, bounded: false }), false);
});

test('A4 requires web verification before assurance', () => {
  assertA4Terms(['web must independently reread and verify', 'WEB_VERIFICATION_REQUIRED']);
  assert.equal(assuranceGate({
    webVerified: false,
    finalExactHead: true,
    webAdjudicated: true,
    g4Verdict: 'PASS'
  }), 'WEB_VERIFICATION_REQUIRED');
});

test('A4 CLEAR permits web finality but never authorises merge', () => {
  assertA4Terms(['CLEAR permits web finality only', 'does not authorise merge']);
  assert.equal(assuranceGate({
    webVerified: true,
    finalExactHead: true,
    webAdjudicated: true,
    g4Verdict: 'PASS'
  }), 'ASSURANCE_ELIGIBLE');
  assert.deepEqual(assuranceOutcome('CLEAR'), {
    webFinality: true,
    mergeAuthorized: false,
    returnToLoop: false
  });
});

test('A4 CONCERN leaves concern findings open while disposing proven unrelated findings', () => {
  assertA4Terms(['On CONCERN', 'reply to and resolve every thread', 'only the remaining set returns to the review loop']);
  assert.deepEqual(concernDisposition([
    { id: 'unrelated-proven', concernRelated: false, independentlyProven: true },
    { id: 'concern-related', concernRelated: true, independentlyProven: true },
    { id: 'insufficient-proof', concernRelated: false, independentlyProven: false }
  ]), {
    resolvedIds: ['unrelated-proven'],
    openIds: ['concern-related', 'insufficient-proof'],
    returnToLoop: ['concern-related', 'insufficient-proof'],
    mergeAuthorized: false
  });
});

test('A4 preserves resolved threads unless regression or contrary evidence is proven', () => {
  assertA4Terms(['Previously resolved threads remain resolved unless']);
  assert.equal(resolvedThreadDisposition({
    resolved: true,
    regressed: false,
    contraryEvidence: false,
    actor: 'web'
  }), 'RETAIN_RESOLVED');
  assert.equal(resolvedThreadDisposition({
    resolved: true,
    regressed: true,
    contraryEvidence: false,
    actor: 'worker'
  }), 'REOPEN_PROHIBITED');
  assert.equal(resolvedThreadDisposition({
    resolved: true,
    regressed: true,
    contraryEvidence: false,
    actor: 'web'
  }), 'REOPEN_BY_WEB');
});

test('A4 changes no fixture file, id, or classification', () => {
  assert.equal(git('diff', '--name-status', 'HEAD', '--', fixturePrefix), '');
  const names = currentFixtureNames();
  assert.equal(names.length, 112);
  assert.equal(new Set(names).size, 112);
  assert.equal(names.filter((name) => classification(readJson(name))).length, 17);
  assert.equal(names.filter((name) => !classification(readJson(name))).length, 95);
});

test('A4 preserves source-only uninstalled unscheduled inactive state', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8'));
  assert.equal(manifest.surface.publish_as, 'source_only');
  assert.deepEqual(manifest.outputs, []);
  assert.deepEqual(manifest.writes.allowed, []);
  for (const directory of ['scheduled-tasks', 'activation', 'runtime', 'pilot', 'queue', 'claim-refs']) {
    assert.equal(fs.existsSync(path.join(projectRoot, directory)), false, directory + ' must not exist');
  }
});

test('retired scheduled material is absent and no installed or scheduled surface exists', () => {
  const templateNames = fs.readdirSync(templateRoot);
  assert.equal(templateNames.some((name) => /scheduler|relay|handoff|ote|eto/i.test(name)), false);
  const sourceNames = activeSourceFiles().map((file) => path.relative(repoRoot, file).replace(/\\/g, '/'));
  assert.equal(sourceNames.some((name) => /scheduled-task\.prompt|scheduled-relay|hourly-relay/i.test(name)), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8'));
  assert.deepEqual(manifest.outputs, []);
  assert.deepEqual(manifest.writes.allowed, []);
  for (const directory of ['scheduled-tasks', 'activation', 'runtime', 'pilot', 'queue', 'claim-refs']) {
    assert.equal(fs.existsSync(path.join(projectRoot, directory)), false, directory + ' must not exist');
  }
});

test('reconciliation, G4, assurance, and no-auto-next rules are explicit', () => {
  const text = activeSourceFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.match(text, /compare-and-preserve/i);
  assert.match(text, /head change invalidates/i);
  assert.match(text, /fresh G4/i);
  assert.match(text, /cannot authorise merge/i);
  assert.match(text, /CONCERN blocks/i);
  assert.match(text, /never activate or select a next task/i);
  assert.match(text, /cross-repository fan-out/i);
  assert.match(text, /cross-PR mutation/i);
});
const a6ContractFiles = [
  path.join(mainRoot, 'architecture.md'),
  path.join(mainRoot, 'protocol.md'),
  path.join(mainRoot, 'state-machine.md'),
  path.join(mainRoot, 'failure-matrix.md'),
  path.join(templateRoot, 'closure-manager.prompt.md'),
  path.join(templateRoot, 'final-pre-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'authoritative-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'independent-assurance-audit.prompt.md')
];
const a6PromptFiles = [
  path.join(templateRoot, 'closure-manager.prompt.md'),
  path.join(templateRoot, 'final-pre-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'authoritative-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'independent-assurance-audit.prompt.md')
];

function a6ContractText() {
  return a6ContractFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

function assertA6Terms(terms) {
  const text = a6ContractText();
  for (const term of terms) assert.ok(text.includes(term), 'A6 contract missing ' + term);
}

const assignmentFields = [
  'provider',
  'canonicalBaseModel',
  'reasoning',
  'solEquivalentReasoning',
  'harnessAdapter',
  'surface',
  'role',
  'repository',
  'scope',
  'authority',
  'instructionsRepository',
  'instructionsFile',
  'instructionsRef',
  'instructionsCommit',
  'instructionsBlob',
  'evidenceLocator'
];

function syntheticAssignment(overrides = {}) {
  return {
    rawEvidence: true,
    provider: 'provider-synthetic',
    canonicalBaseModel: 'model-synthetic',
    reasoning: 'reasoning-synthetic',
    solEquivalentReasoning: 'sol-equivalent-synthetic',
    harnessAdapter: 'adapter-synthetic',
    surface: 'surface-synthetic',
    role: 'role-synthetic',
    repository: 'repo-synthetic',
    scope: 'scope-synthetic',
    authority: 'authority-synthetic',
    instructionsRepository: 'instructions-repository-synthetic',
    instructionsFile: 'custom-instructions-synthetic.md',
    instructionsRef: 'ref-synthetic',
    instructionsCommit: 'c'.repeat(40),
    instructionsBlob: 'b'.repeat(40),
    evidenceLocator: 'locator-synthetic',
    ...overrides
  };
}

function completeAssignment(value) {
  return value && value.rawEvidence === true &&
    assignmentFields.every((field) => typeof value[field] === 'string' && value[field].length > 0);
}

function resolvedAssignment(source, value) {
  return {
    decision: 'RESOLVED',
    source,
    evidenceLocator: value.evidenceLocator,
    values: Object.fromEntries(assignmentFields.map((field) => [field, value[field]]))
  };
}

function resolveA6Assignment(evidence) {
  assert.ok(evidence && typeof evidence === 'object');
  if (evidence.unselectedAlternative !== undefined) {
    return { decision: 'MODEL_ASSIGNMENT_REQUIRED' };
  }
  const hasCurrent = Object.hasOwn(evidence, 'currentChat') && evidence.currentChat !== null && evidence.currentChat !== undefined;
  if (hasCurrent) {
    const current = evidence.currentChat;
    if (current.ambiguous === true || current.conflicting === true ||
        current.unselectedAlternative !== undefined || !completeAssignment(current)) {
      return { decision: 'MODEL_ASSIGNMENT_REQUIRED' };
    }
    return resolvedAssignment('current-chat', current);
  }
  const canonical = evidence.canonicalInstructions;
  if (!completeAssignment(canonical) || canonical.ambiguous === true || canonical.conflicting === true ||
      canonical.unselectedAlternative !== undefined) {
    return { decision: 'MODEL_ASSIGNMENT_REQUIRED' };
  }
  return resolvedAssignment('canonical-custom-instructions', canonical);
}

function activeA6Topology(overrides = {}) {
  return {
    rawEvidence: true,
    grants: {
      sourceAccepted: true,
      designMerged: true,
      installed: true,
      explicitActivation: true
    },
    surfaces: [
      { type: 'web-orchestrator', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true },
      { type: 'executor-root', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true }
    ],
    subordinateRuns: [],
    temporaryChat: null,
    ...overrides
  };
}

function topologyDecision(evidence) {
  assert.equal(evidence.rawEvidence, true);
  const grants = evidence.grants || {};
  const active = grants.sourceAccepted === true && grants.designMerged === true &&
    grants.installed === true && grants.explicitActivation === true;
  if (!active) return { decision: 'SOURCE_ONLY_INACTIVE', dispatch: false };

  const surfaces = Array.isArray(evidence.surfaces) ? evidence.surfaces : [];
  const orchestrators = surfaces.filter((surface) => surface.type === 'web-orchestrator');
  const roots = surfaces.filter((surface) => surface.type === 'executor-root');
  if (orchestrators.length !== 1 || roots.length !== 1) {
    return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
  }
  const allKeys = surfaces.map((surface) => {
    if (!surface.task || !surface.repository || !surface.pr) return null;
    return [surface.task, surface.repository, surface.pr].join('|');
  });
  if (allKeys.some((key) => key === null) || new Set(allKeys).size !== 1 ||
      surfaces.some((surface) => surface.persistent !== true)) {
    return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
  }

  const runs = Array.isArray(evidence.subordinateRuns) ? evidence.subordinateRuns : [];
  if (runs.some((run) => run.rawEvidence !== true || run.promptBounded !== true ||
      run.fresh !== true || run.clean !== true || run.exactAuthority !== true ||
      run.inheritedAuthority !== false || run.retained !== false)) {
    return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
  }

  const temporary = evidence.temporaryChat;
  if (temporary !== null && temporary !== undefined) {
    if (temporary.rawEvidence !== true || temporary.fresh !== true || temporary.readOnly !== true ||
        temporary.finalTechnicalVerdict !== 'PASS' || temporary.webVerified !== true ||
        !['CLEAR', 'CONCERN'].includes(temporary.verdict) || temporary.hostedMutation === true ||
        temporary.mergeAuthority === true || temporary.selectsWork === true) {
      return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
    }
  }
  return { decision: 'TOPOLOGY_VALID', dispatch: true };
}

function temporaryChatDecision(evidence) {
  assert.equal(evidence.rawEvidence, true);
  if (evidence.fresh !== true || evidence.readOnly !== true || evidence.finalTechnicalVerdict !== 'PASS' ||
      evidence.webVerified !== true || !['CLEAR', 'CONCERN'].includes(evidence.verdict) ||
      evidence.hostedMutation === true || evidence.mergeAuthority === true || evidence.selectsWork === true) {
    return 'SURFACE_TOPOLOGY_INVALID';
  }
  return evidence.verdict;
}

function controllerAuthorityFromIdentity(evidence) {
  assert.equal(evidence.rawEvidence, true);
  return evidence.explicitGrant === 'web-governance-grant' && evidence.surface === 'web-orchestrator';
}

test('A6 target topology requires separate acceptance, merge, installation, and activation grants', () => {
  assertA6Terms([
    'separate source acceptance, design merge, toolkit installation, and explicit activation',
    'Source acceptance, design merge, installation, and activation are distinct',
    'A6-C2 permits this one source-only G3 continuation'
  ]);
});

test('A6 admits exactly one Web Orchestrator and one Executor-root per governed task or PR', () => {
  assert.deepEqual(topologyDecision(activeA6Topology()), { decision: 'TOPOLOGY_VALID', dispatch: true });
  assertA6Terms(['Exactly one persistent Web Orchestrator', 'Exactly one persistent Executor-root']);
});

test('A6 rejects duplicate surface identities', () => {
  const evidence = activeA6Topology({
    surfaces: [
      { type: 'web-orchestrator', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true },
      { type: 'web-orchestrator', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true },
      { type: 'executor-root', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true }
    ]
  });
  assert.equal(topologyDecision(evidence).decision, 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 rejects cross-task or cross-repository surfaces', () => {
  const evidence = activeA6Topology({
    surfaces: [
      { type: 'web-orchestrator', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true },
      { type: 'executor-root', task: 'other-task-synthetic', repository: 'other-repo-synthetic', pr: 'other-pr-synthetic', persistent: true }
    ]
  });
  assert.equal(topologyDecision(evidence).decision, 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 requires fresh clean exact-authority subordinate workspaces after activation', () => {
  const run = {
    rawEvidence: true,
    kind: 'implementation-synthetic',
    promptBounded: true,
    fresh: true,
    clean: true,
    exactAuthority: true,
    inheritedAuthority: false,
    retained: false
  };
  assert.deepEqual(topologyDecision(activeA6Topology({ subordinateRuns: [run] })), { decision: 'TOPOLOGY_VALID', dispatch: true });
  assertA6Terms(['fresh prompt-bounded', 'independently clean exact-authority worktree']);
});

test('A6 rejects retained worktree reuse after activation', () => {
  const run = {
    rawEvidence: true,
    kind: 'amendment-synthetic',
    promptBounded: true,
    fresh: false,
    clean: false,
    exactAuthority: true,
    inheritedAuthority: true,
    retained: true
  };
  assert.equal(topologyDecision(activeA6Topology({ subordinateRuns: [run] })).decision, 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 source-only implementation does not activate A6', () => {
  assert.deepEqual(topologyDecision({
    rawEvidence: true,
    sourceChanged: true,
    grants: { sourceAccepted: false, designMerged: false, installed: false, explicitActivation: false },
    surfaces: []
  }), { decision: 'SOURCE_ONLY_INACTIVE', dispatch: false });
});

test('A6 merge does not itself activate A6', () => {
  assert.deepEqual(topologyDecision({
    rawEvidence: true,
    merged: true,
    grants: { sourceAccepted: true, designMerged: true, installed: false, explicitActivation: false },
    surfaces: []
  }), { decision: 'SOURCE_ONLY_INACTIVE', dispatch: false });
});

test('A6 rejects Temporary Chat before final exact-head PASS', () => {
  assert.equal(topologyDecision(activeA6Topology({
    temporaryChat: {
      rawEvidence: true,
      fresh: true,
      readOnly: true,
      finalTechnicalVerdict: 'AMEND',
      webVerified: true,
      verdict: 'CONCERN',
      hostedMutation: false,
      mergeAuthority: false,
      selectsWork: false
    }
  })).decision, 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 rejects Temporary Chat before independent Web verification', () => {
  assert.equal(topologyDecision(activeA6Topology({
    temporaryChat: {
      rawEvidence: true,
      fresh: true,
      readOnly: true,
      finalTechnicalVerdict: 'PASS',
      webVerified: false,
      verdict: 'CLEAR',
      hostedMutation: false,
      mergeAuthority: false,
      selectsWork: false
    }
  })).decision, 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 Temporary Chat returns only CLEAR or CONCERN', () => {
  const base = {
    rawEvidence: true,
    fresh: true,
    readOnly: true,
    finalTechnicalVerdict: 'PASS',
    webVerified: true,
    hostedMutation: false,
    mergeAuthority: false,
    selectsWork: false
  };
  assert.equal(temporaryChatDecision({ ...base, verdict: 'CLEAR' }), 'CLEAR');
  assert.equal(temporaryChatDecision({ ...base, verdict: 'CONCERN' }), 'CONCERN');
  assert.equal(temporaryChatDecision({ ...base, verdict: 'PASS' }), 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 Temporary Chat has no hosted or finality authority', () => {
  const base = {
    rawEvidence: true,
    fresh: true,
    readOnly: true,
    finalTechnicalVerdict: 'PASS',
    webVerified: true,
    verdict: 'CLEAR',
    hostedMutation: false,
    mergeAuthority: false,
    selectsWork: false
  };
  assert.equal(temporaryChatDecision({ ...base, hostedMutation: true }), 'SURFACE_TOPOLOGY_INVALID');
  assert.equal(temporaryChatDecision({ ...base, mergeAuthority: true }), 'SURFACE_TOPOLOGY_INVALID');
  assert.equal(temporaryChatDecision({ ...base, selectsWork: true }), 'SURFACE_TOPOLOGY_INVALID');
  assertA6Terms(['cannot return PASS or AMEND', 'cannot authorise merge', 'select work']);
});

test('A6 current-chat complete assignment overrides Custom Instructions', () => {
  const current = syntheticAssignment({ provider: 'provider-current-synthetic', evidenceLocator: 'current-chat-locator' });
  const canonical = syntheticAssignment({ provider: 'provider-canonical-synthetic', evidenceLocator: 'canonical-locator' });
  const result = resolveA6Assignment({ currentChat: current, canonicalInstructions: canonical });
  assert.equal(result.decision, 'RESOLVED');
  assert.equal(result.source, 'current-chat');
  assert.equal(result.values.provider, 'provider-current-synthetic');
  assert.equal(result.evidenceLocator, 'current-chat-locator');
});

test('A6 no current-chat assignment permits complete canonical fallback', () => {
  const canonical = syntheticAssignment({ evidenceLocator: 'canonical-locator' });
  const result = resolveA6Assignment({ canonicalInstructions: canonical });
  assert.equal(result.decision, 'RESOLVED');
  assert.equal(result.source, 'canonical-custom-instructions');
  assert.equal(result.evidenceLocator, 'canonical-locator');
  assert.equal(result.values.instructionsRepository, 'instructions-repository-synthetic');
});

test('A6 partial current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED', () => {
  const partial = syntheticAssignment();
  delete partial.instructionsBlob;
  assert.equal(resolveA6Assignment({ currentChat: partial, canonicalInstructions: syntheticAssignment() }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 ambiguous current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED', () => {
  assert.equal(resolveA6Assignment({ currentChat: syntheticAssignment({ ambiguous: true }), canonicalInstructions: syntheticAssignment() }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 conflicting current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED', () => {
  assert.equal(resolveA6Assignment({ currentChat: syntheticAssignment({ conflicting: true }), canonicalInstructions: syntheticAssignment() }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 assignment sources cannot be mixed', () => {
  const current = syntheticAssignment({ provider: 'provider-current-synthetic' });
  const canonical = syntheticAssignment({ provider: 'provider-canonical-synthetic' });
  const result = resolveA6Assignment({ currentChat: current, canonicalInstructions: canonical });
  assert.equal(result.source, 'current-chat');
  assert.equal(result.values.provider, current.provider);
  assert.notEqual(result.values.provider, canonical.provider);
  assertA6Terms(['Sources cannot be mixed', 'Current-chat and Custom Instructions values are never combined']);
});

test('A6 model cannot be selected from context-only signals', () => {
  const result = resolveA6Assignment({
    memory: 'model-memory-synthetic',
    preference: 'preference-synthetic',
    cost: 'cost-synthetic',
    capability: 'capability-synthetic',
    benchmarks: 'benchmarks-synthetic',
    previousRun: 'run-synthetic',
    previousChat: 'chat-synthetic',
    availability: 'availability-synthetic'
  });
  assert.deepEqual(result, { decision: 'MODEL_ASSIGNMENT_REQUIRED' });
});

test('A6 unselected alternative model cannot be introduced', () => {
  assert.deepEqual(resolveA6Assignment({
    currentChat: syntheticAssignment(),
    unselectedAlternative: 'model-alternative-synthetic'
  }), { decision: 'MODEL_ASSIGNMENT_REQUIRED' });
});

test('A6 prompt contracts record assignment provenance', () => {
  for (const file of a6PromptFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes('Assignment source: {{assignment_source}}'), path.basename(file));
    assert.ok(text.includes('Assignment evidence locator: {{assignment_evidence_locator}}'), path.basename(file));
  }
  assertA6Terms(['Every rendered prompt records the assignment source and assignment evidence locator']);
});

test('A6 model role and surface do not grant controller authority', () => {
  assert.equal(controllerAuthorityFromIdentity({
    rawEvidence: true,
    surface: 'executor-root',
    role: 'implementation-synthetic',
    explicitGrant: 'none'
  }), false);
  assert.equal(controllerAuthorityFromIdentity({
    rawEvidence: true,
    surface: 'temporary-chat',
    role: 'assurance-synthetic',
    explicitGrant: 'none'
  }), false);
  assertA6Terms(['Model, role, reasoning, and surface identity never grant controller authority']);
});

test('A6 every subordinate run kind is fresh and prompt-bounded', () => {
  const kinds = ['implementation-synthetic', 'amendment-synthetic', 'pre-g4-synthetic', 'g4-synthetic'];
  const runs = kinds.map((kind) => ({
    rawEvidence: true,
    kind,
    promptBounded: true,
    fresh: true,
    clean: true,
    exactAuthority: true,
    inheritedAuthority: false,
    retained: false
  }));
  assert.deepEqual(topologyDecision(activeA6Topology({ subordinateRuns: runs })), { decision: 'TOPOLOGY_VALID', dispatch: true });
});

test('A6 bootstrap continuation is not a future runtime bypass', () => {
  assertA6Terms([
    'A6-C2 permits this one source-only G3 continuation',
    'not a reusable runtime bypass after adoption',
    'not a future runtime workspace-reuse rule'
  ]);
  assert.equal(topologyDecision({
    rawEvidence: true,
    grants: { sourceAccepted: false, designMerged: false, installed: false, explicitActivation: false },
    retainedWorktree: true,
    surfaces: []
  }).decision, 'SOURCE_ONLY_INACTIVE');
});

test('A6 persistent Executor-root coordinates evidence but cannot implement or govern', () => {
  assertA6Terms([
    'persistence does not authorize implementation',
    'hosted governance',
    'The Executor-root may collect and reconcile evidence packets'
  ]);
  assert.equal(controllerAuthorityFromIdentity({
    rawEvidence: true,
    surface: 'executor-root',
    role: 'executor-root-synthetic',
    explicitGrant: 'none'
  }), false);
});

test('A6 Temporary Chat requires an independent read-only context', () => {
  assertA6Terms(['fresh for that final head', 'independently isolated', 'read-only']);
  const base = {
    rawEvidence: true,
    fresh: true,
    readOnly: true,
    finalTechnicalVerdict: 'PASS',
    webVerified: true,
    verdict: 'CLEAR',
    hostedMutation: false,
    mergeAuthority: false,
    selectsWork: false
  };
  assert.equal(temporaryChatDecision({ ...base, fresh: false }), 'SURFACE_TOPOLOGY_INVALID');
  assert.equal(temporaryChatDecision({ ...base, readOnly: false }), 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 source-only state remains uninstalled unscheduled and inactive', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8'));
  assert.deepEqual(manifest.outputs, []);
  assert.deepEqual(manifest.writes.allowed, []);
  assert.deepEqual(topologyDecision({
    rawEvidence: true,
    grants: { sourceAccepted: false, designMerged: false, installed: false, explicitActivation: false },
    surfaces: []
  }), { decision: 'SOURCE_ONLY_INACTIVE', dispatch: false });
  assertA6Terms(['source-only', 'uninstalled', 'unscheduled', 'inactive']);
});

function executionIdentity(overrides = {}) {
  return {
    provider: 'provider-g4-synthetic',
    canonical_model: 'model-g4-synthetic',
    reasoning: 'reasoning-g4-synthetic',
    role: 'technical G4 reviewer',
    surface: 'technical-g4-reviewer',
    exact_head: 'head-synthetic',
    assignment_source: 'current-chat-synthetic',
    assignment_evidence: 'assignment-locator-synthetic',
    ...overrides
  };
}

function temporaryEvidence(overrides = {}) {
  const value = {
    rawEvidence: true,
    exactHead: 'head-synthetic',
    finalExactHead: true,
    g4Verdict: 'PASS',
    webVerified: true,
    webAdjudicated: true,
    freshTemporaryChatCount: 1,
    g4ExecutionIdentity: executionIdentity(),
    webExecutionIdentity: executionIdentity({
      provider: 'provider-web-synthetic',
      canonical_model: 'model-web-synthetic',
      reasoning: 'reasoning-web-synthetic',
      role: 'Web Temporary Chat assurance auditor',
      surface: 'web-temporary-chat',
      assignment_source: 'web-current-chat-synthetic'
    }),
    separateContext: true,
    separateFrom: ['web-orchestrator', 'executor-root', 'implementation', 'amendment', 'technical-g4-reviewer'],
    independentBoundedEvidence: true,
    g4PacketOnly: false,
    g4SelfAttestationOnly: false,
    crossProviderModelDiversity: null,
    verdict: 'CLEAR',
    mergeAuthority: false,
    githubAuthority: false,
    acceptanceAuthority: false,
    selectsWork: false
  };
  Object.assign(value, overrides);
  value.crossProviderModelDiversity = value.crossProviderModelDiversity || {
    providerDifferent: value.g4ExecutionIdentity.provider !== value.webExecutionIdentity.provider,
    modelDifferent: value.g4ExecutionIdentity.canonical_model !== value.webExecutionIdentity.canonical_model,
    sameModelFamily: false
  };
  return value;
}

function temporaryAssuranceGate(evidence) {
  if (!evidence || evidence.rawEvidence !== true) return 'SURFACE_TOPOLOGY_INVALID';
  if (evidence.g4Verdict !== 'PASS' || evidence.finalExactHead !== true || evidence.webVerified !== true ||
      evidence.webAdjudicated !== true) return 'WEB_VERIFICATION_REQUIRED';
  if (evidence.freshTemporaryChatCount !== 1) return 'TEMPORARY_ASSURANCE_REQUIRED';
  const g4 = evidence.g4ExecutionIdentity;
  const web = evidence.webExecutionIdentity;
  if (!g4 || !web || g4.role !== 'technical G4 reviewer' || web.surface !== 'web-temporary-chat' ||
      g4.exact_head !== evidence.exactHead || web.exact_head !== evidence.exactHead) {
    return 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED';
  }
  if (evidence.separateContext !== true || !Array.isArray(evidence.separateFrom) ||
      !evidence.separateFrom.includes('executor-root') || !evidence.separateFrom.includes('implementation') ||
      !evidence.separateFrom.includes('technical-g4-reviewer')) {
    return 'SURFACE_TOPOLOGY_INVALID';
  }
  if (evidence.independentBoundedEvidence !== true || evidence.g4PacketOnly === true ||
      evidence.g4SelfAttestationOnly === true) return 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED';
  const diversity = evidence.crossProviderModelDiversity;
  if (!diversity || typeof diversity.providerDifferent !== 'boolean' ||
      typeof diversity.modelDifferent !== 'boolean' || typeof diversity.sameModelFamily !== 'boolean' ||
      diversity.providerDifferent !== (g4.provider !== web.provider) ||
      diversity.modelDifferent !== (g4.canonical_model !== web.canonical_model)) {
    return 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED';
  }
  if (evidence.githubAuthority === true || evidence.acceptanceAuthority === true ||
      evidence.mergeAuthority === true || evidence.selectsWork === true ||
      !['CLEAR', 'CONCERN'].includes(evidence.verdict)) return 'SURFACE_TOPOLOGY_INVALID';
  return evidence.verdict;
}

test('A6-C3 uses a model-neutral technical G4 function and independent G4 assignment', () => {
  assertA6Terms([
    'technical G4 reviewer',
    'G4 is a technical-review function, not a structural model name',
    'provider, canonical base model, and reasoning independently',
    'may differ from the Web controller',
    'Historical model identities'
  ]);
  const evidence = temporaryEvidence();
  assert.equal(evidence.g4ExecutionIdentity.provider === evidence.webExecutionIdentity.provider, false);
  assert.equal(evidence.g4ExecutionIdentity.canonical_model === evidence.webExecutionIdentity.canonical_model, false);
  assert.equal(temporaryAssuranceGate(evidence), 'CLEAR');
});

test('A6-C3 requires exactly one fresh Temporary Chat after Web verification', () => {
  assertA6Terms(['exactly one fresh Web Temporary Chat', 'fresh for that head', 'same model family']);
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ freshTemporaryChatCount: 0 })), 'TEMPORARY_ASSURANCE_REQUIRED');
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ freshTemporaryChatCount: 2 })), 'TEMPORARY_ASSURANCE_REQUIRED');
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ webVerified: false })), 'WEB_VERIFICATION_REQUIRED');
});

test('A6-C3 Temporary Chat independently records identities and can return CONCERN after PASS', () => {
  const evidence = temporaryEvidence({ verdict: 'CONCERN' });
  assert.equal(temporaryAssuranceGate(evidence), 'CONCERN');
  assert.equal(evidence.g4Verdict, 'PASS');
  assert.ok(evidence.g4ExecutionIdentity.assignment_evidence);
  assert.ok(evidence.webExecutionIdentity.assignment_source);
  assert.deepEqual(evidence.crossProviderModelDiversity, {
    providerDifferent: true,
    modelDifferent: true,
    sameModelFamily: false
  });
});

test('A6-C3 same-family routes still require diversity records and fresh assurance', () => {
  const evidence = temporaryEvidence({
    g4ExecutionIdentity: executionIdentity({
      provider: 'provider-shared-synthetic',
      canonical_model: 'model-family-synthetic/g4'
    }),
    webExecutionIdentity: executionIdentity({
      provider: 'provider-shared-synthetic',
      canonical_model: 'model-family-synthetic/web',
      role: 'Web Temporary Chat assurance auditor',
      surface: 'web-temporary-chat',
      assignment_source: 'web-current-chat-synthetic'
    })
  });
  evidence.crossProviderModelDiversity = { providerDifferent: false, modelDifferent: true, sameModelFamily: true };
  assert.equal(temporaryAssuranceGate(evidence), 'CLEAR');
  assert.equal(temporaryAssuranceGate({ ...evidence, crossProviderModelDiversity: null }), 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED');
});

test('A6-C3 rejects packet-only, shared-context, and authority-bearing assurance', () => {
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ g4PacketOnly: true })), 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED');
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ separateContext: false })), 'SURFACE_TOPOLOGY_INVALID');
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ mergeAuthority: true })), 'SURFACE_TOPOLOGY_INVALID');
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ verdict: 'PASS' })), 'SURFACE_TOPOLOGY_INVALID');
  assertA6Terms(['not G5', 'does not replace G4', 'no GitHub']);
});

const invariantRequiredFields = [
  'invariant_id',
  'source_authority',
  'required_semantics',
  'candidate_evidence',
  'negative_test',
  'status',
  'authorising_design_lock'
];

const expectedInvariantBundles = {
  'AUTH-LEDGER-RECEIPT-001': {
    semantics: {
      matching_marker_and_run: 'The receipt marker and run identifier match the authorised operation.',
      processor_authored_receipt: 'The processor that performed the operation authors the receipt.',
      canonical_durable_readback: 'The receipt is read back from the canonical durable ledger surface.'
    },
    evidence: {
      matching_marker_and_run: ['marker', 'run_id', 'authorised_operation'],
      processor_authored_receipt: ['processor_id', 'receipt_author'],
      canonical_durable_readback: ['canonical_ledger_ref', 'durable_readback', 'readback_digest']
    }
  },
  'SCHEMA-EVAL-CANDIDATE-001': {
    semantics: {
      candidate_identity_and_result: 'The candidate records run_id, provider, base model, role, revision, result, and evidence.'
    },
    evidence: {
      candidate_identity_and_result: ['run_id', 'provider', 'base_model', 'role', 'revision', 'result', 'evidence']
    }
  },
  'SCOPE-GOV-TRACKING-001': {
    semantics: {
      authorised_repository: 'The repository is owned or explicitly authorised for the operation.',
      relevant_task_work: 'Relevant task work exists and is bound to the governed repository.'
    },
    evidence: {
      authorised_repository: ['repository', 'ownership_or_authorisation', 'authorisation_evidence'],
      relevant_task_work: ['task_id', 'relevant_work', 'scope_binding']
    }
  },
  'CONCURRENCY-GOV-WRITE-001': {
    semantics: {
      reread_and_bind: 'The actor rereads the current surface and binds its revision before preparing a write.',
      compare_and_preserve: 'The actor compares the bound revision and preserves unrelated content and order.',
      write_and_reread: 'The actor writes only after comparison and rereads the result to verify the bound update.'
    },
    evidence: {
      reread_and_bind: ['reread_revision', 'bound_revision'],
      compare_and_preserve: ['comparison_digest', 'unrelated_content_preserved', 'order_preserved'],
      write_and_reread: ['write_digest', 'post_write_readback', 'readback_revision']
    }
  },
  'REVIEW-STATE-RECONCILIATION-001': {
    semantics: {
      four_surface_reconciliation: 'Exact-head external-review completion is reconciled across the child body, PR body, exactly one parent entry, and one new parent chronology comment.',
      stale_state_blocks_progression: 'Missing or stale review state blocks the next prompt, technical G4, and finality.'
    },
    evidence: {
      four_surface_reconciliation: ['child_body', 'pr_body', 'parent_entry_count', 'parent_chronology_comment'],
      stale_state_blocks_progression: ['review_state_fresh', 'next_prompt_allowed', 'g4_allowed', 'finality_allowed']
    }
  },
  'G4-WEB-ASSURANCE-001': {
    semantics: {
      technical_function_and_independent_assignment: 'G4 is a technical-review function with an independently resolved provider, canonical model, and reasoning.',
      fresh_assurance_after_verification: 'Exactly one fresh Temporary Chat follows final exact-head PASS and independent Web verification.',
      bounded_non_authority: 'The Temporary Chat independently checks evidence, records both execution identities, returns only CLEAR or CONCERN, and has no finality or GitHub authority.'
    },
    evidence: {
      technical_function_and_independent_assignment: ['g4_role', 'g4_provider', 'g4_canonical_model', 'g4_reasoning', 'assignment_source'],
      fresh_assurance_after_verification: ['g4_verdict', 'final_exact_head', 'web_verified', 'fresh_temporary_chat_count'],
      bounded_non_authority: ['g4_execution_identity', 'web_execution_identity', 'independent_evidence', 'verdict', 'merge_authority']
    }
  },
  'EXECUTION-ADMISSION-DEFAULT-DENY-001': {
    semantics: {
      default_deny: 'Fast and Agent or spawn_agent delegation are denied without an exact current-turn grant.',
      bound_non_replayable_grant: 'A grant binds run, session, turn, operation, model, reasoning, count, expiry, consumption, and non-inheritance.',
      prelaunch_fail_closed: 'Supported ordinary spawning requires a trusted PreToolUse hook; missing or unverified coverage falls back to root-only Standard mode and SubagentStart is audit-only.'
    },
    evidence: {
      default_deny: ['allow_fast', 'allow_agents', 'grant_present', 'default_decision', 'explicit_current_turn_user_request'],
      bound_non_replayable_grant: ['issuer', 'explicit_current_turn_user_request', 'run_id', 'session_id', 'turn_id', 'operation', 'provider', 'canonical_model', 'reasoning', 'max_agents', 'expires_at', 'consumed', 'inheritance'],
      prelaunch_fail_closed: ['hook_installed', 'hook_event', 'hook_identity', 'hook_bytes', 'hook_version', 'hook_trust', 'runtime_coverage', 'subagent_start_audit_only']
    }
  }
};

function invariantRegistry() {
  const protocol = fs.readFileSync(path.join(mainRoot, 'protocol.md'), 'utf8');
  const match = protocol.match(/## Cumulative semantic invariant registry[\s\S]*?```json\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, 'cumulative invariant JSON registry is required');
  return JSON.parse(match[1]);
}

function invariantDecision(record, expected) {
  if (!record || invariantRequiredFields.some((field) => !Object.hasOwn(record, field))) return 'INVARIANT_REGRESSION';
  if (typeof record.invariant_id !== 'string' || typeof record.source_authority !== 'string' ||
      typeof record.negative_test !== 'string' || typeof record.authorising_design_lock !== 'string' ||
      !['preserved', 'amended', 'removed'].includes(record.status) ||
      !Array.isArray(record.required_semantics) || !Array.isArray(record.candidate_evidence)) {
    return 'INVARIANT_REGRESSION';
  }
  if (record.status !== 'preserved') {
    const change = record.design_lock_change;
    if (!change || change.invariant_id !== record.invariant_id ||
        typeof change.replacement_or_disposal !== 'string' || !change.replacement_or_disposal ||
        typeof change.rationale !== 'string' || !change.rationale) return 'INVARIANT_REGRESSION';
  }
  if (!expected) return 'INVARIANT_REGRESSION';
  const semantics = new Map(record.required_semantics.map((entry) => [entry && entry.semantic_id, entry]));
  const evidence = new Map(record.candidate_evidence.map((entry) => [entry && entry.semantic_id, entry]));
  for (const [semanticId, requirement] of Object.entries(expected.semantics)) {
    const semantic = semantics.get(semanticId);
    const candidate = evidence.get(semanticId);
    if (!semantic || semantic.requirement !== requirement || !candidate ||
        !Array.isArray(candidate.evidence_fields) ||
        JSON.stringify(candidate.evidence_fields) !== JSON.stringify(expected.evidence[semanticId])) {
      return 'INVARIANT_REGRESSION';
    }
  }
  if (semantics.size !== Object.keys(expected.semantics).length || evidence.size !== Object.keys(expected.evidence).length) {
    return 'INVARIANT_REGRESSION';
  }
  return 'PRESERVED';
}

test('A6-C4 registry is machine-checkable and contains the complete seeded invariant bundles', () => {
  assertA6Terms([
    'cumulative invariant',
    'INVARIANT_REGRESSION',
    'regression_of',
    'mechanical budget/format',
    'semantic-invariant preservation',
    'child body, PR body, exactly one parent entry, and one new parent chronology comment'
  ]);
  const registry = invariantRegistry();
  assert.equal(registry.schema, 'cumulative-invariant/v1');
  const records = new Map(registry.invariants.map((record) => [record.invariant_id, record]));
  for (const [id, expected] of Object.entries(expectedInvariantBundles)) {
    assert.ok(records.has(id), id + ' must be seeded');
    assert.equal(invariantDecision(records.get(id), expected), 'PRESERVED', id);
  }
});

test('A6-C4 partial and keyword-only invariant candidates fail with INVARIANT_REGRESSION', () => {
  const record = invariantRegistry().invariants.find((entry) => entry.invariant_id === 'CONCURRENCY-GOV-WRITE-001');
  const expected = expectedInvariantBundles[record.invariant_id];
  const partial = JSON.parse(JSON.stringify(record));
  partial.candidate_evidence = partial.candidate_evidence.filter((entry) => entry.semantic_id !== 'write_and_reread');
  assert.equal(invariantDecision(partial, expected), 'INVARIANT_REGRESSION');
  const keywordOnly = JSON.parse(JSON.stringify(record));
  keywordOnly.required_semantics[1] = { semantic_id: 'compare_and_preserve', requirement: 'preserve' };
  keywordOnly.candidate_evidence[1] = { semantic_id: 'compare_and_preserve', evidence_fields: ['preserve'] };
  assert.equal(invariantDecision(keywordOnly, expected), 'INVARIANT_REGRESSION');
});

test('A6-C4 amendment and removal require a named Design Lock change and regression_of survives history', () => {
  const record = invariantRegistry().invariants.find((entry) => entry.invariant_id === 'AUTH-LEDGER-RECEIPT-001');
  const expected = expectedInvariantBundles[record.invariant_id];
  const amended = JSON.parse(JSON.stringify(record));
  amended.status = 'amended';
  assert.equal(invariantDecision(amended, expected), 'INVARIANT_REGRESSION');
  amended.design_lock_change = {
    invariant_id: amended.invariant_id,
    replacement_or_disposal: 'replace only with an equivalent receipt contract',
    rationale: 'synthetic Design Lock test'
  };
  assert.equal(invariantDecision(amended, expected), 'PRESERVED');
  assert.match('regression_of: ' + record.invariant_id, /regression_of: AUTH-LEDGER-RECEIPT-001/);
});

const trustedPreToolUseHook = {
  installed: true,
  event: 'PreToolUse',
  matcher: ['Agent', 'spawn_agent'],
  version: 'prelaunch-agent/v1',
  bytes: 'sha256:hook-synthetic',
  trust: 'trusted',
  runtimeCoverage: ['ordinary-agent-spawn']
};

function admissionContext(overrides = {}) {
  return {
    run_id: 'run-synthetic',
    session_id: 'session-synthetic',
    turn_id: 'turn-synthetic',
    now: 1000,
    provider: 'provider-synthetic',
    canonical_model: 'model-synthetic',
    reasoning: 'reasoning-synthetic',
    ...overrides
  };
}

function structuredGrant(overrides = {}) {
  return {
    rawEvidence: true,
    issuer: 'web-orchestrator',
    explicit_current_turn_user_request: true,
    run_id: 'run-synthetic',
    session_id: 'session-synthetic',
    turn_id: 'turn-synthetic',
    operation: 'spawn_agent',
    allow_fast: false,
    allow_agents: true,
    max_agents: 1,
    provider: 'provider-synthetic',
    canonical_model: 'model-synthetic',
    reasoning: 'reasoning-synthetic',
    expires_at: 1100,
    consumed: false,
    inheritance: false,
    ...overrides
  };
}

function normaliseAdmissionOperation(operation) {
  return operation === 'Agent' || operation === 'spawn_agent' ? 'spawn_agent' : operation;
}

function grantMatches(request, context, grant) {
  if (!grant || grant.rawEvidence !== true || grant.issuer !== 'web-orchestrator' ||
      grant.explicit_current_turn_user_request !== true || grant.consumed !== false || grant.inheritance !== false ||
      request.inherited === true || grant.run_id !== context.run_id || grant.session_id !== context.session_id ||
      grant.turn_id !== context.turn_id || grant.operation !== normaliseAdmissionOperation(request.operation) ||
      grant.provider !== context.provider || grant.canonical_model !== context.canonical_model ||
      grant.reasoning !== context.reasoning || typeof grant.expires_at !== 'number' ||
      grant.expires_at <= context.now) return false;
  const operation = normaliseAdmissionOperation(request.operation);
  if (operation === 'fast' && grant.allow_fast !== true) return false;
  if (operation === 'spawn_agent' && (grant.allow_agents !== true ||
      !Number.isInteger(request.requestedAgentCount) || request.requestedAgentCount < 1 ||
      request.requestedAgentCount > grant.max_agents)) return false;
  return true;
}

function hookIsTrusted(hook) {
  return hook && hook.installed === true && hook.event === trustedPreToolUseHook.event &&
    Array.isArray(hook.matcher) && trustedPreToolUseHook.matcher.every((value) => hook.matcher.includes(value)) &&
    hook.version === trustedPreToolUseHook.version && hook.bytes === trustedPreToolUseHook.bytes &&
    hook.trust === trustedPreToolUseHook.trust && Array.isArray(hook.runtimeCoverage) &&
    hook.runtimeCoverage.includes('ordinary-agent-spawn');
}

function admissionDecision(request, context, grant, hook) {
  if (request.event === 'SubagentStart') {
    return { allowed: false, prevented: false, auditOnly: true, mode: 'AUDIT_ONLY', reason: 'AUDIT_ONLY' };
  }
  if (request.path === 'specialised' || request.bypass === true) {
    return { allowed: false, prevented: true, mode: 'ROOT_ONLY_STANDARD', reason: 'UNSUPPORTED_DELEGATION' };
  }
  const operation = normaliseAdmissionOperation(request.operation);
  const denied = (reason = 'ADMISSION_DENIED') => ({
    allowed: false,
    prevented: true,
    mode: 'ROOT_ONLY_STANDARD',
    reason
  });
  if (!grantMatches(request, context, grant)) return denied();
  if (operation === 'spawn_agent' && !hookIsTrusted(hook)) return denied('ROOT_ONLY_STANDARD');
  if (operation !== 'fast' && operation !== 'spawn_agent') return denied('UNSUPPORTED_DELEGATION');
  return {
    allowed: true,
    prevented: false,
    mode: operation === 'fast' ? 'FAST' : 'AGENT',
    reason: 'ADMITTED',
    grant: { ...grant, consumed: true }
  };
}

test('A6-C5 no grant denies Fast and Agent spawning', () => {
  const context = admissionContext();
  assert.equal(admissionDecision({ operation: 'fast' }, context, null, null).reason, 'ADMISSION_DENIED');
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, null, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 prompt omission and generic speed wording do not grant admission', () => {
  const context = admissionContext();
  const request = { operation: 'fast', promptText: 'please be fast and use agents' };
  assert.equal(admissionDecision(request, context, null, null).reason, 'ADMISSION_DENIED');
  assert.equal(admissionDecision({ operation: 'fast' }, context,
    structuredGrant({ operation: 'fast', allow_fast: true, explicit_current_turn_user_request: false }), null).reason, 'ADMISSION_DENIED');
  assertA6Terms(['Silence, prompt omission, generic speed wording', 'does not interpret natural-language speed phrases']);
});

test('A6-C5 stale grants are denied', () => {
  const context = admissionContext();
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context,
    structuredGrant({ expires_at: 1000 }), trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 exact current-turn grant allows only its bound operation', () => {
  const context = admissionContext();
  const grant = structuredGrant();
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant, trustedPreToolUseHook).allowed, true);
  assert.equal(admissionDecision({ operation: 'fast' }, context, grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 wrong run and session bindings are denied', () => {
  const grant = structuredGrant();
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, admissionContext({ run_id: 'other-run' }), grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, admissionContext({ session_id: 'other-session' }), grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 wrong provider, model, and reasoning bindings are denied', () => {
  const grant = structuredGrant();
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, admissionContext({ provider: 'other-provider' }), grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, admissionContext({ canonical_model: 'other-model' }), grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, admissionContext({ reasoning: 'other-reasoning' }), grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 excess agent count is denied', () => {
  const context = admissionContext();
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 2 }, context, structuredGrant({ max_agents: 1 }), trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 inherited grants are denied', () => {
  const context = admissionContext();
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1, inherited: true }, context, structuredGrant(), trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, structuredGrant({ inheritance: true }), trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 consumed grants cannot be replayed', () => {
  const context = admissionContext();
  const first = admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, structuredGrant(), trustedPreToolUseHook);
  assert.equal(first.allowed, true);
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, first.grant, trustedPreToolUseHook).reason, 'ADMISSION_DENIED');
});

test('A6-C5 explicitly authorised Fast is not blocked', () => {
  const context = admissionContext();
  const grant = structuredGrant({ operation: 'fast', allow_fast: true, allow_agents: false });
  const result = admissionDecision({ operation: 'fast' }, context, grant, null);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, 'FAST');
});

test('A6-C5 SubagentStart is audit-only and cannot satisfy pre-launch prevention', () => {
  const context = admissionContext();
  const grant = structuredGrant();
  const result = admissionDecision({ event: 'SubagentStart', operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant, trustedPreToolUseHook);
  assert.deepEqual(result, { allowed: false, prevented: false, auditOnly: true, mode: 'AUDIT_ONLY', reason: 'AUDIT_ONLY' });
});

test('A6-C5 missing or untrusted PreToolUse hook falls back to root-only Standard', () => {
  const context = admissionContext();
  const grant = structuredGrant();
  assert.deepEqual(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant, null), {
    allowed: false,
    prevented: true,
    mode: 'ROOT_ONLY_STANDARD',
    reason: 'ROOT_ONLY_STANDARD'
  });
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant,
    { ...trustedPreToolUseHook, trust: 'untrusted' }).mode, 'ROOT_ONLY_STANDARD');
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant,
    { ...trustedPreToolUseHook, installed: false }).mode, 'ROOT_ONLY_STANDARD');
});

test('A6-C5 specialised or bypass launch paths cannot silently bypass admission', () => {
  const context = admissionContext();
  const result = admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1, path: 'specialised' }, context, structuredGrant(), trustedPreToolUseHook);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'UNSUPPORTED_DELEGATION');
  assert.equal(result.mode, 'ROOT_ONLY_STANDARD');
});

test('A6-C5 source contract keeps hook installation host-specific and source-only', () => {
  assertA6Terms([
    'trusted pre-launch `PreToolUse` hook',
    '`SubagentStart` is audit-only',
    'root-only Standard',
    'does not install, activate, or claim that a native host hook is operational'
  ]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8')).surface.publish_as, 'source_only');
});
