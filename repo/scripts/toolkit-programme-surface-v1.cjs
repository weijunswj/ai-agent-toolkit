#!/usr/bin/env node
'use strict';

const kernel = require('./toolkit-controller-kernel.cjs');

const SCHEMAS = Object.freeze({
  current: 'toolkit.controller.current.v1',
  admission: 'toolkit.controller.pr-admission.v1',
  bootstrap: 'toolkit.controller.bootstrap-plan.v1',
  programmeGraph: 'toolkit.controller.programme-graph.v1',
  programmeSnapshot: 'toolkit.controller.programme-snapshot.v1',
});
const PROGRAMME_GRAPH_KINDS = Object.freeze(['CHILD', 'OUTCOME']);
const PROGRAMME_GRAPH_LIFECYCLES = Object.freeze(['PLANNED', 'QUEUED', 'CURRENT', 'HELD', 'COMPLETED', 'RETIRED']);
const PROGRAMME_GRAPH_PR_STATES = Object.freeze(['OPEN', 'CLOSED', 'MERGED', 'UNKNOWN']);
const PROGRAMME_421_PROOF_OUTCOME_IDS = Object.freeze([
  'C1', 'C2', 'C3', 'S1', 'S2', 'H1', 'H2', 'H3', 'H4', 'W1', 'W2', 'D1', 'A1', 'A2', 'A3', 'A4', 'A5',
  'N1', 'N2', 'N3', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'V1', 'V2', 'Q',
]);
const PROGRAMME_421_PROOF_A1_COMPLETE_WHEN = 'Authoritative route identity is provider/model/reasoning plus exact stack/registry/stage/thread provenance; service treatment (tier, priority, standard, default or equivalent provider execution class) is non-authoritative and excluded from route selection, route digests, admission, stored-route checks, prompt requirements, gate contracts and correctness/finality claims; observed treatment is diagnostic-only with explicit provenance, and A2 consumes the tier-free route contract.';
const PROGRAMME_421_PROOF_SOURCE_HASHES = Object.freeze({
  foundation_body_sha256: '567c90114277700da83ddb0d5b92af562fd0706c45c95afd71731518f81ae92b',
  foundation_issue_and_comments_sha256: 'f492a1b3fa92967c3a6550860894072072f0b94b3645e8e00d339a6214f67a0b',
  canonical_30_row_payload_sha256: 'cc393b94f8c5eaa6a6442b859d052caa60aa35715ffd3062734ff8ff77a4f346',
  c2_body_sha256: '76ded413a0ad2997096ba07da93f7485b0dafc587b1d62eb5ab4568131e7cd7b',
  c3_body_sha256: '865ed06c60b93a41d480979c4559490f550a14962e29061e6b47e8074536a1df',
  queue_body_sha256: 'f9b21cdeb8c87b87b9f15e341169322e62e3492c0228249da066794799107669',
  pre_g3_receipt_body_sha256: 'cbcc0afeca8434310814050acbf381ba59098af0c71d7b900aac6cdc4fb5149f',
  g2_authority_receipt_body_sha256: '5f8ce047c309c81fc7dbfa06f7c7dedb9d3d3aa4cb00722e0f1a1a02ae67e89b',
});
const PROGRAMME_421_PROOF_SOURCE_REFERENCES = Object.freeze({
  foundation_body_sha256: Object.freeze({ reference: 'github:issue:421:body', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.foundation_body_sha256 }),
  foundation_issue_and_comments_sha256: Object.freeze({ reference: 'github:issue:421:body-and-comments', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.foundation_issue_and_comments_sha256 }),
  canonical_30_row_payload_sha256: Object.freeze({ reference: 'github:issue:421:canonical-30-row-payload', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.canonical_30_row_payload_sha256 }),
  c2_body_sha256: Object.freeze({ reference: 'github:issue:423:body', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.c2_body_sha256 }),
  c3_body_sha256: Object.freeze({ reference: 'github:issue:424:body', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.c3_body_sha256 }),
  queue_body_sha256: Object.freeze({ reference: 'github:issue:425:body', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.queue_body_sha256 }),
  pre_g3_receipt_body_sha256: Object.freeze({ reference: 'github:issue:421:pre-g3-receipt', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.pre_g3_receipt_body_sha256 }),
  g2_authority_receipt_body_sha256: Object.freeze({ reference: 'github:issue:435:g2-authority-receipt', sha256: PROGRAMME_421_PROOF_SOURCE_HASHES.g2_authority_receipt_body_sha256 }),
});
const PROGRAMME_421_PROOF_FIELD_MAP_DIGEST = '5ad48a18d2043f18c7a40d9de08f5d19b49d5693f62136beae27d0386c3e0d88';
const PROGRAMME_421_PROOF_CHECKPOINT_SCHEMA = 'toolkit.controller.programme-421-structural-checkpoint.v1';
const PROGRAMME_421_PROOF_CHECKPOINT_SERIALIZATION = 'canonical-json-v1';
const PROGRAMME_421_PROOF_CHECKPOINT_CANDIDATE = Object.freeze({
  repository: 'weijunswj/ai-agent-toolkit',
  commit: '1ae053c9835c34358bb3acf8f413174a7d35a3ca',
  path: 'repo/tests/fixtures/controller-kernel/programme-421-proof-v1.json',
  blob: 'a1f352e709e749a75269e90615546794d32c4ddd',
});
const CURRENT_KEYS = Object.freeze([
  'schema', 'version', 'repository', 'controller_revision', 'canonical_main', 'programme', 'run', 'lock', 'gate',
  'repair_count', 'candidate', 'hold', 'in_flight', 'controlling_receipt', 'next_admissible_action', 'projection_digest',
]);
const CURRENT_DIGEST_KEYS = CURRENT_KEYS.filter((key) => key !== 'projection_digest');
const BOOTSTRAP_IO_COUNTERS = Object.freeze([
  'controller_identity_checks',
  'controller_full_reads',
  'stack_registry_identity_checks',
  'stack_registry_full_reads',
  'current_projection_reads',
  'lightweight_pr_reads',
  'exact_receipt_reads',
  'full_comment_history_reads',
  'full_pr_diff_reads',
  'workflow_log_reads',
  'historical_expansions',
  'stale_current_projections',
  'worker_liveness_checks',
  'worker_liveness_unknown',
  'model_visible_chars',
]);
const BOOTSTRAP_IO_REASONS = Object.freeze([
  'none',
  'stale_current_projection',
  'missing_receipt_pointer',
  'current_state_conflict',
  'minimum_evidence_unavailable',
  'worker_liveness_unverified',
  'explicit_decision_required_deeper_evidence',
  'other_required_evidence',
]);
const CURRENT_GATE_VALUES = Object.freeze(['G0-A', 'G0-B', 'G1', 'G2', 'G3', 'G4', 'LOOP', 'RECONVERGENCE', 'FINAL_AUDIT', 'BROWSER']);
const ACTION_STAGE_TOKENS = Object.freeze(Object.fromEntries(CURRENT_GATE_VALUES.map((stage) => [stage.replace(/-/g, '_'), stage])));
const LAUNCH_ACTIONS = Object.freeze(new Set(CURRENT_GATE_VALUES.map((stage) => `LAUNCH_${stage.replace(/-/g, '_')}_DIRECT`)));
const EXECUTE_ACTIONS = Object.freeze(new Set(CURRENT_GATE_VALUES.map((stage) => `${stage.replace(/-/g, '_')}_EXECUTE`)));
const NON_LAUNCH_ACTIONS = Object.freeze(new Set([
  'ADOPT_IN_FLIGHT',
  'RECONCILE_WORKER_LIVENESS',
  'RECONCILE_LAUNCH_OUTCOME',
  'RECONCILE_TERMINAL_PACKET',
  'HOLD_TERMINAL_NON_CONVERGENCE',
  'USER_DECISION_REQUIRED',
  'WEB_RECONCILE_PACKET',
]));
const CURRENT_ACTIONS = Object.freeze(new Set([...LAUNCH_ACTIONS, ...EXECUTE_ACTIONS, ...NON_LAUNCH_ACTIONS]));
const CURRENT_GATE_PATTERN = new RegExp(`^(?:${CURRENT_GATE_VALUES.map((value) => value.replace('-', '\\-')).join('|')})$`);
const CURRENT_GATE_BASE_PATTERN = CURRENT_GATE_PATTERN;
const PROGRAMME_421_STRUCTURAL_EXPECTATIONS = Object.freeze(Object.fromEntries([
  ['C1', { kind: 'CHILD', materialized: true, native_issue: 435, execution_eligible: true }],
  ['C2', { kind: 'CHILD', materialized: true, native_issue: 423, execution_eligible: true }],
  ['C3', { kind: 'CHILD', materialized: true, native_issue: 424, execution_eligible: true }],
  ['Q', { kind: 'CHILD', materialized: true, native_issue: 425, execution_eligible: false }],
  ...PROGRAMME_421_PROOF_OUTCOME_IDS.filter((id) => !['C1', 'C2', 'C3', 'Q'].includes(id))
    .map((id) => [id, { kind: 'OUTCOME', materialized: false, native_issue: null, execution_eligible: false }]),
].map(([id, value]) => [id, Object.freeze(value)])));
const LAUNCH_SAFETY_CODES = Object.freeze({
  violation: 'CURRENT_STATE_INVARIANT_VIOLATION',
  safe: 'CURRENT_LAUNCH_SAFE',
});
const WORKER_LIVENESS_STATES = Object.freeze(['active', 'terminal', 'inactive', 'unknown']);
const WORKER_LIVENESS_EVIDENCE = Object.freeze([
  'runtime-native',
  'durable-terminal',
  'user-web',
  'branch-pr',
  'native-handle',
  'unavailable',
]);
const WORKER_LIVENESS_UNVERIFIED = 'WORKER_LIVENESS_UNVERIFIED';
const IN_FLIGHT_STATES = Object.freeze(['NONE', 'PREPARING', 'RUNNING', 'VALIDATING', 'DELIVERY_PENDING', 'UNKNOWN']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function safeId(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9._:/-]+$/.test(value) && !value.includes('..');
}

function safeText(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0\r\n\t]/.test(value);
}

function result(ok, code, extra = {}) {
  return Object.freeze({ ok, code, ...extra });
}

