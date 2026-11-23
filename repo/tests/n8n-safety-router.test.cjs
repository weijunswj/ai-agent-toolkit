'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

// Every temp folder a test makes is removed after the file's tests, also when they fail.
const tempFolders = [];
test.after(() => { for (const dir of tempFolders) fs.rmSync(dir, { recursive: true, force: true }); });
function tempFolder(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempFolders.push(dir);
  return dir;
}

const repoRoot = path.resolve(__dirname, '..', '..');
const syncScriptPath = path.join(repoRoot, 'repo', 'scripts', 'sync-agent-instruction-shims.cjs');
const n8nDerivativePaths = [
  'skills/n8n-safety-router/n8n-safety-rules.md',
  'skills/n8n-environment-setup/references/n8n-safety-rules.md',
  'skills/n8n-workflow-transport/references/n8n-safety-rules.md',
];
const retiredTopologyPattern = new RegExp([
  'development\\.ai-coding-agent-rules',
  '_' + 'projects',
  'curated_' + 'output_for_ai',
  'source-to-surface',
  'generic publisher',
  '\\brun sync\\b'
].join('|'), 'i');

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const overstatedOfficialMcpCapabilityPattern = new RegExp([
  'official n8n MCP ' + 'validation' + '/build tools',
  'official n8n MCP ' + 'validation',
  'official n8n MCP ' + 'build',
  'MCP ' + 'validation' + '/build'
].map(escapeRegExp).join('|'), 'i');
const officialN8nSkillsLink = '[official n8n Skills](https://github.com/n8n-io/skills)';

