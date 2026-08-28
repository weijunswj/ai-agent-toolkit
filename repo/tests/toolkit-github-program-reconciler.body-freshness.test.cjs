'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const reconciler = require('../scripts/toolkit-github-program-reconciler.cjs');
const predecessorContract = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/github-program-predecessor-coverage.json'), 'utf8'));

const AUTHORITY_REF = 'github:issue-comment:359:5446534784';
const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'd'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const LABEL_DEFINITIONS = {
  completed: { color: '1f883d', description: 'Programme child is complete or retired.' },
  current: { color: '0969da', description: 'Programme child is the sole current delivery item.' },
  queued: { color: 'bf8700', description: 'Programme child is queued for future delivery.' },
  blocked: { color: 'cf222e', description: 'Programme child has current authoritative blocker evidence.' },
};

function model(status = 'QUEUED', candidate = false) {
  const current = status === 'CURRENT';
  const completed = status === 'COMPLETED';
  const childCandidate = candidate ? {
    repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 360, pr: 366,
    branch: 'sol/s2-productisation-g3', base: BASE, head: HEAD, tree: TREE, version: '2.11.1',
    epoch: 'E3', lock: 'DL-S2-GITHUB-PROGRAM-001', role: 'INTERMEDIATE', completes_child: false,
    lifecycle: status,
  } : null;
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent: {
      issue: 240,
      status: current ? 'S2 E3 CURRENT' : 'S2 E3 AWAITING WEB',
      outcome: current ? 'E3 is current.' : 'The programme is awaiting Web.',
      goal: 'Maintain one truthful programme projection.',
      current_child: current ? 360 : null,
      child_graph: [{ issue: 360, status, short_title: 'S3', outcome: 'Build the repository loop manager.' }],
      progress: ['The programme state is represented canonically.'],
      major_holds: [],
      predecessor_gateway: { issues: 45, criteria: 84, unmapped: 0 },
      next_action: 'Wait for Web.',
    },
    children: [{
      issue: 360,
      parent_issue: 240,
      dependencies: completed ? [] : [358],
      status,
      outcome: 'Build the repository loop manager.',
      goal: 'Build the repository loop manager.',
      scope: ['The named programme child.'],
      out_of_scope: ['Ready, merge and finality.'],
      downstream_owned: ['Later programme work.'],
      current_gate: completed ? 'Accepted' : current ? 'G3 repaired' : 'Queued',
      current_phase: 'S3',
      next_gate: completed ? 'None - complete' : 'Web launch',
      progress: completed ? 'The child is complete.' : 'The child is queued.',
      achieved: completed ? ['The child was accepted.'] : [],
      remaining: completed ? [] : ['Wait for authorised launch.'],
      holds: [],
      current_obligation: completed ? 'Remain accepted.' : 'Wait for Web launch.',
      epochs: [{ name: 'E3', lock: 'DL-S2-GITHUB-PROGRAM-001', purpose: 'Programme product', state: status }],
      lock: 'DL-S2-GITHUB-PROGRAM-001',
      predecessor_issues: predecessorContract.predecessors.map((entry) => entry.issue),
      predecessor_gateway: {
        issues: 45, criteria: 84, unmapped: 0,
        optional_future: '#246 remains outside the active graph unless reactivated.',
        parked_backlog: '#250 remains discoverable and non-blocking unless reactivated.',
      },
      pr_registry: candidate ? [{ pr: 366, status: 'ACTIVE', role: 'INTERMEDIATE', completes_child: false }] : [],
      candidate: childCandidate,
      boundaries: ['Web owns Ready, merge and finality.'],
      next_action: completed ? 'Preserve accepted evidence.' : 'Remain queued.',
      eli5: completed ? 'This step is finished.' : 'This step is waiting.',
    }],
    prs: candidate ? [{
      number: 366, parent_issue: 240, child_issue: 360, epoch: 'E3', lock: 'DL-S2-GITHUB-PROGRAM-001',
      branch: 'sol/s2-productisation-g3', base: BASE, head: HEAD, tree: TREE, state: 'DRAFT',
      outcome: 'The candidate awaits Web.', purpose: 'Implement the candidate.', scope: ['Bounded repair.'],
      out_of_scope: ['Finality.'], progress: 'Awaiting Web.', achieved: ['Candidate implemented.'],
      remaining: ['Web review.'], safety_constraints: ['No finality.'],
      validation_status: [{ check: 'Focused tests', state: 'PASS' }], version: '2.11.1',
      role: 'INTERMEDIATE', completes_child: false, changed_surfaces: ['reconciler'], validation: ['tests pass'],
      holds: [], finality: 'WEB_OWNED', next_action: 'Wait for Web.', eli5: 'Web still decides.',
    }] : [],
  };
}

