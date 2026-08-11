'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.join(repoRoot, '_projects', 'development', 'repo-auto-code');
const mainRoot = path.join(projectRoot, '_main');
const fixtureRoot = path.join(mainRoot, 'fixtures');
const templateRoot = path.join(mainRoot, 'templates');
const fixturePrefix = '_projects/development/repo-auto-code/_main/fixtures';
const c8AuthorityTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-authority-reference-'));
process.once('exit', () => { try { fs.rmSync(c8AuthorityTempRoot, { recursive: true, force: true }); } catch {} });

function c8FixtureGit(cwd, args, environment = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function c8CreateGitAuthorityFixture(parentRoot) {
  const fixtureRoot = fs.mkdtempSync(path.join(parentRoot, 'git-authority-'));
  const targetPath = 'repo/tests/repo-auto-code-design.test.cjs';
  const targetFile = path.join(fixtureRoot, ...targetPath.split('/'));
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'README.md'), 'C22 isolated Git authority fixture\n', 'utf8');
  fs.writeFileSync(targetFile, 'canonical base fixture\n', 'utf8');
  c8FixtureGit(fixtureRoot, ['init', '--quiet', '-b', 'main']);
  c8FixtureGit(fixtureRoot, ['config', 'user.name', 'Toolkit C22 Git Fixture']);
  c8FixtureGit(fixtureRoot, ['config', 'user.email', 'toolkit-c22-fixture@example.invalid']);
  const commit = (message, date) => {
    const environment = {
      GIT_AUTHOR_NAME: 'Toolkit C22 Git Fixture',
      GIT_AUTHOR_EMAIL: 'toolkit-c22-fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Toolkit C22 Git Fixture',
      GIT_COMMITTER_EMAIL: 'toolkit-c22-fixture@example.invalid',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date
    };
    c8FixtureGit(fixtureRoot, ['add', '--all']);
    c8FixtureGit(fixtureRoot, ['commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', message], environment);
    return c8FixtureGit(fixtureRoot, ['rev-parse', 'HEAD']);
  };
  const canonicalBaseSha = commit('C22 canonical base', '2000-01-01T00:00:00+0000');
  fs.writeFileSync(path.join(fixtureRoot, 'intermediate.txt'), 'intermediate parent fixture\n', 'utf8');
  const immediateParentSha = commit('C22 intermediate parent', '2000-01-02T00:00:00+0000');
  fs.writeFileSync(targetFile, 'candidate head fixture\n', 'utf8');
  const exactRemoteHeadSha = commit('C22 candidate head', '2000-01-03T00:00:00+0000');
  const exactTreeSha = c8FixtureGit(fixtureRoot, ['rev-parse', exactRemoteHeadSha + '^{tree}']);
  const immediateParentTreeSha = c8FixtureGit(fixtureRoot, ['rev-parse', immediateParentSha + '^{tree}']);
  const immediateParentBlobSha = c8FixtureGit(fixtureRoot, ['rev-parse', immediateParentSha + ':' + targetPath]);
  const authorisedBlobSha = c8FixtureGit(fixtureRoot, ['rev-parse', exactRemoteHeadSha + ':' + targetPath]);
  const alternateBlobSha = c8FixtureGit(fixtureRoot, ['rev-parse', exactRemoteHeadSha + ':README.md']);
  return {
    root: fixtureRoot,
    canonical_base_sha: canonicalBaseSha,
    immediate_parent_sha: immediateParentSha,
    immediate_parent_tree_sha: immediateParentTreeSha,
    immediate_parent_blob_sha: immediateParentBlobSha,
    exact_remote_head_sha: exactRemoteHeadSha,
    exact_tree_sha: exactTreeSha,
    alternate_blob_sha: alternateBlobSha,
    authority: {
      canonical_base_sha: canonicalBaseSha,
      exact_remote_head_sha: exactRemoteHeadSha,
      exact_tree_sha: exactTreeSha,
      authorised_blobs: [{ path: targetPath, blob_sha: authorisedBlobSha }]
    }
  };
}

const c8GitAuthorityFixture = c8CreateGitAuthorityFixture(c8AuthorityTempRoot);
let c28TrustedAuthorityStore;

function c28TrustedLookup(namespace, identity) {
  return c28TrustedAuthorityStore ? c28TrustedAuthorityStore.resolve(namespace, identity) : null;
}

function c8NewAuthorityStorePath(label = 'authority') {
  return path.join(fs.mkdtempSync(path.join(c8AuthorityTempRoot, label + '-')), 'authority.json');
}

function c8Clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function c8DurableRecordKey(record) {
  return record && (record.envelope_id || record.grant_id || record.lease_id);
}

function c8DurableRecordDigest(record, kind) {
  if (kind === 'assurance-envelope') return c6EnvelopeDigest(record);
  if (kind === 'admission-grant') return c5GrantDigest(record);
  if (kind === 'exceptional-review') return c7GrantDigest(record);
  return record && (record.canonical_digest || record.lease_digest);
}

function c8DurableRecordState(record) {
  return record && record.lifecycle && record.lifecycle.state;
}

function c8DurableConsumedRecord(record, consumedAt) {
  const consumed = c8Clone(record);
  consumed.lifecycle = {
    ...consumed.lifecycle,
    state: 'consumed',
    consumed: true,
    use_count: Number(consumed.lifecycle.use_count || 0) + 1,
    consumed_at: consumedAt
  };
  if (Object.hasOwn(consumed, 'consumed')) consumed.consumed = true;
  return consumed;
}

class C8DurableAuthorityRegistry {
  constructor(filePath, kind = 'authority') {
    this.filePath = filePath || c8NewAuthorityStorePath(kind);
    this.kind = kind;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, JSON.stringify({ schema: 'durable-authority-store/v1', entries: {} }), 'utf8');
  }

  _readUnsafe() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.schema !== 'durable-authority-store/v1' || !parsed.entries || typeof parsed.entries !== 'object') throw new Error('invalid store');
      return parsed;
    } catch {
      throw new C8ContractError('DURABLE_AUTHORITY_STORE_INVALID', 'authority_store');
    }
  }

  _writeUnsafe(state) {
    const temporary = this.filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state), 'utf8');
    if (process.platform === 'win32') fs.rmSync(this.filePath, { force: true });
    fs.renameSync(temporary, this.filePath);
  }

  _withLock(callback) {
    const lockPath = this.filePath + '.lock';
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx');
      const state = this._readUnsafe();
      const result = callback(state);
      if (result && result.write) this._writeUnsafe(state);
      return result && Object.hasOwn(result, 'value') ? result.value : result;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(lockPath, { force: true });
    }
  }

  register(record) {
    const key = c8DurableRecordKey(record);
    const digest = c8DurableRecordDigest(record, this.kind);
    if (!key || !c8Digest.test(digest || '') || digest !== (record.canonical_digest || record.lease_digest)) {
      return { decision: 'AUTHORITY_REGISTRATION_REJECTED', reason: 'AUTHORITY_DIGEST_MISMATCH' };
    }
    return this._withLock((state) => {
      const entry = state.entries[this.kind + ':' + key];
      if (entry) {
        if (entry.digest !== digest) return { value: { decision: 'AUTHORITY_REGISTRATION_REJECTED', reason: 'AUTHORITY_DIGEST_MISMATCH' } };
        if (entry.state === 'consumed') return { value: { decision: 'AUTHORITY_REGISTRATION_REJECTED', reason: 'AUTHORITY_ALREADY_CONSUMED' } };
        return { value: { decision: 'AUTHORITY_ALREADY_REGISTERED', record: c8Clone(entry.record) } };
      }
      state.entries[this.kind + ':' + key] = {
        kind: this.kind,
        key,
        digest,
        state: c8DurableRecordState(record) || 'issued',
        record: c8Clone(record)
      };
      return { write: true, value: { decision: 'AUTHORITY_REGISTERED', record: c8Clone(record) } };
    });
  }

  consume(record, options = {}) {
    const key = c8DurableRecordKey(record);
    const digest = c8DurableRecordDigest(record, this.kind);
    if (!key || !c8Digest.test(digest || '') || digest !== (record.canonical_digest || record.lease_digest)) {
      return { decision: 'AUTHORITY_REJECTED', reason: 'AUTHORITY_DIGEST_MISMATCH' };
    }
    return this._withLock((state) => {
      const entryKey = this.kind + ':' + key;
      const entry = state.entries[entryKey];
      if (!entry) return { value: { decision: 'AUTHORITY_REJECTED', reason: 'AUTHORITY_NOT_REGISTERED' } };
      if (entry.digest !== digest) return { value: { decision: 'AUTHORITY_REJECTED', reason: 'AUTHORITY_DIGEST_MISMATCH' } };
      if (entry.state === 'consumed') return { value: { decision: 'AUTHORITY_REJECTED', reason: 'AUTHORITY_ALREADY_CONSUMED' } };
      if (options.expectedState && entry.state !== options.expectedState) return { value: { decision: 'AUTHORITY_REJECTED', reason: 'AUTHORITY_STATE_MISMATCH' } };
      const consumed = c8DurableConsumedRecord(record, options.consumed_at);
      entry.state = 'consumed';
      entry.record = c8Clone(consumed);
      return { write: true, value: { decision: 'AUTHORITY_CONSUMED', record: consumed } };
    });
  }

  read(key) {
    const state = this._readUnsafe();
    const entry = state.entries[this.kind + ':' + key];
    return entry ? c8Clone(entry) : null;
  }
}
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
  'DL-329-AUTO-CODE-005-A6-C5',
  'DL-329-AUTO-CODE-005-A6-C6'
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

function c28HostedEvidenceIdentity(identity, state) {
  return 'hosted-review-evidence-' + exactReviewIdentity(identity) + '|' + state;
}

function hostedReview(identity, state, overrides = {}) {
  const trusted = c28TrustedLookup('hosted-review', c28HostedEvidenceIdentity(identity, state));
  const hostedEvidence = trusted ? c8Clone(trusted) : {
    evidence_identity: 'candidate-hosted-review-' + c28HostedEvidenceIdentity(identity, state),
    source: 'github-hosted-review',
    reviewType: 'codex-pull-request-review',
    actor: 'chatgpt-codex-connector',
    mechanism: 'github-codex-review',
    supported: true,
    identity: { ...identity },
    state
  };
  return {
    identity: { ...identity },
    state,
    rawEvidence: true,
    hostedEvidence: { ...hostedEvidence, ...overrides }
  };
}

function hasAuthoritativeHostedCapability(review) {
  const hosted = review && review.hostedEvidence;
  const trusted = hosted && c28TrustedLookup('hosted-review', hosted.evidence_identity);
  return !!trusted && c8Json(trusted) === c8Json(hosted) && hosted.source === 'github-hosted-review' &&
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

function g4ConversationEvidenceFixture() {
  const head = c8GitAuthorityFixture.exact_remote_head_sha;
  const bytes = 'g4-final-pass-evidence';
  return {
    exactHeadBinding: {
      repository: 'weijunswj/ai-agent-toolkit',
      pull_request: 333,
      head
    },
    boundedReplyAuthority: {
      role: 'technical G4 reviewer',
      surface: 'technical-g4-reviewer',
      scope: 'one bounded technical reply',
      action: 'reply',
      resolve: false,
      reopen: false,
      dismiss: false
    },
    evidenceBinding: {
      source_class: 'authoritative-raw',
      repository: 'weijunswj/ai-agent-toolkit',
      pull_request: 333,
      head,
      locator: 'raw://weijunswj/ai-agent-toolkit/pr-333/g4-final-pass#technical-g4-reply',
      evidence_identity: 'g4-final-pass-evidence-1',
      bytes,
      content_digest: c8DigestBytes(bytes)
    }
  };
}

function g4ConversationPermission(evidence = {}) {
  const reject = () => false;
  if (evidence.resolve === true || evidence.reopen === true || evidence.dismiss === true) return reject();
  for (const field of ['resolve', 'reopen', 'dismiss']) {
    if (Object.hasOwn(evidence, field) && evidence[field] !== false) return reject();
  }
  if (evidence.action !== 'reply' || evidence.reply !== true || evidence.phase !== 'FINAL' || evidence.verdict !== 'PASS' ||
      evidence.finalExactHead !== true || evidence.bounded !== true || evidence.evidenceBound !== true) return reject();

  const expectedHead = c8GitAuthorityFixture.exact_remote_head_sha;
  const exactHead = evidence.exactHeadBinding;
  if (!exactHead || exactHead.repository !== 'weijunswj/ai-agent-toolkit' || exactHead.pull_request !== 333 || exactHead.head !== expectedHead) return reject();

  const authority = evidence.boundedReplyAuthority;
  if (!authority || authority.role !== 'technical G4 reviewer' || authority.surface !== 'technical-g4-reviewer' ||
      authority.scope !== 'one bounded technical reply' || authority.action !== 'reply' ||
      authority.resolve !== false || authority.reopen !== false || authority.dismiss !== false) return reject();

  const binding = evidence.evidenceBinding;
  if (!binding || binding.source_class !== 'authoritative-raw' || binding.repository !== 'weijunswj/ai-agent-toolkit' ||
      binding.pull_request !== 333 || binding.head !== expectedHead || !nonEmptyString(binding.locator) ||
      !binding.locator.includes('#technical-g4-reply') || !nonEmptyString(binding.evidence_identity) ||
      !nonEmptyString(binding.bytes) || !c8Digest.test(binding.content_digest) ||
      binding.content_digest !== c8DigestBytes(binding.bytes)) return reject();
  return true;
}

function g4ThreadPermission(evidence) {
  return g4ConversationPermission(evidence);
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
    ...g4ConversationEvidenceFixture(),
    phase: 'FINAL',
    action: 'reply',
    reply: true,
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
    exceptionalAssuranceGrant: true,
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
  if (evidence.exceptionalAssuranceGrant !== true) return 'ASSURANCE_GRANT_REQUIRED';
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

test('A6-C3 exceptional assurance requires an exact grant and one fresh Temporary Chat after Web verification', () => {
  assertA6Terms(['exactly one fresh Web Temporary Chat', 'fresh for that head', 'same model family']);
  assert.equal(temporaryAssuranceGate(temporaryEvidence({ exceptionalAssuranceGrant: false })), 'ASSURANCE_GRANT_REQUIRED');
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

test('A6-C3 same-family routes still require diversity records when an exceptional grant admits assurance', () => {
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

const c6MandatoryDomainIds = Object.freeze([
  'repository-pr-branch-merge',
  'exact-authority-graph',
  'cumulative-diff-allowlist',
  'source-only-boundary',
  'local-validation',
  'hosted-checks-exact-head',
  'review-submissions',
  'review-threads',
  'finding-mappings',
  'governance-reconciliation',
  'authority-movement',
  'applicable-archive-ledger-issue-state'
]);
const c6RawSourceKinds = new Set(['github-api', 'git-object', 'git-diff', 'local-command', 'ci-check', 'issue-api', 'archive', 'digest', 'ledger-api']);
const c6ProhibitedSourceClasses = new Set([
  'controller-narrative',
  'web-narrative',
  'g4-packet',
  'executor-terminal-packet',
  'copied-packet-hash',
  'reviewer-self-attestation',
  'actor-conclusion',
  'memory',
  'custom-instructions',
  'candidate-label',
  'generic-link',
  'circular-locator'
]);
const c6ProhibitedContexts = Object.freeze([
  'web-orchestrator',
  'executor-root',
  'implementation',
  'amendment',
  'technical-g4-reviewer'
]);
const c6NonAuthorityFields = Object.freeze([
  'g4_pass_or_amend',
  'github_mutation',
  'acceptance',
  'ready',
  'merge',
  'closure',
  'installation',
  'activation',
  'next_task_selection'
]);
const c6Authority = Object.freeze({
  repository: 'repository-synthetic',
  pull_request: 'pr-333-synthetic',
  branch: 'branch-synthetic',
  merge_state: 'open-draft-synthetic',
  base: 'base-synthetic',
  head: 'head-synthetic',
  tree: 'tree-synthetic',
  commit_graph: 'graph-synthetic'
});

function c6AuthorityValue(overrides = {}) {
  return { ...c6Authority, ...overrides };
}

function c6ExecutionIdentity(overrides = {}) {
  return {
    provider: 'provider-synthetic',
    canonical_model: 'model-synthetic',
    reasoning: 'reasoning-synthetic',
    assignment_source: 'current-chat-synthetic',
    assignment_evidence_locator: 'assignment-locator-synthetic',
    role: 'technical G4 reviewer',
    surface: 'technical-g4-reviewer',
    run_id: 'run-g4-synthetic',
    session_id: 'session-g4-synthetic',
    turn_id: 'turn-g4-synthetic',
    exact_head: c6Authority.head,
    ...overrides
  };
}

function c6CanonicalTemplateRevision() {
  const source = '_projects/development/repo-auto-code/_main/templates/independent-assurance-audit.prompt.md';
  const text = fs.readFileSync(path.join(repoRoot, source), 'utf8');
  return {
    schema: 'assurance-template/v1',
    source,
    revision: 'DL-329-AUTO-CODE-005-A6-C6',
    digest: 'sha256:' + crypto.createHash('sha256').update(text).digest('hex')
  };
}

function c6CanonicalTemplateText() {
  return fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-auto-code', '_main', 'templates', 'independent-assurance-audit.prompt.md'), 'utf8');
}

function c6EvidenceLocator(domainId, overrides = {}) {
  const locator = {
    source_class: 'authoritative-raw',
    kind: domainId === 'exact-authority-graph' ? 'git-object' :
      domainId === 'cumulative-diff-allowlist' ? 'git-diff' :
        domainId === 'local-validation' ? 'local-command' :
          domainId === 'hosted-checks-exact-head' ? 'ci-check' :
            domainId === 'applicable-archive-ledger-issue-state' ? 'archive' : 'github-api',
    exact_locator: 'raw://repository-synthetic/pr-333-synthetic/' + domainId + '#' + domainId,
    evidence_identity: 'evidence-' + domainId,
    inspected_subject: domainId,
    observed_at: '2026-08-03T23:00:00.000Z',
    accessible: true,
    repository: c6Authority.repository,
    pull_request: c6Authority.pull_request,
    exact_head: c6Authority.head,
    ...overrides
  };
  locator.resolved_locator = locator.resolved_locator || locator.exact_locator;
  locator.resolved_evidence_identity = locator.resolved_evidence_identity || locator.evidence_identity;
  locator.resolved_bytes = locator.resolved_bytes || c6ResolvedEvidenceBytes(locator);
  locator.content_digest = c8DigestBytes(locator.resolved_bytes);
  return locator;
}

function c6ResolvedEvidenceBytes(locator) {
  return c8Json({
    schema: 'resolved-assurance-evidence/v1',
    exact_locator: locator.exact_locator,
    evidence_identity: locator.evidence_identity,
    inspected_subject: locator.inspected_subject,
    repository: locator.repository,
    pull_request: locator.pull_request,
    exact_head: locator.exact_head,
    kind: locator.kind
  });
}

function c6EvidenceDigestReason(locator) {
  if (!locator || locator.source_class !== 'authoritative-raw') return null;
  if (!c8Digest.test(locator.content_digest || '') ||
      typeof locator.resolved_locator !== 'string' || locator.resolved_locator !== locator.exact_locator ||
      typeof locator.resolved_evidence_identity !== 'string' ||
      locator.resolved_evidence_identity !== locator.evidence_identity ||
      typeof locator.resolved_bytes !== 'string' ||
      c8DigestBytes(locator.resolved_bytes) !== locator.content_digest) {
    return 'ASSURANCE_EVIDENCE_DIGEST_INVALID';
  }
  return null;
}

function c6EvidenceRecords(overrides = {}) {
  return Object.fromEntries(c6MandatoryDomainIds.map((domainId) => {
    const observedItems = domainId === 'review-submissions'
      ? [{ id: 'review-1', state: 'completed' }]
      : domainId === 'review-threads'
        ? [
          { id: 'thread-1', resolution: 'open', outdated: false },
          { id: 'thread-2', resolution: 'resolved', outdated: true }
        ]
        : undefined;
    const locator = c6EvidenceLocator(domainId);
    return [domainId, {
      check_id: domainId,
      authoritative_locator: locator,
      evidence_identity: 'evidence-' + domainId,
      evidence_digest: locator.content_digest,
      what_inspected: domainId,
      inspection_result: 'confirmed',
      contradiction: [],
      limitation: [],
      ...(observedItems ? { observed_items: observedItems } : {}),
      ...(overrides[domainId] || {})
    }];
  }));
}

function c6WebVerificationReceipt(overrides = {}) {
  const authority = c6AuthorityValue();
  return {
    schema: 'web-verification/v1',
    receipt_id: 'web-verification-synthetic',
    execution_identity: c6ExecutionIdentity({
      role: 'Web Orchestrator verification',
      surface: 'web-orchestrator',
      run_id: 'run-web-verification-synthetic',
      session_id: 'session-web-verification-synthetic',
      turn_id: 'turn-web-verification-synthetic',
      assignment_source: 'web-current-chat-synthetic',
      assignment_evidence_locator: 'web-assignment-locator-synthetic'
    }),
    authority,
    evidence_universe_digest: 'sha256:evidence-universe-synthetic',
    exact_head_recheck: {
      authority,
      result: 'matches',
      evidence_identity: 'web-head-recheck-synthetic',
      authoritative_locator: c6EvidenceLocator('authority-movement', {
        exact_locator: 'raw://repository-synthetic/pr-333-synthetic/web-head-recheck#authority-movement',
        evidence_identity: 'web-head-recheck-synthetic',
        content_digest: 'sha256:web-head-recheck-synthetic',
        inspected_subject: 'authority-movement'
      })
    },
    receipt_locator: c6EvidenceLocator('authority-movement', {
      exact_locator: 'raw://repository-synthetic/pr-333-synthetic/web-verification#authority-movement',
      evidence_identity: 'web-verification-receipt-synthetic',
      content_digest: 'sha256:web-verification-receipt-synthetic',
      inspected_subject: 'authority-movement'
    }),
    ...overrides
  };
}

function c6LaunchEnvelope(overrides = {}) {
  const envelope = {
    schema: 'assurance-launch/v1',
    envelope_id: 'launch-envelope-synthetic',
    authority: c6AuthorityValue(),
    technical_g4_execution_identity: c6ExecutionIdentity(),
    web_verification_execution_identity: c6WebVerificationReceipt().execution_identity,
    launch_identity: {
      launch_id: 'launch-synthetic',
      run_id: 'run-assurance-launch-synthetic',
      session_id: 'session-assurance-launch-synthetic',
      turn_id: 'turn-assurance-launch-synthetic'
    },
    canonical_template_revision: c6CanonicalTemplateRevision(),
    evidence_universe_revision: {
      revision: 'evidence-universe/v1',
      digest: 'sha256:evidence-universe-synthetic'
    },
    web_verification_receipt: c6WebVerificationReceipt(),
    created_at: '2026-08-03T22:59:00.000Z',
    expires_at: '2026-08-04T00:00:00.000Z',
    lifecycle: {
      state: 'issued',
      consumed: false,
      use_count: 0,
      consumed_at: null
    },
    evidence: c6EvidenceRecords(),
    ...overrides
  };
  envelope.canonical_digest = c6EnvelopeDigest(envelope);
  return envelope;
}

function c6EnvelopeBody(envelope) {
  const body = c8Clone(envelope);
  delete body.canonical_digest;
  delete body.authority_store_path;
  return body;
}

function c6EnvelopeDigest(envelope) {
  return c8DigestBytes(c8Json(c6EnvelopeBody(envelope)));
}

function c6Context(overrides = {}) {
  const assurance_store_path = overrides.assurance_store_path || c8NewAuthorityStorePath('assurance-envelope');
  return {
    authority: c6AuthorityValue(),
    now: '2026-08-03T23:30:00.000Z',
    templateRevision: c6CanonicalTemplateRevision(),
    evidenceUniverseRevision: {
      revision: 'evidence-universe/v1',
      digest: 'sha256:evidence-universe-synthetic'
    },
    requiredReviewSubmissionIds: ['review-1'],
    requiredReviewThreadIds: ['thread-1', 'thread-2'],
    assurance_store_path,
    assuranceRegistry: overrides.assuranceRegistry || new C8DurableAuthorityRegistry(assurance_store_path, 'assurance-envelope'),
    ...overrides
  };
}

function c6ExactAuthorityMatches(actual, expected) {
  return actual && expected && ['repository', 'pull_request', 'branch', 'merge_state', 'base', 'head', 'tree', 'commit_graph']
    .every((field) => actual[field] === expected[field]);
}

function c6CompleteExecutionIdentity(identity, expectedHead) {
  return identity && ['provider', 'canonical_model', 'reasoning', 'assignment_source', 'assignment_evidence_locator', 'role', 'surface', 'run_id', 'session_id', 'turn_id', 'exact_head']
    .every((field) => nonEmptyString(identity[field])) && identity.exact_head === expectedHead;
}

function c6ValidRawLocator(locator, domainId, context) {
  const digestReason = c6EvidenceDigestReason(locator);
  if (!locator || typeof locator !== 'object' || c6ProhibitedSourceClasses.has(locator.source_class) ||
      locator.source_class !== 'authoritative-raw' || !c6RawSourceKinds.has(locator.kind) ||
      !nonEmptyString(locator.exact_locator) || !locator.exact_locator.includes('#' + domainId) ||
      !nonEmptyString(locator.evidence_identity) || !nonEmptyString(locator.content_digest) ||
       !nonEmptyString(locator.inspected_subject) || locator.inspected_subject !== domainId ||
       !nonEmptyString(locator.observed_at) || locator.accessible !== true ||
       locator.repository !== context.authority.repository || locator.pull_request !== context.authority.pull_request ||
       locator.exact_head !== context.authority.head || locator.generic === true || locator.circular === true ||
       locator.narrative_only === true || digestReason) return false;
  return true;
}

function c6ValidEvidenceRecord(record, domainId, context, resultKinds = ['confirmed']) {
  if (!record || record.check_id !== domainId || !c6ValidRawLocator(record.authoritative_locator, domainId, context) ||
      record.evidence_identity !== record.authoritative_locator.evidence_identity ||
      record.evidence_digest !== record.authoritative_locator.content_digest ||
      record.what_inspected !== domainId || !resultKinds.includes(record.inspection_result) ||
      !Array.isArray(record.contradiction) || !Array.isArray(record.limitation)) return false;
  if (domainId === 'review-submissions') {
    if (!Array.isArray(record.observed_items) || !allEqual(record.observed_items.map((item) => item && item.id)) ||
        record.observed_items.length !== context.requiredReviewSubmissionIds.length ||
        record.observed_items.some((item) => !item || !context.requiredReviewSubmissionIds.includes(item.id) || !nonEmptyString(item.state))) return false;
  }
  if (domainId === 'review-threads') {
    if (!Array.isArray(record.observed_items) || record.observed_items.length !== context.requiredReviewThreadIds.length ||
        new Set(record.observed_items.map((item) => item && item.id)).size !== record.observed_items.length ||
        record.observed_items.some((item) => !item || !context.requiredReviewThreadIds.includes(item.id) ||
          !nonEmptyString(item.resolution) || typeof item.outdated !== 'boolean')) return false;
  }
  return true;
}

function c6ValidWebVerificationReceipt(receipt, envelope, context) {
  return receipt && receipt.schema === 'web-verification/v1' && nonEmptyString(receipt.receipt_id) &&
    c6ExactAuthorityMatches(receipt.authority, context.authority) &&
    c6CompleteExecutionIdentity(receipt.execution_identity, context.authority.head) &&
    JSON.stringify(receipt.execution_identity) === JSON.stringify(envelope.web_verification_execution_identity) &&
    receipt.evidence_universe_digest === context.evidenceUniverseRevision.digest &&
    receipt.exact_head_recheck && receipt.exact_head_recheck.result === 'matches' &&
    c6ExactAuthorityMatches(receipt.exact_head_recheck.authority, context.authority) &&
    c6ValidRawLocator(receipt.exact_head_recheck.authoritative_locator, 'authority-movement', context) &&
    receipt.exact_head_recheck.evidence_identity === receipt.exact_head_recheck.authoritative_locator.evidence_identity &&
    c6ValidRawLocator(receipt.receipt_locator, 'authority-movement', context);
}

function c6LaunchAdmission(envelope, context = c6Context()) {
  const invalid = (reason) => ({ decision: reason, temporaryChatCreated: false });
  if (!envelope || envelope.schema !== 'assurance-launch/v1' || !nonEmptyString(envelope.envelope_id) ||
      !envelope.lifecycle || envelope.lifecycle.state !== 'issued' || envelope.lifecycle.consumed !== false ||
      envelope.lifecycle.use_count !== 0 || envelope.lifecycle.consumed_at !== null ||
      !nonEmptyString(envelope.created_at) || !nonEmptyString(envelope.expires_at) ||
      Date.parse(envelope.created_at) > Date.parse(context.now) || Date.parse(envelope.expires_at) <= Date.parse(context.now)) {
    return invalid('ASSURANCE_LAUNCH_INVALID');
  }
  if (!c6ValidWebVerificationReceipt(envelope.web_verification_receipt, envelope, context)) {
    return invalid('WEB_VERIFICATION_REQUIRED');
  }
  if (!envelope.canonical_template_revision ||
      JSON.stringify(envelope.canonical_template_revision) !== JSON.stringify(context.templateRevision)) {
    return invalid('ASSURANCE_TEMPLATE_REQUIRED');
  }
  if (!c6ExactAuthorityMatches(envelope.authority, context.authority)) {
    return invalid('ASSURANCE_HEAD_MISMATCH');
  }
  if (!c6CompleteExecutionIdentity(envelope.technical_g4_execution_identity, context.authority.head) ||
      !c6CompleteExecutionIdentity(envelope.web_verification_execution_identity, context.authority.head) ||
      !envelope.launch_identity || ['launch_id', 'run_id', 'session_id', 'turn_id'].some((field) => !nonEmptyString(envelope.launch_identity[field])) ||
      !envelope.evidence_universe_revision || envelope.evidence_universe_revision.revision !== context.evidenceUniverseRevision.revision ||
      envelope.evidence_universe_revision.digest !== context.evidenceUniverseRevision.digest) {
    return invalid('ASSURANCE_LAUNCH_INVALID');
  }
  if (!envelope.evidence || Object.keys(envelope.evidence).sort().join('|') !== [...c6MandatoryDomainIds].sort().join('|') ||
       c6MandatoryDomainIds.some((domainId) => !c6ValidEvidenceRecord(envelope.evidence[domainId], domainId, context))) {
    const digestFailure = c6MandatoryDomainIds.some((domainId) => c6EvidenceDigestReason(envelope.evidence?.[domainId]?.authoritative_locator));
    if (digestFailure) return invalid('ASSURANCE_EVIDENCE_DIGEST_INVALID');
    return invalid('ASSURANCE_EVIDENCE_INCOMPLETE');
  }
  if (!c8Digest.test(envelope.canonical_digest || '') || envelope.canonical_digest !== c6EnvelopeDigest(envelope)) {
    return invalid('ASSURANCE_LAUNCH_INVALID');
  }
  return { decision: 'ASSURANCE_LAUNCH_ADMITTED', temporaryChatCreated: false };
}

function c6DispatchAssurance(templateText, envelope, context = c6Context()) {
  if (!envelope || typeof envelope !== 'object' || envelope.lifecycle?.consumed === true) return { decision: 'ASSURANCE_ALREADY_CONSUMED', temporaryChatCreated: false };
  const admission = c6LaunchAdmission(envelope, context);
  if (admission.decision !== 'ASSURANCE_LAUNCH_ADMITTED') return admission;
  const requiredTemplateTerms = [
    'assurance-launch/v1',
    'Independently inspect the authoritative raw evidence',
    'Do not treat supplied conclusions as proof',
    'Missing access or missing evidence requires `CONCERN`',
    'Do not claim repository',
    'assurance-evidence/v1'
  ];
  if (templateText !== c6CanonicalTemplateText() || requiredTemplateTerms.some((term) => !templateText.includes(term))) {
    return { decision: 'ASSURANCE_TEMPLATE_REQUIRED', temporaryChatCreated: false };
  }
  const registry = context.assuranceRegistry || new C8DurableAuthorityRegistry(context.assurance_store_path, 'assurance-envelope');
  const registered = registry.register(envelope);
  if (registered.reason === 'AUTHORITY_ALREADY_CONSUMED') return { decision: 'ASSURANCE_ALREADY_CONSUMED', temporaryChatCreated: false };
  if (!['AUTHORITY_REGISTERED', 'AUTHORITY_ALREADY_REGISTERED'].includes(registered.decision)) {
    return { decision: 'ASSURANCE_LAUNCH_INVALID', temporaryChatCreated: false };
  }
  const consumedResult = registry.consume(envelope, { expectedState: 'issued', consumed_at: context.now });
  if (consumedResult.reason === 'AUTHORITY_ALREADY_CONSUMED') return { decision: 'ASSURANCE_ALREADY_CONSUMED', temporaryChatCreated: false };
  if (consumedResult.decision !== 'AUTHORITY_CONSUMED') return { decision: 'ASSURANCE_LAUNCH_INVALID', temporaryChatCreated: false };
  return {
    decision: 'ASSURANCE_DISPATCHED',
    temporaryChatCreated: true,
    launchEnvelope: consumedResult.record,
    renderedPrompt: templateText
  };
}

function c6SeparationEvidence() {
  return {
    schema: 'context-separation/v1',
    separate_from: [...c6ProhibitedContexts],
    records: c6ProhibitedContexts.map((contextName) => ({
      context: contextName,
      separation_locator: c6EvidenceLocator('authority-movement', {
        exact_locator: 'raw://repository-synthetic/pr-333-synthetic/separation/' + contextName + '#authority-movement',
        evidence_identity: 'separation-' + contextName,
        content_digest: 'sha256:separation-' + contextName,
        inspected_subject: 'authority-movement'
      }),
      evidence_identity: 'separation-' + contextName
    }))
  };
}

function c6ConsumedLaunch(context = c6Context()) {
  const result = c6DispatchAssurance(c6CanonicalTemplateText(), c6LaunchEnvelope(), context);
  assert.equal(result.decision, 'ASSURANCE_DISPATCHED');
  return result.launchEnvelope;
}

function c6AssuranceReceipt(launchEnvelope = c6ConsumedLaunch(), overrides = {}) {
  const authority = c6AuthorityValue();
  const temporaryIdentity = c6ExecutionIdentity({
    provider: 'provider-temporary-synthetic',
    canonical_model: 'model-temporary-synthetic',
    reasoning: 'reasoning-temporary-synthetic',
    role: 'Web Temporary Chat assurance auditor',
    surface: 'web-temporary-chat',
    run_id: 'run-temporary-synthetic',
    session_id: 'session-temporary-synthetic',
    turn_id: 'turn-temporary-synthetic',
    assignment_source: 'web-current-chat-synthetic',
    assignment_evidence_locator: 'web-assurance-assignment-synthetic'
  });
  return {
    schema: 'assurance-evidence/v1',
    verdict: 'CLEAR',
    authority,
    launch_envelope_identity: {
      envelope_id: launchEnvelope.envelope_id,
      ...launchEnvelope.launch_identity
    },
    temporary_chat_execution_identity: temporaryIdentity,
    assignment_provenance: {
      source: temporaryIdentity.assignment_source,
      evidence_locator: temporaryIdentity.assignment_evidence_locator
    },
    technical_g4_execution_identity: launchEnvelope.technical_g4_execution_identity,
    prohibited_context_separation: c6SeparationEvidence(),
    checks: Object.values(launchEnvelope.evidence).map((record) => ({
      check_id: record.check_id,
      authoritative_locator: { ...record.authoritative_locator },
      evidence_identity: record.evidence_identity,
      evidence_digest: record.evidence_digest,
      what_inspected: record.what_inspected,
      inspection_result: 'confirmed',
      contradiction: [],
      limitation: [],
      ...(record.observed_items ? { observed_items: record.observed_items } : {})
    })),
    missing_evidence: [],
    final_head_recheck: {
      authority,
      result: 'matches',
      evidence_identity: 'temporary-final-head-recheck',
      authoritative_locator: c6EvidenceLocator('authority-movement', {
        exact_locator: 'raw://repository-synthetic/pr-333-synthetic/temporary-final-head#authority-movement',
        evidence_identity: 'temporary-final-head-recheck',
        content_digest: 'sha256:temporary-final-head-recheck',
        inspected_subject: 'authority-movement'
      })
    },
    receipt_creation: {
      identity: 'temporary-chat-execution-synthetic',
      created_at: '2026-08-03T23:31:00.000Z',
      sequence: 1
    },
    non_authority_attestation: {
      schema: 'non-authority/v1',
      ...Object.fromEntries(c6NonAuthorityFields.map((field) => [field, false]))
    },
    ...overrides
  };
}

function c6ReceiptCheckValid(check, domainId, launchEnvelope, context, resultKinds) {
  const expected = launchEnvelope.evidence[domainId];
  return c6ValidEvidenceRecord(check, domainId, context, resultKinds) &&
    check.evidence_identity === expected.evidence_identity && check.evidence_digest === expected.evidence_digest &&
    JSON.stringify(check.authoritative_locator) === JSON.stringify(expected.authoritative_locator);
}

function c6ReceiptAdmission(receipt, launchEnvelope, context = c6Context()) {
  const clearFailure = (reason = 'ASSURANCE_CLEAR_UNSUPPORTED') => ({
    decision: receipt && receipt.verdict === 'CLEAR' ? reason : 'ASSURANCE_RECEIPT_INVALID',
    operationalVerdict: receipt && receipt.verdict === 'CLEAR' ? 'CONCERN' : null,
    mergeAuthorized: false
  });
  if (!receipt || !['CLEAR', 'CONCERN'].includes(receipt.verdict) || receipt.schema !== 'assurance-evidence/v1') return clearFailure();
  if (!launchEnvelope || launchEnvelope.lifecycle.consumed !== true || launchEnvelope.lifecycle.state !== 'consumed' || launchEnvelope.lifecycle.use_count !== 1) {
    return clearFailure('ASSURANCE_LAUNCH_INVALID');
  }
  if (!c6ExactAuthorityMatches(receipt.authority, context.authority) || !c6ExactAuthorityMatches(receipt.final_head_recheck && receipt.final_head_recheck.authority, context.authority) ||
      !receipt.final_head_recheck || receipt.final_head_recheck.result !== 'matches' ||
      !c6ValidRawLocator(receipt.final_head_recheck.authoritative_locator, 'authority-movement', context)) {
    return clearFailure('ASSURANCE_HEAD_MISMATCH');
  }
  const launchIdentity = receipt.launch_envelope_identity;
  if (!launchIdentity || launchIdentity.envelope_id !== launchEnvelope.envelope_id ||
      ['launch_id', 'run_id', 'session_id', 'turn_id'].some((field) => launchIdentity[field] !== launchEnvelope.launch_identity[field])) {
    return clearFailure('ASSURANCE_LAUNCH_INVALID');
  }
  if (!c6CompleteExecutionIdentity(receipt.temporary_chat_execution_identity, context.authority.head) ||
      receipt.temporary_chat_execution_identity.role !== 'Web Temporary Chat assurance auditor' ||
      receipt.temporary_chat_execution_identity.surface !== 'web-temporary-chat' ||
      !receipt.assignment_provenance || receipt.assignment_provenance.source !== receipt.temporary_chat_execution_identity.assignment_source ||
      receipt.assignment_provenance.evidence_locator !== receipt.temporary_chat_execution_identity.assignment_evidence_locator ||
      JSON.stringify(receipt.technical_g4_execution_identity) !== JSON.stringify(launchEnvelope.technical_g4_execution_identity)) return clearFailure();

  const separation = receipt.prohibited_context_separation;
  if (!separation || separation.schema !== 'context-separation/v1' ||
      JSON.stringify(separation.separate_from && [...separation.separate_from].sort()) !== JSON.stringify([...c6ProhibitedContexts].sort()) ||
      !Array.isArray(separation.records) || separation.records.length !== c6ProhibitedContexts.length ||
      separation.records.some((record) => !record || !c6ProhibitedContexts.includes(record.context) ||
        !c6ValidRawLocator(record.separation_locator, 'authority-movement', context) ||
        record.evidence_identity !== record.separation_locator.evidence_identity)) return clearFailure();

  if (!Array.isArray(receipt.checks) || receipt.checks.length !== c6MandatoryDomainIds.length ||
      new Set(receipt.checks.map((check) => check && check.check_id)).size !== receipt.checks.length ||
      c6MandatoryDomainIds.some((domainId) => !c6ReceiptCheckValid(receipt.checks.find((check) => check && check.check_id === domainId), domainId, launchEnvelope, context,
        ['confirmed', 'concern', 'inaccessible', 'contradiction']))) return clearFailure();
  if (!Array.isArray(receipt.missing_evidence) || new Set(receipt.missing_evidence).size !== receipt.missing_evidence.length ||
      receipt.missing_evidence.some((domainId) => !c6MandatoryDomainIds.includes(domainId))) return clearFailure();
  if (!receipt.receipt_creation || !nonEmptyString(receipt.receipt_creation.identity) || !nonEmptyString(receipt.receipt_creation.created_at) ||
      !Number.isInteger(receipt.receipt_creation.sequence) || receipt.receipt_creation.sequence < 1) return clearFailure();
  if (!receipt.non_authority_attestation || receipt.non_authority_attestation.schema !== 'non-authority/v1' ||
      c6NonAuthorityFields.some((field) => receipt.non_authority_attestation[field] !== false)) return clearFailure();

  const invalidClearEvidence = receipt.missing_evidence.length > 0 || receipt.checks.some((check) =>
    check.inspection_result !== 'confirmed' || check.contradiction.length > 0 || check.limitation.length > 0);
  if (receipt.verdict === 'CLEAR' && invalidClearEvidence) return clearFailure();
  if (receipt.verdict === 'CONCERN' && !invalidClearEvidence) return clearFailure();
  return { decision: receipt.verdict, operationalVerdict: receipt.verdict, mergeAuthorized: false };
}

test('A6-C6 requires a closed exact-head assurance launch envelope', () => {
  const envelope = c6LaunchEnvelope();
  const result = c6LaunchAdmission(envelope);
  assert.equal(result.decision, 'ASSURANCE_LAUNCH_ADMITTED');
  assert.equal(result.temporaryChatCreated, false);
  assertA6Terms(['assurance-launch/v1', 'evidence-universe revision or digest', 'one-use lifecycle', 'ASSURANCE_LAUNCH_INVALID']);
});

test('A6-C6 narrative-only packet cannot launch Temporary Chat', () => {
  const evidence = Object.fromEntries(c6MandatoryDomainIds.map((domainId) => [domainId, {
    check_id: domainId,
    source_class: 'controller-narrative',
    conclusion: 'internally consistent'
  }]));
  const result = c6DispatchAssurance(c6CanonicalTemplateText(), c6LaunchEnvelope({ evidence }));
  assert.equal(result.decision, 'ASSURANCE_EVIDENCE_INCOMPLETE');
  assert.equal(result.temporaryChatCreated, false);
});

test('A6-C6 a controller verified statement without raw locators is context only', () => {
  const receipt = c6WebVerificationReceipt({ conclusion: 'verified' });
  delete receipt.receipt_locator;
  const result = c6LaunchAdmission(c6LaunchEnvelope({ web_verification_receipt: receipt }));
  assert.equal(result.decision, 'WEB_VERIFICATION_REQUIRED');
  assert.equal(result.temporaryChatCreated, false);
});

test('A6-C6 rejects a Gate 4 packet used as mandatory assurance evidence', () => {
  const evidence = Object.fromEntries(c6MandatoryDomainIds.map((domainId) => [domainId, {
    check_id: domainId,
    source_class: 'g4-packet',
    technical_verdict: 'PASS'
  }]));
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE');
});

test('A6-C6 rejects an executor terminal packet used as mandatory assurance evidence', () => {
  const evidence = Object.fromEntries(c6MandatoryDomainIds.map((domainId) => [domainId, {
    check_id: domainId,
    source_class: 'executor-terminal-packet',
    final_head: c6Authority.head
  }]));
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE');
});

test('A6-C6 fails closed when Web has no repository verification receipt or access', () => {
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ web_verification_receipt: null })).decision, 'WEB_VERIFICATION_REQUIRED');
  const inaccessible = c6EvidenceRecords();
  inaccessible['repository-pr-branch-merge'].authoritative_locator.accessible = false;
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence: inaccessible })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE');
});

