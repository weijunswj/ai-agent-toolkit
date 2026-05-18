'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');
const syncScript = path.join(repoRoot, 'repo', 'scripts', 'sync-toolkit-projects.cjs');

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-surface-audit-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !rel.startsWith('.git') && !rel.startsWith('_dist') && !rel.startsWith('node_modules');
    }
  });
  return target;
}

function runAudit(args = [], cwd = repoRoot) {
  return spawnSync(process.execPath, [auditScript, ...args], { cwd, encoding: 'utf8' });
}

function runAuditJson(cwd = repoRoot) {
  const result = runAudit(['--json'], cwd);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('audit-published-surfaces runs successfully on the current repo', () => {
  const result = runAudit();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Published surface audit/);
});

test('audit-published-surfaces detects pack-installed undeclared files', () => {
  const report = runAuditJson();
  const paths = report.issues.packInstalledUndeclared.map((entry) => entry.path);
  assert.ok(paths.includes('skills/n8n-workflow-sync/references/credential-safety.md'));
  assert.ok(paths.includes('skills/secure-cicd-installer/templates/cicd/safe-source-update-policy.md'));
});

test('audit-published-surfaces detects cross-owned outputs', () => {
  const report = runAuditJson();
  const outputs = report.issues.crossOwnedOutputs.map((entry) => entry.output);
  assert.ok(outputs.includes('skills/n8n-workflow-sync/templates/sync-helpers/export-n8n-workflows-live.ps1'));
});

test('audit-published-surfaces classifies curated boundary recipes', () => {
  const report = runAuditJson();
  assert.ok(report.summary.boundaryRecipeOutputs > 0);
  for (const classification of [
    'main_full_fidelity',
    'curated_router',
    'curated_index',
    'curated_metadata',
    'curated_shim',
    'curated_spec',
    'linked_exception',
    'suspicious_curated_runtime'
  ]) {
    assert.ok(report.boundaryClassifications[classification] > 0, classification);
  }
  const findings = report.issues.boundaryRecipeFindings.map((entry) => entry.path);
  assert.ok(findings.includes('skills/n8n-workflow-sync/references/n8n/workflow-sync.md'));
  assert.ok(findings.includes('skills/secure-cicd-installer/references/secure-cicd-installer.md'));
});

test('audit-published-surfaces inspects curated directory contents', () => {
  const report = runAuditJson();
  const findings = report.issues.curatedDirectoryFindings.map((entry) => entry.path);
  assert.ok(findings.includes('_projects/n8n/workflow-templates/curated_output_for_ai/playbooks/workflow-sync.md'));
  assert.ok(findings.includes('_projects/cicd/secure-installer/curated_output_for_ai/playbooks/secure-cicd-installer.md'));
});

test('audit-published-surfaces detects new undeclared published files in a temp copy', () => {
  const cwd = tempCopy();
  const newFile = path.join(cwd, 'skills', 'n8n-local-setup', 'references', 'n8n', 'new-audit-fixture.md');
  fs.writeFileSync(newFile, '# New audit fixture\n\nThis published file is intentionally undeclared.\n', 'utf8');

  const report = runAuditJson(cwd);
  const entry = report.issues.undeclaredPublishedFiles.find((item) => item.path === 'skills/n8n-local-setup/references/n8n/new-audit-fixture.md');
  assert.ok(entry);
  assert.equal(entry.classification, 'manual_skill_surface');
});

test('audit-published-surfaces --check fails when a new undeclared published file is introduced', () => {
  const cwd = tempCopy();
  const newFile = path.join(cwd, 'mcp', 'registry', 'new-audit-fixture.registry.json');
  fs.writeFileSync(newFile, '[]\n', 'utf8');

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new undeclared published surface: mcp\/registry\/new-audit-fixture\.registry\.json/);
});

test('audit-published-surfaces --check fails when a new curated runtime recipe is introduced', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'local-setup');
  const sourcePath = path.join(projectDir, 'curated_output_for_ai', 'references', 'n8n', 'new-runtime-guide.md');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, [
    '<!--',
    'Curated AI-facing source.',
    'Project: n8n.local-setup',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
    '-->',
    '',
    '# New Runtime Guide',
    '',
    '## Setup',
    '',
    '1. Install the local dependency.',
    '2. Import the workflow.',
    ''
  ].join('\n'), 'utf8');

  const manifestPath = path.join(projectDir, 'toolkit.project.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.outputs.push({
    kind: 'curated',
    source: 'curated_output_for_ai/references/n8n/new-runtime-guide.md',
    output: 'skills/n8n-local-setup/references/n8n/new-runtime-guide.md',
    fidelity: 'reviewed_entrypoint'
  });
  manifest.writes.allowed.push('skills/n8n-local-setup/references/n8n/new-runtime-guide.md');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new boundary recipe finding: skills\/n8n-local-setup\/references\/n8n\/new-runtime-guide\.md/);
  assert.match(result.stderr, /new curated directory boundary finding: _projects\/n8n\/local-setup\/curated_output_for_ai\/references\/n8n\/new-runtime-guide\.md/);
});

test('sync-toolkit-projects remains unaffected by the published surface audit', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
