'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const Ajv2020 = require('ajv/dist/2020');

const executionLoop = require('../scripts/toolkit-execution-loop.cjs');
const graphSurface = require('../scripts/toolkit-programme-surface-v1.cjs');
const programmeRuntime = require('../scripts/toolkit-github-program-state-v5.cjs');
const humanSurface = programmeRuntime.humanSurfaceV2;

const proofPath = path.join(__dirname, 'fixtures', 'controller-kernel', 'programme-421-proof-v1.json');
const sourceSnapshotPath = path.join(__dirname, 'fixtures', 'controller-kernel', 'programme-421-source-snapshot-v1.json');
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

function expected421Rows(proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'))) {
  assert.deepEqual(proof.row_fields, [
    'outcome_id', 'child_issue', 'order', 'source_status', 'lifecycle', 'dependencies',
    'source_current_gate', 'current_gate', 'current_work', 'complete_when_text',
  ]);
  assert.equal(proof.expected_rows.length, 30);
  return proof.expected_rows.map((values) => Object.fromEntries(proof.row_fields.map((field, index) => [field, values[index]])));
}

function decodeMarkdownCell(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next === 32 || (next >= 33 && next <= 47) || (next >= 58 && next <= 64)
        || (next >= 91 && next <= 96) || (next >= 123 && next <= 126)) {
        result += value[index + 1];
        index += 1;
        continue;
      }
    }
    result += value[index];
  }
  return result;
}

function splitMarkdownTableRow(line) {
  const cells = [];
  let cell = '';
  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index];
    if (character === '\\' && index + 1 < line.length - 1) {
      cell += character + line[index + 1];
      index += 1;
    } else if (character === '|') {
      cells.push(decodeMarkdownCell(cell.trim()));
      cell = '';
    } else cell += character;
  }
  cells.push(decodeMarkdownCell(cell.trim()));
  return cells;
}

function source421Rows(body) {
  const start = body.indexOf('## Programme Graph\n');
  const end = body.indexOf('## Programme requirements', start);
  assert.ok(start >= 0 && end > start, 'pinned source graph section exists');
  const rows = body.slice(start, end).split('\n').filter((line) => line.startsWith('|'))
    .map(splitMarkdownTableRow)
    .filter((cells) => cells.length === 5 && cells[0] !== 'Outcome' && !cells.every((cell) => /^[-: ]+$/.test(cell)));
  return rows.map((cells, index) => {
    const outcome = cells[0].match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?):/);
    const issue = cells[3].match(/#(\d+)/);
    assert.ok(outcome && issue, `source row ${index + 1} binds an outcome and native issue`);
    const sourceStatus = cells[1];
    const lifecycle = sourceStatus.startsWith('CURRENT') ? 'CURRENT'
      : sourceStatus.startsWith('COMPLETED') ? 'COMPLETED' : 'QUEUED';
    return {
      outcome_id: outcome[1],
      child_issue: Number(issue[1]),
      order: index + 1,
      source_status: sourceStatus,
      lifecycle,
      source_current_gate: cells[2],
      current_gate: cells[2] === '—' ? null : cells[2],
      current_work: cells[3],
      complete_when_text: cells[4],
    };
  });
}

function renderedProgrammeGraphRows(body) {
  const start = body.indexOf('## Programme Graph\n');
  const end = body.indexOf('\n## Current action', start);
  assert.ok(start >= 0 && end > start, 'rendered graph section exists');
  const lines = body.slice(start, end).split('\n').filter((line) => line.startsWith('|'));
  assert.deepEqual(splitMarkdownTableRow(lines[0]), ['Outcome', 'Status', 'Current gate', 'Current work', 'Complete when']);
  return lines.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line);
    assert.equal(cells.length, 5);
    return {
      outcome_id: cells[0],
      status: cells[1],
      current_gate: cells[2] === '-' ? null : cells[2],
      current_work: cells[3] === '-' ? null : cells[3],
      complete_when_text: cells[4],
    };
  });
}

