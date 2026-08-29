'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const v4 = require('../scripts/toolkit-github-program-state-v4.cjs');
const v5 = require('../scripts/toolkit-github-program-state-v5.cjs');

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const EVIDENCE_DIGEST = 'd'.repeat(64);

function sourceState() {
  return {
    schema: v4.STATE_SCHEMA,
    design_lock: v4.DESIGN_LOCK,
    repository: 'example/programme',
    parent: { issue: 1, title: 'Programme', goal: 'Deliver one bounded programme truth.' },
    children: [
      {
        issue: 2, order: 1, title: 'Child A', objective: 'Deliver the current programme product.', lifecycle: 'CURRENT', dependencies: [],
        scope: ['Canonical-state convergence.'], out_of_scope: ['Ready, merge, and finality.'], boundaries: ['Web retains final disposition authority.'], eli5: 'One plan now produces every current view.',
        epochs: [{ id: 'E3', name: 'Productisation', lock: 'LOCK-E3', purpose: 'Converge the programme model.', gates: ['G2', 'G3', 'G4'], terminal_disposition: null, evidence_ref: null }], holds: [],
        pr_registry: [{ pr: 3, status: 'ACTIVE', role: 'INTERMEDIATE', completes_child: false, epoch_id: 'E3', accepted_evidence_ref: null, retirement_evidence_ref: null }], finality: { state: 'HELD', authority_ref: null },
      },
      {
        issue: 4, order: 2, title: 'Child B', objective: 'Deliver the next programme product.', lifecycle: 'QUEUED', dependencies: [2],
        scope: ['Later programme work.'], out_of_scope: ['Current Child A work.'], boundaries: ['Do not start while Child A is current.'], eli5: 'This waits for Child A.',
        epochs: [{ id: 'E1', name: 'Delivery', lock: 'LOCK-E1', purpose: 'Deliver Child B.', gates: ['G1'], terminal_disposition: null, evidence_ref: null }], holds: [], pr_registry: [], finality: { state: 'HELD', authority_ref: null },
      },
    ],
    prs: [{ number: 3, child_issue: 2, purpose: 'Implement canonical programme convergence.', scope: ['State, projection, trust, and migration contracts.'], out_of_scope: ['Ready and merge.'], design_constraints: ['Preview before apply.'], changed_surfaces: ['runtime', 'contracts', 'tests'], eli5: 'This PR makes all views use one plan.' }],
    cursor: { child_issue: 2, epoch_id: 'E3', gate: 'G3', status: 'ACTIVE', result: null },
    candidate: { pr: 3, branch: 'feature/convergence', base_ref: 'main', base_sha: BASE, head: HEAD, tree: TREE, version: '3.0.0', epoch_id: 'E3' },
    predecessor_contract_digest: EVIDENCE_DIGEST,
    evidence_refs: [
      { id: 'web-g3', kind: 'WEB', reference: 'github:issue-comment:2:100', summary: 'G3 convergence authority.' },
      { id: 'web-g4', kind: 'WEB', reference: 'github:issue-comment:2:90', summary: 'Prior G4 disposition.' },
    ],
    historical_transitions: [{ id: 'e3-g2', child_issue: 2, epoch_id: 'E3', gate: 'G2', disposition: 'ACCEPTED', evidence_ref: 'web-g3' }],
    extensions: [],
  };
}
function state(overrides = {}) {
  const migrated = v5.migrateV4ToV5(sourceState(), { authority_ref: 'github:issue-comment:2:100' });
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  return { ...migrated.state, ...overrides };
}
function multiLaneState() {
  const current = state();
  current.children[1] = { ...current.children[1], lifecycle: 'CURRENT', dependencies: [] };
  current.concurrency_authority = { mode: 'EXPLICIT_BOUNDED', max_active_lanes: 2, authority_ref: 'github:issue-comment:2:100', authority_digest: null, permitted_child_issues: [2, 4] };
  current.concurrency_authority.authority_digest = v5.authorityDigest(current.concurrency_authority);
  current.active_lanes.push({ lane_id: 'child-4', child_issue: 4, epoch_id: 'E1', gate: 'G1', gate_state: 'ACTIVE', gate_result: null, candidate: null, work_claims: [{ mode: 'WRITE', resource: 'programme/child/4', operation: 'canonical-transition' }] });
  current.active_lanes.sort((a, b) => a.lane_id.localeCompare(b.lane_id));
  return current;
}
function v5RenderedSnapshot(current) {
  const rendered = v5.renderProgrammeV5(current);
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  return {
    repository: current.repository, revision: 'revision-v5', complete: true, canonical_state: current, bodies: rendered.bodies,
    labels: v5.expectedLabelsV5(current, { '2': ['current'], '4': ['queued'] }), managed_events: [],
    native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: { '3': { parent_issue: 1, child_issue: 2, kind: 'CROSS_REFERENCE' } }, api_version: '2026-03-10' },
    bootstrap: v5.buildBootstrap({ repository: current.repository, parent_issue: current.parent.issue }),
  };
}
function legacySnapshot() {
  const source = sourceState();
  const rendered = v4.renderProgrammeV4(source);
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  return {
    repository: source.repository, revision: 'legacy-revision', complete: true, canonical_state: source,
    bodies: { parent: 'history-before\n' + rendered.bodies.parent + '\nhistory-after', children: { '2': 'child-history\n' + rendered.bodies.children['2'], '4': rendered.bodies.children['4'] }, prs: { '3': 'pr-history\n' + rendered.bodies.prs['3'] } },
    labels: { '2': ['current'], '4': ['queued'] }, managed_events: [],
    native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: {}, api_version: '2026-03-10' },
  };
}
function reidentify(receipt, changes = {}) {
  const next = { ...receipt, ...changes };
  delete next.receipt_id;
  return { ...next, receipt_id: v5.digest(next) };
}

