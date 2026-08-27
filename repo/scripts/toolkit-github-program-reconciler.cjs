'use strict';

const crypto = require('node:crypto');
const a1 = require('./toolkit-control-plane/control-plane-kernel.cjs');
const canonicalA2 = require('./toolkit-capability-registry.cjs');
const PROGRAMME_SURFACE_CONTRACT = require('../contracts/github-program-reconciler/programme-surface-contract.json');

const CONTRACT_VERSION = 'toolkit.github-program-reconciler.v1';
const REVIEW_INVENTORY_VERSION = 'toolkit.n5.review-inventory.v1';
const TRACKER_VERSION = 'v3';
const LEGACY_V0_VERSION = 'pre-n5-seven-section-v0';
const DESIGN_LOCK = 'DL-S2-GITHUB-PROGRAM-001';
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
const REVIEW_EVIDENCE_VERSION = 'toolkit.n5.review-evidence.v1';
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
  'UNMAPPED_PREDECESSOR_OBLIGATION',
  'N5_REPOSITORY_IDENTITY_MISMATCH', 'N5_CONSENT_REQUIRED', 'N5_AUTHORITY_REQUIRED', 'N5_TRACKER_VERSION_UNSUPPORTED',
  'N5_REVIEW_INVENTORY_INCOMPLETE', 'N5_DF_AMBIGUOUS', 'N5_REVIEW_MUTATION_DENIED', 'N5_REVIEW_DISPOSITION_INCOMPLETE',
  'N5_GOVERNANCE_UNREADY', 'N5_SCOPE_REJECTED', 'N5_SECRET_OR_PRIVATE_DATA_REJECTED', 'PUBLISH_SOURCE_MISMATCH',
  'AUTO_CODE_GOVERNANCE_UNREADY',
]);
const SUCCESS_CODES = Object.freeze(['N5_INSPECTION_READY', 'N5_PREVIEW_READY', 'N5_VALID', 'N5_SHOW_READY', 'N5_NOOP', 'N5_RECONCILED', 'N5_REMOVED', 'N5_DF_REGISTERED', 'PREDECESSOR_COVERAGE_VALID']);
const PREDECESSOR_AUTHORITY_REF = 'github:issue-comment:359:5437827030';
const PREDECESSOR_AUTHORITY_MARKER = 'PREDECESSOR_COVERAGE_WEB_ADJUDICATED / 45_OF_45_ISSUES_MAPPED / UNMAPPED_PREDECESSOR_OBLIGATIONS=0';
const PREDECESSOR_ISSUE_ROSTER = Object.freeze([241, 242, 243, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 257, 264, 265, 268, 270, 271, 272, 284, 286, 287, 291, 294, 295, 296, 297, 298, 299, 300, 312, 314, 320, 323, 324, 328, 335, 336, 338, 340, 341, 342, 346, 348]);
const PREDECESSOR_CRITERION_COUNTS = Object.freeze({
  241: 1, 242: 3, 243: 4, 245: 1, 246: 1, 247: 1, 248: 6, 249: 2, 250: 1,
  251: 1, 252: 3, 253: 1, 254: 1, 257: 3, 264: 1, 265: 1, 268: 2, 270: 1,
  271: 1, 272: 1, 284: 2, 286: 4, 287: 1, 291: 1, 294: 3, 295: 1, 296: 3,
  297: 3, 298: 3, 299: 2, 300: 2, 312: 1, 314: 1, 320: 2, 323: 1, 324: 4,
  328: 1, 335: 1, 336: 1, 338: 2, 340: 1, 341: 2, 342: 1, 346: 4, 348: 1,
});
const PREDECESSOR_DISPOSITIONS = Object.freeze(['SATISFIED', 'SUPERSEDED_BY_STRONGER_IMPLEMENTATION', 'NO_LONGER_APPLICABLE', 'TRANSFERRED']);
const PREDECESSOR_MATRIX_SHA256 = '4f742581d8fdc20e38e0d83946a8784b98f1b980486a1b32cae1588486a1a0db';
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

function validatePredecessorCoverage(contract) {
  const fail = (reason) => failure('UNMAPPED_PREDECESSOR_OBLIGATION', { reason });
  if (!isRecord(contract)
    || contract.$schema !== 'toolkit.github-program.predecessor-coverage.v1'
    || contract.repository !== 'weijunswj/ai-agent-toolkit'
    || contract.programme_parent_issue !== 240
    || contract.programme_child_issue !== 359
    || contract.design_lock !== 'DL-S2-GITHUB-PROGRAM-001') return fail('contract-identity');
  if (!isRecord(contract.authority)
    || contract.authority.kind !== 'WEB_ADJUDICATION'
    || contract.authority.issue !== 359
    || contract.authority.comment_id !== 5437827030
    || contract.authority.reference !== PREDECESSOR_AUTHORITY_REF
    || contract.authority.marker !== PREDECESSOR_AUTHORITY_MARKER) return fail('controlling-authority');
  if (contract.expected_issue_count !== 45
    || contract.expected_criterion_count !== 84
    || canonicalJson(contract.accepted_dispositions) !== canonicalJson(PREDECESSOR_DISPOSITIONS)
    || contract.unmapped_disposition_allowed !== false) return fail('coverage-vocabulary');
  if (!isRecord(contract.s6_final_assurance)
    || contract.s6_final_assurance.owner !== 'S6#363'
    || contract.s6_final_assurance.must_mechanically_prove_zero_unresolved_active_transfers !== true) return fail('s6-final-assurance');
  if (!Array.isArray(contract.predecessors) || contract.predecessors.length !== PREDECESSOR_ISSUE_ROSTER.length) return fail('issue-count');
  const actualRoster = contract.predecessors.map((entry) => entry?.issue);
  if (canonicalJson(actualRoster) !== canonicalJson(PREDECESSOR_ISSUE_ROSTER)
    || new Set(actualRoster).size !== PREDECESSOR_ISSUE_ROSTER.length) return fail('issue-roster');

  const dispositionCounts = Object.fromEntries(PREDECESSOR_DISPOSITIONS.map((value) => [value, 0]));
  const ownerCounts = {};
  const criterionIds = new Set();
  let criterionCount = 0;
  for (const predecessor of contract.predecessors) {
    if (!isRecord(predecessor)
      || predecessor.authority_ref !== PREDECESSOR_AUTHORITY_REF
      || !Array.isArray(predecessor.criteria)
      || predecessor.criteria.length !== PREDECESSOR_CRITERION_COUNTS[predecessor.issue]) return fail('criterion-group-count');
    for (const criterion of predecessor.criteria) {
      criterionCount += 1;
      if (!isRecord(criterion)
        || !isSafeId(criterion.id)
        || criterionIds.has(criterion.id)
        || typeof criterion.scope !== 'string'
        || criterion.scope.length === 0
        || criterion.programme_blocking !== true && criterion.programme_blocking !== false
        || !PREDECESSOR_DISPOSITIONS.includes(criterion.disposition)) return fail('criterion-shape');
      criterionIds.add(criterion.id);
      dispositionCounts[criterion.disposition] += 1;
      if (criterion.disposition === 'TRANSFERRED') {
        if (!isSafeLabel(criterion.current_owner || '')) return fail('transferred-owner');
        ownerCounts[criterion.current_owner] = (ownerCounts[criterion.current_owner] || 0) + 1;
      } else {
        if (!isSafeLabel(criterion.owner || '')
          || !Array.isArray(criterion.evidence_refs)
          || criterion.evidence_refs.length === 0
          || criterion.evidence_refs.some((ref) => !isSafeLabel(ref))) return fail('terminal-evidence');
        ownerCounts[criterion.owner] = (ownerCounts[criterion.owner] || 0) + 1;
      }
    }
  }
  if (criterionCount !== 84) return fail('criterion-count');

  const findCriterion = (issueNumber, id) => contract.predecessors.find((entry) => entry.issue === issueNumber)?.criteria.find((entry) => entry.id === id);
  const optional = findCriterion(246, '246-optional-queue-mode');
  if (!optional || optional.disposition !== 'TRANSFERRED'
    || optional.current_owner !== 'OWNER_CONTROLLED_OPTIONAL_BACKLOG'
    || optional.programme_blocking !== false
    || optional.active_completion_graph !== false
    || optional.backlog_state !== 'DESIRED_OPTIONAL_FUTURE_WORK'
    || optional.discoverable !== true
    || optional.reactivation_required !== true
    || optional.reactivation_authority !== 'OWNER_OR_WEB'
    || optional.reactivation_owner !== 'S5#362') return fail('issue-246-optional-backlog');
  const parked = findCriterion(250, '250-three-parked-investigations');
  if (!parked || parked.group_cardinality !== 3
    || parked.disposition !== 'TRANSFERRED'
    || parked.current_owner !== 'OWNER_CONTROLLED_PARKED_BACKLOG'
    || parked.programme_blocking !== false
    || parked.active_completion_graph !== false
    || parked.backlog_state !== 'OWNER_CONTROLLED_PARKED'
    || parked.discoverable !== true
    || parked.silently_cancelled !== false
    || parked.reactivation_required !== true
    || parked.reactivation_authority !== 'OWNER_OR_WEB') return fail('issue-250-parked-backlog');
  const hostHarness = findCriterion(324, '324-host-harness-capability');
  if (!hostHarness || hostHarness.disposition !== 'TRANSFERRED' || hostHarness.current_owner !== 'S2_E4#359') return fail('issue-324-host-harness');
  if (findCriterion(323, '323-stale-ui-ux-delta-gate')?.disposition !== 'NO_LONGER_APPLICABLE'
    || findCriterion(335, '335-theme-mode-proposal')?.disposition !== 'NO_LONGER_APPLICABLE') return fail('no-longer-applicable');
  if (findCriterion(299, '299-historical-n5-implementation')?.disposition !== 'SATISFIED'
    || findCriterion(299, '299-surviving-programme-semantics')?.disposition !== 'SUPERSEDED_BY_STRONGER_IMPLEMENTATION'
    || findCriterion(320, '320-historical-review-evidence')?.disposition !== 'SATISFIED'
    || findCriterion(320, '320-surviving-review-semantics')?.disposition !== 'SUPERSEDED_BY_STRONGER_IMPLEMENTATION') return fail('historical-n5-split');
  if (findCriterion(346, '346-historical-a1-a4')?.disposition !== 'SATISFIED'
    || findCriterion(346, '346-durable-control-semantics')?.current_owner !== 'S3#360'
    || findCriterion(346, '346-retired-a1-a4-runtime')?.compatibility_runtime_restored !== false) return fail('historical-a1-a4-split');
  for (const predecessor of contract.predecessors) {
    for (const criterion of predecessor.criteria) {
      if (criterion.disposition === 'TRANSFERRED' && ![246, 250].includes(predecessor.issue) && criterion.programme_blocking !== true) return fail('active-transfer-nonblocking');
    }
  }
  if (sha256(contract.predecessors) !== PREDECESSOR_MATRIX_SHA256) return fail('matrix-digest');
  return success('PREDECESSOR_COVERAGE_VALID', {
    issue_count: contract.predecessors.length,
    criterion_count: criterionCount,
    disposition_counts: dispositionCounts,
    owner_counts: ownerCounts,
    unmapped_predecessor_obligations: 0,
    controlling_authority: PREDECESSOR_AUTHORITY_REF,
    matrix_sha256: PREDECESSOR_MATRIX_SHA256,
  });
}


