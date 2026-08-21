'use strict';

const crypto = require('node:crypto');
const a1 = require('./toolkit-control-plane/control-plane-kernel.cjs');
const canonicalA2 = require('./toolkit-capability-registry.cjs');

const CONTRACT_VERSION = 'toolkit.n5.github-governance-review-reconciler.v3';
const REVIEW_INVENTORY_VERSION = 'toolkit.n5.review-inventory.v1';
const TRACKER_VERSION = 'v3';
const LEGACY_V0_VERSION = 'pre-n5-seven-section-v0';
const DESIGN_LOCK = 'DL-N5-GITHUB-GOVERNANCE-REVIEW-RECONCILER-001-G2-R1';
const INTENTS = Object.freeze(['inspect', 'preview', 'initialise', 'migrate', 'validate', 'reconcile', 'show', 'remove']);
const MUTATION_ACTIONS = Object.freeze({
  initialise: 'n5.initialise',
  migrate: 'n5.migrate',
  reconcile: 'n5.reconcile',
  remove: 'n5.remove',
});
const RESOURCE_KINDS = Object.freeze(['parent', 'child', 'pr']);
const LIFECYCLES = Object.freeze(['pending', 'current', 'terminal']);
const A4_MATERIAL_PREDICATES = Object.freeze([
  'applies_to_current_candidate', 'identifies_accepted_requirement', 'concrete_current_failure',
  'evidence_reproducible', 'material_impact', 'in_scope_current',
]);
const A4_EXCLUSIONS = Object.freeze(['stale', 'duplicate_root', 'optional', 'speculative', 'hypothetical_future', 'cleaner_architecture_only', 'outside_scope']);
const REVIEW_DISPOSITIONS = Object.freeze(['fixed', 'already satisfied', 'incorrect assumption', 'intended design', 'superseded', 'duplicate', 'valid follow-up completed', 'valid and still unresolved', 'unable to verify']);
const DF_TRIGGERS = Object.freeze(['BEFORE_COMPONENT_WORK', 'BEFORE_PR_FINALITY', 'BEFORE_RELEVANT_OPERATIONAL_BOUNDARY', 'FINAL_PROGRAMME_AUDIT']);
const DF_DISPOSITIONS = Object.freeze(['DEFERRED_REVALIDATE', 'SATISFIED', 'SUPERSEDED', 'OBSOLETE', 'DISPOSED_NONMATERIAL', 'PROMOTED_TO_EXISTING_CHILD', 'PROMOTED_TO_CHILD']);
const OBJECTIVE_STATUSES = Object.freeze(['completed', 'disposed']);
const NON_DELIVERY_PR_STATES = new Set(['closed', 'closed_unmerged', 'failed', 'rejected', 'superseded', 'outdated']);
const MUTATION_TARGET_KINDS = Object.freeze({ managed_parent_block: 'n5-managed-parent-block', legacy_parent_block: 'n5-legacy-parent-block' });
const sharedTransactionOwners = new Map();
const FINDING_EVIDENCE_VERSION = 'toolkit.n5.finding-evidence.v1';
const TERMINAL_EVIDENCE_VERSION = 'toolkit.n5.terminal-evidence.v1';
const MANAGED_MARKERS = Object.freeze({
  parent: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v3 -->', end: '<!-- AI-AGENT-TOOLKIT:N5-PARENT:END -->' }),
  child: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:N5-CHILD:BEGIN v3 -->', end: '<!-- AI-AGENT-TOOLKIT:N5-CHILD:END -->' }),
  pr: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:N5-PR:BEGIN v3 -->', end: '<!-- AI-AGENT-TOOLKIT:N5-PR:END -->' }),
});
const STATE_MARKERS = Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:N5-STATE:BEGIN v1 -->', end: '<!-- AI-AGENT-TOOLKIT:N5-STATE:END -->' });
const SECTION_ORDER = Object.freeze({
  parent: Object.freeze(['Metadata', 'Current work', 'Pending work', 'Other open PRs', 'Terminal and repository detail', 'Deferred Findings', 'Tracker format contract']),
  child: Object.freeze(['Metadata', 'Progress checklist', 'Objective', 'Scope and Design Lock', 'Current blockers and next gate', 'Technical and repository detail', 'Tracker format contract']),
  pr: Object.freeze(['Metadata', 'Current disposition', 'Scope', 'Changes, evidence, validation and exact identity', 'Repository-specific detail', 'Tracker format contract']),
});
const FAILURE_CODES = Object.freeze([
  'PARENT_BODY_INCOMPLETE', 'PARENT_ENTRY_MISSING', 'PARENT_ENTRY_DUPLICATE', 'PARENT_PARSE_UNCERTAIN',
  'PARENT_CONCURRENCY_CONFLICT', 'PARENT_BYTE_DRIFT', 'PARENT_BODY_LIMIT', 'PARENT_RECONCILIATION_INCOMPLETE',
  'N5_REPOSITORY_IDENTITY_MISMATCH', 'N5_CONSENT_REQUIRED', 'N5_AUTHORITY_REQUIRED', 'N5_TRACKER_VERSION_UNSUPPORTED',
  'N5_REVIEW_INVENTORY_INCOMPLETE', 'N5_DF_AMBIGUOUS', 'N5_REVIEW_MUTATION_DENIED', 'N5_REVIEW_DISPOSITION_INCOMPLETE',
  'N5_GOVERNANCE_UNREADY', 'N5_SCOPE_REJECTED', 'N5_SECRET_OR_PRIVATE_DATA_REJECTED', 'PUBLISH_SOURCE_MISMATCH',
  'AUTO_CODE_GOVERNANCE_UNREADY',
]);
const SUCCESS_CODES = Object.freeze(['N5_INSPECTION_READY', 'N5_PREVIEW_READY', 'N5_VALID', 'N5_SHOW_READY', 'N5_NOOP', 'N5_RECONCILED', 'N5_REMOVED', 'N5_DF_REGISTERED']);
const RED_FIRST_CASES = Object.freeze([
  'wrong identity', 'A2 consent', 'duplicate parent', 'duplicate child issue', 'duplicate PR', 'legacy grammar',
  'A2 flat queue', 'A2 current child', 'A2 failed PR lineage', 'A2 missing managed block', 'partial retrieval',
  'parse uncertain', 'concurrent movement', 'byte/order drift', 'body-limit without evidence', 'verified body-limit',
  'A2 safe compaction', 'partial reconciliation', 'uncertain reconciliation', 'immediate readback', 'review closing',
  'open PR inventory', 'merged/closed PR inventory', 'merged PR inventory', 'pagination', 'material predicates',
  'DF not task', 'DF ambiguity', 'frozen promotion', 'executor mutation', 'Codex silence', 'auto-code readiness',
  'PR310', 'generated direct edit', 'secret/private evidence', 'idempotent no-op',
  'A1 exact digest binding', 'explicit review authority proof', 'canonical A4 review projection', 'source-bound finding provenance', 'typed DF promotion',
]);