test('A6-C6 rejects missing cumulative diff, hosted checks, review submissions, or a review thread', () => {
  for (const domainId of ['cumulative-diff-allowlist', 'hosted-checks-exact-head', 'review-submissions']) {
    const evidence = c6EvidenceRecords();
    delete evidence[domainId];
    assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE', domainId);
  }
  const evidence = c6EvidenceRecords({
    'review-threads': {
      observed_items: [{ id: 'thread-1', resolution: 'open', outdated: false }]
    }
  });
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE', 'review thread');
});

test('A6-C6 requires an exact inspected locator rather than a generic PR URL', () => {
  const evidence = c6EvidenceRecords({
    'repository-pr-branch-merge': {
      authoritative_locator: c6EvidenceLocator('repository-pr-branch-merge', {
        exact_locator: 'https://github.example/repository-synthetic/pull/333'
      })
    }
  });
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE');
});

test('A6-C6 candidate rawEvidence, valid, and verified labels cannot replace raw locators', () => {
  const evidence = Object.fromEntries(c6MandatoryDomainIds.map((domainId) => [domainId, {
    check_id: domainId,
    rawEvidence: true,
    valid: true,
    verified: true,
    result: 'CLEAR'
  }]));
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ evidence })).decision, 'ASSURANCE_EVIDENCE_INCOMPLETE');
});

test('A6-C6 rejects stale head and tree authority before creating Temporary Chat', () => {
  assert.equal(c6DispatchAssurance(c6CanonicalTemplateText(), c6LaunchEnvelope({ authority: c6AuthorityValue({ head: 'moved-head-synthetic' }) })).decision, 'ASSURANCE_HEAD_MISMATCH');
  assert.equal(c6DispatchAssurance(c6CanonicalTemplateText(), c6LaunchEnvelope({ authority: c6AuthorityValue({ tree: 'moved-tree-synthetic' }) })).decision, 'ASSURANCE_HEAD_MISMATCH');
});

test('A6-C6 rejects replayed or consumed launch envelopes', () => {
  const context = c6Context();
  const dispatched = c6DispatchAssurance(c6CanonicalTemplateText(), c6LaunchEnvelope(), context);
  assert.equal(dispatched.temporaryChatCreated, true);
  assert.equal(c6LaunchAdmission(dispatched.launchEnvelope, context).decision, 'ASSURANCE_LAUNCH_INVALID');
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ lifecycle: {
    state: 'consumed', consumed: true, use_count: 1, consumed_at: context.now
  } }), context).decision, 'ASSURANCE_LAUNCH_INVALID');
});

test('A6-C6 rejects missing canonical template revision and expired launch envelopes', () => {
  const missingTemplate = c6LaunchEnvelope();
  delete missingTemplate.canonical_template_revision;
  assert.equal(c6LaunchAdmission(missingTemplate).decision, 'ASSURANCE_TEMPLATE_REQUIRED');
  assert.equal(c6LaunchAdmission(c6LaunchEnvelope({ expires_at: '2026-08-03T23:29:00.000Z' })).decision, 'ASSURANCE_LAUNCH_INVALID');
});

test('A6-C6 rejects a hand-written prompt that omits the canonical assurance contract', () => {
  const result = c6DispatchAssurance('Check whether the supplied narrative is internally consistent.', c6LaunchEnvelope());
  assert.equal(result.decision, 'ASSURANCE_TEMPLATE_REQUIRED');
  assert.equal(result.temporaryChatCreated, false);
});

test('A6-C6 rejects a bare CLEAR receipt', () => {
  const launch = c6ConsumedLaunch();
  const result = c6ReceiptAdmission({ verdict: 'CLEAR' }, launch);
  assert.equal(result.decision, 'ASSURANCE_CLEAR_UNSUPPORTED');
  assert.equal(result.operationalVerdict, 'CONCERN');
});

test('A6-C6 rejects a CLEAR receipt with an empty check list', () => {
  const launch = c6ConsumedLaunch();
  const result = c6ReceiptAdmission(c6AssuranceReceipt(launch, { checks: [] }), launch);
  assert.equal(result.decision, 'ASSURANCE_CLEAR_UNSUPPORTED');
  assert.equal(result.operationalVerdict, 'CONCERN');
});

test('A6-C6 rejects a receipt with a narrative locator', () => {
  const launch = c6ConsumedLaunch();
  const receipt = c6AssuranceReceipt(launch);
  receipt.checks[0].authoritative_locator = {
    source_class: 'controller-narrative',
    exact_locator: 'narrative://controller/verified',
    evidence_identity: 'narrative-only',
    content_digest: 'copied-summary',
    inspected_subject: c6MandatoryDomainIds[0],
    observed_at: '2026-08-03T23:31:00.000Z',
    accessible: true,
    repository: c6Authority.repository,
    pull_request: c6Authority.pull_request,
    exact_head: c6Authority.head
  };
  const result = c6ReceiptAdmission(receipt, launch);
  assert.equal(result.decision, 'ASSURANCE_CLEAR_UNSUPPORTED');
  assert.equal(result.operationalVerdict, 'CONCERN');
});

test('A6-C6 rejects a CLEAR receipt claiming inspection while evidence is inaccessible', () => {
  const launch = c6ConsumedLaunch();
  const receipt = c6AssuranceReceipt(launch);
  receipt.checks[0].inspection_result = 'inaccessible';
  receipt.checks[0].limitation = ['authoritative evidence could not be accessed'];
  const result = c6ReceiptAdmission(receipt, launch);
  assert.equal(result.decision, 'ASSURANCE_CLEAR_UNSUPPORTED');
  assert.equal(result.operationalVerdict, 'CONCERN');
});

test('A6-C6 rejects a receipt with missing prohibited-context separation', () => {
  const launch = c6ConsumedLaunch();
  const receipt = c6AssuranceReceipt(launch);
  delete receipt.prohibited_context_separation;
  const result = c6ReceiptAdmission(receipt, launch);
  assert.equal(result.decision, 'ASSURANCE_CLEAR_UNSUPPORTED');
  assert.equal(result.operationalVerdict, 'CONCERN');
});

test('A6-C6 admits one complete exact-head CLEAR without merge authority', () => {
  const launch = c6ConsumedLaunch();
  const result = c6ReceiptAdmission(c6AssuranceReceipt(launch), launch);
  assert.deepEqual(result, { decision: 'CLEAR', operationalVerdict: 'CLEAR', mergeAuthorized: false });
});

