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
  throw new Error('could not locate the 85-fixture merge baseline');
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
  const baseline = findFixtureBaseline();
  assert.equal(baseline, mergeCommit);
  assert.equal(git('rev-parse', baseline + '^{tree}'), mergeTree);

  const existing = namesAt(baseline);
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
  assert.equal(git('diff', '--name-only', mergeCommit, '--', '_projects/development/repo-auto-code/SOURCE-LOCK.json'), '');
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
