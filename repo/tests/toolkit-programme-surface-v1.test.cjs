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
const programmeSurfaceSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'controller-kernel', 'programme-surface-v1.schema.json'), 'utf8'));

function graphFixture(overrides = {}) {
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
      },
    ],
    ...overrides,
  };
}

function currentInput() {
  return {
    repository,
    controller_revision: revision,
    canonical_main: { sha: base, tree },
    programme: { parent: 421, current_child: 422, lane: 'C1' },
    run: { id: 'run-c1', state: 'IN_FLIGHT' },
    lock: 'DL-C1-CONTROLLER-KERNEL-DELIVERY-CONTRACT-008',
    gate: 'G3',
    repair_count: { used: 0, limit: 2 },
    candidate: { pr: 422, head, tree, base: { ref: 'main', sha: base } },
    hold: { active: false },
    in_flight: {
      state: 'RUNNING',
      worker: 'executor-c1',
      executor: 'owner-openai',
      worker_liveness: 'active',
      worker_liveness_evidence: 'runtime-native',
    },
    controlling_receipt: { id: 'receipt-c1', reference: 'github:issue-comment:422:5729731423', digest: '4'.repeat(64) },
    next_admissible_action: 'RUN_G3_VALIDATE',
  };
}

test('heavy PR objects project to minimum admission metadata', () => {
  const projected = programme.projectPullRequestMetadata({
    repository,
    number: 422,
    state: 'open',
    draft: true,
    head: { ref: 'codex/c1', sha: head, tree },
    base: { ref: 'main', sha: base },
    mergeable_state: 'clean',
    body: 'private body that must not be projected',
    diff: 'patch that must not be projected',
    patch: 'patch that must not be projected',
    files: [{ filename: 'secret.txt' }],
  });
  assert.equal(projected.ok, true, projected.code);
  assert.deepEqual(Object.keys(projected.projection).sort(), [
    'base', 'draft', 'head', 'mergeability', 'number', 'repository', 'schema', 'state', 'version',
  ]);
  assert.equal(projected.projection.state, 'OPEN');
  assert.equal(projected.projection.mergeability, 'clean');
  assert.equal(programme.validatePullRequestMetadata(projected.projection).ok, true);
});

test('CURRENT exposes the bounded restart fields and validates its digest', () => {
  const created = programme.createCurrentProjection(currentInput());
  assert.equal(created.ok, true, created.code);
  const projection = created.projection;
  assert.equal(programme.validateCurrentProjection(projection).ok, true);
  assert.equal(projection.repository, repository);
  assert.equal(projection.controller_revision, revision);
  assert.equal(projection.canonical_main.ref, 'main');
  assert.equal(projection.programme.current_child, 422);
  assert.equal(projection.run.id, 'run-c1');
  assert.equal(projection.lock, 'DL-C1-CONTROLLER-KERNEL-DELIVERY-CONTRACT-008');
  assert.equal(projection.candidate.pr, 422);
  assert.equal(projection.candidate.head, head);
  assert.equal(projection.candidate.tree, tree);
  assert.equal(projection.candidate.base.sha, base);
  assert.equal(projection.in_flight.executor, 'owner-openai');
  assert.equal(projection.controlling_receipt.reference, 'github:issue-comment:422:5729731423');
  assert.equal(Object.prototype.hasOwnProperty.call(projection, 'body'), false);

  const staleDigest = programme.isCurrentFresh(projection, { projection_digest: 'f'.repeat(64) });
  assert.equal(staleDigest.ok, false);
  assert.equal(staleDigest.code, 'CURRENT_STALE');
  assert.equal(programme.isCurrentFresh(projection).code, 'CURRENT_STALE');
  const staleField = programme.isCurrentFresh(projection, { gate: 'G4' });
  assert.equal(staleField.ok, false);
  assert.equal(staleField.code, 'CURRENT_STALE');
});

