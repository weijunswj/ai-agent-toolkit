'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const v4 = require('../scripts/toolkit-github-program-state-v4.cjs');

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const BASE_REF = 'main';
const EVIDENCE_DIGEST = 'd'.repeat(64);

function stateFixture() {
  return {
    schema: v4.STATE_SCHEMA,
    design_lock: v4.DESIGN_LOCK,
    repository: 'example/programme',
    parent: { issue: 1, title: 'Programme', goal: 'Deliver one bounded programme truth.' },
    children: [
      {
        issue: 2,
        order: 1,
        title: 'Child A',
        objective: 'Deliver the current programme product.',
        lifecycle: 'CURRENT',
        dependencies: [],
        scope: ['Canonical-state convergence.'],
        out_of_scope: ['Ready, merge, and finality.'],
        boundaries: ['Web retains final disposition authority.'],
        eli5: 'One plan now produces every current view.',
        epochs: [{ id: 'E3', name: 'Productisation', lock: 'LOCK-E3', purpose: 'Converge the programme model.', gates: ['G2', 'G3', 'G4'], terminal_disposition: null, evidence_ref: null }],
        holds: [],
        pr_registry: [{ pr: 3, status: 'ACTIVE', role: 'INTERMEDIATE', completes_child: false, epoch_id: 'E3', accepted_evidence_ref: null, retirement_evidence_ref: null }],
        finality: { state: 'HELD', authority_ref: null },
      },
      {
        issue: 4,
        order: 2,
        title: 'Child B',
        objective: 'Deliver the next programme product.',
        lifecycle: 'QUEUED',
        dependencies: [2],
        scope: ['Later programme work.'],
        out_of_scope: ['Current Child A work.'],
        boundaries: ['Do not start while Child A is current.'],
        eli5: 'This waits for Child A.',
        epochs: [{ id: 'E1', name: 'Delivery', lock: 'LOCK-E1', purpose: 'Deliver Child B.', gates: ['G1'], terminal_disposition: null, evidence_ref: null }],
        holds: [],
        pr_registry: [],
        finality: { state: 'HELD', authority_ref: null },
      },
    ],
    prs: [{
      number: 3,
      child_issue: 2,
      purpose: 'Implement canonical programme convergence.',
      scope: ['State, projection, trust, and migration contracts.'],
      out_of_scope: ['Ready and merge.'],
      design_constraints: ['Preview before apply.'],
      changed_surfaces: ['runtime', 'contracts', 'tests'],
      eli5: 'This PR makes all views use one plan.',
    }],
    cursor: { child_issue: 2, epoch_id: 'E3', gate: 'G3', status: 'ACTIVE', result: null },
    candidate: { pr: 3, branch: 'feature/convergence', base_ref: BASE_REF, base_sha: BASE, head: HEAD, tree: TREE, version: '3.0.0', epoch_id: 'E3' },
    predecessor_contract_digest: EVIDENCE_DIGEST,
    evidence_refs: [
      { id: 'web-g3', kind: 'WEB', reference: 'github:issue-comment:2:100', summary: 'G3 convergence authority.' },
      { id: 'web-g4-amend', kind: 'WEB', reference: 'github:issue-comment:2:90', summary: 'Prior G4 AMEND result.' },
      { id: 'web-g2', kind: 'WEB', reference: 'github:issue-comment:2:95', summary: 'Convergence G2 accepted.' },
      { id: 'accepted-pr', kind: 'PR', reference: 'github:pr:3:merge', summary: 'Accepted PR evidence.' },
      { id: 'retired-pr', kind: 'PR', reference: 'github:pr:3:closed', summary: 'Retired PR evidence.' },
      { id: 'ready-authority', kind: 'WEB', reference: 'github:issue-comment:2:110', summary: 'Ready authority.' },
    ],
    historical_transitions: [
      { id: 'e3-g4-amend', child_issue: 2, epoch_id: 'E3', gate: 'G4', disposition: 'AMEND', evidence_ref: 'web-g4-amend' },
      { id: 'e3-g2-accepted', child_issue: 2, epoch_id: 'E3', gate: 'G2', disposition: 'ACCEPTED', evidence_ref: 'web-g2' },
    ],
    extensions: [],
  };
}

function scopeFixture(state = stateFixture(), overrides = {}) {
  return {
    schema: v4.SCOPE_SCHEMA,
    repository: state.repository,
    parent_issue: state.parent.issue,
    children: state.children.slice().sort((a, b) => a.order - b.order).map((child) => child.issue),
    dependencies: Object.fromEntries(state.children.map((child) => [String(child.issue), child.dependencies])),
    associated_prs: state.prs.map((pr) => pr.number),
    api_version: '2026-03-10',
    complete: true,
    pagination: { complete: true },
    revision: 'scope-revision-1',
    source_digests: [EVIDENCE_DIGEST],
    allowed_relationship_operations: [...v4.RELATIONSHIP_OPERATION_CLASSES],
    relationship_capability_provenance: {
      adapter_identity: 'github-programme-adapter-v1',
      authority_source: 'github-native-relationships',
      revision: 'capability-revision-1',
      digest: EVIDENCE_DIGEST,
      api_version: '2026-03-10',
    },
    version_resolver: {
      identity: 'toolkit-package-v1',
      kind: 'json-pointer-agreement',
      agreement: 'all',
      sources: [{ path: 'package/version.json', pointer: '/version' }],
    },
    ...overrides,
  };
}

function trustHarness(state = stateFixture(), options = {}) {
  let relationshipCalls = 0;
  let prCalls = 0;
  const broker = v4.createProgrammeTrustBroker({
    inspect_scope() { return scopeFixture(state, typeof options.scope === 'function' ? options.scope() : options.scope || {}); },
    inspect_relationships(input) {
      relationshipCalls += 1;
      const inspection = {
        schema: v4.RELATIONSHIP_INSPECTION_SCHEMA,
        repository: input.repository,
        parent_issue: input.parent_issue,
        children: input.children,
        dependencies: input.dependencies,
        api_version: input.api_version,
        scope_digest: input.scope_digest,
        allowed_relationship_operations: input.allowed_relationship_operations,
        relationship_capability_provenance: input.relationship_capability_provenance,
        relationship_capability_digest: input.relationship_capability_digest,
        complete: true,
      };
      return typeof options.relationship_inspection === 'function'
        ? options.relationship_inspection(inspection)
        : { ...inspection, ...(options.relationship_inspection || {}) };
    },
    inspect_prs(input) {
      prCalls += 1;
      const facts = state.prs.map((pr) => {
        const candidate = state.candidate?.pr === pr.number ? state.candidate : { branch: 'retained/pr', base_ref: BASE_REF, base_sha: BASE, head: HEAD, tree: TREE, version: '3.0.0' };
        const option = (name, fallback) => typeof options[name] === 'function' ? options[name]() : options[name] ?? fallback;
        return {
          number: pr.number,
          parent_issue: option('pr_parent', state.parent.issue),
          child_issue: option('pr_child', pr.child_issue),
          branch: candidate.branch,
          base_ref: option('base_ref', candidate.base_ref),
          base_sha: option('base_sha', candidate.base_sha),
          head: candidate.head,
          tree: candidate.tree,
          version: option('version', candidate.version),
          lifecycle: option('lifecycle', 'OPEN_DRAFT'),
          version_source_digests: [EVIDENCE_DIGEST],
        };
      });
      return { schema: v4.PR_INSPECTION_SCHEMA, repository: input.repository, scope_digest: input.scope_digest, resolver_identity: input.version_resolver.identity, complete: true, facts };
    },
  });
  return { broker, issueScope: () => broker.issueScope(), calls: () => ({ relationshipCalls, prCalls }) };
}

