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
const agentInstructionScript = path.join(repoRoot, 'repo', 'scripts', 'sync-agent-instruction-shims.cjs');
const contractScript = path.join(repoRoot, 'repo', 'scripts', 'sync-repo-doc-contract.cjs');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs');
const validator = require(validateScript);
const projectSync = require(syncScript);
const safeSourceUpdate = require(path.join(repoRoot, 'repo', 'scripts', 'safe-source-update.cjs'));
const sourceWatcher = require(path.join(repoRoot, 'repo', 'scripts', 'watch-project-sources.cjs'));

const contractPartialPath = '_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md';
const contractBegin = `<!-- AI-AGENT-TOOLKIT:${contractPartialPath}:BEGIN SOURCE-OF-TRUTH-CONTRACT v1 -->`;
const contractEnd = `<!-- AI-AGENT-TOOLKIT:${contractPartialPath}:END SOURCE-OF-TRUTH-CONTRACT -->`;
const sourceWatchPrNotificationRule = 'Scheduled source-watch is PR-notification-only. It may compare active third-party SOURCE-LOCK pins with upstream GitHub commits and open or update a stable review PR. It must not copy upstream files, update SOURCE-LOCK pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat the notification PR as approval to change source. Real source updates require a separate human-approved PR after review.';

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
        rel === '.n8n-local' ||
        rel.startsWith('.n8n-local/') ||
        rel === '.tmp' ||
        rel.startsWith('.tmp/') ||
        rel === 'n8n-workflows' ||
        rel.startsWith('n8n-workflows/') ||
        rel === '.to-sanitise' ||
        rel.startsWith('.to-sanitise/') ||
        rel === '.sanitised' ||
        rel.startsWith('.sanitised/') ||
        rel === '.n8n-workflow-backups' ||
        rel.startsWith('.n8n-workflow-backups/') ||
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

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generatedPayload(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/\n````````md\n([\s\S]*?)\n````````\n$/);
  assert.ok(match, 'generated template has one trailing 8-backtick Markdown payload fence');
  assert.equal((normalized.match(/^````````md$/gm) || []).length, 1, 'single opening 8-backtick payload fence');
  assert.equal((normalized.match(/^````````$/gm) || []).length, 1, 'single closing 8-backtick payload fence');
  return match[1];
}

function generatedNoticeCount(text) {
  return (text.match(/Generated from toolkit (?:project source|curated output for AI)\. Do not edit directly\./g) || []).length;
}

const curatedRepoLocalSafetyComment = [
  '<!--',
  'Curated AI-facing source.',
  'Project: development.ai-coding-agent-rules',
  'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
  '-->'
].join('\n');

function managedRepoLocalPayload(executionPrompt, n8nAdapter) {
  return [
    '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->',
    executionPrompt.trimEnd(),
    '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md:END GLOBAL-AGENTS.MD-TEMPLATE -->',
    '',
    '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:BEGIN N8N-AGENT-RULES-ADAPTER v1 -->',
    n8nAdapter.trimEnd(),
    '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:END N8N-AGENT-RULES-ADAPTER -->',
    ''
  ].join('\n');
}

function assertBareRepoLocalTemplate(rel, text) {
  const safetyPrefix = `${curatedRepoLocalSafetyComment}\n\n`;
  assert.ok(text.startsWith(safetyPrefix), `${rel} starts with the exact curated-source safety comment`);
  const body = text.slice(safetyPrefix.length);
  const forbiddenPatterns = [
    [/Generated from toolkit/i, 'generated toolkit notice'],
    [/This file is inert/i, 'inert template prose'],
    [/copy or merge the fenced payload/i, 'fenced-payload install prose'],
    [/^````````md$/m, 'opening 8-backtick payload fence'],
    [/^````````$/m, 'closing 8-backtick payload fence'],
    [/^## Repo-local /m, 'README-style repo-local install heading'],
    [/<repo>\\/i, 'README-style destination example'],
    [/Or create it with PowerShell/i, 'README-style PowerShell install prose']
  ];

  for (const [pattern, label] of forbiddenPatterns) {
    assert.doesNotMatch(body, pattern, `${rel} must be a bare payload without ${label}`);
  }
  assert.doesNotMatch(body, /Curated AI-facing source|Review rule:/i, `${rel} must not duplicate curated-source comments in the payload body`);
}

function sourceWatchPrBodyText(workflow) {
  const normalized = workflow.replace(/\r\n/g, '\n');
  const marker = 'cat > "$PR_BODY" <<\'EOF\'';
  const markerMatch = normalized.match(new RegExp(`^([ \\t]*)${escapeRegExp(marker)}[ \\t]*$`, 'm'));
  assert.ok(markerMatch, 'source-watch PR body heredoc marker is present');
  const bodyMatch = normalized.match(new RegExp(`${escapeRegExp(marker)}\\n([\\s\\S]*?)\\n[ \\t]*EOF`, 'm'));
  assert.ok(bodyMatch, 'source-watch PR body heredoc is present');
  const yamlBlockIndent = markerMatch[1];
  return bodyMatch[1]
    .split('\n')
    .map((line) => line.startsWith(yamlBlockIndent) ? line.slice(yamlBlockIndent.length) : line)
    .join('\n');
}

function secureCicdPromptFromReadme(rootDir = repoRoot) {
  const readme = readTextFile(path.join(rootDir, '_projects', 'cicd', 'secure-installer', '_main', 'README.md'));
  const start = '# Copy this prompt into your AI coding agent';
  const end = '\n---\n\n## What the AI agent should generate';
  const startIndex = readme.indexOf(start);
  assert.notEqual(startIndex, -1, 'Secure CI/CD prompt start marker');
  const endIndex = readme.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, 'Secure CI/CD prompt end marker');
  return `${readme.slice(startIndex, endIndex).trimEnd()}\n`;
}

function replaceLast(text, search, replacement) {
  const index = text.lastIndexOf(search);
  assert.notEqual(index, -1, `missing text to replace: ${search}`);
  return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`;
}

function createSymlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.symlinkSync(target, linkPath, type);
  } catch (error) {
    if (['EPERM', 'EINVAL', 'ENOTSUP', 'EACCES'].includes(error.code)) {
      t.skip(`symlink creation is not available in this environment: ${error.message}`);
      return false;
    }
    throw error;
  }
  return true;
}

function moveWorkflowStepAfter(text, sourceName, targetName) {
  const sourceMarker = `      - name: ${sourceName}`;
  const targetMarker = `      - name: ${targetName}`;
  const sourceStart = text.indexOf(sourceMarker);
  assert.notEqual(sourceStart, -1, `missing source step: ${sourceName}`);
  const sourceEnd = text.indexOf('\n      - name:', sourceStart + sourceMarker.length);
  assert.notEqual(sourceEnd, -1, `missing source step end: ${sourceName}`);
  const sourceBlock = text.slice(sourceStart, sourceEnd);
  const withoutSource = `${text.slice(0, sourceStart)}${text.slice(sourceEnd + 1)}`;
  const targetStart = withoutSource.indexOf(targetMarker);
  assert.notEqual(targetStart, -1, `missing target step: ${targetName}`);
  const targetEnd = withoutSource.indexOf('\n      - name:', targetStart + targetMarker.length);
  assert.notEqual(targetEnd, -1, `missing target step end: ${targetName}`);
  return `${withoutSource.slice(0, targetEnd)}\n${sourceBlock}${withoutSource.slice(targetEnd)}`;
}

function replaceWorkflowStepText(text, stepName, search, replacement) {
  const stepMarker = `      - name: ${stepName}`;
  const stepStart = text.indexOf(stepMarker);
  assert.notEqual(stepStart, -1, `missing step: ${stepName}`);
  const nextStepStart = text.indexOf('\n      - name:', stepStart + stepMarker.length);
  const stepEnd = nextStepStart === -1 ? text.length : nextStepStart;
  const stepBlock = text.slice(stepStart, stepEnd);
  assert.match(stepBlock, search, `missing step text in ${stepName}`);
  return `${text.slice(0, stepStart)}${stepBlock.replace(search, replacement)}${text.slice(stepEnd)}`;
}

function insertWorkflowStepBefore(text, stepName, stepText) {
  const stepMarker = `      - name: ${stepName}`;
  const stepStart = text.indexOf(stepMarker);
  assert.notEqual(stepStart, -1, `missing step: ${stepName}`);
  return `${text.slice(0, stepStart)}${stepText}\n${text.slice(stepStart)}`;
}

function manifestsById() {
  return new Map(validator.projectManifests().map((manifest) => [manifest.id, manifest]));
}

function manifestOutput(manifest, outputPath) {
  return (manifest.outputs || []).find((output) => output.output === outputPath);
}

function contractBlock(text) {
  const begin = contractBegin;
  const end = contractEnd;
  const beginMatches = text.match(new RegExp(begin, 'g')) || [];
  const endMatches = text.match(new RegExp(end, 'g')) || [];
  assert.equal(beginMatches.length, 1, 'begin marker count');
  assert.equal(endMatches.length, 1, 'end marker count');
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  assert.ok(start < finish, 'contract markers are ordered');
  return text.slice(start + begin.length, finish).trim();
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
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', file), 'utf8')));
  }
});

test('advanced Codex and Claude plugin manifests stay out of the simple install PR', () => {
  for (const relPath of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, relPath);
  }
});

test('skill discovery includes migrated skills', () => {
  const skills = validator.skillDirs();
  assert.ok(skills.includes('skills/context-preserving-ai-publisher'));
  assert.ok(skills.includes('skills/ai-coding-agent-rules'));
  assert.ok(skills.includes('skills/ui-ux-secure-frontend-design'));
  assert.ok(skills.includes('skills/windows-localhost-workflows'));
  assert.ok(skills.includes('skills/n8n-workflow-helper-scripts'));
  assert.ok(skills.includes('skills/n8n-workflow-templates'));
  assert.ok(skills.includes('skills/n8n-local-setup'));
  assert.ok(skills.includes('skills/secure-cicd-installer'));
  assert.ok(skills.includes('skills/knowledge-index-updater'));

  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', 'skills.registry.json'), 'utf8'));
  const registryPaths = registry.map((entry) => entry.path.replace(/\/$/, ''));
  for (const skill of skills) {
    assert.ok(registryPaths.includes(skill), `${skill} missing from skills registry`);
  }
});

test('skill registry metadata describes the repo-local agent rules bootstrap skill', () => {
  const expectedPurpose = 'Bootstrap, check, and repair repo-local AI coding agent instruction files and platform shims for Codex, Claude Code, Antigravity, and compatible agents.';
  const expectedTriggers = [
    'repo-local agent rules',
    'bootstrap repo-local instructions',
    'repair AGENTS.md',
    'AI-AGENT-TOOLKIT managed markers'
  ];

  for (const relPath of [
    '_projects/repo-methodology/mcp-ready-registry/_main/registry/skills.registry.json',
    'mcp/registry/skills.registry.json'
  ]) {
    const registry = readJsonFile(path.join(repoRoot, relPath));
    const skill = registry.find((entry) => entry.id === 'ai-coding-agent-rules');
    assert.ok(skill, `${relPath}: ai-coding-agent-rules registry entry`);
    assert.equal(skill.purpose, expectedPurpose, relPath);
    assert.doesNotMatch(skill.purpose, /Slim generic execution-first/i, relPath);
    for (const trigger of expectedTriggers) {
      assert.ok(skill.auto_use_triggers.includes(trigger), `${relPath}: ${trigger}`);
    }
  }
});

test('project registry includes the project modules', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', 'projects.registry.json'), 'utf8'));
  const ids = registry.map((entry) => entry.id).sort();
  assert.deepEqual(ids, [
    'cicd.secure-installer',
    'design.ui-ux-pro-max',
    'development.ai-coding-agent-rules',
    'development.windows-localhost-workflows',
    'knowledge.knowledge-index-updater',
    'n8n.local-setup',
    'n8n.workflow-toolkit',
    'repo-methodology.context-preserving-ai-publisher',
    'repo-methodology.mcp-ready-registry'
  ]);
  for (const entry of registry) {
    assert.ok(entry.project?.summary, entry.id);
    assert.ok(['skill', 'mcp', 'both', 'source_only'].includes(entry.surface?.publish_as), entry.id);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/, entry.id);
    assert.equal(entry.version_policy, 'semver', entry.id);
    assert.ok(entry.version_notes, entry.id);
    assert.doesNotMatch(JSON.stringify(entry.root_surfaces), /(^|[^A-Za-z0-9_])for_ai\//);
  }
});

test('project manifests require toolkit project version metadata', () => {
  for (const manifest of validator.projectManifests()) {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/, manifest.id);
    assert.equal(manifest.version_policy, 'semver', manifest.id);
    assert.equal(typeof manifest.version_notes, 'string', manifest.id);
    assert.notEqual(manifest.version_notes.trim(), '', manifest.id);
  }
});

test('project manifest validation rejects missing version', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  delete manifest.version;
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing version/);
});

test('project manifest validation rejects invalid semver version', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  manifest.version = '1.0';
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version must be MAJOR\.MINOR\.PATCH/);
});

test('project manifest validation rejects invalid version policy', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  manifest.version_policy = 'calendar';
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version_policy must be semver/);
});

test('project manifest validation rejects empty version notes', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  manifest.version_notes = '   ';
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version_notes must be a non-empty string/);
});

test('project metadata supports all declared publish_as values', () => {
  for (const publishAs of ['skill', 'mcp', 'both', 'source_only']) {
    const cwd = tempCopy();
    const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
    const manifest = readJsonFile(manifestPath);
    manifest.surface.publish_as = publishAs;
    if (publishAs === 'source_only') {
      manifest.surface.skill = { status: 'not_applicable' };
      manifest.surface.mcp = { status: 'not_applicable' };
    }
    writeJsonFile(manifestPath, manifest);
    const result = spawnSync(process.execPath, [syncScript, '--write'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `${publishAs}\n${result.stderr}`);
  }
});

test('sync output declarations target skills and mcp, not legacy surfaces', () => {
  for (const manifest of validator.projectManifests()) {
    for (const output of manifest.outputs || []) {
      assert.match(output.output, /^(skills|mcp)\//, `${manifest.id}: ${output.output}`);
      assert.doesNotMatch(output.output, /(^|[^A-Za-z0-9_])for_ai\//);
    }
    for (const allowed of manifest.writes.allowed || []) {
      if (allowed === 'mcp/registry/projects.registry.json') continue;
      if (allowed.endsWith('/output/**')) continue;
      assert.match(allowed, /^(skills|mcp)\//, `${manifest.id}: ${allowed}`);
    }
  }
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

test('source-of-truth contract is synced into main entry points', () => {
  const partial = readTextFile(path.join(repoRoot, contractPartialPath)).trim();
  for (const rel of ['README.md', 'AGENTS.md']) {
    const text = readTextFile(path.join(repoRoot, rel));
    assert.equal(contractBlock(text), partial, rel);
  }
});

test('source-of-truth contract sync script passes and catches drift', () => {
  let result = spawnSync(process.execPath, [contractScript, '--check'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'README.md'),
    readTextFile(path.join(cwd, 'README.md')).replace('This repo has a source layer and a published layer.', 'This repo has a source layer and a changed published layer.')
  );
  result = spawnSync(process.execPath, [contractScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale source-of-truth contract block: README\.md/);
});

test('README is a user-facing map with the contract in the appendix', () => {
  const text = readTextFile(path.join(repoRoot, 'README.md'));
  const sections = [
    '## What this repo is',
    '## Quick Start',
    '## Projects',
    '## Skills',
    '## MCP',
    '## Folder Map',
    '## For Maintainers',
    '## Validation',
    '## Appendix: Source-of-Truth Contract'
  ];
  let previous = -1;
  for (const section of sections) {
    const index = text.indexOf(section);
    assert.notEqual(index, -1, section);
    assert.ok(index > previous, section);
    previous = index;
  }
  assert.ok(text.indexOf(contractBegin) > text.indexOf('## Appendix: Source-of-Truth Contract'));
  assert.match(text, /`skills\/<skill-name>\/`/);
  assert.match(text, /`mcp\/`/);
  const skillRegistry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', 'skills.registry.json'), 'utf8'));
  for (const entry of skillRegistry) {
    assert.ok(text.includes(`](${entry.path})`), `${entry.path} missing from README skills table`);
  }
  assert.doesNotMatch(text, /(^|[^A-Za-z0-9_])for_ai\//);
  for (const surface of ['packs', 'playbooks', 'templates', 'registries', 'registry', 'tools']) {
    assert.doesNotMatch(text, new RegExp(`\\|\\s+\`?${surface}/?\`?\\s+\\|`, 'i'));
  }
});

