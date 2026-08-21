'use strict';

const DESIGN_LOCK_ID = 'DL-AGENT-NATIVE-LOOP-MVP-001-A4-INDEPENDENT-ASSURANCE-WEB-FINALITY-R1';
const CONTRACT_VERSION = 'toolkit.assurance-web-finality.evidence.v1';
const G4_AUTHORITY = 'read-only-assurance';
const G4_MODEL = 'GPT-5.6 Sol High';
const G4A_MODEL = 'GPT-5.6 Sol Max';

const MATERIAL_PREDICATES = Object.freeze([
  'applies_to_current_candidate',
  'identifies_accepted_requirement',
  'concrete_current_failure',
  'evidence_reproducible',
  'material_impact',
  'in_scope_current',
]);

const EXCLUSION_FLAGS = Object.freeze([
  'stale',
  'duplicate_root',
  'optional',
  'speculative',
  'hypothetical_future',
  'cleaner_architecture_only',
  'outside_scope',
]);

const FORBIDDEN_REPORT_KEYS = /^(raw|prompt|model_output|tool_output|provider_payload|a1_ticket|ticket|issuer|token|secret|credential|password|environment|env|cookie|auth_header|absolute_path|customer|raw_diagnostic_payload|diagnostic_payload)/i;
const FORBIDDEN_REPORT_VALUE = /(?:https?:\/\/|^(?:[A-Za-z]:[\\/]|[\\/])|(?:^|[\\/])(?:Users[\\/]|home[\\/]|var[\\/]|tmp[\\/]))/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSafeId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && /^[A-Za-z0-9._:/-]+$/.test(value)
    && !value.includes('..')
    && !value.includes('://');
}

function isSafeLabel(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !FORBIDDEN_REPORT_VALUE.test(value)
    && /^[A-Za-z0-9 .:_/-]+$/.test(value)
    && !value.includes('..')
    && !value.includes('://');
}

function isSafeRelativeScopeId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !/[\0\r\n\t\\]/.test(value)
    && !value.includes('..')
    && !value.includes('//')
    && value.split('/').every((part) => part && part !== '.')
    && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function isSafePublicRef(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9._:/#-]+$/.test(value)
    && !value.includes('..')
    && !value.includes('://');
}

function hasTrue(record, key) {
  return isRecord(record) && record[key] === true;
}

function fail(code, fields = {}) {
  return { ok: false, code, ...fields };
}

function valid(code, fields = {}) {
  return { ok: true, code, ...fields };
}

