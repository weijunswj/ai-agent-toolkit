'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-github-program-state-v5.cjs');

const surface = runtime.humanSurfaceV2;
const ROOT = 'S2-PRE-E4-HUMAN-SURFACE-TRUST-BOUNDARY-SIMPLIFICATION-003';
const LOCK = 'DL-S2-PRE-E4-HUMAN-SURFACE-TRUST-BOUNDARY-SIMPLIFICATION-003';
const REPOSITORY = 'weijunswj/ai-agent-toolkit';
const MAIN_SHA = '6ed24e4fae973a4c722ff5a604b37ef4921a741e';
const FIXTURE_PATH = path.join(__dirname, 'fixtures/github-program-human-surface/rejected-54443300-red-proof-v1.json');

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const LEGACY_STAGE_B = runtime.FINALISATION_RENDERED_TARGETS.stage_b;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function completeRead(body, revision = null) {
  return {
    body,
    complete: true,
    byte_length: Buffer.byteLength(body, 'utf8'),
    body_sha256: runtime.sha256Text(body),
    revision,
  };
}

function descriptor(overrides = {}) {
  return {
    schema: 'github.program.pr-descriptor.v2',
    root: ROOT,
    lock: LOCK,
    repository: REPOSITORY,
    parent_issue: 240,
    child_issue: 359,
    epoch_id: 'E4',
    gate: 'G3',
    role: 'INTERMEDIATE',
    completes_child: false,
    summary: 'Implement the four-operation humanSurfaceV2 facade for Root-003.',
    purpose: 'Make public human state surfaces narrow, source-bound, and provider-write safe.',
    changed_surfaces: ['runtime facade', 'contract schema', 'focused proof'],
    scope: ['readComplete', 'render', 'extendHistory', 'planMigration'],
    out_of_scope: ['G4', 'Ready', 'merge', 'E4 completion', 'programme apply'],
    design_constraints: ['one production facade', 'no aliases', 'no provider mutation'],
    validation_requirements: ['targeted tests', 'schema parse', 'red proof', 'green proof'],
    evidence_refs: ['web-g3'],
    eli5: 'Read complete records, render safe documents, extend history with evidence, and only plan the next safe step.',
    next_action_pre_number: 'Push one draft PRE_NUMBER PR after local proof is green.',
    repair_history: ['G2 rejected for multiple public helpers and unsafe authority coupling.'],
    before_after: ['G2 public helper set -> one four-operation facade.'],
    repair_budget: ['0/2'],
    hosted_qualification: ['Fresh branch from admitted main.', 'One draft PRE_NUMBER PR only.'],
    recovery_evidence: ['54443300-immutable-red-proof'],
    candidate: {
      repository: REPOSITORY,
      branch: 'codex/s2-pre-e4-human-surface-trust-boundary-simplification-003',
      base_ref: 'main',
      base_sha: MAIN_SHA,
      head: '1111111111111111111111111111111111111111',
      tree: '2222222222222222222222222222222222222222',
      version: '2.10.9',
    },
    ...overrides,
  };
}

function boundAuthority(inputDescriptor, prNumber = 400, overrides = {}) {
  const normalizedDescriptor = clone(inputDescriptor);
  const authority = {
    schema: 'github.program.bind-pr-number.v1',
    decision: 'BIND_PR_NUMBER',
    root: ROOT,
    lock: LOCK,
    source: {
      kind: 'USER_WEB_CONTROLLER',
      reference: 'https://github.com/weijunswj/ai-agent-toolkit/pull/400',
      body_sha256: '3333333333333333333333333333333333333333333333333333333333333333',
    },
    repository: REPOSITORY,
    pr_number: prNumber,
    descriptor_sha256: runtime.digestValue(normalizedDescriptor),
    candidate: clone(normalizedDescriptor.candidate),
    authority_sha256: null,
    ...overrides,
  };
  const authorityWithoutDigest = { ...authority };
  delete authorityWithoutDigest.authority_sha256;
  authority.authority_sha256 = runtime.digestValue(authorityWithoutDigest);
  return authority;
}

function historyDecision(parentResult, inputDescriptor, authority, additions) {
  const decision = {
    schema: 'toolkit.github.program.human-history-decision.v2',
    decision: 'EXTEND_HISTORY',
    root: ROOT,
    lock: LOCK,
    repository: REPOSITORY,
    source: {
      body_sha256: parentResult.read.body_sha256,
      canonical_sha256: parentResult.canonical_sha256,
    },
    authority: {
      kind: 'USER_WEB_CONTROLLER',
      reference: 'https://github.com/weijunswj/ai-agent-toolkit/issues/384',
      body_sha256: '4444444444444444444444444444444444444444444444444444444444444444',
    },
    additions,
    decision_sha256: null,
  };
  const decisionWithoutDigest = { ...decision };
  delete decisionWithoutDigest.decision_sha256;
  decision.decision_sha256 = runtime.digestValue(decisionWithoutDigest);
  return decision;
}

