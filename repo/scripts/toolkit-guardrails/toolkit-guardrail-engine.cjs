'use strict';

const {
  decisionRank,
  getPolicy,
  mostRestrictive,
  reasonCode,
  sha256,
} = require('./toolkit-guardrail-policy.cjs');
const {
  targetSetClass,
  targetsInsideAuthorisedRoots,
} = require('./toolkit-active-repository.cjs');
const {
  computeTargetDigest,
  normalizeOperation,
  refreshOperationDigests,
} = require('./toolkit-operation-normalizer.cjs');
const {
  classifyOperation,
} = require('./toolkit-command-classifier.cjs');
const {
  verifyApproval,
} = require('./toolkit-approval-verifier.cjs');

const ROUTINE_CLASSES = new Set([
  'read',
  'edit',
  'create',
  'rename',
  'git-local-read',
  'git-stage',
  'git-commit',
  'git-push',
  'toolkit-temp-cleanup',
  'github-read',
]);
const ASK_CLASSES = new Set([
  'overwrite',
  'truncate',
  'delete',
  'git-destructive',
  'git-force-push',
  'git-other-target',
  'external-mutation',
  'secret-access',
  'github-issue-mutation',
  'github-pr-mutation',
  'github-review-mutation',
  'github-repository-workflow-mutation',
]);
const DENY_CLASSES = new Set([
  'secret-exfiltration',
  'secret-dump',
  'guardrail-bypass',
  'protected-target',
  'catastrophic-target',
  'role-boundary-violation',
]);
const GITHUB_MUTATION_CLASSES = new Set([
  'github-issue-mutation',
  'github-pr-mutation',
  'github-review-mutation',
  'github-repository-workflow-mutation',
]);
const IMPLICIT_REPOSITORY_SCOPE_CLASSES = new Set([
  'git-local-read',
  'git-stage',
  'git-commit',
  'git-push',
]);
const EXPLICIT_TARGET_CLASSES = new Set(['read', 'edit', 'create', 'rename']);
const HARD_ENFORCEMENT_LEVELS = new Set(['hard-runtime-enforcement', 'hard-pre-execution']);
const FRESHNESS_VALUES = new Set(['fresh', 'current', 'verified']);
const PRE_EXECUTION_POSITIONS = new Set(['pre-execution', 'before-execution', 'preflight']);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeFailure(reason, input) {
  return {
    decision: 'unsupported',
    reason_code: reasonCode(reason, 'ENGINE_FAILURE_UNSUPPORTED'),
    enforcement_requirement: 'stop-before-execution',
    safe_target_class: 'unknown-target',
    operation_class: 'unsupported-route',
    request_digest: sha256({
      reason: reasonCode(reason, 'ENGINE_FAILURE_UNSUPPORTED'),
      host: input?.session?.host || input?.host || null,
      route: input?.operation?.canonical_route || input?.canonical_route || null,
    }),
    operation_digest: sha256({ failure: reasonCode(reason, 'ENGINE_FAILURE_UNSUPPORTED') }),
    target_digest: sha256([]),
    privacy_safe: true,
  };
}

function result({ decision, reason, enforcement, targetClass, operationClass, requestDigest, operationDigest, targetDigest }) {
  return {
    decision,
    reason_code: reasonCode(reason),
    enforcement_requirement: enforcement,
    safe_target_class: targetClass || 'unknown-target',
    operation_class: operationClass || 'unsupported-route',
    request_digest: requestDigest || sha256({ decision, reason }),
    operation_digest: operationDigest || sha256({ decision, operationClass }),
    target_digest: targetDigest || sha256([]),
    privacy_safe: true,
  };
}

function expectedRouteIdentity(record) {
  const operation = record?.operation || {};
  if (nonEmptyString(operation.canonical_route)) return operation.canonical_route;
  if (nonEmptyString(operation.command)) return `shell:${String(operation.shell || 'unknown').toLowerCase()}`;
  return operation.host_tool || 'operation.preflight';
}

function hookEvidenceValid(evidence) {
  return Boolean(
    evidence
      && typeof evidence === 'object'
      && evidence.status === 'verified'
      && nonEmptyString(evidence.source)
      && evidence.pre_execution === true
      && PRE_EXECUTION_POSITIONS.has(String(evidence.position || '').toLowerCase())
      && nonEmptyString(evidence.version),
  );
}

