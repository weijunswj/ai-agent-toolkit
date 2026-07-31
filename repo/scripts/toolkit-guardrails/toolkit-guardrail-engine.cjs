'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
  resolveTargets,
} = require('./toolkit-active-repository.cjs');
const {
  computeTargetDigest,
  normalizeOperation,
  refreshOperationDigests,
  computeComponentDigest,
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
const OPERATION_SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', '_projects', 'development', 'toolkit-guardrails', '_main', 'operation-contract.schema.json');
let operationSchemaValidator;

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function schemaObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function schemaDeepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => schemaDeepEqual(item, right[index]));
  if (schemaObject(left) || schemaObject(right)) {
    if (!schemaObject(left) || !schemaObject(right)) return false;
    const keys = Object.keys(left).sort();
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && schemaDeepEqual(left[key], right[key]));
  }
  return false;
}

function schemaTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'object') return schemaObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  throw new Error('UNKNOWN_SCHEMA_TYPE');
}

class RuntimeSchemaValidator {
  constructor(schema) {
    this.schema = schema;
    this.assertKnown(schema, '#');
  }

  assertKnown(schema, schemaPath) {
    if (schema === true || schema === false) return;
    if (!schemaObject(schema)) throw new Error('MALFORMED_OPERATION_SCHEMA');
    const allowed = new Set(['$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items', 'anyOf', 'oneOf', 'allOf', 'if', 'then', 'else', 'not', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties']);
    if (Object.keys(schema).some((key) => !allowed.has(key))) throw new Error(`UNKNOWN_OPERATION_SCHEMA_KEYWORD:${schemaPath}`);
    if (schema.$defs) Object.entries(schema.$defs).forEach(([key, child]) => this.assertKnown(child, `${schemaPath}/$defs/${key}`));
    if (schema.properties) Object.entries(schema.properties).forEach(([key, child]) => this.assertKnown(child, `${schemaPath}/properties/${key}`));
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') this.assertKnown(schema.additionalProperties, `${schemaPath}/additionalProperties`);
    if (schema.items && typeof schema.items === 'object') this.assertKnown(schema.items, `${schemaPath}/items`);
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) if (schema[keyword]) schema[keyword].forEach((child, index) => this.assertKnown(child, `${schemaPath}/${keyword}/${index}`));
    for (const keyword of ['if', 'then', 'else', 'not']) if (schema[keyword] !== undefined) this.assertKnown(schema[keyword], `${schemaPath}/${keyword}`);
  }

  resolve(reference) {
    if (reference === '#') return { schema: this.schema, path: '#' };
    if (typeof reference !== 'string' || !reference.startsWith('#/')) throw new Error('UNSUPPORTED_OPERATION_SCHEMA_REFERENCE');
    let current = this.schema;
    for (const part of reference.slice(2).split('/').map((value) => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!schemaObject(current) || !Object.hasOwn(current, part)) throw new Error('UNKNOWN_OPERATION_SCHEMA_REFERENCE');
      current = current[part];
    }
    return { schema: current, path: reference };
  }

  validate(instance) {
    const errors = [];
    this.visit(this.schema, instance, '#', '', errors);
    return { valid: errors.length === 0, errors };
  }

  visit(schema, instance, schemaPath, instancePath, errors) {
    if (schema === true) return;
    if (schema === false) { errors.push({ schema_path: schemaPath, instance_path: instancePath, reason_code: 'FALSE_SCHEMA' }); return; }
    if (schema.$ref !== undefined) {
      const ref = this.resolve(schema.$ref);
      this.visit(ref.schema, instance, ref.path, instancePath, errors);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => schemaTypeMatches(instance, type))) { errors.push({ schema_path: `${schemaPath}/type`, instance_path: instancePath, reason_code: 'TYPE_MISMATCH' }); return; }
    }
    if (schema.const !== undefined && !schemaDeepEqual(instance, schema.const)) errors.push({ schema_path: `${schemaPath}/const`, instance_path: instancePath, reason_code: 'CONST_MISMATCH' });
    if (schema.enum !== undefined && !schema.enum.some((value) => schemaDeepEqual(instance, value))) errors.push({ schema_path: `${schemaPath}/enum`, instance_path: instancePath, reason_code: 'ENUM_MISMATCH' });
    if (schema.required && schemaObject(instance)) for (const key of schema.required) if (!Object.hasOwn(instance, key)) errors.push({ schema_path: `${schemaPath}/required`, instance_path: `${instancePath}/${key}`, reason_code: 'REQUIRED_PROPERTY' });
    if (schemaObject(instance) && schema.properties) for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(instance, key)) this.visit(child, instance[key], `${schemaPath}/properties/${key}`, `${instancePath}/${key}`, errors);
    if (schemaObject(instance) && schema.additionalProperties !== undefined) {
      const declared = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(instance)) if (!declared.has(key)) {
        if (schema.additionalProperties === false) errors.push({ schema_path: `${schemaPath}/additionalProperties`, instance_path: `${instancePath}/${key}`, reason_code: 'ADDITIONAL_PROPERTY' });
        else if (schema.additionalProperties !== true) this.visit(schema.additionalProperties, instance[key], `${schemaPath}/additionalProperties`, `${instancePath}/${key}`, errors);
      }
    }
    if (Array.isArray(instance) && schema.items) instance.forEach((item, index) => this.visit(schema.items, item, `${schemaPath}/items`, `${instancePath}/${index}`, errors));
    if (typeof instance === 'string') {
      if (schema.minLength !== undefined && instance.length < schema.minLength) errors.push({ schema_path: `${schemaPath}/minLength`, instance_path: instancePath, reason_code: 'MIN_LENGTH' });
      if (schema.maxLength !== undefined && instance.length > schema.maxLength) errors.push({ schema_path: `${schemaPath}/maxLength`, instance_path: instancePath, reason_code: 'MAX_LENGTH' });
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(instance)) errors.push({ schema_path: `${schemaPath}/pattern`, instance_path: instancePath, reason_code: 'PATTERN_MISMATCH' });
    }
    if (typeof instance === 'number' && Number.isFinite(instance)) {
      if (schema.minimum !== undefined && instance < schema.minimum) errors.push({ schema_path: `${schemaPath}/minimum`, instance_path: instancePath, reason_code: 'MINIMUM' });
      if (schema.maximum !== undefined && instance > schema.maximum) errors.push({ schema_path: `${schemaPath}/maximum`, instance_path: instancePath, reason_code: 'MAXIMUM' });
      if (schema.multipleOf !== undefined && instance % schema.multipleOf !== 0) errors.push({ schema_path: `${schemaPath}/multipleOf`, instance_path: instancePath, reason_code: 'MULTIPLE_OF' });
    }
    if (Array.isArray(instance)) {
      if (schema.minItems !== undefined && instance.length < schema.minItems) errors.push({ schema_path: `${schemaPath}/minItems`, instance_path: instancePath, reason_code: 'MIN_ITEMS' });
      if (schema.maxItems !== undefined && instance.length > schema.maxItems) errors.push({ schema_path: `${schemaPath}/maxItems`, instance_path: instancePath, reason_code: 'MAX_ITEMS' });
      if (schema.uniqueItems === true && instance.some((item, index) => instance.slice(index + 1).some((other) => schemaDeepEqual(item, other)))) errors.push({ schema_path: `${schemaPath}/uniqueItems`, instance_path: instancePath, reason_code: 'UNIQUE_ITEMS' });
    }
    if (schemaObject(instance)) {
      if (schema.minProperties !== undefined && Object.keys(instance).length < schema.minProperties) errors.push({ schema_path: `${schemaPath}/minProperties`, instance_path: instancePath, reason_code: 'MIN_PROPERTIES' });
      if (schema.maxProperties !== undefined && Object.keys(instance).length > schema.maxProperties) errors.push({ schema_path: `${schemaPath}/maxProperties`, instance_path: instancePath, reason_code: 'MAX_PROPERTIES' });
    }
    for (const keyword of ['anyOf', 'oneOf']) if (schema[keyword]) {
      const matches = schema[keyword].filter((child, index) => { const branchErrors = []; this.visit(child, instance, `${schemaPath}/${keyword}/${index}`, instancePath, branchErrors); return branchErrors.length === 0; }).length;
      if ((keyword === 'anyOf' && matches === 0) || (keyword === 'oneOf' && matches !== 1)) errors.push({ schema_path: `${schemaPath}/${keyword}`, instance_path: instancePath, reason_code: keyword === 'anyOf' ? 'ANY_OF_FAILED' : 'ONE_OF_FAILED' });
    }
    if (schema.allOf) schema.allOf.forEach((child, index) => this.visit(child, instance, `${schemaPath}/allOf/${index}`, instancePath, errors));
    if (schema.if) {
      const conditionErrors = []; this.visit(schema.if, instance, `${schemaPath}/if`, instancePath, conditionErrors);
      if (!conditionErrors.length && schema.then) this.visit(schema.then, instance, `${schemaPath}/then`, instancePath, errors);
      if (conditionErrors.length && schema.else) this.visit(schema.else, instance, `${schemaPath}/else`, instancePath, errors);
    }
    if (schema.not) { const notErrors = []; this.visit(schema.not, instance, `${schemaPath}/not`, instancePath, notErrors); if (!notErrors.length) errors.push({ schema_path: `${schemaPath}/not`, instance_path: instancePath, reason_code: 'NOT_VIOLATED' }); }
  }
}