test('trusted maintenance scripts support an explicit workspace root', () => {
  const cwd = tempCopy();
  for (const script of [agentInstructionScript, contractScript, syncScript, validateScript]) {
    const args = [script, '--workspace', cwd];
    if (script !== validateScript) args.push('--check');
    const result = spawnSync(process.execPath, args, { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.basename(script)}\n${result.stderr}`);
  }
});

test('AGENTS.md gives future agents unambiguous source routing rules', () => {
  const text = readTextFile(path.join(repoRoot, 'AGENTS.md'));
  const mandatoryDocs = [
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/SOURCE-OF-TRUTH.md',
    'repo/docs/PROJECT-MODULE-STANDARD.md',
    'repo/docs/SURFACE-FIDELITY-AUDIT.md',
    'repo/docs/RETIRED-SOURCE-PROVENANCE.md',
    'repo/docs/THIRD-PARTY-SOURCE-NOTES.md',
    'repo/docs/WRITE-SAFETY-MODEL.md',
    'repo/docs/SAFE-UPDATES.md',
    'repo/docs/CLEANUP-POLICY.md',
    'repo/docs/HOW-TO-USE.md'
  ];

  assert.match(text, /curated_output_for_ai/);
  assert.match(text, /toolkit\.project\.json/);
  assert.match(text, /Do not edit generated `skills\/` or `mcp\/` outputs directly/);
  assert.match(text, /Do not generate curated files automatically from `_main`/);
  assert.match(text, /AI-AGENT-TOOLKIT:_projects\/development\/ai-coding-agent-rules\/_main\/_partials\/ai-coding-agent-execution\.md:BEGIN GLOBAL-AGENTS\.MD-TEMPLATE v1/);
  assert.match(text, /AI-AGENT-TOOLKIT:_projects\/development\/ai-coding-agent-rules\/_main\/_partials\/n8n-agent-rules-adapter\.md:BEGIN N8N-AGENT-RULES-ADAPTER v1/);
  assert.match(text, /## Managed Marker Rules/);
  assert.match(text, /AI-AGENT-TOOLKIT:<source-path>:BEGIN <BLOCK-NAME> v1/);
  assert.match(text, /## Role/);
  assert.match(text, /You are an execution-first coding agent\./);
  assert.match(text, /## Scope Control/);
  assert.match(text, /stop and load `skills\/n8n-agent-rules` before planning or editing/);
  assert.match(text, /skill or its full rules are unavailable, stop and report the limitation instead of continuing/);
  assert.match(text, /Do not run live n8n, Docker, import\/export, sync, activation, execution, publish\/unpublish, credential, deployment, or production actions without explicit current-turn approval naming the target and allowed operation/);
  assert.doesNotMatch(text, /GitHub PR Completion Rules/);
  assert.doesNotMatch(text, /GITHUB APPROVAL NEEDED/);
  assert.doesNotMatch(text, /VERSION CONTROL APPROVAL NEEDED/);
  assert.doesNotMatch(text, /REMOTE APPROVAL NEEDED/);
  assert.doesNotMatch(text, /LOCAL CHANGE APPROVAL NEEDED/);
  assert.doesNotMatch(text, /PR: none yet/);
  assert.doesNotMatch(text, /If no PR exists yet, state `PR: none yet`/);
  assert.doesNotMatch(text, /PR lane/);
  assert.doesNotMatch(text, /remote source-of-truth/);
  assert.doesNotMatch(text, /Should I push this branch/);
  for (const doc of mandatoryDocs) {
    assert.ok(text.includes(`](${doc})`), `AGENTS.md links ${doc}`);
  }
  assert.match(
    text,
    /For new or changed project modules, `repo\/docs\/PROJECT-MODULE-STANDARD\.md` is the detailed rulebook\./
  );
});

test('managed toolkit source excludes GitHub PR and VCS approval prompt rules', () => {
  const relPaths = [
    'AGENTS.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
  ];

  for (const relPath of relPaths) {
    const text = readTextFile(path.join(repoRoot, relPath));
    assert.match(text, /You are an execution-first coding agent\./, `${relPath} keeps reusable execution prompt`);
    assert.match(text, /## Scope Control/, `${relPath} keeps generic execution guidance`);
    assert.match(text, /run the smallest relevant local validation/i, `${relPath} keeps targeted local validation guidance`);
    assert.match(text, /Do not run local `npm run validate:all` by default when CI already runs the full gate/, `${relPath} avoids default local full validation`);
    assert.match(text, /failed targeted validation/, `${relPath} blocks failed targeted validation before push`);
    assert.doesNotMatch(text, /run relevant validation/, `${relPath} removes broad validation wording`);
    assert.doesNotMatch(text, /failed validation, or safety-blocked changes/, `${relPath} uses targeted validation wording`);
    assert.doesNotMatch(text, /GitHub PR Completion Rules/, `${relPath} removes GitHub PR completion rules`);
    assert.doesNotMatch(text, /GITHUB APPROVAL NEEDED/, `${relPath} removes GitHub approval prompts`);
    assert.doesNotMatch(text, /VERSION CONTROL APPROVAL NEEDED/, `${relPath} removes VCS approval prompts`);
    assert.doesNotMatch(text, /REMOTE APPROVAL NEEDED/, `${relPath} removes remote approval prompts`);
    assert.doesNotMatch(text, /LOCAL CHANGE APPROVAL NEEDED/, `${relPath} removes local-change approval prompts`);
    assert.doesNotMatch(text, /PR: none yet/, `${relPath} removes stale no-PR completion guidance`);
    assert.doesNotMatch(text, /PR lane/, `${relPath} removes PR lane management`);
    assert.doesNotMatch(text, /remote source-of-truth/, `${relPath} removes PR URL source-of-truth rules`);
    assert.doesNotMatch(text, /create a pull request|update a pull request|merge request/i, `${relPath} removes remote review workflow rules`);
  }

  for (const relPath of [
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, relPath);
  }
});

test('Git Completion includes pull-request description synchronization guidance', () => {
  const relPaths = [
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md'
  ];

  for (const relPath of relPaths) {
    const text = readTextFile(path.join(repoRoot, relPath));
    assert.match(text, /## Git Completion/, relPath);
    assert.doesNotMatch(text, /## Pull Request Description/, relPath);
    assert.match(text, /Git Completion is the explicit scoped exception to the Approval Rules for version-control publication after requested repo edits/i, relPath);
    assert.match(text, /Before pushing:\n\n- Run the smallest relevant local validation/i, relPath);
    assert.match(text, /Do not run local `npm run validate:all` by default when CI already runs the full gate/i, relPath);
    assert.match(text, /run local full validation only for broad\/risky, workflow, sync, generator, package, security-sensitive changes, known CI failure reproduction/i, relPath);
    assert.match(text, /When opening or updating a pull request:\n\n- Keep the PR body aligned with the full base-to-head diff/i, relPath);
    assert.match(text, /check PR CI\/status before reporting completion/i, relPath);
    assert.match(text, /After pushing:\n\n- Check PR CI\/status before reporting completion/i, relPath);
    assert.match(text, /If pending, say it is pending and not yet verified/i, relPath);
    assert.match(text, /If failed, inspect accessible logs/i, relPath);
    assert.match(text, /after two failed fix attempts, stop and report the blocker/i, relPath);
    assert.match(text, /Never:\n\n- Push to `main`, secrets, credentials, live\/runtime files, failed targeted validation, or safety-blocked changes/i, relPath);
    assert.match(text, /- Claim CI passed unless checked/i, relPath);
    assert.match(text, /- Hide failing, pending, or inaccessible CI/i, relPath);
    assert.match(text, /full base-to-head diff/i, relPath);
    assert.match(text, /keep the PR body aligned with the full base-to-head diff/i, relPath);
    assert.match(text, /If you cannot update it directly, provide exact replacement PR body text/i, relPath);
  }
});

test('Project Module Standard documents the playbook boundary', () => {
  const text = readTextFile(path.join(repoRoot, 'repo', 'docs', 'PROJECT-MODULE-STANDARD.md'));
  assert.match(text, /## Playbook Boundary/);
  assert.match(text, /Do not use `playbooks\/` as a default home for full working instructions\./);
  assert.match(text, /A playbook may exist only when it is a short reviewed operating overview, routing guide, or safety wrapper\./);
  assert.match(text, /publish it from `_projects\/\*\*\/_main\/\*\*` using exact `copy`, `extract`, or `concat`/);
});

test('curated playbook recipes are not full runtime skill references', () => {
  const offenders = [];
  for (const manifest of manifestsById().values()) {
    for (const output of manifest.outputs || []) {
      const sources = output.sources || [output.source].filter(Boolean);
      const usesPlaybookSource = sources.some((source) => source.includes('curated_output_for_ai/playbooks/'));
      const publishesRuntimeSkillSurface = /^skills\/[^/]+\/(references|templates)\//.test(output.output || '');
      if (!usesPlaybookSource || !publishesRuntimeSkillSurface) continue;

      const label = `${output.notes || ''} ${output.fidelity || ''}`;
      const explicitlyAllowed = /\b(overview|safety wrapper|routing guide)\b/i.test(label) && output.fidelity !== 'exact';
      if (!explicitlyAllowed) offenders.push(`${manifest.id}: ${output.output}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('validation workflow runs canonical full validation read-only', () => {
  const workflow = readTextFile(path.join(repoRoot, '.github', 'workflows', 'validate.yml'));
  const expectedCommands = [
    'node repo/scripts/sync-repo-doc-contract.cjs --check',
    'node repo/scripts/sync-toolkit-projects.cjs --check',
    'node repo/scripts/audit-project-source-locks.cjs',
    'node repo/scripts/audit-published-surfaces.cjs --check',
    'node repo/scripts/validate-toolkit.cjs',
    'node --test repo/tests/*.test.cjs',
    'node repo/scripts/package-skills.cjs --check',
    'node repo/scripts/audit-skill-portability.cjs',
    'node repo/scripts/package-packs.cjs --check',
    'node repo/scripts/run-design-tests.cjs',
    'git diff --check'
  ];
  assert.doesNotMatch(workflow, /^\s*run:\s+npm run validate:all\s*$/m);
  assert.doesNotMatch(workflow, /\bnpm\s+run\s+validate:all\b/);
  assert.match(workflow, /^\s*run:\s*\|\s*$/m);
  for (const command of expectedCommands) {
    assert.match(workflow, new RegExp(`^\\s*${escapeRegExp(command)}\\s*$`, 'm'), command);
  }
  assert.doesNotMatch(workflow, /sync-repo-doc-contract\.cjs --write/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test('validator rejects validation workflow that relies on npm validate script', () => {
  const cwd = tempCopy();
  const workflowPath = path.join(cwd, '.github', 'workflows', 'validate.yml');
  const workflow = readTextFile(workflowPath);
  fs.writeFileSync(
    workflowPath,
    workflow.replace(/run:\s*\|[\s\S]*$/m, 'run: npm run validate:all\n')
  );

  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /validate\.yml must use explicit validation commands instead of npm run validate:all/);
});

test('source-watch PR notifier uses the stable review-notification PR contract', () => {
  const workflow = readTextFile(path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml'));
  assert.match(workflow, /^name:\s*Source Watch PR Notifier\s*$/m);
  for (const cron of ['17 3 * * *', '43 9 * * *', '29 15 * * *']) {
    assert.ok(workflow.includes(`cron: "${cron}"`), cron);
  }
  assert.match(workflow, /^  contents: write$/m);
  assert.match(workflow, /^  pull-requests: write$/m);
  assert.doesNotMatch(workflow, /^  issues: write$/m);
  assert.match(workflow, /repo\/scripts\/check-project-source-updates\.cjs/);
  assert.match(workflow, /source-watch\/review-active-third-party-updates/);
  assert.match(workflow, /\[source-watch\] Review active third-party source updates/);
  assert.match(workflow, /This PR is a review notification only\./);
  assert.match(workflow, /No auto-merge is allowed\./);
  assert.equal(sourceWatchPrBodyText(workflow), [
    'This PR is a review notification only.',
    'No source files were updated.',
    'No SOURCE-LOCK pins were changed.',
    'No upstream code was executed.',
    'No auto-merge is allowed.',
    'A human must review upstream changes, attribution/licence impact, allowlist scope, and then ask an AI agent to inspect before any real edits happen.',
    '',
    '- [ ] Review upstream diff manually.',
    '- [ ] Confirm changed files are within allowlist.',
    '- [ ] Confirm attribution/licence notes still apply.',
    '- [ ] Confirm no upstream code was executed.',
    '- [ ] Decide whether a separate update PR should copy/adapt files.',
    '- [ ] Run npm run validate:all before any real source update merge.'
  ].join('\n'));
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /git remote set-url origin "https:\/\/x-access-token:\$\{GH_TOKEN\}@github\.com\/\$\{GITHUB_REPOSITORY\}\.git"/);
  assert.match(workflow, /git push --force-with-lease="refs\/heads\/\$BRANCH:\$remote_sha" origin "HEAD:\$BRANCH"/);
  assert.doesNotMatch(workflow, /git push origin (?:HEAD:)?main\b/i);
  assert.doesNotMatch(workflow, /git\s+push[^\n]*(?:--force(?!-with-lease)|-f\b)/i);
  assert.doesNotMatch(workflow, /git\s+add[^\n]*(?:_projects|SOURCE-LOCK\.json)/i);
  assert.doesNotMatch(workflow, /gh issue create|safe-source-update\.cjs|gh pr merge|--auto/i);
});

test('validator rejects source-watch PR notifier issue permission', () => {
  const cwd = tempCopy();
  const workflowPath = path.join(cwd, '.github', 'workflows', 'source-watch-pr.yml');
  const workflow = readTextFile(workflowPath);
  fs.writeFileSync(workflowPath, workflow.replace('  pull-requests: write\n', '  pull-requests: write\n  issues: write\n'));

  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch-pr\.yml must grant only contents: write and pull-requests: write/);
});

test('validator rejects source-watch PR notifier issue permission with inline comment', () => {
  const cwd = tempCopy();
  const workflowPath = path.join(cwd, '.github', 'workflows', 'source-watch-pr.yml');
  const workflow = readTextFile(workflowPath);
  fs.writeFileSync(workflowPath, workflow.replace('  pull-requests: write\n', '  pull-requests: write\n  issues: write # not actually harmless\n'));

  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch-pr\.yml must grant only contents: write and pull-requests: write/);
});

test('validator accepts expected workflow permissions with inline comments', () => {
  const cwd = tempCopy();
  const workflowPath = path.join(cwd, '.github', 'workflows', 'source-watch-pr.yml');
  const workflow = readTextFile(workflowPath)
    .replace('  contents: write\n', '  contents: write # needed to update the stable notification branch\n')
    .replace('  pull-requests: write\n', '  pull-requests: write # needed to create or update the stable notification PR\n');
  fs.writeFileSync(workflowPath, workflow);

  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('source-watch advisory plan is manual-only', () => {
  const workflow = readTextFile(path.join(repoRoot, '.github', 'workflows', 'source-watch-plan.yml'));
  assert.match(workflow, /^name:\s*Source Watch Advisory Plan\s*$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}schedule:\s*$/m);
});

test('source-watch PR-notification-only rule is durable and synced', () => {
  for (const relPath of [
    contractPartialPath,
    'AGENTS.md',
    'README.md',
    '_projects/repo-methodology/context-preserving-ai-publisher/_main/templates/repo-docs/project-module-standard.template.md',
    'skills/context-preserving-ai-publisher/templates/repo-docs/project-module-standard.template.md'
  ]) {
    const text = readTextFile(path.join(repoRoot, relPath));
    assert.ok(text.includes(sourceWatchPrNotificationRule), relPath);
  }
});

test('source-watch PR notifier is the only scheduled source-watch workflow', () => {
  const workflowDir = path.join(repoRoot, '.github', 'workflows');
  const workflowFiles = fs.readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => `.github/workflows/${name}`);
  const scheduledSourceWatch = workflowFiles.filter((relPath) => {
    const text = readTextFile(path.join(repoRoot, relPath));
    return /source[- ]watch/i.test(`${relPath}\n${text}`) && /^\s{2}schedule:\s*$/m.test(text);
  });

  assert.deepEqual(scheduledSourceWatch, ['.github/workflows/source-watch-pr.yml']);
  assert.equal(fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'safe-source-update.yml')), false);
});

test('auto-sync workflow owns agent instruction shim freshness', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'build-agent-rule-templates.yml')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'scripts', 'agent-rule-template-specs.json')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'scripts', 'build-agent-rule-templates.ps1')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'scripts', '_build-agent-rule-templates.cmd')), false);

  const workflow = readTextFile(path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'));
  for (const rel of [
    '_projects/development/ai-coding-agent-rules/_main/_partials/**'
  ]) {
    assert.match(workflow, new RegExp(`- "${escapeRegExp(rel)}"`), rel);
  }
  for (const command of [
    'node "$TRUSTED_ROOT/repo/scripts/sync-agent-instruction-shims.cjs" --workspace "$PR_ROOT" --write',
    'node "$TRUSTED_ROOT/repo/scripts/sync-agent-instruction-shims.cjs" --workspace "$PR_ROOT" --check',
    'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write',
    'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --check'
  ]) {
    assert.match(workflow, new RegExp(escapeRegExp(command)), command);
  }
  assert.doesNotMatch(workflow, /agent-rule-template-specs|build-agent-rule-templates/);
});

