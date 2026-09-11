'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-github-program-state-v5.cjs');

const surface = runtime.humanSurfaceV2;
const ROOT = 'S2-PRE-E4-HUMAN-SURFACE-VALIDATION-PROOF-INTEGRITY-005';
const LOCK = 'DL-S2-PRE-E4-HUMAN-SURFACE-VALIDATION-PROOF-INTEGRITY-005';
const REPOSITORY = 'weijunswj/ai-agent-toolkit';
const MAIN_SHA = '6ed24e4fae973a4c722ff5a604b37ef4921a741e';
const PROOF_FIXTURE_PATH = path.join(__dirname, 'fixtures/github-program-human-surface/root-005-executable-proof-matrix-v1.json');

const proofFixture = JSON.parse(fs.readFileSync(PROOF_FIXTURE_PATH, 'utf8'));
const fixture = proofFixture.historical_reference;
const LEGACY_STAGE_B = runtime.FINALISATION_RENDERED_TARGETS.stage_b;
const RECEIPT_TOKEN = Symbol('root005-execution-receipt');
let proofRun = null;

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
    summary: 'Implement the four-operation humanSurfaceV2 facade for Root-005.',
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
    recovery_evidence: ['54443300-immutable-red-proof-immutable'],
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

function bodySectionToEnd(body, heading) {
  const lines = body.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, heading);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('<!-- '));
  assert.notEqual(end, -1);
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

function proofFamily(id) {
  const family = proofFixture.families.find((item) => item.id === id);
  assert.ok(family, id);
  return family;
}

function validateProofFixture() {
  assert.deepEqual(Object.keys(proofFixture).sort(), [
    '$schema', 'schema', 'root', 'lock', 'version', 'historical_reference', 'families', 'execution_contract',
  ].sort());
  assert.equal(proofFixture.schema, 'toolkit.github.program.root-005-executable-proof-matrix.v1');
  assert.equal(proofFixture.root, ROOT);
  assert.equal(proofFixture.lock, LOCK);
  assert.equal(proofFixture.version, '2.10.9');
  assert.equal(proofFixture.historical_reference.immutable, true);
  assert.equal(proofFixture.historical_reference.metadata_totals_are_not_receipts, true);
  assert.equal(Object.prototype.hasOwnProperty.call(proofFixture, 'required_totals'), false);
  assert.deepEqual(proofFixture.families.map((item) => item.id), [
    'REJECTED_RED_PROOF', 'REPLACEMENT_GREEN_PROOF', 'F1_F8_GREEN',
  ]);
  assert.deepEqual(proofFixture.families.map((item) => item.order), [1, 2, 3]);
  for (const family of proofFixture.families) {
    assert.equal(family.cases.length, 8, family.id);
    assert.deepEqual(family.cases.map((item) => item.id), Array.from({ length: 8 }, (_, index) => family.case_prefix + (index + 1)));
    assert.equal(new Set(family.cases.map((item) => item.id)).size, 8);
    for (const item of family.cases) {
      assert.equal(typeof item.entrypoint, 'string');
      assert.equal(typeof item.assertion, 'string');
      assert.equal(item.expected.ok, family.mode === 'rejected' ? false : true);
    }
  }
  assert.equal(proofFixture.execution_contract.receipt_schema, 'toolkit.github.program.executable-proof-receipt.v1');
  assert.equal(proofFixture.execution_contract.required_cases_per_family, 8);
  assert.deepEqual(proofFixture.execution_contract.receipt_fields, [
    'schema', 'family', 'id', 'entrypoint', 'executed', 'status', 'result', 'assertion', 'receipt_sha256',
  ]);
}

function historyContext() {
  const parentRead = completeRead(LEGACY_STAGE_B.parent);
  const parent = publicRead(parentRead.body, { kind: 'parent', repository: REPOSITORY, issue: 240 });
  assert.equal(parent.ok, true, JSON.stringify(parent));
  const inputDescriptor = descriptor();
  const authority = boundAuthority(inputDescriptor);
  const decision = historyDecision(parent, inputDescriptor, authority, historyAddition(inputDescriptor, authority));
  return { parentRead, parent, inputDescriptor, authority, decision };
}