function requiredEvidenceFailures(input) {
  const failures = [];
  if (!isRecord(input)) return ['evidence-record-missing'];
  if (input.contract_version !== CONTRACT_VERSION) failures.push('evidence-contract-version-invalid');
  if (Object.prototype.hasOwnProperty.call(input, 'findings')) failures.push('review-findings-shadow-source');

  const { candidate, pr, lock, scope, g4, review, required_checks: checks, ledger } = input;
  if (!isRecord(candidate)) failures.push('candidate-identity-missing');
  else {
    for (const key of ['head', 'tree', 'base']) {
      if (!isSha(candidate[key])) failures.push('candidate-' + key + '-invalid');
    }
    if (!hasTrue(candidate, 'current')) failures.push('candidate-not-current');
  }

  if (!isRecord(pr)) failures.push('pr-topology-missing');
  else {
    if (!Number.isSafeInteger(pr.number) || pr.number < 1) failures.push('pr-number-invalid');
    if (!isSha(pr.head) || !candidate || pr.head !== candidate.head) failures.push('pr-head-conflict');
    if (!isSha(pr.tree) || !candidate || pr.tree !== candidate.tree) failures.push('pr-tree-conflict');
    if (!isSha(pr.base) || !candidate || pr.base !== candidate.base) failures.push('pr-base-conflict');
    if (pr.base_ref !== 'main') failures.push('pr-base-ref-invalid');
    if (!hasTrue(pr, 'open')) failures.push('pr-not-open');
    if (!hasTrue(pr, 'server_authoritative')) failures.push('pr-not-authoritative');
    if (!hasTrue(pr, 'verifiable')) failures.push('pr-not-verifiable');
  }

  if (!isRecord(lock)) failures.push('accepted-lock-missing');
  else {
    if (lock.id !== DESIGN_LOCK_ID) failures.push('accepted-lock-conflict');
    if (!hasTrue(lock, 'current')) failures.push('accepted-lock-stale');
    if (!hasTrue(lock, 'server_authoritative')) failures.push('accepted-lock-not-authoritative');
    if (!hasTrue(lock, 'verifiable')) failures.push('accepted-lock-not-verifiable');
  }

  if (!isRecord(scope)) failures.push('authorised-scope-missing');
  else {
    if (!isDigest(scope.digest)) failures.push('authorised-scope-digest-invalid');
    if (!hasTrue(scope, 'current')) failures.push('authorised-scope-stale');
    if (!hasTrue(scope, 'authorised')) failures.push('authorised-scope-not-authorised');
    if (!hasTrue(scope, 'server_authoritative')) failures.push('authorised-scope-not-authoritative');
    if (!hasTrue(scope, 'verifiable')) failures.push('authorised-scope-not-verifiable');
  }

  failures.push(...g4AdmissionFailures(input));

  if (!isRecord(review)) failures.push('review-inventory-missing');
  else {
    for (const key of ['current', 'complete', 'server_authoritative', 'verifiable']) {
      if (!hasTrue(review, key)) failures.push('review-' + key + '-failed');
    }
    if (!isDigest(review.inventory_digest)) failures.push('review-inventory-digest-invalid');
    if (!Array.isArray(review.findings)) failures.push('review-findings-missing');
  }

  if (!isRecord(checks)) failures.push('required-check-inventory-missing');
  else {
    for (const key of ['current', 'complete', 'server_authoritative', 'verifiable']) {
      if (!hasTrue(checks, key)) failures.push('required-checks-' + key + '-failed');
    }
    if (!isDigest(checks.inventory_digest)) failures.push('required-check-inventory-digest-invalid');
    if (!Array.isArray(checks.items) || checks.items.length === 0) failures.push('required-check-items-missing');
    else {
      const ids = new Set();
      let requiredItem = false;
      for (const item of checks.items) {
        if (!isRecord(item) || !isSafeId(item.id) || ids.has(item.id)) {
          failures.push('required-check-identity-conflict');
          continue;
        }
        ids.add(item.id);
        if (!hasTrue(item, 'server_authoritative') || !hasTrue(item, 'verifiable')) failures.push('required-check-item-not-verifiable');
        if (item.required !== false) {
          requiredItem = true;
          if (item.status !== 'success') failures.push('required-check-not-successful');
        }
      }
      if (!requiredItem) failures.push('required-check-set-empty');
    }
  }

  if (!isRecord(ledger)) failures.push('ledger-evidence-missing');
  else {
    if (ledger.issue_number !== 142) failures.push('ledger-issue-number-invalid');
    for (const key of ['current', 'complete', 'server_authoritative', 'verifiable', 'duplicate_checked']) {
      if (!hasTrue(ledger, key)) failures.push('ledger-' + key + '-failed');
    }
    if (ledger.state !== 'QUEUED') failures.push('ledger-state-not-queued');
    if (ledger.intake_count !== 1) failures.push('ledger-intake-count-invalid');
    if (!isSafeId(ledger.identity)) failures.push('ledger-identity-invalid');
  }

  return [...new Set(failures)];
}

