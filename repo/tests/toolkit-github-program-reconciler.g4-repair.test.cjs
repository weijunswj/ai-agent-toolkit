'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const reconciler = require('../scripts/toolkit-github-program-reconciler.cjs');
const predecessorContract = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-predecessor-coverage.json'), 'utf8'));

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const LABEL_DEFINITIONS = {
  completed: { color: '1f883d', description: 'Programme child is complete or retired.' },
  current: { color: '0969da', description: 'Programme child is the sole current delivery item.' },
  queued: { color: 'bf8700', description: 'Programme child is queued for future delivery.' },
  blocked: { color: 'cf222e', description: 'Programme child has current authoritative blocker evidence.' },
};

function authorityVerifier({ assertion, binding }) {
  if (!assertion.reference?.startsWith('github:issue-comment:')) return { ok: false };
  return { ok: true, grant: { ...binding, reference: assertion.reference } };
}

function model() {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent: {
      issue: 240,
      status: 'S2 E3 G3 REPAIR CURRENT',
      outcome: 'The bounded G3 repair is current.',
      current_child: 359,
      child_graph: [{ issue: 359, status: 'CURRENT' }],
      major_holds: [],
      predecessor_gateway: { issues: 45, criteria: 84, unmapped: 0 },
      next_action: 'Run the bounded E3 repair.',
    },
    children: [{
      issue: 359,
      parent_issue: 240,
      dependencies: [],
      status: 'CURRENT',
      outcome: 'The E3 product repair is in progress.',
      current_obligation: 'Repair the E3 candidate.',
      epochs: [{ name: 'E3', lock: 'DL-S2-GITHUB-PROGRAM-001', state: 'CURRENT' }],
      lock: 'DL-S2-GITHUB-PROGRAM-001',
      predecessor_issues: predecessorContract.predecessors.map((entry) => entry.issue),
      pr_registry: [{ pr: 366, status: 'ACTIVE', role: 'INTERMEDIATE', completes_child: false }],
      candidate: {
        repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359, pr: 366,
        branch: 'sol/s2-productisation-g3', base: BASE, head: HEAD, tree: TREE,
        epoch: 'E3', lock: 'DL-S2-GITHUB-PROGRAM-001', role: 'INTERMEDIATE', completes_child: false,
        lifecycle: 'CURRENT',
      },
      boundaries: ['Web owns Ready, merge and finality.'],
      next_action: 'Return the repaired candidate to Web.',
      eli5: 'Repair the programme tool without claiming finality.',
    }],
    prs: [{
      number: 366,
      parent_issue: 240,
      child_issue: 359,
      epoch: 'E3',
      lock: 'DL-S2-GITHUB-PROGRAM-001',
      branch: 'sol/s2-productisation-g3',
      base: BASE,
      head: HEAD,
      tree: TREE,
      state: 'DRAFT',
      outcome: 'The intermediate candidate awaits Web reconciliation.',
      role: 'INTERMEDIATE',
      completes_child: false,
      changed_surfaces: ['repo/scripts/toolkit-github-program-reconciler.cjs'],
      validation: ['focused tests pending'],
      holds: ['Web exact-head reconciliation'],
      finality: 'WEB_OWNED',
    }],
  };
}

function snapshot(programme = model()) {
  return {
    repository: programme.repository,
    revision: 'revision-1',
    complete: true,
    model: programme,
    bodies: reconciler.renderProgrammeViews(programme).bodies,
    labels: { '359': ['current'] },
    label_definitions: JSON.parse(JSON.stringify(LABEL_DEFINITIONS)),
    managed_events: [],
    native: { sub_issues: [], blocked_by: {}, managed_blocked_by: {} },
    unrelated_digest: 'unrelated-1',
  };
}