function verify421SourceSnapshot(proof, snapshot) {
  assert.deepEqual(Object.keys(snapshot).sort(), ['$schema', 'immutable', 'schema', 'source', 'w2_a_binding'].sort());
  assert.equal(snapshot.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(snapshot.schema, 'toolkit.controller.programme-graph-source-snapshot.v1');
  assert.equal(snapshot.immutable, true);
  assert.equal(proof.source_snapshot_fixture, 'repo/tests/fixtures/controller-kernel/programme-421-source-snapshot-v1.json');
  const source = snapshot.source;
  assert.equal(source.issue, proof.parent.issue);
  assert.equal(source.revision, proof.parent.revision);
  assert.equal(source.body_bytes, proof.parent.body_bytes);
  assert.equal(source.body_sha256, proof.parent.body_sha256);
  assert.equal(source.programme_graph_section_bytes, proof.parent.programme_graph_section_bytes);
  assert.equal(source.programme_graph_section_sha256, proof.parent.programme_graph_section_sha256);
  assert.equal(source.encoding, 'gzip+base64');
  assert.ok(Array.isArray(source.body_gzip_base64_chunks) && source.body_gzip_base64_chunks.length > 0);
  const bodyBytes = zlib.gunzipSync(Buffer.from(source.body_gzip_base64_chunks.join(''), 'base64'));
  assert.equal(bodyBytes.length, source.body_bytes);
  assert.equal(crypto.createHash('sha256').update(bodyBytes).digest('hex'), source.body_sha256);
  const body = bodyBytes.toString('utf8');
  assert.equal(Buffer.byteLength(body, 'utf8'), bodyBytes.length);
  const graphStart = body.indexOf('## Programme Graph\n');
  const graphEnd = body.indexOf('## Programme requirements', graphStart);
  assert.ok(graphStart >= 0 && graphEnd > graphStart);
  const graphSection = body.slice(graphStart, graphEnd);
  assert.equal(Buffer.byteLength(graphSection, 'utf8'), source.programme_graph_section_bytes);
  assert.equal(crypto.createHash('sha256').update(graphSection, 'utf8').digest('hex'), source.programme_graph_section_sha256);
  assert.deepEqual(snapshot.w2_a_binding, {
    issue: proof.w2_a.issue,
    revision: proof.w2_a.revision,
    body_bytes: proof.w2_a.body_bytes,
    body_sha256: proof.w2_a.body_sha256,
  });
  const expected = expected421Rows(proof);
  assert.deepEqual(source421Rows(body), expected.map((row) => ({
    outcome_id: row.outcome_id,
    child_issue: row.child_issue,
    order: row.order,
    source_status: row.source_status,
    lifecycle: row.lifecycle,
    source_current_gate: row.source_current_gate,
    current_gate: row.current_gate,
    current_work: row.current_work,
    complete_when_text: row.complete_when_text,
  })));
  assert.deepEqual(expected.map((row) => row.outcome_id), proof.current_outcome_ids);
  assert.deepEqual(expected.map((row) => row.order), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.deepEqual(proof.current_outcome_ids, graphSurface.CURRENT_421_OUTCOMES);
  assert.deepEqual(proof.forbidden_current_outcome_ids, ['A2', 'A3']);
  assert.deepEqual(proof.reference_only_issues, [467]);
  assert.deepEqual(proof.shared_reference_outcomes, ['H1', 'H2', 'H3']);
  return { body, graphSection, expected };
}

function source421CanonicalState(proof) {
  const rows = expected421Rows(proof);
  const issueByOutcome = new Map(rows.map((row) => [row.outcome_id, row.child_issue]));
  const candidate = {
    repository: 'weijunswj/ai-agent-toolkit',
    branch: 'c1/compiled-contract-human-routing-056',
    base_ref: 'main',
    base_sha: 'a'.repeat(40),
    head: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    version: '2.10.10',
  };
  const metadata = rows.map((row) => ({
    child_issue: row.child_issue,
    outcome_id: row.outcome_id,
    ...(row.current_gate === null ? {} : { current_gate: row.current_gate }),
    current_work: row.current_work,
    ...(proof.planning_metadata[row.outcome_id] || {}),
    ...(proof.shared_reference_outcomes.includes(row.outcome_id)
      ? { reference_issue_pointers: [{ repository: 'weijunswj/ai-agent-toolkit', issue: 467 }] } : {}),
  }));
  const children = rows.map((row) => {
    const issueDependencies = row.dependencies.map((outcome) => issueByOutcome.get(outcome));
    const prNumber = proof.delivery_pr_by_outcome[row.outcome_id] || null;
    return {
      boundaries: [],
      done_when: [row.complete_when_text],
      eli5: `Source-backed ${row.outcome_id} outcome.`,
      epochs: [],
      finality: { state: row.lifecycle === 'CURRENT' ? 'UNMERGED' : 'HELD' },
      issue: row.child_issue,
      lifecycle: row.lifecycle,
      objective: row.complete_when_text,
      order: row.order,
      out_of_scope: [],
      pr_registry: prNumber === null ? [] : [{
        accepted_evidence_ref: null,
        candidate,
        completes_child: false,
        draft: true,
        epoch_id: 'G3',
        github_state: 'OPEN',
        merged: false,
        pr: prNumber,
        retirement_evidence_ref: null,
        retention_evidence_ref: null,
        role: 'INTERMEDIATE',
        status: 'ACTIVE',
      }],
      scope: [],
      summary: row.current_work,
      title: `${row.outcome_id}: source-bound outcome`,
      ...(issueDependencies.length ? { dependencies: issueDependencies } : {}),
    };
  });
  const prNumber = proof.delivery_pr_by_outcome.C1;
  return {
    active_lanes: [],
    children,
    evidence_refs: [],
    extensions: [{ schema: graphSurface.METADATA_SCHEMA, outcomes: metadata }],
    historical_transitions: [],
    parent: { goal: 'Prove the frozen source-to-canonical programme graph mapping.', issue: 421, title: 'Toolkit programme source proof' },
    prs: [{
      changed_surfaces: [],
      child_issue: issueByOutcome.get('C1'),
      design_constraints: [],
      eli5: 'The source-backed C1 delivery PR is historical graph evidence.',
      evidence_refs: [],
      number: prNumber,
      out_of_scope: [],
      purpose: 'Bind the known C1 delivery PR for the source proof.',
      scope: [],
      summary: 'C1 delivery PR source binding.',
      validation_requirements: [],
      candidate: null,
      repository: 'weijunswj/ai-agent-toolkit',
      schema: 'github.program.pr-descriptor.v2',
    }],
    repository: 'weijunswj/ai-agent-toolkit',
    schema: 'toolkit.github-program.state.generic.v1',
  };
}

function expected421GraphRows(proof) {
  return expected421Rows(proof).map((row) => ({
    outcome_id: row.outcome_id,
    order: row.order,
    status: row.lifecycle,
    dependencies: row.dependencies,
    native_issue: { repository: 'weijunswj/ai-agent-toolkit', number: row.child_issue },
    delivery_pr: proof.delivery_pr_by_outcome[row.outcome_id]
      ? { repository: 'weijunswj/ai-agent-toolkit', number: proof.delivery_pr_by_outcome[row.outcome_id] } : null,
    current_gate: row.current_gate,
    current_work: row.current_work,
    complete_when: [row.complete_when_text],
    ...(proof.planning_metadata[row.outcome_id] || {}),
    ...(proof.shared_reference_outcomes.includes(row.outcome_id)
      ? { reference_issue_pointers: [{ repository: 'weijunswj/ai-agent-toolkit', issue: 467 }] } : {}),
  }));
}

function expectGraphError(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

test('source proof pins exact accepted revisions, hashes, and outcome membership', () => {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(sourceSnapshotPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(graphSchemaPath, 'utf8'));
  assert.equal(proof.parent.revision, '2026-09-25T11:07:51Z');
  assert.equal(proof.parent.body_sha256, 'c4bf059278a53582d6585cb01c2065bab2f90b645c47b6bed34b8b6b1c9469b4');
  assert.equal(proof.parent.programme_graph_section_sha256, 'f828d04a50ed713e4ada4c6aff6d61d2b218fdea1bccb422397596e51be9a4ef');
  assert.equal(proof.w2_a.revision, '2026-09-25T11:06:41Z');
  assert.equal(proof.w2_a.body_sha256, 'ea74692a8a197bc911e3f99e1be4eda2afdccb36fd2cde335cf1ddbf37d7b27f');
  const source = verify421SourceSnapshot(proof, snapshot);
  assert.equal(Buffer.byteLength(source.body, 'utf8'), 28222);
  assert.equal(Buffer.byteLength(source.graphSection, 'utf8'), 9139);
  assert.deepEqual(proof.current_outcome_ids, graphSurface.CURRENT_421_OUTCOMES);
  assert.deepEqual(proof.forbidden_current_outcome_ids, ['A2', 'A3']);
  assert.deepEqual(proof.reference_only_issues, [467]);
  assert.equal(schema.$id, graphSurface.GRAPH_SCHEMA);
  assert.equal(proof.live_fetch_during_tests, false);
});

test('F4 source-backed proof derives, renders, and reads back the full 30-outcome mapping', () => {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(sourceSnapshotPath, 'utf8'));
  const { expected } = verify421SourceSnapshot(proof, snapshot);
  const state = source421CanonicalState(proof);
  assert.equal(state.children.length, 30);
  assert.equal(state.children.filter((child) => child.lifecycle === 'CURRENT').length, 1);
  assert.equal(state.children.find((child) => child.issue === 467), undefined);

  const expectedGraph = expected421GraphRows(proof);
  const graph = graphSurface.deriveProgrammeGraph(state);
  assert.deepEqual(graph.outcomes, expectedGraph);
  assert.deepEqual(graph.outcomes.map((row) => row.outcome_id), expected.map((row) => row.outcome_id));
  assert.deepEqual(graph.outcomes.map((row) => row.native_issue.number), expected.map((row) => row.child_issue));
  assert.deepEqual(graph.outcomes.map((row) => row.dependencies), expected.map((row) => row.dependencies));
  assert.deepEqual(graph.outcomes.map((row) => row.complete_when[0]), expected.map((row) => row.complete_when_text));
  assert.deepEqual(graph.outcomes.find((row) => row.outcome_id === 'W2-A'), {
    ...expectedGraph[1],
    priority: 'URGENT',
    planning_class: 'INVESTIGATION',
    planning_admission: 'G1_READ_ONLY_AUTHORIZED',
    implementation_admission: 'DEFERRED',
  });
  assert.deepEqual(graph.outcomes.filter((row) => ['H1', 'H2', 'H3'].includes(row.outcome_id)
    && row.reference_issue_pointers[0].issue === 467).map((row) => row.outcome_id), ['H1', 'H2', 'H3']);
  assert.deepEqual(graphSurface.programmeGraphIdentity(graph), { schema: graphSurface.GRAPH_SCHEMA, digest: graph.digest });

  const rendered = humanSurface.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.deepEqual(rendered.programme_graph, graphSurface.programmeGraphIdentity(graph));
  assert.deepEqual(renderedProgrammeGraphRows(rendered.body), expectedGraph.map((row) => ({
    outcome_id: row.outcome_id,
    status: row.status,
    current_gate: row.current_gate,
    current_work: row.current_work,
    complete_when_text: row.complete_when.join('; '),
  })));
  assert.equal(rendered.body.includes('## Programme Graph'), true);
  assert.equal(rendered.body.includes('## Children'), false);
  const readback = humanSurface.readComplete({
    read: rendered.read,
    expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue },
  });
  assert.equal(readback.ok, true, JSON.stringify(readback));
  assert.equal(readback.programme_graph.digest, graph.digest);
  assert.deepEqual(graphSurface.deriveProgrammeGraph(readback.canonical_state), graph);
});

test('F4 falsification detects swapped identity, omissions, duplicates, wrong edges, completion text, and issue 467', () => {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const expected = expected421GraphRows(proof);
  const assertDifferentFromSource = (state, label) => {
    const recomputed = graphSurface.deriveProgrammeGraph(state);
    assert.notDeepEqual(recomputed.outcomes, expected, label);
    assert.equal(recomputed.digest, executionLoop.digestValue({
      schema: recomputed.schema,
      repository: recomputed.repository,
      parent_issue: recomputed.parent_issue,
      outcomes: recomputed.outcomes,
    }), `${label}: ordinary candidate digest was recomputed`);
  };

  const swapped = source421CanonicalState(proof);
  const c2 = swapped.extensions[0].outcomes.find((row) => row.outcome_id === 'C2');
  const c3 = swapped.extensions[0].outcomes.find((row) => row.outcome_id === 'C3');
  [c2.child_issue, c3.child_issue] = [c3.child_issue, c2.child_issue];
  assertDifferentFromSource(swapped, 'stable outcome/native issue swap');

  const omitted = source421CanonicalState(proof);
  omitted.extensions[0].outcomes.pop();
  expectGraphError(() => graphSurface.deriveProgrammeGraph(omitted), 'PROGRAMME_GRAPH_CHILD_MAPPING_MISSING');

  const duplicate = source421CanonicalState(proof);
  duplicate.extensions[0].outcomes.push(structuredClone(duplicate.extensions[0].outcomes[0]));
  expectGraphError(() => graphSurface.deriveProgrammeGraph(duplicate), 'PROGRAMME_GRAPH_METADATA_INVALID');

  const wrongDependency = source421CanonicalState(proof);
  wrongDependency.children.find((child) => child.issue === 423).dependencies = [435];
  assertDifferentFromSource(wrongDependency, 'wrong dependency with recomputed graph digest');

  const wrongCompletion = source421CanonicalState(proof);
  wrongCompletion.children.find((child) => child.issue === 423).done_when = ['A different completion condition.'];
  assertDifferentFromSource(wrongCompletion, 'wrong completion text with recomputed graph digest');

  const retired = source421CanonicalState(proof);
  retired.extensions[0].outcomes.find((row) => row.outcome_id === 'C3').outcome_id = 'A2';
  expectGraphError(() => graphSurface.deriveProgrammeGraph(retired), 'PROGRAMME_GRAPH_OUTCOME_FORBIDDEN');

  const carrierAsOutcome = source421CanonicalState(proof);
  carrierAsOutcome.children.push({ issue: 467, order: 31, lifecycle: 'QUEUED', done_when: ['Not a programme outcome.'] });
  carrierAsOutcome.extensions[0].outcomes.push({ child_issue: 467, outcome_id: 'H3-REFERENCE' });
  expectGraphError(() => graphSurface.deriveProgrammeGraph(carrierAsOutcome), 'PROGRAMME_GRAPH_REFERENCE_ONLY_ISSUE_IN_MEMBERSHIP');
});

test('F4 recomputed source tampering fails and later child-local progress does not alter frozen source proof', () => {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(sourceSnapshotPath, 'utf8'));
  verify421SourceSnapshot(proof, snapshot);

  const tampered = structuredClone(snapshot);
  const original = zlib.gunzipSync(Buffer.from(tampered.source.body_gzip_base64_chunks.join(''), 'base64')).toString('utf8');
  const changed = original.replace('C1: Controller Kernel + Delivery Contract', 'X1: Controller Kernel + Delivery Contract');
  assert.notEqual(changed, original);
  const changedBytes = Buffer.from(changed, 'utf8');
  tampered.source.body_bytes = changedBytes.length;
  tampered.source.body_sha256 = crypto.createHash('sha256').update(changedBytes).digest('hex');
  const graphStart = changed.indexOf('## Programme Graph\n');
  const graphEnd = changed.indexOf('## Programme requirements', graphStart);
  const changedSection = changed.slice(graphStart, graphEnd);
  tampered.source.programme_graph_section_bytes = Buffer.byteLength(changedSection, 'utf8');
  tampered.source.programme_graph_section_sha256 = crypto.createHash('sha256').update(changedSection, 'utf8').digest('hex');
  const recompressed = zlib.gzipSync(changedBytes, { level: 9, mtime: 0 }).toString('base64');
  tampered.source.body_gzip_base64_chunks = Array.from({ length: Math.ceil(recompressed.length / 500) },
    (_, index) => recompressed.slice(index * 500, (index + 1) * 500));
  assert.throws(() => verify421SourceSnapshot(proof, tampered));

  const progressed = source421CanonicalState(proof);
  progressed.extensions[0].outcomes.find((row) => row.outcome_id === 'C1').current_work = 'Later child-local G3 progression.';
  assert.equal(graphSurface.deriveProgrammeGraph(progressed).outcomes.find((row) => row.outcome_id === 'C1').status, 'CURRENT');
  assert.equal(verify421SourceSnapshot(proof, snapshot).expected.length, 30);
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
  const lines = graphSurface.renderProgrammeGraph(state);
  assert.equal(lines[0], '## Programme Graph');
  assert.equal(lines[2], '| Outcome | Status | Current gate | Current work | Complete when |');
  assert.equal(lines.some((line) => line === '## Children'), false);
  const validateGraph = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(graphSchemaPath, 'utf8')));
  assert.equal(validateGraph(graph), true, JSON.stringify(validateGraph.errors));
  const forbidden = structuredClone(graph);
  forbidden.outcomes[0].outcome_id = 'A2';
  assert.equal(validateGraph(forbidden), false);
});