function providerObservation(inputDescriptor, overrides = {}) {
  return {
    schema: 'github.program.provider-observation.v1',
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
    ...overrides,
  };
}

function historyInput(withObservation = false) {
  const context = historyContext();
  return {
    context,
    input: {
      parent_read: context.parentRead,
      decision: context.decision,
      provider_observations: withObservation ? [providerObservation(context.inputDescriptor)] : null,
    },
  };
}

function assertSurfaceResult(result, spec) {
  assert.equal(result.ok, spec.expected.ok, spec.id + ': ok');
  assert.equal(result.code, spec.expected.code, spec.id + ': code');
  assert.equal(result.stage, spec.expected.stage, spec.id + ': stage');
  assert.equal(result.operation, spec.entrypoint, spec.id + ': operation');
  assert.equal(result.safe_for_provider_write, false, spec.id + ': provider write');
  assert.equal(result.provider_mutation_authorised, false, spec.id + ': provider mutation');
  if (Object.prototype.hasOwnProperty.call(spec.expected, 'number_state')) assert.equal(result.number_state, spec.expected.number_state, spec.id + ': number state');
  if (Object.prototype.hasOwnProperty.call(spec.expected, 'action')) assert.equal(result.action, spec.expected.action, spec.id + ': action');
}

function assertRenderArtifact(artifact, kind, number) {
  assert.deepEqual(Object.keys(artifact).sort(), ['kind', 'repository', 'number', 'action', 'body', 'read_record', 'digests'].sort());
  assert.equal(artifact.kind, kind);
  assert.equal(artifact.repository, REPOSITORY);
  assert.equal(artifact.number, number);
  assert.equal(typeof artifact.action, 'string');
  assert.ok((kind === 'parent' ? ['CONTINUE_CURRENT_CHILD', 'AWAIT_PROGRAMME_FINALITY', 'PROGRAMME_COMPLETE'] : [
    'CHILD_COMPLETE', 'BLOCKING_HOLD', 'WAIT_DEPENDENCIES', 'AWAIT_CHILD_AUTHORITY', 'CONTINUE_ACTIVE_GATE',
    'AMEND_REQUIRED', 'REPLACEMENT_REQUIRED', 'AWAIT_EPOCH_AUTHORITY', 'BEGIN_OR_CONTINUE_EPOCH', 'AWAIT_CHILD_FINALITY',
  ]).includes(artifact.action));
  assert.equal(artifact.read_record.body, artifact.body);
  assert.equal(artifact.read_record.complete, true);
  assert.equal(artifact.read_record.body_sha256, artifact.digests.complete_body_sha256);
  assert.equal(artifact.read_record.byte_length, Buffer.byteLength(artifact.body, 'utf8'));
  assert.equal(artifact.read_record.body_sha256, runtime.sha256Text(artifact.body));
  assert.deepEqual(Object.keys(artifact.digests).sort(), [
    'complete_body_sha256', 'public_prose_sha256', 'managed_block_sha256', 'carrier_sha256', 'projection_sha256',
    'canonical_sha256', 'descriptor_sha256', 'candidate_sha256', 'bound_authority_sha256',
  ].sort());
  for (const [key, value] of Object.entries(artifact.digests)) {
    if (['canonical_sha256', 'descriptor_sha256', 'candidate_sha256', 'bound_authority_sha256'].includes(key) && value === null) continue;
    assert.match(value, /^[a-f0-9]{64}$/, key);
  }
}

function assertHistoryArtifacts(result) {
  assertRenderArtifact(result.parent, 'parent', 240);
  assert.equal(result.children.length, result.target_state.children.length);
  const parentRead = publicRead(result.parent.body, { kind: 'parent', repository: REPOSITORY, issue: 240 });
  assert.equal(parentRead.ok, true, JSON.stringify(parentRead));
  assert.equal(parentRead.canonical_sha256, result.target_canonical_sha256);
  for (const artifact of result.children) {
    assertRenderArtifact(artifact, 'child', artifact.number);
    const childRead = publicRead(artifact.body, {
      kind: 'child', repository: REPOSITORY, issue: artifact.number, parent_issue: 240, parent_read: result.parent.read_record,
    });
    assert.equal(childRead.ok, true, JSON.stringify(childRead));
    assert.equal(childRead.canonical_sha256, result.target_canonical_sha256);
  }
}

