const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPORT_SCHEMA_VERSION = 1;
const TOOLKIT_VERSION = '2.9.7';
const RETENTION_DAYS = 90;
const MAX_HISTORY_REPORTS = 500;
const STABLE_CODES = new Set([
  'N8N_CREDENTIAL_MISSING',
  'N8N_CREDENTIAL_AMBIGUOUS',
  'N8N_CREDENTIAL_TYPE_MISMATCH',
  'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE',
  'N8N_CREDENTIAL_CLEANUP_FAILED',
  'N8N_RESOURCE_BINDING_MISSING',
  'N8N_WORKFLOW_MATCH_AMBIGUOUS',
  'N8N_NODE_MATCH_AMBIGUOUS',
  'N8N_CANONICAL_INVARIANT_FAILED',
  'N8N_POLICY_VALIDATION_FAILED',
  'N8N_IMPORT_NO_CHANGES',
  'N8N_IMPORT_SUCCESS',
  'N8N_EXPORT_NO_CHANGES',
  'N8N_EXPORT_SUCCESS',
  'N8N_POSTCONDITION_FAILED',
  'N8N_INTERNAL_ERROR',
]);

const EXPLANATIONS = Object.freeze({
  N8N_CREDENTIAL_MISSING: 'A required logical credential name and type has no target match.',
  N8N_CREDENTIAL_AMBIGUOUS: 'More than one target credential has the required logical name and type.',
  N8N_CREDENTIAL_TYPE_MISMATCH: 'The logical credential name exists, but not with the required credential type.',
  N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: 'The supported target credential metadata provider could not return safe metadata.',
  N8N_CREDENTIAL_CLEANUP_FAILED: 'Encrypted credential metadata temporary cleanup did not complete safely.',
  N8N_RESOURCE_BINDING_MISSING: 'A required environment-specific exact resource binding is missing.',
  N8N_WORKFLOW_MATCH_AMBIGUOUS: 'The target workflow selector matched more than one workflow.',
  N8N_NODE_MATCH_AMBIGUOUS: 'A stable node selector did not identify exactly one node.',
  N8N_CANONICAL_INVARIANT_FAILED: 'Prepared output changed canonical workflow content outside authorised overlays.',
  N8N_POLICY_VALIDATION_FAILED: 'The canonical workflow or deployment policy failed validation.',
  N8N_IMPORT_NO_CHANGES: 'The effective prepared workflow already matches the target.',
  N8N_IMPORT_SUCCESS: 'The prepared workflow imported and the inactive postcondition was verified.',
  N8N_EXPORT_NO_CHANGES: 'Canonical export completed without changing a workflow source file.',
  N8N_EXPORT_SUCCESS: 'Canonical workflow source and portable declarations were exported safely.',
  N8N_POSTCONDITION_FAILED: 'The workflow import completed but the required inactive state could not be verified.',
  N8N_INTERNAL_ERROR: 'The helper encountered an unexpected internal failure.',
});

function credentialRequirementLabel(credentials) {
  const credential = Array.isArray(credentials) ? credentials[0] : null;
  if (!credential?.logicalName || !credential?.credentialType) return 'the exact reported logical credential name and type';
  return `"${credential.logicalName}" (${credential.credentialType})`;
}