test('A6-C6 admits one complete evidence-backed CONCERN without technical authority', () => {
  const launch = c6ConsumedLaunch();
  const receipt = c6AssuranceReceipt(launch, { verdict: 'CONCERN' });
  receipt.checks[0].inspection_result = 'concern';
  receipt.checks[0].contradiction = ['raw evidence contradicts the expected state'];
  const result = c6ReceiptAdmission(receipt, launch);
  assert.deepEqual(result, { decision: 'CONCERN', operationalVerdict: 'CONCERN', mergeAuthorized: false });
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
      fresh_assurance_after_verification: 'Exceptional assurance requires an exact explicit pre-dispatch grant; when granted, one fresh Temporary Chat follows final exact-head PASS and independent Web verification.',
      bounded_non_authority: 'The Temporary Chat independently checks evidence, records both execution identities, returns only CLEAR or CONCERN, and has no finality or GitHub authority.'
    },
    evidence: {
      technical_function_and_independent_assignment: ['g4_role', 'g4_provider', 'g4_canonical_model', 'g4_reasoning', 'assignment_source'],
      fresh_assurance_after_verification: ['assurance_grant', 'g4_verdict', 'final_exact_head', 'web_verified', 'fresh_temporary_chat_count'],
      bounded_non_authority: ['g4_execution_identity', 'web_execution_identity', 'independent_evidence', 'verdict', 'merge_authority']
    }
  },
  'ASSURANCE-EVIDENCE-ENFORCEMENT-001': {
    semantics: {
      closed_launch_envelope: 'Exceptional Temporary Chat creation requires an exact grant and one exact-head assurance-launch/v1 envelope with bound identities, template and evidence revisions, expiry, and one-use state.',
      authoritative_raw_domain_proof: 'Every mandatory assurance domain is proved by an accessible authoritative raw locator that identifies the exact inspected evidence and digest; narratives and packets are context only.',
      structured_receipt_admission: 'Web admits only an assurance-evidence/v1 receipt with every check, exact launch/head identity, context separation, final recheck, and non-authority attestation; unsupported CLEAR becomes operational CONCERN.'
    },
    evidence: {
      closed_launch_envelope: ['launch_schema', 'repository', 'pull_request', 'base', 'head', 'tree', 'commit_graph', 'g4_execution_identity', 'web_verification_execution_identity', 'launch_identity', 'template_revision', 'evidence_universe_revision', 'created_at', 'expires_at', 'consumed', 'use_count'],
      authoritative_raw_domain_proof: ['mandatory_domain_ids', 'authoritative_locator', 'source_class', 'exact_locator', 'evidence_identity', 'content_digest', 'what_inspected', 'accessible'],
      structured_receipt_admission: ['receipt_schema', 'verdict', 'launch_envelope_identity', 'temporary_chat_execution_identity', 'technical_g4_execution_identity', 'prohibited_context_separation', 'checks', 'missing_evidence', 'final_head_recheck', 'receipt_creation', 'non_authority_attestation']
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
const negativeTestContracts = new Map();
const c4ReplacementInvariantBundle = Object.freeze({
  semantics: { replacement_receipt: 'The replacement receipt contract is complete.' },
  evidence: { replacement_receipt: ['replacement_receipt_contract'] }
});

function c4NegativeMutationContract(invariantId) {
  const initialExpected = expectedInvariantBundles[invariantId] || (invariantId === 'AUTH-LEDGER-RECEIPT-REPLACEMENT-001' ? c4ReplacementInvariantBundle : null);
  const initialSemanticId = initialExpected ? Object.keys(initialExpected.semantics)[0] : 'replacement_receipt';
  return Object.freeze({
    semantic_id: initialSemanticId,
    field: 'required_semantics.' + initialSemanticId + '.requirement',
    expected_requirement: initialExpected ? initialExpected.semantics[initialSemanticId] : 'The replacement receipt contract is complete.',
    mutate(candidate) {
      const broken = c8Clone(candidate);
      if (broken.status === 'amended' && broken.design_lock_change && broken.design_lock_change.replacement &&
          Array.isArray(broken.design_lock_change.replacement.required_semantics) &&
          broken.design_lock_change.replacement.required_semantics.length > 0) {
        const semantic = broken.design_lock_change.replacement.required_semantics[0];
        const field = 'design_lock_change.replacement.required_semantics.0.requirement';
        const expectedRequirement = semantic.requirement;
        semantic.requirement = '__substantive-negative-contract__';
        return { candidate: broken, behavioral_violation: { field, semantic_id: semantic.semantic_id, expected: expectedRequirement, observed: semantic.requirement } };
      }
      if (broken.status === 'removed' && broken.design_lock_change && broken.design_lock_change.disposal) {
        const field = 'design_lock_change.disposal.reason';
        const expectedReason = broken.design_lock_change.disposal.reason;
        broken.design_lock_change.disposal.reason = '';
        return { candidate: broken, behavioral_violation: { field, expected: expectedReason, observed: broken.design_lock_change.disposal.reason } };
      }
      const expected = expectedInvariantBundles[invariantId] || (invariantId === 'AUTH-LEDGER-RECEIPT-REPLACEMENT-001' ? c4ReplacementInvariantBundle : null);
      const expectedSemanticIds = expected ? Object.keys(expected.semantics) : [initialSemanticId];
      const semantic = Array.isArray(broken.required_semantics) && broken.required_semantics.find((entry) => entry && expectedSemanticIds.includes(entry.semantic_id));
      if (!semantic) return { candidate: broken, behavioral_violation: false };
      const semanticId = semantic.semantic_id;
      const expectedRequirement = expected ? expected.semantics[semanticId] : 'The replacement receipt contract is complete.';
      const field = 'required_semantics.' + semanticId + '.requirement';
      semantic.requirement = '__substantive-negative-contract__';
      return { candidate: broken, behavioral_violation: { field, semantic_id: semanticId, expected: expectedRequirement, observed: semantic.requirement } };
    }
  });
}

function registerNegativeTestContracts(invariantIds) {
  for (const invariantId of invariantIds) {
    if (negativeTestContracts.has(invariantId)) continue;
    const reference = negativeTestReference(invariantId);
    negativeTestContracts.set(invariantId, Object.freeze({
      invariant_id: invariantId,
      negative_test_id: reference,
      reference,
      required_outcome: 'INVARIANT_REGRESSION',
      behavioral_contract: c4NegativeMutationContract(invariantId),
      execute(record, evaluate) {
        const candidate = c8Clone(record || {
          invariant_id: invariantId,
          source_authority: 'registered-negative-contract',
          required_semantics: [],
          candidate_evidence: [],
          negative_test: reference,
          status: 'preserved',
          authorising_design_lock: 'DL-329-AUTO-CODE-005-A6-C4'
        });
        const mutation = this.behavioral_contract.mutate(candidate);
        return {
          invariant_id: invariantId,
          negative_test_id: reference,
          candidate: mutation.candidate,
          behavioral_violation: mutation.behavioral_violation,
          outcome: evaluate(mutation.candidate)
        };
      }
    }));
  }
}

function negativeTestRegistrationFor(invariantId, registrations) {
  if (registrations instanceof Map) {
    const registration = registrations.get(invariantId);
    return registration && registration.invariant_id === invariantId ? registration : null;
  }
  if (!Array.isArray(registrations)) return null;
  const matches = registrations.filter((entry) => entry && entry.invariant_id === invariantId);
  return matches.length === 1 ? matches[0] : null;
}

function negativeContractProof(record, expected, registrations = negativeTestContracts) {
  const registration = record && negativeTestRegistrationFor(record.invariant_id, registrations);
  if (!registration || registration.invariant_id !== record.invariant_id ||
      registration.negative_test_id !== registration.reference || record.negative_test !== registration.reference ||
      registration.required_outcome !== 'INVARIANT_REGRESSION' || !registration.behavioral_contract ||
      typeof registration.behavioral_contract.mutate !== 'function' || typeof registration.execute !== 'function') return false;
  try {
    const proofExpected = expected || (record.invariant_id === 'AUTH-LEDGER-RECEIPT-REPLACEMENT-001' ? c4ReplacementInvariantBundle : null);
    if (!proofExpected || invariantDecision(record, proofExpected, { skipNegativeContract: true, registrations }) !== 'PRESERVED') return false;
    const independentMutation = registration.behavioral_contract.mutate(c8Clone(record));
    if (!independentMutation || !independentMutation.behavioral_violation || !independentMutation.candidate ||
        invariantDecision(independentMutation.candidate, proofExpected, { skipNegativeContract: true, registrations }) !== registration.required_outcome) return false;
    const result = registration.execute(c8Clone(record), (candidate) => invariantDecision(candidate, proofExpected, { skipNegativeContract: true, registrations }));
    return result && result.invariant_id === record.invariant_id && result.negative_test_id === record.negative_test &&
      result.candidate && result.candidate.invariant_id === record.invariant_id &&
      result.candidate.negative_test === registration.negative_test_id &&
      result.behavioral_violation &&
      result.outcome === registration.required_outcome &&
      c8Json(result.candidate) === c8Json(independentMutation.candidate) &&
      proofExpected && invariantDecision(result.candidate, proofExpected, { skipNegativeContract: true, registrations }) === registration.required_outcome;
  } catch {
    return false;
  }
}

function validNegativeTestRegistration(record, expected) {
  return !!record && negativeContractProof(record, expected);
}

function validateNegativeTestRegistry(records, registrations = negativeTestContracts) {
  if (!Array.isArray(records) || records.length === 0) return 'INVARIANT_REGRESSION';
  const recordIds = records.map((record) => record && record.invariant_id);
  if (recordIds.some((id) => !nonEmptyString(id) || !expectedInvariantBundles[id]) ||
      new Set(recordIds).size !== recordIds.length) return 'INVARIANT_REGRESSION';
  const pairs = registrations instanceof Map
    ? [...registrations.entries()]
    : Array.isArray(registrations) ? registrations.map((entry) => [undefined, entry]) : null;
  if (!pairs) return 'INVARIANT_REGRESSION';
  if (registrations instanceof Map && pairs.some(([key, entry]) => key !== entry?.invariant_id)) return 'INVARIANT_REGRESSION';
  const entries = pairs.map(([, entry]) => entry);
  if (!Array.isArray(entries) || entries.some((entry) => !entry || !nonEmptyString(entry.invariant_id)) ||
      new Set(entries.map((entry) => entry.invariant_id)).size !== entries.length ||
      entries.some((entry) => !recordIds.includes(entry.invariant_id) && entry.invariant_id !== 'AUTH-LEDGER-RECEIPT-REPLACEMENT-001')) return 'INVARIANT_REGRESSION';
  if (entries.length < recordIds.length) return 'INVARIANT_REGRESSION';
  const lookup = new Map(entries.map((entry) => [entry.invariant_id, entry]));
  for (const record of records) {
    if (!negativeTestRegistrationFor(record.invariant_id, lookup) ||
        invariantDecision(record, expectedInvariantBundles[record.invariant_id], { registrations: lookup }) !== 'PRESERVED') return 'INVARIANT_REGRESSION';
  }
  return 'PRESERVED';
}
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
      !validNegativeTestRegistration(replacement)) return false;
  const semantics = new Set(replacement.required_semantics.map((entry) => entry && entry.semantic_id));
  const evidence = new Set(replacement.candidate_evidence.map((entry) => entry && entry.semantic_id));
  const valid = !semantics.has(undefined) && semantics.size === replacement.required_semantics.length &&
    !evidence.has(undefined) && evidence.size === replacement.candidate_evidence.length &&
    replacement.required_semantics.every((entry) => nonEmptyString(entry.requirement)) &&
    replacement.candidate_evidence.every((entry) => Array.isArray(entry.evidence_fields) && entry.evidence_fields.length > 0) &&
    [...semantics].every((semanticId) => evidence.has(semanticId));
  return valid;
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

function invariantDecision(record, expected, options = {}) {
  if (!record || invariantRequiredFields.some((field) => !Object.hasOwn(record, field))) return 'INVARIANT_REGRESSION';
  if (typeof record.invariant_id !== 'string' || typeof record.source_authority !== 'string' ||
      typeof record.negative_test !== 'string' || typeof record.authorising_design_lock !== 'string' ||
      !['preserved', 'amended', 'removed'].includes(record.status) ||
      !Array.isArray(record.required_semantics) || !Array.isArray(record.candidate_evidence)) {
    return 'INVARIANT_REGRESSION';
  }
  const registrations = options.registrations || negativeTestContracts;
  const registration = negativeTestRegistrationFor(record.invariant_id, registrations);
  if (!registration || registration.invariant_id !== record.invariant_id ||
      registration.negative_test_id !== registration.reference || record.negative_test !== registration.reference) return 'INVARIANT_REGRESSION';
  if (!options.skipNegativeContract && !negativeContractProof(record, expected, registrations)) return 'INVARIANT_REGRESSION';
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
  assert.equal(validateNegativeTestRegistry(registry.invariants), 'PRESERVED');
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
      source_authority: 'synthetic replacement contract',
      status: 'preserved',
      authorising_design_lock: 'DL-329-AUTO-CODE-005-A6-C5',
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
  const grant = {
    schema: 'toolkit-admission-grant/v1',
    grant_id: 'grant-synthetic-' + (++structuredGrant.sequence),
    authority_store_path: c8NewAuthorityStorePath('admission-grant'),
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
    lifecycle: {
      state: 'issued',
      consumed: false,
      use_count: 0,
      consumed_at: null
    },
    ...overrides
  };
  grant.canonical_digest = c5GrantDigest(grant);
  return grant;
}
structuredGrant.sequence = 0;

function c5GrantBody(grant) {
  const body = c8Clone(grant);
  delete body.canonical_digest;
  delete body.authority_store_path;
  return body;
}

function c5GrantDigest(grant) {
  return c8DigestBytes(c8Json(c5GrantBody(grant)));
}

function normaliseAdmissionOperation(operation) {
  return operation === 'Agent' || operation === 'spawn_agent' ? 'spawn_agent' : operation;
}

function grantMatches(request, context, grant) {
  if (!grant || grant.schema !== 'toolkit-admission-grant/v1' || !nonEmptyString(grant.grant_id) ||
      !nonEmptyString(grant.authority_store_path) || !c8Digest.test(grant.canonical_digest || '') ||
      grant.canonical_digest !== c5GrantDigest(grant) || grant.rawEvidence !== true || grant.issuer !== 'web-orchestrator' ||
      grant.explicit_current_turn_user_request !== true || grant.consumed !== false || grant.inheritance !== false ||
      !grant.lifecycle || grant.lifecycle.state !== 'issued' || grant.lifecycle.consumed !== false ||
      grant.lifecycle.use_count !== 0 || grant.lifecycle.consumed_at !== null ||
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

function admissionDecision(request, context, grant, hook, authorityRegistry) {
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
  const registry = authorityRegistry || new C8DurableAuthorityRegistry(grant.authority_store_path, 'admission-grant');
  const registered = registry.register(grant);
  if (registered.reason === 'AUTHORITY_ALREADY_CONSUMED') return denied('GRANT_ALREADY_CONSUMED');
  if (!['AUTHORITY_REGISTERED', 'AUTHORITY_ALREADY_REGISTERED'].includes(registered.decision)) return denied('GRANT_DURABLE_STATE_INVALID');
  const consumed = registry.consume(grant, { expectedState: 'issued', consumed_at: context.now });
  if (consumed.reason === 'AUTHORITY_ALREADY_CONSUMED') return denied('GRANT_ALREADY_CONSUMED');
  if (consumed.decision !== 'AUTHORITY_CONSUMED') return denied('GRANT_DURABLE_STATE_INVALID');
  return {
    allowed: true,
    prevented: false,
    mode: operation === 'fast' ? 'FAST' : grant.allow_fast === true ? 'AGENT_FAST' : 'AGENT_STANDARD',
    reason: 'ADMITTED',
    fastAllowed: operation === 'fast' || grant.allow_fast === true,
    delegationAllowed: operation === 'spawn_agent',
    grant: { ...consumed.record, consumed: true }
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

designLockChain.push('DL-329-AUTO-CODE-005-A6-C7', 'DL-329-AUTO-CODE-005-A6-C8');
const c8InvariantBundles = {
  'C7-FINALITY-WEB-GATE-001': { semantics: {
    conjunctive_finality: 'Review/amend convergence, one fresh exact-head G4 PASS, a complete terminal packet, and comprehensive independent Web verification are all required at the same exact head.',
    web_sole_final_authority: 'Web is the sole comprehensive final authority; root, manager, worker, reviewer, and assurance surfaces are evidence-only.',
    contradiction_rejection: 'Root, manager, worker, reviewer, or assurance claims of finality, acceptance, merge, closure, waiver, or Web authority reject finality.',
    direct_amend: 'Web may return AMEND directly for a live contradiction or missing predicate without a second technical review.',
    routine_assurance_not_required: 'A routine Temporary Chat and CLEAR/CONCERN assurance are not normal-path finality predicates.'
  }, evidence: {
    conjunctive_finality: ['review_amend_convergence', 'fresh_exact_head_g4_pass', 'complete_terminal_packet', 'comprehensive_web_verification'],
    web_sole_final_authority: ['web_execution_identity', 'web_final_verdict', 'root_role', 'manager_role', 'worker_role', 'reviewer_role', 'assurance_role'],
    contradiction_rejection: ['authority_claims', 'contradiction_scan', 'finality_decision'],
    direct_amend: ['web_verdict', 'amend_reason', 'second_review_not_required'],
    routine_assurance_not_required: ['temporary_chat_count', 'assurance_verdict', 'normal_path_predicates']
  }},
  'C8-AUTHORITY-SNAPSHOT-LEASE-001': { semantics: {
    deterministic_authority_snapshot: 'The toolkit-authority-snapshot/v1 is canonical sorted JSON with a SHA-256 digest over the complete relevant authority and full 40-character Git object identifiers.',
    relevant_authority_projection: 'Admission hashes the relevant child, PR, parent-entry, Design Lock, scope, base, head, tree, and authorised blob authority while ignoring unrelated sibling-parent movement.',
    immutable_one_run_lease: 'A toolkit-authority-lease/v1 is one-run, immutable after sealing, bound to the snapshot digest, and consumed at most once.',
    machine_byte_agreement: 'Machine-collected GitHub and local authority agree byte-for-byte before snapshot and lease admission.',
    manifest_round_trip: 'toolkit-authority-manifest/v1 render and extraction reproduce canonical bytes and digest exactly.'
  }, evidence: {
    deterministic_authority_snapshot: ['snapshot_schema', 'canonical_json', 'snapshot_digest', 'full_base_sha', 'full_head_sha', 'full_tree_sha', 'full_blob_shas'],
    relevant_authority_projection: ['child_key', 'child_revision', 'pr_revision', 'parent_entry_revision', 'design_lock', 'scope', 'base_sha', 'head_sha', 'tree_sha', 'blob_shas', 'ignored_unrelated_sibling_revision'],
    immutable_one_run_lease: ['lease_schema', 'snapshot_digest', 'run_identity', 'sealed_bytes', 'consumed', 'use_count', 'expiry'],
    machine_byte_agreement: ['github_bytes', 'local_bytes', 'byte_for_byte_equal', 'mismatch_receipt'],
    manifest_round_trip: ['manifest_schema', 'rendered_bytes', 'extracted_bytes', 'rendered_digest', 'extracted_digest']
  }},
  'C8-ADMISSION-MUTATION-BOUNDARY-001': { semantics: {
    typed_fail_closed_receipts: 'Authority, tooling, manifest, lease, and sensitivity failures return typed receipts with expected and observed formats, mutation_performed false, and no sensitive observed values.',
    no_candidate_before_dispatch: 'A pre-dispatch tooling or authority failure creates no evaluation candidate and does not consume a lease.',
    sensitivity_handling: 'Visible output is classified as none, possible, or confirmed; possible pauses and redacts, confirmed credentials require rotation, and confirmed non-credential exposure requires affected-scope containment.',
    default_off_source_only: 'The machinery remains source-only, uninstalled, unscheduled, inactive, and cannot enable Auto Review or automatic next-task pickup.'
  }, evidence: {
    typed_fail_closed_receipts: ['schema', 'phase', 'reason', 'field', 'expected_format', 'observed_format', 'mutation_performed', 'sensitive_values_excluded'],
    no_candidate_before_dispatch: ['pre_dispatch_failure', 'evaluation_candidate_created', 'lease_consumed', 'mutation_performed'],
    sensitivity_handling: ['classification', 'pause', 'redacted', 'rotation_disposition', 'containment_disposition', 'affected_path'],
    default_off_source_only: ['publish_as', 'outputs', 'installed', 'scheduler', 'auto_review', 'next_task_pickup']
  }}
};
Object.assign(expectedInvariantBundles, c8InvariantBundles);
registerNegativeTestContracts([
  ...Object.keys(expectedInvariantBundles),
  'AUTH-LEDGER-RECEIPT-REPLACEMENT-001'
]);

const c7FinalityPredicates = Object.freeze(['reviewAmendConvergence', 'currentRelevantAuthority', 'currentDesignLockAndScope', 'freshExactHeadG4Pass', 'completeTerminalPacket', 'noBlockingReview', 'noAuthorityMovement', 'noContradictions', 'comprehensiveIndependentWebFinalGate']);
const c7ExceptionalCategories = Object.freeze(['cryptography', 'recovery', 'irreversible_migration', 'destructive_migration', 'critical_security_boundary', 'conflicting_evidence']);
let c7ExceptionalGrantSequence = 0;

function c7ExceptionalGrantContext(overrides = {}) {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    pull_request: 333,
    exact_head: snapshot.exact_remote_head_sha,
    review: {
      run_id: 'run-exceptional-synthetic',
      session_id: 'session-exceptional-synthetic',
      turn_id: 'turn-exceptional-synthetic'
    },
    governing_authority_revision: 'child-r1',
    category: 'critical_security_boundary',
    now: '2026-08-03T23:00:00.000Z',
    ...overrides
  };
}

function c7GrantBody(grant) {
  const body = c8Clone(grant);
  delete body.canonical_digest;
  delete body.authority_store_path;
  return body;
}

function c7GrantDigest(grant) {
  return c8DigestBytes(c8Json(c7GrantBody(grant)));
}

function c7BuildExceptionalGrantRecord(grantId = 'exceptional-grant-trusted-1') {
  const context = c7ExceptionalGrantContext();
  const grant = {
    schema: 'exceptional-review-grant/v1',
    grant_id: grantId,
    issuer: {
      identity: 'web-orchestrator',
      role: 'Web Orchestrator',
      surface: 'web-orchestrator'
    },
    repository: context.repository,
    pull_request: context.pull_request,
    exact_head: context.exact_head,
    review: c8Clone(context.review),
    governing_authority_revision: context.governing_authority_revision,
    category: context.category,
    issued_at: '2026-08-03T22:59:00.000Z',
    expires_at: '2026-08-04T00:00:00.000Z',
    lifecycle: {
      state: 'issued',
      consumed: false,
      use_count: 0,
      consumed_at: null
    },
    authority_store_path: c8NewAuthorityStorePath('exceptional-review')
  };
  grant.canonical_digest = c7GrantDigest(grant);
  return grant;
}

function c7ExceptionalGrant(overrides = {}) {
  const grantId = 'exceptional-grant-trusted-' + (++c7ExceptionalGrantSequence);
  const trusted = c28TrustedLookup('exceptional-review', grantId);
  return { ...(trusted ? c8Clone(trusted) : c7BuildExceptionalGrantRecord()), ...overrides };
}

function c7ExceptionalReviewerAdmission(grant = {}, context = c7ExceptionalGrantContext(), authorityRegistry) {
  const rejected = (reason = 'EXCEPTIONAL_REVIEW_GRANT_INVALID') => ({
    decision: reason,
    allowed: false,
    mutation_performed: false,
    evaluation_candidate_created: false
  });
  const trusted = grant && c28TrustedLookup('exceptional-review', grant.grant_id);
  if (!trusted || c8Json(trusted) !== c8Json(grant)) return rejected('EXCEPTIONAL_REVIEW_GRANT_NOT_TRUSTED');
  if (grant.schema !== 'exceptional-review-grant/v1' ||
      !nonEmptyString(grant.grant_id) || !c8Digest.test(grant.canonical_digest || '') ||
      grant.canonical_digest !== c7GrantDigest(grant) ||
      !grant.issuer || grant.issuer.identity !== 'web-orchestrator' ||
      grant.issuer.role !== 'Web Orchestrator' || grant.issuer.surface !== 'web-orchestrator' ||
      grant.repository !== context.repository || grant.pull_request !== context.pull_request ||
      grant.exact_head !== context.exact_head ||
      !grant.review || c8Json(grant.review) !== c8Json(context.review) ||
      grant.governing_authority_revision !== context.governing_authority_revision ||
      !c7ExceptionalCategories.includes(grant.category) || grant.category !== context.category ||
      !nonEmptyString(grant.issued_at) || !nonEmptyString(grant.expires_at) ||
      !Number.isFinite(Date.parse(grant.issued_at)) || !Number.isFinite(Date.parse(grant.expires_at)) ||
      Date.parse(grant.issued_at) > Date.parse(context.now) || Date.parse(grant.expires_at) <= Date.parse(context.now) ||
      !grant.lifecycle || grant.lifecycle.state !== 'issued' || grant.lifecycle.consumed !== false ||
      grant.lifecycle.use_count !== 0 || grant.lifecycle.consumed_at !== null) return rejected();
  const registry = authorityRegistry || new C8DurableAuthorityRegistry(grant.authority_store_path, 'exceptional-review');
  const registered = registry.register(trusted);
  if (registered.reason === 'AUTHORITY_ALREADY_CONSUMED') return rejected('EXCEPTIONAL_REVIEW_GRANT_REPLAYED');
  if (!['AUTHORITY_REGISTERED', 'AUTHORITY_ALREADY_REGISTERED'].includes(registered.decision)) return rejected('EXCEPTIONAL_REVIEW_GRANT_INVALID');
  const consumed = registry.consume(trusted, { expectedState: 'issued', consumed_at: context.now });
  if (consumed.reason === 'AUTHORITY_ALREADY_CONSUMED') return rejected('EXCEPTIONAL_REVIEW_GRANT_REPLAYED');
  if (consumed.decision !== 'AUTHORITY_CONSUMED') return rejected('EXCEPTIONAL_REVIEW_GRANT_INVALID');
  return {
    decision: 'SECOND_REVIEWER_ADMITTED',
    allowed: true,
    category: grant.category,
    replacesWebFinality: false,
    mutation_performed: false,
    evaluation_candidate_created: false,
    grant: consumed.record
  };
}

const c8Sha = /^[0-9a-f]{40}$/; const c8Digest = /^sha256:[0-9a-f]{64}$/;
const c8Schemas = Object.freeze({ snapshot: 'toolkit-authority-snapshot/v1', lease: 'toolkit-authority-lease/v1', manifest: 'toolkit-authority-manifest/v1', receipt: 'toolkit-admission-receipt/v1' });
class C8ContractError extends Error { constructor(reason, field = 'contract') { super(reason); this.name = 'C8ContractError'; this.reason = reason; this.field = field; } }
const c8Hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 40);
const c8DigestBytes = (value) => 'sha256:' + crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')).digest('hex');
const c8Json = (value) => JSON.stringify((function sort(value) { if (Array.isArray(value)) return value.map(sort); if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])])); return value; })(value));
function c8Freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(c8Freeze); Object.freeze(value); } return value; }
function c8Merge(base, extra = {}) { const out = { ...base }; for (const [key, value] of Object.entries(extra)) out[key] = value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key]) ? c8Merge(out[key], value) : value; return out; }
function c8Keys(value, allowed, field) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new C8ContractError('MALFORMED_' + field.toUpperCase(), field); }
function c8ShaCheck(value, field) { if (typeof value !== 'string' || !c8Sha.test(value)) throw new C8ContractError('MALFORMED_SHA', field); return value; }
function c8Text(value, field, reason = 'SCOPE_MISMATCH') { if (typeof value !== 'string' || !value) throw new C8ContractError(reason, field); return value; }
function c8CanonicalPathCompare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function c8List(value, field) { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new C8ContractError('SCOPE_MISMATCH', field); const sorted = [...value].sort(c8CanonicalPathCompare); if (new Set(sorted).size !== sorted.length) throw new C8ContractError('SCOPE_MISMATCH', field); return sorted; }
function c8RealGitAuthority(authority = c8GitAuthorityFixture.authority) {
  c8Keys(authority, ['canonical_base_sha', 'exact_remote_head_sha', 'exact_tree_sha', 'authorised_blobs'], 'real_git_authority');
  return {
    canonical_base_sha: c8ShaCheck(authority.canonical_base_sha, 'canonical_base_sha'),
    exact_remote_head_sha: c8ShaCheck(authority.exact_remote_head_sha, 'exact_remote_head_sha'),
    exact_tree_sha: c8ShaCheck(authority.exact_tree_sha, 'exact_tree_sha'),
    authorised_blobs: authority.authorised_blobs.map((blob) => {
      c8Keys(blob, ['path', 'blob_sha'], 'real_git_blob');
      return { path: c8Text(blob.path, 'real_git_blob.path'), blob_sha: c8ShaCheck(blob.blob_sha, 'real_git_blob.blob_sha') };
    })
  };
}
function c8DefaultSnapshot(overrides = {}) {
  const authority = c8RealGitAuthority();
  return c8Merge({
    schema: c8Schemas.snapshot,
    repository: { owner: 'weijunswj', name: 'ai-agent-toolkit' },
    child_issue: { number: 329, authority_revision: 'child-r1' },
    pull_request: { number: 333, authority_revision: 'pr-r1' },
    relevant_parent_entry: { key: '#329', authority_revision: 'parent-r1' },
    design_lock: 'DL-329-AUTO-CODE-005-A6-C21',
    run_identity: '2026-08-06-toolkit-c21-nine-g4-findings-amendment-g3-056',
    ...authority,
    authorised_source_scope: {
      paths: ['repo/tests/repo-auto-code-design.test.cjs'],
      outputs: [],
      writes: ['repo/tests/repo-auto-code-design.test.cjs'],
      source_only: true
    },
    role: 'implementation/amendment worker',
    capabilities: ['bounded_source_mutation', 'pre_dispatch_admission', 'read_authority'],
    child_authority_revision: 'child-r1',
    pr_authority_revision: 'pr-r1',
    relevant_parent_entry_revision: 'parent-r1',
    projection: {
      schema: 'task-authority-projection/v1',
      child_key: '#329',
      parent_entry_marker_schema: 'toolkit-authority-parent-entry/v1',
      relevant_parent_entry_revision: 'parent-r1',
      normalization: 'canonical-json-sorted-keys'
    }
  }, overrides);
}
function c8NormalizeSnapshot(input) {
  c8Keys(input, ['schema', 'repository', 'child_issue', 'pull_request', 'relevant_parent_entry', 'design_lock', 'run_identity', 'canonical_base_sha', 'exact_remote_head_sha', 'exact_tree_sha', 'authorised_blobs', 'authorised_source_scope', 'role', 'capabilities', 'child_authority_revision', 'pr_authority_revision', 'relevant_parent_entry_revision', 'projection'], 'snapshot');
  if (input.schema !== c8Schemas.snapshot) throw new C8ContractError('MALFORMED_SNAPSHOT', 'schema');
  c8Keys(input.repository, ['owner', 'name'], 'repository'); c8Keys(input.child_issue, ['number', 'authority_revision'], 'child_issue'); c8Keys(input.pull_request, ['number', 'authority_revision'], 'pull_request'); c8Keys(input.relevant_parent_entry, ['key', 'authority_revision'], 'parent_entry');
  if (!Number.isInteger(input.child_issue.number) || !Number.isInteger(input.pull_request.number)) throw new C8ContractError('SCOPE_MISMATCH', 'issue');
  c8Text(input.repository.owner, 'repository.owner'); c8Text(input.repository.name, 'repository.name'); c8Text(input.child_issue.authority_revision, 'child_issue.authority_revision'); c8Text(input.pull_request.authority_revision, 'pull_request.authority_revision'); c8Text(input.relevant_parent_entry.key, 'parent_entry.key'); c8Text(input.relevant_parent_entry.authority_revision, 'parent_entry.authority_revision'); c8Text(input.design_lock, 'design_lock'); c8Text(input.run_identity, 'run_identity');
  c8ShaCheck(input.canonical_base_sha, 'canonical_base_sha'); c8ShaCheck(input.exact_remote_head_sha, 'exact_remote_head_sha'); c8ShaCheck(input.exact_tree_sha, 'exact_tree_sha');
  if (!Array.isArray(input.authorised_blobs)) throw new C8ContractError('SCOPE_MISMATCH', 'authorised_blobs');
  const blobs = input.authorised_blobs.map((blob) => { c8Keys(blob, ['path', 'blob_sha'], 'blob'); return { path: c8Text(blob.path, 'blob.path', 'BLOB_MOVED'), blob_sha: c8ShaCheck(blob.blob_sha, 'blob.blob_sha') }; }).sort((a, b) => c8CanonicalPathCompare(a.path, b.path));
  if (new Set(blobs.map((blob) => blob.path)).size !== blobs.length) throw new C8ContractError('SCOPE_MISMATCH', 'blob.path');
  c8Keys(input.authorised_source_scope, ['paths', 'outputs', 'writes', 'source_only'], 'scope'); if (input.authorised_source_scope.source_only !== true) throw new C8ContractError('SCOPE_MISMATCH', 'scope.source_only');
  const scope = { paths: c8List(input.authorised_source_scope.paths, 'scope.paths'), outputs: c8List(input.authorised_source_scope.outputs, 'scope.outputs'), writes: c8List(input.authorised_source_scope.writes, 'scope.writes'), source_only: true };
  const capabilities = c8List(input.capabilities, 'capabilities'); c8Text(input.role, 'role'); c8Text(input.child_authority_revision, 'child_authority_revision'); c8Text(input.pr_authority_revision, 'pr_authority_revision'); c8Text(input.relevant_parent_entry_revision, 'parent_entry_revision');
  if (input.relevant_parent_entry.key !== '#329' || input.relevant_parent_entry.authority_revision !== input.relevant_parent_entry_revision) throw new C8ContractError('PARENT_ENTRY_MOVED', 'parent_entry');
  c8Keys(input.projection, ['schema', 'child_key', 'parent_entry_marker_schema', 'relevant_parent_entry_revision', 'normalization'], 'projection');
  if (input.projection.schema !== 'task-authority-projection/v1' || input.projection.child_key !== '#329' || input.projection.parent_entry_marker_schema !== 'toolkit-authority-parent-entry/v1' || input.projection.relevant_parent_entry_revision !== input.relevant_parent_entry_revision || input.projection.normalization !== 'canonical-json-sorted-keys') throw new C8ContractError('PARENT_ENTRY_MOVED', 'projection');
  if (input.child_issue.authority_revision !== input.child_authority_revision || input.pull_request.authority_revision !== input.pr_authority_revision) throw new C8ContractError('CHILD_AUTHORITY_MOVED', 'authority_revision');
  return { schema: c8Schemas.snapshot, repository: { ...input.repository }, child_issue: { ...input.child_issue }, pull_request: { ...input.pull_request }, relevant_parent_entry: { ...input.relevant_parent_entry }, design_lock: input.design_lock, run_identity: input.run_identity, canonical_base_sha: input.canonical_base_sha, exact_remote_head_sha: input.exact_remote_head_sha, exact_tree_sha: input.exact_tree_sha, authorised_blobs: blobs, authorised_source_scope: scope, role: input.role, capabilities, child_authority_revision: input.child_authority_revision, pr_authority_revision: input.pr_authority_revision, relevant_parent_entry_revision: input.relevant_parent_entry_revision, projection: { ...input.projection } };
}
function c8Material(snapshot) { const material = { ...snapshot }; delete material.snapshot_digest; delete material.canonical_bytes; return c8NormalizeSnapshot(material); }
function c8Snapshot(input) { const material = c8NormalizeSnapshot(input); const bytes = c8Json(material); return c8Freeze({ ...material, snapshot_digest: c8DigestBytes(bytes), canonical_bytes: bytes }); }
const c8ParentStart = '<!-- toolkit-authority-parent-entry/v1 child='; const c8ParentEnd = '<!-- /toolkit-authority-parent-entry/v1 -->';
function c8ParentMarker(entry, key = '#329') { c8Text(entry, 'parent_entry'); if (entry.includes('toolkit-authority-parent-entry/v1')) throw new C8ContractError('MALFORMED_PARENT_ENTRY', 'parent_entry'); return c8ParentStart + key + ' -->\n' + entry.trim() + '\n' + c8ParentEnd; }
function c8ParentParse(body, key = '#329') { c8Text(body, 'parent_body'); const matches = [...body.matchAll(/<!-- toolkit-authority-parent-entry\/v1 child=([^ ]+) -->/g)]; const target = matches.filter((match) => match[1] === key); if (target.length !== 1) throw new C8ContractError('PARENT_ENTRY_MOVED', 'parent_entry_count'); const start = target[0].index; const prior = body.slice(0, start); if (prior.lastIndexOf(c8ParentStart) > prior.lastIndexOf(c8ParentEnd)) throw new C8ContractError('MALFORMED_PARENT_ENTRY', 'nested_marker'); const end = body.indexOf(c8ParentEnd, start); if (end < 0) throw new C8ContractError('PARENT_ENTRY_MOVED', 'parent_entry_end'); if (matches.some((match) => match.index > start && match.index < end)) throw new C8ContractError('MALFORMED_PARENT_ENTRY', 'nested_marker'); const entry = body.slice(start + target[0][0].length, end).trim(); if (entry.includes(c8ParentEnd)) throw new C8ContractError('MALFORMED_PARENT_ENTRY', 'duplicate_end'); return { decision: 'PARENT_ENTRY_ADMITTED', child_key: key, entry, revision: c8DigestBytes(entry) }; }
function c8Projection(snapshot) {
  return {
    repository: snapshot.repository,
    child: snapshot.child_issue,
    pull_request: snapshot.pull_request,
    parent_entry: snapshot.relevant_parent_entry,
    parent_entry_revision: snapshot.relevant_parent_entry_revision,
    design_lock: snapshot.design_lock,
    run_identity: snapshot.run_identity,
    scope: snapshot.authorised_source_scope,
    base: snapshot.canonical_base_sha,
    head: snapshot.exact_remote_head_sha,
    tree: snapshot.exact_tree_sha,
    blobs: snapshot.authorised_blobs,
    role: snapshot.role,
    capabilities: snapshot.capabilities
  };
}
function c8Receipt(phase, reason, field = 'contract', expected = 'canonical-authority', observed = 'rejected', snapshot = null, lease = null) { return { schema: c8Schemas.receipt, phase, reason, field, expected_format: expected, observed_format: observed, snapshot_identity: snapshot && snapshot.snapshot_digest || null, lease_identity: lease && lease.lease_id || null, mutation_performed: false, evaluation_candidate_created: false }; }
function c8Compare(snapshot, current = {}) { const baseline = c8Snapshot(c8Material(snapshot)); const candidate = { ...current }; const ignored = candidate.unrelated_sibling_parent_revision; delete candidate.unrelated_sibling_parent_revision; delete candidate.snapshot_digest; delete candidate.canonical_bytes; const currentSnapshot = c8Snapshot(c8DefaultSnapshot(candidate)); const left = c8Projection(baseline); const right = c8Projection(currentSnapshot); for (const [field, reason] of [['child', 'CHILD_AUTHORITY_MOVED'], ['pull_request', 'PR_AUTHORITY_MOVED'], ['parent_entry', 'PARENT_ENTRY_MOVED'], ['design_lock', 'DESIGN_LOCK_MISMATCH'], ['scope', 'SCOPE_MISMATCH'], ['base', 'BASE_MOVED'], ['head', 'HEAD_MOVED'], ['tree', 'TREE_MOVED'], ['blobs', 'BLOB_MOVED'], ['role', 'SCOPE_MISMATCH'], ['capabilities', 'SCOPE_MISMATCH']]) if (c8Json(left[field]) !== c8Json(right[field])) return { decision: 'AUTHORITY_REJECTED', reason, ignored_unrelated_sibling_parent_revision: ignored === undefined ? null : 'ignored', receipt: c8Receipt('authority-comparison', reason, field, 'relevant-authority', 'changed', baseline) }; return { decision: 'AUTHORITY_ADMITTED', ignored_unrelated_sibling_parent_revision: ignored === undefined ? null : 'ignored', snapshot: currentSnapshot }; }
const c8MachineFields = Object.freeze(['schema', 'collector', 'repository', 'child_issue', 'pull_request', 'parent_entry', 'design_lock', 'run_identity', 'scope', 'role', 'capabilities', 'child_authority_revision', 'pr_authority_revision', 'relevant_parent_entry_revision', 'projection', 'base_sha', 'head_sha', 'tree_sha', 'blobs']);
const c8MachineRawFieldReasons = Object.freeze([
  ['repository', 'REPOSITORY_MOVED'], ['child_issue', 'CHILD_AUTHORITY_MOVED'], ['pull_request', 'PR_AUTHORITY_MOVED'],
  ['parent_entry', 'PARENT_ENTRY_MOVED'], ['design_lock', 'DESIGN_LOCK_MISMATCH'], ['run_identity', 'RUN_IDENTITY_MISMATCH'],
  ['scope', 'SCOPE_MISMATCH'], ['role', 'ROLE_MISMATCH'], ['capabilities', 'CAPABILITY_MISMATCH'],
  ['child_authority_revision', 'CHILD_AUTHORITY_MOVED'], ['pr_authority_revision', 'PR_AUTHORITY_MOVED'],
  ['relevant_parent_entry_revision', 'PARENT_ENTRY_MOVED'], ['projection', 'PARENT_ENTRY_MOVED']
]);
const c8MachineGitFields = Object.freeze(['base_sha', 'head_sha', 'tree_sha', 'blobs']);

