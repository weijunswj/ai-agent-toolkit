'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const validateScript = path.join(repoRoot, 'scripts', 'validate-toolkit.cjs');
const syncScript = path.join(repoRoot, 'scripts', 'sync-toolkit-projects.cjs');
const auditScript = path.join(repoRoot, 'scripts', 'audit-project-source-locks.cjs');
const validator = require(validateScript);
const safeSourceUpdate = require(path.join(repoRoot, 'scripts', 'safe-source-update.cjs'));

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-validate-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      if (!rel) return true;
      return !(
        rel === '.git' ||
        rel.startsWith('.git/') ||
        rel === 'node_modules' ||
        rel.startsWith('node_modules/') ||
        rel === '_dist' ||
        rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runValidate(cwd) {
  return spawnSync(process.execPath, [validateScript], { cwd, encoding: 'utf8' });
}

test('JSON registries parse in the current repo', () => {
  for (const file of [
    'skills.registry.json',
    'guides.registry.json',
    'templates.registry.json',
    'packs.registry.json',
    'projects.registry.json',
    'tools.registry.json',
    'source-repos.registry.json',
    'consumers.registry.json'
  ]) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(repoRoot, 'registry', file), 'utf8')));
  }
});

test('skill discovery includes migrated skills', () => {
  const skills = validator.skillDirs();
  assert.ok(skills.includes('skills/design/ui-ux-secure-frontend-design'));
  assert.ok(skills.includes('skills/development/windows-localhost-workflows'));
  assert.ok(skills.includes('skills/automation/n8n-workflow-sync'));
  assert.ok(skills.includes('skills/automation/n8n-local-setup'));
  assert.ok(skills.includes('skills/cicd/secure-cicd-installer'));
  assert.ok(skills.includes('skills/portfolio/knowledge-index-updater'));
});

test('project registry includes the initial project modules', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'registry', 'projects.registry.json'), 'utf8'));
  const ids = registry.map((entry) => entry.id).sort();
  assert.deepEqual(ids, [
    'cicd.secure-installer',
    'design.ui-ux-pro-max',
    'n8n.local-setup',
    'n8n.workflow-templates'
  ]);
});

test('project modules use _projects/_main with no mandatory exports tree', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'projects')), false);

  for (const rel of [
    '_projects/n8n/local-setup',
    '_projects/n8n/workflow-templates',
    '_projects/cicd/secure-installer',
    '_projects/design/ui-ux-pro-max'
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, rel, 'toolkit.project.json'), 'utf8'));
    assert.equal(manifest.module_path, rel);
    assert.equal(manifest.main_path, `${rel}/_main`);
    assert.equal(fs.existsSync(path.join(repoRoot, rel, '_main')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, rel, 'main')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, rel, 'exports')), false);
  }
});

test('design skill front matter and OpenAI metadata are approved', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /Design skill/.test(error)).length, 0, errors.join('\n'));
});

test('instruction-only design skill contains no executable files', () => {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(path.join(repoRoot, 'skills', 'design', 'ui-ux-secure-frontend-design'));
  assert.equal(files.some((file) => /\.(ps1|cmd|bat|cjs|js|mjs|ts|tsx|py|sh|exe)$/i.test(file)), false);
});

test('validator allows local-only Python design generator tooling under tools', () => {
  const cwd = tempCopy();
  const testFile = path.join(cwd, 'tools', 'design-system-generator', 'tests', 'extra_allowed.py');
  fs.writeFileSync(testFile, 'VALUE = 1\n');
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects network, shell, and package-install strings in design generator scripts', () => {
  const cwd = tempCopy();
  const scriptDir = path.join(cwd, 'tools', 'design-system-generator', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'core.py'), 'import requests\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Design generator script contains forbidden local-only token/);
});

test('generated agent-rule templates are normal Markdown, not one giant fenced block', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const text = fs.readFileSync(path.join(repoRoot, 'templates', 'agent-rules', file), 'utf8');
    assert.doesNotMatch(text, /Use this generated template[^\n]*\n\n```md\n# AI coding agent execution preferences/);
    assert.match(text, /_projects\/n8n\/local-setup\/_main\/templates\/partials/);
    assert.match(text, /templates\/agent-rules\/partials\/skill-routing-rules\.md/);
    assert.doesNotMatch(text, /^- templates\/agent-rules\/partials/m);
    assert.match(text, /\n# AI coding agent execution preferences\n/);
    assert.match(text, /\n```md\n# SECTION NAME\n/);
  }
});

