const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const { comparableWorkflow } = require(path.join(repoRoot, 'skills', 'n8n-workflow-helper-scripts', 'templates', 'helper-scripts', 'import-export-sync', 'should-import-n8n-workflow.cjs'));
const { selectBindingsWithMeta, restoreLiveWebhookIds } = require(path.join(repoRoot, 'skills', 'n8n-workflow-helper-scripts', 'templates', 'helper-scripts', 'import-export-sync', 'prepare-n8n-live-import.cjs'));

const scriptDir = path.join(repoRoot, 'skills', 'n8n-workflow-helper-scripts', 'templates', 'helper-scripts', 'import-export-sync');
const sourceScriptDir = path.join(repoRoot, '_projects', 'n8n', 'workflow-toolkit', '_main', 'helper-scripts', 'import-export-sync');
const sanitizerDir = path.join(repoRoot, 'skills', 'n8n-workflow-helper-scripts', 'templates', 'helper-scripts', 'sanitizer');
const sourceSanitizerDir = path.join(repoRoot, '_projects', 'n8n', 'workflow-toolkit', '_main', 'helper-scripts', 'sanitizer');
const secureCicdN8nTemplateDir = path.join(repoRoot, '_projects', 'cicd', 'secure-installer', '_main', 'templates', 'n8n');
const validateScript = path.join(scriptDir, 'validate-n8n-workflows.cjs');
const syncScript = path.join(scriptDir, 'sync-n8n-live-exports.cjs');
const prepareScript = path.join(scriptDir, 'prepare-n8n-live-import.cjs');
const compareCredentialsScript = path.join(scriptDir, 'compare-n8n-workflow-credentials.cjs');
const sourceLockAuditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs');
const sanitizerScript = path.join(sanitizerDir, 'prepare-n8n-template.js');
const sanitizerPs1 = path.join(sanitizerDir, 'sanitise-n8n-template.ps1');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-helper-test-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function findString(value, needle) {
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) return value.some((item) => findString(item, needle));
  if (value && typeof value === 'object') return Object.values(value).some((item) => findString(item, needle));
  return false;
}

function safeWorkflow(overrides = {}) {
  return {
    id: 'wf_safe',
    name: 'Safe Generic Workflow',
    active: false,
    nodes: [
      {
        id: 'trigger_1',
        name: 'Manual Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
    ],
    connections: {},
    settings: {},
    ...overrides,
  };
}

function runNode(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
  });
}

function findPowerShell() {
  for (const command of process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
    if (result.status === 0) return command;
  }
  return null;
}

function psSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runRepoRootResolverHarness(shell, helperScriptPath, helperDir) {
  fs.mkdirSync(helperDir, { recursive: true });
  const harnessPath = path.join(helperDir, 'resolver-harness.ps1');
  fs.writeFileSync(harnessPath, `
$ErrorActionPreference = "Stop"
$sourceFile = ${psSingleQuoted(helperScriptPath)}
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourceFile, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
  throw "Could not parse source helper: $($errors[0].Message)"
}
$functionNames = @(
  "Test-RepoRootPathIsUnsafe",
  "Test-N8nRepoRootCandidate",
  "Test-SanitizerRepoRootCandidate",
  "Resolve-RepoRootFromScript"
)
$functions = $ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $functionNames -contains $node.Name
}, $true)
foreach ($function in $functions) {
  $functionText = $function.Extent.Text.Replace('$PSScriptRoot', ${psSingleQuoted(helperDir)})
  Invoke-Expression $functionText
}
try {
  $root = Resolve-RepoRootFromScript
  Write-Output "ROOT=$root"
  exit 0
} catch {
  Write-Output "ERROR=$($_.Exception.Message)"
  exit 9
}
`, 'utf8');

  return spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harnessPath], {
    cwd: helperDir,
    encoding: 'utf8',
  });
}

function fakeMenuRepo(menuSourcePath) {
  const root = tempDir();
  const helperDir = path.join(root, 'helper-scripts');
  const scriptsDir = path.join(root, 'scripts');
  const previousDir = path.join(root, '.n8n-local');
  const markerPath = path.join(root, 'malicious-ran.txt');
  const trustedMarkerPath = path.join(root, 'trusted-ran.txt');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'n8n-workflows'), { recursive: true });
  fs.mkdirSync(helperDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(previousDir, { recursive: true });

  const menuPath = path.join(helperDir, 'n8n-workflow-sync-menu.ps1');
  const trustedExportScript = path.join(helperDir, 'export-n8n-workflows-live.ps1');
  const maliciousExportScript = path.join(scriptsDir, 'export-n8n-workflows-live.ps1');
  fs.copyFileSync(menuSourcePath, menuPath);
  fs.writeFileSync(trustedExportScript, `Set-Content -LiteralPath ${psSingleQuoted(trustedMarkerPath)} -Value 'trusted export executed'\n`, 'utf8');
  fs.writeFileSync(path.join(helperDir, 'import-n8n-workflows-live.ps1'), `Set-Content -LiteralPath ${psSingleQuoted(trustedMarkerPath)} -Value 'trusted import executed'\n`, 'utf8');
  fs.writeFileSync(path.join(helperDir, 'validate-n8n-workflows.cjs'), "console.log('trusted validation executed');\n", 'utf8');
  fs.writeFileSync(maliciousExportScript, `Set-Content -LiteralPath ${psSingleQuoted(markerPath)} -Value 'malicious export executed'\n`, 'utf8');

  return {
    root,
    helperDir,
    menuPath,
    previousPath: path.join(previousDir, 'n8n-sync-last-command.json'),
    trustedExportScript,
    maliciousExportScript,
    markerPath,
    trustedMarkerPath,
  };
}

