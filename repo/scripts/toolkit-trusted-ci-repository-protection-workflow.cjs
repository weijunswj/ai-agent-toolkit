'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const protection = require('./toolkit-trusted-ci-repository-protection.cjs');
const capabilityRegistry = require('./toolkit-capability-registry.cjs');

const CONTRACT_VERSION = 'toolkit.n6.protected-ci-gate-workflow.v1';
const WORKFLOW_ID = 'n6-protected-ci-gate';
const WORKFLOW_NAME = 'CI Gate';
const BASE_REF = 'refs/heads/main';
const ALLOWED_TRIGGERS = Object.freeze(['pull_request_target', 'merge_group']);
const REQUIRED_PERMISSIONS = Object.freeze({ contents: 'read', actions: 'read', checks: 'read' });
const ALLOWED_ACTIONS = Object.freeze(['actions/checkout@v4']);
const MAX_COMPOSITION_INPUT_BYTES = 4 * 1024 * 1024;
const COMPOSITION_INPUT_PATH = '$RUNNER_TEMP/n6-protected-ci-input.json';
const PROTECTED_COMPONENT_PRODUCER = 'protected-ci-gate';
const REQUIRED_STEPS = Object.freeze(['produce-trusted-composition', 'validate-protected-workflow', 'git-diff-check', 'validate-trusted-ci-composition']);
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
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
  'WORKFLOW_EVIDENCE_INVALID',
  'WORKFLOW_COVERAGE_INVALID',
  'WORKFLOW_TRUSTED_CONTEXT_MISSING',
  'WORKFLOW_PRODUCER_INVALID',
]);

const trustedContexts = new WeakSet();

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

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function positiveInteger(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

function readProtectedEventFile(eventPath) {
  if (typeof eventPath !== 'string' || !eventPath || !path.isAbsolute(eventPath)) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  let stat;
  try {
    stat = fs.lstatSync(eventPath);
  } catch (_error) {
    return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_EVENT_BYTES) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  let bytes;
  try {
    bytes = fs.readFileSync(eventPath);
  } catch (_error) {
    return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  }
  try {
    const event = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(event)) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
    return success({ event, event_digest: sha256(bytes) });
  } catch (_error) {
    return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  }
}

