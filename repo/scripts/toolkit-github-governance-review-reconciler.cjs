'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'toolkit.n5.github-governance-review-reconciler.v3';
const REVIEW_INVENTORY_VERSION = 'toolkit.n5.review-inventory.v1';
const TRACKER_VERSION = 'v3';
const DESIGN_LOCK = 'DL-N5-GITHUB-GOVERNANCE-REVIEW-RECONCILER-001-G2-R1';
const INTENTS = Object.freeze(['inspect', 'preview', 'initialise', 'migrate', 'validate', 'reconcile', 'show', 'remove']);
const RESOURCE_KINDS = Object.freeze(['parent', 'child', 'pr']);
const LIFECYCLES = Object.freeze(['pending', 'current', 'terminal']);
const A4_MATERIAL_PREDICATES = Object.freeze([
  'applies_to_current_candidate', 'identifies_accepted_requirement', 'concrete_current_failure',
  'evidence_reproducible', 'material_impact', 'in_scope_current',
]);
const A4_EXCLUSIONS = Object.freeze(['stale', 'duplicate_root', 'optional', 'speculative', 'hypothetical_future', 'cleaner_architecture_only', 'outside_scope']);
const REVIEW_DISPOSITIONS = Object.freeze(['fixed', 'already satisfied', 'incorrect assumption', 'intended design', 'superseded', 'duplicate', 'valid follow-up completed', 'valid and still unresolved', 'unable to verify']);
const DF_TRIGGERS = Object.freeze(['BEFORE_COMPONENT_WORK', 'BEFORE_PR_FINALITY', 'BEFORE_RELEVANT_OPERATIONAL_BOUNDARY', 'FINAL_PROGRAMME_AUDIT']);
const DF_DISPOSITIONS = Object.freeze(['DEFERRED_REVALIDATE', 'SATISFIED', 'SUPERSEDED', 'OBSOLETE', 'DISPOSED_NONMATERIAL']);
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
    a1: { sole_mutation_authority: true, sole_opaque_ticket_authority: true, public_ticket_mint: false, typed_operation: 'github.mutation' },
    a2: { consent_only: true, capability: 'repository.governance', widens_task_or_delegation: false, grants_review_mutation: false, grants_finality: false },
    a3: { durable_contract_count: 5, finality_authority: false, additional_contract: false },
    a4: { review_projection: 'nested-only', material_predicates: [...A4_MATERIAL_PREDICATES], web_finality_handoff: true, review_thread_mutation: false },
    n5: { authority_or_finality_token: false, generic_independent_authority_class: false, user_authority: true },
  };
}
function transactionContract() {
  return {
    fetch_complete_body: true, bind_revision: true, bind_body_digest: true, parse_deterministically: true,
    bounded_projection: true, mechanical_update: true, pre_write_rebind: true, one_write: true,
    immediate_readback: true, endpoint_cas_claim: false, serial_toolkit_owner: true, blind_retry: false,
    readback_required: true, key: 'repository+parent',
  };
}