test('material CURRENT transition requires a matching canonical readback', () => {
  const initial = programme.createCurrentProjection(currentInput());
  const changes = { run: { state: 'TERMINAL' }, next_admissible_action: 'WEB_RECONCILE_PACKET' };
  const transitioned = programme.transitionCurrent(initial.projection, changes);
  assert.equal(transitioned.ok, true, transitioned.code);
  assert.equal(transitioned.projection.run.state, 'TERMINAL');
  assert.notEqual(transitioned.projection.projection_digest, initial.projection.projection_digest);

  const readback = programme.transitionAndReadback({
    current: initial.projection,
    changes,
    readback: transitioned.projection,
  });
  assert.equal(readback.ok, true, readback.code);

  const mismatch = programme.transitionAndReadback({
    current: initial.projection,
    changes,
    readback: initial.projection,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'CURRENT_READBACK_MISMATCH');
});

test('bootstrap plan is bounded and the shared v5 facade exposes the projection bridge', () => {
  const plan = programme.createBootstrapPlan({ repository, controller_revision: revision });
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.plan.bounded, true);
  assert.equal(plan.plan.history_policy, 'exact-controlling-pointer-only');
  assert.equal(plan.bootstrap_io.bootstrap_escalation_reason, 'none');
  assert.match(plan.BOOTSTRAP_IO, /^BOOTSTRAP_IO /);
  assert.equal(programmeV5.programmeV5.currentProjection, programme);
  assert.equal(programmeV5.createCurrentProjection, programme.createCurrentProjection);
  assert.equal(programmeV5.reconcileWorkerLiveness, programme.reconcileWorkerLiveness);
});

test('BOOTSTRAP_IO counts identity checks without inferring full reads and measures projected PR input', () => {
  const diagnostic = programme.createBootstrapIoDiagnostic();
  const plan = programme.createBootstrapPlan({
    repository,
    controller_revision: revision,
    bootstrap_io: diagnostic,
    controller_identity: { revision },
    controller_identity_observed: { revision },
    stack_registry_identity: { revision: 'registry-1' },
    stack_registry_identity_observed: { revision: 'registry-1' },
  });
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.bootstrap_io.controller_identity_checks, 1);
  assert.equal(plan.bootstrap_io.controller_full_reads, 0);
  assert.equal(plan.bootstrap_io.stack_registry_identity_checks, 1);
  assert.equal(plan.bootstrap_io.stack_registry_full_reads, 0);
  assert.equal(plan.bootstrap_io.full_pr_diff_reads, 0);
  assert.equal(plan.bootstrap_io.full_comment_history_reads, 0);
  assert.equal(plan.bootstrap_io.workflow_log_reads, 0);
  assert.equal(plan.bootstrap_io.historical_expansions, 0);

  const projected = programme.projectPullRequestMetadata({
    repository,
    number: 422,
    state: 'open',
    draft: true,
    head: { ref: 'codex/c1', sha: head, tree },
    base: { ref: 'main', sha: base },
    body: 'unprojected body',
    diff: 'unprojected diff',
  }, { bootstrap_io: diagnostic });
  assert.equal(projected.ok, true, projected.code);
  assert.equal(projected.bootstrap_io.lightweight_pr_reads, 1);
  assert.equal(projected.bootstrap_io.model_visible_chars, JSON.stringify(projected.projection).length);
  assert.doesNotMatch(projected.BOOTSTRAP_IO, /unprojected/);
});

test('BOOTSTRAP_IO records stale CURRENT and justified deep evidence without blocking', () => {
  const diagnostic = programme.createBootstrapIoDiagnostic();
  const stale = programme.createBootstrapPlan({
    repository,
    controller_revision: revision,
    bootstrap_io: diagnostic,
    current_projection: { invalid: true },
    expected_current: { projection_digest: 'f'.repeat(64) },
    expensive_reads: {
      exact_receipt_reads: 1,
      full_comment_history_reads: 2,
      full_pr_diff_reads: 1,
      workflow_log_reads: 1,
      historical_expansions: 1,
    },
  });
  assert.equal(stale.ok, true, stale.code);
  assert.equal(stale.bootstrap_io.current_projection_reads, 1);
  assert.equal(stale.bootstrap_io.stale_current_projections, 1);
  assert.equal(stale.bootstrap_io.bootstrap_escalation_reason, 'current_state_conflict');
  assert.equal(stale.bootstrap_io.full_comment_history_reads, 2);
  assert.equal(stale.bootstrap_io.historical_expansions, 1);
});