const MANAGED_EVENT_TYPES = Object.freeze([
  'lifecycle_transition', 'lock_accepted', 'candidate_bound', 'validation', 'g4_or_finality',
  'blocker', 'dependency', 'owner_decision', 'reconciliation_receipt',
]);
const CONFORMANCE_CLASSES = Object.freeze(['UNMANAGED', 'LEGACY_MANAGED', 'CURRENT_MANAGED', 'DRIFTED_MANAGED']);
const PROGRAMME_MANAGED_LABELS = Object.freeze(['completed', 'current', 'queued', 'blocked']);
const PROGRAMME_LABEL_DEFINITIONS = Object.freeze({
  completed: Object.freeze({ color: '1f883d', description: 'Programme child is complete or retired.' }),
  current: Object.freeze({ color: '0969da', description: 'Programme child is the sole current delivery item.' }),
  queued: Object.freeze({ color: 'bf8700', description: 'Programme child is queued for future delivery.' }),
  blocked: Object.freeze({ color: 'cf222e', description: 'Programme child has current authoritative blocker evidence.' }),
});
const PR_REGISTRY_STATUSES = Object.freeze(['ACTIVE', 'ACCEPTED', 'RETIRED']);
const GITHUB_RELATIONSHIP_API_VERSION = '2026-03-10';
const PROGRAMME_MARKERS = Object.freeze({
  parent: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v1 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->' }),
  child: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v1 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->' }),
  pr: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:BEGIN v1 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END -->' }),
});
const PROGRAMME_EVENT_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-EVENT v1 ';
const PROGRAMME_EVENT_SUFFIX = ' -->';
const PROGRAMME_STATE_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-STATE v1 ';
const PROGRAMME_STATE_SUFFIX = ' -->';
const trustedRelationshipInspections = new WeakSet();

