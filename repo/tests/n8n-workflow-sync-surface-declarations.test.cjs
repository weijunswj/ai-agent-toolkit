'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');

const targetMappings = [
  [
    'skills/n8n-workflow-sync/agents/openai.yaml',
    'curated_output_for_ai/agents/openai.yaml',
    'curated_agent_metadata'
  ],
  [
    'skills/n8n-workflow-sync/packs/n8n-workflow-sync/README.md',
    'curated_output_for_ai/packs/n8n-workflow-sync/README.md',
    'curated_pack_readme'
  ],
  [
    'skills/n8n-workflow-sync/references/credential-safety.md',
    'curated_output_for_ai/overviews/credential-safety.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-sync/references/import-export-flow.md',
    'curated_output_for_ai/overviews/import-export-flow.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-sync/references/n8n/credential-safety.md',
    'curated_output_for_ai/overviews/n8n-credential-safety.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-sync/references/workflow-template-hygiene.md',
    'curated_output_for_ai/overviews/workflow-template-hygiene.md',
    'curated_reference'
  ],
  [
    'skills/n8n-workflow-sync/templates/workflow-policy/credential-migration-map-example.md',
    'curated_output_for_ai/templates/n8n/workflow-policy/credential-migration-map-example.md',
    'curated_template_example'
  ]
];

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function workflowTemplatesManifest() {
  return readJson('_projects/n8n/workflow-templates/toolkit.project.json');
}

function runAuditJson() {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('n8n workflow-sync remaining pack-installed surfaces are declared curated outputs', () => {
  const manifest = workflowTemplatesManifest();
  const outputs = new Map(manifest.outputs.map((output) => [output.output, output]));
  const allowedWrites = new Set(manifest.writes.allowed);

  for (const [outputPath, sourcePath] of targetMappings) {
    const output = outputs.get(outputPath);
    assert.ok(output, outputPath);
    assert.equal(output.kind, 'curated', outputPath);
    assert.equal(output.source, sourcePath, outputPath);
    assert.ok(allowedWrites.has(outputPath), outputPath);

    const sourceText = readText(`_projects/n8n/workflow-templates/${sourcePath}`);
    assert.match(sourceText, /Curated AI-facing source\./, sourcePath);
    assert.match(sourceText, /Review rule: Preserve safety constraints from preserved source\./, sourcePath);
  }
});

test('n8n workflow-sync surface recipes have explicit audit classifications', () => {
  const report = runAuditJson();
  const recipes = new Map(report.boundaryRecipes.map((entry) => [entry.path, entry]));

  for (const [outputPath, , classification] of targetMappings) {
    const recipe = recipes.get(outputPath);
    assert.ok(recipe, outputPath);
    assert.equal(recipe.classification, classification, outputPath);
    assert.deepEqual(recipe.reasons, [], outputPath);
  }

  const findings = report.issues.boundaryRecipeFindings
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-workflow-sync/'));
  assert.deepEqual(findings, []);
});

test('n8n workflow-sync pack-installed surfaces are declared or shared', () => {
  const report = runAuditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-workflow-sync/'));
  assert.deepEqual(unresolved, []);
});

test('n8n workflow-sync curated sources stay within allowed boundary categories', () => {
  const report = runAuditJson();
  const curatedFindings = report.issues.curatedDirectoryFindings
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('_projects/n8n/workflow-templates/curated_output_for_ai/'));
  assert.deepEqual(curatedFindings, []);
});

test('n8n workflow-sync curated Markdown outputs carry generated notices', () => {
  for (const [outputPath, sourcePath] of targetMappings.filter(([outputPath]) => outputPath.endsWith('.md'))) {
    const outputText = readText(outputPath);
    assert.match(outputText, /Generated from toolkit curated output for AI\. Do not edit directly\./, outputPath);
    assert.match(
      outputText,
      new RegExp(`Source: _projects/n8n/workflow-templates/${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      outputPath
    );
  }
});
