'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const n5 = require('../scripts/toolkit-github-governance-review-reconciler.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const otherRepository = 'other/repo';
const repositoryId = '1'.repeat(64);
const candidate = { pr_number: 355, head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) };

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

function body(state = parentState()) {
  return 'owner-before\n' + n5.renderManagedBlock('parent', state) + 'owner-after\n';
}

function authority(counter = null) {
  return {
    authorize({ operation }) {
      if (counter) counter.value += 1;
      return {
        decision: 'allow',
        operation_type: operation.type,
        operation_digest: a1.operationDigest(operation),
        target_digest: a1.targetDigest(operation),
      };
    },
  };
}

function canonicalA2(options = {}) {
  const canonicalRepository = options.canonicalRepository || repository;
  const id = options.repositoryId || repositoryId;
  const canonicalRemote = 'https://github.com/' + canonicalRepository + '.git';
  const identity = {
    valid: true,
    repository_id: id,
    canonical_remote: canonicalRemote,
    ...(options.identity || {}),
  };
  const status = {
    status: 'healthy',
    actionable: false,
    repository_id: id,
    canonical_remote: canonicalRemote,
    capabilities: { 'repository.governance': { state: 'enabled' } },
    ...(options.status || {}),
  };
  const counters = options.counters || null;
  return {
    resolveRepositoryIdentity() {
      if (counters) counters.identity += 1;
      return identity;
    },
    getRepositoryStatus() {
      if (counters) counters.status += 1;
      return status;
    },
  };
}

function githubAdapter(initialBody) {
  let current = initialBody;
  let reads = 0;
  let writes = 0;
  return {
    getParent() {
      reads += 1;
      return { body: current, complete: true, revision: 'r' + reads };
    },
    updateParent(payload) {
      writes += 1;
      current = payload.body;
      return { accepted: true };
    },
    get values() {
      return { current, reads, writes };
    },
  };
}

function reconcileInput(repositoryValue = repository) {
  return {
    repository: repositoryValue,
    parent_issue: 240,
    target: { child_id: 'child-1' },
    update: { type: 'set_field', field: 'owner_detail', value: 'Run-183 bounded repair' },
    accepted_preview: true,
  };
}

function runtime(initialBody, options = {}) {
  return n5.createRuntime({
    repository: options.repository || repository,
    cwd: options.cwd || process.cwd(),
    authority_broker: options.authority_broker || authority(),
    a2: options.a2 || canonicalA2({ canonicalRepository: options.canonicalRepository || repository, repositoryId: options.canonicalId || repositoryId }),
    github: options.github || githubAdapter(initialBody),
    ...(Object.prototype.hasOwnProperty.call(options, 'repository_id') ? { repository_id: options.repository_id } : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'repository_identity') ? { repository_identity: options.repository_identity } : {}),
  });
}

function terminalItem(prState = 'merged', objectiveStatus = 'completed') {
  return {
    child_id: 'done',
    issue_number: 321,
    lifecycle: 'terminal',
    implementation_pr: { number: 355, state: prState },
    objective_status: objectiveStatus,
    outcome: objectiveStatus === 'disposed' ? 'Disposed without delivery' : 'Delivered safely',
  };
}

function acceptedEvidence(item, overrides = {}) {
  const proof = {
    server_authoritative: true,
    verifiable: true,
    complete: true,
    child_id: item.child_id,
    child_issue: item.issue_number,
    disposition: 'accepted',
    outcome: item.outcome,
    parent_chronology_ref: 'issue/240#run-183',
    pr: { number: 355, state: item.implementation_pr?.state, public_source_ref: 'pull/355' },
    accepted_commit: { sha: 'd'.repeat(40), public_source_ref: 'commit/dddddddd' },
    ...overrides,
  };
  proof.evidence_digest = null;
  proof.evidence_digest = n5.durableEvidenceDigest(item, proof);
  return proof;
}