function counterValue(value) {
  if (value === null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function bootstrapIoSource(input = {}) {
  if (!isRecord(input)) return {};
  return isRecord(input.bootstrap_io) ? input.bootstrap_io
    : isRecord(input.bootstrapIo) ? input.bootstrapIo
      : isRecord(input.diagnostic) ? input.diagnostic : input;
}

function createBootstrapIoDiagnostic(input = {}) {
  const source = bootstrapIoSource(input);
  const counters = isRecord(source.counters) ? source.counters : source;
  const diagnostic = {};
  for (const field of BOOTSTRAP_IO_COUNTERS) diagnostic[field] = counterValue(counters[field]);
  diagnostic.bootstrap_escalation_reason = BOOTSTRAP_IO_REASONS.includes(source.bootstrap_escalation_reason)
    ? source.bootstrap_escalation_reason : 'none';
  return diagnostic;
}

function recordBootstrapIo(diagnostic, field, amount = 1) {
  if (!isRecord(diagnostic) || !BOOTSTRAP_IO_COUNTERS.includes(field) || !Number.isSafeInteger(amount) || amount < 0) return diagnostic;
  if (diagnostic[field] === null) return diagnostic;
  const current = counterValue(diagnostic[field]);
  diagnostic[field] = current + amount;
  return diagnostic;
}

function setBootstrapEscalationReason(diagnostic, reason) {
  if (!isRecord(diagnostic) || !BOOTSTRAP_IO_REASONS.includes(reason)) return diagnostic;
  if (!BOOTSTRAP_IO_REASONS.includes(diagnostic.bootstrap_escalation_reason) || diagnostic.bootstrap_escalation_reason === 'none') {
    diagnostic.bootstrap_escalation_reason = reason;
  }
  return diagnostic;
}

function observeModelVisibleProjection(diagnostic, projection) {
  if (!isRecord(diagnostic)) return diagnostic;
  try {
    const serialized = JSON.stringify(projection);
    if (typeof serialized === 'string') recordBootstrapIo(diagnostic, 'model_visible_chars', serialized.length);
  } catch (_error) {
    // Diagnostic measurement is best-effort and never changes the evidence path.
  }
  return diagnostic;
}

function normalizeBootstrapIo(diagnostic) {
  return createBootstrapIoDiagnostic(diagnostic);
}

function renderBootstrapIO(diagnostic) {
  const normalized = normalizeBootstrapIo(diagnostic);
  const fields = [...BOOTSTRAP_IO_COUNTERS, 'bootstrap_escalation_reason'];
  return `BOOTSTRAP_IO ${fields.map((field) => `${field}=${normalized[field] === null ? 'unavailable' : normalized[field]}`).join(' ')}`;
}

function maybeSha(value) {
  return isSha(value) ? value : null;
}

function candidateProjection(input) {
  if (input === undefined) return { pr: null, head: null, tree: null, base: { ref: null, sha: null } };
  if (!isRecord(input)) return { pr: input, head: null, tree: null, base: null };
  const candidate = input;
  const base = Object.prototype.hasOwnProperty.call(candidate, 'base') ? candidate.base : null;
  return {
    pr: Object.prototype.hasOwnProperty.call(candidate, 'pr') ? candidate.pr : null,
    head: Object.prototype.hasOwnProperty.call(candidate, 'head') ? candidate.head : null,
    tree: Object.prototype.hasOwnProperty.call(candidate, 'tree') ? candidate.tree : null,
    base: isRecord(base) ? {
      ref: Object.prototype.hasOwnProperty.call(base, 'ref') ? base.ref : null,
      sha: Object.prototype.hasOwnProperty.call(base, 'sha') ? base.sha : null,
    } : base,
  };
}

function projectPullRequestMetadata(input = {}, options = {}) {
  if (!isRecord(input)) return result(false, 'PR_ADMISSION_METADATA_INCOMPLETE');
  const diagnostic = isRecord(options) ? (options.bootstrap_io || options.bootstrapIo || options.diagnostic) : null;
  const number = Number.isSafeInteger(input.number) ? input.number : Number.isSafeInteger(input.id) ? input.id : null;
  const repository = input.repository || input.repository_id || input.base?.repo?.full_name || input.head?.repo?.full_name;
  if (!Number.isSafeInteger(number) || number < 1 || !safeText(repository)) return result(false, 'PR_ADMISSION_METADATA_INCOMPLETE');
  const head = isRecord(input.head) ? input.head : {};
  const base = isRecord(input.base) ? input.base : {};
  const rawState = typeof input.state === 'string' ? input.state.toUpperCase() : 'UNKNOWN';
  const state = ['OPEN', 'CLOSED', 'MERGED'].includes(rawState) ? rawState : 'UNKNOWN';
  let mergeability = typeof input.mergeability === 'string' ? input.mergeability : typeof input.mergeable_state === 'string' ? input.mergeable_state : '';
  if (!mergeability && typeof input.mergeable === 'boolean') mergeability = input.mergeable ? 'MERGEABLE' : 'CONFLICTING';
  if (!mergeability) mergeability = 'UNAVAILABLE';
  const projection = {
    schema: SCHEMAS.admission,
    version: 1,
    repository,
    number,
    state,
    draft: input.draft === true,
    head: {
      ref: typeof head.ref === 'string' && head.ref.length > 0 ? head.ref : null,
      sha: maybeSha(head.sha || input.head_sha),
      tree: maybeSha(head.tree || head.tree_sha || input.tree || input.tree_sha),
    },
    base: {
      ref: typeof base.ref === 'string' && base.ref.length > 0 ? base.ref : null,
      sha: maybeSha(base.sha || input.base_sha),
    },
    mergeability: mergeability.slice(0, 64),
  };
  if (diagnostic) {
    recordBootstrapIo(diagnostic, 'lightweight_pr_reads');
    observeModelVisibleProjection(diagnostic, projection);
  }
  return result(true, 'PR_ADMISSION_METADATA_READY', {
    projection: Object.freeze(projection),
    ...(diagnostic ? { bootstrap_io: normalizeBootstrapIo(diagnostic), BOOTSTRAP_IO: renderBootstrapIO(diagnostic) } : {}),
  });
}

function validatePullRequestMetadata(value) {
  const keys = ['schema', 'version', 'repository', 'number', 'state', 'draft', 'head', 'base', 'mergeability'];
  if (!isRecord(value) || !exactKeys(value, keys) || value.schema !== SCHEMAS.admission || value.version !== 1
    || !safeText(value.repository) || !Number.isSafeInteger(value.number) || value.number < 1
    || !['OPEN', 'CLOSED', 'MERGED', 'UNKNOWN'].includes(value.state) || typeof value.draft !== 'boolean'
    || !isRecord(value.head) || !exactKeys(value.head, ['ref', 'sha', 'tree']) || (value.head.ref !== null && !safeText(value.head.ref))
    || (value.head.sha !== null && !isSha(value.head.sha)) || (value.head.tree !== null && !isSha(value.head.tree))
    || !isRecord(value.base) || !exactKeys(value.base, ['ref', 'sha']) || (value.base.ref !== null && !safeText(value.base.ref))
    || (value.base.sha !== null && !isSha(value.base.sha)) || !safeText(value.mergeability, 64)) return result(false, 'PR_ADMISSION_METADATA_INVALID');
  return result(true, 'PR_ADMISSION_METADATA_VALID', { projection: clone(value) });
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function normalizeWorkerIdentity(value) {
  if (typeof value === 'string' && safeText(value)) return value;
  if (isRecord(value)) {
    return normalizeWorkerIdentity(firstValue(value.id, value.handle, value.worker, value.native_handle, value.reference));
  }
  return null;
}

function normalizeWorkerLaunchEvidence(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['attempted', 'launch-attempted', 'started-attempted'].includes(normalized)) return 'attempted';
    if (['admitted', 'accepted', 'launched', 'started', 'launch-admitted'].includes(normalized)) return 'admitted';
    if (['unknown', 'unverified', 'unavailable'].includes(normalized)) return 'unknown';
    return safeText(value) ? value : null;
  }
  if (!isRecord(value)) return null;
  if (value.admitted === true || value.accepted === true || value.launched === true || value.started === true) return 'admitted';
  if (value.attempted === true || value.launch_attempted === true) return 'attempted';
  return normalizeWorkerLaunchEvidence(firstValue(value.status, value.state, value.classification, value.kind));
}

function normalizeWorkerLiveness(value) {
  const raw = isRecord(value)
    ? firstValue(value.state, value.status, value.classification, value.liveness)
    : value;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/[_ ]/g, '-');
  if (['active', 'running', 'alive', 'adoptable', 'in-flight'].includes(normalized)) return 'active';
  if (['terminal', 'complete', 'completed', 'finished', 'exited'].includes(normalized)) return 'terminal';
  if (['inactive', 'not-running', 'not-found', 'stale', 'dead'].includes(normalized)) return 'inactive';
  if (['unknown', 'unverified', 'unavailable', 'ambiguous', 'unresolved'].includes(normalized)) return 'unknown';
  return null;
}

function normalizeWorkerLivenessEvidence(value) {
  const raw = isRecord(value)
    ? firstValue(value.source, value.class, value.kind, value.evidence)
    : value;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/[_ ]/g, '-');
  if (['runtime', 'runtime-native', 'native-runtime', 'process', 'adoptability', 'adoptable'].includes(normalized)) return 'runtime-native';
  if (['durable-terminal', 'terminal-packet', 'terminal-state', 'receipt', 'packet'].includes(normalized)) return 'durable-terminal';
  if (['user', 'user-web', 'web', 'explicit-user'].includes(normalized)) return 'user-web';
  if (['branch', 'branch-pr', 'pr', 'pull-request', 'github'].includes(normalized)) return 'branch-pr';
  if (['handle', 'native-handle', 'worker-handle'].includes(normalized)) return 'native-handle';
  if (['unknown', 'unavailable', 'none'].includes(normalized)) return 'unavailable';
  return WORKER_LIVENESS_EVIDENCE.includes(normalized) ? normalized : null;
}

function normalizeWorkerTerminalState(value) {
  if (typeof value === 'string' && safeText(value)) return value;
  if (value === true) return 'terminal';
  if (!isRecord(value)) return null;
  return normalizeWorkerTerminalState(firstValue(value.state, value.status, value.result, value.classification, value.reference));
}

function workerInputParts(input = {}) {
  const source = isRecord(input) ? input : {};
  const nested = source.in_flight === true || source.inFlight === true
    ? { state: 'RUNNING' }
    : isRecord(source.in_flight) ? source.in_flight : isRecord(source.inFlight) ? source.inFlight : {};
  const run = isRecord(source.run) ? source.run : {};
  const packet = source.terminal_packet || source.terminalPacket || source.packet || null;
  const livenessValue = firstValue(
    source.worker_liveness,
    source.workerLiveness,
    source.liveness,
    nested.worker_liveness,
    nested.workerLiveness,
    nested.liveness,
  );
  const livenessObject = isRecord(livenessValue) ? livenessValue : {};
  const refreshed = firstValue(
    source.worker_liveness_refreshed,
    source.workerLivenessRefreshed,
    source.liveness_refreshed,
    nested.worker_liveness_refreshed,
    nested.workerLivenessRefreshed,
    livenessObject.refreshed,
    livenessObject.current,
  );
  const terminalValue = firstValue(
    source.worker_terminal_state,
    source.workerTerminalState,
    source.terminal_worker_state,
    nested.worker_terminal_state,
    nested.workerTerminalState,
    nested.terminal_state,
  );
  const rawLiveness = normalizeWorkerLiveness(livenessValue);
  const terminalState = normalizeWorkerTerminalState(terminalValue);
  const terminalEvidence = source.worker_terminal === true
    || source.workerTerminal === true
    || run.state === 'TERMINAL'
    || isRecord(packet)
    || terminalState !== null
    || rawLiveness === 'terminal';
  const launchEvidence = normalizeWorkerLaunchEvidence(firstValue(
    source.worker_launch_evidence,
    source.workerLaunchEvidence,
    nested.worker_launch_evidence,
    nested.workerLaunchEvidence,
  ));
  const identity = normalizeWorkerIdentity(firstValue(
    source.worker_identity,
    source.workerIdentity,
    source.previous_worker_identity,
    source.previousWorkerIdentity,
    nested.worker_identity,
    nested.workerIdentity,
    nested.worker,
    run.worker_identity,
    run.workerIdentity,
    run.worker_id,
    source.worker,
  ));
  const evidence = normalizeWorkerLivenessEvidence(firstValue(
    source.worker_liveness_evidence,
    source.workerLivenessEvidence,
    source.liveness_evidence,
    nested.worker_liveness_evidence,
    nested.workerLivenessEvidence,
    livenessObject.source,
  ));
  const launchOutcome = String(firstValue(source.launch_outcome, source.launchOutcome, nested.launch_outcome, nested.launchOutcome) || '').toUpperCase();
  const activeClaim = source.in_flight === true
    || source.inFlight === true
    || run.state === 'IN_FLIGHT'
    || run.state === 'QUEUED'
    || ['PREPARING', 'RUNNING', 'VALIDATING'].includes(String(nested.state || '').toUpperCase())
    || source.worker_active === true
    || nested.active === true
    || identity !== null
    || launchEvidence !== null
    || ['AMBIGUOUS', 'UNKNOWN', 'UNRESOLVED'].includes(launchOutcome);
  const refreshInvalidated = refreshed === false || source.worker_liveness_current === false || source.workerLivenessCurrent === false;
  let liveness = rawLiveness;
  let current = rawLiveness !== null && !refreshInvalidated;
  let currentEvidence = evidence;
  if (terminalEvidence) {
    liveness = 'terminal';
    current = true;
    currentEvidence = currentEvidence || 'durable-terminal';
  } else if (refreshInvalidated) {
    liveness = 'unknown';
    current = false;
    currentEvidence = 'unavailable';
  } else if (liveness === null) {
    if (!activeClaim && !identity && String(nested.state || '').toUpperCase() === 'NONE' && run.state !== 'IN_FLIGHT') {
      liveness = 'inactive';
      current = true;
    } else {
      liveness = 'unknown';
      current = false;
      currentEvidence = currentEvidence || 'unavailable';
    }
  }
  if (liveness === 'inactive' && current && currentEvidence !== 'runtime-native') {
    // A stale branch, web observation, handle, or missing source cannot prove
    // that a prior execution is no longer outstanding.
    liveness = 'unknown';
    current = false;
    currentEvidence = currentEvidence || 'unavailable';
  }
  if (currentEvidence === 'branch-pr' || currentEvidence === 'native-handle' || currentEvidence === 'unavailable') {
    // A branch/PR, stored native handle, or unavailable result cannot establish current liveness.
    liveness = 'unknown';
    current = false;
  }
  return {
    source,
    nested,
    run,
    packet,
    identity,
    launchEvidence,
    liveness,
    livenessEvidence: currentEvidence,
    terminalState,
    activeClaim,
    current,
    active: liveness === 'active' && current && currentEvidence === 'runtime-native',
    terminal: liveness === 'terminal',
    inactive: liveness === 'inactive' && current,
    livenessUnverified: activeClaim && liveness === 'unknown',
  };
}

function reconcileWorkerLiveness(input = {}) {
  const worker = workerInputParts(input);
  const diagnostic = isRecord(input) ? (input.bootstrap_io || input.bootstrapIo || input.diagnostic) : null;
  if (diagnostic) {
    recordBootstrapIo(diagnostic, 'worker_liveness_checks');
    if (worker.livenessUnverified) {
      recordBootstrapIo(diagnostic, 'worker_liveness_unknown');
      setBootstrapEscalationReason(diagnostic, 'worker_liveness_unverified');
    }
  }
  return result(!worker.livenessUnverified, worker.livenessUnverified ? WORKER_LIVENESS_UNVERIFIED : 'WORKER_LIVENESS_RECONCILED', {
    state: worker.liveness,
    liveness: worker.liveness,
    liveness_evidence: worker.livenessEvidence,
    worker_identity: worker.identity,
    worker_launch_evidence: worker.launchEvidence,
    worker_terminal_state: worker.terminalState,
    current: worker.current,
    historical_identity_preserved: worker.identity !== null,
    ...(diagnostic ? { bootstrap_io: normalizeBootstrapIo(diagnostic), BOOTSTRAP_IO: renderBootstrapIO(diagnostic) } : {}),
  });
}

function canonicalCurrentGate(value) {
  return typeof value === 'string' && CURRENT_GATE_VALUES.includes(value) ? value : null;
}

function currentGateBase(value) {
  return canonicalCurrentGate(value);
}

function currentGateInput(source) {
  const hasGate = Object.prototype.hasOwnProperty.call(source, 'gate');
  const aliases = ['stage', 'authorised_stage', 'authorized_stage'];
  const suppliedAliases = aliases.filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  const supplied = hasGate || suppliedAliases.length > 0;
  const value = hasGate ? source.gate : suppliedAliases.length > 0 ? source[suppliedAliases[0]] : null;
  const canonical = canonicalCurrentGate(value);
  const conflictingAlias = suppliedAliases.some((key) => {
    const alias = canonicalCurrentGate(source[key]);
    return alias === null || alias !== canonical;
  });
  return { supplied, value, canonical, invalid: supplied && canonical === null, conflict: supplied && conflictingAlias };
}

function launchAction(value) {
  return typeof value === 'string' && LAUNCH_ACTIONS.has(value);
}