function capabilityCheck(record, classification) {
  if (record.native_state?.native_permission_route === 'unsupported') return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
  if (record.native_state?.auto_or_bypass === true) return { decision: 'ask', reason: 'APPROVAL_NATIVE_STATE_NOT_EQUIVALENT' };
  const evidence = record.native_state?.capability_evidence;
  if (evidence === null || evidence === undefined) return { decision: 'unsupported', reason: 'CAPABILITY_EVIDENCE_MISSING' };
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return { decision: 'unsupported', reason: 'CAPABILITY_EVIDENCE_INVALID' };

  const status = String(evidence.status || '').toLowerCase();
  if (['stale', 'expired', 'unverified', 'not-established'].includes(status) || evidence.fresh === false || evidence.evidence_freshness === 'stale' || evidence.version_status === 'stale') {
    return { decision: 'unsupported', reason: 'STALE_CAPABILITY_UNSUPPORTED' };
  }
  if (status === 'malformed') return { decision: 'unsupported', reason: 'CAPABILITY_EVIDENCE_INVALID' };
  if (
    status !== 'verified'
    || evidence.host !== record.session.host
    || evidence.host_version !== record.session.host_version
    || evidence.route_identity !== expectedRouteIdentity(record)
    || evidence.route_supported !== true
    || !HARD_ENFORCEMENT_LEVELS.has(String(evidence.enforcement_level || '').toLowerCase())
    || !['verified', 'not-required'].includes(String(evidence.adapter_state || '').toLowerCase())
    || !hookEvidenceValid(evidence.hook_order_evidence)
    || !FRESHNESS_VALUES.has(String(evidence.evidence_freshness || '').toLowerCase())
    || evidence.fresh !== true
    || !['supported', 'verified'].includes(String(evidence.operation_preflight || '').toLowerCase())
    || !['current', 'verified'].includes(String(evidence.version_status || '').toLowerCase())
    || (evidence.expected_host_version !== null && evidence.expected_host_version !== record.session.host_version)
    || typeof evidence.adapter_required !== 'boolean'
    || typeof evidence.trusted_ask !== 'boolean'
  ) return { decision: 'unsupported', reason: 'CAPABILITY_EVIDENCE_INVALID' };

  if (evidence.adapter_required === true && String(evidence.adapter_state).toLowerCase() !== 'verified') return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
  if (classification.decision_hint === 'ask' && evidence.trusted_ask !== true) return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
  if (evidence.auto_mode_safe === true && record.native_state.auto_or_bypass === true) return { decision: 'unsupported', reason: 'CAPABILITY_EVIDENCE_INVALID' };
  return { decision: 'allow', reason: null };
}

function authorityCheck(record, classification, policy) {
  const authority = record.authority;
  if (!authority || typeof authority !== 'object') return { decision: 'unsupported', reason: 'AUTHORITY_CONTEXT_MISSING' };
  if (authority.controller_hold === true) return { decision: 'deny', reason: 'CONTROLLER_HOLD_ACTIVE' };
  if (policy.authority.forbidden_scopes.includes(record.operation.scope)) return { decision: 'deny', reason: 'DESIGN_LOCK_VIOLATION' };
  if (
    authority.prompt_active !== true
    || !nonEmptyString(authority.role_name)
    || typeof authority.role_allowed !== 'boolean'
    || !nonEmptyString(authority.branch_name)
    || !nonEmptyString(authority.authorized_branch)
    || !nonEmptyString(authority.design_lock_id)
  ) return { decision: 'unsupported', reason: 'AUTHORITY_CONTEXT_MISSING' };
  if (authority.design_lock_id !== policy.authority.active_design_lock || authority.design_lock_status !== 'active') return { decision: 'deny', reason: 'DESIGN_LOCK_VIOLATION' };
  if (!policy.authority.permitted_roles.includes(authority.role_name) || authority.role_allowed === false) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  if (authority.authorized_branch !== authority.branch_name) return { decision: 'deny', reason: 'BRANCH_AUTHORITY_VIOLATION' };
  if (authority.branch_protected === true) return { decision: 'deny', reason: 'BRANCH_AUTHORITY_VIOLATION' };
  if (authority.allowed_operation_classes.length && !authority.allowed_operation_classes.includes(classification.operation_class) && !authority.allowed_operation_classes.includes('all')) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  if (authority.allowed_scopes.length && record.operation.scope && !authority.allowed_scopes.includes(record.operation.scope) && !authority.allowed_scopes.includes('all')) return { decision: 'deny', reason: 'DESIGN_LOCK_VIOLATION' };

  if (GITHUB_MUTATION_CLASSES.has(classification.operation_class)) {
    if (authority.role_name !== 'controller') return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
    if (authority.controller_authorized !== true) return { decision: 'unsupported', reason: 'GITHUB_MUTATION_AUTHORITY_REQUIRED' };
    if (!authority.controller_operation_classes.includes(classification.operation_class) && !authority.controller_operation_classes.includes('all')) return { decision: 'unsupported', reason: 'GITHUB_MUTATION_AUTHORITY_REQUIRED' };
    return { decision: 'allow', reason: 'CONTROLLER_GITHUB_AUTHORIZED' };
  }
  if (policy.authority.controller_only_operation_classes.includes(classification.operation_class)) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  return { decision: 'allow', reason: null };
}

