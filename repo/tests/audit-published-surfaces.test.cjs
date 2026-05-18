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

test('sync-toolkit-projects remains unaffected by the published surface audit', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
