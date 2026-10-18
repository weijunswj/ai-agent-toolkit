'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const gitBlob = (value) => crypto.createHash('sha1')
  .update(Buffer.from(`blob ${Buffer.byteLength(value)}\0`, 'utf8')).update(value).digest('hex');
const commit = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const base = 'c'.repeat(40);
const authority = {
  repository: 'example/toolkit', issue_number: 421, comment_id: 8801, node_id: 'IC_kw_fake_owner_8801',
  author_login: 'owner-example', updated_at: '2026-10-12T12:00:00.000Z', body_digest: 'd'.repeat(64)
};
const contractBytes = Buffer.from('synthetic contract revision\n');
const sourceBytes = Buffer.from('synthetic source revision\n');

function evidence(id, bytes, path) {
  return {
    id, kind: 'GIT_BLOB', repository: 'example/toolkit', commit,
    path, blob: gitBlob(bytes), content_digest: sha(bytes)
  };
}

function route(stage, role) {
  return {
    profile_id: 'owner-openai-default', requested_profile_id: 'owner-openai-default',
    stage, role, provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'max'
  };
}

function custody(evidenceId) {
  const core = { evidence_id: evidenceId, custody_id: `synthetic-custody-${evidenceId}`, retention_status: 'HELD' };
  return { ...core, custody_digest: receipt.digestValue(core) };
}

function makePacket() {
  const contractRef = evidence('contract-rev', contractBytes, 'contracts/contract.md');
  const sourceRef = evidence('source-rev', sourceBytes, 'src/worker.cjs');
  const evidenceRefs = [contractRef, sourceRef].sort((left, right) => left.id.localeCompare(right.id));
  const scopeDigest = 'e'.repeat(64);
  const bindings = {
    repository: 'example/toolkit', parent_issue: 461, child_issue: 421, lane_id: 'toolkit-v3-core',
    human_owner: 'owner-example',
    producer: { run: 'run-461-child-421', lock: 'lock-421', stage: 'G0', role: 'DISCOVERY_HELPER' },
    authority,
    governance: { repository: 'weijunswj/ai-agent-toolkit', main_commit: commit,
      controller_blob: gitBlob(Buffer.from('controller')), stack_registry_blob: gitBlob(Buffer.from('registry')) },
    candidate: { pr_number: 461, branch: 'toolkit/v3-core', base_ref: 'main', base_sha: base, head_sha: commit, tree_sha: tree },
    applicability: { scope_digest: scopeDigest,
      required_consumers: [{ class: 'G1', dependency_id: 'next-builder', scope_digest: scopeDigest }],
      retain_through_child_finality: false, retain_through_candidate_finality: false }
  };
  const checkpointUnsigned = {
    schema: receipt.RECOVERY_CHECKPOINT_V3_SCHEMA_ID,
    programme: { repository: bindings.repository, parent_issue: bindings.parent_issue,
      child_issue: bindings.child_issue, lane_id: bindings.lane_id },
    release: {
      contract_revision: { evidence_id: contractRef.id, repository: contractRef.repository, commit: contractRef.commit,
        path: contractRef.path, blob: contractRef.blob, content_digest: contractRef.content_digest },
      source_revision: { evidence_id: sourceRef.id, repository: sourceRef.repository, commit: sourceRef.commit,
        path: sourceRef.path, blob: sourceRef.blob, content_digest: sourceRef.content_digest }
    },
    candidate: { kind: 'COMMIT', pr_number: 461, branch: 'toolkit/v3-core', base_ref: 'main',
      base_sha: base, head_sha: commit, tree_sha: tree },
    route: route('G0', 'DISCOVERY_HELPER'),
    controller_decision_evidence_id: null,
    scope_authority: { scope_digest: scopeDigest, authority },
    evidence_ids: ['contract-rev', 'source-rev'],
    custody_refs: ['contract-rev', 'source-rev'].map(custody),
    environment: { os: 'linux', node: '24.14.0', toolkit_version: '3.0.0', profile_id: 'owner-openai-default' },
    results: [{ result_id: 'installed-qualification', status: 'UNRUN', summary: 'Installed qualification has not been run.', evidence_ids: [] }],
    owner_acceptance: { disposition: 'PENDING', owner_login: 'owner-example', evidence_id: null },
    writer: { state: 'UNKNOWN', pending_effects: [
      { effect_id: 'synthetic-effect-1', effect_digest: 'f'.repeat(64), state: 'UNKNOWN' }
    ], denials: [] },
    next_action: { action_id: 'run-builder', action: 'CONTINUE', route: route('G1', 'BUILDER'), evidence_ids: ['source-rev'] }
  };
  const recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(checkpointUnsigned);
  return {
    schema: receipt.AUTHORITY_PACKET_V3_SCHEMA_ID,
    bindings,
    body: {
      verdict: 'HOLD', decision: 'Checkpoint preserves the current recovery facts.', findings: [],
      qualifications: ['Owner acceptance is pending.'], next_state: 'Resume only after fresh admission.',
      sections: [
        { name: 'framing', text: 'Synthetic stage framing.' },
        { name: 'unknowns', text: 'Installed qualification is unrun.' },
        { name: 'evidence_questions', text: 'Re-read every immutable reference.' },
        { name: 'stop_condition', text: 'Stop when evidence or authority cannot be verified.' }
      ],
      evidence_refs: evidenceRefs, gate_contract_ir: null, recovery_checkpoint_v3
    }
  };
}