function emptySnapshot(state) {
  return { repository: state.repository, revision: 'revision-1', complete: true, canonical_state: null, bodies: { parent: null, children: {}, prs: {} }, labels: {}, managed_events: [], native: {} };
}

function convergedSnapshot(state = stateFixture()) {
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  return { ...structuredClone(preview.expected_snapshot), revision: 'revision-2' };
}

function legacyBody(kind, repository, data, prefix = '', suffix = '') {
  const upper = kind.toUpperCase();
  const encoded = Buffer.from(JSON.stringify({ kind, repository, data }), 'utf8').toString('base64url');
  return `${prefix}<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-${upper}:BEGIN v1 -->\nlegacy ${kind}\n<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-STATE v1 ${encoded} -->\n<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-${upper}:END -->${suffix}`;
}

function completeLegacyData(kind, overrides) {
  const contract = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/programme-surface-contract.json'), 'utf8'));
  return { ...Object.fromEntries(contract.legacy_v1_portable_minimum[kind].map((key) => [key, null])), ...overrides };
}

function legacySnapshotFixture(state = stateFixture(), overrides = {}) {
  return {
    repository: state.repository,
    revision: 'legacy-revision-1',
    complete: true,
    canonical_state: null,
    bodies: {
      parent: legacyBody('parent', state.repository, completeLegacyData('parent', { issue: 1, current_child: 2, status: 'G3 CURRENT', extensions: {} }), 'owner-prefix\n', '\nowner-suffix'),
      children: {
        '2': legacyBody('child', state.repository, completeLegacyData('child', { issue: 2, parent_issue: 1, status: 'CURRENT', current_gate: 'G3', epochs: [{ state: 'CURRENT' }], candidate: { pr: 3, branch: 'feature/convergence', base: BASE, head: HEAD, tree: TREE, version: '3.0.0' } }), 'child-prefix\n', '\nchild-suffix'),
        '4': legacyBody('child', state.repository, completeLegacyData('child', { issue: 4, parent_issue: 1, status: 'QUEUED', current_gate: 'QUEUED', epochs: [{ state: 'PENDING' }], candidate: null })),
      },
      prs: { '3': legacyBody('pr', state.repository, completeLegacyData('pr', { number: 3, parent_issue: 1, child_issue: 2, branch: 'feature/convergence', base: BASE, head: HEAD, tree: TREE, version: '3.0.0', outcome: 'G3 is current.' }), 'pr-prefix\n', '\npr-suffix') },
    },
    labels: { '2': ['current'], '4': ['queued'] },
    managed_events: [],
    native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: { '3': { parent_issue: 1, child_issue: 2, kind: 'CROSS_REFERENCE' } }, api_version: '2026-03-10' },
    ...overrides,
  };
}

test('canonical state derives every semantic projection from one source', () => {
  const state = stateFixture();
  const valid = v4.validateCanonicalStateV4(state);
  assert.equal(valid.ok, true);
  assert.equal(Object.hasOwn(state.parent, 'status'), false);
  assert.equal(Object.hasOwn(state.children[0], 'outcome'), false);
  assert.equal(Object.hasOwn(state.prs[0], 'role'), false);
  const derived = v4.deriveProjectionV1(state);
  assert.equal(derived.ok, true);
  assert.match(derived.projection.parent.status, /CURRENT \/ E3 G3/);
  assert.match(derived.projection.children[0].outcome, /current in E3 at G3/);
  assert.deepEqual(derived.projection.children[0].remaining, ['E3 G3', 'E3 G4', 'Web finality disposition']);
  assert.deepEqual(derived.projection.children[0].achieved, ['E3 G4 AMEND', 'E3 G2 ACCEPTED']);
  assert.match(derived.projection.prs[0].outcome, /active for E3/);
  assert.equal(derived.projection.prs[0].lock, 'LOCK-E3');
});

test('active draft candidate passes exact trusted PR and generic version binding', () => {
  const state = stateFixture();
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  assert.equal(scope.ok, true);
  const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true);
  assert.equal(preview.code, 'PROGRAMME_PREVIEW_READY');
  assert.equal(preview.mutation_authority, 'NOT_GRANTED');
});

test('candidate version mismatch and ACTIVE merged lifecycle fail closed', () => {
  const state = stateFixture();
  for (const options of [{ version: '3.0.1' }, { lifecycle: 'MERGED' }]) {
    const harness = trustHarness(state, options);
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.ok, false);
  }
});

test('candidate binds base ref and base SHA as separate trusted facts', () => {
  const state = stateFixture();
  for (const options of [{ base_ref: 'release' }, { base_sha: 'e'.repeat(40) }]) {
    const harness = trustHarness(state, options);
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.ok, false);
    assert.equal(preview.reason, 'trusted-candidate-binding-mismatch');
  }
  const harness = trustHarness(state, { base_ref: BASE_REF, base_sha: BASE });
  const scope = harness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker }).ok, true);
});

test('candidate epoch and derived Child association must match the unique ACTIVE registry entry', () => {
  const wrongEpoch = stateFixture();
  wrongEpoch.candidate.epoch_id = 'E1';
  assert.equal(v4.validateCanonicalStateV4(wrongEpoch).reason, 'canonical-candidate-shape');

  const state = stateFixture();
  const harness = trustHarness(state, { pr_child: 4 });
  const scope = harness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker }).reason, 'trusted-pr-association-mismatch');
});

test('candidate schema rejects independently authored Lock, role, completes-child, and Child identity', () => {
  for (const duplicate of [{ lock: 'LOCK-E3' }, { role: 'INTERMEDIATE' }, { completes_child: false }, { child_issue: 2 }]) {
    const state = stateFixture();
    Object.assign(state.candidate, duplicate);
    assert.equal(v4.validateCanonicalStateV4(state).reason, 'canonical-candidate-shape');
  }
});

test('ACCEPTED merged and RETIRED closed-unmerged registry paths require evidence', () => {
  const accepted = stateFixture();
  accepted.children[0].pr_registry[0].status = 'ACCEPTED';
  accepted.children[0].pr_registry[0].accepted_evidence_ref = 'accepted-pr';
  accepted.candidate = null;
  let harness = trustHarness(accepted, { lifecycle: 'MERGED' });
  let scope = harness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: emptySnapshot(accepted), desired: accepted, scope_grant: scope.grant, broker: harness.broker }).ok, true);

  const retired = stateFixture();
  retired.children[0].pr_registry[0].status = 'RETIRED';
  retired.children[0].pr_registry[0].retirement_evidence_ref = 'retired-pr';
  retired.candidate = null;
  harness = trustHarness(retired, { lifecycle: 'CLOSED_UNMERGED' });
  scope = harness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: emptySnapshot(retired), desired: retired, scope_grant: scope.grant, broker: harness.broker }).ok, true);
});

test('Ready path is legal only for terminal completion with Web authority and no hold', () => {
  const ready = stateFixture();
  ready.children[0].epochs[0].terminal_disposition = 'ACCEPTED';
  ready.children[0].epochs[0].evidence_ref = 'web-g2';
  ready.children[0].pr_registry[0].role = 'TERMINAL';
  ready.children[0].pr_registry[0].completes_child = true;
  ready.children[0].finality = { state: 'READY_AUTHORIZED', authority_ref: 'ready-authority' };
  ready.cursor = null;
  let harness = trustHarness(ready, { lifecycle: 'OPEN_READY' });
  let scope = harness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: emptySnapshot(ready), desired: ready, scope_grant: scope.grant, broker: harness.broker }).ok, true);
  assert.equal(v4.derivePrAssociationsV4(ready).associations['3'].kind, 'CLOSING');

  ready.children[0].finality = { state: 'HELD', authority_ref: null };
  harness = trustHarness(ready, { lifecycle: 'OPEN_READY' });
  scope = harness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: emptySnapshot(ready), desired: ready, scope_grant: scope.grant, broker: harness.broker }).ok, false);
});

