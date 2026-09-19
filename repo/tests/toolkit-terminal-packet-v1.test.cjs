'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const kernel = require('../scripts/toolkit-controller-kernel.cjs');

const candidate = {
  pr: 422,
  head: '1'.repeat(40),
  tree: '2'.repeat(40),
  base: { ref: 'main', sha: '3'.repeat(40) },
};
const binding = {
  run_id: 'run-c1',
  repository: 'weijunswj/ai-agent-toolkit',
  controller_revision: 'af14f91b0f6335212003a37a5119f233489e598f',
  lock: 'DL-C1-CONTROLLER-KERNEL-DELIVERY-CONTRACT-008',
  gate: 'G3',
  candidate,
};

function makePacket(overrides = {}) {
  return kernel.createTerminalPacket({
    ...binding,
    outcome: 'success',
    process: { exit_code: 0, completed: true },
    findings: [],
    observations: [{ name: 'hosted_ci', value: 'pending', availability: 'observed' }],
    qualifications: ['Draft PR only; no merge or live provider operation.'],
    blockers: [],
    verdict: 'PASS',
    next_state: { state: 'TERMINAL', next_admissible_action: 'WEB_RECONCILE_PACKET' },
    evidence: {
      complete: true,
      manifest_id: 'manifest:c1',
      items: [{ id: 'base', digest: '4'.repeat(64), kind: 'git', summary: 'Exact canonical base evidence.' }],
    },
    packet_id: 'terminal-packet-c1',
    packet_reference: 'terminal-packet:c1',
    created_at: '2026-09-18T00:00:00.000Z',
    ...overrides,
  });
}

test('worker process success without a terminal packet is incomplete', () => {
  const missing = kernel.evaluateWorkerCompletion({
    process: { status: 'completed', exit_code: 0, completed: true },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'TERMINAL_PACKET_INCOMPLETE');
  assert.equal(missing.terminal, false);
});

test('terminal packet is self-sufficient, typed, and process-bound', () => {
  const created = makePacket();
  assert.equal(created.ok, true, created.code);
  assert.equal(created.code, 'TERMINAL_PACKET_DRAFT_CREATED');
  assert.equal(kernel.validateTerminalPacket(created.packet).ok, false);
  assert.equal(kernel.validateTerminalPacket(created.packet, { allowDraft: true }).ok, true);
  assert.equal(created.packet.process.status, 'completed');
  assert.equal(created.packet.replay.durable, false);
  assert.equal(created.packet.replay.worker_rerun_required, true);
  assert.equal(created.packet.packet_reference, created.packet.replay.retrieval_key);
  assert.equal(created.identity.id, 'terminal-packet-c1');

  const completed = kernel.evaluateWorkerCompletion({
    process: { status: 'completed', exit_code: 0, completed: true },
    packet: created.packet,
    expected: binding,
  });
  assert.equal(completed.ok, false);
  assert.equal(completed.terminal, false);
  assert.equal(completed.code, 'TERMINAL_PACKET_INCOMPLETE');

  const malformedNested = structuredClone(created.packet);
  malformedNested.findings.push({ id: 'bad', severity: 'info', summary: 'bad', disposition: 'observed', extra: true });
  malformedNested.packet_digest = kernel.digestValue(Object.fromEntries(Object.entries(malformedNested).filter(([key]) => key !== 'packet_digest')));
  assert.equal(kernel.validateTerminalPacket(malformedNested).code, 'TERMINAL_PACKET_INCOMPLETE');
});

test('durable packet replay uses identity and never reruns the worker', () => {
  const created = makePacket();
  assert.equal(created.ok, true, created.code);
  const store = kernel.createPacketStore();
  const durable = kernel.persistTerminalPacket({ store, packet: created.packet, expected: binding });
  assert.equal(durable.ok, true, durable.code);
  assert.notEqual(durable.identity.digest, created.identity.digest);
  let workerRuns = 0;
  const replayed = kernel.replayTerminalPacket({
    store,
    identity: durable.identity,
    expected: binding,
  });
  assert.equal(replayed.ok, true, replayed.code);
  assert.equal(replayed.worker_rerun_required, false);
  assert.deepEqual(replayed.identity, durable.identity);
  assert.equal(workerRuns, 0);

  const gate = kernel.admitNextGate({
    packet: replayed.packet,
    packet_identity: durable.identity,
    live: binding,
    verify_applicability: () => true,
  });
  assert.equal(gate.ok, true, gate.code);
  assert.deepEqual(gate.identity, durable.identity);

  const liveMismatch = kernel.admitNextGate({
    packet: replayed.packet,
    packet_identity: durable.identity,
    live: { ...binding, gate: 'G4' },
  });
  assert.equal(liveMismatch.ok, false);
  assert.equal(liveMismatch.code, 'LIVE_APPLICABILITY_UNAVAILABLE');

  assert.equal(kernel.admitNextGate({ packet: created.packet, live: binding }).code, 'TERMINAL_PACKET_INCOMPLETE');
  assert.equal(kernel.admitNextGate({ packet: replayed.packet, live: binding }).code, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
  assert.equal(kernel.admitNextGate({
    packet: replayed.packet,
    packet_identity: durable.identity,
    live: { ...binding, candidate: undefined },
  }).code, 'LIVE_APPLICABILITY_UNAVAILABLE');
  assert.equal(kernel.admitNextGate({
    packet: replayed.packet,
    packet_identity: durable.identity,
    live: {},
  }).code, 'LIVE_APPLICABILITY_UNAVAILABLE');
  assert.equal(kernel.admitNextGate({
    packet: replayed.packet,
    packet_identity: durable.identity,
    live: { ...binding, run_id: 'other-run' },
  }).code, 'LIVE_APPLICABILITY_UNAVAILABLE');
});

test('truncated, digest-mismatched, and identity-mismatched packets fail closed', () => {
  const created = makePacket();
  assert.equal(created.ok, true, created.code);
  const store = kernel.createPacketStore();
  const durable = kernel.persistTerminalPacket({ store, packet: created.packet, expected: binding });
  assert.equal(durable.ok, true, durable.code);
  const truncated = kernel.parseTerminalPacket(JSON.stringify(durable.packet).slice(0, -4));
  assert.equal(truncated.ok, false);
  assert.equal(truncated.code, 'TERMINAL_PACKET_INCOMPLETE');

  const digestMismatch = structuredClone(durable.packet);
  digestMismatch.verdict = 'HOLD';
  assert.equal(kernel.validateTerminalPacket(digestMismatch).code, 'TERMINAL_PACKET_DIGEST_MISMATCH');

  const identityMismatch = kernel.evaluateWorkerCompletion({
    process: { status: 'completed', exit_code: 0, completed: true },
    packet: durable.packet,
    expected: { ...binding, run_id: 'other-run' },
  });
  assert.equal(identityMismatch.ok, false);
  assert.equal(identityMismatch.code, 'TERMINAL_PACKET_IDENTITY_MISMATCH');
});
