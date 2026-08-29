'use strict';

// E3 v5 is intentionally a separate module.  v4 remains a frozen migration
// input and compatibility surface; no v4 singleton cursor semantics are
// changed here.
const crypto = require('node:crypto');
const v4 = require('./toolkit-github-program-state-v4.cjs');
const SURFACE_CONTRACT = require('../contracts/github-program-reconciler/programme-surface-contract-v5.json');

const STATE_SCHEMA = 'toolkit.github-program.state.v5';
const PROJECTION_SCHEMA = 'toolkit.github-program.projection.v1';
const EXTENSIONS_SCHEMA = 'toolkit.github-program.extensions.v1';
const MANAGED_EVENT_SCHEMA = 'toolkit.github-program.managed-event.v3';
const RUN_RECEIPT_SCHEMA = 'toolkit.github-program.run-receipt.v1';
const BOOTSTRAP_SCHEMA = 'toolkit.github-program.controller-bootstrap.v1';
const MIGRATION_SCHEMA = 'toolkit.github-program.migration.v2';
const DESIGN_LOCK = 'DL-S2-GITHUB-PROGRAM-SURFACE-RECOVERY-003';
const BOOTSTRAP_REVISION = 'DL-S2-GITHUB-PROGRAM-SURFACE-RECOVERY-003-v5';
const BOOTSTRAP_CONTRACTS = Object.freeze({
  state: 'repo/contracts/github-program-reconciler/programme-state-v5.schema.json',
  event: 'repo/contracts/github-program-reconciler/managed-event-v3.schema.json',
  receipt: 'repo/contracts/github-program-reconciler/run-receipt-v1.schema.json',
  surface: 'repo/contracts/github-program-reconciler/programme-surface-contract-v5.json',
  entrypoint: 'repo/contracts/github-program-reconciler/web-controller-entry.md',
});
const BODY_BUDGET_BYTES = 56 * 1024;
const CANONICAL_STATE_BUDGET_BYTES = 32 * 1024;
const TOTAL_PROJECTION_BUDGET_BYTES = 512 * 1024;
const RECEIPT_BUDGET_BYTES = 16 * 1024;
const LIFECYCLES = Object.freeze(['QUEUED', 'CURRENT', 'COMPLETED', 'RETIRED']);
const REGISTRY_STATUSES = Object.freeze(['ACTIVE', 'ACCEPTED', 'RETIRED']);
const LIVE_PR_LIFECYCLES = Object.freeze(['OPEN_DRAFT', 'OPEN_READY', 'MERGED', 'CLOSED_UNMERGED']);
const AUTHORITY_MODES = Object.freeze(['SINGLE_DEFAULT', 'EXPLICIT_BOUNDED']);
const GATE_STATES = Object.freeze(['ACTIVE', 'RESULT_RECORDED']);
const GATE_RESULTS = Object.freeze([null, 'AMEND', 'PASS']);
const RECOVERY_STATUSES = Object.freeze([
  'RUNNING', 'LOST', 'TERMINAL_UNCONSUMED', 'PREVIEWED_NOT_APPLIED',
  'APPLIED_ACK_LOST', 'ALREADY_APPLIED', 'STALE_CANDIDATE',
  'CONFLICTING_TRANSITION', 'EXPIRED_FENCE', 'G4_UNADJUDICATED',
  'WEB_DECISION_REQUIRED',
]);
const RECEIPT_TYPES = Object.freeze([
  'RUN_STARTED', 'EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED',
  'LEASE_EXPIRED', 'HOSTED_CHECK', 'TRANSITION_PREVIEW',
]);
const MARKERS = Object.freeze({
  parent: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v5 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->' }),
  child: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v5 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->' }),
  pr: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:BEGIN v5 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END -->' }),
});
const STATE_LINE_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CANONICAL v5 ';
const PROJECTION_LINE_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PROJECTION v1 ';
const LINE_SUFFIX = ' -->';
const SAFE_REPOSITORY = /^[^\r\n]{1,200}$/;

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalJson(value) { return JSON.stringify(sortValue(value)); }
function digest(value) { const serialized = typeof value === 'string' ? value : canonicalJson(value); return crypto.createHash('sha256').update(serialized === undefined ? 'undefined' : serialized, 'utf8').digest('hex'); }
function bytes(value) { const serialized = typeof value === 'string' ? value : canonicalJson(value); return Buffer.byteLength(serialized === undefined ? 'undefined' : serialized, 'utf8'); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function exactKeys(value, required, optional = []) {
  if (!isRecord(value) || required.some((key) => !hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}
function ok(code, extra = {}) { return { ok: true, code, ...extra }; }
function fail(reason, extra = {}) { return { ok: false, code: 'PARENT_RECONCILIATION_INCOMPLETE', reason, ...extra }; }
function issue(value) { return Number.isSafeInteger(value) && value > 0; }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function safeLine(value, limit = 512) { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\r\n]/.test(value); }
function safeText(value, limit = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && !/```|(?:^|[\\/])(?:Users|home|private|secrets?)(?:[\\/]|$)|(?:token|password|secret|api[_-]?key)\s*[:=]/i.test(value);
}
function sha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function sha256(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function arrayOf(value, predicate, max = 100) { return Array.isArray(value) && value.length <= max && value.every(predicate); }
function encode(value) { return Buffer.from(canonicalJson(value), 'utf8').toString('base64url'); }
function decode(value) { try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch (_error) { return null; } }
function list(values) { return values.length ? values.map((value) => `- ${value}`).join('\n') : 'None'; }
function markdownCell(value) { return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }
function table(headers, rows) {
  if (!rows.length) return 'None';
  return ['| ' + headers.map(markdownCell).join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map((row) => '| ' + row.map(markdownCell).join(' | ') + ' |')].join('\n');
}
function sortedNumbers(values) { return values.slice().sort((a, b) => a - b); }

function validateEvidenceRefs(refs) {
  return Array.isArray(refs) && refs.length <= 200
    && refs.every((entry) => exactKeys(entry, ['id', 'kind', 'reference', 'summary'])
      && safeId(entry.id) && ['WEB', 'COMMIT', 'PR', 'CHECK', 'REVIEW', 'ISSUE', 'MIGRATION'].includes(entry.kind)
      && safeLine(entry.reference, 256) && safeLine(entry.summary, 512))
    && new Set((refs || []).map((entry) => entry.id)).size === (refs || []).length;
}
function evidenceMap(state) { return new Map(state.evidence_refs.map((entry) => [entry.id, entry])); }
function evidenceIsWeb(state, ref) { return ref === null || evidenceMap(state).get(ref)?.kind === 'WEB'; }
function textArray(value, max = 50) { return arrayOf(value, (entry) => safeText(entry), max); }
function blockingHolds(child) { return child.holds.filter((hold) => hold.kind === 'BLOCKING' && hold.active); }
function effectiveLifecycle(child) { return child.lifecycle === 'CURRENT' && blockingHolds(child).length ? 'BLOCKED' : child.lifecycle; }
function registryFor(state, prNumber) {
  for (const child of state.children) {
    const registry = child.pr_registry.find((entry) => entry.pr === prNumber);
    if (registry) return { child, registry, epoch: child.epochs.find((epoch) => epoch.id === registry.epoch_id) };
  }
  return null;
}
function laneForChild(state, issueNumber) { return state.active_lanes.find((lane) => lane.child_issue === issueNumber) || null; }
function laneForPr(state, prNumber) { return state.active_lanes.find((lane) => lane.candidate?.pr === prNumber) || null; }
function activeRegistry(child) { return child.pr_registry.filter((entry) => entry.status === 'ACTIVE'); }
function validateEpochs(child, state) {
  const evidenceIds = new Set(state.evidence_refs.map((entry) => entry.id));
  if (!Array.isArray(child.epochs) || child.epochs.length === 0 || child.epochs.length > 30) return false;
  const seen = new Set();
  for (const epoch of child.epochs) {
    if (!exactKeys(epoch, ['id', 'name', 'lock', 'purpose', 'gates', 'terminal_disposition', 'evidence_ref'])
      || !safeId(epoch.id) || seen.has(epoch.id) || !safeLine(epoch.name, 160) || !safeId(epoch.lock)
      || !safeText(epoch.purpose) || !arrayOf(epoch.gates, safeId, 30) || !epoch.gates.length
      || new Set(epoch.gates).size !== epoch.gates.length || ![null, 'ACCEPTED', 'RETIRED'].includes(epoch.terminal_disposition)
      || epoch.evidence_ref !== null && (!evidenceIds.has(epoch.evidence_ref))) return false;
    if (epoch.terminal_disposition !== null && (!epoch.evidence_ref || !evidenceIsWeb(state, epoch.evidence_ref))) return false;
    seen.add(epoch.id);
  }
  return true;
}
function validateChildHolds(child, evidenceIds) {
  if (!Array.isArray(child.holds) || child.holds.length > 30) return false;
  const seen = new Set();
  for (const hold of child.holds) {
    if (!exactKeys(hold, ['id', 'kind', 'summary', 'evidence_ref', 'active']) || !safeId(hold.id)
      || seen.has(hold.id) || !['BLOCKING', 'INFORMATIONAL'].includes(hold.kind) || !safeText(hold.summary)
      || !evidenceIds.has(hold.evidence_ref) || typeof hold.active !== 'boolean') return false;
    seen.add(hold.id);
  }
  return true;
}
function validateRegistry(child, evidenceIds, epochIds, activeRegistryPrs) {
  if (!Array.isArray(child.pr_registry) || child.pr_registry.length > 50) return false;
  const seen = new Set();
  for (const entry of child.pr_registry) {
    if (!exactKeys(entry, ['pr', 'status', 'role', 'completes_child', 'epoch_id', 'accepted_evidence_ref', 'retirement_evidence_ref'])
      || !issue(entry.pr) || seen.has(entry.pr) || !REGISTRY_STATUSES.includes(entry.status)
      || !['INTERMEDIATE', 'TERMINAL'].includes(entry.role) || typeof entry.completes_child !== 'boolean'
      || !epochIds.has(entry.epoch_id) || entry.role === 'INTERMEDIATE' && entry.completes_child
      || entry.accepted_evidence_ref !== null && !evidenceIds.has(entry.accepted_evidence_ref)
      || entry.retirement_evidence_ref !== null && !evidenceIds.has(entry.retirement_evidence_ref)) return false;
    if (entry.status === 'ACTIVE') activeRegistryPrs.add(entry.pr);
    if (entry.status === 'ACCEPTED' && (!entry.accepted_evidence_ref || !evidenceIds.has(entry.accepted_evidence_ref))) return false;
    if (entry.status === 'RETIRED' && (!entry.retirement_evidence_ref || !evidenceIds.has(entry.retirement_evidence_ref))) return false;
    seen.add(entry.pr);
  }
  return true;
}
function candidateValid(candidate) {
  return exactKeys(candidate, ['pr', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version', 'epoch_id'])
    && issue(candidate.pr) && safeLine(candidate.branch, 256) && safeLine(candidate.base_ref, 256)
    && sha(candidate.base_sha) && sha(candidate.head) && sha(candidate.tree) && safeLine(candidate.version, 80)
    && safeId(candidate.epoch_id);
}
function authorityDigest(authority) {
  return digest({
    mode: authority.mode,
    max_active_lanes: authority.max_active_lanes,
    authority_ref: authority.authority_ref,
    permitted_child_issues: authority.permitted_child_issues,
  });
}
function validateConcurrencyAuthority(authority, currentIssues = [], options = {}) {
  if (!exactKeys(authority, ['mode', 'max_active_lanes', 'authority_ref', 'authority_digest', 'permitted_child_issues'])
    || !AUTHORITY_MODES.includes(authority.mode) || !Number.isSafeInteger(authority.max_active_lanes)
    || authority.max_active_lanes < 1 || authority.max_active_lanes > 50
    || authority.authority_ref !== null && !safeLine(authority.authority_ref, 512)
    || authority.authority_digest !== null && !sha256(authority.authority_digest)
    || !arrayOf(authority.permitted_child_issues, issue, 50)
    || new Set(authority.permitted_child_issues).size !== authority.permitted_child_issues.length
    || !same(authority.permitted_child_issues, sortedNumbers(authority.permitted_child_issues))) return fail('concurrency-authority-shape');
  if (authority.mode === 'SINGLE_DEFAULT') {
    if (authority.max_active_lanes !== 1 || authority.authority_ref !== null || authority.authority_digest !== null || authority.permitted_child_issues.length) return fail('single-default-authority-invalid');
  } else {
    if (authority.max_active_lanes < 2 || !authority.authority_ref || !authority.authority_digest || authority.authority_digest !== authorityDigest(authority)) return fail('explicit-bounded-authority-invalid');
    const known = new Set(options.childIssues || []);
    if (authority.permitted_child_issues.some((entry) => known.size && !known.has(entry))) return fail('explicit-bounded-child-not-in-programme');
    if (currentIssues.some((entry) => !authority.permitted_child_issues.includes(entry))) return fail('current-child-not-authorised');
  }
  if (currentIssues.length > authority.max_active_lanes) return fail('active-lane-bound-exceeded');
  if (currentIssues.length > 1 && authority.mode !== 'EXPLICIT_BOUNDED') return fail('unauthorized-multiple-current-children');
  return ok('CONCURRENCY_AUTHORITY_VALID', { authority_digest: authority.authority_digest || null });
}
function normalizeResource(resource) {
  return String(resource).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
}
function resourcesOverlap(left, right) {
  const a = normalizeResource(left);
  const b = normalizeResource(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
function validateWorkClaims(input) {
  const lanes = Array.isArray(input) ? input : input?.lanes || input?.active_lanes || [];
  if (!Array.isArray(lanes)) return fail('work-claims-shape');
  const claims = [];
  for (const lane of lanes) {
    const laneId = lane?.lane_id || 'lane';
    const values = Array.isArray(lane) ? lane : lane.work_claims;
    if (!Array.isArray(values) || !values.length) return fail('work-claims-required', { lane_id: laneId });
    const seen = new Set();
    for (const claim of values) {
      if (!exactKeys(claim, ['mode', 'resource'], ['operation', 'scope']) || !['READ', 'WRITE'].includes(claim.mode)
        || !safeLine(claim.resource, 512) || claim.operation !== undefined && !safeId(claim.operation)
        || claim.scope !== undefined && !safeLine(claim.scope, 512)) return fail('work-claim-invalid', { lane_id: laneId });
      const normalized = normalizeResource(claim.resource);
      const key = `${claim.mode}:${normalized}:${claim.operation || ''}:${claim.scope || ''}`;
      if (seen.has(key)) return fail('duplicate-work-claim', { lane_id: laneId, resource: normalized });
      seen.add(key);
      claims.push({ lane_id: laneId, mode: claim.mode, resource: normalized, operation: claim.operation, scope: claim.scope });
    }
  }
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (left.lane_id === right.lane_id || !resourcesOverlap(left.resource, right.resource)) continue;
      if (left.mode === 'READ' && right.mode === 'READ') continue;
      return fail('work-claim-overlap', { left, right });
    }
  }
  return ok('WORK_CLAIMS_VALID', { claims });
}
function dependencyCycle(children) {
  const byIssue = new Map(children.map((child) => [child.issue, child]));
  const visiting = new Set();
  const visited = new Set();
  function visit(number) {
    if (visiting.has(number)) return true;
    if (visited.has(number)) return false;
    visiting.add(number);
    for (const dependency of byIssue.get(number).dependencies) if (visit(dependency)) return true;
    visiting.delete(number);
    visited.add(number);
    return false;
  }
  return children.some((child) => visit(child.issue));
}

function validateCanonicalStateV5(state) {
  if (!exactKeys(state, ['schema', 'design_lock', 'repository', 'parent', 'children', 'prs', 'concurrency_authority', 'active_lanes', 'predecessor_contract_digest', 'evidence_refs', 'historical_transitions', 'extensions'])
    || state.schema !== STATE_SCHEMA || state.design_lock !== DESIGN_LOCK || !SAFE_REPOSITORY.test(state.repository)
    || !exactKeys(state.parent, ['issue', 'title', 'goal']) || !issue(state.parent.issue) || !safeLine(state.parent.title, 256)
    || !safeText(state.parent.goal) || !Array.isArray(state.children) || !state.children.length || state.children.length > 50
    || !Array.isArray(state.prs) || state.prs.length > 100 || !sha256(state.predecessor_contract_digest)
    || !validateEvidenceRefs(state.evidence_refs) || !Array.isArray(state.historical_transitions) || state.historical_transitions.length > 200
    || !Array.isArray(state.active_lanes) || state.active_lanes.length > 50) return fail('canonical-state-shape');
  if (bytes(state) > CANONICAL_STATE_BUDGET_BYTES) return fail('canonical-state-byte-budget-exceeded', { limit: CANONICAL_STATE_BUDGET_BYTES, actual: bytes(state) });
  const evidenceIds = new Set(state.evidence_refs.map((entry) => entry.id));
  const childIssues = new Set();
  const activeRegistryPrs = new Set();
  for (const child of state.children) {
    if (!exactKeys(child, ['issue', 'order', 'title', 'summary', 'objective', 'deliverables', 'done_when', 'lifecycle', 'dependencies', 'scope', 'out_of_scope', 'boundaries', 'eli5', 'epochs', 'holds', 'pr_registry', 'finality'])
      || !issue(child.issue) || childIssues.has(child.issue) || !Number.isSafeInteger(child.order) || child.order < 1
      || !safeLine(child.title, 256) || !safeText(child.summary) || !safeText(child.objective) || !textArray(child.deliverables)
      || !child.deliverables.length || !textArray(child.done_when) || !child.done_when.length || !LIFECYCLES.includes(child.lifecycle)
      || !arrayOf(child.dependencies, issue, 50) || new Set(child.dependencies).size !== child.dependencies.length
      || !textArray(child.scope) || !textArray(child.out_of_scope) || !textArray(child.boundaries) || !safeText(child.eli5)
      || !exactKeys(child.finality, ['state', 'authority_ref']) || !['HELD', 'READY_AUTHORIZED', 'MERGED', 'RETIRED'].includes(child.finality.state)
      || child.finality.authority_ref !== null && !evidenceIds.has(child.finality.authority_ref)) return fail('canonical-child-shape', { child: child?.issue });
    if (child.finality.authority_ref !== null && !evidenceIsWeb(state, child.finality.authority_ref)) return fail('finality-web-authority-required', { child: child.issue });
    if (!validateEpochs(child, state) || !validateChildHolds(child, evidenceIds)) return fail('canonical-child-epoch-or-hold-shape', { child: child.issue });
    const epochIds = new Set(child.epochs.map((epoch) => epoch.id));
    if (!validateRegistry(child, evidenceIds, epochIds, activeRegistryPrs)) return fail('canonical-registry-shape', { child: child.issue });
    childIssues.add(child.issue);
  }
  if (new Set(state.children.map((child) => child.order)).size !== state.children.length) return fail('duplicate-child-order');
  for (const child of state.children) {
    if (child.dependencies.some((dependency) => !childIssues.has(dependency) || dependency === child.issue)) return fail('dependency-outside-scope', { child: child.issue });
    if (child.lifecycle === 'CURRENT' && child.dependencies.some((dependency) => !['COMPLETED', 'RETIRED'].includes(state.children.find((entry) => entry.issue === dependency)?.lifecycle))) return fail('dependency-conflict', { child: child.issue });
  }
  if (dependencyCycle(state.children)) return fail('dependency-cycle');
  const prNumbers = new Set();
  const registryRefs = new Map();
  for (const child of state.children) for (const entry of child.pr_registry) {
    if (!registryRefs.has(entry.pr)) registryRefs.set(entry.pr, []);
    registryRefs.get(entry.pr).push({ child, entry });
  }
  for (const pr of state.prs) {
    if (!exactKeys(pr, ['number', 'child_issue', 'summary', 'purpose', 'scope', 'out_of_scope', 'design_constraints', 'changed_surfaces', 'validation_requirements', 'evidence_refs', 'eli5'])
      || !issue(pr.number) || prNumbers.has(pr.number) || !childIssues.has(pr.child_issue) || !safeText(pr.summary) || !safeText(pr.purpose)
      || !textArray(pr.scope) || !textArray(pr.out_of_scope) || !textArray(pr.design_constraints) || !arrayOf(pr.changed_surfaces, (entry) => safeLine(entry, 512), 100)
      || !textArray(pr.validation_requirements) || !pr.validation_requirements.length || !arrayOf(pr.evidence_refs, safeId, 50)
      || new Set(pr.evidence_refs).size !== pr.evidence_refs.length || pr.evidence_refs.some((ref) => !evidenceIds.has(ref)) || !safeText(pr.eli5)) return fail('canonical-pr-shape', { pr: pr?.number });
    if (!registryRefs.has(pr.number) || registryRefs.get(pr.number).length !== 1) return fail('pr-registry-binding-invalid', { pr: pr.number });
    prNumbers.add(pr.number);
  }
  for (const [pr, bindings] of registryRefs) if (!prNumbers.has(pr)) return fail('registry-pr-outside-scope', { pr });
  const current = state.children.filter((child) => child.lifecycle === 'CURRENT');
  const authority = validateConcurrencyAuthority(state.concurrency_authority, current.map((child) => child.issue), { childIssues: [...childIssues] });
  if (!authority.ok) return authority;
  const lanesSorted = state.active_lanes.slice().sort((left, right) => left.lane_id.localeCompare(right.lane_id));
  if (!same(state.active_lanes.map((lane) => lane.lane_id), lanesSorted.map((lane) => lane.lane_id))) return fail('active-lane-order-invalid');
  const laneIds = new Set();
  const laneChildren = new Set();
  const candidates = new Set();
  for (const lane of state.active_lanes) {
    if (!exactKeys(lane, ['lane_id', 'child_issue', 'epoch_id', 'gate', 'gate_state', 'gate_result', 'candidate', 'work_claims'])
      || !safeId(lane.lane_id) || laneIds.has(lane.lane_id) || !issue(lane.child_issue) || !childIssues.has(lane.child_issue)
      || laneChildren.has(lane.child_issue) || !safeId(lane.epoch_id) || !safeId(lane.gate) || !GATE_STATES.includes(lane.gate_state)
      || !GATE_RESULTS.includes(lane.gate_result) || lane.gate_state === 'ACTIVE' && lane.gate_result !== null
      || lane.gate_state === 'RESULT_RECORDED' && lane.gate_result === null || lane.candidate !== null && !candidateValid(lane.candidate)
      || !Array.isArray(lane.work_claims) || !lane.work_claims.length) return fail('canonical-lane-shape', { lane: lane?.lane_id });
    const child = state.children.find((entry) => entry.issue === lane.child_issue);
    const epoch = child.epochs.find((entry) => entry.id === lane.epoch_id);
    if (!epoch || !epoch.gates.includes(lane.gate) || child.lifecycle !== 'CURRENT') return fail('lane-child-epoch-gate-binding-invalid', { lane: lane.lane_id });
    const active = activeRegistry(child);
    if (active.length > 0 && (!lane.candidate || active.length !== 1 || lane.candidate.pr !== active[0].pr || lane.candidate.epoch_id !== lane.epoch_id)) return fail('lane-candidate-binding-invalid', { lane: lane.lane_id });
    if (lane.candidate) {
      const binding = registryRefs.get(lane.candidate.pr);
      if (!binding || binding.length !== 1 || binding[0].child.issue !== lane.child_issue || binding[0].entry.status !== 'ACTIVE' || binding[0].entry.epoch_id !== lane.epoch_id) return fail('lane-candidate-registry-mismatch', { lane: lane.lane_id });
      const candidateKey = digest(lane.candidate);
      if (candidates.has(candidateKey) || [...candidates].some((key) => key === String(lane.candidate.pr) || key === lane.candidate.head || key === lane.candidate.tree)) return fail('duplicate-lane-candidate', { lane: lane.lane_id });
      candidates.add(candidateKey); candidates.add(String(lane.candidate.pr)); candidates.add(lane.candidate.head); candidates.add(lane.candidate.tree);
    }
    laneIds.add(lane.lane_id); laneChildren.add(lane.child_issue);
  }
  if (!same([...laneChildren].sort((a, b) => a - b), current.map((child) => child.issue).sort((a, b) => a - b))) return fail('current-child-lane-set-mismatch');
  const claims = validateWorkClaims(state.active_lanes);
  if (!claims.ok) return claims;
  for (const transition of state.historical_transitions) {
    if (!exactKeys(transition, ['id', 'child_issue', 'epoch_id', 'gate', 'disposition', 'evidence_ref']) || !safeId(transition.id)
      || !childIssues.has(transition.child_issue) || !safeId(transition.epoch_id) || !safeId(transition.gate)
      || !['ACCEPTED', 'AMEND', 'PASS', 'RETIRED'].includes(transition.disposition) || !evidenceIds.has(transition.evidence_ref)
      || !evidenceIsWeb(state, transition.evidence_ref)) return fail('historical-transition-invalid');
  }
  if (new Set(state.historical_transitions.map((entry) => entry.id)).size !== state.historical_transitions.length) return fail('duplicate-historical-transition');
  const extensions = v4.validateExtensionsV1(state.extensions, state);
  if (!extensions.ok) return extensions;
  return ok('PROGRAMME_STATE_V5_VALID', { canonical_digest: digest(state), canonical_bytes: bytes(state), active_lane_count: state.active_lanes.length });
}

function currentOutcome(state, child) {
  const lane = laneForChild(state, child.issue);
  if (blockingHolds(child).length) return `${child.title} is blocked by ${blockingHolds(child).length} authoritative hold(s).`;
  if (child.lifecycle === 'QUEUED') return `${child.title} is queued behind its declared dependencies.`;
  if (child.lifecycle === 'COMPLETED') return `${child.title} is completed with retained evidence.`;
  if (child.lifecycle === 'RETIRED') return `${child.title} is retired with retained evidence.`;
  if (lane) return `${child.title} is current in ${lane.epoch_id} at ${lane.gate}${lane.gate_state === 'RESULT_RECORDED' ? ` with ${lane.gate_result} recorded` : ''}.`;
  return `${child.title} is current but has no active lane.`;
}
function childProgress(state, child) {
  const lane = laneForChild(state, child.issue);
  const values = child.epochs.map((epoch) => {
    if (epoch.terminal_disposition) return `${epoch.id}: ${epoch.terminal_disposition}`;
    if (lane?.epoch_id === epoch.id) return `${epoch.id}: ${lane.gate} ${lane.gate_state}${lane.gate_result ? ` (${lane.gate_result})` : ''}`;
    return `${epoch.id}: PENDING`;
  });
  if (blockingHolds(child).length) values.push(`Blocking holds: ${blockingHolds(child).length}`);
  return values;
}
function childAchieved(state, child) {
  return [
    ...child.epochs.filter((epoch) => epoch.terminal_disposition !== null).map((epoch) => `${epoch.id} ${epoch.terminal_disposition}`),
    ...state.historical_transitions.filter((entry) => entry.child_issue === child.issue).map((entry) => `${entry.epoch_id} ${entry.gate} ${entry.disposition}`),
  ];
}
function childRemaining(state, child) {
  if (['COMPLETED', 'RETIRED'].includes(child.lifecycle)) return [];
  const lane = laneForChild(state, child.issue);
  const values = [];
  for (const epoch of child.epochs.filter((entry) => entry.terminal_disposition === null)) {
    const gateIndex = lane?.epoch_id === epoch.id ? epoch.gates.indexOf(lane.gate) : -1;
    const gates = gateIndex >= 0 ? epoch.gates.slice(gateIndex) : epoch.gates;
    values.push(...gates.map((gate) => `${epoch.id} ${gate}`));
  }
  values.push(child.finality.state === 'READY_AUTHORIZED' ? 'Separately authorised finality action' : 'Web finality disposition');
  return values;
}
function nextAction(state, child) {
  if (blockingHolds(child).length) return `Resolve authoritative hold ${blockingHolds(child)[0].id}.`;
  if (child.lifecycle === 'QUEUED') return 'Wait until dependencies are completed or retired.';
  if (child.lifecycle === 'COMPLETED' || child.lifecycle === 'RETIRED') return 'No delivery action remains.';
  const lane = laneForChild(state, child.issue);
  if (lane) return lane.gate_state === 'RESULT_RECORDED' ? `Obtain Web disposition for ${lane.epoch_id} ${lane.gate}.` : `Complete ${lane.epoch_id} ${lane.gate} without advancing finality.`;
  return child.finality.state === 'READY_AUTHORIZED' ? 'Await the separately authorised finality action.' : 'Obtain explicit Web finality authority.';
}
function extensionDigest(state) { return digest(state.extensions || []); }
function renderExtensions(extensions, target) {
  const selected = (extensions || []).filter((entry) => same(entry.target, target));
  if (!selected.length) return 'None';
  return selected.map((entry) => {
    if (entry.class === 'TABLE') return `### ${entry.title}\n${table(entry.payload.columns, entry.payload.rows)}`;
    const value = entry.payload.text || entry.payload.summary || `${entry.payload.domain}: ${entry.payload.status} - ${entry.payload.summary}`;
    return `### ${entry.title}\n${value}${entry.payload.references?.length ? `\n${list(entry.payload.references)}` : ''}`;
  }).join('\n\n');
}
function deriveProjectionV5(state) {
  const valid = validateCanonicalStateV5(state);
  if (!valid.ok) return valid;
  const children = state.children.slice().sort((a, b) => a.order - b.order).map((child) => {
    const lane = laneForChild(state, child.issue);
    const epoch = lane ? child.epochs.find((entry) => entry.id === lane.epoch_id) : null;
    return {
      issue: child.issue, parent_issue: state.parent.issue, title: child.title, lifecycle: effectiveLifecycle(child), summary: child.summary,
      operating_contract: { parent_issue: state.parent.issue, lane_id: lane?.lane_id || null, epoch_id: lane?.epoch_id || null, gate: lane?.gate || null, gate_state: lane?.gate_state || null, gate_result: lane?.gate_result || null, lock: epoch?.lock || null },
      objective: child.objective, deliverables: clone(child.deliverables), done_when: clone(child.done_when), scope: clone(child.scope), out_of_scope: clone(child.out_of_scope), boundaries: clone(child.boundaries), dependencies: clone(child.dependencies),
      current_epoch: lane?.epoch_id || null, current_gate: lane?.gate || null, gate_status: lane?.gate_state || null, progress: childProgress(state, child), achieved: childAchieved(state, child), remaining: childRemaining(state, child),
      epochs: child.epochs.map((entry) => ({ id: entry.id, name: entry.name, lock: entry.lock, purpose: entry.purpose, state: entry.terminal_disposition || (lane?.epoch_id === entry.id ? lane.gate_state : 'PENDING') })),
      holds: clone(child.holds), pr_registry: clone(child.pr_registry), finality: clone(child.finality), next_action: nextAction(state, child), eli5: child.eli5,
    };
  });
  const prs = state.prs.slice().sort((a, b) => a.number - b.number).map((pr) => {
    const binding = registryFor(state, pr.number);
    const lane = laneForPr(state, pr.number);
    const epoch = binding?.child.epochs.find((entry) => entry.id === binding.registry.epoch_id);
    return {
      number: pr.number, parent_issue: state.parent.issue, child_issue: pr.child_issue, summary: pr.summary, purpose: pr.purpose, scope: clone(pr.scope), out_of_scope: clone(pr.out_of_scope),
      design_constraints: clone(pr.design_constraints), changed_surfaces: clone(pr.changed_surfaces), validation_requirements: clone(pr.validation_requirements), evidence_refs: clone(pr.evidence_refs), eli5: pr.eli5,
      registry_status: binding.registry.status, role: binding.registry.role, completes_child: binding.registry.completes_child, epoch: epoch.id, lock: epoch.lock, candidate: lane?.candidate ? clone(lane.candidate) : null,
      progress: childProgress(state, binding.child), achieved: childAchieved(state, binding.child), remaining: childRemaining(state, binding.child),
      outcome: binding.registry.status === 'ACTIVE' ? `${binding.registry.role === 'INTERMEDIATE' ? 'Intermediate' : 'Terminal'} candidate #${pr.number} is active for ${epoch.id}; ${currentOutcome(state, binding.child)}` : `PR #${pr.number} is ${binding.registry.status.toLowerCase()} with retained evidence.`,
      finality: binding.child.finality.state, next_action: nextAction(state, binding.child),
    };
  });
  const activeWork = state.active_lanes.map((lane) => {
    const child = state.children.find((entry) => entry.issue === lane.child_issue);
    return { lane_id: lane.lane_id, child_issue: lane.child_issue, child_title: child.title, epoch_id: lane.epoch_id, gate: lane.gate, gate_state: lane.gate_state, gate_result: lane.gate_result, candidate: lane.candidate ? clone(lane.candidate) : null, work_claims: clone(lane.work_claims), outcome: currentOutcome(state, child) };
  });
  const parent = {
    issue: state.parent.issue, title: state.parent.title, goal: state.parent.goal,
    status: activeWork.length ? `${state.concurrency_authority.mode} / ${activeWork.length} active lane${activeWork.length === 1 ? '' : 's'}` : 'NO CURRENT CHILD',
    outcome: activeWork.length ? activeWork.map((entry) => entry.outcome).join(' ') : 'No child is currently executing.',
    active_work: activeWork,
    child_graph: children.map((child) => ({ issue: child.issue, title: child.title, lifecycle: child.lifecycle, outcome: currentOutcome(state, state.children.find((entry) => entry.issue === child.issue)) })),
    progress: children.map((child) => `#${child.issue}: ${child.outcome}`),
    major_holds: children.flatMap((child) => child.holds.filter((hold) => hold.kind === 'BLOCKING' && hold.active).map((hold) => `#${child.issue} ${hold.id}: ${hold.summary}`)),
  };
  return ok('PROGRAMME_PROJECTION_V5_DERIVED', { projection: { schema: PROJECTION_SCHEMA, repository: state.repository, canonical_digest: valid.canonical_digest, extension_digest: extensionDigest(state), parent, children, prs, extensions: clone(state.extensions || []) } });
}

