'use strict';

const {
  DECISIONS,
  decisionRank,
  getPolicy,
  mostRestrictive,
  reasonCode,
  sha256,
} = require('./toolkit-guardrail-policy.cjs');
const {
  targetSetClass,
  targetsInsideAuthorisedRoots,
  resolveTarget,
} = require('./toolkit-active-repository.cjs');
const {
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
]);
const ASK_CLASSES = new Set([
  'overwrite',
  'truncate',
  'delete',
  'git-destructive',
  'git-force-push',
  'git-other-target',
  'external-mutation',
]);
const DENY_CLASSES = new Set([
  'secret-exfiltration',
  'guardrail-bypass',
  'protected-target',
  'role-boundary-violation',
]);
const IMPLICIT_REPOSITORY_SCOPE_CLASSES = new Set([
  'git-local-read',
  'git-stage',
  'git-commit',
  'git-push',
]);
const EXPLICIT_TARGET_CLASSES = new Set(['read', 'edit', 'create', 'rename']);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function safeFailure(reason, input, detail = null) {
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
    ...(detail ? { diagnostic_code: reasonCode(detail, 'ENGINE_FAILURE_UNSUPPORTED') } : {}),
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

function authorityCheck(record, classification, policy) {
  const authority = record.authority;
  if (!authority || typeof authority !== 'object') return { decision: 'unsupported', reason: 'AUTHORITY_CONTEXT_MISSING' };
  if (authority.controller_hold) return { decision: 'deny', reason: 'CONTROLLER_HOLD_ACTIVE' };
  if (DENY_CLASSES.has(classification.operation_class)) return { decision: 'deny', reason: classification.reason_codes?.[0] || 'ROLE_AUTHORITY_VIOLATION' };
  if (policy.authority.forbidden_scopes.includes(record.operation.scope)) return { decision: 'deny', reason: 'DESIGN_LOCK_VIOLATION' };
  if (
    authority.prompt_active !== true
    || !authority.role_name
    || authority.role_allowed === null
    || authority.role_allowed === undefined
    || !authority.branch_name
    || !authority.authorized_branch
    || !authority.design_lock_id
  ) {
    return { decision: 'unsupported', reason: 'AUTHORITY_CONTEXT_MISSING' };
  }
  if (authority.design_lock_id !== policy.authority.active_design_lock || authority.design_lock_status !== 'active') return { decision: 'deny', reason: 'DESIGN_LOCK_VIOLATION' };
  if (!policy.authority.permitted_roles.includes(authority.role_name) || authority.role_allowed === false) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  if (authority.role_allowed !== true) return { decision: 'unsupported', reason: 'AUTHORITY_CONTEXT_MISSING' };
  if (authority.authorized_branch && authority.branch_name !== authority.authorized_branch) return { decision: 'deny', reason: 'BRANCH_AUTHORITY_VIOLATION' };
  if (authority.branch_protected === true) return { decision: 'deny', reason: 'BRANCH_AUTHORITY_VIOLATION' };
  if (authority.allowed_operation_classes.length && !authority.allowed_operation_classes.includes(classification.operation_class) && !authority.allowed_operation_classes.includes('all')) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  if (authority.allowed_scopes.length && record.operation.scope && !authority.allowed_scopes.includes(record.operation.scope) && !authority.allowed_scopes.includes('all')) return { decision: 'deny', reason: 'DESIGN_LOCK_VIOLATION' };
  if (policy.authority.controller_only_operation_classes.includes(classification.operation_class)) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  return { decision: 'allow', reason: null };
}

function capabilityCheck(record, classification) {
  const evidence = record.native_state?.capability_evidence;
  if (record.native_state?.native_permission_route === 'unsupported') return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
  if (!evidence || typeof evidence !== 'object') return { decision: 'allow', reason: null };
  const status = String(firstDefined(evidence.status, evidence.evidence_status, '')).toLowerCase();
  if (['stale', 'expired', 'malformed', 'missing', 'unverified', 'not-established'].includes(status) || evidence.fresh === false || evidence.version_status === 'stale') {
    return { decision: 'unsupported', reason: 'STALE_CAPABILITY_UNSUPPORTED' };
  }
  if (evidence.route_supported === false || evidence.operation_preflight === 'unsupported' || evidence.enforcement_level === 'unsupported' && evidence.adapter_required === true) {
    return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
  }
  if (evidence.host && record.session.host && evidence.host !== record.session.host) return { decision: 'unsupported', reason: 'STALE_CAPABILITY_UNSUPPORTED' };
  if (evidence.expected_host_version && record.session.host_version && evidence.expected_host_version !== record.session.host_version) return { decision: 'unsupported', reason: 'STALE_CAPABILITY_UNSUPPORTED' };
  if (classification.decision_hint === 'ask' && evidence.trusted_ask === false && evidence.adapter_required === true) return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
  return { decision: 'allow', reason: null };
}

function isProtectedPath(target) {
  const value = String(target?.canonical_path || target?.raw_path || '');
  return /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|credentials(?:\.json)?|id_rsa|id_ed25519)(?:[\\/]|$)/i.test(value)
    || /(?:^|[\\/])\.env(?:\.|$)/i.test(value)
    || /^(?:[A-Za-z]:[\\/](?:Windows|Program Files|ProgramData)(?:[\\/]|$)|[\\/](?:etc|sys|boot|root)(?:[\\/]|$))/i.test(value);
}