test('auto-sync generated surfaces workflow is accepted by validation', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /auto-sync-generated-surfaces\.yml/.test(error)).length, 0, errors.join('\n'));
});

test('validator rejects contents write outside the auto-sync generated surfaces workflow', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, '.github', 'workflows', 'unsafe-write.yml'),
    [
      'name: Unsafe write',
      'on:',
      '  pull_request:',
      'permissions:',
      '  contents: write',
      'jobs:',
      '  unsafe:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo unsafe'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe-write\.yml uses contents: write/);
});

test('validator rejects git push outside the auto-sync generated surfaces workflow', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, '.github', 'workflows', 'unsafe-push.yml'),
    [
      'name: Unsafe push',
      'on:',
      '  pull_request:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  unsafe:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: git push origin HEAD:branch'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe-push\.yml contains forbidden commit\/push behavior/);
});

test('auto-sync generated surfaces workflow rejects forbidden events and missing guards', () => {
  const generatedScopePrefix = 'README.md|skills/*|mcp/*|';
  const cases = [
    ['pull_request is forbidden', (text) => text.replace('pull_request_target:', 'pull_request:'), /must use pull_request_target/],
    ['push is forbidden', (text) => text.replace('pull_request_target:', 'push:\n  pull_request_target:'), /must not trigger on push/],
    ['schedule is forbidden', (text) => text.replace('pull_request_target:', 'schedule:\n  pull_request_target:'), /must not trigger on schedule/],
    ['workflow_run is forbidden', (text) => text.replace('pull_request_target:', 'workflow_run:\n  pull_request_target:'), /must not trigger on workflow_run/],
    ['extra permissions are forbidden', (text) => text.replace('  pull-requests: read', '  pull-requests: read\n  issues: write'), /must grant only contents: write and pull-requests: read/],
    ['same-repo guard is required', (text) => text.replaceAll('github.event.pull_request.head.repo.full_name == github.repository', 'true'), /missing same-repo PR guard/],
    ['head main guard is required', (text) => text.replaceAll("github.event.pull_request.head.ref != 'main'", 'true'), /missing head\.ref != main guard/],
    ['oversized PR file-list guard is required', (text) => text.replace('if (( changed_file_count > 3000 )); then', 'if false; then'), /preflight must reject PRs with more than 3000 changed files/],
    ['post-sync changed-path validation is required', (text) => text.replaceAll('Forbidden post-sync change outside generated output scope', 'Removed post-sync guard'), /missing post-sync changed-path validation/],
    ['_projects wildcard output scope stays rejected', (text) => text.replaceAll(generatedScopePrefix, `${generatedScopePrefix}_projects/*|`), /must not allow broad generated output paths/],
    ['repo output scope stays rejected', (text) => text.replaceAll(generatedScopePrefix, `${generatedScopePrefix}repo/*|`), /must not allow broad generated output paths/],
    ['.github output scope stays rejected', (text) => text.replaceAll(generatedScopePrefix, `${generatedScopePrefix}.github/*|`), /must not allow broad generated output paths/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow rejects forbidden commands and broad commit scopes', () => {
  const cases = [
    ['workflow_dispatch is forbidden', (text) => text.replace('pull_request_target:', 'workflow_dispatch:\n  pull_request_target:'), /must not trigger on workflow_dispatch/],
    ['source-watch script is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write', 'node "$TRUSTED_ROOT/repo/scripts/watch-project-sources.cjs" --workspace "$PR_ROOT"'), new RegExp('must not run source-watch or source-update ' + 'scripts')],
    ['live n8n export is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write', 'scr' + 'ipts/export-n8n-workflows-live.ps1'), /must not run live n8n import\/export/],
    ['git add scope is fixed', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" add README.md skills mcp', '/usr/bin/git -C "$PR_ROOT" add README.md skills mcp repo'), /must commit only approved generated output paths/],
    ['git add must not stage AGENTS.md', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" add README.md skills mcp', '/usr/bin/git -C "$PR_ROOT" add README.md AGENTS.md skills mcp'), /must commit only approved generated output paths|must not stage active root AI instruction files/],
    ['git add must not stage Claude shim', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" add README.md skills mcp', '/usr/bin/git -C "$PR_ROOT" add README.md CLAUDE.md skills mcp'), /must commit only approved generated output paths|must not stage active root AI instruction files/],
    ['commit bypasses hooks', (text) => text.replace('commit --no-verify -m', 'commit -m'), /must use git commit --no-verify/],
    ['final push resets remote', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" remote set-url origin', 'echo remote'), /must set push remote with the GitHub token only in the final push step/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow runs trusted scripts against the PR workspace', () => {
  const cases = [
    ['direct default-workspace script execution is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write', 'node repo/scripts/sync-repo-doc-contract.cjs --workspace "$PR_ROOT" --write'), /must not execute maintenance scripts from the default or PR workspace/],
    ['PR workspace script execution is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write', 'node "$PR_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write'), /must not execute maintenance scripts from the PR workspace/],
    ['trusted checkout is required', (text) => text.replace('      - name: Checkout trusted base revision', '      - name: Removed trusted checkout'), /must check out trusted base and PR workspaces only after preflight/],
    ['trusted checkout must use base SHA', (text) => text.replace('ref: ${{ github.event.pull_request.base.sha }}', 'ref: ${{ github.event.pull_request.base.ref }}'), /must check out the trusted base SHA to trusted\//],
    ['PR checkout path is required', (text) => text.replace('path: pr', 'path: pull-request'), /must check out the guarded PR head SHA to pr\//],
    ['sync scripts require explicit PR workspace', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write', 'node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --write'), /must run trusted maintenance scripts with --workspace "\$PR_ROOT"/],
    ['static checks require explicit PR workspace', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --check', 'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --check'), /must run trusted maintenance scripts with --workspace "\$PR_ROOT"/],
    ['git commands must target PR checkout', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --name-only', 'git diff --name-only'), /git commands must explicitly target the PR workspace/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow pins and rechecks the guarded PR head SHA', () => {
  const cases = [
    ['missing HEAD_SHA env is rejected', (text) => text.replace('      HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n', ''), /missing guarded PR head SHA environment variable/],
    ['PR checkout using head.ref is rejected', (text) => text.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.event.pull_request.head.ref }}'), /must not check out the PR branch by mutable head\.ref/],
    ['PR checkout using head.sha is required', (text) => text.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.event.pull_request.head.repo.full_name }}'), /must check out the guarded PR head SHA to pr\//],
    ['preflight current-head SHA query is required', (text) => text.replace('gh api "repos/${REPOSITORY_FULL_NAME}/pulls/${PR_NUMBER}" --jq \'.head.sha\'', 'echo "$HEAD_SHA"'), /preflight must verify the current PR head SHA from PR metadata/],
    ['preflight stale-run rejection is required', (text) => text.replace('if [[ "$current_head_sha" != "$HEAD_SHA" ]]; then', 'if false; then'), /preflight must reject stale runs when the PR head SHA changed/],
    ['preflight stale-run rejection must happen before optional skip', (text) => {
      const start = text.indexOf('          current_head_sha="$(');
      const end = text.indexOf('          for path in "${changed_files[@]}"; do', start);
      assert.notEqual(start, -1);
      assert.notEqual(end, -1);
      const currentHeadBlock = text.slice(start, end);
      return `${text.slice(0, start)}${text.slice(end).replace('          eligible=false', `${currentHeadBlock}          eligible=false`)}`;
    }, /preflight must reject stale PR heads before optional auto-sync skips/],
    ['post-checkout rev-parse verification is required', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" rev-parse HEAD', 'echo "$HEAD_SHA"'), /must verify the checked-out PR commit matches HEAD_SHA/],
    ['post-checkout verification must run before sync', (text) => moveWorkflowStepAfter(text, 'Verify checked-out PR commit', 'Sync deterministic generated surfaces'), /must verify the checked-out PR commit before running sync/],
    ['final remote branch SHA check is required before push', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" ls-remote origin "refs/heads/${HEAD_REF}"', 'echo "$HEAD_SHA"'), /final push must verify the PR branch still points to HEAD_SHA before pushing/],
    ['force push is rejected', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" push origin "HEAD:${HEAD_REF}"', '/usr/bin/git -C "$PR_ROOT" push --force origin "HEAD:${HEAD_REF}"'), /must not force push generated output/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow keeps static checks narrow', () => {
  const cases = [
    ['full validator against PR workspace is forbidden', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --cached --check', 'node "$TRUSTED_ROOT/repo/scripts/validate-toolkit.cjs" --workspace "$PR_ROOT"\n          /usr/bin/git -C "$PR_ROOT" diff --cached --check'), /must not run full validation against the PR workspace/],
    ['validate-toolkit workspace invocation is forbidden', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --cached --check', 'node "$TRUSTED_ROOT/repo/scripts/validate-toolkit.cjs" --workspace "$PR_ROOT"\n          /usr/bin/git -C "$PR_ROOT" diff --cached --check'), /must not run full validation against the PR workspace/],
    ['extra static command is forbidden', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --check', '/usr/bin/git -C "$PR_ROOT" diff --check\n          echo extra'), /static generated surface checks must be limited to sync freshness and git diff checks/],
    ['missing sync contract check is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --check\n', ''), /static generated surface checks must be limited to sync freshness and git diff checks/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow rejects PR-controlled test execution', () => {
  const staticCheckAnchor = '/usr/bin/git -C "$PR_ROOT" diff --cached --check';
  const preflightAnchor = '          if [[ "$HEAD_REPO_FULL_NAME" != "$REPOSITORY_FULL_NAME" ]]; then';
  const cases = [
    ['validate:all is forbidden', (text) => text.replace(staticCheckAnchor, `npm run validate:all\n          ${staticCheckAnchor}`), /must not run npm run validate:all/],
    ['env-prefixed validate:all is forbidden', (text) => text.replace(preflightAnchor, `          GH_TOKEN=placeholder npm run validate:all\n${preflightAnchor}`), /must not run npm run validate:all/],
    ['path-prefixed validate:all is forbidden', (text) => text.replace(preflightAnchor, `          /usr/bin/npm run validate:all\n${preflightAnchor}`), /must not run npm run validate:all/],
    ['npm command is forbidden', (text) => text.replace(staticCheckAnchor, `npm ci\n          ${staticCheckAnchor}`), /must not run npm, pnpm, or yarn/],
    ['env-prefixed npm command is forbidden', (text) => text.replace(preflightAnchor, `          NODE_ENV=test npm ci\n${preflightAnchor}`), /must not run npm, pnpm, or yarn/],
    ['path-prefixed npm command is forbidden', (text) => text.replace(preflightAnchor, `          /usr/bin/npm ci\n${preflightAnchor}`), /must not run npm, pnpm, or yarn/],
    ['pnpm command is forbidden', (text) => text.replace(staticCheckAnchor, `pnpm test\n          ${staticCheckAnchor}`), /must not run npm, pnpm, or yarn/],
    ['yarn command is forbidden', (text) => text.replace(staticCheckAnchor, `yarn test\n          ${staticCheckAnchor}`), /must not run npm, pnpm, or yarn/],
    ['node test command is forbidden', (text) => text.replace(staticCheckAnchor, `node --test repo/tests/*.test.cjs\n          ${staticCheckAnchor}`), /must not run generated Node test suites/],
    ['python unit tests are forbidden', (text) => text.replace(staticCheckAnchor, 'python -m unittest discover -s skills/ui-ux-secure-frontend-design/tools/design-system-generator/' + 'tes' + `ts\n          ${staticCheckAnchor}`), new RegExp('must not run Python unit ' + 'tests')],
    ['generated tool tests are forbidden', (text) => text.replace(staticCheckAnchor, 'node skills/ui-ux-secure-frontend-design/tools/design-system-generator/' + 'tes' + `ts/run.js\n          ${staticCheckAnchor}`), new RegExp('must not run generated tool ' + 'tests')]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow keeps privileged preflight before checkout', () => {
  const cases = [
    ['checkout before preflight is forbidden', (text) => text.replace('      - name: Preflight guard', '      - name: Checkout PR head branch'), /must run preflight before any checkout/],
    ['persisted checkout credentials are forbidden', (text) => text.replace('persist-credentials: false', 'persist-credentials: true'), /must not use persisted checkout credentials/],
    ['base-sha git diff changed-file detection is forbidden', (text) => text.replace("gh api --paginate \\", 'git diff --name-only "$BASE_SHA" HEAD\n          gh api --paginate \\'), /must not compute PR changed files with git diff against the PR branch/],
    ['PR files API is required', (text) => text.replace('gh api --paginate \\', 'echo no api \\'), /must query PR changed files before checkout/],
    ['github token is not exposed to sync or validation', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write', 'GH_TOKEN="${{ github.token }}" node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write'), /must expose github.token only to preflight and final push steps/],
    ['should_sync gates checkout and writeback', (text) => text.replace("        if: steps.preflight.outputs.should_sync == 'true'\n        uses: actions/checkout@v6", '        uses: actions/checkout@v6'), /must skip checkout and writeback steps when preflight should_sync is false/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow requires exact privileged action references', () => {
  const cases = [
    [
      'trusted checkout v1 downgrade is rejected',
      (text) => replaceWorkflowStepText(text, 'Checkout trusted base revision', /uses: actions\/checkout@v6/, 'uses: actions/checkout@v1'),
      /Checkout trusted base revision must use actions\/checkout@v6/
    ],
    [
      'PR checkout v1 downgrade is rejected',
      (text) => replaceWorkflowStepText(text, 'Checkout PR head commit', /uses: actions\/checkout@v6/, 'uses: actions/checkout@v1'),
      /Checkout PR head commit must use actions\/checkout@v6/
    ],
    [
      'setup-node v1 downgrade is rejected',
      (text) => replaceWorkflowStepText(text, 'Set up Node.js', /uses: actions\/setup-node@v6/, 'uses: actions/setup-node@v1'),
      /Set up Node\.js must use actions\/setup-node@v6/
    ]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow rejects unexpected uses action steps', () => {
  const cases = [
    [
      'extra checkout v1 action after preflight is rejected',
      `      - name: Extra unsafe checkout
        if: steps.preflight.outputs.should_sync == 'true'
        uses: actions/checkout@v1`,
      /must allow only the reviewed uses action steps/
    ],
    [
      'extra checkout v6 action after preflight is rejected',
      `      - name: Extra duplicate checkout
        if: steps.preflight.outputs.should_sync == 'true'
        uses: actions/checkout@v6`,
      /must allow only the reviewed uses action steps/
    ],
    [
      'extra setup-node v1 action is rejected',
      `      - name: Extra setup node
        if: steps.preflight.outputs.should_sync == 'true'
        uses: actions/setup-node@v1`,
      /must allow only the reviewed uses action steps/
    ],
    [
      'unrelated uses action is rejected',
      `      - name: Extra unrelated action
        if: steps.preflight.outputs.should_sync == 'true'
        uses: actions/cache@v4`,
      /must allow only the reviewed uses action steps/
    ]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, stepText, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(
      path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'),
      `${insertWorkflowStepBefore(original, 'Checkout trusted base revision', stepText)}\n`
    );
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow snapshots and rechecks staged output before commit', () => {
  const cases = [
    ['final recheck is required after validation', (text) => text.replace('      - name: Final pre-commit workspace recheck', '      - name: Removed pre-commit workspace recheck'), /must recheck the workspace and staged index after validation and before commit/],
    ['post-sync staged index snapshot is required', (text) => text.replace('expected_index_tree="$(/usr/bin/git -C "$PR_ROOT" write-tree)"', 'expected_index_tree="$(/usr/bin/git -C "$PR_ROOT" rev-parse HEAD)"'), /must snapshot the staged index after the post-sync guard/],
    ['staged index tree comparison is required', (text) => text.replace('if [[ "$current_index_tree" != "${EXPECTED_INDEX_TREE}" ]]; then', 'if false; then'), /final recheck must compare the staged index tree snapshot/],
    ['commit step must not stage files', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" config user.name', '/usr/bin/git -C "$PR_ROOT" add README.md skills mcp\n          /usr/bin/git -C "$PR_ROOT" config user.name'), /commit step must not run git add/],
    ['final recheck rejects untracked files', (text) => text.replace('untracked_files="$(/usr/bin/git -C "$PR_ROOT" ls-files --others --exclude-standard)"', 'untracked_files=""'), /final recheck must reject untracked files before commit/],
    ['final recheck rejects unstaged tracked changes', (text) => text.replace('if ! /usr/bin/git -C "$PR_ROOT" diff --quiet; then', 'if false; then'), /final recheck must reject unstaged tracked changes before commit/],
    ['final recheck rejects staged paths outside generated outputs', (text) => replaceLast(text, '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md', '_projects/development/ai-coding-agent-rules/_main/AGENTS.md'), /final recheck must reject staged paths outside generated output scope/],
    ['commit step resets dangerous git environment', (text) => text.replace('unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_SSH_COMMAND', 'echo no reset'), /commit step must reset dangerous git environment state/],
    ['push step resets dangerous git environment', (text) => replaceLast(text, 'unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_SSH_COMMAND', 'echo no reset'), /push step must reset dangerous git environment state/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow skips unsafe mixed preflight paths before writeback', () => {
  const cases = [
    ['repo docs skip is required', (text) => text.replace('repo/docs/*|', ''), /missing unsafe preflight fail handling for repo\/docs/],
    ['_main skip is required', (text) => text.replace('_projects/*/_main/*|', ''), /missing unsafe preflight fail handling for _projects\/\*\*\/_main/],
    ['.github skip is required', (text) => text.replace('.github/*|', ''), /missing unsafe preflight fail handling for \.github/],
    ['repo scripts skip is required', (text) => text.replace('repo/scripts/*|', ''), new RegExp('missing unsafe preflight fail handling for repo/' + 'scripts')],
    ['repo tests skip is required', (text) => text.replace('repo/tests/*|', ''), /missing unsafe preflight fail handling for repo\/tests/],
    ['lockfile skip is required', (text) => text.replace('package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|', ''), /missing unsafe preflight fail handling for package\/lockfile changes/],
    ['source-of-truth contract partial carve-out is required', (text) => text.replaceAll(contractPartialPath, '_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/other-contract.md'), /must allow source-of-truth contract partial changes as auto-sync eligible inputs/],
    ['agent-rule partial carve-out is required', (text) => text.replaceAll('_projects/development/ai-coding-agent-rules/_main/_partials/*', '_projects/blocked/_main/_partials/*'), /must allow agent-rule partial changes as auto-sync eligible inputs/],
    ['source-side agent-rule output carve-out is required', (text) => text.replaceAll('_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md', '_projects/development/ai-coding-agent-rules/_main/AGENTS.md'), /must allow generated source-side agent-rule templates in the guarded PR file set|missing generated source-side agent-rule template allowlist entry/],
    ['clear skip notice is required', (text) => text.replace('Auto-sync skipped: this PR touches source/maintenance paths that require manual generated-output commits. Normal Validate checks remain the merge gate.', 'Auto-sync did something else'), /preflight must skip unsafe mixed maintenance\/source PRs without writeback/],
    ['manual generated-output guidance is required', (text) => text.replace('Normal Validate checks remain the merge gate.', 'Generated outputs will be checked here.'), /preflight must skip unsafe mixed maintenance\/source PRs without writeback/],
    ['unsafe path branch must set should_sync false', (text) => text.replace('echo "should_sync=false" >> "$GITHUB_OUTPUT"', 'echo "should_sync=true" >> "$GITHUB_OUTPUT"'), /preflight must skip unsafe mixed maintenance\/source PRs without writeback/],
    ['unsafe path branch must exit successfully', (text) => text.replace('echo "should_sync=false" >> "$GITHUB_OUTPUT"\n                exit 0', 'echo "should_sync=false" >> "$GITHUB_OUTPUT"\n                exit 1'), /preflight must skip unsafe mixed maintenance\/source PRs without writeback/],
    ['unsafe path branch must not red-fail', (text) => text.replace('Auto-sync skipped: this PR touches source/maintenance paths that require manual generated-output commits', 'Auto-sync refused: this PR mixes generated-sync-eligible changes'), /preflight must skip unsafe mixed maintenance\/source PRs without writeback/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated output path scope is explicit', () => {
  for (const rel of [
    'README.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md',
    'mcp/registry/projects.registry.json',
    'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/README.md'
  ]) {
    assert.equal(validator.isAutoSyncGeneratedOutputPath(rel), true, rel);
  }

  for (const rel of [
    '_projects/foo/toolkit.project.json',
    '_projects/foo/curated_output_for_ai/file.md',
    '_projects/foo/_main/file.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md',
    '_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md',
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.agents/rules/00-agent-toolkit-bootstrap.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.with-toolkit-skills.template.md',
    'repo/' + 'scr' + 'ipts/anything.cjs',
    '.github/workflows/anything.yml',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.gitignore',
    '.gitattributes'
  ]) {
    assert.equal(validator.isAutoSyncGeneratedOutputPath(rel), false, rel);
  }
});

test('project modules use _projects/_main with no mandatory exports tree', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'projects')), false);

  for (const rel of [
    '_projects/n8n/local-setup',
    '_projects/n8n/workflow-toolkit',
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
  assert.match(
    attrs,
    /^_projects\/development\/ai-coding-agent-rules\/curated_output_for_ai\/skills\/ai-coding-agent-rules\/\*\*\/\*\.md text eol=lf$/m
  );
  assert.match(attrs, /^skills\/ai-coding-agent-rules\/\*\*\/\*\.md text eol=lf$/m);
  assert.doesNotMatch(attrs, /^projects\/\*\*\/main\/\*\* -text$/m);
});

test('design skill front matter and OpenAI metadata are approved', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /Design skill/.test(error)).length, 0, errors.join('\n'));
});

test('design skill keeps generator tooling inside the skill folder', () => {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(path.join(repoRoot, 'skills', 'ui-ux-secure-frontend-design'));
  assert.equal(files.some((file) => file.endsWith(path.join('tools', 'design-system-generator', 'scripts', 'design_system.py'))), true);
  assert.equal(files.some((file) => file.includes(`${path.sep}for_ai${path.sep}`)), false);
});

test('validator allows local-only Python design generator tooling under skill tools', () => {
  const cwd = tempCopy();
  const testFile = path.join(cwd, 'skills', 'ui-ux-secure-frontend-design', 'tools', 'design-system-generator', 'tests', 'extra_allowed.py');
  fs.writeFileSync(testFile, 'VALUE = 1\n');
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects network, shell, and package-install strings in design generator scripts', () => {
  const cwd = tempCopy();
  const scriptDir = path.join(cwd, 'skills', 'ui-ux-secure-frontend-design', 'tools', 'design-system-generator', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'core.py'), 'import requests\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Design generator script contains forbidden local-only token/);
});

test('generated agent-rule templates keep manual global and repo-local lanes separate', () => {
  const executionPrompt = readTextFile(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'ai-coding-agent-execution.md')).trimEnd();
  const n8nAdapter = readTextFile(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'n8n-agent-rules-adapter.md')).trimEnd();

  for (const rel of [
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'
  ]) {
    const text = readTextFile(path.join(repoRoot, rel));
    assert.equal(generatedNoticeCount(text), 1, rel);
    assert.equal(generatedPayload(text).trimEnd(), executionPrompt, rel);
    assert.match(text, /global rules example/i, rel);
    assert.match(text, /_partials\/ai-coding-agent-execution\.md/, rel);
    assert.doesNotMatch(text, /GitHub PR Completion Rules|GITHUB APPROVAL NEEDED|VERSION CONTROL APPROVAL NEEDED|REMOTE APPROVAL NEEDED|LOCAL CHANGE APPROVAL NEEDED|PR: none yet/i, rel);
  }

  const withSafetyComment = (payload) => `${curatedRepoLocalSafetyComment}\n\n${payload}`;
  const expectedPayloads = new Map([
    ['AGENTS.managed.template.md', withSafetyComment(managedRepoLocalPayload(executionPrompt, n8nAdapter))],
    ['CLAUDE.shim.template.md', withSafetyComment(readTextFile(path.join(repoRoot, 'CLAUDE.md')))],
    ['GEMINI.shim.template.md', withSafetyComment(readTextFile(path.join(repoRoot, 'GEMINI.md')))],
    ['antigravity-bootstrap.template.md', withSafetyComment(readTextFile(path.join(repoRoot, '.agents', 'rules', '00-agent-toolkit-bootstrap.md')))]
  ]);
  const manifest = readJsonFile(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', 'toolkit.project.json'));

  for (const [fileName, expected] of expectedPayloads) {
    const sourceRel = `_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/${fileName}`;
    const outputRel = `skills/ai-coding-agent-rules/repo-local/${fileName}`;
    for (const rel of [sourceRel, outputRel]) {
      const text = readTextFile(path.join(repoRoot, rel));
      assert.equal(text, expected, `${rel} is exactly the copy-ready destination payload`);
      assertBareRepoLocalTemplate(rel, text);
      assert.doesNotMatch(text, /Claude Code global rules example|Antigravity global rules example|Gemini\s+CLI and Antigravity global rules example|C:\\Users\\<your-user>\\\.(?:claude|gemini)|\$HOME\\\.(?:claude|gemini)/, rel);
      assert.doesNotMatch(text, /GitHub PR Completion Rules|GITHUB APPROVAL NEEDED|VERSION CONTROL APPROVAL NEEDED|REMOTE APPROVAL NEEDED|LOCAL CHANGE APPROVAL NEEDED|PR: none yet/i, rel);
    }

    const output = manifest.outputs.find((entry) => entry.output === outputRel);
    assert.equal(output?.notice, false, `${outputRel} suppresses generated notices because it is copied wholesale`);
  }

  const rootAgents = readTextFile(path.join(repoRoot, 'AGENTS.md'));
  const portableAgents = readTextFile(path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md'));
  assert.notEqual(rootAgents, portableAgents, 'root AGENTS.md is not the portable repo-local install source');
  assert.match(rootAgents, /This root `AGENTS\.md` is toolkit-repo-specific/, 'root AGENTS.md stays toolkit-specific');
  assert.match(rootAgents, /## Repo-Local Router/, 'root AGENTS.md keeps toolkit repo router');
  assert.doesNotMatch(portableAgents, /This root `AGENTS\.md` is toolkit-repo-specific|## Repo-Local Router/, 'portable AGENTS template has no toolkit repo wrapper');

  for (const rel of [
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, rel)), false, rel);
  }

  for (const rel of [
    '_projects/development/ai-coding-agent-rules/_main/TOOLKIT-SKILL-ROUTING.template.md',
    '_projects/development/ai-coding-agent-rules/_main/AGENTS.with-toolkit-skills.template.md',
    '_projects/development/ai-coding-agent-rules/_main/CLAUDE.with-toolkit-skills.template.md',
    '_projects/development/ai-coding-agent-rules/_main/GEMINI.with-toolkit-skills.template.md',
    'skills/ai-coding-agent-rules/TOOLKIT-SKILL-ROUTING.template.md',
    'skills/ai-coding-agent-rules/AGENTS.with-toolkit-skills.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.with-toolkit-skills.template.md',
    'skills/ai-coding-agent-rules/GEMINI.with-toolkit-skills.template.md'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, rel)), false, rel);
  }
});

test('generic agent-rule partials live in project _partials folders, not skill folders', () => {
  const skillPartialFiles = [];
  for (const skillDir of ['skills/ai-coding-agent-rules', 'skills/n8n-local-setup']) {
    const partialsDir = path.join(repoRoot, skillDir, '_partials');
    if (!fs.existsSync(partialsDir)) continue;
    for (const entry of fs.readdirSync(partialsDir, { recursive: true })) {
      if (fs.statSync(path.join(partialsDir, entry)).isFile()) skillPartialFiles.push(path.join(skillDir, '_partials', entry).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(skillPartialFiles, []);
  assert.equal(
    fs.existsSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'ai-coding-agent-execution.md')),
    true
  );
  assert.equal(
    fs.existsSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'n8n-agent-rules-adapter.md')),
    true
  );
  for (const removedPartial of [
    'agent-toolkit-managed-block.md',
    'agent-toolkit-n8n-adapter-block.md',
    'claude-shim.md',
    'gemini-shim.md',
    'antigravity-bootstrap.md'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', removedPartial)), false, removedPartial);
  }
  assert.equal(
    fs.existsSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'toolkit-skill-routing.md')),
    true
  );
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'templates', 'partials')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'repo-local')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'partials')), false);
});

test('validator rejects active agent instruction filenames inside skill folders', () => {
  const cwd = tempCopy();
  const activePath = path.join(cwd, 'skills', 'n8n-agent-rules', 'AGENTS.md');
  fs.writeFileSync(activePath, '# Active nested rules fixture\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Skill folder must use inert agent-rule template filenames: skills\/n8n-agent-rules\/AGENTS\.md/);
});

test('validator rejects unexpected Antigravity rule files', () => {
  const cwd = tempCopy();
  const extraRulePath = path.join(cwd, '.agents', 'rules', '99-evil.md');
  fs.writeFileSync(extraRulePath, '# Unexpected rule\n');

  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected \.agents\/rules entry: \.agents\/rules\/99-evil\.md/);
});

test('validator rejects broken relative links in non-_main Markdown files', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, 'mcp', 'projects', 'n8n-workflow-toolkit.md'), '\n[Missing local target](DOES-NOT-EXIST.md)\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mcp\/projects\/n8n-workflow-toolkit\.md links to missing path: mcp\/projects\/DOES-NOT-EXIST\.md/);
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

test('trusted agent instruction sync loads source templates from explicit workspace', () => {
  const cwd = tempCopy();
  const promptPath = path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'ai-coding-agent-execution.md');
  fs.appendFileSync(promptPath, '\n\nWorkspace-specific fixture.\n');

  const result = spawnSync(process.execPath, [agentInstructionScript, '--workspace', cwd, '--check'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale agent instruction source template: _projects\/development\/ai-coding-agent-rules\/_main\/AGENTS\.template\.md/);
  assert.doesNotMatch(result.stderr, /Stale generated output/);
});

test('trusted agent instruction sync rejects symlinked source templates before writing output', (t) => {
  const cwd = tempCopy();
  const promptPath = path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'ai-coding-agent-execution.md');
  const outputPath = path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'AGENTS.template.md');
  const originalOutput = fs.readFileSync(outputPath, 'utf8');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-sync-outside-'));
  const outsideFile = path.join(outsideDir, 'outside-agent-prompt.md');
  fs.writeFileSync(outsideFile, 'Outside prompt should not publish.\n');

  if (!createSymlinkOrSkip(t, outsideFile, promptPath, 'file')) return;

  const result = spawnSync(process.execPath, [agentInstructionScript, '--workspace', cwd, '--write'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe symlink/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), originalOutput);
});

test('changing assembled _main agent-rule templates makes source-side templates stale', () => {
  const cwd = tempCopy();
  const template = path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'AGENTS.template.md');
  fs.writeFileSync(
    template,
    readTextFile(template).replace(
      'AGENTS.template.md AI coding agent rules',
      'AGENTS.template.md drifted AI coding agent rules'
    )
  );
  const result = spawnSync(process.execPath, [agentInstructionScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale agent instruction source template: _projects\/development\/ai-coding-agent-rules\/_main\/AGENTS\.template\.md/);
});

test('changing published agent-rule template copies makes skill copies stale', () => {
  const cwd = tempCopy();
  const template = path.join(cwd, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md');
  fs.appendFileSync(template, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/ai-coding-agent-rules\/repo-local\/AGENTS\.managed\.template\.md/);
});

test('changing declared agent-rule source partials makes source-side templates stale', () => {
  const cases = [
    path.join('_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'ai-coding-agent-execution.md')
  ];

  for (const partialRel of cases) {
    const cwd = tempCopy();
    fs.appendFileSync(path.join(cwd, partialRel), '\n\n<!-- drift test -->\n');
    const result = spawnSync(process.execPath, [agentInstructionScript, '--check'], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0, partialRel);
    assert.match(result.stderr, /Stale agent instruction source template: _projects\/development\/ai-coding-agent-rules\/_main\/AGENTS\.template\.md/, partialRel);
  }
});

test('changing repo-local curated safety comment makes agent instruction templates stale', () => {
  const cwd = tempCopy();
  const template = path.join(
    cwd,
    '_projects',
    'development',
    'ai-coding-agent-rules',
    'curated_output_for_ai',
    'skills',
    'ai-coding-agent-rules',
    'repo-local',
    'GEMINI.shim.template.md'
  );
  fs.writeFileSync(
    template,
    readTextFile(template).replace(
      'Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
      'Avoid weakening credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.'
    )
  );

  const result = spawnSync(process.execPath, [agentInstructionScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must start with the exact curated-source safety comment/);
});

test('agent-rule source-template freshness check is scoped to declared modules', () => {
  const cwd = tempCopy();
  fs.rmSync(path.join(cwd, '_projects', 'n8n', 'local-setup'), { recursive: true, force: true });

  const result = spawnSync(process.execPath, [syncScript, '--write'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('agent instruction source-template freshness check does not depend on published outputs', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  const agentRuleOutputs = new Set([
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md'
  ]);

  manifest.outputs = manifest.outputs.filter((output) => !agentRuleOutputs.has(output.output));
  manifest.writes.allowed = manifest.writes.allowed.filter((output) => !agentRuleOutputs.has(output));
  writeJsonFile(manifestPath, manifest);

  fs.appendFileSync(
    path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'AGENTS.template.md'),
    '\n\n<!-- drift test -->\n'
  );
  const result = spawnSync(process.execPath, [agentInstructionScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale agent instruction source template: _projects\/development\/ai-coding-agent-rules\/_main\/AGENTS\.template\.md/);
});

test('changing canonical n8n agent rules source makes generated skill copies stale', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, '_projects', 'development', 'ai-coding-agent-rules', '_main', '_partials', 'n8n-agent-rules.md'), '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-agent-rules\/n8n-agent-rules\.md/);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n-agent-rules\.md/);
});

test('changing declared n8n local setup source makes generated local setup stale', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'Page 1 - Local Setup.md');
  fs.appendFileSync(source, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n\/local-setup\.md/);
});

test('sync applies text_rewrites to extract outputs', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'cicd', 'secure-installer', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  const outputPath = 'skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md';
  const output = manifest.outputs.find((entry) => entry.output === outputPath);
  assert.equal(output?.kind, 'extract');

  output.text_rewrites = [{ from: 'Manual step needed', to: 'Manual step required' }];
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/secure-cicd-installer\/templates\/cicd\/secure-cicd-prompt\.md/);
});

test('sync applies text_rewrites to concat outputs', () => {
  const cwd = tempCopy();
  const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  const outputPath = 'skills/n8n-local-setup/references/n8n/local-setup.md';
  const output = manifest.outputs.find((entry) => entry.output === outputPath);
  assert.equal(output?.kind, 'copy');
  assert.equal(output?.source, '_main/Page 1 - Local Setup.md');

  output.kind = 'concat';
  output.sources = [output.source];
  delete output.source;
  output.text_rewrites = [{ from: '# Page 1 - Local Setup', to: '# Page 1 - Local Setup Rewrite Fixture' }];
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n\/local-setup\.md/);
});

test('sync rejects text_rewrites on JSON outputs before checking generated bytes', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'local-setup');
  const manifestPath = path.join(projectDir, 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  fs.writeFileSync(path.join(projectDir, '_main', 'json-rewrite-regression.json'), '{ "active": false }\n');

  manifest.outputs.push({
    kind: 'json',
    source: '_main/json-rewrite-regression.json',
    output: 'mcp/projects/json-rewrite-regression.json',
    notes: 'Regression fixture for JSON text rewrite hardening.',
    fidelity: 'generated_metadata',
    text_rewrites: [{ from: '"active": false', to: '"active": true' }]
  });
  manifest.writes.allowed.push('mcp/projects/json-rewrite-regression.json');
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JSON outputs must not set text_rewrites/);
});

test('Secure CI/CD prompt preserves the full source prompt', () => {
  const manifests = manifestsById();
  const outputPath = 'skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md';
  const output = manifestOutput(manifests.get('cicd.secure-installer'), outputPath);
  assert.equal(output?.kind, 'extract', outputPath);
  assert.equal(output?.source, '_main/README.md', outputPath);
  assert.equal(output?.notice, false, outputPath);

  const prompt = readTextFile(path.join(repoRoot, outputPath));
  assert.equal(prompt, secureCicdPromptFromReadme());
  assert.match(prompt, /Manual step needed: \[Short title\]/);
  assert.match(prompt, /Phase 9: Commit, branch, pull request, and push policy\./);
  assert.match(prompt, /Do not commit, push, create a pull request, merge, or deploy without my approval\./);
});

test('Secure CI/CD prompt does not fetch n8n helpers from retired external main paths', () => {
  const prompt = readTextFile(path.join(repoRoot, 'skills', 'secure-cicd-installer', 'templates', 'cicd', 'secure-cicd-prompt.md'));
  assert.doesNotMatch(prompt, /ai-cicd-installer/i);
  assert.doesNotMatch(prompt, /raw\.githubusercontent\.com\/weijunswj\/ai-cicd-installer/i);
  assert.match(prompt, /skills\/n8n-workflow-helper-scripts\/templates\/helper-scripts\/import-export-sync\//);
});

test('changing Secure CI/CD prompt source makes generated prompt stale', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'cicd', 'secure-installer', '_main', 'README.md');
  const text = readTextFile(source);
  fs.writeFileSync(source, text.replace('Phase 10: Final output.', 'Phase 10: Final output drift test.'), 'utf8');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/secure-cicd-installer\/templates\/cicd\/secure-cicd-prompt\.md/);
});

test('internal AI-facing surfaces are generated from declared project output', () => {
  const manifests = manifestsById();
  const expectedMarkdown = [
    ['n8n.local-setup', 'skills/n8n-local-setup/SKILL.md', 'curated_output_for_ai/skills/n8n-local-setup/SKILL.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/README.md', 'curated_output_for_ai/skills/n8n-local-setup/README.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/mcp-configs/README.md', 'curated_output_for_ai/templates/mcp-configs/README.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-helper-scripts/SKILL.md', 'curated_output_for_ai/skills/n8n-workflow-helper-scripts/SKILL.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-helper-scripts/README.md', 'curated_output_for_ai/skills/n8n-workflow-helper-scripts/README.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-templates/SKILL.md', 'curated_output_for_ai/skills/n8n-workflow-templates/SKILL.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-templates/README.md', 'curated_output_for_ai/skills/n8n-workflow-templates/README.md'],
    ['n8n.workflow-toolkit', 'mcp/projects/n8n-workflow-toolkit.md', 'curated_output_for_ai/mcp/n8n-workflow-toolkit.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-helper-scripts/references/workflow-sync.md', 'curated_output_for_ai/references/workflow-sync.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/README.md', 'curated_output_for_ai/templates/helper-scripts/sanitizer/README.md'],
    ['n8n.workflow-toolkit', 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/README.md', 'curated_output_for_ai/templates/helper-scripts/import-export-sync/README.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/SKILL.md', 'curated_output_for_ai/skills/secure-cicd-installer/SKILL.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/README.md', 'curated_output_for_ai/skills/secure-cicd-installer/README.md'],
    ['cicd.secure-installer', 'mcp/projects/secure-cicd-installer.md', 'curated_output_for_ai/mcp/secure-cicd-installer.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/references/secure-cicd-installer.md', 'curated_output_for_ai/overviews/secure-cicd-installer.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/templates/cicd/README.md', 'curated_output_for_ai/templates/cicd/README.md'],
  ];
  const expectedExactCopies = [
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/local-setup.md', '_main/Page 1 - Local Setup.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/hostinger-vps.md', '_main/Page 2 - Hostinger VPS.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/codex.md', '_main/mcp setup - codex.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md', '_main/mcp setup - claude code.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md', '_main/mcp setup - opencode.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md', '_main/mcp setup - antigravity.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/local-stack/_n8n-local.cmd', '_main/templates/local-stack/_n8n-local.cmd'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/local-stack/n8n-local-desktop-shortcut.cmd', '_main/templates/local-stack/n8n-local-desktop-shortcut.cmd'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md', '_main/templates/mcp-configs/antigravity-mcp-config.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md', '_main/templates/mcp-configs/claude-mcp-config.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md', '_main/templates/mcp-configs/codex-mcp-config.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md', '_main/templates/mcp-configs/opencode-mcp-config.md'],
    ['knowledge.knowledge-index-updater', 'skills/knowledge-index-updater/README.md', '_main/skill/README.md'],
    ['knowledge.knowledge-index-updater', 'skills/knowledge-index-updater/SKILL.md', '_main/skill/SKILL.md'],
    ['knowledge.knowledge-index-updater', 'skills/knowledge-index-updater/agents/claude.md', '_main/skill/agents/claude.md'],
    ['knowledge.knowledge-index-updater', 'skills/knowledge-index-updater/agents/openai.yaml', '_main/skill/agents/openai.yaml'],
    ['development.windows-localhost-workflows', 'skills/windows-localhost-workflows/README.md', '_main/skill/README.md'],
    ['development.windows-localhost-workflows', 'skills/windows-localhost-workflows/SKILL.md', '_main/skill/SKILL.md'],
    ['development.windows-localhost-workflows', 'skills/windows-localhost-workflows/agents/openai.yaml', '_main/skill/agents/openai.yaml'],
    ['repo-methodology.context-preserving-ai-publisher', 'skills/context-preserving-ai-publisher/references/validation-strategy.md', '_main/validation-strategy.md']
  ];
  const expectedJson = [
    ['n8n.local-setup', 'skills/n8n-local-setup/packs/codex-n8n-local/pack.json', 'curated_output_for_ai/packs/codex-n8n-local/pack.json'],
    ['n8n.local-setup', 'skills/n8n-local-setup/packs/claude-code-n8n-local/pack.json', 'curated_output_for_ai/packs/claude-code-n8n-local/pack.json'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/packs/secure-cicd/pack.json', 'curated_output_for_ai/packs/secure-cicd/pack.json']
  ];

  for (const [projectId, outputPath, source] of expectedMarkdown) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'curated', outputPath);
    assert.equal(output?.source, source, outputPath);
  }
  for (const [projectId, outputPath, source] of expectedExactCopies) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'copy', outputPath);
    assert.equal(output?.source, source, outputPath);
  }
  for (const [projectId, outputPath, source] of expectedJson) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'json', outputPath);
    assert.equal(output?.source, source, outputPath);
  }

  for (const projectId of ['n8n.local-setup', 'n8n.workflow-toolkit', 'cicd.secure-installer']) {
    for (const output of manifests.get(projectId).outputs || []) {
      if (output.kind !== 'linked') continue;
      assert.match(output.notes || '', /(source-locked|Toolkit-only)/, output.output);
    }
  }
});

test('curated Markdown outputs carry curated-source notices', () => {
  for (const [outputPath, sourcePath] of [
    [
      'skills/n8n-local-setup/SKILL.md',
      '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/SKILL.md'
    ],
    [
      'skills/n8n-local-setup/README.md',
      '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md'
    ],
    [
      'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/README.md',
      '_projects/n8n/workflow-toolkit/curated_output_for_ai/templates/helper-scripts/import-export-sync/README.md'
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
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/README\.md/);
});

test('curated JSON pack outputs match deterministic source formatting', () => {
  for (const [sourcePath, outputPath] of [
    [
      '_projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/pack.json',
      'skills/n8n-local-setup/packs/codex-n8n-local/pack.json'
    ],
    [
      '_projects/cicd/secure-installer/curated_output_for_ai/packs/secure-cicd/pack.json',
      'skills/secure-cicd-installer/packs/secure-cicd/pack.json'
    ]
  ]) {
    const expected = `${JSON.stringify(readJsonFile(path.join(repoRoot, sourcePath)), null, 2)}\n`;
    assert.equal(fs.readFileSync(path.join(repoRoot, outputPath), 'utf8'), expected, outputPath);
  }
});

test('third-party UI UX project owns skill surfaces and leaves MCP linked', () => {
  const manifests = manifestsById();
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'curated_output_for_ai')), false);
  assert.equal(
    manifestOutput(manifests.get('design.ui-ux-pro-max'), 'mcp/projects/ui-ux-pro-max.md')?.kind,
    'linked',
    'mcp/projects/ui-ux-pro-max.md'
  );
  for (const [outputPath, sourcePath] of [
    ['skills/ui-ux-secure-frontend-design/SKILL.md', '_main/skill/SKILL.md'],
    ['skills/ui-ux-secure-frontend-design/README.md', '_main/skill/README.md'],
    ['skills/ui-ux-secure-frontend-design/agents/openai.yaml', '_main/skill/agents/openai.yaml'],
    ['skills/ui-ux-secure-frontend-design/references/project/ui-ux-pro-max.md', '_main/skill/references/project/ui-ux-pro-max.md'],
    ['skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md', '_main/skill/tools/design-system-generator/README.md'],
    ['skills/ui-ux-secure-frontend-design/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md', '_main/skill/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md'],
    ['skills/ui-ux-secure-frontend-design/packs/design-system-generator/pack.json', '_main/skill/packs/design-system-generator/pack.json'],
    ['skills/ui-ux-secure-frontend-design/packs/frontend-design-skill/pack.json', '_main/skill/packs/frontend-design-skill/pack.json']
  ]) {
    const output = manifestOutput(manifests.get('design.ui-ux-pro-max'), outputPath);
    assert.equal(output?.kind, 'copy', outputPath);
    assert.equal(output?.source, sourcePath, outputPath);
  }
  for (const outputPath of [
    'skills/ui-ux-secure-frontend-design/SKILL.md',
    'skills/ui-ux-secure-frontend-design/references/project/ui-ux-pro-max.md',
    'skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md',
    'skills/ui-ux-secure-frontend-design/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md'
  ]) {
    assert.match(fs.readFileSync(path.join(repoRoot, outputPath), 'utf8'), /Generated from toolkit project source/, outputPath);
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
  const lock = readJsonFile(path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json'));
  assert.equal(lock.source_lifecycle, 'retired_after_migration');
  assert.equal(lock.source_update_policy, 'none');
  assert.equal(lock.public_attribution_required, false);
  const copiedFile = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', '_main', 'helper-scripts', 'import-export-sync', 'should-import-n8n-workflow.cjs');
  fs.appendFileSync(copiedFile, '\nDrift test\n');
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact-copy drift/);
});

test('source-lock audit rejects toolkit-local source_path provenance rewrites', () => {
  for (const sourcePath of ['repo/scripts/example.cjs', '_projects/n8n/local-setup/_main/README.md']) {
    const cwd = tempCopy();
    const lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json');
    const lock = readJsonFile(lockPath);
    lock.files[0].source_path = sourcePath;
    writeJsonFile(lockPath, lock);

    const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0, sourcePath);
    assert.match(result.stderr, /source_path must stay upstream-provenance, not toolkit-local/);
  }

  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  lock.files[0].source_path = 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/README.md';
  writeJsonFile(lockPath, lock);

  const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root-surface source_path is allowed only for retired same-repo migrations/);
});