test('gate completion and finality reject non-Web disposition evidence', () => {
  const state = stateFixture();
  state.evidence_refs.find((entry) => entry.id === 'web-g2').kind = 'CHECK';
  assert.equal(v4.validateCanonicalStateV4(state).reason, 'historical-transition-web-disposition-required');

  const finality = stateFixture();
  finality.children[0].finality = { state: 'READY_AUTHORIZED', authority_ref: 'accepted-pr' };
  assert.equal(v4.validateCanonicalStateV4(finality).reason, 'finality-web-authority-required');
});

test('wrong Parent, child, dependency, and extra PR fail before relationship inspection', () => {
  for (const mutate of [
    (state) => { state.parent.issue = 99; },
    (state) => { state.children[1].issue = 99; },
    (state) => { state.children[1].dependencies = [99]; },
    (state) => { state.prs.push({ ...state.prs[0], number: 9 }); },
  ]) {
    const trustedState = stateFixture();
    const desired = stateFixture();
    mutate(desired);
    const harness = trustHarness(trustedState);
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(desired), desired, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.ok, false);
    assert.equal(harness.calls().relationshipCalls, 0);
  }
});

test('extension aliases, nested overrides, and foreign targets fail closed', () => {
  for (const extension of [
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.custom', target: { kind: 'child', number: 2 }, class: 'INFORMATION', title: 'Bad', payload: { currentStatus: 'BLOCKED' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.current-status', target: { kind: 'child', number: 2 }, class: 'INFORMATION', title: 'Bad', payload: { text: 'Detail.' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.custom', target: { kind: 'child', number: 999 }, class: 'INFORMATION', title: 'Bad', payload: { text: 'Detail.' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.custom', target: { kind: 'child', number: 2 }, class: 'TABLE', title: 'Details', payload: { columns: ['Current status'], rows: [['BLOCKED']] } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.custom', target: { kind: 'child', number: 2 }, class: 'INFORMATION', title: 'Next action', payload: { text: 'Do something else.' } },
  ]) {
    const state = stateFixture();
    state.extensions = [extension];
    assert.equal(v4.validateCanonicalStateV4(state).ok, false);
  }
});

test('Repair-2 RED: rendered extension declarations and managed markers fail before operation planning', () => {
  for (const text of [
    'Current status: BLOCKED',
    '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->',
  ]) {
    const state = stateFixture();
    state.extensions = [{
      schema: v4.EXTENSIONS_SCHEMA,
      namespace: 'repository.repair_2_reproduction',
      target: { kind: 'child', number: 2 },
      class: 'INFORMATION',
      title: 'Repair 2 reproduction',
      payload: { text },
    }];
    const harness = trustHarness(state);
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.ok, false, `${text} reached operation planning`);
    assert.equal(preview.operations, undefined);
  }
});

test('Repair-2 RED: trusted scope without relationship operation classes cannot plan a relationship delta', () => {
  const state = stateFixture();
  const harness = trustHarness(state, { scope: { allowed_relationship_operations: undefined } });
  const scope = harness.issueScope();
  assert.equal(scope.ok, false, 'scope without relationship operation classes was branded');
});

