'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DECISIONS = Object.freeze(['allow', 'ask', 'deny', 'unsupported']);
const DECISION_RANK = Object.freeze({ allow: 0, ask: 1, unsupported: 2, deny: 3 });
const DECISION_PRECEDENCE = Object.freeze(['deny', 'unsupported', 'ask', 'allow']);
const ENFORCEMENT_REQUIREMENTS = Object.freeze([
  'routine-repository-authority',
  'trusted-one-shot-approval',
  'hard-deny',
  'stop-before-execution',
]);

const POLICY_PATH = path.resolve(__dirname, '..', '..', '..', '_projects', 'development', 'toolkit-guardrails', '_main', 'guardrail-policy.json');

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : stableStringify(value), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validatePolicyShape(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('POLICY_INVALID');
  if (policy.schema_version !== 'toolkit.guardrail.policy.v1') throw new Error('POLICY_SCHEMA_VERSION_INVALID');
  if (policy.design_lock !== 'DL-313-001' || policy.issue !== 313) throw new Error('POLICY_AUTHORITY_INVALID');
  if (stableStringify(policy.decision_contract) !== stableStringify(DECISIONS)) throw new Error('POLICY_DECISION_CONTRACT_INVALID');
  if (stableStringify(policy.decision_precedence) !== stableStringify(DECISION_PRECEDENCE)) throw new Error('POLICY_PRECEDENCE_INVALID');
  if (!Array.isArray(policy.operation_classes) || policy.operation_classes.length < 10) throw new Error('POLICY_OPERATION_CLASSES_INVALID');
  if (!Array.isArray(policy.reason_codes) || policy.reason_codes.length < 20) throw new Error('POLICY_REASON_CODES_INVALID');
  for (const entry of policy.operation_classes) {
    if (!entry || typeof entry.id !== 'string' || !DECISIONS.includes(entry.default_decision)) throw new Error('POLICY_OPERATION_CLASS_INVALID');
    if (!ENFORCEMENT_REQUIREMENTS.includes(entry.enforcement_requirement)) throw new Error('POLICY_ENFORCEMENT_INVALID');
  }
  return policy;
}

function loadPolicy(policyPath = POLICY_PATH, options = {}) {
  const readFile = options.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  const parsed = JSON.parse(readFile(policyPath));
  return deepFreeze(validatePolicyShape(parsed));
}

let cachedPolicy;
function getPolicy() {
  if (!cachedPolicy) cachedPolicy = loadPolicy();
  return cachedPolicy;
}

function decisionRank(decision) {
  return DECISION_RANK[decision] ?? DECISION_RANK.unsupported;
}

function mostRestrictive(decisions) {
  return decisions.reduce((current, candidate) => (
    decisionRank(candidate) > decisionRank(current) ? candidate : current
  ), 'allow');
}

function reasonCode(value, fallback = 'ENGINE_FAILURE_UNSUPPORTED') {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value) ? value : fallback;
}

module.exports = {
  DECISIONS,
  DECISION_PRECEDENCE,
  ENFORCEMENT_REQUIREMENTS,
  POLICY_PATH,
  stableValue,
  stableStringify,
  sha256,
  clone,
  deepFreeze,
  validatePolicyShape,
  loadPolicy,
  getPolicy,
  decisionRank,
  mostRestrictive,
  reasonCode,
};