function makeStagePacket(stage, role, sectionNames) {
  const packet = structuredClone(makePacket());
  const scopeDigest = packet.bindings.applicability.scope_digest;
  const nextConsumer = { G0: 'G1', G1: 'G2', G2: 'G3' }[stage];
  packet.bindings.producer = { ...packet.bindings.producer, stage, role };
  packet.bindings.applicability.required_consumers = [
    { class: nextConsumer, dependency_id: `next-${nextConsumer.toLowerCase()}`, scope_digest: scopeDigest }
  ];
  packet.body.sections = sectionNames.map((name) => ({ name, text: `Synthetic ${name} evidence section.` }));
  const unsigned = Object.fromEntries(Object.entries(packet.body.recovery_checkpoint_v3)
    .filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)));
  unsigned.route = route(stage, role);
  unsigned.next_action.route = route(stage, role);
  packet.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
  return packet;
}

function packetError(operation, expectedCode) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function attachControllerDecisionReference(packet, kind = 'GIT_BLOB') {
  const bytes = Buffer.from('{"synthetic":"controller decision reference only"}');
  const id = 'controller-decision-ref';
  const reference = kind === 'GIT_BLOB'
    ? evidence(id, bytes, 'contracts/controller-decision.json')
    : { id, kind, source: authority };
  packet.body.evidence_refs.push(reference);
  packet.body.evidence_refs.sort((left, right) => left.id.localeCompare(right.id));
  const unsigned = Object.fromEntries(Object.entries(packet.body.recovery_checkpoint_v3)
    .filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)));
  unsigned.controller_decision_evidence_id = id;
  unsigned.evidence_ids = [...unsigned.evidence_ids, id].sort();
  unsigned.custody_refs = unsigned.evidence_ids.map(custody);
  packet.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
  return packet;
}

test('V3 recovery packet seals and validates a portable, honestly unrun checkpoint', () => {
  const packet = makePacket();
  const identities = receipt.authorityPacketIdentities(packet);
  assert.match(identities.packet_id, /^ap1-[a-f0-9]{64}$/);
  assert.equal(identities.packet.schema, 'toolkit.github-program.authority-packet.v3');
  assert.equal(identities.packet.body.recovery_checkpoint_v3.results[0].status, 'UNRUN');
  assert.equal(identities.packet.body.recovery_checkpoint_v3.owner_acceptance.disposition, 'PENDING');
  assert.equal(identities.packet.body.recovery_checkpoint_v3.route.role, 'DISCOVERY_HELPER');
  assert.equal(Object.hasOwn(identities.packet.body.recovery_checkpoint_v3.route, 'service_tier'), false);
});