test('extension scalar safety rejects every reserved declaration and programme control surface before planning', () => {
  const cases = [
    ['information current status', { class: 'INFORMATION', payload: { text: 'Current status: BLOCKED' } }],
    ['information finality', { class: 'INFORMATION', payload: { text: 'Finality: READY' } }],
    ['information next action', { class: 'INFORMATION', payload: { text: 'Next action: merge now.' } }],
    ['summary PR state', { class: 'EVIDENCE', payload: { summary: 'PR state: MERGED' } }],
    ['table column', { class: 'TABLE', payload: { columns: ['Current Gate'], rows: [['G3']] } }],
    ['table cell', { class: 'TABLE', payload: { columns: ['Finding'], rows: [['Current status: BLOCKED']] } }],
    ['reference', { class: 'EVIDENCE', payload: { summary: 'Bounded evidence.', references: ['Finality: READY'] } }],
    ['domain health summary', { class: 'DOMAIN_HEALTH', payload: { domain: 'provider', status: 'WARN', summary: 'Lifecycle = BLOCKED' } }],
    ['child end marker', { class: 'INFORMATION', payload: { text: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->' } }],
    ['parent begin marker', { class: 'INFORMATION', payload: { text: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v2 -->' } }],
    ['PR end marker', { class: 'INFORMATION', payload: { text: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END -->' } }],
    ['canonical envelope', { class: 'INFORMATION', payload: { text: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CANONICAL v4 payload -->' } }],
    ['projection envelope', { class: 'INFORMATION', payload: { text: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PROJECTION v1 payload -->' } }],
    ['legacy envelope', { class: 'INFORMATION', payload: { text: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-STATE v1 payload -->' } }],
    ['markdown declaration', { class: 'INFORMATION', payload: { text: '**Current Status:** BLOCKED' } }],
    ['candidate binding', { class: 'INFORMATION', payload: { text: 'Candidate head: deadbeef' } }],
    ['gate declaration', { class: 'INFORMATION', payload: { text: 'Gate: G3' } }],
    ['epoch declaration', { class: 'INFORMATION', payload: { text: 'Epoch: E3' } }],
    ['lock declaration', { class: 'INFORMATION', payload: { text: 'Lock: LOCK-E3' } }],
    ['progress declaration', { class: 'INFORMATION', payload: { text: 'Progress: complete' } }],
    ['outcome declaration', { class: 'INFORMATION', payload: { text: 'Outcome: accepted' } }],
    ['remaining declaration', { class: 'INFORMATION', payload: { text: 'Remaining: none' } }],
    ['blocked declaration', { class: 'INFORMATION', payload: { text: 'Blocked: yes' } }],
    ['current gate alias', { class: 'INFORMATION', payload: { text: 'Current gate status: ACTIVE' } }],
  ];
  for (const [name, partial] of cases) {
    const state = stateFixture();
    state.extensions = [{
      schema: v4.EXTENSIONS_SCHEMA,
      namespace: `repository.scalar_${name.replace(/[^a-z]+/gi, '_').toLowerCase()}`,
      target: { kind: 'child', number: 2 },
      title: 'Bounded extension evidence',
      ...partial,
    }];
    const harness = trustHarness(state);
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.ok, false, name);
    assert.equal(preview.reason, 'extensions-invalid', name);
    assert.equal(preview.operations, undefined, name);
    assert.equal(harness.calls().relationshipCalls, 0, name);
  }
});

test('benign ready and historical prose plus Skill-Created extensions round-trip all extension classes', () => {
  const state = stateFixture();
  state.extensions = [
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.provider_note', target: { kind: 'parent', number: 1 }, class: 'INFORMATION', title: 'Provider note', payload: { text: 'Provider is ready for another test.' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.design_history', target: { kind: 'child', number: 2 }, class: 'EVIDENCE', title: 'Design history', payload: { summary: 'This historical design was blocked in 2024.', references: ['github:issue:10'] } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.review_policy', target: { kind: 'child', number: 2 }, class: 'POLICY', title: 'Review evidence policy', payload: { summary: 'The word merge appears in this explanatory sentence.' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.provider_health', target: { kind: 'parent', number: 1 }, class: 'DOMAIN_HEALTH', title: 'Provider health', payload: { domain: 'provider', status: 'UNKNOWN', summary: 'No provider action is in scope.' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'skill-created.coverage', target: { kind: 'pr', number: 3 }, class: 'TABLE', title: 'Skill-Created coverage', payload: { columns: ['Area', 'Provider Status', 'Count', 'Portable'], rows: [['Extensions', 'Ready for another test', 6, true]] } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.source_note', target: { kind: 'pr', number: 3 }, class: 'PROVENANCE', title: 'Source note', payload: { summary: 'Repository-local first-party evidence.', references: ['git:commit:abc'] } },
  ];
  const rendered = v4.renderProgrammeV4(state);
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.equal(v4.verifyRenderedProgrammeIntegrity(state, rendered).ok, true);
  for (const [kind, group] of [['parent', { '1': rendered.bodies.parent }], ['child', rendered.bodies.children], ['pr', rendered.bodies.prs]]) {
    for (const [number, body] of Object.entries(group)) {
      const parsed = v4.parseProgrammeV4Body(body, { kind, repository: state.repository, parent_issue: 1, number: Number(number) });
      assert.equal(parsed.ok, true, `${kind} ${number}`);
      assert.equal(parsed.envelope.canonical_digest, v4.digest(state));
    }
  }
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true, JSON.stringify(preview));

  const migrationHarness = trustHarness(state);
  const migrationScope = migrationHarness.issueScope();
  const migration = v4.buildMigrationPreviewV1({ legacy_snapshot: legacySnapshotFixture(state), desired: state, scope_grant: migrationScope.grant, broker: migrationHarness.broker, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(migration.ok, true, JSON.stringify(migration));
});

test('invalid extension in an otherwise exact snapshot never returns zero delta', () => {
  const valid = stateFixture();
  const snapshot = convergedSnapshot(valid);
  const invalid = structuredClone(valid);
  invalid.extensions = [{ schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.invalid_existing', target: { kind: 'parent', number: 1 }, class: 'INFORMATION', title: 'Existing note', payload: { text: 'Finality: READY' } }];
  snapshot.canonical_state = structuredClone(invalid);
  const harness = trustHarness(invalid);
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot, desired: invalid, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, false);
  assert.notEqual(preview.code, 'PROGRAMME_ZERO_DELTA');
  assert.equal(preview.operations, undefined);
});

test('table cells reject values outside the published string number boolean contract', () => {
  for (const cell of [null, ['text'], { text: 'value' }, Number.POSITIVE_INFINITY]) {
    const state = stateFixture();
    state.extensions = [{ schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.invalid_cell', target: { kind: 'parent', number: 1 }, class: 'TABLE', title: 'Invalid cell', payload: { columns: ['Value'], rows: [[cell]] } }];
    assert.equal(v4.validateCanonicalStateV4(state).reason, 'extensions-invalid');
  }
});

test('typed domain and table extensions render additively without feeding derivation', () => {
  const state = stateFixture();
  state.extensions = [
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'deployment.environment_health', target: { kind: 'parent', number: 1 }, class: 'DOMAIN_HEALTH', title: 'Environment health', payload: { domain: 'deployment', status: 'UNKNOWN', summary: 'No deployment action is in scope.' } },
    { schema: v4.EXTENSIONS_SCHEMA, namespace: 'repository.predecessor_coverage', target: { kind: 'child', number: 2 }, class: 'TABLE', title: 'Coverage', payload: { columns: ['Group', 'State'], rows: [['Predecessors', 'Mapped']] } },
  ];
  const rendered = v4.renderProgrammeV4(state);
  assert.equal(rendered.ok, true);
  assert.match(rendered.bodies.parent, /Environment health/);
  assert.match(rendered.bodies.children['2'], /Predecessors/);
  assert.match(rendered.projection.parent.status, /CURRENT \/ E3 G3/);
});

test('byte budgets reject oversized canonical state and oversized rendered body before planning', () => {
  const oversizedState = stateFixture();
  oversizedState.children[0].scope = Array.from({ length: 20 }, (_, index) => `${index}:` + 'x'.repeat(4000));
  assert.equal(v4.validateCanonicalStateV4(oversizedState).reason, 'canonical-state-byte-budget-exceeded');

  const oversizedBody = stateFixture();
  oversizedBody.extensions = Array.from({ length: 6 }, (_, index) => ({
    schema: v4.EXTENSIONS_SCHEMA,
    namespace: `repository.long_detail_${index}`,
    target: { kind: 'parent', number: 1 },
    class: 'INFORMATION',
    title: `Long detail ${index}`,
    payload: { text: 'x'.repeat(3900) },
  }));
  const rendered = v4.renderProgrammeV4(oversizedBody);
  assert.equal(rendered.ok, false);
  assert.match(rendered.reason, /byte-budget-exceeded/);
});

test('large but bounded programme renders deterministically within transport budgets', () => {
  const state = stateFixture();
  for (let issue = 5; issue <= 15; issue += 1) {
    state.children.push({
      ...structuredClone(state.children[1]),
      issue,
      order: state.children.length + 1,
      title: `Queued Child ${issue}`,
      dependencies: [issue - 1 === 4 ? 4 : issue - 1],
    });
  }
  const first = v4.renderProgrammeV4(state);
  const second = v4.renderProgrammeV4(structuredClone(state));
  assert.equal(first.ok, true);
  assert.equal(first.total_projection_bytes < v4.TOTAL_PROJECTION_BUDGET_BYTES, true);
  assert.deepEqual(first.body_digests, second.body_digests);
});

test('runtime validation rejects schema-undeclared semantic aliases', () => {
  const state = stateFixture();
  state.children[0].current_status = 'BLOCKED';
  assert.equal(v4.validateCanonicalStateV4(state).ok, false);
});

test('cursor epoch state is bound to both child and epoch identity', () => {
  const state = stateFixture();
  state.children[1].epochs[0].id = 'E3';
  const derived = v4.deriveProjectionV1(state);
  assert.equal(derived.ok, true);
  assert.equal(derived.projection.children[1].epochs[0].state, 'PENDING');
});

test('retired terminal PR never receives a closing association', () => {
  const state = stateFixture();
  state.children[0].pr_registry[0] = { pr: 3, status: 'RETIRED', role: 'TERMINAL', completes_child: true, epoch_id: 'E3', accepted_evidence_ref: null, retirement_evidence_ref: 'retired-pr' };
  state.children[0].finality = { state: 'READY_AUTHORIZED', authority_ref: 'ready-authority' };
  state.candidate = null;
  const associations = v4.derivePrAssociationsV4(state);
  assert.equal(associations.ok, true);
  assert.equal(associations.associations['3'].kind, 'CROSS_REFERENCE');
});

test('render, parse, readback, and immediate rerun prove exact canonical zero delta', () => {
  const state = stateFixture();
  const rendered = v4.renderProgrammeV4(state);
  assert.equal(rendered.ok, true);
  const parsed = v4.parseProgrammeV4Body(rendered.bodies.parent, { kind: 'parent', repository: state.repository, parent_issue: 1, number: 1 });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, state);

  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const first = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
  const readback = structuredClone(first.expected_snapshot);
  readback.revision = 'revision-2';
  assert.equal(v4.verifyConvergenceReadback(readback, first).ok, true);

  const secondHarness = trustHarness(state);
  const secondScope = secondHarness.issueScope();
  const second = v4.buildConvergencePreview({ snapshot: readback, desired: state, scope_grant: secondScope.grant, broker: secondHarness.broker });
  assert.equal(second.code, 'PROGRAMME_ZERO_DELTA');
  assert.equal(second.operations.length, 0);
});

test('convergence apply requires exact preview-bound authority and verifies readback', () => {
  const state = stateFixture();
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  let snapshot = emptySnapshot(state);
  let acceptedPreview;
  const runtime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return structuredClone(snapshot); },
    verify_authority({ binding }) { return { ok: true, grant: { reference: 'owner:approved-preview', binding } }; },
    apply_operations({ operations }) {
      assert.equal(operations.some((operation) => /ready|merge|finality/i.test(operation.kind)), false);
      snapshot = { ...structuredClone(acceptedPreview.expected_snapshot), revision: 'revision-2' };
      return { ok: true, applied_count: operations.length };
    },
  });
  acceptedPreview = runtime.preview({ desired: state, scope_grant: scope.grant });
  assert.equal(acceptedPreview.ok, true);
  const applied = runtime.apply({ preview: acceptedPreview, authority: { reference: 'owner:approved-preview' } });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.readback_verified, true);
  assert.equal(applied.immediate_rerun, 'ZERO_DELTA');
});

test('zero-delta apply reinspects and rejects drift instead of reporting fake readback', () => {
  const state = stateFixture();
  const rendered = v4.renderProgrammeV4(state);
  const events = v4.expectedManagedEventsV4(state, v4.validateManagedEventInventoryV4([], state.repository), v4.digest(state));
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  let snapshot = {
    repository: state.repository,
    revision: 'revision-1',
    complete: true,
    canonical_state: structuredClone(state),
    bodies: structuredClone(rendered.bodies),
    labels: { '2': ['current'], '4': ['queued'] },
    managed_events: events.events,
    native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: { '3': { parent_issue: 1, child_issue: 2, kind: 'CROSS_REFERENCE' } }, api_version: '2026-03-10' },
  };
  const runtime = v4.createConvergenceRuntime({ broker: harness.broker, inspect_snapshot() { return structuredClone(snapshot); } });
  const preview = runtime.preview({ desired: state, scope_grant: scope.grant });
  assert.equal(preview.code, 'PROGRAMME_ZERO_DELTA');
  snapshot = { ...snapshot, revision: 'revision-2' };
  assert.equal(runtime.apply({ preview }).reason, 'stale-preview');
});

test('trusted scope grants are deeply immutable and digest-bound', () => {
  const state = stateFixture();
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  assert.equal(Object.isFrozen(scope.grant.children), true);
  assert.equal(Object.isFrozen(scope.grant.dependencies['4']), true);
  assert.throws(() => { scope.grant.children[0] = 99; }, TypeError);
  const forged = structuredClone(scope.grant);
  forged.children[0] = 99;
  assert.equal(v4.assertScopeEquality(state, forged).reason, 'trusted-scope-grant-required');
});

test('trusted scope rejects unknown relationship classes and untrusted provenance shapes', () => {
  const state = stateFixture();
  for (const scopeOverride of [
    { allowed_relationship_operations: ['UNKNOWN_RELATIONSHIP'] },
    { relationship_capability_provenance: { ...scopeFixture(state).relationship_capability_provenance, claim: 'caller supplied' } },
    { relationship_capability_provenance: { ...scopeFixture(state).relationship_capability_provenance, digest: 'not-a-digest' } },
  ]) {
    const harness = trustHarness(state, { scope: scopeOverride });
    assert.equal(harness.issueScope().reason, 'trusted-scope-invalid');
  }
});

test('every relationship delta requires its exact trusted operation class before any operation list is returned', () => {
  const state = stateFixture();
  const base = convergedSnapshot(state);
  const cases = [
    ['CHILD_MEMBERSHIP', ['DEPENDENCY_EDGES'], (snapshot) => { snapshot.native.children = [2]; }],
    ['DEPENDENCY_EDGES', ['CHILD_MEMBERSHIP'], (snapshot) => { snapshot.native.dependencies['4'] = []; }],
    ['PR_ASSOCIATION', ['CHILD_MEMBERSHIP', 'DEPENDENCY_EDGES'], (snapshot) => { snapshot.native.pr_associations['3'].kind = 'CLOSING'; }],
  ];
  for (const [required, allowed, mutate] of cases) {
    const snapshot = structuredClone(base);
    mutate(snapshot);
    const harness = trustHarness(state, { scope: { allowed_relationship_operations: allowed } });
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.ok, false, required);
    assert.equal(preview.reason, 'trusted-relationship-capability-required', required);
    assert.deepEqual(preview.missing_relationship_operations, [required]);
    assert.equal(preview.operations, undefined);
  }
});

test('partial authority cannot plan a multi-class relationship delta', () => {
  const state = stateFixture();
  const snapshot = convergedSnapshot(state);
  snapshot.native.children = [2];
  snapshot.native.dependencies['4'] = [];
  const harness = trustHarness(state, { scope: { allowed_relationship_operations: ['CHILD_MEMBERSHIP'] } });
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.reason, 'trusted-relationship-capability-required');
  assert.deepEqual(preview.missing_relationship_operations, ['DEPENDENCY_EDGES']);
  assert.equal(preview.operations, undefined);
});

test('classified relationship changes cannot mask unclassified native fields', () => {
  const state = stateFixture();
  const snapshot = convergedSnapshot(state);
  snapshot.native.children = [2];
  snapshot.native.foreign_relationship = { preserved: true };
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.reason, 'native-relationship-delta-unclassified');
  assert.equal(preview.operations, undefined);
});

test('exact relationship capability emits one digest-bound composite operation', () => {
  const state = stateFixture();
  const snapshot = convergedSnapshot(state);
  snapshot.native.children = [2];
  const harness = trustHarness(state, { scope: { allowed_relationship_operations: ['CHILD_MEMBERSHIP'] } });
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.deepEqual(preview.required_relationship_operations, ['CHILD_MEMBERSHIP']);
  const operations = preview.operations.filter((operation) => operation.kind === 'relationships');
  assert.equal(operations.length, 1);
  assert.deepEqual(operations[0].required_relationship_operations, ['CHILD_MEMBERSHIP']);
  assert.equal(operations[0].relationship_capability_digest, preview.relationship_capability_digest);
});

test('caller capability and provenance assertions cannot gain trusted authority', () => {
  const desired = stateFixture();
  desired.allowed_relationship_operations = [...v4.RELATIONSHIP_OPERATION_CLASSES];
  assert.equal(v4.validateCanonicalStateV4(desired).reason, 'canonical-state-shape');

  const state = stateFixture();
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const forged = structuredClone(scope.grant);
  forged.relationship_capability_provenance.authority_source = 'caller-claim';
  assert.equal(v4.assertScopeEquality(state, forged).reason, 'trusted-scope-grant-required');
});

test('relationship inspection must echo exact capability classes, provenance, and digest', () => {
  const state = stateFixture();
  for (const mutate of [
    (inspection) => { inspection.allowed_relationship_operations = ['DEPENDENCY_EDGES']; },
    (inspection) => { inspection.relationship_capability_provenance.revision = 'different-revision'; },
    (inspection) => { inspection.relationship_capability_digest = 'f'.repeat(64); },
  ]) {
    const harness = trustHarness(state, { relationship_inspection(inspection) { const changed = structuredClone(inspection); mutate(changed); return changed; } });
    const scope = harness.issueScope();
    const preview = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
    assert.equal(preview.reason, 'trusted-relationship-inspection-invalid');
    assert.equal(preview.operations, undefined);
  }
});

test('capability provenance changes alter scope, inspection, operation, and preview identity', () => {
  const state = stateFixture();
  const firstHarness = trustHarness(state);
  const firstScope = firstHarness.issueScope();
  const first = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: firstScope.grant, broker: firstHarness.broker });

  const provenance = { ...scopeFixture(state).relationship_capability_provenance, revision: 'capability-revision-2', digest: 'e'.repeat(64) };
  const secondHarness = trustHarness(state, { scope: { relationship_capability_provenance: provenance } });
  const secondScope = secondHarness.issueScope();
  const second = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: secondScope.grant, broker: secondHarness.broker });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.scope_digest, second.scope_digest);
  assert.notEqual(first.relationship_capability_digest, second.relationship_capability_digest);
  assert.notEqual(first.trusted_relationship_inspection_digest, second.trusted_relationship_inspection_digest);
  assert.notEqual(first.operations_digest, second.operations_digest);
  assert.notEqual(first.preview_id, second.preview_id);
});

test('Apply rejects a fresh relationship capability grant change before mutation', () => {
  const state = stateFixture();
  let capabilities = [...v4.RELATIONSHIP_OPERATION_CLASSES];
  let applyCalls = 0;
  const harness = trustHarness(state, { scope: () => ({ allowed_relationship_operations: capabilities }) });
  const scope = harness.issueScope();
  const runtime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return emptySnapshot(state); },
    verify_authority({ binding }) { return { ok: true, grant: { reference: 'owner:exact-preview', binding } }; },
    apply_operations() { applyCalls += 1; return { ok: true }; },
  });
  const preview = runtime.preview({ desired: state, scope_grant: scope.grant });
  capabilities = ['DEPENDENCY_EDGES'];
  assert.equal(runtime.apply({ preview, authority: { reference: 'owner:exact-preview' } }).reason, 'stale-trusted-scope');
  assert.equal(applyCalls, 0);
});

test('Apply rejects fresh relationship inspection provenance drift before mutation', () => {
  const state = stateFixture();
  let inspectionRevision = 'capability-revision-1';
  let applyCalls = 0;
  const harness = trustHarness(state, {
    relationship_inspection(inspection) {
      inspection.relationship_capability_provenance.revision = inspectionRevision;
      if (inspectionRevision !== 'capability-revision-1') inspection.relationship_capability_digest = 'e'.repeat(64);
      return inspection;
    },
  });
  const scope = harness.issueScope();
  const runtime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return emptySnapshot(state); },
    apply_operations() { applyCalls += 1; return { ok: true }; },
  });
  const preview = runtime.preview({ desired: state, scope_grant: scope.grant });
  assert.equal(preview.ok, true);
  inspectionRevision = 'capability-revision-2';
  assert.equal(runtime.apply({ preview }).reason, 'stale-trusted-relationship-inspection');
  assert.equal(applyCalls, 0);
});

test('valid trusted scope with zero relationship delta emits no relationship operation', () => {
  const state = stateFixture();
  const snapshot = convergedSnapshot(state);
  const harness = trustHarness(state, { scope: { allowed_relationship_operations: [] } });
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.code, 'PROGRAMME_ZERO_DELTA');
  assert.deepEqual(preview.required_relationship_operations, []);
  assert.equal(preview.operations.filter((operation) => operation.kind === 'relationships').length, 0);
});