function projectionEnvelope(state, projection, kind, number, data) {
  return { schema: PROJECTION_SCHEMA, repository: state.repository, parent_issue: state.parent.issue, kind, number, canonical_digest: projection.canonical_digest, projection_digest: digest(data), extension_digest: projection.extension_digest };
}
function wrap(kind, lines, envelope, state = null) {
  const hidden = state ? STATE_LINE_PREFIX + encode({ state, envelope }) + LINE_SUFFIX : PROJECTION_LINE_PREFIX + encode(envelope) + LINE_SUFFIX;
  return [MARKERS[kind].begin, ...lines, '', hidden, MARKERS[kind].end].join('\n');
}
function renderProgrammeV5(state) {
  const derived = deriveProjectionV5(state);
  if (!derived.ok) return derived;
  const projection = derived.projection;
  const parent = projection.parent;
  const bodies = { parent: wrap('parent', [
    '# Programme dashboard', '', '## Goal', parent.goal, '', '## Programme status',
    table(['Field', 'Value'], [['Programme', parent.status], ['Outcome', parent.outcome]]), '', '## Active work',
    table(['Lane', 'Child', 'Epoch / Gate', 'State', 'Candidate'], parent.active_work.map((lane) => [lane.lane_id, `#${lane.child_issue} - ${lane.child_title}`, `${lane.epoch_id} / ${lane.gate}`, lane.gate_state, lane.candidate ? `PR #${lane.candidate.pr} @ ${lane.candidate.head}` : 'None'])),
    '', '## Children', table(['Child', 'Lifecycle', 'Outcome'], parent.child_graph.map((entry) => [`#${entry.issue} - ${entry.title}`, entry.lifecycle, entry.outcome])), '', '## Progress', list(parent.progress), '', '## Major holds', list(parent.major_holds), '', '## Additional context', renderExtensions(projection.extensions, { kind: 'parent', number: state.parent.issue }),
  ], projectionEnvelope(state, projection, 'parent', state.parent.issue, parent), state), children: {}, prs: {} };
  for (const child of projection.children) {
    const envelope = projectionEnvelope(state, projection, 'child', child.issue, child);
    bodies.children[String(child.issue)] = wrap('child', [
      `# ${child.title}`, '', '## Summary', child.summary, '', '## Operating contract',
      table(['Field', 'Value'], [['Parent', `#${child.operating_contract.parent_issue}`], ['Lane', child.operating_contract.lane_id || 'None'], ['Lifecycle', child.lifecycle], ['Epoch', child.operating_contract.epoch_id || 'None'], ['Gate', child.operating_contract.gate || 'None'], ['Gate state', child.operating_contract.gate_state || 'None'], ['Lock', child.operating_contract.lock || 'None'], ['Finality', child.finality.state]]),
      '', '## Objective', child.objective, '', '## Deliverables', list(child.deliverables), '', '## Done when', list(child.done_when), '', '## Scope', list(child.scope), '', '## Out of scope', list(child.out_of_scope), '', '## Progress', list(child.progress), '', '## Achieved', list(child.achieved), '', '## Remaining', list(child.remaining),
      '', '## Epochs / Locks', table(['Epoch', 'Lock', 'State', 'Purpose'], child.epochs.map((epoch) => [epoch.id, epoch.lock, epoch.state, epoch.purpose])), '', '## PR registry', table(['PR', 'Status', 'Role', 'Completes Child'], child.pr_registry.map((entry) => [`#${entry.pr}`, entry.status, entry.role, entry.completes_child ? 'Yes' : 'No'])), '', '## Holds', list(child.holds.filter((hold) => hold.active).map((hold) => `${hold.kind} ${hold.id}: ${hold.summary}`)), '', '## Boundaries', list(child.boundaries), '', '## Next action', child.next_action, '', '## ELI5', child.eli5, '', '## Additional context', renderExtensions(projection.extensions, { kind: 'child', number: child.issue }),
    ], envelope);
  }
  for (const pr of projection.prs) {
    const envelope = projectionEnvelope(state, projection, 'pr', pr.number, pr);
    bodies.prs[String(pr.number)] = wrap('pr', [
      `# Programme lane for PR #${pr.number}`, '', '## Summary', pr.summary, '', '## Binding',
      table(['Field', 'Value'], [['Parent', `#${pr.parent_issue}`], ['Child', `#${pr.child_issue}`], ['Registry', pr.registry_status], ['Role', pr.role], ['Completes Child', pr.completes_child ? 'Yes' : 'No'], ['Epoch / Lock', `${pr.epoch} / ${pr.lock}`], ['Finality', pr.finality]]), '', '## Exact candidate', pr.candidate ? table(['PR', 'Branch', 'Base ref', 'Base SHA', 'Head', 'Tree', 'Version', 'Epoch'], [[`#${pr.candidate.pr}`, pr.candidate.branch, pr.candidate.base_ref, pr.candidate.base_sha, pr.candidate.head, pr.candidate.tree, pr.candidate.version, pr.candidate.epoch_id]]) : 'None',
      '', '## Purpose', pr.purpose, '', '## Scope', list(pr.scope), '', '## Out of scope', list(pr.out_of_scope), '', '## Progress', list(pr.progress), '', '## Achieved', list(pr.achieved), '', '## Remaining', list(pr.remaining), '', '## Changed surfaces', list(pr.changed_surfaces), '', '## Validation / evidence', list([...pr.validation_requirements, ...pr.evidence_refs.map((ref) => `Evidence: ${ref}`)]), '', '## Design constraints', list(pr.design_constraints), '', '## Finality', pr.finality, '', '## ELI5', pr.eli5, '', '## Additional context', renderExtensions(projection.extensions, { kind: 'pr', number: pr.number }),
    ], envelope);
  }
  let total = 0;
  for (const [kind, group] of [['parent', { [state.parent.issue]: bodies.parent }], ['child', bodies.children], ['pr', bodies.prs]]) {
    for (const [number, body] of Object.entries(group)) {
      const actual = bytes(body); total += actual;
      if (actual > BODY_BUDGET_BYTES) return fail('projection-body-byte-budget-exceeded', { kind, number: Number(number), limit: BODY_BUDGET_BYTES, actual });
    }
  }
  if (total > TOTAL_PROJECTION_BUDGET_BYTES) return fail('projection-total-byte-budget-exceeded', { limit: TOTAL_PROJECTION_BUDGET_BYTES, actual: total });
  return ok('PROGRAMME_V5_RENDERED', { projection, bodies, body_digests: { parent: digest(bodies.parent), children: Object.fromEntries(Object.entries(bodies.children).map(([key, value]) => [key, digest(value)])), prs: Object.fromEntries(Object.entries(bodies.prs).map(([key, value]) => [key, digest(value)])) }, total_projection_bytes: total });
}

