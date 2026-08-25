'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';

function readText(relPath, root = repoRoot) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-audit-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.tmp' || rel.startsWith('.tmp/') ||
        rel === '_dist' || rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runAudit(cwd, args = []) {
  return spawnSync(process.execPath, [auditScript, '--workspace', cwd, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
}

test('canonical surface snapshot has no packs, retired skills, or project tree', () => {
  const audit = require(auditScript);
  const snapshot = audit.snapshot();
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.project_tree_present, false);
  assert.deepEqual(snapshot.pack_manifests, []);
  assert.equal(snapshot.skills.includes('skills/knowledge-index-updater'), false);
  assert.equal(audit.validate(snapshot).length, 0);
});

test('published surface baseline matches the canonical snapshot', () => {
  const result = runAudit(repoRoot, ['--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('audit rejects a newly introduced legacy reference under a canonical surface', () => {
  const cwd = copyRepo();
  fs.writeFileSync(
    path.join(cwd, 'skills', 'n8n-local-setup', 'references', 'legacy-fixture.md'),
    `${legacyProjectToken}/n8n/${legacyCuratedToken}/reference.md\n`,
    'utf8'
  );
  const result = runAudit(cwd, ['--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /references the retired project\/publisher topology/);
});

test('audit rejects new pack manifests and the retired skill surface', () => {
  const cwd = copyRepo();
  const packDir = path.join(cwd, 'skills', 'fixture', 'packs', 'retired');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.json'), '{}\n', 'utf8');
  const retiredSkill = path.join(cwd, 'skills', 'knowledge-index-updater');
  fs.mkdirSync(retiredSkill, { recursive: true });
  fs.writeFileSync(path.join(retiredSkill, 'SKILL.md'), '---\nname: knowledge-index-updater\ndescription: retired fixture\n---\n', 'utf8');
  fs.writeFileSync(path.join(retiredSkill, 'README.md'), '# retired\n', 'utf8');
  const result = runAudit(cwd, ['--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Pack manifests are not supported/);
  assert.match(result.stdout, /Retired skill surface is present/);
});

test('audit rejects a present legacy project tree', () => {
  const cwd = copyRepo();
  fs.mkdirSync(path.join(cwd, legacyProjectToken), { recursive: true });
  const result = runAudit(cwd, ['--check']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Legacy ${legacyProjectToken}/ tree is present`));
});
