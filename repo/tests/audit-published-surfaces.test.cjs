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

function addCrossOwnedOutputFixture(cwd, metadata = {}) {
  const projectDir = path.join(cwd, '_projects', 'cicd', 'secure-installer');
  const sourceRel = 'curated_output_for_ai/templates/n8n/sync-helpers/new-cross-owned-helper.md';
  const outputRel = 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/new-cross-owned-helper.md';
  const sourcePath = path.join(projectDir, sourceRel);
  const outputPath = path.join(cwd, outputRel);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(sourcePath, '# New cross-owned helper fixture\n\nReview-required n8n template fixture.\n', 'utf8');
  fs.writeFileSync(outputPath, '# New cross-owned helper fixture\n\nReview-required n8n template fixture.\n', 'utf8');

  const manifestPath = path.join(projectDir, 'toolkit.project.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.outputs.push({
    kind: 'curated',
    source: sourceRel,
    output: outputRel,
    notes: 'AI-facing reviewed template fixture.',
    fidelity: 'reviewed_entrypoint',
    ...metadata
  });
  manifest.writes.allowed.push(outputRel);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return outputRel;
}

test('audit-published-surfaces runs successfully on the current repo', () => {
  const result = runAudit();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Published surface audit/);
});

test('audit-published-surfaces detects pack-installed undeclared files', () => {
  const report = runAuditJson();
  const paths = report.issues.packInstalledUndeclared.map((entry) => entry.path);
  assert.ok(paths.includes('skills/ui-ux-secure-frontend-design/references/privacy-security-safety.md'));
});

test('audit-published-surfaces has no n8n shared-surface helper leftovers', () => {
  const report = runAuditJson();

  assert.equal(report.summary.crossOwnedOutputs, 0);
  assert.equal(report.summary.sharedSurfaceOutputs, 0);
  assert.equal(report.summary.sharedSurfaceMetadataFindings, 0);
  assert.deepEqual(report.issues.crossOwnedOutputs, []);
  assert.deepEqual(report.issues.sharedSurfaceOutputs, []);
});

test('audit-published-surfaces classifies curated boundary recipes', () => {
  const report = runAuditJson();
  assert.ok(report.summary.boundaryRecipeOutputs > 0);
  for (const classification of [
    'main_full_fidelity',
    'curated_router',
    'curated_index',
    'curated_reference',
    'curated_metadata',
    'curated_pack_readme',
    'curated_shim',
    'curated_spec',
    'curated_template',
    'curated_template_index',
    'linked_exception'
  ]) {
    assert.ok(report.boundaryClassifications[classification] > 0, classification);
  }
  assert.equal(report.boundaryClassifications.suspicious_curated_runtime || 0, 0);
  assert.deepEqual(report.issues.boundaryRecipeFindings, []);
});

test('audit-published-surfaces inspects curated directory contents', () => {
  const report = runAuditJson();
  const findings = report.issues.curatedDirectoryFindings.map((entry) => entry.path);
  assert.equal(findings.some((entry) => entry.includes('/curated_output_for_ai/playbooks/')), false);
  for (const platformOverview of [
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/chatgpt-web.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/claude-web.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md'
  ]) {
    assert.equal(findings.includes(platformOverview), false, platformOverview);
  }
});