function validateOutsideFreshness(text) {
  let historical = false;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      historical = /\b(?:history|historical|chronology|archive|archived|prior|previous)\b/i.test(heading[1]);
      if (!historical && /\b(?:current status|current gate|current candidate|next action|programme status|finality|remaining work)\b/i.test(heading[1])) return fail('competing-unmanaged-projection');
      continue;
    }
    if (historical || !line.trim()) continue;
    if (/^(?:\s*(?:[-+*>]|\d+\.)\s*)?(?:\*\*|`)?(?:current status|current gate|current candidate|next action|programme status|finality|remaining work)(?:\*\*|`)?\s*[:|]/i.test(line)) return fail('competing-unmanaged-projection');
  }
  return ok('OUTSIDE_BODY_FRESH');
}
function extractManaged(body, kind) {
  if (typeof body !== 'string' || !MARKERS[kind] || bytes(body) > BODY_BUDGET_BYTES) return fail('managed-body-invalid');
  const { begin, end } = MARKERS[kind];
  if (body.split(begin).length !== 2 || body.split(end).length !== 2) return fail('managed-marker-count-invalid');
  const start = body.indexOf(begin);
  const finish = body.indexOf(end, start + begin.length);
  if (finish < start) return fail('managed-marker-order-invalid');
  const prefix = body.slice(0, start);
  const suffix = body.slice(finish + end.length);
  const fresh = validateOutsideFreshness(prefix + suffix);
  if (!fresh.ok) return fresh;
  return ok('MANAGED_BODY_EXTRACTED', { prefix, managed: body.slice(start, finish + end.length), suffix });
}
function parseProgrammeV5Body(body, expected = {}) {
  const extracted = extractManaged(body, expected.kind);
  if (!extracted.ok) return extracted;
  const linePrefix = expected.kind === 'parent' ? STATE_LINE_PREFIX : PROJECTION_LINE_PREFIX;
  const escapedPrefix = linePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSuffix = LINE_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...extracted.managed.matchAll(new RegExp(escapedPrefix + '([A-Za-z0-9_-]+)' + escapedSuffix, 'g'))];
  if (matches.length !== 1) return fail('projection-envelope-count-invalid');
  const decoded = decode(matches[0][1]);
  const envelope = expected.kind === 'parent' ? decoded?.envelope : decoded;
  const state = expected.kind === 'parent' ? decoded?.state : null;
  if (!isRecord(envelope) || envelope.schema !== PROJECTION_SCHEMA || envelope.kind !== expected.kind
    || expected.repository !== undefined && envelope.repository !== expected.repository
    || expected.parent_issue !== undefined && envelope.parent_issue !== expected.parent_issue
    || expected.number !== undefined && envelope.number !== expected.number
    || !sha256(envelope.canonical_digest) || !sha256(envelope.projection_digest) || !sha256(envelope.extension_digest)) return fail('projection-envelope-invalid');
  if (state) {
    const valid = validateCanonicalStateV5(state);
    if (!valid.ok || valid.canonical_digest !== envelope.canonical_digest) return fail('canonical-envelope-binding-invalid');
  }
  return ok('PROGRAMME_V5_BODY_PARSED', { envelope, state, prefix: extracted.prefix, suffix: extracted.suffix, body_digest: digest(body) });
}
function countOccurrences(value, needle) { return String(value).split(needle).length - 1; }
function verifyRenderedProgrammeIntegrityV5(state, rendered) {
  if (!isRecord(rendered) || !isRecord(rendered.bodies) || !isRecord(rendered.bodies.children) || !isRecord(rendered.bodies.prs)) return fail('render-integrity-invalid');
  const deterministic = renderProgrammeV5(state);
  if (!deterministic.ok || !same(deterministic.bodies, rendered.bodies)) return fail('render-integrity-not-deterministic');
  const groups = [['parent', { [state.parent.issue]: rendered.bodies.parent }], ['child', rendered.bodies.children], ['pr', rendered.bodies.prs]];
  for (const [kind, group] of groups) for (const [number, body] of Object.entries(group)) {
    for (const [markerKind, markers] of Object.entries(MARKERS)) {
      const expectedCount = markerKind === kind ? 1 : 0;
      if (countOccurrences(body, markers.begin) !== expectedCount || countOccurrences(body, markers.end) !== expectedCount) return fail('render-integrity-marker-count-invalid', { kind, number: Number(number) });
    }
    if (countOccurrences(body, STATE_LINE_PREFIX) !== (kind === 'parent' ? 1 : 0) || countOccurrences(body, PROJECTION_LINE_PREFIX) !== (kind === 'parent' ? 0 : 1)) return fail('render-integrity-envelope-count-invalid', { kind, number: Number(number) });
    const parsed = parseProgrammeV5Body(body, { kind, repository: state.repository, parent_issue: state.parent.issue, number: Number(number) });
    if (!parsed.ok || parsed.envelope.canonical_digest !== rendered.projection.canonical_digest || kind === 'parent' && !same(parsed.state, state)) return fail('render-integrity-parse-invalid', { kind, number: Number(number) });
    if (parsed.prefix !== '' || parsed.suffix !== '') return fail('render-integrity-managed-bytes-invalid', { kind, number: Number(number) });
  }
  return ok('PROGRAMME_V5_RENDER_INTEGRITY_VERIFIED', { canonical_digest: rendered.projection.canonical_digest });
}