test('V3 controller-decision pointer is exact custody-held GIT_BLOB evidence and survives stage continuation', () => {
  for (const [stage, role, sections] of [
    ['G0', 'DISCOVERY', ['framing', 'unknowns', 'evidence_questions', 'stop_condition']],
    ['G1', 'BUILDER', ['implementation', 'candidate_identity', 'validation_results', 'remaining_obligations']],
    ['G2', 'REVIEW_SCOPE', ['candidate_identity', 'coverage', 'findings_and_reproducers', 'validation_results', 'disposition']]
  ]) {
    const packet = attachControllerDecisionReference(makeStagePacket(stage, role, sections));
    const sealed = receipt.authorityPacketIdentities(packet).packet;
    assert.equal(sealed.body.recovery_checkpoint_v3.controller_decision_evidence_id, 'controller-decision-ref');
    assert.ok(sealed.body.recovery_checkpoint_v3.evidence_ids.includes('controller-decision-ref'));
    assert.equal(sealed.body.evidence_refs.find((reference) => reference.id === 'controller-decision-ref').kind, 'GIT_BLOB');
  }

  const absentCustody = attachControllerDecisionReference(makePacket());
  const unsigned = Object.fromEntries(Object.entries(absentCustody.body.recovery_checkpoint_v3)
    .filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)));
  unsigned.evidence_ids = unsigned.evidence_ids.filter((id) => id !== 'controller-decision-ref');
  unsigned.custody_refs = unsigned.custody_refs.filter((entry) => entry.evidence_id !== 'controller-decision-ref');
  absentCustody.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
  packetError(() => receipt.validateAuthorityPacket(absentCustody), 'GPR_PACKET_AUTHORITY_UNVERIFIED');

  packetError(() => receipt.validateAuthorityPacket(attachControllerDecisionReference(makePacket(), 'GITHUB_COMMENT')),
    'GPR_PACKET_AUTHORITY_UNVERIFIED');
});

test('V3 route preserves supported compatibility profile requests under a canonical profile', () => {
  const packet = structuredClone(makePacket());
  const unsigned = Object.fromEntries(Object.entries(packet.body.recovery_checkpoint_v3)
    .filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)));
  unsigned.route.requested_profile_id = 'owner-openai-continuous-v1';
  unsigned.next_action.route.requested_profile_id = 'owner-openai-continuous-v1';
  packet.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
  const stored = receipt.authorityPacketIdentities(packet).packet;
  assert.equal(stored.body.recovery_checkpoint_v3.route.profile_id, 'owner-openai-default');
  assert.equal(stored.body.recovery_checkpoint_v3.route.requested_profile_id, 'owner-openai-continuous-v1');
});

test('V1 historical packet remains accepted with its original closed body', () => {
  const v3 = makePacket();
  const packet = {
    schema: receipt.AUTHORITY_PACKET_SCHEMA_ID,
    bindings: {
      ...v3.bindings,
      producer: { run: 'legacy-run-421', lock: 'lock-421', stage: 'G1', role: 'G1' },
      applicability: { ...v3.bindings.applicability,
        required_consumers: [{ class: 'G2', dependency_id: 'legacy-consumer', scope_digest: 'e'.repeat(64) }] }
    },
    body: {
      verdict: 'HOLD', decision: 'Legacy historical packet.', findings: [], qualifications: [],
      next_state: 'Preserve history.',
      sections: [
        { name: 'causal_model', text: 'Legacy section one.' },
        { name: 'alternatives', text: 'Legacy section two.' },
        { name: 'invariants', text: 'Legacy section three.' },
        { name: 'architecture', text: 'Legacy section four.' },
        { name: 'assumptions', text: 'Legacy section five.' }
      ], evidence_refs: [], gate_contract_ir: null
    }
  };
  assert.equal(receipt.authorityPacketIdentities(packet).packet.schema, 'toolkit.github-program.authority-packet.v1');
  const legacyOwnerUat = structuredClone(packet);
  legacyOwnerUat.body.evidence_refs = [{ id: 'owner-uat', kind: 'OWNER_UAT', source: authority }];
  packetError(() => receipt.validateAuthorityPacket(legacyOwnerUat), 'GPR_PACKET_VALUE_INVALID');
});