function completedWithEvidence(item = terminalItem()) {
  const proof = acceptedEvidence(item);
  return { ...item, durable_evidence: proof, durable_evidence_digest: proof.evidence_digest };
}

function allPredicates(value = true) {
  return Object.fromEntries(n5.A4_MATERIAL_PREDICATES.map((key) => [key, value]));
}

function canonicalFinding(overrides = {}) {
  return {
    id: 'finding-183',
    provenance: {
      source_pr: candidate.pr_number,
      source_thread: 'thread-183',
      source_candidate: candidate,
      path: 'repo/scripts/example.cjs',
      line: 183,
      public_source_ref: 'pull/355#thread-183',
    },
    component: 'review-boundary',
    text: 'Public-safe current candidate failure evidence.',
    predicates: allPredicates(true),
    exclusions: [],
    ...overrides,
  };
}

function classifyInput(overrides = {}) {
  return {
    id: 'finding-183',
    source_pr: candidate.pr_number,
    source_thread: 'thread-183',
    source_candidate: candidate,
    component: 'review-boundary',
    text: 'Public-safe current candidate failure evidence.',
    path: 'repo/scripts/example.cjs',
    line: 183,
    public_source_ref: 'pull/355#thread-183',
    predicates: allPredicates(true),
    exclusions: [],
    ...overrides,
  };
}

