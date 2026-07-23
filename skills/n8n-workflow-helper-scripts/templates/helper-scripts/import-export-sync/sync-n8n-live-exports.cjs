const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalWorkflowForGit,
  canonicaliseExport,
  mergeCredentialDeclarationDocument,
  selectWorkflowEntry,
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

  if (options.createMissingWorkflows) {
    fs.mkdirSync(workflowDir, { recursive: true });
  }

  options.portableCredentialsPath = options.portableCredentialsPath || path.join(workflowDir, 'toolkit', 'portable-credentials.json');
  options.portableCredentialsPath = assertStrictChild(workflowDir, options.portableCredentialsPath, 'Portable credential declaration');
  options.deploymentPolicyPath = options.deploymentPolicyPath || path.join(workflowDir, 'toolkit', 'deployment-policy.json');
  const deploymentPolicy = fs.existsSync(options.deploymentPolicyPath) ? readJson(options.deploymentPolicyPath) : null;
  let portableCredentialDocument = fs.existsSync(options.portableCredentialsPath)
    ? readJson(options.portableCredentialsPath)
    : { schemaVersion: 1, workflows: [] };
  const receiptWorkflows = [];

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

    const previousDeclaration = selectWorkflowEntry(portableCredentialDocument, liveWorkflow, target.workflowFile, 'credential declaration');
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
    fs.mkdirSync(path.dirname(target.workflowFile), { recursive: true });
    fs.writeFileSync(target.workflowFile, JSON.stringify(cleanWorkflow, null, 2) + '\n');
    const nextSize = fs.statSync(target.workflowFile).size;
    const verification = readWorkflow(target.workflowFile);
    writeStep(
      target.isNewWorkflow ? 'CREATE' : 'WRITE',
      `${path.basename(target.workflowFile)} ${previousSize} -> ${nextSize} bytes, active=${verification.active === false ? 'false' : String(verification.active)}, portable credential requirement(s)=${exportResult.declaration.nodes.length}`
    );
    if (exportResult.protectedChanges.length > 0) {
      writeStep('PROTECT', `${path.basename(target.workflowFile)} retained ${exportResult.protectedChanges.length} canonical protected value(s); use --reviewed-source-update only for an intentional reviewed source change.`);
    }
  }
  if (!options.credentialsOnly) {
    fs.mkdirSync(path.dirname(options.portableCredentialsPath), { recursive: true });
    fs.writeFileSync(options.portableCredentialsPath, JSON.stringify(portableCredentialDocument, null, 2) + '\n');
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

module.exports = { stripLiveOnlyFields, credentialBindings, buildTargets, parseArgs, assertStrictChild };