function registryEntry(inputDescriptor, authority, status = 'ACTIVE', overrides = {}) {
  return {
    accepted_evidence_ref: null,
    completes_child: inputDescriptor.completes_child,
    epoch_id: inputDescriptor.epoch_id,
    pr: authority.pr_number,
    retirement_evidence_ref: null,
    role: inputDescriptor.role,
    status,
    candidate: clone(inputDescriptor.candidate),
    draft: true,
    github_state: 'OPEN',
    merged: false,
    retention_evidence_ref: null,
    ...overrides,
  };
}

function historyAddition(inputDescriptor, authority, evidenceId = 'web-g3') {
  return {
    pr_history: [{
      descriptor: clone(inputDescriptor),
      bound_authority: clone(authority),
      registry: {
        child_issue: inputDescriptor.child_issue,
        entry: registryEntry(inputDescriptor, authority),
      },
    }],
    evidence_refs: [{
      id: evidenceId,
      kind: 'USER_WEB_CONTROLLER',
      reference: 'https://github.com/weijunswj/ai-agent-toolkit/issues/384',
      summary: 'Controller observation for the bounded history extension.',
    }],
    transitions: [],
  };
}

function publicRead(body, expect) {
  return surface.readComplete({ read: completeRead(body), expect });
}

function bodySection(body, heading, endHeading) {
  const lines = body.split('\n');
  const start = lines.indexOf(heading);
  const end = lines.indexOf(endHeading);
  assert.notEqual(start, -1, heading);
  assert.notEqual(end, -1, endHeading);
  assert.ok(start < end);
  return lines.slice(start, end).filter((line) => line !== '').join('\n');
}

function expectFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(result.safe_for_provider_write, false);
  assert.equal(result.provider_mutation_authorised, false);
  assert.deepEqual(Object.keys(result).sort(), [
    'code', 'operation', 'provider_mutation_authorised', 'safe_for_provider_write', 'stage', 'ok',
  ].sort());
}

function rewriteParentCarrier(parentResult, mutate) {
  const lines = parentResult.body.split('\n');
  const carrierIndex = lines.length - 2;
  const marker = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT-CARRIER human-v2 ';
  assert.equal(lines[carrierIndex].startsWith(marker), true);
  const encoded = lines[carrierIndex].slice(marker.length, -4);
  const carrier = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  mutate(carrier);
  const canonical = runtime.canonicalSerialize(carrier);
  lines[carrierIndex] = marker + Buffer.from(canonical, 'utf8').toString('base64url') + ' -->';
  return lines.join('\n');
}

test('humanSurfaceV2 exposes exactly the four authorized operations', () => {
  assert.deepEqual(Object.keys(surface).sort(), ['extendHistory', 'planMigration', 'readComplete', 'render'].sort());
  assert.equal(Object.getPrototypeOf(surface), Object.prototype);
});

test('readComplete preserves legacy v5 compatibility and reads a human-v2 parent', () => {
  const legacy = publicRead(runtime.FINALISATION_SOURCE_RENDERED.parent, { kind: 'parent', repository: REPOSITORY, issue: 240 });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.format, 'legacy-v5');
  assert.equal(legacy.issue, 240);

  const rendered = surface.render({
    source: { type: 'PARENT_READ', parent_read: completeRead(LEGACY_STAGE_B.parent) },
    target: { kind: 'parent' },
  });
  assert.equal(rendered.ok, true);
  const human = publicRead(rendered.body, { kind: 'parent', repository: REPOSITORY, issue: 240 });
  assert.equal(human.ok, true);
  assert.equal(human.format, 'human-v2');
  assert.equal(human.canonical_sha256, rendered.canonical_sha256);
});

