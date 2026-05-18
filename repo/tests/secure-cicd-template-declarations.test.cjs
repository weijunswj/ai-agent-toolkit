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
    'skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md',
    'curated_output_for_ai/templates/cicd/CURRENT_CICD_STATUS.template.md',
    'curated_template'
  ],
  [
    'skills/secure-cicd-installer/templates/cicd/safe-source-update-policy.md',
    'curated_output_for_ai/templates/cicd/safe-source-update-policy.md',
    'curated_template'
  ],
  [
    'skills/secure-cicd-installer/templates/github-actions/README.md',
    'curated_output_for_ai/templates/github-actions/README.md',
    'curated_template_index'
  ],
  [
    'skills/secure-cicd-installer/packs/secure-cicd/README.md',
    'curated_output_for_ai/packs/secure-cicd/README.md',
    'curated_pack_readme'
  ]
];

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function secureCicdManifest() {
  return readJson('_projects/cicd/secure-installer/toolkit.project.json');
}

function runAuditJson() {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Secure CI/CD remaining template surfaces are declared curated outputs', () => {
  const manifest = secureCicdManifest();
  const outputs = new Map(manifest.outputs.map((output) => [output.output, output]));
  const allowedWrites = new Set(manifest.writes.allowed);

  for (const [outputPath, sourcePath] of targetMappings) {
    const output = outputs.get(outputPath);
    assert.ok(output, outputPath);
    assert.equal(output.kind, 'curated', outputPath);
    assert.equal(output.source, sourcePath, outputPath);
    assert.equal(output.fidelity, 'reviewed_entrypoint', outputPath);
    assert.ok(allowedWrites.has(outputPath), outputPath);

    const sourceText = readText(`_projects/cicd/secure-installer/${sourcePath}`);
    assert.match(sourceText, /Curated AI-facing source\./, sourcePath);
    assert.match(sourceText, /Review rule: Preserve safety constraints from preserved source\./, sourcePath);
  }
});

test('Secure CI/CD template recipes have explicit audit boundary classifications', () => {
  const report = runAuditJson();
  const recipes = new Map(report.boundaryRecipes.map((entry) => [entry.path, entry]));

  for (const [outputPath, , classification] of targetMappings) {
    const recipe = recipes.get(outputPath);
    assert.ok(recipe, outputPath);
    assert.equal(recipe.classification, classification, outputPath);
  }

  const findings = report.issues.boundaryRecipeFindings
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/secure-cicd-installer/'));
  assert.deepEqual(findings, []);
});

test('Secure CI/CD pack installs only declared generated surfaces', () => {
  const manifest = secureCicdManifest();
  const declaredOutputs = new Set(manifest.outputs.map((output) => output.output));
  const pack = readJson('skills/secure-cicd-installer/packs/secure-cicd/pack.json');

  for (const installedPath of pack.installs) {
    assert.ok(declaredOutputs.has(installedPath), installedPath);
  }

  const report = runAuditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/secure-cicd-installer/'));
  assert.deepEqual(unresolved, []);
});

test('Secure CI/CD status template is no longer a suspicious published surface', () => {
  const report = runAuditJson();
  const suspicious = report.issues.suspiciousPublishedSurfaces.map((entry) => entry.path);
  assert.equal(
    suspicious.includes('skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md'),
    false
  );
});

test('Secure CI/CD curated template outputs carry generated notices', () => {
  for (const [outputPath, sourcePath] of targetMappings) {
    const outputText = readText(outputPath);
    assert.match(outputText, /Generated from toolkit curated output for AI\. Do not edit directly\./, outputPath);
    assert.match(
      outputText,
      new RegExp(`Source: _projects/cicd/secure-installer/${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      outputPath
    );
  }
});