function nextActionForCode(code, context = {}) {
  const credentialLabel = credentialRequirementLabel(context.credentials);
  const actions = {
    N8N_CREDENTIAL_MISSING: {
      code: 'CREATE_CREDENTIAL_AND_RERUN',
      message: `Create credential ${credentialLabel}, then rerun the unchanged official command.`,
    },
    N8N_CREDENTIAL_AMBIGUOUS: {
      code: 'REMOVE_DUPLICATE_CREDENTIALS_AND_RERUN',
      message: `Remove or rename duplicate target credentials for ${credentialLabel}, then rerun the unchanged official command.`,
    },
    N8N_CREDENTIAL_TYPE_MISMATCH: {
      code: 'CORRECT_CREDENTIAL_TYPE_AND_RERUN',
      message: `Create or rename the target credential so ${credentialLabel} matches exactly, then rerun the unchanged official command.`,
    },
    N8N_RESOURCE_BINDING_MISSING: {
      code: 'ADD_RESOURCE_BINDING_AND_RERUN',
      message: 'Add the exact declared local resource binding, then rerun the unchanged official command.',
    },
    N8N_POLICY_VALIDATION_FAILED: {
      code: 'REPAIR_PORTABLE_POLICY_AND_RERUN',
      message: 'Repair the portable policy or canonical document identified by the sanitized diagnostic, then rerun the unchanged official command.',
    },
    N8N_WORKFLOW_MATCH_AMBIGUOUS: {
      code: 'CORRECT_WORKFLOW_IDENTITY_AND_RERUN',
      message: 'Correct the dedicated local workflow identity or target naming ambiguity, then rerun the unchanged official command.',
    },
    N8N_NODE_MATCH_AMBIGUOUS: {
      code: 'CORRECT_NODE_IDENTITY_AND_RERUN',
      message: 'Correct the portable stable-node selector ambiguity, then rerun the unchanged official command.',
    },
    N8N_CANONICAL_INVARIANT_FAILED: {
      code: 'RESTORE_OR_REVIEW_CANONICAL_SOURCE',
      message: 'Restore canonical Git or explicitly review the intended canonical source change before rerunning.',
    },
    N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: {
      code: 'RESTORE_CREDENTIAL_DISCOVERY_AND_RERUN',
      message: 'Restore the supported encrypted credential metadata-discovery path, then rerun the unchanged official command.',
    },
    N8N_CREDENTIAL_CLEANUP_FAILED: {
      code: 'COMPLETE_CREDENTIAL_TEMP_CLEANUP',
      message: 'Complete exact cleanup of the encrypted credential temporary area before retrying.',
    },
    N8N_POSTCONDITION_FAILED: {
      code: 'STOP_AND_ESCALATE_POSTCONDITION',
      message: 'Do not activate or execute the workflow; escalate the inactive-postcondition failure using the sanitized operation ID.',
    },
    N8N_INTERNAL_ERROR: {
      code: 'ESCALATE_TOOLKIT_DEFECT',
      message: 'Escalate the Toolkit defect using the sanitized operation ID and phase.',
    },
  };
  return actions[code] ? clone(actions[code]) : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultOperationId() {
  return crypto.randomUUID();
}

function isSafeRelativeFile(value) {
  if (typeof value !== 'string' || !value) return false;
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) return false;
  const normalised = value.replace(/\\/g, '/');
  return !normalised.startsWith('../') && !normalised.includes('/../') && !normalised.includes('.env');
}