function programmeFailure(reason, extra = {}) {
  return failure('PARENT_RECONCILIATION_INCOMPLETE', { reason, ...extra });
}
function safeLines(values) {
  return Array.isArray(values) && values.length ? values.map((value) => '- ' + String(value)).join('\n') : '- None';
}
function isOneLineOutcome(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 240 && !/[\r\n]/.test(value);
}
function validExtensions(value) {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length > 20) return false;
  const encoded = canonicalJson(value);
  return encoded.length <= 4096 && !forbiddenEvidence(encoded);
}
function safeTextArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && publicSafeText(entry));
}
function markdownCell(value) { return String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }
function table(headers, rows) {
  return [
    '| ' + headers.map(markdownCell).join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((row) => '| ' + row.map(markdownCell).join(' | ') + ' |'),
  ].join('\n');
}
function renderExtensions(extensions) {
  if (!isRecord(extensions) || Object.keys(extensions).length === 0) return '- None';
  return table(['Extension', 'Value'], Object.entries(extensions).map(([key, value]) => [key, typeof value === 'string' ? value : canonicalJson(value)]));
}
function encodeManagedState(value) {
  return Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
}
function decodeManagedState(value) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch (_error) { return null; }
}
function managedStateLine(value) {
  return PROGRAMME_STATE_PREFIX + encodeManagedState(value) + PROGRAMME_STATE_SUFFIX;
}
function validatePrRegistry(registry) {
  if (!Array.isArray(registry)) return programmeFailure('pr-registry-not-array');
  const seen = new Set();
  for (const entry of registry) {
    if (!isRecord(entry) || !isIssue(entry.pr) || seen.has(entry.pr)
      || !PR_REGISTRY_STATUSES.includes(entry.status)
      || !['INTERMEDIATE', 'TERMINAL'].includes(entry.role)
      || typeof entry.completes_child !== 'boolean') return programmeFailure('pr-registry-invalid');
    if (entry.role === 'INTERMEDIATE' && entry.completes_child) return programmeFailure('intermediate-pr-cannot-complete-child');
    seen.add(entry.pr);
  }
  return success('PROGRAMME_VALID', { registry: clone(registry) });
}
function hasPortableFields(kind, value) {
  const required = PROGRAMME_SURFACE_CONTRACT.portable_minimum[kind];
  return isRecord(value) && Array.isArray(required) && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function validateProgrammeModel(model) {
  if (!isRecord(model) || !isSafeLabel(model.repository || '') || !isRecord(model.parent)
    || !hasPortableFields('parent', model.parent) || !isOneLineOutcome(model.parent.outcome)
    || !isIssue(model.parent.issue) || !Array.isArray(model.parent.child_graph)
    || !isSafeLabel(model.parent.status || '') || !publicSafeText(model.parent.goal || '')
    || !safeTextArray(model.parent.progress) || !publicSafeText(model.parent.next_action || '')
    || !safeTextArray(model.parent.major_holds) || !isRecord(model.parent.predecessor_gateway)
    || model.parent.predecessor_gateway.issues !== 45 || model.parent.predecessor_gateway.criteria !== 84
    || model.parent.predecessor_gateway.unmapped !== 0 || !validExtensions(model.parent.extensions)
    || !Array.isArray(model.children) || !Array.isArray(model.prs)) return programmeFailure('programme-model-shape');
  const current = model.children.filter((child) => child?.status === 'CURRENT');
  if (current.length > 1) return programmeFailure('multiple-current-children');
  if ((current[0]?.issue || null) !== (model.parent.current_child || null)) return programmeFailure('parent-current-child-drift');
  const childIssues = new Set();
  const representedPrs = new Set();
  for (const child of model.children) {
    if (!hasPortableFields('child', child) || !isOneLineOutcome(child.outcome)
      || !isIssue(child.issue) || childIssues.has(child.issue)
      || child.parent_issue !== model.parent.issue || !['CURRENT', 'QUEUED', 'BLOCKED', 'COMPLETED', 'RETIRED'].includes(child.status)
      || !Array.isArray(child.dependencies) || !Array.isArray(child.epochs) || !isSafeLabel(child.lock || '')
      || child.dependencies.some((issue) => !isIssue(issue)) || new Set(child.dependencies).size !== child.dependencies.length
      || child.epochs.length === 0 || child.epochs.some((entry) => !isRecord(entry) || !isSafeLabel(entry.name || '')
        || !isSafeLabel(entry.lock || '') || !isSafeLabel(entry.purpose || '') || !isSafeLabel(entry.state || ''))
      || canonicalJson(child.predecessor_issues) !== canonicalJson(PREDECESSOR_ISSUE_ROSTER)
      || !isRecord(child.predecessor_gateway) || child.predecessor_gateway.issues !== 45
      || child.predecessor_gateway.criteria !== 84 || child.predecessor_gateway.unmapped !== 0
      || !publicSafeText(child.predecessor_gateway.optional_future || '')
      || !publicSafeText(child.predecessor_gateway.parked_backlog || '')
      || !safeTextArray(child.scope) || !safeTextArray(child.out_of_scope) || !safeTextArray(child.downstream_owned)
      || !safeTextArray(child.achieved) || !safeTextArray(child.remaining) || !safeTextArray(child.holds)
      || !safeTextArray(child.boundaries) || !publicSafeText(child.goal || '') || !publicSafeText(child.progress || '')
      || !isSafeLabel(child.current_gate || '') || !isSafeLabel(child.current_phase || '') || !isSafeLabel(child.next_gate || '')
      || !publicSafeText(child.current_obligation || '') || !publicSafeText(child.next_action || '') || !publicSafeText(child.eli5 || '')
      || !validExtensions(child.extensions)) return programmeFailure('child-model-invalid');
    const registry = validatePrRegistry(child.pr_registry);
    if (!registry.ok) return registry;
    for (const entry of child.pr_registry) {
      if (representedPrs.has(entry.pr)) return programmeFailure('duplicate-represented-pr');
      representedPrs.add(entry.pr);
    }
    childIssues.add(child.issue);
  }
  const prNumbers = new Set();
  for (const pr of model.prs) {
    if (!hasPortableFields('pr', pr) || !isOneLineOutcome(pr.outcome)
      || !isIssue(pr.number) || prNumbers.has(pr.number) || pr.parent_issue !== model.parent.issue || !childIssues.has(pr.child_issue)
      || !isSha(pr.base) || !isSha(pr.head) || !isSha(pr.tree) || !Array.isArray(pr.changed_surfaces)
      || !Array.isArray(pr.validation) || !Array.isArray(pr.holds)
      || !['INTERMEDIATE', 'TERMINAL'].includes(pr.role) || typeof pr.completes_child !== 'boolean'
      || pr.role === 'INTERMEDIATE' && pr.completes_child
      || !isSafeLabel(pr.branch || '') || !isSafeLabel(pr.epoch || '') || !isSafeLabel(pr.lock || '')
      || !isSafeLabel(pr.state || '') || !isSafeLabel(pr.finality || '') || !isSafeLabel(pr.version || '')
      || !safeTextArray(pr.changed_surfaces) || !safeTextArray(pr.validation) || !safeTextArray(pr.holds)
      || !publicSafeText(pr.purpose || '') || !safeTextArray(pr.scope) || !safeTextArray(pr.out_of_scope)
      || !publicSafeText(pr.progress || '') || !safeTextArray(pr.achieved) || !safeTextArray(pr.remaining)
      || !safeTextArray(pr.safety_constraints) || !publicSafeText(pr.next_action || '') || !publicSafeText(pr.eli5 || '')
      || !Array.isArray(pr.validation_status) || pr.validation_status.some((entry) => !isRecord(entry)
        || !isSafeLabel(entry.check || '') || !isSafeLabel(entry.state || ''))
      || !validExtensions(pr.extensions)) return programmeFailure('pr-model-invalid');
    prNumbers.add(pr.number);
  }
  const graph = new Map();
  for (const entry of model.parent.child_graph) {
    if (!isRecord(entry) || !isIssue(entry.issue) || graph.has(entry.issue)
      || !['CURRENT', 'QUEUED', 'BLOCKED', 'COMPLETED', 'RETIRED'].includes(entry.status)
      || !isSafeLabel(entry.short_title || '') || !isOneLineOutcome(entry.outcome)) return programmeFailure('parent-child-graph-invalid');
    graph.set(entry.issue, entry.status);
  }
  if (graph.size !== model.children.length
    || model.children.some((child) => graph.get(child.issue) !== child.status)) return programmeFailure('parent-child-graph-drift');
  if (representedPrs.size !== model.prs.length || model.prs.some((pr) => !representedPrs.has(pr.number))) return programmeFailure('pr-registry-model-drift');
  for (const child of model.children) {
    const epochs = new Set(child.epochs.map((entry) => entry?.name));
    const candidate = child.candidate;
    if (candidate !== null && (!isRecord(candidate) || candidate.repository !== model.repository
      || candidate.parent_issue !== model.parent.issue || candidate.child_issue !== child.issue
      || !isIssue(candidate.pr) || !isSafeLabel(candidate.branch || '')
      || !isSha(candidate.base) || !isSha(candidate.head) || !isSha(candidate.tree)
      || !isSafeLabel(candidate.version || '')
      || !isSafeLabel(candidate.epoch || '') || candidate.lock !== child.lock
      || !['INTERMEDIATE', 'TERMINAL'].includes(candidate.role) || typeof candidate.completes_child !== 'boolean'
      || candidate.lifecycle !== child.status)) {
      return programmeFailure('candidate-binding-invalid');
    }
    for (const entry of child.pr_registry) {
      const pr = model.prs.find((candidatePr) => candidatePr.number === entry.pr);
      if (!pr || pr.child_issue !== child.issue || pr.lock !== child.lock || !epochs.has(pr.epoch)
        || pr.role !== entry.role || pr.completes_child !== entry.completes_child) return programmeFailure('candidate-registry-pr-binding');
    }
    if (candidate) {
      const pr = model.prs.find((candidatePr) => candidatePr.number === candidate.pr);
      const registry = child.pr_registry.find((entry) => entry.pr === candidate.pr && entry.status === 'ACTIVE');
      if (!pr || !registry || candidate.branch !== pr.branch || candidate.base !== pr.base || candidate.head !== pr.head
        || candidate.tree !== pr.tree || candidate.epoch !== pr.epoch || candidate.role !== pr.role
        || candidate.completes_child !== pr.completes_child) {
        return programmeFailure('candidate-registry-pr-binding');
      }
    }
  }
  return success('PROGRAMME_VALID', { model });
}
function renderParentView(repository, parent) {
  const state = { kind: 'parent', repository, data: parent };
  return [
    PROGRAMME_MARKERS.parent.begin,
    '# Programme dashboard',
    '',
    '## Programme goal',
    parent.goal,
    '',
    '## Current status',
    table(['Item', 'Status'], [
      ['Programme', parent.status],
      ['Current Child', parent.current_child ? '#' + parent.current_child : 'None'],
      ['Current outcome', parent.outcome],
    ]),
    '',
    '## Programme children',
    table(['State', 'Child', 'What it achieves'], parent.child_graph.map((child) => [
      child.status[0] + child.status.slice(1).toLowerCase(),
      '#' + child.issue + ' - ' + child.short_title,
      child.outcome,
    ])),
    '',
    '## Overall progress / milestones',
    safeLines(parent.progress),
    '',
    '## Major blockers / holds',
    safeLines(parent.major_holds),
    '',
    '## Dependency / predecessor gateway',
    table(['Issues', 'Criteria', 'Unmapped'], [[parent.predecessor_gateway.issues, parent.predecessor_gateway.criteria, parent.predecessor_gateway.unmapped]]),
    '',
    '## Next programme action',
    parent.next_action,
    '',
    '## Repository extensions',
    renderExtensions(parent.extensions),
    '',
    managedStateLine(state),
    PROGRAMME_MARKERS.parent.end,
  ].join('\n');
}
function renderChildView(repository, child) {
  const state = { kind: 'child', repository, data: child };
  return [
    PROGRAMME_MARKERS.child.begin,
    '# Programme child #' + child.issue,
    '',
    '## Goal / outcome',
    child.goal,
    '',
    '- Outcome: ' + child.outcome,
    '',
    '## Scope / boundaries',
    '### In scope',
    safeLines(child.scope),
    '',
    '### Out of scope',
    safeLines(child.out_of_scope),
    '',
    '### Downstream-owned',
    safeLines(child.downstream_owned),
    '',
    '## Current status',
    table(['Item', 'Status'], [
      ['Overall', child.status],
      ['Current gate', child.current_gate],
      ['Current epoch / phase', child.current_phase],
      ['Active PR', child.candidate ? '#' + child.candidate.pr : 'None'],
      ['Current candidate', child.candidate ? child.candidate.head : 'None'],
      ['Next gate', child.next_gate],
      ['Finality', child.boundaries.join(' ')],
    ]),
    '',
    '## Current progress',
    child.progress,
    '',
    '- Current obligation: ' + child.current_obligation,
    '',
    '## Achieved / completed',
    safeLines(child.achieved),
    '',
    '## Still to achieve',
    safeLines(child.remaining),
    '',
    '## Current blockers / holds',
    safeLines(child.holds),
    '',
    '## Execution map / phases / epochs',
    table(['Epoch / phase', 'Lock', 'Purpose', 'State'], child.epochs.map((entry) => [entry.name, entry.lock, entry.purpose, entry.state])),
    '',
    '## Dependencies / predecessor coverage',
    '- Parent: #' + child.parent_issue,
    safeLines(child.dependencies.map((value) => 'Blocked by #' + value)),
    '',
    table(['Predecessor issues', 'Criteria', 'Unmapped'], [[child.predecessor_gateway.issues, child.predecessor_gateway.criteria, child.predecessor_gateway.unmapped]]),
    '',
    '- Optional future: ' + child.predecessor_gateway.optional_future,
    '- Parked backlog: ' + child.predecessor_gateway.parked_backlog,
    '',
    '## PR registry',
    table(['PR', 'Role', 'State', 'Completes Child'], child.pr_registry.map((entry) => ['#' + entry.pr, entry.role, entry.status, entry.completes_child ? 'Yes' : 'No'])),
    '',
    '## Exact current candidate',
    child.candidate ? table(['PR', 'Branch', 'Base', 'Head'], [[child.candidate.pr, child.candidate.branch, child.candidate.base, child.candidate.head]])
      + '\n\n' + table(['Tree', 'Version'], [[child.candidate.tree, child.candidate.version]]) : '- None',
    '',
    '## Finality flow',
    safeLines(child.boundaries),
    '',
    '## Next action',
    child.next_action,
    '',
    '## ELI5',
    child.eli5,
    '',
    '## Repository extensions',
    renderExtensions(child.extensions),
    '',
    managedStateLine(state),
    PROGRAMME_MARKERS.child.end,
  ].join('\n');
}
function renderPrView(repository, pr) {
  const state = { kind: 'pr', repository, data: pr };
  return [
    PROGRAMME_MARKERS.pr.begin,
    '# Programme PR #' + pr.number,
    '',
    '## Purpose / goal',
    pr.purpose,
    '',
    '- Outcome: ' + pr.outcome,
    '',
    '## Programme position',
    table(['Item', 'Value'], [
      ['Parent', '#' + pr.parent_issue],
      ['Child', '#' + pr.child_issue],
      ['Epoch', pr.epoch],
      ['Lock', pr.lock],
      ['Role', pr.role],
      ['Completes Child', pr.completes_child ? 'Yes' : 'No'],
    ]),
    '',
    '## Scope',
    safeLines(pr.scope),
    '',
    '## Out of scope',
    safeLines(pr.out_of_scope),
    '',
    '## Current progress',
    pr.progress,
    '',
    '## Implemented / achieved',
    safeLines(pr.achieved),
    '',
    '## Still to achieve',
    safeLines(pr.remaining),
    '',
    '## Current blockers / holds',
    safeLines(pr.holds),
    '',
    '## Key design / safety constraints',
    safeLines(pr.safety_constraints),
    '',
    '## Exact candidate',
    table(['Branch', 'Base', 'Head', 'Tree'], [[pr.branch, pr.base, pr.head, pr.tree]]),
    '',
    table(['Package / plugin version', 'PR state'], [[pr.version, pr.state]]),
    '',
    '## Validation / review status',
    table(['Check / review', 'State'], pr.validation_status.map((entry) => [entry.check, entry.state])),
    '',
    '## Relationship / finality semantics',
    '- Role: ' + pr.role,
    '- Completes Child: ' + (pr.completes_child ? 'Yes' : 'No'),
    '- Merge closes Child: ' + (pr.completes_child ? 'Eligible only after terminal authority.' : 'No'),
    '- Ready, merge and finality: ' + pr.finality,
    '',
    '## Changed surfaces',
    safeLines(pr.changed_surfaces),
    '',
    '## Validation evidence',
    safeLines(pr.validation),
    '',
    '## Next action',
    pr.next_action,
    '',
    '## ELI5',
    pr.eli5,
    '',
    '## Repository extensions',
    renderExtensions(pr.extensions),
    '',
    managedStateLine(state),
    PROGRAMME_MARKERS.pr.end,
  ].join('\n');
}
function renderProgrammeViews(model) {
  const valid = validateProgrammeModel(model);
  if (!valid.ok) return valid;
  const bodies = { parent: renderParentView(model.repository, model.parent), children: {}, prs: {} };
  for (const child of model.children) bodies.children[String(child.issue)] = renderChildView(model.repository, child);
  for (const pr of model.prs) bodies.prs[String(pr.number)] = renderPrView(model.repository, pr);
  return success('PROGRAMME_VIEWS_READY', { bodies });
}
function markerForKind(kind) { return PROGRAMME_MARKERS[kind] || null; }
function splitProgrammeManagedBlock(body, kind) {
  const marker = markerForKind(kind);
  if (!marker || typeof body !== 'string') return null;
  const begin = body.indexOf(marker.begin);
  const end = body.indexOf(marker.end);
  if (begin < 0 || end < begin || body.indexOf(marker.begin, begin + 1) >= 0 || body.indexOf(marker.end, end + 1) >= 0) return null;
  const finish = end + marker.end.length;
  return { prefix: body.slice(0, begin), managed: body.slice(begin, finish), suffix: body.slice(finish) };
}
function parseProgrammeView(body, kind) {
  const split = splitProgrammeManagedBlock(body, kind);
  if (!split) return programmeFailure('managed-view-marker');
  const match = split.managed.match(/<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-STATE v1 ([A-Za-z0-9_-]+) -->/g);
  if (!match || match.length !== 1) return programmeFailure('managed-view-state');
  const encoded = match[0].slice(PROGRAMME_STATE_PREFIX.length, -PROGRAMME_STATE_SUFFIX.length);
  const state = decodeManagedState(encoded);
  if (!isRecord(state) || state.kind !== kind) return programmeFailure('managed-view-state');
  return success('PROGRAMME_VALID', { state, ...split });
}
function mergeProgrammeBody(existing, rendered, kind) {
  if (typeof existing !== 'string' || existing.length === 0) return rendered;
  const current = splitProgrammeManagedBlock(existing, kind);
  if (current) return current.prefix + rendered + current.suffix;
  const legacy = splitManagedBlock(existing, kind);
  if (legacy) return legacy.prefix + rendered + legacy.suffix;
  return existing + (existing.endsWith('\n') ? '' : '\n') + rendered;
}
function unmanagedProjectionMigrationFor(migrations, group, key) {
  if (!isRecord(migrations)) return null;
  if (group === 'parent') return migrations.parent || null;
  if (!isRecord(migrations[group])) return null;
  return migrations[group][key] || null;
}
function migrateUnmanagedProjection(currentBody, rendered, migration, context = {}) {
  const span = migration?.stale_span;
  const authority = migration?.authority;
  const entity = migration?.entity;
  if (!isRecord(migration)
    || migration.schema !== 'toolkit.github-program.stale-projection-migration.v1'
    || migration.classification !== 'STALE_PROGRAMME_PROJECTION'
    || migration.grammar !== 'toolkit.github-program.stale-projection.v1'
    || migration.repository !== context.repository
    || migration.programme_parent_issue !== context.parent_issue
    || !isRecord(entity) || entity.kind !== context.entity?.kind || entity.number !== context.entity?.number
    || !isDigest(migration.body_digest)
    || !isRecord(span) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
    || span.start < 0 || span.end <= span.start || span.end > currentBody.length || !isDigest(span.digest)
    || !isRecord(authority) || authority.kind !== 'WEB_ADJUDICATION'
    || !/^github:issue-comment:\d+:\d+$/.test(authority.reference || '')
    || authority.decision !== 'SUPERSEDED_PROJECTION_REPLACE'
    || sha256(currentBody) !== migration.body_digest
    || sha256(currentBody.slice(span.start, span.end)) !== span.digest) {
    return programmeFailure('stale-projection-migration-binding');
  }
  const staleProjection = currentBody.slice(span.start, span.end);
  const structuralSignals = [
    /^#{1,3}\s+/m.test(staleProjection),
    /programme|candidate|parent|child|pull request|\bPR\b/i.test(staleProjection),
    /current|queued|blocked|completed|validation|design lock|\bE\d+\b/i.test(staleProjection),
  ].filter(Boolean).length;
  if (!staleProjection.trim() || structuralSignals < 2) return programmeFailure('stale-projection-migration-grammar');
  return success('PROGRAMME_STALE_PROJECTION_MIGRATION_READY', {
    body: currentBody.slice(0, span.start) + rendered + currentBody.slice(span.end),
    stale_projection_digest: sha256(staleProjection),
    adjudication_reference: authority.reference,
  });
}
function rerenderProgrammeState(state) {
  if (state.kind === 'parent') return renderParentView(state.repository, state.data);
  if (state.kind === 'child') return renderChildView(state.repository, state.data);
  if (state.kind === 'pr') return renderPrView(state.repository, state.data);
  return null;
}
function classifyProgrammeConformance(input = {}) {
  const body = typeof input.body === 'string' ? input.body : '';
  if (/AI-AGENT-TOOLKIT\s*:\s*N5-(?:PARENT|CHILD|PR)/i.test(body)) return { classification: 'LEGACY_MANAGED', mutation_authority: false };
  const currentKind = Object.keys(PROGRAMME_MARKERS).find((kind) => body.includes(PROGRAMME_MARKERS[kind].begin) || body.includes(PROGRAMME_MARKERS[kind].end));
  if (!currentKind) return { classification: 'UNMANAGED', mutation_authority: false };
  const parsed = parseProgrammeView(body, currentKind);
  if (!parsed.ok || parsed.managed !== rerenderProgrammeState(parsed.state)) return { classification: 'DRIFTED_MANAGED', mutation_authority: false };
  return { classification: 'CURRENT_MANAGED', mutation_authority: false, kind: currentKind, state: parsed.state };
}
function normalizeManagedEvent(input) {
  if (!isRecord(input) || !MANAGED_EVENT_TYPES.includes(input.event_type)
    || !isSafeLabel(input.repository || '') || !isRecord(input.entity)
    || !['parent', 'child', 'pr'].includes(input.entity.kind) || !isIssue(input.entity.number)
    || !isSha(input.exact_revision) || !isSafeLabel(input.resulting_state || '')
    || !isSafeLabel(input.authority_ref || '')) return programmeFailure('managed-event-invalid');
  const event = {
    schema: 'toolkit.github-program.managed-event.v1',
    event_type: input.event_type,
    repository: input.repository,
    entity: { kind: input.entity.kind, number: input.entity.number },
    ...(isIssue(input.child_issue) ? { child_issue: input.child_issue } : {}),
    ...(isIssue(input.pr_number) ? { pr_number: input.pr_number } : {}),
    exact_revision: input.exact_revision,
    resulting_state: input.resulting_state,
    authority_ref: input.authority_ref,
    ...(isSafeLabel(input.prior_event || '') ? { prior_event: input.prior_event } : {}),
    ...(isSafeLabel(input.epoch || '') ? { epoch: input.epoch } : {}),
  };
  event.event_id = sha256(event);
  return success('PROGRAMME_EVENT_VALID', { event });
}
function renderManagedEvent(input) {
  const normalized = normalizeManagedEvent(input);
  if (!normalized.ok) return normalized;
  const encoded = encodeManagedState(normalized.event);
  return success('PROGRAMME_EVENT_READY', {
    event: normalized.event,
    comment: '### Managed event: ' + normalized.event.event_type + '\n\n'
      + '- Entity: ' + normalized.event.entity.kind + ' #' + normalized.event.entity.number + '\n'
      + '- Resulting state: ' + normalized.event.resulting_state + '\n'
      + '- Authority: ' + normalized.event.authority_ref + '\n\n'
      + PROGRAMME_EVENT_PREFIX + encoded + PROGRAMME_EVENT_SUFFIX,
  });
}
function parseManagedEvent(comment) {
  if (typeof comment !== 'string') return programmeFailure('managed-event-marker');
  const first = comment.indexOf(PROGRAMME_EVENT_PREFIX);
  const last = comment.lastIndexOf(PROGRAMME_EVENT_PREFIX);
  const end = comment.indexOf(PROGRAMME_EVENT_SUFFIX, first + PROGRAMME_EVENT_PREFIX.length);
  if (first < 0 || first !== last || end < 0) return programmeFailure('managed-event-marker');
  const encoded = comment.slice(first + PROGRAMME_EVENT_PREFIX.length, end);
  const event = decodeManagedState(encoded);
  if (!isRecord(event) || event.schema !== 'toolkit.github-program.managed-event.v1') return programmeFailure('managed-event-invalid');
  const suppliedId = event.event_id;
  const normalized = normalizeManagedEvent(event);
  if (!normalized.ok || normalized.event.event_id !== suppliedId) return programmeFailure('managed-event-digest');
  return success('PROGRAMME_EVENT_VALID', { event });
}
function validateManagedEventInventory(events, repository) {
  if (!Array.isArray(events)) return programmeFailure('managed-event-inventory-missing');
  const normalized = [];
  const ids = new Set();
  for (const supplied of events) {
    const result = normalizeManagedEvent(supplied);
    if (!result.ok || result.event.repository !== repository || supplied.event_id !== result.event.event_id || ids.has(result.event.event_id)) {
      return programmeFailure('managed-event-inventory-invalid');
    }
    ids.add(result.event.event_id);
    normalized.push(result.event);
  }
  return success('PROGRAMME_EVENT_INVENTORY_VALID', { events: normalized, ids });
}
function deriveManagedLabels(input = {}) {
  const unrelated = Array.isArray(input.labels) ? input.labels.filter((label) => !PROGRAMME_MANAGED_LABELS.includes(label)) : [];
  const blocked = Array.isArray(input.blocker_evidence) && input.blocker_evidence.some((entry) => isRecord(entry) && entry.current === true && isSafeLabel(entry.authority_ref || ''));
  const lifecycle = input.native_state === 'closed' || ['COMPLETED', 'RETIRED'].includes(input.lifecycle)
    ? 'completed'
    : blocked || input.lifecycle === 'BLOCKED'
      ? 'blocked'
      : input.lifecycle === 'CURRENT'
        ? 'current'
        : 'queued';
  const labels = [...unrelated, lifecycle];
  return success('PROGRAMME_LABELS_READY', { labels: [...new Set(labels)], native_state_authoritative: true, managed_labels_derived: true });
}
function planPrAssociations(registry) {
  const valid = validatePrRegistry(registry);
  if (!valid.ok) return valid;
  return success('PROGRAMME_PR_ASSOCIATIONS_READY', {
    associations: registry.map((entry) => ({
      pr: entry.pr,
      registry_status: entry.status,
      role: entry.role,
      kind: entry.role === 'TERMINAL' && entry.completes_child ? 'CLOSING_DEVELOPMENT_LINK' : 'SAFE_CROSS_REFERENCE',
      may_close_child: entry.role === 'TERMINAL' && entry.completes_child,
    })),
    development_link_is_closing_semantic: true,
  });
}
function endpoint(method, route, payload) {
  return { method, route, api_version: GITHUB_RELATIONSHIP_API_VERSION, payload };
}
function trustedRelationshipInspection(adapter, context) {
  if (typeof adapter?.inspectRelationships !== 'function') return programmeFailure('native-relationship-inspector-missing');
  let supplied;
  try { supplied = adapter.inspectRelationships(clone(context)); } catch (_error) { return programmeFailure('native-relationship-inspection-failed'); }
  if (!isRecord(supplied) || supplied.source !== 'adapter.inspectRelationships'
    || supplied.repository !== context.repository || supplied.parent_issue !== context.parent_issue
    || !Array.isArray(supplied.issues) || !isRecord(supplied.capabilities)) return programmeFailure('native-relationship-inspection-invalid');
  const issueIds = new Set();
  const issueNumbers = new Set();
  for (const issue of supplied.issues) {
    if (!isRecord(issue) || issue.repository !== context.repository || !isIssue(issue.issue_number)
      || !Number.isSafeInteger(issue.issue_id) || issue.issue_id < 1 || issueIds.has(issue.issue_id) || issueNumbers.has(issue.issue_number)) {
      return programmeFailure('native-relationship-inventory-invalid');
    }
    issueIds.add(issue.issue_id);
    issueNumbers.add(issue.issue_number);
  }
  const inspection = clone(supplied);
  inspection.programme_children = [...context.programme_children];
  inspection.programme_entities = [...new Set([context.parent_issue, ...context.programme_children])];
  trustedRelationshipInspections.add(inspection);
  return success('PROGRAMME_RELATIONSHIP_INSPECTION_VALID', { inspection });
}
function planNativeRelationships(input = {}) {
  const inspection = input.inspection;
  if (!isIssue(input.parent_issue) || !isRecord(input.current) || !isRecord(input.desired)
    || !isRecord(inspection) || !trustedRelationshipInspections.has(inspection)
    || inspection.parent_issue !== input.parent_issue
    || !Array.isArray(input.current.sub_issues) || !Array.isArray(input.desired.sub_issues)
    || !isRecord(input.current.blocked_by) || !isRecord(input.desired.blocked_by)) return programmeFailure('native-relationship-input');
  const capabilities = inspection.capabilities;
  const knownById = new Map(inspection.issues.map((entry) => [entry.issue_id, entry]));
  const knownByNumber = new Map(inspection.issues.map((entry) => [entry.issue_number, entry]));
  const currentIds = input.current.sub_issues.map((entry) => entry?.issue_id);
  const desiredIds = input.desired.sub_issues.map((entry) => entry?.issue_id);
  if (new Set(currentIds).size !== currentIds.length || new Set(desiredIds).size !== desiredIds.length) {
    return programmeFailure('native-relationship-duplicate-edge');
  }
  for (const current of input.current.sub_issues) {
    const known = knownById.get(current?.issue_id);
    if (!known || known.issue_number !== current.issue_number || current.repository !== inspection.repository
      || current.parent_issue !== input.parent_issue
      || current.managed === true && !inspection.programme_children.includes(current.issue_number)) {
      return programmeFailure('native-relationship-current-inventory-invalid');
    }
  }
  for (const [issueNumber, issueIds] of Object.entries(input.current.blocked_by)) {
    if (!knownByNumber.has(Number(issueNumber)) || !Array.isArray(issueIds)
      || issueIds.some((id) => !knownById.has(id)) || new Set(issueIds).size !== issueIds.length) return programmeFailure('native-relationship-current-inventory-invalid');
  }
  for (const desired of input.desired.sub_issues) {
    const known = knownById.get(desired?.issue_id);
    if (!known || known.issue_number !== desired.issue_number || desired.repository !== inspection.repository
      || desired.parent_issue !== input.parent_issue || !inspection.programme_children.includes(desired.issue_number)) {
      return programmeFailure('native-relationship-identity-out-of-scope');
    }
  }
  for (const [issueNumber, issueIds] of Object.entries(input.desired.blocked_by)) {
    if (!knownByNumber.has(Number(issueNumber)) || !inspection.programme_children.includes(Number(issueNumber)) || !Array.isArray(issueIds)
      || issueIds.some((id) => !knownById.has(id) || !inspection.programme_entities.includes(knownById.get(id).issue_number))
      || new Set(issueIds).size !== issueIds.length) return programmeFailure('native-relationship-identity-out-of-scope');
  }
  const operations = [];
  const currentById = new Map(input.current.sub_issues.map((entry) => [entry.issue_id, entry]));
  const desiredById = new Map(input.desired.sub_issues.map((entry) => [entry.issue_id, entry]));
  const removed = [...currentById.keys()].filter((id) => currentById.get(id)?.managed === true && !desiredById.has(id));
  const added = [...desiredById.keys()].filter((id) => !currentById.has(id));
  if ((removed.length || added.length) && capabilities.sub_issues !== true) return programmeFailure('sub-issue-capability-unavailable');
  for (const issueId of removed) operations.push({
    type: 'sub_issue.remove', issue_id: issueId,
    endpoint: endpoint('DELETE', '/repos/{owner}/{repo}/issues/' + input.parent_issue + '/sub_issue', { sub_issue_id: issueId }),
  });
  for (const issueId of added) {
    const desired = desiredById.get(issueId);
    const replacing = isIssue(desired.previous_parent_issue) && desired.previous_parent_issue !== input.parent_issue;
    if (replacing && capabilities.reparent !== true) return programmeFailure('sub-issue-reparent-unavailable');
    operations.push({
      type: 'sub_issue.add', issue_id: issueId,
      payload: { sub_issue_id: issueId, ...(replacing ? { replace_parent: true } : {}) },
      endpoint: endpoint('POST', '/repos/{owner}/{repo}/issues/' + input.parent_issue + '/sub_issues', { sub_issue_id: issueId, ...(replacing ? { replace_parent: true } : {}) }),
    });
  }
  const currentRetained = input.current.sub_issues.filter((entry) => desiredById.has(entry.issue_id)).map((entry) => entry.issue_id);
  const desiredRetained = input.desired.sub_issues.filter((entry) => currentById.has(entry.issue_id)).map((entry) => entry.issue_id);
  const desiredOrder = input.desired.sub_issues.map((entry) => entry.issue_id);
  if (canonicalJson(currentRetained) !== canonicalJson(desiredRetained) || added.length) {
    if (capabilities.reprioritize !== true) return programmeFailure('sub-issue-reprioritize-unavailable');
    for (let index = 1; index < desiredOrder.length; index += 1) operations.push({
      type: 'sub_issue.reprioritize', issue_id: desiredOrder[index],
      endpoint: endpoint('PATCH', '/repos/{owner}/{repo}/issues/' + input.parent_issue + '/sub_issues/priority', { sub_issue_id: desiredOrder[index], after_id: desiredOrder[index - 1] }),
    });
  }
  const dependencyIssues = new Set([...Object.keys(input.current.blocked_by), ...Object.keys(input.desired.blocked_by)]);
  for (const issueNumber of dependencyIssues) {
    const before = new Set(input.current.blocked_by[issueNumber] || []);
    const after = new Set(input.desired.blocked_by[issueNumber] || []);
    const adds = [...after].filter((id) => !before.has(id));
    const removes = [...before].filter((id) => !after.has(id));
    const managedBefore = new Set(input.current.managed_blocked_by?.[issueNumber] || []);
    const managedRemoves = removes.filter((id) => managedBefore.has(id));
    if ((adds.length || managedRemoves.length) && capabilities.dependencies !== true) return programmeFailure('issue-dependency-capability-unavailable');
    for (const issueId of adds) operations.push({
      type: 'issue_dependency.add_blocked_by', issue_number: Number(issueNumber), issue_id: issueId,
      endpoint: endpoint('POST', '/repos/{owner}/{repo}/issues/' + issueNumber + '/dependencies/blocked_by', { issue_id: issueId }),
    });
    for (const issueId of managedRemoves) operations.push({
      type: 'issue_dependency.remove_blocked_by', issue_number: Number(issueNumber), issue_id: issueId,
      endpoint: endpoint('DELETE', '/repos/{owner}/{repo}/issues/' + issueNumber + '/dependencies/blocked_by/' + issueId, null),
    });
  }
  const unmanagedSubIssues = input.current.sub_issues.filter((entry) => entry.managed !== true && !desiredById.has(entry.issue_id));
  const expectedBlockedBy = clone(input.current.blocked_by);
  for (const [issueNumber, desiredIds] of Object.entries(input.desired.blocked_by)) {
    const managedBefore = new Set(input.current.managed_blocked_by?.[issueNumber] || []);
    const unrelated = (input.current.blocked_by[issueNumber] || []).filter((id) => !managedBefore.has(id));
    expectedBlockedBy[issueNumber] = [...new Set([...unrelated, ...desiredIds])];
  }
  const expectedNative = {
    ...clone(input.current),
    sub_issues: [...unmanagedSubIssues, ...clone(input.desired.sub_issues).map((entry) => ({ ...entry, managed: true }))],
    blocked_by: expectedBlockedBy,
    managed_blocked_by: clone(input.desired.blocked_by),
  };
  return success('PROGRAMME_RELATIONSHIPS_READY', {
    operations, markdown_links_canonical: false, blocked_label_is_derived_only: true,
    expected_native: expectedNative,
    unrelated_relationships_preserved: true,
    supported_semantics: ['sub_issue.inspect', 'sub_issue.add', 'sub_issue.remove', 'sub_issue.reparent', 'sub_issue.reprioritize', 'issue_dependency.blocked_by'],
  });
}
function programmeLifecyclePreflight(input = {}) {
  const intent = String(input.intent || '');
  const mandatory = /(?:current|queue|block|depend|candidate|epoch|gate|status|finality|close|parent|child|programme)/i.test(intent);
  return {
    code: mandatory ? 'PROGRAMME_PREFLIGHT_REQUIRED' : 'PROGRAMME_PREFLIGHT_NOT_REQUIRED',
    mandatory, invocation: input.invocation || 'implicit', inspection: mandatory, preview: mandatory,
    mutation_authority: false, ready: false, merge: false, finality: false,
  };
}
function validateBodyFreshness(input = {}) {
  if (!isRecord(input.model) || !Array.isArray(input.events)) return programmeFailure('body-freshness-input');
  const entityState = (event) => {
    if (event.entity?.kind === 'parent' && event.entity.number === input.model.parent?.issue) return input.model.parent;
    if (event.entity?.kind === 'child') return input.model.children?.find((entry) => entry.issue === event.entity.number) || null;
    if (event.entity?.kind === 'pr') return input.model.prs?.find((entry) => entry.number === event.entity.number) || null;
    return null;
  };
  for (const event of input.events) {
    const entity = entityState(event);
    if (!entity) return programmeFailure('managed-event-entity-missing');
    if (event.event_type === 'lifecycle_transition' && entity.status !== event.resulting_state) return programmeFailure('comment-only-current-state-transition');
    if (event.event_type === 'lock_accepted' && entity.lock !== event.resulting_state) return programmeFailure('lock-body-stale');
    if (event.event_type === 'candidate_bound' && (event.entity.kind !== 'pr' || entity.head !== event.exact_revision)) return programmeFailure('candidate-body-stale');
    if (event.event_type === 'validation' && event.entity.kind === 'pr' && !entity.validation?.includes(event.resulting_state)) return programmeFailure('validation-body-stale');
    if (event.event_type === 'g4_or_finality' && event.entity.kind === 'pr' && entity.finality !== event.resulting_state) return programmeFailure('finality-body-stale');
    if (event.event_type === 'blocker' && event.entity.kind === 'child') {
      const represented = entity.status === event.resulting_state
        || entity.blocker_evidence?.some((entry) => entry.id === event.resulting_state && entry.current === true);
      if (!represented) return programmeFailure('blocker-body-stale');
    }
    if (event.event_type === 'dependency' && event.entity.kind === 'child') {
      const issueMatch = String(event.resulting_state).match(/^#?(\d+)$/);
      const represented = canonicalJson(entity.dependencies) === event.resulting_state
        || issueMatch && entity.dependencies.includes(Number(issueMatch[1]));
      if (!represented) return programmeFailure('dependency-body-stale');
    }
    if (event.event_type === 'owner_decision') {
      const represented = entity.status === event.resulting_state || entity.finality === event.resulting_state || entity.next_action === event.resulting_state;
      if (!represented) return programmeFailure('owner-decision-body-stale');
    }
  }
  return success('PROGRAMME_BODY_FRESH', { same_transaction_required: true });
}
function entityFromBodyKey(group, key) {
  if (group === 'parent') return { kind: 'parent', number: Number(key) };
  if (group === 'children') return { kind: 'child', number: Number(key) };
  return { kind: 'pr', number: Number(key) };
}
function bodyEntries(bodies, parentIssue) {
  const entries = [{ group: 'parent', key: String(parentIssue), body: bodies.parent }];
  for (const [key, body] of Object.entries(bodies.children || {})) entries.push({ group: 'children', key, body });
  for (const [key, body] of Object.entries(bodies.prs || {})) entries.push({ group: 'prs', key, body });
  return entries;
}
function buildProgrammePreview(input = {}) {
  const snapshot = input.snapshot;
  if (!isRecord(snapshot) || snapshot.complete !== true || !isSafeLabel(snapshot.repository || '')
    || !isSafeLabel(snapshot.revision || '') || !isRecord(snapshot.model) || !isRecord(snapshot.bodies)
    || !isRecord(snapshot.labels) || !isRecord(snapshot.label_definitions) || !Array.isArray(snapshot.managed_events)
    || !isRecord(snapshot.native)) return programmeFailure('snapshot-incomplete');
  if (!isRecord(input.desired) || input.desired.repository !== snapshot.repository) return programmeFailure('desired-repository-mismatch');
  const coverage = validatePredecessorCoverage(input.predecessor_contract);
  if (!coverage.ok) return coverage;
  const currentValid = validateProgrammeModel(snapshot.model);
  const desiredValid = validateProgrammeModel(input.desired);
  if (!currentValid.ok || !desiredValid.ok) return programmeFailure('programme-model-invalid');
  const currentEvents = validateManagedEventInventory(snapshot.managed_events, snapshot.repository);
  if (!currentEvents.ok) return currentEvents;
  const events = [];
  const requestedEventIds = new Set();
  for (const supplied of Array.isArray(input.events) ? input.events : []) {
    const normalized = normalizeManagedEvent(supplied);
    if (!normalized.ok || normalized.event.repository !== snapshot.repository || requestedEventIds.has(normalized.event.event_id)) {
      return programmeFailure('managed-event-request-invalid');
    }
    requestedEventIds.add(normalized.event.event_id);
    events.push(normalized.event);
  }
  const fresh = validateBodyFreshness({ model: input.desired, events });
  if (!fresh.ok) return fresh;
  const rendered = renderProgrammeViews(input.desired);
  if (!rendered.ok) return rendered;
  const operations = [];
  const expectedBodies = { parent: snapshot.bodies.parent, children: { ...(snapshot.bodies.children || {}) }, prs: { ...(snapshot.bodies.prs || {}) } };
  for (const entry of bodyEntries(rendered.bodies, input.desired.parent.issue)) {
    const currentBody = entry.group === 'parent' ? snapshot.bodies.parent : snapshot.bodies[entry.group]?.[entry.key];
    const kind = entry.group === 'children' ? 'child' : entry.group === 'prs' ? 'pr' : 'parent';
    const migration = unmanagedProjectionMigrationFor(input.unmanaged_projection_migrations, entry.group, entry.key);
    let desiredBody;
    let migrated = null;
    if (migration) {
      const conformance = classifyProgrammeConformance({ body: currentBody });
      if (conformance.classification === 'UNMANAGED') {
        migrated = migrateUnmanagedProjection(currentBody, entry.body, migration, {
          repository: input.desired.repository,
          parent_issue: input.desired.parent.issue,
          entity: entityFromBodyKey(entry.group, entry.key),
        });
        if (!migrated.ok) return migrated;
        desiredBody = migrated.body;
      } else if (conformance.classification === 'CURRENT_MANAGED') {
        desiredBody = mergeProgrammeBody(currentBody, entry.body, kind);
      } else {
        return programmeFailure('stale-projection-migration-conformance');
      }
    } else {
      desiredBody = mergeProgrammeBody(currentBody, entry.body, kind);
    }
    if (entry.group === 'parent') expectedBodies.parent = desiredBody;
    else expectedBodies[entry.group][entry.key] = desiredBody;
    if (currentBody !== desiredBody) operations.push({
      type: 'body.update', entity: entityFromBodyKey(entry.group, entry.key), body: desiredBody,
      body_freshness_bound: true,
      ...(migrated ? {
        stale_projection_migration: true,
        stale_projection_digest: migrated.stale_projection_digest,
        adjudication_reference: migrated.adjudication_reference,
        unrelated_prefix_preserved: true,
        unrelated_suffix_preserved: true,
      } : {}),
    });
  }
  const expectedLabels = clone(snapshot.labels);
  const expectedLabelDefinitions = clone(snapshot.label_definitions);
  for (const [name, definition] of Object.entries(PROGRAMME_LABEL_DEFINITIONS)) {
    expectedLabelDefinitions[name] = clone(definition);
    if (canonicalJson(snapshot.label_definitions[name]) !== canonicalJson(definition)) {
      operations.push({ type: 'label_definition.ensure', name, definition: clone(definition) });
    }
  }
  for (const child of input.desired.children) {
    const key = String(child.issue);
    const next = deriveManagedLabels({ native_state: child.status === 'COMPLETED' ? 'closed' : 'open', lifecycle: child.status, labels: snapshot.labels[key] || [], blocker_evidence: child.blocker_evidence || [] }).labels;
    expectedLabels[key] = next;
    if (canonicalJson(snapshot.labels[key] || []) !== canonicalJson(next)) operations.push({ type: 'labels.set', entity: { kind: 'child', number: child.issue }, labels: next, preserve_unrelated: true });
  }
  let expectedNative = clone(snapshot.native);
  let relationshipPlan = null;
  if (input.desired_native) {
    const relationship = planNativeRelationships({
      parent_issue: input.desired.parent.issue,
      current: snapshot.native,
      desired: input.desired_native,
      inspection: input._relationship_inspection,
    });
    if (!relationship.ok) return relationship;
    operations.push(...relationship.operations);
    expectedNative = relationship.expected_native;
    relationshipPlan = {
      markdown_links_canonical: relationship.markdown_links_canonical,
      blocked_label_is_derived_only: relationship.blocked_label_is_derived_only,
      unrelated_relationships_preserved: relationship.unrelated_relationships_preserved,
      supported_semantics: relationship.supported_semantics,
    };
  }
  const expectedManagedEvents = [...currentEvents.events];
  for (const event of events) {
    if (currentEvents.ids.has(event.event_id)) continue;
    expectedManagedEvents.push(event);
    operations.push({ type: 'comment.append_managed_event', entity: event.entity, event, authority_only_if_typed: true });
  }
  const expectedSnapshot = {
    ...clone(snapshot),
    model: clone(input.desired),
    bodies: expectedBodies,
    labels: expectedLabels,
    label_definitions: expectedLabelDefinitions,
    managed_events: expectedManagedEvents,
    native: expectedNative,
  };
  const boundOperations = operations.map((operation, sequence) => ({
    ...operation,
    operation_id: sha256({ repository: snapshot.repository, parent_issue: input.desired.parent.issue, sequence, operation }),
  }));
  const snapshotDigest = sha256(snapshot);
  const operationsDigest = sha256(boundOperations);
  const previewId = sha256({ repository: snapshot.repository, revision: snapshot.revision, snapshot_digest: snapshotDigest, desired: input.desired, operations: boundOperations });
  return success(boundOperations.length ? 'PROGRAMME_PREVIEW_READY' : 'PROGRAMME_ZERO_DELTA', {
    preview_id: previewId,
    repository: snapshot.repository,
    parent_issue: input.desired.parent.issue,
    current_revision: snapshot.revision,
    current_snapshot_digest: snapshotDigest,
    desired_digest: sha256(input.desired),
    operations_digest: operationsDigest,
    operations: boundOperations,
    expected_snapshot: expectedSnapshot,
    mutation_authority: false,
    body_freshness_same_transaction: true,
    unrelated_digest: snapshot.unrelated_digest,
    predecessor_coverage: coverage,
    relationship_plan: relationshipPlan,
  });
}
function verifyProgrammeReadback(readback, preview) {
  if (!isRecord(readback) || readback.complete !== true || readback.repository !== preview.repository
    || readback.unrelated_digest !== preview.unrelated_digest) return programmeFailure('readback-incomplete-or-unrelated-drift');
  const expected = preview.expected_snapshot;
  for (const key of ['model', 'bodies', 'labels', 'label_definitions', 'managed_events', 'native']) {
    if (canonicalJson(readback[key]) !== canonicalJson(expected[key])) return programmeFailure('partial-transaction-readback', { field: key });
  }
  const zero = buildProgrammePreview({ snapshot: readback, desired: expected.model, predecessor_contract: preview.predecessor_contract || preview._predecessor_contract || null });
  if (!zero.ok || zero.operations.length !== 0 || zero.code !== 'PROGRAMME_ZERO_DELTA') {
    return programmeFailure('immediate-rerun-not-zero-delta');
  }
  return success('PROGRAMME_READBACK_VERIFIED', { readback_verified: true, unrelated_state_preserved: true, zero_delta_expected: true, zero_delta_probe: true });
}
function createProgrammeRuntime(options = {}) {
  const adapter = options.adapter;
  const predecessorContract = options.predecessor_contract;
  const authorityVerifier = options.authority_verifier;
  const acceptedPreviews = new Map();
  function inspect() {
    if (typeof adapter?.inspectProgramme !== 'function') return programmeFailure('programme-adapter-missing');
    try { return adapter.inspectProgramme(); } catch (_error) { return programmeFailure('programme-inspection-failed'); }
  }
  function preview(input = {}) {
    const inspected = inspect();
    if (!isRecord(inspected) || inspected.ok === false) return inspected?.ok === false ? inspected : programmeFailure('programme-inspection-failed');
    if (inspected.repository !== input.repository) return programmeFailure('repository-identity-mismatch');
    let relationshipInspection;
    if (input.desired_native) {
      const trusted = trustedRelationshipInspection(adapter, {
        repository: input.repository,
        parent_issue: input.desired?.parent?.issue,
        programme_children: input.desired?.children?.map((child) => child.issue) || [],
      });
      if (!trusted.ok) return trusted;
      relationshipInspection = trusted.inspection;
    }
    const result = buildProgrammePreview({
      snapshot: inspected, desired: input.desired, predecessor_contract: predecessorContract,
      events: input.events, desired_native: input.desired_native, _relationship_inspection: relationshipInspection,
      unmanaged_projection_migrations: input.unmanaged_projection_migrations,
    });
    if (result.ok) {
      const bound = { ...result, _predecessor_contract: predecessorContract };
      acceptedPreviews.set(result.preview_id, sha256(bound));
      return bound;
    }
    return result;
  }
  function apply(input = {}) {
    const previewResult = input.preview;
    const assertion = input.authority;
    if (!isRecord(previewResult) || !previewResult.ok || !isRecord(assertion)
      || acceptedPreviews.get(previewResult.preview_id) !== sha256(previewResult)) return programmeFailure('explicit-preview-bound-authority-required');
    if (previewResult.operations.length === 0) return success('PROGRAMME_ZERO_DELTA', { mutation_count: 0, readback_verified: true });
    if (typeof authorityVerifier !== 'function') return programmeFailure('trusted-authority-verifier-required');
    let verifiedAuthority;
    const binding = {
      repository: previewResult.repository,
      parent_issue: previewResult.parent_issue,
      preview_id: previewResult.preview_id,
      expected_revision: previewResult.current_revision,
      current_snapshot_digest: previewResult.current_snapshot_digest,
      desired_digest: previewResult.desired_digest,
      operations_digest: previewResult.operations_digest,
      operation_ids: previewResult.operations.map((operation) => operation.operation_id),
    };
    try { verifiedAuthority = authorityVerifier({ assertion: clone(assertion), binding: clone(binding) }); }
    catch (_error) { return programmeFailure('trusted-authority-verification-failed'); }
    const grant = verifiedAuthority?.grant;
    if (verifiedAuthority?.ok !== true || !isRecord(grant) || !isSafeLabel(grant.reference || '')
      || grant.reference !== assertion.reference
      || grant.repository !== binding.repository || grant.parent_issue !== binding.parent_issue
      || grant.preview_id !== binding.preview_id || grant.expected_revision !== binding.expected_revision
      || grant.current_snapshot_digest !== binding.current_snapshot_digest
      || grant.desired_digest !== binding.desired_digest || grant.operations_digest !== binding.operations_digest
      || canonicalJson(grant.operation_ids) !== canonicalJson(binding.operation_ids)) {
      return programmeFailure('explicit-preview-bound-authority-required');
    }
    const current = inspect();
    if (!isRecord(current) || current.ok === false || current.revision !== previewResult.current_revision
      || sha256(current) !== previewResult.current_snapshot_digest) return programmeFailure('stale-preview');
    if (typeof adapter.applyOperations !== 'function') return programmeFailure('programme-apply-adapter-missing');
    let applied;
    try {
      applied = adapter.applyOperations({
        repository: previewResult.repository,
        parent_issue: previewResult.parent_issue,
        revision: previewResult.current_revision,
        preview_id: previewResult.preview_id,
        authority_ref: grant.reference,
        operations: clone(previewResult.operations),
        expected_snapshot: clone(previewResult.expected_snapshot),
      });
    } catch (_error) { return programmeFailure('apply-failed'); }
    if (!isRecord(applied) || applied.ok !== true) return programmeFailure('apply-failed');
    const readback = inspect();
    const verified = verifyProgrammeReadback(readback, previewResult);
    if (!verified.ok) return { ...verified, applied_count: applied.applied_count || 0 };
    acceptedPreviews.delete(previewResult.preview_id);
    return success('PROGRAMME_RECONCILED', {
      preview_id: previewResult.preview_id,
      applied_count: applied.applied_count ?? previewResult.operations.length,
      readback_verified: true,
      unrelated_state_preserved: true,
      immediate_rerun: 'ZERO_DELTA',
    });
  }
  return Object.freeze({ preview, apply });
}
function validateArchitectureReset(input = {}) {
  const coverage = validatePredecessorCoverage(input.predecessor_contract);
  if (!coverage.ok) return coverage;
  const activeTransfers = input.predecessor_contract.predecessors.flatMap((entry) => entry.criteria).filter((criterion) => criterion.disposition === 'TRANSFERRED' && criterion.programme_blocking);
  return success('PROGRAMME_ARCHITECTURE_RESET_VALID', { active_transferred_criteria: activeTransfers.length, orphaned_predecessor_criteria: 0 });
}
function assureTransferredPredecessors(contract, statuses = {}) {
  const coverage = validatePredecessorCoverage(contract);
  if (!coverage.ok) return coverage;
  const activeTransfers = contract.predecessors.flatMap((entry) => entry.criteria).filter((criterion) => criterion.disposition === 'TRANSFERRED' && criterion.programme_blocking);
  const unresolved = activeTransfers.filter((criterion) => !['RESOLVED', 'SATISFIED', 'SUPERSEDED_BY_STRONGER_IMPLEMENTATION', 'NO_LONGER_APPLICABLE'].includes(statuses[criterion.id]));
  if (unresolved.length) return failure('UNMAPPED_PREDECESSOR_OBLIGATION', { reason: 'active-transferred-criteria-unresolved', unresolved: unresolved.map((criterion) => criterion.id) });
  return success('PROGRAMME_S6_PREDECESSOR_ASSURANCE_VALID', { active_transferred_criteria: activeTransfers.length, unresolved_active_transfers: 0 });
}

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
    terminal_evidence_adapter: 'first-party-getTerminalEvidence',
    caller_durable_evidence: 'equality-assertion-only',
    legacy_migration_versions: [LEGACY_V0_VERSION, TRACKER_VERSION], legacy_migration_exact: true,
    legacy_whole_body_digest_target: true,
  };
}