function g4AdmissionFailures(input) {
  const failures = [];
  if (!isRecord(input)) return ['g4-admission-missing'];
  const { candidate, lock, scope, g4 } = input;
  if (!isRecord(g4)) return ['g4-admission-missing'];
  if (g4.status !== 'PASS') failures.push('g4-status-not-pass');
  if (g4.provider !== 'OpenAI' || g4.model_class !== G4_MODEL || g4.reasoning !== 'high' || g4.mode !== 'standard') failures.push('g4-model-binding-invalid');
  for (const key of ['fresh', 'isolated', 'read_only', 'complete_candidate', 'current', 'complete', 'server_authoritative', 'verifiable']) {
    if (!hasTrue(g4, key)) failures.push('g4-' + key + '-failed');
  }
  if (!candidate || g4.candidate_head !== candidate.head || g4.candidate_tree !== candidate.tree || g4.candidate_base !== candidate.base) failures.push('g4-candidate-binding-conflict');
  if (g4.lock_id !== DESIGN_LOCK_ID || !lock || g4.lock_id !== lock.id) failures.push('g4-lock-binding-conflict');
  if (!scope || g4.scope_digest !== scope.digest) failures.push('g4-scope-binding-conflict');
  if (!hasTrue(g4, 'root_only')) failures.push('g4-root-boundary-failed');
  for (const key of ['mutation_authority', 'ready_authority', 'merge_authority', 'cleanup_authority', 'finality_authority']) {
    if (g4[key] !== false) failures.push('g4-' + key + '-present');
  }
  return [...new Set(failures)];
}

function failureLabel(failures) {
  const labels = [
    ['candidate-identity-missing', 'missing candidate'],
    ['accepted-lock-stale', 'stale lock'],
    ['review-complete-failed', 'incomplete review inventory'],
    ['required-check-identity-conflict', 'conflicting required check'],
    ['ledger-identity-invalid', 'ambiguous Ledger identity'],
  ];
  const match = labels.find(([reason]) => failures.includes(reason));
  return match ? match[1] : undefined;
}

function admitG4(input) {
  const failures = g4AdmissionFailures(input);
  if (failures.length > 0) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { admitted: false, reasons: failures });
  return valid('G4_ADMISSION_ACCEPTED', {
    admitted: true,
    contract_version: CONTRACT_VERSION,
    authority: G4_AUTHORITY,
    model_class: G4_MODEL,
    fresh: true,
    isolated: true,
    read_only: true,
    complete_candidate: true,
    mutation_authority: false,
    finality_authority: false,
  });
}

function isMaterialBlocker(finding) {
  return isRecord(finding)
    && MATERIAL_PREDICATES.every((key) => finding[key] === true)
    && EXCLUSION_FLAGS.every((key) => finding[key] !== true);
}

function evaluateAssurance(input) {
  const failures = requiredEvidenceFailures(input);
  if (failures.length > 0) {
    const result = {
      verdict: 'FAIL_CLOSED_REQUIRED_EVIDENCE',
      code: 'FAIL_CLOSED_REQUIRED_EVIDENCE',
      stop: true,
      finality_blocked: true,
      reasons: failures,
      next_action: 'WEB_REESTABLISH_REQUIRED_EVIDENCE',
    };
    const label = failureLabel(failures);
    if (label) result.label = label;
    return result;
  }
  const findings = input.review.findings;
  const blocker = findings.find(isMaterialBlocker);
  if (blocker) {
    return {
      verdict: 'FAIL',
      code: 'FAIL_MATERIAL_CURRENT_LOCK_BLOCKER',
      g4_status: 'FAIL',
      stop: false,
      finality_blocked: true,
      material_blocker: true,
      repair: {
        same_lock: true,
        smallest_sufficient: true,
        successor_invalidates_g4: true,
      },
      next_action: 'WEB_ROUTE_SAME_LOCK_REPAIR',
    };
  }
  return {
    verdict: 'PASS',
    code: 'PASS_AND_STOP',
    g4_status: 'PASS',
    stop: true,
    finality_blocked: false,
    material_blocker: false,
    non_blocking_findings: findings.length,
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
  };
}

