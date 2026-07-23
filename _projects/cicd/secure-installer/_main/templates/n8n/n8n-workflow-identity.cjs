const fs = require('node:fs');
const path = require('node:path');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function comparable(value) {
  return path.normalize(path.resolve(value)).replace(/[\\/]+$/, '').toLowerCase();
}

function assertSafeIdentityPath(statePath, repositoryRoot = process.cwd()) {
  const file = path.resolve(statePath);
  const root = path.dirname(file);
  const repo = path.resolve(repositoryRoot);
  const relative = path.relative(repo, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity state must remain inside the repository.');
  }
  if (path.basename(file).toLowerCase() !== 'n8n-workflow-identities.json' || path.basename(root).toLowerCase() !== '.n8n-local') {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity state must be .n8n-local/n8n-workflow-identities.json.');
  }
  for (const candidate of [root, file]) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || comparable(fs.realpathSync.native(candidate)) !== comparable(candidate)) {
      fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity state contains a symlink, junction, or reparse escape.');
    }
  }
  return { file, root };
}

function safeWorkflowFile(value) {
  const normalised = String(value || '').replace(/\\/g, '/');
  if (!normalised || path.isAbsolute(normalised) || /^[A-Za-z]:\//.test(normalised) || normalised.startsWith('../') || normalised.includes('/../')) {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity selector must use a safe relative workflow file.');
  }
  return normalised;
}

function assertSafeResultPath(resultPath) {
  const result = path.resolve(resultPath);
  const temporaryRoot = path.resolve('.tmp');
  const relative = path.relative(temporaryRoot, result);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity result must be a strict child of repo .tmp.');
  }
  let current = path.dirname(result);
  while (fs.existsSync(current) && comparable(current) !== comparable(temporaryRoot)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || comparable(fs.realpathSync.native(current)) !== comparable(current)) {
      fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity result contains a symlink, junction, or reparse escape.');
    }
    current = path.dirname(current);
  }
  return result;
}

function readState(statePath, repositoryRoot = process.cwd()) {
  const { file } = assertSafeIdentityPath(statePath, repositoryRoot);
  if (!fs.existsSync(file)) return { schemaVersion: 1, workflows: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.workflows)) {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity state schema is invalid.');
  }
  return parsed;
}

function selectIdentity(state, workflowFile, workflowName) {
  const file = safeWorkflowFile(workflowFile).toLowerCase();
  const byFile = state.workflows.filter((entry) => String(entry.workflowFile || '').replace(/\\/g, '/').toLowerCase() === file);
  const matches = byFile.length > 0 ? byFile : state.workflows.filter((entry) => entry.workflowName && entry.workflowName === workflowName);
  if (matches.length > 1) fail('N8N_WORKFLOW_MATCH_AMBIGUOUS', 'Local workflow identity matched more than one target.');
  const match = matches[0];
  if (!match) return null;
  if (typeof match.targetWorkflowId !== 'string' || !match.targetWorkflowId) {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Local workflow identity is missing its internal target workflow ID.');
  }
  return match;
}

function recordIdentity(statePath, input, repositoryRoot = process.cwd()) {
  const { file, root } = assertSafeIdentityPath(statePath, repositoryRoot);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertSafeIdentityPath(statePath, repositoryRoot);
  const state = readState(statePath, repositoryRoot);
  const workflowFile = safeWorkflowFile(input.workflowFile);
  if (typeof input.targetWorkflowId !== 'string' || !input.targetWorkflowId) {
    fail('N8N_POLICY_VALIDATION_FAILED', 'Target workflow identity is required.');
  }
  const entry = {
    workflowFile,
    workflowName: String(input.workflowName || ''),
    targetWorkflowId: input.targetWorkflowId,
  };
  const index = state.workflows.findIndex((candidate) => String(candidate.workflowFile || '').replace(/\\/g, '/').toLowerCase() === workflowFile.toLowerCase());
  if (index >= 0) state.workflows[index] = entry;
  else state.workflows.push(entry);
  state.workflows.sort((left, right) => left.workflowFile.localeCompare(right.workflowFile));
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: false });
  }
  return entry;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null) fail('N8N_POLICY_VALIDATION_FAILED', 'Workflow identity command arguments are invalid.');
    options[key.slice(2)] = value;
  }
  return options;
}

if (require.main === module) {
  try {
    const command = process.argv[2];
    const options = parseArgs(process.argv.slice(3));
    if (command === 'resolve') {
      const repositoryRoot = options['repo-root'] || process.cwd();
      const match = selectIdentity(readState(options.state, repositoryRoot), options['workflow-file'], options['workflow-name']);
      const resultPath = assertSafeResultPath(options.result);
      fs.writeFileSync(resultPath, `${JSON.stringify({ targetWorkflowId: match?.targetWorkflowId || '' })}\n`, { mode: 0o600, flag: 'wx' });
      console.log(match ? 'Local target workflow identity resolved internally.' : 'No local target workflow identity is recorded.');
    } else if (command === 'record') {
      recordIdentity(options.state, {
        workflowFile: options['workflow-file'],
        workflowName: options['workflow-name'],
        targetWorkflowId: options['target-workflow-id'],
      }, options['repo-root'] || process.cwd());
      console.log('Local target workflow identity recorded without printing its ID.');
    } else if (command === 'validate') {
      readState(options.state, options['repo-root'] || process.cwd());
      console.log('Local target workflow identity state is valid.');
    } else {
      fail('N8N_POLICY_VALIDATION_FAILED', 'Usage: node n8n-workflow-identity.cjs <resolve|record|validate> --state file ...');
    }
  } catch (error) {
    console.error(`${error.code || 'N8N_INTERNAL_ERROR'}: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  assertSafeIdentityPath,
  readState,
  selectIdentity,
  recordIdentity,
  assertSafeResultPath,
};