function markerCount(text, marker) { return String(text).split(marker).length - 1; }
function n5MarkerFamilyResidue(body) {
  if (typeof body !== 'string') return false;
  return /<!--[ \t\u00a0]*AI-AGENT-TOOLKIT[ \t\u00a0]*:[ \t\u00a0]*N5[ \t\u00a0]*-[ \t\u00a0]*(?:PARENT|CHILD|PR|STATE)(?![A-Z0-9_-])/i.test(body);
}
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
    if (options.durable_evidence !== undefined) {
      const assertion = terminalEvidenceAssertionFor(item, options.durable_evidence);
      const asserted = normalizeDurableEvidence(item, assertion);
      if (!asserted.ok || canonicalJson(asserted.evidence) !== canonicalJson(verified.evidence)) {
        return failure('PARENT_BODY_LIMIT', { compacted: false, proof_required: true, affected_child: item.child_id });
      }
    }
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
    || !isDigest(inventory.evidence_binding_digest)
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
function incompleteReviewInventory(reason = 'trusted-evidence-required') {
  const inventory_digest = sha256({ version: REVIEW_INVENTORY_VERSION, status: 'incomplete', reason });
  return failure('N5_REVIEW_INVENTORY_INCOMPLETE', {
    review: {
      current: false,
      complete: false,
      server_authoritative: false,
      verifiable: false,
      inventory_digest,
      findings: [],
    },
  });
}
function normalizePaginationEvidence(value, arrays) {
  if (!isRecord(value)) return null;
  const pagination = {};
  const evidence = {};
  for (const key of ['pull_requests', 'submitted_reviews', 'inline_conversations']) {
    const source = value[key];
    if (typeof source === 'boolean') {
      pagination[key] = source;
      evidence[key] = { complete: source, pages: null, cursor: null, count: null };
      continue;
    }
    if (!isRecord(source) || typeof source.complete !== 'boolean') return null;
    const pages = source.pages === undefined ? null : source.pages;
    const cursor = source.cursor === undefined ? null : source.cursor;
    const count = source.count === undefined ? null : source.count;
    if (pages !== null && (!Number.isSafeInteger(pages) || pages < 1)
      || cursor !== null && !isSafeLabel(cursor)
      || count !== null && (!Number.isSafeInteger(count) || count < 0)) return null;
    pagination[key] = source.complete;
    evidence[key] = { complete: source.complete, pages, cursor, count };
  }
  if (!Object.keys(pagination).every((key) => Array.isArray(arrays[key]))) return null;
  return { pagination, evidence };
}
function normalizeAuthoritativeCounts(value, arrays, paginationEvidence) {
  const source = isRecord(value) ? value : null;
  const counts = {};
  for (const key of ['pull_requests', 'submitted_reviews', 'inline_conversations']) {
    const candidate = source && hasOwn(source, key) ? source[key] : paginationEvidence[key].count;
    const pageCount = paginationEvidence[key]?.count ?? null;
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate !== arrays[key].length || pageCount !== null && pageCount !== candidate) return null;
    counts[key] = candidate;
  }
  return counts;
}
function normalizedReviewEvidenceForDigest(value = {}) {
  const arrays = {
    pull_requests: Array.isArray(value.pull_requests) ? value.pull_requests.map(normalizePullRequest) : [],
    submitted_reviews: Array.isArray(value.submitted_reviews) ? value.submitted_reviews.map(normalizeSubmittedReview) : [],
    inline_conversations: Array.isArray(value.inline_conversations) ? value.inline_conversations.map(normalizeInlineConversation) : [],
  };
  const paginationSource = value.pagination_evidence || value.pagination || {};
  const pagination = normalizePaginationEvidence(paginationSource, arrays);
  const paginationEvidence = pagination?.evidence || {
    pull_requests: null,
    submitted_reviews: null,
    inline_conversations: null,
  };
  const paginationFlags = pagination?.pagination || {
    pull_requests: false,
    submitted_reviews: false,
    inline_conversations: false,
  };
  const rawFindings = value.finding_evidence || value.findings;
  const findings = Array.isArray(rawFindings) ? rawFindings.map(normalizeFindingEvidence) : [];
  return {
    version: REVIEW_EVIDENCE_VERSION,
    repository: value.repository ?? null,
    pr_number: value.pr_number ?? value.current_candidate?.pr_number ?? value.current_candidate?.number ?? null,
    current_candidate: normalizeCandidate(value.current_candidate || value.candidate) || null,
    expected_candidate: normalizeCandidate(value.expected_candidate) || null,
    pagination: paginationFlags,
    pagination_evidence: paginationEvidence,
    authoritative_counts: value.authoritative_counts || value.counts || null,
    pull_requests: arrays.pull_requests,
    submitted_reviews: arrays.submitted_reviews,
    inline_conversations: arrays.inline_conversations,
    finding_evidence: findings,
    stale: value.stale === true,
    unavailable: value.unavailable === true,
    complete: value.complete === true,
    server_authoritative: value.server_authoritative === true,
    verifiable: value.verifiable === true,
  };
}
function reviewEvidenceDigest(value = {}) {
  return sha256(normalizedReviewEvidenceForDigest(value));
}
function normalizeTrustedReviewEvidence(value) {
  if (!isRecord(value)
    || !isSafeLabel(value.repository)
    || !isIssue(value.pr_number)
    || !hasOwn(value, 'current_candidate')
    || !hasOwn(value, 'expected_candidate')
    || !Array.isArray(value.pull_requests)
    || !Array.isArray(value.submitted_reviews)
    || !Array.isArray(value.inline_conversations)
    || !(Array.isArray(value.finding_evidence) || Array.isArray(value.findings))
    || !isRecord(value.pagination)
    || !isRecord(value.pagination_evidence)
    || !(isRecord(value.authoritative_counts) || isRecord(value.counts))
    || typeof value.stale !== 'boolean'
    || typeof value.unavailable !== 'boolean'
    || typeof value.server_authoritative !== 'boolean'
    || typeof value.verifiable !== 'boolean'
    || typeof value.complete !== 'boolean') return null;
  const current_candidate = normalizeCandidate(value.current_candidate);
  const expected_candidate = normalizeCandidate(value.expected_candidate);
  if (!current_candidate || !expected_candidate || current_candidate.pr_number !== value.pr_number
    || canonicalJson(current_candidate) !== canonicalJson(expected_candidate)) return null;
  const arrays = {
    pull_requests: value.pull_requests.map(normalizePullRequest),
    submitted_reviews: value.submitted_reviews.map(normalizeSubmittedReview),
    inline_conversations: value.inline_conversations.map(normalizeInlineConversation),
  };
  if (Object.values(arrays).some((items) => items.some((item) => item === null))) return null;
  const pagination = normalizePaginationEvidence(value.pagination_evidence, arrays);
  if (!pagination) return null;
  const callerPagination = normalizeCallerPaginationAssertion(value.pagination);
  if (!callerPagination || canonicalJson(callerPagination) !== canonicalJson(pagination.pagination)) return null;
  if (hasOwn(value, 'authoritative_counts') && hasOwn(value, 'counts')
    && (!isRecord(value.authoritative_counts) || !isRecord(value.counts)
      || canonicalJson(value.authoritative_counts) !== canonicalJson(value.counts))) return null;
  const countSource = hasOwn(value, 'authoritative_counts') ? value.authoritative_counts : value.counts;
  const authoritative_counts = normalizeAuthoritativeCounts(countSource, arrays, pagination.evidence);
  if (!authoritative_counts) return null;
  const rawFindings = hasOwn(value, 'finding_evidence') ? value.finding_evidence : value.findings;
  if (!Array.isArray(rawFindings)) return null;
  const finding_evidence = rawFindings.map(normalizeFindingEvidence);
  if (finding_evidence.some((item) => item === null)) return null;
  if (hasOwn(value, 'finding_evidence') && hasOwn(value, 'findings')) {
    if (!Array.isArray(value.findings)) return null;
    const aliasFindings = value.findings.map(normalizeFindingEvidence);
    if (aliasFindings.some((item) => item === null) || canonicalJson(aliasFindings) !== canonicalJson(finding_evidence)) return null;
  }
  const normalized = {
    repository: value.repository,
    pr_number: value.pr_number,
    current_candidate,
    expected_candidate,
    pagination: pagination.pagination,
    pagination_evidence: pagination.evidence,
    authoritative_counts,
    pull_requests: arrays.pull_requests,
    submitted_reviews: arrays.submitted_reviews,
    inline_conversations: arrays.inline_conversations,
    finding_evidence,
    stale: value.stale,
    unavailable: value.unavailable,
    complete: value.complete,
    server_authoritative: value.server_authoritative,
    verifiable: value.verifiable,
  };
  const representedPr = arrays.pull_requests.find((item) => item.number === current_candidate.pr_number) || null;
  if (!representedPr || !['head', 'tree', 'base'].every((key) => isSha(representedPr[key]) && representedPr[key] === current_candidate[key])) return null;
  const computed = reviewEvidenceDigest(normalized);
  const supplied = ['evidence_digest', 'evidence_binding_digest', 'inventory_digest']
    .filter((key) => hasOwn(value, key))
    .map((key) => value[key]);
  if (supplied.length === 0 || supplied.some((digest) => !isDigest(digest) || digest !== computed)) return null;
  return { ...normalized, evidence_digest: computed };
}
function normalizeCallerPaginationAssertion(value) {
  if (!isRecord(value)) return null;
  const result = {};
  for (const key of ['pull_requests', 'submitted_reviews', 'inline_conversations']) {
    const item = value[key];
    result[key] = item === true || (isRecord(item) && item.complete === true);
    if (item !== true && item !== false && (!isRecord(item) || typeof item.complete !== 'boolean')) return null;
  }
  return result;
}
function callerReviewEvidenceMatches(input, trusted) {
  const compareArray = (key, normalizer, trustedKey = key) => {
    if (!hasOwn(input, key)) return true;
    if (!Array.isArray(input[key])) return false;
    const normalized = input[key].map(normalizer);
    return normalized.every((item) => item !== null) && canonicalJson(normalized) === canonicalJson(trusted[trustedKey]);
  };
  for (const [key, normalizer] of [['pull_requests', normalizePullRequest], ['submitted_reviews', normalizeSubmittedReview], ['inline_conversations', normalizeInlineConversation]]) {
    if (!compareArray(key, normalizer)) return false;
  }
  for (const key of ['repository', 'pr_number', 'stale', 'unavailable', 'complete', 'server_authoritative', 'verifiable']) {
    if (hasOwn(input, key) && input[key] !== trusted[key]) return false;
  }
  for (const [key, trustedKey] of [['current_candidate', 'current_candidate'], ['expected_candidate', 'expected_candidate'], ['candidate', 'current_candidate']]) {
    if (hasOwn(input, key)) {
      const candidate = normalizeCandidate(input[key]);
      if (!candidate || canonicalJson(candidate) !== canonicalJson(trusted[trustedKey])) return false;
    }
  }
  if (hasOwn(input, 'pagination')) {
    const pagination = normalizeCallerPaginationAssertion(input.pagination);
    if (!pagination || canonicalJson(pagination) !== canonicalJson(trusted.pagination)) return false;
  }
  if (hasOwn(input, 'authoritative_counts') || hasOwn(input, 'counts')) {
    if (hasOwn(input, 'authoritative_counts') && hasOwn(input, 'counts')
      && (!isRecord(input.authoritative_counts) || !isRecord(input.counts)
        || canonicalJson(input.authoritative_counts) !== canonicalJson(input.counts))) return false;
    const counts = hasOwn(input, 'authoritative_counts') ? input.authoritative_counts : input.counts;
    if (!isRecord(counts) || canonicalJson(counts) !== canonicalJson(trusted.authoritative_counts)) return false;
  }
  for (const key of ['findings', 'finding_evidence']) {
    if (hasOwn(input, key)) {
      if (!Array.isArray(input[key])) return false;
      const findings = input[key].map(normalizeFindingEvidence);
      if (findings.some((item) => item === null) || canonicalJson(findings) !== canonicalJson(trusted.finding_evidence)) return false;
    }
  }
  if (hasOwn(input, 'pagination_evidence')) {
    const pagination = normalizePaginationEvidence(input.pagination_evidence, trusted);
    if (!pagination || canonicalJson(pagination.evidence) !== canonicalJson(trusted.pagination_evidence)) return false;
  }
  if (hasOwn(input, 'evidence_digest') && input.evidence_digest !== trusted.evidence_digest) return false;
  if (hasOwn(input, 'evidence_binding_digest') && input.evidence_binding_digest !== trusted.evidence_digest) return false;
  if (hasOwn(input, 'inventory_digest') && input.inventory_digest !== trusted.evidence_digest) return false;
  if (hasOwn(input, 'evidence_status')) {
    const expected = trusted.stale ? 'stale' : trusted.unavailable ? 'unavailable' : 'current';
    if (input.evidence_status !== expected) return false;
  }
  return true;
}
function buildReviewInventory(input = {}) {
  const adapter = input.evidence_adapter;
  if (!isRecord(adapter) || typeof adapter.getReviewEvidence !== 'function') return incompleteReviewInventory();
  let result;
  try {
    result = adapter.getReviewEvidence({
      repository: input.repository,
      pr_number: input.pr_number || input.current_candidate?.pr_number || null,
      current_candidate: clone(input.current_candidate),
      expected_candidate: clone(input.expected_candidate),
    });
  } catch (_error) {
    return incompleteReviewInventory('adapter-read-failed');
  }
  if (!isRecord(result) || result.ok === false) return incompleteReviewInventory('adapter-result-invalid');
  const evidence = result.ok === true ? result.evidence : result;
  if (!isRecord(evidence)) return incompleteReviewInventory('adapter-evidence-missing');
  const trusted = normalizeTrustedReviewEvidence({
    ...evidence,
    ...(hasOwn(result, 'evidence_digest') && !hasOwn(evidence, 'evidence_digest') ? { evidence_digest: result.evidence_digest } : {}),
  });
  if (!trusted || trusted.stale || trusted.unavailable || trusted.complete !== true || trusted.server_authoritative !== true || trusted.verifiable !== true
    || !Object.values(trusted.pagination).every((value) => value === true)) return incompleteReviewInventory('trusted-evidence-incomplete');
  if (!callerReviewEvidenceMatches(input, trusted)) return incompleteReviewInventory('caller-evidence-mismatch');
  const inventoryBase = {
    version: REVIEW_INVENTORY_VERSION,
    repository: trusted.repository,
    pr_number: trusted.pr_number,
    candidate: trusted.current_candidate,
    expected_candidate: trusted.expected_candidate,
    pagination: trusted.pagination,
    pagination_evidence: trusted.pagination_evidence,
    authoritative_counts: trusted.authoritative_counts,
    pull_requests: trusted.pull_requests,
    submitted_reviews: trusted.submitted_reviews,
    inline_conversations: trusted.inline_conversations,
    finding_evidence: trusted.finding_evidence,
    stale: trusted.stale,
    unavailable: trusted.unavailable,
    complete: true,
    server_authoritative: true,
    verifiable: true,
    evidence_binding_digest: trusted.evidence_digest,
  };
  const inventory = { ...inventoryBase, inventory_digest: trusted.evidence_digest };
  const review = projectA4Review(inventory);
  return review.ok === false
    ? review
    : success('N5_INSPECTION_READY', { inventory, review });
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
    || !['nonblocking', 'material'].includes(record.materiality)
    || record.materiality === 'material' && !['PROMOTED_TO_EXISTING_CHILD', 'PROMOTED_TO_CHILD'].includes(record.disposition)
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
function normalizeFreshRevalidationFinding(source) {
  if (!isRecord(source)) return null;
  const predicates = source.predicates;
  const exclusions = source.exclusions;
  if (!isRecord(predicates)
    || !A4_MATERIAL_PREDICATES.every((key) => hasOwn(predicates, key) && typeof predicates[key] === 'boolean')
    || !Array.isArray(exclusions)
    || !exclusions.every((item) => A4_EXCLUSIONS.includes(item))) return null;
  const normalized = isRecord(source.provenance)
    ? normalizeFindingEvidence(source)
    : classifyFinding(source).finding;
  return normalized || null;
}
function freshFindingMatchesRecord(source, finding, record) {
  const provenance = finding.provenance;
  if (finding.id !== record.finding_id
    || provenance.source_pr !== record.source_pr
    || provenance.source_thread !== record.source_thread
    || canonicalJson(provenance.source_candidate) !== canonicalJson(record.source_candidate)
    || provenance.source_candidate.head !== record.source_head
    || (provenance.public_source_ref ?? null) !== record.public_source_ref) return false;
  const freshRoot = deferredRootDigest(finding);
  if (freshRoot !== record.root_digest) return false;
  if (hasOwn(source, 'evidence_digest') && source.evidence_digest !== finding.evidence_digest) return false;
  if (hasOwn(source, 'root_digest') && source.root_digest !== freshRoot) return false;
  return true;
}
function revalidateDeferredFinding(input = {}) {
  const initial = validateDeferredFindingRecord(clone(input.record || {}));
  if (!initial.ok) return initial;
  const source = input.fresh_finding || input.finding || input.fresh_evidence;
  const finding = normalizeFreshRevalidationFinding(source);
  if (!finding || !freshFindingMatchesRecord(source, finding, initial.record)) return failure('N5_DF_AMBIGUOUS');
  const material = finding.materiality === 'material';
  if (hasOwn(input, 'material') && input.material !== material) return failure('N5_DF_AMBIGUOUS');
  if (hasOwn(input, 'evidence_digest') && input.evidence_digest !== finding.evidence_digest) return failure('N5_DF_AMBIGUOUS');
  const freshRoot = deferredRootDigest(finding);
  const record = {
    ...clone(initial.record),
    text: finding.text,
    path: finding.provenance.path ?? null,
    line: finding.provenance.line ?? null,
    public_source_ref: finding.provenance.public_source_ref ?? null,
    component: finding.component,
    predicates: finding.predicates,
    exclusions: finding.exclusions,
    materiality: finding.materiality,
    evidence_digest: finding.evidence_digest,
    root_digest: freshRoot,
    linked_child: null,
  };
  if (!material) {
    if (hasOwn(input, 'disposition') && ['PROMOTED_TO_EXISTING_CHILD', 'PROMOTED_TO_CHILD'].includes(input.disposition)) return failure('N5_DF_AMBIGUOUS');
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
      return failure('N5_AUTHORITY_REQUIRED', { record: initial.record, promotion: 'scope_decision_required' });
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
    return failure('N5_AUTHORITY_REQUIRED', { record: initial.record, promotion: 'controller_authorised_direct_sibling_required' });
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
        if (n5MarkerFamilyResidue(existing.prefix) || n5MarkerFamilyResidue(existing.suffix)) return failure('PARENT_PARSE_UNCERTAIN');
        if (canonicalJson(existing.state) === canonicalJson(auth.mutation_scope.update.state)) return success('N5_NOOP', { projection: boundedProjection(existing.state, existing), transition_id: sha256({ repository: request.repository, parent_issue: request.parent_issue, before: existing.body_digest }) });
        return failure('N5_SCOPE_REJECTED');
      }
      const legacy = parseLegacyParent(first.fetched.body, { complete: first.fetched.complete !== false });
      if (legacy.ok || legacy.legacy === true) return failure('N5_SCOPE_REJECTED', { migration_required: true, source_version: legacy.source_version || LEGACY_V0_VERSION, source_body_digest: legacy.body_digest || sha256(first.fetched.body) });
      if (n5MarkerFamilyResidue(first.fetched.body)) return failure('PARENT_PARSE_UNCERTAIN');
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
  CONTRACT_VERSION, REVIEW_INVENTORY_VERSION, REVIEW_EVIDENCE_VERSION, TRACKER_VERSION, LEGACY_V0_VERSION, DESIGN_LOCK, INTENTS, RESOURCE_KINDS, LIFECYCLES,
  OBJECTIVE_STATUSES, MUTATION_TARGET_KINDS,
  A4_MATERIAL_PREDICATES, A4_EXCLUSIONS, DF_TRIGGERS, DF_DISPOSITIONS, REVIEW_DISPOSITIONS, MANAGED_MARKERS,
  SECTION_ORDER, FAILURE_CODES, SUCCESS_CODES, RED_FIRST_CASES, PREDECESSOR_AUTHORITY_REF, PREDECESSOR_ISSUE_ROSTER, PREDECESSOR_DISPOSITIONS, PREDECESSOR_MATRIX_SHA256, MANAGED_EVENT_TYPES, CONFORMANCE_CLASSES, PROGRAMME_MANAGED_LABELS, PR_REGISTRY_STATUSES, GITHUB_RELATIONSHIP_API_VERSION, PROGRAMME_MARKERS, canonicalJson, sha256, isDigest, isSha,
  isPublicSafeEvidence, validatePredecessorCoverage, validateProgrammeModel, renderProgrammeViews, parseProgrammeView, classifyProgrammeConformance, renderManagedEvent, parseManagedEvent, deriveManagedLabels, planPrAssociations, planNativeRelationships, programmeLifecyclePreflight, validateBodyFreshness, buildProgrammePreview, verifyProgrammeReadback, createProgrammeRuntime, validateArchitectureReset, assureTransferredPredecessors, authorityBoundary, transactionContract, renderManagedBlock, parseManagedBlock,
  replaceManagedBlock, validateTracker, boundedProjection, classifyBodyLimit, compactTerminal, applyBoundedUpdate,
  buildReviewInventory, evaluateMateriality, classifyFinding, normalizeFindingEvidence, authorizeReviewMutation, resolveFinding,
  registerDeferredFinding, validateDeferredFindingRecord, revalidateDeferredFinding, projectA4Review, codexReviewState, autoCodeReadiness, adjudicateHistoricalPr310,
  findingEvidenceDigest, deferredRootDigest, reviewEvidenceDigest, durableEvidenceDigest, normalizeDurableEvidence, parseLegacyParent, rejectHistoricalRevival, nextAction, createRuntime,
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
    pr: pr === null ? null : { number: pr.number, state: pr.state || null, public_source_ref: pr.public_source_ref },
    accepted_commit: accepted === null ? null : { sha: accepted.sha, public_source_ref: accepted.public_source_ref },
  };
}
function durableEvidenceDigest(item, proof) {
  return sha256(durableEvidencePayload(item, proof));
}
function terminalProofFor(item, options = {}) {
  const adapter = options.evidence_adapter || null;
  if (typeof adapter?.getTerminalEvidence !== 'function') return null;
  let result;
  try { result = adapter.getTerminalEvidence({ item: clone(item), child_issue: item.issue_number }); } catch (_error) { return null; }
  if (!isRecord(result) || result.ok === false) return null;
  const proof = result.ok === true ? result.evidence : result;
  if (!isRecord(proof)) return null;
  return hasOwn(result, 'evidence_digest') && !hasOwn(proof, 'evidence_digest')
    ? { ...proof, evidence_digest: result.evidence_digest }
    : proof;
}
function terminalEvidenceAssertionFor(item, source) {
  if (Array.isArray(source)) return source.find((entry) => isRecord(entry) && (entry.child_issue === item.issue_number || entry.child_id === item.child_id)) || null;
  if (isRecord(source) && (source.child_issue === item.issue_number || source.child_id === item.child_id)) return source;
  if (isRecord(source)) return source[item.child_id] || source[String(item.issue_number)] || null;
  return null;
}
function normalizeDurableEvidence(item, proof) {
  if (!isRecord(item) || !isRecord(proof)
    || proof.server_authoritative !== true
    || proof.verifiable !== true
    || proof.complete !== true
    || proof.child_id !== item.child_id
    || proof.child_issue !== item.issue_number
    || !isSafePublicRef(proof.parent_chronology_ref)
    || !['accepted', 'disposed'].includes(proof.disposition)
    || !isSafeLabel(proof.outcome || '')) return failure('PARENT_BODY_LIMIT');
  if (item.outcome !== undefined && item.outcome !== null && proof.outcome !== item.outcome) return failure('PARENT_BODY_LIMIT');
  if (item.objective_status === 'completed' && proof.disposition !== 'accepted') return failure('PARENT_BODY_LIMIT');
  const represented = representedPrNumber(item);
  if (represented.invalid) return failure('PARENT_BODY_LIMIT');
  let pr = null;
  if (represented.number !== null) {
    if (!isRecord(proof.pr) || proof.pr.number !== represented.number || !isSafePublicRef(proof.pr.public_source_ref)) return failure('PARENT_BODY_LIMIT');
    if (item.implementation_pr?.state !== undefined && proof.pr.state !== item.implementation_pr.state) return failure('PARENT_BODY_LIMIT');
    pr = {
      number: proof.pr.number,
      ...(proof.pr.state === undefined ? {} : { state: proof.pr.state }),
      public_source_ref: proof.pr.public_source_ref,
    };
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
function normalizeLegacyResidueText(value) {
  return String(value)
    .trim()
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
function legacyAuthorityResidue(body) {
  if (typeof body !== 'string') return false;
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => normalizeLegacyResidueText(match[1]));
  const knownHeadings = new Set(LEGACY_SECTION_ORDER.map(normalizeLegacyResidueText));
  const knownHeadingCount = headings.filter((heading) => knownHeadings.has(heading)).length;
  const versionMarker = body.split(/\r?\n/).some((line) => /^-\s*(?:legacy tracker version|tracker version|format version)\s*:\s*pre-n5-/.test(normalizeLegacyResidueText(line)));
  const ambiguousSevenSectionBody = headings.length === LEGACY_SECTION_ORDER.length
    && headings.some((heading) => /authority|reconciliation/.test(heading))
    && headings.some((heading) => /execution|queue|completion/.test(heading));
  return knownHeadingCount > 0 || versionMarker || ambiguousSevenSectionBody;
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
