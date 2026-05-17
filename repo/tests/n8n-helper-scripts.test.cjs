const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const { comparableWorkflow } = require(path.join(repoRoot, 'for_ai', 'templates', 'n8n', 'sync-helpers', 'should-import-n8n-workflow.cjs'));
const { selectBindingsWithMeta, restoreLiveWebhookIds } = require(path.join(repoRoot, 'for_ai', 'templates', 'n8n', 'sync-helpers', 'prepare-n8n-live-import.cjs'));

const scriptDir = path.join(repoRoot, 'for_ai', 'templates', 'n8n', 'sync-helpers');
const sourceScriptDir = path.join(repoRoot, '_projects', 'cicd', 'secure-installer', '_main', 'templates', 'n8n');
const validateScript = path.join(scriptDir, 'validate-n8n-workflows.cjs');
const syncScript = path.join(scriptDir, 'sync-n8n-live-exports.cjs');
const prepareScript = path.join(scriptDir, 'prepare-n8n-live-import.cjs');
const sanitizerScript = path.join(repoRoot, 'for_ai', 'templates', 'n8n', 'sanitizer', 'prepare-n8n-template.js');
const sanitizerPs1 = path.join(repoRoot, 'for_ai', 'templates', 'n8n', 'sanitizer', 'sanitise-n8n-template.ps1');

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

test('sanitise-n8n-template.ps1 dry-run creates staging folders but writes no sanitized templates', { skip: !findPowerShell() }, () => {
  const shell = findPowerShell();
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.to-sanitise/\n.sanitised/\n');
  const localSanitizerDir = path.join(cwd, 'templates', 'n8n', 'sanitizer');
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

test('validate-n8n-workflows.cjs loads project validation rules from consumer repo paths', () => {
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /custom rule failed/);
  assert.match(result.stdout, /Using validation rule scripts[\\/]n8n-workflow-validation-rules\.cjs/);
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
    'validate-n8n-workflows.cjs',
  ]) {
    assert.equal(readText(path.join(scriptDir, fileName)), readText(path.join(sourceScriptDir, fileName)), fileName);
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
    assert.match(text, /Add-HookScriptCandidate \$relativePath \$false/);
    assert.match(text, /Configured n8n workflow hook script not found/);
    assert.match(text, /elseif \(\$candidate\.Required\)/);
    assert.match(text, /Get-DisplayPath \$script/);
    assert.doesNotMatch(text, /ConvertTo-RepoRelativePath/);
  }
});

test('PowerShell n8n repo root resolver ignores nested gitignore files', () => {
  for (const fileName of [
    'export-n8n-workflows-live.ps1',
    'import-n8n-workflows-live.ps1',
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
