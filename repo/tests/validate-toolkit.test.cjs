'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const validateScript = path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs');
const syncScript = path.join(repoRoot, 'repo', 'scripts', 'sync-toolkit-projects.cjs');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs');
const validator = require(validateScript);
const safeSourceUpdate = require(path.join(repoRoot, 'repo', 'scripts', 'safe-source-update.cjs'));
const sourceWatcher = require(path.join(repoRoot, 'repo', 'scripts', 'watch-project-sources.cjs'));

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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function manifestsById() {
  return new Map(validator.projectManifests().map((manifest) => [manifest.id, manifest]));
}

function manifestOutput(manifest, outputPath) {
  return (manifest.outputs || []).find((output) => output.output === outputPath);
}

test('JSON registries parse in the current repo', () => {
  for (const file of [
    'skills.registry.json',
    'playbooks.registry.json',
    'templates.registry.json',
    'packs.registry.json',
    'projects.registry.json',
    'tools.registry.json',
    'source-repos.registry.json',
    'consumers.registry.json'
  ]) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(repoRoot, 'for_ai', 'registry', file), 'utf8')));
  }
});

test('skill discovery includes migrated skills', () => {
  const skills = validator.skillDirs();
  assert.ok(skills.includes('for_ai/skills/design/ui-ux-secure-frontend-design'));
  assert.ok(skills.includes('for_ai/skills/development/windows-localhost-workflows'));
  assert.ok(skills.includes('for_ai/skills/automation/n8n-workflow-sync'));
  assert.ok(skills.includes('for_ai/skills/automation/n8n-local-setup'));
  assert.ok(skills.includes('for_ai/skills/cicd/secure-cicd-installer'));
  assert.ok(skills.includes('for_ai/skills/portfolio/knowledge-index-updater'));
});

test('project registry includes the initial project modules', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'for_ai', 'registry', 'projects.registry.json'), 'utf8'));
  const ids = registry.map((entry) => entry.id).sort();
  assert.deepEqual(ids, [
    'cicd.secure-installer',
    'design.ui-ux-pro-max',
    'n8n.local-setup',
    'n8n.workflow-templates'
  ]);
});

test('validator expects durable retired source provenance doc instead of migration checklist', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'docs', 'MIGRATION_CHECKLIST.md')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'docs', 'RETIRED-SOURCE-PROVENANCE.md')), true);

  const cwd = tempCopy();
  fs.unlinkSync(path.join(cwd, 'repo', 'docs', 'RETIRED-SOURCE-PROVENANCE.md'));
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing expected file: repo\/docs\/RETIRED-SOURCE-PROVENANCE\.md/);
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

test('.gitattributes preserves _projects _main bytes for source locks', () => {
  const attrs = fs.readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8');
  assert.match(attrs, /^_projects\/\*\*\/_main\/\*\* -text$/m);
  assert.doesNotMatch(attrs, /^projects\/\*\*\/main\/\*\* -text$/m);
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
  walk(path.join(repoRoot, 'for_ai', 'skills', 'design', 'ui-ux-secure-frontend-design'));
  assert.equal(files.some((file) => /\.(ps1|cmd|bat|cjs|js|mjs|ts|tsx|py|sh|exe)$/i.test(file)), false);
});

test('validator allows local-only Python design generator tooling under tools', () => {
  const cwd = tempCopy();
  const testFile = path.join(cwd, 'for_ai', 'tools', 'design-system-generator', 'tests', 'extra_allowed.py');
  fs.writeFileSync(testFile, 'VALUE = 1\n');
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects network, shell, and package-install strings in design generator scripts', () => {
  const cwd = tempCopy();
  const scriptDir = path.join(cwd, 'for_ai', 'tools', 'design-system-generator', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'core.py'), 'import requests\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Design generator script contains forbidden local-only token/);
});