function candidateBinding(state, lane = null) {
  const selected = lane || state.active_lanes.find((entry) => entry.candidate);
  if (!selected?.candidate) return null;
  const binding = registryFor(state, selected.candidate.pr);
  if (!binding) return null;
  return {
    repository: state.repository, parent_issue: state.parent.issue, child_issue: binding.child.issue, lane_id: selected.lane_id,
    pr: selected.candidate.pr, branch: selected.candidate.branch, base_ref: selected.candidate.base_ref, base_sha: selected.candidate.base_sha,
    head: selected.candidate.head, tree: selected.candidate.tree, version: selected.candidate.version, epoch_id: selected.candidate.epoch_id,
    lock: binding.epoch.lock, role: binding.registry.role, completes_child: binding.registry.completes_child, registry_status: binding.registry.status,
  };
}
function candidateBindingDigest(state) {
  const bindings = state.active_lanes.filter((lane) => lane.candidate).map((lane) => candidateBinding(state, lane));
  return bindings.length ? digest(bindings) : null;
}
function derivePrAssociationsV5(state) {
  const valid = validateCanonicalStateV5(state);
  if (!valid.ok) return valid;
  const associations = {};
  for (const pr of state.prs) {
    const binding = registryFor(state, pr.number);
    const terminal = binding.registry.role === 'TERMINAL' && binding.registry.completes_child;
    const closing = terminal && binding.child.finality.state === 'MERGED' && binding.child.finality.authority_ref !== null
      || terminal && binding.child.finality.state === 'READY_AUTHORIZED' && binding.child.finality.authority_ref !== null && binding.registry.status === 'ACTIVE';
    associations[String(pr.number)] = { parent_issue: state.parent.issue, child_issue: binding.child.issue, kind: closing ? 'CLOSING' : 'CROSS_REFERENCE' };
  }
  return ok('PROGRAMME_V5_PR_ASSOCIATIONS_DERIVED', { associations });
}
function expectedLabelsV5(state, currentLabels = {}) {
  const managed = new Set(['completed', 'current', 'queued', 'blocked', 'retired']);
  const result = clone(currentLabels || {});
  for (const child of state.children) {
    const unrelated = (currentLabels[String(child.issue)] || []).filter((label) => !managed.has(label));
    const lifecycle = effectiveLifecycle(child);
    const managedLabel = lifecycle === 'RETIRED' ? 'completed' : lifecycle.toLowerCase();
    result[String(child.issue)] = [...new Set([...unrelated, managedLabel])].sort();
  }
  return result;
}
function snapshotDigest(snapshot) {
  return digest({ repository: snapshot.repository, revision: snapshot.revision, complete: snapshot.complete, canonical_state: snapshot.canonical_state, bodies: snapshot.bodies, labels: snapshot.labels, managed_events: snapshot.managed_events, native: snapshot.native, bootstrap: snapshot.bootstrap || null });
}
function addOperation(operations, kind, target, before, after, binding = {}) {
  if (same(before, after)) return;
  const operation = { kind, target, before_digest: digest(before), after: clone(after), after_digest: digest(after), ...clone(binding) };
  operation.operation_id = digest(operation);
  operations.push(operation);
}
function parseV4CanonicalSnapshot(snapshot, expectedRepository, expectedParent) {
  if (isRecord(snapshot.canonical_state)) {
    const valid = v4.validateCanonicalStateV4(snapshot.canonical_state);
    if (!valid.ok) return fail('v4-canonical-state-invalid', { detail: valid.reason });
    if (snapshot.canonical_state.repository !== expectedRepository || snapshot.canonical_state.parent.issue !== expectedParent) return fail('v4-canonical-identity-mismatch');
    return ok('V4_CANONICAL_SNAPSHOT_PARSED', { state: clone(snapshot.canonical_state), canonical_digest: valid.canonical_digest });
  }
  const parent = v4.parseProgrammeV4Body(snapshot.bodies?.parent, { kind: 'parent', repository: expectedRepository, parent_issue: expectedParent, number: expectedParent });
  if (!parent.ok || !parent.state) return fail('v4-parent-canonical-state-missing');
  return ok('V4_CANONICAL_SNAPSHOT_PARSED', { state: parent.state, canonical_digest: digest(parent.state) });
}
function parseV4Bodies(snapshot, state) {
  const parent = v4.parseProgrammeV4Body(snapshot.bodies?.parent, { kind: 'parent', repository: state.repository, parent_issue: state.parent.issue, number: state.parent.issue });
  if (!parent.ok) return parent;
  for (const child of state.children) {
    const parsed = v4.parseProgrammeV4Body(snapshot.bodies?.children?.[String(child.issue)], { kind: 'child', repository: state.repository, parent_issue: state.parent.issue, number: child.issue });
    if (!parsed.ok) return parsed;
  }
  for (const pr of state.prs) {
    const parsed = v4.parseProgrammeV4Body(snapshot.bodies?.prs?.[String(pr.number)], { kind: 'pr', repository: state.repository, parent_issue: state.parent.issue, number: pr.number });
    if (!parsed.ok) return parsed;
  }
  return ok('V4_BODIES_PARSED');
}
function ensureWebAuthority(state, authorityRef, authorityId = null) {
  if (!authorityRef || !safeLine(authorityRef, 512)) return fail('migration-authority-required');
  const found = state.evidence_refs.find((entry) => entry.kind === 'WEB' && (entry.reference === authorityRef || entry.id === authorityRef));
  if (found) return ok('MIGRATION_AUTHORITY_RETAINED', { state });
  const id = authorityId || `web_${digest(authorityRef).slice(0, 20)}`;
  if (!safeId(id) || state.evidence_refs.some((entry) => entry.id === id)) return fail('migration-authority-id-invalid');
  state.evidence_refs.push({ id, kind: 'WEB', reference: authorityRef, summary: 'Web-controlled E3 architecture and exact-candidate admission authority.' });
  return ok('MIGRATION_AUTHORITY_ADDED', { state, evidence_id: id });
}
function migrateV4ToV5(source, options = {}) {
  const valid = v4.validateCanonicalStateV4(source);
  if (!valid.ok) return fail('v4-migration-input-invalid', { detail: valid.reason });
  const target = {
    schema: STATE_SCHEMA, design_lock: DESIGN_LOCK, repository: source.repository, parent: clone(source.parent), children: source.children.map((child) => ({
      issue: child.issue, order: child.order, title: child.title, summary: child.summary || child.objective, objective: child.objective,
      deliverables: clone(child.deliverables || child.scope.length ? child.deliverables || child.scope : [child.objective]),
      done_when: clone(child.done_when || ['Every declared deliverable is complete and Web records finality.']), lifecycle: child.lifecycle, dependencies: clone(child.dependencies), scope: clone(child.scope), out_of_scope: clone(child.out_of_scope), boundaries: clone(child.boundaries), eli5: child.eli5, epochs: clone(child.epochs), holds: clone(child.holds), pr_registry: clone(child.pr_registry), finality: clone(child.finality),
    })),
    prs: source.prs.map((pr) => ({
      number: pr.number, child_issue: pr.child_issue, summary: pr.summary || pr.purpose, purpose: pr.purpose, scope: clone(pr.scope), out_of_scope: clone(pr.out_of_scope), design_constraints: clone(pr.design_constraints), changed_surfaces: clone(pr.changed_surfaces), validation_requirements: clone(pr.validation_requirements || pr.design_constraints.length ? pr.validation_requirements || pr.design_constraints : ['Focused tests, complete relevant reconciler suite, and required Toolkit audits.']), evidence_refs: clone(pr.evidence_refs || []), eli5: pr.eli5,
    })),
    concurrency_authority: { mode: 'SINGLE_DEFAULT', max_active_lanes: 1, authority_ref: null, authority_digest: null, permitted_child_issues: [] }, active_lanes: [], predecessor_contract_digest: source.predecessor_contract_digest, evidence_refs: clone(source.evidence_refs), historical_transitions: clone(source.historical_transitions), extensions: clone(source.extensions || []),
  };
  const authority = ensureWebAuthority(target, options.authority_ref || target.evidence_refs.find((entry) => entry.kind === 'WEB')?.reference, options.authority_evidence_id);
  if (!authority.ok) return authority;
  const current = target.children.filter((child) => child.lifecycle === 'CURRENT');
  if (current.length > 1) {
    if (options.concurrency_authority) target.concurrency_authority = clone(options.concurrency_authority);
    else return fail('unauthorized-multiple-current-children');
  } else if (options.concurrency_authority) target.concurrency_authority = clone(options.concurrency_authority);
  for (const child of current) {
    const cursor = source.cursor.child_issue === child.issue ? source.cursor : null;
    const active = activeRegistry(child);
    const candidate = cursor && source.candidate && source.candidate.pr === active[0]?.pr ? clone(source.candidate) : null;
    target.active_lanes.push({ lane_id: `child-${child.issue}`, child_issue: child.issue, epoch_id: cursor?.epoch_id || active[0]?.epoch_id || child.epochs[0].id, gate: cursor?.gate || child.epochs[0].gates[0], gate_state: cursor?.status || 'ACTIVE', gate_result: cursor?.result || null, candidate, work_claims: [{ mode: 'WRITE', resource: `programme/child/${child.issue}`, operation: 'canonical-transition' }] });
  }
  if (options.live_candidate) {
    const live = clone(options.live_candidate);
    const lane = target.active_lanes.find((entry) => entry.candidate?.pr === live.pr) || target.active_lanes.find((entry) => target.children.find((child) => child.issue === entry.child_issue)?.pr_registry.some((entry) => entry.pr === live.pr));
    if (!lane) return fail('migration-live-candidate-unbound', { pr: live.pr });
    lane.candidate = live;
  }
  const final = validateCanonicalStateV5(target);
  return final.ok ? ok('V4_TO_V5_MIGRATED', { state: target, source_canonical_digest: valid.canonical_digest, canonical_digest: final.canonical_digest }) : final;
}

