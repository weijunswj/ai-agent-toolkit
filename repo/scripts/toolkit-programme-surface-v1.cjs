#!/usr/bin/env node
'use strict';

const kernel = require('./toolkit-controller-kernel.cjs');

const SCHEMAS = Object.freeze({
  current: 'toolkit.controller.current.v1',
  admission: 'toolkit.controller.pr-admission.v1',
  bootstrap: 'toolkit.controller.bootstrap-plan.v1',
});
const CURRENT_KEYS = Object.freeze([
  'schema', 'version', 'repository', 'controller_revision', 'canonical_main', 'programme', 'run', 'lock', 'gate',
  'repair_count', 'candidate', 'hold', 'in_flight', 'controlling_receipt', 'next_admissible_action', 'projection_digest',
]);
const CURRENT_DIGEST_KEYS = CURRENT_KEYS.filter((key) => key !== 'projection_digest');

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

function projectPullRequestMetadata(input = {}) {
  if (!isRecord(input)) return result(false, 'PR_ADMISSION_METADATA_INCOMPLETE');
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
  return result(true, 'PR_ADMISSION_METADATA_READY', { projection: Object.freeze(projection) });
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

function currentInput(input = {}) {
  const canonical = isRecord(input.canonical_main) ? input.canonical_main : isRecord(input.canonicalMain) ? input.canonicalMain : {};
  const programme = isRecord(input.programme) ? input.programme : {};
  const run = isRecord(input.run) ? input.run : {};
  const hold = isRecord(input.hold) ? input.hold : {};
  const inFlight = isRecord(input.in_flight) ? input.in_flight : isRecord(input.inFlight) ? input.inFlight : {};
  const receipt = isRecord(input.controlling_receipt) ? input.controlling_receipt : isRecord(input.controllingReceipt) ? input.controllingReceipt : {};
  const repair = isRecord(input.repair_count) ? input.repair_count : isRecord(input.repairCount) ? input.repairCount : {};
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
      state: ['NONE', 'QUEUED', 'IN_FLIGHT', 'TERMINAL', 'HELD'].includes(run.state) ? run.state : 'NONE',
    },
    lock: typeof input.lock === 'string' && input.lock.length > 0 ? input.lock : null,
    gate: typeof input.gate === 'string' && input.gate.length > 0 ? input.gate : null,
    repair_count: {
      used: Number.isSafeInteger(repair.used) && repair.used >= 0 ? repair.used : 0,
      limit: Number.isSafeInteger(repair.limit) && repair.limit >= 0 ? repair.limit : 0,
    },
    candidate: candidateProjection(input.candidate),
    hold: {
      active: hold.active === true,
      code: typeof hold.code === 'string' && hold.code.length > 0 ? hold.code : null,
      dependency: typeof hold.dependency === 'string' && hold.dependency.length > 0 ? hold.dependency : null,
    },
    in_flight: {
      state: ['NONE', 'PREPARING', 'RUNNING', 'VALIDATING', 'DELIVERY_PENDING'].includes(inFlight.state) ? inFlight.state : 'NONE',
      worker: typeof inFlight.worker === 'string' && inFlight.worker.length > 0 ? inFlight.worker : null,
      executor: typeof inFlight.executor === 'string' && inFlight.executor.length > 0 ? inFlight.executor : null,
    },
    controlling_receipt: {
      id: typeof receipt.id === 'string' && receipt.id.length > 0 ? receipt.id : null,
      reference: typeof receipt.reference === 'string' && receipt.reference.length > 0 ? receipt.reference : null,
      digest: isDigest(receipt.digest) ? receipt.digest : null,
    },
    next_admissible_action: input.next_admissible_action || input.nextAction || 'USER_DECISION_REQUIRED',
  };
}