test('generated agent-rule templates are normal Markdown, not one giant fenced block', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const text = fs.readFileSync(path.join(repoRoot, 'for_ai', 'templates', 'agent-rules', file), 'utf8').replace(/\r\n/g, '\n');
    assert.doesNotMatch(text, /Use this generated template[^\n]*\n\n```md\n# AI coding agent execution preferences/);
    assert.match(text, /_projects\/n8n\/local-setup\/_main\/templates\/partials/);
    assert.match(text, /for_ai\/templates\/agent-rules\/partials\/skill-routing-rules\.md/);
    assert.doesNotMatch(text, /^- for_ai\/templates\/agent-rules\/partials/m);
    assert.match(text, /\n# AI coding agent execution preferences\n/);
    assert.match(text, /\n```md\n# SECTION NAME\n/);
  }
});

test('root agent-rule partials are declared linked surfaces when present', () => {
  const partialsDir = path.join(repoRoot, 'for_ai', 'templates', 'agent-rules', 'partials');
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
  assert.equal(linkedOutputs.has('for_ai/templates/agent-rules/partials/skill-routing-rules.md'), true);
});

test('validator rejects broken relative links in non-_main Markdown files', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, 'for_ai', 'mcp', 'projects', 'n8n-local-setup.md'), '\n[Missing local target](DOES-NOT-EXIST.md)\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /for_ai\/mcp\/projects\/n8n-local-setup\.md links to missing path: for_ai\/mcp\/projects\/DOES-NOT-EXIST\.md/);
});

test('Markdown link validation ignores _projects source files', () => {
  const cwd = tempCopy();
  const ignoredDir = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main');
  fs.mkdirSync(ignoredDir, { recursive: true });
  fs.writeFileSync(path.join(ignoredDir, 'IGNORED.md'), '[Ignored missing target](missing.md)\n');
  const curatedDir = path.join(cwd, '_projects', 'n8n', 'local-setup', 'curated_output_for_ai');
  fs.mkdirSync(curatedDir, { recursive: true });
  fs.writeFileSync(path.join(curatedDir, 'OUTPUT_RELATIVE.md'), '[Output-relative target](missing-output.md)\n');
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects README links to absent optional folders', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, '_projects', 'n8n', 'local-setup', 'README.md'), '\n[Generated preview](_generated/)\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /links to missing path: _projects\/n8n\/local-setup\/_generated/);
});

test('changing declared _main partials makes generated agent rules stale', () => {
  const cwd = tempCopy();
  const partial = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'partials', 'n8n-mcp-rules.md');
  fs.appendFileSync(partial, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: for_ai\/templates\/agent-rules\/AGENTS\.md/);
});

test('changing declared _main MCP config source makes root MCP config stale', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'codex-mcp-config.md');
  fs.appendFileSync(source, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: for_ai\/templates\/mcp-configs\/codex-mcp-config\.md/);
});