function eventWithoutId(event) { const value = clone(event); delete value.event_id; return value; }
function createManagedEventV3(input = {}) {
  const source = input.source_state_schema === undefined ? null : input.source_state_schema;
  const event = {
    schema: MANAGED_EVENT_SCHEMA,
    event_type: input.event_type || 'canonical_transition',
    repository: input.repository || input.state?.repository,
    parent_issue: input.parent_issue || input.state?.parent?.issue,
    entity: clone(input.entity || { kind: 'parent', number: input.parent_issue || input.state?.parent?.issue }),
    source_state_schema: source,
    from_state_digest: input.from_state_digest || digest(input.from_state === undefined ? null : input.from_state),
    to_state_digest: input.to_state_digest || input.to_canonical_digest || digest(input.to_state === undefined ? input.state : input.to_state),
    authority_ref: input.authority_ref || 'system:v5',
    authority_digest: input.authority_digest === undefined ? null : input.authority_digest,
    candidate_binding_digest: input.candidate_binding_digest === undefined ? candidateBindingDigest(input.state || { active_lanes: [] }) : input.candidate_binding_digest,
    lane_id: input.lane_id === undefined ? null : input.lane_id,
    epoch_id: input.epoch_id === undefined ? null : input.epoch_id,
    gate: input.gate === undefined ? null : input.gate,
    lock: input.lock === undefined ? null : input.lock,
    fence_id: input.fence_id === undefined ? null : input.fence_id,
    prior_event_id: input.prior_event_id === undefined ? null : input.prior_event_id,
    receipt_id: input.receipt_id === undefined ? null : input.receipt_id,
  };
  event.event_id = digest(event);
  return event;
}
function validateManagedEventV3(event, expected = {}) {
  if (!exactKeys(event, ['schema', 'event_type', 'repository', 'parent_issue', 'entity', 'source_state_schema', 'from_state_digest', 'to_state_digest', 'authority_ref', 'authority_digest', 'candidate_binding_digest', 'lane_id', 'epoch_id', 'gate', 'lock', 'fence_id', 'prior_event_id', 'receipt_id', 'event_id'])
    || event.schema !== MANAGED_EVENT_SCHEMA || !['canonical_initialisation', 'canonical_transition', 'migration', 'recovery_transition'].includes(event.event_type)
    || !safeLine(event.repository, 200) || expected.repository !== undefined && event.repository !== expected.repository || !issue(event.parent_issue)
    || expected.parent_issue !== undefined && event.parent_issue !== expected.parent_issue || !exactKeys(event.entity, ['kind', 'number'])
    || !['parent', 'child', 'pr'].includes(event.entity.kind) || !issue(event.entity.number)
    || ![null, 'toolkit.github-program.state.v4', STATE_SCHEMA, 'toolkit.github-program.legacy-state.v1'].includes(event.source_state_schema)
    || !sha256(event.from_state_digest) || !sha256(event.to_state_digest) || !safeLine(event.authority_ref, 512)
    || event.authority_digest !== null && !sha256(event.authority_digest) || event.candidate_binding_digest !== null && !sha256(event.candidate_binding_digest)
    || event.lane_id !== null && !safeId(event.lane_id) || event.epoch_id !== null && !safeId(event.epoch_id) || event.gate !== null && !safeId(event.gate)
    || event.lock !== null && !safeId(event.lock) || event.fence_id !== null && !safeId(event.fence_id) || event.prior_event_id !== null && !sha256(event.prior_event_id)
    || event.receipt_id !== null && !sha256(event.receipt_id) || !sha256(event.event_id)) return fail('managed-event-v3-invalid');
  const expectedType = { canonical_initialisation: null, canonical_transition: STATE_SCHEMA, migration: 'toolkit.github-program.state.v4', recovery_transition: STATE_SCHEMA };
  if (event.event_type === 'canonical_initialisation' && event.source_state_schema !== null || event.event_type === 'canonical_transition' && ![STATE_SCHEMA, 'toolkit.github-program.state.v4'].includes(event.source_state_schema) || event.event_type === 'migration' && event.source_state_schema !== 'toolkit.github-program.state.v4' || event.event_type === 'recovery_transition' && event.source_state_schema !== STATE_SCHEMA) return fail('managed-event-v3-transition-binding-invalid');
  if (event.event_id !== digest(eventWithoutId(event))) return fail('managed-event-v3-tampered');
  return ok('MANAGED_EVENT_V3_VALID', { event });
}
function validateManagedEventInventoryV5(events, repository, options = {}) {
  if (!Array.isArray(events) || events.length > 500) return fail('managed-event-inventory-invalid');
  const normalized = [];
  const ids = new Set();
  let v3Started = false;
  for (const supplied of events) {
    let result;
    if (supplied?.schema === MANAGED_EVENT_SCHEMA) {
      result = validateManagedEventV3(supplied, { repository });
      v3Started = true;
    } else if (supplied?.schema === 'toolkit.github-program.managed-event.v2' || supplied?.schema === 'toolkit.github-program.managed-event.v1') {
      const legacy = v4.validateManagedEventInventoryV4([supplied], repository);
      result = legacy.ok ? ok('LEGACY_MANAGED_EVENT_RETAINED', { event: legacy.events[0] }) : legacy;
    } else return fail('managed-event-inventory-invalid');
    if (!result.ok || result.event.repository !== repository || ids.has(result.event.event_id)) return fail('managed-event-inventory-invalid');
    const prior = normalized.at(-1)?.event_id || null;
    if (result.event.schema === MANAGED_EVENT_SCHEMA) {
      if (result.event.prior_event_id !== prior) return fail('managed-event-chain-invalid');
    } else if (v3Started) return fail('managed-event-order-invalid');
    ids.add(result.event.event_id); normalized.push(result.event);
  }
  return ok('MANAGED_EVENT_INVENTORY_V5_VALID', { events: normalized, ids, inventory_digest: digest(normalized), v3_count: normalized.filter((event) => event.schema === MANAGED_EVENT_SCHEMA).length });
}

function receiptWithoutId(receipt) { const value = clone(receipt); delete value.receipt_id; return value; }
function createRunReceipt(input = {}) {
  const receipt = {
    schema: RUN_RECEIPT_SCHEMA,
    receipt_type: input.receipt_type,
    receipt_id: null,
    run_id: input.run_id,
    repository: input.repository,
    parent_issue: input.parent_issue,
    lane_id: input.lane_id,
    child_issue: input.child_issue,
    epoch_id: input.epoch_id,
    gate: input.gate,
    lock: input.lock,
    candidate_binding_digest: input.candidate_binding_digest === undefined ? null : input.candidate_binding_digest,
    authority_digest: input.authority_digest === undefined ? null : input.authority_digest,
    lease: clone(input.lease || { lease_id: input.lease_id, fence_id: input.fence_id, fence_sequence: input.fence_sequence || 0, expires_at: input.expires_at }),
    prior_receipt_id: input.prior_receipt_id === undefined ? null : input.prior_receipt_id,
    result: clone(input.result || {}),
    readback: input.readback === undefined ? null : clone(input.readback),
    created_at: input.created_at || new Date().toISOString(),
  };
  receipt.receipt_id = digest(receiptWithoutId(receipt));
  return receipt;
}
function validateReceiptObject(receipt, expected = {}) {
  if (!exactKeys(receipt, ['schema', 'receipt_type', 'receipt_id', 'run_id', 'repository', 'parent_issue', 'lane_id', 'child_issue', 'epoch_id', 'gate', 'lock', 'candidate_binding_digest', 'authority_digest', 'lease', 'prior_receipt_id', 'result', 'readback', 'created_at'])
    || receipt.schema !== RUN_RECEIPT_SCHEMA || !RECEIPT_TYPES.includes(receipt.receipt_type) || !sha256(receipt.receipt_id) || !safeId(receipt.run_id)
    || !safeLine(receipt.repository, 200) || expected.repository !== undefined && expected.repository !== receipt.repository || !issue(receipt.parent_issue)
    || expected.parent_issue !== undefined && expected.parent_issue !== receipt.parent_issue || !safeId(receipt.lane_id) || !issue(receipt.child_issue)
    || !safeId(receipt.epoch_id) || !safeId(receipt.gate) || !safeId(receipt.lock) || receipt.candidate_binding_digest !== null && !sha256(receipt.candidate_binding_digest)
    || receipt.authority_digest !== null && !sha256(receipt.authority_digest) || !exactKeys(receipt.lease, ['lease_id', 'fence_id', 'fence_sequence', 'expires_at'])
    || !safeId(receipt.lease.lease_id) || !safeId(receipt.lease.fence_id) || !Number.isSafeInteger(receipt.lease.fence_sequence) || receipt.lease.fence_sequence < 0
    || !safeLine(receipt.lease.expires_at) || receipt.prior_receipt_id !== null && !sha256(receipt.prior_receipt_id) || !isRecord(receipt.result)
    || Object.keys(receipt.result).length > 40 || receipt.readback !== null && !isRecord(receipt.readback) || receipt.readback !== null && Object.keys(receipt.readback).length > 40
    || !safeLine(receipt.created_at, 512) || bytes(receipt) > RECEIPT_BUDGET_BYTES) return fail('run-receipt-invalid');
  if (receipt.receipt_id !== digest(receiptWithoutId(receipt))) return fail('run-receipt-tampered');
  return ok('RUN_RECEIPT_VALID', { receipt });
}
function validateRunReceipt(receipt, expected = {}) { return validateReceiptObject(receipt, expected); }
function receiptFenceExpired(receipt, now = new Date()) {
  const at = Date.parse(receipt.lease.expires_at);
  return !Number.isFinite(at) || at <= new Date(now).getTime();
}
function validateRunReceiptChain(receipts, expected = {}) {
  if (!Array.isArray(receipts) || receipts.length > 500) return fail('run-receipt-chain-invalid');
  const ids = new Set();
  let started = false;
  let runId = null;
  let previous = null;
  for (const receipt of receipts) {
    const valid = validateReceiptObject(receipt, expected);
    if (!valid.ok || ids.has(receipt.receipt_id) || receipt.prior_receipt_id !== previous || runId !== null && receipt.run_id !== runId) return fail(valid.ok ? 'run-receipt-chain-invalid' : valid.reason, { receipt_id: receipt.receipt_id });
    if (receipt.receipt_type === 'RUN_STARTED') started = true;
    if (['EXECUTOR_TERMINAL', 'G4_TERMINAL', 'RUN_INTERRUPTED', 'LEASE_EXPIRED', 'HOSTED_CHECK'].includes(receipt.receipt_type) && !started) return fail('terminal-before-start', { receipt_id: receipt.receipt_id });
    ids.add(receipt.receipt_id); previous = receipt.receipt_id; runId = runId || receipt.run_id;
  }
  return ok('RUN_RECEIPT_CHAIN_VALID', { receipts: clone(receipts), ids, terminal: receipts.find((entry) => ['EXECUTOR_TERMINAL', 'G4_TERMINAL'].includes(entry.receipt_type)) || null });
}
function appendRunReceipt(store, receipt) {
  const valid = validateReceiptObject(receipt);
  if (!valid.ok) return valid;
  if (!store || typeof store.appendReceipt !== 'function') return fail('durable-receipt-store-required');
  let prior = [];
  if (typeof store.readReceiptChain === 'function') {
    try { prior = store.readReceiptChain(receipt.run_id) || []; } catch (_error) { return fail('run-receipt-readback-failed'); }
    if (!Array.isArray(prior)) return fail('run-receipt-readback-invalid');
    const existing = prior.find((entry) => entry.receipt_id === receipt.receipt_id);
    if (existing) return same(existing, receipt) ? ok('RUN_RECEIPT_DUPLICATE', { receipt: clone(receipt), duplicate: true }) : fail('run-receipt-conflict');
  }
  if (receipt.receipt_type === 'RUN_STARTED' && (prior.length > 0 || receipt.prior_receipt_id !== null)) return fail('run-started-chain-invalid');
  if (receipt.receipt_type !== 'RUN_STARTED' && typeof store.readReceiptChain === 'function') {
    const chain = validateRunReceiptChain([...prior, receipt], { repository: receipt.repository, parent_issue: receipt.parent_issue });
    if (!chain.ok) return chain;
  }
  try {
    const result = store.appendReceipt(clone(receipt));
    if (result?.conflict) return fail('run-receipt-conflict');
    return ok(result?.duplicate ? 'RUN_RECEIPT_DUPLICATE' : 'RUN_RECEIPT_PERSISTED', { receipt: clone(receipt), duplicate: Boolean(result?.duplicate) });
  } catch (_error) { return fail('run-receipt-persistence-failed'); }
}
function canAdvanceFromTerminal(input = {}) {
  const terminal = input.receipt || input.terminal;
  const chain = validateRunReceiptChain(input.receipts || (terminal ? [terminal] : []), { repository: input.repository, parent_issue: input.parent_issue });
  if (!chain.ok) return chain;
  if (!terminal || !['EXECUTOR_TERMINAL', 'G4_TERMINAL'].includes(terminal.receipt_type)) return fail('terminal-receipt-required');
  if (input.terminal_persisted !== true) return fail('terminal-persistence-required');
  if (receiptFenceExpired(terminal, input.now || new Date()) || input.superseded_fence_id === terminal.lease.fence_id) return fail('expired-fence', { historical: true, advances_state: false });
  return ok('TERMINAL_DURABLE_AND_ADVANCEABLE', { receipt_id: terminal.receipt_id, advances_state: true });
}
function consumeTerminalEvidence(input = {}) {
  const result = canAdvanceFromTerminal(input);
  return result.ok ? result : result.reason === 'expired-fence' ? fail('expired-fence-evidence-historical-only', { historical: true, advances_state: false }) : result;
}