function validateNormalizedOperationContract(record) {
  try {
    if (!operationSchemaValidator) operationSchemaValidator = new RuntimeSchemaValidator(JSON.parse(fs.readFileSync(OPERATION_SCHEMA_PATH, 'utf8')));
    return operationSchemaValidator.validate(record);
  } catch (error) {
    return { valid: false, errors: [{ reason_code: 'OPERATION_SCHEMA_UNAVAILABLE' }] };
  }
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

function result({ decision, reason, enforcement, targetClass, operationClass, requestDigest, operationDigest, targetDigest, componentDigestValue = null, componentCount = 0 }) {
  return {
    decision,
    reason_code: reasonCode(reason),
    enforcement_requirement: enforcement,
    safe_target_class: targetClass || 'unknown-target',
    operation_class: operationClass || 'unsupported-route',
    request_digest: requestDigest || sha256({ decision, reason }),
    operation_digest: operationDigest || sha256({ decision, operationClass }),
    target_digest: targetDigest || sha256([]),
    ...(componentDigestValue ? { component_digest: componentDigestValue, component_count: componentCount } : {}),
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
  if (record.native_state?.auto_or_bypass === true) {
    if (classification.decision_hint === 'ask' && evidence.trusted_ask !== true) return { decision: 'unsupported', reason: 'UNSUPPORTED_ROUTE' };
    return { decision: 'allow', reason: null };
  }
  return { decision: 'allow', reason: null };
}

function classificationComponents(classification) {
  if (Array.isArray(classification?.components) && classification.components.length) return classification.components;
  return [{
    operation_class: classification?.operation_class || 'unsupported-route',
    decision_hint: classification?.decision_hint || 'unsupported',
    reason_code: classification?.reason_codes?.[0] || null,
  }];
}

function componentClasses(classification) {
  return classificationComponents(classification).map((entry) => entry.operation_class).filter((value) => typeof value === 'string');
}

function componentDigest(classification) {
  return computeComponentDigest(classification);
}

function externalTargetDigest(record) {
  return sha256(record?.operation?.external_targets || []);
}

function controllerAuthorityCheck(record, classification, options = {}) {
  const binding = record.authority?.controller_authorization;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { decision: 'unsupported', reason: 'GITHUB_MUTATION_AUTHORITY_REQUIRED' };
  const rawNow = firstDefined(options.now, Date.now());
  const now = typeof rawNow === 'number' ? (rawNow < 100000000000 ? rawNow * 1000 : rawNow) : Date.parse(String(rawNow));
  const expiry = typeof binding.expires_at === 'number'
    ? (binding.expires_at < 100000000000 ? binding.expires_at * 1000 : binding.expires_at)
    : Date.parse(String(binding.expires_at));
  if (!Number.isFinite(expiry) || expiry <= now) return { decision: 'unsupported', reason: 'GITHUB_MUTATION_AUTHORITY_EXPIRED' };
  const operationDigest = record.operation.input_digest;
  const targetDigest = record.operation.target_digest;
  const expected = {
    status: 'verified',
    trusted: true,
    operation_digest: operationDigest,
    target_digest: targetDigest,
    request_digest: operationDigest,
    external_target_digest: externalTargetDigest(record),
    operation_class: classification.operation_class,
    component_digest: componentDigest(classification),
    scope: record.operation.scope,
  };
  const fields = Object.keys(expected);
  if (fields.some((field) => binding[field] !== expected[field])) return { decision: 'unsupported', reason: 'GITHUB_MUTATION_AUTHORITY_MISMATCH' };
  return { decision: 'allow', reason: 'CONTROLLER_GITHUB_AUTHORIZED' };
}

function authorityCheck(record, classification, policy, options = {}) {
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

  const classes = componentClasses(classification);
  const githubComponent = classes.find((operationClass) => GITHUB_MUTATION_CLASSES.has(operationClass));
  if (githubComponent) {
    if (authority.role_name !== 'controller') return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
    if (classes.length !== 1 || classes[0] !== githubComponent) return { decision: 'unsupported', reason: 'GITHUB_COMPONENT_AUTHORITY_REQUIRED' };
    if (authority.controller_authorized !== true || !Array.isArray(authority.controller_operation_classes) || (!authority.controller_operation_classes.includes(githubComponent) && !authority.controller_operation_classes.includes('all'))) return { decision: 'unsupported', reason: 'GITHUB_MUTATION_AUTHORITY_REQUIRED' };
    return controllerAuthorityCheck(record, classification, options);
  }
  if (policy.authority.controller_only_operation_classes.includes(classification.operation_class)) return { decision: 'deny', reason: 'ROLE_AUTHORITY_VIOLATION' };
  return { decision: 'allow', reason: null };
}

function pathText(target) {
  return String(target?.canonical_path || target?.raw_path || '').trim();
}

function isSecretBearingPath(target) {
  const value = pathText(target);
  return /(?:^|[\\/])(?:\.env[^\\/]*|\.ssh[\\/](?:id_[^\\/]+|[^\\/]+\.(?:pem|key))|\.aws[\\/]credentials|\.gnupg(?:[\\/]|$)|credentials(?:\.[^\\/]*)?|(?:id_rsa|id_ed25519|private[_-]?key)(?:\.[^\\/]*)?)(?:[\\/]|$)/i.test(value)
    || /(?:^|[\\/])(?:shadow|gshadow|SAM|SECURITY)(?:$|[\\/])/i.test(value);
}

function isCatastrophicPath(target) {
  const raw = pathText(target);
  if (raw === '/' || /^[A-Za-z]:[\\/]?$/.test(raw)) return true;
  const value = raw.replace(/[\\/]$/, '');
  if (/(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|credentials|shadow|gshadow|SAM|SECURITY)(?:[\\/]|$)/i.test(`${value}\\`)) return true;
  return /^(?:[A-Za-z]:[\\/](?:Windows|Program Files|ProgramData|System32)|[\\/](?:etc|sys|boot|root|var[\\/]lib))(?:[\\/]|$)/i.test(`${value}\\`);
}

function targetClassFor(record, classification) {
  const targets = record.operation.targets || [];
  if (targets.some(isCatastrophicPath) || classification.catastrophic_hint) return 'protected-target';
  if (classification.secret_target) return 'secret-bearing';
  if (targets.some(isSecretBearingPath)) return 'secret-bearing';
  if (classification.external_targets?.length || record.operation.external_targets?.length || record.operation.mcp_server || record.operation.mcp_tool) return 'external-system';
  if (targets.length) return targetSetClass(targets);
  if (record.repository?.path_resolution_status === 'resolved') return 'canonical-repository';
  return 'unknown-target';
}

function ensureCommandTargets(record, classification, options) {
  if (Array.isArray(classification.targets) && classification.targets.length) {
    const rebound = [];
    for (const target of classification.targets) {
      if (!target || typeof target !== 'object' || Array.isArray(target) || typeof target.raw_path !== 'string') throw new Error('CLASSIFICATION_TARGET_INVALID');
      if (target.evidence?.source === 'operation-variable') {
        if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/i.test(target.raw_path) || target.status !== 'resolved' || target.target_class !== 'secret-bearing' || target.resolved_inside !== false) throw new Error('CLASSIFICATION_TARGET_INVALID');
        rebound.push({
          raw_path: target.raw_path,
          lexical_path: null,
          canonical_path: null,
          status: 'resolved',
          target_class: 'secret-bearing',
          link_type: 'none',
          resolved_inside: false,
          approved_root: null,
          evidence: { status: 'trusted', source: 'operation-variable' },
        });
        continue;
      }
      const resolved = resolveTargets([{ path: target.raw_path, operation_cwd: record.operation.operation_cwd }], record.repository, options)[0];
      if (!resolved || resolved.raw_path !== target.raw_path) throw new Error('CLASSIFICATION_TARGET_INVALID');
      rebound.push(resolved);
    }
    record.operation.targets = rebound;
  }
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
  const authority = authorityCheck(record, classification, policy, options);
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
      componentDigestValue: componentDigest(classification),
      componentCount: classificationComponents(classification).length,
    });

  const classes = componentClasses(classification);
  const hasSecretComponent = classes.some((operationClass) => ['secret-access', 'secret-dump', 'secret-exfiltration'].includes(operationClass)) || classification.secret_target === true;
  const hasExternalComponent = classes.some((operationClass) => operationClass === 'external-mutation' || GITHUB_MUTATION_CLASSES.has(operationClass)) || (record.operation.external_targets || []).length > 0;
  if (hasSecretComponent && hasExternalComponent && !classes.includes('secret-exfiltration')) return make('deny', 'SECRET_EXFILTRATION_DENIED', 'hard-deny', 'secret-bearing', 'secret-exfiltration');

  if (classification.decision_hint === 'deny' || DENY_CLASSES.has(classification.operation_class) || classes.some((operationClass) => DENY_CLASSES.has(operationClass))) {
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

  if (targetClass === 'secret-bearing' && !ASK_CLASSES.has(classification.operation_class)) {
    const approvedSecret = approvalDecision(record, options);
    if (approvedSecret.decision === 'allow') return make('allow', approvedSecret.reason, 'trusted-one-shot-approval');
    if (approvedSecret.decision === 'unsupported') return make('unsupported', approvedSecret.reason, 'stop-before-execution');
    return make('ask', 'SECRET_ACCESS_REQUIRES_APPROVAL', 'trusted-one-shot-approval', 'secret-bearing', 'secret-access');
  }

  if (GITHUB_MUTATION_CLASSES.has(classification.operation_class) && authority.reason === 'CONTROLLER_GITHUB_AUTHORIZED') return make('allow', authority.reason, 'controller-authority', 'external-system');

  if (classification.operation_class === 'git-push') {
    const push = classification.git_push || {};
    const branchOkay = nonEmptyString(record.authority.branch_name)
      && nonEmptyString(record.authority.authorized_branch)
      && record.authority.branch_name === record.authority.authorized_branch
      && record.authority.branch_protected === false;
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
    const reason = /(?:_TYPE_INVALID|OPERATION_INPUT_REQUIRED)$/.test(String(error?.message || ''))
      ? 'OPERATION_CONTRACT_INVALID'
      : (options.resolveRepositoryContext ? 'RESOLVER_FAILURE_UNSUPPORTED' : 'MALFORMED_OPERATION_UNSUPPORTED');
    return safeFailure(reason, input);
  }
  const contractResult = validateNormalizedOperationContract(record);
  if (!contractResult.valid) return safeFailure('OPERATION_CONTRACT_INVALID', input);
  let classification;
  try {
    const classifier = options.classifier || classifyOperation;
    classification = classifier(record, options);
    if (!classification || typeof classification.operation_class !== 'string') throw new Error('CLASSIFICATION_INVALID');
    ensureCommandTargets(record, classification, options);
    refreshOperationDigests(record, classification);
    if (!validateNormalizedOperationContract(record).valid) return safeFailure('OPERATION_CONTRACT_INVALID', input);
  } catch (error) {
    return safeFailure(error?.message === 'CLASSIFICATION_TARGET_INVALID' ? 'OPERATION_CONTRACT_INVALID' : 'CLASSIFIER_FAILURE_UNSUPPORTED', input);
  }
  return decideOne(record, classification, options);
}