function evaluateNoByteReviewDisposition(input = {}) {
  const unchanged = isRecord(input.unchanged) && ['head', 'tree', 'base', 'lock', 'scope'].every((key) => input.unchanged[key] === true);
  const disposition = ['stale', 'duplicate-closed-root', 'false-positive', 'non-material'].includes(input.disposition);
  const proof = unchanged
    && disposition
    && input.no_current_violation === true
    && input.no_candidate_change === true
    && input.complete_inventory === true
    && input.all_other_evidence_current === true;
  if (proof) {
    return {
      eligible: true,
      code: 'NO_BYTE_REVIEW_DISPOSITION_ACCEPTED',
      g4_invalidated: false,
      fresh_g4_required: false,
      finality_blocked: false,
    };
  }
  return {
    eligible: false,
    code: 'FAIL_CLOSED_REQUIRED_EVIDENCE',
    g4_invalidated: true,
    fresh_g4_required: true,
    finality_blocked: true,
  };
}

function evaluateInvalidation(input = {}) {
  const event = input.event;
  if (event === 'READY_MOVEMENT' && input.movement_event) return evaluateInvalidation({ ...input, event: input.movement_event });
  if (event === 'CANDIDATE_MOVEMENT' || event === 'SUCCESSOR_CANDIDATE_HEAD' || event === 'CANDIDATE_TREE_MOVEMENT') {
    return {
      code: 'G4_INVALIDATED_CANDIDATE_MOVEMENT',
      g4_invalidated: true,
      successor_invalidates_prior_g4: event === 'SUCCESSOR_CANDIDATE_HEAD',
      fresh_admission_required: true,
      fresh_complete_candidate_g4_required: true,
      fresh_g4_required: true,
    };
  }
  if (event === 'LOCK_MOVEMENT') {
    return {
      code: 'G4_INVALIDATED_LOCK_MOVEMENT',
      g4_invalidated: true,
      fresh_authority_admission_required: true,
      fresh_g4_required: true,
    };
  }
  if (event === 'SCOPE_MOVEMENT') {
    return {
      code: 'G4_INVALIDATED_SCOPE_MOVEMENT',
      g4_invalidated: true,
      fresh_scope_admission_required: true,
      fresh_g4_required: true,
    };
  }
  if (event === 'BASE_MOVEMENT') {
    if (input.impact === 'material') {
      return {
        code: 'G4_INVALIDATED_BASE_MOVEMENT',
        state: 'BASE_REVALIDATION_REQUIRED',
        g4_invalidated: true,
        fresh_base_admission_required: true,
        fresh_complete_candidate_g4_required: true,
        fresh_g4_required: true,
      };
    }
    if (input.impact === 'neutral') {
      return {
        code: 'BASE_REVALIDATION_NEUTRAL',
        state: 'BASE_REVALIDATION_REQUIRED',
        g4_invalidated: false,
        fresh_web_readback: true,
        fresh_check_inventory: true,
        fresh_review_inventory: true,
        fresh_g4_required: false,
      };
    }
    return {
      code: 'FAIL_CLOSED_REQUIRED_EVIDENCE',
      state: 'BASE_REVALIDATION_REQUIRED',
      g4_invalidated: false,
      finality_blocked: true,
      fresh_g4_required: true,
    };
  }
  if (event === 'NEW_MATERIAL_REVIEW_FINDING') {
    if (input.candidate_repair === true) {
      return {
        code: 'G4_INVALIDATED_CANDIDATE_MOVEMENT',
        material_review_finding: true,
        g4_invalidated: true,
        successor_invalidates_prior_g4: true,
        fresh_admission_required: true,
        fresh_complete_candidate_g4_required: true,
        fresh_g4_required: true,
      };
    }
    return {
      code: 'FINALITY_STOP_MATERIAL_REVIEW_FINDING',
      g4_invalidated: true,
      finality_blocked: true,
      web_adjudication_required: true,
      fresh_g4_required: false,
    };
  }
  if (event === 'NO_BYTE_REVIEW_DISPOSITION') return evaluateNoByteReviewDisposition(input);
  if (event === 'REQUIRED_CHECK_COMPLETED_SUCCESS') {
    return {
      code: 'REQUIRED_CHECK_REFRESH_ONLY',
      g4_invalidated: false,
      fresh_web_readback: true,
      fresh_g4_required: false,
    };
  }
  if (['REQUIRED_CHECK_FAILURE', 'REQUIRED_CHECK_CANCELLED', 'REQUIRED_CHECK_MISSING', 'REQUIRED_CHECK_STALE', 'REQUIRED_CHECK_AMBIGUOUS', 'REQUIRED_CHECK_REPLACED'].includes(event)) {
    return {
      code: 'FAIL_CLOSED_REQUIRED_EVIDENCE',
      g4_invalidated: false,
      finality_blocked: true,
      fresh_g4_required: false,
    };
  }
  if (event === 'BENIGN_REVIEW_METADATA_MOVEMENT') {
    return {
      code: 'REVIEW_REFRESH_ONLY',
      g4_invalidated: false,
      fresh_web_readback: true,
      fresh_g4_required: false,
    };
  }
  if (event === 'READY_AT_SAME_CANDIDATE') {
    return {
      code: 'READY_REFRESH_ONLY',
      g4_invalidated: false,
      ready_is_final_merge_state_transition: true,
      fresh_web_readback: true,
      fresh_g4_required: false,
    };
  }
  if (event === 'SUCCESSFUL_EXPECTED_HEAD_MERGE') {
    return {
      code: 'CANONICAL_READBACK_REQUIRED',
      g4_invalidated: false,
      canonical_readback_required: true,
      fresh_g4_required: false,
    };
  }
  if (event === 'UNCERTAIN_MERGE_RESULT') {
    return {
      code: 'CANONICAL_READBACK_REQUIRED',
      g4_invalidated: false,
      canonical_readback_required: true,
      blind_retry: false,
      fresh_g4_required: false,
    };
  }
  if (event === 'CANONICAL_RESULT_MATCHED') {
    return {
      code: 'FINALITY_READBACK_ACCEPTED',
      g4_invalidated: false,
      fresh_g4_required: false,
    };
  }
  if (event === 'CANONICAL_RESULT_UNBOUND') {
    return {
      code: 'FAIL_CLOSED_CANONICAL_BINDING',
      g4_invalidated: false,
      finality_blocked: true,
      controller_reconciliation_required: true,
      fresh_g4_required: false,
    };
  }
  return {
    code: 'FAIL_CLOSED_REQUIRED_EVIDENCE',
    g4_invalidated: false,
    finality_blocked: true,
    fresh_g4_required: false,
  };
}

