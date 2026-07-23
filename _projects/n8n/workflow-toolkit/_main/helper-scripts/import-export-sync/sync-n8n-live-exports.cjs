const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalWorkflowForGit,
  canonicaliseExport,
  mergeCredentialDeclarationDocument,
  selectWorkflowEntry,
  validatePortableDocument,
} = require('./n8n-portable-workflow.cjs');
const { writeReport } = require('./n8n-workflow-operation-report.cjs');

function usage() {
  console.error('Usage: node scripts/sync-n8n-live-exports.cjs <exports-dir> <workflow-dir> [bindings.json] [--credentials-only] [--allow-missing-exports] [--preserve-tags] [--create-missing-workflows] [--sync-exported-only] [--portable-credentials=file] [--deployment-policy=file] [--reviewed-source-update]');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readWorkflow(filePath) {
  const raw = readJson(filePath);
  return Array.isArray(raw) ? raw[0] : raw.workflow || raw;
}

function readDeploymentPolicy(filePath, options = {}) {
  const required = options.required === true;
  if (!filePath || !fs.existsSync(filePath)) {
    if (required) {
      const error = new Error('An explicitly configured deployment policy is unavailable.');
      error.code = 'N8N_POLICY_VALIDATION_FAILED';
      throw error;
    }
    return undefined;
  }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    const error = new Error('The configured deployment policy could not be inspected safely.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error('The configured deployment policy must be a regular file.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
  if (typeof options.beforeRead === 'function') options.beforeRead();
  try {
    return readJson(filePath);
  } catch {
    const error = new Error('The configured deployment policy could not be read as JSON.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
}

function stripLiveOnlyFields(workflow, options = {}) {
  return canonicalWorkflowForGit(workflow, options);
}

function credentialBindings(workflow) {
  return (workflow.nodes || [])
    .filter((node) => node.credentials)
    .map((node) => ({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      credentials: node.credentials,
    }));
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/') || '.';
}

function displayPath(filePath) {
  return path.relative(process.cwd(), filePath) || '.';
}

function comparablePath(filePath) {
  const resolved = path.normalize(path.resolve(filePath)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertStrictChild(rootPath, targetPath, label) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain a strict child of the workflow directory.`);
  }
  let current = target;
  while (true) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || comparablePath(fs.realpathSync.native(current)) !== comparablePath(current)) {
        throw new Error(`${label} contains a symlink, junction, or reparse escape.`);
      }
    }
    if (comparablePath(current) === comparablePath(root)) break;
    current = path.dirname(current);
  }
  return target;
}

function transactionError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'N8N_INTERNAL_ERROR';
  return error;
}

function assertRegularOrMissing(filePath, label) {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw transactionError(`${label} must be a regular file.`);
  }
}

const CANONICAL_NEW_FILE_MODE = 0o644;

function permissionMode(statMode) {
  return statMode & 0o777;
}

function applyInstalledMode(filePath, mode) {
  if (process.platform === 'win32') return;
  fs.chmodSync(filePath, mode);
}

function assertInstalledMode(filePath, mode) {
  if (process.platform === 'win32') return;
  if (permissionMode(fs.statSync(filePath).mode) !== mode) {
    throw transactionError('Canonical transaction replacement mode verification failed.');
  }
}

function replaceFilesTransactionally(changes, hooks = {}) {
  if (!Array.isArray(changes) || changes.length === 0) return;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const foldedTargets = new Map();
  const resolvedTargets = changes.map((change) => path.resolve(change.targetPath));
  for (const target of resolvedTargets) {
    const folded = target.toLowerCase();
    if (foldedTargets.has(folded)) {
      const error = new Error('Duplicate or case-folded canonical transaction target blocks export.');
      error.code = 'N8N_WORKFLOW_MATCH_AMBIGUOUS';
      throw error;
    }
    foldedTargets.set(folded, target);
    assertRegularOrMissing(target, 'Canonical transaction target');
  }
  const records = changes.map((change, index) => {
    const target = resolvedTargets[index];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const stage = path.join(path.dirname(target), `.${path.basename(target)}.${token}.${index}.stage`);
    const backup = path.join(path.dirname(target), `.${path.basename(target)}.${token}.${index}.backup`);
    const rollbackStage = path.join(path.dirname(target), `.${path.basename(target)}.${token}.${index}.rollback`);
    assertRegularOrMissing(stage, 'Canonical transaction stage');
    assertRegularOrMissing(backup, 'Canonical transaction backup');
    assertRegularOrMissing(rollbackStage, 'Canonical transaction rollback stage');
    if (fs.existsSync(stage) || fs.existsSync(backup) || fs.existsSync(rollbackStage)) {
      throw transactionError('Canonical transaction staging path was not unique.');
    }
    return {
      ...change,
      target,
      stage,
      backup,
      rollbackStage,
      content: Buffer.from(change.content, 'utf8'),
      originalExists: fs.existsSync(target),
      originalContent: fs.existsSync(target) ? fs.readFileSync(target) : null,
      originalMode: fs.existsSync(target) ? fs.statSync(target).mode : null,
      installMode: fs.existsSync(target)
        ? permissionMode(fs.statSync(target).mode)
        : CANONICAL_NEW_FILE_MODE,
      originalMoved: false,
      installed: false,
    };
  });

  let preserveRecoveryArtifacts = false;
  try {
    for (const record of records) {
      fs.writeFileSync(record.stage, record.content, { flag: 'wx', mode: 0o600 });
      if (!fs.readFileSync(record.stage).equals(record.content)) {
        throw transactionError('Canonical transaction staging verification failed.');
      }
      if (typeof record.validate === 'function') record.validate(record.stage);
    }

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.originalExists) {
        fs.renameSync(record.target, record.backup);
        record.originalMoved = true;
      }
      fs.renameSync(record.stage, record.target);
      record.installed = true;
      applyInstalledMode(record.target, record.installMode);
      if (typeof hooks.beforeVerify === 'function') hooks.beforeVerify(record, index);
      if (!fs.readFileSync(record.target).equals(record.content)) {
        throw transactionError('Canonical transaction replacement verification failed.');
      }
      assertInstalledMode(record.target, record.installMode);
      if (typeof hooks.afterReplace === 'function') hooks.afterReplace(record, index);
    }

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.originalMoved && fs.existsSync(record.backup)) {
        if (typeof hooks.beforeBackupCleanup === 'function') hooks.beforeBackupCleanup(record, index);
        assertRegularOrMissing(record.backup, 'Canonical transaction backup');
        fs.rmSync(record.backup, { force: false });
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const record of [...records].reverse()) {
      try {
        if (record.installed && fs.existsSync(record.target)) {
          assertRegularOrMissing(record.target, 'Canonical transaction replacement');
          fs.rmSync(record.target, { force: false });
        }
        if (record.originalMoved && fs.existsSync(record.backup)) {
          assertRegularOrMissing(record.backup, 'Canonical transaction backup');
          fs.renameSync(record.backup, record.target);
        } else if (record.originalExists && !fs.existsSync(record.target)) {
          fs.writeFileSync(record.rollbackStage, record.originalContent, {
            flag: 'wx',
            mode: permissionMode(record.originalMode),
          });
          fs.renameSync(record.rollbackStage, record.target);
        }
        if (record.originalExists) {
          if (!fs.existsSync(record.target) || !fs.readFileSync(record.target).equals(record.originalContent)) {
            throw transactionError('Canonical transaction rollback verification failed.');
          }
          assertInstalledMode(record.target, permissionMode(record.originalMode));
        } else if (fs.existsSync(record.target)) {
          throw transactionError('Canonical transaction rollback left a newly created target behind.');
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveRecoveryArtifacts = true;
      throw transactionError('Canonical transaction rollback could not restore every original file.', error);
    }
    throw error;
  } finally {
    for (const record of records) {
      for (const temporary of [record.stage, record.backup, record.rollbackStage]) {
        if (preserveRecoveryArtifacts && (temporary === record.backup || temporary === record.rollbackStage)) continue;
        if (!fs.existsSync(temporary)) continue;
        try {
          assertRegularOrMissing(temporary, 'Canonical transaction temporary file');
          fs.rmSync(temporary, { force: false });
        } catch {
          // A failed rollback deliberately preserves its recovery artifact.
        }
      }
    }
  }
}

function writeStep(status, message) {
  console.log(`[${status.padEnd(7)}] ${message}`);
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const valueFor = (name) => {
    const prefix = `--${name}=`;
    const match = argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : '';
  };
  return {
    bindingsPath: positional[0] || path.join('.n8n-local', 'n8n-credential-bindings.json'),
    credentialsOnly: flags.has('--credentials-only'),
    allowMissingExports: flags.has('--allow-missing-exports'),
    preserveTags: flags.has('--preserve-tags'),
    createMissingWorkflows: flags.has('--create-missing-workflows'),
    syncExportedOnly: flags.has('--sync-exported-only'),
    portableCredentialsPath: valueFor('portable-credentials'),
    deploymentPolicyPath: valueFor('deployment-policy'),
    deploymentPolicyConfigured: argv.some((arg) => arg.startsWith('--deployment-policy=')),
    reviewedSourceUpdate: flags.has('--reviewed-source-update'),
  };
}

function listWorkflowFiles(workflowDir) {
  if (!fs.existsSync(workflowDir)) return [];
  return fs.readdirSync(workflowDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .sort()
    .map((fileName) => path.join(workflowDir, fileName));
}

function listExportFiles(exportsDir) {
  if (!fs.existsSync(exportsDir)) return [];
  return fs.readdirSync(exportsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.live-export.json'))
    .sort()
    .map((fileName) => path.join(exportsDir, fileName));
}

function exportBaseName(exportFile) {
  return path.basename(exportFile).replace(/\.live-export\.json$/i, '');
}

function buildTargets(exportsDir, workflowDir, createMissingWorkflows, syncExportedOnly) {
  const targetsByBaseName = new Map();

  if (syncExportedOnly) {
    for (const exportFile of listExportFiles(exportsDir)) {
      const baseName = exportBaseName(exportFile);
      const workflowFile = path.join(workflowDir, `${baseName}.json`);
      if (!fs.existsSync(workflowFile) && !createMissingWorkflows) {
        throw new Error(`Live export ${exportFile} has no matching repo workflow file ${workflowFile}. Use --create-missing-workflows only when creating repo files is intended.`);
      }
      targetsByBaseName.set(baseName, {
        baseName,
        workflowFile,
        exportFile,
        isNewWorkflow: !fs.existsSync(workflowFile),
      });
    }
    return [...targetsByBaseName.values()].sort((left, right) => left.baseName.localeCompare(right.baseName));
  }

  for (const workflowFile of listWorkflowFiles(workflowDir)) {
    const baseName = path.basename(workflowFile, path.extname(workflowFile));
    targetsByBaseName.set(baseName, {
      baseName,
      workflowFile,
      exportFile: path.join(exportsDir, `${baseName}.live-export.json`),
      isNewWorkflow: false,
    });
  }

  if (createMissingWorkflows) {
    for (const exportFile of listExportFiles(exportsDir)) {
      const baseName = exportBaseName(exportFile);
      if (!targetsByBaseName.has(baseName)) {
        targetsByBaseName.set(baseName, {
          baseName,
          workflowFile: path.join(workflowDir, `${baseName}.json`),
          exportFile,
          isNewWorkflow: true,
        });
      }
    }
  }

  return [...targetsByBaseName.values()].sort((left, right) => left.baseName.localeCompare(right.baseName));
}

function main() {
  const exportsDir = process.argv[2];
  const workflowDir = process.argv[3];
  const options = parseArgs(process.argv.slice(4));

  if (!exportsDir || !workflowDir) usage();

  options.portableCredentialsPath = options.portableCredentialsPath || path.join(workflowDir, 'toolkit', 'portable-credentials.json');
  options.portableCredentialsPath = assertStrictChild(workflowDir, options.portableCredentialsPath, 'Portable credential declaration');
  if (options.deploymentPolicyConfigured && !options.deploymentPolicyPath) {
    const error = new Error('An explicitly configured deployment policy is unavailable.');
    error.code = 'N8N_POLICY_VALIDATION_FAILED';
    throw error;
  }
  options.deploymentPolicyPath = options.deploymentPolicyPath || path.join(workflowDir, 'toolkit', 'deployment-policy.json');
  const deploymentPolicy = readDeploymentPolicy(options.deploymentPolicyPath, {
    required: options.deploymentPolicyConfigured,
  });
  validatePortableDocument(deploymentPolicy, 'deployment-policy');
  if (options.createMissingWorkflows) {
    fs.mkdirSync(workflowDir, { recursive: true });
  }
  let portableCredentialDocument = fs.existsSync(options.portableCredentialsPath)
    ? readJson(options.portableCredentialsPath)
    : { schemaVersion: 1, workflows: [] };
  validatePortableDocument(portableCredentialDocument, 'credential-declarations');
  const receiptWorkflows = [];
  const pendingWorkflowWrites = [];

  const targets = buildTargets(exportsDir, workflowDir, options.createMissingWorkflows, options.syncExportedOnly);
  if (!targets.length) {
    throw new Error(`No workflow JSON files found in ${workflowDir}`);
  }

  console.log('');
  console.log('== Sync live exports ==');
  console.log(`Mode          : ${options.credentialsOnly ? 'Credentials only' : 'Workflow JSON + credentials'}`);
  console.log(`Workflows     : ${targets.length}`);
  console.log(`Exports dir   : ${displayPath(exportsDir)}`);
  console.log(`Workflow dir  : ${displayPath(workflowDir)}`);
  console.log(`Tags          : ${options.preserveTags ? 'Preserved' : 'Stripped'}`);
  console.log(`Targets       : ${options.syncExportedOnly ? 'Exported files only' : 'Workflow directory files'}`);
  console.log(`Credentials   : ${options.credentialsOnly ? 'Local refresh only' : displayPath(options.portableCredentialsPath)}`);
  console.log(`Source update : ${options.reviewedSourceUpdate ? 'Reviewed protected-path update enabled' : 'Canonical protected paths retained'}`);

  const bindings = {
    version: 2,
    updatedAt: new Date().toISOString(),
    workflowDir: relativePath(workflowDir),
    workflows: [],
    skippedWorkflows: [],
  };

  let totalCredentialBindings = 0;
  for (const target of targets) {
    if (!fs.existsSync(target.exportFile)) {
      if (options.credentialsOnly && options.allowMissingExports) {
        bindings.skippedWorkflows.push({
          workflowFile: relativePath(target.workflowFile),
          reason: 'Missing live export',
        });
        writeStep('SKIP', `${path.basename(target.workflowFile)} has no live export; credential refresh skipped.`);
        continue;
      }

      throw new Error(`Missing live export for ${target.workflowFile}: expected ${target.exportFile}`);
    }

    const repoWorkflow = fs.existsSync(target.workflowFile) ? readWorkflow(target.workflowFile) : null;
    const liveWorkflow = readWorkflow(target.exportFile);

    if (repoWorkflow?.id && liveWorkflow.id && repoWorkflow.id !== liveWorkflow.id) {
      if (repoWorkflow.name !== liveWorkflow.name) {
        throw new Error(`Live export ID mismatch for ${displayPath(target.workflowFile)}: repo has ${repoWorkflow.id}, export has ${liveWorkflow.id}, and names differ (${repoWorkflow.name} != ${liveWorkflow.name})`);
      }
      if (liveWorkflow.isArchived === true) {
        throw new Error(`Live export ID mismatch for ${displayPath(target.workflowFile)}: matching by name is not allowed for archived live workflow ${liveWorkflow.id}`);
      }
      writeStep('ID', `${path.basename(target.workflowFile)} repo ${repoWorkflow.id} -> live ${liveWorkflow.id}`);
    }

    const nodeBindings = credentialBindings(liveWorkflow);
    totalCredentialBindings += nodeBindings.length;
    bindings.workflows.push({
      workflowFile: relativePath(target.workflowFile),
      workflowId: liveWorkflow.id || '',
      workflowName: liveWorkflow.name || '',
      sourceUpdatedAt: liveWorkflow.updatedAt || '',
      nodes: nodeBindings,
    });

    if (options.credentialsOnly) {
      writeStep('CRED', `${path.basename(target.workflowFile)} captured ${nodeBindings.length} credential binding(s).`);
      continue;
    }

    const previousDeclaration = selectWorkflowEntry(
      portableCredentialDocument,
      liveWorkflow,
      target.workflowFile,
      'credential declaration',
      'credential-declarations'
    );
    const exportResult = canonicaliseExport({
      liveWorkflow,
      canonicalWorkflow: repoWorkflow,
      workflowFile: target.workflowFile,
      deploymentPolicy,
      previousDeclaration,
      preserveTags: options.preserveTags,
      reviewedSourceUpdate: options.reviewedSourceUpdate,
    });
    const cleanWorkflow = exportResult.workflow;
    receiptWorkflows.push({ workflowFile: relativePath(target.workflowFile), workflowName: cleanWorkflow.name || '' });
    portableCredentialDocument = mergeCredentialDeclarationDocument(portableCredentialDocument, exportResult.declaration);
    const previousSize = fs.existsSync(target.workflowFile) ? fs.statSync(target.workflowFile).size : 0;
    const targetPath = assertStrictChild(workflowDir, target.workflowFile, 'Canonical workflow');
    const content = JSON.stringify(cleanWorkflow, null, 2) + '\n';
    pendingWorkflowWrites.push({
      targetPath,
      content,
      previousSize,
      nextSize: Buffer.byteLength(content),
      isNewWorkflow: target.isNewWorkflow,
      declarationCount: exportResult.declaration.nodes.length,
      protectedChangeCount: exportResult.protectedChanges.length,
      validate(stagePath) {
        const verification = readWorkflow(stagePath);
        if (verification.active !== false) throw transactionError('Staged canonical workflow must remain inactive.');
      },
    });
  }
  if (!options.credentialsOnly) {
    const declarationContent = JSON.stringify(portableCredentialDocument, null, 2) + '\n';
    replaceFilesTransactionally([
      ...pendingWorkflowWrites,
      {
        targetPath: options.portableCredentialsPath,
        content: declarationContent,
        validate(stagePath) {
          const parsed = readJson(stagePath);
          validatePortableDocument(parsed, 'credential-declarations', { allowAbsent: false });
        },
      },
    ]);
    for (const pending of pendingWorkflowWrites) {
      writeStep(
        pending.isNewWorkflow ? 'CREATE' : 'WRITE',
        `${path.basename(pending.targetPath)} ${pending.previousSize} -> ${pending.nextSize} bytes, active=false, portable credential requirement(s)=${pending.declarationCount}`
      );
      if (pending.protectedChangeCount > 0) {
        writeStep('PROTECT', `${path.basename(pending.targetPath)} retained ${pending.protectedChangeCount} canonical protected value(s); use --reviewed-source-update only for an intentional reviewed source change.`);
      }
    }
    writeStep('SAVE', `${displayPath(options.portableCredentialsPath)} portable credential declarations updated without target credential IDs.`);
  }

  fs.mkdirSync(path.dirname(options.bindingsPath), { recursive: true });
  fs.writeFileSync(options.bindingsPath, JSON.stringify(bindings, null, 2) + '\n');
  const bindingsSize = fs.statSync(options.bindingsPath).size;
  writeStep('SAVE', `${displayPath(options.bindingsPath)} ${bindingsSize} bytes, credential bindings=${totalCredentialBindings}, skipped=${bindings.skippedWorkflows.length}`);
  writeReport(path.join('.n8n-local', 'reports'), {
    operationType: options.credentialsOnly ? 'credential-metadata-refresh' : 'export',
    result: 'SUCCESS',
    code: 'N8N_EXPORT_SUCCESS',
    phase: 'receipt',
    workflows: receiptWorkflows,
    credentials: [],
    resources: [],
    mutation: { attempted: true, performed: true },
    activeState: 'inactive-canonical-source',
    executionState: 'not_executed',
    nextAction: { code: 'REVIEW_CANONICAL_DIFF', message: 'Review canonical workflow and portable declaration changes before committing.' },
    unchangedScope: ['activation', 'execution', 'credential values', 'exact local resource bindings'],
  });
  writeStep('REPORT', 'Sanitized export receipt written under .n8n-local/reports.');
}

if (require.main === module) {
  main();
}

module.exports = {
  stripLiveOnlyFields,
  credentialBindings,
  buildTargets,
  parseArgs,
  readDeploymentPolicy,
  assertStrictChild,
  replaceFilesTransactionally,
  CANONICAL_NEW_FILE_MODE,
};