function mergeResults(results, input) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return safeFailure('MALFORMED_OPERATION_UNSUPPORTED', input);
  const decision = mostRestrictive(list.map((entry) => entry.decision));
  const resultAuthorityRank = (entry) => {
    if (['secret-exfiltration', 'secret-dump', 'guardrail-bypass', 'protected-target', 'catastrophic-target', 'role-boundary-violation'].includes(entry.operation_class)) return 100;
    if (entry.operation_class === 'secret-access') return 80;
    if (typeof entry.operation_class === 'string' && entry.operation_class.startsWith('github-')) return 75;
    if (['git-force-push', 'git-destructive', 'delete'].includes(entry.operation_class)) return 70;
    if (entry.operation_class === 'external-mutation') return 60;
    return 0;
  };
  const selected = list.reduce((current, candidate) => (
    decisionRank(candidate.decision) > decisionRank(current.decision)
      || (decisionRank(candidate.decision) === decisionRank(current.decision) && resultAuthorityRank(candidate) > resultAuthorityRank(current))
      ? candidate
      : current
  ), list[0]);
  const secondaryReasonCodes = [...new Set(list.map((entry) => entry.reason_code).filter((code) => code && code !== selected.reason_code))];
  return {
    ...selected,
    decision,
    request_digest: sha256(list.map((entry) => entry.request_digest)),
    operation_digest: sha256(list.map((entry) => entry.operation_digest)),
    target_digest: sha256(list.map((entry) => entry.target_digest)),
    component_digest: sha256(list.map((entry) => entry.component_digest || null)),
    component_count: list.reduce((sum, entry) => sum + (Number.isInteger(entry.component_count) ? entry.component_count : 0), 0),
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
  validateNormalizedOperationContract,
};