function evaluateG4A(input = {}) {
  if (input.required_evidence_current !== true) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { allowed: false });
  if (['confidence', 'routine_duplicate', 'second_opinion', 'missing_evidence'].includes(input.purpose)) {
    return fail('G4A_NOT_PERMITTED', { allowed: false });
  }
  if (input.ordinary_complete !== true
    || input.exact_head_g4_passed !== true
    || typeof input.question !== 'string'
    || input.question.trim().length === 0
    || input.deterministic_evidence_settles === true
    || input.web_recorded_question !== true) {
    return fail('G4A_NOT_PERMITTED', { allowed: false });
  }
  if (input.settled === false) {
    return fail('CONTROLLER_REQUIRED', {
      allowed: false,
      controller_required: true,
      next_action: 'CONTROLLER_REQUIRED',
    });
  }
  return valid('G4A_ELIGIBLE', {
    allowed: true,
    model_class: G4A_MODEL,
    fresh: true,
    isolated: true,
    read_only: true,
    helpers: false,
    mutation_authority: false,
    finality_authority: false,
    question: input.question.trim(),
    next_action: 'RUN_G4A',
  });
}

function validLedgerRecord(record, runId) {
  return isRecord(record)
    && record.issue_number === 142
    && record.version === 'v2'
    && record.public_safe === true
    && record.duplicate_checked === true
    && record.state === 'QUEUED'
    && record.identity === runId;
}

