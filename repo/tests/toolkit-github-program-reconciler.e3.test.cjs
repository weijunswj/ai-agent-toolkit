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

function programmeModel(childStatus = 'QUEUED') {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent: {
      issue: 240,
      status: childStatus === 'CURRENT' ? 'S2 E3 CURRENT' : 'S2 E3 QUEUED',
      current_child: childStatus === 'CURRENT' ? 359 : null,
      child_graph: [{ issue: 359, status: childStatus }],
      major_holds: [],
      predecessor_gateway: { issues: 45, criteria: 84, unmapped: 0 },
      next_action: 'Run Web exact-head reconciliation.',
    },
    children: [{
      issue: 359,
      parent_issue: 240,
      dependencies: [],
      status: childStatus,
      current_obligation: childStatus === 'CURRENT' ? 'Implement E3.' : 'Wait for current selection.',
      epochs: [{ name: 'E3', lock: 'DL-S2-GITHUB-PROGRAM-001', state: childStatus }],
      lock: 'DL-S2-GITHUB-PROGRAM-001',
      predecessor_issues: predecessorContract.predecessors.map((entry) => entry.issue),
      pr_registry: [{ pr: 366, status: 'ACTIVE', role: 'TERMINAL', completes_child: true }],
      candidate: { pr: 366, base: BASE, head: HEAD, tree: TREE },
      boundaries: ['Web owns Ready, merge and finality.'],
      next_action: 'Return candidate to Web.',
      eli5: 'The repository can preview, apply and prove the smallest authorised change.',
    }],
    prs: [{
      number: 366,
      child_issue: 359,
      epoch: 'E3',
      lock: 'DL-S2-GITHUB-PROGRAM-001',
      branch: 'sol/s2-productisation-g3',
      base: BASE,
      head: HEAD,
      tree: TREE,
      state: 'DRAFT',
      changed_surfaces: ['repo/scripts/toolkit-github-program-reconciler.cjs'],
      validation: ['focused tests pass'],
      holds: ['Web exact-head reconciliation'],
      finality: 'WEB_OWNED',
    }],
  };
}

function snapshot(model = programmeModel()) {
  const views = reconciler.renderProgrammeViews(model);
  return {
    repository: model.repository,
    revision: 'revision-1',
    complete: true,
    model,
    bodies: views.bodies,
    labels: { '359': ['triage', model.children[0].status === 'CURRENT' ? 'current' : 'queued'] },
    native: { sub_issues: [{ issue_id: 100, issue_number: 359, parent_issue: 240 }], blocked_by: {} },
    unrelated_digest: 'unrelated-1',
  };
}

test('materialised parent child and PR views expose the required bounded fields', () => {
  const result = reconciler.renderProgrammeViews(programmeModel('CURRENT'));
  assert.equal(result.ok, true);
  assert.match(result.bodies.parent, /GITHUB-PROGRAM-PARENT:BEGIN v1/);
  assert.match(result.bodies.parent, /Current child/);
  assert.match(result.bodies.children['359'], /Epochs and Locks/);
  assert.match(result.bodies.children['359'], /ACTIVE \/ ACCEPTED \/ RETIRED PR registry/);
  assert.match(result.bodies.prs['366'], /Branch, base and head/);
});

test('typed managed events round-trip and arbitrary prose is not authority', () => {
  for (const eventType of reconciler.MANAGED_EVENT_TYPES) {
    const rendered = reconciler.renderManagedEvent({
      event_type: eventType,
      repository: 'weijunswj/ai-agent-toolkit',
      entity: { kind: 'child', number: 359 },
      child_issue: 359,
      exact_revision: HEAD,
      resulting_state: 'CURRENT',
      authority_ref: 'github:issue-comment:359:5437827030',
      epoch: 'E3',
    });
    assert.equal(rendered.ok, true, eventType);
    assert.deepEqual(reconciler.parseManagedEvent(rendered.comment).event, rendered.event);
  }
  assert.equal(reconciler.parseManagedEvent('lifecycle_transition: child #359 is current').ok, false);
});