test('source-lock audit requires local paths to stay in their topology namespaces', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  lock.files[0].mode = 'adapted';
  lock.files[0].notes = 'Topology namespace regression test.';
  lock.files[0].project_path = 'skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/README.md';
  delete lock.files[0].source_blob_sha;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project_path must point under _projects\//);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  let rootSurfaceEntry = lock.files[0];
  rootSurfaceEntry.mode = 'adapted';
  rootSurfaceEntry.notes = 'Topology namespace regression test.';
  delete rootSurfaceEntry.project_path;
  rootSurfaceEntry.root_surface_path = 'repo/scripts/validate-toolkit.cjs';
  delete rootSurfaceEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root_surface_path must point under skills\/ or mcp\//);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json');
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
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-toolkit', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  rootSurfaceEntry = lock.files[0];
  rootSurfaceEntry.mode = 'adapted';
  rootSurfaceEntry.notes = 'Topology traversal regression test.';
  delete rootSurfaceEntry.project_path;
  rootSurfaceEntry.root_surface_path = 'skills/../repo/scripts/validate-toolkit.cjs';
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

test('source-lock audit rejects inconsistent lifecycle role policy combinations', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  lock.source_lifecycle = 'active';
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active source must use source_role third_party_attribution_source/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.source_update_policy = 'none';
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active source must use source_update_policy manual_review_required/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.source_lifecycle = 'retired_after_migration';
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /retired migration source must use source_update_policy none/);
});