function targetClassFor(record, classification) {
  const targets = record.operation.targets || [];
  if (classification.external_targets?.length || record.operation.external_targets?.length || record.operation.mcp_server || record.operation.mcp_tool) return 'external-system';
  if (targets.some(isProtectedPath) || classification.protected_hint) return 'protected-target';
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
  record.operation.target_digest = require('./toolkit-operation-normalizer.cjs').computeTargetDigest(record.operation.targets);
  return record;
}

function approvalDecision(record, classification, options) {
  try {
    const verifier = options.approvalVerifier || verifyApproval;
    const verified = verifier(record, record.approval, {
      ...options,
      policy: options.policy,
      operation_decision: 'ask',
    });
    if (verified?.valid === true) return { decision: 'allow', reason: 'APPROVED_ONE_SHOT_OPERATION', verified: true };
    const reason = verified?.reason_code || 'APPROVAL_MISSING';
    return { decision: 'ask', reason, verified: false };
  } catch (error) {
    return { decision: 'unsupported', reason: 'APPROVAL_VERIFIER_FAILURE_UNSUPPORTED', error };
  }
}

function decideOne(record, classification, options = {}) {
  const policy = options.policy || getPolicy();
  const authority = authorityCheck(record, classification, policy);
  const capability = capabilityCheck(record, classification);
  const targetClass = targetClassFor(record, classification);
  const requestDigest = record.operation.input_digest;
  const operationDigest = record.operation.input_digest;
  const targetDigest = record.operation.target_digest;

  if (authority.decision === 'deny') return result({ decision: 'deny', reason: authority.reason, enforcement: 'hard-deny', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  if (classification.decision_hint === 'deny' || DENY_CLASSES.has(classification.operation_class)) return result({ decision: 'deny', reason: classification.reason_codes?.[0] || 'PROTECTED_TARGET_DENIED', enforcement: 'hard-deny', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  if (capability.decision === 'unsupported') return result({ decision: 'unsupported', reason: capability.reason, enforcement: 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  if (authority.decision === 'unsupported') return result({ decision: 'unsupported', reason: authority.reason, enforcement: 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  if (targetClass === 'protected-target') return result({ decision: 'deny', reason: 'PROTECTED_TARGET_DENIED', enforcement: 'hard-deny', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  if ((record.operation.targets || []).some((target) => target.status !== 'resolved')) return result({ decision: 'unsupported', reason: 'UNRESOLVED_TARGET_UNSUPPORTED', enforcement: 'stop-before-execution', targetClass: 'unresolved-target', operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  if (classification.opaque || classification.decision_hint === 'unsupported' || classification.operation_class === 'opaque-command' || classification.operation_class === 'unsupported-route') return result({ decision: 'unsupported', reason: classification.reason_codes?.[0] || 'OPAQUE_COMMAND_UNSUPPORTED', enforcement: 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });

  const targets = record.operation.targets || [];
  if (!record.operation.command && EXPLICIT_TARGET_CLASSES.has(classification.operation_class) && !targets.length) {
    return result({ decision: 'unsupported', reason: 'UNRESOLVED_TARGET_UNSUPPORTED', enforcement: 'stop-before-execution', targetClass: 'unresolved-target', operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  }
  const inside = targetsInsideAuthorisedRoots(targets) || (!targets.length && record.repository?.path_resolution_status === 'resolved');
  const outside = targets.some((target) => !target.resolved_inside || ['outside-repository', 'sibling-repository', 'parent-workspace', 'mixed-targets', 'unknown-target'].includes(target.target_class));
  if (outside || targetClass === 'mixed-targets') {
    if (DENY_CLASSES.has(classification.operation_class)) return result({ decision: 'deny', reason: classification.reason_codes?.[0] || 'PROTECTED_TARGET_DENIED', enforcement: 'hard-deny', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    const approved = approvalDecision(record, classification, options);
    if (approved.decision === 'allow') return result({ decision: 'allow', reason: approved.reason, enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    if (approved.decision === 'unsupported') return result({ decision: 'unsupported', reason: approved.reason, enforcement: 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    return result({ decision: 'ask', reason: 'OUTSIDE_REPOSITORY_TARGET', enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  }

  if (classification.operation_class === 'git-push') {
    const push = classification.git_push || {};
    const branchOkay = record.authority.branch_name && record.authority.authorized_branch && record.authority.branch_name === record.authority.authorized_branch && !record.authority.branch_protected;
    if (!push.force && !push.other_target && push.remote === 'origin' && record.authority.push_authorized === true && branchOkay) {
      return result({ decision: 'allow', reason: 'AUTHORISED_NORMAL_PUSH', enforcement: 'routine-repository-authority', targetClass: inside ? 'canonical-repository' : targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    }
    const approvedPush = approvalDecision(record, classification, options);
    if (approvedPush.decision === 'allow') return result({ decision: 'allow', reason: approvedPush.reason, enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    return result({ decision: approvedPush.decision, reason: approvedPush.decision === 'ask' ? 'EXTERNAL_MUTATION_REQUIRES_APPROVAL' : approvedPush.reason, enforcement: approvedPush.decision === 'ask' ? 'trusted-one-shot-approval' : 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  }

  if (ASK_CLASSES.has(classification.operation_class) || classification.decision_hint === 'ask') {
    const approved = approvalDecision(record, classification, options);
    if (approved.decision === 'allow') return result({ decision: 'allow', reason: approved.reason, enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    if (approved.decision === 'unsupported') return result({ decision: 'unsupported', reason: approved.reason, enforcement: 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
    return result({ decision: 'ask', reason: classification.operation_class === 'external-mutation' ? 'EXTERNAL_MUTATION_REQUIRES_APPROVAL' : 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL', enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  }

  if (ROUTINE_CLASSES.has(classification.operation_class) && inside) {
    if (classification.operation_class === 'toolkit-temp-cleanup') {
      const evidence = record.operation.transaction_evidence || record.operation.structured_input?.transaction_evidence;
      if (!(evidence?.owned_by_toolkit === true && evidence?.created_by_same_transaction === true && evidence?.exact_target_set === true)) {
        return result({ decision: 'ask', reason: 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL', enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
      }
    }
    return result({ decision: 'allow', reason: classification.operation_class.startsWith('git-') ? 'ROUTINE_GIT_OPERATION' : 'ROUTINE_REPOSITORY_OPERATION', enforcement: 'routine-repository-authority', targetClass: targetClass === 'unknown-target' ? 'canonical-repository' : targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  }

  const approved = approvalDecision(record, classification, options);
  if (approved.decision === 'allow') return result({ decision: 'allow', reason: approved.reason, enforcement: 'trusted-one-shot-approval', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
  return result({ decision: approved.decision === 'ask' ? 'ask' : 'unsupported', reason: approved.decision === 'ask' ? 'OUTSIDE_REPOSITORY_TARGET' : approved.reason, enforcement: approved.decision === 'ask' ? 'trusted-one-shot-approval' : 'stop-before-execution', targetClass, operationClass: classification.operation_class, requestDigest, operationDigest, targetDigest });
}

function evaluateOne(input, options = {}) {
  let record;
  try {
    record = normalizeOperation(input, options);
  } catch (error) {
    return safeFailure(options.resolveRepositoryContext ? 'RESOLVER_FAILURE_UNSUPPORTED' : 'MALFORMED_OPERATION_UNSUPPORTED', input, 'RESOLVER_FAILURE_UNSUPPORTED');
  }
  let classification;
  try {
    const classifier = options.classifier || classifyOperation;
    classification = classifier(record, options);
    if (!classification || typeof classification.operation_class !== 'string') throw new Error('CLASSIFICATION_INVALID');
    ensureCommandTargets(record, classification, options);
    refreshOperationDigests(record, classification);
  } catch (error) {
    return safeFailure('CLASSIFIER_FAILURE_UNSUPPORTED', input, 'CLASSIFIER_FAILURE_UNSUPPORTED');
  }
  return decideOne(record, classification, options);
}

function mergeResults(results, input) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return safeFailure('MALFORMED_OPERATION_UNSUPPORTED', input);
  const decision = mostRestrictive(list.map((entry) => entry.decision));
  const selected = list.reduce((current, candidate) => (decisionRank(candidate.decision) > decisionRank(current.decision) ? candidate : current), list[0]);
  const classes = [...new Set(list.map((entry) => entry.operation_class))];
  const targetClasses = [...new Set(list.map((entry) => entry.safe_target_class))];
  return {
    ...selected,
    decision,
    reason_code: decision === selected.decision ? selected.reason_code : 'MIXED_TARGET_RESTRICTION',
    operation_class: classes.length === 1 ? classes[0] : 'mixed-operation',
    safe_target_class: targetClasses.length === 1 ? targetClasses[0] : 'mixed-targets',
    request_digest: sha256(list.map((entry) => entry.request_digest)),
    operation_digest: sha256(list.map((entry) => entry.operation_digest)),
    target_digest: sha256(list.map((entry) => entry.target_digest)),
    privacy_safe: true,
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
};