test('internal AI-facing surfaces are generated from curated project output', () => {
  const manifests = manifestsById();
  const expectedMarkdown = [
    ['n8n.local-setup', 'for_ai/skills/automation/n8n-local-setup/SKILL.md', 'curated_output_for_ai/skills/n8n-local-setup/SKILL.md'],
    ['n8n.local-setup', 'for_ai/skills/automation/n8n-local-setup/README.md', 'curated_output_for_ai/skills/n8n-local-setup/README.md'],
    ['n8n.local-setup', 'for_ai/mcp/projects/n8n-local-setup.md', 'curated_output_for_ai/mcp/n8n-local-setup.md'],
    ['n8n.local-setup', 'for_ai/playbooks/n8n/local-setup.md', 'curated_output_for_ai/playbooks/local-setup.md'],
    ['n8n.local-setup', 'for_ai/templates/mcp-configs/README.md', 'curated_output_for_ai/templates/mcp-configs/README.md'],
    ['n8n.workflow-templates', 'for_ai/skills/automation/n8n-workflow-sync/SKILL.md', 'curated_output_for_ai/skills/n8n-workflow-sync/SKILL.md'],
    ['n8n.workflow-templates', 'for_ai/skills/automation/n8n-workflow-sync/README.md', 'curated_output_for_ai/skills/n8n-workflow-sync/README.md'],
    ['n8n.workflow-templates', 'for_ai/mcp/projects/n8n-workflow-templates.md', 'curated_output_for_ai/mcp/n8n-workflow-templates.md'],
    ['n8n.workflow-templates', 'for_ai/playbooks/n8n/workflow-sync.md', 'curated_output_for_ai/playbooks/workflow-sync.md'],
    ['n8n.workflow-templates', 'for_ai/templates/n8n/sanitizer/README.md', 'curated_output_for_ai/templates/n8n/sanitizer/README.md'],
    ['n8n.workflow-templates', 'for_ai/templates/n8n/workflow-policy/README.md', 'curated_output_for_ai/templates/n8n/workflow-policy/README.md'],
    ['cicd.secure-installer', 'for_ai/skills/cicd/secure-cicd-installer/SKILL.md', 'curated_output_for_ai/skills/secure-cicd-installer/SKILL.md'],
    ['cicd.secure-installer', 'for_ai/skills/cicd/secure-cicd-installer/README.md', 'curated_output_for_ai/skills/secure-cicd-installer/README.md'],
    ['cicd.secure-installer', 'for_ai/mcp/projects/secure-cicd-installer.md', 'curated_output_for_ai/mcp/secure-cicd-installer.md'],
    ['cicd.secure-installer', 'for_ai/playbooks/cicd/secure-cicd-installer.md', 'curated_output_for_ai/playbooks/secure-cicd-installer.md'],
    ['cicd.secure-installer', 'for_ai/templates/cicd/README.md', 'curated_output_for_ai/templates/cicd/README.md'],
    ['cicd.secure-installer', 'for_ai/templates/n8n/sync-helpers/README.md', 'curated_output_for_ai/templates/n8n/sync-helpers/README.md']
  ];
  const expectedJson = [
    ['n8n.local-setup', 'for_ai/packs/codex-n8n-local/pack.json', 'curated_output_for_ai/packs/codex-n8n-local/pack.json'],
    ['n8n.local-setup', 'for_ai/packs/claude-code-n8n-local/pack.json', 'curated_output_for_ai/packs/claude-code-n8n-local/pack.json'],
    ['n8n.workflow-templates', 'for_ai/packs/n8n-workflow-sync/pack.json', 'curated_output_for_ai/packs/n8n-workflow-sync/pack.json'],
    ['cicd.secure-installer', 'for_ai/packs/secure-cicd/pack.json', 'curated_output_for_ai/packs/secure-cicd/pack.json']
  ];

  for (const [projectId, outputPath, source] of expectedMarkdown) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'curated', outputPath);
    assert.equal(output?.source, source, outputPath);
  }
  for (const [projectId, outputPath, source] of expectedJson) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'json', outputPath);
    assert.equal(output?.source, source, outputPath);
  }

  for (const projectId of ['n8n.local-setup', 'n8n.workflow-templates', 'cicd.secure-installer']) {
    for (const output of manifests.get(projectId).outputs || []) {
      if (output.kind !== 'linked') continue;
      assert.match(output.notes || '', /(source-locked|Toolkit-only)/, output.output);
    }
  }
});

