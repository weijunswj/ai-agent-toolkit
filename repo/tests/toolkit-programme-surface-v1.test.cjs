'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');

const programme = require('../scripts/toolkit-programme-surface-v1.cjs');
const programmeV5 = require('../scripts/toolkit-github-program-state-v5.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const revision = 'af14f91b0f6335212003a37a5119f233489e598f';
const head = '1'.repeat(40);
const tree = '2'.repeat(40);
const base = '3'.repeat(40);
const repoRoot = path.resolve(__dirname, '..', '..');
const programmeSurfaceSchema = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'repo', 'contracts', 'controller-kernel', 'programme-surface-v1.schema.json'),
  'utf8',
));
const proofFixturePath = path.join(__dirname, 'fixtures', 'controller-kernel', 'programme-421-proof-v1.json');

function neutralGraph(overrides = {}) {
  return {
    repository: 'example/neutral-repo',
    programme: {
      id: 'programme-neutral',
      issue: 100,
      title: 'Neutral Programme',
      objective: 'Prove a repository-neutral parent projection.',
      lifecycle: 'ACTIVE',
      finality: 'PENDING',
      labels: ['programme', 'neutral'],
      boundaries: ['Parent owns topology only.'],
      holds: [],
      next_action: 'Await the next authorised child transition.',
      sections: { scope: { title: 'Programme scope', items: ['Topology and delivery identity.'] } },
    },
    outcomes: [
      {
        id: 'child-first',
        order: 1,
        kind: 'CHILD',
        title: 'First delivery child',
        materialized: true,
        lifecycle: 'CURRENT',
        dependencies: [],
        native_issue: { repository: 'example/neutral-repo', number: 101 },
        delivery_pr: { repository: 'example/neutral-repo', number: 201, status: 'OPEN', role: 'DELIVERY', completes_child: false, reference: null },
        current_gate: { gate: 'G3', repair: 1 },
        complete_when: 'The first delivery child is accepted under the programme contract.',
      },
      {
        id: 'planned-follow-up',
        order: 2,
        kind: 'OUTCOME',
        title: 'Planned follow-up outcome',
        materialized: false,
        lifecycle: 'PLANNED',
        dependencies: ['child-first'],
        native_issue: null,
        delivery_pr: null,
        current_gate: null,
        complete_when: 'The planned follow-up outcome is accepted under its source-backed criteria.',
      },
    ],
    ...overrides,
  };
}

function launchInput(overrides = {}) {
  return {
    repository,
    controller_revision: revision,
    canonical_main: { sha: base, tree },
    programme: { parent: 421, current_child: 435, lane: 'C1' },
    run: { id: 'run-c1', state: 'NONE' },
    lock: 'DL-C1-CONTROLLER-KERNEL-RECONVERGED-G3-EXCEPTIONAL-047',
    gate: 'G3',
    authorised_stage: 'G3',
    candidate: { pr: 435, head, tree, base: { ref: 'main', sha: base } },
    repair_count: { used: 0, limit: 2 },
    hold: { active: false },
    route_available: true,
    capability_available: true,
    ownership_admitted: true,
    fence_valid: true,
    trusted_structural_eligibility: true,
    controlling_receipt: { id: 'receipt-c1', reference: 'github:issue-comment:435:5754631464', digest: '4'.repeat(64) },
    next_admissible_action: 'LAUNCH_G3_DIRECT',
    ...overrides,
  };
}

function currentNoneInput(stage, overrides = {}) {
  return launchInput({
    gate: stage,
    authorised_stage: stage,
    candidate: { pr: null, head: null, tree: null, base: { ref: null, sha: null } },
    next_admissible_action: `LAUNCH_${stage.replace('-', '_')}_DIRECT`,
    ...overrides,
  });
}

