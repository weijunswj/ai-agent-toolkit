'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');

const executionLoop = require('../scripts/toolkit-execution-loop.cjs');
const graphSurface = require('../scripts/toolkit-programme-surface-v1.cjs');
const humanSurface = require('../scripts/toolkit-github-program-state-v5.cjs').humanSurfaceV2;

const proofPath = path.join(__dirname, 'fixtures', 'controller-kernel', 'programme-421-proof-v1.json');
const graphSchemaPath = path.join(__dirname, '..', 'contracts', 'controller-kernel', 'programme-surface-v1.schema.json');

function fixtureState() {
  return {
    active_lanes: [{ child_issue: 1001, gate: 'G3', current_work: 'Verify the approved patch' }],
    children: [
      {
        boundaries: [], done_when: ['The first outcome is complete.'], eli5: 'First step.', epochs: [],
        finality: { state: 'HELD' }, issue: 1001, lifecycle: 'CURRENT', objective: 'Exercise current state.',
        order: 1, out_of_scope: [], pr_registry: [{ pr: 77, status: 'ACTIVE', epoch_id: 'G3',
          completes_child: false, accepted_evidence_ref: null, retirement_evidence_ref: null, retention_evidence_ref: null,
          role: 'INTERMEDIATE', draft: true, merged: false, github_state: 'OPEN', candidate: {
            repository: 'example/toolkit', branch: 'test-branch', base_ref: 'main', base_sha: 'a'.repeat(40),
            head: 'b'.repeat(40), tree: 'c'.repeat(40), version: 'test-only',
          } }], scope: [], summary: 'Synthetic test fixture.', title: 'Test current',
      },
      {
        boundaries: [], done_when: ['The second outcome follows the first.'], eli5: 'Second step.', epochs: [],
        finality: { state: 'HELD' }, issue: 1002, lifecycle: 'QUEUED', objective: 'Exercise dependency translation.',
        order: 2, out_of_scope: [], pr_registry: [], scope: [], summary: 'Synthetic test fixture.', title: 'Test queued',
        dependencies: [1001],
      },
    ],
    evidence_refs: [],
    extensions: [{
      schema: graphSurface.METADATA_SCHEMA,
      outcomes: [
        { child_issue: 1001, outcome_id: 'C1' },
        { child_issue: 1002, outcome_id: 'C2' },
      ],
    }],
    historical_transitions: [],
    parent: { goal: 'Exercise the graph renderer with isolated test data.', issue: 999, title: 'Synthetic graph test' },
    prs: [{
      candidate: null, changed_surfaces: [], child_issue: 1001, design_constraints: [], eli5: 'Test descriptor.', evidence_refs: [],
      number: 77, out_of_scope: [], purpose: 'Test only.', scope: [], summary: 'Synthetic test PR.', validation_requirements: [],
      repository: 'example/toolkit', schema: 'github.program.pr-descriptor.v2',
    }],
    repository: 'example/toolkit',
    schema: 'toolkit.github-program.state.generic.v1',
  };
}

function expectGraphError(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

test('source proof pins exact accepted revisions, hashes, and outcome membership', () => {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(graphSchemaPath, 'utf8'));
  assert.equal(proof.parent.revision, '2026-09-25T11:07:51Z');
  assert.equal(proof.parent.body_sha256, 'c4bf059278a53582d6585cb01c2065bab2f90b645c47b6bed34b8b6b1c9469b4');
  assert.equal(proof.parent.programme_graph_section_sha256, 'f828d04a50ed713e4ada4c6aff6d61d2b218fdea1bccb422397596e51be9a4ef');
  assert.equal(proof.w2_a.revision, '2026-09-25T11:06:41Z');
  assert.equal(proof.w2_a.body_sha256, 'ea74692a8a197bc911e3f99e1be4eda2afdccb36fd2cde335cf1ddbf37d7b27f');
  assert.deepEqual(proof.current_outcome_ids, graphSurface.CURRENT_421_OUTCOMES);
  assert.deepEqual(proof.forbidden_current_outcome_ids, ['A2', 'A3']);
  assert.deepEqual(proof.reference_only_issues, [467]);
  assert.equal(schema.$id, graphSurface.GRAPH_SCHEMA);
  assert.equal(proof.live_fetch_during_tests, false);
});

test('programme graph derives order, lifecycle, dependencies, PR pointers, work, completion, and digest', () => {
  const state = fixtureState();
  const graph = graphSurface.deriveProgrammeGraph(state);
  assert.equal(Object.isFrozen(graph.outcomes), true);
  assert.equal(Object.isFrozen(graph.outcomes[0]), true);
  assert.equal(Object.isFrozen(graph.outcomes[0].complete_when), true);
  assert.deepEqual(graph.outcomes.map((item) => item.outcome_id), ['C1', 'C2']);
  assert.deepEqual(graph.outcomes.map((item) => item.status), ['CURRENT', 'QUEUED']);
  assert.deepEqual(graph.outcomes[1].dependencies, ['C1']);
  assert.deepEqual(graph.outcomes[0].native_issue, { repository: 'example/toolkit', number: 1001 });
  assert.deepEqual(graph.outcomes[0].delivery_pr, { repository: 'example/toolkit', number: 77 });
  assert.equal(graph.outcomes[0].current_gate, 'G3');
  assert.equal(graph.outcomes[0].current_work, 'Verify the approved patch');
  assert.deepEqual(graph.outcomes[1].complete_when, ['The second outcome follows the first.']);
  const { digest, ...withoutDigest } = graph;
  assert.equal(digest, executionLoop.digestValue(withoutDigest));
  assert.equal(graphSurface.programmeGraphIdentity(graph).digest, digest);
  const lines = graphSurface.renderProgrammeGraph(graph, (value) => value.replaceAll('|', '\\|'));
  assert.equal(lines[0], '## Programme Graph');
  assert.equal(lines[2], '| Outcome | Status | Current gate | Current work | Complete when |');
  assert.equal(lines.some((line) => line === '## Children'), false);
  const validateGraph = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(graphSchemaPath, 'utf8')));
  assert.equal(validateGraph(graph), true, JSON.stringify(validateGraph.errors));
  const forbidden = structuredClone(graph);
  forbidden.outcomes[0].outcome_id = 'A2';
  assert.equal(validateGraph(forbidden), false);
});