test('BOOTSTRAP_IO records bounded worker-liveness checks without becoming authority', () => {
  const diagnostic = programme.createBootstrapIoDiagnostic();
  const plan = programme.createBootstrapPlan({
    repository,
    controller_revision: revision,
    bootstrap_io: diagnostic,
    in_flight: { state: 'RUNNING', worker: 'worker-unknown', worker_launch_evidence: 'admitted' },
  });
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.bootstrap_io.worker_liveness_checks, 1);
  assert.equal(plan.bootstrap_io.worker_liveness_unknown, 1);
  assert.equal(plan.bootstrap_io.bootstrap_escalation_reason, 'worker_liveness_unverified');
  assert.match(plan.BOOTSTRAP_IO, /worker_liveness_unknown=1/);
});

test('CURRENT launch safety rejects duplicate launch and derives reconciliation actions', () => {
  const active = programme.validateCurrentLaunchSafety({
    run: { state: 'IN_FLIGHT' },
    in_flight: { state: 'RUNNING', worker_liveness: 'active', worker_liveness_evidence: 'runtime-native' },
    next_admissible_action: 'G4_EXECUTE',
    stage: 'G4',
  });
  assert.equal(active.ok, false);
  assert.equal(active.code, 'CURRENT_STATE_INVARIANT_VIOLATION');
  assert.equal(active.derived_action, 'ADOPT_IN_FLIGHT');

  const ambiguous = programme.deriveNextAdmissibleAction({
    in_flight: { state: 'DELIVERY_PENDING' },
    next_admissible_action: 'LAUNCH_G3_DIRECT',
    stage: 'G3',
  });
  assert.equal(ambiguous.ok, true);
  assert.equal(ambiguous.action, 'RECONCILE_LAUNCH_OUTCOME');

  const packet = programme.deriveNextAdmissibleAction({
    terminal_packet: { packet_id: 'packet-1' },
    next_admissible_action: 'LAUNCH_G4_DIRECT',
    stage: 'G4',
  });
  assert.equal(packet.action, 'RECONCILE_TERMINAL_PACKET');

  const terminal = programme.validateCurrentLaunchSafety({
    run: { state: 'TERMINAL' },
    terminal_non_converged: true,
    next_admissible_action: 'G4_EXECUTE',
    stage: 'G4',
  });
  assert.equal(terminal.ok, false);
  assert.equal(terminal.code, 'CURRENT_STATE_INVARIANT_VIOLATION');
  assert.equal(terminal.derived_action, 'HOLD_TERMINAL_NON_CONVERGENCE');

  const ready = programme.validateCurrentLaunchSafety({ stage: 'G3', authorised_stage: 'G3' });
  assert.equal(ready.ok, true, ready.code);
  assert.equal(ready.action, 'LAUNCH_G3_DIRECT');
  assert.equal(ready.launch_allowed, true);
});

test('CURRENT restart admission rejects stale, incomplete, and mismatched executable identity', () => {
  const staleQueued = programme.validateCurrentLaunchSafety({
    run: { id: 'run-stale-queued', state: 'QUEUED' },
    in_flight: { state: 'NONE', worker: 'worker-live', worker_liveness: 'active', worker_liveness_evidence: 'runtime-native' },
    next_admissible_action: 'LAUNCH_G3_DIRECT',
    stage: 'G3',
  });
  assert.equal(staleQueued.ok, false);
  assert.equal(staleQueued.derived_action, 'ADOPT_IN_FLIGHT');
  assert.equal(staleQueued.reason_code, 'IN_FLIGHT_EXECUTION_PRESENT');

  const incomplete = programme.createCurrentProjection({
    repository,
    controller_revision: revision,
    canonical_main: { sha: base, tree },
    run: { id: 'run-incomplete', state: 'QUEUED' },
    lock: 'DL-C1-CONTROLLER-KERNEL-DELIVERY-CONTRACT-008',
    gate: 'G3',
    next_admissible_action: 'LAUNCH_G3_DIRECT',
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, 'CURRENT_EXECUTABLE_IDENTITY_INCOMPLETE');

  const complete = programme.createCurrentProjection(currentInput());
  assert.equal(complete.ok, true, complete.code);
  assert.equal(programme.isCurrentFresh(complete.projection, { repository }).reason, 'CURRENT_IDENTITY_INCOMPLETE');
  const candidateMismatch = { ...complete.projection, candidate: { ...complete.projection.candidate, head: '9'.repeat(40) } };
  const expected = { ...complete.projection, candidate: candidateMismatch.candidate };
  assert.equal(programme.isCurrentFresh(complete.projection, expected).reason, 'CURRENT_BINDING_MISMATCH');
});

test('worker identity and admitted launch evidence do not substitute for current active liveness', () => {
  const active = {
    run: { state: 'IN_FLIGHT' },
    in_flight: {
      state: 'RUNNING',
      worker: 'worker-active',
      worker_launch_evidence: 'admitted',
      worker_liveness: 'active',
      worker_liveness_evidence: 'runtime-native',
    },
    next_admissible_action: 'G3_EXECUTE',
    stage: 'G3',
  };
  assert.equal(programme.reconcileWorkerLiveness(active).state, 'active');
  assert.equal(programme.deriveNextAdmissibleAction(active).action, 'ADOPT_IN_FLIGHT');
  assert.equal(programme.validateCurrentLaunchSafety(active).ok, false);

  const handleOnly = {
    ...active,
    in_flight: { state: 'RUNNING', worker: 'worker-active', worker_launch_evidence: 'admitted' },
  };
  const unresolved = programme.reconcileWorkerLiveness(handleOnly);
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.code, 'WORKER_LIVENESS_UNVERIFIED');
  assert.equal(programme.deriveNextAdmissibleAction(handleOnly).action, 'RECONCILE_WORKER_LIVENESS');
  assert.equal(programme.deriveNextAdmissibleAction(handleOnly).reason_code, 'WORKER_LIVENESS_UNVERIFIED');
});