function evaluateLedgerEvidence(input = {}) {
  const runId = input.run_id;
  if (!isSafeId(runId) || (Array.isArray(input.polls) && input.polls.some((value) => String(value) === '#143'))) {
    return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { accepted: false });
  }
  if (input.conflicting_duplicate === true) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { accepted: false });
  if (input.intake !== undefined && input.intake !== null && input.exact_existing_duplicate !== undefined && input.exact_existing_duplicate !== null) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { accepted: false });
  if (validLedgerRecord(input.intake, runId)) {
    return valid('LEDGER_142_QUEUED_ACCEPTED', { accepted: true, duplicate_checked: true, state: 'QUEUED' });
  }
  if (validLedgerRecord(input.exact_existing_duplicate, runId)) {
    return valid('LEDGER_142_EXACT_DUPLICATE_ACCEPTED', { accepted: true, duplicate_checked: true, state: 'QUEUED' });
  }
  return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { accepted: false });
}

function evaluateFinality(input = {}) {
  const web = isRecord(input.web_acceptance) ? input.web_acceptance : {};
  const ready = isRecord(input.ready) ? input.ready : {};
  const merge = isRecord(input.merge) ? input.merge : {};
  const canonical = isRecord(input.canonical) ? input.canonical : {};
  const accepted = isRecord(input.accepted_candidate) ? input.accepted_candidate : {};

  if (ready.set === true && (web.status !== 'accepted' || ready.after_web_acceptance !== true)) {
    return fail('READY_BEFORE_WEB_ACCEPTANCE', { finality_blocked: true });
  }
  if (web.status !== 'accepted'
    || web.current_required_evidence !== true
    || web.current_review_inventory !== true
    || web.current_required_checks !== true
    || web.current_ledger !== true
    || web.server_authoritative !== true
    || web.verifiable !== true) {
    return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  }
  if (ready.set !== true
    || ready.after_web_acceptance !== true
    || ready.final_merge_state_transition !== true
    || ready.same_candidate !== true
    || ready.fresh_readback !== true) {
    return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  }
  if (ready.review_triggered === true) return fail('READY_REVIEW_TRIGGER_FORBIDDEN', { finality_blocked: true });

  if (canonical.branch_cleanup_observed === true && canonical.cleanup_after_verified_merge !== true) {
    return fail('BRANCH_CLEANUP_BEFORE_VERIFIED_MERGE', { finality_blocked: true });
  }
  if (merge.result === 'uncertain') {
    return {
      code: 'CANONICAL_READBACK_REQUIRED',
      finality_blocked: true,
      blind_retry: false,
      g4_rerun: false,
      controller_reconciliation_if_unbound: true,
    };
  }
  if (!Number.isSafeInteger(accepted.pr_number) || accepted.pr_number < 1 || !isSha(accepted.head) || !isSha(accepted.tree) || !isSha(accepted.base)) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  if (!Number.isSafeInteger(merge.intended_pr_number) || !Number.isSafeInteger(merge.observed_pr_number)) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  if (merge.intended_pr_number !== accepted.pr_number || merge.observed_pr_number !== accepted.pr_number) return fail('UNEXPECTED_PR_REJECTED', { finality_blocked: true });
  if (!isSha(merge.expected_head) || !isSha(merge.observed_head)) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  if (merge.expected_head !== accepted.head || merge.observed_head !== accepted.head) return fail('UNEXPECTED_HEAD_REJECTED', { finality_blocked: true });
  if (!isSha(merge.expected_base) || !isSha(merge.observed_base)) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  if (merge.expected_base !== accepted.base || merge.observed_base !== accepted.base) return fail('UNEXPECTED_BASE_REJECTED', { finality_blocked: true });
  if (!isSha(merge.merge_result_sha)) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  if (merge.result !== 'merged'
    || merge.mode !== 'squash'
    || merge.bound_to_pr !== true
    || merge.server_authoritative !== true
    || merge.verifiable !== true) {
    return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  }
  if (canonical.bound_to_intended_merge !== true) return fail('FAIL_CLOSED_CANONICAL_BINDING', { finality_blocked: true, controller_reconciliation_required: true, g4_rerun: false });
  if (!isSha(canonical.main_head)) return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  if (canonical.main_head !== merge.merge_result_sha) return fail('CANONICAL_MAIN_MERGE_MISMATCH', { finality_blocked: true });
  if (!isSha(canonical.tree) || canonical.tree !== accepted.tree) return fail('CANONICAL_TREE_MISMATCH', { finality_blocked: true });
  if (!isSha(canonical.sole_parent) || canonical.sole_parent !== accepted.base) return fail('CANONICAL_PARENT_MISMATCH', { finality_blocked: true });
  if (canonical.expected_tree !== undefined && (!isSha(canonical.expected_tree) || canonical.expected_tree !== accepted.tree)) return fail('CANONICAL_TREE_MISMATCH', { finality_blocked: true });
  if (canonical.expected_parent !== undefined && (!isSha(canonical.expected_parent) || canonical.expected_parent !== accepted.base)) return fail('CANONICAL_PARENT_MISMATCH', { finality_blocked: true });
  if (!isRecord(canonical.signature) || canonical.signature.verified !== true || canonical.signature.reason !== 'valid') return fail('CANONICAL_SIGNATURE_INVALID', { finality_blocked: true });
  if (canonical.pr_merged !== true || canonical.pr_closed !== true || canonical.branch_cleanup_observed !== true || canonical.cleanup_after_verified_merge !== true) {
    return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  }
  if (canonical.server_authoritative !== true || canonical.verifiable !== true) {
    return fail('FAIL_CLOSED_REQUIRED_EVIDENCE', { finality_blocked: true });
  }
  return {
    code: 'FINALITY_VERIFIED',
    verdict: 'VERIFIED',
    finality_blocked: false,
    g4_rerun: false,
    branch_cleanup_verified: true,
  };
}