test('metadata and dependency relationships reject duplicate, missing, unknown, self, and cyclic edges', () => {
  const duplicate = fixtureState();
  duplicate.extensions[0].outcomes[1].child_issue = 1001;
  expectGraphError(() => graphSurface.findGraphMetadata(duplicate), 'PROGRAMME_GRAPH_METADATA_INVALID');

  const missing = fixtureState();
  missing.extensions[0].outcomes.pop();
  expectGraphError(() => graphSurface.findGraphMetadata(missing), 'PROGRAMME_GRAPH_CHILD_MAPPING_MISSING');

  const unknown = fixtureState();
  unknown.extensions[0].outcomes[1].child_issue = 9999;
  expectGraphError(() => graphSurface.findGraphMetadata(unknown), 'PROGRAMME_GRAPH_METADATA_INVALID');

  const self = fixtureState();
  self.children[0].dependencies = [1001];
  expectGraphError(() => graphSurface.deriveProgrammeGraph(self), 'PROGRAMME_GRAPH_DEPENDENCY_INVALID');

  const cycle = fixtureState();
  cycle.children[0].dependencies = [1002];
  expectGraphError(() => graphSurface.deriveProgrammeGraph(cycle), 'PROGRAMME_GRAPH_DEPENDENCY_CYCLE');

  const duplicateDependency = fixtureState();
  duplicateDependency.children[1].dependencies = [1001, 1001];
  expectGraphError(() => graphSurface.deriveProgrammeGraph(duplicateDependency), 'PROGRAMME_GRAPH_DEPENDENCY_INVALID');

  const unknownDependency = fixtureState();
  unknownDependency.children[1].dependencies = [5555];
  expectGraphError(() => graphSurface.deriveProgrammeGraph(unknownDependency), 'PROGRAMME_GRAPH_DEPENDENCY_INVALID');
});

test('issue 467 remains a reference-only pointer outside current graph membership', () => {
  const state = fixtureState();
  state.parent.issue = 421;
  const issueForOutcome = (outcome, index) => outcome === 'C1' ? 435
    : outcome === 'W2-A' ? 455 : outcome === 'H1' ? 467 : 2000 + index;
  state.children = graphSurface.CURRENT_421_OUTCOMES.map((outcome, index) => ({
    issue: issueForOutcome(outcome, index),
    lifecycle: outcome === 'C1' ? 'CURRENT' : 'QUEUED',
  }));
  state.extensions = [{
    schema: graphSurface.METADATA_SCHEMA,
    outcomes: graphSurface.CURRENT_421_OUTCOMES.map((outcome, index) => ({
      child_issue: issueForOutcome(outcome, index),
      outcome_id: outcome,
      ...(outcome === 'W2-A' ? {
        priority: 'URGENT',
        planning_admission: 'G1_READ_ONLY_AUTHORIZED',
        implementation_admission: 'DEFERRED',
      } : {}),
    })),
  }];
  expectGraphError(() => graphSurface.findGraphMetadata(state), 'PROGRAMME_GRAPH_REFERENCE_ONLY_ISSUE_IN_MEMBERSHIP');
});

test('CANONICAL_STATE rendering is screened, graphful, and readback-bound', () => {
  const state = fixtureState();
  const rendered = humanSurface.render({
    source: { type: 'CANONICAL_STATE', state },
    target: { kind: 'parent' },
  });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.equal(rendered.programme_graph.schema, graphSurface.GRAPH_SCHEMA);
  assert.match(rendered.body, /## Programme Graph/);
  assert.match(rendered.body, /\| Outcome \| Status \| Current gate \| Current work \| Complete when \|/);
  assert.equal(rendered.body.includes('## Children'), false);

  const readback = humanSurface.readComplete({
    read: rendered.read,
    expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
  });
  assert.equal(readback.ok, true, JSON.stringify(readback));
  assert.deepEqual(readback.programme_graph, rendered.programme_graph);

  const missing = { ...state, extensions: [] };
  const rejected = humanSurface.render({
    source: { type: 'CANONICAL_STATE', state: missing },
    target: { kind: 'parent' },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'PROGRAMME_GRAPH_METADATA_REQUIRED');
});

test('generic canonical optionals may be absent, while malformed optionals and unknown keys fail closed', () => {
  const valid = humanSurface.render({
    source: { type: 'CANONICAL_STATE', state: fixtureState() },
    target: { kind: 'parent' },
  });
  assert.equal(valid.ok, true, JSON.stringify(valid));

  const malformed = [
    (state) => { state.design_lock = 42; },
    (state) => { state.dependencies = '1001'; },
    (state) => { state.children[1].dependencies = '1001'; },
    (state) => { state.children[1].holds = [{}]; },
    (state) => { state.active_lanes[0].unrecognized = true; },
    (state) => { state.unrecognized = true; },
  ];
  for (const mutate of malformed) {
    const state = fixtureState();
    mutate(state);
    const result = humanSurface.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CANONICAL_STATE_INVALID');
  }
});