function success(code, extra = {}) { return { ok: true, code, ...extra }; }
function failure(code, extra = {}) { return { ok: false, code, ...extra }; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((key) => [key, sortValue(value[key])]));
}
function canonicalJson(value) { return JSON.stringify(sortValue(value)); }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex'); }
function isSha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function isDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function isSafeId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function isSafeLabel(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n]/.test(value); }
function isIssue(value) { return Number.isSafeInteger(value) && value >= 1; }
function forbiddenEvidence(value) {
  return typeof value === 'string' && /```|https?:\/\/|(?:^|[\\/])(?:Users|home|private|secrets?)(?:[\\/]|$)|(?:^|\s)(?:token|password|secret|api[_-]?key)\s*[:=]|provider[-_ ]?(?:name|token|secret)/i.test(value);
}
function publicSafeText(value) { return typeof value === 'string' && value.length <= 4096 && !forbiddenEvidence(value); }
function isPublicSafeEvidence(value = {}) { return isRecord(value) && Object.values(value).every((item) => typeof item !== 'string' || !forbiddenEvidence(item)); }

function authorityBoundary() {
  return {
    a1: { sole_mutation_authority: true, sole_opaque_ticket_authority: true, public_ticket_mint: false, typed_operation: 'github.mutation', broker: 'authority_broker', canonical_digests: true, mutation_actions: { ...MUTATION_ACTIONS } },
    a2: { consent_only: true, capability: 'repository.governance', repository_id_exact_binding: true, widens_task_or_delegation: false, grants_review_mutation: false, grants_finality: false },
    a3: { durable_contract_count: 5, finality_authority: false, additional_contract: false },
    a4: { review_projection: 'nested-only', material_predicates: [...A4_MATERIAL_PREDICATES], web_finality_handoff: true, review_thread_mutation: false },
    n5: { authority_or_finality_token: false, generic_independent_authority_class: false, user_authority: true },
    six_root_contract_integrity: {
      b1_repository_identity: true,
      b2_lifecycle_and_pr_uniqueness: true,
      b3_review_inventory_evidence: true,
      b4_shared_transaction_registry: true,
      b5_proof_gated_compaction: true,
      b6_initialise_and_migrate: true,
    },
  };
}
function transactionContract() {
  return {
    fetch_complete_body: true, bind_revision: true, bind_body_digest: true, parse_deterministically: true,
    bounded_projection: true, mechanical_update: true, pre_write_rebind: true, one_write: true,
    immediate_readback: true, endpoint_cas_claim: false, serial_toolkit_owner: true, blind_retry: false,
    readback_required: true, key: 'repository+parent',
    shared_owner_registry: 'module-process',
    injected_owner_map_cannot_bypass: true,
    release_owner_in_finally: true,
    proof_gated_terminal_compaction: true,
    durable_terminal_evidence_digest_required: true,
    legacy_migration_versions: [LEGACY_V0_VERSION, TRACKER_VERSION], legacy_migration_exact: true,
    legacy_whole_body_digest_target: true,
  };
}

function markerCount(text, marker) { return String(text).split(marker).length - 1; }
function headers(text) { return [...String(text).matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()); }
function parentEntries(state) {
  return [['current_work', state.current_work], ['pending_work', state.pending_work], ['terminal', state.terminal]]
    .flatMap(([section, items]) => (items || []).map((item) => ({ ...item, section })));
}
function renumberPending(state) {
  state.pending_work = (state.pending_work || []).map((item, index) => ({ ...item, queue_order: index + 1 }));
  return state;
}
function representedPrNumber(item) {
  if (!isRecord(item)) return { invalid: true, number: null };
  const values = [];
  if (hasOwn(item, 'pr_number') && item.pr_number !== null && item.pr_number !== undefined && item.pr_number !== 0) {
    if (!isIssue(item.pr_number)) return { invalid: true, number: null };
    values.push(item.pr_number);
  }
  if (hasOwn(item, 'implementation_pr') && item.implementation_pr !== null && item.implementation_pr !== undefined) {
    if (!isRecord(item.implementation_pr)) return { invalid: true, number: null };
    const number = item.implementation_pr.number;
    if (number !== undefined && number !== null && number !== 0) {
      if (!isIssue(number)) return { invalid: true, number: null };
      values.push(number);
    }
  }
  const unique = [...new Set(values)];
  if (unique.length > 1) return { invalid: true, number: null };
  return { invalid: false, number: unique[0] || null };
}
function terminalObjectiveValid(entry) {
  if (!isRecord(entry) || !OBJECTIVE_STATUSES.includes(entry.objective_status)) return false;
  const prState = entry.implementation_pr && entry.implementation_pr.state;
  if (entry.objective_status === 'disposed') return true;
  if (NON_DELIVERY_PR_STATES.has(prState)) return false;
  if (!isRecord(entry.durable_evidence) || !isDigest(entry.durable_evidence_digest)) return false;
  const verified = normalizeDurableEvidence(entry, entry.durable_evidence);
  return verified.ok
    && entry.durable_evidence.disposition === 'accepted'
    && verified.evidence.evidence_digest === entry.durable_evidence_digest;
}
function targetRef(state, target = {}) {
  const matches = [];
  for (const section of ['current_work', 'pending_work', 'terminal']) {
    for (const item of state[section] || []) {
      if ((target.child_id && item.child_id === target.child_id) || (target.issue_number && item.issue_number === target.issue_number)) matches.push({ item, section });
    }
  }
  if (matches.length === 0) return failure('PARENT_ENTRY_MISSING');
  if (matches.length > 1) return failure('PARENT_ENTRY_DUPLICATE');
  return success('N5_VALID', matches[0]);
}
function validateParent(state) {
  if (!isRecord(state) || state.kind !== 'parent') return failure('N5_GOVERNANCE_UNREADY');
  if (state.tracker_version !== TRACKER_VERSION) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
  if (!isSafeLabel(state.repository) || !isIssue(state.parent_issue)) return failure('N5_GOVERNANCE_UNREADY');
  for (const key of ['current_work', 'pending_work', 'other_open_prs', 'terminal', 'deferred_findings']) if (!Array.isArray(state[key])) return failure('N5_GOVERNANCE_UNREADY');
  if (state.current_work.length > 1) return failure('N5_GOVERNANCE_UNREADY');
  const childIds = new Set();
  const issueNumbers = new Set();
  for (const entry of parentEntries(state)) {
    const expected = entry.section === 'current_work' ? 'current' : entry.section === 'pending_work' ? 'pending' : 'terminal';
    if (!isSafeId(entry.child_id) || !isIssue(entry.issue_number) || childIds.has(entry.child_id) || issueNumbers.has(entry.issue_number) || entry.lifecycle !== expected) return failure('N5_GOVERNANCE_UNREADY');
    childIds.add(entry.child_id);
    issueNumbers.add(entry.issue_number);
    if (entry.queue !== undefined || entry.subqueue !== undefined || entry.queues !== undefined) return failure('N5_GOVERNANCE_UNREADY');
    if (entry.lifecycle === 'terminal' && !terminalObjectiveValid(entry)) return failure('N5_GOVERNANCE_UNREADY');
  }
  const orders = state.pending_work.map((item) => item.queue_order);
  if (orders.some((item, index) => !Number.isSafeInteger(item) || item !== index + 1)) return failure('N5_GOVERNANCE_UNREADY');
  const represented = representedPrNumbers(state);
  if (represented.invalid || new Set(represented.values).size !== represented.values.length) return failure('N5_GOVERNANCE_UNREADY');
  for (const finding of state.deferred_findings) {
    const validFinding = validateDeferredFindingRecord(finding);
    if (!validFinding.ok || state.pending_work.some((item) => item.df_id === finding.df_id)) return failure('N5_GOVERNANCE_UNREADY');
  }
  if (typeof state.owner_detail !== 'string' || !publicSafeText(state.owner_detail)) return failure('N5_SECRET_OR_PRIVATE_DATA_REJECTED');
  return success('N5_VALID', { state });
}
function validateChild(state) {
  if (!isRecord(state) || state.kind !== 'child') return failure('N5_GOVERNANCE_UNREADY');
  if (state.tracker_version !== TRACKER_VERSION) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
  if (!isSafeLabel(state.repository) || !isIssue(state.issue_number) || !LIFECYCLES.includes(state.lifecycle) || !publicSafeText(state.objective || '')) return failure('N5_GOVERNANCE_UNREADY');
  if (!Array.isArray(state.progress_checklist) || !isRecord(state.scope) || !Array.isArray(state.blockers) || typeof state.next_gate !== 'string') return failure('N5_GOVERNANCE_UNREADY');
  if (state.lifecycle === 'terminal' && !terminalObjectiveValid(state)) return failure('N5_GOVERNANCE_UNREADY');
  if (state.progress_checklist.some((item) => !isSafeId(item.id) || typeof item.checked !== 'boolean' || !publicSafeText(item.text || ''))) return failure('N5_GOVERNANCE_UNREADY');
  return success('N5_VALID', { state });
}
function validatePr(state) {
  if (!isRecord(state) || state.kind !== 'pr') return failure('N5_GOVERNANCE_UNREADY');
  if (state.tracker_version !== TRACKER_VERSION || !isSafeLabel(state.repository) || !isIssue(state.pr_number) || !isIssue(state.child_issue)) return failure('N5_GOVERNANCE_UNREADY');
  if (!['draft', 'open', 'closed', 'merged', 'superseded'].includes(state.state) || !publicSafeText(state.current_disposition || '') || !Array.isArray(state.changes) || !Array.isArray(state.evidence) || !Array.isArray(state.validation) || !isRecord(state.exact_identity) || !isSha(state.exact_identity.base) || !isSha(state.exact_identity.head) || !isSha(state.exact_identity.tree)) return failure('N5_GOVERNANCE_UNREADY');
  return success('N5_VALID', { state });
}
function validateTracker(state) {
  if (!isRecord(state)) return failure('N5_GOVERNANCE_UNREADY');
  if (state.tracker_version !== TRACKER_VERSION) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
  if (state.kind === 'parent') return validateParent(state);
  if (state.kind === 'child') return validateChild(state);
  if (state.kind === 'pr') return validatePr(state);
  return failure('N5_GOVERNANCE_UNREADY');
}

function renderManagedBlock(kind, state) {
  if (!RESOURCE_KINDS.includes(kind)) throw new Error('unsupported managed kind');
  const check = validateTracker(state);
  if (!check.ok) throw new Error(check.code);
  const normalized = clone(state);
  const lines = [MANAGED_MARKERS[kind].begin];
  for (const section of SECTION_ORDER[kind]) {
    lines.push(`## ${section}`);
    if (section === 'Metadata') lines.push(`- Kind: ${kind}`, `- Tracker version: ${TRACKER_VERSION}`, `- Repository: ${normalized.repository}`);
    else if (section === 'Current work') lines.push(`- Current unfinished child count: ${normalized.current_work?.length || 0}`);
    else if (section === 'Pending work') lines.push(`- Flat pending queue count: ${normalized.pending_work?.length || 0}`);
    else if (section === 'Other open PRs') lines.push(`- Other open PR count: ${normalized.other_open_prs?.length || 0}`);
    else if (section === 'Terminal and repository detail') lines.push(`- Terminal projection count: ${normalized.terminal?.length || 0}`, `- Owner detail digest: ${sha256(normalized.owner_detail || '')}`);
    else if (section === 'Deferred Findings') lines.push(`- Deferred Findings count: ${normalized.deferred_findings?.length || 0}`);
    else if (section === 'Progress checklist') lines.push(`- Checklist item count: ${normalized.progress_checklist?.length || 0}`);
    else if (section === 'Objective') lines.push(`- Objective digest: ${sha256(normalized.objective || '')}`);
    else if (section === 'Scope and Design Lock') lines.push(`- Design Lock: ${normalized.scope?.design_lock || DESIGN_LOCK}`);
    else if (section === 'Current blockers and next gate') lines.push(`- Blocker count: ${normalized.blockers?.length || 0}`, `- Next gate: ${normalized.next_gate || 'not set'}`);
    else if (section === 'Technical and repository detail') lines.push(`- Technical detail digest: ${sha256(normalized.technical_detail || '')}`);
    else if (section === 'Current disposition') lines.push(`- Disposition: ${normalized.current_disposition || 'not set'}`, `- PR state: ${normalized.state || 'not set'}`);
    else if (section === 'Scope') lines.push(`- Scope digest: ${sha256(normalized.scope || '')}`);
    else if (section === 'Changes, evidence, validation and exact identity') lines.push(`- Changes: ${normalized.changes?.length || 0}`, `- Evidence: ${normalized.evidence?.length || 0}`, `- Validation: ${normalized.validation?.length || 0}`);
    else if (section === 'Repository-specific detail') lines.push(`- Repository detail digest: ${sha256(normalized.repository_detail || '')}`);
    else if (section === 'Tracker format contract') lines.push('- Managed block: exactly one versioned v3 block.', '- Outside bytes: owner-controlled and preserved byte-for-byte.', '- Lifecycle: pending | current | terminal; no competing queue.');
  }
  lines.push(STATE_MARKERS.begin, JSON.stringify(sortValue(normalized), null, 2), STATE_MARKERS.end, MANAGED_MARKERS[kind].end);
  return `${lines.join('\n')}\n`;
}
function splitManagedBlock(body, kind) {
  const markers = MANAGED_MARKERS[kind];
  const begin = body.indexOf(markers.begin);
  const end = body.indexOf(markers.end, begin + markers.begin.length);
  return begin >= 0 && end >= 0 ? { prefix: body.slice(0, begin), managed: body.slice(begin, end + markers.end.length), suffix: body.slice(end + markers.end.length) } : null;
}
function parseManagedBlock(body, kind, options = {}) {
  if (options.complete === false || typeof body !== 'string') return failure('PARENT_BODY_INCOMPLETE');
  if (!RESOURCE_KINDS.includes(kind)) return failure('PARENT_PARSE_UNCERTAIN');
  const marker = MANAGED_MARKERS[kind];
  if (markerCount(body, marker.begin) !== 1 || markerCount(body, marker.end) !== 1 || markerCount(body, STATE_MARKERS.begin) !== 1 || markerCount(body, STATE_MARKERS.end) !== 1) return failure('PARENT_PARSE_UNCERTAIN');
  if (RESOURCE_KINDS.some((other) => other !== kind && (body.includes(MANAGED_MARKERS[other].begin) || body.includes(MANAGED_MARKERS[other].end)))) return failure('PARENT_PARSE_UNCERTAIN');
  const parts = splitManagedBlock(body, kind);
  if (!parts) return failure('PARENT_PARSE_UNCERTAIN');
  const foundHeaders = headers(parts.managed);
  if (foundHeaders.length !== SECTION_ORDER[kind].length || foundHeaders.some((item, index) => item !== SECTION_ORDER[kind][index])) return failure('PARENT_PARSE_UNCERTAIN');
  const start = parts.managed.indexOf(STATE_MARKERS.begin) + STATE_MARKERS.begin.length;
  const end = parts.managed.indexOf(STATE_MARKERS.end);
  let state;
  try { state = JSON.parse(parts.managed.slice(start, end).trim()); } catch (_error) { return failure('PARENT_PARSE_UNCERTAIN'); }
  const valid = validateTracker(state);
  if (!valid.ok) return valid;
  return success('N5_VALID', { state, sections: foundHeaders, prefix: parts.prefix, suffix: parts.suffix, managed: parts.managed, body_digest: sha256(body), managed_digest: sha256(parts.managed) });
}
function replaceManagedBlock(body, kind, nextState, options = {}) {
  const parsed = parseManagedBlock(body, kind, { complete: options.complete !== false });
  if (!parsed.ok) return parsed;
  if (options.expected_body_digest && options.expected_body_digest !== parsed.body_digest) return failure('PARENT_CONCURRENCY_CONFLICT');
  const rendered = renderManagedBlock(kind, nextState);
  const nextManaged = rendered.endsWith('\n') ? rendered.slice(0, -1) : rendered;
  const nextBody = parsed.prefix + nextManaged + parsed.suffix;
  return success('N5_VALID', { body: nextBody, prefix: parsed.prefix, suffix: parsed.suffix, outside_bytes_preserved: true, body_digest: sha256(nextBody), managed_digest: sha256(nextManaged) });
}
function applyBoundedUpdate(state, target, update = {}) {
  const ownerOnly = update.type === 'set_field' && update.field === 'owner_detail' && (!target || (!target.child_id && !target.issue_number));
  const found = ownerOnly ? success('N5_VALID', { item: null, section: 'parent' }) : targetRef(state, target);
  if (!found.ok) return found;
  const next = clone(state);
  const ref = ownerOnly ? null : targetRef(next, target);
  if (update.type === 'set_field') {
    if (update.field === 'owner_detail') {
      if (!publicSafeText(update.value)) return failure('N5_SCOPE_REJECTED');
      next.owner_detail = update.value;
    } else if (['next_gate', 'technical_detail', 'repository_detail'].includes(update.field) && typeof update.value === 'string' && publicSafeText(update.value)) {
      ref.item[update.field] = update.value;
    } else return failure('N5_SCOPE_REJECTED');
  } else if (update.type === 'set_lifecycle') {
    if (!ref || !LIFECYCLES.includes(update.lifecycle)) return failure('N5_SCOPE_REJECTED');
    for (const section of ['current_work', 'pending_work', 'terminal']) next[section] = next[section].filter((item) => item.child_id !== ref.item.child_id);
    ref.item.lifecycle = update.lifecycle;
    if (update.lifecycle !== 'pending') delete ref.item.queue_order;
    if (update.lifecycle === 'current') {
      if (next.current_work.length) return failure('N5_GOVERNANCE_UNREADY');
      next.current_work.push(ref.item);
    }
    if (update.lifecycle === 'pending') {
      ref.item.queue_order = next.pending_work.length + 1;
      next.pending_work.push(ref.item);
    }
    if (update.lifecycle === 'terminal') next.terminal.push(ref.item);
    renumberPending(next);
  } else return failure('N5_SCOPE_REJECTED');
  const valid = validateTracker(next);
  return valid.ok ? success('N5_VALID', { state: next, changed: canonicalJson(next) !== canonicalJson(state) }) : valid;
}
function boundedProjection(state, metadata = {}) {
  return {
    repository: state.repository, parent_issue: state.parent_issue, tracker_version: state.tracker_version,
    body_digest: metadata.body_digest || null, managed_digest: metadata.managed_digest || null,
    current_work: (state.current_work || []).map((item) => ({ child_id: item.child_id, issue_number: item.issue_number, lifecycle: item.lifecycle, pr_number: item.implementation_pr?.number || item.pr_number || null })),
    pending_work: (state.pending_work || []).map((item) => ({ child_id: item.child_id, issue_number: item.issue_number, queue_order: item.queue_order, lifecycle: item.lifecycle })),
    other_open_prs: (state.other_open_prs || []).map((item) => ({ pr_number: item.pr_number || item.implementation_pr?.number || null, disposition: item.disposition || null })),
    terminal: (state.terminal || []).map((item) => ({ child_id: item.child_id, issue_number: item.issue_number, lifecycle: item.lifecycle, outcome: item.outcome || null })),
    deferred_findings: (state.deferred_findings || []).map((item) => ({ df_id: item.df_id, component: item.component, disposition: item.disposition, linked_child: item.linked_child ?? null })),
    owner_detail_digest: sha256(state.owner_detail || ''),
  };
}
function classifyBodyLimit(body, limit) {
  const bytes = Buffer.byteLength(String(body), 'utf8');
  if (!isRecord(limit) || !Number.isFinite(limit.value) || limit.value <= 0 || !['bytes', 'utf8_bytes'].includes(limit.unit) || typeof limit.provenance !== 'string' || !/^verified[-_]/i.test(limit.provenance)) return { known: false, bytes };
  if (bytes > limit.value) return failure('PARENT_BODY_LIMIT', { known: true, bytes, limit: { value: limit.value, unit: limit.unit, provenance: limit.provenance } });
  return { known: true, bytes, limit: { value: limit.value, unit: limit.unit, provenance: limit.provenance } };
}
function compactTerminal(state, options = {}) {
  if (!isRecord(state) || !Array.isArray(state.terminal)) return failure('PARENT_PARSE_UNCERTAIN');
  if (state.terminal.length === 0) return success('N5_VALID', { state: clone(state), compacted: false });
  const next = clone(state);
  const compacted = [];
  for (const item of next.terminal) {
    const proof = terminalProofFor(item, options);
    const verified = normalizeDurableEvidence(item, proof);
    if (!verified.ok) return failure('PARENT_BODY_LIMIT', { compacted: false, proof_required: true, affected_child: item.child_id });
    compacted.push({
      ...item,
      detail: 'Terminal detail compacted; durable child, PR and chronology evidence is retained by digest.',
      durable_evidence: verified.evidence,
      durable_evidence_digest: verified.evidence.evidence_digest,
    });
  }
  next.terminal = compacted;
  const valid = validateTracker(next);
  return valid.ok ? success('N5_VALID', { state: next, compacted: true }) : valid;
}