function pathText(target) {
  return String(target?.canonical_path || target?.raw_path || '').trim();
}

function isSecretBearingPath(target) {
  const value = pathText(target);
  return /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh[\\/](?:id_[^\\/]+|[^\\/]+\.(?:pem|key))|\.aws[\\/]credentials|\.gnupg(?:[\\/]|$)|credentials(?:\.[^\\/]*)?|(?:id_rsa|id_ed25519|private[_-]?key)(?:\.[^\\/]*)?)(?:[\\/]|$)/i.test(value);
}

function isCatastrophicPath(target) {
  const raw = pathText(target);
  if (raw === '/' || /^[A-Za-z]:[\\/]?$/.test(raw)) return true;
  const value = raw.replace(/[\\/]$/, '');
  return /^(?:[A-Za-z]:[\\/](?:Windows|Program Files|ProgramData|System32)|[\\/](?:etc|sys|boot|root|var[\\/]lib))(?:[\\/]|$)/i.test(`${value}\\`);
}

function targetClassFor(record, classification) {
  const targets = record.operation.targets || [];
  if (classification.secret_target) return 'secret-bearing';
  if (classification.external_targets?.length || record.operation.external_targets?.length || record.operation.mcp_server || record.operation.mcp_tool) return 'external-system';
  if (targets.some(isCatastrophicPath) || classification.catastrophic_hint) return 'protected-target';
  if (targets.some(isSecretBearingPath)) return 'secret-bearing';
  if (targets.length) return targetSetClass(targets);
  if (record.repository?.path_resolution_status === 'resolved') return 'canonical-repository';
  return 'unknown-target';
}

function ensureCommandTargets(record, classification, options) {
  if (Array.isArray(classification.targets) && classification.targets.length) record.operation.targets = classification.targets;
  if (!record.operation.targets.length && (
    IMPLICIT_REPOSITORY_SCOPE_CLASSES.has(classification.operation_class)
    || (classification.operation_class === 'read' && record.operation.command)
  ) && record.repository?.path_resolution_status === 'resolved') {
    const root = record.repository.canonical_repository_root || record.repository.repo_root;
    if (root) {
      record.operation.targets = [{
        raw_path: root,
        lexical_path: root,
        canonical_path: root,
        status: 'resolved',
        target_class: 'canonical-repository',
        link_type: 'none',
        resolved_inside: true,
        approved_root: null,
        evidence: { status: 'trusted', source: 'explicit-repository-context' },
      }];
    }
  }
  record.operation.target_digest = computeTargetDigest(record.operation.targets);
  return record;
}

function approvalDecision(record, options) {
  try {
    const verifier = options.approvalVerifier || verifyApproval;
    const verified = verifier(record, record.approval, {
      ...options,
      policy: options.policy,
      operation_decision: 'ask',
    });
    if (verified?.valid === true) return { decision: 'allow', reason: 'APPROVED_ONE_SHOT_OPERATION' };
    return { decision: 'ask', reason: verified?.reason_code || 'APPROVAL_MISSING' };
  } catch (error) {
    return { decision: 'unsupported', reason: 'APPROVAL_VERIFIER_FAILURE_UNSUPPORTED' };
  }
}

function askReason(classification) {
  if (classification.operation_class === 'secret-access') return 'SECRET_ACCESS_REQUIRES_APPROVAL';
  if (classification.operation_class.startsWith('github-')) return 'EXTERNAL_MUTATION_REQUIRES_APPROVAL';
  if (classification.operation_class === 'external-mutation') return 'EXTERNAL_MUTATION_REQUIRES_APPROVAL';
  return 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL';
}