function c8ValidateMachineRawEvidence(side, expectedSource) {
  const collector = side.collector;
  if (!nonEmptyString(collector.evidence_identity) || !collector.evidence_locator ||
      !nonEmptyString(collector.evidence_digest) || !nonEmptyString(collector.evidence_bytes)) {
    throw new C8ContractError('MACHINE_RAW_EVIDENCE_REQUIRED', 'collector');
  }
  if (!c8Digest.test(collector.evidence_digest) || collector.evidence_digest !== c8DigestBytes(collector.evidence_bytes)) {
    throw new C8ContractError('MACHINE_RAW_EVIDENCE_INVALID', 'collector.evidence_digest');
  }
  let raw;
  try { raw = JSON.parse(collector.evidence_bytes); } catch { throw new C8ContractError('MACHINE_RAW_EVIDENCE_INVALID', 'collector.evidence_bytes'); }
  if (c8Json(raw) !== collector.evidence_bytes || raw.schema !== 'machine-authority-raw/v1' || raw.source !== expectedSource ||
      raw.evidence_identity !== collector.evidence_identity || !raw.authority || typeof raw.authority !== 'object') {
    throw new C8ContractError('MACHINE_RAW_SOURCE_MISMATCH', 'collector.evidence_identity');
  }
  const locator = collector.evidence_locator;
  c8Keys(locator, ['source_class', 'kind', 'exact_locator', 'evidence_identity', 'content_digest', 'resolved_locator', 'resolved_evidence_identity', 'resolved_bytes'], 'machine_evidence_locator');
  const expectedKind = expectedSource === 'github-api' ? 'github-api' : 'local-command';
  if (locator.source_class !== 'authoritative-raw' || locator.kind !== expectedKind || !nonEmptyString(locator.exact_locator) ||
      !locator.exact_locator.includes('/' + expectedSource + '/') || !locator.exact_locator.includes('#machine-authority') || locator.evidence_identity !== collector.evidence_identity ||
      !c8Digest.test(locator.content_digest || '') || locator.resolved_locator !== locator.exact_locator ||
      locator.resolved_evidence_identity !== locator.evidence_identity || !nonEmptyString(locator.resolved_bytes) ||
      locator.resolved_bytes !== collector.evidence_bytes || collector.evidence_digest !== locator.content_digest ||
      c8DigestBytes(locator.resolved_bytes) !== locator.content_digest) {
    throw new C8ContractError('MACHINE_RAW_EVIDENCE_INVALID', 'collector.evidence_locator');
  }
  c8Keys(raw.authority, c8MachineFields.filter((field) => field !== 'collector'), 'machine_raw_authority');
  for (const [field, reason] of c8MachineRawFieldReasons) {
    if (c8Json(raw.authority[field]) !== c8Json(side[field])) throw new C8ContractError(reason, field);
  }
}

function c8MachineSideNormalize(side, expectedSource) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) throw new C8ContractError('MALFORMED_MACHINE_AUTHORITY', 'machine');
  c8Keys(side, c8MachineFields, 'machine_authority');
  if (side.schema !== 'machine-authority/v1') throw new C8ContractError('MALFORMED_MACHINE_AUTHORITY', 'schema');
  c8Keys(side.collector, ['source', 'collection_id', 'evidence_identity', 'evidence_locator', 'evidence_digest', 'evidence_bytes'], 'collector');
  if (side.collector.source !== expectedSource || !nonEmptyString(side.collector.collection_id)) throw new C8ContractError('MALFORMED_MACHINE_AUTHORITY', 'collector');
  c8ValidateMachineRawEvidence(side, expectedSource);
  c8Keys(side.repository, ['owner', 'name'], 'machine_repository');
  c8Keys(side.child_issue, ['number', 'authority_revision'], 'machine_child_issue');
  c8Keys(side.pull_request, ['number', 'authority_revision'], 'machine_pull_request');
  c8Keys(side.parent_entry, ['key', 'authority_revision'], 'machine_parent_entry');
  c8Keys(side.scope, ['paths', 'outputs', 'writes', 'source_only'], 'machine_scope');
  c8Keys(side.projection, ['schema', 'child_key', 'parent_entry_marker_schema', 'relevant_parent_entry_revision', 'normalization'], 'machine_projection');
  if (!Number.isInteger(side.child_issue.number) || !Number.isInteger(side.pull_request.number) ||
      side.parent_entry.key !== '#329' || side.projection.schema !== 'task-authority-projection/v1' ||
      side.projection.child_key !== '#329' || side.projection.parent_entry_marker_schema !== 'toolkit-authority-parent-entry/v1' ||
      side.projection.normalization !== 'canonical-json-sorted-keys') throw new C8ContractError('MALFORMED_MACHINE_AUTHORITY', 'projection');
  const scope = {
    paths: c8List(side.scope.paths, 'machine.scope.paths'),
    outputs: c8List(side.scope.outputs, 'machine.scope.outputs'),
    writes: c8List(side.scope.writes, 'machine.scope.writes'),
    source_only: side.scope.source_only
  };
  if (scope.source_only !== true) throw new C8ContractError('SCOPE_MISMATCH', 'machine.scope.source_only');
  c8Text(side.repository.owner, 'machine.repository.owner'); c8Text(side.repository.name, 'machine.repository.name');
  c8Text(side.child_issue.authority_revision, 'machine.child_issue.authority_revision');
  c8Text(side.pull_request.authority_revision, 'machine.pull_request.authority_revision');
  c8Text(side.parent_entry.authority_revision, 'machine.parent_entry.authority_revision');
  c8Text(side.design_lock, 'machine.design_lock'); c8Text(side.run_identity, 'machine.run_identity');
  c8Text(side.role, 'machine.role'); c8Text(side.child_authority_revision, 'machine.child_authority_revision');
  c8Text(side.pr_authority_revision, 'machine.pr_authority_revision');
  c8Text(side.relevant_parent_entry_revision, 'machine.parent_entry_revision');
  const capabilities = c8List(side.capabilities, 'machine.capabilities');
  c8ShaCheck(side.base_sha, 'base_sha'); c8ShaCheck(side.head_sha, 'head_sha'); c8ShaCheck(side.tree_sha, 'tree_sha');
  if (!Array.isArray(side.blobs)) throw new C8ContractError('MALFORMED_MACHINE_AUTHORITY', 'blobs');
  const blobs = side.blobs.map((blob) => {
    c8Keys(blob, ['path', 'blob_sha'], 'machine_blob');
    return { path: c8Text(blob.path, 'machine_blob.path'), blob_sha: c8ShaCheck(blob.blob_sha, 'machine_blob.blob_sha') };
  }).sort((a, b) => c8CanonicalPathCompare(a.path, b.path));
  if (new Set(blobs.map((blob) => blob.path)).size !== blobs.length) throw new C8ContractError('MALFORMED_MACHINE_AUTHORITY', 'blob.path');
  return {
    schema: side.schema,
    collector: { ...side.collector },
    repository: { ...side.repository },
    child_issue: { ...side.child_issue },
    pull_request: { ...side.pull_request },
    parent_entry: { ...side.parent_entry },
    design_lock: side.design_lock,
    run_identity: side.run_identity,
    scope,
    role: side.role,
    capabilities,
    child_authority_revision: side.child_authority_revision,
    pr_authority_revision: side.pr_authority_revision,
    relevant_parent_entry_revision: side.relevant_parent_entry_revision,
    projection: { ...side.projection },
    base_sha: side.base_sha,
    head_sha: side.head_sha,
    tree_sha: side.tree_sha,
    blobs
  };
}
function c8MachineMaterialFromSnapshot(snapshot) {
  return {
    schema: 'machine-authority/v1',
    repository: c8Clone(snapshot.repository),
    child_issue: c8Clone(snapshot.child_issue),
    pull_request: c8Clone(snapshot.pull_request),
    parent_entry: c8Clone(snapshot.relevant_parent_entry),
    design_lock: snapshot.design_lock,
    run_identity: snapshot.run_identity,
    scope: c8Clone(snapshot.authorised_source_scope),
    role: snapshot.role,
    capabilities: [...snapshot.capabilities],
    child_authority_revision: snapshot.child_authority_revision,
    pr_authority_revision: snapshot.pr_authority_revision,
    relevant_parent_entry_revision: snapshot.relevant_parent_entry_revision,
    projection: c8Clone(snapshot.projection),
    base_sha: snapshot.canonical_base_sha,
    head_sha: snapshot.exact_remote_head_sha,
    tree_sha: snapshot.exact_tree_sha,
    blobs: c8Clone(snapshot.authorised_blobs)
  };
}

const c28TrustedMachineEvidenceIds = Object.freeze({
  github: 'machine-authority-github-api-trusted-v1',
  local: 'machine-authority-local-git-trusted-v1'
});

function c28BuildTrustedMachineRecord(source) {
  const evidenceIdentity = source === 'github-api'
    ? c28TrustedMachineEvidenceIds.github
    : source === 'local-git' ? c28TrustedMachineEvidenceIds.local : null;
  if (!evidenceIdentity) throw new C8ContractError('MACHINE_AUTHORITY_PROVENANCE_REQUIRED', 'source');
  const authority = c8MachineMaterialFromSnapshot(c8Snapshot(c8DefaultSnapshot()));
  const raw = { schema: 'machine-authority-raw/v1', source, evidence_identity: evidenceIdentity, authority };
  const evidenceBytes = c8Json(raw);
  const exactLocator = 'raw://weijunswj/ai-agent-toolkit/pr-333/' + source + '/machine-authority#machine-authority';
  const locator = {
    source_class: 'authoritative-raw',
    kind: source === 'github-api' ? 'github-api' : 'local-command',
    exact_locator: exactLocator,
    evidence_identity: evidenceIdentity,
    content_digest: c8DigestBytes(evidenceBytes),
    resolved_locator: exactLocator,
    resolved_evidence_identity: evidenceIdentity,
    resolved_bytes: evidenceBytes
  };
  return c8MachineSideNormalize({
    ...authority,
    collector: { source, collection_id: 'trusted-collector-' + source + '-v1', evidence_identity: evidenceIdentity, evidence_locator: locator, evidence_digest: c8DigestBytes(evidenceBytes), evidence_bytes: evidenceBytes }
  }, source);
}

function c8RawMachineAuthorityCollection(input, source) {
  const candidate = input && typeof input === 'object' ? input : null;
  const evidenceIdentity = candidate && candidate.collector && candidate.collector.evidence_identity;
  const expectedIdentity = source === 'github-api' ? c28TrustedMachineEvidenceIds.github : c28TrustedMachineEvidenceIds.local;
  const trusted = c28TrustedLookup(source === 'github-api' ? 'machine-github-api' : 'machine-local-git', evidenceIdentity || expectedIdentity);
  const referenceOnly = candidate && Object.keys(candidate).length === 1 && candidate.collector && Object.keys(candidate.collector).length === 1;
  if (!trusted) throw new C8ContractError('MACHINE_AUTHORITY_PROVENANCE_REQUIRED', 'collector.evidence_identity');
  const trustedNormalized = c8MachineSideNormalize(c8Clone(trusted), source);
  if (referenceOnly) return trustedNormalized;
  const candidateNormalized = c8MachineSideNormalize(c8Clone(candidate), source);
  if (c8Json(candidateNormalized.collector) !== c8Json(trustedNormalized.collector)) {
    throw new C8ContractError('MACHINE_AUTHORITY_PROVENANCE_REQUIRED', 'collector.evidence_identity');
  }
  return candidateNormalized;
}

function c8CollectGithubMachineAuthority(input) {
  return c8RawMachineAuthorityCollection(input, 'github-api');
}

function c8CollectLocalMachineAuthority(input) {
  return c8RawMachineAuthorityCollection(input, 'local-git');
}