test('prepare-n8n-template.js strips live fields and writes sanitized template output', () => {
  const cwd = tempDir();
  const inputPath = path.join(cwd, '.to-sanitise', 'workflow.json');
  const outputPath = path.join(cwd, '.sanitised', 'workflow.template.json');
  writeJson(inputPath, safeWorkflow({
    active: true,
    createdAt: '2026-05-16T00:00:00.000Z',
    staticData: { lastRun: 1 },
    pinData: { node: [] },
    nodes: [{
      id: 'http_1',
      name: 'HTTP Request',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4,
      position: [0, 0],
      webhookId: 'live-webhook-id',
      credentials: { httpHeaderAuth: { id: 'cred_1', name: 'Local Credential' } },
      parameters: {
        url: 'https://private.example.test/path',
        email: 'operator@example.test',
      },
    }],
  }));

  const result = runNode(sanitizerScript, [inputPath, outputPath, '--quiet'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(prepared.active, false);
  assert.equal('createdAt' in prepared, false);
  assert.equal('staticData' in prepared, false);
  assert.equal('pinData' in prepared, false);
  assert.equal('credentials' in prepared.nodes[0], false);
  assert.equal('webhookId' in prepared.nodes[0], false);
  assert.match(prepared.nodes[0].parameters.url, /^__SET_HTTP_REQUEST_URL__$/);
});

test('prepare-n8n-template.js sanitizes reusable config literals and expression defaults', () => {
  const cwd = tempDir();
  const inputPath = path.join(cwd, '.to-sanitise', 'workflow.json');
  const outputPath = path.join(cwd, '.sanitised', 'workflow.template.json');
  writeJson(inputPath, safeWorkflow({
    id: 'live-workflow-id',
    name: 'Config Defaults Test',
    active: true,
    nodes: [
      {
        id: 'node-1',
        name: 'Prepare Chunk Metadata',
        type: 'n8n-nodes-base.set',
        parameters: {
          assignments: {
            assignments: [
              {
                id: 'namespace-assignment',
                name: 'namespace',
                value: 'ExampleKnowledgeBase_kb',
                type: 'string',
              },
              {
                id: 'index-assignment',
                name: 'pinecone_index_name',
                value: 'example-knowledge-base-rag',
                type: 'string',
              },
            ],
          },
        },
      },
      {
        id: 'note-1',
        name: 'Sticky Note',
        type: 'n8n-nodes-base.stickyNote',
        parameters: {
          content: 'Namespace defaults to ExampleKnowledgeBase_kb for this workflow.',
        },
      },
      {
        id: 'node-code',
        name: 'Prepare Ingestion Log',
        type: 'n8n-nodes-base.code',
        parameters: {
          jsCode: "return [{ json: { namespace: $json.namespace || 'ExampleKnowledgeBase_kb' } }];",
        },
      },
      {
        id: 'node-2',
        name: 'Resolve Pinecone Index Host',
        type: 'n8n-nodes-base.httpRequest',
        parameters: {
          url: "={{ 'https://api.pinecone.io/indexes/' + encodeURIComponent($json.pinecone_index_name || 'example-knowledge-base-rag') }}",
        },
      },
      {
        id: 'node-3',
        name: 'Google Gemini Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        parameters: {
          modelName: 'models/gemini-3.1-flash-lite',
        },
      },
      {
        id: 'node-4',
        name: 'Send Lead Notification',
        type: 'n8n-nodes-base.emailSend',
        parameters: {
          message: "={{ $json.customer_name || 'Unknown customer' }}",
        },
      },
    ],
  }));

  const result = runNode(sanitizerScript, [inputPath, outputPath, '--quiet'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(prepared.active, false);
  assert.equal(findString(prepared, 'ExampleKnowledgeBase_kb'), false);
  assert.equal(findString(prepared, 'example-knowledge-base-rag'), false);
  assert.equal(findString(prepared, 'models/gemini-3.1-flash-lite'), false);
  assert.equal(findString(prepared, '__SET_PREPARE_CHUNK_METADATA_NAMESPACE__'), true);
  assert.equal(findString(prepared, '__SET_PREPARE_CHUNK_METADATA_PINECONE_INDEX_NAME__'), true);
  assert.equal(findString(prepared, '__SET_GOOGLE_GEMINI_CHAT_MODEL_MODELNAME__'), true);
  assert.equal(findString(prepared, 'Unknown customer'), true);
});

test('prepare-n8n-template.js keeps node names stable when replacing config literals in parameters', () => {
  const cwd = tempDir();
  const inputPath = path.join(cwd, '.to-sanitise', 'workflow.json');
  const outputPath = path.join(cwd, '.sanitised', 'workflow.template.json');
  const indexLiteral = 'example-node-name-index-rag';
  const sourceName = `Prepare ${indexLiteral}`;
  const targetName = `Use ${indexLiteral}`;
  writeJson(inputPath, safeWorkflow({
    id: 'live-workflow-id',
    name: 'Node Name Stability Test',
    active: true,
    nodes: [
      {
        id: 'source-node',
        name: sourceName,
        type: 'n8n-nodes-base.set',
        parameters: {
          assignments: {
            assignments: [
              {
                id: 'index-assignment',
                name: 'pinecone_index_name',
                value: indexLiteral,
                type: 'string',
              },
            ],
          },
        },
      },
      {
        id: 'target-node',
        name: targetName,
        type: 'n8n-nodes-base.set',
        parameters: {},
      },
    ],
    connections: {
      [sourceName]: {
        main: [[
          {
            node: targetName,
            type: 'main',
            index: 0,
          },
        ]],
      },
    },
  }));

  const result = runNode(sanitizerScript, [inputPath, outputPath, '--quiet'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const sourceNode = prepared.nodes.find((node) => node.id === 'source-node');
  const targetNode = prepared.nodes.find((node) => node.id === 'target-node');
  assert.equal(sourceNode.name, sourceName);
  assert.equal(targetNode.name, targetName);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared.connections, sourceName), true);
  assert.equal(prepared.connections[sourceName].main[0][0].node, targetName);
  assert.equal(findString(sourceNode.parameters, indexLiteral), false);
  assert.equal(findString(sourceNode.parameters, '__SET_PREPARE_EXAMPLE_NODE_NAME_INDEX_RAG_PINECONE_INDEX_NAME__'), true);
});

test('sanitise-n8n-template.ps1 dry-run creates staging folders but writes no sanitized templates', { skip: !findPowerShell() }, () => {
  const shell = findPowerShell();
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.mkdirSync(path.join(cwd, 'n8n-workflows'), { recursive: true });
  const localSanitizerDir = path.join(cwd, 'helper-scripts', 'sanitizer');
  fs.cpSync(path.dirname(sanitizerPs1), localSanitizerDir, { recursive: true });
  const localSanitizerPs1 = path.join(localSanitizerDir, 'sanitise-n8n-template.ps1');

  const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', localSanitizerPs1, '-DryRun'], {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.existsSync(path.join(cwd, '.to-sanitise')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.sanitised')), true);
  assert.equal(fs.readdirSync(path.join(cwd, '.sanitised')).length, 0);
});

test('sanitise-n8n-template.ps1 resolves co-located stripper script after helper rehome', { skip: !findPowerShell() }, () => {
  const shell = findPowerShell();
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.mkdirSync(path.join(cwd, 'n8n-workflows'), { recursive: true });
  const helperRoot = path.join(cwd, 'helper-scripts');
  const localSanitizerDir = path.join(helperRoot, 'sanitizer');
  fs.cpSync(path.dirname(sanitizerPs1), localSanitizerDir, { recursive: true });
  writeJson(path.join(cwd, '.to-sanitise', 'workflow.live-export.json'), safeWorkflow({
    id: 'wf_live',
    versionId: 'version_live',
    tags: [{ id: 'tag_live', name: 'Live' }],
  }));

  const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(localSanitizerDir, 'sanitise-n8n-template.ps1')], {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const outputPath = path.join(cwd, '.sanitised', 'workflow.template.json');
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(path.join(helperRoot, '.sanitised')), false);
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, 'versionId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, 'tags'), false);
});

test('validate-n8n-workflows.cjs defaults to n8n-workflows', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'safe.json'), safeWorkflow());

  const result = runNode(validateScript, [], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /n8n-workflows[\\/]safe\.json/);
});

test('validate-n8n-workflows.cjs passes safe generic placeholders', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'safe.json'), safeWorkflow({
    nodes: [
      {
        id: 'webhook_1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: 'GENERIC_WEBHOOK_ID',
        parameters: {
          responseEmail: 'ALERT_EMAIL',
          callbackUrl: 'SERVICE_URL',
          docsUrl: 'https://n8n.example.com/callback',
        },
      },
    ],
  }));

  const result = runNode(validateScript, [], { cwd });

  assert.equal(result.status, 0, result.stderr);
});

test('validate-n8n-workflows.cjs requires n8n-workflows unless prepared directories are explicitly allowed', () => {
  const cwd = tempDir();
  const preparedDir = path.join(cwd, '.tmp', 'n8n-live-import');
  writeJson(path.join(preparedDir, 'safe.json'), safeWorkflow());

  const strictResult = runNode(validateScript, [preparedDir], { cwd });
  assert.notEqual(strictResult.status, 0);
  assert.match(strictResult.stderr, /Only n8n-workflows is supported/);

  const preparedResult = runNode(validateScript, ['--allow-prepared-dir', preparedDir], { cwd });
  assert.equal(preparedResult.status, 0, preparedResult.stderr);
  assert.match(preparedResult.stdout, /\.tmp[\\/]n8n-live-import[\\/]safe\.json/);

  writeJson(path.join(preparedDir, 'unsafe.live-compare.json'), safeWorkflow({
    active: true,
    nodes: [
      {
        id: 'webhook_1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: 'live-webhook-id',
        parameters: {},
        credentials: {
          httpHeaderAuth: {
            id: 'live-credential-id',
            name: 'Live Credential',
          },
        },
      },
    ],
  }));
  writeJson(path.join(preparedDir, 'safe.live-import.json'), safeWorkflow({
    nodes: [
      {
        id: 'webhook_1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: 'live-webhook-id',
        parameters: {},
        credentials: {
          httpHeaderAuth: {
            id: 'live-credential-id',
            name: 'Live Credential',
          },
        },
      },
    ],
  }));

  const preparedImportResult = runNode(validateScript, ['--mode', 'prepared-import', preparedDir], { cwd });
  assert.equal(preparedImportResult.status, 0, preparedImportResult.stderr);
  assert.match(preparedImportResult.stdout, /\.tmp[\\/]n8n-live-import[\\/]safe\.live-import\.json/);
  assert.doesNotMatch(preparedImportResult.stdout, /unsafe\.live-compare\.json/);
  assert.doesNotMatch(preparedImportResult.stderr, /credentials\.id|real-looking webhookId|must have active: false/);
});

test('validate-n8n-workflows.cjs prepared-import mode still fails possible secrets', () => {
  const cwd = tempDir();
  const preparedDir = path.join(cwd, '.tmp', 'n8n-live-import');
  writeJson(path.join(preparedDir, 'unsafe.live-import.json'), safeWorkflow({
    nodes: [
      {
        id: 'http_1',
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [0, 0],
        parameters: {
          apiKey: `sk-${'123456789012345678901234'}`,
        },
      },
    ],
  }));

  const result = runNode(validateScript, ['--mode', 'prepared-import', preparedDir], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /possible secret: sk-prefixed API key/);
});