function containsForbiddenReportContent(value, location = 'report', seen = new Set()) {
  if (typeof value === 'string') return FORBIDDEN_REPORT_VALUE.test(value) ? location : '';
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return location;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = containsForbiddenReportContent(value[index], location + '[' + index + ']', seen);
      if (finding) return finding;
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_REPORT_KEYS.test(key)) return location + '.' + key;
      const finding = containsForbiddenReportContent(child, location + '.' + key, seen);
      if (finding) return finding;
    }
  }
  seen.delete(value);
  return '';
}

function isSafeIdCollection(value) {
  if (Array.isArray(value)) return value.every(isSafeId);
  return isRecord(value) && Object.values(value).every(isSafeId);
}

function isDigestCollection(value, checker) {
  return isRecord(value) && Object.values(value).every(checker);
}

function isCountCollection(value) {
  return isRecord(value) && Object.values(value).every((item) => Number.isSafeInteger(item) && item >= 0);
}

function isTimestampCollection(value) {
  const values = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  return values.length > 0 && values.every((item) => typeof item === 'string' && item.length <= 64 && !FORBIDDEN_REPORT_VALUE.test(item));
}

function validOptionalReportFields(input) {
  if (input.safe_ids !== undefined && !isSafeIdCollection(input.safe_ids)) return false;
  if (input.shas !== undefined && !isDigestCollection(input.shas, isSha)) return false;
  if (input.digests !== undefined && !isDigestCollection(input.digests, isDigest)) return false;
  if (input.status_codes !== undefined && !isSafeIdCollection(input.status_codes)) return false;
  if (input.timestamps !== undefined && !isTimestampCollection(input.timestamps)) return false;
  if (input.model_class !== undefined && !isSafeLabel(input.model_class)) return false;
  if (input.counts !== undefined && !isCountCollection(input.counts)) return false;
  if (input.public_review_refs !== undefined && (!Array.isArray(input.public_review_refs) || !input.public_review_refs.every(isSafePublicRef))) return false;
  if (input.public_check_refs !== undefined && (!Array.isArray(input.public_check_refs) || !input.public_check_refs.every(isSafePublicRef))) return false;
  if (input.relative_scope_ids !== undefined && (!Array.isArray(input.relative_scope_ids) || !input.relative_scope_ids.every(isSafeRelativeScopeId))) return false;
  return true;
}