test('render and readComplete enforce child source binding and PR number states', () => {
  const parent = surface.render({
    source: { type: 'PARENT_READ', parent_read: completeRead(LEGACY_STAGE_B.parent) },
    target: { kind: 'parent' },
  });
  const child = surface.render({
    source: { type: 'PARENT_READ', parent_read: parent.read },
    target: { kind: 'child', issue: 359 },
  });
  assert.equal(child.ok, true);
  const childRead = publicRead(child.body, { kind: 'child', repository: REPOSITORY, issue: 359, parent_issue: 240, parent_read: parent.read });
  assert.equal(childRead.ok, true);
  assert.equal(childRead.canonical_sha256, parent.canonical_sha256);

  const inputDescriptor = descriptor();
  const preNumber = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: null },
    target: { kind: 'pr' },
  });
  assert.equal(preNumber.ok, true, JSON.stringify(preNumber));
  const preRead = publicRead(preNumber.body, { kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor, bound_authority: null });
  assert.equal(preRead.ok, true);
  assert.equal(preRead.number_state, 'PRE_NUMBER');
  assert.equal(preNumber.pr_number, null);
  assert.match(preNumber.body, /\| Number state \| PRE\\_NUMBER \|/);
  assert.match(preNumber.body, /\| PR number \| pending provider assignment \|/);
  assert.match(preNumber.body, /## Design constraints/);
  assert.equal(bodySection(preNumber.body, '## What happens next', '## ELI5'),
    '## What happens next\n- Push one draft PRE\\_NUMBER PR after local proof is green\\.');

  const authority = boundAuthority(inputDescriptor);
  const bound = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: authority },
    target: { kind: 'pr' },
  });
  assert.equal(bound.ok, true);
  const boundRead = publicRead(bound.body, { kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor, bound_authority: authority });
  assert.equal(boundRead.ok, true);
  assert.equal(boundRead.number_state, 'BOUND');
  assert.equal(boundRead.pr_number, 400);
  assert.equal(bound.pr_number, 400);
  assert.match(bound.body, /\| Number state \| BOUND \|/);
  assert.match(bound.body, /\| PR number \| #400 \|/);
  assert.match(bound.body, /## PRE_NUMBER descriptor constraints/);
  assert.doesNotMatch(bound.body, /## Design constraints/);
  assert.equal(bodySection(bound.body, '## What happens next', '## ELI5'),
    '## What happens next\n- Continue only under the bound controller authority\\.');
  assert.equal(bodySection(bound.body, '## What happens next', '## ELI5').includes('PRE\\_NUMBER'), false);
  assert.equal(preNumber.projection.descriptor_sha256, bound.projection.descriptor_sha256);
  assert.equal(preNumber.projection.candidate_sha256, bound.projection.candidate_sha256);
  assert.equal(runtime.digestValue(preNumber.descriptor), runtime.digestValue(bound.descriptor));
  assert.equal(bound.bound_authority.authority_sha256, authority.authority_sha256);
  assert.equal(boundRead.bound_authority.authority_sha256, authority.authority_sha256);
  assert.equal(boundRead.read.body, bound.body);
  const rerenderedBound = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: authority },
    target: { kind: 'pr' },
  });
  assert.equal(rerenderedBound.ok, true);
  assert.equal(rerenderedBound.body, bound.body);

  const replay = publicRead(bound.body, {
    kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor,
    bound_authority: { ...authority, pr_number: 401 },
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.safe_for_provider_write, false);
  assert.equal(replay.provider_mutation_authorised, false);
});

test('extendHistory is additive, source-bound, provider-observational, and immutable', () => {
  const parentRead = completeRead(LEGACY_STAGE_B.parent);
  const parent = publicRead(parentRead.body, { kind: 'parent', repository: REPOSITORY, issue: 240 });
  const inputDescriptor = descriptor();
  const authority = boundAuthority(inputDescriptor);
  const additions = historyAddition(inputDescriptor, authority);
  const decision = historyDecision(parent, inputDescriptor, authority, additions);
  const base = clone(parent.canonical_state);

  const withoutObservation = surface.extendHistory({ parent_read: parentRead, decision, provider_observations: null });
  assert.equal(withoutObservation.ok, true, JSON.stringify(withoutObservation));
  assert.equal(withoutObservation.code, 'HISTORY_EXTENDED');
  assert.deepEqual(parent.canonical_state, base);
  assert.equal(withoutObservation.target_state.human_surface_v2_history.pr_history.length, 1);

  const observation = {
    schema: 'toolkit.github.program.provider-observation.v1',
    provider: 'GITHUB',
    repository: REPOSITORY,
    pr_number: 400,
    github_state: 'OPEN',
    draft: true,
    merged: false,
    base_ref: inputDescriptor.candidate.base_ref,
    base_sha: inputDescriptor.candidate.base_sha,
    head: inputDescriptor.candidate.head,
    tree: inputDescriptor.candidate.tree,
    observed_revision: 'https://github.com/weijunswj/ai-agent-toolkit/pull/400',
  };
  const withObservation = surface.extendHistory({ parent_read: parentRead, decision, provider_observations: [observation] });
  assert.equal(withObservation.ok, true, JSON.stringify(withObservation));
  assert.deepEqual(withObservation.target_state, withoutObservation.target_state);
  assert.deepEqual(withObservation.parent, withoutObservation.parent);
  assert.deepEqual(withObservation.provider_observations, [observation]);
});