function proofCase(familyId, caseDef) {
  const parentRead = completeRead(LEGACY_STAGE_B.parent);
  const parentExpectation = { kind: 'parent', repository: REPOSITORY, issue: 240 };
  let run;
  let assertCase = () => {};

  if (familyId === 'REJECTED_RED_PROOF') {
    if (caseDef.id === 'R1') {
      run = () => surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead, extra: true }, target: { kind: 'parent' } });
    } else if (caseDef.id === 'R2') {
      run = () => publicRead(LEGACY_STAGE_B.parent + '\n<!-- MANAGED-PROGRAM-PARENT:BEGIN human-v2 -->', parentExpectation);
    } else if (caseDef.id === 'R3') {
      run = () => {
        const inputDescriptor = descriptor();
        const rendered = surface.render({
          source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: boundAuthority(inputDescriptor) },
          target: { kind: 'pr' },
        });
        return publicRead(rendered.body, {
          kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor, bound_authority: boundAuthority(inputDescriptor, 401),
        });
      };
    } else if (caseDef.id === 'R4') {
      run = () => {
        const context = historyContext();
        return surface.extendHistory({
          parent_read: context.parentRead,
          decision: { ...context.decision, additions: { ...context.decision.additions, transitions: [{ id: 'invented', child_issue: 999, epoch_id: 'E4', gate: 'G3', disposition: 'ADDED', evidence_ref: 'web-g3' }] } },
          provider_observations: null,
        });
      };
    } else if (caseDef.id === 'R5') {
      run = () => {
        const context = historyContext();
        return surface.extendHistory({ parent_read: context.parentRead, decision: context.decision, provider_observations: [
          providerObservation(context.inputDescriptor, { head: '5555555555555555555555555555555555555555' }),
        ] });
      };
    } else if (caseDef.id === 'R6') {
      run = () => surface.planMigration({ parent_read: parentRead, child_read: completeRead(LEGACY_STAGE_B.child), history_decision: null, provider_observations: null, source_state: {} });
    } else if (caseDef.id === 'R7') {
      run = () => surface.render({
        source: { type: 'PR_DESCRIPTOR', descriptor: descriptor({ summary: 'https://example.com/?token=not-public' }), bound_authority: null },
        target: { kind: 'pr' },
      });
    } else if (caseDef.id === 'R8') {
      run = () => {
        const rendered = surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
        const rewritten = rewriteParentCarrier(rendered, (carrier) => {
          carrier.canonical.state.children.forEach((child) => { child.lifecycle = 'QUEUED'; });
        });
        return publicRead(rewritten, parentExpectation);
      };
    }
  } else if (familyId === 'REPLACEMENT_GREEN_PROOF') {
    if (caseDef.id === 'G1') {
      run = () => publicRead(parentRead.body, parentExpectation);
    } else if (caseDef.id === 'G2') {
      run = () => surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
    } else if (caseDef.id === 'G3') {
      run = () => surface.render({ source: { type: 'PR_DESCRIPTOR', descriptor: descriptor(), bound_authority: null }, target: { kind: 'pr' } });
    } else if (caseDef.id === 'G4') {
      run = () => {
        const inputDescriptor = descriptor();
        return surface.render({ source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: boundAuthority(inputDescriptor) }, target: { kind: 'pr' } });
      };
    } else if (caseDef.id === 'G5') {
      run = () => surface.extendHistory(historyInput(false).input);
      assertCase = assertHistoryArtifacts;
    } else if (caseDef.id === 'G6') {
      run = () => surface.extendHistory(historyInput(true).input);
      assertCase = (result) => {
        assertHistoryArtifacts(result);
        assert.deepEqual(result.provider_observations, [providerObservation(descriptor())]);
      };
    } else if (caseDef.id === 'G7') {
      run = () => surface.planMigration({ parent_read: parentRead, child_read: completeRead(LEGACY_STAGE_B.child), history_decision: null, provider_observations: null });
    } else if (caseDef.id === 'G8') {
      run = () => {
        const humanParent = surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
        return surface.planMigration({ parent_read: humanParent.read, child_read: completeRead(LEGACY_STAGE_B.child), history_decision: null, provider_observations: null });
      };
    }
  } else if (familyId === 'F1_F8_GREEN') {
    if (caseDef.id === 'F1') {
      run = () => {
        const parent = surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
        const child = surface.render({ source: { type: 'PARENT_READ', parent_read: parent.read }, target: { kind: 'child', issue: 359 } });
        const childRead = publicRead(child.body, { kind: 'child', repository: REPOSITORY, issue: 359, parent_issue: 240, parent_read: parent.read });
        assert.equal(childRead.ok, true, JSON.stringify(childRead));
        assert.equal(childRead.canonical_sha256, parent.canonical_sha256);
        return child;
      };
    } else if (caseDef.id === 'F2') {
      run = () => surface.extendHistory(historyInput(false).input);
      assertCase = (result) => {
        assertHistoryArtifacts(result);
        assert.deepEqual(result.target_state.children.map((child) => child.lifecycle), [
          'COMPLETED', 'CURRENT', 'QUEUED', 'QUEUED', 'QUEUED', 'QUEUED',
        ]);
      };
    } else if (caseDef.id === 'F3') {
      run = () => surface.extendHistory(historyInput(true).input);
      assertCase = (result) => {
        assertHistoryArtifacts(result);
        assert.deepEqual(result.provider_observations, [providerObservation(descriptor())]);
      };
    } else if (caseDef.id === 'F4') {
      run = () => publicRead(parentRead.body, parentExpectation);
    } else if (caseDef.id === 'F5') {
      run = () => surface.render({
        source: { type: 'PR_DESCRIPTOR', descriptor: descriptor({ changed_surfaces: ['https://EXAMPLE.com/a%2fb?b=two%20words&b=&a=%2f#frag%20ment'] }), bound_authority: null },
        target: { kind: 'pr' },
      });
      assertCase = (result) => {
        const destinationMatch = result.body.match(/\]\(<([^>]+)>\)/);
        assert.ok(destinationMatch);
        const destination = new URL(destinationMatch[1]);
        assert.equal(destination.protocol, 'https:');
        assert.equal(destination.hostname, 'example.com');
        assert.equal(destination.pathname, '/a%2Fb');
        assert.equal(destination.search, '?b=two%20words&b=&a=%2F');
        assert.equal(destination.hash, '#frag%20ment');
        assert.equal(publicRead(result.body, { kind: 'pr', repository: REPOSITORY, descriptor: descriptor({ changed_surfaces: ['https://EXAMPLE.com/a%2fb?b=two%20words&b=&a=%2f#frag%20ment'] }), bound_authority: null }).ok, true);
      };
    } else if (caseDef.id === 'F6') {
      run = () => surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
      assertCase = (result) => {
        assert.equal(result.projection.programme_action, 'CONTINUE_CURRENT_CHILD');
        assert.equal(result.projection.current_child.action, 'AWAIT_EPOCH_AUTHORITY');
        assert.notEqual(result.projection.programme_action, 'PROGRAMME_COMPLETE');
      };
    } else if (caseDef.id === 'F7') {
      run = () => {
        const parent = surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
        return surface.render({ source: { type: 'PARENT_READ', parent_read: parent.read }, target: { kind: 'child', issue: 359 } });
      };
      assertCase = (result) => {
        assert.equal(publicRead(result.body, { kind: 'child', repository: REPOSITORY, issue: 359, parent_issue: 240, parent_read: completeRead(runtime.FINALISATION_RENDERED_TARGETS.stage_a.parent) }).ok, false);
        const parent = surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
        assert.equal(publicRead(result.body, { kind: 'child', repository: REPOSITORY, issue: 359, parent_issue: 240, parent_read: parent.read }).ok, true);
      };
    } else if (caseDef.id === 'F8') {
      run = () => surface.render({ source: { type: 'PARENT_READ', parent_read: parentRead }, target: { kind: 'parent' } });
      assertCase = (result) => {
        const read = publicRead(result.body, parentExpectation);
        assert.equal(read.ok, true, JSON.stringify(read));
        assert.equal(read.format, 'human-v2');
      };
    }
  }

  assert.equal(typeof run, 'function', familyId + '/' + caseDef.id);
  return { ...caseDef, run, assertCase };
}

