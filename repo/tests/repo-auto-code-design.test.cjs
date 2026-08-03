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
const mergeCommit = '6c266962dcc423996dcc618612321b2fdf5712c3';
const mergeTree = 'c7aae93052b812ae067fc8143db9deb3f7ad0380';
const sourceLockBlob = '6d79d0c7fd12f2212ae7925befc8955398a3bde8';
const designLockChain = [
  'DL-329-AUTO-CODE-005',
  'DL-329-AUTO-CODE-005-A1',
  'DL-329-AUTO-CODE-005-A2',
  'DL-329-AUTO-CODE-005-A3',
  'DL-329-AUTO-CODE-005-A4',
  'DL-329-AUTO-CODE-005-A5',
  'DL-329-AUTO-CODE-005-A6',
  'DL-329-AUTO-CODE-005-A6-C2',
  'DL-329-AUTO-CODE-005-A6-C3',
  'DL-329-AUTO-CODE-005-A6-C4',
  'DL-329-AUTO-CODE-005-A6-C5'
];

// This inventory is trusted evidence from the base tree, not a projection of the candidate checkout.
const trustedBaseFixtureInventory = Object.freeze({
  source: 'base-tree-fixture-inventory',
  commit: mergeCommit,
  tree: mergeTree,
  names: Object.freeze([
    'invalid-active-or-duplicate-scheduler.json',
    'invalid-ambiguous-scheduler.json',
    'invalid-baseline-section-order.json',
    'invalid-body-comment-disagreement.json',
    'invalid-bullet-checkbox-style.json',
    'invalid-caller-supplied-lease-fields.json',
    'invalid-child-duplicate-lifecycle.json',
    'invalid-child-missing-lifecycle.json',
    'invalid-competing-category-subqueues.json',
    'invalid-concurrent-edit-after-write.json',
    'invalid-concurrent-edit-before-write.json',
    'invalid-cross-repository-scheduler-receipt.json',
    'invalid-crossed-handoff-markers.json',
    'invalid-current-item-active.json',
    'invalid-disabled-scheduler.json',
    'invalid-duplicate-canonical-parents.json',
    'invalid-duplicate-claims.json',
    'invalid-duplicate-ote-eto-markers.json',
    'invalid-duplicate-packets.json',
    'invalid-duplicate-parent-entry.json',
    'invalid-duplicate-scheduler.json',
    'invalid-final-audit-bypassed-blocked.json',
    'invalid-final-audit-not-last.json',
    'invalid-final-audit-reordered.json',
    'invalid-final-audit-selected-early.json',
    'invalid-final-live-prompt.json',
    'invalid-generic-consent-only.json',
    'invalid-governance-parent-baseline.json',
    'invalid-governance-pending-reconciliation.json',
    'invalid-governance-repository-mismatch.json',
    'invalid-governance-skill-missing.json',
    'invalid-governance-skill-unhealthy.json',
    'invalid-head-mismatch.json',
    'invalid-incomplete-review-sweep.json',
    'invalid-incomplete-teardown.json',
    'invalid-live-prompt-after-completion.json',
    'invalid-lying-read-back-exact.json',
    'invalid-lying-surfaces-agree.json',
    'invalid-malformed-agents-block.json',
    'invalid-missing-exact-head-evidence.json',
    'invalid-missing-github-issue-governance.json',
    'invalid-missing-handoff-marker.json',
    'invalid-missing-parent-chronology.json',
    'invalid-missing-parent-entry.json',
    'invalid-missing-provider-routing.json',
    'invalid-missing-repo-auto-code.json',
    'invalid-missing-skill.json',
    'invalid-missing-valid-open-reviews.json',
    'invalid-nested-handoff-markers.json',
    'invalid-next-action-mismatch.json',
    'invalid-non-atomic-claim.json',
    'invalid-ordinary-executor-self-setup.json',
    'invalid-out-of-order-handoff-markers.json',
    'invalid-parent-child-pr-status-mismatch.json',
    'invalid-partial-publication.json',
    'invalid-paused-scheduler.json',
    'invalid-pending-child-uat-material-obligation.json',
    'invalid-pending-user-action.json',
    'invalid-progression-during-parent-reconciliation.json',
    'invalid-secret-prompt.json',
    'invalid-stale-g4.json',
    'invalid-substantive-execution-during-reconciliation.json',
    'invalid-surface-disagreement-at-completion.json',
    'invalid-terminal-item-nonterminal.json',
    'invalid-unauthorised-final-audit-change.json',
    'invalid-unauthorised-queue-reorder.json',
    'invalid-unrelated-parent-content-changed.json',
    'invalid-unverifiable-missing-scheduler.json',
    'invalid-valid-mutation-unrelated-drift.json',
    'invalid-wrong-current-turn.json',
    'valid-active-to-current.json',
    'valid-blocked-first-skip.json',
    'valid-completion-finality.json',
    'valid-current-to-completed.json',
    'valid-exact-dual-scheduler-removal.json',
    'valid-existing-pr-adoption.json',
    'valid-final-audit-after-terminal-work.json',
    'valid-first-eligible-pickup.json',
    'valid-first-run.json',
    'valid-four-surface-reconciliation.json',
    'valid-governance-readiness.json',
    'valid-owner-authorised-final-audit-change.json',
    'valid-parallel-prs.json',
    'valid-processed-prompt.json',
    'valid-same-pr-fast-forward.json'
  ].sort())
});

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