function assertNoSensitiveStrings(value, keyPath = '') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveStrings(entry, `${keyPath}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    const forbiddenKeys = new Set(['credentialId', 'credentialValue', 'token', 'encryptedData', 'rawWorkflow', 'rawNode', 'privatePath', 'environment']);
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`Report contains forbidden field ${keyPath ? `${keyPath}.` : ''}${key}.`);
      assertNoSensitiveStrings(entry, keyPath ? `${keyPath}.${key}` : key);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (/\b(?:gh[opurs]_|sk-|n8n_api_)[A-Za-z0-9_-]{8,}\b/.test(value)) throw new Error(`Report contains a token-like value at ${keyPath}.`);
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || /^\/(?:home|users|var|private)\//i.test(value)) {
    throw new Error(`Report contains a private absolute path at ${keyPath}.`);
  }
  if (/(^|[\\/])\.env($|[\\/])/.test(value)) throw new Error(`Report contains an .env path at ${keyPath}.`);
}

function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Report must be an object.');
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) throw new Error(`Unsupported report schema version: ${report.schemaVersion}`);
  if (typeof report.toolkitVersion !== 'string' || !report.toolkitVersion) throw new Error('Report toolkitVersion is required.');
  if (typeof report.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(report.operationId)) {
    throw new Error('Report operationId must be a safe bounded file-name token.');
  }
  if (typeof report.operationType !== 'string' || !report.operationType) throw new Error('Report operationType is required.');
  if (!STABLE_CODES.has(report.code)) throw new Error(`Unknown report code: ${report.code}`);
  if (typeof report.phase !== 'string' || !report.phase) throw new Error('Report phase is required.');
  if (!report.mutation || typeof report.mutation.attempted !== 'boolean' || typeof report.mutation.performed !== 'boolean') {
    throw new Error('Report mutation attempted/performed booleans are required.');
  }
  if (typeof report.activeState !== 'string' || typeof report.executionState !== 'string') {
    throw new Error('Report activeState and executionState are required.');
  }
  if (!report.nextAction || typeof report.nextAction.code !== 'string' || typeof report.nextAction.message !== 'string') {
    throw new Error('Report must contain exactly one supported next action.');
  }
  if (Array.isArray(report.nextAction) || Object.keys(report.nextAction).some((key) => !['code', 'message'].includes(key))) {
    throw new Error('Report nextAction must be one supported code/message object.');
  }
  if (!Array.isArray(report.unchangedScope)) throw new Error('Report unchangedScope must be an array.');
  for (const workflow of report.workflows || []) {
    if (workflow.workflowFile && !isSafeRelativeFile(workflow.workflowFile)) throw new Error('Report workflowFile must be a safe relative path.');
  }
  for (const credential of report.credentials || []) {
    const allowed = new Set(['logicalName', 'credentialType', 'required', 'matchCount', 'nodeName', 'nodeType']);
    if (Object.keys(credential).some((key) => !allowed.has(key))) throw new Error('Report credential details contain an unsupported or sensitive field.');
    if (typeof credential.logicalName !== 'string' || typeof credential.credentialType !== 'string' || !Number.isInteger(credential.matchCount)) {
      throw new Error('Report credential details require logicalName, credentialType, and matchCount.');
    }
  }
  assertNoSensitiveStrings(report);
  return report;
}

function createReport(input = {}) {
  const mappedNextAction = nextActionForCode(input.code || 'N8N_INTERNAL_ERROR', input);
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    toolkitVersion: input.toolkitVersion || TOOLKIT_VERSION,
    operationId: input.operationId || defaultOperationId(),
    operationType: input.operationType || 'import',
    createdAt: input.createdAt || new Date().toISOString(),
    result: input.result || 'FAILED',
    code: input.code || 'N8N_INTERNAL_ERROR',
    phase: input.phase || 'internal',
    workflows: Array.isArray(input.workflows) ? clone(input.workflows) : [],
    credentials: Array.isArray(input.credentials) ? clone(input.credentials) : [],
    resources: Array.isArray(input.resources) ? clone(input.resources) : [],
    mutation: {
      attempted: input.mutation?.attempted === true,
      performed: input.mutation?.performed === true,
    },
    activeState: input.activeState || 'unknown',
    executionState: input.executionState || 'not_executed',
    nextAction: clone(mappedNextAction || input.nextAction || { code: 'ESCALATE_TOOLKIT_DEFECT', message: 'Escalate the Toolkit defect using the sanitized operation ID and phase.' }),
    unchangedScope: Array.isArray(input.unchangedScope) ? clone(input.unchangedScope) : [],
  };
  return validateReport(report);
}

function assertSafeReportRoot(reportRoot) {
  const root = path.resolve(reportRoot);
  if (path.basename(root).toLowerCase() !== 'reports' || path.basename(path.dirname(root)).toLowerCase() !== '.n8n-local') {
    throw new Error('Report root must be .n8n-local/reports.');
  }
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('Report path contains a symlink, junction, or reparse escape.');
  }
  let current = path.dirname(root);
  while (fs.existsSync(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Report path contains a symlink, junction, or reparse escape.');
    const parent = path.dirname(current);
    if (parent === current) break;
    if (path.basename(current).toLowerCase() === '.n8n-local') break;
    current = parent;
  }
  return root;
}

function humanReport(report) {
  const lines = [
    `n8n workflow operation ${report.operationId}`,
    `Result: ${report.result}`,
    `Code: ${report.code}`,
    `Phase: ${report.phase}`,
    `Explanation: ${EXPLANATIONS[report.code]}`,
    `Mutation attempted: ${report.mutation.attempted}`,
    `Mutation performed: ${report.mutation.performed}`,
    `Active state: ${report.activeState}`,
    `Execution state: ${report.executionState}`,
    `Supported next action: ${report.nextAction.message}`,
  ];
  return `${lines.join('\n')}\n`;
}

function cleanupHistory(reportRoot, now = Date.now()) {
  const root = assertSafeReportRoot(reportRoot);
  const history = path.join(root, 'history');
  if (!fs.existsSync(history)) return { removed: 0 };
  if (fs.lstatSync(history).isSymbolicLink()) throw new Error('Report history path contains a symlink, junction, or reparse escape.');
  const files = fs.readdirSync(history)
    .filter((name) => name.endsWith('.json') || name.endsWith('.txt'))
    .map((name) => ({ name, fullPath: path.join(history, name), stat: fs.lstatSync(path.join(history, name)) }))
    .filter((entry) => entry.stat.isFile())
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const protectedNames = new Set(files.slice(0, MAX_HISTORY_REPORTS * 2).map((entry) => entry.name));
  let removed = 0;
  for (const entry of files) {
    if (entry.stat.mtimeMs < cutoff || !protectedNames.has(entry.name)) {
      fs.rmSync(entry.fullPath, { force: false });
      removed += 1;
    }
  }
  return { removed };
}

function assertSafeLatestFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Latest report path contains a symlink, junction, reparse escape, or non-file entry.');
}

function writeReport(reportRoot, input) {
  const root = assertSafeReportRoot(reportRoot);
  const report = createReport(input);
  const history = path.join(root, 'history');
  fs.mkdirSync(history, { recursive: true });
  if (fs.lstatSync(history).isSymbolicLink()) throw new Error('Report history path contains a symlink, junction, or reparse escape.');
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const human = humanReport(report);
  const latestJson = path.join(root, 'latest-n8n-workflow-operation.json');
  const latestText = path.join(root, 'latest-n8n-workflow-operation.txt');
  assertSafeLatestFile(latestJson);
  assertSafeLatestFile(latestText);
  fs.writeFileSync(path.join(history, `${report.operationId}.json`), json, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(path.join(history, `${report.operationId}.txt`), human, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(latestJson, json, 'utf8');
  fs.writeFileSync(latestText, human, 'utf8');
  cleanupHistory(root);
  return report;
}

function readLatestReport(reportRoot) {
  const root = assertSafeReportRoot(reportRoot);
  const latest = path.join(root, 'latest-n8n-workflow-operation.json');
  assertSafeLatestFile(latest);
  const report = JSON.parse(fs.readFileSync(latest, 'utf8').replace(/^\uFEFF/, ''));
  return validateReport(report);
}

function recheckCredentials(report, metadataPath) {
  if (!metadataPath || report.credentials.length === 0) return null;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(metadata)) throw new Error('Credential metadata recheck input must be an array.');
  return report.credentials.map((requirement) => ({
    logicalName: requirement.logicalName,
    credentialType: requirement.credentialType,
    matchCount: metadata.filter((entry) => entry?.name === requirement.logicalName && entry?.type === requirement.credentialType).length,
  }));
}

function explainLatestFailure(reportRoot, metadataPath) {
  const report = readLatestReport(reportRoot);
  const lines = [
    `Code: ${report.code}`,
    `Explanation: ${EXPLANATIONS[report.code]}`,
    `Supported next action: ${report.nextAction.message}`,
  ];
  const recheck = recheckCredentials(report, metadataPath);
  if (recheck) {
    const ready = recheck.every((entry) => entry.matchCount === 1);
    lines.push(`Prerequisite recheck: ${ready ? 'ready; rerun the unchanged official command' : 'not ready; follow the supported next action'}.`);
  }
  return `${lines.join('\n')}\n`;
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

if (require.main === module) {
  try {
    const command = process.argv[2];
    const options = parseCli(process.argv.slice(3));
    const reportRoot = options['report-root'] || path.join('.n8n-local', 'reports');
    if (command === 'write' && options.input) {
      const report = writeReport(reportRoot, JSON.parse(fs.readFileSync(options.input, 'utf8').replace(/^\uFEFF/, '')));
      console.log(`Wrote sanitized n8n workflow operation report ${report.operationId}.`);
    } else if (command === 'explain') {
      process.stdout.write(explainLatestFailure(reportRoot, options['credential-metadata']));
    } else if (command === 'validate') {
      readLatestReport(reportRoot);
      console.log('Latest n8n workflow operation report is valid.');
    } else {
      console.error('Usage: node n8n-workflow-operation-report.cjs <write|explain|validate> [--report-root path] [--input report.json] [--credential-metadata metadata.json]');
      process.exit(2);
    }
  } catch (error) {
    console.error(`N8N_INTERNAL_ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  TOOLKIT_VERSION,
  RETENTION_DAYS,
  MAX_HISTORY_REPORTS,
  STABLE_CODES,
  EXPLANATIONS,
  nextActionForCode,
  validateReport,
  createReport,
  humanReport,
  cleanupHistory,
  writeReport,
  readLatestReport,
  explainLatestFailure,
};