function stageFromAction(value) {
  if (typeof value !== 'string') return null;
  const launchMatch = /^LAUNCH_([A-Z0-9_]+)_DIRECT$/.exec(value);
  if (launchMatch && ACTION_STAGE_TOKENS[launchMatch[1]]) return ACTION_STAGE_TOKENS[launchMatch[1]];
  const executeMatch = /^([A-Z0-9_]+)_EXECUTE$/.exec(value);
  return executeMatch && ACTION_STAGE_TOKENS[executeMatch[1]] ? ACTION_STAGE_TOKENS[executeMatch[1]] : null;
}

function launchSafetyView(input = {}) {
  const source = isRecord(input) ? input : {};
  if (!publicGraphInputSafe(source)) {
    return {
      next: null, gate: null, stage: null, gateInvalid: true, gateConflict: false,
      actionInvalid: true, actionConflict: false, active: false, inactive: false,
      liveness: 'unknown', livenessEvidence: 'unavailable', workerIdentity: null,
      workerLaunchEvidence: null, workerTerminalState: null, livenessUnverified: true,
      ambiguous: true, packetReturned: false, terminal: false, nonConverged: true,
    };
  }
  const run = isRecord(source.run) ? source.run : {};
  const worker = workerInputParts(source);
  const inFlight = worker.nested;
  const hold = isRecord(source.hold) ? source.hold : {};
  const nextAliases = ['next_admissible_action', 'nextAction'].filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  const next = nextAliases.length === 1 ? source[nextAliases[0]] : nextAliases.length === 0 ? null : null;
  const actionConflict = nextAliases.length > 1 && source.next_admissible_action !== source.nextAction;
  const actionInvalid = nextAliases.length > 1
    || next !== null && !CURRENT_ACTIONS.has(next);
  const packet = worker.packet;
  const packetReturned = source.terminal_packet_returned === true
    || source.packet_returned === true
    || isRecord(packet) && source.packet_reconciled !== true && source.terminal_packet_reconciled !== true;
  const ambiguous = source.ambiguous_launch === true
    || source.launch_ambiguous === true
    || ['AMBIGUOUS', 'UNKNOWN', 'UNRESOLVED'].includes(String(source.launch_outcome || '').toUpperCase())
    || inFlight.ambiguous === true
    || inFlight.launch_outcome && ['AMBIGUOUS', 'UNKNOWN', 'UNRESOLVED'].includes(String(inFlight.launch_outcome).toUpperCase());
  const active = worker.active;
  const livenessUnverified = worker.livenessUnverified;
  const deliveryPending = inFlight.state === 'DELIVERY_PENDING';
  const terminal = source.terminal === true || source.terminal_state === true || run.state === 'TERMINAL' || worker.terminal;
  const nonConverged = source.terminal_non_converged === true
    || source.non_converged === true
    || source.completed_gate_executable === true
    || hold.code === 'TERMINAL_NON_CONVERGED'
    || hold.code === 'CURRENT_STATE_INVARIANT_VIOLATION';
  const gateInput = currentGateInput(source);
  return {
    next,
    gate: gateInput.canonical,
    stage: currentGateBase(gateInput.canonical),
    gateInvalid: gateInput.invalid,
    gateConflict: gateInput.conflict,
    actionInvalid,
    actionConflict,
    active,
    inactive: worker.inactive,
    liveness: worker.liveness,
    livenessEvidence: worker.livenessEvidence,
    workerIdentity: worker.identity,
    workerLaunchEvidence: worker.launchEvidence,
    workerTerminalState: worker.terminalState,
    livenessUnverified,
    ambiguous: ambiguous || deliveryPending && !packetReturned,
    packetReturned,
    terminal,
    nonConverged,
  };
}

function deriveNextAdmissibleAction(input = {}) {
  const view = launchSafetyView(input);
  if (view.gateInvalid || view.gateConflict || view.actionInvalid || view.actionConflict) {
    return result(false, LAUNCH_SAFETY_CODES.violation, {
      action: 'USER_DECISION_REQUIRED',
      derived_action: 'USER_DECISION_REQUIRED',
      reason_code: view.gateConflict ? 'CURRENT_GATE_ALIAS_CONFLICT'
        : view.gateInvalid ? 'CURRENT_GATE_INVALID'
          : view.actionConflict ? 'CURRENT_ACTION_ALIAS_CONFLICT' : 'CURRENT_ACTION_UNRECOGNIZED',
      launch_allowed: false,
    });
  }
  if (view.packetReturned) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: 'RECONCILE_TERMINAL_PACKET',
      reason_code: 'TERMINAL_PACKET_RECONCILIATION_REQUIRED',
      launch_allowed: false,
    });
  }
  if (view.livenessUnverified) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: 'RECONCILE_WORKER_LIVENESS',
      reason_code: WORKER_LIVENESS_UNVERIFIED,
      hold_code: WORKER_LIVENESS_UNVERIFIED,
      launch_allowed: false,
    });
  }
  if (view.ambiguous) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: 'RECONCILE_LAUNCH_OUTCOME',
      reason_code: 'AMBIGUOUS_LAUNCH_OUTCOME',
      launch_allowed: false,
    });
  }
  if (view.active) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: 'ADOPT_IN_FLIGHT',
      reason_code: 'IN_FLIGHT_EXECUTION_PRESENT',
      launch_allowed: false,
    });
  }
  if (view.nonConverged || view.terminal && launchAction(view.next)) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: 'HOLD_TERMINAL_NON_CONVERGENCE',
      reason_code: 'TERMINAL_STATE_NOT_EXECUTABLE',
      launch_allowed: false,
    });
  }
  if (view.next) {
    const requestedStage = stageFromAction(view.next);
    if ((launchAction(view.next) || EXECUTE_ACTIONS.has(view.next)) && (!view.stage || requestedStage !== view.stage)) {
      return result(false, LAUNCH_SAFETY_CODES.violation, {
        action: 'USER_DECISION_REQUIRED',
        derived_action: 'USER_DECISION_REQUIRED',
        reason_code: 'STAGE_BINDING_MISMATCH',
        launch_allowed: false,
      });
    }
    return result(true, 'CURRENT_ACTION_DERIVED', { action: view.next, reason_code: 'CURRENT_ACTION_PRESERVED', launch_allowed: false });
  }
  if (view.terminal) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: 'HOLD_TERMINAL_NON_CONVERGENCE',
      reason_code: 'TERMINAL_STATE_NOT_EXECUTABLE',
      launch_allowed: false,
    });
  }
  return result(true, 'CURRENT_ACTION_REQUIRED', { action: 'USER_DECISION_REQUIRED', reason_code: 'NO_EXECUTABLE_ACTION', launch_allowed: false });
}

function oneCurrentAlias(source, aliases) {
  const present = aliases.filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (present.length !== 1) return { ok: false, value: null, conflict: present.length > 1 };
  return { ok: true, value: source[present[0]] };
}

function currentLaunchIdentityComplete(input, view) {
  const source = isRecord(input) ? input : {};
  const canonical = isRecord(source.canonical_main) ? source.canonical_main : isRecord(source.canonicalMain) ? source.canonicalMain : {};
  const run = isRecord(source.run) ? source.run : {};
  const candidate = candidateProjection(source.candidate);
  const receipt = isRecord(source.controlling_receipt) ? source.controlling_receipt : isRecord(source.controllingReceipt) ? source.controllingReceipt : {};
  return safeText(source.repository || source.repository_id)
    && safeId(source.controller_revision || source.controllerRevision)
    && isSha(canonical.sha) && isSha(canonical.tree)
    && safeId(run.id) && run.id !== 'none'
    && safeText(source.lock)
    && canonicalCurrentGate(view.gate)
    && candidateMode(candidate) !== null
    && safeText(receipt.id) && safeText(receipt.reference, 1024) && isDigest(receipt.digest)
    && typeof view.next === 'string' && CURRENT_ACTIONS.has(view.next)
    && view.active === false && view.ambiguous === false && view.livenessUnverified === false
    && view.packetReturned === false && view.terminal === false && view.nonConverged === false;
}

function currentStructuralEligibility(input) {
  const source = isRecord(input) ? input : {};
  if (source.trusted_structural_eligibility === true) return true;
  const structural = source.structural_admission || source.structuralAdmission;
  return isRecord(structural) && structural.eligible === true && structural.trusted === true;
}

function currentLaunchDependenciesAvailable(input) {
  const source = isRecord(input) ? input : {};
  const route = oneCurrentAlias(source, ['route_available', 'routeAvailable']);
  const capability = oneCurrentAlias(source, ['capability_available', 'capabilityAvailable']);
  const ownership = oneCurrentAlias(source, ['ownership_admitted', 'ownershipAdmitted']);
  const fence = oneCurrentAlias(source, ['fence_valid', 'fenceValid']);
  return route.ok && route.value === true && capability.ok && capability.value === true
    && ownership.ok && ownership.value === true && fence.ok && fence.value === true;
}

function admitCurrent(input = {}) {
  if (!isRecord(input) || !publicGraphInputSafe(input)) return result(false, 'CURRENT_ADMISSION_INVALID');
  const view = launchSafetyView(input);
  if (view.gateInvalid || view.gateConflict) return result(false, 'CURRENT_GATE_INVALID', { gate: view.gate });
  if (view.actionInvalid || view.actionConflict) return result(false, 'CURRENT_ACTION_UNRECOGNIZED', { action: view.next });
  if (view.next !== null && !CURRENT_ACTIONS.has(view.next)) return result(false, 'CURRENT_ACTION_UNRECOGNIZED', { action: view.next });
  return result(true, 'CURRENT_ADMISSION_ACCEPTED', {
    gate: view.gate,
    action: view.next,
    stage: view.stage,
    launch_action: view.next !== null && (launchAction(view.next) || EXECUTE_ACTIONS.has(view.next)),
  });
}

function validateCurrentLaunchSafety(input = {}) {
  const admitted = admitCurrent(input);
  if (!admitted.ok) return result(false, LAUNCH_SAFETY_CODES.violation, { reason_code: admitted.code, launch_allowed: false });
  const view = launchSafetyView(input);
  const derived = deriveNextAdmissibleAction(input);
  if (!derived.ok) return derived;
  const requested = view.next;
  const executableAction = launchAction(requested) || EXECUTE_ACTIONS.has(requested);
  if (!executableAction) {
    return result(true, LAUNCH_SAFETY_CODES.safe, {
      action: derived.action,
      requested_action: requested,
      derived_action: derived.action,
      launch_allowed: false,
    });
  }

  const requestedStage = stageFromAction(requested);
  const currentStage = view.stage;
  const authorisedStage = oneCurrentAlias(input, ['authorised_stage', 'authorized_stage']);
  const candidate = candidateProjection(input.candidate);
  const requiredMode = requestedStage === 'RECONVERGENCE'
    ? (input.reconvergence_candidate_mode || input.reconvergenceCandidateMode || null)
    : requiredCurrentCandidateMode({ gate: currentStage, next_admissible_action: requested });
  const mode = candidateMode(candidate);
  if (view.packetReturned || view.livenessUnverified || view.ambiguous || view.active || view.nonConverged || view.terminal) {
    return result(false, LAUNCH_SAFETY_CODES.violation, {
      requested_action: requested,
      derived_action: derived.action,
      reason_code: view.packetReturned
        ? 'TERMINAL_PACKET_RECONCILIATION_REQUIRED'
        : view.livenessUnverified
          ? WORKER_LIVENESS_UNVERIFIED
          : view.ambiguous
            ? 'AMBIGUOUS_LAUNCH_OUTCOME'
            : view.active
              ? 'IN_FLIGHT_EXECUTION_PRESENT'
              : 'TERMINAL_STATE_NOT_EXECUTABLE',
      launch_allowed: false,
    });
  }
  if (!currentLaunchIdentityComplete(input, view)) return result(false, LAUNCH_SAFETY_CODES.violation, { requested_action: requested, derived_action: derived.action, reason_code: 'CURRENT_IDENTITY_INCOMPLETE', launch_allowed: false });
  if (!currentStructuralEligibility(input)) return result(false, LAUNCH_SAFETY_CODES.violation, { requested_action: requested, derived_action: derived.action, reason_code: 'STRUCTURAL_ELIGIBILITY_UNAVAILABLE', launch_allowed: false });
  if (!authorisedStage.ok || authorisedStage.value !== requestedStage || currentStage !== requestedStage) return result(false, LAUNCH_SAFETY_CODES.violation, { requested_action: requested, derived_action: derived.action, reason_code: 'STAGE_ACTION_AUTHORITY_MISMATCH', launch_allowed: false });
  if (!currentLaunchDependenciesAvailable(input)) return result(false, LAUNCH_SAFETY_CODES.violation, { requested_action: requested, derived_action: derived.action, reason_code: 'ROUTE_CAPABILITY_OWNERSHIP_FENCE_UNAVAILABLE', launch_allowed: false });
  if (isRecord(input.hold) && (input.hold.active === true || input.hold.code !== undefined && input.hold.code !== null)) return result(false, LAUNCH_SAFETY_CODES.violation, { requested_action: requested, derived_action: derived.action, reason_code: 'CURRENT_HOLD_ACTIVE', launch_allowed: false });
  if (requestedStage === 'RECONVERGENCE' && !['NONE', 'BOUND'].includes(requiredMode)) {
    return result(false, LAUNCH_SAFETY_CODES.violation, {
      requested_action: requested,
      derived_action: derived.action,
      reason_code: 'CURRENT_RECONVERGENCE_AUTHORITY_REQUIRED',
      launch_allowed: false,
    });
  }
  if (!['NONE', 'BOUND'].includes(mode) || requiredMode !== null && mode !== requiredMode) return result(false, LAUNCH_SAFETY_CODES.violation, { requested_action: requested, derived_action: derived.action, reason_code: 'CURRENT_CANDIDATE_MODE_MISMATCH', launch_allowed: false });
  return result(true, LAUNCH_SAFETY_CODES.safe, {
    action: derived.action,
    requested_action: requested,
    derived_action: derived.action,
    launch_allowed: true,
    stage: requestedStage,
    candidate_mode: mode,
  });
}