test('v5 validates the default single lane and rejects accidental multiple CURRENT children', () => {
  const invalid = multiLaneState();
  invalid.concurrency_authority = { mode: 'SINGLE_DEFAULT', max_active_lanes: 1, authority_ref: null, authority_digest: null, permitted_child_issues: [] };
  const result = v5.validateCanonicalStateV5(invalid);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unauthorized|active-lane|current-child/i);
});

test('v5 accepts explicit bounded disjoint concurrency and deterministic lane order', () => {
  const current = multiLaneState();
  const result = v5.validateCanonicalStateV5(current);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(current.active_lanes.map((lane) => lane.lane_id), ['child-2', 'child-4']);
  assert.equal(v5.deriveProjectionV5(current).projection.parent.active_work.length, 2);
});

test('authority, lane, PR, candidate, and dependency conflicts fail closed', () => {
  const authority = state();
  authority.concurrency_authority.authority_ref = 'tampered';
  assert.equal(v5.validateCanonicalStateV5(authority).ok, false);
  const duplicatePr = state();
  duplicatePr.prs.push({ ...duplicatePr.prs[0] });
  assert.match(v5.validateCanonicalStateV5(duplicatePr).reason, /pr|shape/i);
  const duplicateLane = multiLaneState();
  duplicateLane.active_lanes.push({ ...duplicateLane.active_lanes[0], lane_id: 'child-3' });
  duplicateLane.active_lanes.sort((a, b) => a.lane_id.localeCompare(b.lane_id));
  assert.equal(v5.validateCanonicalStateV5(duplicateLane).ok, false);
  const dependentCurrent = multiLaneState();
  dependentCurrent.children[1] = { ...dependentCurrent.children[1], dependencies: [2] };
  assert.equal(v5.validateCanonicalStateV5(dependentCurrent).reason, 'dependency-conflict');
});

test('work claims allow READ/READ and proven disjoint work but reject overlap', () => {
  assert.equal(v5.validateWorkClaims([{ lane_id: 'a', work_claims: [{ mode: 'READ', resource: 'repo/a' }] }, { lane_id: 'b', work_claims: [{ mode: 'READ', resource: 'repo/a/x' }] }]).ok, true);
  assert.equal(v5.validateWorkClaims([{ lane_id: 'a', work_claims: [{ mode: 'WRITE', resource: 'repo/a' }] }, { lane_id: 'b', work_claims: [{ mode: 'READ', resource: 'repo/a/x' }] }]).ok, false);
  assert.equal(v5.validateWorkClaims([{ lane_id: 'a', work_claims: [{ mode: 'WRITE', resource: 'repo/a' }] }, { lane_id: 'b', work_claims: [{ mode: 'WRITE', resource: 'repo/b' }] }]).ok, true);
});

