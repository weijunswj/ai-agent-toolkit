'use strict';

// These reducers operate on the existing admitted packet and its independently read evidence.
// They neither grant permission nor write another CURRENT or retention ledger.
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const digest = value => compiler.hashCanonical(value);
const equal = (a, b) => JSON.stringify(compiler.canonicalize(a)) === JSON.stringify(compiler.canonicalize(b));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const list = value => Array.isArray(value) && value.length <= 64 && value.every(id) && new Set(value).size === value.length;
function refuse(code) { throw Object.assign(new Error(code), { code }); }
function keys(value, names) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) refuse('V3_LIFECYCLE_INVALID');
}
function copy(value) { return compiler.trustedJsonCopy(value); }
function parse(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 65536) refuse('V3_EVIDENCE_UNVERIFIED');
  try { return copy(JSON.parse(content)); } catch (_) { refuse('V3_EVIDENCE_UNVERIFIED'); }
}

const RENEWAL_REASONS = Object.freeze([
  'G0_TO_G1', 'SEGMENT_COMPLETE', 'INITIAL_G2', 'MODEL_EFFORT_HARNESS_CHANGED',
  'ENVIRONMENT_REPLACED', 'INSTRUCTIONS_ACTIVATED', 'CONTEXT_LOST', 'EXECUTOR_REPLACED'
]);
function planRenewal(input) {
  const value = copy(input);
  keys(value, ['event', 'checkpoint_verified', 'consumer_recovery_verified', 'writer_state', 'conflicting_writer', 'pending_effects']);
  if (typeof value.checkpoint_verified !== 'boolean' || typeof value.consumer_recovery_verified !== 'boolean'
    || typeof value.conflicting_writer !== 'boolean' || !['STOPPED', 'ACTIVE', 'UNKNOWN'].includes(value.writer_state)
    || !Array.isArray(value.pending_effects)) refuse('V3_RENEWAL_INVALID');
  const pending = value.pending_effects.filter(effect => {
    keys(effect, ['effect_id', 'effect_digest', 'state']);
    if (!id(effect.effect_id) || !hex(effect.effect_digest)
      || !['PREPARED', 'IN_FLIGHT', 'UNKNOWN', 'APPLIED', 'NOT_APPLIED', 'DENIED'].includes(effect.state)) refuse('V3_RENEWAL_INVALID');
    return ['IN_FLIGHT', 'UNKNOWN', 'DENIED'].includes(effect.state);
  });
  if (!RENEWAL_REASONS.includes(value.event) && !['COMMIT', 'TEST', 'HELPER_RETURN', 'STATUS', 'REMOTE_CONNECTION', 'INCOMPLETE_SEGMENT_CHECKPOINT', 'CHECKPOINT_SAVED', 'CHECKPOINT_FAILED'].includes(value.event)) refuse('V3_RENEWAL_INVALID');
  const required = RENEWAL_REASONS.includes(value.event);
  return Object.freeze({ required, ready: required && value.checkpoint_verified && value.consumer_recovery_verified
    && value.writer_state === 'STOPPED' && !value.conflicting_writer,
    replay_holds: pending.map(effect => effect.effect_id), reset_consumption: false,
    next_action: value.event === 'CHECKPOINT_FAILED' ? 'CHECKPOINT_RECOVERY_REQUIRED'
      : required ? 'CONTROLLER_RELAUNCH_AFTER_VERIFIED_CHECKPOINT_AND_WRITER_STOP' : 'CONTINUE_SAME_ASSIGNMENT' });
}

const UAT_DIMENSIONS = Object.freeze([
  'steps', 'inputs', 'defaults', 'outputs', 'permissions', 'isolation', 'destinations',
  'effects', 'persistence', 'migration', 'deletion', 'recovery', 'modes', 'environment', 'scope', 'criteria'
]);
function classifyUatImpact(input) {
  const value = copy(input);
  keys(value, ['accepted_candidate', 'candidate', 'changed_dimensions', 'affected_criteria',
    'targeted_verification_evidence_ids', 'earlier_evidence_invalid', 'cross_cutting', 'investigation_complete']);
  if (!list(value.changed_dimensions) || value.changed_dimensions.some(item => !UAT_DIMENSIONS.includes(item))
    || !list(value.affected_criteria) || !list(value.targeted_verification_evidence_ids)
    || ['earlier_evidence_invalid', 'cross_cutting', 'investigation_complete'].some(name => typeof value[name] !== 'boolean')) refuse('V3_UAT_IMPACT_INVALID');
  if (!value.investigation_complete) return 'UAT_IMPACT_UNRESOLVED';
  if (value.cross_cutting || value.earlier_evidence_invalid && value.affected_criteria.length === 0) return 'UAT_FULL_REQUIRED';
  if (value.changed_dimensions.length || value.earlier_evidence_invalid || value.affected_criteria.length) {
    return value.affected_criteria.length ? 'UAT_PARTIAL_REQUIRED' : 'UAT_FULL_REQUIRED';
  }
  if (!equal(value.accepted_candidate, value.candidate) && value.targeted_verification_evidence_ids.length === 0) return 'UAT_IMPACT_UNRESOLVED';
  return 'UAT_RETAINED';
}

