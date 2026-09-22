'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const cleanupRoots = new Set();

function secureWindowsDirectory(root) {
  if (process.platform !== 'win32') return;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    '$ErrorActionPreference="Stop"',
    '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$icacls=Join-Path $env:SystemRoot "System32\\icacls.exe"',
    '& $icacls $env:GPR_TEST_ROOT "/inheritance:r" "/grant:r" ("*${sid}:(OI)(CI)F") "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null',
    'if ($LASTEXITCODE -ne 0) { throw "icacls-failed" }'
  ].join(';');
  const result = require('node:child_process').spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GPR_TEST_ROOT: root }
  });
  if (result.status !== 0) throw new Error(`Unable to secure test state root: ${result.stderr}`);
}

function stateRoot(prefix = 'authority-packet-') {
  const parent = path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'github-program-receipt', 'tests');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(parent, 0o700);
  const root = fs.mkdtempSync(path.join(parent, prefix));
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  secureWindowsDirectory(root);
  cleanupRoots.add(root);
  return root;
}

function options(root = stateRoot()) {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 435,
    child_issue: 435,
    stateRoot: root,
    repositoryRoot
  };
}

function sourceReference(seed = 'authority') {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    issue_number: 435,
    comment_id: 5772542748,
    node_id: `IC_${seed}`,
    author_login: 'weijunswj',
    updated_at: '2026-09-22T10:00:00.000Z',
    body_digest: runtime.digestValue({ seed, body: 'authority-packet-test' })
  };
}

function bindings(seed = 'packet') {
  const authority = sourceReference(seed);
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    parent_issue: 435,
    child_issue: 435,
    lane_id: 'c1-g3-leaf-a',
    human_owner: 'weijunswj',
    producer: {
      run: `run-${seed}`,
      lock: `lock-${seed}`,
      stage: 'G2',
      role: 'G2'
    },
    authority,
    governance: {
      repository: 'weijunswj/ai-agent-toolkit',
      main_commit: '1'.repeat(40),
      controller_blob: '2'.repeat(40),
      stack_registry_blob: '3'.repeat(40)
    },
    candidate: null,
    applicability: {
      scope_digest: runtime.digestValue({ seed, scope: 'c1' }),
      required_consumers: [{
        class: 'G3',
        dependency_id: 'g3-authority-consumer',
        scope_digest: runtime.digestValue({ seed, consumer: 'g3' })
      }],
      retain_through_child_finality: true,
      retain_through_candidate_finality: false
    }
  };
}

function packet(overrides = {}) {
  const packetBindings = overrides.bindings || bindings(overrides.seed || 'packet');
  const body = {
    verdict: 'HOLD',
    decision: 'The custody implementation remains pending downstream semantic admission integration.',
    findings: [{
      id: 'finding-custody',
      requirement: 'The packet must be durably retrievable by a fresh reader.',
      observed: 'The packet is complete and is tested against a disposable private store.',
      required: 'Retain the exact artifact and its identities.',
      consequence: 'A consumer cannot proceed without the durable predecessor.',
      disposition: 'NON_BLOCKING',
      evidence_ids: ['authority-source']
    }],
    qualifications: ['This fixture exercises custody only, not downstream admission.'],
    next_state: 'A parent integration must bind the packet to its semantic consumer.',
    sections: [
      { name: 'implementation_contract', text: 'The v4 extension stores the complete packet without changing v2 receipt semantics.' },
      { name: 'mutation_boundary', text: 'Only the explicitly initialised private custody store may receive this artifact.' },
      { name: 'oracle_matrix', text: 'Focused tests cover canonical values, identities, migration, persistence, and readback.' },
      { name: 'validation', text: 'The isolated test process verifies exact bytes and independent readback.' },
      { name: 'publication_boundary', text: 'No live system, GitHub mutation, or publication operation is performed.' }
    ],
    evidence_refs: [{ id: 'authority-source', kind: 'GITHUB_COMMENT', source: packetBindings.authority }],
    gate_contract_ir: null
  };
  return { schema: runtime.AUTHORITY_PACKET_SCHEMA_ID, bindings: packetBindings, body, ...overrides.packet };
}

function screening(packetValue) {
  const identities = runtime.authorityPacketIdentities(packetValue);
  return {
    packet_digest: identities.packet_digest,
    decision: 'ALLOW',
    policy_digest: runtime.digestValue('authority-packet-test-policy'),
    retention_policy_digest: runtime.digestValue('authority-packet-test-retention')
  };
}

function webDecision(packetValue, requiredConsumers = packetValue.bindings.applicability.required_consumers) {
  const identities = runtime.authorityPacketIdentities(packetValue);
  return {
    packet_id: identities.packet_id,
    packet_digest: identities.packet_digest,
    binding_digest: identities.binding_digest,
    web_source: structuredClone(packetValue.bindings.authority),
    disposition: 'ACCEPTED_FOR_CONSUMPTION',
    permitted_consumers: structuredClone(requiredConsumers),
    applicability: structuredClone(packetValue.bindings.applicability),
  };
}