test('curated Markdown outputs carry curated-source notices', () => {
  for (const [outputPath, sourcePath] of [
    [
      'for_ai/skills/automation/n8n-local-setup/SKILL.md',
      '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/SKILL.md'
    ],
    [
      'for_ai/skills/automation/n8n-local-setup/README.md',
      '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md'
    ],
    [
      'for_ai/templates/n8n/sync-helpers/README.md',
      '_projects/cicd/secure-installer/curated_output_for_ai/templates/n8n/sync-helpers/README.md'
    ]
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, outputPath), 'utf8').replace(/\r\n/g, '\n');
    assert.match(text, /Generated from toolkit curated output for AI\. Do not edit directly\./, outputPath);
    assert.match(text, new RegExp(`Source: ${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), outputPath);
    assert.match(text, /Update the curated output and run sync\./, outputPath);
  }
});

test('changing curated skill README source makes generated skill README stale', () => {
  const cwd = tempCopy();
  const source = path.join(
    cwd,
    '_projects',
    'n8n',
    'local-setup',
    'curated_output_for_ai',
    'skills',
    'n8n-local-setup',
    'README.md'
  );
  fs.appendFileSync(source, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: for_ai\/skills\/automation\/n8n-local-setup\/README\.md/);
});

test('curated JSON pack outputs match deterministic source formatting', () => {
  for (const [sourcePath, outputPath] of [
    [
      '_projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/pack.json',
      'for_ai/packs/codex-n8n-local/pack.json'
    ],
    [
      '_projects/n8n/workflow-templates/curated_output_for_ai/packs/n8n-workflow-sync/pack.json',
      'for_ai/packs/n8n-workflow-sync/pack.json'
    ],
    [
      '_projects/cicd/secure-installer/curated_output_for_ai/packs/secure-cicd/pack.json',
      'for_ai/packs/secure-cicd/pack.json'
    ]
  ]) {
    const expected = `${JSON.stringify(readJsonFile(path.join(repoRoot, sourcePath)), null, 2)}\n`;
    assert.equal(fs.readFileSync(path.join(repoRoot, outputPath), 'utf8'), expected, outputPath);
  }
});

test('third-party UI UX project remains a linked special case', () => {
  const manifests = manifestsById();
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'curated_output_for_ai')), false);
  for (const outputPath of [
    'for_ai/skills/design/ui-ux-secure-frontend-design/SKILL.md',
    'for_ai/mcp/projects/ui-ux-pro-max.md',
    'for_ai/playbooks/design/ui-ux-pro-max.md',
    'for_ai/tools/design-system-generator/README.md',
    'for_ai/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md',
    'for_ai/packs/design-system-generator/pack.json'
  ]) {
    assert.equal(manifestOutput(manifests.get('design.ui-ux-pro-max'), outputPath)?.kind, 'linked', outputPath);
  }
});

test('project modules require README, manifest, lock, toolkit metadata, and _main only', () => {
  const cwd = tempCopy();
  fs.unlinkSync(path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json'));
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required project module file: _projects\/n8n\/local-setup\/toolkit\.project\.json/);
});

test('project module validation treats curated and generated folders as optional', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /missing (curated_output_for_ai|_generated)/.test(error)).length, 0, errors.join('\n'));
});

test('source-lock audit passes and catches exact-copy drift for retired sources', () => {
  let result = spawnSync(process.execPath, [auditScript], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const cwd = tempCopy();
  const lock = readJsonFile(path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json'));
  assert.equal(lock.source_lifecycle, 'retired_after_migration');
  assert.equal(lock.source_update_policy, 'none');
  assert.equal(lock.public_attribution_required, false);
  const copiedFile = path.join(cwd, '_projects', 'n8n', 'workflow-templates', '_main', 'README.md');
  fs.appendFileSync(copiedFile, '\nDrift test\n');
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact-copy drift/);
});

test('source-lock audit rejects toolkit-local source_path provenance rewrites', () => {
  for (const sourcePath of ['for_ai/templates/n8n/README.md', 'repo/scripts/example.cjs', '_projects/n8n/local-setup/_main/README.md']) {
    const cwd = tempCopy();
    const lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
    const lock = readJsonFile(lockPath);
    lock.files[0].source_path = sourcePath;
    writeJsonFile(lockPath, lock);

    const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0, sourcePath);
    assert.match(result.stderr, /source_path must stay upstream-provenance, not toolkit-local/);
  }
});

test('source-lock audit requires local paths to stay in their topology namespaces', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  lock.files[0].mode = 'adapted';
  lock.files[0].notes = 'Topology namespace regression test.';
  lock.files[0].project_path = 'for_ai/templates/n8n/README.md';
  delete lock.files[0].source_blob_sha;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project_path must point under _projects\//);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  let rootSurfaceEntry = lock.files.find((entry) => entry.root_surface_path);
  rootSurfaceEntry.mode = 'adapted';
  rootSurfaceEntry.notes = 'Topology namespace regression test.';
  rootSurfaceEntry.root_surface_path = 'repo/scripts/validate-toolkit.cjs';
  delete rootSurfaceEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root_surface_path must point under for_ai\//);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.files[0].mode = 'adapted';
  lock.files[0].notes = 'Topology traversal regression test.';
  lock.files[0].project_path = '_projects/../README.md';
  delete lock.files[0].source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project_path must not contain \.\. path segments/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  rootSurfaceEntry = lock.files.find((entry) => entry.root_surface_path);
  rootSurfaceEntry.mode = 'adapted';
  rootSurfaceEntry.notes = 'Topology traversal regression test.';
  rootSurfaceEntry.root_surface_path = 'for_ai/../repo/scripts/validate-toolkit.cjs';
  delete rootSurfaceEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root_surface_path must not contain \.\. path segments/);
});

test('source-lock audit rejects missing or unknown lifecycle metadata', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  delete lock.source_lifecycle;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing source_lifecycle/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.source_lifecycle = 'unknown';
  lock.source_update_policy = 'maybe';
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown source_lifecycle/);
  assert.match(result.stderr, /unknown source_update_policy/);
});

test('source-lock lifecycle metadata accepts retired internal and active third-party sources', () => {
  const retired = readJsonFile(path.join(repoRoot, '_projects', 'n8n', 'local-setup', 'SOURCE-LOCK.json'));
  assert.equal(retired.source_lifecycle, 'retired_after_migration');
  assert.equal(retired.source_role, 'migration_provenance_only');
  assert.equal(retired.source_update_policy, 'none');
  assert.equal(retired.public_attribution_required, false);

  const thirdParty = readJsonFile(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json'));
  assert.equal(thirdParty.source_lifecycle, 'active');
  assert.equal(thirdParty.source_role, 'third_party_attribution_source');
  assert.equal(thirdParty.source_update_policy, 'manual_review_required');
  assert.equal(thirdParty.public_attribution_required, true);
});

test('source watch separates retired provenance sources from active update candidates', () => {
  const plan = sourceWatcher.buildPlan(sourceWatcher.discoverLocks());
  const activeRepos = plan.active_update_candidates.map((entry) => entry.source_repo);
  const retiredRepos = plan.retired_provenance_sources.map((entry) => entry.source_repo);

  assert.deepEqual(activeRepos.filter((repo) => repo.startsWith('weijunswj/')), []);
  assert.ok(retiredRepos.includes('weijunswj/codex-n8n-local-setup'));
  assert.ok(retiredRepos.includes('weijunswj/ai-cicd-installer'));
  assert.ok(retiredRepos.includes('weijunswj/n8n-workflow-templates'));

  const thirdParty = plan.active_update_candidates.find((entry) => entry.source_repo === 'nextlevelbuilder/ui-ux-pro-max-skill');
  assert.ok(thirdParty);
  assert.equal(thirdParty.risk, 'third-party');
  assert.equal(thirdParty.update_policy, 'manual_review_required');
  assert.equal(thirdParty.public_attribution_required, true);
  assert.match(thirdParty.notes, /read-only advisory/i);
  assert.doesNotMatch(thirdParty.notes, /draft PR|open PR|create PR/i);
});

test('source watch rendered output is advisory and does not claim PR creation today', () => {
  const markdown = sourceWatcher.renderMarkdown(sourceWatcher.buildPlan(sourceWatcher.discoverLocks()));
  assert.match(markdown, /advisory/i);
  assert.match(markdown, /Retired internal sources are provenance-only/);
  assert.match(markdown, /does not fetch upstream commits, copy files, update SOURCE-LOCK\.json, create branches, or create PRs/);
  assert.doesNotMatch(markdown, /Draft PR only|opens PRs today|creates PRs today|pushes commits/i);
});

test('public source repo registry excludes retired internal provenance sources', () => {
  const registry = readJsonFile(path.join(repoRoot, 'for_ai', 'registry', 'source-repos.registry.json'));
  const sources = registry.map((entry) => entry.source);
  assert.ok(sources.includes('nextlevelbuilder/ui-ux-pro-max-skill'));
  assert.equal(sources.includes('weijunswj/codex-n8n-local-setup'), false);
  assert.equal(sources.includes('weijunswj/ai-cicd-installer'), false);
  assert.equal(sources.includes('weijunswj/n8n-workflow-templates'), false);
});

test('validator rejects retired internal repos as active public source-watch targets', () => {
  const cwd = tempCopy();
  const registryPath = path.join(cwd, 'for_ai', 'registry', 'source-repos.registry.json');
  const registry = readJsonFile(registryPath);
  registry.push({
    id: 'bad.retired',
    source: 'weijunswj/codex-n8n-local-setup',
    project_module: '_projects/n8n/local-setup'
  });
  writeJsonFile(registryPath, registry);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /retired internal repo must not be listed as active source-watch target/);
});

test('source-lock audit rejects active third-party sources without manual review metadata', () => {
  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  lock.source_update_policy = 'none';
  lock.public_attribution_required = false;
  writeJsonFile(lockPath, lock);
  const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /third-party attribution source must use source_update_policy manual_review_required/);
  assert.match(result.stderr, /third-party attribution source must set public_attribution_required true/);
});

test('curated recipes must source from curated_output_for_ai', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'local-setup');
  const manifestPath = path.join(projectDir, 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  fs.writeFileSync(path.join(projectDir, '_main', 'bad-curated.md'), 'Bad curated source\n');
  manifest.outputs.push({
    kind: 'curated',
    source: '_main/bad-curated.md',
    output: 'for_ai/playbooks/n8n/bad-curated.md'
  });
  manifest.writes.allowed.push('for_ai/playbooks/n8n/bad-curated.md');
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /curated output source must start with curated_output_for_ai\//);
});

test('validator rejects stale mandatory exports architecture wording in permanent docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad-exports.md'), 'Every project module must include an `exports' + '/` folder.\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale mandatory exports architecture wording/);
});

test('validator rejects stale registry YAML references in temp docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad.md'), `Use ${'for_ai/registry/*.' + 'yaml'} here.\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale registry YAML reference/);
});

test('validator rejects stale project exports path references in active docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad-export-source.md'), `Source: ${'projects/design/ui-ux-pro-max/' + 'exports/tools/readme.md'}\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale project exports path reference/);
});

test('validator rejects project landing cards that stop pointing to _main', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, '_projects', 'n8n', 'local-setup', 'README.md'),
    '# Local n8n Setup\n\nUse for_ai/playbooks/ as canonical human documentation.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project README must link to _main\//);
  assert.match(result.stderr, /must not claim for_ai\/playbooks\/ is canonical human documentation/);
});

test('validator rejects oversized project landing cards', () => {
  const cwd = tempCopy();
  const longBody = Array.from({ length: 45 }, (_, index) => `Line ${index + 1}`).join('\n');
  fs.writeFileSync(
    path.join(cwd, '_projects', 'n8n', 'local-setup', 'README.md'),
    `# Local n8n Setup\n\nCanonical docs live in [_main/](_main/).\n\n${longBody}\n`
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project README must stay a tiny landing card/);
});

