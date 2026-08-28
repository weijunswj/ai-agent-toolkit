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

function legacyModel() {
  return {
    repository: 'example/programme',
    parent: {
      issue: 1,
      status: 'G4 CURRENT',
      outcome: 'The review result is pending.',
      goal: 'Deliver the programme.',
      current_child: 2,
      child_graph: [{ issue: 2, status: 'CURRENT', short_title: 'Child A', outcome: 'Deliver Child A.' }],
      progress: ['G4 is current.'],
      major_holds: [],
      predecessor_gateway: { issues: 45, criteria: 84, unmapped: 0 },
      next_action: 'Wait for G4.',
      extensions: { finality: 'No G4 launch occurred.' },
    },
    children: [{
      issue: 2,
      parent_issue: 1,
      dependencies: [],
      status: 'CURRENT',
      outcome: 'Child A is current.',
      goal: 'Deliver Child A.',
      scope: ['Programme work.'],
      out_of_scope: ['Finality.'],
      downstream_owned: ['Later work.'],
      current_gate: 'Fresh isolated E3 G4',
      current_phase: 'E3',
      next_gate: 'Web G4 disposition',
      progress: 'G4 is current.',
      achieved: ['Earlier gates accepted.'],
      remaining: ['Receive G4.'],
      holds: [],
      current_obligation: 'Receive G4.',
      epochs: [{ name: 'E3', lock: 'LOCK-E3', purpose: 'Programme product', state: 'G3 REPAIRED - AWAITING WEB AND FRESH G4' }],
      lock: 'LOCK-E3',
      predecessor_issues: predecessorContract.predecessors.map((entry) => entry.issue),
      predecessor_gateway: {
        issues: 45,
        criteria: 84,
        unmapped: 0,
        optional_future: 'Optional work remains parked.',
        parked_backlog: 'Parked work remains discoverable.',
      },
      pr_registry: [{ pr: 3, status: 'ACTIVE', role: 'INTERMEDIATE', completes_child: false }],
      candidate: {
        repository: 'example/programme',
        parent_issue: 1,
        child_issue: 2,
        pr: 3,
        branch: 'feature/programme',
        base: BASE,
        head: HEAD,
        tree: TREE,
        version: '9.9.9',
        epoch: 'E3',
        lock: 'LOCK-E3',
        role: 'INTERMEDIATE',
        completes_child: false,
        lifecycle: 'CURRENT',
      },
      boundaries: ['Finality is held.'],
      next_action: 'Wait for G4.',
      eli5: 'The review is current.',
    }],
    prs: [{
      number: 3,
      parent_issue: 1,
      child_issue: 2,
      epoch: 'E3',
      lock: 'LOCK-E3',
      branch: 'feature/programme',
      base: BASE,
      head: HEAD,
      tree: TREE,
      state: 'DRAFT',
      outcome: 'Awaits Web reconciliation before any fresh G4.',
      purpose: 'Deliver the programme product.',
      scope: ['Programme product.'],
      out_of_scope: ['Finality.'],
      progress: 'G4 is current.',
      achieved: ['Implementation complete.'],
      remaining: ['Receive G4.'],
      safety_constraints: ['Remain intermediate.'],
      validation_status: [{ check: 'G4', state: 'CURRENT - RESULT PENDING' }],
      version: '2.11.0',
      role: 'INTERMEDIATE',
      completes_child: false,
      changed_surfaces: ['runtime'],
      validation: ['tests pass'],
      holds: [],
      finality: 'HELD',
      next_action: 'Wait for G4.',
      eli5: 'The review is current.',
    }],
  };
}

function snapshot(model) {
  return {
    repository: model.repository,
    revision: 'revision-1',
    complete: true,
    model,
    bodies: reconciler.renderProgrammeViews(model).bodies,
    labels: { '2': ['current'] },
    label_definitions: {
      completed: { color: '1f883d', description: 'Programme child is complete or retired.' },
      current: { color: '0969da', description: 'Programme child is the sole current delivery item.' },
      queued: { color: 'bf8700', description: 'Programme child is queued for future delivery.' },
      blocked: { color: 'cf222e', description: 'Programme child has current authoritative blocker evidence.' },
    },
    managed_events: [],
    native: { sub_issues: [], blocked_by: {}, managed_blocked_by: {} },
    unrelated_digest: 'unrelated',
  };
}

test('RED parent contradiction: G4 current conflicts with no G4 launch', () => {
  assert.equal(reconciler.validateProgrammeModel(legacyModel()).ok, false);
});

test('RED child contradiction: current G4 conflicts with awaiting fresh G4 epoch', () => {
  const model = legacyModel();
  delete model.parent.extensions;
  assert.equal(reconciler.validateProgrammeModel(model).ok, false);
});

test('RED PR contradiction: current G4 conflicts with pre-G4 outcome', () => {
  const model = legacyModel();
  delete model.parent.extensions;
  model.children[0].epochs[0].state = 'CURRENT';
  assert.equal(reconciler.validateProgrammeModel(model).ok, false);
});

test('RED extension override: competing current status cannot shadow lifecycle', () => {
  const model = legacyModel();
  delete model.parent.extensions;
  model.children[0].epochs[0].state = 'CURRENT';
  model.prs[0].outcome = 'G4 is current and its result is pending.';
  model.children[0].extensions = { competing_current_status: 'BLOCKED' };
  assert.equal(reconciler.validateProgrammeModel(model).ok, false);
});

test('RED candidate binding: desired version must equal trusted exact-head version', () => {
  const model = legacyModel();
  delete model.parent.extensions;
  model.children[0].epochs[0].state = 'CURRENT';
  model.prs[0].outcome = 'G4 is current and its result is pending.';
  assert.equal(reconciler.validateProgrammeModel(model).ok, false);
});

test('RED registry binding: ACTIVE cannot represent a merged PR', () => {
  const model = legacyModel();
  delete model.parent.extensions;
  model.children[0].epochs[0].state = 'CURRENT';
  model.prs[0].outcome = 'G4 is current and its result is pending.';
  model.prs[0].version = model.children[0].candidate.version;
  model.prs[0].state = 'MERGED';
  assert.equal(reconciler.validateProgrammeModel(model).ok, false);
});

test('RED trusted scope: desired Parent substitution fails before relationship inspection', () => {
  const current = legacyModel();
  delete current.parent.extensions;
  current.children[0].epochs[0].state = 'CURRENT';
  current.prs[0].outcome = 'G4 is current and its result is pending.';
  current.prs[0].version = current.children[0].candidate.version;
  const desired = structuredClone(current);
  desired.parent.issue = 999;
  desired.parent.current_child = 2;
  desired.children[0].parent_issue = 999;
  desired.children[0].candidate.parent_issue = 999;
  desired.prs[0].parent_issue = 999;
  let relationshipInspections = 0;
  const runtime = reconciler.createProgrammeRuntime({
    predecessor_contract: predecessorContract,
    adapter: {
      inspectProgramme() { return structuredClone(snapshot(current)); },
      inspectRelationships() { relationshipInspections += 1; throw new Error('must not be called'); },
    },
  });
  const result = runtime.preview({ repository: current.repository, desired, desired_native: { sub_issues: [], blocked_by: {} } });
  assert.equal(result.ok, false);
  assert.equal(relationshipInspections, 0);
});