test('active third-party source lock keeps upstream pins in SOURCE-LOCK', () => {
  const thirdParty = readJsonFile(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json'));
  assert.equal(thirdParty.source_repo, 'nextlevelbuilder/ui-ux-pro-max-skill');
  assert.equal(thirdParty.source_ref, 'main');
  assert.match(thirdParty.source_commit, /^[0-9a-f]{40}$/);
  assert.equal(thirdParty.source_update_policy, 'manual_review_required');
  assert.equal(thirdParty.public_attribution_required, true);
  assert.ok(thirdParty.files.some((file) => file.mode === 'exact' && file.source_blob_sha));
  assert.ok(thirdParty.files.some((file) => file.mode === 'adapted' && file.source_blob_sha && file.notes));

  const manifest = readJsonFile(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'toolkit.project.json'));
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.version_policy, 'semver');
  assert.doesNotMatch(JSON.stringify(manifest), /source_commit|source_blob_sha/);
});

test('active third-party source lock rejects missing or non-SHA source commit', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  delete lock.source_commit;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing source_commit/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.source_commit = 'main';
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active third-party source_commit must be a 40-character SHA/);
});

test('active third-party source lock rejects disabled public attribution', () => {
  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  lock.public_attribution_required = false;
  writeJsonFile(lockPath, lock);
  const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /third-party attribution source must set public_attribution_required true/);
});