function repositoryIdForEvent(repository) {
  if (!isSafeText(repository, 256) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  try {
    return capabilityRegistry.repositoryIdForCanonicalRemote(`https://github.com/${repository}.git`);
  } catch (_error) {
    return null;
  }
}

function eventSha(value) {
  return isSha(value) ? value : null;
}

function trustedEventTimestamp(event) {
  const value = event?.pull_request?.updated_at
    || event?.pull_request?.created_at
    || event?.merge_group?.created_at
    || null;
  if (!isSafeText(value, 64) || !value.endsWith('Z')) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeTrustedContext(fields) {
  const context = deepFreeze(clone(fields));
  trustedContexts.add(context);
  return context;
}

function readProtectedEventContext(env = process.env) {
  const source = isRecord(env) ? env : {};
  const eventResult = readProtectedEventFile(source.GITHUB_EVENT_PATH);
  if (!eventResult.ok) return eventResult;
  const eventName = source.GITHUB_EVENT_NAME;
  if (!ALLOWED_TRIGGERS.includes(eventName)) return failure('WORKFLOW_TRIGGER_FORBIDDEN');
  const eventRepository = eventResult.event.repository?.full_name;
  if (source.GITHUB_REPOSITORY !== undefined && source.GITHUB_REPOSITORY !== eventRepository) return failure('WORKFLOW_IDENTITY_MISMATCH');
  const repository = eventRepository;
  const repositoryId = repositoryIdForEvent(repository);
  if (!repositoryId) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');

  const pullRequest = eventResult.event.pull_request;
  const mergeGroup = eventResult.event.merge_group;
  const pr = eventName === 'pull_request_target'
    ? positiveInteger(pullRequest?.number)
    : positiveInteger(mergeGroup?.pull_request_number || mergeGroup?.pr_number || source.GITHUB_PR_NUMBER);
  const headSha = eventName === 'pull_request_target' ? eventSha(pullRequest?.head?.sha) : eventSha(mergeGroup?.head_sha);
  const baseSha = eventName === 'pull_request_target' ? eventSha(pullRequest?.base?.sha) : eventSha(mergeGroup?.base_sha);
  const mergeSha = eventName === 'pull_request_target'
    ? eventSha(pullRequest?.merge_commit_sha) || eventSha(source.GITHUB_SHA)
    : eventSha(mergeGroup?.merge_commit_sha) || eventSha(source.GITHUB_SHA);
  const runId = isSafeText(source.GITHUB_RUN_ID, 128) ? source.GITHUB_RUN_ID : null;
  const attempt = positiveInteger(source.GITHUB_RUN_ATTEMPT || 1);
  if (!pr || !headSha || !baseSha || !mergeSha || !runId || !attempt) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  if (Object.prototype.hasOwnProperty.call(eventResult.event, 'changed_paths')) {
    return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  }
  const changedPaths = eventResult.event.n6_changed_paths;
  if (changedPaths !== undefined && (!Array.isArray(changedPaths) || changedPaths.some((value) => !isSafeText(value, 512)))) {
    return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  }
  return success({
    trusted_context: makeTrustedContext({
      event_name: eventName,
      event_digest: eventResult.event_digest,
      repository,
      repository_id: repositoryId,
      pr,
      head_sha: headSha,
      base_sha: baseSha,
      merge_sha: mergeSha,
      run_id: runId,
      attempt,
      generation: 1,
      workflow_identity: WORKFLOW_ID,
      workflow_source_sha: sha1(buildProtectedWorkflowTemplate()),
      minimum_timestamp: trustedEventTimestamp(eventResult.event),
      event_changed_paths: changedPaths ? [...changedPaths] : null,
    }),
  });
}

function runGit(cwd, args) {
  let result;
  try {
    result = childProcess.spawnSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: MAX_COMPOSITION_INPUT_BYTES,
      windowsHide: true,
      shell: false,
    });
  } catch (_error) {
    return failure('WORKFLOW_PRODUCER_INVALID');
  }
  if (!result || result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string') return failure('WORKFLOW_PRODUCER_INVALID');
  return success({ stdout: result.stdout });
}

function validateProtectedBaseCheckout(context, cwd) {
  if (!trustedContexts.has(context) || !isSafeText(cwd, 4096) || !path.isAbsolute(cwd)) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  const head = runGit(cwd, ['rev-parse', 'HEAD']);
  if (!head.ok) return head;
  if (head.stdout.trim() !== context.base_sha) return failure('WORKFLOW_BASE_MISMATCH');
  return success();
}

function resolveProtectedComponentCommand(definition, cwd) {
  if (!isRecord(definition) || !isSafeText(cwd, 4096) || !path.isAbsolute(cwd)) return failure('WORKFLOW_PRODUCER_INVALID');
  if (definition.command === 'git diff --check') return success({ executable: 'git', args: ['diff', '--check'] });
  if (definition.command === 'node --test repo/tests/*.test.cjs') {
    let files;
    try {
      files = fs.readdirSync(path.join(cwd, 'repo', 'tests'))
        .filter((name) => /^.+\.test\.cjs$/.test(name))
        .sort()
        .map((name) => path.join('repo', 'tests', name));
    } catch (_error) {
      return failure('WORKFLOW_PRODUCER_INVALID');
    }
    if (files.length === 0) return failure('WORKFLOW_PRODUCER_INVALID');
    return success({ executable: process.execPath, args: ['--test', ...files] });
  }
  const match = definition.command.match(/^node (repo\/scripts\/[A-Za-z0-9._/-]+\.cjs)(?: (.*))?$/);
  if (!match) return failure('WORKFLOW_PRODUCER_INVALID');
  const scriptPath = path.join(cwd, ...match[1].split('/'));
  try {
    const stat = fs.statSync(scriptPath);
    if (!stat.isFile()) return failure('WORKFLOW_PRODUCER_INVALID');
  } catch (_error) {
    return failure('WORKFLOW_PRODUCER_INVALID');
  }
  const args = match[2] ? match[2].split(' ').filter(Boolean) : [];
  return success({ executable: process.execPath, args: [match[1], ...args] });
}

function runProtectedComponent(definition, context, cwd) {
  const command = resolveProtectedComponentCommand(definition, cwd);
  if (!command.ok) {
    return {
      id: definition.id,
      status: 'failure',
      conclusion: 'failure',
      mandatory: true,
      producer: PROTECTED_COMPONENT_PRODUCER,
      dependency_setup: false,
      artifact_digest: protection.digestValue({
        component: definition.id,
        command: definition.command,
        result: command.code,
        event_digest: context.event_digest,
        workflow_source_sha: context.workflow_source_sha,
      }),
    };
  }
  let result;
  try {
    result = childProcess.spawnSync(command.executable, command.args, {
      cwd,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: MAX_COMPOSITION_INPUT_BYTES,
      windowsHide: true,
      shell: false,
    });
  } catch (_error) {
    result = null;
  }
  const passed = Boolean(result && !result.error && !result.signal && result.status === 0);
  const status = result?.signal ? 'timed-out' : passed ? 'success' : 'failure';
  const conclusion = passed ? 'success' : result?.signal ? 'timed-out' : 'failure';
  const exitCode = Number.isInteger(result?.status) ? result.status : null;
  return {
    id: definition.id,
    status,
    conclusion,
    mandatory: true,
    producer: PROTECTED_COMPONENT_PRODUCER,
    dependency_setup: true,
    artifact_digest: protection.digestValue({
      component: definition.id,
      command: definition.command,
      event_digest: context.event_digest,
      workflow_source_sha: context.workflow_source_sha,
      repository_id: context.repository_id,
      base_sha: context.base_sha,
      head_sha: context.head_sha,
      status,
      conclusion,
      exit_code: exitCode,
    }),
  };
}

function trustedChangedPaths(context, cwd = process.cwd()) {
  if (!trustedContexts.has(context)) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  if (Array.isArray(context.event_changed_paths)) {
    const paths = context.event_changed_paths.map((value) => value.replace(/\\/g, '/'));
    if (paths.some((value) => !protection.pathClasses(value)) || new Set(paths).size !== paths.length) return failure('WORKFLOW_COVERAGE_INVALID');
    return success({ changed_paths: paths });
  }
  const diff = runGit(cwd, ['diff', '--name-only', '--no-renames', context.base_sha, context.head_sha]);
  if (!diff.ok) return diff;
  const paths = diff.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (paths.length === 0 || paths.some((value) => !protection.pathClasses(value)) || new Set(paths).size !== paths.length) return failure('WORKFLOW_COVERAGE_INVALID');
  return success({ changed_paths: paths });
}

function contextWithChangedPaths(context, cwd = process.cwd()) {
  const paths = trustedChangedPaths(context, cwd);
  if (!paths.ok) return paths;
  return success({ trusted_context: makeTrustedContext({ ...context, changed_paths: paths.changed_paths }) });
}

function sourceLines(source) {
  return source.replace(/\r\n/g, '\n').split('\n');
}

function hasLine(source, expression) {
  return sourceLines(source).some((line) => expression.test(line));
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

  const actions = [...normalized.matchAll(/^\s+uses:\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
  if (actions.some((action) => !ALLOWED_ACTIONS.includes(action))) return failure('WORKFLOW_ACTION_FORBIDDEN', { actions });
  if (actions.length !== ALLOWED_ACTIONS.length || actions[0] !== ALLOWED_ACTIONS[0]) return failure('WORKFLOW_ACTION_FORBIDDEN', { actions });
  if (!/^\s{10}persist-credentials:\s*false\s*$/m.test(normalized)) return failure('WORKFLOW_CANDIDATE_CODE');
  if (!/^\s{10}ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}\s*$/m.test(normalized)) return failure('WORKFLOW_BASE_MISMATCH');
  if (!/^\s{2}ci-gate:\s*\n(?:.*\n)*?\s{4}name:\s*CI Gate\s*$/m.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/^\s{4}runs-on:\s*[A-Za-z0-9_.-]+\s*$/m.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/^\s{4}steps:\s*$/m.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/git diff --check/.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/toolkit-trusted-ci-repository-protection-workflow\.cjs/.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/--produce-composition > "\$RUNNER_TEMP\/n6-protected-ci-input\.json"/.test(normalized)) return failure('WORKFLOW_INVALID');
  if (!/--validate-composition < "\$RUNNER_TEMP\/n6-protected-ci-input\.json"/.test(normalized)) return failure('WORKFLOW_INVALID');
  const producerIndex = normalized.indexOf('--produce-composition');
  const validatorIndex = normalized.indexOf('--validate-composition');
  if (producerIndex < 0 || validatorIndex < 0 || producerIndex > validatorIndex) return failure('WORKFLOW_INVALID');
  for (const expression of [
    /GITHUB_EVENT_PATH:\s*\$\{\{\s*github\.event_path\s*\}\}/,
    /GITHUB_EVENT_NAME:\s*\$\{\{\s*github\.event_name\s*\}\}/,
    /GITHUB_REPOSITORY:\s*\$\{\{\s*github\.repository\s*\}\}/,
    /GITHUB_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
    /GITHUB_RUN_ID:\s*\$\{\{\s*github\.run_id\s*\}\}/,
    /GITHUB_RUN_ATTEMPT:\s*\$\{\{\s*github\.run_attempt\s*\}\}/,
  ]) if (!expression.test(normalized)) return failure('WORKFLOW_INVALID');
  return success({ source: normalized, triggers, actions });
}

function validateWorkflowContract(contract) {
  const keys = ['contract_version', 'workflow_id', 'workflow_name', 'base_ref', 'allowed_triggers', 'forbidden_triggers', 'candidate_code_execution', 'permissions', 'publisher', 'actions', 'checkout', 'composition_input', 'required_steps', 'secrets', 'statuses'];
  if (!exactKeys(contract, keys)
    || contract.contract_version !== CONTRACT_VERSION
    || contract.workflow_id !== WORKFLOW_ID
    || contract.workflow_name !== WORKFLOW_NAME
    || contract.base_ref !== BASE_REF
    || !Array.isArray(contract.allowed_triggers)
    || !Array.isArray(contract.forbidden_triggers)
    || contract.candidate_code_execution !== false
    || !isRecord(contract.permissions)
    || !exactKeys(contract.permissions, Object.keys(REQUIRED_PERMISSIONS))
    || !isRecord(contract.publisher)
    || contract.publisher.protocol_version !== protection.PUBLISHER_PROTOCOL_VERSION
    || contract.publisher.context !== protection.GATE_CONTEXT
    || !Array.isArray(contract.actions) || contract.actions.length !== 1 || contract.actions[0] !== ALLOWED_ACTIONS[0]
    || !exactKeys(contract.checkout, ['ref', 'persist_credentials', 'candidate_head_checkout'])
    || contract.checkout.ref !== 'github.event.repository.default_branch' || contract.checkout.persist_credentials !== false || contract.checkout.candidate_head_checkout !== false
    || !exactKeys(contract.composition_input, ['transport', 'source', 'path', 'candidate_owned', 'max_bytes', 'required_fields'])
    || contract.composition_input.transport !== 'json-stdin' || contract.composition_input.source !== 'protected-runner-temp'
    || contract.composition_input.path !== COMPOSITION_INPUT_PATH || contract.composition_input.candidate_owned !== false
    || contract.composition_input.max_bytes !== MAX_COMPOSITION_INPUT_BYTES
    || !Array.isArray(contract.composition_input.required_fields)
    || contract.composition_input.required_fields.length !== COMPOSITION_INPUT_KEYS.length
    || contract.composition_input.required_fields.some((field, index) => field !== COMPOSITION_INPUT_KEYS[index])
    || !Array.isArray(contract.required_steps) || contract.required_steps.length !== REQUIRED_STEPS.length
    || contract.required_steps.some((step, index) => step !== REQUIRED_STEPS[index])
    || contract.secrets !== false || contract.statuses !== false) return failure('WORKFLOW_INVALID');
  if (contract.allowed_triggers.some((trigger) => !ALLOWED_TRIGGERS.includes(trigger))
    || contract.forbidden_triggers.some((trigger) => !FORBIDDEN_TRIGGERS.includes(trigger))) return failure('WORKFLOW_TRIGGER_FORBIDDEN');
  for (const [permission, level] of Object.entries(REQUIRED_PERMISSIONS)) if (contract.permissions[permission] !== level) return failure('WORKFLOW_PERMISSION_FORBIDDEN');
  return success({ contract: clone(contract) });
}

function workflowIdentity(input) {
  const source = typeof input === 'string' ? input : input?.source;
  if (!isSafeSourceText(source)) return failure('WORKFLOW_INVALID');
  const validated = validateWorkflowSource(source);
  if (!validated.ok) return validated;
  const sourceSha = sha1(validated.source);
  if (typeof input === 'object' && input.source_sha !== undefined && input.source_sha !== sourceSha) return failure('WORKFLOW_SOURCE_UNTRUSTED');
  return success({ identity: WORKFLOW_ID, source_sha: sourceSha, base_ref: BASE_REF, candidate_owned: false, triggers: validated.triggers });
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
    '      - name: Produce trusted CI composition',
    '        env:',
    '          GITHUB_EVENT_PATH: ${{ github.event_path }}',
    '          GITHUB_EVENT_NAME: ${{ github.event_name }}',
    '          GITHUB_REPOSITORY: ${{ github.repository }}',
    '          GITHUB_SHA: ${{ github.sha }}',
    '          GITHUB_RUN_ID: ${{ github.run_id }}',
    '          GITHUB_RUN_ATTEMPT: ${{ github.run_attempt }}',
    '        run: node repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs --produce-composition > "$RUNNER_TEMP/n6-protected-ci-input.json"',
    '      - name: Validate protected workflow contract',
    '        run: node repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs --validate-source',
    '      - name: Check repository diff hygiene',
    '        run: git diff --check',
    '      - name: Validate trusted CI composition',
    '        run: node repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs --validate-composition < "$RUNNER_TEMP/n6-protected-ci-input.json"',
    '',
  ].join('\n');
}

function validateGateInvocation(input = {}) {
  const keys = ['workflow', 'repository_id', 'pr', 'head_sha', 'base_sha', 'merge_sha', 'changed_paths', 'component_results', 'evidence', 'evidence_archive', 'non_ci_evidence', 'trusted_context'];
  if (!isRecord(input) || Object.keys(input).some((key) => !keys.includes(key))) return failure('WORKFLOW_INVALID');
  const trustedContext = input.trusted_context;
  if (!trustedContexts.has(trustedContext) || !Array.isArray(trustedContext.changed_paths)) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  const workflowResult = validateProtectedWorkflow(input.workflow);
  if (!workflowResult.ok) return workflowResult;
  if (workflowResult.source_sha !== trustedContext.workflow_source_sha) return failure('WORKFLOW_SOURCE_UNTRUSTED');
  for (const field of ['repository_id', 'pr', 'head_sha', 'base_sha', 'merge_sha']) {
    if (input[field] !== trustedContext[field]) return failure('WORKFLOW_IDENTITY_MISMATCH');
  }
  if (protection.canonicalSerialize(input.changed_paths) !== protection.canonicalSerialize(trustedContext.changed_paths)) return failure('WORKFLOW_COVERAGE_INVALID');
  const workflow = workflowResult;
  const composition = protection.compositionManifest(trustedContext.changed_paths);
  if (!composition.ok) return failure('WORKFLOW_COVERAGE_INVALID', { cause: composition.code, path: composition.path });
  const coverage = protection.validateOwningCICoverage({
    changed_paths: trustedContext.changed_paths,
    manifest: composition,
    component_results: input.component_results,
    non_ci_evidence: input.non_ci_evidence,
    trusted_component_producer: PROTECTED_COMPONENT_PRODUCER,
  });
  if (!coverage.ok) return failure('WORKFLOW_COVERAGE_INVALID', { cause: coverage.code, component_id: coverage.component_id });
  const componentIds = input.component_results.map((component) => component.id);
  if (componentIds.length !== composition.required_components.length
    || [...componentIds].sort().join(',') !== [...composition.required_components].sort().join(',')) {
    return failure('WORKFLOW_COVERAGE_INVALID', { cause: 'COMPONENT_MISSING' });
  }
  const expected = {
    repository_id: trustedContext.repository_id,
    pr: trustedContext.pr,
    head_sha: trustedContext.head_sha,
    base_sha: trustedContext.base_sha,
    merge_sha: trustedContext.merge_sha,
    protected_workflow_identity: workflow.identity,
    protected_workflow_source_sha: trustedContext.workflow_source_sha,
    contract_digest: protection.EVIDENCE_CONTRACT_DIGEST,
    component_ids: composition.required_components,
    required_component_ids: composition.required_components,
    producer: {
      workflow_identity: workflow.identity,
      workflow_source_sha: trustedContext.workflow_source_sha,
      run_id: trustedContext.run_id,
      attempt: trustedContext.attempt,
      generation: trustedContext.generation,
    },
    ...(Number.isFinite(trustedContext.minimum_timestamp) ? { minimum_timestamp: trustedContext.minimum_timestamp } : {}),
  };
  if (!isRecord(input.evidence) || !Array.isArray(input.evidence_archive)) return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'EVIDENCE_INCOMPLETE' });
  const evidence = protection.validateEvidence(input.evidence, expected);
  if (!evidence.ok) return failure('WORKFLOW_EVIDENCE_INVALID', { cause: evidence.code });
  for (const component of input.component_results || []) {
    const archived = input.evidence.component_results.find((entry) => entry.id === component.id);
    if (!archived || ['id', 'status', 'conclusion', 'mandatory', 'artifact_digest'].some((key) => archived[key] !== component[key])
      || component.producer !== PROTECTED_COMPONENT_PRODUCER) {
      return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'EVIDENCE_STALE' });
    }
  }
  const archive = protection.validateEvidenceArchive(input.evidence_archive, { expectedPaths: ['ci/evidence.json'] });
  if (!archive.ok) return failure('WORKFLOW_EVIDENCE_INVALID', { cause: archive.code });
  let archivedEvidence;
  try {
    archivedEvidence = JSON.parse(input.evidence_archive[0].bytes);
  } catch (_error) {
    return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'ARCHIVE_INVALID' });
  }
  if (protection.canonicalSerialize(archivedEvidence) !== protection.canonicalSerialize(input.evidence)) {
    return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'EVIDENCE_STALE' });
  }
  return success({ workflow: workflowIdentity(input.workflow), composition: composition, coverage, evidence: input.evidence ? clone(input.evidence) : null });
}