function candidateMatches(expected, actual) {
  if (!expected || !actual) return false;
  return ['pr', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version', 'epoch_id'].every((key) => expected[key] === actual[key]);
}
function transitionConflict(input) {
  return input.conflicting_transition === true || input.preview_conflict === true || Array.isArray(input.transitions) && input.transitions.some((entry) => entry.conflict === true);
}
function classifyRecovery(input = {}) {
  const expectedCandidate = input.expected_candidate || input.candidate_binding || input.expected?.candidate;
  const actualCandidate = input.actual_candidate || input.candidate;
  if (expectedCandidate && actualCandidate && !candidateMatches(expectedCandidate, actualCandidate)) return { ok: true, status: 'STALE_CANDIDATE', code: 'RECOVERY_STALE_CANDIDATE', advances_state: false, reason: 'candidate-binding-mismatch' };
  if (input.stale_candidate === true) return { ok: true, status: 'STALE_CANDIDATE', code: 'RECOVERY_STALE_CANDIDATE', advances_state: false };
  if (transitionConflict(input)) return { ok: true, status: 'CONFLICTING_TRANSITION', code: 'RECOVERY_CONFLICTING_TRANSITION', advances_state: false };
  const fence = input.receipt || input.terminal || input.fence;
  if (input.expired_fence === true || fence && input.now && receiptFenceExpired(fence, input.now) || input.superseded_fence === true || input.superseded_fence_id && fence?.lease?.fence_id === input.superseded_fence_id) return { ok: true, status: 'EXPIRED_FENCE', code: 'RECOVERY_EXPIRED_FENCE', advances_state: false, historical: true };
  if (input.g4_terminal && input.web_decision_required !== true && input.g4_adjudicated !== true) return { ok: true, status: 'G4_UNADJUDICATED', code: 'RECOVERY_G4_UNADJUDICATED', advances_state: false, web_decision_required: true };
  if (input.g4_terminal && input.web_decision_required === true || input.web_decision_required === true) return { ok: true, status: 'WEB_DECISION_REQUIRED', code: 'RECOVERY_WEB_DECISION_REQUIRED', advances_state: false };
  if (input.previewed === true && input.applied !== true) return { ok: true, status: 'PREVIEWED_NOT_APPLIED', code: 'RECOVERY_PREVIEWED_NOT_APPLIED', advances_state: false };
  if (input.applied === true && input.acknowledged !== true) return { ok: true, status: 'APPLIED_ACK_LOST', code: 'RECOVERY_APPLIED_ACK_LOST', advances_state: false, readback_required: true };
  if (input.applied === true && input.readback_verified === true || input.already_applied === true) return { ok: true, status: 'ALREADY_APPLIED', code: 'RECOVERY_ALREADY_APPLIED', advances_state: false, readback_verified: true };
  if (input.terminal && input.terminal_persisted !== true || input.terminal_unconsumed === true) return { ok: true, status: 'TERMINAL_UNCONSUMED', code: 'RECOVERY_TERMINAL_UNCONSUMED', advances_state: false };
  if (input.running === true || input.status === 'RUNNING') return { ok: true, status: 'RUNNING', code: 'RECOVERY_RUNNING', advances_state: false };
  if (input.lost === true || input.status === 'LOST') return { ok: true, status: 'LOST', code: 'RECOVERY_LOST', advances_state: false, replay_allowed: true };
  if (input.decision_required === true) return { ok: true, status: 'WEB_DECISION_REQUIRED', code: 'RECOVERY_WEB_DECISION_REQUIRED', advances_state: false };
  return { ok: true, status: 'LOST', code: 'RECOVERY_LOST', advances_state: false, replay_allowed: true };
}
function recoverRun(input = {}) { return classifyRecovery(input); }

function validateWriterAction(input = {}) {
  const actor = input.actor || input.writer;
  const action = input.action || input.kind;
  const allowed = {
    EXECUTOR: new Set(['code', 'candidate', 'structured-evidence', 'evidence']),
    G4: new Set(['structured-evidence', 'evidence', 'read-only-evidence']),
    LOOP_MANAGER: new Set(['receipt', 'receipt-persistence', 'orchestration', 'invoke-reconciler']),
    RECONCILER: new Set(['canonical-state', 'programme-state', 'transition', 'projection']),
    WEB: new Set(['architecture', 'lock', 'material-judgement', 'g4', 'finality', 'authority']),
  };
  if (!allowed[actor] || !allowed[actor].has(action)) return fail('writer-ownership-violation', { actor, action });
  return ok('WRITER_ACTION_AUTHORISED', { actor, action });
}

function validateControllerBootstrap(bootstrap, expected = {}) {
  if (!isRecord(bootstrap) || !exactKeys(bootstrap, ['schema', 'identity', 'version', 'revision', 'digest', 'profile', 'parent', 'conformance', 'compatibility', 'contracts'], ['$schema'])
    || bootstrap.schema !== BOOTSTRAP_SCHEMA || !exactKeys(bootstrap.identity, ['repository', 'product']) || !SAFE_REPOSITORY.test(bootstrap.identity.repository)
    || bootstrap.identity.product !== 'github-program-reconciler' || !/^\d+\.\d+\.\d+$/.test(bootstrap.version) || !safeId(bootstrap.revision)
    || !sha256(bootstrap.digest) || bootstrap.profile !== 'toolkit.github-program.v5' || !exactKeys(bootstrap.parent, ['repository', 'issue', 'canonical'])
    || !SAFE_REPOSITORY.test(bootstrap.parent.repository) || !issue(bootstrap.parent.issue) || bootstrap.parent.canonical !== true
    || !exactKeys(bootstrap.conformance, ['managed_repository_required', 'bootstrap_required_for_v5', 'detection_order', 'pinned_contract_required'])
    || bootstrap.conformance.managed_repository_required !== true || bootstrap.conformance.bootstrap_required_for_v5 !== true || !arrayOf(bootstrap.conformance.detection_order, safeId, 10)
    || bootstrap.conformance.pinned_contract_required !== true || !exactKeys(bootstrap.compatibility, ['accepted_state_schemas', 'migration_input_schemas', 'runtime_authority', 'mutable_main_role'])
    || !arrayOf(bootstrap.compatibility.accepted_state_schemas, (entry) => entry === STATE_SCHEMA, 10) || !bootstrap.compatibility.accepted_state_schemas.length
    || !arrayOf(bootstrap.compatibility.migration_input_schemas, (entry) => entry === 'toolkit.github-program.state.v4', 10) || !bootstrap.compatibility.migration_input_schemas.length
    || bootstrap.compatibility.runtime_authority !== 'repo-local-pinned-bootstrap' || bootstrap.compatibility.mutable_main_role !== 'discovery-migration-guidance-only'
    || !exactKeys(bootstrap.contracts, ['state', 'event', 'receipt', 'surface', 'entrypoint']) || Object.values(bootstrap.contracts).some((value) => !/^(?:repo|\.github)\/[A-Za-z0-9._/-]+$/.test(value))
    || !same(bootstrap.contracts, BOOTSTRAP_CONTRACTS) || bootstrap.revision !== BOOTSTRAP_REVISION || bootstrap.version !== '2.12.0') return fail('bootstrap-invalid');
  const withoutDigest = clone(bootstrap); delete withoutDigest.digest;
  if (digest(withoutDigest) !== bootstrap.digest) return fail('bootstrap-digest-mismatch');
  if (expected.repository !== undefined && (bootstrap.identity.repository !== expected.repository || bootstrap.parent.repository !== expected.repository)) return fail('bootstrap-repository-mismatch');
  if (expected.parent_issue !== undefined && bootstrap.parent.issue !== expected.parent_issue) return fail('bootstrap-parent-mismatch');
  if (expected.version !== undefined && bootstrap.version !== expected.version) return fail('bootstrap-version-mismatch');
  if (expected.revision !== undefined && bootstrap.revision !== expected.revision) return fail('bootstrap-revision-mismatch');
  return ok('CONTROLLER_BOOTSTRAP_VALID', { bootstrap: clone(bootstrap), pinned_contract_digest: bootstrap.digest });
}
function resolvePinnedContract(bootstrap, expected = {}) {
  const valid = validateControllerBootstrap(bootstrap, expected);
  if (!valid.ok) return valid;
  return ok('PINNED_CONTRACT_RESOLVED', { repository: bootstrap.identity.repository, parent_issue: bootstrap.parent.issue, version: bootstrap.version, revision: bootstrap.revision, digest: bootstrap.digest, profile: bootstrap.profile, contracts: clone(bootstrap.contracts) });
}
function detectManagedRepository(input = {}) {
  const bootstrap = input.bootstrap;
  const hasV5 = input.canonical_state?.schema === STATE_SCHEMA || input.state_schema === STATE_SCHEMA;
  const hasV4 = input.canonical_state?.schema === 'toolkit.github-program.state.v4' || input.state_schema === 'toolkit.github-program.state.v4';
  const hasEvents = Array.isArray(input.managed_events) && input.managed_events.length > 0;
  if (bootstrap !== undefined && bootstrap !== null) {
    const valid = validateControllerBootstrap(bootstrap, { repository: input.repository, parent_issue: input.parent_issue, version: input.version });
    if (!valid.ok) return { ok: true, classification: 'DRIFTED_MANAGED', managed: true, fail_closed: true, code: valid.code, reason: valid.reason };
    return { ok: true, classification: 'CURRENT_MANAGED', managed: true, fail_closed: false, bootstrap: valid.bootstrap };
  }
  if (hasV5) return { ok: true, classification: 'DRIFTED_MANAGED', managed: true, fail_closed: true, code: 'PARENT_RECONCILIATION_INCOMPLETE', reason: 'v5-bootstrap-missing' };
  if (hasV4 || hasEvents) return { ok: true, classification: 'LEGACY_MANAGED', managed: true, fail_closed: false };
  return { ok: true, classification: 'UNMANAGED', managed: false, fail_closed: false };
}
function inspectControllerContext(input = {}) {
  const read = typeof input.read === 'function' ? input.read : null;
  let readFailure = null;
  const readDirect = (path, fallback = null) => {
    try {
      if (typeof input[`read_${path}`] === 'function') return input[`read_${path}`]();
      if (read) return read(path);
    } catch (_error) {
      readFailure = path;
      return undefined;
    }
    return fallback;
  };
  const bootstrap = input.bootstrap !== undefined ? input.bootstrap : readDirect('.github/ai-agent-toolkit-programme.json');
  const detection = detectManagedRepository({ ...input, bootstrap });
  const paths = ['.github/ai-agent-toolkit-programme.json'];
  if (!detection.managed) return ok('UNMANAGED_REPOSITORY', { detection, paths });
  if (detection.classification === 'DRIFTED_MANAGED') return fail('v5-bootstrap-invalid-or-missing', { detection, paths });
  const pinned = validateControllerBootstrap(bootstrap, { repository: input.repository, parent_issue: input.parent_issue });
  if (!pinned.ok) return pinned;
  const parent = input.parent_body !== undefined ? input.parent_body : readDirect(`issue/${pinned.bootstrap.parent.issue}/body`);
  const children = input.children !== undefined ? input.children : readDirect(`issue/${pinned.bootstrap.parent.issue}/children`, {});
  const prs = input.prs !== undefined ? input.prs : readDirect(`parent/${pinned.bootstrap.parent.issue}/prs`, {});
  const managedEvents = input.managed_events !== undefined ? input.managed_events : readDirect('managed-events', []);
  const receipts = input.receipts !== undefined ? input.receipts : readDirect('run-receipts', []);
  const native = input.native !== undefined ? input.native : readDirect(`issue/${pinned.bootstrap.parent.issue}/native-relationships`, null);
  const checks = input.checks !== undefined ? input.checks : readDirect(`issue/${pinned.bootstrap.parent.issue}/checks`, {});
  const reviews = input.reviews !== undefined ? input.reviews : readDirect(`issue/${pinned.bootstrap.parent.issue}/reviews`, {});
  paths.push(`issue/${pinned.bootstrap.parent.issue}/body`, `issue/${pinned.bootstrap.parent.issue}/children`, `parent/${pinned.bootstrap.parent.issue}/prs`, 'managed-events', 'run-receipts', `issue/${pinned.bootstrap.parent.issue}/native-relationships`, `issue/${pinned.bootstrap.parent.issue}/checks`, `issue/${pinned.bootstrap.parent.issue}/reviews`);
  const requiredReads = { parent, children, prs, managed_events: managedEvents, receipts, native, checks, reviews };
  if (readFailure) return fail('required-controller-inspection-read-failed', { detection, pinned: pinned.bootstrap, failed_path: readFailure, paths });
  const missing = Object.entries(requiredReads).filter(([, value]) => value === undefined || value === null).map(([key]) => key);
  if (missing.length) return fail('required-controller-inspection-missing', { detection, pinned: pinned.bootstrap, missing, paths });
  return ok('CONTROLLER_CONTEXT_INSPECTED', { detection, pinned: pinned.bootstrap, parent, children, prs, managed_events: managedEvents, receipts, native, checks, reviews, paths, repository_scan: false });
}

function buildBootstrap(input = {}) {
  const bootstrap = {
    $schema: BOOTSTRAP_SCHEMA,
    schema: BOOTSTRAP_SCHEMA,
    identity: { repository: input.repository, product: 'github-program-reconciler' },
    version: input.version || '2.12.0',
    revision: input.revision || BOOTSTRAP_REVISION,
    digest: null,
    profile: 'toolkit.github-program.v5',
    parent: { repository: input.repository, issue: input.parent_issue, canonical: true },
    conformance: { managed_repository_required: true, bootstrap_required_for_v5: true, detection_order: ['bootstrap', 'canonical_state', 'managed_events'], pinned_contract_required: true },
    compatibility: { accepted_state_schemas: [STATE_SCHEMA], migration_input_schemas: ['toolkit.github-program.state.v4'], runtime_authority: 'repo-local-pinned-bootstrap', mutable_main_role: 'discovery-migration-guidance-only' },
    contracts: clone(BOOTSTRAP_CONTRACTS),
  };
  delete bootstrap.digest;
  const withDigest = { ...bootstrap, digest: digest(bootstrap) };
  return withDigest;
}
function validateBootstrapForProgramme(bootstrap, repository, parentIssue) {
  return validateControllerBootstrap(bootstrap, { repository, parent_issue: parentIssue, version: '2.12.0' });
}
function materializeBody(currentBody, kind, renderedBody, expected) {
  if (currentBody === null || currentBody === undefined) return ok('MANAGED_BODY_INITIALISED', { body: renderedBody });
  const currentV5 = parseProgrammeV5Body(currentBody, { kind, repository: expected.repository, parent_issue: expected.parent_issue, number: expected.number });
  if (currentV5.ok) return ok('MANAGED_BODY_MATERIALISED', { body: currentV5.prefix + renderedBody + currentV5.suffix });
  const currentV4 = v4.parseProgrammeV4Body(currentBody, { kind, repository: expected.repository, parent_issue: expected.parent_issue, number: expected.number });
  if (!currentV4.ok) return fail('current-body-requires-explicit-migration', { kind, number: expected.number, detail: currentV4.reason });
  return ok('MANAGED_BODY_MIGRATED', { body: currentV4.prefix + renderedBody + currentV4.suffix });
}
function expectedNativeRelationshipsV5(state, before = {}) {
  const associations = derivePrAssociationsV5(state);
  if (!associations.ok) return associations;
  const beforeChildren = Array.isArray(before.children) ? before.children : [];
  const children = [...new Set([...beforeChildren, ...state.children.map((child) => child.issue)])];
  const dependencies = clone(before.dependencies || {});
  for (const child of state.children) dependencies[String(child.issue)] = clone(child.dependencies);
  const associatedPrs = [...new Set([...(Array.isArray(before.associated_prs) ? before.associated_prs : []), ...state.prs.map((pr) => pr.number)])];
  const prAssociations = clone(before.pr_associations || {});
  for (const [number, association] of Object.entries(associations.associations)) prAssociations[number] = association;
  return ok('PROGRAMME_V5_NATIVE_RELATIONSHIPS_DERIVED', { native: {
    children,
    dependencies,
    associated_prs: associatedPrs,
    pr_associations: prAssociations,
    api_version: before.api_version || '2022-11-28',
  } });
}
function validateMigrationInput(snapshot) {
  if (!isRecord(snapshot) || snapshot.complete !== true || !safeLine(snapshot.repository, 200) || !safeLine(snapshot.revision, 256)
    || !isRecord(snapshot.bodies) || !isRecord(snapshot.bodies.children) || !isRecord(snapshot.bodies.prs)
    || !isRecord(snapshot.labels) || !Array.isArray(snapshot.managed_events) || !isRecord(snapshot.native)) return fail('migration-input-incomplete');
  return ok('MIGRATION_INPUT_VALID');
}
function buildMigrationPreviewV5(input = {}) {
  const inputValid = validateMigrationInput(input.legacy_snapshot);
  if (!inputValid.ok) return inputValid;
  const snapshot = input.legacy_snapshot;
  const source = parseV4CanonicalSnapshot(snapshot, snapshot.repository, input.parent_issue || snapshot.canonical_state?.parent?.issue);
  if (!source.ok) return source;
  const bodyCheck = parseV4Bodies(snapshot, source.state);
  if (!bodyCheck.ok) return fail('v4-body-inventory-invalid', { detail: bodyCheck.reason });
  const currentEvents = v4.validateManagedEventInventoryV4(snapshot.managed_events, snapshot.repository);
  if (!currentEvents.ok) return currentEvents;
  const migrated = migrateV4ToV5(source.state, {
    authority_ref: input.authority_ref,
    authority_evidence_id: input.authority_evidence_id,
    concurrency_authority: input.concurrency_authority,
    live_candidate: input.live_candidate || input.candidate,
  });
  if (!migrated.ok) return migrated;
  const target = migrated.state;
  const targetValid = validateCanonicalStateV5(target);
  if (!targetValid.ok) return targetValid;
  const rendered = renderProgrammeV5(target);
  if (!rendered.ok) return rendered;
  const integrity = verifyRenderedProgrammeIntegrityV5(target, rendered);
  if (!integrity.ok) return integrity;
  const bodies = { parent: null, children: clone(snapshot.bodies.children), prs: clone(snapshot.bodies.prs) };
  const parentBody = materializeBody(snapshot.bodies.parent, 'parent', rendered.bodies.parent, { repository: target.repository, parent_issue: target.parent.issue, number: target.parent.issue });
  if (!parentBody.ok) return parentBody;
  bodies.parent = parentBody.body;
  for (const child of target.children) {
    const materialized = materializeBody(snapshot.bodies.children[String(child.issue)], 'child', rendered.bodies.children[String(child.issue)], { repository: target.repository, parent_issue: target.parent.issue, number: child.issue });
    if (!materialized.ok) return materialized;
    bodies.children[String(child.issue)] = materialized.body;
  }
  for (const pr of target.prs) {
    const materialized = materializeBody(snapshot.bodies.prs[String(pr.number)], 'pr', rendered.bodies.prs[String(pr.number)], { repository: target.repository, parent_issue: target.parent.issue, number: pr.number });
    if (!materialized.ok) return materialized;
    bodies.prs[String(pr.number)] = materialized.body;
  }
  const authorityRef = input.authority_ref;
  if (!safeLine(authorityRef, 512)) return fail('migration-authority-required');
  const previousEvent = snapshot.managed_events.at(-1)?.event_id || null;
  const event = createManagedEventV3({
    event_type: 'migration', repository: target.repository, parent_issue: target.parent.issue, entity: { kind: 'parent', number: target.parent.issue },
    source_state_schema: 'toolkit.github-program.state.v4', from_state_digest: source.canonical_digest, to_state_digest: targetValid.canonical_digest,
    authority_ref: authorityRef, authority_digest: input.authority_digest || digest({ authority_ref: authorityRef, target_canonical_digest: targetValid.canonical_digest }),
    candidate_binding_digest: candidateBindingDigest(target), prior_event_id: previousEvent, state: target,
  });
  const eventCheck = validateManagedEventV3(event, { repository: target.repository, parent_issue: target.parent.issue });
  if (!eventCheck.ok) return eventCheck;
  const retainedEvents = snapshot.managed_events.map(clone);
  const targetEvents = [...retainedEvents, event];
  const targetEventInventory = validateManagedEventInventoryV5(targetEvents, target.repository);
  if (!targetEventInventory.ok) return targetEventInventory;
  const native = expectedNativeRelationshipsV5(target, snapshot.native);
  if (!native.ok) return native;
  const expectedLabels = expectedLabelsV5(target, snapshot.labels);
  const bootstrapBefore = snapshot.bootstrap === undefined ? null : clone(snapshot.bootstrap);
  const bootstrapAfter = input.bootstrap_after || buildBootstrap({ repository: target.repository, parent_issue: target.parent.issue, version: input.toolkit_version || '2.12.0' });
  const bootstrapCheck = validateBootstrapForProgramme(bootstrapAfter, target.repository, target.parent.issue);
  if (!bootstrapCheck.ok) return bootstrapCheck;
  const firstLane = target.active_lanes[0];
  const receipt = createRunReceipt({
    receipt_type: 'TRANSITION_PREVIEW', run_id: `preview-${digest({ source: snapshot.revision, target: targetValid.canonical_digest }).slice(0, 20)}`,
    repository: target.repository, parent_issue: target.parent.issue, lane_id: firstLane?.lane_id || `parent-${target.parent.issue}`,
    child_issue: firstLane?.child_issue || target.children[0].issue, epoch_id: firstLane?.epoch_id || target.children[0].epochs[0].id,
    gate: firstLane?.gate || target.children[0].epochs[0].gates[0], lock: (target.children.find((child) => child.issue === (firstLane?.child_issue || target.children[0].issue))?.epochs.find((epoch) => epoch.id === (firstLane?.epoch_id || target.children[0].epochs[0].id)) || target.children[0].epochs[0]).lock,
    candidate_binding_digest: candidateBindingDigest(target), authority_digest: bootstrapAfter.digest, lease: { lease_id: `preview-${target.parent.issue}`, fence_id: `preview-fence-${target.parent.issue}`, fence_sequence: 0, expires_at: input.receipt_expires_at || '2099-01-01T00:00:00.000Z' },
    result: { preview_id_pending: true, source_state_schema: 'toolkit.github-program.state.v4', target_state_schema: STATE_SCHEMA, mutation_authority: 'NOT_GRANTED' }, readback: { required: true, immediate_rerun: 'ZERO_DELTA' }, created_at: input.created_at || '2026-01-01T00:00:00.000Z',
  });
  const receiptCheck = validateReceiptObject(receipt, { repository: target.repository, parent_issue: target.parent.issue });
  if (!receiptCheck.ok) return receiptCheck;
  const expectedSnapshot = { repository: target.repository, revision: snapshot.revision, complete: true, canonical_state: clone(target), bodies, labels: expectedLabels, managed_events: targetEventInventory.events, native: native.native, bootstrap: bootstrapAfter };
  const sourceBodyDigests = { parent: digest(snapshot.bodies.parent), children: Object.fromEntries(Object.entries(snapshot.bodies.children).sort(([a], [b]) => Number(a) - Number(b)).map(([key, value]) => [key, digest(value)])), prs: Object.fromEntries(Object.entries(snapshot.bodies.prs).sort(([a], [b]) => Number(a) - Number(b)).map(([key, value]) => [key, digest(value)])) };
  const targetBodyDigests = { parent: digest(bodies.parent), children: Object.fromEntries(Object.entries(bodies.children).map(([key, value]) => [key, digest(value)])), prs: Object.fromEntries(Object.entries(bodies.prs).map(([key, value]) => [key, digest(value)])) };
  const nativeDelta = !same(snapshot.native, native.native);
  const labelsDelta = !same(snapshot.labels, expectedLabels);
  const operations = [];
  addOperation(operations, 'bootstrap-file', '.github/ai-agent-toolkit-programme.json', bootstrapBefore, bootstrapAfter);
  addOperation(operations, 'migrate-parent-body', target.parent.issue, snapshot.bodies.parent, bodies.parent);
  for (const child of target.children) addOperation(operations, 'migrate-child-body', child.issue, snapshot.bodies.children[String(child.issue)], bodies.children[String(child.issue)]);
  for (const pr of target.prs) addOperation(operations, 'migrate-pr-body', pr.number, snapshot.bodies.prs[String(pr.number)], bodies.prs[String(pr.number)]);
  addOperation(operations, 'managed-event', target.parent.issue, null, event);
  addOperation(operations, 'run-receipt', target.parent.issue, null, receipt, { durable_persistence: 'required-before-dependent-progression', mutation_authority: 'NOT_GRANTED' });
  addOperation(operations, 'labels', target.parent.issue, snapshot.labels, expectedLabels);
  addOperation(operations, 'native-relationships', target.parent.issue, snapshot.native, native.native, { changed: nativeDelta });
  const managedEventDelta = { retained_count: snapshot.managed_events.length, new_events: [event], retained_history_digest: digest(snapshot.managed_events), target_inventory_digest: targetEventInventory.inventory_digest };
  const requiredReceiptDelta = { receipt_type: receipt.receipt_type, receipt_id: receipt.receipt_id, receipt: clone(receipt), durable_required: true, persisted_in_preview: false, reason: 'Operational receipt is separate from canonical transition history.' };
  const preview = {
    schema: MIGRATION_SCHEMA, preview_kind: 'MIGRATION', repository: target.repository, parent_issue: target.parent.issue, authority_ref: authorityRef,
    source_state_schema: 'toolkit.github-program.state.v4', target_state_schema: STATE_SCHEMA, expected_revision: snapshot.revision, source_snapshot_digest: snapshotDigest(snapshot), source_canonical_digest: source.canonical_digest,
    source_body_digests: sourceBodyDigests, target_canonical_digest: targetValid.canonical_digest, target_managed_body_digests: rendered.body_digests, target_body_digests: targetBodyDigests,
    bootstrap: { before: bootstrapBefore, after: bootstrapAfter, digest: bootstrapAfter.digest }, labels: { before: clone(snapshot.labels), after: expectedLabels, changed: labelsDelta },
    native_relationships: { before: clone(snapshot.native), after: native.native, changed: nativeDelta, pr_associations: native.native.pr_associations },
    managed_event_delta: managedEventDelta, required_receipt_delta: requiredReceiptDelta, operations, operations_digest: digest(operations), ordered_operation_ids: operations.map((operation) => operation.operation_id),
    expected_snapshot_digest: snapshotDigest(expectedSnapshot), expected_snapshot: expectedSnapshot, mutation_authority: 'NOT_GRANTED', finality_authority: 'NOT_GRANTED', preview_only: true,
  };
  preview.preview_id = digest(preview);
  return ok('PROGRAMME_V5_MIGRATION_PREVIEW_READY', preview);
}

function buildConvergencePreviewV5(input = {}) {
  const valid = validateCanonicalStateV5(input.desired);
  if (!valid.ok) return valid;
  const snapshot = input.snapshot;
  if (!isRecord(snapshot) || snapshot.complete !== true || snapshot.repository !== input.desired.repository || !safeLine(snapshot.revision, 256)
    || !isRecord(snapshot.bodies) || !isRecord(snapshot.labels) || !Array.isArray(snapshot.managed_events) || !isRecord(snapshot.native)) return fail('current-snapshot-incomplete');
  if (snapshot.canonical_state?.schema === STATE_SCHEMA) {
    const bootstrap = validateBootstrapForProgramme(snapshot.bootstrap, snapshot.repository, input.desired.parent.issue);
    if (!bootstrap.ok) return fail('v5-bootstrap-invalid-or-missing', { detail: bootstrap.reason });
  }
  const events = validateManagedEventInventoryV5(snapshot.managed_events, snapshot.repository);
  if (!events.ok) return events;
  const rendered = renderProgrammeV5(input.desired);
  if (!rendered.ok) return rendered;
  const integrity = verifyRenderedProgrammeIntegrityV5(input.desired, rendered);
  if (!integrity.ok) return integrity;
  const bodies = { parent: null, children: clone(snapshot.bodies.children), prs: clone(snapshot.bodies.prs) };
  const parentBody = materializeBody(snapshot.bodies.parent, 'parent', rendered.bodies.parent, { repository: input.desired.repository, parent_issue: input.desired.parent.issue, number: input.desired.parent.issue });
  if (!parentBody.ok) return parentBody;
  bodies.parent = parentBody.body;
  for (const child of input.desired.children) { const result = materializeBody(snapshot.bodies.children[String(child.issue)], 'child', rendered.bodies.children[String(child.issue)], { repository: input.desired.repository, parent_issue: input.desired.parent.issue, number: child.issue }); if (!result.ok) return result; bodies.children[String(child.issue)] = result.body; }
  for (const pr of input.desired.prs) { const result = materializeBody(snapshot.bodies.prs[String(pr.number)], 'pr', rendered.bodies.prs[String(pr.number)], { repository: input.desired.repository, parent_issue: input.desired.parent.issue, number: pr.number }); if (!result.ok) return result; bodies.prs[String(pr.number)] = result.body; }
  const existingTargetEvent = events.events.find((entry) => entry.schema === MANAGED_EVENT_SCHEMA && entry.to_state_digest === valid.canonical_digest && entry.repository === input.desired.repository && entry.parent_issue === input.desired.parent.issue);
  const event = existingTargetEvent || createManagedEventV3({ event_type: snapshot.canonical_state?.schema === STATE_SCHEMA ? 'canonical_transition' : 'canonical_initialisation', state: input.desired, source_state_schema: snapshot.canonical_state?.schema || null, from_state_digest: snapshot.canonical_state ? digest(snapshot.canonical_state) : digest(null), to_state_digest: valid.canonical_digest, repository: input.desired.repository, parent_issue: input.desired.parent.issue, entity: { kind: 'parent', number: input.desired.parent.issue }, authority_ref: input.authority_ref || 'runtime:v5', authority_digest: input.authority_digest || digest(input.authority_ref || 'runtime:v5'), candidate_binding_digest: candidateBindingDigest(input.desired), prior_event_id: events.events.at(-1)?.event_id || null, state: input.desired });
  const targetEvents = existingTargetEvent ? events.events : [...events.events, event];
  const eventInventory = validateManagedEventInventoryV5(targetEvents, input.desired.repository);
  if (!eventInventory.ok) return eventInventory;
  const labels = expectedLabelsV5(input.desired, snapshot.labels);
  const native = expectedNativeRelationshipsV5(input.desired, snapshot.native);
  if (!native.ok) return native;
  const expectedSnapshot = { repository: input.desired.repository, revision: snapshot.revision, complete: true, canonical_state: clone(input.desired), bodies, labels, managed_events: targetEvents, native: native.native, bootstrap: snapshot.bootstrap || null };
  const operations = [];
  addOperation(operations, 'parent-body', input.desired.parent.issue, snapshot.bodies.parent, bodies.parent);
  for (const child of input.desired.children) addOperation(operations, 'child-body', child.issue, snapshot.bodies.children[String(child.issue)], bodies.children[String(child.issue)]);
  for (const pr of input.desired.prs) addOperation(operations, 'pr-body', pr.number, snapshot.bodies.prs[String(pr.number)], bodies.prs[String(pr.number)]);
  if (!existingTargetEvent) addOperation(operations, 'managed-event', input.desired.parent.issue, null, event);
  addOperation(operations, 'labels', input.desired.parent.issue, snapshot.labels, labels);
  addOperation(operations, 'native-relationships', input.desired.parent.issue, snapshot.native, native.native);
  const preview = { schema: 'toolkit.github-program.preview.v5', preview_kind: 'RECONCILIATION', repository: input.desired.repository, parent_issue: input.desired.parent.issue, current_revision: snapshot.revision, current_snapshot_digest: snapshotDigest(snapshot), canonical_digest: valid.canonical_digest, target_body_digests: { parent: digest(bodies.parent), children: Object.fromEntries(Object.entries(bodies.children).map(([key, value]) => [key, digest(value)])), prs: Object.fromEntries(Object.entries(bodies.prs).map(([key, value]) => [key, digest(value)]) ) }, target_projection_digests: rendered.body_digests, expected_event_inventory_digest: eventInventory.inventory_digest, managed_event_delta: { retained_count: events.events.length, new_events: existingTargetEvent ? [] : [event] }, operations, operations_digest: digest(operations), expected_snapshot_digest: snapshotDigest(expectedSnapshot), expected_snapshot: expectedSnapshot, mutation_authority: 'NOT_GRANTED', finality_authority: 'NOT_GRANTED' };
  preview.preview_id = digest(preview);
  return ok(operations.length ? 'PROGRAMME_V5_PREVIEW_READY' : 'PROGRAMME_ZERO_DELTA', preview);
}
function buildPreviewV5(input = {}) {
  if (input.legacy_snapshot || input.snapshot?.canonical_state?.schema === 'toolkit.github-program.state.v4') return buildMigrationPreviewV5({ ...input, legacy_snapshot: input.legacy_snapshot || input.snapshot });
  return buildConvergencePreviewV5(input);
}
function verifyConvergenceReadbackV5(snapshot, preview) {
  if (!isRecord(snapshot) || snapshot.complete !== true || snapshot.repository !== preview.repository || snapshot.revision !== (preview.expected_revision || preview.current_revision)) return fail('readback-snapshot-binding-invalid');
  if (snapshotDigest(snapshot) !== preview.expected_snapshot_digest) return fail('readback-snapshot-digest-mismatch');
  return ok('PROGRAMME_V5_READBACK_VERIFIED', { zero_delta_required: true });
}

function createMemoryDurableStore(initial = {}) {
  // This is a test/host adapter.  Production callers must inject a durable
  // GitHub-backed or filesystem-backed implementation; the runtime never
  // uses an in-process Map as its replay authority.
  const receipts = Array.isArray(initial.receipts) ? initial.receipts.map(clone) : [];
  const previews = Array.isArray(initial.previews) ? initial.previews.map(clone) : [];
  const events = Array.isArray(initial.events) ? initial.events.map(clone) : [];
  return Object.freeze({
    appendReceipt(receipt) {
      const existing = receipts.find((entry) => entry.receipt_id === receipt.receipt_id);
      if (existing) return same(existing, receipt) ? { duplicate: true } : { conflict: true };
      receipts.push(clone(receipt)); return { duplicate: false };
    },
    readReceiptChain(runId) { return receipts.filter((entry) => !runId || entry.run_id === runId).map(clone); },
    writePreview(preview) { const existing = previews.find((entry) => entry.preview_id === preview.preview_id); if (existing && !same(existing, preview)) return { conflict: true }; if (!existing) previews.push(clone(preview)); return { duplicate: Boolean(existing) }; },
    readPreview(previewId) { return clone(previews.find((entry) => entry.preview_id === previewId) || null); },
    appendEvent(event) { const existing = events.find((entry) => entry.event_id === event.event_id); if (existing) return same(existing, event) ? { duplicate: true } : { conflict: true }; events.push(clone(event)); return { duplicate: false }; },
    readEvents() { return events.map(clone); },
  });
}
function createProgrammeRuntimeV5(options = {}) {
  const store = options.durable_store || options.store;
  function inspect() {
    if (typeof options.inspect_snapshot !== 'function') return fail('snapshot-adapter-required');
    try { return ok('SNAPSHOT_INSPECTED', { snapshot: options.inspect_snapshot() }); } catch (_error) { return fail('snapshot-inspection-failed'); }
  }
  function persistPreview(result) {
    if (!result.ok) return result;
    if (!store || typeof store.writePreview !== 'function') return fail('durable-preview-store-required');
    try { const stored = store.writePreview(result); if (stored?.conflict) return fail('preview-persistence-conflict'); return result; } catch (_error) { return fail('preview-persistence-failed'); }
  }
  function preview(input = {}) { const inspected = inspect(); return inspected.ok ? persistPreview(buildPreviewV5({ ...input, snapshot: inspected.snapshot })) : inspected; }
  function migrationPreview(input = {}) { const inspected = inspect(); return inspected.ok ? persistPreview(buildMigrationPreviewV5({ ...input, legacy_snapshot: inspected.snapshot })) : inspected; }
  function recordReceipt(input = {}) { if (!store) return fail('durable-receipt-store-required'); const receipt = input.schema === RUN_RECEIPT_SCHEMA ? input : createRunReceipt(input); return appendRunReceipt(store, receipt); }
  function recover(input = {}) {
    const chain = input.receipts || (store && typeof store.readReceiptChain === 'function' ? store.readReceiptChain(input.run_id) : []);
    return classifyRecovery({ ...input, receipts: chain });
  }
  function immediateZeroDelta(preview, snapshot) {
    const desired = preview.expected_snapshot?.canonical_state;
    if (!isRecord(desired) || desired.schema !== STATE_SCHEMA) return fail('immediate-rerun-target-missing');
    const rerun = buildConvergencePreviewV5({ snapshot, desired, authority_ref: preview.authority_ref || 'runtime:v5' });
    if (!rerun.ok || rerun.code !== 'PROGRAMME_ZERO_DELTA' || rerun.operations.length !== 0) return fail('immediate-rerun-not-zero-delta');
    return ok('PROGRAMME_ZERO_DELTA', { mutation_count: 0, readback_verified: true, immediate_rerun: 'ZERO_DELTA' });
  }
  function apply(input = {}) {
    if (!store || typeof store.readPreview !== 'function') return fail('durable-preview-store-required');
    const preview = input.preview || store.readPreview(input.preview_id);
    if (!isRecord(preview) || !preview.preview_id || !['toolkit.github-program.preview.v5', MIGRATION_SCHEMA].includes(preview.schema)
      || !Array.isArray(preview.operations) || !same(preview, store.readPreview(preview.preview_id))) return fail('durable-preview-required');
    if (preview.operations.length === 0) {
      if (typeof options.inspect_snapshot !== 'function') return fail('snapshot-adapter-required');
      let snapshot; try { snapshot = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
      return immediateZeroDelta(preview, snapshot);
    }
    if (typeof options.verify_authority !== 'function' || typeof options.apply_operations !== 'function' || typeof options.inspect_snapshot !== 'function') return fail('mutation-adapters-required');
    const binding = {
      preview_schema: preview.schema,
      preview_kind: preview.preview_kind,
      preview_id: preview.preview_id,
      repository: preview.repository,
      parent_issue: preview.parent_issue,
      expected_revision: preview.expected_revision || preview.current_revision,
      source_snapshot_digest: preview.source_snapshot_digest || preview.current_snapshot_digest,
      target_canonical_digest: preview.target_canonical_digest || preview.canonical_digest,
      target_projection_digests: clone(preview.target_managed_body_digests || preview.target_projection_digests || null),
      candidate_binding_digest: preview.candidate_binding_digest || preview.required_receipt_delta?.receipt?.candidate_binding_digest || null,
      authority_ref: preview.authority_ref || null,
      expected_event_inventory_digest: preview.managed_event_delta?.target_inventory_digest || preview.expected_event_inventory_digest || null,
      required_receipt_id: preview.required_receipt_delta?.receipt_id || null,
      expected_snapshot_digest: preview.expected_snapshot_digest,
      operations_digest: preview.operations_digest,
      operation_ids: preview.operations.map((operation) => operation.operation_id),
    };
    let authority; try { authority = options.verify_authority({ assertion: clone(input.authority), binding: clone(binding) }); } catch (_error) { return fail('trusted-authority-verification-failed'); }
    if (!authority?.ok) return fail('trusted-authority-required');
    let applied; try { applied = options.apply_operations({ operations: clone(preview.operations), repository: preview.repository, parent_issue: preview.parent_issue }); } catch (_error) { return fail('apply-failed'); }
    if (!applied?.ok) return fail('apply-failed');
    let snapshot; try { snapshot = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
    const readback = verifyConvergenceReadbackV5(snapshot, preview);
    if (!readback.ok) return readback;
    const zero = immediateZeroDelta(preview, snapshot);
    if (!zero.ok) return zero;
    return ok('PROGRAMME_V5_APPLIED', { applied_count: applied.applied_count ?? preview.operations.length, readback_verified: true, immediate_rerun: zero.immediate_rerun });
  }
  return Object.freeze({ preview, migrationPreview, recordReceipt, recover, apply });
}

module.exports = Object.freeze({
  STATE_SCHEMA, PROJECTION_SCHEMA, EXTENSIONS_SCHEMA, MANAGED_EVENT_SCHEMA, RUN_RECEIPT_SCHEMA, BOOTSTRAP_SCHEMA, MIGRATION_SCHEMA, DESIGN_LOCK, BOOTSTRAP_REVISION, BOOTSTRAP_CONTRACTS,
  BODY_BUDGET_BYTES, CANONICAL_STATE_BUDGET_BYTES, TOTAL_PROJECTION_BUDGET_BYTES, RECEIPT_BUDGET_BYTES, LIFECYCLES, REGISTRY_STATUSES, LIVE_PR_LIFECYCLES,
  AUTHORITY_MODES, GATE_STATES, GATE_RESULTS, RECOVERY_STATUSES, RECEIPT_TYPES, MARKERS, STATE_LINE_PREFIX, PROJECTION_LINE_PREFIX,
  canonicalJson, digest, bytes, clone, authorityDigest, validateConcurrencyAuthority, validateWorkClaims, validateCanonicalStateV5, deriveProjectionV5, renderProgrammeV5,
  parseProgrammeV5Body, verifyRenderedProgrammeIntegrityV5, candidateBinding, candidateBindingDigest, derivePrAssociationsV5, expectedLabelsV5,
  createManagedEventV3, validateManagedEventV3, validateManagedEventInventoryV5, createRunReceipt, validateRunReceipt, validateReceiptObject,
  validateRunReceiptChain, appendRunReceipt, canAdvanceFromTerminal, consumeTerminalEvidence, classifyRecovery, recoverRun, validateWriterAction,
  buildBootstrap, validateControllerBootstrap, resolvePinnedContract, detectManagedRepository, inspectControllerContext, migrateV4ToV5,
  buildMigrationPreviewV5, buildV5MigrationPreview: buildMigrationPreviewV5, buildConvergencePreviewV5, buildV5ConvergencePreview: buildConvergencePreviewV5,
  buildPreviewV5, verifyConvergenceReadbackV5, createMemoryDurableStore, createProgrammeRuntimeV5, createV5Runtime: createProgrammeRuntimeV5,
  snapshotDigest, expectedNativeRelationshipsV5,
});