function childBody(programme) {
  return reconciler.renderProgrammeViews(programme).bodies.children['360'];
}

function withLegacy(programme, legacy) {
  return legacy + '\n' + childBody(programme);
}

function freshness(programme, body) {
  return reconciler.validateWholeBodyProgrammeFreshness({
    body,
    kind: 'child',
    entity: { kind: 'child', number: 360 },
    expected: programme.children[0],
    programme: programme,
  });
}

function snapshot(programme, body) {
  const views = reconciler.renderProgrammeViews(programme).bodies;
  views.children['360'] = body;
  return {
    repository: programme.repository,
    revision: 'revision-1',
    complete: true,
    model: programme,
    bodies: views,
    labels: { '360': [programme.children[0].status === 'COMPLETED' ? 'completed' : 'queued'] },
    label_definitions: JSON.parse(JSON.stringify(LABEL_DEFINITIONS)),
    managed_events: [],
    native: { sub_issues: [], blocked_by: {}, managed_blocked_by: {} },
    unrelated_digest: 'unrelated-1',
  };
}

function authorityVerifier({ assertion, binding }) {
  if (assertion.reference !== AUTHORITY_REF) return { ok: false };
  return { ok: true, grant: { ...binding, reference: AUTHORITY_REF } };
}

function applyAuthorityVerifier({ assertion, binding }) {
  if (assertion.reference !== AUTHORITY_REF) return { ok: false };
  return { ok: true, grant: { ...binding, reference: AUTHORITY_REF } };
}

function migrationFor(body, programme, overrides = {}) {
  const stale = '## Status';
  const start = body.indexOf(stale);
  const replacement = '## Historical status before managed programme adoption';
  const resultingBody = body.slice(0, start) + replacement + body.slice(start + stale.length);
  const migration = {
    schema: 'toolkit.github-program.stale-projection-migration.v2',
    classification: 'STALE_PROGRAMME_PROJECTION',
    grammar: 'toolkit.github-program.stale-projection.v2',
    repository: programme.repository,
    programme_parent_issue: 240,
    entity: { kind: 'child', number: 360 },
    body_digest: reconciler.sha256(body),
    stale_spans: [{
      start,
      end: start + stale.length,
      digest: reconciler.sha256(stale),
      classification: 'LEGACY_STATUS_HEADING',
      replacement,
    }],
    resulting_body_digest: reconciler.sha256(resultingBody),
    authority: {
      kind: 'WEB_ADJUDICATION',
      reference: AUTHORITY_REF,
      decision: 'SUPERSEDED_PROJECTION_TRANSFORM',
    },
  };
  return Object.assign(migration, overrides);
}

test('completed managed child rejects stale legacy CURRENT', () => {
  const programme = model('COMPLETED');
  const result = freshness(programme, withLegacy(programme, '## Status\n\n`CURRENT`'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'competing-current-programme-projection');
});

test('queued managed child rejects stale legacy PLANNED', () => {
  const programme = model('QUEUED');
  assert.equal(freshness(programme, withLegacy(programme, '## Status\n\n`PLANNED`')).ok, false);
});

for (const projection of ['**PLANNED**', '- PLANNED', '> `PLANNED`', '1. **PLANNED**', '- [ ] PLANNED']) {
  test('queued managed child rejects formatted stale status: ' + projection, () => {
    const programme = model('QUEUED');
    assert.equal(freshness(programme, withLegacy(programme, '## Status\n\n' + projection)).ok, false);
  });
}

test('queued child rejects stale BLOCKED BY completed predecessor projection', () => {
  const programme = model('QUEUED');
  assert.equal(freshness(programme, withLegacy(programme, '## Status\n\n`PLANNED - BLOCKED BY S1`')).ok, false);
});

test('legacy current gate inconsistent with canonical gate fails closed', () => {
  const programme = model('QUEUED');
  assert.equal(freshness(programme, withLegacy(programme, '## Current gate\n\nG4 CURRENT')).ok, false);
});

test('legacy current candidate inconsistent with canonical candidate fails closed', () => {
  const programme = model('CURRENT', true);
  assert.equal(freshness(programme, withLegacy(programme, 'Current candidate: ' + OLD_HEAD)).ok, false);
});

for (const projection of ['> Current candidate: ' + OLD_HEAD, '+ Current gate: G4 CURRENT', '1. Current status: CURRENT']) {
  test('formatted legacy current field fails closed: ' + projection.slice(0, 32), () => {
    const programme = model('CURRENT', true);
    assert.equal(freshness(programme, withLegacy(programme, projection)).ok, false);
  });
}

test('stable historical CURRENT and G3 evidence remains programme-fresh', () => {
  const programme = model('COMPLETED');
  const body = withLegacy(programme, '## Historical S1 evidence\n\nAt that time the G3 CURRENT check passed.');
  assert.equal(freshness(programme, body).ok, true);
  assert.match(body, /G3 CURRENT check passed/);
});

test('negated historical wording does not exempt a current projection', () => {
  const programme = model('QUEUED');
  const body = withLegacy(programme, '## Current status - not historical\n\n`PLANNED`');
  assert.equal(freshness(programme, body).ok, false);
});

test('whole-body freshness requires exactly one valid managed block', () => {
  const programme = model('QUEUED');
  assert.equal(freshness(programme, '## Repository-specific detail\n\nNo managed block.').ok, false);
  const rendered = childBody(programme);
  assert.equal(freshness(programme, rendered + '\n' + rendered).ok, false);
});

test('arbitrary owner prose cannot be offered as a stale migration span', () => {
  const programme = model('QUEUED');
  const body = withLegacy(programme, 'Owner policy: never delete this text.\n\n## Status\n\n`PLANNED`');
  const migration = migrationFor(body, programme);
  const arbitrary = 'Owner policy: never delete this text.';
  migration.stale_spans = [{
    start: 0, end: arbitrary.length, digest: reconciler.sha256(arbitrary),
    classification: 'LEGACY_STATUS_HEADING', replacement: '',
  }];
  migration.resulting_body_digest = reconciler.sha256(body.slice(arbitrary.length));
  const preview = reconciler.buildProgrammePreview({
    snapshot: snapshot(programme, body), desired: programme, predecessor_contract: predecessorContract,
    unmanaged_projection_migrations: { children: { '360': migration } },
    stale_projection_adjudication_verifier: authorityVerifier,
  });
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'stale-projection-migration-grammar');
});

