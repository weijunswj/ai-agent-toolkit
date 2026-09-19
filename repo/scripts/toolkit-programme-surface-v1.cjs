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
const LAUNCH_ACTION_PATTERN = /^(?:LAUNCH|EXECUTE)_|_EXECUTE$/;
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

function candidateProjection(input = {}) {
  const candidate = isRecord(input) ? input : {};
  const base = isRecord(candidate.base) ? candidate.base : {};
  return {
    pr: Number.isSafeInteger(candidate.pr) && candidate.pr >= 1 ? candidate.pr : null,
    head: maybeSha(candidate.head),
    tree: maybeSha(candidate.tree),
    base: {
      ref: safeText(base.ref) ? base.ref : null,
      sha: maybeSha(base.sha),
    },
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
    nested.worker_identity,
    nested.workerIdentity,
    nested.worker,
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
  const activeClaim = source.in_flight === true
    || source.inFlight === true
    || run.state === 'IN_FLIGHT'
    || ['PREPARING', 'RUNNING', 'VALIDATING'].includes(String(nested.state || '').toUpperCase())
    || source.worker_active === true
    || nested.active === true;
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

function launchAction(value) {
  return typeof value === 'string' && LAUNCH_ACTION_PATTERN.test(value.toUpperCase());
}

function stageFromAction(value) {
  if (typeof value !== 'string') return null;
  const match = /^(?:LAUNCH|EXECUTE)_([A-Z0-9]+)(?:_|$)|^([A-Z0-9]+)_EXECUTE$/.exec(value.toUpperCase());
  return match ? (match[1] || match[2]) : null;
}

function launchSafetyView(input = {}) {
  const source = isRecord(input) ? input : {};
  const run = isRecord(source.run) ? source.run : {};
  const worker = workerInputParts(source);
  const inFlight = worker.nested;
  const hold = isRecord(source.hold) ? source.hold : {};
  const next = source.next_admissible_action || source.nextAction || null;
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
  return {
    next,
    stage: source.stage || source.authorised_stage || source.authorized_stage || null,
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
  if (view.next) return result(true, 'CURRENT_ACTION_DERIVED', { action: view.next, reason_code: 'CURRENT_ACTION_PRESERVED', launch_allowed: !launchAction(view.next) || !view.terminal });
  if (typeof view.stage === 'string' && /^[A-Za-z0-9]+$/.test(view.stage)) {
    return result(true, 'CURRENT_ACTION_DERIVED', {
      action: `LAUNCH_${view.stage.toUpperCase()}_DIRECT`,
      reason_code: 'AUTHORISED_STAGE_READY',
      launch_allowed: true,
    });
  }
  return result(true, 'CURRENT_ACTION_DERIVED', { action: 'USER_DECISION_REQUIRED', reason_code: 'NO_EXECUTABLE_STAGE', launch_allowed: false });
}

function validateCurrentLaunchSafety(input = {}) {
  const view = launchSafetyView(input);
  const derived = deriveNextAdmissibleAction(input);
  const requested = view.next;
  const requestedStage = stageFromAction(requested);
  const currentStage = typeof view.stage === 'string' ? view.stage.toUpperCase() : null;
  const contradictory = launchAction(requested) && (
    view.active
    || view.livenessUnverified
    || view.ambiguous
    || view.packetReturned
    || view.nonConverged
    || view.terminal
    || requestedStage && currentStage && requestedStage !== currentStage
  );
  if (contradictory) {
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
            : view.nonConverged || view.terminal
              ? 'TERMINAL_STATE_NOT_EXECUTABLE'
              : 'STAGE_BINDING_MISMATCH',
      launch_allowed: false,
    });
  }
  return result(true, LAUNCH_SAFETY_CODES.safe, {
    action: derived.action,
    requested_action: requested,
    derived_action: derived.action,
    launch_allowed: derived.launch_allowed,
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
    gate: typeof input.gate === 'string' && input.gate.length > 0 ? input.gate : null,
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
      || isRecord(value.candidate) && value.candidate.pr !== null
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
    || !isRecord(value.controlling_receipt)
    || !safeText(value.controlling_receipt.id)
    || !safeText(value.controlling_receipt.reference, 1024)
    || !isDigest(value.controlling_receipt.digest)
    || !safeId(value.next_admissible_action)) return false;
  if (value.candidate?.pr !== null
    && (!isSha(value.candidate.head) || !isSha(value.candidate.tree) || !safeText(value.candidate.base?.ref) || !isSha(value.candidate.base?.sha))) return false;
  if (value.in_flight?.state !== 'NONE' || value.in_flight?.worker !== null || value.in_flight?.worker_liveness !== 'inactive') {
    if (!value.in_flight || !WORKER_LIVENESS_EVIDENCE.includes(value.in_flight.worker_liveness_evidence)) return false;
    if (value.in_flight.worker_liveness === 'active' && !safeText(value.in_flight.worker_identity)) return false;
  }
  return true;
}

function createCurrentProjection(input = {}) {
  const launchSafety = validateCurrentLaunchSafety(input);
  if (!launchSafety.ok) return launchSafety;
  const base = currentInput(input);
  if (!safeText(base.repository) || !safeId(base.controller_revision) || !safeId(base.next_admissible_action)) return result(false, 'CURRENT_PROJECTION_INCOMPLETE');
  if (hasExecutableCurrentIdentity(base) && !executableCurrentIdentityComplete(base)) return result(false, 'CURRENT_EXECUTABLE_IDENTITY_INCOMPLETE');
  const projection = { ...base, projection_digest: kernel.digestValue(base) };
  const checked = validateCurrentProjection(projection);
  return checked.ok ? result(true, 'CURRENT_PROJECTION_READY', { projection: Object.freeze(projection) }) : checked;
}

function validateCurrentProjection(value) {
  if (!isRecord(value) || !exactKeys(value, CURRENT_KEYS) || value.schema !== SCHEMAS.current || value.version !== 1
    || !safeText(value.repository) || !safeId(value.controller_revision)
    || !isRecord(value.canonical_main) || !exactKeys(value.canonical_main, ['ref', 'sha', 'tree']) || value.canonical_main.ref !== 'main'
    || (value.canonical_main.sha !== null && !isSha(value.canonical_main.sha)) || (value.canonical_main.tree !== null && !isSha(value.canonical_main.tree))
    || !isRecord(value.programme) || !exactKeys(value.programme, ['parent', 'current_child', 'lane'])
    || (value.programme.parent !== null && (!Number.isSafeInteger(value.programme.parent) || value.programme.parent < 1))
    || (value.programme.current_child !== null && (!Number.isSafeInteger(value.programme.current_child) || value.programme.current_child < 1))
    || (value.programme.lane !== null && !safeText(value.programme.lane))
    || !isRecord(value.run) || !exactKeys(value.run, ['id', 'state']) || !safeId(value.run.id) || !['NONE', 'QUEUED', 'IN_FLIGHT', 'TERMINAL', 'HELD'].includes(value.run.state)
    || (value.lock !== null && !safeText(value.lock)) || (value.gate !== null && !safeText(value.gate, 128))
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
  const launchSafety = validateCurrentLaunchSafety(value);
  if (!launchSafety.ok) return launchSafety;
  return result(true, 'CURRENT_PROJECTION_VALID', { projection: clone(value) });
}

function validateCandidate(value) {
  return isRecord(value) && exactKeys(value, ['pr', 'head', 'tree', 'base'])
    && (value.pr === null || Number.isSafeInteger(value.pr) && value.pr >= 1)
    && (value.head === null || isSha(value.head))
    && (value.tree === null || isSha(value.tree))
    && isRecord(value.base) && exactKeys(value.base, ['ref', 'sha'])
    && (value.base.ref === null || safeText(value.base.ref))
    && (value.base.sha === null || isSha(value.base.sha));
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
    if (!safeText(title) || items === null || items.length === 0) return null;
    sections.push({ id, title, items });
  }
  return sections;
}

function normalizeProgrammeGraphSnapshot(input = {}) {
  if (!isRecord(input) || !safeText(input.repository)) return result(false, 'PROGRAMME_GRAPH_SNAPSHOT_INVALID');
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
    if (id === null || kind === null || !safeText(outcomeTitle) || !PROGRAMME_GRAPH_LIFECYCLES.includes(lifecycle)
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

function validateProgrammeGraph(value) {
  if (!isRecord(value) || !exactKeys(value, ['schema', 'version', 'repository', 'programme', 'outcomes', 'graph_digest'])
    || value.schema !== SCHEMAS.programmeGraph || value.version !== 1) return result(false, 'PROGRAMME_GRAPH_INVALID');
  const normalized = normalizeProgrammeGraphSnapshot({
    repository: value.repository,
    programme: value.programme,
    outcomes: value.outcomes,
  });
  if (!normalized.ok || kernel.canonicalSerialize(normalized.graph) !== kernel.canonicalSerialize(value)) {
    return result(false, 'PROGRAMME_GRAPH_INVALID');
  }
  return result(true, 'PROGRAMME_GRAPH_VALID', { graph: clone(value) });
}

function programmeGraphNativeCell(issue) {
  return issue === null ? '-' : '#' + issue.number + (issue.repository ? ' (' + issue.repository + ')' : '');
}

function programmeGraphDeliveryCell(pr) {
  return pr === null ? '-' : '#' + pr.number + ' (' + pr.status + ')';
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

function renderProgrammeGraph(input = {}) {
  const normalized = normalizeProgrammeGraphSnapshot(input);
  if (!normalized.ok) return normalized;
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
    '| Order | Outcome | Kind | Materialised | Lifecycle | Dependencies | Native issue | Delivery PR |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  if (graph.outcomes.length === 0) lines.push('| - | None | - | - | - | - | - | - |');
  for (const outcome of graph.outcomes) {
    lines.push('| ' + graphCell(outcome.order)
      + ' | ' + graphCell(outcome.id + ': ' + outcome.title)
      + ' | ' + graphCell(outcome.kind)
      + ' | ' + (outcome.materialized ? 'YES' : 'NO')
      + ' | ' + graphCell(outcome.lifecycle)
      + ' | ' + graphCell(outcome.dependencies.length ? outcome.dependencies.join(', ') : null)
      + ' | ' + graphCell(programmeGraphNativeCell(outcome.native_issue))
      + ' | ' + graphCell(programmeGraphDeliveryCell(outcome.delivery_pr)) + ' |');
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
    native_issue: clone(outcome.native_issue),
    delivery_pr: clone(outcome.delivery_pr),
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

function reconcileProgrammeSurface(expected, observed) {
  const expectedSurface = programmeSurfaceView(expected);
  const observedSurface = programmeSurfaceView(observed);
  if (!expectedSurface || !observedSurface) return result(false, 'PROGRAMME_SURFACE_READBACK_INVALID');
  if (kernel.canonicalSerialize(expectedSurface) !== kernel.canonicalSerialize(observedSurface)) {
    return result(false, 'PROGRAMME_SURFACE_READBACK_MISMATCH', { expected: expectedSurface, observed: observedSurface });
  }
  return result(true, 'PROGRAMME_SURFACE_READBACK_VERIFIED', { surface: expectedSurface });
}

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
  renderProgrammeGraph,
  renderProgrammeParent,
  reconcileProgrammeSurface,
  reconcileProgrammeGraph,
  createBootstrapPlan,
  bootstrapPlan: createBootstrapPlan,
});