// After a G2 return has been accepted, its reviewer session is retired. A correction
// recheck therefore always runs in a fresh context for the same registry member; a
// member whose independence or route no longer holds is replaced instead.
function reviewerContinuation(input) {
  const value = copy(input);
  keys(value, ['context_available', 'independence_compromised', 'implemented_candidate',
    'consumed_unreturned_peer_verdict', 'route_changed', 'context_lost', 'candidate_changed', 'affected_criteria']);
  if (Object.entries(value).some(([name, flag]) => name !== 'affected_criteria' && typeof flag !== 'boolean')
    || !list(value.affected_criteria)) refuse('V3_REVIEW_CONTINUITY_INVALID');
  const replace = value.independence_compromised || value.implemented_candidate
    || value.consumed_unreturned_peer_verdict || value.route_changed;
  return Object.freeze({ action: replace ? 'REPLACE_AFFECTED_REVIEWER' : 'FRESH_CONTEXT_SAME_MEMBER',
    reuse_retired_session: false, previous_pass_applies_automatically: false, correction_review_required: value.candidate_changed,
    retained_coverage_requires_applicability: true, affected_criteria: value.affected_criteria });
}

// One gate assignment (G0, G1 or G2) and the native sessions that work it.
// Session states are ACTIVE, WAITING_OWNER (a question or UAT), INTERRUPTED,
// SUBMITTED and RETIRED. Questions and UAT keep the gate unfinished; a checkpoint
// continues the same session; an accepted gate retires its session for good.
// The value is revisioned and digest-bound so the caller persists it through its
// existing conditional CURRENT/checkpoint write; this class owns no store of its own.
const GATE_ROLES = Object.freeze(['G0', 'G1', 'G2']);
const SESSION_STATES = Object.freeze(['ACTIVE', 'WAITING_OWNER', 'INTERRUPTED', 'SUBMITTED', 'RETIRED']);
const ACCEPTANCE_MODES = Object.freeze(['OWNER_UAT', 'OBJECTIVE']);
const SESSION_EVENTS = Object.freeze({
  ACTIVE: { ASK_OWNER: 'WAITING_OWNER', UAT_READY: 'WAITING_OWNER', CHECKPOINT: 'ACTIVE', INTERRUPT: 'INTERRUPTED', SUBMIT: 'SUBMITTED' },
  WAITING_OWNER: { OWNER_REPLY: 'ACTIVE', CHECKPOINT: 'WAITING_OWNER', INTERRUPT: 'INTERRUPTED' },
  INTERRUPTED: {},
  SUBMITTED: { RETURN_REOPENED: 'ACTIVE' },
  RETIRED: {},
});
const GATE_SCHEMA = 'toolkit.v3.gate-assignment.v1';

class GateAssignment {
  #value;