function createCurrentProjection(input = {}) {
  const base = currentInput(input);
  if (!safeText(base.repository) || !safeId(base.controller_revision) || !safeId(base.next_admissible_action)) return result(false, 'CURRENT_PROJECTION_INCOMPLETE');
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
    || !isRecord(value.in_flight) || !exactKeys(value.in_flight, ['state', 'worker', 'executor']) || !['NONE', 'PREPARING', 'RUNNING', 'VALIDATING', 'DELIVERY_PENDING'].includes(value.in_flight.state)
    || (value.in_flight.worker !== null && !safeText(value.in_flight.worker)) || (value.in_flight.executor !== null && !safeText(value.in_flight.executor))
    || !isRecord(value.controlling_receipt) || !exactKeys(value.controlling_receipt, ['id', 'reference', 'digest'])
    || (value.controlling_receipt.id !== null && !safeText(value.controlling_receipt.id)) || (value.controlling_receipt.reference !== null && !safeText(value.controlling_receipt.reference, 1024))
    || (value.controlling_receipt.digest !== null && !isDigest(value.controlling_receipt.digest))
    || !safeId(value.next_admissible_action) || !isDigest(value.projection_digest)
    || value.projection_digest !== kernel.digestValue(Object.fromEntries(CURRENT_DIGEST_KEYS.map((key) => [key, value[key]])))) return result(false, 'CURRENT_PROJECTION_INVALID');
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

function isCurrentFresh(projection, expected = null) {
  const checked = validateCurrentProjection(projection);
  if (!checked.ok) return result(false, 'CURRENT_STALE', { reason: checked.code });
  if (!isRecord(expected)) return result(false, 'CURRENT_STALE', { reason: 'LIVE_CURRENT_UNAVAILABLE' });
  if (Object.prototype.hasOwnProperty.call(expected, 'projection_digest')
    && (!isDigest(expected.projection_digest) || expected.projection_digest !== projection.projection_digest)) {
    return result(false, 'CURRENT_STALE', { reason: 'CURRENT_DIGEST_MISMATCH' });
  }
  const fields = ['repository', 'controller_revision', 'canonical_main', 'programme', 'run', 'lock', 'gate', 'repair_count', 'candidate', 'hold', 'in_flight', 'controlling_receipt', 'next_admissible_action'];
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(expected, field));
  if (present.length === 0 && !Object.prototype.hasOwnProperty.call(expected, 'projection_digest')) {
    return result(false, 'CURRENT_STALE', { reason: 'LIVE_CURRENT_UNAVAILABLE' });
  }
  if (!compareFields(projection, expected, present)) return result(false, 'CURRENT_STALE', { reason: 'CURRENT_BINDING_MISMATCH' });
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

function createBootstrapPlan(input = {}) {
  if (!safeText(input.repository) || !safeId(input.controller_revision)) return result(false, 'BOOTSTRAP_PLAN_INCOMPLETE');
  const fields = Array.isArray(input.fields) && input.fields.length > 0
    ? [...new Set(input.fields)]
    : ['repository', 'controller_revision', 'canonical_main', 'programme', 'current_child', 'candidate', 'run', 'lock', 'gate', 'repair_count', 'hold', 'in_flight', 'controlling_receipt', 'next_admissible_action'];
  if (!fields.every((field) => safeId(field))) return result(false, 'BOOTSTRAP_PLAN_INVALID');
  return result(true, 'BOOTSTRAP_PLAN_READY', {
    plan: Object.freeze({ schema: SCHEMAS.bootstrap, version: 1, repository: input.repository, controller_revision: input.controller_revision, bounded: true, fields, history_policy: 'exact-controlling-pointer-only' }),
  });
}

module.exports = Object.freeze({
  SCHEMAS,
  CURRENT_KEYS,
  projectPullRequestMetadata,
  projectPullRequest: projectPullRequestMetadata,
  projectPRAdmission: projectPullRequestMetadata,
  validatePullRequestMetadata,
  createCurrentProjection,
  createCurrent: createCurrentProjection,
  validateCurrentProjection,
  validateCurrent: validateCurrentProjection,
  isCurrentFresh,
  transitionCurrent,
  transitionAndReadback,
  createBootstrapPlan,
  bootstrapPlan: createBootstrapPlan,
});