function executeProofCase(family, caseDef) {
  const spec = proofCase(family.id, caseDef);
  assert.equal(spec.entrypoint, caseDef.entrypoint, family.id + '/' + caseDef.id + ': entrypoint mapping');
  const result = spec.run();
  assertSurfaceResult(result, spec);
  spec.assertCase(result);
  const payload = {
    schema: proofFixture.execution_contract.receipt_schema,
    family: family.id,
    id: caseDef.id,
    entrypoint: caseDef.entrypoint,
    executed: true,
    status: 'PASS',
    result: { ok: result.ok, code: result.code, stage: result.stage },
    assertion: { name: caseDef.assertion, expected: clone(caseDef.expected), passed: true },
  };
  const receipt = Object.freeze({ ...payload, receipt_sha256: runtime.digestValue(payload), [RECEIPT_TOKEN]: RECEIPT_TOKEN });
  console.log('ROOT005_EXECUTION_RECEIPT=' + JSON.stringify(receipt));
  return receipt;
}

function aggregateProofFamily(family, receipts) {
  if (!Array.isArray(receipts) || receipts.length !== family.cases.length) return null;
  const expectedKeys = proofFixture.execution_contract.receipt_fields.slice().sort();
  for (let index = 0; index < family.cases.length; index += 1) {
    const receipt = receipts[index];
    const expected = family.cases[index];
    if (!receipt || receipt[RECEIPT_TOKEN] !== RECEIPT_TOKEN || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expectedKeys)) return null;
    if (receipt.schema !== proofFixture.execution_contract.receipt_schema || receipt.family !== family.id
      || receipt.id !== expected.id || receipt.entrypoint !== expected.entrypoint || receipt.executed !== true || receipt.status !== 'PASS') return null;
    if (!receipt.result || JSON.stringify(Object.keys(receipt.result).sort()) !== JSON.stringify(['code', 'ok', 'stage'])) return null;
    if (!receipt.assertion || JSON.stringify(Object.keys(receipt.assertion).sort()) !== JSON.stringify(['expected', 'name', 'passed'])) return null;
    if (receipt.assertion.name !== expected.assertion || !receipt.assertion.passed || JSON.stringify(receipt.assertion.expected) !== JSON.stringify(expected.expected)) return null;
    if (receipt.result.ok !== expected.expected.ok || receipt.result.code !== expected.expected.code || receipt.result.stage !== expected.expected.stage) return null;
    const unsigned = { ...receipt };
    delete unsigned.receipt_sha256;
    if (runtime.digestValue(unsigned) !== receipt.receipt_sha256) return null;
  }
  return { family: family.id, passed: receipts.length, total: family.cases.length };
}