function markerCount(text, marker) { return String(text).split(marker).length - 1; }
function headers(text) { return [...String(text).matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()); }
function parentEntries(state) {
  return [['current_work', state.current_work], ['pending_work', state.pending_work], ['terminal', state.terminal]]
    .flatMap(([section, items]) => (items || []).map((item) => ({ ...item, section })));
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
    if (entry.implementation_pr?.state === 'closed_unmerged' && entry.lifecycle === 'terminal' && entry.objective_status !== 'disposed') return failure('N5_GOVERNANCE_UNREADY');
  }
  const orders = state.pending_work.map((item) => item.queue_order);
  if (orders.some((item, index) => !Number.isSafeInteger(item) || item !== index + 1)) return failure('N5_GOVERNANCE_UNREADY');
  const prIds = [...state.current_work, ...state.other_open_prs].map((item) => item.pr_number || item.implementation_pr?.number).filter(Boolean);
  if (new Set(prIds).size !== prIds.length) return failure('N5_GOVERNANCE_UNREADY');
  for (const finding of state.deferred_findings) if (!isSafeId(finding.df_id) || state.pending_work.some((item) => item.df_id === finding.df_id)) return failure('N5_GOVERNANCE_UNREADY');
  if (typeof state.owner_detail !== 'string' || !publicSafeText(state.owner_detail)) return failure('N5_SECRET_OR_PRIVATE_DATA_REJECTED');
  return success('N5_VALID', { state });
}
function validateChild(state) {
  if (!isRecord(state) || state.kind !== 'child') return failure('N5_GOVERNANCE_UNREADY');
  if (state.tracker_version !== TRACKER_VERSION) return failure('N5_TRACKER_VERSION_UNSUPPORTED');
  if (!isSafeLabel(state.repository) || !isIssue(state.issue_number) || !LIFECYCLES.includes(state.lifecycle) || !publicSafeText(state.objective || '')) return failure('N5_GOVERNANCE_UNREADY');
  if (!Array.isArray(state.progress_checklist) || !isRecord(state.scope) || !Array.isArray(state.blockers) || typeof state.next_gate !== 'string') return failure('N5_GOVERNANCE_UNREADY');
  if (state.lifecycle === 'terminal' && state.implementation_pr?.state === 'closed_unmerged' && state.objective_status !== 'disposed') return failure('N5_GOVERNANCE_UNREADY');
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
    if (update.lifecycle === 'current') {
      if (next.current_work.length) return failure('N5_GOVERNANCE_UNREADY');
      next.current_work.push(ref.item);
    }
    if (update.lifecycle === 'pending') {
      ref.item.queue_order = next.pending_work.length + 1;
      next.pending_work.push(ref.item);
    }
    if (update.lifecycle === 'terminal') next.terminal.push(ref.item);
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
    deferred_findings: (state.deferred_findings || []).map((item) => ({ df_id: item.df_id, component: item.component, disposition: item.disposition })),
    owner_detail_digest: sha256(state.owner_detail || ''),
  };
}
function classifyBodyLimit(body, limit) {
  const bytes = Buffer.byteLength(String(body), 'utf8');
  if (!isRecord(limit) || !Number.isFinite(limit.value) || limit.value <= 0 || !['bytes', 'utf8_bytes'].includes(limit.unit) || typeof limit.provenance !== 'string' || !/^verified[-_]/i.test(limit.provenance)) return { known: false, bytes };
  if (bytes > limit.value) return failure('PARENT_BODY_LIMIT', { known: true, bytes, limit: { value: limit.value, unit: limit.unit, provenance: limit.provenance } });
  return { known: true, bytes, limit: { value: limit.value, unit: limit.unit, provenance: limit.provenance } };
}
function compactTerminal(state) {
  if (!isRecord(state) || !Array.isArray(state.terminal)) return failure('PARENT_PARSE_UNCERTAIN');
  const next = clone(state);
  next.terminal = next.terminal.map((item) => ({
    child_id: item.child_id, issue_number: item.issue_number, lifecycle: 'terminal', outcome: item.outcome || 'terminal',
    authority: item.authority || null, detail: publicSafeText(item.detail || '') ? String(item.detail).slice(0, 256) : 'Terminal detail compacted; authoritative history remains in the child record.',
  }));
  const valid = validateTracker(next);
  return valid.ok ? success('N5_VALID', { state: next, compacted: true }) : valid;
}