test('steady-state projection updates preserve owner bytes and reject competing owner truth', () => {
  const state = stateFixture();
  const rendered = v4.renderProgrammeV4(state);
  const snapshot = emptySnapshot(state);
  snapshot.bodies = structuredClone(rendered.bodies);
  snapshot.bodies.parent = `owner-prefix\n${snapshot.bodies.parent}\nowner-suffix`;
  snapshot.labels = { '2': ['human-label', 'current'], '4': ['queued'] };
  snapshot.native = { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: { '3': { parent_issue: 1, child_issue: 2, kind: 'CROSS_REFERENCE' } }, api_version: '2026-03-10' };
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  let preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true);
  assert.match(preview.expected_snapshot.bodies.parent, /^owner-prefix\n/);
  assert.match(preview.expected_snapshot.bodies.parent, /\nowner-suffix$/);
  assert.deepEqual(preview.expected_snapshot.labels['2'], ['current', 'human-label']);

  snapshot.bodies.parent = `## Current status\nBLOCKED\n${rendered.bodies.parent}`;
  const blockedHarness = trustHarness(state);
  const blockedScope = blockedHarness.issueScope();
  preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: blockedScope.grant, broker: blockedHarness.broker });
  assert.equal(preview.reason, 'current-body-requires-explicit-migration');
});