test('validator rejects source-watch wording that promises live update actions', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'bad-source-watch.md'),
    'Source-watch fetches upstream repos, copies allowlisted files, opens draft PRs, runs live n8n, and mutates credentials.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch wording must stay advisory\/read-only/);
});

test('validator rejects source-watch action claims even with advisory wording', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'bad-source-watch-advisory.md'),
    'Source-watch is advisory but opens draft PRs.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch wording must stay advisory\/read-only/);
});

test('validator allows source-watch action phrases when the action is negated', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'ok-source-watch-negated.md'),
    [
      'source-watch does not open PRs.',
      'source-watch will not create branches.',
      'source-watch never mutates credentials.',
      'source-watch is read-only; it does not fetch upstream repos.'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects pack YAML files in temp dirs', () => {
  const cwd = tempCopy();
  const badDir = path.join(cwd, 'for_ai', 'packs', 'bad');
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
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'secret.md'), `key=${'sk-' + 'A'.repeat(25)}\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /possible secret/);
});

test('safe-source-update classifies n8n helper templates as manual and workflow JSON as blocked', () => {
  assert.equal(safeSourceUpdate.classify('for_ai/templates/n8n/sync-helpers/compare-n8n-workflow-credentials.cjs'), 'manual');
  assert.equal(safeSourceUpdate.classify('for_ai/templates/n8n/sanitizer/sanitise-n8n-template.ps1'), 'manual');
  assert.equal(safeSourceUpdate.classify('n8n-workflows/customer-workflow.json'), 'blocked');
});