test('public graph rendering accepts only validated canonical state and never invokes a caller encoder', () => {
  const state = fixtureState();
  let encoderCalls = 0;
  assert.throws(() => graphSurface.renderProgrammeGraph(state, () => { encoderCalls += 1; return ''; }),
    (error) => error && error.code === 'PROGRAMME_GRAPH_RENDERER_INVALID');
  assert.equal(encoderCalls, 0);
  const graph = graphSurface.deriveProgrammeGraph(state);
  assert.throws(() => graphSurface.renderProgrammeGraph(graph), (error) => error && typeof error.code === 'string');
});

test('programme graph and human-surface public ingress reject Proxies before caller traps', () => {
  const counts = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const handler = {
    get(target, key, receiver) { counts.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { counts.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { counts.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { counts.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  };
  const hostileState = new Proxy(fixtureState(), handler);
  const rendered = humanSurface.render({ source: { type: 'CANONICAL_STATE', state: hostileState }, target: { kind: 'parent' } });
  assert.equal(rendered.ok, false);
  assert.equal(rendered.code, 'INPUT_KEY_UNEXPECTED');
  assert.throws(() => graphSurface.renderProgrammeGraph(hostileState), (error) => error && typeof error.code === 'string');
  assert.deepEqual(counts, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });

  const nestedCounts = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const nestedState = fixtureState();
  nestedState.children[0] = new Proxy(nestedState.children[0], {
    get(target, key, receiver) { nestedCounts.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { nestedCounts.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { nestedCounts.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { nestedCounts.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  });
  const nestedResult = humanSurface.render({ source: { type: 'CANONICAL_STATE', state: nestedState }, target: { kind: 'parent' } });
  assert.equal(nestedResult.ok, false);
  assert.deepEqual(nestedCounts, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
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

test('typed current gate/work metadata annotates a queued outcome without changing its lifecycle', () => {
  const state = fixtureState();
  state.extensions[0].outcomes[1].current_gate = 'Read-only G1 authorized';
  state.extensions[0].outcomes[1].current_work = 'Bounded evidence collection only';
  const graph = graphSurface.deriveProgrammeGraph(state);
  const queued = graph.outcomes.find((item) => item.outcome_id === 'C2');
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.current_gate, 'Read-only G1 authorized');
  assert.equal(queued.current_work, 'Bounded evidence collection only');
  const validateGraph = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(graphSchemaPath, 'utf8')));
  assert.equal(validateGraph(graph), true, JSON.stringify(validateGraph.errors));
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
  const lines = rendered.body.split('\n');
  const markerIndex = lines[lines.length - 2].indexOf('human-v2 ');
  const carrierPrefix = lines[lines.length - 2].slice(0, markerIndex + 'human-v2 '.length);
  const encoded = lines[lines.length - 2].slice(carrierPrefix.length, -4);
  const carrier = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.equal(carrier.renderer_revision, 'human-v2-r093');

  const tampered = (revision) => {
    const changed = { ...carrier };
    if (revision === null) delete changed.renderer_revision;
    else changed.renderer_revision = revision;
    const canonical = executionLoop.canonicalSerialize(changed);
    lines[lines.length - 2] = carrierPrefix + Buffer.from(canonical, 'utf8').toString('base64url') + ' -->';
    const body = lines.join('\n');
    const read = { body, complete: true, byte_length: Buffer.byteLength(body, 'utf8'), body_sha256: crypto.createHash('sha256').update(body, 'utf8').digest('hex'), revision: null };
    return humanSurface.readComplete({ read, expect: { kind: 'parent', repository: state.repository, issue: state.parent.issue } });
  };
  assert.equal(tampered('human-v2-unknown').code, 'CARRIER_INVALID');
  assert.equal(tampered(null).code, 'READBACK_MISMATCH');

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
    (state) => { state.children[1].dependencies = null; },
    (state) => { state.children[1].holds = [{}]; },
    (state) => { state.children[1].deliverables = null; },
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

test('valid-empty generic collections normalize before identity and empty optional headings are omitted', () => {
  const state = fixtureState();
  state.prs = [];
  state.children[0].pr_registry = [];
  const emptyCollections = structuredClone(state);
  emptyCollections.dependencies = [];
  emptyCollections.children[0].dependencies = [];
  emptyCollections.children[0].holds = [];
  emptyCollections.children[0].deliverables = [];
  emptyCollections.children[0].scope = [];
  emptyCollections.children[0].boundaries = [];
  emptyCollections.children[0].out_of_scope = [];
  emptyCollections.children[0].epochs = [];
  emptyCollections.active_lanes[0].work_claims = [];
  emptyCollections.extensions[0].outcomes[0].reference_issue_pointers = [];

  const baseline = humanSurface.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
  const normalized = humanSurface.render({ source: { type: 'CANONICAL_STATE', state: emptyCollections }, target: { kind: 'parent' } });
  const baselineGraph = graphSurface.deriveProgrammeGraph(state);
  const normalizedGraph = graphSurface.deriveProgrammeGraph(emptyCollections);
  assert.equal(baseline.ok, true, JSON.stringify(baseline));
  assert.equal(normalized.ok, true, JSON.stringify(normalized));
  assert.deepEqual(normalizedGraph, baselineGraph);
  assert.equal(normalizedGraph.digest, baselineGraph.digest);
  assert.equal(normalized.canonical_sha256, baseline.canonical_sha256);
  assert.equal(normalized.body, baseline.body);
  for (const heading of ['## Completed work', '## Boundaries', '## PR history']) assert.equal(normalized.body.includes(heading), false, heading);

  const child = humanSurface.render({ source: { type: 'PARENT_READ', parent_read: normalized.read }, target: { kind: 'child', issue: 1001 } });
  assert.equal(child.ok, true, JSON.stringify(child));
  for (const heading of ['## Scope', '## Boundaries', '## Out of scope', '## Epochs / phases', '## PR history']) {
    assert.equal(child.body.includes(heading), false, heading);
  }
});

test('direct graph derivation normalizes only valid-empty optional collections', () => {
  const baseline = graphSurface.deriveProgrammeGraph(fixtureState());
  const invalid = [null, 'not-an-array', [null], [{ unexpected: true }]];
  for (const value of invalid) {
    const state = fixtureState();
    state.extensions[0].outcomes[0].reference_issue_pointers = value;
    expectGraphError(() => graphSurface.deriveProgrammeGraph(state), 'PROGRAMME_GRAPH_METADATA_INVALID');
  }
  const undefinedReferencePointers = fixtureState();
  undefinedReferencePointers.extensions[0].outcomes[0].reference_issue_pointers = undefined;
  expectGraphError(() => graphSurface.deriveProgrammeGraph(undefinedReferencePointers), 'PROGRAMME_GRAPH_STATE_INVALID');
  for (const mutate of [
    (state) => { state.dependencies = null; },
    (state) => { state.children[0].holds = null; },
    (state) => { state.children[0].deliverables = null; },
    (state) => { state.active_lanes[0].work_claims = null; },
  ]) {
    const state = fixtureState();
    mutate(state);
    assert.throws(() => graphSurface.deriveProgrammeGraph(state), (error) => typeof error.code === 'string');
  }
  const empty = fixtureState();
  empty.extensions[0].outcomes[0].reference_issue_pointers = [];
  assert.equal(graphSurface.deriveProgrammeGraph(empty).digest, baseline.digest);
});

test('required graph metadata remains required when absent or valid-empty', () => {
  for (const extensions of [undefined, []]) {
    const state = fixtureState();
    if (extensions === undefined) delete state.extensions;
    else state.extensions = extensions;
    const result = humanSurface.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROGRAMME_GRAPH_METADATA_REQUIRED');
  }
});