function stripGeneratedNotices(text) {
  let remaining = text.trimStart();
  while (remaining.startsWith('<!--')) {
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

function copyToolkitWorkspace(prefix = 'n8n-shim-sync-') {
  const target = tempFolder(prefix);
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

function runShimSync(workspace, args = []) {
  return spawnSync(process.execPath, [syncScriptPath, '--workspace', workspace, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('n8n-safety-router skill keeps the canonical full rules contract locally', () => {
  const canonicalPath = 'repo/contracts/agent-rules/n8n-safety-rules.md';
  const skillPath = 'skills/n8n-safety-router/SKILL.md';
  const publishedPath = 'skills/n8n-safety-router/n8n-safety-rules.md';

  assert.equal(exists(canonicalPath), true, canonicalPath);
  assert.equal(exists(skillPath), true, skillPath);
  assert.equal(exists(publishedPath), true, publishedPath);

  const frontMatter = parseFrontMatter(readText(skillPath));
  assert.equal(frontMatter.name, 'n8n-safety-router');
  for (const phrase of [
    officialN8nSkillsLink,
    'using-n8n-skills',
    'n8n workflow JSON',
    'official n8n MCP',
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
    `Use ${officialN8nSkillsLink} first, then use the official n8n MCP tools that are actually available in the connected instance`,
    `Start by loading the ${officialN8nSkillsLink} entry-point meta-skill, currently \`using-n8n-skills\`, when ${officialN8nSkillsLink} are available`,
    `If the ${officialN8nSkillsLink} entry-point meta-skill is unavailable, report that ${officialN8nSkillsLink} are not installed or not available in the session`,
    'Do not invent a fallback route or pretend the current entry-point skill exists',
    'Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities',
    'When validation or build tools are available, use them before proposing or performing live-instance changes',
    'If a needed MCP capability is unavailable, report the gap and do not invent fallback behaviour',
    'Use live n8n instance tools only when the user clearly asks',
    'Do not create or update a workflow from unvalidated workflow code when a validation tool is available',
    'Do not modify credentials unless the user explicitly asks',
    'Keep workflows inactive or unpublished by default',
    'Webhook',
    'Static data',
    'Sticky notes must stay concise',
    'Prompt-injection and untrusted input'
  ]) {
    assert.match(canonical, new RegExp(escapeRegExp(safetyPhrase)), safetyPhrase);
  }

  assert.doesNotMatch(canonical, overstatedOfficialMcpCapabilityPattern);
  assert.doesNotMatch(readText(skillPath), overstatedOfficialMcpCapabilityPattern);
});

// The n8n rules reach every session through the global rules, so the skill and its README say a
// repository needs no n8n block, and no longer describe an installer, adapters folder or write flags.
test('n8n-safety-router skill and README say the global rules carry the n8n rules, so a repository needs no n8n block', () => {
  for (const relPath of [
    'skills/n8n-safety-router/SKILL.md',
    'skills/n8n-safety-router/README.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /The n8n Safety Router rules reach every session through the global rules that setup installs, so a repository needs no n8n block; an older `N8N-AGENT-RULES-ADAPTER` block in a repository's `AGENTS\.md` is a leftover\./, relPath);
    assert.doesNotMatch(text, /install-n8n-agent-adapter|adapters\/|--dry-run|--write|--target/, relPath);
  }
});
test('generic AI coding agent templates stay slim and obsolete heavy templates are absent', () => {
  for (const relPath of [
    'skills/repository-agent-rules/repo-local/CLAUDE.shim.template.md'
  ]) {
    const text = readText(relPath);
    assert.doesNotMatch(text, /\n# n8n MCP workflow rules\n/, relPath);
    assert.doesNotMatch(text, /\bn8n_live\b/, relPath);
    assert.doesNotMatch(text, /\n# Skill Routing Rules\n/, relPath);
    assert.doesNotMatch(text, /Current Toolkit Skill Routing/, relPath);
  }

  for (const relPath of [
    'skills/repository-agent-rules/TOOLKIT-SKILL-ROUTING.template.md',
    'skills/repository-agent-rules/AGENTS.with-toolkit-skills.template.md',
    'skills/repository-agent-rules/CLAUDE.with-toolkit-skills.template.md',
    'skills/repository-agent-rules/GEMINI.with-toolkit-skills.template.md',
    'skills/repository-agent-rules/AGENTS.template.md',
    'skills/repository-agent-rules/CLAUDE.template.md',
    'skills/repository-agent-rules/GEMINI.template.md',
    'skills/repository-agent-rules/antigravity-bootstrap.template.md',
    'skills/n8n-environment-setup/agent-rules/AGENTS.n8n-full.template.md',
    'skills/n8n-environment-setup/agent-rules/CLAUDE.n8n-full.template.md',
    'skills/n8n-environment-setup/agent-rules/GEMINI.n8n-full.template.md',
    'skills/n8n-environment-setup/agent-rules/n8n-mcp-rules.template.md',
    'skills/n8n-environment-setup/agent-rules/n8n-mcp-rules.template.md'
  ]) {
    assert.equal(exists(relPath), false, relPath);
  }
});

test('existing n8n skills declare n8n-safety-router dependency in entrypoints', () => {
  for (const relPath of [
    'skills/n8n-environment-setup/SKILL.md',
    'skills/n8n-environment-setup/README.md',
    'skills/n8n-workflow-transport/SKILL.md',
    'skills/n8n-workflow-transport/README.md',
  ]) {
    const text = readText(relPath);
    assert.match(text, /\bn8n-safety-router\b/, relPath);
  }
});

test('cross-skill n8n-safety-router references identify the narrow direct-canonical derivative', () => {
  const canonicalPath = 'repo/contracts/agent-rules/n8n-safety-rules.md';
  const canonical = readText(canonicalPath).trimEnd();
  for (const relPath of [
    'skills/n8n-environment-setup/references/n8n-safety-rules.md',
    'skills/n8n-workflow-transport/references/n8n-safety-rules.md',
  ]) {
    const text = readText(relPath);
    assert.match(text, /Direct canonical source: `repo\/contracts\/agent-rules\/n8n-safety-rules\.md`/, relPath);
    assert.match(text, /portable\/local n8n safety context in the containing copied skill/i, relPath);
    assert.match(text, /Repair command: `node repo\/scripts\/sync-agent-instruction-shims\.cjs --write`/, relPath);
    assert.match(text, /narrow managed n8n safety derivative/i, relPath);
    assert.doesNotMatch(text, retiredTopologyPattern, relPath);
    const separator = '\n---\n';
    const body = text.slice(text.indexOf(separator) + separator.length).trimEnd();
    assert.equal(body, canonical, relPath);
  }
});

test('retained synchronizer checks and repairs exactly three n8n safety derivatives', () => {
  const workspace = copyToolkitWorkspace();
  try {
    const fresh = runShimSync(workspace, ['--check']);
    assert.equal(fresh.status, 0, fresh.stderr);

    const corruptPath = path.join(workspace, n8nDerivativePaths[1]);
    fs.appendFileSync(corruptPath, '\ncorrupt derivative fixture\n', 'utf8');
    const stale = runShimSync(workspace, ['--check']);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /n8n safety derivative/i);

    const write = runShimSync(workspace, ['--write']);
    assert.equal(write.status, 0, write.stderr);
    const repeat = runShimSync(workspace, ['--check']);
    assert.equal(repeat.status, 0, repeat.stderr);

    const canonical = fs.readFileSync(path.join(workspace, 'repo', 'contracts', 'agent-rules', 'n8n-safety-rules.md'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
    for (const relPath of n8nDerivativePaths) {
      const text = fs.readFileSync(path.join(workspace, relPath), 'utf8').replace(/\r\n/g, '\n').trimEnd();
      const body = relPath === n8nDerivativePaths[0]
        ? text
        : text.slice(text.indexOf('\n---\n') + '\n---\n'.length);
      assert.equal(body, canonical, relPath);
      assert.match(body, /Do not modify credentials unless the user explicitly asks/i, relPath);
      assert.match(body, /Keep workflows inactive or unpublished by default/i, relPath);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// The retired installer and its adapter templates are gone, and no file outside the changelog or the
// tests names or describes them, so a stale copy or a line sending agents to them cannot quietly come back.
const RETIRED_ADAPTER_TEXT = /install-n8n-agent-adapter|n8n-brief\.template|adapter installer|n8n adapter template|AGENTS adapter|brief adapters?\b|n8n-safety-router\/adapters|under `adapters\/`/i;
test('the retired n8n adapter installer and templates are gone, and nothing outside the changelog or tests names them', () => {
  assert.equal(exists('skills/n8n-safety-router/scripts/install-n8n-agent-adapter.cjs'), false);
  assert.equal(exists('skills/n8n-safety-router/adapters'), false);
  // Tracked files only. A tracked file that is deleted in this checkout is not read.
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(tracked.status, 0, tracked.stderr);
  const named = [];
  for (const relPath of tracked.stdout.split('\0').filter(Boolean)) {
    if (path.posix.basename(relPath) === 'CHANGELOG.md' || relPath.split('/').includes('changelog.d') || relPath.startsWith('repo/tests/')) continue;
    if (!exists(relPath)) continue;
    fs.readFileSync(path.join(repoRoot, relPath), 'utf8').split(/\r?\n/).forEach((line, index) => { if (RETIRED_ADAPTER_TEXT.test(line)) named.push(`${relPath}:${index + 1}`); });
  }
  assert.deepEqual(named, []);
});