test('validate-n8n-workflows.cjs fails credentials.id', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'unsafe.json'), safeWorkflow({
    nodes: [
      {
        id: 'http_1',
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [0, 0],
        parameters: {},
        credentials: {
          httpHeaderAuth: {
            id: 'real-credential-id',
            name: 'Local Credential',
          },
        },
      },
    ],
  }));

  const result = runNode(validateScript, [], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /credentials\.id/);
});

test('validate-n8n-workflows.cjs has no SpaceKoncept-specific placeholder requirement', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'generic.json'), safeWorkflow({
    nodes: [
      {
        id: 'webhook_1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: 'CLIENT_WEBHOOK_ID',
        parameters: {
          ownerEmail: 'OWNER_EMAIL',
          folderId: 'DRIVE_FOLDER_ID',
        },
      },
    ],
  }));

  const result = runNode(validateScript, [], { cwd });

  assert.equal(result.status, 0, result.stderr);
});

test('validate-n8n-workflows.cjs does not auto-load project validation rules by default', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'generic.json'), safeWorkflow());
  fs.mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'scripts', 'n8n-workflow-validation-rules.cjs'),
    [
      'module.exports.validateWorkflow = function validateWorkflow(context) {',
      "  context.fail(`${context.relative} custom rule failed`);",
      '};',
      '',
    ].join('\n')
  );

  const result = runNode(validateScript, [], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /custom rule failed/);
  assert.doesNotMatch(result.stdout, /Using validation rule scripts[\\/]n8n-workflow-validation-rules\.cjs/);
});

test('validate-n8n-workflows.cjs loads explicitly configured validation rules', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'generic.json'), safeWorkflow());
  fs.mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'scripts', 'n8n-workflow-validation-rules.cjs'),
    [
      'module.exports.validateWorkflow = function validateWorkflow(context) {',
      "  context.fail(`${context.relative} explicit custom rule failed`);",
      '};',
      '',
    ].join('\n')
  );

  const result = runNode(validateScript, [], {
    cwd,
    env: {
      N8N_WORKFLOW_VALIDATION_RULES: 'scripts/n8n-workflow-validation-rules.cjs',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit custom rule failed/);
  assert.match(result.stdout, /Using validation rule scripts[\\/]n8n-workflow-validation-rules\.cjs/);
});

test('validate-n8n-workflows.cjs autoloads default validation rules only for exact truthy values', () => {
  for (const value of ['1', 'true', 'yes', 'on']) {
    const cwd = tempDir();
    writeJson(path.join(cwd, 'n8n-workflows', 'generic.json'), safeWorkflow());
    fs.mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'scripts', 'n8n-workflow-validation-rules.cjs'),
      [
        'module.exports.validateWorkflow = function validateWorkflow(context) {',
        "  context.fail(`${context.relative} autoload custom rule failed`);",
        '};',
        '',
      ].join('\n')
    );

    const result = runNode(validateScript, [], {
      cwd,
      env: {
        N8N_WORKFLOW_VALIDATION_RULES_AUTOLOAD: value,
      },
    });

    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /autoload custom rule failed/, value);
    assert.match(result.stdout, /Using validation rule scripts[\\/]n8n-workflow-validation-rules\.cjs/, value);
  }
});

test('validate-n8n-workflows.cjs does not autoload default validation rules for partial truthy values', () => {
  for (const value of ['truex', 'xtrue', 'yesplease', 'only-on']) {
    const cwd = tempDir();
    writeJson(path.join(cwd, 'n8n-workflows', 'generic.json'), safeWorkflow());
    fs.mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'scripts', 'n8n-workflow-validation-rules.cjs'),
      [
        'module.exports.validateWorkflow = function validateWorkflow(context) {',
        "  context.fail(`${context.relative} partial autoload rule failed`);",
        '};',
        '',
      ].join('\n')
    );

    const result = runNode(validateScript, [], {
      cwd,
      env: {
        N8N_WORKFLOW_VALIDATION_RULES_AUTOLOAD: value,
      },
    });

    assert.equal(result.status, 0, `${value}\n${result.stderr}`);
    assert.doesNotMatch(result.stderr, /partial autoload rule failed/, value);
    assert.doesNotMatch(result.stdout, /Using validation rule scripts[\\/]n8n-workflow-validation-rules\.cjs/, value);
  }
});