function createReport(input = {}) {
  if (Object.prototype.hasOwnProperty.call(input, 'next_actions')
    || Object.prototype.hasOwnProperty.call(input, 'supported_next_actions')) {
    return fail('MULTIPLE_NEXT_ACTIONS_REJECTED', { accepted: false });
  }
  if (!validOptionalReportFields(input)) return fail('REPORT_CONTRACT_INVALID', { accepted: false });
  const forbidden = containsForbiddenReportContent(input);
  if (forbidden) return fail('PRIVACY_LEAK_REJECTED', { accepted: false, location: forbidden });
  const allowed = new Set([
    'verdict',
    'material_blocker',
    'verified_result',
    'mutation_state',
    'unchanged_scope',
    'next_action',
    'safe_ids',
    'shas',
    'digests',
    'status_codes',
    'timestamps',
    'model_class',
    'counts',
    'public_review_refs',
    'public_check_refs',
    'relative_scope_ids',
  ]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) return fail('PRIVACY_LEAK_REJECTED', { accepted: false, location: 'report.' + unknown });
  if (!Object.prototype.hasOwnProperty.call(input, 'material_blocker') || typeof input.material_blocker !== 'boolean') return fail('REPORT_CONTRACT_INVALID', { accepted: false });
  if (typeof input.verdict !== 'string' || !isSafeId(input.verdict)
    || (input.verified_result !== undefined && input.verified_result !== null && !isSafeLabel(input.verified_result))
    || !isRecord(input.mutation_state)
    || typeof input.mutation_state.attempted !== 'boolean'
    || typeof input.mutation_state.performed !== 'boolean'
    || !Array.isArray(input.unchanged_scope)
    || input.unchanged_scope.length === 0
    || input.unchanged_scope.some((value) => !isSafeId(value))
    || typeof input.next_action !== 'string'
    || !isSafeId(input.next_action)) {
    return fail('REPORT_CONTRACT_INVALID', { accepted: false });
  }
  if (input.material_blocker === false && !isSafeLabel(input.verified_result)) return fail('REPORT_CONTRACT_INVALID', { accepted: false });
  if (input.material_blocker === true && input.verified_result !== undefined && input.verified_result !== null) return fail('REPORT_CONTRACT_INVALID', { accepted: false });
  const report = {
    contract_version: CONTRACT_VERSION,
    verdict: input.verdict,
    material_blocker: input.material_blocker,
    verified_result: typeof input.verified_result === 'string' ? input.verified_result : null,
    mutation_state: {
      attempted: input.mutation_state.attempted,
      performed: input.mutation_state.performed,
    },
    unchanged_scope: [...input.unchanged_scope],
    next_action: input.next_action,
  };
  for (const key of ['safe_ids', 'shas', 'digests', 'status_codes', 'timestamps', 'model_class', 'counts', 'public_review_refs', 'public_check_refs', 'relative_scope_ids']) {
    if (input[key] !== undefined) report[key] = input[key];
  }
  return {
    accepted: true,
    report,
    human: {
      verdict: report.verdict,
      material_blocker: report.material_blocker,
      verified_result: report.verified_result,
      mutation_attempted: report.mutation_state.attempted,
      mutation_performed: report.mutation_state.performed,
      unchanged_scope: report.unchanged_scope,
      next_action: report.next_action,
    },
    next_action: report.next_action,
  };
}

module.exports = Object.freeze({
  DESIGN_LOCK_ID,
  CONTRACT_VERSION,
  G4_AUTHORITY,
  G4_MODEL,
  G4A_MODEL,
  MATERIAL_PREDICATES,
  EXCLUSION_FLAGS,
  admitG4,
  evaluateAssurance,
  evaluateInvalidation,
  evaluateNoByteReviewDisposition,
  evaluateG4A,
  evaluateLedgerEvidence,
  evaluateFinality,
  createReport,
});