function a2Enabled(a2) {
  try {
    const state = typeof a2?.status === 'function' ? a2.status() : a2?.status;
    return state?.capabilities?.['repository.governance']?.state === 'enabled';
  } catch (_error) { return false; }
}
function authorizeMutation(input, options) {
  if (input.repository !== options.repository) return failure('N5_REPOSITORY_IDENTITY_MISMATCH');
  if (!a2Enabled(options.a2)) return failure('N5_CONSENT_REQUIRED');
  if (input.accepted_preview !== true) return failure('N5_AUTHORITY_REQUIRED');
  if (typeof options.a1?.authorize !== 'function') return failure('N5_AUTHORITY_REQUIRED');
  const operation = { operation_type: 'github.mutation', repository: options.repository, parent_issue: input.parent_issue, intent: input.intent || 'reconcile', target: input.target || null, update: input.update || null };
  let decision;
  try { decision = options.a1.authorize({ operation_type: 'github.mutation', operation_digest: sha256(operation), target_digest: sha256(operation.target || {}), operation }); } catch (_error) { return failure('N5_AUTHORITY_REQUIRED'); }
  if (!decision || decision.decision !== 'allow' || decision.operation_type !== 'github.mutation' || typeof decision.operation_digest !== 'string' || typeof decision.target_digest !== 'string') return failure('N5_AUTHORITY_REQUIRED');
  return success('N5_VALID', { decision });
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

function buildReviewInventory(input = {}) {
  const pullRequests = Array.isArray(input.pull_requests) ? input.pull_requests : [];
  const submitted = Array.isArray(input.submitted_reviews) ? input.submitted_reviews : [];
  const inline = Array.isArray(input.inline_conversations) ? input.inline_conversations : [];
  const pages = input.pagination || {};
  const complete = input.server_authoritative !== false && ['pull_requests', 'submitted_reviews', 'inline_conversations'].every((key) => pages[key] === true);
  const review = {
    current: input.current_candidate || null, complete, server_authoritative: input.server_authoritative !== false, verifiable: complete,
    inventory_digest: sha256({ pull_requests: pullRequests, submitted_reviews: submitted, inline_conversations: inline }), findings: [],
    pull_requests: pullRequests.map((item) => ({ number: item.number, state: item.state, merged: item.merged === true })),
    submitted_reviews: submitted.map((item) => ({ id: item.id, pr_number: item.pr_number, state: item.state })),
    inline_conversations: inline.map((item) => ({ id: item.id, pr_number: item.pr_number, resolved: item.resolved === true, outdated: item.outdated === true, closing_reply: item.closing_reply === true })),
  };
  return complete ? success('N5_INSPECTION_READY', { review }) : failure('N5_REVIEW_INVENTORY_INCOMPLETE', { review });
}
function evaluateMateriality(input = {}) {
  const predicates = isRecord(input.predicates) ? input.predicates : {};
  const exclusions = Array.isArray(input.exclusions) ? input.exclusions.filter((item) => A4_EXCLUSIONS.includes(item)) : [];
  const material = A4_MATERIAL_PREDICATES.every((key) => predicates[key] === true) && exclusions.length === 0;
  return { material, material_blocker: material, predicates: Object.fromEntries(A4_MATERIAL_PREDICATES.map((key) => [key, predicates[key] === true])), exclusions, executor_recommendation: input.executor_recommendation || null, final_disposition: null };
}
function classifyFinding(input = {}) {
  if (!isPublicSafeEvidence({ text: input.text, path: input.path, component: input.component }) || !publicSafeText(input.text || '')) return failure('N5_SECRET_OR_PRIVATE_DATA_REJECTED');
  if (!isSafeId(input.id) || !['G1', 'G2'].includes(input.provenance) || !isIssue(input.pr_number) || !isSafeId(input.thread_id) || !isSafeLabel(input.component) || typeof input.path !== 'string' || !isDigest(input.evidence_digest)) return failure('N5_GOVERNANCE_UNREADY');
  const materiality = evaluateMateriality(input);
  return success('N5_INSPECTION_READY', { finding: { id: input.id, provenance: input.provenance, pr_number: input.pr_number, thread_id: input.thread_id, component: input.component, path: input.path, line: Number.isSafeInteger(input.line) ? input.line : null, text: input.text, evidence_digest: input.evidence_digest, predicates: materiality.predicates, exclusions: materiality.exclusions, materiality: materiality.material ? 'material' : 'nonblocking', recommended_disposition: materiality.material ? 'valid and still unresolved' : 'deferred' } });
}
function authorizeReviewMutation(input = {}) { return failure('N5_REVIEW_MUTATION_DENIED', { actor: input.actor || 'unknown', action: input.action || 'unknown' }); }
function resolveFinding(input = {}) {
  if (!REVIEW_DISPOSITIONS.includes(input.controller_disposition) || input.closing_reply_factual !== true || input.evidence_backed_completion !== true || input.exact_head !== true || input.canonical !== true || input.validation !== true || input.readback !== true || !isSafeId(input.controlling_reference) || input.resolved !== true) return failure('N5_REVIEW_DISPOSITION_INCOMPLETE');
  return success('N5_REVIEW_DISPOSITION_COMPLETE', { disposition: input.controller_disposition, controller_only: true });
}
function registerDeferredFinding(input = {}) {
  const finding = input.finding || {};
  const parent = clone(input.parent || {});
  if (!isSafeLabel(finding.component || '') || !publicSafeText(finding.text || '') || finding.materiality === 'material') return failure('N5_DF_AMBIGUOUS');
  const triggers = Array.isArray(input.triggers) ? input.triggers : [];
  if (!DF_TRIGGERS.every((trigger) => triggers.includes(trigger))) return failure('N5_DF_AMBIGUOUS');
  if (!Array.isArray(parent.deferred_findings)) parent.deferred_findings = [];
  const dfId = isSafeId(finding.df_id) ? finding.df_id : `df-${sha256({ id: finding.id, component: finding.component }).slice(0, 12)}`;
  if (!isSafeId(dfId) || parent.deferred_findings.some((item) => item.df_id === dfId)) return failure('N5_DF_AMBIGUOUS');
  const record = { df_id: dfId, finding_id: finding.id || null, source_pr: finding.pr_number || null, source_thread: finding.thread_id || null, source_head: finding.source_head || null, text: finding.text, path: finding.path || null, line: finding.line || null, supplied_severity: finding.supplied_severity || null, component: finding.component, root_digest: finding.root_digest || sha256({ component: finding.component, path: finding.path || null }), evidence_digest: finding.evidence_digest || null, reason_nonblocking: finding.reason_nonblocking || 'A4 materiality predicates are not all satisfied.', triggers: [...triggers], disposition: 'DEFERRED_REVALIDATE', promoted_child: null };
  parent.deferred_findings.push(record);
  return success('N5_DF_REGISTERED', { parent, record });
}
function revalidateDeferredFinding(input = {}) {
  const record = clone(input.record || {});
  if (!isSafeId(record.df_id) || !isSafeLabel(record.component || '')) return failure('N5_DF_AMBIGUOUS');
  if (input.material !== true) { record.disposition = input.disposition || 'DISPOSED_NONMATERIAL'; return success('N5_VALID', { record }); }
  const child = input.compatible_child;
  if (child && child.frozen !== true && child.lifecycle !== 'current') { record.disposition = `PROMOTED_TO_EXISTING_CHILD:${child.issue_number}`; record.promoted_child = child.issue_number; return success('N5_VALID', { record }); }
  return failure('N5_AUTHORITY_REQUIRED', { record, promotion: child ? 'scope_decision_required' : 'controller_authorised_direct_sibling_required' });
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
  const state = { repository: options.repository, a1: options.a1, a2: options.a2, github: options.github, owners: options.transaction_owner instanceof Map ? options.transaction_owner : new Map() };
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
    const auth = authorizeMutation(input, state);
    if (!auth.ok) return auth;
    const key = `${input.repository}+${input.parent_issue}`;
    if (state.owners.get(key)) return failure('PARENT_CONCURRENCY_CONFLICT');
    state.owners.set(key, true);
    try {
      const first = fetchParent(state.github, input);
      if (!first.ok) return first;
      const parsed = parseManagedBlock(first.fetched.body, 'parent', { complete: first.fetched.complete !== false });
      if (!parsed.ok) return parsed;
      if (parsed.state.repository !== input.repository || parsed.state.parent_issue !== input.parent_issue) return failure('N5_REPOSITORY_IDENTITY_MISMATCH');
      const applied = applyBoundedUpdate(parsed.state, input.target || {}, input.update || {});
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
        const freshApplied = applyBoundedUpdate(freshParsed.state, input.target || {}, input.update || {});
        if (!freshApplied.ok) return freshApplied;
        const compacted = compactTerminal(freshApplied.state);
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
    } finally { state.owners.delete(key); }
  }
  function remove(input = {}) {
    const auth = authorizeMutation({ ...input, intent: 'remove' }, state);
    if (!auth.ok) return auth;
    const fetched = fetchParent(state.github, input);
    if (!fetched.ok) return fetched;
    const parsed = parseManagedBlock(fetched.fetched.body, 'parent', { complete: fetched.fetched.complete !== false });
    if (!parsed.ok) return parsed;
    const nextBody = parsed.prefix + parsed.suffix;
    try { state.github.updateParent({ repository: input.repository, parent_issue: input.parent_issue, body: nextBody, revision: fetched.fetched.revision || null }); } catch (_error) { return failure('PARENT_RECONCILIATION_INCOMPLETE'); }
    const readback = fetchParent(state.github, input);
    if (!readback.ok || readback.fetched.body !== nextBody) return failure('PARENT_RECONCILIATION_INCOMPLETE');
    return success('N5_REMOVED', { outside_bytes_preserved: true });
  }
  return Object.freeze({ inspect, preview, initialise: reconcile, migrate: reconcile, validate, reconcile, show, remove, reviewInventory: buildReviewInventory, classifyFinding, registerDeferredFinding, governanceReadiness: autoCodeReadiness });
}

module.exports = Object.freeze({
  CONTRACT_VERSION, REVIEW_INVENTORY_VERSION, TRACKER_VERSION, DESIGN_LOCK, INTENTS, RESOURCE_KINDS, LIFECYCLES,
  A4_MATERIAL_PREDICATES, A4_EXCLUSIONS, DF_TRIGGERS, DF_DISPOSITIONS, REVIEW_DISPOSITIONS, MANAGED_MARKERS,
  SECTION_ORDER, FAILURE_CODES, SUCCESS_CODES, RED_FIRST_CASES, canonicalJson, sha256, isDigest, isSha,
  isPublicSafeEvidence, authorityBoundary, transactionContract, renderManagedBlock, parseManagedBlock,
  replaceManagedBlock, validateTracker, boundedProjection, classifyBodyLimit, compactTerminal, applyBoundedUpdate,
  buildReviewInventory, evaluateMateriality, classifyFinding, authorizeReviewMutation, resolveFinding,
  registerDeferredFinding, revalidateDeferredFinding, codexReviewState, autoCodeReadiness, adjudicateHistoricalPr310,
  rejectHistoricalRevival, nextAction, createRuntime,
});
