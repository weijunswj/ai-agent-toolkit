'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const beginMarker = '<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->';
const endMarker = '<!-- END N8N-AGENT-RULES-ADAPTER -->';

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function stripGeneratedNotices(text) {
  let remaining = text.trimStart();
  while (remaining.startsWith('<!--') && !remaining.startsWith('<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->')) {
    const end = remaining.indexOf('-->');
    assert.notEqual(end, -1, 'generated notice close marker');
    remaining = remaining.slice(end + '-->'.length).trimStart();
  }
  return remaining.trimEnd() + '\n';
}

function parseFrontMatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  assert.ok(normalized.startsWith('---\n'), 'front matter opens');
  const end = normalized.indexOf('\n---', 4);
  assert.notEqual(end, -1, 'front matter closes');
  const result = {};
  for (const line of normalized.slice(4, end).trim().split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function markerCount(text, marker) {
  return text.split(marker).length - 1;
}

function installerScriptPath() {
  return path.join(repoRoot, 'skills', 'n8n-agent-rules', 'scripts', 'install-n8n-agent-adapter.cjs');
}

function runInstaller(workspace, args = []) {
  return spawnSync(process.execPath, [installerScriptPath(), '--workspace', workspace, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function makeN8nWorkspace(prefix = 'n8n-agent-adapter-') {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(workspace, 'n8n-workflows'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'n8n-workflows', 'sample.workflow.json'), JSON.stringify({ nodes: [], connections: {} }, null, 2));
  return workspace;
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

test('n8n-agent-rules skill publishes the canonical full rules from development source', () => {
  const canonicalPath = '_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md';
  const skillPath = 'skills/n8n-agent-rules/SKILL.md';
  const publishedPath = 'skills/n8n-agent-rules/n8n-agent-rules.md';

  assert.equal(exists(canonicalPath), true, canonicalPath);
  assert.equal(exists(skillPath), true, skillPath);
  assert.equal(exists(publishedPath), true, publishedPath);

  const frontMatter = parseFrontMatter(readText(skillPath));
  assert.equal(frontMatter.name, 'n8n-agent-rules');
  for (const phrase of [
    'n8n workflow JSON',
    'n8n MCP',
    'n8n_docs',
    'n8n_live',
    'workflow creation',
    'workflow updates',
    'helper scripts',
    'import/export',
    'validation',
    'credentials',
    'webhook IDs',
    'workflow activation',
    'execution',
    'repo/live sync',
    'n8n safety'
  ]) {
    assert.match(frontMatter.description, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), phrase);
  }

  const canonical = readText(canonicalPath);
  const published = stripGeneratedNotices(readText(publishedPath));
  assert.equal(published, canonical);

  for (const safetyPhrase of [
    'Use documentation or builder tools first',
    'Use live n8n instance tools only when the user clearly asks',
    'Do not create or update a workflow from unvalidated workflow code when a validation tool is available',
    'Do not modify credentials unless the user explicitly asks',
    'Keep workflows inactive or unpublished by default',
    'Webhook',
    'Static data',
    'Sticky notes must stay concise',
    'Prompt-injection and untrusted input'
  ]) {
    assert.match(canonical, new RegExp(safetyPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), safetyPhrase);
  }
});

test('n8n-agent-rules skill documents the adapter auto-check approval protocol', () => {
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/n8n-agent-rules/SKILL.md',
    'skills/n8n-agent-rules/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /^## Adapter Auto-Check Protocol$/m, relPath);
    assert.match(text, /When this skill is selected for an n8n task/i, relPath);
    assert.match(text, /AGENTS\.md[\s\S]*CLAUDE\.md[\s\S]*GEMINI\.md/, relPath);
    assert.match(text, /--dry-run/, relPath);
    assert.match(text, /Show the dry-run result to the user/i, relPath);
    assert.match(text, /explicit current-turn approval before running `--write`/i, relPath);
    assert.match(text, /If approved, run the installer with `--write`/i, relPath);
    assert.match(text, /If declined, continue the current n8n task/i, relPath);
    assert.match(text, /future sessions\/tools may not auto-load the rules/i, relPath);
    assert.match(text, /If no active instruction file exists/i, relPath);
    assert.match(text, /`--target auto` is discovery only/i, relPath);
    assert.match(text, /stop and ask the adapter-target question before continuing the n8n task/i, relPath);
    assert.match(text, /unless the user already answered that target question in the current turn/i, relPath);
    assert.match(text, /read-only or no-modify tasks/i, relPath);
    assert.match(text, /Read-only\/no-modify blocks file writes and `--write`/i, relPath);
    assert.match(text, /does not block the adapter-target question/i, relPath);
    assert.match(text, /`AGENTS\.md` for Codex\/OpenCode/i, relPath);
    assert.match(text, /`CLAUDE\.md` for Claude Code/i, relPath);
    assert.match(text, /`GEMINI\.md` for Antigravity/i, relPath);
    assert.match(text, /\ball\b/i, relPath);
    assert.match(text, /\bnone\b/i, relPath);
    assert.match(text, /present all five options neutrally/, relPath);
    assert.match(text, /Do not suggest or default to `none` merely because the current task is read-only or no-modify/, relPath);
    assert.match(text, /The answer `none` is allowed and must be respected/i, relPath);
  }
});

test('n8n-agent-rules README tells agents to dry-run then ask before write', () => {
  for (const relPath of [
    '_projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/n8n-agent-rules/README.md',
    'skills/n8n-agent-rules/README.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /agents should automatically check/i, relPath);
    assert.match(text, /dry-run/i, relPath);
    assert.match(text, /show the preview/i, relPath);
    assert.match(text, /ask for explicit current-turn approval/i, relPath);
    assert.match(text, /If no `AGENTS\.md`, `CLAUDE\.md`, or `GEMINI\.md` exists/i, relPath);
    assert.match(text, /`--target auto` is discovery only/i, relPath);
    assert.match(text, /stop and ask which adapter target to create or propose before continuing the n8n task/i, relPath);
    assert.match(text, /unless the user already answered that target question in the current turn/i, relPath);
    assert.match(text, /read-only or no-modify tasks/i, relPath);
    assert.match(text, /does not block the adapter-target question/i, relPath);
    assert.match(text, /present all five options neutrally/, relPath);
    assert.match(text, /Do not suggest or default to `none` merely because the current task is read-only or no-modify/, relPath);
    assert.match(text, /`none` is allowed/i, relPath);
    assert.match(text, /Do not silently auto-install adapters/i, relPath);
    assert.match(text, /--target all/, relPath);
  }
});

test('generic AI coding agent templates stay slim and obsolete heavy templates are absent', () => {
  for (const relPath of [
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md',
    'skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md'
  ]) {
    const text = readText(relPath);
    assert.doesNotMatch(text, /\n# n8n MCP workflow rules\n/, relPath);
    assert.doesNotMatch(text, /\bn8n_docs\b|\bn8n_live\b/, relPath);
    assert.doesNotMatch(text, /\n# Skill Routing Rules\n/, relPath);
    assert.doesNotMatch(text, /Current Toolkit Skill Routing/, relPath);
  }

  for (const relPath of [
    'skills/ai-coding-agent-rules/TOOLKIT-SKILL-ROUTING.template.md',
    'skills/ai-coding-agent-rules/AGENTS.with-toolkit-skills.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.with-toolkit-skills.template.md',
    'skills/ai-coding-agent-rules/GEMINI.with-toolkit-skills.template.md',
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/ai-coding-agent-rules/GEMINI.template.md',
    'skills/ai-coding-agent-rules/antigravity-bootstrap.template.md',
    'skills/n8n-local-setup/agent-rules/AGENTS.n8n-full.template.md',
    'skills/n8n-local-setup/agent-rules/CLAUDE.n8n-full.template.md',
    'skills/n8n-local-setup/agent-rules/GEMINI.n8n-full.template.md',
    'skills/n8n-local-setup/agent-rules/n8n-mcp-rules.template.md',
    '_projects/n8n/local-setup/_main/agent-rules/n8n-mcp-rules.template.md'
  ]) {
    assert.equal(exists(relPath), false, relPath);
  }
});

test('existing n8n skills declare n8n-agent-rules dependency in entrypoints', () => {
  for (const relPath of [
    '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/SKILL.md',
    '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md',
    'skills/n8n-local-setup/SKILL.md',
    'skills/n8n-local-setup/README.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/skills/n8n-workflow-helper-scripts/SKILL.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/skills/n8n-workflow-helper-scripts/README.md',
    'skills/n8n-workflow-helper-scripts/SKILL.md',
    'skills/n8n-workflow-helper-scripts/README.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/skills/n8n-workflow-templates/SKILL.md',
    '_projects/n8n/workflow-toolkit/curated_output_for_ai/skills/n8n-workflow-templates/README.md',
    'skills/n8n-workflow-templates/SKILL.md',
    'skills/n8n-workflow-templates/README.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /\bn8n-agent-rules\b/, relPath);
  }
});

test('generated cross-skill n8n-agent-rules references are labelled and source-backed', () => {
  const canonicalPath = '_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md';
  const canonical = readText(canonicalPath).trimEnd();
  for (const relPath of [
    'skills/n8n-local-setup/references/n8n-agent-rules.md',
    'skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md',
    'skills/n8n-workflow-templates/references/n8n-agent-rules.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /Generated cross-skill reference\./, relPath);
    assert.match(text, /Canonical source project: `development\.ai-coding-agent-rules`/, relPath);
    assert.match(text, new RegExp(`Canonical source file: \`${canonicalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``), relPath);
    assert.match(text, /Owning skill\/project: `n8n-agent-rules` \/ `development\.ai-coding-agent-rules`/, relPath);
    assert.match(text, new RegExp(`Generated destination: \`${relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``), relPath);
    assert.match(text, /Do not edit this file directly\./, relPath);
    assert.match(text, /Update the canonical source and run sync\./, relPath);
    assert.match(text, new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), relPath);
  }
});

test('n8n adapters are brief optional snippets and do not duplicate the full ruleset', () => {
  for (const relPath of [
    'skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md',
    'skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md',
    'skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md'
  ]) {
    const text = stripGeneratedNotices(readText(relPath));
    assert.ok(text.length <= 2200, `${relPath} should stay brief`);
    assert.equal(markerCount(text, '<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->'), 1, relPath);
    assert.equal(markerCount(text, '<!-- END N8N-AGENT-RULES-ADAPTER -->'), 1, relPath);
    assert.match(text, /\bn8n-agent-rules\b/, relPath);
    assert.match(text, /stop and ask the user to install or provide it/i, relPath);
    assert.match(text, /Do not run live n8n, Docker, import\/export, sync, activation, execution, publish\/unpublish, archive\/delete, or credential actions without explicit current-turn approval/i, relPath);
    for (const approvalField of ['Target repo', 'Target n8n instance/environment', 'Allowed operation', 'Workflow names/set', 'Forbidden operations']) {
      assert.match(text, new RegExp(approvalField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), relPath);
    }
    assert.doesNotMatch(text, /\n# n8n MCP workflow rules\n/, relPath);
    assert.doesNotMatch(text, /Workflow builder order[\s\S]{0,200}Workflow build preferences/, relPath);
  }
});

test('adapter installer dry-run reports changes and write mode is idempotent', () => {
  const workspace = makeN8nWorkspace();
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Existing AGENTS\n\n');

  const dryRun = runInstaller(workspace, ['--target', 'auto', '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Detected n8n involvement/i);
  assert.match(dryRun.stdout, /Would update AGENTS\.md/i);
  assert.doesNotMatch(fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), /BEGIN N8N-AGENT-RULES-ADAPTER/);

  for (let i = 0; i < 2; i += 1) {
    const write = runInstaller(workspace, ['--target', 'auto', '--write']);
    assert.equal(write.status, 0, write.stderr);
  }

  const installed = fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8');
  assert.equal(markerCount(installed, '<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->'), 1);
  assert.equal(markerCount(installed, '<!-- END N8N-AGENT-RULES-ADAPTER -->'), 1);
  assert.match(installed, /\bn8n-agent-rules\b/);
});

test('adapter installer auto dry-run with no active instruction files asks for required target choice', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-auto-no-active-');

  const result = runInstaller(workspace, ['--target', 'auto', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Detected n8n involvement/i);
  assert.match(result.stdout, /No existing active instruction files found for --target auto/i);
  assert.match(result.stdout, /No files would be created automatically/i);
  assert.match(result.stdout, /Required next step/i);
  assert.match(result.stdout, /Ask the user which adapter target to create or propose/i);
  for (const option of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'all', 'none']) {
    assert.match(result.stdout, new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), option);
  }
  assert.match(result.stdout, /read-only or no-modify tasks/i);
  assert.match(result.stdout, /Do not run --write without explicit current-turn approval/i);

  for (const activeFile of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    assert.equal(fs.existsSync(path.join(workspace, activeFile)), false, activeFile);
  }
});

test('adapter installer target all dry-run previews all adapters without writing', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-all-dry-run-');
  fs.writeFileSync(path.join(workspace, 'CLAUDE.md'), '# Existing CLAUDE\n');

  const result = runInstaller(workspace, ['--target', 'all', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would create AGENTS\.md/);
  assert.match(result.stdout, /Would update CLAUDE\.md/);
  assert.match(result.stdout, /Would create GEMINI\.md/);

  assert.equal(fs.existsSync(path.join(workspace, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'GEMINI.md')), false);
  const claude = fs.readFileSync(path.join(workspace, 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(claude, /BEGIN N8N-AGENT-RULES-ADAPTER/);
});

test('adapter installer target all write creates and updates all adapters', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-all-write-');
  fs.writeFileSync(path.join(workspace, 'CLAUDE.md'), '# Existing CLAUDE\n');

  const result = runInstaller(workspace, ['--target', 'all', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created AGENTS\.md/);
  assert.match(result.stdout, /Updated CLAUDE\.md/);
  assert.match(result.stdout, /Created GEMINI\.md/);

  for (const activeFile of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const text = fs.readFileSync(path.join(workspace, activeFile), 'utf8');
    assert.equal(markerCount(text, beginMarker), 1, activeFile);
    assert.equal(markerCount(text, endMarker), 1, activeFile);
    assert.match(text, /\bn8n-agent-rules\b/, activeFile);
  }
});

test('adapter installer target auto only patches existing active instruction files', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-auto-existing-only-');
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Existing AGENTS\n');

  const result = runInstaller(workspace, ['--target', 'auto', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Updated AGENTS\.md/);
  assert.doesNotMatch(result.stdout, /CLAUDE\.md/);
  assert.doesNotMatch(result.stdout, /GEMINI\.md/);

  assert.equal(fs.existsSync(path.join(workspace, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'GEMINI.md')), false);
  const agents = fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8');
  assert.equal(markerCount(agents, beginMarker), 1);
  assert.equal(markerCount(agents, endMarker), 1);
});

test('adapter installer refuses symlinked active instruction files without modifying the target', (t) => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-symlink-');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-agent-adapter-outside-'));
  const outsideTarget = path.join(outsideDir, 'outside-AGENTS.md');
  const originalOutside = '# Outside target\n';
  fs.writeFileSync(outsideTarget, originalOutside);

  const activePath = path.join(workspace, 'AGENTS.md');
  if (!createSymlinkOrSkip(t, outsideTarget, activePath, 'file')) return;

  const result = runInstaller(workspace, ['--target', 'agents', '--write']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing symlinked active instruction file: AGENTS\.md/);
  assert.equal(fs.readFileSync(outsideTarget, 'utf8'), originalOutside);
});

test('adapter installer updates normal non-symlink active instruction files', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-normal-');
  const activePath = path.join(workspace, 'AGENTS.md');
  fs.writeFileSync(activePath, '# Existing AGENTS\n');

  const result = runInstaller(workspace, ['--target', 'agents', '--write']);
  assert.equal(result.status, 0, result.stderr);

  const installed = fs.readFileSync(activePath, 'utf8');
  assert.match(installed, /# Existing AGENTS/);
  assert.equal(markerCount(installed, '<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->'), 1);
  assert.equal(markerCount(installed, '<!-- END N8N-AGENT-RULES-ADAPTER -->'), 1);
});

test('adapter installer replaces a single managed adapter block', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-replace-');
  const activePath = path.join(workspace, 'AGENTS.md');
  fs.writeFileSync(activePath, `# Existing AGENTS\n\n${beginMarker}\nold adapter block\n${endMarker}\n`);

  const result = runInstaller(workspace, ['--target', 'agents', '--write']);
  assert.equal(result.status, 0, result.stderr);

  const installed = fs.readFileSync(activePath, 'utf8');
  assert.match(installed, /# Existing AGENTS/);
  assert.doesNotMatch(installed, /old adapter block/);
  assert.equal(markerCount(installed, beginMarker), 1);
  assert.equal(markerCount(installed, endMarker), 1);
});

test('adapter installer appends managed adapter block when no markers exist', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-append-');
  const activePath = path.join(workspace, 'AGENTS.md');
  fs.writeFileSync(activePath, '# Existing AGENTS\n\nKeep this local rule.\n');

  const result = runInstaller(workspace, ['--target', 'agents', '--write']);
  assert.equal(result.status, 0, result.stderr);

  const installed = fs.readFileSync(activePath, 'utf8');
  assert.match(installed, /# Existing AGENTS/);
  assert.match(installed, /Keep this local rule\./);
  assert.equal(markerCount(installed, beginMarker), 1);
  assert.equal(markerCount(installed, endMarker), 1);
});

test('adapter installer rejects duplicate complete managed adapter blocks without modifying the file', () => {
  const workspace = makeN8nWorkspace('n8n-agent-adapter-duplicate-');
  const activePath = path.join(workspace, 'AGENTS.md');
  const existing = `# Existing AGENTS\n\n${beginMarker}\nold adapter block 1\n${endMarker}\n\n${beginMarker}\nold adapter block 2\n${endMarker}\n`;
  fs.writeFileSync(activePath, existing);

  const result = runInstaller(workspace, ['--target', 'agents', '--write']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Malformed managed adapter markers in AGENTS\.md/);
  assert.equal(fs.readFileSync(activePath, 'utf8'), existing);
});

test('adapter installer rejects malformed managed markers', () => {
  const malformedCases = [
    ['begin only', `# Existing AGENTS\n\n${beginMarker}\nold block\n`],
    ['end only', `# Existing AGENTS\n\n${endMarker}\nold block\n`],
    ['end before begin', `# Existing AGENTS\n\n${endMarker}\nold block\n${beginMarker}\n`]
  ];

  for (const [label, existing] of malformedCases) {
    const workspace = makeN8nWorkspace(`n8n-agent-adapter-malformed-${label.replaceAll(' ', '-')}-`);
    const activePath = path.join(workspace, 'AGENTS.md');
    fs.writeFileSync(activePath, existing);

    const result = runInstaller(workspace, ['--target', 'agents', '--write']);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /Malformed managed adapter markers in AGENTS\.md/, label);
    assert.equal(fs.readFileSync(activePath, 'utf8'), existing, label);
  }
});