function validateSourceForCli(source = buildProtectedWorkflowTemplate()) {
  return validateProtectedWorkflow(source);
}

function trustedComponentResults(manifest, context, cwd) {
  return manifest.required_components.map((id) => {
    const definition = protection.COMPONENT_DEFINITIONS.find((component) => component.id === id);
    return definition ? runProtectedComponent(definition, context, cwd) : {
      id,
      status: 'failure',
      conclusion: 'failure',
      mandatory: true,
      producer: PROTECTED_COMPONENT_PRODUCER,
      dependency_setup: false,
      artifact_digest: protection.digestValue({ component: id, result: 'definition-missing' }),
    };
  });
}

function trustedCompositionInput(context, cwd) {
  if (!trustedContexts.has(context) || !Array.isArray(context.changed_paths)) return failure('WORKFLOW_TRUSTED_CONTEXT_MISSING');
  const checkout = validateProtectedBaseCheckout(context, cwd);
  if (!checkout.ok) return checkout;
  const composition = protection.compositionManifest(context.changed_paths);
  if (!composition.ok) return failure('WORKFLOW_COVERAGE_INVALID', { cause: composition.code, path: composition.path });
  const componentResults = trustedComponentResults(composition, context, cwd);
  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();
  const evidence = {
    schema: protection.EVIDENCE_SCHEMA,
    repository_id: context.repository_id,
    pr: context.pr,
    head_sha: context.head_sha,
    base_sha: context.base_sha,
    merge_sha: context.merge_sha,
    protected_workflow: {
      identity: WORKFLOW_ID,
      source_sha: context.workflow_source_sha,
    },
    run: { id: context.run_id, attempt: context.attempt },
    generation: context.generation,
    contract_version: protection.CONTRACT_VERSION,
    contract_digest: protection.EVIDENCE_CONTRACT_DIGEST,
    component_results: componentResults.map((component) => ({
      id: component.id,
      status: component.status,
      conclusion: component.conclusion,
      mandatory: component.mandatory,
      producer: {
        workflow_identity: WORKFLOW_ID,
        workflow_source_sha: context.workflow_source_sha,
        run_id: context.run_id,
        attempt: context.attempt,
        generation: context.generation,
      },
      artifact_digest: component.artifact_digest,
    })),
    conclusion: componentResults.every((component) => component.status === 'success' && component.conclusion === 'success') ? 'success' : 'failure',
    timestamps: { started_at: startedAt, completed_at: completedAt },
    evidence_digest: '',
  };
  evidence.evidence_digest = protection.evidenceDigest(evidence);
  return success({
    input: {
      repository_id: context.repository_id,
      pr: context.pr,
      head_sha: context.head_sha,
      base_sha: context.base_sha,
      merge_sha: context.merge_sha,
      changed_paths: [...context.changed_paths],
      component_results: componentResults,
      evidence,
      evidence_archive: [{ path: 'ci/evidence.json', kind: 'file', bytes: JSON.stringify(evidence) }],
      non_ci_evidence: [],
    },
    producer_ok: componentResults.every((component) => component.status === 'success' && component.conclusion === 'success'),
  });
}