test('migration preview replaces only exact v1 managed spans and preserves unrelated bytes', () => {
  const state = stateFixture();
  const legacy = {
    repository: state.repository,
    revision: 'legacy-revision-1',
    complete: true,
    bodies: {
      parent: legacyBody('parent', state.repository, completeLegacyData('parent', { issue: 1, current_child: 2, status: 'G3 CURRENT', extensions: {} }), 'owner-prefix\n', '\nowner-suffix'),
      children: {
        '2': legacyBody('child', state.repository, completeLegacyData('child', { issue: 2, parent_issue: 1, status: 'CURRENT', current_gate: 'G3', epochs: [{ state: 'CURRENT' }], candidate: { pr: 3, branch: 'feature/convergence', base: BASE, head: HEAD, tree: TREE, version: '3.0.0' } }), 'child-prefix\n', '\nchild-suffix'),
        '4': legacyBody('child', state.repository, completeLegacyData('child', { issue: 4, parent_issue: 1, status: 'QUEUED', current_gate: 'QUEUED', epochs: [{ state: 'PENDING' }], candidate: null })),
      },
      prs: { '3': legacyBody('pr', state.repository, completeLegacyData('pr', { number: 3, parent_issue: 1, child_issue: 2, branch: 'feature/convergence', base: BASE, head: HEAD, tree: TREE, version: '3.0.0', outcome: 'G3 is current.' }), 'pr-prefix\n', '\npr-suffix') },
    },
    labels: { '2': ['current'], '4': ['queued'] },
    managed_events: [],
    native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: { '3': { parent_issue: 1, child_issue: 2, kind: 'CROSS_REFERENCE' } }, api_version: '2026-03-10' },
  };
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildMigrationPreviewV1({ legacy_snapshot: legacy, desired: state, scope_grant: scope.grant, broker: harness.broker, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(preview.ok, true);
  const migrationSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/programme-migration-v1.schema.json'), 'utf8'));
  assert.deepEqual(Object.keys(preview).sort(), migrationSchema.required.slice().sort());
  assert.equal(preview.semantic_mapping.correction_authority_ref, 'github:issue-comment:2:100');
  assert.equal(preview.mutation_authority, 'NOT_GRANTED');
  assert.match(preview.expected_snapshot.bodies.parent, /^owner-prefix\n/);
  assert.match(preview.expected_snapshot.bodies.parent, /\nowner-suffix$/);
  assert.match(preview.expected_snapshot.bodies.children['2'], /^child-prefix\n/);
  assert.match(preview.expected_snapshot.bodies.prs['3'], /\npr-suffix$/);
});

test('managed events are authoritative snapshot state for readback and zero delta', () => {
  const state = stateFixture();
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const first = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(first.ok, true);
  assert.equal(first.operations.filter((operation) => operation.kind === 'managed-event').length, 1);
  assert.equal(first.expected_snapshot.managed_events.length, 1);
  assert.equal(first.expected_snapshot.managed_events[0].event_type, 'canonical_initialisation');
  assert.equal(first.expected_snapshot.managed_events[0].source_state_schema, null);
  assert.equal(first.expected_snapshot.managed_events[0].from_state_digest, v4.digest(null));

  const missing = structuredClone(first.expected_snapshot);
  missing.revision = 'revision-2';
  missing.managed_events = [];
  assert.equal(v4.verifyConvergenceReadback(missing, first).reason, 'readback-drift');
  const missingHarness = trustHarness(state);
  const missingScope = missingHarness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: missing, desired: state, scope_grant: missingScope.grant, broker: missingHarness.broker }).reason, 'expected-managed-event-missing');

  const duplicate = structuredClone(first.expected_snapshot);
  duplicate.revision = 'revision-2';
  duplicate.managed_events.push(structuredClone(duplicate.managed_events[0]));
  const duplicateHarness = trustHarness(state);
  const duplicateScope = duplicateHarness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: duplicate, desired: state, scope_grant: duplicateScope.grant, broker: duplicateHarness.broker }).reason, 'managed-event-inventory-invalid');

  const mutated = structuredClone(first.expected_snapshot);
  mutated.revision = 'revision-2';
  mutated.managed_events[0].authority_ref = 'github:issue-comment:2:999';
  const mutatedHarness = trustHarness(state);
  const mutatedScope = mutatedHarness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: mutated, desired: state, scope_grant: mutatedScope.grant, broker: mutatedHarness.broker }).reason, 'managed-event-inventory-invalid');

  const replay = structuredClone(first.expected_snapshot);
  replay.revision = 'revision-2';
  const replayHarness = trustHarness(state);
  const replayScope = replayHarness.issueScope();
  const zero = v4.buildConvergencePreview({ snapshot: replay, desired: state, scope_grant: replayScope.grant, broker: replayHarness.broker });
  assert.equal(zero.code, 'PROGRAMME_ZERO_DELTA');
  assert.equal(zero.operations.filter((operation) => operation.kind === 'managed-event').length, 0);

  const changed = stateFixture();
  changed.cursor.gate = 'G4';
  const transitionHarness = trustHarness(changed);
  const transitionScope = transitionHarness.issueScope();
  const transition = v4.buildConvergencePreview({ snapshot: replay, desired: changed, scope_grant: transitionScope.grant, broker: transitionHarness.broker });
  const event = transition.expected_snapshot.managed_events.at(-1);
  assert.equal(event.event_type, 'canonical_transition');
  assert.equal(event.source_state_schema, v4.STATE_SCHEMA);
  assert.equal(event.from_state_digest, v4.digest(state));
  assert.equal(event.prior_event_id, replay.managed_events.at(-1).event_id);

  const missingPredecessor = structuredClone(transition.expected_snapshot);
  missingPredecessor.revision = 'revision-3';
  missingPredecessor.managed_events.shift();
  const predecessorHarness = trustHarness(changed);
  const predecessorScope = predecessorHarness.issueScope();
  assert.equal(v4.buildConvergencePreview({ snapshot: missingPredecessor, desired: changed, scope_grant: predecessorScope.grant, broker: predecessorHarness.broker }).reason, 'managed-event-inventory-invalid');
});