function c8MachineAuthority(input) {
  const sources = input === undefined ? {
    github: { collector: { evidence_identity: c28TrustedMachineEvidenceIds.github } },
    local: { collector: { evidence_identity: c28TrustedMachineEvidenceIds.local } }
  } : input;
  if (!sources || !sources.github || !sources.local || sources.github === sources.local) throw new C8ContractError('MACHINE_AUTHORITY_INDEPENDENCE_REQUIRED', 'sources');
  const github = c8CollectGithubMachineAuthority(sources.github);
  const local = c8CollectLocalMachineAuthority(sources.local);
  const snapshotInput = sources.snapshot_input || c8DefaultSnapshot();
  const snapshot = c8Snapshot(snapshotInput.snapshot_digest ? c8Material(snapshotInput) : c8Clone(snapshotInput));
  return {
    github,
    local,
    snapshot_input: c8Material(snapshot)
  };
}
function c8GitObjectType(objectId, gitRoot = c8GitAuthorityFixture.root) {
  try {
    execFileSync('git', ['cat-file', '-e', objectId], { cwd: gitRoot, stdio: ['ignore', 'ignore', 'ignore'] });
    return execFileSync('git', ['cat-file', '-t', objectId], { cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
function c8ValidRepositoryPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(value) && !value.includes(':') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..') &&
    path.posix.normalize(value) === value;
}
function c8VerifyRealGitProjection(projection, options = {}) {
  const gitRoot = options.gitRoot || c8GitAuthorityFixture.root;
  const expected = options.expectedAuthority || c8GitAuthorityFixture.authority;
  if (c8GitObjectType(projection.base_sha, gitRoot) !== 'commit' || c8GitObjectType(projection.head_sha, gitRoot) !== 'commit') {
    return { ok: false, reason: 'GIT_COMMIT_INVALID', field: 'head_sha' };
  }
  if (projection.base_sha !== expected.canonical_base_sha) return { ok: false, reason: 'GIT_BASE_MISMATCH', field: 'base_sha' };
  if (projection.head_sha !== expected.exact_remote_head_sha) return { ok: false, reason: 'GIT_HEAD_MISMATCH', field: 'head_sha' };
  const treeType = c8GitObjectType(projection.tree_sha, gitRoot);
  if (!treeType) return { ok: false, reason: 'GIT_TREE_INVALID', field: 'tree_sha' };
  if (treeType !== 'tree') return { ok: false, reason: 'GIT_TREE_TYPE_INVALID', field: 'tree_sha' };
  let expectedTree;
  try { expectedTree = c8FixtureGit(gitRoot, ['rev-parse', projection.head_sha + '^{tree}']); } catch { return { ok: false, reason: 'GIT_TREE_MISMATCH', field: 'tree_sha' }; }
  if (expectedTree !== projection.tree_sha) return { ok: false, reason: 'GIT_TREE_MISMATCH', field: 'tree_sha' };
  if (projection.tree_sha !== expected.exact_tree_sha) return { ok: false, reason: 'GIT_TREE_MISMATCH', field: 'tree_sha' };
  for (const blob of projection.blobs) {
    if (!c8ValidRepositoryPath(blob.path)) return { ok: false, reason: 'GIT_PATH_INVALID', field: 'blob.path' };
    const blobType = c8GitObjectType(blob.blob_sha, gitRoot);
    if (!blobType) return { ok: false, reason: 'GIT_BLOB_INVALID', field: 'blob.blob_sha' };
    if (blobType !== 'blob') return { ok: false, reason: 'GIT_BLOB_TYPE_INVALID', field: 'blob.blob_sha' };
    let entries;
    try { entries = execFileSync('git', ['ls-tree', '-z', projection.tree_sha, '--', blob.path], { cwd: gitRoot, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split('\0').filter(Boolean); } catch { entries = []; }
    if (entries.length === 0) return { ok: false, reason: 'GIT_PATH_MISSING', field: 'blob.path' };
    const match = entries.map((entry) => entry.match(/^\d+ (\w+) ([0-9a-f]{40})\t([\s\S]*)$/)).find(Boolean);
    if (!match) return { ok: false, reason: 'GIT_PATH_BINDING_MISMATCH', field: 'blob.path' };
    if (match[1] !== 'blob' || match[3] !== blob.path || match[2] !== blob.blob_sha) return { ok: false, reason: 'GIT_PATH_BINDING_MISMATCH', field: 'blob.path' };
  }
  if (c8Json(projection.blobs) !== c8Json(expected.authorised_blobs)) return { ok: false, reason: 'GIT_BLOB_MOVED', field: 'blobs' };
  return { ok: true };
}
function c8CollectMachine(machine, options = {}) {
  const reject = (reason, field = 'machine', observed = 'mismatch') => ({
    decision: 'MACHINE_AUTHORITY_REJECTED',
    reason,
    receipt: c8Receipt('machine-collection', reason, field, 'complete independent authority', observed)
  });
  try {
    if (!machine || !machine.github || !machine.local) return reject('MALFORMED_MACHINE_AUTHORITY');
    const githubIdentity = machine.github.collector && machine.github.collector.evidence_identity;
    const localIdentity = machine.local.collector && machine.local.collector.evidence_identity;
    if (githubIdentity && localIdentity && githubIdentity === localIdentity) {
      return reject('MACHINE_AUTHORITY_INDEPENDENCE_REQUIRED', 'collector.evidence_identity', 'duplicate');
    }
    const github = c8RawMachineAuthorityCollection(machine.github, 'github-api');
    const local = c8RawMachineAuthorityCollection(machine.local, 'local-git');
    if (github.collector.evidence_identity === local.collector.evidence_identity ||
        github.collector.evidence_digest === local.collector.evidence_digest ||
        c8Json(github.collector.evidence_locator) === c8Json(local.collector.evidence_locator)) {
      return reject('MACHINE_AUTHORITY_INDEPENDENCE_REQUIRED', 'collector.evidence_identity', 'duplicate');
    }
    for (const [field, reason] of [
      ['repository', 'REPOSITORY_MOVED'], ['child_issue', 'CHILD_AUTHORITY_MOVED'], ['pull_request', 'PR_AUTHORITY_MOVED'],
      ['parent_entry', 'PARENT_ENTRY_MOVED'], ['design_lock', 'DESIGN_LOCK_MISMATCH'], ['run_identity', 'RUN_IDENTITY_MISMATCH'],
      ['scope', 'SCOPE_MISMATCH'], ['role', 'ROLE_MISMATCH'], ['capabilities', 'CAPABILITY_MISMATCH'],
      ['child_authority_revision', 'CHILD_AUTHORITY_MOVED'], ['pr_authority_revision', 'PR_AUTHORITY_MOVED'],
      ['relevant_parent_entry_revision', 'PARENT_ENTRY_MOVED'], ['projection', 'PARENT_ENTRY_MOVED'],
      ['base_sha', 'BASE_MOVED'], ['head_sha', 'HEAD_MOVED'], ['tree_sha', 'TREE_MOVED'], ['blobs', 'BLOB_MOVED']
    ]) {
      if (c8Json(github[field]) !== c8Json(local[field])) return reject(reason, field);
    }
    const gitResult = c8VerifyRealGitProjection(github, options);
    if (!gitResult.ok) return reject(gitResult.reason, gitResult.field, 'unresolved');
    for (const side of [github, local]) {
      let raw;
      try { raw = JSON.parse(side.collector.evidence_bytes); } catch { return reject('MACHINE_RAW_EVIDENCE_INVALID', 'collector.evidence_bytes', 'unresolved'); }
      for (const field of c8MachineGitFields) {
        if (c8Json(raw.authority[field]) !== c8Json(side[field])) return reject('MACHINE_RAW_EVIDENCE_INVALID', field, 'unresolved');
      }
    }
    const snapshotInput = {
      schema: c8Schemas.snapshot,
      repository: github.repository,
      child_issue: github.child_issue,
      pull_request: github.pull_request,
      relevant_parent_entry: github.parent_entry,
      design_lock: github.design_lock,
      run_identity: github.run_identity,
      canonical_base_sha: github.base_sha,
      exact_remote_head_sha: github.head_sha,
      exact_tree_sha: github.tree_sha,
      authorised_blobs: github.blobs,
      authorised_source_scope: github.scope,
      role: github.role,
      capabilities: github.capabilities,
      child_authority_revision: github.child_authority_revision,
      pr_authority_revision: github.pr_authority_revision,
      relevant_parent_entry_revision: github.relevant_parent_entry_revision,
      projection: github.projection
    };
    const snapshot = c8Snapshot(snapshotInput);
    return {
      decision: 'MACHINE_AUTHORITY_COLLECTED',
      authority: { github, local },
      snapshot,
      snapshot_input: c8Material(snapshot),
      bytes: c8Json({ github, local })
    };
  } catch (error) {
    const typedReasons = [
      'MALFORMED_MACHINE_AUTHORITY', 'MACHINE_RAW_EVIDENCE_REQUIRED', 'MACHINE_RAW_EVIDENCE_INVALID', 'MACHINE_RAW_SOURCE_MISMATCH',
      'MACHINE_AUTHORITY_INDEPENDENCE_REQUIRED', 'MACHINE_AUTHORITY_PROVENANCE_REQUIRED', 'REPOSITORY_MOVED', 'CHILD_AUTHORITY_MOVED', 'PR_AUTHORITY_MOVED',
      'PARENT_ENTRY_MOVED', 'DESIGN_LOCK_MISMATCH', 'RUN_IDENTITY_MISMATCH', 'SCOPE_MISMATCH', 'ROLE_MISMATCH',
      'CAPABILITY_MISMATCH', 'BASE_MOVED', 'HEAD_MOVED', 'TREE_MOVED', 'BLOB_MOVED'
    ];
    return reject(typedReasons.includes(error.reason) ? error.reason : 'MALFORMED_MACHINE_AUTHORITY', error.field || 'machine');
  }
}

const c8ManifestStart = '<!-- toolkit-authority-manifest/v1 -->';
const c8ManifestStop = '<!-- /toolkit-authority-manifest/v1 -->';
function c8Manifest(snapshot, options = {}) {
  const source = c8Snapshot(snapshot);
  return { schema: c8Schemas.manifest, snapshot_digest: source.snapshot_digest, snapshot: c8Material(source), run_identity: options.run_identity || source.run_identity, role: options.role || source.role, capabilities: c8List(options.capabilities || source.capabilities, 'manifest.capabilities') };
}
function c8StrictJson(text) {
  if (typeof text !== 'string') throw new C8ContractError('MALFORMED_MANIFEST', 'json');
  let i = 0; const ws = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  const str = () => { const start = i++; while (i < text.length) { if (text[i] === '\\') { i += 2; continue; } if (text[i] === '"') { i += 1; try { return JSON.parse(text.slice(start, i)); } catch { break; } } if (text.charCodeAt(i) < 32) break; i += 1; } throw new C8ContractError('MALFORMED_MANIFEST', 'string'); };
  const value = () => { ws(); if (text[i] === '"') return str(); if (text[i] === '{') return object(); if (text[i] === '[') return array(); for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(literal, i)) { i += literal.length; return result; } const number = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/); if (number) { i += number[0].length; return Number(number[0]); } throw new C8ContractError('MALFORMED_MANIFEST', 'value'); };
  const array = () => { i += 1; const out = []; ws(); if (text[i] === ']') { i += 1; return out; } while (true) { out.push(value()); ws(); if (text[i] === ',') { i += 1; continue; } if (text[i] === ']') { i += 1; return out; } throw new C8ContractError('MALFORMED_MANIFEST', 'array'); } };
  const object = () => { i += 1; const out = {}; const seen = new Set(); ws(); if (text[i] === '}') { i += 1; return out; } while (true) { ws(); const key = str(); if (seen.has(key)) throw new C8ContractError('MALFORMED_MANIFEST', 'duplicate_key'); seen.add(key); ws(); if (text[i] !== ':') throw new C8ContractError('MALFORMED_MANIFEST', 'object'); i += 1; out[key] = value(); ws(); if (text[i] === ',') { i += 1; continue; } if (text[i] === '}') { i += 1; return out; } throw new C8ContractError('MALFORMED_MANIFEST', 'object'); } };
  const out = value(); ws(); if (i !== text.length) throw new C8ContractError('MALFORMED_MANIFEST', 'trailing_data'); return out;
}
function c8ManifestNormalize(manifest) {
  c8Keys(manifest, ['schema', 'snapshot_digest', 'snapshot', 'run_identity', 'role', 'capabilities'], 'manifest');
  if (manifest.schema !== c8Schemas.manifest || typeof manifest.snapshot_digest !== 'string' || !c8Digest.test(manifest.snapshot_digest)) throw new C8ContractError('MALFORMED_MANIFEST', 'schema');
  const snapshot = c8Snapshot(manifest.snapshot);
  if (snapshot.snapshot_digest !== manifest.snapshot_digest) throw new C8ContractError('SNAPSHOT_DIGEST_MISMATCH', 'snapshot_digest');
  const runIdentity = c8Text(manifest.run_identity, 'run_identity');
  const role = c8Text(manifest.role, 'role');
  const capabilities = c8List(manifest.capabilities, 'manifest.capabilities');
  if (runIdentity !== snapshot.run_identity || role !== snapshot.role || c8Json(capabilities) !== c8Json(snapshot.capabilities)) throw new C8ContractError('MANIFEST_AUTHORITY_MISMATCH', 'run_role_or_capabilities');
  return { schema: c8Schemas.manifest, snapshot_digest: manifest.snapshot_digest, snapshot: c8Material(snapshot), run_identity: runIdentity, role, capabilities };
}
function c8ManifestRender(manifest, channel = 'block') {
  const canonical = c8Json(c8ManifestNormalize(manifest));
  if (channel === 'structured-json') return { channel, body: canonical, canonical_bytes: canonical, digest: c8DigestBytes(canonical) };
  if (channel !== 'block') throw new C8ContractError('MALFORMED_MANIFEST', 'channel');
  return c8ManifestStart + '\n' + canonical + '\n' + c8ManifestStop;
}
function c8ManifestExtract(rendered) {
  let canonical;
  if (rendered && rendered.channel === 'structured-json') {
    canonical = rendered.body;
    if (rendered.canonical_bytes !== canonical || rendered.digest !== c8DigestBytes(canonical)) throw new C8ContractError('MANIFEST_ROUND_TRIP_MISMATCH', 'structured-json');
  } else {
    if (typeof rendered !== 'string' || !rendered.startsWith(c8ManifestStart + '\n') || !rendered.endsWith('\n' + c8ManifestStop) || rendered.indexOf(c8ManifestStart) !== rendered.lastIndexOf(c8ManifestStart) || rendered.indexOf(c8ManifestStop) !== rendered.lastIndexOf(c8ManifestStop)) throw new C8ContractError('MANIFEST_ROUND_TRIP_MISMATCH', 'block');
    canonical = rendered.slice(c8ManifestStart.length + 1, -c8ManifestStop.length - 1);
  }
  const parsed = c8StrictJson(canonical);
  if (c8Json(parsed) !== canonical) throw new C8ContractError('MANIFEST_ROUND_TRIP_MISMATCH', 'canonical_bytes');
  return { manifest: c8ManifestNormalize(parsed), canonical_bytes: canonical, digest: c8DigestBytes(canonical) };
}

const c8LeaseTransitions = Object.freeze({ DRAFT: ['SEALED'], SEALED: ['DISPATCHED'], DISPATCHED: ['ADMITTED'], ADMITTED: ['COMPLETED'] });
function c8LeaseBody(lease) { const body = { ...lease }; delete body.lease_digest; return body; }
function c8LeaseCreate(snapshot, options = {}) {
  const source = c8Snapshot(snapshot);
  const lease = {
    schema: c8Schemas.lease,
    lease_id: options.lease_id || 'lease-043-1',
    snapshot_digest: source.snapshot_digest,
    repository: c8Clone(source.repository),
    pull_request: c8Clone(source.pull_request),
    exact_head: source.exact_remote_head_sha,
    run_identity: options.run_identity || source.run_identity,
    role: options.role || source.role,
    capabilities: c8List(options.capabilities || source.capabilities, 'lease.capabilities'),
    issued_at: options.issued_at || '2026-08-04T00:00:00.000Z',
    expires_at: options.expires_at || '2026-08-04T01:00:00.000Z',
    lifecycle: 'DRAFT',
    consumed: false,
    use_count: 0,
    sealed_at: null,
    dispatched_at: null,
    admitted_at: null,
    consumed_at: null
  };
  c8Text(lease.lease_id, 'lease_id'); if (Date.parse(lease.expires_at) <= Date.parse(lease.issued_at)) throw new C8ContractError('LEASE_INVALID', 'expiry');
  lease.lease_digest = c8DigestBytes(c8Json(c8LeaseBody(lease))); return c8Freeze(lease);
}
function c8LeaseTimestamp(value, field) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new C8ContractError('LEASE_TIME_INVALID', field);
  return timestamp;
}
function c8LeaseAuthorityKey(lease) {
  return c8Json({ repository: lease.repository, pull_request: lease.pull_request, exact_head: lease.exact_head, snapshot_digest: lease.snapshot_digest });
}
function c8LeaseBindingMatches(lease, binding) {
  return !!binding && c8Json({
    snapshot_digest: binding.snapshot_digest,
    repository: binding.repository,
    pull_request: binding.pull_request,
    exact_head: binding.exact_head,
    run_identity: binding.run_identity,
    role: binding.role,
    capabilities: binding.capabilities
  }) === c8Json({
    snapshot_digest: lease.snapshot_digest,
    repository: lease.repository,
    pull_request: lease.pull_request,
    exact_head: lease.exact_head,
    run_identity: lease.run_identity,
    role: lease.role,
    capabilities: lease.capabilities
  });
}
function c8LeaseTransition(lease, next, at) {
  if (!lease || lease.schema !== c8Schemas.lease) throw new C8ContractError('LEASE_INVALID', 'schema');
  if (lease.lease_digest !== c8DigestBytes(c8Json(c8LeaseBody(lease)))) throw new C8ContractError('LEASE_DIGEST_MISMATCH', 'lease_digest');
  if (lease.consumed) throw new C8ContractError('LEASE_ALREADY_CONSUMED', 'consumed');
  if (!c8LeaseTransitions[lease.lifecycle] || !c8LeaseTransitions[lease.lifecycle].includes(next)) throw new C8ContractError('LEASE_INVALID', 'lifecycle');
  if (next === 'COMPLETED' && at === undefined) throw new C8ContractError('CONSUMPTION_TIME_REQUIRED', 'consumption_time');
  const effectiveAt = at === undefined ? lease.issued_at : at;
  const issuedAt = c8LeaseTimestamp(lease.issued_at, 'issued_at');
  const expiresAt = c8LeaseTimestamp(lease.expires_at, 'expires_at');
  const transitionAt = c8LeaseTimestamp(effectiveAt, next === 'COMPLETED' ? 'consumption_time' : 'transition_time');
  if (expiresAt <= issuedAt || transitionAt < issuedAt) throw new C8ContractError('LEASE_TIME_ORDER_INVALID', 'timestamps');
  if (transitionAt >= expiresAt) throw new C8ContractError('LEASE_EXPIRED', 'expires_at');
  const previousAt = next === 'SEALED' ? lease.issued_at :
    next === 'DISPATCHED' ? lease.sealed_at :
      next === 'ADMITTED' ? lease.dispatched_at : lease.admitted_at;
  if (previousAt !== null && previousAt !== undefined && transitionAt < c8LeaseTimestamp(previousAt, 'prior_transition')) {
    throw new C8ContractError('LEASE_TIME_ORDER_INVALID', 'timestamps');
  }
  const out = {
    ...lease,
    lifecycle: next,
    consumed: next === 'COMPLETED',
    use_count: next === 'COMPLETED' ? lease.use_count + 1 : lease.use_count,
    sealed_at: next === 'SEALED' ? effectiveAt : lease.sealed_at,
    dispatched_at: next === 'DISPATCHED' ? effectiveAt : lease.dispatched_at,
    admitted_at: next === 'ADMITTED' ? effectiveAt : lease.admitted_at,
    consumed_at: next === 'COMPLETED' ? effectiveAt : lease.consumed_at
  };
  out.lease_digest = c8DigestBytes(c8Json(c8LeaseBody(out))); return c8Freeze(out);
}
class C8LeaseRegistry {
  constructor(storePath = null) { this.records = new Map(); this.storePath = storePath; }
  register(lease) {
    if (!lease || !lease.lease_id) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-registration', 'LEASE_INVALID', 'lease_id') };
    if (lease.lease_digest !== c8DigestBytes(c8Json(c8LeaseBody(lease)))) {
      this.records.set(lease.lease_id, lease);
      return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-registration', 'LEASE_DIGEST_MISMATCH', 'lease_digest', 'canonical lease digest', 'mismatch', null, lease) };
    }
    if (this.records.has(lease.lease_id)) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-registration', 'DUPLICATE_DISPATCH', 'lease_id', 'new lease id', 'duplicate', null, lease) };
    if (lease.lifecycle !== 'DRAFT' || lease.consumed !== false || lease.use_count !== 0) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-registration', 'LEASE_INVALID', 'lifecycle', 'DRAFT lease', 'invalid', null, lease) };
    for (const current of this.records.values()) if (c8LeaseAuthorityKey(current) === c8LeaseAuthorityKey(lease) && !['COMPLETED', 'EXPIRED'].includes(current.lifecycle)) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-registration', 'CONFLICTING_ACTIVE_LEASE', 'snapshot_digest', 'one active lease', 'conflict', null, lease) };
    this.records.set(lease.lease_id, lease); return { decision: 'LEASE_REGISTERED', lease };
  }
  transition(id, next, at) {
    const current = this.records.get(id); if (!current) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-transition', 'LEASE_INVALID', 'lease_id') };
    try { const lease = c8LeaseTransition(current, next, at); this.records.set(id, lease); return { decision: 'LEASE_' + next, lease }; }
    catch (error) { return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-transition', error.reason || 'LEASE_INVALID', error.field || 'lease', 'valid lifecycle', 'rejected', null, current) }; }
  }
  expire(id, at) {
    const current = this.records.get(id); if (!current) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-expiry', 'LEASE_INVALID', 'lease_id') };
    if (current.consumed) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-expiry', 'LEASE_ALREADY_CONSUMED', 'consumed', 'unconsumed lease', 'consumed', null, current) };
    const expiryCheck = c8LeaseTimestamp(at, 'expiry_time');
    if (expiryCheck < c8LeaseTimestamp(current.expires_at, 'expires_at')) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-expiry', 'LEASE_INVALID', 'expires_at', 'expiry reached', 'early', null, current) };
    const expired = { ...current, lifecycle: 'EXPIRED', expired_at: at };
    const lease = c8Freeze({ ...expired, lease_digest: c8DigestBytes(c8Json(c8LeaseBody(expired))) });
    this.records.set(id, lease); return { decision: 'LEASE_EXPIRED', lease };
  }
  consume(id, manifest, at) {
    const current = this.records.get(id); if (!current) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'LEASE_INVALID', 'lease_id') };
    if (current.consumed) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'LEASE_ALREADY_CONSUMED', 'consumed', 'unconsumed lease', 'consumed', null, current) };
    if (current.lease_digest !== c8DigestBytes(c8Json(c8LeaseBody(current)))) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'LEASE_DIGEST_MISMATCH', 'lease_digest', 'canonical lease digest', 'mismatch', null, current) };
    if (at === undefined) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'CONSUMPTION_TIME_REQUIRED', 'consumption_time', 'trusted current operation time', 'missing', null, current) };
    let consumptionTime;
    try { consumptionTime = c8LeaseTimestamp(at, 'consumption_time'); } catch (error) { return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', error.reason, error.field, 'finite current operation time', 'invalid', null, current) }; }
    if (consumptionTime >= c8LeaseTimestamp(current.expires_at, 'expires_at')) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'LEASE_EXPIRED', 'expires_at', 'consumption before expiry', 'expired', null, current) };
    if (current.lifecycle !== 'ADMITTED') return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'LEASE_NOT_ADMITTED', 'lifecycle', 'ADMITTED lease', current.lifecycle, null, current) };
    if (!c8LeaseBindingMatches(current, manifest)) return { decision: 'LEASE_REJECTED', receipt: c8Receipt('lease-consume', 'LEASE_BINDING_MISMATCH', 'authority_binding', 'exact snapshot/manifest binding', 'mismatch', null, current) };
    return this.transition(id, 'COMPLETED', at);
  }
}
function c8PreDispatch(input = {}) {
  const reject = (reason, field = 'tooling', snapshot = null, lease = null) => ({
    decision: 'PRE_DISPATCH_REJECTED',
    reason,
    evaluation_candidate_created: false,
    lease_consumed: false,
    mutation_performed: false,
    receipt: c8Receipt('pre-dispatch', reason, field, 'canonical-authority', 'rejected', snapshot, lease)
  });
  try {
    if (input.toolingFailure === true) return reject('PRE_DISPATCH_TOOLING_FAILURE', 'tooling');
    const collected = c8CollectMachine(input.machine);
    if (collected.decision !== 'MACHINE_AUTHORITY_COLLECTED') return { ...collected, reason: collected.reason || collected.receipt?.reason || 'PRE_DISPATCH_TOOLING_FAILURE', evaluation_candidate_created: false, lease_consumed: false, mutation_performed: false };
    const snapshot = c8Snapshot(collected.snapshot);
    if (!input.snapshot || input.snapshot.snapshot_digest !== snapshot.snapshot_digest) throw new C8ContractError('SNAPSHOT_DIGEST_MISMATCH', 'snapshot');
    const extracted = c8ManifestExtract(input.renderedManifest);
    if (extracted.manifest.snapshot_digest !== snapshot.snapshot_digest) throw new C8ContractError('SNAPSHOT_DIGEST_MISMATCH', 'manifest.snapshot_digest');
    const manifest = extracted.manifest;
    if (!input.lease) throw new C8ContractError('LEASE_REQUIRED', 'lease');
    if (input.lease.schema !== c8Schemas.lease || input.lease.consumed === true || input.lease.snapshot_digest !== snapshot.snapshot_digest) throw new C8ContractError('LEASE_INVALID', 'lease');
    if (!input.leaseRegistry || !(input.leaseRegistry.records instanceof Map)) throw new C8ContractError('LEASE_NOT_REGISTERED', 'lease_registry');
    const registeredLease = input.leaseRegistry.records.get(input.lease.lease_id);
    if (!registeredLease) throw new C8ContractError('LEASE_NOT_REGISTERED', 'lease_id');
    if (input.current_operation_time === undefined) throw new C8ContractError('CONSUMPTION_TIME_REQUIRED', 'consumption_time');
    const currentOperationTime = c8LeaseTimestamp(input.current_operation_time, 'consumption_time');
    if (currentOperationTime >= c8LeaseTimestamp(registeredLease.expires_at, 'expires_at')) throw new C8ContractError('LEASE_EXPIRED', 'expires_at');
    if (input.lease.lease_digest !== c8DigestBytes(c8Json(c8LeaseBody(input.lease)))) throw new C8ContractError('LEASE_DIGEST_MISMATCH', 'lease_digest');
    if (registeredLease.lease_digest !== input.lease.lease_digest) throw new C8ContractError('LEASE_DIGEST_MISMATCH', 'lease_digest');
    if (registeredLease.lifecycle !== 'ADMITTED') throw new C8ContractError('LEASE_NOT_ADMITTED', 'lifecycle');
    const binding = {
      snapshot_digest: snapshot.snapshot_digest,
      repository: snapshot.repository,
      pull_request: snapshot.pull_request,
      exact_head: snapshot.exact_remote_head_sha,
      run_identity: snapshot.run_identity,
      role: manifest.role,
      capabilities: manifest.capabilities
    };
    if (!c8LeaseBindingMatches(registeredLease, binding)) throw new C8ContractError('LEASE_BINDING_MISMATCH', 'authority_binding');
    if (!input.finalReread || typeof input.finalReread !== 'object' || !input.finalReread.machine) throw new C8ContractError('PRE_DISPATCH_TOOLING_FAILURE', 'final_reread');
    const finalCollected = c8CollectMachine(input.finalReread.machine);
    if (finalCollected.decision !== 'MACHINE_AUTHORITY_COLLECTED') return { ...finalCollected, reason: finalCollected.reason || finalCollected.receipt?.reason || 'PRE_DISPATCH_TOOLING_FAILURE', evaluation_candidate_created: false, lease_consumed: false, mutation_performed: false };
    const finalSnapshot = c8Snapshot(finalCollected.snapshot);
    if (finalSnapshot.snapshot_digest !== snapshot.snapshot_digest) throw new C8ContractError('AUTHORITY_MOVED', 'final_reread');
    const consumed = input.leaseRegistry.consume(input.lease.lease_id, binding, input.current_operation_time);
    if (consumed.decision !== 'LEASE_COMPLETED') throw new C8ContractError(consumed.receipt?.reason || 'LEASE_INVALID', consumed.receipt?.field || 'lease');
    return { decision: 'EVALUATION_CANDIDATE_CREATED', evaluation_candidate_created: true, lease_consumed: true, mutation_performed: false, snapshot_identity: snapshot.snapshot_digest, lease_identity: input.lease.lease_id, lease: consumed.lease };
  } catch (error) {
    return reject(error.reason || 'PRE_DISPATCH_TOOLING_FAILURE', error.field || 'tooling', input.snapshot || null, input.lease || null);
  }
}
function c8WorkerAdmission(input = {}) { const result = c8PreDispatch(input); return result.evaluation_candidate_created ? { ...result, worker_re_admitted: true, role: 'implementation/amendment worker' } : { ...result, worker_re_admitted: false }; }
function c8SensitivityReceipt(input = {}) { const classification = input.classification || 'none'; return { schema: c8Schemas.receipt, classification, mutation_performed: false, evaluation_candidate_created: false, sensitive_values_excluded: true }; }
function c8ClassifyOutput(input = {}) {
  const evidenceClassification = input.confirmedSensitive ? 'confirmed' : input.secretLike ? 'possible' : 'none';
  if (input.classification && input.classification !== evidenceClassification && (input.confirmedSensitive || input.secretLike)) throw new C8ContractError('SENSITIVITY_CLASSIFICATION_CONTRADICTION', 'classification');
  const classification = evidenceClassification; const affectedPath = input.affectedPath || 'affected-path';
  if (classification === 'none') return { ...c8SensitivityReceipt({ classification }), classification, continue: true, pause: false, redacted: false, reason: null, rotation_disposition: 'not_applicable', containment_disposition: 'not_applicable', invalidate_unrelated: false, affected_path: affectedPath };
  if (classification === 'possible') return { ...c8SensitivityReceipt({ classification }), classification, continue: false, pause: true, redacted: true, reason: 'SENSITIVITY_POSSIBLE', rotation_disposition: 'not_applicable', containment_disposition: 'not_applicable', invalidate_unrelated: false, affected_path: affectedPath };
  return { ...c8SensitivityReceipt({ classification }), classification, continue: false, pause: true, redacted: true, reason: 'SECRET_EXPOSURE_DETECTED', rotation_disposition: input.credential ? 'required' : 'not_applicable', containment_disposition: input.credential ? 'not_applicable' : 'required', invalidate_unrelated: input.sharedExposureRisk === true, affected_path: affectedPath };
}

function c8AdmittedLeaseFixture(snapshot, overrides = {}) {
  const machine = c8MachineAuthority();
  const lease = c8LeaseCreate(snapshot, { lease_id: overrides.lease_id || 'lease-test-' + Date.now() });
  const registry = new C8LeaseRegistry(overrides.lease_store_path);
  registry.register(lease);
  registry.transition(lease.lease_id, 'SEALED', '2026-08-04T00:00:05.000Z');
  registry.transition(lease.lease_id, 'DISPATCHED', '2026-08-04T00:00:10.000Z');
  registry.transition(lease.lease_id, 'ADMITTED', '2026-08-04T00:00:15.000Z');
  return {
    machine,
    snapshot,
    renderedManifest: c8ManifestRender(c8Manifest(snapshot)),
    lease: registry.records.get(lease.lease_id),
    leaseRegistry: registry,
    finalReread: { machine: c8MachineAuthority() },
    current_operation_time: overrides.current_operation_time || '2026-08-04T00:00:30.000Z'
  };
}
const c8SourceProhibitions = ['install', 'activate', 'schedule', 'Auto Review', 'automatic next-task pickup', 'Fast', 'delegation', 'spawn'];