test('validate-n8n-workflows.cjs fails when configured validation rule is missing', () => {
  const cwd = tempDir();
  writeJson(path.join(cwd, 'n8n-workflows', 'generic.json'), safeWorkflow());

  const result = runNode(validateScript, [], {
    cwd,
    env: {
      N8N_WORKFLOW_VALIDATION_RULES: 'n8n-validation/missing-validation-rule.cjs',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Configured n8n workflow validation rule not found: n8n-validation[\\/]missing-validation-rule\.cjs/);
});

test('generated n8n helper scripts are fresh copies of project source', () => {
  for (const fileName of [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
    'n8n-workflow-sync-menu.ps1',
    'prepare-n8n-live-import.cjs',
    'compare-n8n-workflow-credentials.cjs',
    'sync-n8n-live-exports.cjs',
    'should-import-n8n-workflow.cjs',
    'validate-n8n-workflows.cjs',
  ]) {
    assert.equal(readText(path.join(scriptDir, fileName)), readText(path.join(sourceScriptDir, fileName)), fileName);
  }

  for (const fileName of [
    '_sanitise-n8n-template.cmd',
    'prepare-n8n-template.js',
    'sanitise-n8n-template.ps1',
  ]) {
    assert.equal(readText(path.join(sanitizerDir, fileName)), readText(path.join(sourceSanitizerDir, fileName)), fileName);
  }
});

test('Secure CI/CD n8n helper templates stay aligned with workflow toolkit source', () => {
  for (const fileName of [
    '_export-n8n-workflows-live.cmd',
    '_import-n8n-workflows-live.cmd',
    'compare-n8n-workflow-credentials.cjs',
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
    'n8n-workflow-sync-menu.ps1',
    'prepare-n8n-live-import.cjs',
    'should-import-n8n-workflow.cjs',
    'sync-n8n-live-exports.cjs',
    'validate-n8n-workflows.cjs',
  ]) {
    assert.equal(readText(path.join(secureCicdN8nTemplateDir, fileName)), readText(path.join(sourceScriptDir, fileName)), fileName);
  }
});

test('n8n command wrappers use framed colored retry output', () => {
  for (const [label, filePath] of [
    ['workflow toolkit export wrapper', path.join(sourceScriptDir, '_export-n8n-workflows-live.cmd')],
    ['workflow toolkit import wrapper', path.join(sourceScriptDir, '_import-n8n-workflows-live.cmd')],
    ['workflow toolkit sanitizer wrapper', path.join(sourceSanitizerDir, '_sanitise-n8n-template.cmd')],
    ['generated export wrapper', path.join(scriptDir, '_export-n8n-workflows-live.cmd')],
    ['generated import wrapper', path.join(scriptDir, '_import-n8n-workflows-live.cmd')],
    ['generated sanitizer wrapper', path.join(sanitizerDir, '_sanitise-n8n-template.cmd')],
    ['Secure CI/CD export wrapper', path.join(secureCicdN8nTemplateDir, '_export-n8n-workflows-live.cmd')],
    ['Secure CI/CD import wrapper', path.join(secureCicdN8nTemplateDir, '_import-n8n-workflows-live.cmd')],
  ]) {
    const text = readText(filePath);

    assert.match(text, /call :banner /, label);
    assert.match(text, /call :prompt "Press R to run again or E to exit\."/, label);
    assert.match(text, /:banner/, label);
    assert.match(text, /:prompt/, label);
    assert.match(text, /DarkCyan/, label);
    assert.match(text, /Yellow/, label);
    assert.match(text, /:status/, label);
    assert.match(text, /if errorlevel 2 exit \/b %LAST_EXIT%\s+cls\s+goto run_/, label);
    assert.match(text, /:resolve_powershell/, label);
    assert.match(text, /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i, label);
    assert.match(text, /set "POWERSHELL_EXE=/, label);
    assert.match(text, /"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0[^"]+\.ps1"/, label);
    assert.doesNotMatch(text, /(^|\r?\n)\s*powershell\b/i, label);
    assert.doesNotMatch(text, /(^|\r?\n)\s*pwsh\b/i, label);

    if (label.includes('export wrapper')) {
      assert.match(text, /"%~dp0export-n8n-workflows-live\.ps1"/, label);
    } else if (label.includes('import wrapper')) {
      assert.match(text, /"%~dp0import-n8n-workflows-live\.ps1"/, label);
    } else {
      assert.match(text, /"%~dp0sanitise-n8n-template\.ps1"/, label);
    }

    if (label.includes('import wrapper')) {
      assert.match(text, /:configure_restart/, label);
      assert.match(text, /RestartContainerAfterImport/, label);
      assert.match(text, /Auto-restart n8n container if restart warning is true\?/, label);
    }
  }
});

test('PowerShell n8n helper scripts use colored sections, status tags, and clean failure blocks', () => {
  for (const [label, filePath] of [
    ['workflow toolkit export helper', path.join(sourceScriptDir, 'export-n8n-workflows-live.ps1')],
    ['workflow toolkit import helper', path.join(sourceScriptDir, 'import-n8n-workflows-live.ps1')],
    ['workflow toolkit menu helper', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['workflow toolkit sanitizer helper', path.join(sourceSanitizerDir, 'sanitise-n8n-template.ps1')],
    ['generated export helper', path.join(scriptDir, 'export-n8n-workflows-live.ps1')],
    ['generated import helper', path.join(scriptDir, 'import-n8n-workflows-live.ps1')],
    ['generated menu helper', path.join(scriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['generated sanitizer helper', path.join(sanitizerDir, 'sanitise-n8n-template.ps1')],
    ['Secure CI/CD export helper', path.join(secureCicdN8nTemplateDir, 'export-n8n-workflows-live.ps1')],
    ['Secure CI/CD import helper', path.join(secureCicdN8nTemplateDir, 'import-n8n-workflows-live.ps1')],
    ['Secure CI/CD menu helper', path.join(secureCicdN8nTemplateDir, 'n8n-workflow-sync-menu.ps1')],
  ]) {
    const text = readText(filePath);

    assert.match(text, /function Write-Section\(\$Title\)/, label);
    assert.match(text, /ForegroundColor Cyan/, label);
    assert.match(text, /function Get-StatusColor\(\$Status\)/, label);
    assert.match(text, /function Write-StatusTag\(\$Status\)/, label);
    assert.match(text, /ForegroundColor \(Get-StatusColor \$statusText\)/, label);
  }

  for (const [label, filePath] of [
    ['workflow toolkit export helper', path.join(sourceScriptDir, 'export-n8n-workflows-live.ps1')],
    ['workflow toolkit import helper', path.join(sourceScriptDir, 'import-n8n-workflows-live.ps1')],
    ['generated export helper', path.join(scriptDir, 'export-n8n-workflows-live.ps1')],
    ['generated import helper', path.join(scriptDir, 'import-n8n-workflows-live.ps1')],
    ['Secure CI/CD export helper', path.join(secureCicdN8nTemplateDir, 'export-n8n-workflows-live.ps1')],
    ['Secure CI/CD import helper', path.join(secureCicdN8nTemplateDir, 'import-n8n-workflows-live.ps1')],
  ]) {
    const text = readText(filePath);

    assert.match(text, /function Write-CommandOutput\(\$Lines, \[string\]\$DefaultStatus = "INFO"\)/, label);
    assert.match(text, /"WRITE", "SAVE"/, label);
    assert.match(text, /\^==\\s\*\(\.\+\?\)\\s\*==\$/, label);
    assert.match(text, /\^Checked\\s\+/, label);
  }

  for (const [label, filePath, title] of [
    ['workflow toolkit export helper', path.join(sourceScriptDir, 'export-n8n-workflows-live.ps1'), 'Export failed'],
    ['workflow toolkit import helper', path.join(sourceScriptDir, 'import-n8n-workflows-live.ps1'), 'Import failed'],
    ['workflow toolkit sanitizer helper', path.join(sourceSanitizerDir, 'sanitise-n8n-template.ps1'), 'Sanitise failed'],
    ['generated export helper', path.join(scriptDir, 'export-n8n-workflows-live.ps1'), 'Export failed'],
    ['generated import helper', path.join(scriptDir, 'import-n8n-workflows-live.ps1'), 'Import failed'],
    ['generated sanitizer helper', path.join(sanitizerDir, 'sanitise-n8n-template.ps1'), 'Sanitise failed'],
    ['Secure CI/CD export helper', path.join(secureCicdN8nTemplateDir, 'export-n8n-workflows-live.ps1'), 'Export failed'],
    ['Secure CI/CD import helper', path.join(secureCicdN8nTemplateDir, 'import-n8n-workflows-live.ps1'), 'Import failed'],
  ]) {
    const text = readText(filePath);

    assert.match(text, /trap \{[\s\S]*ForegroundColor Red[\s\S]*exit 1[\s\S]*\}/, label);
    assert.match(text, new RegExp(title), label);
    assert.doesNotMatch(text, new RegExp(`Write-Host "== ${title} =="`), label);
  }
});

test('n8n hook and validation extension points stay generic and product agnostic', () => {
  const text = [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
    'validate-n8n-workflows.cjs',
  ].map((fileName) => readText(path.join(scriptDir, fileName))).join('\n');

  assert.match(text, /N8N_WORKFLOW_HOOK_SCRIPT/);
  assert.match(text, /n8n-workflow-hooks/);
  assert.match(text, /N8N_WORKFLOW_VALIDATION_RULES/);
  assert.match(text, /N8N_WORKFLOW_VALIDATION_RULES_AUTOLOAD/);
  assert.match(text, /N8N_WORKFLOW_HOOK_AUTOLOAD/);
  assert.match(text, /n8n-workflow-validation-rules/);
  assert.doesNotMatch(text, /SpaceKoncept|SPACEKONCEPT|Groq/i);
  assert.doesNotMatch(text, /ui-ux-pro-max|design-system-generator/);
});

test('PowerShell n8n hooks use a resolved host instead of hardcoded Windows PowerShell', () => {
  for (const fileName of [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
  ]) {
    const text = readText(path.join(scriptDir, fileName));

    assert.match(text, /function Resolve-PowerShellHookCommand/);
    assert.match(text, /GetCurrentProcess\(\)\.Path/);
    assert.match(text, /@\("pwsh", "powershell"\)/);
    assert.doesNotMatch(text, /\$command = "powershell"/);
  }
});

test('PowerShell n8n hooks require configured hook scripts but keep defaults optional', () => {
  for (const fileName of [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
  ]) {
    const text = readText(path.join(scriptDir, fileName));

    assert.match(text, /N8N_WORKFLOW_HOOK_SCRIPT[\s\S]*Add-HookScriptCandidate \$hookPath \$true/);
    assert.match(text, /N8N_WORKFLOW_HOOK_AUTOLOAD/);
    assert.match(text, /Add-HookScriptCandidate \$relativePath \$false/);
    assert.match(text, /"scripts\/n8n-workflow-hooks\.cjs"/);
    assert.match(text, /"\.n8n-local\/n8n-workflow-hooks\.cjs"/);
    assert.doesNotMatch(text, /scripts\\n8n-workflow-hooks/);
    assert.doesNotMatch(text, /\.n8n-local\\n8n-workflow-hooks/);
    assert.match(text, /Configured n8n workflow hook script not found/);
    assert.match(text, /elseif \(\$candidate\.Required\)/);
    assert.match(text, /Get-DisplayPath \$script/);
    assert.doesNotMatch(text, /ConvertTo-RepoRelativePath/);
  }
});

test('PowerShell n8n hook autoload uses exact opt-in matching', () => {
  for (const fileName of [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
  ]) {
    const text = readText(path.join(scriptDir, fileName));
    const autoloadBlock = text.match(/\$env:N8N_WORKFLOW_HOOK_AUTOLOAD -match '([^']+)'[\s\S]*?Add-HookScriptCandidate \$relativePath \$false/);
    assert.ok(autoloadBlock, `${fileName} hook autoload block not found`);
    assert.equal(autoloadBlock[1], '^(?i:true|1|yes|on)$', fileName);
  }
});

test('import helper guards hooks, no-op imports, and prepared payload revalidation', () => {
  for (const [label, filePath] of [
    ['workflow toolkit import helper', path.join(sourceScriptDir, 'import-n8n-workflows-live.ps1')],
    ['generated import helper', path.join(scriptDir, 'import-n8n-workflows-live.ps1')],
    ['Secure CI/CD import helper', path.join(secureCicdN8nTemplateDir, 'import-n8n-workflows-live.ps1')],
  ]) {
    const text = readText(filePath);

    assert.match(text, /if \(-not \$DryRun\) \{\s*Invoke-ProjectWorkflowHook "before-import-validation"/, label);
    assert.match(text, /Initialize-RunDirectory \$PreparedDirPath/, label);
    assert.doesNotMatch(text, /New-Item -ItemType Directory -Force -Path \$PreparedDirPath/, label);

    const noPlannedImportIndex = text.indexOf('if ($preflight.PlannedImports.Count -eq 0)');
    const beforeLiveImportIndex = text.indexOf('Invoke-ProjectWorkflowHook "before-live-import"');
    const revalidationIndex = text.indexOf('Write-Section "Prepared Workflow Re-Validation"');
    const importIndex = text.indexOf('Write-Section "Import"');
    assert.notEqual(noPlannedImportIndex, -1, label);
    assert.notEqual(beforeLiveImportIndex, -1, label);
    assert.notEqual(revalidationIndex, -1, label);
    assert.notEqual(importIndex, -1, label);
    assert.ok(noPlannedImportIndex < beforeLiveImportIndex, `${label}: no-op import must exit before before-live-import hook`);
    assert.ok(beforeLiveImportIndex < revalidationIndex, `${label}: prepared revalidation must run after before-live-import hook`);
    assert.ok(revalidationIndex < importIndex, `${label}: prepared revalidation must run before live import`);
    assert.match(text, /validate-n8n-workflows\.cjs"\), "--mode", "prepared-import", \$PreparedDirPath/, label);
    assert.match(text, /Write-CommandOutput \$validationResult\.StdOut "VALID"/, label);
    assert.match(text, /Write-CommandOutput \$preparedValidationResult\.StdOut "VALID"/, label);
    assert.match(text, /Prepared workflow JSON validation failed after before-live-import hook/, label);
    assert.match(text, /Live n8n was not changed\./, label);
  }
});

test('export helper formats sync live export output through colored sections and tags', () => {
  for (const [label, filePath] of [
    ['workflow toolkit export helper', path.join(sourceScriptDir, 'export-n8n-workflows-live.ps1')],
    ['generated export helper', path.join(scriptDir, 'export-n8n-workflows-live.ps1')],
    ['Secure CI/CD export helper', path.join(secureCicdN8nTemplateDir, 'export-n8n-workflows-live.ps1')],
  ]) {
    const text = readText(filePath);

    assert.match(text, /Write-CommandOutput \$syncResult\.Output/, label);
    assert.doesNotMatch(text, /Write-Host \(\$syncResult\.Output -join "`n"\)/, label);
  }
});

test('n8n workflow toolkit source lock audit passes for adapted helper hardening', () => {
  const result = runNode(sourceLockAuditScript, [], { cwd: repoRoot });

  assert.equal(result.status, 0, result.stderr);
});

test('PowerShell n8n repo root resolver ignores nested gitignore files', () => {
  for (const fileName of [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
    'n8n-workflow-sync-menu.ps1',
  ]) {
    const text = readText(path.join(scriptDir, fileName));
    const resolverMatch = text.match(/function Resolve-RepoRootFromScript \{[\s\S]*?\n\}/);
    assert.ok(resolverMatch, `${fileName} resolver not found`);
    const resolver = resolverMatch[0];

    assert.match(text, /function Test-N8nRepoRootCandidate\(\$Path\)/);
    assert.match(text, /Join-Path \$Path "\.git"/);
    assert.match(text, /Join-Path \$Path "n8n-workflows"/);
    assert.doesNotMatch(resolver, /\.gitignore/);
  }
});

test('PowerShell n8n repo root resolver accepts a repo with git and n8n-workflows markers', { skip: !findPowerShell() }, () => {
  const shell = findPowerShell();
  for (const [label, helperScriptPath, helperSubdir] of [
    ['export helper', path.join(sourceScriptDir, 'export-n8n-workflows-live.ps1'), path.join('scripts')],
    ['import helper', path.join(sourceScriptDir, 'import-n8n-workflows-live.ps1'), path.join('scripts')],
    ['menu helper', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1'), path.join('scripts')],
    ['sanitizer helper', path.join(sourceSanitizerDir, 'sanitise-n8n-template.ps1'), path.join('scripts', 'sanitizer')],
  ]) {
    const repo = tempDir();
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'n8n-workflows'), { recursive: true });
    const helperDir = path.join(repo, helperSubdir);

    const result = runRepoRootResolverHarness(shell, helperScriptPath, helperDir);

    assert.equal(result.status, 0, `${label}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`ROOT=${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), label);
  }
});

test('PowerShell n8n repo root resolver rejects n8n-workflows-only fake drive roots before scratch creation', { skip: !findPowerShell() }, () => {
  const shell = findPowerShell();
  for (const [label, helperScriptPath, helperSubdir] of [
    ['export helper', path.join(sourceScriptDir, 'export-n8n-workflows-live.ps1'), path.join('scripts')],
    ['import helper', path.join(sourceScriptDir, 'import-n8n-workflows-live.ps1'), path.join('scripts')],
    ['menu helper', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1'), path.join('scripts')],
    ['sanitizer helper', path.join(sourceSanitizerDir, 'sanitise-n8n-template.ps1'), path.join('scripts', 'sanitizer')],
  ]) {
    const fakeDriveRoot = tempDir();
    fs.mkdirSync(path.join(fakeDriveRoot, 'n8n-workflows'), { recursive: true });
    const helperDir = path.join(fakeDriveRoot, helperSubdir);

    const result = runRepoRootResolverHarness(shell, helperScriptPath, helperDir);

    assert.notEqual(result.status, 0, `${label} accepted unsafe root\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, /Could not resolve safe repo root|Refusing filesystem root/, label);
    assert.equal(fs.existsSync(path.join(fakeDriveRoot, '.tmp')), false, `${label} created .tmp outside a safe repo`);
    assert.equal(fs.existsSync(path.join(fakeDriveRoot, '.to-sanitise')), false, `${label} created .to-sanitise outside a safe repo`);
    assert.equal(fs.existsSync(path.join(fakeDriveRoot, '.sanitised')), false, `${label} created .sanitised outside a safe repo`);
  }
});

test('PowerShell n8n import and export scratch directories are rooted under resolved repo root', () => {
  const exportText = readText(path.join(scriptDir, 'export-n8n-workflows-live.ps1'));
  const importText = readText(path.join(scriptDir, 'import-n8n-workflows-live.ps1'));

  assert.match(exportText, /\$ExportDirPath = Join-Path \$RepoRoot \$ExportDir/);
  assert.match(importText, /\$PreparedDirPath = Join-Path \$RepoRoot \$PreparedDir/);
  assert.match(importText, /\$CredentialExportDirPath = Join-Path \$RepoRoot \$CredentialExportDir/);

  for (const [label, text] of [
    ['export helper', exportText],
    ['import helper', importText],
    ['menu helper', readText(path.join(scriptDir, 'n8n-workflow-sync-menu.ps1'))],
  ]) {
    assert.match(text, /function Test-RepoRootPathIsUnsafe\(\$Path\)/, label);
    assert.match(text, /function Test-N8nRepoRootCandidate\(\$Path\)/, label);
    assert.match(text, /Refusing filesystem root as repo root/, label);
    assert.doesNotMatch(text, /return \$current[\s\S]*Join-Path \$current "n8n-workflows"[\s\S]*-or/, label);
  }
});

test('PowerShell n8n helper scripts keep local staging and history at repo root after rehome', () => {
  const sanitizerText = readText(path.join(sanitizerDir, 'sanitise-n8n-template.ps1'));
  assert.match(sanitizerText, /function Resolve-RepoRootFromScript/);
  assert.match(sanitizerText, /\$RepoRoot = Resolve-RepoRootFromScript/);
  assert.match(sanitizerText, /\$StripperScript = Join-Path \$PSScriptRoot "prepare-n8n-template\.js"/);
  assert.doesNotMatch(sanitizerText, /Join-Path \$RepoRoot "scripts[\\/]prepare-n8n-template\.js"/);

  const menuText = readText(path.join(scriptDir, 'n8n-workflow-sync-menu.ps1'));
  for (const [label, text] of [
    ['workflow toolkit menu', menuText],
    ['Secure CI/CD preserved menu', readText(path.join(secureCicdN8nTemplateDir, 'n8n-workflow-sync-menu.ps1'))],
  ]) {
    assert.match(text, /function Resolve-RepoRootFromScript/, label);
    assert.match(text, /\$RepoRoot = Resolve-RepoRootFromScript/, label);
    assert.match(text, /\$PreviousCommandFile = Join-Path \$RepoRoot "\.n8n-local\\n8n-sync-last-command\.json"/, label);
    assert.doesNotMatch(text, /\$RepoRoot = \(Resolve-Path \(Join-Path \$PSScriptRoot "\.\."\)\)\.Path/, label);
  }
});

test('n8n workflow sync menus resolve helper commands from their own folder', () => {
  for (const [label, filePath] of [
    ['workflow toolkit source menu', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['workflow toolkit generated menu', path.join(scriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['Secure CI/CD preserved menu', path.join(secureCicdN8nTemplateDir, 'n8n-workflow-sync-menu.ps1')],
  ]) {
    const text = readText(filePath);

    assert.match(text, /\$HelperScriptDir = \(Resolve-Path -LiteralPath \$PSScriptRoot\)\.Path/, label);
    assert.match(text, /\$ExportHelperScript = Join-Path \$HelperScriptDir "export-n8n-workflows-live\.ps1"/, label);
    assert.match(text, /\$ImportHelperScript = Join-Path \$HelperScriptDir "import-n8n-workflows-live\.ps1"/, label);
    assert.match(text, /\$ValidateHelperScript = Join-Path \$HelperScriptDir "validate-n8n-workflows\.cjs"/, label);
    assert.match(text, /\$TrustedExportHelperScript = Resolve-TrustedHelperPath \$ExportHelperScript "export helper"/, label);
    assert.match(text, /\$TrustedImportHelperScript = Resolve-TrustedHelperPath \$ImportHelperScript "import helper"/, label);
    assert.match(text, /\$TrustedValidateHelperScript = Resolve-TrustedHelperPath \$ValidateHelperScript "validation helper"/, label);
    assert.match(text, /Resolve-Path -LiteralPath/, label);
    assert.match(text, /Get-Command node -CommandType Application -ErrorAction Stop/, label);
    assert.match(text, /\$NodeCommandPath/, label);
    assert.doesNotMatch(text, /New-CommandRecord\s+[^`r`n]*"node"/, label);
    assert.doesNotMatch(text, /&\s+node\b/, label);
    assert.doesNotMatch(text, /"\.\\scripts\\export-n8n-workflows-live\.ps1"/, label);
    assert.doesNotMatch(text, /"\.\\scripts\\import-n8n-workflows-live\.ps1"/, label);
    assert.doesNotMatch(text, /"scripts\/validate-n8n-workflows\.cjs"/, label);
    assert.doesNotMatch(text, /scripts\\\\export-n8n-workflows-live\.ps1/, label);
    assert.doesNotMatch(text, /scripts\\\\import-n8n-workflows-live\.ps1/, label);
  }
});

test('n8n workflow sync menus validate saved previous commands before replay', () => {
  for (const [label, filePath] of [
    ['workflow toolkit source menu', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['workflow toolkit generated menu', path.join(scriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['Secure CI/CD preserved menu', path.join(secureCicdN8nTemplateDir, 'n8n-workflow-sync-menu.ps1')],
  ]) {
    const text = readText(filePath);
    const invokeUsePreviousStart = text.indexOf('function Invoke-UsePrevious');
    const clearPreviousStart = text.indexOf('function Clear-PreviousCommand');
    assert.notEqual(invokeUsePreviousStart, -1, `${label} Invoke-UsePrevious not found`);
    assert.notEqual(clearPreviousStart, -1, `${label} Clear-PreviousCommand not found`);
    const invokeUsePrevious = text.slice(invokeUsePreviousStart, clearPreviousStart);
    const trustCheckIndex = invokeUsePrevious.indexOf('Test-TrustedCommandRecord $previous');
    const invokeIndex = invokeUsePrevious.indexOf('Invoke-CommandRecord $previous');

    assert.match(text, /function Test-TrustedCommandRecord\(\$Record\)/, label);
    assert.match(text, /schemaVersion = \$CommandSchemaVersion/, label);
    assert.match(text, /commandKind = \$CommandKind/, label);
    assert.match(text, /helperScriptDir = \$HelperScriptDir/, label);
    assert.match(text, /schemaVersion", "commandKind", "commandName", "script", "args", "helperScriptDir"/, label);
    assert.match(text, /Test-ExportCommandArgs \$args/, label);
    assert.match(text, /Test-ImportCommandArgs \$args/, label);
    assert.match(text, /\$recordValidateScript = Resolve-CanonicalPathOrNull \$args\[0\]/, label);
    assert.match(text, /\$recordScript -ne \$TrustedExportHelperScript/, label);
    assert.match(text, /\$recordScript -ne \$TrustedImportHelperScript/, label);
    assert.match(text, /\$recordScript -ne \$trustedNodePath/, label);
    assert.match(text, /ProjectId[\s\S]*UserId/, label);
    assert.match(text, /Saved previous command is from an older or untrusted format\. Clear previous command and rebuild it from the menu\./, label);
    assert.match(text, /Saved previous command is not trusted\. Clear previous command and rebuild it from the menu\./, label);
    assert.notEqual(trustCheckIndex, -1, `${label} previous command trust check not found`);
    assert.notEqual(invokeIndex, -1, `${label} previous command invocation not found`);
    assert.ok(trustCheckIndex < invokeIndex, `${label} trust check must run before previous command invocation`);
    assert.match(text, /if \(-not \(Test-TrustedCommandRecord \$Record\)\)/, label);
    assert.match(text, /Unknown trusted command type/, label);
  }
});

test('n8n workflow sync menus block tampered previous command replay', () => {
  const powerShell = findPowerShell();
  if (!powerShell) return;

  for (const [label, menuSourcePath] of [
    ['workflow toolkit source menu', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['workflow toolkit generated menu', path.join(scriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['Secure CI/CD preserved menu', path.join(secureCicdN8nTemplateDir, 'n8n-workflow-sync-menu.ps1')],
  ]) {
    const repo = fakeMenuRepo(menuSourcePath);
    writeJson(repo.previousPath, {
      schemaVersion: 2,
      commandKind: 'export',
      commandName: 'Export live workflows to repo',
      script: repo.maliciousExportScript,
      args: [
        '-WorkflowDir', 'n8n-workflows',
        '-Container', 'n8n',
        '-BindingsFile', '.n8n-local\\n8n-credential-bindings.json',
        '-Mode', 'RepoTrackedOnly',
        '-MissingLiveMode', 'Fail',
        '-DryRun',
      ],
      cwd: repo.root,
      helperScriptDir: repo.helperDir,
    });

    const result = spawnSync(powerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', repo.menuPath, '-UsePrevious', '-Yes'], {
      cwd: repo.root,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.match(output, /Saved previous command is not trusted\. Clear previous command and rebuild it from the menu\./, label);
    assert.equal(fs.existsSync(repo.markerPath), false, `${label} executed malicious repo-root script`);
    assert.equal(fs.existsSync(repo.trustedMarkerPath), false, `${label} executed trusted export script despite blocked replay`);
  }
});

test('n8n workflow sync menus block old-format previous command replay', () => {
  const powerShell = findPowerShell();
  if (!powerShell) return;

  for (const [label, menuSourcePath] of [
    ['workflow toolkit source menu', path.join(sourceScriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['workflow toolkit generated menu', path.join(scriptDir, 'n8n-workflow-sync-menu.ps1')],
    ['Secure CI/CD preserved menu', path.join(secureCicdN8nTemplateDir, 'n8n-workflow-sync-menu.ps1')],
  ]) {
    const repo = fakeMenuRepo(menuSourcePath);
    writeJson(repo.previousPath, {
      commandName: 'Export live workflows to repo',
      script: repo.trustedExportScript,
      args: [
        '-WorkflowDir', 'n8n-workflows',
        '-Container', 'n8n',
        '-BindingsFile', '.n8n-local\\n8n-credential-bindings.json',
        '-Mode', 'RepoTrackedOnly',
        '-MissingLiveMode', 'Fail',
        '-DryRun',
      ],
      cwd: repo.root,
    });

    const result = spawnSync(powerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', repo.menuPath, '-UsePrevious', '-Yes'], {
      cwd: repo.root,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.match(output, /Saved previous command is from an older or untrusted format\. Clear previous command and rebuild it from the menu\./, label);
    assert.equal(fs.existsSync(repo.markerPath), false, `${label} executed malicious repo-root script`);
    assert.equal(fs.existsSync(repo.trustedMarkerPath), false, `${label} executed trusted export script despite old-format block`);
  }
});

test('n8n helper tests do not execute live n8n import or export helpers', () => {
  const testText = readText(__filename);
  const childProcessCalls = testText.match(/(?:spawnSync|execFileSync)\([\s\S]*?\);/g) || [];

  for (const call of childProcessCalls) {
    assert.doesNotMatch(call, /export-n8n-workflows-live\.ps1|import-n8n-workflows-live\.ps1/);
    assert.doesNotMatch(call, /\bn8n\s+(import|export|execute|start|webhook)/i);
    assert.doesNotMatch(call, /\bdocker\b/i);
  }
});

test('sync-n8n-live-exports.cjs strips live-only fields, credentials, and tags by default', () => {
  const cwd = tempDir();
  const workflowDir = path.join(cwd, 'n8n-workflows');
  const exportsDir = path.join(cwd, '.tmp', 'exports');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  writeJson(path.join(workflowDir, 'workflow.json'), safeWorkflow({ id: 'wf_1', name: 'Live Workflow' }));
  writeJson(path.join(exportsDir, 'workflow.live-export.json'), safeWorkflow({
    id: 'wf_1',
    name: 'Live Workflow',
    active: true,
    tags: [{ id: 'tag_1', name: 'Prod' }],
    tagIds: ['tag_1'],
    staticData: { lastRun: 1 },
    pinData: { node: [] },
    credentials: { topLevel: true },
    nodes: [
      {
        id: 'http_1',
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [0, 0],
        parameters: {},
        webhookId: 'real-live-webhook-id-123',
        credentials: {
          httpHeaderAuth: {
            id: 'cred_1',
            name: 'Local Credential',
          },
        },
      },
    ],
  }));

  execFileSync(process.execPath, [syncScript, exportsDir, workflowDir, bindingsPath], { cwd, stdio: 'pipe' });
  const synced = JSON.parse(fs.readFileSync(path.join(workflowDir, 'workflow.json'), 'utf8'));

  assert.equal(synced.active, false);
  assert.equal('credentials' in synced, false);
  assert.equal('staticData' in synced, false);
  assert.equal('pinData' in synced, false);
  assert.equal('tags' in synced, false);
  assert.equal('tagIds' in synced, false);
  assert.equal('credentials' in synced.nodes[0], false);
  assert.equal('webhookId' in synced.nodes[0], false);
});

test('sync-n8n-live-exports.cjs preserves tags with --preserve-tags', () => {
  const cwd = tempDir();
  const workflowDir = path.join(cwd, 'n8n-workflows');
  const exportsDir = path.join(cwd, '.tmp', 'exports');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  writeJson(path.join(workflowDir, 'workflow.json'), safeWorkflow({ id: 'wf_1', name: 'Live Workflow' }));
  writeJson(path.join(exportsDir, 'workflow.live-export.json'), safeWorkflow({
    id: 'wf_1',
    name: 'Live Workflow',
    tags: [{ id: 'tag_1', name: 'Prod' }],
    tagIds: ['tag_1'],
  }));

  execFileSync(process.execPath, [syncScript, exportsDir, workflowDir, bindingsPath, '--preserve-tags'], { cwd, stdio: 'pipe' });
  const synced = JSON.parse(fs.readFileSync(path.join(workflowDir, 'workflow.json'), 'utf8'));

  assert.deepEqual(synced.tags, [{ id: 'tag_1', name: 'Prod' }]);
  assert.deepEqual(synced.tagIds, ['tag_1']);
});

test('sync-n8n-live-exports.cjs credentials-only mode can allow missing exports', () => {
  const cwd = tempDir();
  const workflowDir = path.join(cwd, 'n8n-workflows');
  const exportsDir = path.join(cwd, '.tmp', 'exports');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  writeJson(path.join(workflowDir, 'tracked.json'), safeWorkflow({ id: 'wf_1', name: 'Tracked' }));
  fs.mkdirSync(exportsDir, { recursive: true });

  execFileSync(process.execPath, [
    syncScript,
    exportsDir,
    workflowDir,
    bindingsPath,
    '--credentials-only',
    '--allow-missing-exports',
  ], { cwd, stdio: 'pipe' });

  const bindings = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
  assert.equal(bindings.workflows.length, 0);
  assert.equal(bindings.skippedWorkflows.length, 1);
  assert.equal(bindings.skippedWorkflows[0].reason, 'Missing live export');
});

test('sync-n8n-live-exports.cjs sync-exported-only updates only current exports', () => {
  const cwd = tempDir();
  const workflowDir = path.join(cwd, 'n8n-workflows');
  const exportsDir = path.join(cwd, '.tmp', 'exports');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  writeJson(path.join(workflowDir, 'current.json'), safeWorkflow({ id: 'wf_current', name: 'Current Before' }));
  writeJson(path.join(workflowDir, 'missing.json'), safeWorkflow({ id: 'wf_missing', name: 'Missing Before' }));
  writeJson(path.join(exportsDir, 'current.live-export.json'), safeWorkflow({ id: 'wf_current', name: 'Current After' }));

  execFileSync(process.execPath, [
    syncScript,
    exportsDir,
    workflowDir,
    bindingsPath,
    '--sync-exported-only',
  ], { cwd, stdio: 'pipe' });

  const current = JSON.parse(fs.readFileSync(path.join(workflowDir, 'current.json'), 'utf8'));
  const missing = JSON.parse(fs.readFileSync(path.join(workflowDir, 'missing.json'), 'utf8'));
  const bindings = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
  assert.equal(current.name, 'Current After');
  assert.equal(missing.name, 'Missing Before');
  assert.deepEqual(bindings.workflows.map((entry) => path.basename(entry.workflowFile)), ['current.json']);
});

test('sync-n8n-live-exports.cjs displays local paths with native separators', () => {
  const cwd = tempDir();
  const workflowDir = path.join(cwd, 'n8n-workflows');
  const exportsDir = path.join(cwd, '.tmp', 'exports');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  writeJson(path.join(workflowDir, 'current.json'), safeWorkflow({ id: 'wf_current', name: 'Current Before' }));
  writeJson(path.join(exportsDir, 'current.live-export.json'), safeWorkflow({ id: 'wf_current', name: 'Current After' }));

  const result = runNode(syncScript, [
    exportsDir,
    workflowDir,
    bindingsPath,
    '--sync-exported-only',
  ], { cwd });

  assert.equal(result.status, 0, result.stderr);
  const expectedExportsDir = path.join('.tmp', 'exports').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(result.stdout, new RegExp(`Exports dir\\s+: ${expectedExportsDir}`));
  if (path.sep === '\\') {
    assert.doesNotMatch(result.stdout, /Exports dir\s+:\s+\.tmp\/exports/);
  }
});

test('prepare-n8n-live-import.cjs selects bindings by exact file path first', () => {
  const workflow = safeWorkflow({ id: 'wf_2', name: 'Same Name' });
  const selection = selectBindingsWithMeta({
    workflows: [
      { workflowFile: 'n8n-workflows/a.json', workflowId: 'wf_1', workflowName: 'Same Name', nodes: [{ nodeId: 'a' }] },
      { workflowFile: 'n8n-workflows/b.json', workflowId: 'wf_2', workflowName: 'Same Name', nodes: [{ nodeId: 'b' }] },
    ],
  }, workflow, path.join(process.cwd(), 'n8n-workflows', 'a.json'));

  assert.equal(selection.matchFound, true);
  assert.equal(selection.blocked, false);
  assert.equal(selection.workflowBindings.workflowFile, 'n8n-workflows/a.json');
});

test('prepare-n8n-live-import.cjs blocks ambiguous workflow name matches', () => {
  const selection = selectBindingsWithMeta({
    workflows: [
      { workflowName: 'Same Name', nodes: [] },
      { workflowName: 'Same Name', nodes: [] },
    ],
  }, safeWorkflow({ name: 'Same Name' }), path.join(process.cwd(), 'n8n-workflows', 'same.json'));

  assert.equal(selection.matchFound, false);
  assert.equal(selection.blocked, true);
  assert.match(selection.reason, /Ambiguous workflowName/);
});

test('prepare-n8n-live-import.cjs restores credentials by node ID', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{ id: 'node_1', name: 'Renamed Node', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {} }],
  }));
  writeJson(bindingsPath, {
    version: 2,
    workflows: [{
      workflowFile: 'n8n-workflows/workflow.json',
      workflowId: 'wf_safe',
      workflowName: 'Safe Generic Workflow',
      nodes: [{
        nodeId: 'node_1',
        nodeName: 'Old Node',
        nodeType: 'n8n-nodes-base.httpRequest',
        credentials: { httpHeaderAuth: { id: 'cred_1', name: 'Local Credential' } },
      }],
    }],
  });

  execFileSync(process.execPath, [prepareScript, workflowPath, bindingsPath, outputPath], { cwd, stdio: 'pipe' });
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.deepEqual(prepared.nodes[0].credentials, { httpHeaderAuth: { id: 'cred_1', name: 'Local Credential' } });
});

test('prepare-n8n-live-import.cjs skips stale node ID binding when node name and type changed', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{
      id: 'reused_node_id',
      name: 'Notify Main Error Handler',
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }],
  }));
  writeJson(bindingsPath, {
    version: 2,
    workflows: [{
      workflowFile: 'n8n-workflows/workflow.json',
      workflowId: 'wf_safe',
      workflowName: 'Safe Generic Workflow',
      nodes: [{
        nodeId: 'reused_node_id',
        nodeName: 'Upsert Conversation Failed',
        nodeType: 'n8n-nodes-base.googleSheets',
        credentials: { googleSheetsOAuth2Api: { id: 'cred_1', name: 'Sheets Credential' } },
      }],
    }],
  });

  const result = runNode(prepareScript, [workflowPath, bindingsPath, outputPath], { cwd });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal('credentials' in prepared.nodes[0], false);
  assert.match(result.stderr + result.stdout, /Skipped 1 binding\(s\) with no matching node: Upsert Conversation Failed/);
});

test('compare-n8n-workflow-credentials.cjs ignores stale node ID binding when replacement node has no credentials', () => {
  const cwd = tempDir();
  const repoWorkflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const liveWorkflowPath = path.join(cwd, '.tmp', 'live-workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const replacementNode = {
    id: 'reused_node_id',
    name: 'Notify Main Error Handler',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1,
    position: [0, 0],
    parameters: {},
  };
  writeJson(repoWorkflowPath, safeWorkflow({ nodes: [replacementNode] }));
  writeJson(liveWorkflowPath, safeWorkflow({ nodes: [replacementNode] }));
  writeJson(bindingsPath, {
    version: 2,
    workflows: [{
      workflowFile: 'n8n-workflows/workflow.json',
      workflowId: 'wf_safe',
      workflowName: 'Safe Generic Workflow',
      nodes: [{
        nodeId: 'reused_node_id',
        nodeName: 'Upsert Conversation Failed',
        nodeType: 'n8n-nodes-base.googleSheets',
        credentials: { googleSheetsOAuth2Api: { id: 'cred_1', name: 'Sheets Credential' } },
      }],
    }],
  });

  const result = runNode(compareCredentialsScript, [repoWorkflowPath, liveWorkflowPath, bindingsPath], { cwd });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stdout.trim(), 'MATCH');
});

test('prepare-n8n-live-import.cjs restores live webhookId from matching live workflow node', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  const liveWorkflowPath = path.join(cwd, '.tmp', 'live-workflow.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{
      id: 'webhook_1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
    }],
  }));
  writeJson(bindingsPath, { version: 2, workflows: [] });
  writeJson(liveWorkflowPath, safeWorkflow({
    nodes: [{
      id: 'webhook_1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
      webhookId: 'existing-live-webhook-id',
    }],
  }));

  const output = execFileSync(process.execPath, [prepareScript, workflowPath, bindingsPath, outputPath, liveWorkflowPath], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.equal(prepared.nodes[0].webhookId, 'existing-live-webhook-id');
  assert.match(output, /1 live webhookId\(s\) restored/);
});

test('prepare-n8n-live-import.cjs restores live webhookId by unique node name and type', () => {
  const workflow = safeWorkflow({
    nodes: [{
      id: 'repo_webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
    }],
  });
  const liveWorkflow = safeWorkflow({
    nodes: [{
      id: 'live_webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
      webhookId: 'name-type-live-webhook-id',
    }],
  });

  const restored = restoreLiveWebhookIds(workflow, liveWorkflow);

  assert.equal(restored, 1);
  assert.equal(workflow.nodes[0].webhookId, 'name-type-live-webhook-id');
});

test('prepare-n8n-live-import.cjs skips ambiguous live webhookId name and type matches', () => {
  const workflow = safeWorkflow({
    nodes: [{
      id: 'repo_webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
    }],
  });
  const liveWorkflow = safeWorkflow({
    nodes: [
      {
        id: 'live_webhook_1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        parameters: {},
        webhookId: 'first-live-webhook-id',
      },
      {
        id: 'live_webhook_2',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        parameters: {},
        webhookId: 'second-live-webhook-id',
      },
    ],
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);

  try {
    const restored = restoreLiveWebhookIds(workflow, liveWorkflow);

    assert.equal(restored, 0);
    assert.equal('webhookId' in workflow.nodes[0], false);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ambiguous/);
});

test('prepare-n8n-live-import.cjs does not invent webhookId for new workflows', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{
      id: 'webhook_1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
    }],
  }));
  writeJson(bindingsPath, { version: 2, workflows: [] });

  const output = execFileSync(process.execPath, [prepareScript, workflowPath, bindingsPath, outputPath], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.equal('webhookId' in prepared.nodes[0], false);
  assert.match(output, /0 live webhookId\(s\) restored/);
});

test('prepare-n8n-live-import.cjs restores credentials by exact node name and type only when unique', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{ id: 'new_id', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {} }],
  }));
  writeJson(bindingsPath, {
    version: 2,
    workflows: [{
      workflowFile: 'n8n-workflows/workflow.json',
      workflowId: 'wf_safe',
      workflowName: 'Safe Generic Workflow',
      nodes: [{
        nodeId: 'old_id',
        nodeName: 'HTTP Request',
        nodeType: 'n8n-nodes-base.httpRequest',
        credentials: { httpHeaderAuth: { id: 'cred_1', name: 'Local Credential' } },
      }],
    }],
  });

  execFileSync(process.execPath, [prepareScript, workflowPath, bindingsPath, outputPath], { cwd, stdio: 'pipe' });
  const prepared = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.deepEqual(prepared.nodes[0].credentials, { httpHeaderAuth: { id: 'cred_1', name: 'Local Credential' } });
});

test('prepare-n8n-live-import.cjs blocks ambiguous node name and type matches', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{ id: 'new_id', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {} }],
  }));
  writeJson(bindingsPath, {
    version: 2,
    workflows: [{
      workflowFile: 'n8n-workflows/workflow.json',
      workflowId: 'wf_safe',
      workflowName: 'Safe Generic Workflow',
      nodes: [
        { nodeId: 'old_1', nodeName: 'HTTP Request', nodeType: 'n8n-nodes-base.httpRequest', credentials: { a: { id: '1' } } },
        { nodeId: 'old_2', nodeName: 'HTTP Request', nodeType: 'n8n-nodes-base.httpRequest', credentials: { a: { id: '2' } } },
      ],
    }],
  });

  const result = runNode(prepareScript, [workflowPath, bindingsPath, outputPath], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /ambiguous/i);
});

test('prepare-n8n-live-import.cjs blocks nodeNameMap restore when node type changed', () => {
  const cwd = tempDir();
  const workflowPath = path.join(cwd, 'n8n-workflows', 'workflow.json');
  const bindingsPath = path.join(cwd, '.n8n-local', 'bindings.json');
  const outputPath = path.join(cwd, '.tmp', 'prepared.json');
  writeJson(workflowPath, safeWorkflow({
    nodes: [{ id: 'new_id', name: 'New Node', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {} }],
  }));
  writeJson(bindingsPath, {
    version: 2,
    workflows: [{
      workflowFile: 'n8n-workflows/workflow.json',
      workflowId: 'wf_safe',
      workflowName: 'Safe Generic Workflow',
      nodes: [{
        nodeId: 'old_id',
        nodeName: 'Old Node',
        nodeType: 'n8n-nodes-base.slack',
        credentials: { slackApi: { id: 'cred_1', name: 'Slack Credential' } },
      }],
    }],
  });
  writeJson(path.join(cwd, '.n8n-local', 'n8n-credential-migration-map.json'), {
    nodeNameMap: {
      'Old Node': 'New Node',
    },
    blockedCredentialTypes: [],
  });

  const result = runNode(prepareScript, [workflowPath, bindingsPath, outputPath], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /manual credential binding/i);
});

test('prepare-n8n-live-import.cjs has no hardcoded Groq or SpaceKoncept migration logic', () => {
  const text = fs.readFileSync(prepareScript, 'utf8');

  assert.doesNotMatch(text, /Groq|SpaceKoncept|SPACEKONCEPT/i);
});

test('should-import-n8n-workflow.cjs ignores tags by default consistently', () => {
  const left = comparableWorkflow(safeWorkflow({
    id: 'left',
    tags: [{ id: 'tag_1', name: 'Prod' }],
    tagIds: ['tag_1'],
  }));
  const right = comparableWorkflow(safeWorkflow({
    id: 'right',
    tags: [{ id: 'tag_2', name: 'Dev' }],
    tagIds: ['tag_2'],
  }));

  assert.deepEqual(left, right);
});