function repositoryFromCanonicalRemote(value) {
  let remote = a1.validateRemoteIdentity(value);
  if (!remote.valid && typeof value === 'string' && value.startsWith('scp://git@')) {
    const separator = value.indexOf('/', 'scp://git@'.length);
    if (separator > 'scp://git@'.length) {
      const host = value.slice('scp://git@'.length, separator);
      const scpPath = value.slice(separator + 1);
      remote = a1.validateRemoteIdentity('git@' + host + ':' + scpPath);
    }
  }
  if (!remote.valid || remote.host !== 'github.com') return null;
  const path = remote.path.replace(/^\/+/, '').replace(/\.git$/, '');
  const parts = path.split('/');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part))) return null;
  return parts.join('/');
}
function a2RepositoryBinding(a2, options) {
  const configuredIdProvided = hasOwn(options, 'repository_id') || (isRecord(options.repository_identity) && hasOwn(options.repository_identity, 'repository_id'));
  const configuredId = hasOwn(options, 'repository_id') ? options.repository_id : options.repository_identity?.repository_id;
  if (configuredIdProvided) return failure(isDigest(configuredId) ? 'N5_REPOSITORY_IDENTITY_MISMATCH' : 'N5_CONSENT_REQUIRED');
  if (typeof a2?.resolveRepositoryIdentity !== 'function' || typeof a2?.getRepositoryStatus !== 'function') return failure('N5_CONSENT_REQUIRED');
  let identity;
  let status;
  try {
    identity = a2.resolveRepositoryIdentity({ cwd: options.cwd });
    status = a2.getRepositoryStatus({ cwd: options.cwd });
  } catch (_error) {
    return failure('N5_CONSENT_REQUIRED');
  }
  if (!isRecord(identity) || identity.valid !== true || !isDigest(identity.repository_id)
    || !isRecord(status) || !isDigest(status.repository_id)
    || identity.repository_id !== status.repository_id) return failure('N5_CONSENT_REQUIRED');
  if (status.capabilities?.['repository.governance']?.state !== 'enabled') return failure('N5_CONSENT_REQUIRED');
  const canonicalRepository = repositoryFromCanonicalRemote(identity.canonical_remote || status.canonical_remote);
  if (!canonicalRepository || canonicalRepository !== options.repository) return failure('N5_REPOSITORY_IDENTITY_MISMATCH');
  return success('N5_VALID', { repository_id: identity.repository_id, a2_status: status, a2_identity: identity });
}
function exactMutationKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
function normalizeMutationTarget(value, intent) {
  const target = value === undefined || value === null ? {} : value;
  if (!isRecord(target)) return null;
  const keys = Object.keys(target);
  if (intent === 'reconcile') {
    if (keys.length === 0) return {};
    if (keys.length !== 1) return null;
    if (keys[0] === 'child_id' && isSafeId(target.child_id)) return { child_id: target.child_id };
    if (keys[0] === 'issue_number' && isIssue(target.issue_number)) return { issue_number: target.issue_number };
    return null;
  }
  if (intent === 'remove' && exactMutationKeys(target, ['kind', 'body_digest', 'managed_digest'])
    && target.kind === MUTATION_TARGET_KINDS.managed_parent_block && isDigest(target.body_digest) && isDigest(target.managed_digest)) {
    return { kind: target.kind, body_digest: target.body_digest, managed_digest: target.managed_digest };
  }
  if (intent === 'initialise' && exactMutationKeys(target, ['kind', 'mode'])
    && target.kind === MUTATION_TARGET_KINDS.managed_parent_block && target.mode === 'create') return { kind: target.kind, mode: target.mode };
  if (intent === 'migrate' && exactMutationKeys(target, ['kind', 'source_version', 'source_body_digest'])
    && target.kind === MUTATION_TARGET_KINDS.legacy_parent_block && [LEGACY_V0_VERSION, TRACKER_VERSION].includes(target.source_version) && isDigest(target.source_body_digest)) {
    return { kind: target.kind, source_version: target.source_version, source_body_digest: target.source_body_digest };
  }
  return null;
}
function normalizeMutationUpdate(value, intent, target) {
  const update = value === undefined || value === null ? {} : value;
  if (!isRecord(update)) return null;
  if (intent === 'remove') return Object.keys(update).length === 0 ? {} : null;
  if (intent === 'initialise' || intent === 'migrate') {
    if (!exactMutationKeys(update, ['type', 'state']) || update.type !== 'set_parent_state' || !isRecord(update.state)) return null;
    const valid = validateTracker(update.state);
    if (!valid.ok || update.state.kind !== 'parent') return null;
    return { type: 'set_parent_state', state: clone(update.state) };
  }
  if (Object.keys(update).length === 0) return null;
  if (update.type === 'set_field') {
    if (!exactMutationKeys(update, ['type', 'field', 'value']) || !['owner_detail', 'next_gate', 'technical_detail', 'repository_detail'].includes(update.field) || !publicSafeText(update.value)) return null;
    if (update.field !== 'owner_detail' && Object.keys(target).length === 0) return null;
    return { type: 'set_field', field: update.field, value: update.value };
  }
  if (update.type === 'set_lifecycle') {
    if (!exactMutationKeys(update, ['type', 'lifecycle']) || !LIFECYCLES.includes(update.lifecycle) || Object.keys(target).length === 0) return null;
    return { type: 'set_lifecycle', lifecycle: update.lifecycle };
  }
  return null;
}
function mutationScope(input, options) {
  const intent = typeof input.intent === 'string' && input.intent.length > 0 ? input.intent : 'reconcile';
  if (!Object.prototype.hasOwnProperty.call(MUTATION_ACTIONS, intent) || !isIssue(input.parent_issue)) return null;
  if (hasOwn(input, 'repository_id') || !isDigest(options.repository_id)) return null;
  const target = normalizeMutationTarget(input.target, intent);
  if (target === null) return null;
  const update = normalizeMutationUpdate(input.update, intent, target);
  if (update === null) return null;
  if ((intent === 'initialise' || intent === 'migrate')
    && (update.state.repository !== options.repository || update.state.parent_issue !== input.parent_issue)) return null;
  return {
    repository: options.repository,
    repository_id: options.repository_id,
    parent_issue: input.parent_issue,
    intent,
    target,
    update,
  };
}
function authorizeMutation(input, options) {
  if (!isRecord(input) || input.repository !== options.repository) return failure('N5_REPOSITORY_IDENTITY_MISMATCH');
  const binding = a2RepositoryBinding(options.a2, options);
  if (!binding.ok) return binding;
  const scopedOptions = { ...options, repository_id: binding.repository_id };
  if (input.accepted_preview !== true) return failure('N5_AUTHORITY_REQUIRED');
  const scope = mutationScope(input, scopedOptions);
  if (!scope) return failure('N5_AUTHORITY_REQUIRED');
  const mutation_scope_digest = sha256(scope);
  if (!isDigest(mutation_scope_digest)) return failure('N5_AUTHORITY_REQUIRED');
  const operation = Object.freeze({
    type: 'github.mutation',
    repository: scope.repository,
    action: MUTATION_ACTIONS[scope.intent],
    target: Object.freeze({ kind: 'github-repository', digest: mutation_scope_digest }),
  });
  let expected_operation_digest;
  let expected_target_digest;
  try {
    expected_operation_digest = a1.operationDigest(operation);
    expected_target_digest = a1.targetDigest(operation);
  } catch (_error) {
    return failure('N5_AUTHORITY_REQUIRED');
  }
  if (!isDigest(expected_operation_digest) || !isDigest(expected_target_digest)) return failure('N5_AUTHORITY_REQUIRED');
  const broker = options.authority_broker;
  const method = typeof broker?.authorize === 'function' ? 'authorize' : typeof broker?.evaluate === 'function' ? 'evaluate' : null;
  if (!method) return failure('N5_AUTHORITY_REQUIRED');
  let decision;
  try {
    decision = broker[method]({
      operation_type: operation.type,
      operation_digest: expected_operation_digest,
      target_digest: expected_target_digest,
      operation,
    });
  } catch (_error) {
    return failure('N5_AUTHORITY_REQUIRED');
  }
  if (!isRecord(decision)
    || decision.decision !== 'allow'
    || decision.operation_type !== operation.type
    || decision.operation_digest !== expected_operation_digest
    || decision.target_digest !== expected_target_digest
    || hasOwn(decision, 'issuer')
    || hasOwn(decision, 'self_mint')
    || hasOwn(decision, 'createIssuer')) {
    return failure('N5_AUTHORITY_REQUIRED');
  }
  return success('N5_VALID', {
    mutation_scope: scope,
    mutation_scope_digest,
    operation,
    expected_operation_digest,
    expected_target_digest,
    authority: {
      decision: 'allow',
      operation_type: operation.type,
      operation_digest: expected_operation_digest,
      target_digest: expected_target_digest,
    },
  });
}
function fetchParent(github, input) {
  if (typeof github?.getParent !== 'function') return failure('PARENT_BODY_INCOMPLETE');
  let fetched;
  try { fetched = github.getParent({ repository: input.repository, parent_issue: input.parent_issue }); } catch (_error) { return failure('PARENT_BODY_INCOMPLETE'); }
  if (!isRecord(fetched) || fetched.complete === false || typeof fetched.body !== 'string') return failure('PARENT_BODY_INCOMPLETE');
  return success('N5_VALID', { fetched, binding: { body_digest: sha256(fetched.body), revision: fetched.revision || null, revision_authoritative: fetched.revision_authoritative === true, etag: fetched.etag || null, last_modified: fetched.last_modified || null } });
}
function moved(before, after) {
  return before.body_digest !== after.body_digest || (before.revision_authoritative && after.revision_authoritative && before.revision !== after.revision) || (before.etag && after.etag && before.etag !== after.etag) || (before.last_modified && after.last_modified && before.last_modified !== after.last_modified);
}