function currentInput(input = {}) {
  const canonical = isRecord(input.canonical_main) ? input.canonical_main : isRecord(input.canonicalMain) ? input.canonicalMain : {};
  const programme = isRecord(input.programme) ? input.programme : {};
  const run = isRecord(input.run) ? input.run : {};
  const hold = isRecord(input.hold) ? input.hold : {};
  const worker = workerInputParts(input);
  const inFlight = worker.nested;
  const receipt = isRecord(input.controlling_receipt) ? input.controlling_receipt : isRecord(input.controllingReceipt) ? input.controllingReceipt : {};
  const repair = isRecord(input.repair_count) ? input.repair_count : isRecord(input.repairCount) ? input.repairCount : {};
  const gateInput = currentGateInput(isRecord(input) ? input : {});
  const safety = deriveNextAdmissibleAction(input);
  const safetyAction = safety.action;
  const derivedSafetyAction = safetyAction === 'ADOPT_IN_FLIGHT'
    || safetyAction === 'RECONCILE_WORKER_LIVENESS'
    || safetyAction === 'RECONCILE_LAUNCH_OUTCOME'
    || safetyAction === 'RECONCILE_TERMINAL_PACKET'
    || safetyAction === 'HOLD_TERMINAL_NON_CONVERGENCE';
  const normalizedRunState = ['NONE', 'QUEUED', 'IN_FLIGHT', 'TERMINAL', 'HELD'].includes(run.state) ? run.state : 'NONE';
  const runState = worker.terminal
    ? 'TERMINAL'
    : worker.active
      ? 'IN_FLIGHT'
      : worker.inactive && normalizedRunState === 'IN_FLIGHT'
        ? 'QUEUED'
        : worker.livenessUnverified && worker.activeClaim
          ? 'HELD'
          : normalizedRunState;
  const inFlightState = worker.terminal && (worker.packet || worker.nested.state === 'DELIVERY_PENDING')
    ? 'DELIVERY_PENDING'
    : worker.active
      ? ['PREPARING', 'RUNNING', 'VALIDATING'].includes(String(inFlight.state).toUpperCase()) ? String(inFlight.state).toUpperCase() : 'RUNNING'
      : worker.inactive
        ? 'NONE'
        : worker.livenessUnverified && worker.activeClaim
          ? 'UNKNOWN'
          : IN_FLIGHT_STATES.includes(String(inFlight.state).toUpperCase()) ? String(inFlight.state).toUpperCase() : 'NONE';
  const holdCode = safety.reason_code === WORKER_LIVENESS_UNVERIFIED ? WORKER_LIVENESS_UNVERIFIED : hold.code;
  return {
    schema: SCHEMAS.current,
    version: 1,
    repository: input.repository || input.repository_id,
    controller_revision: input.controller_revision || input.controllerRevision,
    canonical_main: { ref: 'main', sha: maybeSha(canonical.sha), tree: maybeSha(canonical.tree) },
    programme: {
      parent: Number.isSafeInteger(programme.parent) && programme.parent >= 1 ? programme.parent : null,
      current_child: Number.isSafeInteger(programme.current_child) && programme.current_child >= 1 ? programme.current_child : null,
      lane: typeof programme.lane === 'string' && programme.lane.length > 0 ? programme.lane : null,
    },
    run: {
      id: typeof run.id === 'string' && run.id.length > 0 ? run.id : 'none',
      state: runState,
    },
    lock: typeof input.lock === 'string' && input.lock.length > 0 ? input.lock : null,
    gate: gateInput.supplied ? gateInput.value : null,
    repair_count: {
      used: Number.isSafeInteger(repair.used) && repair.used >= 0 ? repair.used : 0,
      limit: Number.isSafeInteger(repair.limit) && repair.limit >= 0 ? repair.limit : 0,
    },
    candidate: candidateProjection(input.candidate),
    hold: {
      active: hold.active === true || holdCode === WORKER_LIVENESS_UNVERIFIED,
      code: typeof holdCode === 'string' && holdCode.length > 0 ? holdCode : null,
      dependency: typeof hold.dependency === 'string' && hold.dependency.length > 0 ? hold.dependency : null,
    },
    in_flight: {
      state: inFlightState,
      worker: worker.identity,
      executor: typeof inFlight.executor === 'string' && inFlight.executor.length > 0 ? inFlight.executor : null,
      worker_identity: worker.identity,
      worker_launch_evidence: worker.launchEvidence,
      worker_liveness: worker.liveness,
      worker_liveness_evidence: worker.livenessEvidence,
      worker_terminal_state: worker.terminalState,
    },
    controlling_receipt: {
      id: typeof receipt.id === 'string' && receipt.id.length > 0 ? receipt.id : null,
      reference: typeof receipt.reference === 'string' && receipt.reference.length > 0 ? receipt.reference : null,
      digest: isDigest(receipt.digest) ? receipt.digest : null,
    },
    next_admissible_action: derivedSafetyAction ? safetyAction : input.next_admissible_action || input.nextAction || 'USER_DECISION_REQUIRED',
  };
}

function hasExecutableCurrentIdentity(value) {
  return isRecord(value) && (
    safeText(value.repository)
    && (safeText(value.lock) || safeText(value.gate) || isRecord(value.run) && value.run.id !== 'none'
      || isRecord(value.canonical_main) && (value.canonical_main.sha !== null || value.canonical_main.tree !== null)
      || isRecord(value.candidate) && candidateMode(value.candidate) === 'BOUND'
      || isRecord(value.controlling_receipt) && Object.values(value.controlling_receipt).some((item) => item !== null)
      || isRecord(value.in_flight) && (value.in_flight.worker !== null || value.in_flight.state !== 'NONE')
  ));
}

function executableCurrentIdentityComplete(value) {
  if (!isRecord(value)
    || !safeText(value.repository)
    || !safeId(value.controller_revision)
    || !isRecord(value.canonical_main) || !isSha(value.canonical_main.sha) || !isSha(value.canonical_main.tree)
    || !isRecord(value.run) || !safeId(value.run.id) || value.run.id === 'none'
    || !safeText(value.lock) || !safeText(value.gate, 128)
    || candidateMode(value.candidate) === null
    || requiredCurrentCandidateMode(value) !== null && candidateMode(value.candidate) !== requiredCurrentCandidateMode(value)
    || !isRecord(value.controlling_receipt)
    || !safeText(value.controlling_receipt.id)
    || !safeText(value.controlling_receipt.reference, 1024)
    || !isDigest(value.controlling_receipt.digest)
    || !safeId(value.next_admissible_action)) return false;
  if (candidateMode(value.candidate) === 'BOUND'
    && (!isSha(value.candidate.head) || !isSha(value.candidate.tree) || !safeText(value.candidate.base?.ref) || !isSha(value.candidate.base?.sha))) return false;
  if (value.in_flight?.state !== 'NONE' || value.in_flight?.worker !== null || value.in_flight?.worker_liveness !== 'inactive') {
    if (!value.in_flight || !WORKER_LIVENESS_EVIDENCE.includes(value.in_flight.worker_liveness_evidence)) return false;
    if (value.in_flight.worker_liveness === 'active' && !safeText(value.in_flight.worker_identity)) return false;
  }
  return true;
}

function createCurrentProjection(input = {}) {
  const launchSafety = validateCurrentLaunchSafety(input);
  const base = currentInput(input);
  if (!safeText(base.repository) || !safeId(base.controller_revision) || !safeId(base.next_admissible_action)) return result(false, 'CURRENT_PROJECTION_INCOMPLETE');
  if (candidateMode(base.candidate) === null) return result(false, 'CURRENT_CANDIDATE_INVALID');
  if (hasExecutableCurrentIdentity(base) && !executableCurrentIdentityComplete(base)) return result(false, 'CURRENT_EXECUTABLE_IDENTITY_INCOMPLETE');
  if (!launchSafety.ok) return launchSafety;
  const projection = { ...base, projection_digest: kernel.digestValue(base) };
  const checked = validateCurrentProjection(projection);
  return checked.ok ? result(true, 'CURRENT_PROJECTION_READY', { projection: Object.freeze(projection) }) : checked;
}

function validateCurrentProjection(value) {
  if (!isRecord(value) || !publicGraphInputSafe(value) || !exactKeys(value, CURRENT_KEYS) || value.schema !== SCHEMAS.current || value.version !== 1
    || !safeText(value.repository) || !safeId(value.controller_revision)
    || !isRecord(value.canonical_main) || !exactKeys(value.canonical_main, ['ref', 'sha', 'tree']) || value.canonical_main.ref !== 'main'
    || (value.canonical_main.sha !== null && !isSha(value.canonical_main.sha)) || (value.canonical_main.tree !== null && !isSha(value.canonical_main.tree))
    || !isRecord(value.programme) || !exactKeys(value.programme, ['parent', 'current_child', 'lane'])
    || (value.programme.parent !== null && (!Number.isSafeInteger(value.programme.parent) || value.programme.parent < 1))
    || (value.programme.current_child !== null && (!Number.isSafeInteger(value.programme.current_child) || value.programme.current_child < 1))
    || (value.programme.lane !== null && !safeText(value.programme.lane))
    || !isRecord(value.run) || !exactKeys(value.run, ['id', 'state']) || !safeId(value.run.id) || !['NONE', 'QUEUED', 'IN_FLIGHT', 'TERMINAL', 'HELD'].includes(value.run.state)
    || (value.lock !== null && !safeText(value.lock)) || (value.gate !== null && canonicalCurrentGate(value.gate) === null)
    || !isRecord(value.repair_count) || !exactKeys(value.repair_count, ['used', 'limit']) || !Number.isSafeInteger(value.repair_count.used) || value.repair_count.used < 0 || !Number.isSafeInteger(value.repair_count.limit) || value.repair_count.limit < 0
    || validateCandidate(value.candidate) === false
    || !isRecord(value.hold) || !exactKeys(value.hold, ['active', 'code', 'dependency']) || typeof value.hold.active !== 'boolean'
    || (value.hold.code !== null && !safeText(value.hold.code, 128)) || (value.hold.dependency !== null && !safeText(value.hold.dependency))
    || !isRecord(value.in_flight) || !exactKeys(value.in_flight, ['state', 'worker', 'executor', 'worker_identity', 'worker_launch_evidence', 'worker_liveness', 'worker_liveness_evidence', 'worker_terminal_state']) || !IN_FLIGHT_STATES.includes(value.in_flight.state)
    || (value.in_flight.worker !== null && !safeText(value.in_flight.worker)) || (value.in_flight.executor !== null && !safeText(value.in_flight.executor))
    || (value.in_flight.worker_identity !== null && !safeText(value.in_flight.worker_identity))
    || value.in_flight.worker !== value.in_flight.worker_identity
    || (value.in_flight.worker_launch_evidence !== null && !safeText(value.in_flight.worker_launch_evidence))
    || !WORKER_LIVENESS_STATES.includes(value.in_flight.worker_liveness)
    || (value.in_flight.worker_liveness_evidence !== null && !WORKER_LIVENESS_EVIDENCE.includes(value.in_flight.worker_liveness_evidence))
    || (value.in_flight.worker_terminal_state !== null && !safeText(value.in_flight.worker_terminal_state))
    || !isRecord(value.controlling_receipt) || !exactKeys(value.controlling_receipt, ['id', 'reference', 'digest'])
    || (value.controlling_receipt.id !== null && !safeText(value.controlling_receipt.id)) || (value.controlling_receipt.reference !== null && !safeText(value.controlling_receipt.reference, 1024))
    || (value.controlling_receipt.digest !== null && !isDigest(value.controlling_receipt.digest))
    || !safeId(value.next_admissible_action) || !isDigest(value.projection_digest)
    || value.projection_digest !== kernel.digestValue(Object.fromEntries(CURRENT_DIGEST_KEYS.map((key) => [key, value[key]])))) return result(false, 'CURRENT_PROJECTION_INVALID');
  if (hasExecutableCurrentIdentity(value) && !executableCurrentIdentityComplete(value)) return result(false, 'CURRENT_EXECUTABLE_IDENTITY_INCOMPLETE');
  const admission = admitCurrent(value);
  if (!admission.ok) return result(false, 'CURRENT_PROJECTION_INVALID', { reason: admission.code });
  return result(true, 'CURRENT_PROJECTION_VALID', { projection: clone(value) });
}

function validateCandidate(value) {
  return candidateMode(value) !== null;
}

function candidateMode(value) {
  if (!isRecord(value) || !exactKeys(value, ['pr', 'head', 'tree', 'base'])
    || !isRecord(value.base) || !exactKeys(value.base, ['ref', 'sha'])) return null;
  const fields = [value.pr, value.head, value.tree, value.base.ref, value.base.sha];
  if (fields.every((field) => field === null)) return 'NONE';
  return Number.isSafeInteger(value.pr) && value.pr >= 1
    && isSha(value.head) && isSha(value.tree)
    && safeText(value.base.ref) && isSha(value.base.sha) ? 'BOUND' : null;
}

function requiredCurrentCandidateMode(value = {}) {
  const gate = typeof value.gate === 'string' ? value.gate : null;
  const action = typeof value.next_admissible_action === 'string' ? value.next_admissible_action : null;
  if (gate === 'RECONVERGENCE' || stageFromAction(action) === 'RECONVERGENCE') return null;
  if (['G3', 'G4'].includes(gate) || ['G3', 'G4'].includes(stageFromAction(action))) return 'BOUND';
  if (CURRENT_GATE_VALUES.includes(gate) || CURRENT_GATE_VALUES.includes(stageFromAction(action))) return 'NONE';
  return null;
}

