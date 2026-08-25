'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const validateScript = path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const publisherReferencePaths = [
  'skills/context-preserving-ai-publisher/references/audit-and-baseline-workflow.md',
  'skills/context-preserving-ai-publisher/references/validation-strategy.md',
  'skills/context-preserving-ai-publisher/templates/project-module/SOURCE-LOCK.template.json',
  'skills/context-preserving-ai-publisher/templates/project-module/toolkit.project.template.json',
  'skills/context-preserving-ai-publisher/templates/repo-docs/project-module-standard.template.md'
];

function readText(relPath, root = repoRoot) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-validate-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.tmp' || rel.startsWith('.tmp/') ||
        rel === '.n8n-local' || rel.startsWith('.n8n-local/') ||
        rel === '.n8n-workflow-backups' || rel.startsWith('.n8n-workflow-backups/') ||
        rel === '_dist' || rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runValidate(cwd) {
  return spawnSync(process.execPath, [validateScript], { cwd, encoding: 'utf8' });
}

test('direct canonical topology validates without retired project or MCP surfaces', () => {
  const validator = require(validateScript);
  assert.equal(fs.existsSync(path.join(repoRoot, legacyProjectToken)), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'mcp')), false);
  assert.equal(validator.skillDirs().includes('skills/knowledge-index-updater'), false);
  assert.deepEqual(validator.validate(), []);
});

test('skill routing and safety coverage match the direct skill surface', () => {
  const validator = require(validateScript);
  const skills = validator.skillDirs().map((relPath) => path.basename(relPath)).sort();
  const routing = validator.parseSkillRouting(readText('repo/contracts/agent-rules/toolkit-skill-routing.md'));
  assert.deepEqual([...routing.routed, ...routing.omitted.map((entry) => entry.name)].sort(), skills);
  assert.equal(routing.omitted.some((entry) => entry.name === 'knowledge-index-updater'), false);
  assert.equal(new Set(skills).size, skills.length);
});

test('validator shares the exact five-file publisher reference allowlist', () => {
  const validator = require(validateScript);
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs'));
  assert.deepEqual(publisherReferencePaths.filter(audit.legacyReferenceAllowed), publisherReferencePaths);
  assert.equal(audit.legacyReferenceAllowed('skills/context-preserving-ai-publisher/README.md'), false);
  assert.deepEqual(validator.validate(), []);
});

test('source locks are discovered only from canonical source-watch provenance', () => {
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs'));
  const result = audit.auditSourceLocks();
  assert.deepEqual(result.errors, []);
  assert.equal(result.locks.length, 2);
  assert.ok(result.locks.every((relPath) => relPath.startsWith('repo/source-watch/provenance/')));
});

test('validator rejects a legacy project tree in a copied workspace', () => {
  const cwd = copyRepo();
  fs.mkdirSync(path.join(cwd, legacyProjectToken), { recursive: true });
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Legacy ${legacyProjectToken}/ tree must not exist`));
});

test('validator rejects retired skills and pack manifests', () => {
  const cwd = copyRepo();
  const retiredSkill = path.join(cwd, 'skills', 'knowledge-index-updater');
  fs.mkdirSync(retiredSkill, { recursive: true });
  fs.writeFileSync(path.join(retiredSkill, 'SKILL.md'), '---\nname: knowledge-index-updater\ndescription: retired fixture\n---\n', 'utf8');
  fs.writeFileSync(path.join(retiredSkill, 'README.md'), '# retired\n', 'utf8');
  const packDir = path.join(cwd, 'skills', 'fixture', 'packs', 'old');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.json'), '{}\n', 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Retired skill surface is present/);
  assert.match(result.stderr, /Pack manifests are not supported/);
});

test('validator rejects legacy publisher references in canonical files', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'repo', 'contracts', 'legacy-reference-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects legacy publisher references in ordinary canonical skills', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'skills', 'n8n-local-setup', 'references', 'legacy-reference-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects legacy references in a non-allowlisted publisher file', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'skills', 'context-preserving-ai-publisher', 'references', 'legacy-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator detects stale plugin package versions', () => {
  const cwd = copyRepo();
  const manifestPath = path.join(cwd, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = '0.0.0';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version does not match/);
});

test('validation workflow contains only retained read-only checks', () => {
  const workflow = readText('.github/workflows/validate.yml');
  assert.match(workflow, /node repo\/scripts\/sync-agent-instruction-shims\.cjs --check/);
  assert.match(workflow, /node repo\/scripts\/sync-repo-doc-contract\.cjs --check/);
  assert.match(workflow, /node repo\/scripts\/audit-project-source-locks\.cjs/);
  assert.match(workflow, /node repo\/scripts\/audit-published-surfaces\.cjs --check/);
  assert.match(workflow, /node repo\/scripts\/validate-toolkit\.cjs/);
  assert.match(workflow, /node --test repo\/tests\/\*\.test\.cjs/);
  assert.doesNotMatch(workflow, /sync-toolkit-projects\.cjs|package-skills\.cjs|package-packs\.cjs/);
});

test('retired publisher and writeback machinery remains absent', () => {
  for (const relPath of [
    'repo/scripts/sync-toolkit-projects.cjs',
    'repo/scripts/package-skills.cjs',
    'repo/scripts/package-packs.cjs'
  ]) assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, relPath);
});

test('managed source-of-truth and instruction checks pass from an explicit workspace', () => {
  for (const script of [
    'repo/scripts/sync-agent-instruction-shims.cjs',
    'repo/scripts/sync-repo-doc-contract.cjs',
    'repo/scripts/validate-toolkit.cjs'
  ]) {
    const cwd = copyRepo();
    const result = spawnSync(process.execPath, [path.join(repoRoot, script), '--workspace', cwd, ...(script.includes('validate-toolkit') ? [] : ['--check'])], {
      cwd: os.tmpdir(),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${script}\n${result.stderr}`);
  }
});