test('heavy PR objects project to minimum admission metadata', () => {
  const projected = programme.projectPullRequestMetadata({
    repository,
    number: 435,
    state: 'open',
    draft: true,
    head: { ref: 'c1/controller-kernel-reconverged-correction-047', sha: head, tree },
    base: { ref: 'main', sha: base },
    mergeable_state: 'clean',
    body: 'private body that must not be projected',
    diff: 'patch that must not be projected',
    files: [{ filename: 'secret.txt' }],
  });
  assert.equal(projected.ok, true, projected.code);
  assert.deepEqual(Object.keys(projected.projection).sort(), [
    'base', 'draft', 'head', 'mergeability', 'number', 'repository', 'schema', 'state', 'version',
  ]);
  assert.equal(programme.validatePullRequestMetadata(projected.projection).ok, true);
});

test('strict CURRENT admission requires complete identity, trusted structure, and exact dependencies', () => {
  const created = programme.createCurrentProjection(launchInput());
  assert.equal(created.ok, true, created.code);
  assert.equal(programme.validateCurrentProjection(created.projection).ok, true);
  assert.equal(created.projection.canonical_main.ref, 'main');
  assert.equal(created.projection.candidate.pr, 435);
  assert.equal(created.projection.next_admissible_action, 'LAUNCH_G3_DIRECT');
  assert.equal(Object.prototype.hasOwnProperty.call(created.projection, 'route_available'), false);

  const incomplete = programme.validateCurrentLaunchSafety({
    stage: 'G3',
    authorised_stage: 'G3',
    next_admissible_action: 'LAUNCH_G3_DIRECT',
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reason_code, 'CURRENT_IDENTITY_INCOMPLETE');

  const untrusted = programme.validateCurrentLaunchSafety(launchInput({ trusted_structural_eligibility: false }));
  assert.equal(untrusted.ok, false);
  assert.equal(untrusted.reason_code, 'STRUCTURAL_ELIGIBILITY_UNAVAILABLE');

  const missingDependency = programme.validateCurrentLaunchSafety(launchInput({ fence_valid: undefined }));
  assert.equal(missingDependency.ok, false);
  assert.equal(missingDependency.reason_code, 'ROUTE_CAPABILITY_OWNERSHIP_FENCE_UNAVAILABLE');
});

test('CURRENT action vocabulary is finite and never manufactures launch authority', () => {
  for (const action of [
    'LAUNCH_G0-A_DIRECT',
    'launch_G3_DIRECT',
    'LAUNCH_G3_DIRECT_EXTRA',
    'RUN_G3_VALIDATE',
    'OWNER_WEB_FINALITY',
  ]) {
    const checked = programme.deriveNextAdmissibleAction({ stage: 'G3', next_admissible_action: action });
    assert.equal(checked.ok, false, action);
    assert.equal(checked.launch_allowed, false, action);
    assert.equal(checked.action, 'USER_DECISION_REQUIRED', action);
  }

  const bareGate = programme.deriveNextAdmissibleAction({ gate: 'G3' });
  assert.equal(bareGate.action, 'USER_DECISION_REQUIRED');
  assert.equal(bareGate.launch_allowed, false);

  for (const action of ['ADOPT_IN_FLIGHT', 'RECONCILE_WORKER_LIVENESS', 'RECONCILE_LAUNCH_OUTCOME', 'RECONCILE_TERMINAL_PACKET', 'HOLD_TERMINAL_NON_CONVERGENCE', 'USER_DECISION_REQUIRED', 'WEB_RECONCILE_PACKET']) {
    const checked = programme.validateCurrentLaunchSafety({ gate: 'G3', next_admissible_action: action });
    assert.equal(checked.ok, true, action);
    assert.equal(checked.launch_allowed, false, action);
  }
});

test('CURRENT action and stage agreement is exact, including early NONE and reconvergence authority', () => {
  const mismatch = programme.validateCurrentLaunchSafety(launchInput({
    gate: 'G2',
    authorised_stage: 'G2',
    next_admissible_action: 'LAUNCH_G3_DIRECT',
  }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason_code, 'STAGE_BINDING_MISMATCH');

  const early = programme.validateCurrentLaunchSafety(currentNoneInput('G1'));
  assert.equal(early.ok, true, early.code);
  assert.equal(early.candidate_mode, 'NONE');

  const earlyBound = programme.validateCurrentLaunchSafety(currentNoneInput('G1', {
    candidate: { pr: 435, head, tree, base: { ref: 'main', sha: base } },
  }));
  assert.equal(earlyBound.ok, false);
  assert.equal(earlyBound.reason_code, 'CURRENT_CANDIDATE_MODE_MISMATCH');

  const reconvergence = programme.validateCurrentLaunchSafety(launchInput({
    gate: 'RECONVERGENCE',
    authorised_stage: 'RECONVERGENCE',
    next_admissible_action: 'LAUNCH_RECONVERGENCE_DIRECT',
  }));
  assert.equal(reconvergence.ok, false);
  assert.equal(reconvergence.reason_code, 'CURRENT_RECONVERGENCE_AUTHORITY_REQUIRED');
  const reconvergenceBound = programme.validateCurrentLaunchSafety(launchInput({
    gate: 'RECONVERGENCE',
    authorised_stage: 'RECONVERGENCE',
    next_admissible_action: 'LAUNCH_RECONVERGENCE_DIRECT',
    reconvergence_candidate_mode: 'BOUND',
  }));
  assert.equal(reconvergenceBound.ok, true, reconvergenceBound.code);
  assert.equal(reconvergenceBound.candidate_mode, 'BOUND');
});

test('pure CURRENT admission is separate from strict launch safety', () => {
  const admitted = programme.admitCurrent({ gate: 'G3', next_admissible_action: 'LAUNCH_G3_DIRECT' });
  assert.equal(admitted.ok, true, admitted.code);
  assert.equal(admitted.launch_action, true);
  const strict = programme.validateCurrentLaunchSafety({ gate: 'G3', next_admissible_action: 'LAUNCH_G3_DIRECT' });
  assert.equal(strict.ok, false);
  assert.equal(strict.reason_code, 'CURRENT_IDENTITY_INCOMPLETE');
});

test('public CURRENT and graph boundaries reject accessors without invoking getters', () => {
  let getterRuns = 0;
  const current = launchInput();
  Object.defineProperty(current, 'candidate', {
    enumerable: true,
    get() { getterRuns += 1; return launchInput().candidate; },
  });
  const checked = programme.validateCurrentLaunchSafety(current);
  assert.equal(checked.ok, false);
  assert.equal(checked.reason_code, 'CURRENT_ADMISSION_INVALID');
  assert.equal(getterRuns, 0);

  let graphGetterRuns = 0;
  const graph = neutralGraph();
  Object.defineProperty(graph, 'outcomes', {
    enumerable: true,
    get() { graphGetterRuns += 1; return neutralGraph().outcomes; },
  });
  assert.throws(() => programme.renderProgrammeGraph(graph), /PUBLIC_DATA_UNSAFE/);
  assert.equal(graphGetterRuns, 0);
});

test('Programme Graph is deterministic, parent-minimal, and schema-valid', () => {
  const first = programme.renderProgrammeGraph(neutralGraph());
  const second = programme.renderProgrammeGraph({ ...neutralGraph(), outcomes: neutralGraph().outcomes.slice().reverse() });
  assert.equal(first.ok, true, first.code);
  assert.equal(second.ok, true, second.code);
  assert.equal(second.body, first.body);
  assert.equal(second.graph_digest, first.graph_digest);
  assert.equal(first.graph.outcomes.length, 2);
  assert.deepEqual(first.graph.outcomes.map((item) => item.id), ['child-first', 'planned-follow-up']);
  assert.match(first.body, /^## Programme Graph$/m);
  assert.match(first.body, /^\| Outcome \| Status \| Current gate \| Current work \| Complete when \|$/m);
  assert.doesNotMatch(first.body, /private-worker|run-999/);
  assert.equal(programme.reconcileProgrammeSurface(first, second).ok, true);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(programmeSurfaceSchema);
  assert.equal(validate(first.graph), true, JSON.stringify(validate.errors));
});

test('Programme Graph rejects operational claims for Q and all unmaterialized parent-owned outcomes', () => {
  const fixture = JSON.parse(fs.readFileSync(proofFixturePath, 'utf8'));
  const parentClaim = structuredClone(fixture.canonical_snapshot);
  const parentOutcome = parentClaim.outcomes.find((outcome) => outcome.kind === 'OUTCOME');
  parentOutcome.current_gate = { gate: 'G3', repair: null };
  assert.equal(programme.renderProgrammeGraph(parentClaim).code, 'PROGRAMME_GRAPH_OPERATIONAL_CLAIM_REJECTED');

  const qClaim = structuredClone(fixture.canonical_snapshot);
  const queue = qClaim.outcomes.find((outcome) => outcome.id === 'Q');
  queue.current_gate = { gate: 'G3', repair: null };
  assert.equal(programme.renderProgrammeGraph(qClaim).code, 'PROGRAMME_GRAPH_OPERATIONAL_CLAIM_REJECTED');

  const qKind = structuredClone(fixture.canonical_snapshot);
  qKind.outcomes.find((outcome) => outcome.id === 'Q').kind = 'OUTCOME';
  assert.equal(programme.renderProgrammeGraph(qKind).code, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION');

  const c1Materialized = structuredClone(fixture.canonical_snapshot);
  c1Materialized.outcomes.find((outcome) => outcome.id === 'C1').materialized = false;
  assert.equal(programme.renderProgrammeGraph(c1Materialized).code, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION');
});

test('Programme #421 proof fixture is trusted structural evidence and round-trips exactly', () => {
  const fixture = JSON.parse(fs.readFileSync(proofFixturePath, 'utf8'));
  const proof = programme.validateProgrammeGraphProof(fixture);
  assert.equal(proof.ok, true, proof.code);
  assert.deepEqual(proof.outcome_ids, programme.PROGRAMME_421_PROOF_OUTCOME_IDS);
  assert.equal(programmeV5.validateProgrammeGraphProof(fixture).ok, true);

  const stale = structuredClone(fixture);
  stale.canonical_snapshot.outcomes.find((outcome) => outcome.id === 'C1').native_issue.number = 436;
  assert.equal(programme.validateProgrammeGraphProof(stale).ok, false);
  const rendered = programme.renderProgrammeGraph(fixture.canonical_snapshot, { evidenceOnly: true });
  assert.equal(rendered.ok, true, rendered.code);
  assert.equal(rendered.graph.outcomes.length, 30);
});

test('v5 facade routes public graph rendering and CURRENT admission through the same surface', () => {
  assert.equal(programmeV5.admitCurrent, programme.admitCurrent);
  assert.equal(programmeV5.currentAdmission, programme.admitCurrent);
  assert.equal(programmeV5.programmeSurface.admitCurrent, programme.admitCurrent);
  const graph = programmeV5.renderProgrammeGraph(neutralGraph());
  assert.equal(graph.ok, true, graph.code);
  const humanOps = Object.keys(programmeV5.humanSurfaceV2).sort();
  assert.deepEqual(humanOps, ['extendHistory', 'planMigration', 'readComplete', 'render']);
});

test('bootstrap plan remains bounded and transition readback is deterministic', () => {
  const plan = programme.createBootstrapPlan({ repository, controller_revision: revision });
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.plan.bounded, true);
  assert.equal(plan.plan.history_policy, 'exact-controlling-pointer-only');
  const current = programme.createCurrentProjection(launchInput());
  assert.equal(current.ok, true, current.code);
  const transitioned = programme.transitionCurrent(current.projection, { next_admissible_action: 'WEB_RECONCILE_PACKET' });
  assert.equal(transitioned.ok, true, transitioned.code);
  assert.equal(programme.transitionAndReadback({ current: current.projection, changes: { next_admissible_action: 'WEB_RECONCILE_PACKET' }, readback: transitioned.projection }).ok, true);
});