test('V3 rejects malformed, partial, tampered, and source-mismatched recovery data', () => {
  const original = makePacket();
  const malformed = structuredClone(original);
  malformed.body.recovery_checkpoint_v3.unrecognized = true;
  malformed.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(
    Object.fromEntries(Object.entries(malformed.body.recovery_checkpoint_v3).filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)))
  );
  packetError(() => receipt.validateAuthorityPacket(malformed), 'GPR_PACKET_VALUE_INVALID');

  const partial = structuredClone(original);
  delete partial.body.recovery_checkpoint_v3.next_action;
  partial.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(
    Object.fromEntries(Object.entries(partial.body.recovery_checkpoint_v3).filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)))
  );
  packetError(() => receipt.validateAuthorityPacket(partial), 'GPR_PACKET_VALUE_INVALID');

  const tampered = structuredClone(original);
  tampered.body.recovery_checkpoint_v3.writer.pending_effects[0].effect_id = 'altered-effect';
  packetError(() => receipt.validateAuthorityPacket(tampered), 'GPR_PACKET_VALUE_INVALID');

  const mismatch = structuredClone(original);
  mismatch.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint({
    ...Object.fromEntries(Object.entries(mismatch.body.recovery_checkpoint_v3).filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key))),
    release: { ...mismatch.body.recovery_checkpoint_v3.release,
      contract_revision: { ...mismatch.body.recovery_checkpoint_v3.release.contract_revision, commit: '9'.repeat(40) } }
  });
  packetError(() => receipt.validateAuthorityPacket(mismatch), 'GPR_PACKET_VALUE_INVALID');
});

test('V3 rejects illegal stage-role pairs, service-tier injection, and evidence-free PASS rows', () => {
  const illegalRoute = structuredClone(makePacket());
  illegalRoute.body.recovery_checkpoint_v3.route = { ...illegalRoute.body.recovery_checkpoint_v3.route,
    stage: 'G2', role: 'DISCOVERY_HELPER' };
  illegalRoute.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(
    Object.fromEntries(Object.entries(illegalRoute.body.recovery_checkpoint_v3).filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)))
  );
  packetError(() => receipt.validateAuthorityPacket(illegalRoute), 'GPR_PACKET_VALUE_INVALID');

  const tier = structuredClone(makePacket());
  tier.body.recovery_checkpoint_v3.route.service_tier = 'semantic-worker';
  tier.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(
    Object.fromEntries(Object.entries(tier.body.recovery_checkpoint_v3).filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)))
  );
  packetError(() => receipt.validateAuthorityPacket(tier), 'GPR_PACKET_VALUE_INVALID');

  const unsupportedPass = structuredClone(makePacket());
  const checkpoint = Object.fromEntries(Object.entries(unsupportedPass.body.recovery_checkpoint_v3)
    .filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)));
  checkpoint.results[0] = { ...checkpoint.results[0], status: 'PASS' };
  unsupportedPass.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(checkpoint);
  packetError(() => receipt.validateAuthorityPacket(unsupportedPass), 'GPR_PACKET_VALUE_INVALID');
});