function hasOwn(value, key) { return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key); }
function isSafePublicRef(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !forbiddenEvidence(value); }
function isSafeReviewPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !forbiddenEvidence(value)
    && !/^(?:[A-Za-z]:|[\\/])/.test(value)
    && !/(^|[\\/])\.\.(?:[\\/]|$)/.test(value);
}
function copyOptionalSha(sourceValue, target, key) {
  if (!hasOwn(sourceValue, key)) return true;
  if (!isSha(sourceValue[key])) return false;
  target[key] = sourceValue[key];
  return true;
}
function copyOptionalPublicRef(sourceValue, target, key) {
  if (!hasOwn(sourceValue, key)) return true;
  if (!isSafePublicRef(sourceValue[key])) return false;
  target[key] = sourceValue[key];
  return true;
}
function copyOptionalSafeId(sourceValue, target, key) {
  if (!hasOwn(sourceValue, key)) return true;
  if (!isSafeId(sourceValue[key])) return false;
  target[key] = sourceValue[key];
  return true;
}
function copyOptionalIssue(sourceValue, target, key) {
  if (!hasOwn(sourceValue, key)) return true;
  if (!isIssue(sourceValue[key])) return false;
  target[key] = sourceValue[key];
  return true;
}
function copyOptionalBoolean(sourceValue, target, key) {
  if (!hasOwn(sourceValue, key)) return true;
  if (typeof sourceValue[key] !== 'boolean') return false;
  target[key] = sourceValue[key];
  return true;
}
function copyOptionalPathLine(sourceValue, target) {
  if (hasOwn(sourceValue, 'path')) {
    if (sourceValue.path !== null && !isSafeReviewPath(sourceValue.path)) return false;
    target.path = sourceValue.path;
  }
  if (hasOwn(sourceValue, 'line')) {
    if (sourceValue.line !== null && (!Number.isSafeInteger(sourceValue.line) || sourceValue.line < 1)) return false;
    target.line = sourceValue.line;
  }
  return true;
}
function copyOptionalSafeIdArray(sourceValue, target, key) {
  if (!hasOwn(sourceValue, key)) return true;
  if (!Array.isArray(sourceValue[key]) || !sourceValue[key].every(isSafeId)) return false;
  target[key] = [...sourceValue[key]];
  return true;
}
function normalizeCandidate(value) {
  if (!isRecord(value)) return null;
  const pr_number = hasOwn(value, 'pr_number') ? value.pr_number : value.number;
  if (!isIssue(pr_number) || !isSha(value.head) || !isSha(value.tree) || !isSha(value.base)) return null;
  const candidate = { pr_number, head: value.head, tree: value.tree, base: value.base };
  if (hasOwn(value, 'base_ref')) {
    if (!isSafeLabel(value.base_ref)) return null;
    candidate.base_ref = value.base_ref;
  }
  if (!copyOptionalPublicRef(value, candidate, 'public_source_ref')) return null;
  return candidate;
}
function normalizePullRequest(item) {
  if (!isRecord(item) || !isIssue(item.number) || !isSafeLabel(item.state || '') || !hasOwn(item, 'merged') || typeof item.merged !== 'boolean') return null;
  const result = { number: item.number, state: item.state, merged: item.merged };
  for (const key of ['head', 'tree', 'base']) if (!copyOptionalSha(item, result, key)) return null;
  if (hasOwn(item, 'base_ref') && !isSafeLabel(item.base_ref)) return null;
  if (hasOwn(item, 'base_ref')) result.base_ref = item.base_ref;
  if (!copyOptionalSafeId(item, result, 'identity')) return null;
  if (!copyOptionalPublicRef(item, result, 'public_source_ref')) return null;
  if (!copyOptionalIssue(item, result, 'linked_child')) return null;
  if (!copyOptionalSafeIdArray(item, result, 'linked_deferred_findings')) return null;
  return result;
}
function normalizeSubmittedReview(item) {
  if (!isRecord(item) || !isSafeId(item.id) || !isIssue(item.pr_number) || !isSafeLabel(item.state || '')) return null;
  const result = { id: item.id, pr_number: item.pr_number, state: item.state };
  if (!copyOptionalSafeId(item, result, 'identity')) return null;
  if (!copyOptionalPublicRef(item, result, 'public_source_ref')) return null;
  if (!copyOptionalPathLine(item, result)) return null;
  for (const key of ['resolved', 'outdated', 'closing_reply']) if (!copyOptionalBoolean(item, result, key)) return null;
  if (!copyOptionalSafeIdArray(item, result, 'linked_deferred_findings')) return null;
  return result;
}
function normalizeInlineConversation(item) {
  if (!isRecord(item) || !isSafeId(item.id) || !isIssue(item.pr_number)
    || !hasOwn(item, 'resolved') || typeof item.resolved !== 'boolean'
    || !hasOwn(item, 'outdated') || typeof item.outdated !== 'boolean'
    || !hasOwn(item, 'closing_reply') || typeof item.closing_reply !== 'boolean') return null;
  const result = {
    id: item.id,
    pr_number: item.pr_number,
    resolved: item.resolved,
    outdated: item.outdated,
    closing_reply: item.closing_reply,
  };
  if (!copyOptionalPublicRef(item, result, 'public_source_ref')) return null;
  if (!copyOptionalPathLine(item, result)) return null;
  if (!copyOptionalIssue(item, result, 'linked_child')) return null;
  if (!copyOptionalSafeIdArray(item, result, 'linked_deferred_findings')) return null;
  return result;
}
function normalizeFindingEvidence(input = {}) {
  if (!isRecord(input) || !isSafeId(input.id) || !isSafeLabel(input.component || '') || !publicSafeText(input.text || '')) return null;
  const provenance = input.provenance;
  if (!isRecord(provenance) || !isIssue(provenance.source_pr) || !isSafeId(provenance.source_thread)) return null;
  const source_candidate = normalizeCandidate(provenance.source_candidate);
  if (!source_candidate || source_candidate.pr_number !== provenance.source_pr) return null;
  const path = provenance.path === undefined ? null : provenance.path;
  const line = provenance.line === undefined ? null : provenance.line;
  if (path !== null && !isSafeReviewPath(path)) return null;
  if (line !== null && (!Number.isSafeInteger(line) || line < 1)) return null;
  if (provenance.public_source_ref !== undefined && provenance.public_source_ref !== null && !isSafePublicRef(provenance.public_source_ref)) return null;
  const predicates = isRecord(input.predicates)
    ? Object.fromEntries(A4_MATERIAL_PREDICATES.map((key) => [key, input.predicates[key] === true]))
    : null;
  const exclusions = Array.isArray(input.exclusions) && input.exclusions.every((item) => A4_EXCLUSIONS.includes(item))
    ? [...new Set(input.exclusions)]
    : null;
  if (!predicates || !exclusions) return null;
  const derivedMateriality = evaluateMateriality({ predicates, exclusions }).material ? 'material' : 'nonblocking';
  if (hasOwn(input, 'materiality') && input.materiality !== derivedMateriality) return null;
  const result = {
    id: input.id,
    provenance: {
      source_pr: provenance.source_pr,
      source_thread: provenance.source_thread,
      source_candidate,
      path,
      line,
      evidence_digest: null,
      ...(provenance.public_source_ref === undefined ? {} : { public_source_ref: provenance.public_source_ref }),
    },
    component: input.component,
    text: input.text,
    evidence_digest: null,
    predicates,
    exclusions,
    materiality: derivedMateriality,
  };
  const computedDigest = findingEvidenceDigest(result);
  if ((hasOwn(input, 'evidence_digest') && input.evidence_digest !== null && input.evidence_digest !== computedDigest)
    || (hasOwn(provenance, 'evidence_digest') && provenance.evidence_digest !== null && provenance.evidence_digest !== computedDigest)) return null;
  result.evidence_digest = computedDigest;
  result.provenance.evidence_digest = computedDigest;
  if (input.recommended_disposition !== undefined) {
    if (!isSafeLabel(input.recommended_disposition)) return null;
    result.recommended_disposition = input.recommended_disposition;
  }
  return result;
}
function projectA4Review(inventory) {
  if (!isRecord(inventory)
    || inventory.complete !== true
    || inventory.server_authoritative !== true
    || inventory.verifiable !== true
    || !isDigest(inventory.inventory_digest)
    || !Array.isArray(inventory.finding_evidence)
    || !Array.isArray(inventory.pull_requests)
    || !Array.isArray(inventory.submitted_reviews)
    || !Array.isArray(inventory.inline_conversations)) {
    return failure('N5_REVIEW_INVENTORY_INCOMPLETE');
  }
  const findings = inventory.finding_evidence.map((finding) => ({
    id: finding.id,
    ...finding.predicates,
    ...Object.fromEntries(A4_EXCLUSIONS.map((key) => [key, finding.exclusions.includes(key)])),
  }));
  return {
    current: true,
    complete: true,
    server_authoritative: true,
    verifiable: true,
    inventory_digest: inventory.inventory_digest,
    findings,
  };
}
function buildReviewInventory(input = {}) {
  const rawArrays = ['pull_requests', 'submitted_reviews', 'inline_conversations'].map((key) => Array.isArray(input[key]) ? input[key] : null);
  const normalizedPullRequests = rawArrays[0] ? rawArrays[0].map(normalizePullRequest) : [];
  const normalizedSubmitted = rawArrays[1] ? rawArrays[1].map(normalizeSubmittedReview) : [];
  const normalizedInline = rawArrays[2] ? rawArrays[2].map(normalizeInlineConversation) : [];
  const arraysValid = rawArrays.every((value) => Array.isArray(value))
    && normalizedPullRequests.every((value) => value !== null)
    && normalizedSubmitted.every((value) => value !== null)
    && normalizedInline.every((value) => value !== null);
  const pullRequests = normalizedPullRequests.filter((value) => value !== null);
  const submitted = normalizedSubmitted.filter((value) => value !== null);
  const inline = normalizedInline.filter((value) => value !== null);
  const pages = isRecord(input.pagination) ? input.pagination : {};
  const pagination = {
    pull_requests: pages.pull_requests === true,
    submitted_reviews: pages.submitted_reviews === true,
    inline_conversations: pages.inline_conversations === true,
  };
  const paginationComplete = Object.values(pagination).every((value) => value === true);
  const server_authoritative = input.server_authoritative === true;
  const evidence_verifiable = input.verifiable === true;
  const staleOrUnavailable = input.stale === true
    || input.unavailable === true
    || input.evidence_status === 'stale'
    || input.evidence_status === 'unavailable';
  const candidatePresent = hasOwn(input, 'current_candidate');
  const expectedPresent = hasOwn(input, 'expected_candidate');
  const candidate = candidatePresent ? normalizeCandidate(input.current_candidate) : null;
  const expectedCandidate = expectedPresent ? normalizeCandidate(input.expected_candidate) : null;
  const representedPr = candidate === null ? null : pullRequests.find((item) => item.number === candidate.pr_number) || null;
  const representedExact = representedPr !== null && ['head', 'tree', 'base'].every((key) => isSha(representedPr[key]) && representedPr[key] === candidate[key]);
  const candidateValid = candidatePresent
    && expectedPresent
    && candidate !== null
    && expectedCandidate !== null
    && canonicalJson(candidate) === canonicalJson(expectedCandidate)
    && representedExact;
  const rawFindings = input.findings === undefined ? [] : input.findings;
  const normalizedFindingEvidence = Array.isArray(rawFindings) ? rawFindings.map(normalizeFindingEvidence) : [];
  const findingsValid = Array.isArray(rawFindings) && normalizedFindingEvidence.every((value) => value !== null);
  const findingEvidence = normalizedFindingEvidence.filter((value) => value !== null);
  const inventoryBase = {
    version: REVIEW_INVENTORY_VERSION,
    candidate,
    expected_candidate: expectedCandidate,
    pagination,
    pull_requests: pullRequests,
    submitted_reviews: submitted,
    inline_conversations: inline,
    finding_evidence: findingEvidence,
    server_authoritative,
    verifiable: evidence_verifiable && !staleOrUnavailable,
  };
  const complete = arraysValid
    && findingsValid
    && server_authoritative
    && evidence_verifiable
    && !staleOrUnavailable
    && paginationComplete
    && candidateValid;
  const inventory_digest = sha256(inventoryBase);
  const inventory = { ...inventoryBase, complete, inventory_digest };
  const review = complete
    ? projectA4Review(inventory)
    : {
      current: false,
      complete: false,
      server_authoritative,
      verifiable: false,
      inventory_digest,
      findings: [],
    };
  return complete
    ? success('N5_INSPECTION_READY', { inventory, review })
    : failure('N5_REVIEW_INVENTORY_INCOMPLETE', { inventory, review });
}
function evaluateMateriality(input = {}) {
  const predicates = isRecord(input.predicates) ? input.predicates : {};
  const exclusions = Array.isArray(input.exclusions) ? input.exclusions.filter((item) => A4_EXCLUSIONS.includes(item)) : [];
  const material = A4_MATERIAL_PREDICATES.every((key) => predicates[key] === true) && exclusions.length === 0;
  return { material, material_blocker: material, predicates: Object.fromEntries(A4_MATERIAL_PREDICATES.map((key) => [key, predicates[key] === true])), exclusions, executor_recommendation: input.executor_recommendation || null, final_disposition: null };
}
function classifyFinding(input = {}) {
  const source_pr = hasOwn(input, 'source_pr') ? input.source_pr : input.pr_number;
  const source_thread = hasOwn(input, 'source_thread') ? input.source_thread : input.thread_id;
  const source_candidate = hasOwn(input, 'source_candidate')
    ? input.source_candidate
    : (hasOwn(input, 'candidate') ? input.candidate : input.current_candidate);
  const path = input.path === undefined ? null : input.path;
  const line = input.line === undefined ? null : input.line;
  if (!isPublicSafeEvidence({ text: input.text, path, component: input.component, public_source_ref: input.public_source_ref }) || !publicSafeText(input.text || '')) return failure('N5_SECRET_OR_PRIVATE_DATA_REJECTED');
  if (!isSafeId(input.id)
    || !isIssue(source_pr)
    || !isSafeId(source_thread)
    || !normalizeCandidate(source_candidate)
    || !isSafeLabel(input.component)
    || (path !== null && !isSafeReviewPath(path))
    || (line !== null && (!Number.isSafeInteger(line) || line < 1))
    || (input.public_source_ref !== undefined && input.public_source_ref !== null && !isSafePublicRef(input.public_source_ref))) {
    return failure('N5_GOVERNANCE_UNREADY');
  }
  const candidate = normalizeCandidate(source_candidate);
  if (candidate.pr_number !== source_pr) return failure('N5_GOVERNANCE_UNREADY');
  const materiality = evaluateMateriality(input);
  const finding = {
    id: input.id,
    provenance: {
      source_pr,
      source_thread,
      source_candidate: candidate,
      path,
      line,
       evidence_digest: hasOwn(input, 'evidence_digest') ? input.evidence_digest : null,
      ...(input.public_source_ref === undefined ? {} : { public_source_ref: input.public_source_ref }),
    },
    component: input.component,
    text: input.text,
    evidence_digest: hasOwn(input, 'evidence_digest') ? input.evidence_digest : null,
    predicates: materiality.predicates,
    exclusions: materiality.exclusions,
    materiality: materiality.material ? 'material' : 'nonblocking',
    recommended_disposition: materiality.material ? 'valid and still unresolved' : 'deferred',
  };
  const normalized = normalizeFindingEvidence(finding);
  return normalized ? success('N5_INSPECTION_READY', { finding: normalized }) : failure('N5_GOVERNANCE_UNREADY');
}
function authorizeReviewMutation(input = {}) { return failure('N5_REVIEW_MUTATION_DENIED', { actor: input.actor || 'unknown', action: input.action || 'unknown' }); }
function resolveFinding(input = {}) {
  if (!REVIEW_DISPOSITIONS.includes(input.controller_disposition) || input.closing_reply_factual !== true || input.evidence_backed_completion !== true || input.exact_head !== true || input.canonical !== true || input.validation !== true || input.readback !== true || !isSafeId(input.controlling_reference) || input.resolved !== true) return failure('N5_REVIEW_DISPOSITION_INCOMPLETE');
  return success('N5_REVIEW_DISPOSITION_COMPLETE', { disposition: input.controller_disposition, controller_only: true });
}
function validateDeferredFindingRecord(record) {
  const allowed = new Set([
    'df_id', 'finding_id', 'source_pr', 'source_thread', 'source_head', 'source_candidate',
    'text', 'path', 'line', 'supplied_severity', 'component', 'public_source_ref', 'root_digest', 'evidence_digest',
    'predicates', 'exclusions', 'materiality',
    'reason_nonblocking', 'triggers', 'disposition', 'linked_child',
  ]);
  if (!isRecord(record) || Object.keys(record).some((key) => !allowed.has(key))
    || !isSafeId(record.df_id)
    || !isSafeId(record.finding_id)
    || !isIssue(record.source_pr)
    || !isSafeId(record.source_thread)
    || !isSha(record.source_head)
    || !isDigest(record.evidence_digest)
    || !isDigest(record.root_digest)
    || !isSafeLabel(record.component || '')
    || !DF_DISPOSITIONS.includes(record.disposition)
    || !Array.isArray(record.triggers)
    || new Set(record.triggers).size !== record.triggers.length
    || !DF_TRIGGERS.every((trigger) => record.triggers.includes(trigger))
    || !(record.linked_child === null || isIssue(record.linked_child))
    || !hasOwn(record, 'path')
    || !hasOwn(record, 'line')
    || !hasOwn(record, 'public_source_ref')
    || !hasOwn(record, 'predicates')
    || !hasOwn(record, 'exclusions')
    || record.materiality !== 'nonblocking'
    || !publicSafeText(record.text)) {
    return failure('N5_DF_AMBIGUOUS');
  }
  const candidate = normalizeCandidate(record.source_candidate);
  if (!candidate || candidate.pr_number !== record.source_pr || candidate.head !== record.source_head) return failure('N5_DF_AMBIGUOUS');
  if (record.path !== null && !isSafeReviewPath(record.path)) return failure('N5_DF_AMBIGUOUS');
  if (record.line !== null && (!Number.isSafeInteger(record.line) || record.line < 1)) return failure('N5_DF_AMBIGUOUS');
  if (record.public_source_ref !== null && !isSafePublicRef(record.public_source_ref)) return failure('N5_DF_AMBIGUOUS');
  if (record.supplied_severity !== null && !isSafeLabel(record.supplied_severity)) return failure('N5_DF_AMBIGUOUS');
  if (!publicSafeText(record.reason_nonblocking)) return failure('N5_DF_AMBIGUOUS');
  const finding = normalizeFindingEvidence({
    id: record.finding_id,
    provenance: {
      source_pr: record.source_pr,
      source_thread: record.source_thread,
      source_candidate: candidate,
      path: record.path,
      line: record.line,
      public_source_ref: record.public_source_ref,
      evidence_digest: record.evidence_digest,
    },
    component: record.component,
    text: record.text,
    predicates: record.predicates,
    exclusions: record.exclusions,
    materiality: record.materiality,
    evidence_digest: record.evidence_digest,
  });
  if (!finding) return failure('N5_DF_AMBIGUOUS');
  const computedEvidence = findingEvidenceDigest(finding);
  if (computedEvidence !== record.evidence_digest || deferredRootDigest(finding) !== record.root_digest) return failure('N5_DF_AMBIGUOUS');
  return success('N5_VALID', { record, finding, evidence_digest: computedEvidence, root_digest: record.root_digest });
}
function registerDeferredFinding(input = {}) {
  const sourceFinding = input.finding || {};
  const parent = clone(input.parent || {});
  const finding = normalizeFindingEvidence(sourceFinding);
  if (!finding || finding.materiality === 'material') return failure('N5_DF_AMBIGUOUS');
  const triggers = Array.isArray(input.triggers) ? input.triggers : [];
  if (triggers.length !== DF_TRIGGERS.length || !DF_TRIGGERS.every((trigger) => triggers.includes(trigger))) return failure('N5_DF_AMBIGUOUS');
  if (!Array.isArray(parent.deferred_findings)) parent.deferred_findings = [];
  const dfId = isSafeId(sourceFinding.df_id) ? sourceFinding.df_id : 'df-' + sha256({ id: finding.id, component: finding.component }).slice(0, 12);
  if (!isSafeId(dfId) || parent.deferred_findings.some((item) => item.df_id === dfId)) return failure('N5_DF_AMBIGUOUS');
  const provenance = finding.provenance;
  const rootDigest = deferredRootDigest(finding);
  if (hasOwn(sourceFinding, 'root_digest') && sourceFinding.root_digest !== rootDigest) return failure('N5_DF_AMBIGUOUS');
  const reason = sourceFinding.reason_nonblocking || 'A4 materiality predicates are not all satisfied.';
  if (!publicSafeText(reason)) return failure('N5_DF_AMBIGUOUS');
  const record = {
    df_id: dfId,
    finding_id: finding.id,
    source_pr: provenance.source_pr,
    source_thread: provenance.source_thread,
    source_head: provenance.source_candidate.head,
    source_candidate: provenance.source_candidate,
    text: finding.text,
    path: provenance.path === undefined ? null : provenance.path,
    line: provenance.line === undefined ? null : provenance.line,
    public_source_ref: provenance.public_source_ref ?? null,
    supplied_severity: sourceFinding.supplied_severity || null,
    component: finding.component,
    predicates: finding.predicates,
    exclusions: finding.exclusions,
    materiality: finding.materiality,
    root_digest: rootDigest,
    evidence_digest: finding.evidence_digest,
    reason_nonblocking: reason,
    triggers: [...triggers],
    disposition: 'DEFERRED_REVALIDATE',
    linked_child: null,
  };
  const valid = validateDeferredFindingRecord(record);
  if (!valid.ok) return valid;
  parent.deferred_findings.push(record);
  return success('N5_DF_REGISTERED', { parent, record });
}
function revalidateDeferredFinding(input = {}) {
  const initial = validateDeferredFindingRecord(clone(input.record || {}));
  if (!initial.ok) return initial;
  const record = clone(initial.record);
  record.linked_child = null;
  if (input.material !== true) {
    const disposition = input.disposition || 'DISPOSED_NONMATERIAL';
    if (!['SATISFIED', 'SUPERSEDED', 'OBSOLETE', 'DISPOSED_NONMATERIAL'].includes(disposition)) return failure('N5_DF_AMBIGUOUS');
    record.disposition = disposition;
    const valid = validateDeferredFindingRecord(record);
    return valid.ok ? success('N5_VALID', { record }) : valid;
  }
  const child = input.compatible_child;
  if (child !== undefined && child !== null) {
    if (!isRecord(child) || !isIssue(child.issue_number)) return failure('N5_DF_AMBIGUOUS');
    if (child.direct !== true || child.compatible !== true || child.frozen === true || child.lifecycle === 'current') {
      return failure('N5_AUTHORITY_REQUIRED', { record, promotion: 'scope_decision_required' });
    }
    record.disposition = 'PROMOTED_TO_EXISTING_CHILD';
    record.linked_child = child.issue_number;
    const valid = validateDeferredFindingRecord(record);
    return valid.ok ? success('N5_VALID', { record }) : valid;
  }
  const sibling = input.authorised_new_sibling;
  if (!isRecord(sibling)
    || sibling.controller_authorised !== true
    || sibling.direct !== true
    || sibling.compatible !== true
    || !isIssue(sibling.issue_number)) {
    return failure('N5_AUTHORITY_REQUIRED', { record, promotion: 'controller_authorised_direct_sibling_required' });
  }
  record.disposition = 'PROMOTED_TO_CHILD';
  record.linked_child = sibling.issue_number;
  const valid = validateDeferredFindingRecord(record);
  return valid.ok ? success('N5_VALID', { record }) : valid;
}
function codexReviewState(input = {}) { return { state: input.owner_disabled === true ? 'disabled' : 'enabled', owner_disabled: input.owner_disabled === true, probe: input.probe || null, silence_is_not_disabled: true }; }
function autoCodeReadiness(input = {}) {
  const base = { mutation_attempted: false, install_attempted: false, schedule_attempted: false, worker_claimed: false, finality_authority: false };
  return input.governance === 'enabled' && input.tracker_valid === true && input.review_inventory_complete === true ? success('N5_INSPECTION_READY', { ...base, governance: 'enabled', ready: true }) : failure('AUTO_CODE_GOVERNANCE_UNREADY', base);
}
function adjudicateHistoricalPr310(evidence = {}) {
  const required = ['historical_closed_unmerged', 'current_main_search_complete', 'workflow_inventory_surface_absent', 'caller_token_cache_surface_absent', 'n5_scope_has_no_historical_symbols'];
  if (!required.every((key) => evidence[key] === true) || evidence.merge_commit !== null) return failure('N5_SCOPE_REJECTED');
  return { ok: true, disposition: 'NO_LONGER_APPLICABLE', scope: 'N5', owner: 'controller-only', evidence: { ...evidence, exact_evidence_required: required } };
}
function rejectHistoricalRevival(symbol) { return failure('N5_SCOPE_REJECTED', { historical_symbol: isSafeId(symbol) ? symbol : 'opaque' }); }
function nextAction(code) { return { next_action: code === 'N5_RECONCILED' ? 'READY_FOR_WEB_EXACT_HEAD_VALIDATION' : 'CONTROLLER_REQUIRED' }; }