test('valid historical v1 events are retained without replay operations', () => {
  const state = stateFixture();
  const legacyPayload = {
    schema: 'toolkit.github-program.managed-event.v1',
    event_type: 'validation',
    repository: state.repository,
    entity: { kind: 'pr', number: 3 },
    child_issue: 2,
    pr_number: 3,
    exact_revision: HEAD,
    resulting_state: 'Focused tests passed.',
    authority_ref: 'github:issue-comment:2:90',
    epoch: 'E3',
  };
  const historical = { ...legacyPayload, event_id: v4.digest(legacyPayload) };
  const snapshot = emptySnapshot(state);
  snapshot.managed_events = [historical];
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildConvergencePreview({ snapshot, desired: state, scope_grant: scope.grant, broker: harness.broker });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.expected_snapshot.managed_events[0], historical);

  const altered = { ...historical, unexpected_mutation: 'altered' };
  assert.equal(v4.validateManagedEventInventoryV4([altered], state.repository).reason, 'managed-event-inventory-invalid');

  const initialHarness = trustHarness(state);
  const initialScope = initialHarness.issueScope();
  const initial = v4.buildConvergencePreview({ snapshot: emptySnapshot(state), desired: state, scope_grant: initialScope.grant, broker: initialHarness.broker });
  assert.equal(initial.ok, true);
  assert.equal(v4.validateManagedEventInventoryV4([initial.expected_snapshot.managed_events[0], historical], state.repository).reason, 'managed-event-inventory-invalid');
});

test('apply rejects trusted PR retarget after preview before mutation', () => {
  const state = stateFixture();
  let baseRef = BASE_REF;
  let applyCalls = 0;
  const harness = trustHarness(state, { base_ref: () => baseRef });
  const scope = harness.issueScope();
  const runtime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return emptySnapshot(state); },
    verify_authority({ binding }) { return { ok: true, grant: { reference: 'owner:exact-preview', binding } }; },
    apply_operations() { applyCalls += 1; return { ok: true }; },
  });
  const preview = runtime.preview({ desired: state, scope_grant: scope.grant });
  baseRef = 'release';
  assert.equal(runtime.apply({ preview, authority: { reference: 'owner:exact-preview' } }).reason, 'stale-trusted-pr-inspection');
  assert.equal(applyCalls, 0);
});

test('migration apply accepts only its runtime-enrolled exact preview and exact authority', () => {
  const state = stateFixture();
  const legacy = legacySnapshotFixture(state);
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const standalone = v4.buildMigrationPreviewV1({ legacy_snapshot: legacy, desired: state, scope_grant: scope.grant, broker: harness.broker, authority_ref: 'github:issue-comment:2:100' });
  const unregisteredRuntime = v4.createConvergenceRuntime({ broker: harness.broker, inspect_snapshot() { return structuredClone(legacy); } });
  assert.equal(unregisteredRuntime.apply({ preview: standalone }).reason, 'accepted-preview-required');

  let snapshot = structuredClone(legacy);
  let registered;
  let authorityBinding;
  const runtime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return structuredClone(snapshot); },
    verify_authority({ binding }) { authorityBinding = binding; return { ok: true, grant: { reference: 'owner:migration-preview', binding } }; },
    apply_operations({ operations }) {
      snapshot = { ...structuredClone(registered.expected_snapshot), revision: 'revision-2' };
      return { ok: true, applied_count: operations.length };
    },
  });
  registered = runtime.migrationPreview({ desired: state, scope_grant: scope.grant, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(registered.ok, true);
  assert.equal(registered.operations.filter((operation) => operation.kind === 'managed-event').length, 1);
  const applied = runtime.apply({ preview: registered, authority: { reference: 'owner:migration-preview' } });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.immediate_rerun, 'ZERO_DELTA');
  assert.equal(authorityBinding.preview_kind, 'MIGRATION');
  assert.equal(authorityBinding.expected_event_inventory_digest, registered.expected_event_inventory_digest);
  assert.equal(authorityBinding.relationship_capability_digest, registered.relationship_capability_digest);
  assert.deepEqual(authorityBinding.required_relationship_operations, registered.required_relationship_operations);
  assert.deepEqual(authorityBinding.operation_ids, registered.operations.map((operation) => operation.operation_id));
});