function decideOne(record, classification, options = {}) {
  const policy = options.policy || getPolicy();
  const authority = authorityCheck(record, classification, policy);
  const capability = capabilityCheck(record, classification);
  const targetClass = targetClassFor(record, classification);
  const requestDigest = record.operation.input_digest;
  const operationDigest = record.operation.input_digest;
  const targetDigest = record.operation.target_digest;

  const make = (decision, reason, enforcement, target = targetClass, operationClass = classification.operation_class) => result({
    decision,
    reason,
    enforcement,
    targetClass: target,
    operationClass,
    requestDigest,
    operationDigest,
    targetDigest,
  });

  if (classification.decision_hint === 'deny' || DENY_CLASSES.has(classification.operation_class)) {
    return make('deny', classification.reason_codes?.[0] || (targetClass === 'protected-target' ? 'CATASTROPHIC_TARGET_DENIED' : 'PROTECTED_TARGET_DENIED'), 'hard-deny');
  }
  if (authority.decision === 'deny') return make('deny', authority.reason, 'hard-deny');
  if (targetClass === 'protected-target') return make('deny', 'CATASTROPHIC_TARGET_DENIED', 'hard-deny');
  if (capability.decision === 'ask') return make('ask', capability.reason, 'trusted-one-shot-approval');
  if (capability.decision === 'unsupported') return make('unsupported', capability.reason, 'stop-before-execution');
  if (authority.decision === 'unsupported') return make('unsupported', authority.reason, 'stop-before-execution');
  if ((record.operation.targets || []).some((target) => target.status !== 'resolved')) return make('unsupported', 'UNRESOLVED_TARGET_UNSUPPORTED', 'stop-before-execution', 'unresolved-target');
  if (classification.opaque || classification.decision_hint === 'unsupported' || classification.operation_class === 'opaque-command' || classification.operation_class === 'unsupported-route') return make('unsupported', classification.reason_codes?.[0] || 'OPAQUE_COMMAND_UNSUPPORTED', 'stop-before-execution');

  const targets = record.operation.targets || [];
  if (!record.operation.command && EXPLICIT_TARGET_CLASSES.has(classification.operation_class) && !targets.length) return make('unsupported', 'UNRESOLVED_TARGET_UNSUPPORTED', 'stop-before-execution', 'unresolved-target');
  const inside = targetsInsideAuthorisedRoots(targets) || (!targets.length && record.repository?.path_resolution_status === 'resolved');
  const outside = targets.some((target) => !target.resolved_inside || ['outside-repository', 'sibling-repository', 'parent-workspace', 'mixed-targets', 'unknown-target'].includes(target.target_class));

  if (GITHUB_MUTATION_CLASSES.has(classification.operation_class) && authority.reason === 'CONTROLLER_GITHUB_AUTHORIZED') return make('allow', authority.reason, 'controller-authority', 'external-system');

  if (classification.operation_class === 'git-push') {
    const push = classification.git_push || {};
    const branchOkay = nonEmptyString(record.authority.branch_name)
      && nonEmptyString(record.authority.authorized_branch)
      && record.authority.branch_name === record.authority.authorized_branch
      && record.authority.branch_protected !== true;
    const exactPush = push.evidence_complete === true
      && push.remote === 'origin'
      && !push.force
      && !push.other_target
      && nonEmptyString(push.destination_ref)
      && ['HEAD', 'head', record.authority.authorized_branch].includes(push.destination_ref)
      && record.authority.push_authorized === true
      && branchOkay
      && inside;
    if (exactPush) return make('allow', 'AUTHORISED_NORMAL_PUSH', 'routine-repository-authority', 'canonical-repository');
    if (push.evidence_complete !== true) return make('unsupported', 'GIT_PUSH_EVIDENCE_REQUIRED', 'stop-before-execution');
    const approvedPush = approvalDecision(record, options);
    if (approvedPush.decision === 'allow') return make('allow', approvedPush.reason, 'trusted-one-shot-approval');
    if (approvedPush.decision === 'unsupported') return make('unsupported', approvedPush.reason, 'stop-before-execution');
    return make('ask', 'EXTERNAL_MUTATION_REQUIRES_APPROVAL', 'trusted-one-shot-approval');
  }

  if (outside || targetClass === 'mixed-targets') {
    const approved = approvalDecision(record, options);
    if (approved.decision === 'allow') return make('allow', approved.reason, 'trusted-one-shot-approval');
    if (approved.decision === 'unsupported') return make('unsupported', approved.reason, 'stop-before-execution');
    return make('ask', 'OUTSIDE_REPOSITORY_TARGET', 'trusted-one-shot-approval');
  }

  if (ASK_CLASSES.has(classification.operation_class) || classification.decision_hint === 'ask') {
    const approved = approvalDecision(record, options);
    if (approved.decision === 'allow') return make('allow', approved.reason, 'trusted-one-shot-approval');
    if (approved.decision === 'unsupported') return make('unsupported', approved.reason, 'stop-before-execution');
    return make('ask', askReason(classification), 'trusted-one-shot-approval');
  }

  if (ROUTINE_CLASSES.has(classification.operation_class) && inside) {
    if (classification.operation_class === 'toolkit-temp-cleanup') {
      const evidence = record.operation.transaction_evidence || record.operation.structured_input?.transaction_evidence;
      if (!(evidence?.owned_by_toolkit === true && evidence?.created_by_same_transaction === true && evidence?.exact_target_set === true)) return make('ask', 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL', 'trusted-one-shot-approval');
    }
    return make('allow', classification.operation_class.startsWith('git-') ? 'ROUTINE_GIT_OPERATION' : 'ROUTINE_REPOSITORY_OPERATION', 'routine-repository-authority', targetClass === 'unknown-target' ? 'canonical-repository' : targetClass);
  }

  const approved = approvalDecision(record, options);
  if (approved.decision === 'allow') return make('allow', approved.reason, 'trusted-one-shot-approval');
  return make(approved.decision === 'ask' ? 'ask' : 'unsupported', approved.decision === 'ask' ? 'OUTSIDE_REPOSITORY_TARGET' : approved.reason, approved.decision === 'ask' ? 'trusted-one-shot-approval' : 'stop-before-execution');
}

function evaluateOne(input, options = {}) {
  let record;
  try {
    record = normalizeOperation(input, options);
  } catch (error) {
    return safeFailure(options.resolveRepositoryContext ? 'RESOLVER_FAILURE_UNSUPPORTED' : 'MALFORMED_OPERATION_UNSUPPORTED', input);
  }
  let classification;
  try {
    const classifier = options.classifier || classifyOperation;
    classification = classifier(record, options);
    if (!classification || typeof classification.operation_class !== 'string') throw new Error('CLASSIFICATION_INVALID');
    ensureCommandTargets(record, classification, options);
    refreshOperationDigests(record, classification);
  } catch (error) {
    return safeFailure('CLASSIFIER_FAILURE_UNSUPPORTED', input);
  }
  return decideOne(record, classification, options);
}

function mergeResults(results, input) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return safeFailure('MALFORMED_OPERATION_UNSUPPORTED', input);
  const decision = mostRestrictive(list.map((entry) => entry.decision));
  const selected = list.reduce((current, candidate) => (decisionRank(candidate.decision) > decisionRank(current.decision) ? candidate : current), list[0]);
  const secondaryReasonCodes = [...new Set(list.map((entry) => entry.reason_code).filter((code) => code && code !== selected.reason_code))];
  return {
    ...selected,
    decision,
    request_digest: sha256(list.map((entry) => entry.request_digest)),
    operation_digest: sha256(list.map((entry) => entry.operation_digest)),
    target_digest: sha256(list.map((entry) => entry.target_digest)),
    privacy_safe: true,
    ...(secondaryReasonCodes.length ? { secondary_reason_codes: secondaryReasonCodes } : {}),
    mixed_components: list.map((entry) => ({
      decision: entry.decision,
      reason_code: entry.reason_code,
      operation_class: entry.operation_class,
      safe_target_class: entry.safe_target_class,
    })),
  };
}

function evaluate(input, options = {}) {
  try {
    if (Array.isArray(input?.operations)) {
      const results = input.operations.map((operation) => evaluateOne({ ...input, operation, operations: undefined }, options));
      return mergeResults(results, input);
    }
    return evaluateOne(input, options);
  } catch (error) {
    return safeFailure('ENGINE_FAILURE_UNSUPPORTED', input);
  }
}

function evaluateGuardrail(input, options = {}) {
  return evaluate(input, options);
}

module.exports = {
  evaluate,
  evaluateGuardrail,
  evaluateOne,
  authorityCheck,
  capabilityCheck,
  isSecretBearingPath,
  isCatastrophicPath,
};
