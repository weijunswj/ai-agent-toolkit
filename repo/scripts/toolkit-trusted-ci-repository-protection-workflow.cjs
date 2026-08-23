'use strict';

const crypto = require('node:crypto');
const protection = require('./toolkit-trusted-ci-repository-protection.cjs');

const CONTRACT_VERSION = 'toolkit.n6.protected-ci-gate-workflow.v1';
const WORKFLOW_ID = 'n6-protected-ci-gate';
const WORKFLOW_NAME = 'CI Gate';
const BASE_REF = 'refs/heads/main';
const ALLOWED_TRIGGERS = Object.freeze(['pull_request_target', 'merge_group']);
const REQUIRED_PERMISSIONS = Object.freeze({ contents: 'read', actions: 'read', checks: 'read' });
const ALLOWED_ACTIONS = Object.freeze(['actions/checkout@v4']);
const MAX_COMPOSITION_INPUT_BYTES = 4 * 1024 * 1024;
const COMPOSITION_INPUT_PATH = '$RUNNER_TEMP/n6-protected-ci-input.json';
const PROTECTED_COMPONENT_PRODUCER = 'non-authoritative-diagnostic';
const REQUIRED_STEPS = Object.freeze(['validate-protected-workflow', 'git-diff-check']);
const COMPOSITION_INPUT_KEYS = Object.freeze([
  'repository_id',
  'pr',
  'head_sha',
  'base_sha',
  'merge_sha',
  'changed_paths',
  'component_results',
  'evidence',
  'evidence_archive',
  'non_ci_evidence',
]);
const FORBIDDEN_TRIGGERS = Object.freeze([
  'pull_request',
  'push',
  'workflow_dispatch',
  'workflow_run',
  'workflow_call',
  'schedule',
  'issue_comment',
  'repository_dispatch',
]);
const FAILURE_CODES = Object.freeze([
  'WORKFLOW_INVALID',
  'WORKFLOW_SOURCE_UNTRUSTED',
  'WORKFLOW_TRIGGER_FORBIDDEN',
  'WORKFLOW_PERMISSION_FORBIDDEN',
  'WORKFLOW_CANDIDATE_CODE',
  'WORKFLOW_ACTION_FORBIDDEN',
  'WORKFLOW_IDENTITY_MISMATCH',
  'WORKFLOW_BASE_MISMATCH',
  'WORKFLOW_NON_AUTHORITATIVE',
  'WORKFLOW_EVIDENCE_INVALID',
  'WORKFLOW_COVERAGE_INVALID',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function failure(code, details = {}) {
  return { ...details, ok: false, status: 'blocked', code: String(code).toUpperCase() };
}

function success(data = {}) {
  return { ok: true, status: 'valid', ...data };
}

function isSafeText(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeSourceText(value, max = 128 * 1024) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function sha1(value) {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex');
}

function sourceLines(source) {
  return source.replace(/\r\n/g, '\n').split('\n');
}

function triggerKeys(source) {
  const lines = sourceLines(source);
  const onIndex = lines.findIndex((line) => /^on:\s*$/.test(line.trim()));
  if (onIndex < 0) return [];
  const triggers = [];
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*$/.test(line.trim()) && !/^\s+/.test(line)) break;
    const match = line.match(/^\s{2}([A-Za-z][A-Za-z0-9_-]*):\s*(?:#.*)?$/);
    if (match) triggers.push(match[1]);
  }
  return [...new Set(triggers)];
}

function validateWorkflowSource(source) {
  if (!isSafeSourceText(source)) return failure('WORKFLOW_INVALID');
  const normalized = source.replace(/\r\n/g, '\n');
  if (!/^name:\s*CI Gate\s*$/m.test(normalized)
    || !/^on:\s*$/m.test(normalized)
    || !/^permissions:\s*$/m.test(normalized)
    || !/^jobs:\s*$/m.test(normalized)
    || !/^\s{2}ci-gate:\s*$/m.test(normalized)) return failure('WORKFLOW_INVALID');

  const triggers = triggerKeys(normalized);
  if (triggers.length === 0 || triggers.some((trigger) => !ALLOWED_TRIGGERS.includes(trigger))) return failure('WORKFLOW_TRIGGER_FORBIDDEN', { triggers });
  if (FORBIDDEN_TRIGGERS.some((trigger) => triggers.includes(trigger))) return failure('WORKFLOW_TRIGGER_FORBIDDEN', { triggers });

  for (const [permission, level] of Object.entries(REQUIRED_PERMISSIONS)) {
    const permissionPattern = new RegExp(`^\\s{2}${permission}:\\s*${level}\\s*$`, 'm');
    if (!permissionPattern.test(normalized)) return failure('WORKFLOW_PERMISSION_FORBIDDEN', { permission });
  }
  if (/^\s{2,}[A-Za-z0-9_-]+:\s*(?:write|write-all)\s*$/m.test(normalized)
    || /permissions:\s*write-all/.test(normalized)) return failure('WORKFLOW_PERMISSION_FORBIDDEN');
  if (/secrets\.|github\.token|ACTIONS_RUNTIME_TOKEN|NODE_AUTH_TOKEN/i.test(normalized)) return failure('WORKFLOW_PERMISSION_FORBIDDEN');
  if (/pull_request\.(?:head|head_ref|head_sha)|github\.head_ref|github\.event\.pull_request\.head/i.test(normalized)) return failure('WORKFLOW_CANDIDATE_CODE');
  if (/candidate-owned|candidate_owned|untrusted[-_ ]checkout|checkout[-_ ]head/i.test(normalized)) return failure('WORKFLOW_CANDIDATE_CODE');
  if (/\bgit\s+(?:commit|push|tag)\b|\bgh\s+(?:api|pr|repo)\b/i.test(normalized)) return failure('WORKFLOW_CANDIDATE_CODE');
  if (/continue-on-error:\s*true|\|\|\s*true|allow[-_ ]failure/i.test(normalized)) return failure('WORKFLOW_INVALID');
  if (/--produce-composition|--validate-composition|n6-protected-ci-input|GITHUB_EVENT_PATH|n6_changed_paths/i.test(normalized)) return failure('WORKFLOW_NON_AUTHORITATIVE');

  const actions = [...normalized.matchAll(/^\s+uses:\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
  if (actions.some((action) => !ALLOWED_ACTIONS.includes(action))) return failure('WORKFLOW_ACTION_FORBIDDEN', { actions });
  if (actions.length !== ALLOWED_ACTIONS.length || actions[0] !== ALLOWED_ACTIONS[0]) return failure('WORKFLOW_ACTION_FORBIDDEN', { actions });
  if (!/^\s{10}persist-credentials:\s*false\s*$/m.test(normalized)) return failure('WORKFLOW_CANDIDATE_CODE');
  if (!/^\s{10}ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}\s*$/m.test(normalized)) return failure('WORKFLOW_BASE_MISMATCH');
  if (!/^\s{2}ci-gate:\s*\n(?:.*\n)*?\s{4}name:\s*CI Gate\s*$/m.test(normalized)
    || !/^\s{4}runs-on:\s*[A-Za-z0-9_.-]+\s*$/m.test(normalized)
    || !/^\s{4}steps:\s*$/m.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/^\s{6}- name:\s*Validate protected workflow contract\s*$/m.test(normalized)
    || !/^\s{6}- name:\s*Check repository diff hygiene\s*$/m.test(normalized)
    || !/git diff --check/.test(normalized)
    || !/toolkit-trusted-ci-repository-protection-workflow\.cjs --validate-source/.test(normalized)) return failure('WORKFLOW_INVALID');
  return success({ source: normalized, triggers, actions, diagnostic_only: true });
}

function validateWorkflowContract(contract) {
  const keys = ['contract_version', 'workflow_id', 'workflow_name', 'base_ref', 'allowed_triggers', 'forbidden_triggers', 'candidate_code_execution', 'permissions', 'publisher', 'actions', 'checkout', 'required_steps', 'diagnostic_only', 'secrets', 'statuses'];
  if (!exactKeys(contract, keys)
    || contract.contract_version !== CONTRACT_VERSION
    || contract.workflow_id !== WORKFLOW_ID
    || contract.workflow_name !== WORKFLOW_NAME
    || contract.base_ref !== BASE_REF
    || !Array.isArray(contract.allowed_triggers)
    || !Array.isArray(contract.forbidden_triggers)
    || contract.candidate_code_execution !== false
    || contract.diagnostic_only !== true
    || !isRecord(contract.permissions)
    || !exactKeys(contract.permissions, Object.keys(REQUIRED_PERMISSIONS))
    || !isRecord(contract.publisher)
    || contract.publisher.protocol_version !== protection.PUBLISHER_PROTOCOL_VERSION
    || contract.publisher.context !== protection.GATE_CONTEXT
    || !Array.isArray(contract.actions) || contract.actions.length !== 1 || contract.actions[0] !== ALLOWED_ACTIONS[0]
    || !exactKeys(contract.checkout, ['ref', 'persist_credentials', 'candidate_head_checkout'])
    || contract.checkout.ref !== 'github.event.repository.default_branch' || contract.checkout.persist_credentials !== false || contract.checkout.candidate_head_checkout !== false
    || !Array.isArray(contract.required_steps) || contract.required_steps.length !== REQUIRED_STEPS.length
    || contract.required_steps.some((step, index) => step !== REQUIRED_STEPS[index])
    || contract.secrets !== false || contract.statuses !== false) return failure('WORKFLOW_INVALID');
  if (contract.allowed_triggers.some((trigger) => !ALLOWED_TRIGGERS.includes(trigger))
    || contract.forbidden_triggers.some((trigger) => !FORBIDDEN_TRIGGERS.includes(trigger))) return failure('WORKFLOW_TRIGGER_FORBIDDEN');
  for (const [permission, level] of Object.entries(REQUIRED_PERMISSIONS)) if (contract.permissions[permission] !== level) return failure('WORKFLOW_PERMISSION_FORBIDDEN');
  return success({ contract: clone(contract), diagnostic_only: true });
}

function workflowIdentity(input) {
  const source = typeof input === 'string' ? input : input?.source;
  if (!isSafeSourceText(source)) return failure('WORKFLOW_INVALID');
  const validated = validateWorkflowSource(source);
  if (!validated.ok) return validated;
  const sourceSha = sha1(validated.source);
  if (typeof input === 'object' && input.source_sha !== undefined && input.source_sha !== sourceSha) return failure('WORKFLOW_SOURCE_UNTRUSTED');
  return success({ identity: WORKFLOW_ID, source_sha: sourceSha, base_ref: BASE_REF, candidate_owned: false, triggers: validated.triggers, diagnostic_only: true });
}

function validateProtectedWorkflow(input) {
  if (typeof input === 'string') return workflowIdentity(input);
  const keys = ['source', 'source_sha', 'base_ref', 'candidate_owned', 'workflow_identity'];
  if (!isRecord(input) || Object.keys(input).some((key) => !keys.includes(key))) return failure('WORKFLOW_INVALID');
  if (input.base_ref !== undefined && input.base_ref !== BASE_REF) return failure('WORKFLOW_BASE_MISMATCH');
  if (input.candidate_owned === true) return failure('WORKFLOW_SOURCE_UNTRUSTED');
  if (input.workflow_identity !== undefined && input.workflow_identity !== WORKFLOW_ID) return failure('WORKFLOW_IDENTITY_MISMATCH');
  return workflowIdentity(input);
}

function buildProtectedWorkflowTemplate() {
  return [
    'name: CI Gate',
    'run-name: CI Gate ${{ github.event.pull_request.number || github.run_id }}',
    'on:',
    '  pull_request_target:',
    '    types: [opened, synchronize, reopened]',
    '  merge_group:',
    'permissions:',
    '  contents: read',
    '  actions: read',
    '  checks: read',
    'jobs:',
    '  ci-gate:',
    '    name: CI Gate',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Checkout protected base',
    '        uses: actions/checkout@v4',
    '        with:',
    '          ref: ${{ github.event.repository.default_branch }}',
    '          fetch-depth: 1',
    '          persist-credentials: false',
    '      - name: Validate protected workflow contract',
    '        run: node repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs --validate-source',
    '      - name: Check repository diff hygiene',
    '        run: git diff --check',
    '',
  ].join('\n');
}

function validateGateInvocation() {
  return failure('WORKFLOW_NON_AUTHORITATIVE', { reason: 'protected workflow is diagnostic-only; server evidence is the sole authority' });
}

function validateSourceForCli(source = buildProtectedWorkflowTemplate()) {
  return validateProtectedWorkflow(source);
}

function validateCompositionForCli() {
  return failure('WORKFLOW_NON_AUTHORITATIVE');
}

function produceCompositionForCli() {
  return failure('WORKFLOW_NON_AUTHORITATIVE');
}

function readCompositionInputForCli() {
  return failure('WORKFLOW_NON_AUTHORITATIVE');
}

function readProtectedEventContext() {
  return failure('WORKFLOW_NON_AUTHORITATIVE');
}

function trustedChangedPaths() {
  return failure('WORKFLOW_NON_AUTHORITATIVE');
}

function contextWithChangedPaths() {
  return failure('WORKFLOW_NON_AUTHORITATIVE');
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  WORKFLOW_ID,
  WORKFLOW_NAME,
  BASE_REF,
  ALLOWED_TRIGGERS,
  REQUIRED_PERMISSIONS,
  ALLOWED_ACTIONS,
  MAX_COMPOSITION_INPUT_BYTES,
  COMPOSITION_INPUT_PATH,
  PROTECTED_COMPONENT_PRODUCER,
  REQUIRED_STEPS,
  COMPOSITION_INPUT_KEYS,
  FORBIDDEN_TRIGGERS,
  FAILURE_CODES,
  validateWorkflowSource,
  validateWorkflowContract,
  workflowIdentity,
  validateProtectedWorkflow,
  validateWorkflow: validateProtectedWorkflow,
  buildProtectedWorkflowTemplate,
  renderProtectedWorkflowTemplate: buildProtectedWorkflowTemplate,
  validateGateInvocation,
  validateProtectedGate: validateGateInvocation,
  validateSourceForCli,
  validateCompositionForCli,
  readCompositionInputForCli,
  readProtectedEventContext,
  trustedChangedPaths,
  contextWithChangedPaths,
  produceCompositionForCli,
});

if (require.main === module) {
  const argument = process.argv[2];
  const result = argument === '--validate-source' ? validateSourceForCli() : failure('WORKFLOW_NON_AUTHORITATIVE');
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
