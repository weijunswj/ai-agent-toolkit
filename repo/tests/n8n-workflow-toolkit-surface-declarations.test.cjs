'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');
const globalErrorHandlerSourcePath =
  '_projects/n8n/workflow-toolkit/_main/workflow-templates/error-handling/global-error-handler.template.json';
const globalErrorHandlerPublishedPath =
  'skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json';

const unsafeAlertFields = [
  'error_message',
  'contact_id',
  'error_type',
  'error_workflow_name',
  'last_node_executed',
  'execution_id',
  'execution_url',
  'payload_json'
];

const safeAlertFields = [
  'safe_error_message',
  'safe_contact_id',
  'safe_error_type',
  'safe_error_workflow_name',
  'safe_last_node_executed',
  'safe_execution_id',
  'safe_execution_url',
  'safe_payload_json'
];

const sheetAlertFields = [
  'sheet_error_message',
  'sheet_contact_id',
  'sheet_error_type',
  'sheet_error_workflow_name',
  'sheet_last_node_executed',
  'sheet_execution_id',
  'sheet_execution_url',
  'sheet_payload_json'
];

const subjectAlertFields = [
  'subject_error_type',
  'subject_error_workflow_name'
];

const curatedMappings = [
  [
    'skills/n8n-workflow-helper-scripts/references/credential-safety.md',
    'curated_output_for_ai/references/credential-safety.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-helper-scripts/references/import-export-flow.md',
    'curated_output_for_ai/references/import-export-flow.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-helper-scripts/references/n8n-credential-safety.md',
    'curated_output_for_ai/references/n8n-credential-safety.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-helper-scripts/references/workflow-sync.md',
    'curated_output_for_ai/references/workflow-sync.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-helper-scripts/templates/helper-scripts/README.md',
    'curated_output_for_ai/templates/helper-scripts/README.md',
    'curated_template_index'
  ],
  [
    'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/README.md',
    'curated_output_for_ai/templates/helper-scripts/sanitizer/README.md',
    'curated_template_index'
  ],
  [
    'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/README.md',
    'curated_output_for_ai/templates/helper-scripts/import-export-sync/README.md',
    'curated_template_index'
  ],
  [
    'skills/n8n-workflow-templates/templates/README.md',
    'curated_output_for_ai/templates/workflow-templates/README.md',
    'curated_template_index'
  ]
];

const helperScriptOutputs = [
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_export-n8n-workflows-live.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_import-n8n-workflows-live.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/compare-n8n-workflow-credentials.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/export-n8n-workflows-live.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/import-n8n-workflows-live.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/n8n-workflow-sync-menu.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/prepare-n8n-live-import.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/should-import-n8n-workflow.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/sync-n8n-live-exports.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/_sanitise-n8n-template.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/prepare-n8n-template.js',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/sanitise-n8n-template.ps1'
];

const cmdWrapperCases = [
  {
    sourcePath: '_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/_export-n8n-workflows-live.cmd',
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_export-n8n-workflows-live.cmd',
    ps1Name: 'export-n8n-workflows-live.ps1',
    oldScriptPath: 'scripts\\export-n8n-workflows-live.ps1'
  },
  {
    sourcePath: '_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/_import-n8n-workflows-live.cmd',
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_import-n8n-workflows-live.cmd',
    ps1Name: 'import-n8n-workflows-live.ps1',
    oldScriptPath: 'scripts\\import-n8n-workflows-live.ps1'
  },
  {
    sourcePath: '_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/_sanitise-n8n-template.cmd',
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/_sanitise-n8n-template.cmd',
    ps1Name: 'sanitise-n8n-template.ps1',
    oldScriptPath: 'scripts\\sanitise-n8n-template.ps1'
  }
];

const wrapperAdaptationNote =
  'Wrapper path and console formatting adapted after rehome so the published helper entrypoint invokes the co-located PowerShell script with framed colored retry output, clears the console before reruns, and resolves Windows PowerShell from the trusted absolute SystemRoot path instead of PATH.';

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function getNode(workflow, nodeName) {
  const node = workflow.nodes.find((entry) => entry.name === nodeName);
  assert.ok(node, nodeName);
  return node;
}