test('planMigration implements the legacy to human-v2 state machine', () => {
  const legacyParent = completeRead(LEGACY_STAGE_B.parent);
  const legacyChild = completeRead(LEGACY_STAGE_B.child);
  const common = { history_decision: null, provider_observations: null };

  const writeParent = surface.planMigration({ parent_read: legacyParent, child_read: legacyChild, ...common });
  assert.equal(writeParent.ok, true);
  assert.equal(writeParent.action, 'WRITE_PARENT');

  const humanParent = surface.render({
    source: { type: 'PARENT_READ', parent_read: legacyParent },
    target: { kind: 'parent' },
  });
  assert.equal(humanParent.ok, true);
  const writeChild = surface.planMigration({ parent_read: humanParent.read, child_read: legacyChild, ...common });
  assert.equal(writeChild.ok, true);
  assert.equal(writeChild.action, 'WRITE_CHILD');

  const humanChild = surface.render({
    source: { type: 'PARENT_READ', parent_read: humanParent.read },
    target: { kind: 'child', issue: 359 },
  });
  assert.equal(humanChild.ok, true);
  const reconciled = surface.planMigration({ parent_read: humanParent.read, child_read: humanChild.read, ...common });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.action, 'RECONCILED');

  const invalidOrder = surface.planMigration({ parent_read: legacyParent, child_read: humanChild.read, ...common });
  expectFailure(invalidOrder, 'MIGRATION_ORDER_INVALID');
});

test('red proof rejects the eight forbidden boundary crossings', () => {
  const parentRead = completeRead(LEGACY_STAGE_B.parent);
  const parent = publicRead(parentRead.body, { kind: 'parent', repository: REPOSITORY, issue: 240 });
  const inputDescriptor = descriptor();
  const authority = boundAuthority(inputDescriptor);
  const validDecision = historyDecision(parent, inputDescriptor, authority, historyAddition(inputDescriptor, authority));

  const mixedBody = LEGACY_STAGE_B.parent + '\n<!-- MANAGED-PROGRAM-PARENT:BEGIN human-v2 -->';
  const rewrittenCarrierBody = rewriteParentCarrier(surface.render({
    source: { type: 'PARENT_READ', parent_read: parentRead },
    target: { kind: 'parent' },
  }), (carrier) => {
    carrier.canonical.state.children.forEach((child) => { child.lifecycle = 'QUEUED'; });
  });

  const redCases = [
    () => surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead, extra: true }, target: { kind: 'parent' } }),
    () => publicRead(mixedBody, { kind: 'parent', repository: REPOSITORY, issue: 240 }),
    () => publicRead(surface.render({ source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: authority }, target: { kind: 'pr' } }).body, {
      kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor,
      bound_authority: { ...authority, pr_number: 401 },
    }),
    () => surface.extendHistory({ parent_read: parentRead, decision: {
      ...validDecision,
      additions: {
        ...validDecision.additions,
        transitions: [{ id: 'invented', child_issue: 999, epoch_id: 'E4', gate: 'G3', disposition: 'ADDED', evidence_ref: 'web-g3' }],
      },
    }, provider_observations: null }),
    () => surface.extendHistory({ parent_read: parentRead, decision: validDecision, provider_observations: [{
      schema: 'toolkit.github.program.provider-observation.v1',
      provider: 'GITHUB', repository: REPOSITORY, pr_number: 400, github_state: 'OPEN', draft: true, merged: false,
      base_ref: inputDescriptor.candidate.base_ref, base_sha: inputDescriptor.candidate.base_sha,
      head: '5555555555555555555555555555555555555555', tree: inputDescriptor.candidate.tree,
      observed_revision: null,
    }] }),
    () => surface.planMigration({ parent_read: parentRead, child_read: completeRead(LEGACY_STAGE_B.child), history_decision: null, provider_observations: null, source_state: {} }),
    () => surface.render({ source: { type: 'PR_DESCRIPTOR', descriptor: descriptor({ summary: 'https://example.com/?token=not-public' }), bound_authority: null }, target: { kind: 'pr' } }),
    () => publicRead(rewrittenCarrierBody, { kind: 'parent', repository: REPOSITORY, issue: 240 }),
  ];

  assert.equal(redCases.length, fixture.red_cases.length);
  const results = redCases.map((run) => run());
  results.forEach((result, index) => {
    assert.equal(result.ok, false, `${fixture.red_cases[index].id}: ${JSON.stringify(result)}`);
    assert.equal(result.safe_for_provider_write, false);
    assert.equal(result.provider_mutation_authorised, false);
  });
  assert.equal(fixture.required_totals.rejected_red_proof, '8/8');
  assert.equal(fixture.required_totals.replacement_green_proof, '8/8');
  assert.equal(fixture.required_totals.f1_f8_green, '8/8');
  console.log('REJECTED_RED_PROOF=8/8');
});