function legacyBody(version = n5.LEGACY_V0_VERSION, extra = '') {
  return 'legacy-prefix\n'
    + '## Queue authority\n'
    + '- Repository: ' + repository + '\n'
    + '- Parent issue: #240\n'
    + '- Legacy tracker version: ' + version + '\n'
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
    + '- Required: yes\n'
    + extra;
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

test('Run-183 root 1 binds canonical A2 identity before A1 or GitHub access', () => {
  const cases = [
    {
      label: 'canonical repository mismatch',
      repositoryValue: otherRepository,
      a2: canonicalA2(),
      expected: 'N5_REPOSITORY_IDENTITY_MISMATCH',
    },
    {
      label: 'missing canonical A2',
      repositoryValue: repository,
      a2: {},
      expected: 'N5_CONSENT_REQUIRED',
    },
    {
      label: 'malformed canonical A2 identity',
      repositoryValue: repository,
      a2: canonicalA2({ identity: { repository_id: 'malformed' } }),
      expected: 'N5_CONSENT_REQUIRED',
    },
    {
      label: 'unresolved canonical A2 identity',
      repositoryValue: repository,
      a2: canonicalA2({ identity: { valid: false } }),
      expected: 'N5_CONSENT_REQUIRED',
    },
    {
      label: 'disabled governance consent',
      repositoryValue: repository,
      a2: canonicalA2({ status: { capabilities: { 'repository.governance': { state: 'disabled' } } } }),
      expected: 'N5_CONSENT_REQUIRED',
    },
  ];
  for (const item of cases) {
    const brokerCalls = { value: 0 };
    const github = githubAdapter(body());
    const result = runtime(github.values.current, {
      repository: item.repositoryValue,
      a2: item.a2,
      authority_broker: authority(brokerCalls),
      github,
    }).reconcile(reconcileInput(item.repositoryValue));
    assert.equal(result.code, item.expected, item.label);
    assert.equal(brokerCalls.value, 0, item.label + ' broker access');
    assert.equal(github.values.reads, 0, item.label + ' GitHub access');
    assert.equal(github.values.writes, 0, item.label + ' GitHub writes');
  }

  const callerIdCounters = { identity: 0, status: 0 };
  const callerIdGithub = githubAdapter(body());
  const callerIdResult = runtime(callerIdGithub.values.current, {
    a2: canonicalA2({ counters: callerIdCounters }),
    repository_id: '2'.repeat(64),
    authority_broker: authority(),
    github: callerIdGithub,
  }).reconcile(reconcileInput());
  assert.equal(callerIdResult.code, 'N5_REPOSITORY_IDENTITY_MISMATCH');
  assert.equal(callerIdCounters.identity, 0);
  assert.equal(callerIdCounters.status, 0);
  assert.equal(callerIdGithub.values.reads, 0);
  assert.equal(callerIdGithub.values.writes, 0);

  let brokerCalls = 0;
  const github = githubAdapter(body());
  const exact = runtime(github.values.current, {
    a2: canonicalA2(),
    authority_broker: { authorize(args) { brokerCalls += 1; return authority().authorize(args); } },
    github,
  }).reconcile(reconcileInput());
  assert.equal(exact.code, 'N5_RECONCILED');
  assert.equal(brokerCalls, 1);
  assert.ok(github.values.reads >= 1);
  assert.equal(github.values.writes, 1);
});

test('Run-183 root 2 requires accepted child completion evidence, not a merged PR alone', () => {
  const withoutEvidence = terminalItem('merged');
  assert.equal(n5.validateTracker(parentState({ terminal: [withoutEvidence] })).code, 'N5_GOVERNANCE_UNREADY');

  const valid = completedWithEvidence(withoutEvidence);
  assert.equal(n5.validateTracker(parentState({ terminal: [valid] })).ok, true);

  const forgedEvidence = {
    ...valid,
    durable_evidence: { ...valid.durable_evidence, outcome: 'forged outcome' },
  };
  assert.equal(n5.validateTracker(parentState({ terminal: [forgedEvidence] })).code, 'N5_GOVERNANCE_UNREADY');

  const forgedDigest = { ...valid, durable_evidence_digest: '0'.repeat(64) };
  assert.equal(n5.validateTracker(parentState({ terminal: [forgedDigest] })).code, 'N5_GOVERNANCE_UNREADY');

  for (const prState of ['closed_unmerged', 'failed', 'superseded']) {
    const failedLineage = completedWithEvidence(terminalItem(prState));
    assert.equal(n5.validateTracker(parentState({ terminal: [failedLineage] })).code, 'N5_GOVERNANCE_UNREADY', prState);
  }

  const disposed = terminalItem('closed_unmerged', 'disposed');
  assert.equal(n5.validateTracker(parentState({ terminal: [disposed] })).ok, true);

  const currentMerged = parentState({
    current_work: [{ ...parentState().current_work[0], implementation_pr: { number: 355, state: 'merged' } }],
  });
  assert.equal(n5.validateTracker(currentMerged).ok, true);
});

test('Run-183 root 3 derives A4 materiality at every finding and Deferred Finding ingress', () => {
  const contradictoryMaterial = canonicalFinding({ materiality: 'nonblocking' });
  assert.equal(n5.normalizeFindingEvidence(contradictoryMaterial), null);
  assert.equal(n5.registerDeferredFinding({
    finding: contradictoryMaterial,
    parent: parentState(),
    triggers: n5.DF_TRIGGERS,
  }).code, 'N5_DF_AMBIGUOUS');

  const contradictoryNonmaterial = canonicalFinding({
    predicates: { ...allPredicates(true), material_impact: false },
    materiality: 'material',
  });
  assert.equal(n5.normalizeFindingEvidence(contradictoryNonmaterial), null);

  const derivedInput = canonicalFinding({
    predicates: { ...allPredicates(true), concrete_current_failure: false },
  });
  const direct = n5.normalizeFindingEvidence(derivedInput);
  assert.equal(direct.materiality, 'nonblocking');

  const classified = n5.classifyFinding(classifyInput({
    predicates: { ...allPredicates(true), concrete_current_failure: false },
  }));
  assert.equal(classified.ok, true);
  assert.equal(classified.finding.materiality, direct.materiality);

  const registered = n5.registerDeferredFinding({
    finding: direct,
    parent: parentState(),
    triggers: n5.DF_TRIGGERS,
  });
  assert.equal(registered.code, 'N5_DF_REGISTERED');
  assert.equal(registered.record.materiality, direct.materiality);

  const forgedEvidence = n5.registerDeferredFinding({
    finding: { ...direct, evidence_digest: '0'.repeat(64) },
    parent: parentState(),
    triggers: n5.DF_TRIGGERS,
  });
  assert.equal(forgedEvidence.code, 'N5_DF_AMBIGUOUS');

  const forgedRoot = n5.registerDeferredFinding({
    finding: { ...direct, root_digest: '0'.repeat(64) },
    parent: parentState(),
    triggers: n5.DF_TRIGGERS,
  });
  assert.equal(forgedRoot.code, 'N5_DF_AMBIGUOUS');

  assert.equal(n5.validateDeferredFindingRecord({ ...registered.record, evidence_digest: '0'.repeat(64) }).code, 'N5_DF_AMBIGUOUS');
  assert.equal(n5.validateDeferredFindingRecord({ ...registered.record, root_digest: '0'.repeat(64) }).code, 'N5_DF_AMBIGUOUS');
});

test('Run-183 root 4 initialise is unmanaged-only and migrate remains exact', () => {
  const desired = parentState();

  const exactLegacyGithub = githubAdapter(legacyBody());
  const exactLegacy = runtime(exactLegacyGithub.values.current, { github: exactLegacyGithub }).initialise(initialiseInput(desired));
  assert.equal(exactLegacy.code, 'N5_SCOPE_REJECTED');
  assert.equal(exactLegacy.migration_required, true);
  assert.equal(exactLegacyGithub.values.writes, 0);

  for (const source of [legacyBody(n5.LEGACY_V0_VERSION, '## Extra\n'), 'owner\n## Queue authority\n- Repository: ' + repository + '\n']) {
    const github = githubAdapter(source);
    const result = runtime(source, { github }).initialise(initialiseInput(desired));
    assert.equal(result.ok, false);
    assert.ok(['PARENT_PARSE_UNCERTAIN', 'N5_SCOPE_REJECTED'].includes(result.code));
    assert.equal(github.values.writes, 0);
  }

  const unmanaged = 'owner-before\nunmanaged owner bytes\n';
  const unmanagedGithub = githubAdapter(unmanaged);
  const created = runtime(unmanaged, { github: unmanagedGithub }).initialise(initialiseInput(desired));
  assert.equal(created.code, 'N5_RECONCILED');
  assert.equal(unmanagedGithub.values.writes, 1);
  assert.match(unmanagedGithub.values.current, /^owner-before\nunmanaged owner bytes\n/);
  assert.equal(unmanagedGithub.values.current.split(n5.MANAGED_MARKERS.parent.begin).length - 1, 1);
  assert.equal(unmanagedGithub.values.current.split(n5.MANAGED_MARKERS.parent.end).length - 1, 1);

  const validBody = body(desired);
  const validGithub = githubAdapter(validBody);
  const noop = runtime(validBody, { github: validGithub }).initialise(initialiseInput(desired));
  assert.equal(noop.code, 'N5_NOOP');
  assert.equal(validGithub.values.writes, 0);
  assert.equal(validGithub.values.current, validBody);

  const legacy = legacyBody();
  const parsedLegacy = n5.parseLegacyParent(legacy, { complete: true });
  assert.equal(parsedLegacy.ok, true);
  const migrateGithub = githubAdapter(legacy);
  const migrated = runtime(legacy, { github: migrateGithub }).migrate({
    repository,
    parent_issue: 240,
    target: {
      kind: n5.MUTATION_TARGET_KINDS.legacy_parent_block,
      source_version: n5.LEGACY_V0_VERSION,
      source_body_digest: n5.sha256(legacy),
    },
    update: { type: 'set_parent_state', state: parsedLegacy.state },
    accepted_preview: true,
  });
  assert.equal(migrated.code, 'N5_RECONCILED');
  assert.equal(migrateGithub.values.writes, 1);
  assert.equal(n5.parseManagedBlock(migrateGithub.values.current, 'parent', { complete: true }).ok, true);
  assert.equal(migrateGithub.values.current.split(n5.MANAGED_MARKERS.parent.begin).length - 1, 1);
});