test('n8n local setup platform overviews declare their curated boundary', () => {
  for (const relPath of [
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/chatgpt-web.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/claude-web.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md'
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
    assert.match(text, /^# .*(Platform Overview|Platform Router)/m, relPath);
    assert.match(text, /^## Boundary$/m, relPath);
    assert.match(text, /not the full runtime setup guide/i, relPath);
    assert.match(text, /full-fidelity references and templates/i, relPath);
  }
});

test('n8n workflow toolkit curated references declare their boundary', () => {
  for (const relPath of [
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/references/credential-safety.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/references/import-export-flow.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/references/workflow-sync.md'
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
    assert.match(text, /^## Boundary$/m, relPath);
    assert.match(text, /short .*?(overview|reference|safety wrapper|safety checklist)/i, relPath);
    assert.match(text, /not the full runtime (guide|helper guide)/i, relPath);
  }
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

test('audit-published-surfaces --check fails when a new cross-owned output lacks shared metadata', () => {
  const cwd = tempCopy();
  const outputRel = addCrossOwnedOutputFixture(cwd);

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`new cross-owned output: cicd\\.secure-installer -> n8n\\.workflow-toolkit: ${outputRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('audit-published-surfaces rejects shared-surface metadata without a reason', () => {
  const cwd = tempCopy();
  const outputRel = addCrossOwnedOutputFixture(cwd, {
    shared_surface: true,
    surface_owner_project: 'n8n.workflow-toolkit'
  });

  const report = runAuditJson(cwd);
  assert.ok(report.issues.crossOwnedOutputs.some((entry) => entry.output === outputRel));
  assert.equal(report.issues.sharedSurfaceOutputs.some((entry) => entry.output === outputRel), false);
  const finding = report.issues.sharedSurfaceMetadataFindings.find((entry) => entry.output === outputRel);
  assert.ok(finding);
  assert.deepEqual(finding.reasons, ['shared_surface_reason is required']);

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new shared-surface metadata finding:/);
  assert.match(result.stderr, /shared_surface_reason is required/);
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

test('audit-published-surfaces keeps reviewed templates under runtime-heft checks', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'local-setup');
  const sourceRel = 'curated_output_for_ai/templates/agent-rules/new-runtime-template.md';
  const outputRel = 'skills/n8n-local-setup/templates/agent-rules/new-runtime-template.md';
  const sourcePath = path.join(projectDir, sourceRel);
  const outputPath = path.join(cwd, outputRel);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(sourcePath, [
    '<!--',
    'Curated AI-facing source.',
    'Project: n8n.local-setup',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
    '-->',
    '',
    '# New Runtime Template',
    '',
    '## Setup',
    '',
    '1. Install local dependencies.',
    '2. Import the workflow.',
    ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(outputPath, '# New Runtime Template\n\n## Setup\n\n1. Install local dependencies.\n', 'utf8');

  const manifestPath = path.join(projectDir, 'toolkit.project.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.outputs.push({
    kind: 'curated',
    source: sourceRel,
    output: outputRel,
    notes: 'AI-facing reviewed template fixture.',
    fidelity: 'reviewed_entrypoint'
  });
  manifest.writes.allowed.push(outputRel);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const report = runAuditJson(cwd);
  const finding = report.issues.boundaryRecipeFindings.find((entry) => entry.path === outputRel);
  assert.ok(finding);
  assert.equal(finding.classification, 'suspicious_curated_runtime');
  assert.ok(finding.reasons.some((reason) => /runtime markers: .*Setup/.test(reason)));

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new boundary recipe finding: skills\/n8n-local-setup\/templates\/agent-rules\/new-runtime-template\.md/);
});

test('audit-published-surfaces still detects project duplicate content outside the n8n provenance exception', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', '_main', 'helper-scripts', 'import-export-sync', 'validate-n8n-workflows.cjs');
  const target = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'duplicate-validate-n8n-workflows.cjs');
  fs.copyFileSync(source, target);

  const report = runAuditJson(cwd);
  assert.ok(report.issues.duplicateProjectContentGroups.some((group) =>
    group.files.some((file) => file.path === '_projects/n8n/local-setup/_main/duplicate-validate-n8n-workflows.cjs')
  ));
});

test('audit-published-surfaces still flags runtime-heavy n8n workflow toolkit reference fixtures', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit');
  const sourcePath = path.join(projectDir, 'curated_output_for_ai', 'references', 'new-runtime-reference.md');
  fs.writeFileSync(sourcePath, [
    '<!--',
    'Curated AI-facing source.',
    'Project: n8n.workflow-toolkit',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
    '-->',
    '',
    '# New Runtime Reference',
    '',
    '## Boundary',
    '',
    'This is a short workflow sync safety wrapper. It is not the full runtime guide.',
    '',
    '## Setup',
    '',
    '```powershell',
    'npm install',
    '```',
    '',
    '```powershell',
    'npm run build',
    '```',
    '',
    '```powershell',
    'npm run validate',
    '```',
    '',
    '```powershell',
    'npm run deploy',
    '```',
    ''
  ].join('\n'), 'utf8');

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new curated directory boundary finding: _projects\/n8n\/workflow-toolkit\/curated_output_for_ai\/references\/new-runtime-reference\.md/);
});

test('audit-published-surfaces still flags runtime-heavy platform overview fixtures', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'local-setup');
  const sourcePath = path.join(projectDir, 'curated_output_for_ai', 'references', 'ai-agent-platforms', 'new-runtime-platform.md');
  fs.writeFileSync(sourcePath, [
    '<!--',
    'Curated AI-facing source.',
    'Project: n8n.local-setup',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
    '-->',
    '',
    '# New Runtime Platform Overview',
    '',
    '## Boundary',
    '',
    'This is a short platform overview and routing note. It is not the full runtime setup guide.',
    '',
    'For full setup detail, use the local full-fidelity references and templates in this copied skill folder.',
    '',
    '## Setup',
    '',
    '```powershell',
    'npm install',
    '```',
    '',
    '```powershell',
    'npm run build',
    '```',
    '',
    '```powershell',
    'npm run validate',
    '```',
    '',
    '```powershell',
    'npm run deploy',
    '```',
    ''
  ].join('\n'), 'utf8');

  const result = runAudit(['--check'], cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new curated directory boundary finding: _projects\/n8n\/local-setup\/curated_output_for_ai\/references\/ai-agent-platforms\/new-runtime-platform\.md/);
});

test('sync-toolkit-projects remains unaffected by the published surface audit', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