test('migration apply rejects every tampered material preview binding', () => {
  const mutators = [
    (preview) => { preview.source_body_digests.parent = 'f'.repeat(64); },
    (preview) => { preview.operations_digest = 'f'.repeat(64); },
    (preview) => { preview.operations[0].operation_id = 'f'.repeat(64); },
    (preview) => { preview.source_state_digests.parent = 'f'.repeat(64); },
    (preview) => { preview.target_canonical_digest = 'f'.repeat(64); },
    (preview) => { preview.expected_revision = 'wrong-revision'; },
    (preview) => { preview.relationship_capability_digest = 'f'.repeat(64); },
    (preview) => { preview.required_relationship_operations = ['CHILD_MEMBERSHIP']; },
  ];
  for (const mutate of mutators) {
    const state = stateFixture();
    const legacy = legacySnapshotFixture(state);
    const harness = trustHarness(state);
    const scope = harness.issueScope();
    const runtime = v4.createConvergenceRuntime({ broker: harness.broker, inspect_snapshot() { return structuredClone(legacy); } });
    const preview = runtime.migrationPreview({ desired: state, scope_grant: scope.grant, authority_ref: 'github:issue-comment:2:100' });
    const tampered = structuredClone(preview);
    mutate(tampered);
    assert.equal(runtime.apply({ preview: tampered }).reason, 'accepted-preview-required');
  }
});

test('migration apply rejects source body or event drift as stale', () => {
  for (const drift of [
    (snapshot) => { snapshot.bodies.parent += '\nchanged'; },
    (snapshot) => { snapshot.managed_events.push({ invalid: true }); },
  ]) {
    const state = stateFixture();
    let snapshot = legacySnapshotFixture(state);
    const harness = trustHarness(state);
    const scope = harness.issueScope();
    const runtime = v4.createConvergenceRuntime({
      broker: harness.broker,
      inspect_snapshot() { return structuredClone(snapshot); },
      verify_authority({ binding }) { return { ok: true, grant: { reference: 'owner:migration-preview', binding } }; },
      apply_operations() { assert.fail('stale migration must not apply'); },
    });
    const preview = runtime.migrationPreview({ desired: state, scope_grant: scope.grant, authority_ref: 'github:issue-comment:2:100' });
    drift(snapshot);
    assert.equal(runtime.apply({ preview, authority: { reference: 'owner:migration-preview' } }).reason, 'stale-preview');
  }
});

test('migration apply rejects authority for another preview and post-apply event mismatch', () => {
  const state = stateFixture();
  let snapshot = legacySnapshotFixture(state);
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  let preview;
  let applyCalls = 0;
  const wrongAuthorityRuntime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return structuredClone(snapshot); },
    verify_authority({ binding }) { return { ok: true, grant: { reference: 'owner:wrong-preview', binding: { ...binding, preview_id: 'f'.repeat(64) } } }; },
    apply_operations() { applyCalls += 1; return { ok: true }; },
  });
  preview = wrongAuthorityRuntime.migrationPreview({ desired: state, scope_grant: scope.grant, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(wrongAuthorityRuntime.apply({ preview, authority: { reference: 'owner:wrong-preview' } }).reason, 'preview-bound-authority-required');
  assert.equal(applyCalls, 0);

  snapshot = legacySnapshotFixture(state);
  const mismatchRuntime = v4.createConvergenceRuntime({
    broker: harness.broker,
    inspect_snapshot() { return structuredClone(snapshot); },
    verify_authority({ binding }) { return { ok: true, grant: { reference: 'owner:exact-preview', binding } }; },
    apply_operations() {
      snapshot = { ...structuredClone(preview.expected_snapshot), revision: 'revision-2' };
      snapshot.managed_events = [];
      return { ok: true };
    },
  });
  preview = mismatchRuntime.migrationPreview({ desired: state, scope_grant: scope.grant, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(mismatchRuntime.apply({ preview, authority: { reference: 'owner:exact-preview' } }).reason, 'readback-drift');
});

test('migration rejects partial v1 envelopes before trusted relationship inspection', () => {
  const state = stateFixture();
  const legacy = {
    repository: state.repository,
    revision: 'legacy-revision-1',
    complete: true,
    bodies: {
      parent: legacyBody('parent', state.repository, { issue: 1, current_child: 2 }),
      children: { '2': legacyBody('child', state.repository, { issue: 2, parent_issue: 1, status: 'CURRENT' }), '4': legacyBody('child', state.repository, { issue: 4, parent_issue: 1, status: 'QUEUED' }) },
      prs: { '3': legacyBody('pr', state.repository, { number: 3, parent_issue: 1, child_issue: 2 }) },
    },
    labels: { '2': ['current'], '4': ['queued'] },
    managed_events: [],
    native: { children: [2, 4], dependencies: { '2': [], '4': [2] }, associated_prs: [3], pr_associations: { '3': { parent_issue: 1, child_issue: 2, kind: 'CROSS_REFERENCE' } }, api_version: '2026-03-10' },
  };
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildMigrationPreviewV1({ legacy_snapshot: legacy, desired: state, scope_grant: scope.grant, broker: harness.broker, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(preview.reason, 'legacy-portable-state-incomplete');
  assert.equal(harness.calls().relationshipCalls, 0);
});

test('migration rejects a top-level source repository mismatch before trust inspection', () => {
  const state = stateFixture();
  const legacy = legacySnapshotFixture(state, { repository: 'other/programme' });
  const harness = trustHarness(state);
  const scope = harness.issueScope();
  const preview = v4.buildMigrationPreviewV1({ legacy_snapshot: legacy, desired: state, scope_grant: scope.grant, broker: harness.broker, authority_ref: 'github:issue-comment:2:100' });
  assert.equal(preview.reason, 'migration-repository-mismatch');
  assert.equal(harness.calls().relationshipCalls, 0);
});

test('published v4 schemas are strict, parseable, and identity-aligned', () => {
  const schemas = [
    ['programme-state-v4.schema.json', v4.STATE_SCHEMA],
    ['programme-extensions-v1.schema.json', v4.EXTENSIONS_SCHEMA],
    ['programme-projection-v1.schema.json', v4.PROJECTION_SCHEMA],
    ['programme-scope-grant-v1.schema.json', v4.SCOPE_SCHEMA],
    ['trusted-pr-inspection-v1.schema.json', v4.PR_INSPECTION_SCHEMA],
    ['trusted-relationship-inspection-v1.schema.json', v4.RELATIONSHIP_INSPECTION_SCHEMA],
    ['managed-event-v2.schema.json', v4.MANAGED_EVENT_SCHEMA],
    ['programme-migration-v1.schema.json', v4.MIGRATION_SCHEMA],
  ];
  for (const [file, identity] of schemas) {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler', file), 'utf8'));
    assert.equal(schema.$id, identity);
    assert.equal(schema.additionalProperties === false || schema.$defs?.extension?.additionalProperties === false, true);
  }
  const eventSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/managed-event-v2.schema.json'), 'utf8'));
  assert.equal(eventSchema.allOf.length, 3);
  const extensionSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/programme-extensions-v1.schema.json'), 'utf8'));
  assert.deepEqual(extensionSchema['x-toolkit-scalar-safety'].applies_to, ['title', 'text', 'summary', 'references', 'domain', 'status', 'columns', 'rows']);
  const scopeSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/programme-scope-grant-v1.schema.json'), 'utf8'));
  assert.equal(scopeSchema.required.includes('allowed_relationship_operations'), true);
  assert.equal(scopeSchema.required.includes('relationship_capability_provenance'), true);
  assert.deepEqual(scopeSchema.properties.allowed_relationship_operations.items.enum, v4.RELATIONSHIP_OPERATION_CLASSES);
  const relationshipSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/trusted-relationship-inspection-v1.schema.json'), 'utf8'));
  assert.equal(relationshipSchema.required.includes('relationship_capability_digest'), true);
  const migrationSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-reconciler/programme-migration-v1.schema.json'), 'utf8'));
  assert.equal(migrationSchema.required.includes('relationship_capability_digest'), true);
  assert.equal(migrationSchema.required.includes('required_relationship_operations'), true);
});