test('v5 renders exact fixed headings, all lanes, None sections, and no Parent Next action', () => {
  const current = state();
  const rendered = v5.renderProgrammeV5(current);
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  const parent = rendered.bodies.parent;
  const parentHeadings = [...parent.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(parentHeadings, ['Goal', 'Programme status', 'Active work', 'Children', 'Progress', 'Major holds', 'Additional context']);
  assert.equal(parent.includes('## Next action'), false);
  assert.match(parent, /## Major holds\nNone/);
  const childHeadings = [...rendered.bodies.children['2'].matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(childHeadings, ['Summary', 'Operating contract', 'Objective', 'Deliverables', 'Done when', 'Scope', 'Out of scope', 'Progress', 'Achieved', 'Remaining', 'Epochs / Locks', 'PR registry', 'Holds', 'Boundaries', 'Next action', 'ELI5', 'Additional context']);
  const prHeadings = [...rendered.bodies.prs['3'].matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(prHeadings, ['Summary', 'Binding', 'Exact candidate', 'Purpose', 'Scope', 'Out of scope', 'Progress', 'Achieved', 'Remaining', 'Changed surfaces', 'Validation / evidence', 'Design constraints', 'Finality', 'ELI5', 'Additional context']);
  assert.match(rendered.bodies.children['2'], /## Deliverables\n- Canonical-state convergence\./);
  assert.match(rendered.bodies.prs['3'], /## Validation \/ evidence/);
  assert.equal(v5.verifyRenderedProgrammeIntegrityV5(current, rendered).ok, true);
});

test('extensions remain additive and reserved semantic declarations are rejected', () => {
  const current = state({ extensions: [{ schema: v5.EXTENSIONS_SCHEMA, namespace: 'example.info', target: { kind: 'parent', number: 1 }, class: 'INFORMATION', title: 'Current status', payload: { text: 'not authority' } }] });
  assert.equal(v5.validateCanonicalStateV5(current).ok, false);
});

function receiptInput(type, extra = {}) {
  return { receipt_type: type, run_id: 'run-1', repository: 'example/programme', parent_issue: 1, lane_id: 'child-2', child_issue: 2, epoch_id: 'E3', gate: 'G3', lock: 'LOCK-E3', lease: { lease_id: 'lease-1', fence_id: 'fence-1', fence_sequence: 1, expires_at: '2099-01-01T00:00:00.000Z' }, result: { state: type }, readback: null, created_at: '2026-01-01T00:00:00.000Z', ...extra };
}

test('receipt lifecycle, duplicate/tamper handling, terminal ordering, persistence, and fences', () => {
  const started = v5.createRunReceipt(receiptInput('RUN_STARTED'));
  const terminal = v5.createRunReceipt(receiptInput('EXECUTOR_TERMINAL', { prior_receipt_id: started.receipt_id, result: { state: 'PASS' } }));
  assert.equal(v5.validateRunReceiptChain([started, terminal]).ok, true);
  const store = v5.createMemoryDurableStore();
  assert.equal(v5.appendRunReceipt(store, started).code, 'RUN_RECEIPT_PERSISTED');
  assert.equal(v5.appendRunReceipt(store, started).code, 'RUN_RECEIPT_DUPLICATE');
  const tampered = { ...terminal, result: { state: 'TAMPERED' } };
  assert.equal(v5.validateRunReceipt(tampered).ok, false);
  const beforeStart = v5.createRunReceipt(receiptInput('EXECUTOR_TERMINAL'));
  assert.equal(v5.validateRunReceiptChain([beforeStart]).reason, 'terminal-before-start');
  assert.equal(v5.canAdvanceFromTerminal({ receipts: [started, terminal], receipt: terminal, terminal_persisted: false }).reason, 'terminal-persistence-required');
  assert.equal(v5.canAdvanceFromTerminal({ receipts: [started, terminal], receipt: terminal, terminal_persisted: true }).ok, true);
  assert.equal(v5.canAdvanceFromTerminal({ receipts: [started, terminal], receipt: terminal, terminal_persisted: true, expected_monotonic_fence: 2 }).reason, 'expired-fence');
  const expired = v5.createRunReceipt(receiptInput('EXECUTOR_TERMINAL', { prior_receipt_id: started.receipt_id, lease: { lease_id: 'lease-1', fence_id: 'fence-old', fence_sequence: 1, expires_at: '2020-01-01T00:00:00.000Z' } }));
  assert.equal(v5.canAdvanceFromTerminal({ receipts: [started, expired], receipt: expired, terminal_persisted: true, now: '2026-01-01T00:00:00.000Z' }).reason, 'expired-fence');
});

test('recovery distinguishes crash and authority states', () => {
  assert.equal(v5.classifyRecovery({ running: true }).status, 'RUNNING');
  assert.equal(v5.classifyRecovery({ lost: true }).status, 'LOST');
  assert.equal(v5.classifyRecovery({ terminal_unconsumed: true }).status, 'TERMINAL_UNCONSUMED');
  assert.equal(v5.classifyRecovery({ previewed: true }).status, 'PREVIEWED_NOT_APPLIED');
  assert.equal(v5.classifyRecovery({ applied: true, acknowledged: false }).status, 'APPLIED_ACK_LOST');
  assert.equal(v5.classifyRecovery({ applied: true, acknowledged: true, readback_verified: true }).status, 'ALREADY_APPLIED');
  assert.equal(v5.classifyRecovery({ stale_candidate: true }).status, 'STALE_CANDIDATE');
  assert.equal(v5.classifyRecovery({ conflicting_transition: true }).status, 'CONFLICTING_TRANSITION');
  assert.equal(v5.classifyRecovery({ expired_fence: true }).status, 'EXPIRED_FENCE');
  assert.equal(v5.classifyRecovery({ g4_terminal: true }).status, 'G4_UNADJUDICATED');
  assert.equal(v5.classifyRecovery({ web_decision_required: true }).status, 'WEB_DECISION_REQUIRED');
});

test('v4 to v5 migration preserves historical bytes and creates separate event/receipt deltas', () => {
  const source = sourceState();
  const rendered = v4.renderProgrammeV4(source);
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  const snapshot = {
    repository: source.repository, revision: 'legacy-revision', complete: true, canonical_state: source,
    bodies: { parent: 'history-before\n' + rendered.bodies.parent + '\nhistory-after', children: { '2': 'child-history\n' + rendered.bodies.children['2'], '4': rendered.bodies.children['4'] }, prs: { '3': 'pr-history\n' + rendered.bodies.prs['3'] } },
    labels: { '2': ['current'], '4': ['queued'] }, managed_events: [], native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: {}, api_version: '2026-03-10' },
  };
  const preview = v5.buildMigrationPreviewV5({ legacy_snapshot: snapshot, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.preview_only, true);
  assert.equal(preview.expected_snapshot.bodies.parent.startsWith('history-before\n'), true);
  assert.equal(preview.expected_snapshot.bodies.parent.endsWith('\nhistory-after'), true);
  assert.equal(preview.managed_event_delta.retained_count, 0);
  assert.equal(preview.required_receipt_delta.durable_required, true);
  assert.equal(preview.mutation_authority, 'NOT_GRANTED');
  const rerun = v5.buildConvergencePreviewV5({ snapshot: preview.expected_snapshot, desired: preview.expected_snapshot.canonical_state, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(rerun.code, 'PROGRAMME_ZERO_DELTA', JSON.stringify(rerun));
});

test('bootstrap identity, digest, version, and v5 absence are fail-closed', () => {
  const bootstrap = JSON.parse(fs.readFileSync('.github/ai-agent-toolkit-programme.json', 'utf8'));
  assert.equal(v5.validateControllerBootstrap(bootstrap, { repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, version: '2.12.0' }).ok, true);
  assert.equal(v5.validateControllerBootstrap({ ...bootstrap, toolkit_contract: { ...bootstrap.toolkit_contract, sha256: 'a'.repeat(64) } }, { contract_bytes: require('../contracts/github-program-reconciler/programme-surface-contract-v5.json') }).reason, 'toolkit-contract-digest-mismatch');
  assert.equal(v5.validateControllerBootstrap({ ...bootstrap, toolkit_package_version: '3.0.0' }).reason, 'bootstrap-unknown-major');
  assert.equal(v5.validateControllerBootstrap(bootstrap, { repository: 'wrong/repo' }).reason, 'bootstrap-repository-mismatch');
  assert.equal(v5.validateControllerBootstrap(bootstrap, { version: '2.11.3' }).reason, 'bootstrap-version-mismatch');
  const missing = v5.detectManagedRepository({ canonical_state: { schema: v5.STATE_SCHEMA } });
  assert.equal(missing.classification, 'DRIFTED_MANAGED');
  assert.equal(missing.fail_closed, true);
  assert.equal(v5.inspectControllerContext({ bootstrap: null, canonical_state: { schema: v5.STATE_SCHEMA }, repository: 'example/programme', parent_issue: 1 }).code, 'PARENT_RECONCILIATION_INCOMPLETE');
});

test('controller inspection fails closed until every required native and hosted read is supplied', () => {
  const bootstrap = v5.buildBootstrap({ repository: 'example/programme', parent_issue: 1 });
  const missing = v5.inspectControllerContext({ bootstrap, repository: 'example/programme', parent_issue: 1, parent_body: 'parent', children: {}, prs: {}, managed_events: [], receipts: [], checks: {}, reviews: {} });
  assert.equal(missing.code, 'PARENT_RECONCILIATION_INCOMPLETE');
  assert.equal(missing.reason, 'required-controller-inspection-missing');
  const complete = v5.inspectControllerContext({ bootstrap, repository: 'example/programme', parent_issue: 1, parent_body: 'parent', children: {}, prs: {}, managed_events: [], receipts: [], native: {}, checks: {}, reviews: {} });
  assert.equal(complete.code, 'CONTROLLER_CONTEXT_INSPECTED', JSON.stringify(complete));
  assert.equal(complete.repository_scan, false);
});

test('immediate post-migration rerun is ZERO_DELTA and writer ownership is enforced', () => {
  const current = state();
  const rendered = v5.renderProgrammeV5(current);
  const snapshot = v5RenderedSnapshot(current);
  const preview = v5.buildConvergencePreviewV5({ snapshot, desired: current, authority_ref: 'runtime:v5' });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const rerunSnapshot = preview.expected_snapshot;
  const rerun = v5.buildConvergencePreviewV5({ snapshot: rerunSnapshot, desired: current, authority_ref: 'runtime:v5' });
  assert.equal(rerun.code, 'PROGRAMME_ZERO_DELTA', JSON.stringify(rerun));
  assert.equal(v5.validateWriterAction({ actor: 'EXECUTOR', action: 'canonical-state' }).ok, false);
  assert.equal(v5.validateWriterAction({ actor: 'RECONCILER', action: 'canonical-state' }).ok, true);
  assert.equal(v5.validateWriterAction({ actor: 'G4', action: 'evidence' }).ok, true);
  assert.ok(rendered.body_digests.parent);
});

test('durable v5 runtime verifies readback and actually probes the immediate zero-delta rerun', () => {
  const current = state();
  const snapshot = v5RenderedSnapshot(current);
  let currentSnapshot = snapshot;
  const store = v5.createMemoryDurableStore();
  const runtime = v5.createProgrammeRuntimeV5({
    durable_store: store,
    inspect_snapshot() { return currentSnapshot; },
    verify_authority() { return { ok: true }; },
    apply_operations({ operations }) {
      assert.ok(operations.length > 0);
      currentSnapshot = preview.expected_snapshot;
      return { ok: true, applied_count: operations.length };
    },
  });
  const preview = runtime.preview({ desired: current, authority: 'web-bound' });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const applied = runtime.apply({ preview, authority: { reference: 'web-bound' } });
  assert.equal(applied.code, 'PROGRAMME_V5_APPLIED', JSON.stringify(applied));
  assert.equal(applied.immediate_rerun, 'ZERO_DELTA');
});

test('Repair 1 restores the exact Parent executive metrics, precedence, tables, and holds', () => {
  const held = v5.deriveProjectionV5(state());
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.equal(held.projection.parent.aggregate_state, 'HELD');

  const active = v5.clone(multiLaneState());
  active.children.forEach((child) => { child.finality = { state: 'READY_AUTHORIZED', authority_ref: null }; });
  const activeProjection = v5.deriveProjectionV5(active);
  assert.equal(activeProjection.projection.parent.aggregate_state, 'ACTIVE');
  assert.equal(activeProjection.projection.parent.concurrency_mode, 'EXPLICIT_BOUNDED');
  assert.equal(activeProjection.projection.parent.active_lane_count, 2);
  assert.equal(activeProjection.projection.parent.max_active_lanes, 2);
  assert.deepEqual(activeProjection.projection.parent.current_child_ids, [2, 4]);
  assert.equal(activeProjection.projection.parent.progress.active_lanes, 2);
  assert.equal(activeProjection.projection.parent.progress.web_decision_required_lanes, 0);

  const webDecision = v5.clone(active);
  webDecision.active_lanes[0].gate_state = 'WEB_DECISION_REQUIRED';
  webDecision.active_lanes[0].gate_result = 'PASS';
  const webDecisionProjection = v5.deriveProjectionV5(webDecision);
  assert.equal(webDecisionProjection.projection.parent.aggregate_state, 'WEB_DECISION_REQUIRED');
  assert.equal(webDecisionProjection.projection.parent.progress.web_decision_required_lanes, 1);

  const idle = v5.clone(state());
  idle.children.forEach((child) => { child.lifecycle = 'QUEUED'; });
  idle.active_lanes = [];
  const idleProjection = v5.deriveProjectionV5(idle);
  assert.equal(idleProjection.projection.parent.aggregate_state, 'IDLE');

  const complete = v5.clone(idle);
  complete.children.forEach((child) => { child.lifecycle = 'COMPLETED'; });
  const completeProjection = v5.deriveProjectionV5(complete);
  assert.equal(completeProjection.projection.parent.aggregate_state, 'COMPLETE');

  const dependencyRendered = v5.renderProgrammeV5(state());
  assert.equal(dependencyRendered.ok, true, JSON.stringify(dependencyRendered));
  assert.match(dependencyRendered.bodies.parent, /\| #4 - Child B \| QUEUED \| #2 \|/);
  const heldWithMaterialHold = v5.clone(active);
  heldWithMaterialHold.children[0].holds = [{ id: 'hold-1', kind: 'BLOCKING', summary: 'Waiting for Web decision.', evidence_ref: 'web-g3', active: true }];
  const rendered = v5.renderProgrammeV5(heldWithMaterialHold);
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.match(rendered.bodies.parent, /\| Aggregate programme state \| HELD \|/);
  assert.match(rendered.bodies.parent, /\| Current child IDs \| #2, #4 \|/);
  assert.match(rendered.bodies.parent, /\| Programme finality state \|/);
  assert.match(rendered.bodies.parent, /\| Child \| State \| Epoch \/ Gate \| Candidate \/ PR \| Material hold \|/);
  assert.match(rendered.bodies.parent, /\| Child \| Lifecycle \| Dependencies \| Outcome \|/);
  assert.match(rendered.bodies.parent, /\| #4 - Child B \| CURRENT \| None \|/);
  assert.match(rendered.bodies.parent, /\| #2 - Child A \| ACTIVE \| E3 \/ G3 \|/);
  assert.match(rendered.bodies.parent, /hold-1: Waiting for Web decision\./);
  assert.match(rendered.bodies.parent, /\| Completed children \/ total \| 0 \/ 2 \|/);
  assert.match(rendered.bodies.parent, /\| Retired children \| 0 \|/);
  assert.match(rendered.bodies.parent, /\| Accepted or retired epochs \/ total \| 0 \/ 2 \|/);
  assert.match(rendered.bodies.parent, /\| Active lanes \| 2 \|/);
  assert.match(rendered.bodies.parent, /\| Web-decision-required lanes \| 0 \|/);
  assert.match(rendered.bodies.parent, /## Additional context\nNone/);
  assert.equal(rendered.bodies.parent.includes('## Next action'), false);
});

test('Repair 1 accepts all four canonical lane gate states as state truth', () => {
  for (const [gate_state, gate_result] of [['ACTIVE', null], ['RESULT_RECORDED', 'PASS'], ['WEB_DECISION_REQUIRED', 'AMEND'], ['AWAITING_FINALITY', 'PASS']]) {
    const current = state();
    current.active_lanes[0].gate_state = gate_state;
    current.active_lanes[0].gate_result = gate_result;
    const valid = v5.validateCanonicalStateV5(current);
    assert.equal(valid.ok, true, gate_state + ': ' + JSON.stringify(valid));
    const projection = v5.deriveProjectionV5(current);
    assert.equal(projection.projection.parent.active_work[0].state, gate_state);
  }
});

test('Repair 1 keeps bootstrap conformance outside programme Apply and rejects repository-file writers', () => {
  assert.equal(v5.validateProgrammeOperations([{ kind: 'bootstrap-file', target: '.github/ai-agent-toolkit-programme.json' }]).reason, 'repository-file-operation-forbidden');
  assert.equal(v5.validateProgrammeOperations([{ kind: 'repository-file', target: 'README.md' }]).reason, 'repository-file-operation-forbidden');
  assert.equal(v5.validateWriterAction({ actor: 'RECONCILER', action: 'repository-file' }).ok, false);

  const preview = v5.buildMigrationPreviewV5({ legacy_snapshot: legacySnapshot(), authority_ref: 'github:issue-comment:2:100' });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.bootstrap_conformance.valid, true);
  assert.equal(preview.bootstrap_conformance.apply_operation, false);
  assert.equal(preview.bootstrap.candidate_digest, v5.digest(preview.bootstrap.candidate));
  assert.equal(preview.bootstrap.after.toolkit_contract.path, v5.TOOLKIT_CONTRACT_PATH);
  assert.equal(preview.operations.some((operation) => /(?:bootstrap|repository|repo)[-_]?file/i.test(operation.kind)), false);
  assert.equal(preview.operations.every((operation) => operation.kind !== 'bootstrap-file'), true);

  const bad = v5.clone(v5.buildConvergencePreviewV5({ snapshot: v5RenderedSnapshot(state()), desired: state(), authority_ref: 'runtime:v5' }));
  assert.equal(bad.ok, true, JSON.stringify(bad));
  bad.operations = [{ kind: 'bootstrap-file', target: '.github/ai-agent-toolkit-programme.json' }];
  bad.preview_id = v5.digest(bad);
  const store = v5.createMemoryDurableStore();
  store.writePreview(bad);
  const runtime = v5.createProgrammeRuntimeV5({ durable_store: store });
  assert.equal(runtime.apply({ preview: bad }).reason, 'repository-file-operation-forbidden');
});

test('Repair 1 keeps the stable Web entry generic and routes exact target/source identity', () => {
  const entry = fs.readFileSync('repo/contracts/github-program-reconciler/web-controller-entry.md', 'utf8');
  assert.match(entry, /.github\/ai-agent-toolkit-programme\.json/);
  assert.match(entry, /toolkit_contract\.repository/);
  assert.match(entry, /toolkit_contract\.revision/);
  assert.match(entry, /toolkit_contract\.path/);
  assert.match(entry, /toolkit_contract\.sha256/);
  assert.match(entry, /current Child/);
  assert.match(entry, /run-receipt/);
  assert.match(entry, /native Parent\/Child/);
  assert.match(entry, /required checks/);
  assert.match(entry, /review threads/);
  assert.match(entry, /PARENT_RECONCILIATION_INCOMPLETE/);
  assert.match(entry, /discovery and migration guidance only/);
  assert.match(entry, /mutable Toolkit main/);
  assert.doesNotMatch(entry, /weijunswj\/ai-agent-toolkit/);
  assert.doesNotMatch(entry, /Parent #240/);

  const targetBootstrap = v5.buildBootstrap({ repository: 'example/managed-repository', parent_issue: 77 });
  const contract = require('../contracts/github-program-reconciler/programme-surface-contract-v5.json');
  const verified = v5.validateControllerBootstrap(targetBootstrap, { repository: 'example/managed-repository', parent_issue: 77, contract_bytes: contract });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(targetBootstrap.repository, 'example/managed-repository');
  assert.equal(targetBootstrap.toolkit_contract.repository, v5.TOOLKIT_CONTRACT_REPOSITORY);
  assert.notEqual(targetBootstrap.repository, targetBootstrap.toolkit_contract.repository);
  assert.equal(v5.validateControllerBootstrap({ ...targetBootstrap, toolkit_contract: { ...targetBootstrap.toolkit_contract, sha256: 'f'.repeat(64) } }, { contract_bytes: contract }).reason, 'toolkit-contract-digest-mismatch');
  assert.equal(v5.validateControllerBootstrap({ ...targetBootstrap, toolkit_package_version: '3.0.0' }).reason, 'bootstrap-unknown-major');
  assert.equal(v5.detectManagedRepository({ repository: 'example/managed-repository', parent_issue: 77, state_schema: v5.STATE_SCHEMA }).reason, 'v5-bootstrap-missing');
});

test('Repair 1 receipts carry complete bindings, bounded evidence, and tamper-detectable identity', () => {
  const candidate = { pr: 3, branch: 'feature/convergence', base_ref: 'main', base_sha: BASE, head: HEAD, tree: TREE, version: '2.12.0', epoch_id: 'E3' };
  const authorityDigest = 'e'.repeat(64);
  const bodyDigest = 'f'.repeat(64);
  const candidateBinding = '1'.repeat(64);
  const evidenceRefs = [{ id: 'check-1', digest: '2'.repeat(64) }, { id: 'review-1', digest: '3'.repeat(64) }];
  const receipt = v5.createRunReceipt(receiptInput('TRANSITION_PREVIEW', {
    role: 'LOOP_MANAGER', pr_number: 3, authority_ref: 'github:issue-comment:2:100', authority_digest: authorityDigest,
    body_digest: bodyDigest, candidate, candidate_binding_digest: candidateBinding, evidence_refs: evidenceRefs,
    readback: { required: true, persisted: true }, result: { classification: 'TRANSITION_PREVIEW', state: 'PREVIEWED_NOT_APPLIED' },
  }));
  assert.equal(v5.validateReceiptObject(receipt, {
    repository: 'example/programme', parent_issue: 1, child_issue: 2, pr_number: 3, lane_id: 'child-2',
    epoch_id: 'E3', gate: 'G3', lock: 'LOCK-E3', authority_ref: 'github:issue-comment:2:100',
    authority_digest: authorityDigest, body_digest: bodyDigest, candidate, candidate_digest: v5.digest(candidate),
    lease_id: 'lease-1', fence_id: 'fence-1', monotonic_fence: 1,
  }).ok, true);
  assert.equal(receipt.receipt_id, v5.digest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receipt_id'))));
  assert.equal(receipt.producer_timestamp, receipt.created_at);
  assert.equal(receipt.lease.monotonic_fence, receipt.lease.fence_sequence);
  assert.ok(v5.bytes(receipt) <= v5.RECEIPT_BUDGET_BYTES);
  for (const type of v5.RECEIPT_TYPES) assert.equal(v5.validateReceiptObject(v5.createRunReceipt(receiptInput(type))).ok, true, type);

  const changedAuthority = reidentify(receipt, { authority_digest: '4'.repeat(64) });
  assert.equal(v5.validateReceiptObject(changedAuthority, { authority_digest: authorityDigest }).reason, 'receipt-authority-digest-mismatch');
  const changedBody = reidentify(receipt, { body_digest: '5'.repeat(64) });
  assert.equal(v5.validateReceiptObject(changedBody, { body_digest: bodyDigest }).reason, 'receipt-body-binding-mismatch');
  const changedCandidate = { ...candidate, head: '6'.repeat(40) };
  const changedCandidateReceipt = reidentify(receipt, { candidate: changedCandidate, candidate_digest: v5.digest(changedCandidate) });
  assert.equal(v5.validateReceiptObject(changedCandidateReceipt, { candidate }).reason, 'receipt-candidate-binding-mismatch');
  const changedEvidence = { ...receipt, evidence_refs: [{ id: 'tampered', digest: '7'.repeat(64) }] };
  assert.equal(v5.validateReceiptObject(changedEvidence).ok, false);
  const changedFence = reidentify(receipt, { lease: { ...receipt.lease, monotonic_fence: 2, fence_sequence: 2 } });
  assert.equal(v5.validateReceiptObject(changedFence, { monotonic_fence: 1 }).reason, 'receipt-fence-binding-mismatch');
  const oversized = reidentify(receipt, { result: { classification: 'OVERSIZED', note: 'x'.repeat(9000) } });
  assert.equal(v5.validateReceiptObject(oversized).ok, false);
});

test('Repair 1 consumes only exact persisted receipt inventory and rejects conflicts', () => {
  const current = state();
  const receipt = v5.createRunReceipt(receiptInput('TRANSITION_PREVIEW', {
    authority_ref: 'github:issue-comment:2:100', authority_digest: '8'.repeat(64), body_digest: '9'.repeat(64),
    candidate_binding_digest: 'a'.repeat(64), readback: { required: true, persisted: true },
    result: { classification: 'TRANSITION_PREVIEW' },
  }));
  const event = v5.createManagedEventV3({
    event_type: 'canonical_transition', repository: current.repository, parent_issue: current.parent.issue,
    entity: { kind: 'parent', number: current.parent.issue }, source_state_schema: v5.STATE_SCHEMA,
    from_state_digest: v5.digest(null), to_state_digest: v5.digest(current), authority_ref: receipt.authority_ref,
    authority_digest: receipt.authority_digest, candidate_binding_digest: receipt.candidate_binding_digest,
    lane_id: receipt.lane_id, epoch_id: receipt.epoch_id, gate: receipt.gate, lock: receipt.lock,
    receipt_id: receipt.receipt_id, consumed_receipt_ids: [receipt.receipt_id], state: current,
  });
  assert.equal(v5.validateManagedEventV3(event, { repository: current.repository, parent_issue: current.parent.issue }).ok, true);
  assert.equal(event.receipt_inventory_digest, v5.receiptInventoryDigest([receipt.receipt_id]));
  assert.equal(v5.validateReceiptConsumption(event, [receipt], { repository: current.repository, parent_issue: current.parent.issue, require_readback: true }).ok, true);
  assert.equal(v5.validateReceiptConsumption(event, []).reason, 'receipt-not-persisted');
  const conflicting = { ...receipt, result: { classification: 'CONFLICT' } };
  assert.equal(v5.validateReceiptConsumption(event, [receipt, conflicting]).ok, false);
  const tamperedEvent = { ...event, consumed_receipt_ids: [], receipt_inventory_digest: null };
  assert.equal(v5.validateManagedEventV3(tamperedEvent).ok, false);
});

test('Repair 1 blocks Apply until the exact migration preview receipt is durably persisted and read back', () => {
  const preview = v5.buildMigrationPreviewV5({ legacy_snapshot: legacySnapshot(), authority_ref: 'github:issue-comment:2:100' });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const store = v5.createMemoryDurableStore();
  store.writePreview(preview);
  const runtime = v5.createProgrammeRuntimeV5({
    durable_store: store,
    inspect_snapshot() { return preview.expected_snapshot; },
    verify_authority() { return { ok: true }; },
    apply_operations() { return { ok: true }; },
  });
  assert.equal(runtime.apply({ preview, authority: { reference: 'web-bound' } }).reason, 'receipt-not-persisted');
  assert.equal(runtime.recordReceipt(preview.required_receipt_delta.receipt).ok, true);
  const applied = runtime.apply({ preview, authority: { reference: 'web-bound' } });
  assert.equal(applied.code, 'PROGRAMME_V5_APPLIED', JSON.stringify(applied));
  assert.equal(applied.immediate_rerun, 'ZERO_DELTA');
});
