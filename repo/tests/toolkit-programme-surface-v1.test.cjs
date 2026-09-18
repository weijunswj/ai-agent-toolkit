'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const programme = require('../scripts/toolkit-programme-surface-v1.cjs');
const programmeV5 = require('../scripts/toolkit-github-program-state-v5.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const revision = 'af14f91b0f6335212003a37a5119f233489e598f';
const head = '1'.repeat(40);
const tree = '2'.repeat(40);
const base = '3'.repeat(40);

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
    in_flight: { state: 'RUNNING', worker: 'executor-c1', executor: 'owner-openai' },
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
  assert.equal(programmeV5.programmeV5.currentProjection, programme);
  assert.equal(programmeV5.createCurrentProjection, programme.createCurrentProjection);
});
