'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');

const targetMappings = [
  'skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md',
  'skills/secure-cicd-installer/templates/cicd/safe-source-update-policy.md',
  'skills/secure-cicd-installer/templates/github-actions/README.md'
];

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function runAuditJson() {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Secure CI/CD direct template surfaces are present', () => {
  for (const outputPath of targetMappings) {
    assert.equal(fs.existsSync(path.join(repoRoot, outputPath)), true, outputPath);
  }
});

test('Secure CI/CD direct surfaces are included in a clean canonical audit', () => {
  const report = runAuditJson();
  assert.deepEqual(report.errors, []);
  assert.equal(report.snapshot.project_tree_present, false);
  assert.deepEqual(report.snapshot.pack_manifests, []);
});

test('Secure CI/CD direct surface has no pack manifests', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills/secure-cicd-installer', 'packs')), false);
  const report = runAuditJson();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.snapshot.pack_manifests, []);
});

test('Secure CI/CD status template is no longer a suspicious published surface', () => {
  const report = runAuditJson();
  assert.deepEqual(report.errors, []);
});

test('Secure CI/CD direct template outputs have no generated-source notices', () => {
  for (const outputPath of targetMappings) {
    assert.doesNotMatch(readText(outputPath), /Generated from toolkit (?:project source|curated output for AI)/, outputPath);
  }
});