function workflowToolkitManifest() {
  return readJson('_projects/n8n/workflow-toolkit/toolkit.project.json');
}

function runAuditJson() {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('n8n workflow toolkit publishes helper-script and template surfaces from declared outputs', () => {
  const manifest = workflowToolkitManifest();
  const outputs = new Map(manifest.outputs.map((output) => [output.output, output]));
  const allowedWrites = new Set(manifest.writes.allowed);

  for (const [outputPath, sourcePath] of curatedMappings) {
    const output = outputs.get(outputPath);
    assert.ok(output, outputPath);
    assert.equal(output.kind, 'curated', outputPath);
    assert.equal(output.source, sourcePath, outputPath);
    assert.ok(allowedWrites.has(outputPath), outputPath);

    const sourceText = readText(`_projects/n8n/workflow-toolkit/${sourcePath}`);
    assert.match(sourceText, /Curated AI-facing source\./, sourcePath);
    assert.match(sourceText, /Review rule: Preserve safety constraints from preserved source\./, sourcePath);
  }

  for (const outputPath of helperScriptOutputs) {
    assert.ok(allowedWrites.has(outputPath), outputPath);
  }

  const workflowTemplate = outputs.get('skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json');
  assert.equal(workflowTemplate?.kind, 'json');
  assert.equal(workflowTemplate?.source, '_main/workflow-templates/error-handling/global-error-handler.template.json');
});

test('n8n workflow toolkit surface recipes have explicit audit classifications', () => {
  const report = runAuditJson();
  const recipes = new Map(report.boundaryRecipes.map((entry) => [entry.path, entry]));

  for (const [outputPath, , classification] of curatedMappings) {
    const recipe = recipes.get(outputPath);
    assert.ok(recipe, outputPath);
    assert.equal(recipe.classification, classification, outputPath);
    assert.deepEqual(recipe.reasons, [], outputPath);
  }

  for (const outputPath of helperScriptOutputs) {
    const recipe = recipes.get(outputPath);
    assert.ok(recipe, outputPath);
    assert.equal(recipe.classification, 'main_full_fidelity', outputPath);
    assert.deepEqual(recipe.reasons, [], outputPath);
  }

  const templateRecipe = recipes.get('skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json');
  assert.ok(templateRecipe);
  assert.equal(templateRecipe.classification, 'main_full_fidelity');
  assert.deepEqual(templateRecipe.reasons, []);

  const findings = report.issues.boundaryRecipeFindings
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-workflow-helper-scripts/') || entryPath.startsWith('skills/n8n-workflow-templates/'));
  assert.deepEqual(findings, []);
});

test('n8n workflow toolkit cmd wrappers invoke co-located PowerShell scripts', () => {
  for (const wrapper of cmdWrapperCases) {
    for (const relPath of [wrapper.sourcePath, wrapper.outputPath]) {
      const wrapperText = readText(relPath);
      assert.equal(wrapperText.includes(wrapper.oldScriptPath), false, relPath);
      assert.match(wrapperText, /:resolve_powershell/, relPath);
      assert.match(wrapperText, /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i, relPath);
      assert.match(wrapperText, /set "POWERSHELL_EXE=/, relPath);
      assert.doesNotMatch(wrapperText, /(^|\r?\n)\s*powershell\b/i, relPath);
      assert.doesNotMatch(wrapperText, /(^|\r?\n)\s*pwsh\b/i, relPath);
      if (wrapper.ps1Name === 'import-n8n-workflows-live.ps1') {
        assert.equal(
          wrapperText.includes(`"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0${wrapper.ps1Name}" %* %RESTART_ARG%`),
          true,
          relPath
        );
        assert.match(wrapperText, /call :prompt "Auto-restart n8n container if restart warning is true\?"/, relPath);
        assert.match(wrapperText, /-RestartContainerAfterImport/, relPath);
      } else {
        assert.equal(
          wrapperText.includes(`"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0${wrapper.ps1Name}" %*`),
          true,
          relPath
        );
      }
      assert.match(wrapperText, /call :banner "n8n .+"/, relPath);
      assert.match(wrapperText, /call :status DarkCyan "-+"/, relPath);
      assert.match(wrapperText, /"%POWERSHELL_EXE%" -NoProfile -Command "Write-Host \$env:AAT_STATUS_MESSAGE -ForegroundColor \$env:AAT_STATUS_COLOR"/, relPath);
      assert.equal(/^cd\s+\/d\s+"%~dp0\.\."/im.test(wrapperText), false, relPath);
    }
  }
});

test('n8n workflow toolkit cmd wrapper source locks document path adaptation', () => {
  const sourceLock = readJson('_projects/n8n/workflow-toolkit/SOURCE-LOCK.json');
  const lockEntriesByProjectPath = new Map(sourceLock.files.map((entry) => [entry.project_path, entry]));

  for (const wrapper of cmdWrapperCases) {
    const entry = lockEntriesByProjectPath.get(wrapper.sourcePath);
    assert.ok(entry, wrapper.sourcePath);
    assert.equal(entry.mode, 'adapted', wrapper.sourcePath);
    assert.equal(entry.notes, wrapperAdaptationNote, wrapper.sourcePath);
  }
});

test('n8n workflow toolkit has no unresolved pack-installed or cross-owned leftovers', () => {
  const report = runAuditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-workflow-helper-scripts/') || entryPath.startsWith('skills/n8n-workflow-templates/'));
  const workflowToolkitShared = report.issues.sharedSurfaceOutputs
    .filter((entry) => entry.targetProjectId === 'n8n.workflow-toolkit')
    .map((entry) => entry.output)
    .sort();
  assert.deepEqual(unresolved, []);
  assert.deepEqual(workflowToolkitShared, [
    'skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md',
    'skills/n8n-workflow-templates/references/n8n-agent-rules.md'
  ]);
  assert.deepEqual(report.issues.sharedSurfaceMetadataFindings, []);
  assert.deepEqual(report.issues.crossOwnedOutputs, []);
});

test('n8n workflow toolkit curated sources stay within allowed boundary categories', () => {
  const report = runAuditJson();
  const curatedFindings = report.issues.curatedDirectoryFindings
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('_projects/n8n/workflow-toolkit/curated_output_for_ai/'));
  assert.deepEqual(curatedFindings, []);
});

test('n8n workflow toolkit curated Markdown outputs carry generated notices', () => {
  for (const [outputPath, sourcePath] of curatedMappings) {
    const outputText = readText(outputPath);
    assert.match(outputText, /Generated from toolkit curated output for AI\. Do not edit directly\./, outputPath);
    assert.match(
      outputText,
      new RegExp(`Source: _projects/n8n/workflow-toolkit/${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      outputPath
    );
  }
});

test('n8n helper docs distinguish non-live and live approval requirements', () => {
  const docs = [
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/skills/n8n-workflow-helper-scripts/SKILL.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/references/import-export-flow.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/references/workflow-sync.md'
  ].map(readText).join('\n');

  for (const phrase of [
    'validate repo workflow JSON',
    'sanitise/check local candidate exports',
    'compare/diff already-exported local files',
    'prepare import payloads into ignored `.tmp/**`',
    'check ignored `.n8n-local/**` credential-binding metadata',
    'target repo',
    'target n8n instance/environment',
    'allowed operation',
    'workflow names/set',
    'forbidden operations',
    'credential creation/update/delete/binding/replacement',
    'ignored scratch folders contain commit-worthy changes',
    'Yes, in this repo, run the n8n validation script only',
    'Yes, in this repo, run the live export helper against my local n8n instance only',
    'Yes, in this repo, run the prepared live import against my local n8n instance only'
  ]) {
    assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), phrase);
  }
});

test('global-error-handler source and generated template stay in sync', () => {
  assert.deepEqual(readJson(globalErrorHandlerPublishedPath), readJson(globalErrorHandlerSourcePath));
});

test('global-error-handler template routes alert outputs through safe context', () => {
  const workflow = readJson(globalErrorHandlerPublishedPath);

  getNode(workflow, 'Build Safe Error Alert Context');

  assert.deepEqual(workflow.connections['Error Trigger'].main[0].map((entry) => entry.node), ['Build Error Row']);
  assert.deepEqual(workflow.connections['Build Error Row'].main[0].map((entry) => entry.node), [
    'Build Safe Error Alert Context'
  ]);
  assert.deepEqual(
    workflow.connections['Build Safe Error Alert Context'].main[0].map((entry) => entry.node),
    ['Append Error Row', 'Send Error Email', 'Has User Chat Failure Feedback']
  );
});

test('global-error-handler safe context creates escaped, sheet-safe, and subject-safe fields', () => {
  const workflow = readJson(globalErrorHandlerPublishedPath);
  const safeContext = getNode(workflow, 'Build Safe Error Alert Context');
  const jsCode = safeContext.parameters.jsCode;

  assert.equal(safeContext.type, 'n8n-nodes-base.code');
  assert.match(jsCode, /function escapeHtml\(value\)/);
  assert.match(jsCode, /function safeSheetValue\(value\)/);
  assert.match(jsCode, /function safeSubjectText\(value, fallback\)/);
  assert.match(jsCode, /subject_error_type:\s*safeSubjectText\(json\.error_type, 'workflow_error'\)/);
  assert.match(jsCode, /subject_error_workflow_name:\s*safeSubjectText\(json\.error_workflow_name, ''\)/);

  for (const field of [...safeAlertFields, ...sheetAlertFields, ...subjectAlertFields]) {
    assert.match(jsCode, new RegExp(`\\b${field}\\b`), field);
  }
});

test('global-error-handler email alert uses only safe fields for unsafe values', () => {
  const workflow = readJson(globalErrorHandlerPublishedPath);
  const email = getNode(workflow, 'Send Error Email');
  const html = email.parameters.html;
  const subject = email.parameters.subject;

  for (const field of unsafeAlertFields) {
    assert.doesNotMatch(html, new RegExp(`\\$json\\.${field}\\b`), field);
    assert.doesNotMatch(subject, new RegExp(`\\$json\\.${field}\\b`), field);
  }

  for (const field of safeAlertFields.filter((field) => field !== 'safe_payload_json')) {
    assert.match(html, new RegExp(`\\$json\\.${field}\\b`), field);
  }

  for (const field of subjectAlertFields) {
    assert.match(subject, new RegExp(`\\$json\\.${field}\\b`), field);
  }
});

test('global-error-handler sheet logging uses sheet-safe fields for unsafe values', () => {
  const workflow = readJson(globalErrorHandlerPublishedPath);
  const append = getNode(workflow, 'Append Error Row');
  const columns = append.parameters.columns.value;

  for (const field of unsafeAlertFields) {
    assert.doesNotMatch(columns[field], new RegExp(`\\$json\\.${field}\\b`), field);
    assert.match(columns[field], new RegExp(`\\$json\\.sheet_${field}\\b`), field);
  }

  assert.equal(append.parameters.options.cellFormat, 'RAW');
});

test('global-error-handler template remains inactive and credential-free', () => {
  for (const relPath of [globalErrorHandlerSourcePath, globalErrorHandlerPublishedPath]) {
    const workflow = readJson(relPath);
    const serialized = JSON.stringify(workflow);
    const credentialPaths = [];

    function walk(value, trail = []) {
      if (!value || typeof value !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(value, 'credentials')) {
        credentialPaths.push([...trail, 'credentials'].join('.'));
      }
      for (const [key, child] of Object.entries(value)) walk(child, [...trail, key]);
    }

    walk(workflow);
    assert.equal(workflow.name, 'Global Error Handler', relPath);
    assert.equal(workflow.active, false, relPath);
    assert.deepEqual(credentialPaths, [], relPath);
    assert.equal(serialized.includes('webhookId'), false, relPath);
    assert.equal(Object.prototype.hasOwnProperty.call(workflow, 'id'), false, relPath);
  }
});