test('verified inactive liveness clears active projection while preserving historical identity and admitting one launch', () => {
  const inactive = programme.createCurrentProjection({
    repository,
    controller_revision: revision,
    canonical_main: { sha: base, tree },
    programme: { parent: 421, current_child: 422, lane: 'C1' },
    run: { id: 'run-stale', state: 'IN_FLIGHT' },
    lock: 'DL-C1-CONTROLLER-KERNEL-DELIVERY-CONTRACT-008',
    gate: 'G3',
    repair_count: { used: 0, limit: 2 },
    controlling_receipt: { id: 'receipt-stale', reference: 'github:issue-comment:422:5729731423', digest: '4'.repeat(64) },
    in_flight: {
      state: 'RUNNING',
      worker: 'worker-stale',
      worker_launch_evidence: 'admitted',
      worker_liveness: 'inactive',
      worker_liveness_evidence: 'runtime-native',
    },
    stage: 'G3',
    next_admissible_action: 'LAUNCH_G3_DIRECT',
  });
  assert.equal(inactive.ok, true, inactive.code);
  assert.equal(inactive.projection.run.state, 'QUEUED');
  assert.equal(inactive.projection.in_flight.state, 'NONE');
  assert.equal(inactive.projection.in_flight.worker, 'worker-stale');
  assert.equal(inactive.projection.in_flight.worker_identity, 'worker-stale');
  assert.equal(inactive.projection.in_flight.worker_launch_evidence, 'admitted');
  assert.equal(inactive.projection.in_flight.worker_liveness, 'inactive');
  assert.equal(inactive.projection.next_admissible_action, 'LAUNCH_G3_DIRECT');
  assert.equal(programme.validateCurrentLaunchSafety(inactive.projection).launch_allowed, true);
});

test('terminal evidence wins over an in-flight allegation and requires terminal reconciliation without relaunch', () => {
  const input = {
    canonical_main: { sha: base, tree },
    programme: { parent: 421, current_child: 422, lane: 'C1' },
    run: { id: 'run-terminal', state: 'IN_FLIGHT' },
    lock: 'DL-C1-CONTROLLER-KERNEL-DELIVERY-CONTRACT-008',
    gate: 'G3',
    repair_count: { used: 0, limit: 2 },
    controlling_receipt: { id: 'receipt-terminal', reference: 'github:issue-comment:422:5729731423', digest: '4'.repeat(64) },
    in_flight: {
      state: 'RUNNING',
      worker: 'worker-terminal',
      worker_launch_evidence: 'admitted',
    },
    terminal_packet: { packet_id: 'packet-terminal' },
    stage: 'G3',
    next_admissible_action: 'RECONCILE_TERMINAL_PACKET',
  };
  const derived = programme.deriveNextAdmissibleAction(input);
  assert.equal(derived.action, 'RECONCILE_TERMINAL_PACKET');
  const projection = programme.createCurrentProjection({
    repository,
    controller_revision: revision,
    ...input,
  });
  assert.equal(projection.ok, true, projection.code);
  assert.equal(projection.projection.run.state, 'TERMINAL');
  assert.equal(projection.projection.in_flight.state, 'DELIVERY_PENDING');
  assert.equal(projection.projection.in_flight.worker_identity, 'worker-terminal');
  assert.equal(projection.projection.next_admissible_action, 'RECONCILE_TERMINAL_PACKET');
});

