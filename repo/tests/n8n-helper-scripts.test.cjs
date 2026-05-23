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

test('import helper guards before-import-validation hooks during dry-run and revalidates prepared payloads after before-live-import', () => {
  const text = readText(path.join(scriptDir, 'import-n8n-workflows-live.ps1'));

  assert.match(text, /if \(-not \$DryRun\) \{\s*Invoke-ProjectWorkflowHook "before-import-validation"/);
  const beforeLiveImportIndex = text.indexOf('Invoke-ProjectWorkflowHook "before-live-import"');
  const revalidationIndex = text.indexOf('Write-Section "Prepared Workflow Re-Validation"');
  const importIndex = text.indexOf('Write-Section "Import"');
  assert.notEqual(beforeLiveImportIndex, -1);
  assert.notEqual(revalidationIndex, -1);
  assert.notEqual(importIndex, -1);
  assert.ok(beforeLiveImportIndex < revalidationIndex, 'prepared revalidation must run after before-live-import hook');
  assert.ok(revalidationIndex < importIndex, 'prepared revalidation must run before live import');
  assert.match(text, /validate-n8n-workflows\.cjs"\), \$PreparedDirPath/);
  assert.match(text, /Prepared workflow JSON validation failed after before-live-import hook/);
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

    assert.match(resolver, /Join-Path \$current "\.git"/);
    assert.match(resolver, /Join-Path \$current "n8n-workflows"/);
    assert.doesNotMatch(resolver, /\.gitignore/);
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

    assert.match(text, /\$HelperScriptDir = \(Resolve-Path \$PSScriptRoot\)\.Path/, label);
    assert.match(text, /\$ExportHelperScript = Join-Path \$HelperScriptDir "export-n8n-workflows-live\.ps1"/, label);
    assert.match(text, /\$ImportHelperScript = Join-Path \$HelperScriptDir "import-n8n-workflows-live\.ps1"/, label);
    assert.match(text, /\$ValidateHelperScript = Join-Path \$HelperScriptDir "validate-n8n-workflows\.cjs"/, label);
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
    assert.match(text, /\$script -eq \$ExportHelperScript/, label);
    assert.match(text, /\$script -eq \$ImportHelperScript/, label);
    assert.match(text, /\$script -eq "node" -and @\(\$Record\.args\)\.Count -gt 0 -and \[string\]\$Record\.args\[0\] -eq \$ValidateHelperScript/, label);
    assert.match(text, /Saved previous command is not trusted\. Clear previous command and rebuild it from the menu\./, label);
    assert.notEqual(trustCheckIndex, -1, `${label} previous command trust check not found`);
    assert.notEqual(invokeIndex, -1, `${label} previous command invocation not found`);
    assert.ok(trustCheckIndex < invokeIndex, `${label} trust check must run before previous command invocation`);
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