function readers(packetValue, overrides = {}) {
  const packetBindings = packetValue.bindings;
  const result = {
    readAuthority: overrides.readAuthority || (() => ({
      authority: structuredClone(packetBindings.authority),
      required_consumers: structuredClone(packetBindings.applicability.required_consumers),
      later_controlling_comments: [],
    })),
    screenPacket: overrides.screenPacket || (() => screening(packetValue)),
    readWebDecision: overrides.readWebDecision || (() => webDecision(packetValue)),
    ...overrides
  };
  if (overrides.readBackfillSource) result.readBackfillSource = overrides.readBackfillSource;
  return result;
}

function producerAdmission(packetValue, overrides = {}) {
  return {
    bindings: structuredClone(packetValue.bindings),
    authority: structuredClone(packetValue.bindings.authority),
    producer: structuredClone(packetValue.bindings.producer),
    candidate: packetValue.bindings.candidate,
    screening: screening(packetValue),
    ...overrides
  };
}

function semanticGate(seed = 'loop', readerOverrides = {}, fixtureOptions = {}) {
  const packetBindings = bindings(`loop-${seed}`);
  const candidate = fixtureOptions.candidate === undefined ? packetBindings.candidate : fixtureOptions.candidate;
  packetBindings.candidate = candidate === null ? null : structuredClone(candidate);
  let required = fixtureOptions.noPredecessor === true ? [] : packetBindings.applicability.required_consumers;
  if (fixtureOptions.scope_digest) {
    required = required.map((item) => ({ ...item, scope_digest: fixtureOptions.scope_digest }));
  }
  packetBindings.applicability.required_consumers = structuredClone(required);
  const packetValue = packet({ bindings: packetBindings });
  const storeOptions = options(stateRoot(`authority-loop-${seed}-`));
  let current = null;
  let currentBodyDigest = runtime.digestValue({ seed, body: 'current' });
  const readersForGate = readers(packetValue, {
    readCandidate: () => candidate,
    readWebDecision: () => webDecision(packetValue, required),
    readCurrent: () => ({
      current,
      projection_digest: runtime.digestValue(current),
      body_digest: currentBodyDigest,
      revision: 1,
    }),
    readDispatchOutcome: ({ status, transport_result, transport_error }) => {
      const observed = status || (transport_error ? 'not-started' : 'confirmed');
      return {
        status: observed,
        transport_result,
        delayed_completion_excluded: observed === 'not-started',
      };
    },
    ...readerOverrides,
  });
  const store = runtime.initialiseAuthorityPacketStore(storeOptions, readersForGate);
  const persisted = store.persistAuthorityPacket(packetValue, producerAdmission(packetValue));
  store.bindWebPacketAcceptance(persisted.packet_id, readersForGate);
  const intent = {
    repository: packetValue.bindings.repository,
    parent_issue: packetValue.bindings.parent_issue,
    child_issue: packetValue.bindings.child_issue,
    lane_id: packetValue.bindings.lane_id,
    human_owner: packetValue.bindings.human_owner,
    consumer: {
      run: `semantic-${seed}`,
      lock: `lock-${seed}`,
      stage: 'G3',
      role: 'G3',
      scope_digest: fixtureOptions.scope_digest || required[0]?.scope_digest || runtime.digestValue({ seed, scope: 'consumer' }),
    },
    candidate: null,
    execution_binding: {
      semantic_run: null,
      receipt_run_id: null,
      loop_run_id: `loop-${seed}`,
      repository_id: 'b'.repeat(64),
      authorized_ref_digest: 'c'.repeat(64),
      current_authority_digest: 'd'.repeat(64),
    },
    predecessors: required.length === 0 ? [] : [{ packet_id: persisted.packet_id, dependency_id: required[0].dependency_id }],
    operation: 'loop',
  };
  current = store.buildCurrentPacketProjection(intent, readersForGate);
  store.confirmCurrentPacketProjection(current, readersForGate);
  return {
    store,
    consumer_intent: intent,
    trusted_readers: readersForGate,
    storeOptions,
    setCurrentBodyDigest(value) { currentBodyDigest = value; },
  };
}

let assuranceSequence = 0;

function assuranceCandidate(value = null) {
  if (value === null) return null;
  return {
    pr_number: 354,
    branch: 'c1-g3-assurance',
    base_ref: 'main',
    base_sha: value.base,
    head_sha: value.head,
    tree_sha: value.tree,
  };
}

function assuranceReceiptAdmission(overrides = {}) {
  const tuple = overrides.consumer && Object.hasOwn(overrides.consumer, 'candidate')
    ? overrides.consumer.candidate
    : { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40) };
  const gate = semanticGate(`assurance-${++assuranceSequence}`, {}, {
    candidate: assuranceCandidate(tuple),
    noPredecessor: overrides.dependency_state !== 'PREDECESSORS_VERIFIED',
    scope_digest: overrides.scope_digest || 'd'.repeat(64),
  });
  const result = gate.store.admitSemanticGate(gate.consumer_intent, gate.trusted_readers);
  return { store: gate.store, admission: result.admission };
}

function cleanup() {
  for (const root of cleanupRoots) fs.rmSync(root, { recursive: true, force: true });
  cleanupRoots.clear();
}

process.once('exit', cleanup);

module.exports = {
  bindings,
  cleanup,
  options,
  packet,
  producerAdmission,
  readers,
  repositoryRoot,
  screening,
  webDecision,
  sourceReference,
  semanticGate,
  assuranceReceiptAdmission,
  stateRoot
};