function produceCompositionForCli(env = process.env, cwd = process.cwd()) {
  const contextResult = readProtectedEventContext(env);
  if (!contextResult.ok) return contextResult;
  const contextWithPaths = contextWithChangedPaths(contextResult.trusted_context, cwd);
  if (!contextWithPaths.ok) return contextWithPaths;
  return trustedCompositionInput(contextWithPaths.trusted_context, cwd);
}

function validateCompositionForCli(input) {
  if (!exactKeys(input, COMPOSITION_INPUT_KEYS)) return failure('WORKFLOW_INVALID');
  if (!isRecord(input.evidence) || !Array.isArray(input.evidence_archive)) {
    return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'EVIDENCE_INCOMPLETE' });
  }
  const contextResult = readProtectedEventContext();
  if (!contextResult.ok) return contextResult;
  const contextWithPaths = contextWithChangedPaths(contextResult.trusted_context);
  if (!contextWithPaths.ok) return contextWithPaths;
  const produced = trustedCompositionInput(contextWithPaths.trusted_context, process.cwd());
  if (!produced.ok) return produced;
  if (!produced.producer_ok) return failure('WORKFLOW_PRODUCER_INVALID');
  if (!Array.isArray(input.evidence.component_results) || !Array.isArray(input.non_ci_evidence)) {
    return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'EVIDENCE_INCOMPLETE' });
  }
  if (!Array.isArray(input.component_results)
    || input.component_results.map((component) => component?.id).sort().join(',')
      !== produced.input.component_results.map((component) => component.id).sort().join(',')) {
    return failure('WORKFLOW_COVERAGE_INVALID', { cause: 'COMPONENT_MISSING' });
  }
  if (protection.canonicalSerialize(input.component_results) !== protection.canonicalSerialize(produced.input.component_results)
    || protection.canonicalSerialize(input.evidence.component_results) !== protection.canonicalSerialize(produced.input.evidence.component_results)
    || protection.canonicalSerialize(input.non_ci_evidence) !== protection.canonicalSerialize(produced.input.non_ci_evidence)) {
    return failure('WORKFLOW_EVIDENCE_INVALID', { cause: 'EVIDENCE_STALE' });
  }
  const source = buildProtectedWorkflowTemplate();
  const protectedIdentity = workflowIdentity(source);
  if (!protectedIdentity.ok) return protectedIdentity;
  return validateGateInvocation({
    ...input,
    workflow: {
      source,
      source_sha: protectedIdentity.source_sha,
      base_ref: BASE_REF,
      candidate_owned: false,
      workflow_identity: WORKFLOW_ID,
    },
    trusted_context: contextWithPaths.trusted_context,
  });
}

function readCompositionInputForCli(fd = 0) {
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_COMPOSITION_INPUT_BYTES + 1 - total));
    const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_COMPOSITION_INPUT_BYTES) return failure('WORKFLOW_INVALID');
    chunks.push(chunk.subarray(0, bytesRead));
  }
  if (total === 0) return failure('WORKFLOW_INVALID');
  try {
    return success({ input: JSON.parse(Buffer.concat(chunks, total).toString('utf8')) });
  } catch (_error) {
    return failure('WORKFLOW_INVALID');
  }
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
  let result;
  let output;
  if (argument === '--validate-source') {
    result = validateSourceForCli();
  } else if (argument === '--produce-composition') {
    const produced = produceCompositionForCli();
    result = produced.ok && produced.producer_ok
      ? success({ input: produced.input })
      : produced.ok ? failure('WORKFLOW_PRODUCER_INVALID') : produced;
    output = produced.ok ? produced.input : produced;
  } else if (argument === '--validate-composition') {
    const parsed = readCompositionInputForCli();
    result = parsed.ok ? validateCompositionForCli(parsed.input) : parsed;
  } else {
    result = failure('WORKFLOW_INVALID');
  }
  process.stdout.write(JSON.stringify(output || result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