test('RED: arbitrary owner policy cannot be selected as a stale programme projection', () => {
  const desired = model();
  const current = snapshot(desired);
  const prefix = 'owner prefix\n';
  const arbitraryPolicy = 'Never remove this unrelated owner policy.';
  const suffix = '\nowner suffix';
  current.bodies.parent = prefix + arbitraryPolicy + suffix;
  const preview = reconciler.buildProgrammePreview({
    snapshot: current,
    desired,
    predecessor_contract: predecessorContract,
    unmanaged_projection_migrations: {
      parent: {
        classification: 'STALE_PROGRAMME_PROJECTION',
        body_digest: reconciler.sha256(current.bodies.parent),
        preserved_prefix: prefix,
        preserved_suffix: suffix,
      },
    },
  });
  assert.equal(preview.ok, false);
});

test('RED: missing managed event in authoritative readback fails reconciliation', () => {
  let live = snapshot(model());
  const event = reconciler.renderManagedEvent({
    event_type: 'g4_or_finality',
    repository: live.repository,
    entity: { kind: 'pr', number: 366 },
    child_issue: 359,
    pr_number: 366,
    exact_revision: HEAD,
    resulting_state: 'WEB_OWNED',
    authority_ref: 'github:issue-comment:359:5440752892',
    epoch: 'E3',
  }).event;
  const runtime = reconciler.createProgrammeRuntime({
    predecessor_contract: predecessorContract,
    authority_verifier: authorityVerifier,
    adapter: {
      inspectProgramme() { return JSON.parse(JSON.stringify(live)); },
      applyOperations(input) {
        live = { ...JSON.parse(JSON.stringify(input.expected_snapshot)), revision: 'revision-2' };
        delete live.managed_events;
        return { ok: true, applied_count: input.operations.length };
      },
    },
  });
  const preview = runtime.preview({ repository: live.repository, desired: model(), events: [event] });
  const applied = runtime.apply({
    preview,
    authority: {
      granted: true,
      preview_id: preview.preview_id,
      expected_revision: preview.current_revision,
      reference: 'github:issue-comment:359:5440752892',
    },
  });
  assert.equal(applied.ok, false);
});

test('RED: candidate registry and PR model disagreement fails validation', () => {
  const inconsistent = model();
  inconsistent.children[0].candidate.head = 'd'.repeat(40);
  assert.equal(reconciler.validateProgrammeModel(inconsistent).ok, false);
});

test('RED: caller-authored granted flag is not mutation authority', () => {
  let live = snapshot(model());
  live.labels['359'] = ['queued'];
  const runtime = reconciler.createProgrammeRuntime({
    predecessor_contract: predecessorContract,
    adapter: {
      inspectProgramme() { return JSON.parse(JSON.stringify(live)); },
      applyOperations(input) {
        live = { ...JSON.parse(JSON.stringify(input.expected_snapshot)), revision: 'revision-2' };
        return { ok: true, applied_count: input.operations.length };
      },
    },
  });
  const preview = runtime.preview({ repository: live.repository, desired: model() });
  const applied = runtime.apply({
    preview,
    authority: {
      granted: true,
      preview_id: preview.preview_id,
      expected_revision: preview.current_revision,
      reference: 'forged:caller-authority',
    },
  });
  assert.equal(applied.ok, false);
});

test('RED: unrelated issue identity and caller capability booleans cannot plan hierarchy writes', () => {
  const result = reconciler.planNativeRelationships({
    parent_issue: 240,
    current: { sub_issues: [], blocked_by: {} },
    desired: { sub_issues: [{ issue_id: 999, issue_number: 999, parent_issue: 240 }], blocked_by: {} },
    capabilities: { sub_issues: true, reparent: true, reprioritize: true, dependencies: true },
  });
  assert.equal(result.ok, false);
});

test('RED: structurally incomplete programme surfaces fail closed', () => {
  const incomplete = model();
  delete incomplete.parent.outcome;
  assert.equal(reconciler.renderProgrammeViews(incomplete).ok, false);
});

test('RED: completed is an explicit exclusive managed lifecycle label', () => {
  const result = reconciler.deriveManagedLabels({ native_state: 'closed', lifecycle: 'COMPLETED', labels: ['current', 'human-label'] });
  assert.deepEqual(result.labels, ['human-label', 'completed']);
});