test('C7 finality is conjunctive, Web-only, and does not require routine Temporary Chat assurance', () => {
  const evidence = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true])); evidence.g4Verdict = 'PASS'; evidence.g4ExactHead = true; evidence.webFinalityExecutionEvidence = c7WebFinalityEvidenceFixture();
  const result = c7FinalityDecision(evidence); assert.equal(result.decision, 'FINALITY_ADMITTED'); assert.equal(result.finality, true); assert.equal(result.webSoleFinalAuthority, true); assert.equal(result.routineAssuranceRequired, false); assert.equal(result.mergeAuthorized, false);
});
test('C7 missing predicates, contradictions, and exceptional reviewer boundary are enforced', () => {
  const evidence = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true])); evidence.g4Verdict = 'AMEND';
  const amended = c7FinalityDecision(evidence); assert.equal(amended.decision, 'FINALITY_BLOCKED'); assert.ok(amended.missing.includes('freshExactHeadG4Pass')); assert.ok(amended.contradictions.includes('G4_NOT_PASS'));
  assert.ok(c7FinalityDecision({ ...evidence, g4Verdict: 'PASS', completeTerminalPacket: false }).missing.includes('completeTerminalPacket'));
  assert.ok(c7FinalityDecision({ ...Object.fromEntries(c7FinalityPredicates.map((key) => [key, true])), g4Verdict: 'PASS', g4ExactHead: true, authorityClaims: [{ surface: 'manager', claim: 'merge authorized' }] }).contradictions.includes('MANAGER_FINALITY_CLAIM'));
  const grant = c7ExceptionalGrant();
  const grantRegistry = new C8DurableAuthorityRegistry(grant.authority_store_path, 'exceptional-review');
  assert.equal(c7ExceptionalReviewerAdmission(grant, c7ExceptionalGrantContext(), grantRegistry).replacesWebFinality, false);
});
test('C8 snapshot is deterministic, relevant, and requires full 40-character Git object identifiers', () => {
  const input = c8DefaultSnapshot(); const first = c8Snapshot(input); const second = c8Snapshot({ ...input, capabilities: [...input.capabilities].reverse() }); assert.equal(first.snapshot_digest, second.snapshot_digest); assert.equal(first.canonical_bytes, second.canonical_bytes);
  for (const value of [first.canonical_base_sha, first.exact_remote_head_sha, first.exact_tree_sha, ...first.authorised_blobs.map((blob) => blob.blob_sha)]) { assert.match(value, c8Sha); assert.equal(value.length, 40); }
  for (const value of [first.exact_remote_head_sha.slice(1), 'abc1234', 'g'.repeat(40)]) assert.throws(() => c8Snapshot({ ...input, exact_remote_head_sha: value }), (error) => error.reason === 'MALFORMED_SHA');
});
test('C8 machine collection requires byte-for-byte GitHub/local agreement and typed receipts', () => {
  const machine = c8MachineAuthority(); const valid = c8CollectMachine(machine); assert.equal(valid.decision, 'MACHINE_AUTHORITY_COLLECTED'); assert.equal(valid.bytes, c8Json({ github: machine.github, local: machine.local }));
  for (const [field, reason] of [['base_sha', 'BASE_MOVED'], ['head_sha', 'HEAD_MOVED'], ['tree_sha', 'TREE_MOVED'], ['blobs', 'BLOB_MOVED']]) { const mismatch = c8MachineAuthority(); if (field === 'blobs') mismatch.local.blobs[0].blob_sha = c8Hash('changed-blob'); else mismatch.local[field] = c8Hash('changed-' + field); const result = c8CollectMachine(mismatch); assert.equal(result.reason, reason); assert.equal(result.receipt.schema, c8Schemas.receipt); assert.equal(result.receipt.mutation_performed, false); assert.equal(result.receipt.evaluation_candidate_created, false); }
});
test('PRRT_kwDOSTHjGM6WPZc22 uses independent real-Git authority without surrounding checkout history', () => {
  const authority = c8RealGitAuthority();
  assert.equal(authority.canonical_base_sha, c8GitAuthorityFixture.canonical_base_sha);
  assert.equal(authority.exact_remote_head_sha, c8GitAuthorityFixture.exact_remote_head_sha);
  assert.equal(authority.exact_tree_sha, c8GitAuthorityFixture.exact_tree_sha);
  assert.notEqual(authority.canonical_base_sha, c8GitAuthorityFixture.immediate_parent_sha);
  assert.equal(c8CollectMachine(c8MachineAuthority()).decision, 'MACHINE_AUTHORITY_COLLECTED');

  const wrongBase = c8MachineAuthority();
  wrongBase.github.base_sha = c8GitAuthorityFixture.immediate_parent_sha;
  wrongBase.local.base_sha = c8GitAuthorityFixture.immediate_parent_sha;
  const rejected = c8CollectMachine(wrongBase);
  assert.equal(rejected.decision, 'MACHINE_AUTHORITY_REJECTED');
  assert.equal(rejected.reason, 'GIT_BASE_MISMATCH');
  assert.equal(rejected.receipt.mutation_performed, false);
  assert.equal(rejected.receipt.evaluation_candidate_created, false);
});
test('C8 deterministic parent markers and relevant child-keyed projection ignore unrelated sibling movement', () => {
  const marker = c8ParentMarker('status: admitted\nhead: full-object'); const parsed = c8ParentParse(marker); assert.equal(parsed.decision, 'PARENT_ENTRY_ADMITTED'); assert.equal(parsed.child_key, '#329'); assert.equal(parsed.revision, c8DigestBytes('status: admitted\nhead: full-object'));
  const baseline = c8Snapshot(c8DefaultSnapshot()); assert.equal(c8Compare(baseline, { unrelated_sibling_parent_revision: 'sibling-r99' }).decision, 'AUTHORITY_ADMITTED'); assert.equal(c8Compare(baseline, { exact_remote_head_sha: c8Hash('moved-head') }).reason, 'HEAD_MOVED'); assert.equal(c8Compare(baseline, { child_issue: { authority_revision: 'child-r2' }, child_authority_revision: 'child-r2' }).reason, 'CHILD_AUTHORITY_MOVED'); assert.throws(() => c8ParentParse(marker + '\n' + marker), (error) => error.reason === 'PARENT_ENTRY_MOVED');
});
test('C8 manifest render/extract round-trip is byte-exact and rejects alteration, truncation, and duplicate keys', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot()); const manifest = c8Manifest(snapshot); const block = c8ManifestRender(manifest); const structured = c8ManifestRender(manifest, 'structured-json'); assert.equal(c8ManifestExtract(block).canonical_bytes, c8ManifestExtract(structured).canonical_bytes);
  assert.throws(() => c8ManifestExtract(block.slice(0, -5)), (error) => error.reason === 'MANIFEST_ROUND_TRIP_MISMATCH'); assert.throws(() => c8ManifestExtract(block.replace(snapshot.snapshot_digest, c8DigestBytes('altered'))), (error) => ['SNAPSHOT_DIGEST_MISMATCH', 'MANIFEST_ROUND_TRIP_MISMATCH'].includes(error.reason)); assert.throws(() => c8ManifestExtract(block.replace('"schema":', '"schema":"duplicate","schema":')), (error) => error.reason === 'MALFORMED_MANIFEST');
});
test('C8 immutable leases enforce lifecycle, expiry, duplicates, conflicts, and consumption', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot()); const lease = c8LeaseCreate(snapshot, { lease_id: 'lease-c8-1' }); assert.equal(Object.isFrozen(lease), true); assert.equal(Object.isFrozen(lease.capabilities), true); assert.throws(() => { lease.lifecycle = 'COMPLETED'; }, TypeError);
  const sealed = c8LeaseTransition(lease, 'SEALED', '2026-08-04T00:00:05.000Z'); const dispatched = c8LeaseTransition(sealed, 'DISPATCHED', '2026-08-04T00:00:10.000Z'); const admitted = c8LeaseTransition(dispatched, 'ADMITTED', '2026-08-04T00:00:15.000Z'); const completed = c8LeaseTransition(admitted, 'COMPLETED', '2026-08-04T00:00:30.000Z'); assert.equal(completed.consumed, true); assert.equal(completed.use_count, 1);
  const registry = new C8LeaseRegistry(); assert.equal(registry.register(lease).decision, 'LEASE_REGISTERED'); assert.equal(registry.register(lease).receipt.reason, 'DUPLICATE_DISPATCH'); assert.equal(registry.register(c8LeaseCreate(snapshot, { lease_id: 'lease-c8-2' })).receipt.reason, 'CONFLICTING_ACTIVE_LEASE');
  const expired = c8LeaseCreate(snapshot, { lease_id: 'lease-expired', expires_at: '2026-08-04T00:01:00.000Z' }); const er = new C8LeaseRegistry(); er.register(expired); assert.equal(er.expire(expired.lease_id, '2026-08-04T00:02:00.000Z').decision, 'LEASE_EXPIRED'); assert.equal(er.transition(expired.lease_id, 'SEALED', '2026-08-04T00:02:00.000Z').receipt.reason, 'LEASE_INVALID');
  const consumed = new C8LeaseRegistry(); consumed.register(lease); consumed.records.set(lease.lease_id, completed); assert.equal(consumed.consume(lease.lease_id, { snapshot_digest: snapshot.snapshot_digest }).receipt.reason, 'LEASE_ALREADY_CONSUMED');
});
test('C8 pre-dispatch tooling failure creates no candidate and worker re-admission succeeds', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot()); const failed = c8PreDispatch({ toolingFailure: true }); assert.equal(failed.evaluation_candidate_created, false); assert.equal(failed.lease_consumed, false); assert.equal(failed.receipt.mutation_performed, false);
  const admittedFixture = c8AdmittedLeaseFixture(snapshot, { lease_id: 'pre-dispatch-success' }); const admitted = c8PreDispatch(admittedFixture); assert.equal(admitted.decision, 'EVALUATION_CANDIDATE_CREATED');
  const workerFixture = c8AdmittedLeaseFixture(snapshot, { lease_id: 'worker-success' }); assert.equal(c8WorkerAdmission(workerFixture).worker_re_admitted, true);
});
test('C8 sensitivity classification separates none, possible, credential rotation, and non-credential containment', () => {
  assert.equal(c8ClassifyOutput({ affectedPath: 'public-template' }).continue, true); const possible = c8ClassifyOutput({ secretLike: true, affectedPath: 'redacted-path' }); assert.equal(possible.reason, 'SENSITIVITY_POSSIBLE'); assert.equal(possible.pause, true);
  const credential = c8ClassifyOutput({ confirmedSensitive: true, credential: true, affectedPath: 'credential-path' }); assert.equal(credential.reason, 'SECRET_EXPOSURE_DETECTED'); assert.equal(credential.rotation_disposition, 'required'); assert.equal(credential.containment_disposition, 'not_applicable');
  const nonCredential = c8ClassifyOutput({ confirmedSensitive: true, credential: false, affectedPath: 'non-credential-path' }); assert.equal(nonCredential.containment_disposition, 'required'); assert.equal(nonCredential.rotation_disposition, 'not_applicable'); assert.equal(nonCredential.affected_path, 'non-credential-path');
});
test('C8 source-only boundary remains default-off and does not enable automated pickup', () => {
  const project = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8')); assert.equal(project.surface.publish_as, 'source_only'); assert.deepEqual(project.outputs, []); assert.deepEqual(project.writes.allowed, []);
  const source = [fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), fs.readFileSync(path.join(mainRoot, 'protocol.md'), 'utf8'), fs.readFileSync(path.join(mainRoot, 'architecture.md'), 'utf8'), ...a6PromptFiles.map((file) => fs.readFileSync(file, 'utf8'))].join('\n');
  for (const phrase of c8SourceProhibitions) assert.ok(source.includes(phrase), 'source-only contract should explicitly mention ' + phrase);
  assert.equal(source.includes('scheduler: enabled'), false); assert.equal(source.includes('auto_review: enabled'), false);
});

Object.assign(expectedInvariantBundles, {
  'C7-FINALITY-WEB-GATE-001': {
    semantics: {
      conjunctive_finality: 'Review/amend convergence, one fresh exact-head G4 PASS, a complete terminal packet, and comprehensive independent Web verification are all required at the same exact head.',
      web_sole_final_authority: 'Web is the sole comprehensive final authority; root, manager, worker, reviewer, and assurance surfaces are evidence-only.',
      contradiction_rejection: 'Root, manager, worker, reviewer, or assurance claims of finality, acceptance, merge, closure, waiver, or Web authority reject finality.',
      direct_amend: 'Web may return AMEND directly for a live contradiction or missing predicate without a second technical review.',
      routine_assurance_not_required: 'A routine Temporary Chat and CLEAR/CONCERN assurance are not normal-path finality predicates.'
    },
    evidence: {
      conjunctive_finality: ['review_amend_converged', 'fresh_exact_head_g4_pass', 'terminal_packet_complete', 'web_comprehensive_final_gate'],
      web_sole_final_authority: ['web_final_authority', 'non_web_surfaces_evidence_only', 'merge_authority'],
      contradiction_rejection: ['contradictory_role_claims', 'waived_predicates', 'finality_decision'],
      direct_amend: ['web_verdict', 'amend_reason', 'second_review_required'],
      routine_assurance_not_required: ['temporary_chat_required', 'assurance_result_required', 'normal_path_predicates']
    }
  },
  'C8-AUTHORITY-SNAPSHOT-LEASE-001': {
    semantics: {
      canonical_snapshot: 'toolkit-authority-snapshot/v1 is deterministic canonical JSON with sorted keys, normalized arrays, full SHAs, and a SHA-256 digest.',
      relevant_projection: 'Admission compares only the child-keyed relevant child, PR, and parent-entry projection; unrelated sibling-parent movement is non-invalidating.',
      immutable_one_run_lease: 'toolkit-authority-lease/v1 is immutable after sealing, one-run, duplicate-safe, expiry-bound, and cannot be replayed after consumption.',
      machine_byte_agreement: 'GitHub and local machine authority collections agree byte-for-byte for base, head, tree, blobs, identity, scope, role, capabilities, and relevant revisions.',
      manifest_round_trip: 'toolkit-authority-manifest/v1 renders and extracts with exact bytes and the same digest; malformed or altered manifests fail closed.'
    },
    evidence: {
      canonical_snapshot: ['snapshot_schema', 'canonical_bytes', 'snapshot_digest', 'full_sha_validation'],
      relevant_projection: ['child_key', 'pr_revision', 'parent_entry_revision', 'unrelated_sibling_movement'],
      immutable_one_run_lease: ['lease_schema', 'lease_digest', 'lifecycle', 'sealed_immutable', 'consumed'],
      machine_byte_agreement: ['github_collection', 'local_collection', 'byte_for_byte_agreement', 'mismatch_reason'],
      manifest_round_trip: ['manifest_schema', 'rendered_bytes', 'extracted_bytes', 'round_trip_digest']
    }
  },
  'C8-ADMISSION-MUTATION-BOUNDARY-001': {
    semantics: {
      typed_fail_closed_receipts: 'Every authority, manifest, lease, tooling, or sensitivity failure returns a typed admission receipt with mutation_performed false.',
      pre_dispatch_no_candidate: 'A pre-dispatch tooling or authority failure creates no evaluation candidate and consumes no lease.',
      sensitivity_handling: 'none, possible, and confirmed output classes redact/no-repeat values and distinguish credential rotation from non-credential containment.',
      default_off_source_only: 'The machinery remains source-only, uninstalled, unscheduled, inactive, credential-free, and cannot enable Auto Review or automatic next-task pickup.'
    },
    evidence: {
      typed_fail_closed_receipts: ['receipt_schema', 'reason', 'mutation_performed', 'sensitive_value_omitted'],
      pre_dispatch_no_candidate: ['tooling_failure', 'evaluation_candidate_created', 'lease_consumed'],
      sensitivity_handling: ['classification', 'redacted', 'pause_affected_path', 'rotation_disposition', 'containment_disposition'],
      default_off_source_only: ['source_only', 'installed', 'scheduled', 'auto_review', 'next_task_pickup', 'credentials']
    }
  }
});

function c7ExpectedWebFinalityContext() {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    pull_request: 333,
    exact_head: snapshot.exact_remote_head_sha,
    run_id: 'run-web-finality-synthetic',
    session_id: 'session-web-finality-synthetic',
    turn_id: 'turn-web-finality-synthetic'
  };
}

function c7BuildWebFinalityEvidenceRecord() {
  const context = c7ExpectedWebFinalityContext();
  const locator = {
    source_class: 'authoritative-raw',
    kind: 'github-api',
    exact_locator: 'raw://weijunswj/ai-agent-toolkit/pr-333/web-finality#web-execution-identity',
    evidence_identity: 'web-finality-execution-evidence-trusted-v1',
    inspected_subject: 'web-execution-identity',
    observed_at: '2026-08-11T00:00:00.000Z',
    accessible: true,
    repository: context.repository,
    pull_request: context.pull_request,
    exact_head: context.exact_head
  };
  locator.resolved_locator = locator.exact_locator;
  locator.resolved_evidence_identity = locator.evidence_identity;
  locator.resolved_bytes = c6ResolvedEvidenceBytes(locator);
  locator.content_digest = c8DigestBytes(locator.resolved_bytes);
  const executionIdentity = {
    provider: 'web-provider-synthetic',
    canonical_model: 'web-model-synthetic',
    reasoning: 'web-reasoning-synthetic',
    assignment_source: 'web-authoritative-assignment',
    assignment_evidence_locator: 'raw://weijunswj/ai-agent-toolkit/pr-333/web-assignment#web-assignment',
    role: 'Web Orchestrator verification',
    surface: 'web-orchestrator',
    run_id: context.run_id,
    session_id: context.session_id,
    turn_id: context.turn_id,
    repository: context.repository,
    pull_request: context.pull_request,
    exact_head: context.exact_head,
    evidence_locator: locator.exact_locator,
    evidence_identity: locator.evidence_identity
  };
  const bytes = c8Json({
    schema: 'web-finality-execution/v1',
    authority: context,
    execution_identity: executionIdentity
  });
  return {
    schema: 'web-finality-execution-evidence/v1',
    bytes,
    content_digest: c8DigestBytes(bytes),
    evidence_identity: locator.evidence_identity,
    authoritative_locator: locator,
  };
}

function c7WebFinalityEvidenceFixture(overrides = {}) {
  const trusted = c28TrustedLookup('web-finality', 'web-finality-execution-evidence-trusted-v1');
  return { ...(trusted ? c8Clone(trusted) : c7BuildWebFinalityEvidenceRecord()), ...overrides };
}

function c7VerifiedWebExecutionIdentity(rawEvidence, expected = c7ExpectedWebFinalityContext()) {
  const trusted = rawEvidence && c28TrustedLookup('web-finality', rawEvidence.evidence_identity);
  if (!trusted || c8Json(trusted) !== c8Json(rawEvidence)) return null;
  if (!rawEvidence || rawEvidence.schema !== 'web-finality-execution-evidence/v1' ||
      !c6ValidEvidenceDigest(rawEvidence) || rawEvidence.evidence_identity !== rawEvidence.authoritative_locator?.evidence_identity) return null;
  const locator = rawEvidence.authoritative_locator;
  const context = { authority: { repository: expected.repository, pull_request: expected.pull_request, head: expected.exact_head } };
  if (!c6ValidRawLocator(locator, 'web-execution-identity', context) ||
      rawEvidence.content_digest !== c8DigestBytes(rawEvidence.bytes)) return null;
  let parsed;
  try { parsed = JSON.parse(rawEvidence.bytes); } catch { return null; }
  if (c8Json(parsed) !== rawEvidence.bytes || parsed.schema !== 'web-finality-execution/v1' ||
      c8Json(parsed.authority) !== c8Json(expected)) return null;
  const identity = parsed.execution_identity;
  if (!identity || ['provider', 'canonical_model', 'reasoning', 'assignment_source', 'assignment_evidence_locator', 'role', 'surface', 'run_id', 'session_id', 'turn_id'].some((field) => !nonEmptyString(identity[field])) ||
      identity.role !== 'Web Orchestrator verification' || identity.surface !== 'web-orchestrator' ||
      identity.repository !== expected.repository || identity.pull_request !== expected.pull_request || identity.exact_head !== expected.exact_head ||
      identity.run_id !== expected.run_id || identity.session_id !== expected.session_id || identity.turn_id !== expected.turn_id ||
      identity.evidence_locator !== locator.exact_locator || identity.evidence_identity !== locator.evidence_identity) return null;
  return identity;
}

function c7FinalityDecision(evidence = {}) {
  const missing = c7FinalityPredicates.filter((key) => evidence[key] !== true);
  const addMissing = (key) => { if (!missing.includes(key)) missing.push(key); };
  const contradictions = [];
  const verifiedWebIdentity = c7VerifiedWebExecutionIdentity(evidence.webFinalityExecutionEvidence);
  const webExecutionIdentityVerified = !!verifiedWebIdentity;
  if (!webExecutionIdentityVerified) addMissing('comprehensiveIndependentWebFinalGate');
  if (evidence.g4Verdict !== 'PASS') { addMissing('freshExactHeadG4Pass'); contradictions.push('G4_NOT_PASS'); }
  if (evidence.g4ExactHead !== true) { addMissing('freshExactHeadG4Pass'); contradictions.push('G4_HEAD_MISMATCH'); }
  if (evidence.webSoleFinalAuthority === false) contradictions.push('WEB_AUTHORITY_CONTRADICTION');
  for (const identity of [evidence.webExecutionIdentity, evidence.comprehensiveIndependentWebFinalGateIdentity]) {
    if (identity && identity.actor !== undefined && identity.actor !== 'web') contradictions.push('WEB_IDENTITY_CONTRADICTION');
  }
  for (const claim of evidence.authorityClaims || []) if (claim && /finality|accept|merge|close|waive|web/i.test(String(claim.claim || ''))) contradictions.push(String(claim.surface || 'unknown').toUpperCase() + '_FINALITY_CLAIM');
  const base = { mergeAuthorized: false, webSoleFinalAuthority: true, webExecutionIdentityVerified, webExecutionIdentity: verifiedWebIdentity, routineAssuranceRequired: false, missing, contradictions };
  return missing.length || contradictions.length ? { ...base, decision: 'FINALITY_BLOCKED', finality: false } : { ...base, decision: 'FINALITY_ADMITTED', finality: true };
}
function c8Snapshot(input) {
  const material = input && input.snapshot_digest ? c8Material(input) : c8NormalizeSnapshot(input);
  const bytes = c8Json(material);
  return c8Freeze({ ...material, snapshot_digest: c8DigestBytes(bytes), canonical_bytes: bytes });
}
function c8Manifest(snapshot, options = {}) {
  const source = c8Snapshot(snapshot);
  return { schema: c8Schemas.manifest, snapshot_digest: source.snapshot_digest, snapshot: c8Material(source), run_identity: options.run_identity || source.run_identity, role: options.role || source.role, capabilities: c8List(options.capabilities || source.capabilities, 'manifest.capabilities') };
}
function c8LeaseCreate(snapshot, options = {}) {
  const source = c8Snapshot(snapshot);
  const lease = {
    schema: c8Schemas.lease,
    lease_id: options.lease_id || 'lease-043-1',
    snapshot_digest: source.snapshot_digest,
    repository: c8Clone(source.repository),
    pull_request: c8Clone(source.pull_request),
    exact_head: source.exact_remote_head_sha,
    run_identity: options.run_identity || source.run_identity,
    role: options.role || source.role,
    capabilities: c8List(options.capabilities || source.capabilities, 'lease.capabilities'),
    issued_at: options.issued_at || '2026-08-04T00:00:00.000Z',
    expires_at: options.expires_at || '2026-08-04T01:00:00.000Z',
    lifecycle: 'DRAFT',
    consumed: false,
    use_count: 0,
    sealed_at: null,
    dispatched_at: null,
    admitted_at: null,
    consumed_at: null
  };
  c8Text(lease.lease_id, 'lease_id'); if (Date.parse(lease.expires_at) <= Date.parse(lease.issued_at)) throw new C8ContractError('LEASE_INVALID', 'expiry');
  lease.lease_digest = c8DigestBytes(c8Json(c8LeaseBody(lease))); return c8Freeze(lease);
}

function c28CreateTrustedAuthorityStore() {
  const namespaces = {
    'web-finality': {},
    'hosted-review': {},
    'machine-github-api': {},
    'machine-local-git': {},
    'exceptional-review': {}
  };
  const put = (namespace, identity, record) => { namespaces[namespace][identity] = c8Freeze(c8Clone(record)); };

  const web = c7BuildWebFinalityEvidenceRecord();
  put('web-finality', web.evidence_identity, web);

  const hostedIdentities = [
    { repository: 'opaque/repository', pr: 'pr-opaque', head: 'head-a', capability: 'external-review' },
    { repository: 'opaque/repository', pr: 'pr-opaque', head: 'head-b', capability: 'external-review' }
  ];
  for (const identity of hostedIdentities) {
    for (const state of ['pending', 'completed']) {
      const evidenceIdentity = c28HostedEvidenceIdentity(identity, state);
      put('hosted-review', evidenceIdentity, {
        evidence_identity: evidenceIdentity,
        source: 'github-hosted-review',
        reviewType: 'codex-pull-request-review',
        actor: 'chatgpt-codex-connector',
        mechanism: 'github-codex-review',
        supported: true,
        identity: c8Clone(identity),
        state
      });
    }
  }

  put('machine-github-api', c28TrustedMachineEvidenceIds.github, c28BuildTrustedMachineRecord('github-api'));
  put('machine-local-git', c28TrustedMachineEvidenceIds.local, c28BuildTrustedMachineRecord('local-git'));
  for (let index = 1; index <= 32; index += 1) {
    const grant = c7BuildExceptionalGrantRecord('exceptional-grant-trusted-' + index);
    put('exceptional-review', grant.grant_id, grant);
  }

  const frozenNamespaces = Object.fromEntries(Object.entries(namespaces).map(([namespace, records]) => [namespace, Object.freeze(records)]));
  const frozen = Object.freeze(frozenNamespaces);
  return Object.freeze({
    resolve(namespace, identity) {
      const record = frozen[namespace] && frozen[namespace][identity];
      return record ? c8Clone(record) : null;
    }
  });
}

c28TrustedAuthorityStore = c28CreateTrustedAuthorityStore();

const c10TriggerValue = () => [String.fromCharCode(64), 'co', 'dex', ' ', 're', 'view'].join('');
const c10ZeroWidth = (value) => value.split('').join(String.fromCharCode(0x200b));

test('PRRT_kwDOSTHjGM6WPZco binds finality to a verified Web execution identity', () => {
  const evidence = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true]));
  const result = c7FinalityDecision({ ...evidence, g4Verdict: 'PASS', g4ExactHead: true, webExecutionIdentity: { actor: 'manager' }, comprehensiveIndependentWebFinalGate: { actor: 'manager' } });
  assert.equal(result.decision, 'FINALITY_BLOCKED');
  assert.equal(result.webExecutionIdentityVerified, false);
});

