#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENVELOPE_SCHEMA_VERSION = 'ai-agent-toolkit.external-authorisation-envelope.v1';
const CONSUMER_SCHEMA_VERSION = 'ai-agent-toolkit.external-consumer-requirements.v1';
const REGISTRY_SCHEMA_VERSION = 'ai-agent-toolkit.provider-target-registry.v1';
const AUDIT_SCHEMA_VERSION = 'ai-agent-toolkit.capability-audit.v1';
const LEDGER_SCHEMA_VERSION = 'ai-agent-toolkit.capability-ledger.v1';
const RECEIPT_SCHEMA_VERSION = 'ai-agent-toolkit.operation-receipt.v1';
const ROUTE_LIFECYCLE_SCHEMA_VERSION = 'ai-agent-toolkit.route-lifecycle.v1';
const HOST_ADAPTER_PLAN_SCHEMA_VERSION = 'ai-agent-toolkit.host-adapter-plan.v1';
const INVENTORY_AUTHORITY_SCHEMA_VERSION = 'ai-agent-toolkit.inventory-authority.v1';
const OPERATION_SEMANTICS_SCHEMA_VERSION = 'ai-agent-toolkit.operation-semantics.v1';
const ROUTER_VERSION = '1.0.9';
const QUESTION_BANK_SCHEMA_VERSION = 'ai-agent-toolkit.external-reconciliation-question-bank.v1';
const ANSWER_SCHEMA_VERSION = 'ai-agent-toolkit.external-reconciliation-answers.v1';
const MAX_INVENTORY_BYTES = 1024 * 1024;
const MAX_INVENTORY_TARGETS = 100;
const INVENTORY_AUTHORITIES = new WeakMap();
const HOST_PLAN_AUTHORITIES = new WeakMap();
const SELECTED_ROUTE_AUTHORITIES = new WeakMap();
const LOADED_INVENTORY_GENERATIONS = new Map();

const RISK_TIERS = Object.freeze({ INSPECTION: 0, REVERSIBLE: 1, SENSITIVE_REVERSIBLE: 2, DESTRUCTIVE: 3 });
const INTERFACE_KINDS = new Set([
  'api', 'cli', 'sdk', 'mcp', 'connector', 'plugin', 'direct-protocol',
  'browser', 'computer-use', 'owner-action'
]);
const STRUCTURED_INTERFACE_KINDS = new Set([
  'api', 'cli', 'sdk', 'mcp', 'connector', 'plugin', 'direct-protocol'
]);
const GRAPHICAL_CAPABILITIES = new Set([
  'browser', 'chrome', 'computer-use', 'accessibility', 'ui-automation', 'screenshot-driven-control',
  'desktop-automation', 'file-picker', 'ui-clipboard', 'graphical-control'
]);
const RECONCILIATION_TRIGGERS = Object.freeze([
  'session-start', 'substantive-task', 'branch-switch', 'pull', 'repository-change',
  'managed-marker-drift', 'provider-assets-appeared', 'host-switch', 'capability-failure',
  'schema-drift', 'explicit-provider-intent'
]);
const HISTORY_SAFER_PATHS = Object.freeze([
  'committed-requirements', 'local-target-registry', 'configured-interface-metadata',
  'approved-context-origins', 'safe-public-provider-metadata-or-approved-tabs', 'ask-owner-for-url'
]);
const N8N_DOMAIN_MARKERS = Object.freeze({
  begin: '<!-- AI-AGENT-TOOLKIT:N8N:BEGIN -->',
  end: '<!-- AI-AGENT-TOOLKIT:N8N:END -->'
});
const LEGACY_N8N_MARKERS = Object.freeze({
  begin: '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:BEGIN N8N-AGENT-RULES-ADAPTER v1 -->',
  end: '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:END N8N-AGENT-RULES-ADAPTER -->'
});
const N8N_DOMAIN_BODY = [
  '## n8n Domain Routing',
  '',
  'For n8n workflow JSON, node/expression design, helper/compiler scripts, credentials, import/export, live transport, activation, or execution, load `n8n-agent-rules` and enter the fail-closed n8n domain router before planning or editing.',
  'Classify the exact operation and satisfy the task-local ledger. Material workflow work requires the current official entry point plus every relevant specialised official Skill; repository examples, model knowledge, generic JSON validation, and tests are not substitutes.',
  'Treat official n8n Skills and live n8n MCP as separate capabilities. Route helpers/compiler work through Toolkit helpers and select live transport per operation; mandatory routing does not mean mandatory MCP.',
  'Live n8n, Docker, credential, import/export, activation, execution, deployment, production, or destructive actions require the external-system task envelope and the applicable n8n approval boundary.'
].join('\n');