test('branch or PR evidence cannot classify a worker as alive, and no branch or PR absence classifies it as dead', () => {
  const branchOnly = {
    run: { state: 'IN_FLIGHT' },
    in_flight: {
      state: 'RUNNING',
      worker: 'worker-branch',
      worker_liveness: 'active',
      worker_liveness_evidence: 'branch-pr',
    },
    candidate: { pr: 434, head, tree, base: { ref: 'main', sha: base } },
    next_admissible_action: 'LAUNCH_G3_DIRECT',
    stage: 'G3',
  };
  assert.equal(programme.reconcileWorkerLiveness(branchOnly).state, 'unknown');
  assert.equal(programme.deriveNextAdmissibleAction(branchOnly).reason_code, 'WORKER_LIVENESS_UNVERIFIED');

  const notRunningFromBranch = {
    ...branchOnly,
    in_flight: { state: 'RUNNING', worker: 'worker-branch', worker_liveness: 'inactive', worker_liveness_evidence: 'branch-pr' },
  };
  assert.equal(programme.reconcileWorkerLiveness(notRunningFromBranch).state, 'unknown');
});

test('a previous liveness observation must be refreshed before it can suppress a launch', () => {
  const previous = {
    run: { state: 'IN_FLIGHT' },
    in_flight: {
      state: 'RUNNING',
      worker: 'worker-previous',
      worker_liveness: 'active',
      worker_liveness_evidence: 'runtime-native',
      worker_liveness_refreshed: false,
    },
    next_admissible_action: 'LAUNCH_G3_DIRECT',
    stage: 'G3',
  };
  const refreshed = programme.reconcileWorkerLiveness(previous);
  assert.equal(refreshed.ok, false);
  assert.equal(refreshed.state, 'unknown');
  assert.equal(programme.validateCurrentLaunchSafety(previous).reason_code, 'WORKER_LIVENESS_UNVERIFIED');
});

test('an already-authorised launch is not gated by a magic-word confirmation or by the utterance itself', () => {
  const ready = programme.validateCurrentLaunchSafety({
    stage: 'G3',
    authorised_stage: 'G3',
    user_confirmation: 'launch',
  });
  assert.equal(ready.ok, true, ready.code);
  assert.equal(ready.launch_allowed, true);
  assert.equal(ready.action, 'LAUNCH_G3_DIRECT');

  const typedOnly = programme.deriveNextAdmissibleAction({
    stage: 'G3',
    authorised_stage: 'G3',
    user_message: 'launch',
  });
  assert.equal(typedOnly.action, 'LAUNCH_G3_DIRECT');
  assert.equal(typedOnly.launch_allowed, true);
});