for (const [name, mutate, reason] of [
  ['wrong adjudication', (migration) => { migration.authority.reference = 'github:issue-comment:359:5441042397'; }, 'stale-projection-adjudication-rejected'],
  ['wrong whole-body digest', (migration) => { migration.body_digest = '0'.repeat(64); }, 'stale-projection-migration-binding'],
  ['wrong stale-span digest', (migration) => { migration.stale_spans[0].digest = '0'.repeat(64); }, 'stale-projection-migration-binding'],
  ['wrong issue/entity binding', (migration) => { migration.entity.number = 361; }, 'stale-projection-migration-binding'],
  ['wrong resulting-body digest', (migration) => { migration.resulting_body_digest = '0'.repeat(64); }, 'stale-projection-result-binding'],
]) {
  test(name + ' fails closed', () => {
    const programme = model('QUEUED');
    const body = withLegacy(programme, '## Status\n\n`PLANNED`');
    const migration = migrationFor(body, programme);
    mutate(migration);
    const preview = reconciler.buildProgrammePreview({
      snapshot: snapshot(programme, body), desired: programme, predecessor_contract: predecessorContract,
      unmanaged_projection_migrations: { children: { '360': migration } },
      stale_projection_adjudication_verifier: authorityVerifier,
    });
    assert.equal(preview.ok, false);
    assert.equal(preview.reason, reason);
  });
}

test('malformed adjudication grant fails closed', () => {
  const programme = model('QUEUED');
  const body = withLegacy(programme, '## Status\n\n`PLANNED`');
  const preview = reconciler.buildProgrammePreview({
    snapshot: snapshot(programme, body), desired: programme, predecessor_contract: predecessorContract,
    unmanaged_projection_migrations: { children: { '360': migrationFor(body, programme) } },
    stale_projection_adjudication_verifier({ assertion, binding }) {
      return { ok: true, grant: { ...binding, reference: assertion.reference, entity: { kind: 'child', number: 999 } } };
    },
  });
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'stale-projection-adjudication-rejected');
});

test('overlapping stale spans fail closed', () => {
  const programme = model('QUEUED');
  const body = withLegacy(programme, '## Status\n\n`PLANNED`');
  const migration = migrationFor(body, programme);
  migration.stale_spans.push({ ...migration.stale_spans[0] });
  const preview = reconciler.buildProgrammePreview({
    snapshot: snapshot(programme, body), desired: programme, predecessor_contract: predecessorContract,
    unmanaged_projection_migrations: { children: { '360': migration } },
    stale_projection_adjudication_verifier: authorityVerifier,
  });
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'stale-projection-migration-binding');
});