test('active third-party exact and adapted copied files require source blob pins', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  const exactEntry = lock.files.find((file) => file.mode === 'exact');
  delete exactEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact entry missing source_blob_sha/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  const adaptedEntry = lock.files.find((file) => file.mode === 'adapted');
  delete adaptedEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /adapted entry missing source_blob_sha/);
});

test('active third-party adapted copied files require notes', () => {
  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  const adaptedEntry = lock.files.find((file) => file.mode === 'adapted');
  adaptedEntry.notes = '';
  writeJsonFile(lockPath, lock);
  const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /adapted entry needs notes/);
});

test('retired internal source locks remain historical provenance without active third-party rules', () => {
  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  lock.source_commit = 'retired-source-marker';
  writeJsonFile(lockPath, lock);
  const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
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
  const registry = readJsonFile(path.join(repoRoot, 'mcp', 'registry', 'source-repos.registry.json'));
  const sources = registry.map((entry) => entry.source);
  assert.ok(sources.includes('nextlevelbuilder/ui-ux-pro-max-skill'));
  assert.equal(sources.includes('weijunswj/codex-n8n-local-setup'), false);
  assert.equal(sources.includes('weijunswj/ai-cicd-installer'), false);
  assert.equal(sources.includes('weijunswj/n8n-workflow-templates'), false);
});