function compareFields(projection, expected, fields) {
  return fields.every((field) => kernel.canonicalSerialize(projection[field]) === kernel.canonicalSerialize(expected[field]));
}

function isCurrentFresh(projection, expected = null, diagnostic = null) {
  const io = diagnostic || (isRecord(expected) && (expected.bootstrap_io || expected.bootstrapIo));
  if (io) recordBootstrapIo(io, 'current_projection_reads');
  const checked = validateCurrentProjection(projection);
  if (!checked.ok) {
    if (io) {
      recordBootstrapIo(io, 'stale_current_projections');
      setBootstrapEscalationReason(io, 'current_state_conflict');
    }
    return result(false, 'CURRENT_STALE', { reason: checked.code });
  }
  if (!isRecord(expected)) {
    if (io) {
      recordBootstrapIo(io, 'stale_current_projections');
      setBootstrapEscalationReason(io, 'stale_current_projection');
    }
    return result(false, 'CURRENT_STALE', { reason: 'LIVE_CURRENT_UNAVAILABLE' });
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'projection_digest')
    && (!isDigest(expected.projection_digest) || expected.projection_digest !== projection.projection_digest)) {
    if (io) {
      recordBootstrapIo(io, 'stale_current_projections');
      setBootstrapEscalationReason(io, 'stale_current_projection');
    }
    return result(false, 'CURRENT_STALE', { reason: 'CURRENT_DIGEST_MISMATCH' });
  }
  const fields = ['repository', 'controller_revision', 'canonical_main', 'programme', 'run', 'lock', 'gate', 'repair_count', 'candidate', 'hold', 'in_flight', 'controlling_receipt', 'next_admissible_action'];
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(expected, field));
  if (!Object.prototype.hasOwnProperty.call(expected, 'projection_digest') && present.length !== fields.length) {
    if (io) {
      recordBootstrapIo(io, 'stale_current_projections');
      setBootstrapEscalationReason(io, 'stale_current_projection');
    }
    return result(false, 'CURRENT_STALE', { reason: 'CURRENT_IDENTITY_INCOMPLETE' });
  }
  if (!compareFields(projection, expected, present)) {
    if (io) {
      recordBootstrapIo(io, 'stale_current_projections');
      setBootstrapEscalationReason(io, 'stale_current_projection');
    }
    return result(false, 'CURRENT_STALE', { reason: 'CURRENT_BINDING_MISMATCH' });
  }
  return result(true, 'CURRENT_FRESH', { projection: checked.projection });
}

function transitionCurrent(projection, changes = {}) {
  const checked = validateCurrentProjection(projection);
  if (!checked.ok) return result(false, 'CURRENT_STALE', { reason: checked.code });
  if (!isRecord(changes)) return result(false, 'CURRENT_TRANSITION_INVALID');
  const next = {};
  for (const key of CURRENT_DIGEST_KEYS) {
    if (isRecord(changes[key]) && isRecord(projection[key])) next[key] = { ...projection[key], ...clone(changes[key]) };
    else if (Object.prototype.hasOwnProperty.call(changes, key)) next[key] = clone(changes[key]);
    else next[key] = clone(projection[key]);
  }
  return createCurrentProjection(next);
}

function transitionAndReadback(options = {}) {
  const transitioned = transitionCurrent(options.current || options.projection, options.changes || {});
  if (!transitioned.ok) return transitioned;
  if (!options.readback) return result(false, 'CURRENT_READBACK_REQUIRED', { projection: transitioned.projection });
  const readback = typeof options.readback === 'function' ? options.readback(transitioned.projection) : options.readback;
  if (readback && typeof readback.then === 'function') return result(false, 'CURRENT_READBACK_UNAVAILABLE');
  const checked = validateCurrentProjection(readback);
  if (!checked.ok || checked.projection.projection_digest !== transitioned.projection.projection_digest) return result(false, 'CURRENT_READBACK_MISMATCH', { expected: transitioned.projection, observed: checked.projection || null });
  return result(true, 'CURRENT_TRANSITION_READBACK_VERIFIED', { before: options.current || options.projection, projection: checked.projection });
}

function graphCell(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n\t]+/g, ' ');
}

function graphCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function graphIssue(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function graphStringList(value, max = 512) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const values = [];
  for (const item of value) {
    if (!safeText(item, max)) return null;
    if (!values.includes(item)) values.push(item);
  }
  return values.sort(graphCompare);
}

function normalizeGraphNativeIssue(value, repository) {
  if (value === undefined || value === null) return null;
  const source = Number.isSafeInteger(value) ? { number: value } : isRecord(value) ? value : null;
  if (!source) return null;
  const number = graphIssue(source.number ?? source.issue ?? source.id);
  const issueRepository = source.repository === undefined ? repository : source.repository;
  if (number === null || !safeText(issueRepository)) return null;
  return { repository: issueRepository, number };
}

function normalizeGraphDeliveryPr(value, repository) {
  if (value === undefined || value === null) return null;
  const source = Number.isSafeInteger(value) ? { number: value } : isRecord(value) ? value : null;
  if (!source) return null;
  const number = graphIssue(source.number ?? source.pr ?? source.id);
  const prRepository = source.repository === undefined ? repository : source.repository;
  const status = source.status === undefined || source.status === null ? 'UNKNOWN' : String(source.status).toUpperCase();
  const role = source.role === undefined || source.role === null ? null : source.role;
  const reference = source.reference ?? source.url ?? null;
  if (number === null || !safeText(prRepository) || !PROGRAMME_GRAPH_PR_STATES.includes(status)
    || (role !== null && !safeText(role)) || (reference !== null && !safeText(reference, 1024))) return null;
  if (source.completes_child !== undefined && typeof source.completes_child !== 'boolean') return null;
  return {
    repository: prRepository,
    number,
    status,
    role,
    completes_child: source.completes_child === true,
    reference,
  };
}

function normalizeGraphSections(value) {
  if (value === undefined || value === null) return [];
  if (!isRecord(value) && !Array.isArray(value)) return null;
  const sections = [];
  const reserved = new Set(['children', 'current-children', 'current-programme-children', 'pr-history', 'runs', 'locks', 'ci', 'foundation', 'programme-graph']);
  const entries = Array.isArray(value)
    ? value.map((raw) => [raw?.id, raw])
    : Object.keys(value).sort(graphCompare).map((id) => [id, value[id]]);
  for (const [id, raw] of entries.sort((left, right) => graphCompare(String(left[0]), String(right[0]))) ) {
    if (!safeId(id)) return null;
    const normalizedId = id.toLowerCase().replace(/_/g, '-');
    if (reserved.has(normalizedId)) return null;
    const source = isRecord(raw) ? raw : { items: raw };
    const title = source.title === undefined ? id : source.title;
    const items = graphStringList(source.items);
    if (!safeText(title) || items === null) return null;
    if (items.length === 0) continue;
    sections.push({ id, title, items });
  }
  return sections;
}

function structuralAuthorityIssue(raw, aliases, repository, expectedNumber) {
  const present = aliases.filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
  if (present.length > 1) return true;
  if (present.length === 0) return expectedNumber !== null;
  const value = raw[present[0]];
  if (expectedNumber === null) return value !== null && value !== undefined;
  const normalized = normalizeGraphNativeIssue(value, repository);
  return !normalized || normalized.number !== expectedNumber || normalized.repository !== repository;
}

function trustedProgrammeStructuralAdmission(input, options = {}) {
  if (!isRecord(input) || input.repository !== 'weijunswj/ai-agent-toolkit') return result(true, 'STRUCTURAL_SCOPE_NOT_APPLICABLE');
  const programme = isRecord(input.programme) ? input.programme : isRecord(input.parent) ? input.parent : {};
  const programmeIssue = graphIssue(programme.issue ?? programme.parent_issue ?? input.parent_issue);
  const programmeId = programme.id ?? programme.programme_id ?? input.programme_id;
  if (programmeIssue !== 421 && programmeId !== 'programme-421') return result(true, 'STRUCTURAL_SCOPE_NOT_APPLICABLE');
  const outcomes = Array.isArray(input.outcomes)
    ? input.outcomes
    : Array.isArray(input.registered_outcomes)
      ? input.registered_outcomes
      : Array.isArray(programme.outcomes) ? programme.outcomes : null;
  if (!outcomes) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_INVALID');
  const seen = new Set();
  for (const raw of outcomes) {
    if (!isRecord(raw)) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_INVALID');
    const idAliases = ['id', 'outcome_id', 'outcomeId'].filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
    const deliveryAliases = ['delivery_pr', 'deliveryPr', 'delivery_pr_pointer', 'pr'].filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
    const gateAliases = ['current_gate', 'currentGate'].filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
    if (idAliases.length > 1 || deliveryAliases.length > 1 || gateAliases.length > 1) {
      return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION', { field: 'duplicate_authority_alias' });
    }
    const nativeSource = raw.native_issue ?? raw.nativeIssue ?? (graphIssue(raw.issue) === null ? null : { number: raw.issue });
    const nativeIssue = nativeSource === null ? null : normalizeGraphNativeIssue(nativeSource, input.repository);
    const id = raw.id ?? raw.outcome_id ?? raw.outcomeId
      ?? (nativeIssue === null ? null : `child-${nativeIssue.number}`);
    const expected = PROGRAMME_421_STRUCTURAL_EXPECTATIONS[id];
    if (!expected || seen.has(id)) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION', { id });
    seen.add(id);
    if (Object.prototype.hasOwnProperty.call(raw, 'kind') && String(raw.kind).toUpperCase() !== expected.kind) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION', { id, field: 'kind' });
    if (Object.prototype.hasOwnProperty.call(raw, 'materialized') && raw.materialized !== expected.materialized) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION', { id, field: 'materialized' });
    const eligibilityAliases = ['execution_eligible', 'executionEligible'];
    const eligibilityPresent = eligibilityAliases.filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
    if (eligibilityPresent.length > 1 || eligibilityPresent.length === 1 && raw[eligibilityPresent[0]] !== expected.execution_eligible) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION', { id, field: 'execution_eligible' });
    if (structuralAuthorityIssue(raw, ['native_issue', 'nativeIssue', 'issue'], input.repository, expected.native_issue)) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_CONTRADICTION', { id, field: 'native_issue' });
    if (!expected.execution_eligible) {
      if (deliveryAliases.some((key) => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== null && raw[key] !== undefined)
        || gateAliases.some((key) => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== null && raw[key] !== undefined)
        || raw.launch_allowed === true || raw.launchAllowed === true) {
        return result(false, 'PROGRAMME_GRAPH_OPERATIONAL_CLAIM_REJECTED', { id });
      }
    }
  }
  const expectedIds = PROGRAMME_421_PROOF_OUTCOME_IDS;
  if (seen.size !== expectedIds.length || expectedIds.some((id) => !seen.has(id))) return result(false, 'PROGRAMME_GRAPH_STRUCTURAL_SET_INVALID');
  return result(true, 'PROGRAMME_GRAPH_STRUCTURAL_ADMITTED', { evidence_only: options.evidenceOnly === true });
}