test('Programme Graph is the single deterministic parent topology projection', () => {
  const rendered = programme.renderProgrammeGraph(graphFixture());
  assert.equal(rendered.ok, true, rendered.code);
  assert.equal(rendered.graph.outcomes.length, 2);
  assert.deepEqual(rendered.graph.outcomes.map((item) => item.id), ['child-first', 'planned-follow-up']);
  assert.equal(rendered.graph.outcomes.filter((item) => item.materialized).length, 1);
  assert.deepEqual(rendered.graph.outcomes[0].native_issue, { repository: 'example/neutral-repo', number: 101 });
  assert.equal(rendered.graph.outcomes[0].delivery_pr.number, 201);
  assert.equal(rendered.graph.outcomes[1].native_issue, null);
  assert.equal(rendered.graph.outcomes[1].delivery_pr, null);
  assert.match(rendered.body, /^## Programme Graph$/m);
  assert.match(rendered.body, /#101/);
  assert.match(rendered.body, /#201 \(OPEN\)/);
  assert.match(rendered.body, /planned-follow-up: Planned follow-up outcome/);
  assert.doesNotMatch(rendered.body, /^## (Current Programme Children|Children|PR history|Foundation)$/m);
  assert.equal(rendered.parent_registry.length, 2);
  assert.deepEqual(rendered.parent_registry.map((item) => item.outcome_id), ['child-first', 'planned-follow-up']);
  assert.equal(programme.validateProgrammeGraph(rendered.graph).ok, true);
});

test('Programme Graph renderer is repository-neutral and dry-runs the current Toolkit programme without live mutation', () => {
  const neutral = programme.renderProgrammeParent(graphFixture());
  const toolkit421 = programme.renderProgrammeParent({
    repository: 'weijunswj/ai-agent-toolkit',
    programme: {
      id: 'programme-421',
      issue: 421,
      title: 'Controller Kernel Delivery Contract',
      objective: 'Deliver the controller-kernel contract through the authorised child lane.',
      lifecycle: 'ACTIVE',
      finality: 'PENDING',
      labels: ['controller-kernel', 'programme'],
      boundaries: ['Web owns G4 admission and finality.'],
    },
    outcomes: [
      {
        id: 'child-422', order: 1, kind: 'CHILD', title: 'Controller kernel delivery', materialized: true,
        lifecycle: 'CURRENT', dependencies: [], native_issue: { repository: 'weijunswj/ai-agent-toolkit', number: 422 },
        delivery_pr: { repository: 'weijunswj/ai-agent-toolkit', number: 434, status: 'OPEN', role: 'DELIVERY', completes_child: false, reference: 'github:pull/434' },
      },
      {
        id: 'child-423', order: 2, kind: 'CHILD', title: 'Planned assurance child', materialized: false,
        lifecycle: 'PLANNED', dependencies: ['child-422'], native_issue: { repository: 'weijunswj/ai-agent-toolkit', number: 423 }, delivery_pr: null,
      },
      {
        id: 'child-424', order: 3, kind: 'CHILD', title: 'Planned reconciliation child', materialized: false,
        lifecycle: 'PLANNED', dependencies: ['child-422'], native_issue: { repository: 'weijunswj/ai-agent-toolkit', number: 424 }, delivery_pr: null,
      },
      {
        id: 'outcome-425', order: 4, kind: 'OUTCOME', title: 'Planned parent-owned outcome', materialized: false,
        lifecycle: 'PLANNED', dependencies: ['child-423', 'child-424'], native_issue: { repository: 'weijunswj/ai-agent-toolkit', number: 425 }, delivery_pr: null,
      },
    ],
  });
  assert.equal(neutral.ok, true, neutral.code);
  assert.equal(toolkit421.ok, true, toolkit421.code);
  assert.match(toolkit421.body, /weijunswj\/ai-agent-toolkit/);
  assert.match(toolkit421.body, /#422/);
  assert.match(toolkit421.body, /#434 \(OPEN\)/);
  assert.match(toolkit421.body, /#423/);
  assert.match(toolkit421.body, /#424/);
  assert.match(toolkit421.body, /#425/);
  assert.match(toolkit421.body, /outcome-425: Planned parent-owned outcome/);
  assert.doesNotMatch(toolkit421.body, /example\/neutral-repo|programme-neutral/);
  assert.doesNotMatch(toolkit421.body, /RUN|Lock|worker|detailed CI/i);
  assert.notEqual(neutral.graph.graph_digest, toolkit421.graph.graph_digest);

  const regenerated = programme.renderProgrammeGraph(toolkit421.canonical_snapshot);
  assert.equal(regenerated.ok, true, regenerated.code);
  assert.equal(regenerated.body, toolkit421.body);
  assert.equal(regenerated.graph_digest, toolkit421.graph_digest);
  assert.equal(regenerated.canonical_snapshot_digest, toolkit421.canonical_snapshot_digest);
});

test('all public programme renderers apply the retained public-data screen', () => {
  const rendered = programmeV5.renderProgrammeV5(programmeV5.FINALISATION_SOURCE_STATE);
  assert.equal(rendered.ok, true, rendered.code);
  const legacyRenderers = [
    programmeV5.renderProgrammeV5,
    programmeV5.programmeV5.renderProgrammeV5,
    programmeV5.projectionBootstrapRecovery.render,
  ];
  for (const renderer of legacyRenderers) assert.equal(renderer(programmeV5.FINALISATION_SOURCE_STATE).ok, true);
  const canary = structuredClone(programmeV5.FINALISATION_SOURCE_STATE);
  canary.parent.title = 'token=synthetic-review-canary';
  for (const renderer of legacyRenderers) assert.throws(() => renderer(canary), /PUBLIC_DATA_UNSAFE/);
  const graphCanary = {
    ...graphFixture(),
    programme: { ...graphFixture().programme, title: 'token=synthetic-review-canary' },
  };
  for (const renderer of [
    programmeV5.renderProgrammeGraph,
    programmeV5.renderProgrammeParent,
    programmeV5.programmeV5.renderProgrammeGraph,
    programmeV5.programmeV5.renderProgrammeParent,
    programmeV5.programmeSurface.renderProgrammeGraph,
    programmeV5.programmeSurface.renderProgrammeParent,
  ]) assert.throws(() => renderer(graphCanary), /PUBLIC_DATA_UNSAFE/);
});

test('Programme Graph excludes child-local chronology and preserves parent minimality', () => {
  const canonical = graphFixture();
  const baseline = programme.renderProgrammeGraph(canonical);
  const childLocalMutation = programme.renderProgrammeGraph({
    ...canonical,
    child_local: {
      run: 'run-999',
      lock: 'DL-CHILD-LOCAL',
      gate: 'G3',
      repair_count: 2,
      worker: 'private-worker-identity',
      detailed_ci: ['private-check-log'],
    },
  });
  assert.equal(baseline.ok, true, baseline.code);
  assert.equal(childLocalMutation.ok, true, childLocalMutation.code);
  assert.equal(childLocalMutation.body, baseline.body);
  assert.equal(childLocalMutation.graph_digest, baseline.graph_digest);
  assert.equal(childLocalMutation.canonical_snapshot_digest, baseline.canonical_snapshot_digest);
  assert.doesNotMatch(baseline.body, /run-999|DL-CHILD-LOCAL|private-worker-identity|private-check-log/);
});

test('Programme Graph regeneration is stable, derives labels and registry, and verifies readback', () => {
  const source = graphFixture();
  const first = programme.renderProgrammeGraph(source);
  const second = programme.renderProgrammeGraph({ ...source, outcomes: source.outcomes.slice().reverse() });
  assert.equal(first.ok, true, first.code);
  assert.equal(second.ok, true, second.code);
  assert.equal(second.body, first.body);
  assert.deepEqual(second.labels, ['neutral', 'programme']);
  assert.deepEqual(second.parent_registry, first.parent_registry);
  assert.equal(programme.reconcileProgrammeSurface(first, second).ok, true);
  assert.equal(programme.reconcileProgrammeGraph(first, { ...second, surface: { ...second.surface, body: second.body + '\n' } }).code, 'PROGRAMME_SURFACE_READBACK_MISMATCH');
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(programmeSurfaceSchema);
  assert.equal(validate(first.graph), true, JSON.stringify(validate.errors));
});

test('Programme Graph rejects duplicate membership and unknown dependencies', () => {
  const duplicate = graphFixture({ outcomes: [graphFixture().outcomes[0], { ...graphFixture().outcomes[0], id: 'another-id', order: 2 }] });
  assert.equal(programme.renderProgrammeGraph(duplicate).code, 'PROGRAMME_GRAPH_DUPLICATE_NATIVE_ISSUE');
  const unknownDependency = graphFixture({ outcomes: [{ ...graphFixture().outcomes[0], dependencies: ['missing-outcome'] }] });
  assert.equal(programme.renderProgrammeGraph(unknownDependency).code, 'PROGRAMME_GRAPH_DEPENDENCY_UNKNOWN');
});

test('Programme Graph keeps only the minimum core when optional sections are empty', () => {
  const minimal = programme.renderProgrammeGraph({
    repository: 'example/minimal-repo',
    programme: { id: 'programme-minimal', title: 'Minimal Programme' },
    outcomes: [],
  });
  assert.equal(minimal.ok, true, minimal.code);
  assert.match(minimal.body, /^## Programme status$/m);
  assert.match(minimal.body, /^## Programme Graph$/m);
  assert.doesNotMatch(minimal.body, /^## Programme (objective|labels|boundaries|holds|next action)$/m);
});