test('root agent-rule partials are declared linked surfaces when present', () => {
  const partialsDir = path.join(repoRoot, 'templates', 'agent-rules', 'partials');
  const files = fs.existsSync(partialsDir)
    ? fs.readdirSync(partialsDir, { recursive: true }).filter((entry) => fs.statSync(path.join(partialsDir, entry)).isFile()).map((entry) => entry.replace(/\\/g, '/')).sort()
    : [];
  assert.deepEqual(files, ['skill-routing-rules.md']);

  const manifests = validator.projectManifests();
  const linkedOutputs = new Set();
  for (const manifest of manifests) {
    for (const output of manifest.outputs || []) {
      if (output.kind === 'linked') linkedOutputs.add(output.output);
    }
  }
  assert.equal(linkedOutputs.has('templates/agent-rules/partials/skill-routing-rules.md'), true);
});

test('changing declared _main partials makes generated agent rules stale', () => {
  const cwd = tempCopy();
  const partial = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'partials', 'n8n-mcp-rules.md');
  fs.appendFileSync(partial, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: templates\/agent-rules\/AGENTS\.md/);
});

test('changing declared _main MCP config source makes root MCP config stale', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'codex-mcp-config.md');
  fs.appendFileSync(source, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: templates\/mcp-configs\/codex-mcp-config\.md/);
});

test('root skills are linked and not duplicated under curated output by default', () => {
  const curatedSkillCopies = fs.existsSync(path.join(repoRoot, '_projects'))
    ? fs.readdirSync(path.join(repoRoot, '_projects'), { recursive: true })
        .map((entry) => String(entry).replace(/\\/g, '/'))
        .filter((entry) => entry.includes('curated_output_for_ai/skills/'))
    : [];
  assert.deepEqual(curatedSkillCopies, []);

  const manifests = validator.projectManifests();
  const linkedOutputs = new Set();
  for (const manifest of manifests) {
    for (const output of manifest.outputs || []) {
      if (output.kind === 'linked') linkedOutputs.add(output.output);
    }
  }
  assert.equal(linkedOutputs.has('skills/automation/n8n-local-setup/SKILL.md'), true);
  assert.equal(linkedOutputs.has('skills/automation/n8n-workflow-sync/SKILL.md'), true);
  assert.equal(linkedOutputs.has('skills/cicd/secure-cicd-installer/SKILL.md'), true);
  assert.equal(linkedOutputs.has('skills/design/ui-ux-secure-frontend-design/SKILL.md'), true);
});

test('source-lock audit passes and catches exact-copy drift', () => {
  let result = spawnSync(process.execPath, [auditScript], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const cwd = tempCopy();
  const copiedFile = path.join(cwd, '_projects', 'n8n', 'workflow-templates', '_main', 'README.md');
  fs.appendFileSync(copiedFile, '\nDrift test\n');
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact-copy drift/);
});

test('validator rejects stale registry YAML references in temp docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'docs', 'bad.md'), `Use ${'registry/*.' + 'yaml'} here.\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale registry YAML reference/);
});

test('validator rejects pack YAML files in temp dirs', () => {
  const cwd = tempCopy();
  const badDir = path.join(cwd, 'packs', 'bad');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'pack.' + 'yaml'), 'id: bad\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not allowed/);
});

test('validator rejects forbidden local files and folders', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, '.env'), 'EXAMPLE=unsafe\n');
  fs.mkdirSync(path.join(cwd, '.n8n-local'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'sample.live-export.json'), '{}\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Forbidden env file/);
  assert.match(result.stderr, /Forbidden directory/);
  assert.match(result.stderr, /Live n8n import\/export file/);
});

test('validator rejects obvious secret-looking strings', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'docs', 'secret.md'), `key=${'sk-' + 'A'.repeat(25)}\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /possible secret/);
});

test('safe-source-update classifies n8n helper templates as manual and workflow JSON as blocked', () => {
  assert.equal(safeSourceUpdate.classify('templates/n8n/sync-helpers/compare-n8n-workflow-credentials.cjs'), 'manual');
  assert.equal(safeSourceUpdate.classify('templates/n8n/sanitizer/sanitise-n8n-template.ps1'), 'manual');
  assert.equal(safeSourceUpdate.classify('n8n-workflows/customer-workflow.json'), 'blocked');
});