test('multiple recognised stale spans are normalized deterministically from unsorted input', () => {
  const programme = model('QUEUED');
  const status = '## Status';
  const gate = '## Unit 1B G3 CURRENT';
  const body = status + '\n\n`PLANNED`\n\n' + gate + '\n\nOld gate detail.\n' + childBody(programme);
  const statusReplacement = '## Historical status before managed programme adoption';
  const gateReplacement = '## Historical Unit 1B G3 record';
  const statusStart = body.indexOf(status);
  const gateStart = body.indexOf(gate);
  const resultingBody = statusReplacement + body.slice(status.length, gateStart) + gateReplacement + body.slice(gateStart + gate.length);
  const migration = {
    schema: 'toolkit.github-program.stale-projection-migration.v2',
    classification: 'STALE_PROGRAMME_PROJECTION', grammar: 'toolkit.github-program.stale-projection.v2',
    repository: programme.repository, programme_parent_issue: 240, entity: { kind: 'child', number: 360 },
    body_digest: reconciler.sha256(body),
    stale_spans: [
      { start: gateStart, end: gateStart + gate.length, digest: reconciler.sha256(gate), classification: 'LEGACY_CURRENT_GATE_HEADING', replacement: gateReplacement },
      { start: statusStart, end: statusStart + status.length, digest: reconciler.sha256(status), classification: 'LEGACY_STATUS_HEADING', replacement: statusReplacement },
    ],
    resulting_body_digest: reconciler.sha256(resultingBody),
    authority: { kind: 'WEB_ADJUDICATION', reference: AUTHORITY_REF, decision: 'SUPERSEDED_PROJECTION_TRANSFORM' },
  };
  const preview = reconciler.buildProgrammePreview({
    snapshot: snapshot(programme, body), desired: programme, predecessor_contract: predecessorContract,
    unmanaged_projection_migrations: { children: { '360': migration } },
    stale_projection_adjudication_verifier: authorityVerifier,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.operations[0].stale_projection_span_digests.length, 2);
  assert.equal(freshness(programme, preview.expected_snapshot.bodies.children['360']).ok, true);
});

test('recognised stale projection transforms exactly, preserves bytes, and reruns zero delta', () => {
  const programme = model('QUEUED');
  const ownerPrefix = 'Owner note stays byte-for-byte.\n\n';
  const historical = '\n\nHistorical evidence also stays.\n';
  const body = ownerPrefix + '## Status\n\n`PLANNED - BLOCKED BY S1`' + historical + childBody(programme);
  const migration = migrationFor(body, programme);
  let live = snapshot(programme, body);
  const runtime = reconciler.createProgrammeRuntime({
    predecessor_contract: predecessorContract,
    authority_verifier: applyAuthorityVerifier,
    stale_projection_adjudication_verifier: authorityVerifier,
    adapter: {
      inspectProgramme() { return JSON.parse(JSON.stringify(live)); },
      applyOperations(input) {
        live = { ...JSON.parse(JSON.stringify(input.expected_snapshot)), revision: 'revision-2' };
        return { ok: true, applied_count: input.operations.length };
      },
    },
  });
  const input = {
    repository: programme.repository,
    desired: programme,
    unmanaged_projection_migrations: { children: { '360': migration } },
  };
  const preview = runtime.preview(input);
  assert.equal(preview.ok, true);
  assert.equal(preview.operations.filter((entry) => entry.stale_projection_migration).length, 1);
  const resulting = preview.expected_snapshot.bodies.children['360'];
  assert.ok(resulting.startsWith(ownerPrefix));
  assert.match(resulting, /Historical evidence also stays\./);
  assert.match(resulting, /## Historical status before managed programme adoption/);
  assert.match(resulting, /PLANNED - BLOCKED BY S1/);
  assert.equal(freshness(programme, resulting).ok, true);

  const applied = runtime.apply({
    preview,
    authority: { granted: true, preview_id: preview.preview_id, expected_revision: preview.current_revision, reference: AUTHORITY_REF },
  });
  assert.equal(applied.ok, true);
  const rerun = runtime.preview(input);
  assert.equal(rerun.code, 'PROGRAMME_ZERO_DELTA');
  assert.equal(rerun.operations.length, 0);
});

test('portable good fixture permits additive and historical content; bad fixture rejects competing truth', () => {
  const programme = model('QUEUED');
  const good = withLegacy(programme, '## Repository-specific detail\n\nAdditive owner content.\n\n## Historical evidence\n\nThe old G3 CURRENT receipt is retained.');
  const bad = withLegacy(programme, '## Repository-specific detail\n\nAdditive owner content.\n\n## Status\n\n`PLANNED - BLOCKED BY S1`');
  assert.equal(freshness(programme, good).ok, true);
  assert.equal(freshness(programme, bad).ok, false);
});