test('BF-3: finality requires authoritative Web execution evidence bound to every material identity', () => {
  const predicates = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true]));
  const admitted = c7FinalityDecision({ ...predicates, g4Verdict: 'PASS', g4ExactHead: true, webFinalityExecutionEvidence: c7WebFinalityEvidenceFixture() });
  assert.equal(admitted.decision, 'FINALITY_ADMITTED');
  assert.equal(admitted.webExecutionIdentityVerified, true);

  const mutateRaw = (mutate) => {
    const evidence = c7WebFinalityEvidenceFixture();
    const parsed = JSON.parse(evidence.bytes);
    mutate(parsed, evidence);
    evidence.bytes = c8Json(parsed);
    evidence.content_digest = c8DigestBytes(evidence.bytes);
    return evidence;
  };
  const cases = [
    ['missing raw evidence', { webExecutionIdentity: { actor: 'web' }, comprehensiveIndependentWebFinalGate: { actor: 'web' } }],
    ['candidate verified boolean', { webExecutionIdentityVerified: true, webExecutionIdentity: { actor: 'web' } }],
    ['wrong repository locator', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); evidence.authoritative_locator.repository = 'other/repository'; return evidence; })() }],
    ['wrong pull request locator', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); evidence.authoritative_locator.pull_request = 334; return evidence; })() }],
    ['wrong head locator', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); evidence.authoritative_locator.exact_head = c8Hash('stale-head'); return evidence; })() }],
    ['missing locator', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); delete evidence.authoritative_locator; return evidence; })() }],
    ['malformed outer digest', { webFinalityExecutionEvidence: { ...c7WebFinalityEvidenceFixture(), content_digest: 'sha256:not-a-digest' } }],
    ['wrong locator digest', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); evidence.authoritative_locator.content_digest = 'sha256:' + '0'.repeat(64); return evidence; })() }],
    ['wrong evidence identity', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); evidence.evidence_identity = 'forged-evidence-id'; return evidence; })() }],
    ['unresolved locator', { webFinalityExecutionEvidence: (() => { const evidence = c7WebFinalityEvidenceFixture(); evidence.authoritative_locator.accessible = false; return evidence; })() }],
    ['stale run identity', { webFinalityExecutionEvidence: mutateRaw((parsed) => { parsed.execution_identity.run_id = 'stale-run'; }) }],
    ['stale session identity', { webFinalityExecutionEvidence: mutateRaw((parsed) => { parsed.execution_identity.session_id = 'stale-session'; }) }],
    ['stale turn identity', { webFinalityExecutionEvidence: mutateRaw((parsed) => { parsed.execution_identity.turn_id = 'stale-turn'; }) }],
    ['manager execution identity', { webFinalityExecutionEvidence: mutateRaw((parsed) => { parsed.execution_identity.role = 'manager'; }) }],
    ['wrong authority repository', { webFinalityExecutionEvidence: mutateRaw((parsed) => { parsed.authority.repository = 'other/repository'; }) }]
  ];
  for (const [label, overrides] of cases) {
    const result = c7FinalityDecision({ ...predicates, g4Verdict: 'PASS', g4ExactHead: true, ...overrides });
    assert.equal(result.decision, 'FINALITY_BLOCKED', label);
  }
  for (const actor of ['manager', 'executor', 'unknown']) {
    const result = c7FinalityDecision({ ...predicates, g4Verdict: 'PASS', g4ExactHead: true, webFinalityExecutionEvidence: c7WebFinalityEvidenceFixture(), webExecutionIdentity: { actor } });
    assert.equal(result.decision, 'FINALITY_BLOCKED', actor);
    assert.ok(result.contradictions.includes('WEB_IDENTITY_CONTRADICTION'), actor);
  }
});

test('PRRT_kwDOSTHjGM6WPZcq collects complete non-Git authority independently on both sides', () => {
  const machine = c8MachineAuthority();
  assert.notStrictEqual(machine.github, machine.local);
  assert.notStrictEqual(machine.github.collector, machine.local.collector);
  assert.notEqual(machine.github.collector.evidence_identity, machine.local.collector.evidence_identity);
  assert.notEqual(machine.github.collector.evidence_locator.exact_locator, machine.local.collector.evidence_locator.exact_locator);
  assert.notEqual(machine.github.collector.evidence_digest, machine.local.collector.evidence_digest);
  const required = ['repository', 'child_issue', 'pull_request', 'parent_entry', 'design_lock', 'run_identity', 'scope', 'role', 'capabilities', 'base_sha', 'head_sha', 'tree_sha', 'blobs'];
  for (const field of required) {
    assert.notEqual(machine.github[field], undefined, 'github ' + field);
    assert.notEqual(machine.local[field], undefined, 'local ' + field);
  }
  const collected = c8CollectMachine({
    ...machine,
    snapshot_input: { ...machine.snapshot_input, role: 'caller-fabricated-role', capabilities: ['caller-fabricated-capability'] }
  });
  assert.equal(collected.decision, 'MACHINE_AUTHORITY_COLLECTED');
  assert.equal(collected.snapshot.role, machine.github.role);
  assert.deepEqual(collected.snapshot.capabilities, machine.github.capabilities);
  for (const [field, reason] of [
    ['repository', 'REPOSITORY_MOVED'],
    ['child_issue', 'CHILD_AUTHORITY_MOVED'],
    ['pull_request', 'PR_AUTHORITY_MOVED'],
    ['parent_entry', 'PARENT_ENTRY_MOVED'],
    ['design_lock', 'DESIGN_LOCK_MISMATCH'],
    ['run_identity', 'RUN_IDENTITY_MISMATCH'],
    ['scope', 'SCOPE_MISMATCH'],
    ['role', 'ROLE_MISMATCH'],
    ['capabilities', 'CAPABILITY_MISMATCH']
  ]) {
    const mismatch = c8MachineAuthority();
    mismatch.local[field] = JSON.parse(JSON.stringify(mismatch.local[field]));
    if (field === 'capabilities') mismatch.local[field] = mismatch.local[field].concat('expanded');
    else if (field === 'scope') mismatch.local[field].paths = mismatch.local[field].paths.concat('fabricated');
    else if (field === 'repository') mismatch.local[field].name = 'fabricated-repository';
    else if (field === 'child_issue') mismatch.local[field].authority_revision = 'child-fabricated';
    else if (field === 'pull_request') mismatch.local[field].authority_revision = 'pr-fabricated';
    else if (field === 'parent_entry') mismatch.local[field].authority_revision = 'parent-fabricated';
    else mismatch.local[field] = 'fabricated-' + field;
    const rejected = c8CollectMachine(mismatch);
    assert.equal(rejected.decision, 'MACHINE_AUTHORITY_REJECTED', field);
    assert.equal(rejected.reason, reason, field);
    assert.equal(rejected.receipt.mutation_performed, false, field);
    assert.equal(rejected.receipt.evaluation_candidate_created, false, field);
  }
  const empty = c8CollectMachine({ github: {}, local: {} });
  assert.equal(empty.decision, 'MACHINE_AUTHORITY_REJECTED');
  assert.equal(empty.reason, 'MALFORMED_MACHINE_AUTHORITY');

  const relabelled = c8Clone(machine.github);
  relabelled.collector.source = 'local-git';
  relabelled.collector.collection_id = 'machine-authority-local-git-v1';
  const raw = JSON.parse(relabelled.collector.evidence_bytes);
  raw.source = 'local-git';
  relabelled.collector.evidence_bytes = c8Json(raw);
  relabelled.collector.evidence_digest = c8DigestBytes(relabelled.collector.evidence_bytes);
  relabelled.collector.evidence_locator.exact_locator = 'raw://weijunswj/ai-agent-toolkit/pr-333/local-git/machine-authority#machine-authority';
  relabelled.collector.evidence_locator.resolved_locator = relabelled.collector.evidence_locator.exact_locator;
  relabelled.collector.evidence_locator.resolved_bytes = relabelled.collector.evidence_bytes;
  relabelled.collector.evidence_locator.kind = 'local-command';
  relabelled.collector.evidence_locator.content_digest = relabelled.collector.evidence_digest;
  const relabelledResult = c8CollectMachine({ github: c8Clone(machine.github), local: relabelled });
  assert.equal(relabelledResult.decision, 'MACHINE_AUTHORITY_REJECTED');
  assert.equal(relabelledResult.reason, 'MACHINE_AUTHORITY_INDEPENDENCE_REQUIRED');
});

test('PRRT_kwDOSTHjGM6WPZdE uses locale-independent blob ordering', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot({ authorised_blobs: [{ path: 'a', blob_sha: c8Hash('a') }, { path: 'Z', blob_sha: c8Hash('Z') }] }));
  assert.deepEqual(snapshot.authorised_blobs.map((blob) => blob.path), ['Z', 'a']);
});

test('PRRT_kwDOSTHjGM6WPZdI rejects a parent entry nested inside a sibling marker', () => {
  const nested = '<!-- toolkit-authority-parent-entry/v1 child=#other -->\\n' + c8ParentMarker('nested') + '\\n<!-- /toolkit-authority-parent-entry/v1 -->';
  assert.throws(() => c8ParentParse(nested), (error) => error.reason === 'MALFORMED_PARENT_ENTRY');
});

test('PRRT_kwDOSTHjGM6WPZcv requires an admitted lease before creating a candidate', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  const admitted = c8AdmittedLeaseFixture(snapshot, { lease_id: 'lease-pre-dispatch-positive' });
  const noLease = c8PreDispatch({ ...admitted, lease: undefined });
  assert.equal(noLease.reason, 'LEASE_REQUIRED');
  assert.equal(noLease.evaluation_candidate_created, false);
  const draftLease = c8LeaseCreate(snapshot, { lease_id: 'lease-draft-only' });
  const draftRegistry = new C8LeaseRegistry();
  draftRegistry.register(draftLease);
  const draft = c8PreDispatch({ ...admitted, lease: draftLease, leaseRegistry: draftRegistry });
  assert.equal(draft.reason, 'LEASE_NOT_ADMITTED');
  assert.equal(draft.evaluation_candidate_created, false);
  const unregistered = c8PreDispatch({ ...admitted, lease: c8LeaseCreate(snapshot, { lease_id: 'lease-unregistered' }) });
  assert.equal(unregistered.reason, 'LEASE_NOT_REGISTERED');
  assert.equal(unregistered.evaluation_candidate_created, false);
  const tampered = c8PreDispatch({ ...admitted, lease: { ...admitted.lease, role: 'tampered-role' } });
  assert.equal(tampered.reason, 'LEASE_DIGEST_MISMATCH');
  assert.equal(tampered.evaluation_candidate_created, false);
  const conflict = c8LeaseCreate(snapshot, { lease_id: 'lease-conflict' });
  assert.equal(admitted.leaseRegistry.register(conflict).receipt.reason, 'CONFLICTING_ACTIVE_LEASE');
  const accepted = c8AdmittedLeaseFixture(snapshot, { lease_id: 'lease-pre-dispatch-accepted' });
  const result = c8PreDispatch(accepted);
  assert.equal(result.decision, 'EVALUATION_CANDIDATE_CREATED');
  assert.equal(result.evaluation_candidate_created, true);
  assert.equal(accepted.leaseRegistry.records.get(accepted.lease.lease_id).lifecycle, 'COMPLETED');
  assert.equal(accepted.leaseRegistry.records.get(accepted.lease.lease_id).consumed, true);
});

test('PRRT_kwDOSTHjGM6WPZcx evaluates lease expiry at consumption time', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  const lease = c8LeaseCreate(snapshot, { lease_id: 'expiry-consume', issued_at: '2026-08-04T00:00:00.000Z', expires_at: '2026-08-04T00:01:00.000Z' });
  const registry = new C8LeaseRegistry(); registry.register(lease); registry.records.set(lease.lease_id, c8LeaseTransition(c8LeaseTransition(lease, 'SEALED'), 'DISPATCHED'));
  registry.records.set(lease.lease_id, c8LeaseTransition(registry.records.get(lease.lease_id), 'ADMITTED'));
  assert.equal(registry.consume(lease.lease_id, { snapshot_digest: snapshot.snapshot_digest }).receipt.reason, 'CONSUMPTION_TIME_REQUIRED');
  const exactExpiry = c8AdmittedLeaseFixture(snapshot, { lease_id: 'expiry-exact' });
  exactExpiry.leaseRegistry.records.set(exactExpiry.lease.lease_id, { ...exactExpiry.lease, expires_at: '2026-08-04T00:00:30.000Z', lease_digest: c8DigestBytes(c8Json({ ...c8LeaseBody(exactExpiry.lease), expires_at: '2026-08-04T00:00:30.000Z' })) });
  assert.equal(exactExpiry.leaseRegistry.consume(exactExpiry.lease.lease_id, { snapshot_digest: snapshot.snapshot_digest }, '2026-08-04T00:00:30.000Z').receipt.reason, 'LEASE_EXPIRED');
  const afterExpiry = c8AdmittedLeaseFixture(snapshot, { lease_id: 'expiry-current-operation' });
  afterExpiry.leaseRegistry.records.set(afterExpiry.lease.lease_id, { ...afterExpiry.lease, expires_at: '2026-08-04T00:01:00.000Z', lease_digest: c8DigestBytes(c8Json({ ...c8LeaseBody(afterExpiry.lease), expires_at: '2026-08-04T00:01:00.000Z' })) });
  const result = c8PreDispatch({ ...afterExpiry, current_operation_time: '2026-08-04T00:02:00.000Z', consumption_time: '2026-08-04T00:00:30.000Z' });
  assert.equal(result.reason, 'LEASE_EXPIRED');
  assert.equal(result.evaluation_candidate_created, false);
});

test('PRRT_kwDOSTHjGM6WPZdL binds manifest role and capabilities to snapshot and lease', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  const valid = c8Manifest(snapshot);
  assert.equal(c8ManifestNormalize(valid).run_identity, snapshot.run_identity);
  for (const overrides of [
    { run_identity: 'different-run' },
    { role: 'authoritative technical G4' },
    { capabilities: ['bounded_source_mutation', 'pre_dispatch_admission', 'read_authority', 'expanded'] },
    { capabilities: ['read_authority'] }
  ]) {
    const manifest = c8Manifest(snapshot, overrides);
    assert.throws(() => c8ManifestNormalize(manifest), (error) => error.reason === 'MANIFEST_AUTHORITY_MISMATCH');
  }
  const admitted = c8AdmittedLeaseFixture(snapshot, { lease_id: 'manifest-binding' });
  const mismatchedManifest = c8Manifest(snapshot, { run_identity: 'other-run' });
  const result = c8PreDispatch({ ...admitted, renderedManifest: c8ManifestStart + '\n' + c8Json(mismatchedManifest) + '\n' + c8ManifestStop });
  assert.equal(result.reason, 'MANIFEST_AUTHORITY_MISMATCH');
  assert.equal(result.evaluation_candidate_created, false);
});

test('PRRT_kwDOSTHjGM6WPZdP rejects tampered sealed lease bytes before transition', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  const lease = c8LeaseCreate(snapshot, { lease_id: 'tampered-lease' });
  const registry = new C8LeaseRegistry(); registry.register({ ...lease, role: 'tampered' });
  assert.equal(registry.transition(lease.lease_id, 'SEALED').receipt.reason, 'LEASE_DIGEST_MISMATCH');
});

test('PRRT_kwDOSTHjGM6WPZdT requires evidence-derived final authority reread', () => {
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  const result = c8PreDispatch({ machine: c8MachineAuthority(), snapshot, renderedManifest: c8ManifestRender(c8Manifest(snapshot)), finalReread: true, lease: c8LeaseCreate(snapshot) });
  assert.equal(result.evaluation_candidate_created, false);
});

test('PRRT_kwDOSTHjGM6WPZdX preserves typed machine mismatch through pre-dispatch', () => {
  const machine = c8MachineAuthority(); machine.local.head_sha = c8Hash('moved');
  const result = c8PreDispatch({ machine });
  assert.equal(result.receipt.reason, 'HEAD_MOVED');
});

test('PRRT_kwDOSTHjGM6WPZdh consumes assurance envelopes in durable state', () => {
  const storePath = c8NewAuthorityStorePath('assurance-envelope');
  const context = c6Context({ assurance_store_path: storePath, assuranceRegistry: new C8DurableAuthorityRegistry(storePath, 'assurance-envelope') });
  const envelope = c6LaunchEnvelope();
  const stale = JSON.parse(JSON.stringify(envelope));
  const shallow = { ...envelope };
  const first = c6DispatchAssurance(c6CanonicalTemplateText(), envelope, context);
  assert.equal(first.decision, 'ASSURANCE_DISPATCHED');
  for (const replay of [envelope, shallow, stale]) {
    const result = c6DispatchAssurance(c6CanonicalTemplateText(), replay, context);
    assert.equal(result.decision, 'ASSURANCE_ALREADY_CONSUMED');
    assert.equal(result.temporaryChatCreated, false);
  }
  const reloaded = c6Context({ assurance_store_path: storePath, assuranceRegistry: new C8DurableAuthorityRegistry(storePath, 'assurance-envelope') });
  const recreated = c6DispatchAssurance(c6CanonicalTemplateText(), JSON.parse(JSON.stringify(envelope)), reloaded);
  assert.equal(recreated.decision, 'ASSURANCE_ALREADY_CONSUMED');
  assert.equal(recreated.temporaryChatCreated, false);
});

test('PRRT_kwDOSTHjGM6WPZdn consumes admission grants outside returned copies', () => {
  const storePath = c8NewAuthorityStorePath('admission-grant');
  const grant = structuredGrant();
  grant.authority_store_path = storePath;
  grant.canonical_digest = c5GrantDigest(grant);
  const context = admissionContext();
  const registry = new C8DurableAuthorityRegistry(storePath, 'admission-grant');
  const stale = JSON.parse(JSON.stringify(grant));
  const shallow = { ...grant };
  const first = admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant, trustedPreToolUseHook, registry);
  const second = admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, grant, trustedPreToolUseHook, registry);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  for (const replay of [shallow, stale]) {
    assert.equal(admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, replay, trustedPreToolUseHook, registry).allowed, false);
  }
  const recreated = admissionDecision({ operation: 'spawn_agent', requestedAgentCount: 1 }, context, JSON.parse(JSON.stringify(grant)), trustedPreToolUseHook, new C8DurableAuthorityRegistry(storePath, 'admission-grant'));
  assert.equal(recreated.allowed, false);
});

test('PRRT_kwDOSTHjGM6WPZdu verifies assurance evidence digests cryptographically', () => {
  const validEnvelope = c6LaunchEnvelope();
  assert.equal(c6LaunchAdmission(validEnvelope).decision, 'ASSURANCE_LAUNCH_ADMITTED');
  const cases = [
    ['fake label', (envelope) => { envelope.evidence['exact-authority-graph'].authoritative_locator.content_digest = 'sha256:authority-movement'; }],
    ['malformed', (envelope) => { envelope.evidence['exact-authority-graph'].authoritative_locator.content_digest = 'not-a-digest'; }],
    ['wrong digest', (envelope) => { envelope.evidence['exact-authority-graph'].authoritative_locator.content_digest = 'sha256:' + '0'.repeat(64); }],
    ['different bytes', (envelope) => { envelope.evidence['exact-authority-graph'].authoritative_locator.resolved_bytes = 'different-evidence'; }],
    ['altered evidence', (envelope) => { envelope.evidence['exact-authority-graph'].authoritative_locator.resolved_bytes += '-altered'; }],
    ['different locator', (envelope) => { envelope.evidence['exact-authority-graph'].authoritative_locator.resolved_locator = 'raw://other-locator'; }]
  ];
  for (const [label, alter] of cases) {
    const envelope = JSON.parse(JSON.stringify(validEnvelope));
    alter(envelope);
    const result = c6LaunchAdmission(envelope);
    assert.equal(result.decision, 'ASSURANCE_EVIDENCE_DIGEST_INVALID', label);
    assert.equal(result.temporaryChatCreated, false, label);
  }
});

test('PRRT_kwDOSTHjGM6WPZd1 verifies Git object type and exact path binding', () => {
  const valid = c8CollectMachine(c8MachineAuthority());
  assert.equal(valid.decision, 'MACHINE_AUTHORITY_COLLECTED');
  const snapshot = c8Snapshot(c8DefaultSnapshot());
  const head = snapshot.exact_remote_head_sha;
  const alternateTree = c8GitAuthorityFixture.immediate_parent_tree_sha;
  const alternateBlob = c8GitAuthorityFixture.alternate_blob_sha;
  const cases = [
    ['zero commit', (machine) => { machine.github.head_sha = '0'.repeat(40); machine.local.head_sha = '0'.repeat(40); }, 'GIT_COMMIT_INVALID'],
    ['nonexistent object', (machine) => { machine.github.tree_sha = 'f'.repeat(40); machine.local.tree_sha = 'f'.repeat(40); }, 'GIT_TREE_INVALID'],
    ['commit presented as blob', (machine) => { machine.github.blobs[0].blob_sha = head; machine.local.blobs[0].blob_sha = head; }, 'GIT_BLOB_TYPE_INVALID'],
    ['blob presented as tree', (machine) => { machine.github.tree_sha = alternateBlob; machine.local.tree_sha = alternateBlob; }, 'GIT_TREE_TYPE_INVALID'],
    ['wrong commit tree pairing', (machine) => { machine.github.tree_sha = alternateTree; machine.local.tree_sha = alternateTree; }, 'GIT_TREE_MISMATCH'],
    ['missing path', (machine) => { machine.github.blobs[0].path = 'missing/path'; machine.local.blobs[0].path = 'missing/path'; }, 'GIT_PATH_MISSING'],
    ['correct blob wrong path', (machine) => { machine.github.blobs[0].path = 'README.md'; machine.local.blobs[0].path = 'README.md'; }, 'GIT_PATH_BINDING_MISMATCH'],
    ['blob from another tree', (machine) => { machine.github.blobs[0].blob_sha = alternateBlob; machine.local.blobs[0].blob_sha = alternateBlob; }, 'GIT_PATH_BINDING_MISMATCH'],
    ['path traversal', (machine) => { machine.github.blobs[0].path = '../AGENTS.md'; machine.local.blobs[0].path = '../AGENTS.md'; }, 'GIT_PATH_INVALID'],
    ['ambiguous path', (machine) => { machine.github.blobs[0].path = machine.github.blobs[0].path.replace('/', '//'); machine.local.blobs[0].path = machine.github.blobs[0].path; }, 'GIT_PATH_INVALID']
  ];
  for (const [label, mutate, reason] of cases) {
    const machine = c8MachineAuthority();
    mutate(machine);
    const result = c8CollectMachine(machine);
    assert.equal(result.decision, 'MACHINE_AUTHORITY_REJECTED', label);
    assert.equal(result.reason, reason, label);
    assert.equal(result.receipt.mutation_performed, false, label);
    assert.equal(result.receipt.evaluation_candidate_created, false, label);
  }
});

test('PRRT_kwDOSTHjGM6WPZdc keeps embedded API keys detectable', () => {
  const key = ['x', ['s', 'k', '-'].join(''), 'A'.repeat(24)].join('');
  assert.equal(c10ContainsEmbeddedCredential(key), true);
});

test('PRRT_kwDOSTHjGM6WPZc2 prevents sensitivity labels from downgrading confirmed evidence', () => {
  assert.throws(() => c8ClassifyOutput({ classification: 'none', confirmedSensitive: true }), (error) => error.reason === 'SENSITIVITY_CLASSIFICATION_CONTRADICTION');
  const receipt = c8SensitivityReceipt({ classification: 'possible' });
  assert.equal(receipt.schema, c8Schemas.receipt); assert.equal(receipt.mutation_performed, false); assert.equal(receipt.evaluation_candidate_created, false);
});

test('C10 generic writers reject the configured review invocation', () => {
  assert.throws(() => c10GenericGitHubWrite('comment ' + c10TriggerValue()), (error) => error.code === 'CODEX_TRIGGER_TOKEN_FORBIDDEN');
});

test('C10 generic writers reject obfuscated and encoded invocation forms', () => {
  const trigger = c10TriggerValue();
  for (const value of [c10ZeroWidth(trigger), trigger.toUpperCase(), Buffer.from(trigger).toString('base64'), '`' + trigger + '`']) {
    assert.throws(() => c10GenericGitHubWrite(value), (error) => error.code === 'CODEX_TRIGGER_TOKEN_FORBIDDEN');
  }
});

test('PRRT_kwDOSTHjGM6WPZc9 admits one exact Web-issued exceptional-review grant', () => {
  const booleansOnly = c7ExceptionalReviewerAdmission({ explicitPreauthorised: true, beforeDispatch: true, freshIsolated: true, readOnly: true, nonAuthoritative: true, exactHead: true, category: 'critical_security_boundary' });
  assert.equal(booleansOnly.allowed, false);
  assert.equal(booleansOnly.mutation_performed, false);
  assert.equal(booleansOnly.evaluation_candidate_created, false);
  const grant = c7ExceptionalGrant();
  const context = c7ExceptionalGrantContext();
  const registry = new C8DurableAuthorityRegistry(grant.authority_store_path, 'exceptional-review');
  const admitted = c7ExceptionalReviewerAdmission(grant, context, registry);
  assert.equal(admitted.decision, 'SECOND_REVIEWER_ADMITTED');
  assert.equal(admitted.allowed, true);
  assert.equal(admitted.replacesWebFinality, false);
  for (const [field, value] of [
    ['issuer', { identity: 'executor', role: 'implementation worker', surface: 'executor-root' }],
    ['repository', 'other/repository'],
    ['pull_request', 334],
    ['exact_head', '0'.repeat(40)],
    ['review', { run_id: 'other-run', session_id: 'session-exceptional-synthetic', turn_id: 'turn-exceptional-synthetic' }],
    ['governing_authority_revision', 'child-other'],
    ['category', 'ordinary-review'],
    ['expires_at', '2026-08-03T22:00:00.000Z']
  ]) {
    const candidate = c7ExceptionalGrant({ [field]: value });
    const result = c7ExceptionalReviewerAdmission(candidate, context, new C8DurableAuthorityRegistry(candidate.authority_store_path, 'exceptional-review'));
    assert.equal(result.allowed, false, field);
    assert.equal(result.mutation_performed, false, field);
    assert.equal(result.evaluation_candidate_created, false, field);
  }
  const replay = c7ExceptionalReviewerAdmission(JSON.parse(JSON.stringify(grant)), context, new C8DurableAuthorityRegistry(grant.authority_store_path, 'exceptional-review'));
  assert.equal(replay.decision, 'EXCEPTIONAL_REVIEW_GRANT_REPLAYED');
  assert.equal(replay.allowed, false);
});

test('C10 preserves G4 reply-without-resolution and Web-only finality', () => {
  const evidence = {
    ...g4ConversationEvidenceFixture(),
    phase: 'FINAL',
    verdict: 'PASS',
    reply: true,
    finalExactHead: true,
    bounded: true,
    evidenceBound: true
  };
  assert.equal(g4ConversationMutation({ ...evidence, resolve: true }).decision, 'G4_MUTATION_REJECTED');
  assert.equal(g4ConversationMutation({ ...evidence, resolve: false }).decision, 'G4_REPLY_ALLOWED');
  assert.equal(webFinalityMutation({ actor: 'manager', resolve: true }).decision, 'WEB_FINALITY_REJECTED');
  assert.equal(webFinalityMutation({
    actor: 'web',
    resolve: true,
    action: 'resolve',
    thread_id: 'PRRT_kwDOSTHjGM6YIMr_',
    repository: 'weijunswj/ai-agent-toolkit',
    pull_request: 333,
    exact_head: c8GitAuthorityFixture.exact_remote_head_sha,
    webFinalityExecutionEvidence: c7WebFinalityEvidenceFixture()
  }).decision, 'WEB_FINALITY_ALLOWED');
});