test('managed labels preserve unrelated labels and derive blocked only from current evidence', () => {
  const result = reconciler.deriveManagedLabels({
    native_state: 'open', lifecycle: 'CURRENT', labels: ['bug', 'queued', 'blocked'],
    blocker_evidence: [{ id: 'hold-1', current: true, authority_ref: 'github:issue:359' }],
  });
  assert.deepEqual(result.labels, ['bug', 'current', 'blocked']);
  assert.equal(reconciler.deriveManagedLabels({ native_state: 'closed', lifecycle: 'CURRENT', labels: ['bug', 'current'] }).labels.includes('current'), false);
});

test('multiple current children fail closed', () => {
  const model = programmeModel('CURRENT');
  model.children.push({ ...model.children[0], issue: 360 });
  const result = reconciler.validateProgrammeModel(model);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('native relationship plan uses real sub-issue and blocked-by endpoint semantics', () => {
  const result = reconciler.planNativeRelationships({
    parent_issue: 240,
    current: {
      sub_issues: [
        { issue_id: 100, issue_number: 359, parent_issue: 240 },
        { issue_id: 102, issue_number: 361, parent_issue: 240 },
      ],
      blocked_by: { '359': [200] },
    },
    desired: {
      sub_issues: [
        { issue_id: 101, issue_number: 360, parent_issue: 240, previous_parent_issue: 999 },
        { issue_id: 100, issue_number: 359, parent_issue: 240 },
      ],
      blocked_by: { '359': [201] },
    },
    capabilities: { sub_issues: true, reparent: true, reprioritize: true, dependencies: true },
  });
  assert.equal(result.ok, true);
  assert.ok(result.operations.some((entry) => entry.type === 'sub_issue.add' && entry.payload.replace_parent === true));
  assert.ok(result.operations.some((entry) => entry.type === 'sub_issue.remove'));
  assert.ok(result.operations.some((entry) => entry.type === 'sub_issue.reprioritize'));
  assert.ok(result.operations.some((entry) => entry.type === 'issue_dependency.add_blocked_by'));
  assert.ok(result.operations.some((entry) => entry.type === 'issue_dependency.remove_blocked_by'));
  assert.equal(result.markdown_links_canonical, false);
  assert.equal(result.blocked_label_is_derived_only, true);
});

test('unsupported dependency mutation fails instead of inventing a pseudo-native endpoint', () => {
  const result = reconciler.planNativeRelationships({
    parent_issue: 240,
    current: { sub_issues: [], blocked_by: {} },
    desired: { sub_issues: [], blocked_by: { '359': [201] } },
    capabilities: { sub_issues: true, reparent: true, reprioritize: true, dependencies: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('multi-PR registry keeps intermediate PR non-closing and terminal PR closing-capable', () => {
  const result = reconciler.planPrAssociations([
    { pr: 10, status: 'ACCEPTED', role: 'INTERMEDIATE', completes_child: false },
    { pr: 11, status: 'ACTIVE', role: 'TERMINAL', completes_child: true },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.associations.find((entry) => entry.pr === 10).kind, 'SAFE_CROSS_REFERENCE');
  assert.equal(result.associations.find((entry) => entry.pr === 11).kind, 'CLOSING_DEVELOPMENT_LINK');
  assert.equal(result.associations.find((entry) => entry.pr === 10).may_close_child, false);
});

test('conformance classifies unmanaged legacy current and drifted surfaces', () => {
  assert.equal(reconciler.classifyProgrammeConformance({ body: 'ordinary prose' }).classification, 'UNMANAGED');
  assert.equal(reconciler.classifyProgrammeConformance({ body: '<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v3 -->' }).classification, 'LEGACY_MANAGED');
  const current = reconciler.renderProgrammeViews(programmeModel('CURRENT')).bodies.parent;
  assert.equal(reconciler.classifyProgrammeConformance({ body: current }).classification, 'CURRENT_MANAGED');
  assert.equal(reconciler.classifyProgrammeConformance({ body: current.replace('S2 E3 CURRENT', 'stale') }).classification, 'DRIFTED_MANAGED');
});

test('implicit lifecycle discovery mandates preflight but grants no mutation authority', () => {
  const result = reconciler.programmeLifecyclePreflight({ intent: 'advance current child', invocation: 'implicit' });
  assert.equal(result.mandatory, true);
  assert.equal(result.inspection, true);
  assert.equal(result.preview, true);
  assert.equal(result.mutation_authority, false);
  assert.equal(result.ready, false);
  assert.equal(result.merge, false);
  assert.equal(result.finality, false);
});

test('preview emits body update in the same transaction as a lifecycle event', () => {
  const current = snapshot(programmeModel('QUEUED'));
  const desired = programmeModel('CURRENT');
  const event = reconciler.renderManagedEvent({
    event_type: 'lifecycle_transition', repository: desired.repository,
    entity: { kind: 'child', number: 359 }, child_issue: 359, exact_revision: HEAD,
    resulting_state: 'CURRENT', authority_ref: 'github:issue-comment:359:5437827030', epoch: 'E3',
  }).event;
  const preview = reconciler.buildProgrammePreview({ snapshot: current, desired, predecessor_contract: predecessorContract, events: [event] });
  assert.equal(preview.ok, true);
  assert.ok(preview.operations.some((entry) => entry.type === 'body.update' && entry.entity.kind === 'child' && entry.entity.number === 359));
  assert.ok(preview.operations.some((entry) => entry.type === 'comment.append_managed_event'));
  assert.equal(preview.mutation_authority, false);
});

test('stale comment-only current-state transition fails body freshness', () => {
  const desired = programmeModel('QUEUED');
  const result = reconciler.validateBodyFreshness({
    model: desired,
    events: [{ event_type: 'lifecycle_transition', entity: { kind: 'child', number: 359 }, resulting_state: 'CURRENT' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('explicit apply binds preview and revision, reads back, and immediate rerun is zero delta', () => {
  let state = snapshot(programmeModel('QUEUED'));
  let mutationCalls = 0;
  const adapter = {
    inspectProgramme() { return JSON.parse(JSON.stringify(state)); },
    applyOperations(input) {
      mutationCalls += 1;
      state = { ...JSON.parse(JSON.stringify(input.expected_snapshot)), revision: 'revision-2' };
      return { ok: true, applied_count: input.operations.length };
    },
  };
  const runtime = reconciler.createProgrammeRuntime({ adapter, predecessor_contract: predecessorContract });
  const preview = runtime.preview({ repository: state.repository, desired: programmeModel('CURRENT') });
  assert.equal(preview.ok, true);
  const applied = runtime.apply({
    preview,
    authority: { granted: true, preview_id: preview.preview_id, expected_revision: preview.current_revision, reference: 'user:current-turn:e3' },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.code, 'PROGRAMME_RECONCILED');
  assert.equal(applied.readback_verified, true);
  assert.equal(mutationCalls, 1);
  const rerun = runtime.preview({ repository: state.repository, desired: programmeModel('CURRENT') });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.operations.length, 0);
  assert.equal(rerun.code, 'PROGRAMME_ZERO_DELTA');
});

test('stale preview refuses mutation', () => {
  let state = snapshot(programmeModel('QUEUED'));
  let mutationCalls = 0;
  const adapter = {
    inspectProgramme() { return JSON.parse(JSON.stringify(state)); },
    applyOperations() { mutationCalls += 1; return { ok: true }; },
  };
  const runtime = reconciler.createProgrammeRuntime({ adapter, predecessor_contract: predecessorContract });
  const preview = runtime.preview({ repository: state.repository, desired: programmeModel('CURRENT') });
  state.revision = 'moved';
  const result = runtime.apply({ preview, authority: { granted: true, preview_id: preview.preview_id, expected_revision: 'revision-1', reference: 'user:current-turn:e3' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(mutationCalls, 0);
});

test('partial readback fails closed', () => {
  const state = snapshot(programmeModel('QUEUED'));
  const adapter = { inspectProgramme() { return JSON.parse(JSON.stringify(state)); }, applyOperations() { return { ok: true, applied_count: 1 }; } };
  const runtime = reconciler.createProgrammeRuntime({ adapter, predecessor_contract: predecessorContract });
  const preview = runtime.preview({ repository: state.repository, desired: programmeModel('CURRENT') });
  const result = runtime.apply({ preview, authority: { granted: true, preview_id: preview.preview_id, expected_revision: preview.current_revision, reference: 'user:current-turn:e3' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('architecture reset and S6 assurance reject orphaned active predecessor criteria', () => {
  assert.equal(reconciler.validateArchitectureReset({ predecessor_contract: predecessorContract }).ok, true);
  const statuses = {};
  const incomplete = reconciler.assureTransferredPredecessors(predecessorContract, statuses);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, 'UNMAPPED_PREDECESSOR_OBLIGATION');
  for (const predecessor of predecessorContract.predecessors) {
    for (const criterion of predecessor.criteria) if (criterion.disposition === 'TRANSFERRED' && criterion.programme_blocking) statuses[criterion.id] = 'RESOLVED';
  }
  assert.equal(reconciler.assureTransferredPredecessors(predecessorContract, statuses).ok, true);
});



test('body freshness covers lock validation finality blocker dependency and owner decisions', () => {
  const model = programmeModel('CURRENT');
  model.children[0].dependencies = [360];
  model.children[0].blocker_evidence = [{ id: 'hold-1', current: true }];
  const events = [
    { event_type: 'lock_accepted', entity: { kind: 'child', number: 359 }, resulting_state: 'DL-S2-GITHUB-PROGRAM-001' },
    { event_type: 'validation', entity: { kind: 'pr', number: 366 }, resulting_state: 'focused tests pass' },
    { event_type: 'g4_or_finality', entity: { kind: 'pr', number: 366 }, resulting_state: 'WEB_OWNED' },
    { event_type: 'blocker', entity: { kind: 'child', number: 359 }, resulting_state: 'hold-1' },
    { event_type: 'dependency', entity: { kind: 'child', number: 359 }, resulting_state: '#360' },
    { event_type: 'owner_decision', entity: { kind: 'parent', number: 240 }, resulting_state: model.parent.status },
  ];
  assert.equal(reconciler.validateBodyFreshness({ model, events }).ok, true);
  events[0].resulting_state = 'DL-STALE';
  assert.equal(reconciler.validateBodyFreshness({ model, events }).code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('unmanaged and legacy bodies migrate by preview while preserving unrelated bytes', () => {
  const desired = programmeModel('CURRENT');
  const unmanaged = snapshot(desired);
  unmanaged.bodies.parent = 'owner prose before managed state';
  const unmanagedPreview = reconciler.buildProgrammePreview({ snapshot: unmanaged, desired, predecessor_contract: predecessorContract });
  assert.equal(unmanagedPreview.ok, true);
  assert.match(unmanagedPreview.expected_snapshot.bodies.parent, /^owner prose before managed state/);
  assert.match(unmanagedPreview.expected_snapshot.bodies.parent, /GITHUB-PROGRAM-PARENT:BEGIN v1/);

  const legacyState = {
    kind: 'parent', tracker_version: 'v3', repository: desired.repository, parent_issue: 240,
    current_work: [], pending_work: [], other_open_prs: [], terminal: [], deferred_findings: [], owner_detail: 'legacy owner detail'
  };
  const legacy = snapshot(desired);
  legacy.bodies.parent = 'owner-prefix\n' + reconciler.renderManagedBlock('parent', legacyState) + '\nowner-suffix';
  const legacyPreview = reconciler.buildProgrammePreview({ snapshot: legacy, desired, predecessor_contract: predecessorContract });
  assert.equal(legacyPreview.ok, true);
  assert.match(legacyPreview.expected_snapshot.bodies.parent, /^owner-prefix/);
  assert.match(legacyPreview.expected_snapshot.bodies.parent, /owner-suffix$/);
  assert.doesNotMatch(legacyPreview.expected_snapshot.bodies.parent, /AI-AGENT-TOOLKIT:N5-PARENT:BEGIN/);
  assert.match(legacyPreview.expected_snapshot.bodies.parent, /GITHUB-PROGRAM-PARENT:BEGIN v1/);
});