test('validator rejects retired internal repos as active public source-watch targets', () => {
  const cwd = tempCopy();
  const registryPath = path.join(cwd, 'mcp', 'registry', 'source-repos.registry.json');
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

test('retired internal repo guard does not trust mutable source-lock metadata', () => {
  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  lock.source_lifecycle = 'active';
  lock.source_role = 'third_party_attribution_source';
  lock.source_update_policy = 'manual_review_required';
  lock.public_attribution_required = true;
  lock.source_commit = '1111111111111111111111111111111111111111';
  writeJsonFile(lockPath, lock);

  const registryPath = path.join(cwd, 'mcp', 'registry', 'source-repos.registry.json');
  const registry = readJsonFile(registryPath);
  registry.push({
    id: 'bad.retired.mutable',
    source: 'weijunswj/codex-n8n-local-setup',
    project_module: '_projects/n8n/local-setup'
  });
  writeJsonFile(registryPath, registry);

  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /known retired internal source repo must stay retired_after_migration/);
  assert.match(result.stderr, /retired internal repo must not be listed as active source-watch target/);
});

test('source watch rejects inconsistent active no-update metadata', () => {
  const lock = readJsonFile(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json'));
  lock.source_update_policy = 'none';

  assert.throws(
    () => sourceWatcher.buildPlan([{ relPath: '_projects/design/ui-ux-pro-max/SOURCE-LOCK.json', lock }]),
    /Unsupported SOURCE-LOCK lifecycle metadata/
  );
});

test('validator reports malformed source locks without aborting other diagnostics', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, '_projects', 'n8n', 'local-setup', 'SOURCE-LOCK.json'), '{ invalid json\n');
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad-export-source.md'), `Source: ${'projects/design/ui-ux-pro-max/' + 'exports/tools/readme.md'}\n`);

  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAIL: _projects\/n8n\/local-setup\/SOURCE-LOCK\.json is not valid JSON:/);
  assert.match(result.stderr, /Stale project exports path reference/);
  assert.doesNotMatch(result.stderr, /SyntaxError/);
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
    output: 'skills/n8n-local-setup/references/n8n/bad-curated.md'
  });
  manifest.writes.allowed.push('skills/n8n-local-setup/references/n8n/bad-curated.md');
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /curated output source must start with curated_output_for_ai\//);
});

