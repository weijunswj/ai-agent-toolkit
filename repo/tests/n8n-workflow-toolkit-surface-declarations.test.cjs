'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');
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

const helperScriptOutputs = [
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_export-n8n-workflows-live.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_import-n8n-workflows-live.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/compare-n8n-workflow-credentials.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/export-n8n-workflows-live.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/import-n8n-workflows-live.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/n8n-workflow-sync-menu.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/prepare-n8n-live-import.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/resolve-n8n-docker-target.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/should-import-n8n-workflow.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/sync-n8n-live-exports.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/_sanitise-n8n-template.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/prepare-n8n-template.js',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/sanitise-n8n-template.ps1'
];

const cmdWrapperCases = [
  {
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_export-n8n-workflows-live.cmd',
    ps1Name: 'export-n8n-workflows-live.ps1',
    oldScriptPath: 'scripts\\export-n8n-workflows-live.ps1'
  },
  {
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_import-n8n-workflows-live.cmd',
    ps1Name: 'import-n8n-workflows-live.ps1',
    oldScriptPath: 'scripts\\import-n8n-workflows-live.ps1'
  },
  {
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

function runAuditJson() {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('n8n workflow toolkit exposes direct helper-script and template surfaces', () => {
  for (const outputPath of helperScriptOutputs) assert.equal(fs.existsSync(path.join(repoRoot, outputPath)), true, outputPath);
  assert.equal(fs.existsSync(path.join(repoRoot, globalErrorHandlerPublishedPath)), true);
  for (const relPath of [
    'skills/n8n-workflow-helper-scripts/SKILL.md',
    'skills/n8n-workflow-helper-scripts/references/credential-safety.md',
    'skills/n8n-workflow-helper-scripts/references/import-export-flow.md',
    'skills/n8n-workflow-helper-scripts/references/n8n-credential-safety.md',
    'skills/n8n-workflow-helper-scripts/references/workflow-sync.md',
    'skills/n8n-workflow-templates/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /n8n/i, relPath);
  }
});

test('n8n workflow toolkit direct surfaces are included in a clean canonical audit', () => {
  const report = runAuditJson();
  assert.deepEqual(report.errors, []);
  assert.equal(report.snapshot.project_tree_present, false);
  assert.deepEqual(report.snapshot.pack_manifests, []);
});

test('n8n workflow toolkit cmd wrappers invoke co-located PowerShell scripts', () => {
  for (const wrapper of cmdWrapperCases) {
    for (const relPath of [wrapper.outputPath]) {
      const wrapperText = readText(relPath);
      assert.equal(wrapperText.includes(wrapper.oldScriptPath), false, relPath);
      assert.match(wrapperText, /:resolve_powershell/, relPath);
      assert.match(wrapperText, /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i, relPath);
      assert.match(wrapperText, /set "POWERSHELL_EXE=/, relPath);
      assert.doesNotMatch(wrapperText, /(^|\r?\n)\s*powershell\b/i, relPath);
      assert.doesNotMatch(wrapperText, /(^|\r?\n)\s*pwsh\b/i, relPath);
      if (wrapper.ps1Name === 'import-n8n-workflows-live.ps1') {
        assert.equal(
          wrapperText.includes(`"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0${wrapper.ps1Name}" %*`),
          true,
          relPath
        );
        assert.doesNotMatch(wrapperText, /choice\s+\/C|Read-Host|:prompt|-RestartContainerAfterImport|docker\s+restart/i, relPath);
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

test('n8n workflow toolkit has no unresolved pack-installed or cross-owned leftovers', () => {
  const report = runAuditJson();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.snapshot.pack_manifests, []);
});

test('n8n workflow toolkit direct surfaces contain no retired publisher references', () => {
  const report = runAuditJson();
  assert.deepEqual(report.errors, []);
});

test('n8n workflow toolkit direct Markdown surfaces have no generated-source notices', () => {
  for (const relPath of [
    'skills/n8n-workflow-helper-scripts/SKILL.md',
    'skills/n8n-workflow-helper-scripts/references/import-export-flow.md',
    'skills/n8n-workflow-helper-scripts/references/workflow-sync.md',
    'skills/n8n-workflow-templates/SKILL.md'
  ]) {
    assert.doesNotMatch(readText(relPath), /Generated from toolkit (?:project source|curated output for AI)/, relPath);
  }
});

test('n8n helper docs distinguish non-live and live approval requirements', () => {
  const docs = [
    'skills/n8n-workflow-helper-scripts/SKILL.md',
    'skills/n8n-workflow-helper-scripts/references/import-export-flow.md',
    'skills/n8n-workflow-helper-scripts/references/workflow-sync.md'
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
    assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), phrase);
  }
});

test('global-error-handler direct template is valid JSON', () => {
  const workflow = readJson(globalErrorHandlerPublishedPath);
  assert.equal(typeof workflow, 'object');
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
  for (const relPath of [globalErrorHandlerPublishedPath]) {
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
