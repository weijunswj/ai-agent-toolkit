'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const validateScript = path.join(repoRoot, 'scripts', 'validate-toolkit.cjs');
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
  assert.ok(skills.includes('skills/portfolio/knowledge-index-updater'));
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
  const toolRoot = path.join(cwd, 'tools', 'design-system-generator');
  fs.mkdirSync(path.join(toolRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(toolRoot, 'data'), { recursive: true });
  fs.writeFileSync(path.join(toolRoot, 'README.md'), '# Local design generator\n');
  fs.writeFileSync(path.join(toolRoot, 'LICENSE-THIRD-PARTY-NOTES.md'), '# Third-party notes\n');
  fs.writeFileSync(path.join(toolRoot, 'scripts', 'core.py'), 'import csv\n');
  fs.writeFileSync(path.join(toolRoot, 'scripts', 'design_system.py'), 'from core import search\n');
  fs.writeFileSync(path.join(toolRoot, 'data', 'styles.csv'), 'Style Category,Keywords\nMinimal,clean\n');
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
