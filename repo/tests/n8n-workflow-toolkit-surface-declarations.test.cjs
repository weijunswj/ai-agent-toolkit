'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');

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
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/- export-n8n-workflows-live.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/- import-n8n-workflows-live.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/compare-n8n-workflow-credentials.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/export-n8n-workflows-live.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/import-n8n-workflows-live.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/n8n-workflow-sync-menu.ps1',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/prepare-n8n-live-import.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/should-import-n8n-workflow.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/sync-n8n-live-exports.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/- sanitise-n8n-template.cmd',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/prepare-n8n-template.js',
  'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/sanitise-n8n-template.ps1'
];

const cmdWrapperCases = [
  {
    sourcePath: '_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/- export-n8n-workflows-live.cmd',
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/- export-n8n-workflows-live.cmd',
    ps1Name: 'export-n8n-workflows-live.ps1',
    oldScriptPath: 'scripts\\export-n8n-workflows-live.ps1'
  },
  {
    sourcePath: '_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/- import-n8n-workflows-live.cmd',
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/- import-n8n-workflows-live.cmd',
    ps1Name: 'import-n8n-workflows-live.ps1',
    oldScriptPath: 'scripts\\import-n8n-workflows-live.ps1'
  },
  {
    sourcePath: '_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/- sanitise-n8n-template.cmd',
    outputPath: 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/- sanitise-n8n-template.cmd',
    ps1Name: 'sanitise-n8n-template.ps1',
    oldScriptPath: 'scripts\\sanitise-n8n-template.ps1'
  }
];

const wrapperAdaptationNote =
  'Wrapper path adapted after rehome so the published helper entrypoint invokes the co-located PowerShell script.';

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
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
      assert.equal(
        wrapperText.includes(`powershell -ExecutionPolicy Bypass -File "%~dp0${wrapper.ps1Name}" %*`),
        true,
        relPath
      );
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

test('n8n workflow toolkit has no pack-installed or cross-owned leftovers', () => {
  const report = runAuditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-workflow-helper-scripts/') || entryPath.startsWith('skills/n8n-workflow-templates/'));
  assert.deepEqual(unresolved, []);
  assert.deepEqual(report.issues.sharedSurfaceOutputs, []);
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

test('global-error-handler template remains inactive and credential-free', () => {
  const workflow = readJson('skills/n8n-workflow-templates/templates/error-handling/global-error-handler.template.json');
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
  assert.equal(workflow.name, 'Global Error Handler');
  assert.equal(workflow.active, false);
  assert.deepEqual(credentialPaths, []);
  assert.equal(serialized.includes('webhookId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(workflow, 'id'), false);
});