function declaredClassification(fixture) {
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

function classification(fixture) {
  return deriveDecision(fixture);
}

function allEqual(values) {
  return values.length > 0 && values.every((value) => value === values[0]);
}

function hasOwnValues(value, keys) {
  return value && typeof value === 'object' && keys.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function equalSurfaceValues(surfaces, requiredKeys) {
  if (!surfaces || typeof surfaces !== 'object' || Object.keys(surfaces).sort().join('|') !== requiredKeys.join('|')) {
    return false;
  }
  const values = requiredKeys.map((key) => surfaces[key]);
  return values.every((value) => value !== undefined && value !== null && value !== '') && allEqual(values.map((value) => JSON.stringify(value)));
}

function rawEvidenceDecision(fixture) {
  const evidence = fixture.evidence;
  if (!evidence || evidence.rawEvidence !== true) return false;
  const proof = evidence.proof;

  switch (fixture.scenario) {
    case 'explicit-activation':
      return proof && proof.grant === 'exact' && nonEmptyString(proof.repository) &&
        nonEmptyString(proof.scope) && proof.rootClaim === 'one' && proof.webIssued === true;
    case 'bounded-mutation':
      return proof && proof.exactAllowlist === true && proof.sourceLockUnchanged === true &&
        Array.isArray(proof.outputs) && proof.outputs.length === 0 &&
        Array.isArray(proof.allowedWrites) && proof.allowedWrites.length === 0 && proof.nonForceCommit === true;
    case 'amendment-g4':
      return proof && proof.priorHeadInvalidated === true && proof.freshG4 === true &&
        proof.applicableFindingsPreserved === true && proof.sameRootCauseCount === 1;
    case 'evaluation-staging':
      return proof && proof.publicSafe === true && proof.sourceRevisionBound === true &&
        proof.privateIdentifiers === false && proof.scores === false && proof.ledgerWrite === false;
    case 'g4-pass-return':
      return proof && proof.g4Verdict === 'PASS' && proof.authoritativeVerdictCount === 1 &&
        proof.webAdjudicated === true && proof.mergeAuthorised === false;
    case 'interrupted-recovery':
      return proof && proof.priorActivityStopped === true && proof.expiryTransfersOwnership === false &&
        proof.newExactGrant === true && proof.freshIsolation === true;
    case 'pilot-containment':
      return proof && nonEmptyString(proof.namedPilot) && proof.activePilots === 1 &&
        proof.crossRepositoryFanout === false && proof.secondPilot === false;
    case 'distinct-grants':
      return proof && nonEmptyString(proof.designMergeGrant) && nonEmptyString(proof.installationGrant) &&
        nonEmptyString(proof.closureLeaseGrant) && nonEmptyString(proof.pilotGrant) && proof.nonInterchangeable === true;
    case 'runtime-neutral-route':
      return proof && [
        'provider',
        'canonicalBaseModel',
        'reasoningOrEffort',
        'referenceFamilyReasoningEquivalent',
        'solEquivalentReasoning',
        'harnessAdapter',
        'surface',
        'role',
        'exactAuthority'
      ].every((key) => nonEmptyString(proof[key])) &&
        proof.fastMode === 'prohibited' && proof.substitution === 'prohibited' && proof.capabilityProof === true;
    case 'assurance-clear':
      return proof && proof.g4Verdict === 'PASS' && proof.webAdjudicated === true &&
        proof.assuranceVerdict === 'CLEAR' && proof.authoritativeG4Count === 1 &&
        proof.mergeAuthorisedByAssurance === false;
    case 'lifecycle-transition': {
      const transition = evidence.transition;
      return transition && transition.atomic === true &&
        ((transition.before === 'ACTIVE' && transition.after === 'CURRENT') ||
          (transition.before === 'CURRENT' && transition.after === 'COMPLETED')) &&
        equalSurfaceValues(evidence.surfaces, ['child', 'chronology', 'parentEntry', 'pr']) &&
        evidence.parentEntryCount === 1 && evidence.chronologyCommentsAdded === 1 &&
        (transition.after !== 'COMPLETED' || evidence.nextTask === null);
    }
    case 'completion-finality':
    case 'final-audit':
      return Array.isArray(evidence.lifecycleSections) && evidence.lifecycleSections.length > 0 &&
        evidence.allSectionsTerminal === true && evidence.precedingWorkTerminal === true &&
        evidence.materialChildOccurrences === 1 &&
        (fixture.scenario !== 'completion-finality' || evidence.nextTask === null);
    case 'four-surface-reconciliation': {
      const surfaces = evidence.surfaces;
      if (!surfaces || Object.keys(surfaces).sort().join('|') !== 'child|chronology|parentEntry|pr') return false;
      const values = Object.values(surfaces);
      return values.every((surface) => surface && nonEmptyString(surface.revision) && nonEmptyString(surface.body)) &&
        allEqual(values.map((surface) => JSON.stringify(surface))) && evidence.parentEntryCount === 1 &&
        evidence.chronologyCommentsAdded === 1 && evidence.unrelatedContentPreserved === true &&
        evidence.compareAndPreserve === true;
    }
    case 'governance-readiness': {
      const surfaces = [evidence.child, evidence.pr, evidence.parentEntry, evidence.chronology];
      return surfaces.every((surface) => surface && nonEmptyString(surface.authority) && nonEmptyString(surface.status)) &&
        allEqual(surfaces.map((surface) => surface.authority)) && evidence.readinessDerived === true &&
        evidence.projectionUsed === false;
    }
    default:
      return false;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function validParentLifecycle(parent) {
  const expectedSections = ['Queue authority', 'Current execution', 'Active queue', 'Completed or disposed', 'Completion gate', 'Governance ownership', 'Mandatory parent reconciliation'];
  if (!parent || parent.parentEntryCount !== 1 || !Array.isArray(parent.sectionOrder) ||
      !Array.isArray(parent.subqueues) || parent.subqueues.length !== 0 ||
      !parent.linesBySection || !parent.lifecycleEntries || !parent.expectedLifecycle ||
      !Array.isArray(parent.materialChildren) ||
      JSON.stringify(parent.sectionOrder) !== JSON.stringify(expectedSections)) return false;
  if (parent.reorder && (parent.reorder.changed !== false || parent.reorder.authorized !== true)) return false;
  const lifecycleSections = ['Current execution', 'Active queue', 'Completed or disposed'];
  const entries = lifecycleSections.flatMap((section) => parent.lifecycleEntries[section] || []);
  if (entries.length !== parent.materialChildren.length || new Set(entries).size !== entries.length ||
      new Set(parent.materialChildren).size !== parent.materialChildren.length ||
      entries.some((entry) => !parent.materialChildren.includes(entry))) return false;
  for (const child of parent.materialChildren) {
    const sections = lifecycleSections.filter((section) => (parent.lifecycleEntries[section] || []).includes(child));
    if (sections.length !== 1 || parent.expectedLifecycle[child] !== sections[0]) return false;
  }
  const currentLines = parent.linesBySection['Current execution'] || [];
  const activeLines = parent.linesBySection['Active queue'] || [];
  const completedLines = parent.linesBySection['Completed or disposed'] || [];
  return currentLines.every((line) => /^- (?!\[)/.test(line)) &&
    activeLines.every((line) => /^- (?!\[)/.test(line)) &&
    completedLines.every((line) => /^- \[x\] /.test(line));
}

function validGovernanceReadiness(state) {
  const repository = state.repository;
  const capabilities = state.capabilities || {};
  const skill = state.governanceSkill;
  const parent = state.canonicalParent;
  return Boolean(repository && repository.owner === 'weijunswj' && repository.name === 'ai-agent-toolkit' &&
    repository.immutableId === 'repo-299' && repository.defaultBranch === 'main' &&
    capabilities.github_issue_governance === 'enabled' && capabilities.repo_auto_code === 'enabled' &&
    skill && skill.id === '#299' && skill.installed === true && skill.healthy === true && skill.inspectable === true &&
    parent && parent.count === 1 && parent.structure && Array.isArray(parent.structure.materialChildren) &&
    parent.structure.materialChildren.length > 0 &&
    validParentLifecycle(parent.structure));
}

function validFinalAuditState(state) {
  const queue = state.parent && state.parent.activeQueue;
  if (!Array.isArray(queue) || state.selectedChild === undefined || state.moved !== false ||
      state.reordered !== false || state.bypassedBlocked !== false || queue.length === 0) return false;
  const finalIndexes = queue.map((entry, index) => entry.finalAudit === true ? index : -1).filter((index) => index >= 0);
  if (finalIndexes.length !== 1 || finalIndexes[0] !== queue.length - 1 || state.selectedChild !== queue[finalIndexes[0]].child) return false;
  return queue.slice(0, finalIndexes[0]).every((entry) => entry.terminal === true) &&
    queue[finalIndexes[0]].terminal === false;
}

function validReconciliationState(reconciliation) {
  if (!reconciliation || reconciliation.materialTransition !== true) return false;
  const surfaces = reconciliation.surfaces;
  const surfaceKeys = ['child', 'chronology', 'parentEntry', 'pr'];
  if (!surfaces || Object.keys(surfaces).sort().join('|') !== surfaceKeys.join('|') ||
      Object.values(surfaces).some((surface) => !surface || Object.keys(surface).length === 0)) return false;
  const surfaceValues = Object.values(surfaces).map((surface) => JSON.stringify(canonicalJson(surface)));
  const binding = reconciliation.binding;
  const preservation = reconciliation.preservation;
  if (!binding || !preservation || !allEqual(surfaceValues) ||
      binding.parentEntryCount !== 1 || binding.chronologyCommentsAdded !== 1 ||
      binding.boundRevision !== binding.revisionBeforeWrite ||
      binding.revisionBeforeWrite !== binding.revisionAfterWrite ||
      binding.revisionAfterWrite !== binding.readBackRevision ||
      binding.rowPositionBefore !== binding.rowPositionAfter ||
      binding.afterBodyDigest !== binding.readBackBodyDigest ||
      binding.partialWrite !== false || binding.concurrentBeforeWrite !== false || binding.concurrentAfterWrite !== false) return false;
  return JSON.stringify(canonicalJson(preservation.before)) === JSON.stringify(canonicalJson(preservation.after));
}

function validCompletionState(state) {
  const reviewSweep = state.reviewSweep;
  const checks = state.checks;
  const exactHead = state.exactHead;
  const obligations = state.obligations;
  const prompt = state.prompt;
  return reviewSweep && reviewSweep.complete === true && Number.isInteger(reviewSweep.validOpenReviews) && reviewSweep.validOpenReviews === 0 &&
    Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.required === true && check.completed === true && check.conclusion === 'PASS') &&
    state.protocolEvidence && state.protocolEvidence.independent === true && state.protocolEvidence.ledgerOnly === false &&
    exactHead && exactHead.reviewedHead === exactHead.currentHead && exactHead.readBack === true &&
    state.controllerGate === 'CONTROLLER_ACCEPTED' && prompt && prompt.live === false && prompt.processed === true &&
    state.pendingResult === false && obligations && Object.values(obligations).every((value) => value === false) &&
    (!state.mergePrerequisites || (state.mergePrerequisites.complete === true && state.mergePrerequisites.baseVerified === true &&
      state.mergePrerequisites.headVerified === true && state.mergePrerequisites.noConflicts === true)) &&
    (!state.reconciliation || validReconciliationState(state.reconciliation));
}

function deriveDecision(fixture) {
  if (fixture.evidence) return Boolean(rawEvidenceDecision(fixture));

  const state = fixture.state || {};
  if (fixture.scenario === 'owner_authorised_final_audit_change') {
    const queue = Array.isArray(state.parent && state.parent.activeQueue) ? state.parent.activeQueue : [];
    return state.selectedChild === '#251' && state.moved === false && state.reordered === false &&
      state.bypassedBlocked === false && state.declarationChange && state.declarationChange.requested === true &&
      state.declarationChange.authorized === true && state.declarationChange.actor === 'owner' &&
      queue.length === 2 && queue[0].terminal === true && queue[0].finalAudit === false &&
      queue[1].child === '#251' && queue[1].finalAudit === true && queue[1].terminal === false;
  }
  if (fixture.scenario === 'governance_readiness') return validGovernanceReadiness(state);
  if (fixture.scenario.startsWith('final_audit_')) return validFinalAuditState(state);
  if (fixture.scenario === 'secret_prompt') return state.presence === false;
  if (fixture.scenario === 'completion_finality') return validCompletionState(state);
  if (fixture.scenario === 'reconciliation' || fixture.scenario.endsWith('_mismatch') ||
      fixture.scenario.endsWith('_changed') || fixture.scenario === 'wrong_current_turn' ||
      fixture.scenario === 'lying_read_back_exact' || fixture.scenario === 'lying_surfaces_agree') {
    return validReconciliationState(state.reconciliation);
  }
  if (fixture.scenario.includes('lifecycle') || fixture.scenario === 'baseline_section_order' ||
      fixture.scenario === 'bullet_checkbox_style' || fixture.scenario === 'competing_category_subqueues' ||
      fixture.scenario === 'current_item_active' || fixture.scenario === 'duplicate_parent_entry' ||
      fixture.scenario === 'missing_parent_entry' || fixture.scenario === 'terminal_item_nonterminal' ||
      fixture.scenario === 'unauthorised_queue_reorder') {
    return validParentLifecycle(state.parent);
  }
  return false;
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
    const names = namesAt(baseline);
    assert.deepEqual(names, trustedBaseFixtureInventory.names);
    return names;
  }

  // Hosted PR validation may use a depth-one checkout. The trusted base-tree
  // inventory remains the baseline; candidate filenames are never its source.
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'true');
  return [...trustedBaseFixtureInventory.names];
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
    const declared = declaredClassification(fixture);
    const derived = deriveDecision(fixture);
    assert.equal(derived, declared, fixture.id + ' declared classification must match the raw-evidence verdict');
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

test('fixture verdicts ignore authored valid, violation, result, and accepted labels', () => {
  const accepted = readJson('valid-explicit-closure-lease-activation.json');
  const rejected = readJson('invalid-closure-lease-not-activated.json');
  assert.equal(deriveDecision(accepted), true);
  accepted.accepted = false;
  accepted.evidence.valid = false;
  accepted.evidence.violation = 'untrusted-label';
  accepted.evidence.result = 'REJECTED';
  assert.equal(deriveDecision(accepted), true);

  assert.equal(deriveDecision(rejected), false);
  rejected.accepted = true;
  rejected.evidence.valid = true;
  rejected.evidence.violation = 'untrusted-label';
  rejected.evidence.result = 'ACCEPTED';
  assert.equal(deriveDecision(rejected), false);
});

test('shallow fixture reconciliation uses trusted base-tree inventory evidence', () => {
  assert.equal(trustedBaseFixtureInventory.source, 'base-tree-fixture-inventory');
  assert.equal(trustedBaseFixtureInventory.commit, mergeCommit);
  assert.equal(trustedBaseFixtureInventory.tree, mergeTree);
  assert.deepEqual(baselineFixtureNames(), trustedBaseFixtureInventory.names);

  const forgedCandidate = trustedBaseFixtureInventory.names
    .filter((name) => name !== trustedBaseFixtureInventory.names[0])
    .concat('unexpected-candidate-only.json')
    .sort();
  const baselineSet = new Set(trustedBaseFixtureInventory.names);
  const added = forgedCandidate.filter((name) => !baselineSet.has(name));
  const deleted = trustedBaseFixtureInventory.names.filter((name) => !forgedCandidate.includes(name));
  assert.deepEqual(added, ['unexpected-candidate-only.json']);
  assert.deepEqual(deleted, [trustedBaseFixtureInventory.names[0]]);
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
    'Assignment source: {{assignment_source}}',
    'Assignment evidence locator: {{assignment_evidence_locator}}',
    'Fresh subordinate run ID: {{fresh_subordinate_run_id}}',
    'Fresh workspace evidence locator: {{fresh_workspace_evidence_locator}}',
    'Fast mode: {{fast_mode}}',
    'Delegation: {{delegation_mode}}',
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

test('A6 validates every runtime prompt contract, including managed and implementation templates', () => {
  const required = [
    'Assignment source: {{assignment_source}}',
    'Assignment evidence locator: {{assignment_evidence_locator}}',
    'Fresh subordinate run ID: {{fresh_subordinate_run_id}}',
    'Fresh workspace evidence locator: {{fresh_workspace_evidence_locator}}',
    'Fast mode: {{fast_mode}}',
    'Delegation: {{delegation_mode}}'
  ];
  for (const file of a6PromptFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const fragment of required) assert.ok(text.includes(fragment), path.basename(file) + ' missing ' + fragment);
  }
});

test('module README and metadata retain the complete cumulative Design Lock chain', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8'));
  let previousIndex = -1;
  for (const lock of designLockChain) {
    const index = readme.indexOf(lock);
    assert.ok(index > previousIndex, 'README Design Lock chain drifted at ' + lock);
    previousIndex = index;
  }
  assert.ok(manifest.version_notes.includes(designLockChain.at(-1)));
  assert.ok(a6ContractText().includes(designLockChain.at(-1)));
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

function hostedReview(identity, state, overrides = {}) {
  return {
    identity: { ...identity },
    state,
    rawEvidence: true,
    hostedEvidence: {
      source: 'github-hosted-review',
      reviewType: 'codex-pull-request-review',
      actor: 'chatgpt-codex-connector',
      mechanism: 'github-codex-review',
      supported: true,
      identity: { ...identity },
      state,
      ...overrides
    }
  };
}

function hasAuthoritativeHostedCapability(review) {
  const hosted = review && review.hostedEvidence;
  return hosted && hosted.source === 'github-hosted-review' &&
    hosted.reviewType === 'codex-pull-request-review' &&
    hosted.actor === 'chatgpt-codex-connector' &&
    hosted.mechanism === 'github-codex-review' && hosted.supported === true;
}

function usableReview(review, expectedIdentity) {
  if (!hasAuthoritativeHostedCapability(review)) return null;
  const hosted = review.hostedEvidence;
  if (!hosted.identity || typeof hosted.identity !== 'object') return null;
  if (hosted.state !== 'pending' && hosted.state !== 'completed') return null;
  if (exactReviewIdentity(hosted.identity) !== exactReviewIdentity(expectedIdentity)) return null;
  return { state: hosted.state, identity: hosted.identity };
}

function externalReviewGate(evidence) {
  assert.ok(evidence && Array.isArray(evidence.reviews));
  assert.equal(typeof evidence.limitExhausted, 'boolean');
  const currentIdentity = exactReviewIdentity(evidence.identity);
  if (evidence.limitExhausted === true) {
    return { decision: 'REVIEW_LIMIT_EXHAUSTED', technicalVerdict: 'BLOCKED', freshG4Required: false };
  }
  const matching = evidence.reviews.map((review) => usableReview(review, evidence.identity)).filter(Boolean);
  if (matching.length > 1) {
    return { decision: 'EXTERNAL_REVIEW_AMBIGUOUS', technicalVerdict: 'BLOCKED', freshG4Required: false };
  }
  if (matching.length === 1 && matching[0].state === 'pending') {
    return { decision: 'PENDING_REVIEW_REUSED', technicalVerdict: 'WAIT', freshG4Required: false };
  }
  if (matching.length === 1 && matching[0].state === 'completed') {
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
  assert.equal(typeof evidence.phase, 'string');
  assert.equal(typeof evidence.finalExactHead, 'boolean');
  assert.equal(typeof evidence.bounded, 'boolean');
  assert.equal(typeof evidence.evidenceBound, 'boolean');
  if (evidence.action === 'resolve') return false;
  if (evidence.phase === 'AMEND') return false;
  if (evidence.phase !== 'FINAL') return false;
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
    reviews: [hostedReview(identity, 'pending')]
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
    reviews: [hostedReview(identity, 'completed')]
  }), { decision: 'COMPLETED_REVIEW_CONSUMED', technicalVerdict: 'ADJUDICATE', freshG4Required: false });
});

test('A4 rejects multiple matching pending or completed review states', () => {
  const identity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  assert.equal(externalReviewGate({
    identity,
    limitExhausted: false,
    reviews: [hostedReview(identity, 'pending'), hostedReview(identity, 'completed')]
  }).decision, 'EXTERNAL_REVIEW_AMBIGUOUS');
  assert.equal(externalReviewGate({
    identity,
    limitExhausted: false,
    reviews: [hostedReview(identity, 'completed'), hostedReview(identity, 'completed')]
  }).decision, 'EXTERNAL_REVIEW_AMBIGUOUS');
});

test('A4 requires authoritative hosted review capability rather than candidate labels', () => {
  const identity = {
    repository: 'opaque/repository',
    pr: 'pr-opaque',
    head: 'head-a',
    capability: 'external-review'
  };
  assert.equal(externalReviewGate({
    identity,
    limitExhausted: false,
    reviews: [{ identity, state: 'completed', rawEvidence: true, capability: 'external-review' }]
  }).decision, 'NEW_REVIEW_REQUIRED');
  assert.equal(externalReviewGate({
    identity,
    limitExhausted: false,
    reviews: [hostedReview(identity, 'completed', { actor: 'candidate-labelled-reviewer' })]
  }).decision, 'NEW_REVIEW_REQUIRED');
  assert.equal(externalReviewGate({
    identity,
    limitExhausted: false,
    reviews: [hostedReview(identity, 'completed')]
  }).decision, 'COMPLETED_REVIEW_CONSUMED');
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
    reviews: [hostedReview(previousIdentity, 'completed')]
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
      hostedReview(otherIdentity, 'completed'),
      { identity, state: 'completed', rawEvidence: true }
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

test('A4 rejects a technically complete reply outside the explicit FINAL phase', () => {
  const evidence = {
    phase: 'PRE_G4',
    action: 'reply',
    verdict: 'PASS',
    finalExactHead: true,
    bounded: true,
    evidenceBound: true
  };
  assert.equal(g4ThreadPermission(evidence), false);
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
  path.join(templateRoot, 'AGENTS.auto-code.managed.md'),
  path.join(templateRoot, 'closure-manager.prompt.md'),
  path.join(templateRoot, 'implementation-worker.prompt.md'),
  path.join(templateRoot, 'final-pre-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'authoritative-g4-reviewer.prompt.md'),
  path.join(templateRoot, 'independent-assurance-audit.prompt.md')
];
const a6PromptFiles = [
  path.join(templateRoot, 'AGENTS.auto-code.managed.md'),
  path.join(templateRoot, 'closure-manager.prompt.md'),
  path.join(templateRoot, 'implementation-worker.prompt.md'),
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

const commonAssignmentFields = [
  'provider',
  'canonicalBaseModel',
  'reasoning',
  'referenceFamilyReasoningEquivalent',
  'solEquivalentReasoning',
  'harnessAdapter',
  'surface',
  'role',
  'repository',
  'scope',
  'authority',
  'evidenceLocator'
];
const customInstructionsFields = [
  'instructionsRepository',
  'instructionsFile',
  'instructionsRef',
  'instructionsCommit',
  'instructionsBlob'
];
const assignmentFields = commonAssignmentFields.concat(customInstructionsFields);

function assignmentValues(value) {
  return Object.fromEntries(assignmentFields
    .filter((field) => Object.hasOwn(value, field))
    .map((field) => [field, value[field]]));
}

function syntheticAssignment(overrides = {}) {
  return {
    rawEvidence: true,
    provider: 'provider-synthetic',
    canonicalBaseModel: 'model-synthetic',
    reasoning: 'reasoning-synthetic',
    referenceFamilyReasoningEquivalent: 'reference-synthetic',
    solEquivalentReasoning: 'sol-equivalent-synthetic',
    harnessAdapter: 'adapter-synthetic',
    surface: 'surface-synthetic',
    role: 'role-synthetic',
    repository: 'repo-synthetic',
    scope: 'scope-synthetic',
    authority: 'authority-synthetic',
    evidenceLocator: 'locator-synthetic',
    ...overrides
  };
}

function syntheticCanonicalAssignment(overrides = {}) {
  return {
    ...syntheticAssignment(),
    instructionsRepository: 'instructions-repository-synthetic',
    instructionsFile: 'custom-instructions-synthetic.md',
    instructionsRef: 'ref-synthetic',
    instructionsCommit: 'c'.repeat(40),
    instructionsBlob: 'b'.repeat(40),
    ...overrides
  };
}

function completeAssignment(value, source) {
  const required = source === 'canonical-custom-instructions'
    ? assignmentFields
    : commonAssignmentFields;
  const hasMixedCustomInstructions = source === 'current-chat' &&
    customInstructionsFields.some((field) => Object.hasOwn(value || {}, field));
  return value && value.rawEvidence === true && !hasMixedCustomInstructions &&
    required.every((field) => typeof value[field] === 'string' && value[field].length > 0);
}

function resolvedAssignment(source, value) {
  return {
    decision: 'RESOLVED',
    source,
    evidenceLocator: value.evidenceLocator,
    values: assignmentValues(value)
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
        current.unselectedAlternative !== undefined || !completeAssignment(current, 'current-chat')) {
      return { decision: 'MODEL_ASSIGNMENT_REQUIRED' };
    }
    return resolvedAssignment('current-chat', current);
  }
  const canonical = evidence.canonicalInstructions;
  if (!completeAssignment(canonical, 'canonical-custom-instructions') || canonical.ambiguous === true || canonical.conflicting === true ||
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
  const surfaces = Array.isArray(evidence.surfaces) ? evidence.surfaces : [];
  const temporary = evidence.temporaryChat;
  const active = grants.sourceAccepted === true && grants.designMerged === true &&
    grants.installed === true && grants.explicitActivation === true;
  if (!active) {
    if (surfaces.length > 0 || (temporary !== null && temporary !== undefined)) {
      return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
    }
    return { decision: 'SOURCE_ONLY_INACTIVE', dispatch: false };
  }

  const admittedPersistentTypes = new Set(['web-orchestrator', 'executor-root']);
  if (surfaces.length !== 2 || surfaces.some((surface) => !surface || surface.persistent !== true ||
      !admittedPersistentTypes.has(surface.type))) {
    return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
  }
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
  const admittedRunKinds = new Set(['implementation', 'amendment', 'pre-g4', 'technical-g4']);
  if (runs.some((run) => run.rawEvidence !== true || run.promptBounded !== true ||
      run.fresh !== true || run.clean !== true || run.exactAuthority !== true ||
      run.inheritedAuthority !== false || run.retained !== false || !admittedRunKinds.has(run.kind))) {
    return { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false };
  }

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

test('A6 rejects unknown or extra persistent surface types and enforces the active count', () => {
  const base = activeA6Topology();
  assert.equal(topologyDecision({
    ...base,
    surfaces: [...base.surfaces, {
      type: 'unknown-controller', task: 'task-synthetic', repository: 'repo-synthetic', pr: 'pr-synthetic', persistent: true
    }]
  }).decision, 'SURFACE_TOPOLOGY_INVALID');
  assert.equal(topologyDecision({
    ...base,
    surfaces: base.surfaces.map((surface) => surface.type === 'executor-root'
      ? { ...surface, type: 'unknown-executor' }
      : surface)
  }).decision, 'SURFACE_TOPOLOGY_INVALID');
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
    kind: 'implementation',
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
    kind: 'amendment',
    promptBounded: true,
    fresh: false,
    clean: false,
    exactAuthority: true,
    inheritedAuthority: true,
    retained: true
  };
  assert.equal(topologyDecision(activeA6Topology({ subordinateRuns: [run] })).decision, 'SURFACE_TOPOLOGY_INVALID');
});

test('A6 rejects unknown subordinate run kinds', () => {
  const run = {
    rawEvidence: true,
    kind: 'governance-repair',
    promptBounded: true,
    fresh: true,
    clean: true,
    exactAuthority: true,
    inheritedAuthority: false,
    retained: false
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

test('A6 rejects active or persistent surfaces when activation grants are incomplete', () => {
  const evidence = activeA6Topology({
    grants: { sourceAccepted: true, designMerged: true, installed: false, explicitActivation: false }
  });
  assert.deepEqual(topologyDecision(evidence), { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false });
  assert.deepEqual(topologyDecision({
    rawEvidence: true,
    grants: { sourceAccepted: true, designMerged: true, installed: false, explicitActivation: false },
    surfaces: [],
    temporaryChat: { rawEvidence: true }
  }), { decision: 'SURFACE_TOPOLOGY_INVALID', dispatch: false });
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
  const canonical = syntheticCanonicalAssignment({ provider: 'provider-canonical-synthetic', evidenceLocator: 'canonical-locator' });
  const result = resolveA6Assignment({ currentChat: current, canonicalInstructions: canonical });
  assert.equal(result.decision, 'RESOLVED');
  assert.equal(result.source, 'current-chat');
  assert.equal(result.values.provider, 'provider-current-synthetic');
  assert.equal(result.evidenceLocator, 'current-chat-locator');
  assert.equal(Object.hasOwn(result.values, 'instructionsRepository'), false);
});

test('A6 current-chat assignments use a source-specific schema without Custom Instructions pins', () => {
  const current = syntheticAssignment();
  assert.equal(resolveA6Assignment({ currentChat: current }).decision, 'RESOLVED');
  assert.equal(resolveA6Assignment({
    currentChat: { ...current, instructionsRepository: 'mixed-source' }
  }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
  assert.equal(resolveA6Assignment({
    canonicalInstructions: syntheticCanonicalAssignment({ instructionsBlob: undefined })
  }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 no current-chat assignment permits complete canonical fallback', () => {
  const canonical = syntheticCanonicalAssignment({ evidenceLocator: 'canonical-locator' });
  const result = resolveA6Assignment({ canonicalInstructions: canonical });
  assert.equal(result.decision, 'RESOLVED');
  assert.equal(result.source, 'canonical-custom-instructions');
  assert.equal(result.evidenceLocator, 'canonical-locator');
  assert.equal(result.values.instructionsRepository, 'instructions-repository-synthetic');
});

test('A6 partial current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED', () => {
  const partial = syntheticAssignment();
  delete partial.evidenceLocator;
  assert.equal(resolveA6Assignment({ currentChat: partial, canonicalInstructions: syntheticCanonicalAssignment() }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 ambiguous current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED', () => {
  assert.equal(resolveA6Assignment({ currentChat: syntheticAssignment({ ambiguous: true }), canonicalInstructions: syntheticCanonicalAssignment() }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 conflicting current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED', () => {
  assert.equal(resolveA6Assignment({ currentChat: syntheticAssignment({ conflicting: true }), canonicalInstructions: syntheticCanonicalAssignment() }).decision, 'MODEL_ASSIGNMENT_REQUIRED');
});

test('A6 assignment sources cannot be mixed', () => {
  const current = syntheticAssignment({ provider: 'provider-current-synthetic' });
  const canonical = syntheticCanonicalAssignment({ provider: 'provider-canonical-synthetic' });
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
  const kinds = ['implementation', 'amendment', 'pre-g4', 'technical-g4'];
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

const assuranceIdentityFields = [
  'provider',
  'canonical_model',
  'reasoning',
  'assignment_source',
  'assignment_evidence',
  'role',
  'surface',
  'exact_head'
];

function completeAssuranceIdentity(identity) {
  return identity && assuranceIdentityFields.every((field) => nonEmptyString(identity[field]));
}

function temporaryAssuranceGate(evidence) {
  if (!evidence || evidence.rawEvidence !== true) return 'SURFACE_TOPOLOGY_INVALID';
  if (evidence.g4Verdict !== 'PASS' || evidence.finalExactHead !== true || evidence.webVerified !== true ||
      evidence.webAdjudicated !== true) return 'WEB_VERIFICATION_REQUIRED';
  if (evidence.freshTemporaryChatCount !== 1) return 'TEMPORARY_ASSURANCE_REQUIRED';
  const g4 = evidence.g4ExecutionIdentity;
  const web = evidence.webExecutionIdentity;
  if (!completeAssuranceIdentity(g4) || !completeAssuranceIdentity(web) ||
      g4.role !== 'technical G4 reviewer' || web.surface !== 'web-temporary-chat' ||
      g4.exact_head !== evidence.exactHead || web.exact_head !== evidence.exactHead) {
    return 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED';
  }
  const prohibitedContexts = ['web-orchestrator', 'executor-root', 'implementation', 'amendment', 'technical-g4-reviewer'];
  if (evidence.separateContext !== true || !Array.isArray(evidence.separateFrom) ||
      prohibitedContexts.some((context) => !evidence.separateFrom.includes(context))) {
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

test('A6-C3 requires complete G4 and Web assurance identities', () => {
  for (const field of assuranceIdentityFields) {
    const evidence = temporaryEvidence();
    delete evidence.g4ExecutionIdentity[field];
    assert.equal(temporaryAssuranceGate(evidence), 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED', 'missing G4 ' + field);
  }
  for (const field of assuranceIdentityFields) {
    const evidence = temporaryEvidence();
    delete evidence.webExecutionIdentity[field];
    assert.equal(temporaryAssuranceGate(evidence), 'ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED', 'missing Web ' + field);
  }
});

test('A6-C3 requires separation from every prohibited assurance context', () => {
  for (const context of ['web-orchestrator', 'executor-root', 'implementation', 'amendment', 'technical-g4-reviewer']) {
    const evidence = temporaryEvidence({
      separateFrom: ['web-orchestrator', 'executor-root', 'implementation', 'amendment', 'technical-g4-reviewer']
        .filter((candidate) => candidate !== context)
    });
    assert.equal(temporaryAssuranceGate(evidence), 'SURFACE_TOPOLOGY_INVALID', 'missing separation from ' + context);
  }
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

const negativeTestReference = (invariantId) => 'repo/tests/repo-auto-code-design.test.cjs::negative::' + invariantId;
const negativeTestContracts = new Map(Object.keys(expectedInvariantBundles)
  .map((invariantId) => [invariantId, negativeTestReference(invariantId)]));
const candidateSchemaMapping = {
  base_model: 'canonical_base_model',
  revision: 'source_revision',
  result: 'technical_result'
};

function invariantRegistry() {
  const protocol = fs.readFileSync(path.join(mainRoot, 'protocol.md'), 'utf8');
  const match = protocol.match(/## Cumulative semantic invariant registry[\s\S]*?```json\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, 'cumulative invariant JSON registry is required');
  return JSON.parse(match[1]);
}

function validReplacementContract(change) {
  const replacement = change && change.replacement;
  if (!replacement || !nonEmptyString(replacement.invariant_id) ||
      !Array.isArray(replacement.required_semantics) || replacement.required_semantics.length === 0 ||
      !Array.isArray(replacement.candidate_evidence) || replacement.candidate_evidence.length === 0 ||
      replacement.negative_test !== negativeTestReference(replacement.invariant_id)) return false;
  const semantics = new Set(replacement.required_semantics.map((entry) => entry && entry.semantic_id));
  const evidence = new Set(replacement.candidate_evidence.map((entry) => entry && entry.semantic_id));
  return !semantics.has(undefined) && semantics.size === replacement.required_semantics.length &&
    !evidence.has(undefined) && evidence.size === replacement.candidate_evidence.length &&
    replacement.required_semantics.every((entry) => nonEmptyString(entry.requirement)) &&
    replacement.candidate_evidence.every((entry) => Array.isArray(entry.evidence_fields) && entry.evidence_fields.length > 0) &&
    [...semantics].every((semanticId) => evidence.has(semanticId));
}

function validDisposalContract(change, invariantId) {
  const disposal = change && change.disposal;
  return disposal && disposal.invariant_id === invariantId &&
    disposal.contract === 'repo/tests/repo-auto-code-design.test.cjs::disposal::' + invariantId &&
    nonEmptyString(disposal.reason);
}

function validDesignLockChange(record) {
  const change = record.design_lock_change;
  return change && change.invariant_id === record.invariant_id && nonEmptyString(change.design_lock) &&
    nonEmptyString(change.rationale);
}

function invariantDecision(record, expected) {
  if (!record || invariantRequiredFields.some((field) => !Object.hasOwn(record, field))) return 'INVARIANT_REGRESSION';
  if (typeof record.invariant_id !== 'string' || typeof record.source_authority !== 'string' ||
      typeof record.negative_test !== 'string' || typeof record.authorising_design_lock !== 'string' ||
      !['preserved', 'amended', 'removed'].includes(record.status) ||
      !Array.isArray(record.required_semantics) || !Array.isArray(record.candidate_evidence)) {
    return 'INVARIANT_REGRESSION';
  }
  if (negativeTestContracts.get(record.invariant_id) !== record.negative_test &&
      record.negative_test !== negativeTestReference(record.invariant_id)) return 'INVARIANT_REGRESSION';
  if (record.status !== 'preserved') {
    if (!validDesignLockChange(record)) return 'INVARIANT_REGRESSION';
    if (record.status === 'amended' && !validReplacementContract(record.design_lock_change)) return 'INVARIANT_REGRESSION';
    if (record.status === 'removed' && !validDisposalContract(record.design_lock_change, record.invariant_id)) return 'INVARIANT_REGRESSION';
    return 'PRESERVED';
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

function validateRegressionLinks(records, findings = []) {
  const knownInvariantIds = new Set(records
    .filter((record) => record && typeof record.invariant_id === 'string')
    .map((record) => record.invariant_id));
  return records.concat(findings).every((record) => {
    if (!record) return false;
    if (record.repeated === true && !Object.hasOwn(record, 'regression_of')) return false;
    if (!Object.hasOwn(record, 'regression_of')) return true;
    return nonEmptyString(record.regression_of) && knownInvariantIds.has(record.regression_of);
  });
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
  assert.equal(validateRegressionLinks([...records.values()]), true);
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

test('A6-C4 amendment and removal validate named replacement or disposal contracts', () => {
  const record = invariantRegistry().invariants.find((entry) => entry.invariant_id === 'AUTH-LEDGER-RECEIPT-001');
  const expected = expectedInvariantBundles[record.invariant_id];
  const amended = JSON.parse(JSON.stringify(record));
  amended.status = 'amended';
  assert.equal(invariantDecision(amended, expected), 'INVARIANT_REGRESSION');
  amended.design_lock_change = {
    invariant_id: amended.invariant_id,
    design_lock: 'DL-329-AUTO-CODE-005-A6-C5',
    replacement: {
      invariant_id: 'AUTH-LEDGER-RECEIPT-REPLACEMENT-001',
      required_semantics: [{ semantic_id: 'replacement_receipt', requirement: 'The replacement receipt contract is complete.' }],
      candidate_evidence: [{ semantic_id: 'replacement_receipt', evidence_fields: ['replacement_receipt_contract'] }],
      negative_test: negativeTestReference('AUTH-LEDGER-RECEIPT-REPLACEMENT-001')
    },
    rationale: 'synthetic Design Lock test'
  };
  assert.equal(invariantDecision(amended, expected), 'PRESERVED');

  const removed = JSON.parse(JSON.stringify(record));
  removed.status = 'removed';
  removed.design_lock_change = {
    invariant_id: removed.invariant_id,
    design_lock: 'DL-329-AUTO-CODE-005-A6-C5',
    disposal: {
      invariant_id: removed.invariant_id,
      contract: 'repo/tests/repo-auto-code-design.test.cjs::disposal::' + removed.invariant_id,
      reason: 'synthetic disposal contract'
    },
    rationale: 'synthetic Design Lock disposal test'
  };
  assert.equal(invariantDecision(removed, expected), 'PRESERVED');
});

test('A6-C4 negative tests are concrete and regression links use parsed records', () => {
  const registry = invariantRegistry();
  const record = registry.invariants.find((entry) => entry.invariant_id === 'AUTH-LEDGER-RECEIPT-001');
  const expected = expectedInvariantBundles[record.invariant_id];
  for (const negativeTest of ['', 'unrelated text', 'repo/tests/other.test.cjs::negative::AUTH-LEDGER-RECEIPT-001']) {
    const candidate = JSON.parse(JSON.stringify(record));
    candidate.negative_test = negativeTest;
    assert.equal(invariantDecision(candidate, expected), 'INVARIANT_REGRESSION');
  }
  const repeatedFinding = { finding_id: 'finding-repeat', repeated: true, regression_of: 'AUTH-LEDGER-RECEIPT-001' };
  assert.equal(validateRegressionLinks(registry.invariants, [repeatedFinding]), true);
  assert.equal(validateRegressionLinks(registry.invariants, [{ finding_id: 'missing-link' }]), true);
  assert.equal(validateRegressionLinks(registry.invariants, [{ finding_id: 'unknown-link', regression_of: 'UNKNOWN-001' }]), false);
  const nonRepeatedRecord = { ...record, invariant_id: 'AUTH-LEDGER-RECEIPT-NONREPEAT-001', repeated: false };
  assert.equal(validateRegressionLinks(registry.invariants.concat(nonRepeatedRecord)), true);
  const missingLink = { ...record, invariant_id: 'AUTH-LEDGER-RECEIPT-REPEAT-001', repeated: true };
  assert.equal(validateRegressionLinks(registry.invariants.concat(missingLink)), false);
  missingLink.regression_of = undefined;
  assert.equal(validateRegressionLinks(registry.invariants.concat(missingLink)), false);
});

test('A6-C4 maps invariant evidence to the canonical evaluation-candidate schema', () => {
  const registry = invariantRegistry();
  const record = registry.invariants.find((entry) => entry.invariant_id === 'SCHEMA-EVAL-CANDIDATE-001');
  assert.deepEqual(record.candidate_schema_mapping, candidateSchemaMapping);
  const template = fs.readFileSync(path.join(templateRoot, 'evaluation-candidate.comment.md'), 'utf8');
  const jsonText = template.match(/<!-- evaluation-candidate:v1 -->\r?\n([\s\S]*?\r?\n\})\r?\n\r?\nInvariant evidence mapping/)[1];
  const schema = JSON.parse(jsonText);
  for (const field of Object.values(candidateSchemaMapping)) assert.ok(Object.hasOwn(schema, field), field);
  for (const semantic of record.candidate_evidence) {
    for (const field of semantic.evidence_fields) {
      assert.ok(Object.hasOwn(schema, candidateSchemaMapping[field] || field), field);
    }
  }
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
      grant.expires_at <= context.now || !Number.isFinite(grant.max_agents) ||
      !Number.isInteger(grant.max_agents) || grant.max_agents < 1) return false;
  const operation = normaliseAdmissionOperation(request.operation);
  if (operation === 'fast' && grant.allow_fast !== true) return false;
  if (operation === 'spawn_agent' && (grant.allow_agents !== true ||
      !Number.isFinite(request.requestedAgentCount) || !Number.isInteger(request.requestedAgentCount) || request.requestedAgentCount < 1 ||
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
    mode: operation === 'fast' ? 'FAST' : grant.allow_fast === true ? 'AGENT_FAST' : 'AGENT_STANDARD',
    reason: 'ADMITTED',
    fastAllowed: operation === 'fast' || grant.allow_fast === true,
    delegationAllowed: operation === 'spawn_agent',
    grant: { ...grant, consumed: true }
  };
}

function renderAdmissionTemplate(text, grant) {
  return text
    .replaceAll('{{fast_mode}}', grant.allow_fast === true ? 'allowed' : 'prohibited')
    .replaceAll('{{delegation_mode}}', grant.allow_agents === true ? 'allowed' : 'prohibited');
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

test('A6-C5 requires a positive finite integer max_agents and bounded request count', () => {
  const context = admissionContext();
  for (const maxAgents of [undefined, 0, -1, 1.5, Infinity, '1']) {
    assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context,
      structuredGrant({ max_agents: maxAgents }), trustedPreToolUseHook).reason, 'ADMISSION_DENIED', String(maxAgents));
  }
  for (const requestedAgentCount of [undefined, 0, -1, 1.5, Infinity, '1']) {
    assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount }, context,
      structuredGrant({ max_agents: 2 }), trustedPreToolUseHook).reason, 'ADMISSION_DENIED', String(requestedAgentCount));
  }
  assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 2 }, context,
    structuredGrant({ max_agents: 2 }), trustedPreToolUseHook).allowed, true);
});

test('A6-C5 separates Fast and delegation permissions across all four grant combinations', () => {
  const context = admissionContext();
  for (const [allowFast, allowAgents] of [[false, false], [true, false], [false, true], [true, true]]) {
    const fastGrant = structuredGrant({ operation: 'fast', allow_fast: allowFast, allow_agents: allowAgents });
    const delegationGrant = structuredGrant({ operation: 'spawn_agent', allow_fast: allowFast, allow_agents: allowAgents });
    const fast = admissionDecision({ operation: 'fast' }, context, fastGrant, null);
    const delegated = admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, delegationGrant, trustedPreToolUseHook);
    assert.equal(fast.allowed, allowFast, 'Fast combination ' + allowFast + '/' + allowAgents);
    assert.equal(delegated.allowed, allowAgents, 'delegation combination ' + allowFast + '/' + allowAgents);
    if (allowFast) assert.equal(fast.mode, 'FAST');
    if (allowAgents) {
      assert.equal(delegated.mode, allowFast ? 'AGENT_FAST' : 'AGENT_STANDARD');
      assert.equal(delegated.fastAllowed, allowFast);
    }
  }
});

test('A6-C5 runtime templates render structured Fast and delegation admission values', () => {
  for (const [allowFast, allowAgents] of [[false, false], [true, false], [false, true], [true, true]]) {
    const grant = structuredGrant({ allow_fast: allowFast, allow_agents: allowAgents });
    for (const file of a6PromptFiles) {
      const text = renderAdmissionTemplate(fs.readFileSync(file, 'utf8'), grant);
      assert.ok(text.includes('Fast mode: ' + (allowFast ? 'allowed' : 'prohibited')), path.basename(file));
      assert.ok(text.includes('Delegation: ' + (allowAgents ? 'allowed' : 'prohibited')), path.basename(file));
      assert.equal(text.includes('Fast mode: prohibited') && allowFast, false, path.basename(file));
    }
  }
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