function normalizeProgrammeGraphSnapshotInternal(input = {}, options = {}) {
  if (!isRecord(input) || !safeText(input.repository)) return result(false, 'PROGRAMME_GRAPH_SNAPSHOT_INVALID');
  const structural = trustedProgrammeStructuralAdmission(input, options);
  if (!structural.ok) return structural;
  const sourceProgramme = isRecord(input.programme) ? input.programme : isRecord(input.parent) ? input.parent : {};
  const programmeIssue = graphIssue(sourceProgramme.issue ?? sourceProgramme.parent_issue ?? input.parent_issue);
  const programmeIdValue = sourceProgramme.id ?? sourceProgramme.programme_id ?? input.programme_id
    ?? (programmeIssue === null ? null : `programme-${programmeIssue}`);
  const programmeId = safeId(programmeIdValue) ? programmeIdValue : null;
  const title = sourceProgramme.title ?? input.title;
  const objective = sourceProgramme.objective ?? sourceProgramme.goal ?? input.objective ?? null;
  const lifecycle = sourceProgramme.lifecycle ?? input.lifecycle ?? 'ACTIVE';
  const finality = sourceProgramme.finality ?? input.finality ?? 'PENDING';
  const labels = graphStringList(sourceProgramme.labels ?? input.labels, 128);
  const boundaries = graphStringList(sourceProgramme.boundaries ?? input.boundaries);
  const holds = graphStringList(sourceProgramme.holds ?? input.holds);
  const nextAction = sourceProgramme.next_action ?? sourceProgramme.nextAction ?? input.next_action ?? null;
  const sections = normalizeGraphSections(sourceProgramme.sections ?? input.sections);
  if (programmeId === null || !safeText(title) || (objective !== null && !safeText(objective, 2048))
    || !safeText(lifecycle, 128) || !safeText(finality, 128) || labels === null || boundaries === null || holds === null
    || (nextAction !== null && !safeText(nextAction, 2048)) || sections === null) {
    return result(false, 'PROGRAMME_GRAPH_SNAPSHOT_INVALID');
  }

  const rawOutcomes = Array.isArray(input.outcomes)
    ? input.outcomes
    : Array.isArray(input.registered_outcomes)
      ? input.registered_outcomes
      : Array.isArray(sourceProgramme.outcomes) ? sourceProgramme.outcomes : null;
  if (rawOutcomes === null) return result(false, 'PROGRAMME_GRAPH_OUTCOMES_INVALID');
  const outcomes = [];
  for (let index = 0; index < rawOutcomes.length; index += 1) {
    const raw = rawOutcomes[index];
    if (!isRecord(raw)) return result(false, 'PROGRAMME_GRAPH_OUTCOME_INVALID', { index });
    const nativeSource = raw.native_issue ?? raw.nativeIssue
      ?? (graphIssue(raw.issue) === null ? null : { number: raw.issue });
    const nativeIssue = normalizeGraphNativeIssue(nativeSource, input.repository);
    const deliverySource = raw.delivery_pr ?? raw.deliveryPr ?? raw.delivery_pr_pointer ?? raw.pr ?? null;
    const deliveryPr = normalizeGraphDeliveryPr(deliverySource, input.repository);
    const materialized = typeof raw.materialized === 'boolean' ? raw.materialized : nativeSource !== null;
    const kindValue = raw.kind === undefined || raw.kind === null
      ? (nativeIssue === null ? 'OUTCOME' : 'CHILD') : String(raw.kind).toUpperCase();
    const kind = PROGRAMME_GRAPH_KINDS.includes(kindValue) ? kindValue : null;
    const issueId = nativeIssue === null ? null : `child-${nativeIssue.number}`;
    const idValue = raw.id ?? raw.outcome_id ?? raw.outcomeId ?? issueId;
    const id = safeId(idValue) ? idValue : null;
    const order = Number.isSafeInteger(raw.order) && raw.order >= 1 ? raw.order : index + 1;
    const outcomeTitle = raw.title ?? raw.name ?? id;
    const lifecycleValue = raw.lifecycle ?? (materialized ? 'QUEUED' : 'PLANNED');
    const lifecycle = typeof lifecycleValue === 'string' ? lifecycleValue.toUpperCase() : null;
    const hasCompleteWhen = Object.prototype.hasOwnProperty.call(raw, 'complete_when')
      || Object.prototype.hasOwnProperty.call(raw, 'completeWhen');
    const completeWhenSource = Object.prototype.hasOwnProperty.call(raw, 'complete_when') ? raw.complete_when : raw.completeWhen;
    const completeWhen = hasCompleteWhen ? completeWhenSource
      : Array.isArray(raw.done_when) && raw.done_when.length === 1 ? raw.done_when[0] : undefined;
    const hasCurrentGate = Object.prototype.hasOwnProperty.call(raw, 'current_gate')
      || Object.prototype.hasOwnProperty.call(raw, 'currentGate');
    const currentGateSource = Object.prototype.hasOwnProperty.call(raw, 'current_gate') ? raw.current_gate : raw.currentGate;
    const currentGate = hasCurrentGate ? normalizeGraphCurrentGate(currentGateSource) : null;
    const rawDependencies = raw.dependencies ?? [];
    if (!Array.isArray(rawDependencies)) return result(false, 'PROGRAMME_GRAPH_DEPENDENCIES_INVALID', { id });
    const dependencies = [];
    for (const dependency of rawDependencies) {
      const dependencyId = Number.isSafeInteger(dependency) ? `child-${dependency}` : dependency;
      if (!safeId(dependencyId) || dependencyId === id || dependencies.includes(dependencyId)) {
        return result(false, 'PROGRAMME_GRAPH_DEPENDENCIES_INVALID', { id });
      }
      dependencies.push(dependencyId);
    }
    if (id === null || kind === null || !safeText(outcomeTitle) || !safeText(completeWhen, 2048)
      || currentGate === undefined || !PROGRAMME_GRAPH_LIFECYCLES.includes(lifecycle)
      || nativeSource !== null && nativeIssue === null
      || kind === 'CHILD' && materialized && nativeIssue === null) {
      return result(false, 'PROGRAMME_GRAPH_OUTCOME_INVALID', { index, id });
    }
    outcomes.push({
      id,
      order,
      kind,
      title: outcomeTitle,
      materialized,
      lifecycle,
      dependencies: dependencies.sort(graphCompare),
      native_issue: nativeIssue,
      delivery_pr: deliveryPr,
      current_gate: currentGate,
      complete_when: completeWhen,
    });
  }
  outcomes.sort((left, right) => left.order - right.order || graphCompare(left.id, right.id));
  const ids = new Set();
  const orders = new Set();
  const nativeIssues = new Set();
  const deliveryPrs = new Set();
  for (const outcome of outcomes) {
    if (ids.has(outcome.id) || orders.has(outcome.order)) return result(false, 'PROGRAMME_GRAPH_DUPLICATE_MEMBERSHIP', { id: outcome.id });
    ids.add(outcome.id); orders.add(outcome.order);
    if (outcome.native_issue) {
      const nativeKey = `${outcome.native_issue.repository}#${outcome.native_issue.number}`;
      if (nativeIssues.has(nativeKey)) return result(false, 'PROGRAMME_GRAPH_DUPLICATE_NATIVE_ISSUE', { id: outcome.id });
      nativeIssues.add(nativeKey);
    }
    if (outcome.delivery_pr) {
      const prKey = `${outcome.delivery_pr.repository}#${outcome.delivery_pr.number}`;
      if (deliveryPrs.has(prKey)) return result(false, 'PROGRAMME_GRAPH_DUPLICATE_DELIVERY_PR', { id: outcome.id });
      deliveryPrs.add(prKey);
    }
  }
  for (const outcome of outcomes) for (const dependency of outcome.dependencies) {
    if (!ids.has(dependency)) return result(false, 'PROGRAMME_GRAPH_DEPENDENCY_UNKNOWN', { id: outcome.id, dependency });
  }

  const snapshot = {
    schema: SCHEMAS.programmeSnapshot,
    version: 1,
    repository: input.repository,
    programme: {
      id: programmeId,
      issue: programmeIssue,
      title,
      objective,
      lifecycle,
      finality,
      labels,
      boundaries,
      holds,
      next_action: nextAction,
      sections,
    },
    outcomes,
  };
  const graphBase = {
    schema: SCHEMAS.programmeGraph,
    version: 1,
    repository: input.repository,
    programme: { id: programmeId, issue: programmeIssue, title, lifecycle, finality },
    outcomes,
  };
  const graph = { ...graphBase, graph_digest: kernel.digestValue(graphBase) };
  return result(true, 'PROGRAMME_GRAPH_SNAPSHOT_READY', { snapshot, graph });
}

function validateProgrammeGraphInternal(value) {
  if (!isRecord(value) || !exactKeys(value, ['schema', 'version', 'repository', 'programme', 'outcomes', 'graph_digest'])
    || value.schema !== SCHEMAS.programmeGraph || value.version !== 1) return result(false, 'PROGRAMME_GRAPH_INVALID');
  const normalized = normalizeProgrammeGraphSnapshotInternal({
    repository: value.repository,
    programme: value.programme,
    outcomes: value.outcomes,
  });
  if (!normalized.ok || kernel.canonicalSerialize(normalized.graph) !== kernel.canonicalSerialize(value)) {
    return result(false, 'PROGRAMME_GRAPH_INVALID');
  }
  return result(true, 'PROGRAMME_GRAPH_VALID', { graph: clone(value) });
}

function publicGraphResult(value, fallbackCode) {
  try {
    if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.code !== 'string' || !publicGraphFieldsSafe(value)) {
      return result(false, fallbackCode);
    }
    return value;
  } catch (_error) {
    return result(false, fallbackCode);
  }
}

function normalizeProgrammeGraphSnapshot(input = {}) {
  if (!publicGraphInputSafe(input)) return result(false, 'PROGRAMME_GRAPH_PUBLIC_INVALID');
  return publicGraphResult(normalizeProgrammeGraphSnapshotInternal(input), 'PROGRAMME_GRAPH_PUBLIC_INVALID');
}

function validateProgrammeGraph(value) {
  if (!publicGraphInputSafe(value)) return result(false, 'PROGRAMME_GRAPH_INVALID');
  return publicGraphResult(validateProgrammeGraphInternal(value), 'PROGRAMME_GRAPH_INVALID');
}

function programmeGraphNativeCell(issue) {
  return issue === null ? '-' : '#' + issue.number + (issue.repository ? ' (' + issue.repository + ')' : '');
}

function programmeGraphDeliveryCell(pr) {
  return pr === null ? '-' : '#' + pr.number + ' (' + pr.status + ')';
}

function normalizeGraphCurrentGate(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const gate = value.gate ?? value.stage ?? null;
  let repair = value.repair;
  if (repair === undefined && Number.isSafeInteger(value.repair_number)) repair = value.repair_number;
  if (repair === undefined && isRecord(value.repair_count)) repair = value.repair_count.used;
  if (repair === undefined) repair = null;
  if (!safeText(gate, 128) || (repair !== null && (!Number.isSafeInteger(repair) || repair < 0))) return undefined;
  return { gate, repair };
}

function programmeGraphCurrentGateCell(outcome) {
  if (outcome.current_gate !== null && outcome.materialized && outcome.lifecycle === 'CURRENT') {
    return outcome.current_gate.repair === null
      ? outcome.current_gate.gate
      : outcome.current_gate.gate + ' Repair-' + outcome.current_gate.repair;
  }
  if (outcome.lifecycle === 'COMPLETED') return 'Complete';
  if (outcome.lifecycle === 'HELD' || outcome.dependencies.length > 0) return 'Blocked';
  if (outcome.kind === 'OUTCOME') return 'Parent-owned';
  return 'Not admitted';
}

function programmeGraphDependencyCell(outcome) {
  return outcome.dependencies.length ? 'blocked by ' + outcome.dependencies.join(', ') : null;
}

function programmeGraphCurrentWorkCell(outcome) {
  const parts = [];
  if (outcome.native_issue !== null) parts.push('#' + outcome.native_issue.number);
  if (outcome.delivery_pr !== null) parts.push('PR #' + outcome.delivery_pr.number);
  const dependency = programmeGraphDependencyCell(outcome);
  if (dependency !== null) parts.push(dependency);
  if (parts.length === 0) return outcome.kind === 'OUTCOME' ? 'Parent-owned' : 'Not admitted';
  if (outcome.kind === 'OUTCOME' && outcome.delivery_pr === null && outcome.dependencies.length === 0) parts.push('Parent-owned');
  return parts.join(' · ');
}

function programmeSurfaceView(value) {
  const source = isRecord(value) && isRecord(value.surface) ? value.surface : value;
  if (!isRecord(source) || typeof source.title !== 'string' || typeof source.body !== 'string'
    || !Array.isArray(source.labels) || !Array.isArray(source.parent_registry)) return null;
  return {
    title: source.title,
    body: source.body,
    labels: clone(source.labels),
    parent_registry: clone(source.parent_registry),
  };
}

function renderProgrammeGraphRaw(normalized) {
  const { snapshot, graph } = normalized;
  const programme = snapshot.programme;
  const lines = [
    '# ' + graphCell(programme.title),
    '',
    '## Programme status',
    '| Field | Value |',
    '| --- | --- |',
    '| Programme | ' + graphCell(programme.id) + ' |',
    '| Repository | ' + graphCell(snapshot.repository) + ' |',
    '| Parent issue | ' + graphCell(programme.issue === null ? null : '#' + programme.issue) + ' |',
    '| Lifecycle | ' + graphCell(programme.lifecycle) + ' |',
    '| Finality | ' + graphCell(programme.finality) + ' |',
    '| Registered outcomes | ' + graphCell(graph.outcomes.length) + ' |',
    '| Materialised outcomes | ' + graphCell(graph.outcomes.filter((item) => item.materialized).length) + ' |',
    '',
    '## Programme Graph',
    '| Outcome | Status | Current gate | Current work | Complete when |',
    '| --- | --- | --- | --- | --- |',
  ];
  if (graph.outcomes.length === 0) lines.push('| - | - | - | - | - |');
  for (const outcome of graph.outcomes) {
    lines.push('| ' + graphCell(outcome.id + ': ' + outcome.title)
      + ' | ' + graphCell(outcome.lifecycle)
      + ' | ' + graphCell(programmeGraphCurrentGateCell(outcome))
      + ' | ' + graphCell(programmeGraphCurrentWorkCell(outcome))
      + ' | ' + graphCell(outcome.complete_when) + ' |');
  }
  if (programme.objective !== null) lines.push('', '## Programme objective', graphCell(programme.objective));
  if (programme.labels.length) lines.push('', '## Programme labels', ...programme.labels.map((label) => '- ' + graphCell(label)));
  if (programme.boundaries.length) lines.push('', '## Programme boundaries', ...programme.boundaries.map((item) => '- ' + graphCell(item)));
  if (programme.holds.length) lines.push('', '## Programme holds', ...programme.holds.map((item) => '- ' + graphCell(item)));
  if (programme.next_action !== null) lines.push('', '## Programme next action', '- ' + graphCell(programme.next_action));
  for (const section of programme.sections) lines.push('', '## ' + graphCell(section.title), ...section.items.map((item) => '- ' + graphCell(item)));

  const body = lines.join('\n');
  const parentRegistry = graph.outcomes.map((outcome) => ({
    outcome_id: outcome.id,
    order: outcome.order,
    kind: outcome.kind,
    title: outcome.title,
    materialized: outcome.materialized,
    lifecycle: outcome.lifecycle,
    dependencies: outcome.dependencies.slice(),
    native_issue: clone(outcome.native_issue),
    delivery_pr: clone(outcome.delivery_pr),
    current_gate: clone(outcome.current_gate),
    complete_when: outcome.complete_when,
  }));
  const surface = {
    title: programme.title,
    body,
    labels: programme.labels.slice(),
    parent_registry: parentRegistry,
  };
  return result(true, 'PROGRAMME_GRAPH_RENDER_READY', {
    graph: clone(graph),
    canonical_snapshot: clone(snapshot),
    canonical_snapshot_digest: kernel.digestValue(snapshot),
    graph_digest: graph.graph_digest,
    title: surface.title,
    body: surface.body,
    labels: surface.labels,
    parent_registry: surface.parent_registry,
    surface,
  });
}