function createRuntime(options = {}) {
  const injectedOwners = options.transaction_owner instanceof Map ? options.transaction_owner : null;
  const state = { repository: options.repository, cwd: options.cwd || process.cwd(), authority_broker: options.authority_broker, a2: options.a2 || canonicalA2, github: options.github, owners: sharedTransactionOwners, injectedOwners, ...(hasOwn(options, 'repository_id') ? { repository_id: options.repository_id } : {}), ...(hasOwn(options, 'repository_identity') ? { repository_identity: options.repository_identity } : {}) };
  function acquireOwner(key) {
    if (state.owners.has(key) || state.injectedOwners?.has(key)) return null;
    const token = Symbol(key);
    state.owners.set(key, token);
    if (state.injectedOwners) state.injectedOwners.set(key, token);
    return token;
  }
  function releaseOwner(key, token) {
    if (state.owners.get(key) === token) state.owners.delete(key);
    if (state.injectedOwners?.get(key) === token) state.injectedOwners.delete(key);
  }
  function inspect(input = {}) {
    const parsed = parseManagedBlock(input.body, input.kind || 'parent', { complete: input.complete !== false });
    return parsed.ok ? success('N5_INSPECTION_READY', { projection: boundedProjection(parsed.state, parsed) }) : parsed;
  }
  function validate(input = {}) {
    const parsed = parseManagedBlock(input.body, input.kind || 'parent', { complete: input.complete !== false });
    return parsed.ok ? success('N5_VALID', { body_digest: parsed.body_digest, managed_digest: parsed.managed_digest, state: parsed.state }) : parsed;
  }
  function show(input = {}) { const inspected = inspect(input); return inspected.ok ? success('N5_SHOW_READY', { projection: inspected.projection }) : inspected; }
  function preview(input = {}) {
    const parsed = parseManagedBlock(input.body, input.kind || 'parent', { complete: input.complete !== false });
    if (!parsed.ok) return parsed;
    const applied = applyBoundedUpdate(parsed.state, input.target || {}, input.update || {});
    if (!applied.ok) return applied;
    return success('N5_PREVIEW_READY', { before: boundedProjection(parsed.state, parsed), after: boundedProjection(applied.state), changed: applied.changed, transition_id: sha256({ repository: parsed.state.repository, before: parsed.body_digest, after: applied.state }) });
  }
  function reconcile(input = {}) {
    if (hasOwn(input, 'intent') && input.intent !== 'reconcile') return failure('N5_SCOPE_REJECTED');
    const auth = authorizeMutation(input, state);
    if (!auth.ok) return auth;
    const key = `${input.repository}+${input.parent_issue}`;
    const token = acquireOwner(key); if (!token) return failure('PARENT_CONCURRENCY_CONFLICT');
    try {
      const first = fetchParent(state.github, input);
      if (!first.ok) return first;
      const parsed = parseManagedBlock(first.fetched.body, 'parent', { complete: first.fetched.complete !== false });
      if (!parsed.ok) return parsed;
      if (parsed.state.repository !== input.repository || parsed.state.parent_issue !== input.parent_issue) return failure('N5_REPOSITORY_IDENTITY_MISMATCH');
      const applied = applyBoundedUpdate(parsed.state, auth.mutation_scope.target, auth.mutation_scope.update);
      if (!applied.ok) return applied;
      if (!applied.changed) return success('N5_NOOP', { projection: boundedProjection(parsed.state, parsed), transition_id: sha256({ repository: input.repository, parent_issue: input.parent_issue, before: parsed.body_digest }) });
      let sourceBody = first.fetched.body;
      let sourceBinding = first.binding;
      let nextState = applied.state;
      let replaced = replaceManagedBlock(sourceBody, 'parent', nextState, { expected_body_digest: sourceBinding.body_digest });
      if (!replaced.ok) return replaced;
      let limit = classifyBodyLimit(replaced.body, input.verified_limit || input.transport_limit);
      let compactionAttempted = false;
      if (limit.known && limit.code === 'PARENT_BODY_LIMIT') {
        if (input.allow_compaction !== true) return limit;
        compactionAttempted = true;
        const fresh = fetchParent(state.github, input);
        if (!fresh.ok) return fresh;
        if (moved(sourceBinding, fresh.binding)) return failure('PARENT_CONCURRENCY_CONFLICT');
        const freshParsed = parseManagedBlock(fresh.fetched.body, 'parent', { complete: fresh.fetched.complete !== false });
        if (!freshParsed.ok) return freshParsed;
        const freshApplied = applyBoundedUpdate(freshParsed.state, auth.mutation_scope.target, auth.mutation_scope.update);
        if (!freshApplied.ok) return freshApplied;
        const compacted = compactTerminal(freshApplied.state, { durable_evidence: input.durable_evidence, evidence_adapter: input.evidence_adapter || state.github });
        if (!compacted.ok) return compacted;
        sourceBody = fresh.fetched.body;
        sourceBinding = fresh.binding;
        nextState = compacted.state;
        replaced = replaceManagedBlock(sourceBody, 'parent', nextState, { expected_body_digest: sourceBinding.body_digest });
        if (!replaced.ok) return replaced;
        limit = classifyBodyLimit(replaced.body, input.verified_limit || input.transport_limit);
        if (limit.known && limit.code === 'PARENT_BODY_LIMIT') return { ...limit, compaction_attempted: true };
      }
      const preWrite = fetchParent(state.github, input);
      if (!preWrite.ok) return preWrite;
      if (moved(sourceBinding, preWrite.binding)) return failure('PARENT_CONCURRENCY_CONFLICT');
      if (typeof state.github?.updateParent !== 'function') return failure('PARENT_RECONCILIATION_INCOMPLETE');
      try { state.github.updateParent({ repository: input.repository, parent_issue: input.parent_issue, body: replaced.body, revision: preWrite.fetched.revision || null }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
      const readback = fetchParent(state.github, input);
      if (!readback.ok) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const readbackParsed = parseManagedBlock(readback.fetched.body, 'parent', { complete: readback.fetched.complete !== false });
      if (!readbackParsed.ok || canonicalJson(readbackParsed.state) !== canonicalJson(nextState)) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const expectedOutside = splitManagedBlock(sourceBody, 'parent');
      const actualOutside = splitManagedBlock(readback.fetched.body, 'parent');
      if (!expectedOutside || !actualOutside || expectedOutside.prefix !== actualOutside.prefix || expectedOutside.suffix !== actualOutside.suffix) return failure('PARENT_BYTE_DRIFT');
      if (typeof state.github.reconcileRelated === 'function') {
        let related;
        try { related = state.github.reconcileRelated({ repository: input.repository, parent_issue: input.parent_issue, transition_id: sha256({ before: sourceBinding.body_digest, after: readbackParsed.body_digest }) }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
        if (!related || related.ok !== true) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      }
      return success('N5_RECONCILED', { transition_id: sha256({ repository: input.repository, parent_issue: input.parent_issue, before: sourceBinding.body_digest, after: readbackParsed.body_digest }), readback: { target_state: readbackParsed.state, outside_bytes_preserved: true, body_digest: readbackParsed.body_digest, managed_digest: readbackParsed.managed_digest, compaction_attempted: compactionAttempted } });
    } finally { releaseOwner(key, token); }
  }
  function remove(input = {}) {
    const auth = authorizeMutation({ ...input, intent: 'remove' }, state);
    if (!auth.ok) return auth;
    const key = `${input.repository}+${input.parent_issue}`;
    const token = acquireOwner(key); if (!token) return failure('PARENT_CONCURRENCY_CONFLICT');
    try {
      const first = fetchParent(state.github, input);
      if (!first.ok) return first;
      const parsed = parseManagedBlock(first.fetched.body, 'parent', { complete: first.fetched.complete !== false });
      if (!parsed.ok) return parsed;
      if (parsed.state.repository !== input.repository || parsed.state.parent_issue !== input.parent_issue) return failure('N5_REPOSITORY_IDENTITY_MISMATCH');
      const target = auth.mutation_scope.target;
      if (target.body_digest !== parsed.body_digest || target.managed_digest !== parsed.managed_digest) return failure('N5_SCOPE_REJECTED');
      const sourceBinding = first.binding;
      const expectedOutside = parsed.prefix + parsed.suffix;
      const nextBody = expectedOutside;
      const preWrite = fetchParent(state.github, input);
      if (!preWrite.ok) return preWrite;
      if (moved(sourceBinding, preWrite.binding)) return failure('PARENT_CONCURRENCY_CONFLICT');
      const preWriteParsed = parseManagedBlock(preWrite.fetched.body, 'parent', { complete: preWrite.fetched.complete !== false });
      if (!preWriteParsed.ok || preWriteParsed.body_digest !== target.body_digest || preWriteParsed.managed_digest !== target.managed_digest) return failure('PARENT_CONCURRENCY_CONFLICT');
      if (typeof state.github?.updateParent !== 'function') return failure('PARENT_RECONCILIATION_INCOMPLETE');
      try { state.github.updateParent({ repository: input.repository, parent_issue: input.parent_issue, body: nextBody, revision: preWrite.fetched.revision || null }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
      const readback = fetchParent(state.github, input);
      if (!readback.ok || readback.fetched.body !== nextBody || readback.fetched.body !== expectedOutside) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const relatedCapability = state.github?.reconcileRelated;
      if (relatedCapability !== undefined && relatedCapability !== null) {
        if (typeof relatedCapability !== 'function') return failure('PARENT_RECONCILIATION_INCOMPLETE');
        let related;
        try { related = state.github.reconcileRelated({ repository: input.repository, parent_issue: input.parent_issue, transition_id: sha256({ before: sourceBinding.body_digest, after: readback.binding.body_digest }) }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
        if (!related || related.ok !== true) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      }
      const transitionId = sha256({ repository: input.repository, parent_issue: input.parent_issue, before: sourceBinding.body_digest, after: readback.binding.body_digest });
      return success('N5_REMOVED', { outside_bytes_preserved: true, transition_id: transitionId, readback: { body_digest: readback.binding.body_digest, outside_bytes_preserved: true, managed_block_removed: true } });
    } finally { releaseOwner(key, token); }
  }
  function prepareIntent(input, intent) {
    if (!isRecord(input) || (hasOwn(input, 'intent') && input.intent !== intent)) return failure('N5_SCOPE_REJECTED');
    const next = { ...input, intent };
    const desired = input.desired_state === undefined ? input.state : input.desired_state;
    if (intent === 'initialise') {
      if (next.target === undefined) next.target = { kind: MUTATION_TARGET_KINDS.managed_parent_block, mode: 'create' };
      if (next.update === undefined) next.update = { type: 'set_parent_state', state: desired };
    } else {
      const suppliedTarget = isRecord(next.target) ? next.target : {};
      if (next.target === undefined) {
        next.target = {
          kind: MUTATION_TARGET_KINDS.legacy_parent_block,
          source_version: next.source_version === undefined ? suppliedTarget.source_version : next.source_version,
          source_body_digest: next.source_body_digest === undefined ? suppliedTarget.source_body_digest : next.source_body_digest,
        };
      }
      if (next.update === undefined) next.update = { type: 'set_parent_state', state: desired };
    }
    return success('N5_VALID', { input: next });
  }
  function relatedAfterWrite(input, beforeDigest, afterDigest) {
    const capability = state.github?.reconcileRelated;
    if (capability === undefined || capability === null) return true;
    if (typeof capability !== 'function') return false;
    try {
      const result = capability({ repository: input.repository, parent_issue: input.parent_issue, transition_id: sha256({ before: beforeDigest, after: afterDigest }) });
      return result?.ok === true;
    } catch (_error) {
      return false;
    }
  }
  function initialise(input = {}) {
    const prepared = prepareIntent(input, 'initialise');
    if (!prepared.ok) return prepared;
    const request = prepared.input;
    const auth = authorizeMutation(request, state);
    if (!auth.ok) return auth;
    const key = request.repository + '+' + request.parent_issue;
    const token = acquireOwner(key);
    if (!token) return failure('PARENT_CONCURRENCY_CONFLICT');
    try {
      const first = fetchParent(state.github, request);
      if (!first.ok) return first;
      const residue = RESOURCE_KINDS.some((kind) => first.fetched.body.includes(MANAGED_MARKERS[kind].begin) || first.fetched.body.includes(MANAGED_MARKERS[kind].end))
        || first.fetched.body.includes(STATE_MARKERS.begin) || first.fetched.body.includes(STATE_MARKERS.end);
      if (residue) {
        const existing = parseManagedBlock(first.fetched.body, 'parent', { complete: first.fetched.complete !== false });
        if (!existing.ok) return existing;
        if (canonicalJson(existing.state) === canonicalJson(auth.mutation_scope.update.state)) return success('N5_NOOP', { projection: boundedProjection(existing.state, existing), transition_id: sha256({ repository: request.repository, parent_issue: request.parent_issue, before: existing.body_digest }) });
        return failure('N5_SCOPE_REJECTED');
      }
      const legacy = parseLegacyParent(first.fetched.body, { complete: first.fetched.complete !== false });
      if (legacy.ok || legacy.legacy === true) return failure('N5_SCOPE_REJECTED', { migration_required: true, source_version: legacy.source_version || LEGACY_V0_VERSION, source_body_digest: legacy.body_digest || sha256(first.fetched.body) });
      if (legacyAuthorityResidue(first.fetched.body)) return failure('PARENT_PARSE_UNCERTAIN');
      const rendered = renderManagedBlock('parent', auth.mutation_scope.update.state);
      const separator = first.fetched.body.length === 0 || first.fetched.body.endsWith('\n') ? '' : '\n';
      const nextBody = first.fetched.body + separator + rendered;
      const preWrite = fetchParent(state.github, request);
      if (!preWrite.ok || moved(first.binding, preWrite.binding)) return failure('PARENT_CONCURRENCY_CONFLICT');
      if (typeof state.github?.updateParent !== 'function') return failure('PARENT_RECONCILIATION_INCOMPLETE');
      try { state.github.updateParent({ repository: request.repository, parent_issue: request.parent_issue, body: nextBody, revision: preWrite.fetched.revision || null }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
      const readback = fetchParent(state.github, request);
      if (!readback.ok || readback.fetched.body !== nextBody) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const parsed = parseManagedBlock(readback.fetched.body, 'parent', { complete: readback.fetched.complete !== false });
      if (!parsed.ok || canonicalJson(parsed.state) !== canonicalJson(auth.mutation_scope.update.state)) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const expectedOutside = splitManagedBlock(nextBody, 'parent');
      const actualOutside = splitManagedBlock(readback.fetched.body, 'parent');
      if (!expectedOutside || !actualOutside || expectedOutside.prefix !== actualOutside.prefix || expectedOutside.suffix !== actualOutside.suffix) return failure('PARENT_BYTE_DRIFT');
      if (!relatedAfterWrite(request, first.binding.body_digest, readback.binding.body_digest)) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      return success('N5_RECONCILED', { intent: 'initialise', transition_id: sha256({ repository: request.repository, parent_issue: request.parent_issue, before: first.binding.body_digest, after: readback.binding.body_digest }), readback: { target_state: parsed.state, outside_bytes_preserved: true, body_digest: readback.binding.body_digest, managed_digest: parsed.managed_digest, compaction_attempted: false } });
    } finally {
      releaseOwner(key, token);
    }
  }
  function migrate(input = {}) {
    const prepared = prepareIntent(input, 'migrate');
    if (!prepared.ok) return prepared;
    const request = prepared.input;
    const auth = authorizeMutation(request, state);
    if (!auth.ok) return auth;
    const key = request.repository + '+' + request.parent_issue;
    const token = acquireOwner(key);
    if (!token) return failure('PARENT_CONCURRENCY_CONFLICT');
    try {
      const first = fetchParent(state.github, request);
      if (!first.ok) return first;
      const target = auth.mutation_scope.target;
      if (first.binding.body_digest !== target.source_body_digest) return failure('N5_SCOPE_REJECTED');
      const source = target.source_version === TRACKER_VERSION
        ? parseManagedBlock(first.fetched.body, 'parent', { complete: first.fetched.complete !== false })
        : parseLegacyParent(first.fetched.body, { complete: first.fetched.complete !== false });
      if (!source.ok) return source;
      if (target.source_version === LEGACY_V0_VERSION && source.source_version !== LEGACY_V0_VERSION) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
      const desired = auth.mutation_scope.update.state;
      if (canonicalJson(source.state) !== canonicalJson(desired)) return failure('N5_SCOPE_REJECTED');
      if (target.source_version === TRACKER_VERSION) return success('N5_NOOP', { projection: boundedProjection(source.state, source), transition_id: sha256({ repository: request.repository, parent_issue: request.parent_issue, before: source.body_digest }) });
      const rendered = renderManagedBlock('parent', desired);
      const nextBody = source.prefix + rendered + source.suffix;
      const preWrite = fetchParent(state.github, request);
      if (!preWrite.ok || moved(first.binding, preWrite.binding)) return failure('PARENT_CONCURRENCY_CONFLICT');
      if (preWrite.binding.body_digest !== target.source_body_digest) return failure('PARENT_CONCURRENCY_CONFLICT');
      const preSource = parseLegacyParent(preWrite.fetched.body, { complete: preWrite.fetched.complete !== false });
      if (!preSource.ok || preSource.body_digest !== target.source_body_digest) return failure('PARENT_CONCURRENCY_CONFLICT');
      if (typeof state.github?.updateParent !== 'function') return failure('PARENT_RECONCILIATION_INCOMPLETE');
      try { state.github.updateParent({ repository: request.repository, parent_issue: request.parent_issue, body: nextBody, revision: preWrite.fetched.revision || null }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
      const readback = fetchParent(state.github, request);
      if (!readback.ok) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const parsed = parseManagedBlock(readback.fetched.body, 'parent', { complete: readback.fetched.complete !== false });
      if (!parsed.ok || canonicalJson(parsed.state) !== canonicalJson(desired)) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      const expectedOutside = splitManagedBlock(nextBody, 'parent');
      const actualOutside = splitManagedBlock(readback.fetched.body, 'parent');
      if (!expectedOutside || !actualOutside || expectedOutside.prefix !== actualOutside.prefix || expectedOutside.suffix !== actualOutside.suffix) return failure('PARENT_BYTE_DRIFT');
      if (!relatedAfterWrite(request, first.binding.body_digest, readback.binding.body_digest)) return failure('PARENT_RECONCILIATION_INCOMPLETE');
      return success('N5_RECONCILED', { intent: 'migrate', transition_id: sha256({ repository: request.repository, parent_issue: request.parent_issue, before: first.binding.body_digest, after: readback.binding.body_digest }), readback: { target_state: parsed.state, outside_bytes_preserved: true, body_digest: readback.binding.body_digest, managed_digest: parsed.managed_digest, compaction_attempted: false } });
    } finally {
      releaseOwner(key, token);
    }
  }
  return Object.freeze({ inspect, preview, initialise, migrate, validate, reconcile, show, remove, reviewInventory: buildReviewInventory, classifyFinding, registerDeferredFinding, governanceReadiness: autoCodeReadiness });
}

module.exports = Object.freeze({
  CONTRACT_VERSION, REVIEW_INVENTORY_VERSION, TRACKER_VERSION, LEGACY_V0_VERSION, DESIGN_LOCK, INTENTS, RESOURCE_KINDS, LIFECYCLES,
  OBJECTIVE_STATUSES, MUTATION_TARGET_KINDS,
  A4_MATERIAL_PREDICATES, A4_EXCLUSIONS, DF_TRIGGERS, DF_DISPOSITIONS, REVIEW_DISPOSITIONS, MANAGED_MARKERS,
  SECTION_ORDER, FAILURE_CODES, SUCCESS_CODES, RED_FIRST_CASES, canonicalJson, sha256, isDigest, isSha,
  isPublicSafeEvidence, authorityBoundary, transactionContract, renderManagedBlock, parseManagedBlock,
  replaceManagedBlock, validateTracker, boundedProjection, classifyBodyLimit, compactTerminal, applyBoundedUpdate,
  buildReviewInventory, evaluateMateriality, classifyFinding, normalizeFindingEvidence, authorizeReviewMutation, resolveFinding,
  registerDeferredFinding, validateDeferredFindingRecord, revalidateDeferredFinding, projectA4Review, codexReviewState, autoCodeReadiness, adjudicateHistoricalPr310,
  findingEvidenceDigest, deferredRootDigest, durableEvidenceDigest, normalizeDurableEvidence, parseLegacyParent, rejectHistoricalRevival, nextAction, createRuntime,
});
function representedPrNumbers(state) {
  const values = [];
  for (const section of ['current_work', 'pending_work', 'terminal', 'other_open_prs']) {
    for (const item of state[section] || []) {
      const represented = representedPrNumber(item);
      if (represented.invalid) return { invalid: true, values };
      if (represented.number !== null) values.push(represented.number);
    }
  }
  return { invalid: false, values };
}
function canonicalFindingEvidencePayload(finding) {
  const provenance = finding.provenance || {};
  return {
    version: FINDING_EVIDENCE_VERSION,
    finding_id: finding.id,
    source_pr: provenance.source_pr,
    source_thread: provenance.source_thread,
    source_candidate: provenance.source_candidate,
    path: provenance.path ?? null,
    line: provenance.line ?? null,
    public_source_ref: provenance.public_source_ref ?? null,
    component: finding.component,
    text: finding.text,
    predicates: finding.predicates,
    exclusions: finding.exclusions,
    materiality: finding.materiality,
  };
}
function findingEvidenceDigest(finding) {
  return sha256(canonicalFindingEvidencePayload(finding));
}
function deferredRootDigest(finding) {
  const provenance = finding.provenance || {};
  return sha256({
    version: 'toolkit.n5.deferred-finding-root.v1',
    component: finding.component,
    path: provenance.path ?? null,
    source_pr: provenance.source_pr,
    source_thread: provenance.source_thread,
    source_candidate: provenance.source_candidate,
    root_semantics: 'component-path-candidate-thread',
  });
}
function durableEvidencePayload(item, proof) {
  const pr = proof.pr || null;
  const accepted = proof.accepted_commit || null;
  return {
    version: TERMINAL_EVIDENCE_VERSION,
    child_id: item.child_id,
    child_issue: item.issue_number,
    disposition: proof.disposition,
    outcome: proof.outcome,
    parent_chronology_ref: proof.parent_chronology_ref,
    pr: pr === null ? null : { number: pr.number, public_source_ref: pr.public_source_ref },
    accepted_commit: accepted === null ? null : { sha: accepted.sha, public_source_ref: accepted.public_source_ref },
  };
}
function durableEvidenceDigest(item, proof) {
  return sha256(durableEvidencePayload(item, proof));
}
function terminalProofFor(item, options = {}) {
  let proof = null;
  const adapter = options.evidence_adapter || options.github || null;
  if (typeof adapter?.getTerminalEvidence === 'function') {
    try { proof = adapter.getTerminalEvidence({ item: clone(item), child_issue: item.issue_number }); } catch (_error) { proof = null; }
  }
  if (proof && proof.ok === true && isRecord(proof.evidence)) proof = proof.evidence;
  if (proof === null && options.durable_evidence !== undefined) {
    const source = options.durable_evidence;
    if (Array.isArray(source)) proof = source.find((entry) => isRecord(entry) && (entry.child_issue === item.issue_number || entry.child_id === item.child_id)) || null;
    else if (isRecord(source) && (source.child_issue === item.issue_number || source.child_id === item.child_id)) proof = source;
    else if (isRecord(source)) proof = source[item.child_id] || source[String(item.issue_number)] || null;
  }
  return proof;
}
function normalizeDurableEvidence(item, proof) {
  if (!isRecord(item) || !isRecord(proof)
    || proof.server_authoritative !== true
    || proof.verifiable !== true
    || proof.complete !== true
    || proof.child_issue !== item.issue_number
    || !isSafePublicRef(proof.parent_chronology_ref)
    || !isSafeLabel(proof.disposition || '')
    || !isSafeLabel(proof.outcome || '')) return failure('PARENT_BODY_LIMIT');
  if (item.outcome !== undefined && item.outcome !== null && proof.outcome !== item.outcome) return failure('PARENT_BODY_LIMIT');
  if (item.objective_status === 'completed' && proof.disposition !== 'accepted') return failure('PARENT_BODY_LIMIT');
  const represented = representedPrNumber(item);
  if (represented.invalid) return failure('PARENT_BODY_LIMIT');
  let pr = null;
  if (represented.number !== null) {
    if (!isRecord(proof.pr) || proof.pr.number !== represented.number || !isSafePublicRef(proof.pr.public_source_ref)) return failure('PARENT_BODY_LIMIT');
    pr = { number: proof.pr.number, public_source_ref: proof.pr.public_source_ref };
  }
  const needsCommit = item.objective_status === 'completed' || item.implementation_pr?.state === 'merged' || proof.code_delivery === true;
  let accepted_commit = null;
  if (needsCommit) {
    if (!isRecord(proof.accepted_commit) || !isSha(proof.accepted_commit.sha) || !isSafePublicRef(proof.accepted_commit.public_source_ref)) return failure('PARENT_BODY_LIMIT');
    accepted_commit = { sha: proof.accepted_commit.sha, public_source_ref: proof.accepted_commit.public_source_ref };
  }
  const normalized = {
    version: TERMINAL_EVIDENCE_VERSION,
    server_authoritative: true,
    verifiable: true,
    complete: true,
    child_id: item.child_id,
    child_issue: item.issue_number,
    disposition: proof.disposition,
    outcome: proof.outcome,
    parent_chronology_ref: proof.parent_chronology_ref,
    pr,
    accepted_commit,
  };
  const computed = durableEvidenceDigest(item, normalized);
  const supplied = proof.evidence_digest || proof.retained_evidence_digest;
  if (!isDigest(supplied) || supplied !== computed) return failure('PARENT_BODY_LIMIT');
  return success('N5_VALID', { evidence: { ...normalized, evidence_digest: computed } });
}
const LEGACY_SECTION_ORDER = Object.freeze([
  'Queue authority',
  'Current execution',
  'Active queue',
  'Completed or disposed',
  'Completion gate',
  'Governance ownership',
  'Mandatory parent reconciliation',
]);
function legacyAuthorityResidue(body) {
  if (typeof body !== 'string') return false;
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
  return headings.some((heading) => LEGACY_SECTION_ORDER.includes(heading))
    || /(?:^|\n)- (?:Legacy tracker version|Tracker version|Format version):\s*pre-n5-/.test(body);
}
function legacySectionBody(body, names, name) {
  const index = names.findIndex((entry) => entry.name === name);
  const next = index + 1 < names.length ? names[index + 1] : body.length;
  return body.slice(names[index].end, next.start === undefined ? next : next.start);
}
function parseLegacyRow(line, lifecycle) {
  const match = String(line).trim().match(/^- (?:\[[ xX]\] )?Child: ([A-Za-z0-9][A-Za-z0-9._:-]{0,127}) \| Issue: #?(\d+) \| Objective: ([^|\r\n]+?) \| PR: (none|#?\d+)(?: \| PR state: ([A-Za-z0-9._:-]+))?(?: \| Objective status: (completed|disposed))?(?: \| Outcome: ([^|\r\n]+?))?$/);
  if (!match) return null;
  const issue_number = Number(match[2]);
  if (!isIssue(issue_number) || !isSafeId(match[1]) || !publicSafeText(match[3].trim())) return null;
  const item = {
    child_id: match[1],
    issue_number,
    lifecycle,
    objective: match[3].trim(),
    blockers: [],
    next_gate: 'Legacy migration readback',
  };
  if (match[4] !== 'none') {
    const prNumber = Number(match[4].replace(/^#/, ''));
    if (!isIssue(prNumber)) return null;
    item.implementation_pr = { number: prNumber, state: match[5] || 'not_opened' };
  } else {
    item.implementation_pr = { number: 0, state: 'not_opened' };
  }
  if (lifecycle === 'terminal') {
    if (!match[6] || !match[7] || !publicSafeText(match[7].trim())) return null;
    item.objective_status = match[6];
    item.outcome = match[7].trim();
  }
  return item;
}
function parseLegacyRows(sectionText, lifecycle) {
  const rows = [];
  for (const line of String(sectionText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/(?:^|\s)Child:/i.test(line)) {
      const row = parseLegacyRow(line, lifecycle);
      if (!row) return failure('PARENT_PARSE_UNCERTAIN');
      rows.push(row);
    }
  }
  return success('N5_VALID', { rows });
}
function parseLegacyParent(body, options = {}) {
  if (options.complete === false || typeof body !== 'string' || body.includes(MANAGED_MARKERS.parent.begin) || body.includes(MANAGED_MARKERS.parent.end)) return failure('PARENT_PARSE_UNCERTAIN');
  const matches = [...body.matchAll(/^## (.+)$/gm)].map((match) => ({ name: match[1].trim(), start: match.index, end: match.index + match[0].length }));
  if (matches.length !== LEGACY_SECTION_ORDER.length) return failure('PARENT_PARSE_UNCERTAIN');
  const starts = LEGACY_SECTION_ORDER.map((name) => matches.find((entry) => entry.name === name));
  if (starts.some((entry) => !entry)) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
  const order = starts.map((entry) => entry.start);
  if (order.some((value, index) => index > 0 && value <= order[index - 1])) return failure('PARENT_PARSE_UNCERTAIN');
  const names = starts;
  const authority = legacySectionBody(body, names, 'Queue authority');
  const repositoryMatch = authority.match(/(?:^|\n)- (?:Repository|Repository identity):\s*([^\r\n]+)/i);
  const parentMatch = authority.match(/(?:^|\n)- (?:Parent issue|Parent):\s*#?(\d+)/i);
  const versionMatches = [...body.matchAll(/(?:^|\n)- (?:Legacy tracker version|Tracker version|Format version):\s*([^\r\n]+)/gi)];
  if (versionMatches.length > 1) return failure('PARENT_PARSE_UNCERTAIN');
  const repository = repositoryMatch ? repositoryMatch[1].trim() : null;
  const parent_issue = parentMatch ? Number(parentMatch[1]) : null;
  if (!isSafeLabel(repository) || !isIssue(parent_issue)) return failure('PARENT_PARSE_UNCERTAIN');
  const source_version = versionMatches.length ? versionMatches[0][1].trim() : LEGACY_V0_VERSION;
  if (![LEGACY_V0_VERSION, TRACKER_VERSION].includes(source_version)) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
  const current = parseLegacyRows(legacySectionBody(body, names, 'Current execution'), 'current');
  const pending = parseLegacyRows(legacySectionBody(body, names, 'Active queue'), 'pending');
  const terminal = parseLegacyRows(legacySectionBody(body, names, 'Completed or disposed'), 'terminal');
  if (!current.ok || !pending.ok || !terminal.ok || current.rows.length > 1) return failure('PARENT_PARSE_UNCERTAIN');
  const state = {
    kind: 'parent',
    tracker_version: TRACKER_VERSION,
    repository,
    parent_issue,
    current_work: current.rows,
    pending_work: pending.rows,
    other_open_prs: [],
    terminal: terminal.rows,
    deferred_findings: [],
    owner_detail: 'Legacy seven-section tracker migrated under strict v3 grammar.',
  };
  renumberPending(state);
  const valid = validateTracker(state);
  if (!valid.ok) return { ...valid, legacy: true, source_version, body_digest: sha256(body) };
  const start = starts[0].start;
  return success('N5_VALID', {
    state,
    source_version,
    prefix: body.slice(0, start),
    suffix: '',
    legacy: body.slice(start),
    body_digest: sha256(body),
  });
}