const ALIAS_PATTERN_SOURCE = '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$';
const INTERFACE_RESTRICTION_PATTERN_SOURCE = '^(?:(?:no|forbid)-|(?:forbid|require):)[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$';
const ALIAS_PATTERN = new RegExp(ALIAS_PATTERN_SOURCE);
const INTERFACE_RESTRICTION_PATTERN = new RegExp(INTERFACE_RESTRICTION_PATTERN_SOURCE);
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{16,64}$/;
const CREDENTIAL_REFERENCE_PATTERN = /^(credential-store|os-keychain|password-manager|secret-broker|session-injection):\/\/[a-zA-Z0-9._/-]+$/;
const PRIVATE_REFERENCE_PATTERN = /^(credential-store|local-registry|os-keychain):\/\/[a-zA-Z0-9._/-]+$/;
const SECRETISH_KEY_PATTERN = /(^|[_-])(token|secret|password|cookie|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|connection[_-]?string|dsn|credential[_-]?value)([_-]|$)/i;
const PRIVATE_IDENTIFIER_KEY_PATTERN = /(^|[_-])(account|organisation|organization|project|resource|instance|application|bucket|database)[_-]?(id|uuid|number)([_-]|$)/i;
const SECRETISH_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
  /\b(?:ghp|github_pat|sk_live|sk_test|xox[baprs])_[A-Za-z0-9_-]{12,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
  /\b(?:token|secret|password|cookie|authorization|api[-_ ]?key|private[-_ ]?key|client[-_ ]?secret|connection[-_ ]?string|dsn|credential[-_ ]?value)\s*[:=]\s*["']?[^\s,"'}]{4,}/i,
  /\b(?:account|organi[sz]ation|project|resource|instance|application|bucket|database|oauth[-_ ]?client)[-_ ]?(?:id|uuid|number)\s*[:=]\s*["']?[A-Za-z0-9._:-]{4,}/i,
  /(?:^|[\s"'])\/?(?:Users|home)\/[A-Za-z0-9._-]+\//,
  /[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s]+\\/i
];

function invariant(condition, message, code = 'EXTERNAL_ROUTER_INVALID') {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  invariant(isPlainObject(value), `${label} must be an object.`);
  return value;
}

function requireString(value, label, options = {}) {
  invariant(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string.`);
  const trimmed = value.trim();
  if (options.max) invariant(trimmed.length <= options.max, `${label} is too long.`);
  if (options.pattern) invariant(options.pattern.test(trimmed), `${label} has an invalid format.`);
  return trimmed;
}

function requireStringArray(value, label, options = {}) {
  invariant(Array.isArray(value), `${label} must be an array.`);
  if (options.min !== undefined) invariant(value.length >= options.min, `${label} requires at least ${options.min} item(s).`);
  const normalized = value.map((entry, index) => requireString(entry, `${label}[${index}]`, { max: options.max || 300, pattern: options.pattern }));
  if (options.unique) invariant(new Set(normalized).size === normalized.length, `${label} must not contain duplicates.`);
  return normalized;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) invariant(allowed.has(key), `${label} contains unsupported field ${key}.`);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function sha256(value, length = 64) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : typeof value === 'string' ? value : stableJson(value);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, length)}`;
}

function objectiveAuthorityDigest(objective) {
  return sha256({ objective: requireString(objective, 'objective', { max: 500 }) });
}

function operationSemanticsDigest(semantics) {
  return sha256({
    schemaVersion: semantics.schemaVersion,
    operation: semantics.operation,
    mutationClass: semantics.mutationClass,
    destructive: semantics.destructive,
    irreversible: semantics.irreversible,
    crossTarget: semantics.crossTarget,
    highBlastRadius: semantics.highBlastRadius,
    minimumRiskByEnvironment: semantics.minimumRiskByEnvironment,
    requiredPreconditions: semantics.requiredPreconditions,
    requiredPostconditions: semantics.requiredPostconditions,
    rollbackOrSafeDisable: semantics.rollbackOrSafeDisable,
    receiptClass: semantics.receiptClass
  });
}

function validateOperationSemantics(semantics) {
  requireObject(semantics, 'Operation semantics');
  assertAllowedKeys(semantics, new Set([
    'schemaVersion', 'operation', 'mutationClass', 'destructive', 'irreversible', 'crossTarget',
    'highBlastRadius', 'minimumRiskByEnvironment', 'requiredPreconditions', 'requiredPostconditions',
    'rollbackOrSafeDisable', 'receiptClass', 'semanticsDigest'
  ]), 'Operation semantics');
  invariant(semantics.schemaVersion === OPERATION_SEMANTICS_SCHEMA_VERSION, 'Unsupported operation-semantics schema.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  requireString(semantics.operation, 'operationSemantics.operation', { pattern: ALIAS_PATTERN });
  invariant(['read-only', 'mutation'].includes(semantics.mutationClass), 'Unsupported operation mutationClass.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  for (const field of ['destructive', 'irreversible', 'crossTarget', 'highBlastRadius']) {
    invariant(typeof semantics[field] === 'boolean', `Operation semantics ${field} must be boolean.`, 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  }
  requireObject(semantics.minimumRiskByEnvironment, 'minimumRiskByEnvironment');
  invariant(Number.isInteger(semantics.minimumRiskByEnvironment.default)
    && semantics.minimumRiskByEnvironment.default >= 0
    && semantics.minimumRiskByEnvironment.default <= 3,
  'Operation semantics requires a default risk floor.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  for (const [environment, tier] of Object.entries(semantics.minimumRiskByEnvironment)) {
    requireString(environment, 'minimumRiskByEnvironment key', { pattern: ALIAS_PATTERN });
    invariant(Number.isInteger(tier) && tier >= 0 && tier <= 3,
      `Operation semantics risk floor for ${environment} must be 0-3.`, 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  }
  requireStringArray(semantics.requiredPreconditions, 'requiredPreconditions', {
    min: semantics.mutationClass === 'mutation' ? 1 : 0, unique: true
  });
  requireStringArray(semantics.requiredPostconditions, 'requiredPostconditions', {
    min: semantics.mutationClass === 'mutation' ? 1 : 0, unique: true
  });
  requireStringArray(semantics.rollbackOrSafeDisable, 'operationSemantics.rollbackOrSafeDisable', {
    min: semantics.mutationClass === 'mutation' ? 1 : 0, unique: true
  });
  invariant(['inspection', 'mutation', 'destructive'].includes(semantics.receiptClass),
    'Unsupported operation receiptClass.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  invariant((semantics.mutationClass === 'read-only') === (semantics.receiptClass === 'inspection'),
    'Operation receiptClass disagrees with mutationClass.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  const destructive = semantics.destructive || semantics.irreversible
    || semantics.crossTarget || semantics.highBlastRadius;
  if (destructive) {
    invariant(semantics.mutationClass === 'mutation' && semantics.receiptClass === 'destructive',
      'Destructive operation semantics must be a destructive mutation.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  }
  invariant((semantics.receiptClass === 'destructive') === destructive,
    'Destructive receipt semantics require an explicit destructive, irreversible, cross-target, or high-blast-radius classification.',
    'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  requireString(semantics.semanticsDigest, 'semanticsDigest', { pattern: DIGEST_PATTERN });
  invariant(semantics.semanticsDigest === operationSemanticsDigest(semantics),
    'Operation semantics digest is invalid.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  return semantics;
}

function capabilityAuditDigest(audit) {
  const value = { ...audit };
  delete value.capabilityDigest;
  return sha256(value);
}

function countOccurrences(text, marker) {
  return String(text).split(marker).length - 1;
}

function assertNoSecretMaterial(value, label = 'record', options = {}) {
  function visit(current, trail) {
    if (Array.isArray(current)) return current.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
    if (isPlainObject(current)) {
      for (const [key, entry] of Object.entries(current)) {
        if (!options.allowedSensitiveKeys?.has(key)) {
          invariant(!SECRETISH_KEY_PATTERN.test(key), `${label} contains secret-bearing field ${trail}.${key}.`, 'EXTERNAL_SECRET_REJECTED');
          invariant(!PRIVATE_IDENTIFIER_KEY_PATTERN.test(key), `${label} contains a private identifier field ${trail}.${key}.`, 'EXTERNAL_PRIVATE_DATA_REJECTED');
        }
        visit(entry, `${trail}.${key}`);
      }
      return;
    }
    if (typeof current !== 'string') return;
    if (options.strictOrigins === true && /:\/\//.test(current)) {
      invariant(current === current.trim() && isPublicHttpsOrigin(current), `${label} contains an origin outside the intentionally public origin field at ${trail}.`, 'EXTERNAL_PRIVATE_ORIGIN_REJECTED');
    }
    for (const pattern of SECRETISH_VALUE_PATTERNS) {
      invariant(!pattern.test(current), `${label} contains secret or private-path shaped material at ${trail}.`, 'EXTERNAL_SECRET_REJECTED');
    }
  }
  visit(value, '$');
  return true;
}

function isPublicHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(host)) return false;
    const secondOctet = host.match(/^172\.(\d{1,3})\./);
    if (secondOctet && Number(secondOctet[1]) >= 16 && Number(secondOctet[1]) <= 31) return false;
    if (/^\[?(?:fc|fd|fe80):/i.test(host)) return false;
    return host.includes('.');
  } catch {
    return false;
  }
}

function isPublicHttpsReference(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return isPublicHttpsOrigin(`${parsed.protocol}//${parsed.host}/`);
  } catch {
    return false;
  }
}

function validateAuthorizationEnvelope(envelope) {
  requireObject(envelope, 'Task authorisation envelope');
  const allowed = new Set([
    'schemaVersion', 'provider', 'targetAlias', 'accountOrOrganisation', 'resource', 'environment', 'objective',
    'allowedOperations', 'operationRiskTiers', 'operationSemanticsDigests', 'authorisedTier2Operations', 'forbiddenOperations', 'expectedResult', 'verification',
    'rollbackOrSafeDisable', 'lifetime', 'ownerApprovalReference', 'sensitiveDataClasses', 'interfaceRestrictions'
  ]);
  assertAllowedKeys(envelope, allowed, 'Task authorisation envelope');
  invariant(envelope.schemaVersion === ENVELOPE_SCHEMA_VERSION, 'Unsupported task authorisation envelope schema.');
  requireString(envelope.provider, 'provider', { pattern: PROVIDER_PATTERN });
  for (const field of ['targetAlias', 'accountOrOrganisation', 'resource', 'environment']) requireString(envelope[field], field, { pattern: ALIAS_PATTERN });
  requireString(envelope.objective, 'objective', { max: 500 });
  requireStringArray(envelope.allowedOperations, 'allowedOperations', { min: 1, unique: true, pattern: ALIAS_PATTERN });
  requireObject(envelope.operationRiskTiers, 'operationRiskTiers');
  assertAllowedKeys(envelope.operationRiskTiers, new Set(envelope.allowedOperations), 'operationRiskTiers');
  invariant(Object.keys(envelope.operationRiskTiers).length === envelope.allowedOperations.length, 'Every allowed operation requires one owner-approved risk tier.');
  requireObject(envelope.operationSemanticsDigests, 'operationSemanticsDigests');
  assertAllowedKeys(envelope.operationSemanticsDigests, new Set(envelope.allowedOperations), 'operationSemanticsDigests');
  invariant(Object.keys(envelope.operationSemanticsDigests).length === envelope.allowedOperations.length,
    'Every allowed operation requires one canonical operation-semantics digest.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  for (const operation of envelope.allowedOperations) {
    invariant(Number.isInteger(envelope.operationRiskTiers[operation]) && envelope.operationRiskTiers[operation] >= 0 && envelope.operationRiskTiers[operation] <= 3, `Risk tier for ${operation} must be 0-3.`);
    requireString(envelope.operationSemanticsDigests[operation], `operationSemanticsDigests.${operation}`, { pattern: DIGEST_PATTERN });
  }
  requireStringArray(envelope.authorisedTier2Operations, 'authorisedTier2Operations', { unique: true, pattern: ALIAS_PATTERN });
  requireStringArray(envelope.forbiddenOperations, 'forbiddenOperations', { unique: true, pattern: ALIAS_PATTERN });
  requireString(envelope.expectedResult, 'expectedResult', { max: 500 });
  requireStringArray(envelope.verification, 'verification', { min: 1 });
  requireStringArray(envelope.rollbackOrSafeDisable, 'rollbackOrSafeDisable', { min: 1 });
  requireString(envelope.ownerApprovalReference, 'ownerApprovalReference', { max: 200 });
  requireObject(envelope.lifetime, 'lifetime');
  assertAllowedKeys(envelope.lifetime, new Set([
    'kind', 'expiresAt', 'taskId', 'sessionFingerprint', 'objectiveDigest'
  ]), 'lifetime');
  invariant(['task', 'time-bounded'].includes(envelope.lifetime.kind), 'lifetime.kind must be task or time-bounded.');
  if (envelope.lifetime.kind === 'task') {
    requireString(envelope.lifetime.taskId, 'lifetime.taskId', { pattern: ALIAS_PATTERN });
    requireString(envelope.lifetime.sessionFingerprint, 'lifetime.sessionFingerprint', { pattern: DIGEST_PATTERN });
    requireString(envelope.lifetime.objectiveDigest, 'lifetime.objectiveDigest', { pattern: DIGEST_PATTERN });
    invariant(envelope.lifetime.objectiveDigest === objectiveAuthorityDigest(envelope.objective),
      'lifetime.objectiveDigest does not match the bounded approved objective.', 'EXTERNAL_TASK_AUTHORITY_MISMATCH');
    invariant(envelope.lifetime.expiresAt === undefined, 'Task lifetime must not also declare expiresAt.');
  } else {
    const expiresAt = Date.parse(requireString(envelope.lifetime.expiresAt, 'lifetime.expiresAt'));
    invariant(Number.isFinite(expiresAt), 'lifetime.expiresAt must be an ISO date-time.');
    for (const field of ['taskId', 'sessionFingerprint', 'objectiveDigest']) {
      invariant(envelope.lifetime[field] === undefined, `Time-bounded lifetime must not declare ${field}.`);
    }
  }
  if (envelope.sensitiveDataClasses !== undefined) requireStringArray(envelope.sensitiveDataClasses, 'sensitiveDataClasses', { unique: true, pattern: ALIAS_PATTERN });
  if (envelope.interfaceRestrictions !== undefined) {
    requireStringArray(envelope.interfaceRestrictions, 'interfaceRestrictions', {
      unique: true,
      max: 200,
      pattern: INTERFACE_RESTRICTION_PATTERN
    });
  }
  for (const operation of envelope.authorisedTier2Operations) invariant(envelope.allowedOperations.includes(operation), `Tier 2 operation ${operation} is not allowed.`);
  const tier2Operations = envelope.allowedOperations.filter((operation) => envelope.operationRiskTiers[operation] === RISK_TIERS.SENSITIVE_REVERSIBLE);
  invariant(tier2Operations.length === envelope.authorisedTier2Operations.length && tier2Operations.every((operation) => envelope.authorisedTier2Operations.includes(operation)), 'authorisedTier2Operations must exactly match the owner-approved Tier 2 operation map.');
  for (const operation of envelope.forbiddenOperations) invariant(!envelope.allowedOperations.includes(operation), `Forbidden operation ${operation} is also allowed.`);
  assertNoSecretMaterial(envelope, 'Task authorisation envelope');
  return envelope;
}

function classifyRisk(operation, semantics) {
  requireObject(operation, 'Operation');
  validateOperationSemantics(semantics);
  invariant(operation.operation === semantics.operation,
    'Operation context names a different canonical operation.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  invariant(typeof operation.readOnly === 'boolean'
    && operation.readOnly === (semantics.mutationClass === 'read-only'),
  'Operation context readOnly assertion disagrees with canonical semantics.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  invariant(operation.operationSemanticsVersion === semantics.schemaVersion
    && operation.operationSemanticsDigest === semantics.semanticsDigest,
  'Operation context does not bind the canonical operation semantics.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  for (const field of ['destructive', 'irreversible', 'crossTarget', 'highBlastRadius']) {
    if (operation[field] !== undefined) invariant(operation[field] === semantics[field],
      `Operation context ${field} assertion disagrees with canonical semantics.`, 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  }
  if (semantics.destructive || semantics.irreversible || semantics.crossTarget || semantics.highBlastRadius) {
    return RISK_TIERS.DESTRUCTIVE;
  }
  const semanticsFloor = semantics.minimumRiskByEnvironment[operation.environment]
    ?? semantics.minimumRiskByEnvironment.default;
  const mutationFloor = semantics.mutationClass === 'read-only'
    ? RISK_TIERS.INSPECTION
    : operation.environment === 'production' || operation.sensitive === true
      ? RISK_TIERS.SENSITIVE_REVERSIBLE
      : RISK_TIERS.REVERSIBLE;
  return Math.max(semanticsFloor, mutationFloor);
}

function operationApprovalBinding(envelope, operation) {
  return {
    envelopeDigest: sha256(envelope),
    operationDigest: sha256({
      provider: operation.provider,
      targetAlias: operation.targetAlias,
      accountOrOrganisation: operation.accountOrOrganisation,
      resource: operation.resource,
      environment: operation.environment,
      operation: operation.operation,
      operationSemanticsVersion: operation.operationSemanticsVersion,
      operationSemanticsDigest: operation.operationSemanticsDigest,
      taskId: operation.taskId,
      sessionFingerprint: operation.sessionFingerprint,
      objectiveDigest: operation.objectiveDigest
    })
  };
}

function assertTaskLifetimeAuthority(envelope, operation) {
  if (envelope.lifetime.kind !== 'task') return;
  for (const field of ['taskId', 'sessionFingerprint', 'objectiveDigest']) {
    invariant(operation[field] === envelope.lifetime[field],
      `${field} does not match the exact task-lifetime authority.`, 'EXTERNAL_TASK_AUTHORITY_MISMATCH');
  }
  invariant(operation.objectiveDigest === objectiveAuthorityDigest(envelope.objective),
    'Operation objective digest does not match the bounded approved objective.', 'EXTERNAL_TASK_AUTHORITY_MISMATCH');
}

function assertOperationAuthorized(envelope, operation, options = {}) {
  validateAuthorizationEnvelope(envelope);
  requireObject(operation, 'Operation context');
  const comparisons = [
    ['provider', envelope.provider], ['targetAlias', envelope.targetAlias], ['accountOrOrganisation', envelope.accountOrOrganisation],
    ['resource', envelope.resource], ['environment', envelope.environment]
  ];
  for (const [field, expected] of comparisons) {
    invariant(operation[field] === expected, `${field} crosses the task authorisation envelope.`, 'EXTERNAL_REAUTHORISATION_REQUIRED');
  }
  assertTaskLifetimeAuthority(envelope, operation);
  const operationName = requireString(operation.operation, 'operation.operation', { pattern: ALIAS_PATTERN });
  const semantics = validateOperationSemantics(options.operationSemantics);
  invariant(envelope.operationSemanticsDigests[operationName] === semantics.semanticsDigest,
    'Authorisation envelope does not bind the selected operation semantics.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  invariant(!envelope.forbiddenOperations.includes(operationName), `${operationName} is forbidden by the task envelope.`, 'EXTERNAL_OPERATION_FORBIDDEN');
  invariant(envelope.allowedOperations.includes(operationName), `${operationName} is outside allowed operations.`, 'EXTERNAL_REAUTHORISATION_REQUIRED');
  const inferredTier = classifyRisk(operation, semantics);
  const envelopeTier = envelope.operationRiskTiers[operationName];
  const declaredTier = operation.riskTier === undefined ? envelopeTier : operation.riskTier;
  invariant(Number.isInteger(declaredTier) && declaredTier >= 0 && declaredTier <= 3, 'Operation riskTier must be 0-3.');
  const tier = Math.max(envelopeTier, inferredTier, declaredTier);
  if (options.establishedTier !== undefined) invariant(tier <= options.establishedTier, 'Operation crosses the established risk tier.', 'EXTERNAL_REAUTHORISATION_REQUIRED');
  const expectedClasses = new Set(envelope.sensitiveDataClasses || []);
  for (const dataClass of operation.sensitiveDataClasses || []) {
    invariant(expectedClasses.has(dataClass), `Sensitive data class ${dataClass} crosses the envelope.`, 'EXTERNAL_REAUTHORISATION_REQUIRED');
  }
  if (tier === RISK_TIERS.SENSITIVE_REVERSIBLE) {
    invariant(envelope.authorisedTier2Operations.includes(operationName), `${operationName} is not explicitly authorised as Tier 2.`, 'EXTERNAL_TIER2_APPROVAL_REQUIRED');
  }
  if (tier === RISK_TIERS.DESTRUCTIVE) {
    const approval = options.immediateApproval;
    invariant(approval?.ownerApproved === true, 'Tier 3 requires exact immediate owner approval.', 'EXTERNAL_TIER3_APPROVAL_REQUIRED');
    const binding = operationApprovalBinding(envelope, operation);
    for (const field of [
      'provider', 'targetAlias', 'accountOrOrganisation', 'resource', 'environment', 'operation',
      'operationSemanticsVersion', 'operationSemanticsDigest',
      'taskId', 'sessionFingerprint', 'objectiveDigest'
    ]) {
      invariant(approval[field] === operation[field], `Tier 3 approval ${field} does not match the exact operation.`, 'EXTERNAL_TIER3_APPROVAL_REQUIRED');
    }
    invariant(approval.envelopeDigest === binding.envelopeDigest, 'Tier 3 approval does not match the task authorisation envelope.', 'EXTERNAL_TIER3_APPROVAL_REQUIRED');
    invariant(approval.operationDigest === binding.operationDigest, 'Tier 3 approval does not match the exact operation digest.', 'EXTERNAL_TIER3_APPROVAL_REQUIRED');
    requireString(approval.authorisationReference, 'immediateApproval.authorisationReference', { max: 200 });
    assertNoSecretMaterial(approval, 'Tier 3 immediate approval');
  }
  if (envelope.lifetime.kind === 'time-bounded') {
    invariant(Date.parse(envelope.lifetime.expiresAt) > (options.now || Date.now()), 'Task authorisation envelope has expired.', 'EXTERNAL_REAUTHORISATION_REQUIRED');
  }
  return { authorised: true, riskTier: tier, reuseWithoutPerCallPrompt: tier < 3 };
}

function validateGraphicalDisclosure(disclosure) {
  requireObject(disclosure, 'Graphical-control disclosure');
  const allowed = new Set([
    'goal', 'capability', 'provider', 'targetAlias', 'operation', 'browserProfileOrApplication', 'origin',
    'accountOrOrganisation', 'project', 'environment', 'resource', 'structuredInterfacesInsufficientReason', 'mayRead', 'mayClick',
    'mayType', 'mayUpload', 'mayDownload', 'mayChange', 'mayEncounter', 'exposureRisks', 'forbiddenScope',
    'expectedResult', 'verification', 'rollbackOrSafeDisable'
  ]);
  assertAllowedKeys(disclosure, allowed, 'Graphical-control disclosure');
  requireString(disclosure.goal, 'goal', { max: 500 });
  const capability = requireString(disclosure.capability, 'capability', { max: 80 });
  invariant(GRAPHICAL_CAPABILITIES.has(capability), `${capability} is not a recognised graphical-control capability.`);
  requireString(disclosure.provider, 'provider', { pattern: PROVIDER_PATTERN });
  for (const field of ['targetAlias', 'operation']) requireString(disclosure[field], field, { pattern: ALIAS_PATTERN });
  requireString(disclosure.browserProfileOrApplication, 'browserProfileOrApplication', { max: 200 });
  const origin = requireString(disclosure.origin, 'origin', { max: 300 });
  invariant(isPublicHttpsOrigin(origin) || /^local-registry:\/\/[a-zA-Z0-9._/-]+$/.test(origin), 'origin must be one intentionally public HTTPS origin or a sanitized local-registry reference.', 'EXTERNAL_PRIVATE_ORIGIN_REJECTED');
  for (const field of ['accountOrOrganisation', 'project', 'environment', 'resource']) requireString(disclosure[field], field, { pattern: ALIAS_PATTERN });
  requireString(disclosure.structuredInterfacesInsufficientReason, 'structuredInterfacesInsufficientReason', { max: 500 });
  for (const field of ['mayRead', 'mayClick', 'mayType', 'mayUpload', 'mayDownload', 'mayChange', 'exposureRisks', 'forbiddenScope', 'verification', 'rollbackOrSafeDisable']) {
    requireStringArray(disclosure[field], field, { min: 1, max: 300 });
  }
  requireObject(disclosure.mayEncounter, 'mayEncounter');
  const encounterFields = new Set(['credentials', 'cookies', 'browserHistory', 'downloads', 'clipboard', 'customerOrPrivateData', 'unrelatedWindows']);
  assertAllowedKeys(disclosure.mayEncounter, encounterFields, 'mayEncounter');
  for (const field of encounterFields) invariant(typeof disclosure.mayEncounter[field] === 'boolean', `mayEncounter.${field} must explicitly be true or false.`);
  requireString(disclosure.expectedResult, 'expectedResult', { max: 500 });
  assertNoSecretMaterial(disclosure, 'Graphical-control disclosure');
  return disclosure;
}

function renderGraphicalApprovalQuestion(disclosure) {
  validateGraphicalDisclosure(disclosure);
  return `**Do you approve this one bounded ${disclosure.capability} operation for ${disclosure.goal}, limited to ${disclosure.origin} / ${disclosure.resource} in ${disclosure.environment}, with the reads, interactions, exposure risks, forbidden scope, verification, and rollback stated above?**`;
}

function bindGraphicalApproval(disclosure, approval) {
  validateGraphicalDisclosure(disclosure);
  requireObject(approval, 'Graphical-control approval');
  invariant(approval.ownerApproved === true, 'Graphical control requires explicit owner approval.', 'EXTERNAL_GRAPHICAL_APPROVAL_REQUIRED');
  invariant(approval.source === 'owner', 'A host, operating-system, browser, or permission popup is not informed owner approval.', 'EXTERNAL_GRAPHICAL_POPUP_NOT_APPROVAL');
  requireString(approval.authorisationReference, 'approval.authorisationReference', { max: 200 });
  const disclosureDigest = sha256(disclosure);
  invariant(approval.disclosureDigest === disclosureDigest, 'Graphical approval does not match the declared envelope.', 'EXTERNAL_GRAPHICAL_APPROVAL_MISMATCH');
  return {
    ownerApproved: true,
    authorisationReference: approval.authorisationReference,
    disclosureDigest,
    provider: disclosure.provider,
    targetAlias: disclosure.targetAlias,
    accountOrOrganisation: disclosure.accountOrOrganisation,
    environment: disclosure.environment,
    resource: disclosure.resource,
    operation: disclosure.operation,
    oneDeclaredEnvelopeOnly: true
  };
}

function validateHistoryDiscovery(request) {
  requireObject(request, 'Browser-history discovery request');
  const allowed = new Set([
    'reason', 'browser', 'profile', 'domains', 'startTime', 'endTime', 'unrelatedExposure',
    'stopCondition', 'saferPaths', 'ownerApproval', 'targetFound'
  ]);
  assertAllowedKeys(request, allowed, 'Browser-history discovery request');
  requireString(request.reason, 'reason', { max: 500 });
  requireString(request.browser, 'browser', { max: 100 });
  requireString(request.profile, 'profile', { pattern: ALIAS_PATTERN });
  const domains = requireStringArray(request.domains, 'domains', { min: 1, unique: true, max: 253 });
  invariant(domains.length <= 10, 'History request may include at most 10 exact domains.');
  for (const domain of domains) {
    invariant(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain), `History domain ${domain} is not bounded to a valid domain.`);
    invariant(isPublicHttpsOrigin(`https://${domain}/`), `History domain ${domain} is not intentionally public.`, 'EXTERNAL_PRIVATE_ORIGIN_REJECTED');
  }
  const startTime = Date.parse(requireString(request.startTime, 'startTime'));
  const endTime = Date.parse(requireString(request.endTime, 'endTime'));
  invariant(Number.isFinite(startTime) && Number.isFinite(endTime) && startTime < endTime, 'History request requires a bounded valid time range.');
  invariant(endTime - startTime <= 31 * 24 * 60 * 60 * 1000, 'History request may span at most 31 days.');
  requireStringArray(request.unrelatedExposure, 'unrelatedExposure', { min: 1 });
  requireString(request.stopCondition, 'stopCondition', { max: 300 });
  requireObject(request.saferPaths, 'saferPaths');
  assertAllowedKeys(request.saferPaths, new Set(HISTORY_SAFER_PATHS), 'saferPaths');
  for (const saferPath of HISTORY_SAFER_PATHS) {
    requireObject(request.saferPaths[saferPath], `saferPaths.${saferPath}`);
    assertAllowedKeys(request.saferPaths[saferPath], new Set(['attempted', 'failedReason']), `saferPaths.${saferPath}`);
    invariant(request.saferPaths[saferPath].attempted === true, `Safer discovery path ${saferPath} must be attempted first.`, 'EXTERNAL_HISTORY_NOT_LAST_RESORT');
    requireString(request.saferPaths[saferPath].failedReason, `saferPaths.${saferPath}.failedReason`, { max: 300 });
  }
  requireObject(request.ownerApproval, 'ownerApproval');
  invariant(request.ownerApproval.ownerApproved === true && request.ownerApproval.source === 'owner', 'History access requires explicit informed owner approval.', 'EXTERNAL_HISTORY_APPROVAL_REQUIRED');
  requireString(request.ownerApproval.authorisationReference, 'ownerApproval.authorisationReference', { max: 200 });
  invariant(request.ownerApproval.requestDigest === sha256({ ...request, ownerApproval: undefined, targetFound: undefined }), 'History approval does not match the bounded request.', 'EXTERNAL_HISTORY_APPROVAL_MISMATCH');
  assertNoSecretMaterial(request, 'Browser-history discovery request');
  return {
    authorised: request.targetFound !== true,
    stopImmediately: request.targetFound === true,
    boundedDomains: domains,
    boundedStartTime: new Date(startTime).toISOString(),
    boundedEndTime: new Date(endTime).toISOString()
  };
}

function targetBindingDigest(value) {
  return sha256({
    provider: value.provider,
    targetAlias: value.targetAlias,
    accountOrOrganisation: value.accountOrOrganisation,
    environment: value.environment,
    targetFingerprint: value.targetFingerprint
  });
}

function validateCapabilityAudit(audit) {
  requireObject(audit, 'Capability audit');
  const allowed = new Set([
    'schemaVersion', 'provider', 'targetAlias', 'accountOrOrganisation', 'environment', 'operation', 'interfaceId', 'interfaceKind',
    'identity', 'version', 'availableOperations', 'targetFingerprint', 'targetBinding', 'inputSchemaDigest', 'authScopeStatus',
    'redaction', 'retryIdempotency', 'preconditions', 'postconditions', 'rollback', 'failureSemantics',
    'operationSemanticsVersion', 'operationSemanticsDigest',
    'capabilityDigest', 'assuranceScore', 'readOnly', 'auditedAt', 'evidenceReferences'
  ]);
  assertAllowedKeys(audit, allowed, 'Capability audit');
  invariant(audit.schemaVersion === AUDIT_SCHEMA_VERSION, 'Unsupported capability-audit schema.');
  requireString(audit.provider, 'provider', { pattern: PROVIDER_PATTERN });
  for (const field of ['targetAlias', 'accountOrOrganisation', 'environment', 'operation', 'interfaceId']) requireString(audit[field], field, { pattern: ALIAS_PATTERN });
  invariant(INTERFACE_KINDS.has(audit.interfaceKind), 'Unsupported interfaceKind.');
  requireString(audit.identity, 'identity', { max: 200 });
  requireString(audit.version, 'version', { max: 100 });
  const operations = requireStringArray(audit.availableOperations, 'availableOperations', { min: 1, unique: true, pattern: ALIAS_PATTERN });
  invariant(operations.includes(audit.operation), 'Capability audit does not prove the exact operation.');
  requireString(audit.targetFingerprint, 'targetFingerprint', { pattern: DIGEST_PATTERN });
  requireString(audit.targetBinding, 'targetBinding', { pattern: DIGEST_PATTERN });
  invariant(audit.targetBinding === targetBindingDigest(audit), 'Capability audit target binding does not match the exact provider target fingerprint.', 'EXTERNAL_AUDIT_TARGET_MISMATCH');
  requireString(audit.inputSchemaDigest, 'inputSchemaDigest', { pattern: DIGEST_PATTERN });
  invariant(audit.operationSemanticsVersion === OPERATION_SEMANTICS_SCHEMA_VERSION,
    'Capability audit operation-semantics version is invalid.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  requireString(audit.operationSemanticsDigest, 'operationSemanticsDigest', { pattern: DIGEST_PATTERN });
  requireString(audit.authScopeStatus, 'authScopeStatus', { max: 300 });
  requireStringArray(audit.redaction, 'redaction', { min: 1 });
  requireString(audit.retryIdempotency, 'retryIdempotency', { max: 300 });
  for (const field of ['preconditions', 'postconditions', 'rollback', 'failureSemantics', 'evidenceReferences']) requireStringArray(audit[field], field, { min: 1 });
  requireString(audit.capabilityDigest, 'capabilityDigest', { pattern: DIGEST_PATTERN });
  invariant(audit.capabilityDigest === capabilityAuditDigest(audit),
    'Capability audit digest does not authenticate the complete audit.', 'EXTERNAL_AUDIT_AUTHORITY_MISMATCH');
  invariant(Number.isInteger(audit.assuranceScore) && audit.assuranceScore >= 0 && audit.assuranceScore <= 100, 'assuranceScore must be an integer from 0 to 100.');
  invariant(typeof audit.readOnly === 'boolean', 'readOnly must be boolean.');
  invariant(Number.isFinite(Date.parse(requireString(audit.auditedAt, 'auditedAt'))), 'auditedAt must be an ISO date-time.');
  assertNoSecretMaterial(audit, 'Capability audit', { allowedSensitiveKeys: new Set(['authScopeStatus']) });
  return audit;
}

function graphicalApprovalMatchesOperation(approval, operationContext, disclosure) {
  try {
    validateGraphicalDisclosure(disclosure);
    requireObject(approval, 'Graphical-control approval binding');
    assertAllowedKeys(approval, new Set([
      'ownerApproved', 'authorisationReference', 'disclosureDigest', 'provider', 'targetAlias',
      'accountOrOrganisation', 'environment', 'resource', 'operation', 'oneDeclaredEnvelopeOnly'
    ]), 'Graphical-control approval binding');
    invariant(approval.ownerApproved === true && approval.oneDeclaredEnvelopeOnly === true, 'Graphical approval is not bound to one declared envelope.');
    requireString(approval.authorisationReference, 'graphicalApproval.authorisationReference', { max: 200 });
    requireString(approval.disclosureDigest, 'graphicalApproval.disclosureDigest', { pattern: DIGEST_PATTERN });
    invariant(approval.disclosureDigest === sha256(disclosure), 'Graphical approval does not match the supplied disclosure.', 'EXTERNAL_GRAPHICAL_APPROVAL_MISMATCH');
    for (const field of ['provider', 'targetAlias', 'accountOrOrganisation', 'environment', 'resource', 'operation']) {
      invariant(approval[field] === operationContext[field], `Graphical approval ${field} does not match the selected operation.`, 'EXTERNAL_GRAPHICAL_APPROVAL_MISMATCH');
      invariant(disclosure[field] === operationContext[field], `Graphical disclosure ${field} does not match the selected operation.`, 'EXTERNAL_GRAPHICAL_APPROVAL_MISMATCH');
    }
    assertNoSecretMaterial(approval, 'Graphical-control approval binding');
    return true;
  } catch {
    return false;
  }
}

function interfaceRestrictions(envelope) {
  const forbidden = new Set();
  const required = new Set();
  for (const restriction of envelope.interfaceRestrictions || []) {
    if (restriction.startsWith('require:')) required.add(restriction.slice('require:'.length));
    else if (restriction.startsWith('forbid:')) forbidden.add(restriction.slice('forbid:'.length));
    else if (restriction.startsWith('forbid-')) forbidden.add(restriction.slice('forbid-'.length));
    else forbidden.add(restriction.slice('no-'.length));
  }
  return { forbidden, required };
}

function trustedRuntimeHome() {
  let user;
  let realHome;
  try {
    user = os.userInfo();
    realHome = user && typeof user.homedir === 'string'
      ? fs.realpathSync.native(user.homedir)
      : null;
  } catch {
    invariant(false, 'Trusted runtime home is unavailable.', 'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  }
  invariant(user && typeof user.homedir === 'string' && path.isAbsolute(user.homedir),
    'Trusted runtime home is unavailable.', 'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  return realHome;
}

function canonicalInventoryPath() {
  return path.join(trustedRuntimeHome(), '.ai-agent-toolkit', 'external-system', 'provider-target-registry.json');
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function readBoundedRegularFile(filePath, maxBytes = MAX_INVENTORY_BYTES) {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  const parentStat = fs.lstatSync(parent);
  invariant(parentStat.isDirectory() && !parentStat.isSymbolicLink(),
    'Inventory parent must be a real directory.', 'EXTERNAL_INVENTORY_TOPOLOGY_MISMATCH');
  const realParent = fs.realpathSync.native(parent);
  invariant(samePath(realParent, parent),
    'Inventory parent topology contains a link, junction, or redirect.', 'EXTERNAL_INVENTORY_TOPOLOGY_MISMATCH');
  const before = fs.lstatSync(resolved);
  invariant(before.isFile() && !before.isSymbolicLink(),
    'Inventory source must be one existing regular non-link file.', 'EXTERNAL_INVENTORY_TOPOLOGY_MISMATCH');
  invariant(before.size > 0 && before.size <= maxBytes,
    'Inventory source exceeds the bounded size.', 'EXTERNAL_INVENTORY_BOUNDS_EXCEEDED');
  const realPath = fs.realpathSync.native(resolved);
  invariant(samePath(realPath, resolved),
    'Inventory source resolves through a link or redirect.', 'EXTERNAL_INVENTORY_TOPOLOGY_MISMATCH');
  const descriptor = fs.openSync(resolved, 'r');
  try {
    const opened = fs.fstatSync(descriptor);
    invariant(opened.isFile()
      && opened.dev === before.dev
      && opened.ino === before.ino
      && opened.size === before.size,
    'Inventory source changed while opening.', 'EXTERNAL_INVENTORY_SOURCE_CHANGED');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    invariant(after.dev === opened.dev
      && after.ino === opened.ino
      && after.size === opened.size
      && after.mtimeMs === opened.mtimeMs,
    'Inventory source changed while reading.', 'EXTERNAL_INVENTORY_SOURCE_CHANGED');
    return {
      path: resolved,
      realPath,
      realParent,
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      birthtimeMs: after.birthtimeMs,
      mtimeMs: after.mtimeMs,
      bytes,
      bytesDigest: sha256(bytes)
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readTrustedRegularFile(filePath, failureCode) {
  try {
    return readBoundedRegularFile(filePath);
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('EXTERNAL_')) throw error;
    invariant(false, 'Trusted bounded file is unavailable.', failureCode);
  }
}

function runtimeInventoryIdentity(sourcePath) {
  const routerSource = readTrustedRegularFile(__filename, 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
  const repositoryRealPath = fs.realpathSync.native(process.cwd());
  const installationRealPath = fs.realpathSync.native(path.dirname(__filename));
  return {
    routerVersion: ROUTER_VERSION,
    routerSourceDigest: routerSource.bytesDigest,
    repositoryIdentity: sha256({ repositoryRealPath }),
    hostIdentity: sha256({ platform: process.platform, hostname: os.hostname() }),
    installationIdentity: sha256({ installationRealPath }),
    authorityPathDigest: sha256({ authorityRealPath: fs.realpathSync.native(sourcePath) })
  };
}

function revalidateInventoryAuthority(authority) {
  const state = INVENTORY_AUTHORITIES.get(authority);
  invariant(state, 'Inventory authority was not produced by the trusted bounded loader.',
    'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  const current = readTrustedRegularFile(state.source.path, 'EXTERNAL_INVENTORY_SOURCE_CHANGED');
  for (const field of ['realPath', 'realParent', 'dev', 'ino', 'size', 'birthtimeMs', 'mtimeMs', 'bytesDigest']) {
    invariant(current[field] === state.source[field],
      `Inventory source ${field} changed after authorisation.`, 'EXTERNAL_INVENTORY_SOURCE_CHANGED');
  }
  const identity = runtimeInventoryIdentity(current.path);
  for (const field of [
    'routerVersion', 'routerSourceDigest', 'repositoryIdentity', 'hostIdentity',
    'installationIdentity', 'authorityPathDigest'
  ]) {
    invariant(identity[field] === state.registry[field],
      `Inventory ${field} no longer matches the current runtime.`, 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
  }
  return state;
}

function loadTrustedInventorySnapshot() {
  invariant(arguments.length === 0,
    'Production inventory authority accepts no caller-selected source or test options.',
    'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  const sourcePath = canonicalInventoryPath();
  const source = readTrustedRegularFile(sourcePath, 'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  let registry;
  try {
    registry = JSON.parse(source.bytes.toString('utf8'));
  } catch {
    invariant(false, 'Inventory source is not one valid JSON object.', 'EXTERNAL_INVENTORY_FORMAT_INVALID');
  }
  validateProviderTargetRegistry(registry);
  invariant(registry.targets.length <= MAX_INVENTORY_TARGETS,
    'Inventory target count exceeds the bounded limit.', 'EXTERNAL_INVENTORY_BOUNDS_EXCEEDED');
  const identity = runtimeInventoryIdentity(source.path);
  for (const field of [
    'routerVersion', 'routerSourceDigest', 'repositoryIdentity', 'hostIdentity',
    'installationIdentity', 'authorityPathDigest'
  ]) {
    invariant(registry[field] === identity[field],
      `Inventory ${field} does not match the current runtime.`, 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
  }
  const generationKey = `${source.realPath}\u0000${registry.repositoryIdentity}\u0000${registry.hostIdentity}\u0000${registry.installationIdentity}`;
  const previous = LOADED_INVENTORY_GENERATIONS.get(generationKey);
  if (previous) {
    invariant(registry.generationSequence >= previous.sequence,
      'Inventory generation rolled back.', 'EXTERNAL_INVENTORY_GENERATION_ROLLBACK');
    invariant(registry.generationSequence !== previous.sequence || source.bytesDigest === previous.bytesDigest,
      'Inventory bytes changed without a generation increment.', 'EXTERNAL_INVENTORY_GENERATION_ROLLBACK');
  }
  LOADED_INVENTORY_GENERATIONS.set(generationKey, {
    sequence: registry.generationSequence,
    bytesDigest: source.bytesDigest
  });
  const authority = Object.freeze({
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    authorityId: sha256({
      sourceDigest: source.bytesDigest,
      generationSequence: registry.generationSequence,
      inventoryGeneration: registry.inventoryGeneration,
      routerSourceDigest: registry.routerSourceDigest,
      installationIdentity: registry.installationIdentity
    }),
    sourceDigest: source.bytesDigest,
    inventoryGeneration: registry.inventoryGeneration,
    generationSequence: registry.generationSequence,
    loadedAt: new Date().toISOString()
  });
  INVENTORY_AUTHORITIES.set(authority, { source, registry, identity });
  return authority;
}

function targetInventoryDigest(target) {
  return sha256({
    provider: target.provider,
    targetAlias: target.targetAlias,
    accountOrOrganisation: target.accountOrOrganisation,
    environment: target.environment,
    sanitizedFingerprint: target.sanitizedFingerprint,
    inventoryGeneration: target.inventoryGeneration,
    resourceReferences: [...(target.resourceReferences || [])].sort(),
    installedInterfaces: [...(target.installedInterfaces || [])].sort(),
    capabilityDigests: [...(target.capabilityDigests || [])].sort(),
    operationSemantics: target.operationSemantics || [],
    routeSelections: target.routeSelections || {},
    lastAuditState: target.lastAuditState
  });
}

function currentInventoryAudits(target, capabilityAudits) {
  validateProviderTargetRecord(target, 'target');
  invariant(target.lastAuditState === 'current', 'Target inventory audit state is not current.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(Array.isArray(capabilityAudits), 'capabilityAudits must be an array.');
  return capabilityAudits.map(validateCapabilityAudit).filter((audit) =>
    audit.provider === target.provider
    && audit.targetAlias === target.targetAlias
    && audit.accountOrOrganisation === target.accountOrOrganisation
    && audit.environment === target.environment
    && audit.targetFingerprint === target.sanitizedFingerprint
    && target.installedInterfaces.includes(audit.interfaceId)
    && target.capabilityDigests.includes(audit.capabilityDigest)
    && target.operationSemantics.some((semantics) =>
      semantics.operation === audit.operation
      && semantics.schemaVersion === audit.operationSemanticsVersion
      && semantics.semanticsDigest === audit.operationSemanticsDigest)
    && audit.targetBinding === targetBindingDigest({
      provider: target.provider,
      targetAlias: target.targetAlias,
      accountOrOrganisation: target.accountOrOrganisation,
      environment: target.environment,
      targetFingerprint: target.sanitizedFingerprint
    })
  );
}

function hostAdapterPlanDigest(plan) {
  return sha256({
    schemaVersion: plan.schemaVersion,
    snapshotAuthorityId: plan.snapshotAuthorityId,
    sourceDigest: plan.sourceDigest,
    routerVersion: plan.routerVersion,
    routerSourceDigest: plan.routerSourceDigest,
    installationIdentity: plan.installationIdentity,
    repositoryIdentity: plan.repositoryIdentity,
    hostIdentity: plan.hostIdentity,
    generationSequence: plan.generationSequence,
    derivedAt: plan.derivedAt,
    logicalTarget: plan.logicalTarget,
    inventoryGeneration: plan.inventoryGeneration,
    inventoryDigest: plan.inventoryDigest,
    currentAuditState: plan.currentAuditState,
    host: plan.host,
    hostConfigurationScope: plan.hostConfigurationScope,
    credentialReferences: plan.credentialReferences,
    installedInterfaces: plan.installedInterfaces,
    supportedOperations: plan.supportedOperations,
    capabilityAuditPassed: plan.capabilityAuditPassed,
    preserveOtherHostConfiguration: plan.preserveOtherHostConfiguration,
    mutateProjectOwnedConfiguration: plan.mutateProjectOwnedConfiguration,
    copySecretsIntoRepository: plan.copySecretsIntoRepository,
    requiresProviderRediscoveryOnHostSwitch: plan.requiresProviderRediscoveryOnHostSwitch
  });
}

function validateHostAdapterPlan(plan) {
  requireObject(plan, 'Host adapter plan');
  assertAllowedKeys(plan, new Set([
    'schemaVersion', 'logicalTarget', 'inventoryGeneration', 'inventoryDigest', 'currentAuditState',
    'snapshotAuthorityId', 'sourceDigest', 'routerVersion', 'routerSourceDigest', 'installationIdentity',
    'repositoryIdentity', 'hostIdentity', 'generationSequence', 'derivedAt',
    'host', 'hostConfigurationScope', 'credentialReferences', 'installedInterfaces', 'supportedOperations',
    'capabilityAuditPassed', 'preserveOtherHostConfiguration', 'mutateProjectOwnedConfiguration',
    'copySecretsIntoRepository', 'requiresProviderRediscoveryOnHostSwitch', 'planDigest'
  ]), 'Host adapter plan');
  invariant(plan.schemaVersion === HOST_ADAPTER_PLAN_SCHEMA_VERSION, 'Unsupported host-adapter-plan schema.');
  for (const field of [
    'snapshotAuthorityId', 'sourceDigest', 'routerSourceDigest', 'installationIdentity',
    'repositoryIdentity', 'hostIdentity'
  ]) requireString(plan[field], field, { pattern: DIGEST_PATTERN });
  invariant(plan.routerVersion === ROUTER_VERSION, 'Host plan router version is stale.', 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
  invariant(Number.isSafeInteger(plan.generationSequence) && plan.generationSequence >= 0,
    'Host plan generationSequence is invalid.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(Number.isFinite(Date.parse(requireString(plan.derivedAt, 'derivedAt'))),
    'Host plan derivedAt must be an ISO date-time.');
  requireObject(plan.logicalTarget, 'logicalTarget');
  assertAllowedKeys(plan.logicalTarget, new Set([
    'provider', 'targetAlias', 'accountOrOrganisation', 'environment', 'sanitizedFingerprint', 'resourceReferences'
  ]), 'logicalTarget');
  requireString(plan.logicalTarget.provider, 'logicalTarget.provider', { pattern: PROVIDER_PATTERN });
  for (const field of ['targetAlias', 'accountOrOrganisation', 'environment']) {
    requireString(plan.logicalTarget[field], `logicalTarget.${field}`, { pattern: ALIAS_PATTERN });
  }
  requireString(plan.logicalTarget.sanitizedFingerprint, 'logicalTarget.sanitizedFingerprint', { pattern: DIGEST_PATTERN });
  requireStringArray(plan.logicalTarget.resourceReferences, 'logicalTarget.resourceReferences', { unique: true, pattern: ALIAS_PATTERN });
  requireString(plan.inventoryGeneration, 'inventoryGeneration', { pattern: DIGEST_PATTERN });
  requireString(plan.inventoryDigest, 'inventoryDigest', { pattern: DIGEST_PATTERN });
  invariant(plan.currentAuditState === 'current', 'Host adapter plan audit state is not current.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(['codex', 'claude-code'].includes(plan.host), 'host must be codex or claude-code.');
  requireString(plan.hostConfigurationScope, 'hostConfigurationScope', { max: 200 });
  requireStringArray(plan.credentialReferences, 'credentialReferences', {
    min: 1, unique: true, pattern: CREDENTIAL_REFERENCE_PATTERN
  });
  requireStringArray(plan.installedInterfaces, 'installedInterfaces', { unique: true, pattern: ALIAS_PATTERN });
  invariant(Array.isArray(plan.supportedOperations), 'supportedOperations must be an array.');
  const supportedKeys = new Set();
  for (const [index, supported] of plan.supportedOperations.entries()) {
    requireObject(supported, `supportedOperations[${index}]`);
    assertAllowedKeys(supported, new Set([
      'operation', 'interfaceId', 'interfaceKind', 'readOnly', 'capabilityDigest', 'targetFingerprint',
      'operationSemanticsVersion', 'operationSemanticsDigest', 'mutationClass', 'receiptClass'
    ]), `supportedOperations[${index}]`);
    for (const field of ['operation', 'interfaceId']) requireString(supported[field], `supportedOperations[${index}].${field}`, { pattern: ALIAS_PATTERN });
    invariant(INTERFACE_KINDS.has(supported.interfaceKind), `supportedOperations[${index}].interfaceKind is invalid.`);
    invariant(typeof supported.readOnly === 'boolean', `supportedOperations[${index}].readOnly must be boolean.`);
    invariant(['read-only', 'mutation'].includes(supported.mutationClass),
      `supportedOperations[${index}].mutationClass is invalid.`);
    invariant(supported.readOnly === (supported.mutationClass === 'read-only'),
      'Host plan operation mutability is inconsistent.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
    invariant(supported.operationSemanticsVersion === OPERATION_SEMANTICS_SCHEMA_VERSION,
      'Host plan operation-semantics version is stale.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
    requireString(supported.operationSemanticsDigest, 'supported.operationSemanticsDigest', { pattern: DIGEST_PATTERN });
    invariant(['inspection', 'mutation', 'destructive'].includes(supported.receiptClass),
      'Host plan receiptClass is invalid.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
    requireString(supported.capabilityDigest, `supportedOperations[${index}].capabilityDigest`, { pattern: DIGEST_PATTERN });
    requireString(supported.targetFingerprint, `supportedOperations[${index}].targetFingerprint`, { pattern: DIGEST_PATTERN });
    invariant(plan.installedInterfaces.includes(supported.interfaceId), 'Host adapter plan contains an uninstalled interface.', 'EXTERNAL_STALE_TARGET_INVENTORY');
    invariant(supported.targetFingerprint === plan.logicalTarget.sanitizedFingerprint,
      'Host adapter plan operation belongs to a different target fingerprint.', 'EXTERNAL_STALE_TARGET_INVENTORY');
    const key = `${supported.operation}\u0000${supported.interfaceId}\u0000${supported.capabilityDigest}`;
    invariant(!supportedKeys.has(key), 'Host adapter plan contains duplicate operation inventory.', 'EXTERNAL_STALE_TARGET_INVENTORY');
    supportedKeys.add(key);
  }
  invariant(plan.capabilityAuditPassed === (plan.supportedOperations.length > 0),
    'Host adapter plan capability audit state does not match its supported operations.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(plan.preserveOtherHostConfiguration === true
    && plan.mutateProjectOwnedConfiguration === false
    && plan.copySecretsIntoRepository === false
    && plan.requiresProviderRediscoveryOnHostSwitch === false,
  'Host adapter plan violates the bounded host-configuration contract.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  requireString(plan.planDigest, 'planDigest', { pattern: DIGEST_PATTERN });
  invariant(plan.planDigest === hostAdapterPlanDigest(plan), 'Host adapter plan digest is invalid.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  return plan;
}

function resolveCurrentInventory(operationContext, audits, options) {
  requireString(operationContext.inventoryGeneration, 'operationContext.inventoryGeneration', { pattern: DIGEST_PATTERN });
  requireString(operationContext.inventoryDigest, 'operationContext.inventoryDigest', { pattern: DIGEST_PATTERN });
  invariant(options.targetRegistryRecord === undefined,
    'Raw target registry records are not inventory authority.', 'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  const authorityState = INVENTORY_AUTHORITIES.get(options.inventoryAuthority);
  const planState = HOST_PLAN_AUTHORITIES.get(options.hostAdapterPlan);
  invariant(Boolean(authorityState) !== Boolean(planState),
    'Final route selection requires exactly one loader-produced inventory authority or authenticated host plan.',
    'EXTERNAL_CURRENT_INVENTORY_REQUIRED');
  const authority = authorityState ? options.inventoryAuthority : planState.authority;
  const state = revalidateInventoryAuthority(authority);
  const target = state.registry.targets.find((entry) =>
    entry.provider === operationContext.provider
    && entry.targetAlias === operationContext.targetAlias
    && entry.accountOrOrganisation === operationContext.accountOrOrganisation
    && entry.environment === operationContext.environment);
  invariant(target, 'Authenticated inventory does not contain the exact target.',
    'EXTERNAL_STALE_TARGET_INVENTORY');
  const semantics = target.operationSemantics.find((entry) => entry.operation === operationContext.operation);
  invariant(semantics, 'Authenticated inventory does not define the requested operation.',
    'EXTERNAL_UNKNOWN_OPERATION');
  validateOperationSemantics(semantics);
  const validatedAudits = audits.map(validateCapabilityAudit);
  for (const audit of validatedAudits.filter((entry) =>
    entry.provider === operationContext.provider
    && entry.targetAlias === operationContext.targetAlias
    && entry.accountOrOrganisation === operationContext.accountOrOrganisation
    && entry.environment === operationContext.environment
    && entry.operation === operationContext.operation)) {
    invariant(audit.operationSemanticsVersion === semantics.schemaVersion
      && audit.operationSemanticsDigest === semantics.semanticsDigest
      && audit.readOnly === (semantics.mutationClass === 'read-only'),
    'Capability audit disagrees with canonical operation semantics.',
    'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  }
  let currentAudits = currentInventoryAudits(target, validatedAudits);
  let planDigest = null;
  if (planState) {
    const plan = validateHostAdapterPlan(options.hostAdapterPlan);
    invariant(Date.now() - Date.parse(plan.derivedAt) <= 5 * 60 * 1000
      && Date.parse(plan.derivedAt) <= Date.now() + 30 * 1000,
    'Host plan is outside the bounded freshness window.', 'EXTERNAL_STALE_TARGET_INVENTORY');
    invariant(planState.authority === authority
      && planState.targetKey === `${target.provider}\u0000${target.targetAlias}\u0000${target.accountOrOrganisation}\u0000${target.environment}`,
    'Host plan was derived from another authenticated snapshot or target.',
    'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
    invariant(plan.snapshotAuthorityId === authority.authorityId
      && plan.sourceDigest === authority.sourceDigest
      && plan.generationSequence === state.registry.generationSequence,
    'Host plan inventory authority is stale.', 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
    for (const field of [
      'routerVersion', 'routerSourceDigest', 'installationIdentity', 'repositoryIdentity', 'hostIdentity'
    ]) {
      invariant(plan[field] === state.registry[field],
        `Host plan ${field} belongs to another runtime authority.`,
        'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
    }
    planDigest = plan.planDigest;
    const supported = new Set(plan.supportedOperations.map((entry) =>
      `${entry.operation}\u0000${entry.interfaceId}\u0000${entry.capabilityDigest}\u0000${entry.targetFingerprint}\u0000${entry.operationSemanticsDigest}\u0000${entry.mutationClass}`));
    currentAudits = currentAudits.filter((audit) =>
      supported.has(`${audit.operation}\u0000${audit.interfaceId}\u0000${audit.capabilityDigest}\u0000${audit.targetFingerprint}\u0000${audit.operationSemanticsDigest}\u0000${audit.readOnly ? 'read-only' : 'mutation'}`));
  }
  for (const field of ['provider', 'targetAlias', 'accountOrOrganisation', 'environment']) {
    invariant(target[field] === operationContext[field], `Current inventory ${field} does not match the operation.`, 'EXTERNAL_STALE_TARGET_INVENTORY');
  }
  invariant(target.sanitizedFingerprint === operationContext.targetFingerprint,
    'Current inventory target fingerprint does not match the operation.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(target.resourceReferences.includes(operationContext.resource),
    'Current inventory does not contain the exact operation resource.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  const inventoryGeneration = target.inventoryGeneration;
  const inventoryDigest = targetInventoryDigest(target);
  invariant(state.registry.inventoryGeneration === inventoryGeneration,
    'Target inventory generation differs from the authenticated snapshot.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(inventoryGeneration === operationContext.inventoryGeneration,
    'Current inventory generation does not match the operation.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  invariant(inventoryDigest === operationContext.inventoryDigest,
    'Current inventory digest does not match the operation.', 'EXTERNAL_STALE_TARGET_INVENTORY');
  return {
    authority,
    target,
    semantics,
    currentAudits,
    inventoryGeneration,
    inventoryDigest,
    planDigest,
    sourceDigest: state.source.bytesDigest,
    snapshotAuthorityId: authority.authorityId
  };
}

function selectStrongestAdmissibleInterface(operationContext, audits, options = {}) {
  requireObject(operationContext, 'Operation context');
  const operation = requireString(operationContext.operation, 'operation', { pattern: ALIAS_PATTERN });
  requireString(operationContext.targetFingerprint, 'operationContext.targetFingerprint', { pattern: DIGEST_PATTERN });
  const envelope = validateAuthorizationEnvelope(options.authorizationEnvelope);
  invariant(Array.isArray(audits) && audits.length > 0, 'At least one capability audit is required.');
  const inventory = resolveCurrentInventory(operationContext, audits, options);
  const authorisation = assertOperationAuthorized(envelope, operationContext, {
    operationSemantics: inventory.semantics,
    establishedTier: options.establishedTier,
    immediateApproval: options.immediateApproval,
    now: options.now
  });
  for (const field of ['provider', 'targetAlias', 'accountOrOrganisation', 'environment', 'resource']) {
    invariant(envelope[field] === operationContext[field], `Authorisation envelope ${field} does not match the selected operation.`, 'EXTERNAL_REAUTHORISATION_REQUIRED');
  }
  invariant(envelope.allowedOperations.includes(operation) && !envelope.forbiddenOperations.includes(operation),
    'Authorisation envelope does not allow the selected operation.', 'EXTERNAL_REAUTHORISATION_REQUIRED');
  const restrictions = interfaceRestrictions(envelope);
  const audited = inventory.currentAudits.filter((audit) =>
    audit.provider === operationContext.provider
    && audit.targetAlias === operationContext.targetAlias
    && audit.accountOrOrganisation === operationContext.accountOrOrganisation
    && audit.environment === operationContext.environment
    && audit.targetFingerprint === operationContext.targetFingerprint
    && audit.targetBinding === targetBindingDigest(operationContext)
    && audit.operation === operation
  );
  invariant(audited.length > 0, 'No interface audit matches the exact target and operation.', 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  const mutation = inventory.semantics.mutationClass === 'mutation';
  const admissible = audited.filter((audit) => {
    invariant(audit.readOnly === !mutation,
      'Capability audit mutability disagrees with canonical operation semantics.',
      'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
    if (restrictions.forbidden.has(audit.interfaceKind) || restrictions.forbidden.has(audit.interfaceId)) return false;
    if (restrictions.required.size > 0
      && !restrictions.required.has(audit.interfaceKind)
      && !restrictions.required.has(audit.interfaceId)) return false;
    if (audit.interfaceKind === 'browser' || audit.interfaceKind === 'computer-use') {
      return graphicalApprovalMatchesOperation(options.graphicalApproval, operationContext, options.graphicalDisclosure)
        && options.graphicalDisclosure.accountOrOrganisation === envelope.accountOrOrganisation
        && options.graphicalApproval.authorisationReference === envelope.ownerApprovalReference;
    }
    return true;
  });
  invariant(admissible.length > 0, 'No audited interface is admissible for the exact operation.', 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  const structured = admissible.filter((audit) => STRUCTURED_INTERFACE_KINDS.has(audit.interfaceKind));
  const pool = structured.length > 0 ? structured : admissible;
  pool.sort((left, right) => right.assuranceScore - left.assuranceScore || left.interfaceId.localeCompare(right.interfaceId));
  const selected = pool[0];
  const finalAuthorisation = assertOperationAuthorized(envelope, {
    ...operationContext,
    readOnly: selected.readOnly
  }, {
    operationSemantics: inventory.semantics,
    establishedTier: options.establishedTier,
    immediateApproval: options.immediateApproval,
    now: options.now
  });
  invariant(finalAuthorisation.riskTier === authorisation.riskTier,
    'Selected audit changed the required operation risk.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  revalidateInventoryAuthority(inventory.authority);
  const route = {
    operation,
    operationSemanticsVersion: inventory.semantics.schemaVersion,
    operationSemanticsDigest: inventory.semantics.semanticsDigest,
    mutationClass: inventory.semantics.mutationClass,
    receiptClass: inventory.semantics.receiptClass,
    finalRiskTier: finalAuthorisation.riskTier,
    selectedAuditReadOnly: selected.readOnly,
    selectedInterface: selected.interfaceId,
    interfaceKind: selected.interfaceKind,
    capabilityDigest: selected.capabilityDigest,
    snapshotAuthorityId: inventory.snapshotAuthorityId,
    inventorySourceDigest: inventory.sourceDigest,
    inventoryGeneration: inventory.inventoryGeneration,
    inventoryDigest: inventory.inventoryDigest,
    hostAdapterPlanDigest: inventory.planDigest,
    selectedRouteDigest: sha256({
      authorisationEnvelopeDigest: sha256(envelope),
      provider: operationContext.provider,
      targetAlias: operationContext.targetAlias,
      accountOrOrganisation: operationContext.accountOrOrganisation,
      resource: operationContext.resource,
      environment: operationContext.environment,
      operation,
      operationSemanticsVersion: inventory.semantics.schemaVersion,
      operationSemanticsDigest: inventory.semantics.semanticsDigest,
      mutationClass: inventory.semantics.mutationClass,
      receiptClass: inventory.semantics.receiptClass,
      finalRiskTier: finalAuthorisation.riskTier,
      selectedAuditReadOnly: selected.readOnly,
      taskId: operationContext.taskId,
      sessionFingerprint: operationContext.sessionFingerprint,
      objectiveDigest: operationContext.objectiveDigest,
      targetFingerprint: operationContext.targetFingerprint,
      inventoryAuthorityId: inventory.snapshotAuthorityId,
      inventorySourceDigest: inventory.sourceDigest,
      inventoryGeneration: inventory.inventoryGeneration,
      inventoryDigest: inventory.inventoryDigest,
      hostAdapterPlanDigest: inventory.planDigest,
      selectedInterface: selected.interfaceId,
      capabilityDigest: selected.capabilityDigest
    }),
    rationale: structured.length > 0
      ? 'Selected the highest-assurance reviewed structured interface for this exact operation.'
      : selected.interfaceKind === 'owner-action'
        ? 'Delegation is unsafe or unsupported; one narrow owner action is required.'
        : 'No reviewed structured interface can perform the operation; the approved graphical fallback is bounded to this operation.',
    rejected: audited.filter((audit) => audit.interfaceId !== selected.interfaceId).map((audit) => ({
      interfaceId: audit.interfaceId,
      reason: STRUCTURED_INTERFACE_KINDS.has(selected.interfaceKind) && !STRUCTURED_INTERFACE_KINDS.has(audit.interfaceKind)
          ? 'structured interface outranks graphical fallback'
          : 'lower operation-specific assurance'
    }))
  };
  Object.freeze(route.rejected);
  Object.freeze(route);
  SELECTED_ROUTE_AUTHORITIES.set(route, {
    authority: inventory.authority,
    operationContext: { ...operationContext },
    envelopeDigest: sha256(envelope),
    semanticsDigest: inventory.semantics.semanticsDigest,
    selectedAuditDigest: selected.capabilityDigest
  });
  return route;
}

function validateConsumerRequirements(manifest) {
  requireObject(manifest, 'Consumer requirements manifest');
  const allowed = new Set(['schemaVersion', 'providers']);
  assertAllowedKeys(manifest, allowed, 'Consumer requirements manifest');
  invariant(manifest.schemaVersion === CONSUMER_SCHEMA_VERSION, 'Unsupported consumer-requirements schema.');
  invariant(Array.isArray(manifest.providers) && manifest.providers.length > 0, 'providers must contain at least one provider requirement.');
  for (const [index, provider] of manifest.providers.entries()) {
    requireObject(provider, `providers[${index}]`);
    assertAllowedKeys(provider, new Set([
      'provider', 'requiredCapabilities', 'environmentAliases', 'publicOrigins', 'contextualRiskOverrides',
      'verification', 'rollbackExpectations', 'forbiddenOperations', 'browserFallbackAllowed'
    ]), `providers[${index}]`);
    requireString(provider.provider, `providers[${index}].provider`, { pattern: PROVIDER_PATTERN });
    requireStringArray(provider.requiredCapabilities, `providers[${index}].requiredCapabilities`, { min: 1, unique: true, pattern: ALIAS_PATTERN });
    requireStringArray(provider.environmentAliases, `providers[${index}].environmentAliases`, { min: 1, unique: true, pattern: ALIAS_PATTERN });
    const origins = requireStringArray(provider.publicOrigins || [], `providers[${index}].publicOrigins`, { unique: true, max: 300 });
    for (const origin of origins) invariant(isPublicHttpsOrigin(origin), `publicOrigins contains a private, credential-bearing, or non-HTTPS origin: ${origin}`, 'EXTERNAL_PRIVATE_ORIGIN_REJECTED');
    requireObject(provider.contextualRiskOverrides || {}, `providers[${index}].contextualRiskOverrides`);
    for (const [operation, tier] of Object.entries(provider.contextualRiskOverrides || {})) {
      requireString(operation, 'contextualRiskOverrides operation', { pattern: ALIAS_PATTERN });
      invariant(Number.isInteger(tier) && tier >= 0 && tier <= 3, `Risk override for ${operation} must be 0-3.`);
    }
    requireStringArray(provider.verification, `providers[${index}].verification`, { min: 1 });
    requireStringArray(provider.rollbackExpectations, `providers[${index}].rollbackExpectations`, { min: 1 });
    requireStringArray(provider.forbiddenOperations, `providers[${index}].forbiddenOperations`, { unique: true, pattern: ALIAS_PATTERN });
    invariant(typeof provider.browserFallbackAllowed === 'boolean', `providers[${index}].browserFallbackAllowed must be boolean.`);
  }
  assertNoSecretMaterial(manifest, 'Consumer requirements manifest', { strictOrigins: true });
  return manifest;
}

function defaultRegistryPath() {
  return canonicalInventoryPath();
}

function defaultLocalStatePaths() {
  const base = path.join(os.homedir(), '.ai-agent-toolkit');
  return {
    registry: path.join(base, 'external-system-targets.json'),
    capabilityMatrix: path.join(base, 'capability-matrix.json'),
    capabilityLedger: path.join(base, 'capability-ledger.json'),
    receipts: path.join(base, 'operation-receipts'),
    n8nTaskLedgers: path.join(base, 'task-state', 'n8n')
  };
}

function validateProviderTargetRecord(target, label = 'target') {
  requireObject(target, label);
    assertAllowedKeys(target, new Set([
      'provider', 'targetAlias', 'accountOrOrganisation', 'environment', 'sanitizedFingerprint', 'privateOriginReference',
      'resourceReferences', 'credentialReferences', 'multipleCredentialJustification', 'installedInterfaces',
      'capabilityDigests', 'operationSemantics', 'routeSelections', 'lastAuditState', 'receiptReferences', 'inventoryGeneration'
    ]), label);
    requireString(target.provider, 'provider', { pattern: PROVIDER_PATTERN });
    requireString(target.targetAlias, 'targetAlias', { pattern: ALIAS_PATTERN });
    requireString(target.accountOrOrganisation, 'accountOrOrganisation', { pattern: ALIAS_PATTERN });
    requireString(target.environment, 'environment', { pattern: ALIAS_PATTERN });
    requireString(target.sanitizedFingerprint, 'sanitizedFingerprint', { pattern: DIGEST_PATTERN });
    requireString(target.inventoryGeneration, 'inventoryGeneration', { pattern: DIGEST_PATTERN });
    if (target.privateOriginReference !== undefined) requireString(target.privateOriginReference, 'privateOriginReference', { pattern: PRIVATE_REFERENCE_PATTERN });
    requireStringArray(target.resourceReferences || [], 'resourceReferences', { unique: true, pattern: ALIAS_PATTERN });
    const credentialReferences = requireStringArray(target.credentialReferences || [], 'credentialReferences', { min: 1, unique: true, pattern: CREDENTIAL_REFERENCE_PATTERN });
    if (credentialReferences.length > 1) requireString(target.multipleCredentialJustification, 'multipleCredentialJustification', { max: 500 });
    requireStringArray(target.installedInterfaces || [], 'installedInterfaces', { unique: true, pattern: ALIAS_PATTERN });
    requireStringArray(target.capabilityDigests || [], 'capabilityDigests', { unique: true, pattern: DIGEST_PATTERN });
    invariant(Array.isArray(target.operationSemantics) && target.operationSemantics.length > 0,
      'Target must define canonical operation semantics.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
    const semanticOperations = new Set();
    for (const semantics of target.operationSemantics) {
      validateOperationSemantics(semantics);
      invariant(!semanticOperations.has(semantics.operation),
        `Duplicate operation semantics for ${semantics.operation}.`, 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
      semanticOperations.add(semantics.operation);
    }
    requireObject(target.routeSelections || {}, 'routeSelections');
    for (const [operation, interfaceId] of Object.entries(target.routeSelections || {})) {
      requireString(operation, 'routeSelections operation', { pattern: ALIAS_PATTERN });
      requireString(interfaceId, `routeSelections.${operation}`, { pattern: ALIAS_PATTERN });
      invariant(semanticOperations.has(operation),
        `Route selection ${operation} lacks canonical operation semantics.`, 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
    }
    requireString(target.lastAuditState, 'lastAuditState', { pattern: ALIAS_PATTERN });
    requireStringArray(target.receiptReferences || [], 'receiptReferences', { unique: true, pattern: ALIAS_PATTERN });
  return target;
}

function validateProviderTargetRegistry(registry) {
  requireObject(registry, 'Provider target registry');
  assertAllowedKeys(registry, new Set([
    'schemaVersion', 'routerVersion', 'routerSourceDigest', 'repositoryIdentity', 'hostIdentity',
    'installationIdentity', 'authorityPathDigest', 'inventoryGeneration', 'generationSequence',
    'generatedAt', 'targets'
  ]), 'Provider target registry');
  invariant(registry.schemaVersion === REGISTRY_SCHEMA_VERSION, 'Unsupported provider-target-registry schema.');
  invariant(registry.routerVersion === ROUTER_VERSION, 'Provider target registry router version is stale.',
    'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
  for (const field of [
    'routerSourceDigest', 'repositoryIdentity', 'hostIdentity', 'installationIdentity',
    'authorityPathDigest', 'inventoryGeneration'
  ]) requireString(registry[field], field, { pattern: DIGEST_PATTERN });
  invariant(Number.isSafeInteger(registry.generationSequence) && registry.generationSequence >= 0,
    'generationSequence must be a non-negative safe integer.');
  invariant(Number.isFinite(Date.parse(requireString(registry.generatedAt, 'generatedAt'))),
    'generatedAt must be an ISO date-time.');
  invariant(Array.isArray(registry.targets), 'registry.targets must be an array.');
  const keys = new Set();
  for (const [index, target] of registry.targets.entries()) {
    validateProviderTargetRecord(target, `targets[${index}]`);
    invariant(target.inventoryGeneration === registry.inventoryGeneration,
      'Target generation differs from the authenticated registry generation.',
      'EXTERNAL_INVENTORY_GENERATION_ROLLBACK');
    const key = `${target.provider}\u0000${target.targetAlias}\u0000${target.accountOrOrganisation}\u0000${target.environment}`;
    invariant(!keys.has(key), `Duplicate provider target ${target.provider}/${target.targetAlias}/${target.environment}.`);
    keys.add(key);
  }
  assertNoSecretMaterial(registry, 'Provider target registry', {
    allowedSensitiveKeys: new Set(['credentialReferences', 'privateOriginReference', 'multipleCredentialJustification'])
  });
  return registry;
}

function resolveProviderTarget(registry, selector) {
  validateProviderTargetRegistry(registry);
  requireObject(selector, 'Provider target selector');
  const provider = requireString(selector.provider, 'selector.provider', { pattern: PROVIDER_PATTERN });
  const candidates = registry.targets.filter((target) => target.provider === provider
    && (selector.targetAlias === undefined || target.targetAlias === selector.targetAlias)
    && (selector.environment === undefined || target.environment === selector.environment));
  invariant(candidates.length > 0, `No registered ${provider} target matches repository/task context.`, 'EXTERNAL_TARGET_NOT_FOUND');
  invariant(candidates.length === 1, `Multiple ${provider} targets match; ask once and pin target alias plus environment in the envelope.`, 'EXTERNAL_TARGET_AMBIGUOUS');
  invariant(selector.targetAlias && selector.environment, 'Target resolution must not guess from recent credentials, tabs, history, environment variables, or registration order.', 'EXTERNAL_TARGET_PIN_REQUIRED');
  return candidates[0];
}

function buildHostAdapterPlan(inventoryAuthority, selector, host, capabilityAudits) {
  const state = revalidateInventoryAuthority(inventoryAuthority);
  invariant(['codex', 'claude-code'].includes(host), 'host must be codex or claude-code.');
  const target = resolveProviderTarget(state.registry, selector);
  const audits = currentInventoryAudits(target, capabilityAudits);
  const supportedOperations = audits.map((audit) => ({
    operation: audit.operation,
    interfaceId: audit.interfaceId,
    interfaceKind: audit.interfaceKind,
    readOnly: audit.readOnly,
    mutationClass: audit.readOnly ? 'read-only' : 'mutation',
    operationSemanticsVersion: audit.operationSemanticsVersion,
    operationSemanticsDigest: audit.operationSemanticsDigest,
    receiptClass: target.operationSemantics.find((entry) =>
      entry.operation === audit.operation).receiptClass,
    capabilityDigest: audit.capabilityDigest,
    targetFingerprint: audit.targetFingerprint
  }));
  const plan = {
    schemaVersion: HOST_ADAPTER_PLAN_SCHEMA_VERSION,
    snapshotAuthorityId: inventoryAuthority.authorityId,
    sourceDigest: inventoryAuthority.sourceDigest,
    routerVersion: state.registry.routerVersion,
    routerSourceDigest: state.registry.routerSourceDigest,
    installationIdentity: state.registry.installationIdentity,
    repositoryIdentity: state.registry.repositoryIdentity,
    hostIdentity: state.registry.hostIdentity,
    generationSequence: state.registry.generationSequence,
    derivedAt: new Date().toISOString(),
    logicalTarget: {
      provider: target.provider,
      targetAlias: target.targetAlias,
      accountOrOrganisation: target.accountOrOrganisation,
      environment: target.environment,
      sanitizedFingerprint: target.sanitizedFingerprint,
      resourceReferences: target.resourceReferences || []
    },
    inventoryGeneration: target.inventoryGeneration,
    inventoryDigest: targetInventoryDigest(target),
    currentAuditState: target.lastAuditState,
    host,
    hostConfigurationScope: host === 'codex' ? 'user-scoped Codex config' : 'Claude local or user scope after workspace trust',
    credentialReferences: target.credentialReferences,
    installedInterfaces: target.installedInterfaces,
    supportedOperations,
    capabilityAuditPassed: supportedOperations.length > 0,
    preserveOtherHostConfiguration: true,
    mutateProjectOwnedConfiguration: false,
    copySecretsIntoRepository: false,
    requiresProviderRediscoveryOnHostSwitch: false
  };
  plan.planDigest = hostAdapterPlanDigest(plan);
  validateHostAdapterPlan(plan);
  Object.freeze(plan.supportedOperations);
  Object.freeze(plan);
  HOST_PLAN_AUTHORITIES.set(plan, {
    authority: inventoryAuthority,
    targetKey: `${target.provider}\u0000${target.targetAlias}\u0000${target.accountOrOrganisation}\u0000${target.environment}`
  });
  return plan;
}

function recommendN8nComponents(evidence) {
  requireObject(evidence, 'n8n evidence');
  const ownsWorkflowJson = evidence.ownsWorkflowJson === true;
  const designsNodesOrExpressions = evidence.designsNodesOrExpressions === true;
  const requiresLiveWorkflowOperations = evidence.requiresLiveWorkflowOperations === true;
  const requiresCredentialOrOauthSetup = evidence.requiresCredentialOrOauthSetup === true;
  const webhookOnlyConsumer = evidence.webhookOnlyConsumer === true;
  const historicalMentionOnly = evidence.historicalMentionOnly === true;
  if (historicalMentionOnly && !ownsWorkflowJson && !designsNodesOrExpressions && !requiresLiveWorkflowOperations && !requiresCredentialOrOauthSetup) {
    return {
      detected: false,
      recommendations: [],
      addDynamicMarker: false,
      recommendOwnerApprovedMarkerRemoval: evidence.markerPresent === true,
      installOfficialSkills: false,
      installMcp: false
    };
  }
  const recommendations = [];
  if (ownsWorkflowJson) recommendations.push('canonical-n8n-workflows-folder-rules', 'n8n-workflow-helper-scripts');
  if (designsNodesOrExpressions) recommendations.push('official-n8n-skills');
  if (requiresLiveWorkflowOperations) recommendations.push('operation-scoped-live-transport-audit');
  if (requiresCredentialOrOauthSetup) recommendations.push('informed-browser-fallback-when-structured-setup-is-unsupported');
  if (webhookOnlyConsumer && !ownsWorkflowJson && !designsNodesOrExpressions && !requiresLiveWorkflowOperations && !requiresCredentialOrOauthSetup) {
    recommendations.push('webhook-contract-only');
  }
  return {
    detected: recommendations.length > 0,
    recommendations: [...new Set(recommendations)],
    addDynamicMarker: recommendations.length > 0,
    recommendOwnerApprovedMarkerRemoval: false,
    installOfficialSkills: designsNodesOrExpressions,
    installMcp: false,
    liveTransportMustBeAuditedSeparately: requiresLiveWorkflowOperations,
    helpersRecommended: ownsWorkflowJson,
    helpersSuppressedForWebhookOnly: webhookOnlyConsumer && !ownsWorkflowJson
  };
}

function capability(provider, name, reason, source) {
  return { provider, capability: name, reason, source };
}

function inferIntentCapabilities(objective) {
  const text = requireString(objective, 'objective', { max: 2000 }).toLowerCase();
  const requirements = [];
  if (/hostinger\s+(?:vps|server)|set\s*up\s+hostinger/.test(text)) {
    requirements.push(capability('hostinger', 'vps-setup', 'Explicit Hostinger VPS setup intent.', 'intent'));
  }
  if (/deploy(?:ment)?\s+(?:through|via|to)\s+coolify|coolify\s+deploy/.test(text)) {
    requirements.push(capability('coolify', 'application-deployment', 'Explicit Coolify deployment intent.', 'intent'));
  }
  if (/(?:add|configure|set\s*up)\s+google\s+(?:login|oauth|oidc)|google\s+(?:login|oauth|oidc)/.test(text)) {
    requirements.push(capability('google', 'oauth-login-setup', 'Explicit Google login/OAuth intent.', 'intent'));
  }
  if (/n8n.*(?:production|live|import|update|activate)|(?:production|live).*n8n/.test(text)) {
    requirements.push(capability('n8n', 'live-workflow-transport', 'Explicit live/production n8n workflow intent.', 'intent'));
  }
  if (/n8n.*(?:workflow|node|expression|json|sdk|repair|review|design|create|edit)|(?:workflow|node|expression).*n8n/.test(text)) {
    requirements.push(capability('n8n', 'mandatory-domain-admission', 'Explicit material n8n task intent.', 'intent'));
    requirements.push(capability('n8n', 'official-skill-ledger', 'Material n8n work requires exact official Skill evidence.', 'intent'));
  }
  if (/cloudflare\s+r2|configure\s+r2/.test(text)) {
    requirements.push(capability('cloudflare', 'r2-configuration', 'Explicit Cloudflare R2 intent.', 'intent'));
  }
  if (/switch.*(?:codex.*claude|claude.*codex)|(?:codex|claude code).*host switch/.test(text)) {
    requirements.push(capability('toolkit-host', 'host-switch-reconciliation', 'Explicit Codex/Claude host-switch intent.', 'intent'));
  }
  return requirements;
}

function isSubstantiveExternalObjective(objective, trigger) {
  const text = String(objective || '').trim();
  if (!text || /^(?:inspect|review|check)(?:\s+the)?\s+(?:repository|project)\s+(?:requirements|configuration)\.?$/i.test(text)) return false;
  if (trigger === 'explicit-provider-intent') return true;
  return /\b(?:deploy|provision|configure|connect|publish|activate|migrate|sync|create|update|delete|rotate|authenticate)\b/i.test(text)
    && /\b(?:production|staging|cloud|provider|hosted|remote|aws|amazon|azure|gcp|google cloud|heroku|vercel|netlify|render|fly\.io|digitalocean|dns|oauth|database|storage|workflow|api)\b/i.test(text);
}

function inferRepositoryCapabilities(evidence) {
  requireObject(evidence, 'Repository evidence');
  const files = Array.isArray(evidence.files) ? evidence.files : [];
  const requirements = [];
  let n8nWorkflowJson = false;
  const n8nHistoricalOnly = evidence.n8nHistoricalMentionOnly === true;
  for (const entry of files) {
    requireObject(entry, 'Repository evidence file');
    const filePath = requireString(entry.path, 'Repository evidence path', { max: 500 }).replace(/\\/g, '/');
    invariant(!/(^|\/)\.env(?:\.|$)|(^|\/)(?:secrets?|credentials?)(?:\/|$)/i.test(filePath), `Repository reconciliation must not inspect secret-bearing file ${filePath}.`, 'EXTERNAL_REPOSITORY_EVIDENCE_FORBIDDEN');
    const kind = entry.kind || 'path-only';
    invariant(['path-only', 'sanitized-metadata', 'workflow-json-structure', 'consumer-manifest'].includes(kind), `Unsupported evidence kind ${kind}.`);
    const lowerPath = filePath.toLowerCase();
    const text = typeof entry.sanitizedText === 'string' ? entry.sanitizedText.toLowerCase() : '';
    assertNoSecretMaterial({ path: filePath, sanitizedText: text }, 'Repository evidence');
    if ((/n8n-workflows?\/.*\.json$/.test(lowerPath) || kind === 'workflow-json-structure') && entry.current !== false) n8nWorkflowJson = true;
    if (/coolify(?:\.ya?ml)?/.test(lowerPath) || /\bcoolify\b/.test(text)) {
      requirements.push(capability('coolify', 'deployment-target', `Repository evidence: ${filePath}`, 'repository'));
    }
    if (/cloudflare|(?:^|[/_.-])r2(?:[/_.-](?:storage|bucket)|$)|(?:storage|bucket)[/_.-]r2/.test(lowerPath) || /cloudflare\s+r2/.test(text)) {
      requirements.push(capability('cloudflare', 'r2-compatible-storage', `Repository evidence: ${filePath}`, 'repository'));
    }
    if (/supabase/.test(lowerPath) || /\bsupabase\b/.test(text)) {
      requirements.push(capability('supabase', 'project-integration', `Repository evidence: ${filePath}`, 'repository'));
    }
    if (/neon/.test(lowerPath) || /\bneon\b/.test(text)) {
      requirements.push(capability('neon', 'postgres-integration', `Repository evidence: ${filePath}`, 'repository'));
    }
    if (/google.*(?:oauth|oidc)|(?:oauth|oidc).*google/.test(lowerPath) || /google\s+(?:oauth|oidc|login)/.test(text)) {
      requirements.push(capability('google', 'oauth-login', `Repository evidence: ${filePath}`, 'repository'));
    }
  }
  if (evidence.consumerManifest) {
    validateConsumerRequirements(evidence.consumerManifest);
    for (const provider of evidence.consumerManifest.providers) {
      for (const requiredCapability of provider.requiredCapabilities) {
        requirements.push(capability(provider.provider, requiredCapability, 'Consumer requirements manifest.', 'repository-manifest'));
      }
    }
  }
  const n8n = recommendN8nComponents({
    ownsWorkflowJson: n8nWorkflowJson,
    designsNodesOrExpressions: evidence.n8nDesignIntent === true,
    requiresLiveWorkflowOperations: evidence.n8nLiveIntent === true,
    requiresCredentialOrOauthSetup: evidence.n8nCredentialIntent === true,
    webhookOnlyConsumer: evidence.n8nWebhookOnly === true,
    historicalMentionOnly: !n8nWorkflowJson && n8nHistoricalOnly,
    markerPresent: evidence.n8nMarkerPresent === true
  });
  for (const recommendation of n8n.recommendations) {
    requirements.push(capability('n8n', recommendation, 'Component-based n8n repository reconciliation.', 'repository'));
  }
  return { requirements, n8n };
}

function deduplicateCapabilities(requirements) {
  const result = new Map();
  for (const item of requirements) {
    const key = `${item.provider}\u0000${item.capability}`;
    const existing = result.get(key);
    if (!existing) result.set(key, { ...item, sources: [item.source], reasons: [item.reason] });
    else {
      if (!existing.sources.includes(item.source)) existing.sources.push(item.source);
      if (!existing.reasons.includes(item.reason)) existing.reasons.push(item.reason);
    }
  }
  return [...result.values()].sort((left, right) => `${left.provider}/${left.capability}`.localeCompare(`${right.provider}/${right.capability}`));
}

function reconcileCapabilities(input) {
  requireObject(input, 'Reconciliation input');
  invariant(RECONCILIATION_TRIGGERS.includes(input.trigger), `Unsupported reconciliation trigger ${input.trigger}.`);
  const repository = inferRepositoryCapabilities(input.repositoryEvidence || {});
  const intent = inferIntentCapabilities(input.objective || 'Inspect repository requirements.');
  const combined = [...repository.requirements, ...intent];
  if (combined.length === 0 && isSubstantiveExternalObjective(input.objective, input.trigger)) {
    combined.push(capability(
      'external-system',
      'exact-provider-operation-classification',
      'Substantive external-system intent requires exact provider, target, environment, resource, and operation classification.',
      'intent'
    ));
  }
  const requirements = deduplicateCapabilities(combined);
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    trigger: input.trigger,
    repositoryDigest: sha256(input.repositoryEvidence || {}),
    intentDigest: sha256(input.objective || ''),
    requirements,
    n8n: repository.n8n,
    genericSetupInstallsNothing: true,
    reconciliationDigest: sha256({
      trigger: input.trigger,
      repositoryDigest: sha256(input.repositoryEvidence || {}),
      intentDigest: sha256(input.objective || ''),
      requirements
    })
  };
}

function buildCapabilityLedger(reconciliation, state = {}) {
  requireObject(reconciliation, 'Reconciliation');
  invariant(reconciliation.schemaVersion === LEDGER_SCHEMA_VERSION, 'Unsupported reconciliation schema.');
  const carriesPriorEvidence = ['verified', 'deferred', 'unnecessary']
    .some((field) => Array.isArray(state[field]) && state[field].length > 0);
  if (carriesPriorEvidence) {
    invariant(state.reconciliationDigest === reconciliation.reconciliationDigest
      && state.repositoryDigest === reconciliation.repositoryDigest
      && state.intentDigest === reconciliation.intentDigest,
    'Capability evidence belongs to a different repository, intent, or reconciliation.',
    'EXTERNAL_RECONCILIATION_STATE_MISMATCH');
  }
  const verified = new Map((state.verified || []).map((entry) => [`${entry.provider}\u0000${entry.capability}`, entry]));
  const deferred = new Map((state.deferred || []).map((entry) => [`${entry.provider}\u0000${entry.capability}`, entry]));
  const unnecessary = new Map((state.unnecessary || []).map((entry) => [`${entry.provider}\u0000${entry.capability}`, entry]));
  const capabilities = reconciliation.requirements.map((requirement) => {
    const key = `${requirement.provider}\u0000${requirement.capability}`;
    if (verified.has(key)) {
      const entry = verified.get(key);
      requireString(entry.verificationEvidence, 'verificationEvidence', { max: 500 });
      return { ...requirement, status: 'configured-and-verified', verificationEvidence: entry.verificationEvidence };
    }
    if (deferred.has(key)) {
      const entry = deferred.get(key);
      requireString(entry.blocker, 'blocker', { max: 500 });
      return { ...requirement, status: 'deferred-with-blocker', blocker: entry.blocker };
    }
    if (unnecessary.has(key)) {
      const entry = unnecessary.get(key);
      requireString(entry.evidence, 'unnecessary evidence', { max: 500 });
      return { ...requirement, status: 'proven-unnecessary', evidence: entry.evidence };
    }
    return { ...requirement, status: 'pending' };
  });
  return validateCapabilityLedger({
    schemaVersion: LEDGER_SCHEMA_VERSION,
    reconciliationDigest: reconciliation.reconciliationDigest,
    repositoryDigest: reconciliation.repositoryDigest,
    intentDigest: reconciliation.intentDigest,
    capabilities,
    complete: capabilities.every((entry) => entry.status !== 'pending'),
    updatedAt: state.updatedAt || new Date(0).toISOString()
  });
}

function validateCapabilityLedger(ledger) {
  requireObject(ledger, 'Capability ledger');
  assertAllowedKeys(ledger, new Set([
    'schemaVersion', 'reconciliationDigest', 'repositoryDigest', 'intentDigest',
    'capabilities', 'complete', 'updatedAt'
  ]), 'Capability ledger');
  invariant(ledger.schemaVersion === LEDGER_SCHEMA_VERSION, 'Unsupported capability-ledger schema.');
  for (const field of ['reconciliationDigest', 'repositoryDigest', 'intentDigest']) {
    requireString(ledger[field], field, { pattern: DIGEST_PATTERN });
  }
  invariant(Array.isArray(ledger.capabilities), 'capabilities must be an array.');
  const capabilityKeys = new Set();
  for (const [index, entry] of ledger.capabilities.entries()) {
    requireObject(entry, `capabilities[${index}]`);
    assertAllowedKeys(entry, new Set([
      'provider', 'capability', 'reason', 'source', 'sources', 'reasons', 'status',
      'verificationEvidence', 'blocker', 'evidence'
    ]), `capabilities[${index}]`);
    requireString(entry.provider, `capabilities[${index}].provider`, { pattern: PROVIDER_PATTERN });
    requireString(entry.capability, `capabilities[${index}].capability`, { pattern: ALIAS_PATTERN });
    if (entry.source !== undefined) invariant(['repository', 'repository-manifest', 'intent'].includes(entry.source), `capabilities[${index}].source is invalid.`);
    if (entry.reason !== undefined) requireString(entry.reason, `capabilities[${index}].reason`, { max: 500 });
    const sources = requireStringArray(entry.sources, `capabilities[${index}].sources`, { min: 1, unique: true });
    for (const source of sources) invariant(['repository', 'repository-manifest', 'intent'].includes(source), `capabilities[${index}].sources contains an invalid source.`);
    requireStringArray(entry.reasons, `capabilities[${index}].reasons`, { min: 1, unique: true, max: 500 });
    invariant(['configured-and-verified', 'deferred-with-blocker', 'proven-unnecessary', 'pending'].includes(entry.status), `capabilities[${index}].status is invalid.`);
    if (entry.status === 'configured-and-verified') {
      requireString(entry.verificationEvidence, `capabilities[${index}].verificationEvidence`, { max: 500 });
      invariant(entry.blocker === undefined && entry.evidence === undefined, `capabilities[${index}] mixes incompatible completion evidence.`);
    } else if (entry.status === 'deferred-with-blocker') {
      requireString(entry.blocker, `capabilities[${index}].blocker`, { max: 500 });
      invariant(entry.verificationEvidence === undefined && entry.evidence === undefined, `capabilities[${index}] mixes incompatible completion evidence.`);
    } else if (entry.status === 'proven-unnecessary') {
      requireString(entry.evidence, `capabilities[${index}].evidence`, { max: 500 });
      invariant(entry.verificationEvidence === undefined && entry.blocker === undefined, `capabilities[${index}] mixes incompatible completion evidence.`);
    } else {
      invariant(entry.verificationEvidence === undefined && entry.blocker === undefined && entry.evidence === undefined, `Pending capability ${entry.capability} must not carry completion evidence.`);
    }
    const key = `${entry.provider}\u0000${entry.capability}`;
    invariant(!capabilityKeys.has(key), `Duplicate capability ${entry.provider}/${entry.capability}.`);
    capabilityKeys.add(key);
  }
  invariant(typeof ledger.complete === 'boolean', 'complete must be boolean.');
  invariant(ledger.complete === ledger.capabilities.every((entry) => entry.status !== 'pending'), 'Capability ledger complete flag does not match capability states.', 'EXTERNAL_CAPABILITY_LEDGER_INVALID');
  invariant(Number.isFinite(Date.parse(requireString(ledger.updatedAt, 'updatedAt'))), 'updatedAt must be an ISO date-time.');
  assertNoSecretMaterial(ledger, 'Capability ledger');
  return ledger;
}

function assertObjectiveComplete(ledger) {
  validateCapabilityLedger(ledger);
  const supported = new Set(['configured-and-verified', 'deferred-with-blocker', 'proven-unnecessary']);
  const pending = ledger.capabilities.filter((entry) => !supported.has(entry.status));
  invariant(pending.length === 0, `Objective cannot be declared complete; ${pending.length} capability requirement(s) remain pending.`, 'EXTERNAL_CAPABILITY_LEDGER_INCOMPLETE');
  invariant(ledger.complete === true, 'Objective cannot be declared complete while the ledger is incomplete.', 'EXTERNAL_CAPABILITY_LEDGER_INCOMPLETE');
  return { complete: true, capabilities: ledger.capabilities.length };
}

const RECONCILIATION_QUESTIONS = Object.freeze([
  ['provider', 'Which exact provider is in scope?'],
  ['targetAlias', 'Which user-local target alias is in scope?'],
  ['accountOrOrganisation', 'Which account or organisation alias is in scope?'],
  ['resource', 'Which exact instance, project, application, or resource alias is in scope?'],
  ['environment', 'Which environment is in scope?'],
  ['objective', 'What exact objective is authorised?'],
  ['allowedOperations', 'Which exact operations are allowed?'],
  ['operationRiskTiers', 'What minimum risk tier applies to each allowed operation?'],
  ['authorisedTier2Operations', 'Which Tier 2 operations are explicitly authorised?'],
  ['forbiddenOperations', 'Which operations are forbidden?'],
  ['expectedResult', 'What result is expected?'],
  ['verification', 'How will the result be verified?'],
  ['rollbackOrSafeDisable', 'What rollback or safe-disable path applies?'],
  ['lifetime', 'How long does the authorisation envelope last?'],
  ['ownerApprovalReference', 'What owner approval reference binds the envelope?'],
  ['interfaceRestrictions', 'Are any interfaces required or forbidden?'],
  ['browserFallbackAllowed', 'Is bounded graphical fallback allowed after structured routes fail?'],
  ['markerChange', 'Is the proposed managed domain-marker addition, removal, or migration approved?'],
  ['targetRegistration', 'Is the proposed non-secret local target registration approved?'],
  ['credentialReference', 'Which credential reference (never value) should the target use?']
]);

function buildReconciliationQuestionBank(context) {
  requireObject(context, 'Question-bank context');
  const contextDigest = sha256(context);
  const questions = RECONCILIATION_QUESTIONS.map(([id, prompt]) => ({ id, prompt, required: true }));
  return validateReconciliationQuestionBank({
    schemaVersion: QUESTION_BANK_SCHEMA_VERSION,
    contextDigest,
    questions,
    questionBankDigest: sha256({ schemaVersion: QUESTION_BANK_SCHEMA_VERSION, contextDigest, questions })
  });
}

function validateReconciliationQuestionBank(questionBank) {
  requireObject(questionBank, 'Question bank');
  assertAllowedKeys(questionBank, new Set(['schemaVersion', 'contextDigest', 'questions', 'questionBankDigest']), 'Question bank');
  invariant(questionBank.schemaVersion === QUESTION_BANK_SCHEMA_VERSION, 'Unsupported question-bank schema.');
  requireString(questionBank.contextDigest, 'questionBank.contextDigest', { pattern: /^sha256:[0-9a-f]{64}$/ });
  requireString(questionBank.questionBankDigest, 'questionBank.questionBankDigest', { pattern: /^sha256:[0-9a-f]{64}$/ });
  invariant(Array.isArray(questionBank.questions) && questionBank.questions.length === RECONCILIATION_QUESTIONS.length, 'Question bank must contain the complete canonical question set.', 'EXTERNAL_QUESTION_BANK_MISMATCH');
  for (const [index, [expectedId, expectedPrompt]] of RECONCILIATION_QUESTIONS.entries()) {
    const question = questionBank.questions[index];
    requireObject(question, `questions[${index}]`);
    assertAllowedKeys(question, new Set(['id', 'prompt', 'required']), `questions[${index}]`);
    invariant(question.id === expectedId && question.prompt === expectedPrompt && question.required === true, `Question bank entry ${index} does not match the canonical question set.`, 'EXTERNAL_QUESTION_BANK_MISMATCH');
  }
  invariant(questionBank.questionBankDigest === sha256({
    schemaVersion: questionBank.schemaVersion,
    contextDigest: questionBank.contextDigest,
    questions: questionBank.questions
  }), 'Question bank digest is invalid.', 'EXTERNAL_QUESTION_BANK_MISMATCH');
  return questionBank;
}

function validateReconciliationAnswers(questionBank, answers) {
  validateReconciliationQuestionBank(questionBank);
  requireObject(answers, 'Reconciliation answers');
  assertAllowedKeys(answers, new Set(['schemaVersion', 'questionBankDigest', 'ownerApproved', 'ownerApprovalReference', 'answers']), 'Reconciliation answers');
  invariant(answers.schemaVersion === ANSWER_SCHEMA_VERSION, 'Unsupported reconciliation-answer schema.');
  invariant(answers.questionBankDigest === questionBank.questionBankDigest, 'Answers do not bind to the complete question bank.', 'EXTERNAL_QUESTION_BANK_MISMATCH');
  requireString(answers.ownerApprovalReference, 'answers.ownerApprovalReference', { max: 200 });
  requireObject(answers.answers, 'answers.answers');
  const expectedIds = questionBank.questions.map((question) => question.id);
  assertAllowedKeys(answers.answers, new Set(expectedIds), 'answers.answers');
  for (const id of expectedIds) {
    invariant(Object.prototype.hasOwnProperty.call(answers.answers, id), `Complete question bank answer missing: ${id}.`, 'EXTERNAL_QUESTION_BANK_INCOMPLETE');
    const value = answers.answers[id];
    invariant(value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === ''), `Question ${id} requires an answer.`, 'EXTERNAL_QUESTION_BANK_INCOMPLETE');
  }
  invariant(answers.ownerApproved === true, 'Writes require owner approval after the complete question bank.', 'EXTERNAL_WRITE_APPROVAL_REQUIRED');
  assertNoSecretMaterial(answers, 'Reconciliation answers', { allowedSensitiveKeys: new Set(['credentialReference']) });
  return answers;
}

function inspectN8nMarker(text) {
  const content = String(text);
  const dynamicBegin = countOccurrences(content, N8N_DOMAIN_MARKERS.begin);
  const dynamicEnd = countOccurrences(content, N8N_DOMAIN_MARKERS.end);
  const legacyBegin = countOccurrences(content, LEGACY_N8N_MARKERS.begin);
  const legacyEnd = countOccurrences(content, LEGACY_N8N_MARKERS.end);
  invariant(dynamicBegin === dynamicEnd && dynamicBegin <= 1, 'Malformed or duplicate dynamic n8n marker block.', 'EXTERNAL_MARKER_MALFORMED');
  invariant(legacyBegin === legacyEnd && legacyBegin <= 1, 'Malformed or duplicate legacy n8n marker block.', 'EXTERNAL_MARKER_MALFORMED');
  invariant(!(dynamicBegin === 1 && legacyBegin === 1), 'Dynamic and legacy n8n marker blocks cannot coexist.', 'EXTERNAL_MARKER_MALFORMED');
  return {
    dynamic: dynamicBegin === 1,
    legacy: legacyBegin === 1,
    state: dynamicBegin === 1 ? 'dynamic-present' : legacyBegin === 1 ? 'legacy-present' : 'absent'
  };
}

function removeMarkedBlock(text, markers) {
  const start = text.indexOf(markers.begin);
  if (start < 0) return text;
  const endStart = text.indexOf(markers.end, start);
  invariant(endStart >= 0, 'Managed marker end is missing.', 'EXTERNAL_MARKER_MALFORMED');
  let end = endStart + markers.end.length;
  if (text.slice(end, end + 2) === '\r\n') end += 2;
  else if (text[end] === '\n') end += 1;
  return text.slice(0, start) + text.slice(end);
}

function applyN8nMarkerChange(text, change, questionBank, answers) {
  invariant(['add', 'remove', 'migrate'].includes(change), 'Marker change must be add, remove, or migrate.');
  validateReconciliationAnswers(questionBank, answers);
  invariant(answers.answers.markerChange === change || answers.answers.markerChange === `approve:${change}`, `Question-bank approval does not authorise marker ${change}.`, 'EXTERNAL_MARKER_APPROVAL_REQUIRED');
  const original = String(text);
  const state = inspectN8nMarker(original);
  let result = original;
  if (change === 'add') {
    invariant(!state.dynamic && !state.legacy, 'n8n marker already exists; use migrate only for a legacy block.');
    result = `${N8N_DOMAIN_MARKERS.begin}\n${N8N_DOMAIN_BODY}\n${N8N_DOMAIN_MARKERS.end}\n${result}`;
  } else if (change === 'remove') {
    invariant(state.dynamic || state.legacy, 'No n8n marker exists to remove.');
    result = removeMarkedBlock(result, state.dynamic ? N8N_DOMAIN_MARKERS : LEGACY_N8N_MARKERS);
  } else {
    invariant(state.legacy && !state.dynamic, 'Migration requires exactly one legacy n8n marker and no dynamic marker.');
    const start = result.indexOf(LEGACY_N8N_MARKERS.begin);
    const end = result.indexOf(LEGACY_N8N_MARKERS.end, start) + LEGACY_N8N_MARKERS.end.length;
    const replacement = `${N8N_DOMAIN_MARKERS.begin}\n${N8N_DOMAIN_BODY}\n${N8N_DOMAIN_MARKERS.end}`;
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  invariant(result !== original, 'Marker change produced no update.');
  return { content: result, originalDigest: sha256(original), updatedDigest: sha256(result), change };
}

function assertWriteGate(questionBank, answers, proposedWrite) {
  validateReconciliationAnswers(questionBank, answers);
  requireObject(proposedWrite, 'Proposed write');
  assertAllowedKeys(proposedWrite, new Set(['kind', 'target', 'context']), 'Proposed write');
  requireString(proposedWrite.kind, 'proposedWrite.kind', { pattern: ALIAS_PATTERN });
  requireString(proposedWrite.target, 'proposedWrite.target', { max: 500 });
  requireObject(proposedWrite.context, 'proposedWrite.context');
  requireObject(proposedWrite.context.proposedWrite, 'proposedWrite.context.proposedWrite');
  invariant(sha256(proposedWrite.context) === questionBank.contextDigest, 'Proposed write does not match the question-bank context.', 'EXTERNAL_WRITE_CONTEXT_MISMATCH');
  invariant(proposedWrite.context.proposedWrite.kind === proposedWrite.kind && proposedWrite.context.proposedWrite.target === proposedWrite.target, 'Proposed write kind or target differs from the approved context.', 'EXTERNAL_WRITE_CONTEXT_MISMATCH');
  assertNoSecretMaterial(proposedWrite.context, 'Proposed write context');
  const answerRules = {
    'target-registration': () => answers.answers.targetRegistration === true
      || answers.answers.targetRegistration === proposedWrite.target
      || answers.answers.targetRegistration === 'approve:target-registration',
    'credential-reference': () => CREDENTIAL_REFERENCE_PATTERN.test(proposedWrite.target)
      && CREDENTIAL_REFERENCE_PATTERN.test(String(answers.answers.credentialReference || ''))
      && answers.answers.credentialReference === proposedWrite.target,
    'browser-fallback': () => answers.answers.browserFallbackAllowed === true,
    'marker-change': () => answers.answers.markerChange === true
      || answers.answers.markerChange === proposedWrite.target
      || answers.answers.markerChange === `approve:${proposedWrite.target}`
  };
  invariant(answerRules[proposedWrite.kind], `Proposed write kind ${proposedWrite.kind} has no reconciliation-answer binding.`, 'EXTERNAL_WRITE_APPROVAL_REQUIRED');
  invariant(answerRules[proposedWrite.kind](), `Reconciliation answers explicitly decline or do not authorise ${proposedWrite.kind}.`, 'EXTERNAL_WRITE_APPROVAL_REQUIRED');
  return {
    approved: true,
    kind: proposedWrite.kind,
    target: proposedWrite.target,
    ownerApprovalReference: answers.ownerApprovalReference,
    questionBankDigest: questionBank.questionBankDigest,
    contextDigest: questionBank.contextDigest
  };
}

function operationReceiptRouteDigest(receipt) {
  return sha256({
    authorisationEnvelopeDigest: receipt.authorisationEnvelopeDigest,
    provider: receipt.provider,
    targetAlias: receipt.targetAlias,
    accountOrOrganisation: receipt.accountOrOrganisation,
    resource: receipt.resource,
    targetFingerprint: receipt.targetFingerprint,
    environment: receipt.environment,
    operation: receipt.operation,
    operationSemanticsVersion: receipt.operationSemanticsVersion,
    operationSemanticsDigest: receipt.operationSemanticsDigest,
    mutationClass: receipt.mutationClass,
    receiptClass: receipt.receiptClass,
    finalRiskTier: receipt.riskTier,
    selectedAuditReadOnly: receipt.selectedAuditReadOnly,
    taskId: receipt.taskId,
    sessionFingerprint: receipt.sessionFingerprint,
    objectiveDigest: receipt.objectiveDigest,
    inventoryAuthorityId: receipt.inventoryAuthorityId,
    inventorySourceDigest: receipt.inventorySourceDigest,
    inventoryGeneration: receipt.inventoryGeneration,
    inventoryDigest: receipt.inventoryDigest,
    hostAdapterPlanDigest: receipt.hostAdapterPlanDigest || null,
    selectedInterface: receipt.selectedInterface,
    capabilityDigest: receipt.capabilityDigest
  });
}

function validateOperationReceipt(receipt, binding = {}) {
  requireObject(receipt, 'Operation receipt');
  const allowed = new Set([
    'schemaVersion', 'operationId', 'operation', 'provider', 'adapter', 'targetAlias', 'accountOrOrganisation',
    'resource', 'targetFingerprint', 'environment', 'riskTier', 'authorisationReference',
    'operationSemanticsVersion', 'operationSemanticsDigest', 'mutationClass', 'receiptClass',
    'selectedAuditReadOnly', 'inventoryAuthorityId', 'inventorySourceDigest',
    'authorisationEnvelopeDigest', 'authorisationLifetimeKind', 'taskId', 'sessionFingerprint', 'objectiveDigest',
    'selectedInterface', 'capabilityDigest', 'inventoryGeneration', 'inventoryDigest', 'hostAdapterPlanDigest',
    'selectedRouteDigest', 'precondition',
    'preconditionEvidence', 'postconditionEvidence', 'rollbackEvidence',
    'mutationAttempted', 'mutationPerformed', 'postcondition', 'rollbackAttempted', 'rollbackPerformed',
    'stableCode', 'safeEvidenceReferences', 'supportedNextAction', 'unchangedScope'
  ]);
  assertAllowedKeys(receipt, allowed, 'Operation receipt');
  invariant(receipt.schemaVersion === RECEIPT_SCHEMA_VERSION, 'Unsupported operation-receipt schema.');
  for (const field of [
    'operationId', 'operation', 'adapter', 'targetAlias', 'accountOrOrganisation', 'resource',
    'environment', 'selectedInterface'
  ]) requireString(receipt[field], field, { pattern: ALIAS_PATTERN });
  requireString(receipt.provider, 'provider', { pattern: PROVIDER_PATTERN });
  requireString(receipt.targetFingerprint, 'targetFingerprint', { pattern: DIGEST_PATTERN });
  requireString(receipt.authorisationEnvelopeDigest, 'authorisationEnvelopeDigest', { pattern: DIGEST_PATTERN });
  invariant(receipt.operationSemanticsVersion === OPERATION_SEMANTICS_SCHEMA_VERSION,
    'Operation receipt semantics version is invalid.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  requireString(receipt.operationSemanticsDigest, 'operationSemanticsDigest', { pattern: DIGEST_PATTERN });
  invariant(['read-only', 'mutation'].includes(receipt.mutationClass),
    'Operation receipt mutationClass is invalid.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  invariant(['inspection', 'mutation', 'destructive'].includes(receipt.receiptClass),
    'Operation receipt receiptClass is invalid.', 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  invariant(typeof receipt.selectedAuditReadOnly === 'boolean'
    && receipt.selectedAuditReadOnly === (receipt.mutationClass === 'read-only')
    && (receipt.receiptClass === 'inspection') === receipt.selectedAuditReadOnly,
  'Operation receipt mutability disagrees with the selected audit or receipt class.',
  'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  requireString(receipt.inventoryAuthorityId, 'inventoryAuthorityId', { pattern: DIGEST_PATTERN });
  requireString(receipt.inventorySourceDigest, 'inventorySourceDigest', { pattern: DIGEST_PATTERN });
  invariant(['task', 'time-bounded'].includes(receipt.authorisationLifetimeKind), 'Unsupported authorisationLifetimeKind.');
  if (receipt.authorisationLifetimeKind === 'task') {
    requireString(receipt.taskId, 'taskId', { pattern: ALIAS_PATTERN });
    requireString(receipt.sessionFingerprint, 'sessionFingerprint', { pattern: DIGEST_PATTERN });
    requireString(receipt.objectiveDigest, 'objectiveDigest', { pattern: DIGEST_PATTERN });
  } else {
    for (const field of ['taskId', 'sessionFingerprint', 'objectiveDigest']) {
      invariant(receipt[field] === undefined, `Time-bounded receipt must not declare ${field}.`);
    }
  }
  requireString(receipt.capabilityDigest, 'capabilityDigest', { pattern: DIGEST_PATTERN });
  requireString(receipt.inventoryGeneration, 'inventoryGeneration', { pattern: DIGEST_PATTERN });
  requireString(receipt.inventoryDigest, 'inventoryDigest', { pattern: DIGEST_PATTERN });
  if (receipt.hostAdapterPlanDigest !== undefined) requireString(receipt.hostAdapterPlanDigest, 'hostAdapterPlanDigest', { pattern: DIGEST_PATTERN });
  requireString(receipt.selectedRouteDigest, 'selectedRouteDigest', { pattern: DIGEST_PATTERN });
  invariant(receipt.selectedRouteDigest === operationReceiptRouteDigest(receipt), 'Operation receipt selected-route binding is invalid.', 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
  if (binding.authorisationEnvelope) {
    invariant(receipt.authorisationEnvelopeDigest === sha256(binding.authorisationEnvelope), 'Operation receipt does not match the authorisation envelope.', 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
    invariant(receipt.authorisationLifetimeKind === binding.authorisationEnvelope.lifetime.kind,
      'Operation receipt lifetime kind does not match the authorisation envelope.', 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
    if (binding.authorisationEnvelope.lifetime.kind === 'task') {
      for (const field of ['taskId', 'sessionFingerprint', 'objectiveDigest']) {
        invariant(receipt[field] === binding.authorisationEnvelope.lifetime[field],
          `Operation receipt ${field} does not match the task authorisation envelope.`, 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
      }
    }
  }
  if (binding.operationContext) {
    for (const field of [
      'provider', 'targetAlias', 'accountOrOrganisation', 'resource', 'targetFingerprint', 'environment',
      'operation', 'inventoryGeneration', 'inventoryDigest'
    ]) {
      invariant(receipt[field] === binding.operationContext[field], `Operation receipt ${field} does not match the completed operation.`, 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
    }
    if (receipt.authorisationLifetimeKind === 'task') {
      for (const field of ['taskId', 'sessionFingerprint', 'objectiveDigest']) {
        invariant(receipt[field] === binding.operationContext[field],
          `Operation receipt ${field} does not match the completed task.`, 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
      }
    }
  }
  if (binding.selectedRoute) {
    for (const field of [
      'operationSemanticsVersion', 'operationSemanticsDigest', 'mutationClass', 'receiptClass',
      'selectedAuditReadOnly', 'selectedInterface', 'capabilityDigest',
      'inventoryGeneration', 'inventoryDigest', 'selectedRouteDigest'
    ]) {
      invariant(receipt[field] === binding.selectedRoute[field],
        `Operation receipt ${field} does not match the selected route.`, 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
    }
    invariant((receipt.hostAdapterPlanDigest || null) === (binding.selectedRoute.hostAdapterPlanDigest || null),
      'Operation receipt host adapter plan does not match the selected route.', 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
    invariant(receipt.inventoryAuthorityId === binding.selectedRoute.snapshotAuthorityId
      && receipt.inventorySourceDigest === binding.selectedRoute.inventorySourceDigest,
    'Operation receipt inventory authority does not match the selected route.',
    'EXTERNAL_RECEIPT_BINDING_MISMATCH');
    invariant(receipt.riskTier === binding.selectedRoute.finalRiskTier,
      'Operation receipt risk does not match final route authorisation.',
      'EXTERNAL_RECEIPT_BINDING_MISMATCH');
  }
  invariant(Number.isInteger(receipt.riskTier) && receipt.riskTier >= 0 && receipt.riskTier <= 3, 'riskTier must be 0-3.');
  requireString(receipt.authorisationReference, 'authorisationReference', { max: 200 });
  invariant(['passed', 'failed', 'not-applicable'].includes(receipt.precondition), 'Unsupported precondition state.');
  invariant(typeof receipt.mutationAttempted === 'boolean' && typeof receipt.mutationPerformed === 'boolean', 'Mutation fields must be boolean.');
  if (receipt.mutationClass === 'read-only') {
    invariant(receipt.mutationAttempted === false && receipt.mutationPerformed === false,
      'A read-only operation receipt cannot record mutation activity.',
      'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  }
  invariant(!receipt.mutationPerformed || receipt.mutationAttempted, 'A mutation cannot be performed when none was attempted.');
  invariant(['passed', 'failed', 'not-run', 'not-applicable'].includes(receipt.postcondition), 'Unsupported postcondition state.');
  invariant(typeof receipt.rollbackAttempted === 'boolean' && typeof receipt.rollbackPerformed === 'boolean', 'Rollback fields must be boolean.');
  invariant(!receipt.rollbackPerformed || receipt.rollbackAttempted, 'Rollback cannot be performed when none was attempted.');
  requireString(receipt.stableCode, 'stableCode', { pattern: /^[A-Z][A-Z0-9_]{2,127}$/ });
  const evidence = requireStringArray(receipt.safeEvidenceReferences, 'safeEvidenceReferences', { unique: true, pattern: /^(digest|receipt|test|public-doc|github-check):[a-zA-Z0-9._/-]+$/ });
  invariant(evidence.length <= 20, 'safeEvidenceReferences must remain bounded.');
  for (const field of ['preconditionEvidence', 'postconditionEvidence', 'rollbackEvidence']) {
    requireStringArray(receipt[field], field, {
      min: 1, unique: true, pattern: /^(digest|receipt|test|public-doc|github-check):[a-zA-Z0-9._/-]+$/
    });
  }
  requireString(receipt.supportedNextAction, 'supportedNextAction', { max: 300 });
  requireStringArray(receipt.unchangedScope, 'unchangedScope', { min: 1, unique: true, max: 200 });
  assertNoSecretMaterial(receipt, 'Operation receipt');
  return receipt;
}

function createOperationReceipt(input) {
  const envelope = input.authorisationEnvelope;
  const route = input.selectedRoute;
  const routeAuthority = SELECTED_ROUTE_AUTHORITIES.get(route);
  invariant(routeAuthority, 'Operation receipt requires one current loader-authorised selected route.',
    'EXTERNAL_ROUTE_AUTHORITY_REQUIRED');
  revalidateInventoryAuthority(routeAuthority.authority);
  invariant(envelope && sha256(envelope) === routeAuthority.envelopeDigest,
    'Operation receipt envelope differs from route authorisation.', 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
  for (const field of [
    'provider', 'targetAlias', 'accountOrOrganisation', 'resource', 'environment', 'operation',
    'targetFingerprint'
  ]) {
    invariant(input[field] === routeAuthority.operationContext[field],
      `Operation receipt ${field} differs from selected-route authority.`,
      'EXTERNAL_RECEIPT_BINDING_MISMATCH');
  }
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    operationId: input.operationId,
    operation: input.operation,
    provider: input.provider,
    adapter: input.adapter,
    targetAlias: input.targetAlias,
    accountOrOrganisation: input.accountOrOrganisation,
    resource: input.resource,
    targetFingerprint: input.targetFingerprint,
    environment: input.environment,
    riskTier: route.finalRiskTier,
    operationSemanticsVersion: route.operationSemanticsVersion,
    operationSemanticsDigest: route.operationSemanticsDigest,
    mutationClass: route.mutationClass,
    receiptClass: route.receiptClass,
    selectedAuditReadOnly: route.selectedAuditReadOnly,
    inventoryAuthorityId: route.snapshotAuthorityId,
    inventorySourceDigest: route.inventorySourceDigest,
    authorisationReference: input.authorisationReference,
    authorisationEnvelopeDigest: input.authorisationEnvelopeDigest
      || (envelope ? sha256(envelope) : undefined),
    authorisationLifetimeKind: input.authorisationLifetimeKind || envelope?.lifetime?.kind,
    taskId: input.taskId || envelope?.lifetime?.taskId,
    sessionFingerprint: input.sessionFingerprint || envelope?.lifetime?.sessionFingerprint,
    objectiveDigest: input.objectiveDigest || envelope?.lifetime?.objectiveDigest,
    selectedInterface: route.selectedInterface,
    capabilityDigest: route.capabilityDigest,
    inventoryGeneration: route.inventoryGeneration,
    inventoryDigest: route.inventoryDigest,
    hostAdapterPlanDigest: route.hostAdapterPlanDigest || undefined,
    selectedRouteDigest: input.selectedRouteDigest || route.selectedRouteDigest,
    precondition: input.precondition,
    preconditionEvidence: input.preconditionEvidence,
    mutationAttempted: input.mutationAttempted,
    mutationPerformed: input.mutationPerformed,
    postcondition: input.postcondition,
    postconditionEvidence: input.postconditionEvidence,
    rollbackAttempted: input.rollbackAttempted,
    rollbackPerformed: input.rollbackPerformed,
    rollbackEvidence: input.rollbackEvidence,
    stableCode: input.stableCode,
    safeEvidenceReferences: input.safeEvidenceReferences || [],
    supportedNextAction: input.supportedNextAction,
    unchangedScope: input.unchangedScope
  };
  if (!receipt.selectedRouteDigest) receipt.selectedRouteDigest = operationReceiptRouteDigest(receipt);
  return validateOperationReceipt(receipt, {
    authorisationEnvelope: envelope,
    operationContext: routeAuthority.operationContext,
    selectedRoute: route
  });
}

function evaluateRouteLifecycle(record) {
  requireObject(record, 'Route lifecycle record');
  const allowed = new Set([
    'schemaVersion', 'provider', 'targetAlias', 'environment', 'operation', 'previousRoute', 'candidateRoute',
    'driftDetected', 'semanticReview', 'syntheticTests', 'nativeUat', 'ownerApprovedMigration', 'observation',
    'previousRouteRetained', 'automaticCredentialRevocation', 'laterRemovalApprovalReference'
  ]);
  assertAllowedKeys(record, allowed, 'Route lifecycle record');
  invariant(record.schemaVersion === ROUTE_LIFECYCLE_SCHEMA_VERSION, 'Unsupported route-lifecycle schema.');
  requireString(record.provider, 'provider', { pattern: PROVIDER_PATTERN });
  for (const field of ['targetAlias', 'environment', 'operation', 'previousRoute', 'candidateRoute']) requireString(record[field], field, { pattern: ALIAS_PATTERN });
  invariant(typeof record.driftDetected === 'boolean', 'driftDetected must be boolean.');
  for (const field of ['semanticReview', 'syntheticTests', 'nativeUat']) invariant(['passed', 'failed', 'pending'].includes(record[field]), `${field} has an unsupported state.`);
  invariant(typeof record.ownerApprovedMigration === 'boolean', 'ownerApprovedMigration must be boolean.');
  invariant(['pending', 'in-progress', 'passed', 'failed'].includes(record.observation), 'observation has an unsupported state.');
  invariant(record.automaticCredentialRevocation === false, 'Credential revocation must never be automatic.', 'EXTERNAL_AUTOMATIC_REVOCATION_FORBIDDEN');
  const preMigrationPassed = record.driftDetected
    && record.semanticReview === 'passed'
    && record.syntheticTests === 'passed'
    && record.nativeUat === 'passed'
    && record.ownerApprovedMigration;
  if (!preMigrationPassed) invariant(record.previousRouteRetained === true, 'Previous route must remain until semantic review, synthetic tests, native UAT, and owner approval pass.');
  if (record.observation !== 'passed') invariant(record.previousRouteRetained === true, 'Previous route must remain through the observation period.');
  if (!record.previousRouteRetained) requireString(record.laterRemovalApprovalReference, 'laterRemovalApprovalReference', { max: 200 });
  return {
    operation: record.operation,
    migrationMayProceed: preMigrationPassed,
    candidateMayBecomePreferred: preMigrationPassed && ['in-progress', 'passed'].includes(record.observation),
    previousRouteMayBeRemoved: preMigrationPassed && record.observation === 'passed' && Boolean(record.laterRemovalApprovalReference),
    automaticCredentialRevocation: false,
    retainPreviousRoute: !preMigrationPassed || record.observation !== 'passed' || !record.laterRemovalApprovalReference
  };
}

function sanitizeDriftEvidence(evidence) {
  requireObject(evidence, 'Drift evidence');
  assertAllowedKeys(evidence, new Set([
    'kind', 'key', 'previousDigest', 'currentDigest', 'publicReference', 'detectedAt', 'material'
  ]), 'Drift evidence');
  invariant(['upstream-release', 'tool-schema', 'provider-version', 'source-lock', 'adapter-version', 'repository-requirement', 'stale-audit'].includes(evidence.kind), 'Unsupported drift-evidence kind.');
  requireString(evidence.key, 'key', { pattern: ALIAS_PATTERN });
  if (evidence.previousDigest !== undefined) requireString(evidence.previousDigest, 'previousDigest', { pattern: DIGEST_PATTERN });
  requireString(evidence.currentDigest, 'currentDigest', { pattern: DIGEST_PATTERN });
  if (evidence.publicReference !== undefined) {
    requireString(evidence.publicReference, 'publicReference', { max: 500 });
    invariant(isPublicHttpsReference(evidence.publicReference), 'Drift publicReference must be a credential-free public HTTPS reference without query or fragment data.');
  }
  invariant(Number.isFinite(Date.parse(requireString(evidence.detectedAt, 'detectedAt'))), 'detectedAt must be an ISO date-time.');
  invariant(typeof evidence.material === 'boolean', 'material must be boolean.');
  assertNoSecretMaterial(evidence, 'Drift evidence');
  return evidence;
}

function deduplicateDriftEvidence(evidence, previousFindingDigests = []) {
  invariant(Array.isArray(evidence), 'evidence must be an array.');
  const previous = new Set(previousFindingDigests);
  const findings = [];
  for (const entry of evidence.map(sanitizeDriftEvidence)) {
    if (!entry.material || entry.previousDigest === entry.currentDigest) continue;
    const findingDigest = sha256({
      kind: entry.kind,
      key: entry.key,
      previousDigest: entry.previousDigest || null,
      currentDigest: entry.currentDigest,
      publicReference: entry.publicReference || null
    });
    if (!previous.has(findingDigest)) findings.push({ ...entry, findingDigest });
  }
  return {
    newMaterialFindings: findings,
    findingDigests: findings.map((entry) => entry.findingDigest),
    noAction: findings.length === 0
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return [
    'External System Router (repository-only helper)',
    '',
    'Read-only commands:',
    '  node scripts/external-system-router.cjs validate-envelope <file>',
    '  node scripts/external-system-router.cjs validate-manifest <file>',
    '  node scripts/external-system-router.cjs validate-registry <file>',
    '  node scripts/external-system-router.cjs validate-receipt <file>',
    '  node scripts/external-system-router.cjs reconcile <input-file>',
    '',
    'This helper does not call providers, browsers, MCP servers, CLIs, or credential stores.'
  ].join('\n');
}

function runCli(argv) {
  const [command, file] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  invariant(file, `${command} requires a JSON input file.`);
  const input = readJson(path.resolve(file));
  const handlers = {
    'validate-envelope': validateAuthorizationEnvelope,
    'validate-manifest': validateConsumerRequirements,
    'validate-registry': validateProviderTargetRegistry,
    'validate-receipt': validateOperationReceipt,
    reconcile: (value) => reconcileCapabilities(value)
  };
  invariant(handlers[command], `Unknown command ${command}.`);
  printJson(handlers[command](input));
  return 0;
}

module.exports = {
  ENVELOPE_SCHEMA_VERSION,
  CONSUMER_SCHEMA_VERSION,
  REGISTRY_SCHEMA_VERSION,
  AUDIT_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSION,
  RECEIPT_SCHEMA_VERSION,
  ROUTE_LIFECYCLE_SCHEMA_VERSION,
  HOST_ADAPTER_PLAN_SCHEMA_VERSION,
  INVENTORY_AUTHORITY_SCHEMA_VERSION,
  OPERATION_SEMANTICS_SCHEMA_VERSION,
  ROUTER_VERSION,
  QUESTION_BANK_SCHEMA_VERSION,
  ANSWER_SCHEMA_VERSION,
  ALIAS_PATTERN_SOURCE,
  INTERFACE_RESTRICTION_PATTERN_SOURCE,
  RISK_TIERS,
  RECONCILIATION_TRIGGERS,
  HISTORY_SAFER_PATHS,
  N8N_DOMAIN_MARKERS,
  N8N_DOMAIN_BODY,
  sha256,
  objectiveAuthorityDigest,
  operationSemanticsDigest,
  validateOperationSemantics,
  capabilityAuditDigest,
  assertNoSecretMaterial,
  isPublicHttpsOrigin,
  isPublicHttpsReference,
  validateAuthorizationEnvelope,
  classifyRisk,
  operationApprovalBinding,
  assertOperationAuthorized,
  validateGraphicalDisclosure,
  renderGraphicalApprovalQuestion,
  bindGraphicalApproval,
  validateHistoryDiscovery,
  validateCapabilityAudit,
  targetBindingDigest,
  targetInventoryDigest,
  hostAdapterPlanDigest,
  validateHostAdapterPlan,
  loadTrustedInventorySnapshot,
  selectStrongestAdmissibleInterface,
  validateConsumerRequirements,
  defaultRegistryPath,
  defaultLocalStatePaths,
  validateProviderTargetRegistry,
  resolveProviderTarget,
  buildHostAdapterPlan,
  recommendN8nComponents,
  inferIntentCapabilities,
  inferRepositoryCapabilities,
  reconcileCapabilities,
  buildCapabilityLedger,
  validateCapabilityLedger,
  assertObjectiveComplete,
  buildReconciliationQuestionBank,
  validateReconciliationQuestionBank,
  validateReconciliationAnswers,
  inspectN8nMarker,
  applyN8nMarkerChange,
  assertWriteGate,
  validateOperationReceipt,
  operationReceiptRouteDigest,
  createOperationReceipt,
  evaluateRouteLifecycle,
  sanitizeDriftEvidence,
  deduplicateDriftEvidence,
  usage,
  runCli
};

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.code || 'EXTERNAL_ROUTER_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