test('sync rejects symlinked curated source files outside the workspace', (t) => {
  const cwd = tempCopy();
  const sourcePath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'curated_output_for_ai', 'skills', 'n8n-local-setup', 'README.md');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-sync-outside-'));
  const outsideFile = path.join(outsideDir, 'outside-curated.md');
  fs.writeFileSync(outsideFile, '# Outside curated source\n');

  if (!createSymlinkOrSkip(t, outsideFile, sourcePath, 'file')) return;

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe symlink/);
});

test('sync rejects symlinked source directories outside the workspace', (t) => {
  const cwd = tempCopy();
  const sourceDir = path.join(cwd, '_projects', 'n8n', 'local-setup', 'curated_output_for_ai', 'symlink-dir-fixture');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-sync-outside-'));
  fs.writeFileSync(path.join(outsideDir, 'README.md'), '# Outside directory source\n');

  if (!createSymlinkOrSkip(t, outsideDir, sourceDir, process.platform === 'win32' ? 'junction' : 'dir')) return;

  const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  manifest.outputs.push({
    kind: 'copy',
    source: 'curated_output_for_ai/symlink-dir-fixture',
    output: 'skills/n8n-local-setup/references/symlink-dir-fixture',
    fidelity: 'reviewed_entrypoint'
  });
  manifest.writes.allowed.push('skills/n8n-local-setup/references/symlink-dir-fixture');
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe symlink/);
});

test('internal curated Markdown files carry the curated review note', () => {
  const required = [
    'Curated AI-facing source.',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.'
  ];
  for (const projectDir of [
    '_projects/n8n/local-setup/curated_output_for_ai',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai',
    '_projects/cicd/secure-installer/curated_output_for_ai'
  ]) {
    const files = fs.readdirSync(path.join(repoRoot, projectDir), { recursive: true })
      .map((entry) => String(entry).replace(/\\/g, '/'))
      .filter((entry) => entry.endsWith('.md'));
    assert.ok(files.length > 0, projectDir);
    for (const file of files) {
      const text = readTextFile(path.join(repoRoot, projectDir, file));
      for (const needle of required) assert.ok(text.includes(needle), `${projectDir}/${file}`);
    }
  }
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
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad.md'), `Use ${'mcp/registry/*.' + 'yaml'} here.\n`);
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
    '# Local n8n Setup\n\nUse playbooks/ as canonical human documentation.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project README must link to _main\//);
  assert.match(result.stderr, /must not claim playbooks are canonical human documentation/);
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
  assert.match(result.stderr, /source-watch wording must stay notification-only and source-safe/);
});

test('validator rejects source-watch source-write claims even with advisory wording', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'bad-source-watch-advisory.md'),
    'Source-watch is advisory but copies upstream files into review PRs.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch wording must stay notification-only and source-safe/);
});

test('validator allows source-watch notification PR wording and negated source-write phrases', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'ok-source-watch-negated.md'),
    [
      'source-watch opens or updates a review notification PR.',
      'source-watch will not create branches.',
      'source-watch never mutates credentials.',
      'source-watch does not copy upstream source files.'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects pack YAML files in temp dirs', () => {
  const cwd = tempCopy();
  const badDir = path.join(cwd, 'skills', 'n8n-local-setup', 'packs', 'bad');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'pack.' + 'yaml'), 'id: bad\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not allowed/);
});

test('validator rejects forbidden files but tolerates ignored local runtime folders', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, '.env'), 'EXAMPLE=unsafe\n');
  fs.mkdirSync(path.join(cwd, '.n8n-local'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.n8n-local', '.env.n8n-archived-workflow-cleanup'), 'N8N_API_KEY="local-secret"\n');
  fs.mkdirSync(path.join(cwd, 'n8n-workflows'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'n8n-workflows', 'local.live-export.json'), '{}\n');
  fs.writeFileSync(path.join(cwd, 'sample.live-export.json'), '{}\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Forbidden env file/);
  assert.doesNotMatch(result.stderr, /Forbidden directory present: \.n8n-local/);
  assert.doesNotMatch(result.stderr, /Unexpected root entry: \.n8n-local/);
  assert.doesNotMatch(result.stderr, /Unexpected root entry: n8n-workflows/);
  assert.doesNotMatch(result.stderr, /n8n-workflows\/local\.live-export\.json/);
  assert.match(result.stderr, /Live n8n import\/export file/);
});

test('validator narrows credential example JSON allowance to intended fixtures', () => {
  const gitignore = readTextFile(path.join(repoRoot, '.gitignore'));
  assert.doesNotMatch(gitignore, /^!\*\.example\.json$/m);
  assert.match(gitignore, /^!_projects\/cicd\/secure-installer\/_main\/docs\/n8n\/n8n-credential-migration-map\.example\.json$/m);

  const errors = validator.runValidation();
  assert.deepEqual(
    errors.filter((error) => error.includes('n8n-credential-migration-map.example.json')),
    []
  );

  let cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'credential-map.example.json'), '{}\n');
  let result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Credential-looking JSON file present: repo\/docs\/credential-map\.example\.json/);

  cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'service.credentials.json'), '{}\n');
  result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Credential file present: repo\/docs\/service\.credentials\.json/);
});

test('validator rejects obvious secret-looking strings', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'secret.md'), `key=${'sk-' + 'A'.repeat(25)}\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /possible secret/);
});

test('safe-source-update classifies n8n helper templates as manual and workflow JSON as blocked', () => {
  assert.equal(safeSourceUpdate.classify('skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/compare-n8n-workflow-credentials.cjs'), 'manual');
  assert.equal(safeSourceUpdate.classify('skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/sanitise-n8n-template.ps1'), 'manual');
  assert.equal(safeSourceUpdate.classify('n8n-workflows/customer-workflow.json'), 'blocked');
});