test('BP-7: verified Web finality mutation rejects label-only, non-Web, stale, wrong-head, and malformed evidence', () => {
  const base = {
    actor: 'web',
    resolve: true,
    action: 'resolve',
    thread_id: 'PRRT_kwDOSTHjGM6YIMr_',
    repository: 'weijunswj/ai-agent-toolkit',
    pull_request: 333,
    exact_head: c8GitAuthorityFixture.exact_remote_head_sha,
    webFinalityExecutionEvidence: c7WebFinalityEvidenceFixture()
  };
  assert.equal(webFinalityMutation({ actor: 'web', resolve: true }).decision, 'WEB_FINALITY_REJECTED');
  assert.equal(webFinalityMutation({ ...base, actor: 'manager' }).decision, 'WEB_FINALITY_REJECTED');
  assert.equal(webFinalityMutation({ ...base, exact_head: c8Hash('wrong-finality-head') }).decision, 'WEB_FINALITY_REJECTED');
  const stale = c7WebFinalityEvidenceFixture();
  const staleParsed = JSON.parse(stale.bytes);
  staleParsed.execution_identity.run_id = 'stale-run';
  stale.bytes = c8Json(staleParsed);
  stale.content_digest = c8DigestBytes(stale.bytes);
  assert.equal(webFinalityMutation({ ...base, webFinalityExecutionEvidence: stale }).decision, 'WEB_FINALITY_REJECTED');
  assert.equal(webFinalityMutation({ ...base, webFinalityExecutionEvidence: { ...base.webFinalityExecutionEvidence, content_digest: 'sha256:not-a-digest' } }).decision, 'WEB_FINALITY_REJECTED');
  assert.equal(webFinalityMutation(base).decision, 'WEB_FINALITY_ALLOWED');
});

test('RED BF-1: G4 conversation replies must not bypass FINAL permission evidence', () => {
  assert.equal(g4ConversationMutation({
    phase: 'PRE_G4',
    verdict: 'PASS',
    reply: true,
    finalExactHead: true,
    bounded: true,
    evidenceBound: true
  }).decision, 'G4_MUTATION_REJECTED');
});

test('BF-1: one authoritative G4 permission path admits only bounded exact-head final PASS replies', () => {
  const valid = {
    ...g4ConversationEvidenceFixture(),
    phase: 'FINAL',
    action: 'reply',
    reply: true,
    verdict: 'PASS',
    finalExactHead: true,
    bounded: true,
    evidenceBound: true
  };
  assert.equal(g4ThreadPermission(valid), true);
  assert.equal(g4ConversationMutation(valid).decision, 'G4_REPLY_ALLOWED');
  const cases = [
    ['missing phase', { phase: undefined }],
    ['pre G4 phase', { phase: 'PRE_G4' }],
    ['amend phase', { phase: 'AMEND' }],
    ['amend verdict', { verdict: 'AMEND' }],
    ['wrong head flag', { finalExactHead: false }],
    ['unbounded authority', { bounded: false }],
    ['unbound evidence', { evidenceBound: false }],
    ['reply omitted', { reply: false }],
    ['wrong action', { action: 'comment' }],
    ['wrong exact head', { exactHeadBinding: { ...valid.exactHeadBinding, head: c8Hash('wrong-g4-head') } }],
    ['wrong authority role', { boundedReplyAuthority: { ...valid.boundedReplyAuthority, role: 'manager' } }],
    ['missing evidence binding', { evidenceBinding: undefined }],
    ['malformed evidence digest', { evidenceBinding: { ...valid.evidenceBinding, content_digest: 'sha256:not-a-digest' } }],
    ['wrong evidence digest', { evidenceBinding: { ...valid.evidenceBinding, content_digest: 'sha256:' + '0'.repeat(64) } }],
    ['altered evidence bytes', { evidenceBinding: { ...valid.evidenceBinding, bytes: 'altered-evidence' } }],
    ['wrong evidence locator', { evidenceBinding: { ...valid.evidenceBinding, locator: 'raw://other#not-g4' } }],
    ['contradictory resolve', { resolve: true }],
    ['malformed reopen', { reopen: 'false' }],
    ['contradictory dismiss', { dismiss: true }]
  ];
  for (const [label, overrides] of cases) {
    const candidate = { ...valid, ...overrides };
    assert.equal(g4ThreadPermission(candidate), false, label);
    assert.equal(g4ConversationMutation(candidate).decision, 'G4_MUTATION_REJECTED', label);
  }
  for (const action of ['resolve', 'reopen', 'dismiss']) {
    assert.equal(g4ConversationMutation({ ...valid, action }).decision, 'G4_MUTATION_REJECTED', action);
  }
});

test('BF-2: every invariant has an executable negative contract with fail-closed registry validation', () => {
  const registry = invariantRegistry();
  const record = registry.invariants.find((entry) => entry.invariant_id === 'AUTH-LEDGER-RECEIPT-001');
  const expected = expectedInvariantBundles[record.invariant_id];
  const registration = negativeTestContracts.get(record.invariant_id);
  assert.equal(validateNegativeTestRegistry(registry.invariants), 'PRESERVED');
  assert.equal(invariantDecision(record, expected), 'PRESERVED');

  const missing = new Map(negativeTestContracts);
  missing.delete(record.invariant_id);
  assert.equal(validateNegativeTestRegistry(registry.invariants, missing), 'INVARIANT_REGRESSION');

  const unknown = new Map(negativeTestContracts);
  unknown.set('UNKNOWN-INVARIANT-001', { ...registration, invariant_id: 'UNKNOWN-INVARIANT-001', negative_test_id: negativeTestReference('UNKNOWN-INVARIANT-001'), reference: negativeTestReference('UNKNOWN-INVARIANT-001') });
  assert.equal(validateNegativeTestRegistry(registry.invariants, unknown), 'INVARIANT_REGRESSION');

  const duplicate = [...negativeTestContracts.values(), registration];
  assert.equal(validateNegativeTestRegistry(registry.invariants, duplicate), 'INVARIANT_REGRESSION');

  const mismatched = new Map(negativeTestContracts);
  mismatched.set(record.invariant_id, { ...registration, invariant_id: 'OTHER-INVARIANT-001' });
  assert.equal(validateNegativeTestRegistry(registry.invariants, mismatched), 'INVARIANT_REGRESSION');

  const original = negativeTestContracts.get(record.invariant_id);
  try {
    negativeTestContracts.set(record.invariant_id, { ...registration, execute: 'not-executable' });
    assert.equal(validateNegativeTestRegistry(registry.invariants), 'INVARIANT_REGRESSION');
    negativeTestContracts.set(record.invariant_id, {
      ...registration,
      execute() {
        return { invariant_id: record.invariant_id, negative_test_id: record.negative_test };
      }
    });
    assert.equal(validateNegativeTestRegistry(registry.invariants), 'INVARIANT_REGRESSION');
    negativeTestContracts.set(record.invariant_id, {
      ...registration,
      execute(candidate, evaluate) {
        const broken = { ...candidate, negative_test: registration.negative_test_id + '::broken' };
        return { invariant_id: record.invariant_id, negative_test_id: record.negative_test, candidate: broken, outcome: 'PRESERVED' };
      }
    });
    assert.equal(validateNegativeTestRegistry(registry.invariants), 'INVARIANT_REGRESSION');
  } finally {
    negativeTestContracts.set(record.invariant_id, original);
  }
  const stringOnly = new Map(negativeTestContracts);
  stringOnly.set(record.invariant_id, registration.reference);
  assert.equal(invariantDecision(record, expected, { registrations: stringOnly }), 'INVARIANT_REGRESSION');
});

test('RED BF-3: a candidate-labelled Web actor cannot prove finality identity', () => {
  const evidence = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true]));
  const result = c7FinalityDecision({
    ...evidence,
    g4Verdict: 'PASS',
    g4ExactHead: true,
    webExecutionIdentity: { actor: 'web' },
    comprehensiveIndependentWebFinalGate: { actor: 'web' }
  });
  assert.equal(result.decision, 'FINALITY_BLOCKED');
});

test('RED BF-4: relabelling one shared machine snapshot is not independent authority', () => {
  const machine = c8MachineAuthority();
  const shared = c8Clone(machine.github);
  shared.collector = { source: 'local-git', collection_id: 'local-authority-record-v1' };
  const result = c8CollectMachine({ github: c8Clone(machine.github), local: shared });
  assert.equal(result.decision, 'MACHINE_AUTHORITY_REJECTED');
});

test('RED BP-1: every negative contract must mutate a validator-relevant invariant field', () => {
  for (const record of invariantRegistry().invariants) {
    const registration = negativeTestContracts.get(record.invariant_id);
    assert.ok(registration && registration.behavioral_contract && typeof registration.behavioral_contract.mutate === 'function', record.invariant_id);
    const result = registration.execute(c8Clone(record), (candidate) => invariantDecision(candidate, expectedInvariantBundles[record.invariant_id], { skipNegativeContract: true, registrations: negativeTestContracts }));
    assert.equal(result.candidate.negative_test, registration.negative_test_id, record.invariant_id);
    assert.ok(result.behavioral_violation, record.invariant_id);
    assert.equal(result.outcome, 'INVARIANT_REGRESSION', record.invariant_id);
  }
});

test('RED BP-2: internally consistent candidate-authored Web evidence is not authoritative', () => {
  const predicates = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true]));
  const result = c7FinalityDecision({ ...predicates, g4Verdict: 'PASS', g4ExactHead: true, webFinalityExecutionEvidence: c7SelfAuthoredWebFinalityEvidence() });
  assert.equal(result.decision, 'FINALITY_BLOCKED');
});

test('RED BP-3: two mutually consistent caller snapshots cannot establish independent authority', () => {
  let result;
  try {
    const fabricated = c8DefaultSnapshot();
    const github = c8CollectGithubMachineAuthority(fabricated);
    const local = c8CollectLocalMachineAuthority(c8Clone(fabricated));
    result = c8CollectMachine({ github, local });
  } catch (error) {
    result = { decision: 'MACHINE_AUTHORITY_REJECTED', reason: error.reason };
  }
  assert.equal(result.decision, 'MACHINE_AUTHORITY_REJECTED');
});

test('RED BP-4: caller labels cannot manufacture hosted-review capability', () => {
  const identity = { repository: 'opaque/repository', pr: 'pr-opaque', head: 'head-a', capability: 'external-review' };
  const forged = { identity, state: 'completed', rawEvidence: true, hostedEvidence: { source: 'github-hosted-review', reviewType: 'codex-pull-request-review', actor: 'chatgpt-codex-connector', mechanism: 'github-codex-review', supported: true, identity, state: 'completed', evidence_identity: 'candidate-forged-hosted-review' } };
  assert.equal(externalReviewGate({ identity, limitExhausted: false, reviews: [forged] }).decision, 'NEW_REVIEW_REQUIRED');
});

test('RED BP-5: a self-contained exceptional grant cannot prove prior Web issuance', () => {
  const forged = c7SelfAuthoredExceptionalGrant();
  const result = c7ExceptionalReviewerAdmission(forged, c7ExceptionalGrantContext(), new C8DurableAuthorityRegistry(forged.authority_store_path, 'exceptional-review'));
  assert.equal(result.allowed, false);
});

test('RED BP-6: C8 authority-path ordering must not call localeCompare', () => {
  assert.equal(c8MachineSideNormalize.toString().includes('localeCompare'), false);
});

test('RED BP-7: Web finality mutation requires verified execution evidence, not actor text', () => {
  assert.equal(webFinalityMutation({ actor: 'web', resolve: true }).decision, 'WEB_FINALITY_REJECTED');
});

function c7SelfAuthoredWebFinalityEvidence() {
  const forged = c7WebFinalityEvidenceFixture();
  const evidenceIdentity = 'candidate-forged-web-finality';
  const locator = { ...forged.authoritative_locator, exact_locator: 'raw://weijunswj/ai-agent-toolkit/pr-333/forged-web-finality#web-execution-identity', evidence_identity: evidenceIdentity };
  locator.resolved_locator = locator.exact_locator; locator.resolved_evidence_identity = evidenceIdentity; locator.resolved_bytes = c6ResolvedEvidenceBytes(locator); locator.content_digest = c8DigestBytes(locator.resolved_bytes);
  const parsed = JSON.parse(forged.bytes); parsed.execution_identity = { ...parsed.execution_identity, evidence_locator: locator.exact_locator, evidence_identity: evidenceIdentity };
  forged.bytes = c8Json(parsed); forged.content_digest = c8DigestBytes(forged.bytes); forged.evidence_identity = evidenceIdentity; forged.authoritative_locator = locator;
  return forged;
}

function c7SelfAuthoredExceptionalGrant() {
  const context = c7ExceptionalGrantContext();
  const grant = { schema: 'exceptional-review-grant/v1', grant_id: 'candidate-forged-exceptional-grant', issuer: { identity: 'web-orchestrator', role: 'Web Orchestrator', surface: 'web-orchestrator' }, repository: context.repository, pull_request: context.pull_request, exact_head: context.exact_head, review: c8Clone(context.review), governing_authority_revision: context.governing_authority_revision, category: context.category, issued_at: '2026-08-03T22:59:00.000Z', expires_at: '2026-08-04T00:00:00.000Z', lifecycle: { state: 'issued', consumed: false, use_count: 0, consumed_at: null }, authority_store_path: c8NewAuthorityStorePath('candidate-forged-exceptional-review') };
  grant.canonical_digest = c7GrantDigest(grant); return grant;
}

function c6ValidEvidenceDigest(record) { return !!record && typeof record.bytes === 'string' && typeof record.content_digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(record.content_digest) && record.content_digest === c8DigestBytes(record.bytes); }
function c8VerifyGitObjectBinding(input = {}) { return !!input && input.object_type === input.expected_type && input.path === input.tree_path; }
function c10ContainsEmbeddedCredential(text) { return typeof text === 'string' && /sk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/.test(text); }
function c10NormaliseOutbound(value) { let text = String(value); const trigger = [String.fromCharCode(64), 'co', 'dex', ' ', 're', 'view'].join(''); for (let i = 0; i < 3; i++) { text = text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[\"']|`[a-z]*|`/gi, ''); if (text.toLowerCase().includes(trigger)) return true; const decoded = Buffer.from(text, 'base64').toString('utf8'); if (!decoded || decoded === text || /[\u0000-\u0008\u000E-\u001F]/.test(decoded)) break; text = decoded; } return false; }
function c10GenericGitHubWrite(finalBytes) { if (c10NormaliseOutbound(finalBytes)) { const error = new Error('CODEX_TRIGGER_TOKEN_FORBIDDEN'); error.code = 'CODEX_TRIGGER_TOKEN_FORBIDDEN'; throw error; } return finalBytes; }
const c10ReviewHeads = new Set();
function c10ReviewRequestAdmission(request = {}) { const key = [request.repository, request.pull_request, request.head, request.tree].join('|'); const valid = request.role === 'authoritative technical G4 closure' && request.repository === 'weijunswj/ai-agent-toolkit' && request.pull_request === 333 && request.target === 'pr-conversation' && request.grant?.one_run === true && request.checks?.terminal_success === true && request.prior_request === false && request.readback === true && request.head && request.tree; if (!valid || c10ReviewHeads.has(key)) return { decision: 'REVIEW_REQUEST_REJECTED' }; c10ReviewHeads.add(key); return { decision: 'REVIEW_REQUEST_ADMITTED', target: 'pr-conversation', one_run: true }; }
function g4ConversationMutation(input = {}) {
  if (input.resolve === true || input.reopen === true || input.dismiss === true || (input.action !== undefined && input.action !== 'reply')) {
    return { decision: 'G4_MUTATION_REJECTED' };
  }
  return g4ConversationPermission({ ...input, action: 'reply' })
    ? { decision: 'G4_REPLY_ALLOWED' }
    : { decision: 'G4_MUTATION_REJECTED' };
}
function webFinalityMutation(input = {}) {
  const reject = (reason = 'WEB_FINALITY_REJECTED') => ({ decision: reason, mutation_performed: false, evaluation_candidate_created: false });
  const expected = c7ExpectedWebFinalityContext();
  const verified = c7VerifiedWebExecutionIdentity(input.webFinalityExecutionEvidence, expected);
  if (!verified || input.resolve !== true || input.action !== 'resolve' || !nonEmptyString(input.thread_id) ||
      input.repository !== expected.repository || input.pull_request !== expected.pull_request || input.exact_head !== expected.exact_head ||
      (input.actor !== undefined && input.actor !== 'web')) return reject();
  return { decision: 'WEB_FINALITY_ALLOWED', mutation_performed: false, evaluation_candidate_created: false, thread_id: input.thread_id, execution_identity: verified };
}
test('C10 source has no custom waiting infrastructure or raw trigger literal', () => {
  const source = [fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), fs.readFileSync(path.join(mainRoot, 'protocol.md'), 'utf8'), ...a6PromptFiles.map((file) => fs.readFileSync(file, 'utf8'))].join('\\n');
  const triggerPattern = new RegExp(c10TriggerValue().replace(' ', '\\\\s+'), 'i');
  assert.doesNotMatch(source, /setTimeout|setInterval|heartbeat|callback service|wake daemon/);
  assert.doesNotMatch(source, triggerPattern);
});


const c11InstructionSource = path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'ai-coding-agent-execution.md');
const c11WindowsSource = path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'repo-local', 'docs', 'agent-playbooks', 'windows-command-hygiene.md');
const c11CuratedAgentsSource = path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', 'curated_output_for_ai', 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md');

function c11SourceText() {
  return [
    fs.readFileSync(c11InstructionSource, 'utf8'),
    fs.readFileSync(c11WindowsSource, 'utf8'),
    fs.readFileSync(c11CuratedAgentsSource, 'utf8'),
    fs.readFileSync(path.join(mainRoot, 'architecture.md'), 'utf8'),
    fs.readFileSync(path.join(mainRoot, 'protocol.md'), 'utf8'),
    fs.readFileSync(path.join(mainRoot, 'state-machine.md'), 'utf8'),
    ...a6PromptFiles.map((file) => fs.readFileSync(file, 'utf8'))
  ].join(String.fromCharCode(10));
}

test('C11 exact live finding bindings are represented by regression subjects', () => {
  const bindings = [
    ['PRRT_kwDOSTHjGM6WPZcj', 'routine Temporary Chat'],
    ['PRRT_kwDOSTHjGM6WPZco', 'verified Web execution identity'],
    ['PRRT_kwDOSTHjGM6WPZcq', 'non-Git authority'],
    ['PRRT_kwDOSTHjGM6WPZcv', 'admitted lease'],
    ['PRRT_kwDOSTHjGM6WPZcx', 'consumption time'],
    ['PRRT_kwDOSTHjGM6WPZc2', 'sensitivity'],
    ['PRRT_kwDOSTHjGM6WPZc3', 'typed no-mutation'],
    ['PRRT_kwDOSTHjGM6WPZc9', 'exceptional-review grant'],
    ['PRRT_kwDOSTHjGM6WPZdE', 'locale-independent'],
    ['PRRT_kwDOSTHjGM6WPZdI', 'nested markers'],
    ['PRRT_kwDOSTHjGM6WPZdL', 'manifest role'],
    ['PRRT_kwDOSTHjGM6WPZdP', 'sealed lease'],
    ['PRRT_kwDOSTHjGM6WPZdT', 'fresh second machine'],
    ['PRRT_kwDOSTHjGM6WPZdX', 'machine-mismatch receipt'],
    ['PRRT_kwDOSTHjGM6WPZdc', 'embedded API-key'],
    ['PRRT_kwDOSTHjGM6WPZdh', 'assurance envelope'],
    ['PRRT_kwDOSTHjGM6WPZdn', 'admission grant'],
    ['PRRT_kwDOSTHjGM6WPZdu', 'cryptographic digest'],
    ['PRRT_kwDOSTHjGM6WPZd1', 'Git object type']
  ];
  const text = c11SourceText();
  for (const [thread, subject] of bindings) {
    assert.ok(text.includes(subject), thread + ' missing exact finding subject ' + subject);
  }
});

test('C11 normal finality does not require routine assurance, while exceptional assurance requires an exact grant', () => {
  const closure = fs.readFileSync(path.join(templateRoot, 'closure-manager.prompt.md'), 'utf8');
  assert.match(closure, /routine Temporary Chat.*not required/i);
  assert.match(c11SourceText(), /exceptional assurance.*explicit.*grant/i);
});

test('C11 default-deny delegation rejects silence, generic speed, malformed grants, and over-count launches', () => {
  assert.equal(c11DelegationDecision({ operation: 'spawn_agent' }, {}).reason, 'DELEGATION_NOT_AUTHORISED');
  assert.equal(c11DelegationDecision({ operation: 'spawn_agent', speed: 'faster' }, {}).reason, 'DELEGATION_NOT_AUTHORISED');
  assert.equal(c11DelegationDecision({ operation: 'spawn_agent', requested_count: 2 }, c11Grant()).reason, 'DELEGATION_NOT_AUTHORISED');
});

test('C11 ordinary helper mode requires explicit non-overlapping scope and Auto-code admits one exclusive worker', () => {
  assert.equal(c11DelegationDecision({ operation: 'helper', scope: ['src/a'] }, c11Grant({ mode: 'ordinary-helper', scope: ['src/b'] })).allowed, true);
  assert.equal(c11DelegationDecision({ operation: 'helper', scope: ['src/a'] }, c11Grant({ mode: 'ordinary-helper', scope: ['src/a'] })).reason, 'SCOPE_OVERLAP');
  assert.equal(c11DelegationDecision({ operation: 'spawn_agent' }, c11Grant({ mode: 'exclusive-auto-code', count: 1 })).allowed, true);
  assert.equal(c11DelegationDecision({ operation: 'spawn_agent' }, c11Grant({ mode: 'exclusive-auto-code', count: 2 })).reason, 'DELEGATION_NOT_AUTHORISED');
});

test('C11 Auto-code manager suspends until native terminal return and never infers failure from time or quiet output', () => {
  const active = c11AutoCodeLifecycle('worker-active');
  assert.equal(active.manager_state, 'MANAGER_SUSPENDED_ON_NATIVE_WORKER');
  assert.equal(active.progress_inspection, 'forbidden');
  assert.equal(c11AutoCodeLifecycle('bounded-wait-expired').manager_state, 'MANAGER_SUSPENDED_ON_NATIVE_WORKER');
  assert.equal(c11AutoCodeLifecycle('no-file-change').manager_state, 'MANAGER_SUSPENDED_ON_NATIVE_WORKER');
  assert.equal(c11AutoCodeLifecycle('native-terminal-return').manager_state, 'MANAGER_READY_FOR_VALIDATION');
});

test('C11 user interruption preserves exclusive ownership and replacement requires terminal loss plus a new grant', () => {
  assert.equal(c11AutoCodeLifecycle('user-interruption').workspace, 'preserved');
  assert.equal(c11AutoCodeLifecycle('user-interruption').ownership, 'unchanged');
  assert.equal(c11AutoCodeLifecycle('replacement-before-terminal').replacement, 'forbidden');
  assert.equal(c11AutoCodeLifecycle('replacement-after-loss-with-new-grant').replacement, 'allowed');
});

test('C11 Windows command timeouts do not terminate native agent lifecycles', () => {
  const text = fs.readFileSync(c11WindowsSource, 'utf8');
  assert.match(text, /operating-system operations only/i);
  assert.match(text, /native.*terminal only when the harness reports/i);
  assert.match(text, /bounded command wait.*not.*native-agent timeout/i);
});

test('C11 source versions record behavioural contract additions', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', 'toolkit.project.json'), 'utf8'));
  const autoCode = JSON.parse(fs.readFileSync(path.join(projectRoot, 'toolkit.project.json'), 'utf8'));
  assert.equal(rules.version, '3.1.2');
  assert.equal(autoCode.version, '1.9.0');
  assert.match(rules.version_notes, /C13 three-mode.*common.*safeguards/i);
  assert.match(rules.version_notes, /capacity.*non-Fast.*non-nesting.*context-minimisation/i);
  assert.match(autoCode.version_notes, /C11/i);
});

test('PRRT_kwDOSTHjGM6WPZcj removes routine Temporary Chat from normal C7 finality', () => {
  const evidence = Object.fromEntries(c7FinalityPredicates.map((key) => [key, true]));
  const result = c7FinalityDecision({ ...evidence, g4Verdict: 'PASS', g4ExactHead: true, webFinalityExecutionEvidence: c7WebFinalityEvidenceFixture() });
  assert.equal(result.finality, true);
  assert.equal(result.routineAssuranceRequired, false);
});

test('PRRT_kwDOSTHjGM6WPZc3 returns typed no-mutation receipts for sensitivity stops', () => {
  const receipt = c8SensitivityReceipt({ classification: 'confirmed' });
  assert.equal(receipt.mutation_performed, false);
  assert.equal(receipt.evaluation_candidate_created, false);
});

function c11Grant(overrides = {}) {
  return {
    schema: 'delegation-grant/v1',
    run_id: 'run-047', session_id: 'session-047', turn_id: 'turn-047',
    issuer: 'web', user_request_proof: 'explicit-current-turn-request',
    mode: 'exclusive-auto-code', count: 1, role: 'implementation/amendment worker',
    provider: ['Open', 'AI'].join(''), canonical_model: ['GPT', '-5.6 Luna'].join(''), reasoning: ['M', 'ax'].join(''),
    repository: 'weijunswj/ai-agent-toolkit', scope: ['src/a'],
    capabilities: ['read', 'mutate', 'test'], expires_at: '2099-01-01T00:00:00.000Z',
    one_use: true, consumed: false, allow_further_delegation: false,
    ...overrides
  };
}

function c11DelegationDecision(operation = {}, grant = {}) {
  const required = ['run_id', 'session_id', 'turn_id', 'issuer', 'user_request_proof', 'role', 'provider', 'canonical_model', 'reasoning', 'repository', 'scope', 'capabilities', 'expires_at'];
  if (!grant || required.some((key) => grant[key] === undefined) || grant.one_use !== true || grant.consumed === true || grant.allow_further_delegation !== false) return { allowed: false, reason: 'DELEGATION_NOT_AUTHORISED' };
  if (grant.repository !== 'weijunswj/ai-agent-toolkit' || !Array.isArray(grant.scope) || !Array.isArray(grant.capabilities) || Date.parse(grant.expires_at) <= Date.now()) return { allowed: false, reason: 'DELEGATION_NOT_AUTHORISED' };
  const requestedCount = operation.requested_count || 1;
  if (grant.count !== 1 || requestedCount !== 1) return { allowed: false, reason: 'DELEGATION_NOT_AUTHORISED' };
  const requestedScope = Array.isArray(operation.scope) ? operation.scope : [];
  if (operation.operation === 'helper') {
    if (grant.mode !== 'ordinary-helper') return { allowed: false, reason: 'DELEGATION_NOT_AUTHORISED' };
    if (requestedScope.some((entry) => grant.scope.includes(entry))) return { allowed: false, reason: 'SCOPE_OVERLAP' };
    return { allowed: true, mode: grant.mode };
  }
  if (operation.operation !== 'spawn_agent' || grant.mode !== 'exclusive-auto-code' || grant.role !== 'implementation/amendment worker') return { allowed: false, reason: 'DELEGATION_NOT_AUTHORISED' };
  return { allowed: true, mode: grant.mode, mutation_owner: 'exclusive-worker' };
}

function c11AutoCodeLifecycle(event) {
  const suspended = { manager_state: "MANAGER_SUSPENDED_ON_NATIVE_WORKER", progress_inspection: "forbidden", overlapping_validation: "forbidden", status_nudge: "forbidden", interruption_for_progress: "forbidden", ownership: "exclusive-worker", workspace: "preserved", replacement: "forbidden" };
  if (event === "native-terminal-return") return { ...suspended, manager_state: "MANAGER_READY_FOR_VALIDATION", ownership: "manager-validation" };
  if (event === "user-interruption") return { ...suspended, manager_state: "USER_INTERRUPTED_PRESERVE", ownership: "unchanged" };
  if (event === "replacement-after-loss-with-new-grant") return { ...suspended, manager_state: "REPLACEMENT_ADMITTED", replacement: "allowed" };
  return suspended;
}