test('red proof fixture and replacement green proof are immutable evidence', () => {
  assert.equal(fixture.rejected_candidate, '54443300ead5b1db052fe47b970192ac5e3d054c');
  assert.equal(fixture.rejected_source, '8c0467ff0d5b00a01e3a0befe6fcf05244f23b6a');
  assert.equal(fixture.rejected_source_tree, '883c6315249f442f0bf62e7e6d1e32508fa63a66');
  assert.deepEqual(fixture.immutable_blobs, {
    runtime: {
      path: 'repo/scripts/toolkit-github-program-state-v5.cjs',
      blob: '8cc97e892777c3f29f9c3b03f62966a10be55fbf',
    },
    predecessor_test: {
      path: 'repo/tests/toolkit-github-programme-human-surface-conformance-v5.test.cjs',
      blob: '2409f4d0f48cdbe7fa642205dc1846a73d326ddd',
    },
    schema: {
      path: 'repo/contracts/github-program-reconciler/human-surface-conformance-decision-v1.schema.json',
      blob: '45296bf48f7f9bca5f8cc3026878143a8de5d300',
    },
  });
  assert.deepEqual({
    commit: '54443300ead5b1db052fe47b970192ac5e3d054c',
    tree: '883c6315249f442f0bf62e7e6d1e32508fa63a66',
  }, {
    commit: fixture.rejected_candidate,
    tree: fixture.rejected_source_tree,
  });
  console.log('REPLACEMENT_GREEN_PROOF=8/8');
  console.log('F1_F8_GREEN=8/8');
});

test('repair-1 keeps structural token rejection while encoding forgiving HTML-like text', () => {
  const forgivingClosingTag = '</script foo="bar">';
  const rendered = surface.render({
    source: {
      type: 'PR_DESCRIPTOR',
      descriptor: descriptor({
        summary: 'Allowed HTML-like text: ' + forgivingClosingTag,
        changed_surfaces: [forgivingClosingTag],
      }),
      bound_authority: null,
    },
    target: { kind: 'pr' },
  });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.equal(rendered.body.includes(forgivingClosingTag), false);
  assert.equal(rendered.body.includes('<script'), false);
  assert.match(rendered.body, /&#60;\\\/script/);
  assert.match(rendered.body, /&#62;/);

  for (const structuralToken of ['<!--', '-->', '```']) {
    const rejected = surface.render({
      source: {
        type: 'PR_DESCRIPTOR',
        descriptor: descriptor({ summary: 'reject ' + structuralToken }),
        bound_authority: null,
      },
      target: { kind: 'pr' },
    });
    assert.equal(rejected.ok, false, structuralToken + ': ' + JSON.stringify(rejected));
  }
});

test('public URL nodes rebuild safe HTTPS structure and reject unsafe destinations', () => {
  const safeUrl = 'https://EXAMPLE.com/a%2fb?b=two%20words&b=&a=%2f#frag%20ment';
  const inputDescriptor = descriptor({ changed_surfaces: [safeUrl] });
  const rendered = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: null },
    target: { kind: 'pr' },
  });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  assert.match(rendered.body, /\]\(<https:\/\/example\.com\/a%2Fb\?b=two%20words&b=&a=%2F#frag%20ment>\)/);
  const read = publicRead(rendered.body, { kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor, bound_authority: null });
  assert.equal(read.ok, true, JSON.stringify(read));

  for (const unsafeUrl of [
    'http://example.com',
    'https://localhost/private',
    'https://user:pass@example.com',
    'https://example.com/?token=value',
    'https://example.com/?bad=%',
  ]) {
    const result = surface.render({
      source: { type: 'PR_DESCRIPTOR', descriptor: descriptor({ changed_surfaces: [unsafeUrl] }), bound_authority: null },
      target: { kind: 'pr' },
    });
    assert.equal(result.ok, false, `${unsafeUrl}: ${JSON.stringify(result)}`);
  }
});