  constructor(value) {
    const v = copy(value);
    keys(v, ['schema', 'assignment_id', 'programme', 'child', 'role', 'acceptance', 'revision', 'sessions',
      'launch_requests', 'consumed_returns', 'decisions', 'blockers', 'work', 'state']);
    if (v.schema !== GATE_SCHEMA || !id(v.assignment_id) || !GATE_ROLES.includes(v.role)
      || !Number.isSafeInteger(v.programme) || !Number.isSafeInteger(v.child) || !Number.isSafeInteger(v.revision) || v.revision < 0
      || !['OPEN', 'ACCEPTED'].includes(v.state)) refuse('V3_GATE_INVALID');
    GateAssignment.#checkAcceptance(v.acceptance);
    for (const session of v.sessions) {
      keys(session, ['session_id', 'state', 'launch_request_id', 'successor_of', 'history']);
      if (!id(session.session_id) || !SESSION_STATES.includes(session.state) || !id(session.launch_request_id)
        || session.successor_of !== null && !id(session.successor_of) || !Array.isArray(session.history)) refuse('V3_GATE_INVALID');
    }
    if (new Set(v.sessions.map(s => s.session_id)).size !== v.sessions.length
      || v.sessions.filter(s => GateAssignment.#live(s.state)).length > 1) refuse('V3_GATE_WRITER_CONFLICT');
    this.#value = v;
  }

  // Acceptance mode is fixed upfront; OBJECTIVE needs an owner-approved criteria reference.
  static #checkAcceptance(acceptance) {
    keys(acceptance, ['mode', 'objective_reference', 'owner']);
    if (!ACCEPTANCE_MODES.includes(acceptance.mode) || !id(acceptance.owner)
      || acceptance.mode === 'OBJECTIVE' && !hex(acceptance.objective_reference)
      || acceptance.mode === 'OWNER_UAT' && acceptance.objective_reference !== null) refuse('V3_GATE_ACCEPTANCE_INVALID');
  }

  static #live(state) { return ['ACTIVE', 'WAITING_OWNER', 'SUBMITTED'].includes(state); }

  static admit({ assignment_id, programme, child, role, acceptance }) {
    return new GateAssignment({ schema: GATE_SCHEMA, assignment_id, programme, child, role, acceptance,
      revision: 0, sessions: [], launch_requests: [], consumed_returns: [], decisions: [], blockers: [], work: [], state: 'OPEN' });
  }

  static from(value, expectedDigest) {
    const gate = new GateAssignment(value);
    if (expectedDigest !== undefined && gate.digest !== expectedDigest) refuse('V3_GATE_DIGEST_MISMATCH');
    return gate;
  }

  get value() { return copy(this.#value); }
  get digest() { return digest(this.#value); }
  get revision() { return this.#value.revision; }
  get state() { return this.#value.state; }
  get acceptanceMode() { return this.#value.acceptance.mode; }
  session(sessionId) {
    const s = this.#value.sessions.find(item => item.session_id === sessionId);
    if (!s) refuse('V3_GATE_SESSION_UNKNOWN');
    return copy(s);
  }
  get liveSession() { const s = this.#value.sessions.find(item => GateAssignment.#live(item.state)); return s ? copy(s) : null; }

  #next(mutate) {
    const v = copy(this.#value);
    mutate(v);
    v.revision += 1;
    return new GateAssignment(v);
  }

  // Launch exactly one session per assignment. A repeated launch request returns the
  // existing session; a second writer is refused while one is live. A successor may
  // replace only an INTERRUPTED session, which it retires as superseded. G2 sessions
  // are launched by the controller, never by a G1 session.
  launch({ session_id, launch_request_id, requested_by, successor_of = null }) {
    if (this.#value.state !== 'OPEN') refuse('V3_GATE_RETIRED');
    if (!id(session_id) || !id(launch_request_id) || !['CONTROLLER', 'G0', 'G1', 'G2'].includes(requested_by)) refuse('V3_GATE_LAUNCH_INVALID');
    if (this.#value.role === 'G2' && requested_by !== 'CONTROLLER') refuse('V3_G2_LAUNCH_BY_BUILDER_REFUSED');
    const prior = this.#value.launch_requests.find(r => r.launch_request_id === launch_request_id);
    if (prior) {
      if (prior.session_id !== session_id) refuse('V3_GATE_LAUNCH_REQUEST_CONFLICT');
      return { gate: this, outcome: 'EXISTING_SESSION_REUSED', session_id };
    }
    const live = this.liveSession;
    if (live) refuse('V3_GATE_DUPLICATE_WRITER');
    if (successor_of !== null) {
      const predecessor = this.session(successor_of);
      if (predecessor.state !== 'INTERRUPTED') refuse('V3_GATE_SUCCESSOR_REQUIRES_INTERRUPTION');
    } else if (this.#value.sessions.some(s => s.state === 'INTERRUPTED')) refuse('V3_GATE_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR');
    if (this.#value.sessions.some(s => s.session_id === session_id)) refuse('V3_GATE_SESSION_ID_REUSED');
    const gate = this.#next(v => {
      if (successor_of !== null) {
        const predecessor = v.sessions.find(s => s.session_id === successor_of);
        predecessor.state = 'RETIRED';
        predecessor.history.push({ event: 'SUPERSEDED', revision: v.revision + 1, by: session_id });
      }
      v.sessions.push({ session_id, state: 'ACTIVE', launch_request_id, successor_of,
        history: [{ event: 'LAUNCH', revision: v.revision + 1, by: requested_by }] });
      v.launch_requests.push({ launch_request_id, session_id });
    });
    return { gate, outcome: successor_of ? 'SUCCESSOR_LAUNCHED' : 'LAUNCHED', session_id };
  }

  // Refuses any execution in a session that is retired, submitted or interrupted.
  assertExecutable(sessionId) {
    const s = this.session(sessionId);
    if (s.state === 'RETIRED') refuse('V3_RETIRED_SESSION_REFUSED');
    if (s.state === 'SUBMITTED') refuse('V3_SUBMITTED_SESSION_AWAITING_CONSUMPTION');
    if (s.state === 'INTERRUPTED') refuse('V3_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR');
    if (this.#value.state !== 'OPEN') refuse('V3_GATE_RETIRED');
    return s;
  }

  transition(sessionId, event, detail = null) {
    const s = this.session(sessionId);
    const target = SESSION_EVENTS[s.state]?.[event];
    if (!target) refuse(s.state === 'RETIRED' ? 'V3_RETIRED_SESSION_REFUSED' : 'V3_GATE_TRANSITION_INVALID');
    if (detail !== null && !hex(detail)) refuse('V3_GATE_TRANSITION_INVALID');
    if (event === 'UAT_READY' && (this.#value.role !== 'G1' || this.#value.acceptance.mode !== 'OWNER_UAT')) refuse('V3_GATE_UAT_NOT_APPLICABLE');
    return this.#next(v => {
      const session = v.sessions.find(item => item.session_id === sessionId);
      session.state = target;
      session.history.push({ event, revision: v.revision + 1, detail });
    });
  }

  // Records one actual owner decision with its provenance; replaying the same decision
  // is a no-op and a stale or competing answer to the same question is rejected.
  recordOwnerDecision({ question_id, decision_digest, provenance_digest, based_on_revision }) {
    if (!id(question_id) || !hex(decision_digest) || !hex(provenance_digest) || !Number.isSafeInteger(based_on_revision)) refuse('V3_GATE_DECISION_INVALID');
    const prior = this.#value.decisions.find(d => d.question_id === question_id);
    if (prior) {
      if (prior.decision_digest === decision_digest) return { gate: this, outcome: 'ALREADY_RECORDED' };
      refuse('V3_GATE_DECISION_CONFLICT');
    }
    if (based_on_revision !== this.#value.revision) refuse('V3_GATE_DECISION_STALE');
    return { gate: this.#next(v => v.decisions.push({ question_id, decision_digest, provenance_digest })), outcome: 'RECORDED' };
  }

  // Consumes a submitted return exactly once. The same return digest consumed again is
  // a no-op; any different return for an already-consumed session is rejected.
  consumeReturn({ session_id, return_digest, disposition, owner_acceptance_digest = null }) {
    if (!hex(return_digest) || !['ACCEPT', 'REOPEN'].includes(disposition)) refuse('V3_GATE_RETURN_INVALID');
    const prior = this.#value.consumed_returns.find(r => r.session_id === session_id);
    if (prior) {
      if (prior.return_digest === return_digest && prior.disposition === disposition) return { gate: this, outcome: 'ALREADY_CONSUMED' };
      refuse('V3_GATE_RETURN_CONFLICT');
    }
    const s = this.session(session_id);
    if (s.state !== 'SUBMITTED') refuse('V3_GATE_RETURN_NOT_SUBMITTED');
    if (disposition === 'ACCEPT' && this.#value.role === 'G1' && this.#value.acceptance.mode === 'OWNER_UAT' && !hex(owner_acceptance_digest)) {
      refuse('V3_GATE_OWNER_UAT_REQUIRED');
    }
    const gate = this.#next(v => {
      const session = v.sessions.find(item => item.session_id === session_id);
      if (disposition === 'ACCEPT') {
        session.state = 'RETIRED';
        session.history.push({ event: 'ACCEPTED_AND_RETIRED', revision: v.revision + 1, detail: return_digest });
        v.state = 'ACCEPTED';
      } else {
        session.state = 'ACTIVE';
        session.history.push({ event: 'RETURN_REOPENED', revision: v.revision + 1, detail: return_digest });
      }
      v.consumed_returns.push({ session_id, return_digest, disposition, owner_acceptance_digest });
    });
    return { gate, outcome: disposition === 'ACCEPT' ? 'ACCEPTED_SESSION_RETIRED' : 'REOPENED_SAME_SESSION' };
  }

  // Authorised work items and the blockers that hold them.
  addWork({ work_id, authorised_by, blocked_by = [] }) {
    if (!id(work_id) || !hex(authorised_by) || !list(blocked_by)) refuse('V3_GATE_WORK_INVALID');
    if (this.#value.work.some(w => w.work_id === work_id)) refuse('V3_GATE_WORK_DUPLICATE');
    if (blocked_by.some(b => !this.#value.blockers.some(x => x.blocker_id === b))) refuse('V3_GATE_BLOCKER_UNKNOWN');
    return this.#next(v => v.work.push({ work_id, authorised_by, blocked_by, state: 'PENDING' }));
  }

  addBlocker({ blocker_id, kind }) {
    if (!id(blocker_id) || !['PERMISSION', 'CAPABILITY', 'OWNER_DECISION', 'RESOURCE', 'EXTERNAL'].includes(kind)) refuse('V3_GATE_BLOCKER_INVALID');
    if (this.#value.blockers.some(b => b.blocker_id === blocker_id)) refuse('V3_GATE_BLOCKER_DUPLICATE');
    return this.#next(v => v.blockers.push({ blocker_id, kind, state: 'OPEN', cleared_by: null }));
  }

  // Clearing a blocker returns the already-authorised work that may now continue.
  clearBlocker({ blocker_id, evidence_digest }) {
    if (!hex(evidence_digest)) refuse('V3_GATE_BLOCKER_INVALID');
    const blocker = this.#value.blockers.find(b => b.blocker_id === blocker_id);
    if (!blocker) refuse('V3_GATE_BLOCKER_UNKNOWN');
    if (blocker.state === 'CLEARED') return { gate: this, continue_work: [] };
    const gate = this.#next(v => { const b = v.blockers.find(x => x.blocker_id === blocker_id); b.state = 'CLEARED'; b.cleared_by = evidence_digest; });
    const held = new Set(this.#value.work.filter(w => w.state === 'PENDING' && w.blocked_by.includes(blocker_id)).map(w => w.work_id));
    return { gate, continue_work: gate.runnableWork().filter(workId => held.has(workId)) };
  }

  runnableWork() {
    const open = new Set(this.#value.blockers.filter(b => b.state === 'OPEN').map(b => b.blocker_id));
    return this.#value.work.filter(w => w.state === 'PENDING' && !w.blocked_by.some(b => open.has(b))).map(w => w.work_id);
  }

  completeWork(workId, evidenceDigest) {
    if (!hex(evidenceDigest)) refuse('V3_GATE_WORK_INVALID');
    const w = this.#value.work.find(item => item.work_id === workId);
    if (!w) refuse('V3_GATE_WORK_UNKNOWN');
    if (w.state === 'DONE') return this;
    if (!this.runnableWork().includes(workId)) refuse('V3_GATE_WORK_BLOCKED');
    return this.#next(v => { const item = v.work.find(x => x.work_id === workId); item.state = 'DONE'; item.evidence = evidenceDigest; });
  }

  // Authorised, unblocked work with no live session to perform it is stranded.
  strandedWork() {
    if (this.#value.state !== 'OPEN' || this.liveSession) return [];
    return this.runnableWork();
  }
}

// Shapes the one recoverable state handed to a fresh next gate or correction: it
// carries consumed history and remaining obligations, never a reset budget.
function successorPacket(gate, { next_role, carried_evidence }) {
  if (!(gate instanceof GateAssignment) || gate.state !== 'ACCEPTED' || !GATE_ROLES.includes(next_role) || !list(carried_evidence)) refuse('V3_GATE_SUCCESSOR_INVALID');
  const v = gate.value;
  return Object.freeze({ schema: 'toolkit.v3.gate-successor.v1', predecessor: { assignment_id: v.assignment_id, role: v.role,
    digest: gate.digest, revision: v.revision }, next_role, programme: v.programme, child: v.child,
    consumed_returns: v.consumed_returns, decisions: v.decisions,
    open_blockers: v.blockers.filter(b => b.state === 'OPEN'), remaining_work: v.work.filter(w => w.state !== 'DONE'),
    carried_evidence, budget_reset: false, rediscovery_required: false });
}

// Owns the recovered full-scope reviewer roster and evidence dependencies.
// Admission remains at the existing authenticated receipt boundary; evaluation
// creates no launch, publication or replacement decision authority.
class ReviewSetEvaluator {
  #compiled; #state; #observation; #packets; #verifiedResult;
  constructor({ compiled, state, observation, packetById, verifiedResult }) {
    if (!(packetById instanceof Map) || typeof verifiedResult !== 'function') refuse('V3_REVIEW_DEPENDENCIES_REQUIRED');
    this.#compiled=copy(compiled); this.#state=copy(state); this.#observation=copy(observation);
    this.#packets=new Map([...packetById].map(([key,value])=>[key,copy(value)])); this.#verifiedResult=verifiedResult;
  }
  evaluate() {
    const compiled=this.#compiled, state=this.#state, observation=this.#observation,
      packetById=this.#packets, verifiedResult=this.#verifiedResult;
  const current = compiled.decision.schema === 'toolkit.controller-decision.v2';
  const required = current ? compiled.selection.reviewers.map(member=>member.reviewer_id) : ['REVIEW_SCOPE','REVIEW_EXECUTION'];
  if (!required.length || new Set(required).size !== required.length) refuse('V3_REVIEW_SET_INVALID');
  const reviewRoles = new Set(), reviewSessions = new Set();
  if (current && observation.review_sessions.length !== state.review_packet_ids.length) refuse('V3_REVIEW_INDEPENDENCE_UNVERIFIED');
  let pairedReview = state.review_packet_ids.length === required.length;
  for (const packetId of state.review_packet_ids) {
    const entry = packetById.get(packetId), packet = entry?.packet;
    if (!packet || packet.schema !== 'toolkit.github-program.authority-packet.v3' || packet.bindings.producer.stage !== 'G2') refuse('V3_REVIEW_UNVERIFIED');
    const disposition = packet.body.sections.find(section => section.name === 'disposition');
    const review = parse(disposition?.text);
    keys(review, [...(current ? ['reviewer_id'] : []), 'schema', 'decision_digest', 'candidate', 'environment_digest', 'role', 'route', 'session_id',
      'builder_session_id', 'origin', 'previous_review_digest', 'coverage', 'findings', 'validation_evidence_ids']);
    const attestation = observation.review_sessions.find(item => item.packet_id === packetId);
    if (!attestation) refuse('V3_REVIEW_INDEPENDENCE_UNVERIFIED');
    keys(attestation, [...(current ? ['reviewer_id'] : []), 'packet_id', 'review_digest', 'session_id', 'builder_session_id', 'route', 'previous_review_digest',
      'independent_from_builder', 'peer_verdict_consumed', 'implemented_candidate', 'context_available']);
    const member = current ? review.reviewer_id : review.role;
    let resolved;
    try { resolved = compiler.resolveControllerRole(compiled, review.role, current ? member : null); }
    catch { refuse('V3_REVIEW_SET_INVALID'); }
    if (!required.includes(member) || reviewRoles.has(member)) refuse('V3_REVIEW_SET_INVALID');
    if (current && (review.role !== 'REVIEW' || attestation.reviewer_id !== member
      || packet.bindings.producer.reviewer_id !== member
      || packet.body.recovery_checkpoint_v3.route.reviewer_id !== member
      || packet.body.recovery_checkpoint_v3.route.registry_digest !== compiled.selection.registry_digest
      || !equal(packet.body.recovery_checkpoint_v3.route.registry_reference, compiled.selection.registry_reference))) refuse('V3_REVIEW_UNVERIFIED');
    if (review.schema !== (current ? 'toolkit.v3.review.v2' : 'toolkit.v3.review.v1') || review.decision_digest !== compiled.decision_digest
      || !equal(review.candidate, state.candidate) || !equal(packet.bindings.candidate, state.candidate)
      || review.environment_digest !== state.environment_digest || !(current ? ['REVIEW'] : ['REVIEW_SCOPE', 'REVIEW_EXECUTION']).includes(review.role)
      || packet.bindings.producer.role !== review.role || !equal(review.route, resolved.route)
      || !equal(review.route, { provider: packet.body.recovery_checkpoint_v3.route.provider,
        model: packet.body.recovery_checkpoint_v3.route.model, reasoning: packet.body.recovery_checkpoint_v3.route.reasoning })
      || !equal(attestation.route, review.route) || reviewSessions.has(review.session_id)
      || attestation.review_digest !== digest(review) || attestation.session_id !== review.session_id
      || attestation.builder_session_id !== review.builder_session_id || review.builder_session_id !== state.builder_session_id
      || review.session_id === review.builder_session_id
      || attestation.previous_review_digest !== review.previous_review_digest
      || attestation.independent_from_builder !== true || attestation.peer_verdict_consumed !== false
      || attestation.implemented_candidate !== false || attestation.context_available !== true
      || !list(review.coverage) || !state.criteria.every(criterion => review.coverage.includes(criterion))
      || !list(review.validation_evidence_ids) || current && review.validation_evidence_ids.length === 0 || !Array.isArray(review.findings)
      || !['FRESH', 'CORRECTION'].includes(review.origin)
      || review.origin === 'FRESH' && review.previous_review_digest !== null
      || review.origin === 'CORRECTION' && !hex(review.previous_review_digest)) refuse('V3_REVIEW_UNVERIFIED');
    for (const evidenceId of review.validation_evidence_ids) if (!verifiedResult(evidenceId, 'builder')) pairedReview = false;
    for (const finding of review.findings) {
      keys(finding, ['id', 'disposition']);
      if (!id(finding.id) || !['BLOCKING', 'NON_BLOCKING', 'RESOLVED'].includes(finding.disposition)) refuse('V3_REVIEW_UNVERIFIED');
      if (finding.disposition === 'BLOCKING') pairedReview = false;
    }
    if (packet.body.verdict !== 'PASS') pairedReview = false;
    reviewRoles.add(member); reviewSessions.add(review.session_id);
  }
  pairedReview = pairedReview && required.every(member=>reviewRoles.has(member)) && reviewSessions.size === required.length;
  return Object.freeze({ accepted: pairedReview, required_members: Object.freeze(required),
    observed_members: Object.freeze([...reviewRoles]), result: pairedReview ? current ? 'REVIEW_SET_ACCEPTED' : 'PAIRED_REVIEW_ACCEPTED' : 'PENDING' });

  }
}

function evaluateRecoveredLifecycle(input) {
  const { compiled, admitted, state: untrustedState, observation: untrustedObservation } = input;
  const state = copy(untrustedState), observation = copy(untrustedObservation);
  keys(state, ['schema', 'decision_digest', 'scope_digest', 'candidate', 'environment_digest', 'builder_session_id', 'criteria',
    'builder_evidence_ids', 'owner_evidence_ids', 'impact_evidence_id', 'controller_uat_evidence_id',
    'review_packet_ids', 'custody_evidence_id', 'publication', 'integration_evidence_id', 'installation_evidence_id', 'programme_outcomes']);
  keys(observation, ['decision_digest', 'candidate', 'environment_digest', 'evidence_digests', 'result_observations',
    'required_outcome_ids', 'controller_evidence_ids', 'review_sessions']);
  if (state.schema !== 'toolkit.v3.lifecycle.v1' || state.decision_digest !== compiled.decision_digest
    || observation.decision_digest !== compiled.decision_digest || state.scope_digest !== admitted.consumer.scope_digest
    || !equal(state.candidate, admitted.candidate) || !equal(observation.candidate, state.candidate)
    || !hex(state.environment_digest) || observation.environment_digest !== state.environment_digest
    || !id(state.builder_session_id) || !list(state.criteria) || state.criteria.length === 0
    || !compiled.decision.verification.requirements.every(requirement => state.criteria.includes(requirement))
    || !list(state.builder_evidence_ids)
    || !list(state.owner_evidence_ids) || !list(state.review_packet_ids) || !list(observation.controller_evidence_ids)
    || !observation.evidence_digests || Array.isArray(observation.evidence_digests)
    || typeof observation.evidence_digests !== 'object' || !observation.result_observations
    || typeof observation.result_observations !== 'object' || Array.isArray(observation.result_observations)
    || !list(observation.required_outcome_ids) || !Array.isArray(observation.review_sessions)
    || !Array.isArray(state.programme_outcomes)) refuse('V3_LIFECYCLE_BINDING_MISMATCH');
  const evidence = new Map(), packetById = new Map();
  for (const entry of admitted.packets) {
    packetById.set(entry.packet_id, entry);
    for (const item of entry.verified_evidence) {
      if (typeof item.content !== 'string') continue;
      const previous = evidence.get(item.evidence_id);
      if (previous && (previous.reference_digest !== item.reference_digest || previous.content !== item.content)) refuse('V3_EVIDENCE_CONFLICT');
      evidence.set(item.evidence_id, item);
    }
  }
  function get(evidenceId, kind = 'GIT_BLOB') {
    const item = evidence.get(evidenceId);
    if (!item || item.kind !== kind || observation.evidence_digests[evidenceId] !== item.reference_digest) refuse('V3_EVIDENCE_UNVERIFIED');
    return { item, value: parse(item.content) };
  }
  function verifiedResult(evidenceId, kind) {
    if (evidenceId === null) return false;
    const { value } = get(evidenceId);
    keys(value, ['schema', 'kind', 'decision_digest', 'candidate', 'environment_digest', 'state']);
    if (value.schema !== 'toolkit.v3.result.v1' || value.kind !== kind || value.decision_digest !== state.decision_digest
      || !equal(value.candidate, state.candidate) || value.environment_digest !== state.environment_digest
      || !['PASS', 'PENDING', 'FAIL'].includes(value.state)) refuse('V3_RESULT_BINDING_MISMATCH');
    if (!equal(observation.result_observations[evidenceId], value)) refuse('V3_RESULT_OBSERVATION_UNVERIFIED');
    return value.state === 'PASS';
  }
  const builderReady = state.builder_evidence_ids.length > 0 && state.builder_evidence_ids.every(evidenceId => verifiedResult(evidenceId, 'builder'));
  const custodyVerified = verifiedResult(state.custody_evidence_id, 'custody');
  const integrationVerified = verifiedResult(state.integration_evidence_id, 'integration');
  const installationVerified = verifiedResult(state.installation_evidence_id, 'installation');
  const owners = state.owner_evidence_ids.map(evidenceId => {
    const { item, value } = get(evidenceId, 'OWNER_UAT');
    keys(value, ['schema', 'disposition', 'candidate', 'environment_digest', 'criteria']);
    if (value.schema !== 'toolkit.v3.owner-uat.v1' || value.disposition !== 'ACCEPTED' || !list(value.criteria)
      || item.source.author_login !== admitted.packets[0].packet.bindings.human_owner
      || item.source.repository !== compiled.decision.identity.repository
      || item.source.issue_number !== compiled.decision.identity.child) refuse('V3_OWNER_UAT_UNVERIFIED');
    return { evidenceId, value };
  });
  let uatStatus = 'PENDING', uatAccepted = false;
  const exactOwners = owners.filter(owner => equal(owner.value.candidate, state.candidate) && owner.value.environment_digest === state.environment_digest);
  const exactCoverage = new Set(exactOwners.flatMap(owner => owner.value.criteria));
  if (state.criteria.every(criterion => exactCoverage.has(criterion))) { uatAccepted = true; uatStatus = 'UAT_RETAINED'; }
  else if (owners.length && state.impact_evidence_id !== null && state.controller_uat_evidence_id !== null) {
    const impact = get(state.impact_evidence_id).value;
    const controller = get(state.controller_uat_evidence_id).value;
    keys(controller, ['schema', 'decision_digest', 'impact_evidence_id', 'status', 'candidate']);
    if (controller.schema !== 'toolkit.v3.uat-applicability.v1' || controller.decision_digest !== state.decision_digest
      || controller.impact_evidence_id !== state.impact_evidence_id || !equal(controller.candidate, state.candidate)
      || !observation.controller_evidence_ids.includes(state.controller_uat_evidence_id)
      || !equal(impact.candidate, state.candidate)) refuse('V3_CONTROLLER_UAT_UNVERIFIED');
    const original = owners.find(owner => equal(owner.value.candidate, impact.accepted_candidate));
    if (!original || original.value.environment_digest !== state.environment_digest && !impact.changed_dimensions.includes('environment')
      || !state.criteria.every(criterion => original.value.criteria.includes(criterion))
      || impact.affected_criteria.some(criterion => !state.criteria.includes(criterion))) refuse('V3_UAT_IMPACT_INVALID');
    for (const evidenceId of impact.targeted_verification_evidence_ids) {
      if (!verifiedResult(evidenceId, 'builder')) refuse('V3_UAT_IMPACT_UNVERIFIED');
    }
    uatStatus = classifyUatImpact(impact);
    if (controller.status !== uatStatus) refuse('V3_CONTROLLER_UAT_UNVERIFIED');
    uatAccepted = uatStatus === 'UAT_RETAINED'
      || uatStatus === 'UAT_PARTIAL_REQUIRED' && impact.affected_criteria.every(criterion => exactCoverage.has(criterion));
  }
  const reviewSet = new ReviewSetEvaluator({ compiled, state, observation, packetById, verifiedResult }).evaluate();
  const pairedReview = reviewSet.accepted;
  keys(state.publication, ['state', 'pending_effects', 'evidence_id']);
  if (!['CURRENT', 'PENDING', 'UNKNOWN'].includes(state.publication.state) || !Array.isArray(state.publication.pending_effects)) refuse('V3_PUBLICATION_INVALID');
  const pendingIds = new Set();
  for (const effect of state.publication.pending_effects) {
    keys(effect, ['effect_id', 'effect_digest', 'state']);
    if (!id(effect.effect_id) || pendingIds.has(effect.effect_id) || !hex(effect.effect_digest)
      || !['PREPARED', 'UNKNOWN', 'APPLIED', 'NOT_APPLIED', 'DENIED'].includes(effect.state)) refuse('V3_PUBLICATION_INVALID');
    pendingIds.add(effect.effect_id);
  }
  const publicationCurrent = state.publication.state === 'CURRENT'
    && state.publication.pending_effects.every(effect => effect.state === 'APPLIED')
    && verifiedResult(state.publication.evidence_id, 'publication');
  const coreDone = builderReady && uatAccepted && pairedReview && custodyVerified && publicationCurrent && integrationVerified && installationVerified;
  const outcomeIds = new Set();
  const outcomesDone = state.programme_outcomes.length > 0
    && equal(state.programme_outcomes.map(outcome => outcome.id).sort(), [...observation.required_outcome_ids].sort())
    && state.programme_outcomes.every(outcome => {
    keys(outcome, ['id', 'state', 'evidence_id']);
    if (!id(outcome.id) || outcomeIds.has(outcome.id) || !['COMPLETE', 'DISPOSED_WITH_OWNER', 'PENDING'].includes(outcome.state)) refuse('V3_PROGRAMME_INVALID');
    outcomeIds.add(outcome.id);
    return outcome.state !== 'PENDING' && verifiedResult(outcome.evidence_id, 'programme');
  });
  return Object.freeze({ schema: 'toolkit.v3.release-state.v1', decision_digest: compiled.decision_digest,
    candidate: state.candidate, builder: builderReady ? 'READY' : 'INCOMPLETE', uat_applicability: uatStatus,
    uat: uatAccepted ? publicationCurrent ? 'ACCEPTED' : 'UAT_ACCEPTED_PUBLICATION_PENDING' : 'PENDING',
    g2: reviewSet.result, custody: custodyVerified ? 'VERIFIED' : 'CUSTODY_PENDING',
    integration: integrationVerified ? 'VERIFIED' : 'PENDING', installation: installationVerified ? 'VERIFIED' : 'PENDING',
    publication: publicationCurrent ? 'CURRENT' : state.publication.state,
    core: coreDone ? 'CORE_RELEASE_DONE' : 'INCOMPLETE', parent: coreDone && outcomesDone ? 'PARENT_DONE' : 'INCOMPLETE',
    pending_updates: state.publication.pending_effects.filter(effect => effect.state !== 'APPLIED'), mutation_authority: false,
    requires_fresh_publication_reconciliation: !publicationCurrent });
}

module.exports = Object.freeze({ ReviewSetEvaluator, GateAssignment, successorPacket, SESSION_STATES, ACCEPTANCE_MODES,
  planRenewal, classifyUatImpact, reviewerContinuation, evaluateRecoveredLifecycle, digest });