function proofFamiliesForRun() {
  const mode = process.env.ROOT005_PROOF_MODE || 'complete';
  if (mode === 'metadata-only') return { mode, families: [] };
  assert.equal(mode, 'complete');
  const selected = process.env.ROOT005_PROOF_FAMILY;
  if (!selected) return { mode, families: proofFixture.families };
  return { mode, families: [proofFamily(selected)] };
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

test('complete-read false records fail at COMPLETE_READ while malformed types fail at INPUT', () => {
  const body = LEGACY_STAGE_B.parent;
  const incomplete = { ...completeRead(body), complete: false };
  expectFailure(surface.readComplete({ read: incomplete, expect: { kind: 'parent', repository: REPOSITORY, issue: 240 } }), 'COMPLETE_READ_INVALID');
  const malformed = { ...completeRead(body), complete: 'false' };
  expectFailure(surface.readComplete({ read: malformed, expect: { kind: 'parent', repository: REPOSITORY, issue: 240 } }), 'INPUT_KEY_UNEXPECTED');
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
  assert.match(preNumber.body, /### Design constraints/);
  assert.equal(bodySectionToEnd(preNumber.body, '## What happens next'),
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
  assert.match(bound.body, /## Descriptor at creation \(historical evidence only\)/);
  assert.match(bound.body, /### Design constraints/);
  assert.equal(bodySectionToEnd(bound.body, '## What happens next'),
    '## What happens next\n- Continue only under the bound controller authority\\.');
  assert.equal(bodySectionToEnd(bound.body, '## What happens next').includes('PRE\\_NUMBER'), false);
  assert.equal(preNumber.projection.structural_provenance.descriptor_sha256, bound.projection.structural_provenance.descriptor_sha256);
  assert.equal(preNumber.projection.structural_provenance.candidate_sha256, bound.projection.structural_provenance.candidate_sha256);
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

test('Root-005 preserves the accepted Root-004 descriptor projection architecture', () => {
  const inputDescriptor = descriptor({
    summary: 'SentinelSummary',
    purpose: 'SentinelPurpose',
    changed_surfaces: ['SentinelChangedSurface'],
    scope: ['SentinelScope'],
    out_of_scope: ['SentinelOutOfScope'],
    design_constraints: ['SentinelDesignConstraint'],
    validation_requirements: ['SentinelValidationRequirement'],
    evidence_refs: ['SentinelEvidenceReference'],
    eli5: 'SentinelEli5',
    next_action_pre_number: 'SentinelPreNumberAction',
    repair_history: ['SentinelRepairHistory'],
    before_after: ['SentinelBeforeAfter'],
    repair_budget: ['SentinelRepairBudget'],
    hosted_qualification: ['SentinelHostedQualification'],
    recovery_evidence: ['SentinelRecoveryEvidence'],
  });
  const preNumber = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: null },
    target: { kind: 'pr' },
  });
  assert.equal(preNumber.ok, true, JSON.stringify(preNumber));
  assert.equal(preNumber.projection.schema, 'github.program.pr-phase-projection.v1');
  assert.equal(preNumber.projection.phase, 'PRE_NUMBER');
  assert.equal(preNumber.projection.descriptor_at_creation.next_action_pre_number, inputDescriptor.next_action_pre_number);
  assert.deepEqual(preNumber.projection.omitted, []);

  const authority = boundAuthority(inputDescriptor);
  const bound = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: inputDescriptor, bound_authority: authority },
    target: { kind: 'pr' },
  });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  const historicalStart = bound.body.indexOf('## Descriptor at creation (historical evidence only)');
  assert.notEqual(historicalStart, -1);
  const currentBody = bound.body.slice(0, historicalStart);
  for (const sentinel of [
    'SentinelSummary', 'SentinelPurpose', 'SentinelChangedSurface', 'SentinelScope',
    'SentinelOutOfScope', 'SentinelDesignConstraint', 'SentinelValidationRequirement',
    'SentinelEvidenceReference', 'SentinelEli5', 'SentinelRepairHistory',
    'SentinelBeforeAfter', 'SentinelRepairBudget', 'SentinelHostedQualification',
    'SentinelRecoveryEvidence',
  ]) {
    assert.equal(currentBody.includes(sentinel), false, sentinel);
    assert.ok(bound.body.indexOf(sentinel, historicalStart) >= historicalStart, sentinel);
  }
  assert.equal(bound.body.includes('SentinelPreNumberAction'), false);
  assert.equal(bound.body.includes('next_action_pre_number'), false);
  assert.equal(bound.projection.descriptor_at_creation.next_action_pre_number, null);
  assert.deepEqual(bound.projection.omitted, [{ field: 'next_action_pre_number', reason: 'BOUND_NONDISPLAYABLE' }]);
  assert.ok(bound.projection.typed_nodes.every((item) => item.zone !== 'CURRENT_DERIVED'
    || item.field.startsWith('current_derived.')));
  assert.ok(bound.projection.typed_nodes.filter((item) => item.zone === 'DESCRIPTOR_AT_CREATION').length > 0);

  const carrierMarker = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR-CARRIER human-v2 ';
  const carrierLine = bound.body.split('\n').find((line) => line.startsWith(carrierMarker));
  assert.ok(carrierLine);
  const carrier = JSON.parse(Buffer.from(carrierLine.slice(carrierMarker.length, -4), 'base64url').toString('utf8'));
  assert.deepEqual(carrier.projection, {
    schema: 'github.program.pr-phase-projection.v1',
    phase: 'BOUND',
    digest: bound.projection_sha256,
  });
  assert.equal(JSON.stringify(carrier).includes('SentinelPreNumberAction'), false);
  const reread = publicRead(bound.body, { kind: 'pr', repository: REPOSITORY, descriptor: inputDescriptor, bound_authority: authority });
  assert.equal(reread.ok, true, JSON.stringify(reread));
  assert.equal(Object.prototype.hasOwnProperty.call(reread.descriptor, 'next_action_pre_number'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(reread.projection.descriptor_at_creation, 'next_action_pre_number'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(reread.projection, 'omitted'), false);
  assert.equal(JSON.stringify(reread).includes('SentinelPreNumberAction'), false);

  const phaseNeutral = surface.render({
    source: {
      type: 'PR_DESCRIPTOR',
      descriptor: descriptor({ summary: 'Sentinel wording mentions provider gate review check Draft Ready merge finality and PRE_NUMBER.' }),
      bound_authority: authority,
    },
    target: { kind: 'pr' },
  });
  assert.equal(phaseNeutral.ok, false, 'authority must match the phase-neutral control descriptor');
  const neutralDescriptor = descriptor({ summary: 'Sentinel wording mentions provider gate review check Draft Ready merge finality and PRE_NUMBER.' });
  const neutralAuthority = boundAuthority(neutralDescriptor);
  const neutralBound = surface.render({
    source: { type: 'PR_DESCRIPTOR', descriptor: neutralDescriptor, bound_authority: neutralAuthority },
    target: { kind: 'pr' },
  });
  assert.equal(neutralBound.ok, true, JSON.stringify(neutralBound));
  assert.ok(neutralBound.body.includes('Sentinel wording mentions provider gate review check Draft Ready merge finality'));
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
    schema: 'github.program.provider-observation.v1',
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

  const oldSchema = surface.extendHistory({ parent_read: parentRead, decision, provider_observations: [{ ...observation, schema: 'toolkit.github.program.provider-observation.v1' }] });
  expectFailure(oldSchema, 'PROVIDER_ASSERTION_INVALID');
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

test('Root-005 executable proof emits aggregates only for executed families', () => {
  validateProofFixture();
  const selection = proofFamiliesForRun();
  if (selection.mode === 'metadata-only') {
    proofRun = { mode: selection.mode, families: [], receipts: new Map() };
    return;
  }
  const receipts = new Map();
  for (const family of selection.families) {
    const familyReceipts = family.cases.map((caseDef) => executeProofCase(family, caseDef));
    const aggregate = aggregateProofFamily(family, familyReceipts);
    assert.deepEqual(aggregate, { family: family.id, passed: 8, total: 8 });
    receipts.set(family.id, familyReceipts);
    console.log(family.id + '=8/8');
  }
  proofRun = { mode: selection.mode, families: selection.families, receipts };
});

test('Root-005 proof aggregation fails closed for false-positive receipt paths', (t) => {
  if (!proofRun || proofRun.mode !== 'complete' || proofRun.families.length !== 3) {
    t.skip('requires the complete three-family proof run');
    return;
  }
  const family = proofFamily('REJECTED_RED_PROOF');
  const baseline = proofRun.receipts.get(family.id);
  const copyReceipt = (receipt, changes = {}, preserveDigest = false) => {
    const copy = { ...receipt, ...changes };
    if (!preserveDigest) {
      delete copy.receipt_sha256;
      copy.receipt_sha256 = runtime.digestValue(copy);
    }
    return Object.freeze({ ...copy, [RECEIPT_TOKEN]: RECEIPT_TOKEN });
  };
  const probes = {
    metadata_only: [],
    family_selective: baseline.slice(0, 1),
    missing: baseline.slice(0, -1),
    duplicate: [...baseline.slice(0, -1), baseline[0]],
    unknown: [copyReceipt(baseline[0], { id: 'R999' }), ...baseline.slice(1)],
    failed_case: [copyReceipt(baseline[0], { status: 'FAIL' }), ...baseline.slice(1)],
    entrypoint_mismatch: [copyReceipt(baseline[0], { entrypoint: 'readComplete' }), ...baseline.slice(1)],
    metadata_tampering: [copyReceipt(baseline[0], { assertion: { ...baseline[0].assertion, name: 'tampered' } }, true), ...baseline.slice(1)],
  };
  for (const [name, receipts] of Object.entries(probes)) assert.equal(aggregateProofFamily(family, receipts), null, name);
});

test('Root-005 retains immutable rejected-proof provenance as non-authoritative reference', () => {
  assert.deepEqual(proofFixture.historical_reference, {
    path: 'repo/tests/fixtures/github-program-human-surface/rejected-54443300-red-proof-v1.json',
    immutable: true,
    rejected_candidate: '54443300ead5b1db052fe47b970192ac5e3d054c',
    rejected_source: '8c0467ff0d5b00a01e3a0befe6fcf05244f23b6a',
    rejected_source_tree: '883c6315249f442f0bf62e7e6d1e32508fa63a66',
    immutable_blobs: {
      runtime: { path: 'repo/scripts/toolkit-github-program-state-v5.cjs', blob: '8cc97e892777c3f29f9c3b03f62966a10be55fbf' },
      predecessor_test: { path: 'repo/tests/toolkit-github-programme-human-surface-conformance-v5.test.cjs', blob: '2409f4d0f48cdbe7fa642205dc1846a73d326ddd' },
      schema: { path: 'repo/contracts/github-program-reconciler/human-surface-conformance-decision-v1.schema.json', blob: '45296bf48f7f9bca5f8cc3026878143a8de5d300' },
    },
    metadata_totals_are_not_receipts: true,
  });
});

test('legacy red proof retains exact boundary-crossing assertions', () => {
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
      bound_authority: boundAuthority(inputDescriptor, 401),
    }),
    () => surface.extendHistory({ parent_read: parentRead, decision: {
      ...validDecision,
      additions: {
        ...validDecision.additions,
        transitions: [{ id: 'invented', child_issue: 999, epoch_id: 'E4', gate: 'G3', disposition: 'ADDED', evidence_ref: 'web-g3' }],
      },
    }, provider_observations: null }),
    () => surface.extendHistory({ parent_read: parentRead, decision: validDecision, provider_observations: [{
      schema: 'github.program.provider-observation.v1',
      provider: 'GITHUB', repository: REPOSITORY, pr_number: 400, github_state: 'OPEN', draft: true, merged: false,
      base_ref: inputDescriptor.candidate.base_ref, base_sha: inputDescriptor.candidate.base_sha,
      head: '5555555555555555555555555555555555555555', tree: inputDescriptor.candidate.tree,
      observed_revision: null,
    }] }),
    () => surface.planMigration({ parent_read: parentRead, child_read: completeRead(LEGACY_STAGE_B.child), history_decision: null, provider_observations: null, source_state: {} }),
    () => surface.render({ source: { type: 'PR_DESCRIPTOR', descriptor: descriptor({ summary: 'https://example.com/?token=not-public' }), bound_authority: null }, target: { kind: 'pr' } }),
    () => publicRead(rewrittenCarrierBody, { kind: 'parent', repository: REPOSITORY, issue: 240 }),
  ];

  const redFamily = proofFamily('REJECTED_RED_PROOF');
  assert.equal(redCases.length, redFamily.cases.length);
  const results = redCases.map((run) => run());
  results.forEach((result, index) => {
    const expected = redFamily.cases[index].expected;
    assert.equal(result.ok, expected.ok, `${redFamily.cases[index].id}: ${JSON.stringify(result)}`);
    assert.equal(result.code, expected.code, redFamily.cases[index].id);
    assert.equal(result.stage, expected.stage, redFamily.cases[index].id);
    assert.equal(result.safe_for_provider_write, false);
    assert.equal(result.provider_mutation_authorised, false);
  });
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
  assert.equal(fixture.immutable_blobs.runtime.blob.length, 40);
  assert.equal(fixture.immutable_blobs.predecessor_test.blob.length, 40);
  assert.equal(fixture.immutable_blobs.schema.blob.length, 40);
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