const PUBLIC_GRAPH_SENSITIVE_KEY = /(?:access[_ -]?token|api[_ -]?key|authorization|client[_ -]?secret|cookie|credential|password|private[_ -]?key|secret|token)/i;
const PUBLIC_GRAPH_SENSITIVE_VALUE = /(?:^|[\s"'`])(?:access[_ -]?token|api[_ -]?key|authorization|client[_ -]?secret|password|private[_ -]?key|secret|token)\s*[:=]/i;
const PUBLIC_GRAPH_BEARER_VALUE = /\bbearer\s+[A-Za-z0-9._~+/=-]+/i;
const PUBLIC_GRAPH_GITHUB_TOKEN = /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+/i;
const PUBLIC_GRAPH_PRIVATE_PATH = /(?:file:\/\/|data:|(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|private|etc|var|tmp|opt|srv)(?:[\\/]|$)))/i;
const PUBLIC_GRAPH_PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const PUBLIC_GRAPH_MARKUP_ESCAPE = /<!--|--!?>|```/;
const PUBLIC_GRAPH_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PUBLIC_GRAPH_AUTHORITY_KEYS = new Set([
  'kind', 'materialized', 'execution_eligible', 'executionEligible', 'id', 'outcome_id', 'outcomeId',
  'native_issue', 'nativeIssue', 'delivery_pr', 'deliveryPr', 'delivery_pr_pointer', 'pr',
  'current_gate', 'currentGate', 'gate', 'stage', 'authorised_stage', 'authorized_stage',
  'next_admissible_action', 'nextAction', 'candidate', 'run', 'lock', 'controller_revision',
  'repository_test_invocation', 'repositoryTestInvocation', 'resourceState', 'resource_state',
  'resources', 'resource', 'route_available', 'capability_available', 'ownership_admitted', 'fence_valid',
]);

function inheritedPublicAuthority(value) {
  if (!isRecord(value)) return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch (_error) { return true; }
  while (prototype !== null) {
    for (const key of PUBLIC_GRAPH_AUTHORITY_KEYS) {
      try {
        if (Object.prototype.hasOwnProperty.call(prototype, key)) return true;
      } catch (_error) { return true; }
    }
    try { prototype = Object.getPrototypeOf(prototype); } catch (_error) { return true; }
  }
  return false;
}

function publicGraphUnsafe() {
  const error = new Error('PUBLIC_DATA_UNSAFE');
  error.code = 'PUBLIC_DATA_UNSAFE';
  error.h2_code = 'PUBLIC_DATA_UNSAFE';
  throw error;
}

function publicGraphTextSafe(value, allowLineBreaks = false) {
  if (typeof value !== 'string') return false;
  if (PUBLIC_GRAPH_CONTROL.test(value) || (!allowLineBreaks && /[\r\n]/.test(value))) return false;
  return !PUBLIC_GRAPH_SENSITIVE_VALUE.test(value)
    && !PUBLIC_GRAPH_BEARER_VALUE.test(value)
    && !PUBLIC_GRAPH_GITHUB_TOKEN.test(value)
    && !PUBLIC_GRAPH_PRIVATE_PATH.test(value)
    && !PUBLIC_GRAPH_PRIVATE_KEY.test(value)
    && !PUBLIC_GRAPH_MARKUP_ESCAPE.test(value);
}

function publicGraphFieldsSafe(value, key = '') {
  if (typeof value === 'string') return publicGraphTextSafe(value, key === 'body');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.every((item) => publicGraphFieldsSafe(item, key));
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((field) => {
    if (typeof field !== 'string' || PUBLIC_GRAPH_SENSITIVE_KEY.test(field)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return Boolean(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      && publicGraphFieldsSafe(descriptor.value, field);
  });
}

function publicGraphInputSafe(value, key = '') {
  if (value === undefined) return true;
  if (typeof value === 'string') return publicGraphTextSafe(value, key === 'body');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.every((item) => publicGraphInputSafe(item, key));
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (inheritedPublicAuthority(value)) return false;
  return Reflect.ownKeys(value).every((field) => {
    if (typeof field !== 'string' || PUBLIC_GRAPH_SENSITIVE_KEY.test(field)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return Boolean(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      && publicGraphInputSafe(descriptor.value, field);
  });
}

function splitProgrammeGraphTableRow(line) {
  if (typeof line !== 'string' || !line.startsWith('|') || !line.endsWith('|')) return null;
  const cells = [];
  let current = '';
  let escaped = false;
  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index];
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      current += character;
      escaped = true;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  cells.push(current.trim());
  return cells;
}

function validateProgrammeGraphMarkdown(rendered) {
  if (!isRecord(rendered) || rendered.ok !== true || !isRecord(rendered.graph) || typeof rendered.body !== 'string') return false;
  const body = rendered.body;
  if (!body || /\r|\u0000/.test(body) || body.endsWith('\n')) return false;
  const lines = body.split('\n');
  const statusHeading = lines.indexOf('## Programme status');
  const graphHeading = lines.indexOf('## Programme Graph');
  if (statusHeading !== 2 || graphHeading <= statusHeading || lines.filter((line) => line === '## Programme status').length !== 1
    || lines.filter((line) => line === '## Programme Graph').length !== 1) return false;
  if (lines[0] !== '# ' + graphCell(rendered.graph.programme.title)) return false;
  if (lines[statusHeading + 1] !== '| Field | Value |' || lines[statusHeading + 2] !== '| --- | --- |') return false;
  if (lines[graphHeading + 1] !== '| Outcome | Status | Current gate | Current work | Complete when |'
    || lines[graphHeading + 2] !== '| --- | --- | --- | --- | --- |') return false;
  const rows = [];
  for (let index = graphHeading + 3; index < lines.length && !lines[index].startsWith('## '); index += 1) {
    if (lines[index].trim() === '') continue;
    const cells = splitProgrammeGraphTableRow(lines[index]);
    if (!cells) return false;
    rows.push(cells);
  }
  const outcomes = rendered.graph.outcomes;
  if (outcomes.length === 0) return rows.length === 1 && rows[0].length === 5 && rows[0].every((cell) => cell === '-');
  if (rows.length !== outcomes.length) return false;
  const ids = new Set();
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    const expected = [
      graphCell(outcome.id + ': ' + outcome.title),
      graphCell(outcome.lifecycle),
      graphCell(programmeGraphCurrentGateCell(outcome)),
      graphCell(programmeGraphCurrentWorkCell(outcome)),
      graphCell(outcome.complete_when),
    ];
    if (rows[index].length !== expected.length || rows[index].some((cell, cellIndex) => cell !== expected[cellIndex])) return false;
    if (ids.has(outcome.id)) return false;
    ids.add(outcome.id);
  }
  return ids.size === outcomes.length;
}

function renderProgrammeGraphPublic(input = {}, options = {}) {
  if (input !== null && input !== undefined && !publicGraphInputSafe(input)) publicGraphUnsafe();
  let normalized;
  try { normalized = publicGraphResult(normalizeProgrammeGraphSnapshotInternal(input, options), 'PROGRAMME_GRAPH_PUBLIC_INVALID'); }
  catch (_error) { return result(false, 'PROGRAMME_GRAPH_PUBLIC_INVALID'); }
  if (!normalized.ok) return result(false, normalized.code);
  let rendered;
  try { rendered = renderProgrammeGraphRaw(normalized); }
  catch (_error) { return result(false, 'PROGRAMME_GRAPH_PUBLIC_INVALID'); }
  if (!validateProgrammeGraphMarkdown(rendered) || !publicGraphFieldsSafe(rendered)) publicGraphUnsafe();
  return rendered;
}

function programmeProofFieldMap(snapshot) {
  return {
    programme: {
      id: snapshot.programme.id,
      issue: snapshot.programme.issue,
      title: snapshot.programme.title,
      objective: snapshot.programme.objective,
      labels: snapshot.programme.labels,
      boundaries: snapshot.programme.boundaries,
      holds: snapshot.programme.holds,
    },
    outcomes: Object.fromEntries(snapshot.outcomes.map((outcome) => [outcome.id, {
      id: outcome.id,
      order: outcome.order,
      kind: outcome.kind,
      title: outcome.title,
      materialized: outcome.materialized,
      dependencies: outcome.dependencies,
      native_issue: outcome.native_issue,
      complete_when: outcome.complete_when,
    }])),
    execution_authority: { Q: 'NON_EXECUTING' },
  };
}

function structuralProofFieldMap(value) {
  if (!isRecord(value) || !isRecord(value.programme) || !isRecord(value.outcomes) || !isRecord(value.execution_authority)) return null;
  const programme = value.programme;
  const outcomes = Object.fromEntries(Object.entries(value.outcomes).map(([id, outcome]) => [id, {
    id: outcome?.id,
    order: outcome?.order,
    kind: outcome?.kind,
    title: outcome?.title,
    materialized: outcome?.materialized,
    dependencies: outcome?.dependencies,
    native_issue: outcome?.native_issue,
    complete_when: outcome?.complete_when,
  }]));
  return {
    programme: {
      id: programme.id,
      issue: programme.issue,
      title: programme.title,
      objective: programme.objective,
      labels: programme.labels,
      boundaries: programme.boundaries,
      holds: programme.holds,
    },
    outcomes,
    execution_authority: { Q: value.execution_authority.Q },
  };
}

function validateStructuralCheckpoint(fixture, sourceEvidence) {
  const checkpoint = fixture.structural_checkpoint;
  if (!isRecord(checkpoint) || !exactKeys(checkpoint, [
    'schema', 'version', 'serialization', 'payload_ref', 'payload_sha256', 'candidate_git', 'captured_source_hashes_ref',
  ]) || checkpoint.schema !== PROGRAMME_421_PROOF_CHECKPOINT_SCHEMA
    || checkpoint.version !== 1
    || checkpoint.serialization !== PROGRAMME_421_PROOF_CHECKPOINT_SERIALIZATION
    || checkpoint.payload_ref !== 'source_evidence.field_map'
    || checkpoint.payload_sha256 !== PROGRAMME_421_PROOF_FIELD_MAP_DIGEST
    || checkpoint.captured_source_hashes_ref !== 'source_receipts'
    || !isRecord(checkpoint.candidate_git)
    || !exactKeys(checkpoint.candidate_git, ['repository', 'commit', 'path', 'blob'])
    || kernel.canonicalSerialize(checkpoint.candidate_git) !== kernel.canonicalSerialize(PROGRAMME_421_PROOF_CHECKPOINT_CANDIDATE)) return false;
  const captured = structuralProofFieldMap(sourceEvidence?.field_map);
  try { return captured !== null && kernel.digestValue(captured) === checkpoint.payload_sha256; }
  catch (_error) { return false; }
}

function validateProgrammeGraphProof(fixture) {
  const invalid = (reason) => result(false, 'PROGRAMME_GRAPH_PROOF_INVALID', { reason });
  if (!isRecord(fixture)
    || fixture.schema !== 'toolkit.controller.programme-421-proof.v1'
    || fixture.version !== 1
    || fixture.repository !== 'weijunswj/ai-agent-toolkit'
    || fixture.controller_revision !== 'af14f91b0f6335212003a37a5119f233489e598f'
    || !isRecord(fixture.source_receipts)) return invalid('FIXTURE_SHAPE_INVALID');
  const sourceKeys = Object.keys(PROGRAMME_421_PROOF_SOURCE_HASHES);
  if (Object.keys(fixture.source_receipts).length !== sourceKeys.length) return invalid('SOURCE_RECEIPT_SET_INVALID');
  for (const [key, expected] of Object.entries(PROGRAMME_421_PROOF_SOURCE_HASHES)) {
    if (fixture.source_receipts[key] !== expected) return invalid(`SOURCE_RECEIPT_${key.toUpperCase()}_MISMATCH`);
  }
  const sourceEvidence = fixture.source_evidence;
  const sourceKeysExact = Object.keys(PROGRAMME_421_PROOF_SOURCE_HASHES);
  if (!isRecord(sourceEvidence) || !exactKeys(sourceEvidence, ['schema', 'source_references', 'field_map', 'field_map_digest'])
    || sourceEvidence.schema !== 'toolkit.controller.programme-421-source-evidence.v1'
    || !isRecord(sourceEvidence.source_references) || !exactKeys(sourceEvidence.source_references, sourceKeysExact)
    || !isRecord(sourceEvidence.field_map) || !exactKeys(sourceEvidence.field_map, ['programme', 'outcomes', 'execution_authority'])
    || !isDigest(sourceEvidence.field_map_digest)
    || sourceEvidence.field_map_digest !== PROGRAMME_421_PROOF_FIELD_MAP_DIGEST) return invalid('SOURCE_EVIDENCE_SHAPE_INVALID');
  if (!validateStructuralCheckpoint(fixture, sourceEvidence)) return invalid('STRUCTURAL_CHECKPOINT_INVALID');
  for (const key of sourceKeysExact) {
    const reference = sourceEvidence.source_references[key];
    if (!isRecord(reference) || !exactKeys(reference, ['reference', 'sha256'])
      || kernel.canonicalSerialize(reference) !== kernel.canonicalSerialize(PROGRAMME_421_PROOF_SOURCE_REFERENCES[key])
      || reference.sha256 !== fixture.source_receipts[key]) return invalid(`SOURCE_REFERENCE_${key.toUpperCase()}_MISMATCH`);
  }
  try {
    const capturedFieldMap = structuralProofFieldMap(sourceEvidence.field_map);
    if (!capturedFieldMap || kernel.digestValue(capturedFieldMap) !== PROGRAMME_421_PROOF_FIELD_MAP_DIGEST) return invalid('SOURCE_FIELD_MAP_DIGEST_MISMATCH');
  } catch (_error) { return invalid('SOURCE_FIELD_MAP_INVALID'); }
  const canonical = fixture.canonical_snapshot || fixture.canonical_input;
  if (!isRecord(canonical)) return invalid('CANONICAL_SNAPSHOT_MISSING');
  if (!exactKeys(canonical, ['schema', 'version', 'repository', 'programme', 'outcomes'])
    || !isRecord(canonical.programme)
    || !exactKeys(canonical.programme, ['id', 'issue', 'title', 'objective', 'lifecycle', 'finality', 'labels', 'boundaries', 'holds', 'next_action', 'sections'])
    || !Array.isArray(canonical.outcomes)
    || !canonical.outcomes.every((outcome) => isRecord(outcome)
      && exactKeys(outcome, ['id', 'order', 'kind', 'title', 'materialized', 'lifecycle', 'dependencies', 'native_issue', 'delivery_pr', 'current_gate', 'complete_when']))) {
    return invalid('CANONICAL_SOURCE_SHAPE_INVALID');
  }
  let rendered;
  try { rendered = renderProgrammeGraphPublic(canonical, { evidenceOnly: true }); } catch { return invalid('PUBLIC_RENDER_FAILED'); }
  if (!rendered.ok || !isRecord(rendered.graph) || !isRecord(rendered.canonical_snapshot)) return invalid('CANONICAL_RENDER_INVALID');
  const snapshot = rendered.canonical_snapshot;
  const graph = rendered.graph;
  let actualFieldMap;
  try { actualFieldMap = programmeProofFieldMap(snapshot); }
  catch (_error) { return invalid('SOURCE_FIELD_MAP_DERIVATION_INVALID'); }
  const capturedFieldMap = structuralProofFieldMap(sourceEvidence.field_map);
  if (!capturedFieldMap || kernel.canonicalSerialize(actualFieldMap) !== kernel.canonicalSerialize(capturedFieldMap)) return invalid('SOURCE_FIELD_MAP_MISMATCH');
  if (kernel.digestValue(actualFieldMap.outcomes) !== PROGRAMME_421_PROOF_SOURCE_HASHES.canonical_30_row_payload_sha256) return invalid('CANONICAL_30_ROW_PAYLOAD_DIGEST_MISMATCH');
  if (actualFieldMap.outcomes.A1?.complete_when !== PROGRAMME_421_PROOF_A1_COMPLETE_WHEN) return invalid('A1_SERVICE_TREATMENT_AUTHORITY_INVALID');
  if (sourceEvidence.field_map.execution_authority?.Q !== 'NON_EXECUTING'
    || Object.keys(sourceEvidence.field_map.execution_authority || {}).length !== 1) return invalid('QUEUE_EXECUTION_AUTHORITY_INVALID');
  const snapshotIds = snapshot.outcomes.map((outcome) => outcome.id);
  const graphIds = graph.outcomes.map((outcome) => outcome.id);
  const registryIds = rendered.parent_registry.map((entry) => entry.outcome_id);
  const expectedIds = PROGRAMME_421_PROOF_OUTCOME_IDS;
  const exactIds = (actual) => actual.length === expectedIds.length && actual.every((id, index) => id === expectedIds[index]);
  if (!exactIds(snapshotIds) || !exactIds(graphIds) || !exactIds(registryIds)) return invalid('OUTCOME_ID_SET_OR_ORDER_INVALID');
  if (graph.outcomes.length !== 30 || !validateProgrammeGraph(graph).ok || !validateProgrammeGraphMarkdown(rendered)) return invalid('GRAPH_OR_TABLE_INVALID');
  if (snapshot.programme.id !== 'programme-421' || snapshot.programme.issue !== 421) return invalid('PROGRAMME_AUTHORITY_INVALID');
  if (!Array.isArray(snapshot.programme.labels) || !Array.isArray(snapshot.programme.boundaries)
    || !Array.isArray(snapshot.programme.holds) || !Array.isArray(snapshot.programme.sections)) return invalid('OPTIONAL_SECTION_NORMALISATION_INVALID');
  const outcomes = new Map(graph.outcomes.map((outcome) => [outcome.id, outcome]));
  const child = (id) => outcomes.get(id);
  const c1 = child('C1');
  const c2 = child('C2');
  const c3 = child('C3');
  const queue = child('Q');
  if (!c1 || c1.kind !== 'CHILD' || c1.materialized !== true || c1.dependencies.length !== 0
    || c1.native_issue?.repository !== fixture.repository || c1.native_issue?.number !== 435) return invalid('C1_AUTHORITY_INVALID');
  if (!c2 || c2.kind !== 'CHILD' || c2.materialized !== true
    || c2.native_issue?.number !== 423 || c2.dependencies.length !== 1 || c2.dependencies[0] !== 'C1') return invalid('C2_AUTHORITY_INVALID');
  if (!c3 || c3.kind !== 'CHILD' || c3.materialized !== true
    || c3.native_issue?.number !== 424 || c3.dependencies.length !== 1 || c3.dependencies[0] !== 'C2') return invalid('C3_AUTHORITY_INVALID');
  if (!queue || queue.kind !== 'CHILD' || queue.materialized !== true
    || queue.native_issue?.number !== 425) return invalid('QUEUE_AUTHORITY_INVALID');
  for (const id of expectedIds.filter((outcomeId) => !['C1', 'C2', 'C3', 'Q'].includes(outcomeId))) {
    const outcome = child(id);
    if (!outcome || outcome.kind !== 'OUTCOME' || outcome.materialized !== false
      || outcome.native_issue !== null) return invalid(`PARENT_OWNERSHIP_INVALID_${id}`);
  }
  if (graph.outcomes.some((outcome) => outcome.native_issue?.number === 422 || outcome.native_issue?.number === 434)) return invalid('RETIRED_PREDECESSOR_AUTHORITY_PRESENT');
  let roundTrip;
  try { roundTrip = renderProgrammeGraphPublic(snapshot, { evidenceOnly: true }); } catch { return invalid('ROUND_TRIP_RENDER_FAILED'); }
  if (!roundTrip.ok || roundTrip.body !== rendered.body || roundTrip.graph_digest !== rendered.graph_digest
    || roundTrip.canonical_snapshot_digest !== rendered.canonical_snapshot_digest
    || kernel.canonicalSerialize(roundTrip.graph) !== kernel.canonicalSerialize(rendered.graph)
    || kernel.canonicalSerialize(roundTrip.canonical_snapshot) !== kernel.canonicalSerialize(rendered.canonical_snapshot)) return invalid('ROUND_TRIP_DRIFT');
  return result(true, 'PROGRAMME_GRAPH_PROOF_VALID', {
    outcome_ids: expectedIds.slice(),
    snapshot_digest: rendered.canonical_snapshot_digest,
    graph_digest: rendered.graph_digest,
    human_graph_columns: ['Outcome', 'Status', 'Current gate', 'Current work', 'Complete when'],
  });
}

function reconcileProgrammeSurface(expected, observed) {
  let expectedSurface;
  let observedSurface;
  try {
    expectedSurface = programmeSurfaceView(expected);
    observedSurface = programmeSurfaceView(observed);
  } catch {
    return result(false, 'PROGRAMME_SURFACE_READBACK_INVALID');
  }
  if (!expectedSurface || !observedSurface) return result(false, 'PROGRAMME_SURFACE_READBACK_INVALID');
  if (!publicGraphFieldsSafe(expectedSurface) || !publicGraphFieldsSafe(observedSurface)) publicGraphUnsafe();
  if (kernel.canonicalSerialize(expectedSurface) !== kernel.canonicalSerialize(observedSurface)) {
    return result(false, 'PROGRAMME_SURFACE_READBACK_MISMATCH', { expected: expectedSurface, observed: observedSurface });
  }
  return result(true, 'PROGRAMME_SURFACE_READBACK_VERIFIED', { surface: expectedSurface });
}

const renderProgrammeGraph = renderProgrammeGraphPublic;
const renderProgrammeParent = renderProgrammeGraph;
const reconcileProgrammeGraph = reconcileProgrammeSurface;

function createBootstrapPlan(input = {}) {
  if (!safeText(input.repository) || !safeId(input.controller_revision)) return result(false, 'BOOTSTRAP_PLAN_INCOMPLETE');
  const diagnostic = createBootstrapIoDiagnostic(input.bootstrap_io || input.bootstrapIo || input.diagnostic || {});
  if (input.controller_identity_check === true || input.controller_identity || input.controller_identity_expected) {
    recordBootstrapIo(diagnostic, 'controller_identity_checks');
    const identityExpected = input.controller_identity_expected || input.controller_identity;
    const identityObserved = input.controller_identity_observed || input.observed_controller_identity;
    if (identityObserved && kernel.canonicalSerialize(identityExpected) !== kernel.canonicalSerialize(identityObserved)) {
      recordBootstrapIo(diagnostic, 'controller_full_reads');
      setBootstrapEscalationReason(diagnostic, 'explicit_decision_required_deeper_evidence');
    }
  }
  if (input.stack_registry_identity_check === true || input.stack_registry_identity || input.stack_registry_identity_expected) {
    recordBootstrapIo(diagnostic, 'stack_registry_identity_checks');
    const registryExpected = input.stack_registry_identity_expected || input.stack_registry_identity;
    const registryObserved = input.stack_registry_identity_observed || input.observed_stack_registry_identity;
    if (registryObserved && kernel.canonicalSerialize(registryExpected) !== kernel.canonicalSerialize(registryObserved)) {
      recordBootstrapIo(diagnostic, 'stack_registry_full_reads');
      setBootstrapEscalationReason(diagnostic, 'explicit_decision_required_deeper_evidence');
    }
  }
  if (input.current_projection || input.currentProjection) {
    if (input.expected_current || input.expectedCurrent) {
      isCurrentFresh(input.current_projection || input.currentProjection, input.expected_current || input.expectedCurrent, diagnostic);
    } else recordBootstrapIo(diagnostic, 'current_projection_reads');
  }
  if (input.worker_liveness || input.workerLiveness || input.worker_identity || input.workerIdentity || input.in_flight || input.inFlight) {
    reconcileWorkerLiveness({ ...input, bootstrap_io: diagnostic });
  }
  if (isRecord(input.expensive_reads)) {
    for (const field of ['exact_receipt_reads', 'full_comment_history_reads', 'full_pr_diff_reads', 'workflow_log_reads', 'historical_expansions']) {
      recordBootstrapIo(diagnostic, field, counterValue(input.expensive_reads[field]));
    }
  }
  if (BOOTSTRAP_IO_REASONS.includes(input.bootstrap_escalation_reason)) setBootstrapEscalationReason(diagnostic, input.bootstrap_escalation_reason);
  const fields = Array.isArray(input.fields) && input.fields.length > 0
    ? [...new Set(input.fields)]
    : ['repository', 'controller_revision', 'canonical_main', 'programme', 'current_child', 'candidate', 'run', 'lock', 'gate', 'repair_count', 'hold', 'in_flight', 'controlling_receipt', 'next_admissible_action'];
  if (!fields.every((field) => safeId(field))) return result(false, 'BOOTSTRAP_PLAN_INVALID');
  return result(true, 'BOOTSTRAP_PLAN_READY', {
    plan: Object.freeze({ schema: SCHEMAS.bootstrap, version: 1, repository: input.repository, controller_revision: input.controller_revision, bounded: true, fields, history_policy: 'exact-controlling-pointer-only' }),
    bootstrap_io: normalizeBootstrapIo(diagnostic),
    BOOTSTRAP_IO: renderBootstrapIO(diagnostic),
  });
}

module.exports = Object.freeze({
  SCHEMAS,
  CURRENT_KEYS,
  PROGRAMME_GRAPH_KINDS,
  PROGRAMME_GRAPH_LIFECYCLES,
  PROGRAMME_GRAPH_PR_STATES,
  BOOTSTRAP_IO_COUNTERS,
  BOOTSTRAP_IO_REASONS,
  CURRENT_GATE_VALUES,
  CURRENT_ACTIONS,
  LAUNCH_SAFETY_CODES,
  WORKER_LIVENESS_STATES,
  WORKER_LIVENESS_EVIDENCE,
  WORKER_LIVENESS_UNVERIFIED,
  IN_FLIGHT_STATES,
  createBootstrapIoDiagnostic,
  createBootstrapIODiagnostic: createBootstrapIoDiagnostic,
  bootstrapIoDiagnostic: createBootstrapIoDiagnostic,
  recordBootstrapIo,
  observeModelVisibleProjection,
  renderBootstrapIO,
  projectPullRequestMetadata,
  projectPullRequest: projectPullRequestMetadata,
  projectPRAdmission: projectPullRequestMetadata,
  validatePullRequestMetadata,
  reconcileWorkerLiveness,
  workerLiveness: reconcileWorkerLiveness,
  deriveWorkerLiveness: reconcileWorkerLiveness,
  deriveNextAdmissibleAction,
  deriveNextAction: deriveNextAdmissibleAction,
  admitCurrent,
  currentAdmission: admitCurrent,
  validateCurrentLaunchSafety,
  validateLaunchSafety: validateCurrentLaunchSafety,
  createCurrentProjection,
  createCurrent: createCurrentProjection,
  validateCurrentProjection,
  validateCurrent: validateCurrentProjection,
  isCurrentFresh,
  transitionCurrent,
  transitionAndReadback,
  normalizeProgrammeGraphSnapshot,
  validateProgrammeGraph,
  validateProgrammeGraphProof,
  PROGRAMME_421_PROOF_OUTCOME_IDS,
  PROGRAMME_421_PROOF_A1_COMPLETE_WHEN,
  PROGRAMME_421_PROOF_SOURCE_HASHES,
  PROGRAMME_421_PROOF_SOURCE_REFERENCES,
  PROGRAMME_421_PROOF_FIELD_MAP_DIGEST,
  PROGRAMME_421_PROOF_CHECKPOINT_SCHEMA,
  PROGRAMME_421_PROOF_CHECKPOINT_SERIALIZATION,
  PROGRAMME_421_PROOF_CHECKPOINT_CANDIDATE,
  renderProgrammeGraph,
  renderProgrammeParent,
  reconcileProgrammeSurface,
  reconcileProgrammeGraph,
  createBootstrapPlan,
  bootstrapPlan: createBootstrapPlan,
});