test('V3 accepted owner disposition requires a separately typed owner-UAT comment reference', () => {
  const makeAccepted = (kind) => {
    const packet = structuredClone(makePacket());
    const evidenceId = 'owner-uat';
    packet.body.evidence_refs.push({ id: evidenceId, kind, source: authority });
    packet.body.evidence_refs.sort((left, right) => left.id.localeCompare(right.id));
    const unsigned = Object.fromEntries(Object.entries(packet.body.recovery_checkpoint_v3)
      .filter(([key]) => !['checkpoint_id', 'checkpoint_digest'].includes(key)));
    unsigned.evidence_ids = ['contract-rev', evidenceId, 'source-rev'];
    unsigned.custody_refs = unsigned.evidence_ids.map(custody);
    unsigned.owner_acceptance = { disposition: 'ACCEPTED', owner_login: 'owner-example', evidence_id: evidenceId };
    packet.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
    return packet;
  };
  const accepted = makeAccepted('OWNER_UAT');
  assert.equal(receipt.authorityPacketIdentities(accepted).packet.body.recovery_checkpoint_v3.owner_acceptance.disposition, 'ACCEPTED');
  packetError(() => receipt.validateAuthorityPacket(makeAccepted('GITHUB_COMMENT')), 'GPR_PACKET_ACCEPTANCE_UNVERIFIED');
});

test('V3 preserves the two peer G2 reviewer roles without helper-role admission', () => {
  for (const role of ['REVIEW_SCOPE', 'REVIEW_EXECUTION']) {
    const packet = makeStagePacket('G2', role, [
      'candidate_identity', 'coverage', 'findings_and_reproducers', 'validation_results', 'disposition'
    ]);
    assert.equal(receipt.authorityPacketIdentities(packet).packet.bindings.producer.role, role);
  }
});

test('V3 G1/G2 use continuous builder and final-review sections, with no legacy design IR', () => {
  const builderSections = ['implementation', 'candidate_identity', 'validation_results', 'remaining_obligations'];
  const reviewSections = ['candidate_identity', 'coverage', 'findings_and_reproducers', 'validation_results', 'disposition'];
  const builder = makeStagePacket('G1', 'BUILDER', builderSections);
  assert.equal(receipt.authorityPacketIdentities(builder).packet.bindings.producer.stage, 'G1');

  const oldBuilder = makeStagePacket('G1', 'BUILDER', ['causal_model', 'alternatives', 'invariants', 'architecture', 'assumptions']);
  packetError(() => receipt.validateAuthorityPacket(oldBuilder), 'GPR_PACKET_VALUE_INVALID');
  const oldReview = makeStagePacket('G2', 'REVIEW_SCOPE', [
    'implementation_contract', 'mutation_boundary', 'oracle_matrix', 'validation', 'publication_boundary'
  ]);
  packetError(() => receipt.validateAuthorityPacket(oldReview), 'GPR_PACKET_VALUE_INVALID');

  const passingReview = makeStagePacket('G2', 'REVIEW_SCOPE', reviewSections);
  passingReview.body.verdict = 'PASS';
  const acceptedReview = receipt.authorityPacketIdentities(passingReview).packet;
  assert.equal(acceptedReview.body.gate_contract_ir, null);
  assert.equal(acceptedReview.body.recovery_checkpoint_v3.results[0].status, 'UNRUN');

  const legacyIr = structuredClone(passingReview);
  legacyIr.body.gate_contract_ir = { schema: 'toolkit.gate-contract-ir.v2' };
  packetError(() => receipt.validateAuthorityPacket(legacyIr), 'GPR_PACKET_VALUE_INVALID');
});

test('serialized caller data cannot act as a semantic-gate admission for recovery reads', () => {
  packetError(() => receipt.readCurrentRecoveryCheckpoint({}, {
    schema: 'toolkit.github-program.semantic-gate-admission.v1', consumer: { stage: 'G1', role: 'G1' }
  }), 'GPR_PACKET_ADMISSION_REQUIRED');
  packetError(() => receipt.readAdmittedAuthorityPackets({}, {
    schema: 'toolkit.github-program.semantic-gate-admission.v1', consumer: { stage: 'G2', role: 'G2' }
  }), 'GPR_PACKET_ADMISSION_REQUIRED');
});

module.exports = { makePacket, makeStagePacket };